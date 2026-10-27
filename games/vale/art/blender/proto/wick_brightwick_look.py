"""brightwick look check: the GAME mesh (rig, sculpt, lows, binding: no bake, no export) in flat palette colours
(Workbench, studio light + cavity), so forms read fast while the sculpt is iterated: front / 3-4 / side / back /
3-4 back at eye level, the 52 deg gameplay camera (orthographic, facings 0 / 45 / 90 / 180 at 4x the 1080p
pixel scale, plus facing 0 at the true 1080p size), and close-ups of the hood, the lantern and a pauldron.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/wick_brightwick_look.py \
        -- [--faction aubade|serenade|both] [--pose guard|rest|paint|<clip>:<frame>] [--out DIR]

Writes <out>/look_brightwick_<faction>[_<pose>].png (default out: art/.cache/brightwick_look).
"""
from __future__ import annotations

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

CELL = 420


def args():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--faction", default="both")
    p.add_argument("--pose", default="guard")
    p.add_argument("--out", default=os.path.join(scene.CACHE_DIR, "brightwick_look"))
    return p.parse_args(scene.script_args())


def build(fac: str):
    spec = bw.Brightwick(fac)
    scene.reset()
    col = scene.collection(spec.ID)
    ctx = fighter.Context(spec=spec, col=col, skin=None, args=None, timer=scene.Timer(spec.ID))
    ctx.palette = dict(spec.PALETTE)
    ctx.info = rig.build_rig(spec.PROPORTIONS, name=f"{spec.ID}_rig", col=col)
    if hasattr(spec, "rig_extras"):
        spec.rig_extras(ctx)
    ctx.gradient = pipeline._gradient(spec)
    ctx.mats = materials.bible_set(ctx.palette, ctx.gradient)
    parts = spec.model(ctx)
    body, accent, highs, src, st = pipeline.prepare_lows(ctx, parts)
    tris = sum(v for k, v in st.items() if k.startswith("tris_"))
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o not in (body, accent):
            o.hide_render = True
    # per-part flat colour: the role palette, the module's part colours
    names = [p.name for p in parts]
    me = body.data
    from common.hifi import project
    pop = project.poly_parts(me, "vale_part")
    mats = {}
    me.materials.clear()
    for i, nm in enumerate(names):
        role = spec.parts_info.get(nm, ("cloth", None))[0]
        hx = bw.PART_HEX[fac].get(nm) or spec.PALETTE.get(role, "#808080")
        m = bpy.data.materials.new(f"flat_{nm}")
        m.diffuse_color = (*[c ** 2.2 for c in scene.hex_srgb(hx)], 1.0)
        me.materials.append(m)
        mats[i] = len(me.materials) - 1
    idx = np.array([mats.get(int(k), 0) for k in pop], dtype=np.int32)
    me.polygons.foreach_set("material_index", idx)
    if accent is not None:
        for m in accent.data.materials:
            m.diffuse_color = (0.25, 0.6, 1.0, 1.0)
    return spec, ctx, body, accent, tris, st


def setup():
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.color_type = "MATERIAL"
    sh.show_shadows = True
    sh.show_cavity = True
    sh.cavity_type = "BOTH"
    sc.render.resolution_x = sc.render.resolution_y = CELL
    sc.render.film_transparent = False
    bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0))
    pl = bpy.context.active_object
    m = bpy.data.materials.new("ground")
    m.diffuse_color = (0.55, 0.53, 0.48, 1)
    pl.data.materials.append(m)
    cd = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    return cam


def aim(cam, yaw, pitch, tgt, dist=None, ortho=None, lens=60):
    t = Vector(tgt)
    a, p = math.radians(yaw), math.radians(pitch)
    d = Vector((math.sin(a) * math.cos(p), -math.cos(a) * math.cos(p), math.sin(p)))
    if ortho:
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = ortho
        cam.location = t + d * 20.0
    else:
        cam.data.type = "PERSP"
        cam.data.lens = lens
        cam.location = t + d * dist
    cam.rotation_euler = (t - cam.location).to_track_quat("-Z", "Y").to_euler()


def render(path, res=CELL):
    sc = bpy.context.scene
    sc.render.resolution_x = sc.render.resolution_y = res
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    im = bpy.data.images.load(path)
    px = np.array(im.pixels[:], dtype=np.float32).reshape(res, res, 4)
    bpy.data.images.remove(im)
    return px


