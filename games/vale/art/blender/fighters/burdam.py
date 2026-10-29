"""burdam: Grudge holder (Breaker, Serenade). ART 2.0: sculpted volumes painted by concept projection.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/burdam_plates.py     # plates (2.56 m)
    Blender -b --factory-startup --python art/blender/proto/burdam_fit.py --             # fit check
    python3 art/build.py fighter burdam --no-skins --clip-sheet

Brief: _design/fighters/burdam.md. Concept: _design/concept/burdam.webp (front + back, hand-painted).
The forms are numpy SDF volumes (common/hifi/sdf.py) fitted to the concept on a 10 cm grid (mask crown
2.15 m = art.height; the plates are 2.56 m tall to the cleaver's tip); the base colour is the concept
painting projected occlusion-aware onto the game mesh (common/hifi/project.py via PROJECTION); normals
and AO bake from the sculpt.

Where the concept and the brief disagree the concept's look wins (it is the approved painting): the
stacked three-tier pauldron sits on the LEFT shoulder and the right shoulder carries a carved front
plate over a leather fringe; the cleaver is 1.43 m of blade with a short wrapped haft; the mask is the
concept's lacquered ochre-gold. The brief wins on what is geometry: the five notch gems are `accent`
slabs (four in the heel's notch line, one in the pommel), painted out of the plates.

THE CLEAVER is modelled in prop space (grip at the origin, +Z the blade, +Y the notched spine; shared
outline in proto/burdam_cleaver.py) and rides prop.R. The concept paints it resting behind the head, not
in the fist, so the projection paints it in that PAINT POSE: this module wraps project.paint_object to
move the cleaver's vertices to where the concept draws them for the paint pass only (the shared
pipeline has no per-part paint pose; implemented here, common/ untouched).
"""
from __future__ import annotations

import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "proto"))

import bpy  # noqa: E402,F401
import numpy as np  # noqa: E402

import burdam_cleaver as cl  # noqa: E402
from common import anim, fighter, materials, rig  # noqa: E402
from common.hifi import sdf  # noqa: E402
from common.hifi.sdf import (Capsule, Ellipsoid, FlatCapsule, HalfSpace, RoundBox, RoundCone,  # noqa: E402
                             Sculpt, Sphere, Torus, Tube)

ID = "burdam"
TITLE = "Grudge holder"
ROLE_MASS = "breaker"
ORIGIN = "serenade"
CARD = {"primary": "#5E4F45", "secondary": "#9A7B62"}

# rig fitted to the sculpt: mask crown 2.15 m, skull base 1.85, shoulders x 0.40 at 1.58, elbows
# ~(0.465, 1.30), wrists ~(0.52, 1.06) (fists at the hips), hips x 0.16 at 0.85, knees 0.46, ankles x 0.24
PROPORTIONS = rig.proportions(height=2.15, head=0.35, neck=0.07, shoulder_width=0.80, hip_width=0.32, leg=0.744,
                              thigh_frac=0.53, arm=0.535, upper_arm_frac=0.54, hand=0.20, foot=0.34,
                              ankle_height=0.11, spine_curve=0.0, stance=0.08, toe_out_deg=12.0, knee_bend=0.014,
                              a_pose_deg=77.0, arm_forward_deg=3.0, elbow_bend_deg=12.0, shoulder_drop=0.20)
MATERIAL_SET = "bible"
PALETTE = materials.bible_palette(sandstone="#D4C2A0", cloth2="#C6B9A5", rust="#B8A794", stone="#CCC5B8",
                                  ironstone="#4B4039", leather="#554336", cloth="#86796D", wood_dark="#5A4639",
                                  under="#3A3735", ink="#17181B", accent="#3F9CFF")
VALUE_GRADIENT_STOPS = materials.BIBLE_GRADIENT_STOPS
BLOCKS: dict = {}
MOTION = anim.motion_profile(weight="heavy", weapon="two_hand", stance="wide", run_ref_speed=3.45, blocks=BLOCKS)
SOCKETS = {"weapon": "prop.R", "weapon_tip": "x_blade_tip", "notch": "x_notch_mid"}
SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92,
          # fix pass 8 (the review: the splash mask read two-hued, a lemon face plate on a peach cranium): the warm lamp
          # rim on screen-right washed the cranium's side to L* 83 / b* +27 against the face's 68 / +43; half strength
          "rim_warm": 0.5,
          # polish (the value lift): the splash key a step down (3.0 -> 2.6). The lifted top band (the felt's lit folds,
          # the mask, the pauldron tops) reads at the game's light, where it was the darkest kit; under the splash's
          # 45-degree sun at full strength a third of the cowl's top folds blew past L* 86
          "sun": 2.6,
          # final parity client F3: the figure at 0.81 of the splash's height (0.68 of W2's loading card) -> ~0.86
          "fill": 0.94}
TEXTURE_SIZE = 2048      # the painted base colour; normal + ORM at 512 (CONTRACT §12 Materials)
TEXTURE_SIZES = {"normal": 512, "orm": 512}
GLB_COMPRESS = True
ARMOUR_CONFORM = False
AO_INTO_BASE = 0.25       # the projected painting already carries its painted occlusion; only deepen creases
# ART 2.0 skins re-colour the projected painting part by part (each part's paint moves by the skin role /
# base role gain; pipeline -> project.recolour), plus skin-only extras painted flat (SKIN_FLAT part -> role).
# "match" lists a skin's identity roles: those parts take the skin hex as their painted MEAN (see
# _install_skin_print), so the change reads across the whole figure. Palettes: _design/fighters/burdam.md §9.
SKINS: list = [
    {"id": "burdam_stillwater", "extra": {"reed_plates": True, "river_glass": True},
     "match": ["rust", "ironstone", "cloth", "cloth2", "under"],
     "card": {"primary": "#3E4A4C", "secondary": "#8FB3A8"},
     # cowl and pauldrons a step darker than the brief's table (the base's fix-pass value read: the mask is the
     # brightest value, framed by dark felt; wet basalt reads dark, not frosted)
     # (cool greys render ~10-25 L* lighter than warm ones under the splash's sky and the game's light, so
     # the identity hexes sit ~10 L* under the brief's table: the tunic and pauldrons read as wet basalt)
     # fix pass 4: the leggings at the brief's #343B3D a step up and the boots a step down (part means, see
     # _install_skin_print), so the feet stay the darkest band (the tan boots read lighter than the blue-grey legs)
     # fix pass 5: the tunic and the cowl two more steps down (the splash measured the tunic L* 66-68 against the
     # brief's 51: tunic, cowl and pauldrons merged into one teal-grey wash); the cowl the darkest of the three so
     # the mask pops, the pauldron tops the lightest (the brief: they step lighter to hold the top band)
     # fix pass 8 (the review: Stillwater kept the base's saturated gold mask, not the brief's paler #D4C9A9): the mask
     # a pale, less saturated ochre (b* ~+20 against the base's ~+42). The hex is the WHOLE mask's painted mean (the
     # inked eyes, tallies and the felt shadow under the chin included), so it sits well under the brief's lit-face
     # hex: #C4B592 put the lit face at L* 92-96 in the splash (bone-white, past the bible's 86), #A29678 the sunlit
     # crown at 91; #978B6F: the lit face L* 75 / b* +17 (the base's 67 / +41), the sunlit crown cap 88
     "parts": {"boots": "#30271F", "trousers": "#343E40", "mask": "#978B6F"},
     "palette": {"sandstone": "#D4C9A9", "cloth2": "#363D3A", "rust": "#6F7B7A", "stone": "#C4C8C4",
                 "ironstone": "#3E4A4C", "leather": "#554A3E", "cloth": "#45504E", "under": "#343B3D",
                 "reed": "#7D8460", "dawnglass": "#8FB3A8"}},
    {"id": "burdam_almanac", "extra": {"almanac_board": True}, "match": ["rust", "cloth", "ironstone"],
     "card": {"primary": "#4A453E", "secondary": "#D8CDB4"},
     # parchment a step under the mask and the tunic a step down (the mask stays the brightest value); fix pass 4:
     # the parchment three steps down (#C2B69B blew 38 % of the pauldrons past L* 86 in the splash's sun); fix pass
     # 5: the tunic two more steps down (#6B6256 measured L* 70-72 in the splash against the mid band's 45-65, brief
     # 52: the top and middle bands merged)
     "palette": {"cloth2": "#C6B9A5", "rust": "#A3987F", "stone": "#CFC8B8", "ironstone": "#2E2A26",
                 # fix pass 8: the tunic the brief's WARM grey (#58503F read olive-khaki), at the same value
                 # polish: the board's walnut frame a cooler, darker brown (#5A4639 read pink in the splash's sun)
                 "cloth": "#5D534A", "parchment": "#A3987F", "walnut": "#4B3E33"}},
]
ALMANAC_C = (-0.282, -0.212, 0.950)       # the board's centre (right hip), its yaw and half-size (m)
ALMANAC_RZ = -38.0
ALMANAC_HALF = (0.12, 0.16)
ALMANAC_PAGE_GAIN = 0.72                  # polish (the review: the board's page blew out to L* ~100 in the splash, it faces
                                          # the sun square, its rules barely visible): the page two steps under the
                                          # parchment pauldrons, the rules bolder
ALMANAC_TABS = ((0.42, 0.0, 0.13), (0.49, 0.01, 0.16), (0.56, 0.0, 0.12))   # ledger tabs: x, drop, length
SKIN_FLAT = {"reed_plates_R": "reed", "reed_plates_L": "reed", "river_glass_tier1": "dawnglass",
             "river_glass_tier2": "dawnglass", "river_glass_tier3": "dawnglass", "river_bezel_tier1": "ironstone",
             "river_bezel_tier2": "ironstone", "river_bezel_tier3": "ironstone", "almanac_wood": "walnut",
             "almanac_face": "parchment", "almanac_tabs": "parchment"}

HEIGHT = 2.56             # the cleaver tip in the concept (the projection plates' scale; mask crown 2.15)
PROJECTION = {"concept": "burdam", "height": HEIGHT}
NOISE = sdf.Noise(11)
VOXEL = 0.007
CLEAVER = ("blade", "heel", "gems", "haft", "pommel")      # prop-space parts (paint pose, see paint_object)
FIST_SCALE = 1.15         # fix pass 5: the fists and the open left hand a size up (the concept's huge fists; the
PALM_SCALE = 1.12         # review read average hands under the barrel chest)


# ── shaping helpers ───────────────────────────────────────────────────────────────────────────────
def rot(rx=0.0, ry=0.0, rz=0.0) -> np.ndarray:
    """axes (rows = local axes) for a primitive rotated by Rz @ Ry @ Rx (degrees, right-handed, world)."""
    return (sdf.rot_z(rz) @ sdf.rot_y(ry) @ sdf.rot_x(rx)).T


def folds(amp, freq, axis=0, phase=0.0, zfade=None):
    def fn(P):
        u = P[:, axis] * freq + phase + 0.6 * NOISE(P, 3.0)
        a = amp
        if zfade is not None:
            z0, z1 = zfade
            a = amp * np.clip((z0 - P[:, 2]) / (z0 - z1), 0.15, 1.0)
        return a * (np.abs(np.sin(u)) * 2.0 - 1.0) * -0.5
    return fn


def chips(amp, freq):
    def fn(P):
        return amp * np.clip(NOISE.ridged(P, freq, 3), 0, 1) - amp * 0.3
    return fn


def roofed(c, half, r, ry=0.0, front=45.0, back=40.0, ridge_y=0.0, disp=None, amp=0.010):
    """A plate slab rotated about Y (outer end down) whose top is a ridge along its length: the front and
    back faces slope (degrees from horizontal) so the front and back plates both paint the top, the way
    the concept shows each tier from slightly above. Returns [(op, prim, k)] for a Sculpt."""
    c = np.asarray(c, dtype=np.float64)
    R = sdf.rot_y(ry)
    box = RoundBox(c, half, r, axes=R.T)
    ops = [("add", box.displaced(disp, amp) if disp else box, 0.0)]
    top = c + R @ np.array([0.0, ridge_y, half[2]])
    for ang, sy in ((front, -1.0), (back, 1.0)):
        a = math.radians(ang)
        n = R @ np.array([0.0, sy * math.sin(a), math.cos(a)])
        ops.append(("inter", HalfSpace(top, n, 1.0), 0.03))
    return ops


def lumps(amp, freq):
    def fn(P):
        return amp * NOISE.fbm(P, freq, 3)
    return fn


def wraps(amp, freq, axis=2):
    """bandage / wrap ridges around a limb (bands along `axis`, slightly diagonal)"""
    def fn(P):
        return amp * np.sin(P[:, axis] * freq + 9.0 * (P[:, 0] + P[:, 1])) - amp * 0.2
    return fn


class Plate(sdf.Prim):
    """A plate in the cleaver's (u, v) plane, prop space (x = w, y = v, z = u - U_GRIP): a polygon outline
    extruded across w with a half-thickness `ht(u, v)` (a wedge for the blade), edges rounded by r."""

    def __init__(self, poly, ht, r=0.004, tmax=None, dw=0.0):
        self.dw = float(dw)
        self.poly = np.asarray(poly, dtype=np.float64)
        self.ht = ht if callable(ht) else (lambda u, v, _h=float(ht): np.full_like(u, _h))
        self.r = float(r)
        self.tmax = float(tmax if tmax is not None else (ht if not callable(ht) else 0.05))

    def bounds(self):
        lo = np.array([self.dw - self.tmax, self.poly[:, 1].min(), self.poly[:, 0].min() - cl.U_GRIP])
        hi = np.array([self.dw + self.tmax, self.poly[:, 1].max(), self.poly[:, 0].max() - cl.U_GRIP])
        return lo - self.r, hi + self.r

    def d(self, P):
        w, v, u = P[:, 0] - self.dw, P[:, 1], P[:, 2] + cl.U_GRIP
        d2 = cl.sd_polygon(u, v, self.poly) + self.r
        dz = np.abs(w) - self.ht(u, v) + self.r
        return np.minimum(np.maximum(d2, dz), 0.0) + np.hypot(np.maximum(d2, 0.0), np.maximum(dz, 0.0)) - self.r


class HeelGroove(sdf.Prim):
    """the heel's carved border: a 9 mm groove 2.4 cm inside its lower outline, 4 mm into both faces"""

    def bounds(self):
        P = np.asarray(cl.HEEL)
        return (np.array([-0.04, P[:, 1].min() - 0.01, P[:, 0].min() - cl.U_GRIP - 0.01]),
                np.array([0.04, P[:, 1].max() + 0.01, P[:, 0].max() - cl.U_GRIP + 0.01]))

    def d(self, P):
        w, v, u = P[:, 0], P[:, 1], P[:, 2] + cl.U_GRIP
        band = np.abs(cl.sd_polygon(u, v, cl.HEEL) + 0.024) - 0.0045
        return np.maximum(np.maximum(band, v - 0.07), 0.026 - np.abs(w))


class ShellStrip(sdf.Prim):
    """a strip of shell laid over the union of sculpts `under`: the points `off` +- half_t outside their surface,
    inside the vertical extrusion of the 2D strip a -> b (half-width hw, rounded ends): a plate that rests on
    whatever it lies over (skin extras: Stillwater's reed slats)"""

    def __init__(self, under, a, b, hw, off=0.012, half_t=0.009):
        self.under = list(under)
        self.a, self.b = np.asarray(a, dtype=np.float64), np.asarray(b, dtype=np.float64)
        self.hw, self.off, self.ht = float(hw), float(off), float(half_t)
        # the top surface's height under the strip on a 2 cm grid (u along, v across): the shell keeps to the
        # upward faces (it never drapes down a plate's vertical edge band)
        ab = self.b - self.a
        self.L = float(np.linalg.norm(ab))
        self.t = ab / max(self.L, 1e-9)
        self.nv = np.array([-self.t[1], self.t[0]])
        self.us = np.linspace(-0.02, self.L + 0.02, max(3, int(self.L / 0.02) + 3))
        self.vs = np.linspace(-self.hw - 0.02, self.hw + 0.02, max(3, int(2 * self.hw / 0.02) + 3))
        H = np.zeros((len(self.us), len(self.vs)))
        for i, u in enumerate(self.us):
            for j, v in enumerate(self.vs):
                H[i, j] = drop_onto(self.under, self.a + self.t * u + self.nv * v)[0][2]
        self.H = H
        self.z0, self.z1 = float(H.min()) - 0.06, float(H.max()) + off + half_t + 0.06

    def bounds(self):
        lo = np.minimum(self.a, self.b) - self.hw - 0.02
        hi = np.maximum(self.a, self.b) + self.hw + 0.02
        return np.r_[lo, self.z0], np.r_[hi, self.z1]

    def d(self, P):
        L, t = self.L, self.t
        q = P[:, :2] - self.a
        u = q @ t
        v = q @ self.nv
        du = np.abs(u - 0.5 * L) - 0.5 * L
        dv = np.abs(v) - self.hw
        d2 = np.minimum(np.maximum(du, dv), 0.0) + np.hypot(np.maximum(du, 0.0), np.maximum(dv, 0.0))
        dU = np.min([sculpt_d(S, P) for S in self.under], axis=0)
        fu = np.interp(u, self.us, np.arange(len(self.us)))
        fv = np.interp(v, self.vs, np.arange(len(self.vs)))
        i0 = np.clip(np.floor(fu).astype(np.int64), 0, len(self.us) - 2)
        j0 = np.clip(np.floor(fv).astype(np.int64), 0, len(self.vs) - 2)
        a_, b_ = fu - i0, fv - j0
        H = self.H
        h = (H[i0, j0] * (1 - a_) * (1 - b_) + H[i0 + 1, j0] * a_ * (1 - b_) + H[i0, j0 + 1] * (1 - a_) * b_
             + H[i0 + 1, j0 + 1] * a_ * b_)
        return np.maximum(np.maximum(d2, np.abs(dU - self.off) - self.ht), (h - 0.02) - P[:, 2])


def rest_frame(under, a, b, hw, lift: float = 0.004):
    """a rigid plank laid over the union of sculpts `under` along the 2D strip a -> b (half-width hw): the plane
    fitted to the top surface under the strip, raised until the plank rests on the highest points (never in
    the surface). Returns (origin at u=0 v=0 on the plank's underside, e_u, e_v, e_n, L): a flat slat seated
    like a shingle (fix pass 5: the ShellStrip's shell followed every step of the pauldron's tiers and the
    Stillwater reeds read as a crumpled green leaf in the splash)"""
    a, b = np.asarray(a, dtype=np.float64), np.asarray(b, dtype=np.float64)
    ab = b - a
    L = float(np.linalg.norm(ab))
    t = ab / max(L, 1e-9)
    nv = np.array([-t[1], t[0]])
    us = np.linspace(0.0, L, max(3, int(L / 0.02) + 2))
    vs = np.linspace(-hw, hw, max(3, int(2 * hw / 0.02) + 2))
    U, V = np.meshgrid(us, vs, indexing="ij")
    H = np.array([[drop_onto(under, a + t * u + nv * v)[0][2] for v in vs] for u in us])
    A = np.stack([np.ones(U.size), U.ravel(), V.ravel()], axis=1)
    ok = H.ravel() > 1.2 + 1e-4              # (fix pass 6) points past the surface's edge (an overhang) do not
    if ok.sum() < 4:                         # pull the plane down: fit and seat on the supported part only
        ok[:] = True
    c0, c1, c2 = np.linalg.lstsq(A[ok], H.ravel()[ok], rcond=None)[0]
    up = float(np.max(H.ravel()[ok] - A[ok] @ np.array([c0, c1, c2]))) + lift
    e_u = np.array([t[0], t[1], c1])
    e_u /= np.linalg.norm(e_u)
    e_v = np.array([nv[0], nv[1], c2])
    e_v -= e_u * float(e_v @ e_u)
    e_v /= np.linalg.norm(e_v)
    e_n = np.cross(e_u, e_v)
    if e_n[2] < 0:
        e_v, e_n = -e_v, -e_n
    o = np.array([a[0], a[1], c0 + up])
    return o, e_u, e_v, e_n, L / max(float(e_u[:2] @ t), 1e-6)


def slat_box(frame, u0: float, u1: float, hw: float, ht: float, rad: float, dz: float = 0.0) -> RoundBox:
    """a RoundBox on a rest_frame between u0 and u1 (metres along the plank), half-width hw, half-thickness ht,
    its underside dz above the frame's plane"""
    o, e_u, e_v, e_n, _L = frame
    c = o + e_u * (0.5 * (u0 + u1)) + e_n * (dz + ht)
    return RoundBox(c, (0.5 * (u1 - u0), hw, ht), rad, axes=np.stack([e_u, e_v, e_n]))


class Lens(sdf.Prim):
    """an almond (vesica) volume: the intersection of two spheres of radius R whose centres sit R - h above and
    below c along the frame's z: pointed ends along x (half-width sqrt(R^2 - (R - h)^2)), half-height h, and as
    deep along y as wide (the mask's eye recesses, fix pass 5)"""

    def __init__(self, c, R, h, axes=None):
        self.c = np.asarray(c, dtype=np.float64)
        self.ax = np.eye(3) if axes is None else np.asarray(axes, dtype=np.float64)
        self.R, self.h = float(R), float(h)
        self.w = math.sqrt(max(self.R ** 2 - (self.R - self.h) ** 2, 1e-9))

    def bounds(self):
        e = max(self.w, self.h) + 0.002
        return self.c - e, self.c + e

    def d(self, P):
        p = (P - self.c) @ self.ax.T
        off = self.R - self.h
        d1 = np.sqrt(p[:, 0] ** 2 + p[:, 1] ** 2 + (p[:, 2] - off) ** 2) - self.R
        d2 = np.sqrt(p[:, 0] ** 2 + p[:, 1] ** 2 + (p[:, 2] + off) ** 2) - self.R
        return np.maximum(d1, d2)


# the mask's almond eye recesses (fix pass 5): the concept's open almonds, ~9.6 x 4 cm, inner corners at the nose's
# root, tilted 14 degrees down toward it
EYES = ((-1, -0.075), (1, 0.051))


def eye_lens(sx: int, xc: float) -> "Lens":
    return Lens((xc, -0.190, 2.000), 0.068, 0.020, axes=rot(ry=-sx * 14.0))


class Hull(sdf.Prim):
    """The convex hull of a point set as an SDF: the smooth max (k) of its face planes (soft-cornered
    stone plates with flat faces; bmesh builds the hull)."""

    def __init__(self, pts, k=0.01):
        import bmesh
        pts = np.asarray(pts, dtype=np.float64)
        bm = bmesh.new()
        vs = [bm.verts.new(tuple(p)) for p in pts]
        bmesh.ops.convex_hull(bm, input=vs)
        bm.faces.ensure_lookup_table()
        c = pts.mean(axis=0)
        planes = {}
        for f in bm.faces:
            n = np.array(f.normal, dtype=np.float64)
            p0 = np.array(f.verts[0].co, dtype=np.float64)
            if np.dot(c - p0, n) > 0:
                n = -n
            key = tuple(np.round(np.r_[n, np.dot(n, p0)], 4))
            planes[key] = (p0, n)
        bm.free()
        self.planes = list(planes.values())
        self.k = float(k)
        self.lo, self.hi = pts.min(axis=0), pts.max(axis=0)

    def bounds(self):
        return self.lo - self.k, self.hi + self.k

    def d(self, P):
        d = None
        for p0, n in self.planes:
            di = (P - p0) @ n
            d = di if d is None else sdf.smax(d, di, self.k)
        return d


def tier_pts(top, thick, bevel: float = 0.0):
    """a stone plate: its top points and the same points `thick` lower (vertical edge bands); with `bevel`
    the top outline is inset that far and the full outline starts `bevel` lower: a chamfered stone slab"""
    top = np.asarray(top, dtype=np.float64)
    if bevel <= 0:
        return np.concatenate([top, top - np.array([0.0, 0.0, thick])])
    c = top.mean(axis=0)
    dxy = top[:, :2] - c[:2]
    L = np.maximum(np.linalg.norm(dxy, axis=1), 1e-6)
    inset = top.copy()
    inset[:, :2] = c[:2] + dxy * (np.maximum(L - bevel, 0.3 * L) / L)[:, None]
    return np.concatenate([inset, top - np.array([0.0, 0.0, bevel * 0.85]), top - np.array([0.0, 0.0, thick])])


def _uvw(u, v, w=0.0) -> np.ndarray:
    """cleaver (u, v, w) -> prop space"""
    return np.array([w, v, u - cl.U_GRIP], dtype=np.float64)


def blade_ht(u, v):
    """the blade's half-thickness: 2 cm at the spine, a honed edge band (the last fifth) down to 3.5 mm"""
    ve, vs = cl.v_edge(u), cl.v_spine(u)
    s = np.clip((v - ve) / np.maximum(vs - ve, 1e-3), 0.0, 1.0)
    band = np.clip(s / 0.2, 0.0, 1.0)
    body = np.clip((s - 0.2) / 0.8, 0.0, 1.0)
    tip = np.clip((1.437 - u) / 0.25, 0.35, 1.0)
    return (0.0035 + 0.0085 * band + 0.0080 * body) * (0.55 + 0.45 * tip)


# the right pauldron (polish pass): the cap's top outline (x, y, z) from the neck round the shoulder, a low crown on
# top; per-point thickness. The lame: a second plate over the outer upper arm, tucked under the cap's rim (its top
# outline; it hangs LAME_DROP and flares LAME_FLARE out).
# W5b (the verifier: from the front the cap still read as a short grey roll / bolster with a knob at its end, its
# 12-13 cm front face half under the carry fist; the concept paints a broad layered plate with a carved roundel, the
# fringe below): the cap is now the DOME over the shoulder top (its front pulled back), and a separate broad FRONT
# PLATE (part pauldron_face) stands in front of it where the concept paints it (measured on the plates' 5 cm grid:
# x -0.49..-0.20, top 1.78, bottom 1.59 inside, its outer corner flared down over the arm at 1.68): a flat chamfered
# slab, its face 0.33 m across and 0.20-0.24 m tall, tilted 13 degrees back (corners below on its outer face: inner-top
# under the cowl, outer-top, the outer flare, inner-bottom), its top edge standing 3-5 cm proud of the dome (a layered
# plate, not a roll), the carved roundel (12 cm) on the flat face's visible centre. The cowl overlaps its inner end, as
# in the concept. The lame flares further over the arm under the flare; the fringe stands off the sleeve below it.
PAULDRON_TOP = [(-0.170, -0.150, 1.790), (-0.340, -0.140, 1.772), (-0.530, -0.115, 1.700), (-0.585, 0.000, 1.678),
                (-0.528, 0.176, 1.688), (-0.340, 0.214, 1.745), (-0.170, 0.214, 1.776), (-0.360, 0.010, 1.798)]
PAULDRON_THICK = [0.090, 0.090, 0.080, 0.085, 0.085, 0.085, 0.085, None]
PAULDRON_BEVEL = 0.028
PAULDRON_BIND = ("dblend", "shoulder.R", "upper_arm.R", (-0.38, 0.0, 1.70), (-1.0, 0.0, -0.25), 0.02, 0.17)
PAULDRON_FACE = [(-0.205, -0.150, 1.795), (-0.485, -0.129, 1.785), (-0.555, -0.162, 1.628), (-0.242, -0.209, 1.546)]
PAULDRON_FACE_T = 0.050          # the slab's thickness behind its face
PAULDRON_FACE_BEVEL = 0.018      # the chamfer round the face
# hidden points behind the slab (its back joined to the dome, the shoulder and the chest: its edges never float)
PAULDRON_FACE_FILL = [(-0.210, -0.100, 1.780), (-0.465, -0.080, 1.745), (-0.515, -0.103, 1.627), (-0.247, -0.133, 1.552)]
# the plate rides the clavicle; only its outer flare follows the upper arm part way (a raised arm lifts it instead of
# poking the sleeve through), the roundel stays rigid
PAULDRON_FACE_BIND = ("dblend", "shoulder.R", "upper_arm.R", (-0.40, 0.0, 1.70), (-1.0, 0.0, -0.25), 0.05, 0.20)
LAME_TOP = [(-0.470, -0.150, 1.610), (-0.600, -0.112, 1.588), (-0.648, 0.000, 1.582), (-0.600, 0.112, 1.588),
            (-0.470, 0.150, 1.610)]
LAME_DROP, LAME_FLARE = 0.072, 0.022


def face_frame() -> tuple:
    """the front plate's roundel centre (on the face, 58 % out from the neck, half way down) and the face's normal"""
    IT, OT, OB, IB = (np.array(p, dtype=np.float64) for p in PAULDRON_FACE)
    n = np.cross(OT - IT, IB - IT)
    n /= np.linalg.norm(n)
    c = 0.5 * ((IT + 0.58 * (OT - IT)) + (IB + 0.58 * (OB - IB)))
    return c + n * 0.002, n


PAULDRON_ROUNDEL, PAULDRON_FACE_N = (tuple(float(x) for x in v) for v in face_frame())


def face_pts(corners=PAULDRON_FACE, T: float = PAULDRON_FACE_T, bevel: float = PAULDRON_FACE_BEVEL,
             fill=PAULDRON_FACE_FILL) -> list:
    """the front plate's hull: the face's corners inset by the bevel in its plane, the full outline the bevel behind
    it, the outline T behind (the slab's back) and the hidden fill points"""
    Q = np.asarray(corners, dtype=np.float64)
    n = np.asarray(PAULDRON_FACE_N, dtype=np.float64)
    c = Q.mean(axis=0)
    out = []
    for q in Q:
        d = q - c
        L = max(float(np.linalg.norm(d)), 1e-6)
        out.append(c + d * (max(L - bevel, 0.3 * L) / L))
        out.append(q - n * bevel * 0.85)
        out.append(q - n * T)
    return out + [np.asarray(f, dtype=np.float64) for f in fill]


def pauldron_pts(top, thick, bevel: float = PAULDRON_BEVEL) -> list:
    """a chamfered stone plate's hull points: the top outline inset by `bevel`, the full outline `bevel` lower, and
    each outline point `thick[i]` below its top (None: a top-only point, the crown)"""
    top = np.asarray(top, dtype=np.float64)
    ring = np.array([t is not None for t in thick])
    c = top[ring].mean(axis=0)
    out = []
    for p, t in zip(top, thick):
        d = p[:2] - c[:2]
        L = max(float(np.linalg.norm(d)), 1e-6)
        q = p.copy()
        q[:2] = c[:2] + d * (max(L - bevel, 0.3 * L) / L)
        out.append(q)
        if t is None:
            continue
        out.append(p - np.array([0.0, 0.0, bevel * 0.85]))
        out.append(p - np.array([0.0, 0.0, t]))
    return out


def lame_pts(top, drop: float = LAME_DROP, flare: float = LAME_FLARE, bevel: float = 0.02) -> list:
    """the lame's hull: its top outline (inset by the bevel toward the arm's axis), and the outline dropped `drop`
    and pushed `flare` out from the upper arm's axis (x -0.43, y 0)"""
    out = []
    for p in np.asarray(top, dtype=np.float64):
        r = np.array([p[0] + 0.43, p[1], 0.0])
        r /= max(float(np.linalg.norm(r)), 1e-6)
        out.append(p - r * bevel)
        out.append(p - np.array([0.0, 0.0, bevel * 0.8]))
        out.append(p + r * flare - np.array([0.0, 0.0, drop]))
    return out


# ── the sculpt ────────────────────────────────────────────────────────────────────────────────────
GEM_THICK = 0.046         # the inlays through the 3 cm heel (fix round 2: 3.8 -> 4.6 cm, 8 mm proud of each face: the rims catch
                          # the game camera at the low angles, the accent gate with the back-pointing carry)


