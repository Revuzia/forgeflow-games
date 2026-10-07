"""Clip authoring library for VALE_BIPED_1 (CONTRACT §12 clips).

Model
  * A Pose is a dict: bone -> (x, y, z) Euler XYZ degrees in the bone's LOCAL rest frame (see the
    axis convention in rig.py), plus optional keys
        "hips_loc": (x, y, z) offset of the hips in armature/world metres (Z up, -Y front)
        "ik": {"foot.L": FootTarget, "hand.L": HandTarget, ...} solved after FK
  * A Clip is (name, frames, loop, sample(t) -> Pose). t runs 0..1 over frames 0..N inclusive,
    so a looping clip has sample(0) == sample(1). Clips are SAMPLED every frame (30 fps): easing,
    anticipation, overshoot and settle live in the sampling functions, so what you author is
    exactly what the glTF exporter (sampling at 30 fps) and three.js play.
  * Feet are planted with analytic two-bone IK (FootTarget), so idles/attacks never slide and the
    run cycle moves the planted foot backward at exactly `run_ref_speed`.
  * x_ chains (capes, tabards, tails) get a damped-spring secondary-motion pass driven by the
    parent's motion + gravity + optional drivers (e.g. tabard pushed by the thighs).

Timing rules (README): impact at 40 % of attack/cast clips (frame counts are multiples of 5 so
0.4*N is a whole frame), loops close exactly (first pose == last pose), no root motion, actions
named exactly as the clip and stashed on muted NLA tracks so the exporter emits one glTF
animation per clip.

Standard generators: standard_clips(skel, profile, overrides) -> {name: Clip} for
  idle, run, attack1, attack2, cast_a1 (thrust), cast_a2 (sweep), cast_a3 (overhead slam),
  cast_ult (channel-raise), death, recall, idle_lobby, victory, channel, dash, stunned.
Fighters override/add any clip: pass {name: Clip} or {name: callable(ctx) -> Clip}; the helpers
(keyed, cyclic, stance poses, weapon holds) are public for bespoke clips.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

FPS = 30
V = Vector
REQUIRED_CLIPS = ["idle", "run", "attack1", "attack2", "cast_a1", "cast_a2", "cast_a3", "cast_ult",
                  "death", "recall", "idle_lobby", "victory"]
OPTIONAL_CLIPS = ["channel", "dash", "stunned", "crit", "spawn", "taunt"]
IMPACT = 0.4


# ── motion profile ──────────────────────────────────────────────────────────────────────────────
WEIGHTS = {
    #          time  amp   stance_drop  contact  bob    lean
    "light":  (0.85, 0.85, 0.035,       0.28,    0.030, 9.0),
    "medium": (1.00, 1.00, 0.045,       0.32,    0.036, 11.0),
    "heavy":  (1.20, 1.15, 0.065,       0.38,    0.042, 13.0),
}
WEAPONS = ("none", "one_hand", "two_hand", "staff", "bow", "dual", "focus")


def motion_profile(weight: str = "medium", weapon: str = "one_hand", stance: str = "neutral",
                   run_ref_speed: float = 3.6, **extra) -> dict:
    """{weight: light|medium|heavy, weapon: none|one_hand|two_hand|staff|bow|dual|focus,
    stance: neutral|guard|wide|low, run_ref_speed: m/s}. Extra keys are free-form tuning knobs
    fighters can read in bespoke clips (e.g. arm_swing=0.7, stride=1.1, cadence=1.0)."""
    assert weight in WEIGHTS, weight
    assert weapon in WEAPONS, weapon
    p = {"weight": weight, "weapon": weapon, "stance": stance, "run_ref_speed": float(run_ref_speed)}
    p.update(extra)
    return p


def frames_for(base: int, profile: dict, multiple: int = 5) -> int:
    """Scale a medium-weight duration by the weight class, rounded to a multiple of 5 frames."""
    k = WEIGHTS[profile["weight"]][0]
    return max(multiple, int(round(base * k / multiple)) * multiple)


# ── easing ────────────────────────────────────────────────────────────────────────────────────
def linear(t): return t
def ease_in(t): return t * t * t
def ease_out(t): return 1 - (1 - t) ** 3
def ease_in_out(t): return 4 * t ** 3 if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2
def sine(t): return 0.5 - 0.5 * math.cos(math.pi * t)
def snap(t): return 1 - (1 - t) ** 5             # very fast start, long settle (impacts)
def accel(t): return t ** 2.2                     # strike: accelerate into the hit


def overshoot(amount: float = 1.6):
    """Ease-out that passes the target and settles back (back-ease)."""
    c = amount
    return lambda t: 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2


def settle(t):
    """Damped settle: overshoots ~6 % then rests."""
    return 1 - math.exp(-6 * t) * math.cos(7 * t) if t < 1 else 1.0


EASES = {"linear": linear, "in": ease_in, "out": ease_out, "inout": ease_in_out, "sine": sine,
         "snap": snap, "accel": accel, "back": overshoot(), "settle": settle}


# ── poses ─────────────────────────────────────────────────────────────────────────────────────
def P(**bones) -> dict:
    """Pose literal with python-friendly names: P(upper_arm_L=(..), hips_loc=(..)).
    `_L`/`_R` suffixes map to `.L`/`.R`."""
    out = {}
    for k, v in bones.items():
        if k.endswith("_L") or k.endswith("_R"):
            k = k[:-2] + "." + k[-1]
        out[k] = v
    return out


def mirror_name(n: str) -> str:
    if n.endswith(".L"):
        return n[:-2] + ".R"
    if n.endswith(".R"):
        return n[:-2] + ".L"
    return n


def _mirror_ik_key(k: str) -> str:
    if k.startswith("aim."):
        return "aim." + ("L" if k.endswith("R") else "R")
    return mirror_name(k)


def mirror(pose: dict) -> dict:
    """Swap sides; negate Y and Z rotations (bone-roll convention in rig.py); hips x mirrored."""
    out = {}
    for k, v in pose.items():
        if k == "hips_loc":
            out[k] = (-v[0], v[1], v[2])
        elif k == "ik":
            out[k] = {_mirror_ik_key(b): t.mirrored() for b, t in v.items()}
        else:
            out[mirror_name(k)] = (v[0], -v[1], -v[2])
    return out


def merge(*poses) -> dict:
    """Later poses override earlier ones bone by bone (ik dicts merge)."""
    out: dict = {}
    for p in poses:
        for k, v in p.items():
            if k == "ik":
                out.setdefault("ik", {}).update(v)
            else:
                out[k] = v
    return out


def add(base: dict, delta: dict, w: float = 1.0) -> dict:
    """Additive layer: base + w * delta (rotations and hips_loc)."""
    out = dict(base)
    for k, v in delta.items():
        if k == "ik":
            out.setdefault("ik", {})
            out["ik"] = dict(out["ik"])
            out["ik"].update(v)
            continue
        b = out.get(k, (0.0, 0.0, 0.0))
        out[k] = tuple(b[i] + w * v[i] for i in range(3))
    return out


def _faded(target, w: float):
    import copy
    c = copy.copy(target)
    c.weight = target.weight * w
    return c


def lerp_pose(a: dict, b: dict, t: float) -> dict:
    keys = set(a) | set(b)
    out = {}
    for k in keys:
        if k == "ik":
            ia, ib = a.get("ik", {}), b.get("ik", {})
            res = {}
            for n in set(ia) | set(ib):
                if n in ia and n in ib:
                    res[n] = ia[n].lerp(ib[n], t)
                elif n in ia:                      # target fades out (IK -> FK)
                    res[n] = _faded(ia[n], 1.0 - t)
                else:                              # target fades in
                    res[n] = _faded(ib[n], t)
            out["ik"] = res
            continue
        va = a.get(k, (0.0, 0.0, 0.0))
        vb = b.get(k, (0.0, 0.0, 0.0))
        out[k] = tuple(va[i] + (vb[i] - va[i]) * t for i in range(3))
    return out


def lerp_pose_w(a: dict, b: dict, t: float, weights: dict | None = None) -> dict:
    """lerp_pose with per-bone / per-IK-target factors: `weights` maps a bone name, 'hips_loc' or an
    IK key ('hand.L', 'aim.R', 'foot.L') to its own t. Successive breaking of joints: hips and
    spine at 0.6 while the arm is at 0.2 = the hips lead the strike; head at 0.6 of the follow =
    the head drags. Factors may lie outside 0..1 (anticipation counters, overshoots)."""
    if not weights:
        return lerp_pose(a, b, t)
    keys = set(a) | set(b)
    out = {}
    for k in keys:
        if k == "ik":
            ia, ib = a.get("ik", {}), b.get("ik", {})
            res = {}
            for n in set(ia) | set(ib):
                tt = weights.get(n, t)
                if n in ia and n in ib:
                    res[n] = ia[n].lerp(ib[n], tt) if not isinstance(ia[n], Aim) else ia[n].lerp(ib[n], min(1.0, max(0.0, tt)))
                elif n in ia:
                    res[n] = _faded(ia[n], 1.0 - min(1.0, max(0.0, tt)))
                else:
                    res[n] = _faded(ib[n], min(1.0, max(0.0, tt)))
            out["ik"] = res
            continue
        tt = weights.get(k, t)
        va = a.get(k, (0.0, 0.0, 0.0))
        vb = b.get(k, (0.0, 0.0, 0.0))
        out[k] = tuple(va[i] + (vb[i] - va[i]) * tt for i in range(3))
    return out


def drag(sample: Callable[[float], dict], frames: int, lags: dict, loop: bool = False) -> Callable[[float], dict]:
    """Overlap by TIME: the listed bones / IK keys sample the clip `lags[name]` frames late (> 0,
    drag) or early (< 0, lead). Use only on parts that do not carry the weapon (head, neck, a free
    off hand, x_ props) so the 40 % impact stays exact. Loops wrap; one-shots clamp."""
    def out(t: float) -> dict:
        p = dict(sample(t))
        cache: dict = {}
        for name, lag in lags.items():
            tt = t - lag / frames
            tt = tt % 1.0 if loop else min(1.0, max(0.0, tt))
            q = cache.get(tt)
            if q is None:
                q = cache[tt] = sample(tt)
            if name in q.get("ik", {}):
                p["ik"] = dict(p.get("ik", {}))
                p["ik"][name] = q["ik"][name]
            elif name in q:
                p[name] = q[name]
        return p
    return out


@dataclass
class FootTarget:
    """Planted/animated foot: `ankle` offset (m, world) from the rest ankle, `pitch` (deg, + toes
    up) pivoting about the heel (pitch > 0) or the ball (pitch < 0), `yaw` (deg), `toe` (deg)
    extra toe bend; `knee` = knee direction offset (deg yaw of the pole). `ik` weight 0 = FK."""
    ankle: tuple = (0.0, 0.0, 0.0)
    pitch: float = 0.0
    yaw: float = 0.0
    toe: float = 0.0
    knee: float = 0.0
    weight: float = 1.0

    def lerp(self, o: "FootTarget", t: float) -> "FootTarget":
        f = lambda a, b: a + (b - a) * t  # noqa: E731
        return FootTarget(tuple(f(self.ankle[i], o.ankle[i]) for i in range(3)), f(self.pitch, o.pitch),
                          f(self.yaw, o.yaw), f(self.toe, o.toe), f(self.knee, o.knee), f(self.weight, o.weight))

    def mirrored(self) -> "FootTarget":
        return FootTarget((-self.ankle[0], self.ankle[1], self.ankle[2]), self.pitch, -self.yaw, self.toe,
                          -self.knee, self.weight)


@dataclass
class HandTarget:
    """Hand IK target. One of:
      rel     wrist position relative to the POSED shoulder joint, in arm lengths, expressed in
              the chest's frame (so torso twist carries the arm: arcs come from the body).
              Character axes: +X left, -Y front, +Z up. Proportion-independent.
      pos     absolute armature-space position (m) — planted hands.
      to_prop (socket, offset m along the held item's axis) — off hand grabbing a two-handed
              weapon held by the other hand.
    pole: elbow direction (chest frame); default out/back/down for the side."""
    rel: tuple | None = None
    pos: tuple | None = None
    to_prop: tuple | None = None
    pole: tuple | None = None
    weight: float = 1.0

    def lerp(self, o: "HandTarget", t: float) -> "HandTarget":
        def lv(a, b):
            if a is None or b is None:
                return b if t >= 0.5 else a
            return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))
        tp = o.to_prop if t >= 0.5 else self.to_prop
        if self.to_prop and o.to_prop and self.to_prop[0] == o.to_prop[0]:
            tp = (self.to_prop[0], self.to_prop[1] + (o.to_prop[1] - self.to_prop[1]) * t)
        return HandTarget(lv(self.rel, o.rel), lv(self.pos, o.pos), tp, lv(self.pole, o.pole),
                          self.weight + (o.weight - self.weight) * t)

    def mirrored(self) -> "HandTarget":
        mx = (lambda v: (-v[0], v[1], v[2]) if v else None)  # noqa: E731
        tp = (mirror_name(self.to_prop[0]), self.to_prop[1]) if self.to_prop else None
        return HandTarget(mx(self.rel), mx(self.pos), tp, mx(self.pole), self.weight)


def hand(side: str, x: float, y: float, z: float, pole=None, w: float = 1.0) -> dict:
    """{'hand.S': HandTarget(rel=(x, y, z))} — x is mirrored by the caller (write the right
    hand with -x for outward)."""
    return {f"hand.{side}": HandTarget(rel=(x, y, z), pole=pole, weight=w)}


@dataclass
class Aim:
    """Point a held item: rotate the hand so its prop socket's +Y (the item's main axis) points
    along `dir` (character space: +X left, -Y front, +Z up). Solved after FK/IK, minimal wrist
    rotation. Use 'aim.R' / 'aim.L' keys in pose['ik']."""
    dir: tuple = (0.0, -1.0, 0.0)
    weight: float = 1.0

    def lerp(self, o: "Aim", t: float) -> "Aim":
        t = max(0.0, min(1.0, t))                 # aims never extrapolate (slerp past the target flips)
        a, b = V(self.dir).normalized(), V(o.dir).normalized()
        if a.dot(b) < -0.999:
            d = a.lerp(b, t) + a.orthogonal() * 1e-3
        else:
            d = a.slerp(b, t) if a.length > 0 and b.length > 0 else b
        return Aim(tuple(d.normalized()), self.weight + (o.weight - self.weight) * t)

    def mirrored(self) -> "Aim":
        return Aim((-self.dir[0], self.dir[1], self.dir[2]), self.weight)


def aim(x: float, y: float, z: float, side: str = "R", w: float = 1.0) -> dict:
    return {f"aim.{side}": Aim((x, y, z), w)}


# ── skeleton: FK + analytic IK ──────────────────────────────────────────────────────────────────
class Skeleton:
    """Rest data + forward kinematics of an armature, in armature space (armature at origin)."""

    def __init__(self, arm: bpy.types.Object):
        self.arm = arm
        self.rest = {b.name: b.matrix_local.copy() for b in arm.data.bones}
        self.parent = {b.name: (b.parent.name if b.parent else None) for b in arm.data.bones}
        self.length = {b.name: b.length for b in arm.data.bones}
        self.order = [b.name for b in arm.data.bones]          # parents before children
        self.local = {}
        for b in arm.data.bones:
            if b.parent:
                self.local[b.name] = self.rest[b.parent.name].inverted() @ self.rest[b.name]
            else:
                self.local[b.name] = self.rest[b.name].copy()
        self.chains: dict[str, list[str]] = {}
        names = set(self.rest)
        self.bones = names

    def basis(self, pose: dict, b: str) -> Matrix:
        r = pose.get(b)
        m = Euler([math.radians(a) for a in r], "XYZ").to_matrix().to_4x4() if r else Matrix.Identity(4)
        if b == "hips" and "hips_loc" in pose:
            off = V(pose["hips_loc"])
            loc = self.rest["hips"].to_3x3().transposed() @ off
            m = Matrix.Translation(loc) @ m
        return m

    def fk(self, pose: dict, upto: set | None = None) -> dict:
        M = {}
        for b in self.order:
            p = self.parent[b]
            base = M[p] @ self.local[b] if p else self.local[b]
            M[b] = base @ self.basis(pose, b)
        return M

    # rotation helpers
    @staticmethod
    def euler_of(m3: Matrix, prev=None) -> tuple:
        e = m3.to_euler("XYZ", Euler([math.radians(a) for a in prev], "XYZ")) if prev else m3.to_euler("XYZ")
        return tuple(math.degrees(a) for a in e)

    def rest_point(self, name: str) -> V:
        return self.rest[name].translation.copy()

    def solve_two_bone(self, pose: dict, M: dict, upper: str, lower: str, end: str, target: V, pole: V,
                       z_to_pole: bool, end_frame: Matrix | None = None, weight: float = 1.0) -> None:
        """Set pose rotations of upper/lower (and `end` when end_frame is given: desired world
        3x3 frame of the end bone) so the end bone's head reaches `target`."""
        par = self.parent[upper]
        Pu = M[par] @ self.local[upper]
        H = Pu.translation
        L1, L2 = self.length[upper], self.length[lower]
        d = target - H
        dist = max(abs(L1 - L2) + 1e-4, min(L1 + L2 - 1e-4, d.length))
        a = d.normalized()
        p = pole - a * pole.dot(a)
        if p.length < 1e-6:
            p = a.orthogonal()
        p.normalize()
        u = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist)
        v = math.sqrt(max(0.0, L1 * L1 - u * u))
        K = H + a * u + p * v
        A = H + a * dist
        Y1 = (K - H).normalized()
        zt = p if z_to_pole else -p
        Z1 = (zt - Y1 * zt.dot(Y1)).normalized()
        X1 = Y1.cross(Z1).normalized()
        F1 = Matrix((X1, Y1, Z1)).transposed()
        B1 = Pu.to_3x3().inverted() @ F1
        e1 = self.euler_of(B1, pose.get(upper))
        Mu = Matrix.Translation(H) @ F1.to_4x4()
        Pl = Mu @ self.local[lower]
        Y2 = (A - K).normalized()
        X2 = X1
        Z2 = X2.cross(Y2).normalized()
        F2 = Matrix((X2, Y2, Z2)).transposed()
        B2 = Pl.to_3x3().inverted() @ F2
        e2 = self.euler_of(B2, pose.get(lower))
        if weight < 1.0:
            e1 = _lerp3(pose.get(upper, (0, 0, 0)), e1, weight)
            e2 = _lerp3(pose.get(lower, (0, 0, 0)), e2, weight)
        pose[upper], pose[lower] = e1, e2
        if end_frame is not None:
            Ml = Matrix.Translation(K) @ F2.to_4x4()
            Pe = Ml @ self.local[end]
            Be = Pe.to_3x3().inverted() @ end_frame
            ee = self.euler_of(Be, pose.get(end))
            pose[end] = _lerp3(pose.get(end, (0, 0, 0)), ee, weight) if weight < 1 else ee


