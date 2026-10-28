"""sukri: Rim wanderer (Tender, Hourless). ART 2.0: sculpted volumes painted by concept projection.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/sukri_plates.py      # plates (backdrop cut fix)
    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/sukri_fit.py [--table] [--accent]   # fit check
    python3 art/build.py fighter sukri --no-skins --clip-sheet

Brief: _design/fighters/sukri.md. Concept: _design/concept/sukri.webp (front + back, hand-painted). The forms are
numpy SDF volumes (common/hifi/sdf.py) fitted to the concept on a 10 cm grid (the plates' scale is the hood's crown,
1.65 m); the base colour is the concept painting projected occlusion-aware onto the game mesh (common/hifi/project.py,
wrapped below); normals and AO bake from the sculpt.

Where the concept and the brief disagree the concept's FORMS win (the approved look, as on Marund): a round little
wanderer in a deep ROUND cream hood (0.80 m across; a rounded dome, never a point, a seam down the back), a large
carved wooden face (0.44 x 0.48 m: almond eye slits, a broad nose, an open smile, vertical grain cracks) set 3 cm
behind the hood's rolled edge with the hood's dark lining round it, two tiers of chunky pale stone plates on each
shoulder and three rows across the back, cream wraps over a barrel body, a thick dark sash, skirt panels, dark
bloomers, wrapped shins, big soft boots, dark gloves with sculpted fingers, the pale walking staff in the right hand.
The brief wins on the hook: the CUP of noon light hangs from the crook on a rigid hook (one pendulum bone, x_cup):
clear dawnglass (a thick base, six bevelled ribs, a lip) round a glowing core (the accent: visible between the ribs
and from the game camera through the open ironstone rim band, an accent inlay ring on the rim), at chest height
0.7 m out to his right; a coil of weighted cord at the left hip (Wrap Cast).

Not in the shared pipeline, implemented here (module-level wrappers; common/ untouched):
  * rig_extras: the right arm re-seated on the staff, prop.R up the shaft, prop.L in the left hand, x_cup (the cup's
    pendulum), sockets x_cup / x_cord / x_staff_top.
  * skin weights for the hood, torso, belt, skirt, bloomers, shins, sleeves and boots; the corrected foot roll.
  * the paint (project.paint wrapper): projected cloth / face / plates with side fill; the staff, the cup, the gloves,
    the boots and the hood's lining paint procedurally; light-head / dark-feet ramp and the L* 86 cap.
  * the cup's pendulum (anim.sample_clip wrapper); prop.R location tracks (the staff slides through the fist).
  * skins (project.recolour wrapper): per-part targets; Stillwater's reed plates, Shadeprint's light-rimmed wraps.
"""
from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy  # noqa: E402,F401
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

from common import anim, fighter, materials, rig, scene  # noqa: E402
from common import render as _render  # noqa: E402
from common import bake as _bake, mesh as _mesh, pipeline as _pipeline  # noqa: E402
from common.anim import Aim, FootTarget, HandTarget  # noqa: E402
from common.hifi import project as _project, sdf  # noqa: E402
from common.hifi.sdf import (Capsule, Ellipsoid, FlatCapsule, HalfSpace, Prim, RoundBox,  # noqa: E402
                             RoundCone, Sculpt, Sphere, Torus, Tube)

V = Vector
ID = "sukri"
TITLE = "Rim wanderer"
ROLE_MASS = "tender"
ORIGIN = "hourless"
CARD = {"primary": "#7B7266", "secondary": "#D9CDA8"}


def unit(v):
    v = np.asarray(v, dtype=np.float64)
    return v / np.linalg.norm(v)


def _rot(axis, deg):
    a = unit(axis)
    t = math.radians(deg)
    K = np.array([[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]])
    return np.eye(3) + math.sin(t) * K + (1 - math.cos(t)) * (K @ K)


def ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def smax(a, b, k):
    h = np.clip(0.5 - 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1 - h) + a * h + k * h * (1 - h)


def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1 - h) + a * h - k * h * (1 - h)


# ── rig fitted to the concept (plates: 691 px/m, the hood's crown 1.65) ─────────────────────────────────
# the skull's crown inside the hood 1.56, skull base 1.164 (the big face hangs from it to the chin at 1.04), neck base
# 1.104, shoulders x 0.35 at 0.924 (under the plates), hips x 0.15 at 0.50 (inside the barrel), knees 0.27, ankles
# x 0.195 at 0.085; the left arm hangs at the side (fist ~(0.50, 0.42)), the right is re-seated on the staff
PROPORTIONS = rig.proportions(height=1.56, head=0.46, neck=0.06, shoulder_width=0.70, hip_width=0.30, leg=0.42,
                              thigh_frac=0.55, arm=0.48, upper_arm_frac=0.56, hand=0.20, foot=0.30,
                              ankle_height=0.085, spine_curve=0.0, stance=0.045, toe_out_deg=8.0, knee_bend=0.015,
                              a_pose_deg=68.0, arm_forward_deg=4.0, elbow_bend_deg=18.0, shoulder_drop=0.18)
ARM = PROPORTIONS["arm"]
UPPER = ARM * PROPORTIONS["upper_arm_frac"]
FOREARM = ARM - UPPER
_ZNECK = PROPORTIONS["height"] - PROPORTIONS["head"] * 0.86 - PROPORTIONS["neck"]
SH_L = np.array([PROPORTIONS["shoulder_width"] / 2, 0.030, _ZNECK - PROPORTIONS["shoulder_drop"]])
SH_R = SH_L * np.array([-1.0, 1.0, 1.0])
HS = 1.55                                          # glove scale (brief: hands x1.5; the concept's 15 cm fists)


def _left_arm():
    p = PROPORTIONS
    a, fw = math.radians(p["a_pose_deg"]), math.radians(p["arm_forward_deg"])
    d1 = unit((math.cos(a) * math.cos(fw), -math.cos(a) * math.sin(fw), -math.sin(a)))
    el = SH_L + d1 * UPPER
    front = np.array([0.0, -1.0, 0.0])
    zf = unit(front - d1 * front.dot(d1))
    hinge = unit(np.cross(d1, zf))
    d2 = unit(_rot(hinge, p["elbow_bend_deg"]) @ d1)
    return el, el + d2 * FOREARM, d2


E_L, W_L, FO_L = _left_arm()
# the right fist round the staff at hip height, a little in front (the painting: x -0.52, z 0.78)
GRIP = np.array([-0.562, -0.125, 0.775])
FIST_REACH = 0.075                                 # wrist -> the grip channel along the hand


def _right_arm():
    L1, L2 = UPPER, FOREARM + FIST_REACH
    d = GRIP - SH_R
    dist = float(np.linalg.norm(d))
    a = d / dist
    pole = unit((-0.45, 0.55, -0.70))
    pp = unit(pole - a * pole.dot(a))
    u = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist)
    v = math.sqrt(max(0.0, L1 * L1 - u * u))
    el = SH_R + a * u + pp * v
    fo = unit(GRIP - el)
    return el, el + fo * FOREARM, fo


E_R, W_R, FO_R = _right_arm()

# THE STAFF (prop.R): the butt beside the right boot, the shaft through the fist, the carved crook head bending OUT
# (his right) at 1.47-1.55 m, as painted (the painting's top 1.55: under the hood's crown, under the HP bar)
BUTT = np.array([-0.480, -0.075, 0.0])
STAFF_U = unit(GRIP - BUTT)
S_BUTT = -float(np.linalg.norm(GRIP - BUTT))       # the butt's place along the shaft (m from the grip)
S_TOP = 0.655                                      # where the shaft turns into the crook (z ~1.45)
SHAFT_R = 0.026                                    # 5 cm (brief: 5 cm)
GRIPS = ((-0.10, 0.11),)                           # the leather wrap round the fist
SLIDE_LOW = 0.30                                   # slide that puts the fist 0.30 m further up (the staff lowered)


def staff_at(s):
    return GRIP + STAFF_U * s


def _crook_frame():
    h = np.array([-1.0, 0.0, 0.0])                  # out to his right
    h = unit(h - STAFF_U * h.dot(STAFF_U))
    return h, STAFF_U


# the crook head (out along h, up along the shaft, sideways): the shaft bends out over a carved knuckle into a short
# squared head that turns down at its end, where the cup's hook hangs (as painted: a forked, bent-over top)
CROOK_PTS = [(0.000, -0.060, 0.000), (0.000, 0.000, 0.000), (0.010, 0.046, 0.003), (0.044, 0.072, -0.002),
             (0.082, 0.068, 0.002), (0.106, 0.040, 0.000), (0.110, 0.004, 0.000)]


CROOK_OFF = -0.040                                 # the bent shaft's offset along h at the crook


def crook_pts():
    h, u = _crook_frame()
    side = unit(np.cross(u, h))
    top = staff_at(S_TOP) + h * CROOK_OFF
    return [top + h * a + u * b + side * c for a, b, c in CROOK_PTS]


CROOK_TIP = crook_pts()[-1]
HANG = CROOK_TIP - np.array([0.0, 0.0, 0.030])     # the cup's pivot: the hook's ring round the crook's tip
CROOK_TOP = crook_pts()[3]

# THE CUP (on x_cup, hanging straight down from HANG at rest): heights below HANG
CUP_R = 0.088                                      # the glass body's outer radius (0.176 m across, the painted lid)
CUP_HOOK = (0.0, 0.100)                            # the rigid iron hook rod: HANG -> 10 cm down (brief)
CUP_RIM = (0.200, 0.224)                           # the ironstone rim band (top / bottom below HANG)
CUP_GLASS = (0.224, 0.384)                         # the glass body (top / bottom)
CUP_BASE = 0.356                                   # the thick glass base's top (2.8 cm of glass)
CUP_LIP = 0.020                                    # the glass lip ring under the rim band
CUP_CORE = (0.232, 0.356, CUP_R - 0.010)           # the glowing core: top / bottom below HANG, radius
RIM_OPEN = 0.068                                   # the rim band's open throat (the core seen from above)
RIM_OUT = CUP_R + 0.010
INLAY = (0.074, 0.091)                             # the accent inlay ring on the rim band's top (brief: 2 cm)
N_RIBS = 8
RIB_W = 0.0100                                     # the glass ribs' half width (bevelled glass between the core's windows)


def cup_z(dz):
    return HANG[2] - dz


CUP_C = np.array([HANG[0], HANG[1]])

MATERIAL_SET = "bible"
PALETTE = materials.bible_palette(cloth2="#D3CCBA", wood="#D1C3A4", stone="#B9B4A6", dawnglass="#BDD2E0",
                                  cloth="#B8AF9C", leather="#453D35", under="#372F2B", ironstone="#4A4540",
                                  ink="#17161A", accent="#3F9CFF", glove="#5A5149", rope="#7A6650")
VALUE_GRADIENT_STOPS = materials.BIBLE_GRADIENT_STOPS
SOCKETS = {"weapon": "prop.R", "cup": "x_cup", "cord": "x_cord", "staff_top": "x_staff_top"}
# (build 9: the bible key at 45 degrees threw the stone plates' zig-zag shadows across the round cream wraps: camo
# blotches in the splash; a lower key (32 degrees) and more sky fill keep the wraps reading as painted)
SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92, "fill": 0.84, "yaw": 22.0, "portrait_clip": "idle_lobby",
          "portrait_t": 0.0, "portrait_yaw": 28.0, "icon_yaw": 20.0, "rim_cool": 0.5, "rim_warm": 0.5,
          "key_el": 30.0, "ambient": 0.85, "sun": 2.7}
TEXTURE_SIZE = 2048
TEXTURE_SIZES = {"normal": 512, "orm": 512}
GLB_COMPRESS = True
ARMOUR_CONFORM = False
AO_INTO_BASE = 0.25
ATLAS_SOFTEN = 0.45

# ART 2.0 skins (brief §9): each part moves onto the skin's colours (_recolour below, the painting's values kept)
SKINS: list = [
    {"id": "sukri_stillwater", "extra": {"reed_plates": True}, "card": {"primary": "#59666A", "secondary": "#8FB3A8"},
     "palette": {"cloth": "#59666A", "dawnglass": "#8FB3A8", "stone": "#C0BCB0", "cloth2": "#D6D1C2", "reed": "#A6AC8E"}},
    {"id": "sukri_shadeprint", "extra": {"light_rims": True}, "card": {"primary": "#2B2A33", "secondary": "#B7B4BE"},
     "palette": {"cloth2": "#B7B4BE", "cloth": "#2B2A33", "stone": "#C0BDC8", "wood": "#C8BFB0", "dawnglass": "#C5CFE0",
                 "rim": "#C6C3CE"}},
]
SKIN_FLAT = {"reed_plates": "reed"}

HEIGHT = 1.65             # the plates' scale: the hood's crown
PROJECTION = {"concept": "sukri", "height": HEIGHT}
NOISE = sdf.Noise(31)
VOXEL = 0.0060


# ── sculpt helpers ──────────────────────────────────────────────────────────────────────────────────
class Fn(Prim):
    """An SDF from a function of world points (bounds given)."""

    def __init__(self, fn, lo, hi):
        self.fn, self.lo, self.hi = fn, np.asarray(lo, float), np.asarray(hi, float)

    def bounds(self):
        return self.lo, self.hi

    def d(self, P):
        return self.fn(P)


def cloth_noise(amp, freq=7.0):
    def fn(P):
        return amp * NOISE(P, freq)
    return fn


def chips(amp, freq):
    def fn(P):
        return amp * np.clip(NOISE.ridged(P, freq, 3), 0, 1) - amp * 0.3
    return fn


def wraps(amp, pitch, a, b, slant=1.0):
    """A strip wound round the a->b axis: a ridge every `pitch` m, slanted."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    u = unit(b - a)
    ref = unit(np.cross(u, (0.0, 0.0, 1.0)) if abs(u[2]) < 0.9 else np.cross(u, (1.0, 0.0, 0.0)))
    ref2 = np.cross(u, ref)

    def fn(P):
        q = P - a
        s = q @ u
        th = np.arctan2(q @ ref2, q @ ref)
        ph = (s / pitch + slant * th / (2 * math.pi) + 0.25 * NOISE(P, 6.0)) % 1.0
        return -amp * (ss(0.0, 0.16, ph) - ss(0.72, 1.0, ph)) + amp * 0.5
    return fn


# ── the painted relief (proto/sukri_relief.py): the concept's brushwork as a small displacement, so the sculpted
# wrap bands, folds and cracks line up with the projected paint ─────────────────────────────────────────────
_RELIEF: dict = {}


def _relief():
    if not _RELIEF:
        p = os.path.join(scene.CACHE_DIR, "concept", "sukri_relief.npz")
        if not os.path.isfile(p):
            raise SystemExit("sukri: run art/blender/proto/sukri_relief.py first (art/.cache/concept/sukri_relief.npz)")
        d = np.load(p)
        _RELIEF.update({k: np.asarray(d[k]) for k in d.files})
    return _RELIEF


def _relief_at(side, x, z):
    R = _relief()
    A = R[side]
    m = float(R["m"])
    u = np.clip((np.asarray(x, float) - float(R["x0"])) / m, 0, A.shape[1] - 1.001)
    v = np.clip((float(R["z0"]) - np.asarray(z, float)) / m, 0, A.shape[0] - 1.001)
    i0, j0 = u.astype(np.int64), v.astype(np.int64)
    fu, fv = u - i0, v - j0
    a = A[j0, i0] * (1 - fu) + A[j0, i0 + 1] * fu
    b = A[j0 + 1, i0] * (1 - fu) + A[j0 + 1, i0 + 1] * fu
    return a * (1 - fv) + b * fv


RELIEF_GROOVE, RELIEF_BULGE = 0.0042, 0.0030


def painted(gain=1.0, yc=0.02, depth=0.30, extra=None):
    """displacement fn (SDF units: + carves in) from the painted relief: the front map on the front half, the back map
    on the back half (y about yc), fading to nothing where the two meet at the sides"""
    def fn(P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        dy = y - yc
        wf = ss(0.12 * depth, -0.12 * depth, dy)
        fade = ss(0.08 * depth, 0.40 * depth, np.abs(dy))
        r = _relief_at("front", x, z) * wf + _relief_at("back", x, z) * (1 - wf)
        r = np.clip(r, -RELIEF_GROOVE, RELIEF_BULGE)           # (build 7: the 8 mm grooves shaded as camo blotches
        out = -gain * r * fade                                 #  under the splash's grazing light)
        return out + (extra(P) if extra is not None else 0.0)
    return fn


# ── the face (the painted carved wooden face, measured on the concept's 2 cm grid) ─────────────────────────
FACE_C = (0.0, 1.282)                    # the outline's centre (x, z)
FACE_AX = (0.221, 0.240)                 # half width / half height
EYES = ((-0.121, 1.333), (0.117, 1.333))
EYE_W, EYE_H = 0.062, 0.023              # almond half width / half height
MOUTH = (1.166, 1.130, 0.116)            # the smile: top line at x 0, the lower arc's bottom, half width
NOSE = (1.392, 1.226)                    # bridge top, tip
GRAIN = ((-0.125, 1.50, 1.36), (-0.098, 1.50, 1.40), (0.100, 1.48, 1.37), (0.118, 1.47, 1.40),
         (-0.062, 1.30, 1.18), (-0.172, 1.29, 1.10), (0.064, 1.30, 1.20), (0.170, 1.27, 1.12),
         (-0.110, 1.12, 1.07), (0.110, 1.11, 1.06))          # painted vertical cracks: (x, z top, z bottom)


def face_sd(x, z):
    """the face outline (m, < 0 inside): a rounded egg, the flatter crown at 1.52, the rounder chin at 1.04"""
    u = (np.asarray(x, float) - FACE_C[0]) / FACE_AX[0]
    zz = np.asarray(z, float) - FACE_C[1]
    v = zz / FACE_AX[1]
    # narrower toward the chin (the painted face is +-0.20 at 1.17, +-0.16 at 1.10) and a flatter, broad crown
    u = u * (1.0 + 0.10 * ss(0.0, -1.0, v))
    e = np.where(v > 0, 2.7, 2.3)
    r = (np.abs(u) ** e + np.abs(v) ** e) ** (1.0 / e)
    return (r - 1.0) * min(FACE_AX)


def face_front(x, z):
    """the face's front surface (y) before relief: a broad shield curved back to the sides, top and chin"""
    return -0.258 + 1.05 * np.asarray(x) ** 2 + 0.80 * (np.asarray(z) - 1.30) ** 2


