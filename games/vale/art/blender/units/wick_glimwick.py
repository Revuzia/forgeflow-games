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
    (the pole) at -X. Round parts (the Aubade knob, the hood glows, the Serenade globe) get clean UV-ellipsoid
    lows; the accent strips get ribbon lows (make_low); everything else is the decimated SDF mesh.
  * THE HOLLOW (both cultures): a round-topped ARCH (Arch) carved as a tapered concave pocket 17 cm deep with a
    BOWL back (ArchPocket). Aubade: the concept's BELL arch (narrow round top, flared foot) framed by a carved
    chalk rim (rim_mesh: a clean 3.4 cm band lying on the cowl, its inner wall, chamfers, flat face and fall each
    with their own vertices so the creases stay crisp). Serenade: the concept's wide arch in a THICK dark felt
    roll (5.4 cm, 4 cm proud) whose ends sink into the rolled collar (the collar's front is the sill). Everything
    inside the void is ink, matte and fully occluded in the ORM.
    THE HOOD LIGHT (rule 0.2, HoodCore; fix round 4, shared with every kind): ONE soft core, the front of a 16-round
    ellipsoid wider than tall, ~3 cm behind the opening, centred between the sill (the Serenade collar roll) and the
    arch top, and its HALO (wick_common.halo_mesh: an alpha-blended accent cap 2 x the core whose vertex alpha falls
    from 0.85 at the core's outline to 0 at its rim, written into the GLB by wick_common.inject_halo), dark hollow
    all round; its light on the walls round it is team-neutral paint (spill). The wide dome lying on the sill of the
    passes before (HoodGlow, kept for reference) read as a tongue in an open mouth at eye level and a lit visor
    crescent from the 52 deg camera (review r3 blocker). Also tried and dropped: a floor pool / small ellipsoid (an
    iris), a flame on a chalk dish (a cyclops eye), a lit lining (a flat screen).
  * PROPS share one layout in both cultures (the caster read: one tall vertical line with a lamp off its top):
    pole 4.5-5.2 cm, foot by the right boot, tip 1.32 m; a crook at 1.20 m reaching 0.20 m out to the side and
    forward; the lamp (the biggest light) hangs on a short cord with its centre at 1.06 m. Thin props are clean
    low-poly tubes / turned parts (tube_mesh, lathe_mesh), never decimated SDF tubes (they crumpled and kinked).
    Aubade: a six-sided lantern, an accent core seen through dawnglass panes (glossy pale-blue borders) between
    slim chalk corner posts, chalk plates, the pointed hexagonal chalk roof with a ball, a chalk drop; a turned
    chalk spire finial, a clean angled chalk crook + brace. Serenade: a squat globe whose lit core band sits
    between glossy lampresin shoulders under six ironstone cage straps (ribbons lying on it), a domed iron lid +
    knob, a foot dish and a resin drop; a thicker walnut pole with two sand-felt bindings (it vanished on dark
    ground), a turned ironstone knob, a level crook with a ring.
  * PAINT (_painted): each painted part is its faction colour (palette role or `tint`) painted with a top light,
    a vertical gradient, broken colour, the form's own value structure (_cavity) and the cloak folds from their
    own displacement, a warm-lit / shade temperature shift (Serenade's shade stays warm: a blue-cool shade turned
    the umber cloak mauve); then THE CONCEPT'S OWN PAINTING carried through strongly (review 2026-10-27 item 3:
    its brush strokes, fold light, felt / linen texture as a luminance ratio against their 4.5 cm 3D low-pass,
    clamped 0.66-1.40, plus its warm / cool colour variation as a chroma ratio; texels far from the part's own
    value and up-facing tops (the plates' outline stroke lands on the crown) left out). Then the culture marks:
    Aubade slate beds by the seams, carved rim blocks, the open front between the stoles (a pleated tunic, a
    wrapped sash), wrapped forearm bindings, a slate hem band, dark lining in the parting and under the hem;
    Serenade the lid-edge welt's shadow and stitches over the band, felt panel seams, a quilted collar, a dark
    stitched bed over the mantle band, two crisp ironstone hem bands. Every texel in the hood pocket (and the
    body seen through it) is ink, deeper = darker. UVs: smart project at 74 deg (fewer chips), props weighted
    down (the pole had 12-15 % of the atlas).
  * ACCENT (brief 4; FACTOR-ONLY: no maps, the renderer tints it, the shared load test checks it; matte,
    roughness 0.85, so no white glints break the team colour). Generous by design (review 2026-10-27 item 2:
    true-scale 52 deg share 7-10 %, the brief's 4.5-6 % was the old weakest of the family): the hood light; the
    hood mark (Aubade: a 4.2 cm centre seam from under the rim over the crown down the back + the concept's two
    3 cm side panel seams down the flanks; Serenade: a 4 cm crown band lying on the dome right on top of the felt
    roll all round (s_band_table: the concept's lit lip over the opening, the dome / collar seam at the back),
    under a felt lid-edge welt, so it reads as light leaking from the seam, not a headband); the lamp core (the
    biggest share); Serenade only, the family's mantle band (2.2 cm along the capelet's scalloped hem: the side /
    back read). Every strip has a dark bed beside it (slate / ironstone), so it keeps its contrast whichever tint.
  * ORM: roughness gaps and the downscale-mixed island borders filled from the nearest island, metal zeroed,
    metallicFactor 0 (a wrapper on bake.bake_asset, written through a fresh image and reloaded so the exporter
    packs it); the ink texels roughness 1 and occlusion 0.06; AO reach 10 cm (the swinging lamp bakes no fixed
    shadow onto the hood).
  * RIG: VALE_BIPED_1 at minion proportions; the right arm is re-seated on the pole (the rest pose IS the
    hold); prop.R runs up the pole from the palm; x_lamp_1 (the one sway bone) hangs the lamp; four posed
    (non-sway) skirt bones x_skirt_{f,b,l,r} carry the cloak's lower half (run: it swings ahead of the forward
    boot; death: it heaps up as the wick sinks into it).
  * CLIPS: bespoke idle / run (a minion scurry: planted contact at the exact ground speed, the ankle lifted by
    what the foot pitch would push under the ground, a 6 cm swing that lifts early inside the bell and comes
    through low, the pole carried off the ground) / attack1 (the pole tips and the left palm pushes by IK on the
    impact frame) / death (the pole topples to the RIGHT and lies there; the wick sinks 10.5 cm into an unevenly
    flared cloak heap, the hood drooping, the left mitt folded in); the other required clips reuse them.

HARD RULES kept here (brief 0): both hoods are ROUND (Aubade: a rounded cowl with a 5 cm round chalk ball;
Serenade: a low broad dome) - never tall, pointed or conical; no face (the hollow is ink with ONE wide dome of
light filling its floor wall to wall, never two points, never a centred dot, pupil or iris; no painted lines on
the hood back: a V fold + the seam + a nape notch read as a face).
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
CROOK_S = 1.20
CROOK_BASE = POLE_FOOT + POLE_AX * CROOK_S
# where the cord hangs (the crook's end: 0.20 m out, more to the side than forward so the lamp hangs clear of the
# pole and the hood at the 3/4 facings too: review 2026-10-27 item 9)
HOOK = CROOK_BASE + np.array([-0.150, -0.128, 0.040])
LAMP_C = np.array([HOOK[0], HOOK[1], 1.062])             # the lamp's centre (brief 1.08)
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

    def __init__(self, A: Arch, depth, front=0.1, taper=0.3, k=0.035, bowl=0.25):
        self.A, self.depth, self.front, self.taper, self.k, self.bowl = A, depth, front, taper, k, bowl

    def bounds(self):
        return self.A.box(0.03, self.depth + 0.03, self.front + 0.01)

    def d(self, P):
        q = self.A.q(P)
        t = np.clip(-q[:, 2] / self.depth, 0.0, 1.0)
        s = 1.0 - self.taper * t
        yc = self.A.yc
        d2 = self.A.prof(q[:, 0] / s, (q[:, 1] - yc) / s + yc) * s
        # the back is a BOWL (deepest at the centre, shallower toward the outline): no flat back wall, no box
        hy = 0.5 * (self.A.y_top - self.A.y_bot)
        r2 = np.minimum((q[:, 0] / (self.A.hw_bot * s)) ** 2 + ((q[:, 1] - yc) / (hy * s)) ** 2, 1.5)
        dz = np.maximum(-q[:, 2] - self.depth * (1.0 - self.bowl * r2), q[:, 2] - self.front)
        return sdf.smax(d2, dz, self.k)


def arch_frame(base, A: Arch, width, thick, sink=0.012, behind=0.07, k=0.0, inner=None, y_min=None):
    """A frame round the opening that HUGS the hood surface (`base`, the uncarved hood): the layer from
    `sink` inside the surface to `thick` outside it, within `width` of the arch outline. k > 0 rounds the
    profile (a felt roll); k = 0 keeps the carved stone edges crisp. `inner` (an Arch with a raised bottom):
    the frame's inner edge follows it instead (a SILL standing up across the bottom of the opening). `y_min`
    (opening-frame y): the frame stops there (its ends sink into the Serenade collar: no knobs, no bottom bar)."""
    def fn(P):
        d0 = base.d(P)
        sh = np.maximum(d0 - thick, -d0 - sink)
        if inner is None:
            ann = np.abs(A.d2(P) - width / 2) - width / 2
        else:
            ann = np.maximum(-inner.d2(P), A.d2(P) - width)
        d = sdf.smax(sh, ann, k) if k > 0 else np.maximum(sh, ann)
        q = A.q(P)
        if y_min is not None:
            d = np.maximum(d, y_min - q[:, 1])
        return np.maximum(d, -behind - q[:, 2])
    lo, hi = A.box(width + thick + 0.02, behind + 0.01, 0.09)
    return Fn(fn, lo, hi)


def surface_strip(base, half_w, region, lo, hi, out=0.0055, inn=0.006):
    """A strip lying ON a surface (`base`: the uncarved SDF): the layer from `inn` inside the surface to `out`
    outside it, where half_w(P) <= 0 (across the strip) and region(P) <= 0 (along it). It follows the surface
    exactly, so it can never lift off the hood or float past the dome's silhouette (a tube along sampled
    surface points did both once decimated)."""
    def fn(P):
        d0 = base.d(P)
        return np.maximum(np.maximum(np.maximum(d0 - out, -d0 - inn), half_w(P)), region(P))
    return Fn(fn, lo, hi)


def surface_path(base, origin, dirs, tmax=0.4, steps=320):
    """Points where rays from `origin` along `dirs` leave the SDF `base` (scan inward from tmax, bisect), with the
    surface normal there (the SDF gradient)."""
    pts = []
    ts = np.linspace(tmax, 0.0, steps)
    o = np.asarray(origin, dtype=np.float64)
    for d in dirs:
        d = unit(d)
        dv = base.d(o[None, :] + ts[:, None] * d[None, :])
        hit = np.nonzero(dv < 0)[0]
        if not len(hit):
            continue
        i = hit[0]
        lo, hi = ts[i], ts[max(0, i - 1)]
        for _ in range(32):
            mid = 0.5 * (lo + hi)
            if base.d((o + d * mid)[None, :])[0] < 0:
                lo = mid
            else:
                hi = mid
        pts.append(o + d * 0.5 * (lo + hi))
    P = np.array(pts)
    e = 4e-4
    g = np.stack([base.d(P + np.eye(3)[k] * e) - base.d(P - np.eye(3)[k] * e) for k in range(3)], axis=1)
    return P, g / np.linalg.norm(g, axis=1, keepdims=True)


def surface_path_v(base, origin, dirs, tmax=0.4, steps=200):
    """surface_path, vectorised over the directions (one SDF call per step of the bisection): the outermost point
    where each ray from `origin` leaves `base`, and the normal there"""
    o = np.asarray(origin, dtype=np.float64)
    D = np.stack([unit(d) for d in dirs])
    ts = np.linspace(tmax, 0.0, steps)
    dv = base.d((o[None, None, :] + ts[:, None, None] * D[None, :, :]).reshape(-1, 3)).reshape(steps, len(D))
    inside = dv < 0
    i = np.argmax(inside, axis=0)
    lo = ts[i]
    hi = ts[np.maximum(i - 1, 0)]
    for _ in range(26):
        mid = 0.5 * (lo + hi)
        m = base.d(o[None, :] + mid[:, None] * D) < 0
        lo = np.where(m, mid, lo)
        hi = np.where(m, hi, mid)
    P = o[None, :] + 0.5 * (lo + hi)[:, None] * D
    e = 4e-4
    g = np.stack([base.d(P + np.eye(3)[k] * e) - base.d(P - np.eye(3)[k] * e) for k in range(3)], axis=1)
    return P, g / np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-9)


def ribbon(P, Nr, hw, closed=False, lift=(0.0018, 0.0050)):
    """The low mesh of an accent strip lying on a surface: a tent-profiled ribbon (edges `lift[0]`, centre line
    `lift[1]` off the surface) along the centre line P (normals Nr), half width hw per point. 4 tris per
    segment, so a 2 cm strip gets 1.5-3 cm segments that hug the curve (a closed decimated volume spent its
    triangles on buried faces and cut through the dome in straight chords)."""
    n = len(P)
    T = np.zeros_like(P)
    for i in range(n):
        a = P[(i - 1) % n] if (closed or i > 0) else P[i]
        b = P[(i + 1) % n] if (closed or i < n - 1) else P[i]
        T[i] = unit(b - a)
    B = np.stack([unit(np.cross(Nr[i], T[i])) for i in range(n)])
    hw = np.broadcast_to(np.asarray(hw, dtype=np.float64), (n,))
    V = []
    for i in range(n):
        V += [P[i] + B[i] * hw[i] + Nr[i] * lift[0], P[i] + Nr[i] * lift[1], P[i] - B[i] * hw[i] + Nr[i] * lift[0]]
    F = []
    for i in range(n if closed else n - 1):
        j = (i + 1) % n
        for k in range(2):
            F.append((3 * i + k, 3 * i + k + 1, 3 * j + k + 1, 3 * j + k))      # normal along +Nr (outward)
    return np.array(V), F


def hex_roof(c, ap, h, flats_deg=(30.0, 90.0, 150.0, 210.0, 270.0, 330.0)):
    """A pointed hexagonal roof: base centre c (apothem `ap`), apex h above it; crisp facets (the Aubade
    lantern cap). The flats face the same way as HexPrism's (normals at 30 + 60 k deg)."""
    c = np.asarray(c, dtype=np.float64)
    b = math.atan2(ap, h)
    ns = [(math.cos(math.radians(a)), math.sin(math.radians(a))) for a in flats_deg]

    def fn(P):
        p = P - c
        d = c[2] - P[:, 2]
        for nx, ny in ns:
            s = p[:, 0] * nx + p[:, 1] * ny
            d = np.maximum(d, s * math.cos(b) + p[:, 2] * math.sin(b) - ap * math.cos(b))
        return d
    e = ap / 0.866 + 0.01
    return Fn(fn, c - (e, e, 0.01), c + (e, e, h + 0.01))


def _orient(V, F, out_dir):
    """Wind every triangle so its normal agrees with out_dir(face index, centroid) (outward)."""
    V = np.asarray(V, dtype=np.float64)
    G = []
    for i, f in enumerate(F):
        a, b, c = V[f[0]], V[f[1]], V[f[2]]
        n = np.cross(b - a, c - a)
        G.append(tuple(f) if np.dot(n, out_dir(i, (a + b + c) / 3.0)) >= 0 else (f[0], f[2], f[1]))
    return G


def tube_mesh(pts, radii, nsides=6, caps=(True, True), phase=0.0, up=(0.0, 0.0, 1.0)):
    """A clean low-poly tube along a polyline (parallel-transported frames, `nsides` per ring, flat fan caps).
    Thin props (pole, crook, cord, cage bars) stay straight and even; decimated SDF tubes crumpled into lumps and
    kinked (review 2026-10-27 item 3)."""
    P = np.asarray(pts, dtype=np.float64)
    n = len(P)
    r = np.broadcast_to(np.asarray(radii, dtype=np.float64), (n,))
    T = np.stack([unit(P[min(i + 1, n - 1)] - P[max(i - 1, 0)]) for i in range(n)])
    u = np.asarray(up, dtype=np.float64)
    Nn = u - T[0] * np.dot(u, T[0])
    if np.linalg.norm(Nn) < 1e-6:
        Nn = np.array([1.0, 0.0, 0.0]) - T[0] * T[0][0]
    Nn = unit(Nn)
    V, F, owner = [], [], []
    for i in range(n):
        if i:
            Nn = unit(Nn - T[i] * np.dot(Nn, T[i]))
        B = np.cross(T[i], Nn)
        for k in range(nsides):
            a = phase + 2.0 * math.pi * k / nsides
            V.append(P[i] + r[i] * (math.cos(a) * Nn + math.sin(a) * B))
    for i in range(n - 1):
        for k in range(nsides):
            a, b = i * nsides + k, i * nsides + (k + 1) % nsides
            c, d = (i + 1) * nsides + (k + 1) % nsides, (i + 1) * nsides + k
            F += [(a, b, c), (a, c, d)]
            owner += [("side", i), ("side", i)]
    for end, (ring, tv) in enumerate(((0, -T[0]), (n - 1, T[-1]))):
        if not caps[end]:
            continue
        ci = len(V)
        V.append(P[ring])
        for k in range(nsides):
            F.append((ci, ring * nsides + k, ring * nsides + (k + 1) % nsides))
            owner.append(("cap", tv))
    V = np.array(V)

    def out_dir(i, cen):
        kind, x = owner[i]
        if kind == "cap":
            return x
        a, b = P[x], P[x + 1]
        t = unit(b - a)
        foot = a + t * np.dot(cen - a, t)
        return cen - foot
    return V, _orient(V, F, out_dir)


def lathe_mesh(c, axis, prof, nsides=8, phase=0.0):
    """A clean turned part: rings of radius r at s along `axis` from `c` (prof [(r, s), ...] bottom to top; r = 0
    at an end makes a point, else a flat fan cap). Finials, knobs, spires: crisp and round where the decimated
    SDF went octagonal or crumpled."""
    c = np.asarray(c, dtype=np.float64)
    ax = unit(axis)
    fr = sdf.frame(ax)
    X, Y = fr[0], fr[1]
    V, F, rings = [], [], []
    for r, s in prof:
        if r <= 1e-6:
            rings.append([len(V)])
            V.append(c + ax * s)
            continue
        ring = []
        for k in range(nsides):
            a = phase + 2.0 * math.pi * k / nsides
            ring.append(len(V))
            V.append(c + ax * s + r * (math.cos(a) * X + math.sin(a) * Y))
        rings.append(ring)
    for j in range(len(rings) - 1):
        a_, b_ = rings[j], rings[j + 1]
        if len(a_) == 1 and len(b_) == 1:
            continue
        for k in range(nsides):
            if len(a_) == 1:
                F.append((a_[0], b_[(k + 1) % nsides], b_[k]))
            elif len(b_) == 1:
                F.append((a_[k], a_[(k + 1) % nsides], b_[0]))
            else:
                F += [(a_[k], a_[(k + 1) % nsides], b_[(k + 1) % nsides]), (a_[k], b_[(k + 1) % nsides], b_[k])]
    for end, j in ((0, 0), (1, len(rings) - 1)):
        if len(rings[j]) > 1:
            ci = len(V)
            V.append(c + ax * prof[j][1])
            for k in range(nsides):
                F.append((ci, rings[j][k], rings[j][(k + 1) % nsides]))
    V = np.array(V)
    ss = np.array([s for _, s in prof])

    def out_dir(i, cen):
        s = np.dot(cen - c, ax)
        rad = cen - c - ax * s
        if np.linalg.norm(rad) < 1e-4 or (abs(s - ss.min()) < 1e-6) or (abs(s - ss.max()) < 1e-6):
            return ax * (1.0 if s > 0.5 * (ss.min() + ss.max()) else -1.0) + rad * 0.1
        return rad
    return V, _orient(V, F, out_dir)


def lathe_sdf(c, axis, prof):
    """the SDF of a lathe_mesh profile (the bake high): a Lathe of the closed (r, s) outline"""
    pts = [(0.0, prof[0][1])] + [(r, s) for r, s in prof] + [(0.0, prof[-1][1])]
    poly = np.array(pts + [(-r, s) for r, s in pts[::-1][1:-1]])
    rmax = max(r for r, _ in prof) + 0.01
    return Lathe(tuple(c), poly_prof(poly), rmax, min(s for _, s in prof) - 0.005, max(s for _, s in prof) + 0.005,
                 axes=sdf.frame(axis))


def dome_mesh(c, radii, nu=12, nv=4, below=0.35, axes=None):
    """The upper part of an ellipsoid (elevation from -asin(below) to the pole): a lamp-light hump whose foot is
    buried in the floor it rises from (no hidden lower half spent)."""
    c = np.asarray(c, dtype=np.float64)
    ax = np.eye(3) if axes is None else np.asarray(axes, dtype=np.float64)
    rad = np.asarray(radii, dtype=np.float64)
    e0 = -math.asin(below)
    V, F = [], []
    for j in range(nv):
        e = e0 + (math.pi / 2 - e0) * j / nv
        for i in range(nu):
            a = 2.0 * math.pi * i / nu
            V.append(c + (np.array([math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e)]) * rad) @ ax)
    top = len(V)
    V.append(c + (np.array([0.0, 0.0, 1.0]) * rad) @ ax)
    for j in range(nv - 1):
        for i in range(nu):
            a, b = j * nu + i, j * nu + (i + 1) % nu
            F += [(a, b, b + nu), (a, b + nu, a + nu)]
    for i in range(nu):
        F.append(((nv - 1) * nu + i, (nv - 1) * nu + (i + 1) % nu, top))
    V = np.array(V)
    return V, _orient(V, F, lambda i, cen: cen - c)


def pocket_coords(A: Arch, pocket, P):
    """(x / half width, height above the floor / opening height, depth behind the opening) inside the hollow"""
    q = A.q(np.asarray(P, dtype=np.float64))
    t = np.maximum(-q[:, 2], 0.0)
    s = 1.0 - pocket.taper * np.clip(t / pocket.depth, 0.0, 1.0)
    yfl = A.yc + (A.y_bot - A.yc) * s
    h = (q[:, 1] - yfl) / ((A.y_top - A.y_bot) * s)
    xr = np.abs(q[:, 0]) / (A.hw_bot * s)
    return xr, h, t


class HoodGlow:
    """THE HOOD LIGHT (brief 0.2 / 4; review 2026-10-27 item 1): ONE wide soft ellipsoid of lamplight lying in the
    bottom of the hollow, wider than it is tall, its front `front` m behind the opening, its sides and foot sunk
    into the hollow's walls and floor. It fills the hollow from wall to wall, so the opening reads as a hood full
    of light rising from below (dark only in the crescent under the brow): no dark ring round a centred light (an
    iris), no pale dish, no flame (a pupil), never two points. The accent is factor-only (the shared load test):
    the dome is one flat colour; the light it throws on the back wall above it is PAINT (team-neutral, dim, a
    gradient fading up: spill(P))."""

    def __init__(self, A: Arch, pocket, front=0.035, rx=0.085, ry=0.050, rz=0.062, sink=0.012, solid=None,
                 floor_spill=False):
        self.A, self.pocket, self.floor_spill = A, pocket, floor_spill
        back = front + ry
        c0 = A.O + np.array([0.0, A.yc, -back]) @ A.F
        zs = np.linspace(0.0, 0.25, 501)
        pts = c0[None, :] - zs[:, None] * np.array([0.0, 0.0, 1.0])[None, :]
        dv = pocket.d(pts)
        if solid is not None:
            # the floor is whichever comes first going down: the pocket's floor or a solid filling the hollow's
            # bottom (the Serenade collar roll: the light sits ON it, not buried in it)
            dv = np.maximum(dv, -solid.d(pts))
        i = int(np.argmax(dv > 0.0))
        self.floor = pts[max(0, i - 1)] * 0.5 + pts[i] * 0.5
        self.c = self.floor - np.array([0.0, 0.0, sink])
        self.r = np.array([rx, ry, rz])
        self.top = self.c + np.array([0.0, 0.0, rz])

    def spill(self, P, N=None):
        """0..1, the light thrown on the hollow's walls ABOVE the dome: strongest just over its top edge on the
        back and side walls, fading up over ~6 cm (a soft gradient into the dark, never a ring round it)"""
        P = np.asarray(P, dtype=np.float64)
        d = (P - self.c) / self.r
        e = np.sqrt(np.sum(d * d, axis=1))                       # 1 on the dome's surface
        w = np.exp(-np.maximum(e - 1.0, 0.0) * 2.6) * smooth(0.95, 1.02, e)
        w = w * smooth(-0.3, 0.2, d[:, 2])                       # above its foot only (the floor round it is dark)
        if N is not None:
            Nd = np.asarray(N, dtype=np.float64)
            v = self.c - P
            facing = np.einsum("ij,ij->i", Nd, v) / np.maximum(np.linalg.norm(v, axis=1), 1e-6)
            w = w * smooth(-0.15, 0.45, facing)
            if self.floor_spill:
                # the floor IN FRONT of the light (the collar / felt roll's lower bore inside the opening): lit by
                # it, fading over ~4 cm toward the front, on faces turned up (else, inked, it read as a dark band
                # under a lit bar: a visor in a dark ring)
                fz = self.A.q(P)[:, 2] - self.A.q(self.c[None, :])[0, 2]
                lw = (np.exp(-np.maximum(fz - self.r[1], 0.0) / 0.035) * smooth(self.r[1] - 0.01, self.r[1] + 0.005, fz)
                      * smooth(0.10, 0.45, Nd[:, 2]) * smooth(self.top[2] + 0.005, self.top[2] - 0.02, P[:, 2]))
                w = np.maximum(w, 0.75 * lw)
        return w

    def add(self, out):
        V, F = dome_mesh(self.c, self.r, nu=14, nv=3, below=0.25)
        g = Sculpt("hoodlight")
        g.add(Sphere(self.top, 0.01), k=0.0)                  # stand-in high (the accent is never baked)
        part(out, "hoodlight", g, "accent", "bone:head", len(F), vs=1.0, paint="accent", prim=("mesh", V, F))


class HoodCore:
    """THE HOOD LIGHT, fix round 4 (review r3 BLOCKER: the wide flat dome lying on the sill read as a tongue in an open
    mouth at eye level and as a lit mouth / visor crescent from the 52 deg camera; every other kind had moved to a
    centred core): ONE soft core, the front of a 16-round ellipsoid wider than tall, its front `front` m behind the
    opening, CENTRED vertically between the sill (the pocket's floor at the opening, or the Serenade collar roll that
    rises into it) and the arch top (`h` = 0.5), dark hollow above, below and to both sides; and its HALO (wick_common:
    an alpha-blended cap 1.6 x the core, its vertex alpha falling to 0 at the rim). The light it throws on the hollow's
    walls round it is PAINT (team-neutral, dim, radial: spill(P))."""

    def __init__(self, A: Arch, pocket, front=0.032, rx=0.038, ry=0.020, rz=0.024, solid=None, h=0.47, reach=1.4):
        self.A, self.pocket, self.reach = A, pocket, reach
        # the sill: straight down the opening's centre line just behind its plane, the first solid (the pocket's
        # floor or the solid filling the hollow's bottom)
        p0 = A.O + np.array([0.0, A.y_top - 0.01, -0.012]) @ A.F
        ts = np.linspace(0.0, A.y_top - A.y_bot + 0.06, 600)
        pts = p0[None, :] - ts[:, None] * A.F[1][None, :]
        dv = pocket.d(pts)
        if solid is not None:
            dv = np.maximum(dv, -solid.d(pts))
        i = int(np.argmax(dv > 0.0)) if (dv > 0.0).any() else len(pts) - 1
        self.y_sill = float(A.q(pts[max(0, i - 1)][None, :])[0, 1])
        yc = self.y_sill + h * (A.y_top - self.y_sill)
        self.c = A.O + np.array([0.0, yc, -(front + ry)]) @ A.F
        self.r = np.array([rx, ry, rz])
        self.ax = np.stack([A.F[0], A.F[2], A.F[1]])            # across, out (toward the viewer), up
        self.top = self.c + rz * A.F[1]
        self.h_frac = (yc - self.y_sill) / (A.y_top - self.y_sill)

    def spill(self, P, N=None):
        """0..1, the lamplight on the hollow's walls round the core: 1 at its outline, an exponential fall over `reach`
        core radii, the same all round (never a pool below it: that was the old sill light); on faces turned to it"""
        P = np.asarray(P, dtype=np.float64)
        d = (P - self.c) @ self.ax.T
        e = np.sqrt((d[:, 0] / self.r[0]) ** 2 + (d[:, 2] / self.r[2]) ** 2 + (d[:, 1] / (self.r[1] * 2.6)) ** 2)
        w = np.exp(-np.maximum(e - 1.0, 0.0) / self.reach)
        if N is not None:
            v = self.c - P
            facing = np.einsum("ij,ij->i", np.asarray(N, dtype=np.float64), v) / np.maximum(np.linalg.norm(v, axis=1), 1e-6)
            w = w * smooth(-0.15, 0.45, facing)
        return w

    def add(self, out):
        X, Y, Z = self.ax
        rx, ry, rz = self.r
        V, F = wc.cap_mesh(self.c, X, Y, Z, rx, ry, rz, seg=16)
        g = Sculpt("hoodlight")
        g.add(Sphere(self.top, 0.01), k=0.0)                  # stand-in high (the accent is never baked)
        part(out, "hoodlight", g, "accent", "bone:head", len(F), vs=1.0, paint="accent", prim=("mesh", V, F))
        V, F = wc.halo_mesh(self.c, X, Y, Z, rx, ry, rz)
        g = Sculpt("hoodhalo")
        g.add(Sphere(self.top, 0.01), k=0.0)
        part(out, "hoodhalo", g, wc.HALO_MAT, "bone:head", len(F), vs=1.0, paint="accent", prim=("mesh", V, F))


# ── part list ──────────────────────────────────────────────────────────────────────────────────────────
def part(out, name, S, role, bind, tris, vs=1.0, paint="proj", uv=1.0, tint=None, light=0.30, detail=0.5, grad=None,
         cav=0.16, prim=None, hang=0.0, sym=True):
    """paint "proj": the faction colour (`tint`, else the palette role) painted with a top light, a vertical
    gradient `grad` (z0, z1, amount), the form's own value structure (`cav`: convex edges and fold ridges
    lighter, creases darker) and the concept's own brush strokes (detail transfer, outliers masked); "proc":
    the baked bible material; "accent": emissive, never painted. `prim` ("ellipsoid", c, radii, axes, (u, v)): the
    low is a clean UV ellipsoid (u segments, v rings) instead of the decimated SDF mesh (round parts stay round)."""
    out.append({"name": name, "S": S, "role": role, "bind": bind, "tris": tris, "vs": vs, "paint": paint,
                "uv": uv, "tint": tint, "light": light, "detail": detail, "grad": grad, "cav": cav, "prim": prim,
                "hang": hang, "sym": sym})


def make_low(p, ob, col):
    """The game mesh of a part: a clean primitive (p["prim"]) or the SDF mesh decimated to p["tris"]. The
    decimation is X-symmetric first; when it stalls (surface nets leave a few non-manifold edges where a thin
    tube crosses a cell ambiguously; the collapse stops there) the copy is welded (0.4 mm) and triangulated,
    then decimated again without symmetry."""
    if p.get("prim") and p["prim"][0] == "mesh":
        V, F = p["prim"][1], p["prim"][2]
        me_ = bpy.data.meshes.new(f"{p['name']}_low")
        me_.from_pydata([tuple(v) for v in V], [], [tuple(f) for f in F])
        bm = bmesh.new()
        bm.from_mesh(me_)
        bmesh.ops.triangulate(bm, faces=bm.faces)
        bm.to_mesh(me_)
        bm.free()
        low = bpy.data.objects.new(f"{p['name']}_low", me_)
        col.objects.link(low)
        for f in me_.polygons:
            f.use_smooth = True
        for m_ in ob.data.materials:
            me_.materials.append(m_)
        return low
    if p.get("prim"):
        kind, c, radii, axes, (nu, nv) = p["prim"]
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=nu, v_segments=nv, radius=1.0)
        ax = np.eye(3) if axes is None else np.asarray(axes, dtype=np.float64)
        for v_ in bm.verts:
            u = np.array(v_.co) * np.asarray(radii, dtype=np.float64)
            v_.co = Vector(tuple(np.asarray(c, dtype=np.float64) + u @ ax))
        bmesh.ops.triangulate(bm, faces=bm.faces)
        me_ = bpy.data.meshes.new(f"{p['name']}_low")
        bm.to_mesh(me_)
        bm.free()
        low = bpy.data.objects.new(f"{p['name']}_low", me_)
        col.objects.link(low)
        for f in me_.polygons:
            f.use_smooth = True
        for m_ in ob.data.materials:
            me_.materials.append(m_)
        return low
    low = mesh.duplicate(ob, f"{p['name']}_low", col)
    n = mesh.decimate_to(low, p["tris"], symmetric=p.get("sym", True))
    if n > 1.04 * p["tris"]:
        me_ = low.data
        bpy.data.objects.remove(low, do_unlink=True)
        bpy.data.meshes.remove(me_)
        low = mesh.duplicate(ob, f"{p['name']}_low", col)
        bm = bmesh.new()
        bm.from_mesh(low.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0004)
        bmesh.ops.triangulate(bm, faces=bm.faces)
        bm.to_mesh(low.data)
        bm.free()
        mesh.decimate_to(low, p["tris"], symmetric=False)
    return low


