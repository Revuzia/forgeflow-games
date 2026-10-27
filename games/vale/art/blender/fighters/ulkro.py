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
PALETTE = materials.bible_palette(sandstone="#A88B66", wood="#D9D1C1", cloth2="#9A9184", stone="#C4BDB1",
                                  dawnglass="#A9C3DC", cloth="#6A5E50", leather="#5B4637", under="#34302D",
                                  ironstone="#4A4540", ink="#17161A", accent="#3F9CFF", skin="#8A5E45",
                                  linen="#B9AE9C", wraps="#6B635A", suede="#7F6D59", carved="#6E5646")
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

SKINS: list = []
SKIN_FLAT: dict = {}


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
# the five crest darts: tilt from vertical toward her right (deg), base offset across the mouth (m), length
CREST = [(22.0, -0.040, 0.60), (29.0, -0.018, 0.62), (36.0, 0.004, 0.63), (43.0, 0.026, 0.61), (50.0, 0.046, 0.58)]
CREST_BACK = 17.0                                    # tipped back (deg)
DART_R = 0.0145
HEAD_L, HEAD_W, HEAD_T = 0.15, 0.030, 0.007          # the leaf head: length, half width, half thickness


def crest_dart(i):
    """(base inside the quiver, unit direction, tip) of crest dart i"""
    a, off, L = CREST[i]
    a, b = math.radians(a), math.radians(CREST_BACK)
    d = _n([-math.sin(a), math.sin(b) * 0.9, math.cos(a) * math.cos(b)])
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
    part("hood", hood, "sandstone", "bone:head", 2300, uvw=1.6)
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
    part("hood_tail", tail, "sandstone", "bone:head", 320, vs=0.6)

    # HEAD + FACE WRAP (rigid on the head) and the carved eye band
    head = Sculpt("head")
    head.add(Ellipsoid(HEAD_C, (0.084, 0.100, 0.118)), k=0.0)
    head.add(Ellipsoid(HEAD_C + (0.0, -0.035, -0.07), (0.07, 0.07, 0.06)), k=0.04)            # the wrapped jaw
    head.add(Capsule((0, 0.0, 1.50), (0, -0.01, 1.62), 0.058), k=0.04)                         # neck (under the cowl)
    head.sub(Ellipsoid((0, -0.135, 1.68), (0.03, 0.02, 0.05)), k=0.03)                          # soft nose-bridge valley
    head.add(Ellipsoid((0, -0.118, 1.665), (0.022, 0.018, 0.032)), k=0.02)                    # nose under the wrap
    part("head", _with_disp(head, hfolds(0.0035, 150.0, tilt=(0.25, 0.0)), 0.0035), "cloth2", "bone:head", 1000, vs=0.8)
    band = Sculpt("eyeband")
    ring = Torus((0.0, HEAD_C[1], BAND_Z), BAND_R[0], 0.011, axes=np.diag([1.0, BAND_R[0] / BAND_R[1], 1.0]), rz=BAND_H)
    band.add(ring.displaced(_band_carve, 0.003), k=0.0)
    band.add(RoundCone((0.0, -0.130, BAND_Z + 0.004), (0.0, -0.152, BAND_Z - 0.004), 0.016, 0.008), k=0.012)  # beak keel
    band.inter(HalfSpace((0, HEAD_C[1] + 0.035, BAND_Z), (0, 1, 0), 0.4), k=0.01)
    band.sub(Torus((0.0, HEAD_C[1], BAND_Z - BAND_H + 0.006), BAND_R[0] + 0.011, 0.004,
                   axes=np.diag([1.0, BAND_R[0] / BAND_R[1], 1.0]), rz=0.0035), k=0.002)       # the eye slit (ink)
    part("eyeband", band, "wood", "bone:head", 800, vs=0.5)

    # TORSO (heat weights): lean chest, narrow waist; the wrapped tunic's cross folds
    torso = Sculpt("torso")
    torso.add(Ellipsoid((0.0, -0.005, 1.30), (0.165, 0.115, 0.20)), k=0.0)
    torso.add(Ellipsoid((0.0, 0.005, 1.43), (0.195, 0.105, 0.085)), k=0.07)
    torso.add(Ellipsoid((0.0, 0.0, 1.13), (0.142, 0.103, 0.12)), k=0.08)
    for sx in (-1, 1):
        torso.add(Sphere((sx * 0.205, 0.0, 1.425), 0.062), k=0.05)
        torso.add(Ellipsoid((sx * 0.11, 0.02, 1.49), (0.09, 0.07, 0.05)), k=0.05)
    part("torso", _with_disp(torso, _cross_folds, 0.006), "cloth", "auto", 1800)
    cowl = Sculpt("cowl")
    cowl.add(Torus((0.0, 0.0, 1.548), 0.122, 0.052, axes=np.diag([1.0, 0.122 / 0.112, 1.0]), rz=0.05)
             .displaced(hfolds(0.008, 60.0, tilt=(0.35, 0.0)), 0.008), k=0.0)
    cowl.add(Ellipsoid((0.0, -0.10, 1.505), (0.135, 0.055, 0.07)).displaced(hfolds(0.009, 55.0, tilt=(0.5, 0.0)), 0.009),
             k=0.03)
    cowl.add(Ellipsoid((0.0, 0.075, 1.515), (0.15, 0.06, 0.06)).displaced(hfolds(0.008, 50.0), 0.008), k=0.03)
    part("cowl", cowl, "sandstone", ("zblend", "chest", "neck", 1.53, 1.60), 1400, uvw=1.3)
    straps = Sculpt("straps")
    for sx in (-1, 1):                     # the crossed straps: shoulder over the chest to the opposite hip, and the back
        fr = [(sx * 0.13, -0.075, 1.50), (sx * 0.07, -0.118, 1.38), (0.0, -0.128, 1.29), (-sx * 0.09, -0.118, 1.18),
              (-sx * 0.14, -0.09, 1.10)]
        strap(straps, fr, torso_normal, 0.018, 0.005)
        bk = [(sx * 0.13, 0.075, 1.50), (sx * 0.06, 0.112, 1.36), (-sx * 0.05, 0.112, 1.22), (-sx * 0.14, 0.085, 1.10)]
        strap(straps, bk, torso_normal, 0.017, 0.005)
    part("straps", straps, "leather", "auto", 700, vs=0.7)
    sash = Sculpt("sash")
    sash.add(Torus((0.0, 0.0, 1.105), 0.148, 0.045, axes=np.diag([1.0, 0.148 / 0.112, 1.0]), rz=0.042)
             .displaced(hfolds(0.004, 140.0), 0.004), k=0.0)
    sash.add(Ellipsoid((0.065, -0.122, 1.10), (0.04, 0.022, 0.034)), k=0.015)                     # the knot
    sash.add(RoundBox((0.085, -0.125, 1.02), (0.022, 0.006, 0.07), 0.005, axes=sdf.rot_y(-14)), k=0.012)   # its ends
    sash.add(RoundBox((0.045, -0.125, 1.03), (0.018, 0.006, 0.06), 0.005, axes=sdf.rot_y(10)), k=0.012)
    part("sash", sash, "leather", "auto", 900)

    # SHOULDER PLATES: two pale stone tiers each side (top tier on the shoulder, the lower one with the arm)
    for s, sx in (("R", -1), ("L", 1)):
        top = Sculpt(f"plate_{s}1")
        top.add(RoundBox((sx * 0.205, -0.004, 1.488), (0.092, 0.118, 0.013), 0.010, axes=sdf.rot_y(sx * 24))
                .displaced(chips(0.005, 9.0), 0.005), k=0.0)
        top.add(RoundBox((sx * 0.20, -0.004, 1.475), (0.07, 0.10, 0.016), 0.012, axes=sdf.rot_y(sx * 24)), k=0.012)
        part(f"plate_{s}1", top, "stone", ("dblend", f"shoulder.{s}", f"upper_arm.{s}", (sx * 0.16, 0.0, 1.50),
                                            (sx * 0.8, 0.0, -0.6), 0.03, 0.14), 400, vs=0.7)
        low = Sculpt(f"plate_{s}2")
        low.add(RoundBox((sx * 0.286, -0.004, 1.392), (0.058, 0.108, 0.012), 0.009, axes=sdf.rot_y(sx * 62))
                .displaced(chips(0.005, 9.0), 0.005), k=0.0)
        part(f"plate_{s}2", low, "stone", f"bone:upper_arm.{s}", 300, vs=0.7)

    # ARMS: pale wrapped sleeves (heat weights), dark bracers, sculpted fists (rigid on the hands)
    sl = Sculpt("sleeves")
    for sh, el, wr in ((SH_R, EL_R, WR_R), (SH_L, EL_L, WR_L)):
        sl.add(FlatCapsule(sh, el, 0.064, 0.060, 0.054, 0.052, side=(1, 0, 0)).displaced(wraps(0.006, 0.045, sh, el), 0.006),
               k=0.0)
        sl.add(Sphere(el, 0.054), k=0.03)
        sl.add(FlatCapsule(el, wr, 0.052, 0.050, 0.040, 0.038, side=(1, 0, 0)).displaced(wraps(0.005, 0.04, el, wr, phase=0.3),
                                                                                        0.005), k=0.02)
    part("sleeves", sl, "cloth2", "auto", 1700)
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
    part("bracers", br, "leather", "auto", 900)
    WK_R = _n(np.array([-0.2, -0.55, 0.8]))           # the right fist's knuckles: up and forward
    WK_L = _n(np.array([0.15, -0.9, -0.1]))           # the left: forward, the palm toward her
    part("hand_R", fist("hand_R", GRIP_R, AX, WR_R, WK_R, 0.024, 1.08, index_fwd=1.0), "skin", "bone:hand.R", 800, vs=0.55)
    part("hand_L", fist("hand_L", GRIP_L, AX, WR_L, WK_L, DART_R, 1.04, index_fwd=-1.0), "skin", "bone:hand.L", 750, vs=0.55)

    # SKIRT: the wrapped tunic's long skirt from the sash to the hem, split at the front (analytic hips/thigh weights)
    sk = Sculpt("skirt")
    shell = FlatCapsule((0.0, 0.0, 1.07), (0.0, 0.008, 0.57), 0.150, 0.110, 0.285, 0.185, side=(1, 0, 0))
    sk.add(shell.displaced(folds(0.010, 30.0, axis=0, phase=0.4, zfade=(1.0, 0.6)), 0.010), k=0.0)
    sk.sub(FlatCapsule((0.0, 0.0, 1.12), (0.0, 0.008, 0.52), 0.136, 0.096, 0.270, 0.170, side=(1, 0, 0)), k=0.004)
    sk.inter(HalfSpace((0, 0, 1.115), (0, 0, 1), 1.0), k=0.0)
    sk.inter(Displaced_plane((0, 0, 0.0), _hem), k=0.006)
    sk.sub(_Slit((0.025, -0.10), 0.86, 0.17, front=True), k=0.006)                     # the front opening
    sk.sub(_Slit((0.03, 0.10), 0.70, 0.045, front=False), k=0.006)                     # the back vent
    part("skirt", sk, "cloth", "skirt", 2200, uvw=1.2)

    # LEGS: dark trousers bloused at the knee, wrapped shins, soft suede boots
    legs = Sculpt("legs")
    for sx in (-1, 1):
        hip, knee, ank = np.array([sx * 0.095, 0.005, 0.945]), np.array([sx * 0.105, -0.01, 0.515]), np.array([sx * 0.115, 0.02, 0.085])
        legs.add(FlatCapsule(hip + (0, 0, 0.04), knee + (0, 0, 0.05), 0.088, 0.092, 0.068, 0.07, side=(1, 0, 0))
                 .displaced(folds(0.006, 40.0, axis=2, phase=sx), 0.006), k=0.0)
        legs.add(Ellipsoid(knee + (0.0, -0.005, 0.0), (0.072, 0.074, 0.06)).displaced(folds(0.008, 45.0, axis=0), 0.008), k=0.03)
        legs.add(FlatCapsule(knee, ank + (0, 0, 0.1), 0.05, 0.054, 0.042, 0.044, side=(1, 0, 0)), k=0.02)
    legs.add(Ellipsoid((0.0, 0.01, 0.93), (0.15, 0.105, 0.09)), k=0.05)
    part("legs", legs, "under", "auto", 1100)
    wr = Sculpt("wraps")
    for sx in (-1, 1):
        knee, ank = np.array([sx * 0.105, -0.01, 0.48]), np.array([sx * 0.115, 0.02, 0.12])
        wr.add(FlatCapsule(knee, ank, 0.060, 0.062, 0.050, 0.052, side=(1, 0, 0)).displaced(wraps(0.006, 0.05, knee, ank, slant=0.6), 0.006),
               k=0.0)
    part("wraps", wr, "wraps", "auto", 1000)
    boots = Sculpt("boots")
    for sx in (-1, 1):
        to = math.radians(sx * 6.0)
        fwd = np.array([math.sin(to), -math.cos(to), 0.0])
        ank = np.array([sx * 0.115, 0.02, 0.0])
        boots.add(RoundBox(ank + fwd * 0.065 + (0, 0, 0.045), (0.050, 0.130, 0.045), 0.04, axes=sdf.rot_z(math.degrees(to))), k=0.0)
        boots.add(Ellipsoid(ank + fwd * 0.15 + (0, 0, 0.04), (0.05, 0.06, 0.04)), k=0.03)        # rounded toe
        boots.add(FlatCapsule(ank + (0, 0, 0.04), ank + (0, 0, 0.16), 0.058, 0.064, 0.054, 0.058, side=(1, 0, 0)), k=0.04)
    boots.inter(HalfSpace((0, 0, 0.0), (0, 0, -1), 2.0), k=0.0)
    part("boots", boots, "suede", "auto", 1000)

    # QUIVER + CREST (one rigid piece on the chest): the linen tube, its leather bands and mouth, five darts
    qv = Sculpt("quiver")
    qc = (Q_TOP + Q_BOT) * 0.5
    qL = float(np.linalg.norm(Q_TOP - Q_BOT))
    qax = np.stack([Q_W, Q_N, Q_U])
    qv.add(RoundBox(qc, (Q_HW, Q_HD, qL * 0.5), 0.035, axes=qax).displaced(_quiver_wrap, 0.004), k=0.0)
    qv.add(RoundBox(Q_BOT + Q_U * 0.05, (Q_HW + 0.008, Q_HD + 0.008, 0.05), 0.03, axes=qax), k=0.005)    # the bottom cap
    qv.sub(RoundBox(Q_TOP + Q_U * 0.02, (Q_HW - 0.012, Q_HD - 0.012, 0.06), 0.02, axes=qax), k=0.006)      # the open mouth
    part("quiver", qv, "linen", "bone:chest", 900)
    qb = Sculpt("quiver_bands")
    for zz in (0.085, 0.125):
        qb.add(RoundBox(Q_TOP - Q_U * zz, (Q_HW + 0.006, Q_HD + 0.006, 0.013), 0.028, axes=qax), k=0.0)
    qb.add(RoundBox(Q_TOP - Q_U * 0.008, (Q_HW + 0.004, Q_HD + 0.004, 0.012), 0.026, axes=qax), k=0.0)    # the mouth's rim
    qb.sub(RoundBox(Q_TOP + Q_U * 0.02, (Q_HW - 0.012, Q_HD - 0.012, 0.06), 0.02, axes=qax), k=0.004)
    part("quiver_bands", qb, "leather", "bone:chest", 500, vs=0.7)
    shafts, heads, inlays = Sculpt("crest_shafts"), Sculpt("crest_heads"), Sculpt("crest_inlays")
    for i in range(len(CREST)):
        base, d, tip = crest_dart(i)
        hb = tip - d * HEAD_L
        shafts.add(Capsule(base, hb + d * 0.012, DART_R), k=0.0)
        shafts.add(Capsule(hb - d * 0.02, hb + d * 0.01, DART_R * 1.25), k=0.004)         # the binding under the head
        _leaf(heads, inlays, hb, d, np.cross(d, Q_W))
    part("crest_shafts", shafts, "wood", "bone:chest", 700, vs=0.5)
    part("crest_heads", heads, "dawnglass", "bone:chest", 900, vs=0.42)
    part("crest_inlays", inlays, "accent", "bone:chest", 400, vs=0.42)

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
    part("thrower", th, "wood", "bone:prop.R", 800, vs=0.6)
    lh, li = Sculpt("dart_head"), Sculpt("dart_inlay")
    _leaf(lh, li, wpt(DART_S[1], DART_OFF), AX, UPW, scale=1.1)
    part("dart_head", lh, "dawnglass", "bone:prop.R", 200, vs=0.42)
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
                        for c in (-0.01, self.T + 0.01)])
        return pts.min(0), pts.max(0)

    def d(self, P):
        q = P - self.b
        s, a, c = q @ self.dv, q @ self.w, q @ self.n
        u = (s - self.L * 0.47) / (self.L * 0.36)
        half = self.W * 0.58 * np.clip(1 - np.abs(u), 0, 1)
        dx = np.abs(a) - half
        top = self.T * 0.55 + 0.0024
        dz = np.maximum(c - top, self.T * 0.1 - c)
        return np.maximum(np.maximum(dx * 0.9, dz), np.abs(u) * self.L * 0.36 - self.L * 0.36)


def skin_extras(extra: dict) -> list:
    return []


def extra_materials(ctx) -> dict:
    """roles the bible set lacks: skin (bare hands), linen (the quiver), wraps (shin wraps), suede (boots)"""
    pal = dict(materials.BIBLE_PALETTE, **PALETTE)
    pal.update(ctx.palette)
    g = ctx.gradient
    return {"skin": materials.waxed_leather("skin", pal, "skin", g, rough=0.7),
            "linen": materials.heavy_cloth("linen", pal, "linen", g, weave=0.7),
            "wraps": materials.heavy_cloth("wraps", pal, "wraps", g, weave=0.6),
            "suede": materials.waxed_leather("suede", pal, "suede", g, rough=0.85),
            "leather": materials.waxed_leather("leather_matte", pal, "leather", g, rough=0.74)}


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

# ── motion (placeholder: the profile; bespoke clips below) ──────────────────────────────────────────────
BLOCKS: dict = {}
MOTION = anim.motion_profile(weight="light", weapon="one_hand", stance="low", run_ref_speed=3.5, blocks=BLOCKS)


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
