#!/usr/bin/env python
"""Crop + upscale a region of a screenshot so a claim about micro-structure can be
looked at instead of asserted.

A realm surface lives at the scale of a few pixels: sastrugi streaks, dune ripples
and crust cracks are all sub-10-px features at 1280x720, and a full-frame PNG read
through a vision model resolves none of them. This crops a named box and blows it
up with NEAREST so the pixel grid itself stays legible -- a smooth resample would
invent the very structure we are trying to judge.

    python qa_crop.py _shots/realm_sand.png _shots/qa_crop_sand.png 0 380 420 300 3

Args: src dst x y w h scale
"""
import sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
x, y, w, h = (int(v) for v in sys.argv[3:7])
scale = int(sys.argv[7]) if len(sys.argv) > 7 else 3

im = Image.open(src).convert("RGB")
box = im.crop((x, y, x + w, y + h))
box = box.resize((w * scale, h * scale), Image.NEAREST)
box.save(dst)

# Mean channel values of the ORIGINAL crop -- the numbers behind "warm" / "cool".
px = list(im.crop((x, y, x + w, y + h)).getdata())
n = len(px)
r = sum(p[0] for p in px) / n
g = sum(p[1] for p in px) / n
b = sum(p[2] for p in px) / n
print(f"{src} [{x},{y} {w}x{h}] -> {dst}  mean RGB = {r:.1f} {g:.1f} {b:.1f}"
      f"   B/R = {b / max(r, 1e-6):.3f}")
