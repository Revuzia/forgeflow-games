"""HIT PARADE - generated 2D textures for BUTCHER BLOCK + WHEEL OF PAIN (lane STAGES-A). Plain Python 3 + numpy + PIL.

  python art/stages/stagetex_a.py [butcher_block|wheel_of_pain|all] [--force]

Writes PNGs to _harness/scratch/stages_cache/tex_a/ (gitignored cache); the Blender builds (butcher_block.py,
wheel_of_pain.py) call this first and load the PNGs. Every texture here is ORIGINAL (procedural numpy + text set in the
game's own SIL-OFL fonts runtime/src/ui/fonts/*.woff2, loaded by PIL/FreeType). It fills the ENV_KIT section 2/3 gaps
(white subway tile, brushed stainless, cured-meat skins, end-grain butcher block, glossy black studio floor, prize-wheel
face, show labels, LED backdrop, trapdoor plate) with albedo + normal (OpenGL, +Y = image up) + roughness sets so the
procedural props meet the ENV_KIT section 8 material-parity bar. Also converts the Bungee woff2 to TTF (fontTools) for
Blender's 3D text. Deterministic (fixed seeds). ASCII only.
"""
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "_harness", "scratch", "stages_cache", "tex_a")
FONTS = os.path.join(ROOT, "runtime", "src", "ui", "fonts")
F_BUNGEE = os.path.join(FONTS, "bungee-latin-400.woff2")
F_RUSSO = os.path.join(FONTS, "russo-one-latin-400.woff2")
F_BEBAS = os.path.join(FONTS, "bebas-neue-latin-400.woff2")
FORCE = "--force" in sys.argv


# ------------------------------------------------------------------------------------------------ noise helpers
def vnoise(h, w, cy, cx, seed):
    """tileable value noise, cy x cx lattice, smoothstep interpolation -> [0,1] float32 (h, w)"""
    cy, cx = max(1, int(cy)), max(1, int(cx))
    g = np.random.default_rng(seed).random((cy, cx)).astype(np.float32)
    ys = np.arange(h, dtype=np.float32) / h * cy
    xs = np.arange(w, dtype=np.float32) / w * cx
    y0 = np.floor(ys).astype(int) % cy
    x0 = np.floor(xs).astype(int) % cx
    y1, x1 = (y0 + 1) % cy, (x0 + 1) % cx
    fy = ys - np.floor(ys)
    fx = xs - np.floor(xs)
    fy = fy * fy * (3 - 2 * fy)
    fx = fx * fx * (3 - 2 * fx)
    a = g[np.ix_(y0, x0)] * (1 - fx)[None, :] + g[np.ix_(y0, x1)] * fx[None, :]
    b = g[np.ix_(y1, x0)] * (1 - fx)[None, :] + g[np.ix_(y1, x1)] * fx[None, :]
    return a * (1 - fy)[:, None] + b * fy[:, None]


def fbm(h, w, base, octaves, seed, ay=1.0, ax=1.0, gain=0.5):
    s = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        c = base * (2 ** o)
        s += amp * vnoise(h, w, c * ay, c * ax, seed + 17 * o)
        tot += amp
        amp *= gain
    return s / tot


def hash01(ids, salt=0):
    v = np.sin(ids.astype(np.float64) * 12.9898 + salt * 78.233) * 43758.5453
    return (v - np.floor(v)).astype(np.float32)


def normal_from_height(hgt, strength):
    """tileable central differences -> RGB uint8 OpenGL normal map (+Y = image up)"""
    dx = (np.roll(hgt, -1, 1) - np.roll(hgt, 1, 1)) * 0.5
    dy = (np.roll(hgt, -1, 0) - np.roll(hgt, 1, 0)) * 0.5
    nx, ny = -dx * strength, dy * strength
    nz = np.ones_like(hgt)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    n = np.stack([nx / ln, ny / ln, nz / ln], -1)
    return (np.clip(n * 0.5 + 0.5, 0, 1) * 255 + 0.5).astype(np.uint8)


def to8(a):
    return (np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)


def save_rgb(name, arr):
    p = os.path.join(OUT, name + ".png")
    Image.fromarray(to8(arr) if arr.dtype != np.uint8 else arr, "RGB").save(p, optimize=True)
    return p


def save_rgba(name, img):
    p = os.path.join(OUT, name + ".png")
    img.save(p, optimize=True)
    return p


def save_grey(name, arr):
    p = os.path.join(OUT, name + ".png")
    g = to8(arr)
    Image.fromarray(np.stack([g, g, g], -1), "RGB").save(p, optimize=True)
    return p


def done(*names):
    return (not FORCE) and all(os.path.exists(os.path.join(OUT, n + ".png")) for n in names)


def scratch_layer(S, n, seed, lmin, lmax, width=1, angle=None, alpha=(40, 140)):
    """random thin scratches as a float (S,S) mask (tileable-ish: drawn on a 3x canvas and wrapped)"""
    rng = np.random.default_rng(seed)
    im = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(im)
    for _ in range(n):
        x, y = rng.random() * S, rng.random() * S
        ln = lmin + rng.random() * (lmax - lmin)
        a = (angle if angle is not None else rng.random() * math.pi) + (rng.random() - 0.5) * 0.25
        x2, y2 = x + math.cos(a) * ln, y + math.sin(a) * ln
        v = int(alpha[0] + rng.random() * (alpha[1] - alpha[0]))
        for ox in (-S, 0, S):
            for oy in (-S, 0, S):
                d.line([(x + ox, y + oy), (x2 + ox, y2 + oy)], fill=v, width=width)
    return np.asarray(im, np.float32) / 255.0


