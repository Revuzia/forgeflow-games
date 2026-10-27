"""Rishal accent-share estimate straight from the SDF sculpt (no build): every part meshed at the build voxel in the
rest pose, the accent parts flat white and the rest flat grey, rendered orthographic at the game camera's pitch
(52 degrees) from 8 facings; prints the accent share of the silhouette per facing and the mean (the three QA's
accentPct measures the same at idle frame 0, so the rest pose reads a little lower: the knives sit wider in idle).

    blender -b --factory-startup --python art/blender/proto/rishal_accent.py -- [--res 240] [--skip knife_blade_R,...]
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


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--res", type=int, default=240)
    ap.add_argument("--vs", type=float, default=1.6, help="voxel scale over the build's (coarser = faster)")
    a = ap.parse_args(scene.script_args())
    import rishal as R
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    mats = {}
    for nm, c in (("acc", (1.0, 1.0, 1.0, 1.0)), ("body", (0.5, 0.5, 0.5, 1.0))):
        m = bpy.data.materials.new(nm)
        m.use_nodes = True
        nt = m.node_tree
        for nd in list(nt.nodes):
            nt.nodes.remove(nd)
        em = nt.nodes.new("ShaderNodeEmission")
        em.inputs["Color"].default_value = c
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(em.outputs[0], out.inputs[0])
        mats[nm] = m
    for name, S, vs, role, bind, tris in R.sculpts():
        v, q = S.mesh(R.VOXEL * vs * (1.0 if getattr(S, "low", False) else a.vs))
        if len(v) == 0:
            continue
        ob = sdf.to_object(name, v, q, sc.collection)
        ob.data.materials.append(mats["acc" if role == "accent" else "body"])
    sc.render.engine = "BLENDER_EEVEE"
    sc.view_settings.view_transform = "Standard"
    w = bpy.data.worlds.new("w")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0, 0, 0, 1)
    cam = bpy.data.cameras.new("c")
    cam.type = "ORTHO"
    cam.ortho_scale = 2.3
    co = bpy.data.objects.new("c", cam)
    sc.collection.objects.link(co)
    sc.camera = co
    sc.render.resolution_x = sc.render.resolution_y = a.res
    tgt = Vector((0.0, 0.0, 0.95))
    shares = []
    for i in range(8):
        yaw = math.radians(45.0 * i)
        p = math.radians(52.0)
        d = Vector((math.sin(yaw) * math.cos(p), -math.cos(yaw) * math.cos(p), math.sin(p)))
        co.location = tgt + d * 10.0
        co.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        path = os.path.join(bpy.app.tempdir or "/tmp", f"_acc_{i}.png")
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        im = bpy.data.images.load(path)
        px = np.empty(im.size[0] * im.size[1] * 4, dtype=np.float32)
        im.pixels.foreach_get(px)
        bpy.data.images.remove(im)
        os.remove(path)
        r = px.reshape(-1, 4)[:, 0]
        body, acc = int((r > 0.15).sum()), int((r > 0.8).sum())
        shares.append(100.0 * acc / max(1, body))
    print("[rishal_accent] by facing (0..315 step 45):", " ".join(f"{s:.2f}" for s in shares),
          f"| mean {np.mean(shares):.2f} %")


if __name__ == "__main__":
    main()
