"""ulkro: Dart hunter (Slinger, Hourless). ART 2.0: sculpted volumes painted by concept projection.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/ulkro_plates.py --height 1.85     # plates
    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/ulkro_fit.py
    python3 art/build.py fighter ulkro --no-skins --clip-sheet

Brief: _design/fighters/ulkro.md. Concept: _design/concept/ulkro.webp (front + back, hand-painted).
The forms are numpy SDF volumes (common/hifi/sdf.py) fitted to the concept on a 10 cm grid (crown of the hood's
peak 1.85 m = the plates' scale; the dart crest stands above it, ~2.0 m = art.height); the base colour is the
concept painting projected occlusion-aware onto the game mesh (common/hifi/project.py via PROJECTION), re-toned
part by part onto the concept's own material colours; normals and AO bake from the sculpt.

Where the concept and the brief disagree the concept's look wins (it is the approved painting): the ochre hood
with its long tail flying to her left, the linen face wrap under a carved wooden eye band, the two-tier pale stone
shoulder plates, the linen-wrapped quiver lying diagonally across the back (right shoulder -> left hip) with the
five pale-headed darts fanning up over the RIGHT shoulder, and the bone-white carved thrower with its dart held
low across the body (right fist on the thrower, left hand on the shaft, head to her left). The brief wins on what
is geometry: the dart heads are dawnglass leaves with an `accent` inlay (the six inlays are the only emissive),
the thrower carries the dart laid along it (prop.R), the quiver and darts are one rigid piece on the chest.
`long_run` has no visible change in the brief (the renderer plays the run faster): no form parts.

Not in the shared pipeline, implemented here (module-level wrappers; common/ untouched):
  * the arms' rest pose: rig.proportions is symmetric, the concept is not (right forearm forward on the thrower,
    left arm hanging to the shaft); rig_extras re-places both arms and points prop.R along the weapon;
  * analytic skin weights for the tunic skirt (hips -> thighs by height and side), the cowl and the quiver;
  * the paint pass (project.paint wrapper): side planes wrap the plate round the form (no streaks), legs, boots,
    thrower, darts, quiver bands and the eye band painted in the concept's manner from its own colours, every
    part re-toned onto the concept's material colour, the bible's light-head / dark-feet ramp;
  * a skin recolour that moves each part's measured painted median onto the skin colour.
"""
from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy  # noqa: E402,F401
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

from common import anim, fighter, materials, rig, scene  # noqa: E402
from common.anim import Aim, FootTarget, HandTarget  # noqa: E402,F401
from common.hifi import project as _project, sdf  # noqa: E402
from common.hifi.sdf import (Capsule, Ellipsoid, FlatCapsule, HalfSpace, RoundBox, RoundCone,  # noqa: E402
                             Sculpt, Sphere, Torus, Tube)

V = Vector
ID = "ulkro"
TITLE = "Dart hunter"
ROLE_MASS = "slinger"
ORIGIN = "hourless"
CARD = {"primary": "#6B6052", "secondary": "#A39C8C"}

# rig fitted to the sculpt: the head's crown under the hood 1.83 (hood peak 1.85), skull base 1.61, neck base
# 1.54, shoulder joints x 0.22 at 1.43, hips x 0.095 at 0.945, knees 0.515, ankles x 0.115 at 0.085.
# The arms are re-placed in rig_extras (the concept's carry).
PROPORTIONS = rig.proportions(height=1.83, head=0.26, neck=0.065, shoulder_width=0.44, hip_width=0.19, leg=0.86,
                              thigh_frac=0.50, arm=0.53, upper_arm_frac=0.51, hand=0.18, foot=0.27,
                              ankle_height=0.085, spine_curve=0.03, stance=0.02, toe_out_deg=6.0, knee_bend=0.02,
                              a_pose_deg=64.0, arm_forward_deg=8.0, elbow_bend_deg=25.0, shoulder_drop=0.11)
MATERIAL_SET = "bible"
# the concept's own material colours (sampled on the sheet, mid tones): the ochre hood, the pale stone plates,
# the brown-grey tunic, the bone-white thrower. The brief's role names; its hexes moved onto the painting.
PALETTE = materials.bible_palette(sandstone="#A2855E", wood="#CEC5B1", cloth2="#A39B8E", stone="#BDB6A9",
                                  dawnglass="#A9C3DC", cloth="#5C4738", leather="#4F3A2C", under="#342D29",
                                  ironstone="#4A4540", ink="#17161A", accent="#3F9CFF", skin="#8E6248",
                                  linen="#A89E8C", wraps="#5E564C", suede="#6E5D4C", carved="#5A4434",
                                  lacquer="#4B3049")
VALUE_GRADIENT_STOPS = materials.BIBLE_GRADIENT_STOPS
SOCKETS = {"weapon": "prop.R", "dart_tip": "x_dart_tip", "quiver": "x_quiver"}
SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92, "yaw": 22.0}
TEXTURE_SIZE = 2048
TEXTURE_SIZES = {"normal": 512, "orm": 256}
GLB_COMPRESS = True
ARMOUR_CONFORM = False
AO_INTO_BASE = 0.25

HEIGHT = 1.85             # the hood's peak (the projection plates' scale)
PROJECTION = {"concept": "ulkro", "height": HEIGHT}
NOISE = sdf.Noise(13)
VOXEL = 0.007

# ART 2.0 skins re-colour the painting part by part (pipeline -> project.recolour: skin role / base role per channel).
# The brief's skin tables are written against ITS base palette (paler than the concept): the identity colour of each
# skin is used as named (Highrim's sandstone wraps; Long Evening's plum hood and smoked-amber heads), every other
# role takes the brief's own change (skin / brief base) on top of the concept's colour, so the tunic and boots stay
# mid and dark as the brief asks. Palettes: _design/fighters/ulkro.md section 9.
BRIEF_BASE = {"sandstone": "#D6CAB0", "wood": "#D9CFB8", "cloth2": "#CFC8BA", "stone": "#B3AEA2",
              "dawnglass": "#B9CFE0", "cloth": "#7E7466"}


def _hl(h):
    h = h.lstrip("#")
    c = np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _lh(c):
    c = np.clip(c, 0, 1)
    s_ = np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)
    return "#" + "".join(f"{int(round(v * 255)):02X}" for v in s_)


def _skin_pal(identity: dict, relative: dict) -> dict:
    out = dict(identity)
    for role, hx in relative.items():
        out[role] = _lh(_hl(PALETTE[role]) * _hl(hx) / np.maximum(_hl(BRIEF_BASE[role]), 1e-4))
    return out


SKINS: list = [
    # Highrim: the named sandstone #CDBB9C (hue 38, 24 %) set a step under its hex like the base's own colours (three.js
    # lifts the albedo ~1.4x: as named it rendered the hood near white), on the hood AND the sleeve wraps (the brief's
    # "sandstone wraps"; the sleeves are cloth2 here)
    {"id": "ulkro_highrim", "extra": {}, "card": {"primary": "#8E8068", "secondary": "#E0D8C6"},
     "palette": dict(_skin_pal({"sandstone": "#B29F7E"}, {"wood": "#E0D8C6", "cloth": "#85796A", "stone": "#BDB6A8"}),
                     cloth2="#9C8B6E")},
    {"id": "ulkro_long_evening", "extra": {"lacquer_fan": True}, "card": {"primary": "#4A3548", "secondary": "#9C8566"},
     "palette": dict(_skin_pal({"sandstone": "#5B3A5E", "dawnglass": "#9C8566"},
                               {"wood": "#E2D8C4", "stone": "#C9C1B3", "cloth2": "#D2CBBE"}), lacquer="#4B3049")},
]
SKIN_FLAT = {"lacquer_fan": "lacquer"}


# ── fitted geometry (metres; the model faces -Y, her right = -X) ─────────────────────────────────────────
def _n(v):
    v = np.asarray(v, dtype=np.float64)
    return v / (np.linalg.norm(v) + 1e-12)


SH_R, SH_L = np.array([-0.22, 0.0, 1.431]), np.array([0.22, 0.0, 1.431])
EL_R, EL_L = np.array([-0.34, 0.03, 1.19]), np.array([0.33, 0.03, 1.19])
WR_R, WR_L = np.array([-0.28, -0.155, 1.03]), np.array([0.335, -0.06, 0.95])
GRIP_R = np.array([-0.25, -0.225, 0.965])          # the right fist's centre on the thrower (prop.R)
AX = _n([0.585, 0.09, -0.088])                       # the weapon's axis, butt -> head (rest: across her front)
UPW = _n(np.array([0.0, 0.0, 1.0]) - AX * AX[2])    # the weapon's "up" (the dart lies on top of the thrower)
SIDEW = np.cross(AX, UPW)
DART_OFF = 0.026                                     # the laid dart's axis above the thrower's
DART_S = (-0.27, 0.80, 0.96)                         # dart butt (on the peg), head base, tip (along AX from GRIP_R)
THROWER_S = (-0.34, 0.19)
GRIP_L = GRIP_R + AX * 0.585 + UPW * DART_OFF        # the left hand on the dart's shaft


def wpt(s, up=0.0, side=0.0):
    """a point on the weapon frame: s along the axis from the right grip, `up` above the thrower axis"""
    return GRIP_R + AX * s + UPW * up + SIDEW * side


DART_TIP = wpt(DART_S[2], DART_OFF)

# the quiver: a flattened linen tube on the back, right shoulder (mouth) -> left hip
Q_TOP = np.array([-0.205, 0.175, 1.585])
Q_BOT = np.array([0.215, 0.165, 1.075])
Q_U = _n(Q_TOP - Q_BOT)                              # up the quiver
Q_N = _n(np.array([0.0, 1.0, 0.0]) - Q_U * Q_U[1])  # out from her back
Q_W = np.cross(Q_U, Q_N)                             # across the quiver (in the back's plane)
Q_HW, Q_HD = 0.078, 0.048                            # half width / half depth of the tube
# the five crest darts: (tilt toward her right, tilt forward (-) / back (+), base offset across the mouth, length).
# The concept fans them 18-46 degrees over the right shoulder; in game (build 4/6) the health bar, which sits 0.35 m over
# art.height = the crest's top, hid every tip that leaned AWAY from the camera: the tips leaning back whenever she faced
# the camera, the outer darts whenever her right side faced away (one of the two lane facings). The fan is kept to her
# right but stands more upright (6-30 degrees) and its darts lean a little forward over the hood instead of back, so
# the spray of lines stays under the bar from both lane facings.
CREST = [(6.0, -10.0, -0.040, 0.60), (12.0, -3.0, -0.018, 0.62), (18.0, 3.0, 0.004, 0.63), (24.0, -1.0, 0.026, 0.61),
         (30.0, -8.0, 0.046, 0.58)]
DART_R = 0.0145
HEAD_L, HEAD_W, HEAD_T = 0.16, 0.034, 0.007          # the leaf head: length, half width, half thickness


def crest_dart(i):
    """(base inside the quiver, unit direction, tip) of crest dart i"""
    a, b, off, L = CREST[i]
    d = _n([-math.tan(math.radians(a)), math.tan(math.radians(b)), 1.0])
    base = Q_TOP - Q_U * 0.16 + Q_W * off + Q_N * 0.004 * (i - 2)
    return base, d, base + d * L


# ── shaping helpers ──────────────────────────────────────────────────────────────────────────────────────
def folds(amp, freq, axis=0, phase=0.0, zfade=None):
    def fn(P):
        u = P[:, axis] * freq + phase + 0.7 * NOISE(P, 3.0)
        a = amp
        if zfade is not None:
            z0, z1 = zfade
            a = amp * np.clip((z0 - P[:, 2]) / (z0 - z1), 0.2, 1.0)
        return a * (np.abs(np.sin(u)) * 2.0 - 1.0) * -0.5
    return fn


def hfolds(amp, freq, phase=0.0, tilt=(0.0, 0.0)):
    """horizontal-ish wrapped folds (the face wrap, the cowl): ridges along Z, tilted by x / y"""
    def fn(P):
        u = (P[:, 2] + tilt[0] * P[:, 0] + tilt[1] * P[:, 1]) * freq + phase + 0.5 * NOISE(P, 4.0)
        return amp * (np.abs(np.sin(u)) * 2.0 - 1.0) * -0.5
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
        ridge = np.clip(1.0 - np.abs(f - 0.5) * 4.0, 0.0, 1.0)       # a soft ridge mid-band, grooves at the seams
        groove = np.exp(-((f - 0.02) / 0.05) ** 2) + np.exp(-((f - 1.02) / 0.05) ** 2)
        return -amp * 0.5 * ridge + amp * groove
    return fn


def chips(amp, freq):
    def fn(P):
        return amp * np.clip(NOISE.ridged(P, freq, 3), 0, 1) - amp * 0.3
    return fn