CLOAK_BIND = ("glim_cloak",)
INFO = {}                       # per faction: the opening, the pocket, the hood marks (read by the paint finish)


ARMS = (("R", (SH_R, EL_R, WR_R)), ("L", (J["shoulder.L"], J["elbow.L"], J["wrist.L"])))
CUFF_BACK = 0.022                  # the sleeve ends this far before the wrist, cut flat (an open cuff, inked inside)


def _sleeves(out, role, cuff_r, wraps, tint=None):
    s = Sculpt("sleeves")
    for side, (sh, el, wr) in ARMS:
        s.add(RoundCone(sh, el, 0.054, 0.047), k=0.0)
        ax = unit(wr - el)
        cuff = wr - ax * CUFF_BACK
        s.add(RoundCone(el, cuff + ax * 0.02, 0.047, cuff_r), k=0.025)
        if wraps:
            for i in range(3):
                c = el + (cuff - el) * (0.30 + 0.22 * i)
                s.add(Torus(c, 0.045, 0.009, axes=sdf.frame(ax)), k=0.006)
        # the open end: cut flat at the cuff plane (a big sphere beyond it), so no rounded sleeve stump shows
        # round the mitt (it read as a pale lump inside a dark hoop)
        s.sub(Sphere(cuff + ax * 0.40, 0.40), k=0.010)
    part(out, "sleeves", s, role, "auto", 196, vs=0.85, uv=0.9, tint=tint, grad=(0.40, 0.60, 0.18), hang=0.6)