def font(path, size):
    return ImageFont.truetype(path, size)


def fit_font(path, text, max_w, max_h, start=200, stroke=0):
    s = start
    while s > 8:
        f = font(path, s)
        b = f.getbbox(text, stroke_width=stroke)
        if b[2] - b[0] <= max_w and b[3] - b[1] <= max_h:
            return f
        s -= 2
    return font(path, 8)


def text_img(text, fnt, fill, stroke=0, stroke_fill=None, pad=8):
    b = fnt.getbbox(text, stroke_width=stroke)
    w, h = b[2] - b[0] + 2 * pad, b[3] - b[1] + 2 * pad
    im = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(im).text((pad - b[0], pad - b[1]), text, font=fnt, fill=fill, stroke_width=stroke,
                            stroke_fill=stroke_fill)
    return im


def paste_center(dst, im, cx, cy):
    dst.alpha_composite(im, (int(round(cx - im.width / 2)), int(round(cy - im.height / 2))))


def hexc(h, a=255):
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


def glow(im, radius, gain=1.0):
    """soft glow halo behind an RGBA layer (neon / bulb look)"""
    g = im.filter(ImageFilter.GaussianBlur(radius))
    if gain != 1.0:
        a = np.asarray(g, np.float32)
        a[..., 3] = np.clip(a[..., 3] * gain, 0, 255)
        g = Image.fromarray(a.astype(np.uint8), "RGBA")
    out = Image.new("RGBA", im.size, (0, 0, 0, 0))
    out.alpha_composite(g)
    out.alpha_composite(im)
    return out


# ------------------------------------------------------------------------------------------------ shared materials
def gen_tile(prefix, S=1024, cols=8, rows=16, grout=5.0, bevel=8.0, seed=11, base=(0.93, 0.925, 0.89),
             band=None, tint=0.03):
    """subway tile, running bond. cols x rows tiles per texture (8 x 16 over 1.2 m = 150 x 75 mm tiles).
    band = optional alternate glaze colour (writes <prefix>_band_a with the same layout)."""
    names = [prefix + "_a", prefix + "_n", prefix + "_r"] + ([prefix + "_band_a"] if band else [])
    if done(*names):
        return
    tw, th = S / cols, S / rows
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32) + 0.5
    row = np.floor(yy / th).astype(int)
    xs = (xx + (row % 2) * 0.5 * tw) % S
    col = np.floor(xs / tw).astype(int) % cols
    lx, ly = xs - col * tw, yy - row * th
    d = np.minimum(np.minimum(lx, tw - lx), np.minimum(ly, th - ly)) - grout * 0.5
    t = np.clip(d / bevel, 0, 1)
    tile = d > 0
    prof = np.where(tile, np.sqrt(1 - (1 - t) ** 2), 0.0).astype(np.float32)
    tid = row * 131 + col
    r1, r2, r3 = hash01(tid, 1), hash01(tid, 2), hash01(tid, 3)
    wav = fbm(S, S, 6, 3, seed + 1) - 0.5                      # glaze waviness
    hgt = prof * (0.9 + 0.1 * r3) + tile * wav * 0.12
    grime = fbm(S, S, 3, 5, seed + 2)
    stain = np.clip((grime - 0.58) / 0.2, 0, 1)
    speck = (vnoise(S, S, 256, 256, seed + 3) > 0.93).astype(np.float32) * 0.5
    ao = 0.82 + 0.18 * t

    def albedo(bc):
        bc = np.array(bc, np.float32)
        warm = np.array([1.012, 1.0, 0.975], np.float32)
        cool = np.array([0.985, 0.995, 1.012], np.float32)
        mixc = warm[None, None, :] * r2[..., None] + cool[None, None, :] * (1 - r2[..., None])
        c = bc[None, None, :] * mixc * (1 + tint * (r1[..., None] - 0.5) * 2)
        c = c * (1 - 0.05 * (wav[..., None] + 0.5))
        dirt = np.array([0.55, 0.47, 0.36], np.float32)
        c = c * (1 - 0.16 * stain[..., None]) + dirt * 0.16 * stain[..., None] * 0.6
        c = c * ao[..., None]
        grc = np.array([0.60, 0.58, 0.54], np.float32) * (0.82 + 0.25 * grime[..., None]) * (1 - 0.35 * stain[..., None])
        c = np.where(tile[..., None], c, grc)
        c = c * (1 - speck[..., None] * 0.25)
        return c

    save_rgb(prefix + "_a", albedo(base))
    if band:
        save_rgb(prefix + "_band_a", albedo(band))
    save_rgb(prefix + "_n", normal_from_height(hgt.astype(np.float32), 5.0))
    smudge = fbm(S, S, 5, 4, seed + 4)
    rough = np.where(tile, 0.10 + 0.14 * smudge + 0.15 * stain, 0.86 + 0.08 * grime)
    save_grey(prefix + "_r", rough)
    print("tile", prefix)


