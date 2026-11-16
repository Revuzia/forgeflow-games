#!/usr/bin/env python3
# PERF s20 — side-by-side sheet (A | B | x4 diff) + statistics per view: mean |d|, mean RGB and RGB std of A and B (the two
# noises are different realisations of one function: the pixels differ, the statistics must not).
#   python3 _harness/arc-work/sheet-s20.py DIR tagA tagB out.png view [view..]
import sys
import numpy as np
from PIL import Image
d, ta, tb, out, views = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5:]
rows = []
for v in views:
    a = Image.open(f'{d}/{ta}-{v}.png').convert('RGB'); b = Image.open(f'{d}/{tb}-{v}.png').convert('RGB')
    A = np.asarray(a).astype(np.float32); B = np.asarray(b).astype(np.float32)
    D = np.abs(A - B)
    # local contrast: std of the image minus its 9x9 box blur (the breakup's strength, free of the large-scale picture)
    def hp(X):
        from PIL import ImageFilter
        bl = np.asarray(Image.fromarray(X.astype(np.uint8)).filter(ImageFilter.BoxBlur(4))).astype(np.float32)
        return (X - bl).std()
    print(f'{v:8s} mean|d| {D.mean():5.2f}  >16: {(D.max(axis=2) > 16).mean() * 100:5.2f} %  mean A {A.mean(axis=(0, 1)).round(1)} B {B.mean(axis=(0, 1)).round(1)}  std A {A.std():.1f} B {B.std():.1f}  detail A {hp(A):.2f} B {hp(B):.2f}')
    row = Image.new('RGB', (a.width * 3, a.height)); row.paste(a, (0, 0)); row.paste(b, (a.width, 0))
    row.paste(Image.fromarray(np.clip(D * 4, 0, 255).astype(np.uint8)), (a.width * 2, 0)); rows.append(row)
sheet = Image.new('RGB', (rows[0].width, sum(r.height for r in rows)))
y = 0
for r in rows: sheet.paste(r, (0, y)); y += r.height
sheet.save(out)
