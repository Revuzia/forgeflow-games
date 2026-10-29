"""VALE small units: the Sunmote pickups, the hooded-lamp ward and the sparring post.

    Blender -b --factory-startup --python art/blender/units/small_units.py -- [--only sunmote_mend,...]

Surfacing as in structures.py (SDF forms, box-projected painted textures × vertex-painted light) plus
emissive glass. Object-level glTF animations (no skeleton): `idle` loops (a Sunmote bobs and turns, the
ward's lamp breathes, the post sways) and the post's `death` (it topples). Pickups are neutral (their own
glow colours, no accent); the ward's lamp is `accent` (the renderer tints it per viewer).
Output: art/out/units/<id>.glb.
"""
from __future__ import annotations

import math
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
from common import scene  # noqa: E402
from common.hifi import sdf  # noqa: E402
from common.hifi.sdf import Capsule, Ellipsoid, Lathe, RoundBox, Sculpt, Sphere, Torus  # noqa: E402
import structures as S  # noqa: E402  (shared surfacing: box_uv, vpaint, cyl, chip, TaperBox)

OUT = os.path.join(scene.OUT_DIR, "units")
FPS = scene.FPS

GLOW = {"mend": "#7FD6A0", "quick": "#F2D98A", "gleam": "#FFB45A"}


