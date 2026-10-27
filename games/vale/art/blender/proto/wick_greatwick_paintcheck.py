"""greatwick paint check: the built game mesh (the build's cached .blend) in the rest pose, UNLIT base colour only
(Workbench, flat light, texture colour), next to the concept sheet, from the front, the back, the wick's left side and
the 52-degree game camera. Shows where the projection smeared or patched, without the three.js lighting on top.

    /Applications/Blender.app/Contents/MacOS/Blender -b art/.cache/fighters/greatwick_<faction>.blend \
        --python art/blender/proto/wick_greatwick_paintcheck.py -- --faction aubade

Writes art/renders/units/paint_greatwick_<faction>.png.
`--zoom <out.png>`: close-ups instead (studio-lit texture, so form + paint: hood, torso, hammer, lantern, 3/4 top),
`--unlit` keeps them flat-lit, `--set game` swaps them for 52-degree game-pitch close-ups (hood from 0 / +-40 degrees,
the back-lantern from the side and the back), `--parts` paints one colour per part.
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


ZOOMS = [  # (name, look xyz, yaw, pitch, ortho scale)
    ("hood", (0.0, 0.0, 0.98), 0.0, 8.0, 0.62), ("torso", (0.0, 0.0, 0.62), 0.0, 5.0, 0.78),
    ("torso34", (0.0, 0.0, 0.70), 35.0, 30.0, 0.86), ("hammer", (0.25, -0.3, 0.52), 0.0, 10.0, 0.62),
    ("lantern", (0.0, 0.35, 1.25), 0.0, 25.0, 0.80), ("side", (0.0, 0.2, 0.85), 90.0, 12.0, 1.85),
    ("back", (0.0, 0.0, 0.85), 180.0, 10.0, 1.85), ("top", (0.0, 0.15, 0.95), 20.0, 52.0, 1.7)]
ZOOMS_GAME = [  # `--set game`: the 52-degree gameplay pitch, close (the face test, the lantern, the death underside)
    ("hood52", (0.0, -0.05, 0.95), 0.0, 52.0, 0.55), ("hood52_40", (0.0, -0.05, 0.95), 40.0, 52.0, 0.55),
    ("hood52_m40", (0.0, -0.05, 0.95), -40.0, 52.0, 0.55), ("lant52_90", (0.0, 0.3, 1.05), 90.0, 52.0, 1.2),
    ("lant52_150", (0.0, 0.3, 1.05), 150.0, 52.0, 1.2), ("lant52_180", (0.0, 0.3, 1.0), 180.0, 52.0, 1.3),
    ("body52", (0.0, 0.0, 0.75), 20.0, 52.0, 1.75), ("side0", (0.0, 0.2, 0.8), 90.0, 0.0, 1.75)]


def main():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    fac = a[a.index("--faction") + 1] if "--faction" in a else "aubade"
    zoom = a[a.index("--zoom") + 1] if "--zoom" in a else None
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
    sh.light = "FLAT" if (zoom is None or "--unlit" in a) else "STUDIO"
    sh.color_type = "TEXTURE"
    if "--parts" in a:                         # one random colour per part (vale_part), to name what is where
        rng = np.random.default_rng(3)
        for o in bpy.data.objects:
            if o.type != "MESH" or o.hide_render or "vale_part" not in o.data.attributes:
                continue
            me = o.data
            pv = np.zeros(len(me.vertices), np.int64)
            me.attributes["vale_part"].data.foreach_get("value", pv)
            pal = rng.random((max(64, pv.max() + 1), 3)) * 0.8 + 0.2
            ca = me.color_attributes.new("gw_parts", "FLOAT_COLOR", "POINT")
            ca.data.foreach_set("color", np.c_[pal[pv], np.ones(len(pv))].ravel().astype(np.float32))
            me.color_attributes.active_color = ca
            print("[paintcheck] parts:", {int(i): tuple(np.round(pal[i], 2)) for i in np.unique(pv)})
        sh.color_type = "VERTEX"
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
    views = [("front", 0.0, 0.0, None, None), ("left", 90.0, 0.0, None, None), ("back", 180.0, 0.0, None, None),
             ("game", 0.0, 52.0, None, None), ("game34", 40.0, 52.0, None, None)]
    if zoom:
        zl = ZOOMS_GAME if ("--set" in a and a[a.index("--set") + 1] == "game") else ZOOMS
        views = [(nm, yaw, pitch, Vector(lk), osc) for nm, lk, yaw, pitch, osc in zl]
        sc.render.resolution_x, sc.render.resolution_y = 600, 600
    tiles = []
    out_dir = scene.ensure_dir(os.path.join(scene.CACHE_DIR, "_fit"))
    for nm, yaw, pitch, lk, osc in views:
        y, p = math.radians(yaw), math.radians(pitch)
        d = Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))
        cam_d.ortho_scale = osc or 1.95
        cam.location = (lk or look) + d * 6.0
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        f = os.path.join(out_dir, f"gw_{fac}_paint_{nm}.png")
        sc.render.filepath = f
        bpy.ops.render.render(write_still=True)
        tiles.append(f)
    return tiles, fac, zoom


def compose(tiles, fac, zoom=None):
    """The views side by side on the concept's paper colour."""
    imgs = []
    for f in tiles:
        im = bpy.data.images.load(f)
        w, h = im.size
        px = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1]
        imgs.append(px)
    h = max(i.shape[0] for i in imgs)
    W = sum(i.shape[1] for i in imgs)
    if zoom:                                   # 2 rows
        n = (len(imgs) + 1) // 2
        rows = [np.concatenate(imgs[:n], 1), np.concatenate(imgs[n:] + [np.zeros_like(imgs[0])] * (2 * n - len(imgs)), 1)]
        imgs = [np.concatenate(rows, 0)]
        h, W = imgs[0].shape[:2]
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
    path = zoom or os.path.join(scene.RENDERS_DIR, "units", f"paint_greatwick_{fac}.png")
    out.filepath_raw = path
    out.file_format = "PNG"
    out.save()
    print(f"[paintcheck] wrote {path}")


if __name__ == "__main__":
    compose(*main())
