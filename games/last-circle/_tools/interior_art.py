"""interior_art.py - the 16 pictures of the house insides (Wave 10 R3A fix5, orchestrator ruling R3A-6), rendered by this script: 4 landscapes, 2 seascapes,
2 still lifes, 2 posters, 2 maps, a night skyline, a botanical print, an abstract painting and a winter scene. Original work made here (numpy + Pillow,
fixed seeds): no third-party image, no licence beyond this repository's own.

    python _tools/interior_art.py                 # -> assets/tex/interior_art.jpg (1024 x 1024: a 4 x 4 grid of 256 px cells, ~117 KB)

Cell k (0..15) holds picture k = housegen PICS index k (row-major from the top-left; housegen ART_CELL reads them the same way). Each picture is drawn on
CELL - 2 * PAD px and its edge pixels are repeated into the PAD border, so mip levels down to ~32 px do not bleed one picture into the next.
"""
from __future__ import annotations

import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

CELL, PAD, GRID = 256, 12, 4
S = CELL - 2 * PAD                 # the drawn picture, px
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "tex", "interior_art.jpg")


def rng(seed):
    return np.random.default_rng(seed)


def fbm1(n, seed, oct=6, base=4):
    """1-D fractal noise in [0, 1], n samples (value noise, cosine-smoothed)"""
    r, out, amp, tot = rng(seed), np.zeros(n), 1.0, 0.0
    x = np.linspace(0, 1, n, endpoint=False)
    for o in range(oct):
        f = base * 2 ** o
        v = r.random(f + 2)
        t = x * f
        i = np.floor(t).astype(int)
        u = t - i
        u = (1 - np.cos(u * math.pi)) / 2
        out += amp * (v[i] * (1 - u) + v[i + 1] * u)
        tot += amp
        amp *= 0.5
    return out / tot


