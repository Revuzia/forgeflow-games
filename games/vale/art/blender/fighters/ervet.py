"""ervet: Glass blade (Breaker, Aubade). ART 2.0: sculpted volumes painted by concept projection + hand-tuned
procedural paint where the concept cannot be projected cleanly.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/ervet_plates.py --height 2.15   # plates
    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/ervet_fit.py
    python3 art/build.py fighter ervet --no-skins --clip-sheet

Brief: _design/fighters/ervet.md. Concept: _design/concept/ervet.webp (front + back, hand-painted).
Forms are numpy SDF volumes (common/hifi/sdf.py) fitted to the concept on a 10 cm grid (crest top 2.15 m,
the plates' scale).

Where the concept and the brief disagree the concept's PROPORTIONS win (a 1.31 m blade carried across the
front, the grip at the right hip, a tall kite helm under a transverse crest, a 0.8 m mantle) and the brief's
RULES win: no gems (the painted blue gems are painted out, no glass studs), the ochre trims become a pale
warm-stone trim (no gold), the accent is the visor slit, the crest's brow strip and the crossguard inlays,
the cape hem is narrower than the mantle (inverted wedge), the vambraces are blued plates.

Paint (`_paint_object`): the concept projection (blade-free body plates) carries the face plate, crest
carving, breastplate, belts, tabard, greaves and legs; parts the concept cannot paint cleanly from two
views are painted procedurally from the skin's LOOK colours (painterly value noise, top light, curvature
edge light): the dawnglass blades (pale body, deep core and fuller, pale bevels), crossguard, pommel and
grip, the tiled mantle lames, the pauldron tops (carved stone), the helm's sides/back, the scarf (cream at
its painted value), the coat (blue-grey cloth, brown lining, trims; no ghosts of the arm or the slit), the
arms (chalk rerebraces, blued vambraces, dark wrapped forearms, gloves) and the boots.

Three blade states (passive forms, CONTRACT §12 form-swapped parts): the whole blade `form='base'`, the
broken stub `form='hilt'`, the oversized blade `form='great'`; one grip, crossguard and accent shared.

Pipeline additions kept inside this module (art/blender/common is shared and not edited here):
  * `_paint_object` (project.paint_object wrapper): body projection + procedural paint (above);
  * `_recolour` (project.recolour wrapper): skins re-colour the projected parts hue-aware; the procedural
    parts are already painted in the skin's LOOK;
  * `extra_materials`: dawnglass at roughness 0.4 (a 0.14 glass mirrors the dark ground in game);
  * `_bind_part` (pipeline.bind_part wrapper): the coat's front flaps follow the hips/thighs, its back the
    cape chain ('coatmix' bind), so a strike bends it instead of swinging it as a board;
  * `_write_action` (anim.write_action wrapper): prop.R location keys (`prop.R_loc`) so `death` can drop
    the sword on the ground;
  * renders and the three.js QA show the base form only (+ one QA sheet per extra form);
  * no `channel` clip: Ervet channels nothing.
Helpers: proto/ervet_plates.py (plates), proto/ervet_fit.py (fit check), proto/ervet_poses.py (clip contact
sheets from the cached build, no rebuild).
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
SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.96, "yaw": 36.0, "pitch": -3.0, "sun": 1.45,
          "rim_cool": 0.5, "rim_warm": 0.5, "fill": 0.86}
TEXTURE_SIZE = 2048
TEXTURE_SIZES = {"normal": 512, "orm": 512}
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
GREAT_L = 1.62
BLADE_SHAPE = (0.134, 0.112, 0.026, 0.21)      # width at the guard, width before the point, thickness, point
STUB_SHAPE = (0.134, 0.128, 0.026, 0.5)
GREAT_SHAPE = (0.24, 0.19, 0.036, 0.34)
BEVEL = {"blade": 0.026, "blade_hilt": 0.026, "blade_great": 0.045}
# the crossguard outline (u along the blade's width W, v along the blade D toward the point), right half:
# a broad recurved chalk guard 0.45 m across whose ends sweep toward the blade (the concept's guard)
GUARD_HALF = [(0.0, 0.062), (0.03, 0.05), (0.06, 0.034), (0.10, 0.030), (0.14, 0.040), (0.172, 0.062),
              (0.196, 0.094), (0.212, 0.124), (0.228, 0.120), (0.228, 0.092), (0.214, 0.062), (0.19, 0.030),
              (0.155, 0.006), (0.11, -0.006), (0.065, -0.008), (0.042, -0.03), (0.0, -0.058)]
GUARD_POLY = GUARD_HALF + [(-u, v) for u, v in reversed(GUARD_HALF[1:-1])]
GUARD_H = 0.021                      # half thickness (along the face normal)
LOZENGE = [(0.042, 0.0), (0.0, 0.0125), (-0.042, 0.0), (0.0, -0.0125)]
GUARD_INLAYS = [(0.124, 0.027, 13.0), (-0.124, 0.027, -13.0)]       # (u, v, angle deg) of the arm lozenges
CENTRE_DIAMOND = (0.0, 0.004, 0.021)                               # (u, v, half size)
# the pauldron plates seen from above (her left; mirrored for the right), 0.9x about their centre
_PO = [(0.10, -0.17), (0.24, -0.205), (0.36, -0.15), (0.425, -0.02), (0.39, 0.12), (0.30, 0.22),
       (0.15, 0.235), (0.08, 0.12)]
_PC = (0.25, 0.02)
PAULDRON_OUTLINE = [(_PC[0] + (x - _PC[0]) * 0.9, _PC[1] + (y - _PC[1]) * 0.9) for x, y in _PO]
PAULDRON_SLOPE = 9.0                 # deg: the plate falls away outward
# mantle lames: rows of carved plates round a vertical axis at each shoulder
LAME_ROWS = 5
LAME_STEP = 24.0                     # deg between plate seams (staggered half a plate per row)
# the coat
COAT = dict(z0=0.42, z1=1.58, rx=(0.30, 0.355), ry=(0.205, 0.255), y0=(0.03, 0.06), t=0.011, opening=0.272,
            x0=(0.0, 0.03))


def lame_row(i):
    """row i: centre height, radius at the centre, half height"""
    return 1.745 - 0.064 * i, 0.205 + 0.006 * i, 0.042


def lame_slots(i):
    return [-90.0 + (LAME_STEP * 0.5 if i % 2 else 0.0) + LAME_STEP * k for k in range(13)]


def coat_lerp(a, z):
    u = np.clip((z - COAT["z1"]) / (COAT["z0"] - COAT["z1"]), 0.0, 1.0) ** 0.85
    return a[0] * (1 - u) + a[1] * u


def coat_hem(x, y):
    return 0.47 + 0.075 * np.clip((x - 0.05) / 0.35, 0.0, 1.0) + 0.02 * NOISE(np.stack([x * 3, y * 3, x * 0], 1), 6.0)


def sword_frame(J) -> dict:
    """Guard centre G, blade direction D, width W, face normal N (toward the front, rolled up by BLADE_ROLL),
    grip point C on the axis at the right palm (prop.R's head)."""
    d2 = (TIP_XZ - GUARD_XZ) / np.linalg.norm(TIP_XZ - GUARD_XZ)
    D = np.array([d2[0], TILT_Y, d2[1]])
    D /= np.linalg.norm(D)
    palm = np.array(J["palm.R"][:])
    t0 = (palm[[0, 2]] - GUARD_XZ) @ d2                  # the palm's place along the painted axis (< 0)
    cxz = GUARD_XZ + d2 * t0
    C = np.array([cxz[0], palm[1], cxz[1]])
    s = -t0 / np.linalg.norm(D[[0, 2]])
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
    return {"G": G, "D": D, "W": W, "N": N, "C": C, "grip_t": s}


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
        return np.array([lo[0], lo[1], 1.70]), np.array([hi[0], hi[1], 1.90])

    def d(self, P):
        xy = P[:, :2]
        ring = np.maximum(poly_sd(xy, self.outer), -poly_sd(xy, self.inner))
        dz = (self.ztop(P[:, 0], P[:, 1]) - self.depth) - P[:, 2]
        return np.maximum(ring, dz)


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

    def __init__(self, z0, z1, rx, ry, y0, t, opening, hem, folds=None, x0=(0.0, 0.0)):
        self.z0, self.z1, self.rx, self.ry, self.y0, self.t, self.x0 = z0, z1, rx, ry, y0, t, x0
        self.opening, self.hem, self.folds = opening, hem, folds

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
        d_open = np.minimum(self.opening - np.abs(x), front + 0.02)
        return np.maximum(d, d_open)


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
        p = P - self.A
        r = np.hypot(p[:, 0], p[:, 1])
        phi = np.degrees(np.arctan2(self.sx * p[:, 0], -p[:, 1]))
        f = (phi - self.ph0) / LAME_STEP
        w = f - np.floor(f)
        b = 1.0 - (2.0 * w - 1.0) ** 2
        rr = self.R + (self.zc - P[:, 2]) * 0.35 + 0.0065 * b
        zb = self.zc - self.hz - 0.008 * b
        dz = np.maximum(P[:, 2] - (self.zc + self.hz), zb - P[:, 2])
        return np.maximum(np.abs(r - rr) - 0.011, dz)


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
    u = ang * 9.0 + 0.8 * NOISE(P, 2.5)
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

    # HELM (rigid on the head): a tall kite face plate over a round skull, the back column under the crest; the
    # visor slot is cut deep (an ink recess) and holds a faceted glass pane
    helm = Sculpt("helm")
    helm.add(Ellipsoid((0.01, 0.03, 1.955), (0.088, 0.105, 0.108)), k=0.0)
    helm.add(Capsule((0.022, 0.045, 1.95), (0.022, 0.035, 2.05), 0.072), k=0.03)
    face = Extrude((0.0, -0.06, 0.0), [(-0.098, 2.052), (-0.098, 1.96), (-0.072, 1.90), (-0.022, 1.855), (0.012, 1.828),
                                      (0.046, 1.855), (0.096, 1.90), (0.122, 1.96), (0.122, 2.052)],
                   0.078, 0.012, axes=xz_frame())
    helm.add(face, k=0.02)
    helm.inter(Ellipsoid((0.012, 0.07, 1.955), (0.17, 0.215, 0.24)), k=0.015)
    helm.add(RoundCone((0.012, -0.105, 1.875), (0.012, -0.152, 1.836), 0.022, 0.008), k=0.02)   # the beak
    helm.sub(RoundBox((0.012, -0.165, 1.960), (0.027, 0.05, 0.088), 0.006), k=0.004)          # visor slot
    helm.sub(RoundBox((0.012, -0.165, 2.032), (0.032, 0.05, 0.032), 0.004, axes=sdf.rot_y(45)), k=0.004)
    for sx in (-1, 1):                                                                          # cheek slits
        helm.sub(Capsule((0.012 + sx * 0.058, -0.135, 2.005), (0.012 + sx * 0.074, -0.122, 1.905), 0.0105), k=0.003)
    helm.add(RoundBox((0.012, -0.112, 2.052), (0.11, 0.025, 0.012), 0.008), k=0.012)           # brow band
    part("helm", helm, "chalk", "bone:head", 1100, 0.7)
    visor = Sculpt("visor")
    # the main pane is a prism (a ridge down its middle) set 4 mm behind the face plate
    visor.add(RoundBox((0.012, -0.113, 1.960), (0.0165, 0.0165, 0.082), 0.004, axes=sdf.rot_z(45)), k=0.0)
    visor.add(RoundBox((0.012, -0.121, 2.032), (0.0255, 0.009, 0.0255), 0.003, axes=sdf.rot_y(45)), k=0.004)
    for sx in (-1, 1):
        visor.add(Capsule((0.012 + sx * 0.057, -0.119, 2.004), (0.012 + sx * 0.073, -0.106, 1.906), 0.008), k=0.0)
    # the brow plate's glass: a strip set into the crest's top edge
    visor.add(AnnulusSector((0.065, 0.02, 1.55), 0.584, 0.597, -19.0, 21.0, 0.019, 0.003, axes=xz_frame()), k=0.0)
    part("visor", visor, "accent", "bone:head", 420, 0.5)
    crest = Sculpt("crest")
    band = AnnulusSector((0.065, 0.02, 1.55), 0.505, 0.60, -22.0, 24.0, 0.030, 0.009, axes=xz_frame())
    crest.add(band.displaced(chips(0.006, 14.0), 0.006), k=0.0)
    crest.sub(AnnulusSector((0.065, 0.02, 1.55), 0.582, 0.66, -19.5, 21.5, 0.0205, 0.002, axes=xz_frame()), k=0.003)
    part("crest", crest, "stone", "bone:head", 700, 0.7)

    # SCARF (chest -> neck): a wrapped collar, a fold over the chest, a knot and tails on the left shoulder
    scarf = Sculpt("scarf")
    scarf.add(Torus((0.015, 0.005, 1.84), 0.092, 0.056, axes=sdf.rot_x(-14)), k=0.0)
    scarf.add(Torus((0.02, -0.005, 1.77), 0.13, 0.05, axes=sdf.rot_x(-16)), k=0.04)
    scarf.add(Ellipsoid((0.02, -0.125, 1.715), (0.13, 0.05, 0.085), axes=sdf.rot_z(8)), k=0.04)
    scarf.add(Ellipsoid((0.015, 0.075, 1.85), (0.15, 0.10, 0.085)), k=0.05)                      # the cowl behind
    scarf.add(Ellipsoid((0.165, -0.125, 1.745), (0.055, 0.05, 0.06)), k=0.02)                   # the knot
    scarf.add(FlatCapsule((0.17, -0.145, 1.70), (0.215, -0.17, 1.55), 0.045, 0.018, 0.034, 0.014, side=(1, 0, 0)), k=0.02)
    scarf.add(FlatCapsule((0.15, -0.145, 1.70), (0.125, -0.165, 1.585), 0.036, 0.016, 0.028, 0.012, side=(1, 0, 0)), k=0.02)
    scarf = _displaced_sculpt(scarf, folds(0.012, 34.0, axis=2, phase=0.4), 0.012)
    part("scarf", scarf, "cloth2", ("zblend", "chest", "neck", 1.79, 1.89), 950)

    # TORSO (auto): the under-suit (mostly hidden)
    torso = Sculpt("torso")
    torso.add(Ellipsoid((0.0, 0.02, 1.58), (0.19, 0.15, 0.17)), k=0.0)
    torso.add(Ellipsoid((0.0, 0.02, 1.32), (0.15, 0.12, 0.16)), k=0.08)
    torso.add(Ellipsoid((0.0, 0.02, 1.07), (0.175, 0.13, 0.13)), k=0.08)
    torso.add(Capsule((0.01, 0.02, 1.72), (0.012, 0.03, 1.88), 0.055), k=0.04)
    for s in ("L", "R"):
        torso.add(Sphere(jv(J, f"shoulder.{s}"), 0.075), k=0.06)
    part("torso", torso, "under", "auto", 420)

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
    part("breastplate", bp, "chalk", "bone:chest", 800)

    # MANTLE: per side a carved pauldron top plate (stone) over five rows of separate blued plates (lames)
    for s, sx in (("R", -1), ("L", 1)):
        A = np.array([sx * 0.165, 0.015, 0.0])
        outline = [(sx * x, y) for x, y in PAULDRON_OUTLINE]
        if sx < 0:
            outline = outline[::-1]
        cen = (sx * _PC[0], _PC[1])
        pa = Sculpt(f"pauldron_{s}")
        plate = Extrude((0.0, 0.0, 1.806), outline, 0.03, 0.012)
        pa.add(plate.displaced(chips(0.005, 9.0), 0.005), k=0.0)
        pa.inter(Ellipsoid((sx * 0.20, 0.02, 1.55), (0.50, 0.50, 0.29)), k=0.012)        # domed: edges fall away
        k_sl = math.tan(math.radians(PAULDRON_SLOPE))
        nrm = np.array([sx * k_sl, 0.0, 1.0])
        pa.inter(HalfSpace((sx * 0.20, 0.0, 1.836), nrm, 1.0), k=0.02)                   # sloping outward
        loop = [(x, y, 1.798 - 0.014 * (abs(x) - 0.1) / 0.32 - 0.6 * k_sl * max(0.0, abs(x) - 0.20)) for x, y in outline]
        loop.append(loop[0])
        pa.add(Tube(loop, [0.0115] * len(loop), k=0.006), k=0.006)                          # the trim bead
        part(f"pauldron_{s}", pa, "stone", f"bone:shoulder.{s}", 520, 0.7)
        la = Sculpt(f"lames_{s}")
        for i in range(LAME_ROWS):
            la.add(LameRow(A, i, sx), k=0.004)
        la.inter(HalfSpace((sx * 0.10, 0, 1.6), (-sx, 0, 0), 1.0), k=0.01)
        la = _displaced_sculpt(la, chips(0.004, 11.0), 0.004)
        part(f"lames_{s}", la, "cloth", ("dblend", f"shoulder.{s}", f"upper_arm.{s}", (sx * 0.20, 0.015, 1.78),
                                         (sx * 0.35, 0.0, -0.94), 0.10, 0.42), 860, 0.8)
    back = Sculpt("backplate")
    shell = Lathe((0.0, -0.02, 0.0), lambda r, z: np.abs(r - 0.228) - 0.011, 0.25, 1.40, 1.75)
    back.add(shell, k=0.0)
    back.inter(Extrude((0.0, 0.2, 0.0), [(-0.19, 1.738), (0.19, 1.738), (0.20, 1.565), (0.0, 1.418), (-0.20, 1.565)],
                       0.12, 0.0, axes=xz_frame()), k=0.006)
    part("backplate", back, "cloth", "bone:chest", 450)

    # ARMS (auto: dark under-suit, wrapped forearms) + chalk rerebraces with elbow cops (upper arms) + blued
    # vambraces (forearms) + gloves (hands)
    arms = Sculpt("arms")
    for s in ("L", "R"):
        sh, el, wr = jv(J, f"shoulder.{s}"), jv(J, f"elbow.{s}"), jv(J, f"wrist.{s}")
        arms.add(FlatCapsule(sh, el, 0.066, 0.062, 0.056, 0.054), k=0.0)
        arms.add(FlatCapsule(el, wr, 0.054, 0.052, 0.043, 0.04), k=0.03)
        arms.add(Sphere(sh, 0.07), k=0.03)
    part("arms", arms, "under", "auto", 750)
    for s, sx in (("R", -1), ("L", 1)):
        sh, el, wr = jv(J, f"shoulder.{s}"), jv(J, f"elbow.{s}"), jv(J, f"wrist.{s}")
        # rerebrace: a shell over the outer upper arm from under the lames to the elbow cop
        au = (el - sh) / np.linalg.norm(el - sh)
        ou = np.array([sx, 0.0, 0.0]) - au * sx * au[0]
        ou /= np.linalg.norm(ou)
        Lu = float(np.linalg.norm(el - sh))
        rb = Sculpt(f"rerebrace_{s}")
        rb.add(FlatCapsule(sh + au * (Lu * 0.30), el - au * 0.01, 0.076, 0.073, 0.068, 0.066), k=0.0)
        rb.inter(HalfSpace(sh + ou * -0.035, -ou, 1.0), k=0.01)
        rb.add(Ellipsoid(el + ou * 0.03 + au * 0.005, (0.056, 0.056, 0.058), axes=sdf.frame(au, ou)), k=0.02)   # elbow cop
        for i in range(2):                                                                                # two lames
            c = sh + au * (Lu * (0.55 + 0.22 * i))
            rb.add(Torus(c, 0.071, 0.006, axes=sdf.frame(au)), k=0.004)
        rb.inter(HalfSpace(sh + ou * -0.04, -ou, 1.0), k=0.01)
        part(f"rerebrace_{s}", rb, "chalk", f"bone:upper_arm.{s}", 300)
        # vambrace: a blued plate over the outer forearm, a cuff at the wrist
        ax = (wr - el) / np.linalg.norm(wr - el)
        out_ = np.array([sx, 0.0, 0.0])
        out_ = out_ - ax * out_.dot(ax)
        out_ /= np.linalg.norm(out_)
        fr = sdf.frame(ax, out_)
        vb = Sculpt(f"vambrace_{s}")
        L = float(np.linalg.norm(wr - el))
        mid = el + ax * (L * 0.56) + out_ * 0.03
        vb.add(RoundBox(mid, (0.034, 0.048, L * 0.36), 0.02, axes=fr), k=0.0)
        vb.add(Torus(wr - ax * 0.035, 0.05, 0.013, axes=sdf.frame(ax)), k=0.01)                            # cuff
        vb.inter(HalfSpace(el + out_ * -0.012, -out_, 1.0), k=0.015)
        part(f"vambrace_{s}", vb, "cloth", f"bone:forearm.{s}", 320)
        hd = Sculpt(f"hand_{s}")
        palm = jv(J, f"palm.{s}")
        fd = np.array(J[f"forearm_dir.{s}"][:])
        pn = np.array(J[f"palm_n.{s}"][:])
        hfr = sdf.frame(fd, pn)
        c = palm + fd * 0.005
        hd.add(RoundBox(c, (0.042, 0.052, 0.05), 0.032, axes=hfr), k=0.0)
        for i in range(4):
            hd.add(Capsule(c + hfr[1] * -0.048 + hfr[2] * (0.03 - i * 0.02) + hfr[0] * 0.02,
                           c + hfr[1] * -0.048 + hfr[2] * (0.03 - i * 0.02) - hfr[0] * 0.03, 0.017), k=0.012)
        hd.add(Capsule(c + hfr[0] * -0.03 + hfr[1] * 0.03, c + hfr[0] * -0.035 + hfr[1] * -0.035 + hfr[2] * 0.02, 0.018), k=0.012)
        part(f"hand_{s}", hd, "leather", f"bone:hand.{s}", 380)

    # BELTS (auto): main belt, a slung lower belt, the chest strap (no gems: the buckle is carved stone)
    belt = Sculpt("belt")
    belt.add(Torus((0.0, 0.015, 1.335), 0.168, 0.031, axes=np.diag([1.0, 0.168 / 0.135, 1.0]), rz=0.034), k=0.0)
    belt.add(Torus((0.0, 0.015, 1.25), 0.185, 0.026, axes=sdf.rot_y(-9) @ np.diag([1.0, 0.185 / 0.145, 1.0]), rz=0.028), k=0.0)
    belt.add(RoundBox((0.0, -0.155, 1.335), (0.04, 0.016, 0.032), 0.01), k=0.0)
    belt.add(Tube([(0.15, -0.115, 1.76), (0.10, -0.172, 1.665), (0.0, -0.19, 1.57), (-0.10, -0.172, 1.47),
                   (-0.155, -0.135, 1.39)], [0.016] * 5, k=0.01), k=0.0)
    part("belt", belt, "leather", "auto", 620)

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
        a = 0.016 * np.clip((1.35 - P[:, 2]) / 0.8, 0.1, 1.0)
        return a * coat_fold_wave(P, ang) * -0.5
    coat = Sculpt("coat")
    coat.add(CoatShell(COAT["z0"], COAT["z1"], COAT["rx"], COAT["ry"], COAT["y0"], COAT["t"], COAT["opening"],
                       coat_hem, coat_folds, x0=COAT["x0"]), k=0.0)
    part("coat", coat, "cloth", ("coatmix", "cape", "chest"), 1750)

    # LEGS (auto) + greaves (rigid on the shins) + boots (auto)
    legs = Sculpt("legs")
    legs.add(Ellipsoid((0.0, 0.02, 0.99), (0.17, 0.12, 0.10)), k=0.0)
    for s in ("L", "R"):
        hp, kn, an = jv(J, f"hip.{s}"), jv(J, f"knee.{s}"), jv(J, f"ankle.{s}")
        legs.add(FlatCapsule(hp, kn, 0.092, 0.088, 0.072, 0.07), k=0.05)
        legs.add(FlatCapsule(kn, an, 0.062, 0.06, 0.038, 0.04), k=0.03)
    part("legs", legs, "under", "auto", 560)
    for s, sx in (("R", -1), ("L", 1)):
        kn, an = jv(J, f"knee.{s}"), jv(J, f"ankle.{s}")
        ax = (an - kn) / np.linalg.norm(an - kn)
        gv = Sculpt(f"greave_{s}")
        gv.add(Ellipsoid(kn + np.array([0.0, -0.05, 0.03]), (0.085, 0.052, 0.125), axes=sdf.rot_x(-6)).displaced(chips(0.006, 8.0), 0.006), k=0.0)
        gv.add(FlatCapsule(kn + ax * 0.08 + np.array([0, -0.012, 0]), an - ax * 0.03 + np.array([0, -0.006, 0]),
                           0.064, 0.06, 0.043, 0.045, side=(1, 0, 0)).displaced(chips(0.005, 9.0), 0.005), k=0.03)
        gv.sub(Torus(kn + np.array([0.0, -0.01, -0.11]), 0.075, 0.006, axes=sdf.frame(ax)), k=0.003)
        part(f"greave_{s}", gv, "ironstone", f"bone:shin.{s}", 420)
    # boots: a sole, a heel, a long instep down to a narrow rounded toe, the shaft with a turned cuff
    boots = Sculpt("boots")
    for s in ("L", "R"):
        an, toe, heel = jv(J, f"ankle.{s}"), jv(J, f"toe.{s}"), jv(J, f"heel.{s}")
        fwd = toe - heel
        fwd[2] = 0
        Lf = float(np.linalg.norm(fwd))
        fwd /= Lf
        lat = np.cross(fwd, (0, 0, 1.0))
        fr = np.stack([lat, fwd, [0, 0, 1.0]])                      # local X lateral, Y forward, Z up
        h0 = np.array([heel[0], heel[1], 0.0])
        boots.add(RoundBox(h0 + fwd * (Lf * 0.5 + 0.004) + np.array([0, 0, 0.011]), (0.050, Lf * 0.5 + 0.012, 0.011),
                           0.007, axes=fr), k=0.0)                                                    # sole
        boots.add(RoundBox(h0 + fwd * 0.055 + np.array([0, 0, 0.055]), (0.046, 0.05, 0.05), 0.03, axes=fr), k=0.02)   # heel
        boots.add(Ellipsoid(h0 + fwd * (Lf * 0.52) + np.array([0, 0, 0.055]), (0.047, 0.10, 0.048), axes=fr), k=0.03)  # instep
        boots.add(Ellipsoid(h0 + fwd * (Lf - 0.05) + np.array([0, 0, 0.032]), (0.039, 0.065, 0.028), axes=fr), k=0.025)  # toe
        boots.add(FlatCapsule(np.array([an[0], an[1], 0.07]), np.array([an[0], an[1], 0.20]), 0.056, 0.06, 0.05, 0.054), k=0.04)
        boots.add(Torus(np.array([an[0], an[1] - 0.004, 0.198]), 0.058, 0.012), k=0.006)                          # cuff
    boots.inter(HalfSpace((0, 0, 0.0), (0, 0, -1), 2.0), k=0.0)
    part("boots", boots, "leather", "auto", 760, 0.8)

    # SWORD on prop.R: grip, the broad recurved crossguard, pommel, accent inlays, the three blade states
    _J.update({k: jv(J, k) for k in ("elbow.L", "elbow.R", "wrist.L", "wrist.R")})
    sw = sword_frame(J)
    G, D, W, N = sw["G"], sw["D"], sw["W"], sw["N"]
    grip = Sculpt("grip")
    grip.add(Capsule(G - D * 0.03, G - D * 0.355, 0.021).displaced(lambda P: 0.003 * np.sin(((P - G) @ D) * 140.0), 0.003), k=0.0)
    part("grip", grip, "leather", "bone:prop.R", 220)
    gfr = np.stack([W, D, N])                                      # local X = width, Y = blade axis, Z = face
    guard = Sculpt("guard")
    guard.add(Extrude(G, GUARD_POLY, GUARD_H, 0.009, axes=gfr).displaced(chips(0.003, 18.0), 0.003), k=0.0)
    guard.add(Ellipsoid(G - D * 0.005, (0.05, 0.05, GUARD_H + 0.006), axes=sdf.rot_z(45) @ gfr), k=0.012)   # boss
    inl = []
    for u, v, a in GUARD_INLAYS:
        c = G + W * u + D * v
        lf = _lozenge_frame(W, D, N, a)
        for fn in (-1, 1):
            guard.sub(Extrude(c + N * fn * (GUARD_H + 0.006), [(x * 1.18, y * 1.25) for x, y in LOZENGE], 0.008, 0.002,
                              axes=lf), k=0.002)
        inl.append(("lz", c, lf))
    cu, cv, ch = CENTRE_DIAMOND
    cd = G + W * cu + D * cv
    for fn in (-1, 1):
        guard.sub(RoundBox(cd + N * fn * (GUARD_H + 0.012), (ch * 1.15, ch * 1.15, 0.008), 0.002,
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
        inlays.add(RoundBox(cd + N * fn * (GUARD_H - 0.002), (ch, ch, 0.004), 0.002, axes=sdf.rot_z(45) @ gfr), k=0.0)
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


def stub_cut(s, n):
    """the broken stub's jagged end (t limit per position across the width)"""
    return STUB_L - 0.045 + 0.05 * np.abs(np.sin(s * 95.0 + 0.7)) + 0.03 * np.sin(s * 37.0) - 0.4 * n


def _displaced_sculpt(S: Sculpt, fn, amp: float) -> Sculpt:
    """the whole sculpt displaced (folds/chips over every op): wrap its op list as one blended primitive"""
    out = Sculpt(S.name)
    out.add(sdf.Blend([(o, p, k) for o, p, k, _ in S.ops]).displaced(fn, amp), k=0.0)
    return out


def skin_extras(extra: dict, J) -> list:
    """skin-only geometry: Lamplit's lamp cage at the pommel's end (four carved slats round a resin bead,
    7 cm long, on the sword's axis so it reads at the end of the grip)"""
    out = []
    if extra.get("lamp_cage"):
        sw = sword_frame(J)
        G, D, W, N = sw["G"], sw["D"], sw["W"], sw["N"]
        top = G - D * 0.415
        c = G - D * 0.455
        fr = sdf.frame(-D, W)
        cage, bead = Sculpt("lamp_cage"), Sculpt("lamp_bead")
        cage.add(Capsule(top + D * 0.01, top - D * 0.008, 0.009), k=0.0)
        cage.add(Torus(c + D * 0.03, 0.026, 0.0055, axes=fr), k=0.003)
        cage.add(Torus(c - D * 0.03, 0.022, 0.0055, axes=fr), k=0.003)
        cage.add(Sphere(c - D * 0.038, 0.011), k=0.004)
        for i in range(4):
            a = math.pi * 0.5 * i + math.pi * 0.25
            o = (W * math.cos(a) + N * math.sin(a)) * 0.027
            cage.add(Capsule(c + o + D * 0.03, c + o * 0.85 - D * 0.03, 0.0055), k=0.003)
        bead.add(Ellipsoid(c, (0.018, 0.018, 0.024), axes=fr), k=0.0)
        out.append(("lamp_cage", cage, 0.45, "wood", "bone:prop.R", 260, None))
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


LAME_ARC = (-20.0, 200.0)            # the mantle plates' arc round each shoulder axis (deg from the front)


def lames_low(name: str, sx: int, col=None):
    """The mantle lames as a clean surface (5 rows, plates LAME_STEP wide): per row an outer band whose
    plates ridge outward in their middle and hang lower there (scalloped edge), a lip turning in under the
    lower edge. One grid per row: the UV islands stay whole (a voxel shell decimates into slivers)."""
    A = np.array([sx * 0.165, 0.015, 0.0])
    verts, faces = [], []
    for i in range(LAME_ROWS):
        zc, R, hz = lame_row(i)
        ph0 = -90.0 + (LAME_STEP * 0.5 if i % 2 else 0.0)
        half = LAME_STEP * 0.5
        j0 = math.ceil((LAME_ARC[0] - ph0) / half)
        j1 = math.floor((LAME_ARC[1] - ph0) / half)
        cols = [ph0 + half * j for j in range(j0, j1 + 1)]
        base = len(verts)
        for c, phi in enumerate(cols):
            b = 1.0 if (round((phi - ph0) / half) % 2 == 1) else 0.0      # plate middle: ridge
            a = math.radians(phi)
            rad = np.array([sx * math.sin(a), -math.cos(a), 0.0])
            zb = zc - hz - 0.008 * b
            for z in (zc + hz, zc + hz * 0.33, zc - hz * 0.40, zb):
                rr = R + (zc - z) * 0.35 + 0.011 + 0.0065 * b
                verts.append(A + rad * rr + np.array([0.0, 0.0, z]))
            rr = R + (zc - zb) * 0.35 - 0.011 + 0.0065 * b
            verts.append(A + rad * rr + np.array([0.0, 0.0, zb + 0.004]))          # the lip, turned in
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
            P.append(fighter.Part(name, high=hi, low=ob, bind=bind, form=form))
            continue
        v, q = S.mesh(VOXEL * vs)
        ob = sdf.to_object(f"{name}_high", v, q, ctx.col)
        ob.data.materials.append(ctx.mats[role])
        P.append(fighter.Part(name, high=ob, tris=tris, bind=bind, form=form))
    return P


def extra_materials(ctx) -> dict:
    """dawnglass at roughness 0.4: a mirror-glossy glass (0.14) reflects the dark ground in game and the pale
    blade reads as a dark bar whenever it is raised or seen edge-on; still glossy, never emissive. Leather,
    ironstone, chalk and stone matte (0.8-0.88): the brief's matte painted plates; at 0.5-0.6 the low splash
    camera sees the bright sky in them and the dark boots and greaves turn pale."""
    p = dict(materials.BIBLE_PALETTE)
    p.update(ctx.palette)
    g = ctx.gradient
    return {"dawnglass": materials.glass("dawnglass", p, "dawnglass", g, rough=0.40, inclusions=0.2),
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
    b.head = C                                   # the grip point under the right palm
    b.tail = C + D * 0.12                        # +Y = the held item's main axis = the blade
    b.align_roll(W)
    bpy.ops.object.mode_set(mode="OBJECT")
    info.lengths["prop.R"] = arm.data.bones["prop.R"].length
    tip = sw["G"] + sw["D"] * (BLADE_L + 0.012)
    rig.add_socket(info, "x_blade_tip", "prop.R", tuple(tip), direction=tuple(sw["D"] * 0.1))
    rig.add_socket(info, "x_crossguard", "prop.R", tuple(sw["G"]), direction=tuple(sw["W"] * 0.1))
    libparts.add_chain(ctx, "cape", "chest", (0.0, 0.25, 1.56), (0.0, 0.37, 0.50), bones=2, z_hint=(0, 1, 0))
    libparts.add_chain(ctx, "tabard_f", "hips", (0.0, -0.165, 1.27), (0.0, -0.175, 0.66), bones=1, z_hint=(0, -1, 0))


def chain_config(ctx) -> list:
    """a long heavy coat: stiff, damped, small swing (it must never fly out in a strike)"""
    return libparts.chain_configs(ctx, {"cape": dict(gravity=0.95, stiffness=240.0, damping=28.0, inertia=0.10,
                                                     limit=(-10.0, 22.0)),
                                        "tabard_f": dict(limit=(-40.0, 45.0))})


def _smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _bind_coat(ctx, obj, chain_name: str, root: str) -> None:
    """The coat's weights: the back panel hangs on the cape chain (chain_weights), the front flaps and the
    sides in front of the hip line follow the body (chest / spine / hips, then the thigh of their side) so a
    strike or a stride bends the coat instead of swinging it as one board."""
    arm = ctx.info.armature
    libmesh.chain_weights(obj, arm, ctx.chains[chain_name], root)
    names = {g.index: g.name for g in obj.vertex_groups}
    me = obj.data
    mw = obj.matrix_world
    rows = []
    for v in me.vertices:
        p = mw @ v.co
        cw = {names[g.group]: g.weight for g in v.groups if g.weight > 1e-4}
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
    # run (both hands on the grip at the right hip): the blade trails low behind and out to her right, clear
    # of the coat so the long diagonal (or its absence in Hilt form) reads from the game camera
    "run_fwd": ((-0.02, -0.16, -0.92), (-0.8, 0.4, -0.4), (-0.56, 0.50, -0.66), (-0.15, -0.58, -0.62), None),
    "run_back": ((-0.06, 0.02, -0.94), (-0.7, 0.6, -0.3), (-0.58, 0.56, -0.60), (0.12, 0.34, -0.80), None),
    "stunned": ((0.10, -0.25, -0.95), (-0.8, 0.5, -0.3), (-0.35, -0.30, -0.89), (0.05, -0.20, -0.96), None),
    "dash":    ((0.05, 0.40, -0.85), (-0.7, 0.5, 0.2), (-0.30, 0.80, -0.50), (0.20, 0.60, -0.70), None),
}
MOTION = anim.motion_profile(weight="medium", weapon="two_hand", stance="guard", run_ref_speed=3.45, blocks=BLOCKS)
GRIP_L = -0.16          # the left hand on the grip, toward the pommel from the right palm (m along the blade)
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
    g = anim.guard(prof)
    skel = anim.Skeleton(ctx.info.armature)
    out = {
        "run": anim.gen_run(prof),                                  # both hands on the grip, the blade trailing
        "attack1": anim.gen_strike("attack1", "attack1", prof, 25),  # diagonal slash (impact f10)
        "attack2": anim.gen_strike("attack2", "attack2", prof, 25),  # return slash
        "cast_a3": anim.gen_strike("cast_a3", "slam", prof, 30, step=0.10),   # Shatter: overhead, smashed down at f12
    }
    # cast_a1 Heavy Arc / Quick Jab (20 f, f8): coiled on the right, a cross-body sweep ending in a lunge
    wind = _pose(g, dict(hips=(4, 26, 0), spine=(4, 14, 0), chest=(4, 18, 0), head=(0, -16, 0)), (0.0, 0.04, -0.03),
                 R=(-0.05, 0.10, -0.42), Rpole=(-0.9, 0.4, 0.0), aim=(-0.80, 0.40, 0.45))
    hit = _pose(g, dict(hips=(10, -22, 0), spine=(8, -12, 0), chest=(6, -16, 0), head=(-6, 12, 0)), (0.0, -0.13, -0.08),
                R=(0.45, -0.88, -0.22), Rpole=(-0.6, 0.3, -0.6), aim=(0.62, -0.76, -0.18),
                feet=_feet(g, dl=(0.0, -0.30, 0.0), pl=4))
    fol = _pose(g, dict(hips=(11, -32, 0), spine=(9, -16, 0), chest=(7, -22, 0), head=(-7, 16, 0)), (0.0, -0.15, -0.09),
                R=(0.72, -0.55, -0.30), Rpole=(-0.5, 0.5, -0.6), aim=(0.96, -0.10, -0.25),
                feet=_feet(g, dl=(0.0, -0.30, 0.0), pl=2))
    out["cast_a1"] = _strike("cast_a1", 20, g, wind, hit, fol)
    out["cast_a2"] = _glass_guard(g)
    out["cast_ult"] = _ult(g)
    out["dash"] = _leap(g)
    out["idle_lobby"] = _lobby(g)
    out["victory"] = _victory(g)
    out["recall"] = _recall(g, ctx)
    out["death"] = _death(g, skel)
    return out


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


def _ult(g) -> anim.Clip:
    """Whole Again (35 f, f14 = the top of the leap): coil with the blade drawn behind (breathing hold), leap with
    the blade overhead, come down swinging it into the ground, hold the landing f14-f26, rise."""
    N = 35
    coil = _pose(g, dict(hips=(18, 14, 0), spine=(14, 8, 0), chest=(12, 8, 0), neck=(-6, 0, 0), head=(-12, -6, 0)),
                 (0.0, 0.10, -0.24), R=(-0.10, 0.45, -0.60), Rpole=(-0.8, 0.5, 0.2), aim=(-0.35, 0.80, -0.48),
                 feet=_feet(g, dl=(0.02, -0.05, 0.0), dr=(-0.02, 0.10, 0.0)))
    coil2 = anim.add(coil, anim.P(chest=(2, 0, 0), head=(-2, 0, 0)))
    coil2["hips_loc"] = (coil["hips_loc"][0], coil["hips_loc"][1], coil["hips_loc"][2] - 0.02)
    air = _air(g)
    land = _land(g)
    land2 = anim.add(land, anim.P(chest=(1.5, 0, 0)))
    land2["hips_loc"] = (land["hips_loc"][0], land["hips_loc"][1], land["hips_loc"][2] + 0.015)
    keys = [(0.0, g, "linear"), (0.10, coil, "inout"), (0.18, coil2, "sine"), (0.30, anim.lerp_pose(coil2, air, 0.6), "out"),
            (anim.IMPACT, air, "out"), (0.52, land, "accel"), (0.58, land, "linear"), (0.74, land2, "sine"),
            (0.88, anim.lerp_pose(land2, g, 0.55), "inout"), (1.0, g, "settle")]
    return anim.Clip("cast_ult", N, False, anim.drag(anim.keyed(keys), N, {"head": 1.5, "neck": 1.0}), impact=anim.IMPACT)


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
    """dash (15 f, played over the whole dash): the sim moves her flat, so the leap's arc is in the clip: push
    off from the apex of Whole Again's coil, sail with the blade overhead (hips 0.34 m up), come down swinging
    it into the ground at the end (the landing = onArrive, where the great blade forms). Quick Jab plays the
    same arc short and fast: a leaping downward stab with the stub."""
    N = 15
    push = _air(g, lift=0.12)
    top = _air(g, lift=0.34)
    fall = anim.lerp_pose(_air(g, lift=0.18), _land(g), 0.35)
    land = _land(g)
    keys = [(0.0, push, "linear"), (0.38, top, "out"), (0.72, fall, "in"), (0.90, land, "accel"), (1.0, land, "linear")]
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
    her right foot at a long diagonal (f22); she lets the left hand fall to her hip and stands tall over the
    planted blade, chin up, the right hand on the grip, the mantle turned a quarter."""
    N = 55
    st = anim.merge(anim.stance(dict(MOTION, stance="neutral"), 0.3), anim.arms_relaxed())
    raise_ = _pose(g, dict(hips=(-4, 6, 0), spine=(-6, 4, 0), chest=(-8, 4, 0), head=(-8, 0, 0)), (0.0, 0.02, 0.02),
                   R=(0.35, -0.30, 0.80), Rpole=(-0.9, -0.2, 0.2), aim=(0.0, -0.05, 1.0))
    ps, ds = _plant((-0.16, -0.32, 0.96), (-0.48, -0.95, -0.08))
    strike = _pose(st, dict(hips=(12, -8, 0), spine=(10, -4, 0), chest=(8, -4, 0), head=(-8, 0, 0)), (-0.02, -0.04, -0.10),
                   Rpos=ps, Rpole=(-0.9, 0.2, -0.3), aim=ds, feet=_feet(st, dr=(-0.04, -0.10, 0.0)))
    ph, dh = _plant((-0.20, -0.30, 1.03), (-0.48, -0.95, -0.08))
    hold = _pose(st, dict(hips=(-2, -10, 0), spine=(-3, -4, 0), chest=(-5, -6, 0), neck=(-4, 4, 0), head=(-12, 10, 0)),
                 (0.0, 0.0, 0.0), Rpos=ph, Rpole=(-0.9, 0.3, -0.3), aim=dh, L=None,
                 Lrel=(-0.30, 0.02, -0.60), Lpole=(0.9, 0.5, 0.0), feet=_feet(st, dr=(-0.04, -0.10, 0.0), yr=-14))
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
    """recall (90 f loop): kneel on the right knee behind the grounded blade, both hands folded over the grip;
    a slow beat: she bows her head onto her hands, holds, lifts her chin and looks out, settles."""
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
    keys = [(0.0, base, "linear"), (0.16, base, "linear"), (0.34, bow, "inout"), (0.50, bow, "linear"),
            (0.68, look, "inout"), (0.82, look, "linear"), (1.0, base, "inout")]
    fn = anim.keyed(keys)
    N = 90

    def sample(t):
        b = anim.osc(t, 3)
        return anim.add(fn(t), anim.P(chest=(2.2 * b, 0, 0), head=(-1.2 * b, 0, 0), shoulder_L=(0, 0, 1.5 * b),
                                      shoulder_R=(0, 0, -1.5 * b)))
    return anim.Clip("recall", N, True, anim.drag(sample, N, {"head": 2.0, "neck": 1.0}, loop=True))


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
    sway = anim.add(kneel, anim.P(hips=(0, 0, 8), spine=(0, 0, 6), chest=(4, 0, 4), head=(6, 0, 8)))
    side = anim.merge(fk, anim.P(hips=(-4, -8, -82), spine=(6, 0, -8), chest=(6, 0, -6), neck=(8, 0, -10), head=(10, 0, -14),
                                 thigh_R=(62, 0, 0), shin_R=(-96, 0, 0), foot_R=(20, 0, 0),
                                 thigh_L=(48, 0, -4), shin_L=(-84, 0, 0), foot_L=(20, 0, 0),
                                 upper_arm_R=(30, 0, 40), forearm_R=(36, 0, 0),
                                 upper_arm_L=(40, 0, -50), forearm_L=(30, 0, 0)))
    side["hips_loc"] = (0.10, 0.20, -hip_h + 0.17)
    side["ik"] = {}
    bounce = anim.add(side, anim.P(spine=(0, 0, 3), head=(0, 0, 5), thigh_L=(4, 0, 0)))
    bounce["hips_loc"] = (0.10, 0.20, -hip_h + 0.19)
    rest = anim.add(side, anim.P(head=(0, 0, 3), shin_R=(6, 0, 0)))
    rest["hips_loc"] = (0.10, 0.20, -hip_h + 0.165)
    for p_ in (kneel, sway):
        p_["ik"] = dict(p_.get("ik", {}))
    keys = [(0.0, g, "linear"), (0.12, recoil, "snap"), (0.28, sag, "inout"), (0.46, kneel, "accel"),
            (0.56, sway, "inout"), (0.72, side, "in"), (0.78, bounce, "out"), (0.86, rest, "inout"), (1.0, rest, "linear")]
    fn = anim.keyed(keys)
    T_DROP, T_LAND = 0.24, 0.40
    # where the sword lands: flat on the ground ahead of her right foot (prop.R: +Y the blade, +X = the face
    # normal N -> up, +Z = the width W)
    rest_axis = V((-0.42, -0.91, 0.0)).normalized()
    rest_x = V((0.0, 0.0, 1.0))
    rest_z = rest_x.cross(rest_axis).normalized()
    rest_pos = V((-0.36, -0.42, 0.028))
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
BLADE_FACE_UP = 0.8          # how far the wrist rolls the blade's flat toward the sky (the high game camera)


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
    up = Vector((0.0, 0.0, 1.0))
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
     "palette": {"dawnglass": "#A38C6B", "chalk": "#DBD4C7", "stone": "#C9BCA7", "cloth": "#7C6B59",
                 "cloth2": "#D8CCB4", "leather": "#5E4D3E", "ironstone": "#3F3730", "under": "#3A332D"}},
]
SKIN_FLAT = {"lamp_cage": "wood", "lamp_bead": "lampresin"}

# the procedural paint per build: the base look follows the concept's values; the skins step from the brief's
# section 9 palettes (identity hexes at their own band, the top kept light, the feet dark)
LOOK = {
    None: dict(glass="#C4DDEF", glass_deep="#86AECD", glass_edge="#F4FAFE",
               chalk="#C6C5BD", chalk_hi="#E4E3DC", chalk_lo="#83827B",
               stone="#949B9F", stone_hi="#BAC0C2", stone_lo="#5A6166",
               trim="#ADA491", ink="#17181B",
               lame="#45607A", lame_hi="#7894AC", lame_lo="#1E2A36",
               coat="#4A535A", coat_hi="#6B7780", coat_lo="#262C31", lining="#4C3E31", lining_lo="#2B231C",
               wrap="#302B29", wrap_hi="#5A514B", wrap_lo="#161413",
               glove="#2E2A28", glove_hi="#56514C", boot="#2C2E2A", boot_hi="#4F534C", sole="#181816",
               vamb="#526C82", vamb_hi="#8AA2B6", vamb_lo="#283746",
               scarf="#C9C5B6", scarf_lo="#7C796F", grip="#2F2A28", grip_hi="#5A4E44", under="#34373C"),
    "ervet_stillwater": dict(glass="#A9CDC2", glass_deep="#6A978A", glass_edge="#E6F4EF",
                             chalk="#CDD2CE", chalk_hi="#EDF1EE", chalk_lo="#878D89",
                             stone="#A3AEAD", stone_hi="#C7D0CE", stone_lo="#65706F",
                             trim="#9DB0AA", ink="#151A1A",
                             lame="#4D5A5C", lame_hi="#87999B", lame_lo="#232B2C",
                             coat="#3C4648", coat_hi="#5B6A6C", coat_lo="#1E2526", lining="#2F3B3A", lining_lo="#1A2120",
                             wrap="#2A2F2F", wrap_hi="#525C5B", wrap_lo="#141818",
                             glove="#2A2F2F", glove_hi="#56605F", boot="#2C3332", boot_hi="#59635F", sole="#171B1A",
                             vamb="#4D5A5C", vamb_hi="#8A9C9E", vamb_lo="#253031",
                             scarf="#AFBEB7", scarf_lo="#6F7C76", grip="#2A2F2F", grip_hi="#56605F", under="#2F3739"),
    "ervet_lamplit": dict(glass="#B9A27F", glass_deep="#7A6246", glass_edge="#EEE2CB",
                          chalk="#DBD4C7", chalk_hi="#F2EDE3", chalk_lo="#958D80",
                          stone="#C9BCA7", stone_hi="#E6DCCB", stone_lo="#857967",
                          trim="#C2AE8C", ink="#1A1612",
                          lame="#7C6B59", lame_hi="#B09D85", lame_lo="#42362B",
                          coat="#56463A", coat_hi="#7A6551", coat_lo="#2E251E", lining="#3D3027", lining_lo="#221A15",
                          wrap="#3A2F27", wrap_hi="#66564A", wrap_lo="#1C1612",
                          glove="#3B3028", glove_hi="#6A5A4D", boot="#3A3028", boot_hi="#695848", sole="#1D1813",
                          vamb="#7C6B59", vamb_hi="#B19E87", vamb_lo="#45382D",
                          scarf="#CFC3AA", scarf_lo="#887D69", grip="#3A2F27", grip_hi="#6B5747", under="#3A332D"),
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
    """dawnglass: a pale body with a deeper core toward the middle, a fuller (a deep line with a pale lip), pale
    bevels and a near-white edge, internal streaks, a few bright inclusions; paler toward the point"""
    G0, D, W, N_ = _SWORD["G0"], _SWORD["D"], _SWORD["W"], _SWORD["N"]
    q = P - G0
    t, s = q @ D, q @ W
    hw = _blade_hw(t, L, shape)
    u = np.clip(np.abs(s) / np.maximum(hw, 1e-4), 0.0, 1.0)
    body, deep, edge = _hx(look["glass"]), _hx(look["glass_deep"]), _hx(look["glass_edge"])
    core = deep * 0.45 + body * 0.55
    c = _mixc(np.repeat(core[None], len(P), 0), body, _smooth(0.04, 0.62, u))
    u0 = np.clip(1.0 - 0.95 * bevel / np.maximum(hw, 1e-3), 0.45, 0.9)
    c = _mixc(c, edge, 0.80 * _smooth(u0 - 0.05, u0 + 0.05, u))
    c = _mixc(c, np.array([1.0, 1.0, 1.0], np.float32), 0.55 * _smooth(0.93, 1.0, u))
    fl = _smooth(0.02, 0.06, t) * (1.0 - _smooth(0.66 * L, 0.74 * L, t))
    c = _mixc(c, deep, 0.85 * fl * (1.0 - _smooth(0.05, 0.11, u)))
    c = _mixc(c, edge, 0.55 * fl * np.exp(-((u - 0.15) / 0.03) ** 2))
    c = _mixc(c, edge, 0.30 * _smooth(0.45 * L, L, t))
    diag = (t * 0.8 + s * 2.2) * 9.0
    st = 0.5 + 0.5 * np.sin(diag + 2.0 * NOISE(P, 6.0))
    c = _mixc(c, edge, 0.12 * st * (1.0 - _smooth(0.6, 0.9, u)))
    c = _mixc(c, deep, 0.10 * np.clip(NOISE(P, 14.0, offset=(3.0, 1.0, 0.0)), 0, 1))
    sp = _smooth(0.62, 0.74, NOISE(P, 60.0, offset=(7.0, 2.0, 5.0)))
    c = _mixc(c, np.array([1.0, 1.0, 1.0], np.float32), 0.5 * sp)
    c = _mixc(c, deep * 0.8, 0.25 * (1.0 - _smooth(0.0, 0.05, t)))                   # the guard's shadow
    if broken:
        c = _mixc(c, edge, 0.6 * _smooth(STUB_L - 0.08, STUB_L + 0.02, t))         # fresh fracture
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
        c = shade(P, Nn, kv, L["chalk"], L["chalk_hi"], L["chalk_lo"], k_edge=0.35, seed=4.0)
        q = P - G
        uu, vv, nn = q @ W, q @ D, q @ N_
        face = np.abs(nn) > GUARD_H - 0.004
        if name == "guard":
            sd = poly_sd(np.stack([uu, vv], 1), np.array(GUARD_POLY))
            c = _mixc(c, L["chalk_lo"], 0.55 * face * np.exp(-((sd + 0.013) / 0.0028) ** 2))
            c = _mixc(c, L["chalk_hi"], 0.35 * face * np.exp(-((sd + 0.018) / 0.0025) ** 2))
            for u0, v0, a in GUARD_INLAYS:
                ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
                du, dv = uu - u0, vv - v0
                lx, ly = du * ca + dv * sa, -du * sa + dv * ca
                inside = (np.abs(lx) / 0.050 + np.abs(ly) / 0.0158) < 1.0
                c = _mixc(c, L["ink"], 0.85 * (inside & (np.abs(nn) < GUARD_H + 0.002)))
            dd = (np.abs(uu - CENTRE_DIAMOND[0]) + np.abs(vv - CENTRE_DIAMOND[1])) < CENTRE_DIAMOND[2] * 1.15 * 1.414 + 0.003
            c = _mixc(c, L["ink"], 0.85 * (dd & (np.abs(nn) < GUARD_H + 0.008)))
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
        z = P[:, 2]
        best = np.full(len(P), 1e9)
        row = np.zeros(len(P), int)
        for i in range(LAME_ROWS):
            zc, R, hz = lame_row(i)
            rr = R + (zc - z) * 0.35
            cost = np.abs(r - rr) + 4.0 * np.maximum(0.0, np.abs(z - zc) - hz)
            better = cost < best
            best = np.where(better, cost, best)
            row = np.where(better, i, row)
        zc = 1.745 - 0.064 * row
        v = np.clip((z - (zc - 0.042)) / 0.084, 0.0, 1.0)
        ph0 = -90.0 + np.where(row % 2 == 1, LAME_STEP * 0.5, 0.0)
        f = (phi - ph0) / LAME_STEP
        k = np.floor(f)
        w = f - k
        h = np.mod(np.sin(row * 12.9898 + k * 78.233 + sx * 3.17) * 43758.5453, 1.0)
        t = 0.43 + 0.16 * (h - 0.5) + 0.10 * _paint_noise(P, 2.0) + 0.20 * kv + 0.10 * Nn[:, 2]
        t = t - 0.20 * _smooth(0.55, 0.95, v)                         # tucked under the row above
        t = t + 0.24 * np.exp(-((v - 0.07) / 0.035) ** 2)             # the lit lower rim
        t = t + 0.10 * (1.0 - _smooth(0.0, 0.18, w))                  # the plate's leading bevel
        c = _ramp(t, L["lame_lo"], L["lame"], L["lame_hi"])
        seam = np.minimum(w, 1.0 - w) < 0.045
        c = _mixc(c, L["lame_lo"] * 0.8, 0.75 * seam)
        c = _mixc(c, L["lame_lo"] * 0.7, 0.7 * (v < 0.03))
        sc = _smooth(0.62, 0.75, NOISE.ridged(P, 30.0, 2)) * (1 - seam)
        c = _mixc(c, L["lame_hi"], 0.18 * sc)
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
        t = 0.52 + 0.16 * Nn[:, 2] + 0.10 * _paint_noise(P, 5.0) + 0.30 * kv - 0.6 * rc * 0.3
        c = _ramp(t, L["stone_lo"], L["stone"], L["stone_hi"])
        rim = _smooth(-0.022, -0.012, sd)
        trim = _ramp(0.5 + 0.25 * kv + 0.2 * Nn[:, 2] + 0.08 * _paint_noise(P, 6.0), L["trim"] * 0.6, L["trim"], L["trim"] * 1.18)
        c = _mixc(c, trim, rim)
        gr = poly_sd(xy, np.array(scaled_outline(outline, 0.71, cen)))
        c = _mixc(c, L["stone_lo"] * 0.7, 0.75 * np.exp(-(gr / 0.006) ** 2))
        c = _mixc(c, L["stone_hi"], 0.45 * np.exp(-((gr + 0.010) / 0.004) ** 2))
        c = _mixc(c, L["stone_hi"], 0.35 * _smooth(0.62, 0.75, NOISE.ridged(P, 26.0, 2)))
        wt = np.maximum(_smooth(0.12, 0.42, Nn[:, 2]), rim)            # the top and the rim; the sides keep the concept
        img[m] = (img[m] * (1 - wt[:, None]) + c * wt[:, None]).astype(np.float32)
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
    for s in ("R", "L"):
        e = each(f"rerebrace_{s}")
        if e:
            m, P, Nn, kv = e
            img[m] = shade(P, Nn, kv, L["chalk"], L["chalk_hi"], L["chalk_lo"], k_edge=0.32, seed=8.0)
        e = each(f"vambrace_{s}")
        if e:
            m, P, Nn, kv = e
            c = shade(P, Nn, kv, L["vamb"], L["vamb_hi"], L["vamb_lo"], k_edge=0.40, seed=6.0)
            wr = _J["wrist." + s]
            near = np.linalg.norm(P - wr, axis=1) < 0.065
            trim = shade(P, Nn, kv, L["trim"], L["trim"] * 1.15, L["trim"] * 0.55, k_edge=0.3, seed=7.0)
            c = np.where(near[:, None], trim, c)
            c = _mixc(c, L["trim"], 0.55 * _smooth(0.45, 0.8, kv))
            img[m] = c
        e = each(f"hand_{s}")
        if e:
            m, P, Nn, kv = e
            img[m] = shade(P, Nn, kv, L["glove"], L["glove_hi"], L["wrap_lo"], k_top=0.22, k_edge=0.35, seed=5.0)
    e = each("boots")
    if e:
        m, P, Nn, kv = e
        c = shade(P, Nn, kv, L["boot"], L["boot_hi"], L["sole"], k_top=0.22, k_edge=0.40, seed=10.0)
        c = _mixc(c, L["sole"], _smooth(0.026, 0.016, P[:, 2]))
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
        hm = coat_hem(xs, y)
        band = _smooth(0.050, 0.035, z - hm) * _smooth(0.003, 0.012, z - hm)
        tr = _ramp(0.5 + 0.2 * kv + 0.1 * _paint_noise(P, 13.0), L["trim"] * 0.45, L["trim"] * 0.78, L["trim"])
        c = _mixc(c, tr, band * (~inner))
        edge = _smooth(0.032, 0.012, np.abs(np.abs(xs) - COAT["opening"])) * front
        c = _mixc(c, tr, edge * (~inner) * 0.9)
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
        t = 0.5 + 0.80 * (val - 0.80) + 0.18 * kv + 0.10 * Nn[:, 2]
        img[m] = _ramp(t, L["scarf_lo"], L["scarf"] * 0.92, np.minimum(L["scarf"] * 1.08, 1.0))
    # helm: the concept paints the face; the skull's sides and back are chalk; the visor slot's walls are ink
    e = each("helm")
    if e:
        m, P, Nn, kv = e
        cur = img[m]
        ch = shade(P, Nn, kv, L["chalk"], L["chalk_hi"], L["chalk_lo"], k_edge=0.30, seed=15.0)
        wf = _smooth(-0.55, -0.25, -Nn[:, 1]) * _smooth(-0.13, -0.11, -P[:, 1])     # front-facing face plate
        if _LOOK_ID[0] is not None:                                                   # the skin's chalk
            g = _lum(cur) / max(float(_lum(_hx(LOOK[None]["chalk"]))), 1e-3)
            cur = np.clip(g[:, None] * L["chalk"][None], 0, 1).astype(np.float32)
        c = _mixc(ch, cur, wf)
        inslot = (P[:, 1] > -0.137) & (P[:, 1] < -0.100)
        slot = (np.abs(P[:, 0] - 0.012) < 0.031) & (P[:, 2] > 1.865) & (P[:, 2] < 2.07) & inslot
        diam = (np.abs(P[:, 0] - 0.012) + np.abs(P[:, 2] - 2.032)) < 0.050
        slot = slot & ((np.abs(P[:, 0] - 0.012) < 0.029) | diam)
        cheek = np.zeros(len(P), bool)
        for sxx in (-1, 1):
            a = np.array([0.012 + sxx * 0.058, 2.005])
            b = np.array([0.012 + sxx * 0.074, 1.905])
            ab = b - a
            tt = np.clip(((P[:, [0, 2]] - a) @ ab) / (ab @ ab), 0, 1)
            dd = np.linalg.norm(P[:, [0, 2]] - (a + np.outer(tt, ab)), axis=1)
            cheek |= (dd < 0.0125) & inslot
        c = _mixc(c, L["ink"], 0.92 * (slot | cheek))
        img[m] = c
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
    img[keep] = (c * (1 - w[:, None]) + t * w[:, None]).astype(np.float32)
    N = maps["N"]
    for name, k in (("backplate", 0.18), ("breastplate", 0.10), ("tabard", 0.08)):
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
