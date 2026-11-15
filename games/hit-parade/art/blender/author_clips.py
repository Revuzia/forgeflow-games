"""HIT PARADE - authored system clips (lane ASSETS; doctrine section 1 author_clips.py pattern).

The clips no library has (wall_splat, thrown_f / thrown_b victims, parry, shove, impact_windup) plus
overlay variants (jump_f / jump_b) are AUTHORED here as keyed WORLD-SPACE poses on the X Bot skeleton.
They then go through exactly the same hybrid retarget as every Mixamo/CMU clip, so each body gets
its own correct version (hp_retarget.py).

A key pose = a BASE pose (a frame of a library clip, captured in world space) + world-axis rotation
offsets per bone + a hips offset. Offsets accumulate down the hierarchy like FK: rotating 'Spine'
carries everything above it, and a bone's own offset is applied on top (world axes, about its head):
      W(n) = Acc(n) @ W_base(n),   Acc(n) = Own(n) @ Acc(parent)
Model-space axes (the fighter faces Blender -Y = glTF +Z):
      pitch +deg  bends the top of the bone FORWARD   (about world +X)
      yaw   +deg  turns toward the model's LEFT       (about world +Z)
      roll  +deg  leans the top toward the model's RIGHT (about world -Y)
      hips  [fwd, up, right] metres at X Bot scale (x hip ratio on the body). The fwd/right part is
            the clip's ONLY horizontal travel (-> clips.json `root`): a keyed spec drops its base
            poses' own library hips travel (spec "base_travel": true keeps it). Track specs keep theirs.
Between keys: base poses and offsets are slerped per bone with the arriving key's easing
('smooth' default, 'linear', 'in', 'out'). A clip may instead give a 'track' (a library clip range
sampled per output frame) as its base, with the keys adding offsets only.
Part-2 additions (all optional, per key):
      upper [clip, frame]   LAYERED base: legs + Hips from `base`, Spine-up from this pose re-attached
                            to the base hips (exactly LayerSampler / the shared crouch_idle recipe)
      ik {"<Side>Foot": {"at": [fwd, up, right] | "base", "pole": [fwd, up, right]}}
                            two-bone leg IK solved AT THE KEY into extra world rotations of the
                            UpLeg + Leg (then slerped between keys like any offset). `at` = the ankle
                            (Foot head) in X Bot model metres (fwd/right from the model origin, up =
                            height above the floor); "base" pins it where the base pose has it (support
                            foot stays planted while the hips turn). `pole` = the knee's bend direction.
                            Out of reach -> the leg straightens toward `at`.
      aim {"<Bone>": [fwd, up, right]}   turn the bone so its head->child-head points that way (feet:
                            toes pointed / flexed) - applied after the IK.

THROW SYNC (the pair contract, CONTRACT 6.2): the victim clip's frame 0 is the moment the throw
connects (the attacker clip's `contact`); marks.slam is when the victim hits the floor. An
attacker throw clip (fighter clipplan) declares its own marks.slam; the view time-warps both
clips so the two slam marks land on the same sim frame.
ASCII only.
"""
import math

from mathutils import Matrix, Quaternion, Vector

import hp_common as C

MP = "Pro_Magic_Pack/"
# CMU bases (bake_fighter.Library.ev parses "cmu:<take>:<start>:<end>[:kind:limb:contact[:m]]";
# output frames are 30 fps starting at 1). GUARD = the idle boxing guard; CROSS = clean rear cross.
GUARD = "cmu:13_17:4168:4316"
CROSS = "cmu:13_17:222:300:hand:R:239"