def gen_brushed(prefix, S=1024, seed=21, base=0.64, amp=0.07, rough=0.30, rough_amp=0.14, scratches=260,
                dents=True):
    if done(prefix + "_a", prefix + "_n", prefix + "_r"):
        return
    rng = np.random.default_rng(seed)
    rowline = rng.random(S).astype(np.float32)[:, None] * np.ones((1, S), np.float32)
    rowline = rowline * 0.6 + 0.4 * np.roll(rowline, 1, 0)
    streak = (0.45 * vnoise(S, S, 512, 3, seed + 1) + 0.30 * vnoise(S, S, 256, 2, seed + 2) + 0.25 * rowline)
    smudge = fbm(S, S, 3, 5, seed + 3)
    scr = scratch_layer(S, scratches, seed + 4, S * 0.02, S * 0.12, 1, angle=None, alpha=(30, 110))
    hgt = streak * 0.6 + scr * 0.4
    if dents:
        hgt = hgt + 0.8 * (fbm(S, S, 4, 3, seed + 5) - 0.5)
    alb = base + (streak - 0.5) * amp - 0.05 * (smudge - 0.5) + scr * 0.06
    save_rgb(prefix + "_a", np.stack([alb * 0.985, alb * 0.995, alb * 1.01], -1))
    save_rgb(prefix + "_n", normal_from_height(hgt.astype(np.float32), 1.6))
    save_grey(prefix + "_r", rough + (streak - 0.5) * rough_amp + 0.16 * np.clip(smudge - 0.45, 0, 1) - 0.08 * scr)
    print("brushed", prefix)


def gen_paint(prefix, color, S=512, seed=31, rough=0.32, wear=0.35, base_metal=0.55):
    """lacquered panel: orange-peel normal, chips/scratches to bare metal, roughness break-up"""
    if done(prefix + "_a", prefix + "_n", prefix + "_r"):
        return
    c = np.array(color, np.float32)
    peel = fbm(S, S, 40, 2, seed)
    var = fbm(S, S, 3, 4, seed + 1)
    scr = scratch_layer(S, 45, seed + 2, S * 0.01, S * 0.06, 1, alpha=(30, 110))
    chips = np.clip((fbm(S, S, 6, 4, seed + 3) - (1 - wear * 0.3)) / 0.05, 0, 1)
    metal = np.clip(scr * 0.8 + chips, 0, 1)
    alb = c[None, None, :] * (0.92 + 0.12 * var[..., None])
    alb = alb * (1 - metal[..., None]) + base_metal * metal[..., None]
    save_rgb(prefix + "_a", alb)
    save_rgb(prefix + "_n", normal_from_height((peel * 0.35 - chips * 0.8 - scr * 0.3).astype(np.float32), 2.0))
    save_grey(prefix + "_r", rough + 0.1 * (var - 0.5) + metal * 0.25)
    print("paint", prefix)


# ------------------------------------------------------------------------------------------------ BUTCHER BLOCK
def gen_ham(S=512, seed=41):
    """comic glazed ham: roast mottling, twine netting (diamond) with the skin pillowing between strings.
    UV: u around the ham (wraps), v along it."""
    if done("bb_ham_a", "bb_ham_n", "bb_ham_r"):
        return
    v, u = np.mgrid[0:S, 0:S].astype(np.float32) / S
    N, M = 9, 7
    a = (u * N + v * M) % 1.0
    b = (u * N - v * M) % 1.0
    da = np.minimum(a, 1 - a)
    db = np.minimum(b, 1 - b)
    dmin = np.minimum(da, db)
    wline = 0.045
    twine = np.clip(1 - dmin / wline, 0, 1)
    twine = np.clip(twine * 1.8, 0, 1)
    pillow = np.clip(dmin / 0.25, 0, 1) ** 0.6
    mott = fbm(S, S, 5, 5, seed)
    roast = fbm(S, S, 3, 3, seed + 1)
    skin_a = np.array([0.83, 0.44, 0.28], np.float32)
    skin_b = np.array([0.58, 0.22, 0.10], np.float32)
    k = np.clip(roast * 0.8 + (1 - pillow) * 0.45 + (mott - 0.5) * 0.6, 0, 1)[..., None]
    skin = skin_a * (1 - k) + skin_b * k
    tw = np.array([0.90, 0.82, 0.66], np.float32) * (0.85 + 0.15 * vnoise(S, S, 128, 128, seed + 2))[..., None]
    alb = skin * (1 - twine[..., None]) + tw * twine[..., None]
    fib = vnoise(S, S, 256, 64, seed + 3)
    hgt = pillow * 0.8 + twine * 0.9 + (mott - 0.5) * 0.25 + twine * (fib - 0.5) * 0.4
    save_rgb("bb_ham_a", alb)
    save_rgb("bb_ham_n", normal_from_height(hgt.astype(np.float32), 7.0))
    save_grey("bb_ham_r", 0.28 + 0.12 * mott + twine * 0.5)
    print("ham")


def gen_sausage(S=512, seed=51):
    if done("bb_sausage_a", "bb_sausage_n", "bb_sausage_r"):
        return
    mott = fbm(S, S, 6, 5, seed)
    wr = fbm(S, S, 24, 3, seed + 1, ay=1.0, ax=0.35)
    c1 = np.array([0.66, 0.24, 0.12], np.float32)
    c2 = np.array([0.42, 0.12, 0.06], np.float32)
    k = np.clip(mott * 1.2 - 0.1, 0, 1)[..., None]
    alb = c1 * (1 - k) + c2 * k
    alb = alb * (0.92 + 0.12 * wr[..., None])
    save_rgb("bb_sausage_a", alb)
    save_rgb("bb_sausage_n", normal_from_height((wr * 0.9 + mott * 0.2).astype(np.float32), 4.0))
    save_grey("bb_sausage_r", 0.30 + 0.18 * (1 - wr))
    print("sausage")


