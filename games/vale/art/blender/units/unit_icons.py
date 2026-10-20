"""VALE unit icons for the static units: structures, the Sunmote pickups and the hooded-lamp ward.

    Blender -b --factory-startup --python art/blender/units/unit_icons.py -- [--only needle_outer,...] [--fast]

Each GLB in art/out/units is imported as built (structures: <id>_aubade.glb, the canonical culture), framed whole from a three-quarter view, lit with the map's
sun and the bible's rim pair (the same setup as the fighter and monster icons), rendered transparent and
laid over a painted ink backdrop with a soft glow in the unit's own colour. Output: art/out/units/<id>_icon.png
(128x128, the size CONTRACT §12 gives icons).
"""
from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

from common import scene  # noqa: E402

OUT = os.path.join(scene.OUT_DIR, "units")
RENDERS = os.path.join(scene.RENDERS_DIR, "units")

# yaw/pitch of the view, how much of the frame the unit fills, backdrop ink + glow
ICONS = {
    "needle_outer": {"yaw": 30.0, "pitch": 10.0, "fill": 0.9, "ink": "#1D1F25", "glow": "#5F7488"},
    "needle_inner": {"yaw": 30.0, "pitch": 10.0, "fill": 0.9, "ink": "#1D1F25", "glow": "#5F7488"},
    "needle_bell": {"yaw": 30.0, "pitch": 10.0, "fill": 0.9, "ink": "#1D1F25", "glow": "#6A6F86"},
    "hourbell": {"yaw": 30.0, "pitch": 14.0, "fill": 0.86, "ink": "#1D1F25", "glow": "#5F7488"},
    "lantern": {"yaw": 30.0, "pitch": 12.0, "fill": 0.88, "ink": "#1D1F25", "glow": "#5F7488"},
    "hooded_lamp": {"yaw": 30.0, "pitch": 12.0, "fill": 0.86, "ink": "#1D1F25", "glow": "#4A6A8A"},
    "sunmote_mend": {"yaw": 20.0, "pitch": 16.0, "fill": 0.8, "ink": "#1B1F1D", "glow": "#3F7A55"},
    "sunmote_quick": {"yaw": 20.0, "pitch": 16.0, "fill": 0.8, "ink": "#1F1D18", "glow": "#7A6A35"},
    "sunmote_gleam": {"yaw": 20.0, "pitch": 16.0, "fill": 0.8, "ink": "#201B17", "glow": "#7A4F25"},
}


def render_icon(uid: str, fast: bool = False) -> str:
    from common import imageops, render
    cfg = ICONS[uid]
    scene.reset()
    # structures ship one model per culture (art.teamModels); the icon shows the canonical Aubade one
    # (the unquantized export structures.py keeps for its contact sheet imports cleanly into Blender)
    src = os.path.join(OUT, f"{uid}_aubade.glb")
    raw = os.path.join(scene.CACHE_DIR, "structures", "raw", f"{uid}_aubade.glb")
    structure = os.path.isfile(src)
    bpy.ops.import_scene.gltf(filepath=(raw if os.path.isfile(raw) else src) if structure else os.path.join(OUT, f"{uid}.glb"))
    if structure:
        bpy.context.scene.frame_set(0)
        for o in bpy.context.scene.objects:      # rest pose (the importer leaves a clip applied)
            if o.animation_data:
                o.animation_data.action = None
            o.animation_data_clear()
        for o in bpy.context.scene.objects:
            if o.name.endswith("_core"):
                o.scale = (1.0, 1.0, 1.0)
            if o.parent is None and o.type == "EMPTY":
                o.rotation_mode = "XYZ"
                o.rotation_euler = (0.0, 0.0, 1.5707963)     # the side the game camera sees (facing 0)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    cam = render.camera(lens=85)
    render._fit_camera(cam, lo, hi, cfg["yaw"], cfg["pitch"], 70.0, cfg["fill"], 1.0, 0.5)
    light = render.map_lighting("map_rift")
    render.sky_world(light["sky"], light["ambient"], camera_strength=1.0)
    rc = dict(render.SPLASH_DEFAULTS)
    rc["rim_cool"] = rc["rim_warm"] = 0.4
    render.bible_lights(cam, rc, light, rim=1.2, scale=0.6, pair=True, target=(lo + hi) * 0.5)
    render.setup(256, 256, 24 if fast else 160, transparent=True, view="Khronos PBR Neutral")
    os.makedirs(RENDERS, exist_ok=True)
    raw = os.path.join(RENDERS, f"_{uid}_icon_raw.png")
    render.render(raw)
    imageops.denoise(raw, 2.0)
    fg = imageops.premul_resize(imageops.load(raw), 128, 128)
    bg = imageops.painted_backdrop(128, 128, cfg["ink"], cfg["glow"], seed=scene.seed_of(uid) % 1000, glow=(0.5, 0.4), glow_size=0.6)
    out = os.path.join(OUT, f"{uid}_icon.png")
    imageops.save(imageops.grade(imageops.over(fg, bg)), out, alpha=False)
    os.remove(raw)
    scene.log(f"icon {scene.rel(out)}")
    return out


def main():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--only", default="")
    p.add_argument("--fast", action="store_true")
    a = p.parse_args(scene.script_args())
    for uid in ICONS:
        if a.only and uid not in a.only.split(","):
            continue
        render_icon(uid, a.fast)


if __name__ == "__main__":
    main()
