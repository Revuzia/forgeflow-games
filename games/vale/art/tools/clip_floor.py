#!/usr/bin/env python3
"""Floor gate for a shipped, skinned fighter GLB (closing review ULK-M2): per clip, the lowest skinned vertex of every
skinned mesh (CPU linear-blend skinning in numpy, the game's own deformation; no Blender). A clip FAILS when any
visible vertex of the body (every skinned primitive; a bone scaled to nothing hides its mesh) goes below --limit (default -0.02 m): a death hold that sinks a leg into
the floor, a lunge that passes a blade through it.

    python3 art/tools/clip_floor.py art/out/fighters/ulkro/ulkro.glb [--clips death,dash] [--limit -0.02] [--step 1]

Prints per clip: the lowest y (m), the frame it happens on, the vertex count below the limit there and the bone with
the most weight on the lowest vertex. Exit code 1 if any clip fails. Pure python + numpy (shares chain_motion's GLB
reader).
"""
import argparse
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from chain_motion import Rig, accessor  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("glb")
    ap.add_argument("--clips", default="")
    ap.add_argument("--limit", type=float, default=-0.02)
    ap.add_argument("--fps", type=float, default=30.0)
    ap.add_argument("--step", type=int, default=1)
    a = ap.parse_args()
    rig = Rig(a.glb)
    js, buf = rig.js, rig.buf
    prims = []
    for n in rig.nodes:
        if "mesh" in n and "skin" in n:
            for prim in js["meshes"][n["mesh"]]["primitives"]:
                at = prim["attributes"]
                if "JOINTS_0" not in at:
                    continue
                pos = accessor(js, buf, at["POSITION"])
                J = accessor(js, buf, at["JOINTS_0"]).astype(int)
                W = accessor(js, buf, at["WEIGHTS_0"])
                W = W / np.maximum(W.sum(1, keepdims=True), 1e-9)
                prims.append((np.c_[pos, np.ones(len(pos))], J, W, n["skin"]))
    # each skinned node's OWN skin: a quantized GLB folds each mesh's dequantization into its skin's inverse binds
    skins = []
    for sk in js["skins"]:
        ibm = accessor(js, buf, sk["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)
        skins.append((sk["joints"], ibm, [rig.nodes[j].get("name", str(j)) for j in sk["joints"]]))

    def lowest(clip, t):
        ch = rig.clip(clip)[0]
        Wm = rig.pose(ch, t)
        Ms = [np.stack([Wm[j] @ ibm[k] for k, j in enumerate(joints)]) for joints, ibm, _ in skins]
        best = (1e9, None, 0)
        below = 0
        for P4, J, W, si in prims:
            Mj, names_j = Ms[si], skins[si][2]
            out = np.zeros((len(P4), 3))
            for c in range(J.shape[1]):
                out += W[:, c:c + 1] * np.einsum("nij,nj->ni", Mj[J[:, c]], P4)[:, :3]
            y = out[:, 1].copy()
            # a bone scaled to nothing hides its mesh (the laid dart between a throw and its reload): not on the floor
            dom = J[np.arange(len(J)), np.argmax(W, 1)]
            hid = np.abs(np.linalg.det(Mj[dom][:, :3, :3])) < 1e-3
            y[hid] = 1e9
            below += int((y < a.limit).sum())
            i = int(np.argmin(y))
            if y[i] < best[0]:
                best = (float(y[i]), names_j[J[i, int(np.argmax(W[i]))]], i)
        return best, below

    names = [c for c in (a.clips.split(",") if a.clips else rig.anims.keys()) if c in rig.anims]
    print(f"# {a.glb}: lowest skinned vertex per clip (limit {a.limit:+.3f} m)")
    fails = 0
    for nm in names:
        _, dur = rig.clip(nm)
        nf = max(1, int(round(dur * a.fps)))
        worst = (1e9, None, 0, 0, 0)
        for f in range(0, nf + 1, a.step):
            (y, bone, _), below = lowest(nm, min(f / a.fps, dur))
            if y < worst[0]:
                worst = (y, bone, f, below, 0)
        ok = worst[0] >= a.limit
        fails += 0 if ok else 1
        print(f"  {nm:12s} {'PASS' if ok else 'FAIL'} min y {worst[0]:+.3f} m at f{worst[2]} "
              f"({worst[3]} verts below, lowest on {worst[1]})")
    print(f"  {fails} clip(s) below the floor")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
