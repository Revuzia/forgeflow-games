"""nurrow: Lull singer (Striker, Serenade). ART 2.0: sculpted volumes painted by concept projection.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/nurrow_plates.py --height 1.98   # plates
    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/nurrow_fit.py                    # fit overlay
    python3 art/build.py fighter nurrow --no-skins --clip-sheet
    python3 art/build.py fighter nurrow --skins-only

Brief: _design/fighters/nurrow.md. Concept: _design/concept/nurrow.webp (front + back, hand-painted).
The forms are numpy SDF volumes (common/hifi/sdf.py) fitted to the concept on a 10 cm grid (the fit overlay:
proto/nurrow_fit.py); the base colour is the concept painting itself, projected occlusion-aware onto the game
mesh (common/hifi/project.py via the pipeline's PROJECTION hook); normals and AO bake from the sculpt.

Where the concept and the brief disagree the concept's FORMS and COLOURS win (the approved look, as on Marund):
the snuffer hat is the concept's wide golden-ochre cone (0.80 m across, 0.17 m to the apex, a curled snuffer knob
on top), tilted 8 degrees forward and rolled 11.5 degrees to her right, its apex and knob set 10 cm forward of the
brim centre (an oblique cone: from the game camera the knob leans the way she faces), its dark iron rim set with the
accent, on its own bone (x_hat: it rolls off in `death`); the
mantle is the concept's long felt cape with ragged points (one x_ chain, 2 sway bones) and a felt cowl with a
hood lying on the upper back; both hands are carved wood. The brief wins on what is banned and on the accent: the
concept's blue rim studs (gems) become the brief's SIX accent-glass inlays, slim slips set flush in the rim's upper
bevel at +-50 / 100 / 150 deg (the front 100 deg bare; the colour reads from any angle, including from above; the
only emissive), the brooch's stone a
matte slate stone; the hat's lacquer keeps the concept's ochre hue but its chroma is held at the bible's 40 % cap
for the marigold band (art/README: team hues stay out of large albedo areas above 40 %).

Plates (proto/nurrow_plates.py): the concept's stance is wide and asymmetric; the model is bound in a symmetric
stance (every clip and the run work from one rest pose) and the plates re-pose the painted legs onto it.

Not in the shared pipeline, implemented here (module-level wrappers installed for this build only; common/ is
untouched): part binding restricted to named bones ("auto_only"), the projection paint (the painted blade taken off
the plate and every part behind it filled from its own paint; the hat's lacquer PAINTED by hand-placed brushwork
(_lacquer: gores, radial strokes, the painted line, soot, chips, scratches, crackle; each skin's own paint on it:
Noon Fair's moths, Shadeprint's ink crown); the hat's top and underside are two parts (their own texel weights)
(its underside the
concept's warm ochre-brown, not the brief's ink), a clean dark iron rim / knob, the blade with its pale bevel, the
grip, the brown head wrap, the red-brown belt, the carved pauldron lames, the umber boots with their sole and welt;
the trousers and leg wraps re-coloured to the concept's plum / grey-mauve; side planes of the cape, cowl and legs; a
value pass), the bake maps' margins (roughness background filled from the islands + a matte floor on the boots,
normal seams flattened, AO floored where the rest pose shadows moving parts), the skin re-colour (+ per-skin felt
value targets), the foot solver's pitch sign, and a palm-oriented aim (PalmAim: anim._solve_aim and Aim.lerp
wrapped, so the ult's landing hand lies palm-down).
"""
from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy  # noqa: E402,F401
import numpy as np  # noqa: E402

from common import anim, fighter, materials, rig  # noqa: E402
from common.hifi import sdf  # noqa: E402
from common.hifi.sdf import (Capsule, Ellipsoid, FlatCapsule, HalfSpace, Lathe, RoundBox, RoundCone,  # noqa: E402
                             Sculpt, Sphere, Torus, Tube)

ID = "nurrow"
TITLE = "Lull singer"
ROLE_MASS = "striker"
ORIGIN = "serenade"
CARD = {"primary": "#3E3440", "secondary": "#8C6F5A"}

# rig fitted to the sculpt (the concept on the 10 cm grid, knob tip 1.98 m): crown of the head inside the hat 1.78,
# skull base 1.50, neck base 1.42, shoulder joints x 0.22 at 1.36, elbows ~(0.35, 0.06, 1.20), wrists ~(0.48,
# -0.03, 1.04); hips x 0.09 at 0.90, knees ~(0.165, -0.04, 0.505), ankles x 0.23 at 0.11 (a symmetric rest
# stance; the concept's wide one is the idle's)
PROPORTIONS = rig.proportions(height=1.78, head=0.326, neck=0.08, shoulder_width=0.44, hip_width=0.18, leg=0.802,
                              thigh_frac=0.50, arm=0.439, upper_arm_frac=0.483, hand=0.20, foot=0.27,
                              ankle_height=0.11, spine_curve=0.02, stance=0.14, toe_out_deg=25.0, knee_bend=0.05,
                              a_pose_deg=49.0, arm_forward_deg=-21.1, elbow_bend_deg=37.0, shoulder_drop=0.06)
MATERIAL_SET = "bible"
PALETTE = materials.bible_palette(sandstone="#CDB07E", wood="#92705B", hand_wood="#845D47", wood_dark="#5B3927", cloth="#796265",
                                  cloth2="#877A68", ironstone="#4A4045", leather="#3F3134", under="#4E3A36",
                                  ink="#17161A", accent="#3F9CFF")
VALUE_GRADIENT_STOPS = materials.BIBLE_GRADIENT_STOPS
SOCKETS = {"weapon": "prop.R", "hat_rim": "x_hat_rim", "dart_hand": "x_dart_hand", "weapon_tip": "x_blade_tip"}
SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92, "yaw": 22.0}
TEXTURE_SIZE = 2048
TEXTURE_SIZES = {"normal": 512, "orm": 256}          # ORM 256: GLB headroom (AO + roughness; the AO is also in the base)
GLB_COMPRESS = True
ARMOUR_CONFORM = False
AO_INTO_BASE = 0.25
# ART 2.0 skins (brief §9): the projected painting re-coloured part by part (pipeline -> project.recolour, wrapped
# here: the painted hat / rim / knob are painted in the skin's own colours instead), plus painted skin details:
# Noon Fair's lacquer moths ringing the chalky hat and the half-lids painted over the mask's closed lids; Shadeprint's
# printed pale cone (a leafy branch's shadow printed in light-ribbed ink) under an ink brim band and a light rim, the
# light-rimmed hem. Both keep the base legs (brief §9 changes no `under` / `cloth2`). No extra geometry (brief).
SKINS: list = [
    {"id": "nurrow_noon_fair", "extra": {}, "card": {"primary": "#6A4F5E", "secondary": "#E2D6C3"},
     "palette": {"sandstone": "#E2D6C3", "moth": "#B48AA6", "wood": "#D3C0A0", "cloth": "#8C7886"}},
    {"id": "nurrow_shadeprint", "extra": {}, "card": {"primary": "#2B2A33", "secondary": "#B7B4BE"},
     "palette": {"sandstone": "#2B2A33", "chalk": "#D8D5DE", "wood": "#B7B4BE", "cloth": "#847C8E",
                 "ironstone": "#4B4955"}},
]
SKIN_FLAT: dict = {}
_SKIN: dict = {}

HEIGHT = 1.98             # the snuffer knob's tip (the projection plates' scale; art.height)
PROJECTION = {"concept": "nurrow", "height": HEIGHT}
NOISE = sdf.Noise(13)
VOXEL = 0.007
V3 = np.array


def unit(v):
    v = np.asarray(v, dtype=np.float64)
    return v / (np.linalg.norm(v) + 1e-12)


# ── the hat frame: brim plane centre, tilted 8 deg forward (-Y) and rolled 11.5 deg to her right (-X); the rest
#    brim clears the closed lids (the idle's head pitch tips it ~7 deg more). The cone is OBLIQUE: its apex and the
#    knob sit HAT_SHEAR forward of the brim centre, so from the 52 degree camera the cone is a point leaning the way
#    she faces (the facing cue) without dropping the front brim over the lids ─────────────────────────────────
HAT_C = V3([0.0, 0.004, 1.746])
HAT_TILT, HAT_ROLL = 8.0, 11.5
HAT_SHEAR = 0.10
HAT_R = sdf.rot_y(-HAT_ROLL) @ sdf.rot_x(HAT_TILT)          # columns = the hat's local axes in world
HAT_AX = sdf.axes_from_rot(HAT_R)                           # rows (the primitives' frame)
HAT_UP = HAT_R[:, 2]
BRIM_R = 0.395            # the cone's outer radius at the brim
CONE_H = 0.165            # brim plane -> apex (outer surface)
CONE_T = 0.013            # lacquer shell thickness
# fix pass 5 (review: 'six 12.6 x 6.2 cm inlays, 3x the brief, glossy blue buttons / a tambourine') went to 21 studs;
# review 6: 'the rim accent got bigger: a full ring of team-tinted dots, a black-and-white dashed ring like the UI's
# selection ring, a tambourine / bottle cap / dial from above' (accent 3.53 %). Polish: back to the brief's SIX inlays
# at the fix-pass-3 stations (+-50 / 100 / 150 deg: the front 100 deg bare, a facing cue; six separate marks with long
# dark iron between, never a ring), each a SLIM glass slip set FLUSH in a thin iron bezel (no domed bead, no setting
# swelling the rim), 12.4 x 5.0 cm (f3: 12.6 x 6.2 domed): the floor that the pipeline's accent gate (>= 1.5 % at the
# game camera) and lineup_qa's (>= 1 % from behind) leave; the brief's 4 x 1.5 cm x 6 is 0.4 %
RIM_ANGLES = (50.0, 100.0, 150.0, -150.0, -100.0, -50.0)
RIM_N = len(RIM_ANGLES)


def hat_w(p):
    """hat-local (x, y, z) -> world"""
    return HAT_C + HAT_R @ np.asarray(p, dtype=np.float64)


def hat_local(P):
    return (np.asarray(P) - HAT_C) @ HAT_R


def _shear(z):
    return HAT_SHEAR * np.clip(np.asarray(z, dtype=np.float64) / CONE_H, 0.0, 1.0)


def hat_unshear(q):
    """hat-local point on the oblique cone -> the upright cone's local point (the lathe / paint frame)"""
    q = np.array(q, dtype=np.float64, copy=True)
    q[..., 1] += _shear(q[..., 2])
    return q


def hat_ws(p):
    """upright-cone local point -> world on the oblique cone (the apex HAT_SHEAR forward)"""
    p = np.array(p, dtype=np.float64, copy=True)
    p[..., 1] -= _shear(p[..., 2])
    return HAT_C + p @ HAT_R.T


class HatSheared(sdf.Prim):
    """an upright hat primitive (lathe in the HAT frame) sheared into the oblique cone"""

    def __init__(self, inner):
        self.inner = inner

    def bounds(self):
        lo, hi = self.inner.bounds()
        return lo - (HAT_SHEAR + 0.01), hi + (HAT_SHEAR + 0.01)

    def d(self, P):
        q = hat_unshear(hat_local(P))
        return self.inner.d(HAT_C + q @ HAT_R.T)


def rim_angle_dir(phi_deg):
    """local radial direction at angle phi (0 = the front, -Y local; + toward her left, +X)"""
    a = math.radians(phi_deg)
    return V3([math.sin(a), -math.cos(a), 0.0])


INLAY_T, INLAY_B = 0.062, 0.025          # the slips' footprint half-length (along the rim) and half-width


def inlay_frames():
    """[(centre, axes rows (tangent, across, bevel normal))] of the six rim inlays (world, rest)"""
    out = []
    for phi in RIM_ANGLES:
        rd = rim_angle_dir(phi)
        tg = np.cross(V3([0, 0, 1.0]), rd)
        nrm = unit(rd * 0.55 + V3([0, 0, 1.0]) * 0.83)                 # the rim's upper-outer bevel
        n_w, t_w = HAT_R @ nrm, HAT_R @ tg
        b_w = np.cross(n_w, t_w)
        out.append((hat_w(rd * (BRIM_R + 0.002) + V3([0, 0, 0.004])), np.stack([unit(t_w), unit(b_w), unit(n_w)])))
    return out


class RimSlip(sdf.Prim):
    """a glass slip set flush in a surface: the surface's own skin (lo..hi from it) inside a footprint"""

    def __init__(self, surf, foot, lo, hi):
        self.surf, self.foot, self.lo, self.hi = surf, foot, float(lo), float(hi)

    def bounds(self):
        return self.foot.bounds()

    def d(self, P):
        dr = self.surf.d(P)
        return np.maximum(np.maximum(dr - self.hi, self.lo - dr), self.foot.d(P))


# ── arm / hand landmarks at rest (match the rig's layout for PROPORTIONS) ───────────────────────────────────
SH = {"L": V3([0.22, 0.010, 1.36]), "R": V3([-0.22, 0.010, 1.36])}
EL = {"L": V3([0.350, 0.060, 1.20]), "R": V3([-0.350, 0.060, 1.20])}
WR = {"L": V3([0.482, -0.030, 1.038]), "R": V3([-0.482, -0.030, 1.038])}
FD = {"L": unit((0.580, -0.396, -0.713)), "R": unit((-0.580, -0.396, -0.713))}    # forearm direction
HD_L = unit((-0.05, -0.22, -0.97))      # the open left hand hangs from the wrist, fingers down (the concept)
HIP = {"L": V3([0.09, 0.005, 0.90]), "R": V3([-0.09, 0.005, 0.90])}
KNEE = {"L": V3([0.165, -0.035, 0.505]), "R": V3([-0.165, -0.035, 0.505])}
ANK = {"L": V3([0.23, 0.02, 0.11]), "R": V3([-0.23, 0.02, 0.11])}
TOE_OUT = 25.0

# the snuffer blade in the right fist: grip axis (pommel -> guard), the curved blade in a plane before the thighs
FIST_R = WR["R"] + FD["R"] * 0.07
GRIP_AX = unit((0.667, -0.333, -0.667))
POMMEL = FIST_R - GRIP_AX * 0.105
GUARD = FIST_R + GRIP_AX * 0.078
BLADE_TIP = V3([0.03, -0.225, 0.885])
BLADE_MID = V3([-0.21, -0.19, 0.770])          # the convex edge's lowest point region (spine curve control)


# ── displacement helpers ────────────────────────────────────────────────────────────────────────────────────
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


def grain(amp, freq=60.0):
    """carved-wood grain: fine ridges along Z, broken by noise"""
    def fn(P):
        return amp * np.sin(P[:, 0] * freq + 3.0 * NOISE(P, 6.0)) * 0.5
    return fn


def wraps(amp, freq, c, u, slant=0.35):
    """bandage wraps round an axis (c, u): ridges at a slant along the axis"""
    c, u = V3(c, dtype=np.float64), unit(u)

    def fn(P):
        d = P - c
        s = d @ u
        side = np.cross(np.where(np.abs(u[2]) > 0.9, V3([1.0, 0, 0]), V3([0, 0, 1.0])), u)
        side = side / (np.linalg.norm(side) + 1e-9)
        ang = np.arctan2(d @ np.cross(u, side), d @ side)
        return amp * (0.5 - np.abs(np.sin(s * freq + slant * ang + 0.3 * NOISE(P, 9.0)))) * -1.0
    return fn


# ── custom primitives ───────────────────────────────────────────────────────────────────────────────────────
class CapeShell(sdf.Prim):
    """The felt cape: a shell round a vertical axis that drifts back-right as it falls, its radius growing toward
    the hem and swept out on her right; angular extent, top edge and a ragged hem (knots theta -> z) bound it.
    theta = 0 points to the back (+Y), + toward her left (+X)."""

    def __init__(self, t=0.02, z_top=1.47, hem=None):
        self.t = t
        self.z_top = z_top
        self.hem = sorted(hem)
        self.lo = V3([-0.85, -0.25, 0.20])
        self.hi = V3([0.60, 0.80, 1.52])

    def bounds(self):
        return self.lo, self.hi

    @staticmethod
    def s_of(z):
        return np.clip((1.42 - z) / 1.0, 0.0, 1.0)

    def axis(self, z):
        s = self.s_of(z)
        return 0.0 * s, 0.10 + 0.06 * s

    # the back view's half-widths (her left, her right) by height: her right sweeps out to a flag-like flap
    AL = ([0.40, 0.75, 1.10, 1.35, 1.52], [0.335, 0.31, 0.295, 0.325, 0.30])
    AR = ([0.40, 0.50, 0.65, 0.75, 0.85, 0.95, 1.10, 1.35, 1.52], [0.56, 0.55, 0.50, 0.46, 0.41, 0.36, 0.31, 0.325, 0.30])

    def radius(self, th, z):
        """the U section: an ellipse (half-width a by side, half-depth b) round the axis"""
        s = self.s_of(z)
        a = np.where(th >= 0, np.interp(z, *self.AL), np.interp(z, *self.AR))
        b = 0.095 + 0.13 * s          # fix pass 5: 0.16 -> 0.13 (a flatter felt: the lunges' rounded sack)
        r = a * b / np.sqrt((b * np.sin(th)) ** 2 + (a * np.cos(th)) ** 2)
        r = r + (0.005 + 0.016 * s) * np.sin(th * 7.0 + 1.3 + 0.8 * np.sin(z * 5.0)) * (0.3 + 0.7 * s)
        return r

    def limits(self, z):
        s = self.s_of(z)
        return math.radians(1.0) * (82.0 + 30.0 * s), -math.radians(1.0) * (84.0 + 32.0 * s)

    def hem_z(self, th):
        kt = np.radians([k[0] for k in self.hem])
        kz = np.array([k[1] for k in self.hem])
        return np.interp(th, kt, kz)

    def d(self, P):
        z = P[:, 2]
        ax, ay = self.axis(z)
        dx, dy = P[:, 0] - ax, P[:, 1] - ay
        rho = np.hypot(dx, dy)
        th = np.arctan2(dx, dy)
        r = self.radius(th, z)
        d_rad = np.abs(rho - r) - self.t * 0.5
        tl, tr = self.limits(z)
        d_ang = np.maximum(th - tl, tr - th) * np.maximum(rho, 0.05)
        top = self.z_top - 0.07 * (np.abs(th) / 1.6) ** 2
        d_top = z - top
        d_bot = self.hem_z(th) - z
        return np.maximum(np.maximum(d_rad, d_ang), np.maximum(d_top, d_bot))


class Crescent(sdf.Prim):
    """The snuffer blade: a 2D crescent (inside the edge circle, outside the spine circle, past the guard) in the
    blade plane, extruded with a thickness that falls from the spine to a bevelled edge."""

    def __init__(self, guard, tip, low, e2_hint, w_root=0.075, t_spine=0.016, t_edge=0.004):
        self.g = V3(guard, dtype=np.float64)
        e1 = unit(V3(tip) - self.g)
        e2 = unit(V3(e2_hint) - e1 * float(np.dot(e2_hint, e1)))
        self.e1, self.e2, self.n = e1, e2, np.cross(e1, e2)
        L = float(np.dot(V3(tip) - self.g, e1))
        lo = V3(low) - self.g
        lu, lv = float(lo @ e1), float(lo @ e2)
        # edge (convex) circle through the guard's lower corner, the low point and the tip
        self.c1, self.r1 = self._circle((0.0, -w_root * 0.55), (lu, lv), (L, 0.0))
        # spine (concave) circle through the guard's upper corner, a point above the low one and the tip
        self.c2, self.r2 = self._circle((0.0, w_root * 0.45), (lu, lv + w_root * 0.95), (L, 0.0))
        self.L = L
        self.ts, self.te = t_spine, t_edge
        self.tip = V3(tip)

    @staticmethod
    def _circle(a, b, c):
        ax, ay = a
        bx, by = b
        cx, cy = c
        d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
        ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d
        uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d
        return np.array([ux, uy]), math.hypot(ax - ux, ay - uy)

    def bounds(self):
        pts = [self.g + self.e1 * u + self.e2 * v for u in (-0.02, self.L + 0.02) for v in (-0.12, 0.08)]
        P = np.array(pts)
        return P.min(0) - 0.03, P.max(0) + 0.03

    def d(self, P):
        Q = P - self.g
        u, v, w = Q @ self.e1, Q @ self.e2, Q @ self.n
        q = np.stack([u, v], 1)
        d1 = np.linalg.norm(q - self.c1, axis=1) - self.r1          # inside the edge circle: < 0
        d2 = np.linalg.norm(q - self.c2, axis=1) - self.r2          # outside the spine circle: > 0
        d2d = np.maximum(np.maximum(d1, -d2), -u)
        inner = np.clip(-d1 / 0.035, 0, 1)
        t = self.te + (self.ts - self.te) * inner * inner * (3 - 2 * inner) * np.clip(1.0 - u / (self.L * 1.05), 0.25, 1)
        return np.maximum(d2d, np.abs(w) - t * 0.5)


BROOCH = (V3([-0.072, -0.128, 1.432]), unit((-0.15, -1.0, 0.25)))
STRAP_Z = 1.098                 # the red-brown belt's centre line (the concept: on the sash's upper half)
CRES = Crescent(GUARD + GRIP_AX * 0.008, BLADE_TIP, BLADE_MID, unit(V3([0.25, 0.0, 1.0])), w_root=0.078)

CAPE_HEM = [(-126.0, 0.66), (-110.0, 0.58), (-95.0, 0.47), (-76.0, 0.37), (-55.0, 0.55), (-42.0, 0.62),
            (-32.0, 0.60), (-24.0, 0.38), (-13.0, 0.52), (-6.0, 0.56), (3.0, 0.28), (18.0, 0.55), (37.0, 0.62),
            (65.0, 0.74), (90.0, 0.78), (114.0, 0.84)]
CAPE = CapeShell(t=0.02, z_top=1.47, hem=CAPE_HEM)
EYES = {sx: ([sx * 0.125 + 0.012, sx * 0.095 + 0.012, sx * 0.065 + 0.012, sx * 0.038 + 0.012], [1.633, 1.616, 1.607, 1.606])
        for sx in (-1, 1)}


def mask_y(x, z):
    """the mask's front surface (y) at (x, z): the shield ellipsoid's front"""
    c, r = V3([0.012, -0.02, 1.585]), V3([0.148, 0.118, 0.178])
    q = 1.0 - ((x - c[0]) / r[0]) ** 2 - ((z - c[2]) / r[2]) ** 2
    return c[1] - r[1] * math.sqrt(max(q, 0.02))


def on_mask(x, z, out=0.0):
    return V3([x, mask_y(x, z) - out, z])


def hand_frame(side, y=None):
    """rows: X (thumb side), Y (along the fingers), Z (back of the hand) for the rest hand"""
    y = FD[side] if y is None else unit(y)
    sx = 1.0 if side == "L" else -1.0
    out = V3([sx, 0.0, 0.0]) - y * (sx * y[0])
    z = unit(out)
    x = np.cross(y, z) if side == "L" else np.cross(z, y)
    return np.stack([unit(x), y, z])


def hl(side, p, origin=None, y=None):
    """hand-local point -> world"""
    F = hand_frame(side, y)
    o = WR[side] if origin is None else origin
    return o + np.asarray(p, dtype=np.float64) @ F


# the pauldron's lames (shared by the sculpt and its paint)
PAUL_O = V3([-0.235, 0.012, 1.352])
PAUL_TILT = 15.0          # the lames follow the shoulder's slope: lower on the outside
PAUL_YS = 0.118 / 0.112   # the shoulder a little narrower front-to-back
_pt = math.radians(PAUL_TILT)
PAUL_UP = V3([-math.sin(_pt), 0.0, math.cos(_pt)])          # the pauldron's axis, leaning out over the arm
PAUL_EX = V3([math.cos(_pt), 0.0, math.sin(_pt)])           # local +x points IN (toward the neck): out = -x
PAUL_AX = np.stack([PAUL_EX, V3([0.0, PAUL_YS, 0.0]), PAUL_UP])
PAUL_LAMES: list = []
# the three lames in the pauldron's frame (r, h from PAUL_O along PAUL_UP): the top one a domed cap, the two below
# conical felt-thick wooden bands, each tucked under the rolled lip of the one above and flaring out below it
PAUL_CAP = dict(rr=(0.118, 0.112, 0.088), h_cut=0.028, lip=(0.109, 0.037))
PAUL_BANDS = (dict(top=(0.100, 0.030), bot=(0.140, -0.035), lip=(0.139, -0.037)),
              dict(top=(0.128, -0.030), bot=(0.170, -0.098), lip=(0.169, -0.100)))
PAUL_T = 0.009            # half the bands' thickness
PAUL_LIP = 0.0105         # the rolled lips' tube radius


def paul_local(P):
    """world -> the pauldron frame: (radius about its axis, height along it, angle round it: 0 = straight out)"""
    q = (np.atleast_2d(P) - PAUL_O) @ PAUL_AX.T
    return np.hypot(q[:, 0], q[:, 1]), q[:, 2], np.arctan2(q[:, 1], -q[:, 0])


def paul_world(r, h, th):
    """the pauldron frame -> world (th 0 = straight out from the shoulder)"""
    lx, ly = -r * math.cos(th), r * math.sin(th) / PAUL_YS
    return PAUL_O + lx * PAUL_EX + ly * V3([0.0, 1.0, 0.0]) + h * PAUL_UP


def paul_band_r(i, h):
    """band i's mid-surface radius at height h"""
    (r0, h0), (r1, h1) = PAUL_BANDS[i]["top"], PAUL_BANDS[i]["bot"]
    return r0 + (r1 - r0) * (h - h0) / (h1 - h0)


def paul_edges():
    """per lame: (bottom edge height, the height under the lip above it where its visible band starts)"""
    out = [(PAUL_CAP["h_cut"], 1.0)]
    lips = [PAUL_CAP["lip"][1]] + [b["lip"][1] for b in PAUL_BANDS]
    for i, b in enumerate(PAUL_BANDS):
        out.append((b["lip"][1] - PAUL_LIP, lips[i] - PAUL_LIP))
    return out


def paul_rivets():
    """two domed rivets on each lame's visible band, on one line round the shoulder"""
    pts = []
    for th in (-0.42, 0.42):
        pts.append(paul_world(0.118 * math.sqrt(1 - (0.058 / 0.088) ** 2), 0.058, th))
        for i, hh in enumerate((-0.004, -0.066)):
            pts.append(paul_world(paul_band_r(i, hh) + PAUL_T, hh, th))
    return pts


