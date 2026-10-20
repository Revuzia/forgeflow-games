#!/usr/bin/env python3
"""VALE — painted tiling terrain textures for render/terrain.ts (lane TERRAIN).

    ~/Developer/forgeflow-games/.venv/bin/python3 tools/terrain_textures.py [--out art/out/textures] [--size 1024] [--only litter,grain]

Every texture is seamless (periodic noise from filtered spectra, wrapped scatter, periodic Voronoi), deterministic
(fixed seeds) and RGBA: RGB = the painting, A = a height field (0.25 + 0.75 h) the shader uses for bump and for
height-blended transitions (moss creeping into joints, broken flags at the road edge). The shader maps each painting's
MEAN colour onto the designed band colour (the bible's value law holds), so only the painting's relative hue and value
structure matters here.

  terrain_litter.webp  Dialwood floor: fallen fan leaves, moss cushions and old dial-stone peeking through   (tile 6 m)
  terrain_grain.webp   honed stone grain: quiet mottling, mineral speckle, pits and hairline cracks (every
                       stone surface: flags, courses, lips, rock)                                            (tile 3 m)
  terrain_moss.webp    dense cushion moss with the odd leaf (verge joints, wall feet, block tops, brush floor) (tile 4 m)
"""
import argparse
import math
import os

import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.spatial import cKDTree

# ── periodic noise ────────────────────────────────────────────────────────────────────────────────


def spectral_noise(n, rng, beta=2.0, fmin=1.0, fmax=None, aniso=1.0):
    """seamless n×n noise with a power spectrum ~ f^-beta between fmin and fmax (cycles per tile); zero mean, unit std.
    aniso > 1 stretches the features along x (rows keep their frequency, columns are penalised)"""
    fy = np.fft.fftfreq(n) * n
    fx = np.fft.rfftfreq(n) * n
    f = np.sqrt(fy[:, None] ** 2 + (fx[None, :] * aniso) ** 2)
    amp = np.zeros_like(f)
    m = f >= fmin
    if fmax is not None:
        m &= f <= fmax
    amp[m] = f[m] ** (-beta / 2.0)
    ph = rng.standard_normal(f.shape) + 1j * rng.standard_normal(f.shape)
    out = np.fft.irfft2(amp * ph, s=(n, n))
    out -= out.mean()
    return out / (out.std() + 1e-9)


def sample_wrap(field, ys, xs):
    """bilinear sample of a periodic field at float pixel coords"""
    return ndimage.map_coordinates(field, [ys, xs], order=1, mode='grid-wrap')


def warp(field, wy, wx, amount):
    n = field.shape[0]
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    return sample_wrap(field, yy + wy * amount, xx + wx * amount)


def remap(x, lo, hi):
    return np.clip((x - lo) / (hi - lo), 0.0, 1.0)


def smooth(x, lo, hi):
    t = remap(x, lo, hi)
    return t * t * (3 - 2 * t)


def blur_wrap(img, sigma):
    if img.ndim == 3:
        return np.stack([ndimage.gaussian_filter(img[..., c], sigma, mode='wrap') for c in range(img.shape[2])], -1)
    return ndimage.gaussian_filter(img, sigma, mode='wrap')


def periodic_voronoi(n, pts):
    """per pixel: index of the nearest site, F1, and the exact distance to the nearest cell border (pixels).
    pts in [0, n)^2; the plane is periodic."""
    k = len(pts)
    offs = np.array([(dx, dy) for dy in (-n, 0, n) for dx in (-n, 0, n)], dtype=np.float64)
    allp = (pts[None, :, :] + offs[:, None, :]).reshape(-1, 2)
    ids = np.tile(np.arange(k), 9)
    tree = cKDTree(allp)
    yy, xx = np.mgrid[0:n, 0:n]
    q = np.stack([xx.ravel() + 0.5, yy.ravel() + 0.5], -1)
    d, i = tree.query(q, k=2)
    a = allp[i[:, 0]]
    b = allp[i[:, 1]]
    mid = (a + b) * 0.5
    ab = b - a
    ln = np.linalg.norm(ab, axis=1) + 1e-9
    border = np.abs(((mid - q) * ab).sum(1)) / ln
    return ids[i[:, 0]].reshape(n, n), d[:, 0].reshape(n, n), border.reshape(n, n)


