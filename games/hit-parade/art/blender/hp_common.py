"""HIT PARADE asset pipeline - shared Blender helpers (lane ASSETS).

Imported by the headless entry scripts in art/blender/ (bake_fighter.py, qc_render.py).
Nothing here runs on import. ASCII only.

Conventions (CONTRACT section 2, TECH_REUSE E52):
  Blender world is Z-up. A Mixamo FBX (body or clip) imports facing Blender -Y, which the glTF
  exporter maps to glTF/three +Z (the model forward). So in every measurement below:
      model forward = -Y world, model up = +Z world, model right = -X world.
"""
import math
import os
import re
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector

PFX = "mixamorig:"
_PFX_RE = re.compile(r"^mixamorig\d*:")
FWD = Vector((0.0, -1.0, 0.0))
UP = Vector((0.0, 0.0, 1.0))


def log(*a):
    print("[hp]", *a, flush=True)


def strip(name):
    """'mixamorig7:LeftHand' -> 'LeftHand'."""
    return _PFX_RE.sub("", name)


def is_finger(short):
    return short.startswith(("LeftHand", "RightHand")) and short not in ("LeftHand", "RightHand")


LOWER_BODY = {"Hips", "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase", "LeftToe_End",
              "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase", "RightToe_End"}


def swap_lr(short):
    if short.startswith("Left"):
        return "Right" + short[4:]
    if short.startswith("Right"):
        return "Left" + short[5:]
    return short


# ------------------------------------------------------------------ scene / import
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_fbx(path):
    """Import an FBX, return the list of new objects."""
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def remove_objects(objs):
    for o in list(objs):
        try:
            data = o.data
            bpy.data.objects.remove(o, do_unlink=True)
            if data is not None and data.users == 0:
                if isinstance(data, bpy.types.Mesh):
                    bpy.data.meshes.remove(data)
                elif isinstance(data, bpy.types.Armature):
                    bpy.data.armatures.remove(data)
        except ReferenceError:
            pass


def purge_orphans():
    try:
        bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
    except Exception:  # noqa
        pass


def rename_prefix(arm):
    """Normalise every bone to the 'mixamorig:' prefix (16 of 79 bodies use mixamorigN:)."""
    n = 0
    for b in arm.data.bones:
        want = PFX + strip(b.name)
        if b.name != want:
            b.name = want
            n += 1
    return n


def hier_order(arm):
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


def arm_m3(arm):
    return arm.matrix_world.to_3x3().normalized()


def rest_w3(arm, name):
    """World-space rest orientation (normalised 3x3) of a bone."""
    return (arm.matrix_world.to_3x3() @ arm.data.bones[name].matrix_local.to_3x3()).normalized()


def rest_head_w(arm, name):
    return arm.matrix_world @ arm.data.bones[name].head_local


def hip_height(arm):
    """Rest height of the Hips head above the lowest bone head (world metres)."""
    wm = arm.matrix_world
    zs = [(wm @ b.head_local).z for b in arm.data.bones]
    return (wm @ arm.data.bones[PFX + "Hips"].head_local).z - min(zs)


# ------------------------------------------------------------------ actions (Blender 5 slotted)
def channelbags(action):
    bags = []
    for layer in action.layers:
        for st in layer.strips:
            for cb in st.channelbags:
                bags.append(cb)
    return bags


def fcurves(action):
    out = []
    for cb in channelbags(action):
        out.extend(cb.fcurves)
    return out


def action_frame_range(action):
    r = action.frame_range
    return int(round(r[0])), int(round(r[1]))


def write_fcurve(action, arm, data_path, index, values, group):
    """Create (or replace) one fcurve with a key on every output frame 0..N-1 (LINEAR)."""
    fc = action.fcurve_ensure_for_datablock(arm, data_path, index=index, group_name=group)
    fc.keyframe_points.clear()
    n = len(values)
    fc.keyframe_points.add(n)
    co = [0.0] * (2 * n)
    for i, v in enumerate(values):
        co[2 * i] = float(i)
        co[2 * i + 1] = float(v)
    fc.keyframe_points.foreach_set("co", co)
    try:
        lin = bpy.types.Keyframe.bl_rna.properties["interpolation"].enum_items["LINEAR"].value
        fc.keyframe_points.foreach_set("interpolation", [lin] * n)
    except Exception:  # noqa
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
    fc.update()
    return fc


def quat_list_fix(qs):
    """Make consecutive quaternions take the short path (sign continuity)."""
    out = []
    prev = None
    for q in qs:
        q = q.copy()
        if prev is not None and prev.dot(q) < 0.0:
            q.negate()
        out.append(q)
        prev = q
    return out


# ------------------------------------------------------------------ small math
def m3_to_q(m):
    return m.to_quaternion().normalized()


def world_axis_rot(axis_key, deg):
    """Named model-space rotations for authoring (see author_clips.py header)."""
    a = math.radians(deg)
    if axis_key == "pitch":      # + bends the top forward (about world +X)
        return Matrix.Rotation(a, 3, Vector((1.0, 0.0, 0.0)))
    if axis_key == "yaw":        # + turns to the model's left (about world +Z)
        return Matrix.Rotation(a, 3, Vector((0.0, 0.0, 1.0)))
    if axis_key == "roll":       # + leans the top to the model's right (about world -Y)
        return Matrix.Rotation(a, 3, Vector((0.0, -1.0, 0.0)))
    raise ValueError("unknown axis " + axis_key)


def ensure_dir(p):
    os.makedirs(p, exist_ok=True)
    return p


def add_path(p):
    if p not in sys.path:
        sys.path.insert(0, p)
