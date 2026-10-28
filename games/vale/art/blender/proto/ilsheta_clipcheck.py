"""Ilsheta clip check: re-runs fighters/ilsheta.py clip_overrides on the CACHED skinned build
(art/.cache/fighters/ilsheta.blend), renders key frames of every clip with Workbench (the baked base colour) from two
cameras, and measures the held props against the body on the deformed mesh, in about a minute instead of a build.

    /Applications/Blender.app/Contents/MacOS/Blender -b art/.cache/fighters/ilsheta.blend --python \\
        art/blender/proto/ilsheta_clipcheck.py -- [--clips cast_a1,attack1] [--frames 0,0.2,0.4,0.6,0.8,1]

Writes art/renders/fighters/ilsheta/_clips/<clip>_<i>_<cam>.png (assemble with --sheet in the venv:
    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/ilsheta_clipcheck.py --sheet)
Per frame it prints the lowest body point, the lamp's lowest point and the count of body vertices inside the staff's
and the lamp's reach (penetration). The rest pose must match the cache (rig_extras unchanged since the last build).
"""
from __future__ import annotations

import argparse
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(os.path.dirname(HERE)), "renders", "fighters", "ilsheta", "_clips")
CLIPS = ["idle", "run", "attack1", "attack2", "crit", "cast_a1", "cast_a2", "cast_a3", "cast_ult", "death", "recall",
         "idle_lobby", "victory", "dash", "stunned", "channel", "taunt"]


def sheet():
    from PIL import Image, ImageDraw
    files = sorted(f for f in os.listdir(OUT) if f.endswith(".png") and not f.startswith("sheet"))
    clips = [c for c in CLIPS if any(f.startswith(c + "_") for f in files)]
    cams = ("a", "b")
    cell = 260
    for cam in cams:
        rows = []
        for c in clips:
            fr = sorted({f.split("_")[-2] for f in files if f.startswith(c + "_") and f.endswith(f"_{cam}.png")
                         and f[len(c) + 1:].count("_") == 1}, key=int)
            rows.append((c, fr))
        W = max(len(fr) for _, fr in rows) * cell + 90
        im = Image.new("RGB", (W, len(rows) * cell), (30, 32, 38))
        d = ImageDraw.Draw(im)
        for r, (c, fr) in enumerate(rows):
            d.text((4, r * cell + 4), c, fill=(255, 255, 255))
            for i, f in enumerate(fr):
                t = Image.open(os.path.join(OUT, f"{c}_{f}_{cam}.png")).convert("RGB").resize((cell, cell))
                im.paste(t, (90 + i * cell, r * cell))
        im.save(os.path.join(OUT, f"sheet_{cam}.png"))
        print("wrote", os.path.join(OUT, f"sheet_{cam}.png"))


