"""Clip look-and-fix for Ervet without a rebuild: re-generates the clips from fighters/ervet.py (MOTION, BLOCKS,
clip_overrides, chain_config) on the cached build (art/.cache/fighters/ervet.blend) and renders a contact sheet
(Workbench, painted texture) from the game camera's pitch.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/ervet_poses.py -- \
        [--clips idle,run,cast_a1] [--frames 8] [--yaw 25] [--form base|hilt|great] [--side]

Writes art/renders/fighters/ervet/_fit/poses.png (rows = clips in the order given, columns = evenly spaced frames,
the impact frame included for strikes) and prints the row order.
"""
from __future__ import annotations

import importlib.util
import math
import os
import sys
import types

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from common import anim, rig, scene  # noqa: E402
from common.hifi import project  # noqa: E402

spec_path = os.path.join(os.path.dirname(HERE), "fighters", "ervet.py")
OUT = os.path.join(scene.RENDERS_DIR, "fighters", "ervet", "_fit")


def args():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--clips", default="idle,run,attack1,attack2,cast_a1,cast_a2,cast_a3,cast_ult,death,recall,idle_lobby,victory,dash,stunned")
    p.add_argument("--frames", type=int, default=8)
    p.add_argument("--yaw", type=float, default=20.0)
    p.add_argument("--pitch", type=float, default=52.0)
    p.add_argument("--cell", type=int, default=220)
    p.add_argument("--form", default="base")
    p.add_argument("--side", action="store_true", help="side camera (yaw 90) instead")
    p.add_argument("--out", default="poses.png")
    p.add_argument("--yaws", default="", help="turntable mode: comma list of yaws, one column each (clip frame --t)")
    p.add_argument("--t", type=float, default=0.0)
    p.add_argument("--flat", action="store_true", help="flat lighting: the painted albedo as is")
    p.add_argument("--scale", type=float, default=2.9, help="ortho scale (m)")
    p.add_argument("--target", type=float, default=0.95, help="camera target height (m)")
    return p.parse_args(scene.script_args())


def main():
    a = args()
    bpy.ops.wm.open_mainfile(filepath=os.path.join(scene.CACHE_DIR, "fighters", "ervet.blend"))
    _s = importlib.util.spec_from_file_location("ervet_spec", spec_path)
    E = importlib.util.module_from_spec(_s)
    _s.loader.exec_module(E)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    chains = {}
    for b in arm.data.bones:
        if b.name.startswith("x_") and b.name[-1].isdigit() and "_" in b.name[2:]:
            nm = b.name[2:].rsplit("_", 1)[0]
            chains.setdefault(nm, []).append(b.name)
    J = rig._layout(rig.proportions(**E.PROPORTIONS))
    ctx = types.SimpleNamespace(spec=E, info=types.SimpleNamespace(armature=arm, joints=J), chains=chains, skin=None)
    skel = anim.Skeleton(arm)
    clips = anim.standard_clips(skel, E.MOTION, E.clip_overrides(ctx))
    cfgs = E.chain_config(ctx)
    for o in bpy.data.objects:
        if o.type == "MESH":
            skinned = any(m.type == "ARMATURE" for m in o.modifiers) and o.parent is arm
            show = skinned and (not o.name.startswith("form_") or o.name == f"form_{a.form}")
            o.hide_render = not show
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "FLAT" if a.flat else "STUDIO"
    sh.color_type = "TEXTURE"
    sh.show_shadows = True
    sh.show_cavity = False
    sc.render.film_transparent = False
    sc.render.resolution_x = sc.render.resolution_y = a.cell
    sc.render.resolution_percentage = 100
    sc.world = sc.world or bpy.data.worlds.new("w")
    sc.world.color = (0.62, 0.63, 0.66)
    sh.background_type = "WORLD"
    try:
        sc.view_settings.view_transform = "Standard"
    except Exception:
        pass
    cam = bpy.data.objects.get("_pose_cam") or bpy.data.objects.new("_pose_cam", bpy.data.cameras.new("_pose_cam"))
    if cam.name not in sc.collection.objects:
        sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = a.scale
    from mathutils import Vector

    def aim_cam(yaw_deg, pitch_deg):
        yaw, pitch = math.radians(yaw_deg), math.radians(pitch_deg)
        tgt = np.array([0.0, 0.0, a.target])
        d = np.array([math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch)])
        cam.location = Vector(tuple(tgt + d * 8.0))
        cam.rotation_euler = (Vector(tuple(tgt)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    aim_cam(90.0 if a.side else a.yaw, 5.0 if a.side else a.pitch)
    names = [c for c in a.clips.split(",") if c in clips]
    _apply = anim.apply_pose

    def apply_pose(arm_, pose):                       # + the dropped sword's prop.R location (death)
        _apply(arm_, pose)
        if "prop.R_loc" in pose:
            arm_.pose.bones["prop.R"].location = pose["prop.R_loc"]
            bpy.context.view_layer.update()
    anim.apply_pose = apply_pose
    rows = []
    tmp = os.path.join(OUT, "_pose_tmp.png")
    os.makedirs(OUT, exist_ok=True)
    if a.yaws:
        for name in names:
            c = clips[name]
            poses = anim.sample_clip(skel, c, cfgs)
            anim.apply_pose(arm, poses[int(round(a.t * (len(poses) - 1)))])
            cells = []
            for yv in [float(v) for v in a.yaws.split(",")]:
                aim_cam(yv, a.pitch)
                sc.render.filepath = tmp
                bpy.ops.render.render(write_still=True)
                cells.append(project.load_rgb(tmp))
            rows.append(np.concatenate(cells, axis=1))
        project.save_rgb(np.concatenate(rows, axis=0), os.path.join(OUT, a.out))
        os.remove(tmp)
        print("[poses] turntable rows:", ", ".join(names))
        return
    for name in names:
        c = clips[name]
        poses = anim.sample_clip(skel, c, cfgs)
        n = len(poses) - 1
        fr = sorted(set([int(round(n * i / (a.frames - 1))) for i in range(a.frames)]))
        if c.impact is not None:
            imp = int(round(c.impact * c.frames))
            fr = sorted(set(fr[:-1]) | {imp, n})[: a.frames + 1]
        cells = []
        for f in fr:
            anim.apply_pose(arm, poses[f])
            sc.render.filepath = tmp
            bpy.ops.render.render(write_still=True)
            img = project.load_rgb(tmp)
            if c.impact is not None and f == int(round(c.impact * c.frames)):
                img[:4, :] = (1.0, 0.3, 0.2)
            cells.append(img)
        while len(cells) < a.frames + 1:
            cells.append(np.ones_like(cells[0]) * 0.2)
        rows.append(np.concatenate(cells, axis=1))
        print(f"[poses] {name}: {c.frames} f, impact {c.impact}, frames {fr}")
    sheet = np.concatenate(rows, axis=0)
    project.save_rgb(sheet, os.path.join(OUT, a.out))
    os.remove(tmp)
    print("[poses] rows:", ", ".join(names))


main()
