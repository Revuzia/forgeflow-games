"""shieldwick fit check: the sculpted parts' silhouettes over each concept on a 10 cm grid (front and back), plus
side, 3/4 and 52-degree views of the flat-coloured parts.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/wick_shieldwick_fit.py -- [--faction aubade|serenade|both] [--voxel 0.007]

Each part renders in its own flat colour with an orthographic camera on exactly the plate's pixel frame (ground
row, centre column, px per m at the faction's plate height), so the overlay is pixel-true: white = the concept's
cut outline, red = the model's outline. Writes art/renders/units/shieldwick_fit_<faction>.png.
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
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "units"))
from common import scene  # noqa: E402
from common.hifi import project, sdf  # noqa: E402
import wick_shieldwick as sw  # noqa: E402

CACHE = os.path.join(scene.CACHE_DIR, "concept")
OUT = os.path.join(scene.RENDERS_DIR, "units")


def args():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--faction", default="both")
    p.add_argument("--voxel", type=float, default=0.007)
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


def render_to(sc, path, w, h):
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)[::-1]


def fit(faction, a):
    F = sw.FACTION[faction]
    H = F["plate_height"]
    cid = f"wicks/shieldwick_{faction}"
    meta = json.load(open(os.path.join(CACHE, f"{cid}_plates.json")))
    scene.reset()
    sc = bpy.context.scene
    col = scene.collection("fit")
    objs = []
    items = sw.parts_aubade(F) if faction == "aubade" else sw.parts_serenade(F)
    for i, (name, S, vs, role, bind, tris) in enumerate(items):
        v, q = S.mesh(a.voxel * min(1.0, vs * 1.3))
        ob = sdf.to_object(name, v, q, col)
        rgb = colorsys.hsv_to_rgb((i * 0.618) % 1.0, 0.7, 0.95)
        if role == "accent":
            rgb = (0.25, 0.6, 1.0)
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
    W, Hh = meta["size"]
    S_ = a.scale
    rw, rh = int(W // 2 * S_), int(Hh * S_)
    cam = bpy.data.cameras.new("c")
    co = bpy.data.objects.new("c", cam)
    sc.collection.objects.link(co)
    sc.camera = co
    cam.type = "ORTHO"
    cam.sensor_fit = "VERTICAL"
    concept = project.load_rgb(os.path.join(scene.GAME_DIR, "_design", "concept", f"{cid}.webp"))
    cmask = project.load_rgb(os.path.join(CACHE, f"{cid}_mask.png"))[..., 0] > 0.5
    panels = []
    for side, x0 in (("front", 0), ("back", W // 2)):
        info = meta[side]
        k = (info["ground"] - info["top"]) / H
        cam.ortho_scale = Hh / k
        uc, vc = x0 + W / 4, Hh / 2
        zc = (info["ground"] - vc) / k
        if side == "front":
            co.location = ((uc - info["cx"]) / k, -10.0, zc)
            co.rotation_euler = (math.radians(90), 0, 0)
        else:
            co.location = ((info["cx"] - uc) / k, 10.0, zc)
            co.rotation_euler = (math.radians(90), 0, math.radians(180))
        rgba = render_to(sc, os.path.join(scene.CACHE_DIR, "_fit", f"shieldwick_{faction}_fit_{side}.png"), rw, rh)
        f = int(round(1 / S_))
        c = concept[:, x0:x0 + W // 2].reshape(rh, f, rw, f, 3).mean(axis=(1, 3))
        cm = cmask[:, x0:x0 + W // 2].reshape(rh, f, rw, f).mean(axis=(1, 3)) > 0.5
        al = rgba[..., 3:4]
        model = al[..., 0] > 0.5
        out = c * (1 - 0.45 * al) + rgba[..., :3] ** (1 / 2.2) * 0.45 * al
        for zz in np.arange(0.0, 1.3, 0.1):
            r = int(round((info["ground"] - zz * k) * S_))
            if 0 <= r < rh:
                out[r, :] = out[r, :] * 0.6 + np.array([0.0, 0.55, 0.75]) * 0.4
        for xx in np.arange(-0.6, 0.61, 0.1):
            u = info["cx"] + (xx * k if side == "front" else -xx * k) - x0
            cc = int(round(u * S_))
            if 0 <= cc < rw:
                out[:, cc] = out[:, cc] * 0.6 + (np.array([0.9, 0.1, 0.1]) if abs(xx) < 1e-6 else np.array([0.0, 0.55, 0.75])) * 0.4
        out[edge(cm)] = (1, 1, 1)
        out[edge(model)] = (1, 0.1, 0.1)
        panels.append(out)
    sheet = np.concatenate(panels, axis=1)
    # side / 3q / game views, shaded
    for ob in objs:
        ob.data.materials[0] = shaded(ob.name + "_sh", [c ** 2.2 for c in ob["rgb"]])
    w = sc.world or bpy.data.worlds.new("w")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8
    key = bpy.data.lights.new("key", "SUN")
    key.energy = 3.0
    ko = bpy.data.objects.new("key", key)
    sc.collection.objects.link(ko)
    ko.rotation_euler = (math.radians(50), 0, math.radians(-35))
    sc.cycles.samples = 12
    views = []
    vw, vh = rw // 2, rh // 2
    from mathutils import Vector
    for name, loc in (("side", (6.0, 0.0, 0.55)), ("side_r", (-6.0, 0.0, 0.55)), ("threeq", (-3.5, -5.0, 3.0)),
                      ("game", (0.0, -6.0, 0.55 + 6.0 * math.tan(math.radians(52))))):
        cam.ortho_scale = 1.45
        co.location = loc
        d = Vector((0, 0, 0.55)) - Vector(loc)
        co.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        rgba = render_to(sc, os.path.join(scene.CACHE_DIR, "_fit", f"shieldwick_{faction}_fit_{name}.png"), vw, vh)
        bg = np.full((vh, vw, 3), 0.35, dtype=np.float32)
        views.append(rgba[..., :3] ** (1 / 2.2) * rgba[..., 3:4] + bg * (1 - rgba[..., 3:4]))
    row = np.concatenate(views, axis=1)
    if row.shape[1] != sheet.shape[1]:
        pad = np.full((row.shape[0], sheet.shape[1], 3), 0.35, dtype=np.float32)
        pad[:, :min(row.shape[1], sheet.shape[1])] = row[:, :sheet.shape[1]]
        row = pad
    path = os.path.join(OUT, f"shieldwick_fit_{faction}.png")
    project.save_rgb(np.clip(np.concatenate([sheet, row], axis=0), 0, 1), path)
    scene.log(f"wrote {path}")


def main():
    a = args()
    for faction in (("aubade", "serenade") if a.faction == "both" else (a.faction,)):
        fit(faction, a)


if __name__ == "__main__":
    main()
