#!/usr/bin/env python3
"""VALE art: id-masked paint richness of a shipped fighter GLB's albedo (closing CW5 lisvel-M3).

    python3 art/tools/part_paint_detail.py art/out/fighters/lisvel/lisvel.glb [--sid lisvel] tabard,tunic,legs

For each part: L* spread (p90 - p10 over the part's texels) and local detail (the std of L* minus its s=16 px Gaussian
blur at 2048, over texels whose whole neighbourhood is that part, so a UV island's edge does not count)."""
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from part_lab import PARTMAP, glb_base_texture, srgb_to_lab  # noqa: E402

args = sys.argv[1:]
sid = None
if "--sid" in args:
    i = args.index("--sid")
    sid = args[i + 1]
    del args[i:i + 2]
glb, parts = args[0], args[1].split(",")
sid = sid or os.path.basename(glb)[:-4]
z = np.load(os.path.join(PARTMAP, f"{sid}.npz"))
names = [str(n) for n in z["names"]]
tex = glb_base_texture(glb)
pm = np.array(Image.fromarray(z["part"].astype(np.int32)).resize(tex.shape[1::-1], Image.NEAREST))
L = srgb_to_lab(tex)[..., 0]
blur = ndi.gaussian_filter(L, 16.0)
out = []
for p in parts:
    m = pm == names.index(p)
    core = ndi.binary_erosion(m, iterations=8)
    q = np.percentile(L[m], [10, 90])
    out.append(f"{p}: spread {q[1] - q[0]:.0f} detail {np.std((L - blur)[core]):.1f}")
print(sid, " | ".join(out))