def _mitts(out, role):
    # right: a mitten fist wrapped round the pole at the grip (knuckle roll over the front, thumb over the
    # top), its wrist drum running up into the sleeve's open cuff
    r = Sculpt("mitt_R")
    fa = unit(WR_R - EL_R)
    gc = GRIP + np.array([0.006, 0.002, 0.0])
    fr = sdf.frame(POLE_AX, (1.0, 0.0, 0.0))
    r.add(RoundBox(gc, (0.036, 0.034, 0.040), 0.030, axes=fr), k=0.0)
    r.add(Capsule(gc + fr[0] * 0.030 - fr[1] * 0.030 - fr[2] * 0.010, gc - fr[0] * 0.026 - fr[1] * 0.034 - fr[2] * 0.008,
                  0.018), k=0.012)                                                    # the knuckle roll
    r.add(Capsule(gc + fr[0] * 0.024 - fr[1] * 0.020 + fr[2] * 0.036, gc - fr[0] * 0.006 - fr[1] * 0.034 + fr[2] * 0.042,
                  0.0145), k=0.010)                                                   # the thumb
    r.add(RoundCone(WR_R - fa * (CUFF_BACK + 0.02), gc - fa * 0.012, 0.040, 0.036), k=0.016)   # the wrist drum
    part(out, "mitt_R", r, role, "bone:hand.R", 86, vs=0.5, detail=0.3, cav=0.2)
    # left: the open casting hand. The palm turns to the front and tips its fingers forward (open, presenting),
    # the fingers cupped a little, the thumb a separate lobe standing out from the palm
    l = Sculpt("mitt_L")
    w = J["wrist.L"]
    d2 = unit(J["forearm_dir.L"])
    fwd = np.array([0.0, -1.0, 0.0])
    f_ax = unit(d2 + fwd * 0.55)                                      # the fingers: down-out, tipped forward
    v = np.array([0.0, -0.75, 0.66])
    pn = unit(v - f_ax * np.dot(v, f_ax))                            # the palm faces forward-up (the camera)
    side = unit(np.cross(pn, f_ax))
    if side[0] < 0:
        side = -side                                                  # across the palm, toward the thumb (out)
    cp = w + f_ax * 0.046
    l.add(RoundBox(cp, (0.038, 0.012, 0.032), 0.013, axes=np.stack([side, pn, f_ax])), k=0.0)        # palm
    f2 = unit(f_ax * math.cos(math.radians(22)) + pn * math.sin(math.radians(22)))                 # cupped
    p2 = unit(np.cross(f2, side))
    l.add(RoundBox(cp + f_ax * 0.044 + pn * 0.006 - side * 0.004, (0.034, 0.011, 0.022), 0.012,
                   axes=np.stack([side, p2 if p2 @ pn > 0 else -p2, f2])), k=0.012)                  # fingers
    l.add(Capsule(cp + side * 0.030 - f_ax * 0.014, cp + side * 0.056 + f_ax * 0.016 + pn * 0.016, 0.0135),
          k=0.006)                                                                                     # thumb
    l.add(RoundCone(w - d2 * (CUFF_BACK + 0.02), cp - f_ax * 0.026, 0.038, 0.032), k=0.014)        # wrist drum
    part(out, "mitt_L", l, role, "bone:hand.L", 90, vs=0.5, detail=0.3, cav=0.2)


def _legs(out, felt):
    tr = Sculpt("trousers")
    for s in ("L", "R"):
        a, k = J[f"ankle.{s}"], J[f"knee.{s}"]
        tr.add(RoundCone((a[0], a[1] + 0.005, 0.07), (k[0], k[1], k[2] + 0.02), 0.040, 0.046), k=0.0)
    part(out, "trousers", tr, "under", "auto", 24, vs=1.2, uv=0.5, detail=0.0, cav=0.0)
    for s in ("L", "R"):
        a = J[f"ankle.{s}"]
        b = Sculpt(f"boot_{s}")
        if felt:
            b.add(Ellipsoid((a[0], a[1] - 0.026, 0.045), (0.056, 0.084, 0.052)), k=0.0)
            b.add(Capsule((a[0], a[1], 0.05), (a[0], a[1] + 0.004, 0.105), 0.047), k=0.03)
        else:
            b.add(RoundBox((a[0], a[1] - 0.028, 0.040), (0.050, 0.086, 0.040), 0.032), k=0.0)
            b.add(Capsule((a[0], a[1], 0.05), (a[0], a[1] + 0.004, 0.112), 0.046), k=0.025)
            for i in range(2):
                b.add(Torus((a[0], a[1] + 0.002, 0.07 + 0.026 * i), 0.046, 0.006), k=0.004)
        b.inter(HalfSpace((0, 0, 0.0), (0, 0, -1), 1.0), k=0.004)
        part(out, f"boot_{s}", b, "leather", f"bone:foot.{s}", 66, vs=0.8, uv=0.7, detail=0.0, cav=0.2)


def tube_part(out, name, pts, radii, role, bind, nsides=6, caps=(True, True), uv=0.3, paint="proc", tint=None,
              k=0.0, **kw):
    """A clean tube prop: the low is tube_mesh (straight, even), the high the same tube as an SDF (for the bake)."""
    pts = np.asarray(pts, dtype=np.float64)
    radii = np.broadcast_to(np.asarray(radii, dtype=np.float64), (len(pts),))
    S = Sculpt(name)
    S.add(Tube([tuple(p) for p in pts], [float(r) for r in radii], k=k), k=0.0)
    V, F = tube_mesh(pts, radii, nsides, caps)
    part(out, name, S, role, bind, len(F), vs=0.4, paint=paint, uv=uv, tint=tint, prim=("mesh", V, F), **kw)


def _pole(out, wood, r0=0.0225, r1=0.0195, top=1.26, uv=0.30):
    """the pole: a clean 6-sided tapering tube (the 4.5 cm pole is 3.7 px at 1080p; its UV share was 12-15 % of the
    atlas, now ~4 %)"""
    s = np.array([0.0, 0.45, 0.9, top])
    pts = POLE_FOOT[None, :] + POLE_AX[None, :] * s[:, None]
    tube_part(out, "pole", pts, r0 + (r1 - r0) * s / top, wood, "bone:prop.R", nsides=6, uv=uv)


# ── AUBADE: rounded cowl, carved chalk arch rim, round knob, accent seam; straight folds, pointed hem ─────────
A_HOOD_OUT = [(0.0, 0.955), (0.062, 0.948), (0.106, 0.928), (0.139, 0.898), (0.160, 0.862), (0.172, 0.818),
              (0.177, 0.768), (0.179, 0.718), (0.177, 0.676), (0.168, 0.645), (0.146, 0.628), (0.08, 0.622), (0.0, 0.62)]
# the concept's BELL arch (review 2026-10-27 item 1): a narrow round top flaring to a wide foot (the old 18 x 21 cm
# near-round opening in a uniform ring foreshortened to an eye at the 52 deg camera)
A_ARCH = dict(O=(0.0, -0.166, 0.765), tilt=12.0, hw_top=0.072, hw_bot=0.097, y_bot=-0.104, y_top=0.106, corner=0.034)
A_RIM_W = 0.034                              # the carved chalk rim (brief 3-4 cm)
A_SEAM_C = np.array([0.0, 0.02, 0.775])     # the seam runs round this point in the YZ plane (0 = forward, 90 = up)
A_SEAM_A = (36.0, 205.0)                     # from under the rim's top, over the crown, down the back to the nape
A_SEAM_HW = 0.0210                           # 4.2 cm wide (3.2 cm was a hairline at 1080p)
# the concept's two side panel seams: meridians at +-A_SIDE_PHI deg from the front, from beside the knob down the
# hood's flanks to its lower edge (well outside the rim: they frame the hood, never ring the opening)
A_SIDE_C = np.array([0.0, 0.02, 0.715])
A_SIDE_PHI = 82.0
A_SIDE_T = (-6.0, 70.0)                      # elevation round A_SIDE_C
A_SIDE_HW = 0.0150
A_CLOAK_OUT = [(0.0, 0.662), (0.07, 0.657), (0.115, 0.642), (0.146, 0.616), (0.161, 0.585), (0.167, 0.55),
               (0.172, 0.48), (0.182, 0.40), (0.196, 0.32), (0.212, 0.24), (0.228, 0.17), (0.238, 0.115),
               (0.242, 0.085), (0.24, 0.07), (0.0, 0.068)]
A_CLOAK_SY = 0.88
A_FOLD_AMP = lambda z: 0.003 + 0.010 * smooth(0.56, 0.16, z)       # noqa: E731
_A_FOLDS0 = vfolds(A_FOLD_AMP, 8, 0.7, soft=0.7)


def A_FOLDS(P):
    """the cloak's straight folds, smoothed away under the stole strips and the front parting (the stole lies
    flat on a smooth front; folds crossing it cut its edges into white shards)"""
    front = smooth(-0.02, -0.08, P[:, 1]) * smooth(0.10, 0.17, P[:, 2])
    flat = smooth(0.125, 0.105, np.abs(P[:, 0])) * front
    return _A_FOLDS0(P) * (1.0 - flat)


def a_hem_z(P):
    """the Aubade hem's cut (z of the hem at each angle: nine shallow points)"""
    ang = np.arctan2(P[:, 0], -P[:, 1])
    s = (ang * 9 / (2 * math.pi) + 0.5) % 1.0
    return 0.137 - 0.036 * (1.0 - np.abs(2.0 * s - 1.0))


def a_seam_angle(P):
    """degrees round A_SEAM_C in the YZ plane: 0 forward, 90 up, 180 back, > 180 down the back (unwrapped)"""
    a = np.degrees(np.arctan2(P[:, 2] - A_SEAM_C[2], -(P[:, 1] - A_SEAM_C[1])))
    return np.where(a < -60.0, a + 360.0, a)


def a_seam_hw(P):
    """the seam's half width: full from the brow over the crown down the back of the hood to the nape, a round
    end there (a taper to a point read as a slit / a blue dagger)"""
    x = np.clip((A_SEAM_A[1] - a_seam_angle(P)) / 7.0, 0.0, 1.0)
    return A_SEAM_HW * np.sqrt(np.maximum(0.0, 1.0 - (1.0 - x) ** 2)) ** 0.8


def a_hood_fold(P):
    """the hood's back: one broad soft drape sagging toward the nape (no lines: the concept's V fold + the seam +
    a nape notch read as an angry face from behind, review 2026-10-27 item 5)"""
    y, z, x = P[:, 1], P[:, 2], np.abs(P[:, 0])
    back = smooth(0.06, 0.14, y)
    return 0.004 * back * np.exp(-((z - 0.735) / 0.05) ** 2) * smooth(0.13, 0.04, x)


def a_side_frame(sgn):
    """(the meridian plane's normal, the seam's outward direction at zero elevation) of a side seam"""
    ph = math.radians(A_SIDE_PHI) * sgn
    d = np.array([math.sin(ph), -math.cos(ph), 0.0])
    n = np.array([math.cos(ph), math.sin(ph), 0.0])
    return n, d


def a_side_elev(P, d):
    q = P - A_SIDE_C
    return np.degrees(np.arctan2(q[:, 2], q @ d))


def a_side_hw(P, d):
    """the side seam's half width: round ends at both ends"""
    t = a_side_elev(P, d)
    x = np.clip(np.minimum(t - A_SIDE_T[0], A_SIDE_T[1] - t) / 6.0, 0.0, 1.0)
    return A_SIDE_HW * np.sqrt(np.maximum(0.0, 1.0 - (1.0 - x) ** 2)) ** 0.8


def a_slit(P):
    """the front parting: a clean inverted V between the stole tips, 9 cm wide at the hem"""
    w = 0.046 * np.clip((0.235 - P[:, 2]) / 0.13, 0.0, 1.2)
    return np.maximum(np.maximum(np.abs(P[:, 0]) - w, P[:, 2] - 0.235), P[:, 1] + 0.06)


# the two chalk stoles down the front (5.4 cm, pointed ends). They are PART OF THE CLOAK MESH (one SDF union,
# painted chalk by their footprint): as separate shells the cloak pushed through them under the run's skirt
# flare (linear skinning of two meshes sampled at different points) and tore them into shards
A_STOLE_X, A_STOLE_HW = 0.068, 0.027
STOLE_CFG = {"paint": "proj", "role": "chalk", "tint": "#D3D0C6", "light": 0.30, "detail": 0.25,
             "grad": (0.2, 0.62, 0.16), "cav": 0.14, "hang": 0.8}


def a_stole_tip(dx):
    return 0.212 + 0.034 * np.asarray(dx) / A_STOLE_HW


def a_stole_strip(P, xc):
    dx = np.abs(P[:, 0] - xc)
    return np.maximum(np.maximum(dx - A_STOLE_HW, a_stole_tip(dx) - P[:, 2]), P[:, 1] + 0.03)


def a_stole_out(P):
    """metres outside the stoles' footprint (front view outline; < 0 inside)"""
    dx = np.min(np.abs(P[:, 0:1] - np.array([[-A_STOLE_X, A_STOLE_X]])), axis=1)
    e = np.maximum(dx - A_STOLE_HW, a_stole_tip(np.minimum(dx, A_STOLE_HW)) - P[:, 2])
    return np.where((P[:, 1] < -0.03) & (P[:, 2] < 0.66), e, 1.0)


def _ray_exit(base, Q, d, back=0.14, tmax=0.30, steps=300):
    """the outermost point where the ray Q - d*back + t d (t up to tmax) leaves the SDF `base`, with its normal"""
    d = unit(d)
    o = np.asarray(Q, dtype=np.float64) - d * back
    ts = np.linspace(tmax, 0.0, steps)
    dv = base.d(o[None, :] + ts[:, None] * d[None, :])
    hit = np.nonzero(dv < 0)[0]
    if not len(hit):
        return np.asarray(Q, dtype=np.float64), d
    i = hit[0]
    lo, hi = ts[i], ts[max(0, i - 1)]
    for _ in range(30):
        mid = 0.5 * (lo + hi)
        if base.d((o + d * mid)[None, :])[0] < 0:
            lo = mid
        else:
            hi = mid
    P = o + d * 0.5 * (lo + hi)
    e = 4e-4
    g = np.array([base.d((P + np.eye(3)[k] * e)[None, :])[0] - base.d((P - np.eye(3)[k] * e)[None, :])[0] for k in range(3)])
    return P, unit(g)


