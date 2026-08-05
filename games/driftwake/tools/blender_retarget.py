"""World-space clip retarget between two Mixamo rigs with different rest poses.

WHY THIS EXISTS
A Mixamo clip is authored against ONE character's skeleton: its bone-local
rotations are deltas from THAT rig's rest orientation. Pasting them onto a
different auto-rig by bone name bends the body — measured on this project:
the driftwake hero_v2 rig's upper arms sit 0.51 (matrix_local maxdiff) away
from the old character's, and 0.23 from Mixamo's generic mannequin. That is
the same defect class as the 2026-08-04 folded-arm bug.

THE MATH (rotations only; all matrices are armature-space 3x3)
The invariant worth preserving is the WORLD-SPACE DELTA FROM REST — how far
the bone has swung away from its own bind pose — not the raw local rotation:

    D(n)  = W_src(n,t) @ R_rest_src(n)^-1          per-bone world delta
    W_tgt(n,t) = D(n) @ R_rest_tgt(n)              same swing, target's rest

Blender composes W(n) = W(p) @ [R_rest(p)^-1 @ R_rest(n)] @ B(n), so the
basis rotation that produces the wanted world orientation solves to

    B(n) = R_rest_tgt(n)^-1 @ D(p)^-1 @ D(n) @ R_rest_tgt(n)     (D(root)=I)

which is closed-form — no per-bone depsgraph round-trip, so a 300-frame clip
retargets in one pass instead of 12k scene updates.

Hips translation is transferred as a UNIT-FREE ratio: the source's vertical
displacement from its own rest, expressed in source hip-heights, re-applied
in target hip-heights. That sidesteps the cm/metre lies in Mixamo FBX
headers entirely. Horizontal Hips motion is dropped — the game's controller
owns world position (see blender_driftwake_rig.py).

CORRECTNESS GATE
`identity_test()` retargets a clip from a rig onto ITSELF and asserts every
bone's world orientation is reproduced to < 1e-4. A retarget that cannot
survive the identity case is not trusted with a real one.
"""
import bpy
import math
from mathutils import Matrix, Vector


def _hier_order(arm):
    """Bone names, parents strictly before children."""
    out, seen = [], set()

    def visit(b):
        if b.name in seen:
            return
        if b.parent:
            visit(b.parent)
        seen.add(b.name)
        out.append(b.name)

    for b in arm.data.bones:
        visit(b)
    return out


def _rest3(arm, name):
    return arm.data.bones[name].matrix_local.to_3x3()


def _hip_height(arm):
    """Rest height of the Hips head above the lowest bone head, measured in
    WORLD space — Mixamo armatures are Y-up internally with the -90° X fix at
    the object level, so armature-local axes are NOT vertical. Unit-agnostic:
    it is measured on the same rig whose motion is expressed against it."""
    hips = arm.data.bones.get("mixamorig:Hips")
    if hips is None:
        return 1.0
    wm = arm.matrix_world
    zs = [(wm @ b.matrix_local.translation).z for b in arm.data.bones]
    return max(1e-6, (wm @ hips.matrix_local.translation).z - min(zs))