# ---------------------------------------------------------------------------- specs
# base = [library clip (pack/clip, no .fbx), source frame (1-based, 30 fps)]
AUTHORED = {
    # PARRY: SF6-style drive parry - both forearms crossed forward, torso pressing in. 0.6 s.
    # Starts from the fighting guard (same CMU guard as `idle`).
    "parry": {
        "frames": 19,
        "keys": [
            {"f": 0, "base": [GUARD, 1]},
            {"f": 3, "ease": "out", "base": [MP + "Standing Block Start", 16],
             "rot": {"Spine": [["pitch", 8]], "Spine1": [["pitch", 6]], "Head": [["pitch", -10]],
                     "LeftForeArm": [["pitch", -12]], "RightForeArm": [["pitch", -12]]}},
            {"f": 10, "base": [MP + "Standing Block Start", 16],
             "rot": {"Spine": [["pitch", 6]], "Spine1": [["pitch", 5]], "Head": [["pitch", -8]],
                     "LeftForeArm": [["pitch", -10]], "RightForeArm": [["pitch", -10]]}},
            {"f": 18, "base": [MP + "Standing Block Start", 16],
             "rot": {"Spine": [["pitch", 5]], "Spine1": [["pitch", 4]], "Head": [["pitch", -7]],
                     "LeftForeArm": [["pitch", -8]], "RightForeArm": [["pitch", -8]]}},
        ],
    },
    # SHOVE: out of blockstun, a hard two-palm push. contact f8 (0.27 s). Ends in the guard.
    "shove": {
        "frames": 25,
        "keys": [
            {"f": 0, "base": ["Pro_Melee_Axe_Pack/standing block react large", 7]},
            {"f": 4, "ease": "out", "base": [MP + "Standing 2H Magic Attack 02", 33],
             "rot": {"Spine": [["pitch", -6]], "Spine1": [["pitch", -4]]}, "hips": [-0.04, 0.0, 0.0]},
            {"f": 8, "ease": "in", "base": [MP + "Standing 2H Magic Attack 02", 43],
             "rot": {"Spine": [["pitch", 10]], "Spine1": [["pitch", 6]], "Head": [["pitch", -8]]},
             "hips": [0.16, 0.0, 0.0]},
            {"f": 12, "base": [MP + "Standing 2H Magic Attack 02", 45],
             "rot": {"Spine": [["pitch", 9]], "Spine1": [["pitch", 5]], "Head": [["pitch", -7]]},
             "hips": [0.18, 0.0, 0.0]},
            {"f": 24, "base": [GUARD, 1], "hips": [0.12, 0.0, 0.0]},
        ],
    },
    # IMPACT: armored wind-up (coil the rear hand back, hold under armor), then a massive driving
    # rear straight (the clean CMU cross 13_17 f222-300 as the strike pose) with the whole body
    # thrown in. contact f13 = 0.433 s = exactly the 26-frame (60 Hz) IMPACT startup.
    "impact_windup": {
        "frames": 37,
        "keys": [
            {"f": 0, "base": [GUARD, 1]},
            {"f": 6, "ease": "out", "base": [CROSS, 1],
             "rot": {"Hips": [["yaw", -22]], "Spine": [["yaw", -14], ["pitch", -4]], "Spine1": [["yaw", -8]],
                     "Head": [["yaw", 30]], "RightArm": [["pitch", 10]]},
             "hips": [-0.10, 0.0, 0.0]},
            {"f": 10, "base": [CROSS, 1],
             "rot": {"Hips": [["yaw", -28]], "Spine": [["yaw", -18], ["pitch", -6]], "Spine1": [["yaw", -10]],
                     "Head": [["yaw", 38]], "RightArm": [["pitch", 14]]},
             "hips": [-0.14, 0.0, 0.0]},
            {"f": 13, "ease": "in", "base": [CROSS, 5.5],
             "rot": {"Hips": [["yaw", 8]], "Spine": [["pitch", 12], ["yaw", 6]], "Spine1": [["pitch", 4]],
                     "Head": [["pitch", -12]]},
             "hips": [0.30, 0.0, 0.0]},
            {"f": 18, "base": [CROSS, 7],
             "rot": {"Hips": [["yaw", 6]], "Spine": [["pitch", 10], ["yaw", 4]], "Head": [["pitch", -10]]},
             "hips": [0.34, 0.0, 0.0]},
            {"f": 36, "base": [GUARD, 1], "hips": [0.32, 0.0, 0.0]},
        ],
    },
    # WALL SPLAT: back slams flat into the wall behind (arms flung wide, head snapped back, feet off
    # the floor), sticks, peels off and drops face-down (ends in the kd_ground_f pose).
    "wall_splat": {
        "frames": 43,
        "keys": [
            {"f": 0, "base": [MP + "Standing React Large From Front", 5]},
            {"f": 3, "ease": "out", "base": [MP + "Standing 2H Magic Area Attack 02", 56],
             "rot": {"Hips": [["pitch", -10]], "Spine": [["pitch", -14]], "Spine1": [["pitch", -8]],
                     "Head": [["pitch", -22]], "LeftUpLeg": [["pitch", -12]], "RightUpLeg": [["pitch", -18]],
                     "LeftLeg": [["pitch", 20]], "RightLeg": [["pitch", 26]]},
             "hips": [-0.28, 0.24, 0.0]},
            {"f": 14, "base": [MP + "Standing 2H Magic Area Attack 02", 56],
             "rot": {"Hips": [["pitch", -8]], "Spine": [["pitch", -12]], "Spine1": [["pitch", -6]],
                     "Head": [["pitch", -4]], "LeftArm": [["roll", 18]], "RightArm": [["roll", -18]],
                     "LeftUpLeg": [["pitch", -10]], "RightUpLeg": [["pitch", -14]],
                     "LeftLeg": [["pitch", 18]], "RightLeg": [["pitch", 22]]},
             "hips": [-0.28, 0.16, 0.0]},
            {"f": 24, "ease": "in", "base": [MP + "Standing React Death Forward", 48], "hips": [-0.12, 0.02, 0.0]},
            {"f": 34, "ease": "in", "base": [MP + "Standing React Death Forward", 100]},
            {"f": 42, "base": ["Soccer_Game_Pack/fallen idle", 1]},
        ],
    },
    # THROWN (forward throw victim): jolted, yanked in, hoisted, hurled over onto the back.
    # marks.slam = 22 (0.733 s). Ends in the kd_ground_b pose. Victim travels ~1.2 m backward.
    "thrown_f": {
        "frames": 41,
        "keys": [
            {"f": 0, "base": [MP + "Standing React Small From Front", 4]},
            {"f": 5, "base": [MP + "Standing React Large From Front", 4],
             "rot": {"Spine": [["pitch", 22]], "Spine1": [["pitch", 8]], "Head": [["pitch", -18]]},
             "hips": [0.14, -0.04, 0.0]},
            {"f": 12, "base": [MP + "Standing React Death Backward", 44],
             "rot": {"Hips": [["pitch", -30]]}, "hips": [-0.25, 0.45, 0.0]},
            {"f": 18, "base": [MP + "Standing React Death Backward", 80],
             "rot": {"Hips": [["pitch", -15]]}, "hips": [-0.75, 0.50, 0.0]},
            {"f": 22, "ease": "in", "base": [MP + "Standing React Death Backward", 100], "hips": [-1.10, 0.0, 0.0]},
            {"f": 25, "ease": "out", "base": [MP + "Standing React Death Backward", 100],
             "rot": {"Spine": [["pitch", 10]], "Head": [["pitch", 12]]}, "hips": [-1.15, 0.10, 0.0]},
            {"f": 29, "ease": "in", "base": [MP + "Standing React Death Backward", 104], "hips": [-1.20, 0.0, 0.0]},
            {"f": 40, "base": [MP + "Standing React Death Backward", 107], "hips": [-1.20, 0.0, 0.0]},
        ],
    },
    # THROWN (back throw victim): yanked forward past the attacker, flung, slammed face-down.
    # marks.slam = 20 (0.667 s). Ends in the kd_ground_f pose. Victim travels ~1.4 m forward.
    "thrown_b": {
        "frames": 37,
        "keys": [
            {"f": 0, "base": [MP + "Standing React Small From Front", 4]},
            {"f": 5, "base": [MP + "Standing React Large From Back", 8], "hips": [0.30, -0.02, 0.0]},
            {"f": 12, "base": ["Soccer_Game_Pack/soccer trip", 20],
             "rot": {"Hips": [["pitch", 12]]}, "hips": [0.85, 0.30, 0.0]},
            {"f": 20, "ease": "in", "base": ["Soccer_Game_Pack/soccer trip", 40], "hips": [1.35, 0.0, 0.0]},
            {"f": 23, "ease": "out", "base": ["Soccer_Game_Pack/soccer trip", 40],
             "rot": {"Spine": [["pitch", -10]]}, "hips": [1.40, 0.08, 0.0]},
            {"f": 27, "ease": "in", "base": ["Soccer_Game_Pack/soccer trip", 47], "hips": [1.42, 0.0, 0.0]},
            {"f": 36, "base": ["Soccer_Game_Pack/fallen idle", 1], "hips": [1.42, 0.0, 0.0]},
        ],
    },
    # CROUCH TOE KICK (lane FIGHTERS spec, CONTRACT 20.5; patch 2L-class poke). Base = the shared
    # crouch_idle recipe (Crouch Idle legs + the CMU guard upper), so f0 and f17 ARE crouch_idle f0.
    # In that crouch the LEFT leg is the front leg (X Bot: left ankle 0.36 m ahead of the hips, right
    # foot 0.13 m behind, measured), so the poke is the front (left) leg - FIGHTERS' text says
    # "front (right)"; the front leg wins. Chamber f3, contact f5: leg straight forward and low
    # (ankle 0.80 m ahead, 0.13 m up), toes pointed forward; hold to f7, re-chamber f11, crouch f17.
    # floor "plant": with the front foot up the body rests on the rear toes (measured 3.7 cm float
    # on patch with the default clamp), so the lowest vertex is put on the floor every frame.
    "crouch_toe_kick": {
        "frames": 18,
        "floor": "plant",
        "keys": [
            {"f": 0, "base": [MP + "Crouch Idle", 1], "upper": [GUARD, 1]},
            {"f": 3, "ease": "out", "base": [MP + "Crouch Idle", 1], "upper": [GUARD, 1],
             "rot": {"Spine": [["pitch", -5]]},
             "ik": {"LeftFoot": {"at": [0.55, 0.20, -0.10], "pole": [1.0, 0.3, 0.0]}},
             "aim": {"LeftFoot": [0.8, -0.2, 0.0]}},
            {"f": 5, "ease": "linear", "base": [MP + "Crouch Idle", 1], "upper": [GUARD, 1],
             "rot": {"Spine": [["pitch", -7]], "Head": [["pitch", 5]]},
             "ik": {"LeftFoot": {"at": [0.80, 0.13, -0.09], "pole": [0.3, 1.0, 0.0]}},
             "aim": {"LeftFoot": [1.0, 0.05, 0.0]}},
            {"f": 7, "base": [MP + "Crouch Idle", 1], "upper": [GUARD, 1],
             "rot": {"Spine": [["pitch", -7]], "Head": [["pitch", 5]]},
             "ik": {"LeftFoot": {"at": [0.79, 0.13, -0.09], "pole": [0.3, 1.0, 0.0]}},
             "aim": {"LeftFoot": [1.0, 0.22, 0.0]}},
            {"f": 11, "base": [MP + "Crouch Idle", 1], "upper": [GUARD, 1],
             "rot": {"Spine": [["pitch", -4]]},
             "ik": {"LeftFoot": {"at": [0.55, 0.20, -0.10], "pole": [1.0, 0.3, 0.0]}},
             "aim": {"LeftFoot": [0.8, -0.2, 0.0]}},
            {"f": 17, "base": [MP + "Crouch Idle", 1], "upper": [GUARD, 1]},
        ],
    },
    # CROUCH SHIN KICK (FIGHTERS spec; patch / lotus low round kick). Same crouch base. The REAR
    # (right) leg whips round: hips yaw +25 (turn left = right hip forward) with the knee chambered
    # out to the side at f4, contact f8 = straight leg at shin height (ankle 0.90 m ahead, 0.28 m up),
    # toes pointed, hips yaw 45, spine counter-turned so the guard stays on the opponent; hold f11,
    # re-chamber f16 (hips 15), crouch f23. The support (left) foot stays planted (ik "base") and
    # pivots with the hips (heel turn).
    "crouch_shin_kick": {
        "frames": 24,
        "keys": [
            {"f": 0, "base": [MP + "Crouch Idle", 1], "upper": [GUARD, 1]},
            {"f": 4, "ease": "out", "base": [MP + "Crouch Idle", 1], "upper": [GUARD, 1],
             "rot": {"Hips": [["yaw", 25]], "Spine": [["yaw", -15]], "Spine1": [["yaw", -5]]},
             "ik": {"LeftFoot": {"at": "base", "pole": [1.0, 0.3, 0.0]},
                    "RightFoot": {"at": [-0.18, 0.32, 0.52], "pole": [0.6, 0.5, 0.5]}},
             "aim": {"RightFoot": [-0.2, -0.3, 0.9]}},
            {"f": 8, "ease": "linear", "base": [MP + "Crouch Idle", 1], "upper": [GUARD, 1],
             "rot": {"Hips": [["yaw", 45]], "Spine": [["yaw", -26]], "Spine1": [["yaw", -10]],
                     "Head": [["yaw", -8]], "RightArm": [["pitch", 18]]},
             "ik": {"LeftFoot": {"at": "base", "pole": [1.0, 0.3, 0.0]},
                    "RightFoot": {"at": [0.90, 0.28, 0.08], "pole": [0.2, 1.0, 0.3]}},
             "aim": {"RightFoot": [1.0, -0.25, -0.25]}},
            {"f": 11, "base": [MP + "Crouch Idle", 1], "upper": [GUARD, 1],
             "rot": {"Hips": [["yaw", 40]], "Spine": [["yaw", -23]], "Spine1": [["yaw", -9]],
                     "Head": [["yaw", -7]], "RightArm": [["pitch", 15]]},
             "ik": {"LeftFoot": {"at": "base", "pole": [1.0, 0.3, 0.0]},
                    "RightFoot": {"at": [0.88, 0.28, 0.10], "pole": [0.2, 1.0, 0.3]}},
             "aim": {"RightFoot": [1.0, -0.2, -0.2]}},
            {"f": 16, "base": [MP + "Crouch Idle", 1], "upper": [GUARD, 1],
             "rot": {"Hips": [["yaw", 15]], "Spine": [["yaw", -9]], "Spine1": [["yaw", -3]]},
             "ik": {"LeftFoot": {"at": "base", "pole": [1.0, 0.3, 0.0]},
                    "RightFoot": {"at": [-0.18, 0.32, 0.52], "pole": [0.6, 0.5, 0.5]}},
             "aim": {"RightFoot": [-0.2, -0.3, 0.9]}},
            {"f": 23, "base": [MP + "Crouch Idle", 1], "upper": [GUARD, 1]},
        ],
    },
    # JUMP FORWARD / BACK: the Standing Jump air arc as a TRACK, with a forward tuck / backward lean
    # layered on top (the sim owns the airborne height: these are ground-locked, air='strip').
    "jump_f": {
        "track": [MP + "Standing Jump", 12, 40],
        "keys": [
            {"f": 0},
            {"f": 8, "rot": {"Spine": [["pitch", 6]]}},
            {"f": 16, "rot": {"Hips": [["pitch", 14]], "Spine": [["pitch", 14]], "Head": [["pitch", -14]],
                              "LeftUpLeg": [["pitch", -40]], "RightUpLeg": [["pitch", -55]],
                              "LeftLeg": [["pitch", 60]], "RightLeg": [["pitch", 75]]}},
            {"f": 22, "rot": {"Hips": [["pitch", 8]], "Spine": [["pitch", 8]], "Head": [["pitch", -8]],
                              "LeftUpLeg": [["pitch", -20]], "RightUpLeg": [["pitch", -30]],
                              "LeftLeg": [["pitch", 30]], "RightLeg": [["pitch", 40]]}},
            {"f": 28},
        ],
    },
    "jump_b": {
        "track": [MP + "Standing Jump", 12, 40],
        "keys": [
            {"f": 0},
            {"f": 8, "rot": {"Spine": [["pitch", -4]]}},
            {"f": 16, "rot": {"Hips": [["pitch", -10]], "Spine": [["pitch", -12]], "Head": [["pitch", 10]],
                              "LeftUpLeg": [["pitch", -30]], "RightUpLeg": [["pitch", -20]],
                              "LeftLeg": [["pitch", 45]], "RightLeg": [["pitch", 35]],
                              "LeftArm": [["pitch", 20]], "RightArm": [["pitch", 20]]}},
            {"f": 22, "rot": {"Hips": [["pitch", -6]], "Spine": [["pitch", -8]], "Head": [["pitch", 6]],
                              "LeftUpLeg": [["pitch", -15]], "RightUpLeg": [["pitch", -10]],
                              "LeftLeg": [["pitch", 20]], "RightLeg": [["pitch", 15]]}},
            {"f": 28},
        ],
    },
}