def gen_salami(S=512, seed=61):
    if done("bb_salami_a", "bb_salami_n", "bb_salami_r"):
        return
    rng = np.random.default_rng(seed)
    im = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(im)
    for _ in range(520):
        x, y = rng.random() * S, rng.random() * S
        r = 2 + rng.random() * 5
        for ox in (-S, 0, S):
            for oy in (-S, 0, S):
                d.ellipse([x + ox - r, y + oy - r * 0.7, x + ox + r, y + oy + r * 0.7], fill=255)
    fat = np.asarray(im.filter(ImageFilter.GaussianBlur(0.8)), np.float32) / 255.0
    bloom = fbm(S, S, 4, 5, seed + 1)
    meat = np.array([0.46, 0.10, 0.09], np.float32)
    fatc = np.array([0.92, 0.84, 0.76], np.float32)
    dust = np.array([0.80, 0.74, 0.72], np.float32)
    alb = meat * (1 - fat[..., None] * 0.55) + fatc * fat[..., None] * 0.55
    bl = np.clip((bloom - 0.45) / 0.3, 0, 1)[..., None] * 0.55
    alb = alb * (1 - bl) + dust * bl
    wr = fbm(S, S, 16, 3, seed + 2)
    save_rgb("bb_salami_a", alb)
    save_rgb("bb_salami_n", normal_from_height((wr * 0.8 + fat * 0.3).astype(np.float32), 4.0))
    save_grey("bb_salami_r", 0.55 + 0.3 * bl[..., 0] - 0.1 * fat)
    print("salami")


def gen_endgrain(S=1024, seed=71, squares=16):
    """end-grain butcher block: glued squares of rings, glue lines, knife marks"""
    if done("bb_block_a", "bb_block_n", "bb_block_r"):
        return
    ts = S / squares
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32) + 0.5
    ci, cj = np.floor(xx / ts).astype(int), np.floor(yy / ts).astype(int)
    sid = cj * 97 + ci
    ox = hash01(sid, 4) * 3 - 1.0
    oy = hash01(sid, 5) * 3 - 1.0
    lx, ly = xx / ts - ci, yy / ts - cj
    r = np.sqrt((lx - ox) ** 2 + (ly - oy) ** 2)
    n = fbm(S, S, 16, 3, seed)
    rings = 0.5 + 0.5 * np.sin((r * 26 + n * 3.0) * 2 * math.pi / 2)
    light = np.array([0.80, 0.62, 0.40], np.float32)
    dark = np.array([0.56, 0.38, 0.22], np.float32)
    tint = (0.9 + 0.2 * hash01(sid, 6))[..., None]
    k = (rings ** 1.5)[..., None]
    alb = (light * (1 - k * 0.55) + dark * k * 0.55) * tint
    edge = np.minimum(np.minimum(lx, 1 - lx), np.minimum(ly, 1 - ly))
    glue = np.clip(1 - edge / 0.025, 0, 1)
    alb = alb * (1 - glue[..., None] * 0.45)
    cuts = scratch_layer(S, 700, seed + 1, S * 0.01, S * 0.05, 1, alpha=(80, 220))
    alb = alb * (1 - cuts[..., None] * 0.28)
    stain = np.clip((fbm(S, S, 3, 4, seed + 2) - 0.55) / 0.25, 0, 1)[..., None]
    alb = alb * (1 - stain * 0.22)
    hgt = rings * 0.15 - glue * 0.6 - cuts * 0.7 + hash01(sid, 7) * 0.2
    save_rgb("bb_block_a", alb)
    save_rgb("bb_block_n", normal_from_height(hgt.astype(np.float32), 3.0))
    save_grey("bb_block_r", 0.62 + 0.18 * cuts + 0.1 * rings)
    print("endgrain")


