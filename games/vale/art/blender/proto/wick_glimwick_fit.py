"""ART 2.0 fit check for the glimwick (both factions): every sculpted part's silhouette over the concept's front
and back paintings on a 10 cm grid (the method proved on Marund, proto/marund_v2.py / odrum_fit.py), plus a
side silhouette for the depths and a 64 px silhouette pair (brief §1: the 64 px read, IoU across factions).

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/wick_glimwick_fit.py \
        -- [--faction aubade|serenade|both] [--voxel 0.006] [--parts hood,cloak]

Needs the concept plates (art/tools/concept_plates.py wicks/glimwick_<faction>). Writes
art/renders/units/_glimwick/fit_<faction>_{front,back,side}.png and sil64.png; prints the IoU of the BODY's
silhouette (props excluded: the brief moves the lamp above the concepts' hood-height lamp) against the painted one.
"""
from __future__ import annotations

import colorsys
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "units"))
from common import scene  # noqa: E402
from common.hifi import project  # noqa: E402

import wick_glimwick as gw  # noqa: E402

CACHE = os.path.join(scene.CACHE_DIR, "concept")
OUT = gw.FIT_DIR
WIN = (-0.62, 0.62, -0.02, 1.40)
PROPS = {"pole", "finial", "crook", "lamp_panes", "lamp_frame", "cord", "knob_pole", "ring", "lamp_globe", "lamp_cage",
         "lamp_resin"}


def args():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--faction", default="both")
    p.add_argument("--voxel", type=float, default=0.006)
    p.add_argument("--parts", default="")
    return p.parse_args(scene.script_args())


def silhouettes(faction, voxel, only):
    out = []
    for p in gw.parts_for(faction):
        if only and p["name"] not in only:
            continue
        D, lo = p["S"].evaluate(min(voxel, gw.VOXEL * p["vs"] * 1.4))
        vox = min(voxel, gw.VOXEL * p["vs"] * 1.4)
        ins = D < 0
        prop = p["name"] in PROPS or (p["name"] == "knob" and faction == "serenade")
        out.append((p["name"], ins.any(axis=1), ins.any(axis=0), lo, vox, prop))
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


def colour(i):
    r, g, b = colorsys.hsv_to_rgb((i * 0.61803) % 1.0, 0.85, 1.0)
    return np.array([r, g, b], dtype=np.float32)


def view(side, plates, sils, mask_full):
    x0, x1, z0, z1 = WIN
    pa, pb = plates.to_px(side, np.array([x0, x1]), np.array([z1, z0]))
    W, H = plates.size
    c0, c1 = max(0, int(min(pa))), min(W, int(max(pa)))
    r0, r1 = max(0, int(pb[0])), min(H, int(pb[1]))
    img = plates.img[side][r0:r1, c0:c1].copy()
    # the plates are edge-padded beyond the figure: show ONLY this view's own painted figure (the padding
    # and the neighbouring view are flat grey), so no stray silhouette can appear between the views
    own = mask_full[r0:r1, c0:c1].copy()
    half = W // 2
    cols = np.arange(c0, c1)
    own[:, (cols >= half) if side == "front" else (cols < half)] = False
    img[~thicken(own, 6)] = 0.72
    yy, xx = np.mgrid[r0:r1, c0:c1] + 0.5
    X, Z = plates.to_world(side, xx, yy)
    body = np.zeros(X.shape, dtype=bool)
    out = img * 0.82
    for i, (name, occ_xz, _, lo, vox, prop) in enumerate(sils):
        m = lookup(occ_xz, lo, vox, X, Z, 0, 2)
        if not prop:
            body |= m
        c = colour(i)
        out[m] = out[m] * 0.78 + c * 0.22
        out[thicken(edge(m), 1)] = c
    painted = own
    out[thicken(edge(painted), 1)] = (1.0, 1.0, 1.0)
    for xv in np.arange(-0.6, 0.61, 0.1):
        u = int(round(plates.to_px(side, xv, 0.0)[0] - c0))
        if 0 <= u < out.shape[1]:
            out[:, u] = out[:, u] * 0.5 + np.array([0.9, 0.1, 0.1]) * (0.5 if abs(xv) > 1e-6 else 1.0)
    for zv in np.arange(0.0, 1.41, 0.1):
        v = int(round(plates.to_px(side, 0.0, zv)[1] - r0))
        if 0 <= v < out.shape[0]:
            out[v] = out[v] * 0.5 + np.array([0.1, 0.1, 0.9]) * 0.5
    # the painted figure without the props: everything left of / above the pole column is prop
    pbody = painted.copy()
    pole_cols = (X < -0.21) if side == "front" else (X < -0.21)
    pbody &= ~(pole_cols & (Z > 0.62))
    pbody &= ~(X < -0.30)
    inter = (body & pbody).sum()
    iou = inter / max(1, (body | pbody).sum())
    return out, iou