def _almond(x, z, cx, cz, w, h):
    R = (w * w + h * h) / (2 * h)
    d1 = np.hypot(x - cx, z - (cz + h - R)) - R
    d2 = np.hypot(x - cx, z - (cz - h + R)) - R
    return np.maximum(d1, d2)


def eye_sd(x, z):
    d = np.full(np.shape(x), 1e3)
    for i, (ex, ez) in enumerate(EYES):
        # the outer corners lift a little (the painted almonds)
        sx = -1.0 if ex < 0 else 1.0
        zz = z - 0.10 * (x - ex) * sx
        d = np.minimum(d, _almond(x, zz, ex, ez, EYE_W, EYE_H))
    return d


def mouth_sd(x, z):
    top, bot, hw = MOUTH
    zt = top + 0.75 * x ** 2
    zb = bot + 2.9 * x ** 2
    return np.maximum(np.maximum(z - zt, zb - z), np.abs(x) - hw)


def grain_sd(x, z):
    d = np.full(np.shape(x), 1e3)
    for gx, z0, z1 in GRAIN:
        wob = 0.004 * np.sin(z * 60.0 + gx * 40.0)
        dd = np.maximum(np.abs(x - gx - wob) - 0.0028, np.maximum(z - z0, z1 - z))
        d = np.minimum(d, dd)
    return d


def face_relief(P):
    """forward relief (m) on the face: almond eye slits cut deep, the open smile cut in, the vertical grain cracks
    cut shallow, soft cheeks, a brow ridge over the eyes"""
    x, z = P[:, 0], P[:, 2]
    eye = 1 - ss(-0.003, 0.004, eye_sd(x, z))
    mouth = 1 - ss(-0.003, 0.004, mouth_sd(x, z))
    crack = 1 - ss(0.0, 0.0025, grain_sd(x, z))
    r = -0.026 * eye - 0.022 * mouth - 0.0035 * crack
    brow = ss(1.352, 1.366, z) * ss(1.420, 1.380, z) * (1 - ss(0.17, 0.20, np.abs(x)))
    cheek = np.exp(-(((np.abs(x) - 0.12) / 0.07) ** 2 + ((z - 1.22) / 0.07) ** 2))
    return r + 0.005 * brow + 0.006 * cheek + 0.0010 * NOISE(P * np.array([4.0, 1.0, 0.6]), 30.0)


def finger_pts(C, a, f, out, i, s=HS, curl=1.0):
    """finger i (0 pinky .. 3 index) of a curled hand: knuckle K, middle joint M, tip T, radius. curl 1 = a fist
    round a shaft at C, 0.55 = a relaxed hand"""
    o = 1.0 - curl
    sp = (i - 1.5) * 0.0245 * s
    rr = (0.0110 if i else 0.0099) * s ** 0.85
    K = C + f * 0.006 * s + out * 0.026 * s + a * sp
    M = C + f * (0.040 + 0.016 * o) * s + out * (0.004 + 0.020 * o) * s + a * sp
    T = C + f * (0.026 + 0.050 * o) * s - out * (0.026 - 0.040 * o) * s + a * sp
    return K, M, T, rr


def fist_frame(C, a, f, out):
    C, a, f, out = (np.asarray(v, float) for v in (C, a, f, out))
    a = unit(a)
    f = unit(f - a * f.dot(a))
    out = unit(out - a * out.dot(a) - f * out.dot(f))
    return C, a, f, out


def glove(name, C, a, f, out, bind, tris, curl=1.0, grip=True, s=HS, relaxed=False):
    """A gloved hand with sculpted fingers (no mitten block): C the centre of the fingers' curl (the shaft's axis for
    a grip), a the knuckle line (pinky -> index), f the forearm direction, out the back of the hand"""
    C, a, f, out = fist_frame(C, a, f, out)
    S = Sculpt(name)
    ax = np.stack([a, f, out])
    fs = 1.10 if relaxed else 1.0
    S.add(RoundBox(C - f * 0.033 * s + out * 0.010 * s, (0.046 * s, 0.042 * s, 0.022 * s), 0.016 * s, axes=ax), k=0.0)
    S.add(Ellipsoid(C - f * 0.035 * s + out * 0.024 * s, (0.042 * s, 0.040 * s, 0.012 * s), axes=ax), k=0.012)
    for i in range(4):
        K, M, T, rr = finger_pts(C, a, f, out, i, s, curl)
        if relaxed:
            spread = a * ((i - 1.5) * 0.0030 * s)
            K, M, T, rr = K + spread * 0.5, M + spread, T + spread * 1.4, rr * fs
        S.add(Sphere(K + out * 0.007 * s, rr + 0.0045), k=0.004)
        S.add(Tube([K, M, T], [rr + 0.0010, rr + 0.0004, rr * 0.86], k=0.003), k=0.003)
        S.add(Sphere(M + unit(M - C) * 0.004, rr + 0.0012), k=0.003)
    o = 1.0 - curl
    tb = C - f * 0.034 * s - out * 0.018 * s + a * 0.046 * s
    tm = C + f * 0.006 * s - out * (0.034 - 0.006 * o) * s + a * (0.050 + 0.004 * o) * s
    tt = C + f * (0.040 + 0.010 * o) * s - out * (0.016 + 0.004 * o) * s + a * (0.034 + 0.010 * o) * s
    S.add(Tube([tb, tm, tt], [0.0155 * s * fs, 0.0132 * s * fs, 0.0108 * s * fs], k=0.004), k=0.008)
    S.add(Sphere(tm, 0.0138 * s * fs), k=0.004)
    S.add(FlatCapsule(C - f * 0.110 * s, C - f * 0.050 * s, 0.036 * s, 0.026 * s, 0.041 * s, 0.028 * s, side=a), k=0.016)
    if grip:
        S.sub(Capsule(C - a * 0.15, C + a * 0.15, SHAFT_R + 0.004), k=0.003)
    S.ops = [(op, prim.displaced(cloth_noise(0.0006, 60.0), 0.0006) if op == "add" else prim, k, tg) for op, prim, k, tg in S.ops]
    return (name, S, 0.45, "glove", bind, tris, 2.0)


HAND_R_FRAME = fist_frame(GRIP, STAFF_U, FO_R, np.cross(FO_R, STAFF_U))
C_L = W_L + FO_L * 0.072 * HS / 1.35 + np.array([0.0, -0.004, 0.0])
# the hanging left hand: a loose fist, the back of the hand out to his left-front (as painted: the knuckles read from
# the front)
HAND_L_FRAME = fist_frame(C_L, (-0.50, -0.866, 0.0), FO_L, (0.866, -0.50, 0.0))
LEFT_CURL = 1.0                                    # a loose fist (as painted)


# ── the hood (a lofted super-ellipse dome, a rounded crown: never a point) ─────────────────────────────────
# (build 2: a taller round dome from 1.40 (the build-1 dome from 1.50 read as a flat-topped bucket from the side) and a
# back that slopes out to the cowl: the hood hangs from the crown, it is not a column)
HZ = np.array([0.94, 0.98, 1.03, 1.08, 1.14, 1.20, 1.26, 1.32, 1.40])
HX = np.array([0.415, 0.425, 0.420, 0.405, 0.398, 0.388, 0.362, 0.343, 0.312])
HY = np.array([0.335, 0.335, 0.328, 0.318, 0.308, 0.298, 0.287, 0.276, 0.262])
HYC = np.array([0.045, 0.040, 0.032, 0.022, 0.012, 0.003, -0.005, -0.012, -0.020])
DOME_Z0, DOME_H = 1.40, 0.250          # the crown: a round dome over the 1.40 section (hood top 1.650)
HOOD_E = 2.5


def hood_sec(z):
    """(half width, half depth, depth centre) of the hood's outer section at height z"""
    z = np.asarray(z, float)
    hx, hy, yc = np.interp(z, HZ, HX), np.interp(z, HZ, HY), np.interp(z, HZ, HYC)
    u = np.clip((z - DOME_Z0) / DOME_H, 0.0, 1.0)
    k = np.sqrt(np.clip(1 - u ** 2.1, 0.0, 1.0))
    return hx * np.where(z > DOME_Z0, k, 1.0), hy * np.where(z > DOME_Z0, k, 1.0), yc


def hood_outer(P):
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    hx, hy, yc = hood_sec(np.minimum(z, DOME_Z0 + DOME_H - 1e-4))
    hx, hy = np.maximum(hx, 1e-3), np.maximum(hy, 1e-3)
    r = (np.abs(x / hx) ** HOOD_E + np.abs((y - yc) / hy) ** HOOD_E) ** (1.0 / HOOD_E)
    d = (r - 1.0) * np.minimum(np.minimum(hx, hy), 0.30)
    zbot = HZ[0] + 0.075 * ss(0.14, 0.30, np.abs(x)) * (1 - ss(0.0, 0.20, y))     # the plates show under the sides
    return np.maximum(d, np.maximum(zbot - z, z - (DOME_Z0 + DOME_H)))


# the face opening: the face outline at the top, widening below the cheeks into the dark lining (+-0.29 at 1.06) and
# down under the chin to 0.99 (the painted dark band between the chin and the collar)
OPEN_Z = np.array([0.985, 1.00, 1.03, 1.06, 1.10, 1.16, 1.22, 1.28, 1.34, 1.40, 1.45, 1.49, 1.515, 1.535])
OPEN_W = np.array([0.150, 0.215, 0.268, 0.288, 0.290, 0.283, 0.268, 0.248, 0.236, 0.215, 0.188, 0.150, 0.100, 0.020])


def open_sd(x, z):
    w = np.interp(z, OPEN_Z, OPEN_W)
    return np.maximum(np.abs(x) - w, np.maximum(OPEN_Z[0] - z, z - OPEN_Z[-1]))


def open_pt(t):
    """a point on the opening's outline: t 0 = bottom centre, running up his right side to the top (t 1) (x, z)"""
    zs = np.linspace(OPEN_Z[0], OPEN_Z[-1], 200)
    ws = np.interp(zs, OPEN_Z, OPEN_W)
    L = np.concatenate([[0.0], np.cumsum(np.hypot(np.diff(ws), np.diff(zs)))])
    s = t * L[-1]
    return float(np.interp(s, L, ws)), float(np.interp(s, L, zs))


def rim_y(x, z):
    """the rolled rim's front (y) round the opening: the hood's front drawn forward over the face"""
    return -0.300 + 0.55 * np.asarray(x) ** 2 + 0.25 * np.clip(1.30 - np.asarray(z), 0, None) ** 2