def arch_stations(A: Arch, n):
    """n points evenly spaced (by arc length) round the arch outline from the top centre, with 2D outward normals"""
    poly = arch_poly(A.hw_top, A.hw_bot, A.y_bot, A.y_top, 0.0 + max(1e-3, getattr(A, "corner", 0.03)))
    seg = np.linalg.norm(np.roll(poly, -1, axis=0) - poly, axis=1)
    cum = np.concatenate([[0.0], np.cumsum(seg)])
    L = cum[-1]
    i_top = int(np.argmax(poly[:, 1]))
    s0 = cum[i_top]
    pts, nrm = [], []
    cen = np.array([0.0, A.yc])
    for k in range(n):
        t = (s0 + L * k / n) % L
        j = int(np.searchsorted(cum, t, side="right") - 1)
        j = min(j, len(poly) - 1)
        f = (t - cum[j]) / max(seg[j], 1e-9)
        a_, b_ = poly[j], poly[(j + 1) % len(poly)]
        pts.append(a_ + (b_ - a_) * f)
    pts = np.array(pts)
    for k in range(n):
        tg = pts[(k + 1) % n] - pts[k - 1]
        nn = unit(np.array([tg[1], -tg[0], 0.0]))[:2]
        if np.dot(nn, pts[k] - cen) < 0:
            nn = -nn
        nrm.append(nn)
    return pts, np.array(nrm)


def rim_mesh(base, A: Arch, width, n=36, height=0.016):
    """THE CARVED CHALK RIM as a clean mesh lying on the cowl round the opening: an inner wall turning into the
    hollow, a chamfer, a flat carved face `height` proud, an outer chamfer sinking into the cloth (crisp stone
    edges; the decimated SDF frame went soft and puffy: "a padded parka ring", review 2026-10-27 item 4)"""
    pts, nrm = arch_stations(A, n)
    rows = ((-0.001, None), (0.0015, 0.75), (0.006, 1.0), (width - 0.006, 1.0), (width - 0.0015, 0.70), (width + 0.001, -0.25))
    G = np.zeros((n, len(rows), 3))
    for k in range(n):
        for j, (g, h) in enumerate(rows):
            q = pts[k] + nrm[k] * g
            Q = A.O + q[0] * A.F[0] + q[1] * A.F[1]
            S, Ns = _ray_exit(base, Q, A.F[2])
            G[k, j] = S - A.F[2] * 0.016 if h is None else S + Ns * height * h
    # every band (inner wall, chamfer, face, chamfer, fall) gets its OWN vertices: the creases between them stay
    # hard under smooth shading (shared vertices averaged them into a puffy tube)
    V, F, band_of = [], [], []
    nr = len(rows)
    for r in range(nr - 1):
        b0 = len(V)
        for k in range(n):
            V += [G[k, r], G[k, r + 1]]
        for k in range(n):
            k2 = (k + 1) % n
            a, b, c, d = b0 + 2 * k, b0 + 2 * k + 1, b0 + 2 * k2 + 1, b0 + 2 * k2
            F += [(a, b, c), (a, c, d)]
            band_of += [r, r]
    V = np.array(V)
    cen = A.O + A.F[1] * A.yc

    def out_dir(i, c_):
        # the faces look out of the hood surface: away from the hood's centre, and the inner wall into the hollow
        if band_of[i] == 0:
            v = c_ - cen
            return -(v - A.F[2] * np.dot(v, A.F[2]))
        return c_ - np.array([0.0, 0.02, 0.76])
    return V, _orient(V, F, out_dir)


def aubade_parts() -> list:
    out = []
    A = Arch(**A_ARCH)
    A.corner = A_ARCH["corner"]
    pocket = ArchPocket(A, depth=0.17, front=0.1, taper=0.3, k=0.035)
    # HOOD: a soft rounded cowl (round as a helmet on top), swept back at the nape, the concept's tall bell-arched
    # opening; blue-grey linen (the concept's hood, not the old pale "white hood")
    hood = Sculpt("hood")
    lat, cur = solid_lathe((0.0, 0.02, 0.0), A_HOOD_OUT, sy=1.08)
    hood.add(lat.displaced(a_hood_fold, 0.006), k=0.0)
    hood.add(Ellipsoid((0.0, 0.118, 0.668), (0.128, 0.105, 0.068)), k=0.05)          # the nape drape
    hood.add(Ellipsoid((0.0, -0.118, 0.668), (0.135, 0.075, 0.052)), k=0.045)        # the chin of the cowl
    base = sdf.Blend([(o_, p_, k_) for o_, p_, k_, _ in hood.ops])                    # uncarved: rim + seam hug it
    hood.sub(pocket, k=0.012)
    part(out, "hood", hood, "cloth2", "bone:head", 520, vs=0.8, uv=1.9, tint="#6C7279", light=0.30, detail=0.6,
         grad=(0.66, 0.95, 0.10), cav=0.16)
    # the carved chalk rim: 3.4 cm, 1.6 cm proud, crisp chamfered edges (a clean mesh on the cowl; the block joints
    # and scroll relief are painted)
    rim = Sculpt("hood_rim")
    rim.add(arch_frame(base, A, A_RIM_W, 0.016, sink=0.010, behind=0.06), k=0.0)
    rim.sub(pocket, k=0.004)
    rv, rf = rim_mesh(base, A, A_RIM_W, n=32)
    part(out, "hood_rim", rim, "chalk", "bone:head", len(rf), vs=0.45, uv=1.3, tint="#CBC7BC", detail=0.5, light=0.24,
         cav=0.0, prim=("mesh", rv, rf))
    # the knob: a round chalk ball on a short neck (concept; rule 0.1: round, never a point), top at 1.00 m
    knob = Sculpt("knob")
    knob.add(Sphere((0.0, 0.02, 0.975), 0.0255), k=0.0)
    part(out, "knob", knob, "chalk", "bone:head", 80, vs=0.32, paint="proc", uv=0.4,
         prim=("ellipsoid", (0.0, 0.02, 0.975), (0.0255, 0.0255, 0.0255), None, (10, 5)))
    # THE HOOD MARK (accent): the centre seam from under the rim's top over the crown down the back to a round end,
    # and the concept's two side panel seams down the flanks; ribbons lying ON the cowl
    seam = Sculpt("seam")
    seam.add(Sphere(A_SEAM_C + (0.0, 0.0, 0.17), 0.01), k=0.0)                 # stand-in high (accent: never baked)
    angs = np.radians(np.concatenate([np.linspace(A_SEAM_A[0], A_SEAM_A[1] - 9.0, 22),
                                      A_SEAM_A[1] - np.array([6.0, 3.0, 0.0])]))   # the round end
    sp, sn = surface_path(base, A_SEAM_C, np.stack([np.zeros_like(angs), -np.cos(angs), np.sin(angs)], axis=1))
    V, F = ribbon(sp, sn, a_seam_hw(sp))
    for sgn in (-1.0, 1.0):
        nrm_, d_ = a_side_frame(sgn)
        t = np.radians(np.concatenate([[A_SIDE_T[0], A_SIDE_T[0] + 3.0],
                                       np.linspace(A_SIDE_T[0] + 6.0, A_SIDE_T[1] - 6.0, 11),
                                       A_SIDE_T[1] - np.array([3.0, 0.0])]))
        dirs = np.cos(t)[:, None] * d_[None, :] + np.sin(t)[:, None] * np.array([0.0, 0.0, 1.0])[None, :]
        pp, pn = surface_path(base, A_SIDE_C, dirs)
        V2, F2 = ribbon(pp, pn, a_side_hw(pp, d_))
        F += [tuple(int(i) + len(V) for i in f) for f in F2]
        V = np.vstack([V, V2])
    part(out, "seam", seam, "accent", "bone:head", len(F), vs=0.5, paint="accent", prim=("mesh", V, F))
    # THE HOOD LIGHT (fix round 4): one soft core centred in the opening, set back 3.5 cm, and its halo
    light = HoodCore(A, pocket)
    light.add(out)
    # CLOAK: a bell from the shoulders, long straight folds, a hem cut into shallow points, a front slit
    cloak = Sculpt("cloak")
    clat, ccur = solid_lathe((0.0, 0.0, 0.0), A_CLOAK_OUT, sy=A_CLOAK_SY)
    Rc = radius_fn(ccur[: np.argmax(ccur[:, 1] < 0.075)])
    cloak.add(clat.displaced(A_FOLDS, 0.014), k=0.0)
    cloak.inter(Fn(lambda P: a_hem_z(P) - P[:, 2], (-0.3, -0.3, 0.0), (0.3, 0.3, 0.7)), k=0.005)
    cloak.sub(Fn(a_slit, (-0.08, -0.3, 0.0), (0.08, -0.04, 0.25)), k=0.006)
    # the chalk stoles: 7.5 mm proud of the smooth front, unioned INTO the cloak (one surface, one skin)
    for xc in (-A_STOLE_X, A_STOLE_X):
        cloak.add(shell((0.0, 0.0), Rc, 0.17, 0.645, 0.0075, 0.006, sy=A_CLOAK_SY,
                        extra=lambda P, xc=xc: a_stole_strip(P, xc)), k=0.0)
    part(out, "cloak", cloak, "cloth", CLOAK_BIND, 720, vs=1.0, uv=1.35, tint="#4A525C", light=0.26, detail=0.75,
         grad=(0.15, 0.62, 0.22), cav=0.16, hang=1.0)
    _sleeves(out, "cloth", 0.056, wraps=True, tint="#4F5761")
    _mitts(out, "cloth")
    _legs(out, felt=False)
    # PROPS: pale ash pole, chalk spire finial, angled chalk crook, hexagonal dawn lantern
    _pole(out, "wood", top=1.215)
    kc = POLE_FOOT + POLE_AX * 1.225
    fprof = [(0.0205, -0.040), (0.0215, -0.028), (0.031, -0.006), (0.031, 0.004), (0.017, 0.030), (0.0135, 0.036),
             (0.0155, 0.042), (0.0, POLE_TIP @ POLE_AX - kc @ POLE_AX)]
    fin = Sculpt("finial")
    fin.add(lathe_sdf(kc, POLE_AX, fprof), k=0.0)
    fv, ff = lathe_mesh(kc, POLE_AX, fprof, nsides=6)
    part(out, "finial", fin, "chalk", "bone:prop.R", len(ff), vs=0.4, paint="proc", uv=0.35, prim=("mesh", fv, ff))
    # the crook: one clean chalk arm rising out of the finial collar to the hook, an upturned tip, and a slim brace
    cdir = unit(np.array([HOOK[0] - CROOK_BASE[0], HOOK[1] - CROOK_BASE[1], 0.0]))
    up = np.array([0.0, 0.0, 1.0])
    path = np.array([CROOK_BASE - cdir * 0.006, CROOK_BASE + cdir * 0.055 + up * 0.022,
                     CROOK_BASE + cdir * 0.115 + up * 0.036, HOOK - cdir * 0.002, HOOK + cdir * 0.026 + up * 0.012,
                     HOOK + cdir * 0.040 + up * 0.030])
    tube_part(out, "crook", path, [0.0160, 0.0155, 0.0148, 0.0140, 0.0130, 0.0115], "chalk", "bone:prop.R",
              nsides=6, caps=(False, True), uv=0.35)
    bpath = np.array([POLE_FOOT + POLE_AX * 1.10, CROOK_BASE + cdir * 0.085 + up * 0.028])
    tube_part(out, "brace", bpath, [0.0095, 0.0085], "chalk", "bone:prop.R", nsides=5, caps=(False, False), uv=0.15)
    _aubade_lamp(out)
    INFO["aubade"] = {"arch": A, "pocket": pocket, "rim_w": A_RIM_W, "light": light, "spill": "#7F8FA3",
                      "spill_k": 0.55, "fold": (A_FOLDS, A_FOLD_AMP), "slit": a_slit}
    return out


def _aubade_lamp(out):
    """The narrow six-sided dawnglass lantern (the caster's read, the biggest light; review 2026-10-27 item 3: a
    culture lamp, not a flat team-colour box): an accent CORE (a hexagonal sleeve) seen through six dawnglass
    panes, each pane a glossy pale-blue glass border (bevelled top and foot bands, slim side edges) round the lit
    window; slim chalk corner posts, chalk top / foot plates, the pointed hexagonal chalk roof with a ball, a
    chalk drop; a short stone cord to the crook."""
    c = LAMP_C
    ap, hh = 0.062, 0.072
    R = ap / 0.866
    # the core: a hexagonal sleeve (corners at 0 + 60 k deg), the panes' lit windows
    V, F = [], []
    for zr in (-1.0, 1.0):
        for k in range(6):
            a = math.radians(60.0 * k)
            V.append(c + np.array([math.cos(a) * R, math.sin(a) * R, hh * zr]))
    for k in range(6):
        a_, b_ = k, (k + 1) % 6
        F += [(a_, b_, b_ + 6), (a_, b_ + 6, a_ + 6)]
    V = np.array(V)
    F = _orient(V, F, lambda i, cen: cen - c)
    core = Sculpt("lamp_core")
    core.add(Sphere(c, 0.01), k=0.0)                      # stand-in high (the accent is never baked)
    part(out, "lamp_core", core, "accent", "bone:x_lamp_1", len(F), vs=1.0, paint="accent", prim=("mesh", V, F))
    # the dawnglass: per pane a border ring 2.5 mm proud of the core (top / foot bands 1.5 cm, sides 5 mm)
    GV, GF = [], []
    for k in range(6):
        a0, a1 = math.radians(60.0 * k), math.radians(60.0 * (k + 1))
        p0 = c + np.array([math.cos(a0) * R, math.sin(a0) * R, 0.0])
        p1 = c + np.array([math.cos(a1) * R, math.sin(a1) * R, 0.0])
        mid = 0.5 * (p0 + p1)
        nrm = unit(mid - c)
        tg = unit(p1 - p0)
        half = 0.5 * np.linalg.norm(p1 - p0)
        out_ = nrm * 0.0025
        rows = []
        for (sx, sz) in ((1.0, 1.0), (1.0 - 0.0055 / half, 1.0 - 0.015 / hh)):
            ring = []
            for (ux, uz) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                ring.append(mid + out_ + tg * half * ux * sx + np.array([0.0, 0.0, hh * uz * sz]) + (nrm * 0.0015 if sx < 1 else 0))
            rows.append(ring)
        base_i = len(GV)
        GV += rows[0] + rows[1]
        for j in range(4):
            a_, b_ = base_i + j, base_i + (j + 1) % 4
            GF += [(a_, b_, b_ + 4), (a_, b_ + 4, a_ + 4)]
    GV = np.array(GV)
    GF = _orient(GV, GF, lambda i, cen: cen - np.array([c[0], c[1], cen[2]]))
    glass = Sculpt("lamp_glass")
    glass.add(HexPrism(c, ap + 0.002, hh, 0.001), k=0.0)
    glass.sub(HexPrism(c, ap - 0.004, hh - 0.015, 0.001), k=0.0)
    # (fix round 4) a deeper smoked dawnglass round the core: the pale blue pane borders sat on the ally azure's hue and
    # value (the lamp is the caster's biggest accent; its surround set the weak west-viewer read)
    part(out, "lamp_glass", glass, "dawnglass", "bone:x_lamp_1", len(GF), vs=0.3, paint="proj", uv=0.30,
         tint="#56677A", light=0.20, detail=0.0, cav=0.0, prim=("mesh", GV, GF))
    # slim chalk corner posts (4-sided, crisp) at the hexagon's corners
    PV, PF = [], []
    for k in range(6):
        a = math.radians(60.0 * k)
        p = c + np.array([math.cos(a) * (R + 0.0015), math.sin(a) * (R + 0.0015), 0.0])
        v, f = tube_mesh([p - (0, 0, hh + 0.002), p + (0, 0, hh + 0.002)], 0.0062, nsides=4, caps=(False, False),
                         phase=math.radians(45.0))
        PF += [tuple(int(i) + len(PV) for i in f_) for f_ in f]
        PV += list(v)
    posts = Sculpt("lamp_posts")
    for k in range(6):
        a = math.radians(60.0 * k)
        p = c + np.array([math.cos(a) * R, math.sin(a) * R, 0.0])
        posts.add(Capsule(p - (0, 0, hh), p + (0, 0, hh), 0.006), k=0.0)
    part(out, "lamp_posts", posts, "chalk", "bone:x_lamp_1", len(PF), vs=0.35, paint="proc", uv=0.25,
         prim=("mesh", np.array(PV), PF))
    caps = Sculpt("lamp_caps")
    caps.add(HexPrism(c + (0, 0, hh + 0.006), ap + 0.010, 0.0065, 0.0025), k=0.0)            # the top plate
    caps.add(hex_roof(c + (0, 0, hh + 0.011), ap + 0.013, 0.046), k=0.003)                # the pointed roof
    caps.add(Sphere(c + (0, 0, hh + 0.060), 0.0095), k=0.004)                              # the apex ball
    caps.add(HexPrism(c + (0, 0, -hh - 0.006), ap + 0.008, 0.0065, 0.0025), k=0.0)           # the foot plate
    caps.add(RoundCone(c + (0, 0, -hh - 0.012), c + (0, 0, -hh - 0.046), 0.028, 0.003), k=0.004)   # the drop
    part(out, "lamp_caps", caps, "chalk", "bone:x_lamp_1", 116, vs=0.4, paint="proc", uv=0.5)
    top = c + (0, 0, hh + 0.068)
    tube_part(out, "cord", [HOOK - (0, 0, 0.004), top], 0.0042, "stone", "bone:x_lamp_1", nsides=4, uv=0.1)