def gen_bb_labels(S=1024):
    """one atlas for every small printed / lit label of the butcher set (rects listed in BB_LABEL_RECTS)"""
    if done("bb_labels"):
        return
    im = Image.new("RGBA", (S, S), (0, 0, 0, 255))
    d = ImageDraw.Draw(im)
    # (0,0,1024,256) counter logo plate: cream on show red, cleaver-tick frame
    d.rectangle([0, 0, 1023, 255], fill=hexc("#b3121f"))
    d.rectangle([10, 10, 1013, 245], outline=hexc("#f7e7c6"), width=6)
    f = fit_font(F_BUNGEE, "BUTCHER BLOCK", 900, 150, stroke=6)
    paste_center(im, text_img("BUTCHER BLOCK", f, hexc("#f7e7c6"), 6, hexc("#3b0508")), 512, 128)
    # (0,256,512,384) FREEZER door sign (white enamel, blue letters)
    d.rectangle([0, 256, 511, 383], fill=hexc("#eef2f6"))
    d.rectangle([6, 262, 505, 377], outline=hexc("#1c4fa0"), width=5)
    f = fit_font(F_BUNGEE, "FREEZER", 460, 90)
    paste_center(im, text_img("FREEZER", f, hexc("#1c4fa0")), 256, 320)
    # (512,256,1024,384) KEEP DOOR CLOSED stencil (yellow on black)
    hz = Image.new("RGBA", (512, 128), hexc("#f4c21a"))
    dz = ImageDraw.Draw(hz)
    for k in range(-4, 16):
        x = k * 36
        dz.polygon([(x, 127), (x + 18, 127), (x + 18 + 40, 0), (x + 40, 0)], fill=hexc("#16130f"))
    im.alpha_composite(hz, (512, 256))
    d.rectangle([540, 276, 995, 363], fill=hexc("#f4c21a"))
    f = fit_font(F_BEBAS, "KEEP DOOR CLOSED", 430, 80)
    paste_center(im, text_img("KEEP DOOR CLOSED", f, hexc("#16130f")), 768, 320)
    # (0,384,512,512) MEAT LOCKER sign (red enamel)
    d.rectangle([0, 384, 511, 511], fill=hexc("#c01824"))
    d.rectangle([6, 390, 505, 505], outline=hexc("#ffffff"), width=5)
    f = fit_font(F_BUNGEE, "MEAT LOCKER", 460, 80)
    paste_center(im, text_img("MEAT LOCKER", f, hexc("#ffffff")), 256, 448)
    # (512,384,768,640) thermometer dial face (256x256)
    cx, cy, R = 640, 512, 118
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=hexc("#f3f1ea"), outline=hexc("#222222"), width=5)
    for k in range(0, 13):
        a = math.radians(225 - k * 22.5)
        r0, r1 = (R - 10, R - 30) if k % 3 == 0 else (R - 10, R - 22)
        d.line([(cx + r0 * math.cos(a), cy - r0 * math.sin(a)), (cx + r1 * math.cos(a), cy - r1 * math.sin(a))],
               fill=hexc("#222222"), width=4 if k % 3 == 0 else 2)
    d.pieslice([cx - R + 34, cy - R + 34, cx + R - 34, cy + R - 34], 180 + 45, 180 + 110, fill=hexc("#3f8fe0"))
    f = font(F_RUSSO, 40)
    paste_center(im, text_img("-18", f, hexc("#1c4fa0")), cx, cy + 52)
    a = math.radians(225 - 1.2 * 22.5)
    d.line([(cx, cy), (cx + (R - 26) * math.cos(a), cy - (R - 26) * math.sin(a))], fill=hexc("#c01824"), width=6)
    d.ellipse([cx - 10, cy - 10, cx + 10, cy + 10], fill=hexc("#222222"))
    # (768,384,1024,640) wall clock face: show stopwatch "COOK TIME"
    cx, cy, R = 896, 512, 118
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=hexc("#fbfaf5"), outline=hexc("#b3121f"), width=8)
    for k in range(60):
        a = math.radians(90 - k * 6)
        r0, r1 = (R - 12, R - 30) if k % 5 == 0 else (R - 12, R - 20)
        d.line([(cx + r0 * math.cos(a), cy - r0 * math.sin(a)), (cx + r1 * math.cos(a), cy - r1 * math.sin(a))],
               fill=hexc("#1a1a1a"), width=4 if k % 5 == 0 else 1)
    f = font(F_BEBAS, 30)
    paste_center(im, text_img("COOK TIME", f, hexc("#b3121f")), cx, cy + 40)
    for ang, ln, w in ((90 - 6 * 42, R - 36, 5), (90 - 6 * 9, R - 58, 8)):
        a = math.radians(ang)
        d.line([(cx, cy), (cx + ln * math.cos(a), cy - ln * math.sin(a))], fill=hexc("#1a1a1a"), width=w)
    d.ellipse([cx - 9, cy - 9, cx + 9, cy + 9], fill=hexc("#b3121f"))
    # (0,512,512,640) HOT! warning (flame icon + text) for the range fronts
    d.rectangle([0, 512, 511, 639], fill=hexc("#16130f"))
    f = fit_font(F_BUNGEE, "CAUTION HOT", 460, 70)
    paste_center(im, text_img("CAUTION HOT", f, hexc("#ff8a1c")), 256, 576)
    # (0,640,1024,1024) the SHOW SIGN face (lit): big logo, 1024x384
    y0 = 640
    d.rectangle([0, y0, 1023, 1023], fill=hexc("#120608"))
    lay = Image.new("RGBA", (1024, 384), (0, 0, 0, 0))
    f1 = fit_font(F_BUNGEE, "BUTCHER", 900, 150, stroke=4)
    f2 = fit_font(F_BUNGEE, "BLOCK", 700, 150, stroke=4)
    t1 = text_img("BUTCHER", f1, hexc("#fff3d6"), 4, hexc("#ff3a3a"))
    t2 = text_img("BLOCK", f2, hexc("#fff3d6"), 4, hexc("#ff3a3a"))
    paste_center(lay, t1, 512, 110)
    paste_center(lay, t2, 512, 270)
    lay = glow(lay, 10, 1.8)
    im.alpha_composite(lay, (0, y0))
    d.rectangle([4, y0 + 4, 1019, 1019], outline=hexc("#ff3a3a"), width=6)
    im.convert("RGB").save(os.path.join(OUT, "bb_labels.png"), optimize=True)
    print("bb_labels")


