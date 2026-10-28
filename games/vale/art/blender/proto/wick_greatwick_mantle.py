"""greatwick Serenade mantle / yoke / pack geometry check (no build, no bake): builds the Serenade parts list, makes the
GAME meshes of the upper body (exact lows where the part has one, else the sculpt itself) in MODEL space and renders
them one flat colour per part in Workbench (studio light), so the mantle's top edge, the V notch and the pack's
shading are judged on the geometry alone, in seconds instead of a full build:
  eye level: front, 3/4 (35), side (90), back 3/4 (215); then the 52-degree gameplay pitch front / 3/4 / back 3/4.
Also prints the mantle's per-column top heights (the sawtooth test: the largest jump between neighbours).

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 \
        --python art/blender/proto/wick_greatwick_mantle.py -- --out DIR [--texture]

Writes DIR/gw_s_mantle_<view>.png and DIR/gw_s_mantle_sheet.png.
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

from common import heavy, scene  # noqa: E402

SHOW = {  # part -> flat colour (sRGB)
    "hood": "#B49A74", "hood_rim": "#3B302A", "collar": "#4B4039", "crown_band": "#3F9CFF", "mantle": "#D8C3A0",
    "cloak": "#765E4E", "sleeve_R": "#6A5446", "sleeve_L": "#6A5446", "mitt_R": "#45362C", "mitt_L": "#45362C",
    "pack": "#6E5848", "frame_posts": "#5A4436", "drum_bands": "#4B4039", "drum_lid": "#7E6A51", "drum_floor": "#4B4039",
    "hollow_floor": "#17150F", "boot_L": "#45362C", "boot_R": "#45362C",
}
VIEWS = [  # name, yaw (deg, the figure turned about Z), pitch (deg), look-at z, ortho scale
    ("eye_front", 0, 2, 0.95, 0.80), ("eye_q34", 35, 2, 0.95, 0.80), ("eye_side", 90, 2, 0.95, 0.80),
    ("eye_q34b", 215, 2, 0.95, 0.95), ("eye_back", 180, 2, 0.95, 0.95),
    ("g52_front", 0, 52, 0.90, 0.95), ("g52_q34", 40, 52, 0.90, 0.95), ("g52_q34b", 220, 52, 0.90, 1.2),
]


def lin(h):
    return [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in scene.hex_srgb(h)]


def slices(gw, parts, out):
    """Vertical half-plane slices through the mantle axis (model space) at the strip's column angles: which part is
    inside at each (r, z), plus the mantle low's vertices in that plane; saved as DIR/slices.npz (drawn outside)."""
    by = {sp.name: sp for sp in parts}
    fields = {}
    for nm in ("hood", "hood_rim", "collar", "mantle", "cloak", "pack", "frame_posts", "sleeve_R", "sleeve_L"):
        sp = by.get(nm)
        if sp is None:
            continue
        F = gw.field_of(sp.S)
        fields[nm] = gw.WarpedField(F, gw.invert(sp.to_model)) if sp.to_model is not None else F
    ax0 = gw.compose(gw.shift(dx=0.03), gw.SER_BODY)(np.array([[-0.03, 0.02, 0.9]]))[0]
    rs = np.linspace(0.0, 0.50, 201)
    zs = np.linspace(0.62, 1.10, 193)
    R, Z = np.meshgrid(rs, zs)
    res = {"rs": rs, "zs": zs, "axis": ax0}
    sp = by["mantle"]
    V = np.asarray(sp.meta["low_mesh"][0], float)
    V = sp.to_model(V)
    res["mantleV"] = V
    for ang in range(0, 360, 5):
        a = math.radians(ang)
        d = np.array([math.sin(a), -math.cos(a), 0.0])
        P = np.stack([ax0[0] + R.ravel() * d[0], ax0[1] + R.ravel() * d[1], Z.ravel()], 1)
        for nm, F in fields.items():
            res[f"{nm}_{ang}"] = (F.d(P) < 0).reshape(R.shape)
    np.savez_compressed(os.path.join(out, "slices.npz"), **res)
    print("SLICES", os.path.join(out, "slices.npz"))


def main():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = a[a.index("--out") + 1] if "--out" in a else os.path.join(scene.ART_DIR, "renders", "units", "_mantle")
    os.makedirs(out, exist_ok=True)
    heavy.hold("blender:greatwick_mantle")
    import wick_greatwick as gw
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    parts = gw.serenade_parts(gw.LAYOUT["serenade"])
    root = bpy.data.objects.new("root", None)
    bpy.context.scene.collection.objects.link(root)
    for sp in parts:
        if sp.name not in SHOW:
            continue
        if sp.meta.get("low_mesh"):
            V, F = sp.meta["low_mesh"]
            V = np.asarray(V, float)
            smooth = bool(sp.meta.get("smooth"))
        else:
            V, F = sp.S.mesh(gw.VOXEL * sp.vs)
            smooth = True
        if sp.to_model is not None:
            V = sp.to_model(V)
        ob = gw.sdf.to_object(sp.name, np.asarray(V, float), np.asarray(F, np.int64), bpy.context.scene.collection)
        ob.data.polygons.foreach_set("use_smooth", np.full(len(ob.data.polygons), smooth, dtype=bool))
        ob.color = (*lin(SHOW[sp.name]), 1.0)
        ob.parent = root
        if sp.name == "mantle":
            nv = 6                                    # rows: tuck, top, two felt rows, hem, lip (fix round 7)
            VV = np.asarray(V).reshape(-1, nv, 3)
            tops = VV[1:-1, 1, 2]                     # (the two end columns are the notch facings)
            jump = np.abs(np.diff(tops))
            print("MANTLE tops", " ".join(f"{z:.3f}" for z in tops))
            print(f"MANTLE max neighbour jump {jump.max():.4f} m, mean {jump.mean():.4f}; 2nd diff max "
                  f"{np.abs(np.diff(tops, 2)).max():.4f}")
    if "--slices" in a:
        slices(gw, parts, out)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.color_type = "OBJECT"
    sh.show_cavity = False
    sh.show_object_outline = False
    sc.render.film_transparent = False
    sc.world = sc.world or bpy.data.worlds.new("w")
    sc.render.resolution_x = sc.render.resolution_y = 700
    cam_d = bpy.data.cameras.new("cam")
    cam_d.type = "ORTHO"
    cam = bpy.data.objects.new("cam", cam_d)
    sc.collection.objects.link(cam)
    sc.camera = cam
    paths = []
    for nm, yaw, pitch, z, ortho in VIEWS:
        root.rotation_euler = (0.0, 0.0, math.radians(yaw))
        bpy.context.view_layer.update()
        p = math.radians(pitch)
        loc = Vector((0.0, -5.0 * math.cos(p), z + 5.0 * math.sin(p)))
        cam.location = loc
        cam.rotation_euler = (Vector((0.0, 0.0, z)) - loc).to_track_quat("-Z", "Y").to_euler()
        cam_d.ortho_scale = ortho
        path = os.path.join(out, f"gw_s_mantle_{nm}.png")
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        paths.append(path)
        print("MANTLEVIEW", path)


if __name__ == "__main__":
    main()