# ── SERENADE: low broad felt dome, dark felt arch frame, rolled collar, tilted crown band; bell cloak ──────
S_DOME_OUT = [(0.0, 0.962), (0.062, 0.957), (0.103, 0.942), (0.133, 0.921), (0.154, 0.894), (0.168, 0.862),
              (0.177, 0.825), (0.180, 0.786), (0.177, 0.752), (0.165, 0.722), (0.148, 0.688), (0.128, 0.648),
              (0.098, 0.606), (0.0, 0.588)]  # carried down inside the collar roll: a thick hollow floor (no thin
                                             # slab under the pocket to shatter into blades when decimated)
# the concept's wide opening (24 x 21 cm, its top at 0.84 m) in a THICK dark felt roll (review 2026-10-27 item 4:
# the roll had thinned to a frame)
S_ARCH = dict(O=(0.0, -0.170, 0.738), tilt=8.0, hw_top=0.100, hw_bot=0.116, y_bot=-0.106, y_top=0.104, corner=0.034)
S_COLLAR_TILT = 14.0                   # the rolled collar dips at the front: its front is the sill across the opening
S_FRAME_W = 0.054                      # the thick dark felt roll framing the opening (concept)
S_BAND_HALF = 0.0200                   # the crown band: 4 cm, lying on the dome right on top of the felt roll
S_TRIM_HALF = 0.0110                   # the mantle band: 2.2 cm along the capelet's scalloped hem
S_CLOAK_OUT = [(0.0, 0.645), (0.09, 0.638), (0.135, 0.612), (0.160, 0.572), (0.172, 0.522), (0.185, 0.44),
               (0.205, 0.36), (0.228, 0.28), (0.248, 0.21), (0.263, 0.155), (0.271, 0.122), (0.270, 0.104),
               (0.259, 0.094), (0.0, 0.092)]
S_CLOAK_SY = 0.88
S_HEM_BANDS = ((0.204, 0.242), (0.100, 0.138))
S_FOLD_AMP = lambda z: 0.002 + 0.009 * smooth(0.5, 0.14, z)        # noqa: E731
_S_FOLDS0 = vfolds(S_FOLD_AMP, 6, 0.3, wobble=0.18, soft=0.6)


def S_FOLDS(P):
    """the bell's soft felt folds, plus the two dark hem bands as raised felt piping (4 mm, rounded): the
    band reads as an applied strip in the normal map, not a printed stripe"""
    z = P[:, 2]
    bump = np.zeros(len(P))
    for z0, z1 in S_HEM_BANDS:
        u = np.clip((z - z0) / (z1 - z0), 0.0, 1.0)
        bump = np.maximum(bump, np.sin(np.pi * u) ** 0.6 * ((z > z0) & (z < z1)))
    return _S_FOLDS0(P) - 0.004 * bump


S_CAPE_C, S_CAPE_SY = 0.012, 0.92
S_CAPE_OUT = [(0.0, 0.672), (0.105, 0.662), (0.152, 0.640), (0.190, 0.606), (0.219, 0.566), (0.238, 0.528),
              (0.249, 0.492), (0.254, 0.455), (0.255, 0.42), (0.0, 0.40)]


def s_cape_angle(P):
    return np.degrees(np.arctan2(P[:, 0], -(P[:, 1] - S_CAPE_C)))


def s_cape_edge(P):
    """z of the capelet's lower edge round the body: two big rounded lobes at the front, over the upper arms at
    the sides, a shallow U at the back; soft scallops (lobe centres at 30 / 90 / 150 deg)"""
    a = s_cape_angle(P)
    aa = np.abs(a)
    base = np.interp(aa, [0, 25, 45, 70, 90, 115, 150, 180], [0.470, 0.452, 0.462, 0.492, 0.500, 0.488, 0.468, 0.460])
    return base - 0.010 * 0.5 * (1.0 - np.cos(np.radians(6.0 * a)))         # smooth: no cusp / pinch between lobes


def s_cape_split(P):
    """the front split between the two lobes, rounded into the collar"""
    w = 0.012 + 0.05 * np.clip((0.60 - P[:, 2]) / 0.13, 0.0, 1.0) ** 1.5
    return np.maximum(np.abs(P[:, 0]) - w, P[:, 1] + 0.08)


def s_azimuth(P):
    """degrees round the dome's axis: 0 front (-Y), +90 the wick's left (+X)"""
    return np.degrees(np.arctan2(P[:, 0], -(P[:, 1] - 0.025)))


def s_band_table(base, roll, n=36, gap=0.003):
    """THE CROWN BAND'S PATH: for each azimuth, where the felt roll (the frame over the opening, the rolled collar
    round the back) meets the dome; the band's centre line lies on the dome just above that junction, so the band
    always sits ON the dark roll (the concept's lit lip over the opening, the dome / collar seam round the back),
    never on open sand like a headband (review 2026-10-27 item 4). Returns (azimuths deg, centre points, normals)."""
    C = np.array([0.0, 0.025, 0.70])
    phis = np.linspace(-180.0, 180.0, n, endpoint=False)
    th = np.radians(np.linspace(80.0, -25.0, 211))
    zs = []
    for ph in np.radians(phis):
        d = np.array([math.sin(ph), -math.cos(ph), 0.0])
        dirs = np.cos(th)[:, None] * d[None, :] + np.sin(th)[:, None] * np.array([0.0, 0.0, 1.0])[None, :]
        P, _ = surface_path_v(base, C, dirs)
        rd = roll.d(P)
        i = int(np.argmax(rd < 0.004))
        zs.append(P[i, 2])
    zs = np.array(zs)
    # smooth round the circle (the frame's corners would kink the band), keep it hugging the high front
    for _ in range(3):
        zs = np.maximum(zs, 0.25 * (np.roll(zs, 1) + 2 * zs + np.roll(zs, -1)) - 0.002)
        zs = 0.25 * (np.roll(zs, 1) + 2 * zs + np.roll(zs, -1))
    zc = zs + S_BAND_HALF + gap
    pts, nrm = [], []
    for ph, z in zip(np.radians(phis), zc):
        d = np.array([math.sin(ph), -math.cos(ph), 0.0])
        th2 = np.radians(np.linspace(80.0, -25.0, 421))
        dirs = np.cos(th2)[:, None] * d[None, :] + np.sin(th2)[:, None] * np.array([0.0, 0.0, 1.0])[None, :]
        P, N = surface_path_v(base, C, dirs)
        j = int(np.argmin(np.abs(P[:, 2] - z)))
        pts.append(P[j])
        nrm.append(N[j])
    return phis, np.array(pts), np.array(nrm)


def s_band_sd(P, tab):
    """signed height of P over the band's centre line (m, + above), from the band table"""
    phis, pts = tab
    a = s_azimuth(P)
    zc = np.interp(a, np.concatenate([phis - 360.0, phis, phis + 360.0]), np.tile(pts[:, 2], 3))
    return P[:, 2] - zc


def serenade_parts() -> list:
    out = []
    A = Arch(**S_ARCH)
    A.corner = S_ARCH["corner"]
    pocket = ArchPocket(A, depth=0.165, front=0.12, taper=0.3, k=0.035)
    # DOME: low and broad, wider than tall
    dome = Sculpt("dome")
    lat, cur = solid_lathe((0.0, 0.025, 0.0), S_DOME_OUT, sy=1.05)
    dome.add(lat, k=0.0)
    base = sdf.Blend([(o_, p_, k_) for o_, p_, k_, _ in dome.ops])
    dome.sub(pocket, k=0.012)
    part(out, "dome", dome, "cloth2", "bone:head", 380, vs=0.85, uv=1.7, tint="#978165", light=0.12, detail=0.6,
         grad=(0.70, 0.96, 0.03), cav=0.08)      # (r4: a softer top light: the crown read L* 70 in game, cap 65)
    # ROLLED COLLAR (lower at the front) + the THICK dark felt roll round the opening (concept: 5.4 cm, 4 cm proud,
    # round), one felt mesh; the roll's ends sink into the collar, whose front is the sill
    roll = Sculpt("roll")
    roll.add(Torus((0.0, 0.03, 0.660), 0.150, 0.060, axes=np.diag([1.0, 1 / 1.06, 1.0]) @ sdf.rot_x(-S_COLLAR_TILT), rz=0.055), k=0.0)
    roll.add(arch_frame(base, A, S_FRAME_W, 0.040, sink=0.016, behind=0.075, k=0.024, y_min=A.y_bot + 0.03), k=0.03)
    roll_d = sdf.Blend([(o_, p_, k_) for o_, p_, k_, _ in roll.ops])
    part(out, "roll", roll, "ironstone", "bone:head", 300, vs=0.8, uv=1.4, tint="#4A3C33", light=0.30, detail=0.6,
         cav=0.14)
    # THE CROWN BAND (accent): a 3 cm ribbon lying on the dome right on top of the felt roll all round (the lit lip
    # over the opening at the front, the dome / collar seam round the back)
    phis, bp, bn = s_band_table(base, roll_d)
    # the dome's LID EDGE: a felt welt 7 mm proud just above the band, so the band reads as light leaking from the
    # seam under the dome's edge onto the roll (like the lamp's lid), not a headband on a beanie
    tab = (phis, bp)

    def welt(P):
        d0 = base.d(P)
        sd = s_band_sd(P, tab) - (S_BAND_HALF + 0.0115)
        prof = 0.0045 * np.sqrt(np.clip(1.0 - (sd / 0.0095) ** 2, 0.0, 1.0))
        return np.maximum(d0 - prof, np.maximum(-d0 - 0.010, np.abs(sd) - 0.0095))
    dome.ops.insert(1, ("add", Fn(welt, (-0.24, -0.24, 0.66), (0.24, 0.26, 0.97)), 0.004, None))
    band = Sculpt("band")
    band.add(Sphere(bp.mean(axis=0) + (0.0, 0.0, 0.1), 0.01), k=0.0)     # stand-in high (accent: never baked)
    bv, bf = ribbon(bp, bn, S_BAND_HALF, closed=True, lift=(0.0042, 0.0072))
    part(out, "band", band, "accent", "bone:head", len(bf), vs=0.6, paint="accent", prim=("mesh", bv, bf))
    # THE HOOD LIGHT (fix round 4): one soft core centred between the collar roll (the sill) and the arch top
    light = HoodCore(A, pocket, front=0.030, rx=0.041, rz=0.025, solid=roll_d, h=0.45)
    light.add(out)
    # MANTLE: the concept's wide sand-felt capelet: a 1.6 cm felt layer over a bell that drapes over the shoulders
    # AND the upper arms (arm covers smooth-unioned in; their outer part follows the arms: _bind_mantle), the
    # lower edge in rounded scallops (two big lobes either side of the front split), a stitched turned edge
    mantle = Sculpt("mantle")
    mlat, _ = solid_lathe((0.0, S_CAPE_C, 0.0), S_CAPE_OUT, sy=S_CAPE_SY)
    caps_ = [Capsule(J["shoulder.L"] + (0.0, 0.0, 0.012), J["elbow.L"] + (0.006, 0.0, 0.02), 0.074),
             Capsule(J["shoulder.R"] + (0.0, 0.0, 0.012), EL_R + (-0.006, 0.0, 0.02), 0.074)]

    def cape(P):
        d = mlat.d(P)
        for c_ in caps_:
            d = sdf.smin(d, c_.d(P), 0.05)
        return np.maximum(d, -d - 0.016)                      # the felt layer under the draped surface
    mantle.add(Fn(cape, (-0.34, -0.31, 0.40), (0.34, 0.31, 0.68)), k=0.0)
    mantle.inter(Fn(lambda P: s_cape_edge(P) - P[:, 2], (-0.36, -0.36, 0.38), (0.36, 0.36, 0.70)), k=0.008)
    mantle.sub(Fn(s_cape_split, (-0.1, -0.33, 0.40), (0.1, -0.06, 0.68)), k=0.020)
    # THE MANTLE BAND (accent; the Serenade wicks' shared mantle mark: the side / back team read, which the crown
    # band alone left at 3.6-3.9 % of the silhouette): a 3 cm band along the capelet's scalloped hem, from the
    # front split round the back to the split, bound like the capelet (it follows the arm covers)
    def cape_out(P):
        d = mlat.d(P)
        for c_ in caps_:
            d = sdf.smin(d, c_.d(P), 0.05)
        return d
    co = Fn(cape_out, (-0.34, -0.31, 0.38), (0.34, 0.31, 0.70))
    tp, tn = [], []
    for a in np.linspace(23.0, 337.0, 30):
        ar = math.radians(a)
        d = np.array([math.sin(ar), -math.cos(ar), 0.0])
        ze = float(s_cape_edge((np.array([0.0, S_CAPE_C, 0.45]) + d * 0.2)[None, :])[0])
        P_, N_ = surface_path_v(co, np.array([0.0, S_CAPE_C, ze + S_TRIM_HALF + 0.0015]), [d])
        tp.append(P_[0])
        tn.append(N_[0])
    trim = Sculpt("mantle_band")
    trim.add(Sphere(np.array([0.0, 0.0, 0.5]), 0.01), k=0.0)            # stand-in high (accent: never baked)
    mv, mf = ribbon(np.array(tp), np.array(tn), S_TRIM_HALF, lift=(0.0040, 0.0075))
    part(out, "mantle_band", trim, "accent", ("glim_mantle",), len(mf), vs=0.6, paint="accent", prim=("mesh", mv, mf))
    part(out, "mantle", mantle, "cloth2", ("glim_mantle",), 250, vs=0.6, uv=1.3, tint="#9C8466", light=0.18,
         detail=0.6, grad=(0.47, 0.65, 0.12), cav=0.14, sym=False)      # (X-symmetric collapse creased the back)
    # CLOAK: a wide bell of warm umber felt (the concept's main value idea: light mantle over a dark cloak), soft
    # felt folds, the hem lifted so the boots show; the two ironstone hem bands are crisp paint
    cloak = Sculpt("cloak")
    clat, ccur = solid_lathe((0.0, 0.0, 0.0), S_CLOAK_OUT, sy=S_CLOAK_SY)
    cloak.add(clat.displaced(S_FOLDS, 0.015), k=0.0)
    part(out, "cloak", cloak, "cloth", CLOAK_BIND, 420, vs=1.1, uv=1.25, tint="#715444", light=0.26, detail=0.7,
         grad=(0.14, 0.60, 0.20), cav=0.16, hang=1.0)
    _sleeves(out, "cloth", 0.054, wraps=False, tint="#735645")
    _mitts(out, "leather")
    _legs(out, felt=True)
    # PROPS: a thicker walnut pole with two sand-felt bindings (it vanished on dark ground at 3-4 px), round
    # ironstone knob, level walnut crook with an iron ring, squat round lantern
    _pole(out, "wood_dark", r0=0.0262, r1=0.0236, top=1.27)
    for i, s_ in enumerate((0.70, 1.10)):
        a_ = POLE_FOOT + POLE_AX * s_
        tube_part(out, f"bind{i}", [a_, a_ + POLE_AX * 0.032], 0.0292, "sandstone", "bone:prop.R", nsides=8,
                  caps=(False, False), uv=0.12)
    kc = POLE_FOOT + POLE_AX * 1.252
    kprof = [(0.0262, -0.012), (0.030, 0.0), (0.021, 0.012), (0.032, 0.026), (0.0375, 0.045), (0.031, 0.065),
             (0.016, 0.078), (0.0, 0.082)]
    kn = Sculpt("knob")
    kn.add(lathe_sdf(kc, POLE_AX, kprof), k=0.0)
    kv, kf = lathe_mesh(kc, POLE_AX, kprof, nsides=7)
    part(out, "knob", kn, "ironstone", "bone:prop.R", len(kf), vs=0.4, paint="proc", uv=0.3, prim=("mesh", kv, kf))
    base_ = POLE_FOOT + POLE_AX * 1.215
    end = np.array([HOOK[0], HOOK[1], base_[2]])
    cdir = unit(end - base_)
    tube_part(out, "crook", [base_ - cdir * 0.01, base_ + cdir * 0.08, end, end + cdir * 0.038],
              [0.0180, 0.0175, 0.0170, 0.0170], "wood_dark", "bone:prop.R", nsides=6, caps=(False, True), uv=0.3)
    kend = end + cdir * 0.038
    ev, ef = lathe_mesh(kend - cdir * 0.004, cdir, [(0.020, 0.0), (0.021, 0.008), (0.0, 0.014)], nsides=6)
    endk = Sculpt("crook_end")
    endk.add(Sphere(kend + cdir * 0.004, 0.02), k=0.0)
    part(out, "crook_end", endk, "wood_dark", "bone:prop.R", len(ef), vs=0.4, paint="proc", uv=0.1, prim=("mesh", ev, ef))
    ring = Sculpt("ring")
    ring.add(Torus(end - (0, 0, 0.004), 0.021, 0.0062, axes=sdf.frame(cdir)), k=0.0)
    part(out, "ring", ring, "ironstone", "bone:prop.R", 32, vs=0.6, paint="proc", uv=0.2)
    _serenade_lamp(out, end)
    INFO["serenade"] = {"arch": A, "pocket": pocket, "rim_w": S_FRAME_W, "light": light, "spill": "#8A7A68",
                        "spill_k": 0.55, "fold": (S_FOLDS, S_FOLD_AMP), "slit": None, "band": (phis, bp)}
    return out