def main():
    import bpy
    import numpy as np
    from mathutils import Vector
    from mathutils.kdtree import KDTree
    sys.path.insert(0, os.path.dirname(HERE))
    sys.path.insert(0, os.path.join(os.path.dirname(HERE), "fighters"))
    from common import anim  # noqa: E402
    import ilsheta  # noqa: E402

    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--clips", default="")
    ap.add_argument("--frames", default="0,0.2,0.32,0.4,0.55,0.75,1.0")
    ap.add_argument("--no-render", action="store_true")
    a = ap.parse_args(argv)
    os.makedirs(OUT, exist_ok=True)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    body = bpy.data.objects.get("ilsheta")
    names = None
    for o in bpy.data.objects:
        if o.type == "MESH" and o.name not in ("ilsheta", "ilsheta_accent"):
            o.hide_render = True
    skel = anim.Skeleton(arm)

    class Ctx:
        pass
    ctx = Ctx()
    overrides = ilsheta.clip_overrides(ctx)
    clips = anim.standard_clips(skel, ilsheta.MOTION, overrides)
    want = [c for c in (a.clips.split(",") if a.clips else CLIPS) if c in clips]
    anim.write_clips(arm, {c: clips[c] for c in want}, [])
    # part ids on the body (vale_part): the parts list order of the cached build
    pv = np.empty(len(body.data.vertices), dtype=np.int64)
    body.data.attributes["vale_part"].data.foreach_get("value", pv)
    order = [n for n, *_ in ilsheta.sculpts()]
    pid = {n: i for i, n in enumerate(order)}
    staff_ids = {pid["staff"]}
    lamp_ids = {pid["lamp_stone"], pid["lamp_glass"]}
    hand_ids = {pid["hand_L"], pid["hand_R"]}
    body_ids = set(range(len(order))) - staff_ids - lamp_ids - hand_ids
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "TEXTURE"
    sc.display.shading.show_shadows = False
    sc.display.shading.studio_light = "outdoor.sl" if "outdoor.sl" in [l.name for l in bpy.context.preferences.studio_lights] else sc.display.shading.studio_light
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.exposure = 0.6
    sc.render.resolution_x = sc.render.resolution_y = 300
    sc.render.film_transparent = False
    sc.world = sc.world or bpy.data.worlds.new("w")
    cam_d = bpy.data.cameras.new("chk")
    cam_d.type = "ORTHO"
    cam_d.ortho_scale = 1.95
    cam = bpy.data.objects.new("chk", cam_d)
    sc.collection.objects.link(cam)
    sc.camera = cam

    def place(yaw, pitch):
        tgt = Vector((0, 0, 0.88))
        r = 6.0
        y, p = math.radians(yaw), math.radians(pitch)
        cam.location = tgt + Vector((math.sin(y) * math.cos(p) * r, -math.cos(y) * math.cos(p) * r, math.sin(p) * r))
        d = (tgt - cam.location).normalized()
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    deps = bpy.context.evaluated_depsgraph_get()
    for c in want:
        clip = clips[c]
        ad = arm.animation_data or arm.animation_data_create()
        act = bpy.data.actions[c]
        ad.action = act
        try:
            ad.action_slot = act.slots[0]
        except (AttributeError, IndexError):
            pass
        for i, t in enumerate(float(v) for v in a.frames.split(",")):
            f = t * clip.frames
            sc.frame_set(int(f), subframe=f - int(f))
            deps.update()
            ev = body.evaluated_get(deps)
            me = ev.to_mesh()
            co = np.empty(len(me.vertices) * 3)
            me.vertices.foreach_get("co", co)
            ev.to_mesh_clear()
            co = (np.array(body.matrix_world) @ np.c_[co.reshape(-1, 3), np.ones(len(co) // 3)].T).T[:, :3]
            isb = np.isin(pv, list(body_ids))
            kd = KDTree(int(isb.sum()))
            for j, p in enumerate(co[isb]):
                kd.insert(p, j)
            kd.balance()

            def inside(ids, r):
                n = 0
                for p in co[np.isin(pv, list(ids))][::3]:
                    if kd.find_range(Vector(p), r):
                        n += 1
                return n
            st = inside(staff_ids, 0.012)
            lp = inside(lamp_ids, 0.010)
            lo_body = co[isb][:, 2].min()
            lo_part = order[int(pv[isb][int(np.argmin(co[isb][:, 2]))])]
            lo_lamp = co[np.isin(pv, list(lamp_ids))][:, 2].min()
            print(f"{c:11s} t {t:.2f} f {f:5.1f}: body low {lo_body:+.3f} ({lo_part})  lamp low {lo_lamp:+.3f}  staff~body {st:4d}  lamp~body {lp:4d}")
            if not a.no_render:
                for cn, (yaw, pitch) in (("a", (-35.0, 12.0)), ("b", (70.0, 28.0))):
                    place(yaw, pitch)
                    sc.render.filepath = os.path.join(OUT, f"{c}_{i}_{cn}.png")
                    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    if "--sheet" in sys.argv:
        sheet()
    else:
        main()
