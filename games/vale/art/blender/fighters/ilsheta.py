"""ilsheta: Lamp hanger (Tender, Aubade). ART 2.0: sculpted volumes painted by concept projection.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/ilsheta_plates.py      # plates (own cut)
    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/ilsheta_fit.py         # silhouette + pose check
    python3 art/build.py fighter ilsheta --no-skins [--fast] [--clip-sheet]

Brief: _design/fighters/ilsheta.md. Concept: _design/concept/ilsheta.webp (front + back, hand-painted).
The forms are numpy SDF volumes (common/hifi/sdf.py) fitted to the concept on a 10 cm grid; the base colour is
the concept painting itself, projected occlusion-aware onto the game mesh (common/hifi/project.py); normals and
AO bake from the sculpt.

Where the concept and the brief disagree the concept's FORMS and MATERIAL COLOURS win (the approved look): the
pale cream mantle fading to slate blue at the hem, the dark slate gloves and boots, the chalk face-plate with its
carved swirls, the clear chimney painted as clear glass (the concept paints the backdrop through it). The brief
wins on the props and the read: the hook-staff is the brief's 0.96 m (the concept's 1.35 m walking staff could not
be carried at the chest without passing through the bell), held in the RIGHT hand; the lamp hangs from its hook on
x_lamp, kept plumb in every pose (a resolve wrapper), with its accent flame core seen through an open glass cage.
SENSITIVITY: the concept's hood rises to a pale point round the chimney; here the hood's crown is a rounded dome
closed by a linen collar round the glass, so no pale pointed hood reads from any side.
The pipeline hooks this module wraps for its own build (common/ is shared): part binding (per-part weight
functions), the projection paint (props, gloves and the lamp painted here; the hollow mantle's lining darkened),
the AO bake (props moved out of the body's occlusion), the skin re-colour (the mantle's cream -> slate gradient
graded by height) and the portrait / icon framing (the chimney's top in frame).
"""
from __future__ import annotations

import math
import os
import sys
from dataclasses import dataclass

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy  # noqa: E402,F401
import numpy as np  # noqa: E402

from common import anim, fighter, materials, rig, scene  # noqa: E402
from common import bake as _bake  # noqa: E402
from common import mesh as _mesh  # noqa: E402
from common import pipeline as _pipeline  # noqa: E402
from common.hifi import project as _project  # noqa: E402
from common.hifi import sdf  # noqa: E402
from common.hifi.sdf import (Capsule, Ellipsoid, FlatCapsule, Lathe, Prim, RoundBox, RoundCone,  # noqa: E402
                             Sculpt, Sphere, Torus, Tube)

ID = "ilsheta"
TITLE = "Lamp hanger"
ROLE_MASS = "tender"
ORIGIN = "aubade"
CARD = {"primary": "#C9D3D6", "secondary": "#E8E2D2"}
FRONT = np.array([0.0, -1.0, 0.0])


def unit(v):
    v = np.asarray(v, dtype=np.float64)
    return v / max(float(np.linalg.norm(v)), 1e-12)


