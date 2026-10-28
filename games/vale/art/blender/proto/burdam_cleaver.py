"""Burdam's cleaver: one outline shared by the sculpt (fighters/burdam.py) and the plate fix
(proto/burdam_plates.py). numpy only (no bpy), so both the repo venv and Blender import it.

The cleaver lives in its own 2D frame: u along the blade axis (0 = the guard, where the haft enters the
heel; + toward the tip), v across it (+ = the notched spine, - = the cutting edge), w through the blade.
Measured on the concept (front plate, mask crown 2.15 m, 10 cm grid; the run profiles across the axis
every 4 cm, + the 9 px the cut erodes): the blade 1.43 m from the guard to the tip, 0.22-0.26 m wide,
the heel (ironstone) a broad crenellated spine band from the guard to u 0.60, a short wrapped haft (0.35 m
painted) and a diamond pommel. The heel's spine carries five scalloped notches (round bites 7.4 cm across,
4.6 cm deep: tallies) with one accent diamond inlaid below each (brief section 4/7), and the concept's blue gem in
the pommel (fix pass 6).

PROP SPACE (rig.prop_matrix): grip at the origin, +Z along the cleaver (u), +Y the spine (v; so the
edge faces -Y, the rig convention), +X = w. The game haft is longer than the painted one (0.62 m to the
pommel's centre against 0.35 m: the brief's long two-handed haft, the off hand 0.30 m below the main one);
the paint pose squeezes it back.

PAINT POSE: where the concept paints the cleaver (behind the head, the haft over the right shoulder):
world (x, z) = G + u * AX + v * NV, world y = Y_PAINT[part] - w (w > 0 faces the front plate).
"""
from __future__ import annotations

import numpy as np

# paint frame (world x, z): the guard and the axis toward the tip (27.8 degrees above horizontal)
G = np.array([-0.45, 1.895])
_T = np.array([0.80, 2.553])
AX = (_T - G) / np.linalg.norm(_T - G)
NV = np.array([-AX[1], AX[0]])
Y_PAINT = {"blade": 0.21, "heel": 0.21, "gems": 0.21, "haft": 0.34, "pommel": 0.34}

U_GRIP = -0.15            # the main fist on the haft (u); the off hand OFF_GRIP lower
OFF_GRIP = -0.17          # the off hand's grip along the haft from the main fist (two-handed swings, plants)
HAFT_U0 = -0.40           # game haft end (pommel joint): the concept's short wrapped haft (Burdam's arms are
POMMEL_U = -0.45          # short; a longer tail drove the pommel into his belly in every two-handed chop)
PAINT_HAFT_SCALE = 0.35 / 0.45    # painted pommel centre at u -0.35
PAINT_HAFT_BEND = 0.055 / 0.35    # the painted haft drops 5.5 cm below the axis at the pommel

# blade outline (u, v): the cutting edge (with two chips near the heel) and the spine, guard -> tip
EDGE = [(0.20, -0.100), (0.45, -0.102), (0.58, -0.100), (0.61, -0.078), (0.635, -0.100), (0.70, -0.098),
        (0.74, -0.074), (0.765, -0.094), (0.90, -0.088), (1.05, -0.082), (1.15, -0.072), (1.22, -0.055),
        (1.29, -0.028), (1.36, -0.008), (1.437, 0.012)]
SPINE = [(0.30, 0.118), (0.50, 0.126), (0.64, 0.134), (0.76, 0.146), (0.90, 0.160), (1.00, 0.166),
         (1.03, 0.150), (1.10, 0.150), (1.20, 0.128), (1.28, 0.094), (1.36, 0.048), (1.437, 0.012)]
# the heel: a broad carved ironstone SPINE BAND over the blade's back, from the haft collar along ~40 % of
# the blade (the concept's dark crenellated spine), its lower edge sweeping up to the spine at u 0.60;
# the pale honed blade shows below it
HEEL = [(-0.050, 0.130), (-0.042, 0.020), (-0.022, -0.068), (0.020, -0.108), (0.13, -0.112), (0.22, -0.108),
        (0.30, -0.086), (0.38, -0.072), (0.46, -0.058), (0.52, -0.030), (0.56, 0.020), (0.585, 0.080),
        (0.605, 0.134), (0.30, 0.134)]
