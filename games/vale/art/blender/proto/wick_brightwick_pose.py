"""brightwick pose check: builds the GAME mesh (rig, sculpt, lows, binding: no bake, no export), runs the module's
clips (death ground-solved exactly as the build does) and reports, per clip, the lowest body / prop vertex, the
lantern centre and the feet; renders a Workbench frame strip per clip over an opaque ground plane (palette
colours, 3/4 view), so penetration, the cloak in the run and the slam's reach read at a glance.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/wick_brightwick_pose.py \
        -- [--faction aubade|serenade|both] [--out DIR] [--clips run,attack1,death]

Writes <out>/pose_brightwick_<faction>.png (rows = clips) + .json (default out: art/.cache/brightwick_pose).
"""
from __future__ import annotations

import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "units"))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

from common import anim, fighter, materials, pipeline, rig, scene  # noqa: E402

import wick_brightwick as bw  # noqa: E402

FRAMES = {"idle": [0, 20, 40, 60], "run": [0, 2, 4, 6, 8, 10, 12], "attack1": [0, 6, 9, 11, 12, 14, 18, 24],
          "death": [0, 8, 16, 22, 28, 36, 44, 50, 56, 60]}
VIEWS = {"run": [(35, 12), (90, 10)], "attack1": [(70, 12)], "death": [(40, 30), (-60, 20)], "idle": [(30, 15)]}


def args():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--faction", default="both")
    p.add_argument("--out", default=os.path.join(scene.CACHE_DIR, "brightwick_pose"))
    p.add_argument("--clips", default="run,attack1,death")
    return p.parse_args(scene.script_args())


def build(fac: str):
    spec = bw.Brightwick(fac)
    scene.reset()
    col = scene.collection(spec.ID)
    ctx = fighter.Context(spec=spec, col=col, skin=None, args=None, timer=scene.Timer(spec.ID))
    ctx.palette = dict(spec.PALETTE)
    ctx.info = rig.build_rig(spec.PROPORTIONS, name=f"{spec.ID}_rig", col=col)
    ctx.gradient = pipeline._gradient(spec)
    ctx.mats = materials.bible_set(ctx.palette, ctx.gradient)
    parts = spec.model(ctx)
    body, accent, highs, src, st = pipeline.prepare_lows(ctx, parts)
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o not in (body, accent):
            o.hide_render = True
    body.name = spec.ID
    if accent is not None:
        accent.name = f"{spec.ID}_accent"
    for m in body.data.materials:
        role = m.name.split(".")[0]
        h = spec.PALETTE.get(role)
        if h:
            m.diffuse_color = (*[c ** 2.2 for c in scene.hex_srgb(h)], 1.0)
    if accent is not None:
        for m in accent.data.materials:
            m.diffuse_color = (0.25, 0.6, 1.0, 1.0)
    return spec, ctx, body, accent


def world_co(o):
    dg = bpy.context.evaluated_depsgraph_get()
    e = o.evaluated_get(dg)
    me = e.to_mesh()
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    mw = np.array(e.matrix_world)
    e.to_mesh_clear()
    return co.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3]


def dominant(o):
    names = [g.name for g in o.vertex_groups]
    out = []
    for v in o.data.vertices:
        out.append(names[max(v.groups, key=lambda g: g.weight).group] if v.groups else "")
    return np.array(out)


