"""Rishal head preview straight from the SDF sculpt (no build): the helmet parts (HEAD_PARTS + neck, cowl) meshed at
the build voxel, coloured per vertex with rishal.head_preview_colour (the procedural head paint the build uses, the
role colour elsewhere), rendered from the front, his left three-quarter, his left side, the back and the game camera.

    blender -b --factory-startup --python art/blender/proto/rishal_head.py -- [--parts extra,parts] [--out <png>]
        [--cell 420] [--views q3,side] [--ortho 0.62]
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
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "fighters"))
from common import scene  # noqa: E402
from common.hifi import sdf  # noqa: E402


def args():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--parts", default="")
    p.add_argument("--cell", type=int, default=420)
    p.add_argument("--skin", default="")
    p.add_argument("--views", default="", help="a subset of front,q3,side,back,q3back,game,gamef")
    p.add_argument("--ortho", type=float, default=0.62)
    p.add_argument("--custom", default="", help="extra views name:yaw:pitch[,...] (e.g. portrait:36:6)")
    p.add_argument("--target", default="0,0,1.66", help="the views' target x,y,z (m)")
    p.add_argument("--only", action="store_true", help="only the --parts (not the helmet)")
    p.add_argument("--out", default=os.path.join(scene.RENDERS_DIR, "fighters", "rishal", "_fit", "head.png"))
    return p.parse_args(scene.script_args())


def hexrgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], dtype=np.float32)


def main():
    a = args()
    import rishal as R
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    skin = next((s for s in R.SKINS if s["id"] == a.skin), None) if a.skin else None
    pal = dict(R.PALETTE)
    if skin:
        pal.update(skin["palette"])
    want = set(x for x in a.parts.split(",") if x)
    if not a.only:
        want |= set(R.HEAD_PARTS) | {"neck", "cowl", "visor_ridge"}
    items = [s for s in R.sculpts() if s[0] in want]
    if skin:
        items += [s for s in R.skin_extras(skin.get("extra") or {}) if s[0] in want or True]
    mat = bpy.data.materials.new("vc")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    ca = nt.nodes.new("ShaderNodeVertexColor")
    ca.layer_name = "col"
    nt.links.new(ca.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.55
    for name, S, vs, role, bind, tris in items:
        v, q = S.mesh(R.VOXEL * vs)
        ob = sdf.to_object(name, v, q, sc.collection)
        me = ob.data
        n = np.zeros_like(v)
        for f in q:                                   # vertex normals from the quads
            p0, p1, p2 = v[f[0]], v[f[1]], v[f[2]]
            fn = np.cross(p1 - p0, p2 - p0)
            n[list(f)] += fn
        n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
        col = R.head_preview_colour(name, v, n, pal, role, skin)
        att = me.color_attributes.new("col", "FLOAT_COLOR", "POINT")
        rgba = np.ones((len(v), 4), dtype=np.float32)
        rgba[:, :3] = np.asarray(col, dtype=np.float32) ** 2.2
        att.data.foreach_set("color", rgba.ravel())
        me.materials.append(mat)
    sc.render.engine = "BLENDER_EEVEE"
    sc.view_settings.view_transform = "Standard"
    w = bpy.data.worlds.new("w")
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.55, 0.56, 0.58, 1)
    bg.inputs["Strength"].default_value = 0.9
    key = bpy.data.lights.new("key", "SUN")
    key.energy = 2.6
    ko = bpy.data.objects.new("key", key)
    sc.collection.objects.link(ko)
    ko.rotation_euler = (math.radians(40), 0, math.radians(-150))
    cam = bpy.data.cameras.new("c")
    co = bpy.data.objects.new("c", cam)
    sc.collection.objects.link(co)
    sc.camera = co
    cam.type = "ORTHO"
    cam.ortho_scale = a.ortho
    sc.render.resolution_x = sc.render.resolution_y = a.cell
    sc.render.film_transparent = False
    tgt = Vector(tuple(float(v) for v in a.target.split(",")))
    views = [("front", 0, 0), ("q3", 35, 5), ("side", 90, 0), ("back", 180, 5), ("q3back", 140, 10), ("game", 25, 52), ("gamef", 0, 52),
             ("games", 90, 52), ("gameb", 180, 52), ("gamer", 270, 52)]
    if a.views:
        views = [v for v in views if v[0] in a.views.split(",")]
    for c_ in (x for x in a.custom.split(",") if x):
        nm_, yw_, pt_ = c_.split(":")
        views.append((nm_, float(yw_), float(pt_)))
    paths = []
    for nm, yaw, pitch in views:
        y, p = math.radians(yaw), math.radians(pitch)
        d = Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))
        co.location = tgt + d * 3.0
        co.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        path = os.path.join(os.path.dirname(a.out), f"_head_{nm}.png")
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        paths.append(path)
    ims = []
    for pth in paths:
        im = bpy.data.images.load(pth)
        px = np.empty(im.size[0] * im.size[1] * 4, dtype=np.float32)
        im.pixels.foreach_get(px)
        ims.append(px.reshape(im.size[1], im.size[0], 4))
        bpy.data.images.remove(im)
        os.remove(pth)
    strip = np.concatenate(ims, axis=1)
    out = bpy.data.images.new("strip", strip.shape[1], strip.shape[0], alpha=True)
    out.pixels.foreach_set(strip.ravel())
    out.filepath_raw = a.out
    out.file_format = "PNG"
    out.save()
    print("[rishal_head]", a.out)


if __name__ == "__main__":
    main()