HEEL_SPINE_V = 0.132
# five scalloped notches (the concept's crenellations: round bites between flat merlons, 7.4 cm across at the
# spine and 4.6 cm deep), u of each bite's centre
NOTCHES = [0.035, 0.143, 0.251, 0.359, 0.467]
NOTCH_HALF_W = 0.037
NOTCH_DEPTH = 0.046
# the accent slab under each notch: a diamond inlay (u, v of its centre, half-diagonal along u, across v),
# set flush in the ironstone a little below the bite (the concept's blue diamonds), rising toward the tip
# fix pass 3: ONE accent mark per notch (the review read the old diamonds + bite floors as a 10-cell checker):
# the bite's floor filled with an ember core (CORE_FILL deep) and a tall diamond hanging from it, its top point
# in the core, so each notch reads as one blue spade along the spine (five marks, 3.8 cm of stone between)
# fix pass 5: the cores are gone (core + diamond still read as ten cells, a zipper); FIVE diamonds, a size up, each
# with its top point just into its bite's floor (the lit notch), 2.8 cm of ironstone between them
CORE_FILL = 0.028
POMMEL_INSET = (0.044, 0.038)             # (pass 5) the carved diamond recess on the pommel plate


def notch_circle(nu: float) -> tuple:
    """the bite as a circle (u, v centre, radius) whose chord at the spine is 2 * NOTCH_HALF_W"""
    c, d = NOTCH_HALF_W, NOTCH_DEPTH
    r = (c * c + d * d) / (2 * d)
    return nu, HEEL_SPINE_V - d + r, r


def blade_poly() -> list:
    return list(EDGE) + list(reversed(SPINE[:-1]))


def v_edge(u):
    e = np.array(EDGE)
    return np.interp(u, e[:, 0], e[:, 1])


def v_spine(u):
    s = np.array(SPINE)
    return np.interp(u, s[:, 0], s[:, 1], left=s[0, 1])


def sd_polygon(u, v, poly) -> np.ndarray:
    """Signed distance to a closed polygon in the (u, v) plane (negative inside), vectorised."""
    P = np.asarray(poly, dtype=np.float64)
    pu, pv = np.asarray(u, dtype=np.float64), np.asarray(v, dtype=np.float64)
    d = (pu - P[0, 0]) ** 2 + (pv - P[0, 1]) ** 2
    s = np.ones_like(pu)
    n = len(P)
    for i in range(n):
        a, b = P[i], P[(i - 1) % n]
        eu, ev = b[0] - a[0], b[1] - a[1]
        wu, wv = pu - a[0], pv - a[1]
        t = np.clip((wu * eu + wv * ev) / (eu * eu + ev * ev + 1e-12), 0.0, 1.0)
        bu, bv = wu - eu * t, wv - ev * t
        d = np.minimum(d, bu * bu + bv * bv)
        c1 = pv >= a[1]
        c2 = pv < b[1]
        c3 = eu * wv > ev * wu
        flip = (c1 & c2 & c3) | (~c1 & ~c2 & ~c3)
        s = np.where(flip, -s, s)
    return s * np.sqrt(d)


def notch_cores(fill: float = 0.022, n: int = 16) -> list:
    """the accent core sitting in the bottom of each bite (u, v polygons): the circle segment below
    `fill` above the bite's deepest point (an ember set in the cut; brief section 7)"""
    out = []
    for nu in NOTCHES:
        cu, cv, r = notch_circle(nu)
        vb = cv - r
        h = vb + fill
        a = np.arccos(np.clip((h - cv) / r, -1, 1))       # angle from +v of the chord's ends
        ts = np.linspace(-np.pi / 2 - (np.pi - a), -np.pi / 2 + (np.pi - a), n)
        ts = np.linspace(np.pi / 2 + a, np.pi / 2 + 2 * np.pi - a, n)
        pts = [(cu + r * np.cos(t), cv + r * np.sin(t)) for t in ts]
        out.append(pts)
    return out


def notch_floors(proud: float = 0.005, into: float = 0.010, n: int = 18) -> list:
    """the accent set in each bite's FLOOR (u, v polygons): an arc band following the bite's curve below its
    chord, `proud` of the stone into the bite and `into` the heel; seen from above the spine it is a glowing
    floor in the cut, from the blade's face only a thin glowing arc (brief section 7: the accent in the notches)"""
    out = []
    for nu in NOTCHES:
        cu, cv, r = notch_circle(nu)
        a = np.arcsin(np.clip((HEEL_SPINE_V - cv) / r, -1.0, 1.0))      # the chord ends' angle
        ts = np.linspace(np.pi - a, 2 * np.pi + a, n)                   # the lower arc, left end to right end
        outer = [(cu + (r + into) * np.cos(t), cv + (r + into) * np.sin(t)) for t in ts]
        inner = [(cu + (r - proud) * np.cos(t), cv + (r - proud) * np.sin(t)) for t in ts[::-1]]
        out.append(outer + inner)
    return out


