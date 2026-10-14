"""Quadruped creature kit for the VALE jungle monsters (creatures.py).

Monsters are NOT fighters: no VALE_BIPED_1, no `accent`. Each one is
  * a custom armature (root, hips, spine, chest, neck.., head, jaw, ears, tail.., and four legs of
    upper / lower / foot / toe bones) built from a joint table, bones rolled so every leg bone's
    local X is the body's lateral axis (the IK plane normal);
  * a sculpted body: numpy SDF volumes (common/hifi/sdf.py) meshed twice - a smooth LOW that is
    decimated to the monster budget and a detailed HIGH (fur / plate / chisel displacement) that is
    vertex-painted from tagged primitives and baked onto the low (common/bake.py: base colour with
    the bible's painted cues + whole-body AO, ORM, tangent normal);
  * skin weights from bone heat with side / front-back masks (no weight bleeding between legs) and
    geometric splits (jaw vs skull); hard parts (antlers, tusks) are rigid;
  * clips sampled per frame from pose functions: FK deltas on the spine/neck/head/tail chain plus an
    analytic leg solver (fetlock target + cannon angle + hoof angle -> 2-bone IK in the leg plane),
    written as quaternion keys into one layered action per clip and stashed on NLA tracks, which the
    glTF exporter writes as one animation per clip name.

Conventions: Blender Z up, metres, models face -Y, feet on Z = 0, root at the origin. Angles of a
leg's foot (cannon) and toe (hoof) bones are measured in the leg plane from straight DOWN toward
FORWARD (0 = vertical, 90 = pointing forward, negative = pointing back).
"""
from __future__ import annotations

import math
import os
import sys
from dataclasses import dataclass, field, replace

import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from common import bake, export, materials, mesh, scene  # noqa: E402
from common.hifi import sdf  # noqa: E402

FPS = scene.FPS
X = np.array([1.0, 0.0, 0.0])
FWD = np.array([0.0, -1.0, 0.0])
UP = np.array([0.0, 0.0, 1.0])


# ── small math ───────────────────────────────────────────────────────────────────────────────────
def nrm(v):
    v = np.asarray(v, dtype=np.float64)
    n = np.linalg.norm(v)
    return v / n if n > 1e-12 else v


def rx(d):
    a = math.radians(d); c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]], dtype=np.float64)


def ry(d):
    a = math.radians(d); c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]], dtype=np.float64)


def rz(d):
    a = math.radians(d); c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], dtype=np.float64)


def rot(p: float = 0.0, y: float = 0.0, r: float = 0.0) -> np.ndarray:
    """Rest-axes rotation: p = pitch (+ lifts a forward-pointing bone's tip), y = yaw (+ turns to the
    creature's left, +X), r = roll about the body axis (+ tips the top toward +X)."""
    return rz(y) @ rx(-p) @ ry(r)


def ang_dir(a_deg: float, dn, fw):
    a = math.radians(a_deg)
    return math.cos(a) * dn + math.sin(a) * fw


def rodrigues_m(k, th):
    k = nrm(k)
    Kx = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + math.sin(th) * Kx + (1 - math.cos(th)) * (Kx @ Kx)


def rodrigues(v, k, th):
    k = nrm(k)
    return v * math.cos(th) + np.cross(k, v) * math.sin(th) + k * (k @ v) * (1 - math.cos(th))


