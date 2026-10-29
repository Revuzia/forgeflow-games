"""VALE map landmarks, Art 2.0 (env F1): the fight-zone and base-end landmarks rebuilt with the structures' method
(art/blender/units/structure_kit.py): hard-surface stones, each its own piece with its own value, the bible's
painted stone (cavity ink, chalked convex edges, top light, the dark-feet / lit-crown value ramp, rain streaks,
chips), one baked base-colour atlas with AO multiplied in (the joints between stones read as ink lines).

    Blender -b --factory-startup --python art/blender/maps/landmarks_art2.py -- [--only shaft_drum,...] [--fast] [--preview]

  shaft_drum   RIFT, the Fallen Shaft (85, 66.6), a wall of 3 x 6.4 m, <= 2.2 m: a lying drum of the fallen needle.
               Octagonal needle stone in three coursed drums, two carved hour-bands (a dark turned neck with twelve
               stone hour-lugs, the quarters long), iron cramps across the joints on its top flat, and a broken
               south end: a weathered rim round a paler raw fracture, spalled corners, chips in the water.
  snap_stub    BRIDGE, the Snap (78, 15.8) and (78, 28.2, rot 180), walls of 2.6 x 4.2 m, <= 2.4 m: a short drum of
               the snapped shaft in the same stone, one hour-band, a raw break toward the Snap's middle and a dressed
               end carved with the dial (a ring, twelve hour-lugs, an iron socket) on the other.
  dawn_arch    BRIDGE, Aubade's end (-4, 22), 3 x 24 m: a pointed arch of stacked chalk on coursed piers: a four-centred
               ring of seventeen voussoirs with a keystone and a dawnglass shard, chalk hood mouldings, blued-steel
               straps over the ring and a steel tie at the springing, a dawnglass infill in the arch's head carrying
               a steel dial rose, buttress pinnacles on the piers, dial-stone plinths.
  lamp_gate    BRIDGE, Serenade's end (160, 22), 5 x 24 m, <= 7 m: two ochre sandstone drum towers (painted
               coursing, ironstone bands and foot, round-arched lampresin windows, ribbed ironstone domes) and a
               low banded ironstone gate between them: coursed wing walls with sandstone bands and coping, a
               gatehouse with a sandstone-voussoired round arch and iron-strapped doors, and one lampresin lamp
               on the keystone (the only emissive, <= 0.8).

No team hue anywhere (the world carries none): no `accent` material. Blender (x, y, z) = sim (x, -y, height) local
to the landmark; +Y (Blender) is north. Output: art/out/maps/landmarks/<id>.glb (quantized, WebP);
report: art/renders/maps/build_report_landmarks_art2.json; looks: art/renders/maps/landmarks_art2_<id>.png.
  glass_belfry RIFT, Aubade's end (-5, 55) on the rim, 7 x 7 m, 22 m: three stages of coursed chalk blocks (bonded
               corners), a glazed pointed lancet in each face of the first (voussoirs, every second proud, a keystone
               with a blued-steel stud, a chalk hood, a steel mullion and transom over dawnglass), stepped corner
               buttresses with dawnglass-tipped pinnacles, open pointed arches on corner piers above, blued-steel
               bands and chalk cornices, the dawnglass bell-lantern in the top stage (neutral cool #BFD3E6, emissive
               0.5, its own node) and a concave steel-ribbed spire; a dial-stone plinth and a chalk-flagged court on
               the rim (sim x -14..-0.6, y 44..66) so the spawn view's corner of rim is dressed.
  lamp_dome    RIFT, Serenade's end (180, 55) on the rim, 18.4 m across, 8 m (built at half size with structures.py's
               helpers, then x2): an ironstone foot, a coursed sandstone drum with ironstone bands, twelve round-
               arched lampresin windows between sandstone pilasters, a ribbed ironstone dome, the oculus a lampresin
               lens (emissive 0.8, its own node) in a sandstone curb with iron hour-lugs; a footing down to the plain
               past the rim and a sandstone-flagged court on the rim (sim x 170.6..184, y 44..66).
  noon_stone   RIFT, (85, 3) on the north frame, 3 x 1.5 m, 9 m: a dial-stone plinth, four battered chalk drums, XII
               raised in chalk in a sunk dial-stone panel on the south face, a blued-steel band, cornice and hipped
               cap, the steel noon ring on top.
  shadow_slab  RIFT, Longshade's north choke (79.4 / 90.6, 19.6; the east one turned 180), 2 x 3 m, 4 m: dressed
               dark basalt in three courses leaning 9 deg toward the Noonline, a saddle-backed chalk coping (the
               lit top edge), chalk-beaded arrises, the shadow's hour-line and a stud inlaid in steel on both faces.
  hour_stone   FRAY, the stone ring (ten at r 19.5, walls of 4.6 x 1.8 m, 1.2 m; final parity env F2): dark basalt,
               a proud footing, an octagonal monolith, a cap stone with a chalked chamfer and a chalk lip, the
               half-hour tick inlaid in chalk down each broad face and across the top. Exported sunk by 1.2 m: the
               renderer stands it on its own wall block's top, which it encloses.
  camp_*       RIFT, one low cluster on each camp's north lip (env m2, brief §3 dressing): Glasshorn's shed horn-glass
               antlers, a Gloamoths moth-lamp on a crooked pole (unlit), the Strays' toppled numerals, Resinback's
               resin-filled cracked slab and rubbed stump, a tusk-scored Stilltusk boulder; content places them flush.
  vi_slab      RIFT, (85, 107) south of the South Road, 6 x 2 m, <= 1.2 m: the dial's six fallen flat, one dressed
               dial-stone on a bedding course, its east end snapped off askew (a raw break), VI cut and inked in its
               top inside a cut border, the V's point to the camera (south).
  numeral_*    RIFT, the four jungle callouts (Elevenmark XI, Twomark II, Sevenmark VII, Fourmark IIII; brief §2): giant
               numerals of carved dial-stone, each stroke its own chamfered stone between a foot and a head bar, laid
               back 52 deg so the face looks up the camera's line, sunk 0.9 m (the buried faces dropped), broken stone
               spilled at the foot.
The SDF landmarks that remain (the stalls, FRAY's cart and stands) stay in landmarks.py;
the skirts beyond the map bounds are art/blender/maps/skirts.py.
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
import structure_kit as K  # noqa: E402
import structures as ST  # noqa: E402

PI = math.pi
TAU = math.tau
OUT = os.path.join(scene.OUT_DIR, "maps", "landmarks")
RENDERS = os.path.join(scene.RENDERS_DIR, "maps")
SCRATCH = os.path.join(scene.CACHE_DIR, "landmarks_art2")
O8 = dict(segs=8, phase=PI / 8)          # octagon: flats face the axes (after laying down: a flat on top)

# ── materials (the bible vocabulary; structure_kit.paint_set specs) ─────────────────────────────────
EDGE = (0.07, 0.75, 0.7, 0.12)            # structure_kit._edge_ink: a 7 cm chalked rim, ink in joints over 12 cm
NEEDLE = dict(hex="#CBC7BD", chisel=0.75, var=0.08, streaks=0.5, chips=0.55, veins=0.12, scale=0.55, rough=0.7, edge_light=EDGE)
RAW = dict(hex="#D8D0C0", chisel=1.0, var=0.06, streaks=0.0, chips=0.0, speckle=0.25, scale=1.1, rough=0.84, edge_light=(0.04, 0.4, 0.8, 0.1))
BAND = dict(hex="#474C55", chisel=0.15, var=0.05, rough=0.52, streaks=0.1, chips=0.75, scale=0.9, edge_light=(0.03, 0.6, 0.3, 0.06))
SHAFT_MATS = {"needle": NEEDLE, "raw": RAW, "band": BAND}
CHALK = dict(hex="#DCD9D0", chisel=0.6, var=0.08, streaks=0.45, chips=0.5, veins=0.12, scale=0.5, rough=0.66, edge_light=EDGE)
DIAL = dict(ST.DIAL, edge_light=EDGE)
DAWN_MATS = {"dialstone": DIAL, "chalk": CHALK, "steel": dict(ST.AUBADE_MATS["steel"], edge_light=(0.03, 0.6, 0.3, 0.06)),
             "dawnglass": ST.AUBADE_MATS["dawnglass"]}
_SAND = dict(ST.SERENADE_MATS["sandstone"], edge_light=EDGE)
_IRON = {k: v for k, v in ST.SERENADE_MATS["ironstone"].items() if k not in ("brick", "brick_k")}
_IRON["edge_light"] = (0.06, 0.7, 0.6, 0.12)
GATE_MATS = {
    "dialstone": DIAL,
    "sandstone": dict(_SAND, brick_mirror_y=11.0),               # the drum towers: painted coursing about each tower's axis
    "sandblock": {k: v for k, v in _SAND.items() if k not in ("brick", "brick_k")},
    "ironstone": _IRON,
    "ironwall": dict(_IRON, brick=(0.62, 0.34, 0.018), brick_k=0.5, brick_mirror_y=11.0),   # the gatehouse's one block
    "iron": dict(ST.SERENADE_MATS["iron"], edge_light=(0.03, 0.6, 0.3, 0.06)),
    "lampresin": ST.SERENADE_MATS["lampresin"],
}
LAMP_HEX, LAMP_EMIT = "#E8A04A", 0.8
BELL_HEX, BELL_EMIT = "#BFD3E6", 0.5        # the Belfry's lantern glass: neutral cool (RIFT brief §2)


def lamp_material(name: str = "lampglow", hexcol: str = LAMP_HEX, emit: float = LAMP_EMIT):
    """The Lamp Gate's lamp: lampresin lit from inside (brief: emissive <= 0.8), not baked (its own node).
    `bellglow`: the Belfry's bell-lantern, dawnglass lit neutral cool (never a relationship colour)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    c = scene.hex_rgba(hexcol)
    b.inputs["Base Color"].default_value = c
    b.inputs["Roughness"].default_value = 0.3
    b.inputs["Emission Color"].default_value = c
    b.inputs["Emission Strength"].default_value = emit
    return m


class Shift:
    """A Build seen through an offset: structures.py's helpers (s_window, s_dome, ...) build about the origin."""

    def __init__(self, B, d):
        self.B, self.d = B, np.asarray(d, dtype=np.float64)

    @property
    def pieces(self):
        return self.B.pieces

    def add(self, mat, piece, node="body", var=None):
        if piece is None:
            return
        if isinstance(piece, list):
            for p in piece:
                self.add(mat, p, node, var)
            return
        v, f = piece
        self.B.add(mat, (np.asarray(v, dtype=np.float64) + self.d, f), node, var)


# ── the needle's shaft (lying along Blender Y) ───────────────────────────────────────────────────────
def lay(V, zc: float):
    """Lathe space (axis Z) -> lying along Blender Y (lathe z -> Y, lathe -y -> up), axis at height zc."""
    return K.move(K.rot(np.asarray(V, dtype=np.float64), (1, 0, 0), -PI / 2), (0, 0, zc))


def drum(B, mat, r, y0, y1, zc, c=0.07, lap=0.006):
    y0, y1 = y0 - lap, y1 + lap                                # the courses lap a little (their joint faces bury); the joint
    #                                                            reads as an inked V between the chamfers
    prof = [(0, y0), (r - c, y0), (r, y0 + c), (r, y1 - c), (r - c, y1), (0, y1)]
    v, f = K.lathe(prof, **O8)
    B.add(mat, (lay(v, zc), f))


def hour_band(B, r, y0, y1, zc, ticks=12):
    """A carved hour-band: a dark turned neck sunk into the octagon, twelve stone hour-lugs on it (the four
    quarters long, the rest short), the first lug on top (the camera's side)."""
    ap = r * math.cos(PI / 8)                                  # the octagon's flat (its smallest radius)
    rn = ap - 0.1
    v, f = K.lathe([(0, y0), (rn, y0), (rn, y1), (0, y1)], 32)
    B.add("band", (lay(v, zc), f))
    r0, r1 = rn - 0.03, ap - 0.012
    for k in range(ticks):
        a = -PI / 2 + k * TAU / ticks                          # lathe -y faces up after lay()
        big = k % 3 == 0
        L = (y1 - y0) * (0.84 if big else 0.46)
        w = 0.15 if big else 0.1
        cr = (r0 + r1) / 2
        v, f = K.box((cr * math.cos(a), cr * math.sin(a), (y0 + y1) / 2), ((r1 - r0) / 2, w / 2, L / 2), 0.018, rz=a)
        B.add("needle", (lay(v, zc), f))


def cramp(B, x, y, ztop):
    """An iron dovetail cramp across a joint, let into the top flat."""
    poly = [(-0.1, -0.22), (0.1, -0.22), (0.045, 0.0), (0.1, 0.22), (-0.1, 0.22), (-0.045, 0.0)]
    B.add("band", K.prism(poly, origin=(x, y, ztop + 0.008), u=(1, 0, 0), v=(0, 1, 0), depth=0.05, chamfer=0.008))


