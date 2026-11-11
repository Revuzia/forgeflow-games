#!/usr/bin/env python3
"""MAX env lane: before | after sheets.  python3 _harness/max_env_sheet.py OUT.png "title" A.png B.png [A2 B2 ...] [--crop x0,y0,x1,y1] [--labels before,after]
Each pair becomes one row (A left, B right), cropped, labelled; written at most 2400 px wide."""
import sys
from PIL import Image, ImageDraw, ImageFont
args = [a for a in sys.argv[1:]]
crop = None; labels = ['before', 'after']
if '--crop' in args:
    i = args.index('--crop'); crop = tuple(int(v) for v in args[i + 1].split(',')); del args[i:i + 2]
if '--labels' in args:
    i = args.index('--labels'); labels = args[i + 1].split(','); del args[i:i + 2]
out, title, files = args[0], args[1], args[2:]
pairs = [(files[i], files[i + 1]) for i in range(0, len(files), 2)]
try:
    font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 22)
except Exception:
    font = ImageFont.load_default()
rows = []
for a, b in pairs:
    A, B = Image.open(a).convert('RGB'), Image.open(b).convert('RGB')
    if crop: A, B = A.crop(crop), B.crop(crop)
    w, h = A.size
    r = Image.new('RGB', (w * 2 + 8, h + 30), (20, 22, 26))
    r.paste(A, (0, 30)); r.paste(B, (w + 8, 30))
    d = ImageDraw.Draw(r)
    d.text((8, 4), f'{labels[0]}  ({a.split("/")[-1]})', fill=(235, 235, 235), font=font)
    d.text((w + 16, 4), f'{labels[1]}  ({b.split("/")[-1]})', fill=(235, 235, 235), font=font)
    rows.append(r)
W = max(r.size[0] for r in rows); H = sum(r.size[1] for r in rows) + 40
sheet = Image.new('RGB', (W, H), (12, 13, 16))
ImageDraw.Draw(sheet).text((8, 8), title, fill=(255, 220, 160), font=font)
y = 40
for r in rows: sheet.paste(r, (0, y)); y += r.size[1]
if sheet.size[0] > 2400:
    s = 2400 / sheet.size[0]; sheet = sheet.resize((2400, int(sheet.size[1] * s)), Image.LANCZOS)
sheet.save(out, optimize=True)
print('wrote', out, sheet.size)
