"""shieldwick: the melee Wick (1.1 m). Round shield on the left arm, a short lamp-mace in the right.

    Blender -b --factory-startup --python-exit-code 1 --python art/blender/units/wick_shieldwick.py -- [--faction aubade|serenade|both|legacy] [--fast] [--clip-sheet]
    Blender -b --factory-startup --python art/blender/proto/wick_shieldwick_fit.py -- [--faction aubade]   # silhouette fit check

Builds shieldwick_aubade + shieldwick_serenade (default: both) into art/out/units/; `--faction legacy` rebuilds
today's shieldwick.glb (frozen: legacy_props below and the legacy body in wick_common are untouched).
Brief: _design/units/wicks.md (§0 hard rules, §3.1 shieldwick, §4 accent, §5.2 projection). Concepts:
_design/concept/wicks/shieldwick_{aubade,serenade}.webp. Progress log: art/renders/units/_wick_shieldwick_progress.md.

ART 2.0 (HANDOFF.md): numpy SDF volumes fitted to each concept on a 5/10 cm grid (the fit overlay:
proto/wick_shieldwick_fit.py), the concept painting projected occlusion-aware onto the game mesh, normals + AO
baked from the sculpt. Coordinates: Blender, Z up, the model faces -Y, the wick's RIGHT hand (the mace) at -X.

  Aubade (west, dawn)    rounded linen cowl with a flat front carved with a rounded-arch opening (wide chin, broad
                         round top) in a broad carved chalk frame (4.2-5.6 cm, painted running scroll with carved volutes),
                         the linen rolling in under the frame's inner edge into one clean inked throat, a round chalk knob
                         (crown 1.00 m, knob top ~1.07 m) standing ON one broad accent seam that starts under the frame's
                         brow, passes under the knob's base disc and runs down to the nape, and a broad accent band round
                         the cowl's lower edge at the back (the side / back team read); the hood light (below);
                         straight-fold slate-blue cloak darkening to the hem (value ramp + dark hem band, stitched), pointed
                         hem, chalk stole (two strips with clean points); chalk disc shield carried in front of the left
                         chest (a vertical rib with a 6 cm spire over the rim, held upright by the AimUp roll, a dawnglass
                         ring round a 12.8 cm accent boss); blue-grey mitten fist gripping the haft; a tall four-sided chalk
                         lantern-mace, two tall lit panes per face (accent block behind a chalk mullion) in dawnglass,
                         pointed cap.
  Serenade (east, dusk)  low broad sand-felt dome (crown 1.08 m; its game mesh sampled on the sculpt, the door's hole
                         conformed under the rim) on a 14 cm rolled collar of dark felt, a tall round-topped door (0.236 m
                         wide, top 0.972 m, sill 0.75 m: about 1.07 : 1) framed by a hand-built rolled dark-felt rim curling
                         into one clean inked throat, a broad accent crown band circling the dome at 1.03 m; the hood light
                         (below); a sand felt mantle draped over the shoulders (curved hem sagging at the back, rounded
                         corners over the arms, two lapel flaps with a V in front); wide umber bell cloak with two
                         ironstone hem bands, darkening to the hem; domed ironstone shield laid in stone plates with a
                         riveted rim, four big sandstone pads lying on the dome, lampresin ring + accent boss; a felt mitten
                         fist gripping the haft; a squat round caged lantern - an ACCENT globe on a small lampresin foot,
                         four ironstone cage bars, a domed ironstone lid with a round knob - on a walnut haft (all turned /
                         swept game meshes).
Shared (the job silhouette): the same rig, clips and layout: the disc carried on the left arm in front of the
chest, face turned ~45 degrees out, the lantern-mace raised on the right, the hood ~1/3 of the height, boots
under a bell cloak.

Hard rule §0.1: neither hood is pointed or conical, and the Aubade opening has a broad round top (no peaked
arch in a pale hood). The Aubade concept's small hood flap is dropped (the nape is swept back and down instead);
its only point-like forms are the shield rib's spire and the lantern cap (the knob is round). No face (§0.2): each
hollow is one clean inked throat (matte: ROUGH); the hood light (fix round 3, both cultures) is ONE soft emissive
ellipsoid core, wider than tall (10 x 6.2 cm), centred vertically in the opening and set back 3-4 cm, with dark hollow
above, below and to both sides; its soft falloff is painted on the throat's walls and back round it, from a dim
team-neutral lamplight at the core's outline to ink (hood_light_paint), because the accent stays factor-only (the shared
load test; the renderer tints it per viewer). No flame, no dish, no lit rim, no floor puddle (they read as a tongue, a
pupil, lips; a halo dish behind the core read as a grey ring round an iris). The accent is matte (ACCENT_ROUGH).

Not in wick_common, implemented here (wrapped, not forked):
  * per-faction arm joints (rig_extras): the concepts' fists; prop.R re-aimed up the mace haft, prop.L along the
    shield's face normal, so the clips aim the mace and the shield directly;
  * bespoke clips idle / run / attack1 / death (brief §3.1 motion) on a minion-sized leg (short swing, quick
    cadence, planted feet at the content moveSpeed); feet go through Shieldwick._ft (a physical toe / heel roll:
    anim._solve_foot's pitch turns the toes the wrong way on this rig, see there);
  * accent ribbons (seams, crown band, mantle cord) snapped station by station onto their host's GAME mesh
    (MeshPart.snapped, SNAP): built on the sculpt, they sank under the decimated host in its creases;
  * PALETTE FIT: the projected painting is moved part by part onto the faction palette (median -> role colour,
    per channel in linear light, the painted detail kept), which grades the Serenade concept's saturation, lifts
    the top band and darkens the Aubade hem band (brief §2.3-§2.4, §5.2). common.hifi.project.paint_object is
    wrapped at import time; the wrapper only acts on a PROJECTION that carries "palette_fit". Around the fit:
      - tops_full (before): the hood's top plate blended from a low normal threshold (whole crown = painted field;
        the Serenade back plate's erased-band fill had left a pale patch on the dome);
      - hollow_ink (after): rim / hood / scarf faces that turn into the hood opening are inked and the lining is
        pulled onto its ink (they read as pale shards in the hollow);
      - dilate_bake_maps: the in-flight rough / AO bakes are filled between UV islands before bake_asset packs
        them (common.bake leaves roughness 0 there, which the 256 ORM mixed into small islands' borders);
      - clean / side_soften (before the fit): projection ghosts (the concept's arms, cuffs, haft painted over open
        cloth), side-facing streaks and the cloak's arm zones take the part's own paint-by-height field;
      - shield_paint (Serenade): the dome's projected pad paint refilled, the pads painted on their own geometry;
      - ramp (after the fit): value multipliers by height (light top, dark feet: brief §2.4 measured on screen).
      - paint v3 (review 2026-10-27 item 2): form light, sculpt-curvature edges / cavities, material textures (linen,
        wool, felt, chalk, iron, sand, wood, leather, glass), warm-light / cool-shadow temperature, painted running
        stitches, the Serenade shield's stone plates and rivets, the Aubade frame's broad scroll, boot welts; a
        hue-preserving ("tone") palette fit for the Serenade felt; per-part texel weights (UVW); hidden hood faces culled
        (cull_hidden); normal map 512.
  Also wrapped: anim._solve_aim acts on AimUp (a roll about the aim axis) for the shield.
  Review sheets (whole-wick framing; three_<id>.png's close row is the common QA's fighter framing): shieldwick_beauty,
  shieldwick_review (game camera, ally / enemy tints, lane crowd), shieldwick_clips; harness
  art/.cache/shieldwick_review/review.mjs (also hero / close / true1x / feet / metrics / sil); motion numbers:
  proto/wick_shieldwick_motion.py.
"""
from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402

import wick_common as wc  # noqa: E402
from wick_common import sdf  # noqa: E402
from wick_common import Ellipsoid, Lathe, Sculpt, Torus  # noqa: E402
from common import anim, fighter, rig, scene  # noqa: E402
from common.anim import Aim, FootTarget, HandTarget  # noqa: E402
from common.hifi import project  # noqa: E402
from common.hifi.sdf import Blend, Capsule, Prim, RoundBox, RoundCone, Sphere, Tube  # noqa: E402

NOISE = sdf.Noise(29)
VOXEL = 0.0045


# ── extra SDF prims (module-local) ──────────────────────────────────────────────────────────────────
class Bell(Prim):
    """Elliptic loft about a vertical axis: half-width a(z), half-depth b(z), centre y cy(z), piecewise linear
    over zs; the bottom at hem(x, y) (default zs[0]), the top cut at zs[-1]. Approximate distance."""

    def __init__(self, zs, a, b, cy=0.0, cx=0.0, hem=None):
        self.zs = np.asarray(zs, dtype=np.float64)
        self.a = np.asarray(a, dtype=np.float64)
        self.b = np.asarray(b, dtype=np.float64)
        self.cy = np.broadcast_to(np.asarray(cy, dtype=np.float64), self.zs.shape).copy()
        self.cx = float(cx)
        self.hem = hem

    def bounds(self):
        A, B = self.a.max(), self.b.max()
        return (np.array([self.cx - A, self.cy.min() - B, self.zs[0] - 0.06]),
                np.array([self.cx + A, self.cy.max() + B, self.zs[-1]]))

    def d(self, P):
        z = P[:, 2]
        a = np.interp(z, self.zs, self.a)
        b = np.interp(z, self.zs, self.b)
        cy = np.interp(z, self.zs, self.cy)
        x, y = P[:, 0] - self.cx, P[:, 1] - cy
        q = np.sqrt((x / a) ** 2 + (y / b) ** 2)
        dr = (q - 1.0) * np.minimum(a, b)
        bot = self.hem(x, P[:, 1]) if self.hem is not None else self.zs[0]
        return np.maximum(np.maximum(dr, bot - z), z - self.zs[-1])


class Shell(Prim):
    """The skin between `inn` inside and `out` outside another prim's surface (bands, stoles, linings)."""

    def __init__(self, base: Prim, out: float, inn: float = 0.0):
        self.base, self.out, self.inn = base, float(out), float(inn)

    def bounds(self):
        lo, hi = self.base.bounds()
        return lo - self.out, hi + self.out

    def d(self, P):
        d = self.base.d(P)
        return np.maximum(d - self.out, -d - self.inn)


class Inter(Prim):
    """Hard intersection of prims; bounds of the first (or given)."""

    def __init__(self, *prims, bounds=None):
        self.prims = prims
        self._b = bounds

    def bounds(self):
        return self._b if self._b is not None else self.prims[0].bounds()

    def d(self, P):
        out = self.prims[0].d(P)
        for p in self.prims[1:]:
            out = np.maximum(out, p.d(P))
        return out


class Fn(Prim):
    """A distance-like field from a function of P (cuts: bands by height, strips), with explicit bounds."""

    def __init__(self, fn, lo, hi):
        self.fn, self.lo, self.hi = fn, np.asarray(lo, dtype=np.float64), np.asarray(hi, dtype=np.float64)

    def bounds(self):
        return self.lo, self.hi

    def d(self, P):
        return self.fn(P)


def tri_wave(phi, n):
    """0 at n evenly spaced tips round the hem (the first one at the front, phi = -90 deg), 1 between them."""
    u = (phi + math.pi / 2) * n / (2 * math.pi)
    return np.abs((u % 1.0) - 0.5) * 2.0


def folds(amp, freq, phase=0.0, zfade=None, sharp=1.0):
    """Vertical cloth folds round the Z axis (radial ridges by azimuth), warped by noise."""
    def fn(P):
        ang = np.arctan2(P[:, 1], P[:, 0])
        s = np.abs(np.sin(ang * freq + phase + 0.5 * NOISE(P, 3.0)))
        a = amp
        if zfade is not None:
            z0, z1 = zfade
            a = amp * np.clip((z0 - P[:, 2]) / (z0 - z1), 0.2, 1.0)
        return a * (s ** sharp * 2.0 - 1.0) * -0.5
    return fn


def felt(amp, freq=11.0):
    """Soft felt lumps (Serenade felt and the rolled collar)."""
    return lambda P: amp * NOISE.fbm(P, freq, 2)


def surface_point(prim: Prim, origin, direction, t0=0.0, t1=0.6, iters=40) -> np.ndarray:
    """The first zero of prim.d along origin + t * direction (bisection from inside to outside)."""
    o = np.asarray(origin, dtype=np.float64)
    dr = np.asarray(direction, dtype=np.float64)
    dr = dr / np.linalg.norm(dr)
    lo, hi = t0, t1
    for _ in range(iters):
        mid = 0.5 * (lo + hi)
        if prim.d((o + dr * mid)[None, :])[0] < 0:
            lo = mid
        else:
            hi = mid
    return o + dr * 0.5 * (lo + hi)


def ring_axes(normal, sx=1.0, sy=1.0):
    """Torus frame with local Z = `normal`, X near world X; the ring's radius scaled by sx (X) and sy (Y)."""
    F = sdf.frame(normal, (1.0, 0.0, 0.0))
    return np.diag([1.0 / sx, 1.0 / sy, 1.0]) @ F


def unit(v):
    v = np.asarray(v, dtype=np.float64)
    return v / np.linalg.norm(v)


