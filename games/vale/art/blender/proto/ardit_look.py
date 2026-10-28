"""Ardit close-up looks on the build's cached .blend (no rebuild): a grid of camera views of the bound, painted
mesh, optionally posed in a clip, rendered as pure albedo (workbench, flat), workbench studio light, or a short
Cycles render with the real materials (normal map included).

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/ardit_look.py -- \
        --views "yaw,pitch,dist,tx,ty,tz[,clip,t]; ..." [--mode tex|lit|cyc] [--cell 400] [--cols 4] [--out <png>]

yaw 0 = in front (-Y), + = toward his left (render.orbit). The target is (tx, ty, tz) in metres.
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
from common import anim, render, scene  # noqa: E402
from common.hifi import project  # noqa: E402


def args():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--views", required=True)
    p.add_argument("--mode", default="tex")
    p.add_argument("--cell", type=int, default=400)
    p.add_argument("--cols", type=int, default=4)
    p.add_argument("--lens", type=float, default=50.0)
    p.add_argument("--clips", action="store_true", help="re-sample the CURRENT clip code onto the cached rig")
    p.add_argument("--out", default=os.path.join(scene.CACHE_DIR, "_fit", "ardit_look.png"))
    return p.parse_args(scene.script_args())


def main():
    a = args()
    bpy.ops.wm.open_mainfile(filepath=os.path.join(scene.CACHE_DIR, "fighters", "ardit.blend"))
    sc = bpy.context.scene
    arm = next(o for o in sc.objects if o.type == "ARMATURE")
    views = [v.strip().split(",") for v in a.views.split(";") if v.strip()]
    if a.clips and any(len(v) > 6 for v in views):
        import importlib.util
        from types import SimpleNamespace
        spec = importlib.util.spec_from_file_location("ardit_spec", os.path.join(os.path.dirname(HERE), "fighters", "ardit.py"))
        K = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(K)
        want = {v[6] for v in views if len(v) > 6}
        clips = {k: c for k, c in K.clip_overrides(SimpleNamespace(info=SimpleNamespace(armature=arm), chains={})).items()
                 if k in want}
        anim.write_clips(arm, clips, [])
    for o in sc.objects:
        if o.type == "MESH":
            o.hide_render = not (o.parent == arm or o.name.startswith(("ardit", "form_")))
            if o.name.startswith("vale_ground") or "plate" in o.name:
                o.hide_render = True
        elif o.type == "LIGHT":
            o.hide_render = a.mode != "cyc"
    sc.render.film_transparent = True
    sc.view_settings.view_transform = "Standard"
    if a.mode in ("tex", "lit"):
        sc.render.engine = "BLENDER_WORKBENCH"
        sh = sc.display.shading
        sh.light = "FLAT" if a.mode == "tex" else "STUDIO"
        sh.color_type = "TEXTURE"
        sh.show_shadows = False
        sh.show_cavity = False
        sh.show_specular_highlight = a.mode == "lit"
    else:
        if a.mode == "nrm":                       # the real normal map on a neutral grey (no albedo)
            for m in bpy.data.materials:
                if not m.use_nodes:
                    continue
                for nd in m.node_tree.nodes:
                    if nd.type == "BSDF_PRINCIPLED":
                        for lk in list(nd.inputs["Base Color"].links):
                            m.node_tree.links.remove(lk)
                        nd.inputs["Base Color"].default_value = (0.5, 0.5, 0.5, 1)
        render.setup(a.cell, a.cell, 24, view="Khronos PBR Neutral")
        light = render.map_lighting("map_rift")
        render.sky_world(light["sky"], light["ambient"], camera_strength=1.0)
        sun = bpy.data.lights.get("look_sun") or bpy.data.lights.new("look_sun", "SUN")
        sun.energy = 1.6
        so = bpy.data.objects.get("look_sun") or bpy.data.objects.new("look_sun", sun)
        if so.name not in sc.collection.objects:
            sc.collection.objects.link(so)
        so.rotation_euler = (math.radians(45), 0, math.radians(-150))
    sc.render.resolution_x = sc.render.resolution_y = a.cell
    cam = render.camera("look_cam", lens=a.lens)
    cells = []
    for v in views:
        yaw, pitch, dist, tx, ty, tz = (float(x) for x in v[:6])
        if len(v) > 6:
            act = bpy.data.actions[v[6]]
            f0, f1 = act.frame_range
            anim.set_action_frame(arm, v[6], f0 + float(v[7]) * (f1 - f0))
        else:
            ad = arm.animation_data
            if ad is not None:
                ad.action = None
            for pb in arm.pose.bones:
                pb.location = (0, 0, 0)
                pb.rotation_quaternion = (1, 0, 0, 0)
                pb.rotation_euler = (0, 0, 0)
            bpy.context.view_layer.update()
        tgt = Vector((tx, ty, tz))
        render.look_at(cam, tgt, render.orbit(tgt, dist, yaw, pitch))
        path = os.path.join(scene.CACHE_DIR, "_fit", "look_cell.png")
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path)
        px = np.empty(a.cell * a.cell * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        bpy.data.images.remove(img)
        rgba = px.reshape(a.cell, a.cell, 4)[::-1]
        bg = np.full((a.cell, a.cell, 3), 0.25, dtype=np.float32)
        c = rgba[..., :3] * rgba[..., 3:4] + bg * (1 - rgba[..., 3:4])
        c[:, -1] = 0.1
        c[-1, :] = 0.1
        cells.append(c)
    while len(cells) % a.cols:
        cells.append(np.full_like(cells[0], 0.25))
    rows = [np.concatenate(cells[i:i + a.cols], axis=1) for i in range(0, len(cells), a.cols)]
    project.save_rgb(np.clip(np.concatenate(rows, axis=0), 0, 1), a.out)
    print(f"wrote {a.out}")


if __name__ == "__main__":
    main()
