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
    p.add_argument("--measure", default="", help="comma list of clips: ground contact per sampled frame")
    p.add_argument("--step", type=int, default=3)
    p.add_argument("--rebind", action="store_true")
    p.add_argument("--partcolors", action="store_true", help="flat colour per part (find which part is where)")
    p.add_argument("--tex", default="", help="swap the cached base colour for this image (post-paint work)")
    p.add_argument("--lit", action="store_true", help="studio lighting instead of flat (reads values)")
    p.add_argument("--carry", default="", help="override CARRY: 'rx,ry,rz;dx,dy,dz;ux,uy,uz' (fix pass 6 search)")
    p.add_argument("--bar", type=float, default=0.0, help="game views: draw the health bar for this art height")
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
    if a.carry:
        rr, dd, uu = ([float(c) for c in part.split(",")] for part in a.carry.split(";"))
        F.CARRY = dict(F.CARRY, rel=tuple(rr), d=tuple(dd), up=tuple(uu))
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
                    if a.tex:
                        img = bpy.data.images.load(a.tex, check_existing=False)
                        n.image = img
    if a.lit:
        sh.light = "STUDIO"
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
        if view.startswith("lhand"):
            pbh = bpy.data.objects["burdam_rig"].pose.bones["hand.L"]
            tgt = (bpy.data.objects["burdam_rig"].matrix_world @ pbh.matrix).translation.copy()
            cam_data.lens = 80
            yaw = {"lhand": 0.0, "lhand_s": 70.0, "lhand_t": 0.0}[view]
            pitch = 55.0 if view == "lhand_t" else 10.0
            dist = 1.6
        elif view.startswith("lsh") or view.startswith("rsh") or view.startswith("headc"):
            bn = {"l": "upper_arm.L", "r": "upper_arm.R", "h": "head"}[view[0]]
            pbh = bpy.data.objects["burdam_rig"].pose.bones[bn]
            tgt = (bpy.data.objects["burdam_rig"].matrix_world @ pbh.matrix).translation.copy()
            cam_data.lens = 80
            yaw = {"": 0.0, "_s": 70.0 if view[0] != "r" else -70.0, "_b": 180.0, "_3": 35.0 if view[0] != "r" else -35.0}[
                view[3:] if not view.startswith("headc") else view[5:]]
            pitch = 15.0
            dist = 1.8
        elif view.startswith("game"):
            cam_data.lens = 115
            pitch, dist = 52.0, 9.5
            yaw = {"game": 0.0, "gameW": 90.0, "gameE": -90.0, "gameN": 180.0, "gameSW": 45.0, "gameSE": -45.0,
                   "gameNW": 135.0, "gameNE": -135.0, "gameSSW": 22.5, "gameWSW": 67.5, "gameESE": -67.5,
                   "gameSSE": -22.5}[view]
            tgt = Vector((0, 0, 1.0))
        elif not view.startswith("lhand"):
            cam_data.lens = 80
            pitch, dist = 8.0, 6.6
            yaw = {"3q": -35.0, "3qL": 35.0, "front": 0.0, "side": 90.0, "sideR": -90.0, "back": 180.0, "3qb": 145.0}[view]
        p, y = math.radians(pitch), math.radians(yaw)
        loc = tgt + Vector((math.sin(y) * math.cos(p) * dist, -math.cos(y) * math.cos(p) * dist, math.sin(p) * dist))
        cam.location = loc
        cam.rotation_euler = (tgt - loc).to_track_quat("-Z", "Y").to_euler()
        bar = bpy.data.objects.get("pv_bar")
        if bar is not None:
            bar.hide_render = not view.startswith("game")
            if view.startswith("game"):
                # the health bar: 108 + 22 px x 18 px at 82.1 px/m, centred 11 px left of the anchor, facing the camera
                R3 = cam.rotation_euler.to_matrix()
                bar.location = Vector((0, 0, a.bar + 0.35)) + R3 @ Vector((-11 / 82.1, 0, 0.0))
                bar.rotation_euler = cam.rotation_euler

    if a.bar > 0:
        bpy.ops.mesh.primitive_plane_add(size=1.0)
        bar = bpy.context.active_object
        bar.name = "pv_bar"
        bar.scale = (130 / 82.1, 18 / 82.1, 1.0)
        m = bpy.data.materials.new("pv_bar_m")
        m.diffuse_color = (0.25, 0.75, 0.4, 1.0)
        bar.data.materials.append(m)
        sh.color_type = "TEXTURE"
    names = [x[0] for x in F.sculpts()]
    if a.rebind:
        import burdam_audit
        burdam_audit.rebind_cache(bpy.data.objects["burdam"], arm, names, {x[0]: x[4] for x in F.sculpts()})
    cleaver = {names.index(n) for n in F.CLEAVER if n in names}
    if a.partcolors:
        me = bpy.data.objects["burdam"].data
        pv = np.zeros(len(me.vertices), dtype=np.int64)
        me.attributes["vale_part"].data.foreach_get("value", pv)
        rng = np.random.default_rng(3)
        pal = rng.uniform(0.15, 1.0, (len(names) + 4, 3))
        ca = me.color_attributes.new("partcol", "FLOAT_COLOR", "POINT")
        cols = np.concatenate([pal[pv], np.ones((len(pv), 1))], axis=1).astype(np.float32)
        ca.data.foreach_set("color", cols.ravel())
        me.color_attributes.active_color = ca
        sh.color_type = "VERTEX"
        print("part colours:", {nm: tuple(int(c * 255) for c in pal[i]) for i, nm in enumerate(names)})
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

    if a.measure:
        measure(a, clips, arm, body, cleaver)
        return
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