def poisson_points(n, rng, count, min_d):
    """dart throwing on the torus"""
    pts = []
    tries = 0
    while len(pts) < count and tries < count * 60:
        tries += 1
        p = rng.random(2) * n
        ok = True
        for q in pts[-400:]:
            d = np.abs(p - q)
            d = np.minimum(d, n - d)
            if d[0] * d[0] + d[1] * d[1] < min_d * min_d:
                ok = False
                break
        if ok:
            pts.append(p)
    return np.array(pts)


# ── stamping (wrapped) ────────────────────────────────────────────────────────────────────────────


def stamp(canvas, alpha_acc, height, cx, cy, size, fn, rng_val, h_base, h_amt):
    """rasterise one shape (fn returns rgb, coverage, local height on a local grid) onto the periodic canvas"""
    n = canvas.shape[0]
    r = int(math.ceil(size))
    xs = np.arange(int(cx) - r, int(cx) + r + 1)
    ys = np.arange(int(cy) - r, int(cy) + r + 1)
    X, Y = np.meshgrid(xs + 0.5 - cx, ys + 0.5 - cy)
    rgb, cov, lh = fn(X, Y, rng_val)
    if cov.max() <= 0:
        return
    yi = (ys % n)[:, None]
    xi = (xs % n)[None, :]
    c = cov[..., None]
    canvas[yi, xi] = canvas[yi, xi] * (1 - c) + rgb * c
    hh = h_base + lh * h_amt
    height[yi, xi] = np.where(cov > 0.5, np.maximum(height[yi, xi] * (1 - cov) + hh * cov, hh * cov), height[yi, xi])
    alpha_acc[yi, xi] = np.maximum(alpha_acc[yi, xi], cov)


def shadow_stamp(dark, cx, cy, size, fn, rng_val, off, n):
    r = int(math.ceil(size + abs(off[0]) + abs(off[1])))
    xs = np.arange(int(cx) - r, int(cx) + r + 1)
    ys = np.arange(int(cy) - r, int(cy) + r + 1)
    X, Y = np.meshgrid(xs + 0.5 - cx - off[0], ys + 0.5 - cy - off[1])
    _, cov, _ = fn(X, Y, rng_val)
    yi = (ys % n)[:, None]
    xi = (xs % n)[None, :]
    dark[yi, xi] = np.maximum(dark[yi, xi], cov)


def save(path, rgb, height):
    rgb = np.clip(rgb, 0, 1)
    a = np.clip(0.25 + 0.75 * height, 0, 1)
    img = np.concatenate([rgb, a[..., None]], -1)
    im = Image.fromarray((img * 255 + 0.5).astype(np.uint8), 'RGBA')
    im.save(path, 'WEBP', quality=90, method=6, exact=True)
    print(f'{os.path.basename(path)}  mean rgb {rgb.reshape(-1, 3).mean(0).round(3)}  height {height.mean():.2f}±{height.std():.2f}  {os.path.getsize(path) // 1024} KB')


def downsample(img, f):
    if f == 1:
        return img
    n = img.shape[0] // f
    if img.ndim == 3:
        return img.reshape(n, f, n, f, img.shape[2]).mean((1, 3))
    return img.reshape(n, f, n, f).mean((1, 3))


# ── shapes ────────────────────────────────────────────────────────────────────────────────────────


