"""VALE map skirts (env F1): the dressed ground beyond every map bound, so an edge pan or a spawn view never
shows a bare plane. Built like the Art 2.0 landmarks (art/blender/maps/landmarks_art2.py: structure_kit's
painted stone, one baked atlas with AO, chalked convex edges and inked joints), placed through each map's
`art.terrain.landmarks` (content/maps, mirrored in _design/tools/map_gen.py) by render/terrain.ts.

    Blender -b --factory-startup --python art/blender/maps/skirts.py -- [--only skirt_rift,...] [--fast] [--preview]

The renderer stands an off-map landmark on the carved rim (the 14 m cap at the rim's height, 3.4 m) on every
side of RIFT and at BRIDGE's two terrace ends, and on the plain (height 0) north and south of BRIDGE's gorge,
so each module's origin is at that ground; anything past the rim's outer edge reaches down to the plain
(local z -3.4). A module is drawn for the NORTH bound, outward = +Y (Blender), along the bound = X; the
map's entry turns it (rot 90 = the west bound, -90 = east, 180 = south).

  skirt_rift      RIFT north / west / east, 22 m along the bound: the Dialwood's terraced banks stepping down
                  to the dial's rim. A flagged rim walk (0.6-4 m out), then three terraces (+0.95 / +1.9 /
                  +2.85 m) behind coursed retaining walls with chalk-lit copings, moss on their tops, Dialwood
                  crowns in a row on each (the props' own trees, art/out/props/dialwood_*.glb), closed ends.
  skirt_rift_low  RIFT south (the camera's side: everything low, brief §2): the rim walk, a carved kerb, a
                  moss bed of young Dialwood, one low terrace (+0.65) of crowns <= 3.2 m; <= 3.9 m in all.
  skirt_bridge    BRIDGE's far banks (north and south of the gorge, on the plain), 24 m along: raw rock ledges
                  stepping up from the gorge's lip (+0.15 / +0.8 / +1.6 / +2.4), chalk-lit lips, fallen drums of
                  the needle's shaft (the Snap stubs' stone and hour-band) and its spalled chips on them.
  skirt_court     BRIDGE's terrace ends on the rim (22 m along, 13 m deep): dial-stone flags round the Dawn
                  Arch and the Lamp Gate, a chalk kerb at the rim's outer edge.

Values: the stone is painted for the map's `propValue.landmark` x the entry's `value` (RIFT trees at the
scatter's 0.53: the skirt's entries carry value 1.15 = 0.53 / 0.46). Output: art/out/maps/landmarks/<id>.glb,
report art/renders/maps/build_report_skirts.json, looks art/renders/maps/<id>.png (fast builds overwrite them).
"""
from __future__ import annotations

import math
import os
import random
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "units"))
from common import scene  # noqa: E402
import structure_kit as K  # noqa: E402
import landmarks_art2 as LA  # noqa: E402

PI, TAU = math.pi, math.tau
OUT = LA.OUT
RENDERS = LA.RENDERS
SCRATCH = os.path.join(scene.CACHE_DIR, "skirts")
PROPS = os.path.join(scene.OUT_DIR, "props")
RIM = 3.4                       # the carved rim's height: an off-map module's origin stands on its cap
CAP = 14.0                      # the cap's depth past the bound; beyond it the plain (local z -RIM)

EDGE = (0.06, 0.7, 0.65, 0.12)
MATS_RIFT = {
    "dialstone": dict(LA.DIAL, hex="#817B72"),
    "wallstone": dict(hex="#6F6A61", chisel=0.9, var=0.1, streaks=0.4, chips=0.5, speckle=0.2, scale=0.6, rough=0.8, edge_light=EDGE),
    "coping": dict(hex="#928C80", chisel=0.6, var=0.07, streaks=0.3, chips=0.55, scale=0.5, rough=0.72, edge_light=(0.06, 0.6, 0.5, 0.1)),
    "moss": dict(hex="#4A5434", chisel=0.7, var=0.18, streaks=0.0, chips=0.0, speckle=0.8, veins=0.25, scale=0.9, rough=0.95),
}
MATS_BRIDGE = {
    "rock": dict(hex="#7D7A84", chisel=1.0, var=0.12, streaks=0.45, chips=0.5, speckle=0.3, veins=0.2, scale=0.45, rough=0.85,
                 edge_light=(0.07, 0.8, 0.6, 0.14)),
    "lip": dict(hex="#B9B4A8", chisel=0.8, var=0.08, streaks=0.2, chips=0.6, scale=0.5, rough=0.78, edge_light=(0.06, 0.95, 0.5, 0.1)),
    "needle": LA.NEEDLE, "raw": LA.RAW, "band": LA.BAND,
}
MATS_COURT = {"dialstone": dict(LA.DIAL, hex="#948E84"), "coping": MATS_RIFT["coping"]}


