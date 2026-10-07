"""Parametric humanoid base body fitted to a VALE_BIPED_1 rig (A-pose).

`humanoid_parts(info, shape)` lofts torso, neck, head, arms, fists and legs from the rig joints;
`mesh.union_fillet` then fuses them into one sculpt-like high-res surface. Fighters change the
look through `shape` (girth multipliers, chest/glute depth, hand/feet scale, head form) and then
dress the body with plates, cloth and props. Feet are usually replaced by boots (see `boot`).

All dimensions scale with the rig height relative to 1.85 m.
"""
from __future__ import annotations

import math

from mathutils import Matrix, Vector

from . import mesh
from .rig import FRONT, UP, RigInfo

V = Vector

DEFAULT_SHAPE = {
    "girth": 1.0,         # global radius multiplier
    "torso_w": 1.0,       # torso width multiplier
    "torso_d": 1.0,       # torso depth multiplier
    "chest": 1.0,         # chest volume (pecs / ribcage)
    "waist": 1.0,         # waist width
    "hips": 1.0,          # pelvis / glute width
    "arm": 1.0,           # arm radius multiplier
    "forearm": 1.0,       # forearm radius multiplier (heroic forearms > 1)
    "leg": 1.0,           # thigh/calf radius multiplier
    "calf": 1.0,
    "hand": 1.25,         # fist size (stylized: big hands read at game zoom)
    "neck": 1.0,
    "head_w": 1.0,
    "head_d": 1.0,
    "jaw": 1.0,
    "feet": True,         # include bare feet lofts (False when boots replace them)
    "hands": True,
    "head": True,
}


def shape(**kw) -> dict:
    s = dict(DEFAULT_SHAPE)
    bad = set(kw) - set(s)
    if bad:
        raise KeyError(f"unknown shape keys {sorted(bad)}")
    s.update(kw)
    return s