def strap(S, pts, normal_fn, w, t, k=0.006):
    """a flat band through `pts` lying on a surface (normal_fn(p) -> outward normal): width w, thickness t"""
    for i in range(len(pts) - 1):
        a, b = np.asarray(pts[i], float), np.asarray(pts[i + 1], float)
        n = _n(normal_fn((a + b) * 0.5))
        side = _n(np.cross(b - a, n))
        S.add(FlatCapsule(a, b, w, t, w, t, side=side), k=k)


def torso_normal(p):
    c = np.array([0.0, 0.0, max(1.05, min(1.45, p[2]))])
    return _n((np.asarray(p) - c) * np.array([1.0, 1.25, 0.25]))


def fist(name, grip, axis, wrist, knuckle, shaft_r, scale=1.0, index_fwd=1.0):
    """a sculpted fist round a shaft: palm block toward the wrist, four curled fingers round the shaft (index on
    the `index_fwd` side along the axis), knuckle rolls, a thumb wrapped the other way"""
    S = Sculpt(name)
    u = _n(axis)
    g = np.asarray(grip, float)
    toward_w = np.asarray(wrist, float) - g
    bk = _n(toward_w - u * (toward_w @ u))             # from the shaft toward the back of the hand / wrist
    kn = _n(np.asarray(knuckle, float) - u * (u @ knuckle))
    q = _n(np.cross(u, kn))
    fr = 0.0118 * scale
    rf = shaft_r + fr * 0.95
    # palm + back of the hand: between the shaft and the wrist, knuckle side up
    S.add(Ellipsoid(g + bk * 0.046 * scale + kn * 0.006, (0.048 * scale, 0.034 * scale, 0.027 * scale),
                    axes=np.stack([u, bk, np.cross(u, bk)])), k=0.0)
    S.add(Capsule(g + bk * 0.075 * scale, np.asarray(wrist, float) + bk * 0.005, 0.030 * scale), k=0.025)
    for i in range(4):
        s = (1.5 - i) * 0.0235 * scale * index_fwd
        c = g + u * s
        ln = 1.0 - 0.07 * abs(i - 1)
        ths = np.radians(np.array([-35.0, 25.0, 95.0, 165.0, 230.0 * ln]))
        pts = [c + rf * (np.cos(t) * kn + np.sin(t) * q) for t in ths]
        pts[0] = pts[0] + bk * 0.022 * scale
        S.add(Tube(pts, [fr * 1.05, fr, fr * 0.96, fr * 0.9, fr * 0.82], k=0.006), k=0.006)
        S.add(Sphere(c + kn * (rf + 0.004) + bk * 0.012 * scale, fr * 1.05), k=0.008)   # knuckle
    # thumb: from the palm's base round the other side, its tip over the index finger
    tb = g + bk * 0.04 * scale - u * 0.03 * scale * index_fwd - q * 0.022 * scale
    S.add(Tube([tb, g - q * (rf + 0.004) + bk * 0.012 - u * 0.006 * index_fwd,
                g - q * (rf * 0.6) - kn * (rf * 0.85) + u * 0.022 * scale * index_fwd],
               [0.015 * scale, 0.0125 * scale, 0.011 * scale], k=0.006), k=0.012)
    return S


# ── the sculpt ──────────────────────────────────────────────────────────────────────────────────────────
HEAD_C = np.array([0.0, -0.025, 1.69])
HOOD_C = np.array([0.0, 0.005, 1.675])
BAND_Z, BAND_H = 1.712, 0.021        # the carved eye band's centre height and half height
BAND_R = (0.090, 0.108)              # its ring radii (x, y) round the head