def smooth(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def ease_out(x):
    x = min(1.0, max(0.0, x))
    return 1 - (1 - x) ** 3


def ease_in(x):
    x = min(1.0, max(0.0, x))
    return x ** 3


def lerp(a, b, t):
    return a + (b - a) * t


def spline(keys, x: float, period: float | None = None) -> float:
    """Catmull-Rom through (x, value) keys (x ascending). `period`: the keys loop (last key's value
    should equal the first's at x + period)."""
    xs = np.array([k[0] for k in keys], dtype=np.float64)
    vs = np.array([k[1] for k in keys], dtype=np.float64)
    if period:
        x = xs[0] + ((x - xs[0]) % period)
        xs = np.concatenate([[xs[-2] - period], xs, [xs[1] + period]])
        vs = np.concatenate([[vs[-2]], vs, [vs[1]]])
    else:
        if x <= xs[0]:
            return float(vs[0])
        if x >= xs[-1]:
            return float(vs[-1])
        xs = np.concatenate([[xs[0] - (xs[1] - xs[0])], xs, [xs[-1] + (xs[-1] - xs[-2])]])
        vs = np.concatenate([[vs[0]], vs, [vs[-1]]])
    i = int(np.searchsorted(xs, x, side="right")) - 1
    i = max(1, min(len(xs) - 3, i))
    x0, x1, x2, x3 = xs[i - 1], xs[i], xs[i + 1], xs[i + 2]
    v0, v1, v2, v3 = vs[i - 1], vs[i], vs[i + 1], vs[i + 2]
    h = max(x2 - x1, 1e-9)
    t = (x - x1) / h
    m1 = (v2 - v0) / max(x2 - x0, 1e-9) * h
    m2 = (v3 - v1) / max(x3 - x1, 1e-9) * h
    t2, t3 = t * t, t * t * t
    return (2 * t3 - 3 * t2 + 1) * v1 + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * v2 + (t3 - t2) * m2


def wave(u: float, phase: float = 0.0, harmonic: float = 1.0) -> float:
    return math.sin(2 * math.pi * (u * harmonic + phase))


# ── rig description ──────────────────────────────────────────────────────────────────────────────
@dataclass
class B:
    name: str
    head: tuple
    tail: tuple
    parent: str | None = None
    connect: bool = False
    deform: bool = True
    xaxis: tuple = (1.0, 0.0, 0.0)


@dataclass
class LegDef:
    name: str                     # FL, FR, HL, HR
    bones: tuple                  # (upper, lower, foot, toe)
    knee: float                   # +1: the middle joint bends forward (stifle), -1: backward (elbow)


@dataclass
class Leg:
    """One leg's target. World mode: p = fetlock (J3) position, a/t = foot/toe angles in the world
    leg plane. Body mode (wb > 0): pb = J3 offset from its rest position in the parent bone's rest
    axes, ab/tb angles in the body's leg plane; wb blends world -> body."""
    p: tuple = (0.0, 0.0, 0.0)
    a: float = 0.0
    t: float = 45.0
    pb: tuple = (0.0, 0.0, 0.0)
    ab: float | None = None
    tb: float | None = None
    wb: float = 0.0


@dataclass
class Pose:
    hips_loc: np.ndarray = field(default_factory=lambda: np.zeros(3))
    hips_rot: np.ndarray = field(default_factory=lambda: np.eye(3))
    rot: dict = field(default_factory=dict)
    legs: dict = field(default_factory=dict)

    def r(self, bone: str, p=0.0, y=0.0, r=0.0):
        R = rot(p, y, r)
        self.rot[bone] = R @ self.rot[bone] if bone in self.rot else R
        return self


def build_armature(name: str, bones: list, col) -> bpy.types.Object:
    data = bpy.data.armatures.new(name)
    arm = bpy.data.objects.new(name, data)
    col.objects.link(arm)
    scene.select_only([arm], arm)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = data.edit_bones
    for b in bones:
        e = eb.new(b.name)
        e.head = Vector(b.head)
        e.tail = Vector(b.tail)
        d = nrm(np.array(b.tail) - np.array(b.head))
        xh = np.array(b.xaxis, dtype=np.float64)
        if abs(float(nrm(xh) @ d)) > 0.95:
            xh = np.array([0.0, 0.0, 1.0]) if abs(d[2]) < 0.9 else np.array([0.0, -1.0, 0.0])
        x = nrm(xh - d * (xh @ d))
        e.align_roll(Vector(np.cross(x, d)))
        if b.parent:
            e.parent = eb[b.parent]
            e.use_connect = b.connect
        e.use_deform = b.deform
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return arm


class Rig:
    """Rest data + the per-frame pose solver (armature-space 4x4 matrices, numpy)."""

    def __init__(self, arm, legs: list):
        self.arm = arm
        bones = arm.data.bones
        self.order = [b.name for b in bones]
        # parents before children (bones are created in that order, but be safe)
        done, order = set(), []
        while len(order) < len(self.order):
            for b in bones:
                if b.name not in done and (b.parent is None or b.parent.name in done):
                    order.append(b.name)
                    done.add(b.name)
        self.order = order
        self.rest = {b.name: np.array(b.matrix_local, dtype=np.float64) for b in bones}
        self.parent = {b.name: (b.parent.name if b.parent else None) for b in bones}
        self.length = {b.name: float(b.length) for b in bones}
        self.local = {}
        for n in self.order:
            p = self.parent[n]
            self.local[n] = np.linalg.inv(self.rest[p]) @ self.rest[n] if p else self.rest[n].copy()
        self.legs = {lg.name: lg for lg in legs}
        self.leg_of_upper = {lg.bones[0]: lg for lg in legs}
        self.leg_bones = {b for lg in legs for b in lg.bones}
        self.head_pos = {n: self.rest[n][:3, 3].copy() for n in self.order}
        self.tail_pos = {n: (self.rest[n] @ np.array([0, self.length[n], 0, 1.0]))[:3] for n in self.order}
        self.reach_log = []
        self.soft_log = []
        self.ground = None                      # (min fetlock z, min toe-tip z) when set
        self.auto_scapula = True
        self.scap_gain = 0.55
        self.scap_max = 20.0
        self.scap_rest = {}
        for lg in legs:
            v = self.head_pos[lg.bones[3]] - self.head_pos[lg.bones[0]]
            self.scap_rest[lg.name] = math.degrees(math.atan2(v @ FWD, max(1e-6, -(v @ UP))))

    # rest leg target in world mode
    def rest_leg(self, leg: str) -> Leg:
        lg = self.legs[leg]
        up, lo, ft, toe = lg.bones
        J2, J3, J4 = self.head_pos[ft], self.head_pos[toe], self.tail_pos[toe]
        lat = X
        fw = nrm(FWD - lat * (lat @ FWD))
        dn = np.cross(lat, fw)
        df, dt = nrm(J3 - J2), nrm(J4 - J3)
        a = math.degrees(math.atan2(df @ fw, df @ dn))
        t = math.degrees(math.atan2(dt @ fw, dt @ dn))
        return Leg(p=tuple(J3), a=a, t=t, ab=a, tb=t)

    def rest_pose(self) -> Pose:
        return Pose(legs={n: self.rest_leg(n) for n in self.legs})

    def solve(self, pose: Pose) -> dict:
        P = {}
        for n in self.order:
            if n in P:
                continue
            par = self.parent[n]
            Mp = P[par] if par else np.eye(4)
            if n in self.leg_of_upper:
                self._leg(self.leg_of_upper[n], Mp, pose, P)
                continue
            if n == "hips":
                M = self.rest[n].copy()
                if par:
                    M = Mp @ self.local[n]
                M[:3, :3] = pose.hips_rot @ M[:3, :3]
                M[:3, 3] = M[:3, 3] + pose.hips_loc
                if n in pose.rot:
                    Rr = self.rest[n][:3, :3]
                    M[:3, :3] = M[:3, :3] @ (Rr.T @ pose.rot[n] @ Rr)
            else:
                M = Mp @ self.local[n]
                R = pose.rot.get(n)
                if R is not None:
                    Rr = self.rest[n][:3, :3]
                    bs = np.eye(4)
                    bs[:3, :3] = Rr.T @ R @ Rr
                    M = M @ bs
            P[n] = M
        return P

    def _leg(self, lg: LegDef, Mp, pose: Pose, P: dict):
        up, lo, ft, toe = lg.bones
        par = self.parent[up]
        L1, L2, Lf, Lt = (self.length[b] for b in lg.bones)
        scap = par if par.startswith("scapula") else None
        # the body frame: the leg's parent, or the scapula's parent (the scapula itself swings)
        fb = self.parent[scap] if scap else par
        Rb = P[fb][:3, :3] @ self.rest[fb][:3, :3].T if scap else Mp[:3, :3] @ self.rest[par][:3, :3].T
        lat = nrm(Rb @ X)
        fwb = nrm(Rb @ FWD)
        spec = pose.legs.get(lg.name) or self.rest_leg(lg.name)
        base = scap or up                       # body-mode targets hang from a joint that does not swing
        Jb = (P[scap][:3, 3] if scap else (Mp @ self.local[up])[:3, 3])
        J0 = (Mp @ self.local[up])[:3, 3]
        if scap and self.auto_scapula:
            # the scapula swings the shoulder joint toward the foot (fore/aft reach of a real forelimb)
            Jt = np.array(spec.p, dtype=np.float64) if spec.wb < 1 else \
                Jb + Rb @ (self.head_pos[toe] - self.head_pos[base] + np.array(spec.pb, dtype=np.float64))
            v = Jt - J0
            th = math.degrees(math.atan2(v @ fwb, max(1e-6, -(v @ (Rb @ UP))))) - self.scap_rest[lg.name]
            th = max(-self.scap_max, min(self.scap_max, th * self.scap_gain)) * (1 - spec.wb)
            if abs(th) > 1e-4:
                Rr = rodrigues_m(lat, math.radians(-th))
                M = P[scap].copy()
                M[:3, :3] = Rr @ M[:3, :3]
                P[scap] = M
                Mp = M
                J0 = (Mp @ self.local[up])[:3, 3]

        def place(mode):
            if mode == "world":
                fw = FWD - lat * (lat @ FWD)
                if np.linalg.norm(fw) < 0.3:
                    fw = fwb
                fw = nrm(fw)
                dn = np.cross(lat, fw)
                J3 = np.array(spec.p, dtype=np.float64)
                a, t = spec.a, spec.t
            else:
                fw, dn = fwb, np.cross(lat, fwb)
                rest_off = self.head_pos[toe] - self.head_pos[base]
                J3 = Jb + Rb @ (rest_off + np.array(spec.pb, dtype=np.float64))
                a = spec.ab if spec.ab is not None else spec.a
                t = spec.tb if spec.tb is not None else spec.t
            return J3, ang_dir(a, dn, fw), ang_dir(t, dn, fw)

        J3, df, dt = place("world")
        if spec.wb > 0:
            J3b, dfb, dtb = place("body")
            w = spec.wb
            J3 = J3 * (1 - w) + J3b * w
            df = nrm(df * (1 - w) + dfb * w)
            dt = nrm(dt * (1 - w) + dtb * w)
        if self.ground is not None and J3[2] < self.ground[0]:
            J3 = J3.copy()
            J3[2] = self.ground[0]
        J2 = J3 - Lf * df
        if self.ground is not None and len(self.ground) > 2 and J2[2] < self.ground[2]:
            # the wrist / hock stays clear of the ground: swing the foot bone up about the planted joint
            for th in np.radians(np.arange(3.0, 150.0, 3.0)):
                c = [rodrigues(df, lat, sg * th) for sg in (1.0, -1.0)]
                ok = [v for v in c if (J3 - Lf * v)[2] >= self.ground[2]]
                if ok:
                    df = ok[0]
                    J2 = J3 - Lf * df
                    break
        d = J2 - J0
        D = float(np.linalg.norm(d))
        lo_lim, hi_lim = abs(L1 - L2) * 1.02 + 1e-4, (L1 + L2) * 0.997
        if D > hi_lim or D < lo_lim:
            # soft reach: swing the foot (cannon) bone about the fetlock in the leg plane - the planted
            # joint stays put and the fetlock flexes/hyperextends, as a real leg does at the extremes
            for th in np.radians(np.arange(2.0, 70.0, 2.0)):
                hit = None
                for sg in (1.0, -1.0):
                    dfr = rodrigues(df, lat, sg * th)
                    Dr = float(np.linalg.norm(J3 - Lf * dfr - J0))
                    if lo_lim <= Dr <= hi_lim:
                        hit = dfr
                        break
                if hit is not None:
                    df = hit
                    J2 = J3 - Lf * df
                    d = J2 - J0
                    D = float(np.linalg.norm(d))
                    self.soft_log.append(lg.name)
                    break
        if D > hi_lim or D < lo_lim:
            self.reach_log.append((lg.name, round(D / (L1 + L2), 3)))
            Dc = min(max(D, lo_lim), hi_lim)
            J2 = J0 + nrm(d) * Dc
            J3 = J2 + Lf * df
            d = J2 - J0
            D = Dc
        dh = nrm(d)
        m = lat - dh * (lat @ dh)
        m = nrm(m) if np.linalg.norm(m) > 1e-6 else lat
        k = np.cross(m, dh)
        if (k @ fwb) * lg.knee < 0:
            k = -k
        aa = (L1 * L1 - L2 * L2 + D * D) / (2 * D)
        hh = math.sqrt(max(L1 * L1 - aa * aa, 0.0))
        J1 = J0 + dh * aa + k * hh
        J4 = J3 + Lt * dt
        if self.ground is not None and J4[2] < self.ground[1]:
            # the hoof / paw tip never digs in: tip it up about the fetlock
            for th in np.radians(np.arange(3.0, 120.0, 3.0)):
                c = [rodrigues(dt, lat, sg * th) for sg in (1.0, -1.0)]
                ok = [v for v in c if (J3 + Lt * v)[2] >= self.ground[1]]
                if ok:
                    dt = ok[0]
                    J4 = J3 + Lt * dt
                    break
        for b, (Pa, Pb) in zip(lg.bones, ((J0, J1), (J1, J2), (J2, J3), (J3, J4))):
            Yv = nrm(Pb - Pa)
            Xv = m - Yv * (m @ Yv)
            Xv = nrm(Xv) if np.linalg.norm(Xv) > 1e-6 else nrm(np.cross(Yv, UP))
            Zv = np.cross(Xv, Yv)
            M = np.eye(4)
            M[:3, 0], M[:3, 1], M[:3, 2], M[:3, 3] = Xv, Yv, Zv, Pa
            P[b] = M

    def basis(self, P: dict) -> dict:
        """Armature-space pose matrices -> pose-bone basis (loc, quat) per bone."""
        out = {}
        for n in self.order:
            par = self.parent[n]
            ref = (P[par] @ self.local[n]) if par else self.rest[n]
            Bm = np.linalg.inv(ref) @ P[n]
            mm = Matrix(Bm.tolist())
            loc, q, _ = mm.decompose()
            out[n] = (np.array(loc), np.array([q.w, q.x, q.y, q.z]))
        return out


# ── clips ────────────────────────────────────────────────────────────────────────────────────────
@dataclass
class Clip:
    name: str
    frames: int
    fn: object                    # t in [0, 1] -> Pose
    loop: bool = False
    impact: float | None = None

    @property
    def duration(self) -> float:
        return self.frames / FPS


def _fcurve(cb, path, index, group):
    try:
        return cb.fcurves.new(path, index=index, group_name=group)
    except TypeError:
        fc = cb.fcurves.new(path, index=index)
        if hasattr(cb, "groups"):
            grp = cb.groups.get(group) or cb.groups.new(group)
            fc.group = grp
        return fc


def write_clip(rig: Rig, clip: Clip, loc_bones=("hips",)) -> dict:
    """Sample the clip at every frame, write one LINEAR key per frame (quaternions for every bone,
    locations for `loc_bones`) into a new layered action stashed on a muted NLA track."""
    arm = rig.arm
    rig.reach_log = []
    rig.soft_log = []
    poses = [clip.fn(f / clip.frames) for f in range(clip.frames + 1)]
    mats = [rig.solve(p) for p in poses]
    if clip.loop:
        mats[-1] = mats[0]
    bases = [rig.basis(P) for P in mats]
    old = bpy.data.actions.get(clip.name)
    if old:
        bpy.data.actions.remove(old)
    act = bpy.data.actions.new(clip.name)
    act.use_fake_user = True
    layer = act.layers.new("Layer")
    strip = layer.strips.new(type="KEYFRAME")
    slot = act.slots.new(id_type="OBJECT", name=arm.name)
    cb = strip.channelbag(slot, ensure=True)
    n = len(bases)
    frames = np.arange(n, dtype=np.float64)
    for b in rig.order:
        if b == "root":
            continue
        qs = np.array([bs[b][1] for bs in bases])
        for i in range(1, n):
            if qs[i] @ qs[i - 1] < 0:
                qs[i] = -qs[i]
        dp = f'pose.bones["{b}"].rotation_quaternion'
        for i in range(4):
            fc = _fcurve(cb, dp, i, b)
            fc.keyframe_points.add(n)
            fc.keyframe_points.foreach_set("co", np.stack([frames, qs[:, i]], 1).ravel())
            fc.keyframe_points.foreach_set("interpolation", [1] * n)
            fc.update()
        if b in loc_bones:
            ls = np.array([bs[b][0] for bs in bases])
            dp = f'pose.bones["{b}"].location'
            for i in range(3):
                fc = _fcurve(cb, dp, i, b)
                fc.keyframe_points.add(n)
                fc.keyframe_points.foreach_set("co", np.stack([frames, ls[:, i]], 1).ravel())
                fc.keyframe_points.foreach_set("interpolation", [1] * n)
                fc.update()
    act.use_frame_range = True
    act.frame_start = 0
    act.frame_end = n - 1
    act.use_cyclic = False
    ad = arm.animation_data or arm.animation_data_create()
    tr = ad.nla_tracks.new()
    tr.name = clip.name
    st = tr.strips.new(clip.name, 0, act)
    try:
        st.action_slot = slot
    except (AttributeError, TypeError):
        pass
    tr.mute = True
    reach = sorted(set(rig.reach_log))
    if reach:
        scene.log(f"  {clip.name}: leg reach clamped {len(rig.reach_log)}x: {reach[:8]}")
    return {"frames": clip.frames, "duration_s": round(clip.duration, 4), "loop": clip.loop,
            "impact": clip.impact, "reach_clamps": len(rig.reach_log), "soft_reach": len(rig.soft_log)}


def show_frame(rig: Rig, clip_name: str, frame: float) -> None:
    arm = rig.arm
    act = bpy.data.actions[clip_name]
    ad = arm.animation_data or arm.animation_data_create()
    ad.action = act
    try:
        ad.action_slot = act.slots[0]
    except (AttributeError, IndexError):
        pass
    bpy.context.scene.frame_set(int(frame), subframe=frame - int(frame))


def clear_pose(rig: Rig) -> None:
    arm = rig.arm
    if arm.animation_data:
        arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()


# ── gait helper ──────────────────────────────────────────────────────────────────────────────────
def foot_path(u: float, duty: float, stride: float, lift: float, tangent: float = 1.0,
              lift_peak: float = 0.45) -> tuple:
    """In-place foot path of a cyclic gait at cycle phase u (0..1, 0 = touchdown). Returns
    (dy, dz, stance, s): dy along +Y (backward) from the rest fetlock, dz lift, stance flag, and the
    0..1 progress through the current phase. Stance: the planted foot slides back at stride/period
    (the body moves forward over it at exactly the run speed). Swing: Hermite back to the touchdown
    point, leaving and landing with a fraction of the ground speed (no hard stop)."""
    u = u % 1.0
    y_td, y_lo = -stride * duty / 2, stride * duty / 2
    if u < duty:
        s = u / duty
        return y_td + stride * u, 0.0, True, s
    s = (u - duty) / (1 - duty)
    m = stride * (1 - duty) * tangent
    h00, h10, h01, h11 = 2 * s ** 3 - 3 * s ** 2 + 1, s ** 3 - 2 * s ** 2 + s, -2 * s ** 3 + 3 * s ** 2, s ** 3 - s ** 2
    y = h00 * y_lo + h10 * m + h01 * y_td + h11 * m
    # lift: fast rise, peak early-ish (folded leg), soft set-down
    k = lift_peak
    z = lift * (math.sin(math.pi * min(1.0, s / (2 * k))) if s < k else math.cos(0.5 * math.pi * (s - k) / (1 - k)) ** 0.75)
    return y, z, False, s


# ── sculpting / surfacing ────────────────────────────────────────────────────────────────────────
def tag_distances(S: sdf.Sculpt, V: np.ndarray, pad: float = 0.04) -> dict:
    """Per tag: min distance of each vertex to the tagged 'add' primitives (bounds-culled)."""
    out = {}
    for op, prim, k, tag in S.ops:
        if op != "add" or tag is None:
            continue
        lo, hi = prim.bounds()
        m = np.all((V >= lo - pad - k) & (V <= hi + pad + k), axis=1)
        d = out.get(tag)
        if d is None:
            d = np.full(len(V), 1e3)
            out[tag] = d
        if m.any():
            d[m] = np.minimum(d[m], prim.d(V[m]))
    return out


def arrays(ob):
    me = ob.data
    v = np.empty(len(me.vertices) * 3); me.vertices.foreach_get("co", v)
    n = np.empty(len(me.vertices) * 3); me.vertices.foreach_get("normal", n)
    return v.reshape(-1, 3), n.reshape(-1, 3)


def srgb2lin(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def hexc(h: str) -> np.ndarray:
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])