def setup_render(res=(360, 400)):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.color_type = "MATERIAL"
    sh.show_shadows = True
    sc.render.resolution_x, sc.render.resolution_y = res
    bpy.ops.mesh.primitive_plane_add(size=8, location=(0, 0, 0))
    pl = bpy.context.active_object
    m = bpy.data.materials.new("ground")
    m.diffuse_color = (0.42, 0.42, 0.40, 1)
    pl.data.materials.append(m)
    cd = bpy.data.cameras.new("cam")
    cd.lens = 50
    cam = bpy.data.objects.new("cam", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    return cam


def aim_cam(cam, yaw, pitch, dist=3.3, tgt=(0, -0.25, 0.7)):
    t = Vector(tgt)
    a, p = math.radians(yaw), math.radians(pitch)
    d = Vector((math.sin(a) * math.cos(p), -math.cos(a) * math.cos(p), math.sin(p)))
    cam.location = t + d * dist
    cam.rotation_euler = (t - cam.location).to_track_quat("-Z", "Y").to_euler()


def main():
    a = args()
    os.makedirs(a.out, exist_ok=True)
    facs = ("aubade", "serenade") if a.faction == "both" else (a.faction,)
    for fac in facs:
        spec, ctx, body, accent = build(fac)
        arm = ctx.info.armature
        skel = anim.Skeleton(arm)
        cl = bw.clips(spec, skel, ctx)
        objs = [body] + ([accent] if accent else [])
        doms = [dominant(o) for o in objs]
        cam = setup_render()
        rep = {}
        tiles = []
        for name in a.clips.split(","):
            c = cl[name]
            rows = []
            for f in range(c.frames + 1):
                anim.apply_pose(arm, anim.resolve(skel, c.sample(f / c.frames)))
                cos = [world_co(o) for o in objs]
                allco = np.concatenate(cos)
                dom = np.concatenate(doms)
                prop = dom == "prop.R"
                lamp = cos[1][doms[1] == "prop.R"].mean(0) if accent is not None and (doms[1] == "prop.R").any() else [0, 0, 0]
                head = cos[1][doms[1] == "head"].mean(0) if accent is not None else [0, 0, 0]
                rows.append({"f": f, "body_min": round(float(allco[~prop, 2].min()), 3),
                             "prop_min": round(float(allco[prop, 2].min()), 3) if prop.any() else None,
                             "lamp": [round(float(x), 3) for x in lamp], "head_acc": [round(float(x), 3) for x in head],
                             "top": round(float(allco[:, 2].max()), 3)})
            rep[name] = rows
            for yaw, pitch in VIEWS.get(name, [(30, 15)]):
                aim_cam(cam, yaw, pitch)
                for f in FRAMES[name]:
                    if f > c.frames:
                        continue
                    anim.apply_pose(arm, anim.resolve(skel, c.sample(f / c.frames)))
                    p = os.path.join(a.out, f"_t_{fac}_{name}_{yaw}_{f:02d}.png")
                    bpy.context.scene.render.filepath = p
                    bpy.ops.render.render(write_still=True)
                    tiles.append((f"{name}_{yaw}", p))
        anim.apply_pose(arm, {})
        with open(os.path.join(a.out, f"pose_brightwick_{fac}.json"), "w") as fh:
            json.dump(rep, fh, indent=1)
        # contact sheet
        rows_ = {}
        for key, p in tiles:
            rows_.setdefault(key, []).append(p)
        imgs = {k: [bpy.data.images.load(p) for p in v] for k, v in rows_.items()}
        W = max(len(v) for v in imgs.values()) * 360
        H = len(imgs) * 400
        sheet = np.zeros((H, W, 4), dtype=np.float32)
        for r, (k, ims) in enumerate(imgs.items()):
            for c_, im in enumerate(ims):
                px = np.array(im.pixels[:], dtype=np.float32).reshape(400, 360, 4)
                y0 = H - (r + 1) * 400
                sheet[y0:y0 + 400, c_ * 360:(c_ + 1) * 360] = px
        out = bpy.data.images.new("sheet", W, H)
        out.pixels.foreach_set(sheet.ravel())
        out.filepath_raw = os.path.join(a.out, f"pose_brightwick_{fac}.png")
        out.file_format = "PNG"
        out.save()
        for k, v in rep.items():
            print(fac, k, "body_min", min(r_["body_min"] for r_ in v), "prop_min",
                  min((r_["prop_min"] for r_ in v if r_["prop_min"] is not None), default=None))
        print("SHEET", out.filepath_raw)


main()
