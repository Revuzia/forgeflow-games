#!/usr/bin/env python3
"""VALE art (lane GF, GF-1): re-grade a shipped fighter GLB's ORM in place; mesh, skin and clips stay byte-identical
(glb_image_swap.py), so post-build GLB edits survive and no Blender is needed.

    python3 art/tools/glb_orm_regrade.py in.glb --out out.glb [--curve 0.5:0.34,0.74:0.46,...] [--part coat:0.6 --sid burdam]
        [--dilate] [--zero-metal] [--q 82] [--size N]

--curve        piecewise-linear roughness remap (G channel), the build's material classes are its input values
--part p:r[,p:r]  multiply a part's roughness so that its median lands on r (bake part map art/.cache/fighters/partmap)
--dilate       UV-island gutter filled from the nearest island texel in all three channels. The bake leaves the gutter at
               roughness about 0 (and AO about 0.57): bilinear and mips pull small islands' roughness toward 0 at the game
               camera (specks of false gloss). A filled gutter also encodes smaller.
--zero-metal   B = 0 (the bible's metal 0; lossy chroma bleed leaves a residue up to 0.39 under metallicFactor 1)
--size N       resize the ORM (data resampled before dilate and grade)
--grade        the shipped grade (ROUGH_CURVE + --dilate + --zero-metal) in place, stamped asset.extras.vale_orm_grade; a stamped
               GLB is refused (the curve must not apply twice). --check: list GLBs without the stamp (exit 1): a rebuild drops it
Prints sizes; the output is verified byte-identical outside the images.

THE SWITCH (GF-1): ROUGH_CURVE is the whole look. Identity below 0.25 (glass keeps 0.12-0.2), the sheen classes (lacquer 0.5,
wood, stone, waxed leather up to 0.8) spread to 0.35-0.47 (STYLE_BIBLE band floor 0.35), matte cloth from 0.87 up unchanged, so a
part's material class reads against its neighbour's. Revert: the commit's GLBs, or git history of the ORM."""
from __future__ import annotations

import argparse
import io
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from chain_motion import accessor  # noqa: E402
from glb_image_swap import image_bytes, image_index, read_glb, swap_images, verify_same_geometry, write_glb  # noqa: E402


ROUGH_CURVE = "0:0,0.25:0.25,0.5:0.35,0.6:0.37,0.74:0.41,0.8:0.47,0.87:0.86,0.95:0.95,1:1"
GRADE_STAMP = "gf1-1"
GLB_BUDGET = 1172 * 1024


def uv_mask(js, b, size: int, material_image_suffix="_base") -> np.ndarray:
    """the texels any UV triangle of a textured primitive touches, at size x size (row 0 = image top; glTF UV v down)"""
    ss = 2
    im = Image.new("L", (size * ss, size * ss), 0)
    dr = ImageDraw.Draw(im)
    for mesh in js["meshes"]:
        for pr in mesh["primitives"]:
            if "TEXCOORD_0" not in pr["attributes"]:
                continue
            uv = accessor(js, b, pr["attributes"]["TEXCOORD_0"]).astype(float)
            acc = js["accessors"][pr["attributes"]["TEXCOORD_0"]]
            if uv.max() > 2.0:      # quantized, not normalized by the reader
                uv = uv / {5121: 255.0, 5123: 65535.0}.get(acc["componentType"], 1.0)
            idx = accessor(js, b, pr["indices"]).reshape(-1, 3).astype(int) if "indices" in pr else np.arange(len(uv)).reshape(-1, 3)
            xy = uv * (size * ss)
            for t in idx:
                dr.polygon([tuple(xy[t[0]]), tuple(xy[t[1]]), tuple(xy[t[2]])], fill=255, outline=255)
    m = np.array(im) > 0
    return m.reshape(size, ss, size, ss).any(axis=(1, 3))


