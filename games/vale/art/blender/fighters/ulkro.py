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
# the rims at Kemdo's strengths (FIX PASS 1, review: 'the shin wraps and boots come out near-white'): the splash's
# low back rims put a grazing white sheen over the dark wraps and boots at full strength
# (final parity client F3: fill 0.88 -> 0.94, the figure at 0.81 of the splash's height, 0.68 of W2's loading card)
SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92, "fill": 0.94, "yaw": 22.0, "rim_cool": 0.35, "rim_warm": 0.45}
# PER-SKIN CARDS (closing review ULK-M1; schema: art/blender/portraits.py header). Each card is its own moment, the crest
# of darts fanning to screen-right (the camera on her right side): base: the Hurl's draw on the high rim at dusk, low
# stride, the thrower drawn back, the laid dart's dawnglass catching the low sun as the key; Highrim: Bound's leap
# off the strata cliff at noon, side-lit hard from high on her left; Long Evening: the victory turn with the lacquer
# fan, backlit by the festival lanterns (a warm rim pair, a soft lantern focal on the face). Portraits derive from
# each card's frame and light (closer lens).
CARDS = {
    "ulkro": {
        "splash": {"clip": "cast_a1", "t": 0.50, "yaw": 8.0, "pitch": -5.0, "lens": 50.0, "fill": 0.86, "x": 0.70,
                   "key_az": 205.0, "key_el": 14.0, "key_color": "#FFD2A0", "sun": 3.2, "rim_cool": 1.0,
                   "rim_warm": 1.4, "bounce": 0.55, "bounce_color": "#D8A47A", "accent": 1.6, "exposure": -0.5,
                   "focal": [{"at": "x_dart_tip", "az": 200.0, "el": 15.0, "dist": 0.6, "color": "#FFE6C0",
                              "power": 55.0, "size": 0.25},
                             {"at": "head", "az": 170.0, "el": 10.0, "dist": 0.8, "color": "#FFDCB8", "power": 26.0,
                              "size": 0.3}]},
        "portrait": {"yaw": 14.0, "lens": 70.0},
        "plate": {"glow": [0.22, 0.56, 0.42, 0.10], "glow_color": "#F2C496"},
    },
    "ulkro_highrim": {
        "splash": {"clip": "cast_a2", "t": 0.45, "yaw": -24.0, "pitch": -6.0, "lens": 50.0, "fill": 0.84, "x": 0.70,
                   "key_az": 120.0, "key_el": 58.0, "key_color": "#FFF6E6", "sun": 3.6, "rim_cool": 1.5,
                   "rim_warm": 0.5, "bounce": 0.5, "bounce_color": "#E6D8BE", "accent": 1.4, "exposure": -0.6,
                   "focal": [{"at": "head", "az": 150.0, "el": 25.0, "dist": 0.8, "color": "#FFF2E0", "power": 24.0,
                              "size": 0.3}]},
        "portrait": {"yaw": -22.0, "lens": 70.0},
        "plate": {"glow": [0.55, 0.30, 0.50, 0.08], "glow_color": "#F6EEDC", "sat": 0.85},
    },
    "ulkro_long_evening": {
        "splash": {"clip": "victory", "t": 0.55, "yaw": 34.0, "pitch": -4.0, "lens": 52.0, "fill": 0.86, "x": 0.70,
                   "key_az": 160.0, "key_el": 20.0, "key_color": "#E6D6EE", "sun": 2.6, "rim_cool": 1.2,
                   "rim_warm": 1.6, "bounce": 0.6, "bounce_color": "#E8A866", "accent": 1.5, "exposure": -0.55,
                   "focal": [{"at": "head", "az": 200.0, "el": 0.0, "dist": 0.8, "color": "#FFC890", "power": 30.0,
                              "size": 0.35},
                             {"at": "x_quiver", "az": 20.0, "el": 20.0, "dist": 0.9, "color": "#FFB070",
                              "power": 40.0, "size": 0.4}]},
        "portrait": {"yaw": 30.0, "lens": 70.0},
        "plate": {"glow": [0.30, 0.62, 0.45, 0.10], "glow_color": "#F0A866"},
    },
}
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
    # Highrim: the named sandstone #CDBB9C (hue 38, 24 %) on the hood AND the sleeve wraps (the brief's "sandstone
    # wraps"); those parts land on SKIN_TONE (below: a warm mid sandstone, the albedo three.js renders as the named hex,
    # never a pale hood), the rest takes the brief's own change
    {"id": "ulkro_highrim", "extra": {}, "card": {"primary": "#8E8068", "secondary": "#E0D8C6"},
     "palette": _skin_pal({"sandstone": "#CDBB9C"}, {"wood": "#E0D8C6", "cloth": "#85796A", "stone": "#BDB6A8"})},
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
Q_TOP = np.array([-0.18, 0.17, 1.585])
Q_BOT = np.array([0.215, 0.165, 1.075])
Q_U = _n(Q_TOP - Q_BOT)                              # up the quiver
Q_N = _n(np.array([0.0, 1.0, 0.0]) - Q_U * Q_U[1])  # out from her back
Q_W = np.cross(Q_U, Q_N)                             # across the quiver (in the back's plane)
Q_HW, Q_HD = 0.078, 0.048                            # half width / half depth of the tube
# the five crest darts: (tilt toward her right, tilt forward (-) / back (+), base offset across the mouth, length).
# FIX PASS 1 (review: 'one tight bundle, the tips touch the HP bar'): solved numerically at the game camera
# (scratchpad crest_eval: a tip at height h, horizontal distance r from the unit's axis, reaches h*50.5 + r*64.7 px in
# its worst facing; the bar's lower edge is (art.height + 0.35)*50.5 - 12 px, and art.height must stay the bind-pose
# mesh top +- 6 cm (three_load_test)). A fan that leans out to her right always rises into the bar when her right side
# faces away, so the trade is explicit: the fan keeps the concept's spread over the right shoulder (2-37 degrees, 8-9
# apart) with the outer darts progressively shorter and lower (tips 2.02 -> 1.77 m), and the darts stagger back /
# forward in two rows across the mouth, so the five tips separate in every facing (lanes 11.2 / 3.4 px, front 6.6, back
# 7.9; were 7.3 / 2.2 / 7.4 / 4.6) while the worst lane facing sits 7 px lower than before (-7 vs -15 px against the
# bar's lower edge; ART_HEIGHT_PAD lifts the bar 2 px more inside the load test's tolerance).
CREST = [(2.0, 12.0, -0.045, 0.55), (10.0, -8.0, -0.022, 0.52), (19.0, 14.0, 0.0, 0.48), (28.0, -12.0, 0.022, 0.46),
         (37.0, 6.0, 0.045, 0.43)]
CREST_DEPTH = (-0.012, 0.012, -0.012, 0.012, -0.012)   # the two rows across the quiver's mouth (out from her back)
ART_HEIGHT_PAD = 0.04       # FighterArt.height = mesh top + 4 cm (the HP bar's anchor - 0.35 m; the load test allows 6)
DART_R = 0.0135
HEAD_L, HEAD_W, HEAD_T = 0.17, 0.037, 0.0065         # the leaf head: length, half width, half thickness
CREST_HEAD_TWIST = (-28.0, 14.0, -12.0, 26.0, 0.0)
LAID_HEAD = 1.40                                      # the laid dart's head scale (the widest single read, chest height)   # each crest leaf's face turned about its shaft (deg)


def crest_dart(i):
    """(base inside the quiver, unit direction, tip) of crest dart i"""
    a, b, off, L = CREST[i]
    d = _n([-math.tan(math.radians(a)), math.tan(math.radians(b)), 1.0])
    base = Q_TOP - Q_U * 0.16 + Q_W * off + Q_N * CREST_DEPTH[i]
    return base, d, base + d * L


def crest_pivot(i):
    """where crest dart i crosses the quiver's mouth (its bone's head: it pivots there when the darts spill)"""
    base, d, _tip = crest_dart(i)
    return base + d * (0.16 / max(float(d @ Q_U), 0.2))


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


def soft_folds(amp, freq, axis=0, phase=0.0):
    """folds() without the |sin| cusp: rounded swells and valleys, no creased line"""
    def fn(P):
        u = P[:, axis] * freq + phase + 0.7 * NOISE(P, 3.0)
        return amp * 0.5 * np.sin(u)
    return fn


def hfolds(amp, freq, phase=0.0, tilt=(0.0, 0.0)):
    """horizontal-ish wrapped folds (the face wrap, the cowl): ridges along Z, tilted by x / y"""
    def fn(P):
        u = (P[:, 2] + tilt[0] * P[:, 0] + tilt[1] * P[:, 1]) * freq + phase + 0.5 * NOISE(P, 4.0)
        return amp * (np.abs(np.sin(u)) * 2.0 - 1.0) * -0.5
    return fn


def wrap_phase(P, a, u, e1, e2, pitch, slant, phase=0.0, vary=0.0):
    """the band phase of a wound wrap round the axis a + t u: `slant` bands advanced per turn (a diagonal wind), the
    band width varied along the limb by `vary` (each band its own width: a hand-wound strip, not a ribbed tube)"""
    q = P - a
    t = q @ u
    th = np.arctan2(q @ e2, q @ e1)
    return (t / pitch + slant * th / (2 * math.pi) + phase + 0.15 * NOISE(P, 6.0)
            + vary * np.sin(t / (pitch * 2.3) + 1.7 * phase))