def sculpts() -> list:
    """(name, Sculpt, voxel scale, material role, bind, tris, uv weight) in build order"""
    out = []

    def part(name, S, role, bind, tris, vs=1.0, uvw=1.0):
        out.append((name, S, vs, role, bind, tris, uvw))

    # HOOD (rigid on the head): a peaked shell with a deep face opening, the point trailing back
    hood = Sculpt("hood")
    hood.add(Ellipsoid(HOOD_C, (0.135, 0.168, 0.168)).displaced(folds(0.006, 26.0, axis=0, phase=0.6), 0.006), k=0.0)
    hood.add(RoundCone(HOOD_C + (0.0, 0.015, 0.06), (0.0, 0.065, 1.858), 0.088, 0.010), k=0.05)
    hood.add(RoundCone(HOOD_C + (0.0, 0.09, 0.03), (0.0, 0.185, 1.70), 0.06, 0.016), k=0.04)      # the trailing point
    hood.add(Ellipsoid(HOOD_C + (0.0, 0.02, -0.10), (0.142, 0.16, 0.06)), k=0.04)                   # flare to the cowl
    hood.sub(Ellipsoid(HOOD_C + (0.0, -0.005, 0.0), (0.112, 0.142, 0.142)), k=0.01)                  # the hollow
    hood.sub(Ellipsoid((0.0, -0.215, 1.676), (0.084, 0.13, 0.106)), k=0.012)                         # the face opening
    hood.inter(HalfSpace((0, 0, 1.555), (0, 0, -1), 1.0), k=0.02)
    part("hood", hood, "sandstone", "bone:head", 1750, uvw=1.6)
    tail = Sculpt("hood_tail")
    path = [(0.105, 0.075, 1.705), (0.17, 0.11, 1.70), (0.25, 0.155, 1.665), (0.33, 0.19, 1.625), (0.41, 0.215, 1.585),
            (0.465, 0.23, 1.555)]
    widths = [0.034, 0.036, 0.033, 0.029, 0.022, 0.012]
    for i in range(len(path) - 1):
        a, b = np.array(path[i]), np.array(path[i + 1])
        tw = math.radians(25 + 70 * i / (len(path) - 1))           # the ribbon twists as it flies out
        d = _n(b - a)
        e1 = _n(np.cross(d, [0, 0, 1]))
        e2 = np.cross(d, e1)
        side = math.cos(tw) * e2 + math.sin(tw) * e1
        tail.add(FlatCapsule(a, b, widths[i], 0.0055, widths[i + 1], 0.005, side=side), k=0.012)
    part("hood_tail", tail, "sandstone", "bone:head", 260, vs=0.6)

    # HEAD + FACE WRAP (rigid on the head) and the carved eye band
    head = Sculpt("head")
    head.add(Ellipsoid(HEAD_C, (0.084, 0.100, 0.118)), k=0.0)
    head.add(Ellipsoid(HEAD_C + (0.0, -0.035, -0.07), (0.07, 0.07, 0.06)), k=0.04)            # the wrapped jaw
    head.add(Capsule((0, 0.0, 1.50), (0, -0.01, 1.62), 0.058), k=0.04)                         # neck (under the cowl)
    head.sub(Ellipsoid((0, -0.135, 1.68), (0.03, 0.02, 0.05)), k=0.03)                          # soft nose-bridge valley
    head.add(Ellipsoid((0, -0.118, 1.665), (0.022, 0.018, 0.032)), k=0.02)                    # nose under the wrap
    part("head", _with_disp(head, _face_wrap, 0.0032), "cloth2", "bone:head", 750, vs=0.8, uvw=2.2)
    band = Sculpt("eyeband")
    ring = Torus((0.0, HEAD_C[1], BAND_Z), BAND_R[0], 0.011, axes=np.diag([1.0, BAND_R[0] / BAND_R[1], 1.0]), rz=BAND_H)
    band.add(ring.displaced(_band_carve, 0.003), k=0.0)
    band.add(RoundCone((0.0, -0.130, BAND_Z + 0.004), (0.0, -0.152, BAND_Z - 0.004), 0.016, 0.008), k=0.012)  # beak keel
    band.inter(HalfSpace((0, HEAD_C[1] + 0.035, BAND_Z), (0, 1, 0), 0.4), k=0.01)
    band.sub(Torus((0.0, HEAD_C[1], BAND_Z - BAND_H + 0.006), BAND_R[0] + 0.011, 0.004,
                   axes=np.diag([1.0, BAND_R[0] / BAND_R[1], 1.0]), rz=0.0035), k=0.002)       # the eye slit (ink)
    part("eyeband", band, "carved", "bone:head", 600, vs=0.5, uvw=2.0)

    # TORSO (heat weights): lean chest, narrow waist; the wrapped tunic's cross folds
    torso = Sculpt("torso")
    torso.add(Ellipsoid((0.0, -0.005, 1.30), (0.165, 0.115, 0.20)), k=0.0)
    torso.add(Ellipsoid((0.0, 0.005, 1.43), (0.195, 0.105, 0.085)), k=0.07)
    torso.add(Ellipsoid((0.0, 0.0, 1.13), (0.142, 0.103, 0.12)), k=0.08)
    for sx in (-1, 1):
        torso.add(Sphere((sx * 0.205, 0.0, 1.425), 0.062), k=0.05)
        torso.add(Ellipsoid((sx * 0.11, 0.02, 1.49), (0.09, 0.07, 0.05)), k=0.05)
    part("torso", _with_disp(torso, _cross_folds, 0.006), "cloth", "auto", 1300)
    cowl = Sculpt("cowl")
    cowl.add(Torus((0.0, 0.0, 1.548), 0.122, 0.052, axes=np.diag([1.0, 0.122 / 0.112, 1.0]), rz=0.05)
             .displaced(hfolds(0.008, 60.0, tilt=(0.35, 0.0)), 0.008), k=0.0)
    cowl.add(Ellipsoid((0.0, -0.10, 1.505), (0.135, 0.055, 0.07)).displaced(hfolds(0.009, 55.0, tilt=(0.5, 0.0)), 0.009),
             k=0.03)
    cowl.add(Ellipsoid((0.0, 0.075, 1.515), (0.15, 0.06, 0.06)).displaced(hfolds(0.008, 50.0), 0.008), k=0.03)
    part("cowl", cowl, "sandstone", ("zblend", "chest", "neck", 1.53, 1.60), 1050, uvw=1.3)
    straps = Sculpt("straps")
    for sx in (-1, 1):                     # the crossed straps: shoulder over the chest to the opposite hip, and the back
        fr = [(sx * 0.13, -0.075, 1.50), (sx * 0.07, -0.118, 1.38), (0.0, -0.128, 1.29), (-sx * 0.09, -0.118, 1.18),
              (-sx * 0.14, -0.09, 1.10)]
        strap(straps, fr, torso_normal, 0.018, 0.005)
        bk = [(sx * 0.13, 0.075, 1.50), (sx * 0.06, 0.112, 1.36), (-sx * 0.05, 0.112, 1.22), (-sx * 0.14, 0.085, 1.10)]
        strap(straps, bk, torso_normal, 0.017, 0.005)
    part("straps", straps, "leather", "auto", 520, vs=0.7)
    sash = Sculpt("sash")
    sash.add(Torus((0.0, 0.0, 1.105), 0.148, 0.045, axes=np.diag([1.0, 0.148 / 0.112, 1.0]), rz=0.042)
             .displaced(hfolds(0.004, 140.0), 0.004), k=0.0)
    sash.add(Ellipsoid((0.065, -0.122, 1.10), (0.04, 0.022, 0.034)), k=0.015)                     # the knot
    sash.add(RoundBox((0.085, -0.125, 1.02), (0.022, 0.006, 0.07), 0.005, axes=sdf.rot_y(-14)), k=0.012)   # its ends
    sash.add(RoundBox((0.045, -0.125, 1.03), (0.018, 0.006, 0.06), 0.005, axes=sdf.rot_y(10)), k=0.012)
    part("sash", sash, "leather", "auto", 650)

    # SHOULDER PLATES: two pale stone tiers each side, curved shells (the concept's carved pauldrons): the top tier
    # caps the shoulder from the cowl to past the joint, the lower tier hugs the upper arm under it
    for s, sx in (("R", -1), ("L", 1)):
        top = Sculpt(f"plate_{s}1")
        c1 = np.array([sx * 0.172, -0.004, 1.392])
        top.add(Ellipsoid(c1, (0.152, 0.128, 0.118)).displaced(chips(0.004, 9.0), 0.004), k=0.0)
        top.sub(Ellipsoid(c1 + (sx * 0.004, 0.0, -0.008), (0.134, 0.112, 0.104)), k=0.004)
        top.inter(HalfSpace((sx * 0.20, 0.0, 1.452), (-sx * 0.50, 0.0, -0.866), 0.5), k=0.006)
        top.inter(HalfSpace((sx * 0.105, 0.0, 1.45), (-sx, 0.0, 0.0), 0.5), k=0.006)
        part(f"plate_{s}1", top, "stone", ("dblend", f"shoulder.{s}", f"upper_arm.{s}", (sx * 0.16, 0.0, 1.50),
                                            (sx * 0.8, 0.0, -0.6), 0.03, 0.14), 520, vs=0.7)
        low = Sculpt(f"plate_{s}2")
        c2 = np.array([sx * 0.236, -0.004, 1.335])
        low.add(Ellipsoid(c2, (0.098, 0.112, 0.104)).displaced(chips(0.004, 9.0), 0.004), k=0.0)
        low.sub(Ellipsoid(c2 + (sx * 0.002, 0.0, -0.006), (0.084, 0.098, 0.092)), k=0.004)
        low.inter(HalfSpace((sx * 0.29, 0.0, 1.33), (-sx * 0.80, 0.0, -0.60), 0.5), k=0.006)
        low.inter(HalfSpace((0.0, 0.0, 1.425), (0.0, 0.0, 1.0), 0.5), k=0.006)
        part(f"plate_{s}2", low, "stone", f"bone:upper_arm.{s}", 360, vs=0.7)

    # ARMS: pale wrapped sleeves (heat weights), dark bracers, sculpted fists (rigid on the hands)
    sl = Sculpt("sleeves")
    for sh, el, wr in ((SH_R, EL_R, WR_R), (SH_L, EL_L, WR_L)):
        sl.add(FlatCapsule(sh, el, 0.064, 0.060, 0.054, 0.052, side=(1, 0, 0)).displaced(wraps(0.006, 0.045, sh, el), 0.006),
               k=0.0)
        sl.add(Sphere(el, 0.054), k=0.03)
        sl.add(FlatCapsule(el, wr, 0.052, 0.050, 0.040, 0.038, side=(1, 0, 0)).displaced(wraps(0.005, 0.04, el, wr, phase=0.3),
                                                                                        0.005), k=0.02)
    part("sleeves", sl, "cloth2", "auto", 1300)
    br = Sculpt("bracers")
    # right: a short dark wrist wrap / glove cuff
    br.add(FlatCapsule(EL_R + (WR_R - EL_R) * 0.62, WR_R + (WR_R - EL_R) * 0.06, 0.047, 0.045, 0.043, 0.041, side=(1, 0, 0))
           .displaced(wraps(0.004, 0.022, EL_R, WR_R, slant=0.0), 0.004), k=0.0)
    # left: the long bracer with the dark plate on its outer side
    br.add(FlatCapsule(EL_L + (WR_L - EL_L) * 0.12, WR_L + (WR_L - EL_L) * 0.04, 0.054, 0.052, 0.045, 0.043, side=(1, 0, 0))
           .displaced(wraps(0.003, 0.03, EL_L, WR_L, slant=0.0), 0.003), k=0.0)
    mid = EL_L + (WR_L - EL_L) * 0.5
    fa = _n(WR_L - EL_L)
    br.add(RoundBox(mid + np.array([0.048, 0.0, 0.0]), (0.010, 0.032, 0.10), 0.006,
                    axes=sdf.frame(fa, (1.0, 0.0, 0.0))), k=0.006)
    part("bracers", br, "leather", "auto", 620)
    WK_R = _n(np.array([-0.2, -0.55, 0.8]))           # the right fist's knuckles: up and forward
    WK_L = _n(np.array([0.15, -0.9, -0.1]))           # the left: forward, the palm toward her
    part("hand_R", fist("hand_R", GRIP_R, AX, WR_R, WK_R, 0.024, 1.08, index_fwd=1.0), "skin", "bone:hand.R", 700, vs=0.55)
    part("hand_L", fist("hand_L", GRIP_L, AX, WR_L, WK_L, DART_R, 1.04, index_fwd=-1.0), "skin", "bone:hand.L", 650, vs=0.55)

    # SKIRT: the wrapped tunic's long skirt from the sash to the hem, split at the front (analytic hips/thigh weights)
    sk = Sculpt("skirt")
    shell = FlatCapsule((0.0, 0.0, 1.07), (0.0, 0.008, 0.57), 0.150, 0.110, 0.285, 0.185, side=(1, 0, 0))
    sk.add(shell.displaced(folds(0.010, 30.0, axis=0, phase=0.4, zfade=(1.0, 0.6)), 0.010), k=0.0)
    sk.sub(FlatCapsule((0.0, 0.0, 1.12), (0.0, 0.008, 0.52), 0.128, 0.088, 0.262, 0.162, side=(1, 0, 0)), k=0.004)
    sk.inter(HalfSpace((0, 0, 1.115), (0, 0, 1), 1.0), k=0.0)
    sk.inter(Displaced_plane((0, 0, 0.0), _hem), k=0.006)
    sk.sub(_Slit((0.025, -0.10), 0.86, 0.17, front=True), k=0.006)                     # the front opening
    sk.sub(_Slit((0.03, 0.10), 0.70, 0.045, front=False), k=0.006)                     # the back vent
    part("skirt", sk, "cloth", "skirt", 1700, uvw=1.2)

    # LEGS: dark trousers bloused at the knee, wrapped shins, soft suede boots
    legs = Sculpt("legs")
    for sx in (-1, 1):
        hip, knee, ank = np.array([sx * 0.095, 0.005, 0.945]), np.array([sx * 0.105, -0.01, 0.515]), np.array([sx * 0.115, 0.02, 0.085])
        legs.add(FlatCapsule(hip + (0, 0, 0.04), knee + (0, 0, 0.05), 0.088, 0.092, 0.068, 0.07, side=(1, 0, 0))
                 .displaced(folds(0.006, 40.0, axis=2, phase=sx), 0.006), k=0.0)
        legs.add(Ellipsoid(knee + (0.0, -0.002, 0.03), (0.060, 0.062, 0.07)).displaced(folds(0.006, 45.0, axis=0), 0.006), k=0.04)
        legs.add(FlatCapsule(knee, ank + (0, 0, 0.1), 0.05, 0.054, 0.042, 0.044, side=(1, 0, 0)), k=0.02)
    legs.add(Ellipsoid((0.0, 0.01, 0.93), (0.15, 0.105, 0.09)), k=0.05)
    part("legs", legs, "under", "auto", 800)
    wr = Sculpt("wraps")
    for sx in (-1, 1):
        knee, ank = np.array([sx * 0.105, -0.01, 0.48]), np.array([sx * 0.115, 0.02, 0.12])
        wr.add(FlatCapsule(knee, ank, 0.060, 0.062, 0.050, 0.052, side=(1, 0, 0)).displaced(wraps(0.006, 0.05, knee, ank, slant=0.6), 0.006),
               k=0.0)
    part("wraps", wr, "wraps", "auto", 800)
    boots = Sculpt("boots")
    for sx in (-1, 1):
        to = math.radians(sx * 6.0)
        fwd = np.array([math.sin(to), -math.cos(to), 0.0])
        ank = np.array([sx * 0.115, 0.02, 0.0])
        boots.add(RoundBox(ank + fwd * 0.065 + (0, 0, 0.045), (0.050, 0.130, 0.045), 0.04, axes=sdf.rot_z(math.degrees(to))), k=0.0)
        boots.add(Ellipsoid(ank + fwd * 0.15 + (0, 0, 0.04), (0.05, 0.06, 0.04)), k=0.03)        # rounded toe
        boots.add(FlatCapsule(ank + (0, 0, 0.04), ank + (0, 0, 0.16), 0.058, 0.064, 0.054, 0.058, side=(1, 0, 0)), k=0.04)
    boots.inter(HalfSpace((0, 0, 0.0), (0, 0, -1), 2.0), k=0.0)
    part("boots", boots, "suede", "auto", 720)

    # QUIVER + CREST (one rigid piece on the chest): the linen tube, its leather bands and mouth, five darts
    qv = Sculpt("quiver")
    qc = (Q_TOP + Q_BOT) * 0.5
    qL = float(np.linalg.norm(Q_TOP - Q_BOT))
    qax = np.stack([Q_W, Q_N, Q_U])
    qv.add(RoundBox(qc, (Q_HW, Q_HD, qL * 0.5), 0.035, axes=qax).displaced(_quiver_wrap, 0.004), k=0.0)
    qv.add(RoundBox(Q_BOT + Q_U * 0.05, (Q_HW + 0.008, Q_HD + 0.008, 0.05), 0.03, axes=qax), k=0.005)    # the bottom cap
    qv.sub(RoundBox(Q_TOP + Q_U * 0.02, (Q_HW - 0.012, Q_HD - 0.012, 0.06), 0.02, axes=qax), k=0.006)      # the open mouth
    part("quiver", qv, "linen", "bone:chest", 650)
    qb = Sculpt("quiver_bands")
    for zz in (0.085, 0.125):
        qb.add(RoundBox(Q_TOP - Q_U * zz, (Q_HW + 0.006, Q_HD + 0.006, 0.013), 0.028, axes=qax), k=0.0)
    qb.add(RoundBox(Q_TOP - Q_U * 0.008, (Q_HW + 0.004, Q_HD + 0.004, 0.012), 0.026, axes=qax), k=0.0)    # the mouth's rim
    qb.sub(RoundBox(Q_TOP + Q_U * 0.02, (Q_HW - 0.012, Q_HD - 0.012, 0.06), 0.02, axes=qax), k=0.004)
    part("quiver_bands", qb, "leather", "bone:chest", 360, vs=0.7)
    shafts, heads, inlays = Sculpt("crest_shafts"), Sculpt("crest_heads"), Sculpt("crest_inlays")
    for i in range(len(CREST)):
        base, d, tip = crest_dart(i)
        hb = tip - d * HEAD_L
        shafts.add(Capsule(base, hb + d * 0.012, DART_R), k=0.0)
        shafts.add(Capsule(hb - d * 0.02, hb + d * 0.01, DART_R * 1.25), k=0.004)         # the binding under the head
        _leaf(heads, inlays, hb, d, np.cross(d, Q_W))
    part("crest_shafts", shafts, "wood", "bone:chest", 560, vs=0.5)
    part("crest_heads", heads, "dawnglass", "bone:chest", 700, vs=0.42)
    part("crest_inlays", inlays, "accent", "bone:chest", 420, vs=0.42)

    # THE THROWER AND ITS LAID DART (prop.R): the bleached carved thrower, the dart on top, a dawnglass leaf head
    th = Sculpt("thrower")
    a0, a1 = THROWER_S
    th.add(RoundCone(wpt(a0 + 0.05), wpt(a1), 0.022, 0.016), k=0.0)
    th.add(Ellipsoid(wpt(a0 + 0.035), (0.030, 0.042, 0.030), axes=np.stack([SIDEW, AX, UPW])), k=0.025)     # carved butt knob
    for s in (-0.29, -0.255, -0.215):
        th.add(Torus(wpt(s), 0.024, 0.006, axes=np.stack([SIDEW, UPW, AX])), k=0.006)                    # carved rings
    th.add(RoundCone(wpt(a0 + 0.03, 0.02), wpt(a0 + 0.06, DART_OFF + 0.006), 0.009, 0.006), k=0.006)       # the hooked peg
    th.add(Capsule(wpt(-0.06), wpt(0.065), 0.0255), k=0.008)                                               # the leather grip
    th.add(Capsule(wpt(DART_S[0] + 0.02, DART_OFF), wpt(DART_S[1] + 0.01, DART_OFF), DART_R), k=0.0)       # the laid dart
    th.add(Capsule(wpt(DART_S[1] - 0.02, DART_OFF), wpt(DART_S[1] + 0.01, DART_OFF), DART_R * 1.25), k=0.004)
    part("thrower", th, "wood", "bone:prop.R", 660, vs=0.6)
    lh, li = Sculpt("dart_head"), Sculpt("dart_inlay")
    _leaf(lh, li, wpt(DART_S[1], DART_OFF), AX, UPW, scale=1.1)
    part("dart_head", lh, "dawnglass", "bone:prop.R", 160, vs=0.42)
    part("dart_inlay", li, "accent", "bone:prop.R", 90, vs=0.42)
    return out


# small geometry helpers used above ------------------------------------------------------------------------------
def _with_disp(S: Sculpt, fn, amp):
    """displace every add-op primitive of a sculpt (folds over a whole part)"""
    S2 = Sculpt(S.name)
    for op, prim, k, tag in S.ops:
        if op == "add":
            prim = prim.displaced(fn, amp)
        S2.ops.append((op, prim, k, tag))
    return S2


def _band_carve(P):
    """the eye band's carved relief: interlaced swirls cut 2-3 mm into the wood"""
    x, z = P[:, 0], P[:, 2] - BAND_Z
    th = np.arctan2(x, -(P[:, 1] - HEAD_C[1]))
    u = th * 7.0 + 2.2 * np.sin(z * 110.0)
    v = np.sin(u) * np.cos(z * 140.0 + th * 3.0)
    return 0.0028 * np.clip(np.abs(v) - 0.55, 0, 1) * 2.2


def _face_wrap(P):
    """the linen face wrap: a few broad bands wound slanting up toward her left, soft seams between them"""
    u = (P[:, 2] - 0.30 * P[:, 0]) * 62.0 + 0.35 * NOISE(P, 5.0)
    f = u / (2 * math.pi) - np.floor(u / (2 * math.pi))
    seam = np.exp(-((f - 0.04) / 0.07) ** 2) + np.exp(-((f - 1.04) / 0.07) ** 2)
    return 0.0032 * seam - 0.0012 * np.sin(np.pi * f)