def set_colors(ob, rgb_srgb: np.ndarray, rough: np.ndarray, name: str = "Col") -> None:
    me = ob.data
    if name in me.color_attributes:
        me.color_attributes.remove(me.color_attributes[name])
    a = me.color_attributes.new(name, "FLOAT_COLOR", "POINT")
    rgba = np.ones((len(me.vertices), 4), dtype=np.float32)
    rgba[:, :3] = srgb2lin(np.clip(rgb_srgb, 0, 1))
    rgba[:, 3] = np.clip(rough, 0, 1)
    a.data.foreach_set("color", rgba.ravel())
    me.color_attributes.active_color = a


def painted_material(name: str, hexcol: str, grad: dict, fur: float = 0.06, fur_scale=(1.0, 1.0, 1.0),
                     chalk=(1.3, 0.6), cavity=(0.45, 1.1), breakup: float = 0.07, top: float = 0.15,
                     curvature: float | None = None):
    """Bake-source material: vertex colour (Col: RGB albedo, A roughness) under the bible's painted
    cues (brush breakup, cavity dirt, chalked convex edges, top light, value gradient) + a fine
    hair-stroke bump."""
    m, g = materials._new(name)
    at = g.n("ShaderNodeAttribute")
    at.attribute_name = "Col"
    at.attribute_type = "GEOMETRY"
    c = at.outputs["Color"]
    if breakup > 0:
        c = materials.painted_breakup(g, c, amount=breakup, scale=3.0, hue=0.01)
    kw = {} if curvature is None else {"curvature": curvature}
    c, e = materials.paint(g, c, hexcol, grad, chalk=chalk, cavity=cavity, top=top, **kw)
    normal = None
    if fur > 0:
        st = g.noise(g.mapping(g.obj, scale=fur_scale), scale=70.0, detail=2.0, rough=0.5)
        normal = g.bump(st.outputs["Fac"], strength=fur, distance=0.002)
    g.set_bsdf(color=c, rough=at.outputs["Alpha"], metal=0.0, normal=normal)
    return m


