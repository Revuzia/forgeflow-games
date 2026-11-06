#!/usr/bin/env python3
"""Pull one part's rest vertices in along their normals, in place in a shipped fighter GLB (the POSITION bytes only: file size,
UVs, textures and clips unchanged). For an under-layer the decimated shell above it no longer covers (closing CW5
minor:ulkro-seat-lumps: the shipped base's simplified skirt let the trousers' seat through). The part map comes from
art/.cache/fighters/partmap/<id>.npz (partmap_dump.py). Bounds are rest-pose world metres; the rear is -Z (the fighter faces +Z).

    python3 art/tools/glb_part_inset.py ulkro --part legs --y-min 0.86 --y-max 1.12 --rear --by 0.025 [--glb path] [--dry]

The inset eases in over 3 cm above --y-min. Re-run after a rebuild, then look at the rear of the sheet.
"""
import argparse
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from chain_motion import CT, NC, Rig, accessor  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("fid")
    ap.add_argument("--part", required=True)
    ap.add_argument("--y-min", type=float, default=0.0)
    ap.add_argument("--y-max", type=float, default=9.0)
    ap.add_argument("--rear", action="store_true")
    ap.add_argument("--by", type=float, default=0.02)
    ap.add_argument("--glb", default="")
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    game = os.path.dirname(os.path.dirname(HERE))
    glb = a.glb or os.path.join(game, "art", "out", "fighters", a.fid, a.fid + ".glb")
    d = np.load(os.path.join(game, "art", ".cache", "fighters", "partmap", a.fid + ".npz"))
    pm, names = d["part"], [str(x) for x in d["names"]]
    pid = names.index(a.part)
    rig = Rig(glb)
    js, buf = rig.js, bytearray(rig.buf)
    wr = rig.pose([], 0.0)
    total = 0
    for n in rig.nodes:
        if "mesh" not in n or "skin" not in n:
            continue
        sk = js["skins"][n["skin"]]
        ibm = accessor(js, rig.buf, sk["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)
        M = np.stack([wr[j] @ ibm[k] for k, j in enumerate(sk["joints"])])
        for prim in js["meshes"][n["mesh"]]["primitives"]:
            at = prim["attributes"]
            if "JOINTS_0" not in at or "TEXCOORD_0" not in at:
                continue
            P = accessor(js, rig.buf, at["POSITION"])
            J = accessor(js, rig.buf, at["JOINTS_0"]).astype(int)
            W = accessor(js, rig.buf, at["WEIGHTS_0"])
            W = W / np.maximum(W.sum(1, keepdims=True), 1e-9)
            N = accessor(js, rig.buf, at["NORMAL"])
            uv = accessor(js, rig.buf, at["TEXCOORD_0"])
            sz = pm.shape[0]
            part = pm[np.clip((uv[:, 1] * sz).astype(int), 0, sz - 1), np.clip((uv[:, 0] * sz).astype(int), 0, sz - 1)]
            Mb = np.zeros((len(P), 4, 4))
            for c in range(J.shape[1]):
                Mb += W[:, c, None, None] * M[J[:, c]]
            world = np.einsum("nij,nj->ni", Mb, np.c_[P, np.ones(len(P))])[:, :3]
            Nw = np.einsum("nij,nj->ni", np.linalg.inv(Mb[:, :3, :3]).transpose(0, 2, 1), N)
            Nw /= np.maximum(np.linalg.norm(Nw, axis=1, keepdims=True), 1e-9)
            sel = (part == pid) & (world[:, 1] >= a.y_min) & (world[:, 1] <= a.y_max)
            if a.rear:
                sel &= world[:, 2] < 0.0
            if not sel.any():
                continue
            ease = np.clip((world[sel, 1] - a.y_min) / 0.03, 0, 1)
            ease = ease * ease * (3 - 2 * ease)
            new_w = world[sel] - Nw[sel] * (a.by * ease)[:, None]
            new_p = np.einsum("nij,nj->ni", np.linalg.inv(Mb[sel]), np.c_[new_w, np.ones(len(new_w))])[:, :3]
            acc = js["accessors"][at["POSITION"]]
            v = js["bufferViews"][acc["bufferView"]]
            dt = np.dtype(CT[acc["componentType"]])
            start = v.get("byteOffset", 0) + acc.get("byteOffset", 0)
            stride = v.get("byteStride", 0) or dt.itemsize * NC[acc["type"]]
            scale = {np.int8: 127.0, np.uint8: 255.0, np.int16: 32767.0, np.uint16: 65535.0}.get(CT[acc["componentType"]])
            for i, q in zip(np.nonzero(sel)[0], new_p):
                q = np.clip(q, acc.get("min", [-9e9] * 3), acc.get("max", [9e9] * 3))
                raw = (np.round(q * scale).astype(dt) if acc.get("normalized") else (np.round(q).astype(dt) if dt.kind in "iu" else q.astype(dt)))
                buf[start + i * stride:start + i * stride + dt.itemsize * 3] = raw.tobytes()
            total += int(sel.sum())
            w = world[sel]
            print(f"[inset] {a.part}: {int(sel.sum())} verts, x {w[:, 0].min():.3f}..{w[:, 0].max():.3f} y {w[:, 1].min():.3f}..{w[:, 1].max():.3f} z {w[:, 2].min():.3f}..{w[:, 2].max():.3f}, by {a.by} m")
    if not a.dry and total:
        import struct
        b = open(glb, "rb").read()
        jl = struct.unpack_from("<I", b, 12)[0]
        off = 20 + jl
        bl = struct.unpack_from("<I", b, off)[0]
        with open(glb, "wb") as f:
            f.write(b[:off + 8] + bytes(buf) + b[off + 8 + bl:])


if __name__ == "__main__":
    main()
