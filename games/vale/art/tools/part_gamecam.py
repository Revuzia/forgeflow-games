#!/usr/bin/env python3
"""VALE art: id-masked colour of a fighter's parts as the GAME CAMERA shows them (closing CW5 done:4: 'at the gameplay
camera each named material pair differs by dE >= 8').

    python3 art/tools/part_gamecam.py art/out/fighters/lisvel/lisvel.glb [--sid lisvel] [--sheet three_lisvel.png]
        [--group sleeve=sleeves] [--pair sleeves:tabard ...] [--min 8] [--out report.txt]

Row 1 of the three_snapshot sheet (8 facings of idle f0, pitch 52, vFOV 26, 28.5 m, 1080p pixel scale, 300 px cells) is
the shaded picture. The same camera rasterizes the GLB's skinned triangles (numpy, a z-buffer) into a part-id image by
the bake's part map (art/.cache/fighters/partmap/<sid>.npz, art/tools/partmap_dump.py), each triangle's id from its
centroid's UV. For each part: the mean Lab of the sheet's pixels with that id over the 8 cells, leaving out pixels on
a part's edge (their four neighbours must share the id). A pair FAILS under --min. Exit 1 on a failing pair."""
import argparse
import math
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from chain_motion import Rig, accessor  # noqa: E402
from part_lab import PARTMAP, srgb_to_lab  # noqa: E402

CELL, PITCH, FOV, DIST = 300, math.radians(52.0), 26.0, 28.5
TARGET = np.array([0.0, 0.95, 0.0])


