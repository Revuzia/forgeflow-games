"""VALE_BIPED_1 — the one skeleton every fighter carries (CONTRACT §12).

Standard bones (exact names, all exported as glTF joints):

    root
    └ hips
      ├ spine ─ chest ─┬ neck ─ head
      │                ├ shoulder.L ─ upper_arm.L ─ forearm.L ─ hand.L ─ prop.L
      │                └ shoulder.R ─ upper_arm.R ─ forearm.R ─ hand.R ─ prop.R
      ├ thigh.L ─ shin.L ─ foot.L ─ toe.L
      └ thigh.R ─ shin.R ─ foot.R ─ toe.R

Extra bones must start with `x_` (capes, tails, ears, hair, wings, VFX sockets). Non-bipeds still
carry every standard bone, placed sensibly, so the shared clip tooling keeps working.

Rest pose: A-pose (arms `a_pose_deg` below horizontal, slightly forward, soft elbows/knees),
feet at Z = 0, facing -Y.

LOCAL AXES (bone roll) CONVENTION — identical for every fighter, so a rotation means the same
thing on every rig and clips/poses transfer:
  * +Y runs along the bone, head -> tail (Blender rule).
  * Body bones (root, hips, spine, chest, neck, head, shoulders, arms, hands, thighs, shins) roll
    so local +Z points to the character's FRONT (-Y world in rest). Hence local +X = Y x Z:
    world +X (character's left) for the spine chain, roughly "down/inward" on the arms, and
    world -X on the legs.
  * Foot and toe bones point forward, so they roll local +Z UP (+Z world); prop.L/prop.R also
    point forward (the held item's main axis) with +Z up.
  * Consequences (Euler XYZ, degrees, as used by anim.py):
      +X rotation swings the bone's tip toward the front: spine/neck/head bend forward (nod),
      thigh flexes forward, upper arm raises forward, elbow flexes, foot/toe tip up (dorsiflex).
      Knee flexion is -X on shin.  Elbow flexion is +X on forearm.
      Y rotation twists about the bone; Z rotation bends sideways (abduction). For .L/.R
      pairs X is symmetric and Y/Z are mirrored: mirror a pose by swapping sides and negating
      Y and Z (anim.mirror_pose does this; center bones negate Y and Z too).
Props are modelled at the world origin, grip at the origin, main axis along +Z (blade/shaft up),
edge/face toward -Y; `attach_prop` maps that frame onto prop.R / prop.L.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import bpy
from mathutils import Matrix, Vector

from . import scene

STANDARD_BONES = [
    "root", "hips", "spine", "chest", "neck", "head",
    "shoulder.L", "upper_arm.L", "forearm.L", "hand.L",
    "shoulder.R", "upper_arm.R", "forearm.R", "hand.R",
    "thigh.L", "shin.L", "foot.L", "toe.L",
    "thigh.R", "shin.R", "foot.R", "toe.R",
    "prop.R", "prop.L",
]
RIG_STANDARD = "VALE_BIPED_1"
FRONT = Vector((0.0, -1.0, 0.0))
UP = Vector((0.0, 0.0, 1.0))

# Default proportions: a stylized heroic biped, ~7.4 heads tall. Lengths in metres unless noted.
DEFAULT_PROPORTIONS = {
    "height": 1.85,          # crown height
    "head": 0.245,           # chin -> crown
    "neck": 0.075,           # neck bone length
    "shoulder_width": 0.48,  # distance between shoulder joints (upper_arm heads)
    "hip_width": 0.21,       # distance between hip joints (thigh heads)
    "leg": 0.86,             # hip joint -> ankle (thigh + shin)
    "thigh_frac": 0.51,      # thigh share of `leg`
    "arm": 0.58,             # shoulder joint -> wrist (upper arm + forearm)
    "upper_arm_frac": 0.53,
    "hand": 0.19,            # wrist -> fingertip
    "foot": 0.27,            # heel -> toe tip
    "ankle_height": 0.085,
    "spine_curve": 0.015,    # chest forward of the pelvis (m); negative leans back
    "pelvis_depth": 0.0,     # pelvis offset along Y (m)
    "stance": 0.035,         # ankle outward offset from the hip joint (m)
    "toe_out_deg": 7.0,      # feet turned out
    "a_pose_deg": 45.0,      # arms below horizontal
    "arm_forward_deg": 9.0,  # arms rotated toward the front
    "elbow_bend_deg": 10.0,  # rest elbow flexion (helps IK + deformation)
    "knee_bend": 0.012,      # knee forward of the hip-ankle line (m)
    "shoulder_drop": 0.03,   # shoulder joint below the neck base (m)
}


@dataclass
class RigInfo:
    """What modelling code needs to fit a body to the rig: named joint positions (world)."""
    armature: bpy.types.Object
    props: dict
    joints: dict = field(default_factory=dict)       # name -> Vector
    lengths: dict = field(default_factory=dict)      # bone -> length

    def j(self, name: str) -> Vector:
        return self.joints[name].copy()

    def side(self, name: str, s: str) -> Vector:
        return self.joints[f"{name}.{s}"].copy()


def proportions(**overrides) -> dict:
    p = dict(DEFAULT_PROPORTIONS)
    unknown = set(overrides) - set(p)
    if unknown:
        raise KeyError(f"unknown proportion keys {sorted(unknown)}")
    p.update(overrides)
    return p


def _layout(p: dict) -> dict:
    """Joint positions for the left side (+X); right side is mirrored."""
    H = p["height"]
    J: dict[str, Vector] = {}
    z_ankle = p["ankle_height"]
    hx = p["hip_width"] / 2
    ax = hx + p["stance"]
    dz = math.sqrt(max(1e-6, p["leg"] ** 2 - (ax - hx) ** 2))
    z_hip = z_ankle + dz
    y0 = p["pelvis_depth"]
    sc = p["spine_curve"]
    z_crown = H
    z_head = H - p["head"] * 0.86          # skull base (head bone head) ~ just above the jaw
    z_neck = z_head - p["neck"]
    J["pelvis"] = Vector((0, y0, z_hip + 0.015))
    J["spine0"] = Vector((0, y0 + 0.004, z_hip + 0.105))
    J["spine1"] = Vector((0, y0 - 0.25 * sc + 0.006, z_hip + 0.105 + (z_neck - z_hip - 0.105) * 0.42))
    J["neck_base"] = Vector((0, y0 - sc + 0.012, z_neck))
    J["head_base"] = Vector((0, y0 - sc + 0.004, z_head))
    J["crown"] = Vector((0, y0 - sc + 0.004, z_crown))
    # legs
    hip = Vector((hx, y0 + 0.005, z_hip))
    ankle = Vector((ax, y0 + 0.02, z_ankle))
    f = p["thigh_frac"]
    knee = hip.lerp(ankle, f) + Vector((0, -p["knee_bend"], 0))
    J["hip.L"], J["knee.L"], J["ankle.L"] = hip, knee, ankle
    to = math.radians(p["toe_out_deg"])
    fwd = Vector((math.sin(to), -math.cos(to), 0.0))
    foot = p["foot"]
    J["ball.L"] = Vector((ankle.x, ankle.y, 0.0)) + fwd * (foot * 0.50) + Vector((0, 0, foot * 0.07))
    J["toe.L"] = Vector((ankle.x, ankle.y, 0.0)) + fwd * (foot * 0.74) + Vector((0, 0, foot * 0.05))
    J["heel.L"] = Vector((ankle.x, ankle.y, 0.0)) - fwd * (foot * 0.26)
    # arms
    sw = p["shoulder_width"] / 2
    z_sh = z_neck - p["shoulder_drop"]
    J["clavicle.L"] = Vector((0.03, J["neck_base"].y + 0.012, z_neck - 0.012))
    sh = Vector((sw, J["neck_base"].y + 0.018, z_sh))
    a = math.radians(p["a_pose_deg"])
    fw = math.radians(p["arm_forward_deg"])
    d1 = Vector((math.cos(a) * math.cos(fw), -math.cos(a) * math.sin(fw), -math.sin(a))).normalized()
    elbow = sh + d1 * (p["arm"] * p["upper_arm_frac"])
    # rest elbow flexion: rotate toward the front about the arm's hinge axis (X = Y x Z, Z = front)
    zf = (FRONT - d1 * FRONT.dot(d1)).normalized()
    hinge = d1.cross(zf).normalized()
    d2 = (Matrix.Rotation(math.radians(p["elbow_bend_deg"]), 3, hinge) @ d1).normalized()
    wrist = elbow + d2 * (p["arm"] * (1 - p["upper_arm_frac"]))
    J["shoulder.L"], J["elbow.L"], J["wrist.L"] = sh, elbow, wrist
    J["knuckle.L"] = wrist + d2 * (p["hand"] * 0.5)
    J["fingertip.L"] = wrist + d2 * p["hand"]
    zf2 = (FRONT - d2 * FRONT.dot(d2)).normalized()
    palm_n = d2.cross(zf2).normalized()  # local X of the hand: points down/inward for the left side
    J["palm.L"] = wrist + d2 * (p["hand"] * 0.40) + palm_n * 0.022
    J["arm_dir.L"] = d1
    J["forearm_dir.L"] = d2
    J["palm_n.L"] = palm_n
    # mirror
    for k in list(J):
        if k.endswith(".L"):
            v = J[k]
            J[k[:-2] + ".R"] = Vector((-v.x, v.y, v.z))
    return J


def build_rig(props: dict | None = None, name: str = "rig", col=None) -> RigInfo:
    """Create the VALE_BIPED_1 armature for `props` (see DEFAULT_PROPORTIONS)."""
    p = proportions(**(props or {}))
    J = _layout(p)
    arm_data = bpy.data.armatures.new(name)
    arm_data.display_type = "OCTAHEDRAL"
    arm = scene.new_object(name, arm_data, col)
    arm["vale_rig"] = RIG_STANDARD
    scene.select_only([arm], arm)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_data.edit_bones

    def bone(nm, head, tail, parent=None, z=FRONT, connect=False, deform=True):
        b = eb.new(nm)
        b.head = head
        b.tail = tail
        b.align_roll(z)
        if parent:
            b.parent = eb[parent]
            b.use_connect = connect
        b.use_deform = deform
        return b

    H = p["height"]
    bone("root", Vector((0, 0, 0)), Vector((0, 0, 0.12 * H)), None, deform=False)
    bone("hips", J["pelvis"], J["spine0"], "root")
    bone("spine", J["spine0"], J["spine1"], "hips", connect=True)
    bone("chest", J["spine1"], J["neck_base"], "spine", connect=True)
    bone("neck", J["neck_base"], J["head_base"], "chest", connect=True)
    bone("head", J["head_base"], J["crown"], "neck", connect=True)
    for s in ("L", "R"):
        bone(f"shoulder.{s}", J[f"clavicle.{s}"], J[f"shoulder.{s}"], "chest")
        bone(f"upper_arm.{s}", J[f"shoulder.{s}"], J[f"elbow.{s}"], f"shoulder.{s}", connect=True)
        bone(f"forearm.{s}", J[f"elbow.{s}"], J[f"wrist.{s}"], f"upper_arm.{s}", connect=True)
        bone(f"hand.{s}", J[f"wrist.{s}"], J[f"knuckle.{s}"], f"forearm.{s}", connect=True)
        palm = J[f"palm.{s}"]
        bone(f"prop.{s}", palm, palm + FRONT * 0.12, f"hand.{s}", z=UP)
        bone(f"thigh.{s}", J[f"hip.{s}"], J[f"knee.{s}"], "hips")
        bone(f"shin.{s}", J[f"knee.{s}"], J[f"ankle.{s}"], f"thigh.{s}", connect=True)
        bone(f"foot.{s}", J[f"ankle.{s}"], J[f"ball.{s}"], f"shin.{s}", z=UP, connect=True)
        bone(f"toe.{s}", J[f"ball.{s}"], J[f"toe.{s}"], f"foot.{s}", z=UP, connect=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    info = RigInfo(armature=arm, props=p, joints=J)
    for b in arm_data.bones:
        info.lengths[b.name] = b.length
    for pb in arm.pose.bones:
        pb.rotation_mode = "XYZ"
    return info


def add_chain(info: RigInfo, name: str, parent: str, points, z_hint=FRONT, deform=True) -> list[str]:
    """Add an `x_<name>_<i>` chain through `points` (>= 2), parented to `parent`.

    Use for capes (`add_chain(info, 'cape', 'chest', pts)`), tails, ears, hair, wings, tabards.
    Returns the bone names (root first). anim.secondary_motion() animates them.
    """
    assert len(points) >= 2
    arm = info.armature
    scene.select_only([arm], arm)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    names = []
    prev = parent
    for i in range(len(points) - 1):
        nm = f"x_{name}_{i + 1}"
        b = eb.new(nm)
        b.head = Vector(points[i])
        b.tail = Vector(points[i + 1])
        b.align_roll(Vector(z_hint))
        b.parent = eb[prev]
        b.use_connect = i > 0
        b.use_deform = deform
        names.append(nm)
        prev = nm
    bpy.ops.object.mode_set(mode="OBJECT")
    for nm in names:
        arm.pose.bones[nm].rotation_mode = "XYZ"
        info.lengths[nm] = arm.data.bones[nm].length
    return names


def add_socket(info: RigInfo, name: str, parent: str, head, direction=(0, 0, 0.1), z_hint=FRONT) -> str:
    """Add a non-deforming `x_` socket bone (VFX attach point). Returns its name."""
    nm = name if name.startswith("x_") else f"x_{name}"
    arm = info.armature
    scene.select_only([arm], arm)
    bpy.ops.object.mode_set(mode="EDIT")
    b = arm.data.edit_bones.new(nm)
    b.head = Vector(head)
    b.tail = Vector(head) + Vector(direction)
    b.align_roll(Vector(z_hint))
    b.parent = arm.data.edit_bones[parent]
    b.use_deform = False
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.pose.bones[nm].rotation_mode = "XYZ"
    return nm


def standard_sockets(extra: dict | None = None) -> dict:
    """FighterArt.sockets defaults: VFX socket name -> bone name."""
    s = {"origin": "root", "chest": "chest", "head": "head", "hand_r": "hand.R", "hand_l": "hand.L",
         "weapon_r": "prop.R", "weapon_l": "prop.L", "foot_r": "foot.R", "foot_l": "foot.L"}
    s.update(extra or {})
    return s


def prop_matrix(info: RigInfo, socket: str = "prop.R") -> Matrix:
    """World matrix that maps prop-authoring space (grip at origin, main axis +Z, face -Y) onto
    the socket bone's rest frame (bone +Y = prop +Z, bone +Z = prop +Y... see module doc)."""
    b = info.armature.data.bones[socket]
    m = b.matrix_local.copy()                     # armature space; columns X, Y, Z, T
    # prop +Z -> bone +Y (forward), prop -Y (face) -> bone +Z (up), prop +X -> bone +X
    basis = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
    return info.armature.matrix_world @ m @ basis


def check_standard(arm: bpy.types.Object) -> list[str]:
    names = {b.name for b in arm.data.bones}
    errs = [f"missing bone {b}" for b in STANDARD_BONES if b not in names]
    errs += [f"non-standard bone {b} (extra bones need the x_ prefix)" for b in names
             if b not in STANDARD_BONES and not b.startswith("x_")]
    return errs