def sstep(e0, e1, x):
    """Smoothstep from e0 (0) to e1 (1); e0 > e1 runs backwards."""
    t = np.clip((np.asarray(x, dtype=np.float64) - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def sdf_normals(prim: Prim, P, e: float = 0.0015) -> np.ndarray:
    """Unit gradients of prim.d at the points P (M, 3) by central differences."""
    P = np.atleast_2d(np.asarray(P, dtype=np.float64))
    g = np.zeros_like(P)
    for a in range(3):
        o = np.zeros(3)
        o[a] = e
        g[:, a] = prim.d(P + o) - prim.d(P - o)
    return g / (np.linalg.norm(g, axis=1, keepdims=True) + 1e-12)


def front_hit(prim: Prim, x: float, z: float, y0: float = -0.45, y1: float = 0.25, n: int = 351) -> np.ndarray:
    """The frontmost surface point of `prim` on the line (x, *, z), looking along +Y from y0."""
    ys = np.linspace(y0, y1, n)
    d = prim.d(np.stack([np.full(n, x), ys, np.full(n, z)], axis=1))
    i = int(np.argmax(d < 0))
    if d[i] >= 0:
        raise ValueError(f"front_hit: no surface at x {x:.3f} z {z:.3f}")
    lo, hi = ys[max(0, i - 1)], ys[i]
    for _ in range(30):
        mid = 0.5 * (lo + hi)
        if prim.d(np.array([[x, mid, z]]))[0] < 0:
            hi = mid
        else:
            lo = mid
    return np.array([x, 0.5 * (lo + hi), z])


# ── hand-built meshes: the accent bands, rings, boss and hood lights, the Aubade chalk rim ────────────
# A decimated SDF shows its polygon outline on small round shapes (an octagonal ring, a hexagonal boss, a wavy
# band with 2x thickness changes: review 2026-10-20 items 4 and 8). These are built directly as evenly spaced
# rings and ribbons instead: constant width, clean circles, smooth normals, tris spent only where they show.
class MeshPart:
    """A triangle mesh (V (n, 3), T (m, 3)) standing in for a Sculpt in a part list (.mesh() mirrors Sculpt.mesh)."""

    def __init__(self, V, T, groups=None):
        self.V = np.asarray(V, dtype=np.float64)
        self.T = np.asarray(T, dtype=np.int64)
        # ribbons: [{"ix": vertex index (M, P), "C": centre line (M, 3), "N": surface normals (M, 3), "closed": bool}]
        self.groups = list(groups or [])

    def mesh(self, voxel=None):
        return self.V.astype(np.float32), self.T.astype(np.int32)

    def __add__(self, o: "MeshPart") -> "MeshPart":
        n = len(self.V)
        return MeshPart(np.concatenate([self.V, o.V]), np.concatenate([self.T, o.T + n]),
                        self.groups + [dict(g, ix=g["ix"] + n) for g in o.groups])

    def snapped(self, host_obj, limit: float = 0.02, smooth: int = 2, bias: float = 0.0025) -> "MeshPart":
        """The ribbons moved onto the host's GAME mesh (they are built on the sculpt; the decimated host lies outside
        it in the creases and buried the bands there): each station's offset to the nearest point of the host low,
        SMOOTHED along the band (+-`smooth` stations: a per-station snap followed every facet and left the bands
        ragged and stepped, review 2026-10-27 item 9) and lifted `bias` m along the surface normal."""
        from mathutils import Vector
        from mathutils.bvhtree import BVHTree
        me = host_obj.data
        mw = host_obj.matrix_world
        bvh = BVHTree.FromPolygons([tuple(mw @ v.co) for v in me.vertices], [tuple(p.vertices) for p in me.polygons])
        V = self.V.copy()
        for g in self.groups:
            C = g["C"]
            M = len(C)
            D = np.zeros((M, 3))
            ok = np.zeros(M, dtype=bool)
            for i, c in enumerate(C):
                hit = bvh.find_nearest(Vector(tuple(c)), limit)
                if hit[0] is not None:
                    D[i] = np.asarray(hit[0]) - c
                    ok[i] = True
            if smooth and ok.any():
                S = np.zeros_like(D)
                W = np.zeros(M)
                for k in range(-smooth, smooth + 1):
                    j = np.arange(M) + k
                    j = j % M if g.get("closed") else np.clip(j, 0, M - 1)
                    w = (1.0 - abs(k) / (smooth + 1)) * ok[j]
                    S += D[j] * w[:, None]
                    W += w
                D = S / np.maximum(W, 1e-9)[:, None]
            if bias and g.get("N") is not None:
                D = D + np.asarray(g["N"]) * bias
            V[g["ix"]] += D[:, None, :]
        return MeshPart(V, self.T, self.groups)


def grid_tris(rows: int, cols: int, closed: bool = False) -> np.ndarray:
    """Triangles of a rows x cols vertex grid (index i * cols + j); quad (i,j) (i+1,j) (i+1,j+1) (i,j+1), whose
    normal is d(row) x d(col); `closed` wraps the rows."""
    T = []
    for i in range(rows if closed else rows - 1):
        i2 = (i + 1) % rows
        for j in range(cols - 1):
            a, b, c, d = i * cols + j, i2 * cols + j, i2 * cols + j + 1, i * cols + j + 1
            T += [(a, b, c), (a, c, d)]
    return np.asarray(T, dtype=np.int64)


def ribbon(C, Nr, hw, profile, closed: bool = False, ends=(True, True)) -> MeshPart:
    """A band along the curve C (M, 3) lying on a surface with normals Nr: cross-section `profile` [(s, h)], s in
    half-widths across the band (-1 .. 1), h metres along the normal; hw (M,) or scalar half-width. The top faces +Nr.
    Open ends taper (the band sinks into the surface there) unless `ends` says otherwise (a band butting against a
    raised frame keeps its full section)."""
    C = np.asarray(C, dtype=np.float64)
    Nr = np.asarray(Nr, dtype=np.float64)
    M = len(C)
    if closed:
        T = np.roll(C, -1, axis=0) - np.roll(C, 1, axis=0)
    else:
        T = np.gradient(C, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    B = np.cross(Nr, T)
    B /= np.linalg.norm(B, axis=1, keepdims=True)
    hw = np.broadcast_to(np.asarray(hw, dtype=np.float64), (M,))
    hs = np.ones(M)
    if not closed:
        for e, (i0, i1) in zip(ends, ((0, 1), (-1, -2))):
            if e:
                hs[i0], hs[i1] = 0.25, 0.7
    V = np.array([[C[i] + B[i] * s * hw[i] * (0.5 + 0.5 * hs[i]) + Nr[i] * h * hs[i] for s, h in profile] for i in range(M)])
    return MeshPart(V.reshape(-1, 3), grid_tris(M, len(profile), closed),
                    [{"ix": np.arange(M * len(profile)).reshape(M, len(profile)), "C": C.copy(), "N": Nr.copy(),
                      "closed": closed}])


FLAT_BAND = [(-1.0, -0.003), (-0.72, 0.0055), (0.72, 0.0055), (1.0, -0.003)]     # a flat-topped band, bevelled edges
# a low inlaid band (fix round 3): 3 mm proud along the middle, its bevelled edges sinking 7.5 mm, so with the snap lift
# the edges always tuck into the host (a flat band with edges at the surface floated off convex cloth like tape)
SEAM_BAND = [(-1.0, -0.0075), (-0.80, 0.0030), (0.80, 0.0030), (1.0, -0.0075)]


def tube(C, r, sides: int = 6, closed: bool = False, ref=None, arc=None, taper: bool = True) -> MeshPart:
    """A tube (round section) along the polyline C (M, 3), radius r (scalar or (M,)). `ref` (M, 3): the direction of
    angle 0 at each station (default: parallel transport); `arc` (a0, a1) degrees round ref: an open part-tube (the
    rest buried in the host). Open ends taper to 35 % (they tuck into the host)."""
    C = np.asarray(C, dtype=np.float64)
    M = len(C)
    T = (np.roll(C, -1, axis=0) - np.roll(C, 1, axis=0)) if closed else np.gradient(C, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    R0 = np.zeros((M, 3))
    if ref is None:
        a = np.cross(T[0], (0.0, 0.0, 1.0) if abs(T[0][2]) < 0.9 else (1.0, 0.0, 0.0))
        R0[0] = a / np.linalg.norm(a)
        for i in range(1, M):
            v = R0[i - 1] - T[i] * (R0[i - 1] @ T[i])
            R0[i] = v / np.linalg.norm(v)
    else:
        ref = np.broadcast_to(np.asarray(ref, dtype=np.float64), (M, 3))
        R0 = ref - T * (ref * T).sum(axis=1, keepdims=True)
        R0 /= np.linalg.norm(R0, axis=1, keepdims=True)
    B = np.cross(T, R0)
    rr = np.broadcast_to(np.asarray(r, dtype=np.float64), (M,)).copy()
    if not closed and taper:
        rr[[0, -1]] *= 0.35
    if arc is None:
        angs = np.arange(sides) * 2 * np.pi / sides
    else:
        angs = np.radians(np.linspace(arc[0], arc[1], sides + 1))
    K = len(angs)
    V = (C[:, None, :] + rr[:, None, None] * (np.cos(angs)[None, :, None] * R0[:, None, :]
                                              + np.sin(angs)[None, :, None] * B[:, None, :]))
    F = []
    rows = M if closed else M - 1
    cols = K if arc is None else K - 1
    for i in range(rows):
        i2 = (i + 1) % M
        for j in range(cols):
            j2 = (j + 1) % K
            a_, b_, c_, d_ = i * K + j, i2 * K + j, i2 * K + j2, i * K + j2
            F += [(a_, c_, b_), (a_, d_, c_)]                       # outward (d(row) x d(col) points inward)
    return MeshPart(V.reshape(-1, 3), np.asarray(F, dtype=np.int64),
                    [{"ix": np.arange(M * K).reshape(M, K), "C": C.copy(), "N": R0.copy(), "closed": closed}])


def box(c, axes, half) -> MeshPart:
    """A box at c with rows of `axes` its local X, Y, Z and half sizes `half` (12 tris, outward)."""
    c = np.asarray(c, dtype=np.float64)
    X, Y, Z = (np.asarray(a, dtype=np.float64) * h for a, h in zip(axes, half))
    V = np.array([c + sx * X + sy * Y + sz * Z for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)])
    # vertex index = 4 * (sx > 0) + 2 * (sy > 0) + (sz > 0)
    quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    T = []
    for a_, b_, c_, d_ in quads:
        T += [(a_, b_, c_), (a_, c_, d_)]
    T = np.asarray(T, dtype=np.int64)
    n0 = np.cross(V[T[0, 1]] - V[T[0, 0]], V[T[0, 2]] - V[T[0, 0]])
    if n0 @ (V[T[0]].mean(axis=0) - c) < 0:
        T = T[:, ::-1]
    return MeshPart(V, T)


def lathe(c, axes, prof, seg: int, scale=(1.0, 1.0)) -> MeshPart:
    """Surface of revolution about axes[2] through c (axes rows = local X, Y, Z, right-handed); prof [(r, z)]
    runs counter-clockwise round the solid's cross-section (outward normals); r = 0 ends are poles. `scale`
    squashes local X / Y (an elliptic section)."""
    c = np.asarray(c, dtype=np.float64)
    X, Y, Z = (np.asarray(a, dtype=np.float64) for a in axes)
    sx, sy = scale
    ring = [(r, z) for r, z in prof if r > 1e-9]
    K = len(ring)
    ph = np.arange(seg) * 2 * math.pi / seg
    V = [c + X * r * math.cos(p) * sx + Y * r * math.sin(p) * sy + Z * z for p in ph for r, z in ring]
    T = list(grid_tris(seg, K, closed=True))
    if prof[0][0] <= 1e-9:
        V.append(c + Z * prof[0][1])
        p0 = len(V) - 1
        T += [(p0, ((j + 1) % seg) * K, j * K) for j in range(seg)]
    if prof[-1][0] <= 1e-9:
        V.append(c + Z * prof[-1][1])
        p1 = len(V) - 1
        T += [(p1, j * K + K - 1, ((j + 1) % seg) * K + K - 1) for j in range(seg)]
    return MeshPart(np.asarray(V), np.asarray(T, dtype=np.int64))


def superellipse(theta, a, bt, bb, nt, nb):
    """(u, v) on the Aubade opening arch: a superellipse of half-width a, half-height bt / exponent nt above v = 0
    and bb / nb below (a rounded arch over a wide, squarer chin)."""
    c, s = np.cos(theta), np.sin(theta)
    n = np.where(s >= 0, nt, nb)
    b = np.where(s >= 0, bt, bb)
    return a * np.sign(c) * np.abs(c) ** (2 / n), b * np.sign(s) * np.abs(s) ** (2 / n)


def arch_q(u, v, a, bt, bb, nt, nb):
    """The superellipse 'radius' (1 on the arch, < 1 inside)."""
    top = v >= 0
    n = np.where(top, nt, nb)
    b = np.where(top, bt, bb)
    return (np.abs(u / a) ** n + np.abs(v / b) ** n) ** (1.0 / n)


def polyline_dist(p, pts, closed: bool = False, chunk: int = 4096) -> np.ndarray:
    """Distance from each point p (N, 3) to the polyline pts (K, 3)."""
    A = np.asarray(pts, dtype=np.float64)
    B = np.roll(A, -1, axis=0) if closed else A[1:]
    A = A if closed else A[:-1]
    AB = B - A
    L2 = np.maximum((AB * AB).sum(axis=1), 1e-12)
    out = np.empty(len(p))
    for s in range(0, len(p), chunk):
        q = p[s:s + chunk, None, :]
        t = np.clip(((q - A[None]) * AB[None]).sum(axis=2) / L2[None], 0, 1)
        d = q - (A[None] + t[..., None] * AB[None])
        out[s:s + chunk] = np.sqrt((d * d).sum(axis=2)).min(axis=1)
    return out


def sd_trapezoid(px, py, r1, r2, he):
    """2D signed distance of an isosceles trapezoid: half-width r1 at py = -he, r2 at py = +he (iq's sdTrapezoid)."""
    px = np.abs(px)
    k2x, k2y = r2 - r1, 2.0 * he
    cax = px - np.minimum(px, np.where(py < 0, r1, r2))
    cay = np.abs(py) - he
    t = np.clip(((r2 - px) * k2x + (he - py) * k2y) / (k2x * k2x + k2y * k2y), 0.0, 1.0)
    cbx = px - r2 + k2x * t
    cby = py - he + k2y * t
    s = np.where((cbx < 0) & (cay < 0), -1.0, 1.0)
    return s * np.sqrt(np.minimum(cax * cax + cay * cay, cbx * cbx + cby * cby))


class PlaneArch:
    """A 2D opening shape on a plane (origin O, right X, up U, out-normal Nn): f(u, v) < 0 inside.
    kind "trap": a rounded trapezoid (wide chin, narrowing round top: the Aubade cowl opening);
    kind "door": vertical sides, a round top (centre v = 0: a semicircle, or a semi-ellipse ht tall), open at the
    bottom (the Serenade dome arch)."""

    def __init__(self, O, Nn, kind, **kw):
        self.O = np.asarray(O, dtype=np.float64)
        self.N = unit(Nn)
        self.X = np.array([1.0, 0.0, 0.0])
        self.U = unit(np.cross(self.N, self.X))
        self.kind, self.kw = kind, kw

    def uvw(self, P):
        Q = np.atleast_2d(P) - self.O
        return Q @ self.X, Q @ self.U, -(Q @ self.N)          # w: depth BEHIND the plane

    def f2(self, u, v, grow=0.0):
        k = self.kw
        if self.kind == "trap":
            return sd_trapezoid(u, v, k["r1"], k["r2"], k["he"]) - k["rr"] - grow
        hw = k["hw"]
        nt = k.get("nt", 2.0)                                       # a semicircle, or a taller semi-superellipse
        circ = ((np.abs(u) / hw) ** nt + (np.abs(v) / k.get("ht", hw)) ** nt) ** (1.0 / nt) * hw - hw
        side = np.maximum(np.abs(u) - hw, np.maximum(v, k["vb"] - v))
        return np.minimum(np.where(v > 0, circ, side), side) - grow

    def field(self, P):
        u, v, _ = self.uvw(P)
        return self.f2(u, v)

    def boundary(self, alphas, grow=0.0, rmax=0.5):
        """Points (u, v) on the shape grown by `grow` (scalar or per alpha) along rays from (0, 0) at angles alphas."""
        alphas = np.asarray(alphas, dtype=np.float64)
        g = np.broadcast_to(np.asarray(grow, dtype=np.float64), alphas.shape)
        lo, hi = np.zeros_like(alphas), np.full_like(alphas, rmax)
        c, s = np.cos(alphas), np.sin(alphas)
        for _ in range(40):
            mid = 0.5 * (lo + hi)
            ins = self.f2(c * mid, s * mid, g) < 0
            lo, hi = np.where(ins, mid, lo), np.where(ins, hi, mid)
        r = 0.5 * (lo + hi)
        return c * r, s * r

    def to3(self, u, v, w=0.0):
        u, v, w = (np.asarray(a, dtype=np.float64) for a in np.broadcast_arrays(u, v, w))
        return self.O + u[..., None] * self.X + v[..., None] * self.U - w[..., None] * self.N


def cavity_grid(field, origin, thetas, phis, fwd, right, up, tmax=0.45, inset=0.003):
    """Sample the wall of a cavity (field < 0 inside) along rays from `origin` (inside it): direction
    = cos(phi) (cos(theta) fwd + sin(theta) right) + sin(phi) up (degrees). Returns the (len(phis), len(thetas), 3)
    wall points, pulled `inset` back toward the origin (a lining just inside the carved surface)."""
    o = np.asarray(origin, dtype=np.float64)
    fwd, right, up = unit(fwd), unit(right), unit(up)
    out = np.zeros((len(phis), len(thetas), 3))
    for i, ph in enumerate(np.radians(phis)):
        for j, th in enumerate(np.radians(thetas)):
            d = unit(math.cos(ph) * (math.cos(th) * fwd + math.sin(th) * right) + math.sin(ph) * up)
            ts = np.linspace(0.0, tmax, 181)
            f = field(o[None] + ts[:, None] * d[None])
            k = int(np.argmax(f > 0))
            if f[k] <= 0:
                raise ValueError(f"cavity_grid: ray {th:.2f}/{ph:.2f} never leaves the cavity")
            lo, hi = ts[max(0, k - 1)], ts[k]
            for _ in range(30):
                mid = 0.5 * (lo + hi)
                if field((o + d * mid)[None])[0] > 0:
                    hi = mid
                else:
                    lo = mid
            out[i, j] = o + d * (0.5 * (lo + hi) - inset)
    return out


def grid_mesh(G, flip=False) -> MeshPart:
    """A (rows, cols, 3) point grid as a triangle mesh (open), optionally flipped."""
    r, c = G.shape[:2]
    T = grid_tris(r, c)
    return MeshPart(G.reshape(-1, 3), T[:, ::-1] if flip else T)


def split_by(mp: MeshPart, keep_face) -> tuple:
    """Split a MeshPart's faces by a boolean per face -> (kept, rest), each with only its own vertices."""
    out = []
    for m in (keep_face, ~keep_face):
        T = mp.T[m]
        used = np.unique(T)
        remap = -np.ones(len(mp.V), dtype=np.int64)
        remap[used] = np.arange(len(used))
        out.append(MeshPart(mp.V[used], remap[T]))
    return tuple(out)


def lathe_low(prim, cy, phis, zs, top=None, cx=0.0, eps=0.0) -> MeshPart:
    """A game mesh lying ON a lathe-like sculpt's surface: for each height z (rows, bottom up) and azimuth phi
    (radians, columns), the point where the horizontal ray from (cx, cy, z) leaves `prim`. zs may be a function of
    phi (array (rows, cols)) to follow a shaped hem. `top`: (centre, [elevation degrees]) closes the top with rings
    sampled along rays from that centre and a pole. Clean round outlines for the cloaks (review item 10: the
    decimated bell hem showed an octagon), the sculpt stays the bake source for its folds."""
    phis = np.asarray(phis, dtype=np.float64)
    Z = np.asarray(zs, dtype=np.float64)
    if Z.ndim == 1:
        Z = np.repeat(Z[:, None], len(phis), axis=1)
    rows = []
    for i in range(Z.shape[0]):
        row = []
        for j, ph in enumerate(phis):
            o = np.array([cx, cy, Z[i, j]])
            row.append(surface_point(prim, o, (math.cos(ph), math.sin(ph), 0.0), 0.0, 0.6))
        rows.append(row)
    if top is not None:
        c, els = top
        c = np.asarray(c, dtype=np.float64)
        for el in np.radians(els):
            rows.append([surface_point(prim, c, (math.cos(ph) * math.cos(el), math.sin(ph) * math.cos(el), math.sin(el)), 0.0, 0.6)
                         for ph in phis])
    V = np.asarray(rows, dtype=np.float64)            # (rows, cols, 3)
    R, C = V.shape[:2]
    T = []
    for i in range(R - 1):
        for j in range(C):
            j2 = (j + 1) % C
            a, b, cc, d = i * C + j, i * C + j2, (i + 1) * C + j2, (i + 1) * C + j
            T += [(a, b, cc), (a, cc, d)]
    Vf = V.reshape(-1, 3)
    if top is not None:
        pole = surface_point(prim, top[0], (0.0, 0.0, 1.0), 0.0, 0.6)
        Vf = np.concatenate([Vf, pole[None]])
        p = len(Vf) - 1
        T += [((R - 1) * C + j, (R - 1) * C + (j + 1) % C, p) for j in range(C)]
    T = np.asarray(T, dtype=np.int64)
    # outward normals: the first face's normal must point away from the axis
    n0 = np.cross(Vf[T[0, 1]] - Vf[T[0, 0]], Vf[T[0, 2]] - Vf[T[0, 0]])
    if n0 @ (Vf[T[0, 0]] - np.array([cx, cy, Vf[T[0, 0], 2]])) < 0:
        T = T[:, ::-1]
    return MeshPart(Vf, T)


# ── fix round 3 (review 2026-10-27c): the hood light, the throat, clean hand-built hood openings ────────────────
# THE HOOD LIGHT (brief §0.2 + §4, shared targets of round 3): ONE soft emissive ellipsoid core, wider than tall, set
# back in the hollow and centred vertically in the opening, dark hollow above, below and to both sides. The accent is
# factor-only (the shared load test: no maps on `accent`; the renderer tints colour + emissive per viewer), so the
# soft falloff is the painted shell round it: the throat's own walls and back, painted from a dim team-neutral
# lamplight at the core's outline to the hollow's ink (hood_light_paint). No flame, no dish, no lit rim (they read as a
# tongue, a pupil, lips); a separate halo dish behind the core was tried and read as a grey ring round an iris.
def ellipsoid_mesh(c, X, Y, Z, rx, ry, rz, seg: int = 10, rings: int = 6) -> MeshPart:
    """A smooth ellipsoid (a turned UV sphere, poles on Z): half sizes rx along X, ry along Y, rz along Z."""
    prof = [(math.sin(t), -rz * math.cos(t)) for t in np.linspace(0.0, math.pi, rings + 1)]
    prof[0], prof[-1] = (0.0, -rz), (0.0, rz)
    return lathe(c, np.stack([unit(X), unit(Y), unit(Z)]), prof, seg, scale=(rx, ry))


def throat_mesh(rings3, cap_point, axis_point) -> MeshPart:
    """The hood's throat: a tube through the given rings (list of (M, 3) closed loops, front to back) closed by a fan to
    `cap_point`; faces look INTO the tube (toward `axis_point`, a point on its axis), the side a viewer sees through the
    opening. One clean, inked, matte surface from the opening's lip to the back (review 2026-10-27c: the decimated carve
    showed as a ring of crumpled polygons round the arch, felt triangles poking in at the corners)."""
    R = [np.asarray(r, dtype=np.float64) for r in rings3]
    M = len(R[0])
    V = np.concatenate(R + [np.asarray(cap_point, dtype=np.float64)[None]])
    T = []
    for i in range(len(R) - 1):
        for j in range(M):
            j2 = (j + 1) % M
            a_, b_, c_, d_ = i * M + j, i * M + j2, (i + 1) * M + j2, (i + 1) * M + j
            T += [(a_, b_, c_), (a_, c_, d_)]
    p = len(V) - 1
    L = (len(R) - 1) * M
    T += [(L + j, L + (j + 1) % M, p) for j in range(M)]
    T = np.asarray(T, dtype=np.int64)
    cen = V[T].mean(axis=1)
    nrm = np.cross(V[T[:, 1]] - V[T[:, 0]], V[T[:, 2]] - V[T[:, 0]])
    if (nrm * (np.asarray(axis_point)[None] - cen)).sum() < 0:
        T = T[:, ::-1]
    return MeshPart(V, T)


def door_outline(hw, ht, nt, floor_v, n: int, inset: float = 0.0):
    """(u, v) of the Serenade door outline shrunk by `inset`, by arc length from the floor's left corner up the left
    wall, over the round top, down the right wall and back along the floor: n points (a closed loop)."""
    a, b = hw - inset, ht - inset
    fv = floor_v + inset * 0.6
    e = 2.0 / nt
    top = [(a * math.copysign(abs(math.cos(t)) ** e, math.cos(t)), b * abs(math.sin(t)) ** e)
           for t in np.linspace(np.pi, 0.0, 41)]                      # left (u = -a, v = 0) over the top to the right
    pts = [(-a, fv)] + top + [(a, fv)] + [(x, fv) for x in np.linspace(a, -a, 9)[1:-1]]
    P = np.asarray(pts, dtype=np.float64)
    seg = np.linalg.norm(np.diff(np.vstack([P, P[:1]]), axis=0), axis=1)
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    q = np.linspace(0.0, cum[-1], n + 1)[:-1]
    Pc = np.vstack([P, P[:1]])
    u = np.interp(q, cum, Pc[:, 0])
    v = np.interp(q, cum, Pc[:, 1])
    return u, v


def conform_hole(mp: MeshPart, g, prim, thr: float) -> MeshPart:
    """Cut a hole into a sampled surface mesh: faces with every vertex inside (g(P) < thr) are deleted; a vertex inside
    that a kept face still uses is moved onto the boundary (g = thr, found along its edge toward an outside neighbour)
    and set back on `prim`'s surface along its normal - a clean hole edge exactly where a rim covers it."""
    V = mp.V.copy()
    T = mp.T
    gv = g(V)
    ins = gv < thr
    keep = ~ins[T].all(axis=1)
    moved = {}
    for f in T[keep]:
        for k in range(3):
            a = int(f[k])
            if not ins[a]:
                continue
            best = None
            for b in (int(f[(k + 1) % 3]), int(f[(k + 2) % 3])):
                if ins[b]:
                    continue
                lo, hi = 0.0, 1.0
                for _ in range(30):
                    mid = 0.5 * (lo + hi)
                    if g((mp.V[a] + (mp.V[b] - mp.V[a]) * mid)[None])[0] < thr:
                        lo = mid
                    else:
                        hi = mid
                p = mp.V[a] + (mp.V[b] - mp.V[a]) * hi
                d = float(np.linalg.norm(p - mp.V[a]))
                if best is None or d < best[0]:
                    best = (d, p)
            if best is not None and (a not in moved or best[0] < moved[a][0]):
                moved[a] = best
    for a, (_, p) in moved.items():
        n = sdf_normals(prim, p[None])[0]
        V[a] = p - n * float(prim.d(p[None])[0])
    Tk = T[keep]
    used = np.unique(Tk)
    remap = -np.ones(len(V), dtype=np.int64)
    remap[used] = np.arange(len(used))
    return MeshPart(V[used], remap[Tk])


def cap_tube_end(mp: MeshPart, at_end: bool, inset: float = 0.012) -> MeshPart:
    """Close an open tube end (its last / first station ring) with a fan to a point `inset` back inside it: the sleeve's
    open cuff (painted dark inside) instead of a see-through hole."""
    g = mp.groups[0]
    ix = g["ix"]
    ring = ix[-1] if at_end else ix[0]
    C = g["C"]
    c = C[-1] if at_end else C[0]
    d = unit(C[-1] - C[-2]) if at_end else unit(C[0] - C[1])
    tip = c - d * inset
    V = np.concatenate([mp.V, tip[None]])
    p = len(V) - 1
    K = len(ring)
    T = np.asarray([(int(ring[j]), int(ring[(j + 1) % K]), p) for j in range(K)], dtype=np.int64)
    cen = V[T].mean(axis=1)
    nrm = np.cross(V[T[:, 1]] - V[T[:, 0]], V[T[:, 2]] - V[T[:, 0]])
    if (nrm @ d).sum() < 0:
        T = T[:, ::-1]
    return MeshPart(V, np.concatenate([mp.T, T]), mp.groups)


def fist_mesh(G, W, u, r_across: float, r_deep: float, half_len: float, seg: int = 10) -> MeshPart:
    """A mitten FIST gripping a haft (review 2026-10-27c: the mitts read as balls beside the haft): a rounded drum turned
    round the haft axis `u` through the grip G, its section reaching back toward the wrist W (the back of the hand), a
    wrist neck into the sleeve and a thumb lobe lying across the front of the fingers, over the haft."""
    u = unit(u)
    back = W - G
    back = unit(back - u * (back @ u))
    side = unit(np.cross(u, back))
    c = G + back * (r_deep * 0.22)
    prof = [(0.0, -half_len), (0.80, -half_len * 0.94), (1.0, 0.0), (0.80, half_len * 0.94), (0.0, half_len)]
    fist = lathe(c, np.stack([side, back, u]), prof, seg, scale=(r_across, r_deep))
    nk = float(np.linalg.norm(W - c))
    ax = unit(W - c)
    neck = lathe(c + ax * (nk * 0.45), sdf.frame(ax), [(0.0, -nk * 0.42), (0.030, -nk * 0.30), (0.033, nk * 0.30),
                                                      (0.0, nk * 0.62)], 6)
    # the thumb: over the haft on the front of the fist, from the side toward the fingers' front
    t0 = c + u * (half_len * 0.55) + side * (r_across * 0.55) - back * (r_deep * 0.20)
    t1 = c + u * (half_len * 0.80) - side * (r_across * 0.05) - back * (r_deep * 0.78)
    th = float(np.linalg.norm(t1 - t0)) / 2 + 0.014
    thumb = lathe((t0 + t1) / 2, sdf.frame(unit(t1 - t0)), [(0.0, -th), (0.0165, -th + 0.010), (0.0165, th - 0.010),
                                                             (0.0, th)], 6)
    return fist + neck + thumb


# geometry the paint pass needs (the hollow carve, ink lines round the accent bands, painted hem bands, the parts'
# sculpt fields for painted folds, the accent glow functions), per faction; filled by parts_<faction>() during
# model(), read by the paint wrapper during the bake and by clip_overrides (same process)
_GEOM: dict = {}


# ── the two cultures: measurements off each concept (metres; the wick's right hand at -X, front -Y) ─────
# S = shoulder joint (the rig's), E elbow, W wrist, G the grip (mitt centre; the mace haft runs through G.R)
# THE GUARD (review 2026-10-21b item 3: the disc is the job, and held flat on the left flank under the 0.42 m hood it
# vanished whenever the left side faced away - an Aubade wave walking east showed hooded bells with lanterns): the
# shield is carried in front of the left chest, 25 cm forward of the shoulder line and 22 cm out to the left, face turned 45 degrees out and
# tipped 10 degrees up, top edge at 0.75 m, so its rim clears the body outline from the off side and the back. The
# left forearm runs forward behind it (elbow at the flank). Both cultures share the layout (brief §0.3); the bind
# pose IS the idle guard, so the clips start from it.
FACTION = {
    "aubade": {
        "plate_height": 1.04,                     # plate top row 236 (the knob base) on the measuring grid
        "E": {"R": (-0.215, 0.035, 0.480), "L": (0.258, -0.040, 0.468)},
        "W": {"R": (-0.268, -0.015, 0.428), "L": (0.218, -0.162, 0.500)},
        "G": {"R": (-0.305, -0.050, 0.398), "L": (0.192, -0.205, 0.517)},
        "mace_u": unit((-0.257, 0.0, 0.966)),     # haft axis (pommel 0.263 -> cap tip 0.745), 15 deg out
        "shield_c": (0.222, -0.240, 0.530), "shield_turn": 45.0, "shield_tilt": 10.0, "shield_r": 0.225,
    },
    "serenade": {
        "plate_height": 1.08,                     # plate top row 220 = the dome crown
        "E": {"R": (-0.250, 0.030, 0.500), "L": (0.268, -0.040, 0.470)},
        "W": {"R": (-0.300, -0.020, 0.425), "L": (0.226, -0.170, 0.500)},
        "G": {"R": (-0.345, -0.062, 0.378), "L": (0.202, -0.213, 0.515)},
        "mace_u": unit((-0.280, 0.0, 0.960)),
        "shield_c": (0.232, -0.252, 0.528), "shield_turn": 45.0, "shield_tilt": 10.0, "shield_r": 0.220,
    },
}
ANKLE_X = 0.115


def shoulder(side: str) -> np.ndarray:
    """The rig's shoulder joint (rig._layout with PROPORTIONS below)."""
    return np.array([(-1 if side == "R" else 1) * 0.16, 0.018, 0.566])


def shield_frame(F):
    """(centre, normal n, in-plane horizontal t, in-plane up) of the shield: the face turned `shield_turn` out from -Y
    and tipped `shield_tilt` up (the 52-degree camera sees the face, not the edge)."""
    a, b = math.radians(F["shield_turn"]), math.radians(F.get("shield_tilt", 0.0))
    n = np.array([math.sin(a) * math.cos(b), -math.cos(a) * math.cos(b), math.sin(b)])
    t = np.array([math.cos(a), math.sin(a), 0.0])
    return np.asarray(F["shield_c"], dtype=np.float64), n, t, unit(np.cross(n, t))


# ── parts: (name, Sculpt, voxel scale, material role, bind, tris) ─────────────────────────────────────
def _arm_parts(F, out, sleeve_r, mitt, cuff_role, cuff_kind, tris=(90, 60, 64)):
    """Sleeves (upper arm -> forearm by distance), forearm wraps / cuffs, mitts, per side; tris (sleeve, cuff, mitt)."""
    for s in ("R", "L"):
        S = shoulder(s)
        E, W, G = (np.asarray(F[k][s]) for k in ("E", "W", "G"))
        fd = unit(W - E)
        sl = Sculpt(f"sleeve_{s}")
        sl.add(RoundCone(tuple(S + np.array([0, 0, -0.01])), tuple(E), sleeve_r[0], sleeve_r[1]), k=0.0)
        sl.add(RoundCone(tuple(E), tuple(W + fd * 0.005), sleeve_r[1], sleeve_r[2]), k=0.03)
        sl.add(Sphere(tuple(E + np.array([0, 0.01, 0])), sleeve_r[1] * 1.04), k=0.02)
        # the game mesh (fix round 3, review 2026-10-27c: the decimated sleeves read as faceted tubes): a smooth 8-sided
        # tube shoulder -> elbow -> wrist sampled from the same radii, both ends capped (the cuff end painted dark
        # inside); the sculpt stays the bake source
        S0 = S + np.array([0, 0, -0.01])
        C_ = np.array([S0, (S0 + E) / 2, E + np.array([0, 0.004, 0]), (E + W) / 2, W + fd * 0.005])
        r_ = np.array([sleeve_r[0], (sleeve_r[0] + sleeve_r[1]) / 2 + 0.002, sleeve_r[1] * 1.05,
                       (sleeve_r[1] + sleeve_r[2]) / 2, sleeve_r[2]])
        tl = tube(C_, r_, sides=8, taper=False)
        tl = cap_tube_end(cap_tube_end(tl, True, 0.010), False, 0.0)
        out.append((f"sleeve_{s}", (sl, tl), 1.0, "cloth", ("dblend", f"upper_arm.{s}", f"forearm.{s}", tuple(E), tuple(fd), -0.025, 0.025), None))
        # wraps (Aubade: two broad chalk bands) / cuff (Serenade: one ironstone band at the wrist): turned bands round
        # the forearm sitting ON the sleeve sculpt (review 2026-10-27 item 8: the skewed ribbon rings cut in and out of
        # the decimated sleeve and read as pale shards)
        r1, r2 = sleeve_r[1], sleeve_r[2]
        if cuff_kind == "wraps":
            rings = [(0.24, 0.0165), (0.66, 0.0165)]
            seg = 10
        else:
            # the concept's dark band two thirds down the bell sleeve (the felt cuff end flares past it)
            rings = [(0.60, 0.0185)]
            seg = 10
        cf = None
        for f_, hw in rings:
            rad = r1 + (r2 - r1) * f_ + 0.007
            ring_ = lathe(E + (W - E) * f_, sdf.frame(fd), [(rad - 0.002, -hw), (rad + 0.007, 0.0), (rad - 0.002, hw)], seg)
            cf = ring_ if cf is None else cf + ring_
        out.append((f"{cuff_kind}_{s}", cf, 1.0, cuff_role, f"bone:forearm.{s}", None))
        # the mace hand (fix round 3, review 2026-10-27c: the mitts read as balls beside the haft): a mitten FIST wrapped
        # round the haft (a drum turned round the haft axis, the back of the hand toward the wrist, a wrist neck into the
        # sleeve, the thumb lying over the haft across the fingers)
        if s == "R":
            fm = fist_mesh(G, W, np.asarray(F["mace_u"]), mitt[1] * 0.98, mitt[0] * 1.02, mitt[2] * 0.66, seg=10)
            out.append((f"mitt_{s}", fm, 1.0, "leather", f"bone:hand.{s}", None))
            continue
        # the shield hand: a smooth turned mitten along the hand (wrist neck -> fist) and a thumb lobe on the
        # inner-front side over the grip (review item 12: the decimated three-shape sculpt read as a faceted rock)
        hd = unit(G - W)
        back = float(np.linalg.norm(G - W)) + 0.006
        ax_m = sdf.frame(hd, (1.0, 0.0, 0.0))
        m = lathe(G, ax_m, [(0.0, -back), (0.74, -back + 0.010), (1.0, -0.012), (0.86, mitt[2] * 0.55), (0.50, mitt[2] * 0.90),
                            (0.0, mitt[2])], 12,
                  scale=(mitt[0], mitt[1]))
        inward = np.array([1.0 if s == "R" else -1.0, -0.6, 0.35])
        ta, tb = G + unit(inward) * 0.02 + np.array([0, 0, 0.02]), G + unit(inward) * (mitt[0] * 0.85)
        tr = mitt[0] * 0.42
        th_ = float(np.linalg.norm(tb - ta)) / 2 + tr
        m = m + lathe((ta + tb) / 2, sdf.frame(unit(tb - ta)), [(0.0, -th_), (tr, -th_ + tr * 0.7), (tr, th_ - tr * 0.7), (0.0, th_)], 6)
        out.append((f"mitt_{s}", m, 1.0, "leather", f"bone:hand.{s}", None))


def _legs_boots(out, boot_half, boot_r=None, toe_out=10.0, tris=None):
    """Shins (inside the cloak) and boots. The boot (review 2026-10-27 item 11: the decimated box read as a brick) is
    a turned loaf along the foot, heel to toe, its bottom flattened into the sole, and a short round shaft at the ankle:
    a round outline from every side for 80 tris."""
    for s, sx in (("R", -1.0), ("L", 1.0)):
        an = np.array([sx * ANKLE_X, 0.02, 0.055])
        lg = Sculpt(f"leg_{s}")
        lg.add(Capsule(tuple(an + np.array([0, 0.0, 0.03])), tuple(an + np.array([sx * -0.02, -0.01, 0.17])), 0.036), k=0.0)
        out.append((f"leg_{s}", lg, 1.2, "under", f"bone:shin.{s}", 16))
        a = math.radians(sx * toe_out)
        fwd = np.array([math.sin(a), -math.cos(a), 0.0])
        side = np.array([math.cos(a), math.sin(a), 0.0])
        c = np.array([an[0], an[1] - 0.045, 0.036])
        bt = lathe(c, np.stack([side, (0.0, 0.0, 1.0), fwd]),
                   [(0.0, -boot_half[1] * 0.98), (0.80, -boot_half[1] * 0.89), (1.0, -boot_half[1] * 0.39),
                    (0.97, boot_half[1] * 0.36), (0.78, boot_half[1] * 0.80), (0.0, boot_half[1])], 9,
                   scale=(boot_half[0], boot_half[2] - 0.002))
        bt.V[:, 2] = np.maximum(bt.V[:, 2], 0.0)                         # the flat sole
        shaft = lathe(np.array([an[0], an[1], 0.0]), np.eye(3), [(0.043, 0.065), (0.041, 0.135)], 8)
        out.append((f"boot_{s}", bt + shaft, 1.0, "leather", f"bone:foot.{s}", None))


# the Aubade cowl opening (concept front plate on a 5 cm grid): a rounded trapezoid, wide at the chin and narrowing
# to a round top, inner 0.265 m wide at the chin and 0.24 m tall (z 0.665-0.905), centred x -0.035, on the cowl's
# FLAT front plane tilted 11.5 degrees back (review 2026-10-21b item 7: the old rolled brim stood off the cowl like a
# porthole; item 2: the oval opening plus a centred light read as an eye from the 52-degree camera). The carved chalk
# frame round it: 3.5 cm at the sides, 5 cm over the brow, 3 cm under the chin (brief §2.1), flush in the cowl front.
AU_ARCH = PlaneArch((-0.035, -0.190, 0.785), (0.0, -0.97, 0.20), "trap", r1=0.0815, r2=0.050, he=0.075, rr=0.045)
AU_STATIONS = 20                                  # frame / throat stations round the opening (from the chin centre, CCW)


def au_rim_w(alpha):
    """The chalk frame's width round the opening (outside its inner lip): 4.2 cm at the sides, 5.6 over the brow,
    3.6 under the chin (review 2026-10-27 item 7: the 3.5 cm frame read thin)."""
    s = np.sin(alpha)
    return 0.042 + 0.014 * np.clip(s, 0, 1) ** 2 - 0.006 * np.clip(-s, 0, 1) ** 2


AU_GLOW = (0.018, -0.014)                        # the frame's inner edge sits 1.8 cm outside the opening outline
# the throat (fix round 3): (grow outside the opening outline, depth w behind the opening plane) per ring, front to
# back - the lip tucked under the frame's inner edge, rolling in over the edge, then the inked throat to its back cap
AU_THROAT = [(0.019, 0.001), (0.004, -0.004), (-0.012, 0.020), (-0.040, 0.090)]
AU_THROAT_CAP = 0.122
# the hood light: the core's centre (u, v, w) - centred in the opening, set back - and its half sizes (across, deep,
# tall): 10 x 6.2 cm face-on (1.6 : 1; at 2.15 : 1 it shrank to a horizontal dash at the game camera - a slot), its
# front 3.7 cm behind the opening plane
AU_LIGHT = (0.0, 0.0, 0.058)
AU_LIGHT_R = (0.050, 0.021, 0.031)


def light_falloff(uvw, c, r, reach: float = 0.90):
    """0..1 lamplight round a hood light core (c = (u, v, w) centre, r = half sizes across / deep / tall) at points given
    in the opening's (u, v, w): 1 at the core's outline, falling off fastest right there (an exponential over `reach`
    core radii: a glow, never a plateau - a flat-topped halo read as the white of an eye) - the painted half of the
    nested shell."""
    u, v, w = uvw
    e = np.sqrt(((u - c[0]) / r[0]) ** 2 + ((v - c[1]) / r[2]) ** 2 + ((w - c[2]) / (r[1] * 2.6)) ** 2)
    return np.exp(-np.maximum(e - 1.0, 0.0) / reach)


def parts_aubade(F) -> list:
    out = []
    cloak_bind = ("zblend", "hips", "chest", 0.40, 0.60)

    # CLOAK: a straight-fold bell, shoulders x 0.205 at 0.55 -> hem x 0.262 at 0.10, eight shallow hem points; the
    # ironstone hem band (brief §2.4) is PAINTED on it below z 0.170 (a straight top edge) over a 3 mm raised step.
    # The game mesh is sampled ON the sculpt (24 stations round, a clean round outline: review item 10); the sculpt is
    # the bake source for its folds.
    def hem(x, y):
        phi = np.arctan2(y - 0.015, x)
        return 0.100 + 0.016 * tri_wave(phi, 8)
    bell = Bell([0.095, 0.15, 0.30, 0.45, 0.55, 0.635], [0.262, 0.258, 0.240, 0.222, 0.205, 0.150],
                [0.216, 0.210, 0.192, 0.172, 0.158, 0.118], cy=0.015, hem=hem)
    fo = folds(0.011, 5.5, 0.4, zfade=(0.60, 0.15), sharp=0.7)
    cloak_p = Blend([("add", bell.displaced(lambda P: fo(P) - 0.003 * sstep(0.173, 0.167, P[:, 2]), 0.014), 0.0),
                     ("add", Ellipsoid((0, 0.015, 0.548), (0.207, 0.160, 0.072)), 0.04)])
    cloak = Sculpt("cloak")
    cloak.add(cloak_p, k=0.0)
    NC = 32                                       # 4 stations per hem point (review 2026-10-27b item 5: polygonal hem)
    phis = -np.pi / 2 + np.arange(NC) * 2 * np.pi / NC
    hz = 0.100 + 0.016 * tri_wave(phis, 8) + 0.003
    zs = np.stack([hz, np.full(NC, 0.164), np.full(NC, 0.178), np.full(NC, 0.26), np.full(NC, 0.36), np.full(NC, 0.46),
                   np.full(NC, 0.535)])
    low = lathe_low(cloak_p, 0.015, phis, zs, top=((0.0, 0.015, 0.50), [55.0]))
    out.append(("cloak", (cloak, low), 1.0, "cloth", cloak_bind, None))
    # the chalk stole (review 2026-10-27 item 8: the decimated shell tore at its pointed ends): two strips laid on the
    # cloak sculpt's front (front view x -0.153..-0.091 and 0.001..0.065), raised 8 mm along the middle with the edges
    # turned down onto the cloak, each ending in a clean point
    stole = None
    cols = [(-1.0, -0.002), (-0.78, 0.007), (0.0, 0.0085), (0.78, 0.007), (1.0, -0.002)]
    for xc, w in ((-0.122, 0.031), (0.033, 0.032)):
        G_ = []
        for z in (0.585, 0.48, 0.38, 0.28, 0.20, None):
            row = []
            for cf, lf in cols:
                x = xc + cf * w
                zz = z if z is not None else 0.140 + 1.3 * abs(cf * w)
                p = front_hit(cloak_p, x, zz)
                row.append(p + sdf_normals(cloak_p, p[None])[0] * lf)
            G_.append(row)
        strip = grid_mesh(np.asarray(G_))
        stole = strip if stole is None else stole + strip
    out.append(("stole", stole, 1.0, "chalk", cloak_bind, None))

    # HOOD: a rounded cowl (dome 1.015 m) with a bell flare at the base and the nape swept back and down; its FRONT a
    # flat face (the opening shape grown 8.5 cm, extruded back and blended into the dome) on which the chalk frame and
    # the lit inner rim lie; the opening carved as the arch prism into a deep hollow
    A = AU_ARCH

    def front_block(P):
        u, v, w = A.uvw(P)
        return np.maximum.reduce([A.f2(u, v) - 0.085, -w - 0.010, w - 0.24])
    hc = np.array([-0.025, 0.030, 0.800])
    hf = folds(0.0045, 6.0, 0.9, zfade=(0.98, 0.72), sharp=0.8)       # soft linen folds, none on the crown
    outer = Blend([("add", Ellipsoid(tuple(hc), (0.205, 0.215, 0.215)).displaced(hf, 0.005), 0.0),
                   ("add", Ellipsoid((-0.025, 0.050, 0.690), (0.214, 0.214, 0.085)).displaced(hf, 0.005), 0.06),
                   ("add", Ellipsoid((-0.025, 0.145, 0.735), (0.165, 0.105, 0.115)), 0.05),
                   ("add", Fn(front_block, (-0.30, -0.25, 0.50), (0.24, 0.12, 1.05)), 0.065),
                   ("inter", sdf.HalfSpace(tuple(A.O), tuple(A.N), 0.6), 0.022)])
    cav_ax = np.stack([A.X, A.U, -A.N])
    cavity = Ellipsoid(tuple(A.to3(0.0, -0.01, 0.045)), (0.170, 0.185, 0.125), axes=cav_ax)
    prism = Fn(A.field, (-0.30, -0.40, 0.55), (0.25, 0.20, 1.00))
    carve = Inter(prism, cavity, bounds=cavity.bounds())
    hood = Sculpt("hood")
    hood.add(outer, k=0.0)
    hood.sub(carve, k=0.010)
    out.append(("hood", hood, 1.0, "cloth2", "bone:head", 440))
    # the carved chalk frame (review 2026-10-27 item 7: broad, 4.2-5.6 cm): a flat band 1 cm proud of the cowl face,
    # bevelled on both edges; its broad scroll relief and block joints are painted (au_rim_paint)
    al = -np.pi / 2 + np.arange(AU_STATIONS) * 2 * np.pi / AU_STATIONS
    wv = au_rim_w(al)
    g0, g1 = AU_GLOW
    rows = []
    for grow, w_ in ((g0 + wv, 0.008), (g0 + wv - 0.007, -0.010), (g0 + 0.004, -0.011), (g0 - 0.002, -0.003)):
        uu, vv = A.boundary(al, grow)
        rows.append(A.to3(uu, vv, w_))
    rim = MeshPart(np.stack(rows, axis=1).reshape(-1, 3), grid_tris(AU_STATIONS, 4, closed=True))
    out.append(("hood_rim", rim, 1.0, "chalk", "bone:head", None))
    rim_top = float(A.to3(*A.boundary(al, g0 + wv))[:, 2].max())
    # THE THROAT (fix round 3; the lit inner rim, the ink cup, the chalk dish and the flame are gone - a lit ring round
    # the opening read as lips, the flame on its dish as a tongue / a pupil): from under the frame's inner edge the
    # linen rolls in over the edge and runs back as one clean inked tube to a round back cap
    rings = []
    for grow, w_ in AU_THROAT:
        uu, vv = A.boundary(al, grow)
        rings.append(A.to3(uu, vv, w_))
    cap = A.to3(0.0, -0.01, AU_THROAT_CAP)
    out.append(("throat", throat_mesh(rings, cap, A.to3(0.0, 0.0, 0.06)), 1.0, "ink", "bone:head", None))
    # THE HOOD LIGHT: one soft core, wider than tall, centred in the opening and set back; its falloff is painted on the
    # throat round it (hood_light_paint)
    lc = A.to3(*AU_LIGHT)
    rx, rd, rz = AU_LIGHT_R
    out.append(("hood_light", ellipsoid_mesh(lc, A.X, -A.N, A.U, rx, rd, rz, seg=8, rings=6), 1.0, "accent", "bone:head",
                None))
    # THE HOOD MARK: one broad accent seam centred on the frame (x of the arch), its front end UNDER the chalk frame (it
    # starts 1.4 cm inside the frame's outer edge, so no end shows: review 2026-10-27c - the free end above the brow
    # read as tape peeling off), over the crown UNDER the knob's base disc, down the back to the nape. A low band
    # whose bevelled edges sink into the cowl (no lifted edge, no shadow under it).
    xs = float(A.O[0])
    o = np.array([xs, hc[1], hc[2] - 0.02])
    w_top = float(g0 + au_rim_w(np.pi / 2))
    pts = []
    for t in np.radians(np.linspace(6, 196, 200)):
        p = surface_point(outer, o, (0.0, -math.cos(t), math.sin(t)), 0.05, 0.5)
        uu, vv, ww = A.uvw(p[None])
        if p[1] > -0.02 or (A.f2(uu, vv)[0] > w_top - 0.014 and vv[0] > 0):
            pts.append(p)
    pts = np.asarray(pts)
    sl = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))])
    pts = np.array([pts[int(np.argmin(np.abs(sl - q)))] for q in np.linspace(0.0, sl[-1], 18)])
    seam = ribbon(pts, sdf_normals(outer, pts), 0.0225, SEAM_BAND, ends=(False, True))
    # the hood-hem band: a broad accent band round the cowl's lower edge on the back half (the side / back team read),
    # its ends sunk into the linen
    hem_c = np.array([-0.025, 0.045, 0.676])
    trim = []
    for phi in np.radians(np.linspace(8, 172, 12)):
        trim.append(surface_point(outer, hem_c, (math.cos(phi), math.sin(phi), -0.07), 0.05, 0.4))
    trim = np.asarray(trim)
    seam = seam + ribbon(trim, sdf_normals(outer, trim), 0.0225, SEAM_BAND)
    out.append(("hood_seam", seam, 1.0, "accent", "bone:head", None))
    # the knob: the concept's round chalk knob (a broad base disc, a ball, a small round top), 6.4 cm over the dome,
    # standing ON the seam at the crown: its base disc (3.5 cm radius) covers the seam's crossing and sinks 4 mm into
    # the cowl round it (review 2026-10-27c: the seam ran beside the knob, a chalk chip stuck out at its base)
    ki = int(np.argmax(pts[:, 2]))
    kb = pts[ki]
    knob_prof = [(0.0, -0.005), (0.035, -0.005), (0.035, 0.006), (0.022, 0.015), (0.027, 0.028), (0.018, 0.041),
                 (0.011, 0.046), (0.014, 0.055), (0.0, 0.065)]
    out.append(("knob", lathe(kb, np.eye(3), knob_prof, 8), 1.0, "chalk", "bone:head", None))
    # the linen scarf under the hood: a soft roll with a V-point at the front, kept 1.5 cm clear of the hollow
    scarf = Sculpt("scarf")
    scarf.add(Torus((-0.01, 0.012, 0.618), 0.128, 0.050, rz=0.040), k=0.0)
    scarf.add(RoundCone((-0.03, -0.115, 0.628), (-0.05, -0.160, 0.560), 0.055, 0.018), k=0.04)
    scarf.add(Ellipsoid((-0.01, 0.012, 0.635), (0.16, 0.14, 0.035)), k=0.03)
    scarf.sub(Fn(lambda P: carve.d(P) - 0.015, *cavity.bounds()), k=0.01)
    out.append(("scarf", scarf, 1.0, "cloth2", "bone:chest", 90))

    # ARMS, LEGS
    _arm_parts(F, out, (0.050, 0.047, 0.045), (0.050, 0.046, 0.058), "chalk", "wraps", (80, 45, 76))
    _legs_boots(out, (0.062, 0.090, 0.046), 0.034, tris=60)

    # SHIELD (left hand, the guard): a chalk disc 0.45 m, convex face, raised rim, a vertical rib with short spire points
    c, n, t, up = shield_frame(F)
    R = F["shield_r"]
    axl = np.stack([t, up, n])                      # local Z = n (the face looks out along n)

    def disc_prof(r, z):
        face = 0.010 + 0.016 * (1 - np.clip(r / R, 0, 1) ** 2)
        return np.maximum(np.maximum(r - R, -0.022 - z), z - face)
    sh = Sculpt("shield")
    sh.add(Lathe(tuple(c), disc_prof, R + 0.01, -0.03, 0.04, axes=axl), k=0.0)
    sh.add(Torus(tuple(c + n * 0.010), R - 0.016, 0.017, axes=axl, rz=0.016), k=0.006)
    # the rib (review 2026-10-27 item 6: the concept's VERTICAL rib with a spire top; it ran past the rim at both ends
    # and, rolled 30 degrees by the arm, read as a propeller - now held upright by the AimUp roll): a flat blade on the
    # face, 5.6 cm wide, ending at the rim below and rising to a blunt spire point 6 cm over the rim
    v1, v0 = R + 0.06, -(R - 0.004)

    def rib(P, c=c, t=t, up=up, n=n):
        q = P - c
        u_, v_, w_ = q @ t, q @ up, q @ n
        taper = np.minimum(np.clip((v1 - v_) / 0.075, 0.13, 1.0), np.clip((v_ - v0) / 0.05, 0.35, 1.0))
        hw = 0.028 * taper
        return np.maximum.reduce([np.abs(u_) - hw, np.abs(w_ - 0.018) - 0.016 * np.sqrt(taper), v0 - v_, v_ - v1])
    sh.add(Ellipsoid(tuple(c + n * 0.03), (0.075, 0.075, 0.016), axes=axl), k=0.02)
    # the back: a strap pad (the back is what the off side sees of the guard)
    sh.add(Ellipsoid(tuple(c - n * 0.024), (0.10, 0.05, 0.012), axes=axl), k=0.012)
    # the game mesh: a turned disc (20 stations: the job read must be ROUND), the sculpt its bake source; the rib is its
    # own part
    disc = lathe(c, axl, [(0.0, -0.034), (0.11, -0.025), (R - 0.008, -0.020), (R + 0.002, 0.004), (R - 0.008, 0.025),
                          (R - 0.030, 0.020), (0.10, 0.026), (0.0, 0.045)], 16)
    out.append(("shield", (sh, disc), 0.8, "chalk", "bone:hand.L", None))
    rb = Sculpt("shield_rib")
    rb.add(Fn(rib, tuple(c - 0.32), tuple(c + 0.32)), k=0.0)
    out.append(("shield_rib", rb, 0.7, "chalk", "bone:hand.L", 56))
    # the dawnglass ring round the boss and the accent boss: brief §3.1 "dawnglass boss 0.12 m (accent core)" - the
    # core is 12.8 cm (review 2026-10-27 items 3 and 6: bigger lamp cores; the accent ring inlaid in the face made the
    # disc a bullseye and is gone)
    ring = lathe(c + n * 0.034, axl, [(0.088, 0.000), (0.078, 0.023), (0.063, 0.011)], 14)
    out.append(("shield_ring", ring, 1.0, "dawnglass", "bone:hand.L", None))
    boss = lathe(c + n * 0.038, axl, [(0.064, 0.0), (0.058, 0.016), (0.043, 0.031), (0.022, 0.040), (0.0, 0.043)], 10)
    out.append(("shield_boss", boss, 1.0, "accent", "bone:hand.L", None))

    # LANTERN-MACE (right hand): pale ash haft through the fist, a tall four-sided chalk lantern 0.12 m wide, a pointed
    # chalk cap (tip 0.745 m). Its windows (review 2026-10-27 item 5: hexagon accent plates read as inset gems): each
    # face is TWO TALL LIT PANES either side of a chalk mullion (the concept), the light an accent block inside the
    # dawnglass box, which shows as the glass's pale bands over and under the panes
    G = np.asarray(F["G"]["R"])
    u = F["mace_u"]
    fr = np.stack([unit(np.cross((0.0, -1.0, 0.0), u)), np.array([0.0, -1.0, 0.0]), u])   # local Z = u
    lax = sdf.rot_z(45.0) @ fr                                                              # the lantern turned 45 deg
    at = lambda s: G + u * s                                                                 # noqa: E731
    haft = Sculpt("haft")
    haft.add(Capsule(tuple(at(-0.125)), tuple(at(0.12)), 0.022), k=0.0)
    out.append(("haft", haft, 0.8, "wood", "bone:hand.R", 42))
    lan = Sculpt("lantern")
    lan.add(RoundCone(tuple(at(-0.155)), tuple(at(-0.115)), 0.016, 0.030), k=0.0)                # pommel
    lan.add(RoundBox(tuple(at(0.112)), (0.050, 0.050, 0.014), 0.008, axes=lax), k=0.0)            # base plate
    lan.add(RoundCone(tuple(at(0.07)), tuple(at(0.105)), 0.024, 0.036), k=0.01)                    # neck
    for i in range(4):
        a = math.radians(45 + 90 * i)
        off = (lax[0] * math.cos(a) + lax[1] * math.sin(a)) * 0.064
        lan.add(Capsule(tuple(at(0.12) + off), tuple(at(0.235) + off), 0.0125), k=0.004)          # corner posts
    lan.add(RoundBox(tuple(at(0.243)), (0.058, 0.058, 0.012), 0.008, axes=lax), k=0.006)          # top plate
    lan.add(RoundCone(tuple(at(0.25)), tuple(at(0.345)), 0.050, 0.004), k=0.01)                    # pointed cap
    lan.add(Sphere(tuple(at(0.30)), 0.012), k=0.0)
    out.append(("lantern", lan, 0.6, "chalk", "bone:hand.R", 100))
    pane = Sculpt("lantern_pane")
    pane.add(RoundBox(tuple(at(0.178)), (0.047, 0.047, 0.057), 0.006, axes=lax), k=0.0)
    out.append(("lantern_pane", pane, 0.7, "dawnglass", "bone:hand.R", 36))
    core = box(at(0.178), lax, (0.0500, 0.0500, 0.045))
    out.append(("lantern_core", core, 1.0, "accent", "bone:hand.R", None))
    mull = None
    for i in range(4):
        a = math.radians(90 * i)
        nrm = lax[0] * math.cos(a) + lax[1] * math.sin(a)
        tan = np.cross(lax[2], nrm)
        m_ = box(at(0.178) + nrm * 0.0505, (tan, nrm, lax[2]), (0.0085, 0.0045, 0.050))
        mull = m_ if mull is None else mull + m_
    out.append(("lantern_mullion", mull, 1.0, "chalk", "bone:hand.R", None))

    stole_edges = []
    for xc, w in ((-0.122, 0.031), (0.033, 0.032)):
        for sx in (-1.0, 1.0):
            x = xc + sx * (w - 0.007)
            e_ = np.array([front_hit(cloak_p, x, z) for z in np.linspace(0.58, 0.20, 12)])
            stole_edges.append(e_ + sdf_normals(cloak_p, e_) * 0.0075)
    _GEOM["aubade"] = {
        "stitches": [("hood", pts[1:-1], False, 0.041, 0.008, 0.006, 0.0026, 0.60),
                     ("hood", trim[1:-1], False, 0.041, 0.008, 0.006, 0.0026, 0.62),
                     ("cloak", ring_on(cloak_p, 0.184, 60, 0.015), True, 0.0, 0.009, 0.006, 0.0030, 1.70),
                     ("cloak", ring_on(cloak_p, 0.148, 60, 0.015), True, 0.0, 0.009, 0.006, 0.0030, 1.90)]
                    + [("stole", e_, False, 0.0, 0.008, 0.006, 0.0024, 0.66) for e_ in stole_edges],
        "mat_aux": {"haft": tuple(u)},
        "carve": carve,
        "arch": A,
        "shield_frame": (c, n, t, up), "shield_R": R,
        "rim": (al, wv),
        "bands": [("cloak", -1.0, 0.170, "#252A30")],
        "light": (AU_LIGHT, AU_LIGHT_R),
        "sdf": {"cloak": cloak_p, "hood": Blend([("add", outer, 0.0), ("sub", carve, 0.010)]), "scarf": Blend([(op, p_, k_) for op, p_, k_, _ in scarf.ops]),
                "stole": cloak_p, "shield": Blend([(op, p_, k_) for op, p_, k_, _ in sh.ops])},
        # (host parts, polyline, closed, d_in, d_out, value multiplier): a dark groove round each accent band, so
        # the emissive pops on any cloth hue
        # (the polylines stop a station short of each ribbon's tapered end: a round ink cap past the end read as a
        # dark blot beside the frame)
        "inklines": [(("hood",), pts[1:-1], False, 0.0, 0.0365, 0.20),
                     (("hood",), trim[1:-1], False, 0.0, 0.0355, 0.24),
                     (("shield",), c[None] + n[None] * 0.034 + 0.092 * (np.cos(np.linspace(0, 2 * np.pi, 25)[:-1])[:, None] * t[None]
                                                                     + np.sin(np.linspace(0, 2 * np.pi, 25)[:-1])[:, None] * up[None]),
                      True, 0.0, 0.010, 0.75)],
    }
    return out


