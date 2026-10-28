"""tunlan: Shadow puppeteer (Caster, Serenade). ART 2.0: sculpted volumes painted by concept projection.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/tunlan_plates.py     # plates (own cut, see there)
    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/tunlan_fit.py [--table] [--accent]   # fit check
    python3 art/build.py fighter tunlan --no-skins --clip-sheet
    python3 art/build.py fighter tunlan --skins-only

Brief: _design/fighters/tunlan.md. Concept: _design/concept/tunlan.webp (front + back, hand-painted). The forms are
numpy SDF volumes (common/hifi/sdf.py) fitted to the concept on a 10 cm grid (the plates' scale is the hat's crown,
2.05 m); the base colour is the concept painting projected occlusion-aware onto the game mesh (common/hifi/project.py,
wrapped below); normals and AO bake from the sculpt.

Where the concept and the brief disagree:
  * the concept's look wins (the approved look): a pale lacquered lampshade hat 1.27 m across (the brief's 1.0 m is
    the painting's disc read short) with a stepped octagonal crown and a dark ironstone rim; a tall pale carved theatre
    mask (long beak nose, almond slits, a closed half-smile, faceted cheek plates) on a walnut head-box; a dusty-rose
    felt robe over a cream under-robe and crossed collar, a brown sash with a knot and a hanging tail, cream turned
    cuffs, leather-wrapped forearms, dark leggings and brown ankle boots; big carved-wood JOINTED hands (palm block, four
    fingers of three segments and a two-segment thumb, the palms turned back as painted).
  * the brief wins on the facing cue and the accent: the painted lantern hangs at her right; here it hangs from the
    brim at her FRONT-right (x as painted, 0.40 m forward), so it marks her front from above and in profile, and its
    six glass panes are the `accent` (the painted amber glow is the lamp's light: the renderer tints it per viewer). The
    lamp's light also shows through a small vent in the brim above it (an ironstone grommet round an accent disc): the
    brief's bright notch at the front edge, read from the 52 degree camera at every facing.
  * the fingers are rigged (x_fa*/x_fb*/x_th* bones: index + middle, ring + pinky, thumb), so the four casts are
    four different hand shadows (the hound's head, the open palm closing to a grip, the brim flick, the beast).

Not in the shared pipeline, implemented here (module-level wrappers; common/ untouched):
  * rig_extras: x_hat (the hat, rigid on the head), x_lantern (its pendulum, a one-bone x_ chain), the finger bones,
    the hands' rest direction (they hang as painted), sockets x_lamp, x_gesture_r / x_gesture_l.
  * skin weights for the robe, sleeves, sash, legs and boots (pipeline.bind_part wrapper: ("weights", how)).
  * the paint (project.paint wrapper): projected robe / mask / head / cuffs / wraps with side fill and the back sheet
    matched to the front's tones; the hat, the lantern and the wooden hands paint procedurally in the concept's colours.
  * clips (clip_overrides): idle, run, the two attacks, the four casts, death, recall, lobby, victory, stunned, dash,
    channel and taunt, all with finger poses.
"""
from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy  # noqa: E402,F401
import numpy as np  # noqa: E402

from common import anim, fighter, materials, rig, scene  # noqa: E402
from common.hifi import sdf  # noqa: E402
from common.hifi.sdf import (Capsule, Ellipsoid, FlatCapsule, HalfSpace, Lathe, Prim, RoundBox,  # noqa: E402
                             RoundCone, Sculpt, Sphere, Torus, Tube)

ID = "tunlan"
TITLE = "Shadow puppeteer"
ROLE_MASS = "caster"
ORIGIN = "serenade"
CARD = {"primary": "#463C38", "secondary": "#B49A78"}


def unit(v):
    v = np.asarray(v, dtype=np.float64)
    return v / np.linalg.norm(v)


