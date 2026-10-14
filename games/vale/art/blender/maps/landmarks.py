"""VALE map landmarks (RIFT, Hourfall): the one-silhouette-per-region set from
_design/maps/map_rift_landmarks.md §2, modelled to the footprints and heights in
content/maps/map_rift.json `art.terrain.landmarks` (the renderer places each at its `at`).

    Blender -b --factory-startup --python art/blender/maps/landmarks.py -- [--only glass_belfry,...] [--preview]

  glass_belfry       Aubade base: a stacked chalk spire, three open-lattice stages, a dawnglass bell-lantern
  lamp_dome          Serenade base: a low banded ironstone dome on a sandstone drum, a lampresin oculus
  lampwright_stall   the shop kiosk: a spire-roofed stall with a counter and hanging lamps
  shadow_slab        a leaning basalt slab with a chalk-lit top edge (Longshade's north choke)
  shaft_drum         a lying drum of the fallen needle, two carved hour-bands, its broken face south
  numeral_xi/ii/vii/iiii   the dial's numerals, giant, half-buried and tilted (the jungle callouts)
  noon_stone         the XII stele on the north rim        vi_slab   the VI slab lying flat in the south
Surfacing as structures.py (SDF volumes per material, painted tiling textures × vertex light). Glass glows
neutral (never a relationship colour: the Hourbell carries that). Blender (x, y, z) = sim (x, -y, height)
local to each landmark; +Y (Blender) is north. Output: art/out/maps/landmarks/<id>.glb.
"""
from __future__ import annotations

import math
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "units"))
from common import scene  # noqa: E402
from common.hifi import sdf  # noqa: E402
from common.hifi.sdf import Capsule, Ellipsoid, HalfSpace, Lathe, RoundBox, Sculpt, Sphere, Torus  # noqa: E402
import structures as S  # noqa: E402

OUT = os.path.join(scene.OUT_DIR, "maps", "landmarks")
RENDERS = os.path.join(scene.RENDERS_DIR, "maps")

S.MAT.update({
    "chalk": ("plaster_chalk.webp", 2.4, "#FFFFFF"),
    "sandstone": ("chalk_cliff.webp", 3.0, "#FFFFFF"),
    "basalt": ("moss_stone.webp", 3.0, "#FFFFFF"),
    "glass": (None, 1.0, "#BFD3E6"),
    "resin": (None, 1.0, "#E8A04A"),
    "wood": ("wood_planks.webp", 1.2, "#FFFFFF"),
    "cloth": ("cloth_heavy.webp", 0.9, "#FFFFFF"),
})
TINTS = {"chalk": "#C8BFAE", "stone": "#B9AE9B", "sandstone": "#B8946A", "ironstone": "#8C8C98", "basalt": "#4E4A52"}
GLASS_EMIT = {"glass": 0.55, "resin": 0.8}


def mat(name):
    m = S.material(name)
    if name in GLASS_EMIT:
        b = m.node_tree.nodes.get("Principled BSDF")
        b.inputs["Emission Strength"].default_value = GLASS_EMIT[name]
    return m


def build(name: str, parts: dict, col, tris: int, vox: float = 0.05):
    objs = []
    height = 0.0
    total_w = sum({"glass": 0.4, "resin": 0.4}.get(k, 1.0) for k in parts)
    for mname, Sc in parts.items():
        if not Sc.ops:
            continue
        v, q = Sc.mesh(vox * (0.6 if mname in ("glass", "resin") else 1.0))
        ob = sdf.to_object(f"{name}_{mname}", v, q, col)
        S.low(ob, int(tris * {"glass": 0.4, "resin": 0.4}.get(mname, 1.0) / total_w))
        height = max(height, float(v[:, 2].max()))
        if mname not in GLASS_EMIT:
            S.box_uv(ob, S.MAT[mname][1])
        ob.data.materials.append(mat(mname))
        objs.append(ob)
    for ob in objs:
        m = ob.name.rsplit("_", 1)[-1]
        if m not in GLASS_EMIT:
            S.vpaint(ob, height, TINTS.get(m, "#FFFFFF"))
    return objs