def fan_leaf(size, rot, col, curl):
    """a fallen Dialwood fan leaf (wedge fan with a notched rim and radiating veins) seen from above"""
    ca, sa = math.cos(rot), math.sin(rot)
    R = size

    def fn(X, Y, _):
        u = (X * ca + Y * sa)
        v = (-X * sa + Y * ca)
        # base of the fan (petiole joint) at u = -0.45R
        uu = u + 0.45 * R
        r = np.sqrt(uu * uu + v * v) + 1e-6
        th = np.arctan2(v, uu)
        half = 0.95
        notch = 0.16 * np.exp(-(th / 0.12) ** 2)
        rim = R * (1.0 - notch) * (0.97 + 0.03 * np.cos(th * 9.0))
        inside = np.clip((rim - r) / 0.9, 0, 1) * np.clip((half - np.abs(th)) * R / 1.2, 0, 1)
        inside *= np.clip((r - 0.08 * R) / 0.8, 0, 1)
        # petiole: a short thin stalk behind the fan
        stalk = np.clip(1.0 - np.abs(v) / 0.9, 0, 1) * ((uu < 0.1 * R) & (uu > -0.35 * R))
        cov = np.maximum(inside, stalk * 0.9)
        veins = 0.5 + 0.5 * np.cos(th * 34.0)
        shade = 1.0 + 0.10 * np.cos(th * 2.0 + curl) - 0.10 * (r / R) ** 2 + 0.06 * (u / R)
        edge = np.clip((rim - r) / (0.14 * R), 0, 1)
        c = np.array(col)[None, None, :] * (shade * (0.92 + 0.08 * veins) * (0.82 + 0.18 * edge))[..., None]
        c = np.where(stalk[..., None] > inside[..., None], np.array(col)[None, None, :] * 0.7, c)
        lh = 0.6 + 0.4 * (1 - (r / R) ** 2) * (np.abs(np.sin(th * 1.5 + curl)))
        return c, cov, lh
    return fn


def almond_leaf(size, rot, col):
    ca, sa = math.cos(rot), math.sin(rot)

    def fn(X, Y, _):
        u = (X * ca + Y * sa) / size
        v = (-X * sa + Y * ca) / size
        w = 0.36 * (1 - u * u)
        cov = np.clip((w - np.abs(v)) * size / 0.9, 0, 1) * (np.abs(u) < 1)
        mid = np.exp(-(v / 0.03) ** 2)
        shade = 1.0 + 0.12 * np.sign(v) * 0.5 - 0.08 * u
        c = np.array(col)[None, None, :] * (shade * (1 - 0.18 * mid))[..., None]
        return c, cov, 0.7 + 0.3 * (1 - np.abs(v) / 0.36)
    return fn


def pebble(size, col, rng):
    sx = size * (0.8 + 0.4 * rng.random())
    sy = size * (0.7 + 0.3 * rng.random())
    rot = rng.random() * math.pi
    ca, sa = math.cos(rot), math.sin(rot)

    def fn(X, Y, _):
        u = (X * ca + Y * sa) / sx
        v = (-X * sa + Y * ca) / sy
        d = np.sqrt(u * u + v * v)
        cov = np.clip((1 - d) * sx / 0.8, 0, 1)
        # lit from the top-left (the sun sits behind-left of the camera)
        nz = np.sqrt(np.clip(1 - d * d, 0, 1))
        lit = 0.55 + 0.45 * np.clip(nz * 0.7 + (-u * 0.45 - v * 0.45) * 0.6, 0, 1.2)
        c = np.array(col)[None, None, :] * lit[..., None]
        return c, cov, nz
    return fn


def twig(length, rot, col, bend):
    ca, sa = math.cos(rot), math.sin(rot)

    def fn(X, Y, _):
        u = (X * ca + Y * sa)
        v = (-X * sa + Y * ca) - bend * (u / length) ** 2 * length
        th = 1.1 * (1 - 0.5 * np.abs(u) / length)
        cov = np.clip((th - np.abs(v)) / 0.7, 0, 1) * (np.abs(u) < length)
        c = np.broadcast_to(np.array(col)[None, None, :], cov.shape + (3,)) * (1 + 0.15 * (v < 0))[..., None]
        return c, cov, np.ones_like(cov) * 0.8
    return fn


# ── textures ──────────────────────────────────────────────────────────────────────────────────────