def skinned(rig, clip="idle", t=0.0):
    js, b = rig.js, rig.buf
    sk = js["skins"][0]
    ibm = accessor(js, b, sk["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)
    ch, dur = rig.clip(clip)
    W = rig.pose(ch, t * dur)
    JM = np.stack([W[j] @ ibm[i] for i, j in enumerate(sk["joints"])])
    out = []
    for n in js["nodes"]:
        if "mesh" not in n:
            continue
        pr = js["meshes"][n["mesh"]]["primitives"][0]
        if "TEXCOORD_0" not in pr["attributes"]:     # (the accent mesh has no UVs: skipped, it is never one of a pair)
            continue
        P = accessor(js, b, pr["attributes"]["POSITION"])
        J = accessor(js, b, pr["attributes"]["JOINTS_0"]).astype(int)
        Wt = accessor(js, b, pr["attributes"]["WEIGHTS_0"])
        Wt = Wt / np.maximum(Wt.sum(1, keepdims=True), 1e-9)
        H = np.c_[P, np.ones(len(P))]
        Q = np.zeros((len(P), 3))
        for k in range(4):
            Q += Wt[:, k, None] * np.einsum("nij,nj->ni", JM[J[:, k]], H)[:, :3]
        out.append((js["materials"][pr["material"]]["name"], Q, accessor(js, b, pr["attributes"]["TEXCOORD_0"]),
                    accessor(js, b, pr["indices"])[:, 0].astype(int).reshape(-1, 3)))
    return out


def project(Q):
    eye = TARGET + np.array([0.0, math.sin(PITCH) * DIST, math.cos(PITCH) * DIST])
    f = TARGET - eye
    f = f / np.linalg.norm(f)
    r = np.cross(f, [0.0, 1.0, 0.0])
    r = r / np.linalg.norm(r)
    u = np.cross(r, f)
    d = Q - eye
    z = d @ f
    k = (1080 / 2) / math.tan(math.radians(FOV) / 2)
    return np.stack([d @ r / z * k + CELL / 2, -(d @ u) / z * k + CELL / 2, z], 1)


def raster(meshes, part, names, yaw):
    ids = -np.ones((CELL, CELL), int)
    Z = np.full((CELL, CELL), 1e9)
    c, s = math.cos(yaw), math.sin(yaw)
    Ry = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    S = part.shape[0]
    acc = len(names)
    for mat, Q, UV, tri in meshes:
        V = project(Q @ Ry.T)
        cu = UV[tri].mean(1)
        pid = part[np.clip((cu[:, 1] * S).astype(int), 0, S - 1), np.clip((cu[:, 0] * S).astype(int), 0, S - 1)]
        if mat != "body":
            pid = np.full(len(tri), acc)
        for i, (a, b, d) in enumerate(tri):
            xs, ys, zs = V[[a, b, d], 0], V[[a, b, d], 1], V[[a, b, d], 2]
            x0, x1, y0, y1 = int(max(0, xs.min())), int(min(CELL - 1, xs.max() + 1)), int(max(0, ys.min())), int(min(CELL - 1, ys.max() + 1))
            if x0 > x1 or y0 > y1:
                continue
            den = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0])
            if abs(den) < 1e-9:
                continue
            X, Y = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            w1 = ((X - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (Y - ys[0])) / den
            w2 = ((xs[1] - xs[0]) * (Y - ys[0]) - (X - xs[0]) * (ys[1] - ys[0])) / den
            w0 = 1 - w1 - w2
            m = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
            zz = w0 * zs[0] + w1 * zs[1] + w2 * zs[2]
            sub = Z[y0:y1 + 1, x0:x1 + 1]
            near = m & (zz < sub)
            sub[near] = zz[near]
            ids[y0:y1 + 1, x0:x1 + 1][near] = pid[i]
    return ids


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("glb")
    ap.add_argument("--sid")
    ap.add_argument("--sheet")
    ap.add_argument("--group", action="append", default=[])
    ap.add_argument("--pair", action="append", default=[])
    ap.add_argument("--min", type=float, default=8.0)
    ap.add_argument("--out")
    a = ap.parse_args()
    sid = a.sid or os.path.splitext(os.path.basename(a.glb))[0]
    fid = sid.split("_")[0]
    z = np.load(os.path.join(PARTMAP, f"{sid}.npz"))
    part, names = z["part"], [str(n) for n in z["names"]]
    sheet = a.sheet or os.path.join(os.path.dirname(HERE), "renders", "fighters", fid, f"three_{sid}.png")
    img = np.asarray(Image.open(sheet).convert("RGB")).astype(np.float32) / 255.0
    lab = srgb_to_lab(img)
    meshes = skinned(Rig(a.glb))
    acc = {}
    for i in range(8):
        ids = raster(meshes, part, names, i * math.pi / 4)
        same = np.ones_like(ids, bool)
        same[1:-1, 1:-1] = ((ids[1:-1, 1:-1] == ids[:-2, 1:-1]) & (ids[1:-1, 1:-1] == ids[2:, 1:-1])
                            & (ids[1:-1, 1:-1] == ids[1:-1, :-2]) & (ids[1:-1, 1:-1] == ids[1:-1, 2:]))
        cell = lab[0:CELL, i * CELL:(i + 1) * CELL]
        for pid in np.unique(ids[ids >= 0]):
            m = (ids == pid) & same
            if m.any():
                acc.setdefault(int(pid), []).append(cell[m])
    data = {}
    for pid, chunks in acc.items():
        if pid < len(names):
            data[names[pid]] = np.concatenate(chunks)
    groups = {g.split("=", 1)[0]: g.split("=", 1)[1].split(",") for g in a.group}
    for k, mem in groups.items():
        have = [data[m] for m in mem if m in data]
        if have:
            data[k] = np.concatenate(have)
    lines = [f"# part_gamecam {os.path.relpath(a.glb)} on {os.path.relpath(sheet)} row 1 (8 facings, game camera), id-masked mean Lab"]
    for k in sorted(data, key=lambda n: -len(data[n])):
        v = data[k]
        q = np.percentile(v[:, 0], [10, 50, 90])
        lines.append(f"  {k:<22} L* {q[0]:5.1f}/{q[1]:5.1f}/{q[2]:5.1f} spread {q[2] - q[0]:5.1f} | "
                     f"Lab {np.round(v.mean(0), 1).tolist()} | {len(v)} px")
    bad = 0
    for pr in a.pair:
        x, y = pr.split(":")
        if x not in data or y not in data:
            lines.append(f"  pair {pr}: NOT VISIBLE ({'%s' % x if x not in data else y} has no interior pixels)")
            continue
        de = float(np.linalg.norm(data[x].mean(0) - data[y].mean(0)))
        ok = de >= a.min
        bad += 0 if ok else 1
        lines.append(f"  pair {x} : {y}  dE {de:5.1f}  {'PASS' if ok else 'FAIL'} (>= {a.min:g})")
    txt = "\n".join(lines)
    print(txt)
    if a.out:
        with open(a.out, "w") as f:
            f.write(txt + "\n")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
