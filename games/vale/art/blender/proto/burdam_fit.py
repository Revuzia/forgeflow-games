"""Burdam fit check: the sculpt (fighters/burdam.py, the cleaver in its paint pose) over the concept on a
10 cm grid, the way marund_v2.py proved Marund's fit.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/burdam_fit.py -- [--voxel 0.01]

Needs the plates first (proto/burdam_plates.py). Ray-casts the model along +Y / -Y through every second
plate pixel and writes art/renders/fighters/burdam/fit_front_back.png: the concept with each part
tinted, the model's silhouette in green and the concept cut in magenta (10 cm grid, 50 cm lines bold),
plus fit_side_top.png (side and top silhouettes, 10 cm grid) to check the depth nobody painted.
Prints the rig joints the sculpt was fitted to.
"""
from __future__ import annotations

import json
import os
import sys

import bpy  # noqa: F401
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
BL = os.path.dirname(HERE)
sys.path.insert(0, BL)
sys.path.insert(0, os.path.join(BL, "fighters"))
sys.path.insert(0, HERE)
from common import rig, scene  # noqa: E402
from common.hifi import project, sdf  # noqa: E402
import burdam as F  # noqa: E402

OUT = os.path.join(scene.RENDERS_DIR, "fighters", "burdam")
CACHE = os.path.join(scene.CACHE_DIR, "concept")


def args():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--voxel", type=float, default=0.010)
    p.add_argument("--only", default="", help="comma list of part names")
    return p.parse_args(scene.script_args())


def part_colour(i: int) -> np.ndarray:
    rng = np.random.default_rng(1000 + i * 7919)
    c = rng.uniform(0.25, 1.0, 3)
    return c / c.max()


def edges(m: np.ndarray) -> np.ndarray:
    e = np.zeros_like(m)
    e[1:, :] |= m[1:, :] != m[:-1, :]
    e[:, 1:] |= m[:, 1:] != m[:, :-1]
    return e


