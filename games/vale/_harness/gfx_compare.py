#!/usr/bin/env python3
# VALE harness - GR tools: per-frame A vs B numbers (pixels changed, Laplacian variance = sharpness) and a labelled tracked
# side by side. Usage: gfx_compare.py stats A.png B.png ... | gfx_compare.py sbs out.png "label A" A.png "label B" B.png x y w h [zoom]
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

def load(p): return np.asarray(Image.open(p).convert('RGB')).astype(np.float32)
def lap(a):
    g = a @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    return g[1:-1, 1:-1] * 4 - g[:-2, 1:-1] - g[2:, 1:-1] - g[1:-1, :-2] - g[1:-1, 2:]

if sys.argv[1] == 'stats':
    for i in range(2, len(sys.argv), 2):
        A, B = load(sys.argv[i]), load(sys.argv[i + 1])
        d = np.abs(A - B).max(axis=2)
        la, lb = lap(A), lap(B)
        print(f"{sys.argv[i+1].split('/')[-1]:34s} >4:{100*(d>4).mean():6.2f}% >16:{100*(d>16).mean():6.2f}% max {d.max():4.0f}  sharp {la.var():8.1f} -> {lb.var():8.1f} ({100*(lb.var()/la.var()-1):+5.1f}%)")
elif sys.argv[1] == 'sbs':
    out, la, pa, lb, pb = sys.argv[2:7]
    x, y, w, h = map(int, sys.argv[7:11])
    z = int(sys.argv[11]) if len(sys.argv) > 11 else 1
    A = Image.open(pa).convert('RGB').crop((x, y, x + w, y + h)); B = Image.open(pb).convert('RGB').crop((x, y, x + w, y + h))
    if z > 1: A = A.resize((w * z, h * z), Image.NEAREST); B = B.resize((w * z, h * z), Image.NEAREST)
    W = A.width * 2 + 8; S = Image.new('RGB', (W, A.height + 26), (16, 16, 20))
    S.paste(A, (0, 26)); S.paste(B, (A.width + 8, 26))
    F = ImageFont.load_default(size=16); D = ImageDraw.Draw(S); D.text((6, 3), la, fill=(240, 240, 240), font=F); D.text((A.width + 14, 3), lb, fill=(240, 240, 240), font=F)
    if S.width > 1600: S = S.resize((1600, round(S.height * 1600 / S.width)), Image.LANCZOS)
    S.save(out)