def _octa_ring(r, n_side=3):
    corners = np.array([(r * math.cos(PI / 8 + k * PI / 4), r * math.sin(PI / 8 + k * PI / 4)) for k in range(8)])
    pts = []
    for k in range(8):
        p0, p1 = corners[k], corners[(k + 1) % 8]
        for j in range(n_side):
            pts.append(p0 + (p1 - p0) * (j / n_side))
    return np.array(pts)


def broken_drum(B, r, y_in, y_brk, zc, rng, jag=0.42, c=0.06):
    """The broken course: an octagonal drum from the joint at y_in down to a ragged break near y_brk (< y_in): the
    shell (needle stone, spalled corners, a weathered rim) and the fresh fracture inside the rim (raw, paler, its
    own relief). Lathe space: z is the axis (lay() turns it to Blender Y)."""
    ring = _octa_ring(r)
    N = len(ring)
    ang = np.arctan2(ring[:, 1], ring[:, 0])
    td, ph = rng.uniform(0, TAU), rng.uniform(0, TAU)
    noise = np.array([rng.uniform(-0.05, 0.05) for _ in range(N)])

    def frac(rho, a, k=None):
        """distance of the break surface from y_brk toward y_in (rho 0..1)"""
        base = jag * (0.5 + 0.5 * np.cos(a - td)) * rho ** 0.8 + 0.11 * np.sin(3 * a + ph) * rho
        return base + (noise[k] * rho if k is not None else 0.0)

    spall = np.zeros(N)
    pull = np.zeros(N)
    for ci in rng.sample(range(8), 3):                         # three spalled corners at the break
        k0 = ci * 3
        for dk, s in ((-1, 0.55), (0, 1.0), (1, 0.55)):
            k = (k0 + dk) % N
            spall[k] = max(spall[k], s * rng.uniform(0.22, 0.38))
            pull[k] = max(pull[k], s * 0.1)
    verts, faces = [], []

    def add_ring(pts2, zs):
        i0 = len(verts)
        for (x, y), z in zip(pts2, zs):
            verts.append((x, y, z))
        return list(range(i0, i0 + len(pts2)))

    c0 = len(verts)
    verts.append((0.0, 0.0, y_in))
    R1 = add_ring(ring * (r - c) / r, [y_in] * N)
    R2 = add_ring(ring, [y_in - c] * N)
    zend = np.array([y_brk + frac(1.0, ang[k], k) + spall[k] for k in range(N)])
    R3 = add_ring(ring, list((y_in - c + zend) / 2))
    R4 = add_ring(ring * (1 - pull)[:, None], list(zend))
    R5 = add_ring(ring * 0.86, [y_brk + frac(0.86, ang[k], k) + 0.03 for k in range(N)])
    c6 = len(verts)
    verts.append((0.0, 0.0, y_brk + jag + 0.3))                # a cone recessed behind the raw fracture (never in front)
    for j in range(N):
        j1 = (j + 1) % N
        faces.append((c0, R1[j1], R1[j]))
        for A, Bq in ((R1, R2), (R2, R3), (R3, R4), (R4, R5)):
            faces.append((A[j], A[j1], Bq[j1], Bq[j]))
        faces.append((R5[j], R5[j1], c6))
    B.add("needle", (lay(verts, zc), faces))
    # the raw fracture inside the rim: a jagged slab, front surface proud of the shell's inner cap
    verts, faces = [], []
    rels = (0.9, 0.74, 0.52, 0.28)
    fr = []
    for rho in rels:
        zs = [y_brk + frac(rho, ang[k], k) - 0.04 + (rng.uniform(-0.08, 0.06) if rho < 0.8 else 0.0) for k in range(N)]
        fr.append(add_ring(ring * rho, zs))
    cf = len(verts)
    verts.append((0.0, 0.0, y_brk - 0.06 + rng.uniform(-0.05, 0.05)))
    zb = y_brk + jag + 0.4
    back = add_ring(ring * 0.9, [zb] * N)
    cb = len(verts)
    verts.append((0.0, 0.0, zb))
    for j in range(N):
        j1 = (j + 1) % N
        for A, Bq in zip(fr[:-1], fr[1:]):
            faces.append((A[j], A[j1], Bq[j1], Bq[j]))
        faces.append((fr[-1][j], fr[-1][j1], cf))
        faces.append((back[j], back[j1], fr[0][j1], fr[0][j]))
        faces.append((cb, back[j1], back[j]))
    B.add("raw", (lay(verts, zc), faces))


def chunk(B, mat, c, half, rng):
    v, f = K.box((0, 0, 0), half, 0.03)
    v = K.rot(v, (rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(0.2, 1)), rng.uniform(0.3, 1.2))
    B.add(mat, (K.move(v, c), f))


def shaft_drum(B, rng):
    """RIFT's Fallen Shaft drum: footprint 3 x 6.4 m (the wall it stands in for), <= 2.2 m; the break faces south (-Y)."""
    r, zc = 1.24, 0.98
    top = zc + r * math.cos(PI / 8)
    yN = 3.12
    drum(B, "needle", r, 1.72, yN, zc)
    hour_band(B, r, 1.38, 1.72, zc)
    drum(B, "needle", r, 0.5, 1.38, zc)
    drum(B, "needle", r, -0.42, 0.5, zc)
    hour_band(B, r, -0.76, -0.42, zc)
    broken_drum(B, r, -0.76, -2.92, zc, rng)
    # the north end: a dressed face with a turned boss (the drum's joint face, the next drum gone)
    v, f = K.lathe(K.chamfer_profile([(0, yN - 0.02), (0.62, yN - 0.02), (0.62, yN + 0.06), (0.0, yN + 0.06)], 0.02), 24)
    B.add("needle", (lay(v, zc), f))
    cramp(B, -0.3, 0.5, top)
    # spalled chips at the broken foot, low in the water (inside the wall's footprint)
    for c, h in (((-1.02, -2.55, 0.1), (0.2, 0.15, 0.12)), ((0.98, -2.75, 0.08), (0.16, 0.2, 0.1)), ((0.55, -3.0, 0.06), (0.12, 0.1, 0.08)),
                 ((-0.6, -3.02, 0.06), (0.14, 0.11, 0.07))):
        chunk(B, "needle" if c[0] < 0.7 else "raw", c, h, rng)


def snap_stub(B, rng):
    """BRIDGE's Snap stub: footprint 2.6 x 4.2 m, <= 2.4 m; the break faces -Y (the Snap's middle), the dressed end +Y."""
    r, zc = 1.2, 1.12
    top = zc + r * math.cos(PI / 8)
    yE = 2.04
    drum(B, "needle", r, 1.3, yE, zc, c=0.09)
    drum(B, "needle", r, 0.62, 1.3, zc)
    hour_band(B, r, 0.28, 0.62, zc)
    broken_drum(B, r, 0.28, -1.86, zc, rng, jag=0.5)
    # the dressed end, carved with the dial: a raised ring, twelve hour-lugs, an iron socket
    v, f = ST.ring(0.5, 0.66, yE - 0.02, yE + 0.05, 0.012, 32)
    B.add("needle", (lay(v, zc), f))
    for k in range(12):
        a = -PI / 2 + k * TAU / 12
        big = k % 3 == 0
        L = 0.24 if big else 0.14
        v, f = K.box(((0.8 + L / 2) * math.cos(a), (0.8 + L / 2) * math.sin(a), yE + 0.01), (L / 2, 0.05 if big else 0.035, 0.035), 0.01, rz=a)
        B.add("needle", (lay(v, zc), f))
    v, f = K.box((0, 0, yE + 0.02), (0.17, 0.17, 0.05), 0.015, rz=PI / 4)
    B.add("band", (lay(v, zc), f))
    cramp(B, 0.3, 1.3, top)


# ── the Dawn Arch (span along Y, depth along X) ─────────────────────────────────────────────────────
LEG, PH, PX = 11.5, 1.0, 0.95            # pier centres at |y| 11.5, pier half sizes (y, x)
SPRING, R1F, PHI, RING_T = 3.6, 0.5, math.radians(68), 0.95


def _intrados(n_arc=10, n_line=6):
    """The right half of the four-centred pointed arch: (y, z, ny, nz) from the springer (y = s) to the apex (y = 0)."""
    s = LEG - PH
    r1 = R1F * s
    cy = s - r1
    out = []
    for i in range(n_arc + 1):
        t = PHI * i / n_arc
        out.append((cy + r1 * math.cos(t), SPRING + r1 * math.sin(t), math.cos(t), math.sin(t)))
    py, pz = out[-1][0], out[-1][1]
    apex = pz + py / math.tan(PHI)
    for i in range(1, n_line + 1):
        t = i / n_line
        out.append((py * (1 - t), pz + (apex - pz) * t, math.cos(PHI), math.sin(PHI)))
    return np.array(out), apex


def _resample(P, n):
    """n+1 points evenly along the polyline P (rows y, z, ny, nz) by arc length."""
    d = np.r_[0, np.cumsum(np.hypot(np.diff(P[:, 0]), np.diff(P[:, 1])))]
    u = np.linspace(0, d[-1], n + 1)
    return np.stack([np.interp(u, d, P[:, k]) for k in range(4)], 1), d[-1]


