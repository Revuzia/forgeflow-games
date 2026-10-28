"""lisvel: Morning archer (Slinger, Aubade). ART 2.0: sculpted volumes fitted to the concept, painted by hand in code.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/lisvel_fit.py
    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/lisvel_pose.py
    python3 art/build.py fighter lisvel --no-skins --clip-sheet

Brief: _design/fighters/lisvel.md. Concept: _design/concept/lisvel.webp (front + back, hand-painted).
The forms are numpy SDF volumes (common/hifi/sdf.py) fitted to the concept on a 10 cm grid (the head-wrap crown 1.85
m = the plates' scale, proto/lisvel_fit.py). FIX PASS 1: the base colour is painted procedurally part by part in the
concept's own material colours (post_paint: PAINT_BASE, the skins' PAINT_SKIN), not projected: the concept's bow
crosses both figures and its arms stand elsewhere than the model's, so the projection left grey torn patches, black
splotches and ragged ink on the tabard, the sleeves and the quiver (review item 2). Normals and AO bake from the sculpt.

Where the concept and the brief disagree the concept's look wins (it is the approved painting): the chalk head-wrap
wound as a turban over a carved chalk face-plate with a flat pale-blue glass visor band, the pale linen cowl, the
steel-blue tabard with grey trims over a linen tunic, white linen sleeves, dark wrapped bracers on both forearms,
crossed leather straps and a belt, a brown leather quiver in a two-part holster on the RIGHT hip (the drawing hand's
side), dark leggings in tall dark boots, and the pale recurve held level across her front, string up (the S "wave"
of its limbs: a long flat riser, the limbs sweeping up to meet the string tangentially, a glass hook past each nock).
The brief wins on size and on the game read: the bow is 1.76 m tip to tip with 0.07 m glass hooks (about 1.95 m
along the limbs), flat ash strips 6 cm wide and 2.5 cm thick with bevels; the glass tip caps hold the only accent (a
thin inlay); the visor is a flat glass slab 5 cm tall standing 3.4 cm proud of the face (the beak) over an ink
recess; the string is the only non-rigid prop part (x_string); the arrows of a shot are VFX.

The game read in the lane facings (review item 8): a bow held in her frontal plane is edge-on when she faces left or
right, so the guard is an archer's ready stance, the body turned 50 degrees (the bow across her turned chest: its
chord ~50 degrees off her lateral axis, a long diagonal in every facing), and the run carries the bow along her
left hip pointing forward (a long horizontal in the lane facings).

Not in the shared pipeline, implemented here (module-level wrappers; common/ untouched):
  * the arms' rest pose on the concept's carry, prop.L on the bow's grip (+Y = the shot, +Z = the upper limb), prop.R
    on the string pinch, x_string (the string's draw), x_fan (Morning Draw's fan of arrows), sockets;
  * the bow hand BH: solved so the arrow line runs through an anchor beside the right jaw (review item 5: the draws
    pulled to the centreline, the hand in the throat and the string through the visor); the drawing hand RH blends
    between a free reach and a pinch on that arrow line (anim._solve_hand wrapper); an aim with roll for the bow;
  * x_string location, x_fan scale, prop.L slide and the death's dropped bow keyed from per-pose channels ("_str",
    "_fan", "_slide", "_drop") in every clip and in every posed render (anim.write_action / anim.apply_pose wrappers);
  * analytic skin weights for the tabard's lower panels, the linen tunic, the sleeves and the string;
  * the paint pass (project.paint_object wrapper), x_fan's rest scale 0 in the shipped GLB (export.optimize wrapper),
    the base splash's line of light (render.fighter_renders wrapper).
"""
from __future__ import annotations

import dataclasses
import math
import os
import sys
from dataclasses import dataclass

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy  # noqa: E402,F401
import numpy as np  # noqa: E402
from mathutils import Matrix, Quaternion, Vector  # noqa: E402,F401

from common import anim, fighter, materials, rig, scene  # noqa: E402
from common.hifi import sdf  # noqa: E402
from common.hifi.sdf import (Capsule, Ellipsoid, FlatCapsule, HalfSpace, RoundBox, RoundCone,  # noqa: E402
                             Sculpt, Sphere, Torus, Tube)

V = Vector
ID = "lisvel"
TITLE = "Morning archer"
ROLE_MASS = "slinger"
ORIGIN = "aubade"
CARD = {"primary": "#D8D2C2", "secondary": "#8E9AA6"}

# rig fitted to the sculpt: the head's crown under the wrap 1.86, skull base 1.628, neck base 1.568, shoulder joints
# x 0.185 at 1.478, hips x 0.095 at 0.95, knees 0.50, ankles x 0.145 at 0.09. The arms are re-placed in rig_extras.
PROPORTIONS = rig.proportions(height=1.86, head=0.27, neck=0.06, shoulder_width=0.37, hip_width=0.19, leg=0.861,
                              thigh_frac=0.52, arm=0.56, upper_arm_frac=0.51, hand=0.19, foot=0.26,
                              ankle_height=0.09, spine_curve=0.02, stance=0.05, toe_out_deg=8.0, knee_bend=0.015,
                              a_pose_deg=62.0, arm_forward_deg=10.0, elbow_bend_deg=20.0, shoulder_drop=0.09)
MATERIAL_SET = "bible"
# the material roles (the baked base colour is post_paint's; these feed the Blender materials' finish and the accent)
PALETTE = materials.bible_palette(chalk="#BDB8AD", dawnglass="#A8C3D6", wood="#C6BDAB", cloth2="#ADA8A0",
                                  stone="#A9B6C0", cloth="#5B6670", leather="#3F3630", under="#262120",
                                  ink="#17181B", accent="#3F9CFF", ironstone="#4A4743", skin="#B48F78",
                                  wrap="#ABA79F", boots="#2C2926", quiver="#5A4A3C", linen="#8A867E", rope="#9A8F7A",
                                  fletching="#A9B6C0")
VALUE_GRADIENT_STOPS = materials.BIBLE_GRADIENT_STOPS
SOCKETS = {"weapon": "prop.R", "arrow_nock": "x_arrow_nock", "bow_tip_l": "x_bow_tip_l", "bow_tip_r": "x_bow_tip_r",
           "weapon_tip": "x_arrow_nock", "quiver": "x_quiver"}
SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92, "yaw": 22.0, "pitch": -2.0, "rim_cool": 0.35, "rim_warm": 0.45,
          "portrait_clip": "idle_lobby", "portrait_t": 0.0, "portrait_yaw": 28.0}
TEXTURE_SIZE = 2048
TEXTURE_SIZES = {"normal": 512, "orm": 256}
GLB_COMPRESS = True
ARMOUR_CONFORM = False
AO_INTO_BASE = 0.25

HEIGHT = 1.85             # the head-wrap crown in the concept (the plates' scale, the fit check)
PROJECTION = {"concept": "lisvel", "height": HEIGHT}     # the paint hook (post_paint paints every part itself)
NOISE = sdf.Noise(12)
VOXEL = 0.007
ART_HEIGHT_PAD = 0.05     # FighterArt.height = mesh top + 5 cm (the HP bar's anchor - 0.35 m; the load test allows 6)

# skins (brief section 9): each skin is painted in its own colours by post_paint (PAINT_SKIN); the palettes below are
# the brief's role tables (the Blender materials' finish) and every skin has its own splash composition (review 7)
SKINS: list = [
    {"id": "lisvel_gorgewalk", "extra": {"rope_bind": True}, "card": {"primary": "#6E747C", "secondary": "#9A8F7A"},
     "palette": {"wood": "#6E747C", "rope": "#9A8F7A", "ironstone": "#3F4348", "chalk": "#D2D2CE", "cloth": "#56604F",
                 "quiver": "#545A61"},
     "splash": {"map": "map_bridge", "clip": "cast_a1", "t": 0.34, "yaw": 34.0, "pitch": -7.0}},
    {"id": "lisvel_almanac", "extra": {"page_fletching": True}, "card": {"primary": "#4A4640", "secondary": "#D8CDB4"},
     "palette": {"wood": "#D8CDB4", "fletching": "#2E2A26", "cloth": "#8C8577", "quiver": "#3A3430"},
     "splash": {"map": "map_fray", "clip": "cast_a3", "t": 0.44, "yaw": 14.0, "pitch": -4.0}},
]
SKIN_FLAT = {}


def _n(v):
    v = np.asarray(v, dtype=np.float64)
    return v / (np.linalg.norm(v) + 1e-12)


# ── fitted geometry (metres; the model faces -Y, her right = -X) ─────────────────────────────────────────────────
# THE BOW. Its frame: U along the chord (toward her left tip at rest), D from the string toward the grip (the shot's
# direction; at rest forward and down: the bow's plane tilted BETA from the vertical, belly forward), N = U x D.
BETA = 18.0
U_REST = np.array([1.0, 0.0, 0.0])
D_REST = np.array([0.0, -math.sin(math.radians(BETA)), -math.cos(math.radians(BETA))])
N_REST = np.cross(U_REST, D_REST)
S0 = np.array([0.05, -0.170, 1.200])                 # the string's centre at rest (the nock point)
BRACE = 0.27                                          # string -> grip (the riser's depth below the string)
HALF = 0.88                                           # half the chord: 1.76 m tip to tip (+ 2 x 7 cm glass hooks)
# the concept's limb (measured on the sheet, |u| / half): a flat riser to 0.34, the limb sweeping up as a smooth S to
# meet the string line tangentially at 0.972 (the "wave"), then the glass hook curling 3.4 cm above the string line
PS0, PS1 = 0.34, 0.972
NOCK_U = PS1 * HALF                                   # 0.855: where the string meets each tip
TIP_U = 0.93                                          # the hook's end
HOOK = 0.034
GRIP_L = S0 + D_REST * BRACE                          # the grip's centre (prop.L)
# the limb section (full sizes by |u|): W across the bow's plane (the flat faces: belly and back), T in the plane
LIMB_W = ((0.0, 0.064), (0.28, 0.062), (0.45, 0.058), (0.70, 0.052), (0.86, 0.048), (0.93, 0.024))
LIMB_T = ((0.0, 0.046), (0.26, 0.042), (0.33, 0.027), (0.55, 0.024), (0.86, 0.018), (0.93, 0.008))
CHAMFER = 0.0065                                      # the bevels along the strip's four edges
CAP0 = 0.800                                          # the glass hook cap from |u| 0.80 to the end
INLAY0 = CAP0                                         # the accent: an inlay panel on both broad faces of each cap
PINCH_U = -0.12                                       # the right hand's pinch on the string at rest
HAND_U = 0.16                                         # the left fist at rest: on the riser beside the grip (the
                                                      # painting's); in a shot the bow slides (prop.L location,
                                                      # "_slide") so the grip's centre comes into the fist


def _tab(tab, au):
    a, b = zip(*tab)
    return np.interp(np.abs(au), a, b)


def prof_v(u):
    """the limb centreline's distance from the string line toward the belly side (+D) at chord position u"""
    au = np.abs(np.asarray(u, dtype=np.float64))
    t = np.clip((au / HALF - PS0) / (PS1 - PS0), 0.0, 1.0)
    v = BRACE * (1.0 - t * t * (3.0 - 2.0 * t))
    hk = np.clip((au - NOCK_U) / (TIP_U - NOCK_U), 0.0, None)
    return v - HOOK * hk * hk


def dprof(au):
    e = 1e-3
    return (prof_v(au + e) - prof_v(np.maximum(au - e, 0.0))) / (au + e - np.maximum(au - e, 0.0))


def bow_pt(u, v_extra=0.0, n=0.0, S=S0, U=U_REST, D=D_REST, N=N_REST):
    """a point of the bow (rest frame by default): along the chord u, the limb's centreline + v_extra toward the
    belly, n across the plane"""
    return S + U * u + D * (prof_v(u) + v_extra) + N * n


def bow_tangent(u, U=U_REST, D=D_REST):
    du = 1e-3
    a, b = bow_pt(u - du, U=U, D=D), bow_pt(u + du, U=U, D=D)
    return _n(b - a)


TIP_L, TIP_R = bow_pt(NOCK_U), bow_pt(-NOCK_U)
STRING_A, STRING_B = S0 + U_REST * NOCK_U, S0 - U_REST * NOCK_U
PINCH_R = S0 + U_REST * PINCH_U                        # prop.R at rest
HAND_L = bow_pt(HAND_U)                                # the left fist's centre at rest

# THE ARMS (rest = the concept's carry), solved for fixed bone lengths
SH_R, SH_L = np.array([-0.185, 0.01, 1.478]), np.array([0.185, 0.01, 1.478])
UA, FA = 0.295, 0.285
WR_R = PINCH_R + np.array([-0.072, 0.040, 0.050])      # the right wrist: back along the forearm from the pinch
WR_L = HAND_L + np.array([0.012, 0.036, 0.072])         # the left wrist: above and behind the fist


def _elbow(sh, wr, l1, l2, pole):
    d = wr - sh
    L = float(np.linalg.norm(d))
    a = d / L
    L = min(L, l1 + l2 - 1e-3)
    p = np.asarray(pole, float) - a * (a @ pole)
    p = _n(p)
    u = (l1 * l1 - l2 * l2 + L * L) / (2 * L)
    v = math.sqrt(max(0.0, l1 * l1 - u * u))
    return sh + a * u + p * v


EL_R = _elbow(SH_R, WR_R, UA, FA, (-0.7, 0.6, -0.4))
EL_L = _elbow(SH_L, WR_L, UA, FA, (0.75, 0.55, -0.35))
L_ARM = UA + FA

# THE QUIVER: a leather tube in a two-part holster at the right hip, the mouth leaning back and out, six arrows
Q_BOT = np.array([-0.262, 0.012, 0.700])
Q_TOP = np.array([-0.236, 0.062, 1.205])
Q_U = _n(Q_TOP - Q_BOT)
Q_N = _n(np.array([-1.0, 0.0, 0.0]) - Q_U * Q_U[0])     # out from her hip
Q_W = np.cross(Q_U, Q_N)
Q_HW, Q_HD = 0.047, 0.040
# (w, n offsets, nock rise over the rim, lean deg, vane turn): six arrows standing 0.20 m above the rim (the brief)
ARROWS = [(-0.022, -0.012, 0.200, 4.0, 0.0), (0.012, -0.016, 0.215, -3.0, 40.0), (-0.004, 0.014, 0.190, 2.0, 80.0),
          (0.024, 0.012, 0.205, -6.0, 15.0), (-0.026, 0.016, 0.185, 7.0, 60.0), (0.006, -0.002, 0.225, -1.0, 100.0)]

HEAD_C = np.array([0.0, 0.006, 1.735])
VIS_Z = 1.733                                         # the visor band's centre height (the eyes)


# ── shaping helpers ────────────────────────────────────────────────────────────────────────────────────────────
def folds(amp, freq, axis=0, phase=0.0, zfade=None):
    def fn(P):
        u = P[:, axis] * freq + phase + 0.7 * NOISE(P, 3.0)
        a = amp
        if zfade is not None:
            z0, z1 = zfade
            a = amp * np.clip((z0 - P[:, 2]) / (z0 - z1), 0.2, 1.0)
        return a * (np.abs(np.sin(u)) * 2.0 - 1.0) * -0.5
    return fn


def soft_folds(amp, freq, axis=0, phase=0.0):
    def fn(P):
        u = P[:, axis] * freq + phase + 0.7 * NOISE(P, 3.0)
        return amp * 0.5 * np.sin(u)
    return fn


def drape(amp, freq, phase=0.0):
    """soft vertical drape lines on hanging cloth (sleeves): ridges across x and y, broken by noise"""
    def fn(P):
        u = (P[:, 0] * 0.8 + P[:, 1] * 0.6) * freq + phase + 1.1 * NOISE(P, 4.0)
        return amp * 0.5 * np.sin(u)
    return fn


def hfolds(amp, freq, phase=0.0, tilt=(0.0, 0.0)):
    def fn(P):
        u = (P[:, 2] + tilt[0] * P[:, 0] + tilt[1] * P[:, 1]) * freq + phase + 0.5 * NOISE(P, 4.0)
        return amp * 0.5 * np.sin(u)
    return fn


def wraps(amp, pitch, a, b, slant=0.35, phase=0.0):
    """helical cloth bands round the segment a -> b: ridges every `pitch` metres, crossing at `slant`"""
    a, b = np.asarray(a, float), np.asarray(b, float)
    u = _n(b - a)
    e1 = _n(np.cross(u, [0.0, 0.0, 1.0]) if abs(u[2]) < 0.9 else np.cross(u, [1.0, 0.0, 0.0]))
    e2 = np.cross(u, e1)

    def fn(P):
        q = P - a
        t = q @ u
        th = np.arctan2(q @ e2, q @ e1)
        ph = t / pitch + slant * th / (2 * math.pi) + phase + 0.15 * NOISE(P, 6.0)
        f = ph - np.floor(ph)
        ridge = np.clip(1.0 - np.abs(f - 0.5) * 4.0, 0.0, 1.0)
        groove = np.exp(-((f - 0.02) / 0.05) ** 2) + np.exp(-((f - 1.02) / 0.05) ** 2)
        return -amp * 0.5 * ridge + amp * groove
    return fn


# THE TURBAN (review item 3: the evenly ribbed wrap read as a balaclava): broad cloth bands wound in layers, each a
# plane band (z = a x + b y + offset at the head) rising toward the front, alternately to her left and her right so
# they cross over the forehead in an X; every band's lower edge stands proud of the band under it (the overlap step)
# (a, b, offset, width): lowest first
WRAP_BANDS = [(+0.18, -0.55, -0.052, 0.050), (-0.18, -0.55, -0.010, 0.048), (+0.42, -0.30, 0.018, 0.046),
              (-0.42, -0.30, 0.040, 0.046), (+0.34, -0.24, 0.062, 0.044), (-0.34, -0.24, 0.083, 0.040),
              (+0.18, -0.16, 0.101, 0.036)]


def _band_s(P):
    """(N, bands): each band's coordinate across its width (0 = the proud lower edge, 1 = its top, under the next)"""
    q = P - HEAD_C
    nz = 0.0025 * NOISE(P, 14.0)
    out = []
    for a, b, o, w in WRAP_BANDS:
        n = np.array([-a, -b, 1.0])
        n = n / np.linalg.norm(n)
        out.append(((q @ n) + nz - o) / w)
    return np.stack(out, 1)


def _band_h(S):
    """per band: the proud height (m) of the band at s, 0 outside it: a rolled lower edge, thinning toward the top"""
    s = np.clip(S, -1.0, 2.0)
    edge = np.clip(s / 0.07, 0.0, 1.0)
    edge = edge * edge * (3 - 2 * edge)
    body = np.clip(1.0 - s, 0.0, 1.0) ** 0.7
    return np.where((S >= 0.0) & (S <= 1.0), (0.0012 + 0.0040 * body) * edge, 0.0)


def turban_layers(P):
    H = _band_h(_band_s(P))
    return -(H.max(1) + 0.0006 * NOISE(P, 30.0))


def chips(amp, freq):
    def fn(P):
        return amp * np.clip(NOISE.ridged(P, freq, 3), 0, 1) - amp * 0.3
    return fn


def strap(S, pts, normal_fn, w, t, k=0.006):
    """a flat band through `pts` lying on a surface (normal_fn(p) -> outward normal): half width w, half thickness t"""
    for i in range(len(pts) - 1):
        a, b = np.asarray(pts[i], float), np.asarray(pts[i + 1], float)
        n = _n(normal_fn((a + b) * 0.5))
        side = _n(np.cross(b - a, n))
        S.add(FlatCapsule(a, b, w, t, w, t, side=side), k=k)


def _sdf_at(S: Sculpt, P) -> np.ndarray:
    """a Sculpt's signed distance at points P (N, 3), its op list applied in order"""
    P = np.atleast_2d(np.asarray(P, float))
    D = np.full(len(P), 1e3)
    for op, prim, k, _ in S.ops:
        di = prim.d(P)
        if op == "add":
            D = sdf.smin(D, di, k)
        elif op == "sub":
            D = sdf.smax(D, -di, k)
        else:
            D = sdf.smax(D, di, k)
    return D


def _onto(S: Sculpt, pts, normal_fn, off):
    """each point moved along normal_fn(p) until it stands `off` m outside the Sculpt's surface"""
    out = []
    for p in pts:
        p = np.asarray(p, float)
        n = _n(normal_fn(p))
        for _ in range(12):
            d = float(_sdf_at(S, p[None])[0])
            p = p + n * (off - d)
            if abs(off - d) < 2e-4:
                break
        out.append(p)
    return out


def torso_normal(p):
    c = np.array([0.0, 0.0, max(1.05, min(1.45, p[2]))])
    return _n((np.asarray(p) - c) * np.array([1.0, 1.3, 0.25]))


def fist(name, grip, axis, wrist, knuckle, shaft_r, scale=1.0, index_fwd=1.0, curl=1.0):
    """a sculpted fist round a shaft: palm toward the wrist, four curled fingers round the shaft (index on the
    `index_fwd` side along the axis), knuckle rolls, a thumb wrapped the other way (Ulkro's hand)"""
    S = Sculpt(name)
    u = _n(axis)
    g = np.asarray(grip, float)
    toward_w = np.asarray(wrist, float) - g
    bk = _n(toward_w - u * (toward_w @ u))
    kn = _n(np.asarray(knuckle, float) - u * (u @ knuckle))
    q = _n(np.cross(u, kn))
    fr = 0.0118 * scale
    rf = shaft_r + fr * 0.95
    S.add(Ellipsoid(g + bk * 0.046 * scale + kn * 0.006, (0.048 * scale, 0.034 * scale, 0.027 * scale),
                    axes=np.stack([u, bk, np.cross(u, bk)])), k=0.0)
    S.add(Capsule(g + bk * 0.075 * scale, np.asarray(wrist, float) + bk * 0.005, 0.030 * scale), k=0.025)
    for i in range(4):
        s = (1.5 - i) * 0.0235 * scale * index_fwd
        c = g + u * s
        ln = 1.0 - 0.07 * abs(i - 1)
        ths = np.radians(np.array([-35.0, 25.0, 95.0, 165.0, 230.0 * ln]) * np.array([1, 1, curl, curl, curl]))
        pts = [c + rf * (np.cos(t) * kn + np.sin(t) * q) for t in ths]
        pts[0] = pts[0] + bk * 0.022 * scale
        S.add(Tube(pts, [fr * 1.05, fr, fr * 0.96, fr * 0.9, fr * 0.82], k=0.006), k=0.006)
        S.add(Sphere(c + kn * (rf + 0.004) + bk * 0.012 * scale, fr * 1.05), k=0.008)
    tb = g + bk * 0.04 * scale - u * 0.03 * scale * index_fwd - q * 0.022 * scale
    S.add(Tube([tb, g - q * (rf + 0.004) + bk * 0.012 - u * 0.006 * index_fwd,
                g - q * (rf * 0.6) - kn * (rf * 0.85) + u * 0.022 * scale * index_fwd],
               [0.015 * scale, 0.0125 * scale, 0.011 * scale], k=0.006), k=0.012)
    return S