# ── the sculpt ──────────────────────────────────────────────────────────────────────────────────────────────
def sculpts() -> list:
    """(name, Sculpt, voxel scale, material role, bind, tris) in build order."""
    out = []

    def part(name, S, role, bind, tris, vs=1.0):
        out.append((name, S, vs, role, bind, tris))

    # ── HAT (rigid on the head) ──
    def cone_prof(r, z):
        s = CONE_H / BRIM_R
        dl = (z - CONE_H + s * r) / math.sqrt(1 + s * s)                 # + above the outer surface
        shell = np.abs(dl + CONE_T * 0.5) - CONE_T * 0.5
        return np.maximum(shell, r - BRIM_R)

    def ribs(P):
        q = hat_unshear(hat_local(P))
        phi = np.arctan2(q[:, 0], -q[:, 1])
        r = np.hypot(q[:, 0], q[:, 1])
        return -0.0016 * np.clip(np.cos(phi * 36.0 + 0.4 * NOISE(P, 7.0)), 0, 1) ** 4 * np.clip(r / 0.12, 0, 1)

    cone = Sculpt("hat_cone")
    cone.add(HatSheared(Lathe(HAT_C, cone_prof, BRIM_R + 0.01, -0.03, CONE_H + 0.01, axes=HAT_AX))
             .displaced(ribs, 0.002), k=0.0)
    part("hat_cone", cone, "sandstone", "bone:x_hat", 1900)

    def rim_prof(r, z):
        rc, zc, hr, hz, cr = BRIM_R - 0.006, -0.008, 0.016, 0.019, 0.008
        q0 = np.abs(r - rc) - hr + cr
        q1 = np.abs(z - zc) - hz + cr
        return np.hypot(np.maximum(q0, 0), np.maximum(q1, 0)) + np.minimum(np.maximum(q0, q1), 0) - cr

    rim = Sculpt("hat_rim")
    rim_surf = Lathe(HAT_C, rim_prof, BRIM_R + 0.03, -0.04, 0.03, axes=HAT_AX).displaced(chips(0.003, 30.0), 0.003)
    rim.add(rim_surf, k=0.0)
    glass = Sculpt("hat_inlays")
    # six slim glass slips set FLUSH in the rim's upper-outer bevel (the colour reads from any angle, from above most):
    # each the rim's own surface skin inside the slip's footprint, 1.2 mm proud (it follows the rim's curve: an inlay,
    # never a bead); the iron bezel round it is painted (paint_rim: a dark seat line and a lit lip)
    for c_w, ax in inlay_frames():
        glass.add(RimSlip(rim_surf, Ellipsoid(c_w, (INLAY_T, INLAY_B, 0.04), axes=ax), -0.0040, 0.0012), k=0.0)
    part("hat_rim", rim, "ironstone", "bone:x_hat", 1150, 0.5)
    part("hat_inlays", glass, "accent", "bone:x_hat", 420, 0.3)

    def disc_prof(r, z):
        zc, hz, hr, cr = CONE_H - 0.004, 0.011, 0.037, 0.007
        q0 = r - hr + cr
        q1 = np.abs(z - zc) - hz + cr
        return np.hypot(np.maximum(q0, 0), np.maximum(q1, 0)) + np.minimum(np.maximum(q0, q1), 0) - cr

    knob = Sculpt("hat_knob")
    knob.add(HatSheared(Lathe(HAT_C, disc_prof, 0.06, CONE_H - 0.03, CONE_H + 0.02, axes=HAT_AX)), k=0.0)
    # the snuffer hook: ONE thick tapered horn from the apex disc, up and bent forward to a blunt tip over the front
    # slope. From the 52 degree camera the disc and the horn read as one teardrop pointing the way she faces (the
    # earlier thin curl stood off the disc as a detached arc: a 'smile' under a dot)
    h = CONE_H
    stem = [(0.0, 0.0, h), (0.0, 0.0, h + 0.030), (0.0, -0.012, h + 0.052), (0.0, -0.035, h + 0.063),
            (0.0, -0.060, h + 0.059), (0.0, -0.079, h + 0.049)]
    knob.add(Tube([hat_ws(p) for p in stem], [0.0195, 0.0185, 0.017, 0.0152, 0.0138, 0.0125], k=0.01), k=0.014)
    knob.add(Sphere(hat_ws(stem[-1]), 0.0135), k=0.006)
    part("hat_knob", knob, "ironstone", "bone:x_hat", 360, 0.5)

    # ── HEAD + MASK (rigid on the head) ──
    head = Sculpt("head")
    shell = Ellipsoid((0.005, 0.018, 1.612), (0.126, 0.132, 0.158))
    head.add(shell.displaced(lambda P: 0.0025 * np.sin(P[:, 0] * 40.0 + P[:, 2] * 25.0 + 2 * NOISE(P, 5.0))
                             * np.clip((P[:, 1] + 0.02) / 0.06, 0, 1), 0.003), k=0.0)
    head.add(Ellipsoid((0.0, 0.03, 1.50), (0.085, 0.09, 0.07)), k=0.04)                  # skull base into the neck
    part("head", head, "wood_dark", "bone:head", 800)

    # the hat's inner crown: a head band hugging the crown of the head and a thin basket up to the cone's
    # underside (the hat sits on the head, never floats over it; it rolls off with the hat in `death`)
    def basket_prof(r, z):
        a, b = np.array([0.101, -0.014]), np.array([0.074, 0.104])
        d = b - a
        L = float(np.hypot(*d))
        u = np.clip(((r - a[0]) * d[0] + (z - a[1]) * d[1]) / (L * L), 0, 1)
        return np.hypot(r - (a[0] + u * d[0]), z - (a[1] + u * d[1])) - 0.004

    band = Sculpt("hat_band")
    # the basket follows the cone's shear (unsheared, its top ring poked through the back of the oblique cone: the
    # dark arc floating behind the knob that read as a 'smile' / eyebrow from the game camera)
    band.add(HatSheared(Lathe(HAT_C, basket_prof, 0.12, -0.03, 0.13, axes=HAT_AX)), k=0.0)
    band.add(Torus(hat_w((0.0, 0.0, -0.008)), 0.101, 0.0135, axes=HAT_AX).displaced(folds(0.002, 60.0, axis=0), 0.002),
             k=0.006)
    part("hat_band", band, "leather", "bone:x_hat", 300, 0.6)

    mask = Sculpt("mask")
    base = Ellipsoid((0.012, -0.02, 1.585), (0.148, 0.118, 0.178))
    mask.add(base.displaced(grain(0.0012, 140.0), 0.0012), k=0.0)
    mask.inter(HalfSpace((0, -0.035, 1.6), (0, 1, 0), 1.0), k=0.012)                          # the front shell
    mask.inter(HalfSpace((0, 0, 1.70), (0, 0, 1), 1.0), k=0.008)                               # under the brim
    mask.inter(HalfSpace((-0.13, 0, 1.565), (-0.628, 0, -0.778), 1.0), k=0.018)                # jaw (her right)
    mask.inter(HalfSpace((0.155, 0, 1.575), (0.734, 0, -0.679), 1.0), k=0.018)                 # jaw (her left)
    for sx in (-1, 1):                                                                          # cheek planes
        mask.inter(HalfSpace((sx * 0.085, -0.122, 1.56), (sx * 0.62, -0.785, -0.05), 1.0), k=0.03)
    mask.add(RoundBox((0.012, -0.122, 1.652), (0.128, 0.014, 0.013), 0.011, axes=sdf.rot_x(-8)), k=0.016)  # brow
    mask.add(FlatCapsule((0.012, -0.128, 1.648), (0.021, -0.176, 1.533), 0.034, 0.02, 0.006, 0.009,
                         side=(1, 0, 0)), k=0.016)                                             # the beak keel
    # closed lids: carved arcs, high at the outer corners (serene, never hollow)
    for sx in (-1, 1):
        xs = [x - 0.012 for x in EYES[sx][0]]
        zs = EYES[sx][1]
        pts = [on_mask(x + 0.012, z, -0.002) for x, z in zip(xs, zs)]
        mask.sub(Tube(pts, [0.0045, 0.0062, 0.006, 0.0045], k=0.004), k=0.004)
        lid = [on_mask(x + 0.012, z + 0.012, 0.004) for x, z in zip(xs[1:], zs[1:])]
        mask.add(Tube(lid, [0.007, 0.008, 0.006], k=0.006), k=0.008)                          # the lid's swell
        # the carved channel down each cheek to the chin
        ch = [on_mask(sx * 0.128 + 0.012, 1.64, -0.001), on_mask(sx * 0.118 + 0.012, 1.57, -0.001),
              on_mask(sx * 0.075 + 0.02, 1.49, -0.001)]
        mask.sub(Tube(ch, [0.0035, 0.004, 0.003], k=0.003), k=0.003)
    smile = [on_mask(x + 0.012, z, -0.002) for x, z in ((-0.042, 1.512), (-0.015, 1.498), (0.02, 1.497),
                                                         (0.055, 1.506), (0.075, 1.52))]
    mask.sub(Tube(smile, [0.004, 0.0065, 0.007, 0.0055, 0.0035], k=0.004), k=0.004)
    mask.add(Tube([on_mask(x + 0.012, z, 0.002) for x, z in ((-0.03, 1.487), (0.015, 1.481), (0.05, 1.49))],
                  [0.006, 0.008, 0.006], k=0.006), k=0.01)                                    # the lower lip
    part("mask", mask, "wood", "bone:head", 1500, 0.55)

    # ── TORSO (heat weights on the spine, chest, neck, shoulders) ──
    torso = Sculpt("torso")
    torso.add(Ellipsoid((0, 0.005, 0.99), (0.165, 0.118, 0.12)), k=0.0)
    torso.add(Ellipsoid((0, -0.002, 1.11), (0.152, 0.108, 0.10)), k=0.06)
    torso.add(Ellipsoid((0, 0.004, 1.245), (0.185, 0.122, 0.145)), k=0.07)
    torso.add(Ellipsoid((0, 0.012, 1.355), (0.205, 0.105, 0.075)), k=0.06)
    for sx in (-1, 1):
        torso.add(Sphere((sx * 0.215, 0.018, 1.345), 0.074), k=0.05)
    torso.add(Capsule((0, 0.012, 1.37), (0, 0.004, 1.52), 0.054), k=0.04)

    def chest_wraps(P):
        a = (P[:, 0] * 0.8 + P[:, 2]) * 34.0
        b = (-P[:, 0] * 0.9 + P[:, 2]) * 30.0 + 1.7
        m = np.clip((-P[:, 1] - 0.02) / 0.06, 0, 1) * np.clip((P[:, 2] - 1.12) / 0.05, 0, 1) * \
            np.clip((1.40 - P[:, 2]) / 0.04, 0, 1)
        return -0.004 * m * np.maximum(np.abs(np.sin(a)) ** 6, np.abs(np.sin(b)) ** 6)
    torso.ops[0] = ("add", torso.ops[0][1].displaced(chest_wraps, 0.004), 0.0, None)
    part("torso", torso, "leather", ("auto_only", "hips", "spine", "chest", "neck", "shoulder.L", "shoulder.R",
                                      "upper_arm.L", "upper_arm.R"), 1500)

    # felt cowl: the neck roll, the drape over her left shoulder and down her left side, the band across the
    # chest from the brooch, the hood lying on the upper back
    cowl = Sculpt("cowl")
    for sx, zz in ((1, 1.50), (-1, 1.48)):                                            # bunched up beside the jaw
        cowl.add(Ellipsoid((sx * 0.135, 0.005, zz), (0.06, 0.095, 0.07)).displaced(folds(0.005, 30.0, axis=2), 0.005),
                 k=0.04)
    cowl.add(Torus((0.0, 0.012, 1.455), 0.118, 0.056, axes=np.diag([1.0, 1.12, 1.0]) @ sdf.rot_x(12).T,
                   rz=0.058).displaced(folds(0.008, 30.0, axis=0), 0.008), k=0.0)
    cowl.add(Ellipsoid((0.19, -0.005, 1.375), (0.125, 0.128, 0.078), axes=sdf.rot_y(24).T)
             .displaced(folds(0.006, 26.0, axis=1, phase=0.5), 0.006), k=0.05)
    cowl.add(Ellipsoid((0.265, 0.0, 1.29), (0.062, 0.115, 0.10)).displaced(folds(0.008, 24.0, axis=1), 0.008), k=0.05)
    cowl.add(FlatCapsule((-0.085, -0.095, 1.44), (0.20, -0.10, 1.325), 0.060, 0.036, 0.075, 0.04, side=(0, 0, 1))
             .displaced(folds(0.007, 40.0, axis=2, phase=1.1), 0.007), k=0.04)
    cowl.add(Ellipsoid((-0.15, 0.005, 1.445), (0.085, 0.115, 0.055), axes=sdf.rot_y(-20).T), k=0.04)
    hood = Ellipsoid((0.02, 0.13, 1.49), (0.235, 0.09, 0.09))
    cowl.add(hood.displaced(folds(0.01, 22.0, axis=0, phase=0.2), 0.01), k=0.04)
    cowl.add(RoundCone((0.0, 0.155, 1.45), (-0.01, 0.185, 1.37), 0.08, 0.02), k=0.05)
    cowl.sub(Ellipsoid((0.01, 0.10, 1.53), (0.13, 0.06, 0.05)), k=0.03)                    # the hood's mouth
    part("cowl", cowl, "cloth", ("auto_only", "spine", "chest", "neck", "shoulder.L", "shoulder.R"), 1300)

    # the brooch: a carved wooden ring on a flat back plate, its stone (the concept's blue stone) proud of the ring so
    # it reads in the portrait: a matte slate-blue stone, NOT the accent (brief: the rim inlays are the only emissive)
    brooch = Sculpt("brooch")
    bc, bn = BROOCH
    brooch.add(Torus(bc, 0.025, 0.0085, axes=sdf.frame(bn)), k=0.0)
    brooch.add(Ellipsoid(bc - bn * 0.003, (0.024, 0.024, 0.006), axes=sdf.frame(bn)), k=0.004)
    part("brooch", brooch, "wood_dark", "bone:chest", 180, 0.5)
    stone = Sculpt("brooch_glass")
    stone.add(Ellipsoid(bc + bn * 0.006, (0.0165, 0.0165, 0.0095), axes=sdf.frame(bn)), k=0.0)
    part("brooch_glass", stone, "ironstone", "bone:chest", 90, 0.4)

    # strap from the right shoulder down the chest, a square buckle
    straps = Sculpt("straps")
    straps.add(Tube([(-0.135, -0.075, 1.43), (-0.128, -0.118, 1.36), (-0.118, -0.128, 1.27), (-0.10, -0.125, 1.17),
                     (-0.07, -0.12, 1.10)], [0.016, 0.016, 0.016, 0.015, 0.015], k=0.01), k=0.0)
    straps.add(RoundBox((-0.119, -0.138, 1.272), (0.024, 0.007, 0.026), 0.005), k=0.004)
    straps.sub(RoundBox((-0.119, -0.142, 1.272), (0.013, 0.006, 0.015), 0.003), k=0.002)
    part("straps", straps, "leather", ("auto_only", "spine", "chest"), 360, 0.6)

    # ── PAULDRON (right shoulder): three carved wooden lames, each lower one stepped out and down (the concept's
    #    layered plates; painted by paint_pauldron: dark seams, lit arrises, plank lines, rivets) ──
    paul = Sculpt("pauldron")
    # carved wooden lames that decimate cleanly (the thin ellipsoid shells crumpled into spiky facets; solid domes
    # stacked like plates): a domed cap over the shoulder, two conical bands below it (lathed thick capsule profiles,
    # rounded edges), each tucked under the rolled lip of the one above and flaring out below it, all leaning out
    # with the shoulder (PAUL_TILT); seam grooves under the lips, two domed rivets per lame on one line
    def band_prof(b):
        (r0, h0), (r1, h1) = b["top"], b["bot"]
        a, d = np.array([r0, h0]), np.array([r1 - r0, h1 - h0])
        L2 = float(d @ d)

        def prof(r, z):
            u = np.clip(((r - a[0]) * d[0] + (z - a[1]) * d[1]) / L2, 0, 1)
            return np.hypot(r - (a[0] + u * d[0]), z - (a[1] + u * d[1])) - PAUL_T
        return prof
    inner_cut = HalfSpace((-0.175, 0, 1.40), (1, 0, 0.35), 1.0)
    cap = Sculpt("lame0")
    cap.add(Ellipsoid(PAUL_O, PAUL_CAP["rr"], axes=np.stack([PAUL_EX, V3([0, 1.0, 0]), PAUL_UP])), k=0.0)
    cap.inter(HalfSpace(PAUL_O + PAUL_UP * PAUL_CAP["h_cut"], -PAUL_UP, 1.0), k=0.008)
    R0, H0 = PAUL_CAP["lip"]
    cap.add(Torus(PAUL_O + PAUL_UP * H0, R0, PAUL_LIP, axes=PAUL_AX, rz=0.0095), k=0.006)
    cap.inter(inner_cut, k=0.012)
    lames = [cap]
    for i, b in enumerate(PAUL_BANDS):
        L = Sculpt(f"lame{i + 1}")
        L.add(Lathe(PAUL_O, band_prof(b), b["bot"][0] + 0.03, b["bot"][1] - 0.03, b["top"][1] + 0.03, axes=PAUL_AX), k=0.0)
        Rl, Hl = b["lip"]
        L.add(Torus(PAUL_O + PAUL_UP * Hl, Rl, PAUL_LIP + 0.0005, axes=PAUL_AX, rz=0.010), k=0.006)
        L.inter(inner_cut, k=0.012)
        lames.append(L)
    PAUL_LAMES.clear()
    for L in lames:
        bl = sdf.Blend([(op, pr, k_) for op, pr, k_, _ in L.ops])
        PAUL_LAMES.append(bl)
        paul.add(bl, k=0.002)
    for i, hg in enumerate((PAUL_CAP["lip"][1] - 0.016, PAUL_BANDS[0]["lip"][1] - 0.016)):     # seams under the lips
        paul.sub(Torus(PAUL_O + PAUL_UP * hg, paul_band_r(i, hg) + PAUL_T + 0.001, 0.005, axes=PAUL_AX, rz=0.005),
                 k=0.003)
    for rp in paul_rivets():
        paul.add(Sphere(rp, 0.011), k=0.004)
    part("pauldron", paul, "wood_dark", ("dblend", "shoulder.R", "upper_arm.R", (-0.20, 0.012, 1.40),
                                          (-0.75, 0.0, -0.66), 0.02, 0.10), 1250, 0.5)

    # ── BELT, TABARD, TASSETS ──
    belt = Sculpt("belt")
    belt.add(Torus((0, 0.006, 1.06), 0.163, 0.038, axes=np.diag([1.0, 0.163 / 0.122, 1.0]), rz=0.042)
             .displaced(folds(0.004, 50.0, axis=0), 0.004), k=0.0)
    part("belt", belt, "leather", ("auto_only", "hips", "spine"), 520, 0.7)
    # the concept's red-brown leather belt over the dark sash (its own part: painted in its own colour)
    strap = Sculpt("belt_strap")
    strap.add(Torus((0, 0.006, STRAP_Z), 0.172, 0.0145, axes=np.diag([1.0, 0.172 / 0.129, 1.0]), rz=0.019), k=0.0)
    strap.add(RoundBox((-0.052, -0.146, STRAP_Z - 0.004), (0.027, 0.013, 0.023), 0.008), k=0.004)          # the knot
    strap.add(Tube([(-0.06, -0.150, STRAP_Z - 0.014), (-0.072, -0.156, STRAP_Z - 0.06), (-0.082, -0.156, STRAP_Z - 0.105)],
                   [0.012, 0.011, 0.010], k=0.005), k=0.004)                                 # hanging strap
    part("belt_strap", strap, "leather", ("auto_only", "hips", "spine"), 360, 0.6)

    tabard = Sculpt("tabard")
    tb = RoundBox((0.025, -0.152, 0.83), (0.098, 0.011, 0.195), 0.008, axes=sdf.rot_x(-5).T)
    tabard.add(tb.displaced(folds(0.004, 30.0, axis=0, phase=0.4), 0.004), k=0.0)
    tabard.sub(RoundBox((0.025, -0.15, 0.62), (0.03, 0.04, 0.03), 0.004, axes=sdf.rot_y(45)), k=0.006)
    part("tabard", tabard, "leather", ("chain", "tabard", "hips"), 360, 0.7)

    tass = Sculpt("tassets")

    def tasset_prof_factory(r0, r1, z0, z1):
        def prof(r, z):
            t = np.clip((z1 - z) / (z1 - z0), 0, 1)
            rz = r0 + (r1 - r0) * t
            shell = np.abs(r - rz) - 0.008
            return np.maximum(shell, np.maximum(z - z1, z0 - z))
        return prof

    for sx, a0, a1, z0 in ((-1, 25.0, 80.0, 0.745), (1, 30.0, 78.0, 0.80)):
        S = Sculpt("t")
        S.add(Lathe((0.0, 0.0, 0.0), tasset_prof_factory(0.168, 0.205, z0, 1.02), 0.25, z0 - 0.01, 1.03), k=0.0)
        for ang, nsg in ((a0, 1), (a1, -1)):
            a = math.radians(ang)
            d = V3([sx * math.sin(a), -math.cos(a), 0.0])
            nrm = np.cross(d, V3([0, 0, 1.0])) * (sx * nsg)
            S.inter(HalfSpace((0, 0, 0.9), nrm, 1.0), k=0.012)
        tass.add(sdf.Blend([(op, pr, k_) for op, pr, k_, _ in S.ops]).displaced(grain(0.0018, 90.0), 0.002), k=0.0)
        mid = math.radians((a0 + a1) / 2)
        for j, z in enumerate((0.97, 0.89)):
            tass.add(Sphere((sx * math.sin(mid) * 0.18, -math.cos(mid) * 0.18, z - (0.02 if sx > 0 else 0)), 0.011), k=0.003)
    part("tassets", tass, "wood_dark", ("auto_only", "hips", "thigh.L", "thigh.R"), 620, 0.7)

    # ── ARMS ──
    sleeves = Sculpt("sleeves")
    wrapS = Sculpt("forearm_wraps")
    for s in ("L", "R"):
        sleeves.add(FlatCapsule(SH[s] + V3([0, 0, 0.005]), EL[s], 0.072, 0.068, 0.064, 0.060,
                                side=(1, 0, 0)).displaced(folds(0.005, 40.0, axis=2), 0.005), k=0.0)
        fa = FlatCapsule(EL[s] + (WR[s] - EL[s]) * 0.02, WR[s] + FD[s] * 0.005, 0.062, 0.060, 0.050, 0.048,
                         side=(1, 0, 0))
        wrapS.add(fa.displaced(wraps(0.0035, 70.0, EL[s], WR[s] - EL[s]), 0.004), k=0.0)
        # the ragged linen cuff over the wrist
        wrapS.add(RoundCone(WR[s] - FD[s] * 0.012, WR[s] + FD[s] * 0.018, 0.056, 0.054)
                  .displaced(chips(0.004, 40.0), 0.004), k=0.01)
    part("sleeves", sleeves, "under", ("auto_only", "chest", "shoulder.L", "shoulder.R", "upper_arm.L",
                                        "upper_arm.R", "forearm.L", "forearm.R"), 700)
    part("forearm_wraps", wrapS, "cloth2", ("auto_only", "upper_arm.L", "upper_arm.R", "forearm.L", "forearm.R",
                                             "hand.L", "hand.R"), 700)

    # the right fist round the grip (carved wood: palm block, four finger rolls, the thumb across)
    F = hand_frame("R")
    fist = Sculpt("hand_R")
    pc = WR["R"] + FD["R"] * 0.048 + F[2] * 0.006
    fist.add(RoundBox(pc, (0.051, 0.049, 0.031), 0.021, axes=F), k=0.0)
    gax = GRIP_AX
    for i, s_ in enumerate((-0.033, -0.011, 0.011, 0.033)):
        cc = FIST_R + gax * s_ + F[2] * 0.005
        fist.add(Torus(cc, 0.032 - 0.002 * abs(i - 1.5), 0.0155, axes=sdf.frame(gax)), k=0.006)
    th0 = hl("R", (0.04, 0.03, -0.012))
    side_ = unit(F[0] - gax * float(F[0] @ gax))
    th1 = FIST_R + gax * 0.04 + side_ * 0.028
    fist.add(Tube([th0, (th0 + th1) / 2 + F[0] * 0.007, th1], [0.021, 0.0175, 0.015], k=0.006), k=0.012)
    fist.sub(Capsule(FIST_R - gax * 0.07, FIST_R + gax * 0.07, 0.0165), k=0.002)            # the grip's channel
    part("hand_R", fist, "hand_wood", "bone:hand.R", 650, 0.55)

    # the open left hand (the lull hand): palm, four jointed fingers loosely curled, the thumb out
    hand = Sculpt("hand_L")
    FL = hand_frame("L", HD_L)
    HS = 1.30                       # the lull hand: stylised big (brief: hands x1.45 of a human's); fix pass 5: 1.18 ->
    #                                 1.30 and the fingers x1.25 thicker (review: 'thin and spidery, a claw')
    hand.add(RoundBox(hl("L", (0.0, 0.052 * HS, 0.0), y=HD_L), (0.042 * HS, 0.050 * HS, 0.016 * HS), 0.014, axes=FL), k=0.0)
    hand.add(Ellipsoid(hl("L", (0.008, 0.014, -0.004), y=HD_L), (0.038 * HS, 0.03 * HS, 0.022 * HS), axes=FL), k=0.02)
    for fi, (x0, spread, l0, curl) in enumerate(((0.026, 11.0, 0.044, 14.0), (0.009, 3.0, 0.048, 19.0),
                                                  (-0.009, -6.0, 0.045, 25.0), (-0.026, -14.0, 0.036, 33.0))):
        p = hl("L", (x0 * HS, 0.100 * HS, 0.002), y=HD_L)
        d = unit(FL[1] * math.cos(math.radians(spread)) + FL[0] * math.sin(math.radians(spread)))
        pts, rad = [p], [0.0157]
        segs = (l0 * HS, l0 * 0.72 * HS, l0 * 0.55 * HS)
        ang = 0.0
        for k_, L in enumerate(segs):
            ang += math.radians(curl * (0.7 + 0.3 * k_))
            dd = unit(d * math.cos(ang) - FL[2] * math.sin(ang))
            p = p + dd * L
            pts.append(p)
            rad.append(0.0145 - 0.0021 * (k_ + 1))
        hand.add(Tube(pts, rad, k=0.004), k=0.006)
        for q in pts[1:-1]:
            hand.add(Sphere(q, rad[1] * 1.06), k=0.003)                                     # the carved joints
    tb0 = hl("L", (0.040, 0.024, -0.008), y=HD_L)
    tb1 = tb0 + unit(FL[0] * 0.75 + FL[1] * 0.55 - FL[2] * 0.35) * 0.052
    tb2 = tb1 + unit(FL[0] * 0.35 + FL[1] * 0.85 - FL[2] * 0.4) * 0.04
    hand.add(Tube([tb0, tb1, tb2], [0.020, 0.0165, 0.0128], k=0.005), k=0.01)
    part("hand_L", hand, "hand_wood", "bone:hand.L", 850, 0.5)

    # ── LEGS ──
    trousers = Sculpt("trousers")
    trousers.add(Ellipsoid((0.0, 0.02, 0.905), (0.185, 0.125, 0.115)), k=0.0)
    for s in ("L", "R"):
        sx = 1.0 if s == "L" else -1.0
        trousers.add(FlatCapsule(HIP[s] + V3([sx * 0.01, 0.0, 0.03]), KNEE[s] + V3([0, -0.005, 0.03]),
                                 0.096, 0.104, 0.094, 0.098, side=(1, 0, 0))
                     .displaced(folds(0.008, 24.0, axis=2, phase=sx), 0.008), k=0.05)
        trousers.add(Ellipsoid(KNEE[s] + V3([sx * 0.006, 0.0, -0.022]), (0.098, 0.098, 0.068))
                     .displaced(folds(0.009, 30.0, axis=0, phase=0.7), 0.009), k=0.035)    # the gathered cuff
    part("trousers", trousers, "under", ("auto_only", "hips", "spine", "thigh.L", "thigh.R", "shin.L", "shin.R"), 1150)

    legw = Sculpt("legwraps")
    boots = Sculpt("boots")
    for s in ("L", "R"):
        sx = 1.0 if s == "L" else -1.0
        top = KNEE[s] + (ANK[s] - KNEE[s]) * 0.08
        bot = ANK[s] + V3([0, 0, 0.09])
        legw.add(FlatCapsule(top, bot, 0.076, 0.076, 0.062, 0.062, side=(1, 0, 0))
                 .displaced(wraps(0.004, 55.0, top, bot - top, slant=1.0), 0.004), k=0.0)
        a = math.radians(TOE_OUT)
        fwd = V3([sx * math.sin(a), -math.cos(a), 0.0])
        up = V3([0, 0, 1.0])
        ax = np.stack([unit(np.cross(fwd, up)), fwd, up])
        A0 = V3([ANK[s][0], ANK[s][1], 0.0])
        # the soft waxed-leather upper (the concept's low boot): a last narrowing to a low rounded toe, the instep
        # rising into the shaft, the heel cup; it sits ON the sole (a sole line, not a rounded sock)
        boots.add(RoundBox(A0 + fwd * 0.040 + up * 0.050, (0.047, 0.108, 0.031), 0.022, axes=ax), k=0.0)
        boots.add(Ellipsoid(A0 + fwd * 0.128 + up * 0.040, (0.043, 0.060, 0.027), axes=ax), k=0.03)        # toe box
        boots.add(Ellipsoid(A0 + fwd * 0.015 + up * 0.088, (0.050, 0.075, 0.050), axes=ax), k=0.035)       # instep
        boots.add(Ellipsoid(A0 - fwd * 0.052 + up * 0.062, (0.045, 0.040, 0.046), axes=ax), k=0.025)       # heel cup
        # the sole: a flat 1.6 cm slab on the footprint, 4-6 mm proud of the upper all round (toe spring rounded)
        sole = Sculpt("sole")
        sole.add(Ellipsoid(A0 + fwd * 0.050 + up * 0.009, (0.054, 0.150, 0.08), axes=ax), k=0.0)
        sole.inter(HalfSpace((0, 0, 0.016), (0, 0, 1), 1.0), k=0.004)
        boots.add(sdf.Blend([(op, pr, k_) for op, pr, k_, _ in sole.ops]), k=0.003)
        # the low wedge heel under the heel cup (2.8 cm at the back, tapering into the sole under the arch)
        boots.add(RoundBox(A0 - fwd * 0.058 + up * 0.016, (0.045, 0.040, 0.016), 0.007,
                           axes=np.stack([ax[0], unit(fwd + up * 0.18), unit(up - fwd * 0.18)])), k=0.004)
        # the soft shaft: hugging the ankle, slouching wider at the top in a few wrinkles (fix pass 5: the straight
        # tube read shapeless in the splash)
        boots.add(FlatCapsule(V3([ANK[s][0], ANK[s][1], 0.08]), V3([ANK[s][0], ANK[s][1] - 0.004, 0.215]),
                              0.055, 0.060, 0.069, 0.072, side=(1, 0, 0))
                  .displaced(folds(0.0035, 75.0, axis=2, phase=sx * 0.8), 0.004), k=0.04)
        boots.add(Torus(V3([ANK[s][0], ANK[s][1] - 0.004, 0.205]), 0.064, 0.012, axes=np.diag([1, 1.06, 1]))
                  .displaced(chips(0.004, 40.0), 0.004), k=0.008)                          # the turned cuff
    boots.inter(HalfSpace((0, 0, 0.0), (0, 0, -1), 2.0), k=0.0)
    part("legwraps", legw, "under", ("auto_only", "thigh.L", "thigh.R", "shin.L", "shin.R", "foot.L", "foot.R"), 750)
    part("boots", boots, "leather", ("auto_only", "shin.L", "shin.R", "foot.L", "foot.R", "toe.L", "toe.R"), 900)

    # ── CAPE (the x_cape chain) ──
    cape = Sculpt("cape")
    cape.add(CAPE, k=0.0)
    part("cape", cape, "cloth", ("chain", "cape", "chest"), 1650, 0.85)

    # ── THE SNUFFER BLADE (prop.R) ──
    grip = Sculpt("grip")
    grip.add(Capsule(POMMEL + GRIP_AX * 0.01, GUARD, 0.0165), k=0.0)
    grip.add(RoundBox(POMMEL, (0.033, 0.019, 0.016), 0.006, axes=sdf.frame(GRIP_AX, (1, 0, 0))), k=0.006)
    grip.add(RoundCone(GUARD - GRIP_AX * 0.012, GUARD + GRIP_AX * 0.014, 0.026, 0.022), k=0.004)
    part("grip", grip, "wood_dark", "bone:prop.R", 260, 0.5)
    blade = Sculpt("blade")
    blade.add(CRES.displaced(chips(0.0015, 25.0), 0.0015), k=0.0)
    part("blade", blade, "ironstone", "bone:prop.R", 480, 0.45)
    return out


