"""Quick geometry preview for the glimwick (no bake, no rig): every part meshed and decimated exactly as the build
does (wick_glimwick.Glimwick.model), flat role colours (the accent emissive azure), rendered in EEVEE from the
front, the 3/4, the back, a head close-up and the 52 deg game camera. For iterating on forms in ~1 min instead
of a full build.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/wick_glimwick_preview.py \
        -- [--faction aubade|serenade|both] [--out art/.cache/glimwick/preview] [--parts hood,seam]

Writes <out>_<faction>.png (one sheet) and prints the per-part triangle counts.
"""
from __future__ import annotations

import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "units"))

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

from common import mesh, scene  # noqa: E402
from common.hifi import sdf  # noqa: E402

import wick_common as wc  # noqa: E402
import wick_glimwick as gw  # noqa: E402


def args():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--faction", default="both")
    p.add_argument("--out", default=os.path.join(scene.CACHE_DIR, "glimwick", "preview"))
    p.add_argument("--parts", default="")
    p.add_argument("--size", type=int, default=520)
    return p.parse_args(scene.script_args())


def mat(name, hexc, emit=False, rough=0.7):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    r, g, bl = scene.hex_srgb(hexc) if hasattr(scene, "hex_srgb") else (0.5, 0.5, 0.5)
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in (r, g, bl)]
    b.inputs["Base Color"].default_value = (*lin, 1.0)
    b.inputs["Roughness"].default_value = rough
    if emit:
        # the accent: factor-only (the shared load test), base 0.3 x tint, emission the tint
        b.inputs["Base Color"].default_value = (lin[0] * 0.3, lin[1] * 0.3, lin[2] * 0.3, 1.0)
        b.inputs["Emission Color"].default_value = (*lin, 1.0)
        b.inputs["Emission Strength"].default_value = 0.9
    return m


def build(faction, only):
    pal = dict(wc.FACTION_PALETTES[faction])
    parts = gw.parts_for(faction)
    col = bpy.data.collections.new(f"prev_{faction}")
    bpy.context.scene.collection.children.link(col)
    tot = 0
    rep = []
    for p in parts:
        if only and p["name"] not in only:
            continue
        v, q = p["S"].mesh(gw.VOXEL * p["vs"])
        ob = sdf.to_object(f"{p['name']}_high", v, q, col)
        if os.environ.get("GLIM_PREVIEW_HIGH") and not p.get("prim"):
            low = ob                                    # debug: the undecimated SDF mesh
        else:
            low = gw.make_low(p, ob, col)
            bpy.data.objects.remove(ob, do_unlink=True)
        hexc = p["tint"] or pal.get(p["role"], "#888888")
        low.data.materials.clear()
        low.data.materials.append(mat(f"m_{faction}_{p['name']}", hexc if p["role"] != "accent" else "#3F9CFF",
                                      emit=p["role"] == "accent"))
        for f in low.data.polygons:
            f.use_smooth = p["role"] not in ("chalk",) or p["name"] in ("knob",)
        tot += mesh.tri_count(low, evaluated=False)
        rep.append((p["name"], p["tris"], mesh.tri_count(low, evaluated=False)))
    print(f"PREVIEW {faction}: {tot} tris", rep)
    return col


def cam_at(name, loc, target, ortho=None, lens=50):
    c = bpy.data.cameras.new(name)
    if ortho:
        c.type = "ORTHO"
        c.ortho_scale = ortho
    else:
        c.lens = lens
    o = bpy.data.objects.new(name, c)
    bpy.context.scene.collection.objects.link(o)
    o.location = Vector(loc)
    d = Vector(target) - Vector(loc)
    o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return o


def main():
    a = args()
    only = set(filter(None, a.parts.split(",")))
    facs = ("aubade", "serenade") if a.faction == "both" else (a.faction,)
    scn = bpy.context.scene
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    try:
        scn.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scn.render.engine = "BLENDER_EEVEE"
    scn.render.resolution_x = scn.render.resolution_y = a.size
    scn.render.film_transparent = False
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.32, 0.31, 0.29, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 0.9
    scn.world = w
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.2
    sun.rotation_euler = (math.radians(40), math.radians(-20), math.radians(-30))
    scn.collection.objects.link(sun)
    ground = bpy.data.meshes.new("g")
    ground.from_pydata([(-3, -3, 0), (3, -3, 0), (3, 3, 0), (-3, 3, 0)], [], [(0, 1, 2, 3)])
    go = bpy.data.objects.new("ground", ground)
    go.data.materials.append(mat("ground", "#B8B0A0"))
    scn.collection.objects.link(go)
    cols = {}
    for f in facs:
        cols[f] = build(f, only)
    views = [("front", (0.0, -3.2, 0.72), (0.0, 0.0, 0.66), 1.55), ("q34", (2.2, -2.3, 1.3), (0.0, 0.0, 0.62), 1.55),
             ("back", (0.4, 3.2, 0.9), (0.0, 0.0, 0.66), 1.55), ("head", (0.0, -2.0, 0.80), (0.0, -0.05, 0.78), 0.55),
             ("game", (0.0, -3.0 * math.cos(math.radians(52)), 3.0 * math.sin(math.radians(52)) + 0.55), (0.0, 0.0, 0.55), 1.7),
             ("game34", (2.0 * math.cos(math.radians(52)), -2.0 * math.cos(math.radians(52)), 2.83 * math.sin(math.radians(52)) + 0.55), (0.0, 0.0, 0.55), 1.7),
             ("hollow", (0.0, -1.2, 0.80), (0.0, -0.1, 0.75), 0.34),
             ("hollow52", (0.0, -1.2 * math.cos(math.radians(52)), 0.76 + 1.2 * math.sin(math.radians(52))), (0.0, -0.1, 0.74), 0.34),
             ("hollow34", (0.75, -0.95, 0.95), (0.0, -0.1, 0.74), 0.36)]
    for f in facs:
        for g, c in cols.items():
            for o in c.objects:
                o.hide_render = g != f
        tiles = []
        for nm, loc, tgt, ortho in views:
            cam = cam_at(f"cam_{nm}", loc, tgt, ortho=ortho)
            scn.camera = cam
            path = f"{a.out}_{f}_{nm}.png"
            scn.render.filepath = path
            bpy.ops.render.render(write_still=True)
            tiles.append(path)
        print("PREVIEW", f, tiles)


if __name__ == "__main__":
    main()
