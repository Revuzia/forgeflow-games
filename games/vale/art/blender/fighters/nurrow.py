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
concept's blue rim studs (gems) become sixteen accent-glass lozenges set into the rim's upper bevel (the brief's
inlays: the colour reads from any angle, including from above), the brooch's stone an accent lens; the hat's
lacquer keeps the concept's ochre hue and value but its chroma is held under the bible's 40 % in the marigold band.

Plates (proto/nurrow_plates.py): the concept's stance is wide and asymmetric; the model is bound in a symmetric
stance (every clip and the run work from one rest pose) and the plates re-pose the painted legs onto it.

Not in the shared pipeline, implemented here (module-level wrappers installed for this build only; common/ is
untouched): part binding restricted to named bones ("auto_only"), the projection paint (the painted blade taken off
the plate and every part behind it filled from its own paint; procedural lacquer on the hat, iron on the rim / knob,
the blade with its pale bevel, the grip, the brown head wrap, the red-brown belt; side planes; a value pass), the
skin re-colour, the foot solver's pitch sign.
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
# printed pale cone with ink slat lines under an ink brim band, the light-rimmed hem. No extra geometry (brief).
SKINS: list = [
    {"id": "nurrow_noon_fair", "extra": {}, "card": {"primary": "#6A4F5E", "secondary": "#E2D6C3"},
     "palette": {"sandstone": "#E2D6C3", "moth": "#B48AA6", "wood": "#D3C0A0", "cloth": "#8C7886",
                 "under": "#56384A", "cloth2": "#B8A48E"}},
    {"id": "nurrow_shadeprint", "extra": {}, "card": {"primary": "#2B2A33", "secondary": "#B7B4BE"},
     "palette": {"sandstone": "#2B2A33", "chalk": "#D8D5DE", "wood": "#B7B4BE", "cloth": "#847C8E",
                 "ironstone": "#4B4955", "under": "#33303F", "cloth2": "#A8A5B3"}},
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
RIM_N = 16                # accent lozenges round the rim (the concept's studs, brief: inlays on the rim)
RIM_PHASE = 11.25         # degrees: a lozenge either side of the front (-Y), none dead centre over the beak


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
        b = 0.095 + 0.16 * s
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
    rim.add(Lathe(HAT_C, rim_prof, BRIM_R + 0.03, -0.04, 0.03, axes=HAT_AX).displaced(chips(0.003, 30.0), 0.003), k=0.0)
    glass = Sculpt("hat_inlays")
    for i in range(RIM_N):
        phi = RIM_PHASE + 360.0 * i / RIM_N
        rd = rim_angle_dir(phi)
        tg = np.cross(V3([0, 0, 1.0]), rd)
        nrm = unit(rd * 0.62 + V3([0, 0, 1.0]) * 0.78)                 # the rim's upper-outer bevel
        c_loc = rd * (BRIM_R + 0.004) + V3([0, 0, 0.006])
        n_w, t_w = HAT_R @ nrm, HAT_R @ tg
        b_w = np.cross(n_w, t_w)
        c_w = hat_w(c_loc)
        ax = np.stack([unit(t_w), unit(b_w), unit(n_w)])
        glass.add(Ellipsoid(c_w - n_w * 0.0035, (0.033, 0.0145, 0.0088), axes=ax), k=0.0)
        rim.sub(Ellipsoid(c_w - n_w * 0.003, (0.038, 0.0185, 0.0105), axes=ax), k=0.003)   # the setting's lip
        # a rivet between this lozenge and the next, on the outer face
        phr = phi + 180.0 / RIM_N
        rr = rim_angle_dir(phr)
        rim.add(Sphere(hat_w(rr * (BRIM_R + 0.011) + V3([0, 0, -0.012])), 0.0075), k=0.004)
    part("hat_rim", rim, "ironstone", "bone:x_hat", 1100, 0.6)
    part("hat_inlays", glass, "accent", "bone:x_hat", 520, 0.5)

    def disc_prof(r, z):
        zc, hz, hr, cr = CONE_H - 0.004, 0.011, 0.044, 0.007
        q0 = r - hr + cr
        q1 = np.abs(z - zc) - hz + cr
        return np.hypot(np.maximum(q0, 0), np.maximum(q1, 0)) + np.minimum(np.maximum(q0, q1), 0) - cr

    knob = Sculpt("hat_knob")
    knob.add(HatSheared(Lathe(HAT_C, disc_prof, 0.06, CONE_H - 0.03, CONE_H + 0.02, axes=HAT_AX)), k=0.0)
    h = CONE_H
    stem = [(0.0, 0.0, h), (0.0, 0.002, h + 0.045), (0.003, -0.010, h + 0.082), (0.010, -0.032, h + 0.103),
            (0.016, -0.054, h + 0.104), (0.019, -0.066, h + 0.096)]
    knob.add(Tube([hat_ws(p) for p in stem], [0.017, 0.0145, 0.012, 0.010, 0.0085, 0.006], k=0.01), k=0.012)
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
        a, b = np.array([0.101, -0.014]), np.array([0.072, 0.118])
        d = b - a
        L = float(np.hypot(*d))
        u = np.clip(((r - a[0]) * d[0] + (z - a[1]) * d[1]) / (L * L), 0, 1)
        return np.hypot(r - (a[0] + u * d[0]), z - (a[1] + u * d[1])) - 0.004

    band = Sculpt("hat_band")
    band.add(Lathe(HAT_C, basket_prof, 0.12, -0.03, 0.13, axes=HAT_AX), k=0.0)
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

    # the brooch: a carved wooden ring on a flat back plate, its glass lens (the concept's blue stone) proud of the
    # ring so it reads in the portrait
    brooch = Sculpt("brooch")
    bc, bn = BROOCH
    brooch.add(Torus(bc, 0.025, 0.0085, axes=sdf.frame(bn)), k=0.0)
    brooch.add(Ellipsoid(bc - bn * 0.003, (0.024, 0.024, 0.006), axes=sdf.frame(bn)), k=0.004)
    part("brooch", brooch, "wood_dark", "bone:chest", 180, 0.5)
    stone = Sculpt("brooch_glass")
    stone.add(Ellipsoid(bc + bn * 0.006, (0.0165, 0.0165, 0.0095), axes=sdf.frame(bn)), k=0.0)
    part("brooch_glass", stone, "accent", "bone:chest", 90, 0.4)

    # strap from the right shoulder down the chest, a square buckle
    straps = Sculpt("straps")
    straps.add(Tube([(-0.135, -0.075, 1.43), (-0.128, -0.118, 1.36), (-0.118, -0.128, 1.27), (-0.10, -0.125, 1.17),
                     (-0.07, -0.12, 1.10)], [0.016, 0.016, 0.016, 0.015, 0.015], k=0.01), k=0.0)
    straps.add(RoundBox((-0.119, -0.138, 1.272), (0.024, 0.007, 0.026), 0.005), k=0.004)
    straps.sub(RoundBox((-0.119, -0.142, 1.272), (0.013, 0.006, 0.015), 0.003), k=0.002)
    part("straps", straps, "leather", ("auto_only", "spine", "chest"), 360, 0.6)

    # ── PAULDRON (right shoulder): three carved wooden lames ──
    paul = Sculpt("pauldron")
    O = V3([-0.235, 0.012, 1.352])
    for i in range(3):
        c = O + V3([-0.014 * i, 0.0, -0.038 * i])
        rr = V3([0.118 + 0.01 * i, 0.112 + 0.006 * i, 0.088])
        lame = Sculpt(f"lame{i}")
        lame.add(Ellipsoid(c, rr), k=0.0)
        lame.sub(Ellipsoid(c + V3([0.006, 0, -0.004]), rr - 0.016), k=0.004)
        lame.inter(HalfSpace((-0.175, 0, 1.40), (1, 0, 0.35), 1.0), k=0.01)
        ztop = 1.475 - 0.045 * i
        lame.inter(HalfSpace((0, 0, ztop), (0, 0, 1), 1.0), k=0.01)
        lame.inter(HalfSpace((0, 0, ztop - 0.095), (0, 0, -1), 1.0), k=0.008)
        paul.add(sdf.Blend([(op, pr, k_) for op, pr, k_, _ in lame.ops]).displaced(chips(0.002, 22.0), 0.002), k=0.004)
        for j in (-1, 1):                                                                  # rivets
            paul.add(Sphere(c + V3([-rr[0] * 0.80, j * 0.055, -0.035]), 0.0085), k=0.003)
    part("pauldron", paul, "wood_dark", ("dblend", "shoulder.R", "upper_arm.R", (-0.20, 0.012, 1.40),
                                          (-0.75, 0.0, -0.66), 0.02, 0.10), 700, 0.6)

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
    part("tassets", tass, "wood_dark", ("auto_only", "hips", "thigh.L", "thigh.R"), 700, 0.7)

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
    fist.add(RoundBox(pc, (0.047, 0.046, 0.028), 0.02, axes=F), k=0.0)
    gax = GRIP_AX
    for i, s_ in enumerate((-0.033, -0.011, 0.011, 0.033)):
        cc = FIST_R + gax * s_ + F[2] * 0.005
        fist.add(Torus(cc, 0.031 - 0.002 * abs(i - 1.5), 0.0135, axes=sdf.frame(gax)), k=0.006)
    th0 = hl("R", (0.04, 0.03, -0.012))
    side_ = unit(F[0] - gax * float(F[0] @ gax))
    th1 = FIST_R + gax * 0.04 + side_ * 0.028
    fist.add(Tube([th0, (th0 + th1) / 2 + F[0] * 0.007, th1], [0.019, 0.015, 0.013], k=0.006), k=0.012)
    fist.sub(Capsule(FIST_R - gax * 0.07, FIST_R + gax * 0.07, 0.0165), k=0.002)            # the grip's channel
    part("hand_R", fist, "hand_wood", "bone:hand.R", 650, 0.55)

    # the open left hand (the lull hand): palm, four jointed fingers loosely curled, the thumb out
    hand = Sculpt("hand_L")
    FL = hand_frame("L", HD_L)
    HS = 1.18                       # the lull hand: stylised big (brief: hands x1.45 of a human's)
    hand.add(RoundBox(hl("L", (0.0, 0.052 * HS, 0.0), y=HD_L), (0.042 * HS, 0.050 * HS, 0.016 * HS), 0.014, axes=FL), k=0.0)
    hand.add(Ellipsoid(hl("L", (0.008, 0.014, -0.004), y=HD_L), (0.038 * HS, 0.03 * HS, 0.022 * HS), axes=FL), k=0.02)
    for fi, (x0, spread, l0, curl) in enumerate(((0.026, 9.0, 0.046, 14.0), (0.009, 2.0, 0.050, 19.0),
                                                  (-0.009, -5.0, 0.047, 25.0), (-0.026, -12.0, 0.038, 33.0))):
        p = hl("L", (x0 * HS, 0.100 * HS, 0.002), y=HD_L)
        d = unit(FL[1] * math.cos(math.radians(spread)) + FL[0] * math.sin(math.radians(spread)))
        pts, rad = [p], [0.0125]
        segs = (l0 * HS, l0 * 0.72 * HS, l0 * 0.55 * HS)
        ang = 0.0
        for k_, L in enumerate(segs):
            ang += math.radians(curl * (0.7 + 0.3 * k_))
            dd = unit(d * math.cos(ang) - FL[2] * math.sin(ang))
            p = p + dd * L
            pts.append(p)
            rad.append(0.0115 - 0.0019 * (k_ + 1))
        hand.add(Tube(pts, rad, k=0.004), k=0.008)
        for q in pts[1:-1]:
            hand.add(Sphere(q, rad[1] * 1.06), k=0.003)                                     # the carved joints
    tb0 = hl("L", (0.040, 0.024, -0.008), y=HD_L)
    tb1 = tb0 + unit(FL[0] * 0.75 + FL[1] * 0.55 - FL[2] * 0.35) * 0.052
    tb2 = tb1 + unit(FL[0] * 0.35 + FL[1] * 0.85 - FL[2] * 0.4) * 0.04
    hand.add(Tube([tb0, tb1, tb2], [0.017, 0.013, 0.010], k=0.005), k=0.01)
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
    part("trousers", trousers, "under", ("auto_only", "hips", "spine", "thigh.L", "thigh.R", "shin.L", "shin.R"), 1300)

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
        ax = np.stack([unit(np.cross(fwd, V3([0, 0, 1.0]))), fwd, V3([0, 0, 1.0])])
        foot_c = V3([ANK[s][0], ANK[s][1], 0.0]) + fwd * 0.055 + V3([0, 0, 0.045])
        boots.add(RoundBox(foot_c, (0.052, 0.128, 0.045), 0.038, axes=ax), k=0.0)
        boots.add(Ellipsoid(foot_c + fwd * 0.07 + V3([0, 0, -0.005]), (0.05, 0.065, 0.04), axes=ax), k=0.03)
        boots.add(FlatCapsule(V3([ANK[s][0], ANK[s][1], 0.08]), V3([ANK[s][0], ANK[s][1] - 0.004, 0.215]),
                              0.064, 0.068, 0.062, 0.066, side=(1, 0, 0)), k=0.04)
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


def cone_low(N=64, K=6, K_in=4, r0=0.03):
    """the hat's game mesh, built clean (a decimated voxel cone pinched into dents that the bake turned into dark
    smudges on the lacquer): outer rings on z = h (1 - r / R), the underside offset by the shell thickness, the brim
    edge and the apex closed (under the knob's disc). Returns (verts world, quads)."""
    s = CONE_H / BRIM_R
    nrm = np.array([s, 1.0]) / math.hypot(s, 1.0)              # the outer line's normal in (r, z)
    phis = np.linspace(0, 2 * math.pi, N, endpoint=False)
    rings = []
    for k in range(K + 1):
        r = r0 + (BRIM_R - r0) * (k / K) ** 0.85
        rings.append((r, CONE_H * (1 - r / BRIM_R)))
    inner = []
    for k in range(K_in + 1):
        r = r0 + (BRIM_R - r0) * (k / K_in)
        ro, zo = r, CONE_H * (1 - r / BRIM_R)
        inner.append((ro - nrm[0] * CONE_T, zo - nrm[1] * CONE_T))
    prof = rings + inner[::-1]                                   # outer apex -> brim, then inner brim -> apex
    V, F = [], []
    for (r, z) in prof:
        for ph in phis:
            V.append(hat_ws((r * math.sin(ph), -r * math.cos(ph), z)))
    nr = len(prof)
    for i in range(nr):                                          # the closing strip (inner apex -> outer apex) wraps
        j = (i + 1) % nr
        for a in range(N):
            b = (a + 1) % N
            F.append((i * N + a, i * N + b, j * N + b, j * N + a))
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
            lv, lq = cone_low()
            low = sdf.to_object(f"{name}_low", lv, lq, ctx.col)
            low.data.materials.append(ctx.mats[role])
            mesh.cleanup(low, merge=1e-5, recalc=True, loose=False)
            P.append(fighter.Part(name, high=ob, low=low, bind=bind))
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
    tip = hl("L", (0.0, 0.215, -0.02), y=HD_L)
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


def hat_roll(t: float):
    """x_hat's local rotation (deg XYZ) at death time t: on the head until she tips over, then rolling off"""
    from mathutils import Quaternion
    q = HAT_DEATH.get("q")
    if q is None:
        return None
    w = _ss(0.50, 0.80, t)
    w = w - 0.05 * math.sin(math.pi * _ss(0.80, 0.92, t)) * (t > 0.80)       # a small bounce as it lands
    qq = Quaternion().slerp(q, float(min(1.0, max(0.0, w))))
    return tuple(math.degrees(a) for a in qq.to_euler("XYZ"))


def chain_config(ctx) -> list:
    """the cape: a heavy felt (low stiffness, gravity-led, a run lifts it back through the poses' `cape_drive`);
    the tabard pushed forward by whichever thigh flexes"""
    def cape_drive(pose):
        return pose.get("cape_drive", (0.0, 0.0, 0.0))[0]

    def tabard_drive(pose):
        fl = max(pose.get("thigh.L", (0.0,))[0], pose.get("thigh.R", (0.0,))[0], 0.0)
        return 0.85 * fl
    out = [anim.ChainCfg(ctx.chains["cape"], gravity=0.7, stiffness=140.0, damping=23.0, inertia=0.18,
                         drive=cape_drive, limit=(-40.0, 30.0), floor=0.03),
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
# the concept's lacquer (front: cream-gold lit, ochre mid, a warm shade toward her left and the back), its chroma held
# near 50 % (HSV) as authored: the game's neutral tone map shows ~45 % ochre, the QA's AgX a paler gold
HAT_COLS = {"deep": "#7E5A2E", "shade": "#A57B40", "mid": "#C49A55", "lit": "#DDB76E", "hi": "#ECCF8E",
            "under": "#5A3E28", "under_deep": "#2E2219"}
IRON = {"base": "#3D373E", "shade": "#242026", "lit": "#5F5862", "chip": "#8A818C"}
BLADE_OWNER = "blade"
# stray dark / saturated texels (trousers seen through the painted slits, shadow notches): (min lum ratio, max sat)
DESPECKLE = {"cape": ((0.66, 0.34), (0.45, 1.0)), "cowl": ((0.55, 0.36), (0.5, 1.0)), "trousers": ((0.5, 0.6), (0.5, 0.6))}
# the felt and the legs lighter than the concept's back view (the bible's middle and feet bands, lineup_qa: the game
# camera sees mostly the cape, and the dark plum body sank into the lane)
TONE = {"cape": 1.95, "cowl": 1.6, "trousers": 1.3, "legwraps": 1.3, "boots": 1.18, "tabard": 1.15, "sleeves": 1.15}
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


# the skins' lacquer (brief §9; no large area lighter than L* 86): Noon Fair's pale chalky ochre ground, Shadeprint's
# pale printed cone (its ink is the brim band, the slat lines and the underside)
HAT_SKIN = {"nurrow_noon_fair": {"deep": "#988670", "shade": "#B3A287", "mid": "#C9BAA0", "lit": "#D8CBB4", "hi": "#DFD3BF",
                                 "under": "#5E4A3A", "under_deep": "#2F2620"},
            "nurrow_shadeprint": {"deep": "#131218", "shade": "#1C1B23", "mid": "#2B2A33", "lit": "#3D3C49", "hi": "#4D4C5A",
                                  "under": "#2B2A33", "under_deep": "#1A191F"}}
MOTH = ("#B48AA6", "#8A6680", "#E2D6C3")       # Noon Fair's lacquer moths: rose-lilac, its dark vein, a chalk dot
INK = "#2B2A33"


def _moths(phi, r):
    """Noon Fair: ten lacquer moths in a ring round the cone (wing mask, dark vein mask, chalk dot mask)"""
    wing = np.zeros_like(r)
    vein = np.zeros_like(r)
    dot = np.zeros_like(r)
    for i in range(10):
        pc = math.radians(8.0 + 36.0 * i)
        rc = 0.50 if i % 2 == 0 else 0.68
        dph = (phi - pc + math.pi) % (2 * math.pi) - math.pi
        u = dph * r * BRIM_R / 1.4                # across (arc), m (the moths drawn 1.4x their first size)
        w = (r - rc) * BRIM_R / 1.4               # along the slope, m (+ toward the brim)
        sgn = 1 if i % 3 else -1                  # a few face the other way
        w = w * sgn
        for sx in (-1, 1):
            for (cx, cy, ax, ay, rot) in ((0.026, 0.010, 0.030, 0.017, 28.0), (0.018, -0.016, 0.019, 0.013, -32.0)):
                a = math.radians(rot * sx)
                uu, ww = u - sx * cx, w - cy
                x1 = uu * math.cos(a) + ww * math.sin(a)
                y1 = -uu * math.sin(a) + ww * math.cos(a)
                e = (x1 / ax) ** 2 + (y1 / ay) ** 2
                wing = np.maximum(wing, _ss(1.05, 0.85, e))
                vein = np.maximum(vein, _ss(1.25, 1.02, e) * (1 - _ss(1.02, 0.9, e)))
            dd = ((u - sx * 0.03) / 0.006) ** 2 + ((w - 0.014) / 0.006) ** 2
            dot = np.maximum(dot, _ss(1.1, 0.7, dd))
        body = (u / 0.0045) ** 2 + (w / 0.022) ** 2
        wing = np.maximum(wing, _ss(1.1, 0.8, body))
        vein = np.maximum(vein, _ss(1.1, 0.8, body) * 0.8)
    return wing, vein, dot


def paint_hat(p, n):
    """the lacquered cone, painted: hat-local radius / angle, the key light on the true normal, radial strokes"""
    sid = _SKIN.get("id")
    C = {k: _hexs(v) for k, v in HAT_SKIN.get(sid, HAT_COLS).items()}
    q = hat_unshear(hat_local(p))
    nl = n @ HAT_R
    r = np.hypot(q[:, 0], q[:, 1]) / BRIM_R
    phi = np.arctan2(q[:, 0], -q[:, 1])
    lam = np.clip(n @ KEY, 0.0, 1.0)
    t = np.clip((lam - 0.25) / 0.62, 0.0, 1.0)
    # brushed lacquer: streaks along the slope (constant phi), a slow mottle, slat lines
    pts = np.stack([np.cos(phi) * 9.0, np.sin(phi) * 9.0, r * 0.8], 1)
    streak = NOISE(pts, 3.0) * 0.6 + NOISE(pts, 7.0) * 0.4
    mottle = NOISE.fbm(p, 6.0, 3)
    slat = np.clip((np.abs(np.sin(phi * 18.0 + 0.15 * NOISE(p, 9.0))) - 0.965) / 0.035, 0, 1)
    v = 0.10 + 0.86 * t + 0.06 * streak + 0.04 * mottle + 0.06 * _ss(0.0, 0.35, r) * (1 - _ss(0.35, 0.6, r))
    v = v - 0.10 * _ss(0.86, 1.0, r) - 0.04 * slat
    v = np.clip(v, 0.0, 1.0)
    col = np.where((v < 0.25)[:, None], _mix(C["deep"], C["shade"], v / 0.25),
          np.where((v < 0.5)[:, None], _mix(C["shade"], C["mid"], (v - 0.25) / 0.25),
          np.where((v < 0.78)[:, None], _mix(C["mid"], C["lit"], (v - 0.5) / 0.28),
                   _mix(C["lit"], C["hi"], (v - 0.78) / 0.22))))
    if sid == "nurrow_noon_fair":
        wing, vein, dot = _moths(phi, r)
        mc = _mix(_hexs(MOTH[0]) * 0.85, _hexs(MOTH[0]) * 1.06, t)
        band = _ss(0.835, 0.85, r) * (1 - _ss(0.93, 0.945, r))           # a rose-lilac lacquer band inside the rim
        col = _mix(col, mc * 0.96, band)
        col = _mix(col, mc, wing)
        col = _mix(col, _hexs(MOTH[1]), 0.7 * vein * wing)
        col = _mix(col, _hexs(MOTH[2]), dot)
    elif sid == "nurrow_shadeprint":
        # the ink-wash cone printed in light: twelve pale rays from the knob, a pale ring across them, a fine light
        # line inside the brim (the rim itself is painted light: paint_rim)
        chalk = _mix(_hexs("#A9A5B4"), _hexs("#D8D5DE"), np.clip(0.3 + 0.8 * t, 0, 1))
        ray = np.clip((np.abs(np.cos(phi * 6.0 + 0.08 * NOISE(p, 9.0))) - 0.86) / 0.07, 0, 1)
        ray = ray * _ss(0.14, 0.22, r) * (1 - _ss(0.80, 0.86, r))
        ring = _ss(0.55, 0.57, r) * (1 - _ss(0.65, 0.67, r))
        rim_line = _ss(0.885, 0.895, r) * (1 - _ss(0.915, 0.925, r))
        grain_ = 0.85 + 0.15 * NOISE(pts, 11.0)
        col = _mix(col, chalk, np.clip(np.maximum(np.maximum(ray, ring), rim_line) * grain_, 0, 1))
    # the underside: dark lacquer, darker toward the crown, a warm bounce near the brim
    under = _mix(C["under_deep"], C["under"], _ss(0.2, 0.95, r))
    col = np.where((nl[:, 2] < -0.2)[:, None], under, col)
    return col.astype(np.float32)


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
    return _mix(_hexs("#3E2A22"), _hexs("#9A6E50"), np.clip(v, 0, 1)).astype(np.float32)


def paint_rim(p, n):
    """the hat's rim: matte painted ironstone (Shadeprint: the LIGHT rim of its ink hat, chalk over an ink underside)"""
    if _SKIN.get("id") == "nurrow_shadeprint":
        col = paint_iron(p, n, cols=RIM_LIGHT)
        nl = n @ HAT_R
        return _mix(col, _hexs(INK), _ss(-0.15, -0.45, nl[:, 2])).astype(np.float32)
    return paint_iron(p, n)


RIM_LIGHT = {"base": "#BEBAC7", "shade": "#8C8897", "lit": "#D6D3DD", "chip": "#9D99A8"}


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
    col = _mix(_hexs("#26232A"), _hexs("#3B3740"), np.clip(0.5 + 0.6 * mott + 0.25 * lam, 0, 1))
    col = _mix(col, _hexs("#5B5762"), 0.55 * crack)
    bev = _ss(0.020, 0.012, d_edge) * np.clip(u / 0.03, 0, 1)
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
    for nm, fn in (("hat_cone", paint_hat), ("hat_rim", paint_rim), ("hat_knob", paint_iron), (BLADE_OWNER, paint_blade),
                   ("grip", paint_grip), ("head", paint_head), ("hat_band", paint_band), ("belt_strap", paint_strap)):
        m = sel(nm)
        if m.any():
            out[m] = fn(P[m].astype(np.float64), N[m].astype(np.float64))
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
            if nm in (BLADE_OWNER, "grip", "hat_cone", "hat_rim", "hat_knob", "head", "hat_band", "belt_strap"):
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
    for nm, (s0, s1), fq in (("cape", (0.62, 0.86), 7.0), ("cowl", (0.30, 0.62), 9.0)):
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
            felt = base[None, :] * (0.80 + 0.34 * lam + 0.06 * fold + 0.05 * NOISE.fbm(pc, 7.0, 3))[:, None]
            sub = _mix(sub, felt.astype(np.float32), sidew)
            out[m] = sub
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
            out[m] = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(np.clip(lin, 0, 1), 1 / 2.4) - 0.055)
    _lift_ao([sel(nm) for nm in AO_FLOOR], list(AO_FLOOR.values()), log)
    if bleed:
        iy, ix = project.nearest_index(have)
        out = out[iy, ix]
    return out


# the whole-body AO is baked in the REST pose: the hanging arms, fists and blade shadow the cape's sides there, and
# the moment the cape swings those shadows show as dark blots on the felt. The cape's AO is floored (its own folds
# keep a little) before the bake multiplies it into the base and packs it into the ORM (bake.bake_asset reads the AO
# image after this paint hook runs).
AO_FLOOR = {"cape": 0.82, "tabard": 0.7}
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


PAINTED = ("hat_cone", "hat_rim", "hat_knob")      # painted in the skin's own colours by nurrow_paint


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
    if sid == "nurrow_shadeprint" and "cape" in names:
        m = part == names.index("cape")
        pc = P[m].astype(np.float64)
        ax_, ay_ = CAPE.axis(pc[:, 2])
        th = np.arctan2(pc[:, 0] - ax_, pc[:, 1] - ay_)
        dz = pc[:, 2] - CAPE.hem_z(th)
        # printed in light and ink: a broad pale print band above the ragged hem, an ink rule over it, a thin pale
        # line higher up, the ink edge
        grain_ = 0.85 + 0.15 * NOISE(pc, 25.0)
        band = _ss(0.20, 0.17, dz) * _ss(0.02, 0.035, dz)
        rule = _ss(0.225, 0.21, dz) * _ss(0.185, 0.20, dz)
        line = _ss(0.30, 0.29, dz) * _ss(0.265, 0.275, dz)
        sub = out[m]
        sub = _mix(sub, _hexs("#C9C5D2") * grain_[:, None], 0.85 * band)
        sub = _mix(sub, _hexs(INK), 0.85 * rule)
        sub = _mix(sub, _hexs("#C9C5D2"), 0.7 * line)
        sub = _mix(sub, _hexs(INK), 0.85 * _ss(0.014, 0.004, dz))
        out[m] = sub
    return out


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
STANCE = dict(l=(-0.03, -0.10, 0.0), r=(-0.08, 0.10, 0.0), yl=6.0, yr=-16.0)     # the concept's wide stalker stance
TORSO_G = dict(hips=(7, -8, 0), spine=(3, 3, 0), chest=(2, 3, 0), neck=(1, 2, 0), head=(3, 3, 0))    # ~12 deg lean, the hat
#                                                                                       pointing a little down (brief)
G_HIPS = (0.0, 0.015, -0.06)
GR = ((-0.24, -0.16, -0.90), (-0.85, 0.40, -0.30))      # the blade hand low at the right hip
GAIM = (0.22, -0.80, -0.56)                             # the blade forward and down, across the front
GL = ((0.10, -0.62, -0.38), (0.85, 0.30, -0.45))        # the lull hand open at chest height
GLAIM = (-0.15, -0.75, -0.64)                           # its fingers forward-down, loosely open
LUNGE_FT = dict(dl=(0.04, -0.34, 0.0), dr=(0.02, 0.40, 0.05))


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


def _install_anim() -> None:
    if getattr(anim._solve_foot, "_nurrow", False):
        return
    _solve_foot_fixed._nurrow = True
    anim._solve_foot = _solve_foot_fixed


def clip_overrides(ctx) -> dict:
    """Brief §8 gestures; impact at exactly 40 % (frames multiples of 5). In game a cast clip plays only up to its
    impact (time-scaled onto the castTime), then the sim's next state takes over: Felt Step and Lull the Rest hand
    their impact pose (a low lunge, the blade forward) straight to `dash`, which holds that lunge (no second swing).
      idle      the concept's wide stalker stance, a 12 degree lean, the blade low at the right hip, the lull hand open
                at chest height, breathing, the weight drifting, the hat nodding a little
      run       a stalker's run at 3.55 m/s: 15 degree lean, the lull hand trailing open, the blade low and quiet,
                the cape lifted back
      attack1   a quick right-hand hooked slash (high right -> low left), stepping in (20 f, f8)
      attack2   the left palm taps out (f4), then a rising right slash (20 f, f8)
      cast_a1   Felt Step (castTime 0.1): a 2-frame crouch, then the step-lunge, near-horizontal, blade forward (15 f, f6)
      cast_a2   Lullaby Dart: the lull hand to the lips in a hush, the head back (hat up), the flick at f10 (25 f)
      cast_a3   Snuff: the blade from low-back, up over and down in a hooked capping arc, the hat dipping (20 f, f8)
      cast_ult  Lull the Rest: both arms open wide like drawing a curtain, the head up, breathing; the lunge at f16;
                lands low beside the target, the lull hand lowered palm-down; straightens (40 f)
      dash      the stalker's sprint under the held lunge: one stride cycle, the blade forward, the cape streaming
                (starts and ends on cast_a1's held pose: a clean hand-off)
      death     the head snaps back, she sinks to her knees, sways and slumps onto her right side, curled as if
                asleep; the hat rolls off and lies flat beside her head (x_hat), the cape settles (ends at rest)
      recall    the blade lowered, a hand over her heart, humming (a slow sway)
      victory   the blade slipped into the belt (the hand on its pommel), the hat tipped back, the lull hand smooths a
                blanket, the hold: a quarter turned toward the camera, fingertips at the lips under the mask
      idle_lobby, stunned, taunt, crit, channel"""
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
            hips=(8.0, yaw, roll), spine=(4.0, -yaw * 0.6, -roll * 0.6), chest=(3.0 + 1.2 * math.cos(4 * math.pi * q), -yaw * 0.5, -roll * 0.3),
            neck=(-3.0, yaw * 0.3, 0), head=(0.0, yaw * 0.25, 0)))
        ik = {"foot.L": FT((0.0 + fl[0], fl[1] - 0.02, fl[2]), pl, -4.0), "foot.R": FT((-0.0 + fr[0], fr[1] - 0.02, fr[2]), pr, 4.0)}
        ik["hand.R"] = HT(rel=(-0.20, -0.10 - 0.12 * sw, -0.90), pole=(-0.85, 0.45, -0.2))
        ik["aim.R"] = AIM((0.12, -0.55, -0.82))
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
    h1 = pose(dict(hips=(6, 14, 0), spine=(5, 10, -3), chest=(6, 14, -5), head=(-4, -12, 0)), (0, -0.07, -0.03),
              R=((0.28, -0.88, -0.38), (-0.6, 0.3, -0.7)), aim=(0.72, -0.55, -0.42), L=((0.35, 0.15, -0.75), GL[1]),
              ft=feet(dl=(0.0, -0.10, 0.0)))
    f1 = pose(dict(hips=(7, 18, 0), spine=(6, 13, -3), chest=(7, 17, -6), head=(-5, -14, 0)), (0, -0.08, -0.035),
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
                 ft=feet(dl=LUNGE_FT["dl"], dr=LUNGE_FT["dr"], pr=-48.0), cape=-20.0)
    lunge2 = pose(dict(hips=(36, 4, 0), spine=(13, 2, 0), chest=(7, 0, 0), neck=(-21, 0, 0), head=(-15, 0, 0)),
                  (0, -0.21, -0.215), R=((0.14, -0.97, -0.25), (-0.85, 0.3, -0.3)), aim=(0.08, -0.95, -0.30),
                  L=((0.32, 0.64, -0.55), (0.8, 0.4, 0.0)), laim=(0.2, 0.75, -0.62),
                  ft=feet(dl=LUNGE_FT["dl"], dr=(0.02, 0.44, 0.06), pr=-52.0), cape=-24.0)

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
                    ft=feet(dl=(0.04, lf, lz), dr=(0.02, rf, rz), pl=lp, pr=rp), cape=-26.0)
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
    flick = pose(dict(hips=(6, -8, 0), spine=(4, -6, 0), chest=(4, -10, 0), neck=(4, 4, 0), head=(6, 6, 0)), (0, -0.05, -0.02),
                 L=((0.02, -0.99, 0.06), (0.8, 0.0, -0.6)), laim=(0.05, -0.97, 0.20), ft=feet(dl=(0.0, -0.06, 0.0)))
    flick2 = pose(dict(hips=(7, -10, 0), spine=(5, -7, 0), chest=(5, -12, 0), neck=(5, 5, 0), head=(7, 7, 0)), (0, -0.055, -0.025),
                  L=((0.06, -0.96, 0.02), (0.8, 0.0, -0.6)), laim=(0.1, -0.90, -0.40), ft=feet(dl=(0.0, -0.06, 0.0)))
    keysa2 = [(0.0, g, "linear"), (0.24, hush, "inout"), (0.33, hush2, "out"), (0.40, flick, "snap"),
              (0.48, flick2, "out"), (0.64, anim.lerp_pose(flick2, g, 0.35), "inout"), (1.0, g, "settle")]
    out["cast_a2"] = clip("cast_a2", 25, keysa2, {"head": 1.0, "neck": 0.5})

    # ── cast_a3 Snuff: low-back, up and over, the hooked capping arc down at f8 ──
    sl = pose(dict(hips=(4, -12, 0), spine=(2, -8, 0), chest=(0, -10, 0), head=(0, 8, 0)), (0, 0.02, -0.01),
              R=((-0.34, 0.36, -0.80), (-0.8, 0.5, -0.2)), aim=(-0.25, 0.70, -0.66), L=((0.20, -0.45, -0.55), GL[1]))
    over = pose(dict(hips=(-2, -6, 0), spine=(-4, -4, 0), chest=(-6, -6, 0), head=(-4, 4, 0)), (0, 0.01, 0.02),
                R=((-0.22, -0.20, 0.55), (-0.6, -0.3, 0.7)), aim=(0.05, -0.30, 0.95), L=((0.22, -0.40, -0.50), GL[1]))
    cap = pose(dict(hips=(14, 8, 0), spine=(8, 6, 0), chest=(8, 8, -4), neck=(4, 0, 0), head=(10, -4, 6)), (0, -0.06, -0.07),
               R=((0.08, -0.85, -0.22), (-0.7, 0.2, 0.2)), aim=(0.18, -0.50, -0.85), L=((0.12, -0.30, -0.62), GL[1]),
               laim=(-0.4, -0.3, -0.87), ft=feet(dl=(0.0, -0.06, 0.0)))
    cap2 = pose(dict(hips=(16, 9, 0), spine=(9, 6, 0), chest=(9, 9, -4), neck=(5, 0, 0), head=(11, -4, 6)), (0, -0.065, -0.08),
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
    land = pose(dict(hips=(22, 10, 0), spine=(8, 4, 0), chest=(4, 4, 0), neck=(-8, 0, 0), head=(-6, -4, 0)), (0, -0.10, -0.17),
                R=((0.05, -0.85, -0.45), (-0.85, 0.3, -0.3)), aim=(0.15, -0.80, -0.58),
                L=((0.28, -0.70, -0.62), (0.8, 0.3, -0.4)), laim=(0.05, -0.80, -0.60),
                ft=feet(dl=(0.03, -0.24, 0.0), dr=(0.02, 0.26, 0.03), pr=-35.0), cape=-8.0)
    land2 = pose(dict(hips=(20, 10, 0), spine=(7, 4, 0), chest=(3, 4, 0), neck=(-8, 0, 0), head=(-5, -4, 0)), (0, -0.10, -0.16),
                 R=((0.05, -0.83, -0.48), (-0.85, 0.3, -0.3)), aim=(0.15, -0.78, -0.60),
                 L=((0.30, -0.66, -0.68), (0.8, 0.3, -0.4)), laim=(0.05, -0.78, -0.62),
                 ft=feet(dl=(0.03, -0.24, 0.0), dr=(0.02, 0.26, 0.03), pr=-35.0), cape=-4.0)

    def ult(t):
        p = anim.keyed([(0.0, g, "linear"), (0.07, dip, "inout"), (0.25, curtain, "out"), (0.35, curtain2, "inout"),
                        (0.40, lunge, "accel"), (0.50, land, "out"), (0.75, land2, "inout"),
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
    final = pose(dict(hips=(3, 20, 0), spine=(2, 6, 0), chest=(1, 6, 0), neck=(-2, -4, 0), head=(-3, -6, 3)), (0, 0.0, -0.025),
                 R=BELT_R, aim=BELT_AIM, L=((-0.42, -0.52, -0.16), (0.9, 0.1, -0.4)), laim=(-0.12, -0.25, 0.96),
                 ft=feet(dl=(0.03, -0.04, 0), dr=(0.0, 0.06, 0)), cape=-4.0)

    def vic(t):
        p = anim.keyed([(0.0, g, "linear"), (0.20, sheath, "inout"), (0.36, tiphat, "inout"), (0.50, smooth0, "inout"),
                        (0.66, smooth1, "inout"), (0.84, final, "inout"), (1.0, final, "linear")])(t)
        if t > 0.84:
            k = min(1.0, (t - 0.84) / 0.1)
            p = anim.add(p, P_(chest=(0.8 * k * anim.osc(t, 2), 0, 0)))
        return p
    out["victory"] = anim.Clip("victory", 60, False, anim.drag(vic, 60, {"head": 1.5, "neck": 0.8}))

    # ── stunned: drowsy blinks and sways ──
    slump = pose(dict(hips=(6, 0, 0), spine=(8, 0, 0), chest=(6, 0, 0), neck=(4, 0, 0), head=(5, 0, 0)), (0, 0.0, -0.05),
                 R=((-0.20, -0.05, -0.95), GR[1]), aim=(0.1, -0.3, -0.95), L=((0.18, -0.10, -0.95), GL[1]),
                 laim=(0.0, -0.2, -0.98))

    def stunned(t):
        a_, b_ = anim.osc(t, 1), anim.osc(t, 1, 0.25)
        p = anim.add(slump, P_(hips=(0, 0, 3 * a_), spine=(2 * b_, 0, -3 * a_), chest=(2 * b_, 0, -3 * a_),
                               neck=(5 * b_, 0, 5 * a_), head=(7 * b_, 4 * a_, 7 * a_)))
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

    # ── crit: attack1 with a deeper wind and a longer hooked follow-through ──
    w1c = anim.add(w1, P_(hips=(0, -6, 0), chest=(-2, -6, 0)))
    f1c = anim.add(f1, P_(hips=(2, 8, 0), chest=(2, 8, 0)))
    out["crit"] = anim.Clip("crit", 25, False, anim.drag(anim.keyed(anim.strike_keys(prof, w1c, h1, f1c, g)), 25,
                                                         {"head": 1.0, "neck": 0.5, "hand.L": 1.5}), impact=anim.IMPACT)

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
    fighter.main(sys.modules[__name__])
