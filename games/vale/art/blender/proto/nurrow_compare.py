"""Nurrow side-by-side (the marund_v2.py proof's views on the built fighter): the cached build
(art/.cache/fighters/nurrow.blend, written by `art/build.py fighter nurrow`) at its rest pose, orthographic front and
back at the concept's scale, a three-quarter and the 52 degree game camera, rendered with the game material.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/nurrow_compare.py -- [--res 900]

Writes art/renders/fighters/nurrow/_fit/compare_{front,back,threeq,game}.png; the concept crop sits next to them in
compare.png when Pillow is importable (the repo venv: run art/blender/proto/nurrow_fit.py --compare).
"""
from __future__ import annotations

import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from common import scene  # noqa: E402

OUT = os.path.join(scene.RENDERS_DIR, "fighters", "nurrow", "_fit")


def look(obj, p, t):
    from mathutils import Vector
    d = Vector(t) - Vector(p)
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--res", type=int, default=900)
    ap.add_argument("--views", default="front,back,threeq,game")
    ap.add_argument("--albedo", action="store_true", help="flat base colour (emission), suffix _albedo")
    ap.add_argument("--clip", default="", help="pose the rig at this clip's --frame instead of the rest pose")
    ap.add_argument("--frame", type=float, default=0.0)
    a = ap.parse_args(scene.script_args())
    bpy.ops.wm.open_mainfile(filepath=os.path.join(scene.CACHE_DIR, "fighters", "nurrow.blend"))
    sc = bpy.context.scene
    for o in sc.objects:
        if o.type == "ARMATURE":
            if a.clip:
                from common import anim
                o.data.pose_position = "POSE"
                anim.set_action_frame(o, a.clip, a.frame)
            else:
                o.data.pose_position = "REST"
        if o.type == "MESH":
            o.hide_render = o.name not in ("nurrow", "nurrow_accent")
        if o.type in ("LIGHT", "CAMERA"):
            o.hide_render = True
    for m in bpy.data.materials:           # the baked material's alpha shows texel padding as glass in EEVEE
        if m.use_nodes:
            for nd in m.node_tree.nodes:
                if nd.type == "BSDF_PRINCIPLED":
                    for l in list(nd.inputs["Alpha"].links):
                        m.node_tree.links.remove(l)
                    nd.inputs["Alpha"].default_value = 1.0
    if a.albedo:                           # the painted base colour only (no lighting): paint QA
        for m in bpy.data.materials:
            if not m.use_nodes:
                continue
            nt = m.node_tree
            bs = next((nd for nd in nt.nodes if nd.type == "BSDF_PRINCIPLED"), None)
            out = next((nd for nd in nt.nodes if nd.type == "OUTPUT_MATERIAL"), None)
            if bs is None or out is None:
                continue
            src = bs.inputs["Base Color"].links[0].from_socket if bs.inputs["Base Color"].links else None
            em = nt.nodes.new("ShaderNodeEmission")
            if src is not None:
                nt.links.new(src, em.inputs["Color"])
            else:
                em.inputs["Color"].default_value = bs.inputs["Base Color"].default_value
            nt.links.new(em.outputs[0], out.inputs["Surface"])
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "Standard"
    w = bpy.data.worlds.new("cmp")
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.62, 0.62, 0.64, 1)
    bg.inputs["Strength"].default_value = 0.9
    key = bpy.data.lights.new("cmp_key", "SUN")
    key.energy = 2.6
    ko = bpy.data.objects.new("cmp_key", key)
    sc.collection.objects.link(ko)
    ko.rotation_euler = (math.radians(45), 0, math.radians(-30))
    os.makedirs(OUT, exist_ok=True)
    for kind in a.views.split(","):
        cam = bpy.data.cameras.new(kind)
        co = bpy.data.objects.new(kind, cam)
        sc.collection.objects.link(co)
        sc.camera = co
        if kind in ("front", "back"):
            cam.type = "ORTHO"
            cam.ortho_scale = 2.10
            cam.sensor_fit = "VERTICAL"
            y = -6.0 if kind == "front" else 6.0
            co.location = (0, y, 1.0)
            co.rotation_euler = (math.radians(90), 0, 0 if kind == "front" else math.radians(180))
            sc.render.resolution_x, sc.render.resolution_y = int(a.res * 0.75), a.res
        elif kind in ("side", "rside"):
            cam.type = "ORTHO"
            cam.ortho_scale = 2.10
            cam.sensor_fit = "VERTICAL"
            x = 6.0 if kind == "side" else -6.0
            co.location = (x, 0, 1.0)
            co.rotation_euler = (math.radians(90), 0, math.radians(90 if kind == "side" else -90))
            sc.render.resolution_x, sc.render.resolution_y = int(a.res * 0.75), a.res
        elif kind == "top":
            cam.type = "ORTHO"
            cam.ortho_scale = 1.3
            co.location = (0, 0, 6.0)
            co.rotation_euler = (0, 0, 0)
            sc.render.resolution_x, sc.render.resolution_y = a.res, a.res
        elif kind in ("face", "handl", "handr", "hatq"):
            cam.lens = 85
            tgt, pos = {"face": ((0.01, -0.10, 1.58), (-0.45, -1.35, 1.62)),
                        "handl": ((0.47, -0.08, 0.92), (0.95, -0.95, 1.05)),
                        "handr": ((-0.40, -0.12, 0.93), (-0.85, -1.05, 1.15)),
                        "hatq": ((0.0, 0.0, 1.75), (-1.0, -1.6, 2.6))}[kind]
            co.location = pos
            look(co, pos, tgt)
            sc.render.resolution_x, sc.render.resolution_y = a.res, a.res
        elif kind == "threeq":
            cam.lens = 70
            p = (-3.4, -6.2, 2.4)
            co.location = p
            look(co, p, (0, 0, 1.0))
            sc.render.resolution_x, sc.render.resolution_y = int(a.res * 0.75), a.res
        else:
            cam.lens = 150
            p = (0.0, -7.5, 1.0 + 7.5 * math.tan(math.radians(52)))
            co.location = p
            look(co, p, (0, 0, 1.0))
            sc.render.resolution_x, sc.render.resolution_y = int(a.res * 0.75), a.res
        tag = f"_{a.clip}{int(a.frame)}" if a.clip else ""
        sc.render.filepath = os.path.join(OUT, f"compare_{kind}{tag}{'_albedo' if a.albedo else ''}.png")
        bpy.ops.render.render(write_still=True)
        scene.log(f"rendered {kind}")


if __name__ == "__main__":
    main()