def main():
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    a = args()
    scene.reset()
    col = scene.collection("burdam_fit")
    info = rig.build_rig(F.PROPORTIONS, name="burdam_rig", col=col)
    M = np.array(rig.prop_matrix(info, "prop.R"))
    F._STATE["prop"] = M
    J = info.joints
    for k in ("crown", "head_base", "neck_base", "shoulder.L", "elbow.L", "wrist.L", "knuckle.L", "palm.L",
              "hip.L", "knee.L", "ankle.L", "ball.L", "toe.L", "pelvis"):
        v = J[k]
        print(f"joint {k:12s} ({v.x:+.3f}, {v.y:+.3f}, {v.z:+.3f})")
    print("prop.R matrix\n", np.round(M, 3))
    only = set(a.only.split(",")) if a.only else None
    verts, faces, pids, names = [], [], [], []
    off = 0
    for i, (name, S, vs, role, bind, tris, space) in enumerate(F.sculpts()):
        names.append(name)
        if only and name not in only:
            continue
        v, q = S.mesh(a.voxel * vs)
        if space == "prop":
            v = v @ M[:3, :3].T + M[:3, 3]
            v = F.paint_pose(v, np.full(len(v), i), names, M)
        print(f"{name:14s} {len(v):7d} verts  x {v[:, 0].min():+.3f}..{v[:, 0].max():+.3f}  "
              f"y {v[:, 1].min():+.3f}..{v[:, 1].max():+.3f}  z {v[:, 2].min():+.3f}..{v[:, 2].max():+.3f}")
        verts.append(v)
        faces.append(np.asarray(q) + off)
        pids.append(np.full(len(q), i))
        off += len(v)
    V = np.concatenate(verts)
    Q = np.concatenate(faces)
    pid = np.concatenate(pids)
    bvh = BVHTree.FromPolygons([tuple(p) for p in V], [tuple(f) for f in Q])
    meta = json.load(open(os.path.join(CACHE, "burdam_plates.json")))
    plates = project.Plates(CACHE, "burdam", F.HEIGHT)
    concept = project.load_rgb(os.path.join(scene.GAME_DIR, "_design", "concept", "burdam.webp"))
    cut = project.load_rgb(os.path.join(CACHE, "burdam_mask.png"))[..., 0] > 0.5
    for _ in range(9):                         # the plates erode the painted outline halo 9 px: give it back
        g = cut.copy()
        g[1:] |= cut[:-1]
        g[:-1] |= cut[1:]
        g[:, 1:] |= cut[:, :-1]
        g[:, :-1] |= cut[:, 1:]
        cut = g
    H, W = concept.shape[:2]
    img = concept.copy()
    model = np.zeros((H, W), bool)
    step = 2
    for side, y0, d in (("front", -50.0, Vector((0, 1, 0))), ("back", 50.0, Vector((0, -1, 0)))):
        gx = np.arange(0, W, step) + step * 0.5
        gy = np.arange(0, H, step) + step * 0.5
        x, _ = plates.to_world(side, gx, np.zeros_like(gx))
        _, z = plates.to_world(side, np.zeros_like(gy), gy)
        xs = np.nonzero((x > V[:, 0].min() - 0.02) & (x < V[:, 0].max() + 0.02))[0]
        zs = np.nonzero((z > V[:, 2].min() - 0.02) & (z < V[:, 2].max() + 0.02))[0]
        for j in zs:
            for i in xs:
                hit = bvh.ray_cast(Vector((float(x[i]), y0, float(z[j]))), d)
                if hit[0] is not None:
                    r0, c0 = j * step, i * step
                    k = int(pid[hit[2]])
                    img[r0:r0 + step, c0:c0 + step] = img[r0:r0 + step, c0:c0 + step] * 0.62 + part_colour(k) * 0.38
                    model[r0:r0 + step, c0:c0 + step] = True
    # the disagreement map: grey concept, RED = model outside the painted cut, BLUE = painted figure the
    # model does not cover
    diff = np.repeat(concept.mean(axis=2, keepdims=True), 3, axis=2) * 0.8 + 0.1
    diff[model & ~cut] = diff[model & ~cut] * 0.3 + np.array([1.0, 0.1, 0.1]) * 0.7
    diff[cut & ~model] = diff[cut & ~model] * 0.3 + np.array([0.1, 0.3, 1.0]) * 0.7
    diff[edges(model)] = (0.0, 0.8, 0.0)
    img[edges(cut)] = (1.0, 0.0, 1.0)
    img[edges(model)] = (0.0, 1.0, 0.0)
    # 10 cm grid per side
    for side, (c0, c1) in (("front", (0, W // 2)), ("back", (W // 2, W))):
        info_s = meta[side]
        k = (info_s["ground"] - info_s["top"]) / F.HEIGHT
        sgn = 1 if side == "front" else -1
        for n in range(-12, 13):
            xp = int(round(info_s["cx"] + sgn * n * 0.1 * k))
            if c0 <= xp < c1:
                img[:, xp, :] = img[:, xp, :] * 0.6 + np.array([0.9, 0.2, 0.2]) * 0.4 * (2 if n % 5 == 0 else 1)
        for n in range(0, 27):
            yp = int(round(info_s["ground"] - n * 0.1 * k))
            if 0 <= yp < H:
                img[yp, c0:c1, :] = img[yp, c0:c1, :] * 0.6 + np.array([0.2, 0.2, 0.9]) * 0.4 * (2 if n % 5 == 0 else 1)
    os.makedirs(OUT, exist_ok=True)
    project.save_rgb(np.clip(img, 0, 1), os.path.join(OUT, "fit_front_back.png"))
    for side, (c0, c1) in (("front", (0, W // 2)), ("back", (W // 2, W))):
        info_s = meta[side]
        k = (info_s["ground"] - info_s["top"]) / F.HEIGHT
        sgn = 1 if side == "front" else -1
        for n in range(-12, 13):
            xp = int(round(info_s["cx"] + sgn * n * 0.1 * k))
            if c0 <= xp < c1:
                diff[:, xp, :] = diff[:, xp, :] * 0.7 + np.array([0.9, 0.6, 0.0]) * 0.3 * (2 if n % 5 == 0 else 1)
        for n in range(0, 27):
            yp = int(round(info_s["ground"] - n * 0.1 * k))
            if 0 <= yp < H:
                diff[yp, c0:c1, :] = diff[yp, c0:c1, :] * 0.7 + np.array([0.9, 0.6, 0.0]) * 0.3 * (2 if n % 5 == 0 else 1)
    project.save_rgb(np.clip(diff, 0, 1), os.path.join(OUT, "fit_diff.png"))
    print(f"fit: model outside the cut {int((model & ~cut).sum())} px, cut not covered {int((cut & ~model).sum())} px, "
          f"cut {int(cut.sum())} px")
    # side (+X looking -X: the character's left) and top silhouettes, 4 mm
    res = 0.004
    ys = np.arange(-0.75, 0.75, res)
    zs_ = np.arange(2.62, 0.0, -res)
    side_img = np.ones((len(zs_), len(ys), 3)) * 0.9
    for r, z in enumerate(zs_):
        for c, y in enumerate(ys):
            hit = bvh.ray_cast(Vector((5.0, float(-y), float(z))), Vector((-1, 0, 0)))
            if hit[0] is not None:
                n = hit[1]
                shade = 0.55 + 0.45 * max(0.0, n.dot(Vector((0.5, -0.3, 0.8)).normalized()))
                side_img[r, c] = part_colour(int(pid[hit[2]])) * shade
    xs_ = np.arange(-0.95, 0.95, res)
    ys2 = np.arange(-0.75, 0.75, res)
    top_img = np.ones((len(ys2), len(xs_), 3)) * 0.9
    for r, y in enumerate(ys2):
        for c, x in enumerate(xs_):
            hit = bvh.ray_cast(Vector((float(x), float(y), 5.0)), Vector((0, 0, -1)))
            if hit[0] is not None:
                n = hit[1]
                shade = 0.55 + 0.45 * max(0.0, n.dot(Vector((-0.4, -0.5, 0.8)).normalized()))
                top_img[r, c] = part_colour(int(pid[hit[2]])) * shade
    for im, (u0, du), (v0, dv) in ((side_img, (-0.75, res), (2.62, -res)), (top_img, (-0.95, res), (-0.75, res))):
        for n in range(-20, 30):
            cc = int(round((n * 0.1 - u0) / du))
            if 0 <= cc < im.shape[1]:
                im[:, cc] = im[:, cc] * 0.7 + np.array([0.8, 0.2, 0.2]) * 0.3 * (2 if n % 5 == 0 else 1)
            rr = int(round((n * 0.1 - v0) / dv))
            if 0 <= rr < im.shape[0]:
                im[rr, :] = im[rr, :] * 0.7 + np.array([0.2, 0.2, 0.8]) * 0.3 * (2 if n % 5 == 0 else 1)
    hh = max(side_img.shape[0], top_img.shape[0])
    canvas = np.ones((hh, side_img.shape[1] + top_img.shape[1] + 10, 3))
    canvas[:side_img.shape[0], :side_img.shape[1]] = side_img
    canvas[:top_img.shape[0], side_img.shape[1] + 10:] = top_img
    project.save_rgb(np.clip(canvas, 0, 1), os.path.join(OUT, "fit_side_top.png"))
    print("wrote", os.path.join(OUT, "fit_front_back.png"), os.path.join(OUT, "fit_side_top.png"))


if __name__ == "__main__":
    main()