def low_from(S: sdf.Sculpt, voxel: float, tris: int, name: str, col, symmetric: bool = False):
    v, q = S.mesh(voxel)
    ob = sdf.to_object(name, v, q, col)
    # surface nets can leave non-manifold vertices where two thin features nearly touch (bone heat then
    # fails): an OpenVDB voxel remesh at the same voxel makes the game mesh watertight first
    rm = ob.modifiers.new("remesh", "REMESH")
    rm.mode = "VOXEL"
    rm.voxel_size = voxel
    rm.use_smooth_shade = True
    mesh.apply_modifiers(ob)
    mesh.decimate_to(ob, tris, symmetric=symmetric)
    mesh.cleanup(ob, merge=1e-5)
    n = fix_folds(ob)
    if n:
        scene.log(f"{name}: {n} folded faces left after repair")
    ob.data.polygons.foreach_set("use_smooth", np.ones(len(ob.data.polygons), dtype=bool))
    return ob


def fold_faces(bm, thresh: float = -0.3) -> list:
    """Faces flipped against their neighbourhood (the mean of the edge neighbours' normals): spikes and
    folds, not legitimate sharp creases (a crease keeps some neighbours aligned)."""
    out = []
    for f in bm.faces:
        nb = [g for e in f.edges for g in e.link_faces if g is not f]
        if not nb:
            continue
        m = sum((g.normal for g in nb), Vector())
        if m.length > 1e-9 and f.normal.dot(m.normalized()) < thresh:
            out.append(f)
    return out


