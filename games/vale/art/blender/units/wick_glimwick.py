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
  * PROPS share one layout in both cultures (the caster read: one tall vertical line with a lamp off its top):
    pole 4.5 cm, foot by the right boot, tip 1.32 m; a crook at 1.19-1.21 m reaching 0.17 m forward and out;
    the lamp hangs on a short cord with its centre at 1.07 m, beside and in front of the hood. The brief's
    numbers win over the concepts' lower lamps (both concepts hang it at hood height).
  * PAINT: the body takes the concept painting projected onto the game mesh (graded plates), then each part is
    pulled toward its faction palette role (keeps the painted strokes, moves the mean: Serenade's far too
    orange concept lands on the umber/sand palette), crowns seen from the 52 degree camera are re-filled from
    their own side paint (no projection streaks), the hood hollow is ink, the Aubade hem darkens (feet band).
    The props (pole, crook, lamp frames, finials) keep the bible's procedural materials (grain, chisel, edge
    chalk) baked from the sculpt. Accent parts are emissive (renderer tint) and never painted.
  * RIG: VALE_BIPED_1 at minion proportions; the right arm is re-seated on the pole (the rest pose IS the
    hold); prop.R runs up the pole from the palm; x_lamp_1 (the one sway bone) hangs the lamp; four posed
    (non-sway) skirt bones x_skirt_{f,b,l,r} carry the cloak's lower half, so the cloak can flare and pile
    up when the wick sinks into it (death) and swish in the run.
  * CLIPS: bespoke idle / run / attack1 / death (brief §3.2); the other required clips reuse them (the
    renderer plays only these four for minions).