def pinch(name, pt, string_dir, wrist, scale=1.0):
    """the drawing hand on the string: palm back toward the wrist, index and middle fingers hooked over the string,
    the ring and little fingers curled into the palm, the thumb tucked along the index (an archer's hook)"""
    S = Sculpt(name)
    u = _n(string_dir)
    g = np.asarray(pt, float)
    tw = np.asarray(wrist, float) - g
    bk = _n(tw - u * (tw @ u))
    q = _n(np.cross(u, bk))
    s = scale
    S.add(Ellipsoid(g + bk * 0.055 * s, (0.047 * s, 0.036 * s, 0.026 * s), axes=np.stack([u, bk, q])), k=0.0)
    S.add(Capsule(g + bk * 0.085 * s, np.asarray(wrist, float), 0.029 * s), k=0.025)
    fr = 0.0115 * s
    for i, (du, hook) in enumerate(((0.024, 1.0), (0.0, 1.0), (-0.023, 0.6), (-0.043, 0.45))):
        c = g + u * du * s
        pts = [c + bk * 0.030 * s, c + bk * 0.004 * s - q * 0.010 * s, c - bk * 0.010 * s - q * 0.004 * s * hook,
               c - bk * 0.006 * s + q * (0.012 * hook) * s]
        if hook < 0.9:
            pts = [c + bk * 0.030 * s, c + bk * 0.018 * s - q * 0.014 * s, c + bk * 0.024 * s + q * 0.004 * s]
        S.add(Tube(pts, [fr * 1.05] + [fr] * (len(pts) - 2) + [fr * 0.85], k=0.005), k=0.007)
        S.add(Sphere(c + bk * 0.028 * s - q * 0.012 * s, fr * 1.05), k=0.008)
    S.add(Tube([g + bk * 0.05 * s + u * 0.028 * s + q * 0.012 * s, g + bk * 0.02 * s + u * 0.034 * s - q * 0.004 * s,
                g + bk * 0.012 * s + u * 0.024 * s - q * 0.016 * s], [0.014 * s, 0.012 * s, 0.010 * s], k=0.006), k=0.01)
    return S


class _Band(sdf.Prim):
    """a flat band round an elliptical waist (radii rx, ry at its mid-thickness): rectangular section of half
    thickness t and half height h, edges rounded by `rr`; `slope` tilts it (dz per metre of x)"""

    def __init__(self, c, rx, ry, t, h, rr=0.004, slope=0.0, front_dip=0.0):
        self.c = np.asarray(c, float)
        self.rx, self.ry, self.t, self.h, self.rr, self.slope, self.dip = rx, ry, t, h, rr, slope, front_dip

    def bounds(self):
        e = max(self.rx, self.ry) + self.t + 0.01
        dz = self.h + abs(self.slope) * e + abs(self.dip) + 0.02
        return self.c - (e, e, dz), self.c + (e, e, dz)

    def d(self, P):
        q = P - self.c
        th = np.arctan2(q[:, 1] / self.ry, q[:, 0] / self.rx)
        R = np.hypot(self.rx * np.cos(th), self.ry * np.sin(th))
        r = np.hypot(q[:, 0], q[:, 1])
        zz = q[:, 2] - self.slope * q[:, 0] - self.dip * np.clip(-q[:, 1] / self.ry, 0, 1)
        a = np.abs(r - R) - (self.t - self.rr)
        b = np.abs(zz) - (self.h - self.rr)
        return np.hypot(np.maximum(a, 0), np.maximum(b, 0)) + np.minimum(np.maximum(a, b), 0) - self.rr


class _VisorSlab(sdf.Prim):
    """the flat dawnglass visor band (brief section 3): seen from above a rounded rectangle whose flat front stands
    3 cm ahead of the face-plate (the beak and the facing cue) and whose sides curve back into the wrap at the
    temples; a glass wall 7.6 mm thick and 5 cm tall, the ink recess of the face-plate behind it"""
    CEN = np.array([0.0, -0.066, VIS_Z])
    HX, HY, RC, T, H = 0.099, 0.066, 0.058, 0.0038, 0.025

    def bounds(self):
        return np.array([-0.115, -0.150, VIS_Z - 0.035]), np.array([0.115, -0.020, VIS_Z + 0.035])

    def d(self, P):
        q = P - self.CEN
        qx = np.abs(q[:, 0]) - (self.HX - self.RC)
        qy = np.abs(q[:, 1]) - (self.HY - self.RC)
        sd2 = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - self.RC
        wall = np.abs(sd2) - self.T
        band = np.abs(q[:, 2]) - self.H
        back = P[:, 1] + 0.035
        # a rounded-edge intersection of the wall and the band (a 1.5 mm round on the glass edges)
        r = 0.0015
        ww, bb = wall + r, band + r
        inter = np.hypot(np.maximum(ww, 0), np.maximum(bb, 0)) + np.minimum(np.maximum(ww, bb), 0) - r
        return np.maximum(inter, back)


class _Limb(sdf.Prim):
    """the bow's limbs as a flat strip with bevelled edges swept along the profile curve in the bow's frame, over
    |u| in [ua, ub] (on the side(s) `sides`); `grow` thickens it (the leather grip, the glass caps); `stripe`
    (half width across the flat faces, half width across the edges) keeps only those two bands of the section (the
    accent inlays: proud lines along the faces and along the edges)"""

    def __init__(self, ua=0.0, ub=TIP_U, sides=(-1, 1), grow=0.0, chamfer=CHAMFER, stripe=None,
                 S=S0, U=U_REST, D=D_REST, N=N_REST):
        self.ua, self.ub, self.sides, self.grow, self.ch, self.stripe = ua, ub, tuple(sides), grow, chamfer, stripe
        self.S, self.U, self.D, self.N = (np.asarray(x, float) for x in (S, U, D, N))

    def bounds(self):
        us = np.concatenate([sg * np.linspace(self.ua, self.ub, 24) for sg in self.sides])
        pts = np.array([bow_pt(u, S=self.S, U=self.U, D=self.D, N=self.N) for u in us])
        r = 0.04 + self.grow
        return pts.min(0) - r, pts.max(0) + r

    def d(self, P):
        q = P - self.S
        u, v, n = q @ self.U, q @ self.D, q @ self.N
        au = np.abs(u)
        auc = np.clip(au, self.ua, self.ub)
        vc = prof_v(auc)
        c = 1.0 / np.sqrt(1.0 + dprof(auc) ** 2)
        dv = (v - vc) * c
        hw = _tab(LIMB_W, auc) * 0.5 + self.grow
        ht = _tab(LIMB_T, auc) * 0.5 + self.grow
        an, ad = np.abs(n), np.abs(dv)
        ax, ay = an - hw, ad - ht
        box = np.hypot(np.maximum(ax, 0), np.maximum(ay, 0)) + np.minimum(np.maximum(ax, ay), 0)
        ch = (an + ad - (hw + ht - self.ch)) * 0.70710678
        d = np.maximum(box, ch)
        end = (au - self.ub) * c if self.ua <= 1e-6 else np.maximum(self.ua - au, au - self.ub) * c
        d = np.maximum(d, end)
        if self.stripe is not None:
            sw, se = self.stripe
            st = an - sw
            if se is not None:
                st = np.minimum(st, ad - se)
            d = np.maximum(d, st)
        if len(self.sides) == 1:
            d = np.where(np.sign(u) == self.sides[0], d, np.maximum(d, 0.05))
        return d


def _with_disp(S: Sculpt, fn, amp):
    S2 = Sculpt(S.name)
    for op, prim, k, tag in S.ops:
        if op == "add":
            prim = prim.displaced(fn, amp)
        S2.ops.append((op, prim, k, tag))
    return S2


class _HemCut(sdf.Prim):
    """inside = above the hem height function"""

    def __init__(self, hfn):
        self.hfn = hfn

    def bounds(self):
        return np.array([-1.0, -1.0, -0.5]), np.array([1.0, 1.0, 2.5])

    def d(self, P):
        return self.hfn(P) - P[:, 2]


class _Slit(sdf.Prim):
    """a vertical slit through a skirt (front, back or side), from z_top down, half width growing toward the hem"""

    def __init__(self, x0, axis, z_top, half_top, half_hem, z_hem=0.75, sign=-1.0):
        self.x0, self.axis, self.zt = x0, axis, z_top
        self.h0, self.h1, self.zh, self.sign = half_top, half_hem, z_hem, sign

    def bounds(self):
        return np.array([-0.6, -0.6, 0.3]), np.array([0.6, 0.6, self.zt + 0.02])

    def d(self, P):
        t = np.clip((self.zt - P[:, 2]) / max(1e-6, self.zt - self.zh), 0.0, 1.3)
        half = self.h0 + (self.h1 - self.h0) * t
        if self.axis == "x":                    # a front/back slit: across x, on the side sign*y > 0
            dx = np.abs(P[:, 0] - self.x0) - half
            dy = -self.sign * P[:, 1]
        else:                                   # a side slit: across y, on the side sign*x > 0
            dx = np.abs(P[:, 1] - self.x0) - half
            dy = -self.sign * P[:, 0]
        dz = P[:, 2] - self.zt
        return np.maximum(np.maximum(dx, dy), dz)


def _tabard_hem(P):
    """the tabard panels' hem: 0.79 m, the front corners a little lower, a soft wave"""
    x = P[:, 0]
    h = 0.792 - 0.012 * np.clip((np.abs(x) - 0.06) / 0.10, 0, 1) + 0.006 * NOISE(P * np.array([1, 1, 0]), 7.0)
    return h


def _tunic_hem(P):
    """the linen tunic's hem: pointed at the front and back centre (0.755), 0.785 at the sides"""
    x = P[:, 0]
    return 0.756 + 0.06 * np.clip(np.abs(x) / 0.12, 0, 1) ** 1.3 + 0.004 * NOISE(P * np.array([1, 1, 0]), 9.0)


SKIRT_SLITS = [_Slit(0.0, "x", 1.13, 0.012, 0.055, sign=-1.0), _Slit(0.0, "x", 1.02, 0.008, 0.050, sign=1.0),
               _Slit(0.012, "y", 0.98, 0.004, 0.018, sign=-1.0), _Slit(0.012, "y", 0.98, 0.004, 0.018, sign=1.0)]
ARMHOLES = [Ellipsoid((sx * 0.218, 0.008, 1.405), (0.058, 0.082, 0.090)) for sx in (-1, 1)]
NECKHOLE = Ellipsoid((0.0, 0.004, 1.57), (0.085, 0.075, 0.07))
PADS = [Ellipsoid((sx * 0.184, 0.006, 1.522), (0.074, 0.098, 0.026), axes=sdf.rot_y(-sx * 20.0)) for sx in (-1, 1)]


