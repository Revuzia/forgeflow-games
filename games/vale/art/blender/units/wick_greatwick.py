"""greatwick: the siege Wick (1.5 m). A broad back-lantern on a frame and a heavy hammer; it lobs light at structures.

    Blender -b --factory-startup --python-exit-code 1 --python art/blender/units/wick_greatwick.py -- [--faction aubade|serenade|both|legacy] [--fast] [--clip-sheet]

Builds greatwick_aubade + greatwick_serenade (default: both) into art/out/units/; `--faction legacy` rebuilds
today's greatwick.glb (frozen). Brief: _design/units/wicks.md (§0 hard rules, §3.3 greatwick, §4 accent).
Concepts: _design/concept/wicks/greatwick_{aubade,serenade}.webp. Shared code: wick_common.py (not forked:
the greatwick-only helpers live here). Progress log: art/renders/units/_wick_greatwick_progress.md.

ART 2.0 (HANDOFF "Art 2.0 method", reference fighters/marund.py):
  1. plates   ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/wick_greatwick_plates.py
              (hand-set frames: the shared cut put the Aubade sole row at 1285 and the top on the lantern)
  2. fit      Blender ... --python art/blender/proto/wick_greatwick_fit.py -- --faction aubade|serenade
  3. build    this script (the graded plates + top plates are made on the way, cached)

CONCEPT SPACE vs MODEL SPACE. Each faction is sculpted where its concept paints it (concept space: metres on
the plate frame, so the fit overlay is pixel-true), then each part is moved into the SHARED model layout by a
small warp (`to_model`), because the two sheets disagree with each other and with the brief:
  * Aubade: the hood is re-centred (the sheet draws it 2 cm off axis). The back-lantern is built in MODEL space
    (`lantern_aubade`, AUB_LANT): a dawnglass lantern 0.57 x 0.33 m (0.63 with the eave: the brief's 0.62, wider than
    the shoulders), 0.92-1.535 m, one frosted pane per face with a domed oval accent core (no mullions).
  * Serenade: the sheet's whole upper body stands 13 cm taller than Aubade's (hood crown 1.33 m): the body is
    lowered (z 0.15-1.33 -> 0.15-1.25, a lower, broader dome as the brief asks) and narrowed 6 %. The drum is built
    in MODEL space (`lantern_serenade`, SER_DRUM): 0.72 x 0.45 m, seated over the shoulders (its front on the
    collar's back): two heavy block-cut ironstone courses (exact carved hulls), eight lampresin panes behind
    ironstone posts each framing one domed accent core, a low tan felt lid with four crossed dark straps (fix round
    3); on an A-frame of walnut posts down the built back to the belt with two yokes, a strapped felt PACK filling the
    back under it (fix 5: the side view is one load on the back, not a lamp on stilts).
  * Parts sculpted directly in model space (sleeves, mitts: the rest pose is symmetric, the sheet's arms are
    not) carry the opposite map (`to_concept`).
The projection pass inverts every warp (the PAINT POSE: vertices go back to where the concept paints them for
the paint pass only; the burdam cleaver's trick, done here as a project.paint_object wrapper keyed by the
spec's PROJECTION), so the painting lands exactly while the silhouette follows the shared layout.

Paint (same wrapper): the projection paints the CLOAKS only, as HYBRID cloth (gw_hybrid): the sheet where it is
the part's own paint (never ghost colours: gw_exclude CIE Lab tests) and seen square on, a procedural cloth fill
wherever it grazes, was occluded or excluded (nearest-filled, those texels smeared into streaks and seams), the
sculpt's own folds painted over both, the Serenade hem rolls / belt in their own felt. Per-part / per-zone TINTS
move the projected median onto the palette role (the Aubade slate hem band is a zone). Everything else is
PROCEDURAL-PAINTERLY (gw_proc: palette hex with the sheet's value structure; stone mottle / cracks / chips / block
courses, wood grain, felt nap, linen weave and hem lines, sleeve cuffs and wraps, finger lines, dawnglass margins),
with edge wear and cavities read from each part's own SDF (_edges). Dark channels are painted either side of the
accent seams / crown band (gw_halo) so the team light holds value contrast. INK fills the hood hollows; value ramps
darken the Aubade's feet band.
Accent (§4): hood light (fix round 3: ONE smooth UV-ellipsoid core in the MIDDLE of the hollow, 8 cm back, wider than
tall, dark hollow above, below and to both sides; its soft falloff is a dim see-through LINING of light over the
hollow's deep half: the wide low lens of fix 5 read as a tongue in an open mouth; roughness 1 in the GLB: no glint),
the hood mark (Aubade seam / Serenade crown band: an exact ribbon arching close over the opening, in a dark bed), the
back-lantern (Aubade: an oval core on each pane + the roof light well; Serenade: a domed core on each of the 8
lampresin panes; both with one see-through glow fan round each core), the Aubade stole clasp. The see-through parts
are a second material renamed `accent` and alpha-blended in the GLB (glb_metallic_zero), so the renderer tints them
per viewer with the cores. The Serenade hammer window is lampresin, not accent. No lid oculus (it read as a gem).

EXACT GAME MESHES (fix 4): hard carved props are convex HULLS (meta low_hulls: `hull_sp`, `carved_block`,
`prism_block`, `oval_disc`): the Aubade hammer head (a waist block + two stepped wedge striking blocks, chamfered,
two corners broken) and its lashing (a wrap band + flat X straps that stay on the faces), the pommel, the lantern
posts and cores, the lenses; flat shaded, their SDF field still drives the paint's edge wear. Decimated SDF versions
went soft (a pillow) or collapsed thin straps into blades.

Motion: every clip is checked against the real game mesh skinned in numpy (`_Ground`; probe:
proto/wick_greatwick_motion.py): the run's planted boots sit exactly on the ground and the bell never cuts it (a
4.6-4.8 cm heave, hips roll 10, chest 5.8 deg); attack1 (fix 5) is ONE continuous arc on a C1 key spline
(`_KeySpline`, head roll transported along the haft: `_roll_ups`): a slow hoist up the front and over the right
shoulder (outboard of the lantern), a hang, a slam over the top 2.7x faster than the hoist, the head falling to the
ground in front; the death (fix 5) solves the body onto the ground first, then lets the hammer fall under gravity
and lie ON the ground, the fists going down beside the body (blended, no IK switch in a key).

Rule 0.1 (no tall, pointed or conical hood): the Aubade cowl is a broad helmet dome (`helmet`, a superellipse
lathe) under a ROUND ball knob (4.5 % of the figure); the lantern's four corner spires stand at the roof corners,
never behind the hood's axis.
"""
from __future__ import annotations

import math
import os
import sys
from dataclasses import dataclass, field

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import wick_common as wc  # noqa: E402
from wick_common import (Capsule, Ellipsoid, HalfSpace, Lathe, RoundBox, RoundCone, Sculpt, Sphere, Torus,  # noqa: E402
                         anim, fighter, materials, np, rig, scene, sdf)

FlatCapsule, Tube = sdf.FlatCapsule, sdf.Tube
NOISE = sdf.Noise(29)
VOXEL = 0.0075
# concept-space plate heights (the row `top` of each plate: Aubade roof slab top, Serenade drum lid top)
PLATE_HEIGHT = {"aubade": 1.52, "serenade": 1.56}
CONCEPT = {f: f"wicks/greatwick_{f}" for f in ("aubade", "serenade")}


# ── warps (concept space <-> model space) ────────────────────────────────────────────────────────────
def _arr(P):
    return np.asarray(P, dtype=np.float64).reshape(-1, 3)


def shift(dx=0.0, dy=0.0, dz=0.0):
    d = np.array([dx, dy, dz])
    return lambda P: _arr(P) + d


def scale_about(c, s):
    """Scale about point c by s = (sx, sy, sz)."""
    c, s = np.asarray(c, float), np.asarray(s, float)
    return lambda P: (_arr(P) - c) * s + c


def zmap(pts):
    """Piecewise-linear remap of z: pts = [(z_in, z_out), ...] (extrapolated with the end slopes)."""
    zi = np.array([p[0] for p in pts], float)
    zo = np.array([p[1] for p in pts], float)

    def f(P):
        P = _arr(P).copy()
        z = P[:, 2]
        out = np.interp(z, zi, zo)
        lo, hi = z < zi[0], z > zi[-1]
        out[lo] = zo[0] + (z[lo] - zi[0]) * (zo[1] - zo[0]) / (zi[1] - zi[0])
        out[hi] = zo[-1] + (z[hi] - zi[-1]) * (zo[-1] - zo[-2]) / (zi[-1] - zi[-2])
        P[:, 2] = out
        return P
    return f


def compose(*fs):
    def f(P):
        P = _arr(P)
        for g in fs:
            P = g(P)
        return P
    return f


def invert(f, iters: int = 40):
    """Numerical inverse of a near-identity warp (fixed point P <- P - (f(P) - Q); |f' - 1| < 1)."""
    def g(Q):
        Q = _arr(Q)
        P = Q.copy()
        for _ in range(iters):
            P = P - (f(P) - Q)
        return P
    return g


def limb_offset(a, b, d):
    """Model -> concept for a limb sculpted in model space: points move by `d` scaled by their fraction
    along a -> b (0 at the shoulder, 1 at the wrist and beyond)."""
    a, b, d = (np.asarray(v, float) for v in (a, b, d))
    ab = b - a

    def f(P):
        P = _arr(P)
        t = np.clip((P - a) @ ab / (ab @ ab), 0.0, 1.0)
        return P + t[:, None] * d
    return f


# ── sculpt helpers ─────────────────────────────────────────────────────────────────────────────────────
@dataclass
class SP:
    """One sculpted part: mesh `S` (in concept space when `to_model` is given), material `role`, `bind`."""
    name: str
    S: Sculpt
    role: str
    bind: object
    tris: int
    vs: float = 1.0
    to_model: object = None          # concept -> model (applied to the mesh)
    to_concept: object = None        # model -> concept (the paint pose); default: invert(to_model)
    meta: dict = field(default_factory=dict)

    def paint_pose(self):
        if self.to_concept is not None:
            return self.to_concept
        if self.to_model is not None:
            return invert(self.to_model)
        return None


def field_of(S: Sculpt):
    return sdf.Blend([(o, p, k) for o, p, k, _ in S.ops])


def onto(S: Sculpt, pts, lift: float = 0.0, iters: int = 8, eps: float = 1e-3):
    """Move points onto the surface of S (+ lift along the normal)."""
    B = field_of(S)
    P = _arr(pts).copy()
    for _ in range(iters):
        d = B.d(P)
        g = np.stack([(B.d(P + e) - B.d(P - e)) / (2 * eps) for e in np.eye(3) * eps], axis=1)
        g /= np.linalg.norm(g, axis=1, keepdims=True) + 1e-9
        P = P - (d - lift)[:, None] * g
    return P


def folds(amp, freq, cx=0.0, cy=0.0, phase=0.0, zfade=None, warp=0.8, smooth=False):
    """Vertical cloth folds around the (cx, cy) axis; optionally deepening downward (zfade = (z_top, z_full)).
    The returned displacement has `.ridge(P)` -> (|u| 0 = the bottom of a valley .. 1 = a ridge crest, depth
    0.2..1): the paint pass shades the same folds the sculpt carved (lit crests, dark crease lines).
    smooth: rounded valleys too (a sine, soft gathered felt) instead of sharp creases (|sine|: pleated wool)."""
    def ridge(P):
        a = np.arctan2(P[:, 1] - cy, P[:, 0] - cx)
        t = a * freq + phase + warp * NOISE(P, 3.0)
        u = 0.5 + 0.5 * np.sin(2 * t) if smooth else np.abs(np.sin(t))
        f = np.ones(len(P))
        if zfade is not None:
            z0, z1 = zfade
            f = np.clip((z0 - P[:, 2]) / (z0 - z1), 0.2, 1.0)
        return u, f

    def fn(P):
        u, f = ridge(P)
        return amp * f * (u * 2 - 1) * -0.5
    fn.ridge = ridge
    fn.smooth = smooth
    return fn


AUB_FOLDS = folds(0.021, 9, cx=-0.01, zfade=(0.80, 0.30))        # long straight folds, deepest at the hem
SER_FOLDS = folds(0.020, 6, zfade=(0.58, 0.22), warp=0.35, smooth=True)   # soft gathered felt folds under the belt


def bell(c, prof_pts, depth: float, z0: float, z1: float, rmax: float):
    """A Lathe whose radius follows prof_pts [(z, r)] (linear), squashed to `depth` x along Y."""
    zs = np.array([p[0] for p in prof_pts])
    rs = np.array([p[1] for p in prof_pts])

    def prof(r, z):
        rr = np.interp(z, zs, rs)
        return np.maximum(np.maximum(r - rr, z0 - z), z - z1) * 0.9
    return Lathe(c, prof, rmax, z0 - 0.01, z1 + 0.01, axes=np.diag([1.0, 1.0 / depth, 1.0]))


def helmet(c, a, b, h, n=3.0):
    """A superellipsoid of revolution about Z through c: radius a in X, b in Y, half height h, exponent n
    (n = 2 an ellipsoid; larger = broader shoulders and a flatter top, a helmet rather than an egg)."""
    def prof(r, z):
        q = ((r / a) ** n + (np.abs(z) / h) ** n) ** (1.0 / n)
        return (q - 1.0) * min(a, h) * 0.9
    # (Lathe.bounds maps rmax through the axes, which shrinks Y when b > a: pad rmax so the box covers b)
    return Lathe(c, prof, max(a, b) * max(1.0, b / a) * 1.05, -h * 1.05, h * 1.05, axes=np.diag([1.0, a / b, 1.0]))


def capelet(c, z_top, r_top, z_bot, r_bot, thick, depth=1.0, power=0.6):
    """A thick shell of revolution whose radius grows fast under z_top and slowly toward z_bot
    (r = r_top + (r_bot - r_top) * u ** power, u = 0 at the top): rounded shoulders, not a cone."""
    def prof(r, z):
        u = np.clip((z_top - z) / (z_top - z_bot), 0, 1)
        rr = r_top + (r_bot - r_top) * u ** power
        d = np.abs(r - (rr - thick * 0.5)) - thick * 0.5
        return np.maximum(np.maximum(d, z_bot - z), z - z_top) * 0.8
    return Lathe(c, prof, r_bot + 0.05, z_bot - 0.02, z_top + 0.02, axes=np.diag([1.0, 1.0 / depth, 1.0]))


class TaperEllipsoid(sdf.Prim):
    """An ellipsoid (radii rx, ry, rz about c) whose X half-width scales with height: x / s(z), s = 1 - taper *
    (z - cz) / rz, so it narrows upward (taper > 0): the sheet's hood opening, a rounded arch over a wider sill
    (a plain wide ellipse read as a gaping mouth)."""

    def __init__(self, c, radii, taper):
        self.c = np.asarray(c, float)
        self.r = np.asarray(radii, float)
        self.t = float(taper)

    def bounds(self):
        h = self.r * np.array([1.0 + abs(self.t), 1.0, 1.0])
        return self.c - h, self.c + h

    def d(self, P):
        p = _arr(P) - self.c
        s = np.clip(1.0 - self.t * p[:, 2] / self.r[2], 0.3, 2.0)
        q = p.copy()
        q[:, 0] /= s
        k0 = np.linalg.norm(q / self.r, axis=1)
        k1 = np.linalg.norm(q / (self.r * self.r), axis=1)
        return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9) * np.minimum(s, 1.0)

    def ring(self, n: int, grow: float = 1.0, y: float | None = None):
        """n points round the opening's outline (XZ), scaled about its centre by `grow`."""
        t = np.linspace(0, 2 * np.pi, n + 1)[:-1]
        z = self.r[2] * grow * np.sin(t)
        s = 1.0 - self.t * z / self.r[2]
        x = self.r[0] * grow * s * np.cos(t)
        yy = np.full(n, self.c[1] if y is None else y)
        return np.stack([self.c[0] + x, yy, self.c[2] + z], 1)


class Shell(sdf.Prim):
    """The skin of a field F between the levels lo and hi (F in [lo, hi]: a layer laid on, or sunk into, F's
    surface): d = |F - mid| - half. Intersected with an outline it makes bands, rims and inlays that hug a curved
    surface exactly (tubes laid on a dome by `onto` cut in and out of it once decimated). `box` = (lo, hi) bounds
    of the region the outline keeps (the grid only covers that)."""

    def __init__(self, F, lo, hi, box):
        self.F, self.lo, self.hi = F, float(lo), float(hi)
        self.box = (np.asarray(box[0], float), np.asarray(box[1], float))

    def bounds(self):
        return self.box

    def d(self, P):
        return np.abs(self.F.d(_arr(P)) - (self.lo + self.hi) / 2) - (self.hi - self.lo) / 2


class PolyDist(sdf.Prim):
    """Distance to a polyline, minus w: the outline of a strip of width 2w along it (intersect a Shell)."""

    def __init__(self, pts, w):
        self.p = _arr(pts)
        self.w = float(w)

    def bounds(self):
        return self.p.min(0) - self.w, self.p.max(0) + self.w

    def d(self, P):
        P = _arr(P)
        best = np.full(len(P), 1e9)
        for a, b in zip(self.p[:-1], self.p[1:]):
            ab = b - a
            t = np.clip((P - a) @ ab / max(ab @ ab, 1e-12), 0, 1)
            best = np.minimum(best, np.linalg.norm(P - (a + t[:, None] * ab), axis=1))
        return best - self.w


class AngleSlab(sdf.Prim):
    """|z - zc(angle)| - w round a vertical axis through (cx, cy): a band whose height follows a curve round
    the axis (the Serenade crown band arching over the opening)."""

    def __init__(self, cx, cy, zc, w, box):
        self.cx, self.cy, self.zc = cx, cy, zc
        self.w = w if callable(w) else float(w)          # (a half width, or a function of the angle)
        self.box = (np.asarray(box[0], float), np.asarray(box[1], float))

    def bounds(self):
        return self.box

    def d(self, P):
        P = _arr(P)
        a = np.arctan2(P[:, 1] - self.cy, P[:, 0] - self.cx)
        return np.abs(P[:, 2] - self.zc(a)) - (self.w(a) if callable(self.w) else self.w)


class VPrism(sdf.Prim):
    """A downward-pointing tab outline (a prism along Y): half-width hw at z_top narrowing to a point at z_tip,
    centred on x0. Approximate distance (fine for meshing)."""

    def __init__(self, x0, z_top, z_tip, hw, y0=-1.0, y1=1.0):
        self.x0, self.zt, self.zp, self.hw = float(x0), float(z_top), float(z_tip), float(hw)
        self.y0, self.y1 = float(y0), float(y1)

    def bounds(self):
        return (np.array([self.x0 - self.hw, self.y0, self.zp]), np.array([self.x0 + self.hw, self.y1, self.zt]))

    def d(self, P):
        P = _arr(P)
        h = self.zt - self.zp
        side = (np.abs(P[:, 0] - self.x0) * h - (P[:, 2] - self.zp) * self.hw) / math.hypot(h, self.hw)
        return np.maximum.reduce([side, P[:, 2] - self.zt, self.zp - P[:, 2]])


class Arch(sdf.Prim):
    """A hood opening: a rounded ARCH outline (a flat bottom with rounded corners, straight sides flaring a little
    toward the bottom, an elliptical top) in a plane LEANED BACK by `lean` degrees (the opening faces forward and
    up, so the 52-degree game camera sees into the hollow instead of the brow), extruded along the plane's normal
    from w0 to w1 (w = depth INTO the hood; the back end rounded by `kb`). Frame rows U (+X), V (up the plane),
    W (into the hood: back and down). `d2(P)` is the 2D outline distance alone (rims, inlays, ink, paint)."""

    def __init__(self, o, lean, hw_bot, hw_mid, h_bot, h_top, r_corner=0.03, w0=-0.4, w1=0.16, kb=0.05, z_floor=None):
        a = math.radians(lean)
        self.zf = z_floor                # the hollow's floor: level (the leaned prism's bottom face dived through the
                                         # hood's chin into the mantle below)
        self.o = np.asarray(o, float)
        self.ax = np.array([[1.0, 0.0, 0.0], [0.0, math.sin(a), math.cos(a)], [0.0, math.cos(a), -math.sin(a)]])
        self.hb, self.hm, self.vb, self.vt, self.rc = hw_bot, hw_mid, h_bot, h_top, r_corner
        self.w0, self.w1, self.kb = w0, w1, kb

    def at(self, u, v, w):
        """World point of frame coordinates (u, v, w)."""
        return self.o + np.asarray(u) * self.ax[0] + np.asarray(v) * self.ax[1] + np.asarray(w) * self.ax[2]

    def uvw(self, P):
        return (_arr(P) - self.o) @ self.ax.T

    def d2uv(self, u, v):
        # bottom: a trapezoid v in [-vb, 0], half widths hb (bottom) .. hm (top), corners rounded by rc
        r = self.rc
        he = self.vb / 2
        px, py = np.abs(u), v + he
        r1, r2 = self.hb - r, self.hm - r
        heq = he - r
        k1 = np.array([r2, heq])
        k2 = np.array([r2 - r1, 2 * heq])
        cax = px - np.minimum(px, np.where(py < 0, r1, r2))
        cay = np.abs(py) - heq
        t = np.clip(((k1[0] - px) * k2[0] + (k1[1] - py) * k2[1]) / (k2 @ k2), 0, 1)
        cbx, cby = px - k1[0] + k2[0] * t, py - k1[1] + k2[1] * t
        s = np.where((cbx < 0) & (cay < 0), -1.0, 1.0)
        d_bot = s * np.sqrt(np.minimum(cax * cax + cay * cay, cbx * cbx + cby * cby)) - r
        # top: an ellipse (hm wide, vt tall), cut off at the sill line (its lower half lies inside the trapezoid;
        # cut at v = 0 instead, the two halves met with distance ~0 all along the seam: a membrane across the hole)
        qx, qy = u / self.hm, v / self.vt
        k0 = np.sqrt(qx * qx + qy * qy)
        k1_ = np.sqrt((u / self.hm ** 2) ** 2 + (v / self.vt ** 2) ** 2)
        d_ell = np.where(k0 < 1e-3, -min(self.hm, self.vt), k0 * (k0 - 1.0) / np.maximum(k1_, 1e-9))
        d_top = np.maximum(d_ell, -(v + self.vb))
        return np.minimum(d_top, d_bot)

    def d2(self, P):
        q = self.uvw(P)
        return self.d2uv(q[:, 0], q[:, 1])

    def bounds(self):
        hw = max(self.hb, self.hm) + 0.02
        pts = [self.at(u, v, w) for u in (-hw, hw) for v in (-self.vb - 0.02, self.vt + 0.02) for w in (self.w0, self.w1)]
        pts = np.array(pts)
        return pts.min(0), pts.max(0)

    def d(self, P):
        q = self.uvw(P)
        d = self.d2uv(q[:, 0], q[:, 1])
        d = sdf.smax(d, q[:, 2] - self.w1, self.kb)
        if self.zf is not None:
            d = sdf.smax(d, self.zf - _arr(P)[:, 2], 0.02)
        return np.maximum(d, self.w0 - q[:, 2])


class DomainWarp(sdf.Prim):
    """A primitive read through a small domain warp: d(P) = base.d(f(P)) (approximate; f near-rigid). `pad` grows
    the bounds by the warp's reach."""

    def __init__(self, base, f, pad):
        self.base, self.f, self.pad_ = base, f, float(pad)

    def bounds(self):
        lo, hi = self.base.bounds()
        return lo - self.pad_, hi + self.pad_

    def d(self, P):
        return self.base.d(self.f(_arr(P)))


class ArchRing(sdf.Prim):
    """A flat ring round an Arch's outline, in its plane: 2D band from the outline (+ `inset`) out to `width`
    (`width_bot` at the bottom, blended up the sides), extruded over w in [wf, wb], edges rounded by r; + an
    optional chin tab (a V pointing down below the bottom, `tab` = (half width, drop))."""

    def __init__(self, arch: Arch, width, wf, wb, r=0.005, inset=0.0, width_bot=None, tab=None, pad_box=0.06):
        self.A, self.wd, self.wf, self.wb, self.r, self.ins = arch, width, wf, wb, r, inset
        self.wbot = width if width_bot is None else width_bot
        self.tab = tab
        self.pad = pad_box

    def bounds(self):
        A = self.A
        hw = max(A.hb, A.hm) + self.wd + 0.02
        drop = (self.tab[1] if self.tab else 0.0) + self.wbot + 0.02
        pts = np.array([A.at(u, v, w) for u in (-hw, hw) for v in (-A.vb - drop, A.vt + self.wd + 0.02)
                        for w in (self.wf - 0.01, self.wb + 0.01)])
        return pts.min(0), pts.max(0)

    def ring2(self, u, v):
        A = self.A
        d = A.d2uv(u, v)
        g = self.wbot + (self.wd - self.wbot) * _smooth01((v + A.vb) / max(A.vb, 1e-6))
        out = d - g
        if self.tab:
            hw, drop = self.tab
            zt, zp = -A.vb - self.wbot * 0.5, -A.vb - self.wbot - drop
            h = zt - zp
            side = (np.abs(u) * h - (v - zp) * hw) / math.hypot(h, hw)
            tri = np.maximum.reduce([side, v - zt, zp - v])
            out = sdf.smin(out, tri, 0.01)
        return np.maximum(out, -(d - self.ins))

    def d(self, P):
        q = self.A.uvw(P)
        r = self.r
        e0 = self.ring2(q[:, 0], q[:, 1]) + r
        wc, hw = (self.wf + self.wb) / 2, (self.wb - self.wf) / 2
        e1 = np.abs(q[:, 2] - wc) - hw + r
        return np.minimum(np.maximum(e0, e1), 0) + np.sqrt(np.maximum(e0, 0) ** 2 + np.maximum(e1, 0) ** 2) - r


class ArchPrism(sdf.Prim):
    """The Arch's outline grown by `g`, extruded over w in [w0, w1]: the cowl's 'snout' that carries the rim, or a
    grown outline to cut a rim shell with."""

    def __init__(self, arch: Arch, g, w0, w1, g_bot=None):
        self.A, self.g, self.w0, self.w1 = arch, g, w0, w1
        self.gb = g if g_bot is None else g_bot

    def bounds(self):
        A = self.A
        hw = max(A.hb, A.hm) + self.g + 0.02
        pts = np.array([A.at(u, v, w) for u in (-hw, hw) for v in (-A.vb - self.gb - 0.02, A.vt + self.g + 0.02)
                        for w in (self.w0, self.w1)])
        return pts.min(0), pts.max(0)

    def d(self, P):
        A = self.A
        q = A.uvw(P)
        g = self.gb + (self.g - self.gb) * _smooth01((q[:, 1] + A.vb) / max(A.vb, 1e-6))
        d = A.d2uv(q[:, 0], q[:, 1]) - g
        return np.maximum(d, np.maximum(self.w0 - q[:, 2], q[:, 2] - self.w1))


def hull_tris(pts):
    """The convex hull of pts (bmesh): vertices, triangles and the outward planes (N, O: n.p <= o inside)."""
    import bmesh
    bm = bmesh.new()
    for q in np.asarray(pts, float):
        bm.verts.new(tuple(q))
    res = bmesh.ops.convex_hull(bm, input=list(bm.verts))
    kill = list({g for g in list(res.get("geom_interior", [])) + list(res.get("geom_unused", []))
                 if isinstance(g, bmesh.types.BMVert) and g.is_valid})
    if kill:
        bmesh.ops.delete(bm, geom=kill, context="VERTS")
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.verts.index_update()
    V = np.array([v.co[:] for v in bm.verts], float)
    F = np.array([[v.index for v in f.verts] for f in bm.faces], np.int64)
    N = np.array([f.normal[:] for f in bm.faces], float)
    bm.free()
    O = np.einsum("ij,ij->i", N, V[F[:, 0]])
    return V, F, N, O


class HullField(sdf.Prim):
    """A union of convex hulls (each the max of its face planes): hard carved blocks with exact flat facets. The
    game mesh of such a part is the hulls themselves (meta low_hulls), flat shaded: decimated, chamfered SDF
    blocks went soft (a pillow) and thin straps collapsed into knife-like shards."""

    def __init__(self, hulls):
        self.h = []
        for pts in hulls:
            V, F, N, O = hull_tris(pts)
            self.h.append((N, O, V.min(0), V.max(0)))

    def bounds(self):
        return np.min([h[2] for h in self.h], 0), np.max([h[3] for h in self.h], 0)

    def d(self, P):
        P = _arr(P)
        best = np.full(len(P), 1e9)
        for N, O, _, _ in self.h:
            best = np.minimum(best, (P @ N.T - O[None, :]).max(1))
        return best


def chamfer_ring(z, hx, hy, c):
    """8 points of a rectangle (half extents hx, hy) in the plane at local z with its corners cut by c."""
    return [(sx * (hx - c), sy * hy, z) for sx in (-1, 1) for sy in (-1, 1)] + \
           [(sx * hx, sy * (hy - c), z) for sx in (-1, 1) for sy in (-1, 1)]


def carved_block(z0, z1, h0, h1, c, rng=None, jit=0.0, chips=()):
    """Local points of a carved block along Z from z0 to z1: cross-section half extents h0 = (hx, hy) at z0 and h1
    at z1 (a wedge when h1 < h0), every edge chamfered by c (the end rings inset by c). `jit` moves every point a
    little (hand-carved, not machined); `chips` = indices of end-ring points pulled in hard (broken corners)."""
    s = 1.0 if z1 > z0 else -1.0
    rings = [chamfer_ring(z0, h0[0] - c, h0[1] - c, c * 0.6), chamfer_ring(z0 + s * c, h0[0], h0[1], c),
             chamfer_ring(z1 - s * c, h1[0], h1[1], c), chamfer_ring(z1, h1[0] - c, h1[1] - c, c * 0.6)]
    P = np.array([q for r in rings for q in r], float)
    if rng is not None and jit > 0:
        P += rng.uniform(-jit, jit, P.shape)
    for i in chips:                                # a broken corner: the point pulled toward the block's axis
        P[i, :2] *= 0.80
        P[i, 2] -= s * c * 0.8
    return P


def prism_block(z0, z1, h0, h1, c, rng=None, jit=0.0):
    """Local points of a chamfered prism along Z (two octagonal rings, flat ends): 28 tris (posts, ferrules)."""
    P = np.array(chamfer_ring(z0, h0[0], h0[1], c) + chamfer_ring(z1, h1[0], h1[1], c), float)
    if rng is not None and jit > 0:
        P += rng.uniform(-jit, jit, P.shape)
    return P


def to_world(local, c, ax):
    return np.asarray(c, float) + np.asarray(local, float) @ np.asarray(ax, float)


def box_pts(c, half, ax):
    ax = np.asarray(ax, float)
    return np.array([np.asarray(c, float) + sum(s_ * h_ * a_ for s_, h_, a_ in zip(sg, half, ax))
                     for sg in ((-1, -1, -1), (1, -1, -1), (-1, 1, -1), (1, 1, -1),
                                (-1, -1, 1), (1, -1, 1), (-1, 1, 1), (1, 1, 1))])


def oval_disc(c, ax, a, b, t, n=12):
    """World points of a thin oval lozenge (semi-axes a along ax[0], b along ax[2], thickness t along ax[1])."""
    ax = np.asarray(ax, float)
    th = np.linspace(0, 2 * np.pi, n + 1)[:-1] + np.pi / n
    pts = []
    for yy in (-t / 2, t / 2):
        for tt in th:
            pts.append(np.asarray(c, float) + ax[0] * a * math.cos(tt) + ax[2] * b * math.sin(tt) + ax[1] * yy)
    return np.array(pts)


def dome_oval(c, ax, a, b, h, n=18, base=0.004):
    """(fix 5) World points of a domed oval lens: the oval (semi-axes a along ax[0], b along ax[2]) on the glass,
    rising h along ax[1] (out of the pane) in a round pillow profile. Smooth shaded, its diffuse term falls off to
    the rim: light inside frosted glass, not a flat sticker."""
    ax = np.asarray(ax, float)
    c = np.asarray(c, float)
    th = np.linspace(0, 2 * np.pi, n + 1)[:-1] + np.pi / n
    pts = []
    for k_, y_ in ((1.0, -base), (0.78, 0.62), (0.40, 0.93)):
        for tt in th:
            pts.append(c + ax[0] * a * k_ * math.cos(tt) + ax[2] * b * k_ * math.sin(tt) + ax[1] * h * y_)
    pts.append(c + ax[1] * h)
    return np.array(pts)


def hull_sp(name, hulls, role, bind, **kw):
    """An SP made of convex hulls: the sculpt is their field, the game mesh the hulls (exact, flat shaded)."""
    S = Sculpt(name)
    S.add(HullField(hulls), k=0.0)
    meta = dict(kw.pop("meta", {}) or {})
    meta["low_hulls"] = [np.asarray(h, float) for h in hulls]
    return SP(name, S, role, bind, sum(len(hull_tris(h)[1]) for h in hulls), kw.pop("vs", 0.6), meta=meta, **kw)


def band_ribbon(F, cx, cy, zfn, wfn, n=34, lift=0.006, sink=0.005):
    """An exact closed ribbon round a dome (field F) about the vertical axis through (cx, cy): centre height zfn(a), half
    width wfn(a), its face `lift` proud of F's surface, its edge walls sunk `sink` into it; stations denser at the
    front (a = -pi/2). Returns (V, F tris): 6 n triangles (bottom wall, face, top wall)."""
    t = np.linspace(-1.0, 1.0, n, endpoint=False)
    a = -np.pi / 2 + np.pi * np.sign(t) * np.abs(t) ** 1.45
    zc, w = zfn(a), wfn(a)

    def surf(z):
        lo, hi = np.full(n, 0.02), np.full(n, 0.45)
        for _ in range(26):                          # bisection along the radial ray at fixed height
            mid = (lo + hi) / 2
            P = np.stack([cx + mid * np.cos(a), cy + mid * np.sin(a), z], 1)
            inside = F.d(P) < 0
            lo, hi = np.where(inside, mid, lo), np.where(inside, hi, mid)
        P = np.stack([cx + lo * np.cos(a), cy + lo * np.sin(a), z], 1)
        e = 1e-3
        g = np.stack([(F.d(P + v) - F.d(P - v)) / (2 * e) for v in np.eye(3) * e], 1)
        return P, g / (np.linalg.norm(g, axis=1, keepdims=True) + 1e-9)
    Pb, Nb = surf(zc - w)
    Pt, Nt = surf(zc + w)
    rows = [Pb - Nb * sink, Pb + Nb * lift, Pt + Nt * lift, Pt - Nt * sink]
    V = np.vstack(rows)
    tris = []
    for r in range(3):
        for i in range(n):
            j = (i + 1) % n
            b0, b1, t0, t1 = r * n + i, r * n + j, (r + 1) * n + i, (r + 1) * n + j
            tris += [(b0, b1, t1), (b0, t1, t0)]
    return V, np.array(tris, np.int64)


def outer_box(*prims, pad=0.02):
    los, his = zip(*[p.bounds() for p in prims])
    return np.min(los, 0) - pad, np.max(his, 0) + pad


def chips(amp, freq):
    return lambda P: amp * np.clip(NOISE.ridged(P, freq, 3), 0, 1) - amp * 0.3


def ring_pts(c, a, b, n, normal_axis="y", start=0.0, end=2 * math.pi):
    """Points of an ellipse (semi-axes a, b) around c in the XZ plane (normal_axis 'y') or XY plane ('z')."""
    t = np.linspace(start, end, n)
    c = np.asarray(c, float)
    if normal_axis == "y":
        return np.stack([c[0] + a * np.cos(t), np.full(n, c[1]), c[2] + b * np.sin(t)], 1)
    return np.stack([c[0] + a * np.cos(t), c[1] + b * np.sin(t), np.full(n, c[2])], 1)


