#!/usr/bin/env python3
"""VALE art: a PNG mask of parts from the bake's part map, for glb_paint_grade.mjs --part-gain.

    python3 art/tools/partmap_mask.py <sid> belt,trousers out.png"""
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from part_lab import PARTMAP  # noqa: E402

sid, parts, out = sys.argv[1:4]
z = np.load(os.path.join(PARTMAP, f"{sid}.npz"))
names = [str(n) for n in z["names"]]
ids = [names.index(p) for p in parts.split(",")]
Image.fromarray((np.isin(z["part"], ids) * 255).astype("uint8")).save(out)