def stroke(S_, a, b, w, d, r=0.05, k=0.02):
    """A carved numeral stroke from a to b (Blender xz-plane facing -Y), width w, depth d."""
    a, b = np.array(a, float), np.array(b, float)
    c = (a + b) / 2
    L = np.linalg.norm(b - a)
    ang = math.atan2(b[0] - a[0], b[1] - a[1])            # in the x/z plane
    axes = sdf.rot_y(-math.degrees(ang))
    S_.add(RoundBox((c[0], 0.0, c[1]), (w / 2, d / 2, L / 2), r, axes=axes), k=k)


def numeral(glyph: str, height: float = 5.0, tilt: float = 52.0) -> dict:
    """Roman numeral strokes, ~4.6 m long, sunk 0.9 m and laid back `tilt` degrees so the carved face looks up the
    gameplay camera's line (it reads from the high camera instead of showing only its head bar). Classical carving:
    the stems are thick, a V's or X's second diagonal thin, a crisp bar at foot and head ties them."""
    st = Sculpt("stone")
    h = 4.6
    w, thin, gap, D = 0.9, 0.5, 0.75, 1.2
    x = 0.0
    for ch in glyph:
        if ch == "I":
            stroke(st, (x + w / 2, 0.25), (x + w / 2, h - 0.25), w, D); x += w + gap
        elif ch == "V":
            stroke(st, (x + w / 2, h - 0.25), (x + 1.45, 0.3), w, D); stroke(st, (x + 2.9 - thin / 2, h - 0.25), (x + 1.45, 0.3), thin, D)
            x += 2.9 + gap
        elif ch == "X":
            stroke(st, (x + w / 2, h - 0.25), (x + 2.9 - w / 2, 0.25), w, D); stroke(st, (x + 2.9 - thin / 2, h - 0.25), (x + thin / 2, 0.25), thin, D)
            x += 2.9 + gap
    width = x - gap
    for z in (0.16, h - 0.16):                                                            # foot and head bars
        st.add(RoundBox((width / 2, 0, z), (width / 2 + 0.35, D / 2 + 0.05, 0.16), 0.04), k=0.03)
    glyph_sdf = sdf.Blend([(op, prim, k) for op, prim, k, _ in st.ops]).displaced(S.chip(0.025, 0.9), 0.025)
    # recentre, tilt back, sink into the ground
    out = Sculpt("stone")
    class Moved(sdf.Prim):
        def __init__(self, base, off, R):
            self.base, self.off, self.R = base, np.array(off), R
        def bounds(self):
            lo, hi = self.base.bounds()
            pts = np.array([[x_, y_, z_] for x_ in (lo[0], hi[0]) for y_ in (lo[1], hi[1]) for z_ in (lo[2], hi[2])])
            w_ = (pts + self.off) @ self.R.T
            return w_.min(0), w_.max(0)
        def d(self, P):
            return self.base.d(P @ self.R - self.off)
    t = -math.radians(tilt)                                   # top away from the camera (+Y), the face up toward it
    R = np.array([[1, 0, 0], [0, math.cos(t), -math.sin(t)], [0, math.sin(t), math.cos(t)]])
    out.add(Moved(glyph_sdf, (-width / 2, 0, -0.9), R), k=0.0)
    out.inter(HalfSpace((0, 0, -0.05), (0, 0, -1), 20), k=0.0)
    # half-buried: a mound of earth-stone at the foot
    out.add(Ellipsoid((0, 0.3, -0.25), (width / 2 + 0.8, 1.5, 0.55)).displaced(S.chip(0.06, 0.6), 0.06), k=0.12)
    return {"stone": out}


