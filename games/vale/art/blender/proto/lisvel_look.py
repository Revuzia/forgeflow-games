"""Lisvel look check (bind pose, no bake, ~1 min): the chosen parts meshed as the build meshes them (optionally
decimated to their budgets), vertex-coloured by the build's own painters (lisvel.PROC), rendered in close views.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/lisvel_look.py -- \
        [--only wrap,mask,...] [--low] [--views portrait,front,back,quiver,face34] [--out name]

Writes art/renders/fighters/lisvel/_look/<out>.png (one row of views) and prints a clearance report (the visor's
ends inside the wrap, its back face off the mask; the straps above the tabard; the cowl's drape above the straps).
"""
from __future__ import annotations

import argparse
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "fighters"))
from common import mesh, scene  # noqa: E402
from common.hifi import project, sdf  # noqa: E402
import lisvel as L  # noqa: E402

OUT = os.path.join(scene.RENDERS_DIR, "fighters", "lisvel", "_look")
HEAD = ("wrap", "mask", "visor", "neck", "cowl", "body", "tabard", "straps", "brooch", "brooch_glass", "sleeves",
        "belt", "buckle", "tabard_skirt", "tunic")
VIEWS = {
    # name: (camera location, target, ortho scale)
    "portrait": ((-0.55, -1.05, 1.80), (0.0, 0.0, 1.62), 0.62),
    "face34": ((-0.55, -0.90, 1.76), (0.0, -0.05, 1.70), 0.30),
    "front": ((0.0, -1.2, 1.62), (0.0, 0.0, 1.55), 0.55),
    "back": ((0.45, 1.05, 1.62), (0.0, 0.0, 1.40), 0.62),
    "side": ((-1.2, 0.0, 1.60), (0.0, 0.0, 1.56), 0.42),
    "neck": ((-0.30, -1.0, 1.66), (0.0, 0.0, 1.55), 0.34),
    "quiver": ((-1.0, -0.6, 1.05), (-0.25, 0.03, 0.95), 0.62),
    "quiver_b": ((-0.9, 0.7, 1.05), (-0.25, 0.03, 0.95), 0.62),
}


def args():
    p = argparse.ArgumentParser()
    p.add_argument("--only", default=",".join(HEAD))
    p.add_argument("--low", action="store_true")
    p.add_argument("--views", default="portrait,face34,front,back")
    p.add_argument("--out", default="look")
    p.add_argument("--res", type=int, default=520)
    return p.parse_args(scene.script_args())