def _cross_folds(P):
    """the wrapped tunic: diagonal folds converging on the sash, front and back"""
    x, z = P[:, 0], P[:, 2]
    u = (np.abs(x) * 0.9 + (1.40 - z)) * 38.0 + 0.6 * NOISE(P, 3.0)
    a = 0.006 * np.clip((1.42 - z) / 0.2, 0.2, 1.0)
    return a * (np.abs(np.sin(u)) * 2.0 - 1.0) * -0.5


def _quiver_wrap(P):
    q = P - Q_BOT
    t = q @ Q_U
    w = q @ Q_W
    u = (t + 0.35 * w) * 55.0 + 0.4 * NOISE(P, 5.0)
    return 0.0025 * (np.abs(np.sin(u)) * 2.0 - 1.0) * -0.5


def _hem(P):
    """the skirt's hem height at P: lower at her right front corner, a shallow curve round the back"""
    x, y = P[:, 0], P[:, 1]
    th = np.arctan2(x, -y)                                   # 0 = front, +-pi = back, + = her left
    h = 0.60 + 0.03 * np.cos(th) + 0.035 * np.clip(-x / 0.25, -1, 1) * (y < 0.05)
    h = h + 0.012 * NOISE(P * np.array([1.0, 1.0, 0.0]), 9.0)
    return h


class Displaced_plane(sdf.Prim):
    """inside = above the hem height function (a wavy horizontal cut)"""

    def __init__(self, c, hfn):
        self.c = np.asarray(c, float)
        self.hfn = hfn

    def bounds(self):
        return np.array([-1.0, -1.0, -0.5]), np.array([1.0, 1.0, 2.5])

    def d(self, P):
        return self.hfn(P) - P[:, 2]


class _Slit(sdf.Prim):
    """an inverted-V opening in the skirt (front: under the sash's knot; back: a vent), up to z_top"""

    def __init__(self, xy, z_top, half_at_hem, front=True):
        self.x0, self.y0 = xy
        self.zt, self.hw, self.front = z_top, half_at_hem, front

    def bounds(self):
        y0, y1 = (-0.4, 0.0) if self.front else (0.0, 0.4)
        return np.array([-0.5, y0, 0.3]), np.array([0.5, y1, self.zt + 0.02])

    def d(self, P):
        t = np.clip((self.zt - P[:, 2]) / max(1e-6, self.zt - 0.55), 0.0, 1.2)
        half = self.hw * t
        dx = np.abs(P[:, 0] - self.x0) - half
        dy = (P[:, 1] - self.y0) if self.front else (self.y0 - P[:, 1])
        dz = P[:, 2] - self.zt
        return np.maximum(np.maximum(dx, dy), dz)


def _leaf(heads, inlays, base, d, nrm, scale=1.0):
    """a dawnglass leaf head (feathered edges) from `base` along `d`, its flat faces along `nrm`; the accent inlay a
    long diamond set proud on both faces"""
    d = _n(d)
    nrm = _n(np.asarray(nrm) - d * (d @ nrm))
    w = np.cross(d, nrm)
    L, W, T = HEAD_L * scale, HEAD_W * scale, HEAD_T * scale

    class Leaf(sdf.Prim):
        def bounds(self):
            pts = [base + d * s + w * a + nrm * b for s in (-0.01, L + 0.01) for a in (-W - 0.01, W + 0.01) for b in (-T - 0.01, T + 0.01)]
            pts = np.array(pts)
            return pts.min(0), pts.max(0)

        def d(self, P):
            q = P - base
            s, a, b = q @ d, q @ w, q @ nrm
            u = np.clip(s / L, 0, 1)
            prof = W * np.sin(np.pi * np.clip(u, 0, 1) ** 0.75) ** 0.9            # widest a third up, a long point
            notch = 0.22 * W * np.clip(np.sin(u * 7 * np.pi), 0, 1) ** 3 * (u > 0.12) * (u < 0.86)   # feathered edge cuts
            half = np.maximum(prof - notch, 1e-4)
            thick = T * (1.0 - 0.7 * np.abs(a) / np.maximum(half, 1e-4)) + 0.0012
            dx = np.abs(a) - half
            dy = np.abs(b) - thick
            ds = np.maximum(-s, s - L)
            return np.maximum(np.maximum(dx * 0.8, dy), ds)

    heads.add(Leaf(), k=0.0)
    for sgn in (1, -1):
        inlays.add(_Inlay(base, d, w, nrm * sgn, L, W, T), k=0.0)


class _Inlay(sdf.Prim):
    def __init__(self, base, d, w, n, L, W, T):
        self.b, self.dv, self.w, self.n, self.L, self.W, self.T = base, d, w, n, L, W, T

    def bounds(self):
        pts = np.array([self.b + self.dv * s + self.w * a + self.n * c for s in (0, self.L) for a in (-self.W, self.W)
                        for c in (-0.01, self.T + 0.012)])
        return pts.min(0), pts.max(0)

    def d(self, P):
        q = P - self.b
        s, a, c = q @ self.dv, q @ self.w, q @ self.n
        u = (s - self.L * 0.46) / (self.L * 0.40)
        half = self.W * 0.70 * np.clip(1 - np.abs(u), 0, 1) ** 0.85
        dx = np.abs(a) - half
        top = self.T + 0.0026                      # 1.4 mm proud of the glass at the leaf's spine
        dz = np.maximum(c - top, self.T * 0.3 - c)
        return np.maximum(np.maximum(dx * 0.9, dz), np.abs(u) * self.L * 0.40 - self.L * 0.40)


def skin_extras(extra: dict) -> list:
    """Long Evening: a rigid lacquered fan (0.30 m across, 4 cm deep) standing behind the quiver's mouth as a
    backdrop for the five crest darts (in the crest's plane, set back toward her back)"""
    out = []
    if extra.get("lacquer_fan"):
        fan = Sculpt("lacquer_fan")
        d0, d1 = crest_dart(0)[1], crest_dart(len(CREST) - 1)[1]
        nrm = _n(np.cross(d0, d1))
        if nrm[1] < 0:
            nrm = -nrm                                   # toward her back
        base = crest_dart(2)[0] - Q_U * 0.0 + nrm * 0.035
        e1 = _n(d0 + d1)
        e2 = np.cross(nrm, e1)
        half = 0.5 * math.acos(float(np.clip(d0 @ d1, -1, 1))) + math.radians(9)

        class Fan(sdf.Prim):
            def bounds(self):
                pts = np.array([base + e1 * r + e2 * w + nrm * t for r in (0.0, 0.50) for w in (-0.3, 0.3)
                                for t in (-0.04, 0.04)])
                return pts.min(0), pts.max(0)

            def d(self, P):
                q = P - base
                x, y, z = q @ e1, q @ e2, q @ nrm
                r = np.hypot(x, y)
                ph = np.arctan2(y, x)
                rib = 0.004 * (np.abs(np.sin(ph * 26.0)) > 0.85)          # the lacquered ribs stand proud
                da = (np.abs(ph) - half) * r
                dr = np.maximum(0.20 - r, r - 0.42 - 0.015 * np.cos(ph * 13.0))
                dt = np.abs(z) - (0.008 + rib)
                return np.maximum(np.maximum(da, dr), dt)
        fan.add(Fan(), k=0.0)
        out.append(("lacquer_fan", fan, 0.7, "lacquer", "bone:chest", 700, 1.0))
    return out


def extra_materials(ctx) -> dict:
    """roles the bible set lacks: skin (bare hands), linen (the quiver), wraps (shin wraps), suede (boots), carved
    (the dark eye band), lacquer (Long Evening's fan); the hood is CLOTH (the bible's sandstone is a honed stone:
    its sheen rendered the ochre hood bone-white in three.js), the thrower and shafts matte bleached wood"""
    pal = dict(materials.BIBLE_PALETTE, **PALETTE)
    pal.update(ctx.palette)
    g = ctx.gradient
    return {"skin": materials.waxed_leather("skin", pal, "skin", g, rough=0.72),
            "linen": materials.heavy_cloth("linen", pal, "linen", g, weave=0.7),
            "wraps": materials.heavy_cloth("wraps", pal, "wraps", g, weave=0.6),
            "suede": materials.waxed_leather("suede", pal, "suede", g, rough=0.88),
            "carved": materials.carved_wood("carved", pal, "carved", g, rough=0.72),
            "lacquer": materials.waxed_leather("lacquer", pal, "lacquer", g, rough=0.45),
            "sandstone": materials.heavy_cloth("sandstone", pal, "sandstone", g, rough=0.92, weave=0.8),
            "cloth2": materials.heavy_cloth("cloth2", pal, "cloth2", g, rough=0.92, weave=0.7),
            "wood": materials.carved_wood("wood", pal, "wood", g, rough=0.74),
            "stone": materials.honed_stone("stone", pal, "stone", g, rough=0.78, chisel=1.0),
            "leather": materials.waxed_leather("leather_matte", pal, "leather", g, rough=0.76)}


# ── decimation: the shared collapse keeps X symmetry, which stalls on this asymmetric figure's one-sided parts
# (the skirt kept 4490 of 2200 tris); those parts decimate without it (wrapper, common/ untouched) ──────────
ASYM = ("skirt", "hood_tail", "quiver", "crest_", "thrower", "dart_", "hand_", "bracers", "sash", "lacquer_fan")


def _install_decimate() -> None:
    from common import mesh
    orig = mesh.decimate_to
    if getattr(orig, "_ulkro", False):
        return

    def decimate_to(obj, target_tris, symmetric=True):
        if obj.name.startswith(ASYM):
            symmetric = False
        return orig(obj, target_tris, symmetric)
    decimate_to._ulkro = True
    mesh.decimate_to = decimate_to


_install_decimate()


# ── export: the shipping compression with the base colour at a lower WebP quality (wraps export.optimize in this
# build process only; the shared optimize.mjs takes --q-base): the 2048 painting at q80 left the GLB over 1172 KiB ──
Q_BASE = 70


def _install_optimize() -> None:
    from common import export
    orig = export.optimize
    if getattr(orig, "_ulkro", False):
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
        return {"ok": True, "before": before, "after": os.path.getsize(out), "q_base": Q_BASE}
    optimize._ulkro = True
    export.optimize = optimize


_install_optimize()


# ── rig ──────────────────────────────────────────────────────────────────────────────────────────────────
def rig_extras(ctx) -> None:
    """re-place both arms on the concept's carry, prop.R along the weapon (+Y = toward the dart's head, +Z = the
    weapon's up), sockets: x_dart_tip (every Hurl / Run-up dart), x_quiver (the Hamstring Dart is drawn there)"""
    info = ctx.info
    arm = info.armature
    scene.select_only([arm], arm)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    for s, el, wr, grip in (("R", EL_R, WR_R, GRIP_R), ("L", EL_L, WR_L, GRIP_L)):
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
    g = V(tuple(GRIP_R))
    eb["prop.R"].head = g
    eb["prop.R"].tail = g + V(tuple(AX)) * 0.12
    eb["prop.R"].align_roll(V(tuple(UPW)))
    gl = V(tuple(GRIP_L))
    eb["prop.L"].head = gl
    eb["prop.L"].tail = gl + V(tuple(AX)) * 0.12
    eb["prop.L"].align_roll(V(tuple(UPW)))
    bpy.ops.object.mode_set(mode="OBJECT")
    for b in arm.data.bones:
        info.lengths[b.name] = b.length
    rig.add_socket(info, "x_dart_tip", "prop.R", tuple(DART_TIP), tuple(AX * 0.08), z_hint=tuple(UPW))
    rig.add_socket(info, "x_quiver", "chest", tuple(Q_TOP + Q_U * 0.02), tuple(Q_U * 0.08), z_hint=(0, 1, 0))


# ── analytic weights (the skirt) ──────────────────────────────────────────────────────────────────────────
def _ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _skirt_weights(co):
    """hips at the sash, the thighs below by side; the back panel keeps more hips (no tearing in crouches)"""
    x, y, z = co[:, 0], co[:, 1], co[:, 2]
    wh = _ss(0.70, 1.02, z)
    wh = wh + (1 - wh) * 0.45 * _ss(0.02, 0.16, y)
    sL = _ss(-0.07, 0.07, x)
    return {"hips": wh, "thigh.L": (1 - wh) * sL, "thigh.R": (1 - wh) * (1 - sL)}


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
    if getattr(orig, "_ulkro", False):
        return

    def bind_part(ctx, part, obj, body_low=None):
        if part.bind == "skirt":
            _assign(obj, ctx.info.armature, _skirt_weights)
            return {}
        return orig(ctx, part, obj, body_low)
    bind_part._ulkro = True
    pipeline.bind_part = bind_part


_install_bind()