# ------------------------------------------------------------------------------------------------ WHEEL OF PAIN
WHEEL_SEGMENTS = [
    ("JACKPOT", "#f2c230", "#2a1204"), ("PIE IN THE FACE", "#e8202a", None), ("DOUBLE PAIN", "#1f5fe0", None),
    ("SPIN AGAIN", "#19b34a", None), ("RUBBER CHICKEN", "#e0288f", None), ("BANKRUPT", "#141216", None),
    ("FREE HIT", "#ff7a12", None), ("BANANA PEEL", "#12b8d6", None), ("WHOOPEE", "#7a2fd0", None),
    ("MYSTERY BOX", "#e8202a", None), ("CONFETTI", "#ffc414", "#2a1204"), ("SLAP 500", "#1f5fe0", None),
    ("BONUS BRUISE", "#19b34a", None), ("FOAM HAND", "#e0288f", None), ("TRY AGAIN", "#ff7a12", None),
    ("TICKLE TIME", "#12b8d6", None),
]


def gen_wheel_face(S=2048):
    """prize-wheel face, planar UV (u = 0.5 + x/2R, v = 0.5 + y/2R): 16 segments, radial comic prize labels"""
    if done("wp_wheel_a", "wp_wheel_n", "wp_wheel_r"):
        return
    n = len(WHEEL_SEGMENTS)
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32) + 0.5
    X, Y = (xx - S / 2) / (S / 2), (S / 2 - yy) / (S / 2)
    R = np.sqrt(X * X + Y * Y)
    A = (np.degrees(np.arctan2(Y, X)) % 360.0)
    seg = np.floor(A / (360.0 / n)).astype(int) % n
    cols = np.array([[int(c[1][1:3], 16), int(c[1][3:5], 16), int(c[1][5:7], 16)] for c in WHEEL_SEGMENTS],
                    np.float32) / 255.0
    base = cols[seg]
    shade = (0.78 + 0.30 * np.clip(R, 0, 1))[..., None]       # lighter toward the rim
    grain = fbm(S, S, 8, 4, 91)[..., None]
    img = base * shade * (0.94 + 0.08 * grain)
    img = np.clip(img, 0, 1)
    im = Image.fromarray(to8(img), "RGB").convert("RGBA")
    d = ImageDraw.Draw(im)
    # gold divider lines + inner/outer rings (the 3D pegs + dividers sit on them)
    for k in range(n):
        a = math.radians(k * 360.0 / n)
        d.line([(S / 2 + 0.16 * S / 2 * math.cos(a), S / 2 - 0.16 * S / 2 * math.sin(a)),
                (S / 2 + S / 2 * math.cos(a), S / 2 - S / 2 * math.sin(a))], fill=hexc("#f3d27a"), width=10)
    for rr, w in ((0.985, 14), (0.84, 6), (0.30, 8)):
        r = rr * S / 2
        d.ellipse([S / 2 - r, S / 2 - r, S / 2 + r, S / 2 + r], outline=hexc("#f3d27a"), width=w)
    # labels (radial, reading outward) + a star per segment at the rim band
    for k, (label, colr, ink) in enumerate(WHEEL_SEGMENTS):
        ac = (k + 0.5) * 360.0 / n
        fill = hexc(ink) if ink else hexc("#ffffff")
        stroke = hexc("#ffffff") if ink else hexc("#1a0f1c")
        f = fit_font(F_BUNGEE, label, int(0.50 * S / 2), int(0.105 * S / 2), start=120, stroke=5)
        t = text_img(label, f, fill, 5, stroke, pad=10).rotate(ac, resample=Image.BICUBIC, expand=True)
        r = 0.575 * S / 2
        paste_center(im, t, S / 2 + r * math.cos(math.radians(ac)), S / 2 - r * math.sin(math.radians(ac)))
        r2 = 0.915 * S / 2
        sx, sy = S / 2 + r2 * math.cos(math.radians(ac)), S / 2 - r2 * math.sin(math.radians(ac))
        pts = []
        for j in range(10):
            rr = 34 if j % 2 == 0 else 14
            aa = math.radians(ac + 90 + j * 36)
            pts.append((sx + rr * math.cos(aa), sy - rr * math.sin(aa)))
        d.polygon(pts, fill=hexc("#fff6d0"), outline=hexc("#1a0f1c"))
    arr = np.asarray(im.convert("RGB"), np.float32) / 255.0
    save_rgb("wp_wheel_a", arr)
    # normal: slight bevel at dividers and rings (embossed gold lines), lacquer peel
    lum = arr[..., 0] * 0.3 + arr[..., 1] * 0.59 + arr[..., 2] * 0.11
    gold = np.clip(1 - np.abs(arr[..., 0] - 0.953) * 8 - np.abs(arr[..., 1] - 0.824) * 8 - np.abs(arr[..., 2] - 0.478) * 6, 0, 1)
    hgt = gold * 0.8 + fbm(S, S, 60, 2, 92) * 0.15
    img_h = Image.fromarray(to8(hgt)).filter(ImageFilter.GaussianBlur(1.5))
    save_rgb("wp_wheel_n", normal_from_height(np.asarray(img_h, np.float32) / 255.0, 3.0))
    save_grey("wp_wheel_r", 0.26 + 0.08 * fbm(S, S, 5, 3, 93) - gold * 0.08 + (lum < 0.1) * 0.1)
    print("wheel face")