HARD RULES kept here (brief §0): both hoods are ROUND (Aubade: a rounded cowl with a 4.5 cm round knob;
Serenade: a low broad dome) - never tall, pointed or conical; no face (the hollow is ink with ONE wide, flat glow
volume low in it, never two points).
"""
from __future__ import annotations

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import wick_common as wc  # noqa: E402

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

from common import anim, mesh, pipeline, rig, scene  # noqa: E402
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
HOOK = CROOK_BASE + np.array([-0.10, -0.14, 0.025])     # where the cord hangs (the crook's end)
LAMP_C = np.array([HOOK[0], HOOK[1], 1.07])              # the lamp's centre (brief: 1.08)
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


def vfolds(amp_of_z, n, phase=0.0, wobble=0.5, c=(0.0, 0.0)):
    """Vertical cloth folds around the Z axis: soft ridges, sharp valleys; amplitude by height."""
    def fn(P):
        ang = np.arctan2(P[:, 0] - c[0], -(P[:, 1] - c[1]))
        u = ang * n + phase + wobble * NOISE(P, 3.0)
        return amp_of_z(P[:, 2]) * (np.abs(np.sin(u)) * 2 - 1) * -0.5
    return fn


def opening_frame(tilt_deg):
    """Rows X, Y (up the opening), Z (= the opening's outward normal: forward, tilted up by `tilt_deg`)."""
    n = np.array([0.0, -math.cos(math.radians(tilt_deg)), math.sin(math.radians(tilt_deg))])
    return sdf.frame(n, (1.0, 0.0, 0.0))


def ring_axes(F, rx, ry, R):
    """Torus axes for an elliptical ring of radii (rx, ry) in frame F's XY plane (major radius R)."""
    return np.vstack([F[0] * (R / rx), F[1] * (R / ry), F[2]])


def cowl_rim(base, O, F, ax, ay, width, thick, behind=0.06):
    """A rim that HUGS a surface (the prim `base`) round an opening: the layer 0..`thick` outside `base`,
    inside the elliptical annulus from the opening's radii (ax, ay in frame F) out by `width` (fraction of the
    radii), in front of a plane `behind` metres behind O. A rolled felt collar instead of a flat goggle ring."""
    def fn(P):
        d0 = base.d(P)
        sh = np.maximum(d0 - thick, -d0 - 0.008)
        q = (P - O) @ F.T
        rho = np.sqrt((q[:, 0] / ax) ** 2 + (q[:, 1] / ay) ** 2)
        ann = (np.abs(rho - (1.0 + width / 2)) - width / 2) * min(ax, ay)
        return np.maximum(np.maximum(sh, ann), -behind - q[:, 2])
    e = max(ax, ay) * (1.0 + width) + thick + 0.02
    return Fn(fn, O - e, O + e)


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


# ── part list ──────────────────────────────────────────────────────────────────────────────────────────
def part(out, name, S, role, bind, tris, vs=1.0, paint="proj", pull=0.5, uv=1.0, top=False, tint=None):
    """tint: the pull target colour when it differs from the palette role (the faction read wins over a
    near-white role colour: Aubade linen is a clear dawn blue, never a white hood)."""
    out.append({"name": name, "S": S, "role": role, "bind": bind, "tris": tris, "vs": vs, "paint": paint,
                "pull": pull, "uv": uv, "top": top, "tint": tint})


CLOAK_BIND = ("glim_cloak",)


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
    part(out, "sleeves", s, role, "auto", 210, vs=0.85, pull=0.65, uv=0.9, tint=tint)


def _mitts(out, role, cuff, pull):
    # right: a fist wrapped round the pole at the grip, thumb over the top
    r = Sculpt("mitt_R")
    gc = GRIP + np.array([0.008, 0.002, 0.0])
    fr = sdf.frame(POLE_AX, (1.0, 0.0, 0.0))
    r.add(RoundBox(gc, (0.040, 0.040, 0.046), 0.030, axes=fr), k=0.0)
    r.add(Capsule(gc + np.array([0.022, -0.026, 0.040]), gc + np.array([-0.008, -0.034, 0.050]), 0.016), k=0.01)
    if cuff:
        r.add(Torus(WR_R + unit(WR_R - EL_R) * 0.006, 0.044, 0.014, axes=sdf.frame(unit(WR_R - EL_R))), k=0.008)
    part(out, "mitt_R", r, role, "bone:hand.R", 110, vs=0.6, pull=pull)
    # left: the open casting hand, palm forward, thumb inward
    l = Sculpt("mitt_L")
    w = J["wrist.L"]
    d2 = unit(J["forearm_dir.L"])
    side = unit(np.cross(d2, np.array([0.0, -1.0, 0.0])))          # across the palm
    c = w + d2 * 0.050
    fr = sdf.frame(d2, side)
    l.add(RoundBox(c, (0.040, 0.016, 0.046), 0.014, axes=fr), k=0.0)
    l.add(Capsule(w + d2 * 0.022 + side * 0.034, w + d2 * 0.052 + side * 0.050, 0.014), k=0.012)
    if cuff:
        l.add(Torus(w + d2 * 0.004, 0.042, 0.014, axes=sdf.frame(d2)), k=0.008)
    part(out, "mitt_L", l, role, "bone:hand.L", 110, vs=0.6, pull=pull)


def _legs(out, boot_role, felt):
    tr = Sculpt("trousers")
    for s in ("L", "R"):
        a, k = J[f"ankle.{s}"], J[f"knee.{s}"]
        tr.add(RoundCone((a[0], a[1] + 0.005, 0.07), (k[0], k[1], k[2] + 0.02), 0.040, 0.046), k=0.0)
    part(out, "trousers", tr, "under", "auto", 80, vs=1.2, pull=0.6, uv=0.6)
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
        part(out, f"boot_{s}", b, "leather", f"bone:foot.{s}", 80, vs=0.8, pull=0.55, uv=0.7)


def _pole(out, wood):
    p = Sculpt("pole")
    p.add(RoundCone(POLE_FOOT + POLE_AX * 0.022, POLE_FOOT + POLE_AX * 1.26, 0.0225, 0.0195), k=0.0)
    part(out, "pole", p, wood, "bone:prop.R", 110, vs=0.55, paint="proc", uv=0.8)


def _hollow(out, O, F, depth, rx, ry, ink_c, glow):
    """The dark hollow (ink back wall) and the one lamp-glow volume: a wide, flat pool of light on the hollow's
    floor (accent). From the 52 degree camera it reads as light pooled in the hood; head-on only a thin sliver
    shows above the lower lip - never a face feature, never two points."""
    n, Y = F[2], F[1]
    h = Sculpt("hollow")
    h.add(Ellipsoid(O - n * (depth + 0.15), (rx, ry, 0.08), axes=F), k=0.0)
    part(out, "hollow", h, "ink", "bone:head", 60, vs=0.9, paint="ink", uv=0.4)
    g = Sculpt("hoodlight")
    gc, gr = glow
    g.add(Ellipsoid(O - Y * gc[0] - n * gc[1], gr, axes=F), k=0.0)
    part(out, "hoodlight", g, "accent", "bone:head", 60, vs=0.7, paint="accent")


# ── AUBADE: rounded cowl, chalk rim, knob, seam; straight folds, pointed hem, chalk stole ─────────────────
A_HOOD_OUT = [(0.0, 0.955), (0.062, 0.948), (0.106, 0.928), (0.139, 0.898), (0.160, 0.862), (0.172, 0.818),
              (0.177, 0.768), (0.179, 0.718), (0.177, 0.676), (0.168, 0.645), (0.146, 0.628), (0.08, 0.622), (0.0, 0.62)]
A_OPEN_TILT = 12.0
A_OPEN_O = np.array([0.0, -0.166, 0.765])
A_CLOAK_OUT = [(0.0, 0.662), (0.07, 0.657), (0.115, 0.642), (0.146, 0.616), (0.161, 0.585), (0.167, 0.55),
               (0.172, 0.48), (0.182, 0.40), (0.196, 0.32), (0.212, 0.24), (0.228, 0.17), (0.238, 0.115),
               (0.242, 0.085), (0.24, 0.07), (0.0, 0.068)]
A_CLOAK_SY = 0.88


def aubade_parts() -> list:
    out = []
    F = opening_frame(A_OPEN_TILT)
    O = A_OPEN_O
    n, Y = F[2], F[1]
    # HOOD: a soft rounded cowl (round as a helmet on top), swept back at the nape, an arched opening
    hood = Sculpt("hood")
    lat, cur = solid_lathe((0.0, 0.02, 0.0), A_HOOD_OUT, sy=1.08)
    hood.add(lat, k=0.0)
    hood.add(Ellipsoid((0.0, 0.118, 0.668), (0.128, 0.105, 0.068)), k=0.05)          # the nape drape
    hood.add(Ellipsoid((0.0, -0.118, 0.668), (0.135, 0.075, 0.052)), k=0.045)        # the chin of the cowl
    hood.sub(Ellipsoid(O - n * 0.068, (0.119, 0.128, 0.13), axes=F), k=0.012)        # the opening + hollow
    part(out, "hood", hood, "cloth2", "bone:head", 500, vs=0.8, pull=0.65, uv=1.7, top=True, tint="#A2B3C5")
    rim = Sculpt("hood_rim")
    rim.add(Torus(O + n * 0.002, 0.12, 0.0185, axes=ring_axes(F, 0.114, 0.130, 0.12), rz=0.015), k=0.0)
    part(out, "hood_rim", rim, "chalk", "bone:head", 150, vs=0.6, pull=0.5, uv=1.3)
    line = Sculpt("rim_line")
    line.add(Torus(O - n * 0.004, 0.12, 0.0075, axes=ring_axes(F, 0.141, 0.157, 0.12)), k=0.0)
    part(out, "rim_line", line, "accent", "bone:head", 80, vs=0.55, paint="accent")
    knob = Sculpt("knob")
    knob.add(Sphere((0.0, 0.02, 0.975), 0.0245), k=0.0)
    knob.add(Torus((0.0, 0.02, 0.953), 0.022, 0.0085), k=0.006)
    part(out, "knob", knob, "chalk", "bone:head", 50, vs=0.45, paint="proc", uv=0.6)
    # the seam: brow -> over the crown -> down the back to the nape (on the hood's centre line)
    c0 = np.array([0.0, 0.02, 0.775])
    angs = np.radians(np.linspace(30, 200, 30))        # 0 = forward, 90 = straight up, 180 = back
    dirs = np.stack([np.zeros_like(angs), -np.cos(angs), np.sin(angs)], axis=1)
    pts = surface_curve(hood, c0, dirs)
    pts = [p + unit(p - c0) * 0.0025 for p in pts if p[2] > 0.655 and np.linalg.norm(p - O) > 0.148]
    seam = Sculpt("seam")
    seam.add(Tube(pts, [0.0135] * len(pts), k=0.0), k=0.0)
    part(out, "seam", seam, "accent", "bone:head", 70, vs=0.7, paint="accent")
    _hollow(out, O, F, 0.0, 0.112, 0.124, None, ((0.102, 0.088), (0.092, 0.024, 0.068)))
    # CLOAK: a bell from the shoulders, long straight folds, a hem cut into shallow points, a front slit
    cloak = Sculpt("cloak")
    clat, ccur = solid_lathe((0.0, 0.0, 0.0), A_CLOAK_OUT, sy=A_CLOAK_SY)
    Rc = radius_fn(ccur[: np.argmax(ccur[:, 1] < 0.075)])
    cloak.add(clat.displaced(vfolds(lambda z: 0.003 + 0.011 * smooth(0.56, 0.16, z), 8, 0.7), 0.014), k=0.0)

    def hem(P):
        ang = np.arctan2(P[:, 0], -P[:, 1])
        s = (ang * 9 / (2 * math.pi) + 0.5) % 1.0
        tri = 1.0 - np.abs(2.0 * s - 1.0)
        return (0.137 - 0.036 * tri) - P[:, 2]
    cloak.inter(Fn(hem, (-0.3, -0.3, 0.0), (0.3, 0.3, 0.7)), k=0.005)

    def slit(P):
        w = 0.052 * np.clip((0.245 - P[:, 2]) / 0.14, 0.0, 1.0)
        return np.maximum(np.maximum(np.abs(P[:, 0]) - w, P[:, 2] - 0.245), P[:, 1] + 0.06)
    cloak.sub(Fn(slit, (-0.08, -0.3, 0.0), (0.08, -0.04, 0.26)), k=0.012)
    part(out, "cloak", cloak, "cloth", CLOAK_BIND, 620, vs=1.15, pull=0.65, uv=1.0, top=True, tint="#5D6F85")
    # STOLE: two chalk strips down the front, pointed ends
    stole = Sculpt("stole")
    for xc in (-0.068, 0.068):
        def strip(P, xc=xc):
            dx = np.abs(P[:, 0] - xc)
            tip = 0.212 + 0.034 * dx / 0.027
            return np.maximum(np.maximum(dx - 0.027, tip - P[:, 2]), P[:, 1] + 0.03)
        stole.add(shell((0.0, 0.0), Rc, 0.17, 0.645, 0.011, 0.006, sy=A_CLOAK_SY, extra=strip), k=0.0)
    part(out, "stole", stole, "chalk", CLOAK_BIND, 140, vs=0.6, pull=0.4, uv=1.0)
    # SASH (accent): a narrow cord sash round the waist, knotted at the front, two tails falling straight down
    sash = Sculpt("sash")
    sash.add(shell((0.0, 0.0), Rc, 0.452, 0.472, 0.0115, 0.004, sy=A_CLOAK_SY), k=0.0)
    kz = 0.462
    ky = -(Rc(kz) + 0.018) * A_CLOAK_SY
    sash.add(Ellipsoid((0.012, ky, kz), (0.022, 0.014, 0.017)), k=0.006)
    for xt, zb in ((0.004, 0.375), (0.026, 0.395)):
        def tail(P, xt=xt, zb=zb):
            return np.maximum(np.maximum(np.abs(P[:, 0] - xt) - 0.0095, zb - P[:, 2]), P[:, 1] + 0.05)
        sash.add(shell((0.0, 0.0), Rc, zb - 0.01, kz, 0.017, 0.004, sy=A_CLOAK_SY, extra=tail), k=0.004)
    part(out, "sash", sash, "accent", CLOAK_BIND, 120, vs=0.8, paint="accent")
    _sleeves(out, "cloth", 0.056, wraps=True, tint="#63768C")
    _mitts(out, "cloth", cuff=False, pull=0.3)
    _legs(out, "leather", felt=False)
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
    crook.add(Capsule(CROOK_BASE, HOOK, 0.0155), k=0.0)
    crook.add(Capsule(HOOK, HOOK + cdir * 0.028 + np.array([0, 0, 0.018]), 0.0135), k=0.008)   # upturned end
    crook.add(Capsule(POLE_FOOT + POLE_AX * 1.09, CROOK_BASE + cdir * 0.08, 0.010), k=0.01)  # brace
    crook.add(Torus(HOOK - cdir * 0.012, 0.019, 0.0065, axes=sdf.frame(cdir)), k=0.003)
    part(out, "crook", crook, "chalk", "bone:prop.R", 80, vs=0.55, paint="proc", uv=0.7)
    _aubade_lamp(out)
    return out


def _aubade_lamp(out):
    c = LAMP_C
    panes = Sculpt("lamp_panes")
    panes.add(HexPrism(c, 0.039, 0.053, 0.003), k=0.0)
    part(out, "lamp_panes", panes, "accent", "bone:x_lamp_1", 60, vs=0.4, paint="accent")
    fr = Sculpt("lamp_frame")
    R = 0.039 / 0.866 + 0.002
    for i in range(6):
        a = math.radians(30 + 60 * i)
        p = c + np.array([math.cos(a) * R, math.sin(a) * R, 0.0])
        fr.add(Capsule(p - (0, 0, 0.054), p + (0, 0, 0.054), 0.0068), k=0.0)
    fr.add(HexPrism(c + (0, 0, 0.060), 0.047, 0.009, 0.003), k=0.004)
    fr.add(HexPrism(c + (0, 0, -0.060), 0.045, 0.009, 0.003), k=0.004)
    fr.add(RoundCone(c + (0, 0, 0.066), c + (0, 0, 0.100), 0.044, 0.004), k=0.004)      # the pointed cap
    fr.add(Torus(c + (0, 0, 0.108), 0.0085, 0.0038, axes=sdf.frame((1.0, 0.0, 0.0))), k=0.002)
    fr.add(RoundCone(c + (0, 0, -0.068), c + (0, 0, -0.092), 0.021, 0.003), k=0.004)    # the drop
    part(out, "lamp_frame", fr, "chalk", "bone:x_lamp_1", 150, vs=0.45, paint="proc", uv=0.9)
    cord = Sculpt("cord")
    cord.add(Capsule(HOOK - (0, 0, 0.008), c + (0, 0, 0.106), 0.0055), k=0.0)
    part(out, "cord", cord, "stone", "bone:x_lamp_1", 24, vs=0.4, paint="proc", uv=0.3)


# ── SERENADE: low broad felt dome on a thick rolled collar, accent crown band; bell cloak, mantle, bands ─
S_DOME_OUT = [(0.0, 0.962), (0.062, 0.957), (0.103, 0.942), (0.133, 0.921), (0.154, 0.894), (0.168, 0.862),
              (0.177, 0.825), (0.180, 0.786), (0.177, 0.752), (0.165, 0.722), (0.13, 0.70), (0.0, 0.69)]
S_OPEN_TILT = 8.0
S_OPEN_O = np.array([0.0, -0.170, 0.742])
S_CLOAK_OUT = [(0.0, 0.645), (0.09, 0.638), (0.135, 0.612), (0.160, 0.572), (0.172, 0.522), (0.185, 0.44),
               (0.205, 0.36), (0.228, 0.28), (0.25, 0.20), (0.266, 0.13), (0.275, 0.09), (0.274, 0.072),
               (0.262, 0.062), (0.0, 0.06)]
S_CLOAK_SY = 0.88


def serenade_parts() -> list:
    out = []
    F = opening_frame(S_OPEN_TILT)
    O = S_OPEN_O
    n, Y = F[2], F[1]
    pocket = Ellipsoid(O - n * 0.066, (0.142, 0.110, 0.13), axes=F)
    # DOME: low and broad, wider than tall
    dome = Sculpt("dome")
    lat, cur = solid_lathe((0.0, 0.025, 0.0), S_DOME_OUT, sy=1.05)
    dome.add(lat, k=0.0)
    dome.sub(pocket, k=0.012)
    part(out, "dome", dome, "cloth2", "bone:head", 400, vs=0.85, pull=0.75, uv=1.6, top=True, tint="#AD8F68")
    # ROLLED COLLAR: a fat felt roll round the neck (lower at the front) + a horseshoe frame round the opening
    roll = Sculpt("roll")
    roll.add(Torus((0.0, 0.03, 0.662), 0.152, 0.057, axes=np.diag([1.0, 1 / 1.06, 1.0]) @ sdf.rot_x(-9), rz=0.05), k=0.0)
    roll.add(cowl_rim(lat, O, F, 0.118, 0.094, 0.62, 0.034), k=0.03)                 # the thick felt roll
    roll.inter(HalfSpace((0.0, 0.0, 0.815), (0.0, 0.0, 1.0), 1.0), k=0.035)          # ... sides and bottom only
    roll.add(cowl_rim(lat, O, F, 0.118, 0.094, 0.16, 0.014), k=0.012)                # the thin lip over the top
    roll.sub(pocket, k=0.01)
    part(out, "roll", roll, "ironstone", "bone:head", 270, vs=0.85, pull=0.55, uv=1.3, top=True, tint="#4A3A31")
    band = Sculpt("band")
    Rd = radius_fn(cur[cur[:, 1] > 0.705])
    tn = unit((0.0, math.tan(math.radians(16)), 1.0))                  # the band's plane: higher at the front
    bc = np.array([0.0, 0.025, 0.797])
    band.add(shell((0.0, 0.025), Rd, 0.70, 0.90, 0.013, 0.004, sy=1.05,
                   extra=lambda P: np.abs((P - bc) @ tn) - 0.016), k=0.0)
    band.sub(Ellipsoid(O - n * 0.066, (0.134, 0.104, 0.14), axes=F), k=0.008)
    part(out, "band", band, "accent", "bone:head", 90, vs=0.9, paint="accent")
    lining = Sculpt("lining")
    lining.add(Torus(O - n * 0.014, 0.12, 0.0062, axes=ring_axes(F, 0.124, 0.094, 0.12)), k=0.0)
    part(out, "lining", lining, "accent", "bone:head", 60, vs=0.8, paint="accent")
    _hollow(out, O, F, 0.0, 0.13, 0.10, None, ((0.086, 0.088), (0.10, 0.022, 0.068)))
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
    part(out, "mantle", mantle, "cloth2", CLOAK_BIND, 210, vs=0.85, pull=0.75, uv=1.2, top=True, tint="#B0926B")
    # CLOAK: a wide umber bell, soft felt folds, two ironstone hem bands
    cloak = Sculpt("cloak")
    clat, ccur = solid_lathe((0.0, 0.0, 0.0), S_CLOAK_OUT, sy=S_CLOAK_SY)
    Rc = radius_fn(ccur[: np.argmax(ccur[:, 1] < 0.08)])
    cloak.add(clat.displaced(vfolds(lambda z: 0.002 + 0.009 * smooth(0.5, 0.12, z), 6, 0.3, wobble=0.35), 0.011), k=0.0)
    part(out, "cloak", cloak, "cloth", CLOAK_BIND, 520, vs=1.1, pull=0.85, uv=1.0, top=True, tint="#6B4C3C")
    bands = Sculpt("hem_bands")
    bands.add(shell((0.0, 0.0), Rc, 0.188, 0.222, 0.010, 0.006, sy=S_CLOAK_SY), k=0.0)
    bands.add(shell((0.0, 0.0), Rc, 0.080, 0.110, 0.010, 0.006, sy=S_CLOAK_SY), k=0.0)
    part(out, "hem_bands", bands, "ironstone", CLOAK_BIND, 140, vs=1.0, pull=0.55, uv=0.8)
    # SASH (accent): a broad felt band at the waist under the mantle, a round knot on the wick's left
    sash = Sculpt("sash")
    sash.add(shell((0.0, 0.0), Rc, 0.410, 0.436, 0.0115, 0.004, sy=S_CLOAK_SY), k=0.0)
    kz = 0.424
    ang = math.radians(28)
    rr = Rc(kz) + 0.016
    sash.add(Sphere((math.sin(ang) * rr, -math.cos(ang) * rr * S_CLOAK_SY, kz), 0.021), k=0.006)
    part(out, "sash", sash, "accent", CLOAK_BIND, 110, vs=0.9, paint="accent")
    _sleeves(out, "cloth", 0.054, wraps=False, tint="#6B4C3C")
    _mitts(out, "leather", cuff=True, pull=0.55)
    _legs(out, "leather", felt=True)
    # PROPS: walnut pole, round ironstone knob, level walnut crook with an iron ring, squat round lantern
    _pole(out, "wood_dark")
    kn = Sculpt("knob")
    kn.add(Sphere(POLE_FOOT + POLE_AX * 1.295, 0.034), k=0.0)
    kn.add(Torus(POLE_FOOT + POLE_AX * 1.258, 0.022, 0.007, axes=sdf.frame(POLE_AX)), k=0.004)
    part(out, "knob", kn, "ironstone", "bone:prop.R", 60, vs=1.0, paint="proc", uv=0.6)
    crook = Sculpt("crook")
    base = POLE_FOOT + POLE_AX * 1.215
    end = np.array([HOOK[0], HOOK[1], base[2]])
    cdir = unit(end - base)
    crook.add(Capsule(base, end + cdir * 0.03, 0.0165), k=0.0)
    crook.add(RoundCone(end + cdir * 0.03, end + cdir * 0.045, 0.019, 0.017), k=0.004)
    part(out, "crook", crook, "wood_dark", "bone:prop.R", 60, vs=0.6, paint="proc", uv=0.6)
    ring = Sculpt("ring")
    ring.add(Torus(end - (0, 0, 0.004), 0.021, 0.0062, axes=sdf.frame(cdir)), k=0.0)
    part(out, "ring", ring, "ironstone", "bone:prop.R", 36, vs=0.6, paint="proc", uv=0.4)
    _serenade_lamp(out, end)
    return out


def _serenade_lamp(out, hook):
    c = LAMP_C
    globe = Sculpt("lamp_globe")
    globe.add(Ellipsoid(c, (0.061, 0.061, 0.052)), k=0.0)
    part(out, "lamp_globe", globe, "accent", "bone:x_lamp_1", 80, vs=0.4, paint="accent")
    cage = Sculpt("lamp_cage")
    for i in range(6):
        a = math.radians(60 * i)
        pts = []
        for t in np.linspace(-0.85, 0.85, 6):
            ct = math.sqrt(1 - t * t)
            pts.append(c + np.array([math.cos(a) * 0.0645 * ct, math.sin(a) * 0.0645 * ct, 0.055 * t]))
        cage.add(Tube(pts, [0.0056] * len(pts), k=0.0), k=0.003)
    cage.add(Ellipsoid(c + (0, 0, 0.058), (0.051, 0.051, 0.029)), k=0.006)                 # the domed lid
    cage.inter(HalfSpace(c + (0, 0, 0.088), (0, 0, 1), 0.2), k=0.004)
    cage.add(Sphere(c + (0, 0, 0.092), 0.012), k=0.006)
    cage.add(Torus(c + (0, 0, 0.106), 0.0095, 0.004, axes=sdf.frame((1.0, 0.0, 0.0))), k=0.002)
    cage.add(Ellipsoid(c + (0, 0, -0.056), (0.037, 0.037, 0.013)), k=0.005)                # the foot dish
    part(out, "lamp_cage", cage, "ironstone", "bone:x_lamp_1", 170, vs=0.5, paint="proc", uv=0.9)
    resin = Sculpt("lamp_resin")
    resin.add(Torus(c + (0, 0, 0.041), 0.043, 0.0085), k=0.0)
    resin.add(Torus(c + (0, 0, -0.041), 0.043, 0.0085), k=0.0)
    part(out, "lamp_resin", resin, "lampresin", "bone:x_lamp_1", 60, vs=0.4, paint="proc", uv=0.5)
    cord = Sculpt("cord")
    top = c + (0, 0, 0.104)
    for i, t in enumerate(np.linspace(0.0, 1.0, 3)):
        p = hook - (0, 0, 0.022) + (top - (hook - (0, 0, 0.022))) * t
        ax = (1.0, 0.0, 0.0) if i % 2 == 0 else (0.0, 1.0, 0.0)
        cord.add(Torus(p, 0.0085, 0.0035, axes=sdf.frame(ax)), k=0.0)
    cord.add(Capsule(hook - (0, 0, 0.012), top, 0.004), k=0.002)
    part(out, "cord", cord, "ironstone", "bone:x_lamp_1", 30, vs=0.7, paint="proc", uv=0.3)


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


# ── paint: the projected painting finished per part (glimwick builds only: cfg["_glim"]) ───────────────
def _lin(c):
    c = np.asarray(c, dtype=np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def _robust_mean(lin):
    """mean colour of the lit, visible paint: the darkest 35 % (occluded fills, crevices, undersides) and the
    brightest 5 % are left out, so the palette pull and crown refills match what the camera sees"""
    lum = lin @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    lo, hi = np.percentile(lum, [35, 95])
    sel = (lum >= lo) & (lum <= hi)
    return lin[sel].mean(axis=0) if sel.sum() > 20 else lin.mean(axis=0)


def _finish_paint(img, maps, names, g, log):
    P, N, part_ = maps["P"], maps["N"], maps["part"]
    out = img.copy()
    pal = g["palette"]
    baked = None
    im = bpy.data.images.get(f"{g['id']}_base")
    if im is not None and tuple(im.size) == (img.shape[1], img.shape[0]):
        a = np.empty(im.size[0] * im.size[1] * 4, dtype=np.float32)
        im.pixels.foreach_get(a)
        baked = a.reshape(im.size[1], im.size[0], 4)[::-1, :, :3]
    means = {}
    for i, nm in enumerate(names):
        cfg = g["parts"].get(nm)
        m = part_ == i
        if cfg is None or not m.any():
            continue
        mode = cfg["paint"]
        if mode == "proc" and baked is not None:
            out[m] = baked[m]
        elif mode == "ink":
            z = P[m][:, 2]
            ink = np.asarray(scene.hex_srgb(pal.get("ink", "#15171B")), dtype=np.float32)
            out[m] = ink[None, :] * (0.9 + 0.25 * np.clip((z - 0.66) / 0.2, 0, 1))[:, None]
        elif mode == "proj":
            lin = _lin(out[m])
            if cfg.get("top"):
                # crowns seen from the game camera: refill from the part's own side paint, lit from above
                nz = N[m][:, 2]
                side = (nz > 0.05) & (nz < 0.45)
                if side.sum() > 50:
                    ref = _robust_mean(lin[side])
                    w = 0.8 * smooth(0.50, 0.85, nz)[:, None]
                    Pm = P[m].astype(np.float64)
                    brk = 1.0 + 0.07 * NOISE(Pm, 9.0)[:, None] + 0.04 * NOISE(Pm, 31.0)[:, None]
                    lit = ref * (1.0 + 0.06 * smooth(0.6, 1.0, nz))[:, None] * brk
                    lin = lin * (1 - w) + lit * w
            role = cfg["role"]
            s = float(cfg.get("pull", 0.0))
            hexc = cfg.get("tint") or pal.get(role)
            if s > 0 and hexc:
                tgt = _lin(np.asarray(scene.hex_srgb(hexc), dtype=np.float32))
                mean = _robust_mean(lin)
                gain = np.clip(tgt / np.maximum(mean, 1e-4), 0.2, 5.0)
                lin = lin * (1.0 + s * (gain - 1.0))[None, :]
            if g.get("hem") and nm == "cloak":
                z = P[m][:, 2]
                lin = lin * (1.0 - g["hem"] * smooth(0.34, 0.10, z))[:, None]
            out[m] = _srgb(lin)
        if nm == g.get("pocket_part"):
            # the hood's own inner walls (inside the opening pocket) go to ink, deeper = darker
            c, rad, ax = g["pocket"]
            q = ((P[m] - c) @ np.asarray(ax).T) / np.asarray(rad)
            inside = np.sum(q * q, axis=1) < 1.22
            if inside.any():
                ink = np.asarray(scene.hex_srgb(pal.get("ink", "#15171B")), dtype=np.float32)
                sub = out[m]
                depth = np.clip(q[inside][:, 2] * -1.0 + 0.6, 0, 1)[:, None]
                sub[inside] = sub[inside] * (1 - (0.55 + 0.4 * depth)) + ink * (0.55 + 0.4 * depth)
                out[m] = sub
        c_ = (np.clip(out[m].mean(axis=0), 0, 1) * 255).round().astype(int)
        means[nm] = "#%02X%02X%02X" % tuple(c_)
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

    def run_s(t):
        q = t % 1.0
        p = dict(base_run.sample(t))
        for b in ARM_BONES:
            p.pop(b, None)
        ik = {}
        for k, f in p["ik"].items():
            if k.startswith("foot"):
                ik[k] = FT((f.ankle[0], f.ankle[1], f.ankle[2] * 0.42), f.pitch * 0.75, f.yaw, f.toe, f.knee, f.weight)
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
        p.update(skirt(3.0 + 2.0 * bob))
        p["x_skirt_f"] = (4.0 + 5.0 * max(0.0, math.sin(2 * math.pi * q)), 0.0, 0.0)
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
    G_DOWN = (-0.045, 0.02, -0.385)                  # the palm low on the wick's right (pole tip on the ground)
    down = with_(d0, hips_loc=(-0.02, 0.02, -0.17), spine=(12, 0, 12), chest=(10, 0, 10), neck=(8, 0, 4),
                 head=(18, -6, 6), upper_arm_L=(10, 0, 18), forearm_L=(24, 0, 0))
    down["_grip"] = grip_at(G_DOWN)
    down["_pole"] = (0.0, 101.0, 0.0)
    down["_twist"] = (90.0, 0.0, 0.0)
    down.update(skirt(44.0))
    bounce = with_(down, hips_loc=(-0.02, 0.02, -0.195))
    bounce["_pole"] = (0.0, 97.0, 0.0)
    bounce["_grip"] = grip_at((G_DOWN[0], G_DOWN[1], G_DOWN[2] + 0.02))
    bounce.update(skirt(52.0))
    slump = with_(down, hips_loc=(-0.02, 0.02, -0.21), spine=(16, 0, 14), chest=(14, 0, 12), neck=(10, 0, 4),
                  head=(26, -8, 6))
    slump.update(skirt(57.0))
    rest = with_(slump, hips_loc=(-0.02, 0.02, -0.205))
    rest.update(skirt(55.0))
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
        if faction == "aubade":
            F, O = opening_frame(A_OPEN_TILT), A_OPEN_O
            pocket = (O - F[2] * 0.068, (0.119, 0.128, 0.13), F)
            pocket_part, hem = "hood", 0.5
        else:
            F, O = opening_frame(S_OPEN_TILT), S_OPEN_O
            pocket = (O - F[2] * 0.066, (0.142, 0.110, 0.13), F)
            pocket_part, hem = "dome", 0.25
        proj["_glim"] = {"id": self.ID, "faction": faction, "palette": dict(self.PALETTE), "hem": hem,
                         "pocket_part": pocket_part, "pocket": (np.asarray(pocket[0]), pocket[1], np.asarray(pocket[2])),
                         "parts": {p["name"]: {k: p[k] for k in ("paint", "role", "pull", "top", "tint")} for p in self._parts}}
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
            P.append(fighter.Part(p["name"], high=ob, tris=p["tris"], bind=p["bind"], uv_weight=p["uv"]))
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
