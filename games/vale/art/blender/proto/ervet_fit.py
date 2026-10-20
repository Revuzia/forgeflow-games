"""ART 2.0 fit check for Ervet: the sculpt's silhouettes over the concept on a 10 cm grid.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/ervet_fit.py -- [--voxel 0.009]

Needs the plates (art/blender/proto/ervet_plates.py). Builds the rig from fighters/ervet.py PROPORTIONS, meshes
every sculpt part and splats it into the plate frames. Writes art/renders/fighters/ervet/_fit/:
  front.png / back.png   the concept with the model outline (white) and the concept's cut (yellow), every part
                         tinted in its own colour, grid 10 cm (0.5 m lines stronger)
  side.png / top.png     the model alone from the side (-X looking +X: front to the left) and from above
and prints the silhouette IoU against the concept cut per view.
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import time

import bpy  # noqa: F401
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from common import rig, scene  # noqa: E402
from common.hifi import project  # noqa: E402

spec_path = os.path.join(os.path.dirname(HERE), "fighters", "ervet.py")
_s = importlib.util.spec_from_file_location("ervet_spec", spec_path)
E = importlib.util.module_from_spec(_s)
_s.loader.exec_module(E)

CACHE = os.path.join(scene.CACHE_DIR, "concept")
OUT = os.path.join(scene.RENDERS_DIR, "fighters", "ervet", "_fit")


def args():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--voxel", type=float, default=0.009)
    p.add_argument("--only", default="")
    return p.parse_args(scene.script_args())


PALETTE = np.array([[230, 60, 60], [60, 200, 90], [70, 120, 240], [240, 200, 40], [200, 80, 220], [40, 210, 220],
                    [250, 140, 40], [150, 230, 80], [120, 90, 250], [250, 90, 160], [90, 250, 200], [200, 200, 200]],
                   dtype=np.float32) / 255.0


def splat(img_shape, px, py, r=2):
    H, W = img_shape
    m = np.zeros((H, W), bool)
    xi = np.round(px).astype(int)
    yi = np.round(py).astype(int)
    for dx in range(-r, r + 1):
        for dy in range(-r, r + 1):
            if dx * dx + dy * dy > r * r + 1:
                continue
            x, y = xi + dx, yi + dy
            ok = (x >= 0) & (x < W) & (y >= 0) & (y < H)
            m[y[ok], x[ok]] = True
    return m


def dilate(m, it=1):
    for _ in range(it):
        n = m.copy()
        n[1:] |= m[:-1]
        n[:-1] |= m[1:]
        n[:, 1:] |= m[:, :-1]
        n[:, :-1] |= m[:, 1:]
        m = n
    return m


def erode(m, it=1):
    return ~dilate(~m, it)


def outline(m):
    return m & ~erode(m, 1)


def grid(img, to_px, xr, zr, horiz="x"):
    H, W = img.shape[:2]
    for v in np.arange(round(xr[0], 1), xr[1] + 1e-6, 0.1):
        x = int(round(float(to_px(v, None)[0])))
        if 0 <= x < W:
            major = abs(round(v * 10)) % 5 == 0
            img[:, x] = img[:, x] * (0.4 if major else 0.75) + (np.array([1, 0, 0]) * (0.6 if major else 0.25))
    for v in np.arange(round(zr[0], 1), zr[1] + 1e-6, 0.1):
        y = int(round(float(to_px(None, v)[1])))
        if 0 <= y < H:
            major = abs(round(v * 10)) % 5 == 0
            img[y, :] = img[y, :] * (0.4 if major else 0.75) + (np.array([0, 0, 1]) * (0.6 if major else 0.25))


def main():
    a = args()
    os.makedirs(OUT, exist_ok=True)
    scene.reset()
    info = rig.build_rig(E.PROPORTIONS, name="fit_rig")
    J = info.joints
    for k in ("shoulder.R", "elbow.R", "wrist.R", "palm.R", "hip.R", "knee.R", "ankle.R", "neck_base", "head_base", "crown"):
        print(f"[fit] joint {k}: {tuple(round(c, 3) for c in J[k])}")
    sw = E.sword_frame(J)
    print("[fit] sword G", np.round(sw["G"], 3), "D", np.round(sw["D"], 3), "C", np.round(sw["C"], 3))
    t0 = time.time()
    parts = []
    only = set(a.only.split(",")) if a.only else None
    for name, S, vs, role, bind, tris, form in E.sculpts(J):
        if only and name not in only:
            continue
        if form not in (None, "base"):
            continue
        if role == "accent":
            pass
        v, q = S.mesh(a.voxel * min(vs, 1.0))
        # face centres too (denser splat)
        fc = v[q].mean(axis=1) if len(q) else np.zeros((0, 3))
        pts = np.concatenate([v, fc], 0)
        parts.append((name, pts))
        print(f"[fit] {name}: {len(v)} verts ({time.time() - t0:.1f}s)")
    meta = json.load(open(os.path.join(CACHE, "ervet_plates.json")))
    plates = project.Plates(CACHE, "ervet", E.HEIGHT)
    concept = plates.img["front"]
    H, W = concept.shape[:2]
    mask = project.load_rgb(os.path.join(CACHE, "ervet_mask.png"))[..., 0] > 0.5
    report = {}
    for side in ("front", "back"):
        x0, x1 = (0, W // 2) if side == "front" else (W // 2, W)
        img = concept.copy() * 0.85
        allm = np.zeros((H, W), bool)
        for i, (name, pts) in enumerate(parts):
            px, py = plates.to_px(side, pts[:, 0], pts[:, 2])
            m = splat((H, W), px, py, 2)
            m = erode(dilate(m, 2), 2)
            m[:, :x0] = False
            m[:, x1:] = False
            allm |= m
            c = PALETTE[i % len(PALETTE)]
            img[m] = img[m] * 0.8 + c * 0.2
            o = outline(m)
            img[o] = c
        mk = mask.copy()
        mk[:, :x0] = False
        mk[:, x1:] = False
        inter = (allm & mk).sum()
        union = (allm | mk).sum()
        report[side] = round(float(inter / max(union, 1)), 3)
        img[outline(dilate(mk, 1))] = (1.0, 0.95, 0.1)
        img[outline(allm)] = (1.0, 1.0, 1.0)
        grid(img, lambda x, z: plates.to_px(side, x if x is not None else 0.0, z if z is not None else 0.0),
             (-1.0, 1.0), (0.0, 2.3))
        # crop to the figure
        i = meta[side]
        k = plates.ppm(side)
        cx = i["cx"]
        xa, xb = int(cx - 0.95 * k), int(cx + 0.95 * k)
        ya, yb = int(i["ground"] - 2.25 * k), int(i["ground"] + 0.05 * k)
        crop = img[max(0, ya):yb, max(0, xa):xb]
        project.save_rgb(np.clip(crop, 0, 1), os.path.join(OUT, f"{side}.png"))
    # side + top views of the model alone (front of the model to the left in the side view)
    for view in ("side", "top"):
        S = 500.0                                       # px per m
        Wd, Hd = (int(1.6 * S), int(2.3 * S)) if view == "side" else (int(2.0 * S), int(1.6 * S))
        img = np.ones((Hd, Wd, 3), np.float32) * 0.92
        if view == "side":
            to_px = lambda u, z: ((u if u is not None else 0.0) * S + Wd * 0.5, Hd - 0.05 * S - (z if z is not None else 0.0) * S)  # noqa: E731
        else:
            to_px = lambda x, y: ((x if x is not None else 0.0) * S + Wd * 0.5, (y if y is not None else 0.0) * S + Hd * 0.5)  # noqa: E731
        for i, (name, pts) in enumerate(parts):
            if view == "side":
                px, py = to_px(pts[:, 1], pts[:, 2])
            else:
                px, py = to_px(pts[:, 0], pts[:, 1])
            m = erode(dilate(splat((Hd, Wd), px, py, 1), 2), 2)
            c = PALETTE[i % len(PALETTE)]
            img[m] = img[m] * 0.5 + c * 0.5
            img[outline(m)] = c * 0.6
        grid(img, to_px, (-1.0, 1.0), (-0.8, 2.3) if view == "side" else (-0.8, 0.8))
        project.save_rgb(np.clip(img, 0, 1), os.path.join(OUT, f"{view}.png"))
    # legend
    leg = {name: [int(c * 255) for c in PALETTE[i % len(PALETTE)]] for i, (name, _) in enumerate(parts)}
    json.dump({"iou": report, "legend": leg}, open(os.path.join(OUT, "fit.json"), "w"), indent=1)
    print(f"[fit] IoU {report}  in {time.time() - t0:.1f}s")


main()