def gen_wp_floor(S=1024, seed=101):
    """glossy black studio floor, 1.2 m panels (texture = 2.4 m), bevelled seams, scuffs"""
    if done("wp_floor_a", "wp_floor_n", "wp_floor_r"):
        return
    P = S // 2
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32) + 0.5
    pi, pj = np.floor(xx / P).astype(int), np.floor(yy / P).astype(int)
    lx, ly = xx - pi * P, yy - pj * P
    d = np.minimum(np.minimum(lx, P - lx), np.minimum(ly, P - ly)) - 1.5
    t = np.clip(d / 4.0, 0, 1)
    pid = pj * 7 + pi
    big = fbm(S, S, 2, 3, seed)
    alb = (0.018 + 0.006 * hash01(pid, 1) + 0.006 * big) * np.ones((S, S), np.float32)
    alb = np.where(d < 0, 0.004, alb)
    swirl = fbm(S, S, 6, 5, seed + 1, ay=1.0, ax=1.0)
    scuff = scratch_layer(S, 380, seed + 2, S * 0.01, S * 0.07, 1, alpha=(20, 90))
    rgb = np.stack([alb * 0.96, alb * 0.96, alb * 1.12], -1) + scuff[..., None] * 0.018
    save_rgb("wp_floor_a", rgb)
    hgt = np.sqrt(1 - (1 - t) ** 2) + (swirl - 0.5) * 0.02
    save_rgb("wp_floor_n", normal_from_height(hgt.astype(np.float32), 4.0))
    save_grey("wp_floor_r", np.where(d < 0, 0.6, 0.07 + 0.08 * np.clip(swirl - 0.4, 0, 1) + scuff * 0.22))
    print("wp floor")


def gen_wp_labels(S=1024):
    """lit show labels atlas (rects listed in WP_LABEL_RECTS in wheel_of_pain.py)"""
    if done("wp_labels"):
        return
    im = Image.new("RGBA", (S, S), (0, 0, 0, 255))
    d = ImageDraw.Draw(im)

    def board(y0, text, bg, fg, edge):
        d.rectangle([0, y0, 1023, y0 + 255], fill=hexc(bg))
        # dot-matrix backing
        for yy in range(y0 + 14, y0 + 250, 14):
            for xx in range(12, 1020, 14):
                d.ellipse([xx - 3, yy - 3, xx + 3, yy + 3], fill=(255, 255, 255, 18))
        lay = Image.new("RGBA", (1024, 256), (0, 0, 0, 0))
        f = fit_font(F_BUNGEE, text, 900, 170, stroke=5)
        paste_center(lay, text_img(text, f, hexc(fg), 5, hexc(edge)), 512, 128)
        lay = glow(lay, 12, 1.6)
        im.alpha_composite(lay, (0, y0))
        d.rectangle([5, y0 + 5, 1018, y0 + 250], outline=hexc(edge), width=8)

    board(0, "PLAYER 1", "#0b1460", "#fff27a", "#3fd8ff")
    board(256, "PLAYER 2", "#3e0848", "#fff27a", "#ff4fd8")
    board(512, "WHEEL OF PAIN", "#1a0620", "#ffe066", "#ff2d6f")
    # (0,768,512,1024) APPLAUSE light box, (512,768,1024,1024) ON AIR
    for x0, text, bg, fg in ((0, "APPLAUSE", "#b0101c", "#fff7ea"), (512, "ON AIR", "#d0101c", "#fff7ea")):
        d.rectangle([x0, 768, x0 + 511, 1023], fill=hexc(bg))
        lay = Image.new("RGBA", (512, 256), (0, 0, 0, 0))
        f = fit_font(F_BUNGEE, text, 440, 130, stroke=3)
        paste_center(lay, text_img(text, f, hexc(fg), 3, hexc("#5a0008")), 256, 128)
        im.alpha_composite(glow(lay, 8, 1.4), (x0, 768))
        d.rectangle([x0 + 6, 774, x0 + 505, 1017], outline=hexc("#fff7ea"), width=6)
    im.convert("RGB").save(os.path.join(OUT, "wp_labels.png"), optimize=True)
    print("wp_labels")


def gen_wp_led(W=2048, H=1024, seed=111, Wm=36.0, Hm=12.7, cyM=3.7, haloM=4.1):
    """LED backdrop (whole wall Wm x Hm metres, bottom at the deck): starburst rays centred at height cyM (where the
    wheel hub projects onto the wall from the game camera), magenta->violet->blue, a halo ring of radius haloM just
    outside the wheel rim, LED pixel grid at 0.15 m pitch. Computed in metres so rays / dots stay square."""
    if done("wp_led"):
        return
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32) + 0.5
    X = xx / W * Wm - Wm / 2
    Y = Hm * (1 - yy / H) - cyM
    R = np.sqrt(X * X + Y * Y) / Hm
    A = np.arctan2(Y, X)
    rays = 0.5 + 0.5 * np.sign(np.sin(A * 12))
    grad_t = np.clip(R / 1.1, 0, 1)
    c0 = np.array([1.0, 0.25, 0.62], np.float32)
    c1 = np.array([0.52, 0.16, 0.95], np.float32)
    c2 = np.array([0.05, 0.10, 0.45], np.float32)
    t = grad_t[..., None]
    col = np.where(t < 0.5, c0 * (1 - t * 2) + c1 * (t * 2), c1 * (1 - (t - 0.5) * 2) + c2 * ((t - 0.5) * 2))
    col = col * (0.55 + 0.45 * rays[..., None]) * (1.0 - 0.55 * grad_t[..., None])
    halo = np.exp(-((R - haloM / Hm) / 0.03) ** 2)[..., None] * np.array([1.0, 0.85, 0.5], np.float32) * 0.9
    col = col + halo
    # LED pixel grid (pitch 0.15 m): round dots, dark gaps
    p = 0.15
    gx = (((X + Wm) % p) / p - 0.5) * 2
    gy = (((Y + Hm) % p) / p - 0.5) * 2
    dot = np.clip(1.2 - np.sqrt(gx * gx + gy * gy) * 1.25, 0, 1)
    col = col * (0.12 + 0.88 * dot[..., None])
    # a few dead / hot pixels for realism
    cellid = (np.floor((Y + Hm) / p) * 1000 + np.floor((X + Wm) / p)).astype(np.int64)
    dead = (hash01(cellid, 9) > 0.997)[..., None]
    col = np.where(dead, col * 0.1, col)
    save_rgb("wp_led", np.clip(col, 0, 1))
    print("wp led")