# ── pieces ───────────────────────────────────────────────────────────────────────────────────────────
def coursed_wall(B, rng, mat, x0, x1, y, d, z0, z1, h=0.44, gap=0.014, axis="x"):
    """A retaining wall face of coursed blocks along `axis` (x: from x0 to x1 at front y, depth d behind it
    toward +Y; y: x0..x1 are y values, `y` is the x of its face, depth toward -X or +X by sign of d)."""
    n = max(1, int(round((z1 - z0) / h)))
    zs = [z0 + (z1 - z0) * i / n for i in range(n + 1)]
    for k in range(n):
        za, zb = zs[k], zs[k + 1]
        u, first = x0, True
        while u < x1 - 0.05:
            L = rng.uniform(0.75, 1.35) * (0.5 if first and k % 2 else 1.0)
            first = False
            u1 = min(x1, u + L)
            if x1 - u1 < 0.35:
                u1 = x1
            pr = rng.uniform(-0.02, 0.025)                      # each block a little proud or sunk: a hand-set face
            if axis == "x":
                c, half = ((u + u1) / 2, y + d / 2 - pr, (za + zb) / 2), ((u1 - u) / 2 - gap / 2, abs(d) / 2, (zb - za) / 2 - gap / 2)
            else:
                c, half = (y + d / 2 - pr * np.sign(d), (u + u1) / 2, (za + zb) / 2), (abs(d) / 2, (u1 - u) / 2 - gap / 2, (zb - za) / 2 - gap / 2)
            B.add(mat, K.box(c, half, 0.035))
            u = u1


def coping(B, rng, x0, x1, y, z, proud=0.1, depth=0.55, mat="coping"):
    """A row of chalk-lit coping stones along x on a wall whose face is at y (proud toward -Y)."""
    u = x0
    while u < x1 - 0.05:
        u1 = min(x1, u + rng.uniform(1.1, 1.7))
        if x1 - u1 < 0.4:
            u1 = x1
        B.add(mat, K.box(((u + u1) / 2, y - proud + depth / 2, z + 0.07), ((u1 - u) / 2 - 0.01, depth / 2, 0.075), 0.035))
        u = u1


def terrace_block(B, mat, x0, x1, y0, y1, z0, z1):
    B.add(mat, K.box(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), ((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2), 0.0))


# ── RIFT: the Dialwood's terraced banks ────────────────────────────────────────────────────────────────
HALF = 11.0