def belfry() -> dict:
    chalk, iron, glass = Sculpt("chalk"), Sculpt("ironstone"), Sculpt("glass")
    def stage(z0, z1, half, pier, arch_w):
        chalk.add(RoundBox((0, 0, (z0 + z1) / 2), (half, half, (z1 - z0) / 2), 0.08), k=0.0)
        for ax in ((1, 0), (0, 1)):
            for sgn in (-1, 1):
                c = (ax[0] * sgn * half, ax[1] * sgn * half, z0 + (z1 - z0) * 0.45)
                chalk.sub(RoundBox(c, (arch_w if ax[1] else 0.6, 0.6 if ax[1] else arch_w, (z1 - z0) * 0.32), 0.3), k=0.05)
                chalk.sub(Capsule((c[0], c[1], c[2] + (z1 - z0) * 0.3), (c[0] + 0.001, c[1] + 0.001, c[2] + (z1 - z0) * 0.3), arch_w), k=0.05)
        chalk.sub(RoundBox((0, 0, (z0 + z1) / 2), (half - pier, half - pier, (z1 - z0) / 2 - 0.3), 0.2), k=0.05)   # hollow
        iron.add(RoundBox((0, 0, z1), (half + 0.12, half + 0.12, 0.14), 0.05), k=0.0)
    stage(0.0, 6.5, 3.5, 0.9, 1.0)
    stage(6.5, 11.5, 2.7, 0.7, 0.75)
    stage(11.5, 15.0, 2.0, 0.55, 0.5)
    chalk.add(RoundBox((0, 0, 0.3), (4.0, 4.0, 0.3), 0.1), k=0.05)                     # plinth
    glass.add(sdf.Lathe((0, 0, 0), lambda r, z: np.maximum(np.maximum(r - 1.5, 15.2 - z), z - 18.0), 1.6, 15.0, 18.2), k=0.0)
    def spire(P):
        z = P[:, 2] - 18.0
        hw = 1.9 * np.clip(1 - z / 4.0, 0, 1)
        q = np.maximum(np.abs(P[:, 0]), np.abs(P[:, 1])) - hw
        return np.maximum(np.maximum(q, -z), z - 4.0) * 0.8
    class Sp(sdf.Prim):
        def bounds(self): return np.array([-2, -2, 17.9]), np.array([2, 2, 22.1])
        def d(self, P): return spire(P)
    chalk.add(Sp(), k=0.05)
    for sx in (-1, 1):
        for sy in (-1, 1):
            chalk.add(S.TaperBox(15.0, 18.1, 0.22, 0.18, r=0.05, c=(sx * 1.45, sy * 1.45)), k=0.02)          # lantern posts
    return {"chalk": chalk, "ironstone": iron, "glass": glass}


def lamp_dome() -> dict:
    sand, iron, resin = Sculpt("sandstone"), Sculpt("ironstone"), Sculpt("resin")
    sand.add(S.cyl(0.0, 0.5, 9.4), k=0.0)
    sand.add(S.cyl(0.5, 3.6, 8.8), k=0.1)                                                 # the drum
    for i in range(10):                                                                     # arched windows
        a = 2 * math.pi * i / 10
        c = (math.cos(a) * 8.8, math.sin(a) * 8.8, 2.0)
        sand.sub(RoundBox(c, (0.7, 0.7, 1.0), 0.3, axes=sdf.rot_z(math.degrees(a))), k=0.05)
        resin.add(RoundBox((math.cos(a) * 8.45, math.sin(a) * 8.45, 2.0), (0.4, 0.55, 0.8), 0.2, axes=sdf.rot_z(math.degrees(a))), k=0.0)
    def dome(r, z):
        q = np.sqrt((r / 8.3) ** 2 + ((z - 3.6) / 4.2) ** 2)
        return np.maximum((q - 1.0) * 3.5, 3.5 - z)
    iron.add(Lathe((0, 0, 0), dome, 8.4, 3.4, 8.0), k=0.0)
    iron.sub(Ellipsoid((0, 0, 7.75), (1.6, 1.6, 0.5)), k=0.1)                             # oculus
    for zb in (4.6, 5.9, 7.0):                                                             # bands
        rb = 8.3 * math.sqrt(max(0.0, 1 - ((zb - 3.6) / 4.2) ** 2))
        sand.add(Torus((0, 0, zb), rb + 0.02, 0.18, rz=0.22), k=0.0)
    resin.add(Ellipsoid((0, 0, 7.55), (1.5, 1.5, 0.35)), k=0.0)
    return {"sandstone": sand, "ironstone": iron, "resin": resin}


