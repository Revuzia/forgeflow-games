#!/usr/bin/env python
"""DYEFIELD — menu thumbnails (generator for runtime/src/ui/assets/*.webp).

  map_<id>.webp  ← art/renders/map_<id>_persp.png (the in-arena perspective render), 480 × 270, WebP q80
  kit_<id>.webp  ← art/renders/kit_<id>.png, the 3/4 panel (left third), background keyed out to alpha,
                   trimmed to the kit + a margin, fit into 256 × 176, WebP q86 with alpha

The kit renders sit on a flat studio grey; the key is a flood fill from the panel border (so no grey inside
the kit is ever removed) with a feathered alpha ramp on the colour distance for clean anti-aliased edges.
The panel's label text (top-left) is dropped by cropping below it before the trim.

Run from anywhere:  python runtime/src/ui/assets/build_thumbs.py
"""
from __future__ import annotations

import os
import sys
from collections import deque

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
RENDERS = os.path.join(GAME, "art", "renders")

MAPS = ["pier18", "lockwell", "cinder"]
KITS = ["mist_rasp", "sheet_drum", "needle_glint", "pop_well"]


def build_map(mid: str) -> str:
    src = os.path.join(RENDERS, "map_%s_persp.png" % mid)
    im = Image.open(src).convert("RGB")
    im = im.resize((480, 270), Image.LANCZOS)
    out = os.path.join(HERE, "map_%s.webp" % mid)
    im.save(out, "WEBP", quality=80, method=6)
    return out


LABEL_BOX = (20, 44, 252, 79)   # the panel label ("MIST-RASP  3/4"), painted over with the studio grey first


def key_background(im: Image.Image, label_h: int = 0, t0: float = 10.0, t1: float = 34.0) -> Image.Image:
    """RGB panel → RGBA with the border-connected studio grey keyed out."""
    w, h = im.size
    px = im.load()
    bg = px[w - 2, h - 2]
    x0, y0, x1, y1 = LABEL_BOX
    for y in range(y0, y1):
        for x in range(x0, x1):
            c = px[x, y]
            if max(c) - min(c) < 34 and sum(c) < sum(bg) - 6:   # darker than the grey + unsaturated = label ink (anti-aliased too)
                px[x, y] = bg
    def dist(c):
        return ((c[0] - bg[0]) ** 2 + (c[1] - bg[1]) ** 2 + (c[2] - bg[2]) ** 2) ** 0.5
    seen = bytearray(w * h)
    alpha = [255] * (w * h)
    q = deque()
    for x in range(w):
        q.append((x, 0)); q.append((x, h - 1))
    for y in range(h):
        q.append((0, y)); q.append((w - 1, y))
    while q:
        x, y = q.popleft()
        i = y * w + x
        if seen[i]:
            continue
        d = dist(px[x, y]) if y >= label_h else 0.0      # the label strip is always background
        if d >= t1:
            continue
        seen[i] = 1
        alpha[i] = 0 if d <= t0 else int(255 * (d - t0) / (t1 - t0))
        if d > t0 and y >= label_h:
            continue                                      # an edge pixel: keep it, do not grow past it
        if x > 0: q.append((x - 1, y))
        if x < w - 1: q.append((x + 1, y))
        if y > 0: q.append((x, y - 1))
        if y < h - 1: q.append((x, y + 1))
    for y in range(max(0, y0 - 4), min(h, y1 + 2)):                 # faint anti-aliased label remnants
        for x in range(max(0, x0 - 4), min(w, x1 + 60)):
            if alpha[y * w + x] < 170:
                alpha[y * w + x] = 0
    out = im.convert("RGBA")
    a = Image.new("L", (w, h))
    a.putdata(alpha)
    out.putalpha(a)
    return out


def build_kit(kid: str) -> str:
    src = os.path.join(RENDERS, "kit_%s.png" % kid)
    im = Image.open(src).convert("RGB")
    panel = im.crop((0, 0, im.width // 3, im.height)).copy()
    rgba = key_background(panel)
    bbox = rgba.getchannel("A").point(lambda v: 255 if v > 24 else 0).getbbox()
    if bbox:
        m = 14
        bbox = (max(0, bbox[0] - m), max(0, bbox[1] - m), min(rgba.width, bbox[2] + m), min(rgba.height, bbox[3] + m))
        rgba = rgba.crop(bbox)
    rgba.thumbnail((256, 176), Image.LANCZOS)
    canvas = Image.new("RGBA", (256, 176), (0, 0, 0, 0))
    canvas.paste(rgba, ((256 - rgba.width) // 2, (176 - rgba.height) // 2), rgba)
    out = os.path.join(HERE, "kit_%s.webp" % kid.replace("_", "-"))
    canvas.save(out, "WEBP", quality=86, method=6)
    return out


def main() -> int:
    for m in MAPS:
        p = build_map(m)
        print("%s  %d B" % (os.path.relpath(p, GAME), os.path.getsize(p)))
    for k in KITS:
        p = build_kit(k)
        print("%s  %d B" % (os.path.relpath(p, GAME), os.path.getsize(p)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
