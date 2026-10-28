"""Lisvel clash probe: on the cached build (art/.cache/fighters/lisvel.blend) posed at a clip frame, rays cast inward
toward the body's axis over a band of heights (in the hips' frame: rest heights) report which part each ray meets first, so a layer that pokes through
the one meant to cover it shows up by name and place.

    /Applications/Blender.app/Contents/MacOS/Blender -b art/.cache/fighters/lisvel.blend --python art/blender/proto/lisvel_clash.py -- \
        [--clip idle] [--t 0.0] [--z0 1.08 --z1 1.24] [--expect tabard_skirt,belt,quiver_straps]
"""
import argparse
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "fighters"))
from common import scene  # noqa: E402
import lisvel as L  # noqa: E402


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--clip", default="idle")
    p.add_argument("--t", type=float, default=0.0)
    p.add_argument("--z0", type=float, default=1.08)
    p.add_argument("--z1", type=float, default=1.24)
    p.add_argument("--expect", default="")
    a = p.parse_args(scene.script_args())
    names = [it[0] for it in L.sculpts()]
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    body = next(o for o in bpy.data.objects if o.type == "MESH" and o.data.attributes.get("vale_part")
                and o.name.startswith("lisvel") and not o.name.endswith("accent"))
    act = bpy.data.actions.get(a.clip) or next((x for x in bpy.data.actions if x.name.endswith(a.clip)), None)
    if act is not None and a.clip != "rest":
        arm.animation_data_create()
        arm.animation_data.action = act
        try:
            arm.animation_data.action_slot = act.slots[0]
        except Exception:
            pass
        f0, f1 = act.frame_range
        bpy.context.scene.frame_set(int(round(f0 + (f1 - f0) * a.t)))
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    me = ev.to_mesh()
    pv = np.zeros(len(body.data.vertices), dtype=np.int64)
    body.data.attributes["vale_part"].data.foreach_get("value", pv)
    verts = [ev.matrix_world @ v.co for v in me.vertices]
    polys = [tuple(pl.vertices) for pl in me.polygons]
    fpart = [pv[pl[0]] for pl in polys]
    bvh = BVHTree.FromPolygons(verts, polys)
    pb = arm.pose.bones["hips"]
    Mh = arm.matrix_world @ pb.matrix @ pb.bone.matrix_local.inverted()      # the hips' deformation (rest -> pose)
    R3 = Mh.to_3x3()
    exp = set(a.expect.split(",")) if a.expect else None
    hits, bad = {}, []
    for z in np.linspace(a.z0, a.z1, 33):
        c = Vector((0.0, 0.0, z))
        for th in np.linspace(0, 2 * math.pi, 96, endpoint=False):
            d = Vector((math.cos(th), math.sin(th), 0.0))
            o = Mh @ (c + d * 0.6)
            loc, nrm, fi, dist = bvh.ray_cast(o, -(R3 @ d).normalized(), 0.6)
            if fi is None:
                continue
            nm = names[fpart[fi]] if fpart[fi] < len(names) else f"#{fpart[fi]}"
            hits[nm] = hits.get(nm, 0) + 1
            if exp is not None and nm not in exp:
                bad.append((round(z, 3), round(math.degrees(th)), nm))
    print(f"[clash] {a.clip} t={a.t} z {a.z0}..{a.z1}: first hits {dict(sorted(hits.items(), key=lambda kv: -kv[1]))}")
    if bad:
        by = {}
        for z, th, nm in bad:
            by.setdefault(nm, []).append((z, th))
        for nm, lst in by.items():
            print(f"[clash]   {nm}: {len(lst)} rays, e.g. {lst[:8]}")
    ev.to_mesh_clear()


main()
