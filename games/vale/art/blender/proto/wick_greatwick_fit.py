"""greatwick fit check: every sculpted part in CONCEPT space over the concept sheet (front + back, pixel-true on the
plate frame, 10 cm grid), then the MODEL-space layout (after the per-part warps) from the front, the side, the
back and the 52-degree game camera, with the rest-pose rig.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/wick_greatwick_fit.py -- --faction aubade [--voxel 0.01]

Needs the plates (proto/wick_greatwick_plates.py). Writes art/renders/units/fit_greatwick_<faction>.png:
white = the concept's cut outline, red = the model's outline, tinted = the parts (overlay at 50 %).
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
import wick_greatwick as gw  # noqa: E402

CACHE = os.path.join(scene.CACHE_DIR, "concept")
SCALE = 1.0            # the plates are already half the sheet's resolution


def args():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--faction", default="aubade")
    p.add_argument("--voxel", type=float, default=0.01)
    p.add_argument("--only", default="")
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


def render_rgba(sc, path):
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)[::-1]


def main():
    a = args()
    fac = a.faction
    spec_L = gw.LAYOUT[fac]
    parts = (gw.aubade_parts if fac == "aubade" else gw.serenade_parts)(spec_L)
    cid = gw.CONCEPT[fac]
    H_PLATE = gw.PLATE_HEIGHT[fac]
    meta = json.load(open(os.path.join(CACHE, f"{cid}_plates.json")))
    scene.reset()
    sc = bpy.context.scene
    col_c = scene.collection("concept_space")
    col_m = scene.collection("model_space")
    only = set(a.only.split(",")) if a.only else None
    for i, sp in enumerate(parts):
        if only and sp.name not in only:
            continue
        v, q = sp.S.mesh(a.voxel * min(1.0, sp.vs * 1.3))
        vm = sp.to_model(v) if sp.to_model is not None else v
        pp = sp.paint_pose()
        vc = pp(vm) if pp is not None else vm
        h = (i * 0.618) % 1.0
        rgb = colorsys.hsv_to_rgb(h, 0.7, 0.95)
        for vv, col, tag in ((vc, col_c, "c"), (vm, col_m, "m")):
            ob = sdf.to_object(f"{sp.name}_{tag}", vv, q, col)
            ob.data.materials.append(flat(f"{sp.name}_{tag}", [c ** 2.2 for c in rgb]) if tag == "c"
                                     else shaded(f"{sp.name}_{tag}", [c ** 2.2 for c in rgb]))
        scene.log(f"{sp.name:14s} {len(v):6d} v  model z {vm[:, 2].min():.3f}..{vm[:, 2].max():.3f}  "
                  f"x {vm[:, 0].min():.3f}..{vm[:, 0].max():.3f}  y {vm[:, 1].min():.3f}..{vm[:, 1].max():.3f}")
    sc.render.engine = "CYCLES"
    scene.cycles_device(sc)
    sc.cycles.samples = 4
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
    concept = project.load_rgb(os.path.join(scene.GAME_DIR, "_design", "concept", f"{cid}.webp"))
    fc = concept.shape[0] // meta["size"][1]
    concept = concept.reshape(concept.shape[0] // fc, fc, concept.shape[1] // fc, fc, 3).mean(axis=(1, 3))
    cmask = project.load_rgb(os.path.join(CACHE, f"{cid}_mask.png"))[..., 0] > 0.5
    panels = []
    col_m.hide_render = True
    for side, x0 in (("front", 0), ("back", W // 2)):
        info = meta[side]
        k = (info["ground"] - info["top"]) / H_PLATE
        cam.ortho_scale = H / k
        uc, vc_ = x0 + W / 4, H / 2
        zc = (info["ground"] - vc_) / k
        if side == "front":
            co.location = ((uc - info["cx"]) / k, -10.0, zc)
            co.rotation_euler = (math.radians(90), 0, 0)
        else:
            co.location = ((info["cx"] - uc) / k, 10.0, zc)
            co.rotation_euler = (math.radians(90), 0, math.radians(180))
        rgba = render_rgba(sc, os.path.join(scene.CACHE_DIR, "_fit", f"gw_{fac}_fit_{side}.png"))
        f = int(round(1 / SCALE))
        c = concept[:, x0:x0 + W // 2].reshape(rh, f, rw, f, 3).mean(axis=(1, 3))
        cm = cmask[:, x0:x0 + W // 2].reshape(rh, f, rw, f).mean(axis=(1, 3)) > 0.5
        al = rgba[..., 3:4]
        model = al[..., 0] > 0.5
        out = c * (1 - 0.5 * al) + rgba[..., :3] ** (1 / 2.2) * 0.5 * al
        for zz in np.arange(0.0, 1.8, 0.1):
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
    # model space: front / side / back ortho + the game camera (shaded, with a key light)
    col_c.hide_render = True
    col_m.hide_render = False
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 3.0
    so = bpy.data.objects.new("sun", sun)
    sc.collection.objects.link(so)
    so.rotation_euler = (math.radians(45), 0, math.radians(-30))
    w = sc.world or bpy.data.worlds.new("w")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.5, 0.5, 0.52, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8
    sc.cycles.samples = 12
    views = []
    for name, loc, rot in (("front", (0, -6, 0.85), (90, 0, 0)), ("side", (6, 0, 0.85), (90, 0, 90)),
                           ("back", (0, 6, 0.85), (90, 0, 180))):
        cam.type = "ORTHO"
        cam.ortho_scale = 1.9
        co.location = loc
        co.rotation_euler = tuple(math.radians(r) for r in rot)
        sc.render.resolution_x, sc.render.resolution_y = int(rh * 0.62), rh
        views.append(render_rgba(sc, os.path.join(scene.CACHE_DIR, "_fit", f"gw_{fac}_model_{name}.png")))
    for name, yaw in (("game", 0.0), ("game34", -40.0), ("gameback", 180.0)):
        cam.type = "ORTHO"                       # the game camera: 52 deg pitch, 28.5 m away (near-orthographic)
        cam.ortho_scale = 2.2
        yr = math.radians(yaw)
        d = np.array([math.sin(yr) * math.cos(math.radians(52)), -math.cos(yr) * math.cos(math.radians(52)),
                      math.sin(math.radians(52))])
        co.location = tuple(np.array([0.0, 0.1, 0.75]) + d * 8)
        co.rotation_euler = (math.radians(38), 0, yr)
        sc.render.resolution_x, sc.render.resolution_y = int(rh * 0.62), rh
        views.append(render_rgba(sc, os.path.join(scene.CACHE_DIR, "_fit", f"gw_{fac}_model_{name}.png")))
    bg = np.array([0.55, 0.55, 0.57])
    vv = [v[..., :3] * v[..., 3:4] + bg * (1 - v[..., 3:4]) for v in views]
    for v in vv:
        v[edge(np.ones(v.shape[:2], bool))] = 0
    sheet = np.concatenate(panels + vv, axis=1)
    path = os.path.join(scene.RENDERS_DIR, "units", f"fit_greatwick_{fac}.png")
    project.save_rgb(np.clip(sheet, 0, 1), path)
    scene.log(f"wrote {path}")


if __name__ == "__main__":
    main()
