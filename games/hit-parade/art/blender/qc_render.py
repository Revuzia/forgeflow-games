"""HIT PARADE - QC renders + measurements of a baked fighter GLB (lane ASSETS).

  blender.exe --background --python art/blender/qc_render.py -- <qc.glb> <clips.json> <out_dir> [clip,clip...]

Imports the SHIPPING GLB content (the compress_glb.py --qc copy: stripped tracks, webp texture, resampled
keys, only meshopt missing because Blender cannot decode it) and, per clip:
  * evaluates the skinned mesh on EVERY frame: lowest vertex height (0 = feet on the floor),
    highest vertex, T-pose test (both upper arms AND forearms within 12 deg of the bind direction)
  * finger curl (hand -> middle finger, deg) at the strip frames: >= 60 reads as a closed fist
  * renders a 4-frame strip (3/4 front view) + the contact frame (or middle frame) from the GAME
    camera side (P1 view: the fighter faces screen-right, camera on its right side)
  * renders 5 GAME-camera frames at 300x400: c-6, c-3, c, c+3, c+8 around the contact (a red ball at
    clips.json effector.at on c: the fist / foot must sit on it) or 5 evenly spread frames
Also renders a textured EEVEE turntable (8 yaws + 2 head close-ups) of the idle frame 0 to check the
atlas and the hair/lash cutout. Writes <out>/qc.json and PNGs; tools/qc_sheet.py composes sheets.
ASCII only.
"""
import json
import math
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import hp_common as C  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
GLB, CLIPS_JSON, OUT = [os.path.abspath(x).replace("\\", "/") for x in argv[:3]]
ONLY = set(argv[3].split(",")) if len(argv) > 3 and argv[3] else None
os.makedirs(OUT, exist_ok=True)
FPS = 30
W, H = 220, 300
GW, GH = 300, 400   # game-camera frames around the contact (qc_sheet moves_NN.png)


def setup():
    C.reset_scene()
    # the glTF importer turns key TIMES into frames with the scene fps: set 30 BEFORE importing (part-1
    # QC imported at the factory 24 fps, so QC frame f showed clip time f/24 - hook_fling's "contact"
    # render was 3.75 frames late; found in part 2 by probing the imported action range 0..26.4 for a
    # 34-frame clip)
    bpy.context.scene.render.fps = FPS
    bpy.context.scene.render.fps_base = 1.0
    bpy.ops.import_scene.gltf(filepath=GLB)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers)]
    # the glTF importer adds a bone-shape 'Icosphere'; it is not part of the fighter
    C.remove_objects([o for o in bpy.data.objects if o.type == "MESH" and o not in meshes])
    scn = bpy.context.scene
    scn.render.fps = FPS
    return arm, meshes


def action_for(name):
    a = bpy.data.actions.get(name)
    if a:
        return a
    for a in bpy.data.actions:
        if a.name.split("_")[0] == name or a.name.startswith(name + "_") or a.name.startswith(name + "|"):
            return a
    return None


def assign(arm, act):
    arm.animation_data_create()
    arm.animation_data.action = act
    if getattr(arm.animation_data, "action_slot", None) is None and len(act.slots):
        arm.animation_data.action_slot = act.slots[0]


def lowest_highest(meshes):
    deps = bpy.context.evaluated_depsgraph_get()
    lo, hi = 1e9, -1e9
    for o in meshes:
        ev = o.evaluated_get(deps)
        me = ev.to_mesh()
        n = len(me.vertices)
        co = np.empty(n * 3, dtype=np.float32)
        me.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        M = np.array(ev.matrix_world)
        z = co @ M[2, :3] + M[2, 3]
        lo, hi = min(lo, float(z.min())), max(hi, float(z.max()))
        ev.to_mesh_clear()
    return lo, hi


def bone_dir(arm, name):
    pb = arm.pose.bones.get(name)
    if pb is None:
        return None
    return (arm.matrix_world.to_3x3() @ (pb.tail - pb.head)).normalized()


def rest_dir(arm, name):
    b = arm.data.bones.get(name)
    return (arm.matrix_world.to_3x3() @ (b.tail_local - b.head_local)).normalized() if b else None


def angle(a, b):
    return math.degrees(a.angle(b)) if (a is not None and b is not None) else None


def curl(arm, side):
    return angle(bone_dir(arm, C.PFX + side + "Hand"), bone_dir(arm, C.PFX + side + "HandMiddle2"))