def _serenade_lamp(out, hook):
    """The squat round lampresin lantern (review 2026-10-27 item 3: a culture lamp, not a flat team-colour ball):
    an accent CORE band round the globe's middle (its lit window), glossy amber lampresin above and below it (the
    resin's thick shoulders), six ironstone cage bars as clean straps lying on the globe, a domed iron lid with a
    round knob and hanging ring, a foot dish and an amber resin drop."""
    c = LAMP_C
    rx, rz = 0.097, 0.080
    # the globe as rings of latitude: the lit core band between -42 and +42 deg, lampresin caps beyond
    def ring_pts(el, nu=12):
        return [c + np.array([math.cos(el) * math.cos(a) * rx, math.cos(el) * math.sin(a) * rx, math.sin(el) * rz])
                for a in 2.0 * math.pi * np.arange(nu) / nu]

    def band(els, nu=12, cap=None):
        V, F = [], []
        for e in els:
            V += ring_pts(math.radians(e), nu)
        for j in range(len(els) - 1):
            for i in range(nu):
                a_, b_ = j * nu + i, j * nu + (i + 1) % nu
                F += [(a_, b_, b_ + nu), (a_, b_ + nu, a_ + nu)]
        if cap is not None:
            ci = len(V)
            V.append(c + np.array([0.0, 0.0, cap * rz]))
            j = 0 if cap < 0 else len(els) - 1
            for i in range(nu):
                F.append((j * nu + i, j * nu + (i + 1) % nu, ci))
        V = np.array(V)
        return V, _orient(V, F, lambda i, cen: cen - c)
    cv, cf = band((-50.0, -17.0, 17.0, 50.0))
    core = Sculpt("lamp_core")
    core.add(Sphere(c, 0.01), k=0.0)                       # stand-in high (the accent is never baked)
    part(out, "lamp_core", core, "accent", "bone:x_lamp_1", len(cf), vs=1.0, paint="accent", prim=("mesh", cv, cf))
    tv, tf = band((50.0, 70.0), cap=1.0)
    bv, bf = band((-70.0, -50.0), cap=-1.0)
    rv = np.vstack([tv, bv])
    rf = tf + [tuple(int(i) + len(tv) for i in f) for f in bf]
    resin = Sculpt("lamp_resin")
    resin.add(Ellipsoid(c, (rx, rx, rz)), k=0.0)
    resin.inter(Fn(lambda P: math.sin(math.radians(49.0)) * rz - np.abs(P[:, 2] - c[2]), c - 0.1, c + 0.1), k=0.0)
    part(out, "lamp_resin", resin, "lampresin", "bone:x_lamp_1", len(rf), vs=0.35, paint="proc", uv=0.25,
         prim=("mesh", rv, rf))
    # six cage bars: straps lying on the globe from the lid to the foot dish (clean ribbons, even and straight)
    globe = Ellipsoid(c, (rx, rx, rz))
    BV, BF = [], []
    cage = Sculpt("lamp_cage")
    for i in range(6):
        a = math.radians(60 * i + 30)
        els = np.radians(np.linspace(-62.0, 62.0, 7))
        P = np.array([c + np.array([math.cos(e) * math.cos(a) * rx, math.cos(e) * math.sin(a) * rx, math.sin(e) * rz]) for e in els])
        Nn = np.stack([unit(np.array([(p[0] - c[0]) / rx ** 2, (p[1] - c[1]) / rx ** 2, (p[2] - c[2]) / rz ** 2])) for p in P])
        v, f = ribbon(P, Nn, 0.0072, lift=(0.0015, 0.0055))
        BF += [tuple(int(j) + len(BV) for j in f_) for f_ in f]
        BV += list(v)
        cage.add(Tube([tuple(p + n * 0.003) for p, n in zip(P, Nn)], [0.006] * len(P)), k=0.0)
    part(out, "lamp_cage", cage, "ironstone", "bone:x_lamp_1", len(BF), vs=0.4, paint="proc", uv=0.3,
         prim=("mesh", np.array(BV), BF))
    # the domed lid (with its rim) + knob, the foot dish
    lid = Sculpt("lamp_lid")
    lid.add(Ellipsoid(c + (0, 0, rz - 0.010), (0.066, 0.066, 0.036)), k=0.0)
    lid.inter(HalfSpace(c + (0, 0, rz - 0.004), (0, 0, -1), 0.2), k=0.003)
    lid.add(Torus(c + (0, 0, rz - 0.003), 0.062, 0.0065), k=0.004)
    lid.add(Sphere(c + (0, 0, rz + 0.034), 0.0125), k=0.008)
    lid.add(Ellipsoid(c + (0, 0, -rz + 0.006), (0.052, 0.052, 0.018)), k=0.0)                # the foot dish
    part(out, "lamp_lid", lid, "ironstone", "bone:x_lamp_1", 84, vs=0.35, paint="proc", uv=0.45)
    drop = Sculpt("lamp_drop")
    drop.add(Ellipsoid(c + (0, 0, -rz - 0.010), (0.030, 0.030, 0.022)), k=0.0)                # the amber drop
    drop.add(RoundCone(c + (0, 0, -rz - 0.018), c + (0, 0, -rz - 0.044), 0.020, 0.004), k=0.008)
    part(out, "lamp_drop", drop, "lampresin", "bone:x_lamp_1", 36, vs=0.35, paint="proc", uv=0.15)
    cord = Sculpt("cord")
    top = c + (0, 0, rz + 0.048)
    for i, t in enumerate(np.linspace(0.0, 1.0, 3)):
        p = hook - (0, 0, 0.022) + (top - (hook - (0, 0, 0.022))) * t
        ax = (1.0, 0.0, 0.0) if i % 2 == 0 else (0.0, 1.0, 0.0)
        cord.add(Torus(p, 0.0085, 0.0045, axes=sdf.frame(ax)), k=0.0)
    cord.add(Capsule(hook - (0, 0, 0.012), top, 0.0045), k=0.002)
    part(out, "cord", cord, "ironstone", "bone:x_lamp_1", 36, vs=0.4, paint="proc", uv=0.12)


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


def _bind_mantle(obj, arm) -> None:
    """the capelet: chest / spine by height, and its arm covers follow the upper arms (70 % at the outer edge),
    so a raised arm lifts the felt over it instead of pushing through it"""
    obj.vertex_groups.clear()
    names = ["spine", "chest", "upper_arm.L", "upper_arm.R"]
    groups = {nm: obj.vertex_groups.new(name=nm) for nm in names}
    co = np.array([tuple(obj.matrix_world @ v.co) for v in obj.data.vertices])
    x, z = co[:, 0], co[:, 2]
    aL = 0.7 * smooth(0.130, 0.215, x) * smooth(0.40, 0.46, z)
    aR = 0.7 * smooth(-0.130, -0.215, x) * smooth(0.40, 0.46, z)
    body = 1.0 - aL - aR
    t2 = smooth(0.50, 0.58, z)
    W = {"spine": body * (1 - t2), "chest": body * t2, "upper_arm.L": aL, "upper_arm.R": aR}
    for nm, w in W.items():
        for i in np.nonzero(w > 1e-3)[0]:
            groups[nm].add([int(i)], float(w[i]), "REPLACE")
    mesh.limit_weights(obj)
    mesh.add_armature_modifier(obj, arm)
    mesh.parent_keep(obj, arm)


def _bind_part_glim(ctx, part_, obj, body_low=None):
    if isinstance(part_.bind, tuple) and part_.bind and part_.bind[0] == "glim_cloak":
        _bind_cloak(obj, ctx.info.armature)
        return {}
    if isinstance(part_.bind, tuple) and part_.bind and part_.bind[0] == "glim_mantle":
        _bind_mantle(obj, ctx.info.armature)
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


def _cavity(P, N, keep=None, cell=0.025):
    """The form's own value structure per texel: how far the surface point stands out of its 3D neighbourhood
    (the low-pass mean of the surface), along its normal: + ridges / carved edges / fold crests, - creases and
    fold valleys. In units of ~6 mm, centred on the part's median, squashed to -1..1."""
    Pd = P.astype(np.float64)
    lp = np.stack([_lowpass3d(Pd, Pd[:, i], cell, keep) for i in range(3)], axis=1)
    c = np.einsum("ij,ij->i", Pd - lp, N.astype(np.float64)) / 0.006
    sel = c if keep is None else c[keep]
    return np.tanh(c - (np.median(sel) if len(sel) else 0.0))


# the hand-painted finish per culture: lit planes warm, shade cool (a painter's temperature shift, never grey);
# Aubade linen / wool takes long vertical brush streaks, Serenade felt a soft mottle and fibre speckle
PAINT_STYLE = {
    # (fix round 4: a quieter cool shade - the blue-shaded linen sat on the ally azure's hue, dE 32-34 in game)
    "aubade": {"warm": (1.045, 1.0, 0.94), "cool": (0.95, 0.985, 1.05), "streak": 0.075, "mottle": 0.035, "fibre": 0.02},
    # dusk felt: the shade stays warm (a blue-cool shade turned the umber cloak mauve: review 2026-10-27 item 4)
    "serenade": {"warm": (1.05, 1.0, 0.92), "cool": (0.97, 0.955, 0.955), "streak": 0.035, "mottle": 0.075, "fibre": 0.055},
}


def _painted(lin, P, N, cfg, tgt, keep=None, fold=None):
    """The part's faction colour, hand-painted: a strong top light (forms lit from above, the bible's painted
    key), a vertical gradient, the form's value structure (ridges / edges lighter, creases darker), the cloak's
    folds from their own displacement (lit crests, deep valleys), brush texture (vertical streaks on hanging
    cloth, mottle and fibre on felt), a warm-lit / cool-shade temperature shift, normalised so the lit paint
    lands on `tgt`; then the concept's brush strokes as a luminance ratio against their own 3D low-pass.
    Projected texels far from the part's own value (the concept's stole, pole or lamp landing on a neighbour:
    ghost copies, stains) are masked out of the transfer."""
    st = PAINT_STYLE.get(CUR.get("faction"), PAINT_STYLE["aubade"])
    nz, z = N[:, 2], P[:, 2]
    Pd = P.astype(np.float64)
    li = float(cfg.get("light", 0.3))
    shade = 0.74 + 1.25 * li * smooth(-0.6, 0.95, nz)
    if cfg.get("grad"):
        z0, z1, amt = cfg["grad"]
        shade = shade * (1.0 + amt * (smooth(z0, z1, z) - 0.5))
    shade = shade * (1.0 + 0.045 * NOISE(Pd, 6.0) + 0.03 * NOISE(Pd, 19.0))
    # brush texture: long strokes down hanging cloth (anisotropic noise: fine across, long down), soft mottle,
    # a fine fibre speckle
    hang = float(cfg.get("hang", 0.0))
    if hang > 0:
        Ps = Pd * np.array([1.0, 1.0, 0.13])
        shade = shade * (1.0 + hang * st["streak"] * (0.65 * NOISE(Ps, 70.0) + 0.35 * NOISE(Ps, 160.0)))
    shade = shade * (1.0 + st["mottle"] * NOISE(Pd, 13.0, offset=(3.1, 1.7, 0.4))
                     + st["fibre"] * NOISE(Pd, 140.0, offset=(0.3, 2.2, 5.1)))
    cav = float(cfg.get("cav", 0.0))
    if cav > 0 and len(P) > 50:
        shade = shade * (1.0 + 1.35 * cav * _cavity(P, N, keep))
    if fold is not None:
        fn, amp = fold
        a = np.maximum(amp(Pd[:, 2]), 1e-4)
        w = np.clip(-2.0 * fn(Pd) / a, -1.0, 1.0) * smooth(0.002, 0.008, a)
        crest = np.maximum(w, 0.0) ** 2 * smooth(-0.4, 0.6, nz + 0.25)
        shade = shade * (1.0 + 0.28 * w + 0.10 * crest)
    base = tgt[None, :] * shade[:, None].astype(np.float32)
    # temperature: the lit planes warm, the shade cool and a little deeper (never grey)
    lit = smooth(-0.15, 0.85, nz).astype(np.float32)[:, None]
    tw = np.asarray(st["warm"], dtype=np.float32)[None, :]
    tc = np.asarray(st["cool"], dtype=np.float32)[None, :]
    base = base * (tc + (tw - tc) * lit)
    sh = smooth(0.2, -0.7, nz).astype(np.float32)[:, None]
    lum = (base @ LUMA)[:, None]
    base = base * (1.0 - 0.10 * sh) + (base - lum) * 0.25 * sh
    m = _robust_mean(base)
    base = base * float((tgt @ LUMA) / max(float(m @ LUMA), 1e-5))
    det = float(cfg.get("detail", 0.0))
    if det > 0 and len(lin) > 50:
        # the front / back plates see the up-facing tops at grazing angles: their outline stroke (the concept's
        # dark edge of the dome / cowl) lands on the crown as a scar; fade the transfer out there
        det = det * (1.0 - smooth(0.45, 0.80, nz)).astype(np.float64)
        # THE CONCEPT'S OWN PAINTING (review 2026-10-27 item 3: the 0.88-1.13 clamp kept almost none of it, a vinyl
        # toy): its brush strokes, fold light and felt / linen texture as a luminance ratio against their 3D
        # low-pass (4.5 cm: the patches and baked lighting of the plates live below it), clamped 0.66-1.40, and
        # its colour variation (warm / cool strokes) as a chroma ratio; texels far from the part's own value (a
        # neighbour projected onto it: ghost stoles, stains) are left out
        L = (lin @ LUMA).astype(np.float64)
        ok = np.ones(len(L), dtype=bool) if keep is None else keep.copy()
        if ok.sum() > 50:
            med = float(np.median(L[ok]))
            ok &= (L > med / 1.6) & (L < med * 1.6)
        if ok.sum() > 50:
            Ll = _lowpass3d(Pd, L, 0.045, ok)
            ratio = np.where(ok, np.clip(L / np.maximum(Ll, 1e-4), 0.66, 1.40), 1.0)
            base = base * (1.0 + det * (ratio - 1.0))[:, None].astype(np.float32)
            ch = lin.astype(np.float64) / np.maximum(L[:, None], 1e-4)
            chl = np.stack([_lowpass3d(Pd, ch[:, k], 0.045, ok) for k in range(3)], axis=1)
            cr = np.where(ok[:, None], np.clip(ch / np.maximum(chl, 1e-4), 0.86, 1.16), 1.0)
            base = base * (1.0 + 0.7 * np.asarray(det)[:, None] * (cr - 1.0)).astype(np.float32)
    return np.maximum(base, 0.0)


