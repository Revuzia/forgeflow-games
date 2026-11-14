#!/usr/bin/env python
"""Crop + upscale a hero shot so material/face detail can actually be judged.

  python herozoom.py <name> [cx cy w h] [-o out.png] [--scale N]
Coords are FRACTIONS of the source (0..1). Default = centre 40% box.
"""
import os, sys
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "_shots", "hero")

def crop(name, cx=0.5, cy=0.5, w=0.4, h=0.4, scale=2, out=None):
    p = name if os.path.isfile(name) else os.path.join(OUT, name + ".png")
    im = Image.open(p).convert("RGB")
    W, H = im.size
    x0 = int((cx - w / 2) * W); y0 = int((cy - h / 2) * H)
    x1 = int((cx + w / 2) * W); y1 = int((cy + h / 2) * H)
    c = im.crop((max(0, x0), max(0, y0), min(W, x1), min(H, y1)))
    c = c.resize((int(c.width * scale), int(c.height * scale)), Image.LANCZOS)
    o = out or os.path.join(OUT, "_zoom_" + os.path.basename(p))
    c.save(o)
    print(o, c.size)
    return o

if __name__ == "__main__":
    a = sys.argv[1:]
    name = a[0]
    nums = [float(x) for x in a[1:5]] if len(a) >= 5 else [0.5, 0.5, 0.4, 0.4]
    scale = 2
    out = None
    if "--scale" in a: scale = float(a[a.index("--scale") + 1])
    if "-o" in a: out = a[a.index("-o") + 1]
    crop(name, *nums, scale=scale, out=out)