def build_stage(height):
    scn = bpy.context.scene
    scn.render.engine = "BLENDER_WORKBENCH"
    sh = scn.display.shading
    sh.light = "STUDIO"
    sh.color_type = "TEXTURE"
    sh.show_shadows = True
    sh.shadow_intensity = 0.5
    sh.show_cavity = True
    scn.display.light_direction = (0.4, -0.5, 0.8)
    scn.render.resolution_x, scn.render.resolution_y = W, H
    scn.render.film_transparent = False
    scn.render.image_settings.file_format = "PNG"
    if scn.world is None:
        scn.world = bpy.data.worlds.new("W")
    scn.world.color = (0.80, 0.82, 0.86)
    import bmesh
    me = bpy.data.meshes.new("floor")
    bm = bmesh.new()
    N = 10
    for i in range(-N, N):
        for j in range(-N, N):
            vs = [bm.verts.new((i * 0.25, j * 0.25, 0)), bm.verts.new(((i + 1) * 0.25, j * 0.25, 0)),
                  bm.verts.new(((i + 1) * 0.25, (j + 1) * 0.25, 0)), bm.verts.new((i * 0.25, (j + 1) * 0.25, 0))]
            f = bm.faces.new(vs)
            f.material_index = (i + j) % 2
    bm.to_mesh(me)
    bm.free()
    fl = bpy.data.objects.new("floor", me)
    for c in ((0.42, 0.44, 0.48, 1), (0.60, 0.62, 0.66, 1)):
        m = bpy.data.materials.new("fl")
        m.diffuse_color = c
        me.materials.append(m)
    scn.collection.objects.link(fl)
    cd = bpy.data.cameras.new("cam")
    cd.type = "ORTHO"
    cd.ortho_scale = height * 1.45
    cam = bpy.data.objects.new("cam", cd)
    scn.collection.objects.link(cam)
    scn.camera = cam
    return cam, fl


def aim(cam, target, az_deg, el_deg, dist=9.0):
    """az from the model forward (-Y), + toward the model's LEFT (+X)."""
    az, el = math.radians(az_deg), math.radians(el_deg)
    d = (Vector((0, -1, 0)) * math.cos(az) + Vector((1, 0, 0)) * math.sin(az)) * math.cos(el) + Vector((0, 0, math.sin(el)))
    cam.location = Vector(target) + d * dist
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()


def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def make_marker():
    """A red ball placed at clips.json effector.at on the contact frame (game view): the fist / foot
    must sit on it, and the pose must read as the strike's extension. Workbench TEXTURE colour mode
    shows image textures, so the ball gets a 1x1 red image."""
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.045, segments=16, ring_count=8)
    mk = bpy.context.active_object
    mk.name = "qc_marker"
    img = bpy.data.images.new("qc_red", 1, 1)
    img.pixels = [1.0, 0.05, 0.05, 1.0]
    m = bpy.data.materials.new("qc_red")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    m.diffuse_color = (1.0, 0.05, 0.05, 1.0)
    mk.data.materials.append(m)
    mk.hide_render = True
    return mk


