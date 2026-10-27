"""Dialwood trees (RIFT brief §6: "lacquered fan-leaved plates, bevelled, instanced").

Budget first: RIFT instances ~2,400 trees (×2 with the shadow pass), so a tree is ≤ 750 triangles (average
~550). Silhouette second: the 52° camera sees a crown from above, and every variant keeps units on the road
beside its block in view, so crowns overhang their trunk by ≤ 1.7 m (render/terrain.ts sizes each tree
to the room its spot has).

A crown is a set of PADS — the dial-maker's pruned clouds. A pad is a closed, flattened CUSHION (the
foliage in shade, what any gap between leaves shows) crowned by a ROSETTE of crimped fan leaves that
radiate from its top like a dial's hour-lines: an outer ring hanging over the cushion's rim, an inner ring,
a small cap. Every leaf of a ring follows one paraboloid dome (droop and curl matched to its curvature) and
each inner ring rides a little higher than the one outside it, so every tip lies over the stems of the ring
below — a clean shingle, no two leaves fighting for a depth. Leaves tilt ≤ ~35° from level, so from the
52° camera no leaf is ever seen edge-on (no shards); the cushions close every flank and underside.

Variety lives in the pad layout: a tiered stack, an umbrella, a trunkless mound, a slim young tree, a
stepping lean; pads differ in size, squash, turn and droop, so are their leaves.

Shading normals: the pad's dome, blended toward the whole crown's form and a good share of the leaf's own
facet, plus a rib/valley tilt along every pleat: the crown shades as soft painted masses, broken leaf by leaf
and rib by rib by the paint, never by a highlight. The plates are MATTE (r12 M11: COLOR_0.a, the gloss mask,
is 0 everywhere, so the renderer keeps roughness ≥ 0.75 and the sun's specular peak stays under L* 48: the
old lacquer lobe made one wet hot spot per clump).

Painting (vertex colour, sRGB ramps, rotation-invariant: terrain spins every instance): a value FIELD over
the crown (up-facing, open sky and occlusion cast against the cushions and wood only, height), blurred, then
each leaf's brushwork on top — dark at the stem where it tucks under the ring above, light toward its tip,
light ribs and darker valleys like a fan brushed in three strokes, a warm lit rim on the ribs — and hue
drift per pad, per leaf and per variant. Over all of it a baked value GRADIENT (r12 M11): × 0.45 (linear) at
the crown's bottom and in its occluded interior, rising to × 1.0 on the open top, so a crown reads as one lit
mass over its own shade. Every crown carries ≥ 20 plates, each scaled ±15 % and turned ±10° (roll and pitch)
off the shingle. Value stays in the environment's dark band (tokens grade.maps.rift.valueLstar, r12 B5):
canopy luma p50 45–60, p99 ≤ 115 at the gameplay camera.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from kit import Part, ellipsoid, fan_plate, frame, merge, smooth_normals, tube
from paint import Occluder, fbm3, hash01, hexc, ramp, smooth, srgb2lin


@dataclass
class Pad:
    """A cushion crowned by a fan rosette. `c` is the cushion's centre (authored m); the rosette's tips reach
    ~`r` from it."""
    c: tuple[float, float, float]
    r: float
    h: float = 0.34                               # cushion half-height
    n: int = 0                                    # leaves on the pad (0: from its size)
    tilt: float = 0.48                            # the dome's slope at the rim (rad below level)
    sq: float = 0.92                              # elliptic: y squash
    yaw: float = 0.0
    hang: float = 0.0                             # an off-axis pad tips this far (rad) out toward its offset
    leaf: float = 1.0                             # leaf length × this


@dataclass
class TreeSpec:
    seed: int
    pads: list[Pad]
    spine: list[tuple[float, float, float]]       # the trunk, foot → into the top pad
    r0: float                                     # trunk radius at the foot (above the root flare)
    roots: int = 3
    tint: str = "#808080"                         # the variant's hue drift (same value)
    reach: float = 9.0                            # max crown reach from the trunk's foot (authored m)
    scale: float = 1.0                            # the whole tree, uniformly (leaves too)


# leaves: deep cool teal underside → sap green → warm lit yellow-green crown (the hue turns with the value,
# like a painter's mix)
LEAF = [(0.00, "#0F1F28"), (0.15, "#142B2E"), (0.31, "#1B3833"), (0.48, "#264935"), (0.64, "#355A37"),
        (0.80, "#466839"), (0.92, "#58773F"), (1.00, "#6A8446")]
RIM = hexc("#C9C17A")          # warm chalky light on a lit rib tip (the lacquer's bevel)
HUES = [hexc("#71812E"), hexc("#3A6E5C"), hexc("#6E6C34"), hexc("#55853F"), hexc("#467A6E")]
HUE_W = 0.16                   # how far a leaf leans to its hue (same value)
TINT_W = 0.6                   # the variant's hue drift
BARK = [(0.00, "#1E1813"), (0.30, "#33281E"), (0.60, "#503F30"), (0.85, "#6C5643"), (1.00, "#857059")]
MOSS = hexc("#4A5C3A")

K_LEAF = 6                     # triangles per leaf (three lobes)
DOME_W, CROWN_W, OWN_W = 0.45, 0.35, 0.42   # shading normal: pad dome · whole crown · the leaf's own facet
RIB_T = 0.22                   # rib normals tilt out along the leaf, valleys in: the lacquer streaks per pleat
LAYER = 0.032                  # leaves nearer the tree's axis ride up to 2× this higher (m): the shingle
UPSTREAM = 0.44                # the stems' spread sits this far (× pad radius) toward the tree's axis
GAP = 0.045                    # the outer ring's stems ride this far over the cushion
STEM = 0.12                    # value: stem → tip ramp on every leaf
STROKE = 0.035                 # value: rib light / valley dark
PAD_TONE = 0.06                # value step between pads
BLUR = 0.10                    # the value field's softness (m)
PLATE_SCALE = 0.15             # every plate scaled ±15 % (r12 M11)
PLATE_TURN = math.radians(10)  # and turned ±10° (roll, pitch) off the shingle
PITCH_MAX = 0.62               # no plate descends steeper than this (rad below level)
GRAD_LO = 0.45                 # the baked value gradient (linear ×): crown bottom and interior → 1.0 on the open top


def _rot(axis: np.ndarray, ang: float) -> np.ndarray:
    a = np.asarray(axis, float) / np.linalg.norm(axis)
    K = np.array([[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]])
    return np.eye(3) + math.sin(ang) * K + (1 - math.cos(ang)) * K @ K


def _ell_normal(P: np.ndarray, c, r) -> np.ndarray:
    g = (np.atleast_2d(P) - np.asarray(c)) / np.asarray(r, float) ** 2
    return g / np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-9)


def build_pad(pi: int, pad: Pad, trunk_xy: np.ndarray, rng: np.random.Generator) -> list[Part]:
    """The cushion and its rosette, built round the origin, then squashed, turned, tipped and moved to the
    pad's place. Leaves carry dome / own normals separately (blended once the crown's form is known)."""
    r, h = pad.r, pad.h
    kappa = math.tan(pad.tilt) / (2 * r)                 # dome z = z0 − κ ρ²: slope tan(tilt) at ρ = r
    z0 = h + GAP
    parts = []
    # the FLOW: every leaf points out from the TREE's axis (the crown's gesture; the crown pad, on the axis,
    # takes one loose direction instead, so no pad has a flower's centre). Stems are an even Poisson-disk set
    # over the pad's top; leaves are sized so neighbours overlap; the further from the axis, the lower a leaf
    # lies (its stem tucks under the tips of the leaves nearer the axis: the shingle).
    off = np.asarray(pad.c[:2], float) - np.asarray(trunk_xy, float)
    cy, sy = math.cos(-pad.yaw), math.sin(-pad.yaw)
    if np.linalg.norm(off) > 0.2:
        fdir = off / np.linalg.norm(off)
        fdir = np.array([cy * fdir[0] - sy * fdir[1], sy * fdir[0] + cy * fdir[1]])
        radial = True
    else:
        a0 = rng.uniform(0, 2 * math.pi)
        fdir = np.array([math.cos(a0), math.sin(a0)])
        radial = False
    axis_xy = -fdir * (np.linalg.norm(off) if radial else 0.0)        # the tree's axis in the pad's frame
    n = pad.n or int(round(np.clip(14 * (r / 0.75) ** 1.2, 9, 18)))
    m = 600
    # stems over the pad's top, shifted upstream (toward the axis) so the leaves that start there cover the
    # pad's inner side too: a leaf covers only what lies downstream of its stem
    rr = 0.74 * r * np.sqrt(rng.uniform(size=m))
    aa = rng.uniform(0, 2 * math.pi, m)
    cand = np.column_stack([rr * np.cos(aa), rr * np.sin(aa)]) - UPSTREAM * r * fdir
    cand = cand[np.hypot(cand[:, 0], cand[:, 1]) < 0.86 * r]
    m = len(cand)

    def pick(dmin):
        acc = []
        for k in range(m):
            if not acc or np.min(np.linalg.norm(cand[acc] - cand[k], axis=1)) > dmin:
                acc.append(k)
        return acc
    lo_, hi_ = 0.02 * r, 1.2 * r
    for _ in range(16):
        mid = 0.5 * (lo_ + hi_)
        if len(pick(mid)) >= n:
            lo_ = mid
        else:
            hi_ = mid
    stems = cand[pick(lo_)[:n]]
    leaves = []
    for a_xy in stems:
        if radial:
            v = a_xy - axis_xy
            d2 = v / np.linalg.norm(v)
        else:
            d2 = fdir
        ang = math.atan2(d2[1], d2[0]) + rng.uniform(-0.35, 0.35)
        d2 = np.array([math.cos(ang), math.sin(ang)])
        # long enough to reach past the rim where it points out, never a stub
        ad = float(np.dot(a_xy, d2))
        t = -ad + math.sqrt(max(ad * ad - float(np.dot(a_xy, a_xy)) + (1.04 * r) ** 2, 0.0))
        L = float(np.clip(max(t, 0.55 * r), 0.45 * r, 0.80 * r)) * rng.uniform(1 - PLATE_SCALE, 1 + PLATE_SCALE) * pad.leaf
        spread = float(np.clip(1.5 * lo_ / (0.5 * L), 1.7, 2.5))
        key = float(np.dot(a_xy - axis_xy, d2))           # downstream: lower
        leaves.append((key, a_xy, d2, L, spread))
    keys = np.array([l[0] for l in leaves])
    kmin, kmax = keys.min(), max(keys.max(), keys.min() + 1e-3)
    leaves = [(2.0 * (1.0 - (l[0] - kmin) / (kmax - kmin)), *l[1:]) for l in leaves]
    for k, a_xy, d2, L, spread in leaves:
        ad = float(np.dot(a_xy, d2))
        d = np.array([d2[0], d2[1], 0.0])
        slope = 2 * kappa * ad                           # the dome's slope along the leaf at its stem
        ax = d - np.array([0, 0, slope])
        ax /= np.linalg.norm(ax)
        nz = np.array([2 * kappa * a_xy[0], 2 * kappa * a_xy[1], 1.0])
        nz /= np.linalg.norm(nz)
        lift = LAYER * k + rng.uniform(-0.003, 0.003)
        apex = np.array([a_xy[0], a_xy[1], z0 - kappa * float(np.dot(a_xy, a_xy)) + lift])
        # ±10° off the shingle: roll about the leaf's axis, pitch about its side (never steeper than PITCH_MAX
        # below level, so no plate turns edge-on to the 52° camera)
        roll = rng.uniform(-PLATE_TURN, PLATE_TURN)
        nz = nz + math.tan(roll) * np.cross(ax, nz)
        nz /= np.linalg.norm(nz)
        p = rng.uniform(-PLATE_TURN, PLATE_TURN)
        ax2 = ax * math.cos(p) + nz * math.sin(p)
        if ax2[2] < -math.sin(PITCH_MAX):
            p = abs(p)
            ax2 = ax * math.cos(p) + nz * math.sin(p)
        nz = nz * math.cos(p) - ax * math.sin(p)
        ax = ax2 / np.linalg.norm(ax2)
        leaf = fan_plate(L, spread * rng.uniform(0.94, 1.06), K=K_LEAF, crimp=rng.uniform(0.10, 0.16),
                         pleat=rng.uniform(0.012, 0.018), droop=kappa * L, curl=kappa * L * 0.5,
                         round_=rng.uniform(0.22, 0.32))
        part = leaf.transformed(frame(apex, ax, nz))
        # the dome normal at each vertex (local, before the pad's transform)
        Q = part.P
        nd = np.column_stack([2 * kappa * Q[:, 0], 2 * kappa * Q[:, 1], np.ones(len(Q))])
        part.A["ndx"], part.A["ndy"], part.A["ndz"] = nd[:, 0], nd[:, 1], nd[:, 2]
        part.A["ax_x"], part.A["ax_y"], part.A["ax_z"] = (np.broadcast_to(ax[i], (len(Q),)) for i in range(3))
        part.set(kind=1, ring=k, pad=pi, leafid=rng.uniform(), hue=rng.uniform(), gl=rng.uniform())
        parts.append(part)
    core = ellipsoid((0, 0, 0), (0.84 * r, 0.84 * r, h), seg=9, rings=3)
    core.set(kind=2, ring=-1, pad=pi, leafid=0.5, hue=0.5, gl=0.5)
    nd = _ell_normal(core.P, (0, 0, 0), (0.84 * r, 0.84 * r, h))
    core.A["ndx"], core.A["ndy"], core.A["ndz"] = nd[:, 0], nd[:, 1], nd[:, 2]
    for i in range(3):
        core.A[("ax_x", "ax_y", "ax_z")[i]] = np.zeros(len(core.P))
    parts.append(core)
    # the pad's transform: squash (y), turn, tip outward (off-axis pads), move
    c = np.asarray(pad.c, float)
    S = np.diag([1.0, pad.sq, 1.0])
    R = _rot([0, 0, 1], pad.yaw)
    off = c[:2] - trunk_xy
    if pad.hang and np.linalg.norm(off) > 1e-3:
        o = np.array([off[0], off[1], 0.0]) / np.linalg.norm(off)
        R = _rot(np.cross([0, 0, 1.0], o), pad.hang) @ R
    M = R @ S
    Mn = np.linalg.inv(M).T
    for p in parts:
        p.P = p.P @ M.T + c
        p.N = p.N @ Mn.T
        p.N /= np.maximum(np.linalg.norm(p.N, axis=1, keepdims=True), 1e-9)
        nd = np.column_stack([p.A["ndx"], p.A["ndy"], p.A["ndz"]]) @ Mn.T
        nd /= np.maximum(np.linalg.norm(nd, axis=1, keepdims=True), 1e-9)
        p.A["ndx"], p.A["ndy"], p.A["ndz"] = nd[:, 0], nd[:, 1], nd[:, 2]
        ax = np.column_stack([p.A["ax_x"], p.A["ax_y"], p.A["ax_z"]]) @ M.T
        p.A["ax_x"], p.A["ax_y"], p.A["ax_z"] = ax[:, 0], ax[:, 1], ax[:, 2]
    return parts


def build_tree(spec: TreeSpec) -> Part:
    rng = np.random.default_rng(spec.seed)
    spine = np.asarray(spec.spine, float)
    parts: list[Part] = []
    for pi, pad in enumerate(spec.pads):
        zc = pad.c[2]
        k = int(np.clip(np.searchsorted(spine[:, 2], zc), 1, len(spine) - 1))
        f = (zc - spine[k - 1, 2]) / max(spine[k, 2] - spine[k - 1, 2], 1e-6)
        txy = spine[k - 1, :2] * (1 - f) + spine[k, :2] * f if zc <= spine[-1, 2] else spine[-1, :2]
        parts += build_pad(pi, pad, txy, rng)
    # trunk: six facets, a flare ring at the foot that alternates root buttress and hollow
    n_s = len(spine)
    rad = spec.r0 * np.linspace(1.0, 0.42, n_s) ** 1.2
    rad[1] = spec.r0 * 0.88
    sides = 6
    trunk = tube(spine, rad, sides=sides, rng=rng, jitter=0.07, phase=rng.uniform(0, 1))
    for kk in range(sides):
        root = kk % 2 == 0 and kk // 2 < spec.roots
        for ring, (fl, dz) in enumerate(((2.1, -0.04), (1.25, 0.0)) if root else ((1.2, 0.0), (1.05, 0.0))):
            vi = ring * sides + kk
            d = trunk.P[vi] - spine[ring]
            d[2] = 0.0
            trunk.P[vi] = spine[ring] + d * fl + np.array([0, 0, dz])
    trunk.N = smooth_normals(trunk.P, trunk.F)
    parts.append(trunk.set(kind=3))
    # limbs into every off-axis pad (seen between the tiers: the tree's gesture)
    zs = spine[:, 2]
    for pad in spec.pads:
        end = np.asarray(pad.c, float) - np.array([0, 0, pad.h * 0.4])
        z = float(np.clip(end[2] - 0.55, zs[0] + 0.45, zs[-1] - 0.15))
        j = int(np.clip(np.searchsorted(zs, z), 1, len(zs) - 1))
        f = (z - zs[j - 1]) / max(zs[j] - zs[j - 1], 1e-6)
        start = spine[j - 1] * (1 - f) + spine[j] * f
        if np.linalg.norm((end - start)[:2]) < 0.28:
            continue
        rr = rad[j - 1] * (1 - f) + rad[j] * f
        mid = start + (end - start) * 0.5 + np.array([0, 0, 0.10])
        parts.append(tube([start, mid, end], [rr * 0.62, rr * 0.45, rr * 0.3], sides=5, rng=rng, jitter=0.05).set(kind=3))
    t = merge(parts)
    t.P *= spec.scale
    # the crown's form: one ellipsoid round all the foliage
    leafy = (t.A["kind"] == 1) | (t.A["kind"] == 2)
    lo, hi = t.P[leafy].min(0), t.P[leafy].max(0)
    cc = 0.5 * (lo + hi) - np.array([0, 0, 0.12 * (hi[2] - lo[2])])
    cr = np.maximum(0.5 * (hi - lo), 0.3) * np.array([1.0, 1.0, 1.15])
    ncr = _ell_normal(t.P, cc, cr)
    nd = np.column_stack([t.A["ndx"], t.A["ndy"], t.A["ndz"]])
    ax = np.column_stack([t.A["ax_x"], t.A["ax_y"], t.A["ax_z"]])
    leaf = t.A["kind"] == 1
    core = t.A["kind"] == 2
    lobe = t.A.get("lobe", np.zeros(len(t.P)))
    u = t.A.get("u", np.zeros(len(t.P)))
    nl = DOME_W * nd + CROWN_W * ncr + OWN_W * t.N + RIB_T * (lobe * u)[:, None] * ax
    nc = 0.62 * nd + 0.38 * ncr
    N = t.N.copy()
    N[leaf] = nl[leaf]
    N[core] = nc[core]
    t.N = N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)
    t.A["cnz"] = ncr[:, 2]                                       # the crown's up-facing (paint)
    t.A["dnz"] = nd[:, 2]                                        # the pad dome's up-facing (paint)
    for k in ("ndx", "ndy", "ndz", "ax_x", "ax_y", "ax_z"):
        del t.A[k]
    # hold the crown's reach (the lane-edge occlusion budget): draw the crown in horizontally
    reach = float(np.hypot(t.P[leafy, 0], t.P[leafy, 1]).max())
    if reach > spec.reach:
        f = spec.reach / reach
        t.P[leafy, :2] *= f
        n = t.N[leafy] * np.array([1 / f, 1 / f, 1.0])
        t.N[leafy] = n / np.linalg.norm(n, axis=1, keepdims=True)
    return t


def _lin2srgb(c: np.ndarray) -> np.ndarray:
    c = np.clip(np.asarray(c, float), 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def _lum(c: np.ndarray) -> np.ndarray:
    return (c @ np.array([0.2126, 0.7152, 0.0722]))[:, None]


def _keep_lum(c: np.ndarray, ref: np.ndarray) -> np.ndarray:
    """c re-scaled to ref's luminance: hue moves, the value structure stays."""
    return c * (_lum(ref) / np.maximum(_lum(c), 1e-6))