def stall() -> dict:
    wood, chalk, resin = Sculpt("stone"), Sculpt("chalk"), Sculpt("resin")
    chalk.add(RoundBox((0, 0, 0.15), (1.5, 1.4, 0.15), 0.05), k=0.0)
    chalk.add(RoundBox((0, -0.6, 0.6), (1.25, 0.4, 0.5), 0.06), k=0.03)                  # counter
    for sx in (-1, 1):
        for sy in (-1, 1):
            chalk.add(S.TaperBox(0.3, 2.6, 0.1, 0.08, r=0.02, c=(sx * 1.15, sy * 1.05)), k=0.02)
    def roof(P):
        z = P[:, 2] - 2.6
        hw = 1.6 * np.clip(1 - z / 1.4, 0, 1)
        q = np.maximum(np.abs(P[:, 0]), np.abs(P[:, 1])) - hw
        return np.maximum(np.maximum(q, -z), z - 1.4) * 0.8
    class Rf(sdf.Prim):
        def bounds(self): return np.array([-1.7, -1.7, 2.5]), np.array([1.7, 1.7, 4.1])
        def d(self, P): return roof(P)
    chalk.add(Rf(), k=0.04)
    for sx in (-0.6, 0.6):
        resin.add(Ellipsoid((sx, -1.1, 2.15), (0.16, 0.16, 0.22)), k=0.0)
    return {"chalk": chalk, "resin": resin}


def shadow_slab() -> dict:
    b = Sculpt("basalt")
    slab = RoundBox((0, 0, 2.0), (0.9, 0.55, 2.2), 0.12, axes=sdf.rot_x(-14) @ sdf.rot_y(8))
    b.add(slab.displaced(S.chip(0.06, 0.9), 0.06), k=0.0)
    b.inter(HalfSpace((0, 0, -0.05), (0, 0, -1), 10), k=0.0)
    return {"basalt": b}


def shaft_drum() -> dict:
    st, iron = Sculpt("chalk"), Sculpt("ironstone")
    ax = sdf.rot_x(90)
    st.add(Lathe((0, 0, 1.1), lambda r, z: np.maximum(r - 1.1, np.abs(z) - 3.0), 1.15, -3.1, 3.1, axes=ax).displaced(S.chip(0.04, 0.9), 0.04), k=0.0)
    # broken face south (-Y): ragged
    st.sub(Ellipsoid((0, -3.3, 1.1), (1.4, 0.7, 1.4)).displaced(lambda P: 0.25 * sdf.Noise(5).ridged(P, 1.4, 3), 0.25), k=0.1)
    for y in (-1.2, 1.6):
        iron.add(Torus((0, y, 1.1), 1.12, 0.09, axes=ax, rz=0.12), k=0.0)
    st.inter(HalfSpace((0, 0, -0.02), (0, 0, -1), 10), k=0.0)
    return {"chalk": st, "ironstone": iron}