def library_needs(spec):
    """[(clip, frame)] and track clips this spec reads."""
    out = []
    for k in spec.get("keys", []):
        if "base" in k:
            out.append(k["base"][0])
        if "upper" in k:
            out.append(k["upper"][0])
    if "track" in spec:
        out.append(spec["track"][0])
    return sorted(set(out))


def _v(p):
    """[fwd, up, right] model metres -> Blender world vector (fwd = -Y, right = -X)."""
    return Vector((-float(p[2]), -float(p[0]), float(p[1])))


def _bkey(k):
    if not k.get("base"):
        return None
    return (tuple(k["base"]), tuple(k["upper"]) if k.get("upper") else None)


def _ease(w, kind):
    w = max(0.0, min(1.0, w))
    if kind == "linear":
        return w
    if kind == "in":
        return w * w
    if kind == "out":
        return 1.0 - (1.0 - w) * (1.0 - w)
    return w * w * (3.0 - 2.0 * w)


def _slerp_m(a, b, w):
    qa, qb = a.to_quaternion(), b.to_quaternion()
    if qa.dot(qb) < 0:
        qb.negate()
    return qa.slerp(qb, w).to_matrix()


def _own(rot):
    """{bone: [[axis, deg], ...]} -> {bone: Matrix3} (applied in list order)."""
    out = {}
    for b, lst in (rot or {}).items():
        m = Matrix.Identity(3)
        for ax, deg in lst:
            m = C.world_axis_rot(ax, float(deg)) @ m
        out[b] = m
    return out


