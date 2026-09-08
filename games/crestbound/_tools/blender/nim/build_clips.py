"""
NIM — author every CONTRACT §11 state as a named clip and export the final GLB.

    blender --background --python build_clips.py -- --blend <_work/nim_model.blend> --out <kit dir> [--fps 60]

Each clip is an Action keyed from nim_poses.PoseSampler (the hero.js pose
writers, ported) sampled at --fps, pushed onto its own single-strip NLA track
so the glTF exporter (ACTIONS mode) writes one animation per state. Bone
rotations are quaternions built from hero.js's Euler XYZ (Rx*Ry*Rz) — the
probe verified Blender's bone frame == the glTF joint frame here (identity
rest rotations), so the runtime's own numbers land on the mesh unchanged.
"""
import bpy, sys, os, math, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import nim_poses as NP
from nim_lib import quat_xyz

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    if name in argv:
        i = argv.index(name)
        return argv[i + 1] if i + 1 < len(argv) else True
    return default


BLEND = arg("--blend"); OUT = os.path.abspath(arg("--out")); FPS = int(arg("--fps", 60))
WORK = os.path.join(OUT, "_work")
T0 = time.time()


def log(*a):
    print("[clips %6.1fs]" % (time.time() - T0), *a, flush=True)


bpy.ops.wm.open_mainfile(filepath=BLEND)
scene = bpy.context.scene
scene.render.fps = FPS; scene.render.fps_base = 1.0
arm = bpy.data.objects["nim"]
bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True); bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
for pb in arm.pose.bones:
    pb.rotation_mode = 'QUATERNION'
    pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0); pb.scale = (1, 1, 1)

# ---- axis sanity (falsifier for the whole convention): +X rotation on upperArmR must
# swing the hand FORWARD, i.e. toward Blender +Y (hero -Z)
arm.pose.bones["upperArmR"].rotation_quaternion = quat_xyz(0.5, 0, 0)
bpy.context.view_layer.update()
h = arm.pose.bones["handR"].matrix.translation
assert h.y > 0.15 and h.z < 0.9, "axis convention broken: handR at %s" % (tuple(round(c, 3) for c in h),)
log("axis check ok: +X on upperArmR puts handR at blender", tuple(round(c, 3) for c in h))
arm.pose.bones["upperArmR"].rotation_quaternion = (1, 0, 0, 0)

sampler = NP.PoseSampler()
plan = NP.clip_plan()
if arm.animation_data is None:
    arm.animation_data_create()
ad = arm.animation_data
# purge any stray actions so nothing but ours ships (doctrine)
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)

PUPIL_GAIN = 0.16     # hero.js darts the pupils 0.042 rad about the HEAD origin; about the ball centre that is 0.16
meta = []
for clip in plan:
    name, dur, loop = clip["name"], clip["dur"], clip["loop"]
    n = max(1, int(round(dur * FPS)))
    act = bpy.data.actions.new(name)
    ad.action = act
    squash = NP.squash_curve(clip["squash"], dur, FPS)
    prev = {}
    pb_rig = arm.pose.bones["rig"]
    for fi in range(n + 1):
        t = (fi / float(n)) * dur if loop else min(fi / float(FPS), dur)
        ctx = clip["ctx"](t)
        ctx["squash"] = squash[min(fi, len(squash) - 1)]
        fr = sampler.sample(name, ctx)
        NP.apply_foot_plant(fr, name, ctx.get("speed", 0.0), ctx.get("phase", 0.0))
        frame = fi + 1
        for bname, e in fr.bones.items():
            q = quat_xyz(e[0], e[1], e[2])
            if bname in prev and sum(a * b for a, b in zip(prev[bname], q)) < 0:
                q = [-c for c in q]
            prev[bname] = q
            pb = arm.pose.bones[bname]
            pb.rotation_quaternion = q
            pb.keyframe_insert("rotation_quaternion", frame=frame)
        q = quat_xyz(*fr.rig_rot)
        if "rig" in prev and sum(a * b for a, b in zip(prev["rig"], q)) < 0:
            q = [-c for c in q]
        prev["rig"] = q
        pb_rig.rotation_quaternion = q
        pb_rig.location = fr.rig_pos
        pb_rig.scale = fr.rig_scale
        pb_rig.keyframe_insert("rotation_quaternion", frame=frame)
        pb_rig.keyframe_insert("location", frame=frame)
        pb_rig.keyframe_insert("scale", frame=frame)
        # eyes: look with the turn / look-around; lids for the states hero.js squeezes shut
        look = fr.extra.get("lean", 0.0) * 0.42 + fr.extra.get("lookYaw", 0.0) * 0.55
        for side in ("R", "L"):
            pp = arm.pose.bones["pupil" + side]
            pp.rotation_quaternion = quat_xyz(0.0, look * PUPIL_GAIN, 0.0)
            pp.keyframe_insert("rotation_quaternion", frame=frame)
        closed = 1.0 if name == "dead" else (0.75 if name in ("hardLand", "poundLand") and t < 0.12 else 0.0)
        eyes = arm.pose.bones["eyes"]
        eyes.scale = (1.0, 1.0 - closed * 0.94, 1.0)
        eyes.keyframe_insert("scale", frame=frame)
        # hair tuft: a touch of lag against the head's pitch so the crown reads alive
        hp = fr.bones["head"][0] + fr.rig_rot[0]
        tuft = arm.pose.bones["hairTuft"]
        tuft.rotation_quaternion = quat_xyz(-hp * 0.25, 0.0, 0.0)
        tuft.keyframe_insert("rotation_quaternion", frame=frame)
    act.use_frame_range = True
    act.frame_range = (1, n + 1)
    act.use_cyclic = bool(loop)
    slot = ad.action_slot
    track = ad.nla_tracks.new(); track.name = name
    strip = track.strips.new(name, 1, act)
    try:
        strip.action_slot = slot
    except Exception as ex:
        log("WARN action_slot", name, repr(ex))
    ad.action = None
    meta.append(dict(index=clip["index"], name=name, dur=round(dur, 4), loop=loop, fps=FPS,
                     frame_start=1, frame_end=n + 1, sheet_frame=1 + int(round(clip["sheet_t"] * FPS)),
                     squash=clip["squash"]))
    log("clip", name, "frames", n + 1, "dur %.3f" % dur, "loop" if loop else "")

bpy.ops.object.mode_set(mode='OBJECT')
scene.frame_start = 1; scene.frame_end = max(m["frame_end"] for m in meta)
with open(os.path.join(WORK, "clips_meta.json"), "w") as f:
    json.dump(meta, f, indent=1)
blend2 = os.path.join(WORK, "nim_clips.blend")
bpy.ops.wm.save_as_mainfile(filepath=blend2)
log("saved", blend2)

glb = os.path.join(OUT, "nim.glb")
bpy.ops.export_scene.gltf(
    filepath=glb, export_format='GLB', export_yup=True, export_apply=False,
    export_animations=True, export_animation_mode='ACTIONS', export_nla_strips=True,
    export_force_sampling=True, export_anim_slide_to_zero=True, export_optimize_animation_size=True,
    export_frame_range=False, export_skins=True, export_def_bones=False,
    export_rest_position_armature=True, export_image_format='AUTO',
    export_draco_mesh_compression_enable=False, export_materials='EXPORT',
    export_vertex_color='NONE', export_texcoords=True, export_normals=True, use_selection=False)
log("exported", glb, "%.2f MB" % (os.path.getsize(glb) / 1e6))
