"""HIT PARADE - 2D art the props (and the goon repaint) need, drawn with PIL (lane ASSETS).

  python tools/prop_decals.py <out_dir>        -> <out_dir>/*.png + decals.json (uv rects etc.)

Everything is ORIGINAL vector-style art drawn here (suit pips are geometric shapes, lettering uses the game's own
SIL-OFL fonts from runtime/src/ui/fonts - Russo One, Bebas Neue, Oswald). Nothing is traced or copied.
  card_atlas.png  1024x1024  6 cells 320x448 (3 cols x 2 rows): A-spade, A-heart, '13' show card, A-club,
                  A-diamond, card back (K13 lattice). card_normal.png (paper grain), card_orm.png (R ao, G rough, B metal).
  shield_text.png 1024x192   'K13 SECURITY' white on transparent (a mask the shield bake projects in object space)
  gourd_label.png 256x256    red diamond paper tag with a gold seal ring (no text)
  security_patch_<w>x<h>.png is made on demand by security_patch() for the goon texture repaint (build_fighters).
Deterministic (seeded numpy). ASCII only.
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
FONTS = os.path.join(GAME, "runtime", "src", "ui", "fonts")
RUSSO = os.path.join(FONTS, "russo-one-latin-400.woff2")
BEBAS = os.path.join(FONTS, "bebas-neue-latin-400.woff2")
OSWALD = os.path.join(FONTS, "oswald-latin-400.woff2")

CARD_W, CARD_H = 320, 448          # 63.5 x 88.9 mm poker card (ratio 0.714)
ATLAS = 1024
MARGIN_X = (ATLAS - 3 * CARD_W) // 2
MARGIN_Y = (ATLAS - 2 * CARD_H) // 2
CELLS = ["A_spade", "A_heart", "show13", "A_club", "A_diamond", "back"]
PAPER = (247, 243, 233)
RED = (196, 22, 36)
INK = (22, 22, 26)
SS = 4                             # supersampling factor for anti-aliased shapes


def font(path, px):
    return ImageFont.truetype(path, px)


# ------------------------------------------------------------------ suit pips (geometric, original)
def pip(d, suit, cx, cy, s, fill):
    """suit pip of height ~s centred on (cx, cy) in the (supersampled) draw space."""
    r = s * 0.27
    if suit == "diamond":
        d.polygon([(cx, cy - s * 0.5), (cx + s * 0.36, cy), (cx, cy + s * 0.5), (cx - s * 0.36, cy)], fill=fill)
    elif suit == "heart":
        d.ellipse([cx - s * 0.5, cy - s * 0.42, cx - s * 0.5 + 2 * r, cy - s * 0.42 + 2 * r], fill=fill)
        d.ellipse([cx + s * 0.5 - 2 * r, cy - s * 0.42, cx + s * 0.5, cy - s * 0.42 + 2 * r], fill=fill)
        d.polygon([(cx - s * 0.49, cy - s * 0.12), (cx + s * 0.49, cy - s * 0.12), (cx, cy + s * 0.5)], fill=fill)
        d.polygon([(cx - s * 0.2, cy - s * 0.3), (cx + s * 0.2, cy - s * 0.3), (cx, cy)], fill=fill)
    elif suit == "spade":
        # the heart flipped upside down (lobes at the bottom, point at the top), shrunk to leave room for the stem
        k, oy = 0.82, -0.09
        rr = r * k
        lc = cy + (0.15 * k + oy) * s                     # lobe centre height
        for sx in (-1, 1):
            lx = cx + sx * (0.5 * k * s - rr)
            d.ellipse([lx - rr, lc - rr, lx + rr, lc + rr], fill=fill)
        d.polygon([(cx - 0.49 * k * s, lc - 0.03 * k * s), (cx + 0.49 * k * s, lc - 0.03 * k * s),
                   (cx, cy + (-0.5 * k + oy) * s)], fill=fill)
        d.polygon([(cx - 0.2 * k * s, lc + 0.15 * k * s), (cx + 0.2 * k * s, lc + 0.15 * k * s), (cx, lc - 0.15 * k * s)],
                  fill=fill)
        d.polygon([(cx - s * 0.05, lc), (cx + s * 0.05, lc), (cx + s * 0.19, cy + s * 0.5),
                   (cx - s * 0.19, cy + s * 0.5)], fill=fill)
    elif suit == "club":
        rr = s * 0.24
        for ox, oy in ((0.0, -0.24), (-0.25, 0.08), (0.25, 0.08)):
            d.ellipse([cx + ox * s - rr, cy + oy * s - rr, cx + ox * s + rr, cy + oy * s + rr], fill=fill)
        d.ellipse([cx - rr * 0.6, cy - rr * 0.4, cx + rr * 0.6, cy + rr * 0.8], fill=fill)
        d.polygon([(cx - s * 0.06, cy + s * 0.05), (cx + s * 0.06, cy + s * 0.05), (cx + s * 0.2, cy + s * 0.5),
                   (cx - s * 0.2, cy + s * 0.5)], fill=fill)


def rounded(d, box, r, fill=None, outline=None, width=1):
    d.rounded_rectangle(box, radius=r, fill=fill, outline=outline, width=width)


def centered_text(d, cx, cy, text, f, fill):
    b = d.textbbox((0, 0), text, font=f)
    d.text((cx - (b[0] + b[2]) / 2.0, cy - (b[1] + b[3]) / 2.0), text, font=f, fill=fill)


def card_face(kind):
    W, H = CARD_W * SS, CARD_H * SS
    im = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(im)
    if kind == "back":
        d.rectangle([0, 0, W, H], fill=(236, 232, 222))
        m = 16 * SS
        rounded(d, [m, m, W - m, H - m], 10 * SS, fill=(158, 18, 30))
        # diagonal lattice + diamonds (clipped to the inner panel)
        lat = Image.new("L", (W, H), 0)
        ld = ImageDraw.Draw(lat)
        step = 26 * SS
        for k in range(-H, W + H, step):
            ld.line([(k, 0), (k + H, H)], fill=255, width=2 * SS)
            ld.line([(k, H), (k + H, 0)], fill=255, width=2 * SS)
        for yy in range(0, H + step, step):
            for xx in range(0, W + step, step):
                ox = step // 2 if (yy // step) % 2 else 0
                ld.polygon([(xx + ox, yy - 5 * SS), (xx + ox + 5 * SS, yy), (xx + ox, yy + 5 * SS),
                            (xx + ox - 5 * SS, yy)], fill=255)
        mask = Image.new("L", (W, H), 0)
        ImageDraw.Draw(mask).rounded_rectangle([m + 10 * SS, m + 10 * SS, W - m - 10 * SS, H - m - 10 * SS],
                                               radius=6 * SS, fill=255)
        lat = Image.fromarray((np.asarray(lat, np.float32) * np.asarray(mask, np.float32) / 255.0 * 0.55).astype(np.uint8))
        im.paste((238, 214, 190), (0, 0), lat)
        rounded(d, [m + 10 * SS, m + 10 * SS, W - m - 10 * SS, H - m - 10 * SS], 6 * SS, outline=(238, 214, 190),
                width=2 * SS)
        # centre medallion
        cx, cy, R = W / 2, H / 2, 62 * SS
        d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(236, 232, 222), outline=(40, 10, 14), width=3 * SS)
        d.ellipse([cx - R + 9 * SS, cy - R + 9 * SS, cx + R - 9 * SS, cy + R - 9 * SS], outline=(158, 18, 30),
                  width=3 * SS)
        centered_text(d, cx, cy + 2 * SS, "13", font(RUSSO, 64 * SS), (158, 18, 30))
        centered_text(d, cx, cy - R - 26 * SS, "KNOCKOUT", font(BEBAS, 30 * SS), (238, 214, 190))
        centered_text(d, cx, cy + R + 26 * SS, "HIT PARADE", font(BEBAS, 30 * SS), (238, 214, 190))
    else:
        rounded(d, [5 * SS, 5 * SS, W - 5 * SS, H - 5 * SS], 12 * SS, outline=(214, 208, 194), width=2 * SS)
        if kind == "show13":
            col = RED
            rank, suit = "13", None
            # starburst + big 13
            cx, cy = W / 2, H / 2
            pts = []
            for i in range(32):
                a = i * np.pi / 16
                rr = (120 if i % 2 == 0 else 78) * SS
                pts.append((cx + rr * np.cos(a), cy + rr * np.sin(a)))
            d.polygon(pts, fill=INK)
            d.ellipse([cx - 70 * SS, cy - 70 * SS, cx + 70 * SS, cy + 70 * SS], fill=(250, 214, 60))
            centered_text(d, cx, cy + 4 * SS, "13", font(RUSSO, 92 * SS), RED)
            centered_text(d, cx, 58 * SS + 40 * SS, "KNOCKOUT", font(BEBAS, 34 * SS), INK)
            centered_text(d, cx, H - 98 * SS, "HIT PARADE", font(BEBAS, 34 * SS), INK)
        else:
            rank, suit = kind.split("_")
            col = RED if suit in ("heart", "diamond") else INK
            big = 150 if suit != "spade" else 180
            pip(d, suit, W / 2, H / 2, big * SS, col)
            if suit == "spade":      # the deck maker's ace: a ring + the show's mark
                d.ellipse([W / 2 - 112 * SS, H / 2 - 112 * SS, W / 2 + 112 * SS, H / 2 + 112 * SS], outline=INK,
                          width=3 * SS)
                centered_text(d, W / 2, H / 2 + 134 * SS, "K13 PLAYING CARD CO.", font(OSWALD, 15 * SS), INK)
        # corner indices (top-left, and bottom-right rotated 180)
        idx = Image.new("RGBA", (70 * SS, 110 * SS), (0, 0, 0, 0))
        di = ImageDraw.Draw(idx)
        centered_text(di, 35 * SS, 30 * SS, rank, font(BEBAS if rank != "13" else RUSSO, (52 if rank != "13" else 34) * SS), col)
        if suit:
            pip(di, suit, 35 * SS, 78 * SS, 34 * SS, col)
        else:
            pip(di, "diamond", 35 * SS, 76 * SS, 26 * SS, col)
        im.paste(idx, (10 * SS, 10 * SS), idx)
        idx2 = idx.rotate(180)
        im.paste(idx2, (W - 80 * SS, H - 120 * SS), idx2)
    return im.resize((CARD_W, CARD_H), Image.LANCZOS)


def value_noise(h, w, cell, rng):
    gy, gx = h // cell + 2, w // cell + 2
    g = rng.random((gy, gx)).astype(np.float32)
    ys = np.linspace(0, gy - 2, h, endpoint=False)
    xs = np.linspace(0, gx - 2, w, endpoint=False)
    y0, x0 = ys.astype(int), xs.astype(int)
    fy, fx = (ys - y0)[:, None], (xs - x0)[None, :]
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    a = g[y0][:, x0]
    b = g[y0][:, x0 + 1]
    c = g[y0 + 1][:, x0]
    dd = g[y0 + 1][:, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + dd * fx) * fy


def height_to_normal(hgt, strength):
    gy, gx = np.gradient(hgt.astype(np.float32))
    nx, ny, nz = -gx * strength, gy * strength, np.ones_like(hgt, np.float32)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    n = np.stack([nx / ln, ny / ln, nz / ln], -1)
    return ((n * 0.5 + 0.5) * 255).round().clip(0, 255).astype(np.uint8)


def cell_origin(i):
    return MARGIN_X + (i % 3) * CARD_W, MARGIN_Y + (i // 3) * CARD_H


def build_cards(out):
    atlas = Image.new("RGB", (ATLAS, ATLAS), (236, 232, 222))
    ink_mask = np.zeros((ATLAS, ATLAS), np.float32)
    rects = {}
    for i, k in enumerate(CELLS):
        face = card_face(k)
        x, y = cell_origin(i)
        atlas.paste(face, (x, y))
        a = np.asarray(face, np.float32)
        dist = np.abs(a - np.array(PAPER, np.float32)).sum(-1)
        ink_mask[y:y + CARD_H, x:x + CARD_W] = (dist > 60).astype(np.float32)
        # uv rect in Blender / glTF-flipped convention: u0, v0 (bottom), u1, v1 (top); v up
        rects[k] = [x / ATLAS, 1.0 - (y + CARD_H) / ATLAS, (x + CARD_W) / ATLAS, 1.0 - y / ATLAS]
    atlas.save(os.path.join(out, "card_atlas.png"))
    rng = np.random.default_rng(1301)
    fib = value_noise(ATLAS, ATLAS, 3, rng) * 0.6 + value_noise(ATLAS, ATLAS, 11, rng) * 0.4
    ink_soft = np.asarray(Image.fromarray((ink_mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2)),
                          np.float32) / 255.0
    hgt = fib * 0.6 + ink_soft * 0.25
    # paper grain / ORM at 512 (the grain is sub-pixel on screen; the 1024 versions cost ~150 KB per card GLB)
    Image.fromarray(height_to_normal(hgt, 2.2)).resize((ATLAS // 2, ATLAS // 2), Image.LANCZOS).save(
        os.path.join(out, "card_normal.png"))
    orm = np.zeros((ATLAS, ATLAS, 3), np.uint8)
    orm[..., 0] = 255
    orm[..., 1] = (255 * (0.72 - 0.26 * ink_mask + (fib - 0.5) * 0.08)).clip(0, 255).astype(np.uint8)
    Image.fromarray(orm).resize((ATLAS // 2, ATLAS // 2), Image.LANCZOS).save(os.path.join(out, "card_orm.png"))
    return rects


def build_shield_text(out):
    W, H = 1024, 192
    im = Image.new("RGBA", (W * 2, H * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    f = font(RUSSO, 150)
    centered_text(d, W, H, "K13 SECURITY", f, (255, 255, 255, 255))
    im = im.resize((W, H), Image.LANCZOS)
    im.save(os.path.join(out, "shield_text.png"))
    b = im.getbbox()
    return {"size": [W, H], "ink_bbox_px": list(b)}


def build_gourd_label(out):
    S = 256 * SS
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = S / 2
    d.polygon([(c, 8 * SS), (S - 8 * SS, c), (c, S - 8 * SS), (8 * SS, c)], fill=(186, 26, 30, 255))
    d.polygon([(c, 22 * SS), (S - 22 * SS, c), (c, S - 22 * SS), (22 * SS, c)], outline=(232, 186, 74, 255), width=5 * SS)
    for r, w in ((58, 7), (40, 4)):
        d.ellipse([c - r * SS, c - r * SS, c + r * SS, c + r * SS], outline=(232, 186, 74, 255), width=w * SS)
    for i in range(8):
        a = i * np.pi / 4
        d.line([(c + 18 * SS * np.cos(a), c + 18 * SS * np.sin(a)), (c + 34 * SS * np.cos(a), c + 34 * SS * np.sin(a))],
               fill=(232, 186, 74, 255), width=4 * SS)
    im.resize((256, 256), Image.LANCZOS).save(os.path.join(out, "gourd_label.png"))


def security_patch(w, h, bg_rgb, fg_rgb, path, text="K13 SECURITY", lines=None):
    """A texture patch for the goon repaint: the fabric colour with the show's lettering (fitted to w x h px).
    Returns the path. Called by tools/build_fighters.py (repaint step) - never by hand."""
    lines = lines or [text]
    im = Image.new("RGBA", (w * 2, h * 2), tuple(bg_rgb) + (0,))
    d = ImageDraw.Draw(im)
    lh = (h * 2) / len(lines)
    for i, ln in enumerate(lines):
        px = int(lh * 0.8)
        f = font(RUSSO, px)
        while px > 8:
            b = d.textbbox((0, 0), ln, font=f)
            if b[2] - b[0] <= w * 2 * 0.92 and b[3] - b[1] <= lh * 0.78:
                break
            px -= 2
            f = font(RUSSO, px)
        centered_text(d, w, lh * (i + 0.5), ln, f, tuple(fg_rgb) + (255,))
    im = im.resize((w, h), Image.LANCZOS)
    im.save(path)
    return path


def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    info = {"cards": build_cards(out), "card_cells": CELLS, "shield_text": build_shield_text(out)}
    build_gourd_label(out)
    info["files"] = sorted(f for f in os.listdir(out) if f.endswith(".png"))
    with open(os.path.join(out, "decals.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(info, fh, indent=1)
    print(json.dumps({"ok": True, "files": info["files"]}))


if __name__ == "__main__":
    main()
