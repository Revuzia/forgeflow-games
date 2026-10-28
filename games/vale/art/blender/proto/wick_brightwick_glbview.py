"""brightwick GLB close-up check: imports a BUILT brightwick GLB (baked base colour, normal, ORM, the accent and its
vertex-alpha halo / core) and renders it in EEVEE under the Rift sky + a sun, the accent tinted per viewer like the
game (base 0.3 x tint, emission tint x 0.8, the BLEND accent copies weighted by their COLOR_0 alpha):
  eye level   body front / 3-4 / back, head front / 3-4 (camera pitch 2 deg)
  52 deg      head close at facings 0 / 35 / -35 (the gameplay pitch, magnified)
  game        the gameplay camera at TRUE 1080p pixel scale (82.1 px/m across), facings 0 / 45 / 90 / 180, then x4
Every frame is posed in the GLB's `idle` clip at `--t` (0..1).

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/wick_brightwick_glbview.py \
        -- --glb art/out/units/brightwick_serenade.glb --out DIR [--tint ally|enemy] [--t 0.3] [--views eye,52,game]

Writes DIR/<id>_<view>.png (one image per view).
"""
from __future__ import annotations

import argparse
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

from common import heavy, scene  # noqa: E402

TINT = {"ally": "#3F9CFF", "enemy": "#FF9A1F"}
SKY = os.path.join(scene.ART_DIR, "out", "maps", "map_rift", "sky.hdr")


def lin(h):
    return [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in scene.hex_srgb(h)]