def skin_extras(extra: dict) -> list:
    return []


def extra_materials(ctx) -> dict:
    """hand_wood: the carved hands (the concept's mid-brown wood; a skin's pale mask leaves them as they are)"""
    pal = dict(materials.BIBLE_PALETTE, **PALETTE)
    pal.update(ctx.palette)
    pal.setdefault("hand_wood", pal["wood"])
    return {"hand_wood": materials.carved_wood("hand_wood", pal, "hand_wood", ctx.gradient)}


HAT_UVW = (2.0, 0.3)      # fix pass 5: texel weights of the lacquered top and the underside (the underside, never seen
#                           by the game camera, took more atlas than the painted top: its brushwork blurred)


def cone_low(N=64, K=6, K_in=4, r0=0.03, which="all"):
    """the hat's game mesh, built clean (a decimated voxel cone pinched into dents that the bake turned into dark
    smudges on the lacquer): outer rings on z = h (1 - r / R), the underside offset by the shell thickness, the brim
    edge and the apex closed (under the knob's disc). which: "outer" (the lacquered top), "inner" (the underside +
    the brim edge + the apex strip), "all". Faces wound outward. Returns (verts world, quads)."""
    s = CONE_H / BRIM_R
    nrm = np.array([s, 1.0]) / math.hypot(s, 1.0)              # the outer line's normal in (r, z)
    phis = np.linspace(0, 2 * math.pi, N, endpoint=False)
    rings = []
    R_lo = BRIM_R - 0.008                                        # the edge buried inside the iron rim (no lacquer fringe)
    for k in range(K + 1):
        r = r0 + (R_lo - r0) * (k / K) ** 0.85
        rings.append((r, CONE_H * (1 - r / BRIM_R)))
    inner = []
    for k in range(K_in + 1):
        r = r0 + (R_lo - r0) * (k / K_in)
        ro, zo = r, CONE_H * (1 - r / BRIM_R)
        inner.append((ro - nrm[0] * CONE_T, zo - nrm[1] * CONE_T))
    if which == "outer":
        prof, closed = rings, False
    elif which == "inner":
        prof, closed = [rings[-1]] + inner[::-1] + [rings[0]], False
    else:
        prof, closed = rings + inner[::-1], True                 # outer apex -> brim, then inner brim -> apex
    V, F = [], []
    for (r, z) in prof:
        for ph in phis:
            V.append(hat_ws((r * math.sin(ph), -r * math.cos(ph), z)))
    nr = len(prof)
    for i in range(nr if closed else nr - 1):                    # (closed: the inner apex -> outer apex strip wraps)
        j = (i + 1) % nr
        for a in range(N):
            b = (a + 1) % N
            F.append((i * N + a, j * N + a, j * N + b, i * N + b))   # outward (apex -> brim x phi: up on the top)
    return np.asarray(V), np.asarray(F)


def model(ctx) -> list:
    from common import mesh
    _SKIN.clear()
    _SKIN.update(ctx.skin or {})
    P = []
    extra = (ctx.skin or {}).get("extra") or {}
    for name, S, vs, role, bind, tris in sculpts() + skin_extras(extra):
        v, q = S.mesh(VOXEL * vs)
        ob = sdf.to_object(f"{name}_high", v, q, ctx.col)
        ob.data.materials.append(ctx.mats[role])
        if name == "hat_cone":
            # the lacquered top and the underside as two parts (their own texel weights, HAT_UVW), one sculpt
            for nm_, which, uvw in ((name, "outer", HAT_UVW[0]), ("hat_under", "inner", HAT_UVW[1])):
                lv, lq = cone_low(which=which)
                low = sdf.to_object(f"{nm_}_low", lv, lq, ctx.col)
                low.data.materials.append(ctx.mats[role])
                mesh.cleanup(low, merge=1e-5, recalc=False, loose=False)
                P.append(fighter.Part(nm_, high=ob, low=low, bind=bind, uv_weight=uvw))
            continue
        P.append(fighter.Part(name, high=ob, tris=tris, bind=bind))
    return P


# ── rig extras: the cape and tabard chains, VFX sockets, prop.R along the blade ──────────────────────────────
CAPE_CHAIN = [(0.0, 0.19, 1.42), (0.0, 0.29, 0.96), (0.0, 0.39, 0.48)]
TABARD_CHAIN = [(0.025, -0.162, 1.02), (0.025, -0.172, 0.63)]
BLADE_DIR = unit(BLADE_TIP - FIST_R)            # prop.R +Y: the held item's main axis (fist -> blade tip)


def rig_extras(ctx) -> None:
    from mathutils import Vector
    info = ctx.info
    arm = info.armature
    ctx.chains["cape"] = rig.add_chain(info, "cape", "chest", CAPE_CHAIN)
    ctx.chains["tabard"] = rig.add_chain(info, "tabard", "hips", TABARD_CHAIN)
    from common import scene
    scene.select_only([arm], arm)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    eb["prop.R"].head = Vector(tuple(FIST_R))
    eb["prop.R"].tail = Vector(tuple(FIST_R + BLADE_DIR * 0.12))
    eb["prop.R"].align_roll(Vector((0.0, 0.0, 1.0)))
    FL = hand_frame("L", HD_L)
    palm = hl("L", (0.0, 0.06, -0.01), y=HD_L)
    eb["prop.L"].head = Vector(tuple(palm))
    eb["prop.L"].tail = Vector(tuple(palm + HD_L * 0.12))
    eb["prop.L"].align_roll(Vector(tuple(FL[2])))
    bpy.ops.object.mode_set(mode="OBJECT")
    for b in arm.data.bones:
        info.lengths[b.name] = b.length
    _add_hat_bone(ctx)
    front = hat_w(rim_angle_dir(0.0) * (BRIM_R + 0.01))
    rig.add_socket(info, "x_hat_rim", "x_hat", tuple(front), tuple(HAT_UP * 0.08), z_hint=(0, -1, 0))
    tip = hl("L", (0.0, 0.237, -0.022), y=HD_L)
    rig.add_socket(info, "x_dart_hand", "hand.L", tuple(tip), tuple(HD_L * 0.06), z_hint=(0, -1, 0))
    rig.add_socket(info, "x_blade_tip", "prop.R", tuple(BLADE_TIP), tuple(BLADE_DIR * 0.06), z_hint=(0, 0, 1))


# ── the hat's own bone: rigid on the head in every clip; in `death` it rolls off and lies flat on the ground beside
#    her. One bone, rotation only (the exported clips carry rotations): its pivot is SOLVED so that the one rotation
#    that lays the hat flat at HAT_LAND (beside her head in the final death pose) is a pure rotation about it ─────
HAT_DEATH: dict = {}
HAT_LAND = (-0.50, 0.30)          # the landed hat's centre relative to the final head position (x, y), m
HAT_LAND_Z = 0.034                # brim plane height when lying flat (the rim's underside on the ground)


def _add_hat_bone(ctx) -> None:
    from mathutils import Matrix, Quaternion, Vector
    info = ctx.info
    arm = info.armature
    HAT_DEATH.clear()
    skel = anim.Skeleton(arm)
    pf = anim.resolve(skel, clip_overrides(ctx)["death"].sample(1.0))
    M = skel.fk(pf)
    carry = M["head"] @ skel.rest["head"].inverted()            # rest head-attached points -> the final pose
    Rc = carry.to_3x3() @ Matrix(HAT_R.tolist())                 # the carried hat's axes (columns) in world
    cc = carry @ Vector(tuple(HAT_C))
    hf = M["head"].translation
    best = None
    for dx in np.linspace(-0.08, 0.08, 9):
        for dy in np.linspace(-0.08, 0.08, 9):
            c_des = Vector((hf.x + HAT_LAND[0] + dx, hf.y + HAT_LAND[1] + dy, HAT_LAND_Z))
            for psi in range(0, 360, 2):
                Rd = Matrix.Rotation(math.radians(psi), 3, "Z")
                RD = Rd @ Rc.inverted()
                q = RD.to_quaternion()
                a = q.axis
                tD = c_des - RD @ cc
                res = abs(tD.dot(a)) + 0.05 * math.hypot(dx, dy)
                if best is None or res < best[0]:
                    best = (res, RD, tD, c_des, psi)
    res, RD, tD, c_des, psi = best
    A = np.eye(3) - np.array(RD)
    P, *_ = np.linalg.lstsq(A, np.array(tD), rcond=None)
    # the solution line runs along the rotation axis: take its point nearest the carried hat centre
    ax = np.array(RD.to_quaternion().axis)
    P = P + ax * float(np.dot(np.array(cc) - P, ax))
    P_rest = carry.inverted() @ Vector(tuple(P))
    from common import scene
    scene.select_only([arm], arm)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    b = eb.new("x_hat")
    b.head = P_rest
    b.tail = P_rest + Vector(tuple(HAT_UP * 0.10))
    b.align_roll(Vector((0.0, -1.0, 0.0)))
    b.parent = eb["head"]
    b.use_deform = True
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.pose.bones["x_hat"].rotation_mode = "XYZ"
    info.lengths["x_hat"] = arm.data.bones["x_hat"].length
    Br = arm.data.bones["x_hat"].matrix_local.to_3x3()
    Bf = carry.to_3x3() @ Br
    HAT_DEATH["q"] = (Bf.inverted() @ RD @ Bf).to_quaternion()
    print(f"nurrow: x_hat pivot {tuple(round(v, 3) for v in P_rest)} (rest), lands at "
          f"{tuple(round(v, 3) for v in c_des)} yaw {psi}, axis residual {res:.4f} m, swing "
          f"{math.degrees(HAT_DEATH['q'].angle):.0f} deg")
    _hat_path(np.array(P_rest), np.array(Br))


def _hat_path(Pv, Br3):
    """the roll-off path (head space: the head never moves relative to its own hat bone): a slerp straight to the
    landing rotation swings the cone through the head mid-fall (seen at death 0.57); a LIFT first (a rotation about
    the pivot that tips the hat up off the crown), then on to the landing. Searched for the most clearance of the
    cone and rim over the head and the mask (ellipsoid level, > 1 = outside)"""
    from mathutils import Matrix, Quaternion
    qL = HAT_DEATH["q"]
    to_rest = lambda q: Br3 @ np.array(q.to_matrix()) @ Br3.T            # noqa: E731  bone-local -> rest frame
    to_loc = lambda W: Matrix((Br3.T @ W @ Br3).tolist()).to_quaternion()  # noqa: E731
    X = []
    for ph in np.linspace(0, 2 * math.pi, 28, endpoint=False):
        for rf in (0.3, 0.55, 0.8, 1.0):
            r = BRIM_R * rf
            X.append(hat_ws((r * math.sin(ph), -r * math.cos(ph), CONE_H * (1 - rf) - (CONE_T if rf < 1 else 0))))
        X.append(hat_w(rim_angle_dir(math.degrees(ph)) * (BRIM_R + 0.01) + V3([0, 0, -0.02])))
    X = np.array(X) - Pv
    ells = [(V3([0.005, 0.018, 1.612]), V3([0.126, 0.132, 0.158]) * 1.04),
            (V3([0.012, -0.02, 1.585]), V3([0.148, 0.118, 0.178]) * 1.04)]

    def level(W):
        Y = Pv + X @ W.T
        return min(float(np.min(np.linalg.norm((Y - c) / r, axis=1))) for c, r in ells)

    def path_clear(q1, n1=8, n2=18):
        lo = 1e9
        for k in range(1, n1 + 1):
            lo = min(lo, level(to_rest(Quaternion().slerp(q1, k / n1))))
        for k in range(1, n2 + 1):
            lo = min(lo, level(to_rest(q1.slerp(qL, k / n2))))
        return lo
    direct = path_clear(Quaternion(), 1, 26)
    best = (direct, None)
    axes = [V3(a) for a in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (1, 1, 0), (1, -1, 0), (-1, 1, 0), (-1, -1, 0),
                            (1, 0, 1), (-1, 0, 1), (0, 1, 1), (0, -1, 1))]
    for a in axes:
        a = unit(a)
        for deg in (15, 25, 35, 45, 60, 75, 90):
            W1 = np.array(Matrix.Rotation(math.radians(deg), 3, tuple(a)))
            q1 = to_loc(W1)
            c = path_clear(q1)
            if c > best[0] + 1e-3:
                best = (c, q1, tuple(a), deg)
    if best[1] is not None:
        HAT_DEATH["q1"] = best[1]
        print(f"nurrow: hat roll-off lift about {tuple(round(v, 2) for v in best[2])} by {best[3]} deg: head "
              f"clearance {best[0]:.2f} (straight slerp {direct:.2f}; > 1 = clear)")
    else:
        print(f"nurrow: hat roll-off straight slerp clearance {direct:.2f}")


def hat_roll(t: float):
    """x_hat's local rotation (deg XYZ) at death time t: on the head until she tips over, then rolling off"""
    from mathutils import Quaternion
    q = HAT_DEATH.get("q")
    if q is None:
        return None
    w = _ss(0.50, 0.80, t)
    w = w - 0.05 * math.sin(math.pi * _ss(0.80, 0.92, t)) * (t > 0.80)       # a small bounce as it lands
    w = float(min(1.0, max(0.0, w)))
    q1 = HAT_DEATH.get("q1")
    if q1 is None:
        qq = Quaternion().slerp(q, w)
    elif w < 0.3:                                                             # lifted off the crown first
        qq = Quaternion().slerp(q1, w / 0.3)
    else:
        qq = q1.slerp(q, (w - 0.3) / 0.7)
    return tuple(math.degrees(a) for a in qq.to_euler("XYZ"))


def chain_config(ctx) -> list:
    """the cape: a heavy felt (low stiffness, gravity-led, a run lifts it back through the poses' `cape_drive`);
    the tabard pushed forward by whichever thigh flexes"""
    def cape_drive(pose):
        return pose.get("cape_drive", (0.0, 0.0, 0.0))[0]

    def tabard_drive(pose):
        fl = max(pose.get("thigh.L", (0.0,))[0], pose.get("thigh.R", (0.0,))[0], 0.0)
        return 0.85 * fl
    # fix pass 5: gravity 0.7 -> 0.5 (in the lunges the gravity-led lower bone hung the U-shaped felt straight down
    # round her legs: a rounded sack from behind; now it streams back off the pitched torso)
    out = [anim.ChainCfg(ctx.chains["cape"], gravity=0.5, stiffness=140.0, damping=23.0, inertia=0.18,
                         drive=cape_drive, limit=(-44.0, 30.0), floor=0.03),
           anim.ChainCfg(ctx.chains["tabard"], gravity=0.85, stiffness=150.0, damping=16.0, inertia=0.6,
                         drive=tabard_drive, limit=(-8.0, 80.0), floor=0.03)]
    return out


# ── the pipeline wraps (common/ is shared: these live here and install only for this build) ────────────────
def _install_bind() -> None:
    """a Part bind ("auto_only", bone, ...) is the pipeline's heat-weight bind (mesh.bind_auto) restricted to
    those bones (the cowl never takes an arm's weights, the trousers never the spine's ribs)"""
    from common import mesh, pipeline
    orig = pipeline.bind_part
    if getattr(orig, "_nurrow", False):
        return

    def bind_part(ctx, part, obj, body_low=None):
        b = part.bind
        if isinstance(b, tuple) and b and b[0] == "auto_only":
            arm = ctx.info.armature
            keep = set(b[1:])
            return mesh.bind_auto(obj, arm, exclude=tuple(x.name for x in arm.data.bones if x.name not in keep))
        return orig(ctx, part, obj, body_low)
    bind_part._nurrow = True
    pipeline.bind_part = bind_part


# ── projection paint: Nurrow's wrap of common/hifi/project.paint (installed for this build only) ─────────────
# Changes to the shared pass:
#  * plate pixels outside the painted figure (the backdrop between the legs, beside the arms, under the cape
#    points) are never paint: every part there fills from its own nearest painted pixels (no pale blobs where a
#    model edge overhangs the painting);
#  * the painted BLADE owns its pixels on the front plate (the cape lining and trousers behind a few cm of misfit
#    never take its dark iron); the blade's both faces take the painted blade (its back is hidden from behind);
#  * sideways texels sample their own part's paint SIDE_INSET inside the silhouette (no outline streaks);
#  * the HAT is painted, not projected: the concept's lacquered ochre in its key light (lit front-left), radial
#    brushed lacquer strokes and slat lines, a warm shadow under the rim, the dark inside; the iron rim and the
#    snuffer knob in matte painted ironstone (chipped pale arrises, dark undersides);
#  * the cape's stray dark texels (trousers seen through the painted slits) take the felt round them;
#  * a tone pass per part toward the concept's material colours under the game light (TONE).
KEY = unit((-0.60, -0.50, 0.62))          # the concept's key light (front-left, high): her right side lit
SIDE_INSET = 0.04
# the concept's lacquer (front: pale gold lit, ochre mid, a warm shade toward her left and the back). The hue sits in
# the reserved Dusk-marigold band (25-50 deg), so every step is held at or under 40 % saturation (HSV; the bible and
# art/README: team hues stay out of large albedo areas above 40 %): an ochre between the brief's pale #DCCDAE and the
# concept's gold, its value kept off cream (a 32 % ramp at L* 80+ read bone-white in the QA). The underside steps
# too (hue 30, 30-36 %).
# fix pass 3: the ramp walks the concept's own hues (warm ochre 37 in the shade, gold 44-45 in the light: the
# concept's #DFC37B / #FCDF8C) with EVERY step at the 40 % cap (the lit steps were 32-37 %, which the game's tone
# map drained to cream); L* 52-84, the baked shading compressed (the game lights it)
# fix pass 5: the ramp a step deeper (hue 30 -> 46, every step at the cap: L* 40-83; the splash's sky light took the
#   L* 84-86 lit steps to a cream L* 92 with no structure left; lineup f0 top 75.8 -> the room for it)
#   and walked by the brushwork (_lacquer): the flat 0.46 + 0.48 t fill read as a cream plastic lampshade
# polish (value probe with the game's character light, rift/bridge/fray: the hat at screen L* 83-87, p25-p75 within
#   1.6 L*: the lacquer's red channel sat in the tone map's highlight shoulder, so the brushwork flattened into a cream
#   fill; nurrow top-25 85.8-86.8, above the token band's 85): the lit end of the ramp ~4 L* down (mid 66.8 -> 65,
#   lit 77.7 -> 74, hi 83.4 -> 79.5; the shade end kept) and the gores' spread up (0.11 -> 0.15)
HAT_COLS = {"deep": "#705A43", "shade": "#967C5A", "mid": "#B59A6C", "lit": "#CBB47A", "hi": "#D7C486",
            "under": "#8F6F56", "under_deep": "#47382C"}    # the underside: the concept's warm ochre-brown lacquer
#                                                        (its back view, L* 36-53), darker toward the crown
IRON = {"base": "#3D373E", "shade": "#242026", "lit": "#5F5862", "chip": "#8A818C"}
# the hat's rim and knob: a clean dark ironstone ring (the splash's sky lit the old chips and lit bevel frosty white)
RIM_IRON = {"base": "#37323A", "shade": "#201C22", "lit": "#4C4650", "chip": "#5A535D"}
BLADE_OWNER = "blade"
# stray dark / saturated texels (trousers seen through the painted slits, shadow notches): (min lum ratio, max sat)
DESPECKLE = {"cape": ((0.66, 0.34), (0.45, 1.0)), "cowl": ((0.55, 0.36), (0.5, 1.0)), "trousers": ((0.5, 0.6), (0.5, 0.6))}
# the felt and the legs lighter than the concept's back view (the bible's middle and feet bands; lineup_qa build 16:
# top 68.3 / mid 48.5 / feet 17.1 -> the hat ramp +3 L*, the wraps and boots x1.5-1.7 in linear light, umber)
TONE = {"cape": 3.0, "cowl": 1.6, "sleeves": 1.15}      # fix pass 5: cape 2.7 -> 3.0 (the side / back facings' middle
#                                                          band); the tabard takes LEG_TARGET (it read pale beige)
UMBER: dict = {}          # (fix pass 3: the legs take LEG_TARGET, the boots are painted)
#                                                                                                    (luminance kept)
_PAINT0 = {}


