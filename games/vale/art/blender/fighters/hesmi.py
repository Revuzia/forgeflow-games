"""hesmi: Shard bearer (Plinth, Hourless). ART 2.0: sculpted volumes painted by concept projection.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/hesmi_plates.py --height 2.3 --erase-saturated-above 1.8
    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/hesmi_fit.py          # silhouette fit on the 10 cm grid
    python3 art/build.py fighter hesmi --no-skins [--fast] [--clip-sheet]

Brief: _design/fighters/hesmi.md. Concept: _design/concept/hesmi.webp (front + back, hand-painted).
The forms are numpy SDF volumes (common/hifi/sdf.py) fitted to the concept on a 10 cm grid; the base
colour is the concept painting itself, projected occlusion-aware onto the game mesh (common/hifi/project.py,
the pipeline's PROJECTION hook); normals and AO bake from the sculpt.

Where the concept and the brief disagree the concept's FORMS win (it is the approved look, as on Marund):
the hood crown is the top of the mesh (2.30 m, content art.height), the three shards stand on her back
below it as chiselled crystal slabs, pale honed upper sections and dark weathered lower bodies (the middle
shard is honed all the way down), bound by a carved brace at 1.65 m. The concept's blue "eyes" are flush
accent lenses at the painted iris size (flat, 3 mm under the face, in a flat dark rim; no domes, no gems).
Fix pass 10-20: the brief's hook wins at the top: the three honed shards are cut LEVEL at 2.215 m (the
concept's tip height; ~10 cm flat cuts on the tapered points) with a flush accent inlay in each cut (the
brief's cut-top inlays, what the 52 degree camera sees; the concept-size eyes alone carry ~0.15 % accent,
far under the 1.5 % team-tint gate). The pipeline hooks this module wraps for its own build (common/ is
shared): part binding (auto_only), the projection paint (box-mapped slab sides, pull-push fills), the skin
re-colour (value-kept chroma swap + Shadeprint's painted rims) and the portrait framing.
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
from common.hifi.sdf import (Capsule, Ellipsoid, FlatCapsule, HalfSpace, RoundBox, RoundCone,  # noqa: E402
                             Sculpt, Sphere, Torus, Tube)

ID = "hesmi"
TITLE = "Shard bearer"
ROLE_MASS = "plinth"
ORIGIN = "hourless"
CARD = {"primary": "#5C5A63", "secondary": "#8C8478"}

# rig fitted to the sculpt: the head's crown inside the hood 2.22 m (hood crown 2.30), skull base 1.96,
# shoulder joints x 0.42 at 1.60 (under the mantle), elbows ~(0.47, 1.29), wrists ~(0.51, 1.02), fists
# ~(0.51, 0.97); hips x 0.17 at 0.95, knees 0.52, ankles x 0.23 at 0.12 (big boots, toes out)
PROPORTIONS = rig.proportions(height=2.22, head=0.30, neck=0.06, shoulder_width=0.84, hip_width=0.34, leg=0.832,
                              thigh_frac=0.53, arm=0.59, upper_arm_frac=0.53, hand=0.20, foot=0.40,
                              ankle_height=0.12, spine_curve=0.0, stance=0.06, toe_out_deg=13.0, knee_bend=0.012,
                              a_pose_deg=81.0, arm_forward_deg=3.0, elbow_bend_deg=10.0, shoulder_drop=0.30)
MATERIAL_SET = "bible"
PALETTE = materials.bible_palette(cloth2="#CEC8BB", stone="#D3CEC3", cloth="#A39E95", ironstone="#4C4A53",
                                  gauntlet="#8A867D", leather="#4A4036", under="#34323A", ink="#17181B",
                                  accent="#3F9CFF", slate="#A39E95", rope="#9A8F7A")
# `gauntlet` (the brief's honed-dialstone fists), `slate` (the grey sash and hip wraps, the mid-band wraps a skin
# re-colours apart from the shoulder wraps; = cloth in the base) and `rope` (Gorgewalk's bindings) are roles the
# bible set lacks: extra_materials() makes them
VALUE_GRADIENT_STOPS = materials.BIBLE_GRADIENT_STOPS
# weapon "none": the stone-gauntleted fists are the weapon (anim.FISTS guard, anim._punch hooks)
# cadence 1.2: 20-frame cycle (the long legs' contact stays inside their reach, so the planted foot never
# over-stretches off the ground)
MOTION = anim.motion_profile(weight="heavy", weapon="none", stance="guard", run_ref_speed=3.35, cadence=1.2)
# the fists' guard (weapon "none"): the concept's stance and the brief's 64 px read ("two big fists at the hips"):
# arms hang a little forward with soft elbows, the gauntlets upright slabs at her sides; jab = the hook's contact
ULT_SHRUG = 14.0          # Felled Shard: the shoulders lift under the raised gauntlets (deg)
RECALL_DROP = 0.70        # recall: the hips' drop into the kneel (grounded() lifts the knees onto the floor)
RECALL_SIT = 45.0         # recall: thighs forward (deg), sitting back toward the heels
FISTS = {"guard": ((-0.13, -0.26, -0.90), (-0.6, 0.6, -0.4)), "jab": ((0.22, -0.95, -0.12), (-0.85, 0.25, -0.45))}
SOCKETS = {"weapon": "prop.R", "shard_mid": "x_shard_mid", "fist_r": "x_fist_r", "fist_l": "x_fist_l",
           "rack_top": "x_rack_top"}
# the crossed-arms hold, a front three-quarter from the character's left, the camera at chest height: the face and
# eye-band under the hood, both side shards with their eyes flanking it and the level cut tops (brief §10); the
# portrait frames the hood with BOTH flanking shards (PORTRAIT_FILL widens the shared head-box framing, _install_render)
SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92, "yaw": 8.0, "pitch": 4.0, "x": 0.70,
          "sun": 2.1, "rim_cool": 0.55, "rim_warm": 0.55,       # her pale linen blew out to lavender-white at the bible key
          "portrait_yaw": 10.0, "icon_yaw": 12.0}
PORTRAIT_FILL = 0.74      # the shared portrait camera fits the head box at 0.92; lower = wider (the rack beside the hood)
TEXTURE_SIZE = 2048      # the painted base colour; normal + ORM smaller (CONTRACT §12 Materials)
TEXTURE_SIZES = {"normal": 512, "orm": 512}
GLB_COMPRESS = True
ARMOUR_CONFORM = False
AO_INTO_BASE = 0.25       # the projected painting already carries its painted occlusion; only deepen creases
# ART 2.0 skins re-colour the projected painting part by part (each part's painted texels take the skin role /
# base role gain per channel; pipeline -> project.recolour), plus skin-only extras painted flat (SKIN_FLAT part ->
# role). Palettes: _design/fighters/hesmi.md section 9.
SKINS: list = [
    {"id": "hesmi_gorgewalk", "extra": {"rope_binding": True, "iron_pins": True},
     "card": {"primary": "#4A4F55", "secondary": "#9A8F7A"},
     "palette": {"cloth2": "#C2C6CA", "stone": "#D0D3D5", "cloth": "#A5AAAF", "ironstone": "#5E646D",
                 "gauntlet": "#9096A0", "slate": "#6E747C", "rope": "#9A8F7A"}},
    {"id": "hesmi_shadeprint", "extra": {"light_rims": True},
     "card": {"primary": "#2B2A33", "secondary": "#B7B4BE"},
     "palette": {"cloth2": "#B7B4BE", "stone": "#D6D3DB", "cloth": "#B0AEBB", "ironstone": "#2B2A33",
                 "gauntlet": "#6F6D79", "leather": "#3A3942", "under": "#34333C"}},
]
SKIN_FLAT = {"rope_coils": "rope", "iron_pins": "ironstone"}

HEIGHT = 2.30             # crown of the hood (the projection plates' scale)
PROJECTION = {"concept": "hesmi", "height": HEIGHT, "flat": {"eye_rings": "#2E3046"}}   # the concept's rim colour
NOISE = sdf.Noise(11)
VOXEL = 0.007

# ── the rack: shard outlines measured on the concept's back view (world x, z; m) ──────────────────────
TILT = 8.0                # the rack leans back: tops 0.14 m further back per metre of height
SHARD_T = 0.11            # shard thickness (brief 0.09; the concept's slabs read heavier)
RIDGE = 0.13              # each face falls 1:RIDGE from the centre ridge to the long edges (the chisel facets)
TOP_Z = 2.235              # the three honed shards are cut flat at one height (brief §1/§4), the concept's tip height
INLAY_IN = 0.004          # the cut-top accent inlay's inset from the cut's edges
SHARDS = {
    # name: (polygon (x, z), y of the slab's mid-plane at z 1.6, thickness, role)
    "shard_up_L": ([(0.15, 1.69), (0.36, 1.69), (0.41, 1.97), (0.365, TOP_Z), (0.245, TOP_Z), (0.17, 2.07)], 0.385, SHARD_T, "stone"),
    "shard_up_R": ([(-0.17, 1.69), (-0.385, 1.69), (-0.425, 2.00), (-0.385, TOP_Z), (-0.265, TOP_Z), (-0.19, 2.06)], 0.385, SHARD_T, "stone"),
    "shard_mid": ([(0.085, 1.70), (0.09, 2.00), (0.035, TOP_Z), (-0.085, TOP_Z), (-0.16, 2.05), (-0.145, 1.68), (-0.075, 1.30),
                   (-0.024, 1.19), (0.035, 1.30)], 0.325, 0.10, "stone"),
    "shard_lo_L": ([(0.035, 1.70), (0.03, 1.06), (0.085, 1.00), (0.29, 1.30), (0.335, 1.70)], 0.37, SHARD_T, "ironstone"),
    "shard_lo_R": ([(-0.065, 1.70), (-0.06, 1.06), (-0.12, 1.00), (-0.34, 1.20), (-0.375, 1.70)], 0.37, SHARD_T, "ironstone"),
}
# heat-weight binds limited to the bones a part may follow (ART 2.0 wrap of the pipeline's 'auto': see
# _install_bind): the skirt never takes a fist's weights, the mantle never an arm's
LEG_BIND = ("auto_only", "hips", "spine", "thigh.L", "thigh.R", "shin.L", "shin.R", "foot.L", "foot.R")
TORSO_BIND = ("auto_only", "hips", "spine", "chest", "neck", "shoulder.L", "shoulder.R", "upper_arm.L", "upper_arm.R",
              "forearm.L", "forearm.R")
MANTLE_BIND = ("auto_only", "spine", "chest", "neck", "shoulder.L", "shoulder.R")
# accent lenses (the concept's blue eyes): (x, z, which faces) on the shard faces
# the middle shard's front face is hidden from the front by the hood but seen over it from the 52 degree game camera
EYES = [(0.285, 2.045, "shard_up_L", (1, -1)), (-0.30, 2.01, "shard_up_R", (1, -1)), (-0.03, 2.066, "shard_mid", (1, -1))]
EYE_R = (0.029, 0.035)    # lens half-width, half-height (m): the concept's iris (4.4 x 5.3 cm on the back plate)
EYE_RIM = 0.007           # the concept's dark rim round the iris (painted flat: PROJECTION flat eye_rings)


def _ccw(poly):
    p = np.asarray(poly, dtype=np.float64)
    a = 0.5 * np.sum(p[:, 0] * np.roll(p[:, 1], -1) - np.roll(p[:, 0], -1) * p[:, 1])
    return p if a > 0 else p[::-1]


class Slab(sdf.Prim):
    """A chiselled crystal slab: a convex outline (u, v) extruded along w with a centre ridge (both faces
    slope 1:`ridge` toward the long edges) and soft bevels (`bevel`: smooth-max radius). `frame` rows are the
    world directions of u (across), w (thickness) and v (along the slab); `c` the origin of (u, v, w)."""

    def __init__(self, c, frame, poly, t, bevel=0.02, ridge=0.22):
        self.c = np.asarray(c, dtype=np.float64)
        self.ax = np.asarray(frame, dtype=np.float64)
        self.poly = _ccw(poly)
        self.t = None if t is None else float(t)          # None: the outline prism only (infinite thickness)
        self.k, self.ridge = float(bevel), float(ridge)
        e = np.roll(self.poly, -1, axis=0) - self.poly
        n = np.stack([e[:, 1], -e[:, 0]], axis=1)
        self.n = n / np.linalg.norm(n, axis=1, keepdims=True)
        self.o = np.sum(self.n * self.poly, axis=1)
        self.uc = float(self.poly[:, 0].mean())

    def bounds(self):
        lo, hi = self.poly.min(0), self.poly.max(0)
        t = 0.3 if self.t is None else self.t
        pts = np.array([[u, w, v] for u in (lo[0], hi[0]) for v in (lo[1], hi[1]) for w in (-t, t)])
        W = pts @ self.ax + self.c
        return W.min(0), W.max(0)

    def d(self, P):
        q = (P - self.c) @ self.ax.T                 # (u, w, v)
        uv = q[:, [0, 2]]
        d2 = None
        for n, o in zip(self.n, self.o):
            di = uv @ n - o
            d2 = di if d2 is None else sdf.smax(d2, di, self.k)
        if self.t is None:
            return d2
        dt = (np.abs(q[:, 1]) + self.ridge * np.abs(q[:, 0] - self.uc) - 0.5 * self.t) / math.sqrt(1 + self.ridge ** 2)
        return sdf.smax(d2, dt, self.k)


def rack_frame():
    a = math.radians(TILT)
    return np.array([[1.0, 0.0, 0.0], [0.0, math.cos(a), -math.sin(a)], [0.0, math.sin(a), math.cos(a)]])


def shard_slab(name):
    poly, y0, t, _ = SHARDS[name]
    F = rack_frame()
    # local v = z - 1.6 (the frame's v axis is tilted, the outline is measured in world z: cos 8 deg ~ 0.99)
    c = np.array([0.0, y0, 1.6])
    loc = [(u, v - 1.6) for u, v in poly]
    return Slab(c, F, loc, t, bevel=0.022, ridge=RIDGE), c, F, t


def cut_inlay(name, grow, z0, z1):
    """the accent plate in a shard's level cut: the cut's outline inset by INLAY_IN (minus `grow`), between z0 and z1"""
    _, c, F, t = shard_slab(name)
    poly = _ccw(SHARDS[name][0])
    xs = []
    for (x0, q0), (x1, q1) in zip(poly, np.roll(poly, -1, axis=0)):
        z = TOP_Z - 0.006
        if (q0 - z) * (q1 - z) <= 0 and q0 != q1:
            xs.append(x0 + (x1 - x0) * (z - q0) / (q1 - q0))
    u0, u1 = min(xs) + INLAY_IN - grow, max(xs) - INLAY_IN + grow
    rect = [(u0, z0 - 0.02 - 1.6), (u1, z0 - 0.02 - 1.6), (u1, z1 + 0.02 - 1.6), (u0, z1 + 0.02 - 1.6)]
    sl = Slab(c, F, rect, t - 2 * INLAY_IN + 2 * grow, bevel=0.006, ridge=RIDGE)
    return sdf.Blend([("add", sl, 0.0), ("inter", HalfSpace(c + F[2] * (z1 - 1.6), F[2], 0.4), 0.0),
                      ("inter", HalfSpace(c + F[2] * (z0 - 1.6), -F[2], 0.4), 0.0)])


def slab_face(name, x, z, side):
    """world point on a shard's face (side +1 = back, -1 = front) near (x, z) and the face normal"""
    _, c, F, t = shard_slab(name)
    u, v = x, z - 1.6
    poly = _ccw(SHARDS[name][0])
    uc = float(poly[:, 0].mean())
    w = side * (0.5 * t - RIDGE * abs(u - uc))
    p = c + F[0] * u + F[1] * w + F[2] * v
    return p, F[1] * side


