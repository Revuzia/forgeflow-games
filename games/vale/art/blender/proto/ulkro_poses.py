"""Ulkro pose preview: re-runs fighters/ulkro.py clip_overrides on the CACHED build (art/.cache/fighters/ulkro.blend)
and renders real-mesh stills (Workbench, the baked texture) of clip frames from any angle, in one grid.

    /Applications/Blender.app/Contents/MacOS/Blender -b art/.cache/fighters/ulkro.blend --python \
        art/blender/proto/ulkro_poses.py -- --out grid.png --shots victory@0.92@30@5,cast_ult@18@90@8 [--size 360]

A shot is clip@frame@yaw@pitch (frame: an int frame, or a float in [0,1) = clip fraction; yaw 0 = in front,
+ = toward the character's left, as render.orbit; pitch in degrees, 52 = the game camera). `--row N` puts N
shots per row. `--frames clip:yaw:pitch:n` adds n evenly spaced frames of a clip. Orthographic, 2.8 m tall.
The rest pose must match the cache (rig_extras unchanged since the last full build)."""
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
from common import anim, scene  # noqa: E402

import ulkro  # noqa: E402


class Ctx:
    pass


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    p.add_argument("--shots", default="")
    p.add_argument("--frames", default="", help="clip:yaw:pitch:n[;clip:yaw:pitch:n]")
    p.add_argument("--size", type=int, default=360)
    p.add_argument("--row", type=int, default=6)
    p.add_argument("--scale", type=float, default=2.8, help="ortho height (m)")
    p.add_argument("--zc", type=float, default=0.95, help="camera target height (m)")
    a = p.parse_args(scene.script_args())
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    ctx = Ctx()
    ctx.info = Ctx()
    ctx.info.armature = arm
    overrides = ulkro.clip_overrides(ctx)
    skel = anim.Skeleton(arm)
    clips = anim.standard_clips(skel, ulkro.MOTION, overrides)
    shots = []
    for s in [x for x in a.shots.split(",") if x]:
        c, f, yw, pt = s.split("@")
        shots.append((c, f, float(yw), float(pt)))
    for s in [x for x in a.frames.split(";") if x]:
        c, yw, pt, n = s.split(":")
        n = int(n)
        for i in range(n):
            shots.append((c, "%.4f" % (i / max(1, n - 1) * 0.999), float(yw), float(pt)))
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.color_type = "TEXTURE"
    sh.show_cavity = False
    sh.show_shadows = False
    sc.render.resolution_x = sc.render.resolution_y = a.size
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = "PNG"
    sc.view_settings.view_transform = "Standard"
    try:
        sc.world.color = (0.82, 0.82, 0.80)
    except AttributeError:
        pass
    for o in bpy.data.objects:
        if o.type == "MESH" and not any(m.type == "ARMATURE" for m in o.modifiers):
            o.hide_render = True
    cd = bpy.data.cameras.new("pp_cam")
    cam = bpy.data.objects.new("pp_cam", cd)
    sc.collection.objects.link(cam)
    sc.camera = cam
    cd.type = "ORTHO"
    cd.ortho_scale = a.scale
    cache = {}
    tiles = []
    tmp = os.path.join(os.path.dirname(os.path.abspath(a.out)), "_pp_tile.png")
    for (c, f, yw, pt) in shots:
        clip = clips[c]
        if c not in cache:
            cache[c] = anim.sample_clip(skel, clip, None)
        poses = cache[c]
        fi = int(round(float(f) * clip.frames)) if "." in f else int(f)
        fi = max(0, min(len(poses) - 1, fi))
        anim.apply_pose(arm, poses[fi])
        for i in range(len(ulkro.CREST)):                 # the death's crest slide (location keys, not in the pose)
            pb = arm.pose.bones.get(f"x_crest{i}")
            if pb is not None:
                pb.location = ulkro.crest_slide(i, fi / max(1, clip.frames)) if c == "death" else (0.0, 0.0, 0.0)
        bpy.context.view_layer.update()
        y, pr = math.radians(yw), math.radians(pt)
        tgt = Vector((0.0, 0.0, a.zc))
        loc = tgt + Vector((math.sin(y) * math.cos(pr), -math.cos(y) * math.cos(pr), math.sin(pr))) * 8.0
        cam.location = loc
        cam.rotation_euler = (tgt - loc).to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = tmp
        bpy.ops.render.render(write_still=True)
        im = bpy.data.images.load(tmp, check_existing=False)
        px = np.array(im.pixels[:], dtype=np.float32).reshape(a.size, a.size, 4)
        bpy.data.images.remove(im)
        px[:4, :, :3] = 0.3
        tiles.append(px)
        print(f"shot {c} f{fi} yaw {yw} pitch {pt}")
    n = len(tiles)
    cols = min(a.row, n)
    rows = (n + cols - 1) // cols
    G = np.ones((rows * a.size, cols * a.size, 4), dtype=np.float32)
    for i, t in enumerate(tiles):
        r, cc = i // cols, i % cols
        # bpy pixel rows run bottom-up: stack rows from the top of the image
        y0 = (rows - 1 - r) * a.size
        G[y0:y0 + a.size, cc * a.size:(cc + 1) * a.size] = t
    img = bpy.data.images.new("pp_grid", cols * a.size, rows * a.size, alpha=True)
    img.pixels[:] = G.ravel()
    img.filepath_raw = os.path.abspath(a.out)
    img.file_format = "PNG"
    img.save()
    if os.path.isfile(tmp):
        os.remove(tmp)
    print("grid", a.out, cols * a.size, rows * a.size)


main()
