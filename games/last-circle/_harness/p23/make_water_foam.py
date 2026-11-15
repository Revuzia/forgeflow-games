#!/usr/bin/env python
"""Builds assets/tex/water_foam.png IN HOUSE (CC0 - no third-party pixels): a 512 px tileable foam pattern, single channel.

Tileable Worley (cellular) noise on a periodic grid - foam reads as bubbly cells with lacy ridges between them (F2 - F1, the cell walls) -
plus two octaves of periodic value noise to break the cells up. Its tone curve is set to fixed quantiles (black 5 %, median ~0.235,
95 % ~0.63: the shader's smoothstep thresholds 0.12-0.5 / 0.3-0.75 were tuned on a pattern with these statistics). Deterministic (seed 7).
    python _harness/p23/make_water_foam.py [out.png]
"""
import sys
import numpy as np
from PIL import Image

N, SEED = 512, 7
rng = np.random.default_rng(SEED)
yy, xx = np.mgrid[0:N, 0:N].astype(np.float64) / N


def worley(cells):
    pts = rng.random((cells, cells, 2))
    f1 = np.full((N, N), 9.0)
    f2 = np.full((N, N), 9.0)
    gx, gy = xx * cells, yy * cells
    cx, cy = np.floor(gx).astype(int), np.floor(gy).astype(int)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            nx, ny = cx + dx, cy + dy
            p = pts[ny % cells, nx % cells]
            d = np.hypot(nx + p[..., 0] - gx, ny + p[..., 1] - gy)
            f2 = np.where(d < f1, f1, np.minimum(f2, d))
            f1 = np.minimum(f1, d)
    return f1, f2


def value_noise(cells):
    g = rng.random((cells, cells))
    gx, gy = xx * cells, yy * cells
    x0, y0 = np.floor(gx).astype(int), np.floor(gy).astype(int)
    fx, fy = gx - x0, gy - y0
    sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a, b = g[y0 % cells, x0 % cells], g[y0 % cells, (x0 + 1) % cells]
    c, d = g[(y0 + 1) % cells, x0 % cells], g[(y0 + 1) % cells, (x0 + 1) % cells]
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy


f1, f2 = worley(14)
walls = 1.0 - np.clip((f2 - f1) / 0.35, 0, 1)            # bright lacy walls between bubbles
g1, g2 = worley(31)
small = 1.0 - np.clip((g2 - g1) / 0.3, 0, 1)
v = 0.55 * walls + 0.3 * small + 0.25 * value_noise(8) + 0.12 * value_noise(32)
v = v * (0.55 + 0.9 * value_noise(4))                      # patches of dense / thin foam
# tone curve to fixed quantiles: 5 % -> 0, 25 % -> 0.082, 50 % -> 0.235, 75 % -> 0.412, 95 % -> 0.631, max -> 1
qs = np.percentile(v, [5, 25, 50, 75, 95, 100])
out = np.interp(v, qs, [0.0, 0.082, 0.235, 0.412, 0.631, 1.0])
out = np.where(v < qs[0], 0.0, out)
img = Image.fromarray(np.round(out * 255).astype(np.uint8), "L")
dst = sys.argv[1] if len(sys.argv) > 1 else "assets/tex/water_foam.png"
img.save(dst, optimize=True)
a = np.asarray(img, float) / 255
print("wrote", dst, img.size, "mean %.4f" % a.mean(), "pct", np.round(np.percentile(a, [5, 25, 50, 75, 95]), 3),
      "seam dx %.4f dy %.4f" % (np.abs(a[:, 0] - a[:, -1]).mean(), np.abs(a[0] - a[-1]).mean()))