# ── the sculpt ──────────────────────────────────────────────────────────────────────────────────────
def sculpts() -> list:
    """(name, Sculpt, voxel scale, material role, bind, tris, uv weight) in build order."""
    out = []

    def part(name, S, role, bind, tris, vs=1.0, uvw=1.0):
        out.append((name, S, vs, role, bind, tris, uvw))

    # HOOD: the deep round cream hood (one rigid shell above the chin, blending to the neck and chest below), its
    # rolled edge drawn forward round the face, the dark lining recessed behind the face, a soft back seam, the cowl
    # falling over the upper back plates
    hood = Sculpt("hood")
    lo, hi = (-0.46, -0.40, 0.92), (0.46, 0.40, 1.66)
    hood.add(Fn(hood_outer, lo, hi).displaced(painted(0.6, 0.0, 0.30, cloth_noise(0.0025, 6.0)), 0.0075), k=0.0)
    # the brim: the front drawn forward round the opening (the rim's front at rim_y)
    def brim(P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        od = open_sd(x, z)
        shell = np.maximum(od - 0.075, np.maximum(rim_y(x, z) - y, y - 0.05))
        return np.maximum(shell, np.maximum(0.975 - z, z - 1.555))
    hood.add(Fn(brim, (-0.40, -0.36, 0.95), (0.40, 0.10, 1.58)), k=0.05)
    # the cowl over the back plates and round the shoulders (the painted collar drape)
    hood.add(Ellipsoid((0.0, 0.17, 1.035), (0.40, 0.20, 0.072)), k=0.05)            # the cowl over the back plates
    hood.add(Ellipsoid((0.0, 0.21, 1.005), (0.30, 0.16, 0.06)), k=0.04)

    def recess(P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        return np.maximum(open_sd(x, z), y + 0.115)
    hood.sub(Fn(recess, (-0.32, -0.50, 0.96), (0.32, -0.08, 1.56)), k=0.012)

    def rim(P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        od = open_sd(x, z) - 0.020
        return np.maximum(np.hypot(od, (y - rim_y(x, z) - 0.012) * 1.1) - 0.024, 0.975 - z)
    hood.add(Fn(rim, (-0.36, -0.36, 0.95), (0.36, -0.10, 1.60)), k=0.012)
    # soft back seam down the hood's centre line (the brief's facing cue from above) and two long folds
    def seam(P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        hx, hy, yc = hood_sec(np.minimum(z, 1.649))
        yb = yc + hy
        return np.maximum(np.hypot(x, (y - yb) * 1.0) - 0.0055, np.maximum(1.10 - z, z - 1.645))
    hood.sub(Fn(seam, (-0.03, 0.10, 1.08), (0.03, 0.40, 1.66)), k=0.006)
    for sx in (-1, 1):
        pts = []
        for z in (1.50, 1.35, 1.20, 1.07):
            hx, hy, yc = hood_sec(z)
            a = math.radians(48.0)
            r = 1.0 / ((abs(math.sin(a)) ** HOOD_E + abs(math.cos(a)) ** HOOD_E) ** (1 / HOOD_E))
            pts.append((sx * float(hx) * math.sin(a) * r * 0.985, float(yc) + float(hy) * math.cos(a) * r * 0.985, z))
        hood.add(Tube(pts, [0.006, 0.010, 0.012, 0.010], k=0.01), k=0.03)
    part("hood", hood, "cloth2", ("weights", "hood"), 2050, uvw=1.3)

    # FACE: the big carved wooden face in the opening, 3 cm behind the rim; the painted features carved
    def face_d(P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        sd2 = face_sd(x, z)
        yf = face_front(x, z) - face_relief(P)
        d = smax(sd2, (yf - y) * 0.9, 0.010)
        return np.maximum(d, y + 0.135)
    face = Sculpt("face")
    face.add(Fn(face_d, (-0.24, -0.30, 1.02), (0.24, -0.12, 1.54)), k=0.0)
    # the nose: a narrow bridge widening to a broad bulb with nostril wings (as painted)
    yb = float(face_front(0.0, NOSE[0]))
    yt = float(face_front(0.0, NOSE[1]))
    face.add(RoundCone((0.0, yb + 0.002, NOSE[0]), (0.0, yt - 0.030, NOSE[1] + 0.012), 0.014, 0.024), k=0.018)
    face.add(Sphere((0.0, yt - 0.028, NOSE[1] + 0.004), 0.025), k=0.012)
    for sx in (-1, 1):
        face.add(Sphere((sx * 0.034, yt - 0.012, NOSE[1] - 0.002), 0.019), k=0.012)
        face.sub(Ellipsoid((sx * 0.020, yt - 0.026, NOSE[1] - 0.016), (0.009, 0.010, 0.006)), k=0.004)
    part("face", face, "wood", "bone:head", 1650, 0.5, uvw=3.0)

    # TORSO: the barrel under the wraps (widest at 0.55 m), the shoulders' mass under the plates
    torso = Sculpt("torso")
    torso.add(Ellipsoid((0.0, 0.020, 0.640), (0.440, 0.320, 0.385)), k=0.0)
    torso.add(Ellipsoid((0.0, 0.030, 0.860), (0.370, 0.290, 0.190)), k=0.08)
    for sx in (-1, 1):
        torso.add(Ellipsoid((sx * 0.300, 0.030, 0.870), (0.170, 0.200, 0.130)), k=0.07)
    torso.add(Ellipsoid((0.0, 0.040, 1.000), (0.200, 0.180, 0.080)), k=0.05)          # the neck under the collar
    torso.inter(HalfSpace((0, 0, 0.455), (0, 0, -1), 2.0), k=0.01)
    torso.ops = [(op, prim.displaced(painted(0.8, 0.02, 0.32, cloth_noise(0.0012, 9.0)), 0.0095) if op == "add" else prim, k, tg)
                 for op, prim, k, tg in torso.ops]
    part("torso", torso, "cloth", ("weights", "torso"), 1750, uvw=1.1)

    # BELT: the thick dark sash (7.5 cm) round the waist and a thin strap over it, a knot of torn ends at the front
    BY = 0.75

    def belt_d(P):
        x, y, z = P[:, 0], (P[:, 1] - 0.020) / BY, P[:, 2]
        r = np.hypot(x, y)
        q0 = np.abs(r - 0.444) - 0.016
        q1 = np.abs(z - 0.509) - 0.037
        d = np.hypot(np.maximum(q0, 0), np.maximum(q1, 0)) + np.minimum(np.maximum(q0, q1), 0) - 0.004
        q2 = np.abs(r - 0.438) - 0.009
        q3 = np.abs(z - 0.556) - 0.008
        d2 = np.hypot(np.maximum(q2, 0), np.maximum(q3, 0)) + np.minimum(np.maximum(q2, q3), 0) - 0.002
        return np.minimum(d, d2) * BY
    belt = Sculpt("belt")
    belt.add(Fn(belt_d, (-0.48, -0.34, 0.46), (0.48, 0.38, 0.57)).displaced(wraps(0.0030, 0.030, (0, 0.02, 0.45), (0, 0.02, 0.57), 0.4), 0.003), k=0.0)
    part("belt", belt, "leather", ("weights", "belt"), 620, 0.6)

    # SKIRT: panels under the sash: a long rounded front apron, side flaps, two back panels (slits between)
    def skirt_d(P):
        x, y, z = P[:, 0], P[:, 1] - 0.020, P[:, 2]
        k_ = ss(0.50, 0.28, z)
        ax, ay = 0.440 + 0.012 * k_, 0.325 + 0.012 * k_
        r = np.hypot(x / ax, y / ay)
        shell = np.abs(r - 1.0) * np.minimum(ax, ay) - 0.012
        th = np.arctan2(x, -y)                                   # 0 = front, + = his left
        ath = np.abs(th)
        zb = np.where(ath < 0.40, 0.272 + 0.10 * (ath / 0.40) ** 3, np.where(ath < 2.4, 0.318, 0.336))
        zb = zb + 0.012 * np.sin(th * 5.0)
        d = np.maximum(shell, np.maximum(zb - z, z - 0.50))
        # the slits between the panels (front apron | side flaps | back)
        sl = np.full(len(P), 1e3)
        for a0 in (0.42, 1.30, 2.30):
            for sg in (-1, 1):
                sl = np.minimum(sl, np.abs(th - sg * a0) * r * np.minimum(ax, ay) - 0.004)
        sl = np.maximum(sl, z - 0.44)
        return np.maximum(d, -sl)
    skirt = Sculpt("skirt")
    skirt.add(Fn(skirt_d, (-0.48, -0.38, 0.24), (0.48, 0.38, 0.51)).displaced(painted(0.7, 0.02, 0.33, cloth_noise(0.0015, 10.0)), 0.009), k=0.0)
    part("skirt", skirt, "cloth", ("weights", "skirt"), 820, 0.8)

    # BLOOMERS: the dark round trousers under the skirt (0.30 m wide per leg at the knee)
    pants = Sculpt("pants")
    for sx in (-1, 1):
        pants.add(FlatCapsule((sx * 0.160, 0.030, 0.430), (sx * 0.192, 0.020, 0.265), 0.150, 0.150, 0.150, 0.140,
                              side=(1, 0, 0)), k=0.0)
        pants.add(Ellipsoid((sx * 0.195, 0.015, 0.262), (0.150, 0.140, 0.075)), k=0.04)
    pants.add(Ellipsoid((0.0, 0.10, 0.36), (0.30, 0.22, 0.12)), k=0.06)                # the round seat
    pants.inter(HalfSpace((0, 0, 0.185), (0, 0, -1), 2.0), k=0.012)
    pants.ops = [(op, prim.displaced(painted(0.8, 0.03, 0.17, cloth_noise(0.003, 8.0)), 0.0095) if op == "add" else prim, k, tg)
                 for op, prim, k, tg in pants.ops]
    part("pants", pants, "under", ("weights", "pants"), 750)

    # SHINS: thick bandage wraps from the bloomers to the boots
    shins = Sculpt("shins")
    for sx in (-1, 1):
        a_, b_ = (sx * 0.195, 0.020, 0.250), (sx * 0.195, 0.020, 0.075)
        shins.add(FlatCapsule(a_, b_, 0.108, 0.104, 0.100, 0.098, side=(1, 0, 0)).displaced(
            painted(1.2, 0.02, 0.10, wraps(0.0020, 0.034, b_, a_, 1.6)), 0.012), k=0.0)
    shins.inter(HalfSpace((0, 0, 0.060), (0, 0, -1), 2.0), k=0.004)      # (inside the boots, never under the ground)
    part("shins", shins, "cloth2", ("weights", "shins"), 750, 0.8)

    # BOOTS: soft wide dark leather boots with rounded toes (8 degrees out)
    boots = Sculpt("boots")
    for sx in (-1, 1):
        to = math.radians(8.0) * sx
        fwd = np.array([math.sin(to), -math.cos(to), 0.0])
        a0 = np.array([sx * 0.200, 0.020, 0.0])
        R = sdf.rot_z(-math.degrees(to))
        boots.add(RoundBox(a0 + fwd * 0.050 + np.array([0, 0, 0.052]), (0.118, 0.150, 0.052), 0.045, axes=R), k=0.0)
        boots.add(Ellipsoid(a0 + fwd * 0.150 + np.array([0, 0, 0.050]), (0.115, 0.075, 0.058), axes=R), k=0.04)
        boots.add(FlatCapsule(a0 + np.array([0, 0, 0.06]), a0 + np.array([0, 0, 0.115]), 0.112, 0.108, 0.106, 0.104,
                              side=(1, 0, 0)), k=0.04)
        boots.add(Torus(a0 + np.array([0, 0, 0.112]), 0.104, 0.012), k=0.01)
    boots.inter(HalfSpace((0, 0, 0.0), (0, 0, -1), 2.0), k=0.0)
    boots.ops = [(op, prim.displaced(cloth_noise(0.0025, 12.0), 0.0025) if op == "add" else prim, k, tg)
                 for op, prim, k, tg in boots.ops]
    part("boots", boots, "leather", ("weights", "boots"), 850)

    # SLEEVES (cream wraps over the upper arms), BRACERS (dark leather wraps over the forearms), GLOVES
    for s, sh, el, wr, fo in (("L", SH_L, E_L, W_L, FO_L), ("R", SH_R, E_R, W_R, FO_R)):
        sx = 1.0 if s == "L" else -1.0
        sl = Sculpt(f"sleeve_{s}")
        top_ = sh + np.array([sx * 0.006, 0.0, 0.010])
        sl.add(FlatCapsule(top_, el, 0.105, 0.100, 0.090, 0.088, side=(0, 1, 0)).displaced(
            painted(1.0, float(sh[1]), 0.10, wraps(0.0020, 0.036, top_, el, 1.3)), 0.011), k=0.0)
        part(f"sleeve_{s}", sl, "cloth", ("weights", "sleeves"), 620)
        br = Sculpt(f"bracer_{s}")
        a_, b_ = el + fo * 0.010, wr - fo * 0.005
        br.add(FlatCapsule(a_, b_, 0.086, 0.082, 0.072, 0.070, side=(0, 1, 0)).displaced(wraps(0.0045, 0.030, a_, b_, 1.8), 0.0045), k=0.0)
        br.add(Torus(b_ - fo * 0.006, 0.070, 0.008, axes=sdf.frame(fo)), k=0.006)
        part(f"bracer_{s}", br, "leather", f"bone:forearm.{s}", 520, 0.7)
    out.append(glove("hand_R", *HAND_R_FRAME, "bone:hand.R", 780, curl=1.0, grip=True))
    out.append(glove("hand_L", *HAND_L_FRAME, "bone:hand.L", 720, curl=LEFT_CURL, grip=False, relaxed=False))

    # STONE PLATES: two tiers on each shoulder, three rows across the upper back (chunky chipped slabs, shingled)
    for s in ("L", "R"):
        out.append(plates_part(f"plates_{s}", SHOULDER_PLATES, 1.0 if s == "L" else -1.0, f"bone:shoulder.{s}", 700))
    out.append(plates_part("plates_back", BACK_PLATES, 1.0, "bone:chest", 800))

    # THE CORD: a coil of weighted cord at the left hip, on the sash (Wrap Cast leaves from here)
    cord = Sculpt("cord")
    cc = CORD_C
    n = CORD_N
    fr = sdf.frame(n, (0.0, 0.0, 1.0))
    for i, (r_, sh_) in enumerate(((0.058, 0.000), (0.052, 0.011), (0.060, 0.020), (0.054, 0.029))):
        loop = Torus(cc + n * sh_ + np.array([0.0, 0.0, -0.004 * i]), r_, 0.0105, axes=fr, rz=0.0095)
        cord.add(loop.displaced(lambda P, j=i: 0.0016 * np.sin(np.arctan2(P[:, 2] - cc[2], (P - cc) @ unit(np.cross(n, (0, 0, 1.0)))) * 16.0 + j), 0.0016), k=0.003)
    tail0 = cc + n * 0.020 + np.array([0.0, 0.0, -0.058])
    cord.add(Tube([tail0, tail0 + np.array([0.004, -0.006, -0.040]), tail0 + np.array([0.0, -0.004, -0.075])], [0.009, 0.0085, 0.008], k=0.004), k=0.004)
    cord.add(Sphere(tail0 + np.array([0.0, -0.004, -0.098]), 0.021), k=0.004)        # the weight
    cord.add(Capsule(cc + n * 0.004 + np.array([0.0, 0.0, 0.050]), cc + n * 0.004 + np.array([0.0, 0.0, 0.085]), 0.009), k=0.006)   # tied to the sash
    part("cord", cord, "rope", "bone:hips", 430, 0.5)

    out.extend(staff_parts())
    out.extend(cup_parts())
    return out


CORD_C = np.array([0.452, 0.080, 0.468])               # the coil hangs at the left hip, behind the hanging arm
CORD_N = unit(np.array([0.93, 0.36, 0.0]))

# plates (build 3: big chipped stone shingles placed where the concept paints them (front view x, z), each found on the
# torso's surface in front / behind and lifted along its own normal; build 2's azimuth placement hugged the narrow upper
# chest and read as small tiles round the collar): (x, z, front|back, width, height, normal, lift, roll deg)
SHOULDER_PLATES = [
    (0.270, 0.952, "f", 0.215, 0.150, (0.20, -0.62, 0.76), 0.034, -6.0),
    (0.440, 0.938, "f", 0.195, 0.150, (0.62, -0.40, 0.68), 0.030, -14.0),
    (0.360, 0.848, "f", 0.195, 0.125, (0.40, -0.78, 0.48), 0.012, -8.0),
    (0.510, 0.832, "f", 0.145, 0.135, (0.86, -0.32, 0.40), 0.004, -12.0),
    (0.450, 0.932, "b", 0.185, 0.150, (0.62, 0.42, 0.66), 0.030, 12.0),
    (0.505, 0.832, "b", 0.150, 0.130, (0.86, 0.36, 0.38), 0.004, 10.0),
    (0.280, 0.950, "b", 0.200, 0.145, (0.22, 0.62, 0.76), 0.034, 6.0),
]
BACK_PLATES = [
    (-0.230, 0.935, "b", 0.215, 0.140, (-0.25, 0.70, 0.67), 0.030, 6.0),
    (0.010, 0.945, "b", 0.225, 0.140, (0.02, 0.72, 0.69), 0.034, -2.0),
    (0.240, 0.932, "b", 0.210, 0.140, (0.26, 0.70, 0.66), 0.030, -7.0),
    (-0.350, 0.838, "b", 0.205, 0.150, (-0.44, 0.79, 0.43), 0.016, 9.0),
    (-0.125, 0.846, "b", 0.225, 0.145, (-0.13, 0.88, 0.46), 0.016, 2.0),
    (0.110, 0.842, "b", 0.215, 0.150, (0.11, 0.88, 0.46), 0.016, -4.0),
    (0.345, 0.834, "b", 0.200, 0.145, (0.43, 0.80, 0.42), 0.016, -10.0),
    (-0.215, 0.742, "b", 0.200, 0.135, (-0.23, 0.93, 0.30), 0.006, 5.0),
    (-0.005, 0.728, "b", 0.230, 0.145, (0.00, 0.95, 0.30), 0.006, -1.0),
    (0.212, 0.744, "b", 0.195, 0.130, (0.23, 0.93, 0.30), 0.006, -6.0),
]
TORSO_PRIMS = [(Ellipsoid((0.0, 0.020, 0.640), (0.440, 0.320, 0.385)), 0.0),
               (Ellipsoid((0.0, 0.030, 0.860), (0.370, 0.290, 0.190)), 0.08),
               (Ellipsoid((0.300, 0.030, 0.870), (0.170, 0.200, 0.130)), 0.07),
               (Ellipsoid((-0.300, 0.030, 0.870), (0.170, 0.200, 0.130)), 0.07),
               (Ellipsoid((0.0, 0.040, 1.000), (0.200, 0.180, 0.080)), 0.05)]


def torso_d(P):
    """the torso sculpt's adds (no displacement, no cut) as one analytic distance"""
    P = np.atleast_2d(np.asarray(P, float))
    d = np.full(len(P), 1e3)
    for prim, k in TORSO_PRIMS:
        d = smin(d, prim.d(P), k) if k > 0 else np.minimum(d, prim.d(P))
    return d


def torso_surface(az_deg, z, sx=1.0):
    """(point, outward normal) on the torso where the horizontal ray from the body axis at azimuth az meets it"""
    a = math.radians(az_deg)
    o = np.array([0.0, 0.03, z])
    dv = np.array([sx * math.sin(a), -math.cos(a), 0.0])
    lo, hi = 0.0, 0.9
    for _ in range(40):
        mid = 0.5 * (lo + hi)
        if torso_d(o + dv * mid)[0] < 0:
            lo = mid
        else:
            hi = mid
    p = o + dv * lo
    e = 0.004
    g = np.array([(torso_d(p + np.eye(3)[i] * e)[0] - torso_d(p - np.eye(3)[i] * e)[0]) for i in range(3)])
    return p, unit(g)


PLATE_FRAMES: list = []         # (centre, normal, tangent, bitangent, w, h) of every stone plate (the paint reads them)


def torso_hit(x, z, side):
    """the torso's surface point straight in front of (side 'f') / behind ('b') the body at (x, z); beside the body
    (the ray misses) the point at the torso's widest there"""
    sgn = -1.0 if side == "f" else 1.0
    o = np.array([x, 0.03, z])
    if torso_d(o)[0] > 0:
        return o
    lo, hi = 0.0, 0.6
    for _ in range(40):
        mid = 0.5 * (lo + hi)
        if torso_d(o + np.array([0.0, sgn * mid, 0.0]))[0] < 0:
            lo = mid
        else:
            hi = mid
    return o + np.array([0.0, sgn * lo, 0.0])


def plates_part(name, spec, sx, bind, tris):
    S = Sculpt(name)
    for i, (x, zc, side, w, h, nrm, lift, roll) in enumerate(spec):
        x = sx * x
        n = unit(np.array([sx * nrm[0], nrm[1], nrm[2]]))
        sp = torso_hit(x, zc, side)
        t = unit(np.cross(np.array([0, 0, 1.0]), n))
        if side == "b":
            t = -t
        b = np.cross(n, t)
        rz = math.radians(sx * roll)
        t2 = t * math.cos(rz) + b * math.sin(rz)
        b2 = np.cross(n, t2)
        c = sp + n * (0.028 + lift)
        ax = np.stack([t2, b2, n])
        PLATE_FRAMES.append((c, n, t2, b2, w, h))
        slab = RoundBox(c, (w * 0.5, h * 0.5, 0.027), 0.014, axes=ax)
        # (one blended unit per plate: a plate's own back-curve cut must not carve its neighbours); a chunky chipped
        # outline (low-frequency bites) and fine chips
        rough = lambda P, s0=i: chips(0.010, 6.5)(P + s0 * 1.7) + chips(0.0035, 19.0)(P)  # noqa: E731
        S.add(sdf.Blend([("add", slab.displaced(rough, 0.0135), 0.0),
                         ("sub", Sphere(c - n * 0.80, 0.80 - 0.022), 0.006)]), k=0.0)
    return (name, S, 0.6, "stone", bind, tris, 1.1)


# staff knots: (s along the shaft, offset along h, offset sideways, radius): even through the fist, gently gnarled
# (the shaft above the fist bends back in toward the hood, as painted: the crook's head sits over the shaft's foot)
STAFF_KNOTS = [(None, 0.0, 0.0, 0.024), (-0.62, 0.004, -0.003, 0.026), (-0.38, -0.004, 0.003, 0.026),
               (-0.14, 0.0, 0.0, 0.026), (0.14, 0.0, 0.0, 0.026), (0.34, -0.014, -0.004, 0.028),
               (0.52, -0.032, 0.005, 0.027), (0.62, -0.040, 0.0, 0.029)]


class FacetTube(Prim):
    """A carved polyline: every segment an n-sided prism (flat carved planes), the facets turning slowly along the
    length, each segment overshooting its ends so the turns close into angular knuckles. radii per point."""

    def __init__(self, pts, radii, n=7, twist=0.5, seed=3, jitter=0.06, ext=0.85, ref=(0.0, 0.0, 1.0)):
        self.pts = [np.asarray(p, float) for p in pts]
        self.radii = [float(r) for r in radii]
        rng = np.random.default_rng(seed)
        self.segs = []
        e1 = None
        acc = 0.0
        for i in range(len(self.pts) - 1):
            a, b = self.pts[i], self.pts[i + 1]
            u = unit(b - a)
            L = float(np.linalg.norm(b - a))
            if e1 is None:
                r0 = np.asarray(ref, float)
                if abs(r0 @ u) > 0.9:
                    r0 = np.array([1.0, 0.0, 0.0])
                e1 = unit(r0 - u * (r0 @ u))
            else:
                e1 = unit(e1 - u * (e1 @ u))
            e2 = np.cross(u, e1)
            acc += twist * L + float(rng.uniform(-0.12, 0.12))
            th = acc + 2 * math.pi * np.arange(n) / n + rng.uniform(-0.16, 0.16, n)
            N = np.cos(th)[:, None] * e1[None, :] + np.sin(th)[:, None] * e2[None, :]
            sc = 1.0 + rng.uniform(-jitter, jitter, n)
            self.segs.append((a, u, L, self.radii[i], self.radii[i + 1], N, sc))
        self.ext = ext

    def bounds(self):
        P = np.array(self.pts)
        r = max(self.radii) * 1.6
        return P.min(0) - r, P.max(0) + r

    def d(self, P):
        d = np.full(len(P), 1e3)
        for a, u, L, ra, rb, N, sc in self.segs:
            q = P - a
            s = q @ u
            t = np.clip(s / L, 0.0, 1.0)
            r = ra + (rb - ra) * t
            qp = q - s[:, None] * u[None, :]
            poly = np.max(qp @ N.T - r[:, None] * sc[None, :], axis=1)
            e = self.ext * max(ra, rb)
            cap = np.maximum(-s - e, s - L - e)
            d = np.minimum(d, np.maximum(poly, cap))
        return d


def staff_line():
    h, u = _crook_frame()
    side = unit(np.cross(u, h))
    pts, rads = [], []
    for s, oh, os_, r in STAFF_KNOTS:
        s = S_BUTT + 0.006 if s is None else s
        pts.append(staff_at(s) + h * oh + side * os_)
        rads.append(r)
    cp = crook_pts()
    for i, p in enumerate(cp[1:]):
        pts.append(p)
        rads.append((0.030, 0.034, 0.033, 0.031, 0.029, 0.027)[i])
    return pts, rads


def staff_parts() -> list:
    """the staff on prop.R: the pale carved ash shaft and its crook head (one faceted polyline), a carved knuckle
    under the crook, the ironstone ferrule, the leather grip wrap"""
    out = []
    h, u = _crook_frame()
    pts, rads = staff_line()
    shaft = Sculpt("staff")
    shaft.add(FacetTube(pts, rads, n=7, twist=0.6, seed=7, jitter=0.08, ext=0.80, ref=h)
              .displaced(lambda P: 0.0008 * NOISE(P * np.array([1.0, 1.0, 0.25]), 45.0), 0.0008), k=0.0)
    shaft.add(Sphere(staff_at(S_TOP - 0.02), 0.034), k=0.02)                    # the knuckle under the crook
    shaft.inter(HalfSpace((0, 0, 0.004), (0, 0, -1), 2.0), k=0.0)
    out.append(("staff", shaft, 0.5, "wood", "bone:prop.R", 820, 1.1))
    grip = Sculpt("staff_grip")
    for a_, b_ in GRIPS:
        g0, g1 = staff_at(a_), staff_at(b_)
        grip.add(Capsule(g0, g1, SHAFT_R + 0.006).displaced(wraps(0.0020, 0.016, g0, g1), 0.0020), k=0.0)
    out.append(("staff_grip", grip, 0.5, "leather", "bone:prop.R", 220, 0.7))
    fer = Sculpt("ferrule")
    b0 = staff_at(S_BUTT)
    fer.add(RoundCone(b0 + u * 0.006, b0 + u * 0.060, 0.026, SHAFT_R + 0.004).displaced(chips(0.002, 20.0), 0.002), k=0.0)
    fer.add(Torus(b0 + u * 0.058, SHAFT_R + 0.004, 0.0045, axes=sdf.frame(u)), k=0.003)
    fer.inter(HalfSpace((0, 0, 0.0), (0, 0, -1), 1.0), k=0.0)
    out.append(("ferrule", fer, 0.45, "ironstone", "bone:prop.R", 160, 0.6))
    return out


def cup_parts() -> list:
    """the cup (rigid on x_cup): an iron hook ring round the crook's tip and a short rod down to the bail, the bail
    arching to the rim, the ironstone rim band with its open throat, the clear dawnglass body (a thick base, six
    bevelled ribs, a lip under the rim), the glowing core (accent) inside and an accent inlay ring on the rim"""
    out = []
    c = np.array([CUP_C[0], CUP_C[1], 0.0])
    h, u = _crook_frame()
    hp = unit(np.cross(h, (0, 0, 1)))
    hook = Sculpt("cup_hook")
    hook.add(Torus(HANG + np.array([0, 0, 0.022]), 0.030, 0.0060, axes=sdf.frame(hp)), k=0.0)
    hook.add(Capsule(HANG + np.array([0, 0, -0.004]), HANG + np.array([0, 0, -CUP_HOOK[1]]), 0.0065), k=0.004)
    ztop = cup_z(CUP_RIM[0])
    bail_top = HANG + np.array([0, 0, -CUP_HOOK[1]])
    for sg in (-1, 1):
        foot = np.array([c[0], c[1], ztop - 0.006]) + hp * sg * (RIM_OUT - 0.004)
        mid = 0.5 * (foot + bail_top) + hp * sg * 0.025
        hook.add(Tube([bail_top, mid, foot], [0.0050, 0.0050, 0.0055], k=0.006), k=0.004)
    out.append(("cup_hook", hook, 0.4, "ironstone", "bone:x_cup_hook", 300, 0.5))

    def rim(P):
        q = P - c
        rr = np.hypot(q[:, 0], q[:, 1])
        return np.maximum(np.abs(rr - 0.5 * (RIM_OPEN + RIM_OUT)) - 0.5 * (RIM_OUT - RIM_OPEN),
                          np.abs(P[:, 2] - cup_z(0.5 * (CUP_RIM[0] + CUP_RIM[1]))) - 0.5 * (CUP_RIM[1] - CUP_RIM[0]))
    lo, hi = c + np.array([-0.12, -0.12, cup_z(CUP_GLASS[1]) - 0.02]), c + np.array([0.12, 0.12, HANG[2] + 0.01])
    rb = Sculpt("cup_rim")
    rb.add(Fn(lambda P: rim(P) + 0.003, lo, hi).displaced(chips(0.0020, 22.0), 0.0020), k=0.0)
    out.append(("cup_rim", rb, 0.4, "ironstone", "bone:x_cup_hook", 440, 0.8))

    def glass(P):
        q = P - c
        rr = np.hypot(q[:, 0], q[:, 1])
        th = np.arctan2(q[:, 1], q[:, 0])
        zt, zb = cup_z(CUP_GLASS[0]), cup_z(CUP_GLASS[1])
        z = P[:, 2]
        rad = CUP_R - 0.005 * ss(zt, zb, z)                      # a little narrower at the base
        body = np.maximum(rr - rad, np.maximum(zb - z, z - zt))
        base = np.maximum(body, z - cup_z(CUP_BASE))
        lip = np.maximum(np.maximum(body, cup_z(CUP_RIM[1] + CUP_LIP) - z), (RIM_OPEN - 0.002) - rr)
        seg = 2 * math.pi / N_RIBS
        ang = (th + seg * 0.5) % seg - seg * 0.5
        ribs = np.maximum(np.maximum(body, np.abs(ang) * rr - RIB_W), (rad - 0.014) - rr)
        return np.minimum(np.minimum(base, lip), ribs)
    gl = Sculpt("cup_glass")
    gl.add(Fn(glass, lo, hi), k=0.0)
    out.append(("cup_glass", gl, 0.35, "dawnglass", "bone:x_cup_hook", 600, 1.0))

    def core(P):
        q = P - c
        rr = np.hypot(q[:, 0], q[:, 1])
        zt, zb, r = cup_z(CUP_CORE[0]), cup_z(CUP_CORE[1]), CUP_CORE[2]
        men = zt - 0.008 * (1 - np.clip(rr / r, 0, 1) ** 2)       # a soft meniscus, lower at the centre
        return np.maximum(rr - r, np.maximum(zb - P[:, 2], P[:, 2] - men))

    def inlay(P):
        q = P - c
        rr = np.hypot(q[:, 0], q[:, 1])
        zt = cup_z(CUP_RIM[0])
        return np.maximum(np.abs(rr - 0.5 * (INLAY[0] + INLAY[1])) - 0.5 * (INLAY[1] - INLAY[0]),
                          np.abs(P[:, 2] - (zt + 0.0005)) - 0.0028)
    co = Sculpt("cup_core")
    co.add(Fn(core, lo, hi), k=0.0)
    co.add(Fn(inlay, lo, hi), k=0.0)
    out.append(("cup_core", co, 0.35, "accent", "bone:x_cup_hook", 620, 0.6))
    return out


def _round_ops(S, k):
    return S


def skin_extras(extra: dict) -> list:
    """Stillwater: five rigid reed plates laid in a fan over the hood's dome (0.20 x 0.04 m)"""
    out = []
    if extra.get("reed_plates"):
        reeds = Sculpt("reed_plates")
        for i, ang in enumerate((-36.0, -18.0, 0.0, 18.0, 36.0)):
            a = math.radians(ang)
            z0 = 1.56
            hx, hy, yc = hood_sec(z0)
            pts = []
            for z in (1.40, 1.50, 1.58, 1.625):
                hx, hy, yc = hood_sec(z)
                r = 1.0 / ((abs(math.sin(a)) ** HOOD_E + abs(math.cos(a)) ** HOOD_E) ** (1 / HOOD_E))
                pts.append(np.array([float(hx) * math.sin(a) * r * 1.02, float(yc) + float(hy) * math.cos(a) * r * 1.02 + 0.004, z]))
            for p0, p1 in zip(pts[:-1], pts[1:]):
                n = unit(np.array([p0[0], p0[1] - 0.0, 0.0]) + np.array([0, 0, 0.6]))
                t = unit(p1 - p0)
                w = unit(np.cross(n, t))
                ax = np.stack([w, t, unit(np.cross(w, t))])
                reeds.add(RoundBox(0.5 * (p0 + p1), (0.020, 0.5 * float(np.linalg.norm(p1 - p0)) + 0.012, 0.004), 0.003, axes=ax), k=0.006)
        out.append(("reed_plates", reeds, 0.5, "reed", "bone:head", 700, 0.8))
    return out


def extra_materials(ctx) -> dict:
    """roles the bible set lacks: glove (the gloves' taupe leather), rope (the cord), reed (Stillwater), rim"""
    pal = dict(materials.BIBLE_PALETTE, **PALETTE)
    pal.update(ctx.palette)
    pal.setdefault("reed", "#A6AC8E")
    # (the bible's waxed leather at roughness 0.5 flares boot tops white under the splash key: matte here)
    return {"leather": materials.waxed_leather("leather_matte", pal, "leather", ctx.gradient, rough=0.74),
            "glove": materials.waxed_leather("glove", pal, "glove", ctx.gradient, rough=0.72),
            "rope": materials.heavy_cloth("rope", pal, "rope", ctx.gradient, weave=0.4),
            "reed": materials.carved_wood("reed", pal, "reed", ctx.gradient)}


def model(ctx) -> list:
    P = []
    PLATE_FRAMES.clear()
    extra = (ctx.skin or {}).get("extra") or {}
    items = sculpts() + [x + (1.0,) if len(x) == 6 else x for x in skin_extras(extra)]
    if ctx.skin is None:
        scene.write_json(os.path.join(scene.CACHE_DIR, "fighters", "sukri_parts.json"), [it[0] for it in items])
    for name, S, vs, role, bind, tris, uvw in items:
        v, q = S.mesh(VOXEL * vs)
        ob = sdf.to_object(f"{name}_high", v, q, ctx.col)
        ob.data.materials.append(ctx.mats[role])
        P.append(fighter.Part(name, high=ob, tris=tris, bind=bind, uv_weight=uvw))
    return P


# ── rig: the right arm on the staff, prop.R up the shaft, prop.L in the left hand, the cup's pendulum, sockets ──
def rig_extras(ctx) -> None:
    info = ctx.info
    arm = info.armature
    scene.select_only([arm], arm)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    sh = V(eb["upper_arm.R"].head)
    elv, wrv = V(tuple(E_R)), V(tuple(W_R))
    up_d, fo_d = (elv - sh).normalized(), (wrv - elv).normalized()
    eb["upper_arm.R"].tail = elv
    eb["forearm.R"].head = elv
    eb["forearm.R"].tail = wrv
    hd = (V(tuple(GRIP)) - wrv).normalized()
    eb["hand.R"].head = wrv
    eb["hand.R"].tail = wrv + hd * PROPORTIONS["hand"] * 0.5
    eb["upper_arm.R"].align_roll(fo_d - up_d * fo_d.dot(up_d))
    eb["forearm.R"].align_roll(-up_d - fo_d * (-up_d).dot(fo_d))
    eb["hand.R"].align_roll(-up_d - hd * (-up_d).dot(hd))
    g = V(tuple(GRIP))
    eb["prop.R"].head = g
    eb["prop.R"].tail = g + V(tuple(STAFF_U)) * 0.12
    eb["prop.R"].align_roll(V((0.0, -1.0, 0.0)))
    cl = V(tuple(HAND_L_FRAME[0]))
    eb["prop.L"].head = cl
    eb["prop.L"].tail = cl + V(tuple(HAND_L_FRAME[1])) * 0.12
    eb["prop.L"].align_roll(V(tuple(-HAND_L_FRAME[3])))
    cb = eb.new("x_cup_hook")                                    # deforming: the cup swings as one rigid piece
    cb.head = V(tuple(HANG))
    cb.tail = V(tuple(HANG - np.array([0.0, 0.0, 0.12])))
    cb.align_roll(V((0.0, -1.0, 0.0)))
    cb.parent = eb["prop.R"]
    cb.use_deform = True
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.pose.bones["x_cup_hook"].rotation_mode = "XYZ"
    for b in arm.data.bones:
        info.lengths[b.name] = b.length
    info.joints["elbow.R"], info.joints["wrist.R"] = elv, wrv
    info.joints["knuckle.R"] = wrv + hd * PROPORTIONS["hand"] * 0.5
    info.joints["palm.R"] = g
    info.joints["forearm_dir.R"] = fo_d
    info.joints["arm_dir.R"] = up_d
    core_c = np.array([CUP_C[0], CUP_C[1], cup_z(0.5 * (CUP_CORE[0] + CUP_CORE[1]))])
    rig.add_socket(info, "x_cup", "x_cup_hook", tuple(core_c), (0.0, 0.0, -0.06), z_hint=(0, -1, 0))
    rig.add_socket(info, "x_cord", "hips", tuple(CORD_C), (0.0, -0.06, 0.0), z_hint=(0, 0, 1))
    rig.add_socket(info, "x_staff_top", "prop.R", tuple(CROOK_TOP), tuple(STAFF_U * 0.08), z_hint=(0, -1, 0))


# ── skin weights (pipeline.bind_part wrapper) ──────────────────────────────────────────────────────────
def _seg_dist(P, a, b):
    ab = b - a
    t = np.clip(((P - a) @ ab) / float(ab @ ab), 0.0, 1.0)
    return np.linalg.norm(P - (a + t[:, None] * ab[None, :]), axis=1)


def _w_hood(P, J):
    """rigid on the head round the face and over the skull; the lower hood blends through the neck into the chest
    (the cowl over the back plates follows the chest); the front under the chin stays on the head longer (the
    face is rigid on the head: no gap opens under the chin on a nod)"""
    y, z = P[:, 1], P[:, 2]
    zh = 1.045 + 0.06 * ss(-0.10, 0.15, y)
    wh = ss(zh - 0.05, zh + 0.03, z)
    wc = (1 - ss(0.94, 1.02, z)) * ss(-0.05, 0.10, y) + (1 - ss(0.93, 0.98, z)) * (1 - ss(-0.05, 0.10, y))
    wc = np.clip(wc, 0, 1) * (1 - wh)
    wn = np.clip(1 - wh - wc, 0, 1)
    return {"head": wh, "neck": wn, "chest": wc}


def _w_torso(P, J):
    x, z = P[:, 0], P[:, 2]
    wh = 1 - ss(0.50, 0.62, z)
    wc = ss(0.68, 0.82, z)
    ws = np.clip(1 - wh - wc, 0, 1)
    sh = ss(0.20, 0.34, np.abs(x)) * ss(0.74, 0.88, z)
    k = 1 - sh
    return {"hips": wh * k, "spine": ws * k, "chest": wc * k, "shoulder.L": sh * (x > 0), "shoulder.R": sh * (x <= 0)}


def _w_belt(P, J):
    return {"hips": np.full(len(P), 0.7), "spine": np.full(len(P), 0.3)}


def _w_skirt(P, J):
    """the panels from the sash to the hem: the hips at the waist, each side's thigh below (blended across the
    middle), the shins taking a share at the hem in front"""
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    leg = 0.70 * ss(0.48, 0.33, z)
    side_l = ss(-0.12, 0.12, x)
    shin = leg * 0.30 * ss(0.36, 0.27, z) * ss(-0.05, -0.25, y)
    th = leg - shin
    return {"hips": 1 - leg, "thigh.L": th * side_l, "thigh.R": th * (1 - side_l),
            "shin.L": shin * side_l, "shin.R": shin * (1 - side_l)}


def _w_pants(P, J):
    x, z = P[:, 0], P[:, 2]
    side_l = ss(-0.06, 0.06, x)
    wt = ss(0.50, 0.40, z)
    ws = ss(0.30, 0.22, z) * wt
    wt = wt - ws
    return {"hips": 1 - ss(0.50, 0.40, z), "thigh.L": wt * side_l, "thigh.R": wt * (1 - side_l),
            "shin.L": ws * side_l, "shin.R": ws * (1 - side_l)}


def _w_shins(P, J):
    x, z = P[:, 0], P[:, 2]
    m = (x > 0).astype(float)
    wt = ss(0.22, 0.26, z) * 0.5
    return {"shin.L": (1 - wt) * m, "shin.R": (1 - wt) * (1 - m), "thigh.L": wt * m, "thigh.R": wt * (1 - m)}


def _w_sleeves(P, J):
    out = {}
    for s, sx in (("L", 1.0), ("R", -1.0)):
        m = (P[:, 0] * sx > 0).astype(float)
        j, e = J[f"upper_arm.{s}"]
        fe, fw = J[f"forearm.{s}"]
        u = unit(e - j)
        d = (P - j) @ u
        wsh = 1 - ss(-0.05, 0.05, d)
        d1, d2 = _seg_dist(P, j, e), _seg_dist(P, fe, fw)
        uf = unit(fw - fe)
        past = ss(-0.03, 0.03, (P - fe) @ uf)
        wf = np.clip(ss(-0.025, 0.025, d1 - d2) * 0.5 + past * 0.5, 0, 1) * (1 - wsh)
        wu = np.clip(1 - wsh - wf, 0, 1)
        out[f"shoulder.{s}"] = wsh * m
        out[f"upper_arm.{s}"] = wu * m
        out[f"forearm.{s}"] = wf * m
    return out


def _w_boots(P, J):
    out = {}
    for s, sx in (("L", 1.0), ("R", -1.0)):
        m = (P[:, 0] * sx > 0).astype(float)
        knee, ankle = J[f"shin.{s}"]
        ball = J[f"toe.{s}"][0]
        z = P[:, 2]
        wsh = ss(ankle[2] + 0.00, ankle[2] + 0.05, z)
        d = (ball - ankle) * np.array([1.0, 1.0, 0.0])
        d /= max(float(np.linalg.norm(d)), 1e-6)
        sb = (P - ball) @ d
        rest = np.clip(1 - wsh, 0, 1)
        wto = ss(-0.015, 0.030, sb) * rest
        out[f"shin.{s}"] = wsh * m
        out[f"foot.{s}"] = (rest - wto) * m
        out[f"toe.{s}"] = wto * m
    return out


WEIGHTS = {"torso": _w_torso, "belt": _w_belt, "hood": _w_hood, "skirt": _w_skirt, "pants": _w_pants,
           "shins": _w_shins, "sleeves": _w_sleeves, "boots": _w_boots}


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


# ── paint (project.paint wrapper) ──────────────────────────────────────────────────────────────────────
# projected: the hood, the face, the torso's wraps, the sash, the skirt, the bloomers, the shin wraps, the sleeves and
# bracers (the concept's own paint, side-filled where both plates see them edge-on); procedural (in the concept's
# colours): the stone plates (their layout is the model's, not the painting's), the staff, the cup, the gloves, the
# boots, the cord and the hood's dark lining round the face
PROC = ("staff", "staff_grip", "ferrule", "cup_hook", "cup_rim", "cup_glass", "hand_R", "hand_L", "boots", "cord",
        "plates_L", "plates_R", "plates_back", "reed_plates")
HOLD = ("staff", "staff_grip", "ferrule", "cup_hook", "cup_rim", "cup_glass", "reed_plates")   # no height ramp
# z / 1.65 -> linear gain: light hood and face, the wraps a step down, dark boots (brief §6)
VALUE_RAMP = [(0.0, 0.66), (0.06, 0.70), (0.14, 0.78), (0.24, 0.86), (0.34, 0.90), (0.48, 0.93), (0.60, 0.98),
              (0.72, 1.02), (0.85, 1.04), (1.0, 1.05)]
HI_KNEE, HI_TOP = 0.56, 0.70   # linear luminance: a soft shoulder from L* 80 up to L* 87 (no large area over 86)
SIDE_PARTS = ("hood", "torso", "belt", "skirt", "pants", "shins", "sleeve_L", "sleeve_R", "bracer_L", "bracer_R", "face")
SIDE_FACE = (0.24, 0.60)
SIDE_FACE_PART = {"hood": (0.30, 0.72), "face": (0.30, 0.70), "torso": (0.28, 0.66)}
SIDE_HI = 1.12
# build 4: beside the body the painting shows the ARMS (sleeves, the brown bracer, the gloves, the staff), not the
# wraps: torso / skirt texels out there took that paint as brown smears in three-quarter views; they take the part's
# own banded tone instead (front cream / back tan blended by the normal)
FRONT_FLANK = ("torso", "skirt")
SIDE_X = {"torso": (0.30, 0.36, 0.30, 0.92), "skirt": (0.34, 0.40, 0.30, 0.52)}
OBLIQUE = {"torso": 0.55, "hood": 0.45, "skirt": 0.45, "sleeve_L": 0.5, "sleeve_R": 0.5, "pants": 0.4, "shins": 0.4}
DARK_FLOOR, DARK_KNEE = 0.66, 0.86
KEY = unit((-0.45, -0.70, 0.55))                    # the painted key light: upper front, his right
LINING_HEX = "#2B221D"
HOOD_TONE = 0.68
HOOD_WARM, HOOD_WARM_K = "#D6C6A6", 0.45     # build 3: three rendered the linen a cool bone-white: pulled toward warm cream


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


def _lam(n, lo=0.70, k=0.36):
    return lo + k * np.clip(n @ KEY, -0.4, 1.0)


_HID = [None]


def _proj_sides(maps, plates, vis, names, eps=0.02, log=print):
    """project.paint's projection, the front and back colours kept apart (the shared code blends them)."""
    P, N, part = maps["P"], maps["N"], maps["part"]
    have = part >= 0
    fills = {}
    for side in ("front", "back"):
        pid = vis.part[side]
        s = vis.step
        small = plates.img[side][s // 2::s, s // 2::s][:pid.shape[0], :pid.shape[1]]
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
    # build 8: the barrel's flanks (under the arms, seen in the victory / cast poses) took half the back's tan-brown
    # as blotches: the cream front wraps run round the flanks, the brown back wraps start well behind them
    for nm_ in FRONT_FLANK:
        if nm_ in names:
            m_ = k == names.index(nm_)
            wb[m_] = ss(0.10, 0.50, n[m_, 1])
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


def _side_fill(lin, k, p, n, names, log):
    """Edge-on texels (both plates see them badly: zebra streaks) and texels hidden from both plates take the part's
    own painted tone at their height (front and back blended by the normal), broken by soft vertical brush strokes;
    none brighter than SIDE_HI x its band."""
    face = np.abs(n[:, 1])
    hid = _HID[0] if _HID[0] is not None and len(_HID[0]) == len(k) else np.zeros(len(k), dtype=bool)
    strokes = 1 + 0.065 * NOISE.fbm(p * np.array([1.0, 1.0, 0.30]), 9.0, 3) + 0.03 * NOISE(p, 30.0)
    for kk in np.unique(k):
        nm = names[kk]
        if nm not in SIDE_PARTS:
            continue
        sel = k == kk
        f0, f1 = SIDE_FACE_PART.get(nm, SIDE_FACE)
        w = np.maximum(1 - ss(f0, f1, face), hid.astype(np.float32))
        zone = np.zeros(len(k), dtype=np.float32)
        if nm in SIDE_X:
            x0_, x1_, z0_, z1_ = SIDE_X[nm]
            zone = ss(x0_, x1_, np.abs(p[:, 0])) * ss(z0_, z0_ + 0.04, p[:, 2]) * ss(z1_, z1_ - 0.04, p[:, 2])
            w = np.maximum(w, zone)
        if nm in ("sleeve_L", "sleeve_R"):
            # build 9: the model's elbows sit 7 cm under the painted ones: the sleeves' lower ends took the painted
            # brown bracer; the cream sleeve wraps run down to the model's own bracer
            zone = ss(0.78, 0.73, p[:, 2]).astype(np.float32)
            w = np.maximum(w, zone)
        good = sel & (face > 0.78) & ~hid & (zone < 0.05)
        if nm == "hood":
            good &= ~((open_sd(p[:, 0], p[:, 2]) < 0.05) & (p[:, 1] < -0.02))
        if good.sum() < 40:
            continue
        zs = p[sel, 2]
        gf, gb = good & (n[:, 1] < 0), good & (n[:, 1] > 0)
        tf = _band_tone(p[gf, 2], lin[gf], zs) if gf.sum() >= 40 else None
        tb = _band_tone(p[gb, 2], lin[gb], zs) if gb.sum() >= 40 else None
        if tf is None and tb is None:
            continue
        tf = tf if tf is not None else tb
        tb = tb if tb is not None else tf
        wbb = (ss(0.10, 0.50, n[sel, 1]) if nm in FRONT_FLANK else ss(-0.35, 0.35, n[sel, 1]))[:, None]
        tone = tf * (1 - wbb) + tb * wbb
        ws_ = w[sel][:, None]
        c = lin[sel] * (1 - ws_) + tone * strokes[sel][:, None] * ws_
        Yc, Yt = _Y(c), np.maximum(_Y(tone), 1e-4)
        cap = np.where(face[sel] < 0.9, Yt * SIDE_HI, 1e9)
        c = c * np.minimum(1.0, cap / np.maximum(Yc, 1e-5))[:, None]
        lin[sel] = c
        log(f"  sukri side fill {nm}: {100 * float((w[sel] > 0.5).mean()):.0f}% of its texels")
    return lin


def _calm(lin, k, p, n, names, log):
    """where cloth turns away from the plates (|normal.y| 0.95 -> 0.55) the painted strokes stretch into bands in a
    three-quarter view: there they ease toward the part's banded tone, no texel darker than DARK_FLOOR x it"""
    hid = _HID[0] if _HID[0] is not None and len(_HID[0]) == len(k) else np.zeros(len(k), dtype=bool)
    strokes = 1 + 0.05 * NOISE.fbm(p * np.array([1.0, 1.0, 0.30]), 9.0, 3) + 0.025 * NOISE(p, 30.0)
    face = np.abs(n[:, 1])
    fw = ss(0.012, 0.03, _Y(lin))
    for kk in np.unique(k):
        nm = names[kk]
        if nm not in OBLIQUE:
            continue
        sel = k == kk
        c = lin[sel]
        zs = p[sel, 2]
        good = (face[sel] > 0.85) & (fw[sel] > 0.8) & ~hid[sel]
        gf, gb = good & (n[sel, 1] < 0), good & (n[sel, 1] > 0)
        tf = _band_tone(zs[gf], c[gf], zs) if gf.sum() >= 40 else None
        tb = _band_tone(zs[gb], c[gb], zs) if gb.sum() >= 40 else None
        if tf is None and tb is None:
            continue
        tf = tf if tf is not None else tb
        tb = tb if tb is not None else tf
        wbb = (ss(0.10, 0.50, n[sel, 1]) if nm in FRONT_FLANK else ss(-0.35, 0.35, n[sel, 1]))[:, None]
        tone = tf * (1 - wbb) + tb * wbb
        obl = (1 - ss(0.55, 0.95, face[sel])) * fw[sel]
        wo = (OBLIQUE[nm] * obl)[:, None]
        c = c * (1 - wo) + (tone * strokes[sel][:, None] + (c - tone) * 0.35) * wo
        r = _Y(c) / np.maximum(_Y(tone), 1e-5)
        D = DARK_KNEE - DARK_FLOOR
        r2 = np.where(r < DARK_KNEE, DARK_KNEE - D * (1 - np.exp(-(DARK_KNEE - r) / D)), r)
        g = 1 + (r2 / np.maximum(r, 1e-5) - 1) * obl
        lin[sel] = c * g[:, None]
        log(f"  sukri oblique calm {nm}: {100 * float((obl > 0.5).mean()):.0f}% of its texels")
    return lin


def _flank_refill(lin, k, p, n, names, log):
    """build 9: brown / dark outliers on the barrel's FLANKS (side-facing texels beside the body, where the painting
    shows arms, fists and the staff) take the part's own front band tone, the painted detail kept as a value ratio"""
    for nm in ("torso", "skirt"):
        if nm not in names:
            continue
        sel = k == names.index(nm)
        c = lin[sel]
        pp, nn = p[sel], n[sel]
        Y = _Y(c)
        mx, mn = c.max(1), c.min(1)
        sat = (mx - mn) / np.maximum(mx, 1e-4)
        front = (nn[:, 1] < -0.6) & (np.abs(pp[:, 0]) < 0.22) & (Y > 0.01)
        if front.sum() < 60:
            continue
        tone = _band_tone(pp[front, 2], c[front], pp[:, 2], step=0.05)
        Yt = np.maximum(_Y(tone), 1e-4)
        flank = ss(0.22, 0.30, np.abs(pp[:, 0])) * ss(0.35, 0.60, np.abs(nn[:, 0])) * ss(0.25, -0.10, nn[:, 1])
        bad = ((sat > 0.30) | (Y < 0.62 * Yt)) & (flank > 0.05)
        r = np.clip(Y / Yt, 0.75, 1.12) ** 0.5
        new = tone * r[:, None]
        wgt = (flank * bad)[:, None]
        lin[sel] = c * (1 - wgt) + new * wgt
        log(f"  sukri flank refill {nm}: {int(bad.sum())} texels")
    return lin


def _staff_local(p):
    """(s along the shaft from the grip, angle round it) of staff texels"""
    q = p - GRIP
    s = q @ STAFF_U
    h, u = _crook_frame()
    th = np.arctan2(q @ np.cross(u, h), q @ h)
    return s, th


def _wood_paint(p, n, hexc="#CBBFA4", dark_hex="#857A66"):
    """the pale weathered ash staff (as painted: a pale grey-cream with long darker grain streaks running along the
    shaft, a few knots, grime toward the butt)"""
    s, th = _staff_local(p)
    base = _lin(_hex(hexc))
    dark = _lin(_hex(dark_hex))
    grain = np.sin(th * 7.0 + 2.4 * NOISE(p * np.array([1.0, 1.0, 0.10]), 5.0)) * 0.5 + 0.5
    fine = np.sin(th * 19.0 + 3.0 * NOISE(p * np.array([1.0, 1.0, 0.10]), 9.0)) * 0.5 + 0.5
    g = 0.55 * grain ** 5 + 0.30 * fine ** 7
    c = base[None, :] * (1 - 0.32 * g)[:, None] + dark[None, :] * (0.32 * g)[:, None]
    knots = np.clip(NOISE.ridged(p, 9.0, 2) - 0.62, 0, 1) * 1.8
    z = p[:, 2]
    butt = 0.74 + 0.26 * ss(0.05, 0.60, z)
    c = c * ((1 - 0.30 * knots) * butt * _lam(n, 0.84, 0.18))[:, None] * (1 + 0.05 * _fbm(p, 30.0))[:, None]
    return c


def _leather_paint(p, n, hexc="#4A3B31"):
    return _lin(_hex(hexc))[None, :] * ((1 + 0.15 * _fbm(p, 40.0)) * _lam(n, 0.82, 0.24))[:, None]


def _stone_paint(p, n, hexc, grain=0.12, top=0.10):
    c = _lin(_hex(hexc))[None, :] * (1 + grain * _fbm(p, 14.0))[:, None]
    k = (1 - 0.30 * ss(-0.2, -0.8, n[:, 2])) * (1 + top * ss(0.4, 0.9, n[:, 2])) * _lam(n, 0.86, 0.18)
    return c * k[:, None]


def _glove_paint(p, n, frame, curl):
    """the dark taupe gloves (as painted): lit backs of the fingers, dark creases between them and in the curl, a
    darker cuff band"""
    C, a, f, out = frame
    base = _lin(_hex("#62574D"))
    q = p - C
    sa = q @ a / HS
    crease = np.zeros(len(p), dtype=np.float32)
    for i in range(3):
        sp = (i - 1.0) * 0.0245
        crease = np.maximum(crease, np.exp(-((sa - sp) / 0.0035) ** 2))
    inner = ss(0.0, -0.035 * HS, q @ out) * ss(-0.01, 0.03 * HS, q @ f)
    cuff = ss(-0.07 * HS, -0.085 * HS, q @ f)
    c = base[None, :] * (_lam(n, 0.70, 0.46) * (1 - 0.35 * crease * ss(0.0, 0.02 * HS, q @ f)) * (1 - 0.30 * inner)
                         * (1 - 0.18 * cuff) * (1 + 0.06 * _fbm(p, 50.0)))[:, None]
    return c


def _boot_paint(p, n):
    """soft dark-brown leather boots (as painted): lit toe and instep tops, creases over the instep, a darker sole
    edge, the turned top"""
    base = _lin(_hex("#4A3C33"))
    z = p[:, 2]
    crease = np.clip(np.sin(z * 210.0 + 3.0 * NOISE(p, 12.0)), 0, 1) ** 6 * ss(0.05, 0.08, z) * (1 - ss(0.10, 0.13, z))
    sole = 1 - ss(0.006, 0.022, z)
    band = ss(0.100, 0.108, z)
    k = _lam(n, 0.70, 0.48) * (1 - 0.22 * crease) * (1 - 0.40 * sole) * (1 + 0.08 * band) * (1 + 0.10 * _fbm(p, 35.0))
    return base[None, :] * k[:, None]


def _cord_paint(p, n):
    """the weighted cord: a twisted brown rope (light / dark twist stripes), the iron weight"""
    c0 = CORD_C
    q = p - c0
    tw = 0.5 + 0.5 * np.sin(np.arctan2(q[:, 2], q @ unit(np.cross(CORD_N, (0, 0, 1.0)))) * 48.0 + 70.0 * (q @ CORD_N))
    c = _lin(_hex("#7D6852"))[None, :] * (_lam(n, 0.74, 0.40) * (0.80 + 0.28 * tw))[:, None]
    wt = np.linalg.norm(p - (c0 + CORD_N * 0.020 + np.array([0.0, -0.004, -0.156])), axis=1) < 0.026
    c[wt] = _stone_paint(p[wt], n[wt], "#3F3B39", 0.10)
    return c


def _cup_hook_paint(p, n):
    return _stone_paint(p, n, "#3D3A39", 0.10, 0.20)


def _cup_rim_paint(p, n):
    """the rim band: dark blue-grey slate (as painted on the cup's lid), chalky lit top edge, chipped"""
    c = _stone_paint(p, n, "#434B57", 0.14, 0.35)
    chip = np.clip(NOISE.ridged(p, 30.0, 2) - 0.70, 0, 1) * 2.2
    return c * (1 + 0.35 * chip)[:, None]


def _glass_paint(p, n):
    """the clear dawnglass (as painted): a pale cool blue-white, brighter where the glass faces the light, a cool
    darker band near the base, white glints on the ribs' edges"""
    base = _lin(_hex("#B9CBD6"))
    q = p[:, :2] - CUP_C[None, :]
    rr = np.hypot(q[:, 0], q[:, 1])
    z = p[:, 2]
    low = ss(cup_z(CUP_BASE) + 0.03, cup_z(CUP_GLASS[1]), z)
    rib_edge = ss(CUP_R - 0.016, CUP_R - 0.004, rr) * (1 - ss(0.80, 0.98, np.abs(n[:, 2])))
    glint = np.clip(n @ unit((-0.3, -0.8, 0.5)), 0, 1) ** 8
    c = base[None, :] * (_lam(n, 0.80, 0.30) * (1 - 0.18 * low))[:, None]
    c = c + (0.18 * rib_edge + 0.40 * glint)[:, None] * _lin(_hex("#EEF4F7"))[None, :]
    return c


def _plate_paint(p, n):
    """the pale stone plates (as painted: a warm pale grey-cream, lit top faces, chalky chipped top edges, a dark
    painted line round the lower edges and dark undersides, mottled, a few chips and cracks), each read in its frame"""
    if not PLATE_FRAMES:
        return _stone_paint(p, n, "#CBC5B4", 0.12, 0.12)
    C = np.array([f[0] for f in PLATE_FRAMES])
    d = np.linalg.norm(p[:, None, :] - C[None, :, :], axis=2)
    near = np.argmin(d, axis=1)
    out = np.zeros((len(p), 3), dtype=np.float32)
    base = _lin(_hex("#B9B09C"))
    chalk = _lin(_hex("#DCD4C2"))
    line = _lin(_hex("#5E564B"))
    for i, (c, nn, t, b, w, h) in enumerate(PLATE_FRAMES):
        m = near == i
        if not m.any():
            continue
        q = p[m] - c
        u, v = q @ t / (0.5 * w), q @ b / (0.5 * h)
        facing = n[m] @ nn
        edge = 1 - ss(0.50, 0.90, facing)                       # the bevelled rims and the slab's thickness
        top = ss(0.10, 0.80, v) * edge * ss(-0.2, 0.4, n[m, 2])  # the upper rim catches the light: chalky
        bot = (ss(-0.1, -0.8, v) * edge) + ss(0.25, -0.40, facing)
        under = ss(0.0, -0.5, n[m, 2]) * edge
        mott = 1 + 0.12 * _fbm(p[m], 8.0) + 0.06 * _fbm(p[m], 29.0)
        chip = np.clip(NOISE.ridged(p[m], 20.0, 2) - 0.64, 0, 1) * 2.6
        crack = np.clip(NOISE.ridged(p[m] * np.array([1.0, 1.0, 2.2]), 7.0, 2) - 0.86, 0, 1) * 6.0
        tone = 0.93 + 0.12 * math.sin(i * 2.3 + 0.7)            # each slab a slightly different value
        k = _lam(n[m], 0.74, 0.40) * mott * tone * (1 - 0.18 * chip) * (1 - 0.35 * np.clip(crack, 0, 1))
        c_ = base[None, :] * k[:, None]
        c_ = c_ * (1 - 0.45 * top[:, None]) + chalk[None, :] * (0.45 * top * k)[:, None]
        dk = np.clip(0.55 * bot + 0.45 * under, 0, 0.8)[:, None]
        c_ = c_ * (1 - dk) + line[None, :] * dk * 0.9
        out[m] = c_
    return out


def _lining(p, n, lin):  # noqa: C901
    """the hood's dark lining round the face (as painted: a deep brown-black, a little warmer and lighter at the
    rim's inner lip): hood texels inside the opening outline and recessed behind the rim"""
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    od = open_sd(x, z)
    # (build 2: the recess only, y < -0.08: build 1 darkened the hood's BACK inside the face outline, Dunsom's bug)
    inside = ss(0.012, -0.004, od) * ss(-0.020, 0.010, y - rim_y(x, z) - 0.020) * ss(-0.03, -0.085, y)
    inside = inside * ss(0.40, 0.05, n[:, 0] * np.sign(x))       # (build 3: never the hood's outward-facing sides)
    deep = ss(-0.215, -0.135, y)
    c = _lin(_hex(LINING_HEX))[None, :] * (0.80 + 0.40 * (1 - deep) + 0.08 * _fbm(p, 25.0))[:, None]
    w = inside[:, None]
    return lin * (1 - w) + c * w


def _paint(maps, plates, vis, names, tops=None, flat=None, eps=0.02, bleed=True, log=print):
    if "staff" not in names or "face" not in names:
        return _orig_paint(maps, plates, vis, names, tops=tops, flat=flat, eps=eps, bleed=bleed, log=log)
    P, N, part = maps["P"], maps["N"], maps["part"]
    size = maps["size"]
    out = np.zeros((size, size, 3), dtype=np.float32)
    idx, k, p, n, cols, wb = _proj_sides(maps, plates, vis, names, eps, log)
    col = cols["front"] * (1 - wb[:, None]) + cols["back"] * wb[:, None]
    lin = _lin(col)
    lin = _side_fill(lin, k, p, n, names, log)
    lin = _calm(lin, k, p, n, names, log)

    def sel(name):
        if name not in names:
            return None
        m = k == names.index(name)
        return m if m.any() else None

    procs = {
        "staff": _wood_paint, "staff_grip": lambda pp, nn: _leather_paint(pp, nn, "#4A3A30"),
        "ferrule": lambda pp, nn: _stone_paint(pp, nn, "#47423E", 0.12),
        "cup_hook": _cup_hook_paint, "cup_rim": _cup_rim_paint, "cup_glass": _glass_paint,
        "hand_R": lambda pp, nn: _glove_paint(pp, nn, HAND_R_FRAME, 1.0),
        "hand_L": lambda pp, nn: _glove_paint(pp, nn, HAND_L_FRAME, LEFT_CURL),
        "boots": _boot_paint, "cord": _cord_paint,
        "plates_L": _plate_paint, "plates_R": _plate_paint, "plates_back": _plate_paint,
        "reed_plates": lambda pp, nn: _stone_paint(pp, nn, "#A6AC8E", 0.08),
    }
    for name, fn in procs.items():
        m = sel(name)
        if m is not None:
            lin[m] = fn(p[m], n[m])
    lin = _flank_refill(lin, k, p, n, names, log)
    m = sel("hood")
    if m is not None:
        # build 2: the cream linen read bone-white in three: toned to the brief's cloth2 (L* ~80) and warmed a touch
        c = lin[m] * HOOD_TONE
        Y = _Y(c)[:, None]
        warm = _lin(_hex(HOOD_WARM))
        lin[m] = _lining(p[m], n[m], c * (1 - HOOD_WARM_K) + Y * warm[None, :] / max(float(_Y(warm[None, :])[0]), 1e-4) * HOOD_WARM_K)
    for nm_ in ("shins",):
        m = sel(nm_)
        if m is not None:
            lin[m] = lin[m] * 0.86
    m = sel("face")
    if m is not None:
        pp = p[m]
        sd = face_sd(pp[:, 0], pp[:, 2])
        lin[m] = lin[m] * (1 - 0.30 * ss(-0.014, 0.0, sd))[:, None]
    # the light-head / dark-feet ramp and the highlight cap (not on the staff / cup: held at any height)
    body = np.ones(len(k), dtype=bool)
    for name in HOLD:
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
        out = _project.blur(out, ATLAS_SOFTEN).astype(np.float32)
    return out


_orig_paint = _project.paint
_project.paint = _paint


# ── the ORM's gutters (bake.bake_asset wrapper; Dunsom's fix: empty gutters = roughness 0 = a mirror at mips) ───
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
    before = float(1 - valid.mean())
    px[..., :3] = _fill_gutters(px[..., :3], valid)
    img.pixels.foreach_set(px.ravel())
    img.update()
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    scene.log(f"sukri ORM gutters filled: {100 * before:.1f}% of the {w}x{h} map took their island's roughness / AO")
    return res


_bake.bake_asset = _bake_asset


# ── skins (project.recolour wrapper) ────────────────────────────────────────────────────────────────────
# Each listed part's painted median moves onto the skin's colour (linear gain per channel: the painted values and
# detail keep their relationships). Shadeprint prints the wraps in ink and light: every painted wrap band's lit crest
# (the painted relief's raised band, proto/sukri_relief.py) takes the pale printed rim, the rest the ink.
WRAP_PARTS = ("torso", "skirt", "sleeve_L", "sleeve_R", "shins")
SKIN_PARTS = {
    "sukri_stillwater": {"torso": "#59666A", "skirt": "#5E6B6E", "sleeve_L": "#5C696D", "sleeve_R": "#5C696D",
                         "shins": "#7E8886", "hood": "#BAB4A2", "plates_L": "#AAA79C", "plates_R": "#AAA79C",
                         "plates_back": "#AAA79C", "cup_glass": "#8FB3A8", "belt": "#3E4446", "bracer_L": "#3E4446",
                         "bracer_R": "#3E4446", "pants": "#2E3436", "cord": "#6F7468"},
    "sukri_shadeprint": {"hood": "#ADA9B6", "plates_L": "#AFACB8", "plates_R": "#AFACB8", "plates_back": "#AFACB8",
                         "face": "#BDB3A3", "staff": "#C8BFB0", "cup_glass": "#C5CFE0", "belt": "#2E2C36",
                         "bracer_L": "#34323C", "bracer_R": "#34323C", "pants": "#26252D", "boots": "#2E2C33",
                         "hand_R": "#3A3842", "hand_L": "#3A3842", "cord": "#5A5566"},
}
PRINT = {"sukri_shadeprint": ("#2B2A33", "#C6C3CE")}       # (ink, light rim)


def _shift_to(c, target_hex, med):
    gain = np.clip(_lin(_hex(target_hex)) / np.maximum(med, 1e-4), 0.02, 6.0)
    return _srgb(_hi_cap(_lin(c) * gain[None, :]))


def _recolour(img, maps, names, roles, base_pal, skin_pal, skip=None, log=print):
    if "staff" not in names or "face" not in names:
        return _orig_recolour(img, maps, names, roles, base_pal, skin_pal, skip=skip, log=log)
    sid = next((s_["id"] for s_ in SKINS if all(skin_pal.get(k_) == v for k_, v in s_["palette"].items())), None)
    targets = SKIN_PARTS.get(sid, {})
    part = maps["part"]
    iy, ix = _project.nearest_index(part >= 0)
    pid = part[iy, ix]
    Pm = maps["P"][iy, ix]
    Nm = maps["N"][iy, ix]
    out = img.copy()
    skip = skip or set()
    for i, nm in enumerate(names):
        m = pid == i
        if not m.any() or nm in skip:
            continue
        c = out[m]
        own = part[m] >= 0
        if sid in PRINT and nm in WRAP_PARTS:
            ink, light = (_lin(_hex(h)) for h in PRINT[sid])
            lin = _lin(c)
            Y = _Y(lin)
            med = float(np.median(Y[own])) if own.any() else float(np.median(Y))
            r = np.clip(Y / max(med, 1e-4), 0.45, 1.6) ** 0.6
            P_ = Pm[m]
            wf = ss(0.02, -0.02, Nm[m][:, 1])
            def rel_at(dz):
                return (_relief_at("front", P_[:, 0], P_[:, 2] + dz) * wf
                        + _relief_at("back", P_[:, 0], P_[:, 2] + dz) * (1 - wf))
            # a thin printed light line along the upper side of every painted band edge (the groove 1 cm below),
            # never in the groove itself (skins 2: wide lit crests read as zebra stripes)
            groove_below = -np.minimum(rel_at(-0.010), rel_at(-0.006))
            here = -rel_at(0.0)
            rim = ss(0.0016, 0.0030, groove_below) * (1 - ss(0.0008, 0.0020, here)) * 0.85
            col = ink[None, :] * (1 - rim[:, None]) + light[None, :] * rim[:, None]
            out[m] = _srgb(_hi_cap(col * r[:, None]))
            log(f"  sukri print {nm}: {100 * float((rim > 0.5).mean()):.0f}% light rims")
            continue
        if nm in targets:
            lin = _lin(c[own]) if own.any() else _lin(c)
            Y = _Y(lin)
            mid = (Y > np.quantile(Y, 0.25)) & (Y < np.quantile(Y, 0.9))
            med = np.median(lin[mid] if mid.sum() > 20 else lin, axis=0)
            out[m] = _shift_to(c, targets[nm], med)
            log(f"  sukri recolour {nm} -> {targets[nm]}")
    return out.astype(np.float32)


_orig_recolour = _project.recolour
_project.recolour = _recolour


# ── location tracks (Vashil's / Dunsom's wrappers): the staff slides through the fist ──────────────────────
LOC_BONES = ("prop.R",)
_orig_basis = anim.Skeleton.basis


def _basis(self, pose, b):
    m = _orig_basis(self, pose, b)
    if b in LOC_BONES:
        loc = pose.get(b + "_loc")
        if loc is not None:
            m = Matrix.Translation(V(tuple(loc))) @ m
    return m


anim.Skeleton.basis = _basis
_orig_write_action = anim.write_action


def _write_action(arm, name, poses, bones=None):
    act = _orig_write_action(arm, name, poses, bones)
    for b in LOC_BONES:
        if b not in arm.data.bones or not any(b + "_loc" in p for p in poses):
            continue
        strip = act.layers[0].strips[0]
        cb = strip.channelbag(act.slots[0], ensure=True)
        n = len(poses)
        for i in range(3):
            fc = anim._new_fcurve(cb, f'pose.bones["{b}"].location', i, b)
            vals = [float(p.get(b + "_loc", (0.0, 0.0, 0.0))[i]) for p in poses]
            fc.keyframe_points.add(n)
            fc.keyframe_points.foreach_set("co", [c for f, v in zip(range(n), vals) for c in (f, v)])
            fc.keyframe_points.foreach_set("interpolation", [1] * n)
            fc.update()
    return act


anim.write_action = _write_action
_orig_apply_pose = anim.apply_pose


def _apply_pose(arm, pose):
    _orig_apply_pose(arm, pose)
    moved = False
    for b in LOC_BONES:
        if b in arm.pose.bones:
            loc = pose.get(b + "_loc") if pose else None
            arm.pose.bones[b].location = tuple(loc) if loc is not None else (0.0, 0.0, 0.0)
            moved = True
    if moved:
        bpy.context.view_layer.update()


anim.apply_pose = _apply_pose


def _staff_world(skel, M, p_up):
    """world position of a staff point given in the rest coordinates, under the FK result M"""
    return M["prop.R"] @ (skel.rest["prop.R"].inverted() @ V(tuple(p_up)))


def _floor_staff(skel, pose):
    """the staff's butt never sinks into the floor: the staff slides up through the fist (prop.R_loc) by the
    deficit (only while the shaft is fairly upright)"""
    M = skel.fk(pose)
    butt = _staff_world(skel, M, staff_at(S_BUTT))
    ax = M["prop.R"].to_3x3().col[1].normalized()
    if butt.z >= 0.003 or ax.z < 0.25:
        return pose
    loc = list(pose.get("prop.R_loc", (0.0, 0.0, 0.0)))
    loc[1] += (0.003 - butt.z) / ax.z
    pose["prop.R_loc"] = tuple(loc)
    return pose


# ── the cup's pendulum (anim.sample_clip wrapper) ────────────────────────────────────────────────────────
# x_cup_hook hangs plumb: every frame its bone is pointed at a spring-led direction that follows straight down (the
# pivot's acceleration swings it: inertia), never more than CUP_MAX degrees off plumb (brief: a slow 4 degree swing at
# idle, swinging with the walk, wildly when stunned); an authored "x_cup_hook" key (the taunt's clink) rides on top
CUP_K, CUP_D, CUP_MAX = 70.0, 7.0, 16.0
CUP_INERTIA = 0.45
CUP_LEN = 0.39                             # the pivot -> the glass base
_orig_sample_clip = anim.sample_clip


def _hang_cup(skel, poses, loop, limit=CUP_MAX):
    b = "x_cup_hook"
    if b not in skel.bones:
        return poses
    n = len(poses)
    m = n - 1 if loop else n
    dt = 1.0 / FPS
    down = V((0.0, 0.0, -1.0))
    frames = []
    for f in range(m):
        M = skel.fk(poses[f])
        frames.append(M[skel.parent[b]] @ skel.local[b])
    cur = down.copy()
    vel = V((0.0, 0.0, 0.0))
    rec = []
    for r in range(3 if loop else 1):
        for f in range(m):
            acc = V((0.0, 0.0, 0.0))
            if 0 < f < m - 1 or loop:
                a0, a1, a2 = frames[(f - 1) % m].translation, frames[f].translation, frames[(f + 1) % m].translation
                acc = (a0 - 2 * a1 + a2) / (dt * dt)
            g_eff = down * 9.81 - acc * CUP_INERTIA
            tgt = g_eff.normalized() if g_eff.length > 1e-6 else down
            vel += (tgt - cur) * (CUP_K * dt) - vel * (CUP_D * dt)
            cur = (cur + vel * dt).normalized()
            ang = math.degrees(cur.angle(down))
            if ang > limit:
                ax = down.cross(cur)
                if ax.length > 1e-8:
                    cur = (Matrix.Rotation(math.radians(limit), 3, ax.normalized()) @ down).normalized()
                    vel *= 0.5
            if r == (2 if loop else 0):
                rec.append(cur.copy())
    if loop:
        rec.append(rec[0])
    out = [dict(p) for p in poses]
    for f in range(n):
        Pm = frames[f % m]
        R = Pm.to_3x3()
        y = R.col[1].normalized()
        d = rec[f]
        piv = Pm.translation
        need = (0.02 - piv.z) / CUP_LEN                # the cup never goes through the floor (the death's lowered staff)
        if d.z < need:
            hd = V((d.x, d.y, 0.0))
            if hd.length < 1e-3:
                hd = V((R.col[0].x, R.col[0].y, 0.0))
            hd.normalize()
            dz = min(0.6, need)
            d = (hd * math.sqrt(max(0.0, 1 - dz * dz)) + V((0.0, 0.0, dz))).normalized()
        kx = poses[f].get(b)
        if kx:
            d = (Matrix.Rotation(math.radians(kx[0]), 3, R.col[0].normalized()) @
                 Matrix.Rotation(math.radians(kx[2]), 3, R.col[2].normalized()) @ d).normalized()
        q = y.rotation_difference(d)
        loc = R.inverted() @ q.to_matrix() @ R
        out[f][b] = anim.Skeleton.euler_of(loc)
    return out


def _sample_clip(skel, clip, chains=None):
    poses = _orig_sample_clip(skel, clip, chains)
    poses = [_floor_staff(skel, p) for p in poses]
    lim = 26.0 if clip.name == "stunned" else CUP_MAX
    poses = _hang_cup(skel, poses, clip.loop, lim)
    return poses


anim.sample_clip = _sample_clip


# ── portrait / icon framing (render._fit_camera wrapper): the head boxes take in the hood's crown and the cup ──
_orig_fit_camera = _render._fit_camera


def _fit_camera(cam, lo, hi, yaw, pitch, lens, fill, aspect, x_frac, y_center=None):
    arm = next((o for o in bpy.data.objects if o.type == "ARMATURE" and o.name.startswith(ID + "_")), None)
    if arm is not None and (hi.z - lo.z) < 1.0 and "head" in arm.pose.bones:
        mw = arm.matrix_world
        hb = arm.pose.bones["head"]
        crown = mw @ hb.matrix @ V((0.0, 0.50, 0.0))
        hood = [mw @ hb.matrix @ V((x, y_, z_)) for x in (-0.40, 0.40) for y_ in (0.10, 0.49) for z_ in (-0.30, 0.25)]
        pts = [crown] + hood
        portrait = (hi.z - lo.z) > 0.45
        if "x_cup_hook" in arm.pose.bones:
            cb = arm.pose.bones["x_cup_hook"]
            c = mw @ cb.head
            down = (mw.to_3x3() @ cb.matrix.to_3x3() @ V((0.0, 1.0, 0.0))).normalized()
            if portrait:
                pts += [c + down * d + V((dx, dy, 0.0)) for dx in (-0.09, 0.09) for dy in (-0.09, 0.09) for d in (0.18, 0.40)]
            else:
                pts += [c + down * 0.30 + V((dx, dy, 0.0)) for dx in (-0.05, 0.05) for dy in (-0.05, 0.05)]
        for q in pts:
            lo = V((min(lo.x, q.x - 0.04), min(lo.y, q.y - 0.04), min(lo.z, q.z - 0.04) if not portrait else lo.z))
            hi = V((max(hi.x, q.x + 0.04), max(hi.y, q.y + 0.04), max(hi.z, q.z + 0.05)))
        w = max(hi.x - lo.x, hi.y - lo.y) * 0.92
        if aspect <= 1.01 and w > hi.z - lo.z:
            lo = V((lo.x, lo.y, hi.z - w))
    return _orig_fit_camera(cam, lo, hi, yaw, pitch, lens, fill, aspect, x_frac, y_center)


_render._fit_camera = _fit_camera
SPEC_RENDER = 0.15
_orig_fighter_renders = _render.fighter_renders


def _fighter_renders(ctx, objs, P, skin, *a, **k):
    """the splash / portrait / icon render the cloth and leather body with its specular eased (the low hero camera's
    grazing sheen mirrors the bright horizon: Dunsom's fix); the in-game material is untouched"""
    saved = []
    if getattr(ctx.spec, "ID", None) == ID:
        for o in objs:
            if o.type != "MESH":
                continue
            for m in o.data.materials:
                if m is None or not m.use_nodes or m.name.startswith("dawnglass"):
                    continue
                for nd in m.node_tree.nodes:
                    if nd.type == "BSDF_PRINCIPLED" and "Specular IOR Level" in nd.inputs:
                        inp = nd.inputs["Specular IOR Level"]
                        if not inp.is_linked:
                            saved.append((inp, inp.default_value))
                            inp.default_value = SPEC_RENDER
    try:
        return _orig_fighter_renders(ctx, objs, P, skin, *a, **k)
    finally:
        for inp, v in saved:
            inp.default_value = v


_render.fighter_renders = _fighter_renders


# ── the foot roll (anim._solve_foot, Vashil's corrected copy: + pitch = toes up about the heel) ──────────────
def _solve_foot(skel, pose, M, side, ft):
    foot, toe = f"foot.{side}", f"toe.{side}"
    rest_f = skel.rest[foot]
    ankle0 = rest_f.translation.copy()
    ball0 = skel.rest[toe].translation.copy()
    heel0 = ankle0 + V((0, 0, -ankle0.z)) + (ankle0 - ball0) * V((1, 1, 0)) * 0.55
    off = V(ft.ankle)
    lat = rest_f.to_3x3().col[0].normalized()
    rot = Matrix.Rotation(math.radians(ft.yaw), 3, "Z") @ Matrix.Rotation(math.radians(ft.pitch), 3, lat)
    pivot = (heel0 if ft.pitch > 0 else ball0) + off
    ankle_t = pivot + rot @ (ankle0 + off - pivot)
    knee_dir = Matrix.Rotation(math.radians(ft.yaw + ft.knee), 3, "Z") @ V((0, -1, 0))
    hips_fwd = M["hips"].to_3x3() @ (skel.rest["hips"].to_3x3().inverted() @ V((0, -1, 0)))
    hips_fwd.z = 0
    if hips_fwd.length > 1e-4:
        knee_dir = (knee_dir + hips_fwd.normalized()).normalized()
    end_frame = rot @ rest_f.to_3x3()
    skel.solve_two_bone(pose, M, f"thigh.{side}", f"shin.{side}", foot, ankle_t, knee_dir, True, end_frame, ft.weight)
    t = pose.get(toe, (0.0, 0.0, 0.0))
    toe_counter = -ft.pitch if ft.pitch < 0 else 0.0
    pose[toe] = (t[0] + (toe_counter + ft.toe) * ft.weight, t[1], t[2])


anim._solve_foot = _solve_foot


# ── motion (brief §8) ─────────────────────────────────────────────────────────────────────────────────
# Arms are IK: wrist targets `rel` to the posed shoulder in arm lengths (chest frame: +X his left, -Y front, +Z up),
# `aim` = the staff's shaft (prop.R +Y up the shaft); the left hand on the staff uses to_prop ("prop.R", along).
GUARD_R = tuple(np.round((W_R - SH_R) / ARM, 4))
GUARD_L = tuple(np.round((W_L - SH_L) / ARM, 4))
UP = tuple(np.round(STAFF_U, 4))


def _pole(S, E, W):
    d = unit(W - S)
    v = (E - S) - d * float((E - S) @ d)
    return tuple(np.round(unit(v), 3))


POLE_R = _pole(SH_R, E_R, W_R)
POLE_L = _pole(SH_L, E_L, W_L)
POLE_RF = (-0.55, 0.45, -0.70)
BLOCKS = {
    "guard": (GUARD_R, POLE_R, UP, GUARD_L, POLE_L),
    "run_fwd": (GUARD_R, POLE_R, UP, GUARD_L, POLE_L),
    "run_back": (GUARD_R, POLE_R, UP, GUARD_L, POLE_L),
    "lobby": (GUARD_R, POLE_R, UP, GUARD_L, POLE_L),
    "victory": (GUARD_R, POLE_R, UP, GUARD_L, POLE_L),
    "recall": (GUARD_R, POLE_R, UP, GUARD_L, POLE_L),
}
# cadence 1.67: a 12-frame cycle (the short legs' planted foot stays inside their reach at 3.4 m/s)
RUN_CADENCE = 1.67
MOTION = anim.motion_profile(weight="medium", weapon="staff", stance="neutral", run_ref_speed=3.4, blocks=BLOCKS,
                             cadence=RUN_CADENCE)
P_ = anim.P
FPS = anim.FPS


def _feet(l=(0.0, 0.0, 0.0), r=(0.0, 0.0, 0.0), yl=0.0, yr=0.0, pl=0.0, pr=0.0, wl=1.0, wr=1.0):
    return {"foot.L": FootTarget(tuple(l), pl, yl, 0.0, 0.0, wl), "foot.R": FootTarget(tuple(r), pr, yr, 0.0, 0.0, wr)}


def pose(torso=None, hips=(0.0, 0.0, 0.0), R=GUARD_R, Rp=None, aim=UP, L=GUARD_L, Lp=POLE_L, grip=None,
         Lpos=None, feet=None, slide=0.0, fk=None) -> dict:
    """A full pose: torso rotations (deg), hips_loc offset, the right wrist + staff aim, the left wrist (or `grip`: the
    left hand on the staff at `grip` m from the right fist toward the crook; or `Lpos`: an absolute left-hand target),
    feet, the staff's slide through the fist, FK extras."""
    t = dict(hips=(0.0, 0.0, 0.0), spine=(0.0, 0.0, 0.0), chest=(0.0, 0.0, 0.0), neck=(0.0, 0.0, 0.0), head=(0.0, 0.0, 0.0))
    t.update(torso or {})
    p = P_(**t)
    p["hips_loc"] = (hips[0], hips[1], -0.004 + hips[2])
    p["prop.R_loc"] = (0.0, float(slide), 0.0)
    ik = {}
    ik.update(feet or _feet())
    if Rp is None:
        Rp = POLE_R if float(np.linalg.norm(np.subtract(R, GUARD_R))) < 0.15 else POLE_RF
    ik["hand.R"] = HandTarget(rel=tuple(R), pole=tuple(Rp))
    if aim is not None:
        ik["aim.R"] = Aim(tuple(aim))
    if grip is not None:
        ik["hand.L"] = HandTarget(to_prop=("prop.R", -float(slide) + float(grip)), pole=(0.8, 0.4, -0.4))
    elif Lpos is not None:
        ik["hand.L"] = HandTarget(pos=tuple(Lpos), pole=tuple(Lp))
    else:
        ik["hand.L"] = HandTarget(rel=tuple(L), pole=tuple(Lp))
    p["ik"] = ik
    if fk:
        p.update(P_(**fk))
    return p


def _rel(v, d):
    return tuple(float(a + b) for a, b in zip(v, d))


def clip_overrides(ctx) -> dict:
    """Brief §8: four distinct ability gestures, bespoke basics, impact at exactly 40 % of attacks / casts.
      attack1   a tap of the staff, the cup flicked forward (the bolt leaves at f8; 20 f)
      attack2   an underhand push of the cup (f8; 20 f)
      cast_a1   Mote Toss: the staff swings forward, the cup tips: an underhand lob, the left hand palm-up (25 f, f10)
      cast_a2   Draw Near: the crook thrust out with the arm straight (f3), a sharp tug back to the hip (f6) (15 f)
      cast_a3   Wrap Cast: the left hand takes the cord from the belt, swings it overhead, throws overhand (25 f, f10)
      cast_ult  Gather In: the staff raised overhead, the free arm sweeping in a wide inward arc; at f16 the staff
                planted and both arms drawn to the chest, a hunched gather held to f30 (40 f)
    """
    skel = anim.Skeleton(ctx.info.armature)
    G = pose()
    out = {}

    def clip(name, N, keys, impact=None, loop=False, lags=None):
        fn = anim.keyed(keys)
        if lags:
            fn = anim.drag(fn, N, lags, loop=loop)
        return anim.Clip(name, N, loop, fn, impact=impact)

    def breathe(fn, amp=1.0, cycles=2, phase=0.0):
        def s(t):
            p = dict(fn(t))
            b = math.sin(2 * math.pi * (cycles * t + phase))
            p["chest"] = tuple(np.add(p.get("chest", (0, 0, 0)), (1.0 * amp * b, 0, 0)))
            p["neck"] = tuple(np.add(p.get("neck", (0, 0, 0)), (-0.6 * amp * b, 0, 0)))
            return p
        return s

    def cup_at(p):
        """the cup core's world place under pose p, hanging plumb from the hook (as the pendulum hangs it)"""
        r = anim.resolve(skel, dict(p))
        M = skel.fk(r)
        return M["x_cup_hook"].translation.copy() + V((0.0, 0.0, -0.5 * (CUP_CORE[0] + CUP_CORE[1])))

    # IDLE: a soft stoop on the staff, breathing, the free hand loose at the belt, the cup's slow swing (the pendulum)
    def idle_s(t):
        b = math.sin(2 * math.pi * 2 * t)
        s = math.sin(2 * math.pi * t)
        return pose(torso=dict(hips=(0, 0.8 * s, -0.6 * s), spine=(2.0 + 0.4 * b, 0, 0.4 * s), chest=(2.0 + 1.0 * b, 0.6 * s, 0),
                               neck=(-1.5 - 0.5 * b, 0, 0), head=(-1.0 - 0.3 * b, 1.5 * s, 0.4 * s)),
                    hips=(0.006 * s, 0, -0.004 * (0.5 + 0.5 * b)),
                    R=(GUARD_R[0], GUARD_R[1] + 0.02 * s, GUARD_R[2] + 0.008 * b), Rp=POLE_R,
                    aim=(UP[0] + 0.03 * s, UP[1] - 0.02 * s, UP[2]),
                    L=(GUARD_L[0] + 0.012 * s, GUARD_L[1] - 0.012 * b, GUARD_L[2]))
    out["idle"] = anim.Clip("idle", 64, True, idle_s)

    # RUN: the generator's planted gait at 3.4 m/s (a 12-frame cycle), its swing lifts scaled to the short legs; the
    # staff carried at the right side leaning forward (the cup swinging), the left arm pumping
    run = anim.gen_run(MOTION)
    LIFT = 0.42

    def run_s(t):
        p = dict(run.sample(t))
        q = t % 1.0
        sw = math.cos(2 * math.pi * (q - 0.03))
        ik = dict(p.get("ik", {}))
        for s_ in ("L", "R"):
            ft = ik.get(f"foot.{s_}")
            if ft is not None:
                ik[f"foot.{s_}"] = FootTarget((ft.ankle[0], ft.ankle[1], ft.ankle[2] * LIFT), ft.pitch * 0.65, ft.yaw,
                                              ft.toe, ft.knee, ft.weight)
        ik["hand.R"] = HandTarget(rel=(GUARD_R[0] + 0.02, GUARD_R[1] - 0.18 - 0.06 * sw, GUARD_R[2] + 0.06), pole=POLE_R)
        ik["aim.R"] = Aim((UP[0] - 0.05, -0.42 - 0.05 * sw, 0.90))
        ik["hand.L"] = HandTarget(rel=(GUARD_L[0] - 0.05, GUARD_L[1] + 0.30 * sw - 0.10, GUARD_L[2] + 0.10 + 0.08 * abs(sw)),
                                  pole=POLE_L)
        p["ik"] = ik
        h = p.get("hips", (0.0, 0.0, 0.0))
        p["hips"] = (h[0] * 0.8, h[1], h[2] * 1.4)                # a rolling gait: more side roll, less lean
        for b in ("spine", "chest"):
            v = p.get(b, (0.0, 0.0, 0.0))
            p[b] = (v[0] * 0.7, v[1], v[2])
        return p
    out["run"] = anim.Clip("run", run.frames, True, run_s, meta=run.meta)

    # ATTACK1: a tap of the staff, the cup flicked forward (the bolt leaves at f8)
    w1 = pose(torso=dict(chest=(-3, -6, 0), head=(-2, 4, 0)), R=_rel(GUARD_R, (0.0, 0.08, 0.10)), aim=(-0.12, 0.30, 0.95))
    h1 = pose(torso=dict(hips=(2, 6, 0), spine=(3, 5, 0), chest=(5, 8, 0), head=(-4, -6, 0)), hips=(0, -0.02, -0.01),
              R=(-0.42, -0.80, -0.30), aim=(-0.08, -0.72, 0.69), L=_rel(GUARD_L, (-0.02, -0.12, 0.02)))
    f1 = pose(torso=dict(hips=(2, 7, 0), spine=(3, 6, 0), chest=(6, 9, 0), head=(-5, -7, 0)), hips=(0, -0.02, -0.012),
              R=(-0.41, -0.82, -0.33), aim=(-0.08, -0.78, 0.62), L=_rel(GUARD_L, (-0.02, -0.14, 0.02)))
    out["attack1"] = anim.Clip("attack1", 20, False, anim.drag(anim.keyed(anim.strike_keys(MOTION, w1, h1, f1, G)),
                                                               20, {"head": 1.5, "neck": 1.0}), impact=0.4)
    # ATTACK2: an underhand push of the cup: the staff swung low and back, then pushed forward and up at f8
    k2 = [(0.0, G, "linear"),
          (0.22, pose(torso=dict(hips=(0, -8, 0), chest=(-2, -12, 0), head=(0, 8, 0)), R=(-0.62, 0.05, -0.70),
                      aim=(-0.32, 0.42, 0.85)), "inout"),
          (0.32, pose(torso=dict(hips=(0, -9, 0), chest=(-2, -14, 0), head=(0, 9, 0)), R=(-0.62, 0.08, -0.72),
                      aim=(-0.34, 0.46, 0.82)), "out"),
          (0.40, pose(torso=dict(hips=(3, 10, 0), spine=(3, 8, 0), chest=(5, 12, 0), head=(-3, -8, 0)), hips=(0, -0.03, -0.014),
                      R=(-0.34, -0.88, -0.42), aim=(0.05, -0.58, 0.81), L=_rel(GUARD_L, (-0.04, -0.20, 0.06))), "accel"),
          (0.52, pose(torso=dict(hips=(3, 12, 0), spine=(3, 9, 0), chest=(5, 14, 0), head=(-4, -9, 0)), hips=(0, -0.03, -0.016),
                      R=(-0.32, -0.90, -0.36), aim=(0.08, -0.64, 0.76), L=_rel(GUARD_L, (-0.04, -0.22, 0.06))), "out"),
          (0.76, pose(torso=dict(chest=(2, 4, 0)), R=_rel(GUARD_R, (0.0, -0.20, 0.06)), aim=(-0.04, -0.22, 0.97)), "inout"),
          (1.0, G, "settle")]
    out["attack2"] = clip("attack2", 20, k2, impact=0.4, lags={"head": 1.5, "neck": 1.0})

    # CAST_A1 Mote Toss (castTime 0.25 s): the staff swung back low, the cup tipping (a held tilt f3-f8), then the
    # underhand lob: the staff swings forward and up, the mote leaves the cup at f10; the left hand follows palm-up
    back = pose(torso=dict(hips=(0, -6, 0), spine=(-2, -4, 0), chest=(-3, -8, 0), head=(-2, 6, 0)), hips=(0, 0.02, -0.02),
                R=(-0.60, 0.04, -0.72), aim=(-0.30, 0.50, 0.81), L=_rel(GUARD_L, (0.02, 0.06, 0.0)))
    tilt = pose(torso=dict(hips=(0, -4, 0), spine=(-2, -3, 0), chest=(-3, -6, 0), head=(-3, 4, 0)), hips=(0, 0.01, -0.03),
                R=(-0.58, -0.18, -0.70), aim=(-0.26, 0.20, 0.94), L=(0.40, -0.30, -0.55), Lp=(0.8, 0.4, -0.4))
    lob = pose(torso=dict(hips=(3, 8, 0), spine=(4, 6, 0), chest=(6, 10, 0), neck=(-3, 0, 0), head=(-6, -6, 0)),
               hips=(0, -0.04, -0.02), R=(-0.36, -0.86, -0.18), aim=(-0.06, -0.86, 0.51),
               L=(0.18, -0.85, -0.25), Lp=(0.8, 0.3, -0.5), fk=dict(hand_L=(0, 70, 0)), feet=_feet(l=(0.0, -0.08, 0.0), yl=4.0))
    fol = pose(torso=dict(hips=(3, 9, 0), spine=(4, 7, 0), chest=(6, 12, 0), neck=(-4, 0, 0), head=(-8, -7, 0)),
               hips=(0, -0.04, -0.025), R=(-0.34, -0.88, -0.05), aim=(-0.05, -0.80, 0.60),
               L=(0.14, -0.88, -0.10), Lp=(0.8, 0.3, -0.5), fk=dict(hand_L=(0, 80, 0)), feet=_feet(l=(0.0, -0.08, 0.0), yl=4.0))
    k = [(0.0, G, "linear"), (0.12, back, "inout"), (0.30, tilt, "inout"),
         (0.36, anim.lerp_pose_w(tilt, lob, 0.30, {"hips": 0.6, "spine": 0.5, "hips_loc": 0.5}), "in"),
         (0.40, lob, "accel"), (0.52, anim.lerp_pose(lob, fol, 0.5), "out"), (0.64, fol, "out"),
         (0.84, pose(R=_rel(GUARD_R, (0.0, -0.10, 0.04)), aim=(-0.06, -0.15, 0.99)), "inout"), (1.0, G, "settle")]
    out["cast_a1"] = clip("cast_a1", 25, k, impact=0.4, lags={"head": 1.0, "neck": 0.5})

    # CAST_A2 Draw Near (castTime 0.15 s): the crook thrust out toward the ally with the arm straight (f0-f3, the
    # staff sliding through the fist), then a sharp tug back to the hip at f6 as the ally is pulled in; the left hand
    # opens in welcome; guard by f15. (Self-cast reuses the clip.)
    reach = pose(torso=dict(hips=(5, 8, 0), spine=(6, 6, 0), chest=(8, 8, 0), neck=(-4, 0, 0), head=(-7, -6, 0)),
                 hips=(0, -0.06, -0.03), R=(-0.20, -0.97, -0.05), aim=(-0.02, -0.92, 0.38), slide=0.22,
                 L=(0.45, -0.45, -0.50), Lp=(0.8, 0.4, -0.4), feet=_feet(l=(0.0, -0.10, 0.0), yl=4.0))
    tug = pose(torso=dict(hips=(-5, -6, 0), spine=(-6, -4, 0), chest=(-8, -6, 0), neck=(2, 0, 0), head=(4, 4, 0)),
               hips=(0, 0.04, -0.03), R=(-0.40, -0.32, -0.45), aim=(-0.06, -0.52, 0.85), slide=0.02,
               L=(0.55, -0.70, -0.10), Lp=(0.8, 0.3, -0.5), fk=dict(hand_L=(0, 75, -10)), feet=_feet(l=(0.0, -0.10, 0.0), yl=4.0))
    hold = pose(torso=dict(hips=(-3, -5, 0), spine=(-4, -3, 0), chest=(-5, -5, 0), head=(2, 3, 0)), hips=(0, 0.03, -0.025),
                R=(-0.40, -0.30, -0.47), aim=(-0.06, -0.48, 0.87), L=(0.55, -0.68, -0.12), Lp=(0.8, 0.3, -0.5),
                fk=dict(hand_L=(0, 75, -10)), feet=_feet(l=(0.0, -0.10, 0.0), yl=4.0))
    k = [(0.0, G, "linear"), (0.20, reach, "out"), (0.28, reach, "linear"), (0.40, tug, "accel"), (0.56, hold, "out"),
         (0.80, pose(L=_rel(GUARD_L, (0.05, -0.15, 0.08))), "inout"), (1.0, G, "settle")]
    out["cast_a2"] = clip("cast_a2", 15, k, impact=0.4, lags={"head": 0.5})

    # CAST_A3 Wrap Cast (castTime 0.25 s): the staff stays planted; the left hand takes the cord from the belt (f2),
    # swings it up round over the head once (f4-f8), throws overhand at f10 (a long throwing arm), follow-through down
    cord_w = tuple(float(v) for v in (CORD_C + np.array([0.04, -0.06, 0.02])))
    take = pose(torso=dict(hips=(0, 6, 0), spine=(2, 4, 0), chest=(4, 8, 0), head=(4, 4, 0)), hips=(0, 0.0, -0.02),
                Lpos=cord_w, Lp=(0.9, 0.3, -0.3))
    up_ = pose(torso=dict(hips=(0, -4, 0), spine=(-2, -4, 0), chest=(-4, -10, -3), head=(-4, -2, 0)), hips=(0, 0.01, -0.01),
               L=(0.30, 0.05, 0.70), Lp=(0.9, 0.2, 0.3))
    over = pose(torso=dict(hips=(-2, -10, 0), spine=(-4, -8, 0), chest=(-8, -16, -4), head=(-6, 4, 0)), hips=(0, 0.03, -0.01),
                L=(0.05, 0.30, 0.92), Lp=(0.9, 0.3, 0.3))
    throw = pose(torso=dict(hips=(4, 12, 0), spine=(6, 10, 0), chest=(10, 18, 2), neck=(-4, -4, 0), head=(-8, -10, 0)),
                 hips=(0, -0.05, -0.03), L=(-0.02, -0.96, 0.22), Lp=(0.9, 0.2, 0.3), fk=dict(hand_L=(-10, 0, 0)),
                 feet=_feet(l=(0.0, -0.12, 0.0), yl=6.0))
    fol = pose(torso=dict(hips=(5, 14, 0), spine=(7, 11, 0), chest=(11, 20, 2), neck=(-4, -6, 0), head=(-8, -12, 0)),
               hips=(0, -0.05, -0.035), L=(-0.12, -0.78, -0.38), Lp=(0.9, 0.3, -0.2), feet=_feet(l=(0.0, -0.12, 0.0), yl=6.0))
    k = [(0.0, G, "linear"), (0.10, take, "out"), (0.20, up_, "inout"), (0.30, over, "inout"),
         (0.35, anim.lerp_pose_w(over, throw, 0.30, {"hips": 0.6, "spine": 0.5, "chest": 0.4}), "in"),
         (0.40, throw, "accel"), (0.52, anim.lerp_pose(throw, fol, 0.5), "out"), (0.64, fol, "out"),
         (0.84, pose(L=_rel(GUARD_L, (0.0, -0.10, 0.05))), "inout"), (1.0, G, "settle")]
    out["cast_a3"] = clip("cast_a3", 25, k, impact=0.4, lags={"head": 1.0, "neck": 0.5})

    # CAST_ULT Gather In (castTime 0.4 s): he raises the staff overhead, the cup high, and sweeps the free arm out and
    # round in a wide inward arc (f0-f12, a held, breathing pose: the cup swings); at f16 the staff comes down and is
    # planted before him and both arms draw in to the chest: a hunched, drawn-in circle held to f30, then lowered
    raise_ = pose(torso=dict(hips=(-2, -6, 0), spine=(-4, -4, 0), chest=(-8, -8, 0), neck=(-4, 0, 0), head=(-10, -4, 0)),
                  hips=(0, 0.02, 0.0), R=(-0.20, -0.22, 0.92), aim=(-0.08, -0.10, 0.99), slide=-0.05,
                  L=(0.92, 0.05, 0.10), Lp=(0.5, 0.6, 0.4), fk=dict(hand_L=(0, 60, 0)), feet=_feet(l=(0.03, 0.0, 0.0), r=(-0.03, 0.0, 0.0)))
    sweep = pose(torso=dict(hips=(-2, 6, 0), spine=(-4, 5, 0), chest=(-8, 10, 0), neck=(-4, 0, 0), head=(-10, 4, 0)),
                 hips=(0, 0.02, 0.0), R=(-0.20, -0.25, 0.92), aim=(-0.08, -0.12, 0.99), slide=-0.05,
                 L=(0.55, -0.82, 0.12), Lp=(0.5, 0.4, -0.5), fk=dict(hand_L=(0, 60, 0)), feet=_feet(l=(0.03, 0.0, 0.0), r=(-0.03, 0.0, 0.0)))
    gath = pose(torso=dict(hips=(8, 0, 0), spine=(10, 0, 0), chest=(12, 0, 0), neck=(4, 0, 0), head=(6, 0, 0)),
                hips=(0, 0.03, -0.07), R=(-0.12, -0.62, -0.42), aim=(-0.04, -0.22, 0.97), slide=0.0,
                L=(0.06, -0.62, -0.30), Lp=(0.8, 0.5, -0.3), fk=dict(hand_L=(0, 40, 20)), feet=_feet(l=(0.04, 0.0, 0.0), r=(-0.04, 0.0, 0.0)))
    k = [(0.0, G, "linear"), (0.14, raise_, "inout"), (0.28, sweep, "inout"),
         (0.34, anim.lerp_pose_w(sweep, gath, 0.20, {"hips": 0.5, "spine": 0.4}), "in"),
         (0.40, gath, "accel"), (0.46, anim.lerp_pose(gath, gath, 1.0), "out"), (0.75, gath, "linear"),
         (0.90, pose(torso=dict(spine=(3, 0, 0), chest=(3, 0, 0)), L=_rel(GUARD_L, (0.0, -0.08, 0.04))), "inout"),
         (1.0, G, "settle")]
    ult_k = anim.keyed(k)

    def ult_s(t):
        p = dict(ult_k(t))
        if 0.40 < t < 0.75:                                  # the held gather breathes
            b = math.sin(2 * math.pi * (t - 0.40) / 0.35 * 1.5)
            p["chest"] = tuple(np.add(p["chest"], (1.2 * b, 0, 0)))
        return p
    out["cast_ult"] = anim.Clip("cast_ult", 40, False, anim.drag(ult_s, 40, {"head": 1.0}), impact=0.4)

    # DEATH: the blow rocks him back, the knees give, he sinks to his knees and lowers the staff to lie on the ground
    # before him (the hand still on it), then slumps forward, head bowed (ends at rest)
    hip_h = skel.rest_point("hips").z
    hit = pose(torso=dict(hips=(-4, 3, 0), spine=(-4, 0, 2), chest=(-5, 3, 3), neck=(-2, 0, 0), head=(-8, 5, 4)),
               hips=(0, 0.03, -0.02))
    kfeet = _feet(l=(-0.02, 0.17, 0.035), r=(0.02, 0.18, 0.035), yl=4.0, yr=-6.0, pl=-62.0, pr=-62.0)
    sink = pose(torso=dict(hips=(6, 3, 0), spine=(6, 0, 3), chest=(6, 3, 4), neck=(6, 0, 0), head=(10, 4, 4)),
                hips=(0.01, 0.05, -(hip_h - 0.33)), R=(-0.40, -0.75, -0.55), aim=(-0.30, -0.80, 0.52),
                L=(0.10, -0.40, -0.80), feet=kfeet)
    down = pose(torso=dict(hips=(6, 3, 0), spine=(6, 0, 3), chest=(4, 3, 4), neck=(6, 0, 0), head=(12, 6, 6)),
                hips=(0.02, 0.10, -(hip_h - 0.27)), R=(-0.20, -0.95, -0.55), aim=(0.70, -0.70, 0.02), slide=0.10,
                L=(0.05, -0.62, -0.72), feet=kfeet)
    slump = pose(torso=dict(hips=(8, 4, 2), spine=(7, 0, 4), chest=(5, 3, 4), neck=(8, 0, 2), head=(16, 8, 8)),
                 hips=(0.02, 0.12, -(hip_h - 0.25)), R=(-0.18, -0.92, -0.62), aim=(0.72, -0.69, 0.0), slide=0.10,
                 L=(0.06, -0.66, -0.72), feet=kfeet)
    k = [(0.0, G, "linear"), (0.10, hit, "out"), (0.30, sink, "inout"), (0.52, down, "in"),
         (0.66, slump, "out"), (0.78, anim.lerp_pose(slump, down, 0.25), "inout"), (0.90, slump, "inout"), (1.0, slump, "linear")]
    out["death"] = clip("death", 50, k)

    # RECALL: the staff drawn in so the cup hangs before his chest, both hands round it (the left cupped under it,
    # the right steadying the staff), the head bowed to breathe on it (loops)
    rc0 = pose(torso=dict(spine=(4, 0, 0), chest=(4, 8, 0), neck=(6, 0, 0), head=(10, 8, 0)), R=(-0.12, -0.62, -0.35),
               aim=(0.42, -0.40, 0.81))
    cp = cup_at(rc0)
    cupL = cp + V((0.0, 0.0, -0.21))
    rc = pose(torso=dict(spine=(4, 0, 0), chest=(4, 8, 0), neck=(6, 0, 0), head=(10, 8, 0)), R=(-0.12, -0.62, -0.35),
              aim=(0.42, -0.40, 0.81), Lpos=tuple(cupL), Lp=(0.9, 0.2, -0.3), fk=dict(hand_L=(-20, 60, 20)))
    scene.log(f"sukri recall: cup core at {tuple(round(v, 3) for v in cp)}")

    def recall_s(t):
        p = dict(rc)
        b = math.sin(2 * math.pi * 2 * t)
        p["chest"] = (4 + 0.8 * b, 8, 0)
        p["head"] = (10 + 1.5 * math.sin(2 * math.pi * t), 8, 0)
        return p
    out["recall"] = anim.Clip("recall", 60, True, recall_s)

    # CHANNEL: the staff held forward, the cup raised before him, the free hand open toward it (loops)
    ch = pose(torso=dict(chest=(2, 3, 0), head=(-3, -2, 0)), R=(-0.30, -0.70, -0.20), aim=(-0.05, -0.40, 0.92),
              L=(0.30, -0.75, -0.30), Lp=(0.8, 0.3, -0.4), fk=dict(hand_L=(0, 60, 0)))

    def channel_s(t):
        b = math.sin(2 * math.pi * 2 * t)
        return anim.add(ch, P_(chest=(1.2 * b, 0, 0), head=(-0.8 * b, 0, 0)))
    out["channel"] = anim.Clip("channel", 30, True, channel_s)

    # DASH: a rolling scurry low over the ground, the staff carried forward, the feet sliding (no step)
    gl = pose(torso=dict(hips=(12, 0, 0), spine=(8, 0, 0), chest=(6, 0, 0), neck=(-8, 0, 0), head=(-8, 0, 0)),
              hips=(0, -0.05, -0.05), R=_rel(GUARD_R, (0.0, -0.25, 0.10)), aim=(-0.05, -0.55, 0.83),
              L=_rel(GUARD_L, (0.0, 0.20, 0.10)), feet=_feet(l=(0.0, -0.10, 0.0), r=(0.0, 0.10, 0.0), pr=-14.0))
    out["dash"] = clip("dash", 15, [(0.0, G, "linear"), (0.25, gl, "snap"), (0.75, gl, "linear"), (1.0, G, "inout")])

    # STUNNED: staggers, clutching the staff, the cup swinging wildly, the head lolling (loops)
    st = pose(torso=dict(spine=(3, 0, 0), chest=(4, 0, 0), neck=(2, 0, 0), head=(5, 0, 0)), hips=(0, 0.02, -0.03),
              R=_rel(GUARD_R, (0.04, -0.10, 0.10)), aim=UP, L=_rel(GUARD_L, (0.05, 0.0, 0.10)))

    def stun_s(t):
        a, b = math.sin(2 * math.pi * t), math.sin(2 * math.pi * (t + 0.25))
        p = anim.add(st, P_(hips=(0, 0, 3 * a), spine=(1 * b, 0, -2 * a), chest=(2 * b, 0, -3 * a), neck=(4 * b, 0, 4 * a),
                            head=(5 * b, 6 * a, 5 * a)))
        p["hips_loc"] = (0.03 * a, 0.02 * b, p["hips_loc"][2])
        ik = dict(p["ik"])
        ik["aim.R"] = Aim((UP[0] - 0.20 * a, UP[1] + 0.15 * b, 0.96))
        ik["foot.L"] = FootTarget((0.03 * a, 0.0, 0.0), 0.0, 0.0, 0.0, 0.0, 1.0)
        ik["foot.R"] = FootTarget((0.03 * a, 0.0, 0.0), 0.0, 0.0, 0.0, 0.0, 1.0)
        p["ik"] = ik
        return p
    out["stunned"] = anim.Clip("stunned", 30, True, stun_s)

    # TAUNT: raises the cup and clinks it against the staff (a knock twice: a clear glass note), then a slow nod
    tu = pose(torso=dict(chest=(-2, -4, -2), head=(-4, 6, 0)), R=_rel(GUARD_R, (0.04, -0.18, 0.40)), aim=(-0.05, -0.15, 0.99))
    tt = pose(torso=dict(chest=(-2, -4, -2), head=(-4, 6, 0)), R=_rel(GUARD_R, (0.04, -0.18, 0.36)), aim=(0.10, -0.15, 0.98))
    tt["x_cup_hook"] = (0.0, 0.0, -14.0)
    nod = pose(torso=dict(chest=(2, 2, 0), neck=(5, 0, 0), head=(10, 2, 0)))
    k = [(0.0, G, "linear"), (0.16, tu, "inout"), (0.24, tt, "accel"), (0.32, tu, "out"), (0.40, tt, "accel"),
         (0.52, tu, "out"), (0.72, nod, "inout"), (1.0, G, "inout")]
    out["taunt"] = clip("taunt", 45, k)

    # IDLE_LOBBY (120 f, loops): patient and kind: he pauses on the road, turns his head to check that nobody has
    # fallen behind, counts the people he can see with the crook (three small taps of the crook toward them), finds the
    # number right (a nod), sets off a step and stops again; the cup swings and settles
    look = pose(torso=dict(hips=(0, 8, 0), spine=(0, 10, 0), chest=(-2, 18, 0), neck=(-2, 20, 0), head=(-4, 26, 0)),
                hips=(0.0, 0.0, -0.004), L=_rel(GUARD_L, (0.0, 0.06, 0.0)))
    cnt = lambda a, dz: pose(torso=dict(chest=(-1, -6, 0), neck=(-2, -6, 0), head=(-4, -8 + a, 0)),  # noqa: E731
                             R=_rel(GUARD_R, (0.05, -0.32, 0.18 + dz)), aim=(0.10 + a * 0.012, -0.60, 0.79))
    nodp = pose(torso=dict(chest=(2, -2, 0), neck=(6, 0, 0), head=(10, 0, 0)), R=_rel(GUARD_R, (0.0, -0.10, 0.06)),
                aim=(-0.04, -0.20, 0.98))
    step = pose(torso=dict(hips=(3, 0, 2), spine=(2, 0, 0), chest=(1, 0, 0)), hips=(0.02, -0.06, 0.0),
                R=_rel(GUARD_R, (0.0, -0.16, 0.08)), aim=(-0.06, -0.35, 0.93),
                L=_rel(GUARD_L, (0.0, 0.12, 0.04)), feet=_feet(l=(0.0, -0.14, 0.0), yl=2.0))
    k = [(0.0, G, "linear"), (0.08, G, "linear"), (0.18, look, "inout"), (0.30, look, "linear"),
         (0.38, cnt(0, 0.00), "inout"), (0.43, cnt(10, 0.06), "out"), (0.47, cnt(10, 0.00), "inout"),
         (0.51, cnt(20, 0.06), "out"), (0.55, cnt(20, 0.00), "inout"), (0.59, cnt(30, 0.06), "out"),
         (0.63, cnt(30, 0.00), "inout"), (0.70, nodp, "inout"), (0.76, G, "inout"), (0.84, step, "inout"),
         (0.90, step, "linear"), (1.0, G, "inout")]
    out["idle_lobby"] = anim.Clip("idle_lobby", 120, True, breathe(anim.keyed(k), 0.8, 4))

    # VICTORY (50 f, ends in a hold): he plants the staff, leans it in toward his shoulder so the cup comes round
    # before him at chest height, and holds his open left hand under it: offering a drink of noon; the hood turned a
    # quarter toward the cup
    lean = pose(torso=dict(chest=(-2, 0, 0)), R=_rel(GUARD_R, (0.02, 0.0, -0.04)), aim=UP, hips=(0, 0, -0.01))
    VT = dict(hips=(2, -6, 0), spine=(3, -8, 0), chest=(4, -12, 0), neck=(2, 6, 0), head=(6, 14, 4))
    VR, VA, VS = (0.22, -0.78, -0.18), (0.55, -0.50, 0.67), -0.30
    off0 = pose(torso=VT, R=VR, aim=VA, slide=VS)
    cpv = cup_at(off0)
    offer = pose(torso=VT, R=VR, aim=VA, slide=VS, Lpos=tuple(cpv + V((0.03, 0.02, -0.17))),
                 Lp=(0.9, 0.2, -0.3), fk=dict(hand_L=(-15, 70, 15)))
    scene.log(f"sukri victory: cup core at {tuple(round(v, 3) for v in cpv)}")
    k = [(0.0, G, "linear"), (0.16, lean, "inout"), (0.50, offer, "inout"), (0.70, offer, "linear"), (1.0, offer, "linear")]
    vic = anim.keyed(k)

    def vic_s(t):
        p = dict(vic(t))
        if t > 0.72:
            b = math.sin(2 * math.pi * 1.5 * t)
            p["chest"] = tuple(np.add(p["chest"], (0.6 * b, 0, 0)))
        return p
    out["victory"] = anim.Clip("victory", 50, False, vic_s)
    return out


if __name__ == "__main__":
    fighter.main(sys.modules[__name__])