def _hexs(h):
    from common import scene
    return np.asarray(scene.hex_srgb(h), dtype=np.float32)


def _ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _mix(a, b, t):
    t = np.asarray(t, dtype=np.float32)[..., None]
    return a * (1 - t) + b * t


def _lum(c):
    return c @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


# the skins' lacquer (brief §9; no large area lighter than L* 86): Noon Fair's pale chalky ochre ground; Shadeprint's
# pale lavender-chalk paper ground under its ink crown (fix pass 5)
HAT_SKIN = {"nurrow_noon_fair": {"deep": "#988670", "shade": "#B3A287", "mid": "#CABBA0", "lit": "#DCCEB6", "hi": "#E2D6C2",
                                 "under": "#8F7F6D", "under_deep": "#4A4138"},
            "nurrow_shadeprint": {"deep": "#9E9AAD", "shade": "#AFABBE", "mid": "#C0BCCC", "lit": "#CFCCD9", "hi": "#D8D5DE",
                                  "under": "#2B2A33", "under_deep": "#1A191F"}}
MOTH = ("#B48AA6", "#8A6680", "#E2D6C3")       # Noon Fair's lacquer moths: rose-lilac, its dark vein, a chalk dot
INK = "#2B2A33"

# ── the lacquer's brushwork (fix pass 5; review: 'an unpainted flat fill: a cream plastic lampshade'). The concept's
#    hat is a lit-to-shadow ochre gradient over faint radial gores and radial lacquer strokes, a fine painted line
#    near the rim; here, on every skin's ground: 16 irregular gores (each its own value, faceted toward the light, a
#    dark seam with a lit lip), long radial brush strokes (broad + hair, starting and stopping), the painted line at
#    r 0.875, a smoky crown round the knob (the snuffer's soot, streaking down the slope), worn chips along the brim,
#    a few pale scratches and patches of hairline crackle (as Marund's painted stone) ──
HAT_NP = 16
_HR = np.random.RandomState(29)
HAT_EDGES = np.sort((np.arange(HAT_NP) + _HR.uniform(-0.28, 0.28, HAT_NP)) * 2 * math.pi / HAT_NP - math.pi)
HAT_OFF = _HR.uniform(-1.0, 1.0, HAT_NP)
HAT_OFF2 = _HR.uniform(-1.0, 1.0, HAT_NP)
# scratches: (r0, phi0 deg, length m, heading deg relative to the radial, bend)
HAT_SCRATCH = ((0.62, -128.0, 0.07, 64.0, 0.4), (0.80, -64.0, 0.05, -50.0, -0.6), (0.71, 22.0, 0.06, 80.0, 0.3),
               (0.88, 104.0, 0.045, -70.0, 0.5), (0.55, 158.0, 0.05, 40.0, -0.4), (0.84, -170.0, 0.04, 88.0, 0.2),
               (0.47, 72.0, 0.035, -30.0, 0.5))


def _polyline_dist(X, pts):
    """distance from X (n, 2) to a polyline, the arc-length parameter (0..1) of the nearest point, the tangent there"""
    pts = np.asarray(pts, dtype=np.float64)
    seg = pts[1:] - pts[:-1]
    L = np.linalg.norm(seg, axis=1)
    cum = np.concatenate([[0.0], np.cumsum(L)])
    best = np.full(len(X), 1e9)
    par = np.zeros(len(X))
    tan = np.zeros((len(X), 2))
    for k in range(len(seg)):
        d = X - pts[k]
        t = np.clip((d @ seg[k]) / (L[k] ** 2), 0, 1)
        q = d - t[:, None] * seg[k]
        dist = np.linalg.norm(q, axis=1)
        upd = dist < best
        best = np.where(upd, dist, best)
        par = np.where(upd, (cum[k] + t * L[k]) / cum[-1], par)
        tan[upd] = seg[k] / L[k]
    return best, par, tan, cum[-1]


def _hat_frame(p):
    """upright-cone local point q, normalised radius r (1 = the brim), angle phi (0 = the front, + her left)"""
    q = hat_unshear(hat_local(p))
    r = np.hypot(q[:, 0], q[:, 1]) / BRIM_R
    phi = np.arctan2(q[:, 0], -q[:, 1])
    return q, r, phi


def _streaks(phi, r, a, b, off=0.0):
    """noise constant along the slope (radial brush strokes), varying round the cone"""
    return NOISE(np.stack([np.cos(phi) * a + off, np.sin(phi) * a, r * b], 1), 1.0)


def _lacquer(p, n, q, r, phi):
    """the shared brushwork: v (0..1, the ramp index) plus the masks a skin reuses (seam, line, soot, chip, crack,
    scratch, the stroke field)"""
    lam = np.clip(n @ KEY, 0.0, 1.0)
    t = np.clip((lam - 0.25) / 0.62, 0.0, 1.0)
    E = np.concatenate([HAT_EDGES, [HAT_EDGES[0] + 2 * math.pi]])
    ph = np.where(phi < HAT_EDGES[0], phi + 2 * math.pi, phi)
    k = np.clip(np.searchsorted(E, ph, side="right") - 1, 0, HAT_NP - 1)
    wd = E[k + 1] - E[k]
    u = (ph - E[k]) / wd
    arc = np.minimum(u, 1 - u) * wd * np.maximum(r, 1e-3) * BRIM_R          # metres to the nearest seam
    fade = _ss(0.10, 0.26, r)
    seam = _ss(0.0024, 0.0008, arc) * fade
    pool = _ss(0.012, 0.002, arc) * fade                                   # the lacquer pooled along each seam
    lip = _ss(0.0045, 0.0028, u * wd * r * BRIM_R) * (1 - _ss(0.0028, 0.0018, u * wd * r * BRIM_R)) * fade
    broad = _streaks(phi, r, 7.5, 2.2) * (0.5 + 0.5 * _streaks(phi, r, 4.0, 5.0, 31.0)) \
        + 0.5 * _streaks(phi, r, 16.0, 3.0, 7.0) * np.clip(0.3 + _streaks(phi, r, 5.0, 6.0, 13.0), 0, 1)
    hair = _streaks(phi, r, 58.0, 2.0, 11.0)
    mott = NOISE.fbm(p, 7.0, 3)
    # (f5-2: bolder: the f5-1 strokes vanished in the splash's sky light and the 2 mm texels)
    # (f5-3: the strokes +-3.5 L* still vanished in the splash's sky light -> +-6; the gores +-4.5)
    v = 0.36 + 0.56 * t
    v = v + 0.15 * HAT_OFF[k] + 0.08 * (u - 0.5) * fade
    v = v + 0.30 * broad + 0.08 * hair + 0.05 * mott + 0.07 * NOISE.fbm(p, 2.5, 2, offset=(9.0, 4.0, 1.0))
    v = v + 0.04 * _ss(0.0, 0.3, r) * (1 - _ss(0.3, 0.55, r))
    v = v - 0.12 * seam + 0.06 * lip - 0.06 * pool
    rl = r + 0.004 * _streaks(phi, r, 9.0, 1.0, 5.0)
    line = _ss(0.0050, 0.0020, np.abs(rl - 0.875) * BRIM_R)
    line_lit = _ss(0.0035, 0.0012, np.abs(rl - 0.887) * BRIM_R)
    v = v - 0.26 * line + 0.07 * line_lit
    v = v - 0.10 * _ss(0.89, 1.0, r)                                        # the brim's lower band in its shade
    soot = _ss(0.30, 0.07, r + 0.06 * (0.5 + _streaks(phi, r, 6.0, 2.0, 3.0)) * _ss(0.05, 0.25, r))
    v = v - 0.16 * soot
    crack_patch = _ss(0.12, 0.32, NOISE.fbm(p, 4.5, 2, offset=(3.0, 1.0, 7.0)))
    crack = np.clip((NOISE.ridged(p, 55.0, 2) - 0.86) / 0.10, 0, 1) * crack_patch * _ss(0.2, 0.35, r)
    v = v - 0.13 * crack
    chip = np.clip((NOISE(p, 85.0, (5.0, 2.0, 1.0)) - 0.30) / 0.12, 0, 1) * _ss(0.905, 0.94, r) \
        * _ss(0.0, 0.25, NOISE(p, 12.0, (1.0, 9.0, 2.0)))
    X = q[:, :2]
    scr = np.zeros(len(p))
    for (r0, ph0, L, hd, bend) in HAT_SCRATCH:
        a0 = math.radians(ph0)
        c0 = np.array([math.sin(a0), -math.cos(a0)]) * r0 * BRIM_R
        rad = np.array([math.sin(a0), -math.cos(a0)])
        tg = np.array([math.cos(a0), math.sin(a0)])
        h = math.radians(hd)
        d0 = rad * math.cos(h) + tg * math.sin(h)
        nn = np.array([-d0[1], d0[0]])
        pts = [c0 + d0 * L * s_ + nn * bend * L * 0.25 * math.sin(math.pi * s_) for s_ in np.linspace(0, 1, 6)]
        near = np.linalg.norm(X - c0 - d0 * L * 0.5, axis=1) < L
        if near.any():
            dist, par, _, _ = _polyline_dist(X[near], pts)
            scr[near] = np.maximum(scr[near], _ss(0.0013, 0.0004, dist) * np.sin(math.pi * par) ** 0.5)
    v = v + 0.10 * scr
    return np.clip(v, 0.0, 1.0), dict(t=t, seam=seam, line=line, soot=soot, chip=chip, crack=crack, scr=scr,
                                      broad=broad, k=k, u=u)


def _ramp(C, v):
    return np.where((v < 0.25)[:, None], _mix(C["deep"], C["shade"], v / 0.25),
           np.where((v < 0.5)[:, None], _mix(C["shade"], C["mid"], (v - 0.25) / 0.25),
           np.where((v < 0.78)[:, None], _mix(C["mid"], C["lit"], (v - 0.5) / 0.28),
                    _mix(C["lit"], C["hi"], (v - 0.78) / 0.22))))


def _sat_cap(col, cap=0.40):
    """HSV saturation held at the cap (hue and value kept): the marigold band's 40 % rule on the lacquer"""
    mx = col.max(1, keepdims=True)
    mn = col.min(1, keepdims=True)
    s = (mx - mn) / np.maximum(mx, 1e-4)
    k = np.where(s > cap, cap / np.maximum(s, 1e-4), 1.0)
    return mx - (mx - col) * k


# ── Noon Fair: painted lacquer moths (fix pass 5; review: 'flat clip-art butterfly stickers'): brushed wings with a
#    deep root, a rose-lilac field, a darker margin band dotted with chalk, a chalk eyespot on each forewing, veins
#    from the root, a plum body with feelers; the edges broken by the brush; three hues; ten moths of four sizes
#    fluttering up the cone in a loose spiral, a trail of chalk wing-dust between them, and small far moths ──
MOTHS = ((14.0, 0.50, 1.15, -24.0, 0), (52.0, 0.70, 0.80, 18.0, 1), (95.0, 0.44, 1.00, 38.0, 2),
         (133.0, 0.66, 1.25, -10.0, 0), (172.0, 0.52, 0.75, 26.0, 1), (-150.0, 0.72, 1.05, -32.0, 2),
         (-112.0, 0.46, 0.85, 8.0, 0), (-74.0, 0.68, 1.20, 30.0, 1), (-36.0, 0.56, 0.70, -18.0, 2),
         (-4.0, 0.80, 0.62, 12.0, 0))
MOTH_FAR = ((34.0, 0.33, 0.42), (118.0, 0.31, 0.38), (-130.0, 0.36, 0.45), (-58.0, 0.30, 0.36), (70.0, 0.85, 0.40),
            (-95.0, 0.86, 0.38), (150.0, 0.84, 0.44), (-20.0, 0.34, 0.40))
MOTH_HUES = (("#7A5470", "#B48AA6", "#7E5A74"), ("#6E5470", "#A48AB0", "#735A7C"), ("#80576A", "#BC8E9E", "#875E70"))


def _moth(X, c, sc, rot, hue, n_off):
    """one painted moth on the unrolled cone (X: (n, 2) local metres, + toward the brim): colour, alpha"""
    ca, sa = math.cos(math.radians(rot)), math.sin(math.radians(rot))
    d = X - c
    u = (d[:, 0] * ca + d[:, 1] * sa) / sc          # across (wingspan)
    w = (-d[:, 0] * sa + d[:, 1] * ca) / sc         # along the body (+ the head)
    root_c, field_c, edge_c = (_hexs(h) for h in MOTH_HUES[hue])
    chalk = _hexs(MOTH[2])
    col = np.zeros((len(X), 3), np.float32)
    alpha = np.zeros(len(X))
    P3 = np.stack([u, w, np.zeros_like(u) + n_off], 1)
    brush = NOISE(P3, 90.0)
    for sx in (-1.0, 1.0):
        for (cx, cy, ax, ay, tilt, fore) in ((0.031, 0.004, 0.036, 0.0150, 24.0, True),
                                              (0.019, -0.016, 0.020, 0.0150, -30.0, False)):
            a = math.radians(tilt * sx)
            uu, ww = u - sx * cx, w - cy
            x1 = uu * math.cos(a) + ww * math.sin(a)
            y1 = -uu * math.sin(a) + ww * math.cos(a)
            e = np.sqrt((x1 / ax) ** 2 + (y1 / ay) ** 2)
            e = e + 0.10 * brush + 0.05 * np.sin(np.arctan2(y1, x1 * sx) * 5.0)        # the brush-broken scalloped edge
            m = _ss(1.02, 0.90, e)
            if not (m > 0).any():
                continue
            rr = np.clip(np.hypot(u, w) / (0.05 if fore else 0.036), 0, 1)              # root -> tip
            stroke = 0.5 + 0.5 * NOISE(np.stack([np.arctan2(w, u * sx) * 6.0, rr * 1.5, np.zeros_like(u) + n_off], 1), 1.0)
            wc = _mix(root_c, field_c, _ss(0.15, 0.6, rr) * (0.75 + 0.35 * stroke))
            wc = _mix(wc, edge_c, _ss(0.66, 0.84, e))                                     # the margin band
            ang = np.arctan2(ww, uu * sx)
            vein = np.zeros_like(u)
            for va in (-0.5, 0.05, 0.6):
                vein = np.maximum(vein, _ss(0.10, 0.03, np.abs(np.sin(ang - va))) * _ss(0.2, 0.45, e) * (1 - _ss(0.7, 0.85, e)))
            wc = _mix(wc, edge_c * 0.85, 0.55 * vein)
            if fore:                                                      # a chalk bar across the forewing's tip
                tb = np.abs(x1 / ax - 0.62 - 0.15 * y1 / ay)
                wc = _mix(wc, chalk, 0.75 * _ss(0.09, 0.05, tb) * _ss(0.95, 0.75, e))
                de = np.hypot(x1 - 0.20 * ax, y1 + 0.10 * ay)                  # a small dark spot
                wc = _mix(wc, root_c * 0.85, 0.7 * _ss(0.0035, 0.0022, de))
            gl = np.exp(-((x1 / ax - 0.1) ** 2 / 0.12 + (y1 / ay - 0.45) ** 2 / 0.03))   # the lacquer's gloss
            wc = _mix(wc, _hexs("#DCC8D4"), 0.30 * gl)
            upd = m > alpha
            col[upd] = wc[upd]
            alpha = np.maximum(alpha, m)
    body = np.sqrt((u / 0.0055) ** 2 + (w / 0.026) ** 2) + 0.05 * brush
    mb = _ss(1.05, 0.85, body)
    col = np.where((mb > 0.01)[:, None], _mix(col, _hexs("#5A3E52"), mb), col)
    alpha = np.maximum(alpha, mb)
    for sx in (-1.0, 1.0):                                                                # the feelers
        pts = [(sx * 0.002, 0.022), (sx * 0.008, 0.034), (sx * 0.016, 0.041)]
        dist, par, _, _ = _polyline_dist(np.stack([u, w], 1), pts)
        fm = _ss(0.0016, 0.0007, dist)
        col = np.where((fm > alpha)[:, None], _hexs("#5A3E52"), col)
        alpha = np.maximum(alpha, fm)
    return col, alpha


def _noon_moths(q, r, phi, ground):
    """Noon Fair's painted moths over the lacquer ground"""
    col = ground.copy()
    s = phi * r * BRIM_R
    Xr = np.stack([s, r * BRIM_R], 1)
    for i, (pd, rc, sc, rot, hue) in enumerate(MOTHS):
        pc = math.radians(pd)
        dph = (phi - pc + math.pi) % (2 * math.pi) - math.pi
        X = np.stack([dph * r * BRIM_R, (r - rc) * BRIM_R], 1)
        near = np.hypot(X[:, 0], X[:, 1]) < 0.075 * sc
        if not near.any():
            continue
        mc, ma = _moth(X[near], np.zeros(2), sc, rot, hue, 7.0 * i)
        col[near] = _mix(col[near], mc, 0.95 * ma)
    for j, (pd, rc, sc) in enumerate(MOTH_FAR):                    # far moths: small dark-rose silhouettes
        pc = math.radians(pd)
        dph = (phi - pc + math.pi) % (2 * math.pi) - math.pi
        X = np.stack([dph * r * BRIM_R, (r - rc) * BRIM_R], 1)
        near = np.hypot(X[:, 0], X[:, 1]) < 0.03
        if not near.any():
            continue
        mc, ma = _moth(X[near], np.zeros(2), sc, 20.0 * (j % 3 - 1), j % 3, 50.0 + 3 * j)
        col[near] = _mix(col[near], _mix(mc, _hexs(MOTH[1]), 0.5), 0.85 * ma)
    # chalk wing-dust: tiny dots trailing up the spiral
    dust = np.zeros(len(r))
    for i in range(46):
        a = math.radians(14.0 + 7.9 * i * 2.0 + 9.0 * math.sin(i * 1.7))
        rc = 0.45 + 0.30 * (0.5 + 0.5 * math.sin(i * 0.61)) + 0.05 * math.sin(i * 2.3)
        dph = (phi - a + math.pi) % (2 * math.pi) - math.pi
        dd = np.hypot(dph * r * BRIM_R, (r - rc) * BRIM_R)
        dust = np.maximum(dust, _ss(0.0032 + 0.001 * (i % 3), 0.0012, dd))
    col = _mix(col, _hexs(MOTH[2]), 0.8 * dust)
    return col


# ── Shadeprint (fix pass 5; review: 'the store says an ink hat with a light rim; the model is a white cone with a
#    grey leaf print; at game zoom it and Noon Fair are both pale discs'): the snuffer DIPPED IN INK. The crown is
#    the named ink #2B2A33, its wash running down the slope in ragged radial brush strokes through a violet-grey
#    (the skin's violet shadows) into the pale lavender-chalk paper, which keeps the top band's L* 70 floor; a
#    leafy branch printed in LIGHT across the ink crown, small ink sprigs printed on the pale; the light rim. From
#    the game camera: a dark ink cap (round the forward apex) ringed by pale paper and a light rim ──
SHADE_STEMS = (                                   # printed branches (hat-local, upright, metres): light on the ink crown
    ((0.110, 0.030), (0.060, -0.040), (-0.010, -0.075), (-0.085, -0.070), (-0.125, -0.020)),
    ((-0.03, 0.115), (0.03, 0.090), (0.075, 0.105)),
)
SHADE_SPRIGS = (                                  # ink sprigs on the pale paper
    ((0.225, -0.170), (0.255, -0.215), (0.300, -0.235)),
    ((-0.250, 0.150), (-0.290, 0.175), (-0.318, 0.215)),
    ((-0.215, -0.215), (-0.250, -0.255), (-0.262, -0.300)),
    ((0.270, 0.180), (0.310, 0.170), (0.335, 0.130)),
)
SHADE_CROWN = 0.39                                # the ink crown's radius (normalised; its wash runs to ~0.6; f5-2
#                                                   lineup f0 top 75.1 with 0.33: the room for more ink)


def _leaf_print(X, stems, n_leaf, lf, rib_w=0.0011):
    """a printed leafy branch: stem + leaves (crisp lens shapes), the midrib mask"""
    ink = np.zeros(len(X))
    rib = np.zeros(len(X))
    for bi, pts in enumerate(stems):
        dist, par, tan, total = _polyline_dist(X, pts)
        wst = 0.0040 - 0.0018 * par
        ink = np.maximum(ink, _ss(wst + 0.0010, wst - 0.0004, dist))
        pts_ = np.asarray(pts)
        seg = pts_[1:] - pts_[:-1]
        Ls = np.linalg.norm(seg, axis=1)
        cum = np.concatenate([[0.0], np.cumsum(Ls)])
        nl = n_leaf[bi] if isinstance(n_leaf, (list, tuple)) else n_leaf
        for k in range(nl):
            tk = (k + 0.6) / (nl + 0.3)
            a_ = tk * cum[-1]
            j = int(np.clip(np.searchsorted(cum, a_) - 1, 0, len(seg) - 1))
            B = pts_[j] + seg[j] * (a_ - cum[j]) / Ls[j]
            T = seg[j] / Ls[j]
            side = 1 if k % 2 == 0 else -1
            ang = math.radians(side * (40.0 + 10.0 * math.sin(k * 1.7)))
            D = np.array([T[0] * math.cos(ang) - T[1] * math.sin(ang), T[0] * math.sin(ang) + T[1] * math.cos(ang)])
            Nn = np.array([-D[1], D[0]])
            Lf = lf * (1.0 - 0.3 * tk) * (0.9 + 0.2 * abs(math.sin(k * 2.3)))
            Wf = 0.19 * Lf
            d = X - B
            a = d @ D
            b = d @ Nn - side * 0.12 * (a ** 2) / Lf
            s_ = np.clip(a / Lf, 0.0, 1.0)
            half = Wf * np.sin(math.pi * s_) ** 0.75
            inside = (a > 0) & (a < Lf)
            leaf = np.where(inside, _ss(half + 0.0010, half - 0.0005, np.abs(b)), 0.0)
            ink = np.maximum(ink, leaf)
            mr = np.where(inside & (s_ > 0.08) & (s_ < 0.86), _ss(rib_w * 2.0, rib_w, np.abs(b)), 0.0)
            rib = np.maximum(rib, mr * leaf)
    return ink, rib


def _shade_ink(q, r, phi, L):
    """Shadeprint's ink: the crown wash (1 = ink), ragged radial strokes down the slope"""
    s1 = _streaks(phi, r, 7.0, 2.0, 41.0)
    s2 = _streaks(phi, r, 24.0, 1.2, 17.0)
    edge = SHADE_CROWN + 0.08 * (0.5 + s1) + 0.025 * s2 + 0.03 * np.sin(phi * 3.0 + 0.7)
    drip = np.clip((s2 - 0.30) / 0.25, 0, 1) * np.clip((s1 + 0.05) / 0.4, 0, 1)           # a few strokes run longer
    edge = edge + 0.08 * drip
    wash = _ss(edge + 0.09, edge - 0.06, r) * (0.9 + 0.1 * (0.5 + 0.5 * s2))
    return np.clip(wash, 0.0, 1.0)


def paint_hat(p, n):
    """the lacquered cone, painted: the shared brushwork (_lacquer) on the skin's ground, then the skin's paint"""
    sid = _SKIN.get("id")
    C = {k: _hexs(v) for k, v in HAT_SKIN.get(sid, HAT_COLS).items()}
    q, r, phi = _hat_frame(p)
    nl = n @ HAT_R
    v, L = _lacquer(p, n, q, r, phi)
    t = L["t"]
    if sid == "nurrow_shadeprint":
        v = 0.5 + 0.55 * (v - 0.5)                         # paper: the lacquer's brushwork softer
    col = _ramp(C, v)
    if sid is None:
        # the gores' glaze: each a touch warmer or more golden (hue only; the cap holds the chroma)
        warm = (0.035 * HAT_OFF2[L["k"]] * _ss(0.1, 0.3, r))[:, None] * np.array([1.0, 0.0, -1.2], np.float32)
        col = col * (1.0 + warm)
        col = _mix(col, _hexs("#665747"), 0.40 * L["soot"])                     # the snuffer's soot
        col = _mix(col, _hexs("#6B5640") * (0.9 + 0.2 * t)[:, None], 0.85 * L["chip"])    # worn to the wood
        col = _mix(col, _hexs("#EAD9A6"), 0.55 * L["scr"])
        col = _sat_cap(col, 0.40)
    elif sid == "nurrow_noon_fair":
        col = _mix(col, _hexs("#7F7060"), 0.25 * L["soot"])
        col = _mix(col, _hexs("#8C7A66"), 0.7 * L["chip"])
        band = _ss(0.905, 0.915, r) * (1 - _ss(0.935, 0.945, r))                 # a thin rose-lilac band inside the rim
        col = _mix(col, _hexs(MOTH[0]) * (0.86 + 0.12 * t)[:, None], 0.9 * band)
        col = _noon_moths(q, r, phi, col)
    elif sid == "nurrow_shadeprint":
        wash = _shade_ink(q, r, phi, L)
        ink = _hexs(INK) * (0.94 + 0.12 * t + 0.08 * L["broad"])[:, None]
        violet = _hexs("#5E5478") * (0.9 + 0.2 * t)[:, None]
        mid_ = _ss(0.0, 0.5, wash) * (1 - _ss(0.55, 1.0, wash))                   # the wash's violet half-tone
        col = _mix(col, violet, 0.85 * mid_)
        col = _mix(col, ink, _ss(0.45, 0.95, wash))
        X = q[:, :2]
        lt, lrib = _leaf_print(X, SHADE_STEMS, [6, 3], 0.060)
        light = _mix(_hexs("#B9B5C6"), _hexs("#D2CFDB"), np.clip(0.3 + 0.6 * t, 0, 1))
        col = _mix(col, light, 0.92 * lt * _ss(0.3, 0.7, wash))                  # printed in light on the ink
        col = _mix(col, ink, 0.8 * lrib * _ss(0.3, 0.7, wash))
        sp, srib = _leaf_print(X, SHADE_SPRIGS, 3, 0.042)
        col = _mix(col, ink, 0.9 * sp * (1 - _ss(0.2, 0.6, wash)))               # ink sprigs on the paper
        col = _mix(col, _hexs("#C9C6D3"), 0.8 * srib * (1 - _ss(0.2, 0.6, wash)))
        col = _mix(col, _hexs("#9A95AA"), 0.35 * L["chip"])
        e0 = 0.925                                                                  # a fine ink line inside the light rim
        col = _mix(col, ink, _ss(e0 - 0.004, e0 + 0.003, r) * (1 - _ss(0.94, 0.946, r)))
    # the cone's buried brim edge (inside the iron rim) takes the rim's iron: never a lacquer fringe past the rim
    col = _mix(col, _hexs(RIM_IRON["base"]) if sid != "nurrow_shadeprint" else _hexs(INK), _ss(0.945, 0.96, r))
    # the underside: dark lacquer, darker toward the crown, a warm bounce near the brim
    under = _mix(C["under_deep"], C["under"], _ss(0.2, 0.95, r))
    col = np.where((nl[:, 2] < -0.2)[:, None], under, col)
    return np.clip(col, 0.0, 1.0).astype(np.float32)


