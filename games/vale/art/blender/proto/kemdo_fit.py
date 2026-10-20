"""Kemdo fit check: the sculpted parts' silhouettes over the concept on a 10 cm grid (front and back),
plus a side and a 52-degree view of the flat-coloured parts (no concept there).

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/kemdo_fit.py -- [--voxel 0.01]

Needs the plates (proto/kemdo_plates.py). Each part renders in its own flat colour with an orthographic
camera on exactly the plate's pixel frame (ground row, centre column, px per m), so the overlay is
pixel-true: white = the concept's figure outline, red = the model's outline, tinted fill = the parts.
Writes art/renders/fighters/kemdo/fit_front_back.png and fit_side_game.png.
"""
from __future__ import annotations

import colorsys
import json
import math
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "fighters"))
from common import scene  # noqa: E402
from common.hifi import project, sdf  # noqa: E402
import kemdo  # noqa: E402

CACHE = os.path.join(scene.CACHE_DIR, "concept")
OUT = os.path.join(scene.RENDERS_DIR, "fighters", "kemdo")
SCALE = 0.5


def args():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--voxel", type=float, default=0.01)
    p.add_argument("--only", default="")
    p.add_argument("--scale", type=float, default=0.5)
    return p.parse_args(scene.script_args())


def flat(name, rgb):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = (*rgb, 1.0)
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(e.outputs[0], o.inputs[0])
    return m


def shaded(name, rgb):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*rgb, 1.0)
    b.inputs["Roughness"].default_value = 0.7
    return m


def edge(mask):
    e = np.zeros_like(mask)
    e[1:-1, 1:-1] = mask[1:-1, 1:-1] & ~(mask[:-2, 1:-1] & mask[2:, 1:-1] & mask[1:-1, :-2] & mask[1:-1, 2:])
    return e