def retarget_action(src_arm, tgt_arm, clip_name, frame_start=None, frame_end=None):
    """Bake src_arm's current action onto tgt_arm as a new action `clip_name`.

    Returns the new bpy.types.Action. Both armatures must share bone names.
    """
    act_src = src_arm.animation_data.action
    f0 = int(act_src.frame_range[0]) if frame_start is None else frame_start
    f1 = int(act_src.frame_range[1]) if frame_end is None else frame_end

    shared = [n for n in _hier_order(tgt_arm)
              if n in src_arm.data.bones and n in tgt_arm.pose.bones]
    rest_s = {n: _rest3(src_arm, n) for n in shared}
    rest_t = {n: _rest3(tgt_arm, n) for n in shared}
    rest_t_inv = {n: rest_t[n].inverted() for n in shared}
    parent_of = {n: (tgt_arm.data.bones[n].parent.name
                     if tgt_arm.data.bones[n].parent else None) for n in shared}

    hips = "mixamorig:Hips"
    ratio = _hip_height(tgt_arm) / _hip_height(src_arm)
    # World-space plumbing for the Hips transfer: vertical means WORLD Z.
    # Mixamo armatures are Y-up internally (the -90° X axis fix sits on the
    # OBJECT), so filtering "vertical" in armature space keeps a walk clip's
    # FORWARD travel instead of dropping it — that was a 2.34 m hips offset
    # on the first build attempt.
    src_w3 = src_arm.matrix_world.to_3x3()
    tgt_w3_inv = tgt_arm.matrix_world.to_3x3().inverted()

    # Hips baseline: the clips' REST hips is stored AT THE ORIGIN in Mixamo
    # animation FBXs (probed: matrix_local.translation ~ (0, -0.001, -0.015)
    # while the animated pose carries the absolute ~0.97 standing height), so
    # "pose minus rest" keeps the whole standing height as a phantom 1 m
    # offset. Baseline at the clip's own MEDIAN world height instead: stance
    # clips reduce to +/- cm of true bob, a jump keeps its arc about its own
    # midline (and airborne clips ride the controller's height anyway).
    hips_base_w = None
    if hips in shared:
        scn0 = bpy.context.scene
        deps0 = bpy.context.evaluated_depsgraph_get()
        zs = []
        for f in range(f0, f1 + 1):
            scn0.frame_set(f)
            deps0.update()
            zs.append((src_w3 @ src_arm.pose.bones[hips].matrix.translation).z)
        zs.sort()
        hips_base_w = zs[len(zs) // 2]

    # target must start clean, and quaternion mode so we can write rotations
    tgt_arm.animation_data_create()
    act = bpy.data.actions.new(clip_name)
    act.use_fake_user = True
    tgt_arm.animation_data.action = act
    for pb in tgt_arm.pose.bones:
        pb.rotation_mode = "QUATERNION"

    scn = bpy.context.scene
    deps = bpy.context.evaluated_depsgraph_get()
    for f in range(f0, f1 + 1):
        scn.frame_set(f)
        deps.update()
        # per-bone world delta from the SOURCE
        D = {}
        for n in shared:
            Ws = src_arm.pose.bones[n].matrix.to_3x3()
            # normalise: only orientation carries over, never scale
            Ws = Ws.normalized()
            D[n] = Ws @ rest_s[n].inverted()
        for n in shared:
            p = parent_of[n]
            Dp_inv = D[p].inverted() if (p in D) else Matrix.Identity(3)
            B = rest_t_inv[n] @ Dp_inv @ D[n] @ rest_t[n]
            pb = tgt_arm.pose.bones[n]
            pb.rotation_quaternion = B.to_quaternion()
            pb.keyframe_insert("rotation_quaternion", frame=f, group=n)
        if hips_base_w is not None:
            # vertical only (WORLD Z), as deviation from the clip's own median
            # height, scaled to the target's hip height (unit-free)
            z = (src_w3 @ src_arm.pose.bones[hips].matrix.translation).z
            off_z = (z - hips_base_w) * ratio
            local = rest_t_inv[hips] @ (tgt_w3_inv @ Vector((0.0, 0.0, off_z)))
            pbh = tgt_arm.pose.bones[hips]
            pbh.location = local
            pbh.keyframe_insert("location", frame=f, group=hips)
    return act


def identity_test(arm, tolerance=1e-4):
    """Retarget arm's action onto a duplicate of itself; assert world match.

    Returns (ok, worst_error, bone). A correct implementation reproduces the
    source exactly when rest_src == rest_tgt.
    """
    src_act = arm.animation_data.action
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.duplicate()
    dup = bpy.context.view_layer.objects.active
    dup.name = "IDENTITY_TEST_RIG"
    dup.animation_data_clear()

    retarget_action(arm, dup, "__identity__")

    scn = bpy.context.scene
    deps = bpy.context.evaluated_depsgraph_get()
    worst, who = 0.0, None
    f0, f1 = int(src_act.frame_range[0]), int(src_act.frame_range[1])
    for f in range(f0, f1 + 1, max(1, (f1 - f0) // 12)):
        scn.frame_set(f)
        deps.update()
        for b in arm.data.bones:
            n = b.name
            if n not in dup.pose.bones:
                continue
            a = arm.pose.bones[n].matrix.to_3x3().normalized()
            c = dup.pose.bones[n].matrix.to_3x3().normalized()
            e = max(abs(a[i][j] - c[i][j]) for i in range(3) for j in range(3))
            if e > worst:
                worst, who = e, n
    bpy.data.objects.remove(dup, do_unlink=True)
    return worst <= tolerance, worst, who
