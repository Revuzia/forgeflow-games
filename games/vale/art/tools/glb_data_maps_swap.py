#!/usr/bin/env python3
"""VALE art (lane GF, GF-3): put re-baked data maps (art/tools/rebake_data_maps.py) into a copy of a shipped GLB; mesh and clips
byte-identical. The normal map's gutter is filled from the islands. ORM: AO (R) from the re-bake, roughness (G) from the
shipped ORM upscaled (the build's per-part hooks live there), metal 0.

    python3 art/tools/glb_data_maps_swap.py in.glb <bake_dir>/<sid> --out out.glb [--curve ...] [--qn 82] [--qo 82] [--normal-only]
Prints sizes and, as a sanity check of UV agreement, the correlation of the re-bake (at the shipped size) with the shipped normal."""
import argparse
import io
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from glb_image_swap import image_bytes, image_index, read_glb, swap_images, verify_same_geometry, write_glb  # noqa: E402
from glb_orm_regrade import dilate_fill, parse_curve, uv_mask  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("glb")
ap.add_argument("bake")
ap.add_argument("--out", required=True)
ap.add_argument("--curve")
ap.add_argument("--qn", type=int, default=82)
ap.add_argument("--qo", type=int, default=82)
ap.add_argument("--normal-only", action="store_true")
A = ap.parse_args()
js, b = read_glb(A.glb)
ni, oi = image_index(js, "_normal"), image_index(js, "_orm")
sn = Image.open(io.BytesIO(image_bytes(js, b, ni))).convert("RGB")
so = Image.open(io.BytesIO(image_bytes(js, b, oi))).convert("RGB")
nn = Image.open(A.bake + "_normal.png").convert("RGB")
no = Image.open(A.bake + "_orm.png").convert("RGB")
n = nn.size[0]
mask = uv_mask(js, b, n)
a = np.array(nn.resize(sn.size, Image.LANCZOS), float)[..., :2].ravel()
c = np.array(sn, float)[..., :2].ravel()
print("corr rebake vs shipped normal %.3f" % np.corrcoef(a, c)[0, 1])
na = dilate_fill(np.array(nn).astype(np.float32) / 255.0, mask)
buf = io.BytesIO()
Image.fromarray((np.clip(na, 0, 1) * 255 + 0.5).astype("uint8")).save(buf, "WEBP", quality=A.qn, method=6)
new = {ni: buf.getvalue()}
if not A.normal_only:
    oa = np.array(no).astype(np.float32) / 255.0
    g = np.array(so.resize((n, n), Image.BICUBIC)).astype(np.float32)[..., 1] / 255.0
    if A.curve:
        x, y = parse_curve(A.curve)
        g = np.interp(g, x, y)
    oa[..., 1] = g
    oa[..., 2] = 0
    oa = dilate_fill(oa, mask)
    bo = io.BytesIO()
    Image.fromarray((np.clip(oa, 0, 1) * 255 + 0.5).astype("uint8")).save(bo, "WEBP", quality=A.qo, method=6)
    new[oi] = bo.getvalue()
js2, b2 = swap_images(js, b, new)
total = write_glb(A.out, js2, b2)
if not verify_same_geometry(A.glb, A.out):
    raise SystemExit("non-image bytes changed")
print(os.path.basename(A.glb), "normal", len(image_bytes(js, b, ni)) // 1024, "->", len(new[ni]) // 1024, "KB; ORM", len(image_bytes(js, b, oi)) // 1024, "->", len(new.get(oi, b"")) // 1024, "KB; GLB", os.path.getsize(A.glb) // 1024, "->", total // 1024, "KB")