def _eye_axes(F, n):
    """an eye's frame rows: across the shard, out of the face, along the face"""
    return np.stack([F[0], n, np.cross(F[0], n)])


def folds(amp, freq, axis=0, phase=0.0, zfade=None, dirv=None):
    def fn(P):
        s = P @ np.asarray(dirv, dtype=np.float64) if dirv is not None else P[:, axis]
        u = s * freq + phase + 0.6 * NOISE(P, 3.0)
        a = amp
        if zfade is not None:
            z0, z1 = zfade
            a = amp * np.clip((z0 - P[:, 2]) / (z0 - z1), 0.15, 1.0)
        return a * (np.abs(np.sin(u)) * 2.0 - 1.0) * -0.5
    return fn


def front_only(fn, y0=0.05, floor=0.3):
    """fade a displacement toward the back (+Y): the hip wrap's diagonal folds read as rings under the rack"""
    def out(P):
        return fn(P) * np.clip((y0 - P[:, 1]) / 0.25 + floor, floor, 1.0)
    return out


def chips(amp, freq):
    def fn(P):
        return amp * np.clip(NOISE.ridged(P, freq, 3), 0, 1) - amp * 0.3
    return fn


def wraps(amp, freq, axis=2):
    """horizontal wrap ridges (bandages, face wrap): a soft saw along `axis`"""
    def fn(P):
        u = P[:, axis] * freq + 0.8 * NOISE(P, 6.0)
        return -amp * (0.5 + 0.5 * np.sin(u)) ** 2 + amp * 0.4
    return fn