def rift_bank(B, rng, trees, steps, walk=(0.6, 4.0), depth_out=16.6, kerb=None, ends=True, spacing=(2.7, 3.7), cushions=7, rows=1):
    """steps: [(front distance out, top z, tree scale range)] bottom to top. The bound is at local y = -Y0
    (Y0 = the footprint centre's distance out, set by the caller through B.y0)."""
    y0 = -B.y0
    LA.flags(B, "dialstone", rng, -HALF, HALF, y0 + walk[0], y0 + walk[1] - 0.05, z=0.08, size=(1.0, 1.6), th=0.2)   # sunk into the cap (3.33)
    if kerb:
        kz = kerb
        coursed_wall(B, rng, "wallstone", -HALF, HALF, y0 + walk[1], 0.4, 0.0, kz, h=kz)
        coping(B, rng, -HALF, HALF, y0 + walk[1], kz, proud=0.06, depth=0.5)
    prev_top = 0.0
    for i, (dist, top, sc) in enumerate(steps):
        yf = y0 + dist
        nxt = steps[i + 1][0] if i + 1 < len(steps) else depth_out
        yb = y0 + nxt
        # the fill (moss on top), down to the plain where it lies past the rim's outer edge
        zb = -RIM if nxt > CAP - 0.5 else 0.0
        terrace_block(B, "moss", -HALF, HALF, yf + 0.3, yb + 0.02, zb - 0.1, top - 0.02)
        # the retaining wall at its front: coursed, the coping chalk-lit
        coursed_wall(B, rng, "wallstone", -HALF, HALF, yf, 0.62, prev_top - 0.14 if dist < CAP else -RIM, top - 0.15)
        coping(B, rng, -HALF, HALF, yf, top - 0.15)
        if ends:
            for sx in (-1, 1):
                coursed_wall(B, rng, "wallstone", yf + 0.55, yb, sx * HALF, -sx * 0.5, max(zb, prev_top - 0.4), top - 0.12, h=0.6, axis="y")
        # its row of Dialwood (the props' own crowns), staggered, kept 0.5 m behind the coping
        lo, hi = sc
        for row in range(rows):                              # rows > 1: staggered rows across a deep bed
            x = -HALF + rng.uniform(0.8, 2.0) + row * spacing[0] / 2
            while x < HALF - 0.9:
                f = (row + rng.uniform(0.2, 0.8)) / rows
                yy = yf + 0.9 + (yb - yf - 1.6) * f
                trees.append((x, yy, top, rng.uniform(lo, hi), rng.uniform(0, TAU), rng.randrange(5)))
                x += rng.uniform(*spacing)
        for _ in range(cushions):                                   # moss cushions and fallen hour-tick stones
            c = (rng.uniform(-HALF + 0.6, HALF - 0.6), yf + 0.8 + (yb - yf - 1.2) * rng.random(), top)
            if rng.random() < 0.6:
                v, f = K.lathe([(0, top - 0.05), (rng.uniform(0.35, 0.7), top - 0.05), (0.3, top + rng.uniform(0.12, 0.22)), (0, top + 0.25)], 7, phase=rng.random())
                B.add("moss", (K.move(v, (c[0], c[1], 0)), f))
            else:
                LA.chunk(B, "wallstone", c, (rng.uniform(0.15, 0.3), rng.uniform(0.1, 0.2), rng.uniform(0.08, 0.14)), rng)
        prev_top = top
    # the outer face: past the last terrace the bank falls to the plain
    coursed_wall(B, rng, "wallstone", -HALF, HALF, y0 + depth_out, 0.5, -RIM, prev_top - 0.02, h=1.15)


def skirt_rift(B, rng, trees):
    B.y0 = 10.0                    # footprint: 4-16 m out (centre 10 m)
    rift_bank(B, rng, trees, [(4.0, 0.95, (0.95, 1.2)), (8.5, 1.9, (1.15, 1.45)), (12.5, 2.85, (1.35, 1.75))], depth_out=16.6)


def skirt_rift_low(B, rng, trees):
    B.y0 = 8.5                     # footprint: 3-14 m out (centre 8.5 m)
    rift_bank(B, rng, trees, [(3.0, 0.4, (0.72, 0.92)), (8.0, 0.9, (0.82, 0.98))], walk=(0.6, 3.0), depth_out=14.0, spacing=(2.6, 3.4),
              cushions=16, rows=2)


# ── BRIDGE: the far banks ───────────────────────────────────────────────────────────────────────────
BHALF = 12.0