# ── the spec ───────────────────────────────────────────────────────────────────────────────────────────
class Greatwick(wc.Wick):
    KIND_ID = "greatwick"
    HEIGHT = 1.5
    AO_INTO_BASE = 0.5          # (fix 4: 0.3 left the forms flat; the baked occlusion under the hood, the mantle, the arms
                                # and the lantern is the painted depth the sheets have)

    def __init__(self, faction: str = wc.LEGACY):
        super().__init__(faction)
        if faction == wc.LEGACY:
            return
        # (fix 5: the 256 normal map let the low facets show through on the sleeves, the Serenade tunic and the mantle)
        self.TEXTURE_SIZES = {"normal": 512, "orm": 256}
        self.L = LAYOUT[faction]
        self.PROPORTIONS = fit_proportions(self.L)
        self.MOTION = anim.motion_profile(weight="heavy", weapon="two_hand", stance="wide", run_ref_speed=3.2)
        self.VALUE_GRADIENT_STOPS = materials.BIBLE_GRADIENT_STOPS
        self._parts = None
        g = GRADE[faction]
        proj = wc.graded_projection(CONCEPT[faction], PLATE_HEIGHT[faction], tag="gw", **g)
        proj["gw_pose"] = {}          # filled in model(): part name -> model->concept map (the paint pose)
        proj["gw_roles"] = {}         # filled in model(): part name -> material role
        proj["gw_fields"] = {}        # filled in model(): part name -> its sculpt's field (edges / cavities)
        proj["gw_unpose"] = {}        # filled in model(): part name -> paint -> sculpt space map (or absent)
        proj["gw_meta"] = {}          # filled in model(): part name -> SP.meta (cuffs, fists, ...)
        proj["gw_halo"] = []          # filled in model(): dark channels painted round accent strips
        proj["gw_palette"] = dict(self.PALETTE)
        proj["gw_mask"] = f"{CONCEPT[faction]}_mask.png"
        proj.update(PAINT[faction])
        self.PROJECTION = proj
        _install()

    # ── model ──────────────────────────────────────────────────────────────────────────────────────
    def parts(self) -> list:
        if self._parts is None:
            self._parts = (aubade_parts if self.faction == "aubade" else serenade_parts)(self.L)
        return self._parts

    def model(self, ctx) -> list:
        if self.faction == wc.LEGACY:
            return self.legacy_model(ctx)
        P = []
        pose = self.PROJECTION["gw_pose"]
        self.PROJECTION["gw_halo"].clear()
        _halo_materials(ctx)
        wc.halo_material(ctx)
        wc.halo_material(ctx, wc.HALO_LAMP_MAT)
        wc.install_halo_export()
        _matte_materials(ctx)
        for sp in self.parts():
            v, q = sp.S.mesh(VOXEL * sp.vs)
            if sp.to_model is not None:
                v = sp.to_model(v)
            ob = sdf.to_object(f"{sp.name}_high", v, q, ctx.col)
            ob.data.materials.append(ctx.mats[sp.role])
            P.append(fighter.Part(sp.name, high=ob, low=_low_of(ob, sp), tris=sp.tris, bind=sp.bind))
            pp = sp.paint_pose()
            if pp is not None:
                pose[sp.name] = pp
            pr = self.PROJECTION
            pr["gw_roles"][sp.name] = sp.role
            pr["gw_fields"][sp.name] = field_of(sp.S)
            if sp.to_concept is not None:
                pr["gw_unpose"][sp.name] = invert(sp.to_concept)
            pr["gw_meta"][sp.name] = sp.meta
            if sp.meta.get("halo"):
                pr["gw_halo"].append(sp.meta["halo"])
        return P

    def rig_extras(self, ctx) -> None:
        if self.faction == wc.LEGACY:
            return
        orient_prop(ctx.info, self.L)

    def clip_overrides(self, ctx) -> dict:
        if self.faction == wc.LEGACY:
            return {}
        return motion_clips(ctx, self)

    def legacy_props(self, ctx, part) -> None:
        k = self.H / 1.1
        sh = ctx.info.j("neck_base")
        wc.legacy_weapon(self, ctx, part, "stone", (0.11, 0.07, 0.08))
        pack = Sculpt("backlantern")
        bc = (0, 0.24 * k, sh.z - 0.05 * k)
        pack.add(RoundBox(bc, (0.16 * k, 0.1 * k, 0.2 * k), 0.03 * k), k=0.0)
        pack.sub(RoundBox((bc[0], bc[1] + 0.1 * k, bc[2] + 0.02 * k), (0.12 * k, 0.07 * k, 0.15 * k), 0.02 * k), k=0.01 * k)   # open to the back
        pack.add(Torus((bc[0], bc[1], bc[2] + 0.26 * k), 0.07 * k, 0.015 * k), k=0.0)                                         # carry ring
        part("backlantern", pack, "ironstone", "bone:chest", 300)
        core = Sculpt("backcore")
        core.add(Ellipsoid((bc[0], bc[1] + 0.05 * k, bc[2] + 0.04 * k), (0.12 * k, 0.07 * k, 0.15 * k)), k=0.0)
        part("backcore", core, "accent", "bone:chest", 100)


# (fix round 3) matte floors per role: the baked ORM held cloth at roughness ~0.74 (a soft specular sheen over the felt
# and wool: the 'plastic / tidy toy' read); felt, wool, linen, leather, wood and stone are matte. Glass and resin keep
# their gloss.
MATTE = {"cloth": 0.93, "cloth2": 0.93, "under": 0.93, "leather": 0.85, "wood": 0.86, "wood_dark": 0.86,
         "chalk": 0.88, "stone": 0.86, "ironstone": 0.86, "sandstone": 0.88}


def _matte_materials(ctx) -> None:
    for role, floor in MATTE.items():
        m = ctx.mats.get(role)
        if m is None or not m.use_nodes or m.get("_gw_matte"):
            continue
        nt = m.node_tree
        b = nt.nodes.get("BSDF") or next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if b is None:
            continue
        s = b.inputs["Roughness"]
        if s.is_linked:
            src = s.links[0].from_socket
            mx = nt.nodes.new("ShaderNodeMath")
            mx.operation = "MAXIMUM"
            mx.inputs[1].default_value = floor
            nt.links.new(src, mx.inputs[0])
            nt.links.new(mx.outputs[0], s)
        else:
            s.default_value = max(float(s.default_value), floor)
        m["_gw_matte"] = 1


def _halo_materials(ctx) -> None:
    """The hood light's see-through shells (HOOD_HALOS): copies of the accent, alpha-blended, kept unbaked by the
    `glow_` prefix; glb_metallic_zero renames them `accent` in the GLB (the renderer tints every material of that
    name). Their emission and alpha differ from the accent's so the optimizer's dedup can never merge them."""
    acc = ctx.mats.get("accent")
    if acc is None:
        return
    for i, (nm, alpha) in enumerate(HALO_ALPHA.items()):
        if nm in ctx.mats:
            continue
        m = acc.copy()
        m.name = nm
        b = m.node_tree.nodes.get("BSDF") if m.use_nodes else None
        if b is not None:
            b.inputs["Alpha"].default_value = alpha
            b.inputs["Emission Strength"].default_value = max(0.05, b.inputs["Emission Strength"].default_value - 0.01 * (i + 1))
        for attr, val in (("surface_render_method", "BLENDED"), ("blend_method", "BLEND")):
            try:
                setattr(m, attr, val)
            except (AttributeError, TypeError):
                pass
        ctx.mats[nm] = m


def _low_of(high, sp):
    """The game mesh of a part: a collapse-decimated copy of the sculpt. The shared step decimates with X
    symmetry, which stalls on parts whose voxel grid is not mirror-exact (a lantern slab stopped at 578 of 60
    tris); fall back to a free collapse there."""
    from common import mesh
    if sp.meta.get("low_boxes"):
        return _boxes_low(high, sp)
    if sp.meta.get("low_hulls"):
        return _hulls_low(high, sp)
    if sp.meta.get("low_mesh"):
        V, F = sp.meta["low_mesh"]
        V = sp.to_model(V) if sp.to_model is not None else V
        col = high.users_collection[0] if high.users_collection else None
        low = sdf.to_object(f"{sp.name}_low", np.asarray(V, float), np.asarray(F, np.int64), col)
        if sp.meta.get("smooth"):
            low.data.polygons.foreach_set("use_smooth", np.ones(len(low.data.polygons), dtype=bool))
        for m in high.data.materials:
            low.data.materials.append(m)
        return low
    low = mesh.duplicate(high, f"{sp.name}_low")
    n = mesh.decimate_to(low, sp.tris, symmetric=True)
    if n > sp.tris * 1.12:
        bpy_data = low.data
        low2 = mesh.duplicate(high, f"{sp.name}_low")
        mesh.decimate_to(low2, sp.tris, symmetric=False)
        import bpy
        bpy.data.objects.remove(low, do_unlink=True)
        if bpy_data.users == 0:
            bpy.data.meshes.remove(bpy_data)
        low = low2
    return low


_CUBE_FACES = np.array([[0, 4, 6, 2], [1, 3, 7, 5], [0, 1, 5, 4], [2, 6, 7, 3], [0, 2, 3, 1], [4, 5, 7, 6]])


def _boxes_low(high, sp):
    """An exact low for a part made of flat boxes (meta low_boxes: (centre, half extents, axes rows)): 12 tris a
    box, flat shaded, in the high's material."""
    V, Q = [], []
    for c, half, ax in sp.meta["low_boxes"]:
        ax = np.asarray(ax, float)
        corners = [np.asarray(c, float) + sum(s_ * h_ * a_ for s_, h_, a_ in zip(sg, half, ax))
                   for sg in ((-1, -1, -1), (1, -1, -1), (-1, 1, -1), (1, 1, -1),
                              (-1, -1, 1), (1, -1, 1), (-1, 1, 1), (1, 1, 1))]
        f = _CUBE_FACES if np.linalg.det(ax) > 0 else _CUBE_FACES[:, ::-1]
        Q.append(f + len(V))
        V += corners
    col = high.users_collection[0] if high.users_collection else None
    low = sdf.to_object(f"{sp.name}_low", np.array(V), np.vstack(Q), col)
    low.data.polygons.foreach_set("use_smooth", np.zeros(len(low.data.polygons), dtype=bool))
    for m in high.data.materials:
        low.data.materials.append(m)
    return low


def _hulls_low(high, sp):
    """The exact game mesh of a hull part (meta low_hulls): every hull's triangles, flat shaded (crisp carved facets)."""
    V, F, n0 = [], [], 0
    for pts in sp.meta["low_hulls"]:
        if sp.to_model is not None:                  # (near-affine warps: the hull of the moved points)
            pts = sp.to_model(pts)
        v, f, _, _ = hull_tris(pts)
        V.append(v)
        F.append(f + n0)
        n0 += len(v)
    col = high.users_collection[0] if high.users_collection else None
    low = sdf.to_object(f"{sp.name}_low", np.vstack(V), np.vstack(F), col)
    smooth = bool(sp.meta.get("smooth"))       # (fix 5: the domed light cores shade round, the carved stone stays crisp)
    low.data.polygons.foreach_set("use_smooth", np.full(len(low.data.polygons), smooth, dtype=bool))
    for m in high.data.materials:
        low.data.materials.append(m)
    return low


# ── layout: the shared model frame + each faction's concept-space landmarks ─────────────────────────────
# Model space (metres, Z up, the wick faces -Y, its left is +X). Both factions: lantern top 1.52-1.54 (content
# art.height 1.5 within 5 %), hammer head on the wick's left at hip height, haft across the body in both hands.
LAYOUT = {
    "aubade": dict(
        crown=1.205,                     # hood crown (knob tip 1.275)
        hip=0.46, ankle=0.06, stance=0.06, hip_w=0.20, foot=0.17,
        neck=0.828, shoulder=(0.22, 0.718), arm=0.42, upper_frac=0.47, hand=0.10,
        wrist=(-0.300, -0.285, 0.485),   # right wrist at rest (the left mirrors it)
        grip_r=(-0.305, -0.345, 0.468),  # right fist on the haft (prop.R head)
        haft=(0.925, 0.0, 0.135),        # haft direction toward the head (concept front view)
        grip_l_along=0.50,               # left fist this far along the haft
        lantern_y=0.465,                 # (fix 5: the deeper 0.33 m box keeps its front 1.5 cm off the hood's back)
        topple=dict(pivot=(0.30, 0.10)),    # death: the back hem pivot (the resting tilt is solved in _death_clip)
    ),
    "serenade": dict(
        crown=1.25,
        hip=0.47, ankle=0.065, stance=0.09, hip_w=0.22, foot=0.19,
        neck=0.868, shoulder=(0.24, 0.758), arm=0.42, upper_frac=0.47, hand=0.10,
        wrist=(-0.330, -0.300, 0.515),
        grip_r=(-0.338, -0.360, 0.500),
        haft=(0.995, 0.0, 0.10),
        grip_l_along=0.56,
        lantern_y=0.50,                  # (fix 5: a shallower drum seated over the shoulders, its front on the collar's
                                         # back: centre 0.565 -> 0.50, back edge 0.84 -> 0.72)
        topple=dict(pivot=(0.36, 0.15)),
    ),
}


def fit_proportions(L: dict) -> dict:
    """VALE_BIPED_1 at minion proportions fitted to the layout: the arm angles are solved so the rest
    wrist lands on L['wrist'] (rig._layout's own arm formula, grid search)."""
    crown = L["crown"] - 0.035
    head = (crown - L["neck"] - 0.05) / 0.86
    neck = 0.05
    z_neck = crown - head * 0.86 - neck
    sw = L["shoulder"][0]
    drop = z_neck - L["shoulder"][1]
    arm, uf = L["arm"], L["upper_frac"]
    sh = np.array([sw, 0.0 + 0.012 + 0.018, z_neck - drop])
    want = np.array([-L["wrist"][0], L["wrist"][1], L["wrist"][2]])     # the left wrist (+X)
    A, F, B = np.meshgrid(np.radians(np.arange(10, 89, 1.0)), np.radians(np.arange(0, 85, 1.0)),
                          np.radians(np.arange(0, 100, 1.0)), indexing="ij")
    d1 = np.stack([np.cos(A) * np.cos(F), -np.cos(A) * np.sin(F), -np.sin(A)], -1)
    elbow = sh + d1 * arm * uf
    front = np.array([0.0, -1.0, 0.0])
    zf = front - d1 * (d1 @ front)[..., None]
    zf /= np.linalg.norm(zf, axis=-1, keepdims=True) + 1e-9
    hinge = np.cross(d1, zf)
    hinge /= np.linalg.norm(hinge, axis=-1, keepdims=True) + 1e-9
    # Rodrigues: rotate d1 about hinge by B
    cb, sb = np.cos(B)[..., None], np.sin(B)[..., None]
    d2 = d1 * cb + np.cross(hinge, d1) * sb + hinge * (hinge * d1).sum(-1, keepdims=True) * (1 - cb)
    wrist = elbow + d2 * arm * (1 - uf)
    err = np.linalg.norm(wrist - want, axis=-1)
    i = np.unravel_index(np.argmin(err), err.shape)
    a_deg, f_deg, b_deg = (float(np.degrees(M[i])) for M in (A, F, B))
    leg = math.hypot(L["hip"] - L["ankle"], L["stance"])
    return rig.proportions(height=crown, head=head, neck=neck, shoulder_width=2 * sw, hip_width=L["hip_w"],
                           leg=leg, thigh_frac=0.5, arm=arm, upper_arm_frac=uf, hand=L["hand"], foot=L["foot"],
                           ankle_height=L["ankle"], stance=L["stance"], spine_curve=0.0, toe_out_deg=8.0,
                           knee_bend=0.012, a_pose_deg=a_deg, arm_forward_deg=f_deg, elbow_bend_deg=b_deg,
                           shoulder_drop=drop)


def orient_prop(info, L: dict) -> None:
    """prop.R runs along the haft: head on the right fist's grip, +Y toward the hammer head, +Z = the head's
    long axis (the striking faces). anim.Aim then points the haft and HandTarget(to_prop) grips it."""
    import bpy
    from mathutils import Vector
    arm = info.armature
    scene.select_only([arm], arm)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones["prop.R"]
    g = Vector(L["grip_r"])
    d = Vector(L["haft"]).normalized()
    eb.head = g
    eb.tail = g + d * 0.12
    up = Vector((0.0, 0.0, 1.0))
    eb.align_roll(up - d * up.dot(d))
    bpy.ops.object.mode_set(mode="OBJECT")


def haft_point(L, along):
    return np.asarray(L["grip_r"]) + np.asarray(L["haft"]) / np.linalg.norm(L["haft"]) * along


# ── shared pieces (model space) ──────────────────────────────────────────────────────────────────────
def rest_arm(L, side: str):
    """(shoulder, elbow, wrist) of the rest pose, model space (mirrors rig._layout)."""
    P = fit_proportions(L)
    import types  # noqa: F401
    sw = P["shoulder_width"] / 2
    z_neck = P["height"] - P["head"] * 0.86 - P["neck"]
    sh = np.array([sw, 0.03, z_neck - P["shoulder_drop"]])
    a, fw = math.radians(P["a_pose_deg"]), math.radians(P["arm_forward_deg"])
    d1 = np.array([math.cos(a) * math.cos(fw), -math.cos(a) * math.sin(fw), -math.sin(a)])
    el = sh + d1 * P["arm"] * P["upper_arm_frac"]
    front = np.array([0.0, -1.0, 0.0])
    zf = front - d1 * d1.dot(front)
    zf /= np.linalg.norm(zf)
    h = np.cross(d1, zf)
    h /= np.linalg.norm(h)
    b = math.radians(P["elbow_bend_deg"])
    d2 = d1 * math.cos(b) + np.cross(h, d1) * math.sin(b) + h * h.dot(d1) * (1 - math.cos(b))
    wr = el + d2 * P["arm"] * (1 - P["upper_arm_frac"])
    if side == "R":
        m = np.array([-1.0, 1.0, 1.0])
        return sh * m, el * m, wr * m
    return sh, el, wr


def boots_legs(L, out: list, boot_c, boot_half, toe_r, role="leather", sole_role=None):
    """Short dark legs inside the cloak (continuity when a foot lifts) + a boot per foot (rigid on the foot)."""
    legs = Sculpt("legs")
    for sx in (-1, 1):
        hip = (sx * L["hip_w"] / 2, 0.0, L["hip"])
        ank = (sx * (L["hip_w"] / 2 + L["stance"]), 0.02, L["ankle"] + 0.03)
        legs.add(RoundCone(hip, ank, 0.075, 0.055), k=0.0)
    out.append(SP("legs", legs, "under", "auto", 52))           # (hidden under the robe but in the death pose)
    for s, sx in (("L", 1), ("R", -1)):
        b = Sculpt(f"boot_{s}")
        c = (sx * boot_c[0], boot_c[1], boot_c[2])
        b.add(RoundBox(c, boot_half, 0.04), k=0.0)
        b.add(Ellipsoid((c[0], c[1] - boot_half[1] * 0.55, c[2] - 0.005), (boot_half[0] * 1.02, toe_r, boot_half[2] * 0.95)), k=0.03)
        b.add(Capsule((c[0], c[1] + 0.02, c[2]), (c[0], c[1] + 0.02, c[2] + boot_half[2] + 0.03), boot_half[0] * 0.8), k=0.03)
        b.inter(HalfSpace((0, 0, 0.0), (0, 0, -1), 1.0), k=0.0)
        out.append(SP(f"boot_{s}", b, role, f"bone:foot.{s}", 60, 0.8))


def sleeves_mitts(L, out: list, concept_mitts: dict, r_up=0.085, r_fore=0.075, role="cloth", mitt_role="leather",
                  mitt_r=0.062, body=None, top_dz=0.03, r_top=None, sleeve_tris=140):
    """Sleeves (model space, along the rest arms; heat-weighted on their own arm) and mitten fists (rigid on the
    hands). A sleeve: a broad upper arm, the forearm widening to a bell, a turned-back CUFF band (a flat ring 1 cm
    proud: the first sleeves ended in a soft lump), the cuff open. A fist: a squared mitten (knuckle ridge, a
    thumb lobe over the haft; the finger lines are paint). The rest pose is symmetric, the sheet's arms are not:
    the paint pose slides each sleeve progressively (0 at the shoulder, all of it at the cuff) and each fist onto
    the sheet's fists (concept_mitts {side: concept xyz}), then undoes the faction's body warp (`body`).
    top_dz / r_top: the sleeve cap's lift over the shoulder joint and its radius (a capelet over the shoulders
    needs the cap tucked under it)."""
    back = invert(body) if body is not None else None
    for s in ("R", "L"):
        sh, el, wr = rest_arm(L, s)
        sx = -1.0 if s == "R" else 1.0
        S = Sculpt(f"sleeve_{s}")
        top = sh + np.array([sx * -0.02, 0.0, top_dz])
        rt = r_up if r_top is None else r_top
        dw = (wr - el) / np.linalg.norm(wr - el)
        S.add(FlatCapsule(top, el, rt, rt * 0.92, r_up * 0.95, r_up * 0.9, side=(1, 0, 0)), k=0.0)
        S.add(FlatCapsule(el, wr - dw * 0.06, r_fore, r_fore * 0.95, r_fore * 1.16, r_fore * 1.10, side=(1, 0, 0)), k=0.045)
        S.add(Sphere(el, r_up * 0.95), k=0.05)
        rc, hc_ = r_fore * 1.24, 0.026                   # the cuff: a flat ring round the wrist end

        def cuff_prof(r, z, rc=rc, hc_=hc_):
            q0 = np.maximum(r - (rc - 0.01), 0.0)
            q1 = np.maximum(np.abs(z) - (hc_ - 0.01), 0.0)
            return np.sqrt(q0 * q0 + q1 * q1) + np.minimum(np.maximum(r - rc, np.abs(z) - hc_), 0) - 0.01
        cuff_c = wr - dw * 0.040
        S.add(Lathe(cuff_c, cuff_prof, rc + 0.01, -hc_ - 0.01, hc_ + 0.01, axes=sdf.frame(dw)), k=0.006)
        S.sub(Capsule(wr - dw * 0.012, wr + dw * 0.08, r_fore * 0.72), k=0.008)            # open cuff
        cm = np.asarray(concept_mitts[s], float)
        cm_m = body(cm[None])[0] if body is not None else cm
        hand_c = wr + dw * 0.045
        d = cm_m - hand_c
        tf = limb_offset(sh, wr, d)
        out.append(SP(f"sleeve_{s}", S, role, ("gw_arm", s), sleeve_tris, 0.8, to_concept=compose(tf, back) if back else tf,
                      meta={"cuff": (tuple(cuff_c), tuple(dw), hc_ + 0.004), "elbow": tuple(el)}))
        M = Sculpt(f"mitt_{s}")
        fx = sdf.frame(dw, (0, -1, 0))                   # local Z along the forearm, X toward the front
        M.add(RoundBox(hand_c, (mitt_r * 0.78, mitt_r * 0.86, mitt_r * 0.82), mitt_r * 0.5, axes=fx), k=0.0)
        M.add(Capsule(hand_c + fx[0] * mitt_r * 0.55 + fx[2] * mitt_r * 0.35 - fx[1] * mitt_r * 0.6,
                      hand_c + fx[0] * mitt_r * 0.55 + fx[2] * mitt_r * 0.35 + fx[1] * mitt_r * 0.6, mitt_r * 0.36), k=0.02)
        thumb = hand_c + np.array([-sx * 0.02, -0.035, 0.035])
        M.add(Ellipsoid(thumb, (0.026, 0.03, 0.022)), k=0.02)
        mt = shift(*d)
        out.append(SP(f"mitt_{s}", M, mitt_role, f"bone:hand.{s}", 64, 0.7, to_concept=compose(mt, back) if back else mt,
                      meta={"fist": (tuple(hand_c), tuple(fx[0]), tuple(fx[1]), tuple(fx[2]), mitt_r)}))


def segment_pose(a_m, b_m, a_c, b_c):
    """Model -> concept for a strut sculpted in model space between a_m and b_m whose paint lies between a_c and
    b_c (each point moves by the end offsets blended along the strut)."""
    a_m, b_m, a_c, b_c = (np.asarray(v, float) for v in (a_m, b_m, a_c, b_c))
    ab = b_m - a_m
    da, db = a_c - a_m, b_c - b_m

    def f(P):
        P = _arr(P)
        t = np.clip((P - a_m) @ ab / (ab @ ab), 0.0, 1.0)[:, None]
        return P + da * (1 - t) + db * t
    return f


def _ellipsoid_pts(c, ax, r, n, rings=(-0.80, 0.0, 0.80)):
    rx, ry, rz = r
    th = np.linspace(0, 2 * np.pi, n + 1)[:-1]
    pts = []
    for ph in rings:
        k_, w_ = math.cos(ph * 1.1), math.sin(ph * 1.1)
        for t_ in th:
            pts.append(c + ax[0] * rx * k_ * math.cos(t_) + ax[1] * ry * k_ * math.sin(t_) - ax[2] * rz * w_)
    pts += [c - ax[2] * rz, c + ax[2] * rz]
    return np.array(pts)


# (fix round 3) the hood light's soft falloff: a see-through LINING of light over the deep half of the hollow (its back
# wall, floor and sides, from `w0` in), a GLB material renamed `accent` after export (glb_metallic_zero) and
# alpha-BLENDED, so the renderer tints it with the core (it tints every material named accent) and it reads as a
# much lower emissive (alpha x glow) behind and round the core: lamplight on the inside of the hood, fading to the ink
# of the lip. Factor-only (the load test's accent rule); the KEEP prefix `glow_` keeps it out of the bake.
# (Nested shells concentric with the core were tried first: their stepped rings read as an iris round a pupil.)
HALO_ALPHA = {"glow_halo1": 0.20}


def _ellipsoid_mesh(c, ax, r, n=14, m=7):
    """A clean UV ellipsoid (n round, m - 1 rings + 2 poles): smooth, symmetric, no hull facets. Returns (V, F)."""
    rx, ry, rz = r
    V = [c - ax[2] * rz]
    for i in range(1, m):
        ph = -math.pi / 2 + math.pi * i / m
        k_, w_ = math.cos(ph), math.sin(ph)
        for j in range(n):
            t_ = 2 * math.pi * j / n
            V.append(c + ax[0] * rx * k_ * math.cos(t_) + ax[1] * ry * k_ * math.sin(t_) + ax[2] * rz * w_)
    V.append(c + ax[2] * rz)
    F = []
    for j in range(n):
        F.append((0, 1 + (j + 1) % n, 1 + j))
    for i in range(m - 2):
        a0, b0 = 1 + i * n, 1 + (i + 1) * n
        for j in range(n):
            j1 = (j + 1) % n
            F += [(a0 + j, a0 + j1, b0 + j1), (a0 + j, b0 + j1, b0 + j)]
    top = len(V) - 1
    a0 = 1 + (m - 2) * n
    for j in range(n):
        F.append((a0 + j, a0 + (j + 1) % n, top))
    V, F = np.array(V), np.array(F, np.int64)
    # outward winding (the frame may be left-handed)
    cen = V[F].mean(1)
    nn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    if np.einsum("ij,ij->i", nn, cen - c).mean() < 0:
        F = F[:, ::-1]
    return V, F


def _hollow_lining(F_hood, A, v_c, ws, n=12, inset=0.012, back=0.40):
    """The see-through lining of the hollow's deep part: rings of the hood's inner wall (found by marching out from
    the hollow's centre line in the arch's frame) at depths `ws`, pulled `inset` off the wall, and a cap over the
    back wall; faces wound toward the centre line (seen from the opening). Returns (V, F)."""
    th = np.linspace(0, 2 * np.pi, n, endpoint=False) + np.pi / n
    steps = np.arange(0.004, 0.32, 0.002)
    rings = []
    for w in ws:
        o = A.at(0.0, v_c, w)
        ring = []
        for t in th:
            d = math.cos(t) * A.ax[0] + math.sin(t) * A.ax[1]
            P = o[None, :] + steps[:, None] * d[None, :]
            hit = np.nonzero(F_hood.d(P) < 0)[0]
            # (the hollow is the arch prism: where the march finds no wall, a hole into the body, the outline holds)
            dd = A.d2uv(steps * math.cos(t), v_c + steps * math.sin(t))
            so = steps[np.nonzero(dd >= 0)[0][0]] if (dd >= 0).any() else steps[-1]
            s_ = min(steps[hit[0]] if len(hit) else 9.0, so + 0.015)
            ring.append(o + d * max(s_ - inset, 0.01))
        rings.append(ring)
    # the back wall: march along W from the deepest ring's centre
    o = A.at(0.0, v_c, ws[-1])
    P = o[None, :] + steps[:, None] * A.ax[2][None, :]
    hit = np.nonzero(F_hood.d(P) < 0)[0]
    s_ = steps[hit[0]] if len(hit) else 0.03
    cap = o + A.ax[2] * max(s_ - inset, 0.005)
    V = [q for r_ in rings for q in r_] + [cap]
    F = []
    for i in range(len(rings) - 1):
        for j in range(n):
            j1 = (j + 1) % n
            a, b, c_, d_ = i * n + j, i * n + j1, (i + 1) * n + j1, (i + 1) * n + j
            F += [(a, b, c_), (a, c_, d_)]
    ci = len(V) - 1
    last = (len(rings) - 1) * n
    for j in range(n):
        F.append((last + j, last + (j + 1) % n, ci))
    V, F = np.array(V, float), np.array(F, np.int64)
    # wind every face toward the centre line (its normal points at the viewer looking in)
    cen = V[F].mean(1)
    nn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    q = A.uvw(cen)
    axis = A.at(0.0, v_c, 0.0)[None, :] + q[:, 2:3] * A.ax[2][None, :]
    flip = np.einsum("ij,ij->i", nn, axis - cen) < 0
    F[flip] = F[flip][:, ::-1]
    return V, F


def hood_light(c, out: list, to_model=None, s: float = 1.0, radii=(0.050, 0.030, 0.032), axes=None):
    """The hood light (fix round 4, shared by every kind: wick_common.cap_mesh / halo_mesh): ONE soft core, the front of
    a 16-round ellipsoid wider than tall (radii along the rows of `axes`, the arch's frame: across, up, depth into the
    hood), centred in the opening and set back, and its HALO: an alpha-blended cap 1.6 x the core across and up whose
    vertex alpha falls from 0.5 over the core's outline to 0 at its rim (inject_halo), so the light fades into the
    dark hollow instead of stopping at a hard 10-gon (review r3: a pupil in a socket). The see-through lining of round
    3 is gone (a second flat plateau, and accent area the gate could not afford)."""
    rx, ry, rz = (r * s for r in radii)          # across, up, depth
    ax = np.eye(3) if axes is None else np.asarray(axes, float)
    c = np.asarray(c, float)
    X, Y, Z = ax[0], -ax[2], ax[1]                # wick_common frame: across, OUT of the hood, up
    V, F = wc.cap_mesh(c, X, Y, Z, rx, rz, ry, seg=16)
    S = Sculpt("hoodlight")
    S.add(Ellipsoid(tuple(c), (rx, ry, rz), axes=ax), k=0.0)
    out.append(SP("hoodlight", S, wc.CORE_MAT, "bone:head", len(F), 0.5, to_model=to_model,
                  meta={"light": (tuple(c), (rx, ry, rz), None if axes is None else ax.tolist()), "smooth": True,
                        "low_mesh": (V, F)}))
    V, F = wc.halo_mesh(c, X, Y, Z, rx, rz, ry)
    S = Sculpt("hoodhalo")
    S.add(Ellipsoid(tuple(c), (rx, ry, rz), axes=ax), k=0.0)
    out.append(SP("hoodhalo", S, wc.HALO_MAT, "bone:head", len(F), 0.5, to_model=to_model,
                  meta={"smooth": True, "low_mesh": (V, F)}))


# ══ AUBADE (concept space: front x = (px - 573) / 762, z = (1372 - py) / 762) ══════════════════════════════
# the hood opening: the sheet's tall rounded arch (0.21-0.22 wide, 0.81-1.08 m, straight sides flaring a little to
# a flat sill) in a plane LEANED BACK 14 degrees, so the 52-degree camera looks INTO the hollow (the light shows,
# the floor is ink) instead of at a pale floor under the brow. The rim is a FLAT carved chalk frame in that plane
# (the sheet's stone-block arch): a rim laid on the curved cowl read as a rolled torus, lips round an O-mouth.
AUB_ARCH = Arch((-0.024, -0.250, 0.940), 14.0, hw_bot=0.112, hw_mid=0.106, h_bot=0.128, h_top=0.150, r_corner=0.032,
                w0=-0.40, w1=0.165, kb=0.06, z_floor=0.805)
AUB_RIM_W = 0.042                             # the chalk rim: 4.2 cm wide round the opening
AUB_RIM_JOINTS = (-128.0, -84.0, -40.0, 0.0, 40.0, 84.0, 128.0)   # voussoir joints (deg from the top, about the arch)
STOLES: list = []                             # (x centre, half width) of each stole (paint: the linen's hem lines)
# the pointed hem: 14 shallow points, 5 cm deep (fix 4: 2.3 cm higher, the boots show as on the sheet, and the heavier
# run's roll no longer drives the points into the ground, which had flattened the body's heave to 2.6 cm)
AUB_HEM = dict(z=0.158, amp=0.032, n=9, phase=0.5)    # (fix 5: 14 x 5 cm read torn / burnt)


def aub_hem_z(P):
    """The Aubade hem line's height under each point (the bell's angle): `z` between the points, `z - amp` at
    their tips (a zigzag with slightly hollow sides). The sculpt cuts it, the paint follows it with the band."""
    P = _arr(P)
    a = np.arctan2(P[:, 1], P[:, 0] + 0.01)
    t = np.mod(a * AUB_HEM["n"] / (2 * np.pi) + AUB_HEM["phase"], 1.0)
    tri = 1.0 - 2.0 * np.abs(t - 0.5)
    rim = _smooth01((np.hypot(P[:, 0] + 0.01, P[:, 1] / 0.8) - 0.24) / 0.10)   # flat under the bell (the angle is
    return AUB_HEM["z"] - AUB_HEM["amp"] * tri ** 1.3 * rim                    # undefined on the axis: spikes there)


