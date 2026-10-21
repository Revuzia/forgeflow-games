"""Burdam's cleaver: one outline shared by the sculpt (fighters/burdam.py) and the plate fix
(proto/burdam_plates.py). numpy only (no bpy), so both the repo venv and Blender import it.

The cleaver lives in its own 2D frame: u along the blade axis (0 = the guard, where the haft enters the
heel; + toward the tip), v across it (+ = the notched spine, - = the cutting edge), w through the blade.
Measured on the concept (front plate, mask crown 2.15 m, 10 cm grid; the run profiles across the axis
every 4 cm, + the 9 px the cut erodes): the blade 1.43 m from the guard to the tip, 0.22-0.26 m wide,
the heel collar (ironstone) from the guard to u 0.43, a short wrapped haft (0.35 m painted) and a
diamond pommel. The heel's spine carries five chevron notches (V cuts 8 cm wide, 6 cm deep: tallies),
each holding one accent slab (a diamond nested in the V; brief section 4/7). No accent on the pommel.

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
OFF_GRIP = -0.30          # the off hand's grip along the haft from the main fist (two-handed swings, plants)
HAFT_U0 = -0.57           # game haft end (pommel joint)
POMMEL_U = -0.62          # game pommel centre
PAINT_HAFT_SCALE = 0.35 / 0.62    # painted pommel centre at u -0.35
PAINT_HAFT_BEND = 0.055 / 0.35    # the painted haft drops 5.5 cm below the axis at the pommel

# blade outline (u, v): the cutting edge (with two chips near the heel) and the spine, guard -> tip
EDGE = [(0.20, -0.100), (0.45, -0.102), (0.58, -0.100), (0.61, -0.078), (0.635, -0.100), (0.70, -0.098),
        (0.74, -0.074), (0.765, -0.094), (0.90, -0.088), (1.05, -0.082), (1.15, -0.072), (1.22, -0.055),
        (1.29, -0.028), (1.36, -0.008), (1.437, 0.012)]
SPINE = [(0.30, 0.118), (0.50, 0.126), (0.64, 0.134), (0.76, 0.146), (0.90, 0.160), (1.00, 0.166),
         (1.03, 0.150), (1.10, 0.150), (1.20, 0.128), (1.28, 0.094), (1.36, 0.048), (1.437, 0.012)]
# the heel collar: guard -> along the edge side -> the concave front toward the blade -> the spine end
HEEL = [(-0.050, 0.128), (-0.040, 0.020), (-0.020, -0.070), (0.020, -0.108), (0.15, -0.112), (0.25, -0.110),
        (0.30, -0.060), (0.35, 0.000), (0.40, 0.060), (0.440, 0.122)]
HEEL_SPINE_V = 0.122
# five chevron notches (u of the V's apex) cut into the heel's spine: 8 cm wide at the spine, 6 cm deep
NOTCHES = [0.000, 0.088, 0.176, 0.264, 0.352]
NOTCH_HALF_W = 0.040
NOTCH_DEPTH = 0.060
# the accent slab nested in each notch (u, v of its centre, half-diagonal along u, across v): its upper
# half fills the V's bottom, its lower half is set into the heel (a recess on both faces)
GEMS = [(nu, HEEL_SPINE_V - NOTCH_DEPTH + 0.002, 0.044, 0.040) for nu in NOTCHES]
POMMEL_INSET = (0.044, 0.038)             # the carved (not lit) diamond recess on the pommel plate


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


def notch_polys() -> list:
    """the V cuts as triangles (u, v), opened 3 cm above the spine so they cut cleanly through it"""
    out = []
    a = HEEL_SPINE_V - NOTCH_DEPTH
    k = NOTCH_HALF_W / NOTCH_DEPTH
    top = HEEL_SPINE_V + 0.03
    for nu in NOTCHES:
        out.append([(nu, a), (nu + k * (top - a), top), (nu - k * (top - a), top)])
    return out


def notch_liners(width: float = 0.015, into: float = 0.002) -> list:
    """the accent band lining both walls of each V notch (u, v quads): `width` into the heel from the wall,
    `into` past it into the cut, so the wall faces the camera and sky see are lit"""
    out = []
    a = HEEL_SPINE_V - NOTCH_DEPTH
    k = NOTCH_HALF_W / NOTCH_DEPTH
    h = HEEL_SPINE_V - a
    for nu in NOTCHES:
        A = np.array([nu, a])
        for sgn in (-1.0, 1.0):
            T = np.array([nu + sgn * k * h, HEEL_SPINE_V])
            w = (T - A) / np.linalg.norm(T - A)
            n = np.array([sgn * w[1], -sgn * w[0]])          # away from the notch, into the heel
            if np.dot(n, np.array([0.0, -1.0])) < 0 and abs(n[0]) < 1e-9:
                n = -n
            if np.dot(n, A + 0.5 * (T - A) - np.array([nu, HEEL_SPINE_V])) < 0:
                n = -n
            p0, p1 = A - n * into - w * 0.004, T - n * into + w * 0.004
            out.append([tuple(p0), tuple(p1), tuple(p1 + n * (width + into)), tuple(p0 + n * (width + into))])
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