def fix_folds(ob, iters: int = 8) -> int:
    """Decimation folds (a face flipped against its neighbours: a dark speck in game) are relaxed
    away: the fold's vertices and their 1-ring move toward their neighbours' average."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for _ in range(iters):
        bm.normal_update()
        ff = fold_faces(bm)
        if not ff:
            break
        vs = {v for f in ff for v in f.verts}
        vs |= {e.other_vert(v) for v in list(vs) for e in v.link_edges}
        new = {}
        for v in vs:
            nb = [e.other_vert(v).co for e in v.link_edges]
            if nb:
                new[v] = sum(nb, Vector()) / len(nb)
        for v, c in new.items():
            v.co = v.co * 0.3 + c * 0.7
    bm.normal_update()
    left = len(fold_faces(bm))
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return left


def uv_mask(low, w: int, h: int) -> np.ndarray:
    """Boolean (h, w) coverage of the low's UV triangles (row 0 = bottom, Blender pixel order)."""
    me = low.data
    me.calc_loop_triangles()
    uv = np.empty(len(me.loops) * 2, dtype=np.float64)
    me.uv_layers.active.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2) * np.array([w, h])
    tl = np.empty(len(me.loop_triangles) * 3, dtype=np.int64)
    me.loop_triangles.foreach_get("loops", tl)
    tri = uv[tl.reshape(-1, 3)]
    M = np.zeros((h, w), dtype=bool)
    for a, b, c in tri:
        x0, x1 = int(max(0, np.floor(min(a[0], b[0], c[0])))), int(min(w - 1, np.ceil(max(a[0], b[0], c[0]))))
        y0, y1 = int(max(0, np.floor(min(a[1], b[1], c[1])))), int(min(h - 1, np.ceil(max(a[1], b[1], c[1]))))
        if x1 < x0 or y1 < y0:
            continue
        X, Y = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(d) < 1e-12:
            continue
        l1 = ((b[1] - c[1]) * (X - c[0]) + (c[0] - b[0]) * (Y - c[1])) / d
        l2 = ((c[1] - a[1]) * (X - c[0]) + (a[0] - c[0]) * (Y - c[1])) / d
        l3 = 1 - l1 - l2
        e = -0.02
        M[y0:y1 + 1, x0:x1 + 1] |= (l1 >= e) & (l2 >= e) & (l3 >= e)
    return M


