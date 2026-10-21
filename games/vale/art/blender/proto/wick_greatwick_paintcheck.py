"""greatwick paint check: the built game mesh (the build's cached .blend) in the rest pose, UNLIT base colour only
(Workbench, flat light, texture colour), next to the concept sheet, from the front, the back, the wick's left side and
the 52-degree game camera. Shows where the projection smeared or patched, without the three.js lighting on top.

    /Applications/Blender.app/Contents/MacOS/Blender -b art/.cache/fighters/greatwick_<faction>.blend \
        --python art/blender/proto/wick_greatwick_paintcheck.py -- --faction aubade

Writes art/renders/units/paint_greatwick_<faction>.png.
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
from common import scene  # noqa: E402


def main():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    fac = a[a.index("--faction") + 1] if "--faction" in a else "aubade"
    sc = bpy.context.scene
    for o in bpy.data.objects:
        if o.type == "ARMATURE":
            o.data.pose_position = "REST"
        if o.type == "MESH":
            o.hide_render = not o.name.startswith(f"greatwick_{fac}")
    acc = bpy.data.materials.get("accent")
    if acc is not None and acc.use_nodes:
        b = acc.node_tree.nodes.get("Principled BSDF")
        if b is not None:
            b.inputs["Base Color"].default_value = (0.25, 0.61, 1.0, 1.0)
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "FLAT"
    sh.color_type = "TEXTURE"
    sc.view_settings.view_transform = "Standard"
    sc.render.film_transparent = True
    sc.render.resolution_x, sc.render.resolution_y = 640, 760
    cam_d = bpy.data.cameras.new("pc_cam")
    cam_d.type = "ORTHO"
    cam_d.ortho_scale = 1.95
    cam = bpy.data.objects.new("pc_cam", cam_d)
    sc.collection.objects.link(cam)
    sc.camera = cam
    look = Vector((0.0, 0.0, 0.82))
    views = [("front", 0.0, 0.0), ("left", 90.0, 0.0), ("back", 180.0, 0.0), ("game", 0.0, 52.0), ("game34", 40.0, 52.0)]
    tiles = []
    out_dir = scene.ensure_dir(os.path.join(scene.CACHE_DIR, "_fit"))
    for nm, yaw, pitch in views:
        y, p = math.radians(yaw), math.radians(pitch)
        d = Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))
        cam.location = look + d * 6.0
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        f = os.path.join(out_dir, f"gw_{fac}_paint_{nm}.png")
        sc.render.filepath = f
        bpy.ops.render.render(write_still=True)
        tiles.append(f)
    return tiles, fac


def compose(tiles, fac):
    """The views side by side on the concept's paper colour."""
    imgs = []
    for f in tiles:
        im = bpy.data.images.load(f)
        w, h = im.size
        px = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1]
        imgs.append(px)
    h = max(i.shape[0] for i in imgs)
    W = sum(i.shape[1] for i in imgs)
    sheet = np.zeros((h, W, 4), np.float32)
    sheet[..., :3] = (0.86, 0.85, 0.83)
    sheet[..., 3] = 1.0
    x = 0
    for i in imgs:
        a = i[..., 3:4]
        sheet[:i.shape[0], x:x + i.shape[1], :3] = i[..., :3] * a + sheet[:i.shape[0], x:x + i.shape[1], :3] * (1 - a)
        x += i.shape[1]
    out = bpy.data.images.new("pc_sheet", W, h, alpha=True)
    out.pixels[:] = sheet[::-1].ravel()
    path = os.path.join(scene.RENDERS_DIR, "units", f"paint_greatwick_{fac}.png")
    out.filepath_raw = path
    out.file_format = "PNG"
    out.save()
    print(f"[paintcheck] wrote {path}")


if __name__ == "__main__":
    compose(*main())