def aubade_parts(L: dict) -> list:
    out: list = []
    hood_tf = shift(dx=0.022)
    A = AUB_ARCH
    # ── HOOD: a soft rounded cowl, round on top like a helmet, swept back and down at the nape ─────────────
    hc = np.array([-0.022, 0.02, 0.93])
    hood = Sculpt("hood")
    hood.add(Ellipsoid(hc + (0, 0, -0.03), (0.25, 0.25, 0.245)), k=0.0)              # widest low: an arch, not a ball
    hood.add(Ellipsoid(hc + (0, 0.08, -0.11), (0.20, 0.14, 0.15)), k=0.07)              # nape, swept back + down
    hood.add(Ellipsoid(hc + (0, 0.03, -0.155), (0.268, 0.245, 0.09)), k=0.07)           # drape over the shoulders
    # the bib: the cowl's front comes down over the chest to the chin (the sheet: the rim's point sits on it and
    # the stoles start under it); without it the cloak's neck filled the bottom of the opening
    hood.add(Ellipsoid((hc[0], -0.10, 0.78), (0.215, 0.18, 0.11)), k=0.05)
    # the crown: a broad helmet dome (a superellipse lathe, n = 3: 0.43 m wide at 1.10 m like the sheet, flat
    # on top at 1.19 m). An ellipsoid here narrowed into a bullet over the pale cowl (rule 0.1): never again.
    hood.add(helmet((-0.022, 0.02, 0.95), 0.238, 0.245, 0.24, 3.0).displaced(chips(0.003, 6.0), 0.003), k=0.03)
    # the cowl's front edge comes forward to the rim's plane (a snout carrying the frame, blended into the cowl)
    hood.add(ArchPrism(A, AUB_RIM_W + 0.012, 0.004, 0.10, g_bot=AUB_RIM_W + 0.02), k=0.045)
    outer = Sculpt("hood_outer")                 # the uncarved cowl: the seam and the knob are laid on it
    outer.ops = list(hood.ops)
    hood.sub(A, k=0.012)                         # the hollow: deep (16.5 cm), its back rounded
    out.append(SP("hood", hood, "cloth2", "bone:head", 420, to_model=hood_tf))
    # the carved chalk rim: a FLAT frame in the arch's plane, 4.2 cm wide, its face 1.2 cm proud of the snout, its
    # inner edge 3 mm inside the opening, ending at the chin in a pointed tab on the bib (the sheet's rim)
    rim = Sculpt("hood_rim")
    # (fix 5: no pointed chin tab: it read as a beak / fang under the opening; the rim's foot is a broad flat course)
    rim.add(ArchRing(A, AUB_RIM_W, -0.012, 0.030, r=0.005, inset=-0.003, width_bot=AUB_RIM_W + 0.012), k=0.0)
    out.append(SP("hood_rim", rim, "chalk", "bone:head", 200, 0.5, to_model=hood_tf))
    # the knob: a small ROUND chalk knob (crown 1.19 -> top 1.257: 4.5 % of the figure). No point on it: over a
    # pale cowl with a dark opening a tip is the one silhouette rule 0.1 forbids.
    knob = Sculpt("knob")
    kc = np.array([-0.024, 0.005, 1.217])
    # (fix 5) a squat BUN seated on the crown: a broad foot sunk into the cowl + a low round cap (a ball tangent to the
    # crown read as a ball on a neck: an antenna)
    knob.add(Ellipsoid(kc + (0, 0, -0.026), (0.052, 0.050, 0.026)), k=0.0)
    knob.add(Ellipsoid(kc + (0, 0, 0.002), (0.034, 0.034, 0.026)), k=0.018)
    out.append(SP("knob", knob, "chalk", "bone:head", 50, 0.6, to_model=hood_tf))
    # the hood mark: ONE accent seam (brief §2.1) from the rim's crown over the crown (under the knob) and down the
    # back, a tube on the cowl with a painted dark channel either side (two seams meeting at the knob drew a
    # pointed arch up the pale hood: never)
    seam = Sculpt("seam")
    ang = np.radians(np.linspace(-47, 128, 15))          # -47 deg: just over the rim's crown (the arch top)
    ln = onto(outer, np.stack([np.full(len(ang), -0.024), 0.02 + 0.30 * np.sin(ang), 0.93 + 0.30 * np.cos(ang)], 1))
    for _ in range(2):                                   # (bunched projections over the nape folded the tube)
        ln[1:-1] = (ln[:-2] + 2 * ln[1:-1] + ln[2:]) / 4
        ln = onto(outer, ln)
    seam.add(Tube(onto(outer, ln, lift=0.002), [0.0150] * len(ln), k=0.006), k=0.0)
    out.append(SP("seam", seam, "accent", "bone:head", 72, 0.5, to_model=hood_tf,
                  meta={"halo": ("hood", [ln], 0.0125, 0.034, "#38414C", 0.92)}))
    # the light: ONE soft ellipsoid a little below the opening's middle, 6 cm behind the rim's plane, wider than
    # tall (rule 0.2), in the arch's frame (it faces the camera through the leaned opening)
    # (fix round 3) ONE soft core in the MIDDLE of the hollow, 8 cm back, 10 x 6 cm (wider than tall), in two see-through
    # shells (HOOD_HALOS): dark hollow above, below and to both sides. The wide low lens of fix 5 (80 % of the opening,
    # on the sill) read as a tongue in an open mouth; the hard 13 x 8 cm oval before it as a pupil.
    # (fix round 4) centred: 0.5 of the opening from the sill at eye level (the plane leans back 14 deg: deeper reads
    # lower), its front 3 cm behind the opening; a soft halo round it (hood_light)
    hood_light(A.at(0.0, 0.024, 0.060), out, to_model=hood_tf, radii=(0.042, 0.025, 0.026), axes=A.ax)

    # ── BODY: a straight-folded cloak bell to the shins, a pointed hem, chalk stoles, a dawnglass clasp ──────
    cloak = Sculpt("cloak")
    prof = [(0.06, 0.392), (0.20, 0.372), (0.40, 0.335), (0.55, 0.305), (0.68, 0.272), (0.78, 0.225), (0.85, 0.17)]
    cl = bell((-0.01, 0.0, 0.0), prof, 0.80, 0.06, 0.85, 0.42)
    shoulders = Ellipsoid((-0.01, 0.0, 0.70), (0.275, 0.24, 0.12))
    cloak.add(cl.displaced(AUB_FOLDS, 0.021), k=0.0)
    cloak.add(shoulders, k=0.06)                                                            # shoulders under the drape

    def hem_cut(P):
        return aub_hem_z(P) - AUB_HEM["z"]
    # the 6-8 cm hem band: a raised lip (painted dark slate, brief §2.4), the hem cut into shallow points (§2.1)
    lip = bell((-0.01, 0.0, 0.0), [(0.08, 0.403), (0.22, 0.384)], 0.80, 0.08, 0.198, 0.43)
    cloak.add(lip.displaced(AUB_FOLDS, 0.021), k=0.005)
    cloak.inter(HalfSpace((0, 0, AUB_HEM["z"]), (0, 0, -1), 1.0).displaced(hem_cut, AUB_HEM["amp"] + 0.01), k=0.004)
    # the cloak stops under the cowl: 0.79 m at the shoulders, 0.74 under the hood's hollow (above, its neck
    # showed through the hollow's floor)
    cloak.inter(HalfSpace((0, 0, 0.79), (0, 0, 1), 1.0).displaced(
        lambda P: 0.05 * (1 - _smooth01((np.abs(P[:, 0] + 0.02) - 0.12) / 0.08)), 0.05), k=0.01)
    out.append(SP("cloak", cloak, "cloth", ("gw_cloak",), 560))
    # chalk-linen stoles down the cloak's front (the sheet: x -0.20..-0.11 and -0.022..+0.078, chin to 0.15):
    # a SHELL of the smooth bell 1.2-2.6 cm out, so they hang flat over the folds and follow the bell's flare
    # exactly (straight boxes laid tip to tip sank into the shoulder bulge: the cloak cut through them as grey
    # slashes). Each ends in the sheet's slanted cut, lower on the inner edge.
    base = Sculpt("cloak_base")
    base.add(cl, k=0.0)
    base.add(shoulders, k=0.06)
    F_base = field_of(base)
    stole = Sculpt("stole")
    outl = []
    STOLES.clear()
    for (x0, x1), (zi, zo) in (((-0.200, -0.110), (0.172, 0.222)), ((-0.022, 0.078), (0.172, 0.212))):
        xin, xout = (x1, x0) if (x0 + x1) / 2 < -0.05 else (x0, x1)
        slope = (zo - zi) / (xout - xin)
        S1 = Sculpt("s1")
        S1.add(RoundBox(((x0 + x1) / 2, -0.30, 0.44), ((x1 - x0) / 2, 0.16, 0.32), 0.006), k=0.0)
        S1.inter(HalfSpace((xin, 0.0, zi), (slope, 0.0, -1.0), 1.0), k=0.006)
        outl.append(("add", sdf.Blend([(o, p_, k_) for o, p_, k_, _ in S1.ops]), 0.0))
        STOLES.append(((x0 + x1) / 2, (x1 - x0) / 2))
    stole.add(Shell(F_base, 0.012, 0.026, ((-0.23, -0.46, 0.10), (0.11, -0.12, 0.78))), k=0.0)
    stole.inter(sdf.Blend(outl), k=0.004)
    out.append(SP("stole", stole, "chalk", ("gw_cloak",), 110, 0.6))
    # the dawnglass clasp between the stoles: a round chalk ring medallion (0.10 m across: the sheet's clasp is
    # the chest's one strong shape) around a domed accent lens
    nrm = np.array([0.0, -1.0, 0.15]) / math.hypot(1.0, 0.15)
    cc = onto(base, np.array([[-0.066, -0.25, 0.625]]), lift=0.016)[0]
    clasp = Sculpt("clasp")
    clasp.add(Torus(cc, 0.032, 0.017, axes=sdf.frame(nrm), rz=0.011).displaced(chips(0.002, 30.0), 0.002), k=0.0)
    out.append(SP("clasp", clasp, "chalk", ("gw_cloak",), 84, 0.45))
    core = Sculpt("clasp_core")
    core.add(Ellipsoid(cc + nrm * 0.002, (0.022, 0.022, 0.009), axes=sdf.frame(nrm)), k=0.0)
    out.append(SP("clasp_core", core, "accent", ("gw_cloak",), 36, 0.45))

    # ── ARMS, FISTS, LEGS, BOOTS ───────────────────────────────────────────────────────────────────────
    sleeves_mitts(L, out, {"R": (-0.31, -0.345, 0.475), "L": (0.205, -0.345, 0.545)}, r_up=0.088, r_fore=0.08)
    boots_legs(L, out, (0.165, -0.035, 0.05), (0.072, 0.105, 0.05), 0.07)

    # ── HAMMER (concept space, rigid on prop.R): pale ash haft, chalk head with wedge faces, stone bindings ──
    hammer_aubade(L, out)
    # ── BACK-LANTERN on its back frame (model space: the frame follows the cloak's and the hood's back) ──────
    bk = sdf.Blend([("add", field_of(cloak), 0.0), ("add", WarpedField(field_of(outer), invert(hood_tf)), 0.0)])
    lantern_aubade(L, out, bk)
    return out


def chamfered(c, half, ax, cut, r=0.006):
    """A box (half extents in the frame `ax`, rows = local X, Y, Z) with all twelve edges cut by `cut` metres at
    45 degrees: a carved stone block (crisp facets, not a soft pillow)."""
    S = Sculpt("chamfered")
    S.add(RoundBox(c, half, r, axes=ax), k=0.0)
    hx, hy, hz = half
    s2 = math.sqrt(2.0)
    for i, j, k_ in ((0, 1, 2), (1, 2, 0), (0, 2, 1)):          # about local Z, X, Y: cut the edges along that axis
        R = np.eye(3)
        c45 = math.cos(math.pi / 4)
        R[[i, i, j, j], [i, j, i, j]] = (c45, -c45, c45, c45)
        b_ = (half[i] + half[j]) / s2 - cut / s2
        hh = [0.0, 0.0, 0.0]
        hh[i], hh[j], hh[k_] = b_, b_, half[k_] * 2 + 0.1
        S.inter(RoundBox(c, tuple(hh), 0.002, axes=R @ ax), k=0.003)
    return sdf.Blend([(o, p_, k2) for o, p_, k2, _ in S.ops])


def hammer_aubade(L, out):
    """The sheet's hammer: a pale ash haft through both fists to ONE hard chalk head (0.25 along the haft x 0.22
    deep x 0.38 tall, the long axis across the haft), its faces carved flat with chamfered edges, the two striking
    ends stepped out a little wider, a stone-blue lashing wrapped round its waist with an X over each face."""
    d = np.asarray(L["haft"], float)
    d /= np.linalg.norm(d)
    g = np.asarray(L["grip_r"], float)
    pom = g - d * 0.215                         # pommel end (the sheet: x -0.515)
    head_c = g + d * 0.73                       # head centre (the sheet: x 0.40, z 0.57)
    up = np.array([-d[2], 0.0, d[0]])           # the head's long axis (perpendicular to the haft, in the view plane)
    ax = np.stack([d, np.cross(up, d), up])     # rows: local X along the haft, Y (+ = back), Z = the long axis
    ey = ax[1]
    haft = Sculpt("haft")                       # straight, a little thicker at the butt; its end buried in the head
    haft.add(RoundCone(pom + d * 0.03, head_c - d * 0.03, 0.025, 0.021), k=0.0)
    out.append(SP("haft", haft, "wood", "bone:prop.R", 56, 0.7))
    grip = Sculpt("grip")
    grip.add(Capsule(pom + d * 0.035, pom + d * 0.085, 0.031), k=0.0)                    # stone-blue wrap
    for i in range(2):
        grip.add(Torus(pom + d * (0.045 + 0.03 * i), 0.029, 0.009, axes=sdf.frame(d)), k=0.006)
    out.append(SP("grip", grip, "stone", "bone:prop.R", 40, 0.6))
    rng = np.random.default_rng(11)
    # the pommel: a small carved chalk block (exact facets)
    pm_l = prism_block(-0.040, 0.040, (0.030, 0.040), (0.026, 0.036), 0.011, rng, 0.0015)
    pax = np.stack([ax[1], ax[2], ax[0]])         # (its long side across the haft, like the head)
    out.append(hull_sp("pommel", [to_world(pm_l, pom, pax)], "chalk", "bone:prop.R"))
    # THE HEAD (the sheet's carved chalk block, exact flat facets: the chamfered SDF decimated into a soft pillow):
    # a waist block the haft enters, and two heavier striking blocks stepped out 1.6-1.8 cm round it, each a WEDGE
    # (its striking face 1.4 cm smaller than its inner face), every edge chamfered 2.4 cm, two corners broken off,
    # every point moved up to 3 mm (hand-carved)
    core = carved_block(-0.100, 0.100, (0.100, 0.088), (0.100, 0.088), 0.012, rng, 0.002)
    ends = []
    for sz, chip in ((1, (24, 29)), (-1, (27, 30))):
        blk = carved_block(sz * 0.088, sz * 0.198, (0.118, 0.105), (0.104, 0.092), 0.024, rng, 0.003, chips=chip)
        ends.append(blk)
    out.append(hull_sp("hammer_head", [to_world(h, head_c, ax) for h in [core] + ends], "chalk", "bone:prop.R",
                       meta={"carved": (tuple(head_c), ax.tolist())}))
    # THE LASHING (stone-blue dialstone straps, flat, lying ON the faces): a wrap band round the waist block, and an
    # X of straps over the front and the back face crossing on the band, each strap's ends tucked under the striking
    # blocks (they stay inside the head's outline; thin decimated straps had shot out past it as blades)
    band = [chamfer_ring(z_, 0.107, 0.095, 0.016) for z_ in (-0.030, 0.030)]
    hulls = [to_world(np.array(band[0] + band[1]), head_c, ax)]
    th = math.atan2(0.118, 0.094)
    hl = math.hypot(0.094, 0.118) - 0.012
    for fy in (-1, 1):
        for sg in (-1, 1):
            u = np.array([math.cos(th), 0.0, sg * math.sin(th)])
            w = np.array([-sg * math.sin(th), 0.0, math.cos(th)])
            sax = np.stack([u, np.array([0.0, 1.0, 0.0]), w])
            lc = np.array([0.0, fy * (0.088 + 0.004), 0.0])
            hulls.append(to_world(box_pts(lc, (hl, 0.0055, 0.0165), sax), head_c, ax))
    # the haft collar: an octagonal stone ferrule where the haft enters the head
    fer = prism_block(-0.135, -0.098, (0.030, 0.030), (0.030, 0.030), 0.010)
    hulls.append(to_world(fer, head_c, np.stack([ax[1], ax[2], ax[0]])))
    out.append(hull_sp("hammer_bind", hulls, "stone", "bone:prop.R",
                       meta={"straps": (tuple(head_c), ax.tolist(), th)}))


# the Aubade back-lantern (model space): a TALL narrow dawnglass lantern (the sheet's: one tall pane per face, a
# soft glowing core in each; the 0.56 m two-pane house of fix 3 read as a squat display cabinet), body 0.47 x 0.27 m,
# panes 0.95-1.42 m (portrait 1:1.9 on the front), a chalk cap course, a low four-sided roof with a 3 cm eave to
# 1.535 m, four short corner spires to 1.62. It sits right behind the hood on a pale ash BACK FRAME: two posts down
# the back to the waist, a shoulder yoke, a waist bar, the shelf on the posts' tops and two braces under its back.
AUB_LANT = dict(hw=0.285, hd=0.165, z_base=0.915, z_pane=(0.950, 1.420), z_cap=1.452, z_eave=1.472, z_ridge=1.535,
                post=0.026, eave=0.032)
AUB_FRAME = dict(x=0.19, z_waist=0.50, z_yoke=0.72, r=0.024)


def lantern_aubade(L, out, back=None):
    """Body 0.56 x 0.28 m, 0.92-1.53 m (brief: 0.62 wide with the eave, body 0.92-1.48, roof to 1.52, spires to
    1.62): a chalk base slab, four chalk corner posts, a chalk mullion down the middle of the front and the back,
    dawnglass panes (glossy, not emissive) each carrying a lit accent slab (the core: from the front over the hood,
    the sides and the back), a chalk cap course, a low four-sided roof with a 3 cm eave and a square light well, four
    short corner spires; under it the ash shelf and back frame (`back`: the body's outermost back surface)."""
    A = AUB_LANT
    yl = L["lantern_y"]
    hw, hd, po = A["hw"], A["hd"], A["post"]
    zp0, zp1 = A["z_pane"]
    zb, zc, ze, zr = A["z_base"], A["z_cap"], A["z_eave"], A["z_ridge"]
    # four chalk corner posts (exact carved bars, flat facets; no mullions: one tall pane per face)
    rng = np.random.default_rng(23)
    posts = []
    for px in (-1, 1):
        for py in (-1, 1):
            c0 = np.array([px * (hw - po), yl + py * (hd - po), 0.0])
            blk = prism_block(zb + 0.004, zc + 0.004, (po, po), (po * 0.92, po * 0.92), 0.007, rng, 0.0015)
            posts.append(blk + c0)
    out.append(hull_sp("lantern_bars", posts, "chalk", "bone:chest"))
    # base slab + cap course (chalk plates, a little wider than the posts)
    slabs = Sculpt("lantern_slabs")
    slabs.add(RoundBox((0, yl, zb + 0.016), (hw + 0.016, hd + 0.016, 0.022), 0.009), k=0.0)
    slabs.add(RoundBox((0, yl, (zp1 + zc) / 2), (hw + 0.010, hd + 0.010, (zc - zp1) / 2 + 0.003), 0.008), k=0.0)
    out.append(SP("lantern_slabs", slabs, "chalk", "bone:chest", 56, 0.8))
    # the glass: one box inset 1.5 cm behind the post faces
    glass = Sculpt("lantern_glass")
    glass.add(RoundBox((0, yl, (zp0 + zp1) / 2), (hw - 0.015, hd - 0.015, (zp1 - zp0) / 2 + 0.004), 0.010), k=0.0)
    out.append(SP("lantern_glass", glass, "dawnglass", "bone:chest", 36, 0.8))
    # the light: ONE soft oval core on every pane (the sheet's glow in each tall pane; flat slabs read as uniform blue
    # rectangles), a thin lozenge 7 mm proud of the glass, exact (12-gon front / back, 10-gon sides); the frosted
    # dawnglass round it is painted (a pale falloff to a deeper margin at the frame); + the light well under the roof
    zm = (zp0 + zp1) / 2 + 0.012
    hz = (zp1 - zp0) / 2
    cores, ovals = [], []
    for py in (-1, 1):                             # front / back faces (normal -Y / +Y)
        cax = np.array([[1.0, 0, 0], [0, py * 1.0, 0], [0, 0, 1.0]])
        c_ = np.array([0.0, yl + py * (hd - 0.015 + 0.002), zm])
        # (fix round 4: a smaller core in a soft glow, the accent gate 5-6 %: 7.3 % with the roof disc, the hood lining
        # and a hard 'sticker' oval ringed by a flat halo)
        a_, b_ = (hw - 2 * po) * 0.44 * 0.72, hz * 0.62 * 0.72
        cores.append(dome_oval(c_, cax, a_, b_, 0.024, 16))
        ovals.append((tuple(c_), cax.tolist(), a_, b_))
    for px in (-1, 1):                             # the side panes
        cax = np.array([[0, 1.0, 0], [px * 1.0, 0, 0], [0, 0, 1.0]])
        c_ = np.array([px * (hw - 0.015 + 0.002), yl, zm])
        a_, b_ = (hd - 2 * po) * 0.74 * 0.72, hz * 0.68 * 0.72
        cores.append(dome_oval(c_, cax, a_, b_, 0.018, 12))
        ovals.append((tuple(c_), cax.tolist(), a_, b_))
    # (fix round 4) no light well in the roof: its disc was accent the 5-6 % gate could not afford, and a pale lit
    # disc on top of the box; the roof is a closed chalk top
    # (fix round 3) the game mesh: one domed FAN per core (16 / 12 tris, smooth shaded; the 3-ring dome hulls cost 398)
    V_, F_ = [], []
    for (c_, cax_, a_, b_), nn_ in zip(ovals, (16, 16, 12, 12)):
        v_, f_ = _dome_fan(np.asarray(c_, float), np.asarray(cax_, float), a_, b_, 0.022, nn_)
        F_.append(f_ + len(V_))
        V_ += list(v_)
    S_ = Sculpt("lantern_glow")
    S_.add(HullField(cores), k=0.0)
    out.append(SP("lantern_glow", S_, "accent", "bone:chest", len(np.vstack(F_)), 0.6,
                  meta={"smooth": True, "low_mesh": (np.array(V_), np.vstack(F_))}))
    # (fix round 3) the glow round each core: two see-through accent fans on the glass (the hood lining's material), so
    # the team light spreads into the dawnglass and falls off to the frame instead of stopping at a hard oval
    # (fix round 4) the glow round each core is the shared soft halo (wick_common: vertex alpha 0.85 at the core's
    # outline -> 0 at 1.6 x), not a flat see-through ring (it read as a sticker in a ring)
    V_, F_ = [], []
    for c_, cax_, a_, b_ in ovals:
        cax_ = np.asarray(cax_, float)
        v_, f_ = wc.halo_mesh(np.asarray(c_, float), cax_[0], cax_[1], cax_[2], a_, 0.004, b_, seg=10,
                              depth=1.0, rings=(0.0, 1.0 / wc.HALO_LAMP_SCALE, 1.0), scale=wc.HALO_LAMP_SCALE)
        F_.append(f_ + len(V_))
        V_ += list(v_)
    S_ = Sculpt("lantern_halo")
    S_.add(HullField(cores), k=0.0)
    out.append(SP("lantern_halo", S_, wc.HALO_LAMP_MAT, "bone:chest", len(np.vstack(F_)), 0.6,
                  meta={"smooth": True, "low_mesh": (np.array(V_), np.vstack(F_))}))
    _AUB_OVALS[:] = ovals
    # the roof: an eave course + a low four-sided top (ridge flat at the light well), a 3 cm overhang only
    roof = Sculpt("lantern_roof")
    rh, rd = hw + A["eave"], hd + A["eave"]

    def slope(P):                                  # zr at the light well's rim, ze at the eave line
        q = np.abs(P - np.array([0.0, yl, 0.0]))
        f = np.clip(np.maximum((q[:, 0] - 0.10) / (rh - 0.10), (q[:, 1] - 0.09) / (rd - 0.09)), 0, 1)
        return -(ze + (zr - ze) * (1 - f))
    roof.add(RoundBox((0, yl, (zc + zr) / 2), (rh, rd, (zr - zc) / 2), 0.012), k=0.0)
    roof.inter(sdf.Displaced(HalfSpace((0, yl, 0.0), (0, 0, 1), 3.0), slope, 0.2), k=0.006)
    out.append(SP("lantern_roof", roof, "chalk", "bone:chest", 120, 0.8))
    # four short corner spires on the post lines (to 1.62 front, 1.60 back); far off the hood's axis
    sp = Sculpt("spires")
    for px in (-1, 1):
        for py in (-1, 1):
            c = np.array([px * (hw - po + 0.004), yl + py * (hd - po + 0.004), ze])
            top = 1.62 if py < 0 else 1.60
            sp.add(RoundBox(c + (0, 0, 0.012), (0.026, 0.026, 0.016), 0.008), k=0.0)            # a plinth
            sp.add(RoundCone(c + (0, 0, 0.03), c + (0, 0, top - ze), 0.020, 0.004), k=0.008)
    out.append(SP("spires", sp, "chalk", "bone:chest", 88, 0.6))
    # the ash shelf under the box (a plank tray, the lantern stands on it)
    sh = Sculpt("shelf")
    sh.add(RoundBox((0, yl, zb - 0.014), (hw + 0.030, hd + 0.028, 0.016), 0.006), k=0.0)
    out.append(SP("shelf", sh, "wood", "bone:chest", 40, 0.8))
    # the back frame: two posts that follow the back (2.8 cm off it) from the waist bar up to the shelf's front edge,
    # a shoulder yoke and a waist bar between them, a bar under the shelf, two braces from the yoke up to the shelf's
    # back edge (the box's weight sits on the posts: no cantilever)
    F = AUB_FRAME
    xs_, zw, zy = F["x"], F["z_waist"], F["z_yoke"]
    z_top = zb - 0.032
    y_top = yl - hd + 0.035
    zs = np.linspace(zw - 0.02, z_top, 16)
    segs = []
    fr = Sculpt("frame_posts")
    post_y = {}
    for px in (-1, 1):
        surf = back_line(back, px * xs_, zs, off=0.030) if back is not None else np.full(len(zs), 0.27)
        line = np.interp(zs, [zs[0], zs[-1]], [surf[0], y_top])
        ys = np.maximum(line, surf)
        for _ in range(4):                           # a straight-ish post, never into the back
            ys[1:-1] = (ys[:-2] + 2 * ys[1:-1] + ys[2:]) / 4
            ys = np.maximum(ys, surf - 0.006)
        pts = np.stack([np.full(len(zs), px * xs_), ys, zs], 1)[::3]
        pts = np.vstack([pts, [[px * xs_, y_top, z_top]]]) if pts[-1, 2] < z_top - 0.01 else pts
        fr.add(Tube(pts, [F["r"]] * len(pts), k=0.01), k=0.0)
        segs += [(tuple(a_), tuple(b_)) for a_, b_ in zip(pts[:-1], pts[1:])]
        post_y[px] = (zs, ys)

    def y_at(z):
        return 0.5 * (np.interp(z, *post_y[-1]) + np.interp(z, *post_y[1]))
    for z_, rr in ((zw, 0.021), (zy, 0.020), (z_top - 0.004, 0.020)):          # waist bar, yoke, bar under the shelf
        xb = np.linspace(-xs_ - 0.03, xs_ + 0.03, 9)
        yb = np.full(len(xb), y_at(z_) + 0.004)
        if back is not None:                         # bowed over the back where it bulges (never buried in it)
            yb = np.maximum(yb, np.array([back_line(back, x_, [z_], off=0.026)[0] for x_ in xb]))
            for _ in range(2):
                yb[1:-1] = np.maximum((yb[:-2] + 2 * yb[1:-1] + yb[2:]) / 4, yb[1:-1])
        pts = np.stack([xb, yb, np.full(len(xb), z_)], 1)
        fr.add(Tube(pts, [rr] * len(pts), k=0.01), k=0.006)
        segs += [(tuple(a_), tuple(b_)) for a_, b_ in zip(pts[:-1], pts[1:])]
    for px in (-1, 1):                               # braces: from the posts at the yoke to the shelf's back edge
        a_ = np.array([px * xs_, y_at(zy + 0.02), zy + 0.02])
        b_ = np.array([px * xs_, yl + hd - 0.02, zb - 0.034])
        fr.add(Tube(np.array([a_, b_]), [0.019, 0.019], k=0.0), k=0.008)
        segs.append((tuple(a_), tuple(b_)))
    _SEGS["frame"] = segs
    out.append(SP("frame_posts", fr, "wood", "bone:chest", 150, 0.8))


# ══ SERENADE (concept space: front x = (px - 527) / 754.5, z = (1353 - py) / 754.5) ════════════════════════
# the opening: the sheet's broad flat-bottomed arch (0.33 wide x 0.25 tall in the plane, 0.87-1.11 m) in the dome's
# front plane (leaned back 8 degrees: the top on the dome, the sill on the chin; 16 degrees pushed the sill out as a
# lower jaw), with no brow over it, so the 52-degree camera looks into the lit hollow (under the old forward brow it
# saw a dark arc, the light and the collar: a mask with a grin). Framed by a soft dark felt roll, 5 cm over the brow
# and the sides, 2.4 cm at the sill.
# (fix 4: a BELL arch, 0.36 wide at the sill narrowing to a round 0.30 top: the near-round opening in a thick dark
# roll read as a porthole / diving helmet; the felt roll 3.6 cm, not 5)
SER_ARCH = Arch((-0.035, -0.229, 0.975), 8.0, hw_bot=0.180, hw_mid=0.150, h_bot=0.105, h_top=0.168, r_corner=0.045,
                w0=-0.40, w1=0.185, kb=0.06, z_floor=0.885)
SER_RIM_W, SER_RIM_WB = 0.036, 0.026
# (fix round 3) the hollow's deep part grown 2 cm (from 4 cm in): hood texels there are ink whatever the carve says (a
# decimated fold of the hood's own floor stood up in the back corner as a tan sliver)
SER_ARCH_DEEP = Arch((-0.035, -0.229, 0.975), 8.0, hw_bot=0.200, hw_mid=0.170, h_bot=0.125, h_top=0.185, r_corner=0.05,
                     w0=0.04, w1=0.21, kb=0.06, z_floor=0.86)
# the body parts under the hollow are cut down further (6 cm under its floor): the head bone carries the hood in idle,
# and the chest-bound mantle collar rose through the hood's floor by a few cm in the breathing pose
SER_ARCH_SINK = Arch((-0.035, -0.229, 0.975), 8.0, hw_bot=0.200, hw_mid=0.170, h_bot=0.20, h_top=0.185, r_corner=0.05,
                     w0=0.04, w1=0.21, kb=0.06, z_floor=0.825)
SER_BAND_HW = 0.0215                          # the crown band: 3.1 cm over the opening (6 cm read as a headband)


def _ser_band_hw(a, extra=0.0):
    """The crown band's half width: 3.1 cm over the opening, 3.7 cm round the sides and the back (the side facings'
    team read: there the band is the hood mark the camera sees)."""
    return SER_BAND_HW + extra + 0.003 * (1.0 - np.clip(-np.sin(a) * 2.0, 0.0, 1.0))
SER_BODY = compose(zmap([(0.0, 0.0), (0.15, 0.15), (1.33, 1.25), (1.6, 1.4789)]), scale_about((0, 0, 0), (0.94, 1, 1)))


def _ser_band_z(a):
    """The crown band's height round the hood axis (a = 0 at +X, -pi/2 at the front): it ARCHES CLOSE over the
    opening, 1.2 cm above the felt rim all along the arch's round top (the sheet's glowing brow arc), and runs level at
    1.10 m round the sides and the back."""
    x = 0.238 * np.cos(a)
    arch = 0.975 + 0.99 * (SER_ARCH.vt + SER_RIM_W + 0.012 + SER_BAND_HW) * np.sqrt(
        np.clip(1.0 - (x / (SER_ARCH.hm + SER_RIM_W + 0.026)) ** 2, 0.0, 1.0))
    front = np.clip(-np.sin(a) * 2.0, 0.0, 1.0)
    return 1.10 + np.maximum(arch - 1.10, 0.0) * front


class WarpedField(sdf.Prim):
    """A field sculpted in concept space read in model space (approximate distance: the warps are near-rigid)."""

    def __init__(self, F, to_concept):
        self.F, self.inv = F, to_concept

    def bounds(self):
        raise NotImplementedError

    def d(self, P):
        return self.F.d(self.inv(_arr(P)))


def back_line(F, x, zs, y_max=0.75, off=0.0):
    """The outermost back surface of the field F (model space) at x for each z: the largest y in 0..y_max with
    F < 0 (sampled at 5 mm), + off. For struts and straps that must lie ON the back, not float off it or sink in."""
    ys = np.arange(0.0, y_max, 0.005)
    out = []
    for z in zs:
        P = np.stack([np.full(len(ys), x), ys, np.full(len(ys), z)], 1)
        inside = np.nonzero(F.d(P) < 0)[0]
        out.append((ys[inside.max()] if len(inside) else 0.0) + off)
    return np.array(out)


