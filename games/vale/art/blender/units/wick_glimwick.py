"""glimwick: the caster Wick (1.0 m). A long pole with a hanging lamp; it throws bolts of light.

    Blender -b --factory-startup --python-exit-code 1 --python art/blender/units/wick_glimwick.py -- [--faction aubade|serenade|both|legacy] [--fast] [--clip-sheet]

Builds glimwick_aubade + glimwick_serenade (default: both) into art/out/units/; `--faction legacy` rebuilds
today's glimwick.glb (frozen). Brief: _design/units/wicks.md (§0 hard rules, §3.2 glimwick, §4 accent, §5.2
projection). Concepts: _design/concept/wicks/glimwick_{aubade,serenade}.webp. Shared code: wick_common.py (not
forked here; the glimwick-only hooks below wrap the pipeline in this process and act ONLY on glimwick builds).
Fit check: art/blender/proto/wick_glimwick_fit.py. Progress log: art/renders/units/_wick_glimwick_progress.md.

ART 2.0 (the Marund method):
  * FORMS: numpy SDF volumes fitted to each concept on a 10 cm grid (Aubade 1174 px/m: knob top 1.00 m, hood
    crown 0.955 m; Serenade 1032 px/m: dome top 0.96 m). Conventions: Z up, metres, faces -Y, the right hand
    (the pole) at -X.
  * THE HOLLOW (both cultures): a tall round-topped ARCH (Arch), carved as a tapered concave pocket 17 cm deep
    (ArchPocket: the walls recede into the dark; no convex back wall), framed by a band that hugs the hood
    (arch_frame): Aubade a carved chalk rim 3.4 cm wide, Serenade a dark felt roll that runs into the collar.
    ONE glow volume (rule 0.2): a wide ellipsoid 8-9 cm back, low in the hollow, half hidden by the lower lip
    (light pooled at the bottom of the hood, as in both concepts); the walls round it fall off to a neutral grey.
  * PROPS share one layout in both cultures (the caster read: one tall vertical line with a lamp off its top):
    pole 4.5 cm, foot by the right boot, tip 1.32 m; a crook at 1.19-1.21 m reaching 0.19 m forward and out;
    the lamp (21 cm overall, the biggest light) hangs on a short cord with its centre at 1.05 m, beside and in
    front of the hood. The lantern glass has a dark frame (Aubade slate mullions, Serenade ironstone cage).
  * PAINT: each painted part is its faction colour (palette role or `tint`) painted with a top light, a vertical
    gradient and broken colour, plus the concept's own brush strokes as a luminance ratio against their 3D
    low-pass (_painted: the projection's patches, its baked highlight and panel lobes are removed, its strokes
    kept); then the faction marks: the Aubade seam in a slate channel, carved rim blocks, a slate hem band
    along the pointed hem; the Serenade crown band in an ironstone channel, felt panel seams, a quilted
    collar, two crisp ironstone hem bands with stitching. Every texel inside the hood pocket is ink, deeper =
    darker. The island padding is re-bled from the finished paint.
  * ACCENT (brief 4: hood light, hood mark, lamp core; nothing else): Aubade seam brow->crown->nape, Serenade
    crown band on a plane tilted 22 deg (over the arch at the front, just above the collar at the back); the
    lamp core is the biggest share. Every light sits on a dark bed (value contrast for either tint).
  * ORM: roughness gaps filled, metal zeroed, metallicFactor 0 (a wrapper on bake.bake_asset); AO reach 10 cm
    (the swinging lamp bakes no fixed shadow onto the hood).
  * RIG: VALE_BIPED_1 at minion proportions; the right arm is re-seated on the pole (the rest pose IS the
    hold); prop.R runs up the pole from the palm; x_lamp_1 (the one sway bone) hangs the lamp; four posed
    (non-sway) skirt bones x_skirt_{f,b,l,r} carry the cloak's lower half (run: it swings ahead of the forward
    boot; death: it heaps up as the wick sinks into it).
  * CLIPS: bespoke idle / run / attack1 (the left palm pushes by IK on the impact frame) / death (slumps toward
    the pole side into a heaped cloak, the pole lying on a diagonal); the other required clips reuse them.

HARD RULES kept here (brief 0): both hoods are ROUND (Aubade: a rounded cowl with a 4.5 cm round knob;
Serenade: a low broad dome) - never tall, pointed or conical; no face (the hollow is ink with ONE wide glow
volume low in it, never two points, never a bar).
"""
from __future__ import annotations

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import wick_common as wc  # noqa: E402

import bmesh  # noqa: E402
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

from common import anim, bake, mesh, pipeline, rig, scene  # noqa: E402
from common.hifi import project, sdf  # noqa: E402
from common.hifi.sdf import Capsule, Ellipsoid, HalfSpace, Lathe, RoundBox, RoundCone, Sculpt, Sphere, Torus, Tube  # noqa: E402

NOISE = sdf.Noise(29)
FRONT, UP = Vector((0.0, -1.0, 0.0)), Vector((0.0, 0.0, 1.0))
VOXEL = 0.006
FIT_DIR = os.path.join(scene.RENDERS_DIR, "units", "_glimwick")


def unit(v):
    v = np.asarray(v, dtype=np.float64)
    return v / (np.linalg.norm(v) + 1e-12)


