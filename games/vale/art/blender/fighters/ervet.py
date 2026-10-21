"""ervet: Glass blade (Breaker, Aubade). ART 2.0: sculpted volumes painted by concept projection + hand-tuned
procedural paint where the concept cannot be projected cleanly.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/ervet_plates.py --height 2.15   # plates
    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/ervet_fit.py
    python3 art/build.py fighter ervet --no-skins --clip-sheet

Brief: _design/fighters/ervet.md. Concept: _design/concept/ervet.webp (front + back, hand-painted).
Forms are numpy SDF volumes (common/hifi/sdf.py) fitted to the concept on a 10 cm grid (crest top 2.15 m,
the plates' scale).

Where the concept and the brief disagree the concept's PROPORTIONS win (a 1.31 m blade carried across the
front, the grip at the right hip, a tall kite helm under a transverse crest, a 0.8 m mantle, chalk arm
plates over dark wraps, a stone collar and a large blued back plate) and the brief's RULES win: no gems
(the painted blue gems are painted out, no glass studs), the gold trims become a matte ochre paint, the
accent is the face glass (slit, star, cheek lines), the crest's brow strip and the crossguard inlays, the
coat narrows to its hem and splits into two tails (inverted wedge; the legs read from behind).

Paint (`_paint_object`): the concept projection (blade-free body plates) carries the crest carving,
breastplate, belts, tabard, back plate, greaves and legs; parts the concept cannot paint cleanly from two
views are painted procedurally from the skin's LOOK colours (painterly value noise, top light, curvature
edge light): the dawnglass blades (pale body, deep core and fuller, pale bevels), crossguard, pommel and
grip, the mantle lames (jittered plates), the caps (carved stone, ochre bead), the whole helm (chalk, the
glass grooves inked with an anti-aliased border), the scarf (linen folds at its painted value), the coat
(blue-grey cloth, brown lining, ochre trims), the arm plates (chalk shells), the wraps, gloves and boots.

Three blade states (passive forms, CONTRACT §12 form-swapped parts): the whole blade `form='base'`, the
broken stub `form='hilt'`, the oversized blade `form='great'`; one grip, crossguard and accent shared.

Pipeline additions kept inside this module (art/blender/common is shared and not edited here):
  * `_paint_object` (project.paint_object wrapper): body projection + procedural paint (above);
  * `_recolour` (project.recolour wrapper): skins re-colour the projected parts hue-aware; the procedural
    parts are already painted in the skin's LOOK;
  * `extra_materials`: dawnglass at roughness 0.4 (a 0.14 glass mirrors the dark ground in game);
  * custom SDF prims (Extrude, BentPlate, Groove, CoatShell, LameRow, Blade) and parametric game meshes
    (lames_low, blade_low, visor_low) where a decimated voxel mesh would blur the form;
  * `_bind_part` (pipeline.bind_part wrapper): the coat's front flaps follow the hips/thighs, its two back
    tails hang on their own chains (cape_L / cape_R, 'coatmix' bind) driven by their own leg, so the tails
    swing with the stride and a strike bends the coat instead of swinging it as a board;
  * `_write_action` (anim.write_action wrapper): prop.R location keys (`prop.R_loc`) so `death` can drop
    the sword on the ground;
  * renders and the three.js QA show the base form only (+ one QA sheet per extra form);
  * no `channel` clip: Ervet channels nothing.
Helpers: proto/ervet_plates.py (plates), proto/ervet_fit.py (fit check), proto/ervet_poses.py (clip contact
sheets from the cached build, no rebuild), proto/ervet_preview.py (Workbench geometry preview, no bake).
"""
from __future__ import annotations

import json
import math
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy  # noqa: E402,F401
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

from common import anim, export, fighter, materials, mesh as libmesh, parts as libparts, pipeline, render, rig, scene  # noqa: E402,E501
from common.anim import Aim, FootTarget, HandTarget  # noqa: E402
from common.hifi import project, sdf  # noqa: E402
from common.hifi.sdf import (Capsule, Ellipsoid, FlatCapsule, HalfSpace, Lathe, RoundBox, RoundCone,  # noqa: E402
                             Sculpt, Sphere, Torus, Tube)

V = Vector
ID = "ervet"
TITLE = "Glass blade"
ROLE_MASS = "breaker"
ORIGIN = "aubade"
CARD = {"primary": "#B9C4CC", "secondary": "#5D6B7C"}

# rig fitted to the concept (crest top 2.15): helm crown 2.06, chin 1.83; shoulder joints x 0.29 at 1.63 under
# the mantle; elbows (0.33, 1.39); wrists (0.38, 1.12); hip joints x 0.11 at 0.99; knees 0.60; ankles x 0.205
PROPORTIONS = rig.proportions(height=2.06, head=0.24, neck=0.06, shoulder_width=0.58, hip_width=0.22, leg=0.885,
                              thigh_frac=0.44, arm=0.52, upper_arm_frac=0.47, hand=0.17, foot=0.30,
                              ankle_height=0.11, spine_curve=0.02, stance=0.095, toe_out_deg=24.0, knee_bend=0.015,
                              a_pose_deg=80.0, arm_forward_deg=3.0, elbow_bend_deg=14.0, shoulder_drop=0.165)
MATERIAL_SET = "bible"
PALETTE = materials.bible_palette(dawnglass="#B6CEE0", chalk="#CFCFCB", stone="#AEB6BD", cloth2="#C6C7C1",
                                  cloth="#6A7683", leather="#403D3B", ironstone="#3B4048", under="#303338",
                                  ink="#17181B", accent="#3F9CFF", wood="#7A5E46", lampresin="#BF8F52")
VALUE_GRADIENT_STOPS = materials.BIBLE_GRADIENT_STOPS
SOCKETS = {"weapon": "prop.R", "blade_tip": "x_blade_tip", "crossguard": "x_crossguard"}
# the victory hold: the blade planted at a long diagonal toward the frame centre, the mantle turned a quarter
SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.96, "yaw": 24.0, "pitch": -3.0, "sun": 1.45,
          "rim_cool": 0.35, "rim_warm": 0.5, "fill": 0.86}
TEXTURE_SIZE = 2048
TEXTURE_SIZES = {"normal": 512, "orm": 256}       # the ORM at 256: its roughness is per material
GLB_COMPRESS = True
ARMOUR_CONFORM = False
AO_INTO_BASE = 0.3

HEIGHT = 2.15             # crest top (the projection plates' scale)
PROJECTION = {"concept": "ervet", "height": HEIGHT}
NOISE = sdf.Noise(11)
VOXEL = 0.0065

# ── the sword frame (concept: guard centre (-0.29, 1.02), tip (0.74, 0.275); the blade tilts forward) ──
GUARD_XZ = np.array([-0.29, 1.02])
TIP_XZ = np.array([0.74, 0.275])
TILT_Y = -0.24                       # blade direction's Y per unit of its XZ length (point forward of the legs)
BLADE_ROLL = 30.0                    # deg: the flat turned up toward the high game camera (no edge-on rod)
BLADE_L = 1.31                       # whole blade (3D, from the guard)
STUB_L = 0.30
GREAT_L = 1.76                       # the ultimate's blade: +0.45 m of reach, clearly longer as well as wider
                                     # (the longest whose point stays above the ground in the bind pose)
BLADE_SHAPE = (0.150, 0.122, 0.026, 0.22)      # width at the guard, width before the point, thickness, point
STUB_SHAPE = (0.150, 0.142, 0.026, 0.5)
GREAT_SHAPE = (0.23, 0.18, 0.034, 0.36)
# ── the face (concept front, x/z in m): one slim tapered slit under a four-point star, two thin cheek lines ──
FACE_XC = 0.019                      # the slit's axis
STAR_C = (0.019, 2.044)              # the star's centre


def _slit_hw(z):
    """the slit's glass half width at height z (a slim taper to a point at 1.866)"""
    return float(np.interp(z, [1.866, 1.90, 1.95, 2.00, 2.032], [0.0, 0.0050, 0.0085, 0.0112, 0.0124]))


SLIT_ZS = [1.866, 1.88, 1.90, 1.925, 1.95, 1.975, 2.00, 2.018, 2.032]
STAR_PTS = [(FACE_XC + 0.017, 2.0400), (FACE_XC + 0.036, 2.0450), (FACE_XC + 0.017, 2.0505),
            (FACE_XC + 0.0080, 2.064), (FACE_XC + 0.0035, 2.088), (FACE_XC, 2.108), (FACE_XC - 0.0035, 2.088),
            (FACE_XC - 0.0080, 2.064), (FACE_XC - 0.017, 2.0505), (FACE_XC - 0.035, 2.0450),
            (FACE_XC - 0.017, 2.0400)]


def _slit_poly():
    """the glass outline (x, z), counter-clockwise: the tail's right edge up, the star, the left edge down"""
    right = [(FACE_XC + _slit_hw(z), z) for z in SLIT_ZS]
    left = [(FACE_XC - _slit_hw(z), z) for z in reversed(SLIT_ZS[1:])]
    return right + STAR_PTS + left


SLIT_POLY = _slit_poly()
# the cheek lines run just inside the face plate's edge (top outer -> bottom inner)
CHEEK_LINES = [[(-0.076, 1.984), (-0.068, 1.948), (-0.057, 1.905), (-0.042, 1.864)],
               [(0.111, 1.984), (0.103, 1.948), (0.090, 1.905), (0.073, 1.864)]]
CHEEK_HW = 0.0045                    # cheek glass half width
INK_W = 0.0042                       # the ink border round the glass
FACE_OUTLINE = [(0.018, 2.150), (-0.026, 2.143), (-0.062, 2.122), (-0.086, 2.085), (-0.094, 1.995), (-0.084, 1.930),
                (-0.060, 1.866), (-0.022, 1.840), (0.018, 1.831), (0.058, 1.840), (0.094, 1.866), (0.118, 1.930),
                (0.128, 1.995), (0.122, 2.085), (0.098, 2.122), (0.062, 2.143)]
BEVEL = {"blade": 0.026, "blade_hilt": 0.026, "blade_great": 0.045}
# the crossguard outline (u along the blade's width W, v along the blade D toward the point), right half:
# the concept's heavy carved chalk guard, 0.47 m across: thick arms (6 cm) sweeping toward the blade into
# flared tips, a langet point over the blade's base
GUARD_HALF = [(0.0, -0.060), (0.035, -0.046), (0.07, -0.027), (0.11, -0.012), (0.15, 0.004), (0.185, 0.028),
              (0.212, 0.058), (0.232, 0.090), (0.238, 0.118), (0.224, 0.138), (0.202, 0.120), (0.176, 0.090),
              (0.142, 0.066), (0.104, 0.056), (0.068, 0.058), (0.046, 0.076), (0.022, 0.100), (0.0, 0.120)]
GUARD_POLY = GUARD_HALF + [(-u, v) for u, v in reversed(GUARD_HALF[1:-1])]
GUARD_H = 0.026                      # half thickness (along the face normal)
LOZENGE = [(0.050, 0.0), (0.0, 0.019), (-0.050, 0.0), (0.0, -0.019)]
GUARD_INLAYS = [(0.132, 0.026, 21.0), (-0.132, 0.026, -21.0)]       # (u, v, angle deg) of the arm lozenges
CENTRE_DIAMOND = (0.0, 0.026, 0.024)                               # (u, v, half size)
# the pauldron caps seen from above (her left; mirrored for the right): curved stone plates bent over the
# shoulder, drooping down the back where the two meet behind the neck (the concept's back collar), the outer
# point upswept; the inner front edge stays outside the scarf
PAULDRON_OUTLINE = [(0.150, -0.168), (0.250, -0.192), (0.355, -0.140), (0.432, -0.020), (0.410, 0.062),
                    (0.330, 0.180), (0.200, 0.252), (0.070, 0.266), (0.005, 0.262), (0.024, 0.180),
                    (0.112, 0.105), (0.140, 0.020), (0.132, -0.090)]
# the rerebrace's two lames along the upper arm (fraction of its length from the shoulder: top, bottom; width at
# the top, at the bottom): the upper lame wider, overlapping the lower one (a step and a rim between them)
ARM_LAMES = ((0.20, 0.58, 0.082, 0.078), (0.53, 0.92, 0.075, 0.070))
BACKPLATE_OUTLINE = [(-0.25, 1.705), (0.25, 1.705), (0.215, 1.62), (0.205, 1.40), (0.0, 1.215), (-0.205, 1.40),
                     (-0.215, 1.62)]


def backplate_mid(x, z):
    """the back plate's mid surface (y): a shallow curve across, leaning out toward its chevron point"""
    return 0.256 - 0.30 * x * x + 0.075 * (1.705 - z)
_PC = (0.25, 0.02)
PAULDRON_SLOPE = 6.0                 # deg: the plate falls away outward
CAP_H = 0.021                        # the cap's half thickness


def cap_mid(sx):
    """the cap's mid-surface height z(x, y): flat crown at 1.81, drooping to the front and (much more) down the
    back, falling away outward, the outer point swept up"""
    k = math.tan(math.radians(PAULDRON_SLOPE))

    def fn(x, y):
        ax = sx * x
        z = 1.812 - k * np.maximum(0.0, ax - 0.20)
        z = z - 2.0 * np.maximum(0.0, -0.04 - y) ** 2 - 2.6 * np.maximum(0.0, y - 0.04) ** 2
        z = z + 0.034 * _smooth(0.28, 0.44, ax)
        return z
    return fn


def cap_h(sx):
    """the cap's half thickness: thick over the shoulder, thinning to its swept-up point (a crescent from the
    front, the concept's caps)"""
    def fn(x, y):
        return CAP_H - 0.011 * _smooth(0.26, 0.44, sx * x)
    return fn


# mantle lames: rows of carved plates round a vertical axis at each shoulder, flaring and lengthening per row,
# sloping down to the outside and (following the cap) down the back
LAME_ROWS = 5
LAME_STEP = 24.0                     # deg between plate seams (staggered half a plate per row; jittered)
# the coat: hangs from under the mantle and the back plate, narrowing a little to the hem (the wedge), open at
# the front, split up the back into two tails (CAPE_TAILS chains) whose outer corners are cut up toward the
# sides: from behind it narrows to the feet and the legs show between and beside the tails
COAT = dict(z0=0.44, z1=1.58, rx=(0.30, 0.27), ry=(0.200, 0.215), y0=(0.035, 0.050), t=0.011, opening=(0.86, 0.97),
            x0=(0.0, 0.02), slit=(1.04, 0.008, 0.062))
CAPE_TAILS = {"cape_L": ((0.11, 0.25, 1.20), (0.15, 0.30, 0.50)), "cape_R": ((-0.11, 0.25, 1.20), (-0.15, 0.30, 0.50))}


def lame_row(i):
    """row i: centre height, radius at the centre, half height"""
    return 1.745 - 0.064 * i, 0.205 + 0.011 * i, 0.042 + 0.002 * i


def lame_dz(phi):
    """row height offset by angle (deg from the front, + toward the outside/back): the rows slope down to the
    outside and follow the cap's droop down the back"""
    a = np.radians(phi)
    return -0.016 * np.maximum(np.sin(a), 0.0) - 0.050 * _smooth(95.0, 170.0, np.asarray(phi, float))


def lame_seams(i, sx):
    """the plate seams of row i (deg): LAME_STEP apart, staggered per row, jittered so no two rows repeat"""
    ph0 = -90.0 + (LAME_STEP * 0.5 if i % 2 else 0.0)
    out = []
    for k in range(-1, 16):
        h = math.sin(i * 12.9898 + k * 78.233 + sx * 3.17) * 43758.5453
        j = (h - math.floor(h) - 0.5) * 7.0
        out.append(ph0 + LAME_STEP * k + j)
    return np.array(out)


def coat_lerp(a, z):
    u = np.clip((z - COAT["z1"]) / (COAT["z0"] - COAT["z1"]), 0.0, 1.0) ** 0.85
    return a[0] * (1 - u) + a[1] * u


def coat_hem(x, y):
    """the hem height: the front flaps long (her left a little longer), the back tails cut up toward the sides"""
    back = np.clip((y - 0.02) / 0.12, 0.0, 1.0)
    side = np.clip(np.abs(x) / 0.27, 0.0, 1.0) ** 1.4
    notch = np.abs(np.sin(x * 13.0 + y * 9.0 + 0.6 * NOISE(np.stack([x * 2, y * 2, x * 0], 1), 4.0)))
    front = np.clip((0.02 - y) / 0.16, 0.0, 1.0)                     # the front flaps cut up toward their edge
    return (0.47 + 0.075 * np.clip((x - 0.05) / 0.35, 0.0, 1.0) * (1 - back) + back * (0.035 + 0.14 * side)
            + 0.13 * front ** 1.5
            + 0.02 * NOISE(np.stack([x * 3, y * 3, x * 0], 1), 6.0) + 0.028 * notch ** 3)


FIST_R = 0.058                       # the wrist's distance from the grip axis (the fist's curl)
GRIP_GUARD = 0.075                   # the fist centre (prop.R's head) to the guard, along the blade


def sword_frame(J) -> dict:
    """Guard centre G, blade direction D, width W, face normal N (toward the front, rolled up by BLADE_ROLL),
    grip point C (prop.R's head) = the right fist's centre: the grip axis runs through the fist's curl FIST_R
    from the wrist (the fingers wrap it), the guard GRIP_GUARD beyond it."""
    d2 = (TIP_XZ - GUARD_XZ) / np.linalg.norm(TIP_XZ - GUARD_XZ)
    D = np.array([d2[0], TILT_Y, d2[1]])
    D /= np.linalg.norm(D)
    palm = np.array(J["palm.R"][:])
    t0 = (palm[[0, 2]] - GUARD_XZ) @ d2                  # the palm's place along the painted axis (< 0)
    cxz = GUARD_XZ + d2 * t0
    C0 = np.array([cxz[0], palm[1], cxz[1]])
    wr = np.array(J["wrist.R"][:])
    U = (wr - C0) - D * ((wr - C0) @ D)
    U /= np.linalg.norm(U)
    C = wr + D * 0.012 - U * FIST_R
    s = GRIP_GUARD
    G = C + D * s
    n0 = np.array([0.0, -1.0, 0.0])
    N = n0 - D * n0.dot(D)
    N /= np.linalg.norm(N)
    up = np.array([0.0, 0.0, 1.0])
    U = up - D * up.dot(D) - N * up.dot(N)
    U /= np.linalg.norm(U)
    r = math.radians(BLADE_ROLL)
    N = N * math.cos(r) + U * math.sin(r)
    W = np.cross(N, D)
    W /= np.linalg.norm(W)
    if W[2] < 0:
        W = -W
    return {"G": G, "D": D, "W": W, "N": N, "C": C, "grip_t": s, "U": U}


def mirror_x(v) -> np.ndarray:
    v = np.array(v, dtype=np.float64)
    v[..., 0] *= -1.0
    return v


def fist(name: str, C, D, wrist, back_hint, elbow) -> Sculpt:
    """A gloved fist wrapped round a grip line (C, D) (x1.5 hands): the back of the hand toward `back_hint`,
    the wrist side toward `wrist`; four fingers curled round the grip (the index toward +D, the guard),
    knuckles, a thumb laid over the index, a flared cuff at the wrist."""
    C, D, wrist = (np.asarray(v, dtype=np.float64) for v in (C, D, wrist))
    D = D / np.linalg.norm(D)
    U = (wrist - C) - D * ((wrist - C) @ D)
    U /= np.linalg.norm(U)
    O = np.cross(D, U)
    if O @ np.asarray(back_hint, float) < 0:
        O = -O
    S = Sculpt(name)
    fr = np.stack([D, U, O])                                  # local X = along the grip, Y = to the wrist, Z = back
    S.add(RoundBox(C + U * 0.046 + O * 0.008, (0.046, 0.036, 0.021), 0.016, axes=fr), k=0.0)   # palm + back
    gr = 0.021
    afr = np.stack([-O, -U, D])                               # the arcs: angle 0 = the far side (-U), -90 = the back
    for off, rr, a0 in ((0.035, 0.0112, -112.0), (0.0118, 0.0124, -116.0), (-0.0118, 0.0121, -114.0),
                        (-0.034, 0.0105, -108.0)):
        R = gr + rr
        S.add(AnnulusSector(C + D * off, R - rr, R + rr, a0, 122.0, rr * 0.92, rr * 0.85, axes=afr), k=0.004)
        kn = C + D * off + (U * math.cos(math.radians(72)) + O * math.sin(math.radians(72))) * (R + 0.004)
        S.add(Sphere(kn, rr * 1.05), k=0.006)                                         # the knuckle
        S.add(Sphere(C + D * off - U * (R + 0.002), rr * 0.95), k=0.005)              # the middle joint
    # the thumb: from the palm's heel over the index finger
    S.add(Tube([tuple(C + U * 0.052 - O * 0.010 + D * 0.040), tuple(C + U * 0.024 - O * 0.036 + D * 0.046),
                tuple(C - U * 0.004 - O * 0.040 + D * 0.032)], [0.0145, 0.0128, 0.0108], k=0.006), k=0.008)
    # the cuff: a short flared gauntlet round the wrist
    el = np.asarray(elbow, float)
    fa = (wrist - el) / np.linalg.norm(wrist - el)
    S.add(RoundCone(wrist - fa * 0.065, wrist + fa * 0.004, 0.044, 0.052), k=0.012)
    return S


# ── custom primitives (numpy; same protocol as common/hifi/sdf.py Prim) ─────────────────────────────
def poly_sd(p: np.ndarray, V2: np.ndarray) -> np.ndarray:
    """2D signed distance to a polygon (IQ), vectorised over points p (n, 2)."""
    V2 = np.asarray(V2, dtype=np.float64)
    d = np.sum((p - V2[0]) ** 2, axis=1)
    s = np.ones(len(p))
    m = len(V2)
    for i in range(m):
        j = i - 1
        e = V2[j] - V2[i]
        w = p - V2[i]
        b = w - e[None, :] * np.clip((w @ e) / (e @ e), 0.0, 1.0)[:, None]
        d = np.minimum(d, np.sum(b * b, axis=1))
        c1 = p[:, 1] >= V2[i, 1]
        c2 = p[:, 1] < V2[j, 1]
        c3 = e[0] * w[:, 1] > e[1] * w[:, 0]
        flip = (c1 & c2 & c3) | (~c1 & ~c2 & ~c3)
        s = np.where(flip, -s, s)
    return s * np.sqrt(d)


class Extrude(sdf._Framed):
    """A 2D polygon (local X, Y) extruded along local Z (half depth h), edges rounded by r."""

    def __init__(self, c, pts, h, r=0.0, axes=None):
        super().__init__(c, axes)
        self.pts = np.asarray(pts, dtype=np.float64)
        self.h, self.r = float(h), float(r)

    def bounds(self):
        lo, hi = self.pts.min(0), self.pts.max(0)
        corners = np.array([[x, y, z] for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (-self.h, self.h)])
        w = corners @ self.ax + self.c
        return w.min(0), w.max(0)

    def d(self, P):
        p = self.local(P)
        d2 = poly_sd(p[:, :2], self.pts) + self.r
        dz = np.abs(p[:, 2]) - self.h + self.r
        q = np.stack([d2, dz], axis=1)
        return np.linalg.norm(np.maximum(q, 0.0), axis=1) + np.minimum(np.max(q, axis=1), 0.0) - self.r


