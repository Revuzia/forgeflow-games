"""Burdam unsling search (fix pass 6): the first beat off the shoulder carry (and the last beat back onto it), a
pose with the cleaver tipped up off the back to near upright beside the right shoulder. For each candidate (right
wrist point in armature space, blade tilt out / back from vertical) the cached build is posed at the unsling and
at the in-betweens from the carry (G -> U at 1/3, 2/3) and measured: cleaver + right fist + forearm vertices inside
the cowl / mask (the felt roll is the bulky one), cleaver vertices inside the torso. The flat normal is carried
over from the carry by the minimal rotation between the two blade axes (no roll flip on the way up).

    Blender -b --factory-startup --python art/blender/proto/burdam_unsling.py -- [--top 12]
"""
from __future__ import annotations

import itertools
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


def main():
    import argparse
    from common import scene
    p = argparse.ArgumentParser()
    p.add_argument("--top", type=int, default=12)
    p.add_argument("--wx", default="-0.56,-0.62,-0.68")
    p.add_argument("--wy", default="-0.10,-0.02,0.06")
    p.add_argument("--wz", default="1.56,1.64,1.72")
    p.add_argument("--out_", default="0,15,30")
    p.add_argument("--back", default="0,15,30")
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
    body = bpy.data.objects["burdam"]
    names = [x[0] for x in F.sculpts()]
    me = body.data
    n = len(me.vertices)
    pv = np.zeros(n, dtype=np.int64)
    me.attributes["vale_part"].data.foreach_get("value", pv)
    pname = np.array(names)[pv]
    co0 = np.empty(n * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co0)
    co0 = co0.reshape(-1, 3)
    movers = np.isin(pname, F.CLEAVER) | (pname == "fist_R") | ((pname == "forearms") & (co0[:, 0] < 0))
    cl = np.isin(pname, F.CLEAVER)
    polys = [tuple(q.vertices) for q in me.polygons]
    ppart = np.array([names[pv[q[0]]] for q in polys])
    head = [i for i in range(len(polys)) if ppart[i] in ("cowl", "mask")]
    torso = [i for i in range(len(polys)) if ppart[i] in ("coat", "belt", "skirt", "tier1", "shoulder_plate")]
    deps = bpy.context.evaluated_depsgraph_get()
    Mw = np.array(body.matrix_world)

    def posed(pose):
        anim.apply_pose(arm, anim.resolve(R.skel, pose) if "ik" in pose else pose)
        deps.update()
        ev = body.evaluated_get(deps)
        m2 = ev.to_mesh()
        co = np.empty(len(m2.vertices) * 3, dtype=np.float32)
        m2.vertices.foreach_get("co", co)
        ev.to_mesh_clear()
        return co.reshape(-1, 3) @ Mw[:3, :3].T + Mw[:3, 3]

    def inside(co, sel, faces, tol=0.008):
        bvh = BVHTree.FromPolygons([tuple(c) for c in co], [polys[i] for i in faces])
        c, deep = 0, 0.0
        for vi in np.nonzero(sel)[0][::2]:
            v = Vector(co[vi])
            loc, nrm, fi, dist = bvh.find_nearest(v, 0.3)
            if loc is not None:
                d = (v - loc).dot(nrm)
                if d < -tol:
                    c += 1
                    deep = max(deep, -d)
        return c, deep

    G = F.guard_pose()
    d0 = Vector(F.CARRY["d"]).normalized()
    up0 = Vector(F.CARRY["up"]).normalized()
    fl = lambda s: [float(x) for x in s.split(",")]  # noqa: E731
    rows = []
    base = F._pose(G, F._P(chest=(0, -3, 0), head=(0, 3, 0)), (0, 0, 0))
    for wx, wy, wz, to, tb in itertools.product(fl(a.wx), fl(a.wy), fl(a.wz), fl(a.out_), fl(a.back)):
        o, b = math.radians(to), math.radians(tb)
        d = Vector((-math.sin(o), math.sin(b), math.cos(o) * math.cos(b))).normalized()
        up = d0.rotation_difference(d) @ up0
        U = R.place(base, (wx, wy, wz), tuple(d), tuple(up), pole=F.CARRY["pole"])
        hits, deep, th = 0, 0.0, 0
        for t in (1 / 3, 2 / 3, 1.0):
            co = posed(anim.lerp_pose(G, U, t))
            c, dp = inside(co, movers, head)
            ct, _ = inside(co, cl, torso)
            hits += c
            th += ct
            deep = max(deep, dp)
        rel = U["ik"]["hand.R"].rel
        rows.append((hits + th, hits, deep, th, (wx, wy, wz), (to, tb), tuple(round(c, 3) for c in rel),
                     tuple(round(c, 3) for c in d), tuple(round(c, 3) for c in up)))
    rows.sort(key=lambda r: (r[0], r[2]))
    for r in rows[: a.top]:
        print(f"  hits {r[1]:4d} (deep {r[2]:.3f}) torso {r[3]:4d} wrist {r[4]} out/back {r[5]} -> "
              f"rel={r[6]}, d={r[7]}, up={r[8]}")


if __name__ == "__main__":
    main()