def serenade_parts(L: dict) -> list:
    out: list = []
    body = SER_BODY
    hood_tf = compose(shift(dx=0.035), body)
    # ── HOOD: a low broad sand-felt dome on a thick dark rolled collar, the opening a rounded arch ─────────
    A = SER_ARCH
    hc = np.array([-0.035, 0.03, 1.07])
    hood = Sculpt("hood")
    hood.add(Ellipsoid(hc, (0.238, 0.245, 0.26)), k=0.0)
    hood.add(Ellipsoid(hc + (0, 0.05, -0.12), (0.245, 0.19, 0.145)), k=0.06)          # the nape (above the collar roll)
    hood.add(Ellipsoid(hc + (0, 0.0, 0.03), (0.236, 0.24, 0.23)).displaced(lambda P: 0.003 * NOISE.fbm(P, 22.0, 2), 0.003), k=0.02)
    hood.add(Ellipsoid((hc[0], -0.09, 0.875), (0.205, 0.16, 0.095)), k=0.05)         # the chin: the sill's floor
    F_dome = field_of(hood)                      # (the band is laid on the dome alone: over the snout's blend crease
                                                 # its shell folded into non-manifold slivers the decimation kept)
    # the dome's front comes forward to the rim's plane round the opening (it carries the felt roll)
    hood.add(ArchPrism(A, SER_RIM_W + 0.012, 0.004, 0.11, g_bot=SER_RIM_WB + 0.02), k=0.035)
    outer = Sculpt("hood_outer")
    outer.ops = list(hood.ops)
    F_out = field_of(outer)
    hood.sub(A, k=0.014)                                                                  # the hollow (17.5 cm deep)
    out.append(SP("hood", hood, "cloth2", "bone:head", 270, to_model=hood_tf))      # (r5: 296; the clean lows' tris)
    # the dark felt cowl edge: a soft roll in the opening's plane (2D band, 2.4 cm thick, rounded 1 cm), 3.6 cm wide
    # over the brow and the sides, 2.6 cm at the sill
    rim = Sculpt("hood_rim")
    rim.add(ArchRing(A, SER_RIM_W, -0.012, 0.028, r=0.010, inset=-0.004, width_bot=SER_RIM_WB).displaced(
        lambda P: 0.002 * NOISE.fbm(P, 20.0, 2), 0.002), k=0.0)
    out.append(SP("hood_rim", rim, "under", "bone:head", 104, 0.55, to_model=hood_tf))
    # the rolled felt collar: a thick dark roll round the hood's foot at the SIDES and the BACK (riding up to 1.0 m
    # at the back, where the sheet shows it above the mantle); at the front it dives under the mantle's lapels (its
    # front arc under the chin read as a beard from the game camera)
    col = Sculpt("collar")
    ax_c = np.diag([1.0, 1 / 1.18, 1.0]) @ sdf.rot_x(-21.0)
    inv_c = np.linalg.inv(ax_c)
    ts = np.radians(np.linspace(-38.0, 218.0, 19))                       # (-90 = the front: 104 degrees left out)
    pts = np.array([(-0.035, 0.035, 0.90) + inv_c @ np.array([0.232 * math.cos(t), 0.232 * math.sin(t), 0.0]) for t in ts])
    fade = np.clip(np.minimum(ts - ts[0], ts[-1] - ts) / math.radians(40.0), 0, 1)
    pts[:, 2] -= 0.035 * (1 - fade)                                      # the ends dive down under the lapels
    col.add(Tube(pts, list(0.024 + 0.024 * fade ** 0.7), k=0.012).displaced(
        lambda P: 0.003 * NOISE.fbm(P, 18.0, 2), 0.003), k=0.0)
    # (fix round 6) the GAME mesh is an exact 6-sided tube through the same roll (decimated, it broke into shards
    # behind the hood); its ends dive under the lapels (no caps)
    ci = np.round(np.linspace(0, len(pts) - 1, 8)).astype(int)
    cV, cF = wc.tube_low(pts[ci], (0.024 + 0.024 * fade ** 0.7)[ci] + 0.001, nsides=6, caps=(False, False))
    out.append(SP("collar", col, "under", "bone:head", len(cF), 0.8, to_model=hood_tf,
                  meta={"low_mesh": (cV, cF), "smooth": True}))
    # the hood mark: a FLAT accent crown band 5 cm wide inlaid round the dome (a shell slice), arching over the
    # opening just above the felt rim; dark felt edges either side are painted (value contrast under either tint)
    cb = Sculpt("crown_band")
    box = (np.array([-0.31, -0.25, 1.08]), np.array([0.24, 0.31, 1.27]))
    cb.add(Shell(F_dome, -0.010, 0.010, box), k=0.0)          # (-3..7 mm: the decimated felt tore through its edges)
    cb.inter(AngleSlab(hc[0], hc[1], _ser_band_z, _ser_band_hw, box), k=0.003)
    cb.sub(ArchPrism(A, SER_RIM_W + 0.004, -0.4, 0.4), k=0.004)
    # (fix 4) the GAME mesh is an exact ribbon laid ON the cowl's outer surface (the snout included), 6 mm proud: the
    # decimated inlaid shell showed sand teeth through both edges (the snout's blend rose through it)
    out.append(SP("crown_band", cb, "accent", "bone:head", 0, 0.4, to_model=hood_tf,
                  meta={"halo": ("hood", ("slab", hc[0], hc[1], _ser_band_z), SER_BAND_HW + 0.001, 0.036, "#3B2F26", 0.95),
                        "low_mesh": band_ribbon(F_out, hc[0], hc[1], _ser_band_z, _ser_band_hw, 24, lift=0.005)}))
    # the light: one soft core in the middle of the hollow, 8 cm behind the rim's plane, 12 x 7 cm, in its see-through
    # shells (rule 0.2; fix round 3: the wide low lens on the sill read as a tongue)
    # (fix round 3) an ink floor plate over the hollow's deep floor: the decimated mantle's collar bridged the
    # clearance carve and rose through the hood's floor in the back corner (a tan / grey sliver in the dark)
    zf = A.zf + 0.012                             # (1.2 cm up: the head-bound hood dips in the idle breath)
    fp = np.array([[x_, A.at(0.0, 0.0, w_)[1], zf] for w_ in (0.035, 0.115, 0.200) for x_ in (A.o[0] - 0.172, A.o[0], A.o[0] + 0.172)])
    fq = []
    for r_ in range(2):
        for c_ in range(2):
            a_, b_ = r_ * 3 + c_, r_ * 3 + c_ + 1
            fq += [(a_, b_, b_ + 3), (a_, b_ + 3, a_ + 3)]          # (wound to face up)
    fpS = Sculpt("hollow_floor")
    fpS.add(RoundBox(tuple(fp.mean(0)), (0.16, 0.07, 0.003), 0.001), k=0.0)
    out.append(SP("hollow_floor", fpS, "under", "bone:head", 8, 0.6, to_model=hood_tf,
                  meta={"low_mesh": (fp, np.array(fq, np.int64))}))
    # (fix round 4) centred between the hollow's floor and the arch top at eye level, 3 cm back, a little smaller
    # (14 x 8 cm read as one big pupil), in its halo
    hood_light(A.at(0.0, 0.040, 0.060), out, to_model=hood_tf, radii=(0.048, 0.028, 0.028), axes=A.ax)

    # ── BODY: wide umber bell, two dark hem bands, a belt, the sand mantle with pointed lapels ───────────────
    tunic = Sculpt("cloak")
    # above the belt the tunic only has to stay inside the mantle (it never shows there): kept 5-7 cm in, so the
    # decimated lows cannot cross (they did: umber patches through the sand mantle)
    prof = [(0.15, 0.452), (0.24, 0.452), (0.40, 0.415), (0.55, 0.37), (0.70, 0.305), (0.80, 0.225), (0.92, 0.15)]
    tunic.add(bell((-0.0, 0.0, 0.0), prof, 0.80, 0.10, 0.93, 0.48).displaced(SER_FOLDS, 0.012), k=0.0)
    for c_, R_, r_, rz_, dep, kk in SER_TUNIC_BANDS:
        tunic.add(Torus((0.0, 0.0, c_), R_, r_, axes=np.diag([1.0, 1 / dep, 1.0]), rz=rz_), k=kk)

    def under_dome(P):
        """the bell's underside bulges 3.5 cm down inside the hem roll (a felt cushion): cut flat at 0.15 m it
        decimated into a fan of long triangles that shaded as a radial 'lampshade' when the death pose shows it"""
        P = _arr(P)
        q = np.clip(1.0 - (P[:, 0] ** 2 + (P[:, 1] / 0.8) ** 2) / 0.40 ** 2, 0.0, 1.0)
        return -0.035 * q ** 0.8
    tunic.inter(HalfSpace((0, 0, 0.15), (0, 0, -1), 1.0).displaced(under_dome, 0.04), k=0.01)
    tunic.sub(DomainWarp(SER_ARCH, lambda P: _arr(P) + np.array([-0.035, 0.0, 0.0]), 0.04), k=0.01)   # (not in the hollow)
    # (fix round 3) and 2.5 cm clear of its walls: cut flush with the hollow, the decimated tunic poked through its
    # back corners (a tan sliver low in the dark)
    tunic.sub(DomainWarp(SER_ARCH_SINK, lambda P: _arr(P) + np.array([-0.035, 0.0, 0.0]), 0.06), k=0.01)
    out.append(SP("cloak", tunic, "cloth", ("gw_cloak",), 372, to_model=body))       # (r5: 400; most of it under the mantle)
    mantle = Sculpt("mantle")
    # a thick felt capelet (8 cm: a thin shell decimates into a zigzag rim) with ROUNDED shoulders (a convex
    # profile: a straight cone read as a lampshade), soft folds
    mantle.add(capelet((-0.03, 0.02, 0.0), 0.95, 0.23, 0.625, 0.455, 0.08, depth=0.86).displaced(
        folds(0.005, 6, cx=-0.03, cy=0.02, warp=1.0), 0.005), k=0.0)

    def lapels(P):
        """two pointed lapels either side of a V collar notch at the front (the sheet's mantle: the hood's chin
        sits in the V), a smooth edge elsewhere (a scallop here decimated into a torn-paper zigzag)"""
        a = np.arctan2(P[:, 1] - 0.02, P[:, 0] + 0.03) + np.pi / 2       # 0 = the front
        a = (a + np.pi) % (2 * np.pi) - np.pi
        pts = np.zeros(len(P))
        for c in (-0.42, 0.42):
            pts = np.maximum(pts, np.clip(1 - np.abs(a - c) / 0.27, 0, 1) ** 1.2)
        notch = np.clip(1 - np.abs(a) / 0.26, 0, 1) ** 1.3
        # the back hangs lower in a soft U between the frame posts (the sheet: 0.66 m at the centre, 0.78 at the
        # shoulder blades); the first build cut it dead straight at 0.745
        back = _smooth01((np.abs(a) - 1.55) / 1.3) ** 1.2
        return -0.07 * pts + 0.16 * notch - 0.085 * back
    mantle.inter(HalfSpace((0, 0, 0.745), (0, 0, -1), 1.0).displaced(lapels, 0.3), k=0.03)
    # a ROLLED felt edge all round the hem and the lapels (a tube on the shell's mid line just over the cut: the cut
    # edge alone read paper-thin and decimated jagged)
    al = np.linspace(-np.pi, np.pi, 73)[:-1]
    probe = np.stack([-0.03 + np.sin(al), 0.02 - np.cos(al), np.zeros(len(al))], 1)    # direction samples
    ze = 0.745 + lapels(probe) + 0.010
    u_ = np.clip((0.95 - ze) / (0.95 - 0.625), 0, 1)
    rmid = 0.23 + (0.455 - 0.23) * u_ ** 0.6 - 0.040
    th = np.arctan2(-np.cos(al) / 0.86, np.sin(al))
    edge = np.stack([-0.03 + rmid * np.cos(th), 0.02 + rmid * 0.86 * np.sin(th), ze], 1)
    order = np.roll(np.arange(len(al)), -int(np.argmin(np.abs(al))))      # start at the front centre
    run = order[ze[order] < 0.90]                     # (not over the top of the V under the chin)
    mantle.add(Tube(edge[run], [0.026] * len(run), k=0.012), k=0.02)
    # its collar's front ran through the hood's hollow (sand in the dark opening): cut away inside the hollow (the
    # hood's sculpt space is the mantle's shifted 5 mm in x)
    mantle.sub(DomainWarp(SER_ARCH, lambda P: _arr(P) + np.array([-0.005, 0.0, 0.0]), 0.01), k=0.01)
    # (fix round 3) and 2 cm clear of the hollow's deep part (its collar rose through the hollow's floor in the back
    # corner: a tan sliver in the dark)
    mantle.sub(DomainWarp(SER_ARCH_SINK, lambda P: _arr(P) + np.array([-0.005, 0.0, 0.0]), 0.03), k=0.01)
    mantle_tf = compose(shift(dx=0.03), body)
    # (fix round 5) the GAME mesh is an exact radial low over the capelet (columns on the notch, the lapel points and
    # round the back, rows from the collar to the hem, one turned-under lip row): the decimated felt shell broke into
    # torn-paper shards behind the hood and a spike under the chin
    F_m = field_of(mantle)

    def m_rows(a):
        hz = 0.745 + float(lapels(np.array([[-0.03 + math.sin(a), 0.02 - math.cos(a), 0.0]]))[0])
        zb = hz - 0.006
        zt = 0.936
        return [zt, zt + (zb - zt) * 0.36, zt + (zb - zt) * 0.70, zb]
    m_cols = [0.0, 8.0, 15.0, 24.0, 34.0, 46.0, 60.0, 75.0, 90.0, 105.0, 120.0, 135.0, 150.0, 165.0, 180.0]
    m_cols = sorted(set(m_cols + [-c_ for c_ in m_cols if 0.0 < c_ < 180.0]))
    mV, mF = wc.radial_low(F_m, -0.03, 0.02, m_cols, m_rows, rmax=0.62, lip=[(0.030, 0.008)])
    # (fix round 6) rows whose ray found no felt (the collar's front is carved out of the hood's hollow, the V notch
    # under the chin) were filled in 5 cm off the axis by radial_low: those faces stood up inside the hollow as lit
    # slabs. Drop every face with a vertex off the felt's surface (the notch stays open; the lip row follows its column)
    nv_ = len(m_rows(0.0)) + 1
    off = np.abs(F_m.d(mV)) > 0.012
    off = off.reshape(-1, nv_)
    off[:, -1] = off[:, -2]
    off = off.reshape(-1)
    scene.log(f"greatwick mantle low: {int(off.sum())} of {len(off)} vertices off the felt, "
              f"{int(off[mF].any(1).sum())} faces dropped")
    mF = mF[~off[mF].any(1)]
    used = np.unique(mF)
    remap = np.full(len(mV), -1, np.int64)
    remap[used] = np.arange(len(used))
    mV, mF = mV[used], remap[mF]
    out.append(SP("mantle", mantle, "cloth2", "auto", len(mF), to_model=mantle_tf,
                  meta={"low_mesh": (mV, mF), "smooth": True}))
    # (no over-the-shoulder straps: their ends stopped dead on the felt; the A-frame is lashed at the belt, paint)

    # ── ARMS, FISTS, LEGS, BOOTS ───────────────────────────────────────────────────────────────────────
    sleeves_mitts(L, out, {"R": (-0.365, -0.36, 0.53), "L": (0.24, -0.36, 0.56)}, r_up=0.092, r_fore=0.085,
                  mitt_r=0.07, body=body, top_dz=-0.025, r_top=0.078, sleeve_tris=112)
    boots_legs(L, out, (0.205, -0.04, 0.055), (0.085, 0.115, 0.055), 0.08)

    hammer_serenade(L, out, body)
    # the drum and its A-frame sit on the back of the MODEL body: the back's outermost surface (mantle, tunic,
    # collar) in model space
    back = sdf.Blend([("add", WarpedField(field_of(mantle), invert(mantle_tf)), 0.0),
                      ("add", WarpedField(field_of(tunic), invert(body)), 0.0),
                      ("add", WarpedField(field_of(col), invert(hood_tf)), 0.0),
                      ("add", WarpedField(field_of(hood), invert(hood_tf)), 0.0)])
    lantern_serenade(L, out, back)
    return out


# the tunic's sculpted bands (concept space): (z, R, tube r, rz, depth, blend k): the rolled hem band, the upper
# hem band, the belt. The paint reads them back (dark felt / leather).
SER_TUNIC_BANDS = [(0.200, 0.432, 0.050, 0.050, 0.80, 0.018), (0.345, 0.423, 0.031, 0.029, 0.80, 0.012),
                   (0.59, 0.355, 0.025, 0.022, 0.82, 0.012)]


def hammer_serenade(L, out, body):
    """The sheet: pommel (-0.55, 0.48), the haft through both fists to an ironstone drum head centred (0.475,
    0.62), 0.29 across x 0.40 tall; two sandstone bands, a lampresin window on its outer face. Sculpted on the
    MODEL haft line; the paint pose moves it back onto the sheet's (a body-warp inverse + a small shift)."""
    d = np.asarray(L["haft"], float)
    d /= np.linalg.norm(d)
    g = np.asarray(L["grip_r"], float)
    up = np.array([-d[2], 0.0, d[0]])
    ax = np.stack([d, np.cross(up, d), up])
    ax_h = sdf.frame(up, d)                             # the drum head's own frame: local Z = its axis
    pom = g - d * 0.20
    head_c = g + d * 0.79
    # model -> concept: the head and haft go back onto the painted hammer (fit by eye on the sheet)
    cg = np.array([-0.36, -0.36, 0.53])                 # the sheet's right fist on the haft
    mg = invert(body)(g[None])[0]
    pose = compose(invert(body), shift(*(cg - mg)))
    haft = Sculpt("haft")
    haft.add(RoundCone(pom + d * 0.04, head_c - d * 0.06, 0.028, 0.024), k=0.0)     # straight walnut, buried in the head
    out.append(SP("haft", haft, "wood_dark", "bone:prop.R", 56, 0.7, to_concept=pose))
    pm = Sculpt("pommel")
    pm.add(Capsule(pom - d * 0.012, pom + d * 0.045, 0.044).displaced(chips(0.004, 14.0), 0.004), k=0.0)
    out.append(SP("pommel", pm, "ironstone", "bone:prop.R", 40, 0.6, to_concept=pose))
    # the head: an ironstone DRUM like the sheet's (a spool, not a barrel): a straight-sided body, a heavy flared
    # cap at each striking end (2.6 cm proud, chamfered), the striking faces flat

    def flat_ring(r0, r1, hz, rr):
        def prof(r, z):
            cr, hr = (r0 + r1) / 2, (r1 - r0) / 2
            q0 = np.maximum(np.abs(r - cr) - (hr - rr), 0.0)
            q1 = np.maximum(np.abs(z) - (hz - rr), 0.0)
            return np.sqrt(q0 * q0 + q1 * q1) + np.minimum(np.maximum(np.abs(r - cr) - hr, np.abs(z) - hz), 0) - rr
        return prof
    hd = Sculpt("hammer_head")
    hd.add(Lathe(head_c, flat_ring(0.0, 0.116, 0.150, 0.010), 0.14, -0.16, 0.16, axes=ax_h), k=0.0)
    for sz in (-1, 1):                                  # the caps (a chamfered flange each end)
        hd.add(Lathe(head_c + up * sz * 0.168, flat_ring(0.0, 0.142, 0.034, 0.012), 0.16, -0.05, 0.05,
                     axes=ax_h).displaced(chips(0.003, 12.0), 0.003), k=0.004)
    # the two sandstone bands: raised rings OF THE HEAD'S OWN MESH (1.4 cm proud, painted sandstone by the spool
    # painter); as a separate part the two decimated lows crossed into a torn-paper zigzag
    for sz in (-1, 1):
        hd.add(Lathe(head_c + up * sz * 0.078, flat_ring(0.0, 0.130, 0.024, 0.007), 0.15, -0.04, 0.04, axes=ax_h), k=0.003)
    # (fix round 5) the GAME mesh is an exact 10-sided lathe of the same drum: striking faces, chamfered flanges, the
    # straight body and the two sandstone bands as clean rings (decimated, the bands read as crumpled tape)
    # (fix round 6: the flange's underside runs straight into the band's top step: 16 rings, 280 tris, not 320)
    hprof = [(0.0, 0.202), (0.129, 0.202), (0.142, 0.189), (0.142, 0.146), (0.119, 0.128),
             (0.131, 0.100), (0.131, 0.057), (0.117, 0.051)]
    hprof = hprof + [(r_, -t_) for r_, t_ in hprof[::-1]]
    hV, hF = wc.oval_ring_low((0.0, 0.0, 0.0), hprof, n=10, phase=math.pi / 10, inside=(0.0, 0.0))
    hV = np.asarray(head_c, float)[None] + hV @ np.asarray(ax_h, float)
    out.append(SP("hammer_head", hd, "ironstone", "bone:prop.R", len(hF), 0.8, to_concept=pose,
                  meta={"spool": (tuple(head_c), tuple(up), tuple(d)), "low_mesh": (hV, hF), "smooth": True}))
    bands = Sculpt("hammer_bands")
    bands.add(Torus(head_c - d * 0.13, 0.04, 0.013, axes=sdf.frame(d)), k=0.0)         # haft collar
    out.append(SP("hammer_bands", bands, "sandstone", "bone:prop.R", 40, 0.6, to_concept=pose))
    # the small window in its outer face (an exact lens 7 mm proud: the decimated ellipsoid's edge bit into the painted
    # ring as a notch). (fix round 5) ACCENT, framed in iron (brief: the hammer window is accent while the total stays
    # <= 6 %; the Serenade sat at 5.15 %): a lampresin amber lens read as a marigold light on ally-blue wicks
    ax_w = np.stack([ax[1], d, up])
    out.append(hull_sp("hammer_window", [oval_disc(head_c + d * 0.123, ax_w, 0.030, 0.030, 0.012, 8)], "accent",
                       "bone:prop.R", to_concept=pose, meta={"smooth": True}))


# the Serenade drum lantern (MODEL space, procedural paint; fix round 3, the concept's lamp): a squat ironstone drum
# 0.72 m wide seated right behind the hood: two HEAVY BLOCK-CUT ironstone bands (eight carved blocks each, exact hulls:
# chamfered, hand-cut, chipped, dark joints, the upper course laid half a block round from the lower), between them a
# ring of eight LAMPRESIN PANES set 1.8 cm behind eight ironstone posts, each pane framing ONE domed accent core
# (about half its width: the resin shows round it as a deep amber margin with a frosted bloom painted toward the core);
# a low padded tan felt lid with FOUR crossed dark leather straps and a button; on an A-frame of walnut posts down the
# back to the belt, a felt pack under it. (Before: the panes were flat accent tiles filling each window edge to edge,
# a blue-tiled birdcage; the bands thin smooth rings that read as grey wood; the lid a pale cream dome with six spokes.)
SER_DRUM = dict(R=0.362, R_core=0.328, R_pane=0.310, R_in=0.285, sy=0.62, z_lo=(0.985, 1.076), z_win=(1.076, 1.318),
                z_up=(1.318, 1.398), z_lid=1.478, n=8, post_hw=0.026, straps=4, chamfer=0.013)


def drum_windows(c, Rc, sy, n, post_hw, depth):
    """The drum's n windows (model space): per window its centre angle (oval parameter; window 0 faces straight
    front), the outward normal N and tangent T at its centre on the core oval, the PANE point F (depth behind the
    core surface), the half width hw between the posts (half the chord between the post centres - post_hw) and
    the half chord hc between the post centres."""
    c = np.asarray(c, float)
    out = []
    for i in range(n):
        ph = -math.pi / 2 + 2 * math.pi * i / n
        Pc = c + np.array([Rc * math.cos(ph), Rc * sy * math.sin(ph), 0.0])
        N = np.array([math.cos(ph), math.sin(ph) / sy, 0.0])
        N /= np.linalg.norm(N)
        T = np.array([-N[1], N[0], 0.0])
        q = [c + np.array([Rc * math.cos(ph + sg * math.pi / n), Rc * sy * math.sin(ph + sg * math.pi / n), 0.0])
             for sg in (-1, 1)]
        hc = abs((q[1] - q[0]) @ T) / 2
        out.append(dict(ph=ph, N=N, T=T, F=Pc - N * depth, hw=hc - post_hw, hc=hc))
    return out


def _oval_pt(c, r, sy, a, z):
    return np.array([c[0] + r * math.cos(a), c[1] + r * sy * math.sin(a), z])


def drum_blocks(c, sy, R_in, R_out, z0, z1, n, phase, ch, rng, gap=0.0075, chip_p=0.45):
    """Local hull points of one heavy band course: n carved blocks round the oval, each spanning 2 pi / n less a
    joint `gap` (m at R_out), its outer face two flat facets (block-cut, never a smooth ring), every outer edge
    chamfered by `ch`, the size and height moved a few mm per block (hand-cut) and some top corners broken off."""
    blocks = []
    for i in range(n):
        g = gap / R_out / 2
        a0, a1 = phase + 2 * math.pi * i / n + g, phase + 2 * math.pi * (i + 1) / n - g
        am = (a0 + a1) / 2
        Ro = R_out + rng.uniform(-0.004, 0.004)
        zt, zb = z1 + rng.uniform(-0.005, 0.003), z0 + rng.uniform(-0.002, 0.002)
        e = ch / Ro
        pts = []
        for a, sg in ((a0, 1.0), (a1, -1.0)):
            pts += [_oval_pt(c, R_in, sy, a, zb), _oval_pt(c, R_in, sy, a, zt),
                    _oval_pt(c, Ro - ch, sy, a, zb + ch * 0.4), _oval_pt(c, Ro - ch, sy, a, zt - ch * 0.4),
                    _oval_pt(c, Ro, sy, a + sg * e, zb + ch), _oval_pt(c, Ro, sy, a + sg * e, zt - ch)]
        pts += [_oval_pt(c, Ro - ch, sy, am, zb), _oval_pt(c, Ro - ch, sy, am, zt),
                _oval_pt(c, Ro, sy, am, zb + ch), _oval_pt(c, Ro, sy, am, zt - ch)]
        P = np.array(pts)
        P += rng.uniform(-0.0015, 0.0015, P.shape)
        if rng.uniform() < chip_p:                   # a broken top corner (one outer top point pulled down and in)
            j = int(rng.choice([5, 11]))
            P[j] = P[j] + np.array([0.0, 0.0, -ch * 1.3]) - (P[j] - np.asarray(c)) * np.array([1, 1, 0]) * 0.03
        blocks.append(P)
    return blocks


def _poly_prof(poly):
    """A lathe profile from a closed (r, z) polygon: the 2D signed distance (negative inside, even-odd)."""
    Q = np.asarray(poly, float)
    A_, B_ = Q, np.roll(Q, -1, 0)

    def prof(r, z):
        P = np.stack([np.asarray(r, float), np.asarray(z, float)], 1)
        best = np.full(len(P), 1e9)
        inside = np.zeros(len(P), bool)
        for a_, b_ in zip(A_, B_):
            ab = b_ - a_
            t = np.clip(((P - a_) @ ab) / max(ab @ ab, 1e-12), 0, 1)
            best = np.minimum(best, np.linalg.norm(P - (a_ + t[:, None] * ab), axis=1))
            cross = ((a_[1] > P[:, 1]) != (b_[1] > P[:, 1]))
            xi = a_[0] + (P[:, 1] - a_[1]) * ab[0] / (ab[1] if abs(ab[1]) > 1e-12 else 1e-12)
            inside ^= cross & (P[:, 0] < xi)
        return np.where(inside, -best, best)
    return prof


def _halo_ring(c, ax, a, b, inner, n=8, lift=0.001):
    """(fix round 6) A lamp core's soft glow as a flat ANNULUS on the pane (the shared glow_halo_lamp material: the
    export hook writes its vertex alpha by the ring's own radius, 0.80 at the core's outline -> 0 at the rim): from
    `inner` x (a, b) out to (a, b), n round; the opaque core covers its middle. Returns (V, F) facing ax[1]."""
    ax = np.asarray(ax, float)
    c = np.asarray(c, float) + ax[1] * lift
    th = np.linspace(0, 2 * np.pi, n, endpoint=False)
    V = [c + ax[0] * a * k_ * math.cos(t) + ax[2] * b * k_ * math.sin(t) for k_ in (inner, 1.0) for t in th]
    F = []
    for j in range(n):
        j2 = (j + 1) % n
        F += [(j, j2, n + j2), (j, n + j2, n + j)]
    V, F = np.array(V), np.array(F, np.int64)
    nn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    if (nn @ ax[1]).mean() < 0:
        F = F[:, ::-1]
    return V, F


def _dome_fan(c, ax, a, b, h, n=10):
    """A domed oval FAN (the drum's pane cores): n rim points on the pane + a centre raised h along ax[1]; smooth
    shaded, so the light's own diffuse term rounds off toward the rim. 10 tris. Returns (V, F)."""
    ax = np.asarray(ax, float)
    c = np.asarray(c, float)
    th = np.linspace(0, 2 * np.pi, n, endpoint=False)
    V = [c + ax[1] * h] + [c + ax[0] * a * math.cos(t) + ax[2] * b * math.sin(t) + ax[1] * h * 0.25 for t in th]
    F = [(0, 1 + (j + 1) % n, 1 + j) for j in range(n)]
    V, F = np.array(V), np.array(F, np.int64)
    nn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    if (nn @ ax[1]).mean() < 0:
        F = F[:, ::-1]
    return V, F


def _glow_fans(name, ovals, scales, ns, bind="bone:chest"):
    """See-through glow fans (role glow_halo1: alpha-blended accent) round lamp cores: per oval (centre on the glass,
    frame rows (across, out, up), a, b) one flat fan per scale, 1.5-2.5 mm proud of the glass, under its core."""
    V, F = [], []
    S = Sculpt(name)
    for (c_, ax_, a_, b_), n_ in zip(ovals, ns):
        for k_, sc in enumerate(scales):
            v_, f_ = _dome_fan(np.asarray(c_, float) + ax_[1] * 0.0006 * k_, ax_, a_ * sc, b_ * sc, 0.0015, n_)
            F.append(f_ + len(V))
            V += list(v_)
        S.add(Ellipsoid(tuple(np.asarray(c_, float)), (a_, 0.003, b_), axes=ax_), k=0.0)
    return SP(name, S, "glow_halo1", bind, len(np.vstack(F)), 0.6, meta={"smooth": True, "low_mesh": (np.array(V), np.vstack(F))})


_DRUM: dict = {}          # filled by lantern_serenade: the layout the painters read (blocks, windows, cores)


def lantern_serenade(L, out, back):
    D = SER_DRUM
    yl = L["lantern_y"]
    R0, Rc, Rp, Ri, sy, ch = D["R"], D["R_core"], D["R_pane"], D["R_in"], D["sy"], D["chamfer"]
    (l0, l1), (w0, w1), (u0, u1) = D["z_lo"], D["z_win"], D["z_up"]
    c = np.array([0.0, yl, 0.0])
    n = D["n"]
    rng = np.random.default_rng(41)
    wins = drum_windows(c, Rc, sy, n, D["post_hw"], Rc - Rp)
    # the two heavy courses: (fix round 6) ROUND chamfered rings, an exact 20-round lathe each, smooth shaded (the 8
    # flat-faced hull blocks a course faceted the drum into an octagon from the game camera); the blocks, their joints
    # (the lower course centred on the windows, the upper laid half a block round), the chisel dressing and the lit
    # chamfers are PAINTED (_pp_blocks + _edges on the course's own field)
    ns = D.get("ring_n", 20)
    courses = []
    for z0_, z1_, Ro_ in ((l0, l1 + 0.004, R0), (u0 - 0.004, u1, R0 - 0.006)):
        courses.append([(Rp - 0.006, z0_), (Ro_ - ch, z0_), (Ro_, z0_ + ch), (Ro_, z1_ - ch), (Ro_ - ch, z1_),
                        (Rp - 0.010, z1_)])
    bands = Sculpt("drum_bands")
    bV, bF = [], []
    for prof_ in courses:
        poly = [(Ri, prof_[0][1])] + prof_ + [(Ri, prof_[-1][1])]
        z0_, z1_ = prof_[0][1], prof_[-1][1]
        bands.add(Lathe(c, _poly_prof(poly), R0 + 0.02, z0_ - 0.01, z1_ + 0.01, axes=np.diag([1.0, 1.0 / sy, 1.0])), k=0.0)
        v_, f_ = wc.oval_ring_low(c, prof_, n=ns, sy=sy, phase=-math.pi / 2, inside=((Ri + R0) / 2, (z0_ + z1_) / 2))
        bF.append(f_ + sum(len(x) for x in bV))
        bV.append(v_)
    out.append(SP("drum_bands", bands, "ironstone", "bone:chest", len(np.vstack(bF)), 0.75,
                  meta={"low_mesh": (np.vstack(bV), np.vstack(bF)), "smooth": True}))
    # the floor under the ring (closed from below: the death pose shows it), one low 12-gon slab
    fl = []
    for z_ in (l0 + 0.004, l0 + 0.03):
        fl += [_oval_pt(c, Ri + 0.01, sy, a, z_) for a in np.linspace(0, 2 * np.pi, 12, endpoint=False)]
    out.append(hull_sp("drum_floor", [np.array(fl)], "ironstone", "bone:chest", vs=0.75))
    # the posts: ironstone bars between the windows, standing 1.8 cm proud of the panes (exact boxes)
    zc_w, hz_w = (w0 + w1) / 2, (w1 - w0) / 2
    posts, pbox = Sculpt("drum_posts"), []
    for w in wins:
        ph = w["ph"] + math.pi / n
        Pc = _oval_pt(c, (Rc + Rp) / 2, sy, ph, zc_w)
        N = np.array([math.cos(ph), math.sin(ph) / sy, 0.0])
        N /= np.linalg.norm(N)
        T = np.array([-N[1], N[0], 0.0])
        ax_p = np.stack([T, N, np.array([0.0, 0.0, 1.0])])
        half = (D["post_hw"], (Rc - Rp) / 2 + 0.010, hz_w + 0.010)
        posts.add(RoundBox(tuple(Pc - N * 0.005), half, 0.004, axes=ax_p), k=0.0)
        pbox.append((Pc - N * 0.005, half, ax_p))
    out.append(SP("drum_posts", posts, "ironstone", "bone:chest", 12 * n, 0.6, meta={"low_boxes": pbox}))
    # the lampresin panes: one flat box per window, wide enough to meet its neighbours behind the posts (no gaps)
    panes, qbox = Sculpt("drum_panes"), []
    for w in wins:
        ax_w = np.stack([w["T"], w["N"], np.array([0.0, 0.0, 1.0])])
        ctr = w["F"] - w["N"] * 0.008 + np.array([0.0, 0.0, zc_w])
        half = (w["hc"] + 0.006, 0.008, hz_w + 0.012)
        panes.add(RoundBox(tuple(ctr), half, 0.002, axes=ax_w), k=0.0)
        qbox.append((ctr, half, ax_w))
    out.append(SP("drum_panes", panes, "lampresin", "bone:chest", 12 * n, 0.6, meta={"low_boxes": qbox}))
    # the light: ONE domed oval core on each pane (about half its width, a little above its middle), the resin round
    # it painted as a deep amber margin with a frosted bloom toward the core (_pp_resin)
    V, F, cores = [], [], []
    glow = Sculpt("drum_glow")
    for w in wins:
        ax_w = np.stack([w["T"], w["N"], np.array([0.0, 0.0, 1.0])])
        cc = w["F"] + w["N"] * 0.0015 + np.array([0.0, 0.0, zc_w + 0.004])
        # (fix round 6) the cores 25 % smaller (review r4: flat accent octagons filling each window edge to edge, no
        # resin pane framing a core): a small domed core in a soft glow, the smoky resin pane round it
        a_, b_ = w["hw"] * 0.82 * 0.80, hz_w * 0.72 * 0.80
        v_, f_ = _dome_fan(cc, ax_w, a_, b_, 0.010, 8)
        F.append(f_ + len(V))
        V += list(v_)
        cores.append((cc, ax_w, a_, b_))
        glow.add(Ellipsoid(tuple(cc), (a_, 0.006, b_), axes=ax_w), k=0.0)
    out.append(SP("drum_glow", glow, "accent", "bone:chest", n * 8, 0.6,
                  meta={"low_mesh": (np.array(V), np.vstack(F)), "smooth": True}))
    # (fix round 6) the glow round each core: the shared soft lamp glow (glow_halo_lamp, as on the Aubade box: vertex
    # alpha 0.80 at the core's outline -> 0 at 1.6 x, black diffuse so it only ADDS light over the resin), a flat ring
    # 1 mm proud of the pane under the core (the flat see-through fan of round 3 read as a uniform tile)
    V, F = [], []
    S_ = Sculpt("drum_halo")
    for cc, ax_w, a_, b_ in cores:
        v_, f_ = _halo_ring(cc - ax_w[1] * 0.0005, ax_w, a_ * wc.HALO_LAMP_SCALE, b_ * wc.HALO_LAMP_SCALE,
                            0.94 / wc.HALO_LAMP_SCALE, 8)
        F.append(f_ + len(V))
        V += list(v_)
        S_.add(Ellipsoid(tuple(cc), (a_, 0.003, b_), axes=ax_w), k=0.0)
    out.append(SP("drum_halo", S_, wc.HALO_LAMP_MAT, "bone:chest", len(np.vstack(F)), 0.6,
                  meta={"smooth": True, "low_mesh": (np.array(V), np.vstack(F))}))
    _DRUM.clear()
    _DRUM.update(c=c, sy=sy, n=n, lo_phase=-math.pi / 2 - math.pi / n, up_phase=-math.pi / 2, z=(l0, l1, w0, w1, u0, u1),
                 wins=wins, cores=cores, R=(R0, Rc, Rp, Ri))
    # the lid: a LOW padded tan felt dome on the upper course, FOUR crossed dark leather straps sunk in it (the
    # sheet's: two crossing over the top, 45 degrees either side of the front) meeting at a button; part of the lid's
    # own mesh (separate strap tubes tore into shards)
    lid = Sculpt("drum_lid")
    zl0, zl1 = u1 - 0.020, D["z_lid"]
    hl = zl1 - zl0 - 0.012
    Rl = R0 - 0.030
    rib_a = np.pi / 4 + np.pi / 2 * np.arange(D["straps"])

    def lid_prof(r, z):
        q = np.sqrt((r / Rl) ** 2 + ((z - zl0 - 0.012) / hl) ** 2)
        return np.maximum((q - 1.0) * hl, zl0 - z)

    def puff(P):
        """the felt puffs between the straps (+), sinks along them (-)"""
        x, y = P[:, 0], (P[:, 1] - yl) / sy
        a = np.arctan2(y, x)
        da = np.min(np.abs(((a[:, None] - rib_a[None, :]) + np.pi) % (2 * np.pi) - np.pi), axis=1)
        r = np.hypot(x, y)
        w = np.clip(r / 0.08, 0, 1)
        # (fix round 4) no strap grooves: a soft quilted swell only (the grooves crossed the lid like the straps did)
        return -0.004 * w * (1.0 - np.clip(r / (Rl * 0.9), 0, 1)) + 0.0 * da
    lid.add(Lathe(c, lid_prof, R0, zl0 - 0.01, zl1 + 0.02, axes=np.diag([1.0, 1.0 / sy, 1.0])).displaced(puff, 0.008), k=0.0)
    # (fix round 4) a broad dark ironstone RIM framing the lid's foot (round its skirt, 2.2 cm, 1.4 cm proud) instead of
    # four straps crossing over its top (from 52 deg they read as a pale hot-cross bun stacked behind the hood dome)
    pts = []
    for a in np.linspace(0.0, 2 * np.pi, 25):
        tt = 0.93
        r = Rl * tt
        z = zl0 + 0.012 + hl * math.sqrt(max(0.0, 1 - tt * tt)) - 0.006
        pts.append((r * math.cos(a), yl + r * sy * math.sin(a), z))
    lid.add(Tube(np.array(pts), [0.022] * len(pts), k=0.006), k=0.010)
    lid.add(Ellipsoid((0, yl, zl1 - 0.004), (0.030, 0.030 * sy / 0.62, 0.012)), k=0.01)          # a small iron knob
    # (fix round 6) the GAME mesh is an exact 16-round lathe of the same lid (rim roll, felt dome, knob), smooth shaded:
    # the decimated lid kept a crease across its top that the bake drew as a dark caret on every lid (review r4)
    def lid_z(r):
        q = np.clip(r / Rl, 0, 1)
        return zl0 + 0.012 + hl * math.sqrt(max(0.0, 1 - q * q)) - 0.004 * min(r / 0.08, 1.0) * max(0.0, 1 - r / (Rl * 0.9))
    rr = Rl * 0.93
    zr = zl0 + 0.012 + hl * math.sqrt(max(0.0, 1 - 0.93 ** 2)) - 0.006
    lprof = [(rr + 0.024, u1 + 0.001), (rr + 0.021, zr + 0.011), (rr + 0.004, zr + 0.022), (rr - 0.020, lid_z(rr - 0.020) + 0.001),
             (0.21, lid_z(0.21)), (0.10, lid_z(0.10)), (0.034, lid_z(0.034) + 0.001), (0.0, zl1 + 0.008)]
    lV, lF = wc.oval_ring_low(c, lprof, n=16, sy=sy, phase=-math.pi / 2, inside=(0.0, zl0))
    out.append(SP("drum_lid", lid, "cloth2", "bone:chest", len(lF), 0.8,
                  meta={"lid": (tuple(c), Rl, sy, zl0, hl, tuple(rib_a)), "low_mesh": (lV, lF), "smooth": True}))
    # the A-frame: two walnut posts from under the drum down the back, ON the mantle and the tunic (they follow
    # the back's outermost surface 2.6 cm out), to the belt; a yoke bar under the drum between them
    posts = Sculpt("frame_posts")
    segs, post_pts = [], []
    for px in (-1, 1):
        top = np.array([px * 0.225, yl - R0 * sy * 0.55, l0 + 0.005])
        zs = np.linspace(0.93, 0.575, 15)
        xs = px * np.interp(zs, [0.575, 0.93], [0.125, 0.21])
        surf = np.array([back_line(back, x_, [z_], off=0.026)[0] for x_, z_ in zip(xs, zs)])
        line = np.interp(zs, [zs[-1], top[2]], [surf[-1], top[1]])
        ys = np.maximum(line, surf)
        for _ in range(3):                           # a strut, not a staircase: smooth, but never into the back
            ys[1:-1] = (ys[:-2] + 2 * ys[1:-1] + ys[2:]) / 4
            ys = np.maximum(ys, surf - 0.008)
        pts = np.vstack([top, np.stack([xs, ys, zs], 1)[::2]])
        posts.add(Tube(pts, [0.031] * len(pts), k=0.01), k=0.0)
        segs += [(tuple(a_), tuple(b_)) for a_, b_ in zip(pts[:-1], pts[1:])]
        post_pts.append(pts)
    yf, yb = yl - R0 * sy * 0.55, yl + R0 * sy * 0.60
    yokes = [RoundBox((0, yf, l0 - 0.006), (0.25, 0.028, 0.024), 0.009),       # the front yoke
             RoundBox((0, yb, l0 - 0.012), (0.26, 0.026, 0.022), 0.009)]       # the back yoke
    for yk in yokes:
        posts.add(yk, k=0.008)
    for y_ in (yf, yb):
        segs.append(((-0.25, y_, l0 - 0.008), (0.25, y_, l0 - 0.008)))
    _SEGS["posts"] = segs
    # (fix round 6) the GAME mesh: two exact 6-sided walnut struts (a capped foot at the belt, the top under the drum)
    # and two exact yoke bars (decimated, the A-frame broke into jagged shards behind the hood: review r4)
    fV, fF = [], []
    for pts in post_pts:
        idx = np.unique(np.round(np.linspace(0, len(pts) - 1, 5)).astype(int))
        v_, f_ = wc.tube_low(pts[idx], 0.032, nsides=5, caps=(False, True))
        fF.append(f_ + sum(len(x) for x in fV))
        fV.append(v_)
    for yk in yokes:
        v_, f_ = wc.roundbox_low(yk, (2, 1, 1))
        fF.append(f_ + sum(len(x) for x in fV))
        fV.append(v_)
    out.append(SP("frame_posts", posts, "wood_dark", "bone:chest", len(np.vstack(fF)), 0.8,
                  meta={"low_mesh": (np.vstack(fV), np.vstack(fF)), "smooth": True}))
    # (fix 5) the PACK: a padded felt bundle lashed on the back under the drum, from the shoulder blades up to the
    # drum's floor, so the side view is one load on the back ('a house on its back'), not a lamp held out on stilts
    # (the braces it replaces left open sky under the drum)
    pk = Sculpt("pack")
    zs_ = np.linspace(0.70, l0 - 0.01, 6)
    by = back_line(back, 0.0, zs_, off=-0.03)
    y_front = float(np.min(by))
    y_back = yl + R0 * sy * 0.45
    zc_, hz_ = (0.66 + l0 + 0.01) / 2, (l0 + 0.01 - 0.66) / 2
    boxes = [RoundBox((0, (y_front + y_back) / 2, zc_), (0.215, (y_back - y_front) / 2, hz_), 0.075)]
    for zb_ in (zc_ - hz_ * 0.45, zc_ + hz_ * 0.40):        # two leather straps round it (raised 6 mm)
        boxes.append(RoundBox((0, (y_front + y_back) / 2, zb_), (0.221, (y_back - y_front) / 2 + 0.006, 0.020), 0.012))
    for i_, bx in enumerate(boxes):
        pk.add(bx, k=0.0 if i_ == 0 else 0.004)
    # (fix round 6) the GAME mesh: an exact padded block + two exact strap bands (decimated, the pack's top broke into
    # torn-paper shards behind the hood: review r4)
    kV, kF = [], []
    for i_, bx in enumerate(boxes):
        v_, f_ = wc.roundbox_low(bx, (2, 2, 2) if i_ == 0 else (2, 1, 1))
        kF.append(f_ + sum(len(x) for x in kV))
        kV.append(v_)
    out.append(SP("pack", pk, "cloth", "bone:chest", len(np.vstack(kF)), 0.8,
                  meta={"pack": (y_front, y_back, zc_, hz_), "low_mesh": (np.vstack(kV), np.vstack(kF)), "smooth": True}))


