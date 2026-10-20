"""ervet: Glass blade (Breaker, Aubade). ART 2.0: sculpted volumes painted by concept projection.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/ervet_plates.py --height 2.15   # plates
    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/ervet_tops.py                   # top plate
    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/ervet_fit.py
    python3 art/build.py fighter ervet --no-skins --clip-sheet

Brief: _design/fighters/ervet.md. Concept: _design/concept/ervet.webp (front + back, hand-painted).
Forms are numpy SDF volumes (common/hifi/sdf.py) fitted to the concept on a 10 cm grid (crest top 2.15 m,
the plates' scale); the base colour is the concept painting projected occlusion-aware onto the game mesh.

Where the concept and the brief disagree the concept's PROPORTIONS win (it is the approved look: a 1.27 m
blade carried across the front, the grip at the right hip, a tall kite helm under a transverse crest, a
0.79 m mantle) and the brief's RULES win: the painted blue gems on the body are painted out (no gems); the
visor slit and the crossguard/pommel inlays are the `accent` glass.

Three blade states (passive forms, CONTRACT §12 form-swapped parts): the whole blade `form='base'`, the
broken stub `form='hilt'`, the oversized blade `form='great'`; one grip, crossguard and accent shared.

Pipeline additions kept inside this module (art/blender/common is shared and not edited here):
  * PROJECTION by group (`_paint_object`): the sword and the body are painted from separate plates and
    visibility maps (the body from blade-free plates, so no ghost blade lands on the coat), and the stub and
    the great blade sample the whole blade's paint through a blade-space remap (they are not in the concept);
  * renders and the three.js QA show the base form only (`form_hilt` / `form_great` hidden), plus a QA sheet
    per extra form (three_ervet_hilt.png, three_ervet_great.png);
  * the coat's and legs' sideways faces take paint from inside the silhouette (`_coat_sides`);
  * skins re-colour hue-aware (`_recolour`): role-coloured texels are tinted at their painted value, trims keep
    the shared per-channel gain;
  * no `channel` clip (`_standard_clips`): Ervet channels nothing.
Helpers: proto/ervet_plates.py (plates), proto/ervet_tops.py (pauldron top plate), proto/ervet_fit.py (fit
check), proto/ervet_poses.py (clip contact sheets from the cached build, no rebuild).
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
from mathutils import Vector  # noqa: E402

from common import anim, export, fighter, materials, parts as libparts, render, rig, scene  # noqa: E402
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
SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92, "yaw": 22.0, "sun": 2.1}   # pale chalk + glass: a softer key
TEXTURE_SIZE = 2048
TEXTURE_SIZES = {"normal": 512, "orm": 512}
GLB_COMPRESS = True
ARMOUR_CONFORM = False
AO_INTO_BASE = 0.25

HEIGHT = 2.15             # crest top (the projection plates' scale)
PROJECTION = {"concept": "ervet", "height": HEIGHT,
              "tops": {"pauldron_R": ("ervet_top.png", 0.5), "pauldron_L": ("ervet_top.png", 0.5)}}   # proto/ervet_tops.py
NOISE = sdf.Noise(11)
VOXEL = 0.0065

# ── the sword frame (concept: guard centre (-0.29, 1.02), tip (0.74, 0.275); the blade tilts forward) ──
GUARD_XZ = np.array([-0.29, 1.02])
TIP_XZ = np.array([0.74, 0.275])
TILT_Y = -0.24                       # blade direction's Y per unit of its XZ length (point forward of the legs)
BLADE_L = 1.31                       # whole blade (3D, from the guard)
STUB_L = 0.30
GREAT_L = 1.62
# the pauldron plates seen from above (her left; mirrored for the right), shared with proto/ervet_tops.py
PAULDRON_OUTLINE = [(0.10, -0.17), (0.24, -0.205), (0.36, -0.15), (0.425, -0.02), (0.39, 0.12), (0.30, 0.22),
                    (0.15, 0.235), (0.08, 0.12)]
CREST_DIAMONDS = (-16.0, -8.0, 0.0, 8.0, 16.0)                # glass diamond inlays along each face of the crest


def _crest_diamonds(sy, off):
    """centres of the crest's diamond inlays on the face y = 0.02 + sy * off (front sy -1, back sy +1)"""
    out = []
    for a in CREST_DIAMONDS:
        t = math.radians(a + 1.0)
        out.append(np.array([0.065 + 0.5475 * math.sin(t), 0.02 + sy * off, 1.55 + 0.5475 * math.cos(t)]))
    return out
BLADE_SHAPE = (0.108, 0.088, 0.024, 0.17)      # width at the guard, width before the point, thickness, point
GREAT_SHAPE = (0.215, 0.17, 0.034, 0.30)
_SWORD: dict = {}                              # the rest-pose sword frame of the current build


def sword_frame(J) -> dict:
    """Guard centre G, blade direction D, width W, face normal N (toward the front), grip point C on the
    axis at the right palm (prop.R's head)."""
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
    W = np.cross(N, D)
    W /= np.linalg.norm(W)
    if W[2] < 0:
        W = -W
    return {"G": G, "D": D, "W": W, "N": N, "C": C, "grip_t": s}