def sculpts() -> list:
    """(name, Sculpt, voxel scale, material role, bind, tris, space) in build order; space 'world' (rest
    pose, metres, faces -Y) or 'prop' (the cleaver, mapped onto prop.R by model())."""
    out = []

    def part(name, S, role, bind, tris, vs=1.0, space="world"):
        out.append((name, S, vs, role, bind, tris, space))

    # MASK: a lacquered helmet-mask over the whole head (the back of the head is the mask's shell too)
    # one carved surface: skull, cheeks and chin are one volume cut by one face plane (no separate jaw)
    mask = Sculpt("mask")
    mask.add(Ellipsoid((-0.012, -0.005, 1.985), (0.142, 0.158, 0.172)), k=0.0)
    mask.add(RoundBox((-0.012, -0.03, 1.955), (0.118, 0.13, 0.16), 0.075), k=0.03)
    mask.add(RoundBox((-0.012, -0.10, 1.862), (0.096, 0.075, 0.055), 0.045), k=0.05)    # chin, flush below
    mask.inter(HalfSpace((0, -0.168, 0), (0, -1, 0), 1.0), k=0.035)                 # the flat lacquered face
    # fix pass 5 (the review read a knight's great-helm with a T-visor): the concept's FACE MASK, not a visor: a
    # frowning V brow (two halves, the inner ends low, meeting over the nose), almond (lens) eyes slanting down to
    # the nose, a triangular beak nose (narrow at the brow, broad at its base), raised cheekbone planes
    for sx in (-1.0, 1.0):
        bc = np.array([-0.012 + sx * 0.056, -0.163, 2.036])
        mask.add(RoundBox(bc, (0.056, 0.014, 0.009), 0.008, axes=rot(ry=-sx * 13.0)), k=0.02)   # brow half (a ridge)
        mask.add(RoundBox((-0.012 + sx * 0.072, -0.166, 1.953), (0.040, 0.006, 0.017), 0.006,
                          axes=rot(rx=-22.0, ry=-sx * 8.0)), k=0.03)                        # cheekbone plane
    mask.add(Hull([(-0.012, -0.164, 2.034), (-0.012, -0.176, 2.026), (-0.040, -0.168, 1.904), (0.016, -0.168, 1.904),
                   (-0.012, -0.198, 1.899), (-0.040, -0.150, 1.904), (0.016, -0.150, 1.904), (-0.012, -0.150, 2.034)],
                  k=0.005), k=0.012)                                                    # the beak nose (a wedge)
    for sx, xc in EYES:
        mask.sub(eye_lens(sx, xc), k=0.005)                                     # almond eyes, inner ends low
    mask.sub(Tube([(-0.083, -0.168, 1.853), (-0.045, -0.176, 1.874), (0.025, -0.176, 1.874), (0.062, -0.168, 1.853)],
                  [0.0065] * 4, k=0.004), k=0.004)                                     # the set frown
    mask.add(RoundBox((-0.012, 0.0, 1.80), (0.095, 0.10, 0.04), 0.03), k=0.02)          # neck plug under the cowl
    part("mask", mask, "sandstone", "bone:head", 1500, 0.6)

    # COWL: the bunched felt scarf, wider and lower over the right shoulder at the back
    cowl = Sculpt("cowl")
    cowl.add(Torus((-0.02, 0.0, 1.835), 0.175, 0.085, axes=np.diag([1.0, 1.0 / 0.95, 1.0]), rz=0.075), k=0.0)
    cowl.add(Torus((-0.03, 0.02, 1.735), 0.235, 0.09, axes=np.diag([1.0, 1.0 / 0.92, 1.0]), rz=0.075), k=0.06)
    cowl.add(Ellipsoid((-0.04, -0.185, 1.705), (0.22, 0.09, 0.085)), k=0.05)           # the front fold
    cowl.add(Ellipsoid((-0.02, -0.12, 1.79), (0.20, 0.10, 0.07)), k=0.05)
    cowl.add(Ellipsoid((-0.24, 0.15, 1.73), (0.24, 0.13, 0.12)), k=0.07)               # back drape, right
    cowl.add(Ellipsoid((-0.10, 0.19, 1.82), (0.24, 0.10, 0.11)), k=0.06)
    cowl.add(Ellipsoid((0.10, 0.12, 1.86), (0.12, 0.09, 0.08)), k=0.05)
    cowl.sub(Capsule((-0.012, -0.02, 1.80), (-0.012, -0.02, 2.2), 0.118), k=0.02)      # the head sits in it
    cowl.sub(RoundBox((-0.012, -0.27, 1.96), (0.135, 0.15, 0.13), 0.03), k=0.02)      # opened in front of the face
    cowl.add(Ellipsoid((-0.012, -0.15, 1.784), (0.13, 0.068, 0.040)), k=0.025)         # the felt roll the chin sits on
    part("cowl", _displaced(cowl, folds(0.012, 22.0, axis=2, phase=0.7)), "cloth2",
         ("zblend", "chest", "neck", 1.74, 1.90), 1450)

    # COAT (heat weights): a barrel chest over a narrow waist, heavy short sleeves
    coat = Sculpt("coat")
    coat.add(Ellipsoid((0.0, 0.0, 1.45), (0.31, 0.275, 0.24)), k=0.0)
    coat.add(Ellipsoid((0.0, 0.03, 1.58), (0.29, 0.24, 0.12)), k=0.08)
    coat.add(Ellipsoid((0.0, -0.005, 1.24), (0.262, 0.25, 0.13)), k=0.10)
    for sx in (-1, 1):
        coat.add(Sphere((sx * 0.405, 0.02, 1.53), 0.11), k=0.07)
        coat.add(FlatCapsule((sx * 0.45, 0.02, 1.50), (sx * 0.49, -0.01, 1.34), 0.125, 0.125, 0.115, 0.115,
                             side=(1, 0, 0)), k=0.035)
        coat.sub(RoundBox((sx * 0.322, 0.0, 1.33), (0.007, 0.10, 0.10), 0.006), k=0.012)   # the armpit crease
    part("coat", _displaced(coat, folds(0.008, 26.0, axis=2, phase=0.4)), "cloth", "coat", 2050)
    skirt = Sculpt("skirt")
    sk = FlatCapsule((0.0, 0.0, 0.62), (0.0, -0.005, 1.20), 0.43, 0.31, 0.30, 0.255, side=(1, 0, 0))
    skirt.add(sk.displaced(folds(0.016, 14.0, axis=0, phase=1.3, zfade=(1.05, 0.66)), 0.016), k=0.0)
    skirt.inter(HalfSpace((0, 0, 0.665), (0, 0, -1), 2.0), k=0.01)
    skirt.sub(RoundBox((-0.25, -0.30, 0.74), (0.006, 0.06, 0.10), 0.003), k=0.004)        # the front slit
    part("skirt", skirt, "cloth", "body", 1250)

    # BELTS (heat weights)
    belt = Sculpt("belt")
    belt.add(Torus((-0.015, -0.005, 1.095), 0.300, 0.024, axes=np.diag([1.0, 0.300 / 0.29, 1.0]) @ rot(ry=-8),
                   rz=0.042), k=0.0)                                                    # the slung hip belt:
    belt.inter(HalfSpace((0.0, 0.03, 0.0), (0.0, 1.0, 0.0), 1.0), k=0.03)              # front only (one belt behind)
    belt.add(Torus((0.0, -0.005, 1.235), 0.272, 0.028, axes=np.diag([1.0, 0.272 / 0.262, 1.0]), rz=0.063), k=0.0)
    belt.add(RoundBox((-0.10, -0.283, 1.235), (0.045, 0.014, 0.05), 0.008, axes=rot(rz=-18)), k=0.004)   # buckle
    part("belt", belt, "leather", "body", 820)

    # TALLY STICKS (rigid on the hips, no sway), fix pass 4: the concept's chunky carved sticks, not a fringe: a
    # bundle of five 4.2 cm wide, 2.8 cm thick, 0.21 m long sticks packed side by side left of the buckle, bound by
    # one cord near the top, and a bundle of four behind; each hangs on the coat's curve (skirt section ~0.34 x
    # 0.27 m at the sticks), turned to its tangent. The carved tally cuts are paint (tally_paint).
    tally = Sculpt("tally")

    def on_coat(x, sy):
        c = math.sqrt(max(0.0, 1.0 - (x / 0.345) ** 2))
        y = sy * (0.27 * c + 0.034)
        ang = -sy * math.degrees(math.atan2(0.27 * x / 0.345 ** 2, max(c, 0.2)))   # tangent turn about Z
        return y, ang
    for sy, sticks in ((-1, TALLY_FRONT_STICKS), (1, TALLY_BACK_STICKS)):
        cord = []
        for i, (x, ln, a) in enumerate(sticks):
            y, rz = on_coat(x, sy)
            z = 1.235 - ln
            tally.add(RoundBox((x, y + sy * 0.003 * (i % 2), z), (0.021, 0.014, ln), 0.008, axes=rot(ry=a, rz=rz)), k=0.0)
            cord.append((x, y + sy * 0.017, 1.205))
        tally.add(Tube(cord, [0.0075] * len(cord), k=0.004), k=0.004)                  # the binding cord
    part("tally", tally, "wood_dark", "bone:hips", 640, 0.6)

    # ARMS: wrapped forearms (heat weights), the gloved fists (rigid on the hands)
    fore = Sculpt("forearms")
    for sx in (-1, 1):
        fa = FlatCapsule((sx * 0.465, -0.012, 1.31), (sx * 0.518, -0.055, 1.08), 0.152, 0.142, 0.106, 0.108,
                         side=(1, 0, 0))                                  # fix pass 5: heavier (brief x1.3)
        fore.add(fa.displaced(wraps(0.006, 70.0), 0.007), k=0.0)
    part("forearms", fore, "leather", "coat", 900)
    fist = Sculpt("fist_R")
    c = np.array([-0.505, -0.075, 0.952])
    k_ = FIST_SCALE                                                   # fix pass 5: the brief's big fists (x1.55)
    # fix pass 6 (the review: the right fist a featureless blob): a sculpted gloved fist, the four curled fingers
    # as separate rolls with creases between them, knuckle bumps at their outer ends, a two-joint thumb laid
    # across the front of the first two fingers and a wrap cuff at the wrist
    fist.add(RoundBox(c, (0.090 * k_, 0.084 * k_, 0.084 * k_), 0.050 * k_), k=0.0)
    for i in range(4):                                                 # the finger rolls, facing front
        z = 0.054 - i * 0.036
        fist.add(Capsule(c + np.array((0.060, -0.078, z)) * k_, c + np.array((-0.058, -0.078, z)) * k_,
                         0.0245 * k_), k=0.006)
        fist.add(Sphere(c + np.array((-0.066, -0.066, z + 0.004)) * k_, 0.027 * k_), k=0.008)     # knuckle
    for i in range(3):                                                 # the creases between the rolls
        z = 0.054 - (i + 0.5) * 0.036
        fist.sub(Capsule(c + np.array((0.050, -0.104, z)) * k_, c + np.array((-0.080, -0.098, z)) * k_,
                         0.0055 * k_), k=0.004)
    fist.add(Capsule(c + np.array((0.086, -0.040, 0.072)) * k_, c + np.array((0.060, -0.098, 0.034)) * k_,
                     0.028 * k_), k=0.012)                             # thumb: the base on the palm's side
    fist.add(Capsule(c + np.array((0.060, -0.098, 0.034)) * k_, c + np.array((0.004, -0.108, 0.024)) * k_,
                     0.023 * k_), k=0.006)                             # its tip across the index and middle fingers
    fist.add(Torus(c + np.array((0.0, 0.0, 0.092)) * k_, 0.066 * k_, 0.010 * k_), k=0.006)       # the wrap cuff
    part("fist_R", fist, "leather", "bone:hand.R", 950)
    # the LEFT hand opens (the Settled Account reach, the victory's palm-up host): the back of the hand and
    # the thumb ride hand.L; the four fingers are one gloved slab on prop.L, modelled OPEN (hanging straight
    # from the palm) and curled into the fist by the clips (FIST_CURL on prop.L)
    palm = Sculpt("palm_L")
    c = np.array([0.520, -0.058, 1.000])
    k_ = PALM_SCALE
    palm.add(RoundBox(c, (0.066 * k_, 0.086 * k_, 0.062 * k_), 0.038 * k_), k=0.0)
    palm.add(Capsule(c + np.array((-0.050, -0.070, 0.015)) * k_, c + np.array((-0.072, -0.118, -0.050)) * k_,
                     0.027 * k_), k=0.02)                               # thumb
    part("palm_L", palm, "leather", "bone:hand.L", 380)
    fingers = Sculpt("fingers_L")                                      # four gloved fingers, a slight curl
    # fix pass 6 (the review: the open palm a flat mitten with stub fingers): four SEPARATE jointed fingers, a
    # gap between each, fanned a little, each a proximal and a distal segment curling toward the palm
    for i, fy in enumerate((-0.118, -0.080, -0.042, -0.006)):
        ln = (0.098, 0.108, 0.104, 0.088)[i] * PALM_SCALE            # (curled into the fist by prop.L: kept short)
        sp = (-0.012, -0.004, 0.004, 0.012)[i]                         # the fan
        a = np.array([0.530, -0.058 + (fy + 0.058) * PALM_SCALE * 1.10, 0.962 - 0.038 * (PALM_SCALE - 1.0)])
        j = a + np.array((-0.008, sp * 0.55, -0.56 * ln))
        t = j + np.array((-0.020, sp * 0.45, -0.44 * ln))
        r = (0.0200, 0.0205, 0.0200, 0.0180)[i] * PALM_SCALE
        fingers.add(Capsule(a, j, r), k=0.002)
        fingers.add(Capsule(j, t, r * 0.92), k=0.003)
        fingers.add(Sphere(j + np.array((0.004, 0.0, 0.0)), r * 1.04), k=0.004)          # the middle knuckle
    part("fingers_L", fingers, "leather", "bone:prop.L", 640)

    # FOREARM PLATES: the big carved vambrace on the left, an iron strip on the right (rigid on the forearms)
    vb = Sculpt("vambrace")
    outer = FlatCapsule((0.468, -0.012, 1.38), (0.515, -0.05, 1.135), 0.180, 0.169, 0.140, 0.142, side=(1, 0, 0))
    inner = FlatCapsule((0.468, -0.012, 1.44), (0.515, -0.05, 1.08), 0.150, 0.141, 0.107, 0.109, side=(1, 0, 0))
    vb.add(outer.displaced(chips(0.008, 8.0), 0.008), k=0.0)
    vb.sub(inner, k=0.004)
    vb.inter(HalfSpace((0.455, 0, 0), (-1, 0.0, 0), 1.0), k=0.012)                     # the front-outer shell
    vb.inter(HalfSpace((0, 0.07, 0), (0, 1, 0), 1.0), k=0.012)                         # wraps to the front
    # fix pass 5: below the elbow only (wrist to 1.27 m; its rounded cap reached 1.5 m, over the elbow, and met the
    # pauldron's lower tiers as one stone sleeve in the splash): the brown sleeve shows between them
    vb.inter(HalfSpace((0, 0, 1.27), (0, 0, 1), 1.0), k=0.012)
    vb.inter(HalfSpace((0, 0, 1.015), (0, 0, -1), 1.0), k=0.01)
    part("vambrace", vb, "rust", "bone:forearm.L", 450)
    fs = Sculpt("strap_plate")
    o2 = FlatCapsule((-0.468, -0.012, 1.30), (-0.522, -0.055, 1.02), 0.165, 0.154, 0.120, 0.123, side=(1, 0, 0))
    fs.add(o2, k=0.0)
    fs.sub(FlatCapsule((-0.468, -0.012, 1.35), (-0.522, -0.055, 0.97), 0.151, 0.141, 0.108, 0.111, side=(1, 0, 0)),
           k=0.003)
    fs.inter(HalfSpace((-0.565, 0, 0), (1, 0, 0), 1.0), k=0.01)
    part("strap_plate", fs, "rust", "bone:forearm.R", 200)

    # RIGHT PAULDRON (polish pass; the review: the weapon-side shoulder was a 31 x 19 x 7 cm board on the front of the
    # clavicle, a plank beside the huge left stack): the concept's layered pauldron that CAPS the shoulder. A broad
    # stone cap over the whole shoulder top (52 x 49 cm, on the clavicle like the stack's top tiers; its inner edge
    # tucks under the cowl), a deep carved front face with the concept's roundel, a second plate (the lame) over the
    # outer upper arm under the cap's rim (it rides the arm like tiers 3-4), and the slatted fringe under that. The
    # stack stays the bigger, stepped shoulder; this one is ONE domed plate: the asymmetry reads from above
    # W5b: the cap is the dome over the shoulder top (the roundel moved to the front plate, pauldron_face below)
    sp = Sculpt("shoulder_plate")
    sp.add(Hull(pauldron_pts(PAULDRON_TOP, PAULDRON_THICK), k=0.012).displaced(chips(0.007, 6.5), 0.007), k=0.0)
    # the cap's inner (neck) half rides the clavicle, its outer rim the upper arm (the shared pauldron blend): a
    # raised arm (the shoulder carry) lifts the rim with the sleeve under it instead of poking the sleeve through
    part("shoulder_plate", sp, "rust", PAULDRON_BIND, 560)
    fr = Sculpt("fringe")
    # the slatted fringe under the lame, round the front and outer side of the upper arm (rigid on it). W5b: 15 cm
    # slats (z 1.39-1.54) standing 2.5-4 cm off the sleeve, so ~12 cm hang clear below the lame (at the old radius
    # they sat half inside the sleeve)
    for i in range(7):
        a = -78.0 + i * 21.0                                           # around the arm's outer side, front -> back
        x = -0.462 - 0.160 * math.cos(math.radians(a))
        y = -0.005 + 0.160 * math.sin(math.radians(a))
        fr.add(RoundBox((x, y, 1.468 - 0.010 * (i % 2)), (0.011, 0.024, 0.075), 0.006,
                        axes=rot(ry=8.0, rz=-a)), k=0.0)
    part("fringe", fr, "leather", "bone:upper_arm.R", 300, 0.7)

    # LEFT PAULDRON: four stacked plates, rust-grey oxidised iron. Each plate is set diamond-wise on the
    # shoulder (corners inside / front / outside / back) with a pyramid or ridged top, the way the concept
    # shows them from both sides (the front and back plates each paint their own slopes).
    t1_top = [(0.36, 0.0, 1.97), (0.18, 0.0, 1.83), (0.40, -0.215, 1.69), (0.595, 0.0, 1.845), (0.42, 0.215, 1.68)]
    t1 = Sculpt("tier1")
    t1.add(Hull(tier_pts(t1_top, 0.07, 0.025), k=0.008).displaced(chips(0.007, 7.5), 0.007), k=0.0)
    t1.add(Hull(tier_pts([(0.23, -0.06, 1.975), (0.36, -0.03, 1.995), (0.37, 0.12, 1.985), (0.24, 0.10, 1.965),
                          (0.20, 0.02, 1.90)], 0.12), k=0.01).displaced(chips(0.008, 7.0), 0.008), k=0.01)  # inner collar
    ap = np.array(t1_top[0])
    panel = [ap + 0.62 * (np.array(q) - ap) + (0, 0, 0.004) for q in t1_top[1:]]
    t1.add(Hull(tier_pts([tuple(ap + (0, 0, 0.012))] + [tuple(q + (0, 0, 0.012)) for q in panel], 0.03), k=0.008),
           k=0.006)                                                     # the raised inner panel
    part("tier1", t1, "rust", "bone:shoulder.L", 620)
    t2 = Sculpt("tier2")
    t2_top = [(0.20, 0.0, 1.745), (0.40, 0.0, 1.80), (0.60, 0.0, 1.79), (0.79, 0.0, 1.672), (0.60, -0.24, 1.605),
              (0.60, 0.24, 1.605), (0.36, -0.22, 1.66), (0.36, 0.22, 1.66)]
    t2.add(Hull(tier_pts(t2_top, 0.085, 0.03), k=0.008).displaced(chips(0.007, 7.5), 0.007), k=0.0)
    part("tier2", t2, "rust", "bone:shoulder.L", 600)      # rigid: a blended slab shears into a crumple
    t3 = Sculpt("tier3")
    # tiers 3-4 ride the upper arm: their front / back corners stay short (a forward reach swings them down
    # under tier 2, where long corners poked out as spikes)
    t3_top = [(0.24, 0.0, 1.62), (0.45, 0.0, 1.645), (0.645, 0.0, 1.565), (0.48, -0.175, 1.50), (0.48, 0.175, 1.50)]
    t3.add(Hull(tier_pts(t3_top, 0.08, 0.028), k=0.008).displaced(chips(0.007, 7.5), 0.007), k=0.0)
    part("tier3", t3, "rust", "bone:upper_arm.L", 450)
    t4 = Sculpt("tier4")
    # (front / back corners pulled inside the sleeve: the back one poked through it as a pale chip at the elbow)
    t4_top = [(0.32, 0.0, 1.51), (0.48, 0.0, 1.525), (0.625, 0.0, 1.462), (0.49, -0.115, 1.432), (0.49, 0.115, 1.432)]
    t4.add(Hull(tier_pts(t4_top, 0.065, 0.022), k=0.008).displaced(chips(0.006, 7.5), 0.006), k=0.0)
    part("tier4", t4, "rust", "bone:upper_arm.L", 350)

    # LEGS: baggy dark trousers (heat weights), wrapped shins and boots
    legs = Sculpt("trousers")
    for sx in (-1, 1):
        legs.add(FlatCapsule((sx * 0.16, 0.0, 0.84), (sx * 0.22, -0.005, 0.44), 0.165, 0.155, 0.112, 0.11,
                             side=(1, 0, 0)), k=0.0)
        legs.add(Ellipsoid((sx * 0.207, -0.01, 0.55), (0.165, 0.150, 0.11)), k=0.06)
        legs.add(Torus((sx * 0.222, -0.005, 0.425), 0.092, 0.03, rz=0.026), k=0.03)              # the cuff roll
    part("trousers", _displaced(legs, folds(0.012, 18.0, axis=2, phase=2.1)), "under", "body", 920)
    boots = Sculpt("boots")
    for sx in (-1, 1):
        shin = FlatCapsule((sx * 0.225, -0.005, 0.43), (sx * 0.24, 0.02, 0.13), 0.098, 0.10, 0.088, 0.095,
                           side=(1, 0, 0))
        boots.add(shin.displaced(wraps(0.006, 55.0), 0.007), k=0.0)
        R = rot(rz=sx * 12.0)
        c0 = np.array([sx * 0.255, -0.06, 0.0])

        def at(dx, dy, dz, _c=c0, _R=R):
            return _c + _R.T @ np.array([dx, dy, dz])
        boots.add(RoundBox(at(0.0, 0.0, 0.074), (0.086, 0.16, 0.058), 0.04, axes=R), k=0.05)      # the upper
        boots.add(Ellipsoid(at(0.003, -0.13, 0.05), (0.083, 0.085, 0.048), axes=R), k=0.03)        # the toe box
        boots.add(Ellipsoid((sx * 0.24, 0.03, 0.12), (0.095, 0.10, 0.08)), k=0.04)        # heel / ankle
        boots.add(RoundBox(at(0.0, -0.025, 0.013), (0.084, 0.188, 0.013), 0.010, axes=R), k=0.018)   # flat sole, flush
    boots.inter(HalfSpace((0, 0, 0.0), (0, 0, -1), 2.0), k=0.0)
    part("boots", boots, "leather", "body", 1000)

    # THE CLEAVER (prop space; see proto/burdam_cleaver.py)
    blade = Sculpt("blade")
    blade.add(Plate(cl.blade_poly(), blade_ht, r=0.0025, tmax=0.022), k=0.0)
    part("blade", blade, "stone", "bone:prop.R", 1000, 0.6, "prop")
    heel = Sculpt("heel")
    heel.add(Plate(cl.HEEL, 0.030, r=0.008), k=0.0)
    for poly in cl.notch_polys():                                      # the five scalloped bites (tallies)
        heel.sub(Plate(poly, 0.06, r=0.0), k=0.004)
    # (the inlays sit proud on the faces, their settings and the border groove are paint: the game mesh is
    # decimated to a few hundred triangles, which turns carved rings and grooves into spikes)
    heel.add(Torus(_uvw(-0.012, 0.0), 0.038, 0.013, axes=np.eye(3)), k=0.006)          # the haft collar
    part("heel", heel, "ironstone", "bone:prop.R", 820, 0.6, "prop")
    gems = Sculpt("gems")
    # fix pass 5: FIVE spaced inlays (the concept), one diamond set under each bite; no ember cores in the bites
    # (core + hanging diamond read as ten cells, a zipper down the spine); fix pass 6: small diamonds set IN the dark
    # band (stone all round them) and the concept's blue gem in the pommel
    for poly in cl.gem_polys():                                        # one diamond per notch, under its bite
        gems.add(Plate(poly, GEM_THICK, r=0.004), k=0.0)                   # proud of the setting (decimation-safe;
                                                                           # fix pass 8: 8 mm proud, its rim lit too)
    gems.add(Plate(_diamond(cl.POMMEL_U, 0.0, *cl.POMMEL_GEM), 0.040, r=0.004), k=0.0)
    # fix pass 8: no lit linings in the bites' floors any more (passes 6-7 lined each bite: with the diamond under it
    # that made two staggered rows, ten lit marks plus the pommel gem, a white piano-key strip in the player tint);
    # the bites are dark cuts and the five diamonds (a size up) carry the accent alone, the concept's read
    part("gems", gems, "accent", "bone:prop.R", 640, 0.6, "prop")
    haft = Sculpt("haft")
    hf = Capsule(_uvw(cl.HAFT_U0, 0.0), _uvw(0.01, 0.0), 0.037)
    haft.add(hf.displaced(lambda P: 0.004 * np.sin((P[:, 2] + 0.5 * P[:, 0]) * 95.0), 0.004), k=0.0)
    for uu in (-0.25, -0.36):                                          # leather binding rings on the haft
        haft.add(Torus(_uvw(uu, 0.0), 0.039, 0.008, axes=np.eye(3)), k=0.004)
    part("haft", haft, "leather", "bone:prop.R", 480, 0.7, "prop")
    pom = Sculpt("pommel")
    pom.add(Plate(_diamond(cl.POMMEL_U, 0.0, 0.080, 0.070), 0.034, r=0.012), k=0.0)
    pom.add(Capsule(_uvw(cl.HAFT_U0 - 0.02, 0.0), _uvw(cl.HAFT_U0 + 0.025, 0.0), 0.042), k=0.01)
    for side in (-1, 1):                                               # the gem's carved setting, a bevel round it
        pom.sub(Plate(_diamond(cl.POMMEL_U, 0.0, cl.POMMEL_GEM[0] + 0.010, cl.POMMEL_GEM[1] + 0.010), 0.006,
                      r=0.002, dw=side * 0.034), k=0.003)
    part("pommel", pom, "ironstone", "bone:prop.R", 300, 0.6, "prop")
    # the right pauldron's second plate (polish pass), after the cleaver so earlier part ids stay put (the proto
    # tools read the cached build by part index): over the outer upper arm under the cap's rim, rigid on the arm
    lame = Sculpt("pauldron_lame")
    lame.add(Hull(lame_pts(LAME_TOP), k=0.010).displaced(chips(0.006, 7.0), 0.006), k=0.0)
    part("pauldron_lame", lame, "rust", "bone:upper_arm.R", 260)
    # W5b: the right pauldron's broad FRONT PLATE (see PAULDRON_FACE), last so earlier part ids stay put: a flat
    # chamfered slab with the roundel CARVED into its face (a 12 cm ring groove round a dished centre; the paint cuts
    # the rings, stone_paint): a raised ring and boss read as a nut / knob on the plate's end from the side
    pf = Sculpt("pauldron_face")
    pf.add(Hull(face_pts(), k=0.010).displaced(chips(0.005, 6.5), 0.005), k=0.0)
    rc, rn = np.array(PAULDRON_ROUNDEL), np.array(PAULDRON_FACE_N)
    rax = sdf.frame(rn, (1.0, 0.0, 0.0))                              # rows: across, up the face, out of the face
    pf.sub(Torus(rc + rn * 0.002, 0.050, 0.0075, axes=rax), k=0.004)   # the carved ring groove
    pf.sub(Sphere(rc + rn * 0.060, 0.064), k=0.006)                    # ... round a shallow dished centre
    part("pauldron_face", pf, "rust", PAULDRON_FACE_BIND, 440)
    return out


# the tally bundles: (x of the stick's centre, half-length, tilt in degrees); the front bundle left of the buckle
TALLY_FRONT_STICKS = [(0.105, 0.105, 3.0), (0.149, 0.112, -2.0), (0.193, 0.100, 2.0), (0.237, 0.108, -3.0),
                      (0.281, 0.102, 2.0)]
TALLY_BACK_STICKS = [(0.150, 0.100, -2.0), (0.194, 0.108, 3.0), (0.238, 0.098, -2.0), (0.282, 0.104, 2.0)]


def _diamond(u, v, a, b) -> list:
    return [(u + a, v), (u, v + b), (u - a, v), (u, v - b)]


def _displaced(S: Sculpt, fn, amp: float = 0.012) -> Sculpt:
    """the same op list with every ADD displaced by fn (cloth folds over a whole garment)"""
    out = Sculpt(S.name)
    for op, prim, k, tag in S.ops:
        if op == "add":
            prim = prim.displaced(fn, amp)
        out.ops.append((op, prim, k, tag))
    return out