def measure(a, clips, arm, body, cleaver):
    """per sampled frame: the body's lowest point (skinned, cleaver excluded), the cleaver's lowest point,
    the blade tip socket, toes, hips and both wrists (m); flags anything below the ground"""
    from common import anim
    deps = bpy.context.evaluated_depsgraph_get()
    pb = arm.pose.bones
    import burdam as F
    F_sculpts = F.sculpts()
    names = list(a.measure.split(","))
    for name in names:
        clip = clips[name]
        print(f"== {name} ({clip.frames} f, impact {clip.impact})")
        print("   f    body  cleav   tip   toeL  toeR  hipsZ  hipsY  handL(x,y,z)        handR z  prop.L")
        rng = {"handL": [], "handR": [], "chest": [], "hips": []}
        for f in list(range(0, clip.frames, a.step)) + [clip.frames - 1]:
            pose = clip.sample(f / clip.frames)
            anim.apply_pose(arm, pose)
            deps.update()
            ev = body.evaluated_get(deps)
            me = ev.to_mesh()
            co = np.empty(len(me.vertices) * 3, dtype=np.float32)
            me.vertices.foreach_get("co", co)
            co = co.reshape(-1, 3) @ np.array(body.matrix_world)[:3, :3].T + np.array(body.matrix_world)[:3, 3]
            at = me.attributes.get("vale_part")
            pv = np.zeros(len(co), dtype=np.int64)
            if at is not None:
                at.data.foreach_get("value", pv)
            cl_ = np.isin(pv, list(cleaver))
            ev.to_mesh_clear()
            W = lambda b: (arm.matrix_world @ pb[b].matrix).translation  # noqa: E731
            tip = W("x_blade_tip").z if "x_blade_tip" in pb else float("nan")
            hl, hr = W("hand.L"), W("hand.R")
            rng["handL"].append(tuple(hl)); rng["handR"].append(tuple(hr))
            rng["chest"].append(tuple(W("chest"))); rng["hips"].append(tuple(W("hips")))
            flag = " <" if co[~cl_, 2].min() < -0.03 or (cl_.any() and co[cl_, 2].min() < -0.08) else ""
            if flag:
                lo = int(np.argmin(np.where(cl_, 9.0, co[:, 2])))
                pn = [x[0] for x in F_sculpts][pv[lo]] if pv[lo] < len(F_sculpts) else pv[lo]
                flag += f" {pn}"
            plr = pose.get("prop.L", (0, 0, 0))
            print(f"  {f:3d}  {co[~cl_, 2].min():+.2f}  {co[cl_, 2].min() if cl_.any() else 0:+.2f}  {tip:+.2f}  "
                  f"{W('toe.L').z:+.2f}  {W('toe.R').z:+.2f}  {W('hips').z:+.2f}  {W('hips').y:+.2f}  "
                  f"({hl.x:+.2f},{hl.y:+.2f},{hl.z:+.2f})  {hr.z:+.2f}   {plr[1]:+.0f}{flag}")
        for k, v in rng.items():
            v = np.array(v)
            print(f"   range {k}: {np.round(v.max(0) - v.min(0), 3).tolist()}")


if __name__ == "__main__":
    main()