def fill_bake_holes(img, low, dark: float = 0.035, iters: int = 40) -> int:
    """Baked base colour: pixels inside the UV islands that came out (near) black are ray misses -
    fill them from their lit neighbours (iterated 3x3 average) and save the image in place."""
    arr = bake.image_array(img).copy()
    h, w = arr.shape[:2]
    M = uv_mask(low, w, h)
    lum = arr[..., :3].max(-1)
    hole = M & (lum < dark)
    n = int(hole.sum())
    if n == 0:
        return 0
    good = ~hole & (lum >= dark)
    for _ in range(iters):
        acc = np.zeros_like(arr)
        cnt = np.zeros((h, w))
        g = good.astype(np.float64)
        ag = arr * g[..., None]
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                acc += np.roll(np.roll(ag, dy, 0), dx, 1)
                cnt += np.roll(np.roll(g, dy, 0), dx, 1)
        new = hole & (cnt > 0)
        arr[new] = acc[new] / cnt[new][:, None]
        good |= new
        hole &= ~new
        if not hole.any():
            break
    arr[..., 3] = 1.0
    bake.set_image_array(img, arr)
    path = bpy.path.abspath(img.filepath)
    bake.save_image(img, path, "JPEG", 90)
    img.reload()
    return n


def high_from(S: sdf.Sculpt, voxel: float, name: str, col):
    v, q = S.mesh(voxel)
    return sdf.to_object(name, v, q, col)