def ss(a, b, x):
    t = np.clip((np.asarray(x, dtype=np.float64) - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _rot(axis, deg, v):
    axis = unit(axis)
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    v = np.asarray(v, dtype=np.float64)
    return v * c + np.cross(axis, v) * s + axis * float(axis @ v) * (1 - c)


# ── rig fitted to the concept (plates: 771 px/m, the chimney's top 1.72): the head inside the hood (crown 1.47,
#    skull base 1.24), shoulder joints x 0.16 at 1.04 under the mantle, short arms in the bell sleeves (wrists at the
#    painted cuffs ~(0.37, 0.78)), hips 0.62, knees 0.35, ankles x 0.088 at 0.08 (the painted boots) ──────────────────
PROPORTIONS = rig.proportions(height=1.47, head=0.27, neck=0.05, shoulder_width=0.32, hip_width=0.17, leg=0.54001,
                              thigh_frac=0.5, arm=0.36, upper_arm_frac=0.5, hand=0.15, foot=0.24, ankle_height=0.08,
                              spine_curve=0.0, stance=0.003, toe_out_deg=7.0, knee_bend=0.012, a_pose_deg=50.0,
                              arm_forward_deg=8.0, elbow_bend_deg=14.0, shoulder_drop=0.148)


def _layout() -> dict:
    """rig._layout in numpy (the joints the sculpt is fitted to; mathutils is not needed)"""
    p = PROPORTIONS
    H = p["height"]
    hx = p["hip_width"] / 2
    ax = hx + p["stance"]
    z_hip = p["ankle_height"] + math.sqrt(max(1e-6, p["leg"] ** 2 - (ax - hx) ** 2))
    y0, sc = p["pelvis_depth"], p["spine_curve"]
    z_head = H - p["head"] * 0.86
    z_neck = z_head - p["neck"]
    J = {"neck_base": np.array([0, y0 - sc + 0.012, z_neck]), "head_base": np.array([0, y0 - sc + 0.004, z_head])}
    hip = np.array([hx, y0 + 0.005, z_hip])
    ankle = np.array([ax, y0 + 0.02, p["ankle_height"]])
    knee = hip + (ankle - hip) * p["thigh_frac"] + np.array([0, -p["knee_bend"], 0])
    to = math.radians(p["toe_out_deg"])
    fwd = np.array([math.sin(to), -math.cos(to), 0.0])
    gnd = np.array([ankle[0], ankle[1], 0.0])
    J.update({"hip": hip, "knee": knee, "ankle": ankle, "ball": gnd + fwd * p["foot"] * 0.5 + [0, 0, p["foot"] * 0.07],
              "toe": gnd + fwd * p["foot"] * 0.74 + [0, 0, p["foot"] * 0.05], "heel": gnd - fwd * p["foot"] * 0.26,
              "foot_fwd": fwd})
    sh = np.array([p["shoulder_width"] / 2, J["neck_base"][1] + 0.018, z_neck - p["shoulder_drop"]])
    a, fw = math.radians(p["a_pose_deg"]), math.radians(p["arm_forward_deg"])
    d1 = unit([math.cos(a) * math.cos(fw), -math.cos(a) * math.sin(fw), -math.sin(a)])
    elbow = sh + d1 * p["arm"] * p["upper_arm_frac"]
    zf = unit(FRONT - d1 * float(FRONT @ d1))
    d2 = unit(_rot(np.cross(d1, zf), p["elbow_bend_deg"], d1))
    wrist = elbow + d2 * p["arm"] * (1 - p["upper_arm_frac"])
    J.update({"shoulder": sh, "elbow": elbow, "wrist": wrist, "d1": d1, "d2": d2})
    return J


LAY = _layout()


def side_pt(name, s):
    v = LAY[name].copy()
    if s == "R":
        v[0] = -v[0]
    return v


def hand_frame(s):
    """the rest hand bone frame (align_roll FRONT): f = the fingers (bone +Y), n = the palm's normal (-bone Z),
    t = the thumb's side (right: f x n, left: n x f)"""
    f = side_pt("d2", s)
    z = unit(FRONT - f * float(FRONT @ f))
    n = -z
    t = np.cross(f, n) if s == "R" else np.cross(n, f)
    return f, n, unit(t)


WR = {s: side_pt("wrist", s) for s in "LR"}
SHJ = {s: side_pt("shoulder", s) for s in "LR"}
HF = {s: hand_frame(s) for s in "LR"}
# the right hand's REST frame is the fist upright (thumb up, knuckles forward): rig_extras turns hand.R to it, so the
# bind pose already holds the staff upright at her side with the lamp beside her shoulder (the skins' QA and any
# bind-pose view show the bind pose; the rig's own A-pose hand put the staff out like a broom and the lamp in the bell)
_fR = unit((-0.25, -0.97, 0.0))
_tR = np.array([0.0, 0.0, 1.0])
HF["R"] = (_fR, unit(np.cross(_tR, _fR)), _tR)


def hpt(s, a, b, c):
    """a point in the rest hand frame: a along the fingers, b along the palm's normal, c toward the thumb"""
    f, n, t = HF[s]
    return WR[s] + f * a + n * b + t * c


# ── the hook-staff (brief: 0.96 m of pale carved ash, the hook bending forward 0.12 m) and the lamp ────────────
#    staff frame: origin the grip's centre in the right fist, U up the shaft (the thumb's side), K the hook's side (the
#    knuckles), V = U x K. Grip in the fist: 6.8 cm along the fingers, 3.6 cm off the palm.
GRIP_AB = (0.068, 0.036)
S_BUTT, S_TOP = -0.46, 0.24      # fix pass 1: 0.86 m (was 1.0; the butt went through the bell when the staff tipped)
SHAFT_R = 0.020
# fix pass 1: the concept's carved, ANGULAR open loop (not a smooth J): the shaft kinks out, rises to a flat top bar,
# drops on the far side and stops short of the shaft (open); the lamp hangs from the top bar's far corner
HOOK = [(0.0, 0.24), (-0.012, 0.300), (-0.004, 0.352), (0.030, 0.398), (0.098, 0.404), (0.132, 0.364),
        (0.128, 0.318), (0.100, 0.290)]
HOOK_R = [0.019, 0.018, 0.0175, 0.017, 0.016, 0.0155, 0.0145, 0.013]
HANG_UK = (0.098, 0.392)          # under the top bar's far corner: the lamp's pivot (x_lamp's head)
LAMP_DROP = 0.378                 # the pivot -> the finial's tip
C0 = hpt("R", GRIP_AB[0], GRIP_AB[1], 0.0)
U0 = HF["R"][2].copy()
K0 = HF["R"][0].copy()
V0 = np.cross(U0, K0)


def spt(u, k=0.0, v=0.0):
    return C0 + U0 * u + K0 * k + V0 * v


HANG0 = spt(HANG_UK[1], HANG_UK[0])
# the lamp at rest hangs straight down from HANG0 (dz down); its front faces -Y. Fix pass 1: a FLAME in clear glass
# (the review: the 14 x 19 cm core filled the cage and read as a blue potion): a 21 cm open cage of four thin ribs,
# a 12.6 x 18 cm teardrop flame on a chalk burner with 4 cm of empty glass round it and 4.5 cm above its tip, and
# a solid glass font bowl under the flame (the glass mass that reads as glass: Stillwater's sea-glass)
LAMP = {"ring": 0.010, "stem": (0.020, 0.036), "knob": 0.038, "cap": (0.042, 0.066), "glass": (0.066, 0.300),
        "base": (0.300, 0.326), "finial": (0.326, LAMP_DROP)}
GLASS_R = [(0.066, 0.058), (0.090, 0.076), (0.130, 0.095), (0.175, 0.106), (0.220, 0.108), (0.262, 0.101), (0.300, 0.087)]
FLAME = (0.222, 0.066, 0.100)     # the flame's bulb centre (dz), its radius, the tip's dz (brief: a 12 x 18 cm flame)
FONT = (0.258, 0.300)             # the glass font bowl (dz top, bottom)


def lpt(dz, x=0.0, y=0.0):
    return HANG0 + np.array([x, y, -dz])


# ── materials ────────────────────────────────────────────────────────────────────────────────────────────────
# the base palette is the CONCEPT's measured paint (the skin re-colour scales the painting by skin / base per role);
# extra roles: cloth3 (the slate hem and the sash), lampglass (the lamp's glass: Stillwater turns it sea-glass),
# reed (Stillwater's reed plates); extra_materials() makes them
MATERIAL_SET = "bible"
PALETTE = materials.bible_palette(cloth2="#D6CCBE", chalk="#D2CDC4", cloth="#6E7C8A", cloth3="#4E535C",
                                  wood="#BCAE98", leather="#33363E", under="#23262E", ironstone="#47443F",
                                  ink="#17181B", dawnglass="#C9D6DC", lampglass="#BFD3DE", reed="#8E9672",
                                  accent="#3F9CFF")
VALUE_GRADIENT_STOPS = materials.BIBLE_GRADIENT_STOPS
SOCKETS = {"weapon": "prop.R", "weapon_tip": "x_lamp", "visor_top": "x_chimney_top"}
# fix pass 1: the darker Aubade backdrop (aubade_dusk, this module's plate grade), the warm rim down (it bled over the
# right edge), a softer sun on the pale linen; the skins pose their own splash (they were the same frame)
SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92, "portrait_clip": "idle_lobby", "portrait_t": 0.0,
          "portrait_yaw": 28.0, "icon_yaw": 20.0, "yaw": 40.0, "fill": 0.86, "rim_warm": 0.25, "rim_cool": 0.85,
          "sun": 2.5, "aubade_dusk": 0.50}
TEXTURE_SIZE = 2048
TEXTURE_SIZES = {"normal": 512, "orm": 512}
GLB_COMPRESS = True
ARMOUR_CONFORM = False
AO_INTO_BASE = 0.25
SKINS: list = [
    {"id": "ilsheta_stillwater", "extra": {"reed_plates": True}, "card": {"primary": "#59666A", "secondary": "#8FB3A8"},
     "palette": {"cloth2": "#C4CFD3", "chalk": "#C9CFCB", "cloth": "#59666A", "cloth3": "#434F53", "wood": "#B7A98F",
                 "lampglass": "#8FB3A8", "reed": "#8E9672"},
     "splash": {"clip": "idle_lobby", "t": 0.60, "yaw": 34.0}},
    {"id": "ilsheta_first_bell", "extra": {"glass_bell": True, "hour_marks": True},
     "card": {"primary": "#3A3633", "secondary": "#CFCAC0"},
     "palette": {"cloth2": "#CFCAC0", "chalk": "#D4CEBF", "cloth": "#8C8780", "cloth3": "#3A3633"},
     "splash": {"clip": "cast_ult", "t": 0.52, "yaw": 18.0, "fill": 0.84}},
]
SKIN_FLAT = {"reed_plates": "reed", "glass_bell": "dawnglass", "hour_marks": "chalk"}
HEIGHT = 1.72             # the plates' scale: the chimney's top rim (content art.height)
PROJECTION = {"concept": "ilsheta", "height": HEIGHT}
NOISE = sdf.Noise(23)
VOXEL = 0.0058

# ── measured forms (m) ─────────────────────────────────────────────────────────────────────────────────────────
# fix pass 1 (the review: an opaque ceramic stovepipe on the hood, the face outside it): THE CHIMNEY IS THE VISOR,
# one glass body from the chin to the 1.72 rim that holds the face: the flare (0.24 m at the cheek) sits in the hood's
# opening IN FRONT of the hood with the face painted inside it (the concept paints the mask THROUGH the glass, the
# projection carries it), its front pushed out into a beak (the facing cue from above); above the hood it narrows to
# the 0.15 m chimney, painted as clear cool dawnglass (catch-light streaks, darker turning sides, a bright lip)
CHIM_C = (0.0, -0.046)            # the chimney's axis (x, y)
CHIM_R = [(1.178, 0.098), (1.200, 0.112), (1.230, 0.119), (1.270, 0.122), (1.320, 0.119), (1.370, 0.110),
          (1.420, 0.098), (1.460, 0.088), (1.500, 0.080), (1.540, 0.075), (1.580, 0.073), (1.620, 0.073),
          (1.660, 0.075), (1.690, 0.078), (1.710, 0.082), (1.720, 0.083)]
CHIM_BEAK = [(1.178, 0.012), (1.230, 0.022), (1.290, 0.024), (1.350, 0.018), (1.420, 0.007), (1.470, 0.0), (1.72, 0.0)]
CHIM_BOT, CHIM_TOP = 1.178, 1.72
MASK_C = (0.0, -0.083, 1.330)     # the painted face inside the glass (the concept's mask: the paint's face zone)
MASK_R = (0.088, 0.062, 0.118)
# the hood: lofted sections (z, half width, front y, back y); a rounded crown hugging the glass (never a point)
HOOD_S = [(1.165, 0.200, -0.150, 0.205), (1.19, 0.197, -0.152, 0.207), (1.22, 0.182, -0.153, 0.207),
          (1.26, 0.162, -0.153, 0.203), (1.30, 0.146, -0.153, 0.198), (1.34, 0.136, -0.150, 0.190),
          (1.38, 0.128, -0.145, 0.178), (1.42, 0.120, -0.136, 0.160), (1.45, 0.112, -0.126, 0.138),
          (1.47, 0.103, -0.118, 0.114), (1.488, 0.090, -0.110, 0.088), (1.50, 0.078, -0.104, 0.064)]
HOOD_OPEN = (0.124, 1.316, 0.156)       # the face opening: half width, centre z, half height (front, y < -0.03)
COLLAR = (1.488, 0.091, 0.021)          # z, ring radius, tube radius (the linen roll round the glass)
# the mantle: a bell shell lofted from sections (z, half width, front y, back y), open at the front and the hem
MANTLE_S = [(1.16, 0.150, -0.118, 0.140), (1.10, 0.182, -0.136, 0.160), (1.05, 0.206, -0.150, 0.178),
            (1.00, 0.228, -0.160, 0.192), (0.95, 0.250, -0.168, 0.204), (0.90, 0.268, -0.176, 0.214),
            (0.80, 0.290, -0.190, 0.234), (0.70, 0.308, -0.205, 0.255), (0.60, 0.342, -0.226, 0.284),
            (0.50, 0.390, -0.256, 0.318), (0.45, 0.422, -0.272, 0.334), (0.40, 0.452, -0.288, 0.350),
            (0.36, 0.464, -0.296, 0.360), (0.30, 0.466, -0.298, 0.364)]
MANTLE_T = 0.022
MANTLE_TOP = 1.155
HEM_Z = 0.337
OPEN_W = [(1.16, 0.060), (1.05, 0.070), (0.90, 0.078), (0.70, 0.086), (0.50, 0.096), (0.32, 0.106)]
FOLD_N, FOLD_PH = 7, 0.55
MANTLE_BONES = {"x_mantle_l": ((0.115, -0.168, 0.985), (0.245, -0.262, 0.430)),
                "x_mantle_r": ((-0.115, -0.168, 0.985), (-0.245, -0.262, 0.430))}


def _interp(table, z, col):
    zs = np.array([r[0] for r in table])
    vs = np.array([r[col] for r in table])
    if zs[0] > zs[-1]:
        zs, vs = zs[::-1], vs[::-1]
    return np.interp(z, zs, vs)


class Fn(Prim):
    """a custom distance function with explicit bounds"""

    def __init__(self, fn, lo, hi):
        self.fn, self.lo, self.hi = fn, np.asarray(lo, float), np.asarray(hi, float)

    def bounds(self):
        return self.lo, self.hi

    def d(self, P):
        return self.fn(P)


def loft_d(P, table):
    """distance to a lofted body of elliptic sections (half width X, front y Yf < 0, back y Yb > 0 at each z):
    the first-order distance of the section ellipse, corrected for the profile's slope"""
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    X = _interp(table, z, 1)
    Yf = -_interp(table, z, 2)
    Yb = _interp(table, z, 3)
    Y = np.where(y < 0, Yf, Yb)
    q = np.sqrt((x / X) ** 2 + (y / Y) ** 2)
    g = np.sqrt((x / X ** 2) ** 2 + (y / Y ** 2) ** 2) / np.maximum(q, 1e-6)
    d2 = (q - 1.0) / np.maximum(g, 1e-6)
    dz = 0.01
    dX = (_interp(table, z + dz, 1) - _interp(table, z - dz, 1)) / (2 * dz)
    return d2 / np.sqrt(1.0 + dX * dX)


def fold_disp(P, amp_fn, n=FOLD_N, ph=FOLD_PH):
    th = np.arctan2(P[:, 1], P[:, 0])
    a = amp_fn(P, th)
    w = np.sin(n * th + ph + 0.7 * NOISE(P, 2.5))
    return -a * (0.5 + 0.5 * w)


def _front_fade(th, lo=0.40, hi=0.75):
    """0 at the front (theta = -90 deg) where the panels open, 1 away from it"""
    dth = np.abs(np.angle(np.exp(1j * (th + math.pi / 2))))
    return ss(lo, hi, dth)


def mantle_amp(P, th):
    """the folds: 2 cm below the arms round the front panels, and (fix pass 1: the back was a smooth blank shell) long
    drape folds down the back from the shoulder blades, as the concept's back view paints them"""
    z = P[:, 2]
    low = 0.020 * ss(0.86, 0.42, z) * _front_fade(th)
    drape = 0.014 * ss(1.10, 0.92, z) * ss(0.10, 0.55, np.sin(th))
    return np.maximum(low, drape)


def hem_z(P):
    th = np.arctan2(P[:, 1], P[:, 0])
    back = -0.018 * np.sin(th)                      # the back hangs lower (the concept: 0.32 behind, 0.355 in front)
    return HEM_Z + back + 0.011 * np.sin(FOLD_N * th + FOLD_PH + math.pi) * _front_fade(th) * 0.9


def mantle_d(P):
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    d = loft_d(P, MANTLE_S) + fold_disp(P, mantle_amp)
    th = np.arctan2(y, x)
    hz = hem_z(P)
    d = d - 0.0045 * ss(hz + 0.045, hz + 0.02, z) * ss(hz - 0.01, hz + 0.004, z)       # the rolled hem band
    w = _interp(OPEN_W, z, 1)
    d = d - 0.0035 * ss(w + 0.030, w + 0.012, np.abs(x)) * ss(-0.02, -0.06, y)            # the rolled front edges
    shell = np.maximum(d, -(d + MANTLE_T))
    shell = sdf.smax(shell, hz - z, 0.006)
    shell = sdf.smax(shell, z - MANTLE_TOP, 0.01)
    opening = np.maximum(np.abs(x) - w, y + 0.03)
    shell = sdf.smax(shell, -opening, 0.006)
    return shell


def hood_d(P):
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    d = loft_d(P, HOOD_S)
    d = d + fold_disp(P, lambda P_, th: 0.006 * ss(1.40, 1.22, P_[:, 2]) * ss(0.2, 0.9, np.sin(th)), n=6, ph=0.3)
    d = sdf.smax(d, z - HOOD_S[-1][0], 0.03)
    d = sdf.smax(d, HOOD_S[0][0] - z, 0.004)
    ow, oz, oh = HOOD_OPEN
    q = np.sqrt((x / ow) ** 2 + ((z - oz) / oh) ** 2)
    tun = np.maximum((q - 1.0) * min(ow, oh), y + 0.035)
    return sdf.smax(d, -tun, 0.010)


CHIM_S = [(z, r, -(r + float(np.interp(z, [b[0] for b in CHIM_BEAK], [b[1] for b in CHIM_BEAK]))), r) for z, r in CHIM_R]


def chim_d(P):
    """the glass: elliptic sections round the axis (the front pushed out into the beak at the face), a rounded chin,
    the open top a 5 cm deep well inside the rim"""
    cx, cy = CHIM_C
    Q = P - np.array([cx, cy, 0.0])
    z = Q[:, 2]
    d = loft_d(Q, CHIM_S)
    d = sdf.smax(d, CHIM_BOT - z, 0.010)
    d = np.maximum(d, z - CHIM_TOP)
    r = np.hypot(Q[:, 0], Q[:, 1])
    well = np.maximum(r - (_interp(CHIM_R, z, 1) - 0.0075), 1.668 - z)
    return np.maximum(d, -well)


def folds(amp, freq, axis=0, phase=0.0, zfade=None):
    def fn(P):
        u = P[:, axis] * freq + phase + 0.6 * NOISE(P, 3.0)
        a = amp
        if zfade is not None:
            z0, z1 = zfade
            a = amp * np.clip((z0 - P[:, 2]) / (z0 - z1), 0.15, 1.0)
        return a * (np.abs(np.sin(u)) * 2.0 - 1.0) * -0.5
    return fn


def wraps(amp, pitch, a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    ax = unit(b - a)

    def fn(P):
        s = (P - a) @ ax
        return -amp * (0.5 + 0.5 * np.cos(2 * math.pi * s / pitch + 0.8 * NOISE(P, 6.0)))
    return fn


# ── hands (the right a fist round the shaft, the left a relaxed open cup; gloved, sculpted fingers) ────────────
def hand_parts(s: str) -> Sculpt:
    f, n, t = HF[s]
    S = Sculpt(f"hand_{s}")
    ax = np.stack([f, n, t])
    S.add(RoundBox(hpt(s, 0.044, 0.0, 0.0), (0.040, 0.019, 0.037), 0.015, axes=ax), k=0.0)
    S.add(Ellipsoid(hpt(s, 0.046, -0.008, 0.0), (0.044, 0.016, 0.036), axes=ax), k=0.012)
    S.add(FlatCapsule(hpt(s, -0.055, 0.0, 0.0), hpt(s, 0.012, 0.0, 0.0), 0.034, 0.028, 0.036, 0.024, side=t), k=0.012)
    S.add(Torus(hpt(s, -0.030, 0.0, 0.0), 0.030, 0.006, axes=sdf.frame(f), rz=0.005), k=0.004)   # the glove's cuff seam
    if s == "R":
        ca, cb = GRIP_AB
        R = 0.034
        for c, rr, a1 in ((0.026, 0.0115, 150.0), (0.0085, 0.0120, 152.0), (-0.0085, 0.0112, 148.0), (-0.0245, 0.0098, 136.0)):
            pts = [hpt(s, 0.072, 0.004, c)] + [hpt(s, ca + R * math.cos(math.radians(p)), cb + R * math.sin(math.radians(p)), c)
                                               for p in (-52.0, 0.0, 52.0, 102.0, a1)]
            S.add(Tube(pts, [rr * 1.05, rr * 1.08, rr, rr * 0.96, rr * 0.9, rr * 0.85], k=0.006), k=0.006)
            S.add(Sphere(hpt(s, ca + R * math.cos(math.radians(-22)), cb + R * math.sin(math.radians(-22)), c), rr * 1.12), k=0.006)
        S.add(Tube([hpt(s, 0.018, 0.010, 0.034), hpt(s, 0.044, 0.040, 0.046), hpt(s, 0.072, 0.074, 0.034),
                    hpt(s, 0.092, 0.074, 0.018)], [0.0150, 0.0135, 0.0120, 0.0105], k=0.006), k=0.008)
    else:
        # the left hand OPEN (fix pass 1: the curled cup read as a pointing claw in the palms-out push and the
        # palm-up release): long fingers barely curled, a little spread, the thumb out
        for c, L, rr in ((0.030, 0.074, 0.0112), (0.010, 0.080, 0.0118), (-0.010, 0.075, 0.0110), (-0.030, 0.060, 0.0098)):
            k0 = np.array([0.080, 0.002])
            pts = [hpt(s, 0.066, 0.002, c * 0.9)]
            ang = 0.0
            cur = k0.copy()
            pts.append(hpt(s, cur[0], cur[1], c))
            for frac, dang in ((0.42, 6.0), (0.33, 10.0), (0.25, 14.0)):
                ang += dang
                cur = cur + L * frac * np.array([math.cos(math.radians(ang)), math.sin(math.radians(ang))])
                pts.append(hpt(s, cur[0], cur[1], c * (1.0 + 0.25 * (ang / 70.0))))
            S.add(Tube(pts, [rr * 1.05, rr * 1.05, rr, rr * 0.94, rr * 0.82], k=0.006), k=0.006)
        S.add(Tube([hpt(s, 0.016, 0.008, 0.030), hpt(s, 0.040, 0.026, 0.056), hpt(s, 0.064, 0.042, 0.066),
                    hpt(s, 0.084, 0.050, 0.064)], [0.0150, 0.0135, 0.0120, 0.0105], k=0.006), k=0.008)
    return S


# ── the sculpt ─────────────────────────────────────────────────────────────────────────────────────────────────
def sculpts() -> list:
    """(name, Sculpt, voxel scale, material role, bind, tris, uv weight) in build order"""
    out = []

    def part(name, S, role, bind, tris, vs=1.0, uvw=1.0):
        out.append((name, S, vs, role, bind, tris, uvw))

    cx, cy = CHIM_C
    # THE CHIMNEY VISOR (rigid on the head): one glass body from the chin to the open rim; the carved chalk face-plate
    # is the concept's painting seen through the glass (projected onto the glass's front), so the face reads INSIDE it
    ch = Sculpt("chimney")
    ch.add(Fn(chim_d, (-0.14, -0.22, CHIM_BOT - 0.01), (0.14, 0.10, CHIM_TOP + 0.01)), k=0.0)
    ch.add(Torus((cx, cy, CHIM_TOP - 0.004), 0.080, 0.0055), k=0.003)                     # the rolled lip
    part("chimney", ch, "dawnglass", "bone:head", 1900, 0.6, 1.9)

    # THE HOOD (rounded crown, a soft rim round the face opening) and the neck wrap
    hd = Sculpt("hood")
    hd.add(Fn(hood_d, (-0.23, -0.18, 1.15), (0.23, 0.23, 1.52)), k=0.0)
    ow, oz, oh = HOOD_OPEN
    rim = [(ow * 1.04 * math.cos(math.radians(a)), -0.140 + 0.010 * abs(math.sin(math.radians(a))),
            oz + oh * 1.02 * math.sin(math.radians(a))) for a in range(-35, 216, 12)]
    hd.add(Tube(rim, [0.011] * len(rim), k=0.006), k=0.012)
    part("hood", hd, "cloth2", ("weights", "hood"), 2000, 1.0, 1.1)
    nk = Sculpt("neck")
    nk.add(Capsule((0.0, 0.0, 1.13), (0.0, -0.006, 1.235), 0.056).displaced(wraps(0.003, 0.018, (0, 0, 1.13), (0, 0, 1.24)), 0.003), k=0.0)
    part("neck", nk, "under", ("weights", "neck"), 250, 0.8, 0.6)

    # THE SCARF (a thick cream roll round the neck, a draped fold in front)
    sc = Sculpt("scarf")
    sfold = lambda P: 0.007 * np.sin(np.arctan2(P[:, 1] - 0.02, P[:, 0]) * 5.0 + P[:, 2] * 38.0 + 1.5 * NOISE(P, 5.0))  # noqa: E731
    sc.add(Torus((0.0, 0.020, 1.140), 0.148, 0.050, rz=0.046).displaced(sfold, 0.007), k=0.0)
    sc.add(Torus((0.0, 0.010, 1.082), 0.152, 0.042, rz=0.040).displaced(sfold, 0.007), k=0.03)
    sc.add(Ellipsoid((0.0, -0.140, 1.090), (0.128, 0.050, 0.050)).displaced(sfold, 0.007), k=0.035)
    sc.add(Ellipsoid((0.018, -0.150, 1.052), (0.092, 0.042, 0.034)), k=0.03)
    part("scarf", sc, "cloth2", ("weights", "scarf"), 1450, 1.0, 1.0)

    # THE MANTLE (a hollow bell: cream above, the painted slate below; open front, rolled edges, folds below the arms)
    mt = Sculpt("mantle")
    mt.add(Fn(mantle_d, (-0.52, -0.36, 0.30), (0.52, 0.40, 1.18)), k=0.0)
    part("mantle", mt, "cloth2", ("weights", "mantle"), 3800, 1.0, 1.0)

    # THE SLEEVES (bell sleeves over the short arms, open at the cuff with a rolled band; the hands come out)
    for s in "LR":
        sh, el, wr = side_pt("shoulder", s), side_pt("elbow", s), side_pt("wrist", s)
        d2 = side_pt("d2", s)
        a = sh + side_pt("d1", s) * 0.02
        e = wr + d2 * 0.010
        down = unit(np.array([0.0, 0.0, -1.0]) - d2 * float(np.array([0, 0, -1.0]) @ d2))
        sv = Sculpt(f"sleeve_{s}")
        # fix pass 1: wider BELL sleeves (the concept's; they were tight): the cuff opens to 0.19 m with a hanging lip
        tube = Tube([a, el + down * 0.012, e + down * 0.018], [0.056, 0.066, 0.094], k=0.02)
        sv.add(tube.displaced(wraps(0.0035, 0.05, el - d2 * 0.08, e), 0.0035), k=0.0)
        sv.add(Ellipsoid((el + e) / 2 + down * 0.040, (0.100, 0.064, 0.074), axes=sdf.frame(down, d2)), k=0.05)
        sv.add(Torus(e - d2 * 0.012 + down * 0.016, 0.094, 0.012, axes=sdf.frame(d2), rz=0.014), k=0.012)
        sv.sub(Capsule(e - d2 * 0.075 + down * 0.016, e + d2 * 0.06 + down * 0.016, 0.076), k=0.008)
        part(f"sleeve_{s}", sv, "cloth2", ("weights", f"sleeve_{s}"), 820, 1.0, 0.9)

    # THE DRESS (the slate under-dress seen in the opening: the painted apron and the crossed collar are the concept's
    # paint), the dark sash, the leggings and the strapped boots
    dr = Sculpt("dress")
    dr.add(Ellipsoid((0.0, 0.015, 1.000), (0.150, 0.112, 0.140)), k=0.0)
    dr.add(Ellipsoid((0.0, 0.015, 0.860), (0.130, 0.102, 0.100)), k=0.06)
    skirt = FlatCapsule((0.0, 0.0, 0.82), (0.0, -0.022, 0.45), 0.135, 0.112, 0.165, 0.190, side=(1, 0, 0))
    dr.add(skirt.displaced(folds(0.008, 22.0, axis=0, zfade=(0.80, 0.45)), 0.008), k=0.05)
    dr.inter(Fn(lambda P: 0.430 - P[:, 2], (-0.3, -0.3, 0.38), (0.3, 0.3, 1.2)), k=0.008)
    part("dress", dr, "cloth", ("weights", "dress"), 1000, 1.0, 0.8)
    sa = Sculpt("sash")
    sa.add(Torus((0.0, 0.012, 0.905), 0.112, 0.034, axes=np.diag([1.0, 1.0, 1.0]), rz=0.031)
           .displaced(lambda P: 0.003 * np.sin(np.arctan2(P[:, 1], P[:, 0]) * 6 + P[:, 2] * 90), 0.003), k=0.0)
    part("sash", sa, "cloth3", ("weights", "sash"), 380, 0.8, 0.7)
    lg = Sculpt("legs")
    for s in "LR":
        hip, knee, ank = side_pt("hip", s), side_pt("knee", s), side_pt("ankle", s)
        lg.add(RoundCone(hip, knee, 0.066, 0.054), k=0.0)
        lg.add(RoundCone(knee, ank + np.array([0, 0, 0.06]), 0.053, 0.042), k=0.03)
    part("legs", lg, "under", ("weights", "legs"), 500, 1.0, 0.5)
    bt = Sculpt("boots")
    for s in "LR":
        ank = side_pt("ankle", s)
        fwd = LAY["foot_fwd"] * np.array([1.0 if s == "L" else -1.0, 1.0, 1.0])
        side = np.cross(fwd, [0, 0, 1.0])
        fa = np.stack([side, fwd, [0, 0, 1.0]])
        bt.add(FlatCapsule(ank + [0, 0, -0.01], ank + [0, -0.004, 0.19], 0.058, 0.062, 0.060, 0.064, side=(1, 0, 0)), k=0.0)
        bt.add(Torus(ank + [0, -0.004, 0.188], 0.062, 0.016, rz=0.020), k=0.012)                 # the turned cuff
        heel = np.array([ank[0], ank[1], 0.0]) + fwd * 0.02
        bt.add(RoundBox(heel + fwd * 0.012 + [0, 0, 0.050], (0.054, 0.105, 0.048), 0.036, axes=fa), k=0.04)
        bt.add(Ellipsoid(heel + fwd * 0.092 + [0, 0, 0.040], (0.056, 0.060, 0.040), axes=fa), k=0.03)
        bt.add(RoundBox(heel + fwd * 0.018 + [0, 0, 0.010], (0.060, 0.128, 0.010), 0.008, axes=fa), k=0.006)   # the sole
        for i, (zz, tilt) in enumerate(((0.105, 14.0), (0.145, -14.0), (0.185, 12.0))):
            bt.add(Torus(ank + [0, 0.0, zz - 0.08], 0.063, 0.0075, axes=sdf.rot_x(tilt) @ sdf.rot_z(25 * i), rz=0.006), k=0.006)
        bt.add(RoundBox(ank + side * 0.062 * (-1 if s == "L" else 1) + [0, 0.0, 0.07], (0.010, 0.022, 0.012), 0.005), k=0.004)
    bt.inter(Fn(lambda P: -P[:, 2], (-0.4, -0.4, -0.05), (0.4, 0.4, 0.4)), k=0.0)
    part("boots", bt, "leather", ("weights", "boots"), 1200, 0.8, 0.8)

    # THE HANDS (gloved), THE HOOK-STAFF (prop.R) and THE LAMP (x_lamp, plumb)
    for s in "LR":
        part(f"hand_{s}", hand_parts(s), "leather", f"bone:hand.{s}", 650, 0.55, 0.9)
    stf = Sculpt("staff")
    knots = [(S_BUTT + 0.02, 0.0, 0.0, 0.023), (-0.30, 0.003, -0.003, 0.0205), (-0.16, -0.003, 0.003, 0.0215),
             (-0.04, 0.0, 0.0, 0.0205), (0.10, 0.003, 0.002, 0.020), (S_TOP, 0.0, 0.0, 0.019)]
    stf.add(Tube([spt(u, k, v) for u, k, v, _ in knots], [r for *_, r in knots], k=0.01)
            .displaced(lambda P: -0.0018 * NOISE.ridged(P, 30.0, 2), 0.002), k=0.0)
    stf.add(Sphere(spt(S_BUTT + 0.01), 0.023), k=0.01)
    for u in (-0.26, 0.15):
        stf.add(Ellipsoid(spt(u, 0.004, -0.003), (0.026, 0.024, 0.030), axes=np.stack([K0, V0, U0])), k=0.012)
    stf.add(Tube([spt(u, k) for k, u in HOOK], HOOK_R, k=0.004)
            .displaced(lambda P: -0.0016 * NOISE.ridged(P, 30.0, 2), 0.002), k=0.01)
    stf.add(Sphere(spt(HOOK[-1][1] - 0.004, HOOK[-1][0] - 0.004), 0.0145), k=0.006)
    for (k1, u1), r1 in zip(HOOK[2:6], HOOK_R[2:6]):                 # the carved knuckles at the loop's corners
        stf.add(Sphere(spt(u1, k1), r1 * 1.18), k=0.006)
    part("staff", stf, "wood", "bone:prop.R", 1150, 0.55, 0.8)
    ls = Sculpt("lamp_stone")
    hb = unit(K0 * np.array([1.0, 1.0, 0.0]))
    ls.add(Torus(lpt(LAMP["ring"]), 0.013, 0.0042, axes=sdf.frame(hb)), k=0.0)
    ls.add(Capsule(lpt(LAMP["stem"][0]), lpt(LAMP["stem"][1]), 0.0055), k=0.003)
    ls.add(Sphere(lpt(LAMP["knob"]), 0.015), k=0.006)

    def disc(z0, z1, r0, r1=None):
        r1 = r0 if r1 is None else r1
        return Lathe(lpt(0.0), lambda r, z, z0=z0, z1=z1, r0=r0, r1=r1: np.maximum(
            r - (r0 + (r1 - r0) * np.clip((-z - z0) / (z1 - z0), 0, 1)), np.maximum(-z - z1, z0 + z)) + 0.0,
            max(r0, r1) + 0.01, -z1 - 0.01, -z0 + 0.01)
    ls.add(disc(*LAMP["cap"], 0.044, 0.062), k=0.006)
    ls.add(disc(*LAMP["base"], 0.090, 0.076), k=0.006)
    ls.add(disc(0.284, 0.302, 0.030, 0.038), k=0.004)                    # the burner cup under the flame
    ls.add(Lathe(lpt(0.0), lambda r, z: np.maximum(r - 0.036 * np.clip((LAMP_DROP + z) / (LAMP_DROP - LAMP["finial"][0]), 0, 1) ** 0.7,
                                                   np.maximum(-z - LAMP_DROP, LAMP["finial"][0] + z)), 0.045, -LAMP_DROP - 0.01,
                 -LAMP["finial"][0] + 0.01), k=0.008)
    part("lamp_stone", ls, "chalk", "bone:x_lamp", 700, 0.5, 0.8)
    lgl = Sculpt("lamp_glass")
    for i in range(4):
        a = math.radians(45.0 + 90.0 * i)
        pts = [lpt(dz, r * math.sin(a), -r * math.cos(a)) for dz, r in GLASS_R]
        lgl.add(Tube(pts, [0.0042] * len(pts), k=0.004), k=0.0)
    lgl.add(Torus(lpt(GLASS_R[0][0] + 0.002), GLASS_R[0][1], 0.0050), k=0.004)
    f0, f1 = FONT
    lgl.add(Lathe(lpt(0.0), lambda r, z: np.maximum(r - (_interp(GLASS_R, -z, 1) + 0.002), np.maximum(-z - f1, f0 + z)),
                  0.115, -f1 - 0.01, -f0 + 0.01), k=0.004)                 # the glass font bowl
    lgl.add(Torus(lpt(f0), _interp(GLASS_R, f0, 1) + 0.002, 0.0048), k=0.004)
    part("lamp_glass", lgl, "lampglass", "bone:x_lamp", 640, 0.5, 0.7)
    fl = Sculpt("flame")
    fz, fr, ft = FLAME
    fl.add(Sphere(lpt(fz), fr), k=0.0)
    fl.add(RoundCone(lpt(fz - 0.012), lpt(ft, 0.006, 0.0), fr * 0.86, 0.004), k=0.022)
    part("flame", fl, "accent", "bone:x_lamp", 300, 0.5, 0.4)
    return out


def skin_extras(extra: dict) -> list:
    """Stillwater's six reed plates round the collar; First Bell's glass bell in the lamp and the ten hour-marks"""
    out = []
    cx, cy = CHIM_C
    if extra.get("reed_plates"):
        # fix pass 1 (the review: six thin prongs read as antennae): EIGHT broad reed leaves (0.11 x 0.05 m) laid
        # overlapping round the chimney's foot on the hood's crown, leaning out 50 degrees: a reed ruff, low and wide
        rp = Sculpt("reed_plates")
        zc = 1.492
        for i in range(8):
            a = math.radians(22.5 + 45.0 * i)
            r = np.array([math.sin(a), -math.cos(a), 0.0])
            d = unit(r * math.cos(math.radians(40)) + np.array([0, 0, math.sin(math.radians(40))]))
            rc = _interp(CHIM_R, zc, 1) + 0.008
            c = np.array([cx, cy, zc]) + r * rc + d * 0.050
            side = unit(np.cross(d, r))
            nrm = unit(np.cross(side, d))
            leaf = Ellipsoid(c, (0.028, 0.056, 0.0055), axes=np.stack([side, d, nrm]))
            rp.add(leaf.displaced(lambda P, c=c, side=side: 0.002 * np.cos((P - c) @ side * 160.0), 0.002), k=0.0)
            rp.add(Capsule(c - d * 0.048, c + d * 0.050, 0.0036), k=0.003)          # the leaf's midrib
        out.append(("reed_plates", rp, 0.5, "reed", "bone:head", 700, 0.7))
    if extra.get("glass_bell"):
        # fix pass 1 (the review: the bell did not show): a 0.08 m dawnglass bell hung from the cap in the clear glass
        # above the flame, slightly forward, its mouth over the flame's tip (the flame stays visible below it)
        gb = Sculpt("glass_bell")
        top, bot = LAMP["glass"][0] + 0.004, LAMP["glass"][0] + 0.074
        bx, by = 0.050, -0.040
        gb.add(Lathe(lpt(0.0, bx, by), lambda r, z: np.maximum(
            r - (0.009 + 0.021 * np.clip((-z - top) / (bot - top), 0, 1) ** 1.5), np.maximum(-z - bot, top + z)),
            0.04, -bot - 0.01, -top + 0.01), k=0.0)
        gb.add(Torus(lpt(bot - 0.003, bx, by), 0.029, 0.0042), k=0.003)            # the bell's lip
        gb.add(Sphere(lpt(top - 0.002, bx, by), 0.009), k=0.004)
        out.append(("glass_bell", gb, 0.45, "dawnglass", "bone:x_lamp", 320, 0.5))
    if extra.get("hour_marks"):
        hm = Sculpt("hour_marks")
        for i in range(10):
            th = math.radians(-68.0 + 35.1 * i)
            z0 = HEM_Z + 0.032
            pts = []
            for z in (z0, z0 + 0.075):
                X, Yf, Yb = _interp(MANTLE_S, z, 1), -_interp(MANTLE_S, z, 2), _interp(MANTLE_S, z, 3)
                Y = Yf if math.sin(th) < 0 else Yb
                q = math.hypot(math.cos(th) / X, math.sin(th) / Y)
                p0 = np.array([math.cos(th) / q, math.sin(th) / q, z])
                out_ = -float(fold_disp(p0[None, :], mantle_amp)[0])           # the fold's bulge there
                r = unit(p0 * np.array([1.0, 1.0, 0.0]))
                pts.append(p0 + r * (out_ + 0.001))
            hm.add(Capsule(pts[0], pts[1], 0.0085), k=0.0)
        out.append(("hour_marks", hm, 0.5, "chalk", ("weights", "mantle"), 500, 0.6))
    return out


_BUILD = {"names": [], "palette": dict(PALETTE), "skin": None}


def model(ctx) -> list:
    P = []
    extra = (ctx.skin or {}).get("extra") or {}
    _BUILD["palette"] = dict(ctx.palette or PALETTE)
    _BUILD["skin"] = (ctx.skin or {}).get("id")
    for name, S, vs, role, bind, tris, uvw in sculpts() + skin_extras(extra):
        v, q = S.mesh(VOXEL * vs)
        ob = sdf.to_object(f"{name}_high", v, q, ctx.col)
        ob.data.materials.append(ctx.mats[role])
        P.append(fighter.Part(name, high=ob, tris=tris, bind=bind, uv_weight=uvw))
    _BUILD["names"] = [p.name for p in P]
    return P


def extra_materials(ctx) -> dict:
    pal = dict(materials.BIBLE_PALETTE)
    pal.update(ctx.palette)
    gr = ctx.gradient
    return {"cloth3": materials.heavy_cloth("cloth3", pal, "cloth3", gr, weave=0.6),
            "lampglass": materials.glass("lampglass", pal, "lampglass", gr, rough=0.16),
            "reed": materials.carved_wood("reed", pal, "reed", gr)}


# ── rig extras: the lamp's pivot (plumb in every pose) and the chimney-top socket ─────────────────────────────
def rig_extras(ctx) -> None:
    info = ctx.info
    from mathutils import Vector
    arm = info.armature
    scene.select_only([arm], arm)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    f, n, t = HF["R"]
    h = eb["hand.R"]
    h.tail = h.head + Vector(tuple(f)) * h.length
    h.align_roll(Vector(tuple(-n)))
    pr = eb["prop.R"]
    pr.head = Vector(tuple(C0))
    pr.tail = Vector(tuple(C0 + U0 * 0.12))
    pr.align_roll(Vector(tuple(K0)))
    bpy.ops.object.mode_set(mode="OBJECT")
    for b in arm.data.bones:
        info.lengths[b.name] = b.length
    rig.add_socket(info, "x_lamp", "prop.R", tuple(HANG0), direction=(0.0, 0.0, -0.10))
    info.armature.data.bones["x_lamp"].use_deform = True          # the lamp's parts are skinned to it
    rig.add_socket(info, "x_chimney_top", "head", (CHIM_C[0], CHIM_C[1], CHIM_TOP), direction=(0.0, 0.0, 0.08))
    # the brief's two mantle sway bones (fix pass 1: they were never added, so no cast could flare the bell): one bone
    # per front panel from the chest's front down to the hem, on the spine; +X swings the panel forward, +Z (left) /
    # -Z (right) flares it out. The clips set them (cast_a3 / cast_ult flare open) and the resolve wrapper adds the
    # knees' lift to them (a striding knee carries its panel forward instead of poking through it)
    for nm, (h, t) in MANTLE_BONES.items():
        rig.add_socket(info, nm, "spine", h, direction=tuple(np.subtract(t, h)))
        info.armature.data.bones[nm].use_deform = True
        info.lengths[nm] = info.armature.data.bones[nm].length


def chain_config(ctx) -> list:
    return []


# ── skin weights (pipeline.bind_part wrapper: ("weights", how)) ────────────────────────────────────────────────
def _w_hood(P, J):
    z = P[:, 2]
    wh = ss(1.195, 1.265, z)
    return {"head": wh, "neck": (1 - wh) * 0.55, "chest": (1 - wh) * 0.45}


def _w_neck(P, J):
    z = P[:, 2]
    wh = ss(1.215, 1.245, z)
    wc = 1 - ss(1.13, 1.18, z)
    return {"head": wh, "chest": wc * (1 - wh), "neck": np.clip(1 - wh - wc, 0, 1)}


def _w_scarf(P, J):
    x, z = P[:, 0], P[:, 2]
    wn = 0.30 * ss(1.13, 1.19, z)
    sh = 0.22 * ss(0.11, 0.19, np.abs(x)) * (1 - wn)
    return {"chest": np.clip(1 - wn - sh, 0, 1), "neck": wn, "shoulder.L": sh * (x > 0), "shoulder.R": sh * (x <= 0)}


def _w_mantle(P, J):
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    wc = ss(0.88, 1.02, z)
    wh = 1 - ss(0.62, 0.82, z)
    ws = np.clip(1 - wc - wh, 0, 1)
    ax = np.abs(x)
    sh = 0.42 * ss(0.14, 0.22, ax) * ss(0.90, 1.02, z)
    ua = 0.20 * ss(0.20, 0.27, ax) * ss(0.88, 1.00, z)
    k = np.clip(1 - sh - ua, 0, 1)
    th = 0.24 * ss(0.62, 0.40, z) * ss(-0.08, -0.22, y)
    sl = ss(-0.05, 0.05, x)
    out = {"chest": wc * k, "spine": ws * k, "hips": wh * k * (1 - th), "thigh.L": wh * k * th * sl,
           "thigh.R": wh * k * th * (1 - sl), "shoulder.L": sh * (x > 0), "shoulder.R": sh * (x <= 0),
           "upper_arm.L": ua * (x > 0), "upper_arm.R": ua * (x <= 0)}
    # the front panels on their sway bones: within ~60 degrees of the front opening, fading in below the chest
    dth = np.abs(np.angle(np.exp(1j * (np.arctan2(y, x) + math.pi / 2))))
    wp = 0.85 * ss(1.30, 0.92, dth) * ss(1.00, 0.80, z)
    out = {b: w * (1 - wp) for b, w in out.items()}
    out["x_mantle_l"] = wp * (x > 0)
    out["x_mantle_r"] = wp * (x <= 0)
    return out


def _w_sleeve(s):
    def fn(P, J):
        j, e = J[f"upper_arm.{s}"]
        fe, fw = J[f"forearm.{s}"]
        u = unit(e - j)
        d = (P - j) @ u
        wsh = 1 - ss(-0.02, 0.07, d)
        uf = unit(fw - fe)
        past = ss(-0.035, 0.035, (P - fe) @ uf) * (1 - wsh)
        wu = np.clip(1 - wsh - past, 0, 1)
        return {f"shoulder.{s}": wsh * 0.6, "chest": wsh * 0.4, f"upper_arm.{s}": wu, f"forearm.{s}": past}
    return fn


def _w_dress(P, J):
    x, z = P[:, 0], P[:, 2]
    wc = ss(0.93, 1.03, z)
    wh = 1 - ss(0.72, 0.88, z)
    ws = np.clip(1 - wc - wh, 0, 1)
    leg = 0.72 * ss(0.74, 0.44, z)
    sl = ss(-0.07, 0.07, x)
    return {"chest": wc, "spine": ws, "hips": wh * (1 - leg), "thigh.L": wh * leg * sl, "thigh.R": wh * leg * (1 - sl)}


def _w_sash(P, J):
    z = P[:, 2]
    w = ss(0.88, 0.94, z)
    return {"spine": 0.35 + 0.3 * w, "hips": 0.65 - 0.3 * w}


def _w_legs(P, J):
    x, z = P[:, 0], P[:, 2]
    m = (x > 0).astype(float)
    out = {}
    for s, mm in (("L", m), ("R", 1 - m)):
        knee = J[f"shin.{s}"][0][2]
        ws = ss(knee + 0.04, knee - 0.04, z)
        out[f"shin.{s}"] = ws * mm
        out[f"thigh.{s}"] = (1 - ws) * mm * (1 - 0.15 * ss(0.56, 0.62, z))
    out["hips"] = 0.15 * ss(0.56, 0.62, z)
    return out


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


WEIGHTS = {"hood": _w_hood, "neck": _w_neck, "scarf": _w_scarf, "mantle": _w_mantle, "sleeve_L": _w_sleeve("L"),
           "sleeve_R": _w_sleeve("R"), "dress": _w_dress, "sash": _w_sash, "legs": _w_legs, "boots": _w_boots}


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
        w = np.asarray(w, dtype=np.float64) / tot
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

# ── paint (project.paint wrapper): the concept projected on everything the concept paints; the props, the gloves
#    and the lamp painted here (they are held where the concept shows nothing); the mantle's and sleeves' insides
#    take the dark lining; the visibility maps ignore the props (they must not shadow the paint behind them) ────────
PROC = ("staff", "lamp_stone", "lamp_glass", "hand_L", "hand_R", "reed_plates", "glass_bell", "hour_marks", "chimney")
NO_VIS = ("staff", "lamp_stone", "lamp_glass", "flame", "hand_L", "hand_R", "glass_bell")
LINING = "#2F343D"


def _hex(h):
    return np.array(scene.hex_srgb(h), dtype=np.float32)


def _lin(c):
    c = np.asarray(c, dtype=np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def _fbm(P, f, o=3):
    return NOISE.fbm(np.asarray(P, dtype=np.float64), f, o)


def _paint_staff(p, n, pal):
    base = _hex(pal.get("wood", PALETTE["wood"]))
    s = (p - C0) @ U0
    k = (p - C0) @ K0
    v = (p - C0) @ V0
    ang = np.arctan2(v, k)
    grain = 0.5 + 0.5 * np.sin(ang * 3.0 + s * 9.0 + 3.0 * _fbm(p, 6.0))
    streak = _fbm(np.stack([k * 40.0, v * 40.0, s * 2.5], 1), 1.0, 3)
    lit = 0.5 + 0.5 * (n @ unit(K0 * 0.5 - V0 * 0.6 + U0 * 0.6))
    c = base * (0.80 + 0.10 * grain + 0.10 * streak)[:, None] * (0.82 + 0.26 * lit)[:, None]
    groove = np.clip(NOISE.ridged(p, 30.0, 2), 0, 1)              # the carved gouges (the sculpt's ridged noise)
    return c * (1.0 - 0.10 * groove)[:, None]


def _paint_stone(p, n, pal):
    base = _hex(pal.get("chalk", PALETTE["chalk"]))
    up = np.clip(n[:, 2], -1, 1)
    side = 0.5 + 0.5 * (n @ unit([-0.4, -0.8, 0.3]))
    c = base * (0.74 + 0.16 * side + 0.10 * up)[:, None] * (0.94 + 0.08 * _fbm(p, 25.0))[:, None]
    return c


def _paint_glass(p, n, pal, key="lampglass"):
    """the lamp's glass (ribs, rim rings, font bowl) and First Bell's bell: the glass colour, lighter on top, a darker
    lower edge where the glass thickens, a white catch-light streak down the front-left and a fainter one behind"""
    base = _lin(_hex(pal.get(key, PALETTE.get(key, "#BFD3DE"))))
    ax = HANG0 if key == "lampglass" else HANG0
    th = np.arctan2(p[:, 0] - ax[0], -(p[:, 1] - ax[1]))
    streak = np.exp(-((th + 0.70) / 0.22) ** 2) + 0.5 * np.exp(-((th - 2.45) / 0.22) ** 2)
    up = n[:, 2] * 0.5 + 0.5
    lin = base * (0.70 + 0.30 * up)[:, None]
    lin = lin * (1.0 - 0.30 * np.clip(-n[:, 2], 0, 1))[:, None]
    lin = lin + (0.30 * streak * (0.4 + 0.6 * up))[:, None]
    return _srgb(np.clip(lin, 0, 1))


def _face_zone(p, n):
    """the chimney's texels that show the face through the glass: in front, inside the hood's opening"""
    ow, oz, oh = HOOD_OPEN
    q = np.hypot(p[:, 0] / (ow * 0.97), (p[:, 2] - oz) / (oh * 0.98))
    return ss(1.04, 0.86, q) * ss(-0.12, -0.42, n[:, 1]) * ss(1.49, 1.44, p[:, 2])


def _paint_chimney(c, p, n, pal=None):
    """THE GLASS VISOR (fix pass 1). In the hood's opening the projection keeps the concept's face-plate seen through
    the glass (its carving's contrast raised x1.45, a faint cool cast, a soft diagonal glint across it); everywhere
    else the glass is painted clear cool dawnglass: the see-through tint lighter toward the rim, the sides turning
    darker blue-grey (thick glass seen edge-on), two vertical catch-light streaks front and back, a bright rolled lip
    and the open top's well a deep cool grey (a hollow chimney from the game's camera above)"""
    pal = pal or PALETTE
    cx, cy = CHIM_C
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    th = np.arctan2(x - cx, -(y - cy))
    glass = _lin(_hex(pal.get("dawnglass", "#C0D6E8")))
    edge = _lin(_hex("#6F8599"))
    lin = np.repeat(glass[None, :], len(p), 0) * (0.92 + 0.10 * ss(1.48, 1.70, z))[:, None]
    side = np.clip((np.abs(np.sin(th)) - 0.55) / 0.45, 0, 1) ** 1.2
    lin = lin * (1 - 0.66 * side[:, None]) + edge * (0.66 * side[:, None])
    low = ss(1.56, 1.47, z) * 0.30                                     # the hood's shade read through the glass's foot
    lin = lin * (1 - low[:, None]) + edge * 0.8 * low[:, None]
    streak = (np.exp(-((th + 0.58) / 0.085) ** 2) + 0.55 * np.exp(-((th - 0.40) / 0.06) ** 2)
              + 0.75 * np.exp(-((th - (math.pi - 0.58)) / 0.085) ** 2) + 0.4 * np.exp(-((th + math.pi - 0.40) / 0.06) ** 2))
    streak = streak * ss(1.40, 1.50, z) * (1.0 - ss(1.68, 1.70, z))
    lin = lin + 0.55 * streak[:, None]
    # the flare's own glass (the bulb round the face): two bright edge lines down its sides where it turns away, a
    # crescent glint on its shoulder where it narrows into the chimney, and a bright rolled rim along the chin
    fl = ss(1.47, 1.43, z) * ss(1.17, 1.20, z)
    rim_side = np.exp(-((np.abs(np.sin(th)) - 0.80) / 0.06) ** 2) * (np.cos(th) > -0.2) * fl
    shoulder = np.exp(-((z - 1.452) / 0.014) ** 2) * np.exp(-((th + 0.25) / 0.55) ** 2) * ss(-0.1, 0.3, n[:, 2])
    chin = ss(1.200, 1.186, z) * (np.cos(th) > -0.3)
    lip = ss(1.700, 1.712, z) * (n[:, 2] > -0.3)
    lin = lin * (1 - lip[:, None]) + _lin(_hex("#EEF4F8")) * lip[:, None]
    r = np.hypot(x - cx, y - cy)
    inside = (z > 1.672) & (r < _interp(CHIM_R, z, 1) - 0.006) & (n[:, 2] > -0.95)
    lin[inside] = _lin(_hex("#5F6F7E")) * (0.85 + 0.25 * ss(1.67, 1.71, z[inside]))[:, None]
    # the face through the glass
    wf = _face_zone(p, n)
    fc = c.copy()
    qm = np.hypot(x / (MASK_R[0] * 1.05), (z - MASK_C[2]) / (MASK_R[2] * 1.05)) < 1.0
    if qm.any():
        m = np.median(fc[qm], axis=0, keepdims=True)
        fc[qm] = np.clip(m + (fc[qm] - m) * 1.45, 0.0, 1.0)
    flin = _lin(fc) * 0.92 + glass * 0.06
    dk = ss(0.10, 0.02, flin @ np.array([0.2126, 0.7152, 0.0722]))[:, None]   # the dark hood behind: glass sheen
    flin = flin * (1 - 0.30 * dk) + edge * 0.30 * dk
    glint = np.exp(-(((x - cx) * 0.8 + (z - 1.33) * 0.6 + 0.035) / 0.016) ** 2) * ss(-0.3, -0.7, n[:, 1])
    flin = flin + 0.16 * glint[:, None]
    lin = lin * (1 - wf[:, None]) + flin * wf[:, None]
    lin = lin + (0.50 * rim_side + 0.45 * shoulder)[:, None]
    lin = lin * (1 - 0.7 * chin[:, None]) + _lin(_hex("#E4EEF4")) * 0.7 * chin[:, None]
    return _srgb(np.clip(lin, 0, 1))


def _paint_glove(p, n, pal):
    base = _hex("#3B414C")
    lit = 0.5 + 0.5 * (n @ unit([-0.3, -0.6, 0.75]))
    c = base * (0.72 + 0.42 * lit)[:, None] * (0.95 + 0.06 * _fbm(p, 40.0))[:, None]
    return c


def _paint_flat(p, n, pal, key):
    base = _hex(pal.get(key, PALETTE.get(key, "#888888")))
    lit = 0.5 + 0.5 * (n @ unit([-0.3, -0.6, 0.75]))
    return base * (0.82 + 0.26 * lit)[:, None] * (0.95 + 0.06 * _fbm(p, 20.0))[:, None]


_orig_build_vis = _project.VisibilityMaps.build.__func__


def _build_vis(cls, obj, plates, step=2, part_attr="part"):
    """the projection cameras see through the props (they are held where the concept paints nothing)"""
    names = _BUILD.get("names") or []
    me = obj.data
    if not names or part_attr not in me.attributes:
        return _orig_build_vis(cls, obj, plates, step, part_attr)
    skip = [names.index(nm) for nm in NO_VIS if nm in names]
    pp = _project.poly_parts(me, part_attr)
    keep = ~np.isin(pp, skip)
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    dead = [f for f in bm.faces if not keep[f.index]]
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    tmp = bpy.data.meshes.new("_ilsheta_vis")
    bm.to_mesh(tmp)
    bm.free()
    a = tmp.attributes.get(part_attr)
    tob = bpy.data.objects.new("_ilsheta_vis", tmp)
    try:
        return _orig_build_vis(cls, tob, plates, step, part_attr)
    finally:
        bpy.data.objects.remove(tob)
        bpy.data.meshes.remove(tmp)
        del a


_project.VisibilityMaps.build = classmethod(_build_vis)
_orig_paint = _project.paint


def _paint(maps, plates, vis, names, tops=None, flat=None, eps=0.02, bleed=True, log=print):
    out = _orig_paint(maps, plates, vis, names, tops=tops, flat=flat, eps=eps, bleed=False, log=log)
    P, N, part = maps["P"], maps["N"], maps["part"]
    pal = _BUILD.get("palette") or PALETTE
    have = part >= 0
    for nm in ("mantle", "sleeve_L", "sleeve_R", "scarf"):
        if nm not in names:
            continue
        sel = have & (part == names.index(nm))
        if sel.any():
            out[sel] = _band_fill(out[sel], P[sel].astype(np.float64), N[sel].astype(np.float64), nm, plates, vis)
    for nm in names:
        k = names.index(nm)
        sel = have & (part == k)
        if not sel.any():
            continue
        p, n = P[sel].astype(np.float64), N[sel].astype(np.float64)
        if nm == "staff":
            out[sel] = _paint_staff(p, n, pal)
        elif nm == "lamp_stone":
            out[sel] = _paint_stone(p, n, pal)
        elif nm == "lamp_glass":
            out[sel] = _paint_glass(p, n, pal)
        elif nm == "glass_bell":
            out[sel] = _paint_glass(p, n, pal, "dawnglass")
        elif nm in ("hand_L", "hand_R"):
            out[sel] = _paint_glove(p, n, pal)
        elif nm == "reed_plates":
            out[sel] = _paint_flat(p, n, pal, "reed")
        elif nm == "hour_marks":
            out[sel] = _paint_flat(p, n, pal, "chalk")
        elif nm == "chimney":
            out[sel] = _paint_chimney(out[sel], p, n, pal)
        elif nm == "mantle":
            r = unit_rows(np.stack([p[:, 0], p[:, 1], np.zeros(len(p))], 1))
            inward = np.clip((-(n * r).sum(1) - 0.10) / 0.4, 0, 1) * ss(1.05, 0.95, p[:, 2])
            under = np.clip((-n[:, 2] - 0.3) / 0.5, 0, 1) * ss(HEM_Z + 0.06, HEM_Z + 0.02, p[:, 2])
            w = np.maximum(inward, under)[:, None]
            lin = _lin(out[sel])
            lin = lin * (1 - w) + (lin * 0.35 + _lin(_hex(LINING)) * 0.65) * w
            lin = lin * (1.0 - 0.22 * ss(0.52, 0.36, p[:, 2]))[:, None]      # the hem's slate deepens (feet band)
            out[sel] = _srgb(lin)
        elif nm in ("sleeve_L", "sleeve_R"):
            s = nm[-1]
            e = side_pt("wrist", s)
            d2 = side_pt("d2", s)
            rel = p - e
            ax = rel - np.outer(rel @ d2, d2)
            into = np.clip((-(n * unit_rows(ax)).sum(1) - 0.2) / 0.4, 0, 1) * ss(-0.10, -0.05, rel @ d2)
            lin = _lin(out[sel])
            w = into[:, None]
            out[sel] = _srgb(lin * (1 - w) + (lin * 0.35 + _lin(_hex(LINING)) * 0.65) * w)
    # the game's cool sky light turns the concept's pale warm linen bone-white / blue: its warm chroma is pushed (x1.6
    # on the lit linen only, never its brown shadows; x1.25 on the chalk face; saturation stays ~0.15, far under the
    # reserved marigold's 40 %)
    for nm, k in WARM.items():
        if nm in names:
            sel = have & (part == names.index(nm))
            if sel.any():
                c = out[sel]
                g = c.mean(axis=1, keepdims=True)
                w = (ss(0.0, 0.05, c[:, 0] - c[:, 2]) * ss(0.55, 0.75, c @ np.array([0.30, 0.59, 0.11])))[:, None]
                out[sel] = np.clip(g + (c - g) * (1.0 + (k - 1.0) * w), 0.0, 1.0)
    # (the face-plate's carving contrast x1.45 is in _paint_chimney: the face is painted inside the glass)
    # the top quarter's value (lineup_qa build 4: L* 61 against the bible's 70-85): the head's pale pieces are lifted
    # with a soft knee (the darks and mids most, nothing past L* 88), the mantle's shoulders fading in above 1.0 m
    for nm, amt in LIFT.items():
        if nm in names:
            sel = have & (part == names.index(nm))
            if sel.any():
                w = ss(0.98, 1.10, P[sel][:, 2]) if nm == "mantle" else 1.0
                out[sel] = _lift(out[sel], amt * w)
    if bleed:
        iy, ix = _project.nearest_index(have)
        out = out[iy, ix]
    return out


LIFT = {"hood": 15.0, "scarf": 13.0, "mantle": 8.0, "sleeve_L": 5.0, "sleeve_R": 5.0, "lamp_stone": 0.0}


def _lift(c, amt):
    lin = _lin(c)
    Y = np.maximum(lin @ np.array([0.2126, 0.7152, 0.0722]), 1e-5)
    L = np.where(Y > 0.008856, 116 * np.cbrt(Y) - 16, 903.3 * Y)
    L2 = L + np.asarray(amt) * np.clip(1 - (L / 88.0) ** 4, 0, 1)
    Y2 = np.where(L2 > 8, ((L2 + 16) / 116) ** 3, L2 / 903.3)
    return _srgb(lin * (Y2 / Y)[:, None])


WARM = {"hood": 1.6, "scarf": 1.6, "mantle": 1.6, "sleeve_L": 1.6, "sleeve_R": 1.6, "dress": 1.4}


def _hidden(p, n, plates, vis, eps=0.02):
    """how much of a texel's projected paint came from a plate that could not see it (0..1)"""
    hid = {}
    for side in ("front", "back"):
        px, py = plates.to_px(side, p[:, 0], p[:, 2])
        dep, _ = vis.lookup(side, px, py)
        if side == "front":
            hid[side] = ~(p[:, 1] <= np.nan_to_num(dep, nan=1e9) + eps)
        else:
            hid[side] = ~(p[:, 1] >= np.nan_to_num(dep, nan=-1e9) - eps)
    wb = np.clip((n[:, 1] + 0.25) / 0.5, 0, 1)
    wb = wb * wb * (3 - 2 * wb)
    return hid["front"] * (1 - wb) + hid["back"] * wb


def _band_fill(col, p, n, nm, plates, vis, step=0.02):
    """occluded texels take the median paint of the part's VISIBLE texels in their band (height for the mantle and
    the scarf, the distance along the arm for a sleeve), front- and back-facing apart, with a little noise"""
    h = ss(0.15, 0.6, _hidden(p, n, plates, vis))
    # fix pass 1 (the review: a brown smear on the right side panel, a brown hem band, wherever the side turned to the
    # camera): texels both plates see only edge-on (|n.y| small) carry the plates' streaked silhouette-edge paint, so
    # they count as hidden too; front and back medians blend across the side instead of meeting at a seam
    h = np.maximum(h, 0.92 * ss(0.40, 0.16, np.abs(n[:, 1])))
    if nm.startswith("sleeve"):
        s_ = nm[-1]
        coord = (p - side_pt("shoulder", s_)) @ unit(side_pt("wrist", s_) - side_pt("shoulder", s_))
    else:
        coord = p[:, 2]
    lin = _lin(col)
    out = lin.copy()
    lo = float(coord.min())
    b = np.floor((coord - lo) / step).astype(int)
    nb = int(b.max()) + 1
    tabs = []
    for back in (False, True):
        side = (n[:, 1] > 0) if back else (n[:, 1] <= 0)
        ok = side & (h < 0.2)
        if ok.sum() < 6:
            ok = h < 0.2
        tab = np.full((nb, 3), np.nan)
        for i in np.unique(b[ok]):
            m = ok & (b == i)
            if m.sum() >= 6:
                tab[i] = np.median(lin[m], axis=0)
        have_ = ~np.isnan(tab[:, 0])
        if not have_.any():
            tab = np.repeat(np.median(lin, axis=0)[None, :], nb, 0)
        else:
            idx = np.arange(nb)
            for c in range(3):
                tab[:, c] = np.interp(idx, idx[have_], tab[have_, c])
            tab = (np.roll(tab, 1, 0) + 2 * tab + np.roll(tab, -1, 0)) / 4
            tab[0], tab[-1] = tab[1], tab[-2]
        tabs.append(tab)
    wb = ss(-0.30, 0.30, n[:, 1])[:, None]
    med = tabs[0][b] * (1 - wb) + tabs[1][b] * wb                       # the band's own colour at every texel
    sel = h > 0
    fill = med[sel] * (0.94 + 0.08 * _fbm(p[sel], 18.0))[:, None]
    out[sel] = lin[sel] * (1 - h[sel, None]) + fill * h[sel, None]
    # ghosts left in VISIBLE paint (the scarf's ink blot = the concept's dark neck behind the mask; brown under-arm
    # smudges): a texel far darker than its band, or a warm brown darker than L* 62, goes most of the way to the band's
    # colour at its own shade (clamped), so the folds' painted shading stays
    Y = np.maximum(out @ np.array([0.2126, 0.7152, 0.0722]), 1e-5)
    Ym = np.maximum(med @ np.array([0.2126, 0.7152, 0.0722]), 1e-5)
    L = 116 * np.cbrt(Y) - 16
    Lm = 116 * np.cbrt(Ym) - 16
    srgb = _srgb(out)
    warm = ss(0.025, 0.07, srgb[:, 0] - srgb[:, 2]) * ss(62.0, 46.0, L) * ss(6.0, 14.0, Lm - L)
    dark = ss(26.0, 42.0, Lm - L)
    if nm == "mantle":                                  # the dark rolled hem is the feet band's value, not a ghost
        dark = dark * ss(HEM_Z + 0.05, HEM_Z + 0.10, p[:, 2])
    w = np.clip(np.maximum(warm * 0.85, dark * 0.9), 0, 1)[:, None]
    shade = np.clip(Y / Ym, 0.62, 1.0)[:, None]
    out = out * (1 - w) + med * shade * w
    return _srgb(out)


def unit_rows(a):
    return a / np.maximum(np.linalg.norm(a, axis=1, keepdims=True), 1e-9)


_project.paint = _paint

# skins: the parts painted here already carry the skin's palette (skip them); the mantle's cream -> slate -> hem
# gradient takes the cloth2 / cloth / cloth3 changes graded by height (one role per part would tint it all one way)
_orig_recolour = _project.recolour
MANTLE_BANDS = ((0.62, 0.82), (0.36, 0.46))     # cloth2 above the first band's top, cloth between, cloth3 under


# fix pass 1 (the review: the skins were tints; Stillwater's wet-stone #59666A never showed, First Bell's dark hem
# barely registered): the mantle and the sleeves are RE-PAINTED in the skin's own gradient, not scaled: each texel
# takes the skin's colour at its height times its shade relative to the base painting's band colour there (the
# painted folds and lining kept, the base's cream / slate gone). Stops (height m, role), top down.
SKIN_GRADE = {
    "ilsheta_stillwater": [(1.30, "cloth2"), (0.93, "cloth2"), (0.79, "cloth"), (0.56, "cloth"), (0.47, "cloth3"), (0.0, "cloth3")],
    "ilsheta_first_bell": [(1.30, "cloth2"), (0.93, "cloth2"), (0.80, "cloth"), (0.56, "cloth"), (0.49, "cloth3"), (0.0, "cloth3")],
}


def _recolour(img, maps, names, roles, base_pal, skin_pal, skip=None, log=print):
    skip = set(skip or ()) | set(PROC)
    graded = {"mantle", "dress"} & set(names)                # the sleeves keep the hood's pale cloth2 (top quarter)
    roles2 = {k: (None if k in graded else v) for k, v in roles.items()}
    out = _orig_recolour(img, maps, names, roles2, base_pal, skin_pal, skip=skip, log=log)
    stops = SKIN_GRADE.get(_BUILD.get("skin") or "")
    if not graded or not stops:
        return out
    part = maps["part"]
    iy, ix = _project.nearest_index(part >= 0)
    pid = part[iy, ix]
    Pz = maps["P"][iy, ix][..., 2]
    zs = np.array([s[0] for s in stops])[::-1]
    cols = np.stack([_lin(_hex(skin_pal.get(r, base_pal.get(r)))) for _, r in stops])[::-1]
    lum = np.array([0.2126, 0.7152, 0.0722])
    for nm in sorted(graded):
        m = pid == names.index(nm)
        if not m.any():
            continue
        z = Pz[m]
        lin = _lin(img[m])
        Y = np.maximum(lin @ lum, 1e-5)
        b = np.floor((z - z.min()) / 0.02).astype(int)
        ymed = np.zeros(int(b.max()) + 1)
        for i in np.unique(b):
            ymed[i] = np.median(Y[b == i])
        ymed = np.maximum(ymed[b], 1e-4)
        T = np.stack([np.interp(z, zs, cols[:, c]) for c in range(3)], 1)
        if nm == "dress":                                   # the under-dress: the skin's cloth, flat (no base hue left)
            T = np.repeat(_lin(_hex(skin_pal.get("cloth", base_pal.get("cloth"))))[None, :], len(z), 0)
        out[m] = _srgb(T * np.clip(Y / ymed, 0.12, 1.35)[:, None])
        log(f"  recolour {nm} re-painted on the skin gradient {[(s[0], s[1]) for s in stops]}")
    return out.astype(np.float32)


_project.recolour = _recolour

# ── the AO bake: the props and hands stand 1 m out to her sides (the rest pose puts the staff through the bell) ──
AO_AWAY = ("staff", "lamp_stone", "lamp_glass", "flame", "hand_L", "hand_R", "glass_bell")
AO_SHIFT = 1.2
_orig_bake_asset = _bake.bake_asset


def _bake_asset(low, highs, out_dir, name="body", *a, **k):
    names = _BUILD.get("names") or []
    me = low.data
    if not str(name).startswith(ID) or "vale_part" not in me.attributes or not names:
        return _orig_bake_asset(low, highs, out_dir, name, *a, **k)
    pv = np.empty(len(me.vertices), dtype=np.int64)
    me.attributes["vale_part"].data.foreach_get("value", pv)
    shift = np.zeros((len(pv), 3), dtype=np.float32)
    for nm in AO_AWAY:
        if nm in names:
            shift[pv == names.index(nm), 0] = AO_SHIFT if nm.endswith("_L") else -AO_SHIFT
    st = {"on": False, "done": False}

    def move(sign):
        co = np.empty(len(me.vertices) * 3, dtype=np.float32)
        me.vertices.foreach_get("co", co)
        me.vertices.foreach_set("co", (co.reshape(-1, 3) + shift * sign).ravel())
        me.update()
        st["on"] = sign > 0

    orig_sel = _bake.scene.select_only

    def select_only(objs, *aa, **kk):
        if list(objs) == [low] and not st["on"] and not st["done"]:
            move(+1.0)
            st["done"] = True
            scene.log(f"ilsheta AO: {int((shift[:, 0] != 0).sum())} prop / hand vertices moved {AO_SHIFT} m out")
        return orig_sel(objs, *aa, **kk)

    bf = k.get("base_fn")

    def base_fn(lo, sz):
        if st["on"]:
            move(-1.0)
        return bf(lo, sz)

    if bf is not None:
        k["base_fn"] = base_fn
    _bake.scene.select_only = select_only
    try:
        return _orig_bake_asset(low, highs, out_dir, name, *a, **k)
    finally:
        _bake.scene.select_only = orig_sel
        if st["on"]:
            move(-1.0)


_bake.bake_asset = _bake_asset

# ── portrait / icon: the shared head boxes stop at the hood; the chimney's top must be in frame ────────────────
from common import render as _render  # noqa: E402
_orig_fit_camera = _render._fit_camera


def _fit_camera(cam, lo, hi, *a, **k):
    if len(a) >= 5 and abs(a[4] - 1.0) < 1e-6 and hi.z < CHIM_TOP + 0.03:      # aspect 1: the portrait / the icon
        from mathutils import Vector
        hi = Vector((hi.x, hi.y, CHIM_TOP + 0.035))
        # the icon / portrait keep the lamp below the visor (brief: "the chimney visor with the lamp core below it")
        lo = Vector((min(lo.x, -0.30), min(lo.y, -0.42), min(lo.z, 1.04)))
    return _orig_fit_camera(cam, lo, hi, *a, **k)


_render._fit_camera = _fit_camera

# the splash / portrait backdrop (fix pass 1: the pale figure washed into the pale sky; the brief asks for the darker
# Aubade backdrop): the painted map plate graded down to a cool dawn dusk (x0.5 value, a slate-blue floor), the
# subject's side darker still, before the figure is laid over it
_orig_backdrop = _render.backdrop_plate


def _backdrop(cam, cfg, light, w, h, path, fast, paint_r=2):
    plate = _orig_backdrop(cam, cfg, light, w, h, path, fast, paint_r=paint_r)
    k = float(cfg.get("aubade_dusk", 0.0) or 0.0)
    if k <= 0:
        return plate
    rgb = plate[..., :3]
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    grey = lum[..., None]
    rgb = grey + (rgb - grey) * 0.75                                    # a touch less sky blue
    rgb = rgb * k * np.array([0.84, 0.92, 1.06], np.float32) + np.array([0.040, 0.050, 0.075], np.float32)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    x0 = float(cfg.get("x", 0.72))
    halo = np.exp(-(((xx / w - x0) / 0.30) ** 2 + ((yy / h - 0.45) / 0.55) ** 2))
    rgb = rgb * (1.0 - 0.22 * halo[..., None])                          # darker behind the pale figure
    plate[..., :3] = np.clip(rgb, 0.0, 1.0)
    return plate


_render.backdrop_plate = _backdrop

# ── motion ─────────────────────────────────────────────────────────────────────────────────────────────────────
# weight light, a focus prop in the right hand (blocks below): the clips are bespoke (clip_overrides); the run's legs
# are the generator's at 3.35 m/s with this module's arms
MOTION = anim.motion_profile(weight="light", weapon="one_hand", stance="neutral", run_ref_speed=3.35)


@dataclass
class Orient:
    """the hand's frame in the CHEST's frame (or the world's): `fdir` = the fingers (the hand bone's +Y), `palm` =
    the palm's normal. Solved after the arm IK (the wrist only)."""
    fdir: tuple = (0.0, 0.0, -1.0)
    palm: tuple = (0.0, 1.0, 0.0)
    weight: float = 1.0
    world: bool = False

    def lerp(self, o, t):
        from mathutils import Vector as V
        t = max(0.0, min(1.0, t))

        def sl(a, b):
            a, b = V(a).normalized(), V(b).normalized()
            if a.dot(b) < -0.999:
                return tuple((a.lerp(b, t) + a.orthogonal() * 1e-3).normalized())
            return tuple(a.slerp(b, t))
        return Orient(sl(self.fdir, o.fdir), sl(self.palm, o.palm), self.weight + (o.weight - self.weight) * t,
                      self.world if t < 0.5 else o.world)

    def mirrored(self):
        return Orient((-self.fdir[0], self.fdir[1], self.fdir[2]), (-self.palm[0], self.palm[1], self.palm[2]),
                      self.weight, self.world)


_orig_resolve = anim.resolve


def _resolve(skel, pose):
    from mathutils import Matrix, Vector as V
    ik = pose.get("ik") or {}
    ors = {k: v for k, v in ik.items() if k.startswith("orient.")}
    p2 = pose
    if ors:
        p2 = dict(pose)
        p2["ik"] = {k: v for k, v in ik.items() if not k.startswith("orient.")}
    out = _orig_resolve(skel, p2)
    if not ors and "x_lamp" not in skel.rest:
        return out
    M = skel.fk(out)
    Rc = M["chest"].to_3x3() @ skel.rest["chest"].to_3x3().inverted()
    for k, o in ors.items():
        if o.weight <= 1e-3:
            continue
        hb = f"hand.{k[-1]}"
        R_ = Matrix.Identity(3) if o.world else Rc
        y = (R_ @ V(o.fdir)).normalized()
        z = -(R_ @ V(o.palm))
        z = (z - y * z.dot(y)).normalized()
        x = y.cross(z).normalized()
        want = Matrix((x, y, z)).transposed()
        Ph = (M[skel.parent[hb]] @ skel.local[hb]).to_3x3()
        e = skel.euler_of(Ph.inverted() @ want, out.get(hb))
        if o.weight < 1.0:
            e0 = out.get(hb, (0, 0, 0))
            e = tuple(e0[i] + (e[i] - e0[i]) * o.weight for i in range(3))
        out[hb] = e
    if ors:
        M = skel.fk(out)
    _lamp_plumb(skel, out, pose, M)
    _panel_follow(skel, out, M)
    return out


def _panel_follow(skel, out, M):
    """the front panels ride on the knees: a thigh swung forward (a stride, a lunge, the kneel) carries its panel
    forward with it (past 6 degrees, 0.75 of the swing, at most 50), added to the clip's own x_mantle rotation"""
    if "x_mantle_l" not in skel.rest:
        return
    Rs = M["spine"].to_3x3() @ skel.rest["spine"].to_3x3().inverted()
    Ri = Rs.inverted()
    for s, nm in (("L", "x_mantle_l"), ("R", "x_mantle_r")):
        d = Ri @ (M[f"shin.{s}"].translation - M[f"thigh.{s}"].translation)
        if d.length < 1e-4:
            continue
        ang = math.degrees(math.atan2(-d.y, max(-d.z, 1e-4)))
        lift = min(50.0, max(0.0, ang - 6.0) * 0.75)
        e = out.get(nm, (0.0, 0.0, 0.0))
        out[nm] = (e[0] + lift, e[1], e[2])


def _lamp_plumb(skel, out, pose, M):
    """x_lamp hangs plumb in the world (turned with the chest's yaw), swung by the pose's 'lamp' (pitch toward her
    front, roll toward her left, deg); it never goes through the floor (it tips over the edge it would touch)"""
    if "x_lamp" not in skel.rest:
        return
    from mathutils import Matrix, Vector as V
    Pm = M[skel.parent["x_lamp"]] @ skel.local["x_lamp"]
    R_att = Pm.to_3x3()
    fwd = M["chest"].to_3x3() @ (skel.rest["chest"].to_3x3().inverted() @ V((0.0, -1.0, 0.0)))
    yaw = math.atan2(-fwd.x, -fwd.y) if math.hypot(fwd.x, fwd.y) > 1e-4 else 0.0
    sw = pose.get("lamp", (0.0, 0.0, 0.0))
    Rz = Matrix.Rotation(yaw, 3, "Z")
    Rs = Rz @ Matrix.Rotation(math.radians(-sw[0]), 3, "X") @ Matrix.Rotation(math.radians(-sw[1]), 3, "Y") @ Rz.inverted()
    want = Rs @ skel.rest["x_lamp"].to_3x3()
    piv = Pm.translation
    down = want.col[1].normalized()
    lo = piv.z + down.z * LAMP_DROP
    if lo < 0.012:
        need = max(-1.0, min(1.0, (0.012 - piv.z) / LAMP_DROP))
        tilt = math.acos(max(-1.0, min(1.0, -need))) - math.acos(max(-1.0, min(1.0, -down.z)))
        ax = V((0.0, 0.0, 1.0)).cross(down)
        if ax.length < 1e-4:
            ax = Rz @ V((1.0, 0.0, 0.0))
        want = Matrix.Rotation(-abs(tilt), 3, ax.normalized()) @ want
    out["x_lamp"] = skel.euler_of(R_att.inverted() @ want, out.get("x_lamp"))


anim.resolve = _resolve


def _solve_foot(skel, pose, M, side, ft):
    """anim._solve_foot with the roll's sign corrected (Vashil's / Tunlan's copy): + pitch = toes up about the heel,
    - pitch = the heel up about the ball (the stock sign drove the heel into the ground at toe-off, so the run found
    no planted frames)"""
    from mathutils import Matrix, Vector as V
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

# the pose language: wrists at their places in the REST torso's frame (converted to arm-length targets relative to
# the posed shoulder, so the torso carries them), the right hand framed by the staff (U up the shaft, K the hook's
# side), the left hand by its fingers and palm; torso rotations in degrees (x pitch forward, y yaw to her left,
# z roll to her right)
LA = PROPORTIONS["arm"]
FL0 = anim.FootTarget((0.022, -0.020, 0.0), 0.0, 5.0)
FR0 = anim.FootTarget((-0.022, 0.030, 0.0), 0.0, -7.0)


def wr(s, x, y, z, pole=None):
    rel = (np.array([x, y, z], dtype=np.float64) - SHJ[s]) / LA
    return anim.HandTarget(rel=tuple(rel), pole=tuple(pole) if pole is not None else None)


def wabs(x, y, z, pole=None):
    return anim.HandTarget(pos=(x, y, z), pole=tuple(pole) if pole is not None else None)


def staff_or(u, k, world=False):
    u = unit(u)
    k = np.asarray(k, dtype=np.float64)
    k = unit(k - u * float(u @ k))
    return Orient(tuple(k), tuple(np.cross(u, k)), 1.0, world)


def hand_or(fdir, palm, world=False):
    f = unit(fdir)
    p = np.asarray(palm, dtype=np.float64)
    return Orient(tuple(f), tuple(unit(p - f * float(f @ p))), 1.0, world)


def pose(torso=None, hips=(0.0, 0.01, -0.030), feet=None, R=None, L=None, lamp=(0.0, 0.0, 0.0), **extra) -> dict:
    """torso: {bone: (x, y, z)}; R = (HandTarget, Orient); L = (HandTarget, Orient); feet = (FootTarget L, R)"""
    p = {}
    for b, v in (torso or {}).items():
        p[b.replace("_L", ".L").replace("_R", ".R")] = tuple(float(c) for c in v)
    p["hips_loc"] = tuple(hips)
    fl, fr = feet or (FL0, FR0)
    ik = {"foot.L": fl, "foot.R": fr}
    if R is not None:
        ik["hand.R"], ik["orient.R"] = R
    if L is not None:
        ik["hand.L"], ik["orient.L"] = L
    p["ik"] = ik
    p["lamp"] = tuple(lamp)
    p.update(extra)
    return p


def ft(dx=0.0, dy=0.0, dz=0.0, pitch=0.0, side="L", yaw=None):
    base = FL0 if side == "L" else FR0
    return anim.FootTarget((base.ankle[0] + dx, base.ankle[1] + dy, base.ankle[2] + dz), pitch,
                           base.yaw if yaw is None else yaw)


TORSO_G = dict(hips=(1.0, -3.0, 0.0), spine=(2.0, 2.0, 0.0), chest=(2.0, 3.0, 0.0), neck=(-1.0, 0.0, 0.0), head=(-4.0, 2.0, 0.0))
POLE_R = (-0.9, 0.35, -0.35)
POLE_L = (0.9, 0.25, -0.45)
K_G = (0.45, -0.89, 0.0)                  # the hook's side at guard: toward her front-left (the lamp before her chest)
# the guard (fix pass 1: the brief's place, the review: the lamp hung at her right hip, its accent in the bottom half):
# the hook-staff held upright in the right fist at her right side, its hook bending in so the lamp hangs IN FRONT OF
# HER RIGHT CHEST at the brief's height (pivot ~1.42 m, the flame ~1.20 m), the left hand open beside it, warming at
# its light (Warm Hands); the bind pose (skins) keeps the staff upright at her side
G_R = (wr("R", -0.336, -0.141, 1.133, POLE_R), staff_or((0.10, 0.02, 0.99), K_G))
G_L = (wr("L", 0.010, -0.215, 1.160, POLE_L), hand_or((-0.10, -0.70, 0.70), (-0.96, -0.05, 0.15)))


def mant(flare=0.0, fwd=0.0):
    """the front panels' sway bones: `flare` (deg) opens both panels outward, `fwd` swings them forward"""
    return {"x_mantle_l": (fwd, 0.0, flare), "x_mantle_r": (fwd, 0.0, -flare)}


def guard_pose(**kw):
    a = dict(torso=TORSO_G, R=G_R, L=G_L)
    a.update(kw)
    return pose(**a)


def T(**bones):
    d = dict(TORSO_G)
    d.update(bones)
    return d


def strike(name, N, wind, hit, fol, g=None, lags=None):
    g = g or guard_pose()
    keys = anim.strike_keys(MOTION, wind, hit, fol, g)
    return anim.Clip(name, N, False, anim.drag(anim.keyed(keys), N, lags or {"head": 1.5, "neck": 1.0}), impact=anim.IMPACT)


def keyed_clip(name, N, keys, loop=False, lags=None, impact=None):
    fn = anim.keyed(keys)
    if lags:
        fn = anim.drag(fn, N, lags, loop=loop)
    return anim.Clip(name, N, loop, fn, impact=impact)


def _nudge(p, dR=(0, 0, 0), dL=(0, 0, 0)):
    out = dict(p)
    ik = dict(out.get("ik", {}))
    for s, d in (("R", dR), ("L", dL)):
        h = ik.get(f"hand.{s}")
        if h is not None and h.rel is not None:
            ik[f"hand.{s}"] = anim.HandTarget(tuple(h.rel[i] + d[i] / LA for i in range(3)), h.pos, h.to_prop, h.pole, h.weight)
    out["ik"] = ik
    return out


UP_FWD = (0.0, -0.55, 0.835)


def key_poses() -> dict:
    """the clips' key poses (the fit tool's --poses checks the held staff / lamp of each against the body)"""
    K = {}
    K["guard"] = guard_pose()
    # attack1: a small lamp FLICK: the left hand flicks the light out forward (palm out), the staff dips forward
    K["a1_w"] = guard_pose(torso=T(hips=(0, 6, 0), spine=(-2, 4, 0), chest=(-4, 7, 0), head=(-2, -5, 0)),
                           R=(wr("R", -0.360, -0.170, 1.070, POLE_R), staff_or((0.0, 0.06, 0.99), K_G)),
                           L=(wr("L", 0.080, -0.170, 1.120, POLE_L), hand_or((-0.30, -0.20, 0.93), (-0.30, -0.90, 0.10))),
                           lamp=(10, 0, 0))
    K["a1_h"] = guard_pose(torso=T(hips=(2, -6, 0), spine=(3, -5, 0), chest=(4, -8, 0), head=(-4, 5, 0)), hips=(0.0, -0.03, -0.040),
                           R=(wr("R", -0.310, -0.290, 1.060, POLE_R), staff_or((0.30, -0.26, 0.92), K_G)),
                           L=(wr("L", 0.030, -0.330, 1.140, POLE_L), hand_or((-0.10, -0.95, 0.20), (0.05, -0.30, -0.95))),
                           lamp=(-14, 0, 0))
    K["a1_f"] = guard_pose(torso=T(hips=(3, -7, 0), spine=(3, -6, 0), chest=(5, -9, 0), head=(-5, 6, 0)), hips=(0.0, -0.035, -0.042),
                           R=(wr("R", -0.310, -0.295, 1.055, POLE_R), staff_or((0.30, -0.24, 0.92), K_G)),
                           L=(wr("L", 0.035, -0.340, 1.130, POLE_L), hand_or((-0.10, -0.95, 0.15), (0.05, -0.35, -0.94))),
                           lamp=(6, 0, 0))
    # attack2: a hook-staff TAP: the staff lifted and its hook tapped down at the target, the left arm swung back
    K["a2_w"] = guard_pose(torso=T(hips=(-2, -4, 0), spine=(-4, -3, 0), chest=(-7, -4, 0), head=(-7, 0, 0)), hips=(0.0, 0.02, -0.02),
                           R=(wr("R", -0.360, -0.150, 1.160, POLE_R), staff_or((-0.10, 0.14, 0.98), K_G)),
                           L=(wr("L", 0.240, -0.080, 1.000, POLE_L), hand_or((0.40, -0.20, -0.90), (0.85, 0.30, 0.10))), lamp=(12, 0, 0))
    K["a2_h"] = guard_pose(torso=T(hips=(4, 4, 0), spine=(5, 3, 0), chest=(7, 4, 0), head=(0, -2, 0)), hips=(0.0, -0.03, -0.050),
                           R=(wr("R", -0.290, -0.300, 0.990, POLE_R), staff_or((0.36, -0.58, 0.73), (0.30, -0.70, -0.65))),
                           L=(wr("L", 0.290, 0.090, 0.900, POLE_L), hand_or((0.30, 0.50, -0.80), (0.80, -0.20, 0.30))), lamp=(-18, 0, 0))
    K["a2_f"] = guard_pose(torso=T(hips=(5, 4, 0), spine=(6, 3, 0), chest=(8, 4, 0), head=(-1, -2, 0)), hips=(0.0, -0.035, -0.052),
                           R=(wr("R", -0.288, -0.302, 0.985, POLE_R), staff_or((0.36, -0.55, 0.75), (0.30, -0.70, -0.65))),
                           L=(wr("L", 0.295, 0.095, 0.895, POLE_L), hand_or((0.30, 0.50, -0.80), (0.80, -0.20, 0.30))), lamp=(6, 0, 0))
    # cast_a1 Glint Bolt: wound in (the staff drawn back to the chest, the left hand at the shutter), then ONE LONG ARM:
    # the right arm thrust straight out, the staff near level, the lamp hanging at its far end ~0.55 m before her
    K["c1_w"] = guard_pose(torso=T(hips=(-2, -12, 0), spine=(-3, -8, 0), chest=(-5, -11, 0), head=(-2, 12, 0)), hips=(0.0, 0.03, -0.03),
                           R=(wr("R", -0.340, -0.170, 1.090, POLE_R), staff_or((-0.04, 0.10, 0.99), K_G)),
                           L=(wr("L", 0.000, -0.230, 1.160, POLE_L), hand_or((-0.40, -0.50, 0.77), (-0.80, 0.20, 0.30))), lamp=(8, 0, 0))
    K["c1_h"] = guard_pose(torso=T(hips=(3, 12, 0), spine=(2, 8, 0), chest=(2, 11, 0), head=(-6, -11, 0)), hips=(0.0, -0.08, -0.05),
                           feet=(ft(dy=-0.18, side="L"), ft(dy=0.04, side="R")),
                           R=(wr("R", -0.260, -0.270, 1.170, (-0.9, 0.3, -0.4)), staff_or((0.20, -0.70, 0.68), (0.0, -0.69, -0.72))),
                           L=(wr("L", 0.120, -0.150, 1.080, POLE_L), hand_or((-0.10, -0.60, 0.79), (0.05, -0.80, -0.60))), lamp=(-14, 0, 0))
    K["c1_f"] = guard_pose(torso=T(hips=(4, 13, 0), spine=(3, 9, 0), chest=(3, 12, 0), head=(-7, -12, 0)), hips=(0.0, -0.085, -0.052),
                           feet=(ft(dy=-0.18, side="L"), ft(dy=0.04, side="R")),
                           R=(wr("R", -0.262, -0.275, 1.165, (-0.9, 0.3, -0.4)), staff_or((0.20, -0.68, 0.70), (0.0, -0.71, -0.70))),
                           L=(wr("L", 0.130, -0.140, 1.060, POLE_L), hand_or((-0.10, -0.60, 0.79), (0.05, -0.80, -0.60))), lamp=(4, 0, 0))
    # cast_a2 Hung Lamp: ONE RAISED ARM: the right arm reaches up and forward, the staff steep, the lamp hung high
    # before her on an unseen peg over the ally; the left hand opens upward at her side (up means help)
    K["c2_w"] = guard_pose(torso=T(hips=(-2, 4, 0), spine=(-4, 3, 0), chest=(-6, 4, 0), neck=(-4, 0, 0), head=(-8, -2, 0)), hips=(0, 0.01, -0.02),
                           R=(wr("R", -0.300, -0.200, 1.180, POLE_R), staff_or((0.08, -0.05, 0.99), K_G)),
                           L=(wr("L", 0.150, -0.180, 1.080, POLE_L), hand_or((-0.30, -0.70, 0.65), (0.05, 0.10, 1.0))), lamp=(6, 2, 0))
    K["c2_h"] = guard_pose(torso=T(hips=(-2, -4, -2), spine=(-4, -3, -3), chest=(-7, -4, -4), neck=(-4, 0, 0), head=(-10, 6, 0)), hips=(0, -0.02, 0.012),
                           feet=(ft(dy=-0.10, side="L", pitch=-8), ft(side="R", pitch=-14)),
                           R=(wr("R", -0.330, -0.180, 1.260, (-0.9, 0.0, -0.3)), staff_or((0.05, -0.50, 0.86), (0.0, -0.86, -0.50))),
                           L=(wr("L", 0.330, -0.120, 1.120, POLE_L), hand_or((0.40, -0.60, 0.70), (0.10, 0.10, 1.0))), lamp=(-10, 2, 0))
    K["c2_f"] = guard_pose(torso=T(hips=(-2, -5, -2), spine=(-4, -4, -3), chest=(-7, -5, -4), neck=(-4, 0, 0), head=(-10, 7, 0)), hips=(0, -0.02, 0.008),
                           feet=(ft(dy=-0.10, side="L", pitch=-8), ft(side="R", pitch=-12)),
                           R=(wr("R", -0.332, -0.178, 1.255, (-0.9, 0.0, -0.3)), staff_or((0.05, -0.48, 0.87), (0.0, -0.87, -0.48))),
                           L=(wr("L", 0.335, -0.110, 1.140, POLE_L), hand_or((0.40, -0.55, 0.73), (0.10, 0.10, 1.0))), lamp=(4, 1, 0))
    # cast_a3 Dawnglass Shell: 3 frames cupping the lamp at the chest, then ARMS WIDE, palms out, like opening a pane:
    # the staff swung out upright at her right, the left palm pushed out, the mantle panels flared open
    K["c3_c"] = guard_pose(torso=T(hips=(2, 0, 0), spine=(3, 0, 0), chest=(4, 0, 0), head=(5, 0, 0)), hips=(0, 0.0, -0.04),
                           R=(wr("R", -0.230, -0.240, 1.030, POLE_R), staff_or((0.18, 0.02, 0.98), K_G)),
                           L=(wr("L", 0.030, -0.255, 1.080, POLE_L), hand_or((-0.10, -0.80, 0.60), (-0.95, -0.10, 0.20))), lamp=(3, 0, 0),
                           **mant(-3.0))
    K["c3_h"] = guard_pose(torso=T(hips=(-2, 0, 0), spine=(-4, 0, 0), chest=(-8, 0, 0), neck=(-2, 0, 0), head=(-8, 0, 0)), hips=(0, 0.01, -0.02),
                           feet=(ft(dx=0.03, side="L"), ft(dx=-0.03, side="R")),
                           R=(wr("R", -0.470, -0.140, 1.090, (-0.6, 0.6, -0.5)), staff_or((0.10, -0.05, 0.99), (0.0, -1.0, 0.0))),
                           L=(wr("L", 0.470, -0.140, 1.090, (0.6, 0.6, -0.5)), hand_or((0.20, -0.10, 0.97), (0.95, -0.30, -0.05))),
                           lamp=(-6, -10, 0), **mant(30.0, 4.0))
    K["c3_f"] = guard_pose(torso=T(hips=(-2, 0, 0), spine=(-4, 0, 0), chest=(-9, 0, 0), neck=(-2, 0, 0), head=(-9, 0, 0)), hips=(0, 0.01, -0.024),
                           feet=(ft(dx=0.03, side="L"), ft(dx=-0.03, side="R")),
                           R=(wr("R", -0.480, -0.130, 1.085, (-0.6, 0.6, -0.5)), staff_or((0.12, -0.05, 0.99), (0.0, -1.0, 0.0))),
                           L=(wr("L", 0.480, -0.130, 1.080, (0.6, 0.6, -0.5)), hand_or((0.22, -0.10, 0.97), (0.95, -0.30, -0.05))),
                           lamp=(3, 4, 0), **mant(34.0, 5.0))
    # cast_ult Every Window Lit: gathered low, then BOTH HANDS OVERHEAD on her toes (the staff high, the lamp above her
    # head), the mantle flaring; the tip circles; at the bloom the arms open wide in a Y, the lamp the star over her
    toes = (ft(side="L", pitch=-24, dz=0.0), ft(side="R", pitch=-24, dz=0.0))
    K["u_gat"] = guard_pose(torso=T(hips=(6, 0, 0), spine=(7, 0, 0), chest=(7, 0, 0), neck=(4, 0, 0), head=(9, 0, 0)), hips=(0, 0.01, -0.08),
                            R=(wr("R", -0.180, -0.250, 0.960, POLE_R), staff_or((0.12, 0.05, 0.99), K_G)),
                            L=(wr("L", 0.040, -0.250, 0.980, POLE_L), hand_or((-0.40, -0.80, 0.30), (0.05, 0.12, 1.0))), lamp=(4, 0, 0),
                            **mant(-4.0))

    def raise_(phi, w=1.0):
        a = math.radians(phi)
        u = (0.22 + 0.10 * math.sin(a) * w, -0.08 - 0.10 * math.cos(a) * w, 0.97)
        return guard_pose(torso=T(hips=(-3, 0, 0), spine=(-5, 0, 0), chest=(-9, 0, 0), neck=(-6, 0, 0), head=(-16, 0, 0)),
                          hips=(0, 0.0, 0.050), feet=toes,
                          R=(wr("R", -0.250, -0.130, 1.340, (-0.9, 0.0, -0.2)), staff_or(u, (0.45, -0.89, 0.0))),
                          L=(wr("L", 0.030, -0.140, 1.320, (0.9, 0.0, -0.2)), hand_or((-0.40, -0.10, 0.91), (-0.90, -0.30, 0.20))),
                          lamp=(-6 * math.cos(a) * w, 6 * math.sin(a) * w, 0), **mant(18.0 + 4.0 * w))
    K["u_raise"] = raise_(0.0)
    K["u_star"] = guard_pose(torso=T(hips=(-3, 0, 0), spine=(-6, 0, 0), chest=(-11, 0, 0), neck=(-6, 0, 0), head=(-18, 0, 0)), hips=(0, 0.0, 0.048),
                             feet=toes, R=(wr("R", -0.290, -0.120, 1.340, (-0.8, 0.2, -0.2)), staff_or((0.10, -0.10, 0.99), (0.45, -0.89, 0.0))),
                             L=(wr("L", 0.320, -0.100, 1.320, (0.7, 0.4, -0.4)), hand_or((0.55, -0.20, 0.81), (0.60, -0.55, -0.55))),
                             lamp=(-4, -4, 0), **mant(34.0, 4.0))
    K["u_star2"] = guard_pose(torso=T(hips=(-3, 0, 0), spine=(-6, 0, 0), chest=(-11, 0, 0), neck=(-6, 0, 0), head=(-17, 0, 0)), hips=(0, 0.0, 0.044),
                              feet=toes, R=(wr("R", -0.295, -0.120, 1.335, (-0.8, 0.2, -0.2)), staff_or((0.10, -0.10, 0.99), (0.45, -0.89, 0.0))),
                              L=(wr("L", 0.325, -0.100, 1.310, (0.7, 0.4, -0.4)), hand_or((0.55, -0.20, 0.81), (0.60, -0.55, -0.55))),
                              lamp=(2, 2, 0), **mant(30.0, 3.0))
    # the lobby: the lamp drawn in before her (the left hand can reach it), the four tending beats
    K["lb"] = guard_pose(torso=T(hips=(1, -2, 0), spine=(3, 2, 0), chest=(4, 5, 0), neck=(2, 0, 0), head=(5, 4, 0)), hips=(0, 0.01, -0.024),
                         R=(wr("R", -0.250, -0.230, 1.020, POLE_R), staff_or((0.20, 0.0, 0.98), (0.55, -0.83, 0.0))))
    K["lb_up"] = guard_pose(torso=T(hips=(0, -2, 0), spine=(1, 2, 0), chest=(1, 5, 0), neck=(0, 0, 0), head=(2, 6, 0)), hips=(0, 0.01, -0.02),
                            R=(wr("R", -0.250, -0.240, 1.140, POLE_R), staff_or((0.24, -0.02, 0.97), (0.55, -0.83, 0.0))))
    # victory: the lamp held out at arm's length toward the camera, the left hand over her chest, a slight bow
    K["v_c"] = guard_pose(torso=T(hips=(4, 0, 0), spine=(4, 0, 0), chest=(4, 0, 0), head=(6, 0, 0)), hips=(0, 0.01, -0.05))
    K["v_up"] = guard_pose(torso=T(hips=(3, 8, 0), spine=(5, 6, 0), chest=(6, 8, 0), neck=(2, -4, 0), head=(10, -6, 4)), hips=(0, -0.01, -0.035),
                           feet=(ft(dy=-0.06, side="L"), FR0),
                           R=(wr("R", -0.210, -0.300, 1.060, (-0.9, 0.2, -0.4)), staff_or((0.34, -0.56, 0.76), (0.0, -0.80, -0.60))),
                           L=(wr("L", 0.040, -0.150, 1.060, POLE_L), hand_or((-0.85, -0.25, 0.45), (0.0, 0.95, 0.1))), lamp=(-8, 0, 0),
                           **mant(8.0))
    # recall / stunned / channel / taunt / dash
    K["rc"] = guard_pose(torso=T(hips=(3, 0, 0), spine=(6, 0, 0), chest=(8, 0, 0), neck=(6, 0, 0), head=(14, 0, 0)), hips=(0, 0.01, -0.05),
                         R=(wr("R", -0.230, -0.220, 0.990, POLE_R), staff_or((0.24, 0.04, 0.97), (0.55, -0.83, 0.0))),
                         L=(wr("L", 0.030, -0.260, 1.060, POLE_L), hand_or((-0.15, -0.80, 0.55), (-0.95, -0.10, 0.20))), lamp=(2, 0, 0))
    K["st"] = guard_pose(torso=T(hips=(3, 0, 0), spine=(6, 0, 0), chest=(6, 0, 0), neck=(6, 0, 0), head=(10, 0, 0)), hips=(0, 0.01, -0.06),
                         R=(wr("R", -0.220, -0.210, 0.980, POLE_R), staff_or((0.26, 0.06, 0.96), (0.55, -0.83, 0.0))),
                         L=(wr("L", 0.030, -0.250, 1.040, POLE_L), hand_or((-0.10, -0.80, 0.60), (-0.95, -0.10, 0.20))), lamp=(4, 0, 0))
    K["ch"] = guard_pose(torso=T(hips=(0, 0, 0), spine=(-2, 0, 0), chest=(-3, 0, 0), head=(2, 0, 0)),
                         R=(wr("R", -0.240, -0.250, 1.130, POLE_R), staff_or((0.24, -0.06, 0.97), (0.55, -0.83, 0.0))),
                         L=(wr("L", 0.040, -0.260, 1.150, POLE_L), hand_or((-0.10, -0.80, 0.60), (-0.95, -0.10, 0.20))), lamp=(0, 0, 0))
    K["tu"] = guard_pose(torso=T(hips=(0, 4, 0), spine=(-2, 4, 0), chest=(-4, 6, 0), neck=(0, -6, 10), head=(-6, -10, 16)),
                         R=(wr("R", -0.280, -0.200, 1.280, (-0.9, 0.1, -0.3)), staff_or((0.12, -0.08, 0.99), K_G)),
                         L=(wr("L", 0.160, -0.100, 0.960, POLE_L), hand_or((-0.2, -0.3, -0.93), (0.95, 0.1, 0.1))), lamp=(-4, 3, 0))
    K["dl"] = guard_pose(torso=T(hips=(14, 0, 0), spine=(8, 0, 0), chest=(6, 0, 0), neck=(-10, 0, 0), head=(-10, 0, 0)), hips=(0, -0.05, -0.07),
                         feet=(ft(dy=-0.26, dz=0.05, pitch=10, side="L"), ft(dy=0.26, dz=0.02, pitch=-26, side="R")),
                         R=(wr("R", -0.300, -0.200, 1.000, POLE_R), staff_or((0.16, 0.10, 0.98), K_G)),
                         L=(wr("L", 0.040, -0.230, 1.020, POLE_L), hand_or((-0.10, -0.80, 0.60), (-0.95, -0.10, 0.20))), lamp=(-14, 0, 0),
                         **mant(4.0, -10.0))
    return K


def clip_overrides(ctx) -> dict:
    osc = anim.osc
    add = anim.add
    P_ = anim.P
    out = {}
    K = key_poses()
    G = K["guard"]
    g = G

    # idle: the lamp tended at the chest; breath, a 2-degree shoulder sway, the lamp's slow swing, the panels breathing
    def idle(t):
        b, s = osc(t, 2), osc(t, 1, 0.1)
        p = add(G, P_(chest=(1.0 * b, 0, 0), spine=(0.4 * b, 0, 1.2 * s), neck=(-0.6 * b, 0, 0), head=(-0.5 * b, 1.4 * s, 0),
                      shoulder_L=(0, 0, 1.2 * b), shoulder_R=(0, 0, -1.2 * b), hips=(0, 1.0 * s, -0.8 * s),
                      x_mantle_l=(0.8 * s, 0, 1.0 * b), x_mantle_r=(-0.8 * s, 0, -1.0 * b)))
        p = _nudge(p, (0.0, 0.0, 0.008 * osc(t, 2, 0.05)), (0.0, 0.0, 0.010 * osc(t, 2, 0.12)))
        p["lamp"] = (2.5 * osc(t, 1, 0.3), 1.5 * osc(t, 1, 0.55), 0.0)
        hx, hy, hz = p["hips_loc"]
        p["hips_loc"] = (hx + 0.010 * s, hy, hz - 0.004 * (0.5 + 0.5 * b))
        return p
    out["idle"] = anim.Clip("idle", 72, True, idle)

    # run: the generator's legs at 3.35 m/s; the lamp carried close before her chest, the left hand at its side, the
    # panels trailing (the striding knee carries its panel: the resolve wrapper)
    base_run = anim.gen_run(MOTION)

    def run(t):
        p = dict(base_run.sample(t))
        ik = {k: v for k, v in p.get("ik", {}).items() if k.startswith("foot")}
        q = t % 1.0
        sw = math.cos(2 * math.pi * (q - 0.03))
        ik["hand.R"] = wr("R", -0.315, -0.165 - 0.020 * sw, 1.105 + 0.010 * abs(sw), POLE_R)
        ik["orient.R"] = staff_or((0.14, 0.06 + 0.03 * sw, 0.99), K_G)
        ik["hand.L"] = wr("L", 0.030 + 0.010 * sw, -0.210 - 0.015 * sw, 1.140 + 0.012 * abs(sw), POLE_L)
        ik["orient.L"] = hand_or((-0.10, -0.70, 0.70), (-0.96, -0.05, 0.15))
        p["ik"] = ik
        p["lamp"] = (-8.0 + 3.0 * math.sin(4 * math.pi * q), 2.0 * sw, 0.0)
        p["x_mantle_l"] = (-6.0, 0.0, 2.0)
        p["x_mantle_r"] = (-6.0, 0.0, -2.0)
        return p
    out["run"] = anim.Clip("run", base_run.frames, True, run, meta=base_run.meta)

    out["attack1"] = strike("attack1", 20, K["a1_w"], K["a1_h"], K["a1_f"])
    # crit: the flick, bigger, with a step in
    wc = anim.lerp_pose(G, K["a1_w"], 1.35)
    hc = anim.lerp_pose(G, K["a1_h"], 1.25)
    hc["ik"] = dict(hc["ik"])
    hc["ik"]["foot.L"] = ft(dy=-0.16, side="L")
    hc["hips_loc"] = (0.0, -0.07, -0.05)
    fc = anim.lerp_pose(G, K["a1_f"], 1.25)
    fc["ik"] = dict(fc["ik"])
    fc["ik"]["foot.L"] = ft(dy=-0.16, side="L")
    fc["hips_loc"] = (0.0, -0.075, -0.052)
    out["crit"] = strike("crit", 25, wc, hc, fc)
    out["attack2"] = strike("attack2", 20, K["a2_w"], K["a2_h"], K["a2_f"])

    # cast_a1 Glint Bolt (25 f, impact f10): wound in to f6, the thrust lands at f10 (one long arm, the lamp at its
    # end), held to f16, drawn back, guard by f25
    wa, ha, fa = K["c1_w"], K["c1_h"], K["c1_f"]
    keys = [(0.0, g, "linear"), (0.08, anim.lerp_pose(g, wa, 0.5), "inout"), (0.24, wa, "inout"),
            (0.40, ha, "accel"), (0.50, anim.lerp_pose(ha, fa, 0.4), "out"), (0.64, fa, "inout"),
            (0.82, anim.lerp_pose(fa, g, 0.6), "inout"), (1.0, g, "settle")]
    out["cast_a1"] = keyed_clip("cast_a1", 25, keys, lags={"head": 1.5, "neck": 1.0}, impact=anim.IMPACT)

    # cast_a2 Hung Lamp (30 f, impact f12): both arms rise (f0-f9), the right carries the lamp up and out before her,
    # at f12 it is hung high and the left hand opens upward; raised to f20, guard by f30
    w2a, h2a, f2a = K["c2_w"], K["c2_h"], K["c2_f"]
    keys = [(0.0, g, "linear"), (0.07, anim.lerp_pose(g, w2a, 0.3), "inout"), (0.30, w2a, "inout"),
            (0.40, h2a, "accel"), (0.50, anim.lerp_pose(h2a, f2a, 0.4), "out"), (0.67, f2a, "inout"),
            (0.84, anim.lerp_pose(f2a, g, 0.65), "inout"), (1.0, g, "settle")]
    out["cast_a2"] = keyed_clip("cast_a2", 30, keys, lags={"head": 1.5, "neck": 1.0}, impact=anim.IMPACT)

    # cast_a3 Dawnglass Shell (20 f, impact f8, castTime 0: 3 frames of anticipation): cupped, then arms wide, palms
    # out, the bell flared open; guard by f20
    keys = [(0.0, g, "linear"), (0.15, K["c3_c"], "out"), (0.40, K["c3_h"], "accel"), (0.55, K["c3_f"], "out"),
            (0.78, anim.lerp_pose(K["c3_f"], g, 0.6), "inout"), (1.0, g, "settle")]
    out["cast_a3"] = keyed_clip("cast_a3", 20, keys, lags={"head": 1.0}, impact=anim.IMPACT)

    # cast_ult Every Window Lit (45 f, impact f18): gathered (f3), both hands overhead on her toes (f12), the tip
    # circles (f12-f17), at f18 the arms open wide with the lamp high (the bloom); held to f30, rest by f45
    def raise_(phi, w=1.0):
        r = K["u_raise"]
        a = math.radians(phi)
        p = dict(r)
        p["ik"] = dict(r["ik"])
        p["ik"]["orient.R"] = staff_or((0.22 + 0.10 * math.sin(a) * w, -0.08 - 0.10 * math.cos(a) * w, 0.97), (0.45, -0.89, 0.0))
        p["lamp"] = (-6 * math.cos(a) * w, 6 * math.sin(a) * w, 0)
        return p
    keys = [(0.0, g, "linear"), (0.07, K["u_gat"], "inout"), (0.27, raise_(0.0), "inout"), (0.31, raise_(90.0), "linear"),
            (0.35, raise_(180.0), "linear"), (0.38, raise_(270.0, 0.6), "linear"), (0.40, K["u_star"], "out"),
            (0.50, K["u_star2"], "out"), (0.667, K["u_star2"], "linear"), (0.85, anim.lerp_pose(K["u_star2"], g, 0.7), "inout"),
            (1.0, g, "settle")]
    base_u = anim.keyed(keys)

    def ult(t):
        p = base_u(t)
        if 0.42 < t < 0.68:
            k = math.sin(math.pi * (t - 0.42) / 0.26)
            p = add(p, P_(chest=(0.7 * k * osc(t, 7), 0, 0), head=(0.5 * k * osc(t, 9), 0, 0)))
        return p
    out["cast_ult"] = anim.Clip("cast_ult", 45, False, anim.drag(ult, 45, {"head": 1.5, "neck": 1.0}), impact=anim.IMPACT)

    # death (50 f): a stagger, the knees give, she lays the staff down before her so the lamp comes to rest upright on
    # the ground (held there a beat), then bows over it, head down over her knees (the chimney forward, not sideways)
    hip_h = LAY["hip"][2]
    kneel_feet = (anim.FootTarget((0.03, 0.30, 0.055), -62.0, 4.0), anim.FootTarget((-0.03, 0.31, 0.055), -62.0, -6.0))
    recoil = guard_pose(torso=T(hips=(-5, 6, 0), spine=(-8, 2, 0), chest=(-12, 4, 0), neck=(-8, 0, 0), head=(-16, 6, 0)), hips=(0, 0.05, -0.02),
                        R=(wr("R", -0.300, -0.200, 1.040, POLE_R), staff_or((0.15, 0.04, 0.99), K_G)),
                        L=(wr("L", 0.080, -0.140, 1.060, POLE_L), hand_or((-0.6, -0.3, 0.7), (-0.2, 0.9, 0.2))), lamp=(10, -4, 0),
                        **mant(6.0))
    buckle = pose(torso=dict(hips=(6, 4, 0), spine=(8, 0, 0), chest=(8, 0, 0), neck=(6, 0, 0), head=(12, 4, 0)),
                  hips=(0.0, 0.10, -hip_h * 0.40), feet=kneel_feet,
                  R=(wabs(-0.220, -0.300, 0.640, POLE_R), staff_or((0.10, -0.30, 0.95), K_G, world=True)),
                  L=(wabs(0.120, -0.200, 0.640, POLE_L), hand_or((-0.3, -0.6, -0.7), (0.1, 0.6, -0.8), world=True)), lamp=(-6, 4, 0))
    setdown = pose(torso=dict(hips=(12, 2, 0), spine=(18, 0, 0), chest=(16, 0, 0), neck=(8, 0, 0), head=(14, 2, 0)),
                   hips=(0.0, 0.12, -hip_h * 0.44), feet=kneel_feet,
                   R=(wabs(-0.200, -0.300, 0.300, POLE_R), staff_or((0.05, -0.90, 0.43), (0.0, -0.43, -0.90), world=True)),
                   L=(wabs(0.100, -0.320, 0.200, POLE_L), hand_or((0.0, -0.8, -0.6), (0.0, 0.5, -0.86), world=True)), lamp=(0, 0, 0))
    fold = pose(torso=dict(hips=(16, 0, 0), spine=(28, 0, 0), chest=(26, 0, 0), neck=(14, 0, 0), head=(16, 0, 0)),
                hips=(0.0, 0.14, -hip_h * 0.52), feet=kneel_feet,
                R=(wabs(-0.210, -0.310, 0.260, POLE_R), staff_or((0.05, -0.92, 0.39), (0.0, -0.39, -0.92), world=True)),
                L=(wabs(0.140, -0.400, 0.060, POLE_L), hand_or((0.1, -0.95, -0.2), (0.0, 0.2, -0.98), world=True)), lamp=(0, 0, 0))
    rest = pose(torso=dict(hips=(17, 0, 0), spine=(30, 0, 0), chest=(28, 0, 0), neck=(16, 0, 0), head=(20, 0, 0)),
                hips=(0.0, 0.14, -hip_h * 0.53), feet=kneel_feet,
                R=(wabs(-0.210, -0.315, 0.250, POLE_R), staff_or((0.05, -0.92, 0.39), (0.0, -0.39, -0.92), world=True)),
                L=(wabs(0.145, -0.430, 0.045, POLE_L), hand_or((0.1, -0.95, -0.2), (0.0, 0.2, -0.98), world=True)), lamp=(0, 0, 0))
    keys = [(0.0, g, "linear"), (0.12, recoil, "snap"), (0.34, buckle, "inout"), (0.54, setdown, "inout"), (0.68, setdown, "linear"),
            (0.84, fold, "in"), (0.91, anim.lerp_pose(fold, rest, 1.4), "out"), (1.0, rest, "settle")]
    out["death"] = keyed_clip("death", 50, keys, lags={"head": 2.0, "neck": 1.0})

    # recall (60 f loop): she cups the lamp and bows over it
    rc = K["rc"]

    def recall(t):
        b = osc(t, 2)
        p = add(rc, P_(chest=(1.2 * b, 0, 0), head=(-0.8 * b, 0, 0)))
        p = _nudge(p, (0, 0, 0.004 * b), (0.0, -0.006 * osc(t, 1), 0.008 * osc(t, 2, 0.2)))
        p["lamp"] = (1.5 * osc(t, 1, 0.2), 1.0 * osc(t, 1, 0.45), 0)
        return p
    out["recall"] = anim.Clip("recall", 60, True, recall)

    # idle_lobby (120 f loop, first = last): she tends the lamp in four beats: draws it in and lifts the cap (the left
    # fingers at its top), trims the wick (small pinches), cups it against a draught (turned from it, the panels
    # stirring), then lifts it to her face and peers at the light, the visor tilted; a side-to-side sway throughout
    lb, lb_up = K["lb"], K["lb_up"]
    L_low = G_L
    L_cap = (wr("L", 0.020, -0.290, 1.200, POLE_L), hand_or((-0.30, -0.40, -0.86), (0.0, 0.1, -1.0)))
    L_trim = (wr("L", 0.010, -0.300, 1.170, POLE_L), hand_or((-0.55, -0.80, -0.10), (0.1, -0.1, -1.0)))
    L_cup = (wr("L", 0.030, -0.280, 1.100, POLE_L), hand_or((-0.10, -0.80, 0.60), (-0.95, -0.10, 0.20)))
    L_rest = (wr("L", 0.190, -0.120, 0.930, POLE_L), hand_or((0.10, -0.30, -0.95), (0.90, 0.20, 0.10)))
    lob = [(0.00, lb, L_low, (0, 0, 0), 0.0, 0.0), (0.12, lb, L_cap, (2, 0, 0), 4.0, 6.0), (0.26, lb, L_cap, (-2, 0, 0), 6.0, 8.0),
           (0.38, lb, L_trim, (-3, 0, 0), 10.0, 12.0), (0.50, lb, L_trim, (2, 0, 0), 12.0, 12.0),
           (0.60, lb, L_cup, (0, 4, 0), -6.0, 4.0), (0.70, lb_up, L_rest, (-2, -3, 0), -16.0, 10.0),
           (0.84, lb_up, L_rest, (2, 2, 0), -18.0, 12.0), (1.00, lb, L_low, (0, 0, 0), 0.0, 0.0)]
    lkeys = []
    for t0, base, L, lamp, tilt, nod in lob:
        p = dict(base)
        p["ik"] = dict(base["ik"])
        p["ik"]["hand.L"], p["ik"]["orient.L"] = L
        p["lamp"] = lamp
        p = add(p, P_(head=(nod, -tilt * 0.5, tilt), neck=(nod * 0.3, 0, tilt * 0.3)))
        lkeys.append((t0, p, "inout"))
    lob_fn = anim.keyed(lkeys)

    def lobby(t):
        p = lob_fn(t)
        s = osc(t, 2)
        b = osc(t, 4)
        trim = math.sin(2 * math.pi * 6 * t) * ss(0.36, 0.40, t) * ss(0.54, 0.50, t)
        p = add(p, P_(hips=(0, 3.0 * s, -3.5 * s), spine=(0.8 * b, -1.5 * s, 2.0 * s), chest=(1.2 * b, -1.0 * s, 1.5 * s),
                      x_mantle_l=(1.5 * s, 0, 2.0 + 2.0 * s), x_mantle_r=(-1.5 * s, 0, -2.0 + 2.0 * s)))
        p = _nudge(p, (0, 0, 0), (0.0, 0.0, 0.012 * trim))
        hx, hy, hz = p["hips_loc"]
        p["hips_loc"] = (hx + 0.026 * s, hy, hz - 0.006 * abs(s))
        return p
    out["idle_lobby"] = anim.Clip("idle_lobby", 120, True, lobby)

    # victory (60 f, held): the lamp held out at arm's length toward the camera, the left hand over her chest, a bow
    vc, vu = K["v_c"], K["v_up"]
    vu2 = anim.lerp_pose(vu, vu, 1.0)
    vu2["lamp"] = (0, 0, 0)
    vbase = anim.keyed([(0.0, g, "linear"), (0.18, vc, "inout"), (0.42, vu, "back"), (0.62, vu2, "inout"), (1.0, vu2, "linear")])
    vbase = anim.drag(vbase, 60, {"head": 2.0, "neck": 1.0})

    def victory(t):
        p = vbase(t)
        if t > 0.5:
            k = min(1.0, (t - 0.5) / 0.15)
            p = add(p, P_(chest=(0.8 * k * osc(t, 2), 0, 0)))
            p["lamp"] = (1.5 * k * osc(t, 1.5, 0.2), 0.0, 0.0)
        return p
    out["victory"] = anim.Clip("victory", 60, False, victory)

    out["dash"] = keyed_clip("dash", 15, [(0.0, g, "linear"), (0.3, K["dl"], "snap"), (0.75, K["dl"], "linear"), (1.0, g, "inout")])

    sl = K["st"]

    def stunned(t):
        a, b = osc(t, 1), osc(t, 1, 0.25)
        p = add(sl, P_(hips=(0, 0, 3 * a), spine=(2 * b, 0, -2 * a), chest=(2 * b, 0, -2 * a), neck=(5 * b, 0, 5 * a),
                       head=(7 * b, 4 * a, 7 * a)))
        p["lamp"] = (3 * b, 4 * a, 0)
        return p
    out["stunned"] = anim.Clip("stunned", 40, True, stunned)

    chp = K["ch"]

    def channel(t):
        p = add(chp, P_(chest=(1.2 * osc(t, 2), 0, 0), head=(-0.8 * osc(t, 2), 0, 0)))
        p["lamp"] = (2 * osc(t, 1), 1.5 * osc(t, 1, 0.3), 0)
        return p
    out["channel"] = anim.Clip("channel", 40, True, channel)

    out["taunt"] = keyed_clip("taunt", 40, [(0.0, g, "linear"), (0.30, K["tu"], "back"), (0.75, K["tu"], "linear"), (1.0, g, "inout")],
                              lags={"head": 2.0})
    return out


if __name__ == "__main__":
    fighter.main(sys.modules[__name__])
