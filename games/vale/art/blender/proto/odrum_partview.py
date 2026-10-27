"""Odrum part proto: meshes the chosen parts from fighters/odrum.py (sculpts()), decimates each to its build budget
and renders Workbench views (cavity on) around a point: a quick look at a fist, a pot, the head's back before a build.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/odrum_partview.py -- \
        --out /tmp/fist.png --parts hand_L,wrap_L --center 0.28,-0.03,0.84 --scale 0.24 --views 0:0,60:10,90:0,200:20

A view is yaw:pitch (yaw 0 = in front, + = toward the character's left, as render.orbit). `--lanterns` meshes the
Noon Fair lantern variant. Colours are per part (cavity shading shows the carving).
"""
from __future__ import annotations

import argparse
import colorsys
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
from common.hifi import sdf  # noqa: E402

import odrum  # noqa: E402


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    p.add_argument("--parts", required=True)
    p.add_argument("--center", default="0,0,1.0")
    p.add_argument("--scale", type=float, default=0.3)
    p.add_argument("--views", default="0:0,45:8,90:0,180:0")
    p.add_argument("--size", type=int, default=420)
    p.add_argument("--lanterns", action="store_true")
    a = p.parse_args(scene.script_args())
    want = a.parts.split(",")
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    col = bpy.context.scene.collection
    i = 0
    for name, S, vs, role, bind, tris in odrum.sculpts(a.lanterns):
        if not any(name == w or (w.endswith("*") and name.startswith(w[:-1])) for w in want):
            continue
        v, q = S.mesh(odrum.VOXEL * vs)
        ob = sdf.to_object(name, v, q, col)
        n = mesh.decimate_to(ob, tris)
        h = (i * 0.17) % 1.0
        r, g, b = colorsys.hsv_to_rgb(h, 0.25, 0.85)
        if role in ("accent",):
            r, g, b = 0.25, 0.5, 0.95
        ob.color = (r, g, b, 1)
        i += 1
        print(f"{name}: {n} tris")
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.color_type = "OBJECT"
    sh.show_cavity = True
    sh.cavity_type = "BOTH"
    sh.show_shadows = True
    sc.render.resolution_x = sc.render.resolution_y = a.size
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.view_settings.view_transform = "Standard"
    cd = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cd)
    col.objects.link(cam)
    sc.camera = cam
    cd.type = "ORTHO"
    cd.ortho_scale = a.scale
    tgt = Vector(tuple(float(x) for x in a.center.split(",")))
    tiles = []
    tmp = os.path.abspath(a.out) + "_tile.png"
    for vw in a.views.split(","):
        yaw, pitch = (float(x) for x in vw.split(":"))
        y, pr = math.radians(yaw), math.radians(pitch)
        loc = tgt + Vector((math.sin(y) * math.cos(pr), -math.cos(y) * math.cos(pr), math.sin(pr))) * 4.0
        cam.location = loc
        cam.rotation_euler = (tgt - loc).to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = tmp
        bpy.ops.render.render(write_still=True)
        im = bpy.data.images.load(tmp, check_existing=False)
        px = np.array(im.pixels[:], dtype=np.float32).reshape(a.size, a.size, 4)
        bpy.data.images.remove(im)
        bg = np.array([0.82, 0.82, 0.80, 1.0], dtype=np.float32)
        px = bg * (1 - px[..., 3:4]) + np.concatenate([px[..., :3], np.ones_like(px[..., 3:4])], 2) * px[..., 3:4]
        px[:, :2, :3] = 0.3
        tiles.append(px)
    G = np.concatenate(tiles, axis=1)
    img = bpy.data.images.new("opv", G.shape[1], G.shape[0], alpha=True)
    img.pixels[:] = G.ravel()
    img.filepath_raw = os.path.abspath(a.out)
    img.file_format = "PNG"
    img.save()
    if os.path.isfile(tmp):
        os.remove(tmp)
    print("saved", a.out)


main()