def colour_attr(ob, name):
    me = ob.data
    n = len(me.vertices)
    co = np.empty(n * 3)
    me.vertices.foreach_get("co", co)
    nr = np.empty(n * 3)
    me.vertices.foreach_get("normal", nr)
    P, N = co.reshape(n, 3), nr.reshape(n, 3)
    fn = L.PROC.get(name)
    rgb = fn(P, N) if fn else np.full((n, 3), 0.2)
    rgb = np.clip(rgb, 0, None)
    rgb = rgb * np.minimum(1.0, L.MAX_LIN / np.maximum(rgb.max(1), 1e-6))[:, None]
    ca = me.color_attributes.new("paint", "FLOAT_COLOR", "POINT")
    ca.data.foreach_set("color", np.concatenate([rgb, np.ones((n, 1))], 1).astype(np.float32).ravel())
    m = bpy.data.materials.new(name + "_look")
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    a = nt.nodes.new("ShaderNodeVertexColor")
    a.layer_name = "paint"
    nt.links.new(a.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.35 if name in ("visor", "brooch_glass", "bow_caps") else 0.75
    me.materials.clear()
    me.materials.append(m)


def report(objs):
    tab = L.tabard_base()
    if "visor" in objs:
        wrap = [s for s in L.sculpts() if s[0] == "wrap"][0][1]
        mask = [s for s in L.sculpts() if s[0] == "mask"][0][1]
        v = np.array([tuple(x.co) for x in objs["visor"].data.vertices])
        dw = L._sdf_at(wrap, v)
        dm = L._sdf_at(mask, v)
        ends = np.abs(v[:, 0]) > L.VIS_XE - 0.004
        print(f"[look] visor: ends in wrap: max sdf {dw[ends].max() * 1000:+.1f} mm (want < 0); "
              f"min clearance from mask {dm.min() * 1000:+.1f} mm; front y {v[:, 1].min():.4f}")
    if "straps" in objs:
        v = np.array([tuple(x.co) for x in objs["straps"].data.vertices])
        d = L._sdf_at(tab, v)
        print(f"[look] straps over the tabard: min {d.min() * 1000:.1f} mm, max {d.max() * 1000:.1f} mm, "
              f"{len(objs['straps'].data.polygons)} faces")
    if "cowl" in objs:
        v = np.array([tuple(x.co) for x in objs["cowl"].data.vertices])
        d = L._sdf_at(tab, v)
        u = v[:, 2] - L.cowl_edge(v)
        low = (v[:, 2] < 1.53) & (u > 0)
        if "straps" in objs:
            cw = [s_ for s_ in L.sculpts() if s_[0] == "cowl"][0][1]
            sv = np.array([tuple(x.co) for x in objs["straps"].data.vertices])
            dc = L._sdf_at(cw, sv)
            print(f"[look] strap vertices inside the cowl: {int((dc < 0).sum())} (min {dc.min() * 1000:+.1f} mm)")
        print(f"[look] cowl drape over the tabard (z < 1.53): min {d[low].min() * 1000:.1f} mm; "
              f"cowl z {v[:, 2].min():.3f}..{v[:, 2].max():.3f}, {len(objs['cowl'].data.polygons)} faces")


def main():
    a = args()
    scene.reset()
    sc = bpy.context.scene
    col = scene.collection("look")
    only = set(a.only.split(","))
    objs = {}
    for name, S, vs, role, bind, tris, uvw in L.sculpts():
        if name not in only:
            continue
        if name == "visor":
            ob = L.visor_mesh(col)
        elif name == "straps":
            ob = L.strap_mesh(col)
        elif name == "string":
            ob = L.string_mesh(col)
        else:
            v, q = S.mesh(L.VOXEL * vs)
            ob = sdf.to_object(name, v, q, col)
            if a.low:
                mesh.decimate_to(ob, tris)
        bpy.ops.object.select_all(action="DESELECT")
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.shade_smooth()
        colour_attr(ob, name)
        objs[name] = ob
        print(f"[look] {name}: {len(ob.data.polygons)} faces")
    report(objs)
    sc.render.engine = "CYCLES"
    scene.cycles_device(sc)
    sc.cycles.samples = 24
    sc.cycles.use_denoising = False
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "Standard"
    w = bpy.data.worlds.new("w")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.42, 0.45, 0.50, 1.0)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
    key = bpy.data.lights.new("key", "SUN")
    key.energy = 3.2
    ko = bpy.data.objects.new("key", key)
    sc.collection.objects.link(ko)
    ko.rotation_euler = (math.radians(45), 0, math.radians(-35))
    cam = bpy.data.cameras.new("c")
    co = bpy.data.objects.new("c", cam)
    sc.collection.objects.link(co)
    sc.camera = co
    cam.type = "ORTHO"
    R = a.res
    sc.render.resolution_x = sc.render.resolution_y = R
    cells = []
    for vn in a.views.split(","):
        loc, tgt, osc = VIEWS[vn]
        co.location = loc
        co.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        cam.ortho_scale = osc
        path = os.path.join(scene.CACHE_DIR, "_fit", f"lisvel_look_{vn}.png")
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path)
        px = np.empty(R * R * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        cells.append(px.reshape(R, R, 4)[::-1, :, :3])
        bpy.data.images.remove(img)
    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, f"{a.out}.png")
    project.save_rgb(np.clip(np.concatenate(cells, axis=1), 0, 1), out)
    print(f"[look] wrote {out}")


main()