def main():
    t0 = time.time()
    clips = json.load(open(CLIPS_JSON))
    arm, meshes = setup()
    body = clips.get("body", {})
    height = float(body.get("heightM", 1.8))
    cam, floor = build_stage(height)
    global MARK
    MARK = make_marker()
    tgt = (0.0, 0.0, height * 0.52)
    out = {"glb": GLB, "clips": {}, "actions_in_glb": sorted(a.name for a in bpy.data.actions)}
    arms = ["LeftArm", "RightArm", "LeftForeArm", "RightForeArm"]
    rest_d = {b: rest_dir(arm, C.PFX + b) for b in arms}
    for cid, meta in clips["clips"].items():
        if ONLY and cid not in ONLY:
            continue
        act = action_for(cid)
        if act is None:
            out["clips"][cid] = {"error": "no action in GLB"}
            continue
        assign(arm, act)
        n = int(meta["frames"])
        lows, highs, tpose = [], [], []
        for f in range(n):
            bpy.context.scene.frame_set(f)
            bpy.context.view_layer.update()
            lo, hi = lowest_highest(meshes)
            lows.append(round(lo, 4))
            highs.append(round(hi, 4))
            dev = [angle(bone_dir(arm, C.PFX + b), rest_d[b]) for b in arms]
            if all(d is not None and d < 12.0 for d in dev):
                tpose.append(f)
        picks = sorted(set([0, n // 3, (2 * n) // 3, n - 1]))
        cf = None
        if meta.get("contact") is not None:
            cf = int(round(meta["contact"] * FPS))
        game_f = cf if cf is not None else n // 2
        curls = {}
        for k, f in enumerate(picks):
            bpy.context.scene.frame_set(f)
            bpy.context.view_layer.update()
            curls[f] = [curl(arm, "Left"), curl(arm, "Right")]
            aim(cam, tgt, 35.0, 8.0)
            render(os.path.join(OUT, "%s__s%d.png" % (cid, k)))
        bpy.context.scene.frame_set(game_f)
        bpy.context.view_layer.update()
        curls[game_f] = [curl(arm, "Left"), curl(arm, "Right")]
        aim(cam, tgt, -90.0, 4.0)
        render(os.path.join(OUT, "%s__game.png" % cid))
        # game-camera frames: around the contact (c-6, c-3, c, c+3, c+8; marker on c) or evenly spread
        if cf is not None:
            gfr = [max(0, cf - 6), max(0, cf - 3), cf, min(n - 1, cf + 3), min(n - 1, cf + 8)]
        else:
            gfr = [0, n // 4, n // 2, (3 * n) // 4, n - 1]
        eff = meta.get("effector") or {}
        cam.data.ortho_scale = height * 1.25
        bpy.context.scene.render.resolution_x, bpy.context.scene.render.resolution_y = GW, GH
        for k, f in enumerate(gfr):
            bpy.context.scene.frame_set(f)
            bpy.context.view_layer.update()
            on = cf is not None and f == cf and eff.get("at")
            if on:
                # fighter-local [x_fwd, y_up] -> Blender (model forward = -Y); put the ball on the
                # camera side (-X = model right) so the ortho game view always shows it
                MARK.location = (-0.6, -float(eff["at"][0]), float(eff["at"][1]))
            MARK.hide_render = not on
            aim(cam, tgt, -90.0, 4.0)
            render(os.path.join(OUT, "%s__g%d.png" % (cid, k)))
        MARK.hide_render = True
        cam.data.ortho_scale = height * 1.45
        bpy.context.scene.render.resolution_x, bpy.context.scene.render.resolution_y = W, H
        out["clips"][cid] = {
            "frames": n, "strip_frames": picks, "game_frame": game_f, "contact_frame": cf, "game_frames": gfr,
            "lowest_min": min(lows), "lowest_max": max(lows), "lowest": lows,
            "highest_max": max(highs), "tpose_frames": tpose,
            "sink_frames_lt_-0.03": sum(1 for v in lows if v < -0.03),
            "float_frames_gt_0.03": sum(1 for v in lows if v > 0.03),
            "finger_curl_deg_LR": {str(k): [round(x, 1) if x is not None else None for x in v] for k, v in curls.items()},
        }
        C.log("QC", cid, "low %.3f..%.3f" % (min(lows), max(lows)), "tpose", len(tpose))
    # ---- textured turntable (EEVEE) of idle frame 0
    try:
        idle = action_for("idle") or (bpy.data.actions[0] if bpy.data.actions else None)
        if idle:
            assign(arm, idle)
        bpy.context.scene.frame_set(0)
        scn = bpy.context.scene
        scn.render.engine = "BLENDER_EEVEE"
        scn.render.resolution_x, scn.render.resolution_y = 260, 360
        w = scn.world
        w.use_nodes = True
        bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
        bg.inputs[0].default_value = (0.55, 0.57, 0.62, 1)
        bg.inputs[1].default_value = 1.0
        sun_d = bpy.data.lights.new("sun", "SUN")
        sun_d.energy = 3.0
        sun = bpy.data.objects.new("sun", sun_d)
        sun.rotation_euler = (math.radians(50), 0, math.radians(30))
        scn.collection.objects.link(sun)
        cam.data.ortho_scale = height * 1.2
        for k, az in enumerate(range(0, 360, 45)):
            aim(cam, tgt, float(az), 6.0)
            render(os.path.join(OUT, "_turn_%d.png" % k))
        head = arm.matrix_world @ arm.pose.bones[C.PFX + "Head"].head
        cam.data.ortho_scale = 0.55
        for k, az in enumerate((30.0, 160.0)):
            aim(cam, (head.x, head.y, head.z + 0.08), az, 10.0)
            render(os.path.join(OUT, "_turn_head_%d.png" % k))
        out["turntable"] = "eevee"
    except Exception as ex:  # noqa
        out["turntable_error"] = repr(ex)
        C.log("TURNTABLE FAILED", repr(ex))
    out["secs"] = round(time.time() - t0, 1)
    with open(os.path.join(OUT, "qc.json"), "w") as fh:
        json.dump(out, fh, indent=1)
    C.log("QC DONE", len(out["clips"]), "clips", out["secs"], "s")


main()