class OutlineGroove(sdf.Prim):
    """A carved groove: the band between two outlines (world XY) cut `depth` below the surface `ztop(x, y)`."""

    def __init__(self, outer, inner, ztop, depth):
        self.outer, self.inner = np.asarray(outer, float), np.asarray(inner, float)
        self.ztop, self.depth = ztop, float(depth)

    def bounds(self):
        lo, hi = self.outer.min(0), self.outer.max(0)
        return np.array([lo[0], lo[1], 1.55]), np.array([hi[0], hi[1], 1.95])

    def d(self, P):
        xy = P[:, :2]
        ring = np.maximum(poly_sd(xy, self.outer), -poly_sd(xy, self.inner))
        dz = (self.ztop(P[:, 0], P[:, 1]) - self.depth) - P[:, 2]
        return np.maximum(ring, dz)


class BentPlate(sdf.Prim):
    """A plate of half thickness h whose mid surface is w = f(u, v) over a 2D outline in (u, v), edges rounded
    by r. Frame rows (eu, ev, ew) in world; f(u, v) in metres along ew. Distance scaled by the slope (a bound)."""

    def __init__(self, outline, f, h, r=0.0, axes=None, wrange=(-1.0, 1.0)):
        self.poly = np.asarray(outline, float)
        self.f, self.h, self.r = f, (h if callable(h) else float(h)), float(r)
        self.ax = np.eye(3) if axes is None else np.asarray(axes, float)
        self.wr = wrange

    def bounds(self):
        lo, hi = self.poly.min(0) - 0.01, self.poly.max(0) + 0.01
        pts = np.array([[u, v, w] for u in (lo[0], hi[0]) for v in (lo[1], hi[1]) for w in self.wr])
        world = pts @ self.ax
        return world.min(0), world.max(0)

    def d(self, P):
        p = P @ self.ax.T
        u, v, w = p[:, 0], p[:, 1], p[:, 2]
        e = 1e-3
        f0 = self.f(u, v)
        gu = (self.f(u + e, v) - f0) / e
        gv = (self.f(u, v + e) - f0) / e
        h = self.h(u, v) if callable(self.h) else self.h
        dw = np.abs(w - f0) / np.sqrt(1.0 + gu * gu + gv * gv) - h + self.r
        d2 = poly_sd(np.stack([u, v], 1), self.poly) + self.r
        q = np.stack([d2, dw], 1)
        return np.linalg.norm(np.maximum(q, 0.0), axis=1) + np.minimum(np.max(q, axis=1), 0.0) - self.r


def xz_frame():
    """local X = world X, local Y = world Z, local Z = world Y (a front-view outline extruded along Y)"""
    return np.array([[1.0, 0, 0], [0, 0, 1.0], [0, 1.0, 0]])


class AnnulusSector(sdf._Framed):
    """A band between radii ri..ro in the local XY plane, angles a0..a1 (deg from +Y toward +X), half depth h."""

    def __init__(self, c, ri, ro, a0, a1, h, r=0.0, axes=None):
        super().__init__(c, axes)
        self.ri, self.ro, self.h, self.r = float(ri), float(ro), float(h), float(r)
        self.a0, self.a1 = math.radians(a0), math.radians(a1)

    def bounds(self):
        e = self.ro
        return self._corners((e, e, self.h))

    def d(self, P):
        p = self.local(P)
        rad = np.hypot(p[:, 0], p[:, 1])
        ang = np.arctan2(p[:, 0], p[:, 1])
        mid = 0.5 * (self.a0 + self.a1)
        half = 0.5 * (self.a1 - self.a0)
        d_ring = np.abs(rad - 0.5 * (self.ri + self.ro)) - 0.5 * (self.ro - self.ri)
        d_ang = (np.abs(ang - mid) - half) * rad              # arc-length distance past the radial cuts
        d2 = np.maximum(d_ring, d_ang) + self.r
        dz = np.abs(p[:, 2]) - self.h + self.r
        q = np.stack([d2, dz], axis=1)
        return np.linalg.norm(np.maximum(q, 0.0), axis=1) + np.minimum(np.max(q, axis=1), 0.0) - self.r


