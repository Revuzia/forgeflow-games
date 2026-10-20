"""ART 2.0 fit check for brightwick: the GAME mesh (decimated, skinned, as the pipeline builds it) posed in the
PAINT POSE and drawn over the concept plates part by part, on a 10 cm grid (the method of proto/marund_v2.py,
proto/odrum_fit.py), plus the IoU of the model's silhouette against the painted one per view.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/wick_brightwick_fit.py \
        -- [--faction aubade|serenade|both] [--pose paint|guard]

Needs the plates (proto/wick_brightwick_plates.py). Writes art/renders/units/fit_brightwick_<faction>.jpg (front | back:
each part tinted + outlined in its own colour, the painted figure's outline white, the 10 cm grid red) and prints
{faction: {front_iou, back_iou}}. The front view uses the paint pose turned by the faction's PAINT_YAW, as the
projection does.
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

from common import fighter, materials, pipeline, rig, scene  # noqa: E402
from common.hifi import project  # noqa: E402

import wick_brightwick as bw  # noqa: E402

CACHE = os.path.join(scene.CACHE_DIR, "concept")
OUT = os.path.join(scene.RENDERS_DIR, "units")
WIN = (-0.80, 0.90, -0.03, 1.92)


def args():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--faction", default="both")
    p.add_argument("--pose", default="paint", choices=("paint", "guard", "rest"))
    return p.parse_args(scene.script_args())


def build_mesh(fac: str):
    spec = bw.Brightwick(fac)
    scene.reset()
    col = scene.collection(spec.ID)
    ctx = fighter.Context(spec=spec, col=col, skin=None, args=None, timer=scene.Timer(spec.ID))
    ctx.palette = dict(spec.PALETTE)
    ctx.info = rig.build_rig(spec.PROPORTIONS, name=f"{spec.ID}_rig", col=col)
    spec.rig_extras(ctx)
    ctx.gradient = pipeline._gradient(spec)
    ctx.mats = materials.bible_set(ctx.palette, ctx.gradient)
    parts = spec.model(ctx)
    body, accent, highs, src, st = pipeline.prepare_lows(ctx, parts)
    return spec, ctx, parts, body, accent


def tris_of(obj, co):
    me = obj.data
    me.calc_loop_triangles()
    nt = len(me.loop_triangles)
    tv = np.empty(nt * 3, dtype=np.int64)
    me.loop_triangles.foreach_get("vertices", tv)
    tv = tv.reshape(nt, 3)
    a = me.attributes.get("vale_part")
    pv = np.zeros(len(me.vertices), dtype=np.int64)
    if a is not None:
        a.data.foreach_get("value", pv)
    return co[tv], pv[tv[:, 0]]


def raster(tri_xy, pid, W, H, nparts):
    """per-part coverage masks (nparts, H, W) of triangles given in pixel coords"""
    out = np.zeros((nparts, H, W), dtype=bool)
    for t in range(len(tri_xy)):
        a, b, c = tri_xy[t]
        x0, x1 = int(max(0, np.floor(min(a[0], b[0], c[0])))), int(min(W - 1, np.ceil(max(a[0], b[0], c[0]))))
        y0, y1 = int(max(0, np.floor(min(a[1], b[1], c[1])))), int(min(H - 1, np.ceil(max(a[1], b[1], c[1]))))
        if x1 < x0 or y1 < y0:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(den) < 1e-9:
            continue
        w0 = ((b[1] - c[1]) * (gx - c[0]) + (c[0] - b[0]) * (gy - c[1])) / den
        w1 = ((c[1] - a[1]) * (gx - c[0]) + (a[0] - c[0]) * (gy - c[1])) / den
        m = (w0 >= 0) & (w1 >= 0) & (1 - w0 - w1 >= 0)
        out[pid[t], y0:y1 + 1, x0:x1 + 1] |= m
    return out


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


def view(side, plates, co, objs, names, mask_full):
    x0, x1, z0, z1 = WIN
    xs, zs = plates.to_px(side, np.array([x0, x1]), np.array([z1, z0]))
    W, H = plates.size
    c0, c1 = max(0, int(min(xs))), min(W, int(max(xs)))
    r0, r1 = max(0, int(zs[0])), min(H, int(zs[1]))
    img = plates.img[side][r0:r1, c0:c1].copy()
    h, w = img.shape[:2]
    cov = np.zeros((len(names), h, w), dtype=bool)
    for obj, c in zip(objs, co):
        tri, pid = tris_of(obj, c)
        px, py = plates.to_px(side, tri[..., 0], tri[..., 2])
        cov |= raster(np.stack([px - c0, py - r0], -1), pid, w, h, len(names))
    out = img * 0.8
    union = cov.any(0)
    for i in range(len(names)):
        m = cov[i]
        if not m.any():
            continue
        cc = colour(i)
        out[m] = out[m] * 0.75 + cc * 0.25
        out[thicken(edge(m), 1)] = cc
    painted = mask_full[r0:r1, c0:c1]
    out[thicken(edge(painted), 1)] = (1.0, 1.0, 1.0)
    for xv in np.arange(-0.8, 0.91, 0.1):
        u = int(round(plates.to_px(side, xv, 0.0)[0] - c0))
        if 0 <= u < w:
            out[:, u] = out[:, u] * 0.5 + np.array([0.9, 0.1, 0.1]) * (0.5 if abs(xv) > 1e-6 else 1.0)
    for zv in np.arange(0.0, 1.95, 0.1):
        v = int(round(plates.to_px(side, 0.0, zv)[1] - r0))
        if 0 <= v < h:
            out[v] = out[v] * 0.5 + np.array([0.9, 0.1, 0.1]) * 0.5
    iou = (union & painted).sum() / max(1, (union | painted).sum())
    return out, float(iou)


def main():
    a = args()
    facs = ("aubade", "serenade") if a.faction == "both" else (a.faction,)
    rep = {}
    for fac in facs:
        spec, ctx, parts, body, accent = build_mesh(fac)
        names = [p.name for p in parts]
        objs = [o for o in (body, accent) if o is not None]
        pose = bw.paint_pose(spec) if a.pose == "paint" else bw.guard_pose() if a.pose == "guard" else {}
        co = [bw.posed_coords(o, pose) for o in objs]
        cid = spec.PROJECTION["concept"]
        plates = project.Plates(CACHE, cid, spec.PROJECTION["height"])
        mask = project.load_rgb(os.path.join(CACHE, f"{cid}_mask.png"))[..., 0] > 0.5
        mask = thicken(mask, 3)
        yaw = spec.F["paint"]["yaw"] if a.pose == "paint" else 0.0
        fimg, fiou = view("front", plates, [bw.yawed(c, yaw) for c in co], objs, names, mask)
        bimg, biou = view("back", plates, co, objs, names, mask)
        h = max(fimg.shape[0], bimg.shape[0])
        pad = lambda im: np.pad(im, ((0, h - im.shape[0]), (0, 0), (0, 0)))  # noqa: E731
        sheet = np.concatenate([pad(fimg), np.ones((h, 8, 3)) * 0.2, pad(bimg)], axis=1)
        os.makedirs(OUT, exist_ok=True)
        path = os.path.join(OUT, f"fit_brightwick_{fac}{'' if a.pose == 'paint' else '_' + a.pose}.png")
        project.save_rgb(np.clip(sheet, 0, 1), path)
        legend = {n: [round(float(x), 2) for x in colour(i)] for i, n in enumerate(names)}
        rep[fac] = {"front_iou": round(fiou, 3), "back_iou": round(biou, 3), "out": path, "parts": legend}
    print("[fit] " + json.dumps({k: {kk: vv for kk, vv in v.items() if kk != "parts"} for k, v in rep.items()}))
    for k, v in rep.items():
        print(f"[fit] {k} part colours: " + ", ".join(f"{n}={c}" for n, c in v["parts"].items()))


if __name__ == "__main__":
    main()