# ── grading, top plates, tints ─────────────────────────────────────────────────────────────────────────
GRADE = {
    # wick_common.graded_projection: painted glow refilled (the accent geometry carries every light), the
    # Serenade sheet's saturation pulled down and its top band lifted (brief §5.2)
    "aubade": dict(sat=1.0, top_lift=1.0, glow=(0.84, 0.18)),
    "serenade": dict(sat=0.62, top_lift=1.05, glow=(0.78, 0.45)),
}
_A_LANT = (0.0, LAYOUT["aubade"]["lantern_y"])
_S_LANT = (0.0, LAYOUT["serenade"]["lantern_y"])
_AL = AUB_LANT
# procedural-painterly parts (gw_proc): every hard-surface prop and the trims. Projected, they smeared: a part
# whose sculpt runs where the sheet paints something else takes that paint (the sheet's X binding across the chalk
# head, its haft across the stoles, streaks down the sides of the drum bands). Painted here from the palette with
# the sheet's value structure (lit tops, key from the front-left, darker undersides), brush-scale mottling, chips,
# cracks, stone courses and wood grain, they stay crisp at any distance.
_CHALK = {"kind": "stone", "hex": "#D6D3CA", "light": (0.80, 1.07), "cracks": 0.07, "crack_t": 0.72, "freq": 6.0,
          "mottle": 0.05, "edge": 0.16, "cavity": 0.40, "edge_w": 0.012}
_CHALK_LANT = dict(_CHALK, hex="#9A978F", light=(0.78, 1.0), edge=0.22, cavity=0.48)
_ASH = {"kind": "wood", "hex": "#B5A68C", "light": (0.80, 1.08), "edge": 0.12, "cavity": 0.30, "edge_w": 0.008}
_IRON = {"kind": "iron", "hex": "#4B4039", "edge": 0.38, "cavity": 0.40, "edge_w": 0.012}   # painted, not granite
_WALNUT = {"kind": "wood", "hex": "#5A4436", "light": (0.82, 1.18), "edge": 0.22, "cavity": 0.30, "edge_w": 0.008}
# (fix 4: #627890, 211 / 32 %: the three.js light greys a 26 % blue-grey to 10 %; the sheet's cloth is a clean blue)
# (fix 5: back to the palette's cloth #6E7A86, 210 / 18 %: #627890 at 32 % sat put the body in the reserved azure band,
# so the ally accent sat blue-on-blue)
_AUB_CLOTH = {"kind": "cloth", "hex": "#6E7A86", "light": (0.78, 1.14), "key": 0.10}
# (fix 4: the umber felt is authored deeper and warmer, #7A5640 hue 23 / 48 %: at #7F604C the three.js light read it a
# pinkish greige, hue 21 / 23 %; hue 23 stays out of the reserved marigold band)
# (fix 5: #7A5640 at 48 % sat sat on the reserved marigold band (reddish under the game grade, mauve in AgX): a
# dusty umber at the palette's saturation, hue 28 (yellower: never pink), #74604F 28 / 32 %)
_SER_CLOTH = {"kind": "cloth", "hex": "#74604F", "light": (0.76, 1.16), "key": 0.10}
PAINT = {
    "aubade": {
        # own-region erosion (plate cells of 2 px = ~5 mm): wide where the sheet's outline runs inside the sculpt
        "gw_erode": {"*": 4, "hood": 7, "boot_L": 2, "boot_R": 2},
        # projected + procedural cloth (see paint_greatwick): the cloak keeps the sheet's painting where it lands
        # square on, a procedural wool fill elsewhere; the sculpt's folds are painted over both, the slate hem band
        # (brief §2.4) is a zone
        "gw_hybrid": {
            "cloak": dict(_AUB_CLOTH, mix=0.70, folds="aub", hem=("#3E434A", 0.090), fold_light=1.05, brush=0.075,
                          light_tint=(1.03, 1.02, 0.99), shade_tint=(0.95, 0.97, 1.03)),
        },
        "gw_proc": {
            "legs": {"kind": "flat"},
            # the hood flat-painterly (the sheet's own look: a smooth blue-grey cowl, lighter on the crown)
            # a MID blue-grey cowl like the sheet's (the pale linen hood lost the chalk rim's contrast), modelled
            # by the key (lit crown and front-left, the nape and the drape in shade)
            # (fix round 3) L* <= 65 at the game camera (r12 B5 / M8: the hoods sat at 70-80 in game) and PAINTED: soft
            # cowl folds running back from the rim, a nape crease, wool brushwork, a lit crown (it read as smooth plastic)
            "hood": {"kind": "cowl", "hex": "#77828E", "light": (0.70, 1.10), "key": 0.12, "brush": 0.06,
                     "centre": (-0.022, 0.02, 0.93), "folds": 7, "fold": 0.16},
            "hood_rim": dict(_CHALK, hex="#B8B4AA", light=(0.80, 1.05), cracks=0.05, edge=0.20,
                             arch=(AUB_ARCH, AUB_RIM_JOINTS, -0.03)),
            # (fix round 3) the knob and the clasp ring a shade under the chalk (in game the hood's top read L* 78 at p80)
            "knob": dict(_CHALK, hex="#A8A49B"), "clasp": dict(_CHALK, hex="#B3AFA5", edge=0.22), "pommel": _CHALK,
            "stole": {"kind": "linen", "hex": "#D9D5CB"},
            "sleeve_L": dict(_AUB_CLOTH, cuff="#55606C"), "sleeve_R": dict(_AUB_CLOTH, cuff="#55606C"),
            "mitt_L": {"kind": "mitt", "hex": "#525C68"}, "mitt_R": {"kind": "mitt", "hex": "#525C68"},
            "boot_L": {"kind": "felt", "hex": "#3E434A", "light": (0.80, 1.25), "nap": 0.03, "edge": 0.25,
                       "edge_w": 0.012},
            "boot_R": {"kind": "felt", "hex": "#3E434A", "light": (0.80, 1.25), "nap": 0.03, "edge": 0.25,
                       "edge_w": 0.012},
            # the carved head: every flat facet its own value by the key (the chamfers catch the light), chipped
            # lit edges, dark cracks; the lashing flat stone-blue straps with lit edges (no streaks)
            "hammer_head": dict(_CHALK, hex="#CFCAC0", light=(0.64, 1.10), key=0.14, cracks=0.08, chip_light=0.0,
                                edge=0.26, cavity=0.5, mottle=0.04),
            "hammer_bind": {"kind": "felt", "hex": "#8B97A3", "light": (0.70, 1.14), "key": 0.12, "nap": 0.015,
                            "edge": 0.30, "cavity": 0.30, "edge_w": 0.005},
            "grip": {"kind": "felt", "hex": "#7F8B97", "light": (0.80, 1.10), "bands": 0.35},
            "haft": _ASH, "shelf": _ASH,
            # (fix round 4) the lantern's chalk a step down (in game its roof and frame were the brightest non-accent
            # thing in a wave, p95 L* 71-74 over the fighters' 42-66): weathered chalk, the read from cavity and lit edges
            "frame_posts": dict(_ASH, hex="#958972", segs="frame"),
            "lantern_bars": _CHALK_LANT, "lantern_slabs": _CHALK_LANT, "spires": dict(_CHALK_LANT, cracks=0.05),
            "lantern_roof": dict(_CHALK_LANT, hex="#929088"),
            # (fix round 3) a deeper dawnglass with a dim frost (the core is the light: a near-white bloom out-valued the
            # ally azure, so the west viewer saw a blue hole in white glass)
            # (fix round 6) SMOKED dawnglass, L* <= 30 round the cores (the lamp halo only adds light: no dark ring)
            "lantern_glass": {"kind": "glass", "hex": "#3F454C", "smoke": True,
                              "box": (0.0, _A_LANT[1], _AL["hw"] - 0.015, _AL["hd"] - 0.015, *_AL["z_pane"])},
        },
        # (fix round 6) the Art 2.0 finish (_finish): the concept's strokes, nap, lit edges and dark seams
        "gw_finish": {
            "cloak": {"det": 0.60, "nap": 0.02, "edge": 0.08, "cav": 0.30, "edge_w": 0.015},
            "hood": {"det": 0.45, "nap": 0.02, "cav": 0.22, "carve": AUB_ARCH, "carve_pad": 0.06},
            "stole": {"det": 0.40, "cav": 0.20},
            "sleeve_L": {"det": 0.50, "nap": 0.02, "edge": 0.08, "cav": 0.25},
            "sleeve_R": {"det": 0.50, "nap": 0.02, "edge": 0.08, "cav": 0.25},
            "mitt_L": {"cav": 0.30}, "mitt_R": {"cav": 0.30},
            "boot_L": {"nap": 0.02}, "boot_R": {"nap": 0.02},
        },
        "gw_top": {
            "lantern_roof": {"kind": "roof", "box": (_A_LANT[0], _A_LANT[1], _AL["hw"] + _AL["eave"], _AL["hd"] + _AL["eave"]),
                             "from": 0.5, "hex": "#929088"},
        },
        # ghost paint the projected cloak must not take (CIE L*a*b* tests on the plate): the sheet's warm ash haft
        # and frame (b* > 3), its chalk stoles / hammer (L* > 80), the black gap of its open robe (L* < 20)
        "gw_exclude": {"cloak": {"b_gt": 3.0, "L_gt": 80.0, "L_lt": 20.0}},
        # (part, zone (z0, z1) in concept space or None, target hex (None = the part's role), strength)
        "gw_tints": [("cloak", (0.20, 2.0), "#6E7A86", 0.60)],
        # the hood's hollow: every hood texel inside the arch's carve is ink, lifted round the light (painted LAST)
        # (fix round 3) the light floats mid-hollow: a faint spill only close round it (a wide pale lift ringed the
        # walls = a socket); the chalk rim's inner wall inked too (lit, it read as lips round the hole)
        "gw_ink": [{"part": "hood", "carve": AUB_ARCH, "hex": "#15171B", "pad": 0.010, "glow": "#3B4552",
                    "glow_r": 0.045, "glow_k": 0.65},
                   {"part": "hood_rim", "carve": AUB_ARCH, "hex": "#15171B", "pad": 0.0045}],
        # the robe's underside (the death pose shows it): a dark slate lining
        "gw_under": {"cloak": "#2E333A"},
        # the bottom quarter measured L* 42 at the game camera (lineup_qa; target 30-38): darken the lower bell,
        # the stoles' lower ends and the boots; the chalk hammer (the job read at hip height) is left alone
        # (fix 4: the old ramp ran the bell from mid blue-grey to soot; the clean blue cloth of the sheet now keeps its
        # colour to the hem, the dark feet come from the ironstone hem band and the boots, a gentle shade low down)
        "gw_ramp": [{"stops": [(0.0, 0.64), (0.22, 0.72), (0.42, 0.90), (0.58, 1.0)],
                     "only": ("cloak", "legs", "boot_L", "boot_R")},
                    # (fix 5) the pale stoles run to the hem down the FRONT: their feet darken harder (front bottom
                    # quarter L* 47, target 30-38)
                    {"stops": [(0.0, 0.48), (0.24, 0.60), (0.46, 0.86), (0.62, 1.0)], "only": ("stole",)},
                    {"stops": [(0.36, 0.68), (0.52, 0.84), (0.66, 1.0)],
                     "only": ("hammer_head", "hammer_bind", "pommel", "grip")}],
    },
    "serenade": {
        "gw_erode": {"*": 4, "hood": 6, "boot_L": 2, "boot_R": 2},
        "gw_hybrid": {
            # the tunic: the sheet where it lands square on and is the tunic's own paint, procedural felt elsewhere
            # (the sides, under the arms, behind the haft: the projection stretched into streaks there); the
            # sculpt's folds painted over both; the hem rolls and the belt their own dark felt / leather
            "cloak": dict(_SER_CLOTH, mix=0.55, folds="ser", fold_depth=1.0, felt=True, brush=0.065, fold_light=1.3,
                          crease=0.12, crest=0.05,
                          light_tint=(1.03, 1.01, 0.97), shade_tint=(0.97, 0.94, 0.91),
                          bands=("#3A2C22", "#3A2C22", "#45342A")),
        },
        "gw_proc": {
            "legs": {"kind": "flat"},
            # the mantle: sand felt, lit, brushed (no sampled top patch: it brought the sheet's dark collar in as
            # soot blotches by the hood)
            # sand / ochre felt (fix 4: #D2B994 / #D4BE99 read near-white cream under the game light; the sheet's
            # felt is ochre): 39-40 % saturation (the reserved-band cap), lower value, modelled by the key
            "mantle": {"kind": "cloth", "hex": "#A08562", "light": (0.68, 1.02), "key": 0.14, "brush": 0.06, "felt": True},
            "hood": {"kind": "cowl", "hex": "#958061", "light": (0.68, 0.98), "key": 0.14, "brush": 0.05, "felt": True,
                     "centre": (-0.035, 0.03, 1.07), "folds": 5, "fold": 0.10},
            "hood_rim": {"kind": "felt", "hex": "#45392F", "light": (0.80, 1.40), "nap": 0.06},
            "hollow_floor": {"kind": "flat", "hex": "#17150F", "light": (1.0, 1.0), "noise": 0.03},
            "collar": {"kind": "felt", "hex": "#45392F", "light": (0.80, 1.40), "nap": 0.06},
            # (fix 5: cuff only: the three wraps read as chevron stripes on the bent sleeves)
            "sleeve_L": dict(_SER_CLOTH, cuff="#3B2E25", felt=True),
            "sleeve_R": dict(_SER_CLOTH, cuff="#3B2E25", felt=True),
            "mitt_L": {"kind": "mitt", "hex": "#4E3D31"}, "mitt_R": {"kind": "mitt", "hex": "#4E3D31"},
            "boot_L": {"kind": "felt", "hex": "#45362C", "light": (0.80, 1.25), "nap": 0.03, "edge": 0.25,
                       "edge_w": 0.012},
            "boot_R": {"kind": "felt", "hex": "#45362C", "light": (0.80, 1.25), "nap": 0.03, "edge": 0.25,
                       "edge_w": 0.012},
            "haft": _WALNUT, "pommel": _IRON,
            "hammer_window": {"kind": "flat", "hex": "#C99555", "light": (0.85, 1.25), "key": 0.08, "noise": 0.04},
            "hammer_head": dict(_IRON, kind="spool"),
            "hammer_bands": {"kind": "stone", "hex": "#C3A47A", "light": (0.80, 1.10), "cracks": 0.10, "freq": 10.0,
                             "edge": 0.18, "cavity": 0.35, "edge_w": 0.008},
            # the drum: heavy dark ironstone block bands with lit chipped edges, the posts ironstone, the window
            # floors lampresin; the padded sand felt lid with walnut ribs
            # (fix round 3) the concept's lamp: heavy block-cut ironstone courses (lit chamfers, dark joints), ironstone
            # posts, deep amber lampresin panes framing the cores, a tan felt lid with four crossed dark straps
            "drum_bands": dict(_IRON, kind="blocks", hex="#5E5249", edge=0.50, cavity=0.45, edge_w=0.010),
            "drum_floor": dict(_IRON, kind="iron", hex="#4B4039"),
            "drum_posts": dict(_IRON, kind="iron", hex="#544840", edge=0.40, edge_w=0.008),
            # (deep smoky resin: an amber bloom round the cores sat in the enemy marigold's own hue and value; in game the
            # east viewer's ring contrast was dE 38)
            # (fix round 6) a SMOKY resin pane framing each smaller core (L* ~30 by the core, ~20 at the frame): the
            # lamp glow over it only adds light, and the marigold-tinted glow keeps a value contrast on its own hue
            "drum_panes": {"kind": "resin", "hex": "#5C4127", "deep": "#3E2B1C"},
            # (fix round 4) the lid a step darker than the hood, low, framed by an ironstone rim (no crossed straps:
            # the pale 'hot-cross bun' over the hood): the lit window band is the brightest read on the back
            "drum_lid": {"kind": "lid", "hex": "#7E6A51", "rib": "#3A2E26", "edge": 0.18, "cavity": 0.35, "edge_w": 0.008},
            "frame_posts": dict(_WALNUT, segs="posts"),
            "pack": {"kind": "pack", "hex": "#6E5848", "light": (0.70, 1.12), "key": 0.12, "nap": 0.04,
                     "strap": "#45362C", "edge": 0.20, "cavity": 0.35, "edge_w": 0.010},
        },
        "gw_top": {},          # (the sheet's crown patch brought a paler graded felt onto the procedural dome)
        # the sheet's sand mantle hangs lower than the model's at the back (a sand ghost on the tunic), its arms and
        # haft cross the tunic: the projected umber cloth never takes sand-light or near-black paint
        "gw_exclude": {"cloak": {"L_gt": 55.0, "L_lt": 20.0, "C_lt": 11.0}},
        "gw_tints": [("cloak", None, "#74604F", 0.65)],
        "gw_ink": [{"part": "hood", "carve": SER_ARCH, "hex": "#17150F", "pad": 0.010, "glow": "#3E352C",
                    "glow_r": 0.045, "glow_k": 0.65},
                   {"part": "hood_rim", "carve": SER_ARCH, "hex": "#17150F", "pad": 0.010},
                   {"part": "hood", "carve": SER_ARCH_DEEP, "hex": "#17150F", "pad": 0.004},
                   # the tunic's top shows through the back of the hollow and the mantle's lapel tips poke into
                   # its lower corners (mid umber / sand slivers in the dark: the 'white grin' from the game camera):
                   # inked like the hollow (each read in its own sculpt space: tunic = hood + 3.5 cm in x, mantle
                   # = hood + 0.5 cm)
                   {"part": "cloak", "carve": DomainWarp(SER_ARCH, lambda P: _arr(P) + np.array([-0.035, 0, 0]), 0.04),
                    "hex": "#17150F", "pad": 0.045, "glow": "#594A3E", "glow_r": 0.075, "glow_k": 0.9, "nz_min": 0.2},
                   {"part": "mantle", "carve": DomainWarp(SER_ARCH, lambda P: _arr(P) + np.array([-0.005, 0, 0]), 0.01),
                    "hex": "#17150F", "pad": 0.014},
                   # (fix round 3) the tunic's top rises through the hollow's floor (side-facing slivers, umber / sand, at
                   # the lower corners: the 'tan sliver'): every tunic texel inside the carve itself, whatever its facing
                   {"part": "cloak", "carve": DomainWarp(SER_ARCH_SINK, lambda P: _arr(P) + np.array([-0.035, 0, 0]), 0.06),
                    "hex": "#17150F", "pad": 0.012},
                   # (the faces the clearance carve leaves round the hollow's deep part, seen through the hood's floor)
                   {"part": "mantle", "carve": DomainWarp(SER_ARCH_SINK, lambda P: _arr(P) + np.array([-0.005, 0, 0]), 0.03),
                    "hex": "#17150F", "pad": 0.012}],
        "gw_under": {"cloak": "#33291F"},
        "gw_inner": {"mantle": ((-0.03, 0.02), 0.62)},
        "gw_ramp": [],
        # (fix round 6) the Art 2.0 finish (_finish) and the reserved marigold band (brief §2.3)
        "gw_finish": {
            "cloak": {"det": 0.65, "nap": 0.035, "edge": 0.10, "cav": 0.30, "edge_w": 0.015},
            "mantle": {"det": 0.60, "nap": 0.035, "edge": 0.14, "cav": 0.28, "edge_w": 0.012},
            "hood": {"det": 0.45, "nap": 0.03, "cav": 0.22, "carve": SER_ARCH, "carve_pad": 0.05},
            "hood_rim": {"nap": 0.04, "cav": 0.25}, "collar": {"nap": 0.04, "edge": 0.10, "cav": 0.25, "edge_w": 0.010},
            "sleeve_L": {"det": 0.50, "nap": 0.035, "edge": 0.08, "cav": 0.25},
            "sleeve_R": {"det": 0.50, "nap": 0.035, "edge": 0.08, "cav": 0.25},
            "mitt_L": {"nap": 0.03, "cav": 0.30}, "mitt_R": {"nap": 0.03, "cav": 0.30},
            "pack": {"det": 0.45, "nap": 0.04}, "drum_lid": {"nap": 0.03},
            "boot_L": {"nap": 0.03}, "boot_R": {"nap": 0.03},
        },
        "gw_reserved": {"keep": ("drum_panes",), "sat_max": 0.37},
    },
}
# wood grain directions: per part, the segments (paint space) whose nearest one gives a texel its grain axis
_SEGS = {
    "frame": [],                  # filled by lantern_aubade (the back frame follows the built back)
    "posts": [],                  # filled by lantern_serenade (the A-frame follows the built back)
}
_AUB_OVALS: list = []             # filled by lantern_aubade: (centre, frame rows, a, b) of each pane's glowing core


# ── pipeline hooks (installed once, keyed by the spec's PROJECTION: inert for every other build) ──────────
def _install() -> None:
    """Hook the shared pipeline (idempotent; inert for every other build):
      project.paint_object  -> paint_greatwick() when the PROJECTION carries `gw_pose`
      pipeline.bind_part    -> the cloak / sleeve binders for ("gw_cloak",) / ("gw_arm", side) binds."""
    from common import pipeline
    from common.hifi import project
    if not getattr(project.paint_object, "_greatwick", False):
        orig = project.paint_object

        def paint_object(obj, size, cfg, names, part_attr="vale_part", log=print, return_maps=False):
            if not cfg.get("gw_pose") and "gw_pose" not in cfg:
                return orig(obj, size, cfg, names, part_attr=part_attr, log=log, return_maps=return_maps)
            img, maps = paint_greatwick(obj, size, cfg, names, part_attr, log)
            return (img, maps) if return_maps else img

        paint_object._greatwick = True
        project.paint_object = paint_object
    if not getattr(pipeline.bind_part, "_greatwick", False):
        orig_bind = pipeline.bind_part

        def bind_part(ctx, part, obj, body_low=None):
            b = part.bind
            if isinstance(b, tuple) and b and b[0] == "gw_cloak":
                return bind_cloak(ctx, obj)
            if isinstance(b, tuple) and b and b[0] == "gw_arm":
                return bind_arm(ctx, obj, b[1])
            return orig_bind(ctx, part, obj, body_low)

        bind_part._greatwick = True
        pipeline.bind_part = bind_part
    from common import export
    if not getattr(export.optimize, "_greatwick", False):
        orig_opt = export.optimize

        def optimize(path, *a, **kw):
            res = orig_opt(path, *a, **kw)
            out = kw.get("out") or (a[0] if a else None) or path
            if os.path.basename(out).startswith("greatwick_"):
                res["metallic_zero"] = glb_metallic_zero(out)
            return res

        optimize._greatwick = True
        export.optimize = optimize


def glb_metallic_zero(path: str) -> int:
    """Bible: every material has metalness 0. The exporter writes no metallicFactor (glTF default 1.0) and the
    lossy-WebP ORM's metal channel picks up chroma noise from AO / roughness (up to 107/255 on stone): set
    metallicFactor 0 on every material so the texture's B channel is ignored. Returns the materials patched."""
    import json
    import struct
    with open(path, "rb") as fh:
        data = fh.read()
    magic, ver, _ = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67:
        return 0
    jlen, jtype = struct.unpack_from("<II", data, 12)
    js = json.loads(data[20:20 + jlen].decode("utf-8"))
    rest = data[20 + jlen:]
    n = 0
    mats = js.get("materials", [])
    acc = next((m for m in mats if m.get("name") == "accent"), None)
    for m in mats:
        # (fix round 3) the hood light's see-through shells: renamed `accent` (the renderer tints them with the core),
        # alpha-blended at their HALO_ALPHA, the accent's factors otherwise (factor-only: no maps)
        if m.get("name") in HALO_ALPHA and acc is not None:
            alpha = HALO_ALPHA[m["name"]]
            apbr = acc.get("pbrMetallicRoughness", {})
            m.clear()
            m.update({"name": "accent", "alphaMode": "BLEND", "doubleSided": False,
                      "emissiveFactor": list(acc.get("emissiveFactor", [0.25, 0.61, 1.0])),
                      "pbrMetallicRoughness": {"baseColorFactor": list(apbr.get("baseColorFactor", [0.05, 0.12, 0.25, 1.0]))[:3] + [alpha],
                                               "metallicFactor": 0.0, "roughnessFactor": 1.0}})
            if "extensions" in acc:
                m["extensions"] = json.loads(json.dumps(acc["extensions"]))
            n += 1
            continue
        pbr = m.setdefault("pbrMetallicRoughness", {})
        if pbr.get("metallicFactor", 1.0) != 0.0:
            pbr["metallicFactor"] = 0.0
            n += 1
        if m.get("name") == "accent" and pbr.get("roughnessFactor", 1.0) < 0.9:
            # the lights are soft glows: no specular highlight on them (at 0.25 the hood light showed a white glint
            # and its polygon outline, a glossy puck rather than light in the hollow)
            pbr["roughnessFactor"] = 1.0
            n += 1
    raw = json.dumps(js, separators=(",", ":")).encode("utf-8")
    raw += b" " * ((4 - len(raw) % 4) % 4)
    body = struct.pack("<II", len(raw), jtype) + raw + rest
    with open(path, "wb") as fh:
        fh.write(struct.pack("<III", magic, ver, 12 + len(body)) + body)
    return n


# ── the paint pass ─────────────────────────────────────────────────────────────────────────────────────
# project.paint (the shared pass) samples the plate wherever a texel is the first hit of the projection ray.
# Where the sculpt's silhouette runs a little outside the painted one (a hood 1-2 cm wider than the sheet's,
# with the lantern painted behind it) that texel takes the neighbour's paint: pale glass smeared on blue
# cloth. Here a texel takes the plate only inside its OWN part's region of the plate, eroded by a margin
# (per part); everything else takes the nearest own-region paint. Up-facing surfaces the 52-degree camera
# sees first (roof, lid, hood crowns, shoulders) take procedural / tiled-patch TOP paint instead of streaks.
# Parts can be painted FLAT-PAINTERLY (role colour, brush-scale value noise, top light). The visibility grid
# is cropped to the model (4-8x faster than the shared pass on these plates).
class _Vis:
    def __init__(self, obj, plates, step: int, part_attr: str):
        from mathutils import Vector
        from mathutils.bvhtree import BVHTree
        from common.hifi import project
        me = obj.data
        verts = [v.co.copy() for v in me.vertices]
        polys = [tuple(p.vertices) for p in me.polygons]
        bvh = BVHTree.FromPolygons(verts, polys)
        pop = project.poly_parts(me, part_attr)
        co = np.array([v[:] for v in verts])
        self.step = step
        self.depth, self.part, self.o = {}, {}, {}
        for side, y0, d in (("front", -50.0, Vector((0, 1, 0))), ("back", 50.0, Vector((0, -1, 0)))):
            xs = [co[:, 0].min() - 0.03, co[:, 0].max() + 0.03]
            px, py = plates.to_px(side, np.array(xs), np.array([co[:, 2].max() + 0.03, max(0.0, co[:, 2].min() - 0.03)]))
            i0, i1 = int(min(px)) // step, int(max(px)) // step + 1
            j0, j1 = int(py[0]) // step, int(py[1]) // step + 1
            gx = (np.arange(i0, i1) + 0.5) * step
            gy = (np.arange(j0, j1) + 0.5) * step
            x, _ = plates.to_world(side, gx, np.zeros_like(gx))
            _, zz = plates.to_world(side, np.zeros_like(gy), gy)
            dep = np.full((len(gy), len(gx)), np.nan, dtype=np.float32)
            pid = np.full((len(gy), len(gx)), -1, dtype=np.int16)
            for j in range(len(gy)):
                zj = float(zz[j])
                for i in range(len(gx)):
                    hit = bvh.ray_cast(Vector((float(x[i]), y0, zj)), d)
                    if hit[0] is not None:
                        dep[j, i] = hit[0].y
                        pid[j, i] = pop[hit[2]]
            self.depth[side], self.part[side], self.o[side] = dep, pid, (i0, j0)

    def cell(self, side, px, py):
        i0, j0 = self.o[side]
        d = self.depth[side]
        j = np.clip((np.asarray(py) / self.step).astype(np.int64) - j0, 0, d.shape[0] - 1)
        i = np.clip((np.asarray(px) / self.step).astype(np.int64) - i0, 0, d.shape[1] - 1)
        return j, i


def _nearest(valid: np.ndarray):
    """project.nearest_index on a grid padded to a power-of-two square (its jump flood assumes the grid is at
    least as large as its first step in both directions; the cropped visibility grids are not)."""
    from common.hifi import project
    h, w = valid.shape
    n = 1 << int(math.ceil(math.log2(max(h, w, 2))))
    pad = np.zeros((n, n), dtype=bool)
    pad[:h, :w] = valid
    iy, ix = project.nearest_index(pad)
    return np.clip(iy[:h, :w], 0, h - 1), np.clip(ix[:h, :w], 0, w - 1)


def _erode(m: np.ndarray, r: int) -> np.ndarray:
    for _ in range(max(0, r)):
        e = m.copy()
        e[1:, :] &= m[:-1, :]
        e[:-1, :] &= m[1:, :]
        e[:, 1:] &= m[:, :-1]
        e[:, :-1] &= m[:, 1:]
        m = e
    return m


