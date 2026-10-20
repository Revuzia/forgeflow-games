"""Dialwood trees (RIFT brief §6: "lacquered fan-leaved plates, bevelled, instanced").

Budget first: RIFT instances ~920 trees (×2 with the shadow pass), so a tree is ≤ 750 triangles (average
~600). Silhouette second: the 52° camera sees a crown from above, and every variant must keep units on the
road beside its block in view, so trees are short (≤ 3.4 m in game, the brief's south-of-play cap) and a
crown overhangs its trunk by ≤ 1.6 m.

A crown is an envelope with PUFFS (clumps) budding from its upper surface. Single-sided fan leaves (5
triangles each: a stem and a rounded, pleated leading edge) are dealt over the exposed hull of all of them
at once (a Poisson-disk pick: even cover, nothing spent inside, no spiral rosette), each lying down its
puff's slope with a free twist, so every fan edge stands a little off the one below and the silhouette is
scalloped with fans. Closed low cores (the envelope's, and a 12-triangle bipyramid per puff) fill whatever
a leaf turned away from the camera would show. Each leaf takes its puff's normal blended with the crown's
and a little of its own pleat: a clump shades as one soft painted mass in the real sun (lit crown, cool
turned-away side), the fans read through their scalloped edges, pleats and a gentle stem-to-edge ramp, not
as salt-and-pepper facets. Pleats are the dial's hour-lines radiating from each stem.

Painting (vertex colour, sRGB ramps, rotation-invariant: terrain spins every instance): the puff's big form
(up-facing of the puff normal, sky visibility, height in the tree), occlusion where puffs tuck into each
other, a darker stem and a warm chalky lit edge on every fan, a pale lacquer glint on the lit ribs, and a
small per-variant drift (warmer, cooler, fresher) so the forest never reads as copies. The value range is
held below the roads: the lit crown lands ~L* 50 on screen, the cool underside ~L* 18, never black.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

from kit import Part, ellipsoid, fan_leaf, frame, merge, smooth_normals, tube
from paint import Occluder, fbm3, hash01, hexc, ramp, smooth


@dataclass
class Puff:
    c: np.ndarray
    rh: float
    rv: float
    crown: int
    env: bool = False                             # the crown's envelope itself (its exposed flanks take leaves too)


@dataclass
class Crown:
    """A crown mass: an envelope ellipsoid with `n` puffs (leaf clumps) budding from its upper surface plus
    one on its top, so the silhouette is lumpy with clumps of fans. Leaves are dealt over the exposed hull
    of all of them at once (even cover, nothing wasted inside), `leaves` in all."""
    c: tuple[float, float, float]
    rh: float
    rv: float
    n: int                                        # puffs round the envelope (the top one comes on its own)
    pr: float                                     # mean puff radius (m)
    leaves: int = 60                              # fan leaves on this crown
    cap: float = 1.05                             # puffs bud from the top down to this polar angle (rad)


@dataclass
class TreeSpec:
    seed: int
    crowns: list[Crown]
    top: float                                    # trunk height (it ends inside the top crown)
    r0: float                                     # trunk radius at the foot (above the root flare)
    lean: tuple[float, float] = (0.0, 0.0)        # where the trunk top leans to (m)
    bow: float = 0.0
    leaf_len: float = 0.50                        # nominal fan length (m)
    roots: int = 3                                # root buttresses (the flare ring alternates root / hollow)
    tint: str = "#808080"                         # the variant's leaf drift (×(1 + 0.5·(tint − 0.5)); grey = none)


# leaves: deep cool blue-green → sap green → warm lit yellow-green; on screen the canopy lands L* ~20–55,
# its lit crown kept a full step under the pale roads (L* ~66), its shade never black
LEAF = [(0.00, "#152822"), (0.16, "#1B342B"), (0.34, "#234430"), (0.52, "#315435"), (0.68, "#43643A"),
        (0.84, "#5A743F"), (1.00, "#728447")]
RIM = hexc("#B3AE70")          # warm chalky light on a lit fan edge
SHEEN = hexc("#B8C4A2")        # lacquer: a cool pale glint on a lit rib
HUES = [hexc("#56703A"), hexc("#41664A"), hexc("#5E6B35")]   # per-leaf drift: yellow-green, blue-green, olive
BARK = [(0.00, "#1C1612"), (0.30, "#30261D"), (0.60, "#4A3C2F"), (0.85, "#655240"), (1.00, "#7A6650")]
MOSS = hexc("#46593A")
LIFT = 0.16                    # how far (rad) a fan's edge stands off its puff


def _ell_normal(P: np.ndarray, c, rh: float, rv: float) -> np.ndarray:
    g = (np.atleast_2d(P) - np.asarray(c)) / np.array([rh, rh, rv]) ** 2
    return g / np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-9)


def _inside(p: np.ndarray, c, rh: float, rv: float, k: float) -> bool:
    d = (p - np.asarray(c)) / (np.array([rh, rh, rv]) * k)
    return float(np.dot(d, d)) < 1.0


def _puffs(ci: int, cr: Crown, rng: np.random.Generator) -> list[Puff]:
    """The envelope, puff centres on its upper surface (golden-angle spread, jittered) sunk in by ~40 % of
    their radius (the crown's core reaches under their leaves), and the top puff."""
    C = np.asarray(cr.c, float)
    out = [Puff(C, cr.rh, cr.rv, ci, env=True),
           Puff(C + np.array([rng.uniform(-0.08, 0.08), rng.uniform(-0.08, 0.08), cr.rv * 0.72]), cr.pr * 1.06, cr.pr * 0.80, ci)]
    ga = math.pi * (3 - math.sqrt(5))
    az0 = rng.uniform(0, 2 * math.pi)
    for k in range(cr.n):
        f = (k + 0.5) / cr.n
        th = 0.45 * cr.cap + 0.55 * cr.cap * math.sqrt(f) + rng.uniform(-0.08, 0.08)
        az = az0 + k * ga * (cr.n / max(cr.n - 1, 1)) + rng.uniform(-0.25, 0.25)
        s = np.array([math.sin(th) * math.cos(az), math.sin(th) * math.sin(az), math.cos(th)])
        r = cr.pr * rng.uniform(0.85, 1.15)
        n = _ell_normal(C + s * [cr.rh, cr.rh, cr.rv], C, cr.rh, cr.rv)[0]
        out.append(Puff(C + s * np.array([cr.rh, cr.rh, cr.rv]) - n * 0.42 * r, r, r * 0.80, ci))
    return out


def _hull_sites(puffs: list[Puff], n: int, rng: np.random.Generator, th_max: float = 2.05):
    """n well-spaced sites on the exposed hull (the union of the puffs' surfaces, down to th_max on each):
    a dense random sample, then a greedy Poisson-disk pick whose spacing is bisected to land on n.
    → [(puff index, polar, azimuth, point)], spacing."""
    cand = []
    for i, pf in enumerate(puffs):
        m = int(900 * pf.rh * max(pf.rh, pf.rv))
        for _ in range(m):
            th = math.acos(1 - (1 - math.cos(th_max)) * rng.uniform())
            az = rng.uniform(0, 2 * math.pi)
            p = pf.c + np.array([pf.rh * math.sin(th) * math.cos(az), pf.rh * math.sin(th) * math.sin(az), pf.rv * math.cos(th)])
            if any(_inside(p, q.c, q.rh, q.rv, 0.98) for j, q in enumerate(puffs) if j != i):
                continue
            cand.append((i, th, az, p))
    order = rng.permutation(len(cand))
    pts = np.array([c[3] for c in cand])

    def pick(d):
        acc = []
        for k in order:
            if not acc or np.min(np.linalg.norm(pts[acc] - pts[k], axis=1)) > d:
                acc.append(k)
        return acc
    lo, hi = 0.05, 1.5
    for _ in range(18):
        mid = 0.5 * (lo + hi)
        if len(pick(mid)) > n:
            lo = mid
        else:
            hi = mid
    acc = pick(hi)
    return [cand[k] for k in acc], hi


def crown_leaves(ci: int, cr: Crown, puffs: list[Puff], spec: TreeSpec, rng: np.random.Generator) -> list[Part]:
    mine = [p for p in puffs if p.crown == ci]
    sites, d = _hull_sites(mine, cr.leaves, rng)
    L0 = min(spec.leaf_len, max(0.3, 1.45 * d))
    parts = []
    for i, th, az, p in sorted(sites, key=lambda s: s[3][2], reverse=True):
        pf = mine[i]
        rh, rv = pf.rh, pf.rv
        lat = th / 2.05
        s = np.array([math.sin(th) * math.cos(az), math.sin(th) * math.sin(az), math.cos(th)])
        ns = s / np.array([rh, rh, rv]); ns /= np.linalg.norm(ns)
        dt = np.array([rh * math.cos(th) * math.cos(az), rh * math.cos(th) * math.sin(az), -rv * math.sin(th)])
        dt /= np.linalg.norm(dt)
        psi = rng.uniform(-math.pi, math.pi) if th < 0.42 else rng.uniform(-0.9, 0.9)
        bt = np.cross(ns, dt)
        dt = math.cos(psi) * dt + math.sin(psi) * bt
        lift = LIFT * (0.6 + 0.9 * min(lat, 1.0)) + rng.uniform(-0.04, 0.04)
        axis = math.cos(lift) * dt + math.sin(lift) * ns
        nrm = -math.sin(lift) * dt + math.cos(lift) * ns
        roll = rng.uniform(-0.2, 0.2)
        side = np.cross(axis, nrm)
        nrm = math.cos(roll) * nrm + math.sin(roll) * side
        L = L0 * rng.uniform(0.88, 1.12)
        apex = p - axis * 0.40 * L - ns * 0.05 * L
        leaf = fan_leaf(L, rng.uniform(1.95, 2.3), K=5, pleat=rng.uniform(0.016, 0.024),
                        droop=0.10 + 0.08 * min(lat, 1.0), curl=rng.uniform(0.07, 0.12), round_=rng.uniform(0.16, 0.24))
        part = leaf.transformed(frame(apex, axis, nrm))
        pn = _ell_normal(part.P, pf.c, rh, rv)
        en = _ell_normal(part.P, cr.c, cr.rh, cr.rv)
        n = 0.66 * pn + 0.34 * en + 0.18 * part.N
        part.N = n / np.linalg.norm(n, axis=1, keepdims=True)
        part.set(kind=1, lat=lat, jit=rng.uniform(), hue=rng.integers(0, len(HUES)), puff=ci * 16 + i)
        part.A["pnz"] = part.N[:, 2].copy()
        parts.append(part)
    return parts


def build_tree(spec: TreeSpec) -> Part:
    rng = np.random.default_rng(spec.seed)
    parts: list[Part] = []
    puffs = [p for ci, cr in enumerate(spec.crowns) for p in _puffs(ci, cr, rng)]
    for ci, cr in enumerate(spec.crowns):
        parts += crown_leaves(ci, cr, puffs, spec, rng)
    for ci, cr in enumerate(spec.crowns):                        # the crown's closed core: shade, never daylight
        core = ellipsoid(np.asarray(cr.c) - np.array([0, 0, 0.04 * cr.rv]), (cr.rh * 0.97, cr.rh * 0.97, cr.rv * 0.95),
                         seg=7, rings=4)                         # (the leaves cover the puffs; no core of their own)
        core.N = _ell_normal(core.P, cr.c, cr.rh, cr.rv)
        core.set(kind=2, lat=1.0, jit=0.5)
        core.A["pnz"] = core.N[:, 2].copy()
        parts.append(core)
    for ci, cr in enumerate(spec.crowns):                        # each puff a 12-triangle bipyramid core: no daylight
        for i, pf in enumerate([p for p in puffs if p.crown == ci]):  # in the pockets between its leaves and the next puff's
            if pf.env:
                continue
            core = ellipsoid(pf.c - np.array([0, 0, 0.06 * pf.rv]), (pf.rh * 0.84, pf.rh * 0.84, pf.rv * 0.84), seg=6, rings=2)
            n = 0.66 * _ell_normal(core.P, pf.c, pf.rh, pf.rv) + 0.34 * _ell_normal(core.P, cr.c, cr.rh, cr.rv)
            core.N = n / np.linalg.norm(n, axis=1, keepdims=True)
            core.set(kind=2, lat=1.0, jit=0.5, puff=ci * 16 + i)
            core.A["pnz"] = core.N[:, 2].copy()
            parts.append(core)
    # trunk: six facets, a flare ring at the foot that alternates root buttress and hollow
    spine = np.asarray(_spine(spec.top, spec.lean, spec.bow), float)
    rad = spec.r0 * np.array([1.0, 0.86, 0.56, 0.34])
    sides = 6
    trunk = tube(spine, rad, sides=sides, rng=rng, jitter=0.07, phase=rng.uniform(0, 1))
    for k in range(sides):
        root = k % 2 == 0 and k // 2 < spec.roots
        for ring, (f, dz) in enumerate(((2.1, -0.04), (1.25, 0.0)) if root else ((1.2, 0.0), (1.05, 0.0))):
            vi = ring * sides + k
            d = trunk.P[vi] - spine[ring]
            d[2] = 0.0
            trunk.P[vi] = spine[ring] + d * f + np.array([0, 0, dz])
    trunk.N = smooth_normals(trunk.P, trunk.F)
    parts.append(trunk.set(kind=3))
    # limbs: into every off-axis crown, and two into the largest outer puffs of the lowest crown
    zs = spine[:, 2]
    targets = [np.asarray(cr.c) - np.array([0, 0, cr.rv * 0.3]) for cr in spec.crowns]
    low = [p for p in puffs if p.crown == 0 and not p.env][1:]
    low.sort(key=lambda p: -np.linalg.norm(p.c[:2] - np.asarray(spec.crowns[0].c)[:2]))
    targets += [p.c - np.array([0, 0, p.rv * 0.5]) for p in low[:2]]
    for end in targets:
        z = np.clip(end[2] - 0.75, zs[0] + 0.7, zs[-1] - 0.2)
        j = int(np.clip(np.searchsorted(zs, z), 1, len(zs) - 1))
        f = (z - zs[j - 1]) / max(zs[j] - zs[j - 1], 1e-6)
        start = spine[j - 1] * (1 - f) + spine[j] * f
        rr = rad[j - 1] * (1 - f) + rad[j] * f
        if np.linalg.norm((end - start)[:2]) < 0.45:
            continue
        mid = start + (end - start) * 0.5 + np.array([0, 0, 0.15])
        parts.append(tube([start, mid, end], [rr * 0.6, rr * 0.42, rr * 0.26], sides=5, rng=rng, jitter=0.05).set(kind=3))
    return merge(parts)


def paint_tree(t: Part, seed: int, tint: str = "#808080") -> np.ndarray:
    """→ sRGB colours (n,3)."""
    P, N, A = t.P, t.N, t.A
    kind = A["kind"]
    occ = Occluder(P, t.F, ground=True)
    ao = occ.ao(P, N, rays=24, dist=0.9)
    sky = occ.sky(P, N, rays=24, cone_deg=60.0, dist=12.0)
    col = np.zeros((len(P), 3))
    leafy = (kind == 1) | (kind == 2)
    z = P[:, 2]
    zl = z[leafy]
    h = np.zeros(len(P))
    h[leafy] = smooth(zl.min() + 0.2, zl.max(), zl)
    pnz = A.get("pnz", N[:, 2])
    u = A.get("u", np.zeros(len(P)))
    lobe = A.get("lobe", np.zeros(len(P)))
    jit = A.get("jit", np.full(len(P), 0.5))
    # ── the puff's big form first: one soft painted mass per puff ──
    form = 0.42 * smooth(-0.55, 0.95, pnz) + 0.36 * sky + 0.22 * h
    v = 0.10 + 0.86 * form
    v *= 0.60 + 0.40 * smooth(0.25, 0.95, ao)                    # tucked under / between puffs
    v += 0.05 * (hash01(A.get("puff", np.zeros(len(P))) + seed * 3.1) - 0.5)   # every clump its own tone
    # ── then each fan, gently: a darker stem, its edge a touch lighter, ribs over valleys ──
    leaf = kind == 1
    lat = A.get("lat", np.ones(len(P)))
    v += np.where(leaf, -0.045 * (1 - u) * smooth(0.15, 0.4, lat) + 0.02 * u * lobe + 0.025 * (jit - 0.5), 0.0)
    v = np.where(kind == 2, v - 0.04, v)                         # the cores sit just behind the fans
    c = ramp(np.clip(v, 0, 1), LEAF)
    hue = np.array([HUES[int(i) % len(HUES)] for i in A.get("hue", np.zeros(len(P)))])
    c = c * 0.9 + hue * 0.1 * (c.mean(1, keepdims=True) / hue.mean(1, keepdims=True))
    # every clump leans a little warmer (sun-fed, yellow-green) or cooler (blue-green), like paint mixed per mass
    warm = hash01(A.get("puff", np.zeros(len(P))) * 1.37 + seed * 0.71) - 0.5
    c = c * (1 + 0.22 * warm[:, None] * np.array([0.9, 0.35, -1.2]))
    tv = hexc(tint)
    c = c * (1 + 0.5 * (tv - 0.5))                               # the variant's drift
    lit = smooth(0.35, 0.85, sky) * smooth(0.1, 0.8, pnz) * smooth(0.4, 0.9, ao)
    c = c + (RIM - c) * (0.16 * lit * u * leaf)[:, None]                   # warm lit fan edges (the bevel)
    c = c + (SHEEN - c) * (0.14 * lit * u * (lobe > 0) * leaf * (jit > 0.45))[:, None]   # lacquer glint
    col[leafy] = c[leafy]
    # ── bark ──
    bark = kind == 3
    s = A.get("s", np.zeros(len(P)))
    streak = hash01(np.floor(s * 6) + seed, np.floor(z * 2.0))
    bv = 0.22 + 0.36 * sky + 0.16 * (0.5 + 0.5 * N[:, 2]) + 0.12 * (streak - 0.5) + 0.10 * fbm3(P, 3.0, 2, seed)
    bv *= 0.45 + 0.55 * ao
    bv *= 0.62 + 0.38 * smooth(-0.05, 0.6, z)                    # the foot in the shade of its roots
    bc = ramp(np.clip(bv, 0, 1), BARK)
    moss = smooth(0.45, 0.05, z) * smooth(0.0, 0.6, N[:, 2] + 0.3) * (fbm3(P, 4.0, 2, seed + 3) > 0.42)
    bc = bc * (1 - 0.6 * moss[:, None]) + MOSS * (0.6 * moss[:, None]) * (0.7 + 0.5 * ao[:, None])
    col[bark] = bc[bark]
    return np.clip(col, 0, 1)


# ── the five Dialwood variants (authored size; the terrain scales a tree ×0.74–0.87) ─────────────
def _spine(top, lean=(0.0, 0.0), bow=0.0):
    t = np.array([0.0, 0.34 / top, 0.62, 1.0])                  # foot, root-flare top, mid, into the crown
    x = lean[0] * t ** 1.4 + bow * np.sin(t * math.pi)
    y = lean[1] * t ** 1.4
    return [tuple(p) for p in np.column_stack([x, y, t * top])]


TREES: dict[str, TreeSpec] = {
    # tall: an egg-shaped crown, clumps budding all the way down its flanks
    "dialwood_tall": TreeSpec(
        seed=7, tint="#6E8A8E",
        crowns=[Crown((0.0, 0.0, 2.05), 0.95, 1.08, 6, 0.50, 74, cap=1.8)],
        top=2.8, r0=0.21, lean=(0.08, -0.05), bow=0.05),
    # broad: a wide umbrella of clumps on spreading limbs, its skirt low
    "dialwood_broad": TreeSpec(
        seed=19,
        crowns=[Crown((0.0, 0.0, 1.90), 1.26, 0.80, 7, 0.54, 74, cap=1.6)],
        top=2.1, r0=0.24, lean=(0.05, 0.0), bow=0.05),
    # squat: a low, dense mound on a short thick bole
    "dialwood_squat": TreeSpec(
        seed=31, tint="#94886A",
        crowns=[Crown((0.0, 0.0, 1.45), 1.20, 0.78, 6, 0.54, 64, cap=1.65)],
        top=1.5, r0=0.27, roots=3),
    # young: slim, a small crown on a thin stem; more of its trunk shows
    "dialwood_young": TreeSpec(
        seed=43, tint="#7C9470",
        crowns=[Crown((0.04, 0.0, 2.02), 0.76, 0.66, 4, 0.42, 42, cap=1.55)],
        top=2.2, r0=0.15, lean=(0.06, 0.0), bow=0.04, leaf_len=0.44),
    # leaning: the trunk bends out and a lopsided crown follows it, a small clump left behind near the bole
    "dialwood_lean": TreeSpec(
        seed=59, tint="#868A70",
        crowns=[Crown((0.45, 0.04, 2.12), 0.98, 0.72, 5, 0.52, 56, cap=1.6), Crown((-0.12, 0.2, 1.38), 0.50, 0.44, 1, 0.36, 16)],
        top=2.2, r0=0.21, lean=(0.45, 0.04), bow=-0.10),
}
