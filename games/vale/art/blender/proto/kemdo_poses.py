"""Kemdo pose preview: chosen clips x 8 frames from the front, her left side and the game camera, rendered
from the build's cached .blend (art/.cache/fighters/kemdo.blend), so poses read without the three.js sheet.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/kemdo_poses.py -- \
        --clips cast_a1,cast_ult [--views front,side,game] [--cell 240] [--out <png>]
"""
from __future__ import annotations

import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from common import anim, scene  # noqa: E402
from common.hifi import project  # noqa: E402


def args():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--clips", default="attack1")
    p.add_argument("--views", default="front,side,game")
    p.add_argument("--cell", type=int, default=240)
    p.add_argument("--samples", type=int, default=8)
    p.add_argument("--out", default=os.path.join(scene.RENDERS_DIR, "fighters", "kemdo", "poses.png"))
    return p.parse_args(scene.script_args())


def main():
    a = args()
    bpy.ops.wm.open_mainfile(filepath=os.path.join(scene.CACHE_DIR, "fighters", "kemdo.blend"))
    sc = bpy.context.scene
    arm = next(o for o in sc.objects if o.type == "ARMATURE")
    for o in sc.objects:
        if o.type == "MESH":
            o.hide_render = not (o.name in ("kemdo", "kemdo_accent") or o.name.startswith("form_"))
        elif o.type in ("LIGHT", "CAMERA"):
            o.hide_render = True
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.color_type = "TEXTURE"
    sh.show_shadows = False
    sh.show_cavity = True
    sc.render.film_transparent = True
    sc.view_settings.view_transform = "Standard"
    w = bpy.data.worlds.new("pw")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
    key = bpy.data.lights.new("pkey", "SUN")
    key.energy = 2.5
    ko = bpy.data.objects.new("pkey", key)
    sc.collection.objects.link(ko)
    ko.rotation_euler = (math.radians(50), 0, math.radians(-35))
    cam = bpy.data.cameras.new("pc")
    co = bpy.data.objects.new("pc", cam)
    sc.collection.objects.link(co)
    sc.camera = co
    sc.render.resolution_x = sc.render.resolution_y = a.cell
    views = {"front": ((0.0, -8.0, 1.1), "O"), "side": ((8.0, 0.0, 1.1), "O"), "back": ((0.0, 8.0, 1.1), "O"),
             "game": ((-3.5, -5.5, 1.0 + 6.5 * math.tan(math.radians(52))), "P"),
             "top": ((0.0, -0.01, 9.0), "O")}
    rows = []
    for clip in a.clips.split(","):
        act = bpy.data.actions[clip]
        f0, f1 = act.frame_range
        n = int(round(f1 - f0))
        ts = [0, 0.12, 0.24, 0.32, 0.4, 0.52, 0.7, 1] if clip.startswith(("attack", "cast")) else [i / 7 for i in range(8)]
        for v in a.views.split(","):
            loc, kind = views[v]
            co.location = loc
            if kind == "O":
                cam.type = "ORTHO"
                cam.ortho_scale = 3.4 if v != "top" else 3.6
            else:
                cam.type = "PERSP"
                cam.lens = 50
            tgt = Vector((0, -0.2, 1.0 if v != "top" else 0.0))
            co.rotation_euler = (tgt - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
            row = []
            for t in ts:
                anim.set_action_frame(arm, clip, f0 + t * n)
                path = os.path.join(scene.CACHE_DIR, "_fit", "pose_cell.png")
                sc.render.filepath = path
                bpy.ops.render.render(write_still=True)
                img = bpy.data.images.load(path)
                px = np.empty(a.cell * a.cell * 4, dtype=np.float32)
                img.pixels.foreach_get(px)
                bpy.data.images.remove(img)
                rgba = px.reshape(a.cell, a.cell, 4)[::-1]
                bg = np.full((a.cell, a.cell, 3), 0.42 if v != "game" else 0.62, dtype=np.float32)
                c = rgba[..., :3] * rgba[..., 3:4] + bg * (1 - rgba[..., 3:4])
                c[:, -1] = 0.2
                c[-1, :] = 0.2
                row.append(c)
            rows.append(np.concatenate(row, axis=1))
            scene.log(f"{clip} {v}: {n} f")
    project.save_rgb(np.clip(np.concatenate(rows, axis=0), 0, 1), a.out)
    scene.log(f"wrote {a.out}")


if __name__ == "__main__":
    main()