def main():
    a = args()
    global SCALE
    SCALE = a.scale
    meta = json.load(open(os.path.join(CACHE, "kemdo_plates.json")))
    scene.reset()
    sc = bpy.context.scene
    col = scene.collection("fit")
    objs = []
    only = set(a.only.split(",")) if a.only else None
    items = kemdo.sculpts()
    for i, (name, S, vs, role, bind, tris, uvw) in enumerate(items):
        if only and name not in only:
            continue
        v, q = S.mesh(a.voxel * min(1.0, vs * 1.4))
        ob = sdf.to_object(name, v, q, col)
        h = (i * 0.618) % 1.0
        rgb = colorsys.hsv_to_rgb(h, 0.75, 0.95)
        ob["rgb"] = rgb
        ob.data.materials.append(flat(name + "_flat", [c ** 2.2 for c in rgb]))
        objs.append(ob)
        scene.log(f"{name}: {len(v)} v  z {v[:, 2].min():.3f}..{v[:, 2].max():.3f}  x {v[:, 0].min():.3f}..{v[:, 0].max():.3f}"
                  f"  y {v[:, 1].min():.3f}..{v[:, 1].max():.3f}")
    sc.render.engine = "CYCLES"
    scene.cycles_device(sc)
    sc.cycles.samples = 2
    sc.cycles.use_denoising = False
    sc.render.film_transparent = True
    sc.render.filter_size = 0.5
    sc.view_settings.view_transform = "Standard"
    W, H = meta["size"]
    rw, rh = int(W // 2 * SCALE), int(H * SCALE)
    sc.render.resolution_x, sc.render.resolution_y = rw, rh
    cam = bpy.data.cameras.new("c")
    co = bpy.data.objects.new("c", cam)
    sc.collection.objects.link(co)
    sc.camera = co
    cam.type = "ORTHO"
    cam.sensor_fit = "VERTICAL"
    concept = project.load_rgb(os.path.join(scene.GAME_DIR, "_design", "concept", "kemdo.webp"))
    cmask = project.load_rgb(os.path.join(CACHE, "kemdo_mask.png"))[..., 0] > 0.5
    panels = []
    for side, x0 in (("front", 0), ("back", W // 2)):
        info = meta[side]
        k = (info["ground"] - info["top"]) / kemdo.HEIGHT
        cam.ortho_scale = H / k
        uc, vc = x0 + W / 4, H / 2
        zc = (info["ground"] - vc) / k
        if side == "front":
            xc = (uc - info["cx"]) / k
            co.location = (xc, -10.0, zc)
            co.rotation_euler = (math.radians(90), 0, 0)
        else:
            xc = (info["cx"] - uc) / k
            co.location = (xc, 10.0, zc)
            co.rotation_euler = (math.radians(90), 0, math.radians(180))
        path = os.path.join(scene.CACHE_DIR, "_fit", f"kemdo_fit_{side}.png")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path)
        px = np.empty(rw * rh * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        rgba = px.reshape(rh, rw, 4)[::-1]
        # concept half, downscaled
        f = int(round(1 / SCALE))
        c = concept[:, x0:x0 + W // 2].reshape(rh, f, rw, f, 3).mean(axis=(1, 3))
        cm = cmask[:, x0:x0 + W // 2].reshape(rh, f, rw, f).mean(axis=(1, 3)) > 0.5
        al = rgba[..., 3:4]
        model = al[..., 0] > 0.5
        out = c * (1 - 0.5 * al) + rgba[..., :3] ** (1 / 2.2) * 0.5 * al
        # 10 cm grid
        for zz in np.arange(0.0, 2.5, 0.1):
            r = int(round((info["ground"] - zz * k) * SCALE))
            if 0 <= r < rh:
                out[r, :] = out[r, :] * 0.6 + np.array([0.0, 0.55, 0.75]) * 0.4
        for xx in np.arange(-1.0, 1.01, 0.1):
            u = info["cx"] + (xx * k if side == "front" else -xx * k) - x0
            cc = int(round(u * SCALE))
            if 0 <= cc < rw:
                out[:, cc] = out[:, cc] * 0.6 + (np.array([0.9, 0.1, 0.1]) if abs(xx) < 1e-6 else np.array([0.0, 0.55, 0.75])) * 0.4
        out[edge(cm)] = (1, 1, 1)
        out[edge(model)] = (1, 0.1, 0.1)
        panels.append(out)
        bpy.data.images.remove(img)
    sheet = np.concatenate(panels, axis=1)
    project.save_rgb(np.clip(sheet, 0, 1), os.path.join(OUT, "fit_front_back.png"))
    # side + game views of the shaded parts
    for ob in objs:
        rgb = ob["rgb"]
        ob.data.materials[0] = shaded(ob.name + "_sh", [c ** 2.2 for c in rgb])
    w = sc.world or bpy.data.worlds.new("w")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8
    key = bpy.data.lights.new("key", "SUN")
    key.energy = 3.0
    ko = bpy.data.objects.new("key", key)
    sc.collection.objects.link(ko)
    ko.rotation_euler = (math.radians(50), 0, math.radians(-35))
    sc.cycles.samples = 16
    views = []
    for name, loc, rot in (("side", (10.0, 0.0, 1.2), (90, 0, 90)), ("side_r", (-10.0, 0.0, 1.2), (90, 0, -90)),
                           ("threeq", (-6.0, -7.5, 1.2 + 9.6 * math.tan(math.radians(30))), None),
                           ("game", (0.0, -6.0, 1.0 + 6.0 * math.tan(math.radians(52))), None)):
        cam.ortho_scale = 2.7
        co.location = loc
        if rot:
            co.rotation_euler = tuple(math.radians(r) for r in rot)
        else:
            from mathutils import Vector
            d = Vector((0, 0, 1.1)) - Vector(loc)
            co.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        sc.render.resolution_x, sc.render.resolution_y = 600, 700
        path = os.path.join(scene.CACHE_DIR, "_fit", f"kemdo_fit_{name}.png")
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path)
        px = np.empty(600 * 700 * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        rgba = px.reshape(700, 600, 4)[::-1]
        bg = np.full((700, 600, 3), 0.35, dtype=np.float32)
        views.append(rgba[..., :3] * rgba[..., 3:4] + bg * (1 - rgba[..., 3:4]))
        bpy.data.images.remove(img)
    project.save_rgb(np.concatenate(views, axis=1), os.path.join(OUT, "fit_side_game.png"))
    scene.log("wrote fit sheets")


if __name__ == "__main__":
    main()