def rock_ledge(B, rng, x0, x1, yf, yb, z0, top, jag=0.35):
    """A raw rock ledge (strata) from front yf back to yb: its face broken into slabs of uneven depth and
    height (each its own stone), a chalk-lit lip of flat stones on its edge."""
    u = x0
    while u < x1 - 0.1:
        L = rng.uniform(1.1, 3.2)
        u1 = min(x1, u + L)
        if x1 - u1 < 0.6:
            u1 = x1
        dz = rng.uniform(-0.22, 0.14)
        dy = rng.uniform(-jag, jag * 0.6)
        v, f = K.box((0, 0, 0), ((u1 - u) / 2 - 0.02, (yb - yf - dy) / 2, (top + dz - z0) / 2), 0.07)
        v = K.rot(v, (1, 0, 0), rng.uniform(-0.05, 0.03))                # bedding planes tip a little
        v = K.rotz(v, rng.uniform(-0.07, 0.07))
        B.add("rock", (K.move(v, ((u + u1) / 2, (yf + dy + yb) / 2, (z0 + top + dz) / 2)), f))
        # the lip: two or three flat stones along the edge, a little proud
        v = u + rng.uniform(0.0, 0.4)
        while v < u1 - 0.3:
            v1 = min(u1, v + rng.uniform(0.45, 1.5))
            if rng.random() < 0.72:                              # a broken lip: stones missing, each set askew
                lv, lf = K.box((0, 0, 0), ((v1 - v) / 2 - 0.03, rng.uniform(0.22, 0.4), rng.uniform(0.04, 0.08)), 0.03)
                lv = K.rotz(lv, rng.uniform(-0.12, 0.12))
                B.add("lip", (K.move(lv, ((v + v1) / 2, yf + dy + 0.3 + rng.uniform(-0.06, 0.08), top + dz + 0.03)), lf))
            v = v1 + rng.uniform(0.0, 0.25)
        u = u1


def fallen_drum(B, rng, x, y, z, ang, r=0.75, L=2.4, broken=True):
    """A drum of the needle's shaft lying on the bank: octagonal needle stone, one hour-band, a raw break."""
    sub = K.Build("tmp", 1.0)
    LA.drum(sub, "needle", r, 0.1, L * 0.55, r * math.cos(PI / 8))
    LA.hour_band(sub, r, -0.22, 0.1, r * math.cos(PI / 8), ticks=8)
    if broken:
        LA.broken_drum(sub, r, -0.22, -L * 0.45, r * math.cos(PI / 8), rng, jag=0.3)
    for (node, mat), lst in sub.parts.items():
        for v, f, var, pid in lst:
            v2 = K.move(K.rotz(v, ang), (x, y, z - 0.08))
            B.add(mat, (v2, f), var=var)


def skirt_bridge(B, rng, trees):
    """Footprint: 1-25 m out from the gorge's lip (the plain, height 0); origin at 13 m out."""
    y0 = -13.0
    steps = [(1.0, 0.15), (5.0, 0.8), (10.0, 1.6), (16.0, 2.4)]
    for i, (dist, top) in enumerate(steps):
        yb = steps[i + 1][0] if i + 1 < len(steps) else 25.0
        rock_ledge(B, rng, -BHALF, BHALF, y0 + dist, y0 + yb + 0.4, -0.3, top, jag=0.6)
    # fallen drums of the needle's shaft and spalled chips on the ledges
    for (x, d, top, ang) in ((-6.5, 3.0, 0.15, 0.35), (5.2, 7.6, 0.8, -0.9), (-2.0, 12.6, 1.6, 1.4), (8.5, 19.0, 2.4, 0.2)):
        fallen_drum(B, rng, x + rng.uniform(-1, 1), y0 + d, top, ang + rng.uniform(-0.2, 0.2), r=rng.uniform(0.6, 0.8))
    for _ in range(14):
        d = rng.uniform(1.5, 24.0)
        top = [t for dd, t in steps if dd <= d][-1]
        c = (rng.uniform(-BHALF + 0.5, BHALF - 0.5), y0 + d, top + 0.08)
        LA.chunk(B, rng.choice(("needle", "raw", "rock")), c, (rng.uniform(0.12, 0.3), rng.uniform(0.1, 0.25), rng.uniform(0.07, 0.16)), rng)


def skirt_court(B, rng, trees):
    """BRIDGE's terrace ends on the rim: flags from 0.6 to 13.4 m out, ±11 m, a chalk kerb at the cap's outer
    edge. Origin 7 m out."""
    y0 = -7.0
    LA.flags(B, "dialstone", rng, -HALF, HALF, y0 + 0.6, y0 + 13.2, z=0.08, size=(1.1, 1.8), th=0.2)
    coursed_wall(B, rng, "dialstone", -HALF, HALF, y0 + 13.2, 0.5, -0.12, 0.32, h=0.44)
    coping(B, rng, -HALF, HALF, y0 + 13.2, 0.32, proud=0.06, depth=0.55)