def _hips_vec(h):
    if not h:
        return Vector((0.0, 0.0, 0.0))
    fwd, up, right = h
    return Vector((-float(right), -float(fwd), float(up)))


class AuthorSampler(object):
    """Samples an authored spec on the X Bot skeleton. lib(clip) -> hp_retarget._ArmEval."""

    def __init__(self, name, spec, lib):
        self.name = name
        self.spec = spec
        self.lib = lib
        any_ev = lib(library_needs(spec)[0])
        self.rest = any_ev.rest
        self.hip_h = any_ev.hip_h
        arm = any_ev.arm
        self.parent = {}
        for b in arm.data.bones:
            self.parent[C.strip(b.name)] = C.strip(b.parent.name) if b.parent else None
        self.order = [C.strip(n) for n in C.hier_order(arm)]
        self.keys = sorted(spec["keys"], key=lambda k: k["f"])
        if "track" in spec:
            clip, a, b = spec["track"]
            self.track = (clip, float(a), float(b))
            self.n = int(b - a) + 1
        else:
            self.track = None
            self.n = int(spec["frames"])
        self.f0 = 0.0
        self.speed = 1.0
        self._base_cache = {}
        self._pose_cache = {}
        for k in self.keys:
            k["_own"] = _own(k.get("rot"))
            k["_hips"] = _hips_vec(k.get("hips"))
        self.rhead = {C.strip(b.name): C.rest_head_w(arm, b.name) for b in arm.data.bones}
        self.children = {}
        for s in self.order:
            p = self.parent.get(s)
            if p:
                self.children.setdefault(p, []).append(s)
        self._solved = not any(k.get("ik") or k.get("aim") for k in self.keys)
        self.ik_report = []

    def _base(self, clip, f):
        key = (clip, float(f))
        if key not in self._base_cache:
            self._base_cache[key] = self.lib(clip).eval(float(f))
        return self._base_cache[key]

    def _basepose(self, bk):
        """(D, hoff) of a key base: a library frame, optionally layered with an upper-body frame."""
        if bk not in self._pose_cache:
            (clip, f), up = bk
            D, h = self._base(clip, f)
            if up:
                Du, _ = self._base(up[0], up[1])
                att = D["Hips"] @ Du["Hips"].inverted()
                D = {s: (D[s] if s in C.LOWER_BODY else att @ Du[s]) for s in D}
            self._pose_cache[bk] = (D, h)
        return self._pose_cache[bk]

    def _interp_local(self, Da, Dz, w):
        """Blend two base poses PARENT-RELATIVE (root in world): each bone's local rotation is slerped
        and the world pose rebuilt top-down. Slerping every bone's WORLD delta on its own let a parent
        and child take different ways round a large turn: thrown_b (the body flips between keys f5 and
        f12 / f12 and f20) twisted the left toe 150 deg and the right foot 171 deg off bind for 3-4
        frames (measured on johnny, part-1 re-run). Keys themselves are unchanged (w = 0 / 1)."""
        if w <= 0.0:
            return Da
        if w >= 1.0:
            return Dz
        R = self.rest
        Wa, Wz, W, D = {}, {}, {}, {}
        for s in self.order:
            if s not in Da or s not in Dz:
                continue
            wa = Da[s] @ R[s]
            wz = Dz[s] @ R[s]
            Wa[s], Wz[s] = wa, wz
            p = self.parent.get(s)
            if p in W:
                la = Wa[p].transposed() @ wa
                lz = Wz[p].transposed() @ wz
                W[s] = W[p] @ _slerp_m(la, lz, w)
            else:
                W[s] = _slerp_m(wa, wz, w)
            D[s] = W[s] @ R[s].transposed()
        for s in Da:
            if s not in D:
                D[s] = _slerp_m(Da[s], Dz.get(s, Da[s]), w)
        return D

    def _key_bk(self, i):
        """Effective base of key i (its own, else the nearest keyed neighbour's, as sample() does)."""
        for j in [i] + list(range(i + 1, len(self.keys))) + list(range(i - 1, -1, -1)):
            bk = _bkey(self.keys[j])
            if bk:
                return bk
        return None

    def _fk(self, Db, hoff, own):
        """World deltas D and head positions of the source skeleton for a base + offsets."""
        I3 = Matrix.Identity(3)
        acc, D, pos = {}, {}, {}
        for s in self.order:
            p = self.parent.get(s)
            A = own.get(s, I3) @ (acc[p] if p in acc else I3)
            acc[s] = A
            if s in Db:
                D[s] = A @ Db[s]
            if p is None or p not in pos:
                pos[s] = self.rhead[s] + hoff
            else:
                pos[s] = pos[p] + D.get(p, I3) @ (self.rhead[s] - self.rhead[p])
        return D, pos

    def _solve(self):
        """Resolve every key's ik / aim into extra world rotations (merged into the key's _own)."""
        I3 = Matrix.Identity(3)
        for i, k in enumerate(self.keys):
            if not (k.get("ik") or k.get("aim")):
                continue
            if self.track:
                clip, t0, t1 = self.track
                Db, hb = self.lib(clip).eval(min(t1, t0 + k["f"]))
            else:
                Db, hb = self._basepose(self._key_bk(i))
            own = dict(k["_own"])
            hoff = hb + k["_hips"]
            _, pos0 = self._fk(Db, hb, {})
            for eff, spec in sorted((k.get("ik") or {}).items()):
                knee = self.parent[eff]
                hip = self.parent[knee]
                D, pos = self._fk(Db, hoff, own)
                T = pos0[eff].copy() if spec.get("at") == "base" else _v(spec["at"])
                H = pos[hip]
                l1 = (self.rhead[knee] - self.rhead[hip]).length
                l2 = (self.rhead[eff] - self.rhead[knee]).length
                dv = T - H
                d = max(abs(l1 - l2) + 1e-4, min(l1 + l2 - 1e-4, dv.length))
                u = dv.normalized()
                pole = _v(spec.get("pole", [1.0, 0.0, 0.0])).normalized()
                pp = pole - u * pole.dot(u)
                if pp.length < 1e-6:
                    pp = u.orthogonal()
                pp.normalize()
                a_ = (l1 * l1 - l2 * l2 + d * d) / (2.0 * d)
                h_ = math.sqrt(max(0.0, l1 * l1 - a_ * a_))
                K = H + u * a_ + pp * h_
                Tc = H + u * d
                cur = D[hip] @ (self.rhead[knee] - self.rhead[hip])
                own[hip] = cur.rotation_difference(K - H).to_matrix() @ own.get(hip, I3)
                D, pos = self._fk(Db, hoff, own)
                cur = D[knee] @ (self.rhead[eff] - self.rhead[knee])
                own[knee] = cur.rotation_difference(Tc - pos[knee]).to_matrix() @ own.get(knee, I3)
                D, pos = self._fk(Db, hoff, own)
                self.ik_report.append({"key": k["f"], "eff": eff, "miss_m": round((pos[eff] - T).length, 4),
                                       "reach": round(dv.length / (l1 + l2), 3)})
            for b, dvec in sorted((k.get("aim") or {}).items()):
                D, pos = self._fk(Db, hoff, own)
                ch = self.children[b][0]
                cur = D[b] @ (self.rhead[ch] - self.rhead[b])
                own[b] = cur.rotation_difference(_v(dvec)).to_matrix() @ own.get(b, I3)
            k["_own"] = own
        self._solved = True

    def sample(self, k):
        if not self._solved:
            self._solve()
        keys = self.keys
        a = keys[0]
        b = keys[-1]
        for i in range(len(keys) - 1):
            if keys[i]["f"] <= k <= keys[i + 1]["f"]:
                a, b = keys[i], keys[i + 1]
                break
        if a is b or b["f"] == a["f"]:
            w = 0.0
        else:
            w = _ease((k - a["f"]) / float(b["f"] - a["f"]), b.get("ease", "smooth"))
        # base
        if self.track:
            clip, t0, t1 = self.track
            Db, hb = self.lib(clip).eval(min(t1, t0 + k))
        else:
            ba = _bkey(a) or _bkey(b)
            bb = _bkey(b) or ba
            Da, ha = self._basepose(ba)
            Dz, hz = self._basepose(bb)
            if self.spec.get("interp") == "world":
                Db = {s: _slerp_m(Da[s], Dz[s], w) for s in Da}
            else:
                Db = self._interp_local(Da, Dz, w)
            hb = ha.lerp(hz, w)
        # offsets
        I3 = Matrix.Identity(3)
        own = {}
        for s in set(a["_own"]) | set(b["_own"]):
            own[s] = _slerp_m(a["_own"].get(s, I3), b["_own"].get(s, I3), w)
        hs = a["_hips"].lerp(b["_hips"], w)
        hoff = hb + hs
        if not self.track and not self.spec.get("base_travel"):
            # ROOT RULE: the spec `hips` is the ONLY horizontal travel of a keyed spec. A base pose is a
            # frame of some library clip and carries that clip's own hips travel (thrown_b's soccer-trip
            # bases ran the root to +4.9 m before the fallen-idle base snapped it back to +1.3 m). The
            # pose never depends on it (retarget strips horizontal hips into clips.json `root`) and the
            # IK solve above still uses the full base hips, so only `root` changes. Vertical is kept.
            hoff = Vector((hs.x, hs.y, hoff.z))
        acc = {}
        D = {}
        for s in self.order:
            p = self.parent.get(s)
            A = own.get(s, I3) @ (acc[p] if p in acc else I3)
            acc[s] = A
            if s in Db:
                D[s] = A @ Db[s]
        return D, hoff