def _lin(c):
    c = np.asarray(c, dtype=np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def paint_lining(p, n):
    """the cape's lining: the concept's warm brown felt inside, lit by the key light along its folds"""
    z = p[:, 2]
    th = np.arctan2(p[:, 0] - CAPE.axis(z)[0], p[:, 1] - CAPE.axis(z)[1])
    lam = np.clip(n @ KEY, 0.0, 1.0)
    fold = np.sin(th * 7.0 + 1.3 + 0.8 * np.sin(z * 5.0))
    v = 0.25 + 0.55 * lam + 0.12 * fold + 0.06 * NOISE.fbm(p, 8.0, 3) - 0.18 * _ss(1.0, 1.4, z)
    return _mix(_hexs("#4A342A"), _hexs("#A88A70"), np.clip(v, 0, 1)).astype(np.float32)   # 27 deg / 33 % (the
#                                                     concept's lit tan lining; it carries the front's feet band)


_INLAY_FR: list = []


def _inlay_bezel(p):
    """the six inlays' painted iron bezels: (seat, lip) masks, a dark seat line hugging the glass and a lit lip
    round it (in metres off the slip's footprint edge, measured across the slip)"""
    if not _INLAY_FR:
        _INLAY_FR.extend(inlay_frames())
    seat = np.zeros(len(p))
    lip = np.zeros(len(p))
    for c, ax in _INLAY_FR:
        L = (np.asarray(p, dtype=np.float64) - c) @ ax.T
        near = np.abs(L[:, 2]) < 0.03
        e = np.sqrt((L[:, 0] / INLAY_T) ** 2 + (L[:, 1] / INLAY_B) ** 2)
        dm = (e - 1.0) * INLAY_B
        seat = np.maximum(seat, near * _ss(0.0042, 0.0016, dm))
        lip = np.maximum(lip, near * _ss(0.0030, 0.0050, dm) * (1 - _ss(0.0062, 0.0085, dm)))
    return seat, lip


def paint_rim(p, n):
    """the hat's rim: a clean dark matte ironstone ring (Shadeprint: the LIGHT rim of its ink hat, brief §9: chalk on
    its upper and outer faces round the inlays, the skin's ironstone on the underside); each inlay in a painted bezel"""
    seat, lip = _inlay_bezel(p)
    if _SKIN.get("id") == "nurrow_shadeprint":
        col = _paint_rim_shade(p, n)
        col = _mix(col, _hexs(INK), 0.9 * seat)
        return _mix(col, _hexs("#E0DDE6"), 0.55 * lip).astype(np.float32)
    col = paint_iron(p, n, cols=RIM_IRON)
    col = _mix(col, _hexs("#151216"), 0.85 * seat)
    return _mix(col, _hexs("#6A626C"), 0.6 * lip).astype(np.float32)


def _paint_rim_shade(p, n):
    """Shadeprint's light rim: chalk on the upper and outer faces, the skin's ink ironstone on the underside"""
    nl = n @ HAT_R
    q = hat_local(p)
    rad = q[:, :2] / (np.linalg.norm(q[:, :2], axis=1, keepdims=True) + 1e-9)
    outw = nl[:, 0] * rad[:, 0] + nl[:, 1] * rad[:, 1]
    lam = np.clip(n @ KEY, 0.0, 1.0)
    chalk = _mix(_hexs("#AFABBA"), _hexs("#D6D3DD"), np.clip(0.35 + 0.6 * lam + 0.05 * NOISE(p, 30.0), 0, 1))
    under = paint_iron(p, n)
    w = _ss(-0.55, -0.25, nl[:, 2] + 0.35 * outw)             # the upper / outer faces chalk, the underside ink
    return _mix(under, chalk, w).astype(np.float32)


def paint_knob(p, n):
    """the snuffer knob: the rim's clean dark iron (Shadeprint: the skin's ink ironstone)"""
    if _SKIN.get("id") == "nurrow_shadeprint":
        return paint_iron(p, n)
    return paint_iron(p, n, cols=RIM_IRON)


SLATE = {"base": "#3E4452", "shade": "#23262F", "lit": "#5E6778", "chip": "#7C8494"}     # the brooch stone (220 deg, < 30 %)


def paint_slate(p, n):
    return paint_iron(p, n, cols=SLATE)


def paint_iron(p, n, edge=None, cols=None):
    C = {k: _hexs(v) for k, v in (cols or IRON).items()}
    skin_iron = (_SKIN.get("palette") or {}).get("ironstone")
    if skin_iron and cols is None:
        gain = np.clip(_lin(_hexs(skin_iron)) / np.maximum(_lin(_hexs(PALETTE["ironstone"])), 1e-4), 0.2, 5.0)
        C = {k: _srgb(_lin(v) * gain).astype(np.float32) for k, v in C.items()}
    lam = np.clip(n @ KEY, 0.0, 1.0)
    up = np.clip(n[:, 2], -1.0, 1.0)
    col = _mix(C["shade"], C["base"], _ss(-0.6, 0.2, up))
    col = _mix(col, C["lit"], 0.75 * lam * _ss(0.0, 0.7, up))
    rid = np.clip(NOISE.ridged(p, 40.0, 2) - 0.72, 0, 1) / 0.28
    col = _mix(col, C["chip"], 0.55 * rid * _ss(-0.2, 0.5, up))
    col = col * (1.0 + 0.06 * NOISE(p, 25.0))[:, None]
    return col.astype(np.float32)


def _dilate(m, r):
    out = m.copy()
    for _ in range(r):
        o = out.copy()
        o[1:] |= out[:-1]
        o[:-1] |= out[1:]
        o[:, 1:] |= out[:, :-1]
        o[:, :-1] |= out[:, 1:]
        out = o
    return out


def _erode(m, r):
    return ~_dilate(~m, r)


def _felt_plate(plates, figure):
    """the back plate with only the felt kept (the cape's mauve-grey: low chroma, its value band), every other pixel
    the nearest felt pixel, softened"""
    from common.hifi import project
    img = plates.img["back"]
    H, W = img.shape[:2]
    yy, xx = np.mgrid[0:H, 0:W]
    X, Z = plates.to_world("back", xx, yy)
    lum = _lum(img)
    mx, mn = img.max(2), img.min(2)
    sat = (mx - mn) / np.maximum(mx, 1e-3)
    core = figure & (np.abs(X) < 0.2) & (Z > 0.8) & (Z < 1.2)
    med = float(np.median(lum[core])) if core.any() else 0.3
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    warm = (r > b + 0.06) & (g > b + 0.02)                    # linen / hands / wood (hue 20-45)
    felt = figure & (Z > 0.2) & (Z < 1.5) & (sat < 0.33) & ~warm & (lum > med * 0.62) & (lum < med * 1.6)
    felt = _erode(felt, 2)
    iy, ix = project.nearest_index(felt)
    return project.blur(img[iy, ix], 1.5)


def _blade_region(plates, figure):
    """the painted blade (and its guard) on the front plate: the blade's blue-grey iron against the warm / plum
    paint round it (blue minus red), inside the figure and the blade's box, small gaps closed, grown 3 px so its
    anti-aliased edge and pale bevel never stay behind on the parts it crosses"""
    img = plates.img["front"]
    H, W = img.shape[:2]
    yy, xx = np.mgrid[0:H, 0:W]
    X, Z = plates.to_world("front", xx, yy)
    box = (X > -0.50) & (X < 0.10) & (Z > 0.66) & (Z < 1.0)
    m = box & figure & ((img[..., 2] - img[..., 0]) > -0.015)
    m = _erode(_dilate(m, 2), 2)
    return _dilate(m, 3)


def _smooth_fill(src, valid, sigma):
    """normalised convolution: every pixel the soft average of the valid pixels round it (no streaks)"""
    from common.hifi import project
    w = valid.astype(np.float32)[..., None]
    num = project.blur(src * w, sigma)
    den = project.blur(np.repeat(w, 1, 2), sigma)
    return num / np.maximum(den, 1e-4), den[..., 0]


def paint_blade(p, n):
    """the snuffer blade, painted: dark mottled iron with faint cracks, the pale bevel along the convex edge (the
    concept's), a dark line at the spine; the same on both faces"""
    Q = p - CRES.g
    u, v = Q @ CRES.e1, Q @ CRES.e2
    q = np.stack([u, v], 1)
    d_edge = -(np.linalg.norm(q - CRES.c1, axis=1) - CRES.r1)          # depth in from the convex edge
    d_spine = np.linalg.norm(q - CRES.c2, axis=1) - CRES.r2              # out from the spine
    lam = np.clip(n @ KEY, 0.0, 1.0)
    mott = NOISE.fbm(p, 30.0, 3)
    crack = np.clip((NOISE.ridged(p, 22.0, 3) - 0.86) / 0.14, 0, 1)
    # fix pass 5: the flat a step lighter (the brief's ironstone L* 28) and the pale bevel 2.6 cm (was 1.6): the
    # blade read nowhere from the game camera on the dark lane stone
    col = _mix(_hexs("#2C2930"), _hexs("#48444E"), np.clip(0.5 + 0.6 * mott + 0.25 * lam, 0, 1))
    col = _mix(col, _hexs("#5B5762"), 0.55 * crack)
    bev = _ss(0.028, 0.019, d_edge) * np.clip(u / 0.03, 0, 1)
    bc = _mix(_hexs("#77737E"), _hexs("#A19DA7"), np.clip(0.4 + 0.5 * lam + 0.3 * NOISE(p, 40.0), 0, 1))
    col = _mix(col, bc, bev)
    col = _mix(col, _hexs("#4C4853"), 0.6 * _ss(0.006, 0.0, d_spine))
    return col.astype(np.float32)


def paint_grip(p, n):
    """the grip: an iron pommel and guard, a leather-wrapped wooden handle between"""
    s_ = (p - POMMEL) @ GRIP_AX
    L = float(np.linalg.norm(GUARD - POMMEL))
    iron = paint_iron(p, n)
    lam = np.clip(n @ KEY, 0.0, 1.0)
    wrap = np.abs(np.sin(s_ * 260.0 + np.arctan2(*(p - POMMEL)[:, :2].T) * 1.0))
    leather = _mix(_hexs("#23171A"), _hexs("#4A3129"), np.clip(0.3 + 0.5 * lam + 0.25 * wrap, 0, 1))
    is_iron = (s_ < 0.024) | (s_ > L - 0.028)
    return np.where(is_iron[:, None], iron, leather).astype(np.float32)


def paint_head(p, n):
    """the head behind the mask: the concept's brown cloth wrap (bands slanting round the skull)"""
    c = V3([0.005, 0.018, 1.612])
    d = p - c
    ang = np.arctan2(d[:, 0], d[:, 1])
    lam = np.clip(n @ KEY, 0.0, 1.0)
    band = np.abs(np.sin(d[:, 2] * 70.0 + ang * 1.6 + 0.5 * NOISE(p, 12.0)))
    # always in the hat's shade in game: painted a step lighter and warmer than the concept's shadowed back view so
    # it reads brown (not the sky's grey) under the brim
    v = 0.30 + 0.45 * lam + 0.22 * band ** 3 + 0.08 * NOISE.fbm(p, 20.0, 2) + 0.12 * np.clip(n[:, 2], 0, 1)
    col = _mix(_hexs("#4A2A1C"), _hexs("#9C6744"), np.clip(v, 0, 1))
    col = _mix(col, _hexs("#2E1810"), 0.5 * _ss(0.80, 0.98, band) * (1 - lam))
    return col.astype(np.float32)


def paint_band(p, n):
    """the hat's inner crown: a dark ink basket, the leather head band a step lighter"""
    q = hat_local(p)
    lam = np.clip(n @ KEY, 0.0, 1.0)
    basket = _mix(_hexs("#17121A"), _hexs("#2E2428"), np.clip(0.3 + 0.5 * lam, 0, 1))
    band = _mix(_hexs("#2E1E1A"), _hexs("#5A3C2E"), np.clip(0.25 + 0.6 * lam + 0.15 * NOISE(p, 30.0), 0, 1))
    return np.where((q[:, 2] < 0.008)[:, None], band, basket).astype(np.float32)


def paint_strap(p, n):
    """the concept's red-brown leather belt and its knot (dark red-brown, a warm lit top edge)"""
    lam = np.clip(n @ KEY, 0.0, 1.0)
    up = np.clip(n[:, 2], 0.0, 1.0)
    v = 0.22 + 0.55 * lam + 0.2 * up + 0.08 * NOISE.fbm(p, 25.0, 2)
    col = np.where((v < 0.5)[:, None], _mix(_hexs("#2E1612"), _hexs("#5A2C22"), np.clip(v / 0.5, 0, 1)),
                   _mix(_hexs("#5A2C22"), _hexs("#94503A"), np.clip((v - 0.5) / 0.5, 0, 1)))
    return col.astype(np.float32)


PAUL_COLS = ("#2B1B13", "#4B3022", "#6A4631", "#875D42", "#A06F50")      # dark .. hi (hue 20-24: below the
#   marigold band, so the concept's rich wood is allowed its ~50 % chroma; L* 12-51: fix pass 4, the old ramp
#   (L* 16-66, 34-40 %) read pale tan suede in the splash, the concept's lames are L* 27-44 walnut)


# ── the boots: painted, not projected (the concept's re-posed feet stretched into pink-tan clay with no sole) ──
BOOT_COLS = {"shade": "#312625", "base": "#4C3C3A", "lit": "#735B58", "scuff": "#876A66", "sole": "#211A19",
             "welt": "#4E3D3A"}          # fix pass 5: the side planes' baked key softened (0.32 -> 0.20 lam; the tops
#                                          +0.08: the facing-0 feet band): the splash's rose-tan sides          # fix pass 4: the concept's plum-umber (hue 5-11, 22-28 %: was 18-24 / 35 %;
#                                          +1.5 L* over the first try: the facing-0 feet band fell to 20.3)          # dark umber waxed leather (hue 18-24, L* 14-38): darker than the trousers
#                                          in the splash, the feet band (lineup facing 0, L* >= 20) held by the boots


def _boot_frame(p):
    """per texel: the boot's side, its along-the-foot coordinate (m from the ankle, + toward the toe), height"""
    sx = np.where(p[:, 0] >= 0, 1.0, -1.0)
    a = math.radians(TOE_OUT)
    fx, fy = sx * math.sin(a), -math.cos(a)
    ax_ = np.where(sx > 0, ANK["L"][0], ANK["R"][0])
    ay_ = np.where(sx > 0, ANK["L"][1], ANK["R"][1])
    along = (p[:, 0] - ax_) * fx + (p[:, 1] - ay_) * fy
    return along, p[:, 2]


def paint_boots(p, n):
    """the soft waxed-leather boots: dark umber, lit on the instep and toe cap by the key light, soft creases over
    the ankle, a few pale scuffs at the toe; the near-black sole and wedge heel under a fine lit welt line; the turned
    cuff a step lighter at its rolled edge"""
    C = {k: _hexs(v) for k, v in BOOT_COLS.items()}
    along, z = _boot_frame(p)
    lam = np.clip(n @ KEY, 0.0, 1.0)
    up = np.clip(n[:, 2], 0.0, 1.0)
    v = 0.33 + 0.20 * lam + 0.38 * up + 0.06 * NOISE.fbm(p, 18.0, 3)     # the waxed tops (toe cap, instep) catch
#        the sky (the feet band seen from the game camera); the key's baked shading kept soft (the side facings)
    crease = np.abs(np.sin(z * 150.0 + 2.0 * NOISE(p, 8.0))) ** 6 * _ss(0.07, 0.10, z) * (1 - _ss(0.15, 0.18, z))
    v = v - 0.14 * crease
    col = np.where((v < 0.5)[:, None], _mix(C["shade"], C["base"], np.clip(v / 0.5, 0, 1)),
                   _mix(C["base"], C["lit"], np.clip((v - 0.5) / 0.5, 0, 1)))
    scuff = np.clip((NOISE(p, 45.0) - 0.45) / 0.3, 0, 1) * _ss(0.10, 0.16, along) * up
    col = _mix(col, C["scuff"], 0.55 * scuff)
    z_sole = 0.0175 + 0.013 * _ss(-0.025, -0.075, along)              # the wedge heel rises at the back
    sole = _ss(z_sole + 0.0015, z_sole - 0.0015, z)
    welt = _ss(0.004, 0.0, np.abs(z - z_sole - 0.003)) * (1 - sole)
    solec = _mix(C["sole"], C["welt"], 0.25 * lam)
    col = _mix(col, C["welt"] * (0.85 + 0.35 * lam)[:, None], 0.7 * welt)
    col = _mix(col, solec, sole)
    cuff = _ss(0.188, 0.196, z)
    col = _mix(col, _mix(C["base"], C["scuff"], np.clip(0.2 + 0.6 * lam, 0, 1)), 0.75 * cuff)
    return col.astype(np.float32)


# the trousers and leg wraps: the projected paint's light and fold pattern kept, its colour set to the concept's
# (the lifted mauve read pink-tan clay in the splash): dark plum trousers, grey-mauve wraps a step lighter, both
# darker-to-the-ground than the umber boots are light (the feet band, L* 20-35)
LEG_TARGET = {"trousers": ("#5B4A45", 0.85, (0.45, 1.8)), "legwraps": ("#4E4645", 0.80, (0.55, 1.5)),
              "tabard": ("#594139", 0.95, (0.40, 2.2))}
#            fix pass 5 (review: 'the trousers read mauve-pink, the wraps grey-pink, the tabard a pale beige-grey panel;
#            the concept: dark plum-brown trousers (hue 15), a dark brown tabard with carved trim'): the same L* (the
#            facing-0 feet band), the hues moved to the concept's brown (the splash's blue sky fill pinked hue 352),
#            the wrap grooves kept stronger; the tabard the concept's dark brown (L* 30; its painted trim lighter)
#            target median colour (plum-brown L* 33: their gathered cuffs fill the top of the feet band; the wraps
#            a muted grey-mauve L* 29 as the concept's, chroma 15 %, never pink-tan: the splash's key and ground
#            bounce light the shins hardest), pattern gain, clip


def paint_pauldron(p, n):
    """the carved wooden pauldron, painted (the projection smeared its lames into one brown blob): each lame its own
    plate of grained wood in the key light (grain running round the shoulder), its rolled lip lit on top and dark
    under, the seam shadow under the lip above, two carved plank lines per lame (staggered), domed iron rivets"""
    if not PAUL_LAMES:
        return None
    D = np.stack([np.abs(L.d(p)) for L in PAUL_LAMES], 1)
    own = np.argmin(D, 1)
    r_, h_, th_ = paul_local(p)
    lam = np.clip(n @ KEY, 0.0, 1.0)
    C = [_hexs(h) for h in PAUL_COLS]
    v = 0.20 + 0.42 * lam + 0.08 * np.clip(n @ PAUL_UP, 0, 1)        # the concept's mid-brown wood (the splash's
    edges = paul_edges()                                                # sky lit the lighter ramp to pale tan)
    gr = np.zeros(len(p))
    for i in range(len(PAUL_LAMES)):
        m = own == i
        if not m.any():
            continue
        hb = h_[m] - edges[i][0]                              # height above this lame's lower edge
        # the grain: dark streaks running round the shoulder along the lame (wavy, broken), a few lighter ones
        g = np.sin(hb * 170.0 + 3.2 * NOISE(p[m] * np.array([1.0, 1.0, 4.0]), 9.0) + 1.7 * th_[m])
        brk = np.clip(0.55 + 0.9 * NOISE(p[m] * np.array([3.0, 3.0, 1.0]), 22.0), 0, 1)
        gr[m] = -0.13 * np.clip(g, 0, 1) ** 4 * brk + 0.05 * np.clip(-g, 0, 1) ** 6 \
            + 0.03 * NOISE(p[m] * np.array([4.0, 4.0, 1.0]), 30.0)
        lip = _ss(0.024, 0.012, hb)                            # the rolled lip
        up_ = n[m] @ PAUL_UP
        vv = v[m] + 0.16 * lip * np.clip(up_ + 0.3, 0, 1)
        vv = vv - 0.32 * lip * np.clip(-up_, 0, 1)            # its underside
        if i > 0:                                               # the seam shadow under the lip above
            vv = vv - 0.30 * _ss(edges[i][1] - 0.018, edges[i][1] - 0.002, h_[m])
        for t0 in (-0.50 + 0.22 * i, 0.16 + 0.18 * i):        # carved plank lines (not on the lip)
            vv = vv - 0.24 * _ss(0.040, 0.016, np.abs(th_[m] - t0)) * _ss(0.012, 0.022, hb)
        # a carved border line just above the rolled lip, lit on its lower lip (the concept's carved edge)
        bd = np.abs(hb - 0.030)
        vv = vv - 0.20 * _ss(0.0045, 0.0018, bd) + 0.08 * _ss(0.0075, 0.0045, bd) * (hb < 0.030)
        v[m] = vv
    v = np.clip(v + gr + 0.04 * NOISE.fbm(p, 14.0, 2), 0.0, 1.0)
    idx = np.clip(v * 4.0, 0, 3.999)
    lo = np.floor(idx).astype(int)
    f = (idx - lo)[:, None]
    stack = np.stack(C, 0)
    col = stack[lo] * (1 - f) + stack[lo + 1] * f
    riv = np.zeros(len(p), dtype=bool)
    for rp in paul_rivets():
        riv |= np.linalg.norm(p - rp, axis=1) < 0.0118
    if riv.any():
        col[riv] = paint_iron(p[riv], n[riv], cols=RIM_IRON)
    return col.astype(np.float32)


def nurrow_paint(maps, plates, vis, names, tops=None, flat=None, eps=0.02, bleed=True, log=print):
    from common.hifi import project
    from common import scene
    P, N, part = maps["P"], maps["N"], maps["part"]
    have = part >= 0
    s = vis.step
    # 1. backdrop pixels are never paint; the painted BLADE leaves the plate: its pixels belong to no part (every
    #    texel behind it is filled from its own part round it, step 4), the blade and grip are painted (step 3)
    figure = project.load_rgb(os.path.join(scene.CACHE_DIR, "concept", "nurrow_mask.png"))[..., 0] > 0.5
    figure = _dilate(figure, 10)
    blade_px = _blade_region(plates, figure)
    bi = names.index(BLADE_OWNER) if BLADE_OWNER in names else -1
    for side in ("front", "back"):
        dep, pid = vis.depth[side], vis.part[side]
        fig = figure[s // 2::s, s // 2::s][:dep.shape[0], :dep.shape[1]]
        off = ~fig
        dep[off] = -1e9 if side == "front" else 1e9
        pid[off] = -1
        if side == "front" and bi >= 0:
            own = blade_px[s // 2::s, s // 2::s][:dep.shape[0], :dep.shape[1]]
            dep[own] = -1e9
            pid[own] = bi
    # 2. sideways texels sample a little inside their silhouette
    st = np.abs(N[..., 0]) / (np.abs(N[..., 0]) + np.abs(N[..., 1]) + 1e-6)
    ws = _ss(0.6, 0.9, st)
    P2 = P.copy()
    P2[..., 0] -= np.sign(N[..., 0]) * SIDE_INSET * ws
    maps2 = dict(maps)
    maps2["P"] = P2
    out = _PAINT0["paint"](maps2, plates, vis, names, tops=tops, flat=flat, eps=eps, bleed=False, log=log)

    def sel(name):
        return (part == names.index(name)) if name in names else np.zeros_like(have)
    # 3. painted parts
    for nm, fn in (("hat_cone", paint_hat), ("hat_under", paint_hat), ("hat_rim", paint_rim), ("hat_knob", paint_knob), (BLADE_OWNER, paint_blade),
                   ("grip", paint_grip), ("head", paint_head), ("hat_band", paint_band), ("belt_strap", paint_strap),
                   ("brooch_glass", paint_slate), ("pauldron", paint_pauldron), ("boots", paint_boots)):
        m = sel(nm)
        if m.any():
            c = fn(P[m].astype(np.float64), N[m].astype(np.float64))
            if c is not None:
                out[m] = c
    # 4. the parts the painted blade crossed (tabard, tassets, trousers, cape lining...): texels whose front view
    #    falls on the blade take a soft average of their OWN part's paint round the blade (no streaks, no blade edge)
    bmask = blade_px[s // 2::s, s // 2::s][:vis.part["front"].shape[0], :vis.part["front"].shape[1]]
    soft = project.blur(bmask.astype(np.float32)[..., None], 2.0)[..., 0]
    small = plates.img["front"][s // 2::s, s // 2::s][:bmask.shape[0], :bmask.shape[1]]
    ys, xs = np.nonzero(bmask)
    if len(ys):
        y0, y1 = max(0, ys.min() - 60), min(bmask.shape[0], ys.max() + 60)
        x0, x1 = max(0, xs.min() - 60), min(bmask.shape[1], xs.max() + 60)
        px, py = plates.to_px("front", P[..., 0], P[..., 2])
        gx, gy = px / s, py / s
        inside = have & (gx >= x0) & (gx < x1 - 1) & (gy >= y0) & (gy < y1 - 1) & (N[..., 1] < 0.35)
        wmask = np.zeros(part.shape, dtype=np.float32)
        wmask[inside] = project.bilinear(soft[..., None], gx[inside], gy[inside])[:, 0]
        hit = inside & (wmask > 0.02)
        pid = vis.part["front"]
        for k in np.unique(part[hit]):
            nm = names[int(k)]
            if nm in (BLADE_OWNER, "grip", "hat_cone", "hat_under", "hat_rim", "hat_knob", "head", "hat_band", "belt_strap", "boots",
                      "pauldron"):
                continue
            valid = (pid[y0:y1, x0:x1] == k) & ~bmask[y0:y1, x0:x1]
            if valid.sum() < 20:
                continue
            F, den = _smooth_fill(small[y0:y1, x0:x1], valid, 7.0)
            mk = hit & (part == k)
            c = project.bilinear(F, gx[mk] - x0, gy[mk] - y0)
            c = c * (1.0 + 0.05 * NOISE.fbm(P[mk].astype(np.float64), 30.0, 2))[:, None]
            out[mk] = _mix(out[mk], c.astype(np.float32), np.clip(wmask[mk] * 1.6, 0, 1))
            log(f"  blade fill {nm}: {int(mk.sum())} texels")
    m = sel("cape")
    if m.any():
        # the cape's outer felt: sampled from a FELT-ONLY back plate (the trousers, wraps and gaps seen through the
        # painted slits replaced by the nearest felt, lightly softened): no dark blotches on the hem
        fp = _felt_plate(plates, figure)
        pc, nc = P[m].astype(np.float64), N[m].astype(np.float64)
        bk = nc[:, 1] > -0.15
        px, py = plates.to_px("back", pc[bk, 0], pc[bk, 2])
        sub = out[m]
        felt = project.bilinear(fp, px, py)
        med = np.median(felt, axis=0)
        sub[bk] = med[None, :] + (felt - med[None, :]) * FELT_CONTRAST     # the painted folds, softened
        out[m] = sub
        ax_, ay_ = CAPE.axis(pc[:, 2])
        rad = np.stack([pc[:, 0] - ax_, pc[:, 1] - ay_], 1)
        rad /= np.linalg.norm(rad, axis=1, keepdims=True) + 1e-9
        inner = (nc[:, 0] * rad[:, 0] + nc[:, 1] * rad[:, 1]) < -0.15
        sub = out[m]
        sub[inner] = paint_lining(pc[inner], nc[inner])
        out[m] = sub
    # the cape's and the cowl's side planes (the projection grazes them: painted rim shadows and fold strokes
    # streak along the sides): the felt's own outer colour in the key light, soft folds
    for nm, (s0, s1), fq in (("cape", (0.40, 0.66), 7.0), ("cowl", (0.22, 0.52), 9.0)):
        m = sel(nm)
        if not m.any():
            continue
        nc = N[m].astype(np.float64)
        sidew = _ss(s0, s1, np.abs(nc[:, 0]) / (np.abs(nc[:, 0]) + np.abs(nc[:, 1]) + 1e-6))
        sub = out[m]
        outer = (nc[:, 1] > 0.3) if nm == "cape" else (np.abs(nc[:, 1]) > 0.6)
        if outer.sum() > 100:
            base = np.median(sub[outer], axis=0)
            pc = P[m].astype(np.float64)
            lam = np.clip(nc @ KEY, 0.0, 1.0)
            th = np.arctan2(pc[:, 0] - CAPE.axis(pc[:, 2])[0], pc[:, 1] - CAPE.axis(pc[:, 2])[1])
            fold = np.sin(th * fq + 1.3 + 0.8 * np.sin(pc[:, 2] * 5.0))
            fold2 = np.sin(th * fq * 2.3 + 0.6 + 1.2 * NOISE(pc * np.array([1.0, 1.0, 0.25]), 3.0))
            felt = base[None, :] * (0.80 + 0.30 * lam + 0.11 * fold + 0.05 * fold2
                                    + 0.04 * NOISE.fbm(pc, 7.0, 3))[:, None]           # hanging vertical folds
            sub = _mix(sub, felt.astype(np.float32), sidew)
            out[m] = sub
    # the legs' side planes (the front / back projection grazes them: the painted wrap lines and fold shadows
    # stretch into chevrons and zigzags along the knees and shins): each leg's own colour at that height (the median
    # of its front- and back-facing paint), in the key light, with the wrap grooves painted round the leg
    for nm, (s0, s1) in SIDE_FILL.items():
        m = sel(nm)
        if m.any():
            out[m] = _side_fill(nm, out[m], P[m].astype(np.float64), N[m].astype(np.float64), s0, s1, log)
    # the mask's beak keel: the concept's beak highlight lands off the carved keel (a broken pale smear and a
    # notch); the keel takes the mask's own wood, shaded by the key light on its true normal
    m = sel("mask")
    if m.any():
        pm, nm_ = P[m].astype(np.float64), N[m].astype(np.float64)
        zc = np.clip((1.648 - pm[:, 2]) / 0.115, 0, 1)
        bx = 0.012 + 0.009 * zc
        wk = _ss(0.034, 0.020, np.abs(pm[:, 0] - bx)) * _ss(1.515, 1.535, pm[:, 2]) * _ss(1.672, 1.655, pm[:, 2]) \
            * (nm_[:, 1] < -0.1)
        if (wk > 0).sum() > 20:
            sub = out[m]
            ring = (wk < 0.05) & (np.abs(pm[:, 0] - bx) < 0.06) & (nm_[:, 1] < -0.3)
            wood = np.median(sub[ring], axis=0) if ring.sum() > 20 else np.median(sub, axis=0)
            lam = np.clip(nm_ @ KEY, 0.0, 1.0)
            keel = wood[None, :] * (0.72 + 0.48 * lam + 0.04 * np.sin(pm[:, 0] * 140.0 + 3 * NOISE(pm, 6.0)))[:, None]
            out[m] = _mix(sub, keel.astype(np.float32), wk)
    # 5. stray dark / saturated texels in the felt take the felt round them (outer and lining apart)
    for nm, crit in DESPECKLE.items():
        m0 = sel(nm)
        if not m0.any():
            continue
        for face, (k, smax) in zip((N[..., 1] >= 0.0, N[..., 1] < 0.0), crit):
            m = m0 & face
            if m.sum() < 50:
                continue
            c = out[m]
            L = _lum(c)
            sat = (c.max(1) - c.min(1)) / np.maximum(c.max(1), 1e-3)
            med = float(np.median(L))
            bad = np.zeros_like(m)
            bad[m] = (L < med * k) | (sat > smax)
            good = m & ~bad
            if bad.any() and good.any():
                iy, ix = project.nearest_index(good)
                fill = project.blur(out[iy, ix], 3.0)
                out[bad] = fill[bad]
                log(f"  despeckle {nm}: {int(bad.sum())} texels")
    # 6. tone: the felt and the legs lifted in linear light (their painted folds kept)
    for nm, gain in TONE.items():
        m = sel(nm)
        if m.any():
            if nm == "cape":                         # the outer felt only (the warm lining keeps the concept's value)
                pc, nc = P[m].astype(np.float64), N[m].astype(np.float64)
                ax_, ay_ = CAPE.axis(pc[:, 2])
                rad = np.stack([pc[:, 0] - ax_, pc[:, 1] - ay_], 1)
                rad /= np.linalg.norm(rad, axis=1, keepdims=True) + 1e-9
                inner = (nc[:, 0] * rad[:, 0] + nc[:, 1] * rad[:, 1]) < -0.15
                gain = np.where(inner, 1.1, gain)[:, None]
            lin = np.where(out[m] <= 0.04045, out[m] / 12.92, ((out[m] + 0.055) / 1.055) ** 2.4) * gain
            if nm in UMBER:                          # the wraps and boots toward the concept's brown (the warm splash
                y0 = lin @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)       # light turned the mauve pink)
                lin = lin * np.array(UMBER[nm], dtype=np.float32)
                y1 = lin @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
                lin = lin * (y0 / np.maximum(y1, 1e-5))[..., None]
            out[m] = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(np.clip(lin, 0, 1), 1 / 2.4) - 0.055)
    for nm, (hexc, gain_, (rlo, rhi)) in LEG_TARGET.items():
        m = sel(nm)
        if not m.any():
            continue
        lin = _lin(out[m])
        Y = lin @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
        ratio = np.clip(Y / max(float(np.median(Y)), 1e-5), rlo, rhi) ** gain_
        zk = LEG_ZDARK.get(nm)
        if zk:                                               # the thighs a step darker (the splash), the cuffs kept
            ratio = ratio * (1.0 - (1.0 - zk[2]) * _ss(zk[0], zk[1], P[m][:, 2]))
        out[m] = _srgb(_lin(_hexs(hexc))[None, :] * ratio[:, None]).astype(np.float32)
        log(f"  leg colour {nm}: median -> {hexc}")
    _lift_ao([sel(nm) for nm in AO_FLOOR], list(AO_FLOOR.values()), log)
    _flatten_normal_seams(have, sel("cape"), log, rough_floor=[(sel(nm), v) for nm, v in ROUGH_FLOOR.items()])
    if bleed:
        iy, ix = project.nearest_index(have)
        out = out[iy, ix]
    return out


# fix pass 5: the thighs (above the gathered cuffs) x0.80 in linear light: the splash lit them mauve-pink at L* 45
# (the concept's L* 23); the cuffs and wraps below carry the facing-0 feet band and stay
LEG_ZDARK = {"trousers": (0.56, 0.66, 0.80)}
SIDE_FILL = {"trousers": (0.50, 0.80), "legwraps": (0.45, 0.75)}


def _leg_wrap_grooves(p):
    """the leg wraps' groove pattern (the sculpt's `wraps` ridges): 1 in a groove, 0 on a ridge"""
    g = np.zeros(len(p))
    for s_ in ("L", "R"):
        sx = 1.0 if s_ == "L" else -1.0
        top = KNEE[s_] + (ANK[s_] - KNEE[s_]) * 0.08
        bot = ANK[s_] + V3([0, 0, 0.09])
        u = unit(bot - top)
        d = p - top
        sv = d @ u
        side = np.cross(V3([1.0, 0, 0]), u)
        side = side / (np.linalg.norm(side) + 1e-9)
        ang = np.arctan2(d @ np.cross(u, side), d @ side)
        val = 1.0 - np.abs(np.sin(sv * 55.0 + 1.0 * ang + 0.3 * NOISE(p, 9.0)))
        on = (np.sign(p[:, 0]) == sx)
        g = np.where(on, val, g)
    return g


def _side_fill(nm, sub, pc, nc, s0, s1, log=print, bin_=0.02):
    sf = np.abs(nc[:, 0]) / (np.abs(nc[:, 0]) + np.abs(nc[:, 1]) + 1e-6)
    w = _ss(s0, s1, sf) * (1.0 - _ss(0.75, 0.92, np.abs(nc[:, 2])))
    if not (w > 0.02).any():
        return sub
    ref = sf < 0.35
    lam = np.clip(nc @ KEY, 0.0, 1.0)
    fill = sub.copy()
    for sx in (-1.0, 1.0):
        on = np.sign(pc[:, 0]) == sx
        r = ref & on
        if r.sum() < 30 or not on.any():
            continue
        z = pc[:, 2]
        lo_, hi_ = z[on].min(), z[on].max()
        nb = max(2, int(math.ceil((hi_ - lo_) / bin_)))
        idx = np.clip(((z - lo_) / bin_).astype(int), 0, nb - 1)
        cen, med = [], []
        for k in range(nb):
            sel_ = r & (idx == k)
            if sel_.sum() >= 6:
                cen.append(lo_ + (k + 0.5) * bin_)
                med.append(np.median(sub[sel_], axis=0))
        if len(cen) < 2:
            continue
        cen, med = np.array(cen), np.array(med)
        base = np.stack([np.interp(z[on], cen, med[:, ch]) for ch in range(3)], 1)
        shade = 0.84 + 0.30 * lam[on] + 0.04 * NOISE.fbm(pc[on], 12.0, 2)
        c = base * shade[:, None]
        if nm == "legwraps":
            c = c * (1.0 - 0.30 * _leg_wrap_grooves(pc[on]) ** 4)[:, None]
        fill[on] = c
    log(f"  side fill {nm}: {int((w > 0.5).sum())} texels")
    return _mix(sub, fill.astype(np.float32), w).astype(np.float32)


# the whole-body AO is baked in the REST pose: the hanging arms, fists and blade shadow the cape's sides there, and
# the moment the cape swings those shadows show as dark blots on the felt. The cape's AO is floored (its own folds
# keep a little) before the bake multiplies it into the base and packs it into the ORM (bake.bake_asset reads the AO
# image after this paint hook runs).
AO_FLOOR = {"cape": 0.82, "tabard": 0.7, "hat_cone": 0.93,     # hat_cone: the horn's baked AO streak (a grey band
            "boots": 0.85, "legwraps": 0.85, "trousers": 0.8}  # down the front slope from the knob in the splash);
#            the legs: the rest pose's cape and crossed shadows are not there once she moves
FELT_CONTRAST = 0.62      # the back plate's fold strokes on the cape (seen flipped up in a lunge they read as blots)


def _lift_ao(masks, floors, log=print):
    import bpy
    cand = [im for im in bpy.data.images if im.name.endswith("_ao") and im.size[0] == masks[0].shape[1]] if masks else []
    if not cand:
        return
    img = cand[-1]
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    a = a.reshape(h, w, 4)
    for m, fl in zip(masks, floors):
        mm = m[::-1]                                     # maps: row 0 = top; Blender pixels: row 0 = bottom
        a[mm, :3] = np.maximum(a[mm, :3], fl)
    img.pixels.foreach_set(a.ravel())
    log(f"  ao floor on {img.name}: {sum(int(m.sum()) for m in masks)} texels")


ROUGH_FLOOR = {"boots": 0.74, "pauldron": 0.80}
#   the waxed-leather role's 0.5 gloss mirrored the splash's bright sky: grey boots; fix pass 4: the wood_dark
#   pauldron's 0.5 gloss lit a white snow-cap and a pale outer shard in the splash (the sun on the domed cap)


def _flatten_normal_seams(have, cape, log=print, rough_floor=()):
    """the cape's tangent normals softened (blurred over the felt, tilt held under 35 deg; its folds are in the mesh)
    and every island's edge (3 texels) and the bake margin flattened: the baked felt carried steep stray normals that
    the splash's key light caught as a dotted line of white specular specks on the lit cape (gone with the normal map
    unplugged or the specular off: proto check)"""
    import bpy
    from common.hifi import project
    cand = [im for im in bpy.data.images if im.name.endswith("_normal") and im.size[0] == have.shape[1]]
    if not cand:
        return
    img = cand[-1]
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    a = a.reshape(h, w, 4)
    cm = cape[::-1]
    if cm.any():
        v = a[..., :3] * 2.0 - 1.0
        wgt = cm.astype(np.float32)[..., None]
        sm = project.blur(v * wgt, 2.5) / np.maximum(project.blur(wgt, 2.5), 1e-4)
        t = np.cos(np.radians(35.0))
        sm[..., 2] = np.maximum(sm[..., 2], 0.0)
        xy = sm[..., :2]
        ln = np.linalg.norm(xy, axis=-1, keepdims=True)
        lim = math.sqrt(1 - t * t) / t
        xy = xy * np.minimum(1.0, lim * np.maximum(sm[..., 2:3], 1e-3) / np.maximum(ln, 1e-6))
        sm = np.concatenate([xy, sm[..., 2:3]], -1)
        sm /= np.linalg.norm(sm, axis=-1, keepdims=True) + 1e-9
        a[cm, :3] = sm[cm] * 0.5 + 0.5
    edge = (have & ~_erode(have, 3)) | ~have
    m = edge[::-1]
    a[m, 0], a[m, 1], a[m, 2] = 0.5, 0.5, 1.0
    img.pixels.foreach_set(a.ravel())
    log(f"  normal map: cape softened ({int(cape.sum())} texels), seams / margin flattened ({int(edge.sum())})")
    # the ROUGHNESS map's background is 0 (glossy) and its 8-texel margin shrinks to one texel in the 256 ORM: every
    # island edge sampled glossy -> the dotted line of white specks along the cape's seam in the splash. The whole
    # background takes the nearest island's roughness (pipeline maps: wrapped here, common/ untouched)
    rc = [im for im in bpy.data.images if im.name.endswith("_rough") and im.size[0] == have.shape[1]]
    if rc:
        r_ = rc[-1]
        b = np.empty(w * h * 4, dtype=np.float32)
        r_.pixels.foreach_get(b)
        b = b.reshape(h, w, 4)
        hv = have[::-1]
        iy, ix = project.nearest_index(hv)
        b[~hv] = b[iy, ix][~hv]
        for mk, fl in rough_floor:
            mm = mk[::-1]
            b[mm, :3] = np.maximum(b[mm, :3], fl)
        r_.pixels.foreach_set(b.ravel())
        log(f"  roughness margin filled from the islands on {r_.name}: {int((~hv).sum())} texels")


PAINTED = ("hat_cone", "hat_under", "hat_rim", "hat_knob")      # painted in the skin's own colours by nurrow_paint


def nurrow_recolour(img, maps, names, roles, base_pal, skin_pal, skip=None, log=print):
    """the shared per-part re-colour, without the parts nurrow_paint already painted in the skin's colours; then
    the skin's painted details: Noon Fair's half-lids over the mask's closed lids, Shadeprint's light-rimmed hem"""
    out = _PAINT0["recolour"](img, maps, names, roles, base_pal, skin_pal, skip=set(skip or ()) | set(PAINTED), log=log)
    sid = _SKIN.get("id")
    P, N, part = maps["P"], maps["N"], maps["part"]
    if sid == "nurrow_noon_fair" and "mask" in names:
        m = (part == names.index("mask")) & (N[..., 1] < -0.2)
        x, z = P[..., 0][m], P[..., 2][m]
        lid = np.zeros_like(x)
        line = np.zeros_like(x)
        hi = np.zeros_like(x)
        for sx in (-1, 1):
            xs, zs = EYES[sx]
            o = np.argsort(xs)
            xa, za = np.asarray(xs)[o], np.asarray(zs)[o]
            inside = (x > xa[0] - 0.004) & (x < xa[-1] + 0.004)
            zl = np.interp(x, xa, za)
            span = (x - xa[0]) / (xa[-1] - xa[0])
            hgt = 0.019 * np.sin(np.clip(span, 0, 1) * math.pi) ** 0.7 + 0.003
            d = z - zl
            lid = np.maximum(lid, inside * _ss(-0.002, 0.002, d) * (1 - _ss(hgt - 0.002, hgt + 0.001, d)))
            line = np.maximum(line, inside * (1 - _ss(0.0, 0.004, np.abs(d))))
            hi = np.maximum(hi, inside * (1 - _ss(0.0, 0.0025, np.abs(d - hgt))))
        sub = out[m]
        sub = _mix(sub, _hexs(MOTH[0]), 0.85 * lid)
        sub = _mix(sub, _hexs(MOTH[1]), 0.8 * line)
        sub = _mix(sub, _hexs(MOTH[2]), 0.7 * hi)
        out[m] = sub
    # fix pass 5 (review: 'both skins leave the whole body under the cowl identical to the base: the orange pauldron,
    # the red belt, the arm wraps, the legs and the boots'): each skin dresses the body in its own colours, part by
    # part, from the BASE painting's light and pattern (luminance ratio to the part's median, as LEG_TARGET); the legs
    # and boots keep the base's median L* (the facing-0 feet band) and change hue only
    for nm, (hexc, gain_, (rlo, rhi), keep_l) in (SKIN_PARTS.get(sid) or {}).items():
        if nm not in names:
            continue
        m = part == names.index(nm)
        if m.sum() < 10:
            continue
        lin0 = _lin(img[m])
        Y = lin0 @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
        med = max(float(np.median(Y)), 1e-5)
        ratio = np.clip(Y / med, rlo, rhi) ** gain_
        tgt = _lin(_hexs(hexc))
        if keep_l:                                           # (a number: x that in linear light)
            tgt = tgt * (med / max(float(tgt @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)), 1e-5)) \
                * (1.0 if keep_l is True else float(keep_l))
        out[m] = _srgb(tgt[None, :] * ratio[:, None]).astype(np.float32)
        log(f"  skin part {nm}: median -> {hexc}{' (base L*)' if keep_l else ''}")
    # the skin's felt held to its value band (brief §9: Shadeprint's cloth #847C8E, L* 53; the shared re-colour of the
    # lifted base felt came out near-white, L* 88, over a darker hat: the value gradient inverted)
    for nm, (Lt, outer_only) in (SKIN_VALUE.get(sid) or {}).items():
        if nm not in names:
            continue
        m = part == names.index(nm)
        if outer_only:
            pc, nc = P[m].astype(np.float64), N[m].astype(np.float64)
            ax_, ay_ = CAPE.axis(pc[:, 2])
            rad = np.stack([pc[:, 0] - ax_, pc[:, 1] - ay_], 1)
            rad /= np.linalg.norm(rad, axis=1, keepdims=True) + 1e-9
            sel_ = (nc[:, 0] * rad[:, 0] + nc[:, 1] * rad[:, 1]) >= -0.15
        else:
            sel_ = np.ones(int(m.sum()), dtype=bool)
        sub = out[m]
        lin = _lin(sub)
        Y = lin @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
        y_t = ((Lt + 16.0) / 116.0) ** 3
        gain = y_t / max(float(np.median(Y[sel_])), 1e-4)
        lin[sel_] = lin[sel_] * gain
        Ycap = ((84.0 + 16.0) / 116.0) ** 3                     # no texel of the felt above L* 84
        Y2 = lin @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
        lin = lin * np.minimum(1.0, Ycap / np.maximum(Y2, 1e-5))[:, None]
        out[m] = _srgb(lin).astype(np.float32)
        log(f"  skin value {nm}: median L* -> {Lt} (gain {gain:.2f})")
    if sid == "nurrow_shadeprint" and "cape" in names:
        m = part == names.index("cape")
        pc = P[m].astype(np.float64)
        ax_, ay_ = CAPE.axis(pc[:, 2])
        th = np.arctan2(pc[:, 0] - ax_, pc[:, 1] - ay_)
        dz = pc[:, 2] - CAPE.hem_z(th)
        # printed in light and ink above the ragged hem: a narrow pale print band, an ink rule over it, a thin pale
        # line higher up, the ink edge (the felt between keeps the cloth's value)
        grain_ = 0.85 + 0.15 * NOISE(pc, 25.0)
        band = _ss(0.105, 0.09, dz) * _ss(0.03, 0.045, dz)
        rule = _ss(0.135, 0.125, dz) * _ss(0.11, 0.12, dz)
        line = _ss(0.19, 0.183, dz) * _ss(0.168, 0.175, dz)
        sub = out[m]
        sub = _mix(sub, _hexs("#BDB9C7") * grain_[:, None], 0.85 * band)
        sub = _mix(sub, _hexs(INK), 0.85 * rule)
        sub = _mix(sub, _hexs("#BDB9C7"), 0.7 * line)
        sub = _mix(sub, _hexs(INK), 0.85 * _ss(0.014, 0.004, dz))
        out[m] = sub
    return out


# per skin: part -> (target median colour, pattern gain, ratio clip, keep the base's median luminance)
SKIN_PARTS = {
    # Noon Fair (the Shadowless Noon fair): rose-lilac lacquered wood, plum leathers, a chalk-lilac sash, chalk-rose
    # linen wraps, plum legs and boots (hue 318-330: outside every reserved band)
    "nurrow_noon_fair": {"pauldron": ("#6E566A", 0.9, (0.35, 2.4), False), "tassets": ("#665064", 0.9, (0.35, 2.4), False),
                         "brooch": ("#6E5068", 0.9, (0.35, 2.4), False), "head": ("#5E4656", 0.9, (0.35, 2.4), False),
                         "belt_strap": ("#B39AAE", 0.8, (0.4, 1.8), False), "belt": ("#4E3A4C", 0.9, (0.4, 2.2), False),
                         "torso": ("#46384A", 0.9, (0.4, 2.2), False), "straps": ("#4E3A4C", 0.9, (0.4, 2.2), False),
                         "forearm_wraps": ("#B4A6A6", 0.8, (0.45, 1.6), False), "sleeves": ("#5A4458", 0.9, (0.4, 2.0), False),
                         "tabard": ("#7D6474", 0.95, (0.4, 2.2), False), "hat_band": ("#4E3A4C", 0.9, (0.4, 2.2), False),
                         "trousers": ("#5C4856", 0.85, (0.45, 1.8), True), "legwraps": ("#4F454A", 0.8, (0.55, 1.5), True),
                         "boots": ("#4D3B45", 1.0, (0.2, 3.0), True)},
    # Shadeprint (ink and light): ink-lacquered wood, ink leathers, a violet sash (#6A5C96, its sleep's violet), pale
    # chalk linen wraps, ink-violet legs, ink boots, grey-violet carved hands under the pale mask
    "nurrow_shadeprint": {"pauldron": ("#3A3646", 0.9, (0.35, 2.6), False), "tassets": ("#3A3646", 0.9, (0.35, 2.6), False),
                          "brooch": ("#3A3646", 0.9, (0.35, 2.6), False), "head": ("#3A3646", 0.9, (0.35, 2.4), False),
                          "belt_strap": ("#6A5C96", 0.8, (0.4, 1.8), False), "belt": ("#2E2C36", 0.9, (0.4, 2.4), False),
                          "torso": ("#38343F", 0.9, (0.4, 2.4), False), "straps": ("#2E2C36", 0.9, (0.4, 2.4), False),
                          "forearm_wraps": ("#C9C6D2", 0.8, (0.45, 1.5), False), "sleeves": ("#46414F", 0.9, (0.4, 2.0), False),
                          "tabard": ("#33303C", 0.95, (0.4, 2.6), False), "hat_band": ("#2E2C36", 0.9, (0.4, 2.2), False),
                          "hand_L": ("#6E687A", 0.9, (0.4, 2.0), False), "hand_R": ("#6E687A", 0.9, (0.4, 2.0), False),
                          "trousers": ("#504C59", 0.85, (0.45, 1.8), 1.3), "legwraps": ("#48474E", 0.8, (0.55, 1.5), 1.3),
                          "boots": ("#413E49", 1.0, (0.2, 3.0), 1.3)},
    #   (the cool violet-greys read darker than the base's warm browns under the game's warm key: lineup f0 feet 18.9
    #   at the base's luminance -> x1.3)
}
# per skin: part -> (target median L* of its outer face, outer face only)
SKIN_VALUE = {"nurrow_shadeprint": {"cape": (47.0, True), "cowl": (51.0, False)}}      # (fix pass 3: 54 / 58 read
#                                                       white under the game light: 'a white disc over a white cape')


def _install_render() -> None:
    """the splash / portrait renders with Cycles' direct-light clamp at 6 (common/render.setup leaves it off): the
    sun's specular on the felt's normal map left single-sample white specks on the cape (gone with the specular off;
    clamp 6 leaves every lit surface as it was, mean change 0.2 / 255 on the hat)"""
    from common import render
    if getattr(render.fighter_renders, "_nurrow", False):
        return
    orig = render.fighter_renders

    def fighter_renders(*a, **k):
        cy = bpy.context.scene.cycles
        prev = cy.sample_clamp_direct
        cy.sample_clamp_direct = 6.0
        try:
            return orig(*a, **k)
        finally:
            cy.sample_clamp_direct = prev
    fighter_renders._nurrow = True
    render.fighter_renders = fighter_renders


def _install_paint() -> None:
    from common.hifi import project
    if getattr(project.paint, "_nurrow", False):
        return
    _PAINT0["paint"] = project.paint
    _PAINT0["recolour"] = project.recolour
    nurrow_paint._nurrow = True
    project.paint = nurrow_paint
    project.recolour = nurrow_recolour


# ── motion (brief §8) ─────────────────────────────────────────────────────────────────────────────────────
# Arms are IK: wrist targets `rel` to the posed shoulder in arm lengths (chest frame: +X her left, -Y front, +Z up),
# `aim.R` = the blade (prop.R +Y runs from the fist to the blade tip), `aim.L` = the lull hand's fingers (prop.L +Y
# runs along them, +Z out of the back of the hand). Feet are IK offsets from the symmetric rest stance.
MOTION = anim.motion_profile(weight="light", weapon="one_hand", stance="low", run_ref_speed=3.55)
RUN_REF = 3.55
STANCE = dict(l=(0.01, -0.12, 0.0), r=(-0.12, 0.10, 0.0), yl=6.0, yr=-18.0)     # the concept's wide stalker stance
#   (fix pass 5: 0.51 -> 0.59 m between the ankles, hips 2 cm lower: 'stockier and more upright than the concept')
TORSO_G = dict(hips=(8, -8, 0), spine=(3, 3, 0), chest=(2, 3, 0), neck=(1, 2, 0), head=(3, 3, 0))    # 12.5 deg lean (hips ->
#                                                    neck, measured on the rig; brief 12), the hat pointing a little down
G_HIPS = (0.0, 0.02, -0.08)
GR = ((-0.36, 0.06, -0.88), (-0.85, 0.40, -0.30))       # the blade hand low at the right hip, a little out
GAIM = (-0.52, 0.48, -0.70)                             # the blade held low BEHIND the right hip (brief §8), down-back
#   and OUT (fix pass 5; review: 'the blade is invisible in idle and run'): its tip ~0.7 m out from her centre line,
#   past the hat's brim, a hooked spike on her right-back from the game camera
GL = ((0.10, -0.74, -0.14), (0.85, 0.30, -0.45))        # the lull hand open at chest height, forward
GLAIM = (-0.12, -0.84, -0.53)                           # its fingers forward-down, loosely open
LUNGE_FT = dict(dl=(0.04, -0.34, 0.0), dr=(0.02, 0.40, 0.05))


LIP_CORNER = (0.098, -0.150, 1.503)    # the smile's left corner, a little proud of the mask (victory's hold)
LIP_POINT = (0.03, -0.205, 1.515)      # rest head space: just before the lips, under the beak's tip (the keel ends
_LIPS: dict = {}                       # at y -0.176, z 1.533)


def _solve_foot_fixed(skel, pose, M, side, ft):
    """common/anim._solve_foot with two fixes (wrapped here; common/ is shared): pitch + = toes UP as documented
    (the shared rotation had the sign reversed: a heel strike drove the ball 3 cm into the floor and the toe-off
    sank the ankle), and the yaw turns the foot about its ankle before the heel / ball pitch pivot (no pop when the
    pitch changes sign on a yawed foot)."""
    from mathutils import Matrix, Vector as V
    foot, toe = f"foot.{side}", f"toe.{side}"
    rest_f = skel.rest[foot]
    ankle0 = rest_f.translation.copy()
    ball0 = skel.rest[toe].translation.copy()
    heel0 = ankle0 + V((0, 0, -ankle0.z)) + (ankle0 - ball0) * V((1, 1, 0)) * 0.55
    off = V(ft.ankle)
    lat = rest_f.to_3x3().col[0].normalized()
    yawM = Matrix.Rotation(math.radians(ft.yaw), 3, "Z")
    pitchM = Matrix.Rotation(math.radians(ft.pitch), 3, yawM @ lat)
    A = ankle0 + off
    piv = A + yawM @ ((heel0 if ft.pitch > 0 else ball0) - ankle0)
    ankle_t = piv + pitchM @ (A - piv)
    rot = pitchM @ yawM
    knee_dir = Matrix.Rotation(math.radians(ft.yaw + ft.knee), 3, "Z") @ V((0, -1, 0))
    hips_fwd = M["hips"].to_3x3() @ (skel.rest["hips"].to_3x3().inverted() @ V((0, -1, 0)))
    hips_fwd.z = 0
    if hips_fwd.length > 1e-4:
        knee_dir = (knee_dir + hips_fwd.normalized()).normalized()
    end_frame = rot @ rest_f.to_3x3()
    skel.solve_two_bone(pose, M, f"thigh.{side}", f"shin.{side}", foot, ankle_t, knee_dir, True, end_frame,
                        ft.weight)
    t = pose.get(toe, (0.0, 0.0, 0.0))
    toe_counter = ft.pitch if ft.pitch < 0 else 0.0
    pose[toe] = (t[0] + (toe_counter + ft.toe) * ft.weight, t[1], t[2])


# ── a palm-oriented aim (wrapped here; common/anim's Aim turns the hand by the minimal rotation only, so the palm
#    faces wherever the IK left it): PalmAim also rolls the hand about the aimed fingers until the back of the hand
#    (prop +Z) faces `up` (character space), by `roll` (0..1). Lerps fade the roll in and out against a plain Aim. ──
from dataclasses import dataclass  # noqa: E402


@dataclass
class PalmAim(anim.Aim):
    up: tuple = (0.0, 0.0, 1.0)
    roll: float = 1.0


_ANIM0: dict = {}


def _aim_lerp(self, o, t):
    base = _ANIM0["lerp"](self, o, t)
    pa, pb = isinstance(self, PalmAim), isinstance(o, PalmAim)
    if not (pa or pb):
        return base
    tt = max(0.0, min(1.0, t))
    ua = self.up if pa else o.up
    ub = o.up if pb else self.up
    ra = self.roll if pa else 0.0
    rb = o.roll if pb else 0.0
    return PalmAim(base.dir, base.weight, tuple(ua[i] + (ub[i] - ua[i]) * tt for i in range(3)), ra + (rb - ra) * tt)


def _solve_aim_palm(skel, pose, M, side, am):
    from mathutils import Quaternion, Vector as V
    _ANIM0["aim"](skel, pose, M, side, am)
    if not isinstance(am, PalmAim) or am.roll <= 1e-3:
        return
    M2 = skel.fk(pose)
    hand, prop = f"hand.{side}", f"prop.{side}"
    Rp = M2[prop].to_3x3()
    y, z = Rp.col[1].normalized(), Rp.col[2].normalized()
    up = V(am.up)
    want = up - y * y.dot(up)
    if want.length < 1e-4:
        return
    want.normalize()
    ang = math.atan2(y.dot(z.cross(want)), z.dot(want))
    new = Quaternion(y, ang * am.roll).to_matrix() @ M2[hand].to_3x3()
    Ph = (M2[skel.parent[hand]] @ skel.local[hand]).to_3x3()
    pose[hand] = skel.euler_of(Ph.inverted() @ new, pose.get(hand))


def _install_anim() -> None:
    if getattr(anim._solve_foot, "_nurrow", False):
        return
    _solve_foot_fixed._nurrow = True
    anim._solve_foot = _solve_foot_fixed
    _ANIM0["aim"] = anim._solve_aim
    _ANIM0["lerp"] = anim.Aim.lerp
    anim._solve_aim = _solve_aim_palm
    anim.Aim.lerp = _aim_lerp


def clip_overrides(ctx) -> dict:
    """Brief §8 gestures; impact at exactly 40 % (frames multiples of 5). In game a cast clip plays only up to its
    impact (time-scaled onto the castTime), then the sim's next state takes over: Felt Step and Lull the Rest hand
    their impact pose (a low lunge, the blade forward) straight to `dash`, which holds that lunge (no second swing).
      idle      the concept's wide stalker stance, a 12 degree lean, the blade low behind the right hip, the lull hand
                open at chest height, breathing, the weight drifting, the hat nodding a little
      run       a stalker's run at 3.55 m/s: 15 degree lean, the lull hand trailing open, the blade low and quiet,
                the cape lifted back
      attack1   a quick right-hand hooked slash (high right -> low left), stepping in (20 f, f8)
      attack2   the left palm taps out (f4), then a rising right slash (20 f, f8)
      cast_a1   Felt Step (castTime 0.1): a 2-frame crouch, then the step-lunge, near-horizontal, blade forward (15 f, f6)
      cast_a2   Lullaby Dart: the lull hand to the lips in a hush, the head back (hat up), the flick at f10 (25 f)
      cast_a3   Snuff: the blade from low-back, up over and down in a hooked capping arc, the hat dipping (20 f, f8)
      cast_ult  Lull the Rest: both arms open wide like drawing a curtain, the head up, breathing; at f16 a spear
                (flatter than Felt Step, the lull arm left open behind); lands low beside the target, the blade
                swept back, the lull hand lowered in front palm-down (PalmAim); straightens (40 f)
      dash      the stalker's sprint under the held lunge: one stride cycle, the blade forward, the cape streaming
                (starts and ends on cast_a1's held pose: a clean hand-off)
      death     the head snaps back, she sinks to her knees, sways and slumps onto her right side, curled as if
                asleep; the hat rolls off and lies flat beside her head (x_hat), the cape settles (ends at rest)
      recall    the blade lowered, a hand over her heart, humming (a slow sway)
      victory   the blade slipped into the belt (the hand on its pommel), the hat tipped back, the lull hand smooths a
                blanket, the hold: a quarter turned toward the camera, fingertips at the lips under the mask
      crit      a turning backhand (the reverse of attack1): coiled low-left, rising to high-right at f10 (25 f)
      idle_lobby, stunned, taunt, channel"""
    _install_anim()
    prof = MOTION
    HT, FT, AIM = anim.HandTarget, anim.FootTarget, anim.Aim
    P_ = anim.P

    def feet(dl=(0, 0, 0), dr=(0, 0, 0), pl=0.0, pr=0.0, yl=None, yr=None, base=STANCE):
        l = tuple(base["l"][i] + dl[i] for i in range(3))
        r = tuple(base["r"][i] + dr[i] for i in range(3))
        return {"foot.L": FT(l, pl, base["yl"] if yl is None else yl),
                "foot.R": FT(r, pr, base["yr"] if yr is None else yr)}

    g = anim.merge(anim.arms_relaxed(), P_(**TORSO_G))
    g["hips_loc"] = G_HIPS
    g["ik"] = dict(feet())
    g["ik"]["hand.R"] = HT(rel=GR[0], pole=GR[1])
    g["ik"]["aim.R"] = AIM(GAIM)
    g["ik"]["hand.L"] = HT(rel=GL[0], pole=GL[1])
    g["ik"]["aim.L"] = AIM(GLAIM)

    def pose(torso=None, hips=(0.0, 0.0, 0.0), R=None, L=None, aim=None, laim=None, ft=None, base=None, cape=None):
        b = base or g
        p = anim.add(b, P_(**torso)) if torso else dict(b)
        ik = dict(b["ik"])
        if R:
            ik["hand.R"] = HT(rel=R[0], pole=R[1])
        if L:
            ik["hand.L"] = HT(rel=L[0], pole=L[1])
        if aim:
            ik["aim.R"] = AIM(aim)
        if laim:
            ik["aim.L"] = AIM(laim)
        if ft:
            ik.update(ft)
        p["ik"] = ik
        hx, hy, hz = b.get("hips_loc", (0.0, 0.0, 0.0))
        p["hips_loc"] = (hx + hips[0], hy + hips[1], hz + hips[2])
        if cape is not None:
            p["cape_drive"] = (cape, 0.0, 0.0)
        return p

    def clip(name, N, keys, lags=None, loop=False, impact=True):
        fn = anim.keyed(keys)
        if lags:
            fn = anim.drag(fn, N, lags, loop=loop)
        return anim.Clip(name, N, loop, fn, impact=anim.IMPACT if impact else None)

    out = {}
    skel = anim.Skeleton(ctx.info.armature)

    def to_lips(p, key, lip=LIP_POINT):
        """the lull hand's fingertips (x_dart_hand) brought to the lips below the beak (head space), by a few Newton
        steps on the wrist target `rel` (the IK keeps the pole and the aim): the brief's 'finger at the lips'"""
        if key in _LIPS:
            rel = _LIPS[key]
        else:
            from mathutils import Vector
            tip_r = Vector(tuple(hl("L", (0.0, 0.237, -0.022), y=HD_L)))
            lip_r = Vector(tuple(lip))
            hinv, dinv = skel.rest["hand.L"].inverted(), skel.rest["head"].inverted()
            pole = p["ik"]["hand.L"].pole

            def err(rel_):
                q = dict(p)
                ik = dict(p["ik"])
                ik["hand.L"] = HT(rel=tuple(float(v) for v in rel_), pole=pole)
                q["ik"] = ik
                M = skel.fk(anim.resolve(skel, q))
                return np.array(M["hand.L"] @ hinv @ tip_r - M["head"] @ dinv @ lip_r)
            rel = np.array(p["ik"]["hand.L"].rel, dtype=np.float64)
            for _ in range(8):
                e0 = err(rel)
                if np.linalg.norm(e0) < 0.004:
                    break
                J = np.zeros((3, 3))
                for k in range(3):
                    d = np.zeros(3)
                    d[k] = 0.01
                    J[:, k] = (err(rel + d) - e0) / 0.01
                rel = rel - 0.9 * np.linalg.lstsq(J, e0, rcond=None)[0]
            print(f"nurrow: {key} fingertips to the lips: rel {tuple(round(v, 3) for v in rel)}, "
                  f"miss {np.linalg.norm(err(rel)) * 100:.1f} cm")
            _LIPS[key] = rel
        q = dict(p)
        ik = dict(p["ik"])
        ik["hand.L"] = HT(rel=tuple(float(v) for v in rel), pole=p["ik"]["hand.L"].pole)
        q["ik"] = ik
        return q

    # ── idle: breathing, the weight drifting foot to foot, the lull hand swaying, a slow look, the hat nodding ──
    def idle(t):
        b = anim.osc(t, 2)
        sw = anim.osc(t, 1, 0.1)
        look = anim.osc(t, 1, 0.35)
        d = P_(chest=(1.6 * b, 1.0 * sw, 0), spine=(0.6 * b, 0.8 * sw, 1.0 * sw), neck=(-1.0 * b + 1.5 * look, 3.0 * look, 0),
               head=(2.0 * anim.osc(t, 1, 0.6), 5.0 * look, 1.0 * sw), shoulder_L=(0, 0, 1.5 * b),
               shoulder_R=(0, 0, -1.5 * b), hips=(0, 2.0 * sw, -2.0 * sw))
        p = anim.add(g, d)
        ik = dict(p["ik"])
        r, l = GR[0], GL[0]
        ik["hand.R"] = HT(rel=(r[0], r[1] + 0.02 * sw, r[2] + 0.012 * b), pole=GR[1])
        ik["hand.L"] = HT(rel=(l[0] + 0.03 * anim.osc(t, 1, 0.2), l[1] + 0.02 * b, l[2] + 0.03 * anim.osc(t, 2, 0.3)),
                          pole=GL[1])
        ik["aim.L"] = AIM((GLAIM[0] + 0.12 * anim.osc(t, 1, 0.4), GLAIM[1], GLAIM[2] + 0.1 * anim.osc(t, 2, 0.1)))
        p["ik"] = ik
        p["hips_loc"] = (G_HIPS[0] + 0.014 * sw, G_HIPS[1], G_HIPS[2] - 0.006 * (0.5 + 0.5 * b))
        return p
    out["idle"] = anim.Clip("idle", 80, True, idle)

    # ── run: own cycle (planted foot exactly at RUN_REF while down), the lean from the hips ──
    N_RUN, C = 16, 0.36
    T_RUN = N_RUN / anim.FPS
    Ls = RUN_REF * C * T_RUN
    swing = [(0.00, Ls / 2, 0.0, -30.0), (0.20, Ls / 2 + 0.08, 0.17, -50.0), (0.46, 0.04, 0.27, -22.0),
             (0.70, -Ls / 2 - 0.06, 0.15, 2.0), (0.88, -Ls / 2 - 0.02, 0.05, 9.0), (1.00, -Ls / 2, 0.0, 7.0)]

    def swing_at(sq):
        for i in range(1, len(swing)):
            if sq <= swing[i][0]:
                a_, b_ = swing[i - 1], swing[i]
                u = anim.sine((sq - a_[0]) / (b_[0] - a_[0]))
                return tuple(a_[k] + (b_[k] - a_[k]) * u for k in (1, 2, 3))
        return swing[-1][1:]

    def foot_at(q):
        q %= 1.0
        if q < C:
            u = q / C
            y = -Ls / 2 + Ls * u
            pitch = 7.0 * (1.0 - anim.sine(min(1.0, u / 0.14))) - 30.0 * max(0.0, (u - 0.68) / 0.32) ** 1.5
            return (0.0, y, 0.0), pitch
        dy, dz, pitch = swing_at((q - C) / (1 - C))
        return (0.0, dy, dz), pitch

    def run(t):
        q = t % 1.0
        fl, pl = foot_at(q)
        fr, pr = foot_at(q + 0.5)
        sw = math.cos(2 * math.pi * (q - 0.04))         # + = left leg forward -> right arm forward
        bob = 0.022 * math.cos(2 * math.pi * (2 * q - C)) * 0.5 + 0.011
        yaw = -6.0 * math.cos(2 * math.pi * q)
        roll = 3.0 * math.sin(2 * math.pi * (q - C / 2))
        p = anim.merge(anim.arms_relaxed(), P_(
            hips=(9.5, yaw, roll), spine=(4.5, -yaw * 0.6, -roll * 0.6), chest=(3.0 + 1.2 * math.cos(4 * math.pi * q), -yaw * 0.5, -roll * 0.3),
            neck=(-3.0, yaw * 0.3, 0), head=(0.0, yaw * 0.25, 0)))
        ik = {"foot.L": FT((0.0 + fl[0], fl[1] - 0.02, fl[2]), pl, -4.0), "foot.R": FT((-0.0 + fr[0], fr[1] - 0.02, fr[2]), pr, 4.0)}
        ik["hand.R"] = HT(rel=(-0.30, -0.06 - 0.12 * sw, -0.88), pole=(-0.85, 0.45, -0.2))
        ik["aim.R"] = AIM((-0.45, 0.50, -0.74))          # fix pass 5: the blade trailing out-back (it pointed in under
        #                                                  the hat: invisible from the game camera)
        ik["hand.L"] = HT(rel=(0.20, 0.18 + 0.22 * sw, -0.82 + 0.06 * max(0.0, -sw)), pole=(0.85, 0.35, -0.3))
        ik["aim.L"] = AIM((0.10, 0.55, -0.83))
        p["ik"] = ik
        p["hips_loc"] = (0.012 * math.cos(2 * math.pi * (q - C / 2)), 0.03, -0.045 - bob)
        p["cape_drive"] = (-24.0 + 3.0 * math.cos(4 * math.pi * q), 0.0, 0.0)
        return p
    out["run"] = anim.Clip("run", N_RUN, True, run, meta={"run_ref_speed": RUN_REF, "stride_m": round(RUN_REF * T_RUN / 2, 3),
                                                          "cycle_s": round(T_RUN, 3)})

    # ── attack1: hooked slash, high right -> low left, a step in ──
    w1 = pose(dict(hips=(0, -14, 0), spine=(-2, -8, 2), chest=(-4, -12, 4), head=(0, 10, 0)), (0, 0.03, -0.005),
              R=((-0.42, 0.10, 0.18), (-0.70, 0.30, 0.60)), aim=(-0.20, 0.35, 0.92), L=((0.30, -0.45, -0.45), GL[1]))
    h1 = pose(dict(hips=(6, 14, 0), spine=(5, 10, -3), chest=(6, 14, -5), neck=(-4, 0, 0), head=(-8, -12, 0)), (0, -0.07, -0.03),
              R=((0.28, -0.88, -0.38), (-0.6, 0.3, -0.7)), aim=(0.72, -0.55, -0.42), L=((0.35, 0.15, -0.75), GL[1]),
              ft=feet(dl=(0.0, -0.10, 0.0)))
    f1 = pose(dict(hips=(7, 18, 0), spine=(6, 13, -3), chest=(7, 17, -6), neck=(-4, 0, 0), head=(-9, -14, 0)), (0, -0.08, -0.035),
              R=((0.48, -0.58, -0.58), (-0.4, 0.5, -0.7)), aim=(0.70, 0.05, -0.71), L=((0.35, 0.25, -0.78), GL[1]),
              ft=feet(dl=(0.0, -0.10, 0.0)))
    out["attack1"] = anim.Clip("attack1", 20, False, anim.drag(anim.keyed(anim.strike_keys(prof, w1, h1, f1, g)), 20,
                                                               {"head": 1.0, "neck": 0.5, "hand.L": 1.5}), impact=anim.IMPACT)

    # ── attack2: the left palm taps out (f4), then a rising right slash (f8) ──
    tap = pose(dict(hips=(4, 10, 0), spine=(2, 6, 0), chest=(2, 8, 0), head=(-2, -6, 0)), (0, -0.04, -0.01),
               L=((-0.02, -0.98, -0.10), (0.8, 0.2, -0.5)), laim=(0.0, -0.75, 0.66),
               R=((-0.36, 0.28, -0.78), (-0.8, 0.5, -0.2)), aim=(-0.25, 0.55, -0.80))
    coil = pose(dict(hips=(5, -6, 0), spine=(3, -4, 0), chest=(3, -6, 0), head=(-2, 4, 0)), (0, -0.05, -0.02),
                L=((0.10, -0.80, -0.25), (0.8, 0.2, -0.5)), laim=(0.0, -0.75, 0.66),
                R=((-0.40, 0.22, -0.82), (-0.8, 0.5, -0.2)), aim=(-0.30, 0.45, -0.84))
    h2 = pose(dict(hips=(3, 16, 0), spine=(0, 10, 0), chest=(-3, 14, 0), head=(2, -12, 0)), (0, -0.08, 0.0),
              R=((0.20, -0.88, 0.12), (-0.8, 0.2, -0.4)), aim=(0.52, -0.55, 0.65), L=((0.32, 0.10, -0.72), GL[1]),
              ft=feet(dr=(0.0, -0.06, 0.0)))
    f2 = pose(dict(hips=(2, 20, 0), spine=(-1, 13, 0), chest=(-4, 17, 0), head=(2, -14, 0)), (0, -0.09, 0.005),
              R=((0.32, -0.62, 0.36), (-0.8, 0.0, -0.4)), aim=(0.45, -0.15, 0.88), L=((0.34, 0.18, -0.75), GL[1]),
              ft=feet(dr=(0.0, -0.06, 0.0)))
    keys2 = [(0.0, g, "linear"), (0.10, tap, "out"), (0.22, tap, "linear"), (0.31, coil, "inout"),
             (0.40, h2, "accel"), (0.47, anim.lerp_pose(h2, f2, 0.3), "out"), (0.60, f2, "out"),
             (0.80, anim.lerp_pose(f2, g, 0.5), "inout"), (1.0, g, "settle")]
    out["attack2"] = clip("attack2", 20, keys2, {"head": 1.0, "neck": 0.5})

    # ── the lunge (Felt Step's and Lull the Rest's release, held by `dash`) ──
    lunge = pose(dict(hips=(34, 4, 0), spine=(12, 2, 0), chest=(6, 0, 0), neck=(-20, 0, 0), head=(-14, 0, 0)),
                 (0, -0.20, -0.20), R=((0.12, -0.96, -0.28), (-0.85, 0.3, -0.3)), aim=(0.08, -0.94, -0.33),
                 L=((0.30, 0.62, -0.58), (0.8, 0.4, 0.0)), laim=(0.2, 0.75, -0.62),
                 ft=feet(dl=LUNGE_FT["dl"], dr=LUNGE_FT["dr"], pr=-48.0), cape=-32.0)
    lunge2 = pose(dict(hips=(36, 4, 0), spine=(13, 2, 0), chest=(7, 0, 0), neck=(-21, 0, 0), head=(-15, 0, 0)),
                  (0, -0.21, -0.215), R=((0.14, -0.97, -0.25), (-0.85, 0.3, -0.3)), aim=(0.08, -0.95, -0.30),
                  L=((0.32, 0.64, -0.55), (0.8, 0.4, 0.0)), laim=(0.2, 0.75, -0.62),
                  ft=feet(dl=LUNGE_FT["dl"], dr=(0.02, 0.44, 0.06), pr=-52.0), cape=-36.0)

    # ── cast_a1 Felt Step (castTime 0.1): 2-frame crouch, the step-lunge at f6, held (hands off to dash) ──
    crouch = pose(dict(hips=(12, -4, 0), spine=(4, 0, 0), chest=(2, 0, 0), neck=(-6, 0, 0)), (0, 0.03, -0.05),
                  R=((-0.24, 0.32, -0.86), (-0.8, 0.5, -0.2)), aim=(-0.10, 0.62, -0.78), cape=-6.0)
    keysa1 = [(0.0, g, "linear"), (0.14, crouch, "out"), (0.40, lunge, "accel"), (0.55, lunge2, "out"),
              (1.0, lunge2, "linear")]
    out["cast_a1"] = clip("cast_a1", 15, keysa1, {"head": 0.7})
    # dash: the stalker's sprint under the lunge (brief: the stalker-run loop): the torso and the blade hold the
    #    lunge, the legs run one full stride cycle (left forward -> right forward -> left forward), the lull hand
    #    pumping, the cape streaming; starts and ends on cast_a1's held pose (a clean hand-off, no second swing)
    def dash_pose(lf, rf, lz, rz, lp, rp, sw):
        return pose(dict(hips=(34, 4 - 5 * sw, 0), spine=(12, 2 + 3 * sw, 0), chest=(6, 3 * sw, 0), neck=(-20, 0, 0),
                         head=(-15, -2 * sw, 0)), (0, -0.21, -0.20 + 0.02 * abs(sw)),
                    R=((0.14, -0.97, -0.25), (-0.85, 0.3, -0.3)), aim=(0.08, -0.95, -0.30),
                    L=((0.30, 0.62 - 0.45 * sw, -0.58 + 0.10 * sw), (0.8, 0.4, 0.0)), laim=(0.2, 0.75 - 0.9 * sw, -0.62),
                    ft=feet(dl=(0.04, lf, lz), dr=(0.02, rf, rz), pl=lp, pr=rp), cape=-36.0)
    d0 = dash_pose(-0.34, 0.44, 0.0, 0.06, 0.0, -52.0, 0.0)
    d1 = dash_pose(0.02, -0.04, 0.0, 0.20, -10.0, -30.0, -0.6)
    d2 = dash_pose(0.40, -0.34, 0.06, 0.0, -48.0, 0.0, 1.0)
    d3 = dash_pose(-0.04, 0.02, 0.20, 0.0, -30.0, -10.0, 0.6)
    d0 = lunge2
    out["dash"] = anim.Clip("dash", 10, False, anim.keyed([(0.0, d0, "linear"), (0.25, d1, "inout"), (0.5, d2, "inout"),
                                                           (0.75, d3, "inout"), (1.0, d0, "inout")]))

    # ── cast_a2 Lullaby Dart: hush (f0-f6), the flick at f10, recover by f25 ──
    hush = pose(dict(hips=(2, 6, 0), spine=(-2, 4, 0), chest=(-4, 6, 0), neck=(-10, -4, 0), head=(-10, -6, 0)), (0, 0.02, 0.0),
                L=((-0.36, -0.48, 0.10), (0.9, 0.1, -0.4)), laim=(-0.2, 0.0, 0.98))
    hush2 = pose(dict(hips=(1, 8, 0), spine=(-3, 5, 0), chest=(-5, 8, 0), neck=(-12, -5, 0), head=(-12, -7, 0)), (0, 0.03, 0.005),
                 L=((-0.30, -0.40, 0.18), (0.9, 0.2, -0.3)), laim=(-0.15, 0.2, 0.97))
    flick = pose(dict(hips=(6, -8, 0), spine=(4, -6, 0), chest=(4, -10, 0), neck=(-5, 4, 0), head=(-4, 6, 0)), (0, -0.05, -0.02),
                 L=((0.02, -0.99, 0.06), (0.8, 0.0, -0.6)), laim=(0.05, -0.97, 0.20), ft=feet(dl=(0.0, -0.06, 0.0)))
    flick2 = pose(dict(hips=(7, -10, 0), spine=(5, -7, 0), chest=(5, -12, 0), neck=(-4, 5, 0), head=(-3, 7, 0)), (0, -0.055, -0.025),
                  L=((0.06, -0.96, 0.02), (0.8, 0.0, -0.6)), laim=(0.1, -0.90, -0.40), ft=feet(dl=(0.0, -0.06, 0.0)))
    hush2 = to_lips(hush2, "hush")
    keysa2 = [(0.0, g, "linear"), (0.24, hush, "inout"), (0.33, hush2, "out"), (0.40, flick, "snap"),
              (0.48, flick2, "out"), (0.64, anim.lerp_pose(flick2, g, 0.35), "inout"), (1.0, g, "settle")]
    out["cast_a2"] = clip("cast_a2", 25, keysa2, {"head": 1.0, "neck": 0.5})

    # ── cast_a3 Snuff: low-back, up and over, the hooked capping arc down at f8 ──
    sl = pose(dict(hips=(4, -12, 0), spine=(2, -8, 0), chest=(0, -10, 0), head=(0, 8, 0)), (0, 0.02, -0.01),
              R=((-0.34, 0.36, -0.80), (-0.8, 0.5, -0.2)), aim=(-0.25, 0.70, -0.66), L=((0.20, -0.45, -0.55), GL[1]))
    over = pose(dict(hips=(-2, -6, 0), spine=(-4, -4, 0), chest=(-6, -6, 0), head=(-4, 4, 0)), (0, 0.01, 0.02),
                R=((-0.22, -0.20, 0.55), (-0.6, -0.3, 0.7)), aim=(0.05, -0.30, 0.95), L=((0.22, -0.40, -0.50), GL[1]))
    cap = pose(dict(hips=(11, 8, 0), spine=(5, 6, 0), chest=(5, 8, -7), neck=(-10, 0, 0), head=(-6, -4, 10)), (0, -0.06, -0.07),
               R=((0.08, -0.85, -0.22), (-0.7, 0.2, 0.2)), aim=(0.18, -0.50, -0.85), L=((0.12, -0.30, -0.62), GL[1]),
               laim=(-0.4, -0.3, -0.87), ft=feet(dl=(0.0, -0.06, 0.0)))
    cap2 = pose(dict(hips=(12, 9, 0), spine=(6, 6, 0), chest=(6, 9, -7), neck=(-10, 0, 0), head=(-5, -4, 10)), (0, -0.065, -0.08),
                R=((0.10, -0.80, -0.32), (-0.7, 0.2, 0.2)), aim=(0.20, -0.42, -0.89), L=((0.12, -0.28, -0.64), GL[1]),
                laim=(-0.4, -0.3, -0.87), ft=feet(dl=(0.0, -0.06, 0.0)))
    keysa3 = [(0.0, g, "linear"), (0.15, sl, "inout"), (0.28, over, "inout"), (0.40, cap, "accel"), (0.50, cap2, "out"),
              (0.66, anim.lerp_pose(cap2, g, 0.3), "inout"), (1.0, g, "settle")]
    out["cast_a3"] = clip("cast_a3", 20, keysa3, {"head": 1.0, "neck": 0.5})

    # ── cast_ult Lull the Rest: the curtain (f0-f14, breathing), the lunge at f16, landing low, palm down ──
    dip = pose(dict(hips=(10, 0, 0), spine=(4, 0, 0), chest=(4, 0, 0), neck=(4, 0, 0)), (0, 0.02, -0.04),
               R=((-0.30, -0.30, -0.80), GR[1]), L=((0.30, -0.30, -0.80), GL[1]))
    curtain = pose(dict(hips=(-2, 0, 0), spine=(-4, 0, 0), chest=(-8, 0, 0), neck=(-10, 0, 0), head=(-12, 0, 0),
                        shoulder_L=(0, 0, 6), shoulder_R=(0, 0, -6)), (0, 0.0, 0.015),
                   R=((-0.88, -0.30, 0.20), (-0.3, 0.4, -0.85)), aim=(-0.55, -0.35, 0.76),
                   L=((0.88, -0.30, 0.20), (0.3, 0.4, -0.85)), laim=(0.75, -0.35, 0.56), cape=6.0)
    curtain2 = pose(dict(hips=(-3, 0, 0), spine=(-5, 0, 0), chest=(-10, 0, 0), neck=(-11, 0, 0), head=(-13, 0, 0),
                         shoulder_L=(0, 0, 8), shoulder_R=(0, 0, -8)), (0, 0.0, 0.02),
                    R=((-0.92, -0.24, 0.26), (-0.3, 0.4, -0.85)), aim=(-0.55, -0.30, 0.78),
                    L=((0.92, -0.24, 0.26), (0.3, 0.4, -0.85)), laim=(0.80, -0.30, 0.52), cape=6.0)
    # the impact: a SPEAR (brief: 'a wide T, then a spear under a cone'): flatter and longer than Felt Step's lunge,
    #    the blade straight out level, the lull arm left open high behind her like the curtain's wing
    spear = pose(dict(hips=(40, 0, 0), spine=(14, 0, 0), chest=(8, 0, 0), neck=(-26, 0, 0), head=(-18, 0, 0)),
                 (0, -0.25, -0.24), R=((0.02, -0.99, -0.06), (-0.85, 0.3, -0.3)), aim=(0.0, -0.99, -0.12),
                 L=((0.70, 0.62, -0.22), (0.3, 0.6, 0.6)), laim=(0.62, 0.40, -0.67),      # (chest frame, pitched 62)
                 ft=feet(dl=(0.05, -0.40, 0.0), dr=(0.02, 0.48, 0.06), pr=-55.0), cape=-24.0)
    # the landing beside the target: a low crouch, the blade arm swept back low behind the right hip (done), the lull
    #    hand lowered in front of her PALM-DOWN (PalmAim: the back of the hand up), the head bowed toward it: the room
    #    falls quiet. Held f16-f30, then she straightens
    HUSH_UP = (0.0, 0.15, 1.0)
    land = pose(dict(hips=(16, 6, 0), spine=(4, 3, 0), chest=(0, 3, 0), neck=(-4, 0, 0), head=(-4, -2, 0)), (0, -0.10, -0.24),
                R=((-0.34, 0.40, -0.78), (-0.85, 0.3, -0.3)), aim=(-0.25, 0.62, -0.74),
                L=((0.04, -0.90, -0.24), (0.85, 0.25, -0.45)),
                ft=feet(dl=(0.04, -0.28, 0.0), dr=(0.0, 0.26, 0.03), pr=-40.0), cape=-10.0)
    land["ik"]["aim.L"] = PalmAim((0.02, -0.97, -0.22), 1.0, HUSH_UP, 1.0)
    land2 = pose(dict(hips=(15, 6, 0), spine=(4, 3, 0), chest=(0, 3, 0), neck=(-3, 0, 0), head=(-3, -2, 0)), (0, -0.10, -0.235),
                 R=((-0.34, 0.42, -0.77), (-0.85, 0.3, -0.3)), aim=(-0.25, 0.64, -0.73),
                 L=((0.04, -0.88, -0.30), (0.85, 0.25, -0.45)),
                 ft=feet(dl=(0.04, -0.28, 0.0), dr=(0.0, 0.26, 0.03), pr=-40.0), cape=-5.0)
    land2["ik"]["aim.L"] = PalmAim((0.02, -0.96, -0.27), 1.0, HUSH_UP, 1.0)

    def ult(t):
        p = anim.keyed([(0.0, g, "linear"), (0.07, dip, "inout"), (0.25, curtain, "out"), (0.35, curtain2, "inout"),
                        (0.40, spear, "accel"), (0.50, land, "out"), (0.75, land2, "inout"),
                        (0.90, anim.lerp_pose(land2, g, 0.6), "inout"), (1.0, g, "settle")])(t)
        if 0.22 < t < 0.40:                        # the held curtain breathes: chest and the open fingers move
            k = math.sin(math.pi * (t - 0.22) / 0.18)
            p = anim.add(p, P_(chest=(1.2 * k * anim.osc(t, 4), 0, 0), head=(0.8 * k * anim.osc(t, 5), 0, 0)))
            ik = dict(p["ik"])
            la = ik.get("aim.L")
            if la is not None:
                ik["aim.L"] = AIM((la.dir[0], la.dir[1] + 0.12 * k * anim.osc(t, 6), la.dir[2]))
            p["ik"] = ik
        return p
    out["cast_ult"] = anim.Clip("cast_ult", 40, False, anim.drag(ult, 40, {"head": 1.0, "neck": 0.5}), impact=anim.IMPACT)

    # ── death: the hit snaps the head back, she sinks to her knees, sways and slumps onto her right side, curled as
    #    if asleep (the lull hand in front of her face, the blade arm out along the ground), the cape settling behind
    #    her; the hat rolls off her head as she tips over and lies flat beside her (x_hat, `hat_roll`) ──
    hip_h = ctx.info.armature.data.bones["hips"].head_local.z
    recoil = pose(dict(hips=(-6, 8, 0), spine=(-8, 4, 0), chest=(-10, 4, 0), neck=(-8, 0, 0), head=(-12, 6, 0)), (0, 0.05, 0.0),
                  R=((-0.40, 0.10, -0.80), GR[1]), L=((0.40, 0.0, -0.70), GL[1]), cape=8.0)
    knees = pose(dict(hips=(14, 6, 0), spine=(6, 2, 0), chest=(4, 2, 0), neck=(4, 0, 0), head=(6, 0, 0)),
                 (0, 0.06, -hip_h * 0.40), R=((-0.35, -0.20, -0.85), GR[1]), aim=(0.3, -0.5, -0.8),
                 L=((0.30, -0.25, -0.85), GL[1]),
                 ft=feet(dl=(0.0, 0.10, 0.0), dr=(0.0, 0.18, 0.0), pl=-55.0, pr=-60.0), cape=0.0)
    sway = pose(dict(hips=(10, 4, 22), spine=(6, 0, 8), chest=(6, 0, 6), neck=(6, 0, 8), head=(8, 0, 10)),
                (-0.10, 0.07, -hip_h * 0.52), R=((-0.10, -0.45, -0.75), (-0.8, 0.3, -0.3)), aim=(-0.3, -0.6, -0.74),
                L=((0.05, -0.55, -0.60), GL[1]), laim=(-0.2, -0.6, -0.77),
                ft=feet(dl=(0.0, 0.12, 0.0), dr=(0.0, 0.20, 0.0), pl=-60.0, pr=-62.0), cape=0.0)
    FK0 = {"foot.L": FT((0.0, 0.0, 0.0), 0.0, 0.0, weight=0.0), "foot.R": FT((0.0, 0.0, 0.0), 0.0, 0.0, weight=0.0)}
    legs_curl = dict(thigh_L=(74, 0, -8), shin_L=(-104, 0, 0), foot_L=(24, 0, 0),
                     thigh_R=(66, 0, 4), shin_R=(-96, 0, 0), foot_R=(26, 0, 0))
    lie = pose(dict(hips=(4, 0, 86), spine=(10, 0, 2), chest=(10, 0, 0), neck=(8, 0, 12), head=(4, 4, 16), **legs_curl),
               (0.24, 0.02, -(hip_h - 0.15) - G_HIPS[2]), R=((0.05, -0.50, 0.80), (-0.3, 0.2, 0.9)), aim=(-0.55, -0.83, 0.05),
               L=((-0.62, -0.62, 0.32), (0.6, 0.3, 0.6)), laim=(-0.25, -0.65, -0.72), ft=FK0, cape=-6.0)
    bounce = anim.add(lie, P_(spine=(-3, 0, -4), chest=(-3, 0, -3), head=(0, 0, -6)))
    bounce["hips_loc"] = (lie["hips_loc"][0], lie["hips_loc"][1], lie["hips_loc"][2] + 0.03)
    rest = anim.add(lie, P_(head=(2, 0, 2), thigh_L=(4, 0, 0)))
    death_k = anim.keyed([(0.0, g, "linear"), (0.12, recoil, "snap"), (0.38, knees, "inout"), (0.54, sway, "inout"),
                          (0.74, lie, "in"), (0.81, bounce, "out"), (0.90, rest, "inout"), (1.0, rest, "linear")])

    def death(t):
        p = death_k(t)
        hr = hat_roll(t)
        if hr is not None:
            p = dict(p)
            p["x_hat"] = hr
        return p
    out["death"] = anim.Clip("death", 50, False, death, impact=None)

    # ── recall: the blade lowered, a hand over her heart, humming ──
    rec = pose(dict(hips=(2, 0, 0), spine=(2, 0, 0), chest=(2, 0, 0), neck=(3, 0, 0), head=(3, 0, 0)), (0, 0.0, -0.02),
               R=((-0.18, 0.02, -0.97), (-0.9, 0.3, -0.2)), aim=(0.05, -0.15, -0.99),
               L=((-0.42, -0.42, -0.30), (0.9, 0.2, -0.4)), laim=(-0.6, -0.2, 0.77), ft=feet(dl=(0.05, 0.04, 0), dr=(0.05, -0.04, 0)))

    def recall(t):
        b = anim.osc(t, 2)
        sw = anim.osc(t, 1)
        p = anim.add(rec, P_(chest=(1.0 * b, 0, 0), spine=(0, 0, 1.5 * sw), neck=(0, 2.0 * sw, 0), head=(1.5 * b, 3.0 * sw, 2.0 * sw)))
        p["hips_loc"] = (0.012 * sw, 0.0, -0.02 - 0.004 * b)
        return p
    out["recall"] = anim.Clip("recall", 60, True, recall)

    # ── idle_lobby: the slow sway to a tune, the lull hand conducting, a nod and the snap up a quarter toward the
    #    camera, a finger to the lips; loops ──
    lob = pose(dict(hips=(3, -4, 0), spine=(2, 2, 0), chest=(1, 2, 0), neck=(-12, 0, 0), head=(-15, 0, 0)), (0, 0.0, -0.025),
               ft=feet(dl=(0.04, 0.03, 0), dr=(0.04, -0.03, 0)))

    def lobby(t):
        sw = anim.osc(t, 2)
        nod = math.exp(-((t - 0.30) / 0.05) ** 2)
        snap = math.exp(-((t - 0.40) / 0.08) ** 2)
        lip = _ss(0.62, 0.70, t) * (1 - _ss(0.86, 0.94, t))
        p = anim.add(lob, P_(hips=(0, 3 * sw, -2.5 * sw), spine=(0, -2 * sw, 2 * sw), chest=(0, -2 * sw, 1.5 * sw),
                             neck=(14 * nod - 4 * snap, -6 * snap, 0), head=(10 * nod - 6 * snap, -14 * snap + 3 * sw, 4 * sw)))
        ik = dict(p["ik"])
        ph = 2 * math.pi * t * 3
        cond = (0.20 + 0.06 * math.sin(ph), -0.62 + 0.04 * math.sin(2 * ph), -0.30 + 0.08 * math.cos(ph))
        lips = (-0.36, -0.48, 0.12)
        ik["hand.L"] = HT(rel=tuple(cond[i] * (1 - lip) + lips[i] * lip for i in range(3)), pole=(0.9, 0.2, -0.4))
        ik["aim.L"] = AIM((-0.1 * (1 - lip) - 0.2 * lip, -0.7 * (1 - lip), -0.6 * (1 - lip) + 0.98 * lip))
        p["ik"] = ik
        p["hips_loc"] = (0.018 * sw, 0.0, -0.025 - 0.006 * abs(sw))
        return p
    out["idle_lobby"] = anim.Clip("idle_lobby", 120, True, lobby)

    # ── victory: the blade slipped into her belt (the right hand stays on its pommel, the blade down along her
    #    right hip), two fingers tip the hat back, the lull hand smooths a blanket over the camera, then the hold:
    #    a quarter turned toward the camera, the hat level (the closed lids show), the lull hand's fingertips at the
    #    lips below the beak ──
    BELT_R, BELT_AIM = ((0.0, -0.20, -0.74), (-0.9, 0.3, -0.2)), (-0.22, 0.10, -0.97)
    sheath = pose(dict(hips=(2, -6, 0), spine=(5, -4, 0), chest=(5, -6, 0), neck=(4, 4, 0), head=(10, 6, 0)), (0, 0.0, -0.02),
                  R=BELT_R, aim=BELT_AIM, L=((0.10, -0.40, -0.70), GL[1]))
    tiphat = pose(dict(hips=(0, 4, 0), spine=(-2, 2, 0), chest=(-4, 2, 0), neck=(-8, 0, 0), head=(-12, 0, 0)), (0, 0.0, -0.01),
                  R=BELT_R, aim=BELT_AIM, L=((-0.10, -0.62, 0.70), (0.9, 0.0, -0.3)), laim=(-0.3, -0.75, 0.6))
    smooth0 = pose(dict(hips=(-1, 6, 0), spine=(-3, 3, 0), chest=(-5, 4, 0), neck=(-8, 0, 0), head=(-10, -4, 0)), (0, 0.0, 0.0),
                   R=BELT_R, aim=BELT_AIM, L=((-0.05, -0.92, 0.08), (0.6, 0.3, -0.7)), laim=(0.25, -0.90, -0.36))
    smooth1 = pose(dict(hips=(-1, 14, 0), spine=(-3, 8, 0), chest=(-5, 10, 0), neck=(-8, 0, 0), head=(-10, 6, 0)), (0, 0.0, 0.0),
                   R=BELT_R, aim=BELT_AIM, L=((0.80, -0.52, 0.08), (0.6, 0.3, -0.7)), laim=(0.65, -0.70, -0.30))
    # fix pass 5 (review: 'the brim hides the lids and the hand covers the mouth: the sleeping face is unreadable in
    # the splash'): the head lifted 6 deg (the lids clear the brim), one fingertip at the LEFT CORNER of the smile, the
    # hand turned in under the jaw (the carved smile and both lids read)
    final = pose(dict(hips=(3, 20, 0), spine=(2, 6, 0), chest=(1, 6, 0), neck=(-5, -4, 0), head=(-9, -6, 3)), (0, 0.0, -0.025),
                 R=BELT_R, aim=BELT_AIM, L=((-0.36, -0.52, -0.22), (0.9, 0.1, -0.4)), laim=(-0.40, -0.28, 0.87),
                 ft=feet(dl=(0.03, -0.04, 0), dr=(0.0, 0.06, 0)), cape=-4.0)
    final = to_lips(final, "victory", lip=LIP_CORNER)

    def vic(t):
        p = anim.keyed([(0.0, g, "linear"), (0.20, sheath, "inout"), (0.36, tiphat, "inout"), (0.50, smooth0, "inout"),
                        (0.66, smooth1, "inout"), (0.84, final, "inout"), (1.0, final, "linear")])(t)
        if t > 0.84:
            k = min(1.0, (t - 0.84) / 0.1)
            p = anim.add(p, P_(chest=(0.8 * k * anim.osc(t, 2), 0, 0)))
        return p
    out["victory"] = anim.Clip("victory", 60, False, anim.drag(vic, 60, {"head": 1.5, "neck": 0.8}))

    # ── stunned: drowsy blinks and sways ──
    slump = pose(dict(hips=(2, 0, 0), spine=(4, 0, 0), chest=(2, 0, 0), neck=(-6, 0, 0), head=(-8, 0, 0)), (0, 0.0, -0.05),
                 R=((-0.20, -0.05, -0.95), GR[1]), aim=(0.1, -0.3, -0.95), L=((0.18, -0.10, -0.95), GL[1]),
                 laim=(0.0, -0.2, -0.98))

    def stunned(t):
        a_, b_ = anim.osc(t, 1), anim.osc(t, 1, 0.25)
        p = anim.add(slump, P_(hips=(0, 0, 4 * a_), spine=(1.5 * b_, 0, -4 * a_), chest=(1.5 * b_, 0, -4 * a_),
                               neck=(2 * b_, 0, 6 * a_), head=(3 * b_, 4 * a_, 9 * a_)))
        p["hips_loc"] = (0.02 * a_, 0.0, -0.05)
        return p
    out["stunned"] = anim.Clip("stunned", 40, True, stunned)

    # ── taunt: two fingers tip the hat forward, then a yawn (the head back, the lull hand at the mouth) ──
    tip = pose(dict(neck=(6, 0, 0), head=(10, 0, 0)), (0, 0, 0), L=((-0.18, -0.30, 0.42), (0.9, 0.0, -0.3)), laim=(-0.4, -0.6, 0.7))
    yawn = pose(dict(spine=(-6, 0, 0), chest=(-8, 0, 0), neck=(-14, 0, 0), head=(-16, 0, 0), shoulder_L=(0, 0, 6),
                     shoulder_R=(0, 0, -6)), (0, 0, 0.02), L=((-0.38, -0.46, 0.12), (0.9, 0.1, -0.4)), laim=(-0.3, -0.2, 0.93))
    out["taunt"] = anim.Clip("taunt", 60, False, anim.drag(anim.keyed([(0.0, g, "linear"), (0.20, tip, "inout"), (0.35, tip, "linear"),
                                                                        (0.60, yawn, "inout"), (0.80, yawn, "linear"),
                                                                        (1.0, g, "inout")]), 60, {"head": 1.0}))

    # ── crit: a turning backhand, the reverse of attack1: the blade coiled low across her left hip, the hips whip
    #    round and the blade rises from low-left to high-right in one long hooked arc (f10), a step with the right
    #    foot, the lull hand flung out for balance, the follow-through high behind her right shoulder ──
    cw = pose(dict(hips=(6, 26, 0), spine=(4, 14, 0), chest=(4, 18, 4), neck=(-4, -8, 0), head=(-8, -14, 0)),
              (0, 0.02, -0.03), R=((0.32, -0.42, -0.72), (-0.6, 0.5, -0.6)), aim=(0.62, 0.22, -0.75),
              L=((0.42, 0.32, -0.68), GL[1]), laim=(0.2, 0.6, -0.77), cape=-4.0)
    cw2 = anim.add(cw, P_(hips=(1, 4, 0), chest=(1, 4, 0)))
    ch_ = pose(dict(hips=(2, -22, 0), spine=(-2, -14, 0), chest=(-4, -18, -5), neck=(-4, 8, 0), head=(-8, 14, 0)),
               (0, -0.08, -0.02), R=((-0.55, -0.55, 0.42), (-0.6, 0.3, -0.7)), aim=(-0.45, -0.58, 0.68),
               L=((0.62, -0.30, -0.45), (0.85, 0.2, -0.4)), laim=(0.75, -0.40, -0.52),
               ft=feet(dr=(-0.03, -0.12, 0.0)), cape=-12.0)
    cf_ = pose(dict(hips=(0, -32, 0), spine=(-3, -18, 0), chest=(-5, -22, -6), neck=(-4, 10, 0), head=(-8, 18, 0)),
               (0, -0.09, -0.01), R=((-0.62, 0.10, 0.62), (-0.6, 0.3, -0.7)), aim=(-0.55, 0.40, 0.73),
               L=((0.66, -0.20, -0.50), (0.85, 0.2, -0.4)), laim=(0.75, -0.30, -0.59),
               ft=feet(dr=(-0.03, -0.12, 0.0)), cape=-6.0)
    keysc = [(0.0, g, "linear"), (0.12, anim.lerp_pose(g, cw, 0.6), "inout"), (0.24, cw, "out"), (0.33, cw2, "inout"),
             (0.40, ch_, "accel"), (0.50, anim.lerp_pose(ch_, cf_, 0.6), "out"), (0.64, cf_, "out"),
             (0.82, anim.lerp_pose(cf_, g, 0.55), "inout"), (1.0, g, "settle")]
    out["crit"] = clip("crit", 25, keysc, {"head": 1.0, "neck": 0.5, "hand.L": 1.0})

    # ── channel: the lull hand raised, palm out, humming ──
    ch = pose(dict(neck=(-4, 0, 0), head=(-6, 0, 0)), (0, 0, -0.01), L=((0.12, -0.78, 0.10), (0.85, 0.2, -0.5)),
              laim=(0.0, -0.4, 0.92))
    out["channel"] = anim.Clip("channel", 40, True, lambda t: anim.add(ch, P_(chest=(1.2 * anim.osc(t, 2), 0, 0),
                                                                              head=(1.0 * anim.osc(t, 2, 0.2), 0, 0))))
    return out


if __name__ == "__main__":
    _install_bind()
    _install_paint()
    _install_anim()
    _install_render()
    fighter.main(sys.modules[__name__])