def side_view(sils, scale=500):
    y0, y1, z0, z1 = -0.45, 0.40, -0.02, 1.40
    W, H = int((y1 - y0) * scale), int((z1 - z0) * scale)
    yy, xx = np.mgrid[0:H, 0:W] + 0.5
    Y = y0 + xx / scale
    Z = z1 - yy / scale
    out = np.full((H, W, 3), 0.85, dtype=np.float32)
    for i, (name, _, occ_yz, lo, vox, prop) in enumerate(sils):
        m = lookup(occ_yz, lo, vox, Y, Z, 1, 2)
        c = colour(i)
        out[m] = out[m] * 0.6 + c * 0.4
        out[thicken(edge(m), 1)] = c * 0.7
    for v in np.arange(-0.4, 0.41, 0.1):
        u = int(round((v - y0) * scale))
        if 0 <= u < W:
            out[:, u] = (0.6, 0.1, 0.1) if abs(v) > 1e-6 else (0.1, 0.1, 0.9)
    for zv in np.arange(0.0, 1.41, 0.1):
        r = int(round((z1 - zv) * scale))
        if 0 <= r < H:
            out[r] = (0.6, 0.1, 0.1)
    return out


def sil64(sils):
    """front silhouette at 64 px tall (brief §1 read), as a mask"""
    n = 64
    z1 = 1.36
    s = n / z1
    W = int(1.2 * s)
    yy, xx = np.mgrid[0:n, 0:W] + 0.5
    X = -0.6 + xx / s
    Z = z1 - yy / s
    m = np.zeros(X.shape, dtype=bool)
    for name, occ_xz, _, lo, vox, prop in sils:
        m |= lookup(occ_xz, lo, vox, X, Z, 0, 2)
    return m


def main():
    a = args()
    only = set(filter(None, a.parts.split(",")))
    os.makedirs(OUT, exist_ok=True)
    facs = ("aubade", "serenade") if a.faction == "both" else (a.faction,)
    rep, s64 = {}, {}
    for fac in facs:
        concept, h, _ = gw.PLATES[fac]
        cid = concept + "_glim" if os.path.isfile(os.path.join(CACHE, concept + "_glim_plates.json")) else concept
        plates = project.Plates(CACHE, cid, h)
        mask = project.load_rgb(os.path.join(CACHE, f"{concept}_mask.png"))[..., 0] > 0.5
        mask = thicken(mask, 9)
        sils = silhouettes(fac, a.voxel, only)
        rep[fac] = {}
        for side in ("front", "back"):
            img, iou = view(side, plates, sils, mask)
            project.save_rgb(np.clip(img, 0, 1), os.path.join(OUT, f"fit_{fac}_{side}.png"))
            rep[fac][side] = round(float(iou), 4)
        project.save_rgb(side_view(sils), os.path.join(OUT, f"fit_{fac}_side.png"))
        s64[fac] = sil64(sils)
    if len(s64) == 2:
        A, B = s64["aubade"], s64["serenade"]
        rep["iou64_factions"] = round(float((A & B).sum() / max(1, (A | B).sum())), 4)
        img = np.ones((64, A.shape[1] * 2 + 8, 3), dtype=np.float32)
        img[:, :A.shape[1]][A] = 0.1
        img[:, A.shape[1] + 8:][B] = 0.1
        big = np.repeat(np.repeat(img, 4, 0), 4, 1)
        project.save_rgb(big, os.path.join(OUT, "sil64.png"))
    print("FIT", json.dumps(rep))


if __name__ == "__main__":
    main()