def gen_trapdoor(S=512, seed=121):
    """flush show trapdoor plate: diamond tread plate centre, hazard-stripe border, stencil"""
    if done("wp_trap_a", "wp_trap_n", "wp_trap_r"):
        return
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32) + 0.5
    # diamond plate bumps
    p = 32.0
    u, v = (xx % p) / p - 0.5, (yy % p) / p - 0.5
    u2, v2 = ((xx + p / 2) % p) / p - 0.5, ((yy + p / 2) % p) / p - 0.5
    def lozenge(a, b, rot):
        c, s = math.cos(rot), math.sin(rot)
        ra, rb = a * c - b * s, a * s + b * c
        return np.clip(1 - np.sqrt((ra / 0.36) ** 2 + (rb / 0.09) ** 2), 0, 1)
    bumps = np.maximum(lozenge(u, v, math.radians(45)), lozenge(u2, v2, math.radians(-45)))
    steel = 0.46 + 0.06 * fbm(S, S, 6, 4, seed)
    alb = np.stack([steel, steel, steel * 1.02], -1) + bumps[..., None] * 0.06
    border = 60
    edge = np.minimum(np.minimum(xx, S - xx), np.minimum(yy, S - yy))
    inb = edge < border
    stripe = (((xx + yy) // 34) % 2).astype(bool)
    yel = np.array([0.95, 0.72, 0.06], np.float32)
    blk = np.array([0.04, 0.035, 0.03], np.float32)
    hz = np.where(stripe[..., None], yel, blk)
    wear = fbm(S, S, 8, 4, seed + 1)
    hz = hz * (0.85 + 0.2 * wear[..., None])
    alb = np.where(inb[..., None], hz, alb)
    seam = edge < 4
    alb = np.where(seam[..., None], 0.02, alb)
    im = Image.fromarray(to8(alb), "RGB").convert("RGBA")
    f = fit_font(F_BEBAS, "TRAPDOOR - STAND CLEAR", 330, 44)
    t = text_img("TRAPDOOR - STAND CLEAR", f, (245, 196, 20, 235))
    im.alpha_composite(t, (int(S / 2 - t.width / 2), int(S - border - t.height - 18)))
    arr = np.asarray(im.convert("RGB"), np.float32) / 255.0
    save_rgb("wp_trap_a", arr)
    hgt = np.where(inb, 0.2, bumps * 0.8) - seam * 1.0
    save_rgb("wp_trap_n", normal_from_height(hgt.astype(np.float32), 6.0))
    save_grey("wp_trap_r", np.where(inb, 0.5 + 0.2 * wear, 0.38 - bumps * 0.1 + 0.1 * wear))
    print("trapdoor")


def ttf_fonts():
    """woff2 -> ttf for Blender 3D text (fontTools; same OFL font the HUD ships)"""
    out = os.path.join(OUT, "bungee.ttf")
    if os.path.exists(out) and not FORCE:
        return
    from fontTools.ttLib import TTFont
    f = TTFont(F_BUNGEE)
    f.flavor = None
    f.save(out)
    print("ttf", out)


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    os.makedirs(OUT, exist_ok=True)
    which = next((a for a in sys.argv[1:] if not a.startswith("--")), "all")
    ttf_fonts()
    if which in ("butcher_block", "all"):
        gen_tile("bb_tile", band=(0.52, 0.055, 0.07))
        gen_brushed("bb_steel", seed=21)
        gen_brushed("bb_steeld", S=512, seed=22, base=0.42, amp=0.05, rough=0.38, scratches=120)
        gen_paint("bb_red", (0.58, 0.045, 0.055), seed=31)
        gen_paint("bb_black", (0.035, 0.034, 0.038), seed=32, rough=0.42)
        gen_paint("bb_wallpaint", (0.16, 0.17, 0.19), seed=33, rough=0.78, wear=0.2, base_metal=0.3)
        gen_ham()
        gen_sausage()
        gen_salami()
        gen_endgrain()
        gen_bb_labels()
    if which in ("wheel_of_pain", "all"):
        gen_wheel_face()
        gen_wp_floor()
        gen_wp_labels()
        gen_wp_led()
        gen_trapdoor()
        gen_brushed("wp_alu", S=512, seed=131, base=0.72, amp=0.05, rough=0.26, scratches=90, dents=False)
        gen_paint("wp_blue", (0.05, 0.12, 0.62), seed=141, rough=0.22, wear=0.15, base_metal=0.7)
        gen_paint("wp_violet", (0.34, 0.05, 0.55), seed=142, rough=0.22, wear=0.15, base_metal=0.7)
        gen_paint("wp_black", (0.02, 0.02, 0.025), seed=143, rough=0.3, wear=0.2, base_metal=0.5)
    print("tex_a done ->", OUT)


if __name__ == "__main__":
    main()
