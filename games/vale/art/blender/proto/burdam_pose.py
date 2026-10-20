"""Burdam pose preview: the cached build (art/.cache/fighters/burdam.blend) posed at clip keys from the
CURRENT fighters/burdam.py clips, rendered fast with Workbench (painted texture) from a few views.
For iterating on clip_overrides without a full build.

    Blender -b --factory-startup --python art/blender/proto/burdam_pose.py -- \
        --keys "idle:0,run:0,run:0.5,attack1:0.4" [--views 3q,front,side,game] [--out pose_preview.png]

Writes art/renders/fighters/burdam/<out> (rows = keys, columns = views) and prints the key order.
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


def args():
    import argparse
    from common import scene
    p = argparse.ArgumentParser()
    p.add_argument("--keys", default="idle:0")
    p.add_argument("--views", default="3q,front,side,game")
    p.add_argument("--cell", type=int, default=400)
    p.add_argument("--out", default="pose_preview.png")
    return p.parse_args(scene.script_args())


def main():
    from common import scene
    a = args()
    bpy.ops.wm.open_mainfile(filepath=os.path.join(scene.CACHE_DIR, "fighters", "burdam.blend"))
    from mathutils import Vector
    from common import anim
    from common.hifi import project
    import burdam as F
    F._install_aim_roll()
    arm = bpy.data.objects["burdam_rig"]
    ctx = types.SimpleNamespace(info=types.SimpleNamespace(armature=arm, props=F.PROPORTIONS, joints={}), spec=F,
                                chains={}, skin=None)
    skel = anim.Skeleton(arm)
    clips = anim.standard_clips(skel, F.MOTION, F.clip_overrides(ctx) if hasattr(F, "clip_overrides") else {})
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "FLAT"
    sh.color_type = "TEXTURE"
    sh.show_shadows = True
    sh.show_cavity = True
    sc.render.resolution_x = sc.render.resolution_y = a.cell
    sc.render.film_transparent = False
    sc.world.color = (0.55, 0.57, 0.6)
    for m in bpy.data.materials:
        if m.node_tree:
            for n in m.node_tree.nodes:
                if n.type == "TEX_IMAGE" and n.image and n.image.name.endswith("_base"):
                    m.node_tree.nodes.active = n
    if "pv_ground" not in bpy.data.objects:
        bpy.ops.mesh.primitive_plane_add(size=8)
        g = bpy.context.active_object
        g.name = "pv_ground"
    cam_data = bpy.data.cameras.new("pv_cam")
    cam = bpy.data.objects.new("pv_cam", cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam

    def place(view):
        tgt = Vector((0, 0, 1.15))
        if view == "game":
            cam_data.lens = 115
            pitch, yaw, dist = 52.0, 0.0, 9.5
            tgt = Vector((0, 0, 1.0))
        else:
            cam_data.lens = 80
            pitch, dist = 8.0, 6.6
            yaw = {"3q": -35.0, "front": 0.0, "side": 90.0, "back": 180.0, "3qb": 145.0}[view]
        p, y = math.radians(pitch), math.radians(yaw)
        loc = tgt + Vector((math.sin(y) * math.cos(p) * dist, -math.cos(y) * math.cos(p) * dist, math.sin(p) * dist))
        cam.location = loc
        cam.rotation_euler = (tgt - loc).to_track_quat("-Z", "Y").to_euler()

    names = [x[0] for x in F.sculpts()]
    cleaver = {names.index(n) for n in F.CLEAVER if n in names}
    body = bpy.data.objects["burdam"]

    def clearance():
        """cleaver vertices inside the body (by part) in the current pose"""
        from mathutils.bvhtree import BVHTree
        deps = bpy.context.evaluated_depsgraph_get()
        ev = body.evaluated_get(deps)
        me = ev.to_mesh()
        co = np.empty(len(me.vertices) * 3, dtype=np.float32)
        me.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        at = me.attributes.get("vale_part")
        pv = np.zeros(len(co), dtype=np.int64)
        if at is not None:
            at.data.foreach_get("value", pv)
        polys = [tuple(p.vertices) for p in me.polygons]
        ppart = np.array([pv[p[0]] for p in polys])
        keep = [i for i, p in enumerate(polys) if ppart[i] not in cleaver]
        bvh = BVHTree.FromPolygons([tuple(c) for c in co], [polys[i] for i in keep])
        hits = {}
        for vi in np.nonzero(np.isin(pv, list(cleaver)))[0][::3]:
            v = Vector(co[vi])
            loc, n, fi, dist = bvh.find_nearest(v, 0.2)
            if loc is not None and (v - loc).dot(n) < -0.004:
                pn = names[ppart[keep[fi]]]
                hits[pn] = hits.get(pn, 0) + 1
        ev.to_mesh_clear()
        return hits

    keys = [k.split(":") for k in a.keys.split(",")]
    views = a.views.split(",")
    C = a.cell
    sheet = np.ones((C * len(keys), C * len(views), 3), dtype=np.float32)
    tmp = os.path.join(scene.CACHE_DIR, "_pv.png")
    for r, (name, t) in enumerate(keys):
        clip = clips[name]
        pose = clip.sample(float(t))
        anim.apply_pose(arm, pose)
        for c, v in enumerate(views):
            place(v)
            sc.render.filepath = tmp
            bpy.ops.render.render(write_still=True)
            img = project.load_rgb(tmp)
            sheet[r * C:(r + 1) * C, c * C:(c + 1) * C] = img[:C, :C]
        print(f"row {r}: {name} t={t} (frame {float(t) * clip.frames:.0f}/{clip.frames})")
        print("   cleaver inside:", clearance() or "none")
        pb = arm.pose.bones
        for b in ("hand.R", "prop.R", "x_blade_tip", "hand.L", "head"):
            if b in pb:
                m = arm.matrix_world @ pb[b].matrix
                print(f"   {b:12s} at ({m.translation.x:+.2f}, {m.translation.y:+.2f}, {m.translation.z:+.2f})"
                      + (f"  axis {tuple(round(c, 2) for c in m.to_3x3().col[1])} flat {tuple(round(c, 2) for c in m.to_3x3().col[0])}"
                         if b == "prop.R" else ""))
    out = os.path.join(scene.RENDERS_DIR, "fighters", "burdam", a.out)
    project.save_rgb(sheet, out)
    print("wrote", out)


if __name__ == "__main__":
    main()
