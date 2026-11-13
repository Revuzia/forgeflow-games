#!/usr/bin/env python3
# PERF s16 — A/B pixel diff: mean |d| /255 over RGB, the share of pixels off by > 16, and a x4 amplified diff image.
#   python3 _harness/arc-work/imgdiff.py A.png B.png [OUT.png]
import sys
import numpy as np
from PIL import Image
a = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(np.int16)
b = np.asarray(Image.open(sys.argv[2]).convert('RGB')).astype(np.int16)
d = np.abs(a - b)
print(f"{sys.argv[1].split('/')[-1]} vs {sys.argv[2].split('/')[-1]}: mean |d| {d.mean():.2f}/255, pixels > 16: {(d.max(axis=2) > 16).mean() * 100:.2f} %")
if len(sys.argv) > 3: Image.fromarray(np.clip(d * 4, 0, 255).astype(np.uint8)).save(sys.argv[3])