def _mix(a, b, w):
    w = np.asarray(w, dtype=np.float32)[:, None]
    return a * (1.0 - w) + np.asarray(b, dtype=np.float32) * w


def _wrapdeg(a):
    return (a + 180.0) % 360.0 - 180.0


def _ink(lin, P, info, ink, thr, N, through):
    """the hollow: every texel that lies within 2 cm of the pocket AND faces into it goes to ink, deeper =
    darker (the decimated walls stray several mm off the SDF pocket: a tight distance test left lit tan / brown
    wall patches); `through` (the parts below the hood): what is seen through the opening"""
    lo, hi = info["arch"].box(0.03, 0.34, 0.13) if through else info["pocket"].bounds()
    near_ = np.all((P >= lo - 0.02) & (P <= hi + 0.02), axis=1)
    if not near_.any():
        return lin
    lin = np.array(lin, dtype=np.float32, copy=True)
    lin[near_] = _ink_near(lin[near_], P[near_], info, ink, thr, N[near_], through)
    return lin


def pocket_grad(pocket, P, e=4e-4):
    """unit gradient of the pocket SDF (points from the void into the solid)"""
    P = np.asarray(P, dtype=np.float64)
    g = np.stack([pocket.d(P + np.eye(3)[k] * e) - pocket.d(P - np.eye(3)[k] * e) for k in range(3)], axis=1)
    return g / np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-9)


def _ink_near(lin, P, info, ink, thr, N, through):
    A, pocket = info["arch"], info["pocket"]
    Pd = P.astype(np.float64)
    d = pocket.d(Pd)
    q = A.q(P)
    if through:
        # parts under the hood (the mantle / cloak top) seen THROUGH the opening: behind it, inside its outline,
        # facing out through it -> ink too (else the cloak top shows as a light floor inside the hollow)
        seen = (A.d2(P) < 0.01) & (q[:, 2] < 0.0) & (q[:, 2] > -0.3) & (N @ A.F[2] > -0.2)
        w = 0.97 * (seen | (d < thr)).astype(np.float32)
    else:
        facing = -np.einsum("ij,ij->i", N.astype(np.float64), pocket_grad(pocket, Pd))
        w = 0.98 * smooth(0.022, 0.012, d) * smooth(0.10, 0.45, facing) * smooth(-thr, 0.022 - thr, -q[:, 2])
        # anything INSIDE the void behind the opening is hollow, whichever way it faces (the Serenade collar's
        # inner top read as a lit grey shelf where the pocket's nearest wall was a side wall)
        w = np.maximum(w, 0.98 * smooth(0.006, -0.002, d) * smooth(-0.004, 0.012, -q[:, 2]))
    depth = np.clip(-q[:, 2] / 0.10, 0.0, 1.0)
    xr, h, t = pocket_coords(A, pocket, Pd)
    # deeper and higher = darker (the light pools at the bottom); round the hood light a team-neutral spill on
    # the ink (the accent is factor-only: this soft falloff is what keeps its edge from reading as a sticker)
    col = ink[None, :] * (1.0 - 0.55 * depth)[:, None].astype(np.float32)
    sp = info["light"].spill(Pd, N)
    col = _mix(col, _hexlin(info["spill"]), info.get("spill_k", 0.6) * sp)
    return _mix(lin, col, w)


def _sleeve_ends(lin, P, N, under):
    """the sleeves' open cuffs: the flat end faces are the dark inside of the sleeve"""
    for _, (sh, el, wr) in ARMS:
        ax = unit(wr - el).astype(np.float32)
        cuff = (wr - unit(wr - el) * CUFF_BACK).astype(np.float32)
        t = (P - cuff) @ ax
        w = smooth(-0.010, -0.004, t) * smooth(0.45, 0.75, N @ ax)
        lin = _mix(lin, under, 0.9 * w)
    return lin


def _sleeve_wraps(lin, P, N, tint, under):
    """the concept's wrapped forearms: a lighter linen binding wound round each forearm from the elbow to the cuff,
    diagonal turns with a dark line between them (the torus wraps alone vanished in the decimation)"""
    Pd = P.astype(np.float64)
    for _, (sh, el, wr) in ARMS:
        ax = unit(wr - el)
        cuff = wr - ax * CUFF_BACK
        Lf = float(np.linalg.norm(cuff - el))
        t = (Pd - el) @ ax / Lf
        rad = (Pd - el) - np.outer(t * Lf, ax)
        e1 = unit(np.cross(ax, (0.0, 0.0, 1.0)) if abs(ax[2]) < 0.9 else np.cross(ax, (1.0, 0.0, 0.0)))
        e2 = np.cross(ax, e1)
        ang = np.arctan2(rad @ e2, rad @ e1)
        on = smooth(0.18, 0.26, t) * smooth(1.02, 0.94, t) * (np.linalg.norm(rad, axis=1) < 0.075)
        ph = t * Lf / 0.017 + ang / (2.0 * math.pi)
        fr = np.mod(ph, 1.0)
        line = smooth(0.16, 0.06, fr) + smooth(0.88, 0.97, fr)
        wrap = tint[None, :] * (0.92 + 0.16 * fr[:, None]) * (1.0 + 0.05 * NOISE(Pd, 31.0))[:, None]
        wrap = wrap * (1.0 - 0.45 * np.clip(line, 0, 1))[:, None]
        lin = _mix(lin, wrap, 0.95 * on)
    return lin


def _aubade_marks(nm, lin, P, N, info, pal):
    A, rw = info["arch"], info["rim_w"]
    slate = _hexlin(pal["ironstone"])
    under = _hexlin(pal["under"])
    Pd = P.astype(np.float64)
    if nm == "hood":
        # a dark slate bed each side of every seam (1.1 cm: a dark edge for either tint, so the hood mark keeps its
        # contrast on the blue-grey linen whatever the team colour; only where the seam is, so no tab at the nape)
        hw = a_seam_hw(Pd)
        a = a_seam_angle(Pd)
        on = (a > A_SEAM_A[0] - 2) & (a < A_SEAM_A[1]) & (hw > 0.0012)
        w = smooth(hw + 0.0120, hw + 0.0080, np.abs(P[:, 0])) * on
        for sgn in (-1.0, 1.0):
            n_, d_ = a_side_frame(sgn)
            hs = a_side_hw(Pd, d_)
            t = a_side_elev(Pd, d_)
            on2 = (t > A_SIDE_T[0] - 1) & (t < A_SIDE_T[1] + 1) & (hs > 0.0012) & ((Pd - A_SIDE_C) @ d_ > 0)
            w = np.maximum(w, smooth(hs + 0.0115, hs + 0.0075, np.abs((Pd - A_SIDE_C) @ n_)) * on2)
        lin = _mix(lin, slate * (0.85 + 0.06 * NOISE(Pd, 23.0))[:, None], 0.9 * w)
    elif nm == "hood_rim":
        # carved chalk blocks round the arch (keystone on top): joint lines, a pale bevel beside each joint, a
        # little value per block, darker chamfers along both edges, the top faces catching the light
        q = A.q(P)
        dx, dy = q[:, 0], q[:, 1] - A.yc
        ang = np.degrees(np.arctan2(dy, dx))
        r = np.sqrt(dx * dx + dy * dy)
        joints = np.array([73.0, 107.0, 38.0, 142.0, 2.0, 178.0, -38.0, 218.0, -72.0, 252.0])
        dd = _wrapdeg(ang[:, None] - joints[None, :])
        k = np.argmin(np.abs(dd), axis=1)
        dj = np.abs(dd[np.arange(len(dd)), k]) * np.pi / 180.0 * r                      # metres to the joint
        sj = np.sign(dd[np.arange(len(dd)), k])
        blk = np.digitize(_wrapdeg(ang - 100.0), np.sort(_wrapdeg(joints - 100.0)))
        lin = lin * (1.0 + 0.07 * np.sin(blk * 2.7 + 0.6))[:, None]
        lin = lin * (1.0 - 0.36 * smooth(0.0032, 0.0012, dj))[:, None]
        lin = lin * (1.0 + 0.10 * (smooth(0.0012, 0.0030, dj) * smooth(0.0075, 0.0040, dj) * (sj > 0)))[:, None]
        d2 = A.d2(P)
        front = q[:, 2] > -0.015
        bev = (smooth(rw - 0.008, rw - 0.001, d2) + smooth(0.009, 0.002, d2)) * front
        lin = lin * (1.0 - 0.18 * np.clip(bev, 0, 1))[:, None]
    elif nm == "cloak":
        # the slate hem band (brief 2.4: the feet band), cut along the pointed hem, a crisp top edge
        zh = a_hem_z(P)
        w = smooth(zh + 0.074, zh + 0.068, P[:, 2])
        lin = _mix(lin, slate * (1.0 + 0.05 * NOISE(Pd, 17.0))[:, None], w)
        # the concept's OPEN FRONT between the stoles: a lighter blue-grey tunic with soft pleats, a wrapped sash
        # at the waist (review 2026-10-27 item 4: the front had closed into a flat panel)
        fr_ = smooth(-0.025, -0.06, P[:, 1]) * smooth(0.25, 0.32, N[:, 1] * -1.0 + 0.3)
        inner = smooth(A_STOLE_X - A_STOLE_HW + 0.001, A_STOLE_X - A_STOLE_HW - 0.003, np.abs(P[:, 0]))
        tz = smooth(0.226, 0.236, P[:, 2]) * smooth(0.640, 0.620, P[:, 2])
        wt = fr_ * inner * tz
        if wt.any():
            tun = _hexlin("#7D91AA") * (1.0 + 0.10 * (smooth(0.22, 0.62, P[:, 2]) - 0.5))[:, None]
            pleat = np.cos(P[:, 0] / 0.0125 * np.pi)
            tun = tun * (1.0 + 0.07 * pleat + 0.04 * NOISE(Pd * np.array([1.0, 1.0, 0.15]), 90.0))[:, None]
            sz = smooth(0.418, 0.424, P[:, 2]) * smooth(0.482, 0.476, P[:, 2])
            ph = np.mod((P[:, 2] - 0.418) / 0.016 + P[:, 0] / 0.05, 1.0)
            sash = _hexlin("#A5B3C4") * (0.94 + 0.10 * ph[:, None]) * (1.0 - 0.35 * smooth(0.12, 0.04, ph))[:, None]
            tun = _mix(tun, sash, sz)
            tun = tun * (1.0 - 0.30 * smooth(0.010, 0.0, A_STOLE_X - A_STOLE_HW - np.abs(P[:, 0])))[:, None]
            lin = _mix(lin, tun, 0.96 * wt)
        # the slit's walls and the hem's underside are the dark lining (no torn light shards at the split)
        ws = smooth(0.010, 0.004, np.abs(info["slit"](Pd))) * (P[:, 1] < -0.03)
        wu = smooth(-0.35, -0.65, N[:, 2]) * (P[:, 2] < 0.2)
        lin = _mix(lin, under, 0.92 * np.maximum(ws, wu))
    elif nm == "sleeves":
        lin = _sleeve_wraps(lin, P, N, _hexlin("#8597AE"), under)
        lin = _sleeve_ends(lin, P, N, under)
    return lin


def _stoles(lin, lin0, P, N, pal):
    """the chalk stoles on the Aubade cloak (one mesh): their footprint painted chalk (its own top light,
    gradient, form value and the concept's strokes), a thin inset hem line along their edges, and a soft
    contact shadow on the cloak beside them (the layer reads as cloth lying on cloth)"""
    e = a_stole_out(P.astype(np.float64))
    w = smooth(0.0007, -0.0005, e)
    if not (w > 0).any():
        return lin
    keep = w > 0.5
    st = _painted(lin0, P, N, STOLE_CFG, _hexlin(STOLE_CFG["tint"]), keep)
    # the hem: a slightly darker line 4-7 mm in from the edge (a turned, stitched edge), the edge itself lighter
    st = st * (1.0 - 0.12 * smooth(-0.0080, -0.0065, e) * smooth(-0.0030, -0.0045, e))[:, None]
    st = st * (1.0 + 0.05 * smooth(-0.0028, -0.0012, e))[:, None]
    out = _mix(lin, st, w)
    sh = smooth(0.006, 0.0005, e) * (1.0 - w)
    return out * (1.0 - 0.28 * sh)[:, None]