def _blur(P: np.ndarray, x: np.ndarray, sigma: float) -> np.ndarray:
    """Gaussian blur of a per-vertex field over 3-D distance: the crown's value is painted in soft masses,
    never in leaf-sized steps."""
    d2 = ((P[:, None, :] - P[None, :, :]) ** 2).sum(-1)
    w = np.exp(-d2 / (2 * sigma * sigma))
    return (w @ x) / w.sum(1)


def paint_tree(t: Part, seed: int, tint: str = "#808080") -> tuple[np.ndarray, np.ndarray]:
    """→ sRGB colours (n,3) and the GLOSS mask (n,) for COLOR_0.a (0 everywhere since r12 M11: matte plates)."""
    P, N, A = t.P, t.N, t.A
    kind = A["kind"]
    leaf = kind == 1
    core = kind == 2
    leafy = leaf | core
    proxy = ~leaf[t.F].any(1)                                    # cushions + wood: the crown's closed body
    occ = Occluder(P, t.F[proxy], ground=True)
    O = P + N * np.where(leafy, 0.06, 0.012)[:, None]
    ao = occ.ao(O, N, rays=32, dist=1.0, eps=0.0)
    sky = occ.sky(O, N, rays=24, cone_deg=60.0, dist=12.0, eps=0.0)
    col = np.zeros((len(P), 3))
    gloss = np.zeros(len(P))
    z = P[:, 2]
    zl = z[leafy]
    hgt = np.zeros(len(P))
    hgt[leafy] = smooth(zl.min() + 0.1, zl.max(), zl)
    u = A.get("u", np.zeros(len(P)))
    lobe = A.get("lobe", np.zeros(len(P)))
    pad = A.get("pad", np.zeros(len(P)))
    ring = A.get("ring", np.zeros(len(P)))
    lid = A.get("leafid", np.full(len(P), 0.5))
    dnz, cnz = A.get("dnz", N[:, 2]), A.get("cnz", N[:, 2])
    # ── the crown's big form: up-facing (dome, crown, shading normal), open sky, height ──
    form = 0.12 * smooth(-0.5, 0.95, dnz) + 0.24 * smooth(-0.7, 0.95, cnz) + 0.12 * smooth(-0.6, 0.95, N[:, 2]) \
        + 0.30 * sky + 0.22 * hgt
    v = 0.03 + 0.87 * form
    v *= 0.42 + 0.58 * smooth(0.12, 0.95, ao)
    v += PAD_TONE * (hash01(pad * 1.31 + seed * 3.1) - 0.5)       # every pad its own tone
    vb = v.copy()
    vb[leafy] = _blur(P[leafy], v[leafy], BLUR)
    v = np.where(leafy, vb, v)
    # ── then each leaf's brushwork: dark where it tucks under the ring above, light toward the tip; the ribs
    # lighter, the valleys darker (three strokes from the stem); stronger where the light falls ──
    lit = smooth(0.25, 0.85, sky) * smooth(-0.1, 0.7, N[:, 2])
    v += np.where(leaf, STEM * (u - 0.62) * (0.45 + 0.55 * lit), 0.0)
    v += np.where(leaf, STROKE * lobe * u * (0.35 + 0.65 * lit) + 0.025 * (lid - 0.5), 0.0)
    v = np.where(core, v - 0.11, v)                               # the cushions: inner foliage, deeper in shade (the gaps read as depth)
    c = ramp(np.clip(v, 0, 1), LEAF)
    # leaf hue at the same value (yellow-green / blue-green / olive / fresh / jade), mixed per leaf
    hue = A.get("hue", np.zeros(len(P)))
    hk = np.floor(hue * len(HUES)).astype(int) % len(HUES)
    hc = np.array([HUES[k] for k in hk])
    hw = HUE_W * leaf
    c = c * (1 - hw[:, None]) + _keep_lum(hc, c) * hw[:, None]
    # every pad leans warmer (sun-fed) or cooler, like paint mixed per mass; the tips of the lit crown warmer
    warm = hash01(pad * 1.37 + seed * 0.71) - 0.5
    c = c * (1 + (0.22 * warm + 0.10 * (lit * u - 0.3) * leaf)[:, None] * np.array([0.9, 0.35, -1.2]))
    tv = hexc(tint)
    c = _keep_lum(c * (1 + TINT_W * (tv - 0.5)), c)
    rim = smooth(0.4, 0.9, lit) * u * (lobe > 0) * leaf * smooth(0.3, 0.8, ao)
    c = c + (RIM - c) * (0.20 * rim)[:, None]                       # warm lit rib tips (the lacquer's bevel)
    # the baked value gradient (r12 M11): × GRAD_LO (linear) at the crown's bottom and in its occluded interior,
    # × 1 on the open top — height over the foliage, openness (occlusion) and the open sky
    open_ = smooth(0.25, 0.9, ao)
    w = np.clip(0.58 * hgt + 0.24 * open_ + 0.18 * smooth(0.15, 0.8, sky), 0, 1)
    w = np.where(core, 0.6 * w, w)
    g = GRAD_LO + (1 - GRAD_LO) * smooth(0.0, 1.0, w)
    c = _lin2srgb(srgb2lin(np.clip(c, 0, 1)) * g[:, None])
    col[leafy] = c[leafy]
    # no lacquer (r12 M11): the gloss mask stays 0 on plates, cushions and bark alike — matte paint only
    # ── bark ──
    bark = kind == 3
    s = A.get("s", np.zeros(len(P)))
    streak = hash01(np.floor(s * 6) + seed, np.floor(z * 2.0))
    bv = 0.24 + 0.38 * sky + 0.16 * (0.5 + 0.5 * N[:, 2]) + 0.12 * (streak - 0.5) + 0.10 * fbm3(P, 3.0, 2, seed)
    bv *= 0.45 + 0.55 * ao
    bv *= 0.62 + 0.38 * smooth(-0.05, 0.6, z)                    # the foot in the shade of its roots
    bc = ramp(np.clip(bv, 0, 1), BARK)
    moss = smooth(0.45, 0.05, z) * smooth(0.0, 0.6, N[:, 2] + 0.3) * (fbm3(P, 4.0, 2, seed + 3) > 0.42)
    bc = bc * (1 - 0.6 * moss[:, None]) + MOSS * (0.6 * moss[:, None]) * (0.7 + 0.5 * ao[:, None])
    col[bark] = bc[bark]
    return np.clip(col, 0, 1), gloss


