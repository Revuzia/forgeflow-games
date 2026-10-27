"""Burdam carry search (fix pass 4): the shoulder carry with the fist at SHOULDER height and the haft resting on the
right shoulder plate, the blade laid up and back behind the head. For each candidate (right wrist point, blade
heading, elevation) the cached build's rigid cleaver is posed by FK (no mesh re-skinning: the torso and head are
posed once in the guard) and scored:

  hits    cleaver vertices inside the torso / head / cowl (must be 0) and inside the right shoulder parts (> 2 cm)
  rest    the haft's distance to the right shoulder plate's top (a resting haft: under ~4 cm)
  bar     the blade's share in view around the health bar from the 52 degree camera, min / mean over 8 facings
  fist    the fist's height above the right shoulder joint (m)

    Blender -b --factory-startup --python art/blender/proto/burdam_carry.py -- [--top 25] [--height 2.30]
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
    p.add_argument("--top", type=int, default=25)
    p.add_argument("--height", type=float, default=2.30)
    p.add_argument("--wx", default="-0.40,-0.34,-0.28")
    p.add_argument("--wy", default="-0.30,-0.22,-0.14")
    p.add_argument("--wz", default="1.50,1.56,1.62,1.68")
    p.add_argument("--head", default="15,25,35,45,55")
    p.add_argument("--elev", default="25,32,39,46,53")
    a = p.parse_args(scene.script_args())
    bpy.ops.wm.open_mainfile(filepath=os.path.join(scene.CACHE_DIR, "fighters", "burdam.blend"))
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    from common import anim
    import burdam as F
    import burdam_audit as AU
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
    co0 = np.empty(n * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co0)
    co0 = co0.reshape(-1, 3).astype(np.float64)
    pv = np.zeros(n, dtype=np.int64)
    me.attributes["vale_part"].data.foreach_get("value", pv)
    ids = {nm: i for i, nm in enumerate(names)}
    cl_sel = np.isin(pv, [ids[x] for x in F.CLEAVER])
    blade_sel = np.isin(pv, [ids[x] for x in ("blade", "heel")])
    haft_sel = np.isin(pv, [ids["haft"]])
    G = F.guard_pose()
    anim.apply_pose(arm, G)
    deps = bpy.context.evaluated_depsgraph_get()
    deps.update()
    ev = body.evaluated_get(deps)
    m2 = ev.to_mesh()
    co = np.empty(len(m2.vertices) * 3, dtype=np.float32)
    m2.vertices.foreach_get("co", co)
    ev.to_mesh_clear()
    Mw = np.array(body.matrix_world)
    co = co.reshape(-1, 3) @ Mw[:3, :3].T + Mw[:3, 3]
    polys = [tuple(p_.vertices) for p_ in me.polygons]
    ppart = np.array([pv[q[0]] for q in polys])
    hard = [i for i in range(len(polys)) if names[ppart[i]] in ("mask", "cowl", "coat", "belt", "skirt", "tier1")]
    soft = [i for i in range(len(polys)) if names[ppart[i]] in ("shoulder_plate", "fringe")]
    bvh_h = BVHTree.FromPolygons([tuple(c) for c in co], [polys[i] for i in hard])
    bvh_s = BVHTree.FromPolygons([tuple(c) for c in co], [polys[i] for i in soft])
    sp = co[pv == ids["shoulder_plate"]]
    sp_top = sp[sp[:, 2] > np.percentile(sp[:, 2], 70)]
    # rest-pose cleaver vertices in the prop.R bone's rest frame
    Mb = np.array(arm.data.bones["prop.R"].matrix_local)
    loc_cl = (co0[cl_sel] - Mb[:3, 3]) @ Mb[:3, :3]
    is_blade = blade_sel[cl_sel]
    is_haft = haft_sel[cl_sel]
    sh = skel.fk(anim.resolve(skel, G))
    shoulder = np.array((sh[skel.parent["upper_arm.R"]] @ skel.local["upper_arm.R"]).translation)
    print(f"right shoulder joint {np.round(shoulder, 3).tolist()}, plate top z {sp_top[:, 2].mean():.3f}")

    BY = {}

    def inside(bvh, P, tol, faces=None):
        c, deep = 0, 0.0
        for v in P[::2]:
            loc, nrm, fi, dist = bvh.find_nearest(Vector(v), 0.3)
            if loc is None:
                continue
            d = (Vector(v) - loc).dot(nrm)
            if d < -tol:
                c += 1
                deep = max(deep, -d)
                if faces is not None:
                    k = names[ppart[faces[fi]]]
                    BY[k] = BY.get(k, 0) + 1
        return c, deep

    rows = []
    fl = lambda s: [float(x) for x in s.split(",")]  # noqa: E731
    for wx, wy, wz, hd, el in itertools.product(fl(a.wx), fl(a.wy), fl(a.wz), fl(a.head), fl(a.elev)):
        h, e = math.radians(hd), math.radians(el)
        d = np.array([math.cos(e) * math.cos(h), math.cos(e) * math.sin(h), math.sin(e)])
        s = np.cross([0.0, 0.0, 1.0], d)
        s /= np.linalg.norm(s)
        if s[1] < 0:
            s = -s
        up = np.cross(s, d)
        pose = R.place(G, (wx, wy, wz), tuple(d), tuple(up), pole=tuple(F.CARRY["pole"]))
        q = anim.resolve(skel, pose)
        M = skel.fk(q)
        Mp = np.array(M["prop.R"])
        P = loc_cl @ Mp[:3, :3].T + Mp[:3, 3]
        grip = Mp[:3, 3]
        ax = Mp[:3, 1]
        if np.dot(ax, d) < 0.98:              # out of reach: the aim did not take
            continue
        wr = np.array(M["hand.R"].translation)
        if np.linalg.norm(wr - np.array((wx, wy, wz))) > 0.04:
            continue
        BY.clear()
        nh, dh = inside(bvh_h, P, 0.005, hard)
        ns, ds = inside(bvh_s, P, 0.02)
        hp = P[is_haft]
        dd = np.min(np.linalg.norm(hp[:, None, :] - sp_top[None, ::4, :], axis=2))
        vis = AU.bar_visibility(P[is_blade], a.height)
        rows.append((nh, ns, dd, min(vis), float(np.mean(vis)), wx, wy, wz, hd, el, grip[2] - shoulder[2],
                     tuple(np.round(d, 3)), tuple(np.round(up, 3)), dh, ds, dict(BY)))
    if len(rows) <= 12:
        for r in rows:
            print(f"  dbg wrist ({r[5]:+.2f},{r[6]:+.2f},{r[7]:.2f}) head {r[8]:3.0f} elev {r[9]:3.0f} hits {r[0]} ({r[13]:.3f}) "
                  f"plate {r[1]} ({r[14]:.3f}) rest {r[2]:.3f} bar {r[3]:.2f}/{r[4]:.2f} fist {r[10]:+.2f} {r[15]}")
    ok = [r for r in rows if r[0] == 0 and r[1] == 0]
    print(f"{len(rows)} reachable candidates, {len(ok)} with no hits")
    ok.sort(key=lambda r: -(r[3] + 0.5 * r[4] - 1.5 * max(0.0, r[2] - 0.04)))
    for r in ok[: a.top]:
        print(f"  wrist ({r[5]:+.2f},{r[6]:+.2f},{r[7]:.2f}) head {r[8]:3.0f} elev {r[9]:3.0f}  fist {r[10]:+.2f} m  "
              f"rest {r[2]:.3f}  bar {r[3]:.2f}/{r[4]:.2f}  d {r[11]} up {r[12]}")
    near = sorted([r for r in rows if r[0] == 0], key=lambda r: -(r[3] + 0.5 * r[4]))[:8]
    print("best ignoring shoulder-plate contact:")
    for r in near:
        print(f"  wrist ({r[5]:+.2f},{r[6]:+.2f},{r[7]:.2f}) head {r[8]:3.0f} elev {r[9]:3.0f}  plate hits {r[1]} "
              f"({r[14]:.3f} m)  rest {r[2]:.3f}  bar {r[3]:.2f}/{r[4]:.2f}")


if __name__ == "__main__":
    main()