# ── custom primitives (numpy; same protocol as common/hifi/sdf.py Prim) ─────────────────────────────
def poly_sd(p: np.ndarray, V2: np.ndarray) -> np.ndarray:
    """2D signed distance to a polygon (IQ), vectorised over points p (n, 2)."""
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

    def _lerp(self, a, z):
        u = np.clip((z - self.z1) / (self.z0 - self.z1), 0.0, 1.0)      # 0 at the top, 1 at the bottom
        u = u ** 0.85
        return a[0] * (1 - u) + a[1] * u

    def d(self, P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        x = x - self._lerp(self.x0, z)
        rx, ry, y0 = self._lerp(self.rx, z), self._lerp(self.ry, z), self._lerp(self.y0, z)
        q = np.sqrt((x / rx) ** 2 + ((y - y0) / ry) ** 2)
        solid = (q - 1.0) * np.minimum(rx, ry)
        if self.folds is not None:
            solid = solid + self.folds(P, np.arctan2(x, y - y0))
        shell = np.abs(solid) - self.t
        d = np.maximum(shell, self.hem(x, y) - z)
        d = np.maximum(d, z - self.z1)
        # front opening: a slot |x| < opening on the front half (rounded edge)
        front = -(y - y0)                                   # > 0 in front
        d_open = np.minimum(self.opening - np.abs(x), front + 0.02)
        return np.maximum(d, d_open)


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


def jv(J, name) -> np.ndarray:
    return np.array(J[name][:], dtype=np.float64)


def joints_of(info) -> dict:
    return info.joints


# ── the sculpt ───────────────────────────────────────────────────────────────────────────────────
def sculpts(J) -> list:
    """(name, Sculpt, voxel scale, material role, bind, tris, form) in build order. J = rig joints."""
    out = []

    def part(name, S, role, bind, tris, vs=1.0, form=None):
        out.append((name, S, vs, role, bind, tris, form))

    # HELM (rigid on the head): a tall kite face plate over a round skull, the back column under the crest
    helm = Sculpt("helm")
    helm.add(Ellipsoid((0.01, 0.03, 1.955), (0.088, 0.105, 0.108)), k=0.0)
    helm.add(Capsule((0.022, 0.045, 1.95), (0.022, 0.035, 2.05), 0.072), k=0.03)
    face = Extrude((0.0, -0.06, 0.0), [(-0.098, 2.052), (-0.098, 1.96), (-0.072, 1.90), (-0.022, 1.855), (0.012, 1.828),
                                      (0.046, 1.855), (0.096, 1.90), (0.122, 1.96), (0.122, 2.052)],
                   0.078, 0.012, axes=xz_frame())
    helm.add(face, k=0.02)
    helm.inter(Ellipsoid((0.012, 0.07, 1.955), (0.17, 0.215, 0.24)), k=0.015)
    helm.add(RoundCone((0.012, -0.105, 1.875), (0.012, -0.152, 1.836), 0.022, 0.008), k=0.02)   # the beak
    helm.sub(RoundBox((0.012, -0.172, 1.962), (0.0235, 0.045, 0.082), 0.006), k=0.004)         # visor slit
    helm.sub(RoundBox((0.012, -0.172, 2.032), (0.029, 0.045, 0.029), 0.004, axes=sdf.rot_y(45)), k=0.004)
    for sx in (-1, 1):                                                                          # cheek slits
        helm.sub(Capsule((0.012 + sx * 0.058, -0.135, 2.005), (0.012 + sx * 0.074, -0.122, 1.905), 0.0095), k=0.003)
    helm.add(RoundBox((0.012, -0.112, 2.052), (0.11, 0.025, 0.012), 0.008), k=0.012)           # brow band
    part("helm", helm, "chalk", "bone:head", 1200, 0.7)
    visor = Sculpt("visor")
    visor.add(RoundBox((0.012, -0.124, 1.962), (0.0205, 0.009, 0.078), 0.004), k=0.0)
    visor.add(RoundBox((0.012, -0.121, 2.032), (0.0245, 0.009, 0.0245), 0.003, axes=sdf.rot_y(45)), k=0.004)
    for sx in (-1, 1):
        visor.add(Capsule((0.012 + sx * 0.057, -0.121, 2.004), (0.012 + sx * 0.073, -0.108, 1.906), 0.008), k=0.0)
    # the crest's glass: a strip set into its top edge and an arc on each face (the brow plate's inlays)
    visor.add(AnnulusSector((0.065, 0.02, 1.55), 0.584, 0.597, -19.0, 21.0, 0.0175, 0.003, axes=xz_frame()), k=0.0)
    for sy in (-1, 1):
        for p in _crest_diamonds(sy, 0.0265):
            visor.add(RoundBox(p, (0.0165, 0.0045, 0.0165), 0.003, axes=sdf.rot_y(45)), k=0.0)
    part("visor", visor, "accent", "bone:head", 520, 0.5)
    crest = Sculpt("crest")
    band = AnnulusSector((0.065, 0.02, 1.55), 0.505, 0.60, -22.0, 24.0, 0.030, 0.009, axes=xz_frame())
    crest.add(band.displaced(chips(0.006, 14.0), 0.006), k=0.0)
    crest.sub(AnnulusSector((0.065, 0.02, 1.55), 0.582, 0.66, -19.5, 21.5, 0.0185, 0.002, axes=xz_frame()), k=0.003)
    for sy in (-1, 1):
        for p in _crest_diamonds(sy, 0.030):
            crest.sub(RoundBox(p, (0.0195, 0.0065, 0.0195), 0.003, axes=sdf.rot_y(45)), k=0.003)
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
    part("scarf", scarf, "cloth2", ("zblend", "chest", "neck", 1.79, 1.89), 1100)

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

    # MANTLE: per side a pauldron top plate (stone) and five flared lames (blued cloth); the back plate
    for s, sx in (("R", -1), ("L", 1)):
        A = np.array([sx * 0.165, 0.015, 0.0])
        outline = [(sx * x, y) for x, y in PAULDRON_OUTLINE]
        if sx < 0:
            outline = outline[::-1]
        pa = Sculpt(f"pauldron_{s}")
        plate = Extrude((0.0, 0.0, 1.806), outline, 0.03, 0.012)
        pa.add(plate.displaced(chips(0.006, 9.0), 0.006), k=0.0)
        pa.inter(Ellipsoid((sx * 0.20, 0.02, 1.55), (0.50, 0.50, 0.29)), k=0.012)        # domed: edges fall away
        loop = [(x, y, 1.798 - 0.014 * (abs(x) - 0.1) / 0.32) for x, y in outline] + \
               [(outline[0][0], outline[0][1], 1.798 - 0.014 * (abs(outline[0][0]) - 0.1) / 0.32)]
        pa.add(Tube(loop, [0.0115] * len(loop), k=0.006), k=0.006)                          # the trim bead
        cl = np.array([sx * 0.19, -0.10, 1.833])
        pa.sub(RoundBox(cl, (0.03, 0.03, 0.012), 0.004, axes=sdf.rot_z(45)), k=0.003)
        part(f"pauldron_{s}", pa, "stone", f"bone:shoulder.{s}", 560)
        gl = Sculpt(f"clasp_{s}")
        gl.add(RoundBox(cl + np.array([0, 0, -0.004]), (0.026, 0.026, 0.008), 0.003, axes=sdf.rot_z(45)), k=0.0)
        part(f"clasp_{s}", gl, "accent", f"bone:shoulder.{s}", 80, 0.5)
        la = Sculpt(f"lames_{s}")
        for i in range(5):
            zc = 1.745 - 0.064 * i
            R = 0.205 + 0.006 * i

            def lame_prof(r, z, zc=zc, R=R):
                rr = R + (zc - z) * 0.35
                return np.maximum(np.abs(r - rr) - 0.011, np.abs(z - zc) - 0.042)
            la.add(Lathe(A, lame_prof, R + 0.06, zc - 0.05, zc + 0.05), k=0.004)
        la.inter(HalfSpace((sx * 0.10, 0, 1.6), (-sx, 0, 0), 1.0), k=0.01)
        la = _displaced_sculpt(la, chips(0.005, 11.0), 0.005)
        part(f"lames_{s}", la, "cloth", ("dblend", f"shoulder.{s}", f"upper_arm.{s}", (sx * 0.20, 0.015, 1.78),
                                         (sx * 0.35, 0.0, -0.94), 0.10, 0.42), 900)
    back = Sculpt("backplate")
    shell = Lathe((0.0, -0.02, 0.0), lambda r, z: np.abs(r - 0.228) - 0.011, 0.25, 1.40, 1.75)
    back.add(shell, k=0.0)
    back.inter(Extrude((0.0, 0.2, 0.0), [(-0.19, 1.738), (0.19, 1.738), (0.20, 1.565), (0.0, 1.418), (-0.20, 1.565)],
                       0.12, 0.0, axes=xz_frame()), k=0.006)
    back.sub(RoundBox((0.0, 0.215, 1.695), (0.03, 0.03, 0.03), 0.004, axes=sdf.rot_y(45)), k=0.003)
    part("backplate", back, "cloth", "bone:chest", 450)
    gem = Sculpt("inlay_back")
    gem.add(RoundBox((0.0, 0.214, 1.695), (0.025, 0.012, 0.025), 0.003, axes=sdf.rot_y(45)), k=0.0)
    part("inlay_back", gem, "accent", "bone:chest", 120, 0.5)

    # ARMS (auto) + vambraces (rigid on the forearms) + fists (rigid on the hands)
    arms = Sculpt("arms")
    for s in ("L", "R"):
        sh, el, wr = jv(J, f"shoulder.{s}"), jv(J, f"elbow.{s}"), jv(J, f"wrist.{s}")
        arms.add(FlatCapsule(sh, el, 0.066, 0.062, 0.056, 0.054), k=0.0)
        arms.add(FlatCapsule(el, wr, 0.054, 0.052, 0.043, 0.04), k=0.03)
        arms.add(Sphere(sh, 0.07), k=0.03)
    part("arms", arms, "under", "auto", 750)
    for s, sx in (("R", -1), ("L", 1)):
        el, wr = jv(J, f"elbow.{s}"), jv(J, f"wrist.{s}")
        ax = (wr - el) / np.linalg.norm(wr - el)
        out_ = np.array([sx, 0.0, 0.0])
        out_ = out_ - ax * out_.dot(ax)
        out_ /= np.linalg.norm(out_)
        fr = sdf.frame(ax, out_)
        vb = Sculpt(f"vambrace_{s}")
        L = float(np.linalg.norm(wr - el))
        mid = el + ax * (L * 0.48) + out_ * 0.028
        vb.add(RoundBox(mid, (0.036, 0.05, L * 0.47), 0.022, axes=fr), k=0.0)
        vb.add(Ellipsoid(el + out_ * 0.03 + ax * 0.01, (0.055, 0.055, 0.06), axes=fr), k=0.03)          # elbow cop
        vb.add(Torus(wr - ax * 0.03, 0.05, 0.014, axes=sdf.frame(ax)), k=0.01)                          # cuff
        vb.inter(HalfSpace(el + ax * 0.0 + out_ * -0.012, -out_, 1.0), k=0.015)
        part(f"vambrace_{s}", vb, "chalk", f"bone:forearm.{s}", 360)
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

    # BELTS (auto): main belt, a slung lower belt, the chest strap
    belt = Sculpt("belt")
    belt.add(Torus((0.0, 0.015, 1.335), 0.168, 0.031, axes=np.diag([1.0, 0.168 / 0.135, 1.0]), rz=0.034), k=0.0)
    belt.add(Torus((0.0, 0.015, 1.25), 0.185, 0.026, axes=sdf.rot_y(-9) @ np.diag([1.0, 0.185 / 0.145, 1.0]), rz=0.028), k=0.0)
    belt.add(RoundBox((0.0, -0.155, 1.335), (0.04, 0.016, 0.032), 0.01), k=0.0)
    belt.sub(RoundBox((0.0, -0.175, 1.335), (0.021, 0.01, 0.021), 0.003, axes=sdf.rot_y(45)), k=0.002)
    belt.add(Tube([(0.15, -0.115, 1.76), (0.10, -0.172, 1.665), (0.0, -0.19, 1.57), (-0.10, -0.172, 1.47),
                   (-0.155, -0.135, 1.39)], [0.016] * 5, k=0.01), k=0.0)
    part("belt", belt, "leather", "auto", 700)
    bk = Sculpt("inlay_buckle")
    bk.add(RoundBox((0.0, -0.168, 1.335), (0.018, 0.006, 0.018), 0.003, axes=sdf.rot_y(45)), k=0.0)
    part("inlay_buckle", bk, "accent", "bone:spine", 80, 0.5)

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

    # COAT (cape chain): an open coat from under the mantle to a ragged hem, longer on the right
    def hem(x, y):
        return 0.47 + 0.075 * np.clip((x - 0.05) / 0.35, 0.0, 1.0) + 0.02 * NOISE(np.stack([x * 3, y * 3, x * 0], 1), 6.0)

    def coat_folds(P, ang):
        u = ang * 9.0 + 0.8 * NOISE(P, 2.5)
        a = 0.016 * np.clip((1.35 - P[:, 2]) / 0.8, 0.1, 1.0)
        return a * (np.abs(np.sin(u)) * 2.0 - 1.0) * -0.5
    coat = Sculpt("coat")
    coat.add(CoatShell(0.42, 1.58, (0.30, 0.43), (0.205, 0.275), (0.03, 0.065), 0.011, 0.272, hem, coat_folds,
                       x0=(0.0, 0.035)), k=0.0)
    part("coat", coat, "cloth", ("chain", "cape", "chest"), 1900)

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
    boots = Sculpt("boots")
    for s in ("L", "R"):
        an, ball, toe, heel = jv(J, f"ankle.{s}"), jv(J, f"ball.{s}"), jv(J, f"toe.{s}"), jv(J, f"heel.{s}")
        fwd = toe - heel
        fwd[2] = 0
        fwd /= np.linalg.norm(fwd)
        fr = sdf.frame((0, 0, 1), np.cross((0, 0, 1), fwd))
        mid = (heel + toe) * 0.5
        boots.add(RoundBox((mid[0], mid[1], 0.045), (0.05, 0.155, 0.045), 0.04, axes=sdf.frame((0, 0, 1), np.cross(fwd, (0, 0, 1)))), k=0.0)
        boots.add(Ellipsoid(toe - fwd * 0.05 + np.array([0, 0, 0.035]), (0.058, 0.07, 0.04), axes=fr), k=0.04)
        boots.add(FlatCapsule(np.array([an[0], an[1], 0.05]), np.array([an[0], an[1], 0.17]), 0.06, 0.065, 0.052, 0.055), k=0.05)
    boots.inter(HalfSpace((0, 0, 0.0), (0, 0, -1), 2.0), k=0.0)
    part("boots", boots, "leather", "auto", 760)

    # SWORD on prop.R: grip, crossguard, pommel, accent inlays, and the three blade states
    sw = sword_frame(J)
    G, D, W, N = sw["G"], sw["D"], sw["W"], sw["N"]
    grip = Sculpt("grip")
    grip.add(Capsule(G - D * 0.03, G - D * 0.35, 0.021).displaced(lambda P: 0.003 * np.sin(((P - G) @ D) * 140.0), 0.003), k=0.0)
    part("grip", grip, "leather", "bone:prop.R", 220)
    gfr = np.stack([W, D, N])                                      # local X = width, Y = blade axis, Z = face
    guard = Sculpt("guard")
    guard.add(RoundBox(G, (0.036, 0.036, 0.021), 0.012, axes=sdf.rot_z(45) @ gfr), k=0.0)
    for sg in (-1, 1):
        pts = [G + sg * W * 0.03, G + sg * W * 0.085 - D * 0.004, G + sg * W * 0.128 + D * 0.022,
               G + sg * W * 0.142 + D * 0.075]
        guard.add(Tube(pts, [0.024, 0.021, 0.019, 0.016], k=0.012), k=0.012)
        guard.add(Sphere(pts[-1] + D * 0.008, 0.019), k=0.01)
    guard.inter(HalfSpace(G + N * 0.019, N, 0.6), k=0.006)        # flat faces
    guard.inter(HalfSpace(G - N * 0.019, -N, 0.6), k=0.006)
    inl = []
    for sg in (-1, 1):
        for p in (G + sg * W * 0.062, G + sg * W * 0.128 + D * 0.03):
            inl.append(p)
    for p in inl:
        for fn in (-1, 1):
            guard.sub(RoundBox(p + N * fn * 0.019, (0.0145, 0.021, 0.006), 0.003, axes=sdf.rot_z(45) @ gfr), k=0.002)
    part("guard", guard, "chalk", "bone:prop.R", 430)
    pm = G - D * 0.385
    pommel = Sculpt("pommel")
    pommel.add(RoundBox(pm, (0.033, 0.033, 0.019), 0.01, axes=sdf.rot_z(45) @ gfr), k=0.0)
    pommel.add(Torus(G - D * 0.345, 0.025, 0.01, axes=sdf.frame(D)), k=0.008)
    for fn in (-1, 1):
        pommel.sub(RoundBox(pm + N * fn * 0.019, (0.0145, 0.0145, 0.006), 0.003, axes=sdf.rot_z(45) @ gfr), k=0.002)
    part("pommel", pommel, "chalk", "bone:prop.R", 200)
    inlays = Sculpt("inlays")
    for p in inl + [pm]:
        for fn in (-1, 1):
            half = (0.0128, 0.019 if p is not pm else 0.0128, 0.004)
            inlays.add(RoundBox(p + N * fn * 0.0165, half, 0.002, axes=sdf.rot_z(45) @ gfr), k=0.0)
    part("inlays", inlays, "accent", "bone:prop.R", 160, 0.5)
    G0 = G + D * 0.012
    _SWORD.update(sw, G0=G0)
    blade = Sculpt("blade")
    blade.add(Blade(G0, D, W, N, BLADE_L, *BLADE_SHAPE), k=0.0)
    part("blade", blade, "dawnglass", "bone:prop.R", 260, 0.8, "base")

    def broken(s, n):
        return STUB_L - 0.045 + 0.05 * np.abs(np.sin(s * 95.0 + 0.7)) + 0.03 * np.sin(s * 37.0) - 0.4 * n
    stub = Sculpt("blade_hilt")
    stub.add(Blade(G0, D, W, N, STUB_L + 0.06, 0.108, 0.104, 0.024, 0.5, cut=broken), k=0.0)
    part("blade_hilt", stub, "dawnglass", "bone:prop.R", 240, 0.7, "hilt")
    great = Sculpt("blade_great")
    great.add(Blade(G0, D, W, N, GREAT_L, *GREAT_SHAPE, bevel=0.04), k=0.0)
    part("blade_great", great, "dawnglass", "bone:prop.R", 280, 0.9, "great")
    return out


def _displaced_sculpt(S: Sculpt, fn, amp: float) -> Sculpt:
    """the whole sculpt displaced (folds/chips over every op): wrap its op list as one blended primitive"""
    out = Sculpt(S.name)
    out.add(sdf.Blend([(o, p, k) for o, p, k, _ in S.ops]).displaced(fn, amp), k=0.0)
    return out


def skin_extras(extra: dict, J) -> list:
    """skin-only geometry: Lamplit's lamp cage hanging from the pommel (four carved slats round a resin bead)"""
    out = []
    if extra.get("lamp_cage"):
        sw = sword_frame(J)
        G, D, W, N = sw["G"], sw["D"], sw["W"], sw["N"]
        top = G - D * 0.405
        c = top + np.array([0.0, 0.0, -0.045])
        cage, bead = Sculpt("lamp_cage"), Sculpt("lamp_bead")
        cage.add(Capsule(top, top + np.array([0, 0, -0.012]), 0.006), k=0.0)
        cage.add(Torus(c + np.array([0, 0, 0.026]), 0.022, 0.0045), k=0.003)
        cage.add(Torus(c + np.array([0, 0, -0.026]), 0.02, 0.0045), k=0.003)
        for i in range(4):
            a = math.pi * 0.5 * i + math.pi * 0.25
            o = np.array([math.cos(a), math.sin(a), 0.0]) * 0.022
            cage.add(Capsule(c + o + np.array([0, 0, 0.026]), c + o * 0.9 + np.array([0, 0, -0.026]), 0.004), k=0.003)
        bead.add(Ellipsoid(c, (0.014, 0.014, 0.018)), k=0.0)
        out.append(("lamp_cage", cage, 0.45, "wood", "bone:prop.R", 220, None))
        out.append(("lamp_bead", bead, 0.45, "lampresin", "bone:prop.R", 80, None))
    return out


def model(ctx) -> list:
    P = []
    extra = (ctx.skin or {}).get("extra") or {}
    J = ctx.info.joints
    for name, S, vs, role, bind, tris, form in sculpts(J) + skin_extras(extra, J):
        v, q = S.mesh(VOXEL * vs)
        ob = sdf.to_object(f"{name}_high", v, q, ctx.col)
        ob.data.materials.append(ctx.mats[role])
        P.append(fighter.Part(name, high=ob, tris=tris, bind=bind, form=form))
    return P


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
    return libparts.chain_configs(ctx, {"cape": dict(gravity=0.95, stiffness=200.0, damping=24.0, inertia=0.2,
                                                     limit=(-15.0, 42.0)),
                                        "tabard_f": dict(limit=(-40.0, 45.0))})


# ── motion ───────────────────────────────────────────────────────────────────────────────────────
# arm blocks over anim.ONE_HAND: (R wrist rel, R pole, R aim = the BLADE's direction (prop.R runs along the
# blade), L wrist, L pole). With weapon two_hand the right wrist moves 12 % inward and the left hand grips the
# grip 0.17 m behind the right. The point-low guard: the blade forward and down on her right, tip ~0.35 m up.
BLOCKS = {
    "guard":   ((0.30, -0.50, -0.80), (-0.8, 0.5, -0.4), (-0.28, -0.82, -0.50), (-0.07, -0.37, -0.83), None),
    # run (one-handed: the left arm swings): the blade trails low behind on the right side
    "run_fwd": ((-0.02, -0.34, -0.92), (-0.8, 0.4, -0.4), (-0.50, 0.30, -0.80), (-0.15, -0.58, -0.62), None),
    "run_back": ((-0.12, 0.20, -0.95), (-0.6, 0.7, -0.2), (-0.45, 0.62, -0.62), (0.12, 0.34, -0.80), None),
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
    Whole Again, the grounded-blade lobby, the strike-down victory and a grounded recall."""
    prof = MOTION
    g = anim.guard(prof)
    out = {
        "run": anim.gen_run(dict(prof, weapon="one_hand")),          # one hand on the trailing blade, the left arm swings
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
    # cast_a2 Glass Guard / Shard Kick (25 f, f10): the blade planted point-down in front as a wall, braced
    # behind it, the right leg flicking forward past it at the same frame
    pw, dw = _grounded(g, hand_z=1.42, tip=(0.02, -0.40, 0.55))
    wind = _pose(g, dict(hips=(-4, 10, 0), spine=(-6, 6, 0), chest=(-8, 6, 0), head=(-6, -4, 0)), (0.0, 0.04, 0.02),
                 R=(0.40, -0.55, 0.05), aim=(0.0, -0.25, 0.97))
    ph, dh = _grounded(g, hand_z=1.26, tip=(0.02, -0.66, 0.0))
    hit = _pose(g, dict(hips=(12, -6, 0), spine=(10, 0, 0), chest=(8, 0, 0), head=(-10, 0, 0)), (0.0, 0.06, -0.10),
                Rpos=ph, aim=dh, feet={"foot.L": F((0.05, 0.10, 0.0), 0.0, -8.0),
                                       "foot.R": F((-0.02, -0.52, 0.30), 25.0, -10.0)})
    fol = _pose(g, dict(hips=(13, -6, 0), spine=(11, 0, 0), chest=(9, 0, 0), head=(-11, 0, 0)), (0.0, 0.07, -0.11),
                Rpos=ph, aim=dh, feet={"foot.L": F((0.05, 0.10, 0.0), 0.0, -8.0),
                                       "foot.R": F((-0.02, -0.42, 0.16), 10.0, -10.0)})
    out["cast_a2"] = _strike("cast_a2", 25, g, wind, hit, fol)
    out["cast_ult"] = _ult(g)
    out["idle_lobby"] = _lobby(g)
    out["victory"] = _victory(g)
    out["recall"] = _recall(g, ctx)
    return out


def _ult(g) -> anim.Clip:
    """Whole Again (35 f, f14 = the top of the leap): coil with the blade drawn behind (breathing hold), leap with
    the blade overhead, come down swinging it into the ground, hold the landing f14-f26, rise."""
    N = 35
    coil = _pose(g, dict(hips=(18, 14, 0), spine=(14, 8, 0), chest=(12, 8, 0), neck=(-6, 0, 0), head=(-12, -6, 0)),
                 (0.0, 0.10, -0.24), R=(-0.10, 0.45, -0.60), Rpole=(-0.8, 0.5, 0.2), aim=(-0.35, 0.80, -0.48),
                 feet=_feet(g, dl=(0.02, -0.05, 0.0), dr=(-0.02, 0.10, 0.0)))
    coil2 = anim.add(coil, anim.P(chest=(2, 0, 0), head=(-2, 0, 0)))
    coil2["hips_loc"] = (coil["hips_loc"][0], coil["hips_loc"][1], coil["hips_loc"][2] - 0.02)
    air = _pose(g, dict(hips=(-8, 0, 0), spine=(-10, 0, 0), chest=(-12, 0, 0), neck=(-6, 0, 0), head=(-10, 0, 0),
                        thigh_L=(30, 0, 0), thigh_R=(20, 0, 0)),
                (0.0, 0.02, 0.42), R=(0.30, -0.12, 0.95), Rpole=(-0.9, -0.2, 0.2), aim=(0.0, 0.45, 0.89),
                feet={"foot.L": F((0.03, -0.10, 0.62), 20.0, -6.0, 0.0, 0.0, 1.0),
                      "foot.R": F((-0.03, 0.10, 0.52), 10.0, -20.0, 0.0, 0.0, 1.0)})
    land = _pose(g, dict(hips=(22, -4, 0), spine=(16, 0, 0), chest=(12, 0, 0), neck=(-6, 0, 0), head=(-10, 0, 0)),
                 (0.0, -0.06, -0.26), R=(0.30, -0.80, -0.50), Rpole=(-0.8, 0.3, -0.3), aim=(-0.05, -0.62, -0.78),
                 feet=_feet(g, dl=(0.04, -0.14, 0.0), dr=(-0.04, 0.14, 0.0)))
    land2 = anim.add(land, anim.P(chest=(1.5, 0, 0)))
    land2["hips_loc"] = (land["hips_loc"][0], land["hips_loc"][1], land["hips_loc"][2] + 0.015)
    keys = [(0.0, g, "linear"), (0.10, coil, "inout"), (0.18, coil2, "sine"), (0.30, anim.lerp_pose(coil2, air, 0.6), "out"),
            (anim.IMPACT, air, "out"), (0.52, land, "accel"), (0.58, land, "linear"), (0.74, land2, "sine"),
            (0.88, anim.lerp_pose(land2, g, 0.55), "inout"), (1.0, g, "settle")]
    return anim.Clip("cast_ult", N, False, anim.drag(anim.keyed(keys), N, {"head": 1.5, "neck": 1.0}), impact=anim.IMPACT)


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
    """victory (55 f, ends in a hold): the blade raised, struck point-down into the ground; the hold: both hands
    on the grip of the grounded blade, chin up, a quarter turned."""
    N = 55
    st = anim.merge(anim.stance(dict(MOTION, stance="neutral"), 0.3), anim.arms_relaxed())
    raise_ = _pose(g, dict(hips=(-4, 6, 0), spine=(-6, 4, 0), chest=(-8, 4, 0), head=(-8, 0, 0)), (0.0, 0.02, 0.02),
                   R=(0.35, -0.30, 0.80), Rpole=(-0.9, -0.2, 0.2), aim=(0.0, -0.05, 1.0))
    ph, dh = _grounded(st, hand_z=1.18, tip=(0.03, -0.66, 0.0))
    strike = _pose(st, dict(hips=(14, 0, 0), spine=(10, 0, 0), chest=(8, 0, 0), head=(-8, 0, 0)), (0.0, -0.02, -0.10),
                   Rpos=ph, aim=dh)
    pf, df = _grounded(st, hand_z=1.30, tip=(0.03, -0.62, 0.0))
    hold = _pose(st, dict(hips=(-2, 4, 0), spine=(-3, 3, 0), chest=(-4, 4, 0), neck=(-4, 2, 0), head=(-12, 4, 0)),
                 (0.0, 0.0, 0.0), Rpos=pf, aim=df)
    keys = [(0.0, g, "linear"), (0.22, raise_, "inout"), (0.30, anim.lerp_pose(raise_, strike, -0.06), "out"),
            (0.40, strike, "accel"), (0.50, strike, "linear"), (0.72, hold, "inout"), (1.0, hold, "linear")]
    base = anim.drag(anim.keyed(keys), N, {"head": 2.0, "neck": 1.0})

    def sample(t):
        p = base(t)
        if t > 0.72:
            k = min(1.0, (t - 0.72) / 0.12)
            p = anim.add(p, anim.P(chest=(0.8 * k * anim.osc(t, 2), 0, 0)))
        return p
    return anim.Clip("victory", N, False, sample)


def _recall(g, ctx) -> anim.Clip:
    """recall (60 f loop): kneel on the right knee behind the grounded blade, both hands folded over the grip"""
    hip_h = rig._layout(rig.proportions(**PROPORTIONS))["pelvis"].z
    kneel = anim.merge(anim.arms_relaxed(), anim.P(hips=(6, -6, 0), spine=(8, 2, 0), chest=(6, 2, 0), neck=(10, 0, 0),
                                                   head=(14, 0, 0), toe_R=(60, 0, 0)))
    kneel["hips_loc"] = (0.0, 0.10, -hip_h * 0.40)
    kneel["ik"] = anim.feet(l=(0.03, -0.30, 0.0), r=(-0.02, 0.36, 0.06), yl=-6, yr=-8, pr=-62, kr=8)
    pk, dk = _grounded(kneel, hand_z=0.98, tip=(0.03, -0.70, 0.0))
    base = _pose(kneel, Rpos=pk, aim=dk)
    N = 60

    def sample(t):
        b = anim.osc(t, 2)
        return anim.add(base, anim.P(chest=(1.2 * b, 0, 0), head=(-0.8 * b, 0, 0)))
    return anim.Clip("recall", N, True, sample)


_orig_standard_clips = anim.standard_clips


def _standard_clips(skel, profile, overrides=None, optional=("channel", "dash", "stunned")):
    """Ervet channels nothing: no `channel` clip (it would only cost GLB bytes)"""
    if profile is MOTION:
        optional = tuple(o for o in optional if o != "channel")
    return _orig_standard_clips(skel, profile, overrides, optional)


anim.standard_clips = _standard_clips


# ── skins: re-colour of the projected painting per part (palettes: the brief section 9) ─────────────
SKINS: list = [
    {"id": "ervet_stillwater", "extra": {}, "card": {"primary": "#4D5A5C", "secondary": "#8FB3A8"},
     "palette": {"dawnglass": "#8FB3A8", "chalk": "#CDD2CE", "stone": "#B5BFBE", "cloth": "#4D5A5C",
                 "ironstone": "#3A4446", "under": "#2F3739"}},
    {"id": "ervet_lamplit", "extra": {"lamp_cage": True}, "card": {"primary": "#4A4036", "secondary": "#A38C6B"},
     "palette": {"dawnglass": "#A38C6B", "chalk": "#DBD4C7", "stone": "#C9BCA7", "cloth": "#7C6B59",
                 "leather": "#5E4D3E", "ironstone": "#3F3730", "under": "#3A332D"}},
]
SKIN_FLAT = {"lamp_cage": "wood", "lamp_bead": "lampresin"}


# ── pipeline additions (wrapped here; art/blender/common stays shared) ─────────────────────────────
SWORD_PARTS = ("grip", "guard", "pommel", "inlays", "blade", "blade_hilt", "blade_great", "lamp_cage", "lamp_bead")
SWORD_SEEN = ("grip", "guard", "pommel", "blade")           # what the concept's cameras see of the sword
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


def _remap_forms(maps: dict, names: list) -> dict:
    """texels of the stub and the great blade move into the whole blade's frame (same glass paint)"""
    if not _SWORD or "blade_great" not in names:
        return maps
    G0, D, W, N = _SWORD["G0"], _SWORD["D"], _SWORD["W"], _SWORD["N"]
    P = maps["P"].copy()
    part = maps["part"]
    m = part == names.index("blade_great")
    if m.any():
        q = P[m] - G0
        t, s, n = q @ D, q @ W, q @ N
        t2 = np.clip(t * (BLADE_L / GREAT_L), 0.0, BLADE_L)
        hw_g = _blade_hw(t, GREAT_L, GREAT_SHAPE)
        hw_b = _blade_hw(t2, BLADE_L, BLADE_SHAPE)
        s2 = s * np.clip(hw_b / np.maximum(hw_g, 1e-3), 0.0, 1.0)
        n2 = n * (BLADE_SHAPE[2] / GREAT_SHAPE[2])
        P[m] = G0 + np.outer(t2, D) + np.outer(s2, W) + np.outer(n2, N)
    out = dict(maps)
    out["P"] = P
    return out


_orig_paint_object = project.paint_object
SIDE_PAINTED = {"coat": 0.05, "legs": 0.02}     # parts whose sideways faces take paint from inside their silhouette


def _coat_sides(img, maps, names, plates):
    """The coat's sides (normals toward +-X) are the painting's silhouette edge in both views: sampled there
    they take the outline and its padding, streaked along Y. They take the coat's own paint from a few cm
    inside the silhouette instead, softened, front plate blended into back plate by the normal."""
    def ss(a, b, x):
        t = np.clip((x - a) / (b - a), 0.0, 1.0)
        return t * t * (3 - 2 * t)
    soft = {sd: project.blur(plates.img[sd], 7.0) for sd in ("front", "back")}
    for name, inset in SIDE_PAINTED.items():
        if name not in names:
            continue
        m = maps["part"] == names.index(name)
        if not m.any():
            continue
        P, N = maps["P"][m], maps["N"][m]
        st = np.abs(N[:, 0]) / (np.abs(N[:, 0]) + np.abs(N[:, 1]) + 1e-6)
        ws = ss(0.42, 0.85, st)[:, None]
        xin = P[:, 0] - np.sign(P[:, 0]) * inset
        cols = {}
        for sd in ("front", "back"):
            px, py = plates.to_px(sd, xin, P[:, 2])
            cols[sd] = project.bilinear(soft[sd], px, py)
        wb = ss(-0.25, 0.25, N[:, 1])[:, None]
        c = cols["front"] * (1 - wb) + cols["back"] * wb
        img[m] = img[m] * (1 - ws) + c * ws


def _paint_object(obj, size, cfg, names, part_attr="vale_part", log=print, return_maps=False):
    """Ervet's projection: the body from the blade-free plates with body-only visibility, the sword from the
    full plates with sword-only visibility (the stub and the great blade remapped onto the whole blade)."""
    if cfg.get("concept") != ID:
        return _orig_paint_object(obj, size, cfg, names, part_attr=part_attr, log=log, return_maps=return_maps)
    cache = os.path.join(scene.CACHE_DIR, "concept")
    plates_sw = project.Plates(cache, ID, cfg["height"])
    plates_body = project.Plates(cache, ID, cfg["height"])
    plates_body.img = {s: project.load_rgb(os.path.join(cache, f"{ID}_{s}_body.png")) for s in ("front", "back")}
    maps = project.rasterize(obj, size, part_attr)
    idx = {n: i for i, n in enumerate(names)}
    sw_ids = {idx[n] for n in SWORD_PARTS if n in idx}
    seen_ids = {idx[n] for n in SWORD_SEEN if n in idx}
    body_ids = set(range(len(names))) - sw_ids
    ob_b = _sub_object(obj, body_ids, "_ervet_vis_body")
    ob_s = _sub_object(obj, seen_ids, "_ervet_vis_sword")
    vis_b = project.VisibilityMaps.build(ob_b, plates_body, step=2, part_attr=part_attr)
    vis_s = project.VisibilityMaps.build(ob_s, plates_sw, step=2, part_attr=part_attr)
    for o in (ob_b, ob_s):
        me = o.data
        bpy.data.objects.remove(o)
        bpy.data.meshes.remove(me)
    tops = {k: (project.load_rgb(os.path.join(cache, f)), ext) for k, (f, ext) in (cfg.get("tops") or {}).items()}
    flat = {k: scene.hex_srgb(h) for k, h in (cfg.get("flat") or {}).items()}
    img_b = project.paint(maps, plates_body, vis_b, names, tops=tops, flat=flat, bleed=False, log=log)
    img_s = project.paint(_remap_forms(maps, names), plates_sw, vis_s, names, flat=flat, bleed=False, log=log)
    _coat_sides(img_b, maps, names, plates_body)
    part = maps["part"]
    is_sw = np.isin(part, list(sw_ids))
    img = np.where(is_sw[..., None], img_s, img_b)
    iy, ix = project.nearest_index(part >= 0)
    img = img[iy, ix]
    log(f"ervet projection: body {len(body_ids)} parts, sword {len(sw_ids)} parts")
    return (img, maps) if return_maps else img


project.paint_object = _paint_object

_orig_recolour = project.recolour


def _recolour(img, maps, names, roles, base_pal, skin_pal, skip=None, log=print):
    """Ervet's skins re-colour the painting hue-aware: texels near a part's base role colour (the blued lames,
    the glass) take the skin colour at their own painted value (a luminance-preserving tint), texels of other
    colours (the ochre trims, the dark seams) keep the shared per-channel gain. A walnut mantle stays walnut
    instead of turning olive, and the trims stay trims."""
    if "blade_great" not in names:
        return _orig_recolour(img, maps, names, roles, base_pal, skin_pal, skip=skip, log=log)
    part = maps["part"]
    iy, ix = project.nearest_index(part >= 0)
    pid = part[iy, ix]
    lin = project._lin(img)
    out = lin.copy()
    skip = skip or set()
    wl = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    lum = lin @ wl
    chroma = lin - lum[..., None]                                        # the colour away from grey
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
        grey = np.clip(1.0 - (sat[m] - 0.10) / 0.25, 0.0, 1.0)            # near-grey texels: always tinted
        if sB < 0.12:                                                     # a near-neutral role (chalk)
            w = grey
        else:                                                             # same hue family as the role
            cos = (chroma[m] @ cB) / np.maximum(np.linalg.norm(chroma[m], axis=-1) * np.linalg.norm(cB), 1e-6)
            w = np.maximum(grey, np.clip((cos - 0.25) / 0.45, 0.0, 1.0))
        w = w[:, None]
        out[m] = t * w + g * (1 - w)
        log(f"  recolour {n} ({r}): {base_pal[r]} -> {skin_pal[r]} (hue-aware, {float(w.mean()):.2f} tinted)")
    return project._srgb(out).astype(np.float32)


project.recolour = _recolour

_orig_fighter_renders = render.fighter_renders


def _fighter_renders(ctx, objs, P, skin, *a, **kw):
    """renders show the base form (the stub and the great blade nodes stay hidden)"""
    if getattr(ctx.spec, "ID", None) != ID:
        return _orig_fighter_renders(ctx, objs, P, skin, *a, **kw)
    keep = [o for o in objs if not o.name.startswith(HIDE_FORMS)]
    hid = [o for o in objs if o.name.startswith(HIDE_FORMS)]
    for o in hid:
        o.hide_render = True
    try:
        return _orig_fighter_renders(ctx, keep, P, skin, *a, **kw)
    finally:
        for o in hid:
            o.hide_render = False


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