def humanoid_parts(info: RigInfo, shp: dict | None = None, col=None, segments: int = 20) -> list:
    s = shape(**(shp or {}))
    J = info.joints
    k = info.props["height"] / 1.85
    g = s["girth"] * k
    parts = []

    # ── torso (crotch -> neck base), depth toward the front = ry, back = ry2 ──
    hip_z = J["hip.L"].z
    s0, s1, nb = J["spine0"], J["spine1"], J["neck_base"]
    sw = info.props["shoulder_width"] / 2
    tw, td = s["torso_w"], s["torso_d"]

    def st(z, y, rx, ry, ry2, e=2.2):
        return {"p": V((0, y, z)), "rx": rx * g * tw, "ry": ry * g * td, "ry2": ry2 * g * td, "exp": e}

    ch, hp_, wa = s["chest"], s["hips"], s["waist"]
    torso = [
        st(hip_z - 0.085 * k, J["pelvis"].y + 0.006, 0.108 * hp_, 0.072, 0.082, 2.0),
        st(hip_z - 0.030 * k, J["pelvis"].y + 0.012, 0.160 * hp_, 0.090, 0.124 * hp_, 2.3),
        st(hip_z + 0.045 * k, J["pelvis"].y + 0.010, 0.164 * hp_, 0.094, 0.112 * hp_, 2.4),
        st(s0.z + 0.035 * k, s0.y + 0.006, 0.136 * wa, 0.094, 0.088, 2.2),
        st(s1.z - 0.015 * k, s1.y - 0.004, 0.158 * ch, 0.112 * ch, 0.096, 2.3),
        st(s1.z + 0.38 * (nb.z - s1.z), s1.y - 0.016, 0.192 * ch, 0.136 * ch, 0.108, 2.4),
        st(nb.z - 0.082 * k, nb.y - 0.010, max(0.205, sw * 0.88 / k) * ch, 0.124 * ch, 0.108, 2.6),
        st(nb.z - 0.032 * k, nb.y + 0.008, 0.150 * ch, 0.080, 0.092, 2.4),
        st(nb.z + 0.008 * k, nb.y + 0.008, 0.075 * s["neck"], 0.056, 0.062, 2.0),
    ]
    parts.append(mesh.loft(torso, segments=segments + 4, caps=("round", "flat"), up=FRONT, name="b_torso", col=col))

    # ── neck ──
    hb = J["head_base"]
    n0 = nb + V((0, 0.004, -0.02 * k))
    n1 = hb + V((0, -0.004, 0.035 * k))
    neck = [{"p": n0, "rx": 0.060 * g * s["neck"], "ry": 0.055 * g * s["neck"]},
            {"p": n0.lerp(n1, 0.5), "rx": 0.052 * g * s["neck"], "ry": 0.050 * g * s["neck"]},
            {"p": n1, "rx": 0.050 * g * s["neck"], "ry": 0.048 * g * s["neck"]}]
    parts.append(mesh.loft(neck, segments=14, caps=("flat", "flat"), up=FRONT, name="b_neck", col=col))

    # ── head (egg with jaw); faces are authored per fighter on top of this ──
    if s["head"]:
        cr = J["crown"]
        hh = cr.z - hb.z
        hw, hd = s["head_w"] * k, s["head_d"] * k

        def hs(f, y, rx, ry, ry2, e=2.1):
            return {"p": V((0, hb.y + y * k, hb.z + f * hh)), "rx": rx * hw, "ry": ry * hd, "ry2": ry2 * hd, "exp": e}

        head = [
            hs(-0.16, -0.020, 0.034 * s["jaw"], 0.040, 0.020),
            hs(0.00, -0.012, 0.064 * s["jaw"], 0.078, 0.050),
            hs(0.22, -0.004, 0.076, 0.094, 0.080),
            hs(0.46, 0.000, 0.083, 0.098, 0.094),
            hs(0.72, 0.004, 0.081, 0.093, 0.096),
            hs(0.90, 0.006, 0.066, 0.075, 0.080),
        ]
        parts.append(mesh.loft(head, segments=segments, caps=("round", "round"), up=FRONT, name="b_head",
                               col=col, cap_len=0.9))

    for side in ("L", "R"):
        sx = 1.0 if side == "L" else -1.0
        sh, el, wr = J[f"shoulder.{side}"], J[f"elbow.{side}"], J[f"wrist.{side}"]
        d1 = (el - sh).normalized()
        d2 = (wr - el).normalized()
        ua, fa = (el - sh).length, (wr - el).length
        ar, fr = s["arm"] * g, s["forearm"] * g
        # the loft starts at the trapezius so the shoulder line flows from the neck into the deltoid
        tz = nb + V((0.075 * sx * k, 0.012, -0.030 * k))
        arm = [
            {"p": tz, "rx": 0.050 * ar, "ry": 0.052 * ar},
            {"p": sh - d1 * 0.045 * k + V((0, 0, 0.022 * k)), "rx": 0.062 * ar, "ry": 0.066 * ar},
            {"p": sh + d1 * 0.035 * k, "rx": 0.074 * ar, "ry": 0.076 * ar, "ry2": 0.070 * ar},
            {"p": sh + d1 * ua * 0.40, "rx": 0.060 * ar, "ry": 0.064 * ar, "ry2": 0.060 * ar},
            {"p": sh + d1 * ua * 0.80, "rx": 0.050 * ar, "ry": 0.050 * ar},
            {"p": el, "rx": 0.046 * ar, "ry": 0.046 * ar, "ry2": 0.052 * ar},
            {"p": el + d2 * fa * 0.28, "rx": 0.058 * fr, "ry": 0.056 * fr, "ry2": 0.054 * fr},
            {"p": el + d2 * fa * 0.68, "rx": 0.046 * fr, "ry": 0.040 * fr},
            {"p": wr + d2 * 0.01 * k, "rx": 0.040 * fr, "ry": 0.030 * fr},
        ]
        parts.append(mesh.loft(arm, segments=segments, caps=("round", "round"), up=FRONT,
                               name=f"b_arm.{side}", col=col))
        if s["hands"]:
            parts.append(fist(info, side, s["hand"] * k, col=col))

        # legs: rx lateral, ry front, ry2 back (calf)
        hp, kn, an = J[f"hip.{side}"], J[f"knee.{side}"], J[f"ankle.{side}"]
        t1 = (kn - hp).normalized()
        t2 = (an - kn).normalized()
        th, sh_ = (kn - hp).length, (an - kn).length
        lr = s["leg"] * g
        cf = s["calf"]
        leg = [
            {"p": hp + V((-0.035 * sx * k, 0.005, 0.075 * k)), "rx": 0.100 * lr, "ry": 0.094 * lr, "ry2": 0.105 * lr},
            {"p": hp + t1 * th * 0.12, "rx": 0.116 * lr, "ry": 0.110 * lr, "ry2": 0.112 * lr},
            {"p": hp + t1 * th * 0.45, "rx": 0.100 * lr, "ry": 0.104 * lr, "ry2": 0.094 * lr},
            {"p": hp + t1 * th * 0.82, "rx": 0.074 * lr, "ry": 0.078 * lr, "ry2": 0.068 * lr},
            {"p": kn, "rx": 0.064 * lr, "ry": 0.070 * lr, "ry2": 0.062 * lr},
            {"p": kn + t2 * sh_ * 0.28, "rx": 0.072 * lr * cf, "ry": 0.060 * lr, "ry2": 0.092 * lr * cf},
            {"p": kn + t2 * sh_ * 0.62, "rx": 0.055 * lr, "ry": 0.050 * lr, "ry2": 0.060 * lr * cf},
            {"p": an + V((0, 0.0, 0.01 * k)), "rx": 0.045 * lr, "ry": 0.042 * lr, "ry2": 0.046 * lr},
        ]
        parts.append(mesh.loft(leg, segments=segments, caps=("round", "round"), up=FRONT,
                               name=f"b_leg.{side}", col=col))
        if s["feet"]:
            parts.append(boot(info, side, col=col, cuff=False, name=f"b_foot.{side}"))
    return parts