def args():
    p = argparse.ArgumentParser()
    p.add_argument("--glb", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--tint", default="ally")
    p.add_argument("--t", type=float, default=0.3)
    p.add_argument("--clip", default="idle")
    p.add_argument("--views", default="eye,52,game")
    p.add_argument("--tag", default="")
    return p.parse_args(scene.script_args())


def setup_world():
    scn = bpy.context.scene
    try:
        scn.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scn.render.engine = "BLENDER_EEVEE"
    # three's NeutralToneMapping (the game) ~ Khronos PBR Neutral
    for vt in ("Khronos PBR Neutral", "Standard"):
        try:
            scn.view_settings.view_transform = vt
            break
        except TypeError:
            continue
    w = bpy.data.worlds.new("sky")
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes["Background"]
    if os.path.exists(SKY):
        env = nt.nodes.new("ShaderNodeTexEnvironment")
        env.image = bpy.data.images.load(SKY)
        nt.links.new(env.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 1.0
    scn.world = w
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 2.6
    sun.data.color = lin("#FFF1DC")
    sun.data.angle = math.radians(2.0)
    # three's sun at (-6, 12, 7) (Y up, +Z toward the camera) -> Blender (-6, -7, 12)
    d = Vector((-6.0, -7.0, 12.0)).normalized()
    sun.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    scn.collection.objects.link(sun)
    g = bpy.data.meshes.new("ground")
    g.from_pydata([(-6, -6, 0), (6, -6, 0), (6, 6, 0), (-6, 6, 0)], [], [(0, 1, 2, 3)])
    go = bpy.data.objects.new("ground", g)
    m = bpy.data.materials.new("ground")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*lin("#CFC6B2"), 1.0)
    b.inputs["Roughness"].default_value = 0.95
    go.data.materials.append(m)
    scn.collection.objects.link(go)


def tint_accent(tint):
    t = lin(TINT.get(tint, tint))
    for ob in bpy.data.objects:
        if ob.type != "MESH":
            continue
        for slot in ob.material_slots:
            m = slot.material
            if m is None or not m.name.startswith("accent"):
                continue
            nt = m.node_tree
            b = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if b is None:
                continue
            for ln in list(b.inputs["Base Color"].links) + list(b.inputs["Emission Color"].links):
                nt.links.remove(ln)
            b.inputs["Base Color"].default_value = (t[0] * 0.3, t[1] * 0.3, t[2] * 0.3, 1.0)
            b.inputs["Emission Color"].default_value = (*t, 1.0)
            b.inputs["Emission Strength"].default_value = 0.8
            ca = ob.data.color_attributes
            if len(ca):     # (the merged prims without COLOR_0 import as white, alpha 1: wiring every copy is safe)
                # the BLEND copies (halo, core): alpha = COLOR_0 alpha, emission x alpha, RGB x COLOR_0 RGB
                at = nt.nodes.new("ShaderNodeAttribute")
                at.attribute_name = ca[0].name
                for ln in list(b.inputs["Alpha"].links):
                    nt.links.remove(ln)
                nt.links.new(at.outputs["Alpha"], b.inputs["Alpha"])
                try:
                    m.surface_render_method = "BLENDED"
                except (AttributeError, TypeError):
                    pass
                try:
                    m.blend_method = "BLEND"
                except (AttributeError, TypeError):
                    pass


def pose(arm, clip, t):
    act = bpy.data.actions.get(clip)
    if act is None:
        act = next((a for a in bpy.data.actions if a.name.startswith(clip)), None)
    if arm is None or act is None:
        return
    arm.animation_data_create()
    arm.animation_data.action = act
    if hasattr(arm.animation_data, "action_slot") and len(getattr(act, "slots", [])):
        arm.animation_data.action_slot = act.slots[0]
    f0, f1 = act.frame_range
    bpy.context.scene.frame_set(int(round(f0 + t * (f1 - f0))))


def camera(name, loc, target, lens=None, ortho=None):
    c = bpy.data.cameras.new(name)
    if ortho:
        c.type = "ORTHO"
        c.ortho_scale = ortho
    else:
        c.sensor_fit = "VERTICAL"
        c.lens = lens or 50.0
    o = bpy.data.objects.new(name, c)
    bpy.context.scene.collection.objects.link(o)
    o.location = Vector(loc)
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return o


def lens_for(fov_deg):
    return 24.0 / (2.0 * math.tan(math.radians(fov_deg) / 2.0))     # sensor 24 mm vertical


def main():
    a = args()
    heavy.hold("blender:brightwick_glbview")
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    setup_world()
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(a.glb))
    tint_accent(a.tint)
    arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    root = arm if arm is not None else next(o for o in bpy.data.objects if o.type == "MESH")
    pose(arm, a.clip, a.t)
    gid = os.path.splitext(os.path.basename(a.glb))[0] + (f"_{a.tag}" if a.tag else "")
    os.makedirs(a.out, exist_ok=True)
    scn = bpy.context.scene
    views = set(a.views.split(","))
    shots = []
    if "eye" in views:
        for nm, yaw in (("body_front", 0), ("body_q34", 35), ("body_back", 180)):
            shots.append((nm, yaw, (0.0, -11.0, 0.88 + 11 * math.sin(math.radians(5))), (0.0, 0.0, 0.88), lens_for(11.0), None, (900, 1000)))
        for nm, yaw in (("head_front", 0), ("head_q34", 35), ("head_q34r", -35)):
            shots.append((nm, yaw, (0.0, -11.0, 1.44 + 11 * math.sin(math.radians(2))), (0.0, 0.0, 1.44), lens_for(3.0), None, (800, 800)))
    if "arm" in views:
        # the forearm wraps and the mitts, eye level, close
        for nm, yaw in (("arm_front", 0), ("arm_q34", 35), ("arm_q34r", -40)):
            shots.append((nm, yaw, (0.0, -11.0, 0.95 + 11 * math.sin(math.radians(4))), (0.0, 0.0, 0.95), lens_for(4.2), None, (900, 800)))
    if "52" in views:
        p = math.radians(52)
        for nm, yaw in (("h52_front", 0), ("h52_q34", 35), ("h52_q34r", -35)):
            shots.append((nm, yaw, (0.0, -11.0 * math.cos(p), 1.38 + 11.0 * math.sin(p)), (0.0, 0.0, 1.38), lens_for(3.0), None, (800, 800)))
        for nm, yaw in (("b52_front", 0), ("b52_q34", 40)):
            shots.append((nm, yaw, (0.0, -11.0 * math.cos(p), 0.85 + 11.0 * math.sin(p)), (0.0, 0.0, 0.85), lens_for(10.5), None, (900, 900)))
    if "game" in views:
        p = math.radians(52)
        for yaw in (0, 45, 90, 180, 270):
            # true 1080p scale: 82.1 px/m across; a 180 px tile = 180 / 82.1 m
            shots.append((f"game_{yaw:03d}", yaw, (0.0, -28.5 * math.cos(p), 0.85 + 28.5 * math.sin(p)), (0.0, 0.0, 0.85), None,
                          180 / 82.1, (180, 180)))
    for nm, yaw, loc, tgt, lens, ortho, res in shots:
        root.rotation_euler = (root.rotation_euler[0], root.rotation_euler[1], 0.0)
        root.rotation_mode = "XYZ"
        # glTF import: the armature carries Y-up -> Z-up already; turn the figure about world Z
        root.rotation_euler[2] = math.radians(yaw)
        bpy.context.view_layer.update()
        cam = camera(f"cam_{nm}", loc, tgt, lens=lens, ortho=ortho)
        scn.camera = cam
        scn.render.resolution_x, scn.render.resolution_y = res
        scn.render.resolution_percentage = 100
        path = os.path.join(a.out, f"{gid}_{nm}.png")
        scn.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print("GLBVIEW", path)


if __name__ == "__main__":
    main()