def tri_count(ob) -> int:
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# ── weights ──────────────────────────────────────────────────────────────────────────────────────
def weight_table(ob) -> tuple:
    """(V x G) dense weight matrix + group names."""
    names = [g.name for g in ob.vertex_groups]
    W = np.zeros((len(ob.data.vertices), len(names)))
    for v in ob.data.vertices:
        for g in v.groups:
            W[v.index, g.group] = g.weight
    return W, names


def write_weights(ob, W: np.ndarray, names: list, limit: int = 4, clean: float = 0.01) -> None:
    for n in names:
        if ob.vertex_groups.get(n) is None:
            ob.vertex_groups.new(name=n)
    groups = [ob.vertex_groups[n] for n in names]
    # top-`limit`, drop tiny, normalise
    idx = np.argsort(-W, axis=1)[:, :limit]
    Wk = np.take_along_axis(W, idx, 1)
    Wk[Wk < clean] = 0
    s = Wk.sum(1, keepdims=True)
    s[s <= 0] = 1
    Wk = Wk / s
    for g in groups:
        g.remove(list(range(len(ob.data.vertices))))
    for vi in range(len(W)):
        for j in range(limit):
            w = Wk[vi, j]
            if w > 0:
                groups[idx[vi, j]].add([vi], float(w), "REPLACE")


