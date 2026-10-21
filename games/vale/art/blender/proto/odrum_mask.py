"""Odrum head proto: meshes ONLY the carved head (mask + head block), the cap and the mouth-wrap from
fighters/odrum.py, decimates them to their build budgets and renders front / three-quarter / side / back
Workbench views, the front one blended over the concept's front plate on the same scale (alignment check:
every carved plane, void and crack should sit on its painted one).

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/odrum_mask.py -- \
        --out /tmp/odrum_mask.png [--parts cap,mask,neckwrap] [--size 520]
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
from common.hifi import sdf  # noqa: E402

import odrum  # noqa: E402

GAME = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    p.add_argument("--parts", default="cap,mask,neckwrap")
    p.add_argument("--size", type=int, default=520)
    p.add_argument("--zc", type=float, default=1.64)
    p.add_argument("--scale", type=float, default=0.46)
    a = p.parse_args(scene.script_args())
    want = a.parts.split(",")
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    col = bpy.context.scene.collection
    colors = {"cap": (0.55, 0.47, 0.40, 1), "mask": (0.86, 0.74, 0.55, 1), "neckwrap": (0.7, 0.66, 0.6, 1)}
    for name, S, vs, role, bind, tris in odrum.sculpts():
        if name not in want:
            continue
        v, q = S.mesh(odrum.VOXEL * vs)
        ob = sdf.to_object(name, v, q, col)
        n = mesh.decimate_to(ob, tris)
        ob.color = colors.get(name, (0.7, 0.7, 0.7, 1))
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
    tiles = []
    tmp = os.path.join(os.path.dirname(os.path.abspath(a.out)), "_om_tile.png")
    for yaw, pitch in ((0, 0), (30, 6), (90, 0), (180, 0), (0, 52)):
        y, pr = math.radians(yaw), math.radians(pitch)
        tgt = Vector((odrum.MX, -0.05, a.zc))
        loc = tgt + Vector((math.sin(y) * math.cos(pr), -math.cos(y) * math.cos(pr), math.sin(pr))) * 4.0
        cam.location = loc
        cam.rotation_euler = (tgt - loc).to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = tmp
        bpy.ops.render.render(write_still=True)
        im = bpy.data.images.load(tmp, check_existing=False)
        px = np.array(im.pixels[:], dtype=np.float32).reshape(a.size, a.size, 4)[::-1]
        bpy.data.images.remove(im)
        tiles.append(px)
    # the concept plate under the front view, same scale and centre
    import json
    meta = json.load(open(os.path.join(GAME, "art", ".cache", "concept", "odrum_plates.json")))
    pim = bpy.data.images.load(os.path.join(GAME, "art", ".cache", "concept", "odrum_front.png"))
    W, H = pim.size
    P = np.array(pim.pixels[:], dtype=np.float32).reshape(H, W, 4)[::-1]
    mpp = meta["m_per_px"]
    cx, gz = meta["front"]["cx"], meta["front"]["ground"]
    S = a.size
    xs = odrum.MX + (np.arange(S) + 0.5 - S / 2) / S * a.scale
    zs = a.zc - (np.arange(S) + 0.5 - S / 2) / S * a.scale
    pxs = np.clip((cx + xs / mpp).astype(int), 0, W - 1)
    pys = np.clip((gz - zs / mpp).astype(int), 0, H - 1)
    plate = P[pys[:, None], pxs[None, :], :3]
    f = tiles[0]
    al = f[..., 3:4]
    over = plate * (1 - al * 0.55) + f[..., :3] * al * 0.55
    edge = np.zeros(al.shape[:2], dtype=bool)
    m = al[..., 0] > 0.5
    edge[1:, :] |= m[1:, :] != m[:-1, :]
    edge[:, 1:] |= m[:, 1:] != m[:, :-1]
    over[edge] = (0.1, 0.9, 1.0)
    over_t = np.concatenate([over, np.ones_like(al)], axis=2)
    bg = np.ones((S, S, 4), dtype=np.float32) * np.array([0.82, 0.82, 0.80, 1.0], dtype=np.float32)
    row = []
    for t in tiles:
        row.append(bg * (1 - t[..., 3:4]) + np.concatenate([t[..., :3], np.ones_like(t[..., 3:4])], 2) * t[..., 3:4])
    row.append(over_t)
    G = np.concatenate([np.concatenate(row[:3], 1), np.concatenate(row[3:], 1)], 0)
    img = bpy.data.images.new("om", G.shape[1], G.shape[0], alpha=True)
    img.pixels[:] = G[::-1].ravel()
    img.filepath_raw = os.path.abspath(a.out)
    img.file_format = "PNG"
    img.save()
    if os.path.isfile(tmp):
        os.remove(tmp)
    print("saved", a.out)


main()