# the Serenade dome arch (concept front plate on a 5 cm grid): a tall round-topped door from under the crown band down
# to the collar (review 2026-10-27b item 1: the 0.28 m x 0.19 m opening read as a squat slot - a mouth - under a lit
# "upper lip"): 0.236 m wide, its top a full round (superellipse n 2.5: no peak) 15 cm tall reaching z 0.972, the
# collar's front sill at 0.75 -
# about 1.07 : 1 face-on. A thick rolled felt rim (sculpted, a step darker: brief §2.2 "a dark felt rim") frames it up
# to the crown band; the light is INSIDE (SE_LIGHT), never on the rim.
SE_ARCH = PlaneArch((0.0, -0.200, 0.822), (0.0, -1.0, 0.0), "door", hw=0.118, ht=0.150, nt=2.5, vb=-0.20)
SE_FLOOR = 0.752                                  # the hollow's floor (the collar's front sill is at ~0.75)
SE_RIM = (0.015, 0.019)                           # the rolled rim: centre line 1.5 cm outside the edge, radius 1.9 cm


# fix round 3: the hood light is ONE soft core centred in the opening (z 0.862 = halfway between the sill and the arch
# top), set back ~3 cm behind the brow roll, 10 x 6.2 cm face-on; the throat rings (inset inside
# the door outline, extra depth behind the dome's front surface there); the rolled rim's centre line 1.5 cm outside
SE_LIGHT = (0.0, 0.034, 0.048)                    # (u, v, w) on SE_ARCH (the brow roll hid more of it at 52 deg)
SE_LIGHT_R = (0.050, 0.021, 0.031)
SE_THROAT = [(-0.001, 0.016), (0.012, 0.034), (0.032, 0.075), (0.052, 0.130)]
SE_THROAT_CAP = 0.230


def pad_mesh(c, n, t, up, R, face, rr, ang, ha, hb, seg: int = 16, ex: float = 3.0) -> MeshPart:
    """A sandstone pad lying ON the shield's domed face (review 2026-10-27b item 9: the small round buttons read as a
    wheel / film reel): a rounded-rectangle outline (superellipse, exponent `ex`) centred `rr` out from the shield
    centre at angle `ang` (deg, 0 = +t), half sizes ha (radial) x hb (tangential), every vertex set on the dome
    face(r) + its profile height, so the pad follows the dome."""
    a = math.radians(ang)
    d2 = t * math.cos(a) + up * math.sin(a)
    e1 = np.cross(n, d2)
    prof = [(1.05, -0.004), (0.93, 0.0100), (0.0, 0.0135)]
    th = np.arange(seg) * 2 * np.pi / seg
    cs, sn = np.cos(th), np.sin(th)
    sx = np.sign(cs) * np.abs(cs) ** (2.0 / ex)
    sy = np.sign(sn) * np.abs(sn) ** (2.0 / ex)
    V = []
    for k_, h in prof[:-1]:
        for j in range(seg):
            q = c + d2 * (rr + ha * k_ * sx[j]) + e1 * (hb * k_ * sy[j])
            r_ = float(np.linalg.norm(q - c))
            V.append(q + n * (face(r_) + h))
    T = []
    K = len(prof) - 1
    for i in range(K - 1):
        for j in range(seg):
            j2 = (j + 1) % seg
            a_, b_, c_, d_ = i * seg + j, i * seg + j2, (i + 1) * seg + j2, (i + 1) * seg + j
            T += [(a_, b_, c_), (a_, c_, d_)]
    V.append(c + d2 * rr + n * (face(rr) + prof[-1][1]))
    p0 = len(V) - 1
    T += [((K - 1) * seg + j, (K - 1) * seg + (j + 1) % seg, p0) for j in range(seg)]
    V = np.asarray(V)
    T = np.asarray(T, dtype=np.int64)
    n0 = np.cross(V[T[-1, 1]] - V[T[-1, 0]], V[T[-1, 2]] - V[T[-1, 0]])
    if n0 @ n < 0:
        T = T[:, ::-1]
    return MeshPart(V, T)