def fbm2(n, seed, oct=5, base=4):
    """2-D value-noise fbm in [0, 1], n x n"""
    r, out, amp, tot = rng(seed), np.zeros((n, n)), 1.0, 0.0
    y, x = np.mgrid[0:n, 0:n] / n
    for o in range(oct):
        f = base * 2 ** o
        v = r.random((f + 2, f + 2))
        tx, ty = x * f, y * f
        ix, iy = np.floor(tx).astype(int), np.floor(ty).astype(int)
        ux, uy = tx - ix, ty - iy
        ux, uy = ux * ux * (3 - 2 * ux), uy * uy * (3 - 2 * uy)
        a, b, c, d = v[iy, ix], v[iy, ix + 1], v[iy + 1, ix], v[iy + 1, ix + 1]
        out += amp * ((a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy)
        tot += amp
        amp *= 0.5
    return out / tot


def grad(top, bot, n=S, w=S):
    t = np.linspace(0, 1, n)[:, None, None]
    return np.broadcast_to(np.array(top, float) * (1 - t) + np.array(bot, float) * t, (n, w, 3)).copy()


def ridge(img, base_y, amp, seed, col, oct=6, haze=None, rough=1.0):
    """fill below a fractal ridgeline (fractions of S) with col; haze blends toward a colour with depth"""
    h = base_y * S - (fbm1(S, seed, oct) - 0.5) * 2 * amp * S * rough
    ys = np.arange(S)[:, None]
    m = ys >= h[None, :]
    c = np.array(col, float)
    if haze is not None:
        shade = np.clip((ys - h[None, :]) / (0.35 * S), 0, 1)[..., None]
        fill = c * (1 - 0.25 * shade) + np.array(haze, float) * 0.0
    else:
        fill = np.broadcast_to(c, img.shape)
    img[m] = (fill if fill.shape == img.shape else np.broadcast_to(fill, img.shape))[m]
    return h


def brush(img, seed, k=0.06):
    """a painterly grain: low-frequency tint wobble + fine canvas noise"""
    n = fbm2(S, seed, 4, 3)[..., None]
    f = rng(seed + 1).normal(0, 1, (S, S, 1))
    return np.clip(img * (1 + (n - 0.5) * k * 2) + f * 1.2, 0, 255)


def pil(a):
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


# ---- the 16 pictures ------------------------------------------------------------------------------------------------------------------------------------

def p_mountain_lake():
    img = grad((120, 160, 205), (232, 214, 190))
    sun = np.hypot(*np.mgrid[0:S, 0:S] - np.array([S * 0.3, S * 0.72])[:, None, None]) if False else None
    ridge(img, 0.45, 0.16, 11, (122, 132, 160))
    ridge(img, 0.55, 0.12, 12, (86, 104, 120))
    ridge(img, 0.63, 0.07, 13, (52, 78, 70))
    top = int(S * 0.68)
    refl = img[top - (S - top):top][::-1] * 0.78 + np.array([30, 50, 70]) * 0.22
    img[top:] = refl[: S - top]
    ys = np.arange(S - top)[:, None]
    img[top:] += (np.sin(ys * 0.9 + fbm2(S, 14)[top:] * 20)[..., None] * 6)
    return pil(brush(img, 15))


def p_sunset_sea():
    img = grad((250, 196, 120), (214, 92, 72))
    yy, xx = np.mgrid[0:S, 0:S]
    d = np.hypot(xx - S * 0.62, yy - S * 0.52)
    img += (np.clip(1 - d / (S * 0.5), 0, 1) ** 2)[..., None] * np.array([40, 30, 0])
    sun = d < S * 0.09
    img[sun] = np.array([255, 236, 180])
    hor = int(S * 0.58)
    sea = grad((180, 90, 80), (60, 40, 70), S - hor)
    img[hor:] = sea
    for k in range(40):
        y = hor + int((k / 40) ** 1.6 * (S - hor - 2)) + 1
        w = int(6 + k * 1.4)
        x = int(S * 0.62 + (rng(k).random() - 0.5) * k * 2.5)
        img[y:y + 2, max(0, x - w):x + w] = img[y:y + 2, max(0, x - w):x + w] * 0.5 + np.array([255, 200, 140]) * 0.5
    return pil(brush(img, 21))


def p_forest_hills():
    img = grad((160, 196, 220), (220, 230, 220))
    ridge(img, 0.5, 0.08, 31, (120, 150, 120))
    ridge(img, 0.62, 0.07, 32, (80, 120, 80))
    h = ridge(img, 0.74, 0.05, 33, (50, 90, 56))
    im = pil(img)
    dr = ImageDraw.Draw(im)
    r = rng(34)
    for k in range(26):
        x = r.random() * S
        base = h[int(min(S - 1, x))] + r.random() * 30
        tall = 30 + r.random() * 34
        c = tuple(int(v) for v in (28 + r.random() * 20, 60 + r.random() * 30, 40 + r.random() * 16))
        dr.polygon([(x, base - tall), (x - tall * 0.28, base), (x + tall * 0.28, base)], fill=c)
    dr.rectangle([0, int(S * 0.9), S, S], fill=(70, 96, 52))
    return pil(brush(np.asarray(im, float), 35))


def p_dunes():
    img = grad((120, 170, 220), (240, 220, 190))
    cols = [(232, 190, 130), (214, 160, 100), (196, 136, 84), (176, 112, 70)]
    for k, c in enumerate(cols):
        h = ridge(img, 0.52 + k * 0.11, 0.06, 41 + k, c, oct=3, rough=1.2)
        ys = np.arange(S)[:, None]
        band = (ys >= h[None, :]) & (ys < h[None, :] + 10)
        img[band] = img[band] * 0.82
    return pil(brush(img, 45, 0.04))


def p_still_vase():
    img = grad((86, 70, 60), (60, 48, 40))
    img[int(S * 0.7):] = grad((140, 100, 70), (110, 76, 52), S - int(S * 0.7))
    im = pil(img)
    dr = ImageDraw.Draw(im)
    cx = S * 0.5
    dr.ellipse([cx - 40, S * 0.48, cx + 40, S * 0.78], fill=(48, 86, 132))
    dr.rectangle([cx - 14, S * 0.40, cx + 14, S * 0.52], fill=(48, 86, 132))
    r = rng(51)
    for k in range(14):
        a = -math.pi / 2 + (r.random() - 0.5) * 1.8
        L = 50 + r.random() * 40
        x1, y1 = cx + math.cos(a) * L, S * 0.42 + math.sin(a) * L
        dr.line([(cx, S * 0.42), (x1, y1)], fill=(60, 110, 50), width=2)
        rr = 8 + r.random() * 8
        c = [(220, 70, 80), (240, 200, 70), (250, 240, 230), (200, 110, 170)][k % 4]
        dr.ellipse([x1 - rr, y1 - rr, x1 + rr, y1 + rr], fill=c)
        dr.ellipse([x1 - rr * 0.35, y1 - rr * 0.35, x1 + rr * 0.35, y1 + rr * 0.35], fill=(250, 220, 120))
    a = np.asarray(im.filter(ImageFilter.GaussianBlur(0.8)), float)
    yy, xx = np.mgrid[0:S, 0:S]
    a *= (1 - 0.35 * np.clip(np.hypot(xx - S / 2, yy - S / 2) / (S * 0.7), 0, 1) ** 2)[..., None]
    return pil(brush(a, 52))


def p_still_fruit():
    img = grad((214, 200, 170), (180, 160, 130))
    img[int(S * 0.62):] = grad((120, 60, 50), (90, 44, 40), S - int(S * 0.62))
    im = pil(img)
    dr = ImageDraw.Draw(im)
    dr.ellipse([S * 0.18, S * 0.56, S * 0.82, S * 0.78], fill=(200, 200, 196))
    fr = [(0.34, 0.55, 26, (200, 40, 40)), (0.5, 0.52, 30, (230, 180, 40)), (0.64, 0.56, 24, (120, 170, 60)), (0.44, 0.6, 22, (160, 30, 60)), (0.58, 0.61, 20, (240, 130, 40))]
    for x, y, r_, c in fr:
        x, y = x * S, y * S
        dr.ellipse([x - r_, y - r_, x + r_, y + r_], fill=c)
        hl = tuple(min(255, int(v * 1.35 + 30)) for v in c)
        dr.ellipse([x - r_ * 0.55, y - r_ * 0.65, x - r_ * 0.1, y - r_ * 0.2], fill=hl)
    a = np.asarray(im.filter(ImageFilter.GaussianBlur(1.1)), float)
    return pil(brush(a, 61))


def p_poster_geo():
    im = Image.new("RGB", (S, S), (238, 228, 205))
    dr = ImageDraw.Draw(im)
    dr.ellipse([S * 0.18, S * 0.12, S * 0.82, S * 0.76], fill=(222, 92, 60))
    dr.rectangle([0, S * 0.5, S, S * 0.62], fill=(34, 74, 110))
    dr.pieslice([S * 0.3, S * 0.3, S * 1.1, S * 1.1], 180, 270, fill=(232, 182, 60))
    for k in range(6):
        y = S * 0.7 + k * 9
        dr.line([(S * 0.1, y), (S * (0.5 + 0.06 * (k % 3)), y)], fill=(34, 74, 110), width=4)
    return pil(brush(np.asarray(im, float), 71, 0.03))


def p_poster_travel():
    img = grad((255, 196, 120), (250, 120, 90))
    im = pil(img)
    dr = ImageDraw.Draw(im)
    dr.ellipse([S * 0.55, S * 0.16, S * 0.85, S * 0.46], fill=(255, 238, 190))
    dr.rectangle([0, S * 0.66, S, S], fill=(30, 110, 140))
    for k in range(5):
        y = S * 0.7 + k * 12
        dr.line([(S * 0.08 * k, y), (S * (0.4 + 0.1 * k), y)], fill=(120, 200, 210), width=3)
    # a palm: a curved trunk + fronds
    pts = [(S * 0.25 + math.sin(t / 10) * 18, S * 0.95 - t * 1.9) for t in range(0, 90)]
    dr.line(pts, fill=(60, 40, 40), width=9)
    tx, ty = pts[-1]
    for a in range(0, 360, 40):
        ar = math.radians(a)
        dr.line([(tx, ty), (tx + math.cos(ar) * 50, ty + math.sin(ar) * 22 + 14)], fill=(30, 70, 50), width=7)
    return pil(brush(np.asarray(im, float), 81, 0.03))


def p_map_island():
    n = fbm2(S, 91, 6, 3)
    yy, xx = np.mgrid[0:S, 0:S] / S
    h = n - 0.9 * np.hypot(xx - 0.5, yy - 0.5) + 0.12
    img = np.zeros((S, S, 3))
    sea = np.array([150, 190, 205]); land = np.array([206, 200, 160]); hill = np.array([170, 150, 110])
    t = np.clip(h / 0.25, 0, 1)[..., None]
    img[:] = sea
    m = h > 0
    img[m] = (land * (1 - t) + hill * t)[m]
    for lv in (0.0, 0.05, 0.1, 0.15, 0.2):
        c = np.abs(h - lv) < 0.004
        img[c] = img[c] * 0.55
    img[(np.arange(S) % 32 == 0)[None, :].repeat(S, 0)] *= 0.85
    img[(np.arange(S) % 32 == 0)[:, None].repeat(S, 1)] *= 0.85
    im = pil(img)
    dr = ImageDraw.Draw(im)
    cx, cy = S * 0.84, S * 0.16
    dr.polygon([(cx, cy - 22), (cx + 6, cy), (cx, cy + 22), (cx - 6, cy)], fill=(120, 40, 40))
    dr.polygon([(cx - 22, cy), (cx, cy - 6), (cx + 22, cy), (cx, cy + 6)], fill=(60, 50, 40))
    return pil(brush(np.asarray(im, float), 92, 0.03))


def p_map_old():
    n = fbm2(S, 101, 6, 2)
    img = np.zeros((S, S, 3)) + np.array([226, 206, 160])
    land = n > 0.52
    img[land] = np.array([196, 168, 112])
    edge = (np.abs(n - 0.52) < 0.008)
    img[edge] = np.array([110, 80, 50])
    im = pil(img)
    dr = ImageDraw.Draw(im)
    c = (S * 0.3, S * 0.7)
    for a in range(0, 360, 22):
        ar = math.radians(a)
        dr.line([c, (c[0] + math.cos(ar) * S, c[1] + math.sin(ar) * S)], fill=(150, 110, 70), width=1)
    dr.ellipse([c[0] - 16, c[1] - 16, c[0] + 16, c[1] + 16], outline=(110, 70, 40), width=2)
    a = np.asarray(im, float)
    yy, xx = np.mgrid[0:S, 0:S]
    a *= (1 - 0.3 * np.clip(np.hypot(xx - S / 2, yy - S / 2) / (S * 0.72), 0, 1) ** 1.5)[..., None]
    return pil(brush(a, 102, 0.08))


def p_skyline():
    img = grad((18, 24, 52), (60, 52, 92))
    r = rng(111)
    im = pil(img)
    dr = ImageDraw.Draw(im)
    for k in range(60):
        dr.point((r.random() * S, r.random() * S * 0.5), fill=(230, 230, 240))
    dr.ellipse([S * 0.72, S * 0.1, S * 0.84, S * 0.22], fill=(236, 232, 210))
    x = 0
    while x < S:
        w = 18 + r.random() * 26
        h = S * (0.25 + r.random() * 0.4)
        dr.rectangle([x, S - h, x + w, S], fill=(24, 26, 40))
        for wy in range(int(S - h + 6), S - 6, 9):
            for wx in range(int(x + 4), int(x + w - 4), 7):
                if r.random() < 0.38:
                    dr.rectangle([wx, wy, wx + 3, wy + 4], fill=(250, 214, 120))
        x += w + 2
    return pil(brush(np.asarray(im, float), 112, 0.03))


def p_botanical():
    im = Image.new("RGB", (S, S), (240, 234, 216))
    dr = ImageDraw.Draw(im)
    cx = S * 0.5
    dr.line([(cx, S * 0.92), (cx + 6, S * 0.12)], fill=(70, 100, 60), width=3)
    for k in range(9):
        y = S * 0.85 - k * 20
        for sg in (-1, 1):
            L = 60 - k * 4
            pts = [(cx + sg * t, y - math.sin(t / L * math.pi) * 14 - t * 0.25) for t in range(0, int(L))]
            pts2 = [(cx + sg * t, y + math.sin(t / L * math.pi) * 6 - t * 0.25) for t in range(int(L) - 1, -1, -1)]
            dr.polygon(pts + pts2, fill=(90 + k * 6, 140 + k * 3, 80), outline=(50, 80, 40))
    return pil(brush(np.asarray(im, float), 121, 0.03))


def p_abstract():
    img = np.zeros((S, S, 3)) + np.array([236, 228, 214])
    r = rng(131)
    im = pil(img)
    dr = ImageDraw.Draw(im)
    pal = [(196, 64, 60), (40, 70, 120), (232, 176, 60), (30, 30, 34), (90, 140, 120)]
    for k in range(70):
        x, y = r.random() * S, r.random() * S
        a = r.random() * math.pi
        L = 20 + r.random() * 60
        dr.line([(x, y), (x + math.cos(a) * L, y + math.sin(a) * L)], fill=pal[k % 5], width=int(4 + r.random() * 10))
    a = np.asarray(im.filter(ImageFilter.GaussianBlur(1.6)), float)
    return pil(brush(a, 132, 0.05))


def p_sailboat():
    img = grad((170, 206, 232), (226, 236, 240))
    hor = int(S * 0.6)
    img[hor:] = grad((70, 130, 170), (30, 80, 120), S - hor)
    ys = np.arange(S - hor)[:, None]
    img[hor:] += np.sin(ys * 0.8 + fbm2(S, 141)[hor:] * 14)[..., None] * 7
    im = pil(img)
    dr = ImageDraw.Draw(im)
    bx, by = S * 0.45, hor + 10
    dr.polygon([(bx - 40, by), (bx + 44, by), (bx + 30, by + 14), (bx - 28, by + 14)], fill=(120, 60, 40))
    dr.line([(bx, by), (bx, by - 110)], fill=(60, 50, 40), width=3)
    dr.polygon([(bx + 3, by - 106), (bx + 3, by - 6), (bx + 60, by - 8)], fill=(246, 244, 236))
    dr.polygon([(bx - 3, by - 90), (bx - 3, by - 8), (bx - 44, by - 10)], fill=(232, 228, 216))
    for k in range(3):
        cx, cy = S * (0.2 + k * 0.3), S * (0.12 + 0.05 * k)
        dr.ellipse([cx - 30, cy - 10, cx + 30, cy + 10], fill=(248, 248, 250))
    return pil(brush(np.asarray(im, float), 142))


def p_meadow():
    img = grad((140, 186, 230), (226, 232, 236))
    hor = int(S * 0.55)
    ridge(img, 0.55, 0.04, 151, (110, 160, 80))
    r = rng(152)
    im = pil(img)
    dr = ImageDraw.Draw(im)
    for k in range(420):
        y = hor + (r.random() ** 0.7) * (S - hor)
        x = r.random() * S
        s = 1 + (y - hor) / (S - hor) * 4
        c = [(230, 70, 70), (250, 220, 80), (250, 250, 250), (180, 110, 210)][k % 4]
        dr.ellipse([x - s, y - s, x + s, y + s], fill=c)
    dr.ellipse([S * 0.12, S * 0.1, S * 0.24, S * 0.22], fill=(255, 244, 200))
    return pil(brush(np.asarray(im, float), 153))


def p_winter():
    img = grad((176, 196, 220), (236, 240, 246))
    ridge(img, 0.5, 0.1, 161, (200, 210, 226))
    h = ridge(img, 0.66, 0.06, 162, (238, 242, 248))
    im = pil(img)
    dr = ImageDraw.Draw(im)
    r = rng(163)
    for k in range(18):
        x = r.random() * S
        base = h[int(min(S - 1, x))] + 6 + r.random() * 40
        t = 26 + r.random() * 30
        for j in range(3):
            w = t * (0.34 - j * 0.08)
            dr.polygon([(x, base - t + j * t * 0.22), (x - w, base - t * 0.3 + j * t * 0.22), (x + w, base - t * 0.3 + j * t * 0.22)], fill=(40, 70, 60))
        dr.rectangle([x - 2, base - t * 0.3, x + 2, base], fill=(70, 50, 40))
    for k in range(160):
        x, y = r.random() * S, r.random() * S
        dr.point((x, y), fill=(255, 255, 255))
    return pil(brush(np.asarray(im, float), 164, 0.03))


PICTURES = [p_mountain_lake, p_sunset_sea, p_forest_hills, p_dunes, p_still_vase, p_still_fruit, p_poster_geo, p_poster_travel,
            p_map_island, p_map_old, p_skyline, p_botanical, p_abstract, p_sailboat, p_meadow, p_winter]


def main():
    atlas = Image.new("RGB", (CELL * GRID, CELL * GRID), (0, 0, 0))
    for k, fn in enumerate(PICTURES):
        im = fn().convert("RGB")
        assert im.size == (S, S), (fn.__name__, im.size)
        cell = np.pad(np.asarray(im), ((PAD, PAD), (PAD, PAD), (0, 0)), mode="edge")
        atlas.paste(Image.fromarray(cell), ((k % GRID) * CELL, (k // GRID) * CELL))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    atlas.save(OUT, "JPEG", quality=80, optimize=True, progressive=False)
    print("wrote %s (%d bytes)" % (os.path.abspath(OUT), os.path.getsize(OUT)))


if __name__ == "__main__":
    main()