def noon_stone() -> dict:
    st = Sculpt("chalk")
    st.add(S.TaperBox(0.0, 8.2, 1.4, 1.1, r=0.1), k=0.0)
    st.add(RoundBox((0, 0, 8.4), (1.3, 0.85, 0.3), 0.12), k=0.05)
    st.add(Ellipsoid((0, 0, 8.8), (0.9, 0.6, 0.35)), k=0.1)
    # XII carved into the south face
    for i, (a, b) in enumerate([((-0.75, 4.2), (-0.15, 6.4)), ((-0.15, 4.2), (-0.75, 6.4)), ((0.3, 4.2), (0.3, 6.4)), ((0.7, 4.2), (0.7, 6.4))]):
        aa, bb = np.array(a), np.array(b)
        st.sub(Capsule((aa[0], -0.62, aa[1]), (bb[0], -0.62, bb[1]), 0.1), k=0.02)
    return {"chalk": st}


def vi_slab() -> dict:
    st = Sculpt("chalk")
    st.add(RoundBox((0, 0, 0.5), (3.0, 1.0, 0.55), 0.12).displaced(S.chip(0.03, 1.0), 0.03), k=0.0)
    for a, b in [((-1.6, -0.6), (-1.0, 0.6)), ((-0.4, -0.6), (-1.0, 0.6)), ((0.9, -0.6), (0.9, 0.6))]:
        st.sub(Capsule((a[0], a[1], 1.08), (b[0], b[1], 1.08), 0.12), k=0.02)
    st.inter(HalfSpace((0, 0, -0.02), (0, 0, -1), 10), k=0.0)
    return {"chalk": st}


# ── BRIDGE ───────────────────────────────────────────────────────────────────────────────────────
class _EllipseBand(sdf.Prim):
    """The upper half of an elliptical band in the y/z plane (semi-axes a, b about z0), half-thickness t,
    half-width w in x: an arch ring."""

    def __init__(self, a, b, t, w, z0):
        self.a, self.b, self.t, self.w, self.z0 = a, b, t, w, z0

    def bounds(self):
        return np.array([-self.w - 0.1, -self.a - self.t - 0.1, self.z0 - 0.1]), np.array([self.w + 0.1, self.a + self.t + 0.1, self.z0 + self.b + self.t + 0.1])

    def d(self, P):
        y, z = P[:, 1], P[:, 2] - self.z0
        e = np.sqrt((y / self.a) ** 2 + (z / self.b) ** 2)
        ee = np.maximum(e, 1e-6)
        g = np.sqrt((y / (self.a * self.a * ee)) ** 2 + (z / (self.b * self.b * ee)) ** 2)
        ring = np.abs((e - 1) / np.maximum(g, 1e-6)) - self.t
        return np.maximum(np.maximum(ring, np.abs(P[:, 0]) - self.w), -z)


def dawn_arch() -> dict:
    """Aubade's end of the Bridge: chalk piers carrying a low elliptical arch, its underside a band of dawnglass."""
    chalk, glass = Sculpt("chalk"), Sculpt("glass")
    H0, A, B = 6.2, 10.4, 4.4
    for sy in (-1, 1):
        chalk.add(S.TaperBox(0.0, H0, 1.35, 1.15, r=0.08, c=(0, sy * 11.0)).displaced(S.chip(0.03, 0.9), 0.03), k=0.0)
        chalk.add(RoundBox((0, sy * 11.0, 0.35), (1.75, 1.75, 0.35), 0.08), k=0.04)            # plinth
        chalk.add(RoundBox((0, sy * 11.0, H0), (1.5, 1.5, 0.22), 0.06), k=0.03)                # impost cap
    chalk.add(_EllipseBand(A + 0.15, B + 0.15, 0.62, 1.1, H0).displaced(S.chip(0.03, 0.9), 0.03), k=0.05)
    chalk.add(RoundBox((0, 0, H0 + B + 0.5), (1.25, 0.65, 0.85), 0.08), k=0.04)                # keystone
    glass.add(_EllipseBand(A - 0.72, B - 0.72, 0.2, 0.72, H0), k=0.0)                           # the dawnglass intrados
    return {"chalk": chalk, "glass": glass}


