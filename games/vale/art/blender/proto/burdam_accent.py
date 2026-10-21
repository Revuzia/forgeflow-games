"""Burdam accent estimate without a full build: the cached build (art/.cache/fighters/burdam.blend) with its
cleaver heel + accent parts REPLACED by the current fighters/burdam.py sculpts, posed in idle f0 and rendered
unlit at the three QA's game camera (pitch 52, vFOV 26, 28.5 m; a 160 px crop of the 1080p frame, 8 facings),
counted the way art/tools/three_snapshot.mjs counts (accent > 200, body > 40 of 255).

    Blender -b --factory-startup --python art/blender/proto/burdam_accent.py -- [--save sheet.png]
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


def main():
    import argparse
    from common import scene
    ap = argparse.ArgumentParser()
    ap.add_argument("--save", default="")
    ap.add_argument("--clip", default="idle")
    ap.add_argument("--textured", default="", help="also render the textured model at 3x with the HP bar marked")
    a = ap.parse_args(scene.script_args())
    bpy.ops.wm.open_mainfile(filepath=os.path.join(scene.CACHE_DIR, "fighters", "burdam.blend"))
    from mathutils import Matrix, Vector
    from common import anim, rig
    from common.hifi import sdf
    import burdam as F
    F._install_aim_roll()
    arm = bpy.data.objects["burdam_rig"]
    body = bpy.data.objects["burdam"]
    names = [x[0] for x in F.sculpts()]
    # drop the cached heel / gems / accent geometry
    import bmesh
    me = body.data
    pv = np.zeros(len(me.vertices), dtype=np.int64)
    me.attributes["vale_part"].data.foreach_get("value", pv)
    drop = {names.index(n) for n in ("heel", "gems") if n in names}
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if pv[v.index] in drop], context="VERTS")
    bm.to_mesh(me)
    bm.free()
    for o in list(bpy.data.objects):
        if o.name.startswith("burdam_accent"):
            bpy.data.objects.remove(o)
    # the current heel + gems, in prop space -> the bind pose -> parented to prop.R
    M = np.array(rig.prop_matrix(types.SimpleNamespace(armature=arm), "prop.R"))
    grey = bpy.data.materials.new("est_grey")
    grey.diffuse_color = (0.5, 0.5, 0.5, 1.0)
    white = bpy.data.materials.new("est_white")
    white.diffuse_color = (1.0, 1.0, 1.0, 1.0)
    acc_names = set()
    arm.data.pose_position = "REST"
    bpy.context.view_layer.update()
    for (nm, S, vs, role, bind, tris, space) in F.sculpts():
        if nm not in ("heel", "gems"):
            continue
        v, q = S.mesh(F.VOXEL * vs)
        v = v @ M[:3, :3].T + M[:3, 3]
        ob = sdf.to_object(f"est_{nm}", v, q, bpy.context.scene.collection)
        from common import mesh as cmesh
        cmesh.decimate_to(ob, tris)                    # the game mesh is decimated like this (the pipeline's lows)
        ob.data.materials.append(white if role == "accent" else grey)
        if role == "accent":
            acc_names.add(ob.name)
        pb = arm.data.bones["prop.R"]
        mw = ob.matrix_world.copy()
        ob.parent = arm
        ob.parent_type = "BONE"
        ob.parent_bone = "prop.R"
        ob.matrix_world = mw
    arm.data.pose_position = "POSE"
    a_mats = list(body.data.materials)
    body.data.materials.clear()
    body.data.materials.append(grey)
    for o in bpy.data.objects:
        if o.type == "MESH" and o not in (body,) and not o.name.startswith("est_") and o.visible_get():
            o.hide_render = True
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "FLAT"
    sh.color_type = "MATERIAL"
    sh.show_shadows = False
    sh.show_cavity = False
    sc.display.render_aa = "8"
    sc.render.resolution_x = sc.render.resolution_y = 160
    sc.render.film_transparent = False
    sc.world.color = (0.0, 0.0, 0.0)
    sc.view_settings.view_transform = "Standard"
    cam_data = bpy.data.cameras.new("est_cam")
    cam = bpy.data.objects.new("est_cam", cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam_data.sensor_fit = "VERTICAL"
    cam_data.angle_y = 2 * math.atan(math.tan(math.radians(13.0)) * 160 / 1080)
    p = math.radians(52.0)
    tgt = Vector((0, 0, 0.95))
    cam.location = tgt + Vector((0, -math.cos(p) * 28.5, math.sin(p) * 28.5))
    cam.rotation_euler = (tgt - cam.location).to_track_quat("-Z", "Y").to_euler()
    ctx = types.SimpleNamespace(info=types.SimpleNamespace(armature=arm, props=F.PROPORTIONS, joints={}), spec=F,
                                chains={}, skin=None)
    skel = anim.Skeleton(arm)
    clips = anim.standard_clips(skel, F.MOTION, F.clip_overrides(ctx))
    anim.apply_pose(arm, clips[a.clip].sample(0.0))
    from common.hifi import project
    tmp = os.path.join(scene.CACHE_DIR, "_burdam_acc.png")
    acc = body_n = 0
    tiles = []
    for i in range(8):
        arm.rotation_euler = (0, 0, i * math.pi / 4)
        bpy.context.view_layer.update()
        sc.render.filepath = tmp
        bpy.ops.render.render(write_still=True)
        img = (project.load_rgb(tmp)[..., 0] * 255).astype(np.int64)
        body_n += int((img > 40).sum())
        acc += int((img > 200).sum())
        print(f"  facing {i}: accent {int((img > 200).sum())} body {int((img > 40).sum())}")
        tiles.append(img)
    print(f"ACCENT ESTIMATE {100.0 * acc / max(1, body_n):.2f}% ({acc} / {body_n} px over 8 facings)")
    if a.textured:
        from bpy_extras.object_utils import world_to_camera_view
        for o in bpy.data.objects:
            if o.name.startswith("est_") and o.type == "MESH":
                o.data.materials.clear()
                o.data.materials.append(bpy.data.materials["est_white"] if o.name.startswith("est_gems") else grey)
        body.data.materials.clear()
        for m in a_mats:
            body.data.materials.append(m)
        sh.color_type = "TEXTURE"
        sh.light = "STUDIO"
        sc.world.color = (0.6, 0.6, 0.6)
        R = 600
        sc.render.resolution_x = sc.render.resolution_y = R
        cam_data.angle_y = 2 * math.atan(math.tan(math.radians(13.0)) * 230 / 1080)     # a 230 px crop at 1080p
        tgt2 = Vector((0, 0, 1.45))
        cam.location = tgt2 + Vector((0, -math.cos(p) * 28.5, math.sin(p) * 28.5))
        cam.rotation_euler = (tgt2 - cam.location).to_track_quat("-Z", "Y").to_euler()
        bpy.context.view_layer.update()
        tiles = []
        for i in range(8):
            arm.rotation_euler = (0, 0, i * math.pi / 4)
            bpy.context.view_layer.update()
            sc.render.filepath = tmp
            bpy.ops.render.render(write_still=True)
            img = project.load_rgb(tmp)[:R, :R].copy()
            for dx in np.linspace(-0.52, 0.52, 60):          # the HP bar: art.height + 0.35 = 2.51 m, 1.05 m wide
                q = world_to_camera_view(sc, cam, Vector((dx, 0, 2.51)))
                px, py = int(q.x * R), int((1 - q.y) * R)
                if 0 <= px < R and 0 <= py < R:
                    img[max(0, py - 4):py + 4, max(0, px - 3):px + 3] = (0.2, 0.85, 0.4)
            tiles.append(img)
        project.save_rgb(np.concatenate(tiles, axis=1), a.textured)
    if a.save:
        sheet = np.concatenate(tiles, axis=1).astype(np.float32) / 255.0
        project.save_rgb(np.repeat(sheet[..., None], 3, axis=2), a.save)


if __name__ == "__main__":
    main()