def skin_extras(extra: dict) -> list:
    """skin-only geometry (brief section 9): Stillwater's rigid reed plates fanned over each shoulder and the
    river-glass inlays set in the pauldron tiers; Almanac's rigid board hung at the belt on the right"""
    out = []
    if extra.get("reed_plates"):
        # three rigid reed plates per shoulder (2 cm thick, no sway). Fix pass 6 (the review: the pass-5 slats read as
        # flat olive planks / a taped strap lying on the pauldron): a FAN, the brief's "fanned over each shoulder":
        # three tapering plates bound at one root by the neck, splayed 28 degrees apart and running out PAST the
        # shoulder's edge (the fan's tips break the pauldron's outline from the game camera), each seated on the high
        # points under it (rest_frame), stacked like shingles, cut nodes across, one lashing round the root
        parts_by = {nm: S for (nm, S, *_r) in sculpts()}
        for side in ("L", "R"):
            reeds = Sculpt(f"reed_plates_{side}")
            # (the fan lies on the stack's OUTER slope, past the top tier's ridge: rooted on the ridge the plates
            # rose toward the neck and read as sticks from the splash camera)
            if side == "L":
                under, bone, sx = [parts_by["tier1"], parts_by["tier2"]], "shoulder.L", 1.0
                root, fans, Ls = np.array([0.47, 0.0]), (-26.0, 0.0, 26.0), (0.32, 0.36, 0.32)
            else:
                under, bone, sx = ([parts_by["cowl"], parts_by["coat"], parts_by["shoulder_plate"]]
                                   + ([parts_by["pauldron_face"]] if "pauldron_face" in parts_by else [])), "shoulder.R", -1.0
                root, fans, Ls = np.array([-0.32, 0.0]), (24.0, 0.0, -24.0), (0.30, 0.33, 0.30)
            for k, (fan, Lp) in enumerate(zip(fans, Ls)):
                dxy = np.array([sx * math.cos(math.radians(fan)), math.sin(math.radians(fan))])
                a = root + dxy * 0.01
                b = a + dxy * Lp
                fr = rest_frame(under, a, b, 0.060, lift=0.003 + 0.006 * (k == 1))
                L = fr[4]
                for (u0, u1, hw) in ((0.0, 0.42 * L, 0.036), (0.36 * L, 0.76 * L, 0.048), (0.70 * L, L, 0.058)):
                    reeds.add(slat_box(fr, u0, u1, hw, 0.010, 0.006), k=0.006)       # the plate, tapering out
                for f in (0.34, 0.62, 0.88):              # the cut nodes across the plate, a touch proud
                    hw = 0.036 + (0.058 - 0.036) * f + 0.002
                    reeds.add(slat_box(fr, f * L - 0.008, f * L + 0.008, hw, 0.012, 0.005, dz=-0.002), k=0.003)
            fr0 = rest_frame(under, root - np.array([sx * 0.02, 0.0]), root + np.array([sx * 0.06, 0.0]), 0.07,
                             lift=0.010)
            reeds.add(slat_box(fr0, 0.0, 0.05, 0.080, 0.016, 0.008, dz=-0.008), k=0.004)   # the lashing at the root
            # (polish: the right fan follows the cap's own blend, its outer half rises with the arm like the cap's rim)
            out.append((f"reed_plates_{side}", reeds, 0.6, "wood", PAULDRON_BIND if side == "R" else f"bone:{bone}", 900,
                        "world"))
    if extra.get("river_glass"):
        # river-glass shards set into the pauldron tiers' slopes (front and back): long irregular slivers in
        # a thin basalt bezel, laid along each tier's edge; glossy, never emissive. Seated on the CURRENT tier
        # surfaces (found by bisection on the tier SDFs), so they follow the tier shapes.
        tiers = {nm: S for (nm, S, *_r) in sculpts() if nm.startswith("tier")}
        # fix pass 5: set in the tiers' 8 cm SIDE BANDS, front and back (on the slopes the reed slats covered them:
        # the review found the river-glass barely visible), each sliver laid along its band
        spots = {"tier1": [((0.40, -0.10, 1.645), (0.1, -1.0, 0.0), 0.0), ((0.42, 0.10, 1.64), (0.1, 1.0, 0.0), 0.0)],
                 "tier2": [((0.60, -0.12, 1.56), (0.12, -1.0, 0.0), 0.0), ((0.60, 0.12, 1.56), (0.12, 1.0, 0.0), 0.0)],
                 "tier3": [((0.48, -0.08, 1.46), (0.1, -1.0, 0.0), 0.0), ((0.48, 0.08, 1.46), (0.1, 1.0, 0.0), 0.0)]}
        bones = {"tier1": "shoulder.L", "tier2": "shoulder.L", "tier3": "upper_arm.L"}
        for tier, pts in spots.items():
            g, bz = Sculpt(f"river_glass_{tier}"), Sculpt(f"river_bezel_{tier}")
            for (p0, n0, spin) in pts:
                p, n = seat(tiers[tier], p0, n0)
                F_ = rot(rz=spin) @ sdf.frame(n, (1.0, 0.0, 0.0))       # rows: along the shard, across, normal
                shard = [(-0.100, 0.004), (-0.032, 0.024), (0.056, 0.019), (0.106, -0.002), (0.029, -0.021),
                         (-0.064, -0.017)]                  # 21 x 4.5 cm: fits the 8 cm band with its bezel
                pts3 = [p + F_.T @ np.array([u, v, w]) for (u, v) in shard for w in (-0.002, 0.004)]
                g.add(Hull(pts3, k=0.003), k=0.0)
                ring = [p + F_.T @ np.array([u * 1.18 + np.sign(u) * 0.006, v * 1.5 + np.sign(v) * 0.004, w])
                        for (u, v) in shard for w in (-0.006, 0.0025)]
                bz.add(Hull(ring, k=0.003), k=0.0)
            out.append((f"river_bezel_{tier}", bz, 0.5, "ironstone", f"bone:{bones[tier]}", 140, "world"))
            out.append((f"river_glass_{tier}", g, 0.5, "dawnglass", f"bone:{bones[tier]}", 140, "world"))
    if extra.get("almanac_board"):
        # a carved walnut board with a parchment face, hung from the belt on the right hip by two leather loops; rigid
        # on the hips. Fix pass 6 (the review: the deluxe tier read as a recolour plus a small white card): the board
        # a size up (24 x 32 cm, the brief's 20 x 26 read as a card), a raised walnut frame round the page and a
        # carved knob; and three parchment ledger tabs hanging from the stacked pauldron's middle tier like
        # bookmarks (rigid, ruled), so the deluxe set reads at the top band too
        R = rot(rz=ALMANAC_RZ, rx=-6.0)
        n = -R[1]                                      # the face looks out from the right hip
        c = np.array(ALMANAC_C)
        hw, hh = ALMANAC_HALF
        wood, face = Sculpt("almanac_wood"), Sculpt("almanac_face")
        wood.add(RoundBox(c, (hw, 0.013, hh), 0.008, axes=R), k=0.0)
        for (dx, dz, ex, ez) in ((0.0, hh - 0.012, hw, 0.013), (0.0, -hh + 0.012, hw, 0.013),
                                 (hw - 0.012, 0.0, 0.013, hh), (-hw + 0.012, 0.0, 0.013, hh)):
            wood.add(RoundBox(c + R.T @ np.array([dx, -0.012, dz]), (ex, 0.008, ez), 0.005, axes=R), k=0.003)
        wood.add(Sphere(c + R.T @ np.array([hw - 0.03, -0.022, 0.0]), 0.016), k=0.004)      # the carved knob
        for dx in (-0.07, 0.07):
            p0 = c + R.T @ np.array([dx, 0.0, hh])
            wood.add(Torus(p0 + (0, 0, 0.03), 0.030, 0.009, axes=R @ rot(ry=90.0)), k=0.004)
        face.add(RoundBox(c + n * 0.013, (hw - 0.024, 0.004, hh - 0.024), 0.003, axes=R), k=0.0)
        out.append(("almanac_wood", wood, 0.6, "wood_dark", "bone:hips", 420, "world"))
        out.append(("almanac_face", face, 0.6, "sandstone", "bone:hips", 140, "world"))
        tiers = {nm: S for (nm, S, *_r) in sculpts() if nm.startswith("tier")}
        tabs = Sculpt("almanac_tabs")
        for (x0, dz, ln) in ALMANAC_TABS:
            p, nrm = seat(tiers["tier2"], (x0, -0.10, 1.565), (0.0, -1.0, 0.0))
            down = np.array([0.0, 0.0, -1.0])
            down = down - nrm * float(down @ nrm)
            down /= np.linalg.norm(down)
            across = np.cross(nrm, down)
            top = p + nrm * 0.004 + down * (dz - 0.02)
            ctr = top + down * (0.5 * ln)
            tabs.add(RoundBox(ctr, (0.026, 0.004, 0.5 * ln), 0.003, axes=np.stack([across, nrm, down])), k=0.0)
        out.append(("almanac_tabs", tabs, 0.5, "sandstone", "bone:shoulder.L", 160, "world"))
    return out


def sculpt_d(S: Sculpt, P) -> np.ndarray:
    """a Sculpt's signed distance at points P (n, 3), the op list in order (no grid)"""
    P = np.atleast_2d(np.asarray(P, dtype=np.float64))
    D = np.full(len(P), 1e3)
    for op, prim, k, _ in S.ops:
        di = prim.d(P)
        D = sdf.smin(D, di, k) if op == "add" else (sdf.smax(D, -di, k) if op == "sub" else sdf.smax(D, di, k))
    return D


def drop_onto(Ss: list, xy, top: float = 2.4, bottom: float = 1.2) -> tuple:
    """the highest surface point of the union of sculpts Ss under (x, y) (a downward ray) and its normal"""
    def d(P):
        return np.min([sculpt_d(S, P) for S in Ss], axis=0)
    zs = np.linspace(top, bottom, 241)
    P = np.stack([np.full_like(zs, xy[0]), np.full_like(zs, xy[1]), zs], axis=1)
    D = d(P)
    inside = np.nonzero(D < 0)[0]
    if not len(inside):
        p = np.array([xy[0], xy[1], bottom])
        return p, np.array([0.0, 0.0, 1.0])
    hi, lo = zs[max(inside[0] - 1, 0)], zs[inside[0]]
    for _ in range(30):
        mid = 0.5 * (hi + lo)
        if d(np.array([[xy[0], xy[1], mid]]))[0] < 0:
            lo = mid
        else:
            hi = mid
    p = np.array([xy[0], xy[1], 0.5 * (hi + lo)])
    e = 0.003
    g = np.array([d(np.array([p + np.eye(3)[i] * e]))[0] - d(np.array([p - np.eye(3)[i] * e]))[0] for i in range(3)])
    return p, g / max(np.linalg.norm(g), 1e-9)


def seat(S: Sculpt, p0, n0) -> tuple:
    """the surface point of S along the ray p0 + t n0 (bisection) and the surface normal there"""
    p0, n = np.asarray(p0, dtype=np.float64), np.asarray(n0, dtype=np.float64)
    n = n / np.linalg.norm(n)
    lo, hi = -0.2, 0.3
    for _ in range(40):
        mid = 0.5 * (lo + hi)
        if sculpt_d(S, p0 + n * mid)[0] < 0:
            lo = mid
        else:
            hi = mid
    p = p0 + n * lo
    e = 0.002
    g = np.array([sculpt_d(S, p + np.eye(3)[i] * e)[0] - sculpt_d(S, p - np.eye(3)[i] * e)[0] for i in range(3)])
    return p, g / max(np.linalg.norm(g), 1e-9)


# ── rig sockets ───────────────────────────────────────────────────────────────────────────────────
def _prop_world(info) -> np.ndarray:
    return np.array(rig.prop_matrix(info, "prop.R"))


def rig_extras(ctx) -> None:
    M = _prop_world(ctx.info)
    _STATE["prop"] = M

    def w(p):
        return tuple((M @ np.r_[p, 1.0])[:3])
    tip = w(_uvw(1.437, 0.012))
    notch = w(_uvw(0.25, 0.014))
    axis = M[:3, 2] * 0.08
    rig.add_socket(ctx.info, "x_blade_tip", "prop.R", tip, tuple(axis))
    rig.add_socket(ctx.info, "x_notch_mid", "prop.R", notch, tuple(axis))


_STATE: dict = {}
# texel share: the blade's honed rim and chips, and the scored mask, carry the read up close
UV_WEIGHTS = {"blade": 1.6, "mask": 1.35, "heel": 1.2}


def model(ctx) -> list:
    P = []
    M = _STATE.get("prop")
    if M is None:
        M = _STATE["prop"] = _prop_world(ctx.info)
    extra = (ctx.skin or {}).get("extra") or {}
    _STATE["skin"] = ctx.skin
    for name, S, vs, role, bind, tris, space in sculpts() + skin_extras(extra):
        v, q = S.mesh(VOXEL * vs)
        if space == "prop":
            v = v @ M[:3, :3].T + M[:3, 3]
        ob = sdf.to_object(f"{name}_high", v, q, ctx.col)
        ob.data.materials.append(ctx.mats[role])
        P.append(fighter.Part(name, high=ob, tris=tris, bind=bind, uv_weight=UV_WEIGHTS.get(name, 1.0)))
    return P


def extra_materials(ctx) -> dict:
    """the oxidised-iron `rust` role (pauldrons, vambrace, plates): matte honed stone, non-metallic; the
    cleaver's `stone` honed smooth (the shared honed stone's pore bump bakes a sandpaper speckle into a thin
    blade's normals) and the lacquered mask matte"""
    stone = materials.honed_stone("stone", ctx.palette, "stone", ctx.gradient, rough=0.8, chisel=0.35)
    mask = materials.honed_stone("sandstone", ctx.palette, "sandstone", ctx.gradient, rough=0.8, chisel=0.5, veins=0.2)
    for m, k in ((stone, 0.015), (mask, 0.04)):
        for n in m.node_tree.nodes:
            if n.type == "BUMP":
                n.inputs["Strength"].default_value = k
    # ironstone (the cleaver's spine band, the pommel) matte: a honed sheen turned the dark band sky-grey in
    # the portrait's key light
    return {"rust": materials.honed_stone("rust", ctx.palette, "rust", ctx.gradient, rough=0.74, chisel=0.8,
                                          speckle=0.5), "stone": stone, "sandstone": mask,
            "ironstone": materials.honed_stone("ironstone", ctx.palette, "ironstone", ctx.gradient, rough=0.9,
                                               chisel=0.4),
            # waxed leather with a soft sheen only (rough 0.5 put white smears on the boot toes in the splash)
            "leather": materials.waxed_leather("leather", ctx.palette, "leather", ctx.gradient, rough=0.78)}


# ── motion: the cleaver rests on the right shoulder; bespoke clips for every role ─────────────────
# AimRoll: anim.Aim points the held item's axis with the minimal wrist turn, which leaves the blade's roll
# to chance; a cleaver needs its flat (and its edge) facing a chosen way. AimRoll adds `up`, where the
# blade's flat normal (prop +X) should face; anim._solve_aim is wrapped here to roll the hand about the
# blade axis after the shared aim (the shared library is untouched; installed by this module).
from dataclasses import dataclass  # noqa: E402

from mathutils import Matrix, Quaternion, Vector  # noqa: E402

V = Vector
HT = anim.HandTarget
L_ARM = PROPORTIONS["arm"]


@dataclass
class AimRoll(anim.Aim):
    up: tuple = (0.0, 0.0, 1.0)

    def lerp(self, o, t):
        b = anim.Aim.lerp(self, o, t)
        t = max(0.0, min(1.0, t))
        up = self.up
        if isinstance(o, AimRoll):
            a, c = V(self.up).normalized(), V(o.up).normalized()
            up = tuple((a.slerp(c, t) if a.dot(c) > -0.999 else a.lerp(c, t) + a.orthogonal() * 1e-3).normalized())
        return AimRoll(b.dir, b.weight, up)

    def mirrored(self):
        return AimRoll((-self.dir[0], self.dir[1], self.dir[2]), self.weight, (-self.up[0], self.up[1], self.up[2]))


def _install_aim_roll() -> None:
    if getattr(anim._solve_aim, "_burdam", False):
        return
    orig = anim._solve_aim

    def solve(skel, pose, M, side, am):
        orig(skel, pose, M, side, am)
        if not isinstance(am, AimRoll) or am.weight <= 0:
            return
        hand, prop = f"hand.{side}", f"prop.{side}"
        M2 = skel.fk(pose)
        R = M2[prop].to_3x3()
        axis = R.col[1].normalized()
        cur = R.col[0].normalized()
        want = V(am.up)
        want = want - axis * want.dot(axis)
        if want.length < 1e-5:
            return
        want.normalize()
        ang = math.atan2(cur.cross(want).dot(axis), cur.dot(want)) * am.weight
        new = Matrix.Rotation(ang, 3, axis) @ M2[hand].to_3x3()
        Ph = (M2[skel.parent[hand]] @ skel.local[hand]).to_3x3()
        pose[hand] = skel.euler_of(Ph.inverted() @ new, pose.get(hand))

    solve._burdam = True
    anim._solve_aim = solve


_install_aim_roll()


def _P(**kw) -> dict:
    return anim.P(**kw)


FT = anim.FootTarget
# the shoulder carry (fix pass 4): the right fist at SHOULDER height in front of the right shoulder, the short haft
# resting on the right shoulder plate, the cleaver laid up and back behind the head to the upper left: heading 40
# degrees back from straight left, 38 degrees above horizontal (a ~46 degree diagonal bar in the front view and
# ~52 degrees on screen from the game camera: the brief's hook), the tip ~0.5 m over the crown behind. The game's health bar sits 0.35 m over art.height: the
# search (proto/burdam_carry.py: wrist x heading x elevation, the rigid cleaver posed by FK against the guard-posed
# torso, no mask / cowl hits, the haft within 2 cm of the plate's top) puts 72-100 % of the blade in view around
# the bar (art.height 2.16 + 0.35 m) at all eight facings, mean 87 %. The flat faces up and back (broad from
# the top-down camera), the notched spine out and back, the edge toward the neck.
# fix pass 5 (the review: in game the pass-4 carry lay almost flat right under the health bar, its tip past the bar's
# right end like a UI pointer): re-searched with the SCREEN read from the 52 degree camera (proto/burdam_carry5.py:
# the on-screen angle, the tip beside the bar's end at the bar's height = the pointer, and the blade's visible read =
# its length outside the bar x its flat's width toward the camera), 24 facings. Only headings 40-60 degrees back from
# straight left clear the mask and cowl; below 44 degrees up the tip ends beside the bar's end in 2-3 facings (the
# pointer the review saw), a steep 55-60 degree blade points straight at this camera when turned toward the viewer
# (a 2 px stub) and reads as a sword held upright at eye level. Kept: heading 50, 44 degrees up, the fist over the
# right shoulder (the haft on the plate), the flat as level as the axis allows: no pointer facing, the brief's
# ~55 degree diagonal in the front view, the read 86 (the steep carry 69).
# fix pass 6 (the review: facing left, one of the two lane directions, the pass-5 blade lay flat behind the health
# bar; at eye level it stood near vertical beside the mask like a raised sword, or turned edge-on): the bar sits
# 0.35 m over art.height (2.16, measured without the cleaver: brief + three_load_test), so any blade that rises
# from the right shoulder above the crown crosses it. Re-searched by what the viewer SEES (proto/burdam_carry6.py:
# the blade's pixels left in view from the 52 degree camera after the bar, the name plate and the body in front
# take theirs, 24 facings; the eye-level front / portrait angle and visible share). The blade now lies LOW and
# long across the back: the fist beside the right temple, the haft and pommel down in front of the right shoulder,
# the cleaver heading 54 degrees back from straight left at 15 degrees up, its flat to the sky rolled 20 degrees
# toward the back, the tip ~2.2 m (at the crown, 1 m behind and left). Eye level: the concept's diagonal behind the
# head (~31 degrees in the front view, the tip to his upper left = the portrait's top right). Game: the blade in
# view 1600 px^2 in both lane facings (pass 5: 270 facing left), min 980 over 24 facings (pass 5: 270).
# In game that first pick still lay along the bar while he RAN toward the screen's left diagonal (WSW): any blade
# reaching ~1 m from the body above the shoulders rises through the bar in the facing where it points away from
# the camera, so the heading only chooses WHICH facing crosses it. Final: heading 36 (more across the shoulders,
# the concept's yoke behind the head, ~17 degrees in the front view), 10 up, roll 25, the fist 6 cm further back:
# facing W / WSW the blade now falls away under the bar (-39 / -24 degrees on screen), facing E a long diagonal
# past the bar's left end, the crossing facing moved to the one walking straight at the camera (a steep crossing).
# fix pass 8 (the review: from the front, the lobby and the select screen the yoke read as a nearly flat bar at mask
# height coming out of the back of the head, the heel hidden behind it, the haft under the fist; in game acceptable):
# the idle steepened as far as the bar allows (proto/burdam_carry6.py --pick around the yoke, --max-angw): every
# step up in the front view raises the blade toward the bar in the lane facing W (screen angle there: yoke -39, this
# carry -28, a 32 degree front view -21 = flat under the bar's end, the pointer again). Kept: the wrist 5 cm further
# out and 7 cm further back, heading 44, 14 degrees up, roll 25: the eye-level front angle 17 -> 25 degrees, the
# blade's share in view from the front 0.49 -> 0.73, the heel's 0.20 -> 0.65 (it no longer comes out of the back of
# the head: no cleaver point inside the mask / cowl, the yoke 92 with the guard pose), and in game the lane read 1338
# -> 1431 px^2, the worst facing 1018 -> 980, one pointer facing instead of three. The run keeps the yoke's grip
# (RUN_REL0, tuned in game). The lobby has no bar: it rests in the concept's steep carry (LOBBY_* below).
# POLISH PASS (the review: the hook was missing in idle and run, the yoke a flat bar behind the head from the front, a
# horizontal bar at mask height in game; the lobby's concept carry already read): the idle steepened to the concept's
# diagonal while keeping what the game camera sees (proto/burdam_carry6.py grid over wrist x heading x elevation x
# roll, eye-level front angle 38-62, ranked by the worst of 24 game facings): the fist up beside the back of the head
# (wrist (-0.56, 0.16, 1.88)), the cleaver heading 55 degrees back from straight left, 28 up, its flat rolled 5 toward
# the back (the grid's roll 20 showed the game camera less of the flat: blade in view mean 1307 -> 1387 px^2 at 5, and the
# heel's inlays, the accent, 1.28 % -> ~1.45 % in the three QA estimate). Eye level: the front view 25 -> 48 degrees (brief 55), the select-screen three-quarter 17 -> 34, the heel and
# haft fully in view (were 0.65 / 1.00); game: the worst facing 980 -> 900 px^2 of blade in view, mean 1339 -> 1307,
# one pointer facing as before (the 36-degree and steeper picks lost the worst facing to 590-710 behind the bar and
# name plate, the lobby's own carry to 0 facing W). The tip stands 2.66 m (the yoke 2.19).
# FIX ROUND 2 (the verifier: at the GAME camera the polish carry barely changed; walking toward the screen's left the
# blade lay as a horizontal bar along the health bar, heel and notches under it; judge the carry per facing at the game
# camera, not by the eye-level angle). The geometry: facing W his right side is the far side, so the fist at head
# height projects onto the bar whatever the carry; a blade heading to his LEFT comes toward the camera there and
# its rise cancels on screen (the polish carry: -6 degrees, 74 % of it in the bar's band). Only a blade pointing
# BACK rises on screen facing W (crossing out of the bar's end instead of lying along it) without losing facing E.
# proto/burdam_carry6.py --by-game (24 facings, blade px^2 in view after the bar + name plate + body, the share lying
# in the bar's band, the screen angle), grids over the fist x heading x elevation x roll (~20k carries; the steep
# 45-60 degree picks lost the W and N facings to the bar + name plate, 270-900 px^2): the fist out and back of the
# right shoulder at ear height (wrist (-0.60, 0.30, 1.72)), the cleaver heading straight back (88 degrees), 30 up,
# the flat rolled 5 toward the back. Game camera vs the polish carry: facing W 926 -> 1481 px^2 (lane facings
# 240-300 min 923 -> 1446), screen angle -6 -> +20 (rising out of the bar's right end; WNW +30), share in the bar's
# band 0.74 -> 0.42, E 1944 -> 1623 (still a long diagonal), S 1446 -> 1845, N 1118 -> 918 (the worst facing 923 ->
# 918), mean 1387 -> 1509, no pointer facing, no cleaver point in the head / torso. Eye level: the blade stands
# behind the right shoulder (front view ~vertical); the select screen / portrait keep the lobby's concept diagonal.
CARRY = dict(rel=(-0.447, 0.651, 0.33), pole=(-1.0, 0.25, -0.3), d=(0.03, 0.865, 0.5), up=(-0.07, 0.501, -0.863))
RUN_REL0 = (-0.447, 0.631, 0.256)      # the run's fist (fix round 2: the idle's, 4 cm lower)
BELT_L = (0.10, -0.16, -0.94)          # the free left fist at the belt


def carry_up(d) -> tuple:
    """the carry's flat normal for a blade axis d: the blade's width level (flat to the sky), the spine out back"""
    d = np.asarray(d, dtype=np.float64)
    d = d / np.linalg.norm(d)
    s_ = np.cross([0.0, 0.0, 1.0], d)
    s_ /= np.linalg.norm(s_)
    if s_[1] < 0:
        s_ = -s_
    return tuple(float(x) for x in np.cross(s_, d))


CARRY_ROLL = 25.0          # fix pass 6: the carry's flat rolled from level toward the back (proto/burdam_carry6.py)
RUN_ROLL = 5.0             # fix round 2: the run's flat as the idle's (roll 5; the steeper back-pointing carry)


def carry_flat(d, roll: float = CARRY_ROLL) -> tuple:
    """carry_up(d) rolled `roll` degrees about the blade axis (+ turns the flat toward the back)"""
    d = np.asarray(d, dtype=np.float64)
    d = d / np.linalg.norm(d)
    u = np.asarray(carry_up(d))
    r = math.radians(roll)
    return tuple(float(x) for x in u * math.cos(r) + np.cross(d, u) * math.sin(r))


RUN_D = (0.031, 0.890, 0.454)          # fix round 2: heading 88 / 27 up (the aim is in world space: the run's lean does not
                                       # tip it; 24 up rose only +16 / +5 degrees facing W / WSW, the idle's 30 up put the
                                       # blade's flat into the cowl at mid-stride).
                                       # Before: (0.539, 0.770, 0.342), the run's carry (polish: heading 55 / 20 up, the idle's 8 degrees lower: the run's
                                       # forward lean tips a back-pointing blade up; fix pass 6 was the yoke's, heading 42 /
                                       # 7 up); fix pass 6: heading 6 degrees further back and 3 lower than
                                       # the idle's, the fist 3-4 cm lower (the run's forward lean tips a back-pointing
                                       # blade up toward the health bar from the camera)
EDGE_DOWN = (1.0, 0.0, 0.0)            # flat normal for chops in the sagittal plane (the edge leads down)
FIST_CURL = (0.0, -100.0, 0.0)         # prop.L: the left fingers curled into the fist
OPEN = (0.0, 0.0, 0.0)                 # prop.L: the left hand open (the fingers as modelled)
GRIP2 = -0.15                          # the off hand on the haft, a fist below the main one (two-handed swings)
POMMEL_GRIP = cl.POMMEL_U - cl.U_GRIP - 0.06   # -0.36: the off hand over the pommel's crown (Stubborn, the channel)
BLADE_REACH = 1.437 - cl.U_GRIP        # the grip to the blade tip (m)
TIP_Z = -0.03                          # plants: the tip bites 3 cm into the ground
CHOP_TIP_Z = 0.015                     # chop keys (the strike timing then drops the hips ~3 cm into the hit)


def carry_ik(rel=None, pole=None, d=None, up=None, left=BELT_L, lpole=(0.9, 0.3, -0.3)) -> dict:
    """the shoulder carry: right fist over the right shoulder, the cleaver up and back behind the head to the
    upper left; left fist at the belt"""
    c = CARRY
    ik = {"hand.R": HT(rel=rel or c["rel"], pole=pole or c["pole"]), "aim.R": AimRoll(d or c["d"], 1.0, up or c["up"])}
    if left is not None:
        ik["hand.L"] = HT(rel=left, pole=lpole)
    return ik


def feet_b(l=(0.03, -0.05, 0.0), r=(-0.03, 0.06, 0.0), yl=8.0, yr=-14.0, pl=0.0, pr=0.0) -> dict:
    return {"foot.L": FT(l, pl, yl), "foot.R": FT(r, pr, yr)}


def stance_b(crouch: float = 1.0, feet=None) -> dict:
    """Burdam's planted stance: square and heavy, the weight on the back (right) foot; left fist closed"""
    torso = _P(hips=(3, 4, 0), spine=(3, -2, 0), chest=(2, -3, 0), neck=(-3, 1, 0), head=(-3, 2, 0), prop_L=FIST_CURL)
    return anim.merge(torso, {"hips_loc": (0.012, 0.015, -0.062 * crouch), "ik": feet or feet_b()})


def guard_pose(crouch: float = 1.0) -> dict:
    return anim.merge(stance_b(crouch), anim.arms_relaxed(), {"ik": carry_ik()}, _P(prop_L=FIST_CURL))


def _pose(base: dict, torso: dict | None = None, hips=(0.0, 0.0, 0.0), ik: dict | None = None) -> dict:
    """base + torso delta (degrees) + hips offset (m) with IK targets merged over the base's"""
    p = anim.add(base, torso or {})
    p["ik"] = dict(base.get("ik", {}), **(ik or {}))
    return anim._with_hips(p, hips)


def palm_aim(palm, fingers) -> "AimRoll":
    """aim.L for the OPEN left hand: the palm normal (prop.L +X) and the fingers' direction (world); the aim
    axis is the knuckle line, prop.L +Y = palm x fingers"""
    n, f = V(palm).normalized(), V(fingers).normalized()
    f = (f - n * f.dot(n)).normalized()
    return AimRoll(tuple(n.cross(f)), 1.0, tuple(n))


def with_hand(p: dict, open_=None, hand=None) -> dict:
    """set the left hand: open_ (prop.L euler, OPEN / FIST_CURL) and the wrist (hand.L euler, absolute)"""
    out = dict(p)
    if open_ is not None:
        out["prop.L"] = open_
    if hand is not None:
        out["hand.L"] = hand
    return out


def two(rel, d, up, pole=(-0.8, 0.3, -0.4), grip=GRIP2, lpole=(0.8, 0.4, -0.4)) -> dict:
    """both fists on the haft (the off hand `grip` m along it from the main one)"""
    return {"hand.R": HT(rel=rel, pole=pole), "aim.R": AimRoll(d, 1.0, up),
            "hand.L": HT(to_prop=("prop.R", grip), pole=lpole)}


def one(rel, d, up, pole=(-0.8, 0.3, -0.4), left=None, lpole=(0.9, 0.3, -0.3)) -> dict:
    ik = {"hand.R": HT(rel=rel, pole=pole), "aim.R": AimRoll(d, 1.0, up)}
    if left is not None:
        ik["hand.L"] = HT(rel=left, pole=lpole)
    return ik


def step(base: dict, dl=(0.0, 0.0, 0.0), dr=(0.0, 0.0, 0.0), pl=0.0, pr=0.0, yl=None, yr=None) -> dict:
    fl, fr = base["ik"]["foot.L"], base["ik"]["foot.R"]
    return {"foot.L": FT(tuple(fl.ankle[i] + dl[i] for i in range(3)), pl, fl.yaw if yl is None else yl),
            "foot.R": FT(tuple(fr.ankle[i] + dr[i] for i in range(3)), pr, fr.yaw if yr is None else yr)}


class Rig:
    """FK/IK queries on the real skeleton (for left-hand grips expressed as smooth `rel` targets)"""

    def __init__(self, ctx):
        self.skel = anim.Skeleton(ctx.info.armature)

    def left_rel(self, pose: dict, along: float = GRIP2) -> tuple:
        """the `rel` (chest frame, arm lengths) that puts the left wrist where a to_prop grip would"""
        sk = self.skel
        p = dict(pose)
        p["ik"] = dict(pose["ik"])
        p["ik"]["hand.L"] = HT(to_prop=("prop.R", along), pole=(0.8, 0.4, -0.4))
        q = anim.resolve(sk, p)
        M = sk.fk(q)
        wrist = M["hand.L"].translation
        sh = (M[sk.parent["upper_arm.L"]] @ sk.local["upper_arm.L"]).translation
        Rc = M["chest"].to_3x3() @ sk.rest["chest"].to_3x3().inverted()
        L = sk.length["upper_arm.L"] + sk.length["forearm.L"]
        r = Rc.inverted() @ (wrist - sh) / L
        return (r.x, r.y, r.z)

    def tip_to(self, pose: dict, z: float = TIP_Z, only_below: bool = False) -> dict:
        """the same pose with the cleaver pitched (about the grip, keeping its heading) so the blade tip meets
        height z: chops land ON the ground and plants bite a few cm, never bury the blade (`only_below`: only
        when the tip would end lower than z)"""
        sk = self.skel
        q = anim.resolve(sk, pose)
        grip = sk.fk(q)["prop.R"].translation
        a = pose["ik"]["aim.R"]
        d = V(a.dir).normalized()
        if only_below and grip.z + d.z * BLADE_REACH >= z:
            return pose
        dz = max(-0.995, min(0.995, (z - grip.z) / BLADE_REACH))
        h = V((d.x, d.y, 0.0))
        h = h.normalized() if h.length > 1e-4 else V((0.0, -1.0, 0.0))
        nd = h * math.sqrt(1.0 - dz * dz) + V((0.0, 0.0, dz))
        out = dict(pose)
        out["ik"] = dict(pose["ik"])
        out["ik"]["aim.R"] = AimRoll(tuple(nd), a.weight, getattr(a, "up", (0.0, 0.0, 1.0)))
        return out

    def place(self, pose: dict, wrist, d, up, pole=(-0.9, 0.3, -0.3), side: str = "R") -> dict:
        """the same pose with the `side` hand's wrist put at the armature-space point `wrist` (expressed as the
        equivalent chest-relative `rel`, so it still lerps smoothly with rel keys) and the held item aimed
        along d (flat normal `up`): two-handed keys are designed where the fists meet, not per shoulder"""
        sk = self.skel
        base = {k: v for k, v in pose.items() if k != "ik"}
        base["ik"] = {k: v for k, v in (pose.get("ik") or {}).items() if k.startswith("foot")}
        M = sk.fk(anim.resolve(sk, base))
        up_ = f"upper_arm.{side}"
        sh = (M[sk.parent[up_]] @ sk.local[up_]).translation
        Rc = M["chest"].to_3x3() @ sk.rest["chest"].to_3x3().inverted()
        L = sk.length[up_] + sk.length[f"forearm.{side}"]
        r = Rc.inverted() @ (V(wrist) - sh) / L
        if os.environ.get("BURDAM_REACH"):
            print(f"burdam place {side}: wrist {tuple(round(c, 2) for c in wrist)} shoulder "
                  f"{tuple(round(c, 2) for c in sh)} reach {r.length:.2f}")
        out = dict(pose)
        out["ik"] = dict(pose.get("ik") or {})
        out["ik"][f"hand.{side}"] = HT(rel=(r.x, r.y, r.z), pole=pole)
        out["ik"][f"aim.{side}"] = AimRoll(tuple(d), 1.0, tuple(up))
        return out

    def soft_grip(self, pose: dict, along: float = GRIP2) -> dict:
        """the same pose with the off hand's haft grip as a rel target (lerps smoothly from a free hand)"""
        out = dict(pose)
        out["ik"] = dict(pose["ik"])
        out["ik"]["hand.L"] = HT(rel=self.left_rel(pose, along), pole=(0.8, 0.4, -0.4))
        return out


