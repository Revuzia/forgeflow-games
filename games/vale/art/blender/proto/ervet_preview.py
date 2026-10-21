"""Quick geometry preview for Ervet (no bake, no rig motion): every part of fighters/ervet.py meshed as in the build
(SDF parts at their voxel, the parametric lames, blades and face glass) in flat role colours, rendered with
Workbench from the front, the back, a 3/4 view, the side, the game camera's pitch, plus head and chest close-ups.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/ervet_preview.py \
        -- [--voxel-scale 1.0] [--out preview_geo.png]

Writes art/renders/fighters/ervet/_fit/<out>.
"""
from __future__ import annotations

import importlib.util
import math
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from common import rig, scene  # noqa: E402
from common.hifi import project, sdf  # noqa: E402

spec_path = os.path.join(os.path.dirname(HERE), "fighters", "ervet.py")
_s = importlib.util.spec_from_file_location("ervet_spec", spec_path)
E = importlib.util.module_from_spec(_s)
_s.loader.exec_module(E)
OUT = os.path.join(scene.RENDERS_DIR, "fighters", "ervet", "_fit")

ROLE_RGB = {"chalk": "#D9D7CF", "stone": "#A9AFB3", "cloth": "#56677A", "cloth2": "#D4CFC0", "under": "#3A3D42",
            "leather": "#4A3A30", "ironstone": "#3E444C", "dawnglass": "#B8D4E8", "accent": "#3F9CFF",
            "ink": "#17181B", "wood": "#7A5E46", "lampresin": "#BF8F52"}


def args():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--voxel-scale", type=float, default=1.0)
    p.add_argument("--out", default="preview_geo.png")
    p.add_argument("--cell", type=int, default=520)
    return p.parse_args(scene.script_args())


def mat(role):
    m = bpy.data.materials.get("pv_" + role) or bpy.data.materials.new("pv_" + role)
    r, g, b = scene.hex_srgb(ROLE_RGB.get(role, "#FF00FF"))
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in (r, g, b)]
    m.diffuse_color = (*lin, 1.0)
    return m


def main():
    a = args()
    os.makedirs(OUT, exist_ok=True)
    scene.reset()
    info = rig.build_rig(E.PROPORTIONS, name="pv_rig")
    J = info.joints
    col = bpy.context.scene.collection
    for name, S, vs, role, bind, tris, form in E.sculpts(J):
        if form not in (None, "base"):
            continue
        if name in ("lames_R", "lames_L"):
            ob = E.lames_low(f"{name}_low", -1 if name.endswith("R") else 1, col)
        elif name in E.BLADE_LOWS:
            Lb, shape, cut = E.BLADE_LOWS[name]
            ob = E.blade_low(f"{name}_low", Lb, shape, E.BEVEL[name], cut, col)
        else:
            v, q = S.mesh(E.VOXEL * vs * a.voxel_scale)
            ob = sdf.to_object(name, v, q, col)
        ob.data.materials.append(mat(role))
    vz = E.visor_low("visor_low", col)
    vz.data.materials.append(mat("accent"))
    for o in bpy.data.objects:
        if o.type == "MESH":
            for p in o.data.polygons:
                p.use_smooth = True
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.color_type = "MATERIAL"
    sh.show_shadows = False
    sh.show_cavity = True
    sh.cavity_type = "BOTH"
    sc.render.resolution_x = sc.render.resolution_y = a.cell
    sc.world = sc.world or bpy.data.worlds.new("w")
    sc.world.color = (0.62, 0.63, 0.66)
    sh.background_type = "WORLD"
    try:
        sc.view_settings.view_transform = "Standard"
    except Exception:
        pass
    if info.armature:
        info.armature.hide_render = True
    cam = bpy.data.objects.new("_pv_cam", bpy.data.cameras.new("_pv_cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.type = "ORTHO"
    from mathutils import Vector
    views = [("front", 0, 3, 2.35, 1.08), ("back", 180, 3, 2.35, 1.08), ("3q", 30, 8, 2.35, 1.08),
             ("side", 90, 3, 2.35, 1.08), ("game", 200, 52, 2.6, 1.0), ("head", 0, 2, 0.42, 1.95),
             ("head3q", 32, 6, 0.42, 1.95), ("chest", 18, 8, 0.95, 1.62)]
    cells = []
    tmp = os.path.join(OUT, "_pv_tmp.png")
    for nm, yaw, pitch, scale, tz in views:
        y, p = math.radians(yaw), math.radians(pitch)
        tgt = np.array([0.0, 0.0, tz])
        d = np.array([math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)])
        cam.location = Vector(tuple(tgt + d * 8.0))
        cam.rotation_euler = (Vector(tuple(tgt)) - cam.location).to_track_quat("-Z", "Y").to_euler()
        cam.data.ortho_scale = scale
        sc.render.filepath = tmp
        bpy.ops.render.render(write_still=True)
        cells.append(project.load_rgb(tmp))
    rows = [np.concatenate(cells[:4], axis=1), np.concatenate(cells[4:], axis=1)]
    project.save_rgb(np.concatenate(rows, axis=0), os.path.join(OUT, a.out))
    os.remove(tmp)
    print("[preview] wrote", os.path.join(OUT, a.out))


main()