def dawn_arch(B, rng):
    s = LEG - PH
    t = RING_T
    for sgn in (-1, 1):
        cy = sgn * LEG
        # dial-stone plinth, two steps
        B.add("dialstone", K.box((0, cy, 0.16), (PX + 0.55, PH + 0.55, 0.16), 0.04))
        B.add("dialstone", K.box((0, cy, 0.47), (PX + 0.3, PH + 0.3, 0.15), 0.035))
        z0 = 0.62
        B.add("chalk", K.box((0, cy, z0 + 0.17), (PX + 0.14, PH + 0.14, 0.17), 0.05))           # base moulding
        zs = np.linspace(z0 + 0.34, SPRING - 0.42, 6)
        for i in range(len(zs) - 1):
            za, zb = zs[i], zs[i + 1]
            h = (zb - za) / 2 - 0.012
            o = 0.03 if i % 2 else 0.0
            split = cy + (0.0 if i % 2 == 0 else sgn * -0.38)
            lo, hi = cy - PH - o, cy + PH + o
            for y0, y1 in ((lo, split - 0.012), (split + 0.012, hi)):
                B.add("chalk", K.box((0, (y0 + y1) / 2, (za + zb) / 2), (PX + o, (y1 - y0) / 2, h), 0.045))
        B.add("steel", K.box((0, cy, SPRING - 0.33), (PX + 0.05, PH + 0.05, 0.09), 0.02))      # blued-steel band
        B.add("chalk", K.box((0, cy, SPRING - 0.12), (PX + 0.13, PH + 0.13, 0.12), 0.04))      # impost
        # the buttress above the springing, outboard of the ring, crowned by a pinnacle with a dawnglass shard
        yb0, yb1 = s + t - 0.12, LEG + PH
        bc = sgn * (yb0 + yb1) / 2
        zt = SPRING + 2.1
        for i, (za, zb) in enumerate(((SPRING, SPRING + 0.7), (SPRING + 0.7, SPRING + 1.4), (SPRING + 1.4, zt))):
            o = 0.025 if i % 2 else 0.0
            B.add("chalk", K.box((0, bc, (za + zb) / 2), (PX - 0.08 + o, (yb1 - yb0) / 2 + o, (zb - za) / 2 - 0.012), 0.04))
        B.add("chalk", K.box((0, bc, zt + 0.1), (PX + 0.02, (yb1 - yb0) / 2 + 0.08, 0.1), 0.035))
        B.add("steel", K.box((0, bc, zt + 0.25), (0.5, 0.5, 0.06), 0.015, rz=PI / 4))
        ST.pinnacle(B, (0.0, bc), zt + 0.3, 1.9, r=0.34, tip=0.85)
    # the ring: seventeen voussoirs (eight a flank) and a keystone, each its own stone
    P, apex = _intrados()
    nv = 8
    Q, L = _resample(P, 64)
    d = np.linspace(0, L, 65)
    key_u = L - 0.55                                          # the keystone takes the last 0.55 m of each flank
    edges = np.linspace(0, key_u, nv + 1)
    for side in (1, -1):
        for i in range(nv):
            u0, u1 = edges[i] + 0.014, edges[i + 1] - 0.014
            us = np.linspace(u0, u1, 4)
            pts = np.stack([np.interp(us, d, Q[:, k]) for k in range(4)], 1)
            tt = t + (0.06 if i % 2 else 0.0)                 # every second voussoir stands proud: a stepped crown
            inner = [(side * p[0], p[1]) for p in pts]
            outer = [(side * (p[0] + tt * p[2]), p[1] + tt * p[3]) for p in pts[::-1]]
            poly = inner + outer
            if side < 0:
                poly = poly[::-1]
            B.add("chalk", K.prism(poly, origin=(0, 0, 0), u=(0, 1, 0), v=(0, 0, 1), depth=2 * PX, chamfer=0.035))
            # a blued-steel hour-stud let into each voussoir's back (the ring reads as a dial from above)
            pm = np.stack([np.interp([(u0 + u1) / 2], d, Q[:, k]) for k in range(4)], 1)[0]
            ny, nz = side * pm[2], pm[3]
            o = (0.0, side * pm[0] + ny * (tt + 0.005), pm[1] + nz * (tt + 0.005))
            dia = [(0.17, 0.0), (0.0, 0.2), (-0.17, 0.0), (0.0, -0.2)]
            B.add("steel", K.prism(dia, origin=o, u=(1, 0, 0), v=(0, nz, -ny), depth=0.05, chamfer=0.01))
    pk = np.stack([np.interp([key_u + 0.014], d, Q[:, k]) for k in range(4)], 1)[0]
    ztop = apex + t / math.sin(PHI) + 0.32
    yk_in, zk_in = pk[0], pk[1]
    yk_out, zk_out = pk[0] + t * pk[2], pk[1] + t * pk[3]
    key = [(yk_in, zk_in), (0.0, apex - 0.28), (-yk_in, zk_in), (-yk_out - 0.06, zk_out + 0.12), (-0.38, ztop), (0.38, ztop), (yk_out + 0.06, zk_out + 0.12)]
    B.add("chalk", K.prism(key[::-1], origin=(0, 0, 0), u=(0, 1, 0), v=(0, 0, 1), depth=2 * PX + 0.16, chamfer=0.04))
    B.add("steel", K.box((0, 0, ztop + 0.07), (0.3, 0.3, 0.07), 0.015, rz=PI / 4))
    B.add("dawnglass", K.crystal((0, 0, ztop + 0.38), 0.24, 0.62, 0.3, sides=4, band=0.07, phase=PI / 4))
    # chalk hood mouldings along both extrados edges (a crisp lit line from the camera)
    path_r = [(p[0] + t * p[2], p[1] + t * p[3]) for p in P]           # right extrados, springer -> apex
    path = [(-y, z) for y, z in path_r] + [(y, z) for y, z in path_r[::-1][1:]]
    py_phi = P[len(P) - 7][0]                                          # where the haunch arc meets the straight flank

    def ext_out(p):
        y, z = p[1], p[2]
        if abs(y) < 1e-3:
            return (0.0, 0.0, 1.0)
        sg = 1.0 if y > 0 else -1.0
        if abs(y) - t * math.cos(PHI) > py_phi:                         # on the haunch: radial from its centre
            dy, dz = abs(y) - (s - R1F * s), z - SPRING
            n = math.hypot(dy, dz) + 1e-9
            return (0.0, sg * dy / n, dz / n)
        return (0.0, sg * math.cos(PHI), math.sin(PHI))
    for xs in (-PX + 0.07, PX - 0.07):
        B.add("chalk", K.sweep([(xs, y, z) for y, z in path], 0.16, 0.09, out_fn=ext_out, sink=0.05))
    # blued-steel straps over the ring, two a flank
    for side in (1, -1):
        for ui in (0.3, 0.62):
            p = np.stack([np.interp([key_u * ui], d, Q[:, k]) for k in range(4)], 1)[0]
            ny, nz = side * p[2], p[3]
            poly = [(-PX - 0.05, -0.05), (-PX + 0.0, -0.05), (-PX + 0.0, t + 0.065), (PX - 0.0, t + 0.065), (PX - 0.0, -0.05), (PX + 0.05, -0.05),
                    (PX + 0.05, t + 0.12), (-PX - 0.05, t + 0.12)]
            B.add("steel", K.prism(poly, origin=(0, side * p[0], p[1]), u=(1, 0, 0), v=(0, ny, nz), depth=0.26, chamfer=0.01))
    # the steel tie at the springing, the dawnglass infill of the head and its steel dial rose
    zt0 = SPRING + 0.62
    B.add("steel", K.box((0, 0, zt0), (0.09, s + 0.25, 0.09), 0.025))
    for yy in (-s + 0.4, s - 0.4):
        B.add("steel", K.box((0, yy, zt0), (0.16, 0.12, 0.16), 0.02))
    head = [(p[0] + 0.07 * p[2], p[1] + 0.07 * p[3]) for p in P if p[1] >= zt0 + 0.05]
    pane = [(y, z) for y, z in head] + [(-y, z) for y, z in head[::-1][1:]]
    y_low = head[0][0]
    pane = [(y_low, zt0 + 0.06)] + pane + [(-y_low, zt0 + 0.06)]
    B.add("dawnglass", K.prism(pane[::-1], origin=(0, 0, 0), u=(0, 1, 0), v=(0, 0, 1), depth=0.1))
    zr, Rr = SPRING + 3.75, 2.55

    def on_x(V):
        return K.move(K.rot(np.asarray(V), (0, 1, 0), PI / 2), (0, 0, zr))
    for rin, rout in ((Rr - 0.16, Rr), (1.46, 1.56), (0.0, 0.42)):
        v, f = ST.ring(rin, rout, -0.16, 0.16, 0.02, 48) if rin > 0 else ST.disk(rout, -0.18, 0.18, 0.03, 16)
        B.add("steel", (on_x(v), f))
    for k in range(12):
        a = k * TAU / 12
        big = k % 3 == 0
        r0, r1 = 0.4, Rr - 0.08
        v, f = K.box(((r0 + r1) / 2 * math.cos(a), (r0 + r1) / 2 * math.sin(a), 0), ((r1 - r0) / 2, 0.075 if big else 0.05, 0.13), 0.012, rz=a)
        B.add("steel", (on_x(v), f))
    # vertical steel mullions either side of the rose, from the tie up into the ring
    for yy in (3.6, 6.4, 8.9):
        zi = float(np.interp(yy, P[::-1, 0], P[::-1, 1]))
        for sgn in (-1, 1):
            B.add("steel", K.box((0, sgn * yy, (zt0 + zi) / 2 + 0.05), (0.08, 0.06, (zi - zt0) / 2 + 0.05), 0.012))


# ── the Lamp Gate (span along Y, depth along X) ─────────────────────────────────────────────────────
TOWER_Y, TOWER_R = 11.0, 2.3


def tower(B, sgn):
    c = (0.0, sgn * TOWER_Y, 0.0)
    Bs = Shift(B, c)
    R = TOWER_R
    z = ST.s_foot(B, 0.0, R, h=0.46, c=c)
    zs = [z, 1.86, 3.26, 4.5]
    for i in range(3):
        za, zb = zs[i], zs[i + 1]
        ra, rb = R - 0.02 * i, R - 0.02 * (i + 1)
        Bs.add("sandstone", K.lathe([(0, za), (ra - 0.02, za), (ra, za + 0.02), (rb, zb - 0.02), (rb - 0.02, zb), (0, zb)], 48))
    for zz in (1.86, 3.26):
        Bs.add("ironstone", ST.ring(R - 0.06, R + 0.08, zz - 0.1, zz + 0.1, 0.018, 48))
    for a in (PI, PI - sgn * 0.78, PI + sgn * 0.78, PI + sgn * 1.7):
        ST.s_window(Bs, a, R - 0.03, 2.18, 0.6, 0.5)
    Bs.add("ironstone", K.lathe(K.chamfer_profile([(0, 4.48), (R - 0.04, 4.48), (R + 0.2, 4.7), (R + 0.2, 4.86), (0, 4.86)], 0.025), 48))
    zt = ST.s_dome(Bs, R + 0.06, 1.62, 4.86, 0.3, ribs=8, rib_phase=PI / 8, segs=48, rib_mat="sandblock", seams=False)
    Bs.add("sandblock", K.lathe([(0, zt - 0.03), (0.34, zt - 0.03), (0.34, zt + 0.09), (0.16, zt + 0.28), (0, zt + 0.4)], 16))
    return zt + 0.4


def lamp_gate(B, rng):
    ztop = max(tower(B, -1), tower(B, 1))
    XW = 1.3                                                    # the wall's half depth
    B.add("ironstone", K.box((0, 0, 0.2), (XW + 0.12, 9.2, 0.2), 0.04))   # the footing course under wings and gate
    # wing walls: coursed ironstone with two sandstone bands, sandstone coping
    courses = [(0.4, 1.0, "ironstone"), (1.0, 1.6, "ironstone"), (1.6, 1.86, "sandblock"), (1.86, 2.46, "ironstone"),
               (2.46, 3.06, "ironstone"), (3.06, 3.3, "sandblock"), (3.3, 3.82, "ironstone")]
    for sgn in (-1, 1):
        ya, yb = 3.42, 9.0
        for ci, (za, zb, m) in enumerate(courses):
            y = ya
            first = True
            while y < yb - 0.05:
                L = 2.4 if m == "sandblock" else rng.uniform(1.15, 1.85)
                if first and m != "sandblock" and ci % 2:
                    L *= 0.55
                first = False
                y1 = min(yb, y + L)
                if yb - y1 < 0.5:
                    y1 = yb
                o = 0.05 if m == "sandblock" else 0.0
                B.add(m, K.box((0, sgn * (y + y1) / 2, (za + zb) / 2), (XW + o, (y1 - y) / 2 - 0.012, (zb - za) / 2 - 0.012), 0.035))
                y = y1
        for y0, y1 in zip(np.linspace(3.3, 9.1, 6)[:-1], np.linspace(3.3, 9.1, 6)[1:]):       # saddle-back coping stones
            sec = [(-XW - 0.14, 3.82), (XW + 0.14, 3.82), (XW + 0.14, 3.95), (0.0, 4.22), (-XW - 0.14, 3.95)]
            B.add("sandblock", K.prism(sec, origin=(0, sgn * (y0 + y1) / 2, 0), u=(1, 0, 0), v=(0, 0, 1), depth=(y1 - y0) - 0.03, chamfer=0.025))
    # the gatehouse: one ironstone block (painted coursing) round a sandstone-voussoired round arch
    W2, SP, HG = 2.25, 2.2, 5.0
    arch = K.arch_path(2 * W2, SP, "round", 16, bottom=0.4)
    poly = [(3.42, 0.4), (3.42, HG), (-3.42, HG), (-3.42, 0.4)] + arch[::-1]
    B.add("ironwall", K.prism(poly, origin=(0, 0, 0), u=(0, 1, 0), v=(0, 0, 1), depth=2 * XW + 0.2, chamfer=0.03))
    nv, Rv = 11, W2
    for i in range(nv):
        a0 = PI * i / nv + 0.01
        a1 = PI * (i + 1) / nv - 0.01
        key = i == nv // 2
        ro = Rv + (1.0 if key else 0.55)
        vpoly = [(math.cos(a) * Rv, math.sin(a) * Rv) for a in np.linspace(a0, a1, 3)] + \
                [(math.cos(a) * ro, math.sin(a) * ro) for a in np.linspace(a1, a0, 3)]
        B.add("sandblock", K.prism(vpoly, origin=(0, 0, SP), u=(0, 1, 0), v=(0, 0, 1), depth=2 * XW + (0.5 if key else 0.32), chamfer=0.03))
    zk = SP + Rv + 1.0
    B.add("sandblock", K.box((0, 0, HG - 0.04), (XW + 0.24, 3.55, 0.12), 0.04))          # the gatehouse cornice
    # a low ribbed ironstone barrel roof over the gatehouse (dome language), sandstone ribs across it
    rx, rb, z0r = XW + 0.12, 0.5, HG + 0.08
    sec = [(rx * math.cos(a), z0r + rb * math.sin(a)) for a in np.linspace(0, PI, 13)]
    B.add("ironstone", K.prism(sec[::-1], origin=(0, 0, 0), u=(1, 0, 0), v=(0, 0, 1), depth=6.7, chamfer=0.02))
    for yy in np.linspace(-3.0, 3.0, 6):
        if abs(yy) < 0.9:
            continue
        rib = [((rx + 0.06) * math.cos(a), z0r + (rb + 0.06) * math.sin(a)) for a in np.linspace(0, PI, 11)]
        rib = rib + [((rx - 0.1) * math.cos(a), z0r + (rb - 0.1) * math.sin(a)) for a in np.linspace(PI, 0, 11)]
        B.add("sandblock", K.prism(rib, origin=(0, yy, 0), u=(1, 0, 0), v=(0, 0, 1), depth=0.22, chamfer=0.015))
    # iron-strapped doors in the arch
    for sgn in (-1, 1):
        leaf = [(0.025, 0.4), (W2 - 0.04, 0.4), (W2 - 0.04, SP)] + \
               [((W2 - 0.04) * math.cos(a), SP + (W2 - 0.04) * math.sin(a)) for a in np.linspace(0.12, PI / 2, 8)]
        leaf[-1] = (0.025, leaf[-1][1])
        leaf = [(sgn * y, z) for y, z in leaf]
        if sgn < 0:
            leaf = leaf[::-1]
        B.add("iron", K.prism(leaf, origin=(0, 0, 0), u=(0, 1, 0), v=(0, 0, 1), depth=0.2, chamfer=0.012))
        for zz in (1.05, 2.0, 2.95):
            B.add("iron", K.box((0, sgn * W2 * 0.5, zz), (0.15, W2 * 0.46, 0.07), 0.015))
    # the lamp on the keystone: a sandstone seat, an iron cage round a lampresin globe (the lamp node), an iron cap
    zs = max(zk, z0r + rb) + 0.02
    B.add("sandblock", K.lathe(K.chamfer_profile([(0, zs - 0.1), (0.62, zs - 0.1), (0.62, zs + 0.12), (0.42, zs + 0.24), (0, zs + 0.24)], 0.03), 24))
    zc, rl = zs + 0.56, 0.36
    sph = [(0, zc - rl)] + [(rl * math.cos(a), zc + rl * math.sin(a)) for a in np.linspace(-PI / 2 + 0.25, PI / 2 - 0.25, 8)] + [(0, zc + rl)]
    B.add("lampglow", K.lathe(sph, 20), node="lamp")
    for k in range(6):
        a = k * TAU / 6
        path = [((rl + 0.04) * math.cos(tt) * math.cos(a), (rl + 0.04) * math.cos(tt) * math.sin(a), zc + (rl + 0.04) * math.sin(tt))
                for tt in np.linspace(-PI / 2 + 0.45, PI / 2 - 0.3, 7)]
        B.add("iron", K.sweep(path, 0.06, 0.045, out_fn=lambda p, zc=zc: (p[0], p[1], p[2] - zc), sink=0.015))
    zc0 = zc + rl - 0.06
    pts = ST.ellipse_pts(0.5, 0.26, zc0, 0.0, PI / 2, 6)
    B.add("ironstone", K.lathe(K.chamfer_profile([(0, zc0), (0.5, zc0)] + pts[1:], 0.02), 24))
    B.add("iron", K.lathe([(0, zc0 + 0.24), (0.07, zc0 + 0.24), (0.07, zc0 + 0.4), (0, zc0 + 0.52)], 8))
    return ztop