def parts_serenade(F) -> list:
    out = []
    cloak_bind = ("zblend", "hips", "chest", 0.40, 0.60)

    # CLOAK: an umber bell, hem x 0.29 at 0.115 (review item 4: the hem at 3-6 cm and 0.66 m wide hid the boots in
    # every run frame; the shared spec is 0.56 m at 0.16 m), soft rounded folds; the two ironstone hem bands are PAINTED
    # (z 0.205-0.240 and under 0.148) over 3 mm raised steps. Game mesh sampled on the sculpt (24 round).
    def hem(x, y):
        return 0.115 + 0.005 * np.sin(np.arctan2(y, x) * 5.0)

    def bands_step(P):
        z = P[:, 2]
        return -0.003 * np.maximum(sstep(0.202, 0.208, z) * sstep(0.243, 0.237, z), sstep(0.151, 0.145, z))
    bell = Bell([0.110, 0.15, 0.20, 0.30, 0.45, 0.56, 0.640], [0.290, 0.287, 0.280, 0.266, 0.250, 0.236, 0.180],
                [0.214, 0.212, 0.208, 0.201, 0.192, 0.183, 0.140], cy=0.02, hem=hem)
    fo = folds(0.010, 3.5, 1.1, zfade=(0.55, 0.14), sharp=1.6)
    fe = felt(0.0025, 14.0)
    cloak_p = Blend([("add", bell.displaced(lambda P: fo(P) + fe(P) + bands_step(P), 0.0155), 0.0),
                     ("add", Ellipsoid((0, 0.02, 0.560), (0.238, 0.186, 0.075)), 0.04),
                     ("add", Bell([0.110, 0.13, 0.18], [0.290, 0.289, 0.284], [0.215, 0.214, 0.211], cy=0.02, hem=hem)
                      .displaced(bands_step, 0.003), 0.02)])
    cloak = Sculpt("cloak")
    cloak.add(cloak_p, k=0.0)
    NC = 26                                       # (review 2026-10-27b item 5: polygonal hem)
    phis = -np.pi / 2 + np.arange(NC) * 2 * np.pi / NC
    hz = 0.115 + 0.005 * np.sin(np.arctan2(np.sin(phis), np.cos(phis)) * 5.0) + 0.003
    zs = np.stack([hz, np.full(NC, 0.150), np.full(NC, 0.206), np.full(NC, 0.241), np.full(NC, 0.33), np.full(NC, 0.44),
                   np.full(NC, 0.535)])
    low = lathe_low(cloak_p, 0.02, phis, zs, top=((0.0, 0.02, 0.50), [55.0]))
    out.append(("cloak", (cloak, low), 1.0, "cloth", cloak_bind, None))
    # THE SAND MANTLE (review 2026-10-27b item 2: a short flat shelf at shoulder height - from the back the figure
    # stacked dome / collar / slab / column): a soft felt cape draped over the shoulders, its hem a curve sagging lowest
    # at the back centre (0.552) and rising to rounded corners over the arms (0.62), two rounded lapel flaps in front
    # (0.556) with a V between them up to the collar (concept front / back plates on a 5 cm grid); broad drape folds
    # down the back, a rolled hem edge. No accent on it (item 10: the mantle band poked through the felt).
    def mantle_hem(x, y):
        a_ = np.arctan2(y - 0.015, x)
        hb = 0.552 + 0.068 * np.abs(np.cos(a_)) ** 2.2
        hf = 0.556 + 0.064 * np.clip((np.abs(x) - 0.165) / 0.075, 0.0, 1.0) ** 1.6
        notch = 0.662 - 2.9 * np.abs(x)
        k_ = 0.010
        h_ = np.clip(0.5 + 0.5 * (notch - hf) / k_, 0.0, 1.0)
        hf = hf * (1 - h_) + notch * h_ + k_ * h_ * (1 - h_)           # smooth max (the flaps' rounded inner corners)
        wf = sstep(0.04, -0.06, y - 0.015)
        return hb * (1 - wf) + hf * wf
    mantle = Sculpt("mantle")
    mbell = Bell([0.540, 0.570, 0.610, 0.650, 0.690, 0.722], [0.266, 0.261, 0.250, 0.229, 0.200, 0.166],
                 [0.216, 0.212, 0.202, 0.187, 0.166, 0.140], cy=0.015, hem=mantle_hem)
    mf = folds(0.0085, 5.0, 0.3, zfade=(0.67, 0.555), sharp=1.0)

    def mroll(P):                                 # the rolled hem: 6 mm proud along the last 2.5 cm
        hz_ = mantle_hem(P[:, 0], P[:, 1])
        return -0.006 * sstep(hz_ + 0.025, hz_ + 0.004, P[:, 2])
    mantle_p = mbell.displaced(lambda P: felt(0.003, 12.0)(P) + mf(P) + mroll(P), 0.016)
    mantle.add(mantle_p, k=0.0)
    # its game mesh sampled ON the sculpt: 30 stations round (the V and the flap corners need them), rows from the
    # shaped hem up under the collar; the sculpt is the bake source for its felt and folds
    mph = -np.pi / 2 + np.arange(26) * 2 * np.pi / 26
    mhz = []
    for ph_ in mph:
        p0 = surface_point(mantle_p, (0.0, 0.015, 0.62), (math.cos(ph_), math.sin(ph_), 0.0), 0.05, 0.45)
        mhz.append(float(mantle_hem(np.array([p0[0]]), np.array([p0[1]]))[0]) + 0.004)
    mhz = np.asarray(mhz)
    mzs = np.stack([mhz + (0.712 - mhz) * f_ for f_ in (0.0, 0.14, 0.50, 1.0)])
    out.append(("mantle", (mantle, lathe_low(mantle_p, 0.015, mph, mzs)), 1.0, "cloth2", "bone:chest", None))
    mhem = []                                     # a running stitch 1.4 cm over the hem (paint), flap to flap
    for ph_ in np.radians(np.linspace(-90 + 16, 270 - 16, 40)):
        d_ = (math.cos(ph_), math.sin(ph_), 0.0)
        p0 = surface_point(mantle_p, (0.0, 0.015, 0.62), d_, 0.05, 0.45)
        zq = float(mantle_hem(np.array([p0[0]]), np.array([p0[1]]))[0]) + 0.014
        mhem.append(surface_point(mantle_p, (0.0, 0.015, zq), d_, 0.05, 0.45))
    mhem = np.asarray(mhem)
    # the thick rolled collar of dark felt (brief §2.2), tipped 6 degrees front-down so the arch sits on it; its
    # front sinks under the arch to the sill at 0.75 (concept). Game mesh: sampled round the roll (review 2026-10-27b
    # item 5: the decimated 140-tri torus read as a lumpy tyre), the inner side under the hood skirt left out.
    collar = Sculpt("collar")
    def dip(P):
        return felt(0.004, 10.0)(P) + 0.040 * sstep(-0.05, -0.19, P[:, 1]) * sstep(0.70, 0.80, P[:, 2])
    # (concept back plate: the roll 0.69-0.83 - a 12-14 cm roll, nearly level; the old 17 cm roll tipped 11 degrees
    # rose to 0.85 at the back and hid the mantle)
    col_c, col_R, col_r, col_rz = np.array([0.0, 0.012, 0.748]), 0.165, 0.088, 0.069
    col_ax = sdf.axes_from_rot(sdf.rot_x(6.0))
    collar_p = Torus(tuple(col_c), col_R, col_r, axes=col_ax, rz=col_rz).displaced(dip, 0.042)
    collar.add(collar_p, k=0.0)

    # HOOD: a broad sand-felt dome (crown 1.085, 0.42 m wide) sinking into the collar, the door carved into a deep
    # hollow. Fix round 3 (review 2026-10-27c: the decimated carve read as a ring of crumpled grey polygons round the arch
    # with felt triangles poking in at the upper corners and a sliver at the lower left): the dome's game mesh is SAMPLED
    # on the sculpt (a clean round dome) and its hole conformed exactly under the rolled rim; the rim is a hand-built
    # felt roll along the arch; inside, one clean inked throat. The sculpt stays the bake source.
    A = SE_ARCH
    hc = np.array([0.0, 0.010, 0.880])
    dome = Ellipsoid(tuple(hc), (0.210, 0.215, 0.205))
    skirt = RoundCone((0, 0.010, 0.86), (0, 0.010, 0.72), 0.207, 0.198)
    outer = Blend([("add", dome, 0.0), ("add", skirt, 0.03)])
    prism = Fn(A.field, (-0.20, -0.40, 0.55), (0.20, 0.20, 1.02))
    cavity = Ellipsoid((0.0, -0.065, 0.830), (0.182, 0.215, 0.192))
    floor = Fn(lambda P: SE_FLOOR - P[:, 2], (-0.25, -0.40, 0.55), (0.25, 0.20, 1.02))
    carve = Inter(prism, cavity, floor, bounds=cavity.bounds())
    collar.sub(Fn(lambda P: carve.d(P) - 0.010, *cavity.bounds()), k=0.008)
    g_, r_ = SE_RIM
    hood = Sculpt("hood")
    hood.add(dome.displaced(felt(0.0025, 13.0), 0.0025), k=0.0)
    hood.add(skirt, k=0.03)
    hood.sub(carve, k=0.012)
    hood.inter(sdf.HalfSpace((0.0, 0.0, 0.700), (0.0, 0.0, -1.0), 2.0), k=0.0)
    NH = 22
    hph = -np.pi / 2 + np.arange(NH) * 2 * np.pi / NH
    hlow = lathe_low(outer, 0.010, hph, [0.705, 0.752, 0.800, 0.850], top=(tuple(hc), [12.0, 32.0, 52.0, 72.0]))

    def hole_g(P):
        u, v, w = A.uvw(P)
        return np.where(P[:, 1] < -0.04, A.f2(u, v), 1.0)
    hlow = conform_hole(hlow, hole_g, outer, g_ - 0.004)
    out.append(("hood", (hood, hlow), 1.0, "cloth2", "bone:head", None))
    # the collar's game mesh (after the carve: the sill is the collar's own front top)
    collar_f = Blend([(op, p_, k_) for op, p_, k_, _ in collar.ops])
    NU, tv = 20, np.radians([-120, -74, -30, 14, 60, 120])
    rows = []
    for tq in tv:
        row = []
        for j in range(NU):
            ph_ = -np.pi / 2 + j * 2 * np.pi / NU
            radial = col_ax.T @ np.array([math.cos(ph_), math.sin(ph_), 0.0])
            axis = col_ax.T @ np.array([0.0, 0.0, 1.0])
            core = col_c + radial * col_R
            row.append(surface_point(collar_f, core, radial * math.cos(tq) + axis * math.sin(tq) * (col_rz / col_r), 0.0, 0.2))
        rows.append(row)
    clow = MeshPart(np.asarray(rows).transpose(1, 0, 2).reshape(-1, 3), grid_tris(NU, len(tv), closed=True))
    c0_ = clow.V[clow.T].mean(axis=1)
    nn_ = np.cross(clow.V[clow.T[:, 1]] - clow.V[clow.T[:, 0]], clow.V[clow.T[:, 2]] - clow.V[clow.T[:, 0]])
    rad_ = c0_ - col_c
    rad_[:, 2] = 0.0
    if (nn_ * rad_).sum() < 0:
        clow = MeshPart(clow.V, clow.T[:, ::-1])
    out.append(("collar", (collar, clow), 1.0, "cloth", "bone:chest", None))
    # THE ROLLED FELT RIM (brief §2.2 "a dark felt rim"): a felt roll 3.8 cm thick along the door, 1.5 cm outside its
    # edge, from inside the collar up one side, round the top and down the other; its outer side sinks into the dome,
    # its inner side curls into the opening (inked there by rim_tube_paint)
    hw_, ht_ = A.kw["hw"] + g_, A.kw["ht"] + g_
    e_ = 2.0 / A.kw.get("nt", 2.0)
    uv_ = [(-hw_, v_) for v_ in (-0.112, -0.070, -0.030)] + \
          [(hw_ * math.copysign(abs(math.cos(a_)) ** e_, math.cos(a_)), ht_ * abs(math.sin(a_)) ** e_)
           for a_ in np.linspace(np.pi, 0.0, 11)] + [(hw_, v_) for v_ in (-0.030, -0.070, -0.112)]
    rimc, rimn, rimb = [], [], []
    for u_, v_ in uv_:
        p_ = front_hit(outer, u_, A.O[2] + v_)
        n_ = sdf_normals(outer, p_[None])[0]
        rimc.append(p_ - n_ * 0.004)
        rimn.append(n_)
    rimc, rimn = np.asarray(rimc), np.asarray(rimn)
    tg = np.gradient(rimc, axis=0)
    tg /= np.linalg.norm(tg, axis=1, keepdims=True)
    for i in range(len(rimc)):
        b_ = unit(np.cross(rimn[i], tg[i]))
        toward = A.O + A.U * min(0.05, max(-0.05, float((rimc[i] - A.O) @ A.U))) - rimc[i]
        rimb.append(b_ if b_ @ toward > 0 else -b_)
    rimb = np.asarray(rimb)
    angs = np.radians([-100.0, -45.0, 10.0, 66.0, 125.0])
    RV = np.array([[rimc[i] + r_ * (math.cos(a_) * rimn[i] + math.sin(a_) * rimb[i]) for a_ in angs] for i in range(len(rimc))])
    rim = MeshPart(RV.reshape(-1, 3), grid_tris(len(rimc), len(angs)))
    cen = rim.V[rim.T].mean(axis=1)
    nrm = np.cross(rim.V[rim.T[:, 1]] - rim.V[rim.T[:, 0]], rim.V[rim.T[:, 2]] - rim.V[rim.T[:, 0]])
    near_c = rimc[np.argmin(np.linalg.norm(cen[:, None, :] - rimc[None], axis=2), axis=1)]
    if (nrm * (cen - near_c)).sum() < 0:
        rim = MeshPart(rim.V, rim.T[:, ::-1])
    out.append(("hood_rim", rim, 1.0, "cloth", "bone:head", None))
    # the accent crown band (the Serenade hood mark): a broad band circling the dome horizontally at z 1.03, its lower
    # edge just over the rolled rim's top, an inlaid profile (edges sunk into the felt), snapped onto the dome's game mesh
    zb = 1.030
    pb = np.linspace(-np.pi, np.pi, 19)[:-1]
    band_c = np.array([surface_point(outer, (0.0, hc[1], zb), (math.cos(a_), math.sin(a_), 0.0), 0.05, 0.4) for a_ in pb])
    band_n = sdf_normals(outer, band_c)
    band = ribbon(band_c, band_n, 0.0185, SEAM_BAND, closed=True)
    out.append(("crown_band", band, 1.0, "accent", "bone:head", None))
    # THE THROAT: one clean inked tube from just behind the rim's inner curl (its floor on the collar's sill) back to a
    # round cap deep in the dome
    rings = []
    for inset, extra in SE_THROAT:
        uu, vv = door_outline(A.kw["hw"], A.kw["ht"], A.kw.get("nt", 2.0), SE_FLOOR - A.O[2], 20, inset)
        ring = []
        for u_, v_ in zip(uu, vv):
            z_ = A.O[2] + v_
            p_ = front_hit(outer, float(np.clip(u_, -0.19, 0.19)), z_)
            ring.append(np.array([u_, p_[1] + extra, z_]))
        rings.append(np.asarray(ring))
    out.append(("throat", throat_mesh(rings, A.to3(0.0, 0.010, SE_THROAT_CAP), A.to3(0.0, 0.03, 0.08)), 1.0, "ink",
                "bone:head", None))
    # THE HOOD LIGHT (its falloff painted on the throat round it)
    lc = A.to3(*SE_LIGHT)
    rx, rd, rz = SE_LIGHT_R
    out.append(("hood_light", ellipsoid_mesh(lc, A.X, -A.N, A.U, rx, rd, rz, seg=8, rings=6), 1.0, "accent", "bone:head",
                None))

    # ARMS (chunky banded felt sleeves widening to the cuff, big mittens: review item 12), LEGS
    _arm_parts(F, out, (0.064, 0.066, 0.078), (0.074, 0.068, 0.090), "ironstone", "cuff", (76, 50, 76))
    _legs_boots(out, (0.062, 0.088, 0.046), 0.036, tris=60)

    # SHIELD (left hand, the guard): a low ironstone dome 0.44 m with a rim, four sandstone pads, lampresin ring, accent boss
    c, n, t, up = shield_frame(F)
    R = F["shield_r"]
    axl = np.stack([t, up, n])

    def dome_prof(r, z):
        face = 0.008 + 0.040 * (1 - np.clip(r / R, 0, 1) ** 2)
        return np.maximum(np.maximum(r - R, -0.022 - z), z - face)
    sh = Sculpt("shield")
    sh.add(Lathe(tuple(c), dome_prof, R + 0.01, -0.03, 0.06, axes=axl).displaced(felt(0.002, 16.0), 0.002), k=0.0)
    sh.add(Torus(tuple(c + n * 0.004), R - 0.010, 0.020, axes=axl, rz=0.019), k=0.005)
    sh.add(Ellipsoid(tuple(c - n * 0.024), (0.10, 0.05, 0.012), axes=axl), k=0.012)
    disc = lathe(c, axl, [(0.0, -0.034), (0.11, -0.025), (R - 0.005, -0.020), (R + 0.010, 0.004), (R - 0.004, 0.022),
                          (R - 0.022, 0.018), (0.12, 0.034), (0.0, 0.049)], 18)
    out.append(("shield", (sh, disc), 0.8, "ironstone", "bone:hand.L", None))
    # four big sandstone pads filling the face between the boss ring and the iron rim (review 2026-10-27b item 9: the
    # small round buttons were ~40 % of the concept's pads): rounded rectangles 9.6 x 13.2 cm lying ON the dome
    pads = None
    pad_frames = []
    face = lambda r_: 0.008 + 0.040 * (1 - min(r_ / R, 1.0) ** 2)                          # noqa: E731
    PR, PHA, PHB = 0.137, 0.048, 0.066
    for ang in (90.0, 0.0, 270.0, 180.0):
        a = math.radians(ang)
        d2 = t * math.cos(a) + up * math.sin(a)
        e1 = np.cross(n, d2)
        pm = pad_mesh(c, n, t, up, R, face, PR, ang, PHA, PHB, seg=12)
        pads = pm if pads is None else pads + pm
        pad_frames.append((c + d2 * PR + n * (face(PR) + 0.012), e1, d2, (PHB, PHA)))
    out.append(("shield_pads", pads, 1.0, "sandstone", "bone:hand.L", None))
    ring = lathe(c + n * 0.044, axl, [(0.080, 0.000), (0.068, 0.021), (0.054, 0.008)], 12)
    out.append(("shield_ring", ring, 1.0, "lampresin", "bone:hand.L", None))
    boss = lathe(c + n * 0.046, axl, [(0.057, 0.0), (0.053, 0.015), (0.039, 0.029), (0.020, 0.037), (0.0, 0.040)], 10)
    out.append(("shield_boss", boss, 1.0, "accent", "bone:hand.L", None))

    # LANTERN-MACE (right hand): walnut haft, a squat round caged lantern (review 2026-10-27 item 1: the decimated cage
    # sculpt broke into crumpled flaps and a shard, the lampresin globe hid behind it and its accent core was a strap
    # round the outside). Built as turned and swept game meshes: an ironstone base cup, a LAMPRESIN bowl (the culture's
    # amber resin) holding the lit globe, the globe itself the ACCENT light (14 cm, the brightest thing on the figure
    # as in the concept), four ironstone cage bars over it and a domed ironstone lid with a round knob
    G = np.asarray(F["G"]["R"])
    u = F["mace_u"]
    fr = np.stack([unit(np.cross((0.0, -1.0, 0.0), u)), np.array([0.0, -1.0, 0.0]), u])
    at = lambda s: G + u * s                                                                 # noqa: E731
    haft = Sculpt("haft")
    haft.add(Capsule(tuple(at(-0.13)), tuple(at(0.07)), 0.023), k=0.0)
    haft.add(RoundCone(tuple(at(-0.165)), tuple(at(-0.12)), 0.030, 0.022), k=0.012)
    out.append(("haft", haft, 0.8, "wood_dark", "bone:hand.R", 42))
    gc = at(0.152)
    base = lathe(at(0.062), fr, [(0.022, -0.012), (0.038, 0.002), (0.045, 0.020), (0.0, 0.026)], 8)
    lid = lathe(gc + u * 0.050, fr, [(0.0, -0.004), (0.075, -0.002), (0.068, 0.021), (0.037, 0.038), (0.015, 0.046),
                                     (0.022, 0.059), (0.0, 0.071)], 8)
    bars = None
    for az in (45.0, 135.0, 225.0, 315.0):
        a_ = math.radians(az)
        rad_d = fr[0] * math.cos(a_) + fr[1] * math.sin(a_)
        C_ = [gc + 0.079 * (math.cos(e) * rad_d + math.sin(e) * u) for e in np.radians(np.linspace(-26, 46, 3))]
        b_ = tube(np.asarray(C_), 0.0088, sides=4, ref=rad_d, taper=False)
        bars = b_ if bars is None else bars + b_
    out.append(("lantern", base + bars, 1.0, "ironstone", "bone:hand.R", None))
    out.append(("lantern_lid", lid, 1.0, "ironstone", "bone:hand.R", None))
    # the lampresin cup under the globe: a small amber foot only (review 2026-10-27b item 9: the bowl wrapped the lower
    # half of the lit globe, which read as a half-filled two-tone ball)
    bowl = lathe(gc, fr, [(0.0, -0.086), (0.040, -0.078), (0.057, -0.061), (0.050, -0.052)], 8)
    out.append(("lantern_bowl", bowl, 1.0, "lampresin", "bone:hand.R", None))
    globe = lathe(gc, fr, [(0.0, -0.063), (0.047, -0.046), (0.065, -0.010), (0.064, 0.021), (0.047, 0.048), (0.0, 0.063)], 9)
    out.append(("lantern_core", globe, 1.0, "accent", "bone:hand.R", None))

    _GEOM["serenade"] = {
        "stitches": [("cloak", ring_on(cloak_p, z_, 60, 0.02), True, 0.0, 0.010, 0.006, 0.0032, 1.55) for z_ in (0.252, 0.193, 0.160)]
                    + [("hood", band_c, True, 0.040, 0.009, 0.006, 0.0028, 0.62),
                       ("mantle", mhem, False, 0.0, 0.009, 0.006, 0.0028, 0.66)],
        "mat_aux": {"haft": tuple(u)},
        "carve": carve,
        "arch": A,
        "rim_line": (rimc, r_),
        "rim_tube": (rimc, rimn, rimb, r_),
        "shield_frame": (c, n, t, up), "shield_R": R,
        "bands": [("cloak", 0.205, 0.240, "#2E2723"), ("cloak", -1.0, 0.148, "#2E2723")],
        "pads": pad_frames,
        "light": (SE_LIGHT, SE_LIGHT_R),
        "sdf": {"cloak": cloak_p, "hood": Blend([("add", outer, 0.0), ("sub", carve, 0.012)]),
                "mantle": mantle_p, "collar": collar_f, "shield": Blend([(op, p_, k_) for op, p_, k_, _ in sh.ops])},
        "inklines": [(("hood",), band_c, True, 0.0, 0.0300, 0.26)],
    }
    return out


def cull_hidden(low, faction: str, log=print) -> int:
    """Delete the hood game mesh's faces nobody sees (review 2026-10-27 item 2: the inked carved interior and the
    underside took a large share of the 1024 atlas and ~10 % of the hood's tris): faces on the carved cavity more than
    3 cm behind the opening plane (the dark lining covers them) and downward faces under the flare (inside the scarf /
    collar)."""
    import bmesh
    geo = _GEOM.get(faction) or {}
    carve, A = geo.get("carve"), geo.get("arch")
    if carve is None:
        return 0
    zlow = {"aubade": 0.70, "serenade": 0.76}[faction]
    bm = bmesh.new()
    bm.from_mesh(low.data)
    bm.faces.ensure_lookup_table()
    C = np.array([tuple(f.calc_center_median()) for f in bm.faces])
    Nf = np.array([tuple(f.normal) for f in bm.faces])
    d = carve.d(C)
    u, v, w = A.uvw(C)
    # fix round 3: the throat (a closed inked tube from under the frame's inner edge to its back cap) covers everything
    # inside the frame, so every hood face inside the frame's inner edge and behind its face goes (the decimated carve's
    # edge was the crumpled lip), and every carved face behind the opening plane
    g0 = AU_GLOW[0] if faction == "aubade" else SE_RIM[0]
    kill = (((A.f2(u, v) < g0 - 0.002) & (w > -0.012) & (w < 0.045)) | ((np.abs(d) < 0.014) & (w > 0.0))
            | ((Nf[:, 2] < -0.70) & (C[:, 2] < zlow)))
    bmesh.ops.delete(bm, geom=[f for f, k in zip(bm.faces, kill) if k], context="FACES")
    bm.to_mesh(low.data)
    bm.free()
    low.data.update()
    log(f"cull hidden {low.name}: {int(kill.sum())} faces")
    return int(kill.sum())


def make_low(high, name, col, tris, vox):
    """The game mesh of one part: the sculpt decimated to `tris`; where that stalls (surface nets leave non-manifold
    edges on thin shells, which stop the collapse decimator) a voxel remesh first, then the decimation."""
    import bpy
    from common import mesh
    low = mesh.duplicate(high, f"{name}_low", col)
    if mesh.decimate_to(low, tris, symmetric=False) <= tris * 1.1:
        low.data.polygons.foreach_set("use_smooth", np.ones(len(low.data.polygons), dtype=bool))
        return low
    me = low.data
    bpy.data.objects.remove(low)
    bpy.data.meshes.remove(me)
    low = mesh.duplicate(high, f"{name}_low", col)
    m = low.modifiers.new("remesh", "REMESH")
    m.mode = "VOXEL"
    m.voxel_size = max(0.0035, vox)
    m.adaptivity = 0.0
    mesh.apply_modifiers(low)
    mesh.decimate_to(low, tris, symmetric=False)
    low.data.polygons.foreach_set("use_smooth", np.ones(len(low.data.polygons), dtype=bool))
    return low


# ── projection: plates graded for glow, then the palette fit (brief §5.2) ─────────────────────────────────
# Painted-median targets per part (hex, strength). The painting carries its own light, so a part's MEDIAN lands
# a step under its palette albedo (brief §2.3): lit planes then read at the palette value on screen instead of
# blowing out under the game sun. The Aubade hood keeps the concept's blue linen (L* 67, 21 % sat) rather than the
# near-white #BFC6CC (a pale hood read badly and too close to the banned look); the Serenade felt keeps its sand
# warmth inside the marigold band's 40 % limit.
AUBADE_CHALK = ("#CBC7BD", 0.9)                  # chalk #D6D3CA, a step down
# The value law (brief §2.4, measured ON SCREEN at the 52-degree camera: top quarter L* 70-85, middle 45-65, feet
# 30-38). Review 2026-10-21 item 3: the Aubade read as one pale blue-white mass (middle 66-73, bottom 54-73), so the
# Aubade wool is a deeper blue-grey slate (#4E5D70, under the palette's #6E7A86: the painting's lit planes read
# about 20 L* over the albedo under the game sun) and both cloaks darken down the RAMP below; the Serenade felt
# is a deeper, warmer sand (item 12: #B0916C lit up as bone-white cream; #94795A is 39 % sat, inside the marigold
# band's 40 % limit).
PALETTE_FIT = {
    # fix round 3 (the team read for every viewer + the B5 value rebase: hoods at L* <= 65, under the fighters): the
    # linen a quieter, darker cool grey (#727880: L* 50, 11 % sat - toward the palette's cloth2, 208 deg / 6 %), so the
    # viewer-tinted accent stands off it by value AND chroma under the ally azure; the wool a step less saturated
    "aubade": {"hood": ("#727880", 0.95), "scarf": ("#5F6670", 0.85),
               "cloak": ("#4A5562", 0.95)},
    # the Serenade dome (review 2026-10-21b item 5: on screen bone #D0C5B1, 15 % sat - the old fit's median included
    # the dark carved hollow, so the dome itself was lifted far over the target): fitted on its OUTER felt only
    # review 2026-10-27 item 10: the concept's caramel felt (concept dome median #B88957, 53 % sat) at the marigold
    # band's 40 % limit, fitted hue-preserving ("tone")
    # fix round 3: the caramel felt sat at 43 % inside the marigold band (the brief's limit is 40 %) and read weakly under
    # the enemy tint: a sand felt at 30 % / L* 56 (#968069), the umber cloak 32 %
    "serenade": {"hood": ("#86735F", 0.95, "tone"), "cloak": ("#6B5749", 0.95, "tone")},
}
# fit medians measured on part of a part only: {part: "outer"} = texels outside the carved hollow
FIT_MASK = {"aubade": {"hood": "outer"}, "serenade": {"hood": "outer"}}
# PROC: painted procedurally in the palette colour (proc_paint: key light, mottle; median = the colour). The small
# hard parts and trims, where the concept's few pixels projected as smudges and rim-light streaks (item 6), and the
# parts the guard moved away from where the concept paints them (the left arm and the shield).
#   part: (hex, light, mottle)
_ACH = "#C9C5BB"                                  # chalk #D6D3CA, a step down (the paint carries its own light)
_ACH_HOOD = "#A5A197"                             # the hood's chalk (frame, knob): L* 66, the hood under L* 65 on screen
PROC = {
    "aubade": {"hood_rim": (_ACH_HOOD, 0.55, 0.05), "stole": (_ACH, 0.55, 0.05), "scarf": ("#65707D", 0.6, 0.06), "shield": ("#B8B4AA", 0.55, 0.05), "shield_rib": ("#BEBAB0", 0.6, 0.04),
               "lantern": (_ACH, 0.55, 0.05), "lantern_mullion": (_ACH, 0.55, 0.04), "knob": ("#ABA79D", 0.6, 0.04), "wraps_R": ("#BCB7AD", 0.5, 0.06),
               "wraps_L": ("#BCB7AD", 0.5, 0.06), "haft": ("#B2A48C", 0.5, 0.07),
               "sleeve_R": ("#4D5866", 0.5, 0.06), "sleeve_L": ("#4D5866", 0.5, 0.06),
               "mitt_R": ("#66727F", 0.55, 0.07), "mitt_L": ("#66727F", 0.55, 0.07),
               "boot_R": ("#2F3034", 0.5, 0.06), "boot_L": ("#2F3034", 0.5, 0.06)},
    "serenade": {"mantle": ("#9A866F", 0.45, 0.07), "collar": ("#54453A", 0.55, 0.12),
                 "sleeve_R": ("#6E5A4C", 0.5, 0.08), "sleeve_L": ("#6E5A4C", 0.5, 0.08),
                 "cuff_R": ("#3F3530", 0.5, 0.08), "cuff_L": ("#3F3530", 0.5, 0.08),
                 "mitt_R": ("#6A5546", 0.55, 0.10), "mitt_L": ("#6A5546", 0.55, 0.10), "hood_rim": ("#5A4A3D", 0.55, 0.10),
                 "boot_R": ("#3D3028", 0.5, 0.08), "boot_L": ("#3D3028", 0.5, 0.08),
                 "shield": ("#504439", 0.5, 0.12), "haft": ("#5A4436", 0.5, 0.08),
                 "lantern": ("#4B4039", 0.5, 0.08), "lantern_lid": ("#4E4239", 0.55, 0.08)},
}
# FOLDS: painted folds from the sculpt normals (shade_folds): part: (key light gain, valley occlusion)
FOLDS = {"aubade": {"cloak": (1.35, 0.45), "hood": (1.1, 0.35), "scarf": (1.0, 0.35), "stole": (0.7, 0.3),
                    "shield": (0.45, 0.20)},
         "serenade": {"cloak": (1.35, 0.45), "mantle": (1.25, 0.42), "hood": (0.9, 0.28), "collar": (1.0, 0.40),
                      "shield": (0.5, 0.20)}}
# BRUSH: brush strokes (brush): part: (amount, z stretch (< 1 = long vertical strokes), frequency)
BRUSH = {"aubade": {"cloak": (0.16, 0.22, 9.0), "hood": (0.09, 0.5, 10.0), "scarf": (0.08, 0.6, 12.0), "sleeve_R": (0.09, 0.6, 14.0),
                    "sleeve_L": (0.09, 0.6, 14.0), "stole": (0.06, 0.3, 12.0)},
         "serenade": {"cloak": (0.15, 0.30, 9.0), "mantle": (0.11, 0.6, 11.0), "hood": (0.08, 1.0, 10.0), "sleeve_R": (0.09, 0.6, 14.0),
                      "sleeve_L": (0.09, 0.6, 14.0), "collar": (0.08, 1.0, 12.0)}}
# (fix round 3: the dawnglass round the boss and the lantern core is a DEEP glass - pale blue glass right round an
# azure-tinted core hid it for the west viewer; dark glass frames it for every tint)
FLAT = {"aubade": {"leg_R": "#3A3F47", "leg_L": "#3A3F47", "shield_ring": "#4F6276",
                   "lantern_pane": "#55687C", "throat": "#0B0E12"},
        "serenade": {"leg_R": "#3B302A", "leg_L": "#3B302A", "shield_ring": "#A97F4C", "lantern_bowl": "#B98C55",
                     "throat": "#120E0A"}}
# RAMP: value multipliers (linear light) by height, per part, after the fit: light top, dark feet (brief §2.4, the
# "gradient ramp" the hem band alone could not deliver). [(z, mul)], interpolated, clamped at the ends.
RAMP = {
    "aubade": {"cloak": [(0.10, 0.30), (0.20, 0.38), (0.32, 0.58), (0.46, 0.86), (0.56, 1.0)],
               "hood": [(0.62, 0.52), (0.72, 0.64), (0.84, 0.85), (0.95, 1.0)],
               "hood_rim": [(0.64, 0.70), (0.78, 0.84), (0.92, 1.0)],
               "stole": [(0.12, 0.24), (0.22, 0.34), (0.34, 0.56), (0.48, 0.80), (0.58, 1.0)],
               "shield": [(0.30, 0.66), (0.50, 0.84), (0.72, 0.96)],
               "sleeve_R": [(0.38, 0.85), (0.50, 1.0)], "sleeve_L": [(0.38, 0.85), (0.50, 1.0)]},
    "serenade": {"cloak": [(0.11, 0.48), (0.20, 0.56), (0.30, 0.74), (0.44, 0.94), (0.54, 1.0)],
                 "shield": [(0.30, 0.82), (0.60, 1.0)]},
}
# CLEAN: projection ghosts (review 2026-10-21 item 8: the concept's arms, cuffs, wraps and haft painted onto the
# cloak where the model has open cloth) - texels far from their part's median in value (dL* above / below) or colour
# (Delta ab) are refilled from the part's own clean paint.   part: (dL* above, dL* below, Delta ab)
_CL = (16.0, 22.0, 14.0)
CLEAN = {
    "aubade": {k: _CL for k in ("cloak", "scarf")},
    "serenade": {k: _CL for k in ("cloak",)},
}
# SIDES: texels facing +-X sample the front / back plates at a grazing angle (the same plate pixel streaks across
# them); on these parts they take the part's own paint by height (the median of its front / back-facing texels in
# 3 cm bands) with a soft felt / linen mottle.
SIDES = {"aubade": ("cloak", "hood", "scarf"),
         "serenade": ("cloak", "hood")}
# ARM ZONES: where the concept paints the arms, fists, cuffs, the mace haft and (since the guard moved it) the shield
# over the cloak, the model shows open cloak: those texels take the same paint-by-height field;
# per part (|x| where the zone starts, |x| where it is full, z low, z high)
ZONES = {"aubade": {"cloak": (0.060, 0.120, 0.14, 0.62), "hood": "chin"},
         "serenade": {"cloak": (0.070, 0.130, 0.16, 0.60)}}
GLOW = {"aubade": (0.85, 0.20), "serenade": (0.80, 0.50)}
# hollow_ink by depth behind the opening plane: "rim" {part: (w0, w1)}, "carve" {part: (pad, w0, w1)}
HOLLOW = {"aubade": {"rim": {"hood_rim": (0.002, 0.018)},
                     "carve": {"hood": (0.012, -0.010, 0.0), "scarf": (0.030, -0.06, -0.05)},
                     "open": {"hood": (-0.006, -0.016, 0.004, 0.016)},
                     "ink": "#1A1E25", "carve_ink": "#141A24"},
          "serenade": {"carve": {"hood": (0.012, -0.028, -0.012), "collar": (0.022, -0.06, -0.05)},
                       "open": {"hood": (0.010, 0.0, -0.040, -0.022), "collar": (0.010, 0.0, -0.025, -0.005)},
                       "ink": "#2A2119", "carve_ink": "#1C150F"}}
TOPS_FULL = {"aubade": {"hood": (-0.20, 0.40)}, "serenade": {"hood": (0.10, 0.45)}}
# DESPECKLE: texels much paler than their part (the concept's background / rim light caught at the cut edge: a white
# patch on the Serenade cloak under the mace arm, a pale lantern-lid tip) are refilled from their own part's paint.
#   part: (L* above the part median, max saturation)
_DS_W = (22.0, 0.30)
DESPECKLE = {
    "aubade": {k: (28.0, 0.30) for k in ("cloak", "scarf")} | {"hood": (26.0, 0.25)},
    "serenade": {k: _DS_W for k in ("cloak", "hood")},
}


