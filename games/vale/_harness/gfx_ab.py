#!/usr/bin/env python3
"""VALE harness, graphics pass: a labelled before / after sheet from two same-frame PNGs (at most 1600 px wide).

  gfx_ab.py <out.png> <title> <before.png> <after.png> [x0,y0,x1,y1] [<before2> <after2> [crop]] ...

Each row is the before frame left, the after frame right. Run with the project venv (PIL)."""
import sys
from PIL import Image, ImageDraw, ImageFont

out, title, rest = sys.argv[1], sys.argv[2], sys.argv[3:]
rows, i = [], 0
while i < len(rest):
    a, b = rest[i], rest[i + 1]
    i += 2
    crop = None
    if i < len(rest) and rest[i].count(",") == 3:
        crop = tuple(int(v) for v in rest[i].split(","))
        i += 1
    rows.append((a, b, crop))
CELL_W = 796
try:
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 18)
except OSError:
    font = ImageFont.load_default()
cells = []
for a, b, crop in rows:
    pair = []
    for p in (a, b):
        im = Image.open(p).convert("RGB")
        if crop:
            im = im.crop(crop)
        pair.append(im.resize((CELL_W, round(im.height * CELL_W / im.width)), Image.LANCZOS))
    cells.append(pair)
H = 30 + sum(p[0].height + 4 for p in cells)
sheet = Image.new("RGB", (CELL_W * 2 + 8, H), (11, 13, 17))
d = ImageDraw.Draw(sheet)
d.text((6, 5), f"before  |  {title}", fill=(237, 230, 214), font=font)
d.text((CELL_W + 14, 5), "after", fill=(237, 230, 214), font=font)
y = 30
for l, r in cells:
    sheet.paste(l, (0, y))
    sheet.paste(r, (CELL_W + 8, y))
    y += l.height + 4
sheet.save(out, optimize=True)
print(out, sheet.size)
