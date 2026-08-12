"""Diagnostic: reproduce ONE family-A retarget (guard + anim_idle) inside
Blender and measure WHERE the leg flip is born.

Measures, at frame 0 of the retargeted action ON THE TARGET ARMATURE:
  * the world-space direction of each leg/arm bone's Y axis (down = correct)
  * per-bone angle between achieved world basis and D_src @ rest_t (the
    retarget's own target)
and, on the SOURCE armature (family-A rebuilt + baked):
  * the same leg-direction reading, plus angle(W_src, R_rest_src) per bone.

If the SOURCE reads legs-up or huge D at idle -> the family-A bridge (bake)
is the generator. If source is fine but the TARGET pose is folded -> the
retarget math. If both fine in Blender -> the exporter.

Run:
  "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background
      --factory-startup --python _harness/blender_diag_retarget.py
"""
import math
import os
import sys

import bpy
from mathutils import Matrix

GAME = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(GAME, "tools"))
import blender_enemy_clips as EC  # noqa: E402
import blender_retarget as RT     # noqa: E402

BODY = os.path.join(GAME, "assets", "enemies", "68_v3_cold_hail_plate_guard.glb")
SRC = r"F:\assets\meshy-characters\_web_mixamo_pack\anims\anim_idle.glb"

WATCH = ["mixamorig:Hips", "mixamorig:Spine", "mixamorig:LeftShoulder",
         "mixamorig:LeftArm", "mixamorig:LeftForeArm",
         "mixamorig:LeftUpLeg", "mixamorig:LeftLeg", "mixamorig:LeftFoot",
         "mixamorig:RightUpLeg"]


def bone_y_world(arm, name):
    """The pose bone's +Y axis (bone direction) in Blender world space."""
    m = (arm.matrix_world @ arm.pose.bones[name].matrix).to_3x3()
    v = m @ Matrix.Identity(3).col[1]
    v.normalize()
    return v


def ang(a, b):
    d = max(-1.0, min(1.0, a.normalized().dot(b.normalized())))
    return math.degrees(math.acos(d))


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = EC.OUT_FPS

    print("[diag] loading source (family-A bridge):", SRC, flush=True)
    src = EC.load_source(SRC, "SRC_DIAG")

    scn = bpy.context.scene
    deps = bpy.context.evaluated_depsgraph_get()
    scn.frame_set(0)
    deps.update()

    print("\n[diag] SOURCE armature at frame 0 (after family-A bake):")
    print("  object matrix_world rot:",
          tuple(round(math.degrees(e), 1)
                for e in src.matrix_world.to_euler()))
    for n in WATCH:
        if n not in src.pose.bones:
            continue
        W = src.pose.bones[n].matrix.to_3x3().normalized()
        R = src.data.bones[n].matrix_local.to_3x3()
        for i in range(3):
            R[i].normalize()
        D = W @ R.inverted()
        q = D.to_quaternion()
        yw = (src.matrix_world.to_3x3() @ W) @ Matrix.Identity(3).col[1]
        yw.normalize()
        print("  %-24s D_angle=%6.1f  boneY_world=(%5.2f,%5.2f,%5.2f)" % (
            n.replace("mixamorig:", ""), math.degrees(q.angle),
            yw.x, yw.y, yw.z), flush=True)

    print("\n[diag] loading target body:", BODY, flush=True)
    tgt = EC.load_body(BODY, "TGT_DIAG")
    print("  target object matrix_world rot:",
          tuple(round(math.degrees(e), 1)
                for e in tgt.matrix_world.to_euler()))

    act = RT.retarget_action(src, tgt, "diag|idle")
    tgt.animation_data.action = act
    scn.frame_set(0)
    deps.update()

    print("\n[diag] TARGET armature at frame 0 of retargeted idle:")
    for n in WATCH:
        if n not in tgt.pose.bones:
            continue
        W = tgt.pose.bones[n].matrix.to_3x3().normalized()
        R = tgt.data.bones[n].matrix_local.to_3x3()
        for i in range(3):
            R[i].normalize()
        D = W @ R.inverted()
        q = D.to_quaternion()
        yw = (tgt.matrix_world.to_3x3() @ W) @ Matrix.Identity(3).col[1]
        yw.normalize()
        print("  %-24s D_angle=%6.1f  boneY_world=(%5.2f,%5.2f,%5.2f)" % (
            n.replace("mixamorig:", ""), math.degrees(q.angle),
            yw.x, yw.y, yw.z), flush=True)

    # world positions: are the feet below the hips?
    for label, arm in (("SOURCE", src), ("TARGET", tgt)):
        hz = (arm.matrix_world @ arm.pose.bones["mixamorig:Hips"].matrix
              ).translation
        fz = (arm.matrix_world @ arm.pose.bones["mixamorig:LeftFoot"].matrix
              ).translation
        print("[diag] %s hips_worldZ=%.3f  leftFoot_worldZ=%.3f  (foot below"
              " hips = correct)" % (label, hz.z, fz.z), flush=True)


main()