def _smooth01(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


def paint_greatwick(obj, size, cfg, names, part_attr, log):
    import time
    from common.hifi import project
    t0 = time.time()
    cache = os.path.join(scene.CACHE_DIR, "concept")
    pose = cfg.get("gw_pose") or {}
    me = obj.data
    n = len(me.vertices)
    co = np.empty(n * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(n, 3)
    pv = np.zeros(n, dtype=np.int64)
    a = me.attributes.get(part_attr)
    if a is not None and a.domain == "POINT":
        a.data.foreach_get("value", pv)
    moved = co.astype(np.float64).copy()
    for i, nm in enumerate(names):
        f = pose.get(nm)
        sel = pv == i
        if f is not None and sel.any():
            moved[sel] = f(moved[sel])
    me.vertices.foreach_set("co", moved.astype(np.float32).ravel())
    me.update()
    try:
        plates = project.Plates(cache, cfg["concept"], cfg["height"])
        maps = project.rasterize(obj, size, part_attr)
        vis = _Vis(obj, plates, 2, part_attr)
    finally:
        me.vertices.foreach_set("co", co.ravel())
        me.update()
    log(f"greatwick paint: paint pose on {len(pose)} parts, raster + visibility {time.time() - t0:.1f}s")
    P, N, part = maps["P"], maps["N"], maps["part"]
    have = part >= 0
    idx = np.nonzero(have)
    p, nrm, k = P[idx], N[idx], part[idx].astype(np.int64)
    erode = cfg.get("gw_erode") or {}
    pal = cfg.get("gw_palette") or {}
    roles = cfg.get("gw_roles") or {}
    procp = cfg.get("gw_proc") or {}
    hybrid = cfg.get("gw_hybrid") or {}
    excl = cfg.get("gw_exclude") or {}
    unpose = cfg.get("gw_unpose") or {}
    cols, ok, wv = {}, {}, {}
    mask_img = None
    if cfg.get("gw_mask"):
        mask_img = project.load_rgb(os.path.join(cache, cfg["gw_mask"]))[..., 0] > 0.5
    st = np.abs(nrm[:, 0]) / (np.abs(nrm[:, 0]) + np.abs(nrm[:, 1]) + 1e-6)
    ws = _smooth01((st - 0.72) / 0.24)[:, None]
    for side in ("front", "back"):
        img = plates.img[side]
        soft = project.blur(img, 3.0)
        px, py = plates.to_px(side, p[:, 0], p[:, 2])
        c = project.bilinear(img, px, py) * (1 - ws) + project.bilinear(soft, px, py) * ws
        j, i = vis.cell(side, px, py)
        dep = vis.depth[side][j, i]
        if side == "front":
            hidden = ~(p[:, 1] <= np.nan_to_num(dep, nan=1e9) + 0.02)
        else:
            hidden = ~(p[:, 1] >= np.nan_to_num(dep, nan=-1e9) - 0.02)
        s_ = vis.step
        i0, j0 = vis.o[side]
        sh = vis.part[side].shape
        small = img[j0 * s_ + s_ // 2::s_, i0 * s_ + s_ // 2::s_][:sh[0], :sh[1]]
        inside = None
        if mask_img is not None:                     # the sheet's painted figure (the cut), 2 cells in from its edge
            mm = mask_img[j0 * s_ + s_ // 2::s_, i0 * s_ + s_ // 2::s_][:sh[0], :sh[1]]
            inside = np.zeros(sh, dtype=bool)
            inside[:mm.shape[0], :mm.shape[1]] = mm
            inside = _erode(inside, 2)
        lab = _lab(small) if excl else None
        okk = np.ones(len(k), dtype=bool)
        wsd = np.zeros(len(k), dtype=np.float32)      # how much of the texel's paint is its own (soft, 0..1)
        for kk in np.unique(k):
            sel = k == kk
            nm = names[kk]
            reg = _erode(vis.part[side] == kk, int(erode.get(nm, erode.get("*", 4))))
            if inside is not None and nm not in (cfg.get("gw_unmasked") or ()):
                rm = reg & inside
                if rm.sum() > max(8, 0.25 * reg.sum()):
                    reg = rm
            if nm in procp:
                okk[sel] = True
                # (fix round 6) painted procedurally below; the plate's own-region texels are kept as the source of
                # the concept's brush detail (gw_finish `det`), never as the colour
                if (nm in (cfg.get("gw_finish") or {})) and reg.any():
                    wsd[sel] = reg[j[sel], i[sel]] * (~hidden[sel])
                continue
            if nm in excl and reg.any():               # ghost paint (another object on the sheet): never sampled
                ex = _excluded(lab, excl[nm])
                if (reg & ~ex).sum() > max(6, 0.15 * reg.sum()):
                    reg = reg & ~ex
            if not reg.any():
                reg = vis.part[side] == kk
            if not reg.any():
                okk[sel] = False                     # never seen from this side: the other plate paints it
                continue
            if nm in hybrid:
                sw = project.blur(_erode(reg, 1).astype(np.float32), 1.2)
                wsd[sel] = sw[j[sel], i[sel]] * (~hidden[sel])
            bad = sel & (hidden | ~reg[j, i])
            if bad.any():
                iy, ix = _nearest(reg)
                fill = project.blur(small[iy, ix], 1.0)
                jj, ii = j[bad], i[bad]
                c[bad] = fill[jj, ii]
        cols[side], ok[side], wv[side] = c, okk, wsd
    wb = _smooth01((nrm[:, 1] + 0.25) / 0.5)
    wb = np.where(~ok["front"] & ok["back"], 1.0, np.where(ok["front"] & ~ok["back"], 0.0, wb))
    col = cols["front"] * (1 - wb[:, None]) + cols["back"] * wb[:, None]
    neither = ~ok["front"] & ~ok["back"]
    col = _tint_texels(col, p, k, names, cfg, log)
    proj = col.copy()                 # (fix round 6) the projected sheet per texel: the source of the brush detail
    # sculpt-space positions (the painters' geometry: cuffs, fists, bands, folds) for parts posed for the paint
    ps = p.astype(np.float64).copy()
    for kk in np.unique(k):
        f = unpose.get(names[kk])
        if f is not None:
            sel = k == kk
            ps[sel] = f(ps[sel])
    # hybrid cloth: the projected sheet where it is the part's own paint and seen square on; a procedural cloth
    # fill (the same palette, lit, brushed, folded) wherever the projection grazes, was occluded or was a ghost
    # (nearest-filled, those texels smeared into streaks and hard seams)
    graze = _smooth01((np.abs(nrm[:, 1]) - 0.22) / 0.38)
    wproj = (wv["front"] * (1 - wb) + wv["back"] * wb) * graze
    for nm, spec in hybrid.items():
        if nm not in names:
            continue
        sel = k == names.index(nm)
        if not sel.any():
            continue
        spec = dict(spec, hex=spec.get("hex") or pal.get(roles.get(nm, ""), "#808080"))
        proc = PROC_PAINTERS[spec.get("kind", "cloth")](ps[sel], nrm[sel], spec, cfg, nm)
        m = (spec.get("mix", 0.7) * wproj[sel])[:, None]
        col[sel] = col[sel] * m + proc * (1 - m)
        if spec.get("folds"):
            col[sel] = np.clip(col[sel] * _fold_shade(ps[sel], nrm[sel], spec), 0, 1)
        if spec.get("hem"):
            col[sel] = _hem_band(col[sel], ps[sel], nrm[sel], spec)
        if spec.get("bands"):
            col[sel] = _paint_bands(col[sel], ps[sel], nrm[sel], spec)
    # procedural-painterly parts (and parts no plate shows: flat in their role colour)
    for kk in np.unique(k):
        nm = names[kk]
        sel = k == kk
        if nm in hybrid:
            continue
        if nm in procp or (neither & sel).any():
            spec = procp.get(nm) or {"kind": "flat"}
            spec = dict(spec, hex=spec.get("hex") or pal.get(roles.get(nm, ""), "#808080"))
            col[sel] = PROC_PAINTERS[spec["kind"]](ps[sel], nrm[sel], spec, cfg, nm)
            if spec.get("edge"):
                col[sel] = _edges(col[sel], ps[sel], nrm[sel], spec, cfg, nm)
    # (fix round 6) the Art 2.0 finish (the glimwick's paint means) over the whole body: the concept's own brush strokes
    # as gains, felt / wool nap, the form's lit edges and dark seams from each part's own field
    wown = (wv["front"] * (1 - wb) + wv["back"] * wb) * graze
    col = _finish(col, proj, p, ps, nrm, k, names, cfg, wown, log)
    # dark channels round the accent strips (value contrast for the team light on a pale cowl)
    for host, geo, r0, r1, hexc, strength in cfg.get("gw_halo") or []:
        if host not in names:
            continue
        sel = k == names.index(host)
        q = ps[sel]
        if isinstance(geo, tuple) and geo[0] == "slab":
            _, cx, cy, zfn = geo
            dist = np.abs(q[:, 2] - zfn(np.arctan2(q[:, 1] - cy, q[:, 0] - cx)))
        else:
            dist = PolyDist(geo[0], 0.0).d(q)
            for ln in geo[1:]:
                dist = np.minimum(dist, PolyDist(ln, 0.0).d(q))
        w = (_smooth01((dist - r0 + 0.004) / 0.006) * (1 - _smooth01((dist - r1) / 0.008)) * strength)[:, None]
        tone = np.asarray(scene.hex_srgb(hexc), np.float32)[None, :] * (0.9 + 0.2 * _smooth01((nrm[sel, 2] + 0.2) / 1.0))[:, None]
        col[sel] = col[sel] * (1 - w) + tone * w
    # shells seen from inside (the mantle's lining between its lapels): a darker felt, only where the surface
    # faces the axis and away from the sky (a soft inward-normal ramp smudged the lapel tops by the collar)
    for nm, (cxy, dk) in (cfg.get("gw_inner") or {}).items():
        if nm not in names:
            continue
        sel = k == names.index(nm)
        rad = p[sel, :2] - np.asarray(cxy)
        inward = -(nrm[sel, 0] * rad[:, 0] + nrm[sel, 1] * rad[:, 1]) / (np.linalg.norm(rad, axis=1) + 1e-6)
        w = _smooth01((inward - 0.35) / 0.2) * (1 - _smooth01((nrm[sel, 2] - 0.1) / 0.3))
        col[sel] = col[sel] * (1 - w[:, None] * (1 - dk))
    # top paint on up-facing texels
    for nm, spec in (cfg.get("gw_top") or {}).items():
        if nm not in names:
            continue
        sel = k == names.index(nm)
        if not sel.any():
            continue
        wt = _smooth01((nrm[sel, 2] - spec.get("from", 0.45)) / spec.get("width", 0.35))[:, None]
        tcol = TOP_PAINTERS[spec["kind"]](p[sel], nrm[sel], spec, plates, pal)
        col[sel] = col[sel] * (1 - wt) + tcol * wt
    # the value ramp (brief §2.4, the bible's light-top / dark-feet bands): a gain by height (paint-pose z), per
    # part set; the projection replaces the procedural base, so the materials' own gradient never applies here
    for rp in cfg.get("gw_ramp") or []:
        zs = np.array([q[0] for q in rp["stops"]])
        gs = np.array([q[1] for q in rp["stops"]])
        for kk in np.unique(k):
            nm = names[kk]
            if nm in rp.get("skip", ()) or ("only" in rp and nm not in rp["only"]):
                continue
            sel = k == kk
            col[sel] = np.clip(col[sel] * np.interp(p[sel, 2], zs, gs)[:, None], 0, 1)
    # the robe's underside (seen in the death pose: a black void / a radial lampshade): a dark lining, flat-lit,
    # no folds, no ramp; the legs and boots stand in it
    for nm, hexc in (cfg.get("gw_under") or {}).items():
        if nm not in names:
            continue
        sel = k == names.index(nm)
        w = _smooth01((-nrm[sel, 2] - 0.45) / 0.3) * (1 - _smooth01((ps[sel, 2] - 0.30) / 0.08))
        v = 1.0 + 0.05 * NOISE.fbm(ps[sel], 9.0, 2)
        col[sel] = col[sel] * (1 - w[:, None]) + _out(hexc, v) * w[:, None]
    # the hood hollows LAST (after the top paint: the crown patch painted the up-facing floor of the hollow pale, the
    # 'ghost face' / 'white grin'): every texel of the part inside the opening's carve (+ pad) is ink, with a soft
    # lamp-lit falloff round the hood light (a neutral, low-saturation lift: never a team-coloured glow)
    meta = cfg.get("gw_meta") or {}
    for it in cfg.get("gw_ink") or []:
        nm = it["part"]
        if nm not in names:
            continue
        sel = k == names.index(nm)
        q = ps[sel]
        dcarve = it["carve"].d(q)
        w = 1.0 - _smooth01((dcarve - it.get("pad", 0.008)) / 0.010)
        if it.get("nz_min") is not None:             # up-facing texels only (a top seen through a hollow, not a front)
            w = w * _smooth01((nrm[sel, 2] - it["nz_min"]) / 0.2)
        ink = np.asarray(scene.hex_srgb(it["hex"]), np.float32)
        tone = np.repeat(ink[None, :], len(q), 0) * (1.0 + 0.06 * NOISE.fbm(q, 14.0, 2))[:, None]
        lt = (meta.get("hoodlight") or {}).get("light")
        if lt is not None and it.get("glow"):
            lc, lr, lax = np.asarray(lt[0]), np.asarray(lt[1]), lt[2]
            dl = q - lc
            if lax is not None:
                dl = dl @ np.asarray(lax).T
            qq = np.linalg.norm(dl / lr, axis=1)
            dm = np.maximum(qq - 1.0, 0.0) * float(np.mean(lr))
            g = (np.exp(-(dm / it.get("glow_r", 0.05)) ** 2) * it.get("glow_k", 0.85))[:, None]
            gt = np.asarray(scene.hex_srgb(it["glow"]), np.float32)[None, :]
            tone = tone * (1 - g) + gt * g
        col[sel] = col[sel] * (1 - w[:, None]) + tone * w[:, None]
    if cfg.get("gw_reserved"):
        # (fix round 6) brief §2.3: no large body area in the reserved marigold band (hue 25-50) above 40 % HSV
        # saturation; the lampresin panes keep theirs (the brief's <= 4 % allowance)
        keep = np.isin(k, [i_ for i_, nm in enumerate(names) if nm in cfg["gw_reserved"].get("keep", ())])
        col, frac = wc.clamp_reserved(col, keep, sat_max=cfg["gw_reserved"].get("sat_max", 0.37))
        log(f"greatwick paint: reserved-band clamp on {100 * frac:.1f} % of texels")
    out = np.zeros((size, size, 3), dtype=np.float32)
    out[idx] = col
    iy, ix = project.nearest_index(have)
    out = out[iy, ix]
    log(f"greatwick paint: done in {time.time() - t0:.1f}s")
    return out, maps


KEY = np.array([-0.45, -0.65, 0.60]) / np.linalg.norm([-0.45, -0.65, 0.60])   # the sheets' key (upper left, front)


def _fold_shade(ps, n, spec):
    """The sculpt's own cloth folds PAINTED as light and shade (RGB gains): each fold's side that turns to the key
    (upper left, front) lit and warmer, the side that turns away in a cooler / deeper shadow, a dark crease line at
    the bottom of each valley, a lit crest (the folds' phase and slope from the very displacement that carved them:
    the decimated game mesh keeps almost none of the folds' form, so the paint carries it)."""
    fn = {"aub": AUB_FOLDS, "ser": SER_FOLDS}[spec["folds"]]
    amp = {"aub": 0.021, "ser": 0.020}[spec["folds"]]
    cx, cy = {"aub": (-0.01, 0.0), "ser": (0.0, 0.0)}[spec["folds"]]
    u, f = fn.ridge(ps)
    side = 1.0 - _smooth01((np.abs(n[:, 2]) - 0.55) / 0.3)       # folds on the bell's sides only (not its underside)
    depth = spec.get("fold_depth", 1.0) * f * side
    # the fold's slope round the bell (numerical d u / d angle) tilts the normal along the tangent
    da = 0.004
    q = ps - np.array([cx, cy, 0.0])
    ca, sa = math.cos(da), math.sin(da)
    rot = lambda s_: np.stack([q[:, 0] * ca - s_ * q[:, 1] * sa, s_ * q[:, 0] * sa + q[:, 1] * ca, q[:, 2]], 1) + \
        np.array([cx, cy, 0.0])
    dudA = (fn.ridge(rot(1.0))[0] - fn.ridge(rot(-1.0))[0]) / (2 * da)
    r = np.maximum(np.hypot(q[:, 0], q[:, 1]), 0.05)
    slope = np.clip(amp * f * dudA / r, -1.2, 1.2) * side
    a = np.arctan2(q[:, 1], q[:, 0])
    et = np.stack([-np.sin(a), np.cos(a), np.zeros(len(a))], 1)
    n2 = n - slope[:, None] * et
    n2 /= np.linalg.norm(n2, axis=1, keepdims=True) + 1e-9
    lit = np.clip(n2 @ KEY, -0.3, 1.0) - np.clip(n @ KEY, -0.3, 1.0)          # what the fold adds to the key light
    k = spec.get("fold_light", 0.75)
    v = 1.0 + k * lit
    if getattr(fn, "smooth", False):                             # soft gathered felt: broad light and shade, no lines
        # (fix round 6) + a soft painted crease in each valley and a lit crest (review r4: smeary gradients, no folds)
        crease = 1.0 - _smooth01(u / 0.30)
        crest = _smooth01((u - 0.72) / 0.28)
        v = v * (1.0 - 0.10 * (1 - u) ** 2 * depth - spec.get("crease", 0.0) * crease * depth
                 + spec.get("crest", 0.0) * crest * depth)
    else:
        crease = 1.0 - _smooth01(u / 0.20)                       # 1 in the valley line
        crest = _smooth01((u - 0.78) / 0.22)
        v = v * (1.0 - 0.26 * crease * depth + 0.07 * crest * depth - 0.05 * (1 - u) * depth)
    warm = np.asarray(spec.get("light_tint", (1.04, 1.01, 0.95)), np.float32)
    cool = np.asarray(spec.get("shade_tint", (0.93, 0.97, 1.06)), np.float32)
    t = np.clip(lit * 2.5, -1, 1)[:, None]
    hue = np.where(t > 0, 1 + (warm - 1) * t, 1 + (cool - 1) * -t)
    return (v[:, None] * hue).astype(np.float32)


def _hem_band(col, ps, n, spec):
    """The Aubade 6-8 cm ironstone hem band (brief §2.4), painted after the projection mix (inside the mix the
    sheet's band-less cloth diluted it): it follows the pointed hem, a lit top lip, its own felt light."""
    hexh, width = spec["hem"]
    hz = aub_hem_z(ps)
    top = hz + width
    w = (1 - _smooth01((ps[:, 2] - top + 0.004) / 0.008))[:, None]
    lip = _smooth01((ps[:, 2] - top + 0.016) / 0.008) * (1 - _smooth01((ps[:, 2] - top + 0.002) / 0.004))
    v = _lit(n, {"light": (0.80, 1.16)}, key=0.10) * (1.0 + 0.04 * NOISE.fbm(ps, 12.0, 2)) * (1.0 + 0.22 * lip)
    shade = 1.0 - 0.12 * (1 - _smooth01((ps[:, 2] - hz) / 0.02))          # darker right at the cut edge
    return col * (1 - w) + _out(hexh, v * shade) * w


def _paint_bands(col, ps, n, spec):
    """Sculpted bands painted their own material (the Serenade tunic's hem rolls and belt): texels within the
    band's tube (+ a little) take the band colour, lit, with a lighter top edge."""
    out = col.copy()
    for (zc, R, r, rz, dep, _), hexc in zip(SER_TUNIC_BANDS, spec["bands"]):
        if hexc is None:
            continue
        q0 = np.sqrt(ps[:, 0] ** 2 + (ps[:, 1] / dep) ** 2) - R          # (the torus' local y is y / depth)
        q1 = (ps[:, 2] - zc) * (r / rz)
        dd = np.sqrt(q0 * q0 + q1 * q1) - r
        w = (1 - _smooth01((dd - 0.004) / 0.006))[:, None]
        top = _smooth01(((ps[:, 2] - zc) / rz - 0.35) / 0.5)
        v = _lit(n, {"light": (0.82, 1.18)}) * (1.0 + 0.05 * NOISE.fbm(ps, 24.0, 2) + 0.06 * NOISE(ps, 80.0)) * (1 + 0.12 * top)
        out = out * (1 - w) + _out(hexc, v) * w
    return out


def _edges(col, ps, n, spec, cfg, nm):
    """Hand-painted edge wear from the part's own SDF: convex edges lighter (chipped, lit stone and worn wood),
    creases and grooves darker. conv = how much shallower than e the field is e inside the surface (0 on a flat
    face, 1 on the edge line), cav the same outside."""
    F = (cfg.get("gw_fields") or {}).get(nm)
    if F is None:
        return col
    e = spec.get("edge_w", 0.012)
    q = ps
    d0 = F.d(q)
    eps = 0.0025
    g = np.stack([(F.d(q + v) - F.d(q - v)) / (2 * eps) for v in np.eye(3) * eps], 1)
    g /= np.linalg.norm(g, axis=1, keepdims=True) + 1e-9
    conv = np.clip((F.d(q - g * e) - d0 + e) / e, 0, 1)
    cav = np.clip((d0 + e - F.d(q + g * e)) / e, 0, 1)
    up = 0.55 + 0.45 * _smooth01((n[:, 2] + 0.3) / 0.9)
    lite = spec["edge"] * _smooth01((conv - 0.15) / 0.5) * up
    dark = spec.get("cavity", 0.35) * _smooth01((cav - 0.2) / 0.5)
    v = (1.0 + lite) * (1.0 - dark)
    return np.clip(col * v[:, None].astype(np.float32), 0, 1)


def _finish(col, proj, p, ps, nrm, k, names, cfg, wown, log):
    """(fix round 6) The Art 2.0 finish per part (cfg gw_finish: part -> spec), the glimwick's paint means over the
    procedural and hybrid paint:
      det    the CONCEPT'S OWN PAINTING as gains (wick_common.detail_ratio: its brush strokes, fold light and felt
             texture as a luminance ratio of the projected sheet against its own 3D low-pass, its warm / cool strokes
             as a chroma ratio), only where the texel sees its own paint square on (wown) and away from `carve`
             (the hood openings: the sheets' rims and lit hollows are not the cowl's strokes); up-facing texels fade
             out (the plates' outline strokes land on the tops as scars)
      nap    felt / wool fibre speckle and mottle (wick_common.nap)
      edge / cav / edge_w   lit convex edges and dark seams and creases from the part's own SDF (_edges), the
             sculpt's folds, rolls and band seams (never the game mesh's facets)
    Gains run in linear light."""
    from common.hifi import project
    fin = cfg.get("gw_finish") or {}
    if not fin:
        return col
    lin = project._lin(np.clip(col, 0, 1)).astype(np.float64)
    pj = project._lin(np.clip(proj, 0, 1)).astype(np.float64)
    stats = []
    for kk in np.unique(k):
        nm = names[kk]
        spec = fin.get(nm)
        if not spec:
            continue
        sel = np.nonzero(k == kk)[0]
        c = lin[sel]
        if spec.get("det"):
            keep = wown[sel] > 0.25
            if spec.get("carve") is not None:
                keep &= spec["carve"].d(ps[sel]) > spec.get("carve_pad", 0.04)
            lum, cr, w = wc.detail_ratio(pj[sel], p[sel], nrm[sel], keep=keep, cell=spec.get("cell", 0.045))
            d = spec["det"] * w
            c = c * (1.0 + d * lum)[:, None]
            c = c * (1.0 + 0.7 * d[:, None] * cr)
            stats.append(f"{nm} det {int(keep.mean() * 100)}% sd {float(np.std(d * lum)):.3f}")
        if spec.get("nap"):
            c = c * wc.nap(ps[sel], spec["nap"])[:, None]
        if spec.get("edge") or spec.get("cav"):
            e_spec = {"edge": spec.get("edge", 0.0), "cavity": spec.get("cav", 0.0), "edge_w": spec.get("edge_w", 0.012)}
            c = project._lin(_edges(project._srgb(np.clip(c, 0, 1)).astype(np.float32), ps[sel], nrm[sel], e_spec,
                                    cfg, nm)).astype(np.float64)
        lin[sel] = c
    log("greatwick paint finish: " + "; ".join(stats))
    return np.clip(project._srgb(np.clip(lin, 0, 1)), 0, 1).astype(np.float32)


def _top_patch(p, nrm, spec, plates, pal):
    """Tiled concept paint: a rectangle of the plate (side, (x0, z0, x1, z1) in concept metres), mirror-tiled
    over the part's X/Y, with a soft key-light falloff (front-left lighter)."""
    from common.hifi import project
    side = spec.get("side", "front")
    x0, z0, x1, z1 = spec["rect"]
    t = spec.get("tile", 0.14)

    def tri(u):
        u = np.mod(u, 2.0)
        return np.where(u > 1.0, 2.0 - u, u)
    u = tri((p[:, 0] + 0.37 * p[:, 1]) / t)
    v = tri((p[:, 1] - 0.21 * p[:, 0]) / t)
    px, py = plates.to_px(side, x0 + u * (x1 - x0), z0 + v * (z1 - z0))
    c = project.bilinear(project.blur(plates.img[side], 1.5), px, py)
    light = 1.0 + spec.get("key", 0.08) * np.clip(-nrm[:, 1] * 0.6 - nrm[:, 0] * 0.4, -1, 1)
    return np.clip(c * spec.get("gain", 1.0) * light[:, None], 0, 1)


def _top_roof(p, nrm, spec, plates, pal):
    """Aubade roof from above: four chalk hip facets, slab courses parallel to the eaves, lighter hips, chipped
    stone; the facet facing the key (front-left) lightest."""
    cx, cy, hx, hy = spec["box"]
    base = np.asarray(scene.hex_srgb(spec.get("hex") or pal.get("chalk", "#D6D3CA")), np.float32)
    qx, qy = (p[:, 0] - cx) / hx, (p[:, 1] - cy) / hy
    f = np.maximum(np.abs(qx), np.abs(qy))                  # 0 at the ridge, 1 at the eave
    facet = np.where(np.abs(qx) > np.abs(qy), np.where(qx > 0, 0, 1), np.where(qy < 0, 2, 3))
    shade = np.array([0.93, 1.04, 1.07, 0.88])[facet]        # +x (right, away from key), -x (key side), front, back
    course = 0.94 + 0.06 * _smooth01(np.abs(np.sin(f * math.pi * 5.0)) * 3.0)
    hip = 1.0 + 0.08 * np.clip(1 - np.abs(np.abs(qx) - np.abs(qy)) * 14.0, 0, 1)
    eave = 1.0 - 0.10 * _smooth01((f - 0.9) / 0.1)
    noise = 1.0 + 0.06 * NOISE.fbm(p, 14.0, 3) - 0.08 * np.clip(NOISE.ridged(p, 22.0, 2) - 0.55, 0, 1) * 3
    v = shade * course * hip * eave * noise
    tint = np.array([1.0, 1.0, 1.02], np.float32)
    return np.clip(base[None, :] * tint * v[:, None], 0, 1)


def _top_lid(p, nrm, spec, plates, pal):
    """Serenade lid from above: sand felt, soft radial dome light, felt nap noise, a darker rim ring."""
    cx, cy, r, ry = spec["disc"]
    base = np.asarray(scene.hex_srgb(spec.get("hex") or pal.get("cloth2", "#C9AF8A")), np.float32)
    q = np.sqrt(((p[:, 0] - cx) / r) ** 2 + ((p[:, 1] - cy) / ry) ** 2)
    dome = 1.06 - 0.16 * _smooth01((q - 0.2) / 0.8)
    key = 1.0 + 0.07 * np.clip(-(p[:, 0] - cx) / r * 0.5 - (p[:, 1] - cy) / ry * 0.5, -1, 1)
    nap = 1.0 + 0.05 * NOISE.fbm(p, 26.0, 3) + 0.03 * NOISE(p, 70.0)
    return np.clip(base[None, :] * (dome * key * nap)[:, None], 0, 1)


TOP_PAINTERS = {"patch": _top_patch, "roof": _top_roof, "lid": _top_lid}


# ── procedural-painterly parts (gw_proc) ─────────────────────────────────────────────────────────────
def _lab(rgb):
    """sRGB 0..1 (..., 3) -> CIE L*a*b* (D65)."""
    c = np.clip(np.asarray(rgb, np.float64), 0, 1)
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = lin @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def _excluded(lab, rule: dict):
    m = np.zeros(lab.shape[:2], dtype=bool)
    if "L_gt" in rule:
        m |= lab[..., 0] > rule["L_gt"]
    if "L_lt" in rule:
        m |= lab[..., 0] < rule["L_lt"]
    if "b_gt" in rule:
        m |= lab[..., 2] > rule["b_gt"]
    if "C_lt" in rule:                     # grey / unsaturated paint (the sheet's ironstone hammer across the felt)
        m |= np.hypot(lab[..., 1], lab[..., 2]) < rule["C_lt"]
    return m


def _hash(i):
    x = np.sin(np.asarray(i, np.float64) * 12.9898 + 78.233) * 43758.5453
    return x - np.floor(x)


def _lit(n, spec, lo=0.84, hi=1.08, key=0.06):
    """The sheet's value structure: lit tops, a key from the front-left, darker undersides."""
    lo, hi = spec.get("light", (lo, hi))
    v = lo + (hi - lo) * _smooth01((n[:, 2] + 0.4) / 1.2)
    return v * (1.0 + spec.get("key", key) * np.clip(-n[:, 1] * 0.6 - n[:, 0] * 0.4, -1, 1))


def _pca(p):
    c = p.mean(0)
    w, V = np.linalg.eigh(np.cov((p - c).T))
    return c, V[:, -1]


def _out(base, v, tint=None):
    col = np.asarray(scene.hex_srgb(base), np.float32)[None, :] * np.asarray(v, np.float32)[:, None]
    if tint is not None:
        col = col * tint
    return np.clip(col, 0, 1).astype(np.float32)


def _pp_flat(p, n, spec, cfg=None, nm=None):
    v = 1.0 + spec.get("noise", 0.07) * NOISE.fbm(p, 9.0, 3) + 0.04 * NOISE(p, 31.0)
    return _out(spec["hex"], v * _lit(n, spec, 0.86, 1.08, spec.get("key", 0.0)))


def _pp_felt(p, n, spec, cfg=None, nm=None):
    """Felt, linen, leather wraps: a soft mottle and a fine nap; `bands` = wrapped cloth (bands along the part)."""
    v = _lit(n, spec) * (1.0 + 0.05 * NOISE.fbm(p, 8.0, 3) + spec.get("nap", 0.04) * NOISE(p, 70.0))
    if spec.get("bands"):
        c, a = _pca(p)
        u = (p - c) @ a
        v = v * (1.0 - spec["bands"] * 0.5 * (1 - np.abs(np.cos(u * math.pi / 0.032))) ** 4)
    return _out(spec["hex"], v)


def _brush(p, n, amp=0.06, vert=True):
    """Painterly brushwork: a broad mottle + strokes stretched down the cloth (vertical) and a fine nap."""
    q = p * np.array([1.0, 1.0, 0.22 if vert else 1.0])
    return (1.0 + amp * NOISE.fbm(p, 7.0, 3) + amp * 0.9 * NOISE.fbm(q, 26.0, 2) + 0.025 * NOISE(p, 90.0))


def _pp_cloth(p, n, spec, cfg=None, nm=None):
    """Wool / felt cloth (cloaks, sleeves, the hybrid fill): palette hex, lit from the key (front-left) with lit
    tops, vertical brushwork; zones (z0, z1, hex) recolour height bands (the Aubade slate hem band); a sleeve's
    cuff band and forearm wraps come from its meta."""
    v = _lit(n, spec, 0.80, 1.12, spec.get("key", 0.08)) * _brush(p, n, spec.get("brush", 0.06), not spec.get("felt"))
    col = _out(spec["hex"], v)
    if spec.get("hem"):                           # a dark band that follows the pointed hem (Aubade, brief §2.4)
        hexh, width = spec["hem"]
        hz = aub_hem_z(p)
        w = (1 - _smooth01((p[:, 2] - hz - width + 0.006) / 0.012))[:, None]
        lip = _smooth01((p[:, 2] - hz - width + 0.018) / 0.010) * (1 - _smooth01((p[:, 2] - hz - width + 0.004) / 0.006))
        col = col * (1 - w) + _out(hexh, v * (1.0 + 0.12 * lip)) * w
    for z0, z1, hexz in spec.get("zones", ()):
        w = (_smooth01((p[:, 2] - z0 + 0.006) / 0.012) * (1 - _smooth01((p[:, 2] - z1 + 0.006) / 0.012)))[:, None]
        col = col * (1 - w) + _out(hexz, v * (1.0 + 0.10 * _smooth01((p[:, 2] - z1 + 0.03) / 0.03))) * w
    meta = ((cfg or {}).get("gw_meta") or {}).get(nm) or {}
    if meta.get("cuff") and spec.get("cuff"):
        cc, dw, hh = meta["cuff"]
        t = (p - np.asarray(cc)) @ np.asarray(dw)
        w = (1 - _smooth01((np.abs(t) - hh + 0.004) / 0.006))[:, None]
        edge = _smooth01((-t - hh + 0.012) / 0.008) * (1 - _smooth01((-t - hh + 0.002) / 0.004))      # the lit top lip
        col = col * (1 - w) + _out(spec["cuff"], v * (1.0 + 0.18 * edge)) * w
        if spec.get("wraps") and meta.get("elbow"):
            el = np.asarray(meta["elbow"])
            L_ = np.linalg.norm(np.asarray(cc) - el)
            u = np.clip((p - el) @ np.asarray(dw) / max(L_, 1e-6), 0, 1)
            band = np.zeros(len(p))
            for c_ in (0.38, 0.62, 0.84):
                band = np.maximum(band, 1 - _smooth01((np.abs(u - c_) * L_ - 0.014) / 0.006))
            col = col * (1 - band[:, None]) + _out(spec["wraps"], v * 0.95) * band[:, None]
    if meta.get("elbow"):                         # two soft creases round the elbow's inside
        el = np.asarray(meta["elbow"])
        r = np.linalg.norm(p - el, axis=1)
        cr = np.clip(1 - np.abs(np.sin(r * math.pi / 0.035)) * 4.0, 0, 1) * (1 - _smooth01((r - 0.06) / 0.05))
        col = col * (1.0 - 0.16 * cr)[:, None]
    return np.clip(col, 0, 1)


def _pp_cowl(p, n, spec, cfg=None, nm=None):
    """(fix round 3) A hood painted like the sheets' cowls (not a smooth flat fill): the key light with a lit crown,
    soft folds running back from the face opening round the hood's front-to-back axis (each a shaded crease with a lit
    side), a crease under the nape, wool / felt brushwork, a deeper tone low on the drape."""
    cx, cy, cz = spec["centre"]
    q = p - np.array([cx, cy, cz])
    v = _lit(n, spec, 0.70, 1.12, spec.get("key", 0.12)) * _brush(p, n, spec.get("brush", 0.06), not spec.get("felt"))
    phi = np.arctan2(q[:, 2], q[:, 0]) + 0.35 * NOISE.fbm(p, 3.0, 2)            # round the front-to-back axis
    k = spec.get("folds", 7)
    wv = np.abs(np.sin(phi * k / 2.0))
    crease = 1.0 - _smooth01(wv / 0.22)
    lit_side = _smooth01((np.sin(phi * k / 2.0 + 0.9) - 0.55) / 0.4)
    run = _smooth01((-q[:, 1] + 0.12) / 0.22) * _smooth01((q[:, 2] + 0.10) / 0.12)    # strongest near the opening
    f = spec.get("fold", 0.14) * run
    v = v * (1.0 - f * crease + 0.45 * f * lit_side)
    nape = (1 - _smooth01(np.abs(q[:, 2] + 0.10 + 0.03 * NOISE(p, 4.0)) / 0.025)) * _smooth01((q[:, 1] - 0.05) / 0.08)
    v = v * (1.0 - 0.14 * nape)
    v = v * (0.86 + 0.14 * _smooth01((q[:, 2] + 0.16) / 0.20))                   # deeper low on the drape
    if spec.get("felt"):
        v = v * (1.0 + 0.035 * NOISE(p, 60.0))
    return _out(spec["hex"], v)


def _pp_mitt(p, n, spec, cfg=None, nm=None):
    """A mitten fist: felt / leather, lit, three finger lines across the front of the fist (along the haft)."""
    v = _lit(n, spec, 0.80, 1.15, 0.08) * (1.0 + 0.05 * NOISE.fbm(p, 14.0, 2) + 0.04 * NOISE(p, 80.0))
    meta = ((cfg or {}).get("gw_meta") or {}).get(nm) or {}
    if meta.get("fist"):
        hc, fx, fy, fz, r = meta["fist"]
        q = p - np.asarray(hc)
        u = q @ np.asarray(fy)
        front = _smooth01((q @ np.asarray(fx) / r - 0.05) / 0.35) * (1 - _smooth01((q @ np.asarray(fz) / r - 0.55) / 0.3))
        lines = np.zeros(len(p))
        for c_ in (-0.42, 0.0, 0.42):
            lines = np.maximum(lines, 1 - _smooth01((np.abs(u - c_ * r) - 0.003) / 0.004))
        v = v * (1.0 - 0.45 * lines * front)
    return _out(spec["hex"], v)


def _pp_linen(p, n, spec, cfg=None, nm=None):
    """The Aubade stoles: pale chalk linen, a fine woven hatch, a darker hem line down both long edges and a lit
    centre crease (the sheet's stoles), lit and brushed."""
    v = _lit(n, spec, 0.84, 1.06, 0.06) * (1.0 + 0.04 * NOISE.fbm(p, 9.0, 2))
    weave = 0.025 * (np.sin(p[:, 0] * 2 * math.pi / 0.006) * np.sin(p[:, 2] * 2 * math.pi / 0.006))
    v = v * (1.0 + weave)
    hem = np.zeros(len(p))
    mid = np.zeros(len(p))
    for xc, hw in STOLES:
        dx = np.abs(p[:, 0] - xc)
        inside = dx < hw + 0.01
        hem = np.maximum(hem, inside * _smooth01((dx - hw + 0.016) / 0.004) * (1 - _smooth01((dx - hw + 0.007) / 0.004)))
        mid = np.maximum(mid, inside * (1 - _smooth01(dx / 0.012)))
    v = v * (1.0 - 0.20 * hem) * (1.0 + 0.04 * mid)
    return _out(spec["hex"], v)


def _pp_stone(p, n, spec, cfg=None, nm=None):
    """Honed stone (chalk, ironstone, sandstone): brush-scale mottle, ridged cracks, light chipped edges on the
    lit tops; `blocks` cuts it into a ring of stone blocks (the drum bands, the hammer drum), each its own tone
    with dark joints; `groove` = the Aubade rim's carved relief (a sunk line along the band + cross notches)."""
    v = _lit(n, spec, 0.82, 1.10, 0.07)
    f = spec.get("freq", 8.0)
    v = v * (1.0 + spec.get("mottle", 0.06) * NOISE.fbm(p, f, 3)) * (1.0 + spec.get("fine", 0.03) * NOISE(p, 55.0))
    cr = np.clip((NOISE.ridged(p, f * 1.4, 3) - spec.get("crack_t", 0.68)) * 5.0, 0, 1)
    v = v * (1.0 - spec.get("cracks", 0.12) * cr)
    ch = np.clip((NOISE.ridged(p, f * 2.3, 2, offset=(3.0, 1.0, 7.0)) - 0.78) * 6.0, 0, 1)
    v = v * (1.0 + spec.get("chip_light", 0.12) * ch * _smooth01((n[:, 2] + 0.1) / 0.7))
    if spec.get("arch"):                # the Aubade rim: carved voussoir blocks round the arch (the sheet's rim)
        A, joints, vc = spec["arch"]
        q = A.uvw(p)
        rad = np.hypot(q[:, 0], q[:, 1] - vc)
        ang = np.degrees(np.arctan2(q[:, 0], q[:, 1] - vc))
        dj = np.min(np.abs(ang[:, None] - np.asarray(joints)[None, :]), axis=1)
        jw = np.radians(dj) * rad                                  # the distance to the nearest joint (m)
        sill = q[:, 1] < -A.vb + 0.004                              # the sill + chin tab: one long block
        joint = np.where(sill, 0.0, 1 - _smooth01((jw - 0.0025) / 0.003))
        bi = np.where(sill, 99, np.searchsorted(np.sort(joints), ang))
        v = v * (0.93 + 0.12 * _hash(bi + 3.0)) * (1.0 - 0.42 * joint)
        nu, nv = n @ A.ax[0], n @ A.ax[1]
        inward = -(nu * q[:, 0] + nv * (q[:, 1] - vc)) / (rad + 1e-6)
        v = v * (1.0 - 0.28 * _smooth01((inward - 0.35) / 0.4))  # the inner wall in shade (not a lit lip)
        face = _smooth01((-(n @ A.ax[2]) - 0.6) / 0.3)              # the flat front face a touch lighter
        v = v * (1.0 + 0.05 * face)
    blocks = spec.get("blocks")
    if blocks:
        if blocks == "drum":
            c, a = p.mean(0), np.array([0.0, 0.0, 1.0])
            nb, sq = 11, SER_DRUM["sy"]
        else:
            c, a = _pca(p)
            nb, sq = 7, 1.0
        q = p - c
        if blocks == "drum":            # the drum's oval about the vertical
            ang = np.arctan2(q[:, 1] / sq, q[:, 0])
        else:
            e1 = np.cross(a, [0.0, 1.0, 0.0] if abs(a[1]) < 0.9 else [1.0, 0.0, 0.0])
            e1 /= np.linalg.norm(e1)
            ang = np.arctan2(q @ np.cross(a, e1), q @ e1)
        u = (ang / (2 * math.pi) + 0.5) * nb + 0.37 * NOISE(p, 6.0)
        bi = np.floor(u)
        fr = u - bi
        joint = np.clip(1.0 - np.minimum(fr, 1.0 - fr) * nb * 4.2, 0, 1) ** 2
        v = v * (0.90 + 0.18 * _hash(bi)) * (1.0 - 0.45 * joint)
        tint = (1.0 + 0.05 * (_hash(bi + 7.0) - 0.5)[:, None] * np.array([[1.0, 0.6, -0.4]])).astype(np.float32)
        return _out(spec["hex"], v, tint)
    return _out(spec["hex"], v)


def _pp_wood(p, n, spec, cfg=None, nm=None):
    """Wood: grain streaks and dark grain lines along each texel's axis (the nearest of the part's segments, or
    the part's long axis), darker toward the ends."""
    segs = _SEGS.get(spec.get("segs") or "")
    if segs:
        best = np.full(len(p), 1e9)
        ax = np.zeros_like(p)
        for a_, b_ in segs:
            a_, b_ = np.asarray(a_, float), np.asarray(b_, float)
            ab = b_ - a_
            t = np.clip((p - a_) @ ab / (ab @ ab), 0, 1)
            dd = np.linalg.norm(p - (a_ + t[:, None] * ab), axis=1)
            m = dd < best
            best[m] = dd[m]
            ax[m] = ab / np.linalg.norm(ab)
    else:
        _, a = _pca(p)
        ax = np.broadcast_to(a, p.shape)
    u = (p * ax).sum(1)
    perp = p - u[:, None] * ax
    g = perp * 55.0 + (u * 2.5)[:, None] * ax                 # long fine streaks along the axis
    grain = NOISE.fbm(g, 1.0, 2)
    lines = np.clip((NOISE.ridged(g * 1.3, 1.0, 2) - 0.80) * 5.0, 0, 1)
    v = _lit(n, spec) * (1.0 + 0.07 * grain) * (1.0 - 0.18 * lines) * (1.0 + 0.02 * NOISE.fbm(p, 4.0, 2))
    return _out(spec["hex"], v)


def _pp_glass(p, n, spec, cfg=None, nm=None):
    """Dawnglass panes (glossy in the material; the lit slab on each is the accent): cool, a deeper blue margin
    toward the frame (it frames the light), lighter toward the top, one soft diagonal sheen."""
    cx, cy, hw, hd, z0, z1 = spec["box"]
    t = np.clip((p[:, 2] - z0) / (z1 - z0), 0, 1)
    front = np.abs(n[:, 1]) >= np.abs(n[:, 0])
    lat = np.where(front, (p[:, 0] - cx) / hw, (p[:, 1] - cy) / hd)
    if spec.get("smoke"):
        # (fix round 6) SMOKED dawnglass (review r4: the lamp halo darkened the L* 48 pane it lay on, 48 -> 39 -> 70 ->
        # 39 -> 48, a muddy ring round each glow): a dark smoky pane, L* <= 30 round the cores and never lighter
        # outward (a little deeper at the frame), so the halo can only ADD light; a soft frost and one faint sheen
        v = (0.97 + 0.05 * t) * (1.0 - 0.16 * _smooth01((np.abs(lat) - 0.62) / 0.38))
        v = v * (1.0 - 0.12 * _smooth01((np.abs(t - 0.5) - 0.36) / 0.14))
        sheen = np.clip(1.0 - np.abs(np.sin((lat * 0.9 + t * 1.6) * 2.2)) * 3.0, 0, 1)
        v = v * (1.0 + 0.04 * sheen) * (1.0 + 0.05 * NOISE.fbm(p, 22.0, 3) + 0.025 * NOISE(p, 90.0))
        return _out(spec["hex"], v)
    # (fix 5) a DEEP margin at the frame and a bright frosted bloom round the core (below): the light reads as being
    # inside the glass, not a sticker on a uniformly pale pane
    v = (0.66 + 0.12 * t) * (1.0 - 0.34 * _smooth01((np.abs(lat) - 0.55) / 0.45))
    v = v * (1.0 - 0.24 * _smooth01((np.abs(t - 0.5) - 0.34) / 0.16))       # deeper at the top / bottom frame too
    sheen = np.clip(1.0 - np.abs(np.sin((lat * 0.9 + t * 1.6) * 2.2)) * 3.0, 0, 1)
    v = v * (1.0 + 0.08 * sheen)
    # FROST: a soft mottle and fine grain (frosted glass, not a flat sheet)
    v = v * (1.0 + 0.06 * NOISE.fbm(p, 22.0, 3) + 0.03 * NOISE(p, 90.0))
    col = _out(spec["hex"], v)
    # the light through the frost round each pane's core: a pale, near-white falloff (neutral, never team colour)
    q = np.full(len(p), 9.0)
    for c_, ax_, a_, b_ in _AUB_OVALS:
        ax_ = np.asarray(ax_, float)
        dd = p - np.asarray(c_, float)
        facing = (n @ ax_[1]) > 0.55
        rr = np.hypot(dd @ ax_[0] / a_, dd @ ax_[2] / b_)
        q = np.where(facing, np.minimum(q, rr), q)
    halo = (1.0 - _smooth01((q - 0.92) / 1.15)) ** 1.4 * (1.0 + 0.10 * NOISE.fbm(p, 16.0, 2))
    pale = _out(spec.get("frost", "#EEF3F7"), 1.0 + 0.04 * NOISE.fbm(p, 30.0, 2))
    w = np.clip(halo * spec.get("bloom", 0.95), 0, 1)[:, None]
    return np.clip(col * (1 - w) + pale * w, 0, 1)


def _iron(p, n, v_extra=1.0, hexc="#4B4039", lit=(0.74, 1.38)):
    """Painted dark ironstone (Serenade): broad planes (a lit top, a mid face, a dark underside), a soft mottle at
    brush scale, a few long cracks; no fine speckle (granite read)."""
    v = _lit(n, {"light": lit}, key=0.07) * (1.0 + 0.05 * NOISE.fbm(p, 4.0, 3)) * (1.0 + 0.012 * NOISE(p, 40.0))
    cr = np.clip((NOISE.ridged(p, 7.0, 3) - 0.78) * 5.0, 0, 1)
    return _out(hexc, v * (1.0 - 0.14 * cr) * v_extra)


def _pp_blocks(p, n, spec, cfg=None, nm=None):
    """(fix round 3) The Serenade drum's two block courses: painted dark ironstone, each carved block its own tone, its
    end faces (in the joints) dark, chisel-dressed faces (soft horizontal strokes), cracks; the chamfers' lit edges
    and the joints' cavities come from _edges (the hulls' own field)."""
    D = _DRUM
    c, sy, n_ = D["c"], D["sy"], D["n"]
    l0, l1, w0, w1, u0, u1 = D["z"]
    x, y, z = p[:, 0] - c[0], (p[:, 1] - c[1]) / sy, p[:, 2]
    ang = np.arctan2(y, x)
    upper = z > (w0 + w1) / 2
    ph = np.where(upper, D["up_phase"], D["lo_phase"])
    uu = np.mod((ang - ph) / (2 * np.pi) * n_, n_)
    bi = np.floor(uu)
    fr = uu - bi
    seg = 2 * np.pi * D["R"][0] / n_ * 0.82                     # a block's length (m, roughly: the oval's mean)
    # (fix round 6: the courses are round rings now, the blocks are painted) a crisp dark joint (7 mm), a soft shade
    # into it, a chipped lit arris on the block's leading edge, a few broken top corners (dark notches)
    dj = np.minimum(fr, 1.0 - fr) * seg
    joint = 1.0 - _smooth01((dj - 0.0035) / 0.003)
    end = 1.0 - _smooth01((dj - 0.004) / 0.016)
    arris = _smooth01((dj - 0.004) / 0.002) * (1.0 - _smooth01((dj - 0.010) / 0.004)) * (fr > 0.5)
    zt = np.where(upper, u1, l1 + 0.004)
    notch = (_hash(bi * 3.1 + np.where(upper, 5.0, 0.0)) < 0.45) * (1.0 - _smooth01((dj - 0.010) / 0.025)) * \
        (1.0 - _smooth01((zt - z - 0.006) / 0.012))
    tone = 0.84 + 0.26 * _hash(bi + np.where(upper, 31.0, 0.0))
    dress = 1.0 + 0.05 * NOISE.fbm(p * np.array([1.0, 1.0, 5.0]), 14.0, 2)       # chisel strokes along the course
    v_ = tone * dress * (1.0 - 0.18 * end) * (1.0 - 0.55 * joint) * (1.0 + 0.16 * arris) * (1.0 - 0.35 * notch)
    col = _iron(p, n, v_, spec.get("hex", "#4B4039"), lit=spec.get("lit", (0.70, 1.42)))
    tint = (1.0 + 0.06 * (_hash(bi + 7.0) - 0.5)[:, None] * np.array([[1.0, 0.7, -0.3]])).astype(np.float32)
    return np.clip(col * tint, 0, 1)


def _pp_resin(p, n, spec, cfg=None, nm=None):
    """(fix round 3) The drum's lampresin panes: glossy amber resin, DEEP at the frame (the posts, the courses) and a
    frosted bloom toward the core it frames (the light inside the resin; neutral amber paint, never team colour), a
    soft mottle and fine grain."""
    D = _DRUM
    q = np.full(len(p), 9.0)
    lat = np.zeros(len(p))
    for (cc, ax_w, a_, b_), w in zip(D["cores"], D["wins"]):
        dd = p - np.asarray(cc)
        rr = np.hypot(dd @ ax_w[0] / a_, dd @ ax_w[2] / b_)
        mine = rr < q
        q = np.where(mine, rr, q)
        lat = np.where(mine, np.abs(dd @ ax_w[0]) / (w["hw"] + 1e-6), lat)
    l0, l1, w0, w1, u0, u1 = D["z"]
    t = np.clip((p[:, 2] - w0) / (w1 - w0), 0, 1)
    edge = np.maximum(_smooth01((lat - 0.70) / 0.30), _smooth01((np.abs(t - 0.5) - 0.36) / 0.14))
    bloom = (1.0 - _smooth01((q - 1.0) / 1.5)) ** 1.3
    v = (1.0 + 0.06 * NOISE.fbm(p, 20.0, 3) + 0.03 * NOISE(p, 80.0)) * (1.0 - 0.30 * edge)
    deep = _out(spec.get("deep", "#6A4A2C"), v)
    warm = _out(spec.get("hex", "#A57A47"), v)
    w_ = bloom[:, None]
    return np.clip(deep * (1 - w_) + warm * w_, 0, 1)


def _pp_lid(p, n, spec, cfg=None, nm=None):
    """The drum's padded felt lid (fix round 4): a low felt dome a step darker than the hood, puffed, its nap and a
    soft dome light, FRAMED by a broad dark ironstone rim round its foot (lit upper edge, a contact shade on the felt
    above it) and a small dark knob on top; no straps crossing it."""
    meta = ((cfg or {}).get("gw_meta") or {}).get(nm) or {}
    c, Rl, sy, zl0, hl, rib_a = meta["lid"]
    x, y = p[:, 0] - c[0], (p[:, 1] - c[1]) / sy
    r = np.hypot(x, y)
    q = r / Rl
    v = _lit(n, {"light": (0.80, 1.06)}, key=0.06) * (1.0 + 0.05 * NOISE.fbm(p, 9.0, 3) + 0.035 * NOISE(p, 70.0))
    v = v * (1.0 - 0.10 * _smooth01((q - 0.70) / 0.18))                    # the felt shades toward the rim
    col = _out(spec.get("hex", "#857055"), v)
    rim = _smooth01((q - 0.80) / 0.035) * (1.0 - _smooth01((p[:, 2] - (zl0 + 0.012 + hl * 0.42)) / 0.006))
    knob = 1.0 - _smooth01((r - 0.030) / 0.005)
    wv = _lit(n, {"light": (0.78, 1.22)}, key=0.06) * (1.0 + 0.06 * NOISE.fbm(p * np.array([1, 1, 3]), 30.0, 2))
    wv = wv * (1.0 + 0.16 * _smooth01((n[:, 2] - 0.55) / 0.3) * _smooth01((q - 0.88) / 0.04))   # the rim's lit top
    iron = _out(spec.get("rib", "#3A2E26"), wv)
    w = np.maximum(rim, knob)[:, None]
    return np.clip(col * (1 - w) + iron * w, 0, 1)


def _pp_spool(p, n, spec, cfg=None, nm=None):
    """The Serenade hammer head: painted dark ironstone, the body cut into six upright blocks (dark joints), the
    flanged caps with lit chipped edges (from _edges), the striking faces darker and cracked; a lampresin window
    ring round the accent lens in the outer face."""
    meta = ((cfg or {}).get("gw_meta") or {}).get(nm) or {}
    hc, up, d = (np.asarray(v_, float) for v_ in meta["spool"])
    q = p - hc
    t = q @ up
    rv = q - t[:, None] * up
    e1 = d
    e2 = np.cross(up, d)
    ang = np.arctan2(rv @ e2, rv @ e1)
    body = np.abs(t) < 0.128
    nb = 6
    uu = (ang / (2 * np.pi) + 0.5) * nb + 0.2 * NOISE(p, 6.0)
    bi = np.floor(uu)
    fr = uu - bi
    joint = np.clip(1.0 - np.minimum(fr, 1.0 - fr) * nb * 5.5, 0, 1) ** 2 * body
    face = np.abs(n @ up) > 0.75
    tone = np.where(body, 0.90 + 0.18 * _hash(bi), 1.0) * np.where(face & ~body, 0.82, 1.0)
    col = _iron(p, n, tone * (1.0 - 0.5 * joint), spec.get("hex", "#4B4039"))
    # the two raised sandstone bands (their outer face and their lips)
    rr = np.linalg.norm(rv, axis=1)
    tb = np.minimum(np.abs(t - 0.0785), np.abs(t + 0.0785))
    band = (tb < 0.0235) & (rr > 0.121)
    if band.any():
        # (fix round 6: the bands are clean lathe rings now) painted wear: a soft lit centre, worn darker lips, chips
        # and a few dark scuffs round the ring (it read as crumpled tape when the decimated band carried it)
        vb = _lit(n[band], {"light": (0.80, 1.12)}, key=0.07) * (1.0 + 0.05 * NOISE.fbm(p[band], 8.0, 3))
        chip = np.clip((NOISE.ridged(p[band], 16.0, 2) - 0.80) * 6.0, 0, 1)
        lip = _smooth01((tb[band] - 0.015) / 0.008)
        scuff = np.clip((NOISE.fbm(p[band] * np.array([1.0, 1.0, 1.0]), 22.0, 2) - 0.25) * 3.0, 0, 1)
        vb = vb * (1.0 + 0.06 * (1 - lip)) * (1.0 - 0.22 * lip) * (1.0 - 0.25 * chip) * (1.0 - 0.18 * scuff)
        col[band] = _out(spec.get("band", "#C3A47A"), vb)
    wc_ = hc + d * 0.112                                          # the window ring (lampresin) round the lens
    dr = np.linalg.norm((p - wc_) - ((p - wc_) @ d)[:, None] * d, axis=1)
    outer = (n @ d) > 0.55                                        # the outer face only (a position test bit a notch)
    # (fix round 6) the window is an accent lens now, FRAMED IN DARK IRON (a lampresin amber ring read as a marigold
    # light on ally-blue wicks: review r4)
    ring = (dr < 0.044) & outer
    col = np.where(ring[:, None], _out(spec.get("frame", "#3A2E26"), 0.85 + 0.35 * _smooth01((dr - 0.032) / 0.010)), col)
    rim = (np.abs(dr - 0.046) < 0.003) & outer
    col = np.where(rim[:, None], col * 1.25, col)
    return col


def _pp_pack(p, n, spec, cfg=None, nm=None):
    """(fix 5) the Serenade back pack: brushed umber felt, its two raised straps dark waxed leather with lit edges."""
    v = _lit(n, spec) * (1.0 + 0.06 * NOISE.fbm(p, 7.0, 3) + spec.get("nap", 0.04) * NOISE(p, 70.0))
    col = _out(spec["hex"], v * _brush(p, n, 0.05))
    yf, yb, zc, hz = (cfg or {}).get("gw_meta", {}).get(nm, {}).get("pack", (0.3, 0.55, 0.82, 0.16))
    strap = np.zeros(len(p), bool)
    for zb in (zc - hz * 0.45, zc + hz * 0.40):
        strap |= np.abs(p[:, 2] - zb) < 0.021
    if strap.any():
        col[strap] = _out(spec.get("strap", "#45362C"), v[strap] * (1.0 + 0.10 * NOISE(p[strap], 30.0)))
    return col


PROC_PAINTERS = {"pack": _pp_pack, "flat": _pp_flat, "cowl": _pp_cowl, "felt": _pp_felt, "stone": _pp_stone, "wood": _pp_wood, "glass": _pp_glass,
                 "cloth": _pp_cloth, "mitt": _pp_mitt, "linen": _pp_linen, "blocks": _pp_blocks, "resin": _pp_resin, "lid": _pp_lid,
                 "spool": _pp_spool, "iron": lambda p, n, spec, cfg=None, nm=None: _iron(p, n, 1.0, spec.get("hex", "#4B4039"))}


def _tint_texels(col, p, k, names, cfg, log):
    """Move a part's (or a height zone's) painted median onto a palette colour, keeping the brush detail
    (per-channel gain in linear light, blended by `strength`). Runs on the projected paint, before the ink,
    lining and top passes, so a hood's dark hollow never drags its median down."""
    from common.hifi import project
    tints = cfg.get("gw_tints") or []
    pal = cfg.get("gw_palette") or {}
    roles = cfg.get("gw_roles") or {}
    ink = {it["part"]: it["carve"] for it in (cfg.get("gw_ink") or [])}
    lin = project._lin(np.clip(col, 0, 1))
    for nm, zone, hexcol, kk in tints:
        if nm not in names:
            continue
        sel = k == names.index(nm)
        w = sel.astype(np.float32)
        if zone is not None:
            z0, z1 = zone
            w = w * np.clip((z1 + 0.008 - p[:, 2]) / 0.016, 0, 1) * np.clip((p[:, 2] - z0 + 0.008) / 0.016, 0, 1)
        stat = w > 0.5
        if nm in ink:
            stat &= ink[nm].d(p) > 0.03                                    # the outer surface only
        if not stat.any():
            continue
        hexc = hexcol or pal.get(roles.get(nm, ""), "#808080")
        tgt = project._lin(np.asarray(scene.hex_srgb(hexc), np.float32))
        lum = lin[stat] @ np.array([0.2126, 0.7152, 0.0722])
        upper = lum >= np.percentile(lum, 45)                     # the part's own material, not its shadows/trim
        mean = np.median(lin[stat][upper], axis=0)
        gain = np.clip(tgt / np.maximum(mean, 1e-4), 0.05, 6.0)
        lin = lin * (1 + (gain - 1) * (w * kk)[:, None])
        log(f"  tint {nm} {zone or ''}: median {np.round(mean, 3).tolist()} -> {hexc} x{kk}")
    return project._srgb(lin).astype(np.float32)


def bind_cloak(ctx, obj) -> dict:
    """The cloak: hips -> spine -> chest by height, and toward the hem a share of the thigh on its side, so the
    bell sways with the waddle without the legs tearing it (the legs are short and hidden)."""
    from common import mesh
    arm = ctx.info.armature
    info = ctx.info
    obj.vertex_groups.clear()
    G = {b: obj.vertex_groups.new(name=b) for b in ("hips", "spine", "chest", "thigh.L", "thigh.R")}
    z_hip = info.j("pelvis").z
    z_sp = info.j("spine1").z
    z_ch = info.j("neck_base").z
    for v in obj.data.vertices:
        p = obj.matrix_world @ v.co
        w = {}
        t1 = mesh.smoothstep(z_hip + 0.02, z_sp, p.z)
        t2 = mesh.smoothstep(z_sp, z_ch - 0.03, p.z)
        w["hips"] = (1 - t1)
        w["spine"] = t1 * (1 - t2)
        w["chest"] = t2
        leg = 0.22 * mesh.smoothstep(z_hip - 0.02, 0.14, p.z) * min(1.0, abs(p.x) / 0.14)   # (0.42 dipped the hem 9 cm)
        side = "thigh.L" if p.x > 0 else "thigh.R"
        if leg > 0:
            w = {k: v_ * (1 - leg) for k, v_ in w.items()}
            w[side] = leg
        for k, val in w.items():
            if val > 1e-3:
                G[k].add([v.index], val, "REPLACE")
    mesh.add_armature_modifier(obj, arm)
    mesh.parent_keep(obj, arm)
    mesh.limit_weights(obj)
    return {"custom": "gw_cloak"}


def bind_arm(ctx, obj, side: str) -> dict:
    """A sleeve: bone heat over its own arm chain + the chest only (never the other arm or the legs)."""
    from common import mesh
    other = "L" if side == "R" else "R"
    excl = ("root", "prop.L", "prop.R", "hips", "spine", "neck", "head") + tuple(
        f"{b}.{other}" for b in ("shoulder", "upper_arm", "forearm", "hand")) + tuple(
        f"{b}.{s}" for b in ("thigh", "shin", "foot", "toe") for s in "LR")
    return mesh.bind_auto(obj, ctx.info.armature, exclude=excl)


# ── motion (brief §3.3): idle, run, attack1, death; the standard generators fill the unplayed rest ───────────
from dataclasses import dataclass as _dc  # noqa: E402

HT, FT = anim.HandTarget, anim.FootTarget


@_dc
class AimUp(anim.Aim):
    """anim.Aim + a roll: after the haft is pointed along `dir`, the hammer head's long axis (prop +Z, the
    striking faces) turns toward `up` (projected off the haft). Solved by the wrapper installed below."""
    up: tuple = (0.0, 0.0, 1.0)

    def lerp(self, o, t):
        b = anim.Aim.lerp(self, o, t)
        t = max(0.0, min(1.0, t))
        u = self.up
        if isinstance(o, AimUp):
            a_, c_ = np.asarray(self.up, float), np.asarray(o.up, float)
            u = tuple(a_ + (c_ - a_) * t)
        return AimUp(b.dir, b.weight, u)

    def mirrored(self):
        return AimUp((-self.dir[0], self.dir[1], self.dir[2]), self.weight, (-self.up[0], self.up[1], self.up[2]))


def _install_aim_up() -> None:
    if getattr(anim._solve_aim, "_gw", False):
        return
    from mathutils import Matrix, Vector
    orig = anim._solve_aim

    def solve(skel, pose, M, side, am):
        orig(skel, pose, M, side, am)
        if not isinstance(am, AimUp) or am.weight <= 0:
            return
        hand, prop = f"hand.{side}", f"prop.{side}"
        M2 = skel.fk(pose)
        R = M2[prop].to_3x3()
        axis = R.col[1].normalized()
        cur = R.col[2].normalized()
        want = Vector(am.up)
        want = want - axis * want.dot(axis)
        if want.length < 1e-5:
            return
        want.normalize()
        ang = math.atan2(cur.cross(want).dot(axis), cur.dot(want)) * am.weight
        new = Matrix.Rotation(ang, 3, axis) @ M2[hand].to_3x3()
        Ph = (M2[skel.parent[hand]] @ skel.local[hand]).to_3x3()
        pose[hand] = skel.euler_of(Ph.inverted() @ new, pose.get(hand))

    solve._gw = True
    anim._solve_aim = solve


class _Arms:
    """IK targets from WORLD points of the rest pose: `rel` is (point - rest shoulder) / arm length, which the
    solver reads in the posed chest frame (so torso turns carry the hands, as the anim library intends)."""

    def __init__(self, spec):
        self.L = spec.L
        self.P = spec.PROPORTIONS
        self.len = self.P["arm"]

    def rel(self, side, pt):
        sh, _, _ = rest_arm(self.L, side)
        return tuple((np.asarray(pt, float) - sh) / self.len)

    def hold(self, grip, d, up=(0.0, 0.0, 1.0), along=None, pole=(-0.8, 0.3, -0.5), lpole=(0.8, 0.3, -0.5)):
        """Right fist on the haft at `grip` (world, rest frame), the haft along `d`, the left fist `along` the haft."""
        d = np.asarray(d, float)
        d = d / np.linalg.norm(d)
        grip = np.asarray(grip, float)
        # the right hand target is the WRIST: the grip sits a hand-width beyond it (rest offset prop.R - wrist)
        _, _, wr = rest_arm(self.L, "R")
        off = np.asarray(self.L["grip_r"], float) - wr
        ik = {"hand.R": HT(rel=self.rel("R", grip - off), pole=pole), "aim.R": AimUp(tuple(d), 1.0, tuple(up))}
        if along is not None:
            ik["hand.L"] = HT(to_prop=("prop.R", along), pole=lpole)
        return ik


def _feet(st=(0.0, 0.0), yl=6.0, yr=-6.0, dl=(0, 0, 0), dr=(0, 0, 0), pl=0.0, pr=0.0, kl=0.0, kr=0.0):
    return {"foot.L": FT((st[0] + dl[0], st[1] + dl[1], dl[2]), pl, yl, 0.0, kl),
            "foot.R": FT((-st[0] + dr[0], -st[1] + dr[1], dr[2]), pr, yr, 0.0, kr)}


def _P(**kw):
    return anim.P(**kw)


def _pose(torso: dict, hips=(0.0, 0.0, 0.0), ik: dict | None = None) -> dict:
    p = anim.merge(anim.arms_relaxed(), torso)
    p["hips_loc"] = tuple(hips)
    p["ik"] = dict(ik or {})
    return p


HAMMER_PARTS = ("haft", "hammer_head", "hammer_bind", "hammer_bands", "hammer_window", "grip", "pommel")


class _Ground:
    """The built game mesh skinned in numpy (linear blend, the exported weights) for any resolved pose: the clips
    are solved against the real silhouette, so nothing floats or sinks (the first death hung 7-14 cm in the air
    and the run's feet sat 1-2 cm in the ground)."""

    def __init__(self, ctx, spec):
        import bpy
        self.skel = anim.Skeleton(ctx.info.armature)
        self.bones = list(self.skel.order)
        bi = {b: i for i, b in enumerate(self.bones)}
        self.rest_inv = np.stack([np.array(self.skel.rest[b].inverted()) for b in self.bones])
        names = [sp.name for sp in spec.parts()]
        Vs, Bs, Ws, Ps = [], [], [], []
        for o in (bpy.data.objects.get(spec.ID), bpy.data.objects.get(f"{spec.ID}_accent")):
            if o is None or o.type != "MESH":
                continue
            me = o.data
            n = len(me.vertices)
            co = np.empty(n * 3, np.float32)
            me.vertices.foreach_get("co", co)
            mw = np.array(o.matrix_world)
            co = co.reshape(n, 3) @ mw[:3, :3].T + mw[:3, 3]
            pid = np.zeros(n, np.int64)
            a = me.attributes.get("vale_part")
            if a is not None and a.domain == "POINT":
                a.data.foreach_get("value", pid)
            gname = {g.index: g.name for g in o.vertex_groups}
            B = np.zeros((n, 4), np.int64)
            W = np.zeros((n, 4), np.float64)
            for v in me.vertices:
                ws = sorted(((bi[gname[g.group]], g.weight) for g in v.groups
                             if gname.get(g.group) in bi and g.weight > 1e-4), key=lambda q: -q[1])[:4]
                tot = sum(w for _, w in ws) or 1.0
                for j, (b, w) in enumerate(ws):
                    B[v.index, j], W[v.index, j] = b, w / tot
            Vs.append(co)
            Bs.append(B)
            Ws.append(W)
            Ps.append(pid)
        self.V = np.concatenate(Vs)
        self.Vh = np.c_[self.V, np.ones(len(self.V))]
        self.B, self.W, self.pid = np.concatenate(Bs), np.concatenate(Ws), np.concatenate(Ps)
        self.names = names

    def sel(self, *prefixes):
        m = np.zeros(len(self.V), bool)
        for i, nm in enumerate(self.names):
            if nm.startswith(prefixes):
                m |= self.pid == i
        return m

    def points(self, pose: dict, mask=None) -> np.ndarray:
        """World positions of the (masked) vertices under a RESOLVED pose (no ik left in it)."""
        M = self.skel.fk(pose)
        S = np.stack([np.array(M[b]) for b in self.bones]) @ self.rest_inv            # (nb, 4, 4)
        B, W, Vh = (self.B, self.W, self.Vh) if mask is None else (self.B[mask], self.W[mask], self.Vh[mask])
        X = np.einsum("nk,nkij,nj->ni", W, S[B], Vh)
        return X[:, :3]

    def grounded(self, fn, aim_key: str = "aim.R", body_solve: bool = True):
        """Wrap a clip sample: resolve its IK, then lift / drop the whole body so the lowest point of the BODY
        (the hammer and the arms excluded: they must never prop it up) is on z = 0 (body_solve; off for clips whose
        feet are planted by IK); then, if the hammer dips under the ground, its aim is raised toward level just
        enough (bisection) that it rests on it."""
        body = ~self.sel(*HAMMER_PARTS, "sleeve", "mitt")
        prop = self.sel(*HAMMER_PARTS)
        hem = self.sel("cloak", "stole", "mantle")

        def sample(t):
            raw = fn(t)
            pose = anim.resolve(self.skel, raw)
            if not body_solve:
                # planted clips (attack1): the robe's hem never cuts the ground (the committed hit and follow-through
                # pitch the bell forward onto its front hem): the hips rise just enough, the feet IK re-solved
                for _ in range(3):
                    lo_h = float(self.points(pose, hem)[:, 2].min())
                    if lo_h >= 0.002:
                        break
                    raw = dict(raw)
                    h0 = raw.get("hips_loc", (0.0, 0.0, 0.0))
                    raw["hips_loc"] = (h0[0], h0[1], h0[2] + 0.003 - lo_h)
                    pose = anim.resolve(self.skel, raw)
            hx, hy, hz = pose.get("hips_loc", (0.0, 0.0, 0.0))
            lo = float(self.points(pose, body)[:, 2].min()) if body_solve else 0.0
            loc = (hx, hy, hz - lo)
            pose["hips_loc"] = loc
            am = (raw.get("ik") or {}).get(aim_key)
            if am is None or float(self.points(pose, prop)[:, 2].min()) > -0.004:
                return pose
            d0 = np.asarray(am.dir, float)
            lo_u, hi_u, best = 0.0, 1.0, pose
            for _ in range(8):
                u = (lo_u + hi_u) / 2
                d = d0.copy()
                d[2] = d0[2] * (1 - u) + 0.35 * u
                d /= np.linalg.norm(d)
                r2 = dict(raw)
                r2["ik"] = dict(raw["ik"])
                r2["ik"][aim_key] = AimUp(tuple(d), am.weight, getattr(am, "up", (0.0, 0.0, 1.0)))
                p2 = anim.resolve(self.skel, r2)
                p2["hips_loc"] = loc
                if float(self.points(p2, prop)[:, 2].min()) < 0.0:
                    lo_u = u
                else:
                    hi_u, best = u, p2
            return best
        return sample


def motion_clips(ctx, spec) -> dict:
    _install_aim_up()
    A = _Arms(spec)
    GR = _Ground(ctx, spec)
    L = spec.L
    d0 = np.asarray(L["haft"], float) / np.linalg.norm(L["haft"])
    g0 = np.asarray(L["grip_r"], float)
    along0 = L["grip_l_along"]
    feet0 = _feet((0.012, 0.0))
    hold0 = A.hold(g0, d0, (0, 0, 1), along0)
    G = _pose(_P(hips=(2, 0, 0), spine=(2, 0, 0), chest=(1, 0, 0), neck=(-2, 0, 0), head=(-2, 0, 0)), (0, 0.0, -0.012),
              dict(hold0, **feet0))
    out = {}

    # IDLE (72 f): the hammer across the hips, a slow heave, the lantern rocking ~2 degrees on the yoke
    def idle(t):
        b = anim.osc(t, 1)
        r = anim.osc(t, 1, 0.25)
        p = anim.add(G, _P(spine=(0.8 * b, 0, 0.5 * r), chest=(1.6 * b, 0, 1.6 * r), neck=(-1.2 * b, 0, 0),
                           head=(-0.8 * b, 2.0 * anim.osc(t, 1, 0.1), -0.8 * r), shoulder_L=(0, 0, 1.2 * b),
                           shoulder_R=(0, 0, -1.2 * b)))
        p["hips_loc"] = (0.006 * r, 0.0, -0.012 - 0.008 * (0.5 + 0.5 * b))
        return p
    out["idle"] = anim.Clip("idle", 72, True, anim.drag(idle, 72, {"head": 3.0, "neck": 2.0}, loop=True))

    # RUN (10 f at 3.2 m/s): a short-legged rolling waddle. Planted feet move back at exactly run_ref_speed;
    # the hips roll side to side, the chest counter-rolls so the lantern stays near level; the hammer is
    # carried diagonally (head up by the left shoulder), bouncing with the steps
    out["run"] = _run_clip(spec, A, d0, GR)

    # ATTACK1 (30 f, impact f12 = 40 % = the 0.40 s windup): one continuous two-hand arc (fix 5): a slow hoist up
    # the front and over the right shoulder (outside the lantern), a hang, a fast slam over the top; at the impact
    # the head is at its highest forward point (the lob leaves there), then it falls to the ground in front
    out["attack1"] = _attack_clip(spec, A, G, feet0, GR)

    # DEATH (60 f): the hammer falls (gravity) and lies on the ground, the wick sits back heavily against its
    # lantern frame and tips back onto it; ends at rest (propped on the lantern, the fists on the ground)
    out["death"] = _death_clip(spec, A, G, GR)
    return out


def _run_clip(spec, A, d0, GR):
    """A heavy rolling WADDLE (brief §3.3): 10 frames (0.333 s, 6 short steps/s), no flight: each foot is planted
    half the cycle, so one boot is always on the ground (the first fix's 0.75 m bounding step left both boots
    4 cm in the air twice a cycle). The planted foot moves back at exactly run_ref_speed and rolls heel to toe
    (strikes toes-up about the heel, leaves heel-up about the ball: the anim foot pivots), which buys the short
    legs their reach; the body is lowest as the weight changes feet and rides up over the planted leg, sways and
    rolls onto it (the chest gives part of the roll back: the lantern rocks, near level); the hammer bounces late
    on the steps. Planted boots are solved onto the ground against the skinned mesh every frame; swinging ones
    clear it (the clearance eases in and out at lift-off and touch-down)."""
    v = spec.MOTION["run_ref_speed"]
    N = 12                                           # 0.40 s: 5 heavy steps a second (10 frames scurried)
    T = N / anim.FPS
    c = 0.47                                         # each foot planted 47 %: a frame of near-flight at the push-off
    Ls = v * c * T                                   # planted foot travel (m) during contact
    y_front, y_back = -Ls / 2 + 0.04, Ls / 2 + 0.04  # the stance window sits a little behind the hip (toe roll)
    lift = 0.075
    swing = [(0.00, y_back, 0.0, -38.0), (0.22, y_back - 0.10, lift * 0.75, -28.0), (0.5, 0.05, lift, -6.0),
             (0.80, y_front + 0.03, lift * 0.45, 10.0), (1.0, y_front, 0.0, 15.0)]

    def swing_at(s_):
        for i in range(1, len(swing)):
            if s_ <= swing[i][0]:
                a_, b_ = swing[i - 1], swing[i]
                u = anim.sine((s_ - a_[0]) / (b_[0] - a_[0]))
                return tuple(a_[k] + (b_[k] - a_[k]) * u for k in (1, 2, 3))
        return swing[-1][1:]

    def foot_at(q):
        """(offset, pitch, planted, swing phase) of a foot at cycle phase q (0..1, planted on 0..c)."""
        q %= 1.0
        if q < c:
            u = q / c
            pitch = 15.0 * max(0.0, 1 - u / 0.22) ** 1.4 - 38.0 * max(0.0, (u - 0.55) / 0.45) ** 1.6
            return (0.0, y_front + (y_back - y_front) * u, 0.0), pitch, True, 0.0
        s_ = (q - c) / (1 - c)
        dy, dz, pitch = swing_at(s_)
        return (0.0, dy, dz), pitch, False, s_

    def heave(q):
        """hips z offset over one step (0 = a foot strikes): lowest as the weight changes feet, highest over the
        planted leg at mid-stance (a pendulum waddle, no flight)."""
        s_ = (q % 0.5) / 0.5
        # (fix 4: 5.2 cm, was 2.6: at 76 px the 2.6 cm bob read as a gliding bell; a heavy drop onto each foot)
        return -0.060 + 0.052 * math.sin(math.pi * s_) ** 1.3

    L = spec.L
    grip = np.array([-0.27, -0.33, L["grip_r"][2] - 0.02])
    dr = np.array([0.88, -0.05, 0.47])
    dr /= np.linalg.norm(dr)
    hold = A.hold(grip, dr, (-0.47, 0.0, 0.88), 0.40)
    sw = L["hip_w"] / 2 + L["stance"]                 # the feet's half spread

    def build(t, dz_l=0.0, dz_r=0.0, dh=0.0):
        q = t % 1.0
        fl, pl, cl, sl = foot_at(q)
        fr, pr, cr, sr = foot_at(q + 0.5)
        ph = 2 * math.pi * q
        # weight on the planted side: the left foot plants at q 0..c (sin > 0 on that half)
        side = math.sin(ph + 0.30)
        # (fix 4) a big roll onto the planted leg (hips 10 deg, the chest gives back 46 %: the lantern rocks 5 deg, it
        # was 3), a forward dip of the hips and a late nod of the chest on every landing, a wider sway
        roll = 10.0 * side
        land = math.cos(2 * ph + 0.5)
        pose = anim.merge(anim.arms_relaxed(), _P(
            hips=(6.0 + 2.5 * land, -9.0 * math.cos(ph), roll), spine=(4.0, 3.0 * math.cos(ph), -roll * 0.22),
            chest=(3.0 + 3.5 * math.cos(2 * ph + 1.3), 3.5 * math.cos(ph), -roll * 0.24),
            neck=(-5.0 - 3.0 * math.cos(2 * ph + 1.6), 0, 0), head=(-4.0, 0, -roll * 0.25)))
        pose["hips_loc"] = (0.060 * side * (sw / 0.16), 0.012, heave(q) + dh)
        ik = dict(hold)
        bounce = 0.034 * math.cos(2 * ph + 1.9)
        h = ik["hand.R"]
        ik["hand.R"] = HT(rel=(h.rel[0], h.rel[1], h.rel[2] + bounce / A.len), pole=h.pole)
        ik["foot.L"] = FT((0.012 + fl[0], fl[1] - 0.01, fl[2] + dz_l), pl, 4.0, 0.0, 0.0)
        ik["foot.R"] = FT((-0.012 + fr[0], fr[1] - 0.01, fr[2] + dz_r), pr, -4.0, 0.0, 0.0)
        pose["ik"] = ik
        return pose, (cl, sl), (cr, sr)

    boots = {"L": GR.sel("boot_L"), "R": GR.sel("boot_R")}
    bell = GR.sel("cloak", "stole", "mantle")     # (not the hidden legs: bent inside the robe they propped the body up)

    def sample(t):
        dz = {"L": 0.0, "R": 0.0}
        dh = 0.0
        for _ in range(5):
            pose, (cl, sl), (cr, sr) = build(t, dz["L"], dz["R"], dh)
            res = anim.resolve(GR.skel, pose)
            lo_bell = float(GR.points(res, bell)[:, 2].min())
            reach = 0.0
            for s_, planted, ph_ in (("L", cl, sl), ("R", cr, sr)):
                lo = float(GR.points(res, boots[s_])[:, 2].min())
                if planted:
                    if lo > 0.001 and dz[s_] < -0.002:   # the leg is out of reach: the body comes down instead
                        reach = max(reach, lo)
                    dz[s_] -= lo                       # the sole exactly on the ground
                else:
                    clear = 0.012 * _smooth01(ph_ / 0.18) * _smooth01((1 - ph_) / 0.18)
                    if lo < clear:
                        dz[s_] += clear - lo           # a swinging boot clears it
            dh -= reach
            if lo_bell - reach < 0.004:                # the hem never cuts the ground: the body rides up instead
                dh += 0.004 - (lo_bell - reach)
        pose, _, _ = build(t, dz["L"], dz["R"], dh)
        scene.log(f"greatwick run t {t:.3f}: heave {heave(t % 1.0):+.3f} dh {dh:+.3f} bell {lo_bell:+.3f} reach {reach:+.3f}")
        return anim.resolve(GR.skel, pose)

    return anim.Clip("run", N, True, sample, meta={"run_ref_speed": v, "stride_m": round(v * T / 2, 3), "cycle_s": round(T, 3)})


def _unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


class _KeySpline:
    """A C1 path through key vectors (non-uniform Catmull-Rom tangents, cubic Hermite segments), so a swing is ONE
    continuous arc whose speed is set by the key times (fix 5: lerping key poses with per-segment eases left the
    velocity broken at every key: the wind-up snapped 1.0-1.3 m in single 33 ms keys and froze between them).
    `tan` overrides a key's tangent: {i: ("zero" | "in" | ("in", k) | ("out", k) | ("scale", k) | vector)}; a key
    listed in `breaks` has a different tangent on each side (an impact: arrives fast, leaves from rest)."""

    def __init__(self, ts, vs, tan=None, breaks=None):
        self.t = np.asarray(ts, float)
        self.v = np.asarray(vs, float)
        n = len(self.t)
        tan = tan or {}
        breaks = breaks or {}
        m = np.zeros_like(self.v)
        for i in range(n):
            if 0 < i < n - 1:
                h0, h1 = self.t[i] - self.t[i - 1], self.t[i + 1] - self.t[i]
                s0, s1 = (self.v[i] - self.v[i - 1]) / h0, (self.v[i + 1] - self.v[i]) / h1
                m[i] = (s0 * h1 + s1 * h0) / (h0 + h1)
        self.m_in, self.m_out = m.copy(), m.copy()
        for i, rule in list(tan.items()) + [(i, r[0]) for i, r in breaks.items()]:
            self.m_in[i] = self.m_out[i] = self._rule(i, rule, m)
        for i, (r_in, r_out) in breaks.items():
            self.m_in[i] = self._rule(i, r_in, m)
            self.m_out[i] = self._rule(i, r_out, m)

    def _rule(self, i, rule, m):
        if isinstance(rule, str):
            rule = (rule, 1.0)
        if not isinstance(rule, tuple):
            return np.asarray(rule, float)
        kind, k = rule
        if kind == "zero":
            return np.zeros_like(self.v[i])
        if kind == "in":                 # one-sided: the incoming chord's slope x k (arrive accelerating)
            return (self.v[i] - self.v[i - 1]) / (self.t[i] - self.t[i - 1]) * k
        if kind == "out":
            return (self.v[i + 1] - self.v[i]) / (self.t[i + 1] - self.t[i]) * k
        return m[i] * k                  # "scale"

    def __call__(self, t):
        t = min(max(t, self.t[0]), self.t[-1])
        i = int(np.clip(np.searchsorted(self.t, t, side="right") - 1, 0, len(self.t) - 2))
        h = self.t[i + 1] - self.t[i]
        s = (t - self.t[i]) / h
        h00, h10 = 2 * s ** 3 - 3 * s ** 2 + 1, s ** 3 - 2 * s ** 2 + s
        h01, h11 = -2 * s ** 3 + 3 * s ** 2, s ** 3 - s ** 2
        return h00 * self.v[i] + h10 * h * self.m_out[i] + h01 * self.v[i + 1] + h11 * h * self.m_in[i + 1]


_BODY_BONES = ("hips", "spine", "chest", "neck", "head")


def _swing_key(grip, d, up, along, torso, hips=(0.0, 0.0, 0.0), foot_l=(0.0, 0.0, 0.0), foot_r=(0.0, 0.0, 0.0),
               pole=(-0.8, 0.3, -0.5), lpole=(0.8, 0.3, -0.5)):
    """One swing key as a flat vector: grip (world, rest frame), haft dir, head 'up' (striking-face axis), the left
    fist's place along the haft, the elbow poles, hips offset, the five torso bones' eulers, the feet's offsets."""
    tor = [torso.get(b, (0.0, 0.0, 0.0)) for b in _BODY_BONES]
    return np.concatenate([grip, _unit(d), _unit(up), [along], pole, lpole, hips, np.ravel(tor), foot_l, foot_r])


def _swing_pose(v, A, lift_l=0.0):
    grip, d, up, along = v[0:3], v[3:6], v[6:9], float(v[9])
    pole, lpole, hips = tuple(v[10:13]), tuple(v[13:16]), tuple(v[16:19])
    tor = {b: tuple(v[19 + 3 * i:22 + 3 * i]) for i, b in enumerate(_BODY_BONES)}
    fl, fr = v[34:37], v[37:40]
    ik = A.hold(grip, _unit(d), _unit(up), along, pole=pole, lpole=lpole)
    ik["foot.L"] = FT((0.012 + fl[0], fl[1], fl[2] + lift_l), 0.0, 6.0, 0.0, 0.0)
    ik["foot.R"] = FT((-0.012 + fr[0], fr[1], fr[2]), 0.0, -6.0, 0.0, 0.0)
    return _pose(_P(**tor), hips, ik)


def _transport(u, a, b):
    """u carried by the minimal rotation that takes direction a onto b (the head's roll follows the haft, no twist)."""
    a, b, u = _unit(a), _unit(b), np.asarray(u, float)
    v = np.cross(a, b)
    s, c = float(np.linalg.norm(v)), float(a @ b)
    if s < 1e-8:
        return u
    k = v / s
    ang = math.atan2(s, c)
    return u * math.cos(ang) + np.cross(k, u) * math.sin(ang) + k * (k @ u) * (1 - math.cos(ang))


def _roll_ups(ts, ds, anchors):
    """The head's 'up' (striking-face axis) per key: parallel-transported along the haft keys (no wrist twist), plus a
    roll about the haft that reaches each anchor's wanted up exactly and is spread over the keys between anchors in
    proportion to time (the hands turn the haft gradually, never a 180 degree wrist flip in one key)."""
    n = len(ds)
    tr = [None] * n
    tr[0] = np.asarray(anchors[0], float)
    tr[0] = _unit(tr[0] - ds[0] * (tr[0] @ ds[0]))
    for i in range(1, n):
        u = _transport(tr[i - 1], ds[i - 1], ds[i])
        tr[i] = _unit(u - ds[i] * (u @ ds[i]))

    def ang(u, w, d):
        w = _unit(np.asarray(w, float) - d * (np.asarray(w, float) @ d))
        return math.atan2(np.cross(u, w) @ d, u @ w)
    idx = sorted(anchors)
    roll = {}
    prev = 0.0
    for i in idx:
        r = ang(tr[i], anchors[i], ds[i])
        r += 2 * math.pi * round((prev - r) / (2 * math.pi))     # the branch nearest the last anchor's roll
        roll[i] = prev = r
    out = []
    for i in range(n):
        j0 = max(j for j in idx if j <= i)
        j1 = min((j for j in idx if j >= i), default=j0)
        r = roll[j0] if j1 == j0 else roll[j0] + (roll[j1] - roll[j0]) * (ts[i] - ts[j0]) / (ts[j1] - ts[j0])
        d = ds[i]
        u = tr[i]
        out.append(u * math.cos(r) + np.cross(d, u) * math.sin(r) + d * (d @ u) * (1 - math.cos(r)))
    return out


def _attack_clip(spec, A, G, feet0, GR):
    """Fix 5: ONE continuous overhead swing on a C1 key spline (`_KeySpline`), slow up, fast down, so the heavy unit
    reads heavy. 1.0 s, impact 0.40 (= the 0.40 s windup):
      0.00-0.06  gather: the knees give, the hands come forward, the head dips a little (the anticipation)
      0.06-0.28  the HOIST: the head rises up the front of the chest (clear of the robe) and over to behind the right
                 shoulder (outboard of the back-lantern) in one arc, the hands turning the haft as they lift
      0.28-0.31  the hang: the torso arches back, the head still drifting back (slow, never frozen)
      0.31-0.40  the SLAM over the top to the impact (the head's highest forward point, where the lob leaves),
                 accelerating, 2-3x the hoist's speed; the left foot steps in under it (a lift, not a slide)
      0.40-0.56  the head stops, tips over and falls to the ground in front (gravity: ease in), lands at 0.56
      0.56-1.00  the body absorbs it, the hammer is hauled back to the carry (one slow arc)
    The brief's 'low behind the right hip' start does not fit a 0.40 s windup with a hoist slower than the slam (the
    head would travel ~4 m): the gather dips the head at the hip instead and the hoist is the full overhead arc."""
    L = spec.L
    z0 = L["grip_r"][2]
    g0 = np.asarray(L["grip_r"], float)
    d0 = _unit(L["haft"])
    al0 = L["grip_l_along"]
    tg = {"hips": (2, 0, 0), "spine": (2, 0, 0), "chest": (1, 0, 0), "neck": (-2, 0, 0), "head": (-2, 0, 0)}
    PO, LP = (-0.8, 0.3, -0.5), (0.8, 0.3, -0.5)
    # (t, grip, haft dir, left fist along, torso, hips, left foot, right foot, pole, left pole)
    K = [
        (0.00, g0, d0, al0, tg, (0, 0.0, -0.012), (0, 0, 0), (0, 0, 0), PO, LP),
        # gather: sink and lean in, the fists come forward and a little down, the head dips ~8 cm
        (0.05, g0 + (0.02, -0.06, -0.02), (0.985, -0.10, 0.15), al0 - 0.05,
         {"hips": (7, -5, 0), "spine": (5, -3, 0), "chest": (4, -3, 0), "neck": (-4, 2, 0), "head": (-4, 2, 0)},
         (0, 0.0, -0.042), (0, -0.02, 0), (0, 0, 0), PO, LP),
        # hoist, low: the haft swings up in front of the chest, the head by the left shoulder
        (0.13, (-0.15, -0.46, z0 + 0.16), (0.62, -0.15, 0.77), 0.30,
         {"hips": (2, -8, 0), "spine": (0, -6, 0), "chest": (-2, -8, 0), "neck": (0, 6, 0), "head": (0, 6, 0)},
         (0, 0.006, -0.022), (0, -0.04, 0), (0, 0, 0), (-0.9, 0.1, -0.4), (0.8, -0.3, -0.5)),
        # hoist, high: past vertical, the head over the right side of the hood, travelling back
        (0.215, (-0.24, -0.36, z0 + 0.30), (-0.10, 0.0, 0.99), 0.19,
         {"hips": (-1, -12, 0), "spine": (-4, -7, 0), "chest": (-6, -10, 0), "neck": (3, 6, 0), "head": (1, 6, 0)},
         (0, 0.014, 0.002), (0, -0.05, 0), (0, 0, 0), (-0.9, 0.3, -0.1), (0.5, -0.6, -0.6)),
        # the top: the head up and behind the right shoulder (outboard of the lantern), the torso arched back
        (0.29, (-0.27, -0.16, z0 + 0.43), (-0.45, 0.12, 0.88), 0.14,
         {"hips": (-3, -14, 0), "spine": (-6, -8, 0), "chest": (-8, -10, 0), "neck": (5, 6, 0), "head": (3, 6, 0)},
         (0, 0.020, 0.012), (0, -0.06, 0), (0, 0, 0), (-0.8, 0.4, 0.1), (0.4, -0.7, -0.6)),
        # the hang: still drifting back (the stretch), never frozen
        (0.32, (-0.27, -0.13, z0 + 0.43), (-0.50, 0.22, 0.84), 0.13,
         {"hips": (-4, -15, 0), "spine": (-7, -8, 0), "chest": (-10, -10, 0), "neck": (6, 6, 0), "head": (4, 6, 0)},
         (0, 0.024, 0.015), (0, -0.07, 0), (0, 0, 0), (-0.8, 0.4, 0.1), (0.4, -0.7, -0.6)),
        # the impact: the head at its highest forward point; the torso pitched forward and turned, the hips dropped
        (0.40, (-0.06, -0.30, z0 + 0.38), (-0.05, -0.68, 0.73), 0.13,
         {"hips": (9, 12, 0), "spine": (7, 5, 0), "chest": (6, 7, 0), "neck": (-8, 0, 0), "head": (-9, -4, 0)},
         (0, -0.08, -0.075), (0, -0.17, 0), (0, 0, 0), PO, (0.7, -0.2, -0.7)),
        # it stopped: the head tips over and starts to fall
        (0.47, (-0.05, -0.33, z0 + 0.36), (0.0, -0.93, 0.36), 0.13,
         {"hips": (10, 13, 0), "spine": (8, 5, 0), "chest": (6, 7, 0), "neck": (-9, 0, 0), "head": (-10, -4, 0)},
         (0, -0.085, -0.078), (0, -0.17, 0), (0, 0, 0), PO, LP),
        # down: the head on the ground in front (the ground solve keeps it ON the ground)
        (0.56, (-0.03, -0.40, z0 + 0.28), (0.04, -0.86, -0.50), 0.14,
         {"hips": (13, 14, 0), "spine": (9, 5, 0), "chest": (5, 7, 0), "neck": (-10, 0, 0), "head": (-10, -4, 0)},
         (0, -0.10, -0.095), (0, -0.17, 0), (0, 0, 0), PO, LP),
        # the body absorbs it (a heavy settle), the head still down
        (0.66, (-0.03, -0.40, z0 + 0.27), (0.04, -0.86, -0.51), 0.14,
         {"hips": (12, 13, 0), "spine": (8, 5, 0), "chest": (5, 6, 0), "neck": (-9, 0, 0), "head": (-9, -4, 0)},
         (0, -0.10, -0.080), (0, -0.17, 0), (0, 0, 0), PO, LP),
        # hauled back: the haft swings back across the front, the left foot steps back
        (0.82, (-0.22, -0.42, z0 + 0.02), (0.72, -0.62, 0.10), 0.30,
         {"hips": (6, 5, 0), "spine": (4, 2, 0), "chest": (3, 2, 0), "neck": (-4, 0, 0), "head": (-4, -2, 0)},
         (0, -0.04, -0.035), (0, -0.06, 0), (0, 0, 0), PO, LP),
        (1.00, g0, d0, al0, tg, (0, 0.0, -0.012), (0, 0, 0), (0, 0, 0), PO, LP),
    ]
    ts = [k[0] for k in K]
    ds = [_unit(k[2]) for k in K]
    imp, down, top, hang = 6, 8, 4, 5
    ups = _roll_ups(ts, ds, {0: (0, 0, 1), top: (0.1, -0.92, 0.38), imp: (0.0, -0.73, -0.68),
                             len(K) - 1: (0, 0, 1)})
    vs = [_swing_key(k[1], ds[i], ups[i], k[3], k[4], k[5], k[6], k[7], k[8], k[9]) for i, k in enumerate(K)]
    sp = _KeySpline(ts, vs, tan={0: "zero", hang: ("scale", 0.35), 7: ("in", 0.6), len(K) - 1: "zero"},
                    breaks={imp: (("in", 1.6), "zero"), down: (("in", 1.5), "zero")})
    t_step = (ts[hang], ts[imp])

    def sample(t):
        lift = 0.0
        if t_step[0] < t < t_step[1]:               # the left foot steps in under the slam (a lift, not a slide)
            lift = 0.035 * math.sin(math.pi * (t - t_step[0]) / (t_step[1] - t_step[0]))
        return _swing_pose(sp(t), A, lift)

    fn = anim.drag(sample, 30, {"head": 1.5, "neck": 1.0})
    # the follow-through drops the head ONTO the ground in front, never into it: the hammer's aim is raised just
    # enough on the frames it would dip (the feet stay planted by IK)
    return anim.Clip("attack1", 30, False, GR.grounded(fn, body_solve=False), impact=anim.IMPACT)


LANTERN_PARTS = ("lantern", "spires", "shelf", "drum", "frame_posts")


def _death_clip(spec, A, G, GR):
    """The hammer drops, the wick sits back heavily (knees give, the bell's back hem meets the ground) and
    topples backward as one heavy bell, lantern first, accelerating; the lantern lands, the body rocks on it and
    rests there (propped on the lantern, the hammer on the ground beside it). Every frame is solved onto the
    ground against the skinned mesh (no float, no rebound off the ground). (Fix 5: a sampler, not keyed poses: the
    body first, then the hammer falling under gravity in the loosened right fist and resting ON the ground (it ended
    gripped 19 cm up), the fists blended down to the ground (the left one's release was a 148 deg one-key flick).) The resting angle is FOUND: the tilt
    at which the lantern and the back hem touch the ground together. The legs fold inside the robe on the way
    down (knees bent, boots hanging toward the ground: thighs flexed with the tilt left the boots sticking up
    0.35-0.49 m)."""
    L = spec.L
    tp = L["topple"]
    py_, pz_ = tp["pivot"]
    pel = np.array([0.0, 0.0, L["hip"] + 0.015])

    def tilt(theta, extra=None, hips_d=(0.0, 0.0, 0.0), ik=None):
        th = math.radians(theta)
        rel = pel - np.array([0.0, py_, pz_])
        y = rel[1] * math.cos(th) + rel[2] * math.sin(th)
        z = -rel[1] * math.sin(th) + rel[2] * math.cos(th)
        loc = np.array([0.0, py_ + y, pz_ + z]) - pel + np.asarray(hips_d)
        p = anim.merge(anim.arms_relaxed(), _P(hips=(-theta, 0, 0)), extra or {})
        p["hips_loc"] = tuple(loc)
        p["ik"] = dict(ik or {})
        return p

    flop = {"hand.R": HT(rel=A.rel("R", (-0.42, -0.06, 0.36)), pole=(-0.9, 0.1, -0.2)),
            "aim.R": AimUp(tuple(_unit((0.25, -0.97, -0.10))), 1.0, (-1.0, 0.0, 0.0)),
            "hand.L": HT(rel=A.rel("L", (0.42, 0.0, 0.40)), pole=(0.9, 0.1, -0.2))}
    feet = _feet((0.012, 0.0))
    # legs: on the way over the knees come up a little; lying, the thighs run down the robe (along the body) and
    # the knees bend so the shins and boots hang toward the ground inside the hem
    legs_tip = _P(thigh_L=(18, 0, -5), shin_L=(-40, 0, 0), thigh_R=(14, 0, 7), shin_R=(-36, 0, 0))
    legs_lie = _P(thigh_L=(2, 0, -6), shin_L=(-62, 0, 0), thigh_R=(-3, 0, 8), shin_R=(-56, 0, 0))

    def lie_angle():
        """The tilt where the lantern's lowest point and the rest of the body's (hem / mantle) meet the ground
        together, by bisection on the rest-pose mesh."""
        lant = GR.sel(*LANTERN_PARTS)
        rest_ = ~GR.sel(*LANTERN_PARTS, *HAMMER_PARTS, "sleeve", "mitt", "boot", "legs")

        def f(th):
            pose = anim.resolve(GR.skel, tilt(th, anim.merge(legs_lie, _P(neck=(12, 0, 0), head=(12, -8, 0))), ik=flop))
            return float(GR.points(pose, lant)[:, 2].min()) - float(GR.points(pose, rest_)[:, 2].min())
        lo, hi = 40.0, 100.0
        if f(lo) * f(hi) > 0:
            return 70.0
        for _ in range(14):
            mid = (lo + hi) / 2
            if f(lo) * f(mid) <= 0:
                hi = mid
            else:
                lo = mid
        return (lo + hi) / 2

    lie = lie_angle()
    scene.log(f"greatwick death: resting tilt {lie:.1f} deg (lantern and back hem both down)")
    skel = GR.skel
    feet_ik = dict(feet)
    recoil = _pose(_P(hips=(-5, 6, 0), spine=(-6, 0, 0), chest=(-8, 4, 0), neck=(-6, 0, 0), head=(-10, 6, 0)),
                   (0.0, 0.03, -0.01), dict(feet_ik))
    # the sit: knees give (feet still planted), the body drops 5-9 cm and leans back onto its back hem
    sink = -0.08 if spec.faction == "aubade" else -0.11
    sit = tilt(16.0, _P(spine=(-5, 0, 0), neck=(7, 0, 0), head=(9, 0, 0)), (0, 0.0, sink), dict(feet_ik))
    tip = tilt(lie * 0.55, anim.merge(legs_tip, _P(spine=(-2, 0, 0), neck=(10, 0, 0), head=(12, 4, 0))), (0, 0, 0))
    # (fix 5) the lantern lands AT the resting tilt (an over-tilt to lie + 2.5 pivoted the body on the lantern and
    # lifted it 2.5 cm for a frame: a hop), then one small rock back onto the hem and down again
    land = tilt(lie, anim.merge(legs_lie, _P(neck=(16, 0, 0), head=(18, 6, 0))), (0, 0, 0.0))
    bounce = tilt(lie - 2.0, anim.merge(legs_lie, _P(neck=(10, 0, 0), head=(10, -4, 0))), (0, 0, 0.0))
    rest = tilt(lie, anim.merge(legs_lie, _P(neck=(12, 0, 0), head=(12, -8, 0))), (0, 0, 0.0))
    G_body = dict(G)
    G_body["ik"] = dict(feet0_of(G))
    keys = [(0.0, G_body, "linear"), (0.06, recoil, "out"), (0.17, sit, "in"), (0.30, tip, "in"),
            (0.40, land, "in"), (0.47, bounce, "out"), (0.56, rest, "inout"), (1.0, rest, "linear")]
    body_fn = anim.drag(anim.keyed(keys), 60, {"head": 2.0, "neck": 1.0})
    body_m = ~GR.sel(*HAMMER_PARTS, "sleeve", "mitt")
    ham_m = GR.sel(*HAMMER_PARTS)
    T_LAND = 0.12                                  # the hammer's head lands at 0.24 s (a 0.3 m fall under gravity)
    REL_R = 0.10, 0.58                             # the right fist goes from the carry to the ground over this span
    REL_L = 0.015, 0.11                            # the left fist lets go of the haft (no flick: the arm is blended)

    def body(t):
        """the body pose at t, solved onto the ground (its lowest point, arms and hammer excluded, at z = 0)"""
        p = anim.resolve(skel, body_fn(t))
        lo = float(GR.points(p, body_m)[:, 2].min())
        hx, hy, hz = p.get("hips_loc", (0.0, 0.0, 0.0))
        p["hips_loc"] = (hx, hy, hz - lo)
        return p

    def frame_of(p, side):
        M = skel.fk(p)
        up = f"upper_arm.{side}"
        sh = np.array((M[skel.parent[up]] @ skel.local[up]).translation)
        Rc = np.array((M["chest"].to_3x3() @ skel.rest["chest"].to_3x3().inverted()))
        L_ = skel.length[up] + skel.length[f"forearm.{side}"]
        return sh, Rc, L_

    hR = G["ik"]["hand.R"]
    hL_rel = A.rel("L", rest_arm(L, "L")[2])
    # the resting places of the fists: on the ground beside the body, within reach of the resting shoulders
    p_rest = body(1.0)

    def ground_pt(side, sx, z):
        """z: the wrist's height when the fist rests on the ground (the fat sleeve cuff, the fist round the haft)"""
        sh, Rc, L_ = frame_of(p_rest, side)
        v = np.array([sx * 0.55, -0.35, 0.0])
        v = v / np.linalg.norm(v)
        dz = sh[2] - z
        horiz = math.sqrt(max(0.0, (0.92 * L_) ** 2 - dz * dz))
        return np.array([sh[0] + v[0] * horiz, sh[1] + v[1] * horiz, z])
    gR, gL = ground_pt("R", -1.0, 0.115), ground_pt("L", 1.0, 0.09)
    d_carry = _unit(L["haft"])

    def heading(t):
        """the haft's heading on the ground plane: from the carry's (across the body, to the left) round to
        forward-left, where it ends lying beside the body"""
        u = _smooth01(t / 0.60)
        h0 = _unit((d_carry[0], d_carry[1], 0.0))
        h1 = _unit((0.55, -0.80, 0.0))
        return _unit(h0 * (1 - u) + h1 * u)

    def arm_targets(p, t):
        sh, Rc, L_ = frame_of(p, "R")
        pr = sh + Rc @ (np.asarray(hR.rel) * L_)
        w = _smooth01((t - REL_R[0]) / (REL_R[1] - REL_R[0]))
        return pr * (1 - w) + gR * w

    def with_hammer(p, t, pitch, roll_w):
        """resolve the arms with the hammer pitched `pitch` rad below the heading (its head rolls onto its side by
        roll_w); returns the resolved pose and the hammer's lowest point"""
        h = heading(t)
        d = _unit(h * math.cos(pitch) + np.array([0.0, 0.0, -math.sin(pitch)]))
        side_up = _unit(np.cross(d, (0.0, 0.0, 1.0)))
        up = _unit(np.array([0.0, 0.0, 1.0]) * (1 - roll_w) + side_up * roll_w)
        raw = dict(p)
        raw["ik"] = {"hand.R": HT(pos=tuple(arm_targets(p, t)), pole=(-0.9, 0.3, -0.3)),
                     "aim.R": AimUp(tuple(d), 1.0, tuple(up))}
        q = anim.resolve(skel, raw)
        return q, float(GR.points(q, ham_m)[:, 2].min())

    # the pitch the carry starts from (the carry's haft rises 8 deg) and where the head meets the ground at T_LAND
    pitch0 = -math.asin(max(-1.0, min(1.0, d_carry[2])))

    def contact_pitch(p, t, roll_w):
        """the pitch at which the hammer's head (not its pommel end) rests on the ground"""
        lo_u, hi_u = -0.3, 1.4
        if with_hammer(p, t, lo_u, roll_w)[1] <= 0.0:   # the pommel end touches first: start where it clears most
            us = np.linspace(-0.3, 1.4, 18)
            los = [with_hammer(p, t, u, roll_w)[1] for u in us]
            k = int(np.argmax(los))
            if los[k] <= 0.0:
                return float(us[k])
            lo_u = float(us[k])
        for _ in range(12):
            mid = (lo_u + hi_u) / 2
            if with_hammer(p, t, mid, roll_w)[1] > 0.0:
                lo_u = mid
            else:
                hi_u = mid
        return lo_u
    pitch_land = contact_pitch(body(T_LAND), T_LAND, 1.0)
    q0 = with_hammer(body(0.0), 0.0, pitch0, 0.0)[0]
    q0["ik"] = {"hand.L": HT(to_prop=("prop.R", L["grip_l_along"]), pole=(0.8, 0.3, -0.5))}
    hL0 = anim.resolve(skel, q0).get("hand.L", (0.0, 0.0, 0.0))

    def sample(t):
        p = body(t)
        roll_w = _smooth01(t / T_LAND)
        if t < T_LAND:                               # the head falls: gravity (accelerating), lands at T_LAND
            g = (t / T_LAND) ** 2
            q, lo = with_hammer(p, t, pitch0 + (pitch_land - pitch0) * g, roll_w)
            if lo < 0.0:
                q, lo = with_hammer(p, t, contact_pitch(p, t, roll_w), roll_w)
        else:                                        # on the ground: it lies there (pitched to touch, never in it)
            q, lo = with_hammer(p, t, contact_pitch(p, t, 1.0), 1.0)
        # the left fist: on the haft at first (to_prop), then released: the arm's bones blend from the grip
        # solution to a loose reach for the ground beside the body (quaternion slerp: no flick)
        wl = _smooth01((t - REL_L[0]) / (REL_L[1] - REL_L[0]))
        sh, Rc, L_ = frame_of(q, "L")
        pl = sh + Rc @ (np.asarray(hL_rel) * L_)
        wg = _smooth01((t - 0.20) / 0.40)
        rb = dict(q)
        rb["ik"] = {"hand.L": HT(pos=tuple(pl * (1 - wg) + gL * wg), pole=(0.9, 0.2, -0.3))}
        qb = anim.resolve(skel, rb)
        qb["hand.L"] = hL0                         # the loose fist keeps its grip shape (no wrist flick)
        if wl < 1.0:
            ra = dict(q)
            ra["ik"] = {"hand.L": HT(to_prop=("prop.R", L["grip_l_along"]), pole=(0.8, 0.3, -0.5))}
            qa = anim.resolve(skel, ra)
            for b in ("upper_arm.L", "forearm.L", "hand.L"):
                qb[b] = _slerp_euler(qa.get(b, (0.0, 0.0, 0.0)), qb.get(b, (0.0, 0.0, 0.0)), wl)
        return qb

    return anim.Clip("death", 60, False, sample)


def feet0_of(pose):
    return {k: v for k, v in (pose.get("ik") or {}).items() if k.startswith("foot.")}


def _slerp_euler(a, b, w):
    from mathutils import Euler
    qa = Euler([math.radians(x) for x in a], "XYZ").to_quaternion()
    qb = Euler([math.radians(x) for x in b], "XYZ").to_quaternion()
    e = qa.slerp(qb, w).to_euler("XYZ", Euler([math.radians(x) for x in a], "XYZ"))
    return tuple(math.degrees(x) for x in e)


KINDS = [Greatwick]

if __name__ == "__main__":
    wc.run(KINDS)