# ── the sculpt ─────────────────────────────────────────────────────────────────────────────────────────────────
def sculpts() -> list:
    """(name, Sculpt, voxel scale, material role, bind, tris, uv weight) in build order"""
    out = []

    def part(name, S, role, bind, tris, vs=1.0, uvw=1.0):
        out.append((name, S, vs, role, bind, tris, uvw))

    # HEAD-WRAP (rigid on the head): a turban wound in crossing layered bands over the crown, the back and the sides
    # of the face, the face opening framing the mask
    wrap = Sculpt("wrap")
    wrap.add(Ellipsoid(HEAD_C + (0.0, 0.012, 0.034), (0.101, 0.112, 0.115)), k=0.0)                 # crown 1.884
    wrap.add(Ellipsoid(HEAD_C + (0.0, 0.040, 0.010), (0.095, 0.100, 0.108)), k=0.04)                # back bulge
    wrap.add(Ellipsoid(HEAD_C + (0.0, 0.004, -0.075), (0.097, 0.100, 0.070)), k=0.05)               # sides to the jaw
    wrap.add(Capsule((0.0, 0.03, 1.60), (0.0, 0.02, 1.66), 0.072), k=0.04)                          # the nape
    wrap.sub(Ellipsoid((0.0, -0.118, 1.695), (0.070, 0.075, 0.098)), k=0.014)                        # the face opening
    wrap.inter(HalfSpace((0, 0, 1.585), (0, 0, -1), 1.0), k=0.02)
    part("wrap", _with_disp(wrap, turban_layers, 0.0062), "wrap", "bone:head", 1250, vs=0.8, uvw=1.6)

    # FACE-PLATE (rigid on the head): a smooth, calm chalk face (review item 3: the deep shell, the beak nose and the
    # parted lips read as an aged statue): a broad oval brow, a narrower jaw and a soft chin, a short soft nose, closed
    # lips as one soft mound (the slight smile is painted), the ink recess across the eyes behind the glass
    mask = Sculpt("mask")
    mask.add(Ellipsoid((0.0, -0.044, 1.722), (0.069, 0.062, 0.088)), k=0.0)
    mask.add(Ellipsoid((0.0, -0.050, 1.668), (0.052, 0.057, 0.062)), k=0.022)
    mask.inter(HalfSpace((0, -0.048, 1.7), (0, 1, 0), 1.0), k=0.012)
    mask.sub(Ellipsoid((0.0, -0.112, VIS_Z + 0.001), (0.078, 0.020, 0.0185)), k=0.006)            # the eye recess
    mask.add(RoundCone((0.0, -0.1000, 1.711), (0.0, -0.1062, 1.688), 0.0058, 0.0072), k=0.012)    # the nose
    mask.add(Ellipsoid((0.0, -0.1020, 1.651), (0.0160, 0.0036, 0.0064)), k=0.012)                 # the closed lips
    part("mask", mask, "chalk", "bone:head", 1100, vs=0.55, uvw=2.4)
    vis = Sculpt("visor")
    vis.add(_VisorSlab(), k=0.0)
    part("visor", vis, "dawnglass", "bone:head", 520, vs=0.45, uvw=1.8)
    neck = Sculpt("neck")
    neck.add(Capsule((0.0, 0.012, 1.52), (0.0, 0.002, 1.630), 0.040), k=0.0)
    part("neck", neck, "skin", "bone:neck", 240, vs=0.8)

    # COWL (zblend chest -> neck): the pale linen scarf wound round the neck, draped over the upper chest in a soft
    # V and over the shoulders, a wider collar at the back
    cowl = Sculpt("cowl")
    cowl.add(Torus((0.0, 0.006, 1.588), 0.070, 0.036, axes=np.diag([1.0, 1.10, 1.0]), rz=0.038)
             .displaced(hfolds(0.006, 70.0, tilt=(0.4, 0.0)), 0.006), k=0.0)
    cowl.add(Ellipsoid((0.0, -0.086, 1.528), (0.130, 0.038, 0.058)).displaced(soft_folds(0.007, 45.0, axis=0), 0.007), k=0.04)
    cowl.add(Ellipsoid((0.0, 0.074, 1.535), (0.170, 0.064, 0.075)).displaced(hfolds(0.006, 55.0), 0.006), k=0.04)
    for sx in (-1, 1):
        cowl.add(Ellipsoid((sx * 0.120, 0.0, 1.540), (0.075, 0.088, 0.040), axes=sdf.rot_y(sx * -18)), k=0.04)
    cowl.inter(HalfSpace((0, 0, 1.475), (0, 0, -1), 1.0), k=0.02)
    part("cowl", cowl, "cloth2", ("zblend", "chest", "neck", 1.54, 1.62), 900, uvw=1.3)

    # TORSO under the tabard (the linen shirt's shoulders and the body): heat weights; the bust and the shoulder
    # blades give the profile its depth (review item 6: almost flat from the side)
    body = Sculpt("body")
    body.add(Ellipsoid((0.0, 0.006, 1.33), (0.150, 0.104, 0.20)), k=0.0)
    body.add(Ellipsoid((0.0, 0.010, 1.44), (0.170, 0.098, 0.075)), k=0.07)
    body.add(Ellipsoid((0.0, 0.000, 1.14), (0.130, 0.098, 0.11)), k=0.08)
    body.add(Ellipsoid((0.0, 0.010, 1.00), (0.150, 0.108, 0.10)), k=0.06)
    body.add(Ellipsoid((0.0, 0.050, 1.40), (0.125, 0.070, 0.095)), k=0.05)                          # shoulder blades
    for sx in (-1, 1):
        body.add(Sphere((sx * 0.180, 0.008, 1.455), 0.058), k=0.05)
        body.add(Ellipsoid((sx * 0.056, -0.064, 1.352), (0.056, 0.050, 0.054)), k=0.04)            # bust
    part("body", body, "cloth2", "torso_ua", 520)

    # TABARD (heat weights above the belt): steel-blue chest panels, soft shoulder pads lying on the shoulders (review
    # item 6: the stiff wings stood up as blue horns), the armholes and the neck edged in grey trim (painted)
    tab = Sculpt("tabard")
    tab.add(Ellipsoid((0.0, 0.004, 1.34), (0.158, 0.113, 0.205)), k=0.0)
    tab.add(Ellipsoid((0.0, 0.008, 1.445), (0.172, 0.106, 0.075)), k=0.06)
    tab.add(Ellipsoid((0.0, 0.002, 1.21), (0.140, 0.106, 0.075)), k=0.06)
    tab.add(Ellipsoid((0.0, 0.054, 1.40), (0.130, 0.076, 0.100)), k=0.05)                           # over the blades
    for sx in (-1, 1):
        tab.add(Ellipsoid((sx * 0.058, -0.072, 1.352), (0.062, 0.054, 0.060)), k=0.045)            # over the bust
        tab.add(PADS[(sx + 1) // 2], k=0.035)
        tab.sub(ARMHOLES[(sx + 1) // 2], k=0.012)
    tab.sub(NECKHOLE, k=0.01)
    tab.inter(HalfSpace((0, 0, 1.165), (0, 0, -1), 1.0), k=0.0)
    part("tabard", _with_disp(tab, soft_folds(0.0025, 30.0, axis=0), 0.0025), "cloth", "torso_ua", 1200, uvw=1.3)

    # TABARD SKIRT (analytic hips -> thighs): four panels from the belt to the hem, open at the front and back centre
    # and slit at the sides
    sk = Sculpt("tabard_skirt")
    shell = FlatCapsule((0.0, 0.004, 1.20), (0.0, 0.006, 0.76), 0.150, 0.118, 0.204, 0.160, side=(1, 0, 0))
    sk.add(shell.displaced(folds(0.006, 26.0, axis=0, phase=0.4, zfade=(1.05, 0.8)), 0.006), k=0.0)
    sk.sub(FlatCapsule((0.0, 0.004, 1.25), (0.0, 0.006, 0.70), 0.138, 0.106, 0.192, 0.148, side=(1, 0, 0)), k=0.003)
    sk.inter(HalfSpace((0, 0, 1.19), (0, 0, 1), 1.0), k=0.0)
    sk.inter(_HemCut(_tabard_hem), k=0.004)
    for sl_ in SKIRT_SLITS:
        sk.sub(sl_, k=0.004)
    part("tabard_skirt", sk, "cloth", "skirt", 1100, uvw=1.2)

    # LINEN TUNIC (analytic): the pale under-tunic seen between the panels, pointed hems front and back
    tn = Sculpt("tunic")
    tsh = FlatCapsule((0.0, 0.004, 1.16), (0.0, 0.006, 0.74), 0.126, 0.096, 0.176, 0.134, side=(1, 0, 0))
    tn.add(tsh.displaced(folds(0.0035, 34.0, axis=0, phase=1.1), 0.0035), k=0.0)
    tn.sub(FlatCapsule((0.0, 0.004, 1.20), (0.0, 0.006, 0.70), 0.116, 0.086, 0.166, 0.124, side=(1, 0, 0)), k=0.003)
    tn.inter(HalfSpace((0, 0, 1.12), (0, 0, 1), 1.0), k=0.0)
    tn.inter(_HemCut(_tunic_hem), k=0.004)
    part("tunic", tn, "linen", "skirt", 700, uvw=1.0)

    # BELTS + STRAPS (heat weights): the waist belt, the quiver belt slanting to the right hip, the crossed straps
    belt = Sculpt("belt")
    belt.add(_Band((0.0, 0.002, 1.212), 0.150, 0.116, 0.008, 0.022, rr=0.004), k=0.0)
    belt.add(_Band((0.0, 0.004, 1.128), 0.170, 0.136, 0.007, 0.018, rr=0.004, slope=0.20, front_dip=0.012), k=0.0)
    part("belt", belt, "leather", "torso", 520)
    bk = Sculpt("buckle")
    c = np.array([0.050, -0.124, 1.212])
    bk.add(Torus(c, 0.020, 0.0045, axes=np.stack([[1, 0, 0], [0, 0, 1], [0, -1, 0]]).astype(float), rz=0.0035), k=0.0)
    bk.add(RoundBox(c + (0.0, 0.002, 0.0), (0.004, 0.003, 0.020), 0.002), k=0.002)
    part("buckle", bk, "ironstone", "torso", 160, vs=0.4)
    straps = Sculpt("straps")
    for sx in (-1, 1):
        # the strap paths projected onto the tabard's surface, the band's centre 6 mm above it (build 11: the straps
        # half buried in the tabard showed as ragged dark patches)
        fr = [(sx * 0.105, -0.084, 1.52), (sx * 0.052, -0.118, 1.455), (0.0, -0.128, 1.395), (-sx * 0.065, -0.126, 1.31),
              (-sx * 0.100, -0.114, 1.262), (-sx * 0.128, -0.096, 1.222)]
        strap(straps, _onto(tab, fr, torso_normal, 0.0062), torso_normal, 0.025, 0.0045)
        bk_ = [(sx * 0.110, 0.088, 1.52), (sx * 0.050, 0.124, 1.465), (0.0, 0.130, 1.415), (-sx * 0.10, 0.122, 1.30),
               (-sx * 0.13, 0.100, 1.235)]
        strap(straps, _onto(tab, bk_, torso_normal, 0.0062), torso_normal, 0.025, 0.0045)
    part("straps", straps, "leather", "torso", 420, vs=0.7)

    # THE BROOCH on the cowl's edge at her right chest: a chalk ring round a dawnglass disc (glossy, not emissive:
    # review item 10, the tip-cap inlays are the only accent)
    br, brg = Sculpt("brooch"), Sculpt("brooch_glass")
    bc = np.array([-0.072, -0.124, 1.508])
    bn = _n([-0.15, -1.0, 0.45])
    br.add(Torus(bc, 0.0235, 0.0055, axes=sdf.frame(bn)), k=0.0)
    brg.add(Ellipsoid(bc - bn * 0.001, (0.0215, 0.0215, 0.0080), axes=sdf.frame(bn)), k=0.0)
    part("brooch", br, "chalk", "torso", 200, vs=0.4)
    part("brooch_glass", brg, "dawnglass", "torso", 120, vs=0.4)

    # SLEEVES (analytic arm weights): linen from under the shoulder pads to the bracers, soft drape lines (review item
    # 6: no horizontal pillow bands), fuller on the upper arm, gathered into the bracer
    sl = Sculpt("sleeves")
    for sh, el, wr in ((SH_R, EL_R, WR_R), (SH_L, EL_L, WR_L)):
        s0 = sh + (el - sh) * 0.09 + np.array([0.0, 0.0, -0.022])
        sl.add(FlatCapsule(s0, el, 0.055, 0.054, 0.049, 0.047, side=(1, 0, 0)).displaced(drape(0.003, 70.0), 0.003), k=0.0)
        sl.add(Sphere(el, 0.049), k=0.03)
        fa = el + (wr - el) * 0.34
        sl.add(FlatCapsule(el, fa, 0.049, 0.047, 0.041, 0.040, side=(1, 0, 0)).displaced(drape(0.0025, 80.0, 1.3), 0.0025), k=0.02)
    part("sleeves", sl, "cloth2", "arm", 1000)
    brc = Sculpt("bracers")
    for el, wr in ((EL_R, WR_R), (EL_L, WR_L)):
        a, b = el + (wr - el) * 0.24, wr + (wr - el) * 0.05
        brc.add(FlatCapsule(a, b, 0.050, 0.048, 0.038, 0.036, side=(1, 0, 0)).displaced(wraps(0.004, 0.032, a, b, slant=0.8), 0.004),
                k=0.0)
    part("bracers", brc, "leather", "arm", 700)
    # HANDS: the left fist round the grip (its axis = the chord), the right hook on the string
    WK_L = _n(np.array([0.0, -0.6, -0.8]))
    part("hand_L", fist("hand_L", HAND_L, U_REST, WR_L, WK_L, 0.021, 1.12, index_fwd=-1.0), "skin", "bone:hand.L", 620, vs=0.55)
    part("hand_R", pinch("hand_R", PINCH_R, U_REST, WR_R, 1.10), "skin", "bone:hand.R", 540, vs=0.55)

    # LEGS (review item 6: tubular sticks): a full thigh tapering to a defined knee, the calf and a slim ankle inside
    # the boot, the pelvis and the seat for the side profile
    legs = Sculpt("legs")
    for sx in (-1, 1):
        hip, knee, ank = np.array([sx * 0.095, 0.005, 0.95]), np.array([sx * 0.121, -0.012, 0.503]), np.array([sx * 0.145, 0.02, 0.09])
        legs.add(RoundCone(hip + (0, 0, 0.04), knee + (0, 0, 0.07), 0.080, 0.055), k=0.0)
        legs.add(Ellipsoid(hip + (knee - hip) * 0.40 + (sx * 0.008, -0.016, 0.0), (0.066, 0.062, 0.17)), k=0.05)   # quad
        legs.add(Ellipsoid(knee + (0.0, -0.008, 0.012), (0.051, 0.052, 0.055)), k=0.025)                       # knee
        legs.add(RoundCone(knee, ank + (0, 0, 0.09), 0.047, 0.032), k=0.02)
        legs.add(Ellipsoid(knee + (ank - knee) * 0.30 + (0.0, 0.020, 0.0), (0.040, 0.042, 0.10)), k=0.03)      # calf
    legs.add(Ellipsoid((0.0, 0.01, 0.94), (0.122, 0.088, 0.08)), k=0.05)
    part("legs", legs, "under", "auto", 680)
    # BOOTS: a sole and a low wedge heel, the instep rising to a slim ankle, the shaft swelling over the calf to a
    # soft cuff below the knee (review item 6: stovepipes on rounded slippers)
    boots = Sculpt("boots")
    for sx in (-1, 1):
        to = math.radians(sx * 8.0)
        fwd = np.array([math.sin(to), -math.cos(to), 0.0])
        side = np.array([math.cos(to), math.sin(to), 0.0])
        ax = np.stack([side, fwd, np.array([0.0, 0.0, 1.0])])
        g = np.array([sx * 0.145, 0.02, 0.0])
        anj = g + (0, 0, 0.09)
        knee = np.array([sx * 0.121, -0.012, 0.503])
        boots.add(RoundBox(g + fwd * 0.046 + (0, 0, 0.009), (0.050, 0.138, 0.009), 0.008, axes=ax), k=0.0)        # sole
        boots.add(RoundBox(g - fwd * 0.052 + (0, 0, 0.021), (0.039, 0.034, 0.021), 0.007, axes=ax), k=0.004)      # heel
        boots.add(Ellipsoid(g + fwd * 0.058 + (0, 0, 0.045), (0.046, 0.106, 0.042), axes=ax), k=0.012)           # instep
        boots.add(Ellipsoid(g + fwd * 0.138 + (0, 0, 0.031), (0.041, 0.058, 0.027), axes=ax), k=0.02)            # toe
        boots.add(Ellipsoid(g - fwd * 0.036 + (0, 0, 0.057), (0.041, 0.046, 0.051), axes=ax), k=0.02)            # heel cup

        def lp(z):
            t = (z - 0.09) / (0.503 - 0.09)
            calf = math.exp(-((z - 0.31) / 0.10) ** 2)
            return anj + (knee - anj) * t + np.array([0.0, 0.007 * calf, 0.0])
        zs = (0.075, 0.15, 0.24, 0.32, 0.40, 0.462)
        rw = (0.042, 0.043, 0.050, 0.056, 0.057, 0.060)
        rd = (0.045, 0.046, 0.054, 0.061, 0.059, 0.062)
        for i in range(len(zs) - 1):
            boots.add(FlatCapsule(lp(zs[i]), lp(zs[i + 1]), rw[i], rd[i], rw[i + 1], rd[i + 1], side=(1, 0, 0))
                      .displaced(folds(0.0025, 34.0, axis=2, phase=sx * 1.7), 0.0025), k=0.018)
        boots.add(Torus(lp(0.462) + (0, 0, 0.004), 0.060, 0.010, axes=np.diag([1.0, 1.05, 1.0])), k=0.008)     # cuff
        boots.add(Torus(lp(0.405), 0.058, 0.0050, axes=np.diag([1.0, 1.05, 1.0])), k=0.010)                     # slouch
    boots.inter(HalfSpace((0, 0, 0.0), (0, 0, -1), 2.0), k=0.0)
    part("boots", boots, "boots", "auto", 900)

    # QUIVER (rigid on the hips): a leather tube in a two-part holster (an outer cover over its upper half, the
    # concept's), two straps and a rim, six arrows standing 0.20 m above the rim with gull-grey feather plates
    qv = Sculpt("quiver")
    qc = (Q_TOP + Q_BOT) * 0.5
    qL = float(np.linalg.norm(Q_TOP - Q_BOT))
    qax = np.stack([Q_W, Q_N, Q_U])
    qv.add(RoundBox(qc, (Q_HW, Q_HD, qL * 0.5), 0.034, axes=qax), k=0.0)
    qv.sub(RoundBox(Q_TOP + Q_U * 0.02, (Q_HW - 0.009, Q_HD - 0.009, 0.06), 0.025, axes=qax), k=0.005)
    part("quiver", qv, "quiver", "bone:hips", 520)
    hol = Sculpt("quiver_holster")
    hc = Q_TOP - Q_U * 0.17 + Q_N * 0.004
    hol.add(RoundBox(hc, (Q_HW + 0.008, Q_HD + 0.008, 0.155), 0.036, axes=qax), k=0.0)
    hol.sub(RoundBox(hc, (Q_HW + 0.001, Q_HD + 0.001, 0.30), 0.034, axes=qax), k=0.002)
    hol.inter(HalfSpace(hc, Q_N, 1.0), k=0.0)       # the outer half only (the cover's cut edge runs down its sides)
    hol.sub(Ellipsoid(hc - Q_U * 0.16 + Q_N * 0.02, (0.07, 0.09, 0.06), axes=qax), k=0.01)   # the curved lower edge
    part("quiver_holster", hol, "quiver", "bone:hips", 360, vs=0.7)
    qb = Sculpt("quiver_straps")
    for zz in (0.07, 0.36):
        qb.add(RoundBox(Q_TOP - Q_U * zz, (Q_HW + 0.011, Q_HD + 0.011, 0.012), 0.037, axes=qax), k=0.0)
    qb.add(RoundBox(Q_TOP - Q_U * 0.006, (Q_HW + 0.004, Q_HD + 0.004, 0.010), 0.031, axes=qax), k=0.0)
    qb.sub(RoundBox(Q_TOP + Q_U * 0.02, (Q_HW - 0.009, Q_HD - 0.009, 0.06), 0.025, axes=qax), k=0.004)
    qb.add(Capsule(Q_TOP - Q_U * 0.07 + Q_W * 0.03 + np.array([0.03, -0.01, 0.0]), np.array([-0.150, -0.02, 1.10]), 0.010), k=0.006)
    part("quiver_straps", qb, "leather", "bone:hips", 420, vs=0.7)
    shafts, fl = Sculpt("arrow_shafts"), Sculpt("fletching")
    for w, n, rise, lean, vt in ARROWS:
        d = _n(Q_U + Q_W * math.tan(math.radians(lean)))
        base = Q_TOP - Q_U * 0.25 + Q_W * w + Q_N * n
        tip = Q_TOP + Q_W * w + Q_N * n + d * rise
        shafts.add(Capsule(base, tip, 0.0045), k=0.0)
        shafts.add(Sphere(tip, 0.0058), k=0.002)                                                   # the nock
        e1 = _n(np.cross(d, Q_N))
        for j in range(3):
            a = math.radians(vt + j * 120.0)
            vd = e1 * math.cos(a) + np.cross(d, e1) * math.sin(a)
            fl.add(_Vane(tip - d * 0.112, d, vd, 0.098, 0.024, 0.0030), k=0.0)
    part("arrow_shafts", shafts, "wood", "bone:hips", 340, vs=0.45)
    part("fletching", fl, "fletching", "bone:hips", 600, vs=0.45)

    # THE BOW (prop.L): flat bevelled ash strips on the concept's S profile (review item 1), a leather grip at the
    # centre, glass hook caps with a thin accent inlay, the string
    bow = Sculpt("bow")
    bow.add(_Limb(0.0, TIP_U - 0.01), k=0.0)
    part("bow", bow, "wood", "bone:prop.L", 1450, vs=0.5, uvw=1.5)
    grip = Sculpt("bow_grip")
    grip.add(_Limb(0.0, 0.075, grow=0.0035, chamfer=0.009), k=0.0)
    part("bow_grip", grip, "leather", "bone:prop.L", 300, vs=0.5)
    caps, inl = Sculpt("bow_caps"), Sculpt("bow_inlays")
    caps.add(_Limb(CAP0, TIP_U, grow=0.0035, chamfer=0.007), k=0.0)
    inl.add(_Limb(CAP0 + 0.010, TIP_U - 0.014, grow=0.0050, chamfer=0.007, stripe=(0.0185, None)), k=0.0)
    part("bow_caps", caps, "dawnglass", "bone:prop.L", 460, vs=0.45)
    part("bow_inlays", inl, "accent", "bone:prop.L", 420, vs=0.4)
    st = Sculpt("string")
    st.add(Capsule(STRING_A, S0, 0.0048), k=0.0)
    st.add(Capsule(S0, STRING_B, 0.0048), k=0.0)
    part("string", st, "cloth2", "string", 260, vs=0.45)

    # MORNING DRAW's fan (x_fan, under the right hand; scaled away except in cast_a3): three long arrows fanned wide
    # between the fingers, pale shafts, broad bright fletching, glass heads (review item 5: three hairline sticks)
    fan, fanf, fanh = Sculpt("fan_shafts"), Sculpt("fan_fletch"), Sculpt("fan_heads")
    for ang in FAN_ANGLES:
        d = fan_dir(ang)
        base = PINCH_R - d * 0.05
        tip = PINCH_R + d * 0.56
        fan.add(Capsule(base, tip, 0.0062), k=0.0)
        fanh.add(RoundCone(tip - d * 0.005, tip + d * 0.060, 0.013, 0.002), k=0.0)
        e1 = _n(np.cross(d, [0.0, 0.0, 1.0]))
        for j in range(3):
            a = math.radians(30.0 + j * 120.0)
            vd = e1 * math.cos(a) + np.cross(d, e1) * math.sin(a)
            fanf.add(_Vane(base, d, vd, 0.11, 0.028, 0.0030), k=0.0)
    part("fan_shafts", fan, "wood", "bone:x_fan", 220, vs=0.5)
    part("fan_fletch", fanf, "fletching", "bone:x_fan", 300, vs=0.45)
    part("fan_heads", fanh, "dawnglass", "bone:x_fan", 120, vs=0.5)
    return out


FAN_AXIS = np.array([0.0, -1.0, 0.0])                  # the fan's axis at bind (forward from the right hand)
FAN_ANGLES = (-22.0, 0.0, 22.0)


def fan_dir(ang):
    a = math.radians(ang)
    return _n(FAN_AXIS * math.cos(a) + U_REST * math.sin(a))


class _Vane(sdf.Prim):
    """one fletching vane: a thin plate from p0 along d (length L), standing out along vd (height H), its top edge
    curving down at the front (a parabolic feather), thickness T"""

    def __init__(self, p0, d, vd, L, H, T):
        self.p0, self.dv, self.vd = np.asarray(p0, float), _n(d), _n(vd)
        self.w = np.cross(self.dv, self.vd)
        self.L, self.H, self.T = L, H, T

    def bounds(self):
        pts = np.array([self.p0 + self.dv * s + self.vd * h + self.w * t for s in (-0.005, self.L + 0.005)
                        for h in (-0.003, self.H + 0.004) for t in (-0.004, 0.004)])
        return pts.min(0), pts.max(0)

    def d(self, P):
        q = P - self.p0
        s, h, t = q @ self.dv, q @ self.vd, q @ self.w
        u = np.clip(s / self.L, 0, 1)
        top = self.H * np.clip(1.0 - (1.0 - u) ** 2 * 0.9, 0.15, 1.0) * np.where(u > 0.82, np.clip((1.0 - u) / 0.18, 0, 1) ** 0.5, 1.0)
        dh = np.maximum(-h, h - top)
        ds = np.maximum(-s, s - self.L)
        return np.maximum(np.maximum(dh, ds), np.abs(t) - self.T)


def _rope_wrap(ua, ub):
    """Gorgewalk's gorge-rope: plies wound round the limb between |u| ua and ub"""
    def fn(P):
        u, v, w = _bow_local(P)
        th = np.arctan2(v - prof_v(u), w)
        ph = np.abs(u) / 0.0085 + th / (2 * math.pi) * 0.8 + 0.2 * NOISE(P, 30.0)
        f = ph - np.floor(ph)
        return 0.0016 * (np.abs(f - 0.5) * 2.0 - 0.5)
    return fn


def skin_extras(extra: dict) -> list:
    """Gorgewalk: rigid gorge-rope bindings over the grip's ends, mid-limb and below each tip cap (broad enough to read
    at splash scale, review item 7); Almanac: page-cut plates replace the gull-feather vanes (3 x 8 cm, 3 mm)"""
    out = []
    if extra.get("rope_bind"):
        rope = Sculpt("rope_bind")
        for ua, ub in ((0.075, 0.150), (0.50, 0.56), (0.735, 0.795)):
            rope.add(_Limb(ua, ub, grow=0.0042, chamfer=0.008).displaced(_rope_wrap(ua, ub), 0.0016), k=0.0)
        out.append(("rope_bind", rope, 0.45, "rope", "bone:prop.L", 900, 1.0))
    return out


def extra_materials(ctx) -> dict:
    """roles the bible set lacks or that need a different finish: the wrap is CLOTH (a honed-stone sheen would render
    it bone-white), skin, boots (matte: review item 6, the splash's grey slippers were the waxed sheen), the quiver's
    leather, the linen tunic, the fletching, rope; the bow matte ash"""
    pal = dict(materials.BIBLE_PALETTE, **PALETTE)
    pal.update(ctx.palette)
    g = ctx.gradient
    return {"skin": materials.waxed_leather("skin", pal, "skin", g, rough=0.72),
            "wrap": materials.heavy_cloth("wrap", pal, "wrap", g, rough=0.93, weave=0.8),
            "cloth2": materials.heavy_cloth("cloth2", pal, "cloth2", g, rough=0.92, weave=0.7),
            "cloth": materials.heavy_cloth("cloth", pal, "cloth", g, rough=0.9, weave=0.9),
            "linen": materials.heavy_cloth("linen", pal, "linen", g, rough=0.93, weave=1.0),
            "boots": materials.waxed_leather("boots", pal, "boots", g, rough=0.95),
            "quiver": materials.waxed_leather("quiver", pal, "quiver", g, rough=0.66),
            "fletching": materials.heavy_cloth("fletching", pal, "fletching", g, rough=0.8, weave=0.3),
            "rope": materials.heavy_cloth("rope", pal, "rope", g, rough=0.95, weave=1.0),
            "chalk": materials.honed_stone("chalk", pal, "chalk", g, rough=0.80, chisel=0.4),
            "wood": materials.carved_wood("wood", pal, "wood", g, rough=0.72),
            "leather": materials.waxed_leather("leather_matte", pal, "leather", g, rough=0.76)}


# ── decimation: the shared collapse keeps X symmetry, which stalls on one-sided parts ─────────────────────────────
ASYM = ("quiver", "arrow_", "fletching", "hand_", "brooch", "buckle", "belt", "bow", "string", "fan_", "rope_bind",
        "sleeves", "bracers", "tunic", "tabard_skirt")


def _install_decimate() -> None:
    from common import mesh
    orig = mesh.decimate_to
    if getattr(orig, "_lisvel", False):
        return

    def decimate_to(obj, target_tris, symmetric=True):
        if obj.name.startswith(ASYM):
            symmetric = False
        return orig(obj, target_tris, symmetric)
    decimate_to._lisvel = True
    mesh.decimate_to = decimate_to


_install_decimate()

Q_BASE = 58


def _patch_glb_rest(path: str) -> int:
    """x_fan's rest scale -> 0.001 in the GLB's node (review item 12: every base clip keys it to 0 except Morning
    Draw, but a viewer showing a skin without a clip, or the skins' QA sheets, showed the fan in every facing).
    Returns the number of nodes patched."""
    import json
    import struct
    with open(path, "rb") as f:
        data = f.read()
    magic, ver, total = struct.unpack_from("<III", data, 0)
    clen, ctype = struct.unpack_from("<II", data, 12)
    js = json.loads(data[20:20 + clen].decode("utf-8"))
    rest = data[20 + clen:]
    n = 0
    for node in js.get("nodes", []):
        if node.get("name") == "x_fan":
            node["scale"] = [0.001, 0.001, 0.001]
            n += 1
    if not n:
        return 0
    raw = json.dumps(js, separators=(",", ":")).encode("utf-8")
    raw += b" " * ((4 - len(raw) % 4) % 4)
    out = struct.pack("<III", magic, ver, 12 + 8 + len(raw) + len(rest)) + struct.pack("<II", len(raw), ctype) + raw + rest
    with open(path, "wb") as f:
        f.write(out)
    return n


def _install_optimize() -> None:
    """the shipping compression with the 2048 base colour at WebP q58 (the shared optimize.mjs takes --q-base), then
    x_fan's rest scale patched to 0 (every GLB, the skins' included)"""
    from common import export
    orig = export.optimize
    if getattr(orig, "_lisvel", False):
        return

    def optimize(path, out=None, quantize=False, fighter=False):
        if not fighter:
            return orig(path, out, quantize, fighter)
        import subprocess
        from common import scene as _scene
        out = out or path
        script = os.path.join(_scene.TOOLS_DIR, "optimize.mjs")
        node = export.node_exe()
        before = os.path.getsize(path)
        if not node or not os.path.isfile(script):
            return orig(path, out, quantize, fighter)
        args = [node, script, path, out] + (["--quantize"] if quantize else []) + ["--fighter", "--q-base", str(Q_BASE)]
        r = subprocess.run(args, cwd=_scene.GAME_DIR, capture_output=True, text=True, encoding="utf-8")
        if r.returncode != 0:
            _scene.log(f"optimize failed ({r.returncode}): {r.stderr.strip()[:800]}")
            return {"ok": False, "before": before, "after": before, "error": r.stderr[-800:]}
        _scene.log(r.stdout.strip())
        np_ = _patch_glb_rest(out)
        _scene.log(f"x_fan rest scale -> 0.001 ({np_} node)")
        return {"ok": True, "before": before, "after": os.path.getsize(out), "q_base": Q_BASE, "x_fan_rest": np_}
    optimize._lisvel = True
    export.optimize = optimize


_install_optimize()


def _install_art_height() -> None:
    """FighterArt.height places the HP bar (art.height + 0.35 m): the bow's far tip rises toward it in some facings,
    so the reported height is the mesh top + ART_HEIGHT_PAD (inside the load test's 6 cm tolerance)"""
    from common import pipeline
    orig = pipeline.art_fragment
    if getattr(orig, "_lisvel", False):
        return

    def art_fragment(spec, clips_info, mesh_top=None):
        out = orig(spec, clips_info, mesh_top)
        if getattr(spec, "ID", None) == ID and mesh_top:
            out["height"] = round(float(mesh_top) + ART_HEIGHT_PAD, 2)
        return out
    art_fragment._lisvel = True
    pipeline.art_fragment = art_fragment


_install_art_height()


def _install_unwrap() -> None:
    """smart-project islands at a 70 degree limit (the shared 62 cut this sculpt into confetti, review item 13)"""
    from common import bake
    orig = bake.unwrap
    if getattr(orig, "_lisvel", False):
        return

    def unwrap(obj, angle=62.0, margin=0.0035, weights=None, method="smart"):
        return orig(obj, angle=70.0, margin=0.003, weights=weights, method=method)
    unwrap._lisvel = True
    bake.unwrap = unwrap


_install_unwrap()


# the normal bake on thin shells and strips (the straps, the tunic, the skirt panels, the vanes) misses its rays in
# large patches (build 11: 30-40 % of their texels tilted > 30 deg, rendered as black splotches and ragged ink in
# three.js, review item 2): those parts keep only their geometry's shading, the folded panels a softened copy, and no
# texel anywhere tilts more than NRM_MAX
NRM_FLAT = ("straps", "fletching", "fan_fletch", "arrow_shafts", "fan_shafts", "string", "visor", "brooch_glass",
            "bow_caps", "fan_heads")
NRM_SOFT = {"tabard_skirt": 0.45, "tunic": 0.35, "quiver_holster": 0.6, "hand_L": 0.7}
NRM_MAX = 32.0
_PART_NAMES: list = []


def _clean_normals(img, part):
    n = img.astype(np.float64) * 2.0 - 1.0
    k = np.ones(part.shape)
    for i, nm in enumerate(_PART_NAMES):
        if nm in NRM_FLAT:
            k[part == i] = 0.0
        elif nm in NRM_SOFT:
            k[part == i] = NRM_SOFT[nm]
    xy = n[..., :2] * k[..., None]
    lim = math.tan(math.radians(NRM_MAX))
    r = np.linalg.norm(xy, axis=2) / np.maximum(np.abs(n[..., 2]), 0.2)
    xy = xy * np.minimum(1.0, lim / np.maximum(r, 1e-6))[..., None]
    z = np.ones(part.shape)
    out = np.concatenate([xy, z[..., None]], axis=2)
    out = out / np.linalg.norm(out, axis=2, keepdims=True)
    scene.log(f"normals: {int((k < 1).sum())} texels flattened/softened, tilt clamped at {NRM_MAX} deg")
    return (out * 0.5 + 0.5).astype(np.float32)


def _install_bleed() -> None:
    """the data maps (ORM 256, normal 512) are baked at 2048 with an 8 px margin and scaled down: the gaps between the
    atlas's islands stay black (roughness 0 = glossy, AO 0) and bleed into the islands at three.js's mip levels.
    Every empty texel takes its nearest island's value (wraps bake.bake_asset in this build process only)."""
    from common import bake
    orig = bake.bake_asset
    if getattr(orig, "_lisvel", False):
        return

    def bake_asset(low, highs, out_dir, *a, **kw):
        res = orig(low, highs, out_dir, *a, **kw)
        from common.hifi import project
        for kind in ("orm", "normal"):
            path = res["images"].get(kind)
            if not path:
                continue
            full = path if os.path.isabs(path) else os.path.join(scene.GAME_DIR, path)
            if not os.path.isfile(full):
                continue
            img = project.load_rgb(full)
            sz = img.shape[0]
            part = project.rasterize(low, sz, "vale_part")["part"]
            cov = (part >= 0) & ~np.all(img < 0.002, axis=2)
            iy, ix = project.nearest_index(cov)
            img = img[iy, ix]
            if kind == "normal":
                img = _clean_normals(img, part[iy, ix])
            project.save_rgb(img, full)
            for im in bpy.data.images:
                if im.filepath and os.path.abspath(bpy.path.abspath(im.filepath)) == os.path.abspath(full):
                    im.reload()
            scene.log(f"bleed {kind}: {int((~cov).sum())} empty texels filled")
        return res
    bake_asset._lisvel = True
    bake.bake_asset = bake_asset


_install_bleed()


# ── rig ────────────────────────────────────────────────────────────────────────────────────────────────────────
def rig_extras(ctx) -> None:
    """re-place both arms on the concept's carry; prop.L on the bow's grip (+Y = the shot D, +Z = the upper limb U),
    prop.R on the string pinch (+Y = D); x_string (the string's draw, deforming, under prop.L), x_fan (Morning Draw's
    fan, deforming, under hand.R); sockets x_arrow_nock (hand.R), x_bow_tip_l / _r (prop.L), x_quiver (hips)"""
    info = ctx.info
    arm = info.armature
    scene.select_only([arm], arm)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    for s, el, wr, grip in (("R", EL_R, WR_R, PINCH_R), ("L", EL_L, WR_L, HAND_L)):
        sh = V(eb[f"upper_arm.{s}"].head)
        elv, wrv = V(tuple(el)), V(tuple(wr))
        up_d, fo_d = (elv - sh).normalized(), (wrv - elv).normalized()
        hd = (V(tuple(grip)) - wrv).normalized()
        eb[f"upper_arm.{s}"].tail = elv
        eb[f"forearm.{s}"].head = elv
        eb[f"forearm.{s}"].tail = wrv
        eb[f"hand.{s}"].head = wrv
        eb[f"hand.{s}"].tail = wrv + hd * PROPORTIONS["hand"] * 0.5
        eb[f"upper_arm.{s}"].align_roll(fo_d - up_d * fo_d.dot(up_d))
        eb[f"forearm.{s}"].align_roll(-up_d - fo_d * (-up_d).dot(fo_d))
        eb[f"hand.{s}"].align_roll(-up_d - hd * (-up_d).dot(hd))
        info.joints[f"elbow.{s}"], info.joints[f"wrist.{s}"] = elv, wrv
        info.joints[f"palm.{s}"] = V(tuple(grip))
    for s, p in (("L", GRIP_L), ("R", PINCH_R)):
        g = V(tuple(p))
        eb[f"prop.{s}"].head = g
        eb[f"prop.{s}"].tail = g + V(tuple(D_REST)) * 0.12
        eb[f"prop.{s}"].align_roll(V(tuple(U_REST)))
    bpy.ops.object.mode_set(mode="OBJECT")
    for b in arm.data.bones:
        info.lengths[b.name] = b.length
    rig.add_socket(info, "x_string", "prop.L", tuple(S0), tuple(D_REST * 0.06), z_hint=tuple(U_REST))
    rig.add_socket(info, "x_fan", "hand.R", tuple(PINCH_R), (0.0, 0.0, 0.08), z_hint=(0.0, -1.0, 0.0))
    for nm in ("x_string", "x_fan"):
        arm.data.bones[nm].use_deform = True
        info.lengths[nm] = arm.data.bones[nm].length
    rig.add_socket(info, "x_arrow_nock", "hand.R", tuple(PINCH_R), tuple(D_REST * 0.08), z_hint=tuple(U_REST))
    rig.add_socket(info, "x_bow_tip_l", "prop.L", tuple(TIP_L), tuple(bow_tangent(NOCK_U) * 0.06), z_hint=tuple(-D_REST))
    rig.add_socket(info, "x_bow_tip_r", "prop.L", tuple(TIP_R), tuple(-bow_tangent(-NOCK_U) * 0.06), z_hint=tuple(-D_REST))
    rig.add_socket(info, "x_quiver", "hips", tuple(Q_TOP + Q_U * 0.02), tuple(Q_U * 0.08), z_hint=(0, -1, 0))


# ── analytic weights ───────────────────────────────────────────────────────────────────────────────────────────
def _ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _skirt_weights(co):
    """hips at the belt, the thighs below by side (the panels follow their own thigh); the back keeps more hips"""
    x, y, z = co[:, 0], co[:, 1], co[:, 2]
    front = _ss(0.0, -0.06, y)
    wh = _ss(0.74, 1.08, z) * (1 - front) + _ss(0.86, 1.12, z) * front
    wh = wh + (1 - wh) * 0.40 * _ss(0.02, 0.12, y)
    sL = _ss(-0.05, 0.05, x)
    return {"hips": wh, "thigh.L": (1 - wh) * sL, "thigh.R": (1 - wh) * (1 - sL)}


def _seg_t(p, a, b):
    ab = b - a
    t = ((p - a) @ ab) / (ab @ ab)
    d = np.linalg.norm(p - (a + np.outer(np.clip(t, 0, 1), ab)), axis=1)
    return t, d


def _arm_weights(co):
    """the sleeves and bracers on their own arm only: shoulder -> upper arm -> forearm -> hand by the position along
    each arm's chain, soft at the joints"""
    W = {}
    for s_, sh, el, wr in (("R", SH_R, EL_R, WR_R), ("L", SH_L, EL_L, WR_L)):
        t1, d1 = _seg_t(co, sh, el)
        t2, d2 = _seg_t(co, el, wr)
        W[s_] = (t1, d1, t2, d2)
    dR = np.minimum(W["R"][1], W["R"][3])
    dL = np.minimum(W["L"][1], W["L"][3])
    out = {}
    for s_ in ("R", "L"):
        t1, d1, t2, d2 = W[s_]
        mine = (dR <= dL) if s_ == "R" else (dL < dR)
        upper = d1 <= d2
        w_sh = np.where(upper, _ss(0.16, -0.04, t1) * 0.6, 0.0)
        w_fa = np.where(upper, _ss(0.86, 1.10, t1), 1.0 - _ss(0.14, -0.10, t2))
        w_ua = np.where(upper, 1.0 - w_fa, _ss(0.14, -0.10, t2))
        w_ua = w_ua * (1.0 - w_sh)
        w_hd = np.where(upper, 0.0, _ss(0.90, 1.06, t2))
        w_fa = w_fa * (1.0 - w_hd)
        out[f"shoulder.{s_}"] = w_sh * mine
        out[f"upper_arm.{s_}"] = w_ua * mine
        out[f"forearm.{s_}"] = w_fa * mine
        out[f"hand.{s_}"] = w_hd * mine
    return out


def _string_weights(co):
    """x_string at the nock, falling linearly to the tips (prop.L): a drawn string is two straight lines"""
    u = (co - S0) @ U_REST
    w = np.clip(1.0 - np.abs(u) / NOCK_U, 0.0, 1.0)
    return {"x_string": w, "prop.L": 1.0 - w}


def _assign(obj, arm, wfn):
    from common import mesh
    obj.vertex_groups.clear()
    co = np.array([tuple(obj.matrix_world @ v.co) for v in obj.data.vertices])
    W = wfn(co)
    tot = sum(W.values())
    for name, w in W.items():
        g = obj.vertex_groups.new(name=name)
        w = w / np.maximum(tot, 1e-6)
        for i in np.nonzero(w > 1e-3)[0]:
            g.add([int(i)], float(w[i]), "REPLACE")
    mesh.add_armature_modifier(obj, arm)
    mesh.parent_keep(obj, arm)


def _install_bind() -> None:
    from common import pipeline
    orig = pipeline.bind_part
    if getattr(orig, "_lisvel", False):
        return

    def bind_part(ctx, part, obj, body_low=None):
        if part.bind == "skirt":
            _assign(obj, ctx.info.armature, _skirt_weights)
            return {}
        if part.bind == "string":
            _assign(obj, ctx.info.armature, _string_weights)
            return {}
        if part.bind == "arm":
            _assign(obj, ctx.info.armature, _arm_weights)
            return {}
        if part.bind in ("torso", "torso_ua"):
            # bone heat without the arms (the right forearm lies on the belly at bind and heat gave the belt's and the
            # strap's front to it: a dark strip followed the raised hand)
            from common import mesh as _mesh
            ex = ("root", "prop.L", "prop.R", "forearm.L", "forearm.R", "hand.L", "hand.R")
            if part.bind == "torso":
                ex = ex + ("upper_arm.L", "upper_arm.R")
            res = _mesh.bind_auto(obj, ctx.info.armature, exclude=ex)
            _mesh.limit_weights(obj)
            return res
        return orig(ctx, part, obj, body_low)
    bind_part._lisvel = True
    pipeline.bind_part = bind_part


_install_bind()


# ── paint: every part painted procedurally in the concept's material colours (FIX PASS 1, review items 2-4, 6, 7, 9).
# Each painter returns linear RGB for the texels of its part (rest-frame positions P, smooth normals N); the sculpt's
# folds and forms come through the baked normal map and the AO in the base (AO_INTO_BASE). The skins paint in their
# own colours (PAINT_SKIN over PAINT_BASE), so the recolour pass leaves them as painted.
PAINT_BASE = dict(
    wrap="#ABA79F", mask="#BDB8AD", lip="#AE9F95", recess="#1D2127", glass="#A6C2D6", glass_core="#6D8597",
    glass_eye="#46596A", cowl="#A9A69F", sleeve="#ADA8A0", shirt="#8F8B84", tabard="#5B6670", trim="#878C90",
    chevron="#878C90", tunic="#8A867E", belt="#40372F", strap="#3F3630", bracer="#433A34", buckle="#4A4743",
    legs="#262120", boots="#2C2926", sole="#1B1917", quiver="#5A4A3C", holster="#4B3D32", qstrap="#352D28",
    quiver_in="#211B17", wood="#C6BDAB", grip="#3E3530", shaft="#BDB29E", fletch="#A9B6C0", string="#CFC8B8",
    rope="#9A8F7A", skin="#B48F78", tab="#3B322C", brooch="#B6B1A6", neck="#8A6A58", ink="#2E2A26",
    fan_shaft="#D2C9B6", fan_fletch="#C4D0D9")
PAINT_SKIN = {
    # Gorgewalk: the keepers of the Needlespan gorge: slate limbs, gorge-rope bindings and trims, a lichen-moss
    # tabard (hue 92, sat 18 %), a slate quiver with ironstone pins, a stone-grey wrap
    "lisvel_gorgewalk": dict(wood="#6E747C", tabard="#56604F", trim="#9A8F7A", chevron="#9A8F7A", quiver="#545A61",
                             holster="#464B51", qstrap="#3F4348", wrap="#A39F94", cowl="#A09C91", fletch="#A49C8A",
                             grip="#5A544B", bracer="#4A443D"),
    # Almanac: a page of the season almanac: parchment limbs ruled in ink, a parchment tabard ruled in ink with an
    # ink border, ink fletching plates, an ink-dark quiver
    "lisvel_almanac": dict(wood="#D0C5AC", tabard="#8C8577", trim="#2E2A26", chevron="#2E2A26", fletch="#2E2A26",
                           fan_fletch="#2E2A26", quiver="#3A3430", holster="#2E2A26", qstrap="#2A2623",
                           wrap="#B2AC9D", cowl="#AFA99B"),
}
_SKIN = {"id": None}
MAX_LIN = 0.60          # no texel lighter than ~L* 81 in the albedo (the brief's L* 86 cap after the top light)


def _hl(h):
    h = h.lstrip("#")
    c = np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def C(key):
    """the painted colour of `key` for the skin being built (linear RGB)"""
    return _hl(PAINT_SKIN.get(_SKIN["id"], {}).get(key, PAINT_BASE[key]))


def _lum(c):
    return c[..., 0] * 0.2126 + c[..., 1] * 0.7152 + c[..., 2] * 0.0722


def _hash(x):
    return (np.sin(x * 12.9898 + 4.1) * 43758.5453) % 1.0


def _brk(p, a=0.06, f1=9.0, f2=26.0):
    """painterly value breakup"""
    return 1.0 + a * (0.65 * NOISE(p, f1) + 0.35 * NOISE(p, f2))


def _tl(n, a=0.10):
    """a soft painted top light"""
    return 1.0 - a * 0.5 + a * 0.5 * np.clip(n[:, 2], -1.0, 1.0)


def _mix(c, col, w):
    w = np.clip(w, 0.0, 1.0)[:, None]
    col = np.asarray(col, dtype=np.float64)
    if col.ndim == 1:
        col = col[None, :]
    return c * (1.0 - w) + col * w


def _seg_dist(p, a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    ab = b - a
    t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(p - (a + np.outer(t, ab)), axis=1)


def _bow_local(p):
    """(u along the chord, v toward the belly, n across the plane) of rest-frame points"""
    q = p - S0
    return q @ U_REST, q @ D_REST, q @ N_REST


def _limb_sec(p):
    """(u, dv across the strip's thickness, n across its width, half width, half thickness)"""
    u, v, w = _bow_local(p)
    au = np.abs(u)
    dv = (v - prof_v(u)) / np.sqrt(1.0 + dprof(np.minimum(au, TIP_U)) ** 2)
    return u, dv, w, _tab(LIMB_W, au) * 0.5, _tab(LIMB_T, au) * 0.5


def _cloth(p, n, key, a=0.05):
    return C(key) * (_brk(p, a) * _tl(n, 0.10))[:, None]


# — head —
def paint_wrap(p, n):
    """the turban's layered bands: each band its own value, a soft shadow under every proud lower edge, a lit roll
    along the edge itself, faint cloth texture"""
    S = _band_s(p)
    H = _band_h(S)
    top = np.argmax(H, axis=1)
    any_ = H.max(1) > 0
    s_top = S[np.arange(len(p)), top]
    val = 1.0 + 0.09 * (_hash(top.astype(float) + 3.0) - 0.5) * any_
    # the shadow cast under a band's lower edge onto the band beneath (s just below 0 of any band)
    sh = np.clip(1.0 - np.min(np.where((S < 0.0) & (S > -0.25), -S / 0.25, 1.0), axis=1), 0, 1) ** 1.5
    roll = np.exp(-((s_top - 0.05) / 0.05) ** 2) * any_
    k = val * (1.0 - 0.28 * sh) * (1.0 + 0.06 * roll) * _brk(p, 0.04, 14.0, 40.0) * _tl(n, 0.12)
    # inside the face opening the wrap falls into shadow round the mask
    to_f = np.array([0.0, -0.118, 1.695]) - p
    inward = (n * to_f).sum(1) / (np.linalg.norm(to_f, axis=1) + 1e-6)
    near = np.linalg.norm((p - np.array([0.0, -0.10, 1.70])) * np.array([1.0, 1.0, 0.75]), axis=1) < 0.105
    k = k * (1.0 - 0.35 * _ss(0.1, 0.6, inward) * near)
    return C("wrap") * k[:, None]


def paint_mask(p, n):
    """the calm chalk face-plate (review item 3): an even chalk lit from the front, the ink recess behind the visor,
    closed lips a touch warmer with a soft line curving up at the corners (a slight smile), a soft shadow under the
    nose, two faint incised facet lines on each cheek (the painting's carving), nothing dark at the mouth"""
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    front = _ss(0.1, 0.9, -n[:, 1])
    k = (0.86 + 0.14 * front) * (1.0 - 0.10 * _ss(0.045, 0.072, np.abs(x))) * _brk(p, 0.025, 20.0, 50.0)
    col = C("mask") * k[:, None]
    # the lips: a soft warm mound and the smile line
    lip = np.exp(-((x / 0.017) ** 2 + ((z - 1.651) / 0.0085) ** 2)) * _ss(-0.095, -0.102, y)
    col = _mix(col, C("lip") * k[:, None], 0.45 * lip)
    line_z = 1.6505 + 0.0032 * (x / 0.0155) ** 2
    mline = np.exp(-((z - line_z) / 0.0010) ** 2) * _ss(0.018, 0.012, np.abs(x)) * _ss(-0.097, -0.103, y)
    col = col * (1.0 - 0.30 * mline)[:, None]
    # under the nose
    ns = np.exp(-((x / 0.010) ** 2 + ((z - 1.678) / 0.006) ** 2)) * _ss(-0.095, -0.104, y)
    col = col * (1.0 - 0.14 * ns)[:, None]
    # the concept's incised segment lines (a carved plate, not a blank mannequin face): the forehead's centre line
    # and its branches above the visor, from each nose wing out under the visor to the temple, down past the
    # mouth corners to the jaw, along each cheekbone to the jaw's corner, the chin's outline
    fac = np.zeros(len(p))
    q = np.stack([x, z], 1)
    for sx in (-1.0, 1.0):
        for (x0, z0, x1, z1) in ((0.0, 1.760, 0.0, 1.800), (0.0, 1.775, 0.028, 1.792), (0.028, 1.792, 0.050, 1.785),
                                 (0.012, 1.700, 0.040, 1.708), (0.040, 1.708, 0.062, 1.712),
                                 (0.014, 1.690, 0.022, 1.662), (0.022, 1.662, 0.030, 1.630),
                                 (0.046, 1.702, 0.054, 1.668), (0.054, 1.668, 0.044, 1.632),
                                 (0.030, 1.630, 0.016, 1.616), (0.030, 1.630, 0.044, 1.632)):
            a, b = np.array([sx * x0, z0]), np.array([sx * x1, z1])
            t = np.clip(((q - a) @ (b - a)) / max((b - a) @ (b - a), 1e-9), 0, 1)
            d = np.linalg.norm(q - (a + np.outer(t, b - a)), axis=1)
            fac = np.maximum(fac, np.exp(-(d / 0.0011) ** 2))
    fac = fac * _ss(-0.08, -0.095, y)
    col = col * (1.0 - 0.42 * fac)[:, None]
    # the ink recess behind the glass
    rec = _ss(0.0185, 0.0150, np.abs(z - VIS_Z)) * _ss(-0.101, -0.094, y) * _ss(0.082, 0.070, np.abs(x))
    return _mix(col, C("recess"), rec)


def paint_visor(p, n):
    """the flat dawnglass band painted as glass with depth (review item 3: an opaque azure bar): pale icy glass, a
    smoky core where the ink recess shows through, two darker eye shapes behind, a bright streak along the upper
    third, pale lit top and bottom faces (the beak's top reads from the game camera), the sides darker into the wrap"""
    x, y, z = p[:, 0], p[:, 1], p[:, 2] - VIS_Z
    fr = _ss(0.55, 0.85, -n[:, 1])
    core = np.exp(-(z / 0.014) ** 2) * fr
    col = _mix(np.tile(C("glass"), (len(p), 1)), C("glass_core"), 0.30 * core)
    eye = np.zeros(len(p))
    for sx in (-1.0, 1.0):
        # an almond eye socket seen through the glass: crisp-edged, its outer corner lifted a little
        ex = (x - sx * 0.033) / 0.019
        ez = (z + 0.001 - 0.002 * sx * (x - sx * 0.033) / 0.019 * 0.0) / 0.0072
        r = ex ** 2 + (ez / np.maximum(1.0 - 0.35 * ex ** 2, 0.2)) ** 2
        eye = np.maximum(eye, _ss(1.0, 0.65, r))
    col = _mix(col, C("glass_eye"), 0.62 * eye * fr)
    streak = np.exp(-((z - 0.0135) / 0.0024) ** 2) * fr * _ss(0.085, 0.05, np.abs(x))
    col = col * (1.0 + 0.32 * streak)[:, None]
    topb = _ss(0.5, 0.8, np.abs(n[:, 2]))
    col = _mix(col, C("glass") * 1.08, topb)
    sides = _ss(-0.10, -0.06, y) * (1.0 - topb)
    col = col * (1.0 - 0.22 * sides)[:, None]
    return col


def paint_neck(p, n):
    v = (0.55 + 0.25 * np.clip(-n[:, 1], 0, 1)) * (0.70 + 0.25 * _ss(1.53, 1.60, p[:, 2]))
    return C("neck") * v[:, None]


# — torso —
def paint_cowl(p, n):
    """the pale linen scarf: soft value breakup, the folds' valleys a step darker toward the neck"""
    r = np.hypot(p[:, 0], p[:, 1] - 0.006)
    k = _brk(p, 0.06, 8.0, 24.0) * _tl(n, 0.14) * (1.0 - 0.10 * _ss(0.10, 0.06, r) * _ss(1.60, 1.56, p[:, 2]))
    return C("cowl") * k[:, None]


def paint_body(p, n):
    return C("shirt") * (0.9 + 0.08 * NOISE(p, 20.0))[:, None]


def _trim_band(d, w=0.017):
    """1 within w of an edge (|d| small), soft inside"""
    return _ss(w, w * 0.75, np.abs(d))


def paint_tabard(p, n):
    """the steel-blue felt tabard (review item 4: hue 209, sat 19 % in the albedo, under the 40 % ceiling) with the
    concept's grey trims round the armholes, the neck and the shoulder pads' outer edges (review item 6)"""
    col = _cloth(p, n, "tabard", 0.05)
    trim = np.zeros(len(p))
    for e in ARMHOLES + [NECKHOLE]:
        trim = np.maximum(trim, _trim_band(e.d(p)))
    for e in PADS:
        dd = e.d(p)
        edge = _ss(0.012, 0.004, np.abs(dd)) * _ss(0.226, 0.236, np.abs(p[:, 0]))
        trim = np.maximum(trim, edge)
    col = _mix(col, C("trim") * (_brk(p, 0.04) * _tl(n, 0.12))[:, None], trim)
    return _skin_print(col, p, n, trim)


def paint_skirt(p, n):
    """the tabard's four lower panels: grey trims along the hem and every slit edge, a small chevron mark on each
    front panel above the hem (the painting's)"""
    col = _cloth(p, n, "tabard", 0.05)
    trim = _trim_band(p[:, 2] - _tabard_hem(p), 0.022) * (p[:, 2] < _tabard_hem(p) + 0.04)
    for s_ in SKIRT_SLITS:
        trim = np.maximum(trim, _trim_band(s_.d(p), 0.016))
    x, z = p[:, 0], p[:, 2]
    chev = np.zeros(len(p))
    for sx in (-1.0, 1.0):
        x0, z0 = sx * 0.085, 0.862
        q = np.stack([x, z], 1)
        for a, b in (((x0 - 0.013, z0 - 0.009), (x0, z0 + 0.004)), ((x0, z0 + 0.004), (x0 + 0.013, z0 - 0.009))):
            a, b = np.array(a), np.array(b)
            t = np.clip(((q - a) @ (b - a)) / ((b - a) @ (b - a)), 0, 1)
            d = np.linalg.norm(q - (a + np.outer(t, b - a)), axis=1)
            chev = np.maximum(chev, _ss(0.0032, 0.0018, d) * (p[:, 1] < -0.02))
    edge = np.maximum(trim, chev)
    col = _mix(col, C("trim") * (_brk(p, 0.04) * _tl(n, 0.12))[:, None], trim)
    col = _mix(col, C("chevron") * _tl(n, 0.12)[:, None], chev)
    return _skin_print(col, p, n, edge)


def _skin_print(col, p, n, edge):
    """Almanac: the tabard printed as a ledger page (fine ink rules every 2.2 cm, a margin rule on each front panel);
    Gorgewalk: a faint lichen mottling on the felt"""
    sid = _SKIN["id"]
    if sid == "lisvel_almanac":
        z = p[:, 2]
        rule = np.exp(-(((z % 0.022) - 0.011) / 0.0007) ** 2)
        margin = np.exp(-((np.abs(p[:, 0]) - 0.072) / 0.0009) ** 2) * (p[:, 1] < 0)
        k = np.clip(0.30 * rule + 0.35 * margin, 0, 0.45) * (1.0 - edge)
        col = _mix(col, C("ink"), k)
    elif sid == "lisvel_gorgewalk":
        m = np.clip(NOISE.fbm(p, 11.0, 3) * 1.6, -1, 1)
        col = col * (1.0 + 0.07 * m * (1.0 - edge))[:, None]
    return col


def paint_tunic(p, n):
    col = _cloth(p, n, "tunic", 0.05)
    hem = _ss(0.012, 0.0, p[:, 2] - _tunic_hem(p))
    return col * (1.0 - 0.10 * hem)[:, None]


def paint_belt(p, n):
    grain = 1.0 + 0.05 * NOISE(p, 60.0)
    return C("belt") * (grain * _tl(n, 0.16) * _brk(p, 0.05))[:, None]


def paint_straps(p, n):
    grain = 1.0 + 0.05 * NOISE(p, 60.0)
    return C("strap") * (grain * _tl(n, 0.16) * _brk(p, 0.06))[:, None]


def paint_buckle(p, n):
    return C("buckle") * (0.9 + 0.12 * np.clip(n[:, 2] * 0.5 + 0.5, 0, 1))[:, None]


def paint_brooch(p, n):
    return C("brooch") * (0.88 + 0.14 * np.clip(-n[:, 1], 0, 1))[:, None]


def paint_brooch_glass(p, n):
    bc = np.array([-0.072, -0.124, 1.508])
    r = np.linalg.norm(p - bc, axis=1)
    col = _mix(np.tile(C("glass"), (len(p), 1)), C("glass_core"), 0.6 * _ss(0.016, 0.004, r))
    return col


# — arms —
def paint_sleeves(p, n):
    """the white linen sleeves (no projection: no grey patches, no ink at the bracers): a soft top light, the inner
    arm a step darker, gathered creases where they enter the bracers"""
    col = _cloth(p, n, "sleeve", 0.05)
    out = col.copy()
    dR = np.minimum(_seg_dist(p, SH_R, EL_R), _seg_dist(p, EL_R, WR_R))
    dL = np.minimum(_seg_dist(p, SH_L, EL_L), _seg_dist(p, EL_L, WR_L))
    for sh, el, wr, sel in ((SH_R, EL_R, WR_R, dR <= dL), (SH_L, EL_L, WR_L, dL < dR)):
        if not sel.any():
            continue
        q = p[sel]
        t, _ = _seg_t(q, el, wr)
        ax = _n(wr - el)
        e1 = _n(np.cross(ax, [0.0, 0.0, 1.0]))
        th = np.arctan2((q - el) @ np.cross(ax, e1), (q - el) @ e1)
        gather = _ss(0.12, 0.30, t) * (1.0 - _ss(0.40, 0.48, t))
        crease = 0.5 + 0.5 * np.sin(th * 7.0 + 3.0 * NOISE(q, 25.0))
        inner = _ss(0.2, 0.8, -(n[sel] @ np.array([np.sign(sh[0]), 0.0, 0.0])))
        k = (1.0 - 0.12 * gather * crease) * (1.0 - 0.07 * inner)
        out[sel] = col[sel] * k[:, None]
    return out


def paint_bracers(p, n):
    """the dark wrapped bracers: bands wound slanting round each forearm (the sculpt's helix), a dark groove at each
    seam, a lit ridge mid-band"""
    out = np.zeros((len(p), 3))
    dR = _seg_dist(p, EL_R, WR_R)
    dL = _seg_dist(p, EL_L, WR_L)
    for el, wr, sel in ((EL_R, WR_R, dR <= dL), (EL_L, WR_L, dL < dR)):
        if not sel.any():
            continue
        a, b = el + (wr - el) * 0.24, wr + (wr - el) * 0.05
        u = _n(b - a)
        e1 = _n(np.cross(u, [0.0, 0.0, 1.0]) if abs(u[2]) < 0.9 else np.cross(u, [1.0, 0.0, 0.0]))
        e2 = np.cross(u, e1)
        q = p[sel] - a
        th = np.arctan2(q @ e2, q @ e1)
        ph = (q @ u) / 0.032 + 0.8 * th / (2 * math.pi) + 0.15 * NOISE(p[sel], 6.0)
        f = ph - np.floor(ph)
        groove = np.exp(-((f - 0.02) / 0.07) ** 2) + np.exp(-((f - 1.02) / 0.07) ** 2)
        ridge = np.sin(np.pi * f)
        band = _hash(np.floor(ph)) - 0.5
        v = (0.80 + 0.26 * ridge) * (1 - 0.45 * np.clip(groove, 0, 1)) * (1 + 0.10 * band)
        out[sel] = C("bracer") * v[:, None]
    return out * (0.88 + 0.16 * np.clip(n[:, 2] * 0.5 + 0.5, 0, 1))[:, None]


def paint_hand_l(p, n):
    v = 0.84 + 0.22 * np.clip(n[:, 2] * 0.5 + 0.5, 0, 1) + 0.04 * NOISE(p, 40.0)
    return C("skin") * v[:, None]


def paint_hand_r(p, n):
    """the drawing hand with its leather tab over the hooked fingers (brief section 4; review item 11)"""
    col = paint_hand_l(p, n)
    tab = _ss(0.036, 0.026, np.linalg.norm(p - PINCH_R, axis=1))
    return _mix(col, C("tab") * (0.9 + 0.12 * np.clip(n[:, 2], -1, 1))[:, None], tab)


# — legs —
def paint_legs(p, n):
    """the dark leggings: even (review item 2: the painting's shading baked dark blotches on the thighs and knees),
    a soft top light, the knee a touch lighter"""
    v = (1.0 + 0.025 * NOISE(p, 9.0)) * _tl(n, 0.10)
    knee = np.exp(-((p[:, 2] - 0.51) / 0.05) ** 2) * (n[:, 1] < 0.1)
    return C("legs") * (v * (1 + 0.05 * knee))[:, None]


def paint_boots(p, n):
    """the dark soft boots: a darker sole and heel, creases over the ankle, a lighter cuff fold"""
    z = p[:, 2]
    col = C("boots") * ((1.0 + 0.04 * NOISE(p, 30.0)) * _tl(n, 0.16))[:, None]
    sole = _ss(0.021, 0.015, z) + _ss(0.046, 0.040, z) * (p[:, 1] > 0.036)
    col = _mix(col, C("sole"), np.clip(sole, 0, 1))
    crease = np.exp(-((z - 0.12) / 0.04) ** 2) * (0.5 + 0.5 * np.sin(z * 260.0 + 2.0 * NOISE(p, 20.0)))
    col = col * (1.0 - 0.12 * crease)[:, None]
    cuff = _ss(0.445, 0.458, z)
    return col * (1.0 + 0.10 * cuff)[:, None]


# — quiver —
def paint_quiver(p, n):
    """the brown leather tube: grain, a stitched seam down the inner side, the inside of the mouth dark and smooth
    (review item 2: no black shards)"""
    q = p - Q_BOT
    t, w, nn = q @ Q_U, q @ Q_W, q @ Q_N
    col = C("quiver") * ((1.0 + 0.05 * NOISE(p, 50.0)) * _brk(p, 0.06) * _tl(n, 0.14))[:, None]
    seam = np.exp(-((nn + Q_HD) / 0.004) ** 2) * (0.5 + 0.5 * np.sign(np.sin(t * 2 * math.pi / 0.012)))
    col = col * (1.0 - 0.25 * seam)[:, None]
    L = float(np.linalg.norm(Q_TOP - Q_BOT))
    rv = w[:, None] * Q_W[None, :] + nn[:, None] * Q_N[None, :]
    rv = rv / (np.linalg.norm(rv, axis=1, keepdims=True) + 1e-9)
    inward = (n * rv).sum(1) < -0.2
    floor = ((n @ Q_U) > 0.5) & (t < L - 0.008)
    inside = ((inward | floor) & (t > L - 0.07)).astype(float)
    return _mix(col, C("quiver_in"), inside)


def paint_holster(p, n):
    """the outer cover of the two-part holster: a darker leather with a stitched border"""
    col = C("holster") * ((1.0 + 0.05 * NOISE(p, 50.0)) * _brk(p, 0.06) * _tl(n, 0.14))[:, None]
    q = p - Q_BOT
    w = q @ Q_W
    st = np.exp(-((np.abs(w) - (Q_HW - 0.002)) / 0.003) ** 2) * (0.5 + 0.5 * np.sign(np.sin((q @ Q_U) * 2 * math.pi / 0.012)))
    col = col * (1.0 + 0.30 * st)[:, None]
    return _skin_pins(col, p)


def _skin_pins(col, p):
    """Gorgewalk's iron-pinned quiver: a column of ironstone pin heads down the cover's outer face"""
    if _SKIN["id"] != "lisvel_gorgewalk":
        return col
    q = p - Q_BOT
    t, w, nn = q @ Q_U, q @ Q_W, q @ Q_N
    pin = np.zeros(len(p))
    for tt in np.arange(0.20, 0.50, 0.05):
        for ww in (-0.030, 0.030):
            pin = np.maximum(pin, np.exp(-(((t - tt) ** 2 + (w - ww) ** 2) / 0.0055 ** 2)))
    return _mix(col, _hl("#3F4348"), pin * (nn > 0.0))


def paint_qstraps(p, n):
    return C("qstrap") * ((1.0 + 0.05 * NOISE(p, 50.0)) * _tl(n, 0.14))[:, None]


def paint_shafts(p, n):
    return C("shaft") * (1 + 0.03 * NOISE(p * np.array([4, 4, 1]), 30.0))[:, None]


def paint_fletch(p, n):
    """gull-grey feather plates with fine barbs and a darker quill edge"""
    v = (0.92 + 0.08 * np.sin(p[:, 2] * 900.0 + 3.0 * NOISE(p, 50.0))) * (0.92 + 0.10 * np.clip(n[:, 2], -1, 1))
    return C("fletch") * v[:, None]


# — bow —
def paint_bow(p, n):
    """the pale ash strips (review item 1: no spiral, no banding): long grain running along the limb, the bevels worn
    a little paler, the belly a touch lighter than the back, the lower limb (her right) a few L* darker; Almanac:
    ruled in ink like a page; Gorgewalk: slate with a faint stone speckle"""
    u, dv, w, hw, ht = _limb_sec(p)
    g1 = NOISE(np.stack([u * 3.0, dv * 50.0, w * 50.0], 1), 1.0)
    g2 = NOISE(np.stack([u * 9.0, dv * 140.0, w * 140.0], 1), 1.0)
    col = C("wood") * (1.0 + 0.05 * g1 + 0.03 * g2)[:, None]
    bevel = _ss(0.55, 0.85, np.minimum(np.abs(w) / np.maximum(hw, 1e-3), np.abs(dv) / np.maximum(ht, 1e-3)))
    col = col * (1.0 + 0.07 * bevel)[:, None]
    col = col * (1.0 + 0.04 * _ss(0.0, -0.01, dv))[:, None]
    col = col * (1.0 - 0.05 * _ss(0.0, -0.4, u))[:, None]
    sid = _SKIN["id"]
    if sid == "lisvel_almanac":
        au = np.abs(u)
        rule = np.exp(-(((au % 0.026) - 0.013) / 0.0011) ** 2)
        wn = np.abs(w) / np.maximum(hw, 1e-3)
        margin = np.exp(-((wn - 0.66) / 0.05) ** 2)
        ticks = np.exp(-(((au % 0.0065) - 0.0032) / 0.0006) ** 2) * (wn < 0.45) * (((au // 0.026) % 2) < 1)
        k = np.clip(0.55 * rule + 0.60 * margin + 0.25 * ticks, 0, 0.7) * (au < CAP0)
        col = _mix(col, C("ink"), k)
    elif sid == "lisvel_gorgewalk":
        sp = np.clip(NOISE(p, 160.0) * 2.0 - 0.6, 0, 1)
        col = col * (1.0 - 0.18 * sp)[:, None]
    return col


def paint_grip(p, n):
    """the leather grip: smooth, a fine diagonal wrap line every 9 mm (review item 1: no stripes, no pale patch)"""
    u, dv, w, hw, ht = _limb_sec(p)
    th = np.arctan2(dv, w)
    ph = u / 0.009 + th / (2 * math.pi)
    line = np.exp(-(((ph % 1.0) - 0.5) / 0.08) ** 2)
    k = (1.0 - 0.08 * line) * (1.0 + 0.04 * NOISE(p, 60.0)) * (1.0 - 0.12 * _ss(0.06, 0.075, np.abs(u)))
    return C("grip") * k[:, None]


def paint_caps(p, n):
    """the dawnglass hook caps: pale glass (not a saturated capsule), a deeper core along the middle, the edges and
    the hook's end catching the light"""
    u, dv, w, hw, ht = _limb_sec(p)
    au = np.abs(u)
    edge = _ss(0.55, 0.85, np.minimum(np.abs(w) / (hw + 0.0035), np.abs(dv) / (ht + 0.0035)))
    core = (1.0 - edge) * _ss(CAP0 + 0.01, CAP0 + 0.04, au)
    col = _mix(np.tile(C("glass"), (len(p), 1)), C("glass_core"), 0.35 * core)
    col = col * (1.0 + 0.12 * edge + 0.10 * _ss(TIP_U - 0.03, TIP_U, au))[:, None]
    return col


def paint_string(p, n):
    return C("string") * (0.92 + 0.08 * NOISE(p, 60.0))[:, None]


def paint_rope(p, n):
    """Gorgewalk's gorge-rope bindings: twisted plies, a dark groove between them"""
    u, dv, w, hw, ht = _limb_sec(p)
    th = np.arctan2(dv, w)
    ph = np.abs(u) / 0.0085 + th / (2 * math.pi) * 0.8 + 0.2 * NOISE(p, 30.0)
    f = ph % 1.0
    v = 0.80 + 0.30 * np.sin(np.pi * f)
    return C("rope") * v[:, None]


def paint_fan_shaft(p, n):
    return C("fan_shaft") * (1.0 + 0.03 * NOISE(p, 40.0))[:, None]


def paint_fan_fletch(p, n):
    v = (0.94 + 0.06 * np.sin(p[:, 2] * 700.0 + 3.0 * NOISE(p, 50.0)))
    return C("fan_fletch") * v[:, None]


def paint_glass(p, n):
    return C("glass") * (0.95 + 0.1 * np.clip(n[:, 2], -1, 1))[:, None]


PROC = {"wrap": paint_wrap, "mask": paint_mask, "visor": paint_visor, "neck": paint_neck, "cowl": paint_cowl,
        "body": paint_body, "tabard": paint_tabard, "tabard_skirt": paint_skirt, "tunic": paint_tunic,
        "belt": paint_belt, "buckle": paint_buckle, "straps": paint_straps, "brooch": paint_brooch,
        "brooch_glass": paint_brooch_glass, "sleeves": paint_sleeves, "bracers": paint_bracers,
        "hand_L": paint_hand_l, "hand_R": paint_hand_r, "legs": paint_legs, "boots": paint_boots,
        "quiver": paint_quiver, "quiver_holster": paint_holster, "quiver_straps": paint_qstraps,
        "arrow_shafts": paint_shafts, "fletching": paint_fletch, "bow": paint_bow, "bow_grip": paint_grip,
        "bow_caps": paint_caps, "string": paint_string, "fan_shafts": paint_fan_shaft, "fan_fletch": paint_fan_fletch,
        "fan_heads": paint_glass, "rope_bind": paint_rope}


def post_paint(maps: dict, names: list, log=print) -> np.ndarray:
    from common.hifi import project
    part = maps["part"]
    have = part >= 0
    idx = np.nonzero(have)
    size = part.shape[0]
    lin = np.zeros((size, size, 3), dtype=np.float32)
    P = maps["P"][idx].astype(np.float64)
    N = maps["N"][idx].astype(np.float64)
    K = part[idx].astype(np.int64)
    L = np.zeros((len(K), 3))
    for i, name in enumerate(names):
        m = K == i
        if not m.any():
            continue
        fn = PROC.get(name)
        if fn is None:
            L[m] = _hl("#808080")
            log(f"  paint {name}: no painter (grey)")
            continue
        L[m] = fn(P[m], N[m])
        log(f"  paint {name}: {int(m.sum())} texels")
    L = np.clip(L, 0.0, None)
    L = L * np.minimum(1.0, MAX_LIN / np.maximum(L.max(1), 1e-6))[:, None]
    lin[idx] = L
    out = project._srgb(lin).astype(np.float32)
    iy, ix = project.nearest_index(have)
    return out[iy, ix]


def _install_paint() -> None:
    from common.hifi import project
    orig = project.paint_object
    if getattr(orig, "_lisvel", False):
        return

    def paint_object(obj, size, cfg, names, part_attr="vale_part", log=print, return_maps=False):
        maps = project.rasterize(obj, size, part_attr)
        img = post_paint(maps, names, log=log)
        return (img, maps) if return_maps else img
    paint_object._lisvel = True
    project.paint_object = paint_object


def _install_recolour() -> None:
    """the skins are painted in their own colours by post_paint: the recolour pass leaves them as painted"""
    from common.hifi import project
    orig = project.recolour
    if getattr(orig, "_lisvel", False):
        return

    def recolour(img, maps, names, roles, base_pal, skin_pal, skip=None, log=print):
        if _SKIN["id"] in PAINT_SKIN:
            log(f"  skin {_SKIN['id']}: painted in its own colours (no recolour)")
            return img
        return orig(img, maps, names, roles, base_pal, skin_pal, skip=skip, log=log)
    recolour._lisvel = True
    project.recolour = recolour


_install_paint()
_install_recolour()


# ── the base splash's line of light (brief section 8 victory, review item 7): an emissive strip on the ground running
# from her feet away toward screen-right; it is left out of the camera fit and hidden for the turntable ─────────────
LIGHTLINE = "lisvel_lightline"


def _lightline(col):
    import bmesh
    from common import mesh as _mesh
    me_name = LIGHTLINE
    if LIGHTLINE in bpy.data.objects:
        return bpy.data.objects[LIGHTLINE]
    bm = bmesh.new()
    d = _n(np.array([0.56, 0.83, 0.0]))
    s = np.array([-d[1], d[0], 0.0])
    pts = []
    for i in range(41):
        t = 0.20 + 6.0 * i / 40.0
        w = 0.055 * (1.0 - 0.55 * i / 40.0)
        c = d * t + np.array([0.0, 0.0, 0.004])
        pts.append((c - s * w, c + s * w))
    vs = [(bm.verts.new(tuple(a)), bm.verts.new(tuple(b))) for a, b in pts]
    for i in range(len(vs) - 1):
        bm.faces.new((vs[i][0], vs[i + 1][0], vs[i + 1][1], vs[i][1]))
    ob = _mesh.bm_to_obj(bm, me_name, col)
    m = bpy.data.materials.new("lisvel_lightline")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = (0.80, 0.90, 1.0, 1.0)
    e.inputs["Strength"].default_value = 9.0
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(e.outputs[0], o.inputs[0])
    ob.data.materials.append(m)
    ob.visible_shadow = False
    return ob


def _install_renders() -> None:
    from common import render
    orig = render.fighter_renders
    if getattr(orig, "_lisvel", False):
        return
    orig_bounds = render.posed_bounds
    orig_turn = render.turntable

    def posed_bounds(objs):
        return orig_bounds([o for o in objs if o.name != LIGHTLINE])

    def turntable(ctx, P, chains, fast):
        ln = bpy.data.objects.get(LIGHTLINE)
        if ln is not None:
            ln.hide_render = True
        return orig_turn(ctx, P, chains, fast)

    def fighter_renders(ctx, objs, P, skin, fast=False, clip_sheet=False, only=None, scale=1.0):
        if skin or getattr(ctx.spec, "ID", None) != ID:
            return orig(ctx, objs, P, skin, fast=fast, clip_sheet=clip_sheet, only=only, scale=scale)
        ln = _lightline(ctx.col)
        ln.hide_render = False
        try:
            return orig(ctx, list(objs) + [ln], P, skin, fast=fast, clip_sheet=clip_sheet, only=only, scale=scale)
        finally:
            ln.hide_render = True
    posed_bounds._lisvel = True
    fighter_renders._lisvel = True
    render.posed_bounds = posed_bounds
    render.turntable = turntable
    render.fighter_renders = fighter_renders


_install_renders()

# ── motion ─────────────────────────────────────────────────────────────────────────────────────────────────────
# The concept's carry is the guard, turned into an archer's ready stance (the body 50 degrees to her right, the head
# toward the facing): the bow level across her turned chest, string up, the left fist on the riser, the right hand on
# the string. The left (bow) hand is BH: a shoulder-relative IK target in the chest frame, or (kb = 1) solved so the
# bow's grip lands where the arrow line through an anchor beside her right jaw needs it (d = the shot), plus an aim
# with roll for the bow (its shot axis D and its upper limb U); the right hand is RH: a blend between a free
# shoulder-relative reach (k = 0) and a pinch on the bow's arrow line (k = 1: `along` metres from the grip along the
# shot axis, `uoff` along the chord), so a full draw puts the drawing hand on the anchor.
# Every pose carries channels: "_str" (0..1: the string's nock follows the pinch), "_fan" (0..1: Morning Draw's fan),
# "_slide" (0..1: the bow slides its grip into the fist), "_drop" (0..1: the death's bow falls to the ground).
HT, FT = anim.HandTarget, anim.FootTarget
POLE_R = (-0.7, 0.6, -0.4)
POLE_L = (0.9, 0.3, -0.3)
UPZ = (0.0, 0.0, 1.0)
REST_L = tuple((WR_L - SH_L) / L_ARM)
REST_R = tuple((WR_R - SH_R) / L_ARM)
READY_YAW = -50.0           # the guard's body turn (review item 8)
IDLE_LIFT = 0.07            # the guard raises the carry ~5 cm over the bind (the string ~1.21 m)
IDLE_SHIFT = 0.18           # ... and moves it 7 cm toward her left (the rear tip off her right side: HP bar clearance)


def _rz(v, deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]])


def _rx(v, deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([v[0], c * v[1] - s * v[2], s * v[1] + c * v[2]])


def chest_rel(v_world, yaw=0.0, lean=0.0):
    """a world (character-space) wrist offset in arm lengths -> the chest frame of a pose turned `yaw` (deg, + = to
    her left) and leant `lean` (deg, + = forward)"""
    return tuple(_rx(_rz(np.asarray(v_world, float), -yaw), -lean))


@dataclass
class AimRoll(anim.Aim):
    """anim.Aim + `up`: where the held item's prop +Z faces (for the bow: its upper limb U)"""
    up: tuple = (0.0, 0.0, 1.0)

    def lerp(self, o, t):
        b = anim.Aim.lerp(self, o, t)
        t = max(0.0, min(1.0, t))
        up = self.up
        if isinstance(o, AimRoll):
            a, c = V(self.up).normalized(), V(o.up).normalized()
            up = tuple((a.slerp(c, t) if a.dot(c) > -0.999 else a.lerp(c, t) + a.orthogonal() * 1e-3).normalized())
        return AimRoll(b.dir, b.weight, up)

    def mirrored(self):
        return AimRoll((-self.dir[0], self.dir[1], self.dir[2]), self.weight, (-self.up[0], self.up[1], self.up[2]))


def _lv(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


@dataclass
class RH(anim.HandTarget):
    """the drawing hand: free reach (rel, chest frame, arm lengths) blended by k toward the pinch on the bow's arrow
    line (along: m from the grip along the shot axis, negative = toward the archer; uoff: m along the chord);
    fdir: when given, the hand turns so Morning Draw's fan points there; hdir: the hand bone points there"""
    along: float = -BRACE
    uoff: float = 0.0
    k: float = 1.0
    fdir: tuple | None = None
    hdir: tuple | None = None

    def __post_init__(self):
        self.to_prop = ("prop.L", self.along)          # resolve() poses it after the bow hand and the aims
        if self.rel is None:
            self.rel = REST_R

    def lerp(self, o, t):
        if not isinstance(o, RH):
            o = RH(rel=o.rel or REST_R, pole=o.pole, weight=o.weight, k=0.0)

        def ld(a, b):
            if a is not None and b is not None:
                return tuple(V(_lv(a, b, t)).normalized())
            return b if t >= 0.5 else a
        pole = _lv(self.pole or POLE_R, o.pole or POLE_R, t)
        return RH(rel=_lv(self.rel, o.rel, t), pole=pole, weight=self.weight + (o.weight - self.weight) * t,
                  along=self.along + (o.along - self.along) * t, uoff=self.uoff + (o.uoff - self.uoff) * t,
                  k=self.k + (o.k - self.k) * t, fdir=ld(self.fdir, o.fdir), hdir=ld(self.hdir, o.hdir))

    def mirrored(self):
        return self


@dataclass
class BH(anim.HandTarget):
    """the bow hand: free reach (rel) blended by kb toward the anchored solve: the bow's grip placed on the arrow line
    d through the anchor (her head bone + `side` m to her right + `upo` up + `fwd` along d) at BRACE + `full` m from
    it, the bow aimed along d with its upper limb toward `up`"""
    kb: float = 0.0
    d: tuple = (0.0, -1.0, 0.0)
    up: tuple = (0.0, 0.0, 1.0)
    side: float = 0.09
    upo: float = 0.0
    fwd: float = 0.04
    full: float = 0.34

    def __post_init__(self):
        if self.rel is None:
            self.rel = REST_L

    def lerp(self, o, t):
        if not isinstance(o, BH):
            o = BH(rel=o.rel or REST_L, pole=o.pole, weight=o.weight, kb=0.0, d=self.d, up=self.up, side=self.side,
                   upo=self.upo, fwd=self.fwd, full=self.full)
        f = (lambda a, b: a + (b - a) * t)  # noqa: E731
        return BH(rel=_lv(self.rel, o.rel, t), pole=_lv(self.pole or POLE_L, o.pole or POLE_L, t),
                  weight=f(self.weight, o.weight), kb=f(self.kb, o.kb), d=tuple(V(_lv(self.d, o.d, t)).normalized()),
                  up=tuple(V(_lv(self.up, o.up, t)).normalized()), side=f(self.side, o.side), upo=f(self.upo, o.upo),
                  fwd=f(self.fwd, o.fwd), full=f(self.full, o.full))

    def mirrored(self):
        return self


def _anchor(M, d, side, upo, fwd):
    d = V(d).normalized()
    right = d.cross(V((0.0, 0.0, 1.0)))
    if right.length < 1e-3:
        right = V((-1.0, 0.0, 0.0))
    right.normalize()
    upv = right.cross(d).normalized()
    return M["head"].translation + right * side + upv * upo + d * fwd


def _install_solvers() -> None:
    if getattr(anim._solve_aim, "_lisvel", False):
        return
    orig_aim = anim._solve_aim

    def solve_aim(skel, pose, M, side, am):
        orig_aim(skel, pose, M, side, am)
        if not isinstance(am, AimRoll) or am.weight <= 0:
            return
        hand, prop = f"hand.{side}", f"prop.{side}"
        M2 = skel.fk(pose)
        R = M2[prop].to_3x3()
        axis = R.col[1].normalized()
        cur = R.col[2].normalized()
        want = V(am.up)
        want = want - axis * want.dot(axis)
        if want.length < 1e-5:
            return
        want.normalize()
        ang = math.atan2(cur.cross(want).dot(axis), cur.dot(want)) * am.weight
        new = Matrix.Rotation(ang, 3, axis) @ M2[hand].to_3x3()
        Ph = (M2[skel.parent[hand]] @ skel.local[hand]).to_3x3()
        pose[hand] = skel.euler_of(Ph.inverted() @ new, pose.get(hand))

    solve_aim._lisvel = True
    anim._solve_aim = solve_aim

    orig_hand = anim._solve_hand

    def solve_bow_hand(skel, pose, M, ht):
        hnd, up, fo = "hand.L", "upper_arm.L", "forearm.L"
        Rc = M["chest"].to_3x3() @ skel.rest["chest"].to_3x3().inverted()
        pole = Rc @ V(ht.pole if ht.pole else POLE_L)
        Lr = skel.length[up] + skel.length[fo]
        sh = (M[skel.parent[up]] @ skel.local[up]).translation
        free = sh + Rc @ (V(ht.rel) * Lr)
        kb = max(0.0, min(1.0, ht.kb))
        if kb <= 1e-4:
            skel.solve_two_bone(pose, M, up, fo, hnd, free, pole, False, None, ht.weight)
            return
        d = V(ht.d).normalized()
        goal = _anchor(M, d, ht.side, ht.upo, ht.fwd) + d * (BRACE + ht.full)
        am = AimRoll(tuple(d), 1.0, tuple(ht.up))
        tw = goal.copy()
        for _ in range(7):
            skel.solve_two_bone(pose, M, up, fo, hnd, tw, pole, False, None, 1.0)
            M2 = skel.fk(pose)
            anim._solve_aim(skel, pose, M2, "L", am)
            M2 = skel.fk(pose)
            err = goal - _prop_l(M2, pose).translation
            tw = tw + err
            if err.length < 0.0015:
                break
        skel.solve_two_bone(pose, M, up, fo, hnd, free.lerp(tw, kb), pole, False, None, ht.weight)

    def solve_hand(skel, pose, M, side, ht):
        if isinstance(ht, BH):
            return solve_bow_hand(skel, pose, M, ht)
        if not isinstance(ht, RH):
            return orig_hand(skel, pose, M, side, ht)
        hnd, up, fo = f"hand.{side}", f"upper_arm.{side}", f"forearm.{side}"
        Rc = M["chest"].to_3x3() @ skel.rest["chest"].to_3x3().inverted()
        pole = Rc @ V(ht.pole if ht.pole else POLE_R)
        L = skel.length[up] + skel.length[fo]
        sh = (M[skel.parent[up]] @ skel.local[up]).translation
        target = sh + Rc @ (V(ht.rel) * L)
        k = max(0.0, min(1.0, ht.k))
        end = None
        if k > 1e-4:
            Mp = _prop_l(M, pose)
            R3 = Mp.to_3x3()
            axis, upv = R3.col[1].normalized(), R3.col[2].normalized()
            grip = Mp.translation + axis * ht.along + upv * ht.uoff
            own = f"prop.{side}"
            palm_off = skel.rest[own].translation - skel.rest[hnd].translation
            hand_rest = skel.rest[hnd].to_3x3()
            relm = hand_rest.inverted() @ skel.rest[own].to_3x3()
            fwd = (grip - sh).normalized()
            end = anim._frame_from(axis, fwd, relm)
            t_str = grip - end @ (hand_rest.inverted() @ palm_off)
            target = target.lerp(t_str, k)
        skel.solve_two_bone(pose, M, up, fo, hnd, target, pole, False, None, ht.weight)
        M2 = skel.fk(pose)
        Ph = (M2[skel.parent[hnd]] @ skel.local[hnd]).to_3x3()
        cur = M2[hnd].to_3x3()
        if end is not None:
            q = cur.to_quaternion().slerp(end.to_quaternion(), k)
            cur = q.to_matrix()
        if ht.fdir is not None:
            fan_local = skel.rest[hnd].to_3x3().inverted() @ V(tuple(FAN_AXIS))
            have = (cur @ fan_local).normalized()
            cur = have.rotation_difference(V(ht.fdir).normalized()).to_matrix() @ cur
        if ht.hdir is not None:
            have = cur.col[1].normalized()
            cur = have.rotation_difference(V(ht.hdir).normalized()).to_matrix() @ cur
        pose[hnd] = skel.euler_of(Ph.inverted() @ cur, pose.get(hnd))

    solve_hand._lisvel = True
    anim._solve_hand = solve_hand

    # the shared foot solver turns FootTarget.pitch the wrong way on this rig family (the peers' fix): every pitch is
    # flipped and its offset moved so the foot still turns about the pivot the author meant
    orig_foot = anim._solve_foot

    def solve_foot(skel, pose, M, side, ft):
        pt = ft.pitch
        if abs(pt) > 1e-6:
            rest_f = skel.rest[f"foot.{side}"]
            ankle0 = rest_f.translation.copy()
            ball0 = skel.rest[f"toe.{side}"].translation.copy()
            heel0 = ankle0 + V((0, 0, -ankle0.z)) + (ankle0 - ball0) * V((1, 1, 0)) * 0.55
            lat = rest_f.to_3x3().col[0].normalized()
            pn = -pt
            rot = Matrix.Rotation(math.radians(ft.yaw), 3, "Z") @ Matrix.Rotation(math.radians(-pn), 3, lat)
            want_pv, got_pv = (heel0 if pt > 0 else ball0), (heel0 if pn > 0 else ball0)
            d = (want_pv - got_pv) - rot @ (want_pv - got_pv)
            near = max(0.0, min(1.0, 1.0 - ft.ankle[2] / 0.06))
            toe = ft.toe + (abs(pt) * near if pt < 0 else -pt)
            ft = FT(tuple(ft.ankle[i] + d[i] for i in range(3)), pn, ft.yaw, toe, ft.knee, ft.weight)
        orig_foot(skel, pose, M, side, ft)

    solve_foot._lisvel = True
    anim._solve_foot = solve_foot


_install_solvers()


def _ch(pose, key):
    return float((pose.get(key) or (0.0,))[0])


def _slide(pose):
    return _ch(pose, "_slide")


def _prop_l(M, pose):
    """prop.L's posed matrix with the bow's slide along its chord (pose location (0, 0, HAND_U * slide))"""
    return M["prop.L"] @ Matrix.Translation((0.0, 0.0, HAND_U * _slide(pose)))


def _string_loc(skel, pose):
    """x_string's pose location (its rest frame under the posed prop.L): the nock moved to the right hand's pinch,
    scaled by the pose's "_str" weight"""
    w = _ch(pose, "_str")
    if w <= 1e-4:
        return V((0.0, 0.0, 0.0))
    M = skel.fk(pose)
    target = M["prop.R"].translation
    Mb = _prop_l(M, pose) @ skel.local["x_string"]
    return (Mb.inverted() @ target) * min(1.0, w)


def _fan_scale(pose):
    return max(0.001, min(1.0, _ch(pose, "_fan")))


# the death's dropped bow: lying flat on the ground at her left front, the riser's width under it
DROP_GRIP = np.array([0.36, -0.50, 0.033])
DROP_D = _n(np.array([0.30, -0.95, 0.0]))
DROP_U = _n(np.array([0.95, 0.30, 0.0]))


def _drop_local(skel, pose):
    """prop.L's pose (location, euler deg) moving the bow from the fist to the ground by the pose's "_drop", or None"""
    w = min(1.0, _ch(pose, "_drop"))
    if w <= 1e-4:
        return None
    p0 = dict(pose)
    p0.pop("prop.L", None)
    M = skel.fk(p0)
    Mc = M["prop.L"]
    Rd = Matrix((tuple(np.cross(DROP_D, DROP_U)), tuple(DROP_D), tuple(DROP_U))).transposed()
    q = Mc.to_quaternion().slerp(Rd.to_quaternion(), w)
    t = Mc.translation.lerp(V(tuple(DROP_GRIP)), w) + V((0.0, 0.0, 0.10 * math.sin(math.pi * w)))
    Mt = Matrix.Translation(t) @ q.to_matrix().to_4x4()
    X = (M["hand.L"] @ skel.local["prop.L"]).inverted() @ Mt
    return X.translation.copy(), tuple(math.degrees(a) for a in X.to_3x3().to_euler("XYZ"))


def _install_keys() -> None:
    if getattr(anim.write_action, "_lisvel", False):
        return
    orig_write = anim.write_action

    def write_action(arm, name, poses, bones=None):
        if "x_string" not in arm.pose.bones:
            return orig_write(arm, name, poses, bones)
        skel = anim.Skeleton(arm)
        n = len(poses)
        plocs = []
        poses = [dict(p) for p in poses]
        for p in poses:
            dl = _drop_local(skel, p)
            if dl is None:
                plocs.append(V((0.0, 0.0, HAND_U * _slide(p))))
            else:
                plocs.append(dl[0])
                p["prop.L"] = dl[1]
        act = orig_write(arm, name, poses, bones)
        cb = None
        for layer in act.layers:
            for strip in layer.strips:
                cb = strip.channelbag(act.slots[0], ensure=True)
        locs = [_string_loc(skel, p) for p in poses]
        fans = [_fan_scale(p) for p in poses]
        for i in range(3):
            fc = anim._new_fcurve(cb, 'pose.bones["prop.L"].location', i, "prop.L")
            fc.keyframe_points.add(n)
            fc.keyframe_points.foreach_set("co", [c for f, pl in zip(range(n), plocs) for c in (f, pl[i])])
            fc.keyframe_points.foreach_set("interpolation", [1] * n)
            fc.update()
            fc = anim._new_fcurve(cb, 'pose.bones["x_string"].location', i, "x_string")
            fc.keyframe_points.add(n)
            fc.keyframe_points.foreach_set("co", [c for f, l in zip(range(n), locs) for c in (f, l[i])])
            fc.keyframe_points.foreach_set("interpolation", [1] * n)
            fc.update()
            fc = anim._new_fcurve(cb, 'pose.bones["x_fan"].scale', i, "x_fan")
            fc.keyframe_points.add(n)
            fc.keyframe_points.foreach_set("co", [c for f, s in zip(range(n), fans) for c in (f, s)])
            fc.keyframe_points.foreach_set("interpolation", [1] * n)
            fc.update()
        return act

    write_action._lisvel = True
    anim.write_action = write_action

    orig_apply = anim.apply_pose

    def apply_pose(arm, pose):
        orig_apply(arm, pose)
        if "x_string" not in arm.pose.bones:
            return
        skel = anim.Skeleton(arm)
        res = anim.resolve(skel, pose)
        dl = _drop_local(skel, res)
        if dl is None:
            arm.pose.bones["prop.L"].location = (0.0, 0.0, HAND_U * _slide(res))
        else:
            arm.pose.bones["prop.L"].location = tuple(dl[0])
            arm.pose.bones["prop.L"].rotation_euler = [math.radians(a) for a in dl[1]]
            res = dict(res)
            res["prop.L"] = dl[1]
        arm.pose.bones["x_string"].location = _string_loc(skel, res)
        s = _fan_scale(res)
        arm.pose.bones["x_fan"].scale = (s, s, s)
        bpy.context.view_layer.update()

    apply_pose._lisvel = True
    anim.apply_pose = apply_pose


_install_keys()


def bowl(rel=REST_L, aim=tuple(D_REST), up=tuple(U_REST), pole=POLE_L, yaw=0.0, lift=0.0, shift=0.0) -> dict:
    """the bow hand: wrist target (chest frame, arm lengths), the bow's shot axis and upper limb (character space,
    turned with the body by `yaw`), `lift` raises the wrist, `shift` moves it toward her left (arm lengths)"""
    rel = (rel[0] + shift, rel[1], rel[2] + lift)
    return {"hand.L": BH(rel=tuple(rel), pole=tuple(pole), kb=0.0),
            "aim.L": AimRoll(tuple(_rz(_n(aim), yaw)), 1.0, tuple(_rz(_n(up), yaw)))}


def rh(along=-BRACE, uoff=PINCH_U, k=1.0, rel=REST_R, pole=POLE_R, fdir=None, hdir=None) -> dict:
    return {"hand.R": RH(rel=tuple(rel), pole=tuple(pole), along=along, uoff=uoff, k=k, fdir=fdir, hdir=hdir)}


def feet_(l=(0.0, 0.0, 0.0), r=(0.0, 0.0, 0.0), yl=2.0, yr=-8.0, pl=0.0, pr=0.0, kl=0.0, kr=0.0) -> dict:
    return anim.feet(l=l, r=r, yl=yl, yr=yr, pl=pl, pr=pr, kl=kl, kr=kr)


FEET0 = feet_(l=(0.012, -0.03, 0.0), r=(-0.012, 0.04, 0.0))
FEET_READY = feet_(l=(0.030, -0.075, 0.0), r=(-0.030, 0.085, 0.0), yl=-18.0, yr=-50.0)


def pz(lean=2.0, yaw=0.0, roll=0.0, drop=0.02, dx=0.0, dy=0.0, look=(0.0, 0.0, 0.0), feet=None, L=None, R=None,
       string=0.0, fan=0.0, slide=0.0, drop_bow=0.0, extra=None, keep_head=0.9, lift=0.0, shift=0.0) -> dict:
    """a body pose: lean / yaw / roll spread over hips, spine and chest, the head held toward the front (keep_head of
    the yaw countered; look = extra head pitch / yaw / roll), hips dropped by `drop`, feet planted by IK; the bow
    hand by default in the carry, turned with the body"""
    p = anim.merge(anim.arms_relaxed(), anim.P(
        hips=(lean * 0.40, yaw * 0.30, roll * 0.5), spine=(lean * 0.30, yaw * 0.30, -roll * 0.3),
        chest=(lean * 0.30, yaw * 0.40, -roll * 0.2),
        neck=(-lean * 0.45 + look[0] * 0.4, -yaw * keep_head * 0.45 + look[1] * 0.4, look[2] * 0.4),
        head=(-lean * 0.45 + look[0] * 0.6, -yaw * keep_head * 0.55 + look[1] * 0.6, look[2] * 0.6)))
    p["hips_loc"] = (dx, dy, -drop)
    ik = dict(feet if feet is not None else FEET0)
    ik.update(L if L is not None else bowl(yaw=yaw, lift=lift, shift=shift))
    ik.update(R if R is not None else rh())
    p["ik"] = ik
    p["_str"] = (float(string), 0.0, 0.0)
    p["_fan"] = (float(fan), 0.0, 0.0)
    p["_slide"] = (float(slide), 0.0, 0.0)
    p["_drop"] = (float(drop_bow), 0.0, 0.0)
    if extra:
        p = anim.add(p, extra)
    return p


def G(**kw) -> dict:
    """the guard: the archer's ready stance, the concept's carry across her turned chest, the weight even"""
    kw.setdefault("lean", 2.0)
    kw.setdefault("yaw", READY_YAW)
    kw.setdefault("feet", FEET_READY)
    kw.setdefault("lift", IDLE_LIFT)
    kw.setdefault("shift", IDLE_SHIFT)
    return pz(**kw)


def shot_arms(draw, elev=0.0, cant=40.0, yaw=-70.0, lean=0.0, side=0.0, k=1.0, uoff=0.0, rel_r=REST_R, full=0.34,
              a_side=0.09, a_up=0.01, a_fwd=0.04, kb=1.0, pole_l=(0.75, 0.25, -0.6), pole_r=(-0.85, 0.45, 0.15)):
    """the bow arm toward the target (elevation `elev` deg, `side` deg toward her left), the bow canted `cant` deg
    (its upper limb toward her right; 90 = flat), its grip placed so the arrow line runs through the anchor beside the
    right jaw (a_side / a_up / a_fwd) at full draw `full`; the string drawn `draw` m past brace"""
    e, s_ = math.radians(elev), math.radians(side)
    d = np.array([math.sin(s_) * math.cos(e), -math.cos(s_) * math.cos(e), math.sin(e)])
    c = math.radians(cant)
    up = _rz(np.array([-math.sin(c), 0.0, math.cos(c)]), side)
    up = _n(up - d * (up @ d))
    rel = chest_rel(d * 0.90 + np.array([0.0, 0.0, 0.30]), yaw, lean)
    out = {"hand.L": BH(rel=rel, pole=tuple(pole_l), kb=kb, d=tuple(d), up=tuple(up), side=a_side, upo=a_up,
                        fwd=a_fwd, full=full),
           "aim.L": AimRoll(tuple(d), 1.0, tuple(up))}
    out.update(rh(along=-(BRACE + draw), uoff=uoff, k=k, rel=rel_r, pole=pole_r))
    return out


def _shoot(p, *a, slide=1.0, **kw):
    """pose `p` takes a shot's arms (shot_arms) and the bow slides its grip into the fist"""
    p["ik"].update(shot_arms(*a, **kw))
    p["_slide"] = (float(slide), 0.0, 0.0)
    return p


def clip(name, N, keys, loop=False, impact=None, lags=None) -> anim.Clip:
    fn = anim.keyed(keys)
    if lags:
        fn = anim.drag(fn, N, lags, loop=loop)
    return anim.Clip(name, N, loop, fn, impact=impact)


BLOCKS: dict = {}
MOTION = anim.motion_profile(weight="light", weapon="bow", stance="neutral", run_ref_speed=3.35, cadence=0.95,
                             arm_swing=0.85)
RUN_LEAN = anim.P(hips=(2.0, 0, 0), spine=(1.5, 0, 0), chest=(0.5, 0, 0), neck=(-1.5, 0, 0), head=(-2.5, 0, 0))
# the run's carry (review item 8): the bow along her left hip pointing forward, its plane near horizontal (the
# string outside, the limbs curving in toward her: clear of the legs), the front tip a little low: a long horizontal
# in the lane facings; the right arm pumping free
RUN_U = _n(np.array([0.10, -0.99, -0.07]))
RUN_D = _n(np.array([-1.0, 0.0, -0.30]) - RUN_U * (RUN_U @ np.array([-1.0, 0.0, -0.30])))
RUN_REL = (0.30, -0.14, -0.86)
RUN_R_FWD = (-0.10, -0.55, -0.62)
RUN_R_BACK = (-0.14, 0.34, -0.82)


def gen_run() -> anim.Clip:
    c = anim.gen_run(MOTION)
    base = c.sample
    N = c.frames

    def sample(t):
        p = anim.add(base(t), RUN_LEAN)
        q = t % 1.0
        sw = MOTION["arm_swing"] * math.cos(2 * math.pi * (q - 0.03))
        tR = 0.5 - 0.5 * sw
        rr = tuple(RUN_R_FWD[i] + (RUN_R_BACK[i] - RUN_R_FWD[i]) * tR for i in range(3))
        ik = dict(p["ik"])
        for k_ in ("hand.L", "hand.R", "aim.L", "aim.R"):
            ik.pop(k_, None)
        bob = 0.015 * math.cos(4 * math.pi * q)
        swl = 0.04 * math.cos(2 * math.pi * (q - 0.03))
        ik.update(bowl(rel=(RUN_REL[0], RUN_REL[1] + swl, RUN_REL[2] + bob), aim=tuple(RUN_D), up=tuple(RUN_U),
                       pole=(0.8, 0.4, -0.3)))
        ik.update(rh(k=0.0, rel=rr, pole=(-0.8, 0.4, -0.3)))
        p = dict(p)
        p["ik"] = ik
        p["_str"] = (0.0, 0.0, 0.0)
        p["_fan"] = (0.0, 0.0, 0.0)
        p["_slide"] = (1.0, 0.0, 0.0)
        p["_drop"] = (0.0, 0.0, 0.0)
        return p
    return anim.Clip("run", N, True, sample, meta=c.meta)


def run_pose(q: float) -> dict:
    return gen_run().sample(q % 1.0)


def gen_idle() -> anim.Clip:
    """the ready stance breathing; the head turns slowly toward something far away and back"""
    base = G()
    N = 90

    def sample(t):
        b = anim.osc(t, 3)
        s = anim.osc(t, 1, 0.1)
        h = anim.osc(t, 1, 0.3)
        d = anim.P(chest=(1.0 * b, 0, 0), spine=(0.4 * b, 0, 0.5 * s), neck=(-0.6 * b, 3.0 * h, 0),
                   head=(-0.4 * b, 7.0 * h, 1.5 * h), shoulder_L=(0, 0, 1.0 * b), shoulder_R=(0, 0, -1.0 * b),
                   hips=(0, 1.0 * s, -0.8 * s))
        p = anim.add(base, d)
        dz = 0.008 * anim.osc(t, 3, 0.08)
        p = dict(p)
        p["ik"] = dict(p["ik"])
        hl = p["ik"]["hand.L"]
        p["ik"]["hand.L"] = dataclasses.replace(hl, rel=(hl.rel[0], hl.rel[1], hl.rel[2] + dz))
        return anim._with_hips(p, (0.008 * s, 0.0, -0.004 * (0.5 + 0.5 * b)))

    return anim.Clip("idle", N, True, sample)


FEET_SHOT = feet_(l=(0.04, -0.10, 0.0), r=(-0.04, 0.11, 0.0), yl=-24.0, yr=-58.0)
FEET_STEPB = feet_(l=(0.04, -0.04, 0.0), r=(-0.07, 0.26, 0.0), yl=-20.0, yr=-60.0)
FEET_LUNGE = feet_(l=(0.06, -0.26, 0.0), r=(-0.04, 0.13, 0.0), yl=-26.0, yr=-62.0, pr=-10.0)


def _shot_clip(name, N, wind, draw, hit, fol, g=None, extra_keys=None, lags=None):
    """a bow shot on the VALE timing: guard -> lift (0.10) -> wind (0.24) -> full draw (0.33) -> anchor hold (0.37) ->
    RELEASE at 0.40 (the string snaps back on the impact frame, the drawing hand slides back along the line) ->
    follow-through (0.56) -> recover (0.78) -> guard"""
    g = g or G()
    rec = anim.lerp_pose(fol, g, 0.5)
    keys = [(0.0, g, "linear"), (0.10, wind, "inout"), (0.26, draw, "inout"),
            (0.36, anim._with_hips(anim.lerp_pose(draw, hit, 0.08), (0, 0, -0.004)), "out"),
            (anim.IMPACT, hit, "accel"), (0.56, fol, "out"), (0.78, rec, "inout"), (1.0, g, "settle")]
    if extra_keys:
        keys = sorted(keys + extra_keys, key=lambda k_: k_[0])
    return clip(name, N, keys, impact=anim.IMPACT, lags=lags or {"head": 1.0, "neck": 0.5})


def gen_attack1() -> anim.Clip:
    """a quick draw and release from the ready stance: the bow swings up from the level carry to near upright (canted
    24 degrees: the classic D in profile in the lane facings), the right hand draws to the anchor beside the jaw; the
    arrow leaves at f8"""
    wind = pz(lean=2.0, yaw=-62.0, drop=0.03, feet=FEET_SHOT, string=1.0)
    _shoot(wind, 0.10, elev=-8, cant=48, yaw=-62, kb=0.85)
    draw = pz(lean=0.0, yaw=-76.0, drop=0.04, feet=FEET_SHOT, string=1.0, look=(0.0, 4.0, 0.0))
    _shoot(draw, 0.34, elev=2, cant=24, yaw=-76)
    hit = pz(lean=1.0, yaw=-77.0, drop=0.05, feet=FEET_SHOT, string=0.0, look=(0.0, 4.0, 0.0))
    _shoot(hit, 0.42, elev=3, cant=25, yaw=-77)
    fol = pz(lean=2.0, yaw=-72.0, drop=0.045, feet=FEET_SHOT, string=0.0, look=(0.0, 3.0, 0.0))
    _shoot(fol, 0.46, elev=1, cant=27, yaw=-72, k=0.7, rel_r=(-0.32, 0.24, 0.12))
    return _shot_clip("attack1", 20, wind, draw, hit, fol)


def gen_attack2() -> anim.Clip:
    """a snap shot with a half-step back: the right foot steps back and the hips sink as the bow comes up FLAT (a
    level bar at the shoulder), drawn short to the anchor under the jaw; the release at f8 low and level"""
    wind = pz(lean=-2.0, yaw=-58.0, drop=0.05, feet=FEET_STEPB, string=1.0, dy=0.05)
    _shoot(wind, 0.08, elev=-6, cant=86, yaw=-58, kb=0.85, a_up=-0.07, a_fwd=0.12, full=0.27)
    draw = pz(lean=-4.0, yaw=-70.0, drop=0.08, feet=FEET_STEPB, string=1.0, dy=0.08, look=(0.0, 4.0, 0.0))
    _shoot(draw, 0.27, elev=-1, cant=84, yaw=-70, a_up=-0.07, a_fwd=0.12, full=0.27)
    hit = pz(lean=-5.0, yaw=-71.0, drop=0.085, feet=FEET_STEPB, string=0.0, dy=0.09, look=(0.0, 4.0, 0.0))
    _shoot(hit, 0.34, elev=0, cant=85, yaw=-71, a_up=-0.07, a_fwd=0.12, full=0.27)
    fol = pz(lean=-3.0, yaw=-66.0, drop=0.075, feet=FEET_STEPB, string=0.0, dy=0.08)
    _shoot(fol, 0.38, elev=-2, cant=86, yaw=-66, k=0.7, rel_r=(-0.34, 0.20, -0.02), a_up=-0.07, a_fwd=0.12, full=0.27)
    return _shot_clip("attack2", 20, wind, draw, hit, fol)


def gen_dawn_line() -> anim.Clip:
    """cast_a1 Dawn Line, 25 f, the arrow leaves at f10: the level bar of the guard swings up into a long steep
    diagonal (cant 42), a long lunge with the left foot, the right hand drawing past the jaw to the ear (the string
    stretched long); at f10 the release with a recoil (the bow kicks up, the body rocks back), the drawing hand opens
    behind the shoulder; recovers by f25"""
    level = pz(lean=3.0, yaw=-58.0, drop=0.04, feet=FEET_READY, string=0.4, lift=IDLE_LIFT + 0.10)
    level["ik"].update(bowl(yaw=-58.0, lift=IDLE_LIFT + 0.12))
    wind = pz(lean=3.0, yaw=-66.0, drop=0.06, feet=FEET_LUNGE, string=1.0)
    _shoot(wind, 0.10, elev=-4, cant=78, yaw=-66, kb=0.8, a_up=0.03, a_fwd=-0.02, full=0.38)
    draw = pz(lean=-4.0, yaw=-80.0, drop=0.10, feet=FEET_LUNGE, string=1.0, dy=-0.03, look=(0.0, 6.0, 0.0))
    _shoot(draw, 0.38, elev=5, cant=42, yaw=-80, a_up=0.03, a_fwd=-0.02, full=0.38)
    hit = pz(lean=-8.0, yaw=-81.0, drop=0.105, feet=FEET_LUNGE, string=0.0, dy=-0.01, look=(-2.0, 6.0, 0.0))
    _shoot(hit, 0.47, elev=11, cant=42, yaw=-81, a_up=0.03, a_fwd=-0.02, full=0.38)
    fol = pz(lean=-3.0, yaw=-76.0, drop=0.095, feet=FEET_LUNGE, string=0.0, dy=-0.02, look=(0.0, 5.0, 0.0))
    _shoot(fol, 0.50, elev=4, cant=44, yaw=-76, k=0.55, rel_r=(-0.36, 0.28, 0.18), a_up=0.03, a_fwd=-0.02, full=0.38)
    return _shot_clip("cast_a1", 25, wind, draw, hit, fol, extra_keys=[(0.05, level, "out")],
                      lags={"head": 1.0, "neck": 0.5})


def _hop(lift, tuck, lean=6.0, draw=0.10):
    """the Backstep's airborne pose: hips up `lift`, both knees drawn up by `tuck` (m), the bow level and a little
    high across the body, the drawing hand nocking an arrow on the string"""
    p = pz(lean=lean, yaw=-30.0, drop=-lift, dy=0.02, look=(-6.0, 0.0, 0.0),
           feet=feet_(l=(0.02, -0.04, tuck), r=(-0.02, 0.06, tuck * 0.9), pl=-25.0, pr=-30.0), string=1.0)
    p["ik"].update(bowl(rel=(REST_L[0] - 0.02, REST_L[1] - 0.10, REST_L[2] + 0.18), yaw=-30.0))
    p["ik"].update(rh(along=-(BRACE + draw), uoff=-0.03))
    return p


def gen_backstep() -> anim.Clip:
    """cast_a2 Backstep, 15 f, apex f6 (castTime 0.1: a 2-frame dip): a sprung crouch, both feet leave the ground,
    the knees drawn up, the bow held level, the free hand nocking an arrow in the air; she lands in the ready stance.
    The `dash` clip is the airborne hold of the same pose (no second take-off)."""
    g = G()
    dip = pz(lean=10.0, yaw=-40.0, drop=0.11, dy=0.01, feet=FEET_READY, lift=IDLE_LIFT)
    push = pz(lean=8.0, yaw=-34.0, drop=-0.06, feet=feet_(l=(0.03, -0.06, 0.06), r=(-0.03, 0.07, 0.06), pl=-35.0, pr=-35.0),
              string=0.6, lift=IDLE_LIFT)
    apex = _hop(0.26, 0.30)
    fall = _hop(0.14, 0.16, lean=4.0, draw=0.06)
    land = pz(lean=12.0, yaw=-44.0, drop=0.12, dy=0.0, feet=FEET_READY, string=0.0, lift=IDLE_LIFT)
    keys = [(0.0, g, "linear"), (0.12, dip, "inout"), (0.24, push, "out"), (anim.IMPACT, apex, "out"),
            (0.60, fall, "in"), (0.70, land, "in"), (0.84, anim._with_hips(anim.lerp_pose(land, g, 0.6), (0, 0, 0.004)), "out"),
            (1.0, g, "settle")]
    return clip("cast_a2", 15, keys, impact=anim.IMPACT, lags={"head": 1.0})


def gen_dash() -> anim.Clip:
    """the Backstep's flight (cast_a2's follow-through): the apex tuck held, a small float (loops)"""
    N = 10

    def sample(t):
        b = 0.5 + 0.5 * math.cos(2 * math.pi * t)
        return anim.lerp_pose(_hop(0.24, 0.28), _hop(0.27, 0.31), b)

    return anim.Clip("dash", N, True, sample)


Q_REACH = chest_rel((Q_TOP + np.array([-0.01, 0.0, 0.10]) - SH_R) / L_ARM)


def gen_morning_draw() -> anim.Clip:
    """cast_a3 Morning Draw, 20 f, the fan at f8 (castTime 0: two frames of anticipation): the right hand leaves the
    string, sweeps back to the quiver at her right hip and pulls three arrows, fanning them wide between the fingers
    above the shoulder as her chest lifts with a breath (f8); they snap back into the quiver and the hand returns to
    the string"""
    g = G()
    reach = pz(lean=4.0, yaw=-30.0, drop=0.03, look=(4.0, -16.0, 0.0), feet=FEET_READY, lift=IDLE_LIFT,
               R=rh(k=0.0, rel=Q_REACH, pole=(-0.6, 0.8, 0.0)))
    pull = pz(lean=0.0, yaw=-34.0, drop=0.02, look=(0.0, -20.0, 0.0), fan=1.0, feet=FEET_READY, lift=IDLE_LIFT,
              R=rh(k=0.0, rel=(-0.30, 0.06, -0.10), pole=(-0.7, 0.6, -0.3), fdir=(-0.2, 0.3, 0.93)))
    fan = pz(lean=-7.0, yaw=-40.0, drop=0.0, look=(-8.0, -24.0, -4.0), fan=1.0, feet=FEET_READY, lift=IDLE_LIFT,
             R=rh(k=0.0, rel=(-0.40, -0.10, 0.30), pole=(-0.8, 0.3, -0.5), fdir=(-0.45, -0.20, 0.87)),
             extra=anim.P(chest=(-3.0, 0, 0), shoulder_R=(0, 0, 8.0)))
    hold = pz(lean=-6.0, yaw=-39.0, drop=0.0, look=(-7.0, -22.0, -4.0), fan=1.0, feet=FEET_READY, lift=IDLE_LIFT,
              R=rh(k=0.0, rel=(-0.41, -0.11, 0.32), pole=(-0.8, 0.3, -0.5), fdir=(-0.47, -0.18, 0.86)),
              extra=anim.P(chest=(-3.0, 0, 0), shoulder_R=(0, 0, 8.0)))
    back = pz(lean=3.0, yaw=-30.0, drop=0.03, look=(2.0, -12.0, 0.0), fan=0.0, feet=FEET_READY, lift=IDLE_LIFT,
              R=rh(k=0.0, rel=Q_REACH, pole=(-0.6, 0.8, 0.0), fdir=(0.0, 0.0, 1.0)))
    ret = G()
    ret["ik"].update(rh(k=0.55, rel=(-0.18, -0.15, -0.45)))
    keys = [(0.0, g, "linear"), (0.10, anim.lerp_pose(g, reach, 0.35), "in"), (0.22, reach, "out"),
            (0.30, pull, "inout"), (anim.IMPACT, fan, "out"), (0.52, hold, "inout"), (0.64, back, "in"),
            (0.82, ret, "out"), (1.0, g, "settle")]
    return clip("cast_a3", 20, keys, impact=anim.IMPACT, lags={"head": 1.0})


def gen_sun_corridor() -> anim.Clip:
    """cast_ult Sun Corridor, 35 f, the great arrow leaves at f14: she raises the bow high and draws toward the sky
    (a wide diagonal; f4-f10, the pose breathes and the string trembles), then swings it down to the aim line, the bow
    turned flat (a long horizontal bar drawn to the collar, below the face), and looses at f14, rocking back; the
    follow-through holds the bow level along the cast line to f26, then lowers"""
    g = G()
    dip = pz(lean=8.0, yaw=-56.0, drop=0.07, string=0.0, feet=FEET_READY, lift=IDLE_LIFT - 0.05)
    sky = pz(lean=-14.0, yaw=-60.0, drop=0.05, string=1.0, look=(-24.0, 4.0, 0.0), feet=FEET_SHOT)
    _shoot(sky, 0.30, elev=58, cant=38, yaw=-60, lean=-14, a_side=0.11, a_up=0.02, a_fwd=0.02, full=0.30)
    sky2 = pz(lean=-15.0, yaw=-61.0, drop=0.055, string=1.0, look=(-26.0, 4.0, 0.0), feet=FEET_SHOT)
    _shoot(sky2, 0.32, elev=59, cant=40, yaw=-61, lean=-15, a_side=0.11, a_up=0.02, a_fwd=0.02, full=0.30)
    sky3 = pz(lean=-14.0, yaw=-60.0, drop=0.05, string=1.0, look=(-24.0, 4.0, 0.0), feet=FEET_SHOT)
    _shoot(sky3, 0.30, elev=58, cant=38, yaw=-60, lean=-14, a_side=0.11, a_up=0.02, a_fwd=0.02, full=0.30)
    aim = pz(lean=-2.0, yaw=-48.0, drop=0.08, string=1.0, look=(2.0, 4.0, 0.0), feet=FEET_LUNGE)
    _shoot(aim, 0.30, elev=1, cant=88, yaw=-48, a_side=0.11, a_up=-0.12, a_fwd=0.16, full=0.30)
    hit = pz(lean=-9.0, yaw=-48.0, drop=0.08, dy=0.05, string=0.0, look=(0.0, 4.0, 0.0), feet=FEET_LUNGE)
    _shoot(hit, 0.38, elev=4, cant=88, yaw=-48, a_side=0.11, a_up=-0.12, a_fwd=0.16, full=0.30)
    fol = pz(lean=-5.0, yaw=-46.0, drop=0.08, dy=0.03, string=0.0, look=(0.0, 3.0, 0.0), feet=FEET_LUNGE)
    _shoot(fol, 0.40, elev=1, cant=88, yaw=-46, k=0.7, rel_r=(-0.34, 0.24, 0.08), a_side=0.11, a_up=-0.12,
           a_fwd=0.16, full=0.30)
    fol2 = anim._with_hips(anim.lerp_pose(fol, hit, 0.1), (0, 0, -0.003))
    keys = [(0.0, g, "linear"), (0.10, dip, "inout"), (0.26, sky, "out"), (0.30, sky2, "inout"), (0.33, sky3, "inout"),
            (0.375, aim, "inout"), (anim.IMPACT, hit, "accel"), (0.52, fol, "out"), (0.74, fol2, "inout"),
            (0.90, anim.lerp_pose(fol2, g, 0.6), "inout"), (1.0, g, "settle")]
    return clip("cast_ult", 35, keys, impact=anim.IMPACT, lags={"head": 1.0, "neck": 0.5})


def gen_death(skel) -> anim.Clip:
    """struck, she rocks back, the bow sags out of the carry and drops from her hand (it falls flat on the ground at
    her left front: review item 11), her knees go and she drops to them, then topples onto her right side (at rest)"""
    g = G()
    hip_h = skel.rest_point("hips").z
    recoil = pz(lean=-14.0, yaw=-20.0, drop=0.04, dy=0.05, look=(-16.0, 0.0, 0.0), string=0.0, feet=FEET_READY)
    recoil["ik"].update(bowl(rel=(REST_L[0] + 0.05, REST_L[1] + 0.05, REST_L[2] - 0.05), aim=(0.2, -0.3, -0.93),
                             up=(0.9, 0.1, 0.4), yaw=-20.0))
    recoil["ik"].update(rh(k=0.0, rel=(-0.20, 0.0, -0.80)))
    kneel = pz(lean=18.0, yaw=6.0, drop=0.44, dy=0.08, look=(14.0, 0.0, 0.0), string=0.0, drop_bow=0.0,
               feet=feet_(l=(0.02, 0.22, 0.04), r=(-0.02, 0.26, 0.04), pl=-62.0, pr=-62.0, yl=2.0, yr=-6.0))
    kneel["ik"].update(bowl(rel=(0.16, -0.20, -0.95), aim=(0.4, -0.2, -0.9), up=(0.85, 0.3, 0.4)))
    kneel["ik"].update(rh(k=0.0, rel=(-0.12, -0.20, -0.95)))
    kneel2 = dict(kneel)
    kneel2["_drop"] = (1.0, 0.0, 0.0)
    kneel2["ik"] = dict(kneel["ik"])
    kneel2["ik"]["hand.L"] = BH(rel=(0.22, -0.05, -0.95), pole=POLE_L, kb=0.0)
    down = anim.merge(anim.arms_relaxed(), anim.P(hips=(-10.0, 4.0, 78.0), spine=(8, 0, 6), chest=(6, 0, 4), neck=(4, 0, -10),
                                                  head=(2, 0, -14), thigh_L=(70, 0, -6), shin_L=(-95, 0, 0), foot_L=(30, 0, 0),
                                                  thigh_R=(62, 0, 4), shin_R=(-100, 0, 0), foot_R=(30, 0, 0),
                                                  upper_arm_L=(30, 0, 30), forearm_L=(20, 0, 0),
                                                  upper_arm_R=(40, 0, -10), forearm_R=(30, 0, 0)))
    down["hips_loc"] = (-0.32, 0.10, -hip_h + 0.17)
    down["ik"] = {}
    down["_str"] = (0.0, 0.0, 0.0)
    down["_fan"] = (0.0, 0.0, 0.0)
    down["_slide"] = (0.0, 0.0, 0.0)
    down["_drop"] = (1.0, 0.0, 0.0)
    bounce = anim._with_hips(anim.add(down, anim.P(spine=(-3, 0, 0), chest=(-3, 0, 0))), (0.0, 0.0, 0.03))
    rest = anim.add(down, anim.P(head=(4, 0, -2)))
    N = 45
    keys = [(0.0, g, "linear"), (0.10, recoil, "snap"), (0.30, kneel, "in"), (0.46, kneel2, "in"),
            (0.70, down, "in"), (0.78, bounce, "out"), (0.88, rest, "inout"), (1.0, rest, "linear")]
    return clip("death", N, keys)


def gen_recall() -> anim.Clip:
    """recall (loops): the bow lowered and turned upright before her like a harp, the string to her chest; the right
    hand plucks it slowly, up and down its length, the head tilted as she hums"""
    N = 90
    base = pz(lean=4.0, yaw=0.0, drop=0.03, look=(10.0, 0.0, 8.0), string=0.0)
    harp_l = bowl(rel=(-0.10, -0.62, -0.36), aim=(-1.0, -0.05, 0.0), up=(0.0, 0.0, 1.0), pole=(0.8, 0.4, -0.4))

    def sample(t):
        p = dict(base)
        p["ik"] = dict(base["ik"])
        p["ik"].update(harp_l)
        a = math.sin(2 * math.pi * 2 * t)
        pl = 0.5 + 0.5 * math.sin(2 * math.pi * 4 * t)
        p["ik"].update(rh(along=-(BRACE + 0.012 * pl), uoff=0.05 + 0.13 * a, k=1.0, pole=(-0.8, 0.2, -0.5)))
        b = anim.osc(t, 3)
        p = anim.add(p, anim.P(chest=(1.0 * b, 0, 0), head=(0, 3.0 * a, 1.5 * b)))
        p["_str"] = (0.35 * pl, 0.0, 0.0)
        return p

    return anim.Clip("recall", N, True, sample)


def gen_idle_lobby() -> anim.Clip:
    """open and unhurried: the bow lowered at her left side like a staff, the right hand conducting four slow counts
    of the dawn motif in big clear arcs at chest height, then a stop, the head tilted as if waiting for someone to
    supply the fifth; she turns and looks back over her left shoulder at the camera (a smile behind the visor), then
    counts again (120 f, closed loop)"""
    N = 120
    low = bowl(rel=(0.16, -0.16, -0.86), aim=(0.30, -0.95, 0.0), up=(0.10, 0.12, 0.99), pole=(0.8, 0.4, -0.3))
    rest_r = np.array((-0.16, -0.40, -0.48))
    g = pz(lean=1.0, yaw=-6.0, drop=0.02, L=low, R=rh(k=0.0, rel=tuple(rest_r)), keep_head=0.5)
    # the four beats: down, in across the chest, out to her right, up (a conductor's 4/4 at chest height)
    beats = [(-0.18, -0.52, -0.30), (0.02, -0.56, -0.18), (-0.40, -0.44, -0.14), (-0.20, -0.52, 0.10)]

    def seg(t, a, b):
        return min(1.0, max(0.0, (t - a) / (b - a)))

    def sample(t):
        p = dict(g)
        p["ik"] = dict(g["ik"])
        rel = rest_r.copy()
        head = np.zeros(3)
        chest = np.zeros(3)
        hips = np.zeros(3)
        hdir = None
        if t < 0.44:
            u = seg(t, 0.03, 0.42) * 4.0
            i = min(3, int(u))
            f = u - i
            a = np.array(beats[i - 1] if i > 0 else beats[3])
            b = np.array(beats[i])
            e = anim.ease_in_out(min(1.0, f * 1.5))
            rel = a + (b - a) * e + np.array((0.0, 0.0, 0.05 * math.sin(math.pi * min(1.0, f * 1.5))))
            env = math.sin(math.pi * 0.5 * min(1.0, seg(t, 0.0, 0.08))) * (1.0 - seg(t, 0.40, 0.46))
            rel = rest_r * (1 - env) + rel * env
            head = np.array((3.0 * math.sin(math.pi * u), -4.0, 4.0 * math.sin(math.pi * u * 0.5))) * env
            chest = np.array((0.0, -4.0 * env, 0.0))
            hdir = (0.15, -0.55, 0.82)
        # the stop: the hand held up, the head tilted, waiting for the fifth
        w = math.sin(math.pi * seg(t, 0.40, 0.60)) if 0.40 < t < 0.60 else 0.0
        if w > 0:
            rel = rel * (1 - w) + np.array((-0.18, -0.50, 0.06)) * w
            head = head * (1 - w) + np.array((-4.0, 6.0, 16.0)) * w
        # the look back over her left shoulder at the camera
        c = math.sin(math.pi * seg(t, 0.56, 0.90)) if 0.56 < t < 0.90 else 0.0
        if c > 0:
            head = head + np.array((-3.0, 44.0, -4.0)) * c
            chest = chest + np.array((0.0, 14.0, 0.0)) * c
            hips = hips + np.array((0.0, 6.0, 0.0)) * c
            rel = rel * (1 - 0.7 * c) + rest_r * 0.7 * c
        d = math.sin(math.pi * seg(t, 0.88, 1.0)) if t > 0.88 else 0.0
        if d > 0:
            rel = rel * (1 - 0.5 * d) + np.array(beats[3]) * 0.5 * d
        p["ik"].update(rh(k=0.0, rel=tuple(rel), pole=(-0.8, 0.3, -0.4), hdir=hdir))
        b = anim.osc(t, 4)
        p = anim.add(p, anim.P(chest=(0.8 * b + chest[0], chest[1], chest[2]), neck=tuple(head * 0.35),
                               head=tuple(head * 0.65), hips=tuple(hips)))
        return p

    return anim.Clip("idle_lobby", N, True, sample)


# the salute (review item 7): the hand's edge at the visor's right end, the elbow out to the side at shoulder height,
# the hand pointing in toward the glass (not a palm laid on the wrap)
SALUTE_TIP = np.array([-0.098, -0.110, VIS_Z + 0.004])
SALUTE_DIR = _n(np.array([0.80, -0.30, 0.52]))
HOLD_YAW = -14.0           # the hold a quarter turned from the splash camera (yaw 22: 36 degrees off it)
SALUTE = chest_rel((SALUTE_TIP - SALUTE_DIR * 0.105 - _rz(SH_R, HOLD_YAW)) / L_ARM, HOLD_YAW, 0.0)


def gen_victory() -> anim.Clip:
    """she looses an arrow along the ground (a quick draw aimed down-forward, released at f13) and steps onto the line
    of light; the hold: the bow level across her body, the right hand raised to the visor's end in a salute to the
    dawn, the weight on her back leg, a quarter turned from the camera (50 f, then the hold)"""
    g = G()
    draw = pz(lean=8.0, yaw=-64.0, drop=0.06, feet=FEET_SHOT, string=1.0, look=(12.0, 4.0, 0.0))
    _shoot(draw, 0.30, elev=-24, cant=60, yaw=-64, lean=8)
    hit = pz(lean=9.0, yaw=-64.0, drop=0.065, feet=FEET_SHOT, string=0.0, look=(12.0, 4.0, 0.0))
    _shoot(hit, 0.38, elev=-23, cant=60, yaw=-64, lean=9)
    step = pz(lean=3.0, yaw=-10.0, drop=0.05, dy=-0.06, string=0.0,
              feet=feet_(l=(0.02, -0.22, 0.06), r=(-0.012, 0.04, 0.0), yl=0.0, yr=-10.0, pl=10.0))
    hold_l = bowl(rel=(REST_L[0] - 0.02, REST_L[1] - 0.10, REST_L[2] + 0.14), yaw=HOLD_YAW)
    hold = pz(lean=-1.5, yaw=HOLD_YAW, roll=-5.0, drop=0.035, dx=-0.025, dy=-0.06, look=(-5.0, 6.0, 4.0), string=0.0,
              feet=feet_(l=(0.06, -0.16, 0.0), r=(-0.03, 0.08, 0.0), yl=-2.0, yr=-34.0, pl=8.0), L=hold_l,
              R=rh(k=0.0, rel=SALUTE, pole=(-0.95, 0.05, 0.05), hdir=tuple(SALUTE_DIR)), keep_head=1.0)
    keys = [(0.0, g, "linear"), (0.10, anim.lerp_pose(g, draw, 0.5), "inout"), (0.22, draw, "out"),
            (0.26, hit, "accel"), (0.40, step, "inout"), (0.62, hold, "out"), (1.0, hold, "linear")]
    base = anim.drag(anim.keyed(keys), 50, {"head": 2.0, "neck": 1.0})

    def sample(t):
        p = base(t)
        if t > 0.62:
            k = min(1.0, (t - 0.62) / 0.15)
            p = anim.add(p, anim.P(chest=(0.8 * k * anim.osc(t, 2), 0, 0)))
        return p

    return anim.Clip("victory", 50, False, sample)


def gen_taunt() -> anim.Clip:
    """taps the bow's lower tip on the ground twice, a clear glass note, and nods"""
    g = G()
    side_l = bowl(rel=(0.34, -0.10, -0.88), aim=(1.0, -0.15, 0.0), up=(0.0, 0.0, 1.0), pole=(0.7, 0.5, -0.4))
    up_ = pz(lean=4.0, yaw=8.0, roll=-6.0, drop=0.08, look=(10.0, 10.0, 0.0), L=side_l,
             R=rh(k=0.0, rel=(-0.10, -0.25, -0.80)))
    tap = pz(lean=6.0, yaw=8.0, roll=-8.0, drop=0.13, look=(14.0, 12.0, 0.0), L=side_l,
             R=rh(k=0.0, rel=(-0.10, -0.25, -0.80)))
    nod = anim.add(up_, anim.P(head=(12, 6, 0), neck=(4, 4, 0)))
    keys = [(0.0, g, "linear"), (0.22, up_, "inout"), (0.32, tap, "in"), (0.40, up_, "out"), (0.48, tap, "in"),
            (0.56, up_, "out"), (0.70, nod, "inout"), (0.80, up_, "inout"), (1.0, g, "inout")]
    return clip("taunt", 60, keys, lags={"head": 1.5})


def gen_stunned() -> anim.Clip:
    """stumbling (review item 11): the knees buckle and the hips sway wide, a shuffle step each way, the head lolling,
    the bow raised before her face"""
    N = 40
    bowr = bowl(rel=(0.02, -0.55, -0.06), aim=(0.1, -0.55, 0.83), up=(1.0, 0.0, 0.1))
    rr = rh(k=0.0, rel=(-0.14, -0.40, -0.36))

    def sample(t):
        a, b = anim.osc(t, 1), anim.osc(t, 1, 0.25)
        stepL = max(0.0, anim.osc(t, 1, 0.0))
        stepR = max(0.0, -anim.osc(t, 1, 0.0))
        feet = feet_(l=(0.03 + 0.03 * a, -0.04 + 0.04 * a, 0.035 * stepL), r=(-0.03 + 0.03 * a, 0.06 - 0.04 * a, 0.035 * stepR),
                     yl=4.0, yr=-10.0)
        p = pz(lean=12.0 + 3.0 * b, yaw=-10.0 + 8.0 * a, roll=7.0 * a, drop=0.10 + 0.025 * b, dx=0.05 * a, dy=0.02 * b,
               look=(14.0, 0.0, 0.0), feet=feet, L=bowr, R=rr)
        return anim.add(p, anim.P(neck=(8 * b, 0, 9 * a), head=(10 * b, 6 * a, 12 * a)))

    return anim.Clip("stunned", N, True, sample)


def gen_channel() -> anim.Clip:
    """a held half draw, the bow raised, breathing"""
    base = pz(lean=0.0, yaw=-70.0, drop=0.04, feet=FEET_SHOT, string=1.0, look=(0.0, 4.0, 0.0))
    _shoot(base, 0.20, elev=8, cant=62, yaw=-70)
    N = 40

    def sample(t):
        p = anim.add(base, anim.P(chest=(1.0 * anim.osc(t, 2), 0, 0), head=(-0.6 * anim.osc(t, 2), 0, 0)))
        return p

    return anim.Clip("channel", N, True, sample)


def clip_overrides(ctx) -> dict:
    skel = anim.Skeleton(ctx.info.armature)
    return {"idle": gen_idle(), "run": gen_run(), "attack1": gen_attack1(), "attack2": gen_attack2(),
            "cast_a1": gen_dawn_line(), "cast_a2": gen_backstep(), "cast_a3": gen_morning_draw(),
            "cast_ult": gen_sun_corridor(), "death": gen_death(skel), "recall": gen_recall(),
            "idle_lobby": gen_idle_lobby(), "victory": gen_victory(), "dash": gen_dash(), "stunned": gen_stunned(),
            "channel": gen_channel(), "taunt": gen_taunt()}


def model(ctx) -> list:
    P = []
    _SKIN["id"] = (ctx.skin or {}).get("id")
    extra = (ctx.skin or {}).get("extra") or {}
    items = sculpts() + skin_extras(extra)
    _PART_NAMES[:] = [it[0] for it in items]
    for name, S, vs, role, bind, tris, uvw in items:
        if name == "string":
            low = string_mesh(ctx.col)
            low.data.materials.append(ctx.mats[role])
            high = string_mesh(ctx.col)                 # its own bake source (the pipeline reads the part's role
            high.name = "string_high"                   # from the high after the low is joined into the body)
            high.data.materials.append(ctx.mats[role])
            P.append(fighter.Part(name, high=high, low=low, bind=bind, uv_weight=uvw))
            continue
        if extra.get("page_fletching") and name in ("fletching", "fan_fletch"):
            S = page_fletching(name)
        v, q = S.mesh(VOXEL * vs)
        ob = sdf.to_object(f"{name}_high", v, q, ctx.col)
        ob.data.materials.append(ctx.mats[role])
        P.append(fighter.Part(name, high=ob, tris=tris, bind=bind, uv_weight=uvw))
    return P


def string_mesh(col, sides=5, rings=26, r=0.0046):
    """the bow string as a thin tube built ring by ring (tip -> nock -> tip): a decimated capsule collapses into long
    triangles that span the nock and open into a sheet when the string is drawn"""
    import bmesh
    from common import mesh as _mesh
    bm = bmesh.new()
    pts = [STRING_A + (S0 - STRING_A) * (i / rings) for i in range(rings)] + \
          [S0 + (STRING_B - S0) * (i / rings) for i in range(rings + 1)]
    ax = _n(STRING_B - STRING_A)
    e1 = _n(np.cross(ax, D_REST))
    e2 = np.cross(ax, e1)
    ringv = []
    for c in pts:
        ringv.append([bm.verts.new(tuple(c + r * (math.cos(2 * math.pi * k / sides) * e1 + math.sin(2 * math.pi * k / sides) * e2)))
                      for k in range(sides)])
    for i in range(len(ringv) - 1):
        a, b = ringv[i], ringv[i + 1]
        for k in range(sides):
            bm.faces.new((a[k], a[(k + 1) % sides], b[(k + 1) % sides], b[k]))
    bm.faces.new(list(reversed(ringv[0])))
    bm.faces.new(ringv[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _mesh.bm_to_obj(bm, "string_low", col)


def page_fletching(name: str) -> Sculpt:
    """Almanac: rigid page-cut plates (flat 3 x 8 cm, 3 mm) in place of the gull-feather vanes"""
    S = Sculpt(name)
    if name == "fletching":
        for w, n, rise, lean, vt in ARROWS:
            d = _n(Q_U + Q_W * math.tan(math.radians(lean)))
            tip = Q_TOP + Q_W * w + Q_N * n + d * rise
            e1 = _n(np.cross(d, Q_N))
            for j in range(2):
                a = math.radians(vt + j * 90.0)
                vd = e1 * math.cos(a) + np.cross(d, e1) * math.sin(a)
                c = tip - d * 0.060
                S.add(RoundBox(c + vd * 0.004, (0.0015, 0.040, 0.016), 0.001, axes=np.stack([np.cross(d, vd), d, vd])), k=0.0)
    else:
        for ang in FAN_ANGLES:
            d = fan_dir(ang)
            base = PINCH_R - d * 0.05
            e1 = _n(np.cross(d, [0.0, 0.0, 1.0]))
            for j in range(2):
                a = math.radians(30.0 + j * 90.0)
                vd = e1 * math.cos(a) + np.cross(d, e1) * math.sin(a)
                S.add(RoundBox(base + d * 0.045, (0.0015, 0.040, 0.016), 0.001, axes=np.stack([np.cross(d, vd), d, vd])), k=0.0)
    return S


if __name__ == "__main__":
    fighter.main(sys.modules[__name__])
