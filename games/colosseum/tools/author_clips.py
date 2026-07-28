"""
Author NEW attack clips on the shared 24-bone rig, in Blender, headless.

Why authored clips at all: the game shipped with ONE two-clip slash vocabulary
for every weapon and direction (audit rank 3). The runtime now keys clip CHOICE
on weapon/direction, but a thrust still played a sideways slash. These are the
first clips the roster gets that were designed for their verb:

  anim_thrust.glb  ~1.5 s  guard -> coil -> hips-driven forward drive, the
                           weapon's +Y punched forward-level -> recover
  anim_cleave.glb  ~1.8 s  two-beat overhead raise -> full downward arc through
                           the centreline -> recover

METHOD — world-space posing via pose_bone.matrix, parents first. Every previous
attempt to hand-write per-bone Eulers on these Meshy rigs died on arbitrary
bone roll (equipment, sword guard — all fixed by solving in world space). Same
lesson here: each key pose is defined as WORLD-axis rotations about each bone's
head, applied to the bone's REST armature-space matrix. Blender recomputes the
local quaternion, which is what gets keyframed.

FRAME OF REFERENCE (verified in the runtime work): the fighter faces +Z in
three.js; the glTF importer maps that to +Y forward in Blender's Z-up world.
So: forward = +Y, up = +Z, the fighter's LEFT = +X. The spine chain is
REVERSE-NAMED (Hips -> Spine02 -> Spine01 -> Spine, Spine02 lowest).

run:
  "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
      --python games/colosseum/tools/author_clips.py
writes: assets/chars/_shared_clips/anim_thrust.glb, anim_cleave.glb
"""

import bpy
import math
import os
import sys
from mathutils import Matrix, Vector

GAME = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(GAME, "assets", "chars", "murmillo", "base.glb")
OUT = os.path.join(GAME, "assets", "chars", "_shared_clips")
FPS = 24

D = math.radians


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.actions, bpy.data.armatures, bpy.data.objects, bpy.data.meshes):
        for item in list(block):
            try:
                block.remove(item)
            except Exception:
                pass


def load_rig():
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=BASE)
    arms = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
    if not arms:
        print("FATAL: no armature in base.glb")
        sys.exit(1)
    return arms[0]


# Parents-first application order (the matrix of a child depends on its
# parent's CURRENT pose, so parents must be posed first).
ORDER = [
    "Hips", "Spine02", "Spine01", "Spine", "neck", "Head",
    "RightShoulder", "RightArm", "RightForeArm", "RightHand",
    "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
    "LeftUpLeg", "LeftLeg", "RightUpLeg", "RightLeg",
]

AXES = {"F": Vector((0, 1, 0)), "U": Vector((0, 0, 1)), "L": Vector((1, 0, 0))}


def author(arm, name, frames, length_s):
    """frames: {frame: {bone: [(axis, deg), ...]} plus optional {"__hips_push": metres}}"""
    # Fresh action.
    arm.animation_data_create()
    action = bpy.data.actions.new(name)
    arm.animation_data.action = action

    # Rest armature-space matrices, captured with NO pose applied.
    for pb in arm.pose.bones:
        pb.matrix_basis.identity()
    bpy.context.view_layer.update()
    rest = {pb.name: pb.matrix.copy() for pb in arm.pose.bones}

    scene = bpy.context.scene
    scene.render.fps = FPS
    total = int(round(length_s * FPS))
    scene.frame_start, scene.frame_end = 0, total

    for frame in sorted(frames.keys()):
        spec = frames[frame]
        scene.frame_set(frame)
        # reset to rest, then apply this key's world rotations parents-first
        for pb in arm.pose.bones:
            pb.matrix_basis.identity()
        bpy.context.view_layer.update()

        hips_push = spec.get("__hips_push", 0.0)
        for bone_name in ORDER:
            rots = spec.get(bone_name)
            pb = arm.pose.bones.get(bone_name)
            if pb is None:
                continue
            if rots:
                m = rest[bone_name].copy()
                head = m.to_translation()
                for axis_key, deg in rots:
                    rot = (Matrix.Translation(head) @
                           Matrix.Rotation(D(deg), 4, AXES[axis_key]) @
                           Matrix.Translation(-head))
                    m = rot @ m
                # Parent pose is already applied this frame; assigning .matrix
                # solves the local basis against it.
                pb.matrix = m
                bpy.context.view_layer.update()

        hips = arm.pose.bones.get("Hips")
        if hips is not None and hips_push:
            # push straight forward (+Y armature space) — root drive
            hips.location.y += hips_push / arm.scale.y if arm.scale.y else hips_push
            bpy.context.view_layer.update()

        # keyframe EVERY listed bone every key so interpolation is anchored
        for bone_name in ORDER:
            pb = arm.pose.bones.get(bone_name)
            if pb is None:
                continue
            pb.keyframe_insert("rotation_quaternion", frame=frame)
            if bone_name == "Hips":
                pb.keyframe_insert("location", frame=frame)

    return action