# ── FRAY: the noon fair's court beyond the rim (brief §2: low, part of the glare) ───────────────────────
MATS_FRAY = {
    "setts": dict(hex="#9A9386", chisel=0.9, var=0.1, streaks=0.2, chips=0.5, speckle=0.3, scale=0.5, rough=0.85, edge_light=(0.05, 0.6, 0.5, 0.1)),
    "timber": dict(hex="#7A6450", chisel=0.4, var=0.12, streaks=0.3, chips=0.4, veins=0.5, scale=1.3, rough=0.8, edge_light=(0.03, 0.5, 0.5, 0.06)),
    "canvas": dict(hex="#B49D78", chisel=0.2, var=0.08, streaks=0.35, chips=0.0, scale=1.6, rough=0.9, edge_light=(0.03, 0.5, 0.4, 0.06)),
    "iron": dict(LA.GATE_MATS["iron"]),
}


def crate(B, rng, x, y, z, s=0.32):
    v, f = K.box((0, 0, s), (s * rng.uniform(0.9, 1.2), s, s), 0.025)
    B.add("timber", (K.move(K.rotz(v, rng.uniform(-0.4, 0.4)), (x, y, z)), f))
    v, f = K.box((0, 0, 2 * s + 0.012), (s * 0.95, s * 0.95, 0.02), 0.006)
    B.add("timber", (K.move(K.rotz(v, rng.uniform(-0.4, 0.4)), (x, y, z)), f))


def dais(B, rng, hx, hy, steps=((0.0, 0.16), (0.16, 0.3))):
    for i, (z0, z1) in enumerate(steps):
        ix, iy = hx - 0.35 * i, hy - 0.35 * i
        n = max(2, int(round(2 * ix / 1.3)))
        for k in range(n):
            x0, x1 = -ix + 2 * ix * k / n, -ix + 2 * ix * (k + 1) / n
            B.add("setts", K.box(((x0 + x1) / 2, 0, (z0 + z1) / 2 - 0.04), ((x1 - x0) / 2 - 0.012, iy, (z1 - z0) / 2 + 0.04), 0.03))
    return steps[-1][1]


def skirt_fray(B, rng, trees):
    """A fair booth on the court, north of the plate: a stepped setts dais, a timber counter under a folded canvas
    awning on four posts (<= 2.45 m, about the rim's height), crates, an iron lamp post (unlit at noon)."""
    z = dais(B, rng, 3.2, 1.9)
    B.add("timber", K.box((0, -0.6, z + 0.45), (2.2, 0.32, 0.45), 0.03))                    # the counter (faces the plate)
    B.add("timber", K.box((0, -0.62, z + 0.93), (2.35, 0.42, 0.04), 0.012))
    for sx in (-1, 1):
        for sy in (-1, 1):
            B.add("timber", K.box((sx * 2.3, sy * 0.95, z + 0.95), (0.06, 0.06, 0.95), 0.012))
    # the awning: two folded canvas plates over a ridge, a scalloped valance along the front
    zr, ze = 2.38, 1.95
    for sy in (-1, 1):
        poly = [(0.0, zr), (sy * 1.25, ze), (sy * 1.25, ze - 0.05), (0.0, zr - 0.05)]
        if sy < 0:
            poly = poly[::-1]
        B.add("canvas", K.prism(poly, origin=(0, 0, 0), u=(0, 1, 0), v=(0, 0, 1), depth=5.0, chamfer=0.0))
    for k in range(9):
        x = -2.4 + 4.8 * (k + 0.5) / 9
        v, f = K.prism([(-0.27, 0.0), (0.27, 0.0), (0.0, -0.2)], origin=(x, -1.27, ze), u=(1, 0, 0), v=(0, 0, 1), depth=0.03)
        B.add("canvas", (v, f))
    B.add("timber", K.box((0, 0, zr + 0.02), (2.55, 0.05, 0.05), 0.01))
    for (x, y) in ((-2.9, 1.2), (-2.5, 1.5), (2.7, 1.3)):
        crate(B, rng, x, y, z, s=rng.uniform(0.24, 0.34))
    v, f = K.lathe([(0, 0), (0.14, 0), (0.14, 0.12), (0.05, 0.2), (0.04, 2.0), (0, 2.0)], 8)
    B.add("iron", (K.move(v, (-3.0, -1.6, 0)), f))
    v, f = K.lathe([(0, 2.0), (0.16, 2.0), (0.2, 2.18), (0.12, 2.3), (0, 2.34)], 8, phase=PI / 8)
    B.add("iron", (K.move(v, (-3.0, -1.6, 0)), f))