def _wrap_axes(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    u = _n(b - a)
    e1 = _n(np.cross(u, [0.0, 0.0, 1.0]) if abs(u[2]) < 0.9 else np.cross(u, [1.0, 0.0, 0.0]))
    return a, u, e1, np.cross(u, e1)


def wraps(amp, pitch, a, b, slant=0.35, phase=0.0, overlap=False, vary=0.0):
    """helical cloth bands round the segment a -> b: ridges every `pitch` metres, crossing at `slant`.
    overlap (closing ULK-M3, 'ribbed tubes'): each band is a strip laid OVER the next one: it stands proud at its
    leading edge and tucks in under the following band (a step at every seam, not a symmetric rib)"""
    a, u, e1, e2 = _wrap_axes(a, b)

    def fn(P):
        ph = wrap_phase(P, a, u, e1, e2, pitch, slant, phase, vary)
        f = ph - np.floor(ph)
        if overlap:
            tuck = np.exp(-((f - 0.97) / 0.035) ** 2)
            return -amp * 0.9 * (1.0 - f) ** 1.4 + amp * 0.7 * tuck
        ridge = np.clip(1.0 - np.abs(f - 0.5) * 4.0, 0.0, 1.0)       # a soft ridge mid-band, grooves at the seams
        groove = np.exp(-((f - 0.02) / 0.05) ** 2) + np.exp(-((f - 1.02) / 0.05) ** 2)
        return -amp * 0.5 * ridge + amp * groove
    return fn


# closing ULK-M3: the sleeve and shin wraps wound DIAGONALLY (the concept's crossing bands), varied widths
SLEEVE_WRAP = dict(slant=5.0, vary=0.35, overlap=True)   # (CW5 refix: 1.7 bands per turn laid ~15 deg off a ring; 5 lays them ~40 deg: a diagonal wind, integer so the seam meets)
SHIN_WRAP = dict(slant=6.0, vary=0.30, overlap=True)


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


# the hood's tail streamer: control points (spline), half widths, half thickness, twist (deg) along it
TAIL_PTS = [(0.03, 0.165, 1.716), (0.10, 0.212, 1.700), (0.175, 0.248, 1.668), (0.25, 0.272, 1.657),
            (0.315, 0.288, 1.676), (0.37, 0.300, 1.664)]
TAIL_W = (0.028, 0.032, 0.028, 0.022, 0.016, 0.0095)
TAIL_T = (0.0058, 0.0052, 0.0048, 0.0046, 0.0045, 0.0045)
TAIL_TWIST = (8.0, 30.0, 52.0, 40.0, 18.0, 6.0)


def _catmull(pts, n=56):
    P = np.asarray(pts, float)
    P = np.vstack([P[0] * 2 - P[1], P, P[-1] * 2 - P[-2]])
    out, prm = [], []
    seg = len(P) - 3
    for i in range(seg):
        p0, p1, p2, p3 = P[i], P[i + 1], P[i + 2], P[i + 3]
        for t in np.linspace(0.0, 1.0, n // seg, endpoint=(i == seg - 1)):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
            prm.append((i + t) / seg)
    return np.array(out), np.array(prm)


class _Ribbon(sdf.Prim):
    """a cloth ribbon swept along a spline: stadium cross-section (half width w, half thickness t, both
    interpolated along it), its width turned `twist` degrees about the path from the vertical; rounded ends"""

    def __init__(self, pts, w, t, twist):
        S, u = _catmull(pts)
        T = np.gradient(S, axis=0)
        T = T / np.linalg.norm(T, axis=1, keepdims=True)
        ku = np.linspace(0, 1, len(w))
        self.W = np.interp(u, ku, w)
        self.Th = np.interp(u, ku, t)
        tw = np.radians(np.interp(u, ku, twist))
        up = np.array([0.0, 0.0, 1.0])
        e1 = up[None] - T * (T @ up)[:, None]
        e1 = e1 / np.linalg.norm(e1, axis=1, keepdims=True)
        e2 = np.cross(T, e1)
        self.Sd = e1 * np.cos(tw)[:, None] + e2 * np.sin(tw)[:, None]
        self.Nm = np.cross(T, self.Sd)
        self.S, self.T = S, T

    def bounds(self):
        m = float(self.W.max()) + 0.01
        return self.S.min(0) - m, self.S.max(0) + m

    def d(self, P):
        out = np.empty(len(P))
        N = len(self.S)
        for c0 in range(0, len(P), 16384):
            p = P[c0:c0 + 16384]
            D2 = ((p[:, None, :] - self.S[None]) ** 2).sum(-1)
            i = np.argmin(D2, axis=1)
            q = p - self.S[i]
            a = (q * self.T[i]).sum(1)
            u = (q * self.Sd[i]).sum(1)
            v = (q * self.Nm[i]).sum(1)
            ea = np.where(i == 0, np.maximum(-a, 0.0), np.where(i == N - 1, np.maximum(a, 0.0), 0.0))
            du = np.maximum(np.abs(u) - (self.W[i] - self.Th[i]), 0.0)
            out[c0:c0 + 16384] = np.sqrt(du * du + v * v + ea * ea) - self.Th[i]
        return out


class _Band(sdf.Prim):
    """a flat band round an elliptical waist (radii rx, ry at its mid-thickness): rectangular section of half
    thickness t and half height h, edges rounded by `rr`; `tilt` (deg) dips it toward the front"""

    def __init__(self, c, rx, ry, t, h, rr=0.004, tilt=0.0):
        self.c = np.asarray(c, float)
        self.rx, self.ry, self.t, self.h, self.rr = rx, ry, t, h, rr
        self.tilt = math.tan(math.radians(tilt))

    def bounds(self):
        e = max(self.rx, self.ry) + self.t + 0.01
        return self.c - (e, e, self.h + 0.06), self.c + (e, e, self.h + 0.06)

    def d(self, P):
        q = P - self.c
        th = np.arctan2(q[:, 1] / self.ry, q[:, 0] / self.rx)
        R = np.hypot(self.rx * np.cos(th), self.ry * np.sin(th))
        r = np.hypot(q[:, 0], q[:, 1])
        zz = q[:, 2] - self.tilt * np.minimum(q[:, 1], 0.0)          # the front dips a little (worn low there)
        a = np.abs(r - R) - (self.t - self.rr)
        b = np.abs(zz) - (self.h - self.rr)
        return np.hypot(np.maximum(a, 0), np.maximum(b, 0)) + np.minimum(np.maximum(a, b), 0) - self.rr


# ── the sculpt ──────────────────────────────────────────────────────────────────────────────────────────
HEAD_C = np.array([0.0, -0.025, 1.69])
# the pauldrons (per tier): axis centre x (out from the spine), z, y; outer radius, thickness, the arc's start / end
# angle from vertical (deg, + = out over the arm), half depth (front-back), edge rounding, the depth's taper toward
# the outer end, the outline's corner radius
# FIX PASS 2 (review: 'at gameplay zoom her left pauldron reads as a large pale rectangular block ... like a box worn
# on the back'): the side view of a rectangular footprint was the box; each tier's outline is now a rounded shield
# (corners 4 cm, the depth narrowing 30 % toward the outer edge, 5 cm less deep), the stone a cool grey a step under
# the hood's lit crown (the concept's hue, not the quiver's warm linen; build 12 at the concept's pale value read as the
# whitest slab in game) with a darker bevel round every edge
PLATES = {"1": (0.200, 1.300, -0.004, 0.200, 0.021, -15.0, 62.0, 0.088, 0.006, 0.30, 0.040),
          "2": (0.250, 1.240, -0.004, 0.150, 0.019, 28.0, 84.0, 0.078, 0.006, 0.30, 0.034)}


def _plate_outline(P, sx, cx, cz, cy, R, t, a0, a1, hd, rr, taper, rc):
    """(2D distance to the tier's rounded, tapered outline on its arc surface (< 0 inside), radius, angle)"""
    vx = (P[:, 0] - sx * cx) * sx
    vz = P[:, 2] - cz
    r = np.hypot(vx, vz)
    ang = np.arctan2(vx, vz)
    a0, a1 = math.radians(a0), math.radians(a1)
    rm = R - t * 0.5
    S = (a1 - a0) * rm
    s = (ang - a0) * rm                                     # arc length from the inner (collar) end
    f = np.clip(s / S, 0.0, 1.0)
    hde = hd * (1.0 - taper * f ** 1.5)
    qs = np.abs(s - S * 0.5) - (S * 0.5 - rc)
    qy = np.abs(P[:, 1] - cy) - (hde - rc)
    d2 = np.hypot(np.maximum(qs, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qs, qy), 0) - rc
    return d2, r, ang


class _ArcPlate(sdf.Prim):
    """a curved slab: the shell between two cylinders whose axis runs front-back (Y), cut to a rounded, tapered
    outline on the arc (0 deg = straight up, + = outward on side sx); squared edges with a small rounding"""

    def __init__(self, sx, *prm):
        self.sx, self.prm = sx, prm
        self.cx, self.cz, self.cy, self.R, self.t = prm[:5]
        self.hd, self.rr = prm[7], prm[8]

    def bounds(self):
        e = self.R + 0.02
        x0 = self.sx * self.cx
        return np.array([x0 - e, self.cy - self.hd - 0.02, self.cz - e]), np.array([x0 + e, self.cy + self.hd + 0.02, self.cz + e])

    def d(self, P):
        d2, r, _ang = _plate_outline(P, self.sx, *self.prm)
        rr = self.rr
        dr = np.abs(r - (self.R - self.t * 0.5)) - (self.t * 0.5 - rr)
        q = np.stack([dr, d2 + rr], 1)
        return np.linalg.norm(np.maximum(q, 0), axis=1) + np.minimum(q.max(1), 0) - rr
HOOD_C = np.array([0.0, 0.005, 1.675])
BAND_Z, BAND_H = 1.712, 0.021        # the carved eye band's centre height and half height
BAND_R = (0.090, 0.108)              # its ring radii (x, y) round the head


# (CW5 round 3, minor:ulkro-seat-lumps) the simplifier can open the skirt's seat over the trousers again: after a build look at the rear of the sheet;
# the shipped base took art/tools/glb_part_inset.py ulkro --part legs --y-min 0.84 --y-max 1.12 --rear --by 0.018
# (CW5 round 3) a rebuild loses these art/tools/glb_paint_grade.mjs grades of the base GLB (masks: partmap_mask.py ulkro <part>):
# --q 70 --part-gain legs 0.68, wraps 1.27, cowl 0.96, hood 1.02, boots 1.05; re-run part_gamecam --named after a rebuild
def sculpts() -> list:
    """(name, Sculpt, voxel scale, material role, bind, tris, uv weight) in build order"""
    out = []

    def part(name, S, role, bind, tris, vs=1.0, uvw=1.0):
        out.append((name, S, vs, role, bind, tris, uvw))

    # HOOD (rigid on the head): a peaked shell with a deep face opening, the point trailing back
    hood = Sculpt("hood")
    # FIX PASS 2 (review: 'the dark diagonal notch on the right of the hood'): folds()'s |sin| cusp put a sharp crease
    # down her left side (x ~0.115); the hood's cloth swells in smooth sine folds instead
    hood.add(Ellipsoid(HOOD_C, (0.135, 0.168, 0.168)).displaced(soft_folds(0.0045, 22.0, axis=0, phase=0.6), 0.005), k=0.0)
    # the crown (owner ruling 7, closing ruling7:ulkro-crown): a ROUNDED cloth dome folding back, never a point. The
    # old peak (a round cone to a 3.4 cm tip at 1.826) fitted R 7.0 cm 3 cm under the top; this broad ellipsoid crown
    # (top 1.845, curvature radii 14.7 cm across / 19 cm front-to-back at its top) keeps the hood's height and its
    # backward lean into the trailing point
    hood.add(Ellipsoid(HOOD_C + (0.0, 0.040, 0.075), (0.118, 0.135, 0.095)), k=0.05)
    hood.add(RoundCone(HOOD_C + (0.0, 0.09, 0.03), (0.0, 0.175, 1.705), 0.06, 0.03), k=0.05)       # the trailing point
    hood.add(Ellipsoid(HOOD_C + (0.0, 0.02, -0.10), (0.142, 0.16, 0.06)), k=0.04)                   # flare to the cowl
    hood.sub(Ellipsoid(HOOD_C + (0.0, -0.005, 0.0), (0.112, 0.142, 0.142)), k=0.01)                  # the hollow
    hood.sub(Ellipsoid((0.0, -0.215, 1.676), (0.084, 0.13, 0.106)), k=0.012)                         # the face opening
    hood.inter(HalfSpace((0, 0, 1.555), (0, 0, -1), 1.0), k=0.02)
    part("hood", hood, "sandstone", "bone:head", 1750, uvw=1.6)
    # the tail (FIX PASS 1, review: 'a rigid sawtooth spike'): one smooth cloth streamer from the trailing point, flying
    # back and to her left in a soft S, twisting slowly, tapering to a rounded end (a spline swept ribbon, rigid on the
    # head as the brief asks; painted, not projected)
    tail = Sculpt("hood_tail")
    tail.add(_Ribbon(TAIL_PTS, TAIL_W, TAIL_T, TAIL_TWIST), k=0.0)
    # closing ULK-M2: the tail rides its own 2-bone chain off the head (x_tail_1-2, TAIL_CHAIN): it lags and flicks
    part("hood_tail", tail, "sandstone", "tail", 420, vs=0.55)

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
    # the beak (FIX PASS 2, review: 'a curved white specular sliver on the eye band'): the 8-16 mm round keel's flank
    # caught the sky behind the camera (a crisp sliver), a broad prow a soft grey spot (build 13); the beak is now the
    # band's own forward-pointed oval (BAND_R 9.0 x 10.8 cm: its front stands 1.8 cm ahead of a round band), no knob
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
    # SASH (FIX PASS 1, review: 'a rolled rope ring'): the concept's wide flat leather sash wound twice round the waist
    # (a 10 cm band with a wrap seam), a narrow belt over it with a squared stone buckle at the front, its tongue end
    # hanging at her left front
    sash = Sculpt("sash")
    sash.add(_Band((0.0, 0.0, 1.105), 0.158, 0.120, 0.012, 0.050, rr=0.005, tilt=8.0)
             .displaced(_sash_wrap, 0.003), k=0.0)
    sash.add(_Band((0.0, 0.0, 1.088), 0.170, 0.132, 0.006, 0.016, rr=0.003, tilt=8.0), k=0.004)        # the belt
    part("sash", sash, "leather", "auto", 760)
    # the tongue end (closing ULK-M2): its own part on the skirt's chains, so it swings with the front panel
    tongue = Sculpt("sash_tongue")
    tongue.add(RoundBox((0.098, -0.146, 0.995), (0.017, 0.005, 0.072), 0.004, axes=sdf.rot_y(-8)), k=0.0)
    part("sash_tongue", tongue, "leather", "skirt", 120, vs=0.6)
    bk = Sculpt("buckle")
    bk.add(RoundBox((0.035, -0.146, 1.071), (0.030, 0.007, 0.026), 0.005), k=0.0)
    bk.sub(RoundBox((0.035, -0.152, 1.071), (0.018, 0.008, 0.014), 0.003), k=0.002)                       # its window
    bk.add(RoundBox((0.035, -0.149, 1.071), (0.003, 0.004, 0.022), 0.002), k=0.002)                       # the pin
    part("buckle", bk, "ironstone", "auto", 160, vs=0.45)

    # SHOULDER PLATES: two pale stone tiers each side, curved shells (the concept's carved pauldrons): the top tier
    # caps the shoulder from the cowl to past the joint, the lower tier hugs the upper arm under it
    # FIX PASS 1 (review: 'thin caps inside the sleeve silhouette'): the concept's carved stone pauldrons as two real
    # tiers of curved slabs (cylinder sections arching over the shoulder front to back, 2 cm thick, squared chiselled
    # edges): the top tier from the cowl to 15 cm out past the joint, the lower tier stepping out beyond it over the arm,
    # so the shoulder line widens past the sleeves
    for s, sx in (("R", -1), ("L", 1)):
        top = Sculpt(f"plate_{s}1")
        top.add(_ArcPlate(sx, *PLATES["1"]).displaced(chips(0.003, 9.0), 0.003), k=0.0)
        part(f"plate_{s}1", top, "stone", ("dblend", f"shoulder.{s}", f"upper_arm.{s}", (sx * 0.16, 0.0, 1.50),
                                            (sx * 0.8, 0.0, -0.6), 0.03, 0.14), 640, vs=0.7)
        low = Sculpt(f"plate_{s}2")
        low.add(_ArcPlate(sx, *PLATES["2"]).displaced(chips(0.003, 9.0), 0.003), k=0.0)
        part(f"plate_{s}2", low, "stone", f"bone:upper_arm.{s}", 420, vs=0.7)

    # ARMS: pale wrapped sleeves (heat weights), dark bracers, sculpted fists (rigid on the hands)
    sl = Sculpt("sleeves")
    for sh, el, wr in ((SH_R, EL_R, WR_R), (SH_L, EL_L, WR_L)):
        sl.add(FlatCapsule(sh, el, 0.064, 0.060, 0.054, 0.052, side=(1, 0, 0))
               .displaced(wraps(0.006, 0.045, sh, el, **SLEEVE_WRAP), 0.006), k=0.0)
        sl.add(Sphere(el, 0.054), k=0.03)
        sl.add(FlatCapsule(el, wr, 0.052, 0.050, 0.040, 0.038, side=(1, 0, 0))
               .displaced(wraps(0.005, 0.04, el, wr, phase=0.3, **SLEEVE_WRAP), 0.005), k=0.02)
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
    # the front opening (FIX PASS 2, review: 'the run's dark lifted thigh still crosses horizontally over the front
    # skirt panel'): the concept's tunic is a WRAP, closed from the sash to the thighs (the overlap edge is painted),
    # split only near the hem, about one thigh wide (0.15 m, was 0.34 m open up to 0.86 m); a lifted thigh now carries
    # the closed front up over it (a tent between the legs) instead of showing through a gap
    sk.sub(_Slit((-0.015, -0.10), 0.76, 0.115, front=True), k=0.006)
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
    # (CW5 round 3, minor:ulkro-seat-lumps: the thigh tops stood 2 cm proud of the skirt's rounded back at x 12-16 cm, two
    # black lumps on her rear hips: above the skirt's hem the trousers stay inside its shell)
    legs.sub(_OutsideSkirt(0.86, 0.016), k=0.004)
    part("legs", legs, "under", "auto", 800)
    wr = Sculpt("wraps")
    for sx in (-1, 1):
        knee, ank = np.array([sx * 0.105, -0.01, 0.48]), np.array([sx * 0.115, 0.02, 0.12])
        wr.add(FlatCapsule(knee, ank, 0.060, 0.062, 0.050, 0.052, side=(1, 0, 0))
               .displaced(wraps(0.006, 0.05, knee, ank, **SHIN_WRAP), 0.006), k=0.0)
    part("wraps", wr, "wraps", "auto", 800)
    boots = Sculpt("boots")
    for sx in (-1, 1):
        to = math.radians(sx * 6.0)
        fwd = np.array([math.sin(to), -math.cos(to), 0.0])
        ank = np.array([sx * 0.115, 0.02, 0.0])
        boots.add(RoundBox(ank + fwd * 0.065 + (0, 0, 0.045), (0.050, 0.130, 0.045), 0.04, axes=sdf.rot_z(math.degrees(to))), k=0.0)
        # closing ULK-M3 ('sole-less bulb boots'): a shaped, lower toe narrowing forward, and a sole welt: a 2.2 cm
        # slab 6 mm proud of the upper all round (painted one value darker), so the boot sits on a sole
        boots.add(Ellipsoid(ank + fwd * 0.16 + (0, 0, 0.034), (0.044, 0.068, 0.034), axes=sdf.rot_z(math.degrees(to))),
                  k=0.03)
        boots.add(RoundBox(ank + fwd * 0.075 + (0, 0, 0.011), (0.058, 0.152, 0.011), 0.008,
                           axes=sdf.rot_z(math.degrees(to))), k=0.004)
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
    qb.add(RoundBox(Q_TOP - Q_U * 0.008, (Q_HW + 0.004, Q_HD + 0.004, 0.012), 0.026, axes=qax), k=0.0)    # the mouth's rim
    qb.sub(RoundBox(Q_TOP + Q_U * 0.02, (Q_HW - 0.012, Q_HD - 0.012, 0.06), 0.02, axes=qax), k=0.004)
    part("quiver_bands", qb, "leather", "bone:chest", 360, vs=0.7)
    # (CW5 r2 refix, ULK-M3: the case's cord and leather bands were geometry that surfaced only in short arcs over the
    # flattened case, the verifier's 'quiver smears': they are painted on the case now, paint_quiver)
    shafts, heads, inlays = Sculpt("crest_shafts"), Sculpt("crest_heads"), Sculpt("crest_inlays")
    for i in range(len(CREST)):
        base, d, tip = crest_dart(i)
        hb = tip - d * HEAD_L
        shafts.add(Capsule(base, hb + d * 0.012, DART_R), k=0.0)
        shafts.add(Capsule(hb - d * 0.018, hb + d * 0.008, DART_R * 1.12), k=0.004)       # the sinew binding
        nrm = _n(np.cross(d, Q_W))
        tw = math.radians(CREST_HEAD_TWIST[i])                 # each leaf turned a little: one catches every facing
        nrm = nrm * math.cos(tw) + np.cross(d, nrm) * math.sin(tw)
        _leaf(heads, inlays, hb, d, nrm)
    # each crest dart rides its own bone x_crest<i> (rest = rigid on the chest; only death moves them: they spill)
    part("crest_shafts", shafts, "wood", "crest", 560, vs=0.5)
    part("crest_heads", heads, "dawnglass", "crest", 760, vs=0.42)
    part("crest_inlays", inlays, "accent", "crest", 300, vs=0.42)

    # THE THROWER (prop.R): bleached carved wood (FIX PASS 1, review: 'a plain tube'): a flat blade 5 x 3 cm tapering
    # forward with spiral flutes carved along its back half, a gnarled two-lobed club knob at the butt (the concept's),
    # a flared collar, the hooked peg the dart's butt sits on, a leather grip, a small carved finial at the front
    th = Sculpt("thrower")
    a0, a1 = THROWER_S
    th.add(FlatCapsule(wpt(a0 + 0.06), wpt(a1), 0.025, 0.016, 0.015, 0.011, side=SIDEW)
           .displaced(_thrower_carve, 0.003), k=0.0)
    th.add(Ellipsoid(wpt(a0 + 0.045, -0.002), (0.034, 0.052, 0.030), axes=np.stack([SIDEW, AX, UPW]))
           .displaced(_thrower_carve, 0.003), k=0.02)                                                     # club knob
    th.add(Ellipsoid(wpt(a0 + 0.005, 0.004, 0.006), (0.027, 0.032, 0.025), axes=np.stack([SIDEW, AX, UPW]))
           .displaced(_thrower_carve, 0.003), k=0.015)                                                    # its end lobe
    th.add(Torus(wpt(a0 + 0.10), 0.024, 0.007, axes=np.stack([SIDEW, UPW, AX])), k=0.008)                # the collar
    th.add(RoundCone(wpt(a0 + 0.035, 0.022), wpt(a0 + 0.065, DART_OFF + 0.008), 0.009, 0.006), k=0.006)   # the peg
    th.add(Capsule(wpt(-0.06), wpt(0.065), 0.0255), k=0.008)                                               # the grip
    th.add(Ellipsoid(wpt(a1 + 0.005), (0.016, 0.026, 0.013), axes=np.stack([SIDEW, AX, UPW])), k=0.01)    # finial
    part("thrower", th, "wood", "bone:prop.R", 760, vs=0.55)
    # THE LAID DART (its own bone x_dart under prop.R: it is hidden from the release to the reload of every throw)
    ds = Sculpt("dart_shaft")
    ds.add(Capsule(wpt(DART_S[0] + 0.02, DART_OFF), wpt(DART_S[1] + 0.012, DART_OFF), DART_R), k=0.0)
    ds.add(Capsule(wpt(DART_S[1] - 0.018, DART_OFF), wpt(DART_S[1] + 0.008, DART_OFF), DART_R * 1.12), k=0.004)
    part("dart_shaft", ds, "wood", "bone:x_dart", 300, vs=0.55)
    lh, li = Sculpt("dart_head"), Sculpt("dart_inlay")
    _leaf(lh, li, wpt(DART_S[1], DART_OFF), AX, UPW, scale=LAID_HEAD)
    part("dart_head", lh, "dawnglass", "bone:x_dart", 180, vs=0.42)
    part("dart_inlay", li, "accent", "bone:x_dart", 70, vs=0.42)
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


def _band_notch(P):
    """the row of short upright notches over the eye slit (0..1): PAINTED only (FIX PASS 2, review: 'a curved white
    specular sliver on the eye band': the 2 mm notch ribs swept their flanks through the sky's reflection)"""
    z = P[:, 2] - BAND_Z
    th = np.arctan2(P[:, 0], -(P[:, 1] - HEAD_C[1]))
    return np.clip((np.abs(np.sin(th * 13.0)) - 0.86) / 0.14, 0, 1) * (z > -0.006) * (z < 0.009)


def _band_carve(P):
    """the eye band's carving (FIX PASS 1, review: 'reads as a walnut / brain'): a plain band with an incised line
    along its top, 2 mm deep (the notches are painted, _band_notch)"""
    z = P[:, 2] - BAND_Z
    edge = np.exp(-((z - 0.013) / 0.0018) ** 2)
    return 0.0022 * np.clip(edge, 0, 1)


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


def _sash_wrap(P):
    """the wound sash: the second wind's edge as a raised seam rising round her waist, soft horizontal creases"""
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    th = np.arctan2(x, -y)
    seam = np.exp(-((z - (1.098 + 0.011 * th + 0.0185 * (y < 0) * np.clip(-y / 0.13, 0, 1))) / 0.0045) ** 2)
    crease = np.sin(z * 240.0 + 2.0 * NOISE(P, 9.0) + th * 2.0)
    return -0.0024 * seam + 0.0008 * crease


def _thrower_carve(P):
    """the thrower's carving: three spiral flutes round its back half and over the knob (2-3 mm), fading out
    before the grip"""
    q = P - GRIP_R
    s, up, sd = q @ AX, q @ UPW, q @ SIDEW
    ang = np.arctan2(up, sd)
    u = np.sin(ang * 3.0 + s * 95.0 + 0.8 * NOISE(P, 30.0))
    fade = np.clip((-0.07 - s) / 0.06, 0.0, 1.0)
    return 0.0028 * np.clip(u - 0.45, 0, 1) * 1.8 * fade


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


class _OutsideSkirt(sdf.Prim):
    """everything outside the skirt's shell (art: sculpts(), SKIRT) drawn in by `inset`, above z_low"""

    def __init__(self, z_low, inset):
        self.z = z_low
        self.shell = FlatCapsule((0.0, 0.0, 1.07), (0.0, 0.008, 0.57), 0.150 - inset, 0.110 - inset, 0.285 - inset,
                                 0.185 - inset, side=(1, 0, 0))

    def bounds(self):
        return np.array([-0.5, -0.5, self.z - 0.02]), np.array([0.5, 0.5, 1.3])

    def d(self, P):
        return np.maximum(-self.shell.d(P), self.z - P[:, 2])


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
        # FIX PASS 1 (review: 'the accent covers almost the whole head, flat saturated gems'): a slim vein inlay along
        # the leaf's midrib, the pale glass leaf all round it.
        # FIX PASS 2 (review: 'still a wide stripe covering about a third of each head ... they read as blue crystals';
        # brief: one 4 x 1.2 cm inlay on a 14-16 cm head): the vein is now a thin lens on the midrib, 54 % of the
        # leaf's length (9 cm) and at most 21 % of its width (1.5 cm), set where the leaf is widest; ~10 cm2 a face,
        # was ~35 (the brief's 0.3 % accent against the pipeline's 1.5 % warning floor: the brief's read wins)
        q = P - self.b
        s, a, c = q @ self.dv, q @ self.w, q @ self.n
        u = (s - self.L * 0.40) / (self.L * 0.27)
        half = self.W * 0.21 * np.clip(1 - u * u, 0, 1) ** 0.7
        dx = np.abs(a) - half
        top = self.T + 0.0035                      # 2.3 mm proud of the glass at the leaf's spine (never buried)
        dz = np.maximum(c - top, self.T * 0.3 - c)
        return np.maximum(np.maximum(dx * 0.9, dz), np.abs(u) * self.L * 0.27 - self.L * 0.27)


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
        half = 0.5 * math.acos(float(np.clip(d0 @ d1, -1, 1))) + math.radians(4)     # 0.30 m across (brief)

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
                dr = np.maximum(0.20 - r, r - 0.40 - 0.015 * np.cos(ph * 13.0))
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
            "carved": materials.carved_wood("carved", pal, "carved", g, rough=0.95),
            "lacquer": materials.waxed_leather("lacquer", pal, "lacquer", g, rough=0.45),
            "sandstone": materials.heavy_cloth("sandstone", pal, "sandstone", g, rough=0.92, weave=0.8),
            "cloth2": materials.heavy_cloth("cloth2", pal, "cloth2", g, rough=0.92, weave=0.7),
            "wood": materials.carved_wood("wood", pal, "wood", g, rough=0.74),
            "stone": materials.honed_stone("stone", pal, "stone", g, rough=0.78, chisel=1.0),
            "leather": materials.waxed_leather("leather_matte", pal, "leather", g, rough=0.76)}


# ── decimation: the shared collapse keeps X symmetry, which stalls on this asymmetric figure's one-sided parts
# (the skirt kept 4490 of 2200 tris); those parts decimate without it (wrapper, common/ untouched) ──────────
# (CW5 refix 1: the shin wraps wound at 6 bands per turn are no longer mirror-symmetric, the symmetric collapse
# stalled at 2612 of 800 tris and the base GLB built at 1425 KiB (1338 after decimate_chains --orm-q 40 --normal-q 70)
# > 1172: that build was NOT shipped (shots/report fw_CW5_r1_ulkro_*_unshipped); "wraps" decimates without symmetry)
ASYM = ("skirt", "hood_tail", "quiver", "crest_", "thrower", "dart_", "hand_", "bracers", "sash", "buckle",
        "lacquer_fan", "wraps")


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
Q_BASE = 62        # the skins (c9beb122)
Q_BASE_MAIN = 52   # the base carries the clips


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
        args = [node, script, path, out] + (["--quantize"] if quantize else []) + ["--fighter", "--q-base", str(Q_BASE if os.path.basename(out) != "ulkro.glb" else Q_BASE_MAIN)]
        r = subprocess.run(args, cwd=_scene.GAME_DIR, capture_output=True, text=True, encoding="utf-8")
        if r.returncode != 0:
            _scene.log(f"optimize failed ({r.returncode}): {r.stderr.strip()[:800]}")
            return {"ok": False, "before": before, "after": before, "error": r.stderr[-800:]}
        _scene.log(r.stdout.strip())
        # (CW5 r2 refix: the budget recipe of c9beb122, run by hand then, now part of the build) the base: the slow clips'
        # every bone and the chains' tracks keep every 2nd key, ORM q30, normal q55; any GLB still over 1172 KiB is thinned
        # with glb_simplify (locked UV borders)
        if os.path.basename(out) == "ulkro.glb":
            tool = os.path.join(_scene.TOOLS_DIR, "decimate_chains.mjs")
            for extra in (["--prefix", "", "--clip", "idle,idle_lobby,taunt,stunned,victory,channel"],
                          ["--every", "3", "--prefix", "", "--clip", "recall"],
                          ["--prefix", "x_", "--orm-q", "30", "--normal-q", "55",
                           "--clip", "attack1,attack2,cast_a1,cast_a2,cast_a3,cast_ult,dash,run,death"]):
                r2 = subprocess.run([node, tool, out] + ([] if "--every" in extra else ["--every", "2"]) + extra, cwd=_scene.GAME_DIR, capture_output=True,
                                    text=True, encoding="utf-8")
                _scene.log((r2.stdout or r2.stderr).strip()[-400:])
            # (CW5 round 3, minor:ulkro-recall-patch: was a by-hand GLB patch) recall keeps every 3rd key, and between keys the
            # kneeling toe dips to -0.022 m (f138) under the floor gate's -0.02 whatever the plant: the whole clip 4 mm up
            r2 = subprocess.run([node, os.path.join(_scene.TOOLS_DIR, "clip_lift.mjs"), out, "--clip", "recall", "--bone", "hips",
                                 "--dy", "0.004", "--from", "-1", "--to", "-0.5"], cwd=_scene.GAME_DIR, capture_output=True,
                                text=True, encoding="utf-8")
            _scene.log((r2.stdout or r2.stderr).strip()[-200:])
        if os.path.getsize(out) > 1172 * 1024:
            kib = os.path.getsize(out) / 1024.0
            ratio = 0.75 if os.path.basename(out) == "ulkro.glb" else max(0.70, min(0.95, 0.97 - (kib - 1172.0) / 900.0))
            r3 = subprocess.run([node, os.path.join(_scene.TOOLS_DIR, "glb_simplify.mjs"), out, out, "--ratio", f"{ratio:.3f}",
                                 "--error", "0.004"], cwd=_scene.GAME_DIR, capture_output=True, text=True, encoding="utf-8")
            _scene.log((r3.stdout or r3.stderr).strip()[-300:])
        return {"ok": True, "before": before, "after": os.path.getsize(out), "q_base": Q_BASE}
    optimize._ulkro = True
    export.optimize = optimize


_install_optimize()


def _install_art_height() -> None:
    """FighterArt.height places the HP bar (art.height + 0.35 m): the crest's leaning tips rise toward the bar in her
    worst facings (see CREST), so the reported height is the mesh top + ART_HEIGHT_PAD, inside the load test's 6 cm
    tolerance (wraps pipeline.art_fragment in this build process only)"""
    from common import pipeline
    orig = pipeline.art_fragment
    if getattr(orig, "_ulkro", False):
        return

    def art_fragment(spec, clips_info, mesh_top=None):
        out = orig(spec, clips_info, mesh_top)
        if getattr(spec, "ID", None) == ID and mesh_top:
            out["height"] = round(float(mesh_top) + ART_HEIGHT_PAD, 2)
        return out
    art_fragment._ulkro = True
    pipeline.art_fragment = art_fragment


_install_art_height()


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
    # the laid dart's own bone (deforming, rigid-bound): scaled to nothing from a throw's release to its reload, so
    # the held dart never doubles the projectile VFX that leaves x_dart_tip (FIX PASS 1)
    rig.add_socket(info, "x_dart", "prop.R", tuple(GRIP_R), tuple(AX * 0.10), z_hint=tuple(UPW))
    arm.data.bones["x_dart"].use_deform = True
    info.lengths["x_dart"] = arm.data.bones["x_dart"].length
    # FIX PASS 2 (review: 'the quiver darts stay rigid in the fan (no spill)'): one deforming bone per crest dart,
    # head at the quiver's mouth, +Y along the dart, +Z out from her back; at rest in every clip but death
    for i in range(len(CREST)):
        nm = f"x_crest{i}"
        rig.add_socket(info, nm, "chest", tuple(crest_pivot(i)), tuple(crest_dart(i)[1] * 0.10), z_hint=tuple(Q_N))
        arm.data.bones[nm].use_deform = True
        info.lengths[nm] = arm.data.bones[nm].length
    # closing ULK-M2: the skirt on four 2-bone chains from the hips and the hood's tail on a 2-bone chain off the head
    for nm, (parent, pts) in SKIRT_CHAINS.items():
        ctx.chains[nm] = rig.add_chain(info, nm, parent, [V(tuple(q)) for q in pts])
    ctx.chains["tail"] = rig.add_chain(info, "tail", "head", [V(tuple(q)) for q in TAIL_CHAIN], z_hint=(0.0, 0.0, 1.0))


# ── secondary motion (closing review ULK-M2): baked spring chains (anim.secondary_motion; no runtime cloth). The
# knee-length skirt was skinned to the thighs, so in the run its front lifted as one board and the dark thigh showed
# over it; the hood's tail never lagged. Now the skirt hangs as four panels (front, back, her left, her right) on
# 2-bone chains from the hips: the front pushed out by the leading knee, the back kicked out by the trailing one and
# the stride's spread, each side swung by its own knee, all springs (the hem lags 2-4 frames and overshoots on the
# run's contacts, Bound's landing, the dash and the fall); a no-lag floor keeps the front and back panels clear of the
# trousers. The tail streams off the head on a spring driven by the head's own bob (inertia) and pitch.
SKIRT_CHAINS = {     # name: (parent, joints (rest, m)); + rotation about each bone's X = the hem forward
    "skirt_f": ("hips", ((-0.005, -0.118, 1.06), (-0.005, -0.150, 0.84), (-0.005, -0.186, 0.60))),
    "skirt_b": ("hips", ((0.0, 0.118, 1.06), (0.0, 0.150, 0.84), (0.0, 0.188, 0.60))),
    "skirt_l": ("hips", ((0.155, 0.0, 1.06), (0.222, 0.004, 0.84), (0.285, 0.008, 0.61))),
    "skirt_r": ("hips", ((-0.155, 0.0, 1.06), (-0.222, 0.004, 0.84), (-0.285, 0.008, 0.61))),
}
SKIRT_AZ = {"skirt_f": 0.0, "skirt_l": 90.0, "skirt_b": 180.0, "skirt_r": -90.0}   # bearing (deg, 0 front, + her left)
SKIRT_K, SKIRT_A0 = 0.50, 4.0          # the front / back panel's push: share of the knee's swing past A0 deg
SKIRT_SIDE_K = 0.35                    # the side panels: share of their own knee's swing
SKIRT_SPREAD_K = 0.28                  # the back panel: share of the stride's spread (|thigh L - thigh R|, deg)
SKIRT_CLEAR, SKIRT_THIGH_R = 0.02, 0.10    # the floor: the trouser's surface (thigh axis + R) stays CLEAR of the panel
TAIL_CHAIN = (TAIL_PTS[0], TAIL_PTS[2], TAIL_PTS[5])
SKIRT_LIE = {"skirt_b": (18.0, 6.0), "skirt_l": (12.0, 4.0), "skirt_r": (12.0, 4.0)}   # deg per bone, lying in death


def _knee_angles(skel, pose) -> dict:
    """each thigh's swing in the hips' rest frame (deg, + = the knee ahead of the hip), the hip and knee points"""
    M = skel.fk(pose)
    T = skel.rest["hips"] @ M["hips"].inverted()
    out = {}
    for s_ in "LR":
        h = T @ M[f"thigh.{s_}"].translation
        k = T @ M[f"shin.{s_}"].translation
        d = k - h
        out[s_] = (math.degrees(math.atan2(-d.y, max(1e-6, -d.z))), h, k)
    return out


def _skirt_floor(skel, nm):
    """the least swing (deg, signed like the chain) that keeps the panel's line from its root to its hem in front of
    (skirt_f) / behind (skirt_b) both thighs' surfaces at the panel's heights"""
    pts = SKIRT_CHAINS[nm][1]
    R, Hm = V(pts[0]), V(pts[-1])
    sgn = -1.0 if nm == "skirt_f" else 1.0
    rest = math.atan2(sgn * (Hm.y - R.y), R.z - Hm.z)

    def f(pose):
        need = -90.0
        for _, h, k in _knee_angles(skel, pose).values():
            for t in (0.35, 0.55, 0.75, 0.9, 1.0):
                Pp = h.lerp(k, t)
                if not (Hm.z - 0.04 < Pp.z < R.z - 0.02):
                    continue
                out = sgn * (Pp.y - R.y) + SKIRT_THIGH_R + SKIRT_CLEAR
                need = max(need, math.degrees(math.atan2(out, R.z - Pp.z) - rest))
        return need if nm == "skirt_f" else -need
    return f


def chain_config(ctx) -> list:
    skel = anim.Skeleton(ctx.info.armature)

    def push(nm):
        def f(p):
            sl = p.get("skirt_lift", (0.0, 0.0, 0.0))
            return push0(p) + (sl[0] if nm == "skirt_b" else sl[1] if nm in ("skirt_l", "skirt_r") else 0.0)

        def push0(p):
            a = _knee_angles(skel, p)
            if nm == "skirt_f":
                return SKIRT_K * max(0.0, max(a["L"][0], a["R"][0]) - SKIRT_A0)
            if nm == "skirt_b":
                return (-SKIRT_K * max(0.0, max(-a["L"][0], -a["R"][0]) - SKIRT_A0)
                        - SKIRT_SPREAD_K * abs(a["L"][0] - a["R"][0]))
            return SKIRT_SIDE_K * a["L" if nm == "skirt_l" else "R"][0]
        return f

    def tail_drive(p):
        # the head pitched down lifts the tail's free end (it trails the motion), plus the clip's own beat
        hd = sum(p.get(b, (0.0, 0.0, 0.0))[0] for b in ("spine", "chest", "neck", "head"))
        return 0.35 * hd + p.get("tail_drive", 0.0)
    out = []
    for nm, bones in ctx.chains.items():
        if nm == "tail":
            out.append(anim.ChainCfg(list(bones), gravity=0.0, stiffness=110.0, damping=7.0, inertia=1.1,
                                     drive=tail_drive, limit=(-38.0, 38.0), floor=0.03))
            continue
        lim = {"skirt_f": (-6.0, 42.0), "skirt_b": (-42.0, 24.0)}.get(nm, (-26.0, 28.0))
        c = anim.ChainCfg(list(bones), gravity=0.7, stiffness=120.0, damping=10.0, inertia=0.6, drive=push(nm),
                          limit=lim, floor=0.05)        # the hem felt reaches a few cm past the bone line
        c._ulkro_name = nm
        if nm in ("skirt_f", "skirt_b"):
            c._ulkro_floor = _skirt_floor(skel, nm)
            c._ulkro_front = nm == "skirt_f"
        out.append(c)
    return out


def _install_chain_floor() -> None:
    """the shared spring pass, then the front / back panels' no-lag floor (a knee driven up in two frames must not
    pass through the skirt while the spring catches up)"""
    if getattr(anim.secondary_motion, "_ulkro", False):
        return
    orig = anim.secondary_motion

    def secondary_motion(skel, poses, cfgs, loop):
        out = orig(skel, poses, cfgs, loop)
        for cfg in cfgs or []:              # the skirt lying under her in death (skirt_lift: the death keys)
            nm = getattr(cfg, "_ulkro_name", "")
            if nm not in ("skirt_b", "skirt_l", "skirt_r"):
                continue
            tgt = SKIRT_LIE[nm]
            for f, p in enumerate(out):
                sl = poses[f].get("skirt_lift", (0.0, 0.0, 0.0))
                w = min(1.0, max(0.0, (sl[0] if nm == "skirt_b" else sl[1]) / (75.0 if nm == "skirt_b" else 40.0)))
                if w <= 0.0:
                    continue
                for j, b in enumerate(cfg.bones):
                    a = p.get(b, (0.0, 0.0, 0.0))
                    p[b] = (a[0] + (tgt[j] - a[0]) * w, a[1], a[2])
        for cfg in cfgs or []:
            fl = getattr(cfg, "_ulkro_floor", None)
            if fl is None:
                continue
            b = cfg.bones[0]
            for f, p in enumerate(out):
                a = p.get(b, (0.0, 0.0, 0.0))
                m = fl(poses[f])
                if (cfg._ulkro_front and m > a[0]) or (not cfg._ulkro_front and m < a[0]):
                    p[b] = (max(cfg.limit[0] - 10.0, min(cfg.limit[1] + 10.0, m)), a[1], a[2])
                    if cfg.floor is not None:              # the ground still wins (the back panel under her in death)
                        anim._keep_above_floor(skel, p, cfg)
            if loop:
                out[-1][b] = out[0][b]
        return out
    secondary_motion._ulkro = True
    anim.secondary_motion = secondary_motion


_install_chain_floor()


# ── analytic weights (the skirt) ──────────────────────────────────────────────────────────────────────────
def _ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _chain_w(bones, s_, root):
    """weights along a chain by its parameter s_ (0 at the root, len(bones) at the free end): the first 35 % of the
    first bone shared with `root` (the attachment stays glued), then blended between the bone centres"""
    n = len(bones)
    s_ = np.clip(s_, 0.0, n)
    out = {root: np.where(s_ < 0.35, 1.0 - s_ / 0.35, 0.0)}
    for b in bones:
        out[b] = np.zeros_like(s_)
    out[bones[0]] = out[bones[0]] + np.where(s_ < 0.35, s_ / 0.35, 0.0)
    x = s_ - 0.5
    k0 = np.floor(x).astype(int)
    f = x - k0
    deep = s_ >= 0.35
    for i, b in enumerate(bones):
        wa = np.where(np.clip(k0, 0, n - 1) == i, 1.0 - f, 0.0)
        wb = np.where(np.clip(k0 + 1, 0, n - 1) == i, f, 0.0)
        out[b] = out[b] + np.where(deep, wa + wb, 0.0)
    return out


def _skirt_chain_weights(co):
    """closing ULK-M2: the skirt (and the sash's tongue) on its four chains, each vertex blended between its two
    nearest panels by bearing (cosine weights); above the chains' roots the hips"""
    x, y, z = co[:, 0] + 0.003, co[:, 1], co[:, 2]
    phi = np.degrees(np.arctan2(x, -y))
    ks = {nm: np.maximum(0.0, np.cos(np.radians(phi - az))) for nm, az in SKIRT_AZ.items()}
    tot = np.maximum(sum(ks.values()), 1e-6)
    W = {}
    for nm, k in ks.items():
        pts = SKIRT_CHAINS[nm][1]
        bones = [f"x_{nm}_{i + 1}" for i in range(len(pts) - 1)]
        s_ = (pts[0][2] - z) / (pts[0][2] - pts[-1][2]) * len(bones)
        for b_, w in _chain_w(bones, s_, "hips").items():
            W[b_] = W.get(b_, 0.0) + w * k / tot
    return W


def _tail_weights(co):
    """closing ULK-M2: the hood's tail on x_tail_1-2 by its arc parameter (the projection onto the chain's polyline),
    its root glued to the head"""
    J = [np.asarray(q, float) for q in TAIL_CHAIN]
    L = [float(np.linalg.norm(J[i + 1] - J[i])) for i in range(2)]
    best_d = np.full(len(co), 1e9)
    s_ = np.zeros(len(co))
    for i in range(2):
        d = (J[i + 1] - J[i]) / L[i]
        t = np.clip((co - J[i]) @ d, 0.0, L[i])
        dist = np.linalg.norm(co - (J[i] + np.outer(t, d)), axis=1)
        m = dist < best_d
        best_d[m] = dist[m]
        s_[m] = i + t[m] / L[i]
    return _chain_w(["x_tail_1", "x_tail_2"], s_ * 1.0, "head")


def _skirt_weights(co):
    """hips at the sash, the thighs below by side; the back panel keeps more hips (no tearing in crouches)"""
    x, y, z = co[:, 0], co[:, 1], co[:, 2]
    # the front panels (FIX PASS 1, review: 'the lifted thigh pushes the panel up and shows over it') hand over to the
    # thighs from higher up, so a lifted thigh carries its panel whole instead of passing through a half-weighted one
    front = _ss(0.0, -0.08, y)
    wh = _ss(0.70, 1.02, z) * (1 - front) + _ss(0.88, 1.08, z) * front
    wh = wh + (1 - wh) * 0.45 * _ss(0.02, 0.16, y)
    # side split: the front panels follow their own thigh (FIX PASS 2: a 10 cm hand-over centred on the hem split,
    # the closed wrap above it tents between the thighs), the back panel the wider blend
    sF = _ss(-0.065, 0.035, x)
    sB = _ss(-0.07, 0.07, x)
    sL = sF * front + sB * (1 - front)
    return {"hips": wh, "thigh.L": (1 - wh) * sL, "thigh.R": (1 - wh) * (1 - sL)}


def _crest_weights(co):
    """every crest vertex rigid on the bone of the dart whose axis it lies nearest (shaft, head and inlays); the
    distance across a leaf's width counts at 40 % (a feathered leaf edge never goes to the neighbouring dart)"""
    D = []
    for i in range(len(CREST)):
        base, d, tip = crest_dart(i)
        nrm = _n(np.cross(d, Q_W))
        tw = math.radians(CREST_HEAD_TWIST[i])
        nrm = nrm * math.cos(tw) + np.cross(d, nrm) * math.sin(tw)
        w = np.cross(d, nrm)
        q = co - base
        t = np.clip(q @ d, 0.0, CREST[i][3])
        rv = q - np.outer(t, d)
        D.append(np.sqrt((rv @ w * 0.4) ** 2 + (rv @ nrm) ** 2 + (q @ d - t) ** 2))
    k = np.argmin(np.stack(D, 1), axis=1)
    return {f"x_crest{i}": (k == i).astype(np.float64) for i in range(len(CREST))}


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
            _assign(obj, ctx.info.armature, _skirt_chain_weights)
            return {}
        if part.bind == "tail":
            _assign(obj, ctx.info.armature, _tail_weights)
            return {}
        if part.bind == "crest":
            _assign(obj, ctx.info.armature, _crest_weights)
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
    # FIX PASS 1 (review: 'cold grey-white sleeves / plates / face wrap, a dark reddish-chocolate tunic'): every albedo
    # moved onto the concept's warm material colours, set at the saturation three.js leaves them at (its sky light
    # strips ~10-15 points: the 16 % sleeves rendered 3 %), the tunic up to a mid brown-grey, the hues pulled harder onto
    # the target (no off-palette smears), nothing in the marigold band over 40 %
    "hood": ("#826B4F", 0.75, 0.5), "cowl": ("#7F684D", 0.8, 0.5),
    "head": ("#6E6350", 0.85, 0.8), "eyeband": ("#4A382B", 0.85, 0.65),
    "torso": ("#5E5245", 1.0, 0.6), "straps": ("#3F2D22", 0.9, 0.55), "sash": ("#563A2B", 0.9, 0.55), "sash_tongue": ("#563A2B", 0.9, 0.55),
    "buckle": ("#4A4540", 0.8, 0.8),
    # FIX PASS 2: the plates the concept's cool pale stone (#DBD6CB / #C3B9AD, hue ~40 at 7-11 %), no longer the warm
    # cream of the linen quiver beside them; the lower tier a step darker (it sits in the top tier's shade)
    "plate_R1": ("#938E84", 0.75, 0.85), "plate_L1": ("#938E84", 0.75, 0.85),
    "plate_R2": ("#858076", 0.75, 0.85), "plate_L2": ("#858076", 0.75, 0.85),
    "bracers": ("#463830", 0.9, 0.55),
    "skirt": ("#584C3F", 1.0, 0.6), "quiver": ("#9C8D72", 0.85, 0.65), "quiver_bands": ("#4E3A2A", 0.9, 0.65),
}
# side-facing texels of these parts streak (neighbours along Y take one plate pixel): blended into the part's colour
# with painted breakup; up-facing texels likewise (the hood's crown, the plates' tops, the quiver's mouth)
SIDE_PARTS = ("hood", "cowl", "torso", "skirt", "sleeves", "quiver", "sash", "sash_tongue", "plate_R1", "plate_L1", "plate_R2",
              "plate_L2", "head", "bracers", "straps", "quiver_bands", "buckle")
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