def lamp_gate() -> dict:
    """Serenade's end: a low banded ironstone gate between two drum towers, a resin lamp over the opening."""
    iron, chalk, resin = Sculpt("ironstone"), Sculpt("chalk"), Sculpt("resin")
    for sy in (-1, 1):
        cy = sy * 9.4
        iron.add(Lathe((0, cy, 0), lambda r, z: np.maximum(r - 2.3, np.maximum(-z, z - 5.8)), 2.4, -0.1, 5.9).displaced(S.chip(0.03, 0.9), 0.03), k=0.0)
        iron.add(Ellipsoid((0, cy, 5.8), (2.45, 2.45, 1.0)), k=0.1)                               # low dome cap
        for z in (1.5, 3.2, 4.9):
            chalk.add(Torus((0, cy, z), 2.33, 0.13, rz=0.11), k=0.0)                              # chalk courses
        resin.add(RoundBox((0, cy - sy * 0.0, 4.05), (2.35, 0.32, 0.38), 0.12), k=0.0)            # a lit slit round the drum
        iron.sub(RoundBox((0, cy, 4.05), (2.4, 0.3, 0.36), 0.12), k=0.02)
    iron.add(RoundBox((0, 0, 1.9), (1.45, 7.4, 1.9), 0.1).displaced(S.chip(0.03, 0.9), 0.03), k=0.08)
    iron.sub(Ellipsoid((0, 0, 0.6), (2.0, 2.2, 2.5)), k=0.05)                                     # the gate opening
    chalk.add(RoundBox((0, 0, 3.85), (1.55, 7.5, 0.16), 0.05), k=0.0)                             # coping
    chalk.add(_EllipseBand(2.25, 2.0, 0.18, 1.5, 1.0), k=0.0)                                     # chalk arch round the opening
    chalk.add(RoundBox((0, 0, 4.45), (0.62, 0.62, 0.55), 0.08), k=0.02)                           # lamp housing
    resin.add(Ellipsoid((0, 0, 4.5), (0.68, 0.46, 0.38)), k=0.0)
    return {"ironstone": iron, "chalk": chalk, "resin": resin}


def snap_stub() -> dict:
    """A short drum of the snapped shaft, lying along y; the break faces -Y (turn it 180 for its twin)."""
    st, iron = Sculpt("chalk"), Sculpt("ironstone")
    ax = sdf.rot_x(90)
    st.add(Lathe((0, 0, 1.2), lambda r, z: np.maximum(r - 1.2, np.abs(z) - 2.0), 1.25, -2.1, 2.1, axes=ax).displaced(S.chip(0.04, 0.9), 0.04), k=0.0)
    st.sub(Ellipsoid((0, -2.3, 1.2), (1.55, 0.85, 1.55)).displaced(lambda P: 0.28 * sdf.Noise(9).ridged(P, 1.5, 3), 0.28), k=0.1)
    iron.add(Torus((0, 1.0, 1.2), 1.22, 0.09, axes=ax, rz=0.12), k=0.0)
    st.inter(HalfSpace((0, 0, -0.02), (0, 0, -1), 10), k=0.0)
    return {"chalk": st, "ironstone": iron}