def dilate_fill(a: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """every unmasked texel takes the value of its nearest masked texel (wavefront, 4 + diagonal), then one blur inside
    the gutter so the fill does not ring"""
    h, w = mask.shape
    out = a.astype(np.float32).copy()
    known = mask.copy()
    while not known.all():
        sums = np.zeros_like(out)
        cnt = np.zeros((h, w), dtype=np.float32)
        for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            k = np.roll(known, (dy, dx), (0, 1)).astype(np.float32)
            sums += np.roll(out, (dy, dx), (0, 1)) * k[..., None]
            cnt += k
        new = ~known & (cnt > 0)
        if not new.any():
            break
        out[new] = sums[new] / cnt[new][..., None]
        known |= new
    return out


def parse_curve(s: str):
    pts = sorted((float(a), float(b)) for a, b in (p.split(":") for p in s.split(",")))
    return np.array([p[0] for p in pts]), np.array([p[1] for p in pts])


def regrade(path: str, out: str, curve=None, parts=None, sid=None, dilate=False, zero_metal=False, q=82, size=None, method=6, stamp=None):
    js, b = read_glb(path)
    i = image_index(js, "_orm")
    src = Image.open(io.BytesIO(image_bytes(js, b, i))).convert("RGB")
    if size and size != src.size[0]:
        src = src.resize((size, size), Image.LANCZOS)
    n = src.size[0]
    a = np.array(src).astype(np.float32) / 255.0
    mask = uv_mask(js, b, n)
    if parts:
        from part_lab import PARTMAP
        z = np.load(os.path.join(PARTMAP, f"{sid}.npz"))
        names = [str(x) for x in z["names"]]
        pm = z["part"]
        s = pm.shape[0] / n
        ys = (np.arange(n) * s + s / 2).astype(int)
        pm = pm[ys][:, ys]
        for p, r in parts.items():
            m = pm == names.index(p)
            if m.sum():
                a[..., 1][m] = np.clip(a[..., 1][m] * (r / np.median(a[..., 1][m])), 0.04, 1.0)
    if curve is not None:
        x, y = curve
        g = a[..., 1]
        a[..., 1] = np.where(mask, np.interp(g, x, y), g)
    if zero_metal:
        a[..., 2] = 0.0
    if dilate:
        a = dilate_fill(a, mask)
    buf = io.BytesIO()
    Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype("uint8")).save(buf, "WEBP", quality=q, method=method)
    js2, b2 = swap_images(js, b, {i: buf.getvalue()})
    if stamp:
        js2.setdefault("asset", {}).setdefault("extras", {})["vale_orm_grade"] = stamp
    total = write_glb(out, js2, b2)
    if not verify_same_geometry(path, out):
        raise SystemExit(f"{out}: non-image bytes changed")
    old = len(image_bytes(js, b, i))
    print(f"{os.path.basename(path)}: ORM {old // 1024} -> {len(buf.getvalue()) // 1024} KB, GLB {os.path.getsize(path) // 1024} -> {total // 1024} KB, uv cover {100 * mask.mean():.0f} %")
    return total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("glb", nargs="+")
    ap.add_argument("--out")
    ap.add_argument("--grade", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--curve")
    ap.add_argument("--part")
    ap.add_argument("--sid")
    ap.add_argument("--dilate", action="store_true")
    ap.add_argument("--zero-metal", action="store_true")
    ap.add_argument("--q", type=int, default=86)
    ap.add_argument("--size", type=int)
    A = ap.parse_args()
    if A.check or A.grade:
        bad = 0
        for g in A.glb:
            js, _ = read_glb(g)
            st = (js.get("asset", {}).get("extras") or {}).get("vale_orm_grade")
            if A.check:
                if st != GRADE_STAMP:
                    bad += 1
                    print(f"{g}: no ORM grade (a rebuild drops it: glb_orm_regrade.py --grade)")
                continue
            if st:
                print(f"{g}: already graded ({st}), skipped")
                continue
            tmp = g + ".grade.tmp"
            q = A.q
            limit = os.path.getsize(g) if os.path.getsize(g) > GLB_BUDGET else GLB_BUDGET
            while regrade(g, tmp, parse_curve(ROUGH_CURVE), None, None, True, True, q, None, stamp=GRADE_STAMP) > limit and q > 50:
                q -= 6                       # a base fighter stays inside the build budget (export.py, 1172 KiB)
            os.replace(tmp, g)
        sys.exit(1 if bad else 0)
    A.glb = A.glb[0]
    parts = {k: float(v) for k, v in (p.split(":") for p in A.part.split(","))} if A.part else None
    regrade(A.glb, A.out, parse_curve(A.curve) if A.curve else None, parts, A.sid, A.dilate, A.zero_metal, A.q, A.size)


if __name__ == "__main__":
    main()