def _serenade_marks(nm, lin, P, N, info, pal):
    A = info["arch"]
    iron = _hexlin(pal["ironstone"])
    under = _hexlin(pal["under"])
    Pd = P.astype(np.float64)
    if nm == "dome":
        # the crown band sits on the felt roll; above it a dark ironstone bed (1.1 cm: a dark edge for either tint,
        # the band's contrast on the sand) and felt panel seams up to a crown button
        sd = s_band_sd(Pd, info["band"])
        # the seam's shadow under the lid edge (a dark crease right above the band: its edge for either tint), the
        # welt's underside in shade, a lit crest with running stitches
        u = sd - S_BAND_HALF
        crease = smooth(0.0055, 0.0025, u) * (u > -0.004)
        lin = _mix(lin, iron * (0.8 + 0.06 * NOISE(Pd, 23.0))[:, None], 0.92 * crease)
        lin = lin * (1.0 - 0.22 * smooth(0.0110, 0.0060, u) * (u > 0.0))[:, None]
        lin = lin * (1.0 + 0.10 * np.exp(-((u - 0.0105) / 0.0035) ** 2))[:, None]
        az = np.radians(s_azimuth(Pd)) * 0.17
        stitch = (np.mod(az / 0.010, 1.0) < 0.55) * np.exp(-((u - 0.0140) / 0.0011) ** 2)
        lin = lin * (1.0 - 0.30 * stitch)[:, None]
        a = np.degrees(np.arctan2(P[:, 0], -(P[:, 1] - 0.025)))
        r = np.sqrt(P[:, 0] ** 2 + ((P[:, 1] - 0.025) / 1.05) ** 2)
        seams = np.array([62.0, -62.0, 118.0, -118.0, 180.0])
        dm = np.min(np.abs(_wrapdeg(a[:, None] - seams[None, :])), axis=1) * np.pi / 180.0 * r
        # the panel seams run up from the band and END at a round felt crown button (crossing at the crown they
        # pinched into a pucker)
        up = (sd > S_BAND_HALF + 0.022) * smooth(0.925, 0.895, P[:, 2])
        lin = lin * (1.0 - 0.34 * smooth(0.0042, 0.0012, dm) * up)[:, None]
        lin = lin * (1.0 + 0.07 * (smooth(0.0095, 0.0062, dm) - smooth(0.0062, 0.0042, dm)) * up)[:, None]
    elif nm == "roll":
        # ONE dark felt: the thick roll framing the opening runs into the rolled collar (the concept's face
        # frame); quilted grooves round the collar and round the frame's arch
        q = A.q(P)
        fr = smooth(info["rim_w"] + 0.016, info["rim_w"] + 0.006, A.d2(P)) * (q[:, 2] > -0.08) * smooth(0.645, 0.675, P[:, 2])
        a = np.degrees(np.arctan2(P[:, 0], -(P[:, 1] - 0.03)))
        r = np.sqrt(P[:, 0] ** 2 + (P[:, 1] - 0.03) ** 2)
        x_ = np.mod(a - 15.0, 30.0)
        dm = np.minimum(x_, 30.0 - x_) * np.pi / 180.0 * r
        lin = lin * (1.0 - 0.24 * smooth(0.0065, 0.002, dm) * (1.0 - fr))[:, None]
        aa = np.degrees(np.arctan2(q[:, 1] - A.yc, q[:, 0]))
        x2 = np.mod(aa - 13.0, 26.0)
        da = np.minimum(x2, 26.0 - x2) * np.pi / 180.0 * (A.hw_top + info["rim_w"] * 0.5)
        lin = lin * (1.0 - 0.14 * smooth(0.0055, 0.0018, da) * fr * (q[:, 1] > A.y_bot + 0.03))[:, None]
        # the lip: the roll's top faces inside the arch outline are the floor of the opening, in shadow (an
        # up-facing lit felt strip there read as a pale tray under the glow)
        lip = smooth(0.006, -0.012, A.d2(P)) * (q[:, 2] > -0.24) * (q[:, 2] < 0.06)
        lin = _mix(lin, _hexlin(pal["ink"]) * 1.6, 0.85 * lip)
    elif nm == "mantle":
        # the band lies along the hem (e 0.0015-0.0315); above it a slim dark felt bed (the band's edge for either
        # tint) with running stitches, a lit roll on the turned edge below it
        e = P[:, 2] - s_cape_edge(Pd)
        e = np.where(P[:, 1] < -0.06, np.minimum(e, s_cape_split(Pd)), e)
        bed = smooth(2 * S_TRIM_HALF + 0.0005, 2 * S_TRIM_HALF + 0.003, e) * smooth(2 * S_TRIM_HALF + 0.0105, 2 * S_TRIM_HALF + 0.0075, e)
        lin = _mix(lin, iron * (0.95 + 0.06 * NOISE(Pd, 23.0))[:, None], 0.88 * bed)
        a = np.radians(s_cape_angle(Pd)) * 0.24
        stitch = (np.mod(a / 0.011, 1.0) < 0.55).astype(np.float32) * np.exp(-((e - 2 * S_TRIM_HALF - 0.016) / 0.0012) ** 2)
        lin = lin * (1.0 - 0.25 * stitch)[:, None]
        lin = lin * (1.0 + 0.07 * smooth(0.0045, 0.0015, e))[:, None]
    elif nm == "cloak":
        # two dark ironstone hem bands: raised felt piping (relief in the normal map), painted round (lit on top,
        # shaded below), a soft contact shadow on the cloak under each; the hem's underside is lining
        z = P[:, 2]
        for z0, z1 in S_HEM_BANDS[::-1]:
            w = smooth(z0 - 0.0020, z0 + 0.0012, z) * smooth(z1 + 0.0020, z1 - 0.0012, z)
            u = np.clip((z - z0) / (z1 - z0), 0.0, 1.0)
            band = iron * (0.80 + 0.30 * u * (1.0 - 0.4 * u) + 0.05 * NOISE(Pd, 19.0))[:, None]
            lin = _mix(lin, band, w)
            lin = lin * (1.0 - 0.22 * smooth(z0 - 0.008, z0 - 0.001, z) * (z < z0))[:, None]
        wu = smooth(-0.35, -0.65, N[:, 2]) * (z < 0.2)
        lin = _mix(lin, under, 0.92 * wu)
    elif nm == "sleeves":
        lin = _sleeve_ends(lin, P, N, under)
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
    # hollow parts -> how far in front of the opening plane their faces turned into the pocket are inked (the
    # felt roll's whole bore is ink: lit felt at the lip read as a tray under the light)
    hollow_parts = {"hood": 0.012, "hood_rim": 0.012} if g["faction"] == "aubade" else {"dome": 0.012, "roll": 0.045}
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
                keep = info["pocket"].d(Pm.astype(np.float64)) > 0.022
            tgt = _hexlin(cfg.get("tint") or pal.get(cfg["role"]))
            lin0 = lin
            lin = _painted(lin, Pm, Nm, cfg, tgt, keep, info["fold"] if nm == "cloak" else None)
            lin = marks(nm, lin, Pm, Nm, info, pal)
            if nm == "cloak" and g.get("hem"):
                lin = lin * (1.0 - g["hem"] * smooth(0.34, 0.08, Pm[:, 2]))[:, None]
            if nm == "cloak" and g["faction"] == "aubade":
                lin = _stoles(lin, lin0, Pm, Nm, pal)
            lin = _ink(lin, Pm, info, ink, hollow_parts.get(nm, 0.004), Nm, nm not in hollow_parts)
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
        bad = a[..., 1] < 0.30          # gaps + the border texels the 1024 -> 256 downscale mixed with them
        if bad.any() and not bad.all():
            iy, ix = project.nearest_index(~bad)
            a[..., 1] = a[..., 1][iy, ix]
        a[..., 2] = 0.0
        # the ink (the hood hollows, near-black paint) is fully matte: at roughness ~0.6 the up-facing ink inside
        # the Serenade collar caught the sky as a grey sheen (a lit shelf / "lips" round the hollow)
        bp = res.get("images", {}).get("base")
        if bp and os.path.exists(bp):
            bi = bpy.data.images.load(bp, check_existing=False)
            if tuple(bi.size) != (w_, h_):
                bi.scale(w_, h_)
            ba = np.empty(w_ * h_ * 4, dtype=np.float32)
            bi.pixels.foreach_get(ba)
            ba = ba.reshape(h_, w_, 4)
            lum = ba[..., 0] * 0.2126 + ba[..., 1] * 0.7152 + ba[..., 2] * 0.0722
            mk = np.clip((0.13 - lum) / 0.05, 0.0, 1.0)
            a[..., 1] = a[..., 1] * (1.0 - mk) + 1.0 * mk
            # and fully occluded: the lifted AO (>= 0.55) let the sky's indirect light + its 4 % specular grey the
            # up-facing ink (the hollow must stay a dark void under the game light)
            a[..., 0] = a[..., 0] * (1.0 - mk) + 0.06 * mk
            bpy.data.images.remove(bi)
            scene.log(f"glimwick ORM: ink matte on {int((mk > 0.5).sum())} px")
        # write through a fresh generated image (saving a loaded image after foreach_set can write its old
        # file buffer), then reload the material's image from the file so the exporter packs the fixed map
        tmp = bpy.data.images.new(f"{name}_orm_glimfix", w_, h_, alpha=False, float_buffer=False)
        tmp.colorspace_settings.name = "Non-Color"
        bake.set_image_array(tmp, a)
        bake.save_image(tmp, path, "PNG")
        bpy.data.images.remove(tmp)
        img.reload()
        chk = np.empty(w_ * h_ * 4, dtype=np.float32)
        img.pixels.foreach_get(chk)
        chk = chk.reshape(h_, w_, 4)
        scene.log(f"glimwick ORM: roughness gaps filled {int(bad.sum())} px (left {int((chk[..., 1] < 0.04).sum())}), "
                  f"metal max {float(chk[..., 2].max()):.3f}")
    if mat is not None and mat.node_tree:
        bsdf = mat.node_tree.nodes.get("BSDF")
        if bsdf is not None:
            for l_ in list(bsdf.inputs["Metallic"].links):
                mat.node_tree.links.remove(l_)
            bsdf.inputs["Metallic"].default_value = 0.0
    return res


CUR: dict = {}                  # the build in progress: faction + part names (set by Glimwick.model)

_unwrap0 = bake.unwrap


def _unwrap_glim(obj, angle: float = 62.0, *a, **kw):
    """bake.unwrap with a 74 deg smart-project limit for glimwick faction builds: the decimated sleeves / mitts /
    boots split into a band of tiny chips at 62 deg (review 2026-10-27 item 3: poor texel use)"""
    if CUR.get("faction") in ("aubade", "serenade"):
        angle = 74.0
    return _unwrap0(obj, angle, *a, **kw)


bake.unwrap = _unwrap_glim


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

    # RUN (3.25 m/s, short quick scurry): the shared cycle's body and timing, the pole carried upright tipped 10 deg
    # forward, the lamp trailing, the left arm swinging short. The FEET are a minion scurry: planted contact at
    # the exact ground speed (no slide), then a LOW swing straight back to the front (no overshoot, no heel
    # kick): the boots slide out under the hem and never push through the bell cloak above it
    base_run = anim.gen_run(MOTION)
    nrun = base_run.frames
    c_ct = anim.WEIGHTS[MOTION["weight"]][3]
    Ls = MOTION["run_ref_speed"] * c_ct * float(base_run.meta["cycle_s"])

    def ease(x):
        return 0.5 - 0.5 * math.cos(math.pi * min(1.0, max(0.0, x)))

    def foot_path(u):
        """(dy, dz, pitch) of one foot at cycle phase u (contact first, -Y = forward). The ankle is lifted by what
        the pitch would push the heel / toe under the ground (review 2026-10-27 item 7: the boots sank 1.5-2.3 cm
        at the toe-off), and the swing lifts 6 cm early (behind the body, inside the bell) then comes through low"""
        u %= 1.0
        if u < c_ct:
            s_ = u / c_ct
            pitch = 5.0 * (1.0 - ease(s_ / 0.3)) - 16.0 * max(0.0, (s_ - 0.65) / 0.35) ** 1.6
            y, z = -Ls / 2 + Ls * s_, 0.0
        else:
            s_ = (u - c_ct) / (1.0 - c_ct)
            y = Ls / 2 - Ls * ease(s_)
            z = 0.062 * math.sin(math.pi * s_ ** 0.8) ** 1.2
            pitch = -16.0 * (1.0 - s_) ** 3 + 9.0 * math.sin(math.pi * s_) * s_
        th = math.radians(pitch)
        lift = 0.060 * math.sin(th) if th > 0 else 0.108 * math.sin(-th) - 0.045 * (1.0 - math.cos(th))
        return y, z + max(0.0, lift) + 0.002, pitch

    def run_s(t):
        q = t % 1.0
        p = dict(base_run.sample(t))
        for b in ARM_BONES:
            p.pop(b, None)
        ik = {}
        fw = {}
        for k, f in p["ik"].items():
            if k.startswith("foot"):
                sgn = 1.0 if k == "foot.L" else -1.0
                y, z, pitch = foot_path(q if k == "foot.L" else q + 0.5)
                ik[k] = FT((0.012 * sgn, y - 0.02, z), pitch, f.yaw, f.toe, f.knee, f.weight)
                fw[k] = max(0.0, -y) / (Ls / 2)
        p["ik"] = ik
        hx, hy, hz = p["hips_loc"]
        hz *= 0.75
        p["hips_loc"] = (hx, hy, hz)
        sw = math.cos(2 * math.pi * (q - 0.03))
        p["upper_arm.L"] = (-20.0 * sw + 6.0, 0.0, 0.0)
        p["forearm.L"] = (28.0 + 12.0 * max(0.0, sw), 0.0, 0.0)
        p["hand.L"] = (0.0, -10.0, 0.0)
        bob = math.cos(4 * math.pi * q)
        # the pole is CARRIED (its foot 4-5 cm off the ground: it dipped 3 cm under it on the low frames)
        p["_grip"] = grip_at((0.0, -0.025, hz * 0.9 + 0.050))
        p["_pole"] = (10.0 + 1.5 * bob, 0.0, 0.25 * p.get("chest", (0, 0, 0))[1])
        p["_twist"] = (0.0, 0.0, 0.0)
        p["_lamp"] = (-16.0 + 5.0 * bob, 0.0, 0.0)
        # the cloak swings ahead of whichever boot is forward (the boot never pierces the rigid drapery)
        fl, fr = fw.get("foot.L", 0.0), fw.get("foot.R", 0.0)
        p.update(skirt(3.0 + 2.0 * bob))
        p["x_skirt_f"] = (6.0 + 14.0 * max(fl, fr) ** 1.2, 0.0, 0.0)
        p["x_skirt_l"] = (4.0 + 8.0 * fl, 0.0, 0.0)
        p["x_skirt_r"] = (4.0 + 8.0 * fr, 0.0, 0.0)
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
                upper_arm_L=(14, 0, 2), forearm_L=(30, 0, 0))
    tip["_grip"] = grip_at((-0.03, 0.0, -0.10))
    tip["_pole"] = (0.0, 38.0, 0.0)
    tip["_twist"] = (40.0, 0.0, 0.0)
    tip.update(skirt(10.0))
    # the wick slumps toward its right (the pole side) into a heaped cloak; the pole lies on the ground to its
    # RIGHT (review 2026-10-27 item 6: it fell forward-right), the lamp beside it, still lit. The hips sink 10.5 cm
    # (not 14.5: the hem then needed a 37+ deg flare = a flat rigid "lampshade"), the skirt bones flare unevenly
    # (more on the right / front where the hood droops, sideways swings) so the hem is a lumpy pile, not a cone
    G_DOWN = (-0.12, 0.02, -0.40)
    # the free left arm folds in across the front: the mitt rests on the heap, never sticking out
    down = with_(d0, hips_loc=(-0.02, 0.02, -0.095), hips=(0, 0, 4), spine=(8, 0, 13), chest=(12, 0, 15),
                 neck=(8, 0, 8), head=(18, 0, 10), upper_arm_L=(46, 0, -30), forearm_L=(68, 0, 0), hand_L=(-20, 0, 0))
    down["_grip"] = grip_at(G_DOWN)
    down["_pole"] = (0.0, 91.0, 12.0)
    down["_twist"] = (90.0, 0.0, 0.0)
    down.update({"x_skirt_f": (27.0, 0.0, 7.0), "x_skirt_b": (20.0, 0.0, -5.0), "x_skirt_l": (17.0, 0.0, 6.0),
                 "x_skirt_r": (30.0, 0.0, -4.0)})
    bounce = with_(down, hips_loc=(-0.02, 0.02, -0.112))
    bounce["_pole"] = (0.0, 88.5, 12.0)
    bounce["_grip"] = grip_at((G_DOWN[0], G_DOWN[1], G_DOWN[2] + 0.02))
    bounce.update({"x_skirt_f": (30.0, 0.0, 8.0), "x_skirt_b": (22.0, 0.0, -6.0), "x_skirt_l": (19.0, 0.0, 7.0),
                   "x_skirt_r": (33.0, 0.0, -5.0)})
    slump = with_(down, hips_loc=(-0.02, 0.02, -0.108), spine=(10, 0, 15), chest=(14, 0, 18), neck=(10, 0, 10),
                  head=(24, 0, 12))
    slump.update({"x_skirt_f": (29.0, 0.0, 8.0), "x_skirt_b": (21.0, 0.0, -6.0), "x_skirt_l": (18.0, 0.0, 7.0),
                  "x_skirt_r": (32.0, 0.0, -5.0)})
    rest = with_(slump, hips_loc=(-0.02, 0.02, -0.106))
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
        self.AO_INTO_BASE = 0.42
        self.TEXTURE_SIZES = {"normal": 512, "orm": 256}      # 512: the folds / piping / stole edges read
        self._parts = parts_for(faction)
        concept, h, grade = PLATES[faction]
        proj = wc.graded_projection(concept, h, tag="glim", **grade)
        keys = ("paint", "role", "tint", "light", "detail", "grad", "cav", "hang")
        proj["_glim"] = {"id": self.ID, "faction": faction, "palette": dict(self.PALETTE),
                         "hem": 0.30 if faction == "aubade" else 0.24, "info": INFO[faction],
                         "parts": {p["name"]: {k: p[k] for k in keys} for p in self._parts}}
        self.PROJECTION = proj

    def extra_materials(self, ctx) -> dict:
        """The accent stays matte (roughness 0.85): at 0.25 its white specular glints broke the team colour up on
        the seam / band strips (a white notch, a zigzag of glints). Legacy builds keep the shared material."""
        if self.faction == wc.LEGACY:
            return {}
        m = ctx.mats.get("accent")
        if m is not None and m.node_tree:
            for nd in m.node_tree.nodes:
                if nd.type == "BSDF_PRINCIPLED":
                    nd.inputs["Roughness"].default_value = 0.85
        return {}

    # ---- model ----
    def model(self, ctx) -> list:
        if self.faction == wc.LEGACY:
            return self.legacy_model(ctx)
        from common import fighter
        CUR.clear()
        CUR.update(faction=self.faction, names=[p["name"] for p in self._parts])
        wc.halo_material(ctx)
        wc.install_halo_export()
        P = []
        for p in self._parts:
            v, q = p["S"].mesh(VOXEL * p["vs"])
            ob = sdf.to_object(f"{p['name']}_high", v, q, ctx.col)
            ob.data.materials.append(ctx.mats[p["role"]])
            low = make_low(p, ob, ctx.col)
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
                              drive=lambda p: p.get("_lamp", (0.0, 0.0, 0.0))[0], limit=(-70.0, 70.0), floor=0.07)]

    def clip_overrides(self, ctx) -> dict:
        if self.faction == wc.LEGACY:
            return {}
        return clip_overrides_for(ctx)


KINDS = [Glimwick]

if __name__ == "__main__":
    wc.run(KINDS)