def sculpts() -> list:
    """(name, Sculpt, voxel scale, material role, bind, tris) in build order."""
    out = []

    def part(name, S, role, bind, tris, vs=1.0):
        out.append((name, S, vs, role, bind, tris))

    # HOOD (rigid on the head): a deep peaked cowl, the face opening carved into its front
    hood = Sculpt("hood")
    # (soft folds: deep sculpted ridges caught the sun as hard streaks and read as a polished helmet in game)
    hood.add(Ellipsoid((0, 0.02, 2.035), (0.245, 0.235, 0.235)).displaced(folds(0.005, 11.0, dirv=(0.6, 0.0, 0.8)), 0.005), k=0.0)
    hood.add(RoundCone((0, 0.03, 2.10), (0, 0.05, 2.235), 0.17, 0.065), k=0.07)
    hood.add(Torus((0, -0.198, 2.035), 0.165, 0.032, axes=np.diag([1.0, 1.0 / 1.18, 1.0]) @ sdf.frame((0, -1, 0))), k=0.03)
    for sx in (-1, 1):                      # the gothic-arch sides of the cowl (front view: +-0.24 at 1.98, +-0.13 at 2.25)
        hood.inter(HalfSpace((sx * 0.25, 0, 1.98), (sx * 0.934, 0, 0.358), 1.0), k=0.05)
    hood.sub(Ellipsoid((0, -0.215, 2.04), (0.150, 0.165, 0.178)), k=0.02)
    part("hood", hood, "cloth2", "bone:head", 1800)

    # FACE: the honed eye-band with its ink slit, the layered face wrap under it (rigid on the head)
    band = Sculpt("eyeband")
    band.add(sdf.Lathe((0, 0.005, 0), lambda r, z: np.maximum(np.maximum(r - 0.198, 0.150 - r),
                                                              np.maximum(z - 2.148, 2.052 - z)), 0.2, 2.04, 2.16), k=0.0)
    band.inter(HalfSpace((0, -0.10, 2.1), (0, 1, 0), 0.5), k=0.012)
    band.sub(RoundBox((0, -0.20, 2.099), (0.11, 0.05, 0.0065), 0.004), k=0.003)
    part("eyeband", band, "stone", "bone:head", 450, 0.6)
    wrap = Sculpt("facewrap")
    wrap.add(Ellipsoid((0, -0.085, 1.99), (0.150, 0.130, 0.105)).displaced(wraps(0.006, 85.0), 0.006), k=0.0)
    wrap.add(Capsule((0, -0.02, 1.86), (0, -0.04, 1.97), 0.13), k=0.05)
    wrap.inter(HalfSpace((0, 0, 2.058), (0, 0, 1), 0.6), k=0.01)
    part("facewrap", wrap, "cloth2", "bone:head", 650, 0.8)

    # MANTLE (heat weights): the rolled shawl round the hood base, over both shoulders, hanging in a U at the
    # front; the brown cape over the shoulders behind
    mant = Sculpt("mantle")
    mant.add(Torus((0, 0.0, 1.905), 0.25, 0.08, axes=sdf.rot_x(-10), rz=0.07), k=0.0)
    for sx in (-1, 1):
        mant.add(Ellipsoid((sx * 0.29, 0.03, 1.835), (0.205, 0.27, 0.085), axes=sdf.rot_y(sx * 16)), k=0.06)
    mant.add(Tube([(-0.43, -0.10, 1.785), (-0.25, -0.26, 1.715), (0.0, -0.31, 1.675), (0.25, -0.27, 1.71), (0.45, -0.10, 1.775)],
                  [0.055, 0.075, 0.082, 0.075, 0.055], k=0.03), k=0.03)
    mant.add(Tube([(-0.30, -0.16, 1.865), (-0.12, -0.27, 1.80), (0.12, -0.27, 1.80), (0.32, -0.15, 1.86)],
                  [0.05, 0.06, 0.06, 0.05], k=0.03), k=0.025)
    mant.add(Ellipsoid((0, 0.17, 1.82), (0.44, 0.17, 0.12)).displaced(folds(0.012, 14.0, axis=0), 0.012), k=0.06)
    part("mantle", mant, "cloth2", MANTLE_BIND, 2200)

    # PAULDRONS: layered rigid shoulder wraps (grey over purple), shoulder -> upper arm by distance
    for s, sx in (("R", -1), ("L", 1)):
        pd = Sculpt(f"pauldron_{s}")
        pd.add(Ellipsoid((sx * 0.43, 0.0, 1.70), (0.135, 0.23, 0.060), axes=sdf.rot_y(sx * 24)).displaced(chips(0.008, 8.0), 0.008), k=0.0)
        pd.add(Ellipsoid((sx * 0.49, 0.0, 1.61), (0.09, 0.21, 0.058), axes=sdf.rot_y(sx * 42)).displaced(chips(0.008, 8.0), 0.008), k=0.012)
        part(f"pauldron_{s}", pd, "cloth", ("dblend", f"shoulder.{s}", f"upper_arm.{s}", (sx * 0.42, 0.0, 1.66), (sx * 0.5, 0.0, -1.0), 0.0, 0.14), 500)

    # TORSO + SLEEVES (heat weights): the wrapped chest, barrel belly, beige puffed sleeves to the elbows
    torso = Sculpt("torso")
    torso.add(Ellipsoid((0, 0.0, 1.47), (0.315, 0.24, 0.30)).displaced(folds(0.010, 16.0, dirv=(0.7, 0.0, 0.7)), 0.010), k=0.0)
    torso.add(Ellipsoid((0, 0.0, 1.20), (0.295, 0.23, 0.22)), k=0.08)
    torso.add(Ellipsoid((0, 0.08, 1.60), (0.30, 0.20, 0.18)), k=0.08)
    torso.add(Capsule((0, 0.0, 1.70), (0, 0.01, 1.95), 0.12), k=0.04)
    for sx in (-1, 1):
        torso.add(FlatCapsule((sx * 0.42, 0.0, 1.60), (sx * 0.47, -0.01, 1.33), 0.14, 0.15, 0.115, 0.125, side=(1, 0, 0)), k=0.06)
        torso.add(Ellipsoid((sx * 0.475, -0.01, 1.44), (0.11, 0.14, 0.10)).displaced(folds(0.008, 22.0, axis=2), 0.008), k=0.04)
    part("torso", torso, "cloth", TORSO_BIND, 2100)

    # (the chest harness and its iron clasps stay the painting's: strap tubes that miss the painted straps by a
    # few cm pick up the pale chest paint as light ridges, so the X is paint on the torso's folds)

    # BELT, SASH (heat weights): the grey sash over the belt, the heavy belt with its buckle, the hip wrap
    belt = Sculpt("belt")
    belt.add(Torus((0, 0.0, 1.32), 0.285, 0.045, axes=np.diag([1.0, 0.285 / 0.235, 1.0]), rz=0.052), k=0.0)
    belt.add(RoundBox((-0.205, -0.258, 1.31), (0.042, 0.016, 0.058), 0.01), k=0.004)
    belt.add(RoundBox((0.15, -0.262, 1.29), (0.035, 0.012, 0.07), 0.008, axes=sdf.rot_y(-20)), k=0.004)
    part("belt", belt, "leather", ("auto_only", "hips", "spine", "chest"), 650)
    sash = Sculpt("sash")
    sash.add(Torus((0, 0.0, 1.405), 0.29, 0.035, axes=np.diag([1.0, 0.29 / 0.235, 1.0])), k=0.0)
    hw = FlatCapsule((0, 0.0, 1.03), (0, 0.0, 1.26), 0.355, 0.265, 0.31, 0.245, side=(1, 0, 0))
    sash.add(hw.displaced(front_only(folds(0.012, 18.0, dirv=(0.45, 0.0, 0.9))), 0.012), k=0.02)
    sash.inter(HalfSpace((0, 0, 1.025), (0, 0, -1), 1.0), k=0.01)
    part("sash", sash, "slate", ("auto_only", "hips", "spine", "chest"), 1150)

    # TUNIC SKIRT (heat weights): the beige panels flaring to the hem at 0.76, the front panel to 0.73
    tun = Sculpt("tunic")
    sk = FlatCapsule((0, 0.01, 0.78), (0, 0.0, 1.10), 0.43, 0.32, 0.34, 0.26, side=(1, 0, 0))
    tun.add(sk.displaced(folds(0.014, 13.0, axis=0, phase=0.7, zfade=(1.05, 0.78)), 0.014), k=0.0)
    tun.inter(HalfSpace((0, 0, 0.765), (0, 0, -1), 1.0), k=0.008)
    # the front panel: a soft, thin relief under the painted tabard (a hard box creased the low mesh across the panel)
    tun.add(RoundBox((0.0, -0.292, 0.905), (0.14, 0.014, 0.17), 0.012, axes=sdf.rot_x(6)), k=0.04)
    part("tunic", tun, "cloth", ("auto_only", "hips", "spine", "thigh.L", "thigh.R"), 1700)

    # LEGS (heat weights): puffed trousers to the knees, wrapped shins
    legs = Sculpt("legs")
    legs.add(Ellipsoid((0, 0.0, 0.98), (0.30, 0.22, 0.14)), k=0.0)
    for sx in (-1, 1):
        legs.add(FlatCapsule((sx * 0.16, 0.0, 0.93), (sx * 0.225, -0.01, 0.55), 0.165, 0.16, 0.15, 0.145, side=(1, 0, 0)), k=0.05)
        legs.add(Ellipsoid((sx * 0.20, -0.01, 0.66), (0.175, 0.165, 0.12)).displaced(folds(0.010, 20.0, axis=2), 0.010), k=0.05)
        legs.add(FlatCapsule((sx * 0.228, -0.01, 0.55), (sx * 0.235, 0.0, 0.17), 0.13, 0.125, 0.115, 0.11, side=(1, 0, 0)).displaced(
            wraps(0.006, 70.0), 0.006), k=0.04)
    part("legs", legs, "under", LEG_BIND, 1250)

    # SHIN GUARDS (rigid on the shins): chipped dark stone knee slab + shin plate
    for s, sx in (("R", -1), ("L", 1)):
        sg = Sculpt(f"shinguard_{s}")
        sg.add(RoundBox((sx * 0.248, -0.125, 0.525), (0.098, 0.05, 0.105), 0.028, axes=sdf.rot_x(-8)).displaced(chips(0.01, 7.0), 0.01), k=0.0)
        sg.add(RoundBox((sx * 0.238, -0.105, 0.315), (0.088, 0.04, 0.10), 0.022, axes=sdf.rot_x(-4)).displaced(chips(0.008, 7.0), 0.008), k=0.0)
        part(f"shinguard_{s}", sg, "ironstone", f"bone:shin.{s}", 320)

    # BOOTS (heat weights): heavy blocky boots (the concept's chamfered toe caps) with a cuff, toes out 13 degrees
    boots = Sculpt("boots")
    for sx in (-1, 1):
        R = sdf.rot_z(sx * 13)
        c = np.array([sx * 0.258, -0.07, 0.088])
        fwd = -R[:, 1]
        nrm = fwd * 0.6 + np.array([0.0, 0.0, 1.0])
        toe = sdf.Blend([("add", RoundBox(c, (0.135, 0.215, 0.088), 0.042, axes=R.T).displaced(chips(0.006, 8.0), 0.006), 0.0),
                         ("inter", HalfSpace(c + fwd * 0.09 + np.array([0, 0, 0.07]), nrm / np.linalg.norm(nrm), 0.5), 0.025)])
        boots.add(toe, k=0.0)
        boots.add(FlatCapsule((sx * 0.235, 0.01, 0.09), (sx * 0.235, 0.01, 0.23), 0.135, 0.13, 0.125, 0.12, side=(1, 0, 0)), k=0.05)
        boots.add(Torus((sx * 0.235, 0.01, 0.215), 0.128, 0.016), k=0.01)
    boots.inter(HalfSpace((0, 0, 0.0), (0, 0, -1), 2.0), k=0.0)
    part("boots", boots, "leather", ("auto_only", "shin.L", "shin.R", "foot.L", "foot.R", "toe.L", "toe.R"), 1050)

    # FOREARMS (heat weights): leather-wrapped forearms
    fa = Sculpt("forearms")
    for sx in (-1, 1):
        fa.add(FlatCapsule((sx * 0.48, -0.01, 1.33), (sx * 0.525, -0.04, 1.03), 0.09, 0.105, 0.085, 0.10, side=(1, 0, 0)).displaced(
            wraps(0.007, 60.0), 0.007), k=0.0)
    part("forearms", fa, "leather", ("auto_only", "upper_arm.L", "upper_arm.R", "forearm.L", "forearm.R", "hand.L", "hand.R"), 650)

    # GAUNTLETS (rigid on the forearms): the honed-dialstone slabs on the outer forearms, top cut on a slant
    for s, sx in (("R", -1), ("L", 1)):
        g = Sculpt(f"gauntlet_{s}")
        g.add(RoundBox((sx * 0.615, -0.03, 1.215), (0.085, 0.145, 0.235), 0.032).displaced(chips(0.012, 6.0), 0.012), k=0.0)
        g.inter(HalfSpace((sx * 0.615, 0, 1.445), (sx * -0.25, 0, 1.0), 1.0), k=0.012)
        g.inter(HalfSpace((sx * 0.615, -0.175, 1.0), (0, -0.7, -0.7), 1.0), k=0.012)
        part(f"gauntlet_{s}", g, "gauntlet", f"bone:forearm.{s}", 560)

    # FISTS (rigid on the hands): big leather-gloved fists, honed knuckle plates on the outer front
    for s, sx in (("R", -1), ("L", 1)):
        h = Sculpt(f"fist_{s}")
        c = np.array([sx * 0.515, -0.085, 0.965])      # the x1.7 fists sit forward of the slabs (they read from above)
        h.add(RoundBox(c, (0.108, 0.10, 0.10), 0.05), k=0.0)
        for i in range(4):
            h.add(Capsule(c + (sx * -0.065, -0.088, 0.055 - i * 0.037), c + (sx * 0.035, -0.088, 0.055 - i * 0.037), 0.026), k=0.018)
        h.add(Capsule(c + (sx * -0.095, -0.06, 0.06), c + (sx * -0.075, -0.09, -0.02), 0.032), k=0.02)
        part(f"fist_{s}", h, "leather", f"bone:hand.{s}", 430)
        kp = Sculpt(f"knuckle_{s}")
        kp.add(RoundBox(c + (sx * 0.095, -0.045, -0.015), (0.062, 0.085, 0.07), 0.025).displaced(chips(0.008, 8.0), 0.008), k=0.0)
        part(f"knuckle_{s}", kp, "gauntlet", f"bone:hand.{s}", 230)

    # THE RACK (rigid on the chest): five slab sections, the carved brace, the inset eyes
    sockets = {}
    for x, z, name, sides in EYES:
        for side in sides:
            p, n = slab_face(name, x, z, side)
            sockets.setdefault(name, []).append((p, n))
    F = rack_frame()
    for name in ("shard_up_L", "shard_up_R", "shard_mid", "shard_lo_L", "shard_lo_R"):
        sl, *_ = shard_slab(name)
        S = Sculpt(name)
        S.add(sl.displaced(chips(0.010, 5.0), 0.010), k=0.0)
        if name in ("shard_up_L", "shard_up_R", "shard_mid"):
            S.inter(HalfSpace(np.array([0.0, SHARDS[name][1], 1.6]) + F[2] * (TOP_Z - 1.6), F[2], 0.5), k=0.006)
            S.sub(cut_inlay(name, 0.002, TOP_Z - 0.010, TOP_Z + 0.08), k=0.002)
        for p, n in sockets.get(name, []):          # the eye socket: a shallow dish the ink rim and the lens sit in
            S.sub(Ellipsoid(p, (EYE_R[0] + EYE_RIM + 0.002, 0.013, EYE_R[1] + EYE_RIM + 0.002), axes=_eye_axes(F, n)), k=0.003)
        part(name, S, SHARDS[name][3], "bone:chest", 520 if name != "shard_mid" else 760)
    br = Sculpt("brace")
    bc = np.array([0.0, 0.37, 1.6]) + F[2] * 0.055 + F[1] * 0.075
    br.add(RoundBox(bc, (0.40, 0.022, 0.048), 0.014, axes=F).displaced(chips(0.006, 9.0), 0.006), k=0.0)
    for sx in (-1, 1):
        br.add(Tube([bc + (sx * 0.39, -0.02, 0.0), (sx * 0.42, 0.30, 1.67), (sx * 0.36, 0.17, 1.74)], [0.022, 0.02, 0.018], k=0.01), k=0.01)
    part("brace", br, "leather", "bone:chest", 420)
    # the concept's eyes: a flat lens (accent) sunk 3 mm under the face, in a flat ink rim 5 mm under it (no dome)
    eyes, rings = Sculpt("eyes"), Sculpt("eye_rings")
    for name, lst in sockets.items():
        for p, n in lst:
            ax = _eye_axes(F, n)
            lens = sdf.Blend([("add", Ellipsoid(p - n * 0.02, (EYE_R[0], 0.03, EYE_R[1]), axes=ax), 0.0),
                              ("inter", HalfSpace(p - n * 0.003, n, 0.2), 0.0)])
            eyes.add(lens, k=0.0)
            rim = sdf.Blend([("add", Ellipsoid(p - n * 0.02, (EYE_R[0] + EYE_RIM, 0.03, EYE_R[1] + EYE_RIM), axes=ax), 0.0),
                             ("inter", HalfSpace(p - n * 0.006, n, 0.2), 0.0)])
            rings.add(rim, k=0.0)
    # the brief's cut-top inlays: a flat accent plate set flush into a pocket in each level cut (Felled Shard's warning)
    for name in ("shard_up_L", "shard_up_R", "shard_mid"):
        eyes.add(cut_inlay(name, 0.0, TOP_Z - 0.012, TOP_Z + 0.002), k=0.0)
    part("eyes", eyes, "accent", "bone:chest", 300, 0.5)
    part("eye_rings", rings, "ink", "bone:chest", 240, 0.5)
    return out