# ── FRAY ─────────────────────────────────────────────────────────────────────────────────────────
def lampwright_cart() -> dict:
    """The Fray's shared shop: a two-wheeled lampwright's cart under a cloth hood, a lamp on a thin mast."""
    wood, cloth, resin, iron = Sculpt("wood"), Sculpt("cloth"), Sculpt("resin"), Sculpt("ironstone")
    wood.add(RoundBox((0, 0, 0.95), (0.62, 1.0, 0.42), 0.05), k=0.0)                             # the box body
    for sx in (-1, 1):
        iron.add(Torus((sx * 0.78, 0.0, 0.55), 0.5, 0.07, axes=sdf.rot_y(90), rz=0.07), k=0.0)    # iron-shod wheels
        wood.add(Sphere((sx * 0.78, 0.0, 0.55), 0.12), k=0.0)
        for i in range(6):
            a = math.pi * i / 6
            wood.add(RoundBox((sx * 0.78, 0.0, 0.55), (0.03, 0.46 * abs(math.cos(a)) + 0.03, 0.46 * abs(math.sin(a)) + 0.03), 0.02,
                              axes=sdf.rot_x(math.degrees(a))), k=0.0)
        wood.add(RoundBox((sx * 0.42, -1.45, 0.62), (0.04, 0.6, 0.04), 0.02, axes=sdf.rot_x(-14)), k=0.02)   # shafts
        for sy in (-1, 1):
            wood.add(RoundBox((sx * 0.56, sy * 0.92, 1.55), (0.035, 0.035, 0.32), 0.015), k=0.01)          # hood posts
    hood = Ellipsoid((0, 0, 1.78), (0.82, 1.18, 0.5))
    cloth.add(hood, k=0.0)
    cloth.sub(Ellipsoid((0, 0, 1.78), (0.74, 1.3, 0.42)), k=0.0)
    cloth.inter(HalfSpace((0, 0, 1.8), (0, 0, -1), 10), k=0.02)
    wood.add(S.TaperBox(1.3, 3.0, 0.05, 0.035, r=0.015, c=(0.0, 0.92)), k=0.02)                  # lamp mast
    wood.add(RoundBox((0, 0.72, 2.95), (0.03, 0.22, 0.03), 0.01), k=0.01)                        # hook arm
    resin.add(Ellipsoid((0, 0.55, 2.72), (0.16, 0.16, 0.2)), k=0.0)                              # the lamp
    for x, y in ((-0.3, -0.5), (0.25, -0.35), (-0.15, 0.25), (0.3, 0.45)):
        resin.add(Ellipsoid((x, y, 1.45), (0.09, 0.09, 0.1)), k=0.0)                             # lamps for sale
    return {"wood": wood, "cloth": cloth, "ironstone": iron, "resin": resin}


def hour_stone() -> dict:
    """A low carved hour-block: chamfered chalk, a tick cut across the top (turned to face the dial's centre)."""
    st = Sculpt("chalk")
    st.add(RoundBox((0, 0, 0.55), (0.82, 0.82, 0.62), 0.12).displaced(S.chip(0.025, 1.0), 0.025), k=0.0)
    st.add(RoundBox((0, 0, 1.2), (0.62, 0.62, 0.08), 0.05), k=0.06)
    st.sub(RoundBox((0, -0.2, 1.3), (0.09, 0.62, 0.12), 0.03), k=0.02)                           # the tick
    st.inter(HalfSpace((0, 0, -0.02), (0, 0, -1), 10), k=0.0)
    return {"chalk": st}


def fair_stand(tiers: int, step: float) -> dict:
    """A stepped stone terrace of the noon fair: `tiers` steps of `step` metres, receding."""
    st, wood = Sculpt("chalk"), Sculpt("wood")
    for i in range(tiers):
        hw = 2.95 - i * 0.75
        st.add(RoundBox((0, 0, step * (i + 0.5)), (hw, hw, step / 2), 0.06), k=0.0)                # flat faces: no chip noise (decimation crumples it)
    top = step * tiers
    for sx in (-1, 1):
        wood.add(RoundBox((sx * 0.5, 0, top + 0.22), (0.07, 0.45, 0.22), 0.02), k=0.0)            # a bench on top
    wood.add(RoundBox((0, 0, top + 0.47), (0.62, 0.5, 0.05), 0.02), k=0.02)
    return {"chalk": st, "wood": wood}