def skirt_fray_low(B, rng, trees):
    """South of the plate (the camera's side): kept under 1 m — a setts dais, two stone benches, stacked crates."""
    z = dais(B, rng, 3.0, 1.6, steps=((0.0, 0.18),))
    for x in (-1.5, 1.5):
        B.add("setts", K.box((x, 0.2, z + 0.36), (1.0, 0.28, 0.06), 0.02))
        for sx in (-0.75, 0.75):
            B.add("setts", K.box((x + sx, 0.2, z + 0.15), (0.12, 0.22, 0.15), 0.015))
    for (x, y) in ((-2.6, -1.0), (-2.2, -0.7), (2.5, -0.9)):
        crate(B, rng, x, y, z, s=rng.uniform(0.22, 0.3))


DESIGNS = {
    # id: (builder, materials, atlas, AO distance)
    "skirt_rift": (skirt_rift, MATS_RIFT, 2048, 0.8),
    "skirt_rift_low": (skirt_rift_low, MATS_RIFT, 2048, 0.8),
    "skirt_bridge": (skirt_bridge, MATS_BRIDGE, 2048, 0.8),
    "skirt_court": (skirt_court, MATS_COURT, 1024, 0.5),
    "skirt_fray": (skirt_fray, MATS_FRAY, 1024, 0.5),
    "skirt_fray_low": (skirt_fray_low, MATS_FRAY, 1024, 0.5),
}


# ── trees: the props' Dialwood, placed and merged into one vertex-coloured node ─────────────────────────
VARIANTS = ["dialwood_tall", "dialwood_broad", "dialwood_squat", "dialwood_young", "dialwood_lean"]


