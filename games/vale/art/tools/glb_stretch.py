#!/usr/bin/env python3
"""Edge stretch of a shipped, skinned fighter GLB per clip (CPU linear-blend skinning in numpy, no Blender): the game's
own deformation, measured against `idle` frame 0 like art/blender/proto/burdam_audit.py.

    python3 art/tools/glb_stretch.py art/out/fighters/burdam/burdam.glb [--clips run,attack1] [--region skirt=...]

Per clip: edges >= 1 cm (at idle f0) stretched over 1.5x, the worst frame's count and the worst ratio, for the whole
body mesh and for named rest-pose regions (boxes on the bind pose, glTF space: x = his left, y = up, z = his front):
  skirt     the coat's skirt band (y 0.66-1.10, outside r 0.24 of the body axis, |x| < 0.40)
  forearms  the wrapped forearms (|x| 0.40-0.64, y 1.00-1.36)
Pure python + numpy; reads LINEAR / STEP samplers, KHR_mesh_quantization (normalized accessors), the first skin.
"""
import argparse
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from chain_motion import Rig, accessor  # noqa: E402

REGIONS = {
    "skirt": lambda P: (P[:, 1] > 0.66) & (P[:, 1] < 1.10) & (np.hypot(P[:, 0], P[:, 2]) > 0.24) & (np.abs(P[:, 0]) < 0.40),
    "forearms": lambda P: (np.abs(P[:, 0]) > 0.40) & (np.abs(P[:, 0]) < 0.64) & (P[:, 1] > 1.00) & (P[:, 1] < 1.36),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("glb")
    ap.add_argument("--clips", default="")
    ap.add_argument("--fps", type=float, default=30.0)
    ap.add_argument("--step", type=int, default=1)
    ap.add_argument("--where", action="store_true", help="print the rest position of each clip's worst stretched edges")
    a = ap.parse_args()
    rig = Rig(a.glb)
    js, buf = rig.js, rig.buf
    skin = js["skins"][0]
    joints = skin["joints"]
    ibm = accessor(js, buf, skin["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)
    # the skinned body mesh: the node with the most vertices
    best = None
    for ni, n in enumerate(rig.nodes):
        if "mesh" in n and "skin" in n:
            for prim in js["meshes"][n["mesh"]]["primitives"]:
                cnt = js["accessors"][prim["attributes"]["POSITION"]]["count"]
                if best is None or cnt > best[0]:
                    best = (cnt, ni, prim)
    _, ni, prim = best
    pos = accessor(js, buf, prim["attributes"]["POSITION"])
    J = accessor(js, buf, prim["attributes"]["JOINTS_0"]).astype(int)
    W = accessor(js, buf, prim["attributes"]["WEIGHTS_0"])
    W = W / np.maximum(W.sum(1, keepdims=True), 1e-9)
    idx = accessor(js, buf, prim["indices"]).astype(int).reshape(-1, 3)
    ed = np.concatenate([idx[:, [0, 1]], idx[:, [1, 2]], idx[:, [2, 0]]])
    ed = np.unique(np.sort(ed, 1), axis=0)
    P4 = np.c_[pos, np.ones(len(pos))]

    def skinned(clip, t):
        ch = rig.clip(clip)[0] if clip else []
        Wm = rig.pose(ch, t)
        Mj = np.stack([Wm[j] @ ibm[k] for k, j in enumerate(joints)])     # (nj, 4, 4)
        out = np.zeros((len(pos), 3))
        for c in range(J.shape[1]):
            M = Mj[J[:, c]]
            out += W[:, c:c + 1] * np.einsum("nij,nj->ni", M, P4)[:, :3]
        return out

    ref = skinned("idle", 0.0)
    L0 = np.linalg.norm(ref[ed[:, 0]] - ref[ed[:, 1]], axis=1)
    big = L0 >= 0.01
    rest = skinned(None, 0.0)                   # region boxes on the bind pose (the rig's rest: A-pose arms)
    regs = {k: f(rest)[ed[:, 0]] & f(rest)[ed[:, 1]] & big for k, f in REGIONS.items()}
    names = [c for c in (a.clips.split(",") if a.clips else rig.anims.keys()) if c in rig.anims]
    print(f"# {a.glb}: {len(pos)} verts, {len(ed)} edges ({int(big.sum())} >= 1 cm); stretch > 1.5x vs idle f0, worst frame")
    print(f"  {'clip':12s} {'all n':>6s} {'max':>5s} | " + " | ".join(f"{k:>8s} n  max" for k in REGIONS))
    tot = {k: 0 for k in ["all"] + list(REGIONS)}
    for nm in names:
        _, dur = rig.clip(nm)
        nf = max(1, int(round(dur * a.fps)))
        worst = {k: (0, 1.0) for k in ["all"] + list(REGIONS)}
        for f in range(0, nf + 1, a.step):
            co = skinned(nm, min(f / a.fps, dur))
            r = np.where(big, np.linalg.norm(co[ed[:, 0]] - co[ed[:, 1]], axis=1) / np.maximum(L0, 1e-9), 1.0)
            for k, m in [("all", big)] + list(regs.items()):
                n = int((r[m] > 1.5).sum())
                mx = float(r[m].max()) if m.any() else 1.0
                worst[k] = (max(worst[k][0], n), max(worst[k][1], mx))
            if a.where and float(r.max()) >= worst["all"][1] - 1e-9:
                bad = np.argsort(-r)[:6]
                worst["_at"] = [(round(float(r[i]), 2), np.round(rest[ed[i, 0]], 2).tolist()) for i in bad]
        for k in tot:
            tot[k] += worst[k][0]
        print(f"  {nm:12s} {worst['all'][0]:6d} {worst['all'][1]:5.2f} | " +
              " | ".join(f"{worst[k][0]:8d} {worst[k][1]:4.2f}" for k in REGIONS))
        if a.where and "_at" in worst:
            print("      worst edges (ratio, bind-pose point x/y/z):", worst["_at"])
    print("  total worst-frame counts: " + ", ".join(f"{k} {v}" for k, v in tot.items()))


if __name__ == "__main__":
    main()