def _lerp3(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def resolve(skel: Skeleton, pose: dict) -> dict:
    """Apply IK targets in `pose['ik']` and return a plain pose (bone -> euler, hips_loc).
    Order: feet -> hand reach (rel/pos) -> aims -> off-hand grips on held items (to_prop)."""
    pose = {k: v for k, v in pose.items()}
    ik = pose.pop("ik", None)
    if not ik:
        return pose
    M = skel.fk(pose)
    for side in ("L", "R"):
        ft = ik.get(f"foot.{side}")
        if ft is not None and ft.weight > 0:
            _solve_foot(skel, pose, M, side, ft)
    M = skel.fk(pose)
    for side in ("R", "L"):                                  # arm reach (rel / pos)
        ht = ik.get(f"hand.{side}")
        if ht is not None and ht.weight > 0 and not ht.to_prop:
            _solve_hand(skel, pose, M, side, ht)
            M = skel.fk(pose)
    for side in ("R", "L"):                                  # point held items
        am = ik.get(f"aim.{side}")
        ht = ik.get(f"hand.{side}")
        if am is not None and am.weight > 0 and not (ht and ht.to_prop):
            _solve_aim(skel, pose, M, side, am)
            M = skel.fk(pose)
    for side in ("R", "L"):                                  # off hand grabs the other's item
        ht = ik.get(f"hand.{side}")
        if ht is not None and ht.weight > 0 and ht.to_prop:
            _solve_hand(skel, pose, M, side, ht)
            M = skel.fk(pose)
    return pose


def _solve_aim(skel: Skeleton, pose: dict, M: dict, side: str, am: Aim) -> None:
    hand, prop = f"hand.{side}", f"prop.{side}"
    cur = M[prop].to_3x3().col[1].normalized()
    want = V(am.dir).normalized()
    q = cur.rotation_difference(want)
    if am.weight < 1.0:
        q = Quaternion().slerp(q, am.weight)
    new = q.to_matrix() @ M[hand].to_3x3()
    Ph = (M[skel.parent[hand]] @ skel.local[hand]).to_3x3()
    pose[hand] = skel.euler_of(Ph.inverted() @ new, pose.get(hand))


def _solve_foot(skel: Skeleton, pose: dict, M: dict, side: str, ft: FootTarget) -> None:
    foot, toe = f"foot.{side}", f"toe.{side}"
    rest_f = skel.rest[foot]
    ankle0 = rest_f.translation.copy()
    ball0 = skel.rest[toe].translation.copy()
    heel0 = ankle0 + V((0, 0, -ankle0.z)) + (ankle0 - ball0) * V((1, 1, 0)) * 0.55
    off = V(ft.ankle)
    # foot rotation in world: yaw about Z at the ankle, then pitch about the foot's lateral axis
    lat = rest_f.to_3x3().col[0].normalized()                     # foot local X ~ -X world
    rot = Matrix.Rotation(math.radians(ft.yaw), 3, "Z") @ Matrix.Rotation(math.radians(-ft.pitch), 3, lat)
    pivot = (heel0 if ft.pitch > 0 else ball0) + off
    ankle_t = pivot + rot @ (ankle0 + off - pivot)
    knee_dir = Matrix.Rotation(math.radians(ft.yaw + ft.knee), 3, "Z") @ V((0, -1, 0))
    # include the pelvis yaw so knees follow hips orientation
    hips_fwd = M["hips"].to_3x3() @ (skel.rest["hips"].to_3x3().inverted() @ V((0, -1, 0)))
    hips_fwd.z = 0
    if hips_fwd.length > 1e-4:
        knee_dir = (knee_dir + hips_fwd.normalized()).normalized()
    end_frame = rot @ rest_f.to_3x3()
    skel.solve_two_bone(pose, M, f"thigh.{side}", f"shin.{side}", foot, ankle_t, knee_dir, True, end_frame,
                        ft.weight)
    t = pose.get(toe, (0.0, 0.0, 0.0))
    toe_counter = -ft.pitch if ft.pitch < 0 else 0.0
    pose[toe] = (t[0] + (toe_counter + ft.toe) * ft.weight, t[1], t[2])


def _solve_hand(skel: Skeleton, pose: dict, M: dict, side: str, ht: HandTarget) -> None:
    hnd, up, fo = f"hand.{side}", f"upper_arm.{side}", f"forearm.{side}"
    sx = 1.0 if side == "L" else -1.0
    Rc = M["chest"].to_3x3() @ skel.rest["chest"].to_3x3().inverted()
    pole = Rc @ V(ht.pole if ht.pole else (0.75 * sx, 0.55, -0.55))
    end_frame = None
    if ht.to_prop:
        sock, along = ht.to_prop
        Mp = M[sock]
        axis = Mp.to_3x3().col[1].normalized()          # prop bone +Y = held item's main axis
        grip = Mp.translation + axis * along
        own = f"prop.{side}"
        palm_off = skel.rest[own].translation - skel.rest[hnd].translation
        hand_rest = skel.rest[hnd].to_3x3()
        rel = hand_rest.inverted() @ skel.rest[own].to_3x3()
        fwd = (grip - (M[skel.parent[up]] @ skel.local[up]).translation).normalized()
        end_frame = _frame_from(axis, fwd, rel)
        target = grip - end_frame @ (hand_rest.inverted() @ palm_off)
    elif ht.rel is not None:
        L = skel.length[up] + skel.length[fo]
        sh = (M[skel.parent[up]] @ skel.local[up]).translation
        target = sh + Rc @ (V(ht.rel) * L)
    else:
        target = V(ht.pos)
    skel.solve_two_bone(pose, M, up, fo, hnd, target, pole, False, end_frame, ht.weight)


def _frame_from(prop_axis: V, forearm_dir: V, rel: Matrix) -> Matrix:
    """World 3x3 hand frame whose prop axis (rel.col[1] in hand space) equals prop_axis and whose
    Y (bone axis) stays as close as possible to forearm_dir."""
    a_local = rel.col[1].normalized()
    y_local = V((0, 1, 0))
    # build world frame: find R with R@a_local = prop_axis, R@y_local ~ forearm_dir
    y_w = (forearm_dir - prop_axis * forearm_dir.dot(prop_axis))
    if y_w.length < 1e-5:
        y_w = prop_axis.orthogonal()
    y_w.normalize()
    # local orthonormal basis (a, y', c) and world (prop_axis, y_w, c_w)
    yl = (y_local - a_local * y_local.dot(a_local)).normalized()
    cl = a_local.cross(yl)
    cw = prop_axis.cross(y_w)
    Lm = Matrix((a_local, yl, cl)).transposed()
    Wm = Matrix((prop_axis, y_w, cw)).transposed()
    return Wm @ Lm.inverted()


# ── clips ─────────────────────────────────────────────────────────────────────────────────────
@dataclass
class Clip:
    name: str
    frames: int
    loop: bool
    sample: Callable[[float], dict]
    impact: float | None = None
    secondary: bool = True
    meta: dict = field(default_factory=dict)

    @property
    def duration(self) -> float:
        return self.frames / FPS


def keyed(keys, base: dict | None = None) -> Callable[[float], dict]:
    """Key poses: [(t, pose, ease)] with t in 0..1; `ease` shapes the segment ARRIVING at the key.
    Missing bones fall back to `base`."""
    keys = sorted(keys, key=lambda k: k[0])
    base = base or {}

    def full(p):
        return merge(base, p) if base else p

    fulls = [(t, full(p), EASES[e] if isinstance(e, str) else e) for t, p, e in keys]

    def sample(t: float) -> dict:
        if t <= fulls[0][0]:
            return fulls[0][1]
        for i in range(1, len(fulls)):
            t0, p0, _ = fulls[i - 1]
            t1, p1, ez = fulls[i]
            if t <= t1:
                u = (t - t0) / max(1e-9, t1 - t0)
                return lerp_pose(p0, p1, ez(u))
        return fulls[-1][1]

    return sample


def layered(*fns) -> Callable[[float], dict]:
    """First fn gives the base pose; later fns return additive deltas."""
    def sample(t):
        p = fns[0](t)
        for f in fns[1:]:
            p = add(p, f(t))
        return p
    return sample


def osc(t: float, cycles: float = 1.0, phase: float = 0.0) -> float:
    return math.sin(2 * math.pi * (cycles * t + phase))


# ── stance / weapon holds (authored for VALE_BIPED_1 rest A-pose) ────────────────────────────────
# Arms are blocked like an animator with IK controls: wrist targets relative to the shoulder in
# arm lengths (chest space, so torso twist drives arcs), elbow poles, and an `aim` for the held
# item. Right-hand values use -x for "outward"; left-hand values use +x for outward.
def feet(l=(0.0, 0.0, 0.0), r=(0.0, 0.0, 0.0), yl=0.0, yr=0.0, pl=0.0, pr=0.0, tl=0.0, tr=0.0, kl=0.0, kr=0.0,
         wl=1.0, wr=1.0) -> dict:
    return {"foot.L": FootTarget(l, pl, yl, tl, kl, wl), "foot.R": FootTarget(r, pr, yr, tr, kr, wr)}


STANCE_FEET = {
    "guard": dict(l=(0.03, -0.12, 0), r=(-0.05, 0.12, 0), yl=-6, yr=-26),
    "wide": dict(l=(0.09, -0.03, 0), r=(-0.09, 0.03, 0), yl=12, yr=-12),
    "low": dict(l=(0.07, -0.12, 0), r=(-0.07, 0.13, 0), yl=0, yr=-20),
    "neutral": dict(l=(0.0, -0.02, 0), r=(0.0, 0.03, 0), yl=4, yr=-6),
}


def stance(profile: dict, crouch: float = 1.0) -> dict:
    """Lower body + torso base for the profile's stance (feet planted via IK)."""
    w = WEIGHTS[profile["weight"]]
    drop = w[2] * crouch
    st = profile.get("stance", "neutral")
    if st == "guard":
        torso = P(hips=(3, -12, 0), spine=(3, 5, 0), chest=(2, 5, 0), neck=(-2, 2, 0), head=(-3, 0, 0))
    elif st == "wide":
        torso = P(hips=(3, 0, 0), spine=(3, 0, 0), chest=(3, 0, 0), neck=(-3, 0, 0), head=(-3, 0, 0))
        drop *= 1.4
    elif st == "low":
        torso = P(hips=(9, -8, 0), spine=(8, 4, 0), chest=(6, 3, 0), neck=(-8, 0, 0), head=(-8, 0, 0))
        drop *= 1.8
    else:
        torso = P(hips=(1, -4, 0), spine=(2, 2, 0), chest=(1, 2, 0), neck=(-1, 1, 0), head=(-2, 1, 0))
    return merge(torso, {"hips_loc": (0.0, 0.01, -drop), "ik": feet(**STANCE_FEET.get(st, STANCE_FEET["neutral"]))})


def arms_relaxed() -> dict:
    """FK fallback: arms down at the sides from the A-pose (left authored, right mirrored)."""
    left = P(shoulder_L=(0, 0, -4), upper_arm_L=(14, 12, -38), forearm_L=(22, 0, 0), hand_L=(4, 0, -6))
    return merge(left, mirror(left))


def _hl(side, rel, pole=None, w=1.0):
    return {f"hand.{side}": HandTarget(rel=tuple(rel), pole=tuple(pole) if pole else None, weight=w)}


def _aim(side, d, w=1.0):
    return {f"aim.{side}": Aim(tuple(d), w)}


# Key arm/weapon blocks for the one-handed baseline: name -> (R wrist, R pole, R aim, L wrist, L pole)
ONE_HAND = {
    "guard":   ((0.07, -0.52, -0.78), (-0.8, 0.5, -0.4), (-0.12, -0.50, 0.86), (-0.07, -0.37, -0.83), None),
    "run_fwd": ((0.18, -0.58, -0.62), (-0.8, 0.4, -0.4), (-0.35, 0.40, -0.85), (-0.15, -0.58, -0.62), None),
    "run_back": ((-0.12, 0.34, -0.80), (-0.6, 0.7, -0.2), (-0.45, 0.55, -0.70), (0.12, 0.34, -0.80), None),
    # attack1: forehand diagonal (high right -> low left)
    "a1_wind": ((-0.10, 0.06, 0.40), (-1.0, 0.2, -0.2), (0.25, 0.60, 0.75), (0.05, -0.70, -0.45), None),
    "a1_hit":  ((0.40, -0.75, -0.50), (-0.6, 0.3, -0.7), (0.50, -0.70, -0.50), (0.10, -0.10, -0.90), None),
    "a1_fol":  ((0.62, -0.50, -0.60), (-0.4, 0.5, -0.7), (0.80, -0.30, -0.50), (0.15, 0.10, -0.88), None),
    # attack2: backhand horizontal (left -> right)
    "a2_wind": ((0.60, -0.45, -0.55), (0.0, -0.8, 0.5), (0.60, 0.65, 0.40), (0.05, -0.50, -0.75), None),
    "a2_hit":  ((-0.35, -0.85, -0.30), (-0.7, 0.3, -0.6), (-0.50, -0.85, 0.05), (0.20, 0.20, -0.85), None),
    "a2_fol":  ((-0.80, -0.45, -0.25), (-0.5, 0.6, -0.6), (-0.95, 0.20, 0.0), (0.25, 0.25, -0.85), None),
    # thrust (cast_a1)
    "th_wind": ((-0.10, 0.28, -0.85), (-0.7, 0.6, -0.3), (0.0, -1.0, 0.05), (0.05, -0.75, -0.35), None),
    "th_hit":  ((0.15, -0.97, -0.20), (-0.8, 0.2, -0.6), (0.05, -1.0, 0.0), (0.30, 0.45, -0.72), None),
    "th_fol":  ((0.16, -0.98, -0.18), (-0.8, 0.2, -0.6), (0.05, -1.0, 0.02), (0.32, 0.48, -0.70), None),
    # sweep (cast_a2): wide low arc, left -> right
    "sw_wind": ((0.75, -0.10, -0.65), (0.2, -0.6, 0.6), (0.75, 0.45, -0.45), (0.55, 0.40, -0.60), None),
    "sw_hit":  ((-0.45, -0.80, -0.45), (-0.7, 0.3, -0.6), (-0.55, -0.80, -0.20), (0.85, -0.10, -0.30), None),
    "sw_fol":  ((-0.85, -0.15, -0.45), (-0.5, 0.6, -0.6), (-0.95, 0.25, -0.15), (0.85, -0.25, -0.30), None),
    # slam (cast_a3): overhead -> ground
    "sl_wind": ((0.22, 0.05, 0.95), (-0.8, -0.3, 0.3), (0.0, 0.55, 0.85), (-0.22, 0.05, 0.95), None),
    "sl_hit":  ((0.25, -0.75, -0.55), (-0.8, 0.3, -0.3), (0.0, -0.55, -0.85), (-0.15, -0.60, -0.60), None),
    "sl_fol":  ((0.25, -0.70, -0.62), (-0.8, 0.3, -0.3), (0.0, -0.45, -0.90), (-0.15, -0.55, -0.65), None),
    # raise (cast_ult): gather -> sky -> hold
    "ra_wind": ((0.35, -0.45, -0.45), (-0.8, 0.4, -0.3), (0.0, -0.30, -0.95), (-0.30, -0.45, -0.45), None),
    "ra_hit":  ((0.10, -0.10, 0.99), (-0.9, -0.2, 0.2), (0.0, -0.05, 1.0), (0.60, -0.20, 0.70), (1.0, -0.2, 0.2)),
    "ra_fol":  ((0.10, -0.12, 0.98), (-0.9, -0.2, 0.2), (0.0, -0.08, 1.0), (0.62, -0.25, 0.65), (1.0, -0.2, 0.2)),
    # misc
    "lobby":   ((0.02, -0.42, -0.30), (-0.9, 0.3, -0.3), (-0.40, 0.72, 0.56), (0.15, 0.10, -0.75), (1.0, 0.2, 0.0)),
    "victory": ((-0.05, -0.15, 0.98), (-0.9, -0.2, 0.2), (0.0, -0.10, 1.0), (0.15, 0.10, -0.75), (1.0, 0.2, 0.0)),
    "recall":  ((0.25, -0.62, -0.70), (-0.8, 0.4, -0.2), (0.0, -0.20, -0.98), (0.20, -0.78, 0.15), None),
    "channel": ((0.15, -0.70, -0.50), (-0.8, 0.4, -0.3), (-0.10, -0.60, 0.80), (-0.10, -0.85, -0.30), None),
    "dash":    ((-0.20, 0.60, -0.70), (-0.7, 0.5, 0.2), (-0.30, 0.80, -0.40), (0.20, 0.60, -0.70), None),
    "stunned": ((-0.05, -0.28, -0.95), (-0.8, 0.5, -0.3), (-0.20, -0.30, -0.93), (0.05, -0.20, -0.96), None),
}
FISTS = {"guard": ((0.30, -0.55, -0.25), (-0.8, 0.4, -0.5)), "jab": ((0.15, -0.98, -0.05), (-0.8, 0.2, -0.4))}


def arm_block(profile: dict, key: str, blend: float | None = None, key2: str | None = None) -> dict:
    """IK + aim dict for arm block `key` (optionally blended toward key2 by `blend`) adapted to the
    profile's weapon type."""
    w = profile["weapon"]
    table = dict(ONE_HAND, **(profile.get("blocks") or {}))      # per-fighter arm blocks (motion profile)
    blk = table[key]
    if key2 is not None:
        b2 = table[key2]
        t = blend
        lerp3 = lambda a, b: tuple(a[i] + (b[i] - a[i]) * t for i in range(3)) if a and b else (a or b)  # noqa
        blk = tuple(lerp3(blk[i], b2[i]) for i in range(5))
    rR, pR, aR, rL, pL = blk
    ik = {}
    if w in ("one_hand", "two_hand", "staff", "dual"):
        ik.update(_hl("R", rR, pR))
        ik.update(_aim("R", aR))
        if w == "dual":
            ik.update(_hl("L", rL, pL))
            if key in ("guard", "run_fwd", "run_back", "dash", "stunned", "lobby", "channel"):
                m = {"aim.L": Aim((-aR[0], aR[1], aR[2]))}
            else:
                m = {"aim.L": Aim((0.2, -0.6, -0.75))}
            ik.update(m)
        elif w in ("two_hand", "staff"):
            # bring the main hand toward the centre line, off hand grips the haft
            ik["hand.R"] = HandTarget(rel=(rR[0] * 0.8 + 0.12, rR[1], rR[2]), pole=pR)
            ik["hand.L"] = HandTarget(to_prop=("prop.R", -0.17 if w == "two_hand" else 0.36), pole=(0.8, 0.4, -0.4))
        else:
            ik.update(_hl("L", rL, pL))
    elif w == "bow":
        ik.update(_hl("L", (-rR[0], rR[1], rR[2]), (0.8, 0.4, -0.4)))
        ik.update(_aim("L", (-aR[0], aR[1], aR[2]) if key not in ("guard", "run_fwd", "run_back") else (0.1, -0.3, -0.95)))
        ik.update(_hl("R", (-rL[0] if rL else 0.0, rL[1], rL[2]) if rL else (0.0, -0.3, -0.9), None))
    elif w == "focus":
        ik.update(_hl("L", (-0.10, -0.62, -0.48), (0.8, 0.5, -0.3)))
        ik.update(_hl("R", rR, pR))
    else:  # none: fists
        ik.update(_hl("R", rR, pR))
        ik.update(_hl("L", (-rL[0], rL[1], rL[2]) if rL else (0.3, -0.55, -0.25), pL))
    return {"ik": ik}


def weapon_hold(profile_or_weapon) -> dict:
    """Guard arms for the weapon type (IK blocks over the relaxed FK arms)."""
    profile = profile_or_weapon if isinstance(profile_or_weapon, dict) else {"weapon": profile_or_weapon}
    if profile["weapon"] == "none":
        g, p = FISTS["guard"]
        ik = {}
        ik.update(_hl("R", g, p))
        ik.update(_hl("L", (-g[0], g[1], g[2]), (-p[0], p[1], p[2])))
        return merge(arms_relaxed(), {"ik": ik})
    return merge(arms_relaxed(), arm_block(profile, "guard"))


def guard(profile: dict, crouch: float = 1.0) -> dict:
    return merge(stance(profile, crouch), weapon_hold(profile))


# ── standard generators ───────────────────────────────────────────────────────────────────────
def _scale(p: dict, k: float) -> dict:
    return {key: (tuple(c * k for c in v) if key not in ("ik", "hips_loc") else v) for key, v in p.items()}


def _with_hips(pose: dict, d=(0.0, 0.0, 0.0)) -> dict:
    hx, hy, hz = pose.get("hips_loc", (0.0, 0.0, 0.0))
    out = dict(pose)
    out["hips_loc"] = (hx + d[0], hy + d[1], hz + d[2])
    return out


def _nudge_hands(pose: dict, dR=(0, 0, 0), dL=(0, 0, 0)) -> dict:
    out = dict(pose)
    ik = dict(out.get("ik", {}))
    for side, d in (("R", dR), ("L", dL)):
        h = ik.get(f"hand.{side}")
        if h is not None and h.rel is not None:
            ik[f"hand.{side}"] = HandTarget(tuple(h.rel[i] + d[i] for i in range(3)), h.pos, h.to_prop, h.pole, h.weight)
    out["ik"] = ik
    return out


def gen_idle(profile: dict) -> Clip:
    base = guard(profile)
    amp = WEIGHTS[profile["weight"]][1]
    N = 72

    def sample(t):
        b = osc(t, 2)                     # breathing: 2 breaths per loop
        s = osc(t, 1, 0.1)                # weight shift
        d = P(chest=(1.2 * b, 0, 0), spine=(0.5 * b, 0, 0.6 * s), neck=(-0.8 * b, 0, 0), head=(-0.4 * b, 1.5 * s, 0),
              shoulder_L=(0, 0, 1.4 * b), shoulder_R=(0, 0, -1.4 * b), hips=(0, 1.2 * s, -1.0 * s))
        p = add(base, _scale(d, amp))
        p = _nudge_hands(p, (0.0, 0.0, 0.012 * osc(t, 2, 0.08) * amp), (0.0, 0.0, 0.012 * osc(t, 2, 0.15) * amp))
        return _with_hips(p, (0.012 * s * amp, 0.0, -0.004 * (0.5 + 0.5 * b) * amp))

    return Clip("idle", N, True, sample)


def gen_run(profile: dict) -> Clip:
    """Run cycle authored for profile['run_ref_speed']: contact / down / passing / up with exact
    planted-foot speed (no foot slide when played at that speed)."""
    v = profile["run_ref_speed"]
    tm, amp, drop, c, bob, lean = WEIGHTS[profile["weight"]]
    cadence = profile.get("cadence", 1.0)
    N = int(round(20 * tm / cadence / 2)) * 2                  # frames per cycle (2 steps)
    T = N / FPS
    Ls = v * c * T                                              # foot travel during contact
    weapon = profile["weapon"]
    arm_amp = profile.get("arm_swing", 1.0)

    # swing path keys relative to the rest ankle: (q in swing 0..1, dy, dz, pitch)
    swing = [(0.00, Ls / 2, 0.0, -32.0), (0.18, Ls / 2 + 0.10, 0.20, -58.0), (0.42, 0.10, 0.36, -38.0),
             (0.66, -Ls / 2 - 0.06, 0.24, -4.0), (0.86, -Ls / 2 - 0.03, 0.08, 10.0), (1.00, -Ls / 2, 0.0, 9.0)]

    def swing_at(s):
        for i in range(1, len(swing)):
            if s <= swing[i][0]:
                a, b = swing[i - 1], swing[i]
                u = sine((s - a[0]) / (b[0] - a[0]))
                return tuple(a[k] + (b[k] - a[k]) * u for k in (1, 2, 3))
        return swing[-1][1:]

    def foot_at(q):
        q %= 1.0
        if q < c:                                               # contact: exact v backward
            u = q / c
            y = -Ls / 2 + Ls * u
            pitch = 9.0 * (1 - sine(min(1.0, u / 0.25))) - 32.0 * max(0.0, (u - 0.62) / 0.38) ** 1.6
            return (0.0, y, 0.0), pitch
        dy, dz, pitch = swing_at((q - c) / (1 - c))
        return (0.0, dy, dz), pitch

    def sample(t):
        q = t % 1.0
        fl, pl = foot_at(q)
        fr, pr = foot_at(q + 0.5)
        z = -drop - 0.012 - bob * math.cos(2 * math.pi * (2 * q - c)) * 0.5 - bob * 0.5
        x = 0.012 * math.cos(2 * math.pi * (q - c / 2))
        yaw = -7.0 * amp * math.cos(2 * math.pi * q)
        roll = 3.5 * amp * math.sin(2 * math.pi * (q - c / 2))
        ch_yaw = 9.0 * amp * math.cos(2 * math.pi * q)
        sw = arm_amp * math.cos(2 * math.pi * (q - 0.03))      # + = left leg forward -> right arm forward;
                                                                # arms trail the hips by ~0.6 frame (overlap)
        pose = merge(arms_relaxed(), P(
            hips=(lean * 0.45, yaw, roll), spine=(lean * 0.25, ch_yaw * 0.4, -roll * 0.6),
            chest=(lean * 0.25 + 1.5 * math.cos(4 * math.pi * q), ch_yaw * 0.6, -roll * 0.3),
            neck=(-lean * 0.45, -(yaw + ch_yaw) * 0.35, 0), head=(-lean * 0.35, -(yaw + ch_yaw) * 0.25, 0),
            shoulder_L=(0, 0, -3 - 2 * sw), shoulder_R=(0, 0, 3 - 2 * sw)))
        tR = 0.5 - 0.5 * sw                                     # 0 = right arm forward, 1 = back
        arms = arm_block(profile, "run_fwd", tR, "run_back")
        ikL = {}
        if weapon not in ("two_hand", "staff", "dual", "bow"):
            tL = 0.5 + 0.5 * sw
            blk = arm_block(profile, "run_fwd", tL, "run_back")["ik"]
            if "hand.L" in blk:
                ikL["hand.L"] = blk["hand.L"]
        if weapon == "none":
            arms = {"ik": {}}
            for side, tt in (("R", tR), ("L", 0.5 + 0.5 * sw)):
                f = ONE_HAND["run_fwd"][0]
                bk = ONE_HAND["run_back"][0]
                r = tuple(f[i] + (bk[i] - f[i]) * tt for i in range(3))
                if side == "L":
                    r = (-r[0], r[1], r[2])
                arms["ik"][f"hand.{side}"] = HandTarget(rel=r)
        ik = dict(arms["ik"])
        ik.update(ikL)
        ik["foot.L"] = FootTarget((0.012 + fl[0], fl[1] - 0.02, fl[2]), pl, -4, 0, 0)
        ik["foot.R"] = FootTarget((-0.012 + fr[0], fr[1] - 0.02, fr[2]), pr, 4, 0, 0)
        pose["hips_loc"] = (x, 0.02, z)
        pose["ik"] = ik
        return pose

    return Clip("run", N, True, sample, meta={"run_ref_speed": v, "stride_m": round(v * T / 2, 3),
                                              "cycle_s": round(T, 3)})


# torso/hips blocks per gesture: (wind, hit, follow) deltas over the guard stance
TORSO = {
    "attack1": (P(hips=(0, -10, 0), spine=(-3, -10, 3), chest=(-5, -16, 5), head=(0, 10, 0)),
                P(hips=(4, 12, 0), spine=(6, 12, -3), chest=(8, 16, -5), head=(0, -12, 0)),
                P(hips=(5, 16, 0), spine=(8, 15, -3), chest=(9, 20, -6), head=(0, -14, 0))),
    "attack2": (P(hips=(2, 14, 0), spine=(2, 12, 0), chest=(4, 18, 0), head=(0, -12, 0)),
                P(hips=(3, -14, 0), spine=(4, -12, 0), chest=(5, -18, 0), head=(0, 12, 0)),
                P(hips=(3, -18, 0), spine=(4, -15, 0), chest=(5, -22, 0), head=(0, 14, 0))),
    "thrust": (P(hips=(-2, -16, 0), spine=(-3, -10, 0), chest=(-5, -12, 0), head=(4, 10, 0)),
               P(hips=(10, 12, 0), spine=(8, 6, 0), chest=(8, 8, 0), head=(-10, -6, 0)),
               P(hips=(12, 13, 0), spine=(9, 7, 0), chest=(9, 9, 0), head=(-12, -7, 0))),
    "sweep": (P(hips=(4, 24, 0), spine=(4, 16, 0), chest=(6, 22, 0), head=(0, -16, 0)),
              P(hips=(6, -20, 0), spine=(6, -14, 0), chest=(8, -22, 0), head=(0, 12, 0)),
              P(hips=(6, -28, 0), spine=(6, -18, 0), chest=(8, -26, 0), head=(0, 16, 0))),
    "slam": (P(hips=(-6, 0, 0), spine=(-8, 0, 0), chest=(-10, 0, 0), neck=(-4, 0, 0), head=(-8, 0, 0)),
             P(hips=(20, 0, 0), spine=(14, 0, 0), chest=(12, 0, 0), neck=(-6, 0, 0), head=(-10, 0, 0)),
             P(hips=(22, 0, 0), spine=(16, 0, 0), chest=(13, 0, 0), neck=(-8, 0, 0), head=(-12, 0, 0))),
    "raise": (P(hips=(10, 0, 0), spine=(12, 0, 0), chest=(12, 0, 0), neck=(6, 0, 0), head=(14, 0, 0)),
              P(hips=(-6, 0, 0), spine=(-8, 0, 0), chest=(-10, 0, 0), neck=(-8, 0, 0), head=(-16, 0, 0)),
              P(hips=(-5, 0, 0), spine=(-7, 0, 0), chest=(-9, 0, 0), neck=(-7, 0, 0), head=(-13, 0, 0))),
}
HIPS = {"attack1": ((0, 0.03, -0.01), (0, -0.04, -0.03), (0, -0.05, -0.035)),
        "attack2": ((0, 0.02, -0.01), (0, -0.03, -0.03), (0, -0.035, -0.035)),
        "thrust": ((0, 0.06, -0.03), (0, -0.14, -0.07), (0, -0.16, -0.08)),
        "sweep": ((0, 0.02, -0.05), (0, -0.02, -0.08), (0, -0.02, -0.08)),
        "slam": ((0, 0.04, 0.04), (0, -0.08, -0.17), (0, -0.09, -0.19)),
        "raise": ((0, 0.02, -0.12), (0, 0.0, 0.03), (0, 0.0, 0.01))}
ARM_KEYS = {"attack1": ("a1_wind", "a1_hit", "a1_fol"), "attack2": ("a2_wind", "a2_hit", "a2_fol"),
            "thrust": ("th_wind", "th_hit", "th_fol"), "sweep": ("sw_wind", "sw_hit", "sw_fol"),
            "slam": ("sl_wind", "sl_hit", "sl_fol"), "raise": ("ra_wind", "ra_hit", "ra_fol")}


def gesture_keys(profile: dict, kind: str, step: float = 0.0) -> list:
    """(wind, hit, follow) full poses for a gesture adapted to the weapon and weight."""
    g = guard(profile)
    A = WEIGHTS[profile["weight"]][1]
    out = []
    w = profile["weapon"]
    for i in range(3):
        torso = _scale(TORSO[kind][i], A)
        if w == "dual" and kind == "attack2":
            torso = mirror(_scale(TORSO["attack1"][i], A))
        p = merge(add(g, torso), arm_block(profile, ARM_KEYS[kind][i]) if not (w == "dual" and kind == "attack2")
                  else _mirror_arms(profile, ARM_KEYS["attack1"][i]))
        if w == "none" and kind in ("attack1", "attack2", "thrust"):
            p = merge(p, _punch(kind, i))
        if w == "bow" and kind in ("attack1", "attack2", "thrust"):
            p = merge(p, _bow_draw(i))
        hx, hy, hz = HIPS[kind][i]
        p = _with_hips(p, (hx, hy * A, hz * A))
        p["ik"] = dict(g["ik"], **{k: v for k, v in p["ik"].items() if not k.startswith("foot")})
        if step and i > 0:
            p["ik"]["foot.L"] = FootTarget((0.03, -0.12 - step, 0.0), 0.0, -6.0)
        out.append(p)
    return out


def _mirror_arms(profile: dict, key: str) -> dict:
    blk = arm_block(dict(profile, weapon="one_hand"), key)["ik"]
    return {"ik": {_mirror_ik_key(k): v.mirrored() for k, v in blk.items()}}


def _punch(kind: str, i: int) -> dict:
    side = "R" if kind != "attack2" else "L"
    g, p = FISTS["guard"]
    j, pj = FISTS["jab"]
    rel = [(g[0] - 0.05, g[1] + 0.1, g[2] - 0.05), j, (j[0], j[1] + 0.03, j[2])][i]
    pole = [p, pj, pj][i]
    if side == "L":
        rel, pole = (-rel[0], rel[1], rel[2]), (-pole[0], pole[1], pole[2])
    return {"ik": {f"hand.{side}": HandTarget(rel=rel, pole=pole)}}


def _bow_draw(i: int) -> dict:
    """Bow: left arm extends the bow (prop.L vertical), right hand draws to the cheek and releases."""
    L = HandTarget(rel=(0.02, -0.98, 0.08), pole=(0.9, 0.2, -0.4))
    R = [HandTarget(rel=(0.30, -0.92, 0.05), pole=(-0.9, 0.2, 0.2)),
         HandTarget(rel=(0.30, -0.18, 0.10), pole=(-0.9, 0.4, 0.3)),
         HandTarget(rel=(-0.10, 0.22, 0.06), pole=(-0.9, 0.4, 0.3))][i]
    return {"ik": {"hand.L": L, "hand.R": R, "aim.L": Aim((0.0, -0.15, 1.0))}}


HEAVY = {"light": 0.7, "medium": 1.0, "heavy": 1.35}      # weight drop multiplier per class


def strike_keys(profile: dict, wind: dict, hit: dict, follow: dict, guard_pose: dict | None = None) -> list:
    """The VALE strike timing (impact EXACTLY at 40 %) from three blocked poses:

        0.00 guard
        0.08 counter     anticipation of the anticipation: torso dips 10 % AWAY from the wind-up
        0.22 wind        the wind-up (ease in-out)
        0.29 coil        moving hold: the wind-up drifts 8 % further, slowing in (never a freeze)
        0.34 drive       hips and spine lead (60 / 45 %), chest 30 %, the weapon trails (18 %)
        0.40 IMPACT      accelerating into the hit; the weight drops (hips down, knees bend)
        0.46 hold        impact hold: 25 % drift toward the follow-through so the hit READS
        0.58 follow      follow-through; head, neck and a free off hand drag (60-70 %)
        0.78 recover     half way back to guard
        1.00 guard       `settle` ease: a ~6 % overshoot that dies out (weight settling)
    Use for bespoke clips too: anim.Clip(name, N, False, anim.keyed(strike_keys(...)), impact=anim.IMPACT)."""
    g = guard_pose if guard_pose is not None else guard(profile)
    hv = HEAVY[profile["weight"]]
    still = {"hand.R": 0.0, "hand.L": 0.0, "aim.R": 0.0, "aim.L": 0.0, "foot.L": 0.0, "foot.R": 0.0}
    counter = _with_hips(lerp_pose_w(g, wind, -0.10, still), (0.0, 0.0, -0.012 * hv))
    coil = lerp_pose_w(g, wind, 1.08, {"aim.R": 1.0, "aim.L": 1.0, "foot.L": 1.0, "foot.R": 1.0})
    drive = lerp_pose_w(coil, hit, 0.18, {"hips": 0.6, "spine": 0.45, "chest": 0.3, "hips_loc": 0.5,
                                          "foot.L": 0.7, "foot.R": 0.7, "thigh.L": 0.6, "thigh.R": 0.6})
    hit2 = _with_hips(hit, (0.0, 0.0, -0.018 * hv))
    hold = _with_hips(lerp_pose(hit, follow, 0.25), (0.0, 0.0, -0.024 * hv))
    fol = _with_hips(lerp_pose_w(hit, follow, 1.0, {"head": 0.6, "neck": 0.7, "hand.L": 0.65, "aim.L": 0.65}),
                     (0.0, 0.0, -0.010 * hv))
    rec = lerp_pose(follow, g, 0.5)
    return [(0.0, g, "linear"), (0.08, counter, "inout"), (0.22, wind, "inout"), (0.29, coil, "out"),
            (0.34, drive, "in"), (IMPACT, hit2, "accel"), (0.46, hold, "out"), (0.58, fol, "out"),
            (0.78, rec, "inout"), (1.0, g, "settle")]


def gen_strike(name: str, kind: str, profile: dict, base_frames: int = 25, step: float = 0.0) -> Clip:
    """Blocked gesture (wind, hit, follow) on the VALE strike timing (strike_keys): counter-move
    anticipation, coil, hips-first drive, impact at 40 % with a weight drop and an impact hold,
    dragging follow-through, settle. `step` moves the lead foot forward on impact (m). The head
    and neck trail by 1.5 / 1 frames (drag)."""
    N = frames_for(base_frames, profile)
    wind, hit, follow = gesture_keys(profile, kind, step)
    fn = keyed(strike_keys(profile, wind, hit, follow))
    return Clip(name, N, False, drag(fn, N, {"head": 1.5, "neck": 1.0}), impact=IMPACT)


def gen_ult(profile: dict) -> Clip:
    """Channel-raise: counter rise -> deep gather (0-30 %) with a moving hold -> release snapping to
    the raise at 40 % (+5 % overshoot) -> hold the channel with a tremble -> settle back to guard."""
    N = frames_for(50, profile)
    g = guard(profile)
    hv = HEAVY[profile["weight"]]
    pw, ph, pf = gesture_keys(profile, "raise")
    still = {"hand.R": 0.0, "hand.L": 0.0, "aim.R": 0.0, "aim.L": 0.0, "foot.L": 0.0, "foot.R": 0.0}
    counter = _with_hips(lerp_pose_w(g, pw, -0.12, still), (0.0, 0.0, 0.012))
    gather = _with_hips(lerp_pose(g, pw, 1.08), (0.0, 0.0, -0.02 * hv))
    gather2 = _with_hips(lerp_pose(g, pw, 1.14), (0.0, 0.0, -0.028 * hv))
    over = _with_hips(lerp_pose_w(pw, ph, 1.05, {"aim.R": 1.0, "aim.L": 1.0}), (0.0, 0.0, 0.01))
    keys = [(0.0, g, "linear"), (0.10, counter, "inout"), (0.28, gather, "inout"), (0.34, gather2, "out"),
            (IMPACT, ph, snap), (0.47, over, "out"), (0.56, ph, "inout"), (0.74, pf, "inout"),
            (0.88, lerp_pose(pf, g, 0.6), "inout"), (1.0, g, "settle")]
    base = keyed(keys)

    def sample(t):
        p = base(t)
        if 0.47 < t < 0.76:
            k = math.sin(math.pi * (t - 0.47) / 0.29)
            p = add(p, P(chest=(0.8 * k * osc(t, 7), 0, 0), head=(0.6 * k * osc(t, 9), 0, 0)))
            p = _nudge_hands(p, (0, 0, 0.01 * k * osc(t, 9)), (0, 0, 0.01 * k * osc(t, 9, 0.3)))
        return p

    return Clip("cast_ult", N, False, drag(sample, N, {"head": 1.5, "neck": 1.0}), impact=IMPACT)


def gen_death(profile: dict, skel: Skeleton) -> Clip:
    """Hit recoil -> knees buckle -> fall onto the back -> bounce -> settle (non-looping)."""
    N = frames_for(50, profile)
    g = guard(profile)
    hip_h = skel.rest_point("hips").z
    fk_arms = arms_relaxed()
    recoil = merge(add(g, P(hips=(-6, 6, 0), spine=(-10, 0, 0), chest=(-14, 4, 0), neck=(-10, 0, 0), head=(-18, 6, 0))),
                   {"ik": dict(g["ik"], **arm_block(profile, "stunned")["ik"])})
    recoil = _with_hips(recoil, (0, 0.06, 0))
    buckle = merge(stance(profile), fk_arms,
                   P(hips=(-16, 18, -6), spine=(-8, 4, 0), chest=(-6, 6, 0), neck=(0, 0, 0), head=(14, 10, 0),
                     thigh_L=(52, 0, 0), shin_L=(-90, 0, 0), foot_L=(30, 0, 0),
                     thigh_R=(30, 0, 6), shin_R=(-70, 0, 0), foot_R=(30, 0, 0),
                     upper_arm_R=(10, -10, 20), forearm_R=(40, 0, 0), upper_arm_L=(20, 10, -10), forearm_L=(30, 0, 0)))
    buckle["hips_loc"] = (0.03, 0.10, -hip_h * 0.42)
    buckle["ik"] = {}
    down = merge(fk_arms, P(hips=(-84, 20, -4), spine=(-6, -4, 0), chest=(-4, -6, 0), neck=(10, 0, 0), head=(14, -20, 6),
                            thigh_L=(44, 0, -14), shin_L=(-84, 0, 0), foot_L=(-22, 0, 0),
                            thigh_R=(14, 0, 14), shin_R=(-14, 0, 0), foot_R=(30, 0, 0),
                            upper_arm_R=(-14, 0, -34), forearm_R=(16, 0, 0), hand_R=(0, 0, 0),
                            upper_arm_L=(-10, 0, 40), forearm_L=(24, 0, 0)))
    down["hips_loc"] = (0.05, 0.42, -hip_h + 0.13)
    # lying on the back: both hands come to rest ON the ground, the held item lies flat (no fist or
    # blade left pointing at the sky), positions scale with the rig so every proportion works
    k = hip_h / 0.95
    sh_y = 0.42 + 0.50 * k
    down["ik"] = {"hand.L": HandTarget(pos=(0.66 * k, sh_y + 0.02 * k, 0.05 * k), pole=(1.0, 0.05, 0.0)),
                  "hand.R": HandTarget(pos=(-0.80 * k, sh_y - 0.30 * k, 0.065 * k), pole=(-1.0, -0.07, 0.0)),
                  "aim.R": Aim((-0.62, -0.78, 0.02))}
    if profile["weapon"] in ("two_hand", "staff", "bow", "dual", "focus"):
        down["ik"]["aim.L"] = Aim((0.62, -0.78, 0.02))
    bounce = add(down, P(spine=(6, 0, 0), chest=(6, 0, 0), head=(8, 0, 0), thigh_L=(6, 0, 0), shin_L=(-8, 0, 0)))
    bounce["hips_loc"] = (0.05, 0.42, -hip_h + 0.16)
    rest = add(down, P(head=(0, -6, 0), shin_L=(10, 0, 0), thigh_L=(-6, 0, 0)))
    rest["hips_loc"] = (0.05, 0.42, -hip_h + 0.125)
    keys = [(0.0, g, "linear"), (0.14, recoil, "snap"), (0.42, buckle, "inout"), (0.66, down, "in"),
            (0.74, bounce, "out"), (0.84, rest, "inout"), (1.0, rest, "linear")]
    return Clip("death", N, False, keyed(keys))


def gen_recall(profile: dict, skel: Skeleton) -> Clip:
    """Kneel on the right knee, head bowed, off hand raised in a channel; loops."""
    hip_h = skel.rest_point("hips").z
    kneel = merge(arms_relaxed(), P(hips=(8, -10, 0), spine=(10, 4, 0), chest=(8, 4, 0), neck=(12, 0, 0),
                                    head=(16, 0, 0), toe_R=(60, 0, 0)), arm_block(profile, "recall"))
    kneel["hips_loc"] = (0.0, 0.10, -hip_h * 0.42)
    kneel["ik"].update(feet(l=(0.03, -0.30, 0.0), r=(-0.02, 0.36, 0.06), yl=-6, yr=-8, pr=-62, kr=8))
    N = 60

    def sample(t):
        b = osc(t, 2)
        p = add(kneel, P(chest=(1.2 * b, 0, 0), head=(-0.8 * b, 0, 0)))
        return _nudge_hands(p, (0, 0, 0.004 * b), (0.0, -0.01 * osc(t, 1), 0.015 * osc(t, 2, 0.2)))

    return Clip("recall", N, True, sample)


def gen_idle_lobby(profile: dict) -> Clip:
    """Characterful lobby loop: weapon rested on the shoulder (arms crossed when unarmed), off hand
    on the hip, weight shifts and a slow look-around."""
    N = 96
    st = stance(dict(profile, stance="neutral"), 0.6)
    if profile["weapon"] == "none":
        arms = {"ik": {"hand.R": HandTarget(rel=(0.55, -0.40, -0.45), pole=(-0.9, 0.2, -0.3)),
                       "hand.L": HandTarget(rel=(-0.55, -0.45, -0.38), pole=(0.9, 0.2, -0.3))}}
    else:
        arms = arm_block(profile, "lobby")
    base = merge(st, arms_relaxed(), arms)

    def sample(t):
        s = osc(t, 1)
        look = 20 * math.sin(2 * math.pi * t) ** 3
        b = osc(t, 3)
        p = add(base, P(hips=(0, 3 * s, -3 * s), spine=(0.5 * b, -2 * s, 1.5 * s), chest=(1.2 * b, -2 * s, 1.0 * s),
                        neck=(0, look * 0.4, 0), head=(-2 + 2 * osc(t, 2, 0.3), look * 0.6, 3 * s)))
        p = _nudge_hands(p, (0, 0, 0.01 * b), (0, 0, 0))
        return _with_hips(p, (0.022 * s, 0.0, -0.006 * abs(s)))

    return Clip("idle_lobby", N, True, sample)


def gen_victory(profile: dict) -> Clip:
    N = 60
    g = guard(profile)
    crouch = _with_hips(add(g, P(hips=(8, 0, 0), spine=(10, 0, 0), chest=(10, 0, 0), head=(10, 0, 0))), (0, 0, -0.06))
    up = merge(stance(profile, 0.3), arms_relaxed(),
               P(hips=(-4, -8, 0), spine=(-6, -4, 0), chest=(-7, -6, 0), neck=(-3, 4, 0), head=(-5, 6, 0),
                 shoulder_R=(0, 0, -10)), arm_block(profile, "victory"))
    up["hips_loc"] = (0.0, 0.0, -0.01)
    crouch2 = _with_hips(lerp_pose(g, crouch, 1.12), (0, 0, -0.008))
    base = keyed([(0.0, g, "linear"), (0.18, crouch, "inout"), (0.25, crouch2, "out"), (0.40, up, "back"),
                  (1.0, up, "linear")])
    base = drag(base, N, {"head": 2.0, "neck": 1.0})

    def sample(t):
        p = base(t)
        if t > 0.45:
            k = min(1.0, (t - 0.45) / 0.15)
            p = add(p, P(chest=(1.0 * k * osc(t, 2), 0, 0)))
            p = _nudge_hands(p, (0, 0, 0.01 * k * osc(t, 2, 0.1)), (0, 0, 0))
        return p

    return Clip("victory", N, False, sample)


def gen_channel(profile: dict) -> Clip:
    pose = merge(add(guard(profile), P(spine=(4, 0, 0), chest=(4, 0, 0))), arm_block(profile, "channel"))
    pose["ik"] = dict(guard(profile)["ik"], **arm_block(profile, "channel")["ik"])
    N = 40
    return Clip("channel", N, True, lambda t: _nudge_hands(add(pose, P(chest=(1.5 * osc(t, 2), 0, 0),
                                                                       head=(-1 * osc(t, 2), 0, 0))),
                                                           (0, 0, 0.01 * osc(t, 2)), (0, 0.01 * osc(t, 1), 0.015 * osc(t, 2, 0.2))))


def gen_dash(profile: dict) -> Clip:
    N = frames_for(15, profile)
    g = guard(profile)
    lunge = merge(add(g, P(hips=(18, 0, 0), spine=(10, 0, 0), chest=(8, 0, 0), neck=(-14, 0, 0), head=(-14, 0, 0))),
                  {"ik": dict(arm_block(profile, "dash")["ik"])})
    lunge = _with_hips(lunge, (0, -0.06, -0.08))
    lunge["ik"].update(feet(l=(0.03, -0.32, 0.06), r=(-0.03, 0.30, 0.02), pl=10, pr=-30))
    keys = [(0.0, g, "linear"), (0.3, lunge, "snap"), (0.75, lunge, "linear"), (1.0, g, "inout")]
    return Clip("dash", N, False, keyed(keys))


def gen_stunned(profile: dict) -> Clip:
    g = guard(profile, 1.3)
    slump = add(g, P(spine=(10, 0, 0), chest=(10, 0, 0), neck=(10, 0, 0), head=(14, 0, 0)))
    slump["ik"] = dict(g["ik"], **arm_block(profile, "stunned")["ik"])
    N = 40

    def sample(t):
        a, b = osc(t, 1), osc(t, 1, 0.25)
        return add(slump, P(hips=(0, 0, 4 * a), spine=(3 * b, 0, -3 * a), chest=(3 * b, 0, -3 * a),
                            neck=(6 * b, 0, 6 * a), head=(8 * b, 4 * a, 8 * a)))

    return Clip("stunned", N, True, sample)


def standard_clips(skel: Skeleton, profile: dict, overrides: dict | None = None,
                   optional=("channel", "dash", "stunned")) -> dict:
    """The full required set (+ optional) for a motion profile; overrides replace/add clips."""
    clips = {
        "idle": gen_idle(profile),
        "run": gen_run(profile),
        "attack1": gen_strike("attack1", "attack1", profile, 25),
        "attack2": gen_strike("attack2", "attack2", profile, 25),
        "cast_a1": gen_strike("cast_a1", "thrust", profile, 30, step=0.18),
        "cast_a2": gen_strike("cast_a2", "sweep", profile, 30),
        "cast_a3": gen_strike("cast_a3", "slam", profile, 35, step=0.10),
        "cast_ult": gen_ult(profile),
        "death": gen_death(profile, skel),
        "recall": gen_recall(profile, skel),
        "idle_lobby": gen_idle_lobby(profile),
        "victory": gen_victory(profile),
    }
    gens = {"channel": gen_channel, "dash": gen_dash, "stunned": gen_stunned}
    for o in optional:
        clips[o] = gens[o](profile)
    for k, v in (overrides or {}).items():
        clips[k] = v
    return clips


# ── secondary motion for x_ chains ─────────────────────────────────────────────────────────────
@dataclass
class ChainCfg:
    bones: list
    gravity: float = 0.75          # 0 = rigid with the parent, 1 = always hangs straight down
    stiffness: float = 140.0       # spring (1/s²)
    damping: float = 15.0          # (1/s)
    inertia: float = 0.8           # deg of swing per m/s² of root acceleration along the bone Z
    drive: Callable | None = None  # f(pose) -> extra X degrees on the first bone (e.g. thigh push)
    limit: tuple = (-75.0, 75.0)
    floor: float | None = 0.03     # chain tails stay above this height (None = off)


def _chain_state(skel: Skeleton, pose: dict, cfg: ChainCfg, angles=None):
    """Targets (deg about each bone's X) that make the chain hang toward gravity (+ drive), the
    chain root position and the root bone's world Z axis (for inertia)."""
    work = dict(pose)
    M = skel.fk(work)
    down = V((0, 0, -1))
    drive = cfg.drive(pose) if cfg.drive else 0.0
    out = []
    root_pos, root_z = None, None
    for i, b in enumerate(cfg.bones):
        par = skel.parent[b]
        Pm = M[par] @ skel.local[b]
        R = Pm.to_3x3()
        x, y = R.col[0].normalized(), R.col[1].normalized()
        if i == 0:
            root_pos, root_z = Pm.translation.copy(), R.col[2].normalized()
        gp = down - x * down.dot(x)
        ang = 0.0
        if gp.length > 1e-6:
            gp.normalize()
            ang = math.degrees(math.atan2(y.cross(gp).dot(x), y.dot(gp)))
        tgt = cfg.gravity * ang + (drive if i == 0 else 0.0)
        tgt = max(cfg.limit[0], min(cfg.limit[1], tgt))
        out.append(tgt)
        work[b] = ((angles[i] if angles else tgt), 0.0, 0.0)
        M = skel.fk(work)
    return out, root_pos, root_z


def secondary_motion(skel: Skeleton, poses: list, cfgs: list, loop: bool) -> list:
    """Damped-spring follow-through on x_ chains integrated over the sampled clip (semi-implicit
    Euler at 30 fps). Loops run 3 cycles and keep the last so the seam is continuous."""
    if not cfgs:
        return poses
    n = len(poses)
    m = n - 1 if loop else n
    dt = 1.0 / FPS
    out = [dict(p) for p in poses]
    for cfg in cfgs:
        k = len(cfg.bones)
        states = [_chain_state(skel, poses[f], cfg) for f in range(m)]
        pos = [s[1] for s in states]

        def acc_at(f):
            if loop:
                a, b, c = pos[(f - 1) % m], pos[f], pos[(f + 1) % m]
            else:
                a, b, c = pos[max(0, f - 1)], pos[f], pos[min(m - 1, f + 1)]
            return (a - 2 * b + c) / (dt * dt)

        ang = list(states[0][0])
        vel = [0.0] * k
        rec = []
        for r in range(3 if loop else 1):
            for f in range(m):
                tg, _, zax = states[f]
                inert = -cfg.inertia * acc_at(f).dot(zax)
                for j in range(k):
                    tj = tg[j] + inert * (1.0 + 0.6 * j)
                    vel[j] += (cfg.stiffness * (tj - ang[j]) - cfg.damping * vel[j]) * dt
                    ang[j] = max(cfg.limit[0], min(cfg.limit[1], ang[j] + vel[j] * dt))
                if r == (2 if loop else 0):
                    rec.append(list(ang))
        if loop:
            rec.append(rec[0])
        for f in range(n):
            for j, b in enumerate(cfg.bones):
                out[f][b] = (rec[f][j], 0.0, 0.0)
            if cfg.floor is not None:
                _keep_above_floor(skel, out[f], cfg)
    return out


def _keep_above_floor(skel: Skeleton, pose: dict, cfg: "ChainCfg") -> None:
    """Scale the chain's swing back toward its parent-aligned rest until every chain tail stays
    above `cfg.floor` (a hanging drape must never swing through the ground, e.g. lying in `death`)."""
    def lowest(k):
        work = dict(pose)
        for b in cfg.bones:
            a = pose[b]
            work[b] = (a[0] * k, a[1] * k, a[2] * k)
        M = skel.fk(work)
        return min((M[b] @ V((0.0, skel.length[b], 0.0))).z for b in cfg.bones), work
    z, _ = lowest(1.0)
    if z >= cfg.floor:
        return
    lo, hi = 0.0, 1.0
    for _ in range(7):
        mid = 0.5 * (lo + hi)
        if lowest(mid)[0] >= cfg.floor:
            lo = mid
        else:
            hi = mid
    for b in cfg.bones:
        a = pose[b]
        pose[b] = (a[0] * lo, a[1] * lo, a[2] * lo)


# ── writing actions ────────────────────────────────────────────────────────────────────────────
def sample_clip(skel: Skeleton, clip: Clip, chains: list | None = None) -> list:
    poses = [resolve(skel, clip.sample(f / clip.frames)) for f in range(clip.frames + 1)]
    if clip.loop:
        poses[-1] = poses[0]
    if chains and clip.secondary:
        poses = secondary_motion(skel, poses, chains, clip.loop)
    return poses


def _new_fcurve(cb, data_path: str, index: int, group: str):
    """Channelbag F-curve in a bone group; `group_name` is not accepted by every 5.x build."""
    try:
        return cb.fcurves.new(data_path, index=index, group_name=group)
    except TypeError:
        fc = cb.fcurves.new(data_path, index=index)
        grp = cb.groups.get(group) if hasattr(cb, "groups") else None
        if grp is None and hasattr(cb, "groups"):
            grp = cb.groups.new(group)
        if grp is not None:
            fc.group = grp
        return fc


def write_action(arm: bpy.types.Object, name: str, poses: list, bones: list | None = None) -> bpy.types.Action:
    """Create action `name` with one LINEAR key per frame for every bone rotation (+ hips loc),
    and stash it on a muted NLA track named after the clip."""
    old = bpy.data.actions.get(name)
    if old:
        bpy.data.actions.remove(old)
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    layer = act.layers.new("Layer")
    strip = layer.strips.new(type="KEYFRAME")
    slot = act.slots.new(id_type="OBJECT", name=arm.name)
    cb = strip.channelbag(slot, ensure=True)
    bones = bones or [b.name for b in arm.data.bones if b.name != "root"]
    n = len(poses)
    frames = list(range(n))
    for b in bones:
        dp = f'pose.bones["{b}"].rotation_euler'
        for i in range(3):
            fc = _new_fcurve(cb, dp, i, b)
            vals = [math.radians(p.get(b, (0, 0, 0))[i]) for p in poses]
            fc.keyframe_points.add(n)
            fc.keyframe_points.foreach_set("co", [c for f, v in zip(frames, vals) for c in (f, v)])
            fc.keyframe_points.foreach_set("interpolation", [1] * n)
            fc.update()
    hb = "hips"
    if any("hips_loc" in p for p in poses):
        rest = arm.data.bones[hb].matrix_local.to_3x3().transposed()
        locs = [rest @ V(p.get("hips_loc", (0, 0, 0))) for p in poses]
        for i in range(3):
            fc = _new_fcurve(cb, f'pose.bones["{hb}"].location', i, hb)
            fc.keyframe_points.add(n)
            fc.keyframe_points.foreach_set("co", [c for f, l in zip(frames, locs) for c in (f, l[i])])
            fc.keyframe_points.foreach_set("interpolation", [1] * n)
            fc.update()
    act.use_frame_range = True
    act.frame_start = 0
    act.frame_end = n - 1
    act.use_cyclic = False
    ad = arm.animation_data or arm.animation_data_create()
    track = ad.nla_tracks.new()
    track.name = name
    st = track.strips.new(name, 0, act)
    try:
        st.action_slot = slot
    except (AttributeError, TypeError):
        pass
    track.mute = True
    return act


def write_clips(arm: bpy.types.Object, clips: dict, chains: list | None = None) -> dict:
    """Sample every clip, write actions + NLA stash. Returns {name: {frames, duration, loop, impact}}."""
    skel = Skeleton(arm)
    for pb in arm.pose.bones:
        pb.rotation_mode = "XYZ"
    info = {}
    order = REQUIRED_CLIPS + [c for c in clips if c not in REQUIRED_CLIPS]
    for name in order:
        if name not in clips:
            continue
        clip = clips[name]
        poses = sample_clip(skel, clip, chains)
        write_action(arm, name, poses)
        info[name] = {"frames": clip.frames, "duration_s": round(clip.duration, 4), "loop": clip.loop,
                      "impact": clip.impact, **clip.meta}
    if arm.animation_data:
        arm.animation_data.action = None
    return info


def apply_pose(arm: bpy.types.Object, pose: dict) -> None:
    """Pose the armature in the viewport/render (renders, portraits). Resolves IK first."""
    skel = Skeleton(arm)
    pose = resolve(skel, pose)
    for pb in arm.pose.bones:
        pb.rotation_mode = "XYZ"
        r = pose.get(pb.name)
        pb.rotation_euler = [math.radians(a) for a in r] if r else (0, 0, 0)
        pb.location = (0, 0, 0)
    if "hips_loc" in pose:
        rest = arm.data.bones["hips"].matrix_local.to_3x3().transposed()
        arm.pose.bones["hips"].location = rest @ V(pose["hips_loc"])
    bpy.context.view_layer.update()


def set_action_frame(arm: bpy.types.Object, clip: str, frame: float) -> None:
    """Show `clip` at `frame` (renders): assign the action + slot and set the scene frame."""
    act = bpy.data.actions[clip]
    ad = arm.animation_data or arm.animation_data_create()
    ad.action = act
    try:
        ad.action_slot = act.slots[0]
    except (AttributeError, IndexError):
        pass
    bpy.context.scene.frame_set(int(frame), subframe=frame - int(frame))
