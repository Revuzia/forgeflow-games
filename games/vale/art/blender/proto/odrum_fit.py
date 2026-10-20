"""ART 2.0 fit check for Odrum: the sculpt's silhouette over the concept's front and back paintings on a
10 cm grid (the method proved on Marund, proto/marund_v2.py), plus a side silhouette for the depths.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/odrum_fit.py \
        [-- --voxel 0.008 --parts coat,mask]

Needs the plates first (proto/odrum_plates.py). Writes art/renders/fighters/odrum/fit_{front,back,side}.png:
the painting with every part's silhouette tinted and outlined in its own colour (the painted figure's own
outline in white), and prints the IoU of the model's silhouette against the painted one per view.
Conventions: Z up, metres, the model faces -Y, soles at z = 0; the right hand (the yoke) is at -X.
"""
from __future__ import annotations

import colorsys
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "fighters"))
from common import scene  # noqa: E402
from common.hifi import project  # noqa: E402

import odrum  # noqa: E402

CACHE = os.path.join(scene.CACHE_DIR, "concept")
OUT = os.path.join(scene.RENDERS_DIR, "fighters", "odrum")
WIN = (-0.86, 0.86, -0.02, 1.95)


def args():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--voxel", type=float, default=0.008)
    p.add_argument("--parts", default="")
    p.add_argument("--scale", type=float, default=1.0, help="output scale vs the plate's pixels")
    return p.parse_args(scene.script_args())


def silhouettes(voxel, only):
    out = []
    for name, S, vs, role, bind, tris in odrum.sculpts():
        if only and name not in only:
            continue
        D, lo = S.evaluate(voxel)
        ins = D < 0
        out.append((name, ins.any(axis=1), ins.any(axis=0), lo, voxel))
    return out


def lookup(occ, lo, vox, a, b, ia, ib):
    i = np.round((a - lo[ia]) / vox).astype(np.int64)
    j = np.round((b - lo[ib]) / vox).astype(np.int64)
    ok = (i >= 0) & (i < occ.shape[0]) & (j >= 0) & (j < occ.shape[1])
    res = np.zeros(a.shape, dtype=bool)
    res[ok] = occ[i[ok], j[ok]]
    return res


def edge(m):
    e = np.zeros_like(m)
    e[1:-1, 1:-1] = m[1:-1, 1:-1] & ~(m[:-2, 1:-1] & m[2:, 1:-1] & m[1:-1, :-2] & m[1:-1, 2:])
    return e


def thicken(m, r=1):
    o = m.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            o |= np.roll(np.roll(m, dy, 0), dx, 1)
    return o


def colour(i, n):
    r, g, b = colorsys.hsv_to_rgb((i * 0.61803) % 1.0, 0.85, 1.0)
    return np.array([r, g, b], dtype=np.float32)


def view(side, plates, sils, mask_full):
    k = plates.ppm(side)
    x0, x1, z0, z1 = WIN
    pa, pb = plates.to_px(side, np.array([x0, x1]), np.array([z1, z0]))
    W, H = plates.size
    c0, c1 = max(0, int(min(pa))), min(W, int(max(pa)))
    r0, r1 = max(0, int(pb[0])), min(H, int(pb[1]))
    img = plates.img[side][r0:r1, c0:c1].copy()
    yy, xx = np.mgrid[r0:r1, c0:c1] + 0.5
    X, Z = plates.to_world(side, xx, yy)
    union = np.zeros(X.shape, dtype=bool)
    out = img * 0.82
    for i, (name, occ_xz, _, lo, vox) in enumerate(sils):
        m = lookup(occ_xz, lo, vox, X, Z, 0, 2)
        union |= m
        c = colour(i, len(sils))
        out[m] = out[m] * 0.78 + c * 0.22
        e = thicken(edge(m), 1)
        out[e] = c
    painted = mask_full[r0:r1, c0:c1]
    out[thicken(edge(painted), 1)] = (1.0, 1.0, 1.0)
    # 10 cm grid
    for xv in np.arange(-0.8, 0.81, 0.1):
        u = int(round(plates.to_px(side, xv, 0.0)[0] - c0))
        if 0 <= u < out.shape[1]:
            out[:, u] = out[:, u] * 0.5 + np.array([0.9, 0.1, 0.1]) * (0.5 if abs(xv) > 1e-6 else 1.0)
    for zv in np.arange(0.0, 1.95, 0.1):
        v = int(round(plates.to_px(side, 0.0, zv)[1] - r0))
        if 0 <= v < out.shape[0]:
            out[v] = out[v] * 0.5 + np.array([0.9, 0.1, 0.1]) * 0.5
    inter = (union & painted).sum()
    iou = inter / max(1, (union | painted).sum())
    return out, iou, union, painted


def side_view(sils, scale=500):
    x0, x1, z0, z1 = -0.45, 0.45, -0.02, 1.95
    W, H = int((x1 - x0) * scale), int((z1 - z0) * scale)
    yy, xx = np.mgrid[0:H, 0:W] + 0.5
    Y = x0 + xx / scale
    Z = z1 - yy / scale
    out = np.full((H, W, 3), 0.85, dtype=np.float32)
    for i, (name, _, occ_yz, lo, vox) in enumerate(sils):
        m = lookup(occ_yz, lo, vox, Y, Z, 1, 2)
        c = colour(i, len(sils))
        out[m] = out[m] * 0.6 + c * 0.4
        out[thicken(edge(m), 1)] = c * 0.7
    for v in np.arange(-0.4, 0.41, 0.1):
        u = int(round((v - x0) * scale))
        out[:, u] = (0.6, 0.1, 0.1) if abs(v) > 1e-6 else (0.1, 0.1, 0.9)
    for zv in np.arange(0.0, 1.95, 0.1):
        r = int(round((z1 - zv) * scale))
        out[r] = (0.6, 0.1, 0.1)
    return out


def main():
    a = args()
    only = set(filter(None, a.parts.split(",")))
    plates = project.Plates(CACHE, "odrum", odrum.HEIGHT)
    mask = project.load_rgb(os.path.join(CACHE, "odrum_mask.png"))[..., 0] > 0.5
    # the plates' cut is eroded 9 px off the painted outline: grow it back for the comparison
    mask = thicken(mask, 9)
    sils = silhouettes(a.voxel, only)
    os.makedirs(OUT, exist_ok=True)
    rep = {}
    for side in ("front", "back"):
        img, iou, _, _ = view(side, plates, sils, mask)
        project.save_rgb(np.clip(img, 0, 1), os.path.join(OUT, f"fit_{side}.png"))
        rep[side] = round(float(iou), 4)
    project.save_rgb(side_view(sils), os.path.join(OUT, "fit_side.png"))
    print("FIT", json.dumps({"iou": rep, "parts": [s[0] for s in sils]}))


if __name__ == "__main__":
    main()