def cushions(n, rng, pxm, size_m, fill=1.0):
    """moss cushions: soft domes (nearest-site distance over a per-site radius), creases between them; returns
    (dome 0..1, site id, per-site random)"""
    k = int((n / (pxm * size_m)) ** 2 * fill)
    pts = rng.random((k, 2)) * n
    r = rng.random(k)
    offs = np.array([(dx, dy) for dy in (-n, 0, n) for dx in (-n, 0, n)], dtype=np.float64)
    allp = (pts[None, :, :] + offs[:, None, :]).reshape(-1, 2)
    ids = np.tile(np.arange(k), 9)
    tree = cKDTree(allp)
    yy, xx = np.mgrid[0:n, 0:n]
    q = np.stack([xx.ravel() + 0.5, yy.ravel() + 0.5], -1)
    d, i = tree.query(q, k=3)
    rad = pxm * size_m * (0.55 + 0.6 * r[ids[i]])
    dome = np.clip(1 - (d / rad) ** 2, 0, 1)
    best = dome.argmax(1)
    dm = dome[np.arange(len(q)), best]
    sid = ids[i[np.arange(len(q)), best]]
    return np.sqrt(dm).reshape(n, n), sid.reshape(n, n), r


def litter(N, seed=11):
    """Dialwood floor: tile 6 m. Moss cushions in broad drifts, fallen fan leaves in the hollows, a little old dial-stone
    peeking through. Quiet at play distance (units must pop), rich up close."""
    rng = np.random.default_rng(seed)
    S = 2  # supersample
    n = N * S
    pxm = n / 6.0
    big = spectral_noise(n, rng, beta=3.2, fmin=1, fmax=10)
    mid = spectral_noise(n, rng, beta=2.4, fmin=4, fmax=60)
    fine = spectral_noise(n, rng, beta=1.4, fmin=40, fmax=n // 3)
    wy = spectral_noise(n, rng, beta=3.0, fmin=2, fmax=14)
    wx = spectral_noise(n, rng, beta=3.0, fmin=2, fmax=14)
    # soil: dark loam
    soil = np.zeros((n, n, 3), np.float32)
    soil[:] = np.array([0.20, 0.172, 0.135])
    soil *= (1 + 0.10 * big + 0.07 * mid + 0.06 * fine)[..., None]
    # old flags (≈1.3 m) peeking through: mossy grey-green, whole flags at a time, soft worn edges
    pts = poisson_points(n, rng, int((6 / 1.25) ** 2 * 1.15), pxm * 1.0)
    cell, f1, border = periodic_voronoi(n, pts)
    cell_r = rng.random(len(pts))
    border_w = warp(border, wy, wx, pxm * 0.04)
    stone_top = smooth(border_w, pxm * 0.04, pxm * 0.16)
    stone_col = np.array([0.33, 0.335, 0.30])[None, None, :] * (0.85 + 0.25 * cell_r[cell])[..., None]
    stone_col = stone_col * (1 + 0.07 * mid + 0.06 * fine)[..., None]
    cover = warp(big, wy, wx, pxm * 0.4) * 0.8 + 0.4 * mid
    show = smooth(cover + (cell_r[cell] - 0.5) * 0.8, 0.55, 0.85) * stone_top
    col = soil * (1 - show[..., None]) + stone_col * show[..., None]
    height = 0.30 + 0.05 * mid + show * 0.30
    # moss cushions in broad drifts (they climb onto the stones' edges)
    dome, sid, sr = cushions(n, rng, pxm, 0.085)
    moss_mask = warp(mid, wy * 0.6, wx * 0.6, pxm * 0.2) * 0.55 + 0.7 * big + 0.15 + 0.25 * (1 - stone_top) * show
    moss = smooth(moss_mask + (dome - 0.5) * 0.5, 0.05, 0.45)
    deep = np.array([0.115, 0.16, 0.08])
    tip = np.array([0.33, 0.39, 0.16])
    mt = np.clip(dome * (0.55 + 0.35 * sr[sid]) + 0.12 * fine + 0.1, 0, 1)
    moss_col = deep[None, None, :] * (1 - mt[..., None]) + tip[None, None, :] * mt[..., None]
    moss_col *= (0.9 + 0.14 * sr[sid] + 0.1 * big)[..., None]
    col = col * (1 - moss[..., None]) + moss_col * moss[..., None]
    height = height * (1 - moss) + (0.42 + 0.42 * dome) * moss
    # leaf litter: fan leaves (the Dialwood's own) + a few almond leaves, mostly in the hollows; muted, dry
    palette = [(0.50, 0.38, 0.17), (0.46, 0.27, 0.13), (0.44, 0.38, 0.25), (0.36, 0.33, 0.18), (0.30, 0.33, 0.16),
               (0.52, 0.44, 0.24), (0.40, 0.24, 0.13)]
    canvas = col.copy()
    acc = np.zeros((n, n), np.float32)
    dark = np.zeros((n, n), np.float32)
    leaves = []
    nleaf = 640
    hollow = 1 - moss
    for _ in range(nleaf * 4):
        if len(leaves) >= nleaf:
            break
        x, y = rng.random() * n, rng.random() * n
        if rng.random() > 0.1 + 0.9 * hollow[int(y), int(x)] ** 1.5:
            continue
        size = pxm * (0.08 + 0.06 * rng.random())
        rot = rng.random() * math.tau
        colr = np.array(palette[rng.integers(len(palette))]) * (0.85 + 0.25 * rng.random())
        fn = fan_leaf(size, rot, colr, rng.random() * 3) if rng.random() < 0.85 else almond_leaf(size * 1.1, rot, colr)
        leaves.append((x, y, size, fn))
    for (x, y, size, fn) in leaves:
        shadow_stamp(dark, x, y, size, fn, 0, (size * 0.10, size * 0.14), n)
    dark = blur_wrap(dark, pxm * 0.012)
    canvas *= (1 - 0.35 * dark)[..., None]
    for (x, y, size, fn) in leaves:
        stamp(canvas, acc, height, x, y, size, fn, 0, 0.62, 0.2)
    for _ in range(50):
        x, y = rng.random() * n, rng.random() * n
        L = pxm * (0.12 + 0.2 * rng.random())
        fn = twig(L, rng.random() * math.tau, (0.19, 0.15, 0.11), (rng.random() - 0.5) * 0.3)
        stamp(canvas, acc, height, x, y, L, fn, 0, 0.66, 0.1)
    for _ in range(70):
        x, y = rng.random() * n, rng.random() * n
        s = pxm * (0.018 + 0.03 * rng.random())
        g = 0.33 + 0.1 * rng.random()
        fn = pebble(s, (g, g * 0.99, g * 0.93), rng)
        stamp(canvas, acc, height, x, y, s * 1.3, fn, 0, 0.5, 0.35)
    canvas *= (1 + 0.03 * fine)[..., None]
    canvas *= (1 + 0.04 * np.stack([big, 0.4 * big, -0.6 * big], -1))
    canvas = downsample(canvas.astype(np.float32), S)
    height = downsample(height.astype(np.float32), S)
    return canvas, height


def grain(N, seed=23):
    """honed stone grain, tile 3 m: quiet, neutral, granular, with pits and a few hairline cracks"""
    rng = np.random.default_rng(seed)
    S = 2
    n = N * S
    pxm = n / 3.0
    big = spectral_noise(n, rng, beta=3.0, fmin=1, fmax=8)
    mid = spectral_noise(n, rng, beta=2.0, fmin=6, fmax=80)
    fine = spectral_noise(n, rng, beta=0.6, fmin=80, fmax=n // 2)
    wy = spectral_noise(n, rng, beta=3.0, fmin=2, fmax=12)
    wx = spectral_noise(n, rng, beta=3.0, fmin=2, fmax=12)
    base = np.array([0.55, 0.545, 0.52])
    v = 1 + 0.05 * big + 0.035 * warp(mid, wy, wx, pxm * 0.03) + 0.035 * fine
    col = base[None, None, :] * v[..., None]
    # pale blooms (lime wash) and faint warm stain, broad and soft
    bloom = smooth(warp(mid, wy, wx, pxm * 0.05) * 0.6 + 0.8 * big, 0.9, 1.8)
    col = col * (1 - 0.30 * bloom[..., None]) + np.array([0.63, 0.62, 0.57]) * 0.30 * bloom[..., None]
    stain = smooth(-big + 0.3 * mid, 0.9, 1.8)
    col *= (1 - 0.06 * stain[..., None] * np.array([0.6, 1.0, 1.6]))
    height = 0.6 + 0.04 * big + 0.03 * mid + 0.03 * fine
    sp = rng.random((n, n))
    col *= (1 - 0.12 * (sp > 0.995))[..., None]
    col *= (1 + 0.08 * (sp < 0.005))[..., None]
    acc = np.zeros((n, n), np.float32)
    for _ in range(260):
        x, y = rng.random() * n, rng.random() * n
        s = pxm * (0.004 + 0.012 * rng.random() ** 2)

        def fn(X, Y, _, s=s):
            d = np.sqrt(X * X + Y * Y) / s
            cov = np.clip(1 - d, 0, 1)
            return np.broadcast_to(np.array([0.34, 0.33, 0.32])[None, None, :], cov.shape + (3,)), cov * 0.8, -np.ones_like(cov)
        stamp(col, acc, height, x, y, s + 2, fn, 0, 0.3, 0.0)
    rid = np.abs(warp(spectral_noise(n, rng, beta=2.6, fmin=2, fmax=24), wy, wx, pxm * 0.04))
    crack = (1 - smooth(rid, 0.0, 0.03)) * smooth(big + 0.6 * mid, 0.9, 1.6)
    col *= (1 - 0.28 * crack)[..., None]
    height -= 0.25 * crack
    col = downsample(col.astype(np.float32), S)
    height = downsample(height.astype(np.float32), S)
    return col, height


def moss(N, seed=37):
    """dense cushion moss, tile 4 m"""
    rng = np.random.default_rng(seed)
    S = 2
    n = N * S
    pxm = n / 4.0
    big = spectral_noise(n, rng, beta=3.0, fmin=1, fmax=8)
    mid = spectral_noise(n, rng, beta=2.2, fmin=5, fmax=50)
    fine = spectral_noise(n, rng, beta=1.2, fmin=60, fmax=n // 3)
    dome, sid, sr = cushions(n, rng, pxm, 0.1)
    deep = np.array([0.10, 0.15, 0.075])
    tip = np.array([0.35, 0.42, 0.17])
    yel = np.array([0.45, 0.45, 0.20])
    t = np.clip(dome * (0.6 + 0.45 * sr[sid]) + 0.1 * fine, 0, 1)
    col = deep[None, None, :] * (1 - t[..., None]) + tip[None, None, :] * t[..., None]
    ym = smooth(mid + 0.5 * big, 0.6, 1.5)
    col = col * (1 - 0.45 * ym[..., None] * t[..., None]) + yel * 0.45 * (ym * t)[..., None]
    col *= (0.85 + 0.25 * sr[sid] + 0.08 * big)[..., None]
    gaps = smooth(-(mid + 0.6 * big) + (0.5 - dome) * 0.6, 1.0, 1.6)
    col = col * (1 - gaps[..., None]) + np.array([0.20, 0.18, 0.15]) * gaps[..., None]
    height = (0.42 + 0.48 * dome) * (1 - gaps) + 0.25 * gaps
    acc = np.zeros((n, n), np.float32)
    for _ in range(36):
        x, y = rng.random() * n, rng.random() * n
        size = pxm * (0.07 + 0.04 * rng.random())
        colr = np.array([(0.50, 0.38, 0.17), (0.45, 0.27, 0.13), (0.42, 0.38, 0.24)][rng.integers(3)])
        stamp(col, acc, height, x, y, size, fan_leaf(size, rng.random() * math.tau, colr, rng.random() * 3), 0, 0.85, 0.1)
    col = downsample(col.astype(np.float32), S)
    height = downsample(height.astype(np.float32), S)
    return col, height


def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument('--out', default=os.path.join(here, '..', 'art', 'out', 'textures'))
    ap.add_argument('--size', type=int, default=1024)
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    only = set(x for x in a.only.split(',') if x)
    jobs = {'litter': litter, 'grain': grain, 'moss': moss}
    for name, fn in jobs.items():
        if only and name not in only:
            continue
        rgb, h = fn(a.size)
        save(os.path.join(a.out, f'terrain_{name}.webp'), rgb, h)


if __name__ == '__main__':
    main()