class CoatShell(sdf.Prim):
    """An open coat: the shell of an elliptic cone (radii rx(z), ry(z) about (0, y0(z))) between z0 and z1,
    thickness t; open at the front where |x| < `opening`; the hem follows hem(x, y)."""

    def __init__(self, z0, z1, rx, ry, y0, t, opening, hem, folds=None, x0=(0.0, 0.0), slit=None):
        self.z0, self.z1, self.rx, self.ry, self.y0, self.t, self.x0 = z0, z1, rx, ry, y0, t, x0
        self.opening, self.hem, self.folds, self.slit = opening, hem, folds, slit

    def bounds(self):
        r = max(self.rx[0], self.rx[1]) + 0.06
        return np.array([-r, -r, self.z0 - 0.05]), np.array([r, r, self.z1 + 0.02])

    def d(self, P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        x = x - coat_lerp(self.x0, z)
        rx, ry, y0 = coat_lerp(self.rx, z), coat_lerp(self.ry, z), coat_lerp(self.y0, z)
        q = np.sqrt((x / rx) ** 2 + ((y - y0) / ry) ** 2)
        solid = (q - 1.0) * np.minimum(rx, ry)
        if self.folds is not None:
            solid = solid + self.folds(P, np.arctan2(x, y - y0))
        shell = np.abs(solid) - self.t
        d = np.maximum(shell, self.hem(x, y) - z)
        d = np.maximum(d, z - self.z1)
        front = -(y - y0)                                   # > 0 in front
        d_open = np.minimum(coat_lerp(self.opening, z) * rx - np.abs(x), front + 0.02)
        d = np.maximum(d, d_open)
        if self.slit is not None:                           # the back slit between the tails
            zt, w0, w1 = self.slit
            w = w0 + (w1 - w0) * np.clip((zt - z) / (zt - self.z0 - 0.06), 0.0, 1.0)
            d_slit = np.minimum(np.minimum(w - np.abs(x), (y - y0) - 0.02), zt - z)
            d = np.maximum(d, d_slit)
        return d


class LameRow(sdf.Prim):
    """one row of mantle plates round a vertical axis at A: each plate (LAME_STEP wide) bulges outward in its
    middle and hangs a little lower there (a scalloped lower edge), so the row reads as separate plates
    without cut seams (cut seams shatter the UV islands)"""

    def __init__(self, A, i, sx):
        self.A, self.i, self.sx = np.asarray(A, float), i, sx
        self.zc, self.R, self.hz = lame_row(i)
        self.ph0 = -90.0 + (LAME_STEP * 0.5 if i % 2 else 0.0)

    def bounds(self):
        e = self.R + 0.08
        return self.A + np.array([-e, -e, self.zc - self.hz - 0.03]), self.A + np.array([e, e, self.zc + self.hz + 0.02])

    def d(self, P):
        """(the fit check's stand-in: the game mesh is lames_low)"""
        p = P - self.A
        r = np.hypot(p[:, 0], p[:, 1])
        phi = np.degrees(np.arctan2(self.sx * p[:, 0], -p[:, 1]))
        f = (phi - self.ph0) / LAME_STEP
        w = f - np.floor(f)
        b = 1.0 - (2.0 * w - 1.0) ** 2
        zc = self.zc + lame_dz(np.clip(phi, -180.0, 180.0))
        rr = self.R + (zc - P[:, 2]) * LAME_FLARE + 0.0065 * b
        zb = zc - self.hz - 0.008 * b
        dz = np.maximum(P[:, 2] - (zc + self.hz), zb - P[:, 2])
        da = np.maximum(LAME_ARC[0] - phi, phi - LAME_ARC[1]) * np.pi / 180.0 * r
        return np.maximum(np.maximum(np.abs(r - rr) - 0.011, dz), da)


class Blade(sdf.Prim):
    """A sword blade from G0 along D: length L, width w0 -> w1 (W), thickness th (N), a point over the last
    `tip` m, a hexagonal section (flats + edge bevels), an optional broken end `cut(s)` (t limit per s)."""

    def __init__(self, G0, D, W, N, L, w0, w1, th, tip, bevel=0.022, cut=None):
        self.G0, self.D, self.W, self.N = (np.asarray(v, dtype=np.float64) for v in (G0, D, W, N))
        self.L, self.w0, self.w1, self.th, self.tip, self.bevel, self.cut = L, w0, w1, th, tip, bevel, cut

    def bounds(self):
        e = max(self.w0, self.w1) * 0.5 + self.th
        pts = [self.G0 + self.D * t + self.W * s + self.N * n for t in (-0.01, self.L + 0.01) for s in (-e, e)
               for n in (-e, e)]
        pts = np.array(pts)
        return pts.min(0), pts.max(0)

    def d(self, P):
        q = P - self.G0
        t, s, n = q @ self.D, np.abs(q @ self.W), np.abs(q @ self.N)
        u = np.clip(t / self.L, 0.0, 1.0)
        hw = 0.5 * (self.w0 + (self.w1 - self.w0) * u)
        k = np.clip((self.L - t) / self.tip, 0.0, 1.0)
        hw = hw * np.sqrt(k) + 0.002
        ht = 0.5 * self.th * (1.0 - 0.25 * np.clip(s / np.maximum(hw, 1e-4), 0, 1) ** 2)
        d_flat = n - ht
        beta = math.atan2(self.bevel, 0.5 * self.th)
        d_bev = (s - hw) * math.cos(beta) + n * math.sin(beta)
        d = np.maximum(np.maximum(d_flat, d_bev), -t)
        if self.cut is not None:
            d = np.maximum(d, t - self.cut(q @ self.W, n))
        else:
            d = np.maximum(d, t - self.L)
        return d


GROOVE_D = 0.0042                    # the glass grooves' depth in the face plate
GLASS_IN = 0.0016                    # the glass's front face behind the face surface (inside the groove)
_HELM: list = [None]                 # the un-grooved helm surface (sdf.Blend) of the current build


def _cyl_prof(R, z0, z1, rr):
    """(r, z) profile of a solid cylinder r <= R, z0..z1, edges rounded by rr (for Lathe)"""
    zc, hz = 0.5 * (z0 + z1), 0.5 * (z1 - z0)

    def fn(r, z):
        qx = r - R + rr
        qz = np.abs(z - zc) - hz + rr
        return np.hypot(np.maximum(qx, 0.0), np.maximum(qz, 0.0)) + np.minimum(np.maximum(qx, qz), 0.0) - rr
    return fn


HELM_COL = (0.020, 0.040, 0.084)
CREST_Y, CREST_H = 0.006, 0.045     # the crest slab's centre (y) and half depth
CREST_GLASS = (0.562, 0.586)        # the brow inlay's radii on the crest faces (the band spans 0.505-0.60)     # the back column's axis (x, y) and radius


def helm_sculpt() -> Sculpt:
    """the kite face plate (FACE_OUTLINE) rounded by one ellipsoid, a short beak, and behind it the concept's
    stone column (a flat-topped cylinder) that carries the crest"""
    helm = Sculpt("helm")
    helm.add(Extrude((0.0, -0.06, 0.0), FACE_OUTLINE, 0.078, 0.012, axes=xz_frame()), k=0.0)
    helm.inter(Ellipsoid((0.016, 0.07, 1.965), (0.168, 0.215, 0.25)), k=0.015)
    cx, cy, cr = HELM_COL
    helm.add(Lathe((cx, cy, 0.0), _cyl_prof(cr, 1.83, 2.07, 0.022), cr + 0.01, 1.82, 2.08), k=0.022)
    helm.add(RoundCone((0.018, -0.104, 1.874), (0.018, -0.146, 1.836), 0.019, 0.007), k=0.02)   # the beak
    return helm


class Groove(sdf.Prim):
    """the part of a polygon prism (x/z outline grown by `grow`, along Y, front of the head only) that lies
    within `depth` under the surface `surf`: a groove of constant depth in a curved face"""

    def __init__(self, surf, poly, depth, grow=0.0, y0=-0.30, y1=-0.05):
        self.surf, self.poly, self.depth, self.grow = surf, np.asarray(poly, float), float(depth), float(grow)
        self.y0, self.y1 = y0, y1

    def bounds(self):
        lo, hi = self.poly.min(0) - self.grow - 0.004, self.poly.max(0) + self.grow + 0.004
        return np.array([lo[0], self.y0, lo[1]]), np.array([hi[0], self.y1, hi[1]])

    def d(self, P):
        d2 = poly_sd(P[:, [0, 2]], self.poly) - self.grow
        dy = np.maximum(self.y0 - P[:, 1], P[:, 1] - self.y1)
        return np.maximum(np.maximum(d2, dy), -(self.surf.d(P) + self.depth))


def _offset_poly(poly, r):
    """a closed polygon (x, z) pushed out by r along its vertex normals (fine for these small convex-ish tips:
    used only for the groove, whose SDF also grows by nothing else)"""
    p = np.asarray(poly, float)
    n = len(p)
    out = []
    area = 0.5 * np.sum(p[:, 0] * np.roll(p[:, 1], -1) - np.roll(p[:, 0], -1) * p[:, 1])
    sgn = 1.0 if area > 0 else -1.0
    for i in range(n):
        a, b, c = p[i - 1], p[i], p[(i + 1) % n]
        e1, e2 = b - a, c - b
        n1 = np.array([e1[1], -e1[0]]) * sgn
        n2 = np.array([e2[1], -e2[0]]) * sgn
        n1 /= np.linalg.norm(n1) + 1e-12
        n2 /= np.linalg.norm(n2) + 1e-12
        m = n1 + n2
        m /= np.linalg.norm(m) + 1e-12
        k = min(2.5, 1.0 / max(0.3, float(m @ n1)))
        out.append(tuple(b + m * r * k))
    return out


def _strip_poly(pts, hw):
    """a thin strip along a polyline (x, z), half width hw, tapered at both ends (closed outline)"""
    L, R = _strip_sides(pts, hw)
    return L + R[::-1]


def _strip_sides(pts, hw):
    p = np.asarray(pts, float)
    dense = []
    for i in range(len(p) - 1):
        for f in np.linspace(0.0, 1.0, 4, endpoint=False):
            dense.append(p[i] + (p[i + 1] - p[i]) * f)
    dense.append(p[-1])
    p = np.array(dense)
    n = len(p)
    L, R = [], []
    for i in range(n):
        t = p[min(i + 1, n - 1)] - p[max(i - 1, 0)]
        t /= np.linalg.norm(t) + 1e-12
        nn = np.array([-t[1], t[0]])
        u = i / (n - 1)
        w = hw * min(1.0, 0.25 + 3.0 * min(u, 1.0 - u))
        L.append(tuple(p[i] + nn * w))
        R.append(tuple(p[i] - nn * w))
    return L, R


def surface_y(surf, x, z, y0=-0.30):
    """the front surface's Y at (x, z) by sphere tracing `surf` from y0 toward +Y"""
    x, z = np.asarray(x, float), np.asarray(z, float)
    y = np.full(x.shape, y0)
    for _ in range(80):
        d = surf.d(np.stack([x, y, z], 1))
        y = y + np.maximum(d, 2e-5)
        if np.all(d < 5e-5):
            break
    return y


# ── displacement helpers ──────────────────────────────────────────────────────────────────────────
def folds(amp, freq, axis=0, phase=0.0, zfade=None):
    def fn(P):
        u = P[:, axis] * freq + phase + 0.6 * NOISE(P, 3.0)
        a = amp
        if zfade is not None:
            z0, z1 = zfade
            a = amp * np.clip((z0 - P[:, 2]) / (z0 - z1), 0.15, 1.0)
        return a * (np.abs(np.sin(u)) * 2.0 - 1.0) * -0.5
    return fn


def chips(amp, freq):
    def fn(P):
        return amp * np.clip(NOISE.ridged(P, freq, 3), 0, 1) - amp * 0.3
    return fn


def coat_fold_wave(P, ang):
    """the coat's vertical folds: +1 on a crest, -1 in a valley (shared by the sculpt and the paint)"""
    u = ang * 7.0 + 0.9 * NOISE(P, 2.5)
    return np.abs(np.sin(u)) * 2.0 - 1.0


def jv(J, name) -> np.ndarray:
    return np.array(J[name][:], dtype=np.float64)


def _lozenge_frame(W, D, N, ang):
    a = math.radians(ang)
    X = W * math.cos(a) + D * math.sin(a)
    Y = -W * math.sin(a) + D * math.cos(a)
    return np.stack([X, Y, N])


def pauldron_top_z(sx):
    """the pauldron plate's top surface height (the flat top, the outward slope and the dome)"""
    k = math.tan(math.radians(PAULDRON_SLOPE))

    def fn(x, y):
        plane = 1.836 - k * np.maximum(0.0, sx * x - 0.20)
        e = 1.0 - ((x - sx * 0.20) / 0.50) ** 2 - ((y - 0.02) / 0.50) ** 2
        dome = 1.55 + 0.29 * np.sqrt(np.maximum(e, 0.0))
        return np.minimum(np.minimum(plane, dome), 1.836)
    return fn


def scaled_outline(pts, k, c):
    return [(c[0] + (x - c[0]) * k, c[1] + (y - c[1]) * k) for x, y in pts]


# ── the sculpt ───────────────────────────────────────────────────────────────────────────────────
def sculpts(J) -> list:
    """(name, Sculpt, voxel scale, material role, bind, tris, form) in build order. J = rig joints."""
    out = []

    def part(name, S, role, bind, tris, vs=1.0, form=None):
        out.append((name, S, vs, role, bind, tris, form))

    # HELM (rigid on the head): a tall kite face plate over a round skull, the back column under the crest. The
    # face is the concept's: a smooth chalk mask with one slim star-tipped slit and two thin cheek lines, all
    # glass set in shallow grooves (the glass itself is the `visor` part, a clean parametric mesh)
    helm = helm_sculpt()
    surf = sdf.Blend([(o, p, k) for o, p, k, _ in helm.ops])
    _HELM[0] = surf
    for poly in [SLIT_POLY] + [_strip_poly(c, CHEEK_HW) for c in CHEEK_LINES]:
        helm.sub(Groove(surf, _offset_poly(poly, INK_W * 0.8), GROOVE_D), k=0.0015)
    part("helm", helm, "chalk", "bone:head", 1120, 0.5)
    # the crest: the concept's carved hammer-head arch, a thick slab (9 cm deep) set over the column so it
    # crowns the helm from every side (a thin plank behind the face read as one ear off the front)
    crest = Sculpt("crest")
    band = AnnulusSector((0.065, CREST_Y, 1.55), 0.505, 0.60, -22.0, 24.0, CREST_H, 0.011, axes=xz_frame())
    crest.add(band.displaced(chips(0.006, 14.0), 0.006), k=0.0)
    # the brow inlay (the accent): a glass line along the top border of both carved faces, below the top
    # edge (a strip ON the top read as a bright bar from the high camera); the scrollwork stays below it
    cg = Sculpt("crest_glass")
    for yf, sg in ((CREST_Y - CREST_H, -1), (CREST_Y + CREST_H, 1)):
        crest.sub(AnnulusSector((0.065, yf, 1.55), CREST_GLASS[0] - 0.003, CREST_GLASS[1] + 0.003, -19.5, 21.5, 0.007,
                                0.002, axes=xz_frame()), k=0.002)
        cg.add(AnnulusSector((0.065, yf - sg * 0.0055, 1.55), CREST_GLASS[0], CREST_GLASS[1], -19.0, 21.0, 0.0035,
                             0.0015, axes=xz_frame()), k=0.0)
    crest.sub(AnnulusSector((0.065, CREST_Y, 1.55), 0.590, 0.62, -20.0, 22.0, 0.0085, 0.002, axes=xz_frame()), k=0.002)
    cg.add(AnnulusSector((0.065, CREST_Y, 1.55), 0.585, 0.5975, -19.5, 21.5, 0.0055, 0.002, axes=xz_frame()), k=0.0)
    part("crest_glass", cg, "accent", "bone:head", 360, 0.5)
    part("crest", crest, "stone", "bone:head", 820, 0.7)

    # SCARF (chest -> neck): a wrapped collar, a fold over the chest, a knot and tails on the left shoulder
    # the concept's scarf: two loose wraps round the neck under the chin (the top stays below the face plate's
    # chin, a dark collar shows between), a swag across the chest, a knot on her left collarbone and two
    # hanging ends over the left breastplate (inside the mantle's front edge, never through the lames)
    scarf = Sculpt("scarf")
    scarf.add(Torus((0.016, 0.022, 1.792), 0.084, 0.034, axes=sdf.rot_x(-20)), k=0.0)            # upper wrap
    scarf.add(Torus((0.020, 0.012, 1.748), 0.108, 0.033, axes=sdf.rot_x(-24)), k=0.025)         # lower wrap
    scarf.add(Ellipsoid((0.030, -0.110, 1.722), (0.092, 0.034, 0.036), axes=sdf.rot_z(-10)), k=0.03)  # swag
    scarf.add(Ellipsoid((0.016, 0.070, 1.840), (0.070, 0.040, 0.040)), k=0.03)                   # back fold
    scarf.add(Ellipsoid((0.128, -0.112, 1.748), (0.038, 0.034, 0.040)), k=0.012)                # the knot
    scarf.add(Ellipsoid((0.112, -0.124, 1.722), (0.026, 0.024, 0.026), axes=sdf.rot_z(30)), k=0.01)
    # the ends hang over the breastplate's left curve (its bosom peaks at y -0.167, z 1.615)
    scarf.add(FlatCapsule((0.130, -0.128, 1.722), (0.124, -0.180, 1.640), 0.028, 0.010, 0.027, 0.009,
                          side=(1, 0, 0)), k=0.012)                                              # long end
    scarf.add(FlatCapsule((0.124, -0.180, 1.640), (0.130, -0.160, 1.552), 0.027, 0.009, 0.022, 0.008,
                          side=(1, 0, 0)), k=0.008)
    scarf.add(FlatCapsule((0.110, -0.126, 1.720), (0.096, -0.184, 1.622), 0.022, 0.009, 0.018, 0.008,
                          side=(1, 0, 0)), k=0.012)                                              # short end
    scarf = _displaced_sculpt(scarf, folds(0.007, 40.0, axis=2, phase=0.4), 0.007)
    part("scarf", scarf, "cloth2", ("zblend", "chest", "neck", 1.76, 1.86), 720, 0.8)

    # TORSO (auto): the under-suit (mostly hidden)
    torso = Sculpt("torso")
    torso.add(Ellipsoid((0.0, 0.02, 1.58), (0.19, 0.15, 0.17)), k=0.0)
    torso.add(Ellipsoid((0.0, 0.02, 1.32), (0.15, 0.12, 0.16)), k=0.08)
    torso.add(Ellipsoid((0.0, 0.02, 1.07), (0.175, 0.13, 0.13)), k=0.08)
    torso.add(Capsule((0.01, 0.02, 1.72), (0.012, 0.03, 1.88), 0.055), k=0.04)
    for s in ("L", "R"):
        torso.add(Sphere(jv(J, f"shoulder.{s}"), 0.075), k=0.06)
    part("torso", torso, "under", "auto", 340)

    # BREASTPLATE (rigid on the chest)
    bp = Sculpt("breastplate")
    bp.add(Ellipsoid((0.0, -0.01, 1.60), (0.165, 0.165, 0.16)), k=0.0)
    for sx in (-1, 1):
        bp.add(Ellipsoid((sx * 0.072, -0.082, 1.615), (0.082, 0.085, 0.074)), k=0.04)
    bp.add(RoundBox((0.0, -0.11, 1.49), (0.125, 0.035, 0.05), 0.025, axes=sdf.rot_x(-8)), k=0.03)
    bp.inter(HalfSpace((0, -0.035, 1.6), (0, 1, 0), 1.0), k=0.01)
    bp.inter(HalfSpace((0, 0, 1.735), (0, 0, 1), 1.0), k=0.01)
    bp.inter(HalfSpace((0, 0, 1.445), (0, 0, -1), 1.0), k=0.01)
    bp.sub(Capsule((0.0, -0.19, 1.70), (0.0, -0.16, 1.47), 0.006), k=0.004)
    part("breastplate", bp, "chalk", "bone:chest", 620)

    # MANTLE: per side a curved stone cap (bent over the shoulder, drooping down the back into the collar,
    # the point swept up, a trim rim, a carved groove) over five rows of separate blued plates (lames)
    for s, sx in (("R", -1), ("L", 1)):
        A = np.array([sx * 0.165, 0.015, 0.0])
        outline = [(sx * x, y) for x, y in PAULDRON_OUTLINE]
        if sx < 0:
            outline = outline[::-1]
        cen = (sx * _PC[0], _PC[1])
        mid = cap_mid(sx)
        pa = Sculpt(f"pauldron_{s}")
        pa.add(BentPlate(outline, mid, cap_h(sx), 0.008, wrange=(1.55, 1.95)).displaced(chips(0.004, 9.0), 0.004), k=0.0)
        lo = scaled_outline(outline, 0.97, cen)
        loop = []
        for x, y in lo:
            loop.append((x, y, float(mid(np.array([x]), np.array([y]))[0]) + float(cap_h(sx)(np.array([x]), np.array([y]))[0]) * 0.55))
        loop.append(loop[0])
        pa.add(Tube(loop, [0.0105] * len(loop), k=0.006), k=0.006)                          # the trim bead
        groove = scaled_outline(outline, 0.70, cen)
        pa.sub(OutlineGroove(scaled_outline(outline, 0.74, cen), groove,
                             lambda x, y, m=mid, hh=cap_h(sx): m(x, y) + hh(x, y), 0.006), k=0.002)   # carved ring
        if sx < 0:                                     # the clasp on her right shoulder (carved stone, no gem)
            pa.add(Ellipsoid((-0.150, -0.166, 1.752), (0.031, 0.013, 0.031), axes=sdf.rot_x(-12)), k=0.006)
            pa.add(Torus((-0.150, -0.171, 1.752), 0.026, 0.0045, axes=sdf.frame(sdf.rot_x(-12)[1])), k=0.003)
        part(f"pauldron_{s}", pa, "stone", f"bone:shoulder.{s}", 470, 0.6)
        la = Sculpt(f"lames_{s}")
        for i in range(LAME_ROWS):
            la.add(LameRow(A, i, sx), k=0.004)
        # the lames hang from the shoulder; their lower rows follow the upper arm (so an elbow never pierces them)
        part(f"lames_{s}", la, "cloth", ("dblend", f"shoulder.{s}", f"upper_arm.{s}", (sx * 0.20, 0.015, 1.78),
                                         (sx * 0.35, 0.0, -0.94), 0.12, 0.48), 860, 0.8)
    # BACK PLATE (the concept's large blued plate between the lames, chevron base at mid-back), over the cape
    back = Sculpt("backplate")
    back.add(BentPlate(BACKPLATE_OUTLINE, backplate_mid, 0.010, 0.006, axes=xz_frame(), wrange=(0.15, 0.36))
             .displaced(chips(0.003, 10.0), 0.003), k=0.0)
    for z0 in (1.605, 1.505):                          # the plate rows' seams
        back.sub(BentPlate([(-0.30, z0 - 0.004), (0.30, z0 - 0.004), (0.30, z0 + 0.004), (-0.30, z0 + 0.004)],
                           lambda u, v: backplate_mid(u, v) + 0.012, 0.006, 0.0, axes=xz_frame(),
                           wrange=(0.15, 0.36)), k=0.002)
    part("backplate", back, "cloth", "bone:chest", 540)

    # ARMS (auto: dark under-suit, wrapped forearms) + chalk rerebraces with elbow cops (upper arms) + blued
    # vambraces (forearms) + gloves (hands)
    arms = Sculpt("arms")
    for s in ("L", "R"):
        sh, el, wr = jv(J, f"shoulder.{s}"), jv(J, f"elbow.{s}"), jv(J, f"wrist.{s}")
        arms.add(FlatCapsule(sh, el, 0.066, 0.062, 0.056, 0.054), k=0.0)
        arms.add(FlatCapsule(el, wr, 0.054, 0.052, 0.043, 0.04), k=0.03)
        arms.add(Sphere(sh, 0.07), k=0.03)
    part("arms", arms, "under", "auto", 640)
    for s, sx in (("R", -1), ("L", 1)):
        sh, el, wr = jv(J, f"shoulder.{s}"), jv(J, f"elbow.{s}"), jv(J, f"wrist.{s}")
        # rerebrace: a shell over the outer upper arm from under the lames to the elbow cop
        au = (el - sh) / np.linalg.norm(el - sh)
        ou = np.array([sx, 0.0, 0.0]) - au * sx * au[0]
        ou /= np.linalg.norm(ou)
        Lu = float(np.linalg.norm(el - sh))
        # rerebrace: two overlapping chalk lames over the outer upper arm (half shells: the dark sleeve shows at
        # their inner edge), each with a rolled lower rim, and a disc couter with a boss at the elbow
        rb = Sculpt(f"rerebrace_{s}")
        for f0, f1, rw0, rw1 in ARM_LAMES:
            a0, a1 = sh + au * (Lu * f0), sh + au * (Lu * f1)
            rb.add(FlatCapsule(a0, a1, rw0, rw0 * 0.96, rw1, rw1 * 0.96, side=ou), k=0.002)
            rb.add(Torus(sh + au * (Lu * f1 - 0.006), rw1 * 0.97, 0.0058, axes=sdf.frame(au)), k=0.002)
        rb.inter(HalfSpace(sh + ou * 0.004, -ou, 1.0), k=0.006)
        cf = sdf.frame(ou, au)
        rb.add(Ellipsoid(el + ou * 0.050 + au * 0.004, (0.052, 0.045, 0.015), axes=cf), k=0.010)        # couter
        rb.add(Sphere(el + ou * 0.060 + au * 0.004, 0.017), k=0.006)                                     # its boss
        rb.add(RoundCone(el + ou * 0.054 + au * 0.034, el + ou * 0.060 - au * 0.040, 0.013, 0.004), k=0.008)
        part(f"rerebrace_{s}", rb, "chalk", f"bone:upper_arm.{s}", 440, 0.8)
        # vambrace: the concept's long chalk plate over the outer forearm, swept up into a point over the elbow,
        # a keel down its middle, a rolled rim at the wrist; the dark wrapped forearm shows on its inner side
        ax = (wr - el) / np.linalg.norm(wr - el)
        out_ = np.array([sx, 0.0, 0.0])
        out_ = out_ - ax * out_.dot(ax)
        out_ /= np.linalg.norm(out_)
        L = float(np.linalg.norm(wr - el))
        vb = Sculpt(f"vambrace_{s}")
        b0, b1 = el + ax * 0.03, wr - ax * 0.03
        vb.add(FlatCapsule(b0, b1, 0.063, 0.059, 0.054, 0.050, side=out_), k=0.0)
        vb.add(Torus(b1 - ax * 0.004, 0.052, 0.0055, axes=sdf.frame(ax)), k=0.002)
        vb.add(RoundCone(el + ax * 0.05 + out_ * 0.052, el - ax * 0.035 + out_ * 0.064, 0.016, 0.005), k=0.014)
        vb.inter(HalfSpace(el + out_ * 0.008, -out_, 1.0), k=0.006)
        vb.add(Capsule(el + ax * 0.06 + out_ * 0.060, wr - ax * 0.05 + out_ * 0.052, 0.0065), k=0.006)     # keel
        part(f"vambrace_{s}", vb, "chalk", f"bone:forearm.{s}", 380, 0.8)
        # the gloved fist: the right one round the sword's grip (prop.R), the left one round prop.L's line (the
        # mirror image), which the two-handed holds put on the same grip below the right
        swf = sword_frame(J)
        Cf, Df = (swf["C"], swf["D"]) if s == "R" else (mirror_x(swf["C"]), mirror_x(swf["D"]))
        hd = fist(f"hand_{s}", Cf, Df, wr, (sx * 0.6, -0.8, 0.0), el)
        part(f"hand_{s}", hd, "leather", f"bone:hand.{s}", 640, 0.6)

    # BELTS (auto): main belt, a slung lower belt, the chest strap (no gems: the buckle is carved stone)
    belt = Sculpt("belt")
    belt.add(Torus((0.0, 0.015, 1.335), 0.168, 0.031, axes=np.diag([1.0, 0.168 / 0.135, 1.0]), rz=0.034), k=0.0)
    belt.add(Torus((0.0, 0.015, 1.25), 0.185, 0.026, axes=sdf.rot_y(-9) @ np.diag([1.0, 0.185 / 0.145, 1.0]), rz=0.028), k=0.0)
    belt.add(RoundBox((0.0, -0.155, 1.335), (0.04, 0.016, 0.032), 0.01), k=0.0)
    belt.add(Tube([(0.15, -0.115, 1.76), (0.10, -0.172, 1.665), (0.0, -0.19, 1.57), (-0.10, -0.172, 1.47),
                   (-0.155, -0.135, 1.39)], [0.016] * 5, k=0.01), k=0.0)
    part("belt", belt, "leather", "auto", 460)

    # TABARD (front panel on a chain) and the hip lames (thigh -> hips)
    tab = Sculpt("tabard")
    panel = Extrude((0.0, -0.152, 0.0), [(-0.118, 1.30), (0.118, 1.30), (0.124, 0.715), (0.0, 0.615), (-0.124, 0.715)],
                    0.009, 0.004, axes=xz_frame())
    tab.add(panel.displaced(folds(0.006, 30.0, axis=0, zfade=(1.2, 0.7)), 0.006), k=0.0)
    part("tabard", tab, "cloth", ("chain", "tabard_f", "hips"), 350)
    for s, sx in (("R", -1), ("L", 1)):
        sk = Sculpt(f"skirt_{s}")
        for k_, (zc, hz) in enumerate(((1.175, 0.075), (1.035, 0.07))):
            ang = sx * (-28.0 - 6 * k_)
            c = np.array([sx * (0.185 + 0.012 * k_), -0.105 + 0.01 * k_, zc])
            sk.add(RoundBox(c, (0.078, 0.012, hz), 0.008, axes=sdf.rot_z(ang) @ sdf.rot_x(-6)), k=0.004)
        part(f"skirt_{s}", sk, "cloth", ("zblend", f"thigh.{s}", "hips", 0.98, 1.18), 300)

    # COAT: an open coat from under the mantle to a ragged hem, narrower than the mantle (the wedge); the back
    # hangs on the cape chain, the front flaps follow the hips and thighs ('coatmix')
    def coat_folds(P, ang):
        a = 0.030 * np.clip((1.40 - P[:, 2]) / 0.85, 0.08, 1.0) ** 1.3          # deep folds at the hem, none up top
        return a * coat_fold_wave(P, ang) * -0.5
    coat = Sculpt("coat")
    coat.add(CoatShell(COAT["z0"], COAT["z1"], COAT["rx"], COAT["ry"], COAT["y0"], COAT["t"], COAT["opening"],
                       coat_hem, coat_folds, x0=COAT["x0"], slit=COAT["slit"]), k=0.0)
    part("coat", coat, "cloth", ("coatmix", "cape", "spine"), 1240)

    # LEGS (auto) + greaves (rigid on the shins) + boots (auto)
    legs = Sculpt("legs")
    legs.add(Ellipsoid((0.0, 0.02, 0.99), (0.17, 0.12, 0.10)), k=0.0)
    for s in ("L", "R"):
        hp, kn, an = jv(J, f"hip.{s}"), jv(J, f"knee.{s}"), jv(J, f"ankle.{s}")
        legs.add(FlatCapsule(hp, kn, 0.092, 0.088, 0.072, 0.07), k=0.05)
        legs.add(FlatCapsule(kn, an, 0.064, 0.062, 0.050, 0.050), k=0.03)
    part("legs", legs, "under", "auto", 480)
    for s, sx in (("R", -1), ("L", 1)):
        kn, an = jv(J, f"knee.{s}"), jv(J, f"ankle.{s}")
        ax = (an - kn) / np.linalg.norm(an - kn)
        gv = Sculpt(f"greave_{s}")
        gv.add(Ellipsoid(kn + np.array([0.0, -0.05, 0.03]), (0.085, 0.052, 0.125), axes=sdf.rot_x(-6)).displaced(chips(0.006, 8.0), 0.006), k=0.0)
        gv.add(FlatCapsule(kn + ax * 0.08 + np.array([0, -0.012, 0]), an - ax * 0.03 + np.array([0, -0.006, 0]),
                           0.068, 0.064, 0.054, 0.054, side=(1, 0, 0)).displaced(chips(0.005, 9.0), 0.005), k=0.03)
        gv.add(Ellipsoid(kn + ax * 0.17 + np.array([0.0, 0.022, 0.0]), (0.066, 0.060, 0.135)), k=0.04)   # the calf
        gv.sub(Torus(kn + np.array([0.0, -0.01, -0.11]), 0.075, 0.006, axes=sdf.frame(ax)), k=0.003)
        part(f"greave_{s}", gv, "ironstone", f"bone:shin.{s}", 390)
    # boots: a sole, a heel, a long instep down to a narrow rounded toe, the shaft with a turned cuff
    boots = Sculpt("boots")
    _BOOTS.clear()
    for s in ("L", "R"):
        an, toe, heel = jv(J, f"ankle.{s}"), jv(J, f"toe.{s}"), jv(J, f"heel.{s}")
        fwd = toe - heel
        fwd[2] = 0
        Lf = float(np.linalg.norm(fwd))
        fwd /= Lf
        lat = np.cross(fwd, (0, 0, 1.0))
        fr = np.stack([lat, fwd, [0, 0, 1.0]])                      # local X lateral, Y forward, Z up
        h0 = np.array([heel[0], heel[1], 0.0])
        boots.add(RoundBox(h0 + fwd * (Lf * 0.5 + 0.006) + np.array([0, 0, 0.012]), (0.057, Lf * 0.5 + 0.016, 0.012),
                           0.008, axes=fr), k=0.0)                                                    # sole
        boots.add(RoundBox(h0 + fwd * 0.055 + np.array([0, 0, 0.056]), (0.050, 0.052, 0.052), 0.03, axes=fr), k=0.02)   # heel
        boots.add(Ellipsoid(h0 + fwd * (Lf * 0.52) + np.array([0, 0, 0.058]), (0.053, 0.105, 0.052), axes=fr), k=0.03)  # instep
        boots.add(Ellipsoid(h0 + fwd * (Lf - 0.056) + np.array([0, 0, 0.037]), (0.050, 0.070, 0.035), axes=fr), k=0.025)  # toe box
        boots.add(FlatCapsule(np.array([an[0], an[1], 0.07]), np.array([an[0], an[1], 0.22]), 0.060, 0.062, 0.056, 0.058), k=0.04)
        boots.add(Torus(np.array([an[0], an[1], 0.212]), 0.058, 0.012, rz=0.016), k=0.006)                           # cuff
        boots.add(Torus(h0 + fwd * (Lf * 0.50) + np.array([0, 0, 0.060]), 0.052, 0.0065, axes=sdf.frame(fwd),
                        rz=0.0065), k=0.004)                                                                     # strap
        _BOOTS.append((h0 + fwd * (Lf * 0.50), fwd))
    boots.inter(HalfSpace((0, 0, 0.0), (0, 0, -1), 2.0), k=0.0)
    part("boots", boots, "leather", "auto", 760, 0.8)

    # SWORD on prop.R: grip, the broad recurved crossguard, pommel, accent inlays, the three blade states
    _J.update({k: jv(J, k) for k in ("shoulder.L", "shoulder.R", "elbow.L", "elbow.R", "wrist.L", "wrist.R")})
    sw = sword_frame(J)
    G, D, W, N = sw["G"], sw["D"], sw["W"], sw["N"]
    grip = Sculpt("grip")
    grip.add(Capsule(G - D * 0.03, G - D * 0.355, 0.021).displaced(lambda P: 0.003 * np.sin(((P - G) @ D) * 140.0), 0.003), k=0.0)
    part("grip", grip, "leather", "bone:prop.R", 220)
    gfr = np.stack([W, D, N])                                      # local X = width, Y = blade axis, Z = face
    guard = Sculpt("guard")
    guard.add(Extrude(G, GUARD_POLY, GUARD_H, 0.009, axes=gfr).displaced(chips(0.003, 18.0), 0.003), k=0.0)
    cu, cv, ch = CENTRE_DIAMOND
    cd = G + W * cu + D * cv
    guard.add(Ellipsoid(cd, (0.050, 0.050, GUARD_H + 0.007), axes=sdf.rot_z(45) @ gfr), k=0.012)   # the boss
    inl = []
    for u, v, a in GUARD_INLAYS:
        c = G + W * u + D * v
        lf = _lozenge_frame(W, D, N, a)
        for fn in (-1, 1):
            guard.sub(Extrude(c + N * fn * (GUARD_H + 0.006), [(x * 1.18, y * 1.25) for x, y in LOZENGE], 0.008, 0.002,
                              axes=lf), k=0.002)
        inl.append(("lz", c, lf))
    for fn in (-1, 1):                                  # the centre setting: a tight pocket, no dark ring
        guard.sub(RoundBox(cd + N * fn * (GUARD_H + 0.012), (ch * 1.06, ch * 1.06, 0.009), 0.002,
                           axes=sdf.rot_z(45) @ gfr), k=0.002)
    part("guard", guard, "chalk", "bone:prop.R", 520, 0.7)
    pm = G - D * 0.39
    pommel = Sculpt("pommel")
    pommel.add(RoundBox(pm, (0.037, 0.037, 0.02), 0.011, axes=sdf.rot_z(45) @ gfr), k=0.0)
    pommel.add(Torus(G - D * 0.35, 0.026, 0.01, axes=sdf.frame(D)), k=0.008)
    for fn in (-1, 1):
        pommel.sub(RoundBox(pm + N * fn * 0.021, (0.016, 0.016, 0.006), 0.003, axes=sdf.rot_z(45) @ gfr), k=0.002)
    part("pommel", pommel, "chalk", "bone:prop.R", 220)
    inlays = Sculpt("inlays")
    for _, c, lf in inl:
        for fn in (-1, 1):
            inlays.add(Extrude(c + N * fn * (GUARD_H - 0.0035), LOZENGE, 0.004, 0.0015, axes=lf), k=0.0)
    for fn in (-1, 1):
        inlays.add(RoundBox(cd + N * fn * (GUARD_H + 0.0025), (ch, ch, 0.004), 0.002, axes=sdf.rot_z(45) @ gfr), k=0.0)
        inlays.add(RoundBox(pm + N * fn * 0.0175, (0.0138, 0.0138, 0.004), 0.002, axes=sdf.rot_z(45) @ gfr), k=0.0)
    part("inlays", inlays, "accent", "bone:prop.R", 200, 0.5)
    G0 = G + D * 0.012
    _SWORD.update(sw, G0=G0)
    blade = Sculpt("blade")
    blade.add(Blade(G0, D, W, N, BLADE_L, *BLADE_SHAPE, bevel=BEVEL["blade"]), k=0.0)
    part("blade", blade, "dawnglass", "bone:prop.R", 280, 0.8, "base")
    stub = Sculpt("blade_hilt")
    stub.add(Blade(G0, D, W, N, STUB_L + 0.06, *STUB_SHAPE, bevel=BEVEL["blade_hilt"], cut=stub_cut), k=0.0)
    part("blade_hilt", stub, "dawnglass", "bone:prop.R", 240, 0.7, "hilt")
    great = Sculpt("blade_great")
    great.add(Blade(G0, D, W, N, GREAT_L, *GREAT_SHAPE, bevel=BEVEL["blade_great"]), k=0.0)
    part("blade_great", great, "dawnglass", "bone:prop.R", 300, 0.9, "great")
    return out


_SWORD: dict = {}                              # the rest-pose sword frame of the current build
_BOOTS: list = []                              # (strap centre, foot forward) per boot


def stub_cut(s, n):
    """the broken stub's jagged end (t limit per position across the width)"""
    return STUB_L - 0.045 + 0.05 * np.abs(np.sin(s * 95.0 + 0.7)) + 0.03 * np.sin(s * 37.0) - 0.4 * n


def _displaced_sculpt(S: Sculpt, fn, amp: float) -> Sculpt:
    """the whole sculpt displaced (folds/chips over every op): wrap its op list as one blended primitive"""
    out = Sculpt(S.name)
    out.add(sdf.Blend([(o, p, k) for o, p, k, _ in S.ops]).displaced(fn, amp), k=0.0)
    return out


def skin_extras(extra: dict, J) -> list:
    """skin-only geometry: Lamplit's lamp cage hanging from the pommel (four carved slats round a resin bead,
    6.8 cm tall) on a short cord off the pommel's camera side, so in the victory hold (the splash: pommel up,
    both hands on the grip) it hangs beside the hands instead of against the chest"""
    out = []
    if extra.get("lamp_cage"):
        sw = sword_frame(J)
        G, D, W = sw["G"], sw["D"], sw["W"]
        X = np.cross(D, W)
        X /= np.linalg.norm(X)
        side = 0.66 * X - 0.61 * W                     # the splash camera's side of the pommel in the hold
        side /= np.linalg.norm(side)
        pm = G - D * 0.39
        top = pm + side * 0.072 + D * 0.012
        c = top + D * 0.040
        fr = sdf.frame(D, W)
        cage, bead = Sculpt("lamp_cage"), Sculpt("lamp_bead")
        cage.add(Capsule(pm + side * 0.02, top, 0.0055), k=0.0)                      # the cord
        cage.add(Capsule(top - D * 0.006, top + D * 0.006, 0.010), k=0.004)
        cage.add(Torus(c - D * 0.026, 0.028, 0.0062, axes=fr), k=0.003)
        cage.add(Torus(c + D * 0.026, 0.032, 0.0062, axes=fr), k=0.003)
        cage.add(Sphere(c + D * 0.034, 0.011), k=0.004)
        for i in range(4):
            a = math.pi * 0.5 * i + math.pi * 0.25
            o = (W * math.cos(a) + X * math.sin(a)) * 0.033
            cage.add(Capsule(c + o * 0.85 - D * 0.026, c + o + D * 0.026, 0.0062), k=0.003)
        bead.add(Ellipsoid(c, (0.023, 0.023, 0.026), axes=fr), k=0.0)
        out.append(("lamp_cage", cage, 0.45, "wood", "bone:prop.R", 280, None))
        out.append(("lamp_bead", bead, 0.45, "lampresin", "bone:prop.R", 100, None))
    return out


_LOOK_ID: list = [None]                        # the skin id being built (the procedural paint's LOOK)


BLADE_LOWS = {"blade": (BLADE_L, BLADE_SHAPE, None), "blade_great": (GREAT_L, GREAT_SHAPE, None),
              "blade_hilt": (STUB_L + 0.06, STUB_SHAPE, stub_cut)}


def blade_low(name: str, L: float, shape, bevel: float, cut=None, col=None):
    """A clean low-poly blade (the SDF blade, built directly): a 10-point section (edges, bevels, flats) swept
    along the blade, a point (or the stub's jagged break), caps; sharp edges along the bevels. A decimated
    oblique voxel blade keeps 3-5x its triangle budget and shatters into UV islands."""
    G0, D, W, N_ = _SWORD["G0"], _SWORD["D"], _SWORD["W"], _SWORD["N"]
    w0, w1, th, tip = shape
    ht = 0.5 * th
    sec = [(1.0, 0.0, 0), (None, 0.86, 1), (0.33, 1.0, 1), (-0.33, 1.0, 1), (None, 0.86, -1), (-1.0, 0.0, 0),
           (None, -0.86, -1), (-0.33, -1.0, 1), (0.33, -1.0, 1), (None, -0.86, 1)]

    def ring(t, tend=None):
        hw = float(_blade_hw(np.array([t]), L, shape)[0])
        bev = min(bevel, 0.8 * hw)
        out = []
        for k, (u, nf, sg) in enumerate(sec):
            sv = u * hw if u is not None else sg * (hw - bev)
            tt = t if tend is None else float(tend(np.array([sv]), np.array([abs(nf * ht)]))[0])
            out.append(G0 + D * tt + W * sv + N_ * (nf * ht))
        return out
    if cut is None:
        ts = list(np.linspace(0.0, L - tip, 7)) + [L - tip * (1 - f) for f in (0.4, 0.7, 0.88)]
    else:
        ts = list(np.linspace(0.0, STUB_L - 0.075, 3))
    rings = [ring(t) for t in ts]
    if cut is not None:
        rings.append(ring(ts[-1], tend=lambda sv, nv: np.clip(cut(sv, nv), STUB_L - 0.07, STUB_L + 0.07)))
    verts, faces = [], []
    for r in rings:
        verts.extend(r)
    n = len(sec)
    for i in range(len(rings) - 1):
        for k in range(n):
            a, b = i * n + k, i * n + (k + 1) % n
            faces.append((a, b, b + n, a + n))
    verts.append(G0 - D * 0.004)                                    # base cap (inside the guard)
    c0 = len(verts) - 1
    for k in range(n):
        faces.append((c0, (k + 1) % n, k))
    last = (len(rings) - 1) * n
    if cut is None:
        verts.append(G0 + D * L)                                    # the point
    else:
        verts.append(np.mean(rings[-1], axis=0) + D * 0.01)         # the break, a shallow cone
    c1 = len(verts) - 1
    for k in range(n):
        faces.append((last + k, last + (k + 1) % n, c1))
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.update()
    ob = bpy.data.objects.new(name, me)
    (col or bpy.context.scene.collection).objects.link(ob)
    me.polygons.foreach_set("use_smooth", np.ones(len(me.polygons), dtype=bool))
    # rounded shading normals (a glass rod's light): across each face the normal turns from the face toward the
    # edge, so whatever way the flat faces the sun a pale band of the blade catches it (flat facets went dark
    # in game whenever the face turned edge-on to the light)
    nrm = []
    for ri in range(len(rings)):
        for k, (u, nf, sg) in enumerate(sec):
            sv = u if u is not None else sg * 0.62
            v = N_ * (np.sign(nf) * 1.0 if nf != 0 else 0.0) + W * (1.25 * sv)
            nrm.append(tuple(v / max(np.linalg.norm(v), 1e-6)))
    nrm.append(tuple(-D))
    nrm.append(tuple(D))
    me.normals_split_custom_set_from_vertices(nrm)
    me.update()
    return ob


LAME_ARC = (12.0, 166.0)             # the mantle plates' arc round each shoulder axis (deg from the front):
                                     # outside the scarf and breastplate in front, meeting the back plate behind
LAME_FLARE = 0.42                    # radius gained per m down a row (the plates flare out at their lower edge)


def _plate_frac(phi, seams):
    """(plate index, fraction 0..1 across the plate) of angles phi between jittered seams"""
    k = np.clip(np.searchsorted(seams, phi) - 1, 0, len(seams) - 2)
    a, b = seams[k], seams[k + 1]
    return k, (phi - a) / (b - a)


def _plate_hash(i, k, sx):
    h = np.sin(i * 7.31 + k * 3.917 + sx * 1.3) * 24634.6345
    return h - np.floor(h)


def lames_low(name: str, sx: int, col=None):
    """The mantle lames as a clean surface (5 rows of plates between jittered seams): per row an outer band whose
    plates ridge outward in their middle and hang lower there (a chipped, scalloped edge), flaring out toward
    the lower edge, a lip turning in under it. One grid per row: the UV islands stay whole."""
    A = np.array([sx * 0.165, 0.015, 0.0])
    verts, faces = [], []
    for i in range(LAME_ROWS):
        zc, R, hz = lame_row(i)
        sm = lame_seams(i, sx)
        cols = [LAME_ARC[0]]
        for k in range(len(sm) - 1):
            for f in (0.0, 0.5):
                phi = sm[k] + (sm[k + 1] - sm[k]) * f
                if LAME_ARC[0] + 1.0 < phi < LAME_ARC[1] - 1.0:
                    cols.append(phi)
        cols.append(LAME_ARC[1])
        base = len(verts)
        for c, phi in enumerate(cols):
            k, w = _plate_frac(np.array([phi]), sm)
            k, w = int(k[0]), float(w[0])
            b = 1.0 - (2.0 * w - 1.0) ** 2                                     # plate middle: ridge
            hsh = float(_plate_hash(i, k, sx))
            a = math.radians(phi)
            rad = np.array([sx * math.sin(a), -math.cos(a), 0.0])
            dz = float(lame_dz(phi))
            zb = zc - hz - (0.008 + 0.010 * hsh) * b
            for z in (zc + hz, zc + hz * 0.33, zc - hz * 0.40, zb):
                rr = R + (zc - z) * LAME_FLARE + 0.011 + 0.007 * b
                verts.append(A + rad * rr + np.array([0.0, 0.0, z + dz]))
            rr = R + (zc - zb) * LAME_FLARE - 0.011 + 0.007 * b
            verts.append(A + rad * rr + np.array([0.0, 0.0, zb + 0.004 + dz]))     # the lip, turned in
        n = 5
        for c in range(len(cols) - 1):
            for k in range(n - 1):
                a0, a1 = base + c * n + k, base + (c + 1) * n + k
                faces.append((a0, a0 + 1, a1 + 1, a1) if sx > 0 else (a0, a1, a1 + 1, a0 + 1))   # outward
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    (col or bpy.context.scene.collection).objects.link(ob)
    me.polygons.foreach_set("use_smooth", np.ones(len(me.polygons), dtype=bool))
    return ob


def _split4(t):
    a, b, c = (np.asarray(p, float) for p in t)
    ab, bc, ca = (a + b) / 2, (b + c) / 2, (c + a) / 2
    return [(a, ab, ca), (ab, b, bc), (ca, bc, c), (ab, bc, ca)]


def visor_low(name: str, col=None):
    """The face glass as clean geometry (a voxel slit of 2 cm decimates into a blob): the slit = a strip down
    its tail + a fan round the star (each fan triangle split in four so it follows the curved face), the two
    cheek lines = strips; every vertex sits GLASS_IN behind the face surface inside its groove, 2 mm thick
    with side walls."""
    import bmesh
    surf = _HELM[0]
    tris = []
    zs = SLIT_ZS
    for k in range(len(zs) - 1):
        z0, z1 = zs[k], zs[k + 1]
        a0, b0 = (FACE_XC - _slit_hw(z0), z0), (FACE_XC + _slit_hw(z0), z0)
        a1, b1 = (FACE_XC - _slit_hw(z1), z1), (FACE_XC + _slit_hw(z1), z1)
        if k == 0:
            tris.append((a0, b1, a1))
        else:
            tris += [(a0, b0, b1), (a0, b1, a1)]
    top = zs[-1]
    ring = [(FACE_XC + _slit_hw(top), top)] + STAR_PTS + [(FACE_XC - _slit_hw(top), top)]
    for i in range(len(ring)):
        for t in _split4((STAR_C, ring[i], ring[(i + 1) % len(ring)])):
            tris.append(t)
    for line in CHEEK_LINES:
        L, R = _strip_sides(line, CHEEK_HW)
        for i in range(len(L) - 1):
            tris += [(R[i], R[i + 1], L[i + 1]), (R[i], L[i + 1], L[i])]
    key = {}
    pts2 = []
    faces = []
    for t in tris:
        t = [np.asarray(p, float) for p in t]
        cr = (t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[1][1] - t[0][1]) * (t[2][0] - t[0][0])
        if abs(cr) < 1e-12:
            continue
        if cr < 0:
            t = [t[0], t[2], t[1]]
        ids = []
        for p in t:
            kk = (round(float(p[0]), 6), round(float(p[1]), 6))
            if kk not in key:
                key[kk] = len(pts2)
                pts2.append(kk)
            ids.append(key[kk])
        faces.append(tuple(ids))
    p2 = np.array(pts2)
    ys = surface_y(surf, p2[:, 0], p2[:, 1])
    n = len(p2)
    front = [(x, y + GLASS_IN, z) for (x, z), y in zip(p2, ys)]
    back = [(x, y + GLASS_IN + 0.002, z) for (x, z), y in zip(p2, ys)]
    allf = list(faces) + [(c + n, b + n, a + n) for a, b, c in faces]
    cnt = {}
    for a, b, c in faces:
        for e in ((a, b), (b, c), (c, a)):
            cnt[e] = cnt.get(e, 0) + 1
    for (a, b), _ in cnt.items():
        if (b, a) not in cnt:                                     # a boundary edge: a side wall
            allf.append((b, a, a + n, b + n))
    me = bpy.data.meshes.new(name)
    me.from_pydata(front + back, [], allf)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.update()
    me.polygons.foreach_set("use_smooth", np.ones(len(me.polygons), dtype=bool))   # flat faces split every vertex
    me.update()
    ob = bpy.data.objects.new(name, me)
    (col or bpy.context.scene.collection).objects.link(ob)
    return ob


def model(ctx) -> list:
    P = []
    extra = (ctx.skin or {}).get("extra") or {}
    _LOOK_ID[0] = (ctx.skin or {}).get("id")
    J = ctx.info.joints
    for name, S, vs, role, bind, tris, form in sculpts(J) + skin_extras(extra, J):
        if name in ("lames_R", "lames_L") or name in BLADE_LOWS:
            if name in BLADE_LOWS:
                Lb, shape, cut = BLADE_LOWS[name]
                ob = blade_low(f"{name}_low", Lb, shape, BEVEL[name], cut, ctx.col)
            else:
                ob = lames_low(f"{name}_low", -1 if name.endswith("R") else 1, ctx.col)
            ob.data.materials.append(ctx.mats[role])
            hi = ob.copy()                              # its own bake source (the low is joined into the body)
            hi.data = ob.data.copy()
            hi.name = f"{name}_high"
            ctx.col.objects.link(hi)
            P.append(fighter.Part(name, high=hi, low=ob, bind=bind, form=form, uv_weight=UV_WEIGHTS.get(name, 1.0)))
            continue
        v, q = S.mesh(VOXEL * vs)
        ob = sdf.to_object(f"{name}_high", v, q, ctx.col)
        ob.data.materials.append(ctx.mats[role])
        P.append(fighter.Part(name, high=ob, tris=tris, bind=bind, form=form, uv_weight=UV_WEIGHTS.get(name, 1.0)))
    vz = visor_low("visor_low", ctx.col)                # the face glass (accent): slit, star, cheek lines
    vz.data.materials.append(ctx.mats["accent"])
    hi = vz.copy()
    hi.data = vz.data.copy()
    hi.name = "visor_high"
    ctx.col.objects.link(hi)
    P.append(fighter.Part("visor", high=hi, low=vz, bind="bone:head"))
    return P


# texel density per part: the face is the signature (2x), the scarf/breastplate carry the chest read; the long
# coat and the legs give some back
UV_WEIGHTS = {"helm": 2.2, "crest": 1.2, "scarf": 1.3, "breastplate": 1.25, "pauldron_R": 1.15, "pauldron_L": 1.15,
              "coat": 0.75, "legs": 0.7, "boots": 0.8, "torso": 0.6, "arms": 0.85, "backplate": 1.1}


def extra_materials(ctx) -> dict:
    """dawnglass at roughness 0.4: a mirror-glossy glass (0.14) reflects the dark ground in game and the pale
    blade reads as a dark bar whenever it is raised or seen edge-on; still glossy, never emissive. Leather,
    ironstone, chalk and stone matte (0.8-0.88): the brief's matte painted plates; at 0.5-0.6 the low splash
    camera sees the bright sky in them and the dark boots and greaves turn pale."""
    p = dict(materials.BIBLE_PALETTE)
    p.update(ctx.palette)
    g = ctx.gradient
    glass = materials.glass("dawnglass", p, "dawnglass", g, rough=0.36, inclusions=0.0)
    for nd in glass.node_tree.nodes:               # no bump: baked into the normal map it read as frosted grain
        if nd.type == "BSDF_PRINCIPLED":
            for lk in list(nd.inputs["Normal"].links):
                glass.node_tree.links.remove(lk)
    return {"dawnglass": glass,
            "leather": materials.waxed_leather("leather", p, "leather", g, rough=0.84),
            "ironstone": materials.honed_stone("ironstone", p, "ironstone", g, rough=0.88, chisel=0.8, speckle=0.6),
            "chalk": materials.honed_stone("chalk", p, "chalk", g, rough=0.80, chisel=0.7),
            "stone": materials.honed_stone("stone", p, "stone", g, rough=0.80, chisel=1.0)}


# ── rig extras: the prop bone along the blade, VFX sockets, cloth chains ───────────────────────────
def rig_extras(ctx) -> None:
    info = ctx.info
    sw = sword_frame(info.joints)
    arm = info.armature
    scene.select_only([arm], arm)
    bpy.ops.object.mode_set(mode="EDIT")
    b = arm.data.edit_bones["prop.R"]
    C, D, W = V(tuple(sw["C"])), V(tuple(sw["D"])), V(tuple(sw["W"]))
    b.head = C                                   # the grip point in the right fist's curl
    b.tail = C + D * 0.12                        # +Y = the held item's main axis = the blade
    b.align_roll(W)
    bl = arm.data.edit_bones["prop.L"]           # the left fist's grip line (the mirror image): the two-handed
    bl.head = V(tuple(mirror_x(sw["C"])))        # holds lay it along the sword's grip below the right fist
    bl.tail = bl.head + V(tuple(mirror_x(sw["D"]))) * 0.12
    bl.align_roll(V(tuple(mirror_x(sw["W"]))))
    bpy.ops.object.mode_set(mode="OBJECT")
    info.lengths["prop.R"] = arm.data.bones["prop.R"].length
    info.lengths["prop.L"] = arm.data.bones["prop.L"].length
    tip = sw["G"] + sw["D"] * (BLADE_L + 0.012)
    rig.add_socket(info, "x_blade_tip", "prop.R", tuple(tip), direction=tuple(sw["D"] * 0.1))
    rig.add_socket(info, "x_crossguard", "prop.R", tuple(sw["G"]), direction=tuple(sw["W"] * 0.1))
    for nm, (top, bot) in CAPE_TAILS.items():          # the coat's two back tails
        libparts.add_chain(ctx, nm, "hips", top, bot, bones=2, z_hint=(0, 1, 0))     # on the hips: a torso twist
                                                                                     # no longer flings them
    libparts.add_chain(ctx, "tabard_f", "hips", (0.0, -0.165, 1.27), (0.0, -0.175, 0.66), bones=1, z_hint=(0, -1, 0))


def _tail_drive(side: str):
    """a tail is kicked back by its own leg swinging back and by a forward lean; in the run the clip keys each
    tail's trailing push (`_cape_L` / `_cape_R`: the run's wind plus the stride, the two tails half a cycle
    apart) so the back of the coat flutters instead of sliding along as one board"""
    def fn(p):
        th = p.get(f"thigh.{side}", (0.0, 0.0, 0.0))[0]
        lean = max(0.0, p.get("spine", (0.0, 0.0, 0.0))[0]) + max(0.0, p.get("hips", (0.0, 0.0, 0.0))[0])
        return 0.5 * max(0.0, -th) + 0.5 * lean + p.get(f"_cape_{side}", (0.0,))[0]
    return fn


def chain_config(ctx) -> list:
    """the coat's two tails: damped but alive (they swing with the stride and lag in strikes, within limits so
    they never fly out); gravity pulls the lower bone only half way so a trailing tail stays a line, not a kink;
    the tabard on its own short chain"""
    tail = dict(gravity=0.55, stiffness=110.0, damping=12.0, inertia=0.35, limit=(-15.0, 25.0))
    return libparts.chain_configs(ctx, {"cape_L": dict(tail, drive=_tail_drive("L")),
                                        "cape_R": dict(tail, drive=_tail_drive("R")),
                                        "tabard_f": dict(limit=(-40.0, 45.0))})


def _smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _bind_coat(ctx, obj, chain_name: str, root: str) -> None:
    """The coat's weights: above the tails' root the back is rigid with the chest; below it each back tail hangs
    on its own chain (cape_L / cape_R, the two blended above the slit), the front flaps and the sides in front
    of the hip line follow the body (chest / spine / hips, then the thigh of their side) so a strike or a
    stride bends the coat instead of swinging it as one board."""
    arm = ctx.info.armature
    me = obj.data
    mw = obj.matrix_world
    zt = CAPE_TAILS["cape_L"][0][2]
    zb = CAPE_TAILS["cape_L"][1][2]

    def root_w(z):
        """the coat above the tails follows the torso: the chest above 1.30, blending down to the spine/hips"""
        if z > 1.30:
            return {"chest": 1.0}
        if z > 1.10:
            k = float(_smooth(1.10, 1.30, np.array([z]))[0])
            return {"chest": k, "spine": 1 - k}
        up = float(_smooth(0.98, 1.10, np.array([z]))[0])
        return {"spine": up, "hips": 1 - up}

    def tail_w(side, z):
        """chain_weights' scheme on a straight vertical chain: the top 35 % of the first bone shared with the torso,
        then blended between bone centres"""
        bones = ctx.chains[f"cape_{side}"]
        s = max(0.0, (zt - z) / (zt - zb)) * len(bones)
        if s < 0.35:
            out = {b_: w_ * (1.0 - s / 0.35) for b_, w_ in root_w(z).items()}
            out[bones[0]] = out.get(bones[0], 0.0) + s / 0.35
            return out
        x = s - 0.5
        k0 = int(math.floor(x))
        f = x - k0
        a, b = bones[max(0, min(len(bones) - 1, k0))], bones[max(0, min(len(bones) - 1, k0 + 1))]
        out = {a: 1.0 - f}
        out[b] = out.get(b, 0.0) + f
        return out
    rows = []
    for v in me.vertices:
        p = mw @ v.co
        wl = float(_smooth(-0.035, 0.035, np.array([p.x]))[0]) if p.z > COAT["slit"][0] else (1.0 if p.x > 0 else 0.0)
        cw = {}
        for side, w in (("L", wl), ("R", 1.0 - wl)):
            if w <= 0:
                continue
            for b_, ww in tail_w(side, p.z).items():
                cw[b_] = cw.get(b_, 0.0) + ww * w
        y0 = float(coat_lerp(COAT["y0"], np.array([p.z]))[0])
        f = float(_smooth(-0.01, -0.13, np.array([p.y - y0]))[0])            # 1 on the front flaps
        bw = {}
        z = p.z
        if z > 1.30:
            bw["chest"] = 1.0
        elif z > 1.10:
            k = float(_smooth(1.10, 1.30, np.array([z]))[0])
            bw["chest"], bw["spine"] = k, 1 - k
        else:
            side = "thigh.L" if p.x > 0 else "thigh.R"
            k = 0.62 * float(_smooth(1.02, 0.55, np.array([z]))[0])
            up = float(_smooth(0.98, 1.10, np.array([z]))[0])
            bw["spine"] = up * (1 - k)
            bw["hips"] = (1 - up) * (1 - k)
            bw[side] = k
        tot = {}
        for b_, w in cw.items():
            tot[b_] = tot.get(b_, 0.0) + w * (1 - f)
        for b_, w in bw.items():
            tot[b_] = tot.get(b_, 0.0) + w * f
        rows.append(tot)
    obj.vertex_groups.clear()
    groups = {}
    for i, tot in enumerate(rows):
        s = sum(tot.values()) or 1.0
        for b_, w in tot.items():
            if w / s < 1e-3:
                continue
            g = groups.get(b_) or obj.vertex_groups.new(name=b_)
            groups[b_] = g
            g.add([i], w / s, "REPLACE")
    libmesh.add_armature_modifier(obj, arm)
    libmesh.parent_keep(obj, arm)


_orig_bind_part = pipeline.bind_part


def _bind_part(ctx, part, obj, body_low=None):
    b = part.bind
    if isinstance(b, tuple) and b[0] == "coatmix":
        _bind_coat(ctx, obj, b[1], b[2])
        libmesh.limit_weights(obj)
        return {}
    return _orig_bind_part(ctx, part, obj, body_low)


pipeline.bind_part = _bind_part


# ── motion ───────────────────────────────────────────────────────────────────────────────────────
# arm blocks over anim.ONE_HAND: (R wrist rel, R pole, R aim = the BLADE's direction (prop.R runs along the
# blade), L wrist, L pole). With weapon two_hand the right wrist moves 12 % inward and the left hand grips the
# grip 0.17 m behind the right. The point-low guard: the blade forward and down on her right, tip ~0.35 m up.
BLOCKS = {
    "guard":   ((0.30, -0.50, -0.80), (-0.8, 0.5, -0.4), (-0.28, -0.82, -0.50), (-0.07, -0.37, -0.83), None),
    # run (both hands on the grip at the right hip): the blade trails behind and out to her right, near level
    # (the point ~0.55 m up): whichever way she runs it clears the body from the 52 deg game camera: to the
    # side, or (running away from her right side) past the crest above her head; a low trail hid behind the
    # mantle whenever it pointed away from the camera (the great blade still clears the ground)
    "run_fwd": ((-0.30, -0.12, -0.90), (-0.8, 0.4, -0.4), (-0.64, 0.71, -0.29), (-0.15, -0.58, -0.62), None),
    "run_back": ((-0.32, 0.04, -0.92), (-0.7, 0.6, -0.3), (-0.66, 0.69, -0.30), (0.12, 0.34, -0.80), None),
    # Shatter's smash lands out to her right (the broken blade reads beside the body from behind too)
    "sl_hit":  ((-0.10, -0.66, -0.66), (-0.8, 0.3, -0.3), (-0.70, -0.42, -0.58), (-0.15, -0.60, -0.60), None),
    "sl_fol":  ((-0.12, -0.60, -0.70), (-0.8, 0.3, -0.3), (-0.74, -0.36, -0.57), (-0.15, -0.55, -0.65), None),
    "stunned": ((0.10, -0.25, -0.95), (-0.8, 0.5, -0.3), (-0.35, -0.30, -0.89), (0.05, -0.20, -0.96), None),
    "dash":    ((0.05, 0.40, -0.85), (-0.7, 0.5, 0.2), (-0.30, 0.80, -0.50), (0.20, 0.60, -0.70), None),
}
MOTION = anim.motion_profile(weight="medium", weapon="two_hand", stance="guard", run_ref_speed=3.45, blocks=BLOCKS)
GRIP_L = -0.125         # the left hand on the grip, toward the pommel from the right palm (m along the blade)
F = FootTarget


def _feet(g, dl=(0.0, 0.0, 0.0), dr=(0.0, 0.0, 0.0), pl=None, pr=None, yl=None, yr=None):
    fl, fr = g["ik"]["foot.L"], g["ik"]["foot.R"]
    return {"foot.L": F(tuple(fl.ankle[i] + dl[i] for i in range(3)), fl.pitch if pl is None else pl,
                        fl.yaw if yl is None else yl),
            "foot.R": F(tuple(fr.ankle[i] + dr[i] for i in range(3)), fr.pitch if pr is None else pr,
                        fr.yaw if yr is None else yr)}


def _pose(g, torso=None, hips=(0.0, 0.0, 0.0), R=None, Rpos=None, Rpole=(-0.8, 0.5, -0.4), aim=None, L=GRIP_L,
          Lrel=None, Lpole=(0.8, 0.4, -0.4), feet=None, extra=None):
    """a full pose over the guard `g`: torso rotation deltas, hips offset, the right wrist (rel or pos), the
    blade's direction, the left hand on the grip (or free at Lrel), feet targets"""
    p = anim.add(g, anim.P(**(torso or {})))
    if extra:
        p = anim.add(p, anim.P(**extra))
    ik = dict(g["ik"])
    if R is not None:
        ik["hand.R"] = HandTarget(rel=tuple(R), pole=tuple(Rpole))
    if Rpos is not None:
        ik["hand.R"] = HandTarget(pos=tuple(Rpos), pole=tuple(Rpole))
    if aim is not None:
        ik["aim.R"] = Aim(tuple(aim))
    if Lrel is not None:
        ik["hand.L"] = HandTarget(rel=tuple(Lrel), pole=tuple(Lpole))
    elif L is not None:
        ik["hand.L"] = HandTarget(to_prop=("prop.R", L), pole=tuple(Lpole))
    if feet:
        ik.update(feet)
    p["ik"] = ik
    hx, hy, hz = g.get("hips_loc", (0.0, 0.0, 0.0))
    p["hips_loc"] = (hx + hips[0], hy + hips[1], hz + hips[2])
    return p


def _strike(name, frames, g, wind, hit, fol, lags=None):
    fn = anim.keyed(anim.strike_keys(MOTION, wind, hit, fol, g))
    return anim.Clip(name, frames, False, anim.drag(fn, frames, lags or {"head": 1.5, "neck": 1.0}), impact=anim.IMPACT)


def _plant(palm, tip):
    """the right palm at `palm` (m, armature space) and the blade's direction to its point at `tip`"""
    palm = np.array(palm, dtype=float)
    d = np.array(tip, dtype=float) - palm
    d /= np.linalg.norm(d)
    return tuple(palm), tuple(d)


def _grounded(g, lean=0.0, twist=0.0, tip=(0.02, -0.62, 0.0), hand_z=1.30, crouch=0.0):
    """the blade planted point-down in front, both hands stacked on the grip under the pommel"""
    tipv = np.array(tip)
    palm = np.array([0.0, -0.20 + lean, hand_z - crouch])
    d = tipv - palm
    d /= np.linalg.norm(d)
    d = d + np.array([math.sin(math.radians(twist)) * 0.05, 0.0, 0.0])
    return palm, tuple(d / np.linalg.norm(d))


def clip_overrides(ctx) -> dict:
    """The brief's gestures (section 8): Heavy Arc / Quick Jab, Glass Guard / Shard Kick, Shatter / Reform,
    Whole Again, the grounded-blade lobby, the strike-down victory, a grounded recall, a blade-dropping death
    and a leaping dash (the renderer plays `dash` over Whole Again's 6 m leap and Quick Jab's dash)."""
    prof = MOTION
    skel = anim.Skeleton(ctx.info.armature)
    _GUARD["pose"] = _build_guard(ctx, skel)
    g = anim.guard(prof)
    run = anim.gen_run(prof)                                         # both hands on the grip, the blade trailing
    run_fn = run.sample

    def run_sample(t):
        p = dict(run_fn(t))
        # each tail trails in the run's wind and is kicked back as its own leg drives back (the left leg is back
        # at t ~0.5, the right at t ~0)
        p["_cape_L"] = (12.0 + 10.0 * math.sin(2 * math.pi * (t - 0.25)), 0.0, 0.0)
        p["_cape_R"] = (12.0 + 10.0 * math.sin(2 * math.pi * (t + 0.25)), 0.0, 0.0)
        return p
    out = {
        "idle": _idle(ctx),
        "run": anim.Clip("run", run.frames, True, run_sample, meta=run.meta),
        "attack1": anim.gen_strike("attack1", "attack1", prof, 25),  # diagonal slash (impact f10)
        "attack2": _return_slash(g),                                 # two-handed return slash
        "cast_a3": anim.gen_strike("cast_a3", "slam", prof, 30, step=0.10),   # Shatter: overhead, smashed down at f12
    }
    # cast_a1 Heavy Arc / Quick Jab (20 f, f8): coiled high on the right, a cross-body diagonal that ends in a
    # deep forward lunge at f8 (the left foot 0.46 m ahead, the back heel up, the hips dropped)
    wind = _pose(g, dict(hips=(2, 28, 0), spine=(2, 16, 0), chest=(0, 20, 0), head=(0, -16, 0)), (0.0, 0.05, -0.04),
                 R=(-0.10, 0.05, -0.20), Rpole=(-0.9, 0.4, 0.1), aim=(-0.70, 0.35, 0.62))
    lunge = _feet(g, dl=(0.04, -0.46, 0.0), dr=(-0.02, 0.12, 0.0), pl=4, pr=-22)
    hit = _pose(g, dict(hips=(14, -22, 0), spine=(10, -12, 0), chest=(8, -16, 0), head=(-8, 12, 0)), (0.0, -0.20, -0.15),
                R=(0.45, -0.88, -0.30), Rpole=(-0.6, 0.3, -0.6), aim=(0.60, -0.70, -0.38), feet=lunge)
    fol = _pose(g, dict(hips=(15, -32, 0), spine=(11, -16, 0), chest=(9, -22, 0), head=(-9, 16, 0)), (0.0, -0.22, -0.16),
                R=(0.72, -0.58, -0.36), Rpole=(-0.5, 0.5, -0.6), aim=(0.92, -0.20, -0.34), feet=lunge)
    out["cast_a1"] = _strike("cast_a1", 20, g, wind, hit, fol)
    out["cast_a2"] = _glass_guard(g)
    out["cast_ult"] = _ult(g)
    out["dash"] = _leap(g)
    out["idle_lobby"] = _lobby(g)
    out["victory"] = _victory(g)
    out["recall"] = _recall(g, ctx)
    out["death"] = _death(g, skel)
    return out


def _return_slash(g) -> anim.Clip:
    """attack2 (25 f, f10): the return slash, two-handed: wound low on her left (the blade back past the hip),
    the hips drive round and the right foot steps out as the blade sweeps flat across the front to her right"""
    step = _feet(g, dl=(0.0, 0.05, 0.0), dr=(-0.08, -0.26, 0.0), pl=-10, yr=-20)
    wind = _pose(g, dict(hips=(2, 26, 0), spine=(2, 14, 0), chest=(4, 22, 0), head=(0, -16, 0)), (0.0, 0.03, -0.05),
                 R=(0.36, -0.40, -0.62), Rpole=(-0.4, 0.7, -0.5), aim=(0.82, 0.32, -0.30))
    hit = _pose(g, dict(hips=(6, -22, 0), spine=(6, -12, 0), chest=(8, -20, 0), head=(0, 14, 0)), (0.0, -0.10, -0.11),
                R=(0.05, -0.86, -0.32), Rpole=(-0.7, 0.3, -0.6), aim=(-0.50, -0.86, -0.08), feet=step)
    fol = _pose(g, dict(hips=(6, -32, 0), spine=(6, -16, 0), chest=(8, -26, 0), head=(0, 18, 0)), (0.0, -0.11, -0.11),
                R=(-0.22, -0.72, -0.24), Rpole=(-0.6, 0.5, -0.6), aim=(-0.95, -0.18, 0.06), feet=step)
    return _strike("attack2", 25, g, wind, hit, fol)


def _glass_guard(g) -> anim.Clip:
    """cast_a2 Glass Guard / Shard Kick (25 f, f10): she drives the blade point-down into the ground at her
    front-right and braces behind it, both hands on the grip; at f10 (the plant) her left leg kicks out
    high past the blade's left side, the sole forward: the plant and the kick read in the same frame."""
    pw, dw = _plant((-0.10, -0.24, 1.46), (-0.20, -0.52, 0.42))
    ph, dh = _plant((-0.10, -0.25, 1.12), (-0.23, -0.60, -0.02))
    pf, df = _plant((-0.10, -0.24, 1.10), (-0.23, -0.60, -0.02))
    wind = _pose(g, dict(hips=(-6, 14, 0), spine=(-6, 6, 0), chest=(-8, 8, 0), head=(-8, -6, 0)), (-0.02, 0.05, 0.03),
                 Rpos=pw, Rpole=(-0.9, 0.3, 0.1), aim=dw,
                 feet={"foot.L": F((-0.01, -0.10, 0.30), 18.0, -4.0), "foot.R": F((0.0, 0.06, 0.0), 0.0, 8.0)})
    hit = _pose(g, dict(hips=(-12, -10, 0), spine=(6, 4, 0), chest=(8, 6, 0), neck=(-4, 0, 0), head=(-8, 8, 0),
                        thigh_L=(0, 0, 0)), (-0.05, 0.08, -0.05),
                Rpos=ph, Rpole=(-0.9, 0.3, -0.2), aim=dh,
                feet={"foot.L": F((-0.05, -0.78, 0.68), 52.0, 4.0), "foot.R": F((0.0, 0.08, 0.0), 0.0, 10.0)})
    fol = _pose(g, dict(hips=(-10, -8, 0), spine=(5, 3, 0), chest=(7, 5, 0), neck=(-4, 0, 0), head=(-8, 6, 0)),
                (-0.05, 0.08, -0.06), Rpos=pf, Rpole=(-0.9, 0.3, -0.2), aim=df,
                feet={"foot.L": F((-0.05, -0.70, 0.58), 42.0, 2.0), "foot.R": F((0.0, 0.08, 0.0), 0.0, 10.0)})
    return _strike("cast_a2", 25, g, wind, hit, fol)


_GUARD: dict = {}                              # the shared rest pose of every clip (built in clip_overrides)
_orig_guard = anim.guard


def _guard(profile: dict, crouch: float = 1.0) -> dict:
    """Ervet's guard IS her idle (the concept's stance): every action clip starts and ends on it, so entering
    or leaving combat never snaps the blade (the 60-100 ms crossfades)"""
    if profile is not MOTION or "pose" not in _GUARD:
        return _orig_guard(profile, crouch)
    p = dict(_GUARD["pose"])
    p["ik"] = dict(p["ik"])
    if crouch != 1.0:
        hx, hy, hz = p["hips_loc"]
        p["hips_loc"] = (hx, hy, hz - 0.03 * (crouch - 1.0))
    return p


anim.guard = _guard


def _rel_of(skel, pose: dict, side: str, pos) -> tuple:
    """a wrist position (armature space) as a HandTarget `rel` over `pose` (arm lengths, chest frame), so the
    idle's hand lerps smoothly into the strike blocks (a pos -> rel lerp jumps half way)"""
    q = {k: v for k, v in pose.items() if k != "ik"}
    q["ik"] = {k: v for k, v in pose.get("ik", {}).items() if k.startswith("foot")}
    res = anim.resolve(skel, q)
    M = skel.fk(res)
    up = f"upper_arm.{side}"
    sh = (M[skel.parent[up]] @ skel.local[up]).translation
    Rc = M["chest"].to_3x3() @ skel.rest["chest"].to_3x3().inverted()
    Ln = skel.length[up] + skel.length[f"forearm.{side}"]
    return tuple(Rc.inverted() @ ((V(tuple(pos)) - sh) / Ln))


def _build_guard(ctx, skel) -> dict:
    """the concept's stance: relaxed, the right fist at the hip holding the grip, the blade crossing the front
    point-low to her left, the left arm hanging free (a loose fist)"""
    J = ctx.info.joints
    st = anim.stance(dict(MOTION, stance="neutral"), 0.45)
    sw = sword_frame(J)
    d = np.array(sw["D"]) + np.array([0.0, 0.0, 0.08])
    d /= np.linalg.norm(d)
    wr = np.array(J["wrist.R"][:]) + np.array([0.015, -0.035, -0.02])
    base = anim.merge(st, anim.P(forearm_L=(6, 0, 0), hand_L=(4, 0, -4), shoulder_L=(0, 0, -2), shoulder_R=(0, 0, -2)))
    ik = dict(base["ik"])
    ik["hand.R"] = HandTarget(rel=_rel_of(skel, base, "R", wr), pole=(-0.8, 0.5, -0.4))
    ik["aim.R"] = Aim(tuple(d))
    base["ik"] = ik
    return base


def _idle(ctx) -> anim.Clip:
    """idle (72 f loop): the guard (the concept's stance) breathing: visible breath in the chest and mantle, a
    weight shift, a glance to her right"""
    N = 72
    base = anim.guard(MOTION)

    def sample(t):
        b = anim.osc(t, 2)                                   # two breaths
        s = anim.osc(t, 1, 0.1)                              # a weight shift
        look = math.sin(math.pi * min(1.0, max(0.0, (t - 0.30) / 0.35))) ** 2   # a glance to her right
        dlt = anim.P(chest=(2.6 * b, 0, 0), spine=(1.0 * b, 0, 1.4 * s), neck=(-1.6 * b, 0, 0),
                     head=(-1.0 * b, 2.0 * s - 9.0 * look, 0), shoulder_L=(0, 0, 2.6 * b), shoulder_R=(0, 0, -2.6 * b),
                     hips=(0, 2.0 * s, -2.2 * s), upper_arm_L=(2.0 * b, 0, 1.5 * b), forearm_L=(3.0 * b, 0, 0))
        p = anim.add(base, dlt)
        p["ik"] = dict(p["ik"])
        h = p["ik"]["hand.R"]
        p["ik"]["hand.R"] = HandTarget(rel=(h.rel[0], h.rel[1], h.rel[2] + 0.02 * b), pole=h.pole)
        hx, hy, hz = base.get("hips_loc", (0.0, 0.0, 0.0))
        p["hips_loc"] = (hx + 0.022 * s, hy, hz - 0.008 * (0.5 + 0.5 * b))
        return p
    return anim.Clip("idle", N, True, sample)


def _ult(g) -> anim.Clip:
    """Whole Again (35 f, f14 = the push-off). In game the cast state plays f0-f14 while the sim holds her still,
    then the 6 m dash plays `dash` (the leap's arc): so f0-f14 stay on the ground (a deep coil, the blade drawn
    behind, a breathing hold, the last drop into the push) and the airborne arc lives in `dash`. f14-f35 (the
    showcase / QA) play the same leap in place: apex, the downswing, the landing held f22-f28, rise."""
    N = 35
    coil = _pose(g, dict(hips=(18, 14, 0), spine=(14, 8, 0), chest=(12, 8, 0), neck=(-6, 0, 0), head=(-12, -6, 0)),
                 (0.0, 0.10, -0.24), R=(-0.10, 0.45, -0.60), Rpole=(-0.8, 0.5, 0.2), aim=(-0.35, 0.80, -0.48),
                 feet=_feet(g, dl=(0.02, -0.05, 0.0), dr=(-0.02, 0.10, 0.0)))
    coil2 = anim.add(coil, anim.P(chest=(2, 0, 0), head=(-2, 0, 0)))
    coil2["hips_loc"] = (coil["hips_loc"][0], coil["hips_loc"][1], coil["hips_loc"][2] - 0.025)
    push = _push(g)
    air = _air(g, lift=0.36)
    land = _land(g)
    land2 = anim.add(land, anim.P(chest=(1.5, 0, 0)))
    land2["hips_loc"] = (land["hips_loc"][0], land["hips_loc"][1], land["hips_loc"][2] + 0.015)
    keys = [(0.0, g, "linear"), (0.12, coil, "inout"), (0.28, coil2, "sine"), (0.35, anim.lerp_pose(coil2, push, 0.5), "in"),
            (anim.IMPACT, push, "out"), (0.52, air, "out"), (0.63, land, "accel"), (0.80, land2, "sine"),
            (0.90, anim.lerp_pose(land2, g, 0.55), "inout"), (1.0, g, "settle")]
    return anim.Clip("cast_ult", N, False, anim.drag(anim.keyed(keys), N, {"head": 1.5, "neck": 1.0}), impact=anim.IMPACT)


def _push(g):
    """the push-off: still on the ground, hips driving up and forward, the blade drawn back low at the right hip,
    point forward (Whole Again's f14 = the dash's first frame)"""
    return _pose(g, dict(hips=(24, 6, 0), spine=(10, 4, 0), chest=(6, 4, 0), neck=(-8, 0, 0), head=(-14, -2, 0)),
                 (0.0, -0.02, -0.16), R=(0.02, 0.30, -0.70), Rpole=(-0.8, 0.5, 0.0), aim=(-0.20, -0.85, -0.48),
                 feet=_feet(g, dl=(0.02, -0.10, 0.0), dr=(-0.02, 0.22, 0.04), pr=-30))


def _air(g, lift=0.42):
    return _pose(g, dict(hips=(-8, 0, 0), spine=(-10, 0, 0), chest=(-12, 0, 0), neck=(-6, 0, 0), head=(-10, 0, 0),
                         thigh_L=(30, 0, 0), thigh_R=(20, 0, 0)),
                 (0.0, 0.02, lift), R=(0.30, -0.12, 0.95), Rpole=(-0.9, -0.2, 0.2), aim=(0.0, 0.45, 0.89),
                 feet={"foot.L": F((0.03, -0.10, lift + 0.20), 20.0, -6.0, 0.0, 0.0, 1.0),
                       "foot.R": F((-0.03, 0.10, lift + 0.10), 10.0, -20.0, 0.0, 0.0, 1.0)})


def _land(g):
    return _pose(g, dict(hips=(22, -4, 0), spine=(16, 0, 0), chest=(12, 0, 0), neck=(-6, 0, 0), head=(-10, 0, 0)),
                 (0.0, -0.06, -0.26), R=(0.30, -0.80, -0.50), Rpole=(-0.8, 0.3, -0.3), aim=(-0.05, -0.62, -0.78),
                 feet=_feet(g, dl=(0.04, -0.14, 0.0), dr=(-0.04, 0.14, 0.0)))


def _leap(g) -> anim.Clip:
    """dash (20 f, fitted to each dash): a leaping thrust. The sim moves her flat, so the arc is in the clip:
    push off with the blade drawn back at the hip (point forward), rise with the blade lifted high and forward,
    the apex (hips +0.42 m, the hands overhead), then the thrust: arms driven straight out, point first, landing
    in a deep lunge with the blade extended forward-down, held for the last 25 %. Quick Jab plays it in 0.17 s
    (a lunging stab with the stub), Whole Again in 0.36 s (a leap that lands the great blade point first).
    (One `dash` clip serves both: present.anim names a clip role, not a clip.)"""
    N = 20
    push = _push(g)
    rise = _pose(g, dict(hips=(10, 0, 0), spine=(0, 0, 0), chest=(-4, 0, 0), neck=(-8, 0, 0), head=(-12, 0, 0),
                         thigh_L=(46, 0, 0), thigh_R=(-24, 0, 0), shin_R=(-40, 0, 0)),
                 (0.0, -0.08, 0.30), R=(0.22, -0.62, 0.40), Rpole=(-0.9, 0.0, -0.2), aim=(0.0, -0.80, 0.60),
                 feet={"foot.L": F((0.03, -0.32, 0.50), 14.0, -4.0, 0.0, 0.0, 1.0),
                       "foot.R": F((-0.03, 0.34, 0.36), -32.0, 4.0, 0.0, 0.0, 1.0)})
    apex = _pose(g, dict(hips=(4, 0, 0), spine=(-4, 0, 0), chest=(-8, 0, 0), neck=(-6, 0, 0), head=(-10, 0, 0),
                         thigh_L=(56, 0, 0), thigh_R=(-14, 0, 0)),
                 (0.0, -0.10, 0.42), R=(0.18, -0.48, 0.70), Rpole=(-0.9, -0.1, 0.0), aim=(0.0, -0.66, 0.75),
                 feet={"foot.L": F((0.03, -0.36, 0.64), 18.0, -4.0, 0.0, 0.0, 1.0),
                       "foot.R": F((-0.03, 0.26, 0.46), -18.0, 4.0, 0.0, 0.0, 1.0)})
    thrust = _pose(g, dict(hips=(14, -4, 0), spine=(8, -2, 0), chest=(4, -2, 0), neck=(-8, 0, 0), head=(-12, 2, 0),
                           thigh_L=(40, 0, 0)),
                   (0.0, -0.16, 0.16), R=(0.20, -0.98, -0.02), Rpole=(-0.8, 0.2, -0.5), aim=(0.03, -0.99, -0.12),
                   feet={"foot.L": F((0.03, -0.44, 0.22), 8.0, -4.0, 0.0, 0.0, 1.0),
                         "foot.R": F((-0.03, 0.34, 0.14), -24.0, 4.0, 0.0, 0.0, 1.0)})
    land = _pose(g, dict(hips=(18, -6, 0), spine=(12, -2, 0), chest=(8, -2, 0), neck=(-8, 0, 0), head=(-12, 2, 0)),
                 (0.0, -0.20, -0.22), R=(0.20, -0.96, -0.22), Rpole=(-0.8, 0.2, -0.5), aim=(0.03, -0.92, -0.38),
                 feet=_feet(g, dl=(0.04, -0.46, 0.0), dr=(-0.03, 0.30, 0.0), pr=-28))
    land2 = anim.add(land, anim.P(chest=(1.5, 0, 0), head=(-1, 0, 0)))
    land2["hips_loc"] = (land["hips_loc"][0], land["hips_loc"][1], land["hips_loc"][2] + 0.012)
    keys = [(0.0, push, "linear"), (0.22, rise, "out"), (0.42, apex, "out"), (0.60, thrust, "in"),
            (0.75, land, "accel"), (1.0, land2, "sine")]
    return anim.Clip("dash", N, False, anim.drag(anim.keyed(keys), N, {"head": 1.0, "neck": 0.6}))


def _lobby(g) -> anim.Clip:
    """idle_lobby (120 f loop): the blade grounded, both hands on the grip; she turns it to catch the light, taps
    the flat with a knuckle, tilts her head at the note, checks again. The point never leaves the floor."""
    N = 120
    st = anim.merge(anim.stance(dict(MOTION, stance="neutral"), 0.5), anim.arms_relaxed())
    st["hips_loc"] = (0.0, 0.0, st["hips_loc"][2])
    pa, da = _grounded(st, hand_z=1.28)
    pb, db = _grounded(st, hand_z=1.28, twist=16.0)
    base = _pose(st, dict(head=(-4, 0, 0)), Rpos=pa, aim=da)
    turn = _pose(st, dict(chest=(0, -6, 0), head=(-2, 10, 6)), Rpos=pb, aim=db)
    tap_up = _pose(st, dict(chest=(2, 4, 0), head=(4, -6, 0)), Rpos=pa, aim=da, Lrel=(-0.30, -0.70, -0.42),
                   Lpole=(0.9, 0.2, -0.3))
    tap = _pose(st, dict(chest=(2, 4, 0), head=(6, -8, 0)), Rpos=pa, aim=da, Lrel=(-0.36, -0.66, -0.50),
                Lpole=(0.9, 0.2, -0.3))
    listen = _pose(st, dict(chest=(0, 2, 0), head=(2, -10, -14)), Rpos=pa, aim=da, Lrel=(-0.30, -0.70, -0.42),
                   Lpole=(0.9, 0.2, -0.3))
    keys = [(0.0, base, "linear"), (0.12, turn, "sine"), (0.26, turn, "linear"), (0.36, base, "sine"),
            (0.44, tap_up, "inout"), (0.48, tap, "accel"), (0.52, tap_up, "out"), (0.56, tap, "accel"),
            (0.60, tap_up, "out"), (0.72, listen, "sine"), (0.84, listen, "linear"), (0.92, base, "inout"),
            (1.0, base, "linear")]
    fn = anim.keyed(keys)

    def sample(t):
        b = anim.osc(t, 3)
        return anim.add(fn(t), anim.P(chest=(1.0 * b, 0, 0), head=(-0.6 * b, 0, 0)))
    return anim.Clip("idle_lobby", N, True, anim.drag(sample, N, {"head": 2.0, "neck": 1.0}, loop=True))


def _victory(g) -> anim.Clip:
    """victory (55 f, ends in a hold): the blade raised two-handed, struck point-first into the ground ahead of
    her right foot at a long diagonal (f22); she straightens over the planted blade, the left hand moving up
    onto the pommel over the right (both hands on top of the sword), chin up, the mantle turned a quarter.
    (The brief's break-and-reform needs a form swap inside the clip, which the renderer does not do.)"""
    N = 55
    st = anim.merge(anim.stance(dict(MOTION, stance="neutral"), 0.3), anim.arms_relaxed())
    raise_ = _pose(g, dict(hips=(-4, 6, 0), spine=(-6, 4, 0), chest=(-8, 4, 0), head=(-8, 0, 0)), (0.0, 0.02, 0.02),
                   R=(0.35, -0.30, 0.80), Rpole=(-0.9, -0.2, 0.2), aim=(0.0, -0.05, 1.0))
    ps, ds = _plant((-0.16, -0.32, 0.96), (-0.48, -0.95, -0.08))
    strike = _pose(st, dict(hips=(12, -8, 0), spine=(10, -4, 0), chest=(8, -4, 0), head=(-8, 0, 0)), (-0.02, -0.04, -0.10),
                   Rpos=ps, Rpole=(-0.9, 0.2, -0.3), aim=ds, feet=_feet(st, dr=(-0.04, -0.10, 0.0)))
    # the hold: the whole blade grounded ahead of her at a long diagonal, both hands on top of it (the right on
    # the grip, the left over the pommel), chin up, the mantle a quarter turned
    ph, dh = _plant((-0.04, -0.22, 1.10), (-0.26, -1.04, 0.0))      # hands low: the forearms angle down
    hold = _pose(st, dict(hips=(-2, -10, 0), spine=(-3, -4, 0), chest=(-5, -4, 0), neck=(-4, 4, 0), head=(-12, 8, 0)),
                 (0.0, 0.0, 0.0), Rpos=ph, Rpole=(-0.55, 0.2, -0.8), aim=dh, L=-0.12, Lpole=(0.55, 0.2, -0.8),
                 feet=_feet(st, dl=(0.03, 0.0, 0.0), dr=(-0.05, -0.06, 0.0), yr=-14))
    keys = [(0.0, g, "linear"), (0.22, raise_, "inout"), (0.30, anim.lerp_pose(raise_, strike, -0.06), "out"),
            (0.40, strike, "accel"), (0.50, strike, "linear"), (0.72, hold, "inout"), (1.0, hold, "linear")]
    base = anim.drag(anim.keyed(keys), N, {"head": 2.0, "neck": 1.0})

    def sample(t):
        p = base(t)
        if t > 0.72:
            k = min(1.0, (t - 0.72) / 0.12)
            p = anim.add(p, anim.P(chest=(0.8 * k * anim.osc(t, 2), 0, 0)))
        p["_noroll"] = (min(1.0, t / 0.3), 0.0, 0.0)        # the planted blade shows its flat to the splash camera
        return p
    return anim.Clip("victory", N, False, sample)


def _recall(g, ctx) -> anim.Clip:
    """recall (270 f = 9 s, longer than any recall: 5-8 s): from her stance she sets the blade point-down and
    kneels on the right knee behind it, both hands folded over the grip (0.4 s); a slow beat: she bows her
    head onto her hands, holds, lifts her chin and looks out; she rises back to the stance only in the last
    0.5 s (never seen: the recall ends first), which closes the loop the renderer plays. The holds are still
    (a few slow breaths in the head only) so the long clip stays small after the keyframe resample."""
    hip_h = rig._layout(rig.proportions(**PROPORTIONS))["pelvis"].z
    kneel = anim.merge(anim.arms_relaxed(), anim.P(hips=(6, -6, 0), spine=(8, 2, 0), chest=(6, 2, 0), neck=(10, 0, 0),
                                                   head=(14, 0, 0), toe_R=(60, 0, 0)))
    kneel["hips_loc"] = (0.0, 0.10, -hip_h * 0.40)
    kneel["ik"] = anim.feet(l=(0.03, -0.30, 0.0), r=(-0.02, 0.36, 0.06), yl=-6, yr=-8, pr=-62, kr=8)
    pk, dk = _grounded(kneel, hand_z=0.98, tip=(0.03, -0.70, 0.0))
    base = _pose(kneel, Rpos=pk, aim=dk, L=-0.10)
    bow = _pose(kneel, dict(spine=(5, 0, 0), chest=(7, 0, 0), neck=(12, 0, 0), head=(16, 0, 0)), (0.0, 0.0, -0.025),
                Rpos=(pk[0], pk[1] + 0.02, pk[2] - 0.03), aim=dk, L=-0.10)
    look = _pose(kneel, dict(spine=(-3, 0, 0), chest=(-5, -4, 0), neck=(-8, -4, 0), head=(-14, -10, 2)), (0.0, 0.0, 0.015),
                 Rpos=pk, aim=dk, L=-0.10)
    # the way down: the blade swung point-down in front first, then the knee drops
    ps, ds = _grounded(g, hand_z=1.22, tip=(0.03, -0.62, 0.0))
    set_ = _pose(g, dict(hips=(4, 0, 0), spine=(4, 0, 0), head=(6, 0, 0)), (0.0, 0.0, -0.03), Rpos=ps, aim=ds,
                 L=-0.10)
    N = 270
    keys = [(0.0, g, "linear"), (0.022, set_, "inout"), (0.050, base, "inout"), (0.20, base, "linear"),
            (0.26, bow, "inout"), (0.44, bow, "linear"), (0.50, look, "inout"), (0.90, look, "linear"),
            (0.935, set_, "inout"), (0.97, g, "inout"), (1.0, g, "linear")]
    fn = anim.keyed(keys)

    def sample(t):
        p = fn(t)
        if 0.05 < t < 0.93:
            k = min(1.0, (t - 0.05) / 0.02, (0.93 - t) / 0.02)
            b = anim.osc(t, 6)
            p = anim.add(p, anim.P(neck=(0.8 * b * k, 0, 0), head=(-1.2 * b * k, 0, 0)))
        return p
    return anim.Clip("recall", N, True, sample)


def _death(g, skel) -> anim.Clip:
    """death (50 f, ends at rest): hit recoil, the blade slips from her hand and falls flat beside her (prop.R
    leaves the hand: `prop.R_loc` keys), she drops to both knees, sways and topples onto her left side."""
    N = 50
    hip_h = skel.rest_point("hips").z
    fk = anim.arms_relaxed()
    recoil = _pose(g, dict(hips=(-6, 6, 0), spine=(-10, 0, 0), chest=(-14, 4, 0), neck=(-10, 0, 0), head=(-18, 6, 0)),
                   (0.0, 0.05, 0.0), R=(0.20, -0.30, -0.90), aim=(-0.30, -0.35, -0.89), L=None,
                   Lrel=(-0.10, -0.25, -0.90), Lpole=(0.8, 0.4, -0.3))
    sag = anim.merge(anim.P(hips=(10, 4, 0), spine=(10, 0, 0), chest=(8, 0, 0), neck=(10, 0, 0), head=(16, 0, 0)), fk)
    sag["hips_loc"] = (0.0, 0.05, -0.12)
    sag["ik"] = {"foot.L": F((0.0, 0.02, 0.0), 0.0, -6.0), "foot.R": F((0.0, 0.04, 0.0), 0.0, 6.0),
                 "hand.R": HandTarget(rel=(0.05, -0.20, -0.95), pole=(-0.8, 0.4, -0.2))}
    kneel = anim.merge(anim.P(hips=(8, 6, 0), spine=(14, 0, 0), chest=(10, 0, 0), neck=(16, 0, 0), head=(18, 4, 0),
                              upper_arm_R=(8, 0, 14), forearm_R=(20, 0, 0), upper_arm_L=(8, 0, -14), forearm_L=(20, 0, 0)), fk)
    kneel["hips_loc"] = (0.0, 0.16, -hip_h * 0.44)
    kneel["ik"] = anim.feet(l=(0.03, 0.42, 0.07), r=(-0.03, 0.42, 0.07), yl=-4, yr=4, pl=-64, pr=-64)
    sway = anim.add(kneel, anim.P(hips=(4, 0, 8), spine=(4, 0, 6), chest=(6, 0, 4), head=(6, 0, 8)))
    # she topples forward and to her left and ends lying face down, turned a little onto her left side: the
    # coat's tails settle over her legs (lying on her side the coat stood up off the body like a sail), both legs
    # lie along the ground, the helm turned to the side
    prone = anim.P(hips=(84, -6, -14), spine=(4, 0, -4), chest=(3, 0, -2), neck=(-12, 0, 0), head=(-18, 48, 0),
                   thigh_R=(14, 0, -5), shin_R=(-4, 0, 0), foot_R=(48, 0, 0),
                   thigh_L=(16, 0, 6), shin_L=(-10, 0, 0), foot_L=(44, 0, 0),
                   shoulder_R=(0, 0, 4), upper_arm_R=(14, 0, 10), forearm_R=(10, 0, 0), hand_R=(0, 0, 10),
                   shoulder_L=(0, 0, -4), upper_arm_L=(22, 0, -14), forearm_L=(24, 0, 0), hand_L=(0, 0, -10))
    side = dict(prone)
    side["hips_loc"] = (0.10, -0.30, -hip_h + 0.20)
    side["ik"] = {}
    bounce = anim.add(side, anim.P(spine=(-3, 0, 0), chest=(-3, 0, 0), head=(-3, 0, 0), thigh_L=(3, 0, 0)))
    bounce["hips_loc"] = (0.10, -0.30, -hip_h + 0.225)
    rest = anim.add(side, anim.P(head=(2, 0, 0)))
    rest["hips_loc"] = (0.10, -0.30, -hip_h + 0.195)
    for p_ in (kneel, sway):
        p_["ik"] = dict(p_.get("ik", {}))
    keys = [(0.0, g, "linear"), (0.12, recoil, "snap"), (0.28, sag, "inout"), (0.46, kneel, "accel"),
            (0.56, sway, "inout"), (0.72, side, "in"), (0.78, bounce, "out"), (0.86, rest, "inout"), (1.0, rest, "linear")]
    fn = anim.keyed(keys)
    T_DROP, T_LAND = 0.24, 0.40
    # where the sword lands: flat on the ground out to her right (prop.R: +Y the blade, +X = the face normal N ->
    # up, +Z = the width W), clear of where she falls
    rest_axis = V((-0.30, -0.95, 0.0)).normalized()
    rest_x = V((0.0, 0.0, 1.0))
    rest_z = rest_x.cross(rest_axis).normalized()
    rest_pos = V((-0.58, -0.10, 0.028))
    held = {}

    def world_prop(pose):
        res = anim.resolve(skel, pose)
        M = skel.fk(res)
        return res, M

    def prop_frame(M):
        return M["hand.R"] @ skel.local["prop.R"]

    def sample(t):
        p = fn(t)
        if t <= T_DROP:
            return p
        if "rel" not in held:
            r0, M0 = world_prop(fn(T_DROP))
            held["rel"] = prop_frame(M0)
        res, M = world_prop(p)
        W0 = held["rel"]
        # target frame lying on the ground: prop +Y along rest_axis, +X along the blade's width, +Z up
        R1 = Matrix((rest_x, rest_axis, rest_z)).transposed()
        W1 = Matrix.Translation(rest_pos) @ R1.to_4x4()
        u = min(1.0, (t - T_DROP) / (T_LAND - T_DROP))
        u = u * u                                                       # falls, accelerating
        if t > T_LAND:                                                  # a small bounce, then still
            b = max(0.0, 1.0 - (t - T_LAND) / 0.10)
            bounce_h = 0.035 * math.sin(math.pi * min(1.0, (t - T_LAND) / 0.10)) * b
        else:
            bounce_h = 0.0
        q = W0.to_quaternion().slerp(W1.to_quaternion(), u)
        pos = W0.translation.lerp(W1.translation, u) + V((0, 0, bounce_h))
        Wt = Matrix.Translation(pos) @ q.to_matrix().to_4x4()
        Bm = prop_frame(M).inverted() @ Wt
        res["prop.R"] = tuple(math.degrees(a) for a in Bm.to_euler("XYZ"))
        res["prop.R_loc"] = tuple(Bm.translation)
        return res
    return anim.Clip("death", N, False, sample)


_orig_standard_clips = anim.standard_clips


def _standard_clips(skel, profile, overrides=None, optional=("channel", "dash", "stunned")):
    """Ervet channels nothing: no `channel` clip (it would only cost GLB bytes)"""
    if profile is MOTION:
        optional = tuple(o for o in optional if o != "channel")
    return _orig_standard_clips(skel, profile, overrides, optional)


anim.standard_clips = _standard_clips

_orig_solve_aim = anim._solve_aim
BLADE_FACE_UP = 0.8          # how far the wrist rolls the blade's flat toward ROLL_DIR
ROLL_DIR = (0.0, -0.7071, 0.7071)    # up and to the front: wide from the high game camera AND the hero cameras
                                     # (flat up read as a rapier edge-on from the front)


def _solve_aim_roll(skel, pose, M, side, am):
    """after the minimal-rotation aim, roll the right wrist about the blade so its flat turns toward the sky
    (up to 70 deg, BLADE_FACE_UP of the way): from the high game camera the blade reads as a wide pale bar
    lit from above instead of a dark edge-on stick. Near-vertical blades (planted, overhead) keep their roll."""
    _orig_solve_aim(skel, pose, M, side, am)
    off = pose.get("_noroll", (0.0, 0.0, 0.0))[0]                # a clip can keep its authored roll
    if side != "R" or "prop.R" not in skel.rest or off >= 0.999:
        return
    M2 = skel.fk(pose)
    Rp = M2["prop.R"].to_3x3()
    y, x = Rp.col[1].normalized(), Rp.col[0].normalized()        # blade axis, face normal N
    up = Vector(ROLL_DIR)
    upp = up - y * up.dot(y)
    if upp.length < 0.35:
        return
    upp.normalize()
    tgt = upp if x.dot(upp) >= 0 else -upp
    ang = math.atan2(x.cross(tgt).dot(y), x.dot(tgt))
    ang = max(-1.22, min(1.22, ang)) * BLADE_FACE_UP * (1.0 - off)
    from mathutils import Quaternion
    q = Quaternion(y, ang)
    hand = "hand.R"
    new = q.to_matrix() @ M2[hand].to_3x3()
    Ph = (M2[skel.parent[hand]] @ skel.local[hand]).to_3x3()
    pose[hand] = skel.euler_of(Ph.inverted() @ new, pose.get(hand))


anim._solve_aim = _solve_aim_roll

_orig_write_action = anim.write_action


def _write_action(arm, name, poses, bones=None):
    """+ prop.R location keys when the poses carry `prop.R_loc` (death drops the sword)"""
    act = _orig_write_action(arm, name, poses, bones)
    key = "prop.R_loc"
    if not any(key in p for p in poses):
        return act
    strip = act.layers[0].strips[0]
    cb = strip.channelbag(act.slots[0], ensure=True)
    n = len(poses)
    for i in range(3):
        fc = anim._new_fcurve(cb, 'pose.bones["prop.R"].location', i, "prop.R")
        vals = [p.get(key, (0.0, 0.0, 0.0))[i] for p in poses]
        fc.keyframe_points.add(n)
        fc.keyframe_points.foreach_set("co", [c for f, v in zip(range(n), vals) for c in (f, v)])
        fc.keyframe_points.foreach_set("interpolation", [1] * n)
        fc.update()
    return act


anim.write_action = _write_action


# ── skins: re-colour of the projected painting per part (palettes: the brief section 9) ─────────────
SKINS: list = [
    {"id": "ervet_stillwater", "extra": {}, "card": {"primary": "#4D5A5C", "secondary": "#8FB3A8"},
     "palette": {"dawnglass": "#8FB3A8", "chalk": "#CDD2CE", "stone": "#B5BFBE", "cloth": "#4D5A5C",
                 "cloth2": "#B4C3BC", "ironstone": "#3A4446", "under": "#2F3739"}},
    {"id": "ervet_lamplit", "extra": {"lamp_cage": True}, "card": {"primary": "#4A4036", "secondary": "#A38C6B"},
     "palette": {"dawnglass": "#A38C6B", "chalk": "#DBD2C2", "stone": "#C9BCA7", "cloth": "#806A55",
                 "cloth2": "#D8CCB4", "leather": "#5E4D3E", "ironstone": "#3F3730", "under": "#3A332D",
                 "wood": "#4A3727", "lampresin": "#DCA65E"}},
]
SKIN_FLAT = {"lamp_cage": "wood", "lamp_bead": "lampresin"}

# the procedural paint per build: the base look follows the concept's values; the skins step from the brief's
# section 9 palettes (identity hexes at their own band, the top kept light, the feet dark)
LOOK = {
    None: dict(glass="#CBE2F1", glass_deep="#8FB4D2", glass_edge="#F2F9FE",
               chalk="#C6C5BD", chalk_hi="#E4E3DC", chalk_lo="#83827B", chalk_pj="#D4D2C8",
               plate="#A6A49B", plate_hi="#CECCC3", plate_lo="#5A5953",
               stone="#949B9F", stone_hi="#BAC0C2", stone_lo="#5A6166",
               trim="#8C7A5C", ink="#17181B",
               lame="#66757E", lame_hi="#A3B2BB", lame_lo="#2F383E",
               coat="#4A535A", coat_hi="#6B7780", coat_lo="#262C31", lining="#4C3E31", lining_lo="#2B231C",
               wrap="#302B29", wrap_hi="#5A514B", wrap_lo="#161413",
               glove="#3D2E25", glove_hi="#6E5845", boot="#2A2823", boot_hi="#46433C", sole="#121110",
               vamb="#526C82", vamb_hi="#8AA2B6", vamb_lo="#283746",
               scarf="#CEC5AF", scarf_lo="#6A6B6A", grip="#2F2A28", grip_hi="#5A4E44", under="#34373C"),
    # Stillwater: river-glass, sea-grey linen, the arm plates and caps in a green wet-stone a step under the helm
    "ervet_stillwater": dict(glass="#A9CDC2", glass_deep="#5F8D80", glass_edge="#E4F3EE",
                             chalk="#C3CEC9", chalk_hi="#E6EEEA", chalk_lo="#7E8984",
                             plate="#8E9E9A", plate_hi="#B9C8C4", plate_lo="#4B5755",
                             stone="#90A3A0", stone_hi="#B9CAC7", stone_lo="#56686A",
                             trim="#7F908A", ink="#141A1A",
                             lame="#4F5E60", lame_hi="#8EA2A3", lame_lo="#222B2C",
                             coat="#3A4547", coat_hi="#5A6A6C", coat_lo="#1D2425", lining="#2E3B39", lining_lo="#19211F",
                             wrap="#262C2C", wrap_hi="#4E5958", wrap_lo="#121616",
                             glove="#2C3433", glove_hi="#5A6766", boot="#222928", boot_hi="#3E4847", sole="#101414",
                             vamb="#4D5A5C", vamb_hi="#8A9C9E", vamb_lo="#253031",
                             scarf="#A6B9B1", scarf_lo="#56655F", grip="#2A2F2F", grip_hi="#56605F", under="#2C3537"),
    # Lamplit: smoked lampresin, ivory, walnut: the arm plates and caps a warm light walnut, the coat warm walnut
    "ervet_lamplit": dict(glass="#BDA27C", glass_deep="#786349", glass_edge="#F0E2C8",
                          chalk="#DACDB6", chalk_hi="#F3EADA", chalk_lo="#968A75",
                          plate="#BCA585", plate_hi="#DCC9AC", plate_lo="#6E5D47",
                          stone="#C3AE8E", stone_hi="#E2D1B5", stone_lo="#7E6C55",
                          trim="#A08A66", ink="#1A1510",
                          lame="#86705A", lame_hi="#B8A086", lame_lo="#45372A",
                          coat="#6A5341", coat_hi="#8F725A", coat_lo="#352A21", lining="#3E3128", lining_lo="#241C16",
                          wrap="#3E3128", wrap_hi="#6E5847", wrap_lo="#1D1510",
                          glove="#483A2E", glove_hi="#7C624B", boot="#3D3026", boot_hi="#6E5642", sole="#1D1510",
                          vamb="#86705A", vamb_hi="#B8A086", vamb_lo="#45372A",
                          scarf="#D4C4A6", scarf_lo="#7A6C56", grip="#3E3128", grip_hi="#6E5847", under="#3A3029"),
}
PROCEDURAL = ("blade", "blade_hilt", "blade_great", "guard", "pommel", "grip", "lames_R", "lames_L",
              "arms", "rerebrace_R", "rerebrace_L", "vambrace_R", "vambrace_L", "hand_R", "hand_L", "boots", "coat",
              "scarf", "helm", "crest", "pauldron_R", "pauldron_L")


# ── pipeline additions (wrapped here; art/blender/common is shared) ───────────────────────────────
SWORD_PARTS = ("grip", "guard", "pommel", "inlays", "blade", "blade_hilt", "blade_great", "lamp_cage", "lamp_bead")
HIDE_FORMS = ("form_hilt", "form_great")


def _sub_object(obj, keep: set, name: str):
    """a temporary copy of `obj` holding only the faces of the parts in `keep` (vale_part ids)"""
    import bmesh
    me = obj.data.copy()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    pv = np.empty(len(me.vertices), dtype=np.int64)
    me.attributes["vale_part"].data.foreach_get("value", pv)
    bm = bmesh.new()
    bm.from_mesh(me)
    dead = [f for f in bm.faces if int(pv[f.verts[0].index]) not in keep]
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    bm.to_mesh(me)
    bm.free()
    me.update()
    return ob


def _blade_hw(t, L, shape):
    w0, w1, th, tip = shape
    u = np.clip(t / L, 0.0, 1.0)
    hw = 0.5 * (w0 + (w1 - w0) * u)
    return hw * np.sqrt(np.clip((L - t) / tip, 0.0, 1.0)) + 0.002


SIDE_PAINTED = {"legs": 0.02}     # parts whose sideways faces take paint from inside their silhouette


def _coat_sides(img, maps, names, plates):
    """Sideways faces (normals toward +-X) are the painting's silhouette edge in both views: sampled there they
    take the outline and its padding, streaked along Y. They take the part's own paint from a few cm inside the
    silhouette instead, softened, front plate blended into back plate by the normal."""
    soft = {sd: project.blur(plates.img[sd], 7.0) for sd in ("front", "back")}
    for name, inset in SIDE_PAINTED.items():
        if name not in names:
            continue
        m = maps["part"] == names.index(name)
        if not m.any():
            continue
        P, N = maps["P"][m], maps["N"][m]
        st = np.abs(N[:, 0]) / (np.abs(N[:, 0]) + np.abs(N[:, 1]) + 1e-6)
        ws = _smooth(0.42, 0.85, st)[:, None]
        xin = P[:, 0] - np.sign(P[:, 0]) * inset
        cols = {}
        for sd in ("front", "back"):
            px, py = plates.to_px(sd, xin, P[:, 2])
            cols[sd] = project.bilinear(soft[sd], px, py)
        wb = _smooth(-0.25, 0.25, N[:, 1])[:, None]
        c = cols["front"] * (1 - wb) + cols["back"] * wb
        img[m] = img[m] * (1 - ws) + c * ws


# ── procedural paint ──────────────────────────────────────────────────────────────────────────────
def _hx(h) -> np.ndarray:
    return np.array(scene.hex_srgb(h), dtype=np.float32)


def _ramp(t, lo, mid, hi):
    """value ramp lo (t 0) -> mid (0.5) -> hi (1); t (n,), colours (3,) -> (n, 3)"""
    t = np.clip(t, 0.0, 1.0)[:, None]
    a = lo + (mid - lo) * np.clip(t / 0.5, 0, 1)
    b = mid + (hi - mid) * np.clip((t - 0.5) / 0.5, 0, 1)
    return np.where(t < 0.5, a, b).astype(np.float32)


def _mixc(c, col, w):
    w = np.clip(w, 0.0, 1.0)[:, None]
    return (c * (1 - w) + np.asarray(col, np.float32) * w).astype(np.float32)


def _lum(c):
    return c @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def _paint_noise(P, seed=0.0):
    """painterly breakup: broad value blotches + short brush streaks (roughly -1..1)"""
    n1 = NOISE(P, 7.0, offset=(seed, 0.0, 0.0))
    n2 = NOISE(P * np.array([1.0, 1.0, 3.2]), 24.0, offset=(0.0, seed, 3.0))
    return 0.7 * n1 + 0.3 * n2


_DETAIL: dict = {}


def _clean_face_plate(img: np.ndarray, plates) -> np.ndarray:
    """the concept's glowing slit, star and cheek lines painted out of the front plate's head (the geometry's
    glass sits in grooves there): the blue glow and a 3 px halo filled from the nearest chalk, softened, so the
    face keeps the concept's carved bevels, brow and cracks without a second slit"""
    out = img.copy()
    px0, py0 = plates.to_px("front", -0.135, 2.17)
    px1, py1 = plates.to_px("front", 0.175, 1.815)
    x0, x1, y0, y1 = int(px0), int(px1) + 1, int(py0), int(py1) + 1
    sub = out[y0:y1, x0:x1]
    r, g, b = sub[..., 0], sub[..., 1], sub[..., 2]
    m = (b - r > 0.17) & (b > g + 0.03)
    for _ in range(5):                                  # the glow + the slit's ink border
        m = m | np.roll(m, 1, 0) | np.roll(m, -1, 0) | np.roll(m, 1, 1) | np.roll(m, -1, 1)
    lum = sub @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    iy, ix = project.nearest_index(~m & (lum > 0.62))  # filled from the face's chalk, not its dark lines
    fill = project.blur(sub[iy, ix], 3.0)
    out[y0:y1, x0:x1] = np.where(m[..., None], fill, sub)
    return out


def _make_detail(img: np.ndarray, plates) -> None:
    """the painting's brush texture: the high-pass of a clean chalk patch of the concept's breastplate, mirror-
    tiled over the procedural surfaces (their value breaks up in the concept's strokes, not in value noise)"""
    px0, py0 = plates.to_px("front", -0.143, 1.635)
    px1, py1 = plates.to_px("front", -0.004, 1.571)
    patch = img[int(py0):int(py1), int(px0):int(px1)]
    lum = patch @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    hp = lum - project.blur(lum, 4.0)
    hp = hp / (float(hp.std()) + 1e-6)
    _DETAIL["hp"] = np.clip(hp, -3.0, 3.0).astype(np.float32)[..., None]
    _DETAIL["mpp"] = 1.0 / plates.ppm("front")


def _detail(P, Nn, scale=1.0) -> np.ndarray:
    """triplanar sample of the brush texture (about -1..1)"""
    hp = _DETAIL.get("hp")
    if hp is None:
        return np.zeros(len(P))
    h, w = hp.shape[:2]
    mpp = _DETAIL["mpp"] * scale
    a = np.abs(Nn) ** 4
    a = a / (a.sum(1, keepdims=True) + 1e-9)
    out = np.zeros(len(P))
    for k, (i, j) in enumerate(((1, 2), (0, 2), (0, 1))):
        u = P[:, i] / mpp + 17.0 * k
        v = P[:, j] / mpp + 29.0 * k
        cu, cv = np.floor(u / w), np.floor(v / h)                      # each tile its own random offset: no
        hsh = np.sin(cu * 12.9898 + cv * 78.233 + k * 3.1) * 43758.5453  # lattice from a repeated patch
        hsh = hsh - np.floor(hsh)
        u = (u + hsh * w * 7.0) % w
        v = (v + hsh * h * 13.0) % h
        u = np.clip(u, 0.5, w - 1.0)
        v = np.clip(v, 0.5, h - 1.0)
        out += a[:, k] * project.bilinear(hp, u, v)[:, 0]
    return np.clip(out * 0.45, -1.2, 1.2)


def _curvature(maps) -> np.ndarray:
    """per-texel surface curvature (1/m, + convex) from the normal change between neighbouring texels of the same
    part, scaled to -1..1 (a ~2 cm bevel ~ 1)"""
    P, N, part = maps["P"], maps["N"], maps["part"]
    k = np.zeros(part.shape, np.float32)
    cnt = np.zeros(part.shape, np.float32)
    for axis in (0, 1):
        for sh in (-1, 1):
            Pa = np.roll(P, sh, axis)
            Na = np.roll(N, sh, axis)
            pa = np.roll(part, sh, axis)
            dP = Pa - P
            d2 = (dP * dP).sum(-1)
            ok = (part >= 0) & (pa == part) & (d2 > 1e-12) & (d2 < 4e-4)
            kk = np.where(ok, (( Na - N) * dP).sum(-1) / np.maximum(d2, 1e-12), 0.0)
            k += kk.astype(np.float32)
            cnt += ok
    k = k / np.maximum(cnt, 1.0)
    return np.clip(k / 45.0, -1.0, 1.0)


def _paint_glass(P, Nn, L, shape, bevel, look, broken=False):
    """dawnglass painted as clear glass (the concept's): a pale body that deepens toward its middle and toward
    the guard, a fuller (a deep line with a bright lip), the bevel's inner edge a deep line (the glass's
    thickness), the bevel a bright band, a white edge, two broad soft reflection bands across the blade; clean
    (no speckle: a grain read as frosted steel)"""
    G0, D, W, N_ = _SWORD["G0"], _SWORD["D"], _SWORD["W"], _SWORD["N"]
    q = P - G0
    t, s = q @ D, q @ W
    hw = _blade_hw(t, L, shape)
    u = np.clip(np.abs(s) / np.maximum(hw, 1e-4), 0.0, 1.0)
    body, deep, edge = _hx(look["glass"]), _hx(look["glass_deep"]), _hx(look["glass_edge"])
    tl = np.clip(t / L, 0.0, 1.0)
    core = deep * 0.55 + body * 0.45
    c = _mixc(np.repeat(core[None], len(P), 0), body, _smooth(0.05, 0.60, u) * 0.85 + 0.15 * tl)
    u0 = np.clip(1.0 - 0.95 * bevel / np.maximum(hw, 1e-3), 0.45, 0.9)               # the bevel's inner edge
    c = _mixc(c, deep * 0.85, 0.55 * np.exp(-((u - u0 + 0.02) / 0.035) ** 2))
    c = _mixc(c, edge, 0.85 * _smooth(u0, u0 + 0.06, u))
    c = _mixc(c, np.array([1.0, 1.0, 1.0], np.float32), 0.6 * _smooth(0.94, 1.0, u))
    fl = _smooth(0.02, 0.07, t) * (1.0 - _smooth(0.62 * L, 0.72 * L, t))              # the fuller
    c = _mixc(c, deep * 0.9, 0.70 * fl * (1.0 - _smooth(0.045, 0.10, u)))
    c = _mixc(c, edge, 0.65 * fl * np.exp(-((u - 0.13) / 0.03) ** 2))
    # broad reflection bands across the blade (a painter's glass: light slides across it diagonally)
    rb = (t * 1.6 + s * 3.0) / max(L, 0.3)
    band = np.exp(-(((rb % 1.0) - 0.35) / 0.06) ** 2) + 0.5 * np.exp(-(((rb % 1.0) - 0.52) / 0.025) ** 2)
    c = _mixc(c, edge, 0.38 * band * (1.0 - _smooth(0.75, 0.95, u)))
    c = _mixc(c, edge, 0.30 * _smooth(0.55 * L, L, t))                                  # paler toward the point
    c = _mixc(c, deep * 0.75, 0.30 * (1.0 - _smooth(0.0, 0.06, t)))                      # the guard's shadow
    if broken:
        c = _mixc(c, edge, 0.6 * _smooth(STUB_L - 0.08, STUB_L + 0.02, t))              # fresh fracture
    return c


def _paint_procedural(img, maps, names, look, log=print):
    """paint the PROCEDURAL parts in `look` (sRGB colours) over the projected atlas"""
    P3, N3, part = maps["P"], maps["N"], maps["part"]
    curv3 = _curvature(maps)
    idx = {n: i for i, n in enumerate(names)}
    L = {k: _hx(v) for k, v in look.items()}

    def each(name):
        if name not in idx:
            return None
        m = part == idx[name]
        if not m.any():
            return None
        return m, P3[m].astype(np.float64), N3[m].astype(np.float64), curv3[m]

    def shade(P, Nn, kv, base, hi, lo, k_top=0.26, k_noise=0.13, k_edge=0.22, seed=0.0, extra=0.0):
        t = 0.5 + k_top * Nn[:, 2] + k_noise * _paint_noise(P, seed) + k_edge * kv + extra
        return _ramp(t, lo, base, hi)

    # dawnglass blades
    for name, Lb, shape, broken in (("blade", BLADE_L, BLADE_SHAPE, False), ("blade_hilt", STUB_L + 0.06, STUB_SHAPE, True),
                                    ("blade_great", GREAT_L, GREAT_SHAPE, False)):
        e = each(name)
        if e:
            m, P, Nn, kv = e
            img[m] = _paint_glass(P, Nn, Lb, shape, BEVEL[name], look, broken)
    # crossguard + pommel: chalk, carved border, ink pockets round the inlays
    G, D, W, N_ = _SWORD["G"], _SWORD["D"], _SWORD["W"], _SWORD["N"]
    for name in ("guard", "pommel"):
        e = each(name)
        if not e:
            continue
        m, P, Nn, kv = e
        c = shade(P, Nn, kv, L["chalk"], L["chalk_hi"], L["chalk_lo"], k_edge=0.40, seed=4.0,
                  extra=0.10 * _detail(P, Nn, 0.6))
        q = P - G
        uu, vv, nn = q @ W, q @ D, q @ N_
        face = np.abs(nn) > GUARD_H - 0.004
        if name == "guard":
            sd = poly_sd(np.stack([uu, vv], 1), np.array(GUARD_POLY))
            c = _mixc(c, L["chalk_lo"], 0.55 * face * np.exp(-((sd + 0.013) / 0.0028) ** 2))
            c = _mixc(c, L["chalk_hi"], 0.35 * face * np.exp(-((sd + 0.018) / 0.0025) ** 2))
            for u0, v0, a in GUARD_INLAYS:                              # the carved settings: a shadowed lip
                ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
                du, dv = uu - u0, vv - v0
                lx, ly = du * ca + dv * sa, -du * sa + dv * ca
                ring = np.abs(lx) / (LOZENGE[0][0] * 1.18) + np.abs(ly) / (LOZENGE[1][1] * 1.25)
                c = _mixc(c, L["chalk_lo"] * 0.55, 0.75 * (ring < 1.05) * (np.abs(nn) < GUARD_H + 0.002))
                c = _mixc(c, L["chalk_hi"], 0.5 * np.exp(-((ring - 1.18) / 0.06) ** 2) * face)
            dd = (np.abs(uu - CENTRE_DIAMOND[0]) + np.abs(vv - CENTRE_DIAMOND[1])) / (CENTRE_DIAMOND[2] * 1.414)
            c = _mixc(c, L["chalk_hi"], 0.45 * np.exp(-((dd - 1.25) / 0.10) ** 2))       # the boss's lit rim
        img[m] = c
    e = each("grip")
    if e:
        m, P, Nn, kv = e
        q = P - G
        tt = -(q @ D)
        ang = np.arctan2(q @ N_, q @ W)
        band = 0.5 + 0.5 * np.sin(tt * 140.0 + ang * 1.0)
        c = _ramp(0.25 + 0.55 * band + 0.08 * _paint_noise(P, 9.0), L["wrap_lo"], L["grip"], L["grip_hi"])
        img[m] = c
    # mantle lames: rows of separate blued plates, a pale lower rim, dark seams, a darker top under the row above
    for s, sx in (("R", -1), ("L", 1)):
        e = each(f"lames_{s}")
        if not e:
            continue
        m, P, Nn, kv = e
        Ax, Ay = sx * 0.165, 0.015
        dx, dy = P[:, 0] - Ax, P[:, 1] - Ay
        r = np.hypot(dx, dy)
        phi = np.degrees(np.arctan2(sx * dx, -dy))
        dzp = lame_dz(phi)
        z = P[:, 2] - dzp
        best = np.full(len(P), 1e9)
        row = np.zeros(len(P), int)
        for i in range(LAME_ROWS):
            zc, R, hz = lame_row(i)
            rr = R + (zc - z) * LAME_FLARE
            cost = np.abs(r - rr) + 4.0 * np.maximum(0.0, np.abs(z - zc) - hz - 0.02)
            better = cost < best
            best = np.where(better, cost, best)
            row = np.where(better, i, row)
        zc = np.array([lame_row(i)[0] for i in range(LAME_ROWS)])[row]
        hz = np.array([lame_row(i)[2] for i in range(LAME_ROWS)])[row]
        v = np.clip((z - (zc - hz)) / (2 * hz), 0.0, 1.0)
        w = np.zeros(len(P))
        k = np.zeros(len(P))
        for i in range(LAME_ROWS):
            sel = row == i
            if sel.any():
                kk, ww = _plate_frac(phi[sel], lame_seams(i, sx))
                k[sel], w[sel] = kk, ww
        h = _plate_hash(row, k, sx)
        # painted plates: each its own value, darker where it tucks under the row above, a lit lower rim and
        # bevels, soft (not inked) seams, chips and scratches catching the light
        t = 0.45 + 0.20 * (h - 0.5) + 0.10 * _paint_noise(P, 2.0) + 0.18 * kv + 0.10 * Nn[:, 2]
        t = t - 0.22 * _smooth(0.55, 0.98, v)
        t = t + 0.20 * np.exp(-((v - 0.08) / 0.04) ** 2)
        t = t + 0.08 * (1.0 - _smooth(0.0, 0.16, w)) - 0.06 * _smooth(0.84, 1.0, w)
        c = _ramp(t, L["lame_lo"], L["lame"], L["lame_hi"])
        sd = np.minimum(w, 1.0 - w)
        c = _mixc(c, L["lame_lo"], 0.45 * (1.0 - _smooth(0.012, 0.045, sd)))
        c = _mixc(c, L["lame_lo"] * 0.8, 0.55 * (1.0 - _smooth(0.0, 0.05, v)))
        sc = _smooth(0.62, 0.75, NOISE.ridged(P, 30.0, 2)) * _smooth(0.02, 0.06, sd)
        c = _mixc(c, L["lame_hi"], 0.22 * sc)
        img[m] = c
    # pauldron tops: carved stone with a trim bead at the rim and a carved groove ring
    for s, sx in (("R", -1), ("L", 1)):
        e = each(f"pauldron_{s}")
        if not e:
            continue
        m, P, Nn, kv = e
        outline = [(sx * x, y) for x, y in PAULDRON_OUTLINE]
        if sx < 0:
            outline = outline[::-1]
        cen = np.array([sx * _PC[0], _PC[1]])
        xy = P[:, :2]
        sd = poly_sd(xy, np.array(outline))
        rc = np.hypot(*(xy - cen).T)
        mid = cap_mid(sx)(P[:, 0], P[:, 1])
        upper = P[:, 2] > mid                                           # the top face (the underside stays dark)
        t = 0.54 + 0.16 * Nn[:, 2] + 0.10 * _paint_noise(P, 5.0) + 0.30 * kv - 0.18 * rc
        t = t - 0.25 * (~upper)
        c = _ramp(t, L["stone_lo"], L["stone"], L["stone_hi"])
        # the trim: a bead round the rim and the plate's edge band, painted ochre (the concept's gold, matte)
        rim = _smooth(-0.026, -0.016, sd)
        trim = _ramp(0.5 + 0.25 * kv + 0.2 * Nn[:, 2] + 0.06 * _paint_noise(P, 6.0), L["trim"] * 0.55, L["trim"],
                     np.minimum(L["trim"] * 1.25, 1.0))
        c = _mixc(c, trim, rim)
        c = _mixc(c, L["trim"] * 0.45, 0.6 * np.exp(-((sd + 0.027) / 0.003) ** 2))   # the bead's inner shadow
        gr = poly_sd(xy, np.array(scaled_outline(outline, 0.72, cen)))
        c = _mixc(c, L["stone_lo"] * 0.7, 0.70 * np.exp(-(gr / 0.007) ** 2) * upper)
        c = _mixc(c, L["stone_hi"], 0.40 * np.exp(-((gr + 0.012) / 0.004) ** 2) * upper)
        c = _mixc(c, L["stone_hi"], 0.30 * _smooth(0.62, 0.75, NOISE.ridged(P, 26.0, 2)))
        if sx < 0:                                                      # the clasp: a carved stone boss, ochre ring
            dq = np.hypot(P[:, 0] + 0.150, P[:, 2] - 1.752)
            near = (P[:, 1] < -0.152) & (dq < 0.036)
            boss = _ramp(0.55 + 0.30 * Nn[:, 2] - 0.25 * Nn[:, 0] + 0.35 * kv + 0.08 * _detail(P, Nn),
                         L["stone_lo"], L["stone"], L["stone_hi"])
            boss = _mixc(boss, L["stone_lo"] * 0.75, 0.6 * np.exp(-((dq - 0.013) / 0.0022) ** 2))
            boss = np.where((dq > 0.022)[:, None], trim, boss)
            c = np.where(near[:, None], boss, c)
        back = _smooth(0.15, 0.55, Nn[:, 1]) * _smooth(0.10, 0.20, P[:, 1]) * (1.0 - rim)
        cur = img[m]
        if _LOOK_ID[0] is not None:                                     # the skin's stone at the painted value
            g = _lum(cur) / max(float(_lum(_hx(LOOK[None]["stone"]))), 1e-3)
            cur = np.clip(g[:, None] * L["stone"][None], 0, 1).astype(np.float32)
        img[m] = (c * (1 - back[:, None]) + cur * back[:, None]).astype(np.float32)   # the back keeps the concept
    # arms: a dark under-suit, the forearms wound in dark bandage wraps
    e = each("arms")
    if e:
        m, P, Nn, kv = e
        c = _ramp(0.5 + 0.18 * Nn[:, 2] + 0.12 * _paint_noise(P, 1.0), L["wrap_lo"], L["under"], L["wrap_hi"])
        for s, sx in (("R", -1), ("L", 1)):
            side = np.sign(P[:, 0]) == sx
            el, wr = _J["elbow." + s], _J["wrist." + s]
            ax = (wr - el) / np.linalg.norm(wr - el)
            Lf = float(np.linalg.norm(wr - el))
            q = P - el
            ta = q @ ax
            rad = q - np.outer(ta, ax)
            ref = np.cross(ax, (0, 1.0, 0))
            ref /= np.linalg.norm(ref)
            ang = np.arctan2(rad @ np.cross(ax, ref), rad @ ref)
            fore = side & (ta > -0.03)
            ph = ta * 38.0 + ang / (2 * math.pi) * 1.0
            vb = np.mod(ph, 1.0)
            wt = 0.32 + 0.45 * _smooth(0.10, 0.75, vb) - 0.35 * (vb < 0.10) + 0.08 * _paint_noise(P, 3.0) + 0.15 * Nn[:, 2]
            wc = _ramp(wt, L["wrap_lo"], L["wrap"], L["wrap_hi"])
            c = np.where(fore[:, None], wc, c)
        img[m] = c
    # arm plates: carved chalk shells a step darker than the breastplate (the chest keeps the lightest value):
    # each lame lit from above, a dark ink line round its outline, a pale bevel just inside it, a carved line
    # parallel to its lower edge; the cut face toward the arm in shadow; the couter a disc with a ring and a boss
    for s, sx in (("R", -1), ("L", 1)):
        sh, el, wr = _J["shoulder." + s], _J["elbow." + s], _J["wrist." + s]
        for nm in (f"rerebrace_{s}", f"vambrace_{s}"):
            e = each(nm)
            if not e:
                continue
            m, P, Nn, kv = e
            upper = nm.startswith("rere")
            A0, A1 = (sh, el) if upper else (el, wr)
            ax = (A1 - A0) / np.linalg.norm(A1 - A0)
            Lx = float(np.linalg.norm(A1 - A0))
            od = np.array([sx, 0.0, 0.0]) - ax * (sx * ax[0])
            od /= np.linalg.norm(od)
            q = P - A0
            ta = q @ ax
            rad = q - np.outer(ta, ax)
            rr = np.linalg.norm(rad, axis=1) + 1e-9
            radn = rad / rr[:, None]
            face = (Nn * radn).sum(1)                                   # 1 outer surface, 0 the cut face
            across = np.clip((rad @ od) / rr, -1.0, 1.0)
            ed = np.arcsin(np.clip(across, 0.0, 1.0)) * rr              # round the shell from its cut edge (m)
            if upper:
                ends = [Lx * f1 for _, f1, _, _ in ARM_LAMES]
                frac = np.zeros(len(P))
                for f0, f1, _, _ in ARM_LAMES[::-1]:
                    sel = ta < Lx * f1 + 0.004
                    frac = np.where(sel, np.clip((ta - Lx * f0) / (Lx * (f1 - f0)), 0, 1), frac)
            else:
                ends = [0.03, Lx - 0.03]
                frac = np.clip((ta - 0.03) / (Lx - 0.06), 0, 1)
            for t_end in ends:
                ed = np.minimum(ed, np.abs(ta - t_end) + 0.002)
            dt = _detail(P, Nn)
            t = (0.56 + 0.20 * Nn[:, 2] + 0.10 * dt + 0.30 * kv - 0.16 * frac + 0.06 * _paint_noise(P, 8.0))
            c = _ramp(t, L["plate_lo"], L["plate"], L["plate_hi"])
            c = _mixc(c, L["plate_lo"] * 0.55, 0.85 * _smooth(0.35, -0.2, face))          # the cut face, inside
            c = _mixc(c, L["plate_hi"], 0.45 * np.exp(-((ed - 0.009) / 0.0035) ** 2) * (face > 0.3))   # bevel
            c = _mixc(c, L["plate_lo"] * 0.7, 0.55 * np.exp(-((ed - 0.021) / 0.0017) ** 2) * (face > 0.3))  # carved
            c = _mixc(c, L["ink"], 0.92 * (1.0 - _smooth(0.0028, 0.0070, ed)) * (face > 0.2))  # the ink outline
            if upper:                                                   # the couter
                cf = sdf.frame(od, ax)
                lc = (P - (el + od * 0.050 + ax * 0.004)) @ cf.T
                ee = np.sqrt((lc[:, 0] / 0.052) ** 2 + (lc[:, 1] / 0.045) ** 2)
                cop = (ee < 1.08) & (lc[:, 2] > -0.004)
                tc = 0.58 + 0.24 * Nn[:, 2] + 0.10 * dt + 0.35 * kv - 0.12 * ee
                cc = _ramp(tc, L["plate_lo"], L["plate"], L["plate_hi"])
                cc = _mixc(cc, L["plate_lo"] * 0.7, 0.6 * np.exp(-((ee - 0.62) / 0.05) ** 2))         # the ring
                cc = _mixc(cc, L["ink"], 0.75 * _smooth(0.90, 1.0, ee))
                c = np.where(cop[:, None], cc, c)
            sc = _smooth(0.66, 0.78, NOISE.ridged(P, 30.0, 2))
            c = _mixc(c, L["plate_hi"], 0.25 * sc * (face > 0.3))                          # chips catching light
            img[m] = c
        # the gloved fist: dark leather, the knuckles and finger tops catching the light, dark creases between the
        # fingers and under each joint, a lighter cuff edge
        e = each(f"hand_{s}")
        if e:
            m, P, Nn, kv = e
            sw = _SWORD
            Cf, Df = (sw["C"], sw["D"]) if s == "R" else (mirror_x(sw["C"]), mirror_x(sw["D"]))
            off = (P - Cf) @ Df
            rad = (P - Cf) - np.outer(off, Df)
            rr = np.linalg.norm(rad, axis=1)
            dt = _detail(P, Nn)
            c = shade(P, Nn, kv, L["glove"], L["glove_hi"], L["wrap_lo"], k_top=0.24, k_noise=0.05, k_edge=0.45,
                      seed=5.0, extra=0.08 * dt)
            fing = rr < 0.050
            gap = np.zeros(len(P))
            for b in (0.0235, 0.0, -0.0230):
                gap = np.maximum(gap, np.exp(-((off - b) / 0.0022) ** 2))
            c = _mixc(c, L["wrap_lo"] * 0.6, 0.85 * gap * fing)
            c = _mixc(c, L["wrap_lo"] * 0.6, 0.5 * _smooth(-0.2, -0.6, kv))
            wrd = _J["wrist." + s]
            cuff = np.abs((P - wrd) @ ((wrd - _J["elbow." + s]) / np.linalg.norm(wrd - _J["elbow." + s])) + 0.004) < 0.006
            c = _mixc(c, L["glove_hi"], 0.5 * cuff)
            img[m] = c
    e = each("boots")
    if e:
        m, P, Nn, kv = e
        c = shade(P, Nn, kv, L["boot"], L["boot_hi"], L["sole"], k_top=0.24, k_edge=0.45, seed=10.0,
                  extra=0.08 * _detail(P, Nn))
        c = _mixc(c, L["sole"], _smooth(0.028, 0.018, P[:, 2]))                        # the sole
        c = _mixc(c, L["boot_hi"] * 1.15, 0.40 * _smooth(0.196, 0.204, P[:, 2]) * _smooth(0.232, 0.224, P[:, 2]))
        c = _mixc(c, L["wrap_lo"], 0.55 * _smooth(-0.15, -0.5, kv))                    # creases
        for cen, fw in _BOOTS:                                                          # the instep strap
            d = np.abs((P - cen) @ fw)
            near = (np.hypot(P[:, 0] - cen[0], P[:, 1] - cen[1]) < 0.09) & (P[:, 2] > 0.03)
            c = _mixc(c, L["glove_hi"], 0.45 * near * (1.0 - _smooth(0.006, 0.010, d)))
            c = _mixc(c, L["sole"], 0.5 * near * np.exp(-((d - 0.011) / 0.002) ** 2))
        img[m] = c
    # coat: blue-grey cloth outside, brown lining inside, trims along the hem and the front edges; the folds lit
    e = each("coat")
    if e:
        m, P, Nn, kv = e
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        xs = x - coat_lerp(COAT["x0"], z)
        y0 = coat_lerp(COAT["y0"], z)
        ang = np.arctan2(xs, y - y0)
        fw = coat_fold_wave(P, ang)
        fade = np.clip((1.35 - z) / 0.8, 0.15, 1.0)
        radial = np.stack([xs, y - y0, np.zeros_like(xs)], 1)
        radial /= np.linalg.norm(radial, axis=1, keepdims=True) + 1e-9
        inner = (Nn * radial).sum(1) < 0.0
        t = 0.48 + 0.20 * fw * fade + 0.16 * (z - 0.95) + 0.10 * Nn[:, 2] + 0.08 * _paint_noise(P, 12.0) + 0.12 * kv
        outer = _ramp(t, L["coat_lo"], L["coat"], L["coat_hi"])
        lin = _ramp(t - 0.05, L["lining_lo"], L["lining"], L["lining"] * 1.25)
        front = y < y0 - 0.02
        turned = front & (z < 1.08)
        c = np.where(inner[:, None], lin, outer)
        c = _mixc(c, lin, 0.85 * turned * _smooth(1.08, 0.95, z) * (~inner))
        # the trim: a clean ochre band along the hem, the front edges and the back slit (a thin dark line on its
        # inner side, no smudges)
        hm = coat_hem(xs, y)
        dh = z - hm
        band = _smooth(0.040, 0.030, dh) * _smooth(0.002, 0.008, dh)
        tr = _ramp(0.55 + 0.18 * kv + 0.05 * _paint_noise(P, 13.0) + 0.10 * Nn[:, 2], L["trim"] * 0.72,
                   L["trim"], np.minimum(L["trim"] * 1.18, 1.0))
        c = _mixc(c, tr, band * (~inner))
        c = _mixc(c, L["coat_lo"], 0.6 * np.exp(-((dh - 0.044) / 0.004) ** 2) * (~inner))
        rx = coat_lerp(COAT["rx"], z)
        de = np.abs(np.abs(xs) - coat_lerp(COAT["opening"], z) * rx)
        edge = _smooth(0.026, 0.016, de) * front
        c = _mixc(c, tr, edge * (~inner))
        zt, w0, w1 = COAT["slit"]
        sw = w0 + (w1 - w0) * np.clip((zt - z) / (zt - COAT["z0"] - 0.06), 0.0, 1.0)
        sl = _smooth(0.024, 0.014, np.abs(np.abs(xs) - sw)) * (y > y0 + 0.02) * (z < zt + 0.01)
        c = _mixc(c, tr, sl * (~inner))
        img[m] = c
    # scarf: cream linen at its painted value (no foreign hues)
    e = each("scarf")
    if e:
        m, P, Nn, kv = e
        cur = img[m]
        lv = _lum(cur)
        ref = max(float(np.percentile(lv, 70)), 0.2)
        back = _smooth(-0.1, 0.4, Nn[:, 1])
        val = np.clip(lv / ref, 0.35, 1.08) * (1 - back) + (0.80 + 0.12 * _paint_noise(P, 14.0)) * back
        # linen with readable folds: the painted value, strong curvature (crests light, creases cool grey), the
        # undersides of each wrap and the knot in shadow, diagonal fold strokes round the neck
        ang = np.arctan2(P[:, 0] - 0.016, P[:, 1] - 0.02)
        strokes = np.sin(ang * 5.0 + P[:, 2] * 70.0 + 1.5 * NOISE(P, 9.0))
        t = (0.52 + 1.0 * (val - 0.80) + 0.42 * kv + 0.14 * Nn[:, 2] + 0.07 * strokes
             - 0.16 * _smooth(-0.1, -0.6, Nn[:, 2]))
        img[m] = _ramp(t, L["scarf_lo"], L["scarf"] * 0.90, np.minimum(L["scarf"] * 1.07, 1.0))
    # helm: the concept's painted face plate and column (the plate's glow painted out, see _clean_face_plate)
    # carry the front and the back; the sides and the top take a procedural chalk in the same brushwork; the
    # glass grooves are inked with an anti-aliased border (distance to the glass outline, not a texel mask)
    e = each("helm")
    if e:
        m, P, Nn, kv = e
        cur = img[m]
        g = _lum(cur) / max(float(_lum(_hx(LOOK[None]["chalk_pj"]))), 1e-3)      # the painted value in the look's
        cur = np.clip(g[:, None] * L["chalk"][None], 0, 1).astype(np.float32)    # chalk (a touch under the concept)
        ch = shade(P, Nn, kv, L["chalk"], L["chalk_hi"], L["chalk_lo"], k_top=0.22, k_noise=0.04, k_edge=0.30,
                   seed=15.0, extra=0.09 * _detail(P, Nn))
        st = np.abs(Nn[:, 0]) / (np.abs(Nn[:, 0]) + np.abs(Nn[:, 1]) + 1e-6)
        wproc = np.maximum(_smooth(0.62, 0.90, st), _smooth(0.55, 0.85, Nn[:, 2]))
        back = _smooth(0.0, 0.5, Nn[:, 1]) * (1.0 - wproc)              # the column's back: the concept's pale
        cur = np.clip(cur * (1.0 + 0.22 * back)[:, None], 0, 1)        # grey lifted (its painted shadow side)
        c = (cur * (1 - wproc[:, None]) + ch * wproc[:, None]).astype(np.float32)
        front = (P[:, 1] < -0.06).astype(np.float32)
        xz = P[:, [0, 2]]
        dg = poly_sd(xz, np.array(SLIT_POLY))
        for line in CHEEK_LINES:
            dg = np.minimum(dg, poly_sd(xz, np.array(_strip_poly(line, CHEEK_HW))))
        ink = (1.0 - _smooth(INK_W * 0.75, INK_W * 1.25, dg)) * front
        c = _mixc(c, L["chalk_lo"] * 0.8, 0.5 * np.exp(-((dg - INK_W * 1.6) / 0.0016) ** 2) * front)    # groove lip
        c = _mixc(c, L["ink"], 0.95 * ink)
        img[m] = np.clip(c, 0, 1)
    # crest: carved faces from the concept (the back face lifted to chalk), the top edge stone
    e = each("crest")
    if e:
        m, P, Nn, kv = e
        cur = img[m]
        if _LOOK_ID[0] is not None:
            g = _lum(cur) / max(float(_lum(_hx(LOOK[None]["stone"]))), 1e-3)
            cur = np.clip(g[:, None] * L["stone"][None], 0, 1).astype(np.float32)
        lift = 1.0 + 0.45 * _smooth(0.0, 0.5, Nn[:, 1])
        cur = np.clip(cur * lift[:, None], 0, 1)
        top = shade(P, Nn, kv, L["stone"], L["stone_hi"], L["stone_lo"], k_edge=0.3, seed=16.0)
        img[m] = _mixc(cur, top, _smooth(0.45, 0.75, Nn[:, 2]))
    log(f"ervet procedural paint: {', '.join(n for n in PROCEDURAL if n in idx)}")


_J: dict = {}


def _trim_and_lift(img, maps, names, look, proc_ids):
    """the concept's ochre/gold trims become the pale warm-stone trim (the brief bans gold); back-facing paint of
    the chalk/stone parts carries the concept's back-view shadow, lifted so the head stays the lightest value"""
    part = maps["part"]
    have = part >= 0
    keep = have & ~np.isin(part, list(proc_ids))
    c = img[keep]
    mx, mn = c.max(1), c.min(1)
    sat = (mx - mn) / np.maximum(mx, 1e-4)
    r, g, b = c[:, 0], c[:, 1], c[:, 2]
    hue = np.degrees(np.arctan2(math.sqrt(3) * (g - b), 2 * r - g - b)) % 360
    w = _smooth(0.26, 0.42, sat) * _smooth(0.26, 0.40, mx) * _smooth(14.0, 24.0, hue) * (1 - _smooth(52.0, 62.0, hue))
    trim = _hx(look["trim"])
    val = np.clip(_lum(c) / max(float(_lum(trim)), 1e-3), 0.45, 1.25) ** 0.85
    t = np.clip(trim[None] * val[:, None], 0, 1)
    c = (c * (1 - w[:, None]) + t * w[:, None]).astype(np.float32)
    # the concept's blues (tabard, back plate, greaves, hip lames: ~37 % saturation) toward the brief's dusty
    # slate (the large blued areas stay well under 40 % saturation inside the reserved Dawn-azure band)
    wb = _smooth(0.12, 0.22, sat) * _smooth(185.0, 195.0, hue) * (1 - _smooth(228.0, 238.0, hue))
    lum = _lum(c)[:, None]
    c = (lum + (c - lum) * (1.0 - 0.30 * wb[:, None])).astype(np.float32)
    img[keep] = c
    N = maps["N"]
    for name, k in (("backplate", 0.18), ("breastplate", 0.10), ("tabard", 0.08), ("greave_R", 0.30),
                    ("greave_L", 0.30), ("legs", 0.20)):
        if name not in names:
            continue
        sel = part == names.index(name)
        lift = 1.0 + k * _smooth(0.0, 0.5, N[sel][:, 1])
        img[sel] = np.clip(img[sel] * lift[:, None], 0, 1)


_orig_paint_object = project.paint_object


def _paint_object(obj, size, cfg, names, part_attr="vale_part", log=print, return_maps=False):
    """Ervet's paint: the body from the blade-free plates with body-only visibility (no ghost blade on the coat),
    the concept's gold trims turned to warm stone, then the procedural parts in the build's LOOK."""
    if cfg.get("concept") != ID:
        return _orig_paint_object(obj, size, cfg, names, part_attr=part_attr, log=log, return_maps=return_maps)
    cache = os.path.join(scene.CACHE_DIR, "concept")
    plates_body = project.Plates(cache, ID, cfg["height"])
    plates_body.img = {s: project.load_rgb(os.path.join(cache, f"{ID}_{s}_body.png")) for s in ("front", "back")}
    plates_body.img["front"] = _clean_face_plate(plates_body.img["front"], plates_body)
    _make_detail(plates_body.img["front"], plates_body)
    maps = project.rasterize(obj, size, part_attr)
    idx = {n: i for i, n in enumerate(names)}
    sw_ids = {idx[n] for n in SWORD_PARTS if n in idx}
    body_ids = set(range(len(names))) - sw_ids
    ob_b = _sub_object(obj, body_ids, "_ervet_vis_body")
    vis_b = project.VisibilityMaps.build(ob_b, plates_body, step=2, part_attr=part_attr)
    me = ob_b.data
    bpy.data.objects.remove(ob_b)
    bpy.data.meshes.remove(me)
    flat = {k: scene.hex_srgb(h) for k, h in (cfg.get("flat") or {}).items()}
    img = project.paint(maps, plates_body, vis_b, names, flat=flat, bleed=False, log=log)
    _coat_sides(img, maps, names, plates_body)
    look = LOOK.get(_LOOK_ID[0]) or LOOK[None]
    proc_ids = {idx[n] for n in PROCEDURAL if n in idx} | sw_ids
    _trim_and_lift(img, maps, names, look, proc_ids)
    _paint_procedural(img, maps, names, look, log=log)
    for name, rgb in flat.items():                                  # skin-only extras stay flat
        if name in idx:
            img[maps["part"] == idx[name]] = np.asarray(rgb, dtype=np.float32)
    part = maps["part"]
    iy, ix = project.nearest_index(part >= 0)
    img = img[iy, ix]
    log(f"ervet projection: {len(body_ids)} body parts projected, {len(proc_ids)} procedural/sword parts")
    return (img, maps) if return_maps else img


project.paint_object = _paint_object

_orig_recolour = project.recolour


def _recolour(img, maps, names, roles, base_pal, skin_pal, skip=None, log=print):
    """Ervet's skins re-colour the PROJECTED parts hue-aware: texels near a part's base role colour take the skin
    colour at their own painted value (a luminance-preserving tint), texels of other colours keep the shared
    per-channel gain. The procedural parts are already painted in the skin's LOOK and are skipped."""
    if "blade_great" not in names:
        return _orig_recolour(img, maps, names, roles, base_pal, skin_pal, skip=skip, log=log)
    part = maps["part"]
    iy, ix = project.nearest_index(part >= 0)
    pid = part[iy, ix]
    lin = project._lin(img)
    out = lin.copy()
    skip = set(skip or set()) | set(PROCEDURAL) | set(SWORD_PARTS)
    wl = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    lum = lin @ wl
    chroma = lin - lum[..., None]
    sat = np.linalg.norm(chroma, axis=-1) / np.maximum(lum, 1e-3)
    for i, n in enumerate(names):
        r = roles.get(n)
        if n in skip or not r or r == "accent" or r not in skin_pal or r not in base_pal:
            continue
        if str(base_pal[r]).lower() == str(skin_pal[r]).lower():
            continue
        B = project._lin(scene.hex_srgb(base_pal[r]))
        S = project._lin(scene.hex_srgb(skin_pal[r]))
        m = pid == i
        gain = np.clip(S / np.maximum(B, 1e-4), 0.05, 8.0)
        g = lin[m] * gain
        t = (lum[m] / max(float(B @ wl), 1e-4))[:, None] * S[None, :]
        cB = B - float(B @ wl)
        sB = float(np.linalg.norm(cB)) / max(float(B @ wl), 1e-3)
        grey = np.clip(1.0 - (sat[m] - 0.10) / 0.25, 0.0, 1.0)
        if sB < 0.12:
            w = grey
        else:
            cos = (chroma[m] @ cB) / np.maximum(np.linalg.norm(chroma[m], axis=-1) * np.linalg.norm(cB), 1e-6)
            w = np.maximum(grey, np.clip((cos - 0.25) / 0.45, 0.0, 1.0))
        w = w[:, None]
        out[m] = t * w + g * (1 - w)
        log(f"  recolour {n} ({r}): {base_pal[r]} -> {skin_pal[r]} (hue-aware, {float(w.mean()):.2f} tinted)")
    return project._srgb(out).astype(np.float32)


project.recolour = _recolour

_orig_fighter_renders = render.fighter_renders


def _fighter_renders(ctx, objs, P, skin, *a, **kw):
    """renders show the base form (the stub and the great blade nodes stay hidden); the body's specular is
    lowered for the renders only (the GLB is exported before): under the splash's bright sky the low camera saw
    the horizon in the dark boots and greaves and they rendered pale"""
    if getattr(ctx.spec, "ID", None) != ID:
        return _orig_fighter_renders(ctx, objs, P, skin, *a, **kw)
    keep = [o for o in objs if not o.name.startswith(HIDE_FORMS)]
    hid = [o for o in objs if o.name.startswith(HIDE_FORMS)]
    for o in hid:
        o.hide_render = True
    spec_saved = []
    for o in keep:                     # the painted albedo carries the read: specular 0.5 -> 0.2 for the renders
        for slot in getattr(o, "material_slots", []):
            m = slot.material
            if not m or not m.use_nodes or m.name.startswith("accent"):
                continue
            for nd in m.node_tree.nodes:
                if nd.type == "BSDF_PRINCIPLED" and "Specular IOR Level" in nd.inputs:
                    sock = nd.inputs["Specular IOR Level"]
                    if not sock.is_linked:
                        spec_saved.append((sock, sock.default_value))
                        sock.default_value = 0.2
    try:
        return _orig_fighter_renders(ctx, keep, P, skin, *a, **kw)
    finally:
        for o in hid:
            o.hide_render = False
        for sock, v in spec_saved:
            sock.default_value = v


render.fighter_renders = _fighter_renders


def strip_forms(glb: str, keep: str, out: str) -> str:
    """copy of a GLB where every form_<f> node except form_<keep> loses its mesh (QA of one form)"""
    with open(glb, "rb") as f:
        data = f.read()
    magic, ver, total = struct.unpack_from("<4sII", data, 0)
    jlen, jtype = struct.unpack_from("<II", data, 12)
    js = json.loads(data[20:20 + jlen].decode("utf-8"))
    rest = data[20 + jlen:]
    for nd in js.get("nodes", []):
        nm = nd.get("name", "")
        if nm.startswith("form_") and not nm.startswith(f"form_{keep}"):
            nd.pop("mesh", None)
            nd.pop("skin", None)
    jb = json.dumps(js, separators=(",", ":")).encode("utf-8")
    jb += b" " * ((4 - len(jb) % 4) % 4)
    body = struct.pack("<II", len(jb), 0x4E4F534A) + jb + rest
    with open(out, "wb") as f:
        f.write(struct.pack("<4sII", magic, ver, 12 + len(body)) + body)
    return out


_orig_three_qa = export.three_qa


def _three_qa(glb, out_png, clips=False, sky=None, cell=None):
    """three.js QA of the base form (+ one sheet per extra form for the base build)"""
    base = os.path.basename(glb)
    if not base.startswith(ID):
        return _orig_three_qa(glb, out_png, clips=clips, sky=sky, cell=cell)
    tmpdir = os.path.join(scene.CACHE_DIR, "fighters", "_ervet_qa")
    os.makedirs(tmpdir, exist_ok=True)
    t = strip_forms(glb, "base", os.path.join(tmpdir, base.replace(".glb", "_base.glb")))
    rep = _orig_three_qa(t, out_png, clips=clips, sky=sky, cell=cell)
    if not clips and base == f"{ID}.glb" and os.environ.get("ERVET_FORM_QA", "1") == "1":
        rep["forms"] = {}
        for f in ("hilt", "great"):
            t2 = strip_forms(glb, f, os.path.join(tmpdir, base.replace(".glb", f"_{f}.glb")))
            r2 = _orig_three_qa(t2, out_png.replace(".png", f"_{f}.png"), clips=False, sky=sky, cell=cell)
            rep["forms"][f] = {k: r2.get(k) for k in ("ok", "accentPct", "facing", "heightPx1080")}
    return rep


export.three_qa = _three_qa


if __name__ == "__main__":
    fighter.main(sys.modules[__name__])