def extra_materials(ctx) -> dict:
    """roles the bible set lacks: gauntlet (honed dialstone, darker than the cut bands), slate, rope"""
    pal = dict(materials.BIBLE_PALETTE, **PALETTE)
    pal.update(ctx.palette)
    return {"gauntlet": materials.honed_stone("gauntlet", pal, "gauntlet", ctx.gradient, rough=0.64, chisel=0.9),
            "slate": materials.heavy_cloth("slate", pal, "slate", ctx.gradient),
            "rope": materials.heavy_cloth("rope", pal, "rope", ctx.gradient, weave=0.4)}


def skin_extras(extra: dict) -> list:
    """skin-only geometry (brief §9): Gorgewalk's gorge-rope bindings (three 3 cm coils round each honed shard just
    above the brace, never up into the cut band) and four iron pins through the brace. Shadeprint's light rims are
    painted, not built (hesmi_recolour; brief §9 "no extra geometry")."""
    out = []
    F = rack_frame()
    if extra.get("rope_binding"):
        rope = Sculpt("rope_coils")
        for name in ("shard_up_L", "shard_up_R", "shard_mid"):
            sl, c, Fr, t = shard_slab(name)
            for z in (1.765, 1.80, 1.835):
                poly = _ccw(SHARDS[name][0])
                # the slab's width at this height (the outline's crossings of the line z)
                xs = []
                for (x0, z0), (x1, z1) in zip(poly, np.roll(poly, -1, axis=0)):
                    if (z0 - z) * (z1 - z) <= 0 and z0 != z1:
                        xs.append(x0 + (x1 - x0) * (z - z0) / (z1 - z0))
                u0, u1 = min(xs), max(xs)
                cc = c + Fr[0] * 0.5 * (u0 + u1) + Fr[2] * (z - 1.6)
                hu, ht = 0.5 * (u1 - u0), 0.5 * t
                ring = sdf.Blend([("add", RoundBox(cc, (hu + 0.012, ht + 0.012, 0.0145), 0.0145, axes=Fr), 0.0),
                                  ("sub", RoundBox(cc, (hu - 0.004, ht - 0.004, 0.05), 0.01, axes=Fr), 0.0)])
                rope.add(ring.displaced(lambda P: 0.002 * np.sin(np.arctan2(P[:, 1], P[:, 0]) * 40.0), 0.002), k=0.004)
        out.append(("rope_coils", rope, 0.6, "rope", "bone:chest", 900))
    if extra.get("iron_pins"):
        pins = Sculpt("iron_pins")
        bc = np.array([0.0, 0.37, 1.6]) + F[2] * 0.055 + F[1] * 0.075
        for x in (-0.33, -0.11, 0.11, 0.33):
            a = bc + F[0] * x
            pins.add(Capsule(a - F[1] * 0.03, a + F[1] * 0.045, 0.013), k=0.0)
            pins.add(Sphere(a + F[1] * 0.045, 0.021), k=0.006)
        out.append(("iron_pins", pins, 0.5, "ironstone", "bone:chest", 300))
    return out


def model(ctx) -> list:
    _SKIN.clear()
    _SKIN.update(ctx.skin or {})
    P = []
    extra = (ctx.skin or {}).get("extra") or {}
    for name, S, vs, role, bind, tris in sculpts() + skin_extras(extra):
        v, q = S.mesh(VOXEL * vs)
        ob = sdf.to_object(f"{name}_high", v, q, ctx.col)
        ob.data.materials.append(ctx.mats[role])
        P.append(fighter.Part(name, high=ob, tris=tris, bind=bind))
    return P


def rig_extras(ctx) -> None:
    """VFX sockets (brief §4): the middle shard's tip (Plant Shard / Felled Shard origin), the rack top, the
    fists (the Shoulder the Stone / Stand Firm clacks)"""
    top = [q for q in SHARDS["shard_mid"][0] if q[1] >= TOP_Z - 1e-6]      # the middle shard's level cut
    p, _ = slab_face("shard_mid", 0.5 * (top[0][0] + top[-1][0]), TOP_Z, 0)
    rig.add_socket(ctx.info, "x_shard_mid", "chest", tuple(p), (0, 0, 0.1))
    rig.add_socket(ctx.info, "x_rack_top", "chest", (0.0, float(p[1]), 2.22), (0, 0, 0.1))
    for s, sx in (("r", -1), ("l", 1)):
        rig.add_socket(ctx.info, f"x_fist_{s}", f"hand.{s.upper()}", (sx * 0.515, -0.085, 0.965), (0, -0.1, 0))


def _install_bind() -> None:
    """Wrap the pipeline's part binding (common/ is shared; this lives in the fighter module): a Part bind
    ("auto_only", bone, ...) is the pipeline's heat-weight bind (mesh.bind_auto) restricted to those bones."""
    from common import mesh, pipeline
    orig = pipeline.bind_part
    if getattr(orig, "_hesmi", False):
        return

    def bind_part(ctx, part, obj, body_low=None):
        b = part.bind
        if isinstance(b, tuple) and b and b[0] == "auto_only":
            arm = ctx.info.armature
            keep = set(b[1:])
            return mesh.bind_auto(obj, arm, exclude=tuple(x.name for x in arm.data.bones if x.name not in keep))
        return orig(ctx, part, obj, body_low)
    bind_part._hesmi = True
    pipeline.bind_part = bind_part


# ── projection paint: Hesmi's wrap of common/hifi/project.paint (common/ is shared, so it lives here) ────────
# Three changes to the shared pass, installed by _install_paint() for this build only:
#  * BOX-MAPPED slabs: the gauntlets', knuckle plates' and shin slabs' broad side faces (and the gauntlets' cut
#    tops) take their OWN front-plate paint remapped across the face (the front face's cracks and lit bevels
#    stretched over the side), instead of the plate's 1-pixel silhouette edge smeared along Y (flat grey clay);
#  * sideways texels sample their own part's paint SIDE_INSET inside the silhouette (no outline/rim streaks);
#  * occluded texels fill from their own part's paint by pull-push (smooth) instead of nearest-pixel streaks
#    (the 'bullseye' rings and dashes on the tunic back under the rack);
#  * the back plate is lifted a little (the concept's back is a lit tan; under the game's sun it read near-black).
BOX_PARTS = ("gauntlet_R", "gauntlet_L", "knuckle_R", "knuckle_L", "shinguard_R", "shinguard_L")
SIDE_INSET = 0.045
BACK_GAMMA = 0.88