def tree_node(col, trees, name):
    """One mesh of every placed crown (x, y, z, scale, turn, variant), COLOR_0 kept (the props' paint)."""
    if not trees:
        return None
    src = []
    for v in VARIANTS:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(PROPS, f"{v}.glb"))
        new = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
        ob = new[0]
        for o in bpy.data.objects:
            if o not in before and o is not ob:
                bpy.data.objects.remove(o)
        ob.parent = None
        ob.matrix_world = ob.matrix_world.copy()
        _opaque_colors(ob.data)
        src.append(ob)
    m0 = src[0].data.materials[0] if src[0].data.materials else None
    for o in src[1:]:                                   # one material for every crown: one draw per placement
        o.data.materials.clear()
        if m0:
            o.data.materials.append(m0)
    copies = []
    for (x, y, z, s, a, k) in trees:
        o = src[k].copy()
        col.objects.link(o)
        o.location = (x, y, z - 0.05)
        o.rotation_euler = (0.0, 0.0, a)
        o.scale = (s, s, s)
        copies.append(o)
    scene.select_only(copies, copies[0])
    bpy.ops.object.make_single_user(object=True, obdata=True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = f"{name}_trees"
    ob.data.name = f"{name}_trees"
    for o in src:
        for c in list(o.users_collection):
            c.objects.unlink(o)
    return ob


def _opaque_colors(me):
    """COLOR_0's alpha is the props' gloss mask (0 everywhere); a landmark's material would read it as
    coverage, so the merged crowns carry alpha 1."""
    for at in me.color_attributes:
        n = len(at.data)
        a = np.empty(n * 4, dtype=np.float32)
        at.data.foreach_get("color", a)
        a[3::4] = 1.0
        at.data.foreach_set("color", a)


def export_glb(root, path):
    objs = [root] + list(root.children_recursive)
    scene.select_only(objs, active=root)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(**scene.op_kwargs(
        bpy.ops.export_scene.gltf, filepath=path, export_format="GLB", use_selection=True, export_apply=True,
        export_yup=True, export_normals=True, export_texcoords=True, export_tangents=False,
        export_vertex_color="MATERIAL", export_materials="EXPORT", export_image_format="AUTO", export_jpeg_quality=90,
        export_animations=False, export_skins=False, export_lights=False, export_cameras=False, export_extras=False))


def build_one(name: str, fast: bool = False, preview: bool = False) -> dict:
    from common import export as X
    scene.reset()
    col = scene.collection(name)
    fn, spec, size, ao_d = DESIGNS[name]
    B = K.Build(name, 3.0)
    rng = random.Random(scene.seed_of(name) + 5)
    trees: list = []
    fn(B, rng, trees)
    zmax = max(float(v[:, 2].max()) for lst in B.parts.values() for v, _, _, _ in lst)
    K.paint_set(spec, zmax)
    objs = B.objects(col)
    body = objs["body"]
    K.drop_hidden_bottoms(body, z=-RIM + 0.02)
    buried = K.drop_buried_faces(body, [], keep_mats=())
    tr = tree_node(col, trees, name)
    os.makedirs(SCRATCH, exist_ok=True)
    K.bake_body(body, [tr] if tr else [], SCRATCH, name, size=512 if fast else size, samples=6 if fast else 24,
                ao_samples=16 if fast else 96, ao_distance=ao_d)
    root = bpy.data.objects.new(name, None)
    col.objects.link(root)
    parts = [body] + ([tr] if tr else [])
    for o in parts:
        o.parent = root
    tris = sum(len(p.vertices) - 2 for o in parts for p in o.data.polygons)
    lo = np.min([np.array(o.bound_box).min(0) for o in parts], 0)
    hi = np.max([np.array(o.bound_box).max(0) for o in parts], 0)
    if preview:
        look(name, parts, lo, hi)
    path = os.path.join(OUT, f"{name}.glb")
    export_glb(root, path)
    raw = os.path.getsize(path)
    X.optimize(path, fighter=True)
    rep = {"id": name, "tris": tris, "trees": len(trees), "size_m": [round(float(hi[0] - lo[0]), 2), round(float(hi[1] - lo[1]), 2)],
           "z": [round(float(lo[2]), 2), round(float(hi[2]), 2)], "x": [round(float(lo[0]), 2), round(float(hi[0]), 2)],
           "y": [round(float(lo[1]), 2), round(float(hi[1]), 2)], "kb_raw": raw // 1024, "kb": os.path.getsize(path) // 1024,
           "texture": 512 if fast else size, "buried_faces_dropped": buried}
    scene.log(f"{name}: {rep}")
    return rep


def look(name, objs, lo, hi):
    """A look render at the gameplay camera's pitch (52 deg, looking north at the module's front)."""
    from mathutils import Vector
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    scene.cycles_device(sc)
    sc.cycles.samples = 32
    sc.render.resolution_x, sc.render.resolution_y = 1600, 1000
    sc.view_settings.view_transform = "Standard"
    w = sc.world or bpy.data.worlds.new("w")
    sc.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.42, 0.44, 0.47, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.7
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 2.6
    sc.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(40), 0, math.radians(-35))
    focus = Vector(((lo[0] + hi[0]) / 2, lo[1] + 4.0, 0.0))
    pitch = math.radians(52)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    cam.data.lens = 30
    dist = 30.0
    cam.location = focus + Vector((0, -math.cos(pitch) * dist, math.sin(pitch) * dist))
    cam.rotation_euler = (focus - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam
    os.makedirs(RENDERS, exist_ok=True)
    sc.render.filepath = os.path.join(RENDERS, f"{name}.png")
    bpy.ops.render.render(write_still=True)
    for o in (sun, cam):
        bpy.data.objects.remove(o)


def main():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--only", default="")
    p.add_argument("--fast", action="store_true")
    p.add_argument("--preview", action="store_true")
    a = p.parse_args(scene.script_args())
    os.makedirs(OUT, exist_ok=True)
    rp = os.path.join(RENDERS, "build_report_skirts.json")
    rep = scene.read_json(rp, {}) or {}
    for name in DESIGNS:
        if a.only and name not in a.only.split(","):
            continue
        rep[name] = build_one(name, a.fast, a.preview)
        scene.write_json(rp, rep)


if __name__ == "__main__":
    main()
