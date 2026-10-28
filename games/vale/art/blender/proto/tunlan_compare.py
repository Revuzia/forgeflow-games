"""Tunlan side-by-side (the marund_v2.py proof's views on the built fighter): the cached build
(art/.cache/fighters/tunlan.blend, written by `art/build.py fighter tunlan`) at idle frame 0 (fix pass 1; was the rest pose), orthographic front and
back at the concept's scale, a three-quarter and the 52 degree game camera, rendered with the game material.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/tunlan_compare.py -- [--res 900]

Writes art/renders/fighters/tunlan/_fit/compare_{front,back,threeq,game}.png; the concept crop sits next to them in
compare.png when Pillow is importable (the repo venv: run art/blender/proto/tunlan_fit.py --compare).
"""
from __future__ import annotations

import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from common import scene  # noqa: E402

OUT = os.path.join(scene.RENDERS_DIR, "fighters", "tunlan", "_fit")


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
    ap.add_argument("--clip", default="")
    ap.add_argument("--frame", type=int, default=0)
    a = ap.parse_args(scene.script_args())
    bpy.ops.wm.open_mainfile(filepath=os.path.join(scene.CACHE_DIR, "fighters", "tunlan.blend"))
    sc = bpy.context.scene
    for o in sc.objects:
        if o.type == "ARMATURE":
            # the bind pose is the concept's pose (arms hanging as painted): compare at rest, or at a clip frame
            if a.clip:
                o.data.pose_position = "POSE"
                act = bpy.data.actions.get(a.clip)
                o.animation_data_create()
                o.animation_data.action = act
                if getattr(act, "slots", None) and len(act.slots):
                    o.animation_data.action_slot = act.slots[0]
                sc.frame_set(a.frame)
            else:
                o.data.pose_position = "REST"
        if o.type == "MESH":
            o.hide_render = o.name not in ("tunlan", "tunlan_accent")
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
            cam.ortho_scale = 2.30
            cam.sensor_fit = "VERTICAL"
            y = -6.0 if kind == "front" else 6.0
            co.location = (0, y, 1.06)
            co.rotation_euler = (math.radians(90), 0, 0 if kind == "front" else math.radians(180))
            sc.render.resolution_x, sc.render.resolution_y = int(a.res * 0.75), a.res
        elif kind in ("threeq", "threeq_l"):
            cam.lens = 70
            p = (-3.4 if kind == "threeq" else 3.4, -6.2, 2.4)
            co.location = p
            look(co, p, (0, 0, 1.15))
            sc.render.resolution_x, sc.render.resolution_y = int(a.res * 0.75), a.res
        elif kind in ("head_l", "head_r"):           # the mask, hood and hat close-up
            cam.lens = 120
            p = (1.75 if kind == "head_l" else -1.75, -4.1, 1.95)
            co.location = p
            look(co, p, (0.0, -0.10, 1.70))
            sc.render.resolution_x, sc.render.resolution_y = a.res, a.res
        elif kind == "rod":                          # the crook's hook and the lantern
            cam.lens = 85
            p = (-1.6, -4.4, 1.0)
            co.location = p
            look(co, p, (-0.50, -0.25, 1.55))
            sc.render.resolution_x, sc.render.resolution_y = int(a.res * 0.5), a.res
        else:
            cam.lens = 150
            p = (0.0, -7.5, 1.15 + 7.5 * math.tan(math.radians(52)))
            co.location = p
            look(co, p, (0, 0, 1.15))
            sc.render.resolution_x, sc.render.resolution_y = int(a.res * 0.75), a.res
        sc.render.filepath = os.path.join(OUT, f"compare_{kind}{'_albedo' if a.albedo else ''}.png")
        bpy.ops.render.render(write_still=True)
        scene.log(f"rendered {kind}")


if __name__ == "__main__":
    main()