def export(arm, action, path):
    # PURGE every other action or it ships in the GLB alongside ours — the
    # first authored files carried anims:2 (base.glb's idle came along), and
    # loadFighter takes animations[0], which would have played the WRONG clip.
    for a in list(bpy.data.actions):
        if a is not action:
            bpy.data.actions.remove(a)
    arm.animation_data.action = action
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True,
        export_animations=True, export_apply=False, export_yup=True,
        export_skins=True,
    )
    print("WROTE", path, os.path.getsize(path), "bytes")


# ---------------------------------------------------------------------------
# THE CLIPS. Degrees about world axes F(+Y fwd) / U(+Z up) / L(+X left),
# applied at each bone's head on top of its REST pose.
# ---------------------------------------------------------------------------

# THRUST — 1.5 s, strike ~f14 of 36 (frac ~0.39).
THRUST = {
    0: {},
    8: {   # coil: right side loads back, elbow cocks
        "Hips": [("U", 16)],
        "Spine02": [("U", 8)], "Spine01": [("U", 6)],
        "RightArm": [("U", 20), ("L", -18)],
        "RightForeArm": [("L", -55)],
        "Head": [("U", -14)],
    },
    14: {  # STRIKE: hips drive through, arm punches the weapon forward-level
        "Hips": [("U", -22)],
        "Spine02": [("U", -12), ("L", 8)], "Spine01": [("U", -8), ("L", 5)],
        "RightArm": [("U", -38), ("L", 52)],
        "RightForeArm": [("L", 38)],
        "RightHand": [("L", 12)],
        "Head": [("U", 6)],
        "__hips_push": 0.16,
    },
    19: {  # hold the extension a beat
        "Hips": [("U", -18)],
        "Spine02": [("U", -10), ("L", 7)],
        "RightArm": [("U", -34), ("L", 48)],
        "RightForeArm": [("L", 34)],
        "__hips_push": 0.12,
    },
    36: {},  # recover to guard
}

# CLEAVE — 1.8 s, strike ~f22 of 43 (frac ~0.51).
CLEAVE = {
    0: {},
    10: {  # raise: weapon high overhead, back extends
        "Spine02": [("L", -10)], "Spine01": [("L", -8)],
        "RightArm": [("L", -135)],
        "RightForeArm": [("L", -25)],
        "Head": [("L", -8)],
    },
    15: {  # apex hold (the two-beat)
        "Spine02": [("L", -12)], "Spine01": [("L", -9)],
        "RightArm": [("L", -145)],
        "RightForeArm": [("L", -18)],
        "Head": [("L", -10)],
    },
    22: {  # STRIKE: full downward arc through the centreline
        "Hips": [("L", 6)],
        "Spine02": [("L", 16)], "Spine01": [("L", 12)],
        "RightArm": [("L", 55)],
        "RightForeArm": [("L", 15)],
        "RightHand": [("L", 10)],
        "__hips_push": 0.10,
    },
    28: {  # follow-through, low
        "Spine02": [("L", 12)], "Spine01": [("L", 9)],
        "RightArm": [("L", 62)],
        "RightForeArm": [("L", 20)],
    },
    43: {},  # recover
}


def main():
    os.makedirs(OUT, exist_ok=True)

    arm = load_rig()
    act = author(arm, "anim_thrust", THRUST, 1.5)
    export(arm, act, os.path.join(OUT, "anim_thrust.glb"))

    arm = load_rig()
    act = author(arm, "anim_cleave", CLEAVE, 1.8)
    export(arm, act, os.path.join(OUT, "anim_cleave.glb"))

    print("AUTHOR_DONE")


if __name__ == "__main__":
    main()