def smooth(e0, e1, x):
    t = np.clip((np.asarray(x, dtype=np.float64) - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ── the shared skeleton (both factions) ────────────────────────────────────────────────────────────────
# crown of the head bone 0.93 (inside the hood crown), head base 0.66 (the hood's lower rim), shoulders x 0.14
# at 0.58, hips 0.36, ankles x 0.095 at 0.045; arms 0.20 (the left hangs down-out-forward: the open casting
# hand at 0.40 m, like both concepts); the right arm is re-seated on the pole in rig_extras.
PROPORTIONS = rig.proportions(height=0.93, head=0.314, neck=0.03, shoulder_width=0.28, hip_width=0.16, leg=0.32,
                              thigh_frac=0.5, arm=0.20, upper_arm_frac=0.53, hand=0.08, foot=0.15, ankle_height=0.045,
                              stance=0.015, toe_out_deg=6.0, a_pose_deg=60.0, arm_forward_deg=8.0, elbow_bend_deg=12.0,
                              spine_curve=0.0, knee_bend=0.008, shoulder_drop=0.05)
J = {k: np.array(tuple(v)) for k, v in rig._layout(PROPORTIONS).items()}

# the pole (shared): foot by the right boot, tip at 1.32 m, leaning a little out like the concepts
POLE_FOOT = np.array([-0.235, -0.075, 0.0])
POLE_TIP = np.array([-0.272, -0.095, 1.32])
POLE_AX = unit(POLE_TIP - POLE_FOOT)
GRIP_S = 0.555                                           # the palm, along the pole from its foot
GRIP = POLE_FOOT + POLE_AX * GRIP_S
WR_R = GRIP + np.array([0.048, 0.022, -0.004])           # the wrist sits inboard of the pole (the fist wraps it)
KN_R = WR_R + unit(GRIP - WR_R + np.array([0.0, -0.01, 0.005])) * PROPORTIONS["hand"]
SH_R = J["shoulder.R"]
UA = PROPORTIONS["arm"] * PROPORTIONS["upper_arm_frac"]
FA = PROPORTIONS["arm"] - UA


def _elbow(sh, wr, l1, l2, pole):
    d = wr - sh
    L = min(l1 + l2 - 1e-4, max(abs(l1 - l2) + 1e-4, np.linalg.norm(d)))
    a = unit(d)
    p = unit(pole - a * np.dot(pole, a))
    u = (l1 * l1 - l2 * l2 + L * L) / (2 * L)
    v = math.sqrt(max(0.0, l1 * l1 - u * u))
    return sh + a * u + p * v


EL_R = _elbow(SH_R, WR_R, UA, FA, np.array([-0.55, 0.45, -0.70]))
CROOK_S = 1.19
CROOK_BASE = POLE_FOOT + POLE_AX * CROOK_S
HOOK = CROOK_BASE + np.array([-0.115, -0.155, 0.025])   # where the cord hangs (the crook's end: 0.19 m out)
LAMP_C = np.array([HOOK[0], HOOK[1], 1.05])              # the lamp's centre (brief 1.08; the lamp is 21 cm overall)
SKIRT = {"f": (0.0, -1.0), "b": (0.0, 1.0), "l": (1.0, 0.0), "r": (-1.0, 0.0)}


# ── SDF helpers ────────────────────────────────────────────────────────────────────────────────────────
class Fn(sdf.Prim):
    """A primitive from a distance function (cuts, hems, shells)."""

    def __init__(self, fn, lo, hi):
        self.fn, self.lo, self.hi = fn, np.asarray(lo, dtype=np.float64), np.asarray(hi, dtype=np.float64)

    def bounds(self):
        return self.lo, self.hi

    def d(self, P):
        return self.fn(P)


class HexPrism(sdf._Framed):
    """Hexagonal prism (IQ): apothem `ap` across the flats, half height `hh` along the frame's Z."""

    def __init__(self, c, ap, hh, radius=0.0, axes=None):
        super().__init__(c, axes)
        self.ap, self.hh, self.r = float(ap), float(hh), float(radius)

    def bounds(self):
        e = self.ap / 0.866 + self.r
        return self._corners((e, e, self.hh + self.r))

    def d(self, P):
        p = np.abs(self.local(P))
        kx, ky, kz = -0.8660254, 0.5, 0.57735
        dot = np.minimum(kx * p[:, 0] + ky * p[:, 1], 0.0)
        px = p[:, 0] - 2.0 * dot * kx
        py = p[:, 1] - 2.0 * dot * ky
        h = self.ap - self.r
        cx = np.clip(px, -kz * h, kz * h)
        dx = np.sqrt((px - cx) ** 2 + (py - h) ** 2) * np.sign(py - h)
        dy = p[:, 2] - (self.hh - self.r)
        return np.minimum(np.maximum(dx, dy), 0.0) + np.sqrt(np.maximum(dx, 0) ** 2 + np.maximum(dy, 0) ** 2) - self.r


def catmull(pts, n=48):
    """Centripetal-free uniform Catmull-Rom through (r, z) points, resampled to about n points."""
    P = np.asarray(pts, dtype=np.float64)
    ext = np.vstack([P[0] * 2 - P[1], P, P[-1] * 2 - P[-2]])
    out = []
    seg = max(2, n // (len(P) - 1))
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for s in range(seg):
            t = s / seg
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(P[-1])
    return np.array(out)


def poly_prof(V):
    """2D signed distance to a closed polygon (IQ sdPolygon) as a Lathe profile prof(r, z)."""
    V = np.asarray(V, dtype=np.float64)
    n = len(V)

    def prof(r, z):
        Pq = np.stack([r, z], axis=1)
        d = np.sum((Pq - V[0]) ** 2, axis=1)
        s = np.ones(len(r))
        j = n - 1
        for i in range(n):
            e = V[j] - V[i]
            w = Pq - V[i]
            t = np.clip((w @ e) / max(e @ e, 1e-12), 0.0, 1.0)
            b = w - t[:, None] * e
            d = np.minimum(d, np.sum(b * b, axis=1))
            c1 = Pq[:, 1] >= V[i][1]
            c2 = Pq[:, 1] < V[j][1]
            c3 = e[0] * w[:, 1] > e[1] * w[:, 0]
            flip = (c1 & c2 & c3) | (~c1 & ~c2 & ~c3)
            s = np.where(flip, -s, s)
            j = i
        return s * np.sqrt(d)
    return prof


def solid_lathe(c, outline, sy=1.0, n=56):
    """A solid of revolution from an outer outline [(r, z)...] running from the top (r=0) down to the bottom
    (r=0): mirrored across the axis so the axis is interior. sy scales the depth (Y)."""
    cur = catmull(outline, n)
    cur[:, 0] = np.maximum(cur[:, 0], 0.0)
    poly = np.vstack([cur, (cur * [-1, 1])[::-1][1:-1]])
    rmax = float(cur[:, 0].max()) * max(1.0, sy) ** 2 + 0.02
    return Lathe(c, poly_prof(poly), rmax, float(cur[:, 1].min()) - 0.01, float(cur[:, 1].max()) + 0.01,
                 axes=np.diag([1.0, 1.0 / sy, 1.0])), cur


def radius_fn(cur):
    """R(z) of an outline (outer side, monotone enough in z): np.interp over the sampled curve."""
    zs, rs = cur[:, 1], cur[:, 0]
    o = np.argsort(zs)
    return lambda z: np.interp(z, zs[o], rs[o])


def shell(c, R, z0, z1, t_out, t_in, sy=1.0, extra=None):
    """A layer on a surface of revolution r = R(z): from R - t_in to R + t_out, z in [z0, z1] (+ `extra`
    distance fn intersected): stoles, hem bands, rings."""
    c = np.asarray(c, dtype=np.float64)

    def fn(P):
        x = P[:, 0] - c[0]
        y = (P[:, 1] - c[1]) / sy
        r = np.sqrt(x * x + y * y)
        z = P[:, 2]
        Rz = R(np.clip(z, z0, z1))
        d = np.maximum(r - (Rz + t_out), (Rz - t_in) - r)
        d = np.maximum(d, np.maximum(z0 - z, z - z1))
        if extra is not None:
            d = np.maximum(d, extra(P))
        return d
    rm = float(R(np.linspace(z0, z1, 32)).max()) + t_out + 0.01
    return Fn(fn, (c[0] - rm, c[1] - rm * max(1, sy), z0 - 0.01), (c[0] + rm, c[1] + rm * max(1, sy), z1 + 0.01))


def vfolds(amp_of_z, n, phase=0.0, wobble=0.5, c=(0.0, 0.0), soft=0.0):
    """Vertical cloth folds around the Z axis: soft ridges, sharp valleys (soft=1: a plain sine, which keeps
    the decimated low mesh from creasing into shards); amplitude by height."""
    def fn(P):
        ang = np.arctan2(P[:, 0] - c[0], -(P[:, 1] - c[1]))
        u = ang * n + phase + wobble * NOISE(P, 3.0)
        w = (np.abs(np.sin(u)) * 2 - 1) * (1 - soft) + (-np.cos(2 * u)) * soft
        return amp_of_z(P[:, 2]) * w * -0.5
    return fn


def opening_frame(tilt_deg):
    """Rows X, Y (up the opening), Z (= the opening's outward normal: forward, tilted up by `tilt_deg`)."""
    n = np.array([0.0, -math.cos(math.radians(tilt_deg)), math.sin(math.radians(tilt_deg))])
    return sdf.frame(n, (1.0, 0.0, 0.0))


def surface_curve(S, start, dirs, tmax=0.4, steps=400):
    """Outermost points of the sculpt S along rays from `start` (scan inward from `tmax`, then bisect)."""
    B = sdf.Blend([(o, p, k) for o, p, k, _ in S.ops])
    out = []
    ts = np.linspace(tmax, 0.0, steps)
    for d in dirs:
        d = unit(d)
        dv = B.d(start[None, :] + ts[:, None] * d[None, :])
        hit = np.nonzero(dv < 0)[0]
        if not len(hit):
            continue
        i = hit[0]
        lo, hi = ts[i], ts[max(0, i - 1)]
        for _ in range(30):
            mid = 0.5 * (lo + hi)
            if B.d((start + d * mid)[None, :])[0] < 0:
                lo = mid
            else:
                hi = mid
        out.append(start + d * lo)
    return np.array(out)


# ── the hood opening: a round-topped ARCH, a tapered concave pocket, a frame hugging the hood ─────────────
def arch_poly(hw_top, hw_bot, y_bot, y_top, corner=0.03, n_top=26):
    """Closed (x, y) outline of an arch: a semicircle of radius hw_top on top, the sides flaring to hw_bot,
    rounded bottom corners (radius `corner`)."""
    yc = y_top - hw_top
    pts = [(hw_top * math.cos(a), yc + hw_top * math.sin(a)) for a in np.linspace(0.0, math.pi, n_top)]
    for t in np.linspace(0.0, 1.0, 6)[1:]:
        pts.append((-(hw_top + (hw_bot - hw_top) * t), yc + (y_bot + corner - yc) * t))
    for a in np.linspace(math.pi, 1.5 * math.pi, 6)[1:]:
        pts.append((-hw_bot + corner + corner * math.cos(a), y_bot + corner + corner * math.sin(a)))
    for a in np.linspace(1.5 * math.pi, 2.0 * math.pi, 6):
        pts.append((hw_bot - corner + corner * math.cos(a), y_bot + corner + corner * math.sin(a)))
    for t in np.linspace(0.0, 1.0, 6)[1:-1]:
        pts.append((hw_bot + (hw_top - hw_bot) * t, y_bot + corner + (yc - y_bot - corner) * t))
    return np.array(pts)


class Arch:
    """The hood opening: frame F (rows X, Y up the opening, Z = outward normal) at O, a 2D arch outline;
    d2(P) is the signed distance (m) to the outline in the opening plane (+ outside the opening)."""

    def __init__(self, O, tilt, hw_top, hw_bot, y_bot, y_top, corner):
        self.O, self.F = np.asarray(O, dtype=np.float64), opening_frame(tilt)
        self.hw_top, self.hw_bot, self.y_bot, self.y_top = hw_top, hw_bot, y_bot, y_top
        self.prof = poly_prof(arch_poly(hw_top, hw_bot, y_bot, y_top, corner))
        self.yc = 0.5 * (y_bot + y_top)

    def q(self, P):
        return (np.asarray(P, dtype=np.float64) - self.O) @ self.F.T

    def d2(self, P):
        q = self.q(P)
        return self.prof(q[:, 0], q[:, 1])

    def box(self, margin, back, front):
        """World AABB of the opening's local box (x, y outline + margin, n in [-back, front])."""
        xs = (-self.hw_bot - margin, self.hw_bot + margin)
        ys = (self.y_bot - margin, self.y_top + margin)
        C = np.array([[x, y, n] for x in xs for y in ys for n in (-back, front)]) @ self.F + self.O
        return C.min(axis=0), C.max(axis=0)


class ArchPocket(sdf.Prim):
    """The deep cowl: the arch extruded straight back `depth` m, narrowing by `taper` toward the back (the
    walls recede into the dark: a concave void, never a convex back wall), rounded at the back."""

    def __init__(self, A: Arch, depth, front=0.1, taper=0.3, k=0.035):
        self.A, self.depth, self.front, self.taper, self.k = A, depth, front, taper, k

    def bounds(self):
        return self.A.box(0.03, self.depth + 0.03, self.front + 0.01)

    def d(self, P):
        q = self.A.q(P)
        t = np.clip(-q[:, 2] / self.depth, 0.0, 1.0)
        s = 1.0 - self.taper * t
        yc = self.A.yc
        d2 = self.A.prof(q[:, 0] / s, (q[:, 1] - yc) / s + yc) * s
        dz = np.maximum(-q[:, 2] - self.depth, q[:, 2] - self.front)
        return sdf.smax(d2, dz, self.k)


def arch_frame(base, A: Arch, width, thick, sink=0.012, behind=0.07, k=0.0):
    """A frame round the opening that HUGS the hood surface (`base`, the uncarved hood): the layer from
    `sink` inside the surface to `thick` outside it, within `width` of the arch outline. k > 0 rounds the
    profile (a felt roll); k = 0 keeps the carved stone edges crisp."""
    def fn(P):
        d0 = base.d(P)
        sh = np.maximum(d0 - thick, -d0 - sink)
        ann = np.abs(A.d2(P) - width / 2) - width / 2
        d = sdf.smax(sh, ann, k) if k > 0 else np.maximum(sh, ann)
        return np.maximum(d, -behind - A.q(P)[:, 2])
    lo, hi = A.box(width + thick + 0.02, behind + 0.01, 0.09)
    return Fn(fn, lo, hi)


def _glow(out, A: Arch, y, back, radii):
    """ONE lamp-glow volume (rule 0.2): a wide, soft-edged ellipsoid set back in the hollow, low (light pooled
    at the bottom of the hood, as in both concepts); dark all round it: never two points, never a bar."""
    g = Sculpt("hoodlight")
    g.add(Ellipsoid(A.O + A.F[1] * y - A.F[2] * back, radii, axes=A.F), k=0.0)
    part(out, "hoodlight", g, "accent", "bone:head", 130, vs=0.4, paint="accent")
    return g


# ── part list ──────────────────────────────────────────────────────────────────────────────────────────
def part(out, name, S, role, bind, tris, vs=1.0, paint="proj", uv=1.0, tint=None, light=0.30, detail=0.85, grad=None):
    """paint "proj": the faction colour (`tint`, else the palette role) painted with a top light, a vertical
    gradient `grad` (z0, z1, amount) and the concept's own brush strokes (detail transfer); "proc": the baked
    bible material; "accent": emissive, never painted."""
    out.append({"name": name, "S": S, "role": role, "bind": bind, "tris": tris, "vs": vs, "paint": paint,
                "uv": uv, "tint": tint, "light": light, "detail": detail, "grad": grad})


CLOAK_BIND = ("glim_cloak",)
INFO = {}                       # per faction: the opening, the pocket, the hood marks (read by the paint finish)


def _sleeves(out, role, cuff_r, wraps, tint=None):
    s = Sculpt("sleeves")
    for side, (sh, el, wr) in (("R", (SH_R, EL_R, WR_R)), ("L", (J["shoulder.L"], J["elbow.L"], J["wrist.L"]))):
        s.add(RoundCone(sh, el, 0.054, 0.047), k=0.0)
        cuff = wr - unit(wr - el) * 0.022
        s.add(RoundCone(el, cuff, 0.047, cuff_r), k=0.025)
        if wraps:
            ax = unit(wr - el)
            for i in range(3):
                c = el + (cuff - el) * (0.30 + 0.22 * i)
                s.add(Torus(c, 0.045, 0.009, axes=sdf.frame(ax)), k=0.006)
    part(out, "sleeves", s, role, "auto", 196, vs=0.85, uv=0.9, tint=tint, grad=(0.40, 0.60, 0.18))


def _mitts(out, role, cuff):
    # right: a fist wrapped round the pole at the grip, thumb over the top
    r = Sculpt("mitt_R")
    gc = GRIP + np.array([0.008, 0.002, 0.0])
    fr = sdf.frame(POLE_AX, (1.0, 0.0, 0.0))
    r.add(RoundBox(gc, (0.040, 0.040, 0.046), 0.030, axes=fr), k=0.0)
    r.add(Capsule(gc + np.array([0.022, -0.026, 0.040]), gc + np.array([-0.008, -0.034, 0.050]), 0.016), k=0.01)
    if cuff:
        r.add(Torus(WR_R + unit(WR_R - EL_R) * 0.006, 0.044, 0.014, axes=sdf.frame(unit(WR_R - EL_R))), k=0.008)
    part(out, "mitt_R", r, role, "bone:hand.R", 92, vs=0.6, detail=0.6)
    # left: the open casting hand, palm forward, thumb inward
    l = Sculpt("mitt_L")
    w = J["wrist.L"]
    d2 = unit(J["forearm_dir.L"])
    side = unit(np.cross(d2, np.array([0.0, -1.0, 0.0])))          # across the palm
    c = w + d2 * 0.050
    fr = sdf.frame(d2, side)
    l.add(RoundBox(c, (0.042, 0.017, 0.048), 0.014, axes=fr), k=0.0)
    l.add(Capsule(w + d2 * 0.022 + side * 0.034, w + d2 * 0.052 + side * 0.050, 0.014), k=0.012)
    if cuff:
        l.add(Torus(w + d2 * 0.004, 0.042, 0.014, axes=sdf.frame(d2)), k=0.008)
    part(out, "mitt_L", l, role, "bone:hand.L", 92, vs=0.6, detail=0.6)


def _legs(out, felt):
    tr = Sculpt("trousers")
    for s in ("L", "R"):
        a, k = J[f"ankle.{s}"], J[f"knee.{s}"]
        tr.add(RoundCone((a[0], a[1] + 0.005, 0.07), (k[0], k[1], k[2] + 0.02), 0.040, 0.046), k=0.0)
    part(out, "trousers", tr, "under", "auto", 60, vs=1.2, uv=0.5, detail=0.5)
    for s in ("L", "R"):
        a = J[f"ankle.{s}"]
        b = Sculpt(f"boot_{s}")
        if felt:
            b.add(Ellipsoid((a[0], a[1] - 0.030, 0.045), (0.056, 0.092, 0.052)), k=0.0)
            b.add(Capsule((a[0], a[1], 0.05), (a[0], a[1] + 0.004, 0.105), 0.047), k=0.03)
        else:
            b.add(RoundBox((a[0], a[1] - 0.028, 0.040), (0.050, 0.086, 0.040), 0.032), k=0.0)
            b.add(Capsule((a[0], a[1], 0.05), (a[0], a[1] + 0.004, 0.112), 0.046), k=0.025)
            for i in range(2):
                b.add(Torus((a[0], a[1] + 0.002, 0.07 + 0.026 * i), 0.046, 0.006), k=0.004)
        b.inter(HalfSpace((0, 0, 0.0), (0, 0, -1), 1.0), k=0.004)
        part(out, f"boot_{s}", b, "leather", f"bone:foot.{s}", 72, vs=0.8, uv=0.7, detail=0.6)


def _pole(out, wood):
    p = Sculpt("pole")
    p.add(RoundCone(POLE_FOOT + POLE_AX * 0.022, POLE_FOOT + POLE_AX * 1.26, 0.0225, 0.0195), k=0.0)
    part(out, "pole", p, wood, "bone:prop.R", 72, vs=0.55, paint="proc", uv=0.8)


# ── AUBADE: rounded cowl, carved chalk arch rim, knob, seam in a slate channel; straight folds, pointed hem ─
A_HOOD_OUT = [(0.0, 0.955), (0.062, 0.948), (0.106, 0.928), (0.139, 0.898), (0.160, 0.862), (0.172, 0.818),
              (0.177, 0.768), (0.179, 0.718), (0.177, 0.676), (0.168, 0.645), (0.146, 0.628), (0.08, 0.622), (0.0, 0.62)]
A_ARCH = dict(O=(0.0, -0.166, 0.765), tilt=12.0, hw_top=0.090, hw_bot=0.097, y_bot=-0.108, y_top=0.103, corner=0.045)
A_RIM_W = 0.034
A_SEAM_R = 0.016
A_CLOAK_OUT = [(0.0, 0.662), (0.07, 0.657), (0.115, 0.642), (0.146, 0.616), (0.161, 0.585), (0.167, 0.55),
               (0.172, 0.48), (0.182, 0.40), (0.196, 0.32), (0.212, 0.24), (0.228, 0.17), (0.238, 0.115),
               (0.242, 0.085), (0.24, 0.07), (0.0, 0.068)]
A_CLOAK_SY = 0.88


def a_hem_z(P):
    """the Aubade hem's cut (z of the hem at each angle: nine shallow points)"""
    ang = np.arctan2(P[:, 0], -P[:, 1])
    s = (ang * 9 / (2 * math.pi) + 0.5) % 1.0
    return 0.137 - 0.036 * (1.0 - np.abs(2.0 * s - 1.0))


def aubade_parts() -> list:
    out = []
    A = Arch(**A_ARCH)
    pocket = ArchPocket(A, depth=0.17, front=0.1, taper=0.3, k=0.035)
    # HOOD: a soft rounded cowl (round as a helmet on top), swept back at the nape, a tall arched opening
    hood = Sculpt("hood")
    lat, cur = solid_lathe((0.0, 0.02, 0.0), A_HOOD_OUT, sy=1.08)
    hood.add(lat, k=0.0)
    hood.add(Ellipsoid((0.0, 0.118, 0.668), (0.128, 0.105, 0.068)), k=0.05)          # the nape drape
    hood.add(Ellipsoid((0.0, -0.118, 0.668), (0.135, 0.075, 0.052)), k=0.045)        # the chin of the cowl
    base = sdf.Blend([(o_, p_, k_) for o_, p_, k_, _ in hood.ops])                    # uncarved: the rim hugs it
    hood.sub(pocket, k=0.012)
    part(out, "hood", hood, "cloth2", "bone:head", 530, vs=0.8, uv=1.7, tint="#A4B5C7", light=0.30, detail=0.3,
         grad=(0.66, 0.95, 0.10))
    # the carved chalk rim: 3.4 cm, 1.8 cm proud, crisp edges (block joints are paint)
    rim = Sculpt("hood_rim")
    rim.add(arch_frame(base, A, A_RIM_W, 0.018, sink=0.012, behind=0.06), k=0.0)
    rim.sub(pocket, k=0.004)
    part(out, "hood_rim", rim, "chalk", "bone:head", 300, vs=0.5, uv=1.3, detail=0.45, light=0.24)
    knob = Sculpt("knob")
    knob.add(Sphere((0.0, 0.02, 0.975), 0.0245), k=0.0)
    knob.add(Torus((0.0, 0.02, 0.953), 0.022, 0.0085), k=0.006)
    part(out, "knob", knob, "chalk", "bone:head", 76, vs=0.45, paint="proc", uv=0.6)
    # the seam (accent): from just above the rim, over the crown, down the back to the nape (centre line)
    c0 = np.array([0.0, 0.02, 0.775])
    angs = np.radians(np.linspace(40, 200, 28))        # 0 = forward, 90 = straight up, 180 = back
    dirs = np.stack([np.zeros_like(angs), -np.cos(angs), np.sin(angs)], axis=1)
    pts = surface_curve(hood, c0, dirs)
    keep = [p for p in pts if p[2] > 0.655 and (A.d2(p[None, :])[0] > A_RIM_W + 0.012 or A.q(p[None, :])[0, 2] < -0.06)]
    pts = [p + unit(p - c0) * 0.002 for p in keep]
    seam = Sculpt("seam")
    seam.add(Tube(pts, [A_SEAM_R] * len(pts), k=0.0), k=0.0)
    part(out, "seam", seam, "accent", "bone:head", 64, vs=0.7, paint="accent")
    glow_c = A.O + A.F[1] * -0.070 - A.F[2] * 0.085
    _glow(out, A, -0.070, 0.085, (0.064, 0.034, 0.032))
    # CLOAK: a bell from the shoulders, long straight folds, a hem cut into shallow points, a front slit
    cloak = Sculpt("cloak")
    clat, ccur = solid_lathe((0.0, 0.0, 0.0), A_CLOAK_OUT, sy=A_CLOAK_SY)
    Rc = radius_fn(ccur[: np.argmax(ccur[:, 1] < 0.075)])
    cloak.add(clat.displaced(vfolds(lambda z: 0.003 + 0.010 * smooth(0.56, 0.16, z), 8, 0.7, soft=0.7), 0.014), k=0.0)
    cloak.inter(Fn(lambda P: a_hem_z(P) - P[:, 2], (-0.3, -0.3, 0.0), (0.3, 0.3, 0.7)), k=0.005)

    def slit(P):
        w = 0.052 * np.clip((0.245 - P[:, 2]) / 0.14, 0.0, 1.0)
        return np.maximum(np.maximum(np.abs(P[:, 0]) - w, P[:, 2] - 0.245), P[:, 1] + 0.06)
    cloak.sub(Fn(slit, (-0.08, -0.3, 0.0), (0.08, -0.04, 0.26)), k=0.012)
    part(out, "cloak", cloak, "cloth", CLOAK_BIND, 680, vs=1.15, uv=1.0, tint="#5F7187", light=0.26, detail=0.85,
         grad=(0.15, 0.62, 0.22))
    # STOLE: two chalk strips down the front, pointed ends
    stole = Sculpt("stole")
    for xc in (-0.068, 0.068):
        def strip(P, xc=xc):
            dx = np.abs(P[:, 0] - xc)
            tip = 0.212 + 0.034 * dx / 0.027
            return np.maximum(np.maximum(dx - 0.027, tip - P[:, 2]), P[:, 1] + 0.03)
        stole.add(shell((0.0, 0.0), Rc, 0.17, 0.645, 0.011, 0.006, sy=A_CLOAK_SY, extra=strip), k=0.0)
    part(out, "stole", stole, "chalk", CLOAK_BIND, 130, vs=0.6, uv=1.0, tint="#CFCCC3", detail=0.7,
         grad=(0.2, 0.62, 0.16))
    _sleeves(out, "cloth", 0.056, wraps=True, tint="#66798F")
    _mitts(out, "cloth", cuff=False)
    _legs(out, felt=False)
    # PROPS: pale ash pole, chalk spire finial + diamond knot, angled chalk crook, hexagonal dawn lantern
    _pole(out, "wood")
    fin = Sculpt("finial")
    kc = POLE_FOOT + POLE_AX * 1.225
    fin.add(RoundCone(kc - POLE_AX * 0.035, kc, 0.019, 0.031), k=0.0)
    fin.add(RoundCone(kc, kc + POLE_AX * 0.03, 0.031, 0.016), k=0.004)
    fin.add(RoundCone(kc + POLE_AX * 0.025, POLE_TIP, 0.017, 0.003), k=0.006)        # the 10 cm spire
    part(out, "finial", fin, "chalk", "bone:prop.R", 70, vs=0.55, paint="proc", uv=0.7)
    crook = Sculpt("crook")
    cdir = unit(HOOK - CROOK_BASE)
    crook.add(Capsule(CROOK_BASE, HOOK, 0.0165), k=0.0)
    crook.add(Capsule(HOOK, HOOK + cdir * 0.028 + np.array([0, 0, 0.018]), 0.0145), k=0.008)   # upturned end
    crook.add(Capsule(POLE_FOOT + POLE_AX * 1.08, CROOK_BASE + cdir * 0.09, 0.011), k=0.01)  # brace
    crook.add(Torus(HOOK - cdir * 0.012, 0.0195, 0.0068, axes=sdf.frame(cdir)), k=0.003)
    part(out, "crook", crook, "chalk", "bone:prop.R", 80, vs=0.55, paint="proc", uv=0.7)
    _aubade_lamp(out)
    INFO["aubade"] = {"arch": A, "pocket": pocket, "rim_w": A_RIM_W, "glow": glow_c, "lit": "#2B2E33"}
    return out


def _aubade_lamp(out):
    """The narrow six-sided dawnglass lantern (the caster's read, the biggest light): a 15.6 cm glass core
    (accent) in a slate frame (mullions + plates: the light has a dark bed whichever tint it takes), the chalk
    spire cap and drop."""
    c = LAMP_C
    ap, hh = 0.058, 0.078
    panes = Sculpt("lamp_panes")
    panes.add(HexPrism(c, ap, hh, 0.003), k=0.0)
    part(out, "lamp_panes", panes, "accent", "bone:x_lamp_1", 60, vs=0.4, paint="accent")
    bars = Sculpt("lamp_bars")
    R = ap / 0.866 + 0.002
    for i in range(6):
        a = math.radians(30 + 60 * i)
        p = c + np.array([math.cos(a) * R, math.sin(a) * R, 0.0])
        bars.add(Capsule(p - (0, 0, hh + 0.003), p + (0, 0, hh + 0.003), 0.0072), k=0.0)
    bars.add(HexPrism(c + (0, 0, hh + 0.007), ap + 0.008, 0.008, 0.003), k=0.002)            # slate plates
    bars.add(HexPrism(c + (0, 0, -hh - 0.007), ap + 0.006, 0.008, 0.003), k=0.002)
    part(out, "lamp_bars", bars, "ironstone", "bone:x_lamp_1", 110, vs=0.45, paint="proc", uv=0.6)
    caps = Sculpt("lamp_caps")
    caps.add(RoundCone(c + (0, 0, hh + 0.016), c + (0, 0, hh + 0.052), ap + 0.004, 0.004), k=0.0)    # the pointed cap
    caps.add(Torus(c + (0, 0, hh + 0.058), 0.0085, 0.0038, axes=sdf.frame((1.0, 0.0, 0.0))), k=0.002)
    caps.add(RoundCone(c + (0, 0, -hh - 0.016), c + (0, 0, -hh - 0.042), 0.026, 0.003), k=0.004)    # the drop
    part(out, "lamp_caps", caps, "chalk", "bone:x_lamp_1", 80, vs=0.45, paint="proc", uv=0.8)
    cord = Sculpt("cord")
    cord.add(Capsule(HOOK - (0, 0, 0.008), c + (0, 0, hh + 0.056), 0.0055), k=0.0)
    part(out, "cord", cord, "stone", "bone:x_lamp_1", 20, vs=0.4, paint="proc", uv=0.3)


# ── SERENADE: low broad felt dome, dark felt arch frame, rolled collar, tilted crown band; bell cloak ──────
S_DOME_OUT = [(0.0, 0.962), (0.062, 0.957), (0.103, 0.942), (0.133, 0.921), (0.154, 0.894), (0.168, 0.862),
              (0.177, 0.825), (0.180, 0.786), (0.177, 0.752), (0.165, 0.722), (0.13, 0.70), (0.0, 0.69)]
S_ARCH = dict(O=(0.0, -0.168, 0.752), tilt=8.0, hw_top=0.097, hw_bot=0.106, y_bot=-0.112, y_top=0.112, corner=0.03)
S_FRAME_W = 0.034
S_BAND_TILT = 22.0                     # the crown band's plane: high over the arch, low at the nape
S_BAND_C = np.array([0.0, 0.025, 0.853])
S_BAND_HALF = 0.009
S_CLOAK_OUT = [(0.0, 0.645), (0.09, 0.638), (0.135, 0.612), (0.160, 0.572), (0.172, 0.522), (0.185, 0.44),
               (0.205, 0.36), (0.228, 0.28), (0.25, 0.20), (0.266, 0.13), (0.275, 0.09), (0.274, 0.072),
               (0.262, 0.062), (0.0, 0.06)]
S_CLOAK_SY = 0.88


def s_band_n():
    t = math.radians(S_BAND_TILT)
    return np.array([0.0, math.sin(t), math.cos(t)])


def serenade_parts() -> list:
    out = []
    A = Arch(**S_ARCH)
    pocket = ArchPocket(A, depth=0.165, front=0.12, taper=0.3, k=0.035)
    # DOME: low and broad, wider than tall
    dome = Sculpt("dome")
    lat, cur = solid_lathe((0.0, 0.025, 0.0), S_DOME_OUT, sy=1.05)
    dome.add(lat, k=0.0)
    base = sdf.Blend([(o_, p_, k_) for o_, p_, k_, _ in dome.ops])
    dome.sub(pocket, k=0.012)
    part(out, "dome", dome, "cloth2", "bone:head", 440, vs=0.85, uv=1.6, tint="#C2A37A", light=0.26, detail=0.2,
         grad=(0.70, 0.96, 0.10))
    # ROLLED COLLAR (lower at the front) + the dark felt frame round the arch, one ironstone-felt mesh
    roll = Sculpt("roll")
    roll.add(Torus((0.0, 0.03, 0.662), 0.152, 0.057, axes=np.diag([1.0, 1 / 1.06, 1.0]) @ sdf.rot_x(-12), rz=0.05), k=0.0)
    roll.add(arch_frame(base, A, S_FRAME_W, 0.024, sink=0.012, behind=0.07, k=0.010), k=0.03)
    roll.sub(pocket, k=0.008)
    part(out, "roll", roll, "ironstone", "bone:head", 400, vs=0.8, uv=1.3, tint="#4D4038", light=0.30, detail=0.6)
    # the crown band (accent): a narrow strip round the dome on a tilted plane, touching the frame's top
    band = Sculpt("band")
    Rd = radius_fn(cur[cur[:, 1] > 0.705])
    tn = s_band_n()
    band.add(shell((0.0, 0.025), Rd, 0.72, 0.94, 0.010, 0.004, sy=1.05,
                   extra=lambda P: np.abs((P - S_BAND_C) @ tn) - S_BAND_HALF), k=0.0)
    band.sub(pocket, k=0.004)
    part(out, "band", band, "accent", "bone:head", 150, vs=0.75, paint="accent")
    glow_c = A.O + A.F[1] * -0.074 - A.F[2] * 0.090
    _glow(out, A, -0.074, 0.090, (0.066, 0.034, 0.032))
    # MANTLE: a short sand-felt capelet over the shoulders, split at the front
    mantle = Sculpt("mantle")
    mo = [(0.085, 0.652), (0.135, 0.638), (0.172, 0.606), (0.196, 0.562), (0.207, 0.52), (0.207, 0.49),
          (0.196, 0.472), (0.18, 0.478), (0.178, 0.51), (0.168, 0.552), (0.142, 0.592), (0.10, 0.618), (0.07, 0.628)]
    mpoly = catmull(mo + [mo[0]], 52)
    mantle.add(Lathe((0.0, 0.01, 0.0), poly_prof(mpoly), 0.23, 0.45, 0.67, axes=np.diag([1.0, 1 / 0.92, 1.0])), k=0.0)

    def split(P):
        w = 0.010 + 0.05 * np.clip((0.60 - P[:, 2]) / 0.13, 0.0, 1.0) ** 1.5
        return np.maximum(np.abs(P[:, 0]) - w, P[:, 1] + 0.08)
    mantle.sub(Fn(split, (-0.1, -0.3, 0.44), (0.1, -0.06, 0.66)), k=0.014)
    part(out, "mantle", mantle, "cloth2", CLOAK_BIND, 190, vs=0.85, uv=1.2, tint="#BC9D75", light=0.28, detail=0.45,
         grad=(0.47, 0.65, 0.12))
    # CLOAK: a wide umber bell, soft felt folds; the two ironstone hem bands are crisp paint
    cloak = Sculpt("cloak")
    clat, ccur = solid_lathe((0.0, 0.0, 0.0), S_CLOAK_OUT, sy=S_CLOAK_SY)
    cloak.add(clat.displaced(vfolds(lambda z: 0.002 + 0.009 * smooth(0.5, 0.12, z), 6, 0.3, wobble=0.18, soft=0.6),
                             0.011), k=0.0)
    part(out, "cloak", cloak, "cloth", CLOAK_BIND, 520, vs=1.1, uv=1.1, tint="#8A6A56", light=0.26, detail=0.6,
         grad=(0.12, 0.60, 0.20))
    _sleeves(out, "cloth", 0.054, wraps=False, tint="#836551")
    _mitts(out, "leather", cuff=True)
    _legs(out, felt=True)
    # PROPS: walnut pole, round ironstone knob, level walnut crook with an iron ring, squat round lantern
    _pole(out, "wood_dark")
    kn = Sculpt("knob")
    kn.add(Sphere(POLE_FOOT + POLE_AX * 1.296, 0.037), k=0.0)
    kn.add(Torus(POLE_FOOT + POLE_AX * 1.252, 0.0235, 0.0075, axes=sdf.frame(POLE_AX)), k=0.005)
    part(out, "knob", kn, "ironstone", "bone:prop.R", 110, vs=0.45, paint="proc", uv=0.6)
    crook = Sculpt("crook")
    base_ = POLE_FOOT + POLE_AX * 1.215
    end = np.array([HOOK[0], HOOK[1], base_[2]])
    cdir = unit(end - base_)
    crook.add(Capsule(base_, end + cdir * 0.03, 0.0175), k=0.0)
    crook.add(RoundCone(end + cdir * 0.03, end + cdir * 0.045, 0.020, 0.018), k=0.004)
    part(out, "crook", crook, "wood_dark", "bone:prop.R", 60, vs=0.6, paint="proc", uv=0.6)
    ring = Sculpt("ring")
    ring.add(Torus(end - (0, 0, 0.004), 0.021, 0.0062, axes=sdf.frame(cdir)), k=0.0)
    part(out, "ring", ring, "ironstone", "bone:prop.R", 36, vs=0.6, paint="proc", uv=0.4)
    _serenade_lamp(out, end)
    INFO["serenade"] = {"arch": A, "pocket": pocket, "rim_w": S_FRAME_W, "glow": glow_c, "lit": "#302B26"}
    return out


def _serenade_lamp(out, hook):
    """The squat round lampresin lantern: a 15 cm accent core in a slim dark ironstone cage (the light has a
    dark frame to stand against), domed lid, foot dish, two amber resin rings."""
    c = LAMP_C
    rx, rz = 0.088, 0.074
    globe = Sculpt("lamp_globe")
    globe.add(Ellipsoid(c, (rx, rx, rz)), k=0.0)
    part(out, "lamp_globe", globe, "accent", "bone:x_lamp_1", 84, vs=0.4, paint="accent")
    cage = Sculpt("lamp_cage")
    for i in range(6):
        a = math.radians(60 * i + 30)
        pts = []
        for t in np.linspace(-0.86, 0.86, 6):
            ct = math.sqrt(1 - t * t)
            pts.append(c + np.array([math.cos(a) * (rx + 0.0035) * ct, math.sin(a) * (rx + 0.0035) * ct, (rz + 0.003) * t]))
        cage.add(Tube(pts, [0.0055] * len(pts), k=0.0), k=0.003)
    cage.add(Ellipsoid(c + (0, 0, rz + 0.004), (0.062, 0.062, 0.030)), k=0.006)                 # the domed lid
    cage.inter(HalfSpace(c + (0, 0, rz + 0.032), (0, 0, 1), 0.2), k=0.004)
    cage.add(Sphere(c + (0, 0, rz + 0.036), 0.012), k=0.006)
    cage.add(Torus(c + (0, 0, rz + 0.050), 0.0095, 0.004, axes=sdf.frame((1.0, 0.0, 0.0))), k=0.002)
    cage.add(Ellipsoid(c + (0, 0, -rz - 0.003), (0.045, 0.045, 0.014)), k=0.005)              # the foot dish
    part(out, "lamp_cage", cage, "ironstone", "bone:x_lamp_1", 160, vs=0.5, paint="proc", uv=0.9)
    resin = Sculpt("lamp_resin")
    rr = rx * math.sqrt(1.0 - (0.047 / rz) ** 2) + 0.002
    resin.add(Torus(c + (0, 0, 0.047), rr, 0.0075), k=0.0)
    resin.add(Torus(c + (0, 0, -0.047), rr, 0.0075), k=0.0)
    part(out, "lamp_resin", resin, "lampresin", "bone:x_lamp_1", 56, vs=0.4, paint="proc", uv=0.5)
    cord = Sculpt("cord")
    top = c + (0, 0, rz + 0.050)
    for i, t in enumerate(np.linspace(0.0, 1.0, 3)):
        p = hook - (0, 0, 0.022) + (top - (hook - (0, 0, 0.022))) * t
        ax = (1.0, 0.0, 0.0) if i % 2 == 0 else (0.0, 1.0, 0.0)
        cord.add(Torus(p, 0.0085, 0.0045, axes=sdf.frame(ax)), k=0.0)
    cord.add(Capsule(hook - (0, 0, 0.012), top, 0.0045), k=0.002)
    part(out, "cord", cord, "ironstone", "bone:x_lamp_1", 40, vs=0.4, paint="proc", uv=0.3)


def parts_for(faction: str) -> list:
    return aubade_parts() if faction == "aubade" else serenade_parts()


# ── binding: the cloak hangs on four skirt bones below the waist (glimwick builds only) ──────────────────
def _bind_cloak(obj, arm) -> None:
    obj.vertex_groups.clear()
    names = ["hips", "spine", "chest"] + [f"x_skirt_{k}" for k in SKIRT]
    groups = {nm: obj.vertex_groups.new(name=nm) for nm in names}
    co = np.array([tuple(obj.matrix_world @ v.co) for v in obj.data.vertices])
    z = co[:, 2]
    up = smooth(0.30, 0.43, z)
    t1, t2 = smooth(0.44, 0.50, z), smooth(0.52, 0.58, z)
    ang = np.arctan2(co[:, 0], -co[:, 1])
    cf, cs = np.cos(ang), np.sin(ang)
    W = {"hips": up * (1 - t1), "spine": up * t1 * (1 - t2), "chest": up * t1 * t2,
         "x_skirt_f": (1 - up) * np.maximum(cf, 0) ** 2, "x_skirt_b": (1 - up) * np.maximum(-cf, 0) ** 2,
         "x_skirt_l": (1 - up) * np.maximum(cs, 0) ** 2, "x_skirt_r": (1 - up) * np.maximum(-cs, 0) ** 2}
    for nm, w in W.items():
        for i in np.nonzero(w > 1e-3)[0]:
            groups[nm].add([int(i)], float(w[i]), "REPLACE")
    mesh.limit_weights(obj)
    mesh.add_armature_modifier(obj, arm)
    mesh.parent_keep(obj, arm)


_bind_part0 = pipeline.bind_part


def _bind_part_glim(ctx, part_, obj, body_low=None):
    if isinstance(part_.bind, tuple) and part_.bind and part_.bind[0] == "glim_cloak":
        _bind_cloak(obj, ctx.info.armature)
        return {}
    return _bind_part0(ctx, part_, obj, body_low)


pipeline.bind_part = _bind_part_glim


# ── paint: the faction colour painted with the concept's own strokes (glimwick builds only: cfg["_glim"]) ──
def _lin(c):
    c = np.asarray(c, dtype=np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def _hexlin(h):
    return _lin(np.asarray(scene.hex_srgb(h), dtype=np.float32))


LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def _robust_mean(lin):
    """mean colour of the lit, visible paint: the darkest 35 % (occluded fills, crevices, undersides) and the
    brightest 5 % are left out"""
    lum = lin @ LUMA
    lo, hi = np.percentile(lum, [35, 95])
    sel = (lum >= lo) & (lum <= hi)
    return lin[sel].mean(axis=0) if sel.sum() > 20 else lin.mean(axis=0)


def _lowpass3d(P, v, cell, keep=None):
    """3D low-pass of per-texel values v over their surface points P: trilinear splat onto a `cell` grid, a
    [1 2 1] blur per axis, trilinear gather. The concept's projection patches, its baked highlight and its
    panel lobes live below this scale (removed); its brush strokes above it (kept by the detail ratio)."""
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


def _painted(lin, P, N, cfg, tgt, keep=None):
    """The part's faction colour, painted: a top light (forms lit from above, the bible's painted key), a
    vertical gradient, a little broken colour, normalised so the lit paint lands on `tgt`; then the concept's
    brush strokes as a luminance ratio against their own 3D low-pass (no patches, no baked highlights)."""
    nz, z = N[:, 2], P[:, 2]
    Pd = P.astype(np.float64)
    shade = 0.80 + float(cfg.get("light", 0.3)) * smooth(-0.5, 0.95, nz)
    if cfg.get("grad"):
        z0, z1, amt = cfg["grad"]
        shade = shade * (1.0 + amt * (smooth(z0, z1, z) - 0.5))
    shade = shade * (1.0 + 0.045 * NOISE(Pd, 6.0) + 0.03 * NOISE(Pd, 19.0))
    base = tgt[None, :] * shade[:, None].astype(np.float32)
    m = _robust_mean(base)
    base = base * float((tgt @ LUMA) / max(float(m @ LUMA), 1e-5))
    det = float(cfg.get("detail", 0.0))
    if det > 0 and len(lin) > 50:
        L = (lin @ LUMA).astype(np.float64)
        Ll = _lowpass3d(Pd, L, 0.03, keep)
        ratio = np.clip(L / np.maximum(Ll, 1e-4), 0.80, 1.22)
        if keep is not None:
            ratio = np.where(keep, ratio, 1.0)
        base = base * (1.0 + det * (ratio - 1.0))[:, None].astype(np.float32)
    return base


def _mix(a, b, w):
    w = np.asarray(w, dtype=np.float32)[:, None]
    return a * (1.0 - w) + np.asarray(b, dtype=np.float32) * w


def _wrapdeg(a):
    return (a + 180.0) % 360.0 - 180.0


def _ink(lin, P, info, ink, thr, N=None):
    """the hollow: every texel on the pocket walls (and the frame's inner faces) goes to ink, deeper = darker;
    with N (the parts below the hood) also what is seen through the opening"""
    lo, hi = info["pocket"].bounds()
    near_ = np.all((P >= lo - 0.01) & (P <= hi + 0.01), axis=1)
    if not near_.any():
        return lin
    lin = np.array(lin, dtype=np.float32, copy=True)
    lin[near_] = _ink_near(lin[near_], P[near_], info, ink, thr, None if N is None else N[near_])
    return lin


def _ink_near(lin, P, info, ink, thr, N=None):
    d = info["pocket"].d(P.astype(np.float64))
    q = info["arch"].q(P)
    if N is not None:
        # parts under the hood (the mantle / cloak top) seen THROUGH the opening: behind it, inside its outline,
        # facing out through it -> ink too (else the cloak top shows as a light floor inside the hollow)
        seen = (info["arch"].d2(P) < 0.01) & (q[:, 2] < 0.0) & (q[:, 2] > -0.3) & (N @ info["arch"].F[2] > -0.2)
        d = np.where(seen, np.minimum(d, thr - 0.003), d)
    depth = np.clip(-q[:, 2] / 0.09, 0.0, 1.0)
    col = ink[None, :] * (1.0 - 0.45 * depth)[:, None].astype(np.float32)
    # the walls nearest the glow catch a little of it: a neutral grey falloff (never team colour)
    near = smooth(0.085, 0.03, np.linalg.norm(P - np.asarray(info["glow"], dtype=np.float32), axis=1))
    col = _mix(col, _hexlin(info["lit"]), 0.8 * near)
    return _mix(lin, col, 0.97 * smooth(thr + 0.004, thr - 0.002, d))


def _aubade_marks(nm, lin, P, N, info, pal):
    A, rw = info["arch"], info["rim_w"]
    slate = _hexlin(pal["ironstone"])
    if nm == "hood":
        # the seam's slate channel: the light line gets a dark bed on the pale linen (value contrast for both tints)
        q = A.q(P)
        out_rim = (A.d2(P) > rw + 0.004) | (q[:, 2] < -0.06)
        w = smooth(A_SEAM_R + 0.024, A_SEAM_R + 0.018, np.abs(P[:, 0])) * out_rim * (P[:, 2] > 0.655)
        lin = _mix(lin, slate * (1.0 + 0.06 * NOISE(P.astype(np.float64), 23.0))[:, None], w)
    elif nm == "hood_rim":
        # carved chalk blocks: joints, a little value per block, darker bevels along both edges
        q = A.q(P)
        ang = np.degrees(np.arctan2(q[:, 1] - A.yc, q[:, 0]))
        joints = np.array([90.0, 61.0, 119.0, 30.0, 150.0, -4.0, 184.0, -40.0, 220.0, -72.0, 252.0])
        dj = np.min(np.abs(_wrapdeg(ang[:, None] - joints[None, :])), axis=1)
        blk = np.digitize(_wrapdeg(ang - 100.0), np.sort(_wrapdeg(joints - 100.0)))
        lin = lin * (1.0 + 0.05 * np.sin(blk * 2.7 + 0.6))[:, None]
        lin = lin * (1.0 - 0.5 * smooth(2.4, 0.9, dj))[:, None]
        d2 = A.d2(P)
        front = q[:, 2] > -0.015
        bev = (smooth(rw - 0.007, rw - 0.001, d2) + smooth(0.008, 0.002, d2)) * front
        lin = lin * (1.0 - 0.16 * np.clip(bev, 0, 1))[:, None]
    elif nm == "cloak":
        # the slate hem band (brief 2.4: the feet band), cut along the pointed hem, a crisp top edge
        zh = a_hem_z(P)
        w = smooth(zh + 0.060, zh + 0.055, P[:, 2])
        lin = _mix(lin, slate * (1.0 + 0.05 * NOISE(P.astype(np.float64), 17.0))[:, None], w)
    return lin


def _serenade_marks(nm, lin, P, N, info, pal):
    A = info["arch"]
    iron = _hexlin(pal["ironstone"])
    Pd = P.astype(np.float64)
    if nm == "dome":
        # the crown band's ironstone channel (the light on a dark bed), felt panel seams above it
        sd = (Pd - S_BAND_C) @ s_band_n()
        w = smooth(S_BAND_HALF + 0.022, S_BAND_HALF + 0.016, np.abs(sd))
        lin = _mix(lin, iron * (1.0 + 0.06 * NOISE(Pd, 23.0))[:, None], w)
        a = np.degrees(np.arctan2(P[:, 0], -(P[:, 1] - 0.025)))
        r = np.sqrt(P[:, 0] ** 2 + ((P[:, 1] - 0.025) / 1.05) ** 2)
        seams = np.array([62.0, -62.0, 118.0, -118.0, 180.0])
        dm = np.min(np.abs(_wrapdeg(a[:, None] - seams[None, :])), axis=1) * np.pi / 180.0 * r
        up = (sd > S_BAND_HALF + 0.024) * smooth(0.958, 0.935, P[:, 2])
        lin = lin * (1.0 - 0.34 * smooth(0.0042, 0.0012, dm) * up)[:, None]
        lin = lin * (1.0 + 0.07 * (smooth(0.0095, 0.0062, dm) - smooth(0.0062, 0.0042, dm)) * up)[:, None]
    elif nm == "roll":
        # quilted felt: radial grooves round the collar roll (not on the arch frame)
        q = A.q(P)
        frame = (A.d2(P) < info["rim_w"] + 0.012) & (q[:, 2] > -0.08) & (P[:, 2] > 0.66)
        a = np.degrees(np.arctan2(P[:, 0], -(P[:, 1] - 0.03)))
        r = np.sqrt(P[:, 0] ** 2 + (P[:, 1] - 0.03) ** 2)
        x_ = np.mod(a - 15.0, 30.0)
        dm = np.minimum(x_, 30.0 - x_) * np.pi / 180.0 * r
        lin = lin * (1.0 - 0.38 * smooth(0.0065, 0.002, dm) * ~frame)[:, None]
    elif nm == "cloak":
        # two crisp ironstone hem bands with sand stitching along their edges
        z = P[:, 2]
        s_ = np.arctan2(P[:, 0], -P[:, 1]) * 0.25
        stitch = (np.mod(s_ / 0.013, 1.0) < 0.5).astype(np.float32)
        sand = _hexlin("#9C7E5C")
        for z0, z1 in ((0.178, 0.214), (0.062, 0.098)):
            w = smooth(z0 - 0.0025, z0 + 0.0015, z) * smooth(z1 + 0.0025, z1 - 0.0015, z)
            lin = _mix(lin, iron * (1.0 + 0.05 * NOISE(Pd, 19.0))[:, None], w)
            for ze in (z0 + 0.0055, z1 - 0.0055):
                ws = smooth(0.0022, 0.0009, np.abs(z - ze)) * stitch
                lin = _mix(lin, sand, 0.8 * ws)
    return lin


def _finish_paint(img, maps, names, g, log):
    P, N, part_ = maps["P"], maps["N"], maps["part"]
    out = img.copy()
    pal = g["palette"]
    info = g["info"]
    ink = _hexlin(pal.get("ink", "#15171B"))
    baked = None
    im = bpy.data.images.get(f"{g['id']}_base")
    if im is not None and tuple(im.size) == (img.shape[1], img.shape[0]):
        a = np.empty(im.size[0] * im.size[1] * 4, dtype=np.float32)
        im.pixels.foreach_get(a)
        baked = a.reshape(im.size[1], im.size[0], 4)[::-1, :, :3]
    marks = _aubade_marks if g["faction"] == "aubade" else _serenade_marks
    hollow_parts = {"hood": 0.006, "hood_rim": 0.003} if g["faction"] == "aubade" else {"dome": 0.006, "roll": 0.003}
    means = {}
    for i, nm in enumerate(names):
        cfg = g["parts"].get(nm)
        m = part_ == i
        if cfg is None or not m.any():
            continue
        mode = cfg["paint"]
        if mode == "proc" and baked is not None:
            out[m] = baked[m]
        elif mode == "proj":
            Pm, Nm = P[m], N[m]
            lin = _lin(out[m])
            keep = None
            if nm in hollow_parts:
                keep = info["pocket"].d(Pm.astype(np.float64)) > 0.012
            tgt = _hexlin(cfg.get("tint") or pal.get(cfg["role"]))
            lin = _painted(lin, Pm, Nm, cfg, tgt, keep)
            lin = marks(nm, lin, Pm, Nm, info, pal)
            if nm == "cloak" and g.get("hem"):
                lin = lin * (1.0 - g["hem"] * smooth(0.30, 0.08, Pm[:, 2]))[:, None]
            lin = _ink(lin, Pm, info, ink, hollow_parts.get(nm, 0.004), None if nm in hollow_parts else Nm)
            out[m] = _srgb(lin)
        c_ = (np.clip(out[m].mean(axis=0), 0, 1) * 255).round().astype(int)
        means[nm] = "#%02X%02X%02X" % tuple(c_)
    # re-bleed the island padding from the finished paint (else the projected colour shows as light seams)
    iy, ix = project.nearest_index(part_ >= 0)
    out = out[iy, ix]
    try:
        os.makedirs(FIT_DIR, exist_ok=True)
        with open(os.path.join(FIT_DIR, f"paint_means_{g['id']}.json"), "w") as f:
            json.dump(means, f, indent=1)
    except OSError:
        pass
    log(f"glimwick paint finished ({g['id']}): {means}")
    return out


_paint_object0 = project.paint_object


def _paint_object_glim(obj, size, cfg, names, part_attr="vale_part", log=print, return_maps=False):
    g = cfg.get("_glim") if isinstance(cfg, dict) else None
    if not g:
        return _paint_object0(obj, size, cfg, names, part_attr=part_attr, log=log, return_maps=return_maps)
    img, maps = _paint_object0(obj, size, cfg, names, part_attr=part_attr, log=log, return_maps=True)
    img = _finish_paint(img, maps, names, g, log)
    return (img, maps) if return_maps else img


project.paint_object = _paint_object_glim


# ── ORM: metalness 0 (bible) and padded roughness (glimwick builds only) ──────────────────────────────────
_bake_asset0 = bake.bake_asset


def _bake_asset_glim(low, highs, out_dir, name="body", **kw):
    """bake.bake_asset, then for glimwick faction builds: roughness texels the bake left empty (island
    padding, ray misses: 0 = mirror gloss that bleeds in at mip levels) are filled from the nearest island,
    the metal channel is zeroed, and the material's Metallic is unlinked at 0 (the exporter writes
    metallicFactor 0, so lossy-WebP chroma bleed in the ORM can never turn into metal)."""
    mine = str(name).startswith(("glimwick_aubade", "glimwick_serenade"))
    if mine:
        # AO reach 10 cm: folds, crevices and the hollow still darken, but the swinging lamp and the held pole
        # (20+ cm off the hood) no longer bake a fixed dark patch onto the dome / cowl
        kw["ao_distance"] = 0.10
    res = _bake_asset0(low, highs, out_dir, name=name, **kw)
    if not mine:
        return res
    mat = res.get("material")
    path = res.get("images", {}).get("orm")
    img = None
    if mat is not None and mat.node_tree:
        for nd in mat.node_tree.nodes:
            if nd.type == "TEX_IMAGE" and nd.image and path and os.path.abspath(bpy.path.abspath(nd.image.filepath_raw or nd.image.filepath)) == os.path.abspath(path):
                img = nd.image
    if img is None and path:
        img = bpy.data.images.load(path, check_existing=True)
    if img is not None:
        w_, h_ = img.size
        a = np.empty(w_ * h_ * 4, dtype=np.float32)
        img.pixels.foreach_get(a)
        a = a.reshape(h_, w_, 4)
        bad = a[..., 1] < 0.04
        if bad.any() and not bad.all():
            iy, ix = project.nearest_index(~bad)
            a[..., 1] = a[..., 1][iy, ix]
        a[..., 2] = 0.0
        bake.set_image_array(img, a)                   # foreach_set + update (else save() writes the old buffer)
        bake.save_image(img, path, "PNG")
        scene.log(f"glimwick ORM: roughness gaps filled {int(bad.sum())} px, metal zeroed")
    if mat is not None and mat.node_tree:
        bsdf = mat.node_tree.nodes.get("BSDF")
        if bsdf is not None:
            for l_ in list(bsdf.inputs["Metallic"].links):
                mat.node_tree.links.remove(l_)
            bsdf.inputs["Metallic"].default_value = 0.0
    return res


bake.bake_asset = _bake_asset_glim


# ── motion: the pole is held by the palm (prop.R head); its orientation is authored (glimwick poses only) ──
HT, FT, Pz = anim.HandTarget, anim.FootTarget, anim.P
OFF_PALM = Vector(tuple(GRIP - WR_R))
_POLE_R_CHEST = tuple(unit((EL_R - SH_R) - unit(WR_R - SH_R) * np.dot(EL_R - SH_R, unit(WR_R - SH_R))))


def pole_rot(pitch=0.0, roll=0.0, yaw=0.0, twist=0.0) -> Matrix:
    """The pole's rotation from rest about its grip: `pitch` tips the top forward (-Y), `roll` tips it to the
    wick's right (-X), `yaw` turns it about Z, `twist` turns it about its own axis first (degrees)."""
    return (Matrix.Rotation(math.radians(yaw), 3, "Z") @ Matrix.Rotation(math.radians(pitch), 3, "X")
            @ Matrix.Rotation(math.radians(-roll), 3, "Y") @ Matrix.Rotation(math.radians(twist), 3, Vector(tuple(POLE_AX))))


_resolve0 = anim.resolve


def _resolve_glim(skel, pose: dict) -> dict:
    """anim.resolve for poses carrying "_grip" (world palm position): the right hand is solved so the palm
    lands there (a few corrective passes), then prop.R takes the authored pole orientation "_pole"
    (pitch, roll, yaw) + "_twist" (deg, 0, 0). Other poses (other units in this process) pass through."""
    if "_grip" not in pose:
        return _resolve0(skel, pose)
    pose = dict(pose)
    grip = Vector(pose.pop("_grip"))
    pr = pose.pop("_pole", (0.0, 0.0, 0.0))
    tw = pose.pop("_twist", (0.0, 0.0, 0.0))[0]
    ik = dict(pose.get("ik") or {})
    W = grip - OFF_PALM
    out, M = None, None
    for _ in range(5):
        ik["hand.R"] = HT(pos=tuple(W), pole=_POLE_R_CHEST)
        p2 = dict(pose)
        p2["ik"] = ik
        out = _resolve0(skel, p2)
        M = skel.fk(out)
        err = grip - M["prop.R"].translation
        if err.length < 0.0015:
            break
        W = W + err
    want = pole_rot(pr[0], pr[1], pr[2], tw) @ skel.rest["prop.R"].to_3x3()
    Pm = (M["hand.R"] @ skel.local["prop.R"]).to_3x3()
    out["prop.R"] = skel.euler_of(Pm.inverted() @ want, out.get("prop.R"))
    return out


anim.resolve = _resolve_glim

MOTION = anim.motion_profile(weight="light", weapon="one_hand", stance="neutral", run_ref_speed=3.25, cadence=1.8)
ARM_BONES = ("shoulder.L", "upper_arm.L", "forearm.L", "hand.L", "shoulder.R", "upper_arm.R", "forearm.R", "hand.R")
SKIRT_BONES = tuple(f"x_skirt_{k}" for k in SKIRT)


def base_pose(dz=-0.010) -> dict:
    return {"hips_loc": (0.0, 0.0, dz), "ik": anim.feet(), "_grip": tuple(GRIP + np.array([0.0, 0.0, dz * 0.4])),
            "_pole": (0.0, 0.0, 0.0), "_twist": (0.0, 0.0, 0.0), "_lamp": (0.0, 0.0, 0.0)}


def with_(p: dict, **kw) -> dict:
    q = dict(p)
    for k, v in kw.items():
        q[k.replace("_L", ".L").replace("_R", ".R") if k.endswith(("_L", "_R")) else k] = v
    return q


def grip_at(d=(0.0, 0.0, 0.0)) -> tuple:
    return tuple(GRIP + np.asarray(d, dtype=np.float64))


def skirt(deg) -> dict:
    return {b: (float(deg), 0.0, 0.0) for b in SKIRT_BONES}


def clip_overrides_for(ctx) -> dict:
    osc = anim.osc
    out = {}

    # IDLE (60 f = 2 s loop): breathing, the hood scans the lane, the lamp sways ~6 deg, the left palm turns up
    def idle_s(t):
        b, s = osc(t, 1), osc(t, 1, 0.25)
        look = 7.0 * osc(t, 1, 0.1)
        u = max(0.0, osc(t, 1, 0.55)) ** 2
        p = base_pose(-0.010 - 0.004 * (0.5 + 0.5 * b))
        p.update(Pz(chest=(1.6 * b, 0, 0), spine=(0.6 * b, 0, 0.8 * s), neck=(-0.6 * b, 0.4 * look, 0),
                    head=(-0.6 * b, 0.6 * look, 0), hips=(0, 1.2 * s, -0.8 * s),
                    upper_arm_L=(8 * u, 0, 0), forearm_L=(22 * u, 0, 0), hand_L=(0, -50 * u, 0)))
        p["hips_loc"] = (0.006 * s, 0.0, p["hips_loc"][2])
        p["_grip"] = grip_at((0.0, 0.0, -0.006 - 0.003 * b))
        p["_pole"] = (1.2 * s, 0.4 * b, 0.0)
        p["_lamp"] = (6.0 * osc(t, 1, 0.3), 0.0, 0.0)
        return p
    out["idle"] = anim.Clip("idle", 60, True, idle_s)

    # RUN (3.25 m/s, short quick scurry): the shared cycle's legs (swing height scaled to the short legs),
    # the pole carried upright tipped 10 deg forward, the lamp trailing, the left arm swinging short
    base_run = anim.gen_run(MOTION)
    nrun = base_run.frames

    def _fwd(f):
        return max(0.0, -float(f.ankle[1]))

    span = max(1e-3, max(max(_fwd(base_run.sample(i / nrun)["ik"][k]) for k in ("foot.L", "foot.R"))
                         for i in range(nrun)))

    def run_s(t):
        q = t % 1.0
        p = dict(base_run.sample(t))
        for b in ARM_BONES:
            p.pop(b, None)
        ik = {}
        fw = {}
        for k, f in p["ik"].items():
            if k.startswith("foot"):
                ik[k] = FT((f.ankle[0], f.ankle[1], f.ankle[2] * 0.34), f.pitch * 0.6, f.yaw, f.toe, f.knee, f.weight)
                fw[k] = _fwd(f) / span
        p["ik"] = ik
        hx, hy, hz = p["hips_loc"]
        hz *= 0.75
        p["hips_loc"] = (hx, hy, hz)
        sw = math.cos(2 * math.pi * (q - 0.03))
        p["upper_arm.L"] = (-20.0 * sw + 6.0, 0.0, 0.0)
        p["forearm.L"] = (28.0 + 12.0 * max(0.0, sw), 0.0, 0.0)
        p["hand.L"] = (0.0, -10.0, 0.0)
        bob = math.cos(4 * math.pi * q)
        p["_grip"] = grip_at((0.0, -0.025, hz * 0.9 + 0.012))
        p["_pole"] = (10.0 + 1.5 * bob, 0.0, 0.25 * p.get("chest", (0, 0, 0))[1])
        p["_twist"] = (0.0, 0.0, 0.0)
        p["_lamp"] = (-16.0 + 5.0 * bob, 0.0, 0.0)
        # the cloak swings ahead of whichever boot is forward (the boot never pierces the rigid drapery)
        fl, fr = fw.get("foot.L", 0.0), fw.get("foot.R", 0.0)
        p.update(skirt(3.0 + 2.0 * bob))
        p["x_skirt_f"] = (5.0 + 15.0 * max(fl, fr) ** 1.2, 0.0, 0.0)
        p["x_skirt_l"] = (4.0 + 7.0 * fl, 0.0, 0.0)
        p["x_skirt_r"] = (4.0 + 7.0 * fr, 0.0, 0.0)
        p["x_skirt_b"] = (5.0 + 3.0 * bob, 0.0, 0.0)
        return p
    out["run"] = anim.Clip("run", nrun, True, run_s, meta=dict(base_run.meta))

    # ATTACK1 (25 f, impact f10 = 40 %): the pole lifts 10 cm and tips forward 20 deg (the lamp swings out
    # toward the target) while the open left palm pushes forward: the bolt leaves the lamp
    g = base_pose()
    wind = with_(g, hips_loc=(0.0, 0.015, -0.016), spine=(-4, 0, 0), chest=(-6, 0, 0), neck=(2, 0, 0), head=(4, 0, 0),
                 upper_arm_L=(-12, 0, -6), forearm_L=(62, 0, 0), hand_L=(-10, -55, 0))
    wind["_grip"] = grip_at((0.0, 0.02, 0.035))
    wind["_pole"] = (-9.0, 0.0, 0.0)
    wind["_lamp"] = (-8.0, 0.0, 0.0)
    hit = with_(g, hips_loc=(0.0, -0.022, -0.02), hips=(3, 0, 0), spine=(5, 0, 0), chest=(7, 0, 0), neck=(-3, 0, 0),
                head=(-5, 0, 0), upper_arm_L=(78, 0, 8), forearm_L=(6, 0, 0), hand_L=(-62, 0, 0))
    hit["_grip"] = grip_at((0.0, -0.04, 0.10))
    hit["_pole"] = (20.0, 0.0, 0.0)
    hit["_lamp"] = (14.0, 0.0, 0.0)
    fol = with_(g, hips_loc=(0.0, -0.018, -0.018), hips=(3, 0, 0), spine=(4, 0, 0), chest=(5, 0, 0), neck=(-2, 0, 0),
                head=(-3, 0, 0), upper_arm_L=(66, 0, 8), forearm_L=(12, 0, 0), hand_L=(-50, 0, 0))
    fol["_grip"] = grip_at((0.0, -0.03, 0.07))
    fol["_pole"] = (15.0, 0.0, 0.0)
    fol["_lamp"] = (6.0, 0.0, 0.0)
    # the open left palm: reached forward by IK (chest frame, arm lengths: +X left, -Y front) so the push
    # reads on the impact frame whatever the FK angles do; it fades in on the wind-up and out on the settle
    wind["ik"] = dict(wind["ik"], **{"hand.L": HT(rel=(0.62, -0.10, -0.55), pole=(0.8, 0.3, -0.5), weight=0.5)})
    hit["ik"] = dict(hit["ik"], **{"hand.L": HT(rel=(0.30, -0.90, 0.06), pole=(0.75, 0.15, -0.65))})
    fol["ik"] = dict(fol["ik"], **{"hand.L": HT(rel=(0.34, -0.80, 0.0), pole=(0.75, 0.15, -0.65), weight=0.9)})
    for p_ in (g, wind, hit, fol):
        p_.update({b: p_.get(b, (0.0, 0.0, 0.0)) for b in SKIRT_BONES})
    hit.update(skirt(4.0))
    fol.update(skirt(3.0))
    fn = anim.keyed(anim.strike_keys(MOTION, wind, hit, fol, g))
    out["attack1"] = anim.Clip("attack1", 25, False, anim.drag(fn, 25, {"head": 1.5, "neck": 1.0}), impact=anim.IMPACT)

    # DEATH (45 f): recoil; the pole topples to the right and lands on the ground (crook up, the lamp beside
    # it); the wick sinks into its cloak tilting right, the cloak flaring into a pile, the hood drooping onto it
    d0 = base_pose()
    d0.update(skirt(0.0))
    rec = with_(d0, hips_loc=(0.0, 0.03, -0.012), spine=(-7, 0, 0), chest=(-9, 0, 0), neck=(-4, 0, 0), head=(-12, 5, 0),
                upper_arm_L=(-6, 0, 8))
    rec["_grip"] = grip_at((0.0, 0.025, 0.005))
    rec["_pole"] = (-6.0, 4.0, 0.0)
    tip = with_(d0, hips_loc=(-0.01, 0.015, -0.05), spine=(4, 0, 6), chest=(4, 0, 6), neck=(2, 0, 2), head=(8, -4, 4),
                upper_arm_L=(4, 0, 10), forearm_L=(18, 0, 0))
    tip["_grip"] = grip_at((-0.03, 0.0, -0.10))
    tip["_pole"] = (0.0, 38.0, 0.0)
    tip["_twist"] = (40.0, 0.0, 0.0)
    tip.update(skirt(10.0))
    # the wick slumps toward its right (the pole side) into a heaped cloak; the pole lies on the ground on a
    # diagonal under that side (lamp out front-right, still lit), never a straight handle out of a flat disc
    G_DOWN = (-0.09, 0.04, -0.41)
    down = with_(d0, hips_loc=(-0.02, 0.02, -0.12), hips=(0, 0, 4), spine=(6, 0, 15), chest=(8, 0, 17),
                 neck=(6, 0, 8), head=(14, 0, 10), upper_arm_L=(10, 0, 22), forearm_L=(30, 0, 0))
    down["_grip"] = grip_at(G_DOWN)
    down["_pole"] = (0.0, 96.0, 40.0)
    down["_twist"] = (90.0, 0.0, 0.0)
    down.update({"x_skirt_f": (36.0, 0.0, 0.0), "x_skirt_b": (30.0, 0.0, 0.0), "x_skirt_l": (30.0, 0.0, 0.0),
                 "x_skirt_r": (40.0, 0.0, 0.0)})
    bounce = with_(down, hips_loc=(-0.02, 0.02, -0.14))
    bounce["_pole"] = (0.0, 92.0, 40.0)
    bounce["_grip"] = grip_at((G_DOWN[0], G_DOWN[1], G_DOWN[2] + 0.02))
    bounce.update({"x_skirt_f": (40.0, 0.0, 0.0), "x_skirt_b": (33.0, 0.0, 0.0), "x_skirt_l": (33.0, 0.0, 0.0),
                   "x_skirt_r": (44.0, 0.0, 0.0)})
    slump = with_(down, hips_loc=(-0.02, 0.02, -0.145), spine=(8, 0, 18), chest=(10, 0, 20), neck=(8, 0, 10),
                  head=(18, 0, 14))
    slump.update({"x_skirt_f": (40.0, 0.0, 0.0), "x_skirt_b": (33.0, 0.0, 0.0), "x_skirt_l": (33.0, 0.0, 0.0),
                  "x_skirt_r": (45.0, 0.0, 0.0)})
    rest = with_(slump, hips_loc=(-0.02, 0.02, -0.142))
    keys = [(0.0, d0, "linear"), (0.10, rec, "snap"), (0.30, tip, "in"), (0.50, down, "accel"), (0.58, bounce, "out"),
            (0.74, slump, "inout"), (0.86, rest, "out"), (1.0, rest, "linear")]
    out["death"] = anim.Clip("death", 45, False, anim.keyed(keys))

    # the required set the renderer never plays for minions: reuse the four (same timing rules)
    for nm in ("attack2", "cast_a1", "cast_a2", "cast_a3", "cast_ult"):
        out[nm] = anim.Clip(nm, 25, False, out["attack1"].sample, impact=anim.IMPACT)
    for nm in ("recall", "idle_lobby", "channel", "stunned", "victory"):
        out[nm] = anim.Clip(nm, 60, True, idle_s)
    out["dash"] = anim.Clip("dash", nrun, False, run_s)
    return out


# ── the spec ───────────────────────────────────────────────────────────────────────────────────────────
PLATES = {"aubade": ("wicks/glimwick_aubade", 1.0256, dict(sat=1.0, glow=(0.86, 0.22))),
          "serenade": ("wicks/glimwick_serenade", 1.1386, dict(sat=0.6, glow=(0.8, 0.5)))}


class Glimwick(wc.Wick):
    KIND_ID = "glimwick"
    HEIGHT = 1.0

    def __init__(self, faction: str = wc.LEGACY):
        super().__init__(faction)
        if faction == wc.LEGACY:
            return
        self.PROPORTIONS = PROPORTIONS
        self.MOTION = MOTION
        self.AO_INTO_BASE = 0.3
        self.TEXTURE_SIZES = {"normal": 256, "orm": 256}
        self._parts = parts_for(faction)
        concept, h, grade = PLATES[faction]
        proj = wc.graded_projection(concept, h, tag="glim", **grade)
        keys = ("paint", "role", "tint", "light", "detail", "grad")
        proj["_glim"] = {"id": self.ID, "faction": faction, "palette": dict(self.PALETTE),
                         "hem": 0.22 if faction == "aubade" else 0.12, "info": INFO[faction],
                         "parts": {p["name"]: {k: p[k] for k in keys} for p in self._parts}}
        self.PROJECTION = proj

    # ---- model ----
    def model(self, ctx) -> list:
        if self.faction == wc.LEGACY:
            return self.legacy_model(ctx)
        from common import fighter
        P = []
        for p in self._parts:
            v, q = p["S"].mesh(VOXEL * p["vs"])
            ob = sdf.to_object(f"{p['name']}_high", v, q, ctx.col)
            ob.data.materials.append(ctx.mats[p["role"]])
            # the low: X-symmetric collapse first; when it stalls (surface nets leave a few non-manifold
            # edges where a thin tube crosses a cell ambiguously; the collapse stops there) the copy is
            # welded (0.4 mm) and triangulated, then decimated again without symmetry
            low = mesh.duplicate(ob, f"{p['name']}_low", ctx.col)
            n = mesh.decimate_to(low, p["tris"])
            if n > 1.2 * p["tris"]:
                me_ = low.data
                bpy.data.objects.remove(low, do_unlink=True)
                bpy.data.meshes.remove(me_)
                low = mesh.duplicate(ob, f"{p['name']}_low", ctx.col)
                bm = bmesh.new()
                bm.from_mesh(low.data)
                bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0004)
                bmesh.ops.triangulate(bm, faces=bm.faces)
                bm.to_mesh(low.data)
                bm.free()
                n = mesh.decimate_to(low, p["tris"], symmetric=False)
            P.append(fighter.Part(p["name"], high=ob, low=low, tris=p["tris"], bind=p["bind"], uv_weight=p["uv"]))
        return P

    def legacy_props(self, ctx, part_) -> None:
        wc.legacy_pole_lamp(self, ctx, part_, rise=0.15)

    # ---- rig ----
    def rig_extras(self, ctx) -> None:
        if self.faction == wc.LEGACY:
            return
        info = ctx.info
        arm = info.armature
        scene.select_only([arm], arm)
        bpy.ops.object.mode_set(mode="EDIT")
        eb = arm.data.edit_bones

        def put(name, head, tail, z):
            b = eb[name]
            b.head, b.tail = Vector(tuple(head)), Vector(tuple(tail))
            b.align_roll(z)

        put("upper_arm.R", SH_R, EL_R, FRONT)
        put("forearm.R", EL_R, WR_R, FRONT)
        put("hand.R", WR_R, KN_R, FRONT)
        put("prop.R", GRIP, GRIP + POLE_AX * 0.12, FRONT)
        made = []
        for k, (dx, dy) in SKIRT.items():
            b = eb.new(f"x_skirt_{k}")
            b.head = Vector((dx * 0.07, dy * 0.06, 0.40))
            b.tail = Vector((dx * 0.215, dy * 0.19, 0.13))
            b.align_roll(Vector((dx, dy, 0.0)))
            b.parent = eb["hips"]
            b.use_deform = True
            made.append(b.name)
        bpy.ops.object.mode_set(mode="OBJECT")
        for nm in made:
            arm.pose.bones[nm].rotation_mode = "XYZ"
        ctx.chains = {"lamp": rig.add_chain(info, "lamp", "prop.R", [Vector(tuple(HOOK)), Vector(tuple(LAMP_C))])}
        for b in arm.data.bones:
            info.lengths[b.name] = b.length
        info.joints["elbow.R"], info.joints["wrist.R"] = Vector(tuple(EL_R)), Vector(tuple(WR_R))
        info.joints["knuckle.R"] = Vector(tuple(KN_R))

    def chain_config(self, ctx) -> list:
        if self.faction == wc.LEGACY:
            return [anim.ChainCfg(b) for b in ctx.chains.values()]
        return [anim.ChainCfg(ctx.chains["lamp"], gravity=1.0, stiffness=95.0, damping=8.0, inertia=1.5,
                              drive=lambda p: p.get("_lamp", (0.0, 0.0, 0.0))[0], limit=(-70.0, 70.0), floor=0.03)]

    def clip_overrides(self, ctx) -> dict:
        if self.faction == wc.LEGACY:
            return {}
        return clip_overrides_for(ctx)


KINDS = [Glimwick]

if __name__ == "__main__":
    wc.run(KINDS)