def fist(info: RigInfo, side: str, scale: float = 1.0, col=None, name: str | None = None):
    """Closed fist around the prop socket (fingers wrap toward the palm normal) + thumb."""
    J = info.joints
    wr, kn = J[f"wrist.{side}"], J[f"knuckle.{side}"]
    d = (kn - wr).normalized()
    pn = J[f"palm_n.{side}"]                                   # palm normal (toward the grip)
    fr = (FRONT - d * FRONT.dot(d)).normalized()               # thumb side
    L = info.props["hand"] * scale
    w = 0.047 * scale / max(scale, 1e-6) * scale
    p0 = wr - d * 0.005
    p1 = wr + d * L * 0.30
    p2 = wr + d * L * 0.52 + pn * 0.004
    p3 = wr + d * L * 0.58 + pn * 0.035 * scale
    p4 = wr + d * L * 0.46 + pn * 0.050 * scale
    st = [
        {"p": p0, "rx": 0.027 * scale, "ry": 0.034 * scale, "exp": 2.4},
        {"p": p1, "rx": 0.022 * scale, "ry": 0.045 * scale, "exp": 3.0},
        {"p": p2, "rx": 0.023 * scale, "ry": 0.047 * scale, "exp": 3.2},
        {"p": p3, "rx": 0.020 * scale, "ry": 0.045 * scale, "exp": 3.0},
        {"p": p4, "rx": 0.015 * scale, "ry": 0.040 * scale, "exp": 2.6},
    ]
    # loft "up" = front so ry spans the knuckle row (front-back), rx the hand thickness
    hand = mesh.loft(st, segments=16, caps=("round", "round"), up=fr, name=name or f"b_hand.{side}", col=col,
                     cap_len=0.7)
    t0 = wr + d * L * 0.12 + fr * 0.028 * scale + pn * 0.012 * scale
    t1 = wr + d * L * 0.30 + fr * 0.040 * scale + pn * 0.030 * scale
    t2 = wr + d * L * 0.42 + fr * 0.030 * scale + pn * 0.050 * scale
    thumb = mesh.loft([{"p": t0, "rx": 0.016 * scale, "ry": 0.018 * scale},
                       {"p": t1, "rx": 0.014 * scale, "ry": 0.015 * scale},
                       {"p": t2, "rx": 0.012 * scale, "ry": 0.012 * scale}],
                      segments=10, caps=("round", "round"), up=pn, name=f"{name or 'b_hand'}_thumb.{side}", col=col)
    return mesh.join([hand, thumb], name or f"b_hand.{side}")


def boot(info: RigInfo, side: str, col=None, cuff: bool = True, height: float = 0.26, toe_up: float = 0.0,
         width: float = 1.0, name: str | None = None, sole: float = 0.012):
    """Boot / foot loft along the foot (heel -> toe) with a flat sole; `cuff` adds a shaft up the
    shin to `height` (m) that flares at the top."""
    J = info.joints
    k = info.props["height"] / 1.85
    an, ball, toe, heel = J[f"ankle.{side}"], J[f"ball.{side}"], J[f"toe.{side}"], J[f"heel.{side}"]
    fwd = V((toe.x - heel.x, toe.y - heel.y, 0)).normalized()
    zc = 0.045 * k
    w = width * k

    def fs(p, rx, up, down, e=3.2):
        return {"p": V((p.x, p.y, zc)), "rx": rx * w, "ry": up * k, "ry2": down, "exp": e}

    a2 = V((an.x, an.y, 0))
    pts = [
        fs(heel - fwd * 0.005, 0.040, 0.040, zc - sole * 0.2, 2.6),
        fs(heel + fwd * 0.03, 0.046, 0.055, zc, 3.0),
        fs(a2 + fwd * 0.04, 0.050, 0.060, zc, 3.4),
        fs(ball - fwd * 0.02, 0.054, 0.040, zc, 3.4),
        fs(ball + fwd * 0.03, 0.052, 0.030 + toe_up, zc, 3.2),
        fs(toe - fwd * 0.005, 0.040, 0.022 + toe_up, zc - 0.002, 2.6),
    ]
    foot = mesh.loft(pts, segments=18, caps=("round", "round"), up=UP, name=name or f"boot.{side}", col=col,
                     cap_len=0.5)
    objs = [foot]
    if cuff:
        kn = J[f"knee.{side}"]
        t = (kn - an).normalized()
        top = an + t * (height - an.z) / max(t.z, 0.3)
        sh = [
            {"p": an + t * -0.03, "rx": 0.050 * w, "ry": 0.052 * k, "ry2": 0.058 * k},
            {"p": an.lerp(top, 0.35), "rx": 0.050 * w, "ry": 0.050 * k, "ry2": 0.066 * k},
            {"p": an.lerp(top, 0.85), "rx": 0.056 * w, "ry": 0.056 * k, "ry2": 0.070 * k},
            {"p": top, "rx": 0.064 * w, "ry": 0.066 * k, "ry2": 0.074 * k},
        ]
        objs.append(mesh.loft(sh, segments=18, caps=("round", "round"), up=FRONT, name=f"bootcuff.{side}",
                              col=col, cap_len=0.25))
    return objs[0] if len(objs) == 1 else mesh.join(objs, name or f"boot.{side}")