def braced(p: dict, l: float = 24.0, r: float = 10.0, up_l: float = 0.0, up_r: float = 0.0) -> dict:
    """the clavicles rolled forward (and up): Burdam's arms are short (0.535 m to the wrist) against shoulders
    0.8 m apart, so a two-handed grip in front needs the shoulders swung in toward the haft (shoulder.L +X
    euler = protraction; +Z raises the left, -Z the right)"""
    return anim.add(p, _P(shoulder_L=(l, 0, up_l), shoulder_R=(r, 0, -up_r)))


def _two_handed(c: anim.Clip, windows, skel, along: float = GRIP2, pole=(0.8, 0.4, -0.4)) -> anim.Clip:
    """the left hand ON the haft while the piecewise-linear weight `windows` [(t, w)] is up: each frame the
    clip's own left target (a free fist, or soft_grip's chest-relative stand-in) and the exact grip (an IK
    to_prop solve on the cleaver as posed) are both resolved and the left arm blended between them by w, so
    the palm stays on the haft through fast arcs and lets go / takes hold smoothly"""
    base = c.sample
    ts, ws = [t for t, _ in windows], [w for _, w in windows]

    def sample(t):
        p = base(t)
        w = float(np.interp(t, ts, ws))
        if w <= 1e-4 or "ik" not in p:
            return p
        pg = dict(p)
        pg["ik"] = dict(p["ik"])
        pg["ik"]["hand.L"] = HT(to_prop=("prop.R", along), pole=pole)
        pg["ik"].pop("aim.L", None)
        pg["prop.L"] = FIST_CURL
        qg = anim.resolve(skel, pg)
        if w >= 0.9999:
            return qg
        qf = anim.resolve(skel, p)
        out = dict(qf)
        for b in ("upper_arm.L", "forearm.L", "hand.L", "prop.L"):
            a, g = qf.get(b, (0.0, 0.0, 0.0)), qg.get(b, (0.0, 0.0, 0.0))
            out[b] = tuple(a[i] + (g[i] - a[i]) * w for i in range(3))
        return out
    return anim.Clip(c.name, c.frames, c.loop, sample, impact=c.impact, secondary=c.secondary, meta=c.meta)


def clip(name, N, keys, lags=None, loop=False, impact=None, wobble=None) -> anim.Clip:
    fn = anim.keyed(keys)
    if wobble:
        base = fn
        fn = lambda t, _b=base: wobble(t, _b(t))  # noqa: E731
    fn = anim.drag(fn, N, lags or {"head": 1.5, "neck": 1.0}, loop=loop)
    return anim.Clip(name, N, loop, fn, impact=impact)


def sole_points(skel) -> dict:
    """per foot: the boot sole's outline at rest (the sculpt's flat sole, toed out 12 degrees) as
    [(bone, point in that bone's rest frame)]: points ahead of the ball ride the toe bone"""
    out = {}
    for side, sx in (("L", 1.0), ("R", -1.0)):
        R = sdf.rot_z(sx * 12.0)
        c0 = np.array([sx * 0.255, -0.06, 0.0])
        ball = skel.rest_point(f"toe.{side}")
        pts = []
        for lx in (-0.09, 0.0, 0.09):
            for ly in (-0.21, -0.15, -0.08, 0.0, 0.08, 0.16):
                if abs(lx) > 0.05 and abs(ly) > 0.19:
                    continue
                p = c0 + R @ np.array([lx * (0.8 if ly < -0.17 else 1.0), ly, 0.0])
                bone = f"toe.{side}" if p[1] < ball.y - 0.01 else f"foot.{side}"
                pts.append((bone, skel.rest[bone].inverted() @ V(tuple(p))))
        for (ly, z) in ((-0.15, 0.10), (0.0, 0.14), (0.12, 0.12)):     # the instep / heel tops (a foot flat on
            p = c0 + R @ np.array([0.0, ly, z])                      # its top when he lies face down)
            bone = f"toe.{side}" if p[1] < ball.y - 0.01 else f"foot.{side}"
            pts.append((bone, skel.rest[bone].inverted() @ V(tuple(p))))
        for z in (0.25, 0.40):                                       # the shin wraps and the knee
            p = np.array([sx * 0.23, -0.10, z])
            pts.append((f"shin.{side}", skel.rest[f"shin.{side}"].inverted() @ V(tuple(p))))
        out[side] = pts
    return out


def _grounded(c: anim.Clip, skel, soles: dict, clearance: float = 0.0) -> anim.Clip:
    """no boot sole below the ground on any frame: a sinking IK foot has its ankle target raised by the
    deficit; a sinking FK foot (the death's fall) lifts the hips instead"""
    base = c.sample

    def sample(t):
        p = base(t)
        for _ in range(4):                                   # partial IK weights need a few passes
            q = anim.resolve(skel, p)
            M = skel.fk(q)
            ik = p.get("ik") or {}
            lift_hips = 0.0
            newik = None
            for side, pts in soles.items():
                zmin = min((M[b] @ lp).z for b, lp in pts)
                if zmin >= -clearance - 0.002:
                    continue
                ft = ik.get(f"foot.{side}")
                if ft is not None and ft.weight > 0.5:
                    newik = dict(newik or ik)
                    dz = -zmin / ft.weight
                    newik[f"foot.{side}"] = FT((ft.ankle[0], ft.ankle[1], ft.ankle[2] + dz), ft.pitch, ft.yaw, ft.toe,
                                               ft.knee, ft.weight)
                else:
                    lift_hips = max(lift_hips, -zmin)
            if newik is None and lift_hips <= 0:
                break
            p = dict(p)
            if newik is not None:
                p["ik"] = newik
            if lift_hips > 0:
                p = anim._with_hips(p, (0.0, 0.0, lift_hips))
        return p
    return anim.Clip(c.name, c.frames, c.loop, sample, impact=c.impact, secondary=c.secondary, meta=c.meta)


def _fisted(c: anim.Clip) -> anim.Clip:
    """every clip keeps the left fingers curled unless a pose opens them"""
    base = c.sample

    def sample(t):
        p = base(t)
        if "prop.L" not in p:
            p = dict(p)
            p["prop.L"] = FIST_CURL
        return p
    return anim.Clip(c.name, c.frames, c.loop, sample, impact=c.impact, secondary=c.secondary, meta=c.meta)


def gen_idle_carry() -> anim.Clip:
    """the carry, breathing: the shoulders rise ~2 cm on each breath, a slow weight sway"""
    base = guard_pose()
    N = 72

    def sample(t):
        b = anim.osc(t, 2)
        s = anim.osc(t, 1, 0.1)
        d = _P(chest=(2.4 * b, 0, 0), spine=(0.8 * b, 0, 0.7 * s), neck=(-1.5 * b, 0, 0), head=(-0.8 * b, 1.8 * s, 0),
               shoulder_L=(0, 0, 3.5 * b), shoulder_R=(0, 0, -3.5 * b), hips=(0, 1.4 * s, -1.2 * s))
        p = anim.add(base, d)
        return anim._with_hips(p, (0.012 * s, 0.0, -0.006 * (0.5 + 0.5 * b)))

    return anim.Clip("idle", N, True, sample)


def gen_run_carry() -> anim.Clip:
    """the shared run cycle (3.45 m/s, heavy) with the cleaver kept on the shoulder: the right arm swings
    short around the carry, the left fist pumps (forward to the chest, back past the hip: brief section 8)"""
    c = CARRY
    r0 = RUN_REL0
    d = c["d"]
    # (the run's head bob met the blade's flat behind the mask: the run carries it 4 cm higher, heading 6 degrees
    # further back)
    d = RUN_D
    blocks = {"run_fwd": ((r0[0] + 0.03, r0[1] - 0.04, r0[2] - 0.04), c["pole"], d, (0.16, -0.78, -0.40), (0.9, 0.2, -0.4)),
              "run_back": ((r0[0] - 0.02, r0[1] + 0.06, r0[2] - 0.08), c["pole"], d, (0.10, 0.46, -0.76), (0.9, 0.3, -0.2))}
    prof = dict(MOTION, weapon="one_hand", blocks=blocks)
    base = anim.gen_run(prof)
    up = carry_flat(d, RUN_ROLL)

    def sample(t):
        p = base.sample(t)
        ik = dict(p["ik"])
        a = ik.get("aim.R")
        if a is not None:
            ik["aim.R"] = AimRoll(a.dir, a.weight, up)
        p["ik"] = ik
        p["prop.L"] = FIST_CURL
        return p

    return anim.Clip("run", base.frames, True, sample, meta=base.meta)


def chop_poses(R, G, lunge: float = 0.0):
    """the two-handed overhead chop (attack1, Bear Down, the dash). Both fists meet on the haft in front of the
    brow, the cleaver raised up and back over the head (edge up, the clavicles rolled in so the short left arm
    reaches); the torso folds in and both fists drive it down in front to the belly, arms long, the tip biting
    the ground ahead; the follow-through pulls both fists down to the front of the right thigh. `lunge` (0..1)
    adds Bear Down's long step and 20 degree lean. Returns (wind, hit, follow, recover): `recover` swings the
    blade up on the outside of the right arm, one-handed, so the way back to the shoulder never passes through
    the head."""
    L = lunge
    feet_w = step(G, dl=(0.0, -0.06, 0.0), dr=(0.0, 0.03, 0.0))
    wind = _pose(G, _P(hips=(0, -4, 0), spine=(-2, -4, 0), chest=(-2, -8, 0), neck=(-6, 2, 0), head=(-8, 6, 0),
                       shoulder_L=(30, 0, 6), shoulder_R=(22, 0, -6)), (0, 0.02, 0.01), dict(feet_w))
    wind = R.soft_grip(R.place(wind, WIND_W, WIND_D, EDGE_DOWN, pole=(-1.0, -0.2, -0.2)))
    fdl = (0.0, -0.20 - 0.24 * L, 0.0)
    feet_h = step(G, dl=fdl, dr=(0.0, 0.04 + 0.04 * L, 0.0), pr=-10 - 8 * L)
    hip_d = (0, -0.12 - 0.16 * L, -0.12 - 0.04 * L)
    hit = _pose(G, _P(hips=(10 + 4 * L, -6, 0), spine=(7 + 2 * L, -4, 0), chest=(5 + 1 * L, -8, 0), neck=(-10, 4, 0),
                      head=(-12, 6, 0), shoulder_L=(30, 0, 0), shoulder_R=(12, 0, 0)), hip_d, dict(feet_h))
    hit = R.place(hit, (HIT_W[0], HIT_W[1] + hip_d[1], HIT_W[2] + hip_d[2]), HIT_D, EDGE_DOWN, pole=(-0.9, 0.3, -0.3))
    hit = R.soft_grip(R.tip_to(hit, CHOP_TIP_Z + 0.20, only_below=True))
    fol_d = (0, -0.14 - 0.16 * L, -0.15 - 0.04 * L)
    fol = _pose(G, _P(hips=(14 + 3 * L, -10, 0), spine=(9 + 2 * L, -6, 0), chest=(5 + 1 * L, -10, 0), neck=(-12, 0, 0),
                      head=(-12, 0, 0), shoulder_L=(32, 0, -4), shoulder_R=(10, 0, 0)), fol_d, dict(feet_h))
    fol = R.place(fol, (FOL_W[0], FOL_W[1] + fol_d[1], FOL_W[2] + fol_d[2]), FOL_D, EDGE_DOWN, pole=(-0.9, 0.2, -0.3))
    fol = R.soft_grip(R.tip_to(fol, CHOP_TIP_Z))
    # the recovery: the cleaver swung up to upright in the right fist at the front of the right hip, the forearm
    # level (the haft clear of it), then unslung back onto the shoulder
    rec = _pose(G, _P(hips=(6, 4, 0), spine=(4, 2, 0), chest=(2, -6, 0), head=(-2, 6, 0)), (0, -0.06, -0.04),
                one((-0.42, -0.62, -0.40), (-0.30, -0.12, 0.95), (0.0, -0.95, 0.30), pole=(-0.9, 0.3, -0.3), left=BELT_L))
    return wind, hit, fol, rec


def chop_over(R, wind, hit, dy: float = 0.0, dz: float = 0.0):
    """the drive: both fists coming forward and down in front of the face (clear of the cowl), the cleaver swung
    over to upright in FRONT of the head (never through it); dy / dz carry a lunge's hip travel"""
    over = anim.lerp_pose(wind, hit, 0.35)
    over = R.place(over, (OVER_W[0], OVER_W[1] + dy, OVER_W[2] + dz), (0.08, -0.55, 0.83), EDGE_DOWN, pole=(-0.9, 0.2, -0.3))
    return R.soft_grip(over)


def chop_lift(G, wind):
    """the first beat off the shoulder: the cleaver tips up as the body dips, the left fist swings up in FRONT of
    the belly toward the haft (never up the chest through the cowl)"""
    hv = anim.HEAVY[MOTION["weight"]]
    lift = anim._with_hips(anim.lerp_pose(unsling(G), wind, 0.40), (0.0, 0.0, -0.014 * hv))
    lift["ik"] = dict(lift["ik"], **{"hand.L": HT(rel=(0.02, -0.86, -0.30), pole=(0.9, 0.2, -0.4))})
    return lift


def chop_keys(R, G, wind, hit, fol, rec) -> list:
    """the VALE strike timing (impact at 40 %), the anticipation moving from the first frame: the cleaver lifts
    off the shoulder as the body dips and the left fist comes up in front (0-10 %), both fists on the haft in
    the raise (24 %), a moving coil, the drive over the front of the head, the impact with a weight drop and
    hold, a dragging follow-through, then the recovery routed out and up on the right (rec) to the shoulder"""
    hv = anim.HEAVY[MOTION["weight"]]
    coil = anim.lerp_pose_w(G, wind, 1.06, {"aim.R": 1.0, "aim.L": 1.0, "foot.L": 1.0, "foot.R": 1.0, "hand.R": 1.0,
                                            "hand.L": 1.0})
    hit2 = anim._with_hips(hit, (0.0, 0.0, -0.018 * hv))
    hold = anim._with_hips(anim.lerp_pose(hit, fol, 0.25), (0.0, 0.0, -0.024 * hv))
    return [(0.0, G, "linear"), (0.06, unsling(G), "out"), (0.13, chop_lift(G, wind), "inout"), (0.24, wind, "inout"),
            (0.30, coil, "out"),
            (0.345, chop_over(R, wind, hit), "in"), (anim.IMPACT, hit2, "accel"), (0.47, hold, "out"), (0.60, fol, "out"),
            (0.76, rec, "inout"), (0.89, unsling(G), "inout"), (1.0, G, "settle")]


def clip_overrides(ctx) -> dict:
    """Brief section 8 -> gestures (impact at 40 % of every attack / cast). The game plays a cast clip only up to
    its release (the 40 % mark lands on castTime, then the fighter blends back to idle in 0.1 s), so each cast
    reads by its impact frame; the follow-through after it is for the clip sheet, the menu and attacks.
      attack1  two-handed overhead chop off the shoulder, the front foot steps in (30 f, f12)
      attack2  two-handed backhand cut, left to right across the front, the left foot steps (40 f, f16)
      cast_a1  Bear Down: off the shoulder and cocked high in both fists, leaning into the lunge by the release
               (25 f, f10); the chop itself is the dash clip's, on arrival (no swing at the launch point)
      cast_a2  Stubborn: the cleaver stood as a post ahead, both fists stacked under the pommel, head bowed, the
               stance locks (30 f, f12)
      cast_a3  Old Wound: a two-handed waist-high sweep right to left that covers the whole cone BY f12, then
               follows through 100 degrees and pauses at f20 (30 f, f12)
      cast_ult Settled Account: the left arm thrown OUT open-palmed by f6, held, then the fist closes and yanks
               back to the chest as the cleaver stamps down in front, the body rocks back (45 f, f18)
      dash     Bear Down's lunge (stretched over the sim's dash): starts on cast_a1's release pose, cocked high
               in both fists, and chops down two-handed on arrival
    Two-handed windows (the left hand on the haft) are applied by _two_handed after grounding."""
    R = Rig(ctx)
    G = guard_pose()
    out = {"idle": gen_idle_carry(), "run": gen_run_carry()}
    I = anim.IMPACT
    two_w = {}

    # attack1: the two-handed overhead chop, a step in
    wind, hit, fol, rec = chop_poses(R, G, 0.0)
    out["attack1"] = anim.Clip("attack1", 30, False, anim.drag(anim.keyed(chop_keys(R, G, wind, hit, fol, rec)), 30,
                                                                {"head": 1.5, "neck": 1.0}), impact=I)
    two_w["attack1"] = [(0.0, 0.0), (0.12, 0.0), (0.22, 1.0), (0.62, 1.0), (0.72, 0.0), (1.0, 0.0)]

    # attack2: two-handed backhand cut, left to right across the front. The cleaver comes off the shoulder
    # upright in front of the right shoulder (lift) as the left hand takes the haft, both fists cock it ACROSS to
    # the left hip pointing back (the backhand chamber, the chest turned left), sweep it through the front at
    # belly height (the hips lead) and follow through out to the right, where the left hand lets go and swings
    # back as a counterweight; the way back to the shoulder goes up the right side
    flat_cw = (0.0, 0.0, -1.0)                 # flat normal for a left -> right sweep (the edge leads)
    lift = _pose(G, _P(hips=(2, 8, 0), spine=(2, 6, 0), chest=(2, 8, 0), head=(0, -6, 0), shoulder_L=(16, 0, 0)),
                 (0.01, 0.0, -0.01),
                 one((-0.10, -0.60, 0.22), (0.30, -0.30, 0.90), (0.0, -0.9, -0.4), pole=(-0.9, 0.2, -0.4)))
    lift = R.soft_grip(lift)
    wind = _pose(G, _P(hips=(2, 24, 0), spine=(2, 16, 0), chest=(4, 22, 0), head=(0, -20, 0), shoulder_L=(12, 0, 0),
                       shoulder_R=(26, 0, 0)), (0.03, 0.04, -0.03),
                 dict(one(A2_WIND_REL, A2_WIND_D, flat_cw, pole=(-0.6, 0.3, -0.6)), **step(G, dl=(0.02, 0.04, 0), pl=-8)))
    wind = R.soft_grip(wind)
    hit = _pose(G, _P(hips=(6, -8, 0), spine=(4, -6, 0), chest=(5, -8, 0), head=(0, 8, 0), shoulder_L=(26, 0, 0),
                      shoulder_R=(12, 0, 0)), (-0.04, -0.12, -0.07),
                dict(one(A2_HIT_REL, A2_HIT_D, flat_cw, pole=(-0.8, 0.3, -0.4)),
                     **step(G, dl=(0.04, -0.20, 0), dr=(0.0, 0.04, 0), pr=-14, yr=-24)))
    hit = R.soft_grip(hit)
    fol = _pose(G, _P(hips=(6, -26, 0), spine=(4, -16, 0), chest=(5, -26, 0), head=(0, 20, 0)), (-0.06, -0.14, -0.08),
                dict(one((-0.65, -0.50, -0.10), (-0.92, 0.32, 0.05), flat_cw, pole=(-0.6, 0.6, -0.5),
                         left=(0.85, 0.05, -0.40)), **step(G, dl=(0.04, -0.20, 0), dr=(0.0, 0.04, 0), pr=-18, yr=-30)))
    rec2 = _pose(G, _P(hips=(2, -8, 0), spine=(2, -6, 0), chest=(0, -8, 0)), (0, -0.04, -0.03),
                 one((-0.46, -0.58, -0.40), (-0.32, -0.08, 0.94), (0.0, -0.95, 0.30), pole=(-0.9, 0.3, -0.3), left=BELT_L))
    k2 = anim.strike_keys(MOTION, wind, hit, fol, G)
    k2 = [(0.0, G, "linear"), (0.05, unsling(G), "out"), (0.12, lift, "inout")] + [k for k in k2 if 0.2 < k[0] < 0.7] + \
         [(0.78, rec2, "inout"), (0.90, unsling(G), "inout"), (1.0, G, "settle")]
    out["attack2"] = anim.Clip("attack2", 40, False, anim.drag(anim.keyed(k2), 40, {"head": 2.0, "neck": 1.5}),
                               impact=I)
    two_w["attack2"] = [(0.0, 0.0), (0.06, 0.3), (0.12, 1.0), (0.47, 1.0), (0.56, 0.0), (1.0, 0.0)]

    # cast_a1 Bear Down: 4-frame anticipation (the left hand to the haft, a dip), the cleaver up over the head in
    # both fists, leaning into the lunge by the release (f10 = the dash's first frame: the chop is the dash
    # clip's); after the release (seen only when the clip plays whole) the chop lands and he recovers
    wind, hit, fol, rec = chop_poses(R, G, 1.0)
    lean = _pose(wind, _P(hips=(12, 0, 0), spine=(6, 0, 0), chest=(2, 0, 0), neck=(-10, 0, 0), head=(-12, 0, 0)),
                 (0, -0.14, -0.08), step(G, dl=(0.0, -0.30, 0.0), dr=(0.0, 0.20, 0.02), pl=0, pr=-26))
    lean = R.soft_grip(R.place(lean, LEAN_W, LEAN_D, EDGE_DOWN, pole=(-1.0, -0.2, -0.2)))
    launch = R.soft_grip(anim.lerp_pose(wind, lean, 0.6))
    over = chop_over(R, lean, hit, dy=-0.30, dz=-0.20)
    hold = anim._with_hips(hit, (0, -0.01, -0.02))
    out["cast_a1"] = clip("cast_a1", 25, [(0.0, G, "linear"), (0.06, unsling(G), "out"),
                                          (0.15, chop_lift(G, wind), "inout"), (0.30, wind, "inout"),
                                          (I, launch, "out"), (0.50, over, "in"), (0.58, hit, "accel"),
                                          (0.66, hold, "out"), (0.76, fol, "out"), (0.86, rec, "inout"),
                                          (0.94, unsling(G), "inout"),
                                          (1.0, G, "settle")], impact=I)
    two_w["cast_a1"] = [(0.0, 0.0), (0.12, 0.0), (0.24, 1.0), (0.80, 1.0), (0.88, 0.0), (1.0, 0.0)]
    # dash: stretched over Bear Down's travel, from cast_a1's release pose: he throws himself forward (a 20
    # degree lean, the hips dropped, the cleaver cocked high in both fists) and chops down on arrival
    # (front-loaded: a short dash lasts 3 ticks, so the chop lands by 2/3 of the clip)
    out["dash"] = anim.Clip("dash", 20, False, anim.keyed([(0.0, launch, "linear"), (0.15, lean, "out"),
                                                            (0.40, anim._with_hips(lean, (0, -0.03, -0.01)), "linear"),
                                                            (0.52, over, "in"), (0.62, hit, "accel"), (1.0, hold, "out")]))
    two_w["dash"] = [(0.0, 1.0), (1.0, 1.0)]

    # cast_a2 Stubborn: plant the tip ahead, fold both hands over the pommel, head bowed, the chest up; the
    # stance locks wide at f12; hold, breathe
    out["cast_a2"] = _stubborn(R, G)

    # cast_a3 Old Wound: both fists draw the cleaver back to the right hip (a 90 degree torso turn), then sweep it
    # waist-high across the whole 100 degree cone by the impact (f12: the blade 50 degrees left of the facing),
    # follow through on round to the left-back where the left hand lets go, pause at f20 (the wound reopening),
    # then back to the shoulder; the left foot steps out, the right heel turns
    flat_ccw = (0.0, 0.0, 1.0)                 # right -> left sweep
    draw = _pose(G, _P(hips=(4, -22, 0), spine=(4, -16, 0), chest=(4, -20, 0), head=(-2, 20, 0), shoulder_L=(30, 0, 0),
                       shoulder_R=(0, 0, 0), prop_L=FIST_CURL), (0.04, 0.06, -0.06),
                 step(G, dr=(0, 0.05, 0), pl=-10))
    draw = R.place(draw, A3_DRAW_W, A3_DRAW_D, flat_ccw, pole=(-0.5, 0.8, -0.3))
    draw["ik"]["hand.L"] = HT(rel=(-0.10, -0.80, -0.45), pole=(0.9, 0.2, -0.4))     # reaching across for the haft
    mid = _pose(G, _P(hips=(8, -4, 0), spine=(6, -2, 0), chest=(6, -4, 0), head=(-4, 4, 0), shoulder_L=(26, 0, 0),
                      shoulder_R=(12, 0, 0)), (-0.02, -0.12, -0.12),
                step(G, dl=(0.06, -0.18, 0), pr=-12, yr=-20))
    mid = R.soft_grip(R.place(mid, A3_MID_W, A3_MID_D, flat_ccw, pole=(-0.9, 0.2, -0.3)))
    hit = _pose(G, _P(hips=(8, 22, 0), spine=(6, 14, 0), chest=(6, 20, 0), head=(-4, -18, 0), shoulder_L=(14, 0, 0),
                      shoulder_R=(28, 0, 0)), (-0.05, -0.12, -0.12),
                step(G, dl=(0.06, -0.18, 0), pr=-16, yr=-8))
    hit = R.soft_grip(R.place(hit, A3_HIT_W, A3_HIT_D, flat_ccw, pole=(-0.6, -0.2, -0.5)))
    fol = _pose(G, _P(hips=(8, 34, 0), spine=(6, 22, 0), chest=(6, 32, 0), head=(-4, -26, 0)), (-0.06, -0.12, -0.12),
                dict(one((0.62, -0.66, -0.35), (0.92, 0.36, -0.10), flat_ccw, pole=(-0.4, -0.6, -0.6),
                         left=(0.35, 0.55, -0.65)), **step(G, dl=(0.06, -0.18, 0), pr=-16, yr=-6)))
    pause = anim._with_hips(anim.add(fol, _P(chest=(2, 2, 0), head=(4, 0, 0))), (0, 0, -0.012))
    # back to the shoulder by way of the cleaver held upright in front of the right shoulder (never over the head)
    rec = _pose(G, _P(hips=(2, 8, 0), spine=(0, 4, 0), chest=(-2, 4, 0)), (0, -0.02, -0.03),
                one((-0.30, -0.62, 0.10), (0.06, -0.22, 0.97), (0.0, -0.97, 0.22), pole=(-0.9, 0.2, -0.4), left=BELT_L))
    out["cast_a3"] = clip("cast_a3", 30, [(0.0, G, "linear"), (0.05, unsling(G), "out"),
                                          (0.12, anim.lerp_pose(unsling(G), draw, 0.35), "inout"),
                                          (0.24, draw, "inout"), (0.29, anim.lerp_pose(draw, mid, 0.12), "in"),
                                          (0.345, mid, "linear"), (I, hit, "out"), (0.52, fol, "out"),
                                          (0.667, pause, "out"), (0.80, rec, "inout"), (0.91, unsling(G), "inout"),
                                          (1.0, G, "settle")], impact=I)
    two_w["cast_a3"] = [(0.0, 0.0), (0.24, 0.0), (0.32, 1.0), (0.46, 1.0), (0.54, 0.0), (1.0, 0.0)]

    # cast_ult Settled Account: the left arm thrown OUT, open-palmed toward the enemies, the cleaver cocked high
    # (reached by f6: the release is at 0.35 s, so the clip runs ~1.7x); held to f13; at f18 the fist closes
    # and yanks back to the chest as the cleaver stamps down in front and the body rocks back 10 degrees: a
    # ring closing; hold the stamp f18-f30, then straighten
    # fix pass 4: the arm thrown OUT of the silhouette, not a palm at the chest: the left arm nearly straight at
    # shoulder height, ~50 degrees left of the facing (a horizontal bar from the top-down camera at any facing
    # but straight at it), the open hand at the end of it, the chest opened toward it, the left foot stepping out
    reach = _pose(G, _P(hips=(4, -6, 0), spine=(3, -4, 0), chest=(0, -6, 0), head=(-6, 14, 0),
                        shoulder_L=(6, 0, 8)), (0.03, -0.04, -0.04),
                  dict(one((-0.46, 0.08, 0.56), (-0.12, 0.62, 0.78), EDGE_DOWN, pole=(-0.9, 0.0, -0.3),
                           left=ULT_REACH, lpole=(0.4, 0.5, -0.8)), **step(G, dl=(0.10, -0.12, 0), pl=-4, yl=24, pr=-8)))
    # the open left hand: aim.L turns the hand so the fingers run on out along the arm and the palm (prop.L +X)
    # faces the enemies (forward and down: a hand reaching to grab)
    # fix pass 8 (the review: the wind-up read as a bent-elbow 'halt' palm raised beside the head): the arm straight
    # out at shoulder height (ULT_REACH, ~77 degrees left of the facing: a long bar from the game camera and from the
    # front-left clip camera), the hand open and reaching to grab: the fingers run on out along the arm, the palm
    # turned forward and down, the fingers a little curled (a claw about to close), never a palm shown to the camera
    reach = with_hand(reach, ULT_CLAW)
    reach["ik"] = dict(reach["ik"], **{"aim.L": palm_aim((0.05, -0.62, -0.78), (0.96, -0.20, -0.06))})
    reach2 = anim.add(reach, _P(chest=(2, -2, 0), shoulder_L=(0, 0, 2)))
    # the stamp (fix pass 8: the review read the edge-on blade at the impact as the cleaver lowered at his right
    # side): the cleaver slammed down in FRONT of his centre, its broad flat to the front (the slab and the five
    # inlays face the enemies and the clip camera), the left fist yanked in to the chest beside the right one
    stamp = _pose(G, _P(hips=(-8, 8, 0), spine=(-8, 4, 0), chest=(-10, 6, 0), neck=(6, 0, 0), head=(8, -4, 0),
                        shoulder_L=(0, 0, 6)), (0, 0.10, -0.10),
                  dict(one((0.30, -0.80, -0.38), (0.02, -0.40, -0.92), (-0.009, -0.916, 0.401), pole=(-0.9, 0.2, -0.3),
                           left=(-0.06, -0.66, -0.10), lpole=(0.9, 0.2, -0.5)),
                       **step(G, dl=(0.04, -0.16, 0), dr=(0.0, 0.10, 0), pl=-6)))
    stamp = R.tip_to(with_hand(stamp, FIST_CURL))
    drop = anim.lerp_pose(reach2, stamp, 0.55)               # the swing down, its tip held off the ground
    drop = R.tip_to(drop, 0.25, only_below=True)
    hold = anim.add(stamp, _P(chest=(-1, 0, 0)))
    # the way back: the attack1 chop's recovery (pulled out of the ground and swung up to upright in the right fist
    # at the front of the right hip, the forearm level, the haft clear of it), then unslung onto the shoulder: the
    # stamped slab never sweeps back through the coat (the pass-7 hold -> out_right route met it)
    ult_rec = chop_poses(R, G, 0.0)[3]
    # W5b (the verifier: fix round 2's back-pointing carry swept the haft and pommel through the coat's back in the
    # wind-up's first in-betweens, f3-f4 41 verts against the earlier 13): the cleaver first lifts UP and OUT of the
    # carry (the fist rises beside the back of the right shoulder, the blade steepens while it still points back),
    # then swings into the cocked reach; the torso and the left arm keep their own timing (ULT_LIFT)
    lift = anim.lerp_pose(G, reach, ULT_LIFT["body"])
    lift["ik"] = dict(lift["ik"], **one(ULT_LIFT["rel"], ULT_LIFT["d"], carry_flat(ULT_LIFT["d"], ULT_LIFT["roll"]),
                                        pole=ULT_LIFT["pole"]))
    # W5b: the swing down from the cocked reach arcs OUT past the right shoulder's front plate (pauldron_face) instead
    # of cutting through it (one in-between, f15: 68 cleaver verts inside the plate -> ULT_ARC)
    swing = [(0.36, drop, "in")]
    if ULT_ARC:
        arc = anim.lerp_pose(reach2, drop, ULT_ARC["at"])
        h = arc["ik"]["hand.R"]
        arc["ik"] = dict(arc["ik"], **{"hand.R": HT(rel=tuple(h.rel[i] + ULT_ARC["off"][i] for i in range(3)),
                                                     pole=h.pole)})
        swing = [(ULT_ARC["t"], arc, "in"), (0.36, drop, "linear")]
    out["cast_ult"] = clip("cast_ult", 45, [(0.0, G, "linear"), (0.04, anim.lerp_pose(G, reach, -0.06), "inout"),
                                            (ULT_LIFT["t"], lift, "inout"),
                                            (0.13, reach, "out"), (0.29, reach2, "inout")] + swing + [
                                            (I, stamp, "accel"),
                                            (0.47, anim._with_hips(stamp, (0, 0.01, -0.012)), "out"),
                                            (0.67, hold, "linear"), (0.78, ult_rec, "inout"),
                                            (0.90, unsling(G), "inout"), (1.0, G, "settle")], impact=I)

    out.update(_gen_rest_clips(R, G))
    two_w.update({"cast_a2": STUBBORN_TWO, "channel": [(0.0, 1.0), (1.0, 1.0)]})
    soles = sole_points(R.skel)
    res = {}
    for k, v in out.items():
        c = _fisted(v) if k == "run" else _grounded(_fisted(v), R.skel, soles)
        if k in two_w:
            c = _two_handed(c, two_w[k], R.skel, along=POST_ALONG if k in ("cast_a2", "channel") else GRIP2)
        res[k] = c
    return res