# ── coursed masonry (the Belfry's stages, the noon stone) ─────────────────────────────────────────
# a square shaft's four faces: (outward normal, tangent u, turn of K.box), u runs along the tangent
FACES = {"s": ((0, -1, 0), (1, 0, 0), 0.0), "e": ((1, 0, 0), (0, 1, 0), PI / 2),
         "n": ((0, 1, 0), (-1, 0, 0), PI), "w": ((-1, 0, 0), (0, -1, 0), -PI / 2)}


def pointed(w: float, spring: float, k: float = 1.25, n: int = 7, off: float = 0.0):
    """The right half of a two-centred pointed arch of span w (each arc's radius k*w, centred on the far
    side), offset `off` outward from the intrados: [(u, z)] from the springer (u = w/2 + off) up to the apex
    (u = 0). Returns (points, apex z)."""
    R = k * w
    cu = w / 2 - R
    Ro = R + off
    ta = math.acos(min(1.0, -cu / Ro))
    pts = [(cu + Ro * math.cos(ta * i / n), spring + Ro * math.sin(ta * i / n)) for i in range(n + 1)]
    pts[-1] = (0.0, pts[-1][1])
    return pts, pts[-1][1]


def arch_outline(w: float, spring: float, sill: float, k: float = 1.25, inset: float = 0.0):
    """The whole opening (sill, jambs, pointed head) as one polygon in (u, z), inset by `inset`."""
    pts, _ = pointed(w - 2 * inset, spring, k, 8)
    right = [(u, z) for u, z in pts]
    left = [(-u, z) for u, z in pts[::-1][1:]]
    return [(-(w / 2 - inset), sill + inset), (w / 2 - inset, sill + inset)] + right + left


def face_arch(B, face, H, T, w, spring, k=1.25, rt=0.34, nv=4, mat="chalk", stud="steel", key_shard=False):
    """A pointed arch ring of voussoirs (every second proud) with a keystone, in the wall plane of face
    `face` of a square shaft of half-width H, wall thickness T; a chalk hood moulding over it.
    Returns (extrados apex z, extrados points of the right half)."""
    n, t, _ = FACES[face]
    n, t = np.array(n, float), np.array(t, float)
    org = tuple(n * (H - T / 2))
    ins, apex = pointed(w, spring, k, 24)
    outs, apex_o = pointed(w, spring, k, 24, rt)
    ins, outs = np.array(ins), np.array(outs)
    m = len(ins) - 1
    cut = [int(round(m * i / nv)) for i in range(nv + 1)]
    cut[-1] = m - 3                                                    # the keystone takes the top
    for side in (1, -1):
        for i in range(nv):
            a, b = cut[i], cut[i + 1]
            pr = 0.04 if i % 2 else 0.0
            inner = [(side * ins[j, 0], ins[j, 1]) for j in range(a, b + 1)]
            outer = [(side * (ins[j, 0] + (outs[j, 0] - ins[j, 0]) * (1 + pr / rt)), ins[j, 1] + (outs[j, 1] - ins[j, 1]) * (1 + pr / rt))
                     for j in range(b, a - 1, -1)]
            poly = inner + outer
            if side < 0:
                poly = poly[::-1]
            B.add(mat, K.prism(poly, origin=org, u=tuple(t), v=(0, 0, 1), depth=T + 0.06 + pr, chamfer=0.03))
    j = cut[-1]
    key = [(ins[j, 0], ins[j, 1]), (0.0, apex - 0.02), (-ins[j, 0], ins[j, 1]), (-outs[j, 0] - 0.05, outs[j, 1] + 0.05),
           (-0.2, apex_o + 0.22), (0.2, apex_o + 0.22), (outs[j, 0] + 0.05, outs[j, 1] + 0.05)]
    B.add(mat, K.prism(key[::-1], origin=org, u=tuple(t), v=(0, 0, 1), depth=T + 0.14, chamfer=0.035))
    face_pt = n * (H + 0.07)
    if stud:
        dia = [(0.11, 0.0), (0.0, 0.14), (-0.11, 0.0), (0.0, -0.14)]
        B.add(stud, K.prism(dia, origin=tuple(face_pt + np.array([0, 0, apex_o + 0.02])), u=tuple(t), v=(0, 0, 1), depth=0.05, chamfer=0.008))
    if key_shard:
        B.add("dawnglass", K.crystal(tuple(n * (H - T / 2) + np.array([0, 0, apex_o + 0.5])), 0.13, 0.34, 0.12, sides=4, band=0.04, phase=PI / 4))
    # the hood moulding along the extrados (a crisp lit line from the camera)
    hood, _ = pointed(w, spring, k, 16, rt + 0.06)
    path = [(-u, z) for u, z in hood] + [(u, z) for u, z in hood[::-1][1:]]
    nn = tuple(n)
    B.add(mat, K.sweep([tuple(n * H + t * u + np.array([0, 0, z])) for u, z in path], 0.12, 0.07, out_fn=lambda p, nn=nn: nn, sink=0.03))
    return apex_o, outs


def spandrels(B, face, H, T, w, spring, k, rt, Ws, ztop, mat="chalk"):
    """The two wall pieces between an arch's extrados and the coursed wall (u in ±Ws, spring..ztop)."""
    n, t, _ = FACES[face]
    org = tuple(np.array(n, float) * (H - T / 2))
    outs, apex_o = pointed(w, spring, k, 14, rt)
    for side in (1, -1):
        poly = [(Ws, spring), (Ws, ztop), (0.0, ztop), (0.0, apex_o)] + [(u, z) for u, z in outs[::-1][1:]]
        poly = [(side * u, z) for u, z in poly]
        if side > 0:
            poly = poly[::-1]
        B.add(mat, K.prism(poly, origin=org, u=t, v=(0, 0, 1), depth=T, chamfer=0.025))


def coursed_shaft(B, rng, H, T, zs, mat="chalk", skips=None, faces="sewn", gap=0.014, lmin=1.0, lmax=1.75):
    """A square shaft of half-width H as a shell of coursed blocks (wall thickness T): course k spans
    zs[k]..zs[k+1]; corners are bonded (the S/N faces own them on even courses, E/W on odd). skips: face ->
    [(u0, u1, z0, z1)] openings the blocks leave out (a block that would cross one is cut at its edge)."""
    skips = skips or {}
    for k in range(len(zs) - 1):
        za, zb = zs[k], zs[k + 1]
        zc, hz = (za + zb) / 2, (zb - za) / 2 - gap / 2
        for f in faces:
            n, t, rz = FACES[f]
            own = (f in "sn") == (k % 2 == 0)
            lo, hi = (-H, H) if own else (-H + T, H - T)
            cuts = [(u0, u1) for u0, u1, z0, z1 in skips.get(f, []) if z0 < zc < z1]
            segs, u = [], lo
            for u0, u1 in sorted(cuts):
                if u0 > u:
                    segs.append((u, u0))
                u = max(u, u1)
            if u < hi:
                segs.append((u, hi))
            for s0, s1 in segs:
                if s1 - s0 < 0.12:
                    continue
                u, first = s0, True
                while u < s1 - 0.05:
                    L = rng.uniform(lmin, lmax) * (0.55 if first and k % 2 else 1.0)
                    first = False
                    u1 = min(s1, u + L)
                    if s1 - u1 < 0.45:
                        u1 = s1
                    c = np.array(n, float) * (H - T / 2) + np.array(t, float) * ((u + u1) / 2) + np.array([0, 0, zc])
                    B.add(mat, K.box(tuple(c), ((u1 - u) / 2 - gap / 2, T / 2, hz), 0.04, rz=rz))
                    u = u1


def courses(z0, z1, h):
    n = max(1, int(round((z1 - z0) / h)))
    return [z0 + (z1 - z0) * i / n for i in range(n + 1)]


def square_band(B, mat, H, z0, z1, c=0.02):
    """A square ring band (a steel band, a string course) round a shaft of half-width H."""
    hz = (z1 - z0) / 2
    for f in "sn":
        n, t, rz = FACES[f]
        B.add(mat, K.box(tuple(np.array(n, float) * (H - 0.04) + np.array([0, 0, (z0 + z1) / 2])), (H + 0.04, 0.08, hz), c, rz=rz))
    for f in "ew":
        n, t, rz = FACES[f]
        B.add(mat, K.box(tuple(np.array(n, float) * (H - 0.04) + np.array([0, 0, (z0 + z1) / 2])), (H - 0.12, 0.08, hz), c, rz=rz))


def flags(B, mat, rng, x0, x1, y0, y1, keep=None, z=0.0, size=(1.25, 1.9), gap=0.035, th=0.09, ch=0.025):
    """A flagged floor (random-length flags in running courses along x) over the rectangle, z = its top;
    keep(x, y) -> False leaves a flag out (under a plinth, beyond an edge). `ch`: each flag's chamfer (0: a plain
    12-triangle slab, its chalked edge left to the bake's edge light)."""
    y = y0
    while y < y1 - 0.2:
        d = min(rng.uniform(*size), y1 - y)
        if y1 - (y + d) < 0.5:
            d = y1 - y
        x = x0 + (rng.uniform(0, 0.6) if rng.random() < 0.5 else 0.0)
        if x > x0:
            if keep is None or keep((x0 + x) / 2, y + d / 2):
                B.add(mat, K.box(((x0 + x) / 2, y + d / 2, z - th / 2), ((x - x0) / 2 - gap / 2, d / 2 - gap / 2, th / 2), ch))
        while x < x1 - 0.2:
            L = min(rng.uniform(*size) * 1.15, x1 - x)
            if x1 - (x + L) < 0.5:
                L = x1 - x
            if keep is None or keep(x + L / 2, y + d / 2):
                B.add(mat, K.box((x + L / 2, y + d / 2, z - th / 2 + rng.uniform(-0.012, 0.012)), (L / 2 - gap / 2, d / 2 - gap / 2, th / 2), ch))
            x += L
        y += d


# ── the Glass Belfry (RIFT, Aubade's end, (-5, 55) on the rim, 7 x 7 m, 22 m) ───────────────────────
def belfry_stage(B, rng, H, T, z0, z1, w, sill, spring, k, rt, glass=False, faces="sewn"):
    """One stage: coursed walls (stage 1: a shell with a glazed lancet on each face; the upper stages: corner
    piers carrying open pointed arches), the arch rings, spandrels and a sill per face."""
    hc = 0.6
    zs = courses(z0, z1, hc)
    sp = min(zs, key=lambda z: abs(z - spring))                       # springers and sills on course joints
    sl = min(zs, key=lambda z: abs(z - sill))
    _, apex_o = pointed(w, sp, k, 8, rt)
    ztop = min([z for z in zs if z >= apex_o + 0.3] or [z1])
    Ws = w / 2 + rt + 0.42
    skips = {f: [(-w / 2, w / 2, sl, sp), (-Ws, Ws, sp - 1e-3, ztop)] for f in faces}
    coursed_shaft(B, rng, H, T, zs, skips=skips, faces="sewn")
    for f in faces:
        face_arch(B, f, H, T, w, sp, k, rt)
        spandrels(B, f, H, T, w, sp, k, rt, Ws, ztop)
        n, t, rz = FACES[f]
        nv = np.array(n, float)
        if glass:
            B.add("chalk", K.box(tuple(nv * (H - T / 2 + 0.06) + np.array([0, 0, sl - 0.07])), (w / 2 + 0.16, T / 2 + 0.06, 0.08), 0.025, rz=rz))
            org = tuple(nv * (H - T * 0.62))
            B.add("dawnglass", K.prism(arch_outline(w, sp, sl, k, 0.0), origin=org, u=t, v=(0, 0, 1), depth=0.06))
            B.add("steel", K.box(tuple(nv * (H - T * 0.55) + np.array([0, 0, (sl + sp) / 2 + 0.3])), (0.05, 0.06, (sp - sl) / 2 + 0.3), 0.012, rz=rz))
            B.add("steel", K.box(tuple(nv * (H - T * 0.55) + np.array([0, 0, sp])), (w / 2, 0.06, 0.05), 0.012, rz=rz))
            # the reveal: the opening's sides and soffit read as stone depth (dark core behind the glass)
        else:
            B.add("chalk", K.box(tuple(nv * (H - T / 2) + np.array([0, 0, sl + 0.05])), (w / 2 + 0.02, T / 2 + 0.04, 0.06), 0.02, rz=rz))
    return ztop