def ss(a, b, x):
    t = np.clip((np.asarray(x, dtype=np.float64) - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ── rig (fitted to the concept: head-box top 1.86, shoulder joints x 0.14 at 1.38 (narrow sloped shoulders), elbows
#    ~(0.25, 1.09), wrists ~(0.36, 0.81), hips x 0.085 at 0.96, ankles x 0.105 at 0.09; the hands hang 0.45 m from the
#    wrist, palms turned back) ─────────────────────────────────────────────────────────────────────────────────────
PROPORTIONS = rig.proportions(height=1.86, head=0.34, neck=0.07, shoulder_width=0.28, hip_width=0.17, leg=0.87,
                              thigh_frac=0.50, arm=0.62, upper_arm_frac=0.50, hand=0.45, foot=0.26,
                              ankle_height=0.09, spine_curve=0.0, stance=0.02, toe_out_deg=16.0, knee_bend=0.012,
                              a_pose_deg=69.0, arm_forward_deg=4.0, elbow_bend_deg=6.0, shoulder_drop=0.115)
HAND_DIR = {"L": unit((0.10, -0.035, -0.99))}       # the hands hang as painted (near plumb, a little out)
HAND_DIR["R"] = HAND_DIR["L"] * np.array([-1.0, 1.0, 1.0])
PALM = 0.190                                        # wrist -> the knuckle line
FING = (0.106, 0.093, 0.082)                        # finger segment lengths
THUMB = (0.082, 0.072)
FING_W = 0.031                                      # each finger (a pair reads 6.4 cm wide)
FING_T = 0.033
REST_CURL = (3.0, 6.0, 10.0)                        # the painted fingers' gentle curl toward the palm (deg per joint)


def _layout_arm(side: str) -> dict:
    """the rig's shoulder / elbow / wrist and the hand frame for `side` (rig._layout's arithmetic, numpy)"""
    p = PROPORTIONS
    sx = 1.0 if side == "L" else -1.0
    H = p["height"]
    z_head = H - p["head"] * 0.86
    z_neck = z_head - p["neck"]
    nb_y = -p["spine_curve"] + 0.012
    sh = np.array([p["shoulder_width"] / 2, nb_y + 0.018, z_neck - p["shoulder_drop"]])
    a, fw = math.radians(p["a_pose_deg"]), math.radians(p["arm_forward_deg"])
    d1 = unit((math.cos(a) * math.cos(fw), -math.cos(a) * math.sin(fw), -math.sin(a)))
    el = sh + d1 * p["arm"] * p["upper_arm_frac"]
    front = np.array([0.0, -1.0, 0.0])
    zf = unit(front - d1 * front.dot(d1))
    hinge = unit(np.cross(d1, zf))
    t = math.radians(p["elbow_bend_deg"])
    d2 = unit(d1 * math.cos(t) + np.cross(hinge, d1) * math.sin(t) + hinge * hinge.dot(d1) * (1 - math.cos(t)))
    wr = el + d2 * p["arm"] * (1 - p["upper_arm_frac"])
    m = np.array([sx, 1.0, 1.0])
    u = HAND_DIR[side]
    lat = unit(np.array([sx, 0.0, 0.0]) - u * u[0] * sx)           # toward her outside
    back = unit(np.cross(lat, u) * sx)                             # the palm's normal: backward (+Y)
    if back[1] < 0:
        back = -back
    return {"sh": sh * m, "el": el * m, "wr": wr * m, "d1": d1 * m, "d2": d2 * m, "u": u, "lat": lat, "back": back,
            "sx": sx}


ARM = {s: _layout_arm(s) for s in ("L", "R")}


def finger_chain(side: str, which: str, curl=None):
    """joint points (rest pose) of a finger group's bone chain: 'a' = index + middle (inside pair), 'b' = ring +
    pinky (outside pair), 't' = the thumb. Returns (points, frame) with frame = (lat, back) of the hand."""
    A = ARM[side]
    W, u, lat, back = A["wr"], A["u"], A["lat"], A["back"]
    if which == "t":
        base = W + u * 0.070 - lat * 0.074 - back * 0.004
        d = unit(u * 0.84 - lat * 0.50 - back * 0.08)
        segs, curls = THUMB, (6.0, 10.0)
    else:
        off = -0.031 if which == "a" else 0.031
        base = W + u * PALM + lat * off
        d = unit(u + lat * (-0.03 if which == "a" else 0.05))
        segs, curls = FING, REST_CURL
    curls = curl or curls
    pts = [base]
    cur = d
    for L, c in zip(segs, curls):
        ax = unit(np.cross(cur, back))                               # curl axis: the tip toward the palm (+back)
        t = math.radians(c)
        cur = unit(cur * math.cos(t) + np.cross(ax, cur) * math.sin(t))
        pts.append(pts[-1] + cur * L)
    return pts


# ── materials ────────────────────────────────────────────────────────────────────────────────────────────────
MATERIAL_SET = "bible"
PALETTE = materials.bible_palette(sandstone="#D9CBAA", wood="#CDB892", wood_dark="#5A4433", cloth2="#CEC5B6",
                                  cloth="#9C6E69", lampresin="#A8916F", ironstone="#4B4140", leather="#5A3E2C",
                                  under="#342C2B", ink="#17161A", accent="#3F9CFF")
VALUE_GRADIENT_STOPS = materials.BIBLE_GRADIENT_STOPS
SOCKETS = {"lamp": "x_lamp", "hand_gesture_r": "x_gesture_r", "hand_gesture_l": "x_gesture_l"}
SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92, "yaw": 22.0}
TEXTURE_SIZE = 2048
TEXTURE_SIZES = {"normal": 512, "orm": 512}
GLB_COMPRESS = True
ARMOUR_CONFORM = False
AO_INTO_BASE = 0.25
HEIGHT = 2.05             # the plates' scale: the hat's crown
PROJECTION = {"concept": "tunlan", "height": HEIGHT}
NOISE = sdf.Noise(31)
VOXEL = 0.0065

# ── the hat (a lathe on x_hat; top from the crown cap to the rim, the underside back to the head-box) ─────────
HAT_R = 0.612             # the shell's outer radius (the iron rim adds 2.4 cm: 1.27 m across, as painted)
CROWN_A = (0.172, 0.146)  # the stepped octagonal crown cap: apothems of the lower / upper step
CROWN_Z = (1.982, 2.018, 2.050)
SEAMS = 16                # radial panel seams on the lacquered top


def hat_top(r):
    return 2.040 - 0.290 * np.asarray(r)


def hat_under(r):
    return 1.876 - 0.120 * np.asarray(r)


RIM_C = (0.616, 1.832)    # the iron rim band's section centre (r, z) and half sizes: 1.795 - 1.869 at the outside
RIM_H = (0.020, 0.037)

# ── the lantern (x_lantern, hanging from the brim at her front-right) ─────────────────────────────────────────
LAN_X, LAN_Y = -0.345, -0.45
HANG = np.array([LAN_X, LAN_Y, float(hat_under(math.hypot(LAN_X, LAN_Y)))])
LAN_APO = 0.068           # the glass prism's apothem (hexagonal)
LAN_Z = {"roof_top": 1.772, "eave": 1.705, "glass_top": 1.700, "glass_bot": 1.578, "base_top": 1.580,
         "base_bot": 1.508, "knob": 1.486}
VENT_R = 0.050            # the lamp vent in the brim above the hook (accent disc inside an ironstone grommet)
GLOW_RING = (0.180, 0.205)   # the lamp-glass ring set into the hat top round the crown (accent), r from / to


def _vent_c():
    r = math.hypot(LAN_X, LAN_Y) - 0.025
    a = math.atan2(LAN_Y, LAN_X)
    return np.array([r * math.cos(a), r * math.sin(a), float(hat_top(r))])


class Poly(Prim):
    """a prism with a regular n-gon section about Z (apothem a, a phase in degrees), z in [z0, z1], rounded r"""

    def __init__(self, c, a, z0, z1, n=8, phase=0.0, r=0.0, taper=0.0):
        self.c = np.asarray(c, dtype=np.float64)
        self.a, self.z0, self.z1, self.n, self.r = float(a), float(z0), float(z1), int(n), float(r)
        self.taper = float(taper)              # apothem change from z0 to z1
        ang = np.radians(phase + 360.0 / n * np.arange(n))
        self.N = np.stack([np.cos(ang), np.sin(ang)], 1)

    def bounds(self):
        e = (self.a + max(self.taper, 0.0)) / math.cos(math.pi / self.n) + 0.01
        return (np.array([self.c[0] - e, self.c[1] - e, self.z0 - 0.01]),
                np.array([self.c[0] + e, self.c[1] + e, self.z1 + 0.01]))

    def d(self, P):
        q = P[:, :2] - self.c[None, :2]
        t = np.clip((P[:, 2] - self.z0) / max(self.z1 - self.z0, 1e-9), 0, 1)
        a = self.a + self.taper * t - self.r
        dxy = (q @ self.N.T).max(1) - a
        zc, hz = (self.z0 + self.z1) / 2, (self.z1 - self.z0) / 2 - self.r
        dz = np.abs(P[:, 2] - zc) - hz
        o = np.stack([np.maximum(dxy, 0), np.maximum(dz, 0)], 1)
        return np.linalg.norm(o, axis=1) + np.minimum(np.maximum(dxy, dz), 0) - self.r


class TaperBox(Prim):
    """a rounded box whose x / y half-widths run linearly from z0 to z1 (the head-box, the mask plate)"""

    def __init__(self, cx, cy, z0, z1, hx0, hx1, hy0, hy1, r=0.0):
        self.cx, self.cy, self.z0, self.z1 = float(cx), float(cy), float(z0), float(z1)
        self.hx0, self.hx1, self.hy0, self.hy1, self.r = float(hx0), float(hx1), float(hy0), float(hy1), float(r)

    def bounds(self):
        hx, hy = max(self.hx0, self.hx1), max(self.hy0, self.hy1)
        return (np.array([self.cx - hx, self.cy - hy, self.z0]), np.array([self.cx + hx, self.cy + hy, self.z1]))

    def d(self, P):
        t = np.clip((P[:, 2] - self.z0) / (self.z1 - self.z0), 0, 1)
        hx = self.hx0 + (self.hx1 - self.hx0) * t
        hy = self.hy0 + (self.hy1 - self.hy0) * t
        hz = (self.z1 - self.z0) / 2
        q = np.stack([np.abs(P[:, 0] - self.cx) - hx, np.abs(P[:, 1] - self.cy) - hy,
                      np.abs(P[:, 2] - (self.z0 + self.z1) / 2) - hz], 1) + self.r
        return np.linalg.norm(np.maximum(q, 0), axis=1) + np.minimum(q.max(1), 0) - self.r


def folds(amp, freq, axis=0, phase=0.0, zfade=None):
    def fn(P):
        u = P[:, axis] * freq + phase + 0.6 * NOISE(P, 3.0)
        a = amp
        if zfade is not None:
            z0, z1 = zfade
            a = amp * np.clip((z0 - P[:, 2]) / (z0 - z1), 0.15, 1.0)
        return a * (np.abs(np.sin(u)) * 2.0 - 1.0) * -0.5
    return fn


def ang_folds(amp, n, c=(0.0, 0.0), zfade=None, phase=0.0):
    """folds round a vertical axis (the robe's skirt): n ridges, deepening toward the hem"""
    def fn(P):
        th = np.arctan2(P[:, 1] - c[1], P[:, 0] - c[0])
        u = th * n + phase + 0.9 * NOISE(P, 2.5)
        a = amp
        if zfade is not None:
            z0, z1 = zfade
            a = amp * np.clip((z0 - P[:, 2]) / (z0 - z1), 0.1, 1.0)
        return a * (np.abs(np.sin(u)) * 2.0 - 1.0) * -0.5
    return fn


def chips(amp, freq):
    def fn(P):
        return amp * np.clip(NOISE.ridged(P, freq, 3), 0, 1) - amp * 0.3
    return fn


def wraps(amp, pitch, a, b):
    """leather / cloth wrap bands across the segment a -> b (pitch m per band)"""
    a, b = np.asarray(a, float), np.asarray(b, float)
    ax = unit(b - a)

    def fn(P):
        s = (P - a) @ ax
        return -amp * (np.abs(np.sin(s * math.pi / pitch + 0.4 * NOISE(P, 9.0))) ** 0.5 - 0.6)
    return fn


def seams_fn(P):
    """the hat top's radial panel seams (shallow grooves) and a fine paper waviness"""
    r = np.hypot(P[:, 0], P[:, 1])
    th = np.arctan2(P[:, 1], P[:, 0]) + math.pi / SEAMS
    k = SEAMS / (2 * math.pi)
    dth = (th * k - np.round(th * k)) / k                       # angular distance to the nearest seam
    g = np.exp(-((dth * r) / 0.0045) ** 2) * ss(0.19, 0.24, r) * (1 - ss(0.58, 0.60, r))
    on_top = ss(-0.012, 0.0, P[:, 2] - hat_top(r) + 0.010)
    return (0.0032 * g + 0.0012 * NOISE(P, 14.0)) * on_top


def _hat_prof(r, z):
    d_top = z - hat_top(r)
    d_bot = hat_under(r) - z
    d = np.maximum(np.maximum(d_top, d_bot), r - HAT_R) * 0.96
    return d


def _rim_prof(r, z):
    """the ironstone rim: a rounded band, thicker at the outside"""
    (rc, zc), (hr, hz) = RIM_C, RIM_H
    q0, q1 = np.abs(r - rc) - hr + 0.009, np.abs(z - zc) - hz + 0.009
    return np.hypot(np.maximum(q0, 0), np.maximum(q1, 0)) + np.minimum(np.maximum(q0, q1), 0) - 0.009


def hand_parts(side: str) -> list:
    """the carved jointed hand: (name, Sculpt, role, bind) for the palm, the finger group segments and the thumb"""
    A = ARM[side]
    W, u, lat, back = A["wr"], A["u"], A["lat"], A["back"]
    s = side
    out = []
    axes = np.stack([lat, back, -u])                     # local x = out, y = back (palm), z = up the hand
    palm = Sculpt(f"palm_{s}")
    palm.add(RoundBox(W + u * 0.092 + back * 0.002, (0.064, 0.026, 0.084), 0.016, axes=axes).displaced(
        chips(0.004, 18.0), 0.004), k=0.0)
    palm.add(Sphere(W + u * 0.004 + back * 0.004, 0.036), k=0.03)                       # the wrist knob
    palm.add(Capsule(W + u * 0.168 - lat * 0.058 - back * 0.006, W + u * 0.168 + lat * 0.058 - back * 0.006, 0.020), k=0.01)
    palm.add(RoundBox(W + u * 0.075 - lat * 0.052 + back * 0.004, (0.022, 0.024, 0.040), 0.012, axes=axes), k=0.02)  # thumb mount
    # carved lines: the back-of-hand plate's border and the knuckle groove
    palm.sub(Capsule(W + u * 0.150 - lat * 0.07 - back * 0.030, W + u * 0.150 + lat * 0.07 - back * 0.030, 0.0035), k=0.002)
    out.append((f"palm_{s}", palm, "wood", f"bone:hand.{s}"))
    for which in ("a", "b", "t"):
        pts = finger_chain(s, which)
        offs = (-0.0155, 0.0155) if which != "t" else (0.0,)
        nseg = len(pts) - 1
        for i in range(nseg):
            S = Sculpt(f"f{which}{i + 1}_{s}")
            a, b = pts[i], pts[i + 1]
            d = unit(b - a)
            bx = unit(back - d * back.dot(d))
            lx = unit(np.cross(bx, d))
            ax_ = np.stack([lx, bx, d])
            L = float(np.linalg.norm(b - a))
            taper = 1.0 - 0.10 * i
            for o in offs:
                c0 = a + d * (L * 0.5 + 0.001) + lx * o
                w = (FING_W * 0.5 - 0.0008) * (0.95 if which == "t" else 1.0)
                S.add(RoundBox(c0, (w * taper, FING_T * 0.5 * taper, L * 0.5 - 0.0045), 0.0070, axes=ax_), k=0.0)
                if i < nseg - 1 or which == "t" and i == 0:
                    S.add(Capsule(b + lx * (o - w * 0.75), b + lx * (o + w * 0.75), 0.0095 * taper), k=0.003)  # the joint
                if i == nseg - 1:
                    S.add(Sphere(b - d * 0.012 + lx * o, w * taper * 0.95), k=0.012)                    # the rounded tip
                S.sub(Capsule(a + d * (L * 0.30) + lx * (o - w) - bx * 0.018, a + d * (L * 0.30) + lx * (o + w) - bx * 0.018, 0.0022), k=0.001)
            bone = f"x_f{which}{i + 1}.{s}"
            out.append((f"f{which}{i + 1}_{s}", S, "wood", f"bone:{bone}"))
    return out


def sculpts() -> list:
    """(name, Sculpt, voxel scale, material role, bind, tris) in build order."""
    out = []

    def part(name, S, role, bind, tris, vs=1.0):
        out.append((name, S, vs, role, bind, tris))

    # ── HAT (x_hat): the shell (lathe) + the stepped octagonal crown; the rim; the lamp vent ──
    hat = Sculpt("hat")
    hat.add(Lathe((0, 0, 0), _hat_prof, HAT_R + 0.01, 1.80, 2.0).displaced(seams_fn, 0.0045), k=0.0)
    hat.add(Poly((0, 0, 0), CROWN_A[0], CROWN_Z[0] - 0.02, CROWN_Z[1] + 0.004, 8, 22.5, 0.010), k=0.006)
    hat.add(Poly((0, 0, 0), CROWN_A[1], CROWN_Z[1] - 0.004, CROWN_Z[2], 8, 22.5, 0.012, taper=-0.010), k=0.004)
    hat.sub(Sphere(_vent_c() + np.array([0, 0, 0.004]), VENT_R), k=0.004)
    g0, g1 = GLOW_RING
    hat.sub(Lathe((0, 0, 0), lambda r, z: np.maximum(np.abs(r - (g0 + g1) / 2) - (g1 - g0) / 2 - 0.002,
                                                       np.abs(z - hat_top(r)) - 0.006), g1 + 0.01, 1.9, 2.05), k=0.002)
    part("hat", hat, "sandstone", "bone:x_hat", 3600)
    ring = Sculpt("crown_glow")
    ring.add(Lathe((0, 0, 0), lambda r, z: np.maximum(np.abs(r - (g0 + g1) / 2) - (g1 - g0) / 2,
                                                        np.abs(z - (hat_top(r) - 0.006)) - 0.0045), g1 + 0.01, 1.9, 2.05), k=0.0)
    part("crown_glow", ring, "accent", "bone:x_hat", 400, 0.5)
    rim = Sculpt("hat_rim")
    rim.add(Lathe((0, 0, 0), _rim_prof, 0.66, 1.80, 1.90).displaced(chips(0.003, 10.0), 0.003), k=0.0)
    for i in range(20):                                   # the rim's segment joints (painted as plates)
        a = 2 * math.pi * (i + 0.5) / 20
        c = np.array([math.cos(a) * 0.636, math.sin(a) * 0.636, RIM_C[1]])
        rim.sub(Capsule(c - np.array([0, 0, 0.04]), c + np.array([0, 0, 0.04]), 0.0035), k=0.002)
    part("hat_rim", rim, "ironstone", "bone:x_hat", 1100, 0.7)
    vent = Sculpt("vent_ring")
    vc = _vent_c()
    vent.add(Torus(vc + np.array([0, 0, -0.002]), VENT_R + 0.004, 0.010, axes=sdf.frame((0.27 * unit(vc[:2])[0], 0.27 * unit(vc[:2])[1], 1.0)), rz=0.008), k=0.0)
    part("vent_ring", vent, "ironstone", "bone:x_hat", 260, 0.5)
    glow = Sculpt("vent_glow")
    glow.add(Ellipsoid(vc + np.array([0, 0, -0.010]), (VENT_R - 0.002, VENT_R - 0.002, 0.008)), k=0.0)
    part("vent_glow", glow, "accent", "bone:x_hat", 120, 0.5)

    # ── LANTERN (x_lantern): hook ring + rod, roof, six posts, glass (accent), base, knob ──
    H = HANG
    c = H[:2]
    hook = Sculpt("lantern_hook")
    hook.add(Torus(H + np.array([0, 0, -0.012]), 0.016, 0.0045, axes=sdf.frame((1.0, 0.0, 0.0))), k=0.0)
    hook.add(Torus(H + np.array([0, 0, -0.040]), 0.014, 0.0045, axes=sdf.frame((0.0, 1.0, 0.0))), k=0.0)
    hook.add(Capsule(H + np.array([0, 0, -0.052]), (c[0], c[1], LAN_Z["roof_top"] + 0.004), 0.0055), k=0.004)
    hook.add(Torus((c[0], c[1], LAN_Z["roof_top"] + 0.006), 0.014, 0.0045, axes=sdf.frame((1.0, 0.0, 0.0))), k=0.0)
    part("lantern_hook", hook, "ironstone", "bone:x_lantern", 300, 0.5)
    frame = Sculpt("lantern_frame")
    ez, rt = LAN_Z["eave"], LAN_Z["roof_top"]
    frame.add(Poly((c[0], c[1], 0), LAN_APO + 0.044, ez - 0.006, ez + 0.012, 6, 0.0, 0.006), k=0.0)          # eave lip
    frame.add(Poly((c[0], c[1], 0), LAN_APO + 0.034, ez + 0.006, rt - 0.020, 6, 0.0, 0.008, taper=-0.070), k=0.012)  # roof
    frame.add(Poly((c[0], c[1], 0), 0.026, rt - 0.026, rt, 6, 0.0, 0.006), k=0.006)                           # roof cap
    frame.add(Poly((c[0], c[1], 0), LAN_APO + 0.012, LAN_Z["glass_top"] - 0.008, LAN_Z["glass_top"] + 0.006, 6, 0.0, 0.004), k=0.0)
    frame.add(Poly((c[0], c[1], 0), LAN_APO + 0.026, LAN_Z["base_top"] - 0.020, LAN_Z["base_top"] + 0.004, 6, 0.0, 0.006), k=0.0)
    frame.add(Poly((c[0], c[1], 0), LAN_APO + 0.010, LAN_Z["base_bot"], LAN_Z["base_top"] - 0.018, 6, 0.0, 0.008, taper=0.014), k=0.008)
    frame.add(Sphere((c[0], c[1], LAN_Z["knob"] + 0.010), 0.018), k=0.010)
    for i in range(6):
        a = math.radians(30.0 + 60.0 * i)
        rr = (LAN_APO + 0.004) / math.cos(math.radians(30.0))
        p = np.array([c[0] + rr * math.cos(a), c[1] + rr * math.sin(a)])
        frame.add(Capsule((p[0], p[1], LAN_Z["glass_bot"] - 0.004), (p[0], p[1], LAN_Z["glass_top"] + 0.002), 0.0095), k=0.003)
    part("lantern_frame", frame, "ironstone", "bone:x_lantern", 1300, 0.55)
    glass = Sculpt("lantern_glass")
    glass.add(Poly((c[0], c[1], 0), LAN_APO, LAN_Z["glass_bot"], LAN_Z["glass_top"], 6, 0.0, 0.004), k=0.0)
    part("lantern_glass", glass, "accent", "bone:x_lantern", 160, 0.55)

    # ── HEAD (head): the walnut head-box with its crown band; the pale carved mask on its front ──
    head = Sculpt("head")
    head.add(TaperBox(0.0, 0.025, 1.520, 1.800, 0.120, 0.170, 0.100, 0.124, 0.030), k=0.0)
    head.add(RoundBox((0.0, 0.020, 1.826), (0.168, 0.132, 0.036), 0.016), k=0.012)                      # crown band
    head.sub(Capsule((-0.18, 0.02, 1.795), (0.18, 0.02, 1.795), 0.0045), k=0.002)                         # band seam
    head.add(RoundBox((0.0, 0.020, 1.858), (0.150, 0.118, 0.010), 0.006), k=0.0)                          # under the hat
    for sx in (-1, 1):
        head.sub(Capsule((sx * 0.06, 0.142, 1.56), (sx * 0.075, 0.150, 1.79), 0.0035), k=0.002)          # board joints
    part("head", head, "wood_dark", "bone:head", 1100)
    mask = Sculpt("mask")
    plate = TaperBox(0.0, -0.100, 1.494, 1.832, 0.108, 0.172, 0.050, 0.050, 0.020)
    mask.add(plate, k=0.0)
    mask.inter(Ellipsoid((0.0, 0.095, 1.68), (0.320, 0.243, 0.64)), k=0.010)
    mask.add(RoundBox((0.0, -0.140, 1.768), (0.150, 0.016, 0.011), 0.008), k=0.010)                      # brow shelf
    for sx in (-1, 1):
        mask.add(Ellipsoid((sx * 0.072, -0.138, 1.640), (0.050, 0.020, 0.040)), k=0.025)                 # cheek plates
        mask.sub(Ellipsoid((sx * 0.066, -0.150, 1.726), (0.044, 0.024, 0.0115), axes=sdf.rot_y(sx * 6)), k=0.004)  # eyes
        mask.sub(Tube([(sx * 0.130, -0.118, 1.810), (sx * 0.134, -0.120, 1.700), (sx * 0.112, -0.126, 1.590),
                       (sx * 0.076, -0.130, 1.520)], [0.0028] * 4), k=0.0015)                               # side plates
    mask.add(RoundCone((0.0, -0.146, 1.752), (0.0, -0.196, 1.632), 0.018, 0.016), k=0.012)              # the beak
    mask.add(Ellipsoid((0.0, -0.178, 1.628), (0.032, 0.022, 0.016)), k=0.012)                            # nostril wings
    smile = [(-0.068, 1.598), (-0.038, 1.588), (0.0, 1.585), (0.038, 1.588), (0.068, 1.598)]
    mask.sub(Tube([(x, -0.147 + 0.30 * x * x, z) for x, z in smile], [0.0055] * 5), k=0.002)
    mask.add(Ellipsoid((0.0, -0.126, 1.530), (0.066, 0.024, 0.032)), k=0.020)                            # chin
    part("mask", mask, "wood", "bone:head", 2000, 0.6)

    # ── NECK (wrapped) ──
    neck = Sculpt("neck")
    neck.add(Capsule((0.0, 0.010, 1.40), (0.0, 0.012, 1.55), 0.062).displaced(
        wraps(0.004, 0.026, (0, 0, 1.40), (0, 0, 1.55)), 0.004), k=0.0)
    part("neck", neck, "leather", ("weights", "neck"), 380)

    # ── ROBE: the top (shoulders, chest, collar), the skirt (sash to hem), sleeves, cuffs ──
    top = Sculpt("robe_top")
    top.add(Ellipsoid((0.0, 0.0, 1.27), (0.168, 0.122, 0.175)), k=0.0)
    top.add(Ellipsoid((0.0, 0.004, 1.37), (0.170, 0.115, 0.080)), k=0.06)
    for sx in (-1, 1):
        top.add(Sphere((sx * 0.135, 0.016, 1.378), 0.072), k=0.05)
    # the crossed collar: the robe's lapels and the cream under-collar as raised bands (her left over her right)
    for sx in (-1, 1):
        top.add(Tube([(sx * 0.070, 0.070, 1.455), (sx * 0.085, -0.040, 1.448), (sx * 0.070, -0.105, 1.39),
                      (sx * 0.010, -0.128, 1.25), (-sx * 0.04, -0.124, 1.17)], [0.018, 0.020, 0.020, 0.016, 0.014], k=0.01), k=0.012)
    top.inter(HalfSpace((0, 0, 1.105), (0, 0, -1), 1.0), k=0.01)
    part("robe_top", top, "cloth", ("weights", "torso"), 2400)
    skirt = Sculpt("robe_skirt")
    sk = FlatCapsule((0.0, 0.012, 0.280), (0.0, 0.004, 1.175), 0.240, 0.182, 0.148, 0.116, side=(1, 0, 0))
    skirt.add(sk.displaced(ang_folds(0.012, 7, (0.0, 0.01), zfade=(1.05, 0.30), phase=0.4), 0.012), k=0.0)
    skirt.inter(HalfSpace((0, 0, 0.238), (0, 0, -1), 2.0), k=0.012)
    skirt.inter(HalfSpace((0, 0, 1.20), (0, 0, 1), 2.0), k=0.01)
    # the outer robe's front edges (her left panel overlaps at x +0.07; the cream under-robe shows between)
    skirt.sub(Tube([(0.072, -0.150, 1.10), (0.075, -0.175, 0.70), (0.080, -0.210, 0.27)], [0.004, 0.004, 0.005]), k=0.003)
    skirt.sub(Tube([(-0.075, -0.145, 1.10), (-0.105, -0.170, 0.70), (-0.120, -0.200, 0.27)], [0.004, 0.004, 0.005]), k=0.003)
    part("robe_skirt", skirt, "cloth", ("weights", "skirt"), 2600)
    sash = Sculpt("sash")
    sash.add(Torus((0.0, 0.004, 1.165), 0.150, 0.046, axes=np.diag([1.0, 0.150 / 0.122, 1.0]), rz=0.050).displaced(
        lambda P: 0.003 * np.sin(P[:, 2] * 160.0 + 3.0 * NOISE(P, 6.0)), 0.003), k=0.0)
    sash.add(Ellipsoid((-0.035, -0.150, 1.160), (0.042, 0.026, 0.036)), k=0.012)                         # the knot
    for sx in (-1, 1):
        sash.add(Ellipsoid((-0.035 + sx * 0.040, -0.140, 1.172), (0.034, 0.018, 0.026), axes=sdf.rot_y(sx * 25)), k=0.008)
    sash.add(RoundBox((-0.040, -0.160, 0.995), (0.024, 0.008, 0.150), 0.005, axes=sdf.rot_x(6)), k=0.008)  # the tail
    sash.add(RoundBox((-0.012, -0.156, 1.040), (0.018, 0.007, 0.100), 0.005, axes=sdf.rot_x(5) @ sdf.rot_y(-6)), k=0.006)
    part("sash", sash, "leather", ("weights", "sash"), 1000)
    for s, sx in (("R", -1.0), ("L", 1.0)):
        A = ARM[s]
        sh, el, wr = A["sh"], A["el"], A["wr"]
        sl = Sculpt(f"sleeve_{s}")
        sl.add(FlatCapsule(sh + np.array([sx * -0.01, 0.0, 0.0]), el, 0.072, 0.074, 0.070, 0.072, side=(0, 1, 0)).displaced(
            folds(0.006, 30.0, axis=2), 0.006), k=0.0)
        cuff_c = el + (wr - el) * 0.32
        sl.add(RoundCone(el, cuff_c, 0.070, 0.082), k=0.03)
        part(f"sleeve_{s}", sl, "cloth", ("weights", f"sleeve_{s}"), 900)
        cf = Sculpt(f"cuff_{s}")
        dfo = unit(wr - el)
        cf.add(Torus(el + (wr - el) * 0.34, 0.072, 0.030, axes=sdf.frame(dfo), rz=0.046).displaced(chips(0.004, 9.0), 0.004), k=0.0)
        cf.sub(Capsule(el + (wr - el) * 0.10, el + (wr - el) * 0.40, 0.050), k=0.01)
        part(f"cuff_{s}", cf, "cloth2", f"bone:forearm.{s}", 600)
        wr_ = Sculpt(f"wrap_{s}")
        a0, b0 = el + (wr - el) * 0.25, wr + (wr - el) * 0.02
        wr_.add(RoundCone(a0, b0, 0.050, 0.043).displaced(wraps(0.0045, 0.032, a0, b0), 0.0045), k=0.0)
        part(f"wrap_{s}", wr_, "leather", f"bone:forearm.{s}", 500)

    # ── HANDS (rigid segments on hand / finger bones) ──
    for s in ("R", "L"):
        for name, S, role, bind in hand_parts(s):
            tris = 420 if name.startswith("palm") else 150
            part(name, S, role, bind, tris, 0.45)

    # ── LEGS + BOOTS ──
    legs = Sculpt("legs")
    for sx in (-1, 1):
        legs.add(RoundCone((sx * 0.090, 0.004, 0.52), (sx * 0.105, 0.020, 0.13), 0.058, 0.044), k=0.0)
    part("legs", legs, "under", ("weights", "legs"), 600)
    boots = Sculpt("boots")
    for sx in (-1, 1):
        ax = np.array([sx * 0.105, 0.020, 0.090])
        to = math.radians(PROPORTIONS["toe_out_deg"] + 6.0)
        fwd = np.array([sx * math.sin(to), -math.cos(to), 0.0])
        boots.add(RoundCone(ax + np.array([0, 0.0, -0.03]), ax + np.array([0, 0.0, 0.098]), 0.062, 0.060), k=0.0)
        boots.add(Torus(ax + np.array([0, 0.0, 0.090]), 0.062, 0.013), k=0.006)                          # the cuff
        heel = ax + np.array([0, 0, -0.052]) - fwd * 0.040
        toe = ax + np.array([0, 0, -0.058]) + fwd * 0.175
        boots.add(FlatCapsule(heel, toe, 0.054, 0.040, 0.050, 0.030, side=(fwd[1], -fwd[0], 0)), k=0.035)
        boots.add(Ellipsoid(toe + fwd * 0.005 + np.array([0, 0, 0.004]), (0.048, 0.050, 0.032),
                            axes=sdf.rot_z(math.degrees(math.atan2(fwd[0], -fwd[1])) * -1)), k=0.03)
    boots.inter(HalfSpace((0, 0, 0.0), (0, 0, -1), 2.0), k=0.0)
    part("boots", boots, "leather", ("weights", "boots"), 1300)
    return out


# ── model ────────────────────────────────────────────────────────────────────────────────────────────────────
def hat_profile() -> list:
    """the hat's game-mesh profile (r, z) from the crown down the top to the rim, back under to the head-box"""
    pts = [(0.0, CROWN_Z[2])]
    a1 = CROWN_A[1] - 0.010
    pts += [(a1 * 0.55, CROWN_Z[2]), (a1 - 0.012, CROWN_Z[2] - 0.001), (a1 - 0.002, CROWN_Z[2] - 0.006),
            (a1 + 0.004, CROWN_Z[1] + 0.008), (CROWN_A[1] + 0.006, CROWN_Z[1] + 0.001),
            (CROWN_A[0] - 0.010, CROWN_Z[1]), (CROWN_A[0] - 0.002, CROWN_Z[1] - 0.006),
            (CROWN_A[0] + 0.001, CROWN_Z[1] - 0.018), (CROWN_A[0] + 0.004, float(hat_top(CROWN_A[0] + 0.004)) + 0.002)]
    for r in (0.20, 0.24, 0.28, 0.32, 0.36, 0.40, 0.44, 0.48, 0.52, 0.56, 0.59):
        pts.append((r, float(hat_top(r))))
    for r in (0.59, 0.55, 0.50, 0.45, 0.40, 0.35, 0.30, 0.25, 0.20, 0.17):
        pts.append((r, float(hat_under(r))))
    pts.append((0.15, 1.872))
    pts.append((0.0, 1.872))
    return pts


def _oct_scale(th, a_phase=22.5):
    """an octagon of apothem 1 at angle th (radius of its boundary)"""
    k = math.pi / 4
    u = (th - math.radians(a_phase)) % k - k / 2
    return math.cos(k / 2) / math.cos(u)


def lathe_low(name, profile, mat, col, seg=64, octagon_r=0.0, center=(0.0, 0.0)):
    """a clean lathe game mesh; profile rings with r <= octagon_r follow the crown's octagon"""
    import bmesh
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        if r < 1e-6:
            rings.append([bm.verts.new((center[0], center[1], z))])
            continue
        ring = []
        for j in range(seg):
            th = 2 * math.pi * j / seg
            rr = r * (_oct_scale(th) if r <= octagon_r else 1.0)
            ring.append(bm.verts.new((center[0] + rr * math.cos(th), center[1] + rr * math.sin(th), z)))
        rings.append(ring)
    for A, B in zip(rings[:-1], rings[1:]):
        for j in range(seg):
            if len(A) == 1:
                bm.faces.new((A[0], B[(j + 1) % seg], B[j]))
            elif len(B) == 1:
                bm.faces.new((A[j], A[(j + 1) % seg], B[0]))
            else:
                bm.faces.new((A[j], A[(j + 1) % seg], B[(j + 1) % seg], B[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    ob.data.materials.append(mat)
    return ob


def rim_profile() -> list:
    out = []
    (rc, zc), (hr, hz) = RIM_C, RIM_H
    for a in range(0, 360, 30):
        t = math.radians(a + 15)
        cx, cz = math.cos(t), math.sin(t)
        r = rc + (hr - 0.007) * np.sign(cx) + 0.007 * cx
        z = zc + (hz - 0.007) * np.sign(cz) + 0.007 * cz
        out.append((r, z))
    out.append(out[0])
    return out


def model(ctx) -> list:
    P = []
    for name, S, vs, role, bind, tris in sculpts() + skin_extras((ctx.skin or {}).get("extra") or {}):
        v, q = S.mesh(VOXEL * vs)
        ob = sdf.to_object(f"{name}_high", v, q, ctx.col)
        ob.data.materials.append(ctx.mats[role])
        if name == "hat":
            low = lathe_low("hat_low", hat_profile(), ctx.mats[role], ctx.col, 64, octagon_r=CROWN_A[0] + 0.006)
            P.append(fighter.Part(name, high=ob, low=low, bind=bind))
            continue
        if name == "hat_rim":
            low = lathe_low("hat_rim_low", rim_profile(), ctx.mats[role], ctx.col, 64)
            P.append(fighter.Part(name, high=ob, low=low, bind=bind))
            continue
        P.append(fighter.Part(name, high=ob, tris=tris, bind=bind))
    return P


def skin_extras(extra: dict) -> list:
    out = []
    if extra.get("puppet_rods"):
        for i, (dx, ang) in enumerate(((0.0, 14.0), (0.045, 22.0))):
            rod = Sculpt(f"rod_{i}")
            top = np.array([0.165 + dx, -0.060, 1.16])
            d = unit((math.sin(math.radians(ang)) * 0.6, -0.15, -1.0))
            rod.add(Capsule(top, top + d * 0.42, 0.010), k=0.0)
            out.append((f"rod_{i}", rod, "wood_dark", ("weights", "sash"), 120, 0.5))
            head = Sculpt(f"rodhead_{i}")
            head.add(Ellipsoid(top + d * 0.45, (0.032, 0.020, 0.040)), k=0.0)
            head.add(RoundCone(top + d * 0.45 + np.array([0, 0, 0.03]), top + d * 0.45 + np.array([0.0, 0.0, 0.07]), 0.020, 0.004), k=0.01)
            out.append((f"rodhead_{i}", head, "lilac", ("weights", "sash"), 200, 0.5))
    return out


def extra_materials(ctx) -> dict:
    """roles the bible set lacks: `lilac` (Noon Fair's puppet heads)"""
    out = {}
    if "lilac" in ctx.palette and "lilac" not in ctx.mats:
        m = ctx.mats["cloth2"].copy()
        m.name = "lilac"
        out["lilac"] = m
    return out


# ── rig: the hands as painted, the hat, the lantern's pendulum, the finger bones, sockets ─────────────────────────
from mathutils import Vector as V  # noqa: E402
from common import mesh as _mesh, pipeline as _pipeline  # noqa: E402

FINGER_BONES = {s: [f"x_f{w}{i}.{s}" for w, n in (("a", 3), ("b", 3), ("t", 2)) for i in range(1, n + 1)] for s in "LR"}


def rig_extras(ctx) -> None:
    info = ctx.info
    arm = info.armature
    scene.select_only([arm], arm)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    front = V((0.0, -1.0, 0.0))
    for s in "LR":
        A = ARM[s]
        u = V(tuple(A["u"]))
        hb = eb[f"hand.{s}"]
        w = V(hb.head)
        hb.tail = w + u * PROPORTIONS["hand"] * 0.5
        hb.align_roll(front - u * front.dot(u))
        pb = eb[f"prop.{s}"]
        pc = w + u * 0.10 + V(tuple(A["back"])) * 0.03
        pb.head = pc
        pb.tail = pc + front * 0.12
        for which, n in (("a", 3), ("b", 3), ("t", 2)):
            pts = finger_chain(s, which)
            prev = f"hand.{s}"
            for i in range(n):
                nm = f"x_f{which}{i + 1}.{s}"
                b = eb.new(nm)
                b.head = V(tuple(pts[i]))
                b.tail = V(tuple(pts[i + 1]))
                b.align_roll(V(tuple(A["back"])))
                b.parent = eb[prev]
                b.use_connect = i > 0
                b.use_deform = True
                prev = nm
    hat = eb.new("x_hat")
    hat.head = V((0.0, 0.0, 1.86))
    hat.tail = V((0.0, 0.0, 1.96))
    hat.align_roll(front)
    hat.parent = eb["head"]
    hat.use_deform = True
    lb = eb.new("x_lantern")
    lb.head = V(tuple(HANG))
    lb.tail = V(tuple(HANG - np.array([0.0, 0.0, 0.12])))
    lb.align_roll(front)
    lb.parent = hat
    lb.use_deform = True
    bpy.ops.object.mode_set(mode="OBJECT")
    for nm in ["x_hat", "x_lantern"] + FINGER_BONES["L"] + FINGER_BONES["R"]:
        arm.pose.bones[nm].rotation_mode = "XYZ"
    for b in arm.data.bones:
        info.lengths[b.name] = b.length
    gz = (LAN_Z["glass_bot"] + LAN_Z["glass_top"]) / 2
    rig.add_socket(info, "x_lamp", "x_lantern", (LAN_X, LAN_Y, gz), (0.0, 0.0, 0.06))
    for s, nm in (("R", "x_gesture_r"), ("L", "x_gesture_l")):
        tip = finger_chain(s, "a")[-1]
        rig.add_socket(info, nm, f"x_fa3.{s}", tuple(tip), tuple(unit(tip - finger_chain(s, "a")[-2]) * 0.05))


def chain_config(ctx) -> list:
    """the lantern hangs on its hook: a damped pendulum about the brim (front-back), kept near plumb"""
    return [anim.ChainCfg(["x_lantern"], gravity=1.0, stiffness=70.0, damping=7.0, inertia=0.5, limit=(-28.0, 28.0),
                          floor=None)]


# ── skin weights (pipeline.bind_part wrapper: ("weights", how)) ────────────────────────────────────────────
def _seg_dist(P, a, b):
    ab = b - a
    t = np.clip(((P - a) @ ab) / float(ab @ ab), 0.0, 1.0)
    return np.linalg.norm(P - (a + t[:, None] * ab[None, :]), axis=1)


def _w_neck(P, J):
    z = P[:, 2]
    wh = ss(1.50, 1.56, z)
    wc = 1 - ss(1.40, 1.47, z)
    return {"head": wh, "chest": wc, "neck": np.clip(1 - wh - wc, 0, 1)}


def _w_torso(P, J):
    x, z = P[:, 0], P[:, 2]
    wh = 1 - ss(1.12, 1.22, z)
    wc = ss(1.24, 1.36, z)
    ws = np.clip(1 - wh - wc, 0, 1)
    sh = ss(0.08, 0.15, np.abs(x)) * ss(1.30, 1.42, z)
    ua = ss(0.15, 0.22, np.abs(x)) * (1 - ss(1.36, 1.44, z)) * 0.6
    k = np.clip(1 - sh - ua, 0, 1)
    wn = ss(1.44, 1.50, z) * (1 - ss(0.06, 0.10, np.abs(x))) * 0.5
    k2 = k * (1 - wn)
    return {"hips": wh * k2, "spine": ws * k2, "chest": wc * k2, "neck": wn * k, "shoulder.L": sh * (x > 0),
            "shoulder.R": sh * (x <= 0), "upper_arm.L": ua * (x > 0), "upper_arm.R": ua * (x <= 0)}


def _w_skirt(P, J):
    """the robe from the sash to the hem: the hips at the waist, each side's leg below (blended across the middle),
    the shins sharing the hem"""
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    leg = 0.62 * ss(1.06, 0.60, z)
    side_l = ss(-0.12, 0.12, x)
    shin = leg * 0.38 * ss(0.62, 0.28, z) * (0.6 + 0.4 * ss(-0.05, 0.12, -y))
    th = leg - shin
    sp = 0.3 * ss(1.10, 1.20, z)
    return {"hips": np.clip(1 - leg - sp, 0, 1), "spine": sp, "thigh.L": th * side_l, "thigh.R": th * (1 - side_l),
            "shin.L": shin * side_l, "shin.R": shin * (1 - side_l)}


def _w_sash(P, J):
    z = P[:, 2]
    lo = ss(1.10, 0.85, z)
    x = P[:, 0]
    side_l = ss(-0.10, 0.10, x)
    return {"hips": 0.65 * (1 - lo) + 0.55 * lo, "spine": 0.35 * (1 - lo), "thigh.L": 0.45 * lo * side_l,
            "thigh.R": 0.45 * lo * (1 - side_l)}


def _w_legs(P, J):
    x, z = P[:, 0], P[:, 2]
    m = (x > 0).astype(float)
    knee = J["shin.L"][0][2]
    ws = ss(knee + 0.04, knee - 0.04, z)
    return {"shin.L": ws * m, "shin.R": ws * (1 - m), "thigh.L": (1 - ws) * m, "thigh.R": (1 - ws) * (1 - m)}


def _w_sleeve(side):
    def fn(P, J):
        sx = 1.0 if side == "L" else -1.0
        j, e = J[f"upper_arm.{side}"]
        fe, fw = J[f"forearm.{side}"]
        u = unit(e - j)
        d = (P - j) @ u
        wsh = (1 - ss(-0.05, 0.05, d)) * 0.7
        uf = unit(fw - fe)
        past = ss(-0.04, 0.03, (P - fe) @ uf)
        wf = past * (1 - wsh)
        wu = np.clip(1 - wsh - wf, 0, 1)
        wc = wsh * 0.35
        return {f"shoulder.{side}": wsh * 0.65, "chest": wc, f"upper_arm.{side}": wu, f"forearm.{side}": wf}
    return fn


def _w_boots(P, J):
    out = {}
    for s, sx in (("L", 1.0), ("R", -1.0)):
        m = (P[:, 0] * sx > 0).astype(float)
        knee, ankle = J[f"shin.{s}"]
        ball = J[f"toe.{s}"][0]
        z = P[:, 2]
        wsh = ss(ankle[2] + 0.02, ankle[2] + 0.09, z)
        d = (ball - ankle) * np.array([1.0, 1.0, 0.0])
        d /= max(float(np.linalg.norm(d)), 1e-6)
        sb = (P - ball) @ d
        rest = np.clip(1 - wsh, 0, 1)
        wto = ss(-0.015, 0.025, sb) * rest
        out[f"shin.{s}"] = wsh * m
        out[f"foot.{s}"] = (rest - wto) * m
        out[f"toe.{s}"] = wto * m
    return out


WEIGHTS = {"neck": _w_neck, "torso": _w_torso, "skirt": _w_skirt, "sash": _w_sash, "legs": _w_legs,
           "sleeve_L": _w_sleeve("L"), "sleeve_R": _w_sleeve("R"), "boots": _w_boots}


def _bind_weights(arm, obj, how) -> None:
    me = obj.data
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    mw = np.array(obj.matrix_world)
    P = co.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3]
    J = {b.name: (np.array(b.head_local), np.array(b.tail_local)) for b in arm.data.bones}
    W = WEIGHTS[how](P, J)
    tot = np.maximum(sum(W.values()), 1e-6)
    obj.vertex_groups.clear()
    for name, w in W.items():
        w = w / tot
        idx = np.nonzero(w > 2e-3)[0]
        if not len(idx):
            continue
        g = obj.vertex_groups.new(name=name)
        for i in idx:
            g.add([int(i)], float(w[i]), "REPLACE")
    _mesh.add_armature_modifier(obj, arm)
    _mesh.parent_keep(obj, arm)
    _mesh.limit_weights(obj)


_orig_bind_part = _pipeline.bind_part


def _bind_part(ctx, part, obj, body_low=None):
    b = part.bind
    if isinstance(b, tuple) and b[0] == "weights":
        _bind_weights(ctx.info.armature, obj, b[1])
        return {}
    return _orig_bind_part(ctx, part, obj, body_low)


_pipeline.bind_part = _bind_part

# ── paint (project.paint wrapper) ───────────────────────────────────────────────────────────────────────────
from common import bake as _bake  # noqa: E402
from common.hifi import project as _project  # noqa: E402

PROC = ("hat", "hat_rim", "vent_ring", "lantern_hook", "lantern_frame", "legs")
WOOD_PARTS = tuple(f"{nm}_{s}" for s in "LR" for nm in ["palm"] + [f"f{w}{i}" for w, n in (("a", 3), ("b", 3), ("t", 2))
                                                                for i in range(1, n + 1)])
CLOTH_PARTS = ("robe_top", "robe_skirt", "sleeve_L", "sleeve_R")
BACK_PARTS = CLOTH_PARTS + ("sash", "cuff_L", "cuff_R", "wrap_L", "wrap_R", "neck", "head", "boots")
SIDE_PARTS = CLOTH_PARTS + ("sash", "cuff_L", "cuff_R", "wrap_L", "wrap_R", "neck", "head", "mask", "boots")
SIDE_FACE = (0.22, 0.60)
SIDE_FACE_PART = {"mask": (0.30, 0.75), "head": (0.30, 0.70)}
SIDE_HI = 1.12
BACK_DETAIL = 0.6
# the back sheet paints these parts in deep shade; their front tone is the reference (target hexes where the front is
# not seen: the head-box's back, under the hat)
BACK_TARGET = {"head": "#5E4836"}
# z / 2.05 -> linear gain: light head, darker feet (brief §6: top L* 70-85, middle 45-65, feet 20-35)
VALUE_RAMP = [(0.0, 0.70), (0.06, 0.74), (0.12, 0.80), (0.20, 0.88), (0.35, 0.98), (0.50, 1.04), (0.62, 1.10),
              (0.72, 1.12), (0.85, 1.08), (1.0, 1.04)]
HI_KNEE, HI_TOP = 0.56, 0.68      # linear luminance: a soft shoulder from L* 80 up to ~L* 86 (no large area over 86)
KEY = unit((-0.40, -0.70, 0.60))  # the painted key light: upper front, her right


def _hex(h):
    return np.asarray(scene.hex_srgb(h), dtype=np.float32)


def _lin(c):
    return _project._lin(c)


def _srgb(c):
    return _project._srgb(c).astype(np.float32)


def _Y(lin):
    return lin @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def _hi_cap(lin):
    Y = np.maximum(_Y(lin), 1e-6)
    hi = Y > HI_KNEE
    Y2 = Y.copy()
    Y2[hi] = HI_KNEE + (HI_TOP - HI_KNEE) * (1 - np.exp(-(Y[hi] - HI_KNEE) / (HI_TOP - HI_KNEE)))
    return lin * (Y2 / Y)[:, None]


def _fbm(P, f, o=3):
    return NOISE.fbm(P, f, o)


def _lam(n, lo=0.74, k=0.32):
    return lo + k * np.clip(n @ KEY, -0.4, 1.0)


_HID = [None]


def _proj_sides(maps, plates, vis, names, eps=0.02, log=print):
    """project.paint's projection with the front and back colours kept apart (the shared code blends them)"""
    P, N, part = maps["P"], maps["N"], maps["part"]
    have = part >= 0
    fills = {}
    for side in ("front", "back"):
        pid = vis.part[side]
        s_ = vis.step
        small = plates.img[side][s_ // 2::s_, s_ // 2::s_][:pid.shape[0], :pid.shape[1]]
        for k in np.unique(part[have]):
            valid = pid == k
            if not valid.any():
                continue
            iy, ix = _project.nearest_index(valid)
            fills[(side, int(k))] = _project.blur(small[iy, ix], 1.0)
    idx = np.nonzero(have)
    p, n = P[idx], N[idx]
    k = part[idx].astype(np.int64)
    st = np.abs(n[:, 0]) / (np.abs(n[:, 0]) + np.abs(n[:, 1]) + 1e-6)
    ws = np.clip((st - 0.72) / 0.24, 0, 1)
    ws = (ws * ws * (3 - 2 * ws))[:, None]
    soft = {s_: _project.blur(plates.img[s_], 4.0) for s_ in ("front", "back")}
    cols = {}
    hid_both = np.ones(len(p), dtype=bool)
    for side in ("front", "back"):
        px, py = plates.to_px(side, p[:, 0], p[:, 2])
        c = _project.bilinear(plates.img[side], px, py)
        c = c * (1 - ws) + _project.bilinear(soft[side], px, py) * ws
        dep, hid = vis.lookup(side, px, py)
        if side == "front":
            hidden = ~(p[:, 1] <= np.nan_to_num(dep, nan=1e9) + eps)
        else:
            hidden = ~(p[:, 1] >= np.nan_to_num(dep, nan=-1e9) - eps)
        hid_both &= hidden
        for kk in np.unique(k[hidden]):
            f = fills.get((side, int(kk)))
            if f is None:
                continue
            sel = hidden & (k == kk)
            c[sel] = _project.bilinear(f, px[sel] / vis.step, py[sel] / vis.step)
        cols[side] = c
    wb = np.clip((n[:, 1] + 0.25) / 0.5, 0, 1)
    wb = wb * wb * (3 - 2 * wb)
    _HID[0] = hid_both
    return idx, k, p, n, cols, wb


def _band_tone(z, lin, zq, step=0.03):
    """median colour of `lin` (texels at heights z) per `step` band, read at the heights zq (interpolated)"""
    lo, hi = float(z.min()), float(z.max())
    nb = max(1, int(math.ceil((hi - lo) / step)))
    b = np.clip(((z - lo) / step).astype(int), 0, nb - 1)
    cen, med = [], []
    for i in range(nb):
        m = b == i
        if m.sum() >= 12:
            cen.append(lo + (i + 0.5) * step)
            med.append(np.median(lin[m], axis=0))
    if not cen:
        return np.repeat(np.median(lin, axis=0)[None, :], len(zq), 0)
    cen, med = np.array(cen), np.array(med)
    return np.stack([np.interp(zq, cen, med[:, c]) for c in range(3)], 1).astype(np.float32)


def _match_back(k, p, cols, wb, names, log):
    """the back sheet is painted in shade (the robe a dark maroon, the hands near black): per part, each back texel
    takes the FRONT's banded tone at its height times its own value relative to the back's band (BACK_DETAIL of the
    contrast): the back keeps its painted folds in the front's colour"""
    fr, bk = _lin(cols["front"]), _lin(cols["back"])
    for kk in np.unique(k):
        nm = names[kk]
        if nm not in BACK_PARTS:
            continue
        sel = k == kk
        zs = p[sel, 2]
        b = sel & (wb > 0.6) & (_Y(bk) > 0.002)
        if b.sum() < 80:
            continue
        if nm in BACK_TARGET:
            tf = np.repeat(_lin(_hex(BACK_TARGET[nm]))[None, :], int(sel.sum()), 0)
        else:
            f = sel & (wb < 0.25) & (_Y(fr) > 0.008)
            if f.sum() < 80:
                continue
            tf = _band_tone(p[f, 2], fr[f], zs, step=0.04)
        tb = _band_tone(p[b, 2], bk[b], zs, step=0.04)
        r = np.clip(_Y(bk[sel]) / np.maximum(_Y(tb), 1e-4), 0.35, 1.8) ** BACK_DETAIL
        bk[sel] = tf * (r * 0.94)[:, None]
        log(f"  tunlan back match {nm}: front band tones x back detail ({int(b.sum())} texels)")
    cols["back"] = _srgb(bk)


def _side_fill(lin, k, p, n, names, log):
    """edge-on texels (both plates see them badly: streaks) and texels hidden from both plates take the part's own
    painted tone at their height (front and back blended by the normal), broken by soft vertical brush strokes"""
    face = np.abs(n[:, 1])
    hid = _HID[0] if _HID[0] is not None and len(_HID[0]) == len(k) else np.zeros(len(k), dtype=bool)
    strokes = 1 + 0.06 * NOISE.fbm(p * np.array([1.0, 1.0, 0.30]), 9.0, 3) + 0.03 * NOISE(p, 30.0)
    for kk in np.unique(k):
        nm = names[kk]
        if nm not in SIDE_PARTS:
            continue
        sel = k == kk
        f0, f1 = SIDE_FACE_PART.get(nm, SIDE_FACE)
        w = np.maximum(1 - ss(f0, f1, face), hid.astype(np.float32))
        good = sel & (face > 0.78) & ~hid
        if good.sum() < 30:
            continue
        zs = p[sel, 2]
        gf, gb = good & (n[:, 1] < 0), good & (n[:, 1] > 0)
        tf = _band_tone(p[gf, 2], lin[gf], zs) if gf.sum() >= 30 else None
        tb = _band_tone(p[gb, 2], lin[gb], zs) if gb.sum() >= 30 else None
        if tf is None and tb is None:
            continue
        tf = tf if tf is not None else tb
        tb = tb if tb is not None else tf
        wbb = ss(-0.35, 0.35, n[sel, 1])[:, None]
        tone = tf * (1 - wbb) + tb * wbb
        ws_ = w[sel][:, None]
        c = lin[sel] * (1 - ws_) + tone * strokes[sel][:, None] * ws_
        Yc, Yt = _Y(c), np.maximum(_Y(tone), 1e-4)
        cap = np.where(face[sel] < 0.9, Yt * SIDE_HI, 1e9)
        c = c * np.minimum(1.0, cap / np.maximum(Yc, 1e-5))[:, None]
        lin[sel] = c
        log(f"  tunlan side fill {nm}: {100 * float((w[sel] > 0.5).mean()):.0f}% of its texels")
    return lin


# the hat: pale lacquered paper panels (warm cream, toned under L* 86), darker seams, a lit crown, the walnut underside
HAT_HEX = {"top": "#D3C3AE", "seam": "#8E7A68", "crown": "#C9B59C", "under": "#5E4A3C", "rim": "#3A302D",
           "rim_plate": "#4A3F3B", "iron": "#4B4342", "iron_hi": "#6A625E", "legs": "#2E2523"}


def _hat_paint(p, n, hexes=None):
    hx = dict(HAT_HEX, **(hexes or {}))
    r = np.hypot(p[:, 0], p[:, 1])
    th = np.arctan2(p[:, 1], p[:, 0])
    top, seam_c, crown, under = (_lin(_hex(hx[k])) for k in ("top", "seam", "crown", "under"))
    up = ss(-0.10, 0.30, n[:, 2])
    on_top = ss(hat_under(r) + 0.012, hat_under(r) + 0.030, p[:, 2]) * up
    # paper: a mottled lacquer, brush strokes along the panels (radial), a lit front-right and a darker far side
    mott = 1 + 0.045 * _fbm(p * np.array([1.0, 1.0, 0.2]), 11.0) + 0.025 * _fbm(p, 40.0)
    brush = 1 + 0.030 * np.sin(r * 140.0 + 2.5 * NOISE(p, 6.0))
    kk = SEAMS / (2 * math.pi)
    tt = th + math.pi / SEAMS
    dth = (tt * kk - np.round(tt * kk)) / kk
    panel_u = (tt * kk - np.floor(tt * kk))                      # 0..1 across a panel
    shade = 0.93 + 0.10 * np.sin(panel_u * math.pi) + 0.03 * np.cos(np.floor(tt * kk) * 2.1)   # each panel a cupped plane
    lit = 0.90 + 0.16 * ss(-0.3, 0.9, n @ KEY)
    c = top[None, :] * (mott * brush * shade * lit)[:, None]
    # radial seams (painted dark lines, softened) and a darker band near the rim (the lacquer's worn edge)
    sw = np.exp(-((dth * r) / 0.0055) ** 2) * ss(0.20, 0.24, r) * (1 - ss(0.585, 0.60, r))
    c = c * (1 - 0.55 * sw)[:, None] + seam_c[None, :] * (0.55 * sw)[:, None]
    c = c * (1 - 0.12 * ss(0.50, 0.60, r))[:, None]
    # the crown cap: a warmer lacquer, facet edges lighter, the step's shadow line
    cr = 1 - ss(CROWN_A[0] - 0.004, CROWN_A[0] + 0.012, r)
    cc = crown[None, :] * (mott * (0.92 + 0.14 * ss(-0.2, 0.9, n @ KEY)))[:, None]
    oct_edge = np.abs((th - math.radians(22.5)) % (math.pi / 4) - math.pi / 8) < 0.025
    cc = cc * np.where(oct_edge, 1.06, 1.0)[:, None]
    stepl = np.exp(-((p[:, 2] - CROWN_Z[1]) / 0.004) ** 2) * ss(0.5, 0.9, 1 - np.abs(n[:, 2]))
    cc = cc * (1 - 0.35 * stepl)[:, None]
    c = c * (1 - cr[:, None]) + cc * cr[:, None]
    # the glow ring's lip (a thin dark groove round the inlay) and the vent's scorch
    g0, g1 = GLOW_RING
    lip = np.exp(-((r - g0 + 0.003) / 0.003) ** 2) + np.exp(-((r - g1 - 0.003) / 0.003) ** 2)
    c = c * (1 - 0.40 * np.clip(lip, 0, 1))[:, None]
    vd = np.linalg.norm(p[:, :2] - _vent_c()[None, :2], axis=1)
    c = c * (1 - 0.30 * np.exp(-((vd - VENT_R - 0.012) / 0.012) ** 2))[:, None]
    # the underside: walnut ring and battens in shade, lighter toward the rim
    ub = 1 + 0.06 * _fbm(p * np.array([1.0, 1.0, 0.2]), 14.0)
    batt = 1 - 0.18 * np.exp(-((dth * r) / 0.010) ** 2)
    u_ = under[None, :] * (ub * batt * (0.80 + 0.30 * ss(0.15, 0.58, r)))[:, None]
    w = on_top[:, None]
    return c * w + u_ * (1 - w)


def _iron_paint(p, n, hexc=None, plates=False):
    """matte oxidised ironstone: a dark slate base, lighter worn edges facing the key light, mottled"""
    base = _lin(_hex(hexc or HAT_HEX["iron"]))
    hi = _lin(_hex(HAT_HEX["iron_hi"]))
    mott = 1 + 0.10 * _fbm(p, 25.0) + 0.05 * _fbm(p, 70.0)
    lit = ss(0.2, 0.9, n @ KEY)
    c = base[None, :] * mott[:, None]
    c = c * (1 - 0.35 * lit)[:, None] + hi[None, :] * (0.35 * lit)[:, None]
    if plates:                                                 # the rim's plate joints (20 round)
        th = np.arctan2(p[:, 1], p[:, 0])
        k = 20 / (2 * math.pi)
        d = np.abs(th * k - 0.5 - np.round(th * k - 0.5)) / k * 0.636
        c = c * (1 - 0.45 * np.exp(-(d / 0.006) ** 2))[:, None]
    return c


def _rim_paint(p, n):
    c = _iron_paint(p, n, HAT_HEX["rim"], plates=True)
    up = ss(0.3, 0.8, n[:, 2])
    return c * (1 + 0.25 * up)[:, None]


WOOD_HEX = ("#C2AD93", "#8E765F", "#5B4838")   # the carved hand wood: lit, shade, the joint grooves


def _wood_paint(p, n, frame=None):
    """pale carved ash: a warm grain along the segment, lit planes lighter, the joints and carved lines darker"""
    lit_c, sh_c, gr_c = (_lin(_hex(h)) for h in WOOD_HEX)
    g = 1 + 0.07 * NOISE(p * np.array([3.0, 3.0, 0.6]), 30.0) + 0.04 * _fbm(p, 60.0)
    t = ss(-0.35, 0.85, n @ KEY) * 0.75 + 0.25 * ss(-0.2, 0.9, n[:, 2])
    c = (sh_c[None, :] * (1 - t)[:, None] + lit_c[None, :] * t[:, None]) * g[:, None]
    return c


def _legs_paint(p, n):
    base = _lin(_hex(HAT_HEX["legs"]))
    return base[None, :] * (1 + 0.08 * _fbm(p, 30.0) + 0.10 * ss(0.0, 0.9, n @ KEY))[:, None]


def _paint(maps, plates, vis, names, tops=None, flat=None, eps=0.02, bleed=True, log=print):
    if "hat" not in names or "palm_L" not in names:
        return _orig_paint(maps, plates, vis, names, tops=tops, flat=flat, eps=eps, bleed=bleed, log=log)
    P, N, part = maps["P"], maps["N"], maps["part"]
    size = maps["size"]
    out = np.zeros((size, size, 3), dtype=np.float32)
    idx, k, p, n, cols, wb = _proj_sides(maps, plates, vis, names, eps, log)
    _match_back(k, p, cols, wb, names, log)
    col = cols["front"] * (1 - wb[:, None]) + cols["back"] * wb[:, None]
    lin = _lin(col)
    lin = _side_fill(lin, k, p, n, names, log)

    def sel(name):
        if name not in names:
            return None
        m = k == names.index(name)
        return m if m.any() else None

    procs = {"hat": _hat_paint, "hat_rim": _rim_paint, "vent_ring": _iron_paint, "lantern_hook": _iron_paint,
             "lantern_frame": _iron_paint, "legs": _legs_paint}
    for nm in WOOD_PARTS:
        procs[nm] = _wood_paint
    for name, fn in procs.items():
        m = sel(name)
        if m is not None:
            lin[m] = fn(p[m], n[m])
    # the light-head / dark-feet ramp and the highlight cap (not on the lantern: it hangs at its own height)
    body = np.ones(len(k), dtype=bool)
    for name in ("lantern_hook", "lantern_frame"):
        m = sel(name)
        if m is not None:
            body &= ~m
    zz = np.clip(p[:, 2] / HEIGHT, 0, 1)
    g = np.interp(zz, [a for a, _ in VALUE_RAMP], [b for _, b in VALUE_RAMP]).astype(np.float32)
    lin[body] = lin[body] * g[body][:, None]
    lin = _hi_cap(lin)
    out[idx] = _srgb(lin)
    if bleed:
        iy, ix = _project.nearest_index(part >= 0)
        out = out[iy, ix]
        far = np.hypot(iy - np.arange(out.shape[0])[:, None], ix - np.arange(out.shape[1])[None, :]) > 9.0
        smooth = _project.blur(out, 6.0)
        out[far] = smooth[far]
        out = _project.blur(out, 0.45).astype(np.float32)
    return out


_orig_paint = _project.paint
_project.paint = _paint


def _fill_gutters(arr, valid, iters=40):
    a = arr.copy()
    v = valid.astype(np.float32)
    for _ in range(iters):
        if v.min() > 0.5:
            break
        acc = np.zeros_like(a)
        cnt = np.zeros(v.shape, dtype=np.float32)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0:
                    continue
                vs = np.roll(np.roll(v, dy, 0), dx, 1)
                acc += np.roll(np.roll(a, dy, 0), dx, 1) * vs[..., None]
                cnt += vs
        new = (v < 0.5) & (cnt > 0)
        a[new] = acc[new] / cnt[new][:, None]
        v = np.where(new, 1.0, v)
    return a


_orig_bake_asset = _bake.bake_asset


def _bake_asset(low, highs, out_dir, name="body", *a, **k):
    """the ORM's empty gutters (roughness 0: a mirror round every island at the game camera's mips) take their
    island's roughness / AO (Dunsom's fix)"""
    res = _orig_bake_asset(low, highs, out_dir, name, *a, **k)
    path = (res.get("images") or {}).get("orm")
    if not str(name).startswith(ID) or not path:
        return res
    img = bpy.data.images.load(path, check_existing=True)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    valid = px[..., 1] > 0.035
    px[..., :3] = _fill_gutters(px[..., :3], valid)
    img.pixels.foreach_set(px.ravel())
    img.update()
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    return res


_bake.bake_asset = _bake_asset

MOTION = anim.motion_profile(weight="light", weapon="focus", stance="neutral", run_ref_speed=3.35)


if __name__ == "__main__":
    fighter.main(sys.modules[__name__])