def mask_weights(ob, rules) -> None:
    """rules: list of (bone_predicate(name) -> bool, vertex_mask_fn(V) -> 0..1 multiplier). Weights are
    multiplied, renormalised; a vertex that loses everything keeps its strongest allowed bone."""
    W, names = weight_table(ob)
    V, _ = arrays(ob)
    V = np.array([ob.matrix_world @ Vector(p) for p in V])
    W0 = W.copy()
    for pred, fn in rules:
        f = fn(V)
        for j, n in enumerate(names):
            if pred(n):
                W[:, j] *= f
    dead = W.sum(1) < 1e-6
    if dead.any():
        W[dead] = W0[dead]
    write_weights(ob, W, names)


def split_weights(ob, a: str, b: str, t_fn) -> None:
    """Redistribute the a+b weight of every vertex by t_fn(V) in 0..1 (fraction going to b)."""
    W, names = weight_table(ob)
    for n in (a, b):
        if n not in names:
            ob.vertex_groups.new(name=n)
            names.append(n)
            W = np.concatenate([W, np.zeros((len(W), 1))], 1)
    ia, ib = names.index(a), names.index(b)
    V, _ = arrays(ob)
    t = np.clip(t_fn(V), 0, 1)
    s = W[:, ia] + W[:, ib]
    W[:, ia], W[:, ib] = s * (1 - t), s * t
    write_weights(ob, W, names)


def smooth_weights(ob, iters: int = 2, k: float = 0.5, bones=None) -> None:
    """Laplacian smoothing of the weight table over mesh edges (softens heat-weight seams)."""
    W, names = weight_table(ob)
    me = ob.data
    e = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get("vertices", e)
    e = e.reshape(-1, 2)
    cnt = np.bincount(e.ravel(), minlength=len(W)).astype(np.float64)
    cols = [i for i, n in enumerate(names) if bones is None or n in bones]
    for _ in range(iters):
        acc = np.zeros((len(W), len(cols)))
        np.add.at(acc, e[:, 0], W[e[:, 1]][:, cols])
        np.add.at(acc, e[:, 1], W[e[:, 0]][:, cols])
        avg = acc / np.maximum(cnt, 1)[:, None]
        W[:, cols] = W[:, cols] * (1 - k) + avg * k
    write_weights(ob, W, names)


# ── export / QA ─────────────────────────────────────────────────────────────────────────────────
def node_env():
    env = dict(os.environ)
    env["PATH"] = "/opt/homebrew/opt/node@22/bin:" + env.get("PATH", "")
    return env


def run_node(args: list, timeout: int = 600) -> tuple:
    import subprocess
    node = "/opt/homebrew/opt/node@22/bin/node"
    if not os.path.isfile(node):
        node = export.node_exe() or "node"
    r = subprocess.run([node] + args, cwd=scene.GAME_DIR, capture_output=True, text=True, encoding="utf-8",
                       env=node_env(), timeout=timeout)
    return r.returncode, (r.stdout + r.stderr)


def min_z_over_clips(rig: Rig, objs, clips: list, step: int = 2) -> dict:
    """Lowest deformed vertex per clip (ground penetration QA)."""
    dg = bpy.context.evaluated_depsgraph_get()
    out = {}
    for c in clips:
        lo, where = 1e9, None
        for f in range(0, c.frames + 1, step):
            show_frame(rig, c.name, f)
            dg = bpy.context.evaluated_depsgraph_get()
            for o in objs:
                ev = o.evaluated_get(dg)
                me = ev.to_mesh()
                co = np.empty(len(me.vertices) * 3)
                me.vertices.foreach_get("co", co)
                co = co.reshape(-1, 3)
                mw = np.array(o.matrix_world)
                z = co @ mw[:3, :3].T + mw[:3, 3]
                i = int(np.argmin(z[:, 2]))
                if z[i, 2] < lo:
                    lo, where = float(z[i, 2]), (f, tuple(np.round(z[i], 2)))
                ev.to_mesh_clear()
        out[c.name] = (round(lo, 3), where)
    clear_pose(rig)
    return out