def _pullpush(img: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """fill the invalid pixels of img (h, w, 3) smoothly from the valid ones (pull-push)"""
    C = [img * valid[..., None]]
    W = [valid.astype(np.float32)]
    while min(C[-1].shape[:2]) > 1:
        c, w = C[-1], W[-1]
        h, ww = c.shape[:2]
        c = np.pad(c, ((0, h % 2), (0, ww % 2), (0, 0)))
        w = np.pad(w, ((0, h % 2), (0, ww % 2)))
        c2 = c[0::2, 0::2] + c[1::2, 0::2] + c[0::2, 1::2] + c[1::2, 1::2]
        w2 = w[0::2, 0::2] + w[1::2, 0::2] + w[0::2, 1::2] + w[1::2, 1::2]
        wn = np.minimum(w2, 1.0)
        sc = np.where(w2 > 0, wn / np.maximum(w2, 1e-9), 0.0)
        C.append(c2 * sc[..., None])
        W.append(wn)
    R = C[-1] / np.maximum(W[-1], 1e-9)[..., None]
    for c, w in zip(C[-2::-1], W[-2::-1]):
        up = np.repeat(np.repeat(R, 2, axis=0), 2, axis=1)[:c.shape[0], :c.shape[1]]
        R = c + (1.0 - w)[..., None] * up
    return R.astype(np.float32)


def hesmi_paint(maps, plates, vis, names, tops=None, flat=None, eps=0.02, bleed=True, log=print):
    from common.hifi import project as pj
    P, N, part = maps["P"], maps["N"], maps["part"]
    size = maps["size"]
    out = np.zeros((size, size, 3), dtype=np.float32)
    have = part >= 0
    tops = tops or {}
    flat = flat or {}
    img = {"front": plates.img["front"], "back": np.power(np.clip(plates.img["back"], 0, 1), BACK_GAMMA)}
    fills = {}
    s_ = vis.step
    for side in ("front", "back"):
        pid = vis.part[side]
        small = img[side][s_ // 2::s_, s_ // 2::s_][:pid.shape[0], :pid.shape[1]]
        for k in np.unique(part[have]):
            valid = pid == k
            if valid.any():
                fills[(side, int(k))] = pj.blur(_pullpush(small, valid), 0.8)
    log(f"project (hesmi): {len(fills)} part fills (pull-push)")
    idx = np.nonzero(have)
    p, n = P[idx], N[idx]
    k = part[idx].astype(np.int64)
    st = np.abs(n[:, 0]) / (np.abs(n[:, 0]) + np.abs(n[:, 1]) + 1e-6)
    ws = np.clip((st - 0.66) / 0.26, 0, 1)
    ws = ws * ws * (3 - 2 * ws)
    inset = -np.sign(n[:, 0]) * SIDE_INSET * ws
    cols = {}
    for side in ("front", "back"):
        px, py = plates.to_px(side, p[:, 0], p[:, 2])
        c = pj.bilinear(img[side], px, py)
        dep, hid = vis.lookup(side, px, py)
        if side == "front":
            hidden = ~(p[:, 1] <= np.nan_to_num(dep, nan=1e9) + eps)
        else:
            hidden = ~(p[:, 1] >= np.nan_to_num(dep, nan=-1e9) - eps)
        qx, qy = plates.to_px(side, p[:, 0] + inset, p[:, 2])
        for kk in np.unique(k):
            f = fills.get((side, int(kk)))
            if f is None:
                continue
            sel = k == kk
            hs = sel & hidden
            if hs.any():
                c[hs] = pj.bilinear(f, px[hs] / s_, py[hs] / s_)
            sd = sel & (ws > 0)
            if sd.any():
                c[sd] = c[sd] * (1 - ws[sd, None]) + pj.bilinear(f, qx[sd] / s_, qy[sd] / s_) * ws[sd, None]
        cols[side] = c
    wb = np.clip((n[:, 1] + 0.25) / 0.5, 0, 1)
    wb = wb * wb * (3 - 2 * wb)
    col = cols["front"] * (1 - wb[:, None]) + cols["back"] * wb[:, None]
    # box-mapped slabs: side faces (and cut tops) remapped from the part's own front paint
    for name in BOX_PARTS:
        if name not in names:
            continue
        i = names.index(name)
        sel = k == i
        f = fills.get(("front", i))
        if f is None or not sel.any():
            continue
        q, m = p[sel], n[sel]
        x0, x1 = np.percentile(q[:, 0], [2, 98])
        y0, y1 = np.percentile(q[:, 1], [2, 98])
        z0, z1 = np.percentile(q[:, 2], [2, 98])
        u = np.clip((q[:, 1] - y0) / max(1e-6, y1 - y0), 0, 1)
        xo = np.where(m[:, 0] > 0, x1, x0)
        xr = xo - np.sign(m[:, 0]) * u * (x1 - x0) * 0.92
        ax, ay = plates.to_px("front", xr, q[:, 2])
        side_c = pj.bilinear(f, ax / s_, ay / s_)
        wx = np.clip((np.abs(m[:, 0]) - 0.45) / 0.3, 0, 1)
        wx = (wx * wx * (3 - 2 * wx))[:, None]
        zr = np.clip(z1 - u * min(0.12, 0.5 * (z1 - z0)), z0, z1)
        bx, by = plates.to_px("front", q[:, 0], zr)
        top_c = pj.bilinear(f, bx / s_, by / s_)
        wz = np.clip((m[:, 2] - 0.5) / 0.3, 0, 1)
        wz = (wz * wz * (3 - 2 * wz))[:, None]
        cc = col[sel] * (1 - wx) + side_c * wx
        col[sel] = cc * (1 - wz) + top_c * wz
    for name, (top, ext) in tops.items():
        if name not in names:
            continue
        sel = k == names.index(name)
        th, tw = top.shape[:2]
        tcol = pj.bilinear(top, (p[sel, 0] + ext) / (2 * ext) * tw, (1 - (p[sel, 1] + ext) / (2 * ext)) * th)
        wt = np.clip((n[sel, 2] - 0.55) / 0.30, 0, 1)
        wt = (wt * wt * (3 - 2 * wt))[:, None]
        col[sel] = col[sel] * (1 - wt) + tcol * wt
    for name, rgb in flat.items():
        if name in names:
            col[k == names.index(name)] = np.asarray(rgb, dtype=np.float32)
    out[idx] = col
    if bleed:
        iy, ix = pj.nearest_index(have)
        out = out[iy, ix]
    return out


# ── skins: a stronger per-part re-colour than the shared gain (common/hifi/project.recolour) ─────────────────
# The shared pass multiplies the painting by skin/base per channel, which keeps the CONCEPT's own hues (the
# warm-brown shard faces, the violet trousers) and so left the three looks nearly identical. Here each texel
# keeps its painted VALUE relative to its role but takes the skin's colour (SKIN_CHROMA of the way), and the
# shards and the chest read two roles by value (dark weathered body -> ironstone/leather, honed face -> stone/
# cloth), so Gorgewalk's shards turn slate and Shadeprint's ink. Shadeprint's light rims are painted here too
# (brief §9: a 1 cm light band on every shard edge, no geometry).
SKIN_CHROMA = 0.85
DUAL_ROLES = {"shard_up_L": ("ironstone", "stone"), "shard_up_R": ("ironstone", "stone"),
              "shard_mid": ("ironstone", "stone"), "torso": ("leather", "cloth")}
RIM_W = 0.013
RIM_PARTS = ("shard_up_L", "shard_up_R", "shard_mid", "shard_lo_L", "shard_lo_R")
_SKIN: dict = {}


def _lum(c):
    return c[..., 0] * 0.2126 + c[..., 1] * 0.7152 + c[..., 2] * 0.0722


def _poly_edge_dist(uv: np.ndarray, poly) -> np.ndarray:
    pg = _ccw(poly)
    d = np.full(len(uv), 1e9)
    for a, b in zip(pg, np.roll(pg, -1, axis=0)):
        ab = b - a
        t = np.clip(((uv - a) @ ab) / max(1e-12, ab @ ab), 0, 1)
        d = np.minimum(d, np.linalg.norm(uv - (a + t[:, None] * ab), axis=1))
    return d


def hesmi_recolour(img, maps, names, roles, base_pal, skin_pal, skip=None, log=print):
    from common import scene
    from common.hifi import project as pj
    part = maps["part"]
    iy, ix = pj.nearest_index(part >= 0)
    pid = part[iy, ix]
    Pn = maps["P"][iy, ix]
    lin = pj._lin(img)
    out = lin.copy()
    skip = skip or set()
    full = dict(materials.BIBLE_PALETTE, **PALETTE)
    full.update(base_pal)

    def col(pal, r):
        return pj._lin(np.asarray(scene.hex_srgb(pal.get(r, full.get(r)))))
    for i, nm in enumerate(names):
        r = roles.get(nm)
        if nm in skip or not r or r == "accent":
            continue
        lo_r, hi_r = DUAL_ROLES.get(nm, (r, r))
        if lo_r not in full or hi_r not in full:
            continue
        if all(str(skin_pal.get(x, full[x])).lower() == str(full[x]).lower() for x in (lo_r, hi_r)):
            continue
        m = pid == i
        if not m.any():
            continue
        c = lin[m]
        Y = _lum(c)
        b_lo, b_hi, s_lo, s_hi = col(full, lo_r), col(full, hi_r), col(skin_pal, lo_r), col(skin_pal, hi_r)
        if lo_r == hi_r:
            t = np.zeros(len(c))
        else:
            ya, yb = float(_lum(b_lo)) * 1.4, float(_lum(b_hi)) * 0.75
            t = np.clip((Y - ya) / max(1e-6, yb - ya), 0, 1)
            t = t * t * (3 - 2 * t)
        bref = b_lo[None] * (1 - t[:, None]) + b_hi[None] * t[:, None]
        sref = s_lo[None] * (1 - t[:, None]) + s_hi[None] * t[:, None]
        gain_out = c * np.clip(sref / np.maximum(bref, 1e-4), 0.05, 8.0)
        chroma_out = sref * np.clip(Y / np.maximum(_lum(bref), 1e-4), 0.0, 4.0)[:, None]
        out[m] = gain_out * (1 - SKIN_CHROMA) + chroma_out * SKIN_CHROMA
        log(f"  recolour (hesmi) {nm} ({lo_r}/{hi_r}) -> {skin_pal.get(lo_r, full[lo_r])}/{skin_pal.get(hi_r, full[hi_r])}")
    if (_SKIN.get("extra") or {}).get("light_rims"):
        rim = col(skin_pal, "stone")
        for nm in RIM_PARTS:
            if nm not in names:
                continue
            m = pid == names.index(nm)
            _, c0, F, t = shard_slab(nm)
            q = (Pn[m] - c0) @ F.T
            loc = [(u, v - 1.6) for u, v in SHARDS[nm][0]]
            d = _poly_edge_dist(q[:, [0, 2]], loc)
            a = np.clip(1.0 - (d - RIM_W * 0.5) / (RIM_W * 0.6), 0, 1)[:, None]
            out[m] = out[m] * (1 - a) + rim[None] * 0.92 * a
        log("  recolour (hesmi): light rims painted on the shard edges")
    return pj._srgb(out).astype(np.float32)


def _install_render() -> None:
    """Portrait framing for Hesmi only (common/render.py is shared): the head box the shared portrait camera fits is
    narrower than her rack, so the flanking shards were cut at the frame edge. While Hesmi's renders run, the
    square portrait fit (aspect 1, fill 0.92) uses PORTRAIT_FILL and centres a little higher (the cut tops)."""
    from common import render
    if getattr(render.fighter_renders, "_hesmi", False):
        return
    orig_fit, orig_fr = render._fit_camera, render.fighter_renders
    state = {"on": False}

    def fit(cam, lo, hi, yaw, pitch, lens, fill, aspect, x_frac, y_center=None):
        if state["on"] and abs(aspect - 1.0) < 1e-6 and abs(fill - 0.92) < 1e-6:
            fill = PORTRAIT_FILL
            y_center = (lo.z + hi.z) / 2 + 0.04
        return orig_fit(cam, lo, hi, yaw, pitch, lens, fill, aspect, x_frac, y_center)

    def fr(ctx, *a, **k):
        state["on"] = getattr(ctx.spec, "ID", None) == ID
        try:
            return orig_fr(ctx, *a, **k)
        finally:
            state["on"] = False
    fr._hesmi = True
    render._fit_camera = fit
    render.fighter_renders = fr


def _install_paint() -> None:
    from common.hifi import project
    if getattr(project.paint, "_hesmi", False):
        return
    hesmi_paint._hesmi = True
    project.paint = hesmi_paint
    hesmi_recolour._hesmi = True
    project.recolour = hesmi_recolour


def _ground_pts() -> dict:
    """rest-pose points (armature space, m) on the lowest surfaces each bone carries: the knee and shin slabs, the
    boot sole, heel and toe cap, the fists and the gauntlets' lower ends (the grounding check of `grounded`)"""
    pts = {}
    for s, sx in (("L", 1.0), ("R", -1.0)):
        pts[f"thigh.{s}"] = [(sx * 0.20, -0.17, 0.66)]
        pts[f"shin.{s}"] = [(sx * 0.248, -0.18, 0.43), (sx * 0.248, -0.185, 0.62), (sx * 0.238, -0.15, 0.22),
                            (sx * 0.36, -0.06, 0.52), (sx * 0.12, -0.06, 0.52), (sx * 0.23, 0.14, 0.50),
                            (sx * 0.23, 0.13, 0.25)]
        pts[f"foot.{s}"] = [(sx * 0.235, 0.14, 0.0), (sx * 0.37, 0.0, 0.0), (sx * 0.12, 0.0, 0.0), (sx * 0.235, 0.13, 0.12)]
        pts[f"toe.{s}"] = [(sx * 0.306, -0.279, 0.0), (sx * 0.437, -0.249, 0.0), (sx * 0.175, -0.309, 0.0),
                           (sx * 0.306, -0.27, 0.10)]
        pts[f"hand.{s}"] = [(sx * 0.515, -0.085, 0.86), (sx * 0.515, -0.20, 0.93), (sx * 0.60, -0.05, 0.87)]
        pts[f"forearm.{s}"] = [(sx * 0.615, -0.17, 0.99), (sx * 0.70, 0.0, 1.0)]
    return pts


def grounded(clip, skel, floor: float = 0.0):
    """Keep every sample above the floor (the fix for the sunk death/recall/dash holds): an IK foot whose sole or
    toe cap dips under the floor rises by the dip (tiptoe pivots), a planted fist (HandTarget pos) likewise, and
    whatever is still under (a kneeling shin, a knee, a toe of an FK leg) lifts the hips."""
    from mathutils import Vector
    FT, HT = anim.FootTarget, anim.HandTarget
    PTS = {b: [Vector(q) for q in lst] for b, lst in _ground_pts().items() if b in skel.rest}
    INV = {b: skel.rest[b].inverted() for b in PTS}

    def low(M, bones):
        return min((M[b] @ (INV[b] @ q)).z for b in bones for q in PTS[b])

    def sample(t):
        p = dict(clip.sample(t))
        p["ik"] = dict(p.get("ik", {}))
        for _ in range(4):
            M = skel.fk(anim.resolve(skel, p))
            changed = False
            for sd in ("L", "R"):
                ft = p["ik"].get(f"foot.{sd}")
                if ft is not None and ft.weight > 0.5:
                    lz = low(M, (f"foot.{sd}", f"toe.{sd}"))
                    if lz < floor - 0.001:
                        p["ik"][f"foot.{sd}"] = FT((ft.ankle[0], ft.ankle[1], ft.ankle[2] + floor - lz + 0.002), ft.pitch,
                                                   ft.yaw, ft.toe, ft.knee, ft.weight)
                        changed = True
                ht = p["ik"].get(f"hand.{sd}")
                if ht is not None and ht.pos is not None and ht.weight > 0.5:
                    lz = low(M, (f"hand.{sd}", f"forearm.{sd}"))
                    if lz < floor - 0.001:
                        p["ik"][f"hand.{sd}"] = HT(pos=(ht.pos[0], ht.pos[1], ht.pos[2] + floor - lz + 0.004), pole=ht.pole,
                                                   weight=ht.weight)
                        changed = True
            if changed:
                M = skel.fk(anim.resolve(skel, p))
            planted = {f"{k}.{sd}" for sd in ("L", "R") for k in ("hand", "forearm")
                       if (p["ik"].get(f"hand.{sd}") is not None and p["ik"][f"hand.{sd}"].pos is not None)}
            lz = low(M, [b for b in PTS if b not in planted])
            if lz < floor - 0.001:
                hx, hy, hz = p.get("hips_loc", (0.0, 0.0, 0.0))
                p["hips_loc"] = (hx, hy, hz + floor - lz + 0.002)
                continue
            if not changed:
                break
        return p
    return anim.Clip(clip.name, clip.frames, clip.loop, sample, impact=clip.impact, secondary=clip.secondary,
                     meta=clip.meta)


def clip_overrides(ctx) -> dict:
    """Brief §8 gestures (weapon none: the stone fists). Impact at exactly 40 %.
      idle      the guard, breathing slow and heavy: chest and shoulders rise, the weight settles side to side
      run       heavy 13+ degree lean, fists pumping at the ribs (the generator's planted feet)
      attack1/2 a right / left hook at head height from a torso twist (40 f, contact f16)
      cast_a1   Plant Shard: reach back over the right shoulder for a shard, then a deep lunge on the left foot
                and a two-handed stab that plants both fists on the ground (35 f, f14), hold, rise
      cast_a2   Shoulder the Stone: a low shoulder charge, right shoulder dropped forward, left fist back (25 f, f10)
      cast_a3   Stand Firm (castTime 0): forearms crossed before the face by f3, the gauntlets clack at f10 (25 f)
      cast_ult  Felled Shard: both gauntlets rise OVER the head (fists above the rack), onto the toes, head and
                rack tipping back (f0-f14), at f20 a two-fisted hammer heave forward and down with a stamp (50 f)
      channel   both fists low before the hips, a slow heavy sway (never frozen)
      death     a kneeling collapse forward onto the fists (the rack never meets the ground), resting ON the floor
      recall    kneels on the right knee and sets both fists on the ground, listening: slow breath, head turning
      idle_lobby, victory (chin level in the final crossed-arms hold, the splash pose)
    Every clip goes through `grounded` (nothing under the floor; the review measured -0.17 m in death)."""
    anim.FISTS = dict(FISTS)                       # this Blender process builds only Hesmi
    prof = MOTION
    skel = anim.Skeleton(ctx.info.armature)
    g = anim.guard(prof)
    gf = g["ik"]
    HT, FT = anim.HandTarget, anim.FootTarget
    hip_h = ctx.info.armature.data.bones["hips"].head_local.z      # (portraits.py passes a RigInfo without joints)

    def feet(dl=(0, 0, 0), dr=(0, 0, 0), pl=None, pr=None, yl=None, yr=None):
        fl, fr = gf["foot.L"], gf["foot.R"]
        return {"foot.L": FT(tuple(fl.ankle[i] + dl[i] for i in range(3)), fl.pitch if pl is None else pl,
                             fl.yaw if yl is None else yl),
                "foot.R": FT(tuple(fr.ankle[i] + dr[i] for i in range(3)), fr.pitch if pr is None else pr,
                             fr.yaw if yr is None else yr)}

    def pose(torso=None, hips=(0.0, 0.0, 0.0), R=None, L=None, ft=None, base=None):
        b = base or g
        p = anim.add(b, anim.P(**torso)) if torso else dict(b)
        ik = dict(b["ik"])
        if R:
            ik["hand.R"] = HT(rel=R[0], pole=R[1])
        if L:
            ik["hand.L"] = HT(rel=L[0], pole=L[1])
        if ft:
            ik.update(ft)
        p["ik"] = ik
        hx, hy, hz = b.get("hips_loc", (0.0, 0.0, 0.0))
        p["hips_loc"] = (hx + hips[0], hy + hips[1], hz + hips[2])
        return p

    def strike(name, N, wind, hit, fol, lags=None):
        return anim.Clip(name, N, False, anim.drag(anim.keyed(anim.strike_keys(prof, wind, hit, fol, g)), N,
                                                   lags or {"head": 1.5, "neck": 1.0}), impact=anim.IMPACT)

    out = {}
    PR, PL = (-0.85, 0.30, -0.40), (0.85, 0.30, -0.40)

    # idle: heavier breathing than the generator (the review read it as frozen), the rack within 3 degrees
    def idle(t):
        b = anim.osc(t, 2)
        sw = anim.osc(t, 1, 0.1)
        d = anim.P(chest=(1.6 * b, 0.6 * sw, 0), spine=(0.7 * b, 0, 1.0 * sw), neck=(-1.0 * b, 0, 0),
                   head=(-0.8 * b + 1.5 * anim.osc(t, 1, 0.35), 2.5 * sw, 0), shoulder_L=(0, 0, 3.0 * b),
                   shoulder_R=(0, 0, -3.0 * b), hips=(0, 2.0 * sw, -1.6 * sw))
        p = anim.add(g, d)
        ik = dict(p["ik"])
        for sd, ph in (("R", 0.08), ("L", 0.15)):
            h = ik[f"hand.{sd}"]
            ik[f"hand.{sd}"] = HT(rel=(h.rel[0], h.rel[1] - 0.02 * anim.osc(t, 1, ph), h.rel[2] + 0.03 * anim.osc(t, 2, ph)),
                                  pole=h.pole)
        p["ik"] = ik
        hx, hy, hz = p.get("hips_loc", (0.0, 0.0, 0.0))
        p["hips_loc"] = (hx + 0.02 * sw, hy, hz - 0.008 * (0.5 + 0.5 * b))
        return p
    out["idle"] = anim.Clip("idle", 72, True, idle)

    # run: the generator's planted feet (exact speed), toe-off roll halved for the long boot; a heavier forward
    # lean and the fists pumping at the ribs instead of swinging at the hips
    run = anim.gen_run(prof)

    def run_sample(t):
        p = anim.add(dict(run.sample(t)), anim.P(hips=(4.0, 0, 0), spine=(2.5, 0, 0), chest=(1.0, 0, 0),
                                                 neck=(-3.0, 0, 0), head=(-2.5, 0, 0)))
        ik = dict(p["ik"])
        for k in ("foot.L", "foot.R"):
            f = ik[k]
            if f.ankle[2] <= 1e-6 and f.pitch < 0:
                ik[k] = FT(f.ankle, f.pitch * 0.45, f.yaw, f.toe, f.knee, f.weight)
        for sd, sx in (("R", -1.0), ("L", 1.0)):
            h = ik.get(f"hand.{sd}")
            if h is not None and h.rel is not None:
                fwd = -h.rel[1]                    # + = this fist forward
                ik[f"hand.{sd}"] = HT(rel=(h.rel[0] * 0.5 - sx * 0.04, h.rel[1] * 1.15, -0.42 + 0.30 * max(0.0, fwd)),
                                      pole=(sx * 0.85, 0.45, -0.3))
        p["ik"] = ik
        return p
    out["run"] = anim.Clip("run", run.frames, True, run_sample, meta=run.meta)

    # attack1 / attack2: hooks at head height from a torso twist, 40 frames, contact f16
    w1 = pose(dict(hips=(2, -12, 0), spine=(-2, -12, 3), chest=(-4, -18, 5), head=(0, 12, 0)), (0, 0.03, -0.01),
              R=((-0.55, 0.12, -0.20), (-0.6, 0.6, -0.5)), ft=feet(dl=(0, -0.04, 0)))
    h1 = pose(dict(hips=(1, 14, 0), spine=(1, 12, -3), chest=(0, 18, -6), head=(-4, -14, 0)), (0, -0.05, -0.03),
              R=((0.14, -0.88, 0.40), (-0.95, 0.05, 0.25)), ft=feet(dl=(0, -0.10, 0)))
    f1 = pose(dict(hips=(2, 18, 0), spine=(2, 15, -3), chest=(1, 22, -7), head=(-4, -16, 0)), (0, -0.06, -0.04),
              R=((0.40, -0.74, 0.30), (-0.9, 0.2, 0.2)), ft=feet(dl=(0, -0.10, 0)))
    out["attack1"] = strike("attack1", 40, w1, h1, f1, {"head": 1.5, "neck": 1.0, "hand.L": 2.0})
    out["attack2"] = strike("attack2", 40, anim.mirror(w1), anim.mirror(h1), anim.mirror(f1),
                            {"head": 1.5, "neck": 1.0, "hand.R": 2.0})

    # cast_a1 Plant Shard: reach back over the right shoulder, then plant both fists in the ground ahead
    wind = pose(dict(hips=(-2, -14, 0), spine=(-4, -10, 0), chest=(-6, -14, 0), head=(-4, 12, 0)), (0, 0.04, 0.02),
                R=((0.30, 0.20, 0.80), (-0.5, -0.4, 0.75)), L=((0.05, -0.50, -0.55), PL))
    lunge = feet(dl=(0.02, -0.42, 0.0), dr=(0.0, 0.12, 0.0), pr=-18)

    def stab(lean, drop, fy):
        # the arms drive straight down-forward into the ground ahead: a long diagonal from the rack to the fists
        q = pose(dict(hips=(lean * 0.45, 4, 0), spine=(lean * 0.3, 2, 0), chest=(lean * 0.25, 2, 0), neck=(-14, 0, 0),
                      head=(-16, 0, 0)), (0, -0.22, -drop), ft=lunge)
        q["ik"]["hand.R"] = HT(pos=(-0.08, fy, 0.22), pole=(-0.9, 0.3, 0.3))
        q["ik"]["hand.L"] = HT(pos=(0.10, fy + 0.04, 0.24), pole=(0.9, 0.3, 0.3))
        return q
    out["cast_a1"] = strike("cast_a1", 35, wind, stab(48, 0.40, -1.10), stab(51, 0.42, -1.12), {"head": 1.5, "neck": 1.0})

    # cast_a2 Shoulder the Stone
    wind = pose(dict(hips=(6, 12, 0), spine=(6, 10, 0), chest=(6, 12, 0), head=(-6, -14, 0)), (0, 0.04, -0.05),
                R=((0.30, -0.40, -0.40), (-0.9, 0.1, -0.3)), L=((0.20, 0.20, -0.75), (0.8, 0.3, -0.3)))
    hit = pose(dict(hips=(22, 18, 0), spine=(10, 10, 0), chest=(8, 14, -6), neck=(-8, -8, 0), head=(-14, -14, 0)),
               (0, -0.22, -0.12), R=((0.38, -0.42, -0.30), (-0.9, 0.0, -0.3)), L=((0.28, 0.45, -0.70), (0.8, 0.3, -0.3)),
               ft=feet(dl=(0.0, -0.30, 0.0), dr=(0.0, 0.16, 0.02), pr=-14))
    fol = pose(dict(hips=(24, 20, 0), spine=(11, 11, 0), chest=(9, 15, -6), neck=(-8, -8, 0), head=(-15, -15, 0)),
               (0, -0.25, -0.13), R=((0.38, -0.44, -0.30), (-0.9, 0.0, -0.3)), L=((0.30, 0.48, -0.68), (0.8, 0.3, -0.3)),
               ft=feet(dl=(0.0, -0.32, 0.0), dr=(0.0, 0.18, 0.02), pr=-14))
    out["cast_a2"] = strike("cast_a2", 25, wind, hit, fol)

    # cast_a3 Stand Firm (castTime 0: 3 frames to the X, the clack at f10)
    wide = feet(dl=(0.08, 0.0, 0.0), dr=(-0.08, 0.0, 0.0))
    xo = pose(dict(hips=(2, 0, 0), spine=(-2, 0, 0), chest=(-4, 0, 0), head=(4, 0, 0)), (0, 0.0, -0.02),
              R=((0.58, -0.62, 0.26), (-0.5, -0.1, -0.85)), L=((-0.58, -0.66, 0.28), (0.5, -0.1, -0.85)), ft=wide)
    clack = pose(dict(hips=(2, 0, 0), spine=(-4, 0, 0), chest=(-7, 0, 0), neck=(2, 0, 0), head=(6, 0, 0)), (0, 0.0, -0.06),
                 R=((0.72, -0.52, 0.34), (-0.5, -0.1, -0.85)), L=((-0.72, -0.56, 0.36), (0.5, -0.1, -0.85)), ft=wide)
    recoil = pose(dict(hips=(3, 0, 0), spine=(-3, 0, 0), chest=(-5, 0, 0), neck=(2, 0, 0), head=(5, 0, 0)), (0, 0.0, -0.075),
                  R=((0.70, -0.55, 0.31), (-0.5, -0.1, -0.85)), L=((-0.70, -0.59, 0.33), (0.5, -0.1, -0.85)), ft=wide)
    keys = [(0.0, g, "linear"), (0.12, xo, "out"), (0.40, clack, "accel"), (0.46, recoil, "out"), (0.80, clack, "inout"),
            (1.0, g, "settle")]
    out["cast_a3"] = anim.Clip("cast_a3", 25, False, anim.drag(anim.keyed(keys), 25, {"head": 1.0}), impact=anim.IMPACT)

    # cast_ult Felled Shard: both gauntlets OVERHEAD (fists above the rack), tiptoe, head and rack back; heave at f20
    crouch = pose(dict(hips=(8, 0, 0), spine=(8, 0, 0), chest=(6, 0, 0), head=(6, 0, 0)), (0, 0.02, -0.08),
                  R=((0.25, -0.55, -0.70), PR), L=((-0.25, -0.55, -0.70), PL))
    UP_R, UP_L = (-1.0, 0.25, 0.15), (1.0, 0.25, 0.15)
    up = pose(dict(hips=(-4, 0, 0), spine=(-7, 0, 0), chest=(-9, 0, 0), neck=(-4, 0, 0), head=(-8, 0, 0),
                   shoulder_L=(0, 0, ULT_SHRUG), shoulder_R=(0, 0, -ULT_SHRUG)), (0, 0.03, 0.04),
              R=((0.10, -0.16, 0.98), UP_R), L=((-0.10, -0.16, 0.98), UP_L),
              ft=feet(dl=(0, 0, 0.03), dr=(0, 0, 0.03), pl=-12, pr=-12))
    up2 = pose(dict(hips=(-5, 0, 0), spine=(-8, 0, 0), chest=(-11, 0, 0), neck=(-5, 0, 0), head=(-10, 0, 0),
                    shoulder_L=(0, 0, ULT_SHRUG * 1.1), shoulder_R=(0, 0, -ULT_SHRUG * 1.1)), (0, 0.035, 0.05),
               R=((0.12, -0.12, 0.99), UP_R), L=((-0.12, -0.12, 0.99), UP_L),
               ft=feet(dl=(0, -0.06, 0.05), dr=(0, 0, 0.04), pl=-12, pr=-14))
    heave = pose(dict(hips=(14, 0, 0), spine=(10, 0, 0), chest=(8, 0, 0), neck=(-4, 0, 0), head=(-6, 0, 0)), (0, -0.10, -0.11),
                 R=((0.32, -0.88, -0.30), PR), L=((-0.32, -0.88, -0.30), PL), ft=feet(dl=(0, -0.14, 0)))
    heave2 = pose(dict(hips=(16, 0, 0), spine=(11, 0, 0), chest=(9, 0, 0), neck=(-4, 0, 0), head=(-7, 0, 0)), (0, -0.11, -0.13),
                  R=((0.32, -0.86, -0.35), PR), L=((-0.32, -0.86, -0.35), PL), ft=feet(dl=(0, -0.14, 0)))
    keys = [(0.0, g, "linear"), (0.08, crouch, "inout"), (0.26, up, "inout"), (0.33, up2, "out"), (0.40, heave, "accel"),
            (0.46, heave2, "out"), (0.64, heave2, "linear"), (0.82, anim.lerp_pose(heave2, g, 0.6), "inout"), (1.0, g, "settle")]
    out["cast_ult"] = anim.Clip("cast_ult", 50, False, anim.drag(anim.keyed(keys), 50, {"head": 1.5, "neck": 1.0}),
                                impact=anim.IMPACT)

    # channel: fists low before the hips, a slow heavy sway (the review measured it frozen)
    ch = pose(dict(spine=(4, 0, 0), chest=(4, 0, 0), head=(4, 0, 0)), (0, 0.0, -0.03),
              R=((0.22, -0.55, -0.72), PR), L=((-0.22, -0.55, -0.72), PL))

    def channel(t):
        b, s2 = anim.osc(t, 1), anim.osc(t, 2, 0.2)
        p = anim.add(ch, anim.P(chest=(2.0 * s2, 3.0 * b, 0), spine=(1.0 * s2, 2.0 * b, 0), head=(-1.5 * s2, -2.0 * b, 0),
                                hips=(0, -1.5 * b, 0)))
        ik = dict(p["ik"])
        for sd, sx in (("R", -1.0), ("L", 1.0)):
            h = ik[f"hand.{sd}"]
            ik[f"hand.{sd}"] = HT(rel=(h.rel[0], h.rel[1] - 0.06 * s2, h.rel[2] + 0.07 * anim.osc(t, 2, 0.45 if sx > 0 else 0.2)),
                                  pole=h.pole)
        p["ik"] = ik
        return p
    out["channel"] = anim.Clip("channel", 40, True, channel)

    # death: recoil, knees buckle into a kneel, the torso folds forward onto the fists, a small bounce, rest
    fk = anim.arms_relaxed()
    recoil = pose(dict(hips=(-6, 6, 0), spine=(-8, 0, 0), chest=(-10, 4, 0), neck=(-8, 0, 0), head=(-12, 6, 0)), (0, 0.05, 0.0),
                  R=((0.0, -0.20, -0.95), PR), L=((0.0, -0.20, -0.95), PL))
    drop = hip_h - 0.53
    kneel = anim.merge(fk, anim.P(hips=(4, 4, 0), spine=(8, 0, 0), chest=(6, 0, 0), neck=(6, 0, 0), head=(10, 4, 0),
                                  thigh_L=(-2, 0, -3), shin_L=(-96, 0, 0), foot_L=(-30, 0, 0),
                                  thigh_R=(-4, 0, 3), shin_R=(-92, 0, 0), foot_R=(-30, 0, 0)))
    kneel["hips_loc"] = (0.0, 0.06, -drop)
    kneel["ik"] = {}
    down = anim.merge(fk, anim.P(hips=(40, 0, 0), spine=(22, 0, 0), chest=(16, 0, 0), neck=(10, 0, 0), head=(24, 6, 4),
                                 thigh_L=(86, 0, -4), shin_L=(-136, 0, 0), foot_L=(-55, 0, 0),
                                 thigh_R=(84, 0, 4), shin_R=(-134, 0, 0), foot_R=(-55, 0, 0)))
    down["hips_loc"] = (0.0, 0.10, -drop - 0.30)
    down["ik"] = {"hand.R": HT(pos=(-0.32, -0.46, 0.15), pole=(-0.9, 0.1, 0.5)),       # elbows buckled out
                  "hand.L": HT(pos=(0.32, -0.46, 0.15), pole=(0.9, 0.1, 0.5))}
    bounce = anim.add(down, anim.P(spine=(-4, 0, 0), chest=(-3, 0, 0)))
    bounce["hips_loc"] = (0.0, 0.10, -drop - 0.27)
    keys = [(0.0, g, "linear"), (0.14, recoil, "snap"), (0.42, kneel, "inout"), (0.66, down, "in"), (0.74, bounce, "out"),
            (0.84, down, "inout"), (1.0, down, "linear")]
    out["death"] = anim.Clip("death", 60, False, anim.keyed(keys))

    # recall: kneels on both knees, sitting back toward the heels, the fists set on the thighs, head bowed and
    # listening (a slow breath, the head tilting to one side, then the other), 90-frame loop. (Her short heavy
    # arms reach the ground only with the torso folded flat, which is the death silhouette: the fists rest on the
    # thighs instead, the back upright, so recall never reads as dying.)
    rh = 14.0
    rk = anim.merge(fk, anim.P(hips=(rh, -3, 0), spine=(6, 2, 0), chest=(4, 2, 0), neck=(6, 0, 0), head=(14, 0, 0),
                               thigh_L=(RECALL_SIT + rh, 0, -8), shin_L=(-RECALL_SIT - 92, 0, 0), foot_L=(-55, 0, 0),
                               thigh_R=(RECALL_SIT + rh - 2, 0, 8), shin_R=(-RECALL_SIT - 90, 0, 0), foot_R=(-55, 0, 0)))
    rk["hips_loc"] = (0.0, 0.10, -RECALL_DROP)
    rk["ik"] = {"hand.R": HT(pos=(-0.30, -0.30, 0.47), pole=(-0.9, 0.3, -0.2)),
                "hand.L": HT(pos=(0.30, -0.30, 0.47), pole=(0.9, 0.3, -0.2))}

    def recall(t):
        b = anim.osc(t, 2)
        turn = anim.osc(t, 1, 0.25)
        p = anim.add(rk, anim.P(chest=(1.8 * b, 0, 0), spine=(0.8 * b, 0, 0), neck=(0, 7.0 * turn, 4.0 * turn),
                                head=(-1.2 * b, 12.0 * turn, 10.0 * turn), shoulder_L=(0, 0, 2.0 * b), shoulder_R=(0, 0, -2.0 * b)))
        hx, hy, hz = p["hips_loc"]
        p["hips_loc"] = (hx, hy, hz - 0.006 * (0.5 + 0.5 * b))
        return p
    out["recall"] = anim.Clip("recall", 90, True, recall)

    # dash / stunned: the generators (grounded below: the dash's back toe dipped 8 cm under the floor)
    out["dash"] = anim.gen_dash(prof)
    out["stunned"] = anim.gen_stunned(prof)

    # idle_lobby: a standing stone
    st = anim.stance(dict(prof, stance="wide"), 0.5)
    rest = dict(st)
    rest["ik"] = {k: v for k, v in st["ik"].items() if k.startswith("foot")}
    rest["ik"]["hand.R"] = HT(rel=(-0.16, -0.14, -0.95), pole=(-0.6, 0.7, -0.2))        # arms hang, fists loose
    rest["ik"]["hand.L"] = HT(rel=(0.16, -0.14, -0.95), pole=(0.6, 0.7, -0.2))

    def lobby(t):
        b = anim.osc(t, 3)
        roll = math.sin(math.pi * min(1.0, max(0.0, (t - 0.16) / 0.18))) ** 2          # shoulder roll 0.16-0.34
        look = math.sin(math.pi * min(1.0, max(0.0, (t - 0.48) / 0.36))) ** 2          # look down 0.48-0.84
        d = anim.P(chest=(1.0 * b - 2.0 * roll, 4.0 * roll, -3.0 * roll), spine=(0.4 * b, 0, -1.5 * roll),
                   shoulder_R=(0, 0, -7.0 * roll), shoulder_L=(0, 0, 2.0 * roll), upper_arm_R=(6.0 * roll, 0, 4.0 * roll),
                   neck=(8.0 * look, -3.0 * look, 0), head=(12.0 * look - 0.6 * b, -4.0 * look, 0),
                   hips=(0, 1.0 * anim.osc(t, 1), 0))
        return anim.add(rest, d)
    out["idle_lobby"] = anim.Clip("idle_lobby", 120, True, lobby)

    # victory: a fist planted on the ground, rise, cross the arms (gauntlets crossed before the chest), chin level
    plant = pose(dict(hips=(18, -8, 0), spine=(14, -6, 0), chest=(10, -6, 0), head=(-6, 4, 0)), (0, 0.04, -0.30),
                 L=((-0.10, -0.40, -0.60), PL), ft=feet(dl=(0.04, -0.10, 0), dr=(-0.04, 0.10, 0)))
    plant["ik"]["hand.R"] = HT(pos=(-0.30, -0.50, 0.12), pole=(-0.8, 0.4, 0.3))     # the fist on the ground
    cross = pose(dict(hips=(-1, 0, 0), spine=(-2, 0, 0), chest=(-3, 0, 0), neck=(0, 0, 0), head=(1, 0, 0)), (0, 0.0, 0.01),
                 R=((0.66, -0.62, -0.44), (-0.9, 0.1, -0.4)), L=((-0.64, -0.50, -0.36), (0.9, 0.1, -0.4)),
                 ft=feet(dl=(0.06, 0.0, 0), dr=(-0.06, 0.0, 0)))
    over = anim.add(cross, anim.P(chest=(-2, 0, 0), head=(-3, 0, 0)))
    base = anim.keyed([(0.0, g, "linear"), (0.20, plant, "inout"), (0.30, plant, "linear"), (0.52, over, "out"),
                       (0.62, cross, "inout"), (1.0, cross, "linear")])

    def vic(t):
        p = base(t)
        if t > 0.62:
            k = min(1.0, (t - 0.62) / 0.12)
            p = anim.add(p, anim.P(chest=(0.8 * k * anim.osc(t, 2), 0, 0)))
        return p
    out["victory"] = anim.Clip("victory", 60, False, anim.drag(vic, 60, {"head": 2.0, "neck": 1.0}))
    return {k: (v if k == "run" else grounded(v, skel)) for k, v in out.items()}


try:
    _install_render()      # also when portraits.py imports this module (re-renders from the cache)
except Exception:          # (the venv fit tools import this module with Blender stubbed out)
    pass

if __name__ == "__main__":
    _install_bind()
    _install_paint()
    fighter.main(sys.modules[__name__])