def emissive(name: str, hexcol: str, strength: float, alpha: float = 1.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    c = (*S.srgb2lin(S.hexc(hexcol)), 1)
    b.inputs["Base Color"].default_value = c
    b.inputs["Emission Color"].default_value = c
    b.inputs["Emission Strength"].default_value = strength
    b.inputs["Roughness"].default_value = 0.25
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        m.blend_method = "BLEND" if hasattr(m, "blend_method") else m.blend_method
    return m


def textured(name: str, tex: str, tile: float):
    S.MAT[name] = (tex, tile, "#FFFFFF")
    return S.material(name)


def obj(name, sculpt, mat, col, tris, vox=0.012, uv_tile=None, height=1.0, tint="#FFFFFF"):
    v, q = sculpt.mesh(vox)
    ob = sdf.to_object(name, v, q, col)
    S.low(ob, tris)
    if uv_tile:
        S.box_uv(ob, uv_tile)
        S.vpaint(ob, height, tint)
    ob.data.materials.append(mat)
    return ob


def keys(ob, path, frames_values, index=None):
    for f, v in frames_values:
        if index is None:
            setattr(ob, path, v)
            ob.keyframe_insert(path, frame=f)
        else:
            getattr(ob, path)[index] = v
            ob.keyframe_insert(path, index=index, frame=f)


def parent_all(name, objs):
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    for o in objs:
        o.parent = root
    return root


# ── units ────────────────────────────────────────────────────────────────────────────────────────
def sunmote(kind: str, col):
    glow = emissive(f"sunmote_{kind}_core", GLOW[kind], 3.0)
    shell = emissive("dawnglass_shell", "#BFD3E6", 0.4, alpha=0.55)
    stone = textured("stone", "plaster_chalk.webp", 2.2)
    core = Sculpt("core"); core.add(Sphere((0, 0, 0.62), 0.16), k=0.0)
    sh = Sculpt("shell")
    sh.add(sdf.Lathe((0, 0, 0), lambda r, z: np.abs(np.sqrt(r * r + (z - 0.62) ** 2) - 0.26) - 0.012, 0.3, 0.3, 0.92), k=0.0)
    sh.sub(Ellipsoid((0, 0, 0.62), (0.3, 0.12, 0.3)), k=0.02)                    # open band: the core shows
    chips = Sculpt("chips")
    for i in range(3):
        a = 2 * math.pi * i / 3
        chips.add(Ellipsoid((math.cos(a) * 0.38, math.sin(a) * 0.38, 0.62 + 0.06 * math.sin(a * 2)), (0.05, 0.035, 0.08)), k=0.0)
    base = Sculpt("base")
    base.add(S.cyl(0.0, 0.06, 0.34).displaced(S.chip(0.006, 3.0), 0.006), k=0.0)
    base.add(Torus((0, 0, 0.065), 0.28, 0.02), k=0.01)
    o_core = obj("core", core, glow, col, 400, 0.01)
    o_shell = obj("shell", sh, shell, col, 700, 0.008)
    o_chips = obj("chips", chips, glow, col, 240, 0.006)
    o_base = obj("base", base, stone, col, 500, 0.01, uv_tile=2.2, height=0.1, tint=S.TINT["stone"])
    float_root = parent_all("float", [o_core, o_shell, o_chips])
    root = parent_all(f"sunmote_{kind}", [float_root, o_base])
    n = 4 * FPS                                                                      # 4 s loop

    float_root.animation_data_create()
    act = bpy.data.actions.new("idle")
    float_root.animation_data.action = act
    keys(float_root, "location", [(1, 0.0), (n // 2 + 1, 0.12), (n + 1, 0.0)], index=2)
    pref = bpy.context.preferences.edit
    old = pref.keyframe_new_interpolation_type
    pref.keyframe_new_interpolation_type = "LINEAR"                                  # the turn loops without a hitch
    keys(float_root, "rotation_euler", [(1, 0.0), (n + 1, 2 * math.pi)], index=2)
    pref.keyframe_new_interpolation_type = old
    act.use_fake_user = True
    tr = float_root.animation_data.nla_tracks.new(); tr.name = "idle"; tr.strips.new("idle", 1, act)
    float_root.animation_data.action = None
    return root


def ward(col):
    stone = textured("stone", "plaster_chalk.webp", 2.2)
    iron = textured("ironstone", "ironstone.webp", 1.0)
    accent = emissive("accent", "#3F9CFF", 0.8)
    body = Sculpt("ward")
    body.add(S.cyl(0.0, 0.08, 0.22).displaced(S.chip(0.006, 3.0), 0.006), k=0.0)
    body.add(S.TaperBox(0.08, 0.42, 0.08, 0.065, r=0.02), k=0.02)
    # the hood: a cowl of stone over the lamp, open to the front (-Y)
    hood = Sculpt("hood")
    hood.add(Ellipsoid((0, 0.02, 0.62), (0.17, 0.17, 0.19)), k=0.0)
    hood.sub(Ellipsoid((0, -0.1, 0.58), (0.12, 0.14, 0.13)), k=0.02)
    # its crown: a low rounded KNOB (owner ruling 5 / originality F9: the pointed finial read as a pointed hood tip;
    # a plain rounded dome over the single lamp, no point, no eye-like pair)
    hood.add(Ellipsoid((0, 0.03, 0.795), (0.055, 0.055, 0.042)), k=0.045)
    band = Sculpt("band"); band.add(Torus((0, 0, 0.44), 0.09, 0.018), k=0.0)
    lamp = Sculpt("lamp"); lamp.add(Ellipsoid((0, -0.03, 0.57), (0.08, 0.07, 0.09)), k=0.0)
    objs = [obj("ward_body", body, stone, col, 500, 0.008, 2.2, 0.8, S.TINT["stone"]),
            obj("ward_hood", hood, stone, col, 700, 0.008, 2.2, 0.8, S.TINT["stone"]),
            obj("ward_band", band, iron, col, 200, 0.006, 1.0, 0.8),
            obj("ward_lamp", lamp, accent, col, 200, 0.006)]
    root = parent_all("hooded_lamp", objs)
    lampo = objs[-1]
    lampo.animation_data_create()
    act = bpy.data.actions.new("idle")
    lampo.animation_data.action = act
    n = 3 * FPS
    keys(lampo, "scale", [(1, (1, 1, 1)), (n // 2 + 1, (1.12, 1.12, 1.12)), (n + 1, (1, 1, 1))])
    act.use_fake_user = True
    tr = lampo.animation_data.nla_tracks.new(); tr.name = "idle"; tr.strips.new("idle", 1, act)
    lampo.animation_data.action = None
    return root


def post(col):
    stone = textured("stone", "plaster_chalk.webp", 2.2)
    wood = textured("wood", "wood_planks.webp", 1.2)
    cloth = textured("cloth", "cloth_heavy.webp", 0.9)
    base = Sculpt("base"); base.add(S.cyl(0.0, 0.22, 0.55).displaced(S.chip(0.01, 2.5), 0.01), k=0.0)
    beam = Sculpt("beam")
    beam.add(S.TaperBox(0.2, 1.85, 0.1, 0.085, r=0.02), k=0.0)
    beam.add(RoundBox((0, 0, 1.35), (0.55, 0.07, 0.07), 0.02), k=0.02)             # cross arm
    beam.add(Sphere((0, 0, 1.8), 0.16), k=0.04)                                     # head knob
    wraps = Sculpt("wraps")
    for z in (0.75, 1.0, 1.55):
        wraps.add(Torus((0, 0, z), 0.13, 0.05, rz=0.07).displaced(lambda P: 0.008 * np.sin(np.arctan2(P[:, 1], P[:, 0]) * 7), 0.008), k=0.0)
    for sx in (-1, 1):
        wraps.add(Torus((sx * 0.42, 0, 1.35), 0.09, 0.04, axes=sdf.frame((1, 0, 0))), k=0.0)
    objs = [obj("post_base", base, stone, col, 500, 0.012, 2.2, 1.9, S.TINT["stone"]),
            obj("post_beam", beam, wood, col, 800, 0.012, 1.2, 1.9),
            obj("post_wraps", wraps, cloth, col, 900, 0.01, 0.9, 1.9)]
    top = parent_all("swing", objs[1:])
    root = parent_all("sparring_post", [objs[0], top])
    top.animation_data_create()
    n = 4 * FPS
    for name, ks in (("idle", [(1, 0.0), (n // 2 + 1, math.radians(2.5)), (n + 1, 0.0)]),
                     ("death", [(1, 0.0), (int(0.25 * FPS), math.radians(-8)), (int(1.0 * FPS), math.radians(84)), (int(1.4 * FPS), math.radians(80))])):
        act = bpy.data.actions.new(name)
        top.animation_data.action = act
        keys(top, "rotation_euler", ks, index=0)
        act.use_fake_user = True
        tr = top.animation_data.nla_tracks.new(); tr.name = name; tr.strips.new(name, 1, act)
        top.animation_data.action = None
    return root


BUILD = {"sunmote_mend": lambda c: sunmote("mend", c), "sunmote_quick": lambda c: sunmote("quick", c),
         "sunmote_gleam": lambda c: sunmote("gleam", c), "hooded_lamp": ward, "sparring_post": post}


def export(root, path):
    objs = [root] + list(root.children_recursive)
    scene.select_only(objs, active=root)
    bpy.ops.export_scene.gltf(**scene.op_kwargs(bpy.ops.export_scene.gltf, filepath=path, export_format="GLB", use_selection=True,
                                                export_apply=True, export_yup=True, export_normals=True, export_texcoords=True,
                                                export_vertex_color="ACTIVE", export_materials="EXPORT", export_image_format="AUTO",
                                                export_animations=True, export_animation_mode="NLA_TRACKS", export_force_sampling=True,
                                                export_skins=False, export_lights=False, export_cameras=False))


def main():
    import argparse
    p = argparse.ArgumentParser(); p.add_argument("--only", default="")
    a = p.parse_args(scene.script_args())
    os.makedirs(OUT, exist_ok=True)
    for nme, fn in BUILD.items():
        if a.only and nme not in a.only.split(","):
            continue
        scene.reset()
        col = scene.collection(nme)
        root = fn(col)
        path = os.path.join(OUT, f"{nme}.glb")
        export(root, path)
        scene.log(f"{nme}: {os.path.getsize(path) // 1024} KB")


if __name__ == "__main__":
    main()