def main():
    a = args()
    os.makedirs(a.out, exist_ok=True)
    facs = ("aubade", "serenade") if a.faction == "both" else (a.faction,)
    for fac in facs:
        spec, ctx, body, accent, tris, st = build(fac)
        arm = ctx.info.armature
        skel = anim.Skeleton(arm)
        if a.pose == "guard":
            pose = bw.guard_pose()
        elif a.pose == "paint":
            pose = bw.paint_pose(spec)
        elif a.pose == "rest":
            pose = {}
        else:
            cn, fr = a.pose.split(":")
            cl = bw.clips(spec, skel, ctx)[cn]
            pose = cl.sample(float(fr) / cl.frames)
        anim.apply_pose(arm, anim.resolve(skel, pose) if pose else {})
        cam = setup()
        tiles = []
        tmp = os.path.join(a.out, "_tmp.png")
        for yaw, pitch in ((0, 6), (35, 10), (90, 6), (180, 6), (215, 12)):
            aim(cam, yaw, pitch, (0, 0, 0.88), dist=5.2, lens=60)
            tiles.append(render(tmp))
        # gameplay camera: 52 deg, orthographic, 4x the 1080p scale (50.5 px/m -> 202 px/m)
        for f in (0, 45, 90, 180):
            aim(cam, f, 52, (0, 0, 0.85), ortho=CELL / 202.0)
            tiles.append(render(tmp))
        # true size (1080p: 50.5 px/m), upscaled 4x nearest for viewing
        aim(cam, 0, 52, (0, 0, 0.85), ortho=CELL / 4 / 50.5 * 1.0)
        small = render(tmp, CELL // 4)
        tiles.append(np.repeat(np.repeat(small, 4, 0), 4, 1))
        # close-ups: hood front, hood game cam, lantern, pauldron
        hood_z = 1.48
        aim(cam, 0, 4, (0, -0.1, hood_z), dist=1.6, lens=60)
        tiles.append(render(tmp))
        aim(cam, 0, 52, (0, -0.05, hood_z - 0.05), ortho=0.75)
        tiles.append(render(tmp))
        lam = None
        if accent is not None:
            dg = bpy.context.evaluated_depsgraph_get()
            e = accent.evaluated_get(dg)
            mm = e.to_mesh()
            co = np.array([e.matrix_world @ v.co for v in mm.vertices])
            names = [g.name for g in accent.vertex_groups]
            dom = []
            for v in accent.data.vertices:
                dom.append(names[max(v.groups, key=lambda g: g.weight).group] if v.groups else "")
            e.to_mesh_clear()
            m = np.array(dom) == "prop.R"
            if m.any():
                lam = co[m].mean(0)
        if lam is not None:
            aim(cam, 20, 12, tuple(lam), dist=1.1, lens=60)
            tiles.append(render(tmp))
        px = 0.30 * (1 if fac == "aubade" else 1.15)
        aim(cam, -40, 18, (-px, 0.0, 1.28), dist=1.3, lens=60)
        tiles.append(render(tmp))
        aim(cam, 0, 6, (0, -0.1, 1.10), dist=1.6, lens=60)
        tiles.append(render(tmp))
        cols = 5
        rows = (len(tiles) + cols - 1) // cols
        sheet = np.zeros((rows * CELL, cols * CELL, 4), dtype=np.float32)
        for i, t in enumerate(tiles):
            r, c = divmod(i, cols)
            y0 = (rows - 1 - r) * CELL
            sheet[y0:y0 + CELL, c * CELL:(c + 1) * CELL] = t
        out = bpy.data.images.new("sheet", cols * CELL, rows * CELL)
        out.pixels.foreach_set(sheet.ravel())
        tag = "" if a.pose == "guard" else "_" + a.pose.replace(":", "")
        out.filepath_raw = os.path.join(a.out, f"look_brightwick_{fac}{tag}.png")
        out.file_format = "PNG"
        out.save()
        print("LOOK", fac, "tris", tris, {k[5:]: v for k, v in st.items() if k.startswith("tris_")})
        print("SHEET", out.filepath_raw)


main()
