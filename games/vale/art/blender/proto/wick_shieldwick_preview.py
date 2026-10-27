"""shieldwick geometry preview (no rig, no bake: about 20 s): the faction's parts as game meshes in flat palette
colours, exported to a static GLB for the three.js review harness.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/wick_shieldwick_preview.py -- --faction aubade [--out <glb>]

Writes art/.cache/preview/shieldwick_<faction>_preview.glb (default). The bind pose is the idle guard, so the
static preview shows the in-game silhouette (shield, mace, hood) at rest.
"""
from __future__ import annotations

import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "units"))
from common import scene  # noqa: E402
from common.hifi import sdf  # noqa: E402
import wick_common as wc  # noqa: E402
import wick_shieldwick as sw  # noqa: E402


def mat(name, hexcol, emit=False, rough=0.7):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(nd for nd in m.node_tree.nodes if nd.type == "BSDF_PRINCIPLED")
    r, g, bl = scene.hex_srgb(hexcol)
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in (r, g, bl)]
    b.inputs["Base Color"].default_value = (*lin, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = 0.0
    if emit:
        b.inputs["Base Color"].default_value = (lin[0] * 0.2, lin[1] * 0.2, lin[2] * 0.2, 1.0)
        b.inputs["Emission Color"].default_value = (*lin, 1.0)
        b.inputs["Emission Strength"].default_value = 0.8
    return m


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--faction", default="aubade")
    ap.add_argument("--out", default="")
    a = ap.parse_args(scene.script_args())
    scene.reset()
    col = scene.collection("preview")
    pal = wc.FACTION_PALETTES[a.faction]
    fit = sw.PALETTE_FIT[a.faction]
    flat = sw.FLAT[a.faction]
    mats = {}
    F = sw.FACTION[a.faction]
    parts = sw.parts_aubade(F) if a.faction == "aubade" else sw.parts_serenade(F)
    objs = []
    by = {}
    for name, S, vs, role, bind, tris in parts:
        if role == "accent":
            m = mats.get("accent") or mat("accent", "#3F9CFF", emit=True, rough=0.55)
            mats["accent"] = m
        else:
            hexcol = flat.get(name) or (fit[name][0] if name in fit else pal.get(role, "#888888"))
            m = mat(f"{role}_{name}", hexcol)
        if isinstance(S, tuple):
            v, t = S[1].mesh()
            ob = sdf.to_object(f"{name}", v, t, col)
        elif isinstance(S, sw.MeshPart):
            if name in sw.SNAP and sw.SNAP[name] in by:
                S = S.snapped(by[sw.SNAP[name]], smooth=sw.SNAP_SMOOTH.get(name, 2), bias=getattr(sw, "SNAP_BIAS", {}).get(name, 0.0025))
            v, t = S.mesh()
            ob = sdf.to_object(f"{name}", v, t, col)
        else:
            v, q = S.mesh(sw.VOXEL * vs)
            hi = sdf.to_object(f"{name}_high", v, q, col)
            ob = sw.make_low(hi, name, col, tris, sw.VOXEL * vs * 1.25)
            bpy.data.objects.remove(hi)
            ob.name = name
        ob.data.materials.clear()
        ob.data.materials.append(m)
        objs.append(ob)
        by[name] = ob
        print(f"  {name:14s} {role:10s} {len(ob.data.polygons):5d} faces")
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)
    print(f"PREVIEW {a.faction}: {tris} tris")
    out = a.out or os.path.join(scene.CACHE_DIR, "preview", f"shieldwick_{a.faction}_preview.glb")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    for o in bpy.context.scene.objects:
        o.select_set(o in objs)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_yup=True,
                              export_apply=True, export_texcoords=True, export_normals=True, export_materials="EXPORT",
                              export_animations=False)
    print("wrote", out)


main()