# Painted glow and painted accent lines to erase before projecting (brief §4, §5.4): accent geometry carries all the
# light, so the concept's painted halos, flame, lantern panes, boss glow and seams are refilled from the paint
# round them. Region-limited (model metres on each plate) so the Serenade's ochre pads and mantle keep their colour.
#   (sides, ("rect", x0, x1, z0, z1) | ("ell", cx, cz, rx, rz), test(r, g, b, v, s) -> mask)
ERASE = {
    "aubade": [
        (("front",), ("ell", -0.02, 0.778, 0.142, 0.121), lambda r, g, b, v, s: v > 0.30),               # hood flame
        (("front",), ("rect", -0.26, 0.22, 0.84, 1.12), lambda r, g, b, v, s: (b - r > 0.05) & (v > 0.74)),  # seams
        (("back",), ("rect", -0.06, 0.06, 0.66, 1.12), lambda r, g, b, v, s: (b - r > 0.05) & (v > 0.70)),
        (("front", "back"), ("rect", -0.48, -0.25, 0.46, 0.70), lambda r, g, b, v, s: (b - r > 0.06) & (v > 0.55)),  # panes
        (("front",), ("rect", 0.17, 0.34, 0.36, 0.52), lambda r, g, b, v, s: (b - r > 0.05) & (v > 0.55)),  # boss
    ],
    "serenade": [
        (("front", "back"), ("rect", -0.25, 0.25, 0.87, 1.10),
         lambda r, g, b, v, s: ((s > 0.38) & (v > 0.70) & (r > b)) | (v > 0.86)),                          # band
        (("front",), ("ell", 0.0, 0.80, 0.138, 0.143), lambda r, g, b, v, s: v > 0.30),                  # hood glow
        (("front", "back"), ("rect", -0.48, -0.28, 0.44, 0.64), lambda r, g, b, v, s: (s > 0.45) & (v > 0.55)),  # globe
        (("front",), ("rect", 0.24, 0.38, 0.36, 0.51), lambda r, g, b, v, s: v > 0.55),                  # boss
    ],
}


def erase_plates(concept: str, src_tag: str, out_tag: str, height: float, rules: list, edge: int = 0) -> str:
    """Copy <concept>_<src_tag> plates to <concept>_<out_tag> with the rule regions refilled (nearest kept paint,
    softened), and the outer `edge` px of the figure cut (the concept's pale rim-light outline, which the default
    9 px erosion leaves on the Serenade sheet) re-padded from inside. Returns the new concept id. Cached on the
    source mtime + rules + edge."""
    import json
    cache = os.path.join(scene.CACHE_DIR, "concept")
    sid, oid = f"{concept}_{src_tag}", f"{concept}_{out_tag}"
    meta = json.load(open(os.path.join(cache, f"{sid}_plates.json")))
    import inspect
    src = [repr((sides, shape)) + inspect.getsource(test).strip() for sides, shape, test in rules]
    key = [os.path.getmtime(os.path.join(cache, f"{sid}_{s_}.png")) for s_ in ("front", "back")] + [src, edge, 5]
    done = os.path.join(cache, f"{oid}_plates.json")
    if os.path.isfile(done) and json.load(open(done)).get("erase") == key:
        return oid
    keep = project.load_rgb(os.path.join(cache, f"{concept}_mask.png"))[..., 0] > 0.5
    if edge:
        inner = project.blur(keep.astype(np.float32), edge * 0.6) > 0.985
    for side in ("front", "back"):
        img = np.clip(project.load_rgb(os.path.join(cache, f"{sid}_{side}.png")), 0, 1)
        H, W = img.shape[:2]
        if edge:
            iy, ix = project.nearest_index(inner)
            img = np.where(inner[..., None], img, project.blur(img[iy, ix], 2.0))
        info = meta[side]
        k = (info["ground"] - info["top"]) / height
        sign = 1.0 if side == "front" else -1.0
        yy, xx = np.mgrid[0:H, 0:W]
        X = (xx + 0.5 - info["cx"]) * sign / k
        Z = (info["ground"] - (yy + 0.5)) / k
        half = (xx < W // 2) if side == "front" else (xx >= W // 2)
        r, g, b = img[..., 0], img[..., 1], img[..., 2]
        v = img.max(axis=2)
        sat = (v - img.min(axis=2)) / np.maximum(v, 1e-4)
        m = np.zeros((H, W), dtype=bool)
        for sides, shape, test in rules:
            if side not in sides:
                continue
            if shape[0] == "rect":
                _, x0, x1, z0, z1 = shape
                reg = (X >= x0) & (X <= x1) & (Z >= z0) & (Z <= z1)
            else:
                _, cx, cz, rx, rz = shape
                reg = ((X - cx) / rx) ** 2 + ((Z - cz) / rz) ** 2 <= 1.0
            m |= reg & half & test(r, g, b, v, sat)
        if m.any():
            m = project.blur(m.astype(np.float32), 1.5) > 0.05
            iy, ix = project.nearest_index(~m)
            fill = project.blur(img[iy, ix], 3.0)
            a = project.blur(m.astype(np.float32), 1.5)[..., None]
            img = img * (1 - a) + fill * a
        project.save_rgb(np.clip(img, 0, 1), os.path.join(cache, f"{oid}_{side}.png"))
    with open(done, "w") as f:
        json.dump(dict(meta, id=oid, erase=key), f, indent=2)
    scene.log(f"erased plates {oid}: {len(rules)} rules")
    return oid


# TOP PLATES (HANDOFF Art 2.0 step 3): the 52-degree camera reads the hood crown first, and a front/back projection
# streaks the silhouette's top-edge highlight across every near-flat top (it painted the crowns near-white). Each
# listed part's top takes a painted field instead: the part's own cloth (median of a clean plate region, so the fit
# below still lands it on the palette), the concept's key light from front-left, posterised brush patches, and
# soft radial folds (Aubade linen) or felt mottling (Serenade).
#   part: (ext m, [(side, x0, x1, z0, z1) sample regions], folds, mottle)
TOPS = {
    "aubade": {"hood": (0.30, [("back", -0.16, -0.05, 0.76, 0.96), ("back", 0.05, 0.16, 0.76, 0.96)], 9, 0.0),
               "cloak": (0.32, [("back", -0.20, 0.20, 0.28, 0.50)], 0, 0.0),
               "scarf": (0.30, [("back", -0.18, 0.18, 0.60, 0.66)], 0, 0.0)},
    "serenade": {"hood": (0.30, [("back", -0.15, 0.15, 0.80, 0.96)], 0, 0.05),
                 "collar": (0.32, [("back", -0.20, 0.20, 0.68, 0.79)], 0, 0.06),
                 "mantle": (0.34, [("back", -0.20, 0.20, 0.585, 0.665)], 0, 0.05),
                 "cloak": (0.36, [("back", -0.20, 0.20, 0.25, 0.50)], 0, 0.04)},
}


def top_plates(concept: str, height: float, spec: dict, seed: int = 5) -> dict:
    """Write art/.cache/concept/<concept>_top_<part>.png for each part in `spec` (X, Y in [-ext, ext], image up =
    +Y = the back); returns the PROJECTION["tops"] dict {part: (file, ext)}."""
    import json
    cache = os.path.join(scene.CACHE_DIR, "concept")
    meta = json.load(open(os.path.join(cache, f"{concept}_plates.json")))
    plates = {sd: project.load_rgb(os.path.join(cache, f"{concept}_{sd}.png")) for sd in ("front", "back")}
    rng = np.random.default_rng(seed)
    N = 512
    out = {}
    for name, (ext, regions, nfolds, mottle) in spec.items():
        px = []
        for side, x0, x1, z0, z1 in regions:
            info = meta[side]
            k = (info["ground"] - info["top"]) / height
            sign = 1.0 if side == "front" else -1.0
            xs = sorted((info["cx"] + sign * x0 * k, info["cx"] + sign * x1 * k))
            ys = sorted((info["ground"] - z1 * k, info["ground"] - z0 * k))
            px.append(plates[side][int(ys[0]):int(ys[1]), int(xs[0]):int(xs[1])].reshape(-1, 3))
        px = np.concatenate(px, axis=0)
        base = np.median(px, axis=0)
        spread = np.clip(np.percentile(px.mean(axis=1), 80) - np.percentile(px.mean(axis=1), 20), 0.02, 0.12)
        i, j = np.mgrid[0:N, 0:N]
        X = (j + 0.5) / N * 2 * ext - ext
        Y = (1 - (i + 0.5) / N) * 2 * ext - ext
        lit = 1.0 + 0.11 * np.clip((-X * 0.6 - Y * 0.8) / (0.6 * ext), -1, 1)
        blot = project.blur(rng.standard_normal((N, N)).astype(np.float32), 10.0)
        blot = np.round(blot / (np.abs(blot).max() + 1e-6) * 3) / 3
        field = lit * (1.0 + 0.6 * spread * blot)
        if mottle:
            m = project.blur(rng.standard_normal((N, N)).astype(np.float32), 2.5)
            field *= 1.0 + mottle * m / (np.abs(m).max() + 1e-6)
        if nfolds:
            ang = np.arctan2(Y - 0.035, X + 0.02)
            r = np.hypot(X + 0.02, Y - 0.035)
            f = np.abs(np.sin(ang * nfolds * 0.5 + 0.7 + 0.4 * project.blur(rng.standard_normal((N, N)).astype(np.float32), 30.0) * 40))
            field *= 1.0 - 0.07 * (1 - f) ** 3 * np.clip((r - 0.05) / 0.08, 0, 1)
        img = np.clip(base[None, None, :] * field[..., None], 0, 1)
        img = project.blur(img, 1.0)
        rel = f"{concept}_top_{name}.png"
        project.save_rgb(img, os.path.join(cache, rel))
        out[name] = (rel, ext)
    scene.log(f"top plates {concept}: {sorted(out)}")
    return out


def _lin(c):
    c = np.asarray(c, dtype=np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def palette_fit(img, maps, names, fit: dict, masks=None, carve=None, log=print):
    """Each listed part's painted median moves onto its palette colour, per channel in linear light, by
    `strength` (0 keeps the painting, 1 lands exactly on the palette); the painted detail rides along.
    masks {part: "outer"}: the median is taken over the part's texels outside the carved hollow only."""
    part = maps["part"]
    iy, ix = project.nearest_index(part >= 0)
    pid = part[iy, ix]
    lin = _lin(img)
    out = lin.copy()
    masks = masks or {}
    for name, spec_ in fit.items():
        hexcol, strength = spec_[0], spec_[1]
        mode = spec_[2] if len(spec_) > 2 else "gain"
        if name not in names:
            continue
        i = names.index(name)
        own = part == i
        if not own.any():
            continue
        ref = own
        if masks.get(name) == "outer" and carve is not None:
            idx = np.nonzero(own)
            d = carve.d(maps["P"][idx].astype(np.float64))
            ref = np.zeros_like(own)
            ref[idx[0][d > 0.02], idx[1][d > 0.02]] = True
        med = np.median(lin[ref], axis=0)
        tgt = _lin(scene.hex_srgb(hexcol))
        if mode == "tone":
            # hue-preserving (review 2026-10-27 item 10: the per-channel gain multiplied the Serenade felt's blue by 2.2,
            # so every lit plane of the dome went bone / cream): the texel takes the TARGET colour at its own relative
            # luminance, keeping 35 % of the painting's own hue drift
            wl = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
            sel = pid == i
            Y = np.maximum(lin[sel] @ wl, 1e-5)
            Ym = float(np.median(np.maximum(lin[ref] @ wl, 1e-5)))
            cdir = lin[sel] / Y[:, None]
            cm = np.median(lin[ref] / np.maximum(lin[ref] @ wl, 1e-5)[:, None], axis=0)
            cvar = 1.0 + 0.35 * (cdir / np.maximum(cm, 1e-4) - 1.0)
            out[sel] = (tgt[None, :] * (Y / Ym)[:, None] * cvar).astype(np.float32)
            log(f"  palette fit {name}: median {np.round(_srgb(med), 3).tolist()} -> {hexcol} (tone)")
            continue
        gain = np.clip((tgt / np.maximum(med, 1e-4)) ** strength, 0.2, 5.0)
        out[pid == i] = lin[pid == i] * gain
        log(f"  palette fit {name}: median {np.round(_srgb(med), 3).tolist()} -> {hexcol} x{strength} gain {np.round(gain, 2).tolist()}")
    return _srgb(out).astype(np.float32)


def tops_full(img, maps, names, spec: dict, tops: dict, log=print):
    """Re-blend a part's top plate with a LOWER normal threshold than common.hifi.project.paint (n_z 0.55-0.85):
    the whole crown of a dome takes the painted field, so the back plate's erased-band fill and its rim highlight
    (a pale patch on the Serenade dome's back) never reach the 52-degree camera.  spec {part: (nz_lo, nz_hi)}.
    The top plate is first gained to the projection's mean colour inside the blend band, so the hand-over leaves no
    value step (a hard horizontal step showed across the Aubade hood back)."""
    from common.hifi import project as pj
    cache = os.path.join(scene.CACHE_DIR, "concept")
    P, N, part = maps["P"], maps["N"], maps["part"]
    out = img.copy()
    for name, (lo, hi) in spec.items():
        if name not in names or name not in tops:
            continue
        sel = part == names.index(name)
        f, ext = tops[name]
        top = pj.load_rgb(os.path.join(cache, f))
        th, tw = top.shape[:2]
        p = P[sel]
        tcol = pj.bilinear(top, (p[:, 0] + ext) / (2 * ext) * tw, (1 - (p[:, 1] + ext) / (2 * ext)) * th)
        w = np.clip((N[sel][:, 2] - lo) / (hi - lo), 0, 1)
        band = (w > 0.1) & (w < 0.6) & (N[sel][:, 1] > 0.3)                # the back of the dome (not the hollow)
        gain = np.ones(3, dtype=np.float32)
        if band.sum() > 200:
            gain = np.clip(out[sel][band].mean(axis=0) / np.maximum(tcol[band].mean(axis=0), 1e-3), 0.75, 1.33)
            tcol = tcol * gain[None, :]
        w = (w * w * (3 - 2 * w))[:, None]
        out[sel] = out[sel] * (1 - w) + tcol * w
        log(f"  tops_full {name}: n_z {lo}-{hi}, {int(sel.sum())} texels, top gain {np.round(gain, 3).tolist()}")
    return out


def _lstar(img):
    Y = _lin(img) @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    return np.where(Y > 0.008856, 116.0 * np.cbrt(Y) - 16.0, 903.3 * Y)


def despeckle(img, maps, names, spec: dict, log=print):
    """Refill texels far paler than their part's median and nearly grey (the concept's background or rim light
    caught at the cut edge) from the nearest clean texel of the same part. spec {part: (dL*, max saturation)}."""
    part = maps["part"]
    L = _lstar(img)
    mx, mn = img.max(axis=2), img.min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1e-4)
    out = img.copy()
    for name, (dl, smax) in spec.items():
        if name not in names:
            continue
        own = part == names.index(name)
        if not own.any():
            continue
        lm = float(np.median(L[own]))
        bad = own & (L > lm + dl) & (sat < smax)
        if not bad.any():
            continue
        bad = own & (project.blur(bad.astype(np.float32), 1.0) > 0.08)
        ys, xs = np.nonzero(own)
        H = part.shape[0]
        side = int(max(ys.max() - ys.min(), xs.max() - xs.min())) + 1      # a square crop (jump flooding wants one)
        y0, x0 = min(int(ys.min()), H - side), min(int(xs.min()), H - side)
        y1, x1 = y0 + side, x0 + side
        ok = (own & ~bad)[y0:y1, x0:x1]
        if not ok.any():
            continue
        iy, ix = project.nearest_index(ok)
        crop = out[y0:y1, x0:x1]
        fill = project.blur(crop[iy, ix], 1.5)
        b = bad[y0:y1, x0:x1]
        crop[b] = fill[b]
        out[y0:y1, x0:x1] = crop
        log(f"  despeckle {name}: L* median {lm:.0f}, {int(b.sum())} pale texels refilled")
    return out


def _lab(img):
    """sRGB 0..1 (..., 3) -> L*, a*, b* (D65)."""
    lin = _lin(img)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]], dtype=np.float32)
    xyz = (lin @ M.T) / np.array([0.95047, 1.0, 1.08883], dtype=np.float32)
    f = np.where(xyz > 0.008856, np.cbrt(np.maximum(xyz, 0.0)), 7.787 * xyz + 16.0 / 116.0)
    return 116.0 * f[..., 1] - 16.0, 500.0 * (f[..., 0] - f[..., 1]), 200.0 * (f[..., 1] - f[..., 2])


def _refill(out, part, own, bad, blur=1.5):
    """Refill the `bad` texels of one part (mask `own`) from its nearest clean texel (softened)."""
    ys, xs = np.nonzero(own)
    H = part.shape[0]
    side = int(max(ys.max() - ys.min(), xs.max() - xs.min())) + 1      # a square crop (jump flooding wants one)
    y0, x0 = min(int(ys.min()), H - side), min(int(xs.min()), H - side)
    y1, x1 = y0 + side, x0 + side
    ok = (own & ~bad)[y0:y1, x0:x1]
    if not ok.any():
        return 0
    iy, ix = project.nearest_index(ok)
    crop = out[y0:y1, x0:x1]
    fill = project.blur(crop[iy, ix], blur)
    b = bad[y0:y1, x0:x1]
    crop[b] = fill[b]
    out[y0:y1, x0:x1] = crop
    return int(b.sum())


def _profile_fill(cols, p, good, band=0.03):
    """Per texel: the median colour of the part's `good` texels in its height band (3 cm bins, interpolated), with
    a soft felt / linen mottle: a 3D-consistent fill (a nearest-texel fill in UV space jumps across islands and left
    angular patches). None when there are too few good texels."""
    z = p[:, 2]
    zc, prof = [], []
    for z0 in np.arange(z.min() - band / 2, z.max() + band, band):
        m = good & (z >= z0) & (z < z0 + band)
        if m.sum() >= 8:
            zc.append(z0 + band / 2)
            prof.append(np.median(cols[m], axis=0))
    if len(zc) < 2:
        return None
    zc, prof = np.asarray(zc), np.asarray(prof)
    tgt = np.stack([np.interp(z, zc, prof[:, k]) for k in range(3)], axis=1)
    pp = p.astype(np.float64)
    mott = 1.0 + 0.05 * NOISE(pp, 14.0)[:, None] + 0.03 * NOISE(pp + 3.1, 41.0)[:, None]
    return (tgt * mott).astype(np.float32)


def clean(img, maps, names, spec: dict, log=print):
    """Refill projection ghosts: texels of a part far from its median in value or colour (another part's paint
    landing where the concept's arm / cuff / haft overlapped open cloth). spec {part: (dL hi, dL lo, dab)}."""
    part = maps["part"]
    L, A, B = _lab(img)
    out = img.copy()
    for name, (dhi, dlo, dab) in spec.items():
        if name not in names:
            continue
        own = part == names.index(name)
        if not own.any():
            continue
        lm, am, bm = (float(np.median(c[own])) for c in (L, A, B))
        bad = own & ((L > lm + dhi) | (L < lm - dlo) | (np.hypot(A - am, B - bm) > dab))
        if not bad.any():
            continue
        bad = own & (project.blur(bad.astype(np.float32), 1.2) > 0.08)
        idx = np.nonzero(own)
        b = bad[idx]
        fill = _profile_fill(out[idx], maps["P"][idx], ~b)
        if fill is None:
            continue
        soft = project.blur(bad.astype(np.float32), 1.0)[idx][:, None]           # feathered edge
        cur = out[idx]
        out[idx] = cur * (1 - soft) + fill * soft
        log(f"  clean {name}: L* {lm:.0f} ab ({am:.0f}, {bm:.0f}), {int(b.sum())} ghost texels refilled")
    return out


def side_soften(img, maps, names, parts, zones=None, log=print):
    """Sideways texels (normal near +-X) of the listed parts take the part's own paint by height: the median colour
    of its front / back-facing texels in 3 cm bands, with a soft mottle (no grazing-projection streaks). `zones`
    {part: (x0, x1, z0, z1)} extends that to the part's flanks |x| > x0 (full at x1) between z0 and z1."""
    zones = zones or {}
    P, N, part = maps["P"], maps["N"], maps["part"]
    out = img.copy()
    for name in parts:
        if name not in names:
            continue
        sel = part == names.index(name)
        if sel.sum() < 50:
            continue
        p, n = P[sel], N[sel]
        st = np.abs(n[:, 0]) / (np.abs(n[:, 0]) + np.abs(n[:, 1]) + 1e-6)
        w = sstep(0.55, 0.88, st) * (1.0 - sstep(0.55, 0.85, np.abs(n[:, 2])))
        good = st < 0.45
        if name == "hood":
            good &= n[:, 1] > 0.25                        # the back: the front half holds the hollow's dark paint
        if zones.get(name) == "chin":
            # the cowl's front below the frame (review 2026-10-27 item 8: a pale smear - the concept's scarf and stole
            # tops projected onto the linen there)
            u_, v_, w_ = AU_ARCH.uvw(p)
            wz = sstep(-0.02, -0.08, p[:, 1]) * sstep(0.71, 0.68, p[:, 2]) * sstep(0.056, 0.066, AU_ARCH.f2(u_, v_))
            w = np.maximum(w, wz)
            good &= ~(wz > 0.05)
        elif name in zones:
            x0, x1, z0, z1 = zones[name]
            ax, zz = np.abs(p[:, 0]), p[:, 2]
            wz = sstep(x0, x1, ax) * sstep(z0, z0 + 0.05, zz) * sstep(z1, z1 - 0.05, zz)
            w = np.maximum(w, wz)
            good &= ~((ax > x0) & (zz > z0) & (zz < z1))
        if good.sum() < 30 or not (w > 0.01).any():
            continue
        cols = out[sel]
        tgt = _profile_fill(cols, p, good)
        if tgt is None:
            continue
        ww = w[:, None].astype(np.float32)
        out[sel] = cols * (1 - ww) + tgt * ww
        log(f"  side soften {name}: {int((w > 0.5).sum())} side texels")
    return out


def ramp(img, maps, names, spec: dict, log=print):
    """Value ramp by height (linear light) per part: spec {part: [(z, mul), ...]}."""
    P, part = maps["P"], maps["part"]
    lin = _lin(img)
    for name, keys in spec.items():
        if name not in names:
            continue
        sel = part == names.index(name)
        zs, ms = zip(*keys)
        lin[sel] = lin[sel] * np.interp(P[sel][:, 2], zs, ms)[:, None].astype(np.float32)
        log(f"  ramp {name}: x{min(ms)}-{max(ms)} over z {min(zs)}-{max(zs)}")
    return _srgb(lin).astype(np.float32)


def shield_paint(img, maps, names, geo: dict, log=print):
    """Serenade shield (review 2026-10-21 item 5: the concept's ochre pads projected beside the 3D pad nubs, so every
    pad showed twice): the dome's ochre texels are refilled from its own ironstone paint, and the pads are painted
    on their own geometry: sandstone, a dark groove loop at 55-65 % of the pad radius (the concept's carved loop),
    darker bevelled edges, a soft mottle."""
    pads = geo.get("pads")
    part = maps["part"]
    out = img.copy()
    if "shield" in names and geo.get("dome", True):
        own = part == names.index("shield")
        mx, mn = img.max(axis=2), img.min(axis=2)
        sat = (mx - mn) / np.maximum(mx, 1e-4)
        bad = own & (sat > 0.36) & (mx > 0.30) & (img[..., 0] > img[..., 2])
        bad = own & (project.blur(bad.astype(np.float32), 1.5) > 0.06)
        log(f"  shield dome: {_refill(out, part, own, bad, 2.0)} pad-paint texels refilled")
    if pads and "shield_pads" in names:
        sel = part == names.index("shield_pads")
        P = maps["P"][sel].astype(np.float64)
        best = np.full(len(P), 1e9)
        X = np.zeros(len(P))
        Y = np.zeros(len(P))
        for pc, e1, d2, (ra, rb) in pads:
            q = P - pc
            x, y = q @ e1 / ra, q @ d2 / rb
            r = (np.abs(x) ** 3 + np.abs(y) ** 3) ** (1.0 / 3.0)        # the pads' rounded-rectangle outline
            m = r < best
            best[m], X[m], Y[m] = r[m], x[m], y[m]
        r = best
        base = _lin(scene.hex_srgb("#AE9A7C"))[None, :].astype(np.float32)
        k = np.ones(len(P))
        k *= 1.0 - 0.55 * sstep(0.08, 0.0, np.abs(r - 0.60))            # the groove loop
        k *= 1.0 - 0.32 * sstep(0.80, 1.05, r)                           # bevelled edge
        k *= 1.0 + 0.10 * sstep(0.55, 0.15, r) * np.clip(-Y, 0, 1)        # a lit upper-inner face
        k *= 1.0 + 0.07 * NOISE(P, 30.0)
        col = base * k[:, None].astype(np.float32)
        out[sel] = _srgb(col).astype(np.float32)
        log(f"  shield pads painted: {int(sel.sum())} texels")
    return out


# ── paint v2 (review 2026-10-21b item 6: dirty smears, stretched streaks, flat gradients, no painted folds) ──────
# The concept projection stays the BASE of the big cloth areas (its hues and value design); on top of it the folds
# are PAINTED from the sculpt's own normals, brush strokes run along the cloth, and every small hard part (chalk
# frames, stole, shield faces, lantern frames, wraps, the Serenade collar, cuffs, iron) is painted procedurally in
# its palette colour, because the concept's few pixels there projected as grey smudges and rim-light streaks.
KEY_L = unit((-0.45, -0.55, 0.70))               # the concepts' key light: upper left, from the front


def _part_idx(maps, names, name):
    if name not in names:
        return None
    sel = maps["part"] == names.index(name)
    return np.nonzero(sel) if sel.any() else None