DESIGNS = {
    "glass_belfry": (belfry, 16000, 0.06), "lamp_dome": (lamp_dome, 14000, 0.07), "lampwright_stall": (stall, 3000, 0.04),
    "shadow_slab": (shadow_slab, 1500, 0.05), "shaft_drum": (shaft_drum, 3500, 0.05), "noon_stone": (noon_stone, 3000, 0.05),
    "vi_slab": (vi_slab, 1500, 0.04),
    "dawn_arch": (dawn_arch, 9000, 0.06), "lamp_gate": (lamp_gate, 12000, 0.06), "snap_stub": (snap_stub, 2500, 0.045),
    "lampwright_cart": (lampwright_cart, 4000, 0.025), "hour_stone": (hour_stone, 700, 0.03),
    "fair_stand_high": (lambda: fair_stand(3, 1.0), 2000, 0.05), "fair_stand_low": (lambda: fair_stand(2, 0.5), 1500, 0.05),
    "numeral_xi": (lambda: numeral("XI"), 5000, 0.045), "numeral_ii": (lambda: numeral("II"), 3500, 0.045),
    "numeral_vii": (lambda: numeral("VII"), 6000, 0.045), "numeral_iiii": (lambda: numeral("IIII"), 6000, 0.045),
}


def preview(groups):
    """One contact sheet of everything just built, laid out left to right by real width."""
    from mathutils import Vector
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"; scene.cycles_device(sc); sc.cycles.samples = 48
    sc.render.resolution_x, sc.render.resolution_y = 2400, 900
    sc.view_settings.view_transform = "Standard"
    w = sc.world or bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.42, 0.44, 0.47, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sun.data.energy = 2.4
    sc.collection.objects.link(sun); sun.rotation_euler = (math.radians(38), 0, math.radians(-40))
    x, top = 0.0, 0.0
    for objs in groups:
        # long-in-y pieces (arches, gates) turn side-on for the sheet
        ys = [(o.matrix_world @ Vector(c)).y for o in objs for c in o.bound_box]
        xs = [(o.matrix_world @ Vector(c)).x for o in objs for c in o.bound_box]
        if max(ys) - min(ys) > 2 * (max(xs) - min(xs)):
            for o in objs:
                o.rotation_euler.z += math.pi / 2
            bpy.context.view_layer.update()
        lo = min(min((o.matrix_world @ Vector(c)).x for c in o.bound_box) for o in objs)
        hi = max(max((o.matrix_world @ Vector(c)).x for c in o.bound_box) for o in objs)
        top = max(top, max(max((o.matrix_world @ Vector(c)).z for c in o.bound_box) for o in objs))
        for o in objs:
            o.location.x += x - lo
        x += (hi - lo) + 2.0
    width = x - 2.0
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = max(width * 1.04, top * 2.6 * 1.04)
    cam.location = (width / 2, -60.0, 34.0)
    cam.rotation_euler = (Vector((width / 2, 0, top * 0.42)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam
    os.makedirs(RENDERS, exist_ok=True)
    sc.render.filepath = os.path.join(RENDERS, "landmarks.png")
    bpy.ops.render.render(write_still=True)


def main():
    import argparse
    p = argparse.ArgumentParser(); p.add_argument("--only", default=""); p.add_argument("--preview", action="store_true")
    a = p.parse_args(scene.script_args())
    os.makedirs(OUT, exist_ok=True)
    groups = []
    scene.reset()
    for nme, (fn, tris, vox) in DESIGNS.items():
        if a.only and nme not in a.only.split(","):
            continue
        col = scene.collection(nme)
        objs = build(nme, fn(), col, tris, vox)
        path = os.path.join(OUT, f"{nme}.glb")
        S.export(objs, path)
        scene.log(f"{nme}: {sum(sum(len(p_.vertices) - 2 for p_ in o.data.polygons) for o in objs)} tris, {os.path.getsize(path) // 1024} KB")
        groups.append(objs)
    if a.preview:
        preview(groups)

if __name__ == "__main__":
    main()