# ── paint: the projection, re-toned onto the concept's material colours, and painted in the concept's manner where
# the projection cannot work (wrapper of common/hifi/project.paint_object, installed in this build process only) ──
# part -> (albedo median target, value contrast, pull toward the target's hue): the projected detail is kept as
# per-texel ratios to the part's median (linear light), so every part lands on the concept's colour for its
# material (the first build read the ochre hood bone-white in three.js) with its painted folds and wear
# (build 2 measured three.js lifting the albedo ~1.4x: the pale sleeves and face wrap rendered white, so the targets
# sit a step under the concept's lit values)
TONE = {
    "hood": ("#957853", 1.0, 0.35), "hood_tail": ("#8C714E", 1.0, 0.35), "cowl": ("#8A6F4E", 1.0, 0.40),
    "head": ("#5F584E", 0.85, 0.75), "eyeband": ("#4A382B", 1.15, 0.45),
    "torso": ("#4E3B2E", 1.0, 0.45), "straps": ("#3F2D22", 0.9, 0.55), "sash": ("#563A2B", 0.95, 0.45),
    "plate_R1": ("#A69F92", 0.85, 0.65), "plate_L1": ("#A69F92", 0.85, 0.65),
    "plate_R2": ("#9D9689", 0.85, 0.65), "plate_L2": ("#9D9689", 0.85, 0.65),
    "bracers": ("#463830", 0.9, 0.55),
    "skirt": ("#5A4A3B", 1.0, 0.45), "quiver": ("#8A7E68", 0.9, 0.55), "quiver_bands": ("#4E3A2A", 0.9, 0.65),
}
# side-facing texels of these parts streak (neighbours along Y take one plate pixel): blended into the part's colour
# with painted breakup; up-facing texels likewise (the hood's crown, the plates' tops, the quiver's mouth)
SIDE_PARTS = ("hood", "cowl", "torso", "skirt", "sleeves", "quiver", "sash", "plate_R1", "plate_L1", "plate_R2",
              "plate_L2", "head", "bracers", "hood_tail", "straps", "quiver_bands")
MAX_LIN = 0.62          # no texel lighter than ~L* 82 in the albedo (the brief's L* 86 cap after the top light)


def _lum(c):
    return c[..., 0] * 0.2126 + c[..., 1] * 0.7152 + c[..., 2] * 0.0722


def _ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _hash(x):
    return (np.sin(x * 12.9898 + 4.1) * 43758.5453) % 1.0


def _tone(lin, tgt, contrast, desat, ref=None):
    """`ref`: the texels whose median is the part's colour (the face wrap's few visible front texels: the hidden
    rest took dark fills and the median of all of them rendered the visible face white)"""
    med = np.median(lin[ref] if ref is not None and ref.sum() > 200 else lin, axis=0)
    r = lin / np.maximum(med, 1e-4)
    rl = (_lum(lin) / max(float(_lum(med)), 1e-4))[:, None]
    r = r * (1 - desat) + rl * desat
    return tgt * np.clip(r, 0.0, 4.0) ** contrast


def paint_legs(p, n):
    v = 1.0 + 0.10 * NOISE(p, 7.0) + 0.05 * NOISE(p, 23.0)
    v = v * (0.80 + 0.26 * np.clip(n[:, 2] * 0.5 + 0.5, 0, 1))
    knee = np.exp(-((p[:, 2] - 0.53) / 0.07) ** 2) * (n[:, 1] < 0.1)
    v = v * (1 + 0.14 * knee)
    return _hl("#2E2723") * v[:, None]


def _helix(p, a, b, pitch, slant, phase=0.0):
    """the sculpt's wraps() phase round the segment a -> b (painted grooves land on the sculpted ones)"""
    a, b = np.asarray(a, float), np.asarray(b, float)
    u = _n(b - a)
    e1 = _n(np.cross(u, [0.0, 0.0, 1.0]) if abs(u[2]) < 0.9 else np.cross(u, [1.0, 0.0, 0.0]))
    e2 = np.cross(u, e1)
    q = p - a
    th = np.arctan2(q @ e2, q @ e1)
    return (q @ u) / pitch + slant * th / (2 * math.pi) + phase + 0.15 * NOISE(p, 6.0)