# ── the Dialwood variants (authored size; render/terrain.ts scales each to the room its spot has) ─────
TREES: dict[str, TreeSpec] = {
    # tall: an egg of pads round a straight bole — two low shoulders, one mid, two crown lobes (no pad on the
    # axis: from above the crown parts round its centre like a real tree's, no single "head")
    "dialwood_tall": TreeSpec(
        seed=7, tint="#5E8E86",                                    # jade: the coolest
        spine=[(0, 0, 0), (0.02, 0.0, 0.34), (0.05, 0.01, 1.2), (-0.03, 0.03, 1.9), (0.02, -0.01, 2.25)],
        pads=[Pad((0.34, -0.16, 1.04), 0.78, 0.36, hang=0.18, yaw=0.3),
              Pad((-0.36, 0.20, 1.18), 0.74, 0.35, hang=0.18, yaw=1.9, sq=0.9),
              Pad((0.06, 0.40, 1.70), 0.68, 0.34, hang=0.16, yaw=3.0),
              Pad((0.26, -0.20, 2.20), 0.58, 0.31, hang=0.12, yaw=4.4, sq=0.9),
              Pad((-0.24, 0.10, 2.32), 0.56, 0.30, hang=0.12, yaw=0.9)],
        r0=0.20, reach=1.30, scale=1.10),
    # broad: an umbrella — two crown lobes over two drooping side pads on spreading limbs
    "dialwood_broad": TreeSpec(
        seed=19, tint="#7E8A70",                                   # sap green (near neutral)
        spine=[(0, 0, 0), (0.02, 0.0, 0.34), (0.04, 0.0, 1.0), (0.03, 0.02, 1.75)],
        pads=[Pad((0.30, 0.20, 1.90), 0.74, 0.34, hang=0.10, yaw=0.2),
              Pad((-0.32, -0.18, 1.84), 0.72, 0.34, hang=0.10, yaw=2.2, sq=0.9),
              Pad((-0.30, 0.86, 1.40), 0.74, 0.34, hang=0.18, yaw=1.1, sq=0.88),
              Pad((0.40, -0.84, 1.34), 0.72, 0.33, hang=0.18, yaw=4.0, sq=0.9)],
        r0=0.23, reach=1.64, scale=1.07),
    # squat: a trunkless mound — a wide skirt pad near the ground, two shoulders, a small crown lobe
    "dialwood_squat": TreeSpec(
        seed=31, tint="#9C8E60",                                   # warm olive-gold
        spine=[(0, 0, 0), (0.0, 0.0, 0.3), (0.05, 0.02, 0.8), (0.0, 0.04, 1.3)],
        pads=[Pad((0.0, 0.0, 0.52), 1.10, 0.30, tilt=0.5, yaw=0.5, sq=0.9),
              Pad((0.44, 0.24, 0.98), 0.72, 0.33, hang=0.18, yaw=1.9),
              Pad((-0.42, -0.20, 1.06), 0.68, 0.32, hang=0.18, yaw=3.3, sq=0.88),
              Pad((-0.10, 0.36, 1.38), 0.52, 0.28, hang=0.12, yaw=0.9)],
        r0=0.24, roots=3, reach=1.59, scale=1.34),
    # young: a slim, swaying stem with three small pads; its trunk shows
    "dialwood_young": TreeSpec(
        seed=43, tint="#8EA860",                                   # fresh spring green
        spine=[(0, 0, 0), (0.03, 0.0, 0.3), (0.13, 0.02, 0.95), (-0.04, 0.05, 1.55), (0.06, 0.0, 2.0)],
        pads=[Pad((0.32, 0.06, 1.42), 0.62, 0.30, hang=0.18, yaw=0.7),
              Pad((-0.22, -0.14, 1.64), 0.52, 0.27, hang=0.18, yaw=4.0),
              Pad((0.16, -0.18, 2.04), 0.54, 0.28, hang=0.12, yaw=2.4, sq=0.9)],
        r0=0.14, roots=2, reach=1.14, scale=1.22),
    # leaning: the bole bends out; pads step up along it, a small one left behind near the foot
    "dialwood_lean": TreeSpec(
        seed=59, tint="#748C7C",                                   # sage-teal
        spine=[(0, 0, 0), (0.04, 0.0, 0.32), (0.22, 0.02, 0.95), (0.52, 0.05, 1.55), (0.80, 0.04, 2.05)],
        pads=[Pad((-0.14, 0.22, 1.02), 0.62, 0.30, hang=0.18, yaw=0.4),
              Pad((0.40, -0.10, 1.58), 0.86, 0.35, hang=0.12, yaw=1.7, sq=0.9),
              Pad((0.92, 0.30, 1.86), 0.60, 0.30, hang=0.18, yaw=5.0),
              Pad((0.64, -0.26, 2.22), 0.56, 0.29, hang=0.12, yaw=3.1)],
        r0=0.20, reach=1.76, scale=1.16),
}