# the planted cleaver (Stubborn, the channel), fix pass 4: the brief's "T" with the cleaver as the post: planted in
# front of him, a little right of centre (a vertical post from the front and the game camera facing him),
# leaning back toward him ~48 degrees, both hands on its top: the right fist on the haft at the belly, the left hand
# over the pommel's crown at the sternum, ~0.25 m under the chin (the mask's face stays clear; proto/burdam_plant.py
# searched wrist x fold x heading for the fewest hand / cleaver hits in the cowl and coat), the body leaning in over
# the hands, head bowed, the stance wide
STUB_D = (0.0, -0.62, -0.78)                # grip -> tip: straight ahead, down (vertical in the front view)
STUB_W = (-0.12, -0.54, 1.14)               # the right wrist: the fist on the haft in front of the belly
PLANT_UP = (0.0, -0.77, 0.64)               # the flat to the front (the slabs face the camera)
STUBBORN_TWO = [(0.0, 0.0), (0.28, 0.0), (0.38, 1.0), (1.0, 1.0)]
# fix pass 7 (the review: Stubborn's set planted the cleaver at the right foot, ~48 degrees off vertical, not the
# brief's T): the cleaver stood as a POST in front of his centre, 22 degrees off vertical (its top toward him), both
# fists stacked on the haft at the chest, the hips folded in over them, head bowed (proto/burdam_plant.py --along
# -0.17: head 0 / arms 30 / coat 0 hits against the pass-4 plant's 46 / 132 / 35, both wrists within 3 cm; the fists
# at the sternum, the pommel under the chin, so the mask stays clear above it)
POST_W = (-0.08, -0.66, 1.34)               # the right wrist: the fists on the haft in front of the chest
POST_D = (0.0, -0.44, -0.90)                # grip -> tip: down and ahead (the tip ~1.2 m in front of him)
POST_ALONG = cl.OFF_GRIP                    # the left fist stacked over the right one on the haft
POST_FOLD = -2.0                            # the hips folded a little less (the fists low enough to clear the mask)
POST_TIP_Z = -0.18                          # fix pass 8 (the review: from the side the post leaned ~45 degrees, a man
                                            # leaning on a sword): the tip DRIVEN 18 cm into the ground, so the post
                                            # stands ~20 degrees off vertical under the fists at the chest (the
                                            # cleaver is as long as he is tall: hands at the chest and the tip on the
                                            # surface cannot stand it steeper)


def out_right(G, left=None, k: float = 1.0) -> dict:
    """the cleaver taken off the shoulder OUTWARD: the fist at the right side at chest height, the blade
    pointing up, forward and out to the right. Every move between the shoulder carry and a pose with the
    blade down in front passes through here, so the blade never sweeps through the head or the body"""
    return _pose(G, _P(hips=(2, -4 * k, 0), spine=(2, -4 * k, 0), chest=(0, -6 * k, 0), head=(0, 4 * k, 0)),
                 (0, -0.02, -0.02), one((-0.62, -0.30, 0.0), (-0.62, -0.42, 0.66), (0.0, -0.84, -0.54),
                                        pole=(-0.9, 0.4, -0.3), left=left or BELT_L))


# fix pass 6: the unsling for the low carry (proto/burdam_unsling.py: the fist out to the right at shoulder height,
# the cleaver tipped up off the back to 21 degrees off vertical, out and back; the flat carried over from the carry
# by the minimal rotation, so the broad heel never rolls through the felt roll on the way up: the cowl / mask take
# 1 vertex over the carry -> unsling in-betweens, the pass-5 unsling 110)
UNSLING = dict(rel=(-0.594, 0.094, 0.098), d=(-0.258, 0.258, 0.931), up=(0.215, 0.955, -0.206))


def unsling(G, left=None) -> dict:
    """the first beat off the carry (and the last back onto it): the fist out to the right at shoulder height, the
    cleaver tipped up off the back beside the right shoulder, so a swing that starts in front never drags the
    blade or the fist through the head or the felt roll"""
    return _pose(G, _P(chest=(0, -3, 0), head=(0, 3, 0)), (0, 0, 0),
                 one(UNSLING["rel"], UNSLING["d"], UNSLING["up"], pole=CARRY["pole"], left=left or BELT_L))


def _plant_two(R, crouch=1.3, feet=None, head=14.0, wrist=None, d=None, fold: float = 0.0):
    """both hands at the top of the planted cleaver (the left one put on the pommel by _two_handed), head bowed,
    the hips folded so the shoulders come forward over the hands (Burdam's arms are short)"""
    wide = feet or feet_b(l=(0.11, -0.04, 0.0), r=(-0.11, 0.08, 0.0), yl=16, yr=-18)
    p = anim.merge(anim.arms_relaxed(),
                   _pose(stance_b(crouch, wide), _P(hips=(11 + fold, 0, 0), spine=(4, 0, 0), chest=(-6, 0, 0),
                                                    neck=(6, 0, 0), head=(head, 0, 0), shoulder_L=(22, 0, 0),
                                                    shoulder_R=(12, 0, 0)),
                         (0, 0.03, -0.03), dict(wide, **{"hand.L": HT(rel=(0.30, -0.80, -0.35), pole=(0.8, 0.4, -0.4))})),
                   _P(prop_L=FIST_CURL))
    return R.place(p, wrist or STUB_W, d or STUB_D, PLANT_UP, pole=(-0.9, 0.2, -0.5))


# two-handed keys: the right WRIST in armature space (m; the lunge's hip travel added), the cleaver's axis
WIND_W = (-0.15, -0.49, 1.76)          # the chop's raise: both fists in front of the chin (fix pass 5: 4 cm further
                                       # out, the bigger fists met the cowl)
OVER_W = (-0.17, -0.61, 1.48)          # the drive: both fists forward and down, the blade upright in front
WIND_D = (-0.28, 0.24, 0.93)           # the cleaver raised up and back over the right shoulder, clear of the mask
LEAN_W = (-0.15, -0.84, 1.36)          # Bear Down's lunge (a 20 degree lean): the fists thrown out under the chin
LEAN_D = (-0.15, -0.30, 0.94)          # the cleaver raised over them, tipped forward at the target
HIT_W = (-0.17, -0.56, 1.14)           # the chop's impact: both fists in front of the belly, arms long
HIT_D = (0.06, -0.60, -0.80)
FOL_W = (-0.24, -0.44, 0.99)           # the follow-through: both fists down at the front of the right thigh
FOL_D = (0.10, -0.62, -0.78)
A2_WIND_REL = (0.55, -0.80, -0.30)     # attack2's backhand chamber: both fists at the left hip
A2_WIND_D = (0.80, 0.45, 0.20)         # the cleaver pointing back past the left hip
A2_HIT_REL = (0.30, -0.92, -0.30)      # through the front at belly height
A2_HIT_D = (-0.30, -0.95, -0.05)
A3_DRAW_W = (-0.46, -0.10, 1.08)       # Old Wound's draw (right wrist): both fists at the front of the right hip,
A3_DRAW_D = (-0.75, 0.64, -0.12)       # the blade cocked back past the right hip
A3_MID_W = (-0.10, -0.62, 1.02)        # mid-sweep: straight ahead at the waist
A3_MID_D = (0.0, -1.0, -0.08)
A3_HIT_W = (0.26, -0.56, 1.02)         # the impact: 50 degrees left of the facing, the cone covered
A3_HIT_D = (0.80, -0.58, -0.10)


def _stubborn(R, G) -> anim.Clip:
    """off the shoulder (f0-1), the cleaver let swing down BEHIND his right hip (f4: the tip passes back and down,
    hidden by the body from the front), hanging tip-down at his right side (f6), brought in to the post as both
    fists stack on the haft and the weight drops (f10, the tip driven into the ground); the stance locked at f12,
    head bowed over the hands; two breaths; the chest lifts at the end"""
    setp = R.tip_to(_plant_two(R, 1.3, head=16.0, wrist=POST_W, d=POST_D, fold=POST_FOLD), POST_TIP_Z)
    # fix pass 8 (the review: around f8 a low near-horizontal blade still passed in front before the plant): the
    # blade never turns over in front; it swings down like a pendulum at his right side, the tip going back and
    # down (the flat to the side, edge-on from the front), then comes forward hanging and is set in front
    back = _pose(G, _P(hips=(2, -4, 0), spine=(2, -4, 0), chest=(0, -6, 0), head=(4, 4, 0)), (0, 0.0, -0.02),
                 one((-0.74, 0.10, -0.30), (-0.22, 0.72, -0.66), (1.0, 0.0, 0.0), pole=(-0.9, 0.4, -0.3),
                     left=(0.10, -0.40, -0.55)))
    back = R.tip_to(back, 0.20, only_below=True)
    hang = _pose(G, _P(hips=(4, -2, 0), spine=(3, -2, 0), chest=(0, -2, 0), head=(8, 0, 0)), (0, -0.01, -0.03),
                 one((-0.70, -0.32, -0.10), (-0.08, -0.26, -0.96), (1.0, 0.0, 0.0), pole=(-0.9, 0.3, -0.4),
                     left=(0.25, -0.70, -0.40)))
    hang = R.tip_to(hang, 0.06, only_below=True)          # (the fist lifted to the chest: the blade near upright)
    swing = R.tip_to(anim.lerp_pose(hang, setp, 0.55), -0.06, only_below=True)
    over = anim._with_hips(setp, (0, 0, -0.024))
    breath = anim.add(setp, _P(chest=(-2.5, 0, 0), head=(-3, 0, 0)))
    out_ = anim._with_hips(anim.add(setp, _P(chest=(-3, 0, 0), spine=(-1, 0, 0), head=(-4, 0, 0))), (0, 0, 0.006))
    I = anim.IMPACT
    return clip("cast_a2", 30, [(0.0, G, "linear"), (0.04, unsling(G, left=(0.10, -0.40, -0.55)), "out"),
                                (0.13, back, "inout"), (0.21, hang, "inout"),
                                (0.29, swing, "in"), (0.34, over, "accel"), (I, setp, "settle"), (0.62, breath, "sine"),
                                (0.80, setp, "sine"), (1.0, out_, "inout")], impact=I)


def _gen_rest_clips(R, G) -> dict:
    out = {}
    hip_h = R.skel.rest_point("hips").z

    # death: knocked back, down on the right knee over the planted cleaver, then forward over it onto the
    # ground (face down, the head turned, the cleaver flat in the right fist); the body never dips under the
    # ground and the legs stay FK from the fall on (no IK hand-over pop)
    # fix pass 4: the blow lands, the cleaver slides off the shoulder OUTWARD (the fist drops to the right side, the
    # blade falling away to his right, never raised over the head), drops to hang at his side (the haft's tail
    # up, clear of the hip), then tips down ahead as he goes to his knee; fix pass 5: the blade already falls
    # ~25 degrees below level on the blow (a level blade at full reach read as a sideways swing)
    hit = _pose(G, _P(hips=(-8, 8, 0), spine=(-10, 2, 0), chest=(-14, 4, 0), neck=(-8, 0, 0), head=(-16, 6, 0)),
                (0, 0.10, 0.0), dict(step(G, dr=(0.0, 0.12, 0.0), pr=-10),
                                     **one((-0.76, 0.02, -0.46), (-0.869, 0.239, -0.434), (-0.434, 0.057, 0.899),
                                           pole=(-0.9, 0.4, -0.3), left=(0.30, -0.30, -0.80))))
    drop = _pose(G, _P(hips=(4, 6, 0), spine=(2, 2, 0), chest=(0, 2, 0), neck=(4, 0, 0), head=(8, 6, 0)),
                 (0, 0.08, -0.08), dict(step(G, dr=(0.0, 0.12, 0.0), pr=-10),
                                        **one((-0.86, -0.20, -0.46), (-0.30, -0.42, -0.86), (1.0, 0.0, 0.0),
                                              pole=(-0.9, 0.4, -0.3), left=(0.20, -0.40, -0.80))))
    drop = R.tip_to(drop, 0.04, only_below=True)       # the blade hangs at his side, its tip on the ground
    kneel = anim.merge(anim.arms_relaxed(), _P(hips=(16, -6, 0), spine=(12, 0, 0), chest=(14, 0, 0), neck=(10, 0, 0),
                                               head=(18, 0, 0), toe_R=(60, 0, 0), prop_L=FIST_CURL))
    kneel["hips_loc"] = (0.0, 0.08, -hip_h * DEATH_KNEEL)
    kneel["ik"] = dict(anim.feet(l=(0.03, -0.30, 0.0), r=(-0.02, 0.36, 0.09), yl=-6, yr=-8, pr=-56, kr=8),
                       **one(DEATH_PLANT_REL, (0.26, -0.64, -0.72), (0.0, -0.75, 0.66), pole=(-0.9, 0.3, -0.3),
                             left=(-0.05, -0.55, -0.55), lpole=(0.9, 0.3, -0.3)))
    kneel = R.tip_to(kneel)
    slump = anim.add(kneel, _P(spine=(10, 0, 0), chest=(10, 0, 0), head=(12, 0, 0)))
    slump = R.tip_to(anim._with_hips(slump, (0, -0.04, -0.03)))
    down = anim.merge(anim.arms_relaxed(), _P(hips=(88, -6, 4), spine=(2, 0, 0), chest=(0, 4, 0), neck=(-12, 0, 0),
                                              head=(-10, 62, 0), thigh_L=(-4, 0, -6), shin_L=(6, 0, 0),
                                              thigh_R=(2, 0, 6), shin_R=(14, 0, 0), foot_L=(55, 0, 0),
                                              foot_R=(50, 0, 0), toe_L=(20, 0, 0), toe_R=(20, 0, 0),
                                              prop_L=FIST_CURL))
    k = hip_h / 0.95
    down["hips_loc"] = (0.03, -0.62 * k, -hip_h + DEATH_LIE)
    down["ik"] = {"hand.R": HT(pos=(-0.46 * k, -1.30 * k, 0.135), pole=(-1.0, 0.0, 0.2)),
                  "aim.R": AimRoll((-0.30, -0.95, 0.0), 1.0, (0.0, 0.0, 1.0)),
                  "hand.L": HT(pos=(0.52 * k, -1.02 * k, 0.12), pole=(1.0, 0.0, 0.2)),
                  "foot.L": FT((0, 0, 0), 0, 0, weight=0.0), "foot.R": FT((0, 0, 0), 0, 0, weight=0.0)}
    topple = anim.lerp_pose(slump, down, 0.45)
    topple = anim._with_hips(topple, (0, 0, 0.27))
    bounce = anim._with_hips(anim.add(down, _P(spine=(-4, 0, 0), chest=(-3, 0, 0), head=(-4, 0, 0))), (0, 0, 0.035))
    rest = anim.add(down, _P(head=(0, 4, 0)))
    out["death"] = anim.Clip("death", 60, False, anim.keyed([(0.0, G, "linear"), (0.10, hit, "snap"),
                                                             (0.21, drop, "inout"), (0.32, kneel, "inout"), (0.48, slump, "inout"),
                                                             (0.60, topple, "in"), (0.72, down, "in"), (0.79, bounce, "out"),
                                                             (0.88, rest, "inout"), (1.0, rest, "linear")]))

    # recall (6 s loop, the longest a loop may run; the recall lasts 7 s): the brief's beat. Off the shoulder by way
    # of his right side and planted at his right foot (the victory's plant, by 0.7 s), the right hand resting on the
    # haft; the left hand takes a tally stub from the belt, brings it up in front of the mask, strikes it alight with
    # the thumb (two flicks), and holds it up, watching it burn, breathing (to 5 s); then he shoulders the cleaver
    # again. The loop starts and ends on the idle carry, so entering from idle or the run blends without a pop.
    rec = anim.merge(stance_b(0.6), anim.arms_relaxed(), {"ik": carry_ik()}, _P(prop_L=FIST_CURL))
    stand = anim.merge(stance_b(0.7), anim.arms_relaxed(),
                       {"ik": one(VIC_REL, (-0.10, -0.42, -0.90), (0.30, -0.90, -0.42), pole=(-0.9, 0.3, -0.3),
                                  left=BELT_L)}, _P(prop_L=FIST_CURL))
    stand = R.tip_to(anim.add(stand, _P(neck=(4, 0, 0), head=(6, -4, 0), chest=(2, -2, 0))))
    take = anim.merge(stand, {"ik": {"hand.L": HT(rel=(0.02, -0.30, -0.85), pole=(0.9, 0.2, -0.3))}})
    take = R.tip_to(anim.add(take, _P(head=(10, 4, 0), spine=(3, 0, 0))))
    up_ = anim.merge(stand, {"ik": {"hand.L": HT(rel=(-0.10, -0.86, 0.02), pole=(0.9, 0.0, -0.5))}})
    up_ = R.tip_to(anim.add(up_, _P(head=(6, 10, 0), neck=(4, 0, 0), chest=(-2, 0, 0), shoulder_L=(14, 0, 4))))
    flick = anim.merge(up_, {"ik": {"hand.L": HT(rel=(-0.08, -0.88, 0.08), pole=(0.9, 0.0, -0.5))}})
    flick = anim.add(flick, _P(hand_L=(-22, 0, 0)))
    lit = anim.merge(up_, {"ik": {"hand.L": HT(rel=(-0.06, -0.84, 0.20), pole=(0.9, 0.0, -0.5))}})
    lit = R.tip_to(anim.add(lit, _P(head=(-4, 0, 0), chest=(-3, 0, 0))))
    lit2 = anim.merge(lit, {"ik": {"hand.L": HT(rel=(-0.02, -0.82, 0.16), pole=(0.9, 0.0, -0.5))}})
    lit2 = R.tip_to(anim.add(lit2, _P(head=(-2, -6, 0), hand_L=(0, 14, 0))))
    side = _pose(rec, _P(chest=(0, -4, 0), head=(2, 4, 0)), (0, -0.01, -0.01),
                 one((-0.80, -0.06, -0.38), (-0.88, -0.20, 0.10), (0.10, -0.10, 0.99), pole=(-0.9, 0.4, -0.3), left=BELT_L))
    drop = R.tip_to(_pose(rec, _P(chest=(2, -2, 0), head=(4, 2, 0)), (0, -0.01, -0.02),
                          one((-0.86, -0.20, -0.46), (-0.30, -0.42, -0.86), (1.0, 0.0, 0.0), pole=(-0.9, 0.4, -0.3),
                              left=BELT_L)), 0.04, only_below=True)
    rkeys = [(0.0, rec, "linear"), (0.03, unsling(rec), "inout"), (0.055, out_right(rec), "inout"), (0.075, side, "inout"),
             (0.095, drop, "inout"), (0.12, stand, "inout"),
             (0.17, take, "inout"),
             (0.24, up_, "inout"), (0.27, flick, "out"), (0.295, up_, "in"), (0.32, flick, "out"), (0.345, up_, "in"),
             (0.40, lit, "inout"), (0.56, lit2, "sine"), (0.72, lit, "sine"), (0.80, lit2, "sine"),
             (0.86, stand, "inout"), (0.88, drop, "inout"), (0.90, side, "inout"), (0.93, out_right(rec), "inout"),
             (0.96, unsling(rec), "inout"),
             (1.0, rec, "inout")]
    rb = anim.keyed(rkeys)

    def recall(t):
        b = anim.osc(t, 3)                                 # three slow breaths
        w = max(0.0, min(1.0, t / 0.11, (1.0 - t) / 0.12))   # the breathing only while he stands planted
        return anim._with_hips(anim.add(rb(t), _P(chest=(2.0 * b * w, 0, 0), shoulder_L=(0, 0, 1.5 * b * w),
                                                  shoulder_R=(0, 0, -1.5 * b * w), head=(-1.2 * b * w, 0, 0))),
                               (0.0, 0.0, -0.004 * b * w))
    out["recall"] = anim.Clip("recall", RECALL_FRAMES, True,
                              anim.drag(recall, RECALL_FRAMES, {"head": 2.0, "neck": 1.0, "hand.L": 1.0}, loop=True))

    # idle_lobby (120 f loop): the cleaver across his back, he breathes, tilts his head 5 degrees and nods at
    # something only he remembers; then he takes the cleaver off the shoulder, holds it upright in front of him and
    # runs his left thumb along the notches in its back as if counting, and shoulders it again by way of his right
    # side. (The brief's swap to the LEFT shoulder is not reachable: his right fist cannot reach past his face, so
    # the blade would cross the mask.) The cleaver travels upright in front of him or out on his right, never through
    # the head.
    # fix pass 8 (the review: the lobby / select screen / portrait showed the in-game yoke, a flat bar at mask height
    # coming out of the back of the head, the haft and pommel hidden, the heel behind the head): the lobby has no
    # health bar, so it rests in the CONCEPT's carry (lobby_carry): the cleaver laid diagonally across his back at
    # ~40 degrees in the front view, the right fist on the haft beside the jaw outside the plate, the wrapped haft and
    # the pommel's gem low at his right, the dark crenellated heel beside the mask, the blade rising behind and above
    # the head to his upper left (the tip ~0.75 m over the crown: the brief's hook). The loop holds it for most of the
    # 4 s (breathing, the head tilt and the nod at f20-f40); the notch count is the beat in front (f48-f90).
    lob = lobby_carry(R, anim.merge(stance_b(0.6), anim.arms_relaxed(), {"ik": carry_ik()}, _P(prop_L=FIST_CURL)))
    breath = anim.add(lob, _P(chest=(1.5, 0, 0), head=(-1.5, 0, 0)))
    tilt = anim.add(lob, _P(neck=(2, -3, 0), head=(4, -6, -5)))
    nod = anim.add(lob, _P(neck=(4, -3, 0), head=(14, -6, -5)))
    lower = _pose(lob, _P(chest=(0, 4, 0), head=(2, -4, 0)), (0, 0, 0),
                  one((-0.30, -0.62, 0.10), (0.06, -0.22, 0.97), (0.0, -0.97, 0.22), pole=(-0.9, 0.2, -0.4), left=BELT_L))
    present = _pose(lob, _P(chest=(2, 8, 0), spine=(0, 4, 0), head=(10, -6, 0), neck=(4, 0, 0)), (0, 0, -0.01),
                    one((0.10, -0.86, -0.36), (0.16, -0.38, 0.91), (0.0, -0.91, 0.38), pole=(-0.9, 0.2, -0.4), left=BELT_L))
    count0 = dict(present)
    count0["ik"] = dict(present["ik"], **{"hand.L": HT(rel=R.left_rel(present, 0.20), pole=(0.8, -0.4, -0.5))})
    count1 = dict(present)
    count1["ik"] = dict(present["ik"], **{"hand.L": HT(rel=R.left_rel(present, 0.44), pole=(0.8, -0.4, -0.5))})
    count1 = anim.add(count1, _P(head=(4, -2, 0)))
    nod1 = anim.add(count1, _P(head=(4, -4, -5)))           # (a tilt more than a nod: the bowed mask met the hand)
    unl = unsling(lob)
    keys = [(0.0, lob, "linear"), (0.09, breath, "sine"), (0.17, tilt, "inout"), (0.24, nod, "inout"),
            (0.30, tilt, "inout"), (0.36, lob, "inout"), (0.41, unl, "inout"), (0.47, lower, "inout"),
            (0.53, count0, "inout"), (0.61, count1, "inout"), (0.66, nod1, "inout"), (0.71, count1, "inout"),
            (0.76, present, "inout"), (0.82, lower, "inout"), (0.87, unl, "inout"), (0.94, lob, "inout"),
            (1.0, lob, "linear")]
    base = anim.keyed(keys)

    def lobby(t):
        b = anim.osc(t, 4)
        return anim.add(base(t), _P(chest=(1.6 * b, 0, 0), shoulder_L=(0, 0, 2.0 * b), shoulder_R=(0, 0, -2.0 * b)))
    out["idle_lobby"] = anim.Clip("idle_lobby", 120, True, anim.drag(lobby, 120, {"head": 3.0, "neck": 2.0}, loop=True))

    # victory: no celebration. Plant the tip, take a tally stick from the belt, score it with the thumbnail, nod;
    # the final hold: the cleaver planted at his right and the left hand held out, OPEN and palm up
    # ("you are forgiven")
    plant = anim.merge(stance_b(0.7), anim.arms_relaxed(),
                       {"ik": one(VIC_REL, (-0.10, -0.42, -0.90), (0.30, -0.90, -0.42), pole=(-0.9, 0.3, -0.3),
                                  left=BELT_L)}, _P(prop_L=FIST_CURL))
    take = anim.merge(plant, {"ik": {"hand.L": HT(rel=(0.02, -0.28, -0.85), pole=(0.9, 0.2, -0.3))}})
    take = anim.add(take, _P(head=(14, 0, 0), neck=(6, 0, 0)))
    score = anim.merge(plant, {"ik": {"hand.L": HT(rel=(-0.12, -0.62, -0.20), pole=(0.9, 0.3, -0.4))}})
    score = anim.add(score, _P(head=(16, 4, 0), neck=(6, 0, 0)))
    scratch = anim.add(score, _P(hand_L=(0, 0, 14)))
    nod = anim.add(score, _P(head=(8, 0, 0)))
    host = anim.merge(plant, {"ik": {"hand.L": HT(rel=VIC_HOST, pole=(0.9, -0.2, -0.6))}})
    host = with_hand(anim.add(host, _P(chest=(-4, 8, 0), head=(-4, 10, 0), shoulder_L=(0, 0, -2))), OPEN)
    host["ik"] = dict(host["ik"], **{"aim.L": palm_aim((0.10, -0.15, 0.98), (0.70, -0.68, -0.05))})   # palm up, open to his left
    plant, take, score, scratch, nod, host = (R.tip_to(x) for x in (plant, take, score, scratch, nod, host))
    keys = [(0.0, G, "linear"), (0.04, unsling(G), "inout"), (0.10, out_right(G), "inout"), (0.20, plant, "inout"),
            (0.32, take, "inout"),
            (0.44, score, "inout"),
            (0.48, scratch, "inout"), (0.52, score, "inout"), (0.60, nod, "inout"), (0.66, score, "inout"),
            (0.80, host, "inout"), (1.0, host, "linear")]
    vb = anim.keyed(keys)

    def victory(t):
        p = vb(t)
        if t > 0.8:
            p = anim.add(p, _P(chest=(0.8 * anim.osc(t, 2), 0, 0)))
        return p
    out["victory"] = anim.Clip("victory", 60, False, anim.drag(victory, 60, {"head": 2.0, "neck": 1.0}))

    # stunned (40 f loop): dazed, he staggers a half step back and recovers forward again, over and over: the
    # weight rocks back onto the right foot (it steps back, lifted between), the torso sways back and to the
    # side and the head lolls; then a half step forward, swaying the other way. The cleaver has slid off the
    # shoulder and hangs from the right fist, tip dragging on the ground ahead (its haft clear of the arm)
    hang = dict(one((-0.40, -0.30, -0.80), (0.20, -0.50, -0.84), (1.0, 0.0, 0.0), pole=(-0.9, 0.3, -0.2),
                    left=(0.30, -0.20, -0.88), lpole=(0.9, 0.3, -0.3)))
    back = _pose(G, _P(hips=(-4, 6, 3), spine=(6, 4, -3), chest=(10, 4, -4), neck=(10, -6, 6), head=(16, -8, 10)),
                 (0.02, 0.10, -0.07), dict(hang, **step(G, dr=(-0.03, 0.20, 0), dl=(0.02, 0.06, 0))))
    fwd = _pose(G, _P(hips=(6, -6, -3), spine=(10, -4, 3), chest=(12, -6, 4), neck=(12, 6, -6), head=(14, 10, -10)),
                (-0.02, -0.02, -0.06), dict(hang, **step(G, dr=(-0.02, 0.02, 0), dl=(0.03, -0.10, 0))))
    mid1 = anim.lerp_pose(back, fwd, 0.5)
    mid1["ik"] = dict(mid1["ik"], **{"foot.L": FT((0.025, -0.02, 0.05), 6.0, 8.0)})          # the left foot steps
    mid2 = anim.lerp_pose(fwd, back, 0.5)
    mid2["ik"] = dict(mid2["ik"], **{"foot.R": FT((-0.025, 0.17, 0.05), 6.0, -14.0)})        # the right foot steps
    back, fwd, mid1, mid2 = (R.tip_to(x, 0.02) for x in (back, fwd, mid1, mid2))
    sk = anim.keyed([(0.0, back, "linear"), (0.25, mid1, "inout"), (0.5, fwd, "inout"), (0.75, mid2, "inout"),
                     (1.0, back, "inout")])

    def stunned(t):
        a = anim.osc(t, 2, 0.1)
        return anim.add(sk(t), _P(head=(3 * a, 4 * a, 0), neck=(2 * a, 0, 0)))
    out["stunned"] = anim.Clip("stunned", 40, True, anim.drag(stunned, 40, {"head": 2.5, "neck": 1.5}, loop=True))

    # channel: the cleaver planted in front, both hands on the pommel, breathing deep, the weight rolling
    # fix pass 7: the same post as Stubborn's set (the pass-4 plant put the pommel and fists in the cowl: 66 / 73 hits)
    chan = _plant_two(R, 1.1, head=16.0, wrist=POST_W, d=POST_D, fold=POST_FOLD)
    chan = R.tip_to(anim.add(chan, _P(neck=(4, 0, 0), head=(6, 0, 0))), POST_TIP_Z)

    def channel(t):
        b, s = anim.osc(t, 2), anim.osc(t, 1, 0.2)
        p = anim.add(chan, _P(chest=(3.0 * b, 0, 0), spine=(1.0 * b, 0, 1.5 * s), shoulder_L=(0, 0, 2.5 * b),
                              shoulder_R=(0, 0, -2.5 * b), head=(-2.5 * b, 2.0 * s, 0)))
        return anim._with_hips(p, (0.015 * s, 0.0, -0.008 * b))
    out["channel"] = anim.Clip("channel", 40, True, anim.drag(channel, 40, {"head": 2.0, "neck": 1.0}, loop=True))
    return out