def _seg_dist(p, a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    ab = b - a
    t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(p - (a + np.outer(t, ab)), axis=1)


def paint_sleeves(p, n):
    """the pale sleeve wraps: bands wound up each arm (the sculpt's helix), a dark seam between bands, each band its
    own value, grey-beige linen a step darker than the stone plates above them"""
    segs = [(SH_R, EL_R, 0.045, 0.35, 0.0), (EL_R, WR_R, 0.04, 0.35, 0.3), (SH_L, EL_L, 0.045, 0.35, 0.0),
            (EL_L, WR_L, 0.04, 0.35, 0.3)]
    D = np.stack([_seg_dist(p, a, b) for a, b, *_ in segs], 1)
    which = np.argmin(D, 1)
    ph = np.zeros(len(p))
    for i, (a, b, pitch, slant, phs) in enumerate(segs):
        m = which == i
        if m.any():
            ph[m] = _helix(p[m], a, b, pitch, slant, phs) + 7.0 * i
    f = ph - np.floor(ph)
    groove = np.exp(-((f - 0.02) / 0.08) ** 2) + np.exp(-((f - 1.02) / 0.08) ** 2)
    ridge = np.sin(np.pi * f)
    band = _hash(np.floor(ph)) - 0.5
    v = (0.80 + 0.24 * ridge) * (1 - 0.42 * np.clip(groove, 0, 1)) * (1 + 0.16 * band)
    v = v * (1 + 0.06 * NOISE(p, 28.0)) * (0.84 + 0.20 * np.clip(n[:, 2] * 0.5 + 0.5, 0, 1))
    return _hl("#8E8678") * v[:, None]


def paint_wraps(p, n):
    """the shin wraps' bands from the sculpt's own helix (the same phase as wraps()): a dark groove at every seam,
    a lit ridge mid-band, each band a slightly different grey, frayed"""
    v = np.ones(len(p))
    for sx in (-1, 1):
        sel = p[:, 0] * sx > 0
        if not sel.any():
            continue
        a = np.array([sx * 0.105, -0.01, 0.48])
        b = np.array([sx * 0.115, 0.02, 0.12])
        u = _n(b - a)
        e1 = _n(np.cross(u, [0.0, 0.0, 1.0]) if abs(u[2]) < 0.9 else np.cross(u, [1.0, 0.0, 0.0]))
        e2 = np.cross(u, e1)
        q = p[sel] - a
        th = np.arctan2(q @ e2, q @ e1)
        ph = (q @ u) / 0.05 + 0.6 * th / (2 * math.pi) + 0.15 * NOISE(p[sel], 6.0)
        f = ph - np.floor(ph)
        groove = np.exp(-((f - 0.02) / 0.07) ** 2) + np.exp(-((f - 1.02) / 0.07) ** 2)
        ridge = np.sin(np.pi * f)
        band = _hash(np.floor(ph) + sx * 31.0) - 0.5
        v[sel] = (0.78 + 0.28 * ridge) * (1 - 0.5 * np.clip(groove, 0, 1)) * (1 + 0.14 * band)
    v = v * (1 + 0.06 * NOISE(p, 30.0)) * (0.86 + 0.18 * np.clip(n[:, 2] * 0.5 + 0.5, 0, 1))
    return _hl("#5E564C") * v[:, None]


def paint_boots(p, n):
    z = p[:, 2]
    v = 1.0 + 0.08 * NOISE(p, 9.0) + 0.05 * NOISE(p, 31.0)
    v = v * (0.84 + 0.22 * np.clip(n[:, 2] * 0.5 + 0.5, 0, 1))
    v = v * (1 - 0.18 * _ss(0.15, 0.19, z))                                       # the rolled top
    v = v * (1 + 0.12 * ((n[:, 1] < -0.5) & (z < 0.07)))                          # scuffed toes
    col = _hl("#6E5D4C") * v[:, None]
    welt = _ss(0.036, 0.020, z)
    col = col * (1 - 0.35 * welt)[:, None]
    sole = (z < 0.016) | (n[:, 2] < -0.6)
    col[sole] = _hl("#2C241E")
    return col


def paint_hands(p, n):
    v = 0.80 + 0.26 * np.clip(n[:, 2] * 0.5 + 0.5, 0, 1) + 0.06 * NOISE(p, 40.0)
    return _hl("#8E6248") * v[:, None]


def paint_thrower(p, n):
    """the bleached carved thrower (grain along it, carved rings, an aged butt knob), the ironstone peg, the
    leather-wrapped grip, the laid dart (pale shaft) and its dark binding under the head"""
    q = p - GRIP_R
    s, up, sd = q @ AX, q @ UPW, q @ SIDEW
    grain = 1 + 0.05 * np.sin(s * 260.0 + 6.0 * NOISE(p, 20.0)) + 0.05 * NOISE(p, 12.0)
    col = _hl("#D0C7B3") * grain[:, None]
    for s0 in (-0.29, -0.255, -0.215):
        col = col * (1 - 0.38 * np.exp(-((np.abs(s - s0) - 0.0062) / 0.0024) ** 2))[:, None]
    col = col * (1 - 0.12 * _ss(-0.30, -0.33, s))[:, None]
    dart = (np.hypot(up - DART_OFF, sd) < DART_R * 1.4) & (s > DART_S[0] + 0.01)
    col[dart] = (_hl("#C2B7A1") * (1 + 0.04 * np.sin(s[dart] * 300.0 + 4 * NOISE(p[dart], 25.0)))[:, None])
    peg = (s < -0.255) & (s > -0.34) & (up > 0.016) & ~dart
    col[peg] = _hl("#4A4540")
    grip = (s > -0.065) & (s < 0.070) & (np.hypot(up, sd) < 0.034) & ~dart
    wrap = 1 - 0.28 * np.abs(np.sin(s[grip] * 2 * math.pi / 0.014 + up[grip] * 40.0))
    col[grip] = _hl("#4E392B") * wrap[:, None]
    bind = dart & (np.abs(s - (DART_S[1] - 0.005)) < 0.022)
    col[bind] = _hl("#3E2E24") * (1 - 0.3 * np.abs(np.sin(s[bind] * 2 * math.pi / 0.006)))[:, None]
    return col


def paint_shafts(p, n):
    """the five crest shafts: pale wood, dark binding under each head, darker where they stand in the quiver"""
    best = np.full(len(p), 1e9)
    tt = np.zeros(len(p))
    Lx = np.zeros(len(p))
    for i in range(len(CREST)):
        base, d, tip = crest_dart(i)
        q = p - base
        t = q @ d
        dist = np.linalg.norm(q - np.outer(t, d), axis=1)
        m = dist < best
        best[m], tt[m], Lx[m] = dist[m], t[m], CREST[i][3]
    grain = 1 + 0.05 * np.sin(tt * 300.0 + 5 * NOISE(p, 25.0)) + 0.04 * NOISE(p, 14.0)
    col = _hl("#C8BEA8") * grain[:, None]
    hb = Lx - HEAD_L
    bind = (tt > hb - 0.022) & (tt < hb + 0.012)
    col[bind] = _hl("#3E2E24") * (1 - 0.3 * np.abs(np.sin(tt[bind] * 2 * math.pi / 0.006)))[:, None]
    col = col * (1 - 0.45 * _ss(0.20, 0.12, tt))[:, None]
    return col


def plate_rims(name, c, p, n):
    """the stone plates: a darker chipped rim along every cut edge, an incised line inside it, a dark underside"""
    sx = -1.0 if name.endswith(("R1", "R2")) else 1.0
    if name.endswith("1"):
        pp, nn = np.array([sx * 0.20, 0.0, 1.452]), _n([-sx * 0.50, 0.0, -0.866])
    else:
        pp, nn = np.array([sx * 0.29, 0.0, 1.33]), _n([-sx * 0.80, 0.0, -0.60])
    d = (p - pp) @ nn                                                   # 0 at the cut, negative inside the plate
    rim = 1 - _ss(0.0, 0.012, -d)
    line = np.exp(-((d + 0.028) / 0.0022) ** 2)
    under = _ss(0.1, -0.5, n @ (-nn))                                    # faces turned back into the shell
    k = (1 - 0.30 * rim) * (1 - 0.32 * line) * (1 - 0.45 * under) * (1 + 0.08 * NOISE(p, 30.0))
    return c * k[:, None]


def hood_shade(c, p, n):
    """the hood's inside: deep warm shadow round the face opening (the concept's dark hollow)"""
    to_c = HOOD_C - p
    inward = (n * to_c).sum(1) / (np.linalg.norm(to_c, axis=1) + 1e-6)
    inner = _ss(0.05, 0.45, inward) * (np.linalg.norm(to_c, axis=1) < 0.17)
    dark = _hl("#33261B") * (0.8 + 0.3 * np.clip(-n[:, 1], 0, 1))[:, None]
    return c * (1 - inner[:, None]) + dark * inner[:, None]


def face_shade(c, p, n):
    """the face wrap under the hood: lit only straight ahead, falling into the hood's shadow at the sides and top"""
    front = _ss(0.25, 0.85, -n[:, 1])
    side = _ss(0.05, 0.088, np.abs(p[:, 0]))
    top = _ss(1.74, 1.79, p[:, 2])
    k = (0.40 + 0.60 * front) * (1 - 0.5 * side) * (1 - 0.6 * top)
    return c * k[:, None]


def paint_glass(p, n):
    v = 0.92 + 0.10 * np.clip(n[:, 2], -1, 1) + 0.05 * NOISE(p, 60.0)
    return _hl("#A9C3DC") * v[:, None]


PROC = {"legs": paint_legs, "wraps": paint_wraps, "boots": paint_boots, "hand_R": paint_hands, "hand_L": paint_hands,
        "sleeves": paint_sleeves,
        "thrower": paint_thrower, "crest_shafts": paint_shafts, "crest_heads": paint_glass, "dart_head": paint_glass}


def post_paint(img: np.ndarray, maps: dict, names: list, skip=(), log=print) -> np.ndarray:
    from common.hifi import project
    part = maps["part"]
    have = part >= 0
    idx = np.nonzero(have)
    lin = project._lin(img)
    L = lin[idx]
    P = maps["P"][idx].astype(np.float64)
    N = maps["N"][idx].astype(np.float64)
    K = part[idx].astype(np.int64)
    for i, name in enumerate(names):
        if name in skip:
            continue
        m = K == i
        if not m.any():
            continue
        if name in PROC:
            L[m] = PROC[name](P[m], N[m])
            log(f"  paint {name}: procedural ({int(m.sum())} texels)")
            continue
        if name not in TONE:
            continue
        hx, con, des = TONE[name]
        tgt = _hl(hx)
        ref = None
        if name == "head":
            ref = (P[m][:, 1] < -0.09) & (N[m][:, 1] < -0.4) & (np.abs(P[m][:, 0]) < 0.07)
        c = _tone(L[m], tgt, con, des, ref)
        if name in SIDE_PARTS:
            n_ = N[m]
            side = np.abs(n_[:, 0]) / (np.abs(n_[:, 0]) + np.abs(n_[:, 1]) + 1e-6)
            ws = _ss(0.62, 0.95, side) * (1 - _ss(0.75, 0.95, np.abs(n_[:, 2])))
            wt = _ss(0.72, 0.92, n_[:, 2])
            w = np.clip(np.maximum(ws, wt) * 0.7, 0, 0.7)[:, None]
            brk = (1 + 0.10 * NOISE(P[m], 10.0) + 0.05 * NOISE(P[m], 35.0)) * (0.90 + 0.14 * np.clip(n_[:, 2], -1, 1))
            c = c * (1 - w) + (tgt * brk[:, None]) * w
        if name.startswith("plate_"):
            c = plate_rims(name, c, P[m], N[m])
        elif name == "hood":
            c = hood_shade(c, P[m], N[m])
        elif name == "head":
            c = face_shade(c, P[m], N[m])
        elif name == "eyeband":
            # the eye slit: an ink line along the band's lower groove, the carved relief's recesses a step darker
            pz_ = P[m][:, 2]
            slit = np.exp(-((pz_ - (BAND_Z - BAND_H + 0.006)) / 0.0035) ** 2) * (N[m][:, 1] < 0.2)
            c = c * (1 - slit[:, None]) + _hl("#17161A") * slit[:, None]
        L[m] = c
        log(f"  tone {name}: -> {hx}")
    L = np.clip(L, 0.0, MAX_LIN)
    lin[idx] = L
    out = project._srgb(lin).astype(np.float32)
    iy, ix = project.nearest_index(have)
    return out[iy, ix]


def _install_paint() -> None:
    from common.hifi import project
    orig = project.paint_object
    if getattr(orig, "_ulkro", False):
        return

    def paint_object(obj, size, cfg, names, part_attr="vale_part", log=print, return_maps=False):
        img, maps = orig(obj, size, cfg, names, part_attr=part_attr, log=log, return_maps=True)
        img = post_paint(img, maps, names, skip=set((cfg.get("flat") or {}).keys()), log=log)
        return (img, maps) if return_maps else img
    paint_object._ulkro = True
    project.paint_object = paint_object


_install_paint()


# ── motion ───────────────────────────────────────────────────────────────────────────────────────────────
# The concept's carry is the guard: the right fist low on the thrower, the dart laid across her front, the left hand
# on its shaft. Hands are IK targets relative to the posed shoulder in the chest frame (metres here, / L_ARM), the
# thrower is pointed with AimRoll (its axis + where the dart side faces). The run carries the dart forward on the
# right (the brief's horizontal bar), the left arm pumping. Throws are overhand / sidearm with the spear-thrower.
from dataclasses import dataclass  # noqa: E402

from mathutils import Matrix  # noqa: E402

HT, FT = anim.HandTarget, anim.FootTarget
L_ARM = float(np.linalg.norm(EL_R - SH_R) + np.linalg.norm(WR_R - EL_R))
REST_R = tuple(WR_R - SH_R)
REST_L = tuple(WR_L - SH_L)
POLE_R = (-0.85, 0.35, -0.25)
POLE_L = (0.85, 0.35, -0.25)
UP = (0.0, 0.0, 1.0)


@dataclass
class AimRoll(anim.Aim):
    """anim.Aim + `up`: where the thrower's dart side (prop +Z) faces (the shared aim leaves the roll to chance)"""
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


def _install_aim_roll() -> None:
    if getattr(anim._solve_aim, "_ulkro", False):
        return
    orig = anim._solve_aim

    def solve(skel, pose, M, side, am):
        orig(skel, pose, M, side, am)
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

    solve._ulkro = True
    anim._solve_aim = solve


_install_aim_roll()


# On this rig the shared foot solver turns FootTarget.pitch the wrong way (the foot's local X runs along -X: the
# run's push-off sank the heel 2 cm, so three_load_test found no level planted frames). Every foot target's pitch is
# flipped and its offset moved so the foot still turns about the pivot the author meant (heel for + toes up, ball for
# - heel up), the toes counter-bent on the ground at a push-off (Odrum's fix, as a solver wrapper for this build).
def _install_foot_fix() -> None:
    if getattr(anim._solve_foot, "_ulkro", False):
        return
    orig = anim._solve_foot

    def solve(skel, pose, M, side, ft):
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
        orig(skel, pose, M, side, ft)

    solve._ulkro = True
    anim._solve_foot = solve


_install_foot_fix()


def _rel(v):
    return tuple(float(c) / L_ARM for c in v)


def rh(v, aim=None, up=UP, pole=POLE_R) -> dict:
    """the right (thrower) hand: wrist offset from the right shoulder (m, chest frame), the thrower's axis"""
    ik = {"hand.R": HT(rel=_rel(v), pole=tuple(pole))}
    if aim is not None:
        ik["aim.R"] = AimRoll(tuple(_n(aim)), 1.0, tuple(up))
    return ik


def lh(v, pole=POLE_L) -> dict:
    return {"hand.L": HT(rel=_rel(v), pole=tuple(pole))}


def feet_(l=(0.0, 0.0, 0.0), r=(0.0, 0.0, 0.0), yl=3.0, yr=-12.0, pl=0.0, pr=0.0, kl=0.0, kr=0.0) -> dict:
    return anim.feet(l=l, r=r, yl=yl, yr=yr, pl=pl, pr=pr, kl=kl, kr=kr)


FEET0 = feet_(l=(0.02, -0.07, 0.0), r=(-0.02, 0.08, 0.0))                 # a runner's ready stance, left foot ahead


def pz(lean=8.0, yaw=0.0, roll=0.0, drop=0.035, dx=0.0, dy=0.0, look=(0.0, 0.0, 0.0), feet=None, R=None, L=None,
       extra=None) -> dict:
    """a body pose: the lean / yaw / roll spread over hips, spine and chest, the head held level toward the front
    (look = extra head pitch / yaw / roll), hips dropped by `drop`, feet planted by IK"""
    p = anim.merge(anim.arms_relaxed(), anim.P(
        hips=(lean * 0.40, yaw * 0.30, roll * 0.5), spine=(lean * 0.30, yaw * 0.30, -roll * 0.3),
        chest=(lean * 0.30, yaw * 0.40, -roll * 0.2),
        neck=(-lean * 0.45 + look[0] * 0.4, -yaw * 0.40 + look[1] * 0.4, look[2] * 0.4),
        head=(-lean * 0.45 + look[0] * 0.6, -yaw * 0.50 + look[1] * 0.6, look[2] * 0.6)))
    p["hips_loc"] = (dx, dy, -drop)
    ik = dict(feet if feet is not None else FEET0)
    ik.update(R if R is not None else rh(REST_R, AX, UPW))
    ik.update(L if L is not None else lh(REST_L))
    p["ik"] = ik
    if extra:
        p = anim.add(p, extra)
    return p


def G(**kw) -> dict:
    """the guard: the concept's carry, leaning 8 degrees, weight on the balls of the feet"""
    return pz(**kw)


def clip(name, N, keys, loop=False, impact=None, lags=None) -> anim.Clip:
    fn = anim.keyed(keys)
    if lags:
        fn = anim.drag(fn, N, lags, loop=loop)
    return anim.Clip(name, N, loop, fn, impact=impact)


def strike(name, N, wind, hit, fol, g=None) -> anim.Clip:
    keys = anim.strike_keys(MOTION, wind, hit, fol, guard_pose=g or G())
    return clip(name, N, keys, impact=anim.IMPACT, lags={"head": 1.5, "neck": 1.0})


# the generator's run (exact planted-foot speed at 3.5 m/s) with the brief's longest stride (cadence 0.8: 22 frames,
# 1.28 m steps), the forward dart carry on the right and the left arm pumping (arm blocks below)
BLOCKS: dict = {
    "guard": (_rel(REST_R), POLE_R, tuple(AX), _rel(REST_L), POLE_L),
    "run_fwd": (_rel((-0.02, -0.24, -0.40)), (-0.85, 0.40, -0.20), (0.20, -0.96, -0.16), (-0.12, -0.60, -0.52), None),
    "run_back": (_rel((-0.03, -0.15, -0.42)), (-0.85, 0.40, -0.20), (0.22, -0.95, -0.20), (0.12, 0.36, -0.80), None),
    "stunned": (_rel((-0.02, -0.12, -0.47)), (-0.85, 0.4, -0.2), (0.45, -0.55, -0.70), (0.10, -0.08, -0.95), None),
    "dash": (_rel((-0.10, 0.20, -0.38)), (-0.8, 0.5, -0.2), (0.25, -0.95, -0.15), (0.20, -0.60, -0.45), None),
    "channel": (_rel(REST_R), POLE_R, tuple(AX), (-0.05, -0.80, -0.20), None),
    "recall": (_rel(REST_R), POLE_R, tuple(AX), _rel(REST_L), POLE_L),
    "lobby": (_rel(REST_R), POLE_R, tuple(AX), _rel(REST_L), POLE_L),
    "victory": (_rel(REST_R), POLE_R, tuple(AX), _rel(REST_L), POLE_L),
}
MOTION = anim.motion_profile(weight="light", weapon="one_hand", stance="low", run_ref_speed=3.5, blocks=BLOCKS,
                             cadence=0.8, arm_swing=0.8)
RUN_LEAN = anim.P(hips=(3.0, 0, 0), spine=(1.5, 0, 0), chest=(0.5, 0, 0), neck=(-2.0, 0, 0), head=(-3.0, 0, 0))


def _rolled(p: dict, up=UP) -> dict:
    """the generator's plain aims -> AimRoll (the dart stays on top of the thrower)"""
    ik = p.get("ik")
    if ik and "aim.R" in ik and not isinstance(ik["aim.R"], AimRoll):
        a = ik["aim.R"]
        p = dict(p)
        p["ik"] = dict(ik)
        p["ik"]["aim.R"] = AimRoll(a.dir, a.weight, tuple(up))
    return p


def gen_run() -> anim.Clip:
    c = anim.gen_run(MOTION)
    base = c.sample

    def sample(t):
        return _rolled(anim.add(base(t), RUN_LEAN))
    return anim.Clip("run", c.frames, True, sample, meta=c.meta)


def run_pose(q: float) -> dict:
    """the run's pose at cycle phase q (cast_ult ends in it)"""
    return gen_run().sample(q % 1.0)


def gen_idle() -> anim.Clip:
    base = G()
    N = 72

    def sample(t):
        b = anim.osc(t, 2)
        s = anim.osc(t, 1, 0.1)
        d = anim.P(chest=(1.2 * b, 0, 0), spine=(0.5 * b, 0, 0.6 * s), neck=(-0.8 * b, 0, 0), head=(-0.4 * b, 2.0 * s, 0),
                   shoulder_L=(0, 0, 1.2 * b), shoulder_R=(0, 0, -1.2 * b), hips=(0, 1.2 * s, -1.0 * s))
        p = anim.add(base, d)
        dz = 0.008 * anim.osc(t, 2, 0.08)
        p = anim._nudge_hands(p, (0.0, 0.0, dz), (0.0, 0.0, dz))
        return anim._with_hips(p, (0.010 * s, 0.0, -0.004 * (0.5 + 0.5 * b)))

    return anim.Clip("idle", N, True, sample)


# feet for steps
FEET_BACK = feet_(l=(0.03, -0.10, 0.0), r=(-0.03, 0.12, 0.0), yl=4.0, yr=-18.0)
FEET_LUNGE = feet_(l=(0.05, -0.36, 0.0), r=(-0.03, 0.14, 0.0), yl=2.0, yr=-16.0, pr=-18.0)
FEET_LIFT = feet_(l=(0.04, -0.26, 0.09), r=(-0.03, 0.14, 0.0), yl=2.0, yr=-16.0, pl=12.0, pr=-12.0)
FEET_SIDE = feet_(l=(0.06, -0.14, 0.0), r=(-0.05, 0.10, 0.0), yl=10.0, yr=-16.0)


def gen_attack1() -> anim.Clip:
    """a quick overhand throw: the thrower cocked beside the head, the dart along it pointing at the target, the
    left hand aiming; whipped forward at f8, the dart leaves from the tip; follow-through across the body"""
    wind = pz(lean=0.0, yaw=-20.0, drop=0.045, dy=0.03, feet=FEET_BACK,
              R=rh((-0.20, 0.05, 0.04), aim=(0.10, -0.92, 0.38), up=(0.0, 0.38, 0.92), pole=(-1.0, 0.1, -0.15)),
              L=lh((0.02, -0.42, -0.04), pole=(0.8, 0.2, -0.5)))
    hit = pz(lean=13.0, yaw=16.0, drop=0.055, dy=-0.04, feet=FEET_BACK,
             R=rh((-0.02, -0.40, 0.08), aim=(0.02, -1.0, 0.04), pole=(-0.8, 0.2, -0.5)),
             L=lh((0.10, -0.18, -0.34)))
    fol = pz(lean=16.0, yaw=24.0, drop=0.05, dy=-0.05, feet=FEET_BACK,
             R=rh((0.08, -0.38, -0.18), aim=(0.30, -0.85, -0.42), pole=(-0.7, 0.3, -0.6)),
             L=lh((0.16, 0.02, -0.45)))
    return strike("attack1", 20, wind, hit, fol)


def gen_attack2() -> anim.Clip:
    """a sidearm throw with a half-step of weight: the thrower swept back at the right hip, slung flat across"""
    wind = pz(lean=6.0, yaw=-26.0, drop=0.05, dy=0.03, feet=FEET0,
              R=rh((-0.30, 0.08, -0.22), aim=(-0.15, -0.98, 0.05), pole=(-0.6, 0.6, -0.5)),
              L=lh((0.04, -0.40, -0.16)))
    hit = pz(lean=10.0, yaw=16.0, drop=0.07, dy=-0.06, feet=FEET0,
             R=rh((-0.12, -0.42, -0.15), aim=(0.30, -0.95, 0.0), pole=(-0.8, 0.2, -0.5)),
             L=lh((0.15, -0.05, -0.40)))
    fol = pz(lean=12.0, yaw=26.0, drop=0.065, dy=-0.06, feet=FEET0,
             R=rh((0.10, -0.36, -0.24), aim=(0.85, -0.50, -0.12), pole=(-0.7, 0.3, -0.6)),
             L=lh((0.18, 0.05, -0.44)))
    return strike("attack2", 20, wind, hit, fol)


def gen_hurl() -> anim.Clip:
    """cast_a1 Hurl, 30 f, the dart leaves at f12: the long bar drawn back over the shoulder with the weight on the
    back foot and the left arm pointing at the target, whipped forward into a long step, the front knee bent"""
    g = G()
    wind = pz(lean=-5.0, yaw=-30.0, drop=0.06, dy=0.07, feet=FEET_BACK,
              R=rh((-0.22, 0.06, 0.02), aim=(0.14, -0.86, 0.48), up=(0.0, 0.48, 0.88), pole=(-1.0, 0.15, -0.1)),
              L=lh((0.0, -0.47, 0.02), pole=(0.7, 0.2, -0.6)))
    coil = pz(lean=-7.0, yaw=-34.0, drop=0.065, dy=0.08, feet=FEET_BACK,
              R=rh((-0.24, 0.09, 0.02), aim=(0.15, -0.84, 0.52), up=(0.0, 0.52, 0.85), pole=(-1.0, 0.15, -0.1)),
              L=lh((0.0, -0.48, 0.04), pole=(0.7, 0.2, -0.6)))
    drive = pz(lean=4.0, yaw=-6.0, drop=0.07, dy=0.0, feet=FEET_LIFT,
               R=rh((-0.18, -0.10, 0.10), aim=(0.10, -0.94, 0.32), up=(0.0, 0.3, 0.95), pole=(-1.0, 0.1, -0.2)),
               L=lh((0.05, -0.36, -0.10)))
    hit = pz(lean=16.0, yaw=22.0, drop=0.11, dy=-0.12, feet=FEET_LUNGE,
             R=rh((-0.02, -0.42, 0.10), aim=(0.02, -1.0, 0.05), pole=(-0.8, 0.2, -0.5)),
             L=lh((0.12, -0.16, -0.34)))
    hold = anim._with_hips(anim.lerp_pose(hit, pz(lean=20.0, yaw=28.0, drop=0.12, dy=-0.13, feet=FEET_LUNGE,
                                                  R=rh((0.08, -0.40, -0.10), aim=(0.20, -0.92, -0.25)),
                                                  L=lh((0.16, 0.0, -0.42))), 0.4), (0, 0, -0.005))
    fol = pz(lean=22.0, yaw=30.0, drop=0.11, dy=-0.12, feet=FEET_LUNGE,
             R=rh((0.12, -0.36, -0.22), aim=(0.35, -0.80, -0.48), pole=(-0.7, 0.3, -0.6)),
             L=lh((0.18, 0.04, -0.45)))
    back = anim.lerp_pose(fol, g, 0.5)
    back["ik"].update(feet_(l=(0.04, -0.22, 0.08), r=(-0.02, 0.10, 0.0), pl=10.0))
    keys = [(0.0, g, "linear"), (0.10, anim._with_hips(anim.lerp_pose(g, wind, -0.08), (0, 0, -0.01)), "inout"),
            (0.27, wind, "inout"), (0.33, coil, "out"), (0.37, drive, "in"), (anim.IMPACT, hit, "accel"),
            (0.47, hold, "out"), (0.62, fol, "out"), (0.82, back, "inout"), (1.0, g, "settle")]
    return clip("cast_a1", 30, keys, impact=anim.IMPACT, lags={"head": 1.5, "neck": 1.0})


def gen_bound() -> anim.Clip:
    """cast_a2 Bound, 15 f, apex f6: a skip-step dip, then a long leap (left knee up, the right leg trailing, both
    arms spread, the thrower level), landing already running"""
    g = G()
    dip = pz(lean=18.0, drop=0.11, dy=-0.02, feet=feet_(l=(0.03, -0.10, 0.0), r=(-0.02, 0.10, 0.0), pr=-10.0),
             R=rh((-0.10, 0.18, -0.36), aim=(0.20, -0.96, -0.15)), L=lh((0.10, 0.22, -0.40)))
    apex = pz(lean=16.0, drop=-0.30, dy=-0.06, feet=feet_(l=(0.03, -0.28, 0.50), r=(-0.03, 0.40, 0.36), pl=25.0,
                                                           pr=-45.0),
              R=rh((-0.38, 0.06, -0.12), aim=(0.15, -0.97, 0.12)), L=lh((0.40, -0.18, -0.02), pole=(0.6, 0.6, -0.3)))
    land = pz(lean=16.0, drop=0.09, dy=-0.10, feet=feet_(l=(0.03, -0.30, 0.0), r=(-0.03, 0.30, 0.05), pr=-35.0),
              R=rh((-0.05, -0.20, -0.40), aim=(0.20, -0.96, -0.16)), L=lh((0.12, 0.25, -0.42)))
    end = anim._with_hips(run_pose(0.25), (0.0, 0.0, 0.0))
    keys = [(0.0, g, "linear"), (0.13, dip, "inout"), (0.4, apex, "out"), (0.73, land, "in"), (1.0, end, "inout")]
    return clip("cast_a2", 15, keys, impact=anim.IMPACT, lags={"head": 1.0})


def gen_hamstring() -> anim.Clip:
    """cast_a3 Hamstring Dart, 20 f, flick at f8: the left hand snaps a short dart from the quiver's mouth over the
    right shoulder, flicks it low and sidearm, the body dipping into a crouch; the thrower stays level"""
    g = G()
    reach = pz(lean=6.0, yaw=12.0, drop=0.05, look=(6.0, -18.0, 0.0),
               R=rh((-0.10, -0.12, -0.40), aim=(0.70, -0.71, -0.05)),
               L=lh((-0.30, 0.06, 0.12), pole=(0.5, -0.6, 0.5)))
    draw = pz(lean=8.0, yaw=8.0, drop=0.07, look=(4.0, -10.0, 0.0),
              R=rh((-0.10, -0.12, -0.40), aim=(0.70, -0.71, -0.05)),
              L=lh((-0.22, -0.10, 0.06), pole=(0.6, -0.5, 0.4)))
    flick = pz(lean=20.0, yaw=-14.0, drop=0.16, dy=-0.03, look=(8.0, 0.0, 0.0), feet=FEET_SIDE,
               R=rh((-0.14, -0.08, -0.40), aim=(0.70, -0.71, -0.05)),
               L=lh((0.26, -0.40, -0.30), pole=(0.6, 0.6, -0.4)))
    fol = pz(lean=18.0, yaw=-22.0, drop=0.15, dy=-0.03, feet=FEET_SIDE,
             R=rh((-0.14, -0.06, -0.40), aim=(0.70, -0.71, -0.05)),
             L=lh((0.38, -0.28, -0.30), pole=(0.6, 0.6, -0.4)))
    keys = [(0.0, g, "linear"), (0.25, reach, "inout"), (0.32, draw, "in"), (anim.IMPACT, flick, "accel"),
            (0.55, fol, "out"), (0.78, anim.lerp_pose(fol, g, 0.55), "inout"), (1.0, g, "settle")]
    return clip("cast_a3", 20, keys, impact=anim.IMPACT, lags={"head": 1.0})


def gen_long_run() -> anim.Clip:
    """cast_ult Long Run, 25 f, burst at f10: a deep breath and a coiled crouch (a short moving hold), then the first
    two strides burst out; the clip ends in the run's own stride so it flows straight into `run`"""
    g = G()
    breath = pz(lean=4.0, drop=0.02, look=(-6.0, 0.0, 0.0))
    coil = pz(lean=30.0, drop=0.17, dy=0.02, feet=feet_(l=(0.03, -0.16, 0.0), r=(-0.03, 0.24, 0.0), pr=-30.0),
              R=rh((-0.04, -0.08, -0.40), aim=(0.20, -0.96, -0.15)), L=lh((0.08, 0.18, -0.42)))
    coil2 = anim._with_hips(anim.lerp_pose(g, coil, 1.06), (0, 0, -0.006))
    burst = pz(lean=24.0, drop=0.06, dy=-0.12, feet=feet_(l=(0.03, 0.18, 0.02), r=(-0.03, -0.34, 0.24), pl=-40.0,
                                                         pr=-8.0),
               R=rh((-0.03, 0.02, -0.42), aim=(0.22, -0.95, -0.18)), L=lh((-0.10, -0.32, -0.30)))
    q0 = 0.45
    end = run_pose(q0)
    mid = run_pose(q0 - 0.25)
    keys = [(0.0, g, "linear"), (0.10, breath, "inout"), (0.22, coil, "inout"), (0.33, coil2, "out"),
            (anim.IMPACT, burst, "snap"), (0.70, mid, "inout"), (1.0, end, "linear")]
    return clip("cast_ult", 25, keys, impact=anim.IMPACT, lags={"head": 1.0})


def gen_death(skel) -> anim.Clip:
    """struck, she staggers, drops to her knees and falls forward onto her front, the thrower flat beside her right
    hand and the crest of darts spilling up and back (never into the ground)"""
    g = G()
    hip_h = skel.rest_point("hips").z
    recoil = pz(lean=-10.0, yaw=8.0, drop=0.04, dy=0.06, look=(-12.0, 0.0, 0.0),
                R=rh((-0.10, -0.05, -0.42), aim=(0.6, -0.6, -0.5)), L=lh((0.20, 0.0, -0.40)))
    stagger = pz(lean=14.0, yaw=-6.0, drop=0.10, dy=-0.05, feet=feet_(l=(0.03, -0.22, 0.0), r=(-0.02, 0.06, 0.0)),
                 R=rh((-0.06, -0.10, -0.42), aim=(0.5, -0.7, -0.5)), L=lh((0.16, -0.20, -0.36)))
    kneel = anim.merge(anim.arms_relaxed(), anim.P(hips=(10, -4, 0), spine=(12, 0, 0), chest=(12, 0, 0), neck=(4, 0, 0),
                                                   head=(10, 0, 0), toe_L=(55, 0, 0), toe_R=(55, 0, 0)))
    kneel["hips_loc"] = (0.0, 0.04, -hip_h * 0.44)
    kneel["ik"] = dict(feet_(l=(0.02, 0.30, 0.05), r=(-0.02, 0.32, 0.05), pl=-60.0, pr=-60.0, yl=0.0, yr=0.0))
    kneel["ik"].update(rh((-0.06, -0.20, -0.40), aim=(0.4, -0.8, -0.45)))
    kneel["ik"].update(lh((0.10, -0.28, -0.38)))
    down = anim.merge(anim.arms_relaxed(), anim.P(hips=(84, 6, 0), spine=(4, 0, 0), chest=(2, 0, 0), neck=(-24, 0, 0),
                                                  head=(-10, 50, 0), thigh_L=(4, 0, 4), shin_L=(-6, 0, 0),
                                                  foot_L=(-55, 0, 0), thigh_R=(6, 0, -10), shin_R=(-6, 0, 0),
                                                  foot_R=(-55, 0, 0), upper_arm_L=(-30, 0, 20), forearm_L=(30, 0, 0)))
    down["hips_loc"] = (0.0, -0.10, -hip_h + 0.17)
    down["ik"] = {"hand.R": HT(pos=(-0.42, -0.95, 0.06), pole=(-0.6, 0.2, 1.0)),
                  "aim.R": AimRoll((0.25, -0.97, 0.0), 1.0, (0.0, 0.0, 1.0))}
    bounce = anim.add(down, anim.P(spine=(-5, 0, 0), chest=(-4, 0, 0), head=(-6, 0, 0)))
    bounce["hips_loc"] = (0.0, -0.10, -hip_h + 0.20)
    rest = anim.add(down, anim.P(head=(0, 4, 0)))
    N = 45
    keys = [(0.0, g, "linear"), (0.10, recoil, "snap"), (0.30, stagger, "inout"), (0.50, kneel, "inout"),
            (0.70, down, "in"), (0.78, bounce, "out"), (0.88, rest, "inout"), (1.0, rest, "linear")]
    return clip("death", N, keys)


def gen_recall() -> anim.Clip:
    """recall (loops): the thrower set down level across her front, she counts the darts in her quiver one by
    one with the left hand over the right shoulder, head turned to them"""
    N = 90
    base = pz(lean=4.0, drop=0.02, look=(4.0, -14.0, 0.0), R=rh((-0.04, -0.20, -0.40), aim=(0.92, -0.25, -0.30)))

    def sample(t):
        k = 0.5 - 0.5 * math.cos(2 * math.pi * t)                       # 0 at the loop seam -> 1 mid-loop
        tap = 0.5 + 0.5 * math.sin(2 * math.pi * 3 * t)                 # three darts touched
        lw = np.array(REST_L) * (1 - k) + np.array((-0.28 + 0.06 * tap, 0.06, 0.12 + 0.03 * tap)) * k
        p = anim.merge(base, {"ik": lh(tuple(lw), pole=(0.6 * k + 0.85 * (1 - k), -0.5 * k + 0.35 * (1 - k),
                                                        0.4 * k - 0.25 * (1 - k)))})
        p = anim.add(p, anim.P(chest=(1.0 * anim.osc(t, 2), 4.0 * k, 0), head=(0, -10.0 * k + 3 * tap * k, 0)))
        return p

    return anim.Clip("recall", N, True, sample)


def gen_idle_lobby() -> anim.Clip:
    """she cannot stand still: a light jog in place, a thumb along the darts in her quiver, a glance at the far
    horizon, a long stride and back, then a look at the camera with her head on one side (90 f, closed loop)"""
    N = 90
    g = G(drop=0.03)

    def seg(t, a, b):
        return min(1.0, max(0.0, (t - a) / (b - a)))

    def sample(t):
        p = dict(g)
        p["ik"] = dict(g["ik"])
        # 0-0.32 jog in place: the feet alternate, a light bob
        if t < 0.32:
            u = seg(t, 0.0, 0.32)
            env = math.sin(math.pi * u)
            ph = 2 * math.pi * 3 * u
            hl = max(0.0, math.sin(ph)) * 0.07 * env
            hr = max(0.0, -math.sin(ph)) * 0.07 * env
            p["ik"]["foot.L"] = FT((0.02, -0.07, hl), 18.0 * hl / 0.07 * -1, 3.0)
            p["ik"]["foot.R"] = FT((-0.02, 0.08, hr), 18.0 * hr / 0.07 * -1, -12.0)
            p = anim._with_hips(p, (0.0, 0.0, -0.02 * env + 0.012 * abs(math.sin(ph)) * env))
        # 0.30-0.52 the left thumb along the quiver darts
        k = math.sin(math.pi * seg(t, 0.30, 0.52)) if 0.30 < t < 0.52 else 0.0
        if k > 0:
            lw = np.array(REST_L) * (1 - k) + np.array((-0.27, 0.05, 0.11)) * k
            p["ik"].update(lh(tuple(lw), pole=(0.85 - 0.25 * k, 0.35 - 0.85 * k, -0.25 + 0.65 * k)))
            p = anim.add(p, anim.P(head=(0, -16.0 * k, 0), chest=(0, 4.0 * k, 0)))
        # 0.52-0.74 a glance at the far horizon (to her left), shading the eyes is the victory's
        g2 = math.sin(math.pi * seg(t, 0.50, 0.74)) if 0.50 < t < 0.74 else 0.0
        if g2 > 0:
            p = anim.add(p, anim.P(neck=(-3 * g2, 14 * g2, 0), head=(-5 * g2, 24 * g2, 0), chest=(0, 6 * g2, 0)))
        # 0.72-1.0 a look at the camera, the head on one side
        c = math.sin(math.pi * seg(t, 0.72, 1.0)) if t > 0.72 else 0.0
        if c > 0:
            p = anim.add(p, anim.P(head=(-4 * c, 0, -16 * c), neck=(0, 0, -5 * c), hips=(0, 5 * c, 0)))
        b = anim.osc(t, 3)
        p = anim.add(p, anim.P(chest=(0.8 * b, 0, 0)))
        return p

    return anim.Clip("idle_lobby", N, True, sample)


def gen_victory() -> anim.Clip:
    """a skid to a stop, the thrower brought up over her right shoulder, one dart raised; the left hand shades her
    eyes toward the horizon, a quarter turned from the camera: already looking for the next hill (45 f, hold)"""
    g = G()
    skid = pz(lean=-6.0, yaw=10.0, drop=0.13, dy=0.05, feet=feet_(l=(0.06, -0.30, 0.0), r=(-0.04, 0.18, 0.0), pl=18.0,
                                                                yl=14.0, yr=-30.0),
              R=rh((-0.18, 0.02, -0.34), aim=(0.30, -0.90, 0.30)), L=lh((0.30, -0.10, -0.25)))
    settle = anim._with_hips(anim.lerp_pose(skid, g, 0.35), (0, 0, -0.01))
    hold = pz(lean=2.0, yaw=24.0, drop=0.03, look=(-6.0, 22.0, 0.0),
              feet=feet_(l=(0.05, -0.16, 0.0), r=(-0.04, 0.12, 0.0), yl=24.0, yr=0.0),
              R=rh((-0.10, -0.06, 0.06), aim=(0.30, 0.30, 0.90), up=(0.0, -0.95, 0.30), pole=(-0.9, 0.2, -0.4)),
              L=lh((-0.10, -0.22, 0.33), pole=(0.9, -0.1, -0.4)))
    keys = [(0.0, g, "linear"), (0.16, skid, "out"), (0.36, settle, "inout"), (0.62, hold, "out"), (1.0, hold, "linear")]
    base = anim.drag(anim.keyed(keys), 45, {"head": 2.0, "neck": 1.0})

    def sample(t):
        p = base(t)
        if t > 0.62:
            k = min(1.0, (t - 0.62) / 0.15)
            p = anim.add(p, anim.P(chest=(0.8 * k * anim.osc(t, 2), 0, 0)))
        return p

    return anim.Clip("victory", 45, False, sample)


def gen_taunt() -> anim.Clip:
    """taps the thrower twice on her shoulder and nods at the horizon"""
    g = G()
    up_ = pz(lean=3.0, yaw=8.0, drop=0.03, R=rh((-0.08, -0.06, 0.02), aim=(0.30, 0.25, 0.92), up=(0.0, -0.95, 0.3),
                                               pole=(-0.9, 0.1, -0.4)),
             L=lh((0.12, -0.04, -0.46)))
    tap = pz(lean=3.0, yaw=8.0, drop=0.035, R=rh((-0.08, -0.04, -0.02), aim=(0.30, 0.38, 0.87), up=(0.0, -0.92, 0.38),
                                                pole=(-0.9, 0.1, -0.4)),
             L=lh((0.12, -0.04, -0.46)))
    nod = anim.add(up_, anim.P(head=(12, 18, 0), neck=(4, 8, 0)))
    keys = [(0.0, g, "linear"), (0.22, up_, "inout"), (0.32, tap, "in"), (0.40, up_, "out"), (0.48, tap, "in"),
            (0.56, up_, "out"), (0.70, nod, "inout"), (0.80, up_, "inout"), (1.0, g, "inout")]
    return clip("taunt", 60, keys, lags={"head": 1.5})


def gen_dash() -> anim.Clip:
    """the Bound's leap as its own short clip (the follow-through of cast_a2): airborne, arms spread, landing"""
    g = G()
    air = pz(lean=18.0, drop=-0.20, dy=-0.04, feet=feet_(l=(0.03, -0.26, 0.40), r=(-0.03, 0.38, 0.30), pl=22.0,
                                                          pr=-45.0),
             R=rh((-0.36, 0.06, -0.14), aim=(0.15, -0.97, 0.10)), L=lh((0.38, -0.16, -0.04), pole=(0.6, 0.6, -0.3)))
    land = pz(lean=16.0, drop=0.09, dy=-0.08, feet=feet_(l=(0.03, -0.26, 0.0), r=(-0.03, 0.28, 0.05), pr=-30.0),
              R=rh((-0.05, -0.20, -0.40), aim=(0.20, -0.96, -0.16)), L=lh((0.12, 0.22, -0.42)))
    keys = [(0.0, g, "linear"), (0.30, air, "out"), (0.70, land, "in"), (1.0, g, "inout")]
    return clip("dash", 15, keys)


def gen_stunned() -> anim.Clip:
    base = pz(lean=12.0, drop=0.07, look=(14.0, 0.0, 0.0), R=rh((-0.04, -0.10, -0.46), aim=(0.6, -0.5, -0.62)),
              L=lh((0.10, -0.05, -0.48)))
    N = 40

    def sample(t):
        a, b = anim.osc(t, 1), anim.osc(t, 1, 0.25)
        return anim.add(base, anim.P(hips=(0, 0, 4 * a), spine=(3 * b, 0, -3 * a), chest=(3 * b, 0, -3 * a),
                                     neck=(6 * b, 0, 6 * a), head=(8 * b, 4 * a, 8 * a)))

    return anim.Clip("stunned", N, True, sample)


def gen_channel() -> anim.Clip:
    base = pz(lean=6.0, drop=0.04, L=lh((0.02, -0.46, -0.10), pole=(0.8, 0.2, -0.5)))
    N = 40

    def sample(t):
        p = anim.add(base, anim.P(chest=(1.2 * anim.osc(t, 2), 0, 0), head=(-0.8 * anim.osc(t, 2), 0, 0)))
        return anim._nudge_hands(p, (0, 0, 0.006 * anim.osc(t, 2)), (0, 0.008 * anim.osc(t, 1), 0.01 * anim.osc(t, 2, 0.2)))

    return anim.Clip("channel", N, True, sample)


def clip_overrides(ctx) -> dict:
    skel = anim.Skeleton(ctx.info.armature)
    return {"idle": gen_idle(), "run": gen_run(), "attack1": gen_attack1(), "attack2": gen_attack2(),
            "cast_a1": gen_hurl(), "cast_a2": gen_bound(), "cast_a3": gen_hamstring(), "cast_ult": gen_long_run(),
            "death": gen_death(skel), "recall": gen_recall(), "idle_lobby": gen_idle_lobby(),
            "victory": gen_victory(), "dash": gen_dash(), "stunned": gen_stunned(), "channel": gen_channel(),
            "taunt": gen_taunt()}


def model(ctx) -> list:
    P = []
    extra = (ctx.skin or {}).get("extra") or {}
    items = sculpts() + skin_extras(extra)
    for name, S, vs, role, bind, tris, uvw in items:
        v, q = S.mesh(VOXEL * vs)
        ob = sdf.to_object(f"{name}_high", v, q, ctx.col)
        ob.data.materials.append(ctx.mats[role])
        P.append(fighter.Part(name, high=ob, tris=tris, bind=bind, uv_weight=uvw))
    return P


if __name__ == "__main__":
    fighter.main(sys.modules[__name__])