def glass_belfry(B, rng):
    # its forecourt on the rim: chalk flags from the rim's lip (sim x = 0, local +5) back to the rim's outer
    # edge (local -9), ±11 m along it; the plinth's own flags
    flags(B, "dialstone", rng, -9.0, 4.4, -11.0, 11.0, keep=lambda x, y: not (abs(x) < 4.0 and abs(y) < 4.0), z=0.09)
    # dial-stone plinth: two steps of dressed slabs
    for (h, z0, z1) in ((3.75, 0.0, 0.34), (3.35, 0.34, 0.66)):
        n = 3
        for i in range(n):
            for j in range(n):
                x0, x1 = -h + 2 * h * i / n, -h + 2 * h * (i + 1) / n
                y0, y1 = -h + 2 * h * j / n, -h + 2 * h * (j + 1) / n
                B.add("dialstone", K.box(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), ((x1 - x0) / 2 - 0.012, (y1 - y0) / 2 - 0.012, (z1 - z0) / 2), 0.04))
    H1, T1 = 2.75, 0.62
    zb = 0.66
    B.add("chalk", K.box((0, 0, zb + 0.16), (H1 + 0.16, H1 + 0.16, 0.16), 0.045))                    # base moulding
    B.add("dialstone", K.box((0, 0, 4.0), (H1 - T1 + 0.02, H1 - T1 + 0.02, 3.2), 0.0))               # the dark core
    z1 = 7.3
    belfry_stage(B, rng, H1, T1, zb + 0.32, z1, w=1.5, sill=1.9, spring=4.4, k=1.3, rt=0.36, glass=True)
    square_band(B, "steel", H1, z1 - 0.32, z1 - 0.12)
    B.add("chalk", K.box((0, 0, z1 + 0.1), (H1 + 0.24, H1 + 0.24, 0.18), 0.05))                       # cornice
    # corner buttresses in three set-offs, a pinnacle with a dawnglass shard on each
    for sx in (-1, 1):
        for sy in (-1, 1):
            cx, cy = sx * (H1 + 0.08), sy * (H1 + 0.08)
            for (za, zz, hw) in ((zb, 2.9, 0.5), (2.9, 5.2, 0.42), (5.2, z1 + 0.28, 0.35)):
                for zz0, zz1 in ((za, (za + zz) / 2), ((za + zz) / 2, zz)):
                    B.add("chalk", K.box((cx, cy, (zz0 + zz1) / 2), (hw, hw, (zz1 - zz0) / 2 - 0.008), 0.04))
                B.add("chalk", K.box((cx, cy, zz + 0.05), (hw + 0.05, hw + 0.05, 0.05), 0.02))       # weathering course
            ST.pinnacle(B, (cx, cy), z1 + 0.33, 1.6, r=0.2, tip=0.5)
    # stage 2: open pointed arches on corner piers, a newel shaft inside
    H2, P2 = 2.2, 0.42
    z2a, z2b = z1 + 0.28, 12.1
    B.add("dialstone", K.box((0, 0, z2a + 0.06), (H2 - 0.05, H2 - 0.05, 0.06), 0.02))
    belfry_stage(B, rng, H2, 2 * P2, z2a, z2b, w=2 * (H2 - 2 * P2), sill=z2a, spring=z2a + 1.5, k=1.0, rt=0.3)
    B.add("chalk", K.lathe(K.chamfer_profile([(0, z2a), (0.42, z2a), (0.42, z2b), (0, z2b)], 0.04), **O8))
    square_band(B, "steel", H2, z2b - 0.3, z2b - 0.12)
    B.add("chalk", K.box((0, 0, z2b + 0.1), (H2 + 0.2, H2 + 0.2, 0.16), 0.045))
    # stage 3: the bell-lantern's open stage
    H3, P3 = 1.65, 0.32
    z3a, z3b = z2b + 0.26, 15.6
    B.add("dialstone", K.box((0, 0, z3a + 0.05), (H3 - 0.05, H3 - 0.05, 0.05), 0.02))
    belfry_stage(B, rng, H3, 2 * P3, z3a, z3b, w=2 * (H3 - 2 * P3), sill=z3a, spring=z3a + 0.9, k=1.0, rt=0.22)
    square_band(B, "steel", H3, z3b - 0.26, z3b - 0.1)
    B.add("chalk", K.box((0, 0, z3b + 0.08), (H3 + 0.16, H3 + 0.16, 0.14), 0.04))
    # the dawnglass bell-lantern hung from a steel yoke (neutral cool, its own glow node: never a team hue)
    zc = z3a + 0.25
    bell = [(0.0, zc + 1.95), (0.22, zc + 1.95), (0.36, zc + 1.7), (0.42, zc + 1.2), (0.55, zc + 0.6), (0.8, zc + 0.22), (0.84, zc + 0.12),
            (0.6, zc + 0.14), (0.0, zc + 0.3)]
    B.add("bellglow", K.lathe(bell, 8, phase=PI / 8), node="lantern")
    for kk in range(8):
        a = PI / 8 + kk * TAU / 8
        B.add("steel", K.sweep([((r + 0.02) * math.cos(a), (r + 0.02) * math.sin(a), z) for r, z in bell[1:6]], 0.06, 0.04,
                               out_fn=lambda p: (p[0], p[1], 0.0), sink=0.01))
    B.add("steel", K.box((0, 0, zc + 2.05), (1.2, 0.07, 0.07), 0.015))
    B.add("steel", K.lathe([(0, zc + 1.9), (0.26, zc + 1.9), (0.26, zc + 2.0), (0, zc + 2.0)], 12))
    # the spire: concave, octagonal, steel-ribbed, a dawnglass finial
    ST.a_spire_cap(B, z3b + 0.22, 21.3, H3 + 0.05, panes=0, ribs=True, finial=0.62, sides=8)


# ── the Lamp Dome (RIFT, Serenade's end, (180, 55) on the rim, 18 m across, 8 m) ─────────────────────
DOME_S = 2.0                     # built at half size with the structures' helpers, then scaled (their mouldings scale)


def lamp_dome(B, rng):
    R = 4.3
    z = ST.s_foot(B, 0.0, R + 0.1, h=0.34)
    zs = [z, 0.98, 1.6, 1.98]
    for i in range(3):
        za, zb = zs[i], zs[i + 1]
        ra, rb = R - 0.012 * i, R - 0.012 * (i + 1)
        B.add("sandstone", K.lathe([(0, za), (ra - 0.015, za), (ra, za + 0.015), (rb, zb - 0.015), (rb - 0.015, zb), (0, zb)], 72))
    for zz in (0.98, 1.6):
        B.add("ironstone", ST.ring(R - 0.04, R + 0.05, zz - 0.06, zz + 0.06, 0.012, 72))
    nw = 12
    for kk in range(nw):
        a = PI / nw + kk * TAU / nw
        ST.s_window(B, a, R - 0.02, 1.06, 0.4, 0.24)
        ap = kk * TAU / nw                                              # sandstone pilasters between the windows
        v, f = K.box((R + 0.02, 0, (zs[0] + 1.96) / 2), (0.07, 0.16, (1.96 - zs[0]) / 2), 0.015)
        B.add("sandblock", (K.rotz(v, ap), f))
    B.add("ironstone", K.lathe(K.chamfer_profile([(0, 1.96), (R - 0.03, 1.96), (R + 0.16, 2.1), (R + 0.16, 2.2), (0, 2.2)], 0.015), 72))
    zt = ST.s_dome(B, R + 0.06, 1.62, 2.2, 0.62, ribs=12, rib_phase=0.0, segs=72, rib_mat="sandblock", seams=False)
    # the oculus: a sandstone curb round a lampresin lens (the only emissive, <= 0.8), an iron ring of hour-lugs
    B.add("sandblock", ST.ring(0.42, 0.7, zt - 0.04, zt + 0.1, 0.012, 32))
    B.add("lampglow", K.lathe([(0, zt + 0.02), (0.44, zt + 0.02), (0.3, zt + 0.16), (0, zt + 0.2)], 24), node="lamp")
    for kk in range(12):
        a = kk * TAU / 12
        v, f = K.box((0.76, 0, zt + 0.08), (0.07 if kk % 3 == 0 else 0.045, 0.035, 0.04), 0.008)
        B.add("iron", (K.rotz(v, a), f))
    # its footing goes down past the rim's outer edge (the drop to the plain, local z -3.4)
    B.add("ironstone", K.lathe([(0, -1.75), (R + 0.3, -1.75), (R + 0.3, 0.02), (0, 0.02)], 72))


def dome_court(B, rng):
    """The sandstone court round the Lamp Dome on the rim (built at full size, after the scale)."""
    flags(B, "courtsand", rng, -9.4, 4.0, -11.0, 11.0, keep=lambda x, y: math.hypot(x, y) > 9.1, z=0.09)


# ── the noon stone (RIFT, (85, 3) on the north frame, 3 x 1.5 m, 9 m) ──────────────────────────────────
def noon_stone(B, rng):
    B.add("dialstone", K.box((0, 0, 0.17), (1.5, 0.74, 0.17), 0.04))
    for i, (x0, x1) in enumerate(((-1.3, -0.4), (-0.4, 0.45), (0.45, 1.3))):
        B.add("dialstone", K.box(((x0 + x1) / 2, 0, 0.47), ((x1 - x0) / 2 - 0.012, 0.6, 0.13), 0.035))
    # the shaft: four tapering drums of chalk (each its own stone), battered, a moulded base
    B.add("chalk", K.box((0, 0, 0.72), (1.12, 0.5, 0.12), 0.04))
    zs = [0.84, 2.55, 4.15, 5.65, 7.0]
    hw = lambda z: (1.02 - 0.024 * (z - 0.84), 0.44 - 0.01 * (z - 0.84))
    for za, zb in zip(zs[:-1], zs[1:]):
        (ax, ay), (bx, by) = hw(za + 0.01), hw(zb - 0.01)
        r0, r1 = math.hypot(ax, ax), math.hypot(bx, bx)
        v, f = K.lathe(K.chamfer_profile([(0, za + 0.008), (r0, za + 0.008), (r1, zb - 0.008), (0, zb - 0.008)], 0.05), 4, phase=PI / 4)
        v = v.copy()
        zz = (v[:, 2] - za) / (zb - za)
        v[:, 1] *= (ay + (by - ay) * zz) / (ax + (bx - ax) * zz)
        B.add("chalk", (v, f))
    # XII on the south face: a sunk dial-stone panel in a chalk frame, the numerals raised in chalk
    zp0, zp1 = 3.0, 5.4
    fy = -hw((zp0 + zp1) / 2)[1] - 0.01
    B.add("dialstone", K.box((0, fy, (zp0 + zp1) / 2), (0.62, 0.03, (zp1 - zp0) / 2), 0.01))
    for (cx, cz, hx, hz) in ((0, zp1 + 0.06, 0.74, 0.07), (0, zp0 - 0.06, 0.74, 0.07), (-0.68, (zp0 + zp1) / 2, 0.07, (zp1 - zp0) / 2), (0.68, (zp0 + zp1) / 2, 0.07, (zp1 - zp0) / 2)):
        B.add("chalk", K.box((cx, fy - 0.02, cz), (hx, 0.05, hz), 0.015))
    strokes = [((-0.5, zp0 + 0.32), (-0.14, zp1 - 0.32), 0.1), ((-0.14, zp0 + 0.32), (-0.5, zp1 - 0.32), 0.06),
               ((0.12, zp0 + 0.32), (0.12, zp1 - 0.32), 0.1), ((0.4, zp0 + 0.32), (0.4, zp1 - 0.32), 0.1)]
    for (a, b, wd) in strokes:
        a, b = np.array(a), np.array(b)
        d = (b - a) / np.linalg.norm(b - a)
        nrm = np.array([-d[1], d[0]]) * wd
        poly = [tuple(a - nrm), tuple(a + nrm), tuple(b + nrm), tuple(b - nrm)]
        B.add("chalk", K.prism(poly, origin=(0, fy - 0.035, 0), u=(1, 0, 0), v=(0, 0, 1), depth=0.07, chamfer=0.012))
    for zz in (zp0 + 0.22, zp1 - 0.22):                                  # serifs: foot and head bars
        B.add("chalk", K.box((-0.04, fy - 0.035, zz), (0.62, 0.035, 0.035), 0.008))
    # a blued-steel band, the cornice and a low hipped cap carrying the steel noon ring
    (cx_, cy_) = hw(6.86)
    B.add("steel", K.box((0, 0, 6.86), (cx_ + 0.04, cy_ + 0.04, 0.09), 0.02))
    B.add("chalk", K.box((0, 0, 7.12), (0.98, 0.52, 0.13), 0.04))
    B.add("chalk", K.box((0, 0, 7.33), (0.88, 0.44, 0.08), 0.03))
    v, f = K.lathe(K.chamfer_profile([(0, 7.41), (1.12, 7.41), (0.2, 8.15), (0, 8.18)], 0.03), 4, phase=PI / 4)
    v = v.copy()
    v[:, 1] *= 0.5
    B.add("chalk", (v, f))
    on_y = lambda V: K.move(K.rot(np.asarray(V), (1, 0, 0), PI / 2), (0, 0, 8.62))
    for rin, rout in ((0.3, 0.44),):
        v, f = ST.ring(rin, rout, -0.04, 0.04, 0.01, 32)
        B.add("steel", (on_y(v), f))
    B.add("steel", K.box((0, 0, 8.22), (0.05, 0.05, 0.1), 0.01))
    for kk in range(4):
        a = kk * TAU / 4
        v, f = K.box((0.37 * math.cos(a), 0, 0.37 * math.sin(a)), (0.03, 0.05, 0.03), 0.006)
        B.add("steel", (K.move(v, (0, 0, 8.62)), f))