def _helix(p, a, b, pitch, slant, phase=0.0, vary=0.0):
    """the sculpt's wraps() phase round the segment a -> b (painted grooves land on the sculpted ones)"""
    a, u, e1, e2 = _wrap_axes(a, b)
    return wrap_phase(p, a, u, e1, e2, pitch, slant, phase, vary)


def _band_value(f, band):
    """an overlapping band's value: lit along its proud leading edge, shading into the tuck under the next band (a dark
    seam line), each band its own value"""
    lead = np.exp(-((f - 0.06) / 0.10) ** 2)
    tuck = np.exp(-((f - 0.97) / 0.05) ** 2)
    return (0.84 + 0.20 * lead - 0.12 * f) * (1 - 0.48 * np.clip(tuck, 0, 1)) * (1 + 0.16 * band)


def _seg_dist(p, a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    ab = b - a
    t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(p - (a + np.outer(t, ab)), axis=1)


def paint_sleeves(p, n):
    """the pale sleeve wraps: bands wound up each arm (the sculpt's helix), a dark seam between bands, each band its
    own value, grey-beige linen a step darker than the stone plates above them"""
    sl_, vy_ = SLEEVE_WRAP["slant"], SLEEVE_WRAP["vary"]
    segs = [(SH_R, EL_R, 0.045, sl_, 0.0), (EL_R, WR_R, 0.04, sl_, 0.3), (SH_L, EL_L, 0.045, sl_, 0.0),
            (EL_L, WR_L, 0.04, sl_, 0.3)]
    D = np.stack([_seg_dist(p, a, b) for a, b, *_ in segs], 1)
    which = np.argmin(D, 1)
    ph = np.zeros(len(p))
    for i, (a, b, pitch, slant, phs) in enumerate(segs):
        m = which == i
        if m.any():
            ph[m] = _helix(p[m], a, b, pitch, slant, phs, vy_) + 7.0 * i
    f = ph - np.floor(ph)
    band = _hash(np.floor(ph)) - 0.5
    v = _band_value(f, band)
    v = v * (1 + 0.06 * NOISE(p, 28.0)) * (0.84 + 0.20 * np.clip(n[:, 2] * 0.5 + 0.5, 0, 1))
    return _hl("#8A7A62") * v[:, None]


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
        ph = _helix(p[sel], a, b, 0.05, SHIN_WRAP["slant"], 0.0, SHIN_WRAP["vary"])
        f = ph - np.floor(ph)
        band = _hash(np.floor(ph) + sx * 31.0) - 0.5
        v[sel] = _band_value(f, band)
    v = v * (1 + 0.06 * NOISE(p, 30.0)) * (0.86 + 0.18 * np.clip(n[:, 2] * 0.5 + 0.5, 0, 1))
    return _hl("#3E372F") * v[:, None]


def paint_boots(p, n):
    z = p[:, 2]
    v = 1.0 + 0.08 * NOISE(p, 9.0) + 0.05 * NOISE(p, 31.0)
    v = v * (0.84 + 0.22 * np.clip(n[:, 2] * 0.5 + 0.5, 0, 1))
    v = v * (1 - 0.18 * _ss(0.15, 0.19, z))                                       # the rolled top
    v = v * (1 + 0.12 * ((n[:, 1] < -0.5) & (z < 0.07)))                          # scuffed toes
    # suede breakup (closing ULK-M3): soft nap patches and rubbed lighter creases over the instep and the ankle
    v = v * (1 + 0.10 * NOISE(p, 45.0) * _ss(0.03, 0.05, z))
    v = v * (1 + 0.08 * np.clip(np.sin(p[:, 1] * 140.0 + 3.0 * NOISE(p, 11.0)), 0, 1) * _ss(0.05, 0.09, z)
             * (1 - _ss(0.12, 0.16, z)))
    col = _hl("#4A3D30") * v[:, None]
    welt = _ss(0.036, 0.024, z)                                                     # the upper darkens into the welt
    col = col * (1 - 0.25 * welt)[:, None]
    sole = (z < 0.023) | (n[:, 2] < -0.6)                                           # the sole welt, one value darker
    sv = (0.92 + 0.10 * NOISE(p[sole], 30.0)) * (1 + 0.10 * (n[sole][:, 2] > 0.5))   # its lit top edge
    col[sole] = _hl("#332920") * sv[:, None]
    return col


def paint_hands(p, n):
    v = 0.80 + 0.26 * np.clip(n[:, 2] * 0.5 + 0.5, 0, 1) + 0.06 * NOISE(p, 40.0)
    return _hl("#8E6248") * v[:, None]


def paint_thrower(p, n):
    """the bleached carved thrower: grain along it, the carved flutes and the knob's grooves dark in their recesses,
    the knob and collar a little aged, the ironstone peg, the leather-wrapped grip"""
    q = p - GRIP_R
    s, up, sd = q @ AX, q @ UPW, q @ SIDEW
    grain = 1 + 0.035 * np.sin(s * 240.0 + 5.0 * NOISE(p, 18.0)) + 0.03 * NOISE(p, 11.0)
    col = _hl("#C4B496") * grain[:, None]
    carve = _thrower_carve(p) / 0.0028                                   # 0 on the surface .. ~1.4 in a flute
    col = col * (1 - 0.42 * np.clip(carve, 0, 1))[:, None]
    knob = _ss(-0.22, -0.30, s)
    col = col * (1 - 0.10 * knob * (0.6 + 0.4 * NOISE(p, 25.0)))[:, None]
    collar = np.abs(s - (THROWER_S[0] + 0.10)) < 0.011
    col[collar] = col[collar] * 0.82
    a_, b_ = wpt(THROWER_S[0] + 0.035, 0.022), wpt(THROWER_S[0] + 0.065, DART_OFF + 0.008)
    peg = _seg_dist(p, a_, b_) < 0.0125
    col[peg] = _hl("#4A4540") * (1 + 0.06 * NOISE(p[peg], 40.0))[:, None]
    grip = (s > -0.065) & (s < 0.070) & (np.hypot(up, sd) < 0.034) & ~peg
    wrap = 1 - 0.28 * np.abs(np.sin(s[grip] * 2 * math.pi / 0.014 + up[grip] * 40.0))
    col[grip] = _hl("#4E392B") * wrap[:, None]
    return col


def paint_dart_shaft(p, n):
    """the laid dart: a pale shaft (a step under the thrower so it never reads as the brightest mid-band stripe),
    the sinew binding under the head a step darker"""
    q = p - GRIP_R
    s = q @ AX
    grain = 1 + 0.03 * np.sin(s * 300.0 + 4 * NOISE(p, 22.0)) + 0.02 * NOISE(p, 12.0)
    col = _hl("#B8A88C") * grain[:, None]
    bind = np.abs(s - (DART_S[1] - 0.005)) < 0.014
    col[bind] = _hl("#A39780") * (1 - 0.18 * np.abs(np.sin(s[bind] * 2 * math.pi / 0.005)))[:, None]
    return col


def paint_shafts(p, n):
    """the five crest shafts: pale wood with a quiet grain (no speckle), a pale sinew binding under each head (no dark
    collar: the concept's heads sit straight on the shaft), darker where they stand in the quiver"""
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
    grain = 1 + 0.03 * np.sin(tt * 260.0 + 3 * NOISE(p, 20.0)) + 0.02 * NOISE(p, 9.0)
    col = _hl("#BFB094") * grain[:, None]
    hb = Lx - HEAD_L
    bind = (tt > hb - 0.018) & (tt < hb + 0.008)
    col[bind] = _hl("#A69A84") * (1 - 0.15 * np.abs(np.sin(tt[bind] * 2 * math.pi / 0.005)))[:, None]
    col = col * (1 - 0.45 * _ss(0.20, 0.12, tt))[:, None]
    return col


def plate_rims(name, c, p, n):
    """the stone pauldrons: a darker chipped bevel along every edge of the rounded outline (the concept's), an
    incised line inside it; the underside only a step darker (FIX PASS 2, review: 'in the splash the pauldrons are
    backlit into dark brown slabs': the raised arms of victory turn the undersides to the camera, painted at 55 %
    they read as boards)"""
    sx = -1.0 if name.endswith(("R1", "R2")) else 1.0
    prm = PLATES["1" if name.endswith("1") else "2"]
    d2, r, ang = _plate_outline(p, sx, *prm)
    edge = -d2
    rim = 1 - _ss(0.004, 0.020, edge)
    line = np.exp(-((edge - 0.028) / 0.0024) ** 2)
    outn = np.stack([np.sin(ang) * sx, np.zeros_like(ang), np.cos(ang)], 1)
    under = _ss(0.1, -0.5, (n * outn).sum(1))                                 # faces turned in toward the shoulder
    f = np.clip((ang - math.radians(prm[5])) / math.radians(prm[6] - prm[5]), 0, 1)
    # the underside carries a painted bounce (it is only ever seen when a raised arm turns it up into shade, the
    # bind-pose AO has already darkened it), the outer face dims toward its lower edge so the tiers separate
    k = (1 - 0.45 * rim) * (1 - 0.28 * line) * (1 + 0.32 * under) * (1 - 0.12 * f * (1 - under))
    k = k * (1 + 0.07 * NOISE(p, 30.0))
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


def _leaf_frames():
    """(base, along, across, length) of every leaf head: the five crest heads and the laid dart's"""
    out = []
    for i in range(len(CREST)):
        base, d, tip = crest_dart(i)
        nrm = _n(np.cross(d, Q_W))
        tw = math.radians(CREST_HEAD_TWIST[i])
        nrm = nrm * math.cos(tw) + np.cross(d, nrm) * math.sin(tw)
        out.append((tip - d * HEAD_L, d, np.cross(d, nrm), HEAD_L, HEAD_W))
    out.append((wpt(DART_S[1], DART_OFF), AX, np.cross(AX, UPW), HEAD_L * LAID_HEAD, HEAD_W * LAID_HEAD))
    return out


def paint_glass(p, n):
    """the dawnglass leaf heads (FIX PASS 1, review: 'flat saturated blue gems'): pale icy silver-blue as the concept,
    carved veins running out from the midrib to the feathered edge a step darker, the rim a step paler, no grain"""
    best = np.full(len(p), 1e9)
    s_ = np.zeros(len(p))
    a_ = np.zeros(len(p))
    L_ = np.ones(len(p))
    W_ = np.ones(len(p))
    for base, d, w, L, W in _leaf_frames():
        q = p - base
        s, a = q @ d, q @ w
        dist = np.linalg.norm(q - np.outer(s, d), axis=1)
        m = dist < best
        best[m], s_[m], a_[m], L_[m], W_[m] = dist[m], s[m], a[m], L, W
    u = np.clip(s_ / L_, 0, 1)
    rim = np.clip(np.abs(a_) / (W_ * 0.9), 0, 1)
    vein = np.abs(np.sin((u * 7.0 - rim * 1.3) * math.pi))
    vein = np.clip((vein - 0.82) / 0.18, 0, 1) * _ss(0.12, 0.35, rim)
    # closing ULK-M3 ('matte frosted heads'): a thin bright rim along the feathered edge and a clear core (the gloss
    # lobe is the roughness, GLASS_ROUGH, set in the baked roughness map by post_paint)
    v = (0.90 + 0.06 * np.clip(n[:, 2], -1, 1)) * (1 - 0.22 * vein) * (1 + 0.38 * _ss(0.80, 0.97, rim))
    v = v * (1 - 0.10 * np.exp(-(rim / 0.25) ** 2))
    col = _hl("#9FB4C6") * v[:, None]
    # (CW5 r2 refix, ULK-M3: the heads still read matte) glass is painted by its contrast: a deep clear core toward the
    # midrib and the head's root, the sky's hard streak down one flank, its small second glint on the other
    core = np.exp(-(rim / 0.42) ** 2) * (1.0 - 0.55 * _ss(0.55, 0.95, u))
    col = col * (1 - 0.72 * core)[:, None] + _hl("#3F6480") * (0.72 * core)[:, None]
    a_n = np.clip(a_ / (W_ * 0.9), -1, 1)
    streak = np.exp(-((a_n - 0.46 + 0.18 * u) / 0.075) ** 2) * _ss(0.10, 0.28, u) * _ss(0.95, 0.72, u)
    gl2 = np.exp(-((a_n + 0.52) / 0.05) ** 2) * np.exp(-((u - 0.62) / 0.16) ** 2)
    w_ = np.clip(0.95 * streak + 0.75 * gl2, 0, 1)[:, None]
    return col * (1 - w_) + _hl("#F2F8FC") * w_


def paint_eyeband(p, n):
    """the carved eye band (FIX PASS 1, review: 'the projected swirl carving reads as a walnut / brain'): plain dark
    carved wood, its incised top line and notches a step darker, the top bevel catching a little light, the eye slit
    an ink line along the bottom groove; matte"""
    z = p[:, 2] - BAND_Z
    carve = _band_carve(p) / 0.0022 + 0.8 * _band_notch(p)
    v = (0.92 + 0.05 * NOISE(p, 40.0)) * (1 - 0.40 * np.clip(carve, 0, 1)) * (1 + 0.12 * _ss(0.010, 0.019, z))
    v = v * (0.85 + 0.20 * np.clip(-n[:, 1], 0, 1))
    col = _hl("#4A382B") * v[:, None]
    slit = np.exp(-((z - (-BAND_H + 0.006)) / 0.0035) ** 2) * (n[:, 1] < 0.2)
    return col * (1 - slit[:, None]) + _hl("#17161A") * slit[:, None]


def paint_tail(p, n):
    """the hood's tail streamer: the hood's ochre a step darker (it must not out-read the hood), soft lengthwise folds,
    the underside and the far end in shade"""
    S, _u = _catmull(TAIL_PTS)
    D2 = ((p[:, None, :] - S[None]) ** 2).sum(-1)
    i = np.argmin(D2, axis=1)
    t = i / (len(S) - 1)
    fold = np.sin(t * 38.0 + 2.5 * NOISE(p, 14.0))
    v = (0.90 + 0.08 * fold) * (0.80 + 0.22 * np.clip(n[:, 2] * 0.5 + 0.5, 0, 1)) * (1 - 0.14 * t)
    return _hl("#86704F") * v[:, None]


def skirt_fade(c, p, n):
    """the concept's sand-faded lower skirt: the hem's last 25 cm dusted toward pale sand in streaks"""
    z = p[:, 2]
    k = _ss(0.86, 0.62, z) * (0.75 + 0.25 * NOISE(p * np.array([3.0, 3.0, 0.6]), 6.0))
    k = np.clip(k, 0, 1) * 0.7
    sand = _hl("#85755C") * (0.92 + 0.10 * NOISE(p, 30.0))[:, None]
    return c * (1 - k[:, None]) + sand * k[:, None]


def paint_quiver(p, n):
    """the linen case (closing ULK-M3: 'dark brush strokes'): linen paint aligned with its wound folds (the sculpt's
    _quiver_wrap), lit on the ridges, a running stitch round the lip, the lower end worn darker"""
    q = p - Q_BOT
    t = q @ Q_U
    w = q @ Q_W
    u = (t + 0.35 * w) * 55.0 + 0.4 * NOISE(p, 5.0)
    ridge = np.abs(np.sin(u))
    lip = _ss(0.44, 0.47, t)
    stitch = (np.sin(w * 260.0 + q @ Q_N * 260.0) > 0.55) * np.exp(-((t - 0.455) / 0.004) ** 2)
    v = (0.86 + 0.16 * ridge) * (1 + 0.05 * NOISE(p, 25.0)) * (0.86 + 0.18 * np.clip(n[:, 2] * 0.5 + 0.5, 0, 1))
    v = v * (1 - 0.14 * (1 - _ss(0.0, 0.14, t))) * (1 - 0.10 * lip) * (1 - 0.45 * stitch)
    col = _hl("#9C8D72") * v[:, None]
    # the bindings, painted (CW5 r2 refix, ULK-M3): two leather straps under the mouth and twisted cord lashings lower
    # down, closed round the case, each with a lit top edge and a shadow on the linen under it
    L_ = float(np.linalg.norm(Q_TOP - Q_BOT))
    for c_, hw_, leather in ((L_ - 0.085, 0.014, True), (L_ - 0.125, 0.014, True), (0.34, 0.010, False), (0.12, 0.010, False)):
        d_ = t - c_
        band = _ss(hw_ + 0.0012, hw_ - 0.0012, np.abs(d_))
        if leather:
            b_ = _hl("#4E3A2A") * ((1 + 0.05 * NOISE(p, 60.0)) * (1 + 0.30 * np.exp(-((d_ - hw_ + 0.002) / 0.002) ** 2)))[:, None]
        else:
            ph = (t + 0.45 * w) / 0.0075 + 0.3 * NOISE(p, 30.0)
            b_ = _hl("#5A4431") * (0.70 + 0.48 * np.sin(np.pi * (ph - np.floor(ph))))[:, None]
        under = np.exp(-(np.maximum(-d_ - hw_, 0.0) / 0.006) ** 2) * (d_ < -hw_)
        col = col * (1 - 0.30 * under)[:, None]
        col = col * (1 - band)[:, None] + b_ * band[:, None]
    return col


def paint_torso(p, n):
    """the wrapped tunic (closing ULK-M3: projected strokes that ignored the folds): painted from the sculpt's own
    cross folds (_cross_folds: diagonals converging on the sash), each fold lit on its upper face and shaded under,
    a darker overlap edge of the wrap down the front, worn soft"""
    x, z = p[:, 0], p[:, 2]
    u = (np.abs(x) * 0.9 + (1.40 - z)) * 38.0 + 0.6 * NOISE(p, 3.0)
    fold = np.abs(np.sin(u)) * 2.0 - 1.0                  # the sculpt's fold field (-1 groove .. 1 crest)
    a = np.clip((1.42 - z) / 0.2, 0.2, 1.0)
    edge = np.exp(-((x + 0.012 * (1.40 - z) * 3.0 - 0.02) / 0.010) ** 2) * (p[:, 1] < -0.05) * (z < 1.46)
    v = (1.0 + 0.16 * fold * a) * (1 + 0.05 * NOISE(p, 20.0)) * (0.84 + 0.22 * np.clip(n[:, 2] * 0.5 + 0.5, 0, 1))
    v = v * (1 - 0.30 * edge)
    return _hl("#5E5245") * v[:, None]


PROC = {"legs": paint_legs, "wraps": paint_wraps, "boots": paint_boots, "hand_R": paint_hands, "hand_L": paint_hands,
        "sleeves": paint_sleeves, "hood_tail": paint_tail, "dart_shaft": paint_dart_shaft, "eyeband": paint_eyeband,
        "thrower": paint_thrower, "crest_shafts": paint_shafts, "crest_heads": paint_glass, "dart_head": paint_glass,
        "quiver": paint_quiver, "torso": paint_torso}


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
            # FIX PASS 2: the projected fold strokes keep half their depth below 82 % of the hood's colour (a dark
            # painted crease no longer cuts the shell's side); the hollow round the face is shaded after
            rl = _lum(c) / max(float(_lum(tgt)), 1e-4)
            lift = np.where(rl < 0.82, (0.82 - (0.82 - rl) * 0.5) / np.maximum(rl, 1e-4), 1.0)
            c = c * lift[:, None]
            c = hood_shade(c, P[m], N[m])
        elif name == "head":
            c = face_shade(c, P[m], N[m])
        elif name == "skirt":
            c = skirt_fade(c, P[m], N[m])
        elif name == "eyeband":
            # the eye slit: an ink line along the band's lower groove, the carved relief's recesses a step darker
            pz_ = P[m][:, 2]
            slit = np.exp(-((pz_ - (BAND_Z - BAND_H + 0.006)) / 0.0052) ** 2) * (N[m][:, 1] < 0.2)     # (r2 refix, ULK-V1: wider, reads at card size)
            c = c * (1 - slit[:, None]) + _hl("#17161A") * slit[:, None]
        L[m] = c
        log(f"  tone {name}: -> {hx}")
    _glass_roughness(part, names, log)
    L = np.clip(L, 0.0, None)
    cap = np.full(len(K), MAX_LIN)                       # (r2 refix) the glass's painted sky goes above the cloth cap
    cap[np.isin(K, [i for i, nm in enumerate(names) if nm in GLASS_PARTS])] = 0.88
    L = L * np.minimum(1.0, cap / np.maximum(L.max(1), 1e-6))[:, None]     # cap keeping the hue (no bleaching)
    lin[idx] = L
    out = project._srgb(lin).astype(np.float32)
    iy, ix = project.nearest_index(have)
    return out[iy, ix]


GLASS_ROUGH = 0.14       # the dawnglass heads' roughness in the baked map (the brief: glossy, never emissive)
GLASS_PARTS = ("crest_heads", "dart_head")


def _glass_roughness(part, names, log=print) -> None:
    """closing ULK-M3: the dawnglass heads read frosted because the 256 ORM averaged their few texels with the matte
    cloth round them. Their roughness (and the empty margin round each head island, 3 texels, never another part's
    texels) is set to GLASS_ROUGH and the metallic to 0 in the baked body_rough image before it is packed (bake.py
    reads it after base_fn)"""
    import bpy
    ids = [i for i, nm in enumerate(names) if nm in GLASS_PARTS]
    if not ids:
        return
    cand = [im for im in bpy.data.images if im.name.endswith("_rough") and im.size[0] == part.shape[1]]
    if not cand:
        log("  glass roughness: no _rough image (skipped)")
        return
    r_ = cand[-1]
    w, h = r_.size
    b = np.empty(w * h * 4, dtype=np.float32)
    r_.pixels.foreach_get(b)
    b = b.reshape(h, w, 4)
    g = np.isin(part, ids)
    d = g.copy()
    for _ in range(3):                                   # a 4-neighbour dilation (no scipy in Blender's python)
        e = d.copy()
        e[1:] |= d[:-1]
        e[:-1] |= d[1:]
        e[:, 1:] |= d[:, :-1]
        e[:, :-1] |= d[:, 1:]
        d = e
    grow = d & (part < 0)
    m = (g | grow)[::-1]
    b[m, 0] = GLASS_ROUGH
    b[m, 1] = 0.0
    r_.pixels.foreach_set(b.ravel())
    log(f"  glass roughness {GLASS_ROUGH}: {int(g.sum())} texels (+{int(grow.sum())} margin)")


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

# skins: the brief's palettes re-colour the painting by role (project.recolour: skin / base per channel); the identity
# parts of each skin instead land their painted median ON the named colour (FIX PASS 1, review: the per-channel gain
# turned the Highrim hood near-white at 7 % saturation and the Long Evening hood violet: the ochre's own hue spread and
# the three.js sky light pushed them). Albedo targets sit where three.js renders them as the brief's named colours:
# Highrim a warm mid sandstone (hood and sleeve wraps, darker and warmer than white, L* ~57), Long Evening a red-leaning
# plum (hue 307 -> renders ~295) and smoked-amber heads.
SKIN_TONE = {
    # Highrim (FIX PASS 2, review: 'barely distinct from base, the hood hue drifted rose (22-27) instead of the named
    # tan #CDBB9C (hue 38, 24 %)'): the named sandstone tan. Measured on the pass-1 renders, the portrait's light turns
    # an albedo ~5 degrees redder and keeps ~0.6 of its saturation (base #826B4F hue 33 -> crown hue 29 L* 72; #7A6450
    # hue 29 -> hue 24 L* 68), so the albedo sits at hue 42 / 36 % to render ~38 / 23 %, a step lighter than the
    # base's ochre crown (~L* 76, never the pass-0 white L* 97: a warm mid tan, the rounded peak unchanged); the hood,
    # cowl and tail carry painted wind-carved sandstone strata (HIGHRIM_STRATA), the skin's own read
    # (skins build 15: #8A7B58 rendered the crown #CEB98F, hue 40 / 31 % / L* 76, a khaki in the shade -> a touch paler
    # and less saturated: the named sand, not olive)
    "ulkro_highrim": {"hood": "#918466", "cowl": "#8C7F61", "hood_tail": "#85785B", "sleeves": "#958866"},
    # Long Evening: a dark dusky plum, red-leaning (three.js lifts and blues it: #5C3A57 rendered orchid in the portrait,
    # #5A4054 lavender in three.js)
    "ulkro_long_evening": {"hood": "#4C3344", "cowl": "#483041", "hood_tail": "#452E3E",
                           "crest_heads": "#957F60", "dart_head": "#957F60"},
}
SKIN_REF = {"hood_tail": "#86704F", "sleeves": "#8A7A62", "crest_heads": "#9FB4C6", "dart_head": "#9FB4C6"}
_SKIN = {"id": None}
HIGHRIM_STRATA = ("hood", "cowl", "hood_tail")


def highrim_strata(p):
    """Highrim's wind-carved sandstone: level layers ~2.8 cm thick, wavy and wind-scoured, each its own value
    (+-10 %), nearly half a warmer rose-ochre, a thin darker bedding line between them (multiplier per texel, RGB)"""
    z = p[:, 2] + 0.010 * np.sin(p[:, 0] * 38.0 + 1.3) + 0.006 * np.sin(p[:, 1] * 51.0) + 0.008 * NOISE(p, 7.0)
    ph = z / 0.028
    band = np.floor(ph)
    f = ph - band
    v = 1.0 + 0.20 * (_hash(band) - 0.5)
    seam = np.exp(-((f - 0.04) / 0.07) ** 2) + np.exp(-((f - 1.04) / 0.07) ** 2)
    v = v * (1.0 - 0.16 * np.clip(seam, 0, 1)) * (1.0 + 0.03 * NOISE(p * np.array([4.0, 4.0, 0.5]), 9.0))
    warm = (_hash(band + 17.0) > 0.55)[:, None]
    tint = np.where(warm, np.array([1.06, 0.99, 0.90]), np.array([1.0, 1.0, 1.0]))
    return v[:, None] * tint


def _install_recolour() -> None:
    from common.hifi import project
    orig = project.recolour
    if getattr(orig, "_ulkro", False):
        return

    def recolour(img, maps, names, roles, base_pal, skin_pal, skip=None, log=print):
        out = orig(img, maps, names, roles, base_pal, skin_pal, skip=skip, log=log)
        tones = SKIN_TONE.get(_SKIN["id"]) or {}
        if not tones:
            return out
        part = maps["part"]
        iy, ix = project.nearest_index(part >= 0)
        pid = part[iy, ix]
        lin = project._lin(img)
        olin = project._lin(out)
        PP = None
        for i, nm in enumerate(names):
            if nm not in tones:
                continue
            m = pid == i
            # relative to the colour the BASE painted this part onto (its TONE / procedural base), so the skin keeps
            # the base's own light and shade exactly (a median over the hood's dark inside lifted the outside)
            ref = _hl(SKIN_REF.get(nm) or TONE[nm][0])
            r = lin[m] / np.maximum(ref, 1e-4)
            rl = (_lum(lin[m]) / max(float(_lum(ref)), 1e-4))[:, None]
            r = np.clip(r * 0.25 + rl * 0.75, 0, 4.0)
            c = _hl(tones[nm]) * r
            if _SKIN["id"] == "ulkro_highrim" and nm in HIGHRIM_STRATA:
                if PP is None:
                    PP = maps["P"][iy, ix]
                c = c * highrim_strata(PP[m].astype(np.float64))
            olin[m] = c * np.minimum(1.0, MAX_LIN / np.maximum(c.max(1), 1e-6))[:, None]   # hue-preserving cap
            log(f"  skin tone {nm}: median -> {tones[nm]}")
        return project._srgb(olin).astype(np.float32)
    recolour._ulkro = True
    project.recolour = recolour


_install_recolour()


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


# the laid dart leaves the thrower at the impact frame of every throw: its bone x_dart is scaled to nothing on the next
# frame and grows back (a fresh dart laid on) over 3 frames from the reload fraction (clip -> (release, reload))
DART_HIDE = {"attack1": (anim.IMPACT, 0.78), "attack2": (anim.IMPACT, 0.78), "cast_a1": (anim.IMPACT, 0.80)}


def _install_dart_keys() -> None:
    if getattr(anim.write_action, "_ulkro", False):
        return
    orig = anim.write_action

    def write_action(arm, name, poses, bones=None):
        act = orig(arm, name, poses, bones)
        if name == "death" and "x_crest0" in arm.pose.bones:
            n = len(poses)
            cb = None
            for layer in act.layers:
                for strip in layer.strips:
                    cb = strip.channelbag(act.slots[0], ensure=True)
            for i in range(len(CREST)):
                nm = f"x_crest{i}"
                locs = [crest_slide(i, f / max(1, n - 1)) for f in range(n)]
                for k in range(3):
                    fc = anim._new_fcurve(cb, f'pose.bones["{nm}"].location', k, nm)
                    fc.keyframe_points.add(n)
                    fc.keyframe_points.foreach_set("co", [c for f, l in zip(range(n), locs) for c in (f, l[k])])
                    fc.keyframe_points.foreach_set("interpolation", [1] * n)
                    fc.update()
            return act
        if name not in DART_HIDE or "x_dart" not in arm.pose.bones:
            return act
        n = len(poses)
        rel, rl = DART_HIDE[name]
        f_rel, f_rl = int(round(rel * (n - 1))), int(round(rl * (n - 1)))
        vals = []
        for f in range(n):
            if f <= f_rel or f >= f_rl + 3:
                v = 1.0
            elif f < f_rl:
                v = 0.001
            else:
                v = max(0.001, (f - f_rl) / 3.0)
            vals.append(v)
        cb = None
        for layer in act.layers:
            for strip in layer.strips:
                cb = strip.channelbag(act.slots[0], ensure=True)
        dp = 'pose.bones["x_dart"].scale'
        for i in range(3):
            fc = anim._new_fcurve(cb, dp, i, "x_dart")
            fc.keyframe_points.add(n)
            fc.keyframe_points.foreach_set("co", [c for f, v in zip(range(n), vals) for c in (f, v)])
            fc.keyframe_points.foreach_set("interpolation", [1] * n)
            fc.update()
        return act

    write_action._ulkro = True
    anim.write_action = write_action


_install_dart_keys()


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
    """a quick, compact overhand flick (FIX PASS 1: kept small so Hurl reads as the big throw): no step, a short turn,
    the thrower cocked up beside the right ear and snapped forward at f8 (the dart leaves, its bone hides), a short
    follow-through; the left hand stays low at her side"""
    wind = pz(lean=4.0, yaw=-12.0, drop=0.04, dy=0.01,
              R=rh((-0.12, 0.02, 0.14), aim=(0.06, -0.90, 0.42), up=(0.0, 0.42, 0.90), pole=(-1.0, 0.1, -0.15)),
              L=lh((0.04, -0.26, -0.30)))
    hit = pz(lean=10.0, yaw=10.0, drop=0.05, dy=-0.02,
             R=rh((-0.06, -0.36, 0.06), aim=(0.02, -1.0, 0.02), pole=(-0.8, 0.2, -0.5)),
             L=lh((0.08, -0.12, -0.40)))
    fol = pz(lean=12.0, yaw=14.0, drop=0.05, dy=-0.03,
             R=rh((0.0, -0.34, -0.14), aim=(0.20, -0.90, -0.38), pole=(-0.7, 0.3, -0.6)),
             L=lh((0.10, -0.06, -0.42)))
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


FEET_DRAW = feet_(l=(0.07, -0.26, 0.0), r=(-0.06, 0.16, 0.0), yl=-6.0, yr=-48.0, pl=6.0)
FEET_STEP = feet_(l=(0.06, -0.38, 0.10), r=(-0.05, 0.18, 0.0), yl=-2.0, yr=-40.0, pl=10.0, pr=-8.0)
FEET_THROW = feet_(l=(0.06, -0.50, 0.0), r=(-0.04, 0.24, 0.02), yl=0.0, yr=-26.0, pr=-30.0)


def gen_hurl() -> anim.Clip:
    """cast_a1 Hurl, 30 f, the dart leaves at f12 (FIX PASS 1, review: 'a copy of attack1'): a full-body javelin throw.
    f0-f10 she turns side-on (48 degrees), the weight sinks onto the back foot, the left arm points straight at the
    target and the thrower is drawn far back behind the shoulder above the head, the dart laid forward over it (the
    long bar drawn back); f10-f12 the front foot steps long and the hips drive through; at f12 the arm whips forward
    over the top (the dart leaves, its bone hides); the body follows through into a deep lunge, the front knee bent,
    the throwing arm across to the left knee, the back heel up; recovers by f30"""
    g = G()
    load = pz(lean=0.0, yaw=-26.0, roll=3.0, drop=0.06, dy=0.05, feet=FEET_DRAW,
              R=rh((-0.16, 0.16, 0.06), aim=(0.06, -0.94, 0.34), up=(0.0, 0.34, 0.94), pole=(-0.9, 0.3, -0.2)),
              L=lh((0.06, -0.36, -0.10), pole=(0.7, 0.2, -0.6)))
    draw = pz(lean=-8.0, yaw=-48.0, roll=6.0, drop=0.09, dy=0.10, look=(4.0, 6.0, 0.0), feet=FEET_DRAW,
              R=rh((-0.10, 0.32, 0.16), aim=(0.10, -0.92, 0.38), up=(0.0, 0.38, 0.92), pole=(-0.8, 0.5, -0.1)),
              L=lh((0.08, -0.50, 0.06), pole=(0.5, 0.4, -0.7)))
    step = pz(lean=-2.0, yaw=-34.0, roll=3.0, drop=0.08, dy=0.03, look=(2.0, 4.0, 0.0), feet=FEET_STEP,
              R=rh((-0.12, 0.26, 0.20), aim=(0.08, -0.90, 0.42), up=(0.0, 0.42, 0.90), pole=(-0.8, 0.5, -0.1)),
              L=lh((0.10, -0.46, 0.0), pole=(0.5, 0.4, -0.7)))
    hit = pz(lean=16.0, yaw=20.0, drop=0.12, dy=-0.14, feet=FEET_THROW,
             R=rh((-0.04, -0.42, 0.14), aim=(0.03, -0.99, 0.10), pole=(-0.8, 0.2, -0.5)),
             L=lh((0.16, 0.06, -0.36), pole=(0.8, 0.4, -0.3)))
    fol = pz(lean=26.0, yaw=34.0, drop=0.15, dy=-0.17, feet=FEET_THROW,
             R=rh((0.12, -0.34, -0.22), aim=(0.40, -0.80, -0.45), pole=(-0.7, 0.3, -0.6)),
             L=lh((0.14, 0.16, -0.38), pole=(0.8, 0.4, -0.3)))
    hold = anim._with_hips(anim.lerp_pose(fol, hit, 0.15), (0, 0, -0.004))
    back = anim.lerp_pose(fol, g, 0.55)
    back["ik"].update(feet_(l=(0.05, -0.30, 0.06), r=(-0.03, 0.12, 0.0), pl=10.0, yr=-16.0))
    keys = [(0.0, g, "linear"), (0.12, load, "inout"), (0.30, draw, "out"), (0.345, step, "in"),
            (anim.IMPACT, hit, "accel"), (0.52, fol, "out"), (0.64, hold, "inout"), (0.84, back, "inout"),
            (1.0, g, "settle")]
    return clip("cast_a1", 30, keys, impact=anim.IMPACT, lags={"head": 1.5, "neck": 1.0})


def _leap(lean=24.0, lift=0.30):
    """the Bound's apex: a stretched diagonal from the trailing foot to the head; the left knee driven up in front,
    the right leg trailing straight behind, the toes pointed; the left arm reaching forward, the thrower trailing low
    behind on the right; the head up toward the landing"""
    return pz(lean=lean, drop=-lift, dy=-0.10, look=(-16.0, 0.0, 0.0),
              feet=feet_(l=(0.03, -0.34, 0.60), r=(-0.03, 0.50, 0.44), pl=12.0, pr=-55.0, yl=0.0, yr=-6.0),
              R=rh((-0.14, 0.30, -0.28), aim=(0.14, 0.94, -0.30), up=(0.0, -0.30, -0.95), pole=(-0.9, 0.2, 0.3)),
              L=lh((0.14, -0.42, 0.14), pole=(0.6, 0.3, -0.6)))


def gen_bound() -> anim.Clip:
    """cast_a2 Bound, 15 f, apex f6 (FIX PASS 1, review: 'a two-foot tuck hop with T-pose arms'): a skip-step (a dip
    on the right foot, arms swinging back) and a long leap: at f6 a stretched diagonal, the left knee up, the right
    leg trailing, the left arm reaching, the thrower trailing behind; she lands on the left foot already running"""
    g = G()
    dip = pz(lean=20.0, drop=0.12, dy=-0.02, feet=feet_(l=(0.03, -0.12, 0.06), r=(-0.02, 0.10, 0.0), pl=10.0, pr=-14.0),
             R=rh((-0.12, 0.20, -0.34), aim=(0.20, -0.96, -0.12)), L=lh((0.10, 0.24, -0.38)))
    push = pz(lean=24.0, drop=0.02, dy=-0.06, look=(-8.0, 0.0, 0.0),
              feet=feet_(l=(0.03, -0.26, 0.30), r=(-0.03, 0.22, 0.04), pl=14.0, pr=-40.0),
              R=rh((-0.12, 0.26, -0.32), aim=(0.15, 0.80, -0.58), up=(0.0, -0.58, -0.80), pole=(-0.9, 0.2, 0.3)),
              L=lh((0.12, -0.34, 0.0), pole=(0.6, 0.3, -0.6)))
    apex = _leap()
    land = pz(lean=18.0, drop=0.10, dy=-0.10, feet=feet_(l=(0.03, -0.30, 0.0), r=(-0.03, 0.36, 0.16), pr=-40.0),
              R=rh((-0.06, -0.10, -0.40), aim=(0.20, -0.96, -0.16)), L=lh((0.12, 0.20, -0.40)))
    end = run_pose(0.25)
    keys = [(0.0, g, "linear"), (0.14, dip, "inout"), (0.27, push, "out"), (anim.IMPACT, apex, "out"),
            (0.75, land, "in"), (1.0, end, "inout")]
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
    """struck, she staggers back, her knees go and she sits down hard, then rolls onto her back with a twist toward her
    left side (FIX PASS 1: the brief's fall; was face-down): the crest of darts spills sideways along the ground beyond
    her right shoulder, the thrower flung out flat from her right hand, the head fallen to her left (the hood's tail
    lies along the ground, never stands up), at rest"""
    g = G()
    hip_h = skel.rest_point("hips").z
    recoil = pz(lean=-12.0, yaw=8.0, drop=0.04, dy=0.06, look=(-14.0, 0.0, 0.0),
                R=rh((-0.14, -0.02, -0.36), aim=(0.6, -0.6, -0.5)), L=lh((0.20, 0.02, -0.36)))
    stagger = pz(lean=-8.0, yaw=16.0, drop=0.13, dy=0.10, look=(-6.0, 0.0, 0.0),
                 feet=feet_(l=(0.04, 0.14, 0.0), r=(-0.03, 0.18, 0.0), yl=10.0, yr=-20.0),
                 R=rh((-0.20, -0.04, -0.34), aim=(0.5, -0.6, -0.6)), L=lh((0.24, -0.04, -0.32)))
    sit = anim.merge(anim.arms_relaxed(), anim.P(hips=(-28, 10, 0), spine=(10, 4, 0), chest=(8, 4, 0), neck=(6, 0, 0),
                                                  head=(4, 0, 0)))
    sit["hips_loc"] = (0.0, 0.22, -hip_h * 0.70)
    sit["ik"] = dict(feet_(l=(0.04, -0.10, 0.0), r=(-0.03, -0.04, 0.0), yl=12.0, yr=-18.0))
    sit["ik"].update(rh((-0.20, 0.0, -0.34), aim=(0.5, -0.6, -0.6)))
    sit["ik"].update(lh((0.22, 0.06, -0.34)))
    down = anim.merge(anim.arms_relaxed(), anim.P(hips=DEATH_HIPS, spine=(6, 8, 0), chest=(6, 8, 0), neck=(10, 0, 0),
                                                  head=(8, 26, 0), thigh_L=(14, 0, 8), shin_L=(-26, 0, 0),
                                                  foot_L=(20, 0, 0), upper_arm_L=(-10, 0, 10), forearm_L=(40, 0, 0),
                                                  **DEATH_LEG_R))
    down["hips_loc"] = DEATH_LOC(hip_h)
    down["ik"] = {"hand.R": HT(pos=DEATH_HAND_R, pole=(-0.6, 0.0, 1.0)),
                  "aim.R": AimRoll(DEATH_AIM_R, 1.0, (0.0, 0.0, 1.0))}
    # the crest darts (FIX PASS 2): rattle in the quiver as she sits, knocked out of the fan as her back hits the ground
    # (each pivots at the quiver's mouth onto the ground, spread wide, turned on its own axis), settling on the bounce
    for i, (rx, ry, rz) in enumerate(CREST_SPILL):
        sit[f"x_crest{i}"] = (rx * 0.15, ry * 0.2, rz * 0.12 + (4.0 if i % 2 else -4.0))
        down[f"x_crest{i}"] = (rx * 0.9, ry * 0.8, rz * 0.9)
    bounce = anim.add(down, anim.P(spine=(-4, 0, 0), chest=(-4, 0, 0), head=(-5, 0, 0)))
    bounce["hips_loc"] = tuple(a + b for a, b in zip(DEATH_LOC(hip_h), (0.0, 0.0, 0.035)))
    for i, (rx, ry, rz) in enumerate(CREST_SPILL):
        bounce[f"x_crest{i}"] = (rx * 1.08, ry * 1.05, rz * 1.06)
    rest = anim.add(down, anim.P(head=(0, 4, 0)))
    for i, s_ in enumerate(CREST_SPILL):
        rest[f"x_crest{i}"] = tuple(s_)
    N = 45
    # the skirt lying under her (closing ULK-M2): its back and side panels lifted toward her front (= up, on her back)
    # against the spring's gravity, so the felt lies along the ground under the legs instead of through it
    def lift(p, b_, s_):
        p = dict(p)
        p["skirt_lift"] = (b_, s_, 0.0)
        return p
    g, recoil, stagger = lift(g, 0.0, 0.0), lift(recoil, 0.0, 0.0), lift(stagger, 0.0, 0.0)
    sit, down, bounce, rest = lift(sit, 20.0, 10.0), lift(down, 75.0, 40.0), lift(bounce, 75.0, 40.0), lift(rest, 75.0, 40.0)
    keys = [(0.0, g, "linear"), (0.10, recoil, "snap"), (0.28, stagger, "inout"), (0.46, sit, "in"),
            (0.66, down, "in"), (0.74, bounce, "out"), (0.86, rest, "inout"), (1.0, rest, "linear")]
    fn = anim.keyed(keys)

    def sample(t):
        return floor_lift(skel, fn(t))
    return anim.Clip("death", N, False, sample)


# closing ULK-M2: the held death sank shin.R / foot.R 0.20 m into the floor (the right leg hung straight down off the
# rolled pelvis); the right knee now bends up with the sole on the ground (thigh flexed, shin folded back)
DEATH_LEG_R = dict(thigh_R=(46, 0, -6), shin_R=(-72, 0, 0), foot_R=(18, 0, 0))
FLOOR_PTS = None


def _floor_probes(skel) -> list:
    """(bone, rest point) probes for floor_lift: a subsample of the bound body's vertices on the legs, the hands and
    the thrower (each carried rigidly by its dominant bone), else the soles' rest-floor points and the knuckles"""
    keep = ("foot.", "toe.", "shin.", "hand.", "prop.R", "x_dart")
    pts = []
    for o in bpy.data.objects:
        if o.type != "MESH" or not o.vertex_groups or o.name.endswith("_high"):
            continue
        names = [g.name for g in o.vertex_groups]
        if not any(n.startswith("foot.") for n in names):
            continue
        mw = o.matrix_world
        for i, v in enumerate(o.data.vertices):
            if not v.groups or i % 7:
                continue
            g = max(v.groups, key=lambda x: x.weight)
            nm = names[g.group]
            if nm.startswith(keep) and nm in skel.rest:
                pts.append((nm, mw @ v.co))
    if len(pts) > 60:
        scene.log(f"ulkro floor probes: {len(pts)} body vertices")
        return pts
    pts = []
    # no bound body in this process: conservative rings round the leg, hand and thrower bones (rest frame)
    rings = {"shin": 0.065, "foot": 0.055, "toe": 0.035, "hand": 0.05}
    for s_ in "LR":
        for b, r in rings.items():
            nm = f"{b}.{s_}"
            R_ = skel.rest[nm]
            for t in (0.0, 0.25, 0.5, 0.75, 1.0):
                for k in range(8):
                    a = 2 * math.pi * k / 8
                    pts.append((nm, R_ @ V((r * math.cos(a), skel.length[nm] * t, r * math.sin(a)))))
    for t in np.linspace(THROWER_S[0], DART_S[2], 12):
        pts.append(("prop.R", V(tuple(wpt(float(t))))))
    scene.log(f"ulkro floor probes: {len(pts)} bone rings (no bound body found)")
    return pts


def floor_lift(skel, p: dict, floor: float = 0.004) -> dict:
    """closing ULK-M2 (floor gate, art/tools/clip_floor.py): lift the pose's hips until the legs, the hands and the
    thrower stay on or above the floor (probes: _floor_probes, carried by their bones' pose). The held keys are posed
    on the floor, so the lift acts only in the fall's blends and the body never floats in a hold"""
    global FLOOR_PTS
    if FLOOR_PTS is None:
        FLOOR_PTS = [(b, skel.rest[b].inverted() @ q) for b, q in _floor_probes(skel)]
    # a foot still partly on its IK plant (the sit -> lying blend) rises by less than the hips: iterate
    for _ in range(8):
        M = skel.fk(anim.resolve(skel, p))
        lo = min((M[b] @ q).z for b, q in FLOOR_PTS)
        if lo >= floor - 0.002:
            return p
        p = dict(p)
        h = p.get("hips_loc", (0.0, 0.0, 0.0))
        p["hips_loc"] = (h[0], h[1], h[2] + (floor - lo) * 1.5)
    return p


DEATH_HIPS = (-80.0, 0.0, 22.0)          # on her back, rolled toward her left side about the spine
# each crest dart's spill (x_crest<i> local euler, deg: +X tips it back off her back, +Y turns it on its axis,
# +Z swings it toward her left in her back's plane, - toward her right shoulder)
CREST_SPILL = [(0.0, 20.0, 38.0), (0.0, -30.0, -6.0), (0.0, 45.0, 14.0), (0.0, -15.0, -62.0), (0.0, 30.0, -26.0)]
# ... and how far each slides out of the quiver along its own (spilled) axis (m), so they lie scattered and crossing,
# not as a fan round the mouth (bone location keys written for death only, _install_dart_keys)
CREST_SLIDE = (0.06, 0.30, 0.16, 0.10, 0.34)
CREST_SLIDE_T = (0.50, 0.70)             # the slide eases in between these clip fractions (the sit -> on her back)


def crest_slide(i, t):
    """x_crest<i>'s pose location (bone rest frame) at death clip fraction t: CREST_SLIDE[i] metres along the dart's
    spilled direction"""
    w = _ss(CREST_SLIDE_T[0], CREST_SLIDE_T[1], t)
    if w <= 0:
        return (0.0, 0.0, 0.0)
    from mathutils import Euler
    rx, ry, rz = CREST_SPILL[i]
    v = Euler((math.radians(rx), math.radians(ry), math.radians(rz)), "XYZ").to_matrix() @ V((0.0, CREST_SLIDE[i] * w, 0.0))
    return tuple(v)


def DEATH_LOC(hip_h):
    return (0.0, 0.18, -hip_h + 0.210)       # closing ULK-M2: the shoulders and the skirt under her rest ON the floor (were 2.2 / 6 cm under)


DEATH_HAND_R = (-0.62, 0.30, 0.115)     # closing ULK-M2: the flung thrower lies ON the floor (was 5 cm under)
DEATH_AIM_R = (0.25, -0.97, 0.0)


def gen_recall() -> anim.Clip:
    """recall (CW5 r2 refix, par:ulkro: head 3.3 cm, hips 1.2 cm, a nearly frozen loop): one performance, no loop; the
    client spans it over the whole channel, 5.5 s of keys over RIFT's 7 s. A long step down onto her right knee, the
    thrower swung upright and stamped on its knob; she reaches over her shoulder and counts three darts, each lifted
    out of the row with the chest turning after it and the head following; the hand drops to her knee and she looks up
    to the far horizon; she leans on the thrower, pushes up off the knee and is standing as the recall lands. The
    thrower's hand stays absolute in every key (a lerp between rel and pos targets would jump). First = last."""
    N = 165
    # (CW5 round 3, minor:ulkro-recall-patch: the trailing foot's plant 12 mm higher: its toe held at -0.021 m against the
    # floor gate's -0.02; the keys' thinning takes the rest, the 4 mm lift in optimize below)
    FK = feet_(l=(0.04, -0.30, 0.0), r=(-0.03, 0.40, 0.052), pl=0.0, pr=-62.0, yl=4.0, yr=-10.0)
    A_K, U_K = (0.0, -0.05, 1.0), (0.0, -1.0, 0.0)
    P_R, P_L = (-0.8, 0.4, -0.3), (0.5, -0.6, 0.5)
    RK = np.array((-0.30, -0.24, 0.47))

    def R_(off=(0.0, 0.0, 0.0), a=A_K, u=U_K):
        return {"hand.R": HT(pos=tuple(RK + np.array(off)), pole=P_R), "aim.R": AimRoll(tuple(_n(a)), 1.0, tuple(u))}

    def kn(drop=0.40, lean=6.0, yaw=8.0, look=(8.0, -26.0, 0.0), L=(-0.27, 0.06, 0.12), r=(0.0, 0.0, 0.0), pole=P_L):
        return pz(lean=lean, yaw=yaw, drop=drop, dy=0.04, look=look, feet=FK, R=R_(r), L=lh(L, pole=pole))

    R_ST = {"hand.R": HT(pos=(-0.28, -0.20, 0.985), pole=POLE_R), "aim.R": AimRoll(tuple(AX), 1.0, tuple(UPW))}
    stand = pz(R=R_ST)
    step = pz(lean=9.0, drop=0.13, dy=0.02, look=(5.0, 0.0, 0.0),
              feet=feet_(l=(0.04, -0.20, 0.07), r=(-0.02, 0.12, 0.0), pl=8.0, yl=4.0, yr=-10.0),
              R={"hand.R": HT(pos=(-0.30, -0.26, 0.92), pole=P_R), "aim.R": AimRoll(tuple(_n((0.25, -0.10, 0.96))), 1.0, tuple(U_K))})
    sink = pz(lean=11.0, yaw=4.0, drop=0.30, dy=0.03, look=(10.0, 0.0, 0.0),
              feet=feet_(l=(0.04, -0.30, 0.0), r=(-0.03, 0.34, 0.15), pr=-44.0, yl=4.0, yr=-10.0), R=R_((0.0, 0.0, 0.26)))
    stamp = kn(drop=0.395, lean=13.0, yaw=2.0, look=(22.0, 0.0, 0.0), L=(0.02, -0.12, -0.22), pole=POLE_L)
    keys = [(0.0, stand, "linear"), (0.07, step, "inout"), (0.135, sink, "inout"), (0.175, stamp, "accel"),
            (0.235, kn(look=(6.0, -14.0, 0.0), L=(0.0, -0.08, -0.16), pole=POLE_L), "out")]
    t0 = 0.30
    for x, turn in ((-0.20, 4.0), (-0.28, 10.0), (-0.36, 16.0)):                # three darts along the row
        keys += [(t0, kn(yaw=turn, look=(6.0, -18.0 - 1.4 * turn, 0.0), L=(x, 0.06, 0.09)), "inout"),
                 (t0 + 0.045, kn(drop=0.385, yaw=turn + 2.0, lean=3.0, look=(-2.0, -24.0 - 1.4 * turn, 4.0), L=(x - 0.02, 0.04, 0.23)), "inout"),
                 (t0 + 0.085, kn(drop=0.40, yaw=turn, look=(8.0, -18.0 - 1.4 * turn, 0.0), L=(x, 0.06, 0.10)), "inout")]
        t0 += 0.105
    keys += [(0.68, kn(drop=0.36, lean=-1.0, yaw=-4.0, look=(-18.0, 22.0, 3.0), L=(0.03, -0.14, -0.26), pole=POLE_L), "inout"),
             (0.755, kn(drop=0.36, lean=-1.0, yaw=-5.0, look=(-16.0, 26.0, 3.0), L=(0.03, -0.14, -0.26), pole=POLE_L), "linear"),
             (0.81, kn(drop=0.39, lean=18.0, yaw=2.0, look=(4.0, 0.0, 0.0), L=(0.03, -0.16, -0.30), r=(0.0, 0.0, 0.03), pole=POLE_L), "inout")]
    rising = pz(lean=13.0, drop=0.17, dy=0.02, look=(-4.0, 0.0, 0.0),
                feet=feet_(l=(0.04, -0.22, 0.0), r=(-0.03, 0.20, 0.064), pr=-26.0, yl=4.0, yr=-10.0),
                R={"hand.R": HT(pos=(-0.30, -0.24, 0.80), pole=P_R), "aim.R": AimRoll(tuple(_n((0.25, -0.10, 0.96))), 1.0, tuple(U_K))})
    keys += [(0.89, rising, "inout"), (0.97, stand, "inout"), (1.0, stand, "linear")]
    fn = anim.drag(anim.keyed(keys), N, {"head": 1.5, "neck": 1.0}, loop=True)

    def sample(t):
        w = float(_ss(0.22, 0.28, t) * (1.0 - _ss(0.76, 0.81, t)))
        b = anim.osc(t, 5) * w
        return anim.add(fn(t), anim.P(chest=(1.6 * b, 0, 0), spine=(0.6 * b, 0, 0)))

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
        # 0-0.32 jog in place (FIX PASS 1, review: 'nearly static'): three strides, knees up, a real bob, the left
        # arm pumping, the thrower bobbing with the body
        if t < 0.32:
            u = seg(t, 0.0, 0.32)
            env = min(1.0, math.sin(math.pi * u) * 1.6)
            ph = 2 * math.pi * 3 * u
            hl = max(0.0, math.sin(ph)) * 0.11 * env
            hr = max(0.0, -math.sin(ph)) * 0.11 * env
            p["ik"]["foot.L"] = FT((0.02, -0.07 - 0.04 * hl / 0.11, hl), -26.0 * hl / 0.11, 3.0)
            p["ik"]["foot.R"] = FT((-0.02, 0.08 - 0.04 * hr / 0.11, hr), -26.0 * hr / 0.11, -12.0)
            sw = math.sin(ph) * env
            lw = np.array(REST_L) + np.array((0.0, 0.10 * sw, 0.05 * abs(sw)))
            p["ik"].update(lh(tuple(lw)))
            p = anim.add(p, anim.P(chest=(2.0 * env, 3.0 * sw, 0), spine=(1.5 * env, 0, 0), head=(-2.0 * env, -2.0 * sw, 0)))
            p = anim._with_hips(p, (0.0, 0.0, -0.03 * env + 0.022 * abs(math.sin(ph)) * env))
            p = anim._nudge_hands(p, (0.0, 0.0, 0.015 * abs(math.sin(ph)) * env), (0.0, 0.0, 0.0))
        # 0.30-0.52 the left thumb along the quiver darts
        k = math.sin(math.pi * seg(t, 0.30, 0.52)) if 0.30 < t < 0.52 else 0.0
        if k > 0:
            lw = np.array(REST_L) * (1 - k) + np.array((-0.27, 0.05, 0.11)) * k
            p["ik"].update(lh(tuple(lw), pole=(0.85 - 0.25 * k, 0.35 - 0.85 * k, -0.25 + 0.65 * k)))
            p = anim.add(p, anim.P(head=(0, -16.0 * k, 0), chest=(0, 4.0 * k, 0)))
        # 0.52-0.74 a glance at the far horizon (to her left) on a long stride forward and back
        g2 = math.sin(math.pi * seg(t, 0.50, 0.74)) if 0.50 < t < 0.74 else 0.0
        if g2 > 0:
            st = math.sin(math.pi * seg(t, 0.50, 0.74)) ** 0.7
            lift = max(0.0, math.sin(2 * math.pi * seg(t, 0.50, 0.62))) * 0.06 if t < 0.62 else \
                max(0.0, math.sin(2 * math.pi * seg(t, 0.62, 0.74))) * 0.06
            p["ik"]["foot.L"] = FT((0.04, -0.07 - 0.26 * st, lift), 0.0, 3.0)
            p = anim._with_hips(p, (0.0, -0.10 * st, -0.03 * st))
            p = anim.add(p, anim.P(neck=(-3 * g2, 14 * g2, 0), head=(-5 * g2, 24 * g2, 0), chest=(2 * g2, 6 * g2, 0)))
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
    # FIX PASS 1 (review: 'the raised bracer hand and the thrower cover the face'): the thrower rests on her right
    # shoulder and points up and BACK behind the hood (never across the face); the shading hand rides above the brim,
    # palm down and out to her left side, so the eye band shows under it; the head turned to her left horizon
    # FIX PASS 2 (review: 'the pauldrons backlit into dark slabs beside the arms'): the elbows carried lower and more
    # forward (the right one down in front of the ribs under the thrower, the left out-forward under the shading
    # hand), so the stone plates stay over the shoulders instead of standing up on the raised upper arms
    hold = pz(lean=2.0, yaw=24.0, drop=0.03, look=(-8.0, 26.0, 0.0),
              feet=feet_(l=(0.05, -0.16, 0.0), r=(-0.04, 0.12, 0.0), yl=24.0, yr=0.0),
              R=rh((-0.04, -0.12, 0.02), aim=(-0.25, 0.70, 0.67), up=(0.0, -0.69, 0.72), pole=(-0.55, -0.35, -0.75)),
              L=lh((-0.02, -0.17, 0.33), pole=(0.85, -0.35, 0.15)))
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
    """the Bound's leap as its own clip (the follow-through of cast_a2): a skip, the stretched diagonal with the left
    knee up and the thrower trailing, the landing on the left foot"""
    g = G()
    dip = pz(lean=18.0, drop=0.10, dy=-0.02, feet=feet_(l=(0.03, -0.10, 0.05), r=(-0.02, 0.10, 0.0), pl=8.0, pr=-12.0),
             R=rh((-0.12, 0.18, -0.34), aim=(0.20, -0.96, -0.12)), L=lh((0.10, 0.22, -0.38)))
    air = _leap(lean=22.0, lift=0.26)
    land = pz(lean=16.0, drop=0.09, dy=-0.08, feet=feet_(l=(0.03, -0.26, 0.0), r=(-0.03, 0.30, 0.12), pr=-36.0),
              R=rh((-0.06, -0.10, -0.40), aim=(0.20, -0.96, -0.16)), L=lh((0.12, 0.20, -0.40)))
    keys = [(0.0, g, "linear"), (0.15, dip, "inout"), (0.42, air, "out"), (0.74, land, "in"), (1.0, g, "inout")]
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
    _SKIN["id"] = (ctx.skin or {}).get("id")
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
