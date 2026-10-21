"""Burdam motion audit: the cached build (art/.cache/fighters/burdam.blend) posed by the CURRENT clips of
fighters/burdam.py, every `--step` frames of every clip, measured on the skinned mesh:

  cleaver  cleaver vertices inside the body (hands excluded: the haft sits in the fists), count + depth
  head     cleaver / hand vertices inside the mask or cowl (a pommel or fist in the chin)
  arms     forearm / fist vertices inside the coat (the fists pressed into the torso)
  low      the lowest body vertex (m; the cleaver's planted tip excluded) and its part
  stretch  edges >= 1 cm stretched over 1.5x / squashed under 0.6x their bind length, the worst ratio + part
  tip      the blade tip height and the blade's elevation (deg above horizontal; carry clips)

    Blender -b --factory-startup --python art/blender/proto/burdam_audit.py -- [--clips idle,run] [--step 2]
"""
from __future__ import annotations

import math
import os
import sys
import types

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
BL = os.path.dirname(HERE)
sys.path.insert(0, BL)
sys.path.insert(0, os.path.join(BL, "fighters"))
sys.path.insert(0, HERE)

HANDS = ("fist_R", "palm_L", "fingers_L")
ARMS = ("forearms", "fist_R", "palm_L", "fingers_L")
TORSO = ("coat", "skirt", "belt", "cowl", "mask")
HEAD = ("mask", "cowl")


def rebind_cache(body, arm, names, binds, log=print):
    """bring the cached build's weights in line with the CURRENT module's binds (rigid 'bone:' parts and
    the 'coat' shoulder fix), so bind edits can be audited without a full build"""
    import burdam as F
    me = body.data
    pv = np.zeros(len(me.vertices), dtype=np.int64)
    me.attributes["vale_part"].data.foreach_get("value", pv)
    for i, nm in enumerate(names):
        b = binds.get(nm)
        sel = np.nonzero(pv == i)[0].tolist()
        if not sel:
            continue
        if isinstance(b, str) and b.startswith("bone:"):
            for g in body.vertex_groups:
                g.remove(sel)
            g = body.vertex_groups.get(b[5:]) or body.vertex_groups.new(name=b[5:])
            g.add(sel, 1.0, "REPLACE")
        elif b == "coat":
            F.shoulder_weights(body, arm, sel=(pv == i), log=log)


def args():
    import argparse
    from common import scene
    p = argparse.ArgumentParser()
    p.add_argument("--clips", default="")
    p.add_argument("--step", type=int, default=2)
    p.add_argument("--tol", type=float, default=0.01)
    p.add_argument("--blend", default="")
    p.add_argument("--rebind", action="store_true")
    p.add_argument("--haft-min-u", type=float, default=-9.0,
                   help="ignore cleaver vertices below this cleaver u (emulate a shorter haft on an older cache)")
    p.add_argument("--where", action="store_true", help="print where the worst stretched edges sit (bind pose)")
    return p.parse_args(scene.script_args())