# ── the shadow slab (RIFT, Longshade's north choke, (79.4 / 90.6, 19.6), 2 x 3 m, 4 m) ────────────────
def shadow_slab(B, rng):
    """A dressed basalt slab leaning toward the Noonline (+x; the east one is the same stone turned 180°),
    its top dressed in a chalk coping that catches the light (brief: dark basalt with chalk-lit top edges),
    the shadow's hour-line cut down both broad faces, set in a dial-stone footing."""
    lean = math.radians(9.0)
    B.add("dialstone", K.box((-0.25, 0, 0.14), (0.75, 1.45, 0.14), 0.035))
    th, wd, ht = 0.36, 1.18, 3.55

    def lean_v(v, f):
        v = K.rot(np.asarray(v), (0, 1, 0), lean)
        return (K.move(v, (-0.32, 0, 0.12)), f)
    # the slab in three courses of basalt, the top one cut to a gable; its courses offset like masonry
    zc = [0.0, 1.25, 2.45, ht]
    for i in range(3):
        za, zb = zc[i], zc[i + 1]
        B.add("basalt", lean_v(*K.box((0, 0, (za + zb) / 2), (th, wd, (zb - za) / 2 - 0.01), 0.05)))
    # chalk coping: a saddle-backed cap stone along the top, proud on every side
    sec = [(-th - 0.07, 0.0), (th + 0.07, 0.0), (th + 0.07, 0.1), (0.0, 0.3), (-th - 0.07, 0.1)]
    v, f = K.prism(sec, origin=(0, 0, ht), u=(1, 0, 0), v=(0, 0, 1), depth=2 * wd + 0.14, chamfer=0.03)
    B.add("chalk", lean_v(v, f))
    # a chalk bead up each end's two arrises (the lit edges the camera sees on the south end; the faces stay basalt)
    for sy in (-1, 1):
        for sx in (-1, 1):
            B.add("chalk", lean_v(*K.box((sx * (th - 0.012), sy * (wd - 0.012), ht / 2), (0.04, 0.04, ht / 2 - 0.02), 0.015)))
    # the shadow's hour-line cut down both broad faces (a steel inlay) and a steel hour-stud on each
    for sx in (-1, 1):
        B.add("steel", lean_v(*K.box((sx * (th + 0.012), 0, 1.9), (0.02, 0.045, 1.55), 0.008)))
        dia = [(0.1, 0.0), (0.0, 0.13), (-0.1, 0.0), (0.0, -0.13)]
        v, f = K.prism(dia, origin=(sx * (th + 0.02), 0, 3.0), u=(0, 1, 0), v=(0, 0, 1), depth=0.04, chamfer=0.006)
        B.add("steel", lean_v(v, f))
    # spalled basalt chips at its foot
    for c, h in (((0.55, -1.0, 0.1), (0.16, 0.12, 0.1)), ((-0.9, 0.8, 0.08), (0.12, 0.15, 0.08)), ((0.6, 1.2, 0.07), (0.1, 0.1, 0.07))):
        chunk(B, "basalt", c, h, rng)


# ── FRAY's hour-stone (ten at r 19.5, one per gap between the hour-marks; walls of 4.6 x 1.8 m, 1.2 m) ─────
HOUR_H = 1.2             # the wall block's height (map_fray art.terrain.wallHeights.hourStones)
HOUR_HALF = (2.3, 0.9)   # the wall polygon's half extents (map_gen.py build_fray: rect 4.6 x 1.8, tangential)


def hour_stone(B, rng):
    """FRAY's hour-stone (brief map_fray_landmarks.md §2 stone ring, §3): a low carved block of dark basalt, the
    frame stone, never the plate's pale stone. A proud footing course, a monolith with its four plan corners cut
    back, a cap stone whose chamfered top edge is chalked (the chalk top edge / lip), and the half-hour tick inlaid
    in chalk down the middle of each broad face and across the top (radial: the tick the hour-ring carries between
    two marks). Blender +Y faces the plate's centre (content `rot`), X runs along the rim.
    The renderer stands a landmark on groundAt(), which inside its own (not replaced) wall block is the block's top;
    the stone is built from z 0 and sunk by HOUR_H at export (SINK), so it encloses the block and stands 1.25 m
    on the plate. Every face clears the block's battered courses and organic outline (<= 0.13 m out) by >= 0.15 m."""
    hx, hy = HOUR_HALF
    m = 0.17
    # the footing course: proud on every side
    B.add("hourface", K.box((0, 0, 0.13), (hx + m + 0.06, hy + m + 0.06, 0.15), 0.05))
    # the monolith: an octagon in plan (corners cut 0.32 m), 0.26 -> 1.08
    ax, ay = hx + m, hy + m
    c = 0.32
    plan = [(-ax + c, -ay), (ax - c, -ay), (ax, -ay + c), (ax, ay - c), (ax - c, ay), (-ax + c, ay), (-ax, ay - c), (-ax, -ay + c)]
    v, f = K.prism(plan, origin=(0, 0, 0.27), u=(1, 0, 0), v=(0, 1, 0), depth=0.82, chamfer=0.035, center=False)
    B.add("hourface", (v, f))
    # the cap stone: proud 4 cm, a 7 cm chamfer all round its top edge (the chalked lip catches the noon sun)
    cx, cy, cc = ax + 0.04, ay + 0.04, c + 0.03
    cap = [(-cx + cc, -cy), (cx - cc, -cy), (cx, -cy + cc), (cx, cy - cc), (cx - cc, cy), (-cx + cc, cy), (-cx, cy - cc), (-cx, -cy + cc)]
    v, f = K.prism(cap, origin=(0, 0, 1.08), u=(1, 0, 0), v=(0, 1, 0), depth=0.17, chamfer=0.07, center=False)
    B.add("hourbasalt", (v, f))
    # the chalk lip: a slim chalk fillet along both long top arrises (what reads as the lit edge from 28 m)
    for sy in (-1, 1):
        B.add("hourchalk", K.box((0, sy * (cy - 0.035), 1.235), (cx - cc - 0.05, 0.05, 0.025), 0.012))
    # the half-hour tick: chalk inlaid down each broad face and across the top (radial, toward the plate's centre)
    for sy in (-1, 1):
        B.add("hourchalk", K.box((0, sy * (ay + 0.008), 0.68), (0.055, 0.02, 0.33), 0.008))
        B.add("hourchalk", K.box((0, sy * (ay + 0.008), 0.33), (0.2, 0.02, 0.03), 0.006))     # its foot bar
    B.add("hourchalk", K.box((0, 0, 1.252), (0.055, cy - 0.2, 0.012), 0.006))
    # spalled chips at the foot (the camera side and one end)
    for cc_, h in (((1.4, -(hy + m + 0.32), 0.07), (0.12, 0.1, 0.07)), ((-(hx + m + 0.3), 0.4, 0.06), (0.1, 0.13, 0.06))):
        chunk(B, "hourface", cc_, h, rng)


# values on screen (brief §3, FRAY's overhead noon sun): lit top L* 20-28, faces 12-18, chalk edge light <= 48. The
# sun lights the cap's top and barely the walls, so the monolith and footing are painted ~3x the cap's albedo (same
# basalt, a lighter wash) and the chalk is a toned chalk; all of it a neutral, slightly warm grey (a cool basalt goes
# navy under the noon grade)
HOUR_MATS = {
    "hourbasalt": dict(hex="#4B4846", chisel=0.9, var=0.07, streaks=0.25, chips=0.55, speckle=0.35, scale=0.5, rough=0.64,
                       edge_light=(0.06, 0.9, 0.65, 0.1)),
    "hourface": dict(hex="#7F7B77", chisel=0.9, var=0.07, streaks=0.35, chips=0.55, speckle=0.35, scale=0.5, rough=0.66,
                     edge_light=(0.05, 0.6, 0.65, 0.1)),
    "hourchalk": dict(CHALK, hex="#87837A", streaks=0.2, chips=0.3, edge_light=(0.02, 0.3, 0.4, 0.05)),
}


# ── RIFT camp lips (final parity env m2; brief map_rift_landmarks.md §3 "Dressing (low, flush or on the clearing's
# wall lip)"): one low cluster per camp, on the clearing's floor just inside its north lip, so it reads behind the
# monsters and never hides a foot. Local +Y points out of the clearing (toward the wall), X along the lip; origin on
# the ground at the cluster's centre; <= 0.45 m tall but the Gloamoths' lamp-pole (1.3 m, the north lip). On screen
# L* <= 46 (content `value` on top of the map's landmark band); the clearings sit at L* 30-35.
def rod(B, mat, pts, r0, r1, segs=6):
    """A tapered round rod along a polyline (each span a frustum, r0 at the first point -> r1 at the last)."""
    P = [np.asarray(p, dtype=np.float64) for p in pts]
    n = len(P) - 1
    for i in range(n):
        a, b = P[i], P[i + 1]
        d = b - a
        L = float(np.linalg.norm(d))
        ra, rb = r0 + (r1 - r0) * i / n, r0 + (r1 - r0) * (i + 1) / n
        v, f = K.lathe([(0.0, -0.01), (ra, -0.01), (rb, L + 0.01), (0.0, L + 0.01)], segs)
        z = np.array([0.0, 0.0, 1.0])
        u = d / L
        ax = np.cross(z, u)
        s = float(np.linalg.norm(ax))
        if s > 1e-6:
            v = K.rot(v, ax / s, math.atan2(s, float(np.dot(z, u))))
        elif u[2] < 0:
            v = K.rot(v, (1, 0, 0), PI)
        B.add(mat, (K.move(v, a), f))


def pebbles(B, mat, rng, spots):
    for (x, y, s) in spots:
        chunk(B, mat, (x, y, s * 0.55), (s, s * rng.uniform(0.7, 1.1), s * 0.6), rng)


def camp_glasshorn(B, rng):
    """Glasshorn: two shed antlers of pale horn-glass on a low lip stone (they catch the sun, never glow)."""
    v, f = K.box((0.25, 0.2, 0.08), (0.62, 0.36, 0.1), 0.04, rz=0.2)
    B.add("lipstone", (K.rot(v, (1, 0, 0), 0.07, about=(0.25, 0.2, 0.0)), f))
    for (ox, oy, yaw, flip) in ((-0.45, -0.05, 0.35, 1), (0.55, 0.25, 2.6, -1)):
        def T(p):
            x, y, z = p
            c, s_ = math.cos(yaw), math.sin(yaw)
            return (ox + c * x - s_ * y * flip, oy + s_ * x + c * y * flip, z)
        beam = [T(p) for p in ((0.0, 0.0, 0.06), (0.3, 0.08, 0.12), (0.6, 0.12, 0.22), (0.85, 0.06, 0.34))]
        rod(B, "hornglass", beam, 0.055, 0.022)
        B.add("hornglass", K.box(beam[0], (0.07, 0.07, 0.06), 0.02))                 # the burr where it was shed
        for (t0, tip) in ((1, (0.38, 0.32, 0.3)), (2, (0.66, 0.4, 0.42))):
            rod(B, "hornglass", [beam[t0], T(tip)], 0.032, 0.012, segs=5)
    pebbles(B, "lipstone", rng, ((-0.9, 0.35, 0.09), (1.05, -0.2, 0.07), (0.1, -0.35, 0.06)))