DEATH_KNEEL = 0.385         # the kneel's hip drop (share of the hip height)
DEATH_LIE = 0.36            # the hips' height lying face down (m)
DEATH_PLANT_REL = (-0.24, -0.82, -0.30)
REC_REL = (-0.22, -0.40, -0.17)
VIC_REL = (-0.22, -0.42, -0.16)
RECALL_FRAMES = 180                    # 6 s at 30 fps (three_load_test: loops at most 6 s, closed)
ULT_REACH = (0.95, -0.22, 0.02)        # the Settled Account reach (chest frame, arm lengths): out to the left, the
                                       # arm straight at shoulder height (fix pass 8: was (0.86, -0.36, 0.22), the
                                       # hand by the ear)
ULT_CLAW = (0.0, -28.0, 0.0)           # prop.L: the reaching fingers a little curled
# W5b: cast_ult's lift out of the carry (t: clip time of the key; body: how far the torso / left arm are toward the
# reach there; rel / d / roll / pole: the right fist (chest frame, arm lengths), the blade axis and its flat roll)
ULT_LIFT = dict(t=0.09, body=0.4, rel=(-0.62, 0.35, 0.58), d=(0.0, 0.72, 0.69), roll=5.0, pole=(-1.0, 0.25, -0.3))
ULT_ARC = dict(t=0.335, at=0.5, off=(-0.20, -0.12, 0.12))   # W5b: the swing's in-between, its fist pushed out to the right,
# forward and up (0.2 / 0.12 / 0.12 arm lengths): a wider overhead arc. A sweep on the build-2 cache, cleaver verts inside
# any body part but the arms, f13-f18: no arc 20/12/37/17/37/0 (f15: the front plate 27 + the coat) -> 20/3/9/17/37/0
# (picked by a sweep on the cached build, torso hits f2-f6: the fist out and up beside the back of the right shoulder,
# the blade still straight back but 44 degrees up (the carry's 30): f3 / f4 41 / 41 -> 0 / 0, f5 28 -> 20; a blade
# that leans out or steepens toward the reach (50 degrees) before the fist leaves the shoulder drives the pommel
# through the coat's back, 50-180 verts)
VIC_HOST = (0.36, -0.68, -0.60)        # the left hand held out to his front-left at the waist, arm long; fix pass 5:
                                       # more forward and lower (out to the side the tiers on the upper arm swung out
                                       # with it and met the vambrace: one pale sleeve from shoulder to wrist)
# fix pass 8: the lobby's CONCEPT carry (proto/burdam_carry6.py --lobby 40: the eye-level front angle ~40 degrees, the
# blade, the heel and the haft + pommel all in view from the front and the portrait's three-quarter, no hits): the
# right wrist beside the jaw outside the plate (armature space), the cleaver heading 10 degrees back from straight
# left at 38 degrees up (behind the head), its flat facing the viewer (roll 60: the front face turned a little up to
# the sky), the notched spine up and out
LOBBY_W = (-0.56, -0.03, 1.86)
LOBBY_D = (0.776, 0.137, 0.616)
LOBBY_UP = (0.153, 0.906, -0.394)
LOBBY_POLE = (-1.0, 0.1, -0.6)


def lobby_carry(R, base: dict) -> dict:
    """base with the right hand in the lobby's concept carry (the left fist stays at the belt)"""
    return R.place(base, LOBBY_W, LOBBY_D, LOBBY_UP, pole=LOBBY_POLE)


# ── the paint pose (project.paint_object wrapper) ─────────────────────────────────────────────────
def paint_pose(co: np.ndarray, part_of_vertex: np.ndarray, names: list, M: np.ndarray) -> np.ndarray:
    """rest-pose vertex positions -> where the concept paints them (the cleaver behind the head)"""
    out = co.copy()
    Minv = np.linalg.inv(M)
    for nm in CLEAVER:
        if nm not in names:
            continue
        sel = part_of_vertex == names.index(nm)
        if not sel.any():
            continue
        p = co[sel] @ Minv[:3, :3].T + Minv[:3, 3]                 # prop space
        out[sel] = cl.paint_xyz(nm, p[:, 2] + cl.U_GRIP, p[:, 1], p[:, 0])
    return out


# LAYERS: the mask and the cleaver overlap in the concept (the mask in front of the blade's root, the
# blade over the cranium from the back), so each paints from its own plates (proto/burdam_plates.py):
# the mask from burdam_head (the painted head, its rim extended; the cleaver hidden from the cameras),
# the cleaver from burdam_cleaver (the blade bridged behind the mask; the mask hidden), the rest from the
# plain plates. The head layer is also WARPED row by row so the model head's silhouette, as each camera
# sees it, spans the painted head (the back view paints the cranium narrower than the front's mask).
PAINT_LAYERS = (("burdam_head", ("mask",), CLEAVER), ("burdam_cleaver", CLEAVER, ("mask",)))
# value lift (brief section 6: the painting is darker than the bible bands, the body reads as one dark
# column in game): each part's paint is scaled in linear light toward its role's palette value,
# (target / painted mean) ** LIFT_ALPHA, never darker, at most LIFT_MAX
LIFT_ALPHA = 0.62
LIFT_MAX = 2.6
LIFT_SKIP = ("mask",) + CLEAVER
GRADED = ("cowl", "trousers", "boots", "tier1", "tier2", "tier3", "tier4", "shoulder_plate", "pauldron_lame", "vambrace",
          "strap_plate", "belt", "pauldron_face",
          "coat", "skirt", "tally")


def _lum(lin: np.ndarray) -> np.ndarray:
    return lin[..., 0] * 0.2126 + lin[..., 1] * 0.7152 + lin[..., 2] * 0.0722


def _lstar(Y):
    Y = np.asarray(Y, dtype=np.float64)
    f = np.where(Y > 0.008856, np.cbrt(Y), 7.787 * Y + 16 / 116)
    return 116 * f - 16