def main():
    from common import scene
    a = args()
    bpy.ops.wm.open_mainfile(filepath=a.blend or os.path.join(scene.CACHE_DIR, "fighters", "burdam.blend"))
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    from common import anim
    import burdam as F
    F._install_aim_roll()
    arm = bpy.data.objects["burdam_rig"]
    ctx = types.SimpleNamespace(info=types.SimpleNamespace(armature=arm, props=F.PROPORTIONS, joints={}), spec=F,
                                chains={}, skin=None)
    skel = anim.Skeleton(arm)
    clips = anim.standard_clips(skel, F.MOTION, F.clip_overrides(ctx))
    body = bpy.data.objects["burdam"]
    names = [x[0] for x in F.sculpts()]
    if a.rebind:
        rebind_cache(body, arm, names, {x[0]: x[4] for x in F.sculpts()})
    me0 = body.data
    n = len(me0.vertices)
    co0 = np.empty(n * 3, dtype=np.float32)
    me0.vertices.foreach_get("co", co0)
    co0 = co0.reshape(-1, 3)
    pv = np.zeros(n, dtype=np.int64)
    at = me0.attributes.get("vale_part")
    if at is not None:
        at.data.foreach_get("value", pv)
    if pv.max() >= len(names):
        print(f"WARNING: part ids up to {pv.max()} but {len(names)} sculpts: the cache is from another build")
    ed = np.empty(len(me0.edges) * 2, dtype=np.int64)
    me0.edges.foreach_get("vertices", ed)
    ed = ed.reshape(-1, 2)
    polys = [tuple(p.vertices) for p in me0.polygons]
    ppart = np.array([pv[p[0]] for p in polys])
    ids = {nm: i for i, nm in enumerate(names)}
    cleaver = np.isin(pv, [ids[x] for x in F.CLEAVER if x in ids])
    cleaver_all = cleaver.copy()
    if a.haft_min_u > -9:
        from common import rig
        Mp = np.array(rig.prop_matrix(types.SimpleNamespace(armature=arm), "prop.R"))
        pp = (co0 @ np.linalg.inv(Mp)[:3, :3].T + np.linalg.inv(Mp)[:3, 3])
        u = pp[:, 2] + F.cl.U_GRIP
        gone = cleaver & (u < a.haft_min_u)
        print(f"ignoring {int(gone.sum())} cleaver vertices below u {a.haft_min_u}")
        cleaver = cleaver & ~gone
    hands = np.isin(pv, [ids[x] for x in HANDS if x in ids])
    armsv = np.isin(pv, [ids[x] for x in ARMS if x in ids])
    body_faces = [i for i in range(len(polys)) if names[ppart[i]] not in F.CLEAVER + HANDS] if True else []
    torso_faces = [i for i in range(len(polys)) if names[ppart[i]] in TORSO]
    head_faces = [i for i in range(len(polys)) if names[ppart[i]] in HEAD]
    deps = bpy.context.evaluated_depsgraph_get()
    pb = arm.pose.bones
    Mw = np.array(body.matrix_world)

    def inside(co, sel, faces, tol):
        if not sel.any() or not faces:
            return 0, 0.0, {}
        bvh = BVHTree.FromPolygons([tuple(c) for c in co], [polys[i] for i in faces])
        cnt, deep, by = 0, 0.0, {}
        for vi in np.nonzero(sel)[0]:
            v = Vector(co[vi])
            loc, nrm, fi, dist = bvh.find_nearest(v, 0.3)
            if loc is None:
                continue
            d = (v - loc).dot(nrm)
            if d < -tol:
                cnt += 1
                deep = max(deep, -d)
                pn = names[ppart[faces[fi]]]
                by[pn] = by.get(pn, 0) + 1
        return cnt, deep, by

    def posed(clip, t):
        anim.apply_pose(arm, clip.sample(t))
        deps.update()
        ev = body.evaluated_get(deps)
        me = ev.to_mesh()
        co = np.empty(len(me.vertices) * 3, dtype=np.float32)
        me.vertices.foreach_get("co", co)
        ev.to_mesh_clear()
        return co.reshape(-1, 3) @ Mw[:3, :3].T + Mw[:3, 3]

    ref = posed(clips["idle"], 0.0)                 # stretch is measured against idle f0 (not the A-pose bind)
    L0 = np.linalg.norm(ref[ed[:, 0]] - ref[ed[:, 1]], axis=1)
    big = L0 >= 0.01
    want = [c for c in (a.clips.split(",") if a.clips else clips.keys()) if c in clips]
    summary = {}
    for name in want:
        clip = clips[name]
        print(f"== {name} ({clip.frames} f)")
        print("   f  cleaver(n,max m)        head(n,max)   arms(n)  low(m part)            stretch(>1.5,<0.6,max part)   tip  elev")
        worst = {"cleaver": 0, "head": 0, "low": 0.0, "stretch": 0.0}
        frames = list(range(0, clip.frames, a.step))
        if clip.frames - 1 not in frames:
            frames.append(clip.frames - 1)
        for f in frames:
            co = posed(clip, f / clip.frames)
            c1, d1, by1 = inside(co, cleaver, body_faces, a.tol)
            c2, d2, by2 = inside(co, cleaver | hands, head_faces, a.tol)
            if c2 and a.where:
                c2a, _, by2a = inside(co, cleaver, head_faces, a.tol)
                print(f"        head hits: cleaver {c2a} {by2a}, hands {c2 - c2a}; targets {by2}")
            c3, _, _ = inside(co, armsv, torso_faces, a.tol)
            nb = ~cleaver_all
            lo = int(np.argmin(np.where(nb, co[:, 2], 9.0)))
            L = np.linalg.norm(co[ed[:, 0]] - co[ed[:, 1]], axis=1)
            r = np.where(big, L / np.maximum(L0, 1e-6), 1.0)
            s_hi, s_lo = int((r > 1.5).sum()), int((r < 0.6).sum())
            wi = int(np.argmax(r))
            if s_hi:
                bad = np.nonzero(r > 1.5)[0]
                parts, cnt = np.unique(pv[ed[bad, 0]], return_counts=True)
                hi_parts = {names[p]: int(c) for p, c in zip(parts, cnt)}
            else:
                hi_parts = {}
            wpart = names[pv[ed[wi, 0]]]
            W = lambda b: np.array((arm.matrix_world @ pb[b].matrix).translation)  # noqa: E731
            tip = W("x_blade_tip")
            grip = W("prop.R")
            dv = tip - grip
            elev = math.degrees(math.atan2(dv[2], math.hypot(dv[0], dv[1])))
            if a.where and co[lo, 2] < -0.02:
                b0 = co0[lo]
                print(f"        lowest vertex bind ({b0[0]:+.3f},{b0[1]:+.3f},{b0[2]:+.3f}) part {names[pv[lo]]}")
            if a.where and s_hi:
                worst_e = np.argsort(-r)[:12]
                for e in worst_e:
                    p0 = co0[ed[e, 0]]
                    print(f"        edge {r[e]:.1f}x {names[pv[ed[e, 0]]]:9s} bind ({p0[0]:+.2f},{p0[1]:+.2f},{p0[2]:+.2f}) L0 {L0[e]:.3f}")
            top = sorted(by1.items(), key=lambda kv: -kv[1])[:2]
            print(f"  {f:3d}  {c1:4d} {d1:5.3f} {str(top):24s} {c2:4d} {d2:5.3f}  {c3:5d}   {co[lo, 2]:+.3f} {names[pv[lo]]:10s}"
                  f"  {s_hi:4d} {s_lo:4d} {r[wi]:4.1f} {wpart:10s}  {tip[2]:+.2f} {elev:+4.0f} {hi_parts if s_hi else ''}")
            worst["cleaver"] = max(worst["cleaver"], c1)
            worst["head"] = max(worst["head"], c2)
            worst["low"] = min(worst["low"], float(co[lo, 2]))
            worst["stretch"] = max(worst["stretch"], float(r[wi]))
        summary[name] = worst
    print("== SUMMARY (worst per clip): cleaver-in-body verts, cleaver/hand-in-head verts, lowest body z, max stretch")
    for k, w in summary.items():
        print(f"  {k:11s} cleaver {w['cleaver']:4d}  head {w['head']:4d}  low {w['low']:+.3f}  stretch {w['stretch']:.1f}")


if __name__ == "__main__":
    main()