def camp_gloamoths(B, rng):
    """Gloamoths: a crooked lamp-pole on the north lip with one moth-lamp hung from its crook (paper wings over a
    resin cup, unlit by day) and a second lamp fallen in the moss."""
    rod(B, "wood", [(0.35, 0.35, 0.0), (0.3, 0.38, 0.6), (0.38, 0.32, 1.1), (0.2, 0.22, 1.3), (-0.05, 0.12, 1.28)], 0.05, 0.03)
    B.add("lipstone", K.box((0.35, 0.35, 0.07), (0.22, 0.2, 0.08), 0.03, rz=0.4))      # its footing stone
    rod(B, "wood", [(-0.05, 0.12, 1.28), (-0.05, 0.12, 1.12)], 0.008, 0.008, segs=4)    # the cord

    def lamp(c, tilt=0.0):
        cx, cy, cz = c
        body = K.lathe([(0.0, -0.13), (0.06, -0.12), (0.09, 0.0), (0.06, 0.12), (0.0, 0.13)], 8)
        B.add("paper", (K.move(K.rot(body[0], (1, 0, 0), tilt), c), body[1]))
        for sx in (-1, 1):                                                               # the folded wings
            wing = [(0.0, -0.1), (0.2, -0.04), (0.24, 0.1), (0.05, 0.12)]
            v, f = K.prism([(sx * x, z) for x, z in wing], origin=(0, 0, 0), u=(1, 0, 0), v=(0, 0, 1), depth=0.025)
            v = K.rot(v, (0, 0, 1), sx * 0.35)
            B.add("paper", (K.move(K.rot(v, (1, 0, 0), tilt), c), f))
        B.add("resin", K.box((cx, cy, cz - 0.15 * math.cos(tilt)), (0.04, 0.04, 0.03), 0.01))
    lamp((-0.05, 0.12, 0.98))
    lamp((-0.6, -0.05, 0.1), tilt=1.35)
    pebbles(B, "lipstone", rng, ((-0.95, 0.3, 0.08), (0.85, -0.15, 0.07)))


def camp_strays(B, rng):
    """Strays: small carved numerals toppled round the rim of the clearing: a V lying on its face, an I propped on a
    stone, an X half sunk; dial-stone with their carving inked."""
    def glyph(strokes, c, yaw, tilt_ax, tilt, th=0.16, w=0.12):
        for (a, b) in strokes:
            a, b = np.array(a, float), np.array(b, float)
            d = (b - a) / np.linalg.norm(b - a)
            nrm = np.array([-d[1], d[0]]) * w / 2
            poly = [tuple(a - nrm), tuple(a + nrm), tuple(b + nrm), tuple(b - nrm)]
            v, f = K.prism(poly, origin=(0, 0, 0), u=(1, 0, 0), v=(0, 1, 0), depth=th, chamfer=0.02)
            v = K.rot(K.rot(v, tilt_ax, tilt), (0, 0, 1), yaw)
            B.add("dialstone", (K.move(v, c), f))
    glyph([((-0.22, 0.3), (0.0, -0.3)), ((0.0, -0.3), (0.22, 0.3))], (-0.55, 0.05, 0.08), 0.5, (1, 0, 0), 0.06)   # V, on its face
    B.add("lipstone", K.box((0.35, 0.25, 0.11), (0.2, 0.17, 0.12), 0.04, rz=-0.3))
    glyph([((0.0, -0.3), (0.0, 0.3))], (0.42, 0.0, 0.2), 1.3, (0, 1, 0), 0.55, th=0.15, w=0.14)                     # I, propped
    glyph([((-0.2, -0.25), (0.2, 0.25)), ((0.2, -0.25), (-0.2, 0.25))], (1.0, 0.3, 0.05), -0.4, (1, 0, 0), -0.35)    # X, half sunk
    pebbles(B, "lipstone", rng, ((-1.05, -0.2, 0.07), (0.05, 0.45, 0.08)))


def camp_resinback(B, rng):
    """Resinback: a cracked lip slab with amber resin pooled in its cracks (warm, below bloom: albedo only) and a
    resin-crusted root stump the beast has rubbed."""
    for (x0, x1, dz) in ((-0.95, -0.06, 0.0), (0.06, 0.9, 0.025)):
        v, f = K.box(((x0 + x1) / 2, 0.05, 0.06 + dz), ((x1 - x0) / 2, 0.45, 0.07), 0.035)
        B.add("lipstone", (K.rot(v, (0, 1, 0), 0.03 if dz else -0.02, about=((x0 + x1) / 2, 0, 0)), f))
    B.add("resin", K.box((0.0, 0.05, 0.1), (0.07, 0.43, 0.035), 0.02))                 # the crack, full of resin
    B.add("resin", K.box((-0.45, -0.12, 0.125), (0.2, 0.05, 0.012), 0.01, rz=0.35))     # a branch crack
    v, f = K.lathe([(0.0, 0.0), (0.24, 0.0), (0.2, 0.18), (0.15, 0.36), (0.0, 0.38)], 9)
    B.add("wood", (K.move(v, (0.7, 0.55, 0.0)), f))                                       # the stump
    for k in range(4):
        a = k * TAU / 4 + 0.4
        B.add("resin", K.box((0.7 + 0.17 * math.cos(a), 0.55 + 0.17 * math.sin(a), 0.2 - 0.04 * k), (0.035, 0.035, 0.08), 0.02, rz=a))
    pebbles(B, "lipstone", rng, ((-1.1, 0.45, 0.07),))


def camp_stilltusks(B, rng):
    """Stilltusks: a low lip boulder scored deep by tusks (three parallel gouges, inked) and a broken tusk tip."""
    v, f = K.box((0.0, 0.15, 0.2), (0.6, 0.38, 0.22), 0.09, rz=0.15)
    B.add("lipstone", (v, f))
    for k in range(3):
        B.add("groove", K.box((-0.2 + 0.2 * k, 0.15 - 0.37, 0.24 - 0.02 * k), (0.035, 0.012, 0.16), 0.006, rz=0.15 + 0.25))
        B.add("groove", K.box((-0.25 + 0.2 * k, 0.15, 0.425), (0.03, 0.3, 0.008), 0.004, rz=0.15 + 0.35))
    rod(B, "ivory", [(0.75, -0.25, 0.05), (1.0, -0.2, 0.09), (1.2, -0.05, 0.14), (1.28, 0.12, 0.2)], 0.07, 0.015)
    B.add("ivory", K.box((0.73, -0.26, 0.06), (0.06, 0.07, 0.06), 0.02))                 # its broken base
    pebbles(B, "lipstone", rng, ((-0.85, -0.25, 0.08), (-0.7, 0.55, 0.06)))


# ── the dial's numerals (RIFT jungle callouts) and the VI slab (W5a verify minor:landmark-leftovers: the last two
# landmark sets still on landmarks.py's SDF pillows, rebuilt in the same painted, baked stone as the rest) ─────────
def _stroke_poly(a, b, w):
    """A carved letter stroke from a (foot) to b (head) in the glyph plane, `w` wide square to the stroke, its ends cut
    level (the mason's square cut against the foot and head bars), counter-clockwise."""
    (ax, az), (bx, bz) = a, b
    hw = 0.5 * w * math.hypot(bx - ax, bz - az) / max(abs(bz - az), 1e-6)
    return [(ax - hw, az), (ax + hw, az), (bx + hw, bz), (bx - hw, bz)]


NUM_H, NUM_W, NUM_THIN, NUM_GAP, NUM_D = 4.6, 0.9, 0.5, 0.75, 1.2


def numeral_strokes(glyph: str):
    """Roman numeral strokes (foot, head, width) in the glyph plane (x along, z up), the classical cut: stems and
    a V's or X's first diagonal thick, the second thin; the foot and head bars tie them. → strokes, glyph width."""
    h, w, thin, gap = NUM_H, NUM_W, NUM_THIN, NUM_GAP
    z0, z1 = 0.3, h - 0.3
    out, x = [], 0.0
    for ch in glyph:
        if ch == "I":
            out.append(((x + w / 2, z0), (x + w / 2, z1), w))
            x += w + gap
        elif ch == "V":
            out.append(((x + 1.45, z0), (x + w / 2, z1), w))
            out.append(((x + 1.45, z0), (x + 2.9 - thin / 2, z1), thin))
            x += 2.9 + gap
        elif ch == "X":
            out.append(((x + 2.9 - w / 2, z0), (x + w / 2, z1), w))
            out.append(((x + thin / 2, z0), (x + 2.9 - thin / 2, z1), thin))
            x += 2.9 + gap
    return out, x - gap


def numeral(B, rng, glyph: str, tilt: float = 52.0):
    """A giant numeral of the dial, fallen into the Dialwood block and half buried: dressed dial-stone strokes (each
    its own stone, chamfered, the paint's chalked arrises and inked joints) between a foot bar and a head bar, laid
    back `tilt` degrees so its face looks up the gameplay camera's line (brief map_rift_landmarks.md §2: the callout
    reads as a pale glyph on the dark block), sunk 0.9 m, a spill of broken stone at its foot. Blender +Y is north."""
    strokes, width = numeral_strokes(glyph)
    D = NUM_D
    pieces = []
    for (a, b, w) in strokes:
        # a thin stroke is cut 3 cm shallower on both faces, so where it crosses or meets a thick one the thick stone
        # stands proud over it (never two coplanar faces baking each other black)
        d = D if w >= NUM_W else D - 0.06
        pieces.append(("dialstone", K.prism(_stroke_poly(a, b, w), u=(1, 0, 0), v=(0, 0, 1), depth=d, chamfer=0.07)))
    for zc in (0.16, NUM_H - 0.16):                                              # foot and head bars: a proud slab each
        pieces.append(("dialstone", K.box((width / 2, 0.0, zc), (width / 2 + 0.35, D / 2 + 0.06, 0.16), 0.05)))
    t = -math.radians(tilt)                                                      # the top away from the camera (+Y)
    for mat, (v, f) in pieces:
        v = K.rot(K.move(np.asarray(v, dtype=np.float64), (-width / 2, 0.0, -0.9)), (1, 0, 0), t)
        B.add(mat, (v, f))
    # the spill at its foot: flat broken spalls half sunk along the camera side (lying, never standing on a corner),
    # two larger flat spalls on the block top
    n = max(3, int(width / 1.5))
    for k in range(n):
        x = -width / 2 - 0.2 + (width + 0.4) * (k + 0.5) / n + rng.uniform(-0.25, 0.25)
        s = rng.uniform(0.2, 0.32)
        v, f = K.box((0, 0, 0), (s, s * rng.uniform(0.65, 0.9), s * 0.32), 0.03, rz=rng.uniform(0, PI))
        v = K.rot(v, (rng.uniform(-1, 1), rng.uniform(-1, 1), 0.0), rng.uniform(0.08, 0.25))
        B.add("rubble", (K.move(v, (x, rng.uniform(-1.3, -1.0), s * 0.12)), f))
    for sx in (-1, 1):
        B.add("rubble", K.box((sx * (width / 2 + 0.55), -0.4, 0.05), (0.42, 0.3, 0.07), 0.025, rz=rng.uniform(-0.5, 0.5)))


def _vi(B, rng):
    """The VI slab (RIFT, (85, 107), 6 x 2 m, <= 1.2 m), the dial's six fallen flat south of the South Road: one long
    dressed dial-stone, its east end snapped off and lying askew (a raw fracture), VI cut into its top and inked, the V's
    point toward the camera (south, -Y) so the camera reads VI, never an inverted V, in a cut border."""
    L, Wd, T = 4.7, 1.62, 0.46                                                   # the main stone (x -2.8 .. 1.9)
    x0, x1 = -2.8, -2.8 + L
    ztop = T + 0.06
    B.add("footing", K.box((-0.3, 0.0, 0.03), (2.75, 0.95, 0.06), 0.03))      # a sunk bedding course, proud a hand
    B.add("dialstone", K.box(((x0 + x1) / 2, 0.0, 0.06 + T / 2), (L / 2, Wd / 2, T / 2), 0.07))
    # the snapped end: a short stone, its fracture face (raw) toward the main stone, dropped and turned a little
    poly = [(-0.38, -0.81), (0.42, -0.81), (0.40, 0.81), (-0.30, 0.81), (-0.44, 0.35), (-0.33, 0.0), (-0.47, -0.4)]
    v, f = K.prism(poly, origin=(0, 0, 0.06), u=(1, 0, 0), v=(0, 1, 0), depth=T - 0.06, chamfer=0.05, center=False)
    v = K.rot(K.rotz(v, 0.12), (0, 1, 0), -0.06, about=(0.4, 0, 0.06))
    B.add("dialstone", (K.move(v, (x1 + 0.56, -0.06, -0.02)), f))
    v, f = K.box((x1 + 0.004, 0.0, 0.06 + (T - 0.04) / 2), (0.014, Wd / 2 - 0.1, (T - 0.04) / 2 - 0.05), 0.006)
    B.add("raw", (v, f))                                                         # the main stone's fracture face, set in its end
    # VI cut into the top: inked channels a hair proud of the face, the V thick-left / thin-right, the I thick; head
    # and foot of every stroke cut level; the V's point south (-Y: the camera's side)
    cx = -1.15
    yS, yN = -0.5, 0.5
    strokes = [((cx - 0.15, yS), (cx - 0.72, yN), 0.26), ((cx - 0.15, yS), (cx + 0.42, yN), 0.15),
               ((cx + 0.95, yS), (cx + 0.95, yN), 0.26)]
    for (a, b, w) in strokes:
        B.add("groove", K.prism(_stroke_poly(a, b, w), origin=(0, 0, ztop - 0.012), u=(1, 0, 0), v=(0, 1, 0),
                                depth=0.022, chamfer=0.004, center=False))
    for (bx0, bx1, by0, by1) in ((cx - 1.3, cx + 1.45, 0.66, 0.70), (cx - 1.3, cx + 1.45, -0.70, -0.66),
                                 (cx - 1.3, cx - 1.26, -0.70, 0.70), (cx + 1.41, cx + 1.45, -0.70, 0.70)):
        B.add("groove", K.box(((bx0 + bx1) / 2, (by0 + by1) / 2, ztop - 0.001), ((bx1 - bx0) / 2, (by1 - by0) / 2, 0.012), 0.003))
    # spalls and chips round it (the camera side and the break)
    for c, h in (((x1 + 0.2, -1.05, 0.08), (0.16, 0.12, 0.08)), ((x0 - 0.15, 0.7, 0.07), (0.13, 0.15, 0.07)),
                 ((x1 + 1.05, 0.62, 0.06), (0.11, 0.09, 0.06)), ((-0.6, -1.1, 0.05), (0.1, 0.08, 0.05))):
        chunk(B, "dialstone", c, h, rng)