def _warp_head(plates, vis, mask_id: int, cache: str, log=print) -> None:
    """fit the painted head to the model head's visible silhouette, per plate side (in place)"""
    from common.hifi import project
    for side in ("front", "back"):
        reg = project.load_rgb(os.path.join(cache, f"burdam_head_region_{side}.png"))[..., 0] > 0.5
        pid = vis.part[side]
        s = vis.step
        mm = pid == mask_id
        if not mm.any() or not reg.any():
            continue
        img = plates.img[side]
        H, W = img.shape[:2]
        half = (0, W // 2) if side == "front" else (W // 2, W)
        rows_m = np.nonzero(mm.any(axis=1))[0]
        R0, R1 = rows_m[0] * s, (rows_m[-1] + 1) * s
        rows_p = np.nonzero(reg[:, half[0]:half[1]].any(axis=1))[0]
        r0, r1 = rows_p[0], rows_p[-1]
        # vertical: the model's visible head rows onto the painted ones (a gentle squeeze at most)
        k = (r1 - r0) / max(R1 - R0, 1)                          # crown to crown, then a gentle squeeze
        k = 1.0 if abs(k - 1.0) < 0.12 else float(np.clip(k, 0.78, 1.08))   # the front fits as painted
        A = np.full(H, np.nan)
        B = np.full(H, np.nan)
        for j in rows_m:
            cols = np.nonzero(mm[j])[0]
            A[j * s:(j + 1) * s] = cols[0] * s
            B[j * s:(j + 1) * s] = (cols[-1] + 1) * s
        a = np.full(H, np.nan)
        b = np.full(H, np.nan)
        for r in rows_p:
            cols = np.nonzero(reg[r, half[0]:half[1]])[0]
            a[r], b[r] = cols[0] + half[0] + 4, cols[-1] + half[0] - 3     # inside the painted outline
        rows = np.arange(H, dtype=np.float64)
        ok = ~np.isnan(a)
        a = np.interp(rows, rows[ok], a[ok])
        b = np.interp(rows, rows[ok], b[ok])
        okm = ~np.isnan(A)
        A = np.interp(rows, rows[okm], A[okm])
        B = np.interp(rows, rows[okm], B[okm])
        sm = lambda v: project.blur(v[:, None, None].astype(np.float32), 6.0)[:, 0, 0]  # noqa: E731
        A, B, a, b = sm(A), sm(B), sm(a), sm(b)
        y0, y1 = max(0, R0 - 24), min(H, R1 + 24)
        ys, xs = np.mgrid[y0:y1, half[0]:half[1]]
        src_r = np.clip(r0 + (ys - R0) * k, r0, r1).astype(np.float64)
        ri = np.clip(ys, 0, H - 1)
        sri = np.clip(src_r.astype(np.int64), 0, H - 1)
        Am, Bm = A[ri], B[ri]
        am, bm = a[sri], b[sri]
        t = (xs - Am) / np.maximum(Bm - Am, 4.0)
        src_x = am + t * (bm - am)
        band = (xs > Am - 24) & (xs < Bm + 24)
        col = project.bilinear(img, src_x + 0.5, src_r + 0.5)
        out = img.copy()
        sub = out[y0:y1, half[0]:half[1]]
        sub[band] = col[band]
        plates.img[side] = out
        mid = int(0.5 * (R0 + R1))
        log(f"burdam: head layer {side}: model rows {R0}-{R1} -> painted {r0}-{r1} (k {k:.2f}), "
            f"width at row {mid}: {B[mid] - A[mid]:.0f} px -> {b[int(src_r[mid - y0, 0])] - a[int(src_r[mid - y0, 0])]:.0f} px")


def _install_paint_layers() -> None:
    from common.hifi import project
    if getattr(project.paint_object, "_burdam", False):
        return

    def paint_object(obj, size, cfg, names, part_attr="vale_part", log=print, return_maps=False):
        from common import scene
        me = obj.data
        n = len(me.vertices)
        co = np.empty(n * 3, dtype=np.float32)
        me.vertices.foreach_get("co", co)
        co = co.reshape(n, 3)
        a = me.attributes.get(part_attr)
        pv = np.zeros(n, dtype=np.int64)
        if a is not None and a.domain == "POINT":
            a.data.foreach_get("value", pv)
        names = list(names)
        M = _STATE.get("prop")
        posed = paint_pose(co.astype(np.float64), pv, names, M).astype(np.float32) if M is not None else co.copy()
        cache = os.path.join(scene.CACHE_DIR, "concept")
        ids = {nm: i for i, nm in enumerate(names)}

        def setco(arr):
            me.vertices.foreach_set("co", arr.ravel())
            me.update()
        try:
            setco(posed)
            log("burdam: the cleaver painted in its concept pose (behind the head); mask + cleaver layers")
            maps = project.rasterize(obj, size, part_attr)
            flat = {k: scene.hex_srgb(h) for k, h in (cfg.get("flat") or {}).items()}
            part = maps["part"]
            have = part >= 0
            out = np.zeros((size, size, 3), dtype=np.float32)
            layered = set()
            jobs = []
            for fid, own, hide in PAINT_LAYERS:
                own_ids = [ids[x] for x in own if x in ids]
                layered.update(own_ids)
                jobs.append((fid, own_ids, [ids[x] for x in hide if x in ids]))
            rest = [i for i in range(len(names)) if i not in layered]
            jobs.insert(0, (cfg["concept"], rest, []))
            for fid, own_ids, hide_ids in jobs:
                if not own_ids:
                    continue
                plates = project.Plates(cache, fid, cfg["height"])
                if hide_ids:
                    moved = posed.copy()
                    moved[np.isin(pv, hide_ids)] += np.array([0.0, 0.0, -100.0], dtype=np.float32)
                    setco(moved)
                vis = project.VisibilityMaps.build(obj, plates, step=2, part_attr=part_attr)
                if hide_ids:
                    setco(posed)
                if fid == "burdam_head" and "mask" in ids:
                    _warp_head(plates, vis, ids["mask"], cache, log=log)
                sub = dict(maps)
                sub["part"] = np.where(np.isin(part, own_ids), part, -1).astype(part.dtype)
                img = project.paint(sub, plates, vis, names, tops=None, flat=flat, bleed=False, log=log)
                sel = np.isin(part, own_ids)
                out[sel] = img[sel]
            if os.environ.get("BURDAM_PAINT_DUMP"):                     # the raw projection, for post-paint work
                np.savez_compressed(os.environ["BURDAM_PAINT_DUMP"], img=out, P=maps["P"], N=maps["N"],
                                    part=maps["part"], names=np.array(names))
                log(f"burdam: raw paint dumped to {os.environ['BURDAM_PAINT_DUMP']}")
            out = _post_paint(out, maps, names, log=log)
            iy, ix = project.nearest_index(have)
            out = out[iy, ix]
            return (out, maps) if return_maps else out
        finally:
            setco(co)

    paint_object._burdam = True
    project.paint_object = paint_object


def _post_paint(img: np.ndarray, maps: dict, names: list, log=print) -> np.ndarray:
    """the value lift per part (brief section 6) and the cleaver's crisp painted rim (section 4)"""
    from common import scene
    from common.hifi import project
    part = maps["part"]
    lin = project._lin(img)
    out = lin.copy()
    roles = {nm: r for (nm, _S, _v, r, _b, _t, _sp) in sculpts() + skin_extras({"reed_plates": 1, "river_glass": 1,
                                                                                     "almanac_board": 1})}
    if "mask" in names:
        # the cranium (back plate) is painted a paler, cooler ochre than the face (front plate): pull the back
        # half's mean onto the face's so the whole head reads as one gold lacquer, crown included
        m = part == names.index("mask")
        ny = maps["N"][..., 1][m]
        pz = maps["P"][..., 2][m]
        c = out[m]
        front, back = (ny < -0.5) & (pz > 1.97), (ny > 0.25) & (pz > 2.0)     # the painted face / cranium
        if front.any() and back.any():
            g = np.clip(np.median(c[front], axis=0) / np.maximum(np.median(c[back], axis=0), 1e-4), 0.7, 1.4)
            w = np.clip((ny + 0.25) / 0.6, 0.0, 1.0)[:, None]
            c = c * (1.0 + (g - 1.0) * w)
            log(f"burdam: cranium matched to the face, gain {np.round(g, 2).tolist()}")
        out[m] = c
    report = []
    for i, nm in enumerate(names):
        m = part == i
        if not m.any() or nm in LIFT_SKIP or nm in SKIN_FLAT or nm in GRADED:
            continue
        role = roles.get(nm)
        hexv = PALETTE.get(role) if isinstance(PALETTE, dict) else None
        if not hexv or role == "accent":
            continue
        Ym = float(np.mean(_lum(lin[m])))
        Yt = float(_lum(project._lin(np.asarray(scene.hex_srgb(hexv), dtype=np.float32))))
        g = float(np.clip((Yt / max(Ym, 1e-4)) ** LIFT_ALPHA, 1.0, LIFT_MAX))
        out[m] = lin[m] * g
        report.append(f"{nm} L*{_lstar(Ym):.0f}->{_lstar(Ym * g):.0f} (role {role} L*{_lstar(Yt):.0f})")
    log("burdam: value lift " + ", ".join(report))
    out = cowl_mirror(out, maps, names, log=log)
    out = grade_parts(out, maps, names, log=log)
    out = mask_paint(out, maps, names, log=log)
    out = blade_back(out, maps, names)
    out = blade_rim(out, maps, names)
    out = heel_paint(out, maps, names)
    return project._srgb(out).astype(np.float32)


def blade_rim(lin: np.ndarray, maps: dict, names: list) -> np.ndarray:
    """The blade's painted rim, which the plate cut erodes (9 px): a thin dark outline round the blade,
    the honed edge band (one step lighter, never above L* 84) with its bevel line, a pale highlight under
    the spine and darker chips where the edge is nicked. Drawn from each texel's cleaver (u, v) (the
    texels sit in the paint pose)."""
    if "blade" not in names:
        return lin
    P, part = maps["P"], maps["part"]
    bl = part == names.index("blade")
    if not bl.any():
        return lin
    u, v = cl.to_uv(P[..., 0][bl], P[..., 2][bl])
    ve, vs = cl.v_edge(u), cl.v_spine(u)
    de = v - ve                                  # in from the cutting edge (m)
    ds = vs - v                                  # in from the spine
    d_out = np.minimum(de, ds)
    tip = np.clip((1.437 - u) / 0.02, 0, 1)
    c = lin[bl].copy()
    Y = _lum(c)[:, None]
    band = np.clip(1.0 - np.abs(de - 0.018) / 0.014, 0, 1) * tip           # the honed band (3-32 mm in)
    bevel = np.clip(1.0 - np.abs(de - 0.036) / 0.0035, 0, 1) * (u > 0.25)   # the bevel line
    shine = np.clip(1.0 - np.abs(ds - 0.008) / 0.004, 0, 1)                # light under the spine
    rim = np.clip(1.0 - d_out / 0.0045, 0, 1)                              # the outline
    hon = np.array([0.40, 0.41, 0.385], dtype=np.float32)                  # L* ~70, level with the flat (fix pass 4: the
    c = c * BLADE_GAIN                                                      # bevel faces the splash sun and blew to white)
    c = c * (1 - 0.55 * band[:, None]) + hon * 0.55 * band[:, None]
    c = c * (1 - 0.25 * bevel[:, None])                                   # the bevel line, a quarter darker
    c = c + (hon - c) * 0.2 * shine[:, None]
    ink = np.array([0.035, 0.032, 0.03], dtype=np.float32)
    c = c * (1 - 0.8 * rim[:, None]) + ink * 0.8 * rim[:, None]
    # chips: short dark nicks into the edge at the outline's dents and a few scattered along it
    nick = np.zeros_like(u)
    for uc, w in ((0.61, 0.012), (0.74, 0.012), (0.93, 0.006), (1.08, 0.008), (1.19, 0.006)):
        nick = np.maximum(nick, np.clip(1.0 - np.hypot((u - uc) / w, de / 0.016), 0, 1))
    c = c * (1 - 0.6 * nick[:, None]) + ink * 0.6 * nick[:, None]
    # a few short scratches (fix pass 4: the two long crack lines read as a string across the flat in the portrait)
    for (u0, v0, u1, v1) in ((0.66, 0.03, 0.70, 0.038), (0.84, 0.06, 0.875, 0.052), (1.06, 0.07, 1.09, 0.062)):
        du, dv = u1 - u0, v1 - v0
        L = math.hypot(du, dv)
        t = np.clip(((u - u0) * du + (v - v0) * dv) / (L * L), 0, 1)
        dd = np.hypot(u - (u0 + t * du), v - (v0 + t * dv))
        ln = np.clip(1.0 - dd / 0.0018, 0, 1) * np.sin(np.pi * t) ** 0.5
        c = c * (1 - 0.3 * ln[:, None]) + ink * 0.3 * ln[:, None]
    del Y
    out = lin.copy()
    out[bl] = c
    return out


RUST_PARTS = ("tier1", "tier2", "tier3", "tier4", "shoulder_plate", "pauldron_lame", "vambrace", "strap_plate",
              "pauldron_face")
BLADE_GAIN = 0.72         # (polish: 0.62 -> 0.72, the value lift: the blade is a third of the top quarter in game)
                          # the blade's painted value two steps down (linear; L* ~80 -> ~73): the splash's sun and
                          # bloom lifted the flat to L* 86-97 (brief: never above 85); in game it still reads as light stone

# ── post-paint, fix pass 2: the reads the projection alone gets wrong ────────────────────────────────
# Targets are painted MEANS (sRGB hex) per part; each part keeps its own painted value detail (a value tint,
# see _tint). Brief section 3/5/6: the lacquered mask is the brightest value and only a pale ochre (not
# gold), framed by the concept's dark felt cowl; the pauldrons are neutral grey stone stained only in the
# recesses; the legs darken toward the feet.
# VALUE LIFT (polish pass; the Wave B environment verify: with the shared character light Burdam was the darkest kit in
# game, top-25 L* 57.5 / 59.8 on RIFT, only 20-22 over the lane, where the bar is >= 70 and >= 30 over it): the top of
# the figure carries it in its own albedo, not a brighter rig. Seen from the game camera and from behind (RIFT's spot
# walks him away from it) the top quarter is the cowl, the crown, both pauldrons and the blade, so those step up; the
# coat, belt and legs stay dark (the brief's light-top / dark-feet gradient; the review: the coat, the belt, the cowl
# and the plates sat in one taupe family)
MASK_FACE = "#D6BB7A"         # the lit face's mean: the concept's ochre-gold lacquer, L* ~77 (polish: was #C6A55E, L* 69;
                              # the review measured the splash mask L* 65 against the concept's 81; fix pass 5: pale ochre
                              # rendered bone-white in game and the crown read as a bald skull from the top-down camera)
CROWN_DARK = 0.10             # the crown's lacquer a step darker toward the back (polish: half the pass-5 0.20, the crown is
                              # the top of the figure from the game camera)
COWL_MEAN = "#8E7B66"         # polish: the concept's warm taupe felt (L* ~53, b* ~+14; was #6A5845, L* 39: from the RIFT
                              # probe's spot the cowl is 16 % of his pixels and 40 % of it sits in the top quarter); a
                              # flat #9A8670 (L* 57) blew the splash's sunlit folds past L* 86 (35 %) and matched the mask,
                              # so the lift goes to the faces the game camera sees (COWL_TOP_GAIN); fix pass 8: #4F4943
                              # rendered a cool charcoal, near black round the mask in the portrait
COWL_TOP_GAIN = 1.45          # polish: linear gain on the felt's upward faces (N.z 0.05 -> 0.65), the game camera's view
                              # (1.6 measured RIFT 71.8 but the splash's sun put 32 % of the cowl's top folds past L* 86)
COWL_UNDER_DARK = 0.15        # ... and the darkening of its downward faces (the folds' undersides)
COAT_TOP_GAIN = 1.45          # polish: the coat's shoulders and upper back a step lighter than its mean (linear gain at
COAT_TOP_Z = (1.25, 1.58)     # z >= 1.58 m, none below 1.25: the bible's light top, the hem stays the concept's dark felt)
BELT_MEAN = "#45311F"         # polish: the belt and its buckle strap the darkest leather on the torso (the review: belt L* 43
                              # beside a coat L* 44; the concept's straps sit clearly darker than the felt)
TROUSER_MEAN = "#504236"      # dark trousers (feet band); fix pass 8 a greyer taupe (the brief's `under` family), so the
                              # warm leather boots and their wraps separate from them (the review: one brown mass)
BOOT_MEAN = "#3F2D20"         # dark waxed-leather boots (warm brown: cooler browns read mauve outdoors; fix pass 4
                              # a step darker: the splash lit them tan)
INK_TALLY = "#3A2915"         # the cut tallies' ink
COAT_MEAN = "#634D3A"         # fix pass 4: the felt coat a darker umber, the concept's warm brown (L* ~34, hue 29; the lifted
                              # painting read peach / salmon, L* 59 in the QA render, against the concept's dark felt)
SKIRT_MEAN = "#5B4636"        # the coat's skirt a step darker toward the feet (L* ~31)
TALLY_WOOD = "#7A5C3E"        # the carved tally sticks: mid ochre wood (the concept's light sticks on the dark coat)
TALLY_CUT = "#2A1E14"         # their tally cuts
FELT_SHADOW = "#3A362F"       # under the chin, where the mask meets the felt roll
HEEL_STONE = "#504C48"        # the ironstone spine band
HEEL_CHALK = "#8E8983"        # chalked convex edges
# tally groups on the mask: (x centre, z centre) on the face (front) and on the cranium (back); crown groups
# (x, y centre) on top, seen from the game camera
# fix pass 5: the concept's layout, fewer and bolder: two rows of three on the forehead, one group on each cheekbone
# plane, two small ones on the chin under the frown (nine fine groups on the brow read as pock dots at range)
TALLY_FRONT = [(-0.074, 2.101), (-0.012, 2.104), (0.050, 2.101),
               (-0.078, 2.071), (-0.012, 2.073), (0.054, 2.071),
               (-0.096, 1.951), (0.072, 1.951)]
TALLY_CHIN = [(-0.040, 1.848), (0.016, 1.848)]
# fix pass 4: no tallies on the crown (from the 52 degree camera 1-2 px strokes on the dome read as speckle, a
# pock-marked skull); the back of the head carries four bold groups (the concept's back view), the dome clean lacquer
TALLY_BACK = [(-0.052, 2.072), (0.062, 2.068), (-0.058, 1.995), (0.056, 1.992)]
TALLY_CROWN: list = []


def _hexlin(h) -> np.ndarray:
    from common import scene
    from common.hifi import project
    return project._lin(np.asarray(scene.hex_srgb(h), dtype=np.float32))


def _tint(c: np.ndarray, target, contrast: float = 1.0, keep: float = 0.2, mean=None) -> np.ndarray:
    """re-colour texels (linear) to a painted MEAN `target` (hex): the target colour times each texel's
    luminance relative to the mean (its painted value detail, scaled by `contrast`), plus `keep` of the
    painting's own hue variation"""
    t = _hexlin(target)
    mean = c.mean(axis=0) if mean is None else mean
    Ym = max(float(_lum(mean[None])[0]), 1e-5)
    l = np.clip(_lum(c) / Ym, 0.05, 3.0)
    l = 1.0 + (l - 1.0) * contrast
    hue = c / np.maximum(mean, 1e-5) * t                 # the painting's own colour variation, re-centred
    return np.clip((t[None] * l[:, None]) * (1.0 - keep) + hue * keep, 0.0, None)


def _shift(img: np.ndarray, dy: int, dx: int) -> np.ndarray:
    out = np.empty_like(img)
    H, W = img.shape[:2]
    ys = slice(max(dy, 0), H + min(dy, 0))
    yd = slice(max(-dy, 0), H + min(-dy, 0))
    xs = slice(max(dx, 0), W + min(dx, 0))
    xd = slice(max(-dx, 0), W + min(-dx, 0))
    out[...] = img
    out[yd, xd] = img[ys, xs]
    return out


def _filt(img: np.ndarray, r: int, fn) -> np.ndarray:
    """separable max / min filter (square window 2r+1)"""
    out = img
    for axis in (0, 1):
        acc = out.copy()
        for d in range(1, r + 1):
            for sgn in (-1, 1):
                acc = fn(acc, _shift(out, sgn * d if axis == 0 else 0, sgn * d if axis == 1 else 0))
        out = acc
    return out


def _closing(img: np.ndarray, r: int) -> np.ndarray:
    return _filt(_filt(img, r, np.maximum), r, np.minimum)


def _seg_d(x, z, x0, z0, x1, z1):
    dx, dz = x1 - x0, z1 - z0
    t = np.clip(((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz), 0.0, 1.0)
    return np.hypot(x - (x0 + t * dx), z - (z0 + t * dz))


def tally_ink(a: np.ndarray, b: np.ndarray, groups, half_len=0.0145, gap=0.0068, width=0.0017, seed=0) -> np.ndarray:
    """coverage (0..1) of crisp tally groups at surface coords (a, b): four strokes along b and one slash"""
    cov = np.zeros_like(a)
    rng = np.random.default_rng(seed)
    for (ca, cb) in groups:
        tilt = rng.uniform(-0.06, 0.06)
        for i in range(4):
            x0 = ca + (i - 1.5) * gap
            ln = half_len * rng.uniform(0.9, 1.05)
            d = _seg_d(a, b, x0 - tilt * ln, cb - ln, x0 + tilt * ln, cb + ln)
            cov = np.maximum(cov, np.clip((width - d) / 0.0007 + 0.5, 0.0, 1.0))
        d = _seg_d(a, b, ca - 2.6 * gap, cb - 0.55 * half_len, ca + 2.6 * gap, cb + 0.65 * half_len)
        cov = np.maximum(cov, np.clip((width - d) / 0.0007 + 0.5, 0.0, 1.0))
    return cov


def mask_paint(lin: np.ndarray, maps: dict, names: list, log=print) -> np.ndarray:
    """the ledger mask: painted tallies lifted out (a grey closing in texture space removes thin dark
    strokes), the keel's light streak below the nose evened out, the lacquer graded to a pale ochre (the
    brightest surface), crisp tally groups cut back in (fives: four strokes and a slash), the eye recesses
    inked, and the mask below the chin (the neck plug the felt roll covers) painted as the felt's shadow"""
    from common.hifi import project
    if "mask" not in names:
        return lin
    P, N, part = maps["P"], maps["N"], maps["part"]
    m = part == names.index("mask")
    if not m.any():
        return lin
    out = lin.copy()
    # 1. lift the painted tally strokes: close the luminance (dark strokes up to ~9 px wide vanish)
    iy, ix = project.nearest_index(m)
    filled = out[iy, ix]
    g = np.power(np.clip(_lum(filled), 0, None), 1 / 2.2)
    gc = _closing(g, 4)
    clo = _closing(filled, 4)
    x, y, z = P[..., 0], P[..., 1], P[..., 2]
    ny = N[..., 1]
    keep_geo = (m & (ny < -0.3) & (((z > 1.842) & (z < 1.884) & (np.abs(x + 0.012) < 0.085))))   # the frown
    lift = m & ((gc - g) > 0.035) & ~keep_geo
    out[lift] = clo[lift]
    # 2. the lower face evened (fix pass 5: the concept's nose shadow, projected, ran as a dark olive band from under
    # the nose through the frown to the chin): every front texel from the nose's base down to the chin takes its
    # z-row's MEDIAN lacquer (robust to the streak) within 7.5 cm of the keel, feathered over 2 cm; the frown is
    # re-inked from its carved path below (step 4)
    face = m & (ny < -0.35)
    xs = x + 0.012
    band = face & (z > 1.826) & (z < 1.915) & (np.abs(xs) < 0.095)
    src = face & (z > 1.826) & (z < 1.915) & (np.abs(xs) > 0.03) & (np.abs(xs) < 0.11)
    if band.any() and src.any():
        nb = 23
        zb_s = np.clip(((z[src] - 1.826) / 0.004).astype(np.int64), 0, nb - 1)
        med = np.zeros((nb, 3))
        ok = np.zeros(nb, dtype=bool)
        cs = out[src]
        for k in range(nb):
            sel = zb_s == k
            if sel.sum() >= 8:
                med[k] = np.median(cs[sel], axis=0)
                ok[k] = True
        if ok.any():
            idx = np.arange(nb)
            for ch in range(3):
                med[:, ch] = np.interp(idx, idx[ok], med[ok, ch])
            zb = np.clip(((z[band] - 1.826) / 0.004).astype(np.int64), 0, nb - 1)
            wx = np.clip((0.075 - np.abs(xs[band])) / 0.02 + 1.0, 0.0, 1.0)
            wz = np.clip((1.915 - z[band]) / 0.01, 0.0, 1.0) * np.clip((z[band] - 1.826) / 0.008, 0.0, 1.0)
            wgt = (wx * wz)[:, None]
            out[band] = out[band] * (1 - wgt) + med[zb] * wgt
    # 3. the lacquer grade: the lit face's mean onto MASK_FACE; the cranium follows the same change
    fm = face & (z > 1.90)
    mean_face = out[fm].mean(axis=0) if fm.any() else out[m].mean(axis=0)
    out[m] = _tint(out[m], MASK_FACE, contrast=0.85, keep=0.25, mean=mean_face)
    # the dome evened out: the top's painted value noise (leftover strokes, pores) pulled 70 % toward a smooth
    # version, so the crown reads as one lacquered shell from the game camera, not a pock-marked skull
    dome = m & (N[..., 2] > 0.35) & (P[..., 2] > 2.04)
    if dome.any():
        iy2, ix2 = project.nearest_index(m)
        fill2 = out[iy2, ix2]
        sm = project.blur(fill2.astype(np.float32), 5.0)
        out[dome] = out[dome] * 0.3 + sm[dome] * 0.7
    # the crown a step darker toward the back, so the dome reads as lacquer from the top-down camera (not a pale skull)
    up_ = np.clip((N[..., 2][m] - 0.25) / 0.5, 0.0, 1.0)
    back = np.clip((P[..., 1][m] + 0.06) / 0.16, 0.0, 1.0)
    out[m] = out[m] * (1.0 - CROWN_DARK * up_ * (0.45 + 0.55 * back))[:, None]
    # 4. crisp tallies, cut in ink: the face, the back of the cranium, the crown
    cov = np.zeros(m.sum())
    xm, ym, zm, nym, nzm = x[m], y[m], z[m], ny[m], N[..., 2][m]
    fr = nym < -0.3
    bk = nym > 0.3
    cr = nzm > 0.55
    # fix pass 8 (the review: the lower-face tallies and the frown blurred in the splash): the chin groups and the
    # frown cut bolder
    cov[fr] = tally_ink(xm[fr], zm[fr], TALLY_FRONT, half_len=0.0135, gap=0.0068, width=0.0021, seed=1)
    cov[fr] = np.maximum(cov[fr], tally_ink(xm[fr], zm[fr], TALLY_CHIN, half_len=0.0120, gap=0.0064, width=0.0024,
                                            seed=4))
    cov[bk] = np.maximum(cov[bk], tally_ink(-xm[bk], zm[bk], TALLY_BACK, half_len=0.019, gap=0.0085, width=0.0023,
                                            seed=2))
    if TALLY_CROWN:
        cov[cr] = np.maximum(cov[cr], tally_ink(xm[cr], -ym[cr], TALLY_CROWN, half_len=0.02, gap=0.0085, width=0.0024,
                                                seed=3))
    ink = _hexlin(INK_TALLY)
    c = out[m]
    c = c * (1 - 0.72 * cov[:, None]) + ink * 0.72 * cov[:, None]
    # the set frown re-inked along its carved path (the band evening above flattened its painted shadow)
    fz = np.full(m.sum(), 1.0)
    path = [(-0.083, 1.853), (-0.045, 1.874), (0.025, 1.874), (0.062, 1.853)]
    for (x0, z0), (x1, z1) in zip(path[:-1], path[1:]):
        fz = np.minimum(fz, _seg_d(xm, zm, x0, z0, x1, z1))
    frown = np.clip(1.0 - (fz - 0.0045) / 0.003, 0.0, 1.0) * (nym < -0.3)
    c = c * (1 - 0.72 * frown[:, None]) + ink * 0.72 * frown[:, None]
    # 5. the ink eye recesses: the almond (lens) cuts of the sculpt, inked where the texel lies on their surface
    eye = np.zeros(m.sum(), dtype=bool)
    Pm = np.stack([xm, ym, zm], axis=1)
    for sx, xc in EYES:
        eye |= (eye_lens(sx, xc).d(Pm) < 0.0035) & (ym < -0.12)
    c[eye] = c[eye] * 0.15 + _hexlin("#17181B") * 0.85
    # 6. below the chin: the felt roll's shadow (the neck plug and the chin's underside); fix pass 5 a little lower,
    # so the chin (its two tally groups) shows under the frown
    w = np.clip((1.840 - zm) / 0.012, 0.0, 1.0)[:, None]
    c = c * (1 - w) + _hexlin(FELT_SHADOW) * w
    out[m] = c
    log(f"burdam: mask paint: {int(lift.sum())} stroke texels lifted, face mean "
        f"{np.round(project._srgb(mean_face) * 255).astype(int).tolist()} -> {MASK_FACE}, "
        f"tally texels {int((cov > 0.5).sum())}")
    return out


def cowl_mirror(lin: np.ndarray, maps: dict, names: list, log=print) -> np.ndarray:
    """fix pass 6 (the review: a cluster of dark slate blocks between the cowl and the left pauldron, a rock pushing
    out of the scarf): the felt roll is wider than the concept's scarf on his left, so the projection painted the
    concept's shadowed pauldron blocks onto it there. The cowl's left side takes the felt painted on its right
    side instead (each texel the colour of the texel nearest its mirror point), blended in over 8 cm"""
    if "cowl" not in names:
        return lin
    from mathutils.kdtree import KDTree
    m = maps["part"] == names.index("cowl")
    if not m.any():
        return lin
    P = maps["P"][m].astype(np.float64)
    c = lin[m].copy()
    src = np.nonzero(P[:, 0] < -0.03)[0]
    dst = np.nonzero(P[:, 0] > 0.06)[0]
    if not len(src) or not len(dst):
        return lin
    kd = KDTree(len(src))
    for i, k in enumerate(src):
        kd.insert(P[k], i)
    kd.balance()
    c0 = lin[m]
    for k in dst:
        q = P[k].copy()
        q[0] = -q[0]
        _co, i, _d = kd.find(q)
        w = min(1.0, (P[k, 0] - 0.06) / 0.08)
        c[k] = c[k] * (1.0 - w) + c0[src[i]] * w
    out = lin.copy()
    out[m] = c
    log(f"burdam: cowl left side re-painted from its right side ({len(dst)} texels)")
    return out


def heel_paint(lin: np.ndarray, maps: dict, names: list) -> np.ndarray:
    """the ironstone spine band painted from its own geometry (the concept's heel no longer lines up with the
    scalloped band): dark stone mottled in two scales, chalked convex edges round the outline and the
    bites, the carved border groove, raised settings round the inlays, darker side faces, a few nicks"""
    if "heel" not in names:
        return lin
    P, N, part = maps["P"], maps["N"], maps["part"]
    hm = part == names.index("heel")
    if not hm.any():
        return lin
    out = lin.copy()
    u, v = cl.to_uv(P[..., 0][hm], P[..., 2][hm])
    d = cl.sd_polygon(u, v, cl.HEEL)
    for nu in cl.NOTCHES:
        cu, cv, r = cl.notch_circle(nu)
        d = np.maximum(d, r - np.hypot(u - cu, v - cv))
    depth = np.maximum(-d, 0.0)                                   # in from the outline (m)
    q = np.stack([u * 1.0, v * 1.0, np.zeros_like(u)], axis=1)
    mott = 0.86 + 0.16 * NOISE.fbm(q, 14.0, 3) + 0.06 * NOISE.fbm(q, 55.0, 2)
    base = _hexlin(HEEL_STONE)[None] * mott[:, None]
    chalk = np.clip(1.0 - depth / 0.011, 0.0, 1.0) ** 1.5
    c = base * (1 - 0.65 * chalk[:, None]) + _hexlin(HEEL_CHALK)[None] * 0.65 * chalk[:, None]
    groove = np.clip(1.0 - np.abs(depth - 0.024) / 0.0035, 0.0, 1.0) * (v < 0.07)
    c = c * (1 - 0.6 * groove[:, None])
    for poly in cl.gem_polys():                                        # the inlays' raised settings
        k = cl.sd_polygon(u, v, poly)
        ring = np.clip(1.0 - np.abs(k - 0.006) / 0.0035, 0.0, 1.0)
        c = c * (1 - 0.45 * ring[:, None]) + _hexlin("#7C7771")[None] * 0.45 * ring[:, None]
        seat = k < 0.0
        c[seat] = c[seat] * 0.55
    side = np.abs(N[..., 1][hm]) < 0.5
    c[side] = c[side] * 0.8
    nick = np.zeros_like(u)
    for (uc, vc) in ((0.09, 0.128), (0.20, 0.126), (0.31, 0.129), (0.42, 0.127), (0.53, 0.12), (0.02, -0.09)):
        nick = np.maximum(nick, np.clip(1.0 - np.hypot((u - uc) / 0.007, (v - vc) / 0.012), 0.0, 1.0))
    c = c * (1 - 0.5 * nick[:, None])
    out[hm] = c
    return out


def _grid_fill(acc: np.ndarray, ok: np.ndarray, iters: int = 400) -> np.ndarray:
    """fill the empty cells of a small (u, v) grid from their filled neighbours (grown outward)"""
    acc, ok = acc.copy(), ok.copy()
    for _ in range(iters):
        if ok.all():
            break
        s = np.zeros_like(acc)
        n = np.zeros(ok.shape)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sh_ok = _shift(ok.astype(np.float64), dy, dx)
            s += _shift(acc * ok[..., None], dy, dx)
            n += sh_ok
        grow = ~ok & (n > 0)
        acc[grow] = s[grow] / n[grow][:, None]
        ok = ok | grow
    return acc


def blade_back(lin: np.ndarray, maps: dict, names: list) -> np.ndarray:
    """the blade's back face takes its front face's honed paint (the back plate paints it as grainy grey
    noise): a (u, v) grid of the front texels' colour, sampled by every back texel"""
    from common.hifi import project
    if "blade" not in names:
        return lin
    P, N, part = maps["P"], maps["N"], maps["part"]
    bl = part == names.index("blade")
    if not bl.any():
        return lin
    u, v = cl.to_uv(P[..., 0][bl], P[..., 2][bl])
    ny = N[..., 1][bl]
    S, U0, V0 = 0.003, -0.10, -0.14
    GU, GV = int(1.65 / S), int(0.34 / S)
    iu = np.clip(((u - U0) / S).astype(np.int64), 0, GU - 1)
    iv = np.clip(((v - V0) / S).astype(np.int64), 0, GV - 1)
    c = lin[bl]
    fr = ny < -0.2
    acc = np.zeros((GU, GV, 3))
    cnt = np.zeros((GU, GV))
    np.add.at(acc, (iu[fr], iv[fr]), c[fr])
    np.add.at(cnt, (iu[fr], iv[fr]), 1.0)
    ok = cnt > 0
    if not ok.any():
        return lin
    acc[ok] /= cnt[ok][:, None]
    acc = _grid_fill(acc, ok)
    bk = ny > 0.2
    c[bk] = acc[iu[bk], iv[bk]]
    out = lin.copy()
    out[bl] = c
    return out


def tally_paint(c: np.ndarray, P: np.ndarray, N: np.ndarray) -> np.ndarray:
    """the carved tally sticks painted from their own geometry (the projection streaks thin sticks): ochre wood
    with a grain along each stick, darker sides and ends, and tally cuts across the face (groups of four strokes
    and a slash, a different count per stick); a trace of the projected value rides on top"""
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    out = np.empty_like(c)
    wood = _hexlin(TALLY_WOOD)
    cut = _hexlin(TALLY_CUT)
    Yc = _lum(c)
    trace = 1.0 + 0.25 * (Yc / max(float(Yc.mean()), 1e-5) - 1.0)
    for sy, sticks in ((-1.0, TALLY_FRONT_STICKS), (1.0, TALLY_BACK_STICKS)):
        sel = (np.sign(y) == sy)
        if not sel.any():
            continue
        xs = np.array([st[0] for st in sticks])
        i = np.argmin(np.abs(x[sel, None] - xs[None, :]), axis=1)
        dx = x[sel] - xs[i]
        zt = 1.235 - z[sel]                                            # down from the stick's top
        ln = np.array([st[1] for st in sticks])[i] * 2.0
        q = np.stack([x[sel] * 3.0, y[sel] * 3.0, z[sel] * 0.6], axis=1)
        grain = 0.9 + 0.1 * np.sin(dx * 520.0 + 3.0 * NOISE.fbm(q, 9.0, 2)) + 0.06 * NOISE.fbm(q, 30.0, 2)
        col = wood[None] * (grain * trace[sel])[:, None]
        n = N[sel]
        side = np.abs(n[:, 1]) < 0.45
        col[side] *= 0.62
        col[np.abs(n[:, 2]) > 0.7] *= 0.55                               # the end grain
        cov = np.zeros(len(zt))
        for k in range(len(xs)):
            s_ = i == k
            n_cuts = 3 + (k * 2) % 3                                    # 3-5 strokes, a slash over the full fives
            z0 = 0.07 + 0.012 * (k % 2)
            for j in range(n_cuts):
                zc = z0 + j * 0.016
                d = np.abs(zt[s_] - zc)
                cov[s_] = np.maximum(cov[s_], np.clip((0.0026 - d) / 0.0009, 0, 1) * (np.abs(dx[s_]) < 0.016))
            if n_cuts >= 4:
                zc = z0 + 0.5 * (n_cuts - 1) * 0.016
                d = np.abs((zt[s_] - zc) - 1.6 * dx[s_]) / math.hypot(1.0, 1.6)
                cov[s_] = np.maximum(cov[s_], np.clip((0.0024 - d) / 0.0009, 0, 1) * (np.abs(dx[s_]) < 0.018))
            # a second, smaller group lower down the longer sticks
            if ln[s_].size and float(ln[s_].mean()) > 0.205:
                for j in range(3):
                    zc = 0.15 + j * 0.014
                    d = np.abs(zt[s_] - zc)
                    cov[s_] = np.maximum(cov[s_], np.clip((0.0022 - d) / 0.0009, 0, 1) * (np.abs(dx[s_]) < 0.014))
        cov[side] *= 0.3
        col = col * (1 - 0.85 * cov[:, None]) + cut[None] * 0.85 * cov[:, None]
        out[sel] = col
    rest = ~((np.sign(y) == -1.0) | (np.sign(y) == 1.0))
    out[rest] = c[rest]
    return out


# fix pass 5 (the review: the pauldron read as soft cool-white plaster or a draped sheet, no bevels, no dark seams,
# no warm rust): the oxidised-stone plates are PAINTED FROM THEIR GEOMETRY, the concept's way: warm grey tops, a
# chalked light bevel on every convex edge, darker side bands, dark rust-brown recesses where a tier tucks under the
# one above and along every concave crease; the projected painting rides on top as texture only (a third of its
# value variation). Means a step under the brief's rust (L* 69): lit from above the tops land near the concept's
# L* 56-62 and the mask stays the brightest value on the figure.
STONE_TOP = "#B9AC99"          # warm grey top faces (L* ~71; polish: was #9E9282, L* 61, the value lift; b* ~+11: three.js's
                               # sky light cools a neutral grey); fix pass 8 a step lighter (the stack's splash median L* 47
                               # against the concept's 65)
STONE_CHALK = "#CEC2AE"        # chalked convex bevels (L* ~79; was #C3B6A2, 75)
STONE_SIDE = "#8A7C6C"         # the 8 cm side bands (L* ~53; was #776A5C, 46)
STONE_RECESS = "#3E2D21"       # rust-brown recesses and creases (L* ~20)
STONE_DARKER = {"vambrace": 0.70, "strap_plate": 0.78}   # forearm plates a step down: the vambrace never merges with the
                               # pauldron into one pale sleeve (polish: the right pauldron is the stack's stone now, no step)
STONE_TIERS = ("tier1", "tier2", "tier3", "tier4")
STONE_GROUPS = (STONE_TIERS, ("shoulder_plate", "pauldron_lame", "pauldron_face"))   # plates that tuck under each other (recess paint)
LEDGER_ROWS = 6                # the cap's top: the brief's ledger relief, one carved row per day (painted grooves)
CAP_PARTS = ("shoulder_plate", "pauldron_lame", "pauldron_face")
CAP_CHROMA = 0.4               # fix round 2: the right cap's stone chroma (x, luminance kept; b* ~+11 -> ~+4): the verifier
                               # read the lifted cap and cowl as one pale beige family from the front


def _nblur(arr: np.ndarray, w: np.ndarray, sigma: float) -> np.ndarray:
    """normalised blur of arr (H, W, C) over the texels where w (H, W) > 0 (one part's islands only)"""
    from common.hifi import project
    a = project.blur((arr * w[..., None]).astype(np.float32), sigma)
    b = project.blur(w[..., None].astype(np.float32), sigma)
    return a / np.maximum(b, 1e-5)


def stone_paint(nm: str, c: np.ndarray, maps: dict, m: np.ndarray, cache: dict) -> np.ndarray:
    """one rust part's texels (linear) painted from its geometry (see STONE_*); m = the part's texel mask"""
    P, N = maps["P"], maps["N"]
    Pm, Nm = P[m].astype(np.float64), N[m].astype(np.float64)
    # texture-space curvature: a texel standing proud of its blurred neighbourhood (along its normal) is on a
    # convex edge, one sunk below it in a crease (blurred inside this part's islands only)
    w = m.astype(np.float32)
    Pb = _nblur(P.astype(np.float32), w, 3.5)[m]
    conv = np.einsum("ij,ij->i", Pm - Pb, Nm)
    chalk = np.clip((conv - 0.0011) / 0.0025, 0.0, 1.0)      # (the gentle pyramid ridges and the chips stay unchalked)
    crease = np.clip((-conv - 0.0006) / 0.0024, 0.0, 1.0)
    nz = Nm[:, 2]
    top = np.clip((nz - 0.55) / 0.30, 0.0, 1.0)
    if nm == "tier1":
        # fix pass 6 (the review: dark slate blocks between the cowl and the left pauldron, a rock pushing out of
        # the scarf): the top tier's steep neck-side faces are the concept's LIGHT top of the stack, not side bands
        inward = np.clip((-Nm[:, 0] - 0.15) / 0.35, 0.0, 1.0) * np.clip((nz + 0.25) / 0.35, 0.0, 1.0)
        top = np.maximum(np.clip((nz - 0.15) / 0.35, 0.0, 1.0), inward)
    if nm == "pauldron_face":
        # W5b: the front plate's broad face is the concept's lit carved face (the top stone), not a dark side band
        fn = np.asarray(PAULDRON_FACE_N, dtype=np.float64)
        top = np.maximum(top, np.clip((Nm @ fn - 0.70) / 0.20, 0.0, 1.0) * 0.6)
    base = _hexlin(STONE_SIDE)[None] * (1 - top[:, None]) + _hexlin(STONE_TOP)[None] * top[:, None]
    base = base * np.clip(1.0 + 0.35 * np.minimum(nz, 0.0), 0.55, 1.0)[:, None]          # undersides darker
    # the painting's own value variation (scratches, stains, the concept's cracks), a third of it
    Y = _lum(c)
    det = np.clip(1.0 + (Y / max(float(np.median(Y)), 1e-5) - 1.0) * 0.28, 0.65, 1.12)   # (projected highlight strokes
                                                                                         # land off the edges: kept low)
    col = base * det[:, None]
    col = col * (1 - 0.75 * chalk[:, None]) + _hexlin(STONE_CHALK)[None] * 0.75 * chalk[:, None] * det[:, None]
    # recesses: a tier's texels close under another tier (the gap where one tucks under the next), and creases
    occ = np.zeros(len(Pm))
    group = next((g for g in STONE_GROUPS if nm in g), ())
    if group:
        if "sculpts" not in cache:
            cache["sculpts"] = {x[0]: x[1] for x in sculpts()}
        S = cache["sculpts"]
        for other in group:
            if other == nm or other not in S:
                continue
            d = sculpt_d(S[other], Pm)
            occ = np.maximum(occ, np.clip(1.0 - (d - 0.003) / 0.028, 0.0, 1.0) ** 1.4)
    rec = np.clip(np.maximum(occ * (1.0 - 0.5 * chalk), crease), 0.0, 1.0)
    if nm == "tier1":
        rec = rec * (1.0 - 0.7 * top)                  # (the light top keeps its value where it meets the felt)
    if nm in ("shoulder_plate", "pauldron_face"):
        # the carved work painted as well as sculpted (the game mesh keeps a few hundred triangles of each plate: the
        # relief softens, the paint keeps it): the roundel's two cut rings and its boss on the front plate's face
        # (W5b: 12 cm, on the flat face), and the ledger rows across the cap's top (the brief: one carved row per day),
        # each a dark cut with a chalked lip
        cut = np.zeros(len(Pm))
        lip = np.zeros(len(Pm))
        if nm == "pauldron_face":
            rc, rn = np.array(PAULDRON_ROUNDEL), np.array(PAULDRON_FACE_N, dtype=np.float64)
            rn /= np.linalg.norm(rn)
            ax = sdf.frame(rn, (1.0, 0.0, 0.0))
            q = Pm - rc
            r = np.hypot(q @ ax[0], q @ ax[1])
            face = np.clip((Nm @ rn - 0.35) / 0.3, 0.0, 1.0) * (np.abs(q @ rn) < 0.035)
            for rr, hw in ((0.022, 0.0040), (0.050, 0.0065), (0.069, 0.0045)):   # the dish edge, the groove, the rim
                cut = np.maximum(cut, np.clip(1.0 - np.abs(r - rr) / hw, 0.0, 1.0))
            lip = np.maximum(np.clip(1.0 - np.abs(r - 0.040) / 0.005, 0.0, 1.0),
                             np.clip(1.0 - np.abs(r - 0.060) / 0.005, 0.0, 1.0)) * 0.7 \
                + np.clip(1.0 - r / 0.014, 0.0, 1.0) * 0.5
            cut, lip = cut * face, lip * face
        else:
            # ledger rows: grooves across the top running out from the neck (constant y), spaced over its depth
            topw = np.clip((nz - 0.5) / 0.25, 0.0, 1.0) * (Pm[:, 0] < -0.22)
            ys = np.linspace(-0.12, 0.15, LEDGER_ROWS)
            dy = np.min(np.abs(Pm[:, 1][:, None] - ys[None]), axis=1)
            cut = np.clip(1.0 - dy / 0.0045, 0.0, 1.0) * topw
            lip = np.clip(1.0 - np.abs(dy - 0.0085) / 0.004, 0.0, 1.0) * topw * 0.6
        col = col * (1 - 0.5 * lip[:, None]) + _hexlin(STONE_CHALK)[None] * 0.5 * lip[:, None]
        rec = np.maximum(rec, cut * 0.85)
    col = col * (1 - 0.78 * rec[:, None]) + _hexlin(STONE_RECESS)[None] * 0.78 * rec[:, None]
    if nm in CAP_PARTS:
        # (fix round 2) the right cap a greyer stone than the warm felt beside it, at the same luminance (the value probe
        # reads L*): the two separate by hue at its edge instead of reading as one pale family
        Yc = _lum(col)[:, None]
        col = Yc + (col - Yc) * CAP_CHROMA
    return col * STONE_DARKER.get(nm, 1.0)


BOOT_WELT = "#1A1410"          # the welt line over the sole
BOOT_WRAP_DARK = 0.55          # fix pass 8: the wrap grooves on the boot shafts (the sculpt's wraps() ridges) darkened
BOOT_TOP = "#24190F"           # ... and a dark binding strap round each boot top, under the trousers' cuff roll
BOOT_TOP_Z = (0.372, 0.418)


def boot_caps(c: np.ndarray, P: np.ndarray) -> np.ndarray:
    """the boots read as made things at the splash's low camera: a dark welt line where the upper meets the sole, the
    shaft's wrap grooves darkened along the sculpted ridges and a dark binding strap round the top of each shaft.
    fix pass 8: no toe caps (the review: the ironstone caps read as grey slate bricks stuck on the boot fronts; the
    concept's boots are plain dark wrapped leather). Boot texels (linear) at rest-pose points P; each boot's frame as
    sculpted (rz 12 degrees out)"""
    out = c.copy()
    for sx in (-1.0, 1.0):
        sel = np.sign(P[:, 0]) == sx
        if not sel.any():
            continue
        R = rot(rz=sx * 12.0)
        Ps = P[sel]
        loc = (Ps - np.array([sx * 0.255, -0.06, 0.0])) @ R.T          # = R @ (P - c0): the sculpt's at() inverse
        lz = loc[:, 2]
        cc = out[sel]
        welt = np.clip(1.0 - np.abs(lz - 0.031) / 0.004, 0.0, 1.0)
        cc = cc * (1 - 0.8 * welt[:, None]) + _hexlin(BOOT_WELT)[None] * 0.8 * welt[:, None]
        z = Ps[:, 2]
        shaft = np.clip((z - 0.15) / 0.03, 0.0, 1.0)
        ph = np.sin(z * 55.0 + 9.0 * (Ps[:, 0] + Ps[:, 1]))                # the wraps() ridges: -1 in the grooves
        groove = np.clip((-ph - 0.35) / 0.45, 0.0, 1.0) * shaft
        cc = cc * (1.0 - (1.0 - BOOT_WRAP_DARK) * groove)[:, None]
        z0, z1 = BOOT_TOP_Z
        band = np.clip(1.0 - np.maximum(z0 - z, z - z1) / 0.004, 0.0, 1.0)
        Y = _lum(cc)
        det = np.clip(1.0 + (Y / max(float(Y.mean()), 1e-6) - 1.0) * 0.3, 0.7, 1.3)[:, None]
        cc = cc * (1 - band[:, None]) + _hexlin(BOOT_TOP)[None] * det * band[:, None]
        out[sel] = cc
    return out


def grade_parts(lin: np.ndarray, maps: dict, names: list, log=print) -> np.ndarray:
    """the cowl, the stone plates, the trousers and the boots onto their target means (see the targets)"""
    N, part = maps["N"], maps["part"]
    out = lin.copy()
    rep = []
    cache: dict = {}
    for i, nm in enumerate(names):
        m = part == i
        if not m.any():
            continue
        if nm == "cowl":
            c = _tint(out[m], COWL_MEAN, contrast=0.9, keep=0.2)
            # (polish) the felt's painted top light: the faces the game camera looks down on a step up, the undersides a
            # step down (the concept's lit scarf folds; the low splash camera sees mostly the front faces)
            nz_ = N[m][:, 2]
            c = c * (1.0 + (COWL_TOP_GAIN - 1.0) * np.clip((nz_ - 0.05) / 0.6, 0.0, 1.0)
                     - COWL_UNDER_DARK * np.clip(-nz_ / 0.6, 0.0, 1.0))[:, None]
            # the head's socket in the felt (its inner wall shows under the chin when he bows his head): the
            # felt's shadow, not the projected face paint
            P_ = maps["P"][m]
            n_ = N[m]
            rad = np.hypot(P_[:, 0] + 0.012, P_[:, 1] + 0.02)
            inner = (rad < 0.15) & (P_[:, 2] > 1.74) & ((n_[:, 0] * (P_[:, 0] + 0.012) + n_[:, 1] * (P_[:, 1] + 0.02)) < 0)
            c[inner] = _hexlin(FELT_SHADOW)[None] * (0.9 + 0.2 * (_lum(c[inner]) / max(float(_lum(c).mean()), 1e-5)))[:, None]
            out[m] = c
        elif nm in ("coat", "skirt"):
            c = _tint(out[m], COAT_MEAN if nm == "coat" else SKIRT_MEAN, contrast=0.85, keep=0.12)
            if nm == "coat":                                                    # (polish) the light top
                z0, z1 = COAT_TOP_Z
                t = np.clip((maps["P"][..., 2][m] - z0) / (z1 - z0), 0.0, 1.0)
                c = c * (1.0 + (COAT_TOP_GAIN - 1.0) * t * t * (3 - 2 * t))[:, None]
            out[m] = c
        elif nm == "belt":
            out[m] = _tint(out[m], BELT_MEAN, contrast=0.8, keep=0.15)
        elif nm == "tally":
            out[m] = tally_paint(out[m], maps["P"][m], N[m])
        elif nm in RUST_PARTS:
            out[m] = stone_paint(nm, out[m], maps, m, cache)
        elif nm == "trousers":
            out[m] = _tint(out[m], TROUSER_MEAN, contrast=0.4, keep=0.2)      # (fix pass 8: the projected light patches
                                                                               # read as camo in the splash's sun)
        elif nm == "boots":
            c = _tint(out[m], BOOT_MEAN, contrast=0.65, keep=0.1)
            Yb = _lum(c)
            cap = 1.35 * float(_lum(_hexlin(BOOT_MEAN)[None])[0])
            c = c * np.minimum(1.0, cap / np.maximum(Yb, 1e-6))[:, None]     # no pale background smear
            sole = maps["P"][..., 2][m] < 0.027                                 # the flat sole: dark
            c[sole] = _hexlin("#2C231D")[None] * (0.85 + 0.3 * (Yb[sole] / max(float(Yb.mean()), 1e-6)))[:, None] * 0.6 \
                + c[sole] * 0.4
            out[m] = boot_caps(c, maps["P"][m])
        else:
            continue
        rep.append(nm)
    log("burdam: graded " + ", ".join(rep))
    return out



ALMANAC_HEM = (0.668, 0.738)      # fix pass 8: the coat's hem printed as a ledger strip (z range, rest pose)


def almanac_print(img: np.ndarray, maps: dict, names: list, ink_hex: str, parchment_hex: str = "#A3987F") -> np.ndarray:
    """Almanac Ledger's printing (brief section 9: texture, not geometry): ruled ledger lines across the
    parchment pauldrons and plates (every 3.2 cm of height), and day-marks down the cleaver's back (tallies
    of five: four strokes and a slash). Drawn into the re-coloured atlas from each texel's surface point
    (the cleaver's texels sit in its paint pose, read back to cleaver u, v)."""
    from common import scene
    P, part = maps["P"], maps["part"]
    ink = np.asarray(scene.hex_srgb(ink_hex), dtype=np.float32)
    out = img.copy()
    rust = np.isin(part, [names.index(n) for n in RUST_PARTS if n in names])
    if rust.any():
        # fix pass 5: ruled on the upward faces only, and a lighter rule (ruled side bands and creases read as
        # crumpled notebook paper); the plates' painted bevels and recesses carry the stone under the print
        z = P[..., 2][rust]
        nz = maps["N"][..., 2][rust]
        t = (z / 0.032) % 1.0
        d = np.minimum(t, 1.0 - t) * 0.032
        a = (np.clip(1.0 - d / 0.0028, 0.0, 1.0) * 0.55 * np.clip((nz - 0.45) / 0.25, 0.0, 1.0))[:, None]
        out[rust] = out[rust] * (1 - a) + ink * a
    if "almanac_face" in names:
        # the board's parchment: a ledger page (ruled every 2 cm, a margin rule, faint foxing), not a flat card
        fc = part == names.index("almanac_face")
        if fc.any():
            p = P[fc]
            t = (p[:, 2] / 0.020) % 1.0
            d = np.minimum(t, 1.0 - t) * 0.020
            zc, hh = ALMANAC_C[2], ALMANAC_HALF[1] - 0.045
            line = np.clip(1.0 - d / 0.0027, 0.0, 1.0) * (p[:, 2] < zc + hh) * (p[:, 2] > zc - hh)
            ax = np.array([np.cos(np.radians(ALMANAC_RZ)), np.sin(np.radians(ALMANAC_RZ))])   # the board's width axis
            along = (p[:, 0] - ALMANAC_C[0]) * ax[0] + (p[:, 1] - ALMANAC_C[1]) * ax[1]
            margin = np.clip(1.0 - np.abs(along + 0.060) / 0.0025, 0.0, 1.0)
            fox = 0.93 + 0.07 * np.sin(p[:, 0] * 90.0 + p[:, 2] * 70.0) * np.sin(p[:, 2] * 45.0 - p[:, 1] * 60.0)
            out[fc] = out[fc] * fox[:, None] * ALMANAC_PAGE_GAIN
            a = (np.maximum(line * 0.78, margin * 0.85))[:, None]
            out[fc] = out[fc] * (1 - a) + ink * a
    if "almanac_tabs" in names:
        tb = part == names.index("almanac_tabs")
        if tb.any():
            z = P[..., 2][tb]
            t = (z / 0.016) % 1.0
            d = np.minimum(t, 1.0 - t) * 0.016
            a = (np.clip(1.0 - d / 0.0018, 0.0, 1.0) * 0.6)[:, None]
            out[tb] = out[tb] * (1 - a) + ink * a
    if "skirt" in names:
        # fix pass 8 (the review: the deluxe tier read as a recolour plus a small board): the coat's hem a parchment
        # ledger strip all round, ruled top and bottom, with day-marks (fives) along it: a light band at the skirt's
        # edge that reads from the game camera at every facing, the almanac's page worn as the hem
        sk = part == names.index("skirt")
        if sk.any():
            from common.hifi import project
            p = P[sk]
            z0, z1 = ALMANAC_HEM
            band = np.clip((z1 - p[:, 2]) / 0.004, 0.0, 1.0) * np.clip((p[:, 2] - z0 + 0.02) / 0.004, 0.0, 1.0)
            lin = project._lin(out[sk])
            par = project._lin(np.asarray(scene.hex_srgb(parchment_hex), dtype=np.float32))
            Y = _lum(lin)
            det = np.clip(1.0 + (Y / max(float(np.median(Y)), 1e-5) - 1.0) * 0.45, 0.6, 1.25)[:, None]
            lin = lin * (1 - band[:, None]) + par[None] * det * band[:, None]
            s_ = np.arctan2(p[:, 1], p[:, 0]) * 0.36                # arc length round the skirt (m)
            w = s_ - np.floor(s_ / 0.085) * 0.085
            stroke = np.zeros(len(p))
            for c0 in (0.012, 0.024, 0.036, 0.048):
                stroke = np.maximum(stroke, np.clip(1.0 - np.abs(w - c0) / 0.0026, 0.0, 1.0))
            zz = (p[:, 2] - (z0 + 0.012)) / (z1 - z0 - 0.026)
            stroke *= ((zz > 0.0) & (zz < 1.0)).astype(np.float32)
            slash = np.abs((w - 0.006) - zz * 0.050)               # the fifth stroke, across the four
            stroke = np.maximum(stroke, np.clip(1.0 - slash / 0.0028, 0.0, 1.0) * ((zz > 0.0) & (zz < 1.0)))
            rule = np.maximum(np.clip(1.0 - np.abs(p[:, 2] - (z1 - 0.006)) / 0.0018, 0.0, 1.0),
                              np.clip(1.0 - np.abs(p[:, 2] - (z0 + 0.004)) / 0.0018, 0.0, 1.0))
            a_ = (np.maximum(stroke * 0.7, rule * 0.75) * band)[:, None]
            inkl = project._lin(ink)
            lin = lin * (1 - a_) + inkl[None] * a_
            out[sk] = project._srgb(lin).astype(np.float32)
    if "blade" in names:
        bl = part == names.index("blade")
        u, v = cl.to_uv(P[..., 0][bl], P[..., 2][bl])
        depth = cl.v_spine(u) - v                      # distance in from the spine
        g = u - 0.50
        w = g - np.floor(g / 0.13) * 0.13              # position inside a tally group
        stroke = np.zeros_like(u)
        for c0 in (0.010, 0.026, 0.042, 0.058):
            stroke = np.maximum(stroke, np.clip(1.0 - np.abs(w - c0) / 0.0032, 0.0, 1.0))
        stroke *= ((depth > 0.008) & (depth < 0.046)).astype(np.float32)
        slash = np.abs((depth - 0.044) + (w - 0.0) * (0.040 / 0.068)) / np.sqrt(1 + (0.040 / 0.068) ** 2)
        stroke = np.maximum(stroke, np.clip(1.0 - slash / 0.003, 0.0, 1.0) * ((w < 0.07) & (depth > 0.0)))
        stroke *= ((u > 0.50) & (u < 1.28)).astype(np.float32)
        a = (stroke * 0.8)[:, None]
        out[bl] = out[bl] * (1 - a) + ink * a
    return out


def reed_paint(img: np.ndarray, maps: dict, names: list) -> np.ndarray:
    """Stillwater's reed slats (painted flat in their role colour by the pipeline: the review read flat olive cards):
    a fine split-reed grain along each slat, the upper faces a step lighter than the thickness faces, chalked convex
    edges and darker creases at the cut nodes and the lashing (texture-space curvature, as stone_paint)"""
    from common.hifi import project
    P, N, part = maps["P"], maps["N"], maps["part"]
    lin = project._lin(img)
    for nm in ("reed_plates_L", "reed_plates_R"):
        if nm not in names:
            continue
        m = part == names.index(nm)
        if not m.any():
            continue
        Pm, Nm = P[m].astype(np.float64), N[m].astype(np.float64)
        Pb = _nblur(P.astype(np.float32), m.astype(np.float32), 3.0)[m]
        conv = np.einsum("ij,ij->i", Pm - Pb, Nm)
        chalk = np.clip((conv - 0.0005) / 0.002, 0.0, 1.0)
        crease = np.clip((-conv - 0.0005) / 0.002, 0.0, 1.0)
        q = np.stack([Pm[:, 0] * 0.4, Pm[:, 1] * 6.0, Pm[:, 2] * 6.0], axis=1)
        grain = 0.86 + 0.10 * np.sin(Pm[:, 1] * 650.0 + 4.0 * NOISE.fbm(q, 6.0, 2)) + 0.06 * NOISE.fbm(Pm, 40.0, 2)
        side = np.clip(1.0 - np.abs(Nm[:, 2]) / 0.6, 0.0, 1.0)
        c = lin[m] * (grain * (1.0 - 0.35 * side))[:, None]
        c = c * (1.0 + 0.45 * chalk)[:, None]
        c = c * (1.0 - 0.55 * crease)[:, None]
        lin[m] = c
    return project._srgb(lin).astype(np.float32)


def _install_skin_print() -> None:
    from common.hifi import project
    if getattr(project.recolour, "_burdam", False):
        return
    orig = project.recolour

    def recolour(img, maps, names, roles, base_pal, skin_pal, skip=None, log=print):
        skin = _STATE.get("skin") or {}
        match = set(skin.get("match") or ())
        # the skin's IDENTITY roles are matched, not scaled: each such part's painted mean becomes the skin
        # hex exactly (per channel, linear light; the painting's shading rides on top), so a dark painted
        # coat really turns warm grey and the oxidised pauldrons really turn parchment. The other roles
        # keep the shared ratio re-colour (skin hex / base hex).
        rest = {n: r for n, r in roles.items() if r not in match}
        out = orig(img, maps, names, rest, base_pal, skin_pal, skip=skip, log=log)
        if match:
            from common import scene
            lin = project._lin(out)
            part = maps["part"]
            iy, ix = project.nearest_index(part >= 0)
            pid = part[iy, ix]
            for i, n in enumerate(names):
                r = roles.get(n)
                if r not in match or n in (skip or set()) or r not in skin_pal:
                    continue
                m = pid == i
                own = part == i
                if not own.any():
                    continue
                mean = lin[own].mean(axis=0)
                t = project._lin(np.asarray(scene.hex_srgb(skin_pal[r]), dtype=np.float32))
                gain = np.clip(t / np.maximum(mean, 1e-4), 0.05, 8.0)
                # mostly a tint of the painting's VALUES (the skin hex times each texel's luminance over the
                # part's mean), a quarter the per-channel scale: the painted hue noise is not blown up 3-8x
                l = np.clip(_lum(lin[m]) / max(float(_lum(mean[None])[0]), 1e-4), 0.12, 2.6)[:, None]
                lin[m] = (t[None] * l) * (1.0 - MATCH_HUE) + (lin[m] * gain) * MATCH_HUE
                log(f"  match {n} ({r}): mean {np.round(project._srgb(mean) * 255).astype(int).tolist()} -> "
                    f"{skin_pal[r]}, gain {np.round(gain, 2).tolist()}")
            out = project._srgb(lin).astype(np.float32)
        parts = skin.get("parts") or {}
        if parts:
            from common import scene
            lin = project._lin(out)
            part = maps["part"]
            iy, ix = project.nearest_index(part >= 0)
            pid = part[iy, ix]
            for i, n in enumerate(names):
                if n not in parts:
                    continue
                own = part == i
                if not own.any():
                    continue
                m = pid == i
                lin[m] = _tint(lin[m], parts[n], contrast=0.7, keep=0.15, mean=lin[own].mean(axis=0))
                log(f"  part mean {n} -> {parts[n]}")
            out = project._srgb(lin).astype(np.float32)
        if (skin.get("extra") or {}).get("reed_plates"):
            out = reed_paint(out, maps, list(names))
            log("burdam: Stillwater reed slats painted (grain, darker edges and nodes)")
        if (skin.get("extra") or {}).get("almanac_board"):
            log("burdam: Almanac Ledger print (ruled pauldrons, day-marks on the cleaver's back)")
            out = almanac_print(out, maps, list(names), skin_pal.get("ironstone", "#2E2A26"),
                                skin_pal.get("parchment", "#A3987F"))
        return out

    recolour._burdam = True
    project.recolour = recolour


ARM_BONES = tuple(f"{b}.{s}" for s in "LR" for b in ("shoulder", "upper_arm", "forearm", "hand", "prop"))


MATCH_HUE = 0.25          # skin identity roles: share of the painting's own hue variation kept (see recolour)
BASE_WEBP_Q = 62          # base-colour WebP quality (optimize.mjs default 80): the lifted painting carries more
                          # shadow detail; the GLB budget (1172 KiB) holds with the painting at q74 (polish: q66 -> 62
                          # and the ORM q72 -> 58: the right pauldron, its lame and the value lift's lighter, busier
                          # painting put the build at 1210 KiB)
ORM_WEBP_Q = 58


def _install_webp_quality() -> None:
    """export.optimize with `--q-base BASE_WEBP_Q` (the shared wrapper passes no quality; optimize.mjs takes it)"""
    import subprocess
    from common import export, scene
    if getattr(export.optimize, "_burdam", False):
        return
    orig = export.optimize

    def optimize(path, out=None, quantize=False, fighter=False):
        if not fighter:
            return orig(path, out, quantize=quantize, fighter=fighter)
        out = out or path
        script = os.path.join(scene.TOOLS_DIR, "optimize.mjs")
        node = export.node_exe()
        before = os.path.getsize(path)
        if not node or not os.path.isfile(script):
            return orig(path, out, quantize=quantize, fighter=fighter)
        args = [node, script, path, out, "--fighter", "--q-base", str(BASE_WEBP_Q), "--q-orm", str(ORM_WEBP_Q)] + \
            (["--quantize"] if quantize else [])
        r = subprocess.run(args, cwd=scene.GAME_DIR, capture_output=True, text=True, encoding="utf-8")
        if r.returncode != 0:
            scene.log(f"optimize failed ({r.returncode}): {r.stderr.strip()[:800]}")
            return {"ok": False, "before": before, "after": before, "error": r.stderr[-800:]}
        scene.log(r.stdout.strip() + f" (burdam: base webp q{BASE_WEBP_Q}, orm q{ORM_WEBP_Q})")
        return {"ok": True, "before": before, "after": os.path.getsize(out)}

    optimize._burdam = True
    export.optimize = optimize


def shoulder_weights(obj, arm, sel=None, iters: int = 8, elbows: bool = True, log=print) -> int:
    """The coat's shoulders (bone heat leaves the deltoid ABOVE the shoulder joint on the upper arm, so
    a forward reach swings that cloth back into a cone under the pauldron, and the armpit band shears):
    the upper arm's share fades out above the joint (it only owns cloth from 2 cm below the joint down),
    the rest goes to the clavicle; then the weights near each shoulder are Laplacian-smoothed so the
    turn spreads over the shoulder instead of one ring of edges. `sel` limits it to some vertices (the
    joined cache mesh); returns the vertices changed."""
    me = obj.data
    n = len(me.vertices)
    if n == 0:
        return 0
    co = np.empty(n * 3, dtype=np.float64)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3) @ np.array(obj.matrix_world)[:3, :3].T + np.array(obj.matrix_world)[:3, 3]
    sel = np.ones(n, dtype=bool) if sel is None else np.asarray(sel, dtype=bool)
    groups = {g.index: g.name for g in obj.vertex_groups}
    gid = {nm: i for i, nm in groups.items()}
    for side in "LR":
        for b in (f"shoulder.{side}", f"upper_arm.{side}", "chest"):
            if b not in gid:
                gid[b] = obj.vertex_groups.new(name=b).index
                groups[gid[b]] = b
    cols = sorted(groups)
    ci = {g: k for k, g in enumerate(cols)}
    W = np.zeros((n, len(cols)), dtype=np.float64)
    for v in me.vertices:
        if sel[v.index]:
            for g in v.groups:
                W[v.index, ci[g.group]] = g.weight
    W0 = W.copy()
    near = np.zeros(n, dtype=bool)
    for side, sx in (("L", 1.0), ("R", -1.0)):
        for b in (f"forearm.{side}",):
            if b not in gid:
                gid[b] = obj.vertex_groups.new(name=b).index
                groups[gid[b]] = b
                cols.append(gid[b])
                ci[gid[b]] = len(cols) - 1
                W = np.concatenate([W, np.zeros((n, 1))], axis=1)
                W0 = np.concatenate([W0, np.zeros((n, 1))], axis=1)
        bu = arm.data.bones[f"upper_arm.{side}"]
        J = np.array(arm.matrix_world @ bu.head_local)
        E = np.array(arm.matrix_world @ bu.tail_local)
        a = E - J
        a /= np.linalg.norm(a)
        s = (co - J) @ a                                        # down the arm from the joint (m)
        d = np.linalg.norm(co - J, axis=1)
        zone = sel & (d < 0.34)
        near |= zone
        f = np.clip((s + 0.02) / 0.12, 0.0, 1.0)
        f = f * f * (3 - 2 * f)
        ua, sh = ci[gid[f"upper_arm.{side}"]], ci[gid[f"shoulder.{side}"]]
        keep = W[:, ua] * f
        W[zone, sh] += (W[zone, ua] - keep[zone])
        W[zone, ua] = keep[zone]
        if elbows:
            # the elbow: the upper arm owns the sleeve down to the joint plane, the forearm past it (a narrow
            # blend), so a bent elbow folds instead of pulling the sleeve's end cap into a cone
            fa = ci[gid[f"forearm.{side}"]]
            se = (co - E) @ a
            ez = sel & (np.linalg.norm(co - E, axis=1) < 0.22) & (W[:, ua] + W[:, fa] > 0.3)
            g = np.clip((se + 0.03) / 0.07, 0.0, 1.0)
            g = g * g * (3 - 2 * g)
            tot = W[:, ua] + W[:, fa]
            W[ez, fa] = tot[ez] * g[ez]
            W[ez, ua] = tot[ez] * (1.0 - g[ez])
            near |= ez
    ed = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get("vertices", ed)
    ed = ed.reshape(-1, 2)
    ed = ed[near[ed[:, 0]] & near[ed[:, 1]]]
    deg = np.bincount(ed.ravel(), minlength=n).astype(np.float64)
    for _ in range(iters):
        acc = np.zeros_like(W)
        np.add.at(acc, ed[:, 0], W[ed[:, 1]])
        np.add.at(acc, ed[:, 1], W[ed[:, 0]])
        m = near & (deg > 0)
        W[m] = 0.5 * W[m] + 0.5 * acc[m] / deg[m, None]
    changed = 0
    for i in np.nonzero(near)[0]:
        w = W[i]
        top = np.argsort(-w)[:4]
        top = [k for k in top if w[k] >= 0.01] or [int(np.argmax(w))]
        tot = sum(w[k] for k in top)
        if np.allclose(w, W0[i], atol=1e-3):
            continue
        changed += 1
        for k in range(len(cols)):
            g = obj.vertex_groups[groups[cols[k]]]
            if k in top:
                g.add([int(i)], float(w[k] / tot), "REPLACE")
            elif W0[i, k] > 0:
                g.remove([int(i)])
    log(f"burdam: shoulder weights on {obj.name}: {changed} vertices re-weighted")
    return changed


def _install_body_bind() -> None:
    """bind 'body': bone heat from the trunk and legs only. The fists hang beside the belt and the coat's
    skirt at rest, so plain heat weights let the raised carry arm drag the belts and the hem; the shared
    binder has no exclusion option per part, so the pipeline's bind_part is wrapped here. bind 'coat':
    bone heat, then shoulder_weights (the shared binder has no per-part weight fix either)."""
    from common import mesh, pipeline
    if getattr(pipeline.bind_part, "_burdam", False):
        return
    orig = pipeline.bind_part

    def bind_part(ctx, part, obj, body_low=None):
        if part.bind == "body":
            return mesh.bind_auto(obj, ctx.info.armature, exclude=("root",) + ARM_BONES)
        if part.bind == "coat":
            res = mesh.bind_auto(obj, ctx.info.armature)
            shoulder_weights(obj, ctx.info.armature)
            mesh.limit_weights(obj)
            return res
        return orig(ctx, part, obj, body_low)

    bind_part._burdam = True
    pipeline.bind_part = bind_part


# FighterArt.height places the health bar at height + 0.35 m. Fix pass 3 raised it to the carried cleaver's tip
# (2.30 m) through this wrapper; fix pass 4 returns to the measured model top (2.16 m: the brief's art.height is
# measured without the cleaver, and three_load_test requires art.json height == the model's top within 6 cm). The
# carry was searched against the bar at 2.16 + 0.35 m (72-100 % of the blade in view). Kept, not installed.
BAR_TOP = None


RENDER_SPECULAR = 0.05    # Specular IOR Level of the baked body material in the Blender renders only
# FIX ROUND 2 (the verifier: in the splash and portrait the five accent diamonds + the pommel gem read as large glossy
# blue tiles, the loudest element of the frame; in game they are small and team-tinted): in the Blender stills only the
# accent glass goes matte (roughness 0.25 -> 0.7, no specular sheen of the sky) and its emission drops 0.8 -> 0.35, so
# the inlays read as set blue stones in the heel instead of lit tiles. The GLB is exported before the renders: the game's
# accent (and its 1.5-6 % share) is untouched.
STILL_ACCENT = {"Roughness": 0.7, "Specular IOR Level": 0.1, "Emission Strength": 0.35}
# ... and the stills set each inlay (and the pommel gem) smaller and nearly flush: every accent island scaled about its
# centre, x STILL_GEM_SCALE in its plane and x STILL_GEM_FLUSH through it (the 4.6 cm inlay through the 3 cm heel -> 3.4 cm,
# ~2 mm proud): the concept's small gems set in the heel. Rest-pose vertex positions, restored after the renders.
STILL_GEM_SCALE = 0.80
STILL_GEM_FLUSH = 0.80


def _shrink_islands(o, k_plane: float, k_thick: float):
    """scale every connected island of mesh `o` about its centroid: x k_plane in its two widest axes, x k_thick through
    its thinnest; returns the original coordinates (flat float array) for the restore"""
    me = o.data
    n = len(me.vertices)
    co = np.empty(n * 3, dtype=np.float64)
    me.vertices.foreach_get("co", co)
    orig = co.copy()
    co = co.reshape(-1, 3)
    ev = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get("vertices", ev)
    par = list(range(n))

    def find(i):
        while par[i] != i:
            par[i] = par[par[i]]
            i = par[i]
        return i
    for a_, b_ in ev.reshape(-1, 2):
        ra, rb = find(int(a_)), find(int(b_))
        if ra != rb:
            par[ra] = rb
    lab = np.array([find(i) for i in range(n)])
    for L_ in np.unique(lab):
        idx = np.nonzero(lab == L_)[0]
        if len(idx) < 4:
            continue
        P_ = co[idx]
        c = P_.mean(0)
        Q = P_ - c
        w = np.linalg.svd(Q, full_matrices=False)[2][2]
        t = Q @ w
        co[idx] = c + (Q - t[:, None] * w[None]) * k_plane + (t * k_thick)[:, None] * w[None]
    me.vertices.foreach_set("co", co.ravel())
    me.update()
    return orig
# FIX ROUND 2 (the verifier: the value lift left the cowl, the right cap and the stack one pale family; in the splash
# the felt's sunlit top folds passed L* 86, p90 93.5): the splash only takes the felt back down a step, most on its
# sunlit tops (base colour x (1 - all - top x the COWL_TOP_GAIN ramp on N.z 0.05 -> 0.65), the cowl's texels picked by
# the mesh's vale_part attribute). The game keeps COWL_TOP_GAIN 1.45 (the RIFT value margin is under 1 L*).
SPLASH_COWL_DIM = (0.18, 0.32)      # (all, top)
_COWL_DIM = []            # the Value node pairs feeding the dim while the renders run (set per still by bible_lights)


def _cowl_dim_nodes(m, cowl_id: int):
    """insert base colour x (1 - [part == cowl] * (all + top * ramp(N.z))) in front of the Principled BSDF's linked base
    colour; returns (undo, (all, top) value nodes) or None"""
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None or not bsdf.inputs["Base Color"].is_linked:
        return None
    link = bsdf.inputs["Base Color"].links[0]
    src = link.from_socket
    N = nt.nodes
    attr = N.new("ShaderNodeAttribute")
    attr.attribute_type = "GEOMETRY"
    attr.attribute_name = "vale_part"
    cmp_ = N.new("ShaderNodeMath")
    cmp_.operation = "COMPARE"
    cmp_.inputs[1].default_value = float(cowl_id)
    cmp_.inputs[2].default_value = 0.5
    geo = N.new("ShaderNodeNewGeometry")
    sep = N.new("ShaderNodeSeparateXYZ")
    rng = N.new("ShaderNodeMapRange")
    rng.clamp = True
    rng.inputs["From Min"].default_value = 0.05
    rng.inputs["From Max"].default_value = 0.65
    val = N.new("ShaderNodeValue")                  # top
    val.outputs[0].default_value = 0.0
    val_all = N.new("ShaderNodeValue")              # all
    val_all.outputs[0].default_value = 0.0
    m1 = N.new("ShaderNodeMath")
    m1.operation = "MULTIPLY"
    add = N.new("ShaderNodeMath")
    add.operation = "ADD"
    m2 = N.new("ShaderNodeMath")
    m2.operation = "MULTIPLY"
    one_minus = N.new("ShaderNodeMath")
    one_minus.operation = "SUBTRACT"
    one_minus.inputs[0].default_value = 1.0
    sc = N.new("ShaderNodeVectorMath")
    sc.operation = "SCALE"
    L = nt.links
    L.new(attr.outputs["Fac"], cmp_.inputs[0])
    L.new(geo.outputs["Normal"], sep.inputs[0])
    L.new(sep.outputs["Z"], rng.inputs["Value"])
    L.new(rng.outputs["Result"], m1.inputs[0])
    L.new(val.outputs[0], m1.inputs[1])
    L.new(m1.outputs[0], add.inputs[0])
    L.new(val_all.outputs[0], add.inputs[1])
    L.new(add.outputs[0], m2.inputs[0])
    L.new(cmp_.outputs[0], m2.inputs[1])
    L.new(m2.outputs[0], one_minus.inputs[1])
    L.new(src, sc.inputs[0])
    L.new(one_minus.outputs[0], sc.inputs["Scale"])
    L.remove(link)
    L.new(sc.outputs["Vector"], bsdf.inputs["Base Color"])
    made = [attr, cmp_, geo, sep, rng, val, val_all, m1, add, m2, one_minus, sc]

    def undo():
        for n in made:
            nt.nodes.remove(n)
        nt.links.new(src, bsdf.inputs["Base Color"])
    return undo, (val_all, val)


def _install_render_specular() -> None:
    """render.fighter_renders with the baked body material's dielectric specular at RENDER_SPECULAR (fix pass 5:
    at the default 0.5 the splash's low camera caught the bright sky in grazing Fresnel on the boot toes (a white
    smear) and on the blade's sunlit bevels). The GLB is exported before the renders, so the game material is
    untouched (no KHR_materials_specular); the value is restored afterwards."""
    from common import render
    if getattr(render.fighter_renders, "_burdam", False):
        return
    orig = render.fighter_renders

    def fighter_renders(ctx, objs, P, skin, *a, **kw):
        saved, undos, done, shrunk = [], [], set(), []
        if getattr(ctx.spec, "ID", None) == ID:
            cowl_id = [x[0] for x in sculpts()].index("cowl")
            for o in objs:
                if o.type != "MESH":
                    continue
                for slot in o.material_slots:
                    m = slot.material
                    if not m or not m.use_nodes:
                        continue
                    if m.name == "accent":                     # (fix round 2) the stills' matte, dimmer accent glass
                        if all(s_.material and s_.material.name == "accent" for s_ in o.material_slots) \
                                and all(o is not x for x, _c in shrunk):
                            shrunk.append((o, _shrink_islands(o, STILL_GEM_SCALE, STILL_GEM_FLUSH)))
                        for n in m.node_tree.nodes:
                            if n.type == "BSDF_PRINCIPLED":
                                for k, v in STILL_ACCENT.items():
                                    inp = n.inputs.get(k)
                                    if inp is not None and not inp.is_linked and all(inp is not x for x, _v in saved):
                                        saved.append((inp, inp.default_value))
                                        inp.default_value = v
                        continue
                    for n in m.node_tree.nodes:
                        if n.type == "BSDF_PRINCIPLED" and "Specular IOR Level" in n.inputs:
                            inp = n.inputs["Specular IOR Level"]
                            if not inp.is_linked and all(inp is not x for x, _v in saved):
                                saved.append((inp, inp.default_value))
                                inp.default_value = RENDER_SPECULAR
                    if m.name not in done and o.data.attributes.get("vale_part") is not None:
                        done.add(m.name)
                        r = _cowl_dim_nodes(m, cowl_id)
                        if r is not None:
                            undos.append(r[0])
                            _COWL_DIM.append(r[1])
        _RENDERING[0] = getattr(ctx.spec, "ID", None) == ID
        try:
            return orig(ctx, objs, P, skin, *a, **kw)
        finally:
            _RENDERING[0] = False
            for inp, v in saved:
                inp.default_value = v
            for u in undos:
                u()
            _COWL_DIM.clear()
            for o, co in shrunk:
                o.data.vertices.foreach_set("co", co)
                o.data.update()

    fighter_renders._burdam = True
    render.fighter_renders = fighter_renders


# fix pass 7 (the review: in the portrait the cleaver's ironstone heel band rendered as a pale sky-blue mirror, L*
# 86-93, brighter than the mask): the portrait's cool rim (the area light behind the subject on the screen-left
# edge, 1500 W x 0.8^2 at 2.4 m) lands square on the heel's flat, which faces back-left in the carry; with it off
# the band renders L* 27 (authored 28). The portrait keeps a fifth of it (the silhouette edge on the cowl and the
# fist), the splash and every other render are untouched. Wraps render.bible_lights (the shared module is
# untouched): the portrait is the call with rim 0.8 / scale 0.8, made while _RENDERING is up.
PORTRAIT_RIM_COOL = 0.2
_RENDERING = [False]


def _install_portrait_rim() -> None:
    from common import render
    if getattr(render.bible_lights, "_burdam", False):
        return
    orig = render.bible_lights

    def bible_lights(cam, cfg, light, rim=1.0, scale=1.0, pair=False, target=None):
        if _RENDERING[0] and pair and abs(rim - 0.8) < 1e-6 and abs(scale - 0.8) < 1e-6:
            cfg = dict(cfg, rim_cool=float(cfg.get("rim_cool", 1.0)) * PORTRAIT_RIM_COOL)
        # (fix round 2) the splash (rim 1.0 / scale 1.6) dims the felt's sunlit tops; every other still renders them as built
        splash = _RENDERING[0] and pair and abs(rim - 1.0) < 1e-6 and abs(scale - 1.6) < 1e-6
        for v_all, v_top in _COWL_DIM:
            v_all.outputs[0].default_value = SPLASH_COWL_DIM[0] if splash else 0.0
            v_top.outputs[0].default_value = SPLASH_COWL_DIM[1] if splash else 0.0
        return orig(cam, cfg, light, rim=rim, scale=scale, pair=pair, target=target)

    bible_lights._burdam = True
    render.bible_lights = bible_lights


# ── the icon (fix pass 6): the brief's "scored mask with one lit notch above it". The shared icon frames the head
# in the portrait pose (the carry), where the notched heel hides behind the head; this one raises the cleaver
# behind the mask (the fist over the right shoulder, the heel standing up behind the crown with its flat to the
# camera) and frames the mask with the lit notches over it. Wraps render.fighter_renders (the shared module is
# untouched), base model only.
ICON_HAND = dict(rel=(-0.40, 0.10, 0.62), d=(0.50, 0.22, 0.84), pole=(-1.0, 0.25, -0.3))
ICON_CAM = {"yaw": 24.0, "pitch": 4.0, "z0": -0.17, "z1": 0.46, "fill": 0.92}


def icon_pose() -> dict:
    d = np.asarray(ICON_HAND["d"], dtype=np.float64)
    d /= np.linalg.norm(d)
    cam = np.array([math.sin(math.radians(ICON_CAM["yaw"])), -math.cos(math.radians(ICON_CAM["yaw"])), 0.1])
    up = cam - d * float(cam @ d)
    up /= np.linalg.norm(up)
    G = guard_pose()
    return _pose(G, _P(head=(-2, 4, 0)), (0, 0, 0),
                 one(ICON_HAND["rel"], tuple(d), tuple(up), pole=ICON_HAND["pole"], left=BELT_L))


def _icon_render(ctx, objs, P, fast: bool, scale: float):
    import time
    from common import imageops, render as R, scene
    spec = ctx.spec
    arm = ctx.info.armature
    cfg = R._splash_cfg(spec, None)
    light = R.map_lighting(cfg["map"])
    t0 = time.perf_counter()
    if arm.animation_data:
        arm.animation_data.action = None
    anim.apply_pose(arm, icon_pose())
    head = R.bone_pos(arm, "head")
    H = spec.PROPORTIONS["height"]
    lo = V((head.x - 0.2, head.y - 0.2, head.z + ICON_CAM["z0"] * H / 1.9))
    hi = V((head.x + 0.2, head.y + 0.2, head.z + ICON_CAM["z1"] * H / 1.9))
    cam = bpy.data.objects.get("vale_cam") or R.camera(lens=50)
    R.sky_world(light["sky"], light["ambient"], camera_strength=1.0)
    R._fit_camera(cam, lo, hi, ICON_CAM["yaw"], ICON_CAM["pitch"], 85.0, ICON_CAM["fill"], 1.0, 0.5)
    R.bible_lights(cam, cfg, light, rim=1.2, scale=0.6, pair=True, target=(lo + hi) * 0.5)
    S = 8 if fast else 1
    sz = max(32, int(round(128 * scale)))
    plate = R.backdrop_plate(cam, cfg, light, sz, sz, os.path.join(P["renders"], "_iplate.png"), fast, paint_r=1)
    R.setup(2 * sz, 2 * sz, max(16, 96 // S), view="Khronos PBR Neutral")
    raw = os.path.join(P["renders"], "icon_raw.png")
    R.render(raw)
    imageops.denoise(raw)
    fg = imageops.premul_resize(imageops.load(raw), sz, sz)
    os.remove(raw)
    sky = plate.copy()
    sky[..., :3] = sky[..., :3] * 0.85 + 0.05
    dest = (os.path.join(P["renders"], "preview_icon.png") if abs(scale - 1.0) > 1e-6
            else os.path.join(P["out"], "icon.png"))
    imageops.save(imageops.grade(imageops.over(fg, sky)), dest, alpha=False)
    for o in list(bpy.context.scene.objects):
        if o.type == "LIGHT" and o.name.startswith("vale_key_sun"):
            o.hide_render = True
    cam.data.shift_x = cam.data.shift_y = 0.0
    anim.apply_pose(arm, {})
    return scene.rel(dest), round(time.perf_counter() - t0, 2)


def _install_icon() -> None:
    from common import render
    if getattr(render.fighter_renders, "_burdam_icon", False):
        return
    orig = render.fighter_renders

    def fighter_renders(ctx, objs, P, skin, fast=False, clip_sheet=False, only=None, scale=1.0):
        from common import facechip       # (HUD-2: the shared face chip replaces this icon while Burdam has one)
        if getattr(ctx.spec, "ID", None) != ID or skin or facechip.params(ID) is not None:
            return orig(ctx, objs, P, skin, fast=fast, clip_sheet=clip_sheet, only=only, scale=scale)
        rest = (set(only) - {"icon"}) if only else {"splash", "portrait", "turntable"}
        res = {"files": {}, "seconds": {}}
        if rest:
            res = orig(ctx, objs, P, skin, fast=fast, clip_sheet=clip_sheet, only=rest, scale=scale)
        if not only or "icon" in only:
            f, sec = _icon_render(ctx, objs, P, fast, scale)
            res.setdefault("files", {})["icon"] = f
            res.setdefault("seconds", {})["icon"] = sec
        return res

    fighter_renders._burdam_icon = True
    fighter_renders._burdam = getattr(orig, "_burdam", False)
    render.fighter_renders = fighter_renders


def _install_bar_height() -> None:
    from common import pipeline
    if getattr(pipeline.art_fragment, "_burdam", False):
        return
    orig = pipeline.art_fragment

    def art_fragment(spec, clips_info, mesh_top=None):
        if getattr(spec, "ID", None) == ID and BAR_TOP:
            mesh_top = max(float(mesh_top or 0.0), BAR_TOP)
        return orig(spec, clips_info, mesh_top)

    art_fragment._burdam = True
    pipeline.art_fragment = art_fragment


if __name__ == "__main__":
    _install_body_bind()
    _install_paint_layers()
    _install_webp_quality()
    _install_skin_print()
    _install_render_specular()
    _install_portrait_rim()
    _install_icon()
    fighter.main(sys.modules[__name__])