def _texel_normals(prim, p, e=0.002):
    return np.concatenate([sdf_normals(prim, c, e) for c in np.array_split(p, max(1, len(p) // 50000 + 1))])


def shade_folds(img, maps, names, spec: dict, sdfs: dict, log=print):
    """Painted folds: the sculpt's normal at each texel (its SDF gradient) lit by the key light, against the game
    mesh's smooth normal - the lit plane of every fold lifts, its shadow plane darkens (linear light), and the valleys
    take a soft occlusion (how far the sculpt normal turns from the smooth one). spec {part: (light, occlusion)}."""
    lin = _lin(img)
    for name, (kl, ko) in spec.items():
        idx = _part_idx(maps, names, name)
        if idx is None or name not in sdfs:
            continue
        p = maps["P"][idx].astype(np.float64)
        nl = maps["N"][idx].astype(np.float64)
        nl /= np.linalg.norm(nl, axis=1, keepdims=True) + 1e-9
        nh = _texel_normals(sdfs[name], p)
        dl = np.clip(nh @ KEY_L - nl @ KEY_L, -0.6, 0.6)
        dev = np.clip(1.0 - (nh * nl).sum(axis=1), 0.0, 0.5)
        g = (1.0 + kl * dl) * (1.0 - ko * dev / 0.5)
        lin[idx] = lin[idx] * g[:, None].astype(np.float32)
        log(f"  folds {name}: light x{kl} occ x{ko}, {len(p)} texels, gain {np.percentile(g, 5):.2f}-{np.percentile(g, 95):.2f}")
    return _srgb(lin).astype(np.float32)


def brush(img, maps, names, spec: dict, log=print):
    """Brush strokes: noise stretched along the stroke direction (vertical on the cloaks, round on felt), posterised
    into a few value steps like loaded-brush dabs. spec {part: (amount, stretch z, freq)}."""
    lin = _lin(img)
    for name, (amt, sz, fq) in spec.items():
        idx = _part_idx(maps, names, name)
        if idx is None:
            continue
        p = maps["P"][idx].astype(np.float64) * np.array([1.0, 1.0, sz])
        nz = NOISE.fbm(p, fq, 3) * 1.6
        nz = np.round(np.clip(nz, -1, 1) * 2.0) / 2.0 * 0.6 + 0.4 * np.clip(nz, -1, 1)
        lin[idx] = lin[idx] * (1.0 + amt * nz)[:, None].astype(np.float32)
        log(f"  brush {name}: x{amt}")
    return _srgb(lin).astype(np.float32)


def proc_paint(img, maps, names, spec: dict, log=print):
    """Replace a part's painting with its palette colour, lit by the key light (soft half-Lambert + a top lift), a
    fine mottle and darkened silhouette edges; its median lands on the colour. spec {part: (hex, light, mottle)}."""
    out = img.copy()
    for name, (hexcol, kl, mot) in spec.items():
        idx = _part_idx(maps, names, name)
        if idx is None:
            continue
        p = maps["P"][idx].astype(np.float64)
        n = maps["N"][idx].astype(np.float64)
        n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-9
        lam = 0.5 + 0.5 * (n @ KEY_L)
        sh = (1.0 - kl) + kl * (0.55 + 0.75 * lam ** 1.4 + 0.12 * np.clip(n[:, 2], 0, 1))
        sh *= 1.0 + mot * (0.7 * NOISE.fbm(p, 38.0, 2) + 0.3 * NOISE(p, 110.0))
        sh /= np.median(sh)
        base = _lin(scene.hex_srgb(hexcol))
        out[idx] = _srgb(base[None, :] * sh[:, None]).astype(np.float32)
        log(f"  proc {name}: {hexcol} light {kl} mottle {mot}")
    return out


def au_rim_paint(img, maps, names, geo: dict, log=print):
    """The Aubade frame's carved relief (brief §2.1 'a shallow scroll relief', the concept's carved chalk frame; review
    2026-10-27 item 7: the fine 7 cm wave read as a net / barbed wire): a BROAD running scroll - one wave groove with a
    lit upper lip, 15 cm long waves running from the brow centre down both sides, a round carved boss in each bay -
    between raised border fillets, block joints at the brow corners and under the chin; the bevels lit / shaded.
    Value multipliers on the chalk paint."""
    idx = _part_idx(maps, names, "hood_rim")
    if idx is None:
        return img
    A = geo["arch"]
    g0 = AU_GLOW[0]
    lin = _lin(img)
    p = maps["P"][idx].astype(np.float64)
    u, v, w = A.uvw(p)
    d_in = A.f2(u, v)
    al = np.mod(np.arctan2(v, u) + np.pi / 2, 2 * np.pi) - np.pi / 2       # -pi/2 (chin) .. 3pi/2
    wv = au_rim_w(al)
    s = np.clip((d_in - g0) / wv, -0.3, 1.3)                          # 0 inner edge .. 1 outer edge
    alg = np.linspace(-np.pi / 2, 3 * np.pi / 2, 721)
    bu, bv = A.boundary(alg, g0 + au_rim_w(alg) / 2)
    cum = np.concatenate([[0.0], np.cumsum(np.hypot(np.diff(bu), np.diff(bv)))])
    ell = np.interp(al, alg, cum)
    e = np.abs(ell - float(np.interp(np.pi / 2, alg, cum)))            # metres from the brow centre, both ways
    face = (w < 0.0).astype(np.float64)
    k = np.ones(len(p))
    # raised border fillets (a step lighter) and the grooves inside them
    k *= 1.0 + 0.07 * face * (sstep(0.17, 0.13, s) + sstep(0.83, 0.87, s))
    k *= 1.0 - 0.42 * face * (sstep(0.045, 0.015, np.abs(s - 0.155)) + sstep(0.045, 0.015, np.abs(s - 0.845)))
    # the running scroll
    lam = 0.150
    sc = 0.50 + 0.17 * np.sin(2 * np.pi * e / lam)
    g = (s - sc) * wv                                                # metres across the band from the wave
    # (review 2026-10-27b item 6: the groove read as faint thin doodle loops - a broader, deeper cut, a brighter lip)
    k *= 1.0 - 0.66 * face * sstep(0.0085, 0.0040, np.abs(g))
    k *= 1.0 + 0.34 * face * sstep(0.0055, 0.0018, np.abs(g - 0.0105))      # the lit upper lip
    k *= 1.0 - 0.20 * face * sstep(0.0055, 0.0018, np.abs(g + 0.0105))      # the shaded lower lip
    # a carved VOLUTE curling out of the wave in each bay (fix round 3, review 2026-10-27c: the raised bosses with a
    # ring groove read as a doodled chain of 'o' circles): a spiral groove that leaves the wave on the bay's side and
    # winds 1.2 turns inward, its lit lip on the outside of each turn, a small raised eye at its heart - with the wave,
    # a running scroll
    for ph_, sv, turn in ((0.25, 0.32, 1.0), (0.75, 0.68, -1.0)):
        ec = (np.round(e / lam - ph_) + ph_) * lam
        de, ds = e - ec, (s - sv) * wv
        rho = np.hypot(de, ds)
        a0 = math.pi / 2 if sv < 0.5 else -math.pi / 2                  # start: toward the wave
        th = np.mod(turn * (np.arctan2(ds, de) - a0), 2 * np.pi)       # 0 .. 2 pi along the winding
        best = np.full(len(p), 1.0)
        for wind in range(2):
            tt = th + wind * 2 * np.pi
            R = 0.0118 - 0.0062 * np.clip(tt / (2.4 * np.pi), 0, 1)
            best = np.where(tt <= 2.4 * np.pi, np.minimum(best, np.abs(rho - R)), best)
        k *= 1.0 - 0.62 * face * sstep(0.0026, 0.0010, best) * sstep(0.0175, 0.0150, rho)
        k *= 1.0 + 0.26 * face * sstep(0.0018, 0.0006, np.abs(best - 0.0034)) * sstep(0.0175, 0.0150, rho) \
            * (1.0 - sstep(0.0026, 0.0010, best))
        k *= 1.0 + 0.24 * face * sstep(0.0042, 0.0026, rho)            # the volute's raised eye

    # block joints: at the brow corners and under the chin
    for aj in np.radians([40.0, 140.0, -90.0]):
        dj = np.abs(np.angle(np.exp(1j * (al - aj)))) * 0.15
        k *= 1.0 - 0.45 * face * sstep(0.0035, 0.0010, dj)
    # bevels: the outer edge lit on top / shaded below, the inner bevel shaded (it steps down to the light)
    k *= 1.0 + 0.12 * (1 - face) * np.clip(np.sin(al), 0, 1) - 0.18 * (1 - face) * np.clip(-np.sin(al), 0, 1)
    lin[idx] = lin[idx] * k[:, None].astype(np.float32)
    log(f"  frame relief (broad scroll): {len(p)} texels")
    return _srgb(lin).astype(np.float32)


def se_rim_paint(img, maps, names, geo: dict, log=print):
    """The Serenade arch's rolled felt rim (brief §2.2 'a dark felt rim'; review 2026-10-27b item 1): the sculpted roll
    a step darker than the dome, a soft groove where it meets the dome, its crest catching a little light."""
    idx = _part_idx(maps, names, "hood")
    if idx is None or geo.get("rim_line") is None:
        return img
    pts, r = geo["rim_line"]
    lin = _lin(img)
    p = maps["P"][idx].astype(np.float64)
    lo, hi = pts.min(axis=0) - 0.05, pts.max(axis=0) + 0.05
    near = np.all((p >= lo) & (p <= hi), axis=1) & (p[:, 1] < -0.05)
    k = np.ones(len(p))
    d = polyline_dist(p[near], pts)
    A = geo["arch"]
    u, v, _ = A.uvw(p[near])
    outside = sstep(SE_RIM[0] - 0.002, SE_RIM[0] + 0.004, A.f2(u, v))      # the dome side of the roll
    band = sstep(r + 0.010, r + 0.003, d)
    groove = sstep(0.005, 0.0, np.abs(d - (r + 0.006))) * outside
    kk = (1.0 - 0.24 * band) * (1.0 - 0.38 * groove)
    k[near] = kk
    lin[idx] = lin[idx] * k[:, None].astype(np.float32)
    log(f"  felt rim: {int((band > 0.5).sum())} texels")
    return _srgb(lin).astype(np.float32)


def shield_face_paint(img, maps, names, geo: dict, faction: str, log=print):
    """Shield detail after the procedural paint: Aubade - the chalk face turned in shallow concentric rings, a lit
    outer bevel, the back a step darker with a pale rim (the off side's read of the guard); Serenade - the iron rim
    worn lighter on its crown with dark rivets every 45 degrees, the back dark iron with a lit rim edge."""
    idx = _part_idx(maps, names, "shield")
    if idx is None:
        return img
    c, n, t, up = geo["shield_frame"]
    R = geo["shield_R"]
    lin = _lin(img)
    p = maps["P"][idx].astype(np.float64)
    q = p - c
    zl = q @ n
    r = np.hypot(q @ t, q @ up)
    ang = np.arctan2(q @ up, q @ t)
    nn = maps["N"][idx].astype(np.float64)
    facing = nn @ n
    k = np.ones(len(p))
    back = facing < -0.3
    if faction == "aubade":
        k *= 1.0 + 0.05 * np.sin(2 * np.pi * r / 0.032) * (facing > 0.3) * (r < R - 0.03)
        k *= 1.0 + 0.10 * sstep(R - 0.035, R - 0.012, r) * (facing > 0.0)
        k = np.where(back, 0.72 * (1.0 + 0.35 * sstep(R - 0.04, R - 0.01, r)), k)
    else:
        rim = sstep(R - 0.042, R - 0.030, r)
        k *= 1.0 + 0.45 * rim * np.clip(facing + 0.2, 0, 1)
        # the dome laid in stone plates (the concept's cracked ironstone): Voronoi cells, dark joints, each plate its
        # own value, lit on its upper edge
        rng = np.random.default_rng(11)
        sa = rng.uniform(0, 2 * np.pi, 14)
        sr = np.sqrt(rng.uniform(0.02, 1.0, 14)) * (R - 0.045)
        S2 = np.stack([sr * np.cos(sa), sr * np.sin(sa)], axis=1)
        q2 = np.stack([q @ t, q @ up], axis=1)
        dist = np.linalg.norm(q2[:, None, :] - S2[None, :, :], axis=2)
        o2 = np.sort(dist, axis=1)
        cell = np.argmin(dist, axis=1)
        joint = sstep(0.0045, 0.0015, o2[:, 1] - o2[:, 0])
        inner = (r < R - 0.040) & (facing > 0.2)
        k *= np.where(inner, (1.0 - 0.55 * joint) * (1.0 + 0.09 * rng.uniform(-1, 1, 14)[cell]), 1.0)
        riv = np.abs(np.angle(np.exp(1j * (ang * 8.0)))) / 8.0 * r       # metres along the rim to the nearest rivet
        rd = np.hypot(riv, r - (R - 0.014))
        k *= 1.0 - 0.60 * rim * sstep(0.0105, 0.0075, rd) * sstep(0.0025, 0.0050, rd)
        k *= 1.0 + 0.55 * rim * sstep(0.0055, 0.0025, np.hypot(riv + 0.002, r - (R - 0.012)))
        k = np.where(back, 0.85 * (1.0 + 0.6 * sstep(R - 0.04, R - 0.01, r)), k)
    lin[idx] = lin[idx] * k[:, None].astype(np.float32)
    log(f"  shield face {faction}: {len(p)} texels, back {int(back.sum())}")
    return _srgb(lin).astype(np.float32)


def boot_paint(img, maps, names, log=print):
    """The boots (review 2026-10-27 item 11: dark balls): a lighter welt round the sole, a crease over it, a lit toe cap
    and a darker heel."""
    lin = _lin(img)
    for s_, sx in (("R", -1.0), ("L", 1.0)):
        idx = _part_idx(maps, names, f"boot_{s_}")
        if idx is None:
            continue
        p = maps["P"][idx].astype(np.float64)
        a = math.radians(sx * 10.0)
        fwd = np.array([math.sin(a), -math.cos(a), 0.0])
        along = (p - np.array([sx * ANKLE_X, -0.025, 0.0])) @ fwd
        z = p[:, 2]
        k = 1.0 + 0.55 * sstep(0.017, 0.009, z) - 0.40 * sstep(0.0055, 0.0, np.abs(z - 0.020))
        k *= 1.0 + 0.30 * sstep(0.035, 0.080, along) * sstep(0.024, 0.045, z) - 0.15 * sstep(-0.03, -0.07, along)
        lin[idx] = lin[idx] * k[:, None].astype(np.float32)
    log("  boots painted")
    return _srgb(lin).astype(np.float32)


def collar_rolls(img, maps, names, geo: dict, log=print):
    """The Serenade collar reads as two stacked felt rolls (the concept): a soft dark crease round the roll's middle
    and a lit upper roll."""
    idx = _part_idx(maps, names, "collar")
    if idx is None:
        return img
    lin = _lin(img)
    p = maps["P"][idx].astype(np.float64)
    ax = sdf.axes_from_rot(sdf.rot_x(11.0))
    q = (p - np.array([0.0, 0.012, 0.738])) @ ax.T
    zl = q[:, 2]
    rr = np.hypot(q[:, 0], q[:, 1])
    out = rr > 0.165
    k = (1.0 - 0.38 * out * sstep(0.012, 0.0, np.abs(zl - 0.004))) * (1.0 + 0.10 * sstep(0.0, 0.05, zl))
    lin[idx] = lin[idx] * k[:, None].astype(np.float32)
    log(f"  collar rolls: {len(p)} texels")
    return _srgb(lin).astype(np.float32)


def hollow_ink(img, maps, names, spec: dict, geo: dict, log=print):
    """Ink the hollow by DEPTH behind the opening plane (the arch frame's w): spec "rim" {part: (w0, w1)} - faces
    turning into the opening (the Aubade frame's inner wall) shade to "ink" between w0 and w1; spec "carve"
    {part: (pad, w0, w1)} - texels on or inside the carved cavity (carve.d < pad: the hood's own carved surface, the
    scarf cut) shade to "carve_ink" between depths w0 and w1 (the Serenade felt rolls over the edge before it goes
    dark). The lining (the "hollow" part) is painted flat ink."""
    A, carve = geo["arch"], geo["carve"]
    ink = np.asarray(scene.hex_srgb(spec["ink"]), dtype=np.float32)
    cink = np.asarray(scene.hex_srgb(spec["carve_ink"]), dtype=np.float32)
    out = img.copy()
    for name, (w0, w1) in spec.get("rim", {}).items():
        idx = _part_idx(maps, names, name)
        if idx is None:
            continue
        _, _, w = A.uvw(maps["P"][idx].astype(np.float64))
        wt = sstep(w0, w1, w)[:, None].astype(np.float32)
        out[idx] = out[idx] * (1 - wt) + ink[None, :] * wt
        log(f"  hollow ink {name}: {int((wt > 0.5).sum())} texels")
    for name, (pad, w0, w1) in spec.get("carve", {}).items():
        idx = _part_idx(maps, names, name)
        if idx is None:
            continue
        p = maps["P"][idx].astype(np.float64)
        d = np.concatenate([carve.d(c) for c in np.array_split(p, max(1, len(p) // 20000 + 1))])
        _, _, w = A.uvw(p)
        wt = (sstep(pad, pad - 0.006, d) * sstep(w0, w1, w))[:, None].astype(np.float32)
        out[idx] = out[idx] * (1 - wt) + cink[None, :] * wt
        log(f"  hollow carve ink {name}: {int((wt > 0.5).sum())} texels")
    # "open" {part: (f_out, f_in, w0, w1)}: every texel SEEN THROUGH the opening - inside the arch outline (f2 < f_out,
    # full by f_in) and behind the front (depth w0 -> w1) - takes the carve ink (review 2026-10-27b item 1: the rolled
    # rim's inner side, the carved walls behind it and the floor's front edge stayed pale felt / a bronze sill lip)
    for name, (f0, f1, w0, w1) in spec.get("open", {}).items():
        idx = _part_idx(maps, names, name)
        if idx is None:
            continue
        p = maps["P"][idx].astype(np.float64)
        u, v, w = A.uvw(p)
        cav = carve.prims[1]                                         # (only in and round the hollow, not the dome's back)
        dc = np.concatenate([cav.d(c) for c in np.array_split(p, max(1, len(p) // 20000 + 1))])
        wt = (sstep(f0, f1, A.f2(u, v)) * sstep(w0, w1, w) * sstep(0.030, 0.015, dc))[:, None].astype(np.float32)
        out[idx] = out[idx] * (1 - wt) + cink[None, :] * wt
        log(f"  opening ink {name}: {int((wt > 0.5).sum())} texels")
    return out


# the painted half of the hood light's nested shell (fix round 3): team-neutral lamplight colour, its strength on the
# halo dish and on the throat walls, and the throat's lip (the hood cloth turning in over the edge before the ink)
# (build 1 of round 3: a pale #D2CEC6 halo at full strength read as a white ring round an iris - an eye; the lamplight
# is a dim neutral that only lifts the ink next to the core)
# (build 2: a halo DISH behind the core, lit by the room and floored in AO, still read as a grey ring round an iris; the
# dish is gone - the falloff lies on the throat's own walls and back, broad and dim, the spill of a lamp in a hood)
LIGHT_PAINT = {"aubade": {"lamp": "#8A867F", "walls": 0.75, "lip": ("#4A525D", (-0.006, 0.010))},
               "serenade": {"lamp": "#8B857C", "walls": 0.75, "lip": ("#433730", (-0.003, 0.008))}}


def hood_light_paint(img, maps, names, geo: dict, fac: str, log=print):
    """The hood light's soft falloff, painted (the accent is factor-only: one flat emissive per viewer, so the core
    itself cannot fade): the throat's walls and back round the core run from a dim team-neutral lamplight at the core's
    outline to the hollow's ink (light_falloff, measured in core radii, so the glow is wider than tall and dark stays
    above and below it). The throat is ink except its lip, the hood cloth rolling in over the opening's edge."""
    lc, lr = geo.get("light") or (None, None)
    A = geo.get("arch")
    if lc is None or A is None:
        return img
    cfg = LIGHT_PAINT[fac]
    inkc = _lin(scene.hex_srgb(HOLLOW[fac]["carve_ink"]))[None, :]
    lamp = _lin(scene.hex_srgb(cfg["lamp"]))[None, :]
    lin = _lin(img)
    idx = _part_idx(maps, names, "throat")
    if idx is not None:
        p = maps["P"][idx].astype(np.float64)
        u, v, w = A.uvw(p)
        lipc, (f0, f1) = cfg["lip"]
        lw = sstep(f0, f1, A.f2(u, v))
        if fac == "serenade":
            lw = lw * sstep(SE_FLOOR - A.O[2] + 0.004, SE_FLOOR - A.O[2] + 0.014, v)
        col = inkc * (1 - lw[:, None]) + _lin(scene.hex_srgb(lipc))[None, :] * lw[:, None]
        col = col * (1.0 + 0.10 * NOISE(p, 60.0))[:, None]
        gl = light_falloff((u, v, w), lc, lr) * cfg["walls"]
        col = col * (1 - gl[:, None]) + lamp * gl[:, None]
        lin[idx] = col.astype(np.float32)
        log(f"  throat: {len(p)} texels, lip {int((lw > 0.5).sum())}, lit {int((gl > 0.2).sum())}")
    return _srgb(lin).astype(np.float32)


def under_mantle(img, maps, names, log=print):
    """The Serenade cloak's top under the felt mantle is in its shadow (fix round 3: through the mantle's front V the
    projected paint showed as a pale wedge on the chest): it shades to a deep umber above the mantle's hem line."""
    idx = _part_idx(maps, names, "cloak")
    if idx is None or "mantle" not in names:
        return img
    lin = _lin(img)
    z = maps["P"][idx][:, 2].astype(np.float64)
    w = sstep(0.548, 0.585, z)[:, None]
    dark = _lin(scene.hex_srgb("#3A2F27"))[None, :]
    lin[idx] = (lin[idx] * (1 - w) + dark * w).astype(np.float32)
    log(f"  under mantle: {int((w > 0.5).sum())} cloak texels in its shadow")
    return _srgb(lin).astype(np.float32)


def rim_tube_paint(img, maps, names, geo: dict, log=print):
    """The Serenade's rolled felt rim (hand-built roll): dark felt, its crest catching a little light, a soft contact
    shadow where it sinks into the dome, and its inner side, curling into the opening, shading to the hollow's ink."""
    rt = geo.get("rim_tube")
    idx = _part_idx(maps, names, "hood_rim")
    if rt is None or idx is None:
        return img
    C, Nn, Bn, r = rt
    lin = _lin(img)
    p = maps["P"][idx].astype(np.float64)
    j = np.argmin(np.linalg.norm(p[:, None, :] - C[None], axis=2), axis=1)
    q = p - C[j]
    a = np.degrees(np.arctan2((q * Bn[j]).sum(axis=1), (q * Nn[j]).sum(axis=1)))
    k = (1.0 + 0.16 * sstep(-40.0, 0.0, a) * sstep(45.0, 10.0, a)) * (1.0 - 0.35 * sstep(-60.0, -95.0, a))
    ink = sstep(55.0, 112.0, a)
    inkc = _lin(scene.hex_srgb(HOLLOW["serenade"]["carve_ink"]))[None, :]
    col = lin[idx] * k[:, None].astype(np.float32)
    col = col * (1 - ink[:, None]) + inkc * ink[:, None]
    lin[idx] = col.astype(np.float32)
    log(f"  rim roll: {len(p)} texels, inner {int((ink > 0.5).sum())}")
    return _srgb(lin).astype(np.float32)


def paint_bands(img, maps, names, bands: list, log=print):
    """Paint horizontal cloth bands (the hem bands) onto a part by height, after the palette fit: each band texel
    takes the band colour times the painting's relative luminance there (its folds and brushwork stay)."""
    P, part = maps["P"], maps["part"]
    lin = _lin(img)
    out = lin.copy()
    Y = lin @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    for name, zlo, zhi, hexcol in bands:
        if name not in names:
            continue
        sel = part == names.index(name)
        z = P[sel][:, 2]
        w = (sstep(zlo - 0.0015, zlo + 0.0015, z) * sstep(zhi + 0.0015, zhi - 0.0015, z))[:, None]
        rel = np.clip(Y[sel] / max(float(np.median(Y[sel])), 1e-4), 0.55, 1.6) ** 0.7
        band = _lin(scene.hex_srgb(hexcol))[None, :] * rel[:, None]
        out[sel] = out[sel] * (1 - w) + band * w
        log(f"  band {name} z {zlo}-{zhi} {hexcol}: {int((w > 0.5).sum())} texels")
    return _srgb(out).astype(np.float32)


def ink_lines(img, maps, names, lines: list, log=print):
    """Dark grooves round the accent bands: host-part texels within [d_in, d_out] of a polyline are darkened to
    `mul` of their value (soft 4 mm edge), so the emissive reads on any cloth hue (review item 5)."""
    P, part = maps["P"], maps["part"]
    out = img.copy()
    for hosts, pts, closed, d0, d1, mul in lines:
        pts = np.asarray(pts, dtype=np.float64)
        lo, hi = pts.min(axis=0) - d1 - 0.01, pts.max(axis=0) + d1 + 0.01
        for h in hosts:
            if h not in names:
                continue
            sel = part == names.index(h)
            idx = np.nonzero(sel)
            p = P[idx].astype(np.float64)
            near = np.all((p >= lo) & (p <= hi), axis=1)
            if not near.any():
                continue
            d = polyline_dist(p[near], pts, closed)
            w = sstep(d1, d1 - 0.004, d)
            if d0 > 0:
                w = w * sstep(d0 - 0.003, d0, d)
            k = (1.0 - w * (1.0 - mul)).astype(np.float32)
            ii = (idx[0][near], idx[1][near])
            out[ii] = out[ii] * k[:, None]
            log(f"  ink line on {h}: {int((w > 0.5).sum())} texels")
    return out


def dilate_bake_maps(maps, names=None, rough=None, carve=None, log=print):
    """Fill the empty texels between UV islands of the in-flight roughness and AO bakes with their nearest island
    value. common.bake leaves them at 0 beyond its 8 px margin, and the ORM is then scaled 1024 -> 256: every small
    island's border mixes in roughness 0, which on the near-black hood lining showed as mirror-sharp environment
    reflections (pale shards in the hollow). Runs inside the base-colour hook, which bake_asset calls after the
    rough / AO bakes and before it packs them (it finds them by name: <tex>_rough, <tex>_ao at the atlas size).
    `rough` {part: value}: the roughness of whole parts (review 2026-10-27b items 1 and 5: the hollow's lining and the
    Serenade sill caught the environment as grey lit planes and a glossy bronze lip - they are matte felt / ink);
    {"hood_carved": v} applies to the hood texels on or inside the carved cavity (`carve`)."""
    import bpy
    has = maps["part"] >= 0
    size = maps["size"]
    iy, ix = project.nearest_index(has)
    for suffix in ("_rough", "_ao"):
        ims = [im for im in bpy.data.images if im.name.endswith(suffix) and tuple(im.size) == (size, size)]
        for im in ims:
            a = np.empty(size * size * 4, dtype=np.float32)
            im.pixels.foreach_get(a)
            a = a.reshape(size, size, 4)[::-1]                       # row 0 = top, as the maps
            a = a[iy, ix]
            if suffix == "_ao" and names and AO_FLOOR.get(fac_of(names)):
                for nm, val in AO_FLOOR[fac_of(names)].items():
                    if nm in names:
                        m = maps["part"] == names.index(nm)
                        a[m, :3] = np.maximum(a[m, :3], val)
                        log(f"  ao floor {nm}: {val} on {int(m.sum())} texels")
            if suffix == "_rough" and rough and names:
                for nm, val in rough.items():
                    if nm == "hood_carved":
                        if carve is None or "hood" not in names:
                            continue
                        sel = maps["part"] == names.index("hood")
                        idx = np.nonzero(sel)
                        p = maps["P"][idx].astype(np.float64)
                        d = np.concatenate([carve.d(c) for c in np.array_split(p, max(1, len(p) // 20000 + 1))])
                        m = np.zeros_like(sel)
                        m[idx] = d < 0.014
                    elif nm in names:
                        m = maps["part"] == names.index(nm)
                    else:
                        continue
                    a[m, :3] = val
                    log(f"  roughness {nm}: {val} on {int(m.sum())} texels")
            im.pixels.foreach_set(np.ascontiguousarray(a[::-1]).ravel())
            log(f"  dilated {im.name}: {int((~has).sum())} empty texels filled")


# ── paint v3 (review 2026-10-27 item 2: both wicks read as untextured clay - flat fills, smudgy gradients, no linen,
# felt, chalk or iron) ─────────────────────────────────────────────────────────────────────────────────────────────
# On top of the projected / procedural base and the painted folds, three hand-painted layers:
#   edges    - the sculpt's own curvature (the SDF's Laplacian at each texel): convex ridges and rims catch a lit edge,
#              creases and fold valleys take a dark cavity line (the value structure of a hand-painted texture);
#   texture  - each material's painted surface: linen threads, wool mottle, felt fuzz and fibre flecks, chalk grain and
#              pits, oxidised iron pitting, wood grain, waxed leather; small hue drifts so no field is one flat colour;
#   warmth   - lights a touch warmer, shadows cooler (Aubade) or deeper and redder (Serenade), by the key light.
MATERIAL = {
    "aubade": {"hood": "linen", "scarf": "linen", "cloak": "wool", "sleeve_R": "wool", "sleeve_L": "wool",
               "stole": "chalk", "hood_rim": "chalk", "knob": "chalk", "shield": "chalk", "shield_rib": "chalk",
               "lantern": "chalk", "lantern_mullion": "chalk", "wraps_R": "chalk", "wraps_L": "chalk",
               "haft": "wood", "mitt_R": "wool", "mitt_L": "wool", "boot_R": "leather", "boot_L": "leather",
               "shield_ring": "glass", "lantern_pane": "glass", "leg_R": "leather", "leg_L": "leather"},
    "serenade": {"hood": "felt", "mantle": "felt", "cloak": "felt", "collar": "felt", "sleeve_R": "felt", "sleeve_L": "felt",
                 "shield": "iron", "lantern": "iron", "lantern_lid": "iron", "cuff_R": "iron", "cuff_L": "iron",
                 "shield_pads": "sand", "haft": "wood", "mitt_R": "felt", "mitt_L": "felt", "hood_rim": "felt", "boot_R": "leather",
                 "boot_L": "leather", "shield_ring": "glass", "lantern_bowl": "glass", "leg_R": "leather", "leg_L": "leather"},
}
# texture strength per material (the first pass at x1 read as faint noise at close range)
MAT_AMP = {"linen": 2.0, "wool": 2.2, "felt": 2.4, "chalk": 1.6, "iron": 1.6, "sand": 1.5, "wood": 1.4, "leather": 1.5, "glass": 1.0}
# EDGES: part: (lit-edge gain, cavity darkening) from the sculpt curvature (parts with an SDF in _GEOM["sdf"])
EDGES = {"aubade": {"cloak": (0.22, 0.42), "hood": (0.20, 0.38), "scarf": (0.18, 0.36), "shield": (0.22, 0.30),
                    "stole": (0.14, 0.24)},
         "serenade": {"cloak": (0.20, 0.44), "hood": (0.18, 0.34), "mantle": (0.22, 0.42), "collar": (0.22, 0.44),
                      "shield": (0.24, 0.34)}}
# WARMTH: (light tint, shadow tint) per channel, scaled by how far the texel turns to / away from the key light
WARMTH = {"aubade": ((0.06, 0.02, -0.05), (-0.05, -0.01, 0.06)),
          "serenade": ((0.05, 0.02, -0.06), (0.03, -0.04, -0.08))}


def edges_paint(img, maps, names, spec: dict, sdfs: dict, log=print):
    """Lit edges and dark cavities from the sculpt's mean curvature (Laplacian of its SDF, 4 mm stencil)."""
    lin = _lin(img)
    e = 0.004
    for name, (ke, kc) in spec.items():
        idx = _part_idx(maps, names, name)
        if idx is None or name not in sdfs:
            continue
        prim = sdfs[name]
        p = maps["P"][idx].astype(np.float64)
        H = np.zeros(len(p))
        for ch in np.array_split(np.arange(len(p)), max(1, len(p) // 40000 + 1)):
            q = p[ch]
            d0 = prim.d(q)
            acc = -6.0 * d0
            for a in range(3):
                o = np.zeros(3)
                o[a] = e
                acc = acc + prim.d(q + o) + prim.d(q - o)
            H[ch] = acc / (e * e)
        k = (1.0 + ke * sstep(12.0, 70.0, H)) * (1.0 - kc * sstep(-12.0, -70.0, H))
        lin[idx] = lin[idx] * k[:, None].astype(np.float32)
        log(f"  edges {name}: {int((H > 40).sum())} ridge / {int((H < -40).sum())} crease texels")
    return _srgb(lin).astype(np.float32)


def _mat_k(kind: str, p, n, aux=None):
    """(value multiplier (N,), tint (N, 3) or None) of one material's painted surface at points p, normals n."""
    N_ = NOISE
    one = np.ones(len(p))
    if kind == "linen":
        streak = N_(p * np.array([140.0, 140.0, 22.0]), 1.0)
        k = one + 0.055 * streak + 0.030 * N_(p, 320.0) + 0.050 * N_.fbm(p, 9.0, 2)
        return k, None
    if kind == "wool":
        k = one + 0.070 * N_.fbm(p, 16.0, 3) + 0.045 * N_(p * np.array([80.0, 80.0, 24.0]), 1.0) + 0.030 * N_(p, 260.0)
        return k, None
    if kind == "felt":
        fuzz = N_(p, 230.0) + 0.6 * N_(p, 470.0)
        fleck = sstep(0.42, 0.62, N_(p + 3.7, 300.0))
        k = one + 0.075 * N_.fbm(p, 22.0, 3) + 0.050 * fuzz + 0.10 * fleck - 0.05 * sstep(0.40, 0.65, N_(p + 1.3, 140.0))
        drift = N_.fbm(p + 7.1, 7.0, 2)[:, None] * np.array([0.035, 0.0, -0.045])[None, :]
        return k, drift
    if kind == "chalk":
        pits = sstep(0.50, 0.66, N_(p + 7.0, 150.0))
        k = one + 0.040 * N_(p, 290.0) + 0.050 * N_.fbm(p, 28.0, 2) - 0.30 * pits - 0.07 * np.clip(N_.fbm(p + 2.0, 6.0, 2), 0, 1)
        drift = N_.fbm(p + 4.4, 8.0, 2)[:, None] * np.array([0.025, 0.010, -0.025])[None, :]
        return k, drift
    if kind == "iron":
        pits = sstep(0.42, 0.62, N_(p + 3.0, 190.0))
        k = one + 0.11 * N_.fbm(p, 20.0, 3) - 0.30 * pits + 0.05 * N_(p, 330.0)
        drift = np.clip(N_.fbm(p + 5.0, 8.0, 2), 0, 1)[:, None] * np.array([0.10, 0.03, -0.06])[None, :]
        return k, drift
    if kind == "sand":
        k = one + 0.06 * N_.fbm(p, 30.0, 2) - 0.18 * sstep(0.50, 0.68, N_(p + 9.0, 170.0)) + 0.03 * N_(p, 300.0)
        return k, None
    if kind == "wood":
        ax = np.asarray(aux if aux is not None else (0.0, 0.0, 1.0), dtype=np.float64)
        along = p @ ax
        across = p - along[:, None] * ax[None, :]
        q = across * 160.0 + along[:, None] * 9.0
        k = one + 0.10 * np.sin(N_(q, 1.0) * 6.0) + 0.04 * N_(p, 300.0)
        return k, None
    if kind == "leather":
        k = one + 0.07 * N_.fbm(p, 24.0, 2) + 0.03 * N_(p, 260.0) - 0.08 * sstep(0.45, 0.65, N_(p + 2.2, 90.0))
        return k, None
    if kind == "glass":
        lam = np.clip(n @ KEY_L, -1, 1) * 0.5 + 0.5
        hv = unit(KEY_L + np.array([0.0, -0.6, 0.8]))
        spec = sstep(0.86, 0.97, np.clip(n @ hv, -1, 1))
        k = 0.72 + 0.50 * lam ** 1.5 + 0.55 * spec
        return k, None
    return one, None


def texture_paint(img, maps, names, spec: dict, aux: dict | None = None, log=print):
    """Each listed part's material surface (MATERIAL) multiplied into its paint (linear light)."""
    lin = _lin(img)
    aux = aux or {}
    for name, kind in spec.items():
        idx = _part_idx(maps, names, name)
        if idx is None:
            continue
        p = maps["P"][idx].astype(np.float64)
        n = maps["N"][idx].astype(np.float64)
        n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-9
        k, tint = _mat_k(kind, p, n, aux.get(name))
        k = 1.0 + MAT_AMP.get(kind, 1.0) * (k - 1.0)
        col = lin[idx] * np.clip(k, 0.3, 2.0)[:, None].astype(np.float32)
        if tint is not None:
            col = col * (1.0 + tint).astype(np.float32)
        lin[idx] = col
    log(f"  texture: {len(spec)} parts")
    return _srgb(lin).astype(np.float32)


def polyline_near(p, pts, closed: bool = False, chunk: int = 4096):
    """(distance, arc length along the polyline at the nearest point) for each point p (N, 3)."""
    A = np.asarray(pts, dtype=np.float64)
    B = np.roll(A, -1, axis=0) if closed else A[1:]
    A = A if closed else A[:-1]
    AB = B - A
    L = np.sqrt(np.maximum((AB * AB).sum(axis=1), 1e-12))
    cum = np.concatenate([[0.0], np.cumsum(L)[:-1]])
    dist = np.empty(len(p))
    arc = np.empty(len(p))
    for st in range(0, len(p), chunk):
        q = p[st:st + chunk, None, :]
        t = np.clip(((q - A[None]) * AB[None]).sum(axis=2) / (L[None] ** 2), 0, 1)
        d = np.sqrt(((q - (A[None] + t[..., None] * AB[None])) ** 2).sum(axis=2))
        j = np.argmin(d, axis=1)
        r_ = np.arange(len(j))
        dist[st:st + chunk] = d[r_, j]
        arc[st:st + chunk] = cum[j] + t[r_, j] * L[j]
    return dist, arc


def stitches(img, maps, names, lines: list, log=print):
    """Painted running stitches (the crafted read at close range): dashes `dash` long with `gap` between, `width` wide,
    at `offset` m either side of a polyline (0 = on it), multiplying the paint by `mul` (> 1 pale thread, < 1 dark).
    lines: [(host, polyline, closed, offset, dash, gap, width, mul)]."""
    P, part = maps["P"], maps["part"]
    lin = _lin(img)
    for host, pts, closed, off, dash, gap, wd, mul in lines:
        if host not in names:
            continue
        pts = np.asarray(pts, dtype=np.float64)
        lo, hi = pts.min(axis=0) - off - 0.02, pts.max(axis=0) + off + 0.02
        idx = np.nonzero(part == names.index(host))
        p = P[idx].astype(np.float64)
        near = np.all((p >= lo) & (p <= hi), axis=1)
        if not near.any():
            continue
        d, arc = polyline_near(p[near], pts, closed)
        ph = np.mod(arc, dash + gap)
        m = sstep(wd * 0.5 + 0.0008, wd * 0.5 - 0.0004, np.abs(d - off)) * sstep(0.0, 0.0012, ph) * sstep(dash, dash - 0.0012, ph)
        k = 1.0 + (mul - 1.0) * m
        ii = (idx[0][near], idx[1][near])
        lin[ii] = lin[ii] * k[:, None].astype(np.float32)
        log(f"  stitches on {host}: {int((m > 0.5).sum())} texels")
    return _srgb(lin).astype(np.float32)


def ring_on(prim, z: float, n: int = 48, cy: float = 0.0) -> np.ndarray:
    """A horizontal ring of n points on a lathe-like prim at height z."""
    return np.array([surface_point(prim, (0.0, cy, z), (math.cos(a), math.sin(a), 0.0), 0.0, 0.6)
                     for a in np.linspace(0, 2 * np.pi, n + 1)[:-1]])


# FORM: the painted form light of the big shapes (hand-painted textures carry their own light: lit upper-left planes,
# a core shadow turning away, a sky lift on top), normalised so each part's median stays on its palette value.
#   part: strength
FORM = {"aubade": {"hood": 0.34, "cloak": 0.30, "scarf": 0.25, "stole": 0.22, "sleeve_R": 0.25, "sleeve_L": 0.25, "knob": 0.2},
        "serenade": {"hood": 0.36, "cloak": 0.30, "mantle": 0.30, "collar": 0.30, "sleeve_R": 0.25, "sleeve_L": 0.25}}


def form_light(img, maps, names, spec: dict, log=print):
    lin = _lin(img)
    for name, a in spec.items():
        idx = _part_idx(maps, names, name)
        if idx is None:
            continue
        n = maps["N"][idx].astype(np.float64)
        n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-9
        lam = np.clip(n @ KEY_L, -1, 1)
        g = 1.0 + a * (0.85 * lam + 0.35 * np.clip(n[:, 2], 0, 1) - 0.25 * np.clip(-n[:, 2], 0, 1))
        g = np.clip(g / np.median(g), 0.35, 2.0)
        lin[idx] = lin[idx] * g[:, None].astype(np.float32)
    log(f"  form light: {len(spec)} parts")
    return _srgb(lin).astype(np.float32)


def warmth(img, maps, names, faction: str, skip=(), log=print):
    """Lights warmer, shadows cooler / deeper (hand-painted colour temperature) by the texel's key light."""
    lt, sh = (np.asarray(v, dtype=np.float32) for v in WARMTH[faction])
    part = maps["part"]
    sel = part >= 0
    for nm in skip:
        if nm in names:
            sel &= part != names.index(nm)
    idx = np.nonzero(sel)
    n = maps["N"][idx].astype(np.float32)
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-9
    lam = np.clip(n @ KEY_L.astype(np.float32), -1, 1)
    lin = _lin(img)
    t = 1.0 + np.clip(lam, 0, 1)[:, None] * lt[None, :] + np.clip(-lam + 0.2, 0, 1)[:, None] * sh[None, :]
    lin[idx] = lin[idx] * t
    log(f"  warmth {faction}: {len(lam)} texels")
    return _srgb(lin).astype(np.float32)


# ── paint v4 (fix round 3, review 2026-10-27c: "clean procedural fields that read as plastic or clay; the concept's
# felt fuzz, linen folds and brushwork mostly missing") ─────────────────────────────────────────────────────────────
# THE CONCEPT'S OWN PAINTING carried onto the finished paint, the Art 2.0 projection's job: the raw projection (before
# any clean-up) is split into its broad light (a 3D low-pass at 4.5 cm: the plates' patches and baked lighting, which
# the palette fit and the form light replace) and its brushwork above that scale (strokes, painted fold light, felt and
# linen texture), and the brushwork is multiplied back in as a luminance ratio (+ its warm / cool strokes as a chroma
# ratio). Texels the plates do not see head-on (sides, tops) and projection ghosts (far from the part's own value) are
# left out. DETAIL {part: (luminance amount, chroma amount)}.
DETAIL = {"aubade": {"hood": (0.85, 0.6), "cloak": (0.90, 0.6), "scarf": (0.7, 0.5), "stole": (0.55, 0.3),
                     "sleeve_R": (0.6, 0.4)},
          "serenade": {"hood": (0.55, 0.45), "cloak": (0.90, 0.6), "mantle": (0.75, 0.5), "collar": (0.70, 0.5),
                       "sleeve_R": (0.6, 0.4)}}


def _lowpass3d(P, v, cell, keep=None):
    """3D low-pass of per-texel values v over their surface points P: trilinear splat onto a `cell` grid, a [1 2 1]
    blur per axis, trilinear gather (the glimwick's transfer filter)."""
    P = np.asarray(P, dtype=np.float64)
    wt = np.ones(len(P)) if keep is None else keep.astype(np.float64)
    lo = P.min(axis=0) - 2 * cell
    g = (P - lo) / cell
    i0 = np.floor(g).astype(np.int64)
    f = g - i0
    n = i0.max(axis=0) + 4
    size = int(np.prod(n))
    S, W = np.zeros(size), np.zeros(size)
    corners = []
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w_ = ((f[:, 0] if dx else 1 - f[:, 0]) * (f[:, 1] if dy else 1 - f[:, 1])
                      * (f[:, 2] if dz else 1 - f[:, 2]))
                idx = ((i0[:, 0] + dx) * n[1] + (i0[:, 1] + dy)) * n[2] + (i0[:, 2] + dz)
                S += np.bincount(idx, weights=w_ * wt * v, minlength=size)
                W += np.bincount(idx, weights=w_ * wt, minlength=size)
                corners.append((idx, w_))
    S, W = S.reshape(tuple(n)), W.reshape(tuple(n))
    for ax in range(3):
        S = 0.25 * (np.roll(S, 1, ax) + 2 * S + np.roll(S, -1, ax))
        W = 0.25 * (np.roll(W, 1, ax) + 2 * W + np.roll(W, -1, ax))
    M = (S / np.maximum(W, 1e-12)).ravel()
    return sum(M[idx] * w_ for idx, w_ in corners)


def concept_detail(img, raw, maps, names, spec: dict, zones=None, log=print):
    """Multiply the raw projection's brushwork (above a 4.5 cm 3D low-pass) into the finished paint (see DETAIL). The
    ZONES where the concept paints arms / fists / the haft over open cloak (refilled by side_soften) are left out."""
    zones = zones or {}
    wl = np.array([0.2126, 0.7152, 0.0722])
    lin = _lin(img)
    rl = _lin(raw).astype(np.float64)
    for name, (amt, camt) in spec.items():
        idx = _part_idx(maps, names, name)
        if idx is None:
            continue
        P = maps["P"][idx].astype(np.float64)
        n = maps["N"][idx].astype(np.float64)
        n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-9
        c = rl[idx]
        L = c @ wl
        ok = (np.abs(n[:, 1]) > 0.30) & (n[:, 2] < 0.62)
        if ok.sum() < 80:
            continue
        med = float(np.median(L[ok]))
        ok &= (L > med / 1.7) & (L < med * 1.7)
        Ll = _lowpass3d(P, L, 0.045, ok)
        face = sstep(0.30, 0.55, np.abs(n[:, 1])) * sstep(0.62, 0.40, n[:, 2])
        zn = zones.get(name)
        if zn == "chin":
            u_, v_, w_ = AU_ARCH.uvw(P)
            face = face * (1.0 - sstep(-0.02, -0.08, P[:, 1]) * sstep(0.71, 0.68, P[:, 2]))
        elif zn is not None:
            x0, x1, z0, z1 = zn
            ax_, zz = np.abs(P[:, 0]), P[:, 2]
            face = face * (1.0 - sstep(x0, x1, ax_) * sstep(z0, z0 + 0.05, zz) * sstep(z1, z1 - 0.05, zz))
        ratio = np.where(ok, np.clip(L / np.maximum(Ll, 1e-4), 0.62, 1.45), 1.0)
        k = 1.0 + amt * face * (ratio - 1.0)
        ch = c / np.maximum(L[:, None], 1e-4)
        chl = np.stack([_lowpass3d(P, ch[:, j], 0.045, ok) for j in range(3)], axis=1)
        cr = np.where(ok[:, None], np.clip(ch / np.maximum(chl, 1e-4), 0.84, 1.18), 1.0)
        kc = 1.0 + (camt * face)[:, None] * (cr - 1.0)
        lin[idx] = (lin[idx] * (k[:, None] * kc)).astype(np.float32)
        log(f"  concept detail {name}: x{amt} / {camt}, {int(ok.sum())} texels, ratio p5-p95 "
            f"{np.percentile(ratio[ok], 5):.2f}-{np.percentile(ratio[ok], 95):.2f}")
    return _srgb(lin).astype(np.float32)


if not getattr(project.paint_object, "_palette_fit", False):
    _paint_object = project.paint_object

    def _paint_object_fit(obj, size, cfg, names, part_attr="vale_part", log=print, return_maps=False):
        fit = cfg.get("palette_fit")
        if not fit:
            return _paint_object(obj, size, cfg, names, part_attr=part_attr, log=log, return_maps=return_maps)
        img, maps = _paint_object(obj, size, cfg, names, part_attr=part_attr, log=log, return_maps=True)
        raw = img.copy()
        fac = cfg.get("sw_faction")
        geo = _GEOM.get(fac, {})
        if cfg.get("sw_tops_full"):
            img = tops_full(img, maps, names, cfg["sw_tops_full"], cfg.get("tops") or {}, log=log)
        if cfg.get("sw_despeckle"):
            img = despeckle(img, maps, names, cfg["sw_despeckle"], log=log)
        if cfg.get("sw_clean"):
            img = clean(img, maps, names, cfg["sw_clean"], log=log)
        if cfg.get("sw_sides"):
            img = side_soften(img, maps, names, cfg["sw_sides"], cfg.get("sw_zones"), log=log)
        if geo.get("pads"):
            img = shield_paint(img, maps, names, geo, log=log)
        img = palette_fit(img, maps, names, fit, masks=cfg.get("sw_fit_mask"), carve=geo.get("carve"), log=log)
        if cfg.get("sw_proc"):
            img = proc_paint(img, maps, names, cfg["sw_proc"], log=log)
        img = boot_paint(img, maps, names, log=log)
        if fac == "serenade":
            img = collar_rolls(img, maps, names, geo, log=log)
        if geo.get("shield_frame") is not None:
            img = shield_face_paint(img, maps, names, geo, fac, log=log)
        if cfg.get("sw_folds"):
            img = shade_folds(img, maps, names, cfg["sw_folds"], geo.get("sdf", {}), log=log)
        if cfg.get("sw_brush"):
            img = brush(img, maps, names, cfg["sw_brush"], log=log)
        img = au_rim_paint(img, maps, names, geo, log=log) if fac == "aubade" else se_rim_paint(img, maps, names, geo, log=log)
        if cfg.get("sw_hollow"):
            img = hollow_ink(img, maps, names, cfg["sw_hollow"], geo, log=log)
        img = hood_light_paint(img, maps, names, geo, fac, log=log)
        if fac == "serenade":
            img = rim_tube_paint(img, maps, names, geo, log=log)
            img = under_mantle(img, maps, names, log=log)
        if cfg.get("sw_ramp"):
            img = ramp(img, maps, names, cfg["sw_ramp"], log=log)
        img = paint_bands(img, maps, names, geo.get("bands", []), log=log)
        if cfg.get("sw_form"):
            img = form_light(img, maps, names, cfg["sw_form"], log=log)
        if cfg.get("sw_edges"):
            img = edges_paint(img, maps, names, cfg["sw_edges"], geo.get("sdf", {}), log=log)
        if cfg.get("sw_material"):
            img = texture_paint(img, maps, names, cfg["sw_material"], geo.get("mat_aux"), log=log)
            img = warmth(img, maps, names, fac, skip=("throat",), log=log)
        if fac in DETAIL:
            img = concept_detail(img, raw, maps, names, DETAIL[fac], cfg.get("sw_zones"), log=log)
        img = ink_lines(img, maps, names, geo.get("inklines", []), log=log)
        img = stitches(img, maps, names, geo.get("stitches", []), log=log)
        # re-bleed: the steps above touch island texels only, and the bleed ring round each island still held the
        # raw projection (near-white streaked crowns), which bilinear filtering pulled in along every UV seam as
        # thin pale zig-zag "cracks" (review item 2)
        iy, ix = project.nearest_index(maps["part"] >= 0)
        img = img[iy, ix]
        if cfg.get("sw_dilate"):
            dilate_bake_maps(maps, names, ROUGH.get(fac), geo.get("carve"), log=log)
        return (img, maps) if return_maps else img
    _paint_object_fit._palette_fit = True
    project.paint_object = _paint_object_fit


# AO floors (dilate_bake_maps; the AO goes into the base colour after it): review 2026-10-27b item 6 - the scarf's
# occlusion cut dark bow-tie notches into the stole tops
AO_FLOOR = {"aubade": {"stole": 0.80}, "serenade": {}}


def fac_of(names) -> str:
    return "aubade" if "stole" in names else "serenade"


# matte overrides in the roughness bake (dilate_bake_maps)
ROUGH = {"aubade": {"throat": 1.0, "hood_carved": 1.0},
         "serenade": {"throat": 1.0, "hood_carved": 1.0, "collar": 0.97}}
ACCENT_ROUGH = 0.9


def _no_metal() -> None:
    """Bible §0.5: metalness 0. common.bake wires the ORM's B channel to Metallic, so the exporter writes
    metallicFactor 1 and the lossy-WebP ORM's B noise (0.05-0.3 on ~5 % of texels) became metal. The baked body
    material keeps roughness + occlusion from the ORM; Metallic is unlinked and 0 (metallicFactor 0). Runs from
    clip_overrides, which the pipeline calls after the bake and before the export."""
    import bpy
    for m in bpy.data.materials:
        nt = m.node_tree if m.use_nodes else None
        b = nt.nodes.get("BSDF") if nt else None
        if b is None or "Metallic" not in b.inputs:
            continue
        sock = b.inputs["Metallic"]
        if sock.is_linked:
            for ln in list(sock.links):
                nt.links.remove(ln)
            scene.log(f"no metal: {m.name} Metallic unlinked")
        sock.default_value = 0.0
    # the accent is matte light (review 2026-10-27b item 4: at roughness 0.25 the flame, globes and boss carried
    # specular highlights and read as glossy gems; the bible bans gems)
    m = bpy.data.materials.get("accent")
    b = m.node_tree.nodes.get("BSDF") if m and m.use_nodes else None
    if b is not None and "Roughness" in b.inputs:
        b.inputs["Roughness"].default_value = ACCENT_ROUGH
        scene.log(f"accent roughness {ACCENT_ROUGH}")


def cloak_leg_weights(spec_id: str, names: list, log=print) -> None:
    """Review 2026-10-21b items 4 and 11 (the run read as a sliding rigid bell, the death as a toppling can): the
    cloak's lower half follows the legs - its hem takes up to 40 % of the thigh on its side (blended across the front
    and back centre lines), fading out by the hips. The hem swings with each stride and lifts at the knees when the
    wick sits back; a thigh only rotates about the hip above it, so the hem rises, never sinks."""
    import bpy
    obj = bpy.data.objects.get(spec_id)
    if obj is None or "cloak" not in names:
        return
    me = obj.data
    attr = me.attributes.get("vale_part")
    n = len(me.vertices)
    pid = np.empty(n, dtype=np.int64)
    attr.data.foreach_get("value", pid)
    co = np.empty(n * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    ci = [names.index(n_) for n_ in ("cloak", "stole") if n_ in names]
    gl = obj.vertex_groups.get("thigh.L") or obj.vertex_groups.new(name="thigh.L")
    gr = obj.vertex_groups.get("thigh.R") or obj.vertex_groups.new(name="thigh.R")
    keep = {g.index for g in (gl, gr)}
    cnt = 0
    for vi in np.nonzero(np.isin(pid, ci))[0]:
        x, z = float(co[vi, 0]), float(co[vi, 2])
        h = 0.40 * float(sstep(0.36, 0.15, z))
        if h < 1e-3:
            continue
        sl = float(sstep(-0.07, 0.07, x))
        v = me.vertices[int(vi)]
        for g in v.groups:
            if g.group not in keep:
                g.weight *= (1.0 - h)
        if h * sl > 1e-3:
            gl.add([int(vi)], h * sl, "ADD")
        if h * (1 - sl) > 1e-3:
            gr.add([int(vi)], h * (1 - sl), "ADD")
        cnt += 1
    log(f"cloak leg weights: {cnt} hem vertices follow the thighs (<= 40 %)")


# ── motion (brief §3.1) ─────────────────────────────────────────────────────────────────────────────────
P_ = anim.P


class AimUp(Aim):
    """anim.Aim plus a ROLL: after the minimal-rotation aim, the hand turns about the aim axis so the prop's local +Z
    lies toward `up` (character space). The shield's rib and spire stayed tilted ~30 degrees at rest (review
    2026-10-27 item 6: the plain aim keeps whatever roll the arm IK leaves, so the vertical rib read as a blade through
    the disc). Wrapped here (anim._solve_aim acts on AimUp only; plain Aims are untouched)."""

    def __init__(self, dir=(0.0, -1.0, 0.0), weight: float = 1.0, up=(0.0, 0.0, 1.0)):
        super().__init__(tuple(dir), weight)
        self.up = tuple(up)

    def lerp(self, o, t: float):
        a = Aim.lerp(self, o, t)
        uo = np.asarray(getattr(o, "up", self.up), dtype=np.float64)
        u = np.asarray(self.up, dtype=np.float64) * (1 - t) + uo * t
        return AimUp(a.dir, a.weight, tuple(u / (np.linalg.norm(u) + 1e-9)))

    def mirrored(self):
        return AimUp((-self.dir[0], self.dir[1], self.dir[2]), self.weight, (-self.up[0], self.up[1], self.up[2]))


if not getattr(anim._solve_aim, "_aim_up", False):
    _solve_aim0 = anim._solve_aim

    def _solve_aim_up(skel, pose, M, side, am):
        _solve_aim0(skel, pose, M, side, am)
        if not isinstance(am, AimUp) or am.weight <= 0:
            return
        from mathutils import Quaternion, Vector as V
        M2 = skel.fk(pose)
        hand, prop = f"hand.{side}", f"prop.{side}"
        R = M2[prop].to_3x3()
        y = R.col[1].normalized()
        z = R.col[2] - y * R.col[2].dot(y)
        u = V(am.up) - y * V(am.up).dot(y)
        if z.length < 1e-4 or u.length < 1e-4:
            return
        z.normalize()
        u.normalize()
        ang = math.atan2(z.cross(u).dot(y), max(-1.0, min(1.0, z.dot(u))))
        q = Quaternion(y, ang * min(1.0, am.weight))
        new = q.to_matrix() @ M2[hand].to_3x3()
        Ph = (M2[skel.parent[hand]] @ skel.local[hand]).to_3x3()
        pose[hand] = skel.euler_of(Ph.inverted() @ new, pose.get(hand))
    _solve_aim_up._aim_up = True
    anim._solve_aim = _solve_aim_up
RUN_SPEED = 3.25          # content moveSpeed
# minion rig: crown 1.00, skull base 0.716 (the hood pivot), shoulders x 0.16 at 0.566, hips 0.362, ankles x 0.115 at
# 0.055; the arms are re-placed per concept in rig_extras
PROPORTIONS_KW = dict(height=1.0, head=0.33, neck=0.05, shoulder_width=0.32, hip_width=0.14, leg=0.31, thigh_frac=0.5,
                      arm=0.20, upper_arm_frac=0.5, hand=0.08, foot=0.16, ankle_height=0.055, spine_curve=0.0,
                      stance=0.045, toe_out_deg=10.0, knee_bend=0.012, a_pose_deg=60.0, arm_forward_deg=10.0,
                      elbow_bend_deg=20.0, shoulder_drop=0.10)
# death: lift (m) of the sit / tip / lying keys over the old poses, so the rigid cloak and the shield rest ON the
# ground (three.js skinned-vertex minimum, review 2026-10-21 item 11: they sank 9-22 cm)
DEATH_LIFT = {"aubade": (0.115, 0.175, 0.09), "serenade": (0.10, 0.17, 0.10)}


# texel weights per part (review 2026-10-27 item 2: the 1024 atlas was chopped into many small, evenly sized islands;
# the parts the camera reads - hood, frame, cloak, shield face, mantle - get the texels, flat or hidden parts few)
UVW = {"hood": 2.2, "hood_rim": 1.6, "cloak": 1.5, "shield": 1.6, "stole": 1.2, "mantle": 1.6, "collar": 1.3, "scarf": 0.9,
       "knob": 0.9, "shield_rib": 0.9, "shield_pads": 1.0, "lantern": 1.0, "lantern_lid": 0.9, "sleeve_R": 0.9, "sleeve_L": 0.9,
       "throat": 0.55, "hood_light": 0.2, "leg_R": 0.15, "leg_L": 0.15, "boot_R": 0.5, "boot_L": 0.5, "mitt_R": 0.6, "mitt_L": 0.6,
       "hood_rim_s": 1.0, "lantern_pane": 0.35, "shield_ring": 0.45, "lantern_bowl": 0.45, "haft": 0.5, "wraps_R": 0.6,
       "wraps_L": 0.6, "cuff_R": 0.6, "cuff_L": 0.6, "lantern_mullion": 0.4}

# accent ribbons laid on a decimated host: snapped onto the host's game mesh (MeshPart.snapped)
SNAP = {"hood_seam": "hood", "crown_band": "hood"}
SNAP_SMOOTH = {"crown_band": 4, "hood_seam": 2}
# lift over the host's game mesh (review 2026-10-27b item 3: the decimated cowl poked through the hem band as dark shards)
SNAP_BIAS = {"hood_seam": 0.0040, "crown_band": 0.0030}


class Shieldwick(wc.Wick):
    KIND_ID = "shieldwick"
    HEIGHT = 1.1

    def __init__(self, faction: str = wc.LEGACY):
        super().__init__(faction)
        if faction == wc.LEGACY:
            return
        self.F = FACTION[faction]
        self.PROPORTIONS = rig.proportions(**PROPORTIONS_KW)
        self.MOTION = anim.motion_profile(weight="light", weapon="one_hand", stance="guard", run_ref_speed=RUN_SPEED)
        self.AO_INTO_BASE = 0.42
        # normal 512 (brief §1 allows it "if the cloak folds go mushy"; review 2026-10-27 item 2: no painted folds)
        self.TEXTURE_SIZES = {"normal": 512, "orm": 256}
        concept = f"wicks/shieldwick_{faction}"
        self.PROJECTION = wc.graded_projection(concept, self.F["plate_height"], glow=GLOW[faction], tag="sw")
        self.PROJECTION["concept"] = erase_plates(concept, "sw", "swe", self.F["plate_height"], ERASE[faction],
                                                  edge={"aubade": 3, "serenade": 7}[faction])
        self.PROJECTION["tops"] = top_plates(self.PROJECTION["concept"], self.F["plate_height"], TOPS[faction])
        self.PROJECTION["palette_fit"] = dict(PALETTE_FIT[faction])
        self.PROJECTION["flat"] = dict(FLAT[faction])
        self.PROJECTION["sw_hollow"] = dict(HOLLOW[faction])
        self.PROJECTION["sw_fit_mask"] = dict(FIT_MASK[faction])
        self.PROJECTION["sw_proc"] = dict(PROC[faction])
        self.PROJECTION["sw_folds"] = dict(FOLDS[faction])
        self.PROJECTION["sw_brush"] = dict(BRUSH[faction])
        self.PROJECTION["sw_despeckle"] = dict(DESPECKLE[faction])
        self.PROJECTION["sw_clean"] = dict(CLEAN[faction])
        self.PROJECTION["sw_sides"] = tuple(SIDES[faction])
        self.PROJECTION["sw_zones"] = dict(ZONES[faction])
        self.PROJECTION["sw_ramp"] = dict(RAMP[faction])
        self.PROJECTION["sw_faction"] = faction
        self.PROJECTION["sw_dilate"] = True
        self.PROJECTION["sw_edges"] = dict(EDGES[faction])
        self.PROJECTION["sw_form"] = dict(FORM[faction])
        self.PROJECTION["sw_material"] = dict(MATERIAL[faction])
        if TOPS_FULL[faction]:
            self.PROJECTION["sw_tops_full"] = dict(TOPS_FULL[faction])

    # ── geometry ────────────────────────────────────────────────────────────────────────────────────
    def sculpts(self) -> list:
        return parts_aubade(self.F) if self.faction == "aubade" else parts_serenade(self.F)

    def model(self, ctx) -> list:
        if self.faction == wc.LEGACY:
            return self.legacy_model(ctx)
        P = []
        self._part_names = []
        lows = {}
        for name, S, vs, role, bind, tris in self.sculpts():
            self._part_names.append(name)
            if isinstance(S, tuple):
                # (sculpt, hand-built low): the sculpt is the bake source, the low lies on its surface
                hs, lm = S
                v, q = hs.mesh(VOXEL * vs)
                ob = sdf.to_object(f"{name}_high", v, q, ctx.col)
                ob.data.materials.append(ctx.mats[role])
                lv, lt = lm.mesh()
                low = sdf.to_object(f"{name}_low", lv, lt, ctx.col)
                low.data.materials.append(ctx.mats[role])
                P.append(fighter.Part(name, high=ob, low=low, bind=bind, uv_weight=UVW.get(name, 1.0)))
                lows[name] = low
                continue
            if isinstance(S, MeshPart):
                # hand-built: it is its own game mesh and bake source
                if name in SNAP and SNAP[name] in lows:
                    S = S.snapped(lows[SNAP[name]], smooth=SNAP_SMOOTH.get(name, 2), bias=SNAP_BIAS.get(name, 0.0025))
                v, t = S.mesh()
                low = sdf.to_object(f"{name}_low", v, t, ctx.col)
                low.data.materials.append(ctx.mats[role])
                P.append(fighter.Part(name, low=low, bind=bind, uv_weight=UVW.get(name, 1.0)))
                continue
            v, q = S.mesh(VOXEL * vs)
            ob = sdf.to_object(f"{name}_high", v, q, ctx.col)
            ob.data.materials.append(ctx.mats[role])
            lows[name] = make_low(ob, name, ctx.col, tris, VOXEL * vs * 1.25)
            if name == "hood":
                cull_hidden(lows[name], self.faction, log=scene.log)
            P.append(fighter.Part(name, high=ob, low=lows[name], tris=tris, bind=bind, uv_weight=UVW.get(name, 1.0)))
        return P

    def legacy_props(self, ctx, part) -> None:
        k = self.H / 1.1
        wl = ctx.info.side("wrist", "L")
        wc.legacy_weapon(self, ctx, part, "ironstone", (0.07, 0.07, 0.09))
        sd = Sculpt("shield")
        c = (wl.x + 0.06 * k, wl.y - 0.06 * k, wl.z + 0.06 * k)
        sd.add(Lathe(c, lambda r, z: np.maximum(r - 0.2 * k, np.abs(z) - 0.025 * k), 0.22 * k, -0.04 * k, 0.04 * k,
                     axes=sdf.frame((0.6, -0.8, 0.0))), k=0.0)
        sd.add(Torus(c, 0.2 * k, 0.02 * k, axes=sdf.frame((0.6, -0.8, 0.0))), k=0.0)
        part("shield", sd, "stone", "bone:hand.L", 300)
        boss = Sculpt("boss")
        n = np.array([0.6, -0.8, 0.0])
        bp = np.array(c) + n * 0.03 * k
        boss.add(Ellipsoid(tuple(bp), (0.085 * k, 0.085 * k, 0.04 * k), axes=sdf.frame(tuple(n))), k=0.0)
        part("boss", boss, "accent", "bone:hand.L", 100)

    # ── rig ────────────────────────────────────────────────────────────────────────────────────────────
    def rig_extras(self, ctx) -> None:
        """The concept's arms: elbow, wrist and grip per side; prop.R along the mace haft (+Y up the haft, +Z
        front), prop.L along the shield's face normal (+Y out of the face, +Z up)."""
        if self.faction == wc.LEGACY:
            return
        import bpy
        from mathutils import Vector as V
        info = ctx.info
        arm = info.armature
        F = self.F
        scene.select_only([arm], arm)
        bpy.ops.object.mode_set(mode="EDIT")
        eb = arm.data.edit_bones
        for s in ("R", "L"):
            sh = V(eb[f"upper_arm.{s}"].head)
            el, wr, g = (V(tuple(F[k][s])) for k in ("E", "W", "G"))
            up_d, fo_d, hd = (el - sh).normalized(), (wr - el).normalized(), (g - wr).normalized()
            eb[f"upper_arm.{s}"].tail = el
            eb[f"forearm.{s}"].head = el
            eb[f"forearm.{s}"].tail = wr
            eb[f"hand.{s}"].head = wr
            eb[f"hand.{s}"].tail = wr + hd * 0.06
            # rolls: local +Z = the direction of flexion (rig.py: +X rotation flexes)
            eb[f"upper_arm.{s}"].align_roll(fo_d - up_d * fo_d.dot(up_d))
            eb[f"forearm.{s}"].align_roll(-up_d - fo_d * (-up_d).dot(fo_d))
            eb[f"hand.{s}"].align_roll(-up_d - hd * (-up_d).dot(hd))
            info.joints[f"elbow.{s}"], info.joints[f"wrist.{s}"] = el, wr
            info.joints[f"knuckle.{s}"] = wr + hd * 0.06
            info.joints[f"palm.{s}"] = g
            info.joints[f"forearm_dir.{s}"] = fo_d
            info.joints[f"arm_dir.{s}"] = up_d
        gR = V(tuple(F["G"]["R"]))
        eb["prop.R"].head = gR
        eb["prop.R"].tail = gR + V(tuple(F["mace_u"])) * 0.12
        eb["prop.R"].align_roll(V((0.0, -1.0, 0.0)))
        c, n, t, up = shield_frame(F)
        gL = V(tuple(F["G"]["L"]))
        eb["prop.L"].head = gL
        eb["prop.L"].tail = gL + V(tuple(n)) * 0.12
        eb["prop.L"].align_roll(V((0.0, 0.0, 1.0)))
        bpy.ops.object.mode_set(mode="OBJECT")
        for b in arm.data.bones:
            info.lengths[b.name] = b.length

    # ── clips ──────────────────────────────────────────────────────────────────────────────────────────
    def _arm_len(self, s):
        S = shoulder(s)
        E, W = np.asarray(self.F["E"][s]), np.asarray(self.F["W"][s])
        return np.linalg.norm(E - S) + np.linalg.norm(W - E)

    def _rel(self, s, d=(0.0, 0.0, 0.0)):
        """Wrist target in arm lengths from the shoulder (chest frame): the rest wrist moved by d metres."""
        W = np.asarray(self.F["W"][s]) + np.asarray(d)
        return tuple((W - shoulder(s)) / self._arm_len(s))

    def _foot_rest(self, arm) -> None:
        """Rest heel / ball / lateral axis per foot, exactly as anim._solve_foot derives them (armature space)."""
        from mathutils import Vector as V
        self._feet = {}
        for s in ("L", "R"):
            rf = arm.data.bones[f"foot.{s}"].matrix_local
            ankle0 = rf.translation.copy()
            ball0 = arm.data.bones[f"toe.{s}"].matrix_local.translation.copy()
            heel0 = ankle0 + V((0, 0, -ankle0.z)) + (ankle0 - ball0) * V((1, 1, 0)) * 0.55
            self._feet[s] = (ankle0, heel0, ball0, rf.to_3x3().col[0].normalized())

    def _ft(self, s, off, roll=0.0, yaw=0.0, knee=0.0) -> FootTarget:
        """FootTarget for a PHYSICAL foot roll: roll > 0 lifts the toes about the heel (heel strike), roll < 0 lifts
        the heel about the ball (toe-off); `off` the ankle offset (m) from rest, yaw (deg).
        anim._solve_foot rotates about the foot's local X, which on this rig turns a positive `pitch` toes DOWN while
        it still pivots a positive pitch about the heel (the run gate measured it: pitch +6 sank the ball 13 mm, the
        toe-off pitch dropped the ankle 2 cm, so the stance foot rolled instead of planting). Here the solver's pitch
        sign is chosen so the toes go the asked way and the ankle offset is corrected for the pivot it picks:
        solver ankle = pivot_s + R (ankle0 - pivot_s) + off  ->  off' = off + (I - R)(pivot_want - pivot_s)."""
        off = tuple(float(x) for x in off)
        if abs(roll) < 1e-6 or not getattr(self, "_feet", None):
            return FootTarget(off, 0.0, yaw, 0.0, knee)
        from mathutils import Matrix, Vector as V
        ankle0, heel0, ball0, lat = self._feet[s]
        fwd = ball0 - ankle0
        fwd.z = 0.0

        def rot(pitch):
            return Matrix.Rotation(math.radians(yaw), 3, "Z") @ Matrix.Rotation(math.radians(-pitch), 3, lat)
        pitch = -roll
        if ((rot(pitch) @ fwd).z > 0) != (roll > 0):
            pitch = roll
        R = rot(pitch)
        want = heel0 if roll > 0 else ball0
        got = heel0 if pitch > 0 else ball0
        d = (want - got) - R @ (want - got)
        off2 = (off[0] + d.x, off[1] + d.y, off[2] + d.z)
        toe = pitch if pitch < 0 else 0.0                     # cancel the solver's toe counter-bend (nothing binds to toe)
        return FootTarget(off2, pitch, yaw, toe, knee)

    def _pose(self, torso=None, hips=(0.0, 0.0, -0.012), dR=(0, 0, 0), aimR=None, dL=(0, 0, 0), aimL=None,
              feet=None, poleR=(-0.8, 0.5, -0.3), poleL=(0.8, 0.5, -0.3), wR=1.0, wL=1.0, extra=None,
              upL=(0.0, 0.0, 1.0)):
        """A full pose: torso rotations (deg), hips offset (m), wrists moved from rest by dR / dL (m, chest frame),
        the mace haft direction aimR and the shield face direction aimL (character space), feet targets; upL: where
        the shield's rib points (the AimUp roll)."""
        u = tuple(self.F["mace_u"])
        _, n, _, _ = shield_frame(self.F)
        p = P_(**(torso or {}))
        p["hips_loc"] = tuple(hips)
        ik = {"hand.R": HandTarget(rel=self._rel("R", dR), pole=poleR, weight=wR),
              "hand.L": HandTarget(rel=self._rel("L", dL), pole=poleL, weight=wL),
              "aim.R": Aim(tuple(aimR or u)),
              "aim.L": AimUp(tuple(aimL or n), 1.0, upL)}
        f = feet or {}
        ik["foot.L"] = self._ft("L", f.get("l", (0.0, -0.01, 0.0)), f.get("pl", 0.0), f.get("yl", 6.0), f.get("kl", 0.0))
        ik["foot.R"] = self._ft("R", f.get("r", (0.0, 0.01, 0.0)), f.get("pr", 0.0), f.get("yr", -6.0), f.get("kr", 0.0))
        p["ik"] = ik
        if extra:
            p.update(P_(**extra))
        return p

    def guard_aimR(self):
        return tuple(unit(np.asarray(self.F["mace_u"]) + np.array([-0.16, 0.0, 0.0])))

    def guard(self):
        """Idle carry = the bind pose's guard: the shield held in front of the left chest (its rim clears the body
        outline from every side: the disc is the job read at 64 px), the lamp-mace raised and tipped out at the right
        side (its lantern clears the cloak outline)."""
        _, n, _, _ = shield_frame(self.F)
        return self._pose(dict(hips=(2, 0, 0), spine=(2, 0, 0), chest=(1, 0, 0), neck=(-1, 0, 0), head=(-2, 0, 0)),
                          dL=(0.0, 0.0, 0.0), aimL=tuple(n),
                          dR=(-0.03, 0.0, 0.08), aimR=self.guard_aimR())

    def clip_overrides(self, ctx) -> dict:
        if self.faction == wc.LEGACY:
            return {}
        _no_metal()
        if getattr(self, "_part_names", None):          # (not in the motion proto: no model there)
            cloak_leg_weights(self.ID, self._part_names, log=scene.log)
        self._foot_rest(ctx.info.armature)
        G = self.guard()
        u = np.asarray(self.guard_aimR())
        out = {}

        # idle (72 f): breathing bob, the hood scanning left then right once, the lantern swinging a few degrees
        def idle_s(t):
            b = anim.osc(t, 2)
            scan = 14.0 * math.sin(2 * math.pi * t) * (0.6 + 0.4 * abs(math.sin(2 * math.pi * t)))
            p = anim.add(G, P_(chest=(1.4 * b, 0, 0), spine=(0.6 * b, 0, 0), neck=(-0.8 * b, scan * 0.35, 0),
                               head=(-0.6 * b, scan * 0.65, 0), shoulder_L=(0, 0, 1.2 * b), shoulder_R=(0, 0, -1.2 * b)))
            ik = dict(p["ik"])
            sw = math.sin(2 * math.pi * (2 * t + 0.15))
            ik["aim.R"] = Aim(tuple(unit(u + np.array([0.06 * sw, 0.05 * math.cos(2 * math.pi * 2 * t), 0.0]))))
            for s in ("R", "L"):
                h = ik[f"hand.{s}"]
                ik[f"hand.{s}"] = HandTarget(rel=(h.rel[0], h.rel[1], h.rel[2] + 0.02 * anim.osc(t, 2, 0.1 if s == "R" else 0.18)),
                                             pole=h.pole)
            p["ik"] = ik
            hx, hy, hz = p["hips_loc"]
            p["hips_loc"] = (hx, hy, hz - 0.006 * (0.5 + 0.5 * b))
            return p
        out["idle"] = anim.Clip("idle", 72, True, idle_s)
        out["run"] = self._run()
        out["attack1"] = self._attack1(G)
        out["death"] = self._death(G, ctx)
        return out

    def _run(self) -> anim.Clip:
        """A quick waddling run at the content moveSpeed: 8 frames (2 steps). Each foot is PLANTED flat for its whole
        contact (34 % of the cycle, so three sampled frames: the gate's level-ankle test) and moves back at exactly
        RUN_SPEED; heel lift (about the ball) only in the contact's last quarter, a toes-up reach before landing.
        The waddle sways the body over the stance foot (hips shift + spine / chest roll; the hips themselves roll
        only 4 degrees and pitch 2, so the rigid bell hem stays above the ground), the shield tucked to the chest,
        the mace arm pumping, the hood counter-rolled level."""
        v = RUN_SPEED
        # (review 2026-10-27b item 8: 12 frames with 23 % contact was a bounding sprint - both feet off the ground 54 %
        # of the cycle, the feet hovering 6-12 cm. Now a quicker cadence, 8 frames (7.5 steps a second), each foot
        # planted 34 % of the cycle (3 sampled frames), both off the ground only 32 %, a 4 cm swing)
        N = 8
        T = N / anim.FPS
        c = 0.34                     # contact fraction: the planted stride (v c T = 0.29 m) inside the leg's reach
        Ls = v * c * T
        # swing keys (s in swing 0..1, dy, dz, physical roll: + toes up, - heel up)
        swing = [(0.00, Ls / 2, 0.0, -14.0), (0.24, Ls / 2 + 0.012, 0.026, -20.0), (0.50, 0.015, 0.040, -6.0),
                 (0.76, -Ls / 2 - 0.020, 0.024, 8.0), (0.91, -Ls / 2 - 0.006, 0.008, 4.0), (1.00, -Ls / 2, 0.0, 0.0)]

        def swing_at(s):
            for i in range(1, len(swing)):
                if s <= swing[i][0]:
                    a, b = swing[i - 1], swing[i]
                    w = anim.sine((s - a[0]) / (b[0] - a[0]))
                    return tuple(a[k] + (b[k] - a[k]) * w for k in (1, 2, 3))
            return swing[-1][1:]

        def foot_at(q):
            q %= 1.0
            if q < c:
                w = q / c
                return (0.0, -Ls / 2 + Ls * w, 0.0), -14.0 * max(0.0, (w - 0.74) / 0.26) ** 1.5
            dy, dz, roll = swing_at((q - c) / (1 - c))
            return (0.0, dy, dz), roll

        u = np.asarray(self.F["mace_u"])

        def sample(t):
            q = t % 1.0
            fl, rl = foot_at(q)
            fr_, rr = foot_at(q + 0.5)
            z = -0.032 - 0.022 * 0.5 * (1 + math.cos(2 * math.pi * (2 * q - c)))   # crouched; lowest at mid-stance
            x = 0.024 * math.cos(2 * math.pi * (q - c / 2))                      # the body over the stance foot
            yaw = -6.0 * math.cos(2 * math.pi * q)
            sway = math.cos(2 * math.pi * (q - c / 2) + 0.5)                    # the waddle (peaks just after mid-stance)
            nod = 2.0 * math.cos(2 * math.pi * (2 * q - c) + 0.6)              # the hood nods on each landing
            sw = math.cos(2 * math.pi * (q - 0.04))                            # + = left foot forward -> mace arm forward
            torso = dict(hips=(2, yaw, 4.0 * sway), spine=(4, -yaw * 0.5, 3.0 * sway),
                         chest=(3 + 1.2 * math.cos(4 * math.pi * q), -yaw * 0.4, 2.0 * sway),
                         neck=(-4 + nod * 0.4, yaw * 0.3, -4.5 * sway), head=(-4 + nod, yaw * 0.3, -4.0 * sway))
            p = self._pose(torso, hips=(x, 0.0, z),
                           dR=(0.0, -0.075 * sw, 0.035 + 0.025 * sw), aimR=tuple(unit(u + np.array([0.0, -0.45 * sw - 0.15, 0.0]))),
                           dL=(-0.012, -0.015, 0.025), aimL=tuple(unit((0.60, -0.78, 0.14))),
                           feet=dict(l=(0.012 + fl[0], fl[1] - 0.01, fl[2]), pl=rl, yl=-3.0,
                                     r=(-0.012 + fr_[0], fr_[1] - 0.01, fr_[2]), pr=rr, yr=3.0))
            return p
        return anim.Clip("run", N, True, sample, meta={"run_ref_speed": v, "stride_m": round(v * T / 2, 3), "cycle_s": round(T, 3)})

    def _attack1(self, G) -> anim.Clip:
        """Brief §3.1: shield shove (anticipation, the disc punches forward with a hip twist) -> the lamp-mace hauled
        OVERHEAD (the arm straight up beside the hood, the haft cocked back over the right shoulder: the lantern
        rises to the hood crown with its cap above it; slightly out to the right so the 52-degree camera sees it
        beside the hood, not behind it) -> an overhead chop down and forward, the body pitching into it, landing
        at the impact frame (40 %) about 0.4 m in front at knee height -> follow-through -> recoil back behind the
        shield (25 frames; the renderer maps 40 % onto the 0.35 s windup)."""
        N = 25
        u = np.asarray(self.guard_aimR())
        S = shoulder("R")
        W = np.asarray(self.F["W"]["R"])
        fwd = dict(l=(0.0, -0.07, 0.0), r=(0.0, 0.03, 0.0))
        shove = self._pose(dict(hips=(4, -9, 0), spine=(4, -7, 0), chest=(3, -5, 0), neck=(-3, 6, 0), head=(-4, 7, 0)),
                           hips=(0.0, -0.035, -0.026), dR=tuple(S + np.array([-0.05, 0.03, 0.08]) - W), aimR=tuple(unit((-0.40, 0.25, 0.88))),
                           dL=(-0.02, -0.07, 0.02), aimL=tuple(unit((0.25, -0.95, 0.12))), feet=fwd, poleR=(-0.9, 0.3, 0.1))
        if self.faction == "serenade":
            # review 2026-10-21b item 11: on the Serenade's short arm the raise stopped at hood height and the whole
            # bell bowed into the strike. Now the clavicle lifts, the chest leans back, the wrist goes to full reach
            # straight over the shoulder with the haft upright (the lid clears the dome crown), and the strike is a
            # crouch with the chest following the arm (the hips stay level: no bow of the bell)
            wind = self._pose(dict(hips=(-1, 12, 0), spine=(-6, 10, 0), chest=(-9, 10, 0), neck=(6, -9, 0), head=(8, -10, 0),
                                   shoulder_R=(0, 0, -30)),
                              hips=(0.0, 0.015, 0.016), dR=tuple(S + np.array([-0.09, 0.10, 0.19]) - W),
                              aimR=tuple(unit((-0.40, 0.42, 0.81))), dL=(-0.01, -0.04, 0.03), aimL=tuple(unit((0.40, -0.90, 0.12))),
                              feet=dict(fwd, pl=-14.0, pr=-14.0), poleR=(-0.9, 0.25, 0.2))
            hit = self._pose(dict(hips=(1, -10, 0), spine=(7, -8, 0), chest=(9, -8, 0), neck=(-6, 6, 0), head=(-7, 8, 0),
                                  shoulder_R=(0, 0, 8)),
                             hips=(0.0, -0.050, -0.045), dR=tuple(S + np.array([-0.02, -0.20, 0.02]) - W),
                             aimR=tuple(unit((0.04, -0.85, -0.52))), dL=(0.01, -0.01, -0.01), aimL=tuple(unit((0.6, -0.78, 0.0))),
                             feet=fwd, poleR=(-0.9, 0.2, -0.3))
            fol = self._pose(dict(hips=(2, -11, 0), spine=(8, -9, 0), chest=(10, -9, 0), neck=(-7, 7, 0), head=(-8, 8, 0),
                                  shoulder_R=(0, 0, 10)),
                             hips=(0.0, -0.055, -0.050), dR=tuple(S + np.array([-0.03, -0.19, -0.03]) - W),
                             aimR=tuple(unit((0.08, -0.62, -0.78))), dL=(0.0, 0.0, -0.01), aimL=tuple(unit((0.62, -0.77, -0.03))),
                             feet=fwd, poleR=(-0.9, 0.2, -0.3))
        else:
            # overhead: the wrist at full reach straight over the shoulder, a little out and back
            # (risen onto the balls of the feet: heels up 14 degrees, the hips 2 cm higher)
            wind = self._pose(dict(hips=(-3, 12, 0), spine=(-7, 10, 0), chest=(-9, 10, 0), neck=(5, -9, 0), head=(6, -10, 0),
                                   shoulder_R=(0, 0, -22)),
                              hips=(0.0, 0.020, 0.012), dR=tuple(S + np.array([-0.08, 0.10, 0.16]) - W),
                              aimR=tuple(unit((-0.40, 0.42, 0.81))), dL=(-0.01, -0.04, 0.03), aimL=tuple(unit((0.40, -0.90, 0.12))),
                              feet=dict(fwd, pl=-14.0, pr=-14.0), poleR=(-0.9, 0.2, 0.3))
            # (the pitch is carried by the spine and chest, not the hips: the rigid bell hem follows the hips)
            hit = self._pose(dict(hips=(4, -10, 0), spine=(12, -8, 0), chest=(11, -8, 0), neck=(-8, 6, 0), head=(-9, 8, 0)),
                             hips=(0.0, -0.060, -0.028), dR=tuple(S + np.array([-0.025, -0.17, 0.085]) - W),
                             aimR=tuple(unit((0.04, -0.92, -0.38))), dL=(0.01, -0.01, -0.01), aimL=tuple(unit((0.6, -0.78, 0.0))),
                             feet=fwd, poleR=(-0.9, 0.2, -0.3))
            fol = self._pose(dict(hips=(5, -11, 0), spine=(13, -9, 0), chest=(12, -9, 0), neck=(-9, 7, 0), head=(-10, 8, 0)),
                             hips=(0.0, -0.065, -0.032), dR=tuple(S + np.array([-0.03, -0.18, 0.03]) - W),
                             aimR=tuple(unit((0.08, -0.74, -0.66))), dL=(0.0, 0.0, -0.01), aimL=tuple(unit((0.62, -0.77, -0.03))),
                             feet=fwd, poleR=(-0.9, 0.2, -0.3))
        coil = anim.lerp_pose(G, wind, 1.06)
        recoil = self._pose(dict(hips=(-2, 4, 0), spine=(-2, 3, 0), chest=(-2, 3, 0), neck=(1, -2, 0), head=(1, -3, 0)),
                            hips=(0.0, 0.015, -0.02), dR=(0.0, 0.02, 0.05), aimR=tuple(u),
                            dL=(-0.01, -0.03, 0.03), aimL=tuple(unit((0.55, -0.82, 0.12))))
        keys = [(0.0, G, "linear"), (0.12, shove, "out"), (0.27, wind, "inout"), (0.33, coil, "out"),
                (anim.IMPACT, hit, "accel"), (0.48, anim.lerp_pose(hit, fol, 0.5), "out"), (0.62, fol, "out"),
                (0.80, recoil, "inout"), (1.0, G, "settle")]
        return anim.Clip("attack1", N, False, anim.drag(anim.keyed(keys), N, {"head": 1.5, "neck": 1.0}), impact=anim.IMPACT)

    def _death(self, G, ctx) -> anim.Clip:
        """Hit -> the knees buckle and the wick sits back -> tips forward onto the shield and lies over it, the lantern
        on the ground (40 frames; ends at rest). The lying pose is lifted so the rigid bell cloak and the shield rest
        ON the ground (DEATH_LIFT: the skinned mesh's lowest point measured in three.js, about 1 cm under it)."""
        N = 40
        hip_h = ctx.info.armature.data.bones["hips"].head_local.z
        lift = DEATH_LIFT[self.faction]
        hit = self._pose(dict(hips=(-6, 8, 0), spine=(-8, 4, 0), chest=(-10, 4, 0), neck=(-8, 0, 0), head=(-12, 6, 0)),
                         hips=(0.0, 0.04, -0.01), dR=(-0.03, 0.04, 0.06), aimR=tuple(unit((-0.5, 0.2, 0.84))),
                         dL=(0.02, 0.03, 0.03), aimL=tuple(unit((0.7, -0.7, 0.15))))
        # the knees buckle and the wick sits back: hips down and back over the heels, the feet slide forward, the
        # thighs come up (the cloak's hem follows them: cloak_leg_weights), the body leans back
        sit = self._pose(dict(hips=(-16, 6, 0), spine=(6, 2, 0), chest=(8, 2, 0), neck=(4, 0, 0), head=(6, 0, 0)),
                         hips=(0.0, 0.08, -hip_h * 0.42 + lift[0]), dR=(-0.03, -0.02, -0.05), aimR=tuple(unit((-0.6, -0.2, 0.77))),
                         dL=(0.0, -0.02, -0.04), aimL=tuple(unit((0.5, -0.8, -0.3))),
                         feet=dict(l=(0.015, -0.12, 0.0), r=(-0.015, -0.10, 0.0), pl=14.0, pr=14.0))
        tip = self._pose(dict(hips=(40, 4, 0), spine=(10, 0, 0), chest=(8, 0, 0), neck=(4, 0, 0), head=(6, 0, 0)),
                         hips=(0.0, -0.06, -hip_h * 0.55 + lift[1]), dR=(-0.05, -0.08, -0.06), aimR=tuple(unit((-0.7, -0.6, 0.2))),
                         dL=(0.0, -0.07, -0.10), aimL=tuple(unit((0.2, -0.3, -0.93))), upL=(0.0, -1.0, 0.0),
                         feet=dict(l=(0.01, -0.02, 0.0), r=(-0.01, 0.0, 0.0), pl=-10.0, pr=-10.0))
        # (review 2026-10-27 item 13: lying face-down on the shield, its boss sank 5-6 cm into the ground - the shield
        # hand is drawn 6 cm in toward the chest so the disc lies flat under it, boss on the ground)
        down = self._pose(dict(hips=(74, 2, 0), spine=(8, 0, 0), chest=(6, 0, 0), neck=(-6, 0, 0), head=(-8, 4, 6)),
                          hips=(0.0, -0.20, -hip_h + 0.19 + lift[2]), dR=(-0.08, -0.06, -0.10), aimR=tuple(unit((-0.9, -0.3, -0.2))),
                          dL=(0.0, 0.0, -0.06), aimL=tuple(unit((0.05, 0.1, -0.99))), wR=1.0, upL=(0.0, -1.0, 0.0))
        down["ik"].pop("foot.L")
        down["ik"].pop("foot.R")
        down.update(P_(thigh_L=(6, 0, 5), shin_L=(-8, 0, 0), foot_L=(-25, 0, 0), thigh_R=(10, 0, -5), shin_R=(-14, 0, 0), foot_R=(-25, 0, 0)))
        bounce = anim.add(down, P_(spine=(-4, 0, 0), chest=(-3, 0, 0), head=(-4, 0, 0)))
        bounce["hips_loc"] = (0.0, -0.20, -hip_h + 0.21 + lift[2])
        rest = anim.add(down, P_(head=(0, -4, 0)))
        rest["hips_loc"] = (0.0, -0.20, -hip_h + 0.185 + lift[2])
        keys = [(0.0, G, "linear"), (0.10, hit, "snap"), (0.34, sit, "inout"), (0.52, tip, "in"), (0.66, down, "in"),
                (0.74, bounce, "out"), (0.84, rest, "inout"), (1.0, rest, "linear")]
        return anim.Clip("death", N, False, anim.keyed(keys))


KINDS = [Shieldwick]

if __name__ == "__main__":
    wc.run(KINDS)