def vi_slab(B, rng):
    _vi(B, rng)


def drop_underground(ob, z: float = -0.06) -> int:
    """Delete faces lying wholly under the ground (a numeral's sunk third): never seen, they would only take atlas."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    kill = [f for f in bm.faces if max(v.co.z for v in f.verts) < z]
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return len(kill)


NUM_MATS = {
    "dialstone": dict(DIAL, hex="#A9A296", streaks=0.45, chips=0.6),             # carved dial-stone, weathered
    "rubble": dict(hex="#7C776D", chisel=0.9, var=0.09, streaks=0.3, chips=0.55, speckle=0.3, scale=0.6, rough=0.78,
                   edge_light=(0.03, 0.55, 0.6, 0.08)),
}
VI_MATS = {
    "dialstone": NUM_MATS["dialstone"],
    "footing": NUM_MATS["rubble"],
    "raw": dict(RAW, hex="#BDB5A7", edge_light=(0.03, 0.35, 0.8, 0.08)),       # the fresh break: paler, unweathered
    "groove": dict(hex="#3B3731", chisel=0.2, var=0.05, streaks=0.0, chips=0.0, scale=1.0, rough=0.9),   # the cut, inked
}


LIP = dict(hex="#8A857A", chisel=0.8, var=0.08, streaks=0.3, chips=0.5, speckle=0.3, scale=0.6, rough=0.75,
           edge_light=(0.03, 0.6, 0.6, 0.06))
CAMP_MATS = {
    "lipstone": LIP,
    "dialstone": dict(DIAL, edge_light=(0.03, 0.7, 0.6, 0.06)),
    "hornglass": dict(hex="#B3C3C9", chisel=0.2, var=0.05, streaks=0.1, chips=0.2, scale=0.9, rough=0.32,
                      edge_light=(0.02, 0.7, 0.4, 0.05)),
    "wood": dict(hex="#6E5B47", chisel=0.4, var=0.1, streaks=0.2, chips=0.2, scale=0.8, rough=0.8),
    "paper": dict(hex="#C2B48E", chisel=0.1, var=0.06, streaks=0.1, chips=0.0, scale=1.0, rough=0.85),
    "resin": dict(hex="#B0702C", chisel=0.1, var=0.08, streaks=0.0, chips=0.0, scale=1.0, rough=0.35),
    "ivory": dict(hex="#CFC3A3", chisel=0.3, var=0.06, streaks=0.2, chips=0.2, scale=0.8, rough=0.6,
                  edge_light=(0.02, 0.5, 0.5, 0.05)),
    "groove": dict(hex="#3A352F", chisel=0.2, var=0.05, streaks=0.0, chips=0.0, scale=1.0, rough=0.9),
}


SLAB_MATS = {"dialstone": DIAL, "chalk": CHALK, "steel": DAWN_MATS["steel"],
             "basalt": dict(hex="#4C4854", chisel=0.9, var=0.09, streaks=0.3, chips=0.6, speckle=0.35, scale=0.55, rough=0.62,
                            edge_light=(0.04, 0.55, 0.6, 0.1))}
NOON_MATS = {"dialstone": DIAL, "chalk": CHALK, "steel": DAWN_MATS["steel"]}
BELFRY_MATS = dict(DAWN_MATS)
DOME_MATS = {
    "dialstone": DIAL,
    "sandstone": dict(_SAND, brick=(0.9, 0.42, 0.02), brick_k=0.6),            # the drum: painted coursing about its axis
    "sandblock": GATE_MATS["sandblock"],
    "ironstone": _IRON,
    "iron": GATE_MATS["iron"],
    "lampresin": ST.SERENADE_MATS["lampresin"],
    "courtsand": dict(GATE_MATS["sandblock"], hex="#A18A6C"),                  # the court's flags: a step below the ribs
}


# ── build ────────────────────────────────────────────────────────────────────────────────────────────
DESIGNS = {
    # id: (builder, material spec, atlas size, AO distance)
    "shaft_drum": (shaft_drum, SHAFT_MATS, 1024, 0.6),
    "snap_stub": (snap_stub, SHAFT_MATS, 1024, 0.6),
    "dawn_arch": (dawn_arch, DAWN_MATS, 2048, 1.0),
    "lamp_gate": (lamp_gate, GATE_MATS, 2048, 1.0),
    "glass_belfry": (glass_belfry, BELFRY_MATS, 2048, 1.0),
    "lamp_dome": (lamp_dome, DOME_MATS, 2048, 1.2),
    "noon_stone": (noon_stone, NOON_MATS, 1024, 0.6),
    "vi_slab": (vi_slab, VI_MATS, 1024, 0.4),
    "numeral_xi": (lambda B, rng: numeral(B, rng, "XI"), NUM_MATS, 1024, 0.6),
    "numeral_ii": (lambda B, rng: numeral(B, rng, "II"), NUM_MATS, 1024, 0.6),
    "numeral_vii": (lambda B, rng: numeral(B, rng, "VII"), NUM_MATS, 1024, 0.6),
    "numeral_iiii": (lambda B, rng: numeral(B, rng, "IIII"), NUM_MATS, 1024, 0.6),
    "shadow_slab": (shadow_slab, SLAB_MATS, 1024, 0.5),
    "hour_stone": (hour_stone, HOUR_MATS, 1024, 0.4),
    "camp_glasshorn": (camp_glasshorn, CAMP_MATS, 512, 0.3),
    "camp_gloamoths": (camp_gloamoths, CAMP_MATS, 512, 0.3),
    "camp_strays": (camp_strays, CAMP_MATS, 512, 0.3),
    "camp_resinback": (camp_resinback, CAMP_MATS, 512, 0.3),
    "camp_stilltusks": (camp_stilltusks, CAMP_MATS, 512, 0.3),
}
SINK = {"hour_stone": HOUR_H}                # built from z 0, exported sunk: it stands on its own wall block's top
SCALE = {"lamp_dome": DOME_S}
AFTER = {"lamp_dome": dome_court}            # built after the scale (full-size pieces)
UNDERGROUND = {"numeral_xi", "numeral_ii", "numeral_vii", "numeral_iiii"}   # half buried: faces wholly under z 0 dropped


def build_one(name: str, fast: bool = False, preview: bool = False) -> dict:
    from common import export as X
    import random as _random
    scene.reset()
    col = scene.collection(name)
    fn, spec, size, ao_d = DESIGNS[name]
    B = K.Build(name, 3.0)
    rng = _random.Random(scene.seed_of(name) + 3)
    fn(B, rng)
    if name in SCALE:
        B.scale(SCALE[name])
    if name in AFTER:
        AFTER[name](B, rng)
    zmax = max(float(v[:, 2].max()) for lst in B.parts.values() for v, _, _, _ in lst)
    K.paint_set(spec, zmax)
    lamp_material()
    lamp_material("bellglow", BELL_HEX, BELL_EMIT)
    objs = B.objects(col)
    body = objs["body"]
    K.drop_hidden_bottoms(body)
    others = [o for n, o in objs.items() if n != "body"]
    buried = K.drop_buried_faces(body, others, keep_mats=("raw",))
    if name in UNDERGROUND:
        buried += drop_underground(body)
    os.makedirs(SCRATCH, exist_ok=True)
    K.bake_body(body, others, SCRATCH, name, size=512 if fast else size, samples=6 if fast else 24,
                ao_samples=16 if fast else 96, ao_distance=ao_d)
    root = bpy.data.objects.new(name, None)
    col.objects.link(root)
    for o in objs.values():
        o.parent = root
    tris = sum(len(p.vertices) - 2 for o in objs.values() for p in o.data.polygons)
    lo = np.min([np.array(o.bound_box).min(0) for o in objs.values()], 0)
    hi = np.max([np.array(o.bound_box).max(0) for o in objs.values()], 0)
    if preview:
        look(name, list(objs.values()), lo, hi, fast)
    if name in SINK:
        from mathutils import Matrix
        for o in objs.values():
            o.data.transform(Matrix.Translation((0.0, 0.0, -SINK[name])))
    path = os.path.join(OUT, f"{name}.glb")
    K.export_glb(root, path)
    raw = os.path.getsize(path)
    X.optimize(path, fighter=True)
    rep = {"id": name, "tris": tris, "size_m": [round(float(hi[0] - lo[0]), 2), round(float(hi[1] - lo[1]), 2)],
           "height": round(float(hi[2]), 2), "x": [round(float(lo[0]), 2), round(float(hi[0]), 2)], "y": [round(float(lo[1]), 2), round(float(hi[1]), 2)],
           "kb_raw": raw // 1024, "kb": os.path.getsize(path) // 1024, "texture": 512 if fast else size, "buried_faces_dropped": buried,
           "nodes": sorted(objs)}
    scene.log(f"{name}: {rep}")
    return rep


# where the gameplay camera stands relative to each landmark (it looks north, 52 deg down): the base-end
# landmarks stand beyond the map's edge, so the camera sees the Dawn Arch from the east and the Lamp Gate from the west
LOOK = {"shaft_drum": (0.0, 0.0, 11.0), "snap_stub": (0.0, 0.0, 10.0), "dawn_arch": (6.0, 0.0, 46.0), "lamp_gate": (-6.0, 0.0, 46.0),
        "glass_belfry": (4.0, 0.0, 40.0), "lamp_dome": (-4.0, 0.0, 40.0), "noon_stone": (0.0, 0.0, 22.0), "shadow_slab": (0.0, 0.0, 12.0),
        "hour_stone": (0.0, 0.0, 12.0), "vi_slab": (0.0, 0.0, 12.0),
        **{f"numeral_{g}": (0.0, 0.0, 22.0) for g in ("xi", "ii", "vii", "iiii")}, **{f"camp_{c}": (0.0, 0.0, 6.0) for c in ("glasshorn", "gloamoths", "strays", "resinback", "stilltusks")}}


def look(name, objs, lo, hi, fast):
    """A look render at the gameplay camera's pitch (52 deg, looking north), in a plain sun + sky light."""
    from mathutils import Vector
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    scene.cycles_device(sc)
    sc.cycles.samples = 12 if fast else 48
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
    gnd = bpy.data.meshes.new("gnd")
    gnd.from_pydata([(-60, -60, 0), (60, -60, 0), (60, 60, 0), (-60, 60, 0)], [], [(0, 1, 2, 3)])
    g = bpy.data.objects.new("gnd", gnd)
    gm = bpy.data.materials.new("gnd")
    gm.use_nodes = True
    gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.09, 0.09, 0.1, 1)
    gnd.materials.append(gm)
    sc.collection.objects.link(g)
    dx, dy, dist = LOOK[name]
    focus = Vector(((lo[0] + hi[0]) / 2 + dx, (lo[1] + hi[1]) / 2 + dy, 0.0))
    pitch = math.radians(52)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    cam.data.lens = 35
    cam.location = focus + Vector((0, -math.cos(pitch) * dist, math.sin(pitch) * dist))
    cam.rotation_euler = (focus - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam
    os.makedirs(RENDERS, exist_ok=True)
    sc.render.filepath = os.path.join(RENDERS, f"landmarks_art2_{name}.png")
    bpy.ops.render.render(write_still=True)
    for o in (sun, g, cam):
        bpy.data.objects.remove(o)


def main():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--only", default="")
    p.add_argument("--fast", action="store_true")
    p.add_argument("--preview", action="store_true")
    a = p.parse_args(scene.script_args())
    os.makedirs(OUT, exist_ok=True)
    rp = os.path.join(RENDERS, "build_report_landmarks_art2.json")
    rep = scene.read_json(rp, {}) or {}
    for name in DESIGNS:
        if a.only and name not in a.only.split(","):
            continue
        rep[name] = build_one(name, a.fast, a.preview)
        scene.write_json(rp, rep)


if __name__ == "__main__":
    main()
