"""Burdam plant search (fix pass 4): Stubborn / the channel's planted cleaver (both hands at its top, the tip in the
ground ahead) over right-wrist points, hip folds and the cleaver's heading, on the cached build's skinned mesh:

  head    cleaver / hand vertices inside the mask or cowl (the pommel or a fist in the chin)
  arms    forearm / fist vertices inside the coat / cowl / belt
  coat    cleaver vertices inside the coat (the haft through the belly)
  miss    the right wrist's distance from its target, the left palm's from the pommel (m: out of reach)
  pommel  the pommel crown's height and its distance in front of the chest

    Blender -b --factory-startup --python art/blender/proto/burdam_plant.py -- [--top 15]
"""
from __future__ import annotations

import itertools
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


def main():
    import argparse
    from common import scene
    p = argparse.ArgumentParser()
    p.add_argument("--top", type=int, default=15)
    p.add_argument("--wx", default="-0.07,-0.13")
    p.add_argument("--wy", default="-0.50,-0.56,-0.62")
    p.add_argument("--wz", default="1.16,1.22,1.28")
    p.add_argument("--fold", default="4,8,12")
    p.add_argument("--dx", default="-0.03,-0.12")
    p.add_argument("--elev", default="-0.78")
    a = p.parse_args(scene.script_args())
    bpy.ops.wm.open_mainfile(filepath=os.path.join(scene.CACHE_DIR, "fighters", "burdam.blend"))
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    from common import anim
    import burdam as F
    F._install_aim_roll()
    arm = bpy.data.objects["burdam_rig"]
    ctx = types.SimpleNamespace(info=types.SimpleNamespace(armature=arm, props=F.PROPORTIONS, joints={}), spec=F,
                                chains={}, skin=None)
    R = F.Rig(ctx)
    skel = R.skel
    body = bpy.data.objects["burdam"]
    names = [x[0] for x in F.sculpts()]
    me = body.data
    n = len(me.vertices)
    pv = np.zeros(n, dtype=np.int64)
    me.attributes["vale_part"].data.foreach_get("value", pv)
    ids = {nm: i for i, nm in enumerate(names)}
    polys = [tuple(q.vertices) for q in me.polygons]
    ppart = np.array([pv[q[0]] for q in polys])
    sel = lambda nms: np.isin(pv, [ids[x] for x in nms if x in ids])  # noqa: E731
    cl_v = sel(F.CLEAVER)
    hand_v = sel(("fist_R", "palm_L", "fingers_L"))
    arm_v = sel(("forearms", "fist_R", "palm_L", "fingers_L", "vambrace", "strap_plate"))
    head_f = [i for i in range(len(polys)) if names[ppart[i]] in ("mask", "cowl")]
    torso_f = [i for i in range(len(polys)) if names[ppart[i]] in ("coat", "belt", "cowl")]
    coat_f = [i for i in range(len(polys)) if names[ppart[i]] in ("coat", "belt", "skirt")]
    deps = bpy.context.evaluated_depsgraph_get()
    Mw = np.array(body.matrix_world)
    pb = arm.pose.bones

    def posed(pose):
        anim.apply_pose(arm, pose)
        deps.update()
        ev = body.evaluated_get(deps)
        m2 = ev.to_mesh()
        co = np.empty(len(m2.vertices) * 3, dtype=np.float32)
        m2.vertices.foreach_get("co", co)
        ev.to_mesh_clear()
        return co.reshape(-1, 3) @ Mw[:3, :3].T + Mw[:3, 3]

    def inside(co, vsel, faces, tol=0.01):
        bvh = BVHTree.FromPolygons([tuple(c) for c in co], [polys[i] for i in faces])
        c = 0
        for vi in np.nonzero(vsel)[0][::2]:
            v = Vector(co[vi])
            loc, nrm, fi, dist = bvh.find_nearest(v, 0.3)
            if loc is not None and (v - loc).dot(nrm) < -tol:
                c += 1
        return c

    fl = lambda s: [float(x) for x in s.split(",")]  # noqa: E731
    rows = []
    orig = (F.STUB_W, F.STUB_D)
    for wx, wy, wz, fold, dx, dz in itertools.product(fl(a.wx), fl(a.wy), fl(a.wz), fl(a.fold), fl(a.dx), fl(a.elev)):
        d = np.array([dx, -np.sqrt(max(0.0, 1.0 - dx * dx - dz * dz)), dz])
        F.STUB_W, F.STUB_D = (wx, wy, wz), tuple(d)
        base = F._plant_two(R, 1.3)
        base = anim.add(base, F._P(hips=(fold - 12.0, 0, 0)))
        pose = R.tip_to(base)
        clip = F._two_handed(anim.Clip("t", 30, False, lambda t, _p=pose: _p), [(0.0, 1.0), (1.0, 1.0)], skel,
                             along=F.POMMEL_GRIP)
        q = clip.sample(0.5)
        co = posed(q)
        W = lambda b: np.array((arm.matrix_world @ pb[b].matrix).translation)  # noqa: E731
        miss_r = float(np.linalg.norm(W("hand.R") - np.array((wx, wy, wz))))
        Mp = (arm.matrix_world @ pb["prop.R"].matrix)
        ax = np.array(Mp.to_3x3().col[1])
        pom = np.array(Mp.translation) + ax * F.POMMEL_GRIP
        miss_l = float(np.linalg.norm(W("prop.L") - pom))
        ch = W("chest")
        hh = inside(co, cl_v | hand_v, head_f)
        aa = inside(co, arm_v, torso_f)
        cc = inside(co, cl_v, coat_f)
        rows.append((hh, aa, cc, miss_r, miss_l, pom[2], ch[1] - pom[1], wx, wy, wz, fold, dx, dz,
                     float(W("head")[2])))
    F.STUB_W, F.STUB_D = orig
    rows.sort(key=lambda r: r[0] * 3 + r[1] + r[2] * 2 + 400 * max(0.0, r[3] - 0.03) + 400 * max(0.0, r[4] - 0.05))
    print("head arms coat | miss R  miss L | pommel z  ahead | wrist                fold   dx    dz   | head z")
    for r in rows[: a.top]:
        print(f"{r[0]:4d} {r[1]:4d} {r[2]:4d} | {r[3]:.3f}  {r[4]:.3f} | {r[5]:.2f}  {r[6]:+.2f} | "
              f"({r[7]:+.2f},{r[8]:+.2f},{r[9]:.2f}) {r[10]:4.0f} {r[11]:+.2f} {r[12]:+.2f} | {r[13]:.2f}")


if __name__ == "__main__":
    main()