GEM_INSET_A, GEM_INSET_B = 0.047, 0.072   # polish pass: 4.2 -> 4.7 cm along u (9.4 cm, 1.4 cm of ironstone between
                                          # them): the steeper idle carry shows the heel's flat less from the game
                                          # camera (three QA accent 1.65 -> 1.28 %, the gate is 1.5)
                                          # fix pass 8: the inlay diamonds' half-diagonals (along u, across v): the
                                          # bite-floor linings are gone (the review: lining + diamond = a 10-mark
                                          # two-row checker), so the five diamonds carry the accent alone, a size up
                                          # (8.4 x 14.4 cm, 2.4 cm of ironstone between them; the band's narrowing
                                          # end shortens the last two)
GEM_GAP = 0.010                           # the dark stone left between a bite's floor and its inlay's top point
GEM_EDGE = 0.016                          # ... and between an inlay's bottom point and the band's lower edge
POMMEL_GEM = (0.068, 0.059)               # the pommel's blue diamond (the concept's gem pommel), half-diagonals
                                          # (polish: a step up from 0.062 x 0.054 with the inlays, the accent gate)
                                          # (fix pass 8: a size up, inside the plate's 0.080 x 0.070)


def heel_low(u):
    """the heel band's lower edge (v) at u"""
    h = np.array(HEEL[:13])
    return np.interp(u, h[2:12, 0], h[2:12, 1])


def gem_polys() -> list:
    """ONE diamond inlay under each notch (u, v polygons), set IN the dark band with stone all round it: its top
    point GEM_GAP under the bite's floor, its bottom point at least GEM_EDGE above the band's lower edge (the last
    notch, where the band narrows toward the tip, takes a shorter diamond)"""
    out = []
    for nu in NOTCHES:
        cu, cv, r = notch_circle(nu)
        top = cv - r - GEM_GAP
        b = min(GEM_INSET_B, 0.5 * (top - (heel_low(nu) + GEM_EDGE)))
        vc = top - b
        out.append([(nu, vc + b), (nu - GEM_INSET_A, vc), (nu, vc - b), (nu + GEM_INSET_A, vc)])
    return out


def notch_polys(n: int = 24) -> list:
    """the scalloped bites as polygons (u, v) (circles, opened above the spine so they cut cleanly)"""
    out = []
    for nu in NOTCHES:
        cu, cv, r = notch_circle(nu)
        out.append([(cu + r * np.cos(t), cv + r * np.sin(t)) for t in np.linspace(0, 2 * np.pi, n, endpoint=False)])
    return out


def in_heel(u, v) -> np.ndarray:
    d = sd_polygon(u, v, HEEL)
    for tri in notch_polys():
        d = np.maximum(d, -sd_polygon(u, v, tri))
    return d < 0


def in_blade(u, v) -> np.ndarray:
    return sd_polygon(u, v, blade_poly()) < 0


def to_uv(x, z):
    """paint-pose world (x, z) -> cleaver (u, v)"""
    rx, rz = np.asarray(x) - G[0], np.asarray(z) - G[1]
    return rx * AX[0] + rz * AX[1], rx * NV[0] + rz * NV[1]


def paint_xyz(part: str, u, v, w) -> np.ndarray:
    """cleaver (u, v, w) of a GAME vertex -> its paint-pose world position (haft and pommel squeezed back
    to the painted length and bent the way the concept draws them)."""
    u, v, w = (np.asarray(a, dtype=np.float64) for a in (u, v, w))
    if part in ("haft", "pommel", "gems"):
        un = np.where(u < 0, u * PAINT_HAFT_SCALE, u)
        v = v + np.minimum(un, 0.0) * PAINT_HAFT_BEND
        u = un
    x = G[0] + u * AX[0] + v * NV[0]
    z = G[1] + u * AX[1] + v * NV[1]
    y = Y_PAINT.get(part, 0.21) - w
    return np.stack([x, y, z], axis=-1)
