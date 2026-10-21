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
SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92}
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
     "palette": {"sandstone": "#D4C9A9", "cloth2": "#474F4C", "rust": "#6F7B7A", "stone": "#C4C8C4",
                 "ironstone": "#3E4A4C", "leather": "#554A3E", "cloth": "#55615F", "under": "#2B3234",
                 "reed": "#7D8460", "dawnglass": "#8FB3A8"}},
    {"id": "burdam_almanac", "extra": {"almanac_board": True}, "match": ["rust", "cloth", "ironstone"],
     "card": {"primary": "#4A453E", "secondary": "#D8CDB4"},
     # parchment a step under the mask and the tunic a step down (the mask stays the brightest value)
     "palette": {"cloth2": "#C6B9A5", "rust": "#C2B69B", "stone": "#CFC8B8", "ironstone": "#2E2A26",
                 "cloth": "#6B6256", "parchment": "#C2B69B", "walnut": "#5A4639"}},
]
SKIN_FLAT = {"reed_plates_R": "reed", "reed_plates_L": "reed", "river_glass_tier1": "dawnglass",
             "river_glass_tier2": "dawnglass", "river_glass_tier3": "dawnglass", "river_bezel_tier1": "ironstone",
             "river_bezel_tier2": "ironstone", "river_bezel_tier3": "ironstone", "almanac_wood": "walnut",
             "almanac_face": "parchment"}

HEIGHT = 2.56             # the cleaver tip in the concept (the projection plates' scale; mask crown 2.15)
PROJECTION = {"concept": "burdam", "height": HEIGHT}
NOISE = sdf.Noise(11)
VOXEL = 0.007
CLEAVER = ("blade", "heel", "gems", "haft", "pommel")      # prop-space parts (paint pose, see paint_object)


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


# ── the sculpt ────────────────────────────────────────────────────────────────────────────────────
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
    mask.add(RoundBox((-0.012, -0.160, 2.035), (0.112, 0.022, 0.013), 0.011), k=0.02)   # brow shelf
    mask.add(RoundCone((-0.012, -0.164, 1.99), (-0.012, -0.198, 1.905), 0.026, 0.013), k=0.022)   # beak keel
    for sx, xc in ((-1, -0.068), (1, 0.058)):
        mask.sub(Ellipsoid((xc, -0.178, 2.002), (0.040, 0.032, 0.0165), axes=rot(ry=sx * 9)), k=0.006)
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

    # TALLY STICKS (rigid on the hips, no sway): a front bundle left of the buckle, one behind; each stick
    # hangs on the coat's curve (skirt section ~0.34 x 0.27 m at the sticks), turned to its tangent
    tally = Sculpt("tally")

    def on_coat(x, sy):
        c = math.sqrt(max(0.0, 1.0 - (x / 0.345) ** 2))
        y = sy * (0.27 * c + 0.022)
        ang = -sy * math.degrees(math.atan2(0.27 * x / 0.345 ** 2, max(c, 0.2)))   # tangent turn about Z
        return y, ang
    for i, (x, z, ln, a) in enumerate([(0.045, 1.125, 0.135, 3), (0.080, 1.115, 0.15, -2), (0.115, 1.12, 0.14, 4),
                                       (0.180, 1.13, 0.13, -3), (0.215, 1.115, 0.15, 2), (0.250, 1.125, 0.135, -4),
                                       (0.285, 1.12, 0.13, 3)]):
        y, rz = on_coat(x, -1)
        tally.add(RoundBox((x, y - 0.004 * (i % 2), z), (0.0155, 0.011, ln), 0.005, axes=rot(ry=a, rz=rz)), k=0.0)
    for x0 in (0.08, 0.232):
        y, rz = on_coat(x0, -1)
        tally.add(Torus((x0, y, 1.215), 0.058, 0.007, axes=np.diag([1.0, 2.6, 1.0]) @ rot(rz=rz), rz=0.009), k=0.003)
    for i, (x, z, ln, a) in enumerate([(0.130, 1.09, 0.13, 3), (0.170, 1.085, 0.135, -3), (0.210, 1.09, 0.125, 2),
                                       (0.250, 1.085, 0.13, -2), (0.285, 1.09, 0.125, 3)]):
        y, rz = on_coat(x, 1)
        tally.add(RoundBox((x, y + 0.004 * (i % 2), z), (0.0155, 0.011, ln), 0.005, axes=rot(ry=a, rz=rz)), k=0.0)
    part("tally", tally, "wood_dark", "bone:hips", 560, 0.6)

    # ARMS: wrapped forearms (heat weights), the gloved fists (rigid on the hands)
    fore = Sculpt("forearms")
    for sx in (-1, 1):
        fa = FlatCapsule((sx * 0.465, -0.012, 1.31), (sx * 0.518, -0.055, 1.08), 0.138, 0.13, 0.09, 0.095,
                         side=(1, 0, 0))
        fore.add(fa.displaced(wraps(0.006, 70.0), 0.007), k=0.0)
    part("forearms", fore, "leather", "coat", 900)
    fist = Sculpt("fist_R")
    c = np.array([-0.505, -0.075, 0.958])
    fist.add(RoundBox(c, (0.098, 0.090, 0.088), 0.055), k=0.0)
    for i in range(4):                                                 # knuckle rolls, facing front-down
        fist.add(Capsule(c + (0.065, -0.075, 0.055 - i * 0.038), c + (-0.055, -0.075, 0.055 - i * 0.038),
                         0.026), k=0.02)
    fist.add(Capsule(c + (0.085, -0.05, 0.065), c + (0.06, -0.085, -0.015), 0.032), k=0.02)   # thumb
    part("fist_R", fist, "leather", "bone:hand.R", 650)
    # the LEFT hand opens (the Settled Account reach, the victory's palm-up host): the back of the hand and
    # the thumb ride hand.L; the four fingers are one gloved slab on prop.L, modelled OPEN (hanging straight
    # from the palm) and curled into the fist by the clips (FIST_CURL on prop.L)
    palm = Sculpt("palm_L")
    c = np.array([0.520, -0.058, 1.000])
    palm.add(RoundBox(c, (0.066, 0.086, 0.062), 0.038), k=0.0)
    palm.add(Capsule(c + (-0.050, -0.070, 0.015), c + (-0.072, -0.118, -0.050), 0.027), k=0.02)   # thumb
    part("palm_L", palm, "leather", "bone:hand.L", 380)
    fingers = Sculpt("fingers_L")                                      # four gloved fingers, a slight curl
    for i, fy in enumerate((-0.118, -0.080, -0.042, -0.006)):
        ln = (0.098, 0.108, 0.104, 0.090)[i]
        a = np.array([0.530, fy, 0.962])
        fingers.add(Capsule(a, a + (-0.014, 0.0, -ln), 0.0215), k=0.004)
    part("fingers_L", fingers, "leather", "bone:prop.L", 340)

    # FOREARM PLATES: the big carved vambrace on the left, an iron strip on the right (rigid on the forearms)
    vb = Sculpt("vambrace")
    outer = FlatCapsule((0.468, -0.012, 1.38), (0.515, -0.05, 1.135), 0.165, 0.155, 0.125, 0.128, side=(1, 0, 0))
    inner = FlatCapsule((0.468, -0.012, 1.44), (0.515, -0.05, 1.08), 0.135, 0.128, 0.092, 0.095, side=(1, 0, 0))
    vb.add(outer.displaced(chips(0.008, 8.0), 0.008), k=0.0)
    vb.sub(inner, k=0.004)
    vb.inter(HalfSpace((0.455, 0, 0), (-1, 0.0, 0), 1.0), k=0.012)                     # the front-outer shell
    vb.inter(HalfSpace((0, 0.07, 0), (0, 1, 0), 1.0), k=0.012)                         # wraps to the front
    part("vambrace", vb, "rust", "bone:forearm.L", 450)
    fs = Sculpt("strap_plate")
    o2 = FlatCapsule((-0.468, -0.012, 1.30), (-0.522, -0.055, 1.02), 0.150, 0.14, 0.105, 0.11, side=(1, 0, 0))
    fs.add(o2, k=0.0)
    fs.sub(FlatCapsule((-0.468, -0.012, 1.35), (-0.522, -0.055, 0.97), 0.136, 0.128, 0.093, 0.098, side=(1, 0, 0)),
           k=0.003)
    fs.inter(HalfSpace((-0.565, 0, 0), (1, 0, 0), 1.0), k=0.01)
    part("strap_plate", fs, "rust", "bone:forearm.R", 200)

    # RIGHT SHOULDER: the carved front plate (on the clavicle) over a leather fringe (on the upper arm)
    sp = Sculpt("shoulder_plate")
    sp.add(RoundBox((-0.315, -0.215, 1.69), (0.155, 0.035, 0.095), 0.03, axes=rot(rx=-28, ry=-12)).displaced(
        chips(0.009, 7.0), 0.009), k=0.0)
    sp.add(RoundBox((-0.19, -0.255, 1.625), (0.085, 0.025, 0.038), 0.018, axes=rot(rx=-15, ry=6)), k=0.01)
    part("shoulder_plate", sp, "rust", "bone:shoulder.R", 500)
    fr = Sculpt("fringe")
    for i in range(7):
        a = -70.0 + i * 22.0                                           # around the arm's outer side, front -> back
        x = -0.395 - 0.08 * math.cos(math.radians(a))
        y = 0.13 * math.sin(math.radians(a))
        fr.add(RoundBox((x, y, 1.578 - 0.006 * (i % 2)), (0.010, 0.021, 0.08), 0.006, axes=rot(rz=-a)), k=0.0)
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
    t4_top = [(0.32, 0.0, 1.51), (0.48, 0.0, 1.525), (0.625, 0.0, 1.462), (0.49, -0.16, 1.42), (0.49, 0.16, 1.42)]
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
        boots.add(RoundBox(at(0.0, -0.02, 0.0125), (0.096, 0.2, 0.0125), 0.006, axes=R), k=0.004)   # flat sole
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
    for (gu, gv, a, b) in cl.GEMS:                                     # one accent diamond inlaid under each bite
        gems.add(Plate(_diamond(gu, gv, a, b), 0.0350, r=0.004), k=0.0)    # proud of the setting (decimation-safe)
    for poly in cl.notch_floors():                                     # the accent set in each bite's floor (s.7)
        gems.add(Plate(poly, 0.026, r=0.002), k=0.0)
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
    for side in (-1, 1):                                               # a carved diamond, not a gem
        pom.sub(Plate(_diamond(cl.POMMEL_U, 0.0, *cl.POMMEL_INSET), 0.008, r=0.002, dw=side * 0.033), k=0.003)
    part("pommel", pom, "ironstone", "bone:prop.R", 300, 0.6, "prop")
    return out


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
        # three flat, rigid reed slats per shoulder (7 cm wide, 2 cm thick, 30 cm long, no sway), laid back over
        # the shoulder in a shallow fan like shingles, each with three cut nodes across it and one lashing
        # band over all three near the base: plates, not fronds
        for side in ("L", "R"):
            reeds = Sculpt(f"reed_plates_{side}")
            if side == "L":
                base, bone = np.array([0.30, 0.12, 1.90]), "shoulder.L"
                fans, tilt, ln = (14.0, 34.0, 54.0), -62.0, 0.15
            else:
                base, bone = np.array([-0.30, 0.13, 1.76]), "shoulder.R"
                fans, tilt, ln = (-30.0, -50.0, -70.0), -60.0, 0.14
            ends = []
            for k, fan in enumerate(fans):
                ax = rot(rx=tilt, ry=fan)                  # long axis (local Z), laid back by `tilt`
                d = ax[2]
                c = base + d * (ln + 0.01) + np.array([0.0, 0.0, 0.012 * k])
                reeds.add(RoundBox(c, (0.035, 0.010, ln), 0.006, axes=ax), k=0.0)
                for q in (-0.5, 0.0, 0.5):                 # the cut nodes across the slat
                    reeds.add(RoundBox(c + d * ln * q, (0.037, 0.0125, 0.006), 0.004, axes=ax), k=0.003)
                ends.append(c - d * ln * 0.55)
            e = np.asarray(ends)
            reeds.add(Capsule(e[0], e[-1], 0.012), k=0.006)                   # the lashing over the three
            out.append((f"reed_plates_{side}", reeds, 0.6, "wood", f"bone:{bone}", 480, "world"))
    if extra.get("river_glass"):
        # river-glass shards set into the pauldron tiers' slopes (front and back): long irregular slivers in
        # a thin basalt bezel, laid along each tier's edge; glossy, never emissive. Seated on the CURRENT tier
        # surfaces (found by bisection on the tier SDFs), so they follow the tier shapes.
        tiers = {nm: S for (nm, S, *_r) in sculpts() if nm.startswith("tier")}
        spots = {"tier1": [((0.33, -0.05, 1.80), (-0.4, -0.8, 0.45), 18.0), ((0.36, 0.05, 1.80), (-0.3, 0.8, 0.5), -14.0)],
                 "tier2": [((0.60, -0.05, 1.70), (0.35, -0.6, 0.7), -25.0), ((0.60, 0.05, 1.70), (0.35, 0.6, 0.7), 25.0)],
                 "tier3": [((0.48, -0.05, 1.56), (0.35, -0.5, 0.8), -22.0), ((0.48, 0.05, 1.56), (0.3, 0.6, 0.75), 22.0)]}
        bones = {"tier1": "shoulder.L", "tier2": "shoulder.L", "tier3": "upper_arm.L"}
        for tier, pts in spots.items():
            g, bz = Sculpt(f"river_glass_{tier}"), Sculpt(f"river_bezel_{tier}")
            for (p0, n0, spin) in pts:
                p, n = seat(tiers[tier], p0, n0)
                F_ = rot(rz=spin) @ sdf.frame(n, (1.0, 0.0, 0.0))       # rows: along the shard, across, normal
                shard = [(-0.062, 0.004), (-0.02, 0.019), (0.035, 0.015), (0.066, -0.002), (0.018, -0.017),
                         (-0.04, -0.013)]
                pts3 = [p + F_.T @ np.array([u, v, w]) for (u, v) in shard for w in (-0.002, 0.004)]
                g.add(Hull(pts3, k=0.003), k=0.0)
                ring = [p + F_.T @ np.array([u * 1.18 + np.sign(u) * 0.006, v * 1.5 + np.sign(v) * 0.004, w])
                        for (u, v) in shard for w in (-0.006, 0.0025)]
                bz.add(Hull(ring, k=0.003), k=0.0)
            out.append((f"river_bezel_{tier}", bz, 0.5, "ironstone", f"bone:{bones[tier]}", 120, "world"))
            out.append((f"river_glass_{tier}", g, 0.5, "dawnglass", f"bone:{bones[tier]}", 120, "world"))
    if extra.get("almanac_board"):
        # a carved walnut board (0.20 x 0.26 m, 2 cm thick) with a parchment face, hung from the belt on the
        # right hip by two leather loops; rigid on the hips
        R = rot(rz=-38.0, rx=-6.0)
        n = -R[1]                                      # the face looks out from the right hip
        c = np.array([-0.278, -0.208, 0.965])
        wood, face = Sculpt("almanac_wood"), Sculpt("almanac_face")
        wood.add(RoundBox(c, (0.10, 0.012, 0.13), 0.008, axes=R), k=0.0)
        for dx in (-0.06, 0.06):
            p0 = c + R.T @ np.array([dx, 0.0, 0.13])
            wood.add(Torus(p0 + (0, 0, 0.03), 0.028, 0.008, axes=R @ rot(ry=90.0)), k=0.004)
        face.add(RoundBox(c + n * 0.011, (0.085, 0.004, 0.115), 0.003, axes=R), k=0.0)
        out.append(("almanac_wood", wood, 0.6, "wood_dark", "bone:hips", 300, "world"))
        out.append(("almanac_face", face, 0.6, "sandstone", "bone:hips", 120, "world"))
    return out


def sculpt_d(S: Sculpt, P) -> np.ndarray:
    """a Sculpt's signed distance at points P (n, 3), the op list in order (no grid)"""
    P = np.atleast_2d(np.asarray(P, dtype=np.float64))
    D = np.full(len(P), 1e3)
    for op, prim, k, _ in S.ops:
        di = prim.d(P)
        D = sdf.smin(D, di, k) if op == "add" else (sdf.smax(D, -di, k) if op == "sub" else sdf.smax(D, di, k))
    return D


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
    stone = materials.honed_stone("stone", ctx.palette, "stone", ctx.gradient, rough=0.66, chisel=0.35)
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
            "leather": materials.waxed_leather("leather", ctx.palette, "leather", ctx.gradient, rough=0.72)}


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
# the shoulder carry: right fist over the right shoulder, the cleaver up and back behind the head to the upper
# left, its FLAT turned to the front and the sky (the concept's broad blade behind the head, never edge-on to
# the game camera), the spine up and back
# the blade rises at ~51 degrees (brief section 1: the diagonal bar above the head, its notches below the HP bar);
# its flat faces front and sky (rolling it further to the sky twists the wrist into the forearm wraps)
CARRY = dict(rel=(-0.20, -0.26, 0.40), pole=(-1.0, 0.25, -0.3), d=(0.54, 0.32, 0.78), up=(0.05, 0.76, -0.65))
BELT_L = (0.10, -0.16, -0.94)          # the free left fist at the belt
EDGE_DOWN = (1.0, 0.0, 0.0)            # flat normal for chops in the sagittal plane (the edge leads down)
FIST_CURL = (0.0, -100.0, 0.0)         # prop.L: the left fingers curled into the fist
OPEN = (0.0, 0.0, 0.0)                 # prop.L: the left hand open (the fingers as modelled)
GRIP2 = -0.17                          # the off hand on the haft, below the main fist (two-handed chops)
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

    def soft_grip(self, pose: dict, along: float = GRIP2) -> dict:
        """the same pose with the off hand's haft grip as a rel target (lerps smoothly from a free hand)"""
        out = dict(pose)
        out["ik"] = dict(pose["ik"])
        out["ik"]["hand.L"] = HT(rel=self.left_rel(pose, along), pole=(0.8, 0.4, -0.4))
        return out


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
    short around the carry, the left fist pumps"""
    c = CARRY
    r0 = c["rel"]
    d = (0.50, 0.33, 0.80)                      # a touch further back than the idle: the run twists the chest
    blocks = {"run_fwd": ((r0[0] + 0.03, r0[1] + 0.02, r0[2] + 0.02), c["pole"], d, (0.14, -0.50, -0.70), None),
              "run_back": ((r0[0] - 0.02, r0[1] + 0.10, r0[2] + 0.00), c["pole"], d, (0.12, 0.28, -0.86), None)}
    prof = dict(MOTION, weapon="one_hand", blocks=blocks)
    base = anim.gen_run(prof)
    up = c["up"]

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
    """the overhead chop (attack1, Bear Down, the dash): the right fist lifts the cleaver off the shoulder high
    over the right shoulder, the blade laid back and the short haft pointing forward (clear of the arm), the
    left hand reaching in; both fists meet on the haft and drive it down in front, arms long, the torso
    leaning in, so the haft's tail ends in front of the chest (never in it); the follow-through drops the
    right fist to the front of the right hip one-handed (the tail passes outside the body) and the tip bites
    the ground ahead, the left hand swinging out as a counterweight. `lunge` (0..1) adds Bear Down's long step
    and 20 degree lean. Returns (wind, hit, follow, recover): `recover` swings the blade up on the outside of
    the right arm, so the way back to the shoulder never passes through the head."""
    L = lunge
    feet_w = step(G, dl=(0.0, -0.06, 0.0), dr=(0.0, 0.03, 0.0))
    wind = _pose(G, _P(hips=(-4, -8, 0), spine=(-6, -6, 0), chest=(-8, -10, 0), head=(-4, 8, 0)), (0, 0.05, 0.01),
                 dict(one((-0.24, 0.02, 0.92), (0.10, 0.86, 0.50), EDGE_DOWN, pole=(-1.0, 0.0, 0.1),
                          left=(0.0, -0.66, 0.20), lpole=(0.9, 0.2, -0.3)), **feet_w))
    fdl = (0.0, -0.20 - 0.24 * L, 0.0)
    feet_h = step(G, dl=fdl, dr=(0.0, 0.04 + 0.04 * L, 0.0), pr=-10 - 8 * L)
    # the impact: both fists at the front of the RIGHT hip, arms long, the torso leaning in and turned a
    # little to the right; the blade points forward, down and a touch left, so the haft's tail runs back up
    # past the right side of the body instead of into the belly
    hit = _pose(G, _P(hips=(12 + 8 * L, -8, 0), spine=(8 + 4 * L, -6, 0), chest=(6 + 4 * L, -10, 0), neck=(-10, 6, 0),
                      head=(-12, 8, 0)), (0, -0.12 - 0.16 * L, -0.10 - 0.04 * L),
                dict(two(HIT_REL, HIT_D, EDGE_DOWN, pole=(-0.9, 0.3, -0.3), lpole=(0.7, 0.4, -0.5)), **feet_h))
    fol = _pose(G, _P(hips=(16 + 6 * L, -4, 0), spine=(10 + 4 * L, -2, 0), chest=(6 + 4 * L, -2, 0), neck=(-12, 0, 0),
                      head=(-12, -2, 0)), (0, -0.14 - 0.16 * L, -0.13 - 0.04 * L),
                dict(one(FOL_REL, FOL_D, EDGE_DOWN, pole=(-0.9, 0.2, -0.3),
                         left=(0.62, -0.30, -0.55), lpole=(0.9, 0.3, -0.3)), **feet_h))
    hit = R.soft_grip(R.tip_to(hit, CHOP_TIP_Z + 0.20, only_below=True))
    fol = R.tip_to(fol, CHOP_TIP_Z)
    rec = _pose(G, _P(hips=(6, 4, 0), spine=(4, 2, 0), chest=(2, -6, 0), head=(-2, 6, 0)), (0, -0.06, -0.04),
                one((-0.62, -0.20, 0.05), (-0.62, -0.12, 0.78), EDGE_DOWN, pole=(-0.9, 0.3, -0.3), left=BELT_L))
    return wind, hit, fol, rec


def chop_keys(G, wind, hit, fol, rec) -> list:
    """the VALE strike timing (anim.strike_keys: impact at 40 %, coil, drive, impact hold, dragging
    follow-through) with the recovery routed out and up on the right (rec) instead of a straight lerp
    from the follow-through back to the shoulder, which swung the blade through the head"""
    keys = anim.strike_keys(MOTION, wind, hit, fol, G)
    out = []
    for (t, p, e) in keys:
        if t >= 0.7:
            continue
        if abs(t - 0.34) < 1e-6:                            # the drive: the blade swings over in FRONT of the head
            p = dict(p)
            p["ik"] = dict(p["ik"], **{"aim.R": AimRoll((0.10, -0.95, -0.30), 1.0, EDGE_DOWN)})
        out.append((t, p, e))
    out += [(0.76, rec, "inout"), (0.88, anim.lerp_pose(rec, G, 0.6), "inout"), (1.0, G, "settle")]
    return out


def clip_overrides(ctx) -> dict:
    """Brief section 8 -> gestures (impact at 40 % of every attack / cast):
      attack1  two-handed overhead chop off the shoulder, the front foot steps in (30 f, f12)
      attack2  backhand horizontal cut, the left foot steps, the free arm counter-swings (40 f, f16)
      cast_a1  Bear Down: off the shoulder overhead in both fists, a lunge with a 20 degree lean (25 f, f10)
      cast_a2  Stubborn: the tip planted in front, both hands on the pommel, the stance locks (30 f, f12)
      cast_a3  Old Wound: a wide waist-high sweep right to left, 90 degree draw, pause at f20 (30 f, f12)
      cast_ult Settled Account: the left arm thrown OUT open-palmed, then the fist closes and yanks back to the
               chest as the cleaver stamps down in front, the body rocks back (45 f, f18)
      dash     Bear Down's lunge (the sim dashes him; the clip is stretched over the dash): the cleaver held
               high in both fists, chopped down on arrival"""
    R = Rig(ctx)
    G = guard_pose()
    out = {"idle": gen_idle_carry(), "run": gen_run_carry()}
    I = anim.IMPACT

    # attack1: the two-handed overhead chop, a step in
    wind, hit, fol, rec = chop_poses(R, G, 0.0)
    out["attack1"] = anim.Clip("attack1", 30, False, anim.drag(anim.keyed(chop_keys(G, wind, hit, fol, rec)), 30,
                                                                {"head": 1.5, "neck": 1.0}), impact=I)

    # attack2: backhand horizontal cut, left to right across the front. The cleaver comes off the shoulder
    # upright in front of the right shoulder (lift), then is cocked ACROSS the front of the chest pointing
    # left (the backhand chamber, clear of the body), sweeps through the front at belly height and follows
    # through out to the right; the left foot steps, the hips turn and travel, the free arm counter-swings;
    # the way back up to the shoulder goes up the right side
    flat_cw = (0.0, 0.0, -1.0)                 # flat normal for a left -> right sweep (the edge leads)
    lift = _pose(G, _P(hips=(2, 8, 0), spine=(2, 6, 0), chest=(2, 8, 0), head=(0, -6, 0)), (0.01, 0.0, -0.01),
                 one((-0.22, -0.55, 0.30), (0.40, -0.32, 0.86), (0.0, -0.9, -0.4), pole=(-0.9, 0.2, -0.4), left=BELT_L))
    wind = _pose(G, _P(hips=(2, 22, 0), spine=(2, 14, 0), chest=(4, 20, 0), head=(0, -18, 0)), (0.03, 0.04, -0.03),
                 dict(one((0.18, -0.90, -0.22), (0.95, -0.22, 0.10), flat_cw, pole=(-0.6, 0.3, -0.6),
                          left=(0.40, 0.30, -0.70), lpole=(0.9, 0.3, -0.3)), **step(G, dl=(0.02, 0.04, 0), pl=-8)))
    hit = _pose(G, _P(hips=(6, -10, 0), spine=(4, -6, 0), chest=(5, -12, 0), head=(0, 10, 0)), (-0.04, -0.12, -0.07),
                dict(one((-0.05, -0.92, -0.15), (-0.35, -0.93, -0.05), flat_cw, pole=(-0.8, 0.3, -0.4),
                         left=(0.80, -0.20, -0.45)), **step(G, dl=(0.04, -0.20, 0), dr=(0.0, 0.04, 0), pr=-14, yr=-24)))
    fol = _pose(G, _P(hips=(6, -26, 0), spine=(4, -16, 0), chest=(5, -26, 0), head=(0, 20, 0)), (-0.06, -0.14, -0.08),
                dict(one((-0.65, -0.50, -0.10), (-0.92, 0.32, 0.05), flat_cw, pole=(-0.6, 0.6, -0.5),
                         left=(0.85, 0.05, -0.40)), **step(G, dl=(0.04, -0.20, 0), dr=(0.0, 0.04, 0), pr=-18, yr=-30)))
    rec2 = _pose(G, _P(hips=(2, -8, 0), spine=(2, -6, 0), chest=(0, -8, 0)), (0, -0.04, -0.03),
                 one((-0.62, -0.10, 0.10), (-0.55, 0.20, 0.81), CARRY["up"], pole=(-0.9, 0.3, -0.3), left=BELT_L))
    k2 = anim.strike_keys(MOTION, wind, hit, fol, G)
    k2 = [(0.0, G, "linear"), (0.11, lift, "inout")] + [k for k in k2 if 0.2 < k[0] < 0.7] + \
         [(0.78, rec2, "inout"), (0.89, anim.lerp_pose(rec2, G, 0.6), "inout"), (1.0, G, "settle")]
    out["attack2"] = anim.Clip("attack2", 40, False, anim.drag(anim.keyed(k2), 40,
                                                                {"head": 2.0, "neck": 1.5, "hand.L": 1.5}), impact=I)

    # cast_a1 Bear Down: 4-frame anticipation, the cleaver up over the head in both fists, one overhand arc
    # into the lunge (20 degree lean), the chop lands at f10 biting the ground ahead, follow-through to f17,
    # back on the shoulder by f25
    wind, hit, fol, rec = chop_poses(R, G, 1.0)
    up_ = anim.lerp_pose(G, wind, 0.55)
    hold = anim._with_hips(hit, (0, -0.01, -0.02))
    over = anim.lerp_pose(wind, hit, 0.35)                 # the blade swings over in FRONT of the head
    over["ik"] = dict(over["ik"], **{"aim.R": AimRoll((0.12, -0.62, 0.78), 1.0, EDGE_DOWN)})
    out["cast_a1"] = clip("cast_a1", 25, [(0.0, G, "linear"), (0.12, up_, "out"), (0.28, wind, "inout"),
                                          (0.34, over, "in"), (I, hit, "accel"),
                                          (0.50, hold, "out"), (0.66, fol, "out"), (0.80, rec, "inout"),
                                          (0.90, anim.lerp_pose(rec, G, 0.6), "inout"), (1.0, G, "settle")],
                          impact=I)
    # dash: stretched over Bear Down's travel: he throws himself forward at once (a 20 degree lean, the hips
    # dropped, the cleaver cocked high in both fists) and chops down on arrival (front-loaded: a short dash
    # lasts 3 ticks, so the chop must already have landed by 2/3 of the clip)
    lean = _pose(wind, _P(hips=(22, 0, 0), spine=(10, 0, 0), chest=(6, 0, 0), neck=(-12, 0, 0), head=(-12, 0, 0)),
                 (0, -0.14, -0.08), step(G, dl=(0.0, -0.30, 0.0), dr=(0.0, 0.20, 0.02), pl=0, pr=-26))
    lean0 = anim.lerp_pose(wind, lean, 0.6)
    out["dash"] = anim.Clip("dash", 20, False, anim.keyed([(0.0, lean0, "linear"), (0.15, lean, "out"),
                                                            (0.40, anim._with_hips(lean, (0, -0.03, -0.01)), "linear"),
                                                            (0.52, over, "in"), (0.62, hit, "accel"), (1.0, hold, "out")]))

    # cast_a2 Stubborn: plant the tip in front, both hands folded on the pommel, head down, chest up; the stance
    # locks wide at f12; hold, breathe
    out["cast_a2"] = _stubborn(R, G)

    # cast_a3 Old Wound: draw back to the right with a 90 degree turn, sweep waist-high across the cone, follow
    # through 100 degrees and pause at f20 (the wound reopening), then back to the shoulder; the left foot steps
    # out, the right heel turns, the free arm swings back against the sweep
    flat_ccw = (0.0, 0.0, 1.0)                 # right -> left sweep
    draw = _pose(G, _P(hips=(4, -32, 0), spine=(4, -22, 0), chest=(4, -30, 0), head=(-2, 26, 0)), (0.04, 0.06, -0.06),
                 dict(one((-0.58, 0.18, -0.38), (-0.86, 0.48, -0.10), flat_ccw, pole=(-0.5, 0.8, -0.3),
                          left=(0.55, -0.55, -0.40), lpole=(0.9, 0.2, -0.3)), **step(G, dr=(0, 0.05, 0), pl=-10)))
    hit = _pose(G, _P(hips=(8, 8, 0), spine=(6, 4, 0), chest=(6, 6, 0), head=(-4, -6, 0)), (-0.04, -0.12, -0.12),
                dict(one((0.10, -0.92, -0.32), (0.12, -0.98, -0.10), flat_ccw, pole=(-0.9, 0.2, -0.3),
                         left=(0.60, 0.40, -0.55)), **step(G, dl=(0.06, -0.18, 0), pr=-12, yr=-26)))
    fol = _pose(G, _P(hips=(8, 32, 0), spine=(6, 20, 0), chest=(6, 30, 0), head=(-4, -24, 0)), (-0.06, -0.12, -0.12),
                dict(one((0.62, -0.66, -0.35), (0.95, 0.10, -0.10), flat_ccw, pole=(-0.4, -0.6, -0.6),
                         left=(0.35, 0.55, -0.65)), **step(G, dl=(0.06, -0.18, 0), pr=-16, yr=-6)))
    pause = anim._with_hips(anim.add(fol, _P(chest=(2, 2, 0), head=(4, 0, 0))), (0, 0, -0.012))
    # back to the shoulder by way of the cleaver held upright in front of the right shoulder (never over the head)
    rec = _pose(G, _P(hips=(2, 8, 0), spine=(0, 4, 0), chest=(-2, 4, 0)), (0, -0.02, -0.03),
                one((-0.30, -0.62, 0.10), (0.06, -0.22, 0.97), (0.0, -0.97, 0.22), pole=(-0.9, 0.2, -0.4), left=BELT_L))
    out["cast_a3"] = clip("cast_a3", 30, [(0.0, G, "linear"), (0.08, anim.lerp_pose(G, draw, -0.08), "inout"),
                                          (0.27, draw, "inout"), (0.33, anim.lerp_pose(draw, hit, 0.15), "in"),
                                          (I, hit, "accel"), (0.55, fol, "out"), (0.667, pause, "out"),
                                          (0.84, rec, "inout"), (1.0, G, "settle")], impact=I)

    # cast_ult Settled Account: the left arm thrown OUT, open-palmed toward the enemies, the cleaver cocked high
    # (f0-10); at f18 the fist closes and yanks back to the chest as the cleaver stamps down in front and the
    # body rocks back 10 degrees: a ring closing; hold the stamp f18-f30, then straighten
    reach = _pose(G, _P(hips=(4, -12, 0), spine=(4, -8, 0), chest=(2, -10, 0), head=(-8, 8, 0),
                        shoulder_L=(0, 0, 10)), (0.02, -0.06, -0.04),
                  dict(one((-0.46, 0.08, 0.56), (-0.12, 0.62, 0.78), EDGE_DOWN, pole=(-0.9, 0.0, -0.3),
                           left=(0.62, -0.74, 0.20), lpole=(0.6, 0.6, -0.6)), **step(G, dl=(0.04, -0.16, 0), pr=-8)))
    # the open left hand: aim.L turns the hand so the palm (prop.L +X) faces the enemy, fingers up (the knuckle
    # line, prop.L +Y = palm x fingers, runs inward)
    reach = with_hand(reach, OPEN)
    reach["ik"] = dict(reach["ik"], **{"aim.L": palm_aim((0.45, -0.88, 0.10), (0.0, 0.10, 1.0))})
    reach2 = anim.add(reach, _P(chest=(2, -2, 0), shoulder_L=(0, 0, 3)))
    stamp = _pose(G, _P(hips=(-8, 8, 0), spine=(-8, 4, 0), chest=(-10, 6, 0), neck=(6, 0, 0), head=(8, -4, 0),
                        shoulder_L=(0, 0, 6)), (0, 0.10, -0.10),
                  dict(one((0.20, -0.80, -0.40), (0.02, -0.40, -0.92), EDGE_DOWN, pole=(-0.9, 0.2, -0.3),
                           left=(-0.12, -0.66, -0.12), lpole=(0.9, 0.2, -0.5)),
                       **step(G, dl=(0.04, -0.16, 0), dr=(0.0, 0.10, 0), pl=-6)))
    stamp = R.tip_to(with_hand(stamp, FIST_CURL))
    hold = anim.add(stamp, _P(chest=(-1, 0, 0)))
    out["cast_ult"] = clip("cast_ult", 45, [(0.0, G, "linear"), (0.08, anim.lerp_pose(G, reach, -0.06), "inout"),
                                            (0.20, reach, "out"), (0.33, reach2, "inout"), (I, stamp, "snap"),
                                            (0.47, anim._with_hips(stamp, (0, 0.01, -0.012)), "out"),
                                            (0.67, hold, "linear"), (0.80, out_right(G), "inout"),
                                            (0.90, anim.lerp_pose(out_right(G), G, 0.6), "inout"),
                                            (1.0, G, "settle")], impact=I)

    out.update(_gen_rest_clips(R, G))
    soles = sole_points(R.skel)
    return {k: (_fisted(v) if k == "run" else _grounded(_fisted(v), R.skel, soles)) for k, v in out.items()}


# the planted cleaver (Stubborn, the channel): the tip bites ~3 cm into the ground well ahead, the cleaver
# leaning back toward him at ~50 degrees: the right fist on the haft below, the left hand folded over the
# pommel at chest height, so the pommel sits in front of the chest, never under the chin
PLANT_D = (0.35, -0.55, -0.76)              # planted ahead and a little left: the pommel passes the right of the chest
PLANT_UP = (0.0, -0.77, 0.64)                  # the flat to the front (the slabs face the camera)


def out_right(G, left=None, k: float = 1.0) -> dict:
    """the cleaver taken off the shoulder OUTWARD: the fist at the right side at chest height, the blade
    pointing up, forward and out to the right. Every move between the shoulder carry and a pose with the
    blade down in front passes through here, so the blade never sweeps through the head or the body"""
    return _pose(G, _P(hips=(2, -4 * k, 0), spine=(2, -4 * k, 0), chest=(0, -6 * k, 0), head=(0, 4 * k, 0)),
                 (0, -0.02, -0.02), one((-0.62, -0.30, 0.0), (-0.62, -0.42, 0.66), (0.0, -0.84, -0.54),
                                        pole=(-0.9, 0.4, -0.3), left=left or BELT_L))


def _plant_two(crouch=1.25, feet=None):
    """both hands folded over the pommel, the tip in the ground in front"""
    wide = feet or feet_b(l=(0.08, -0.06, 0.0), r=(-0.08, 0.07, 0.0), yl=14, yr=-16)
    return anim.merge(anim.arms_relaxed(),
                      _pose(stance_b(crouch, wide), _P(hips=(4, 0, 0), spine=(0, 0, 0), chest=(-6, 0, 0), neck=(4, 0, 0),
                                                       head=(8, 0, 0), shoulder_L=(0, 0, 4), shoulder_R=(0, 0, -4)),
                            (0, 0.0, -0.02), dict(two(PLANT_REL, PLANT_D, PLANT_UP, pole=(-0.9, 0.2, -0.4), grip=PLANT_GRIP),
                                                  **wide)), _P(prop_L=FIST_CURL))


PLANT_REL = (0.45, -0.84, -0.54)
HIT_REL = (0.30, -0.96, -0.30)         # the chop's impact: fists at the front of the right hip
HIT_D = (0.34, -0.58, -0.74)
FOL_REL = (-0.10, -0.80, -0.78)        # the follow-through: the right fist low at the right hip, one-handed
FOL_D = (0.26, -0.60, -0.76)
PLANT_GRIP = -0.30


def _stubborn(R, G) -> anim.Clip:
    plant_d, plant_up = PLANT_D, PLANT_UP
    lift = out_right(G, left=(0.10, -0.40, -0.55))
    fold = _pose(G, _P(hips=(4, 0, 0), spine=(4, 0, 0), chest=(2, 0, 0), neck=(4, 0, 0), head=(6, 0, 0)), (0, 0.0, -0.05),
                 dict(two(PLANT_REL, plant_d, plant_up, pole=(-0.9, 0.2, -0.4), grip=PLANT_GRIP)))
    fold = R.soft_grip(R.tip_to(fold, 0.02), along=PLANT_GRIP)
    setp = R.tip_to(_plant_two(1.25))
    breath = anim.add(setp, _P(chest=(-2.5, 0, 0), head=(-3, 0, 0)))
    out_ = anim._with_hips(anim.add(setp, _P(chest=(3, 0, 0), spine=(2, 0, 0), head=(6, 0, 0))), (0, 0, -0.012))
    over = anim._with_hips(setp, (0, 0, -0.022))
    I = anim.IMPACT
    return clip("cast_a2", 30, [(0.0, G, "linear"), (0.14, lift, "inout"), (0.28, fold, "inout"),
                                (0.36, over, "out"), (I, setp, "settle"), (0.62, breath, "sine"),
                                (0.80, setp, "sine"), (1.0, out_, "inout")], impact=I)


def _gen_rest_clips(R, G) -> dict:
    out = {}
    hip_h = R.skel.rest_point("hips").z

    # death: knocked back, down on the right knee over the planted cleaver, then forward over it onto the
    # ground (face down, the head turned, the cleaver flat in the right fist); the body never dips under the
    # ground and the legs stay FK from the fall on (no IK hand-over pop)
    hit = _pose(G, _P(hips=(-8, 8, 0), spine=(-10, 2, 0), chest=(-14, 4, 0), neck=(-8, 0, 0), head=(-16, 6, 0)),
                (0, 0.10, 0.0), step(G, dr=(0.0, 0.12, 0.0), pr=-10))
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
                                                             (0.32, kneel, "inout"), (0.48, slump, "inout"),
                                                             (0.60, topple, "in"), (0.72, down, "in"), (0.79, bounce, "out"),
                                                             (0.88, rest, "inout"), (1.0, rest, "linear")]))

    # recall (3 s loop): the cleaver planted at his right, the fist on the grip; the left hand takes a tally
    # stub from the belt, brings it up to the chest, strikes it alight with the thumb (two flicks), holds it up
    # watching it burn, breathing, and lowers it again
    rec = anim.merge(stance_b(0.6), anim.arms_relaxed(),
                     {"ik": one(REC_REL, (-0.10, -0.42, -0.90), (0.30, -0.90, -0.42), pole=(-0.9, 0.3, -0.3),
                                left=(0.12, -0.20, -0.90), lpole=(0.9, 0.3, -0.4))}, _P(prop_L=FIST_CURL))
    rec = anim.add(rec, _P(neck=(6, 0, 0), head=(10, -6, 0), chest=(2, -4, 0)))
    take = anim.merge(rec, {"ik": {"hand.L": HT(rel=(0.02, -0.30, -0.85), pole=(0.9, 0.2, -0.3))}})
    take = anim.add(take, _P(head=(8, 4, 0), spine=(3, 0, 0)))
    up_ = anim.merge(rec, {"ik": {"hand.L": HT(rel=(-0.05, -0.80, -0.10), pole=(0.9, 0.2, -0.5))}})
    up_ = anim.add(up_, _P(head=(14, 8, 0), neck=(4, 0, 0), chest=(-2, 0, 0)))
    flick = anim.merge(up_, {"ik": {"hand.L": HT(rel=(0.00, -0.82, -0.04), pole=(0.9, 0.2, -0.5))}})
    flick = anim.add(flick, _P(hand_L=(-18, 0, 0)))
    lit = anim.merge(up_, {"ik": {"hand.L": HT(rel=(0.02, -0.86, 0.06), pole=(0.9, 0.2, -0.5))}})
    lit = anim.add(lit, _P(head=(-6, 0, 0), chest=(-3, 0, 0)))
    rec, take, up_, flick, lit = (R.tip_to(x) for x in (rec, take, up_, flick, lit))
    rkeys = [(0.0, rec, "linear"), (0.16, take, "inout"), (0.36, up_, "inout"), (0.44, flick, "out"), (0.50, up_, "in"),
             (0.56, flick, "out"), (0.62, up_, "in"), (0.72, lit, "inout"), (0.86, lit, "linear"), (1.0, rec, "inout")]
    rb = anim.keyed(rkeys)

    def recall(t):
        b = anim.osc(t, 3)
        return anim._with_hips(anim.add(rb(t), _P(chest=(2.0 * b, 0, 0), shoulder_L=(0, 0, 1.5 * b),
                                                  shoulder_R=(0, 0, -1.5 * b), head=(-1.2 * b, 0, 0))),
                               (0.008 * anim.osc(t, 1), 0.0, -0.004 * b))
    out["recall"] = anim.Clip("recall", 90, True, anim.drag(recall, 90, {"head": 2.0, "neck": 1.0, "hand.L": 1.0}, loop=True))

    # idle_lobby (120 f loop): he takes the cleaver off the shoulder and holds it upright in front of him,
    # runs his left thumb along the notches in its back as if counting, tilts his head 5 degrees and nods at
    # something only he remembers; then he sets it down, tip planted at his right foot, rests his weight a
    # while, and shoulders it again by way of his right side. (The brief's swap to the LEFT shoulder is not
    # reachable: his right fist cannot reach past his face, so the blade would cross the mask.) The cleaver
    # travels upright in front of him or out on his right, never through the head.
    lob = anim.merge(stance_b(0.6), anim.arms_relaxed(), {"ik": carry_ik()}, _P(prop_L=FIST_CURL))
    lower = _pose(lob, _P(chest=(0, 4, 0), head=(2, -4, 0)), (0, 0, 0),
                  one((-0.30, -0.62, 0.10), (0.06, -0.22, 0.97), (0.0, -0.97, 0.22), pole=(-0.9, 0.2, -0.4), left=BELT_L))
    present = _pose(lob, _P(chest=(2, 8, 0), spine=(0, 4, 0), head=(10, -6, 0), neck=(4, 0, 0)), (0, 0, -0.01),
                    one((0.10, -0.86, -0.36), (0.16, -0.38, 0.91), (0.0, -0.91, 0.38), pole=(-0.9, 0.2, -0.4), left=BELT_L))
    count0 = dict(present)
    count0["ik"] = dict(present["ik"], **{"hand.L": HT(rel=R.left_rel(present, 0.20), pole=(0.8, -0.4, -0.5))})
    count1 = dict(present)
    count1["ik"] = dict(present["ik"], **{"hand.L": HT(rel=R.left_rel(present, 0.44), pole=(0.8, -0.4, -0.5))})
    count1 = anim.add(count1, _P(head=(4, -2, 0)))
    nod = anim.add(count1, _P(head=(12, -6, -5)))
    rest = anim.merge(stance_b(0.7), anim.arms_relaxed(),
                      {"ik": one(VIC_REL, (-0.10, -0.42, -0.90), (0.30, -0.90, -0.42), pole=(-0.9, 0.3, -0.3),
                                 left=(0.16, -0.10, -0.92), lpole=(0.9, 0.3, -0.3))}, _P(prop_L=FIST_CURL))
    rest = R.tip_to(anim.add(rest, _P(hips=(0, 0, -3), chest=(-2, -4, 0), head=(-2, 6, 2))))
    rest2 = R.tip_to(anim._with_hips(anim.add(rest, _P(chest=(1.5, 0, 0), head=(3, 0, 0))), (0.01, 0, -0.008)))
    keys = [(0.0, lob, "linear"), (0.07, lower, "inout"), (0.14, count0, "inout"), (0.24, count1, "inout"),
            (0.31, nod, "inout"), (0.37, count1, "inout"), (0.44, present, "inout"), (0.50, out_right(lob), "inout"),
            (0.58, rest, "inout"), (0.70, rest2, "sine"), (0.80, rest, "sine"), (0.88, out_right(lob), "inout"),
            (1.0, lob, "inout")]
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
    host["ik"] = dict(host["ik"], **{"aim.L": palm_aim((0.40, -0.40, 0.82), (0.45, -0.89, 0.0))})   # palm up, open to his left
    plant, take, score, scratch, nod, host = (R.tip_to(x) for x in (plant, take, score, scratch, nod, host))
    keys = [(0.0, G, "linear"), (0.09, out_right(G), "inout"), (0.20, plant, "inout"), (0.32, take, "inout"),
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
    chan = _plant_two(1.1)
    chan = R.tip_to(anim.add(chan, _P(neck=(6, 0, 0), head=(10, 0, 0))))

    def channel(t):
        b, s = anim.osc(t, 2), anim.osc(t, 1, 0.2)
        p = anim.add(chan, _P(chest=(3.0 * b, 0, 0), spine=(1.0 * b, 0, 1.5 * s), shoulder_L=(0, 0, 2.5 * b),
                              shoulder_R=(0, 0, -2.5 * b), head=(-2.5 * b, 2.0 * s, 0)))
        return anim._with_hips(p, (0.015 * s, 0.0, -0.008 * b))
    out["channel"] = anim.Clip("channel", 40, True, anim.drag(channel, 40, {"head": 2.0, "neck": 1.0}, loop=True))
    return out


DEATH_KNEEL = 0.385         # the kneel's hip drop (share of the hip height)
DEATH_LIE = 0.33            # the hips' height lying face down (m)
DEATH_PLANT_REL = (-0.05, -0.85, -0.25)
REC_REL = (-0.22, -0.40, -0.17)
VIC_REL = (-0.22, -0.42, -0.16)
VIC_HOST = (0.30, -0.86, -0.30)        # the left hand held out in front, a little to his left, at the belt line
LOBBY_REL = (0.70, -0.66, 0.22)        # the left-shoulder carry: the fist high in front of the left chest,
LOBBY_D = (0.30, 0.55, 0.78)           # the blade laid back over the stacked pauldron
LOBBY_UP = (-0.20, -0.78, 0.59)


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
GRADED = ("cowl", "trousers", "boots", "tier1", "tier2", "tier3", "tier4", "shoulder_plate", "vambrace", "strap_plate")


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
    hon = np.array([0.66, 0.68, 0.64], dtype=np.float32)                   # L* ~85 at most after the mix
    c = c * (1 - 0.55 * band[:, None]) + hon * 0.55 * band[:, None]
    c = c * (1 - 0.25 * bevel[:, None])                                   # the bevel line, a quarter darker
    c = c + (hon - c) * 0.35 * shine[:, None]
    ink = np.array([0.035, 0.032, 0.03], dtype=np.float32)
    c = c * (1 - 0.8 * rim[:, None]) + ink * 0.8 * rim[:, None]
    # chips: short dark nicks into the edge at the outline's dents and a few scattered along it
    nick = np.zeros_like(u)
    for uc, w in ((0.61, 0.012), (0.74, 0.012), (0.93, 0.006), (1.08, 0.008), (1.19, 0.006)):
        nick = np.maximum(nick, np.clip(1.0 - np.hypot((u - uc) / w, de / 0.016), 0, 1))
    c = c * (1 - 0.6 * nick[:, None]) + ink * 0.6 * nick[:, None]
    # two long scratches (the concept's crack lines), thin and dark
    for (u0, v0, u1, v1) in ((0.62, 0.02, 0.95, 0.05), (1.02, 0.07, 1.20, 0.04)):
        du, dv = u1 - u0, v1 - v0
        L = math.hypot(du, dv)
        t = np.clip(((u - u0) * du + (v - v0) * dv) / (L * L), 0, 1)
        dd = np.hypot(u - (u0 + t * du), v - (v0 + t * dv))
        ln = np.clip(1.0 - dd / 0.0022, 0, 1) * np.sin(np.pi * t) ** 0.5
        c = c * (1 - 0.5 * ln[:, None]) + ink * 0.5 * ln[:, None]
    del Y
    out = lin.copy()
    out[bl] = c
    return out


RUST_PARTS = ("tier1", "tier2", "tier3", "tier4", "shoulder_plate", "vambrace", "strap_plate")

# ── post-paint, fix pass 2: the reads the projection alone gets wrong ────────────────────────────────
# Targets are painted MEANS (sRGB hex) per part; each part keeps its own painted value detail (a value tint,
# see _tint). Brief section 3/5/6: the lacquered mask is the brightest value and only a pale ochre (not
# gold), framed by the concept's dark felt cowl; the pauldrons are neutral grey stone stained only in the
# recesses; the legs darken toward the feet.
MASK_FACE = "#D3BC88"         # the lit face's mean: pale ochre lacquer, L* ~77, ~35 % saturation
COWL_MEAN = "#4F4943"         # the concept's dark felt (L* ~31): the mask pops out of it in any light
RUST_MEAN = "#8E8A84"         # neutral grey oxidised stone (L* ~57; lit from above it reads near 70)
RUST_PART_MEAN = {"shoulder_plate": "#77736D"}    # the right shoulder's carved plate faces the key: a step down
TROUSER_MEAN = "#4C3A2E"      # dark brown trousers (feet band)
BOOT_MEAN = "#4A3424"         # dark waxed-leather boots (warm brown: cooler browns read mauve outdoors)
INK_TALLY = "#3A2915"         # the cut tallies' ink
FELT_SHADOW = "#3A362F"       # under the chin, where the mask meets the felt roll
HEEL_STONE = "#504C48"        # the ironstone spine band
HEEL_CHALK = "#8E8983"        # chalked convex edges
# tally groups on the mask: (x centre, z centre) on the face (front) and on the cranium (back); crown groups
# (x, y centre) on top, seen from the game camera
TALLY_FRONT = [(-0.072, 2.104), (-0.012, 2.108), (0.048, 2.104),
               (-0.098, 2.068), (-0.040, 2.071), (0.018, 2.071), (0.074, 2.068),
               (-0.097, 1.952), (0.082, 1.952)]
TALLY_BACK = [(-0.060, 2.078), (0.012, 2.082), (0.080, 2.074),
              (-0.075, 2.012), (0.0, 2.016), (0.072, 2.012)]
TALLY_CROWN = [(-0.020, -0.035)]


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
    # 2. the keel streak: front texels below the nose tip take the mean of their z-slice beside the keel
    face = m & (ny < -0.35)
    xs = x + 0.012
    band = face & (z > 1.80) & (z < 1.905) & (np.abs(xs) < 0.034)
    src = face & (z > 1.80) & (z < 1.905) & (np.abs(xs) > 0.036) & (np.abs(xs) < 0.062)
    if band.any() and src.any():
        zb = np.clip(((z - 1.80) / 0.004).astype(np.int64), 0, 30)
        acc = np.zeros((31, 3))
        cnt = np.zeros(31)
        np.add.at(acc, zb[src], out[src])
        np.add.at(cnt, zb[src], 1.0)
        ok = cnt > 0
        idx = np.arange(31)
        for ch in range(3):
            acc[:, ch] = np.interp(idx, idx[ok], acc[ok, ch] / cnt[ok])
        w = np.clip((0.034 - np.abs(xs[band])) / 0.012, 0.0, 1.0)[:, None]
        out[band] = out[band] * (1 - w) + acc[zb[band]] * w
    # 3. the lacquer grade: the lit face's mean onto MASK_FACE; the cranium follows the same change
    fm = face & (z > 1.90)
    mean_face = out[fm].mean(axis=0) if fm.any() else out[m].mean(axis=0)
    out[m] = _tint(out[m], MASK_FACE, contrast=0.85, keep=0.25, mean=mean_face)
    # 4. crisp tallies, cut in ink: the face, the back of the cranium, the crown
    cov = np.zeros(m.sum())
    xm, ym, zm, nym, nzm = x[m], y[m], z[m], ny[m], N[..., 2][m]
    fr = nym < -0.3
    bk = nym > 0.3
    cr = nzm > 0.55
    cov[fr] = tally_ink(xm[fr], zm[fr], TALLY_FRONT, seed=1)
    cov[bk] = np.maximum(cov[bk], tally_ink(-xm[bk], zm[bk], TALLY_BACK, seed=2))
    cov[cr] = np.maximum(cov[cr], tally_ink(xm[cr], -ym[cr], TALLY_CROWN, seed=3))
    ink = _hexlin(INK_TALLY)
    c = out[m]
    c = c * (1 - 0.85 * cov[:, None]) + ink * 0.85 * cov[:, None]
    # 5. the ink eye recesses
    eye = np.zeros(m.sum(), dtype=bool)
    for xc in (-0.068, 0.058):
        e = ((xm - xc) / 0.041) ** 2 + ((zm - 2.002) / 0.018) ** 2
        eye |= (e < 1.0) & (nym < 0.2) & (ym < -0.12)
    c[eye] = c[eye] * 0.15 + _hexlin("#17181B") * 0.85
    # 6. below the chin: the felt roll's shadow (the neck plug and the chin's underside)
    w = np.clip((1.853 - zm) / 0.012, 0.0, 1.0)[:, None]
    c = c * (1 - w) + _hexlin(FELT_SHADOW) * w
    out[m] = c
    log(f"burdam: mask paint: {int(lift.sum())} stroke texels lifted, face mean "
        f"{np.round(project._srgb(mean_face) * 255).astype(int).tolist()} -> {MASK_FACE}, "
        f"tally texels {int((cov > 0.5).sum())}")
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
    for (gu, gv, a, b) in cl.GEMS:
        k = np.abs(u - gu) / (a + 0.012) + np.abs(v - gv) / (b + 0.012)
        ring = np.clip(1.0 - np.abs(k - 0.9) / 0.1, 0.0, 1.0)
        c = c * (1 - 0.45 * ring[:, None]) + _hexlin("#7C7771")[None] * 0.45 * ring[:, None]
        seat = k < 0.78
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


def grade_parts(lin: np.ndarray, maps: dict, names: list, log=print) -> np.ndarray:
    """the cowl, the stone plates, the trousers and the boots onto their target means (see the targets)"""
    N, part = maps["N"], maps["part"]
    out = lin.copy()
    rep = []
    for i, nm in enumerate(names):
        m = part == i
        if not m.any():
            continue
        if nm == "cowl":
            out[m] = _tint(out[m], COWL_MEAN, contrast=0.9, keep=0.2)
        elif nm in RUST_PARTS:
            c = out[m]
            Y = _lum(c)[:, None]
            c = Y + (c - Y) * 0.2                                 # neutral grey: the brown blotches lose their hue
            mean = c.mean(axis=0)
            tgt = RUST_PART_MEAN.get(nm, RUST_MEAN)
            c = _tint(c, tgt, contrast=0.6, keep=0.1, mean=mean)
            # the slabs' thickness faces (grazing to both plates: the projection smears streaks there):
            # plain stone a step darker, a trace of the painted value
            n = N[m]
            side = (np.abs(n[:, 1]) < 0.3) & (n[:, 2] < 0.55)
            if side.any():
                Ys = _lum(c[side])
                ls = 1.0 + (Ys / max(float(Ys.mean()), 1e-5) - 1.0) * 0.3
                c[side] = _hexlin(tgt)[None] * 0.78 * ls[:, None]
            out[m] = c
        elif nm == "trousers":
            out[m] = _tint(out[m], TROUSER_MEAN, contrast=0.5, keep=0.25)
        elif nm == "boots":
            c = _tint(out[m], BOOT_MEAN, contrast=0.65, keep=0.1)
            Yb = _lum(c)
            cap = 1.35 * float(_lum(_hexlin(BOOT_MEAN)[None])[0])
            c = c * np.minimum(1.0, cap / np.maximum(Yb, 1e-6))[:, None]     # no pale background smear
            sole = maps["P"][..., 2][m] < 0.027                                 # the flat sole: dark
            c[sole] = _hexlin("#2C231D")[None] * (0.85 + 0.3 * (Yb[sole] / max(float(Yb.mean()), 1e-6)))[:, None] * 0.6 \
                + c[sole] * 0.4
            out[m] = c
        else:
            continue
        rep.append(nm)
    log("burdam: graded " + ", ".join(rep))
    return out



def almanac_print(img: np.ndarray, maps: dict, names: list, ink_hex: str) -> np.ndarray:
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
        z = P[..., 2][rust]
        t = (z / 0.032) % 1.0
        d = np.minimum(t, 1.0 - t) * 0.032
        a = (np.clip(1.0 - d / 0.0032, 0.0, 1.0) * 0.72)[:, None]
        out[rust] = out[rust] * (1 - a) + ink * a
    if "almanac_face" in names:
        # the board's parchment: a ledger page (ruled every 2 cm, a margin rule, faint foxing), not a flat card
        fc = part == names.index("almanac_face")
        if fc.any():
            p = P[fc]
            t = (p[:, 2] / 0.020) % 1.0
            d = np.minimum(t, 1.0 - t) * 0.020
            line = np.clip(1.0 - d / 0.0022, 0.0, 1.0) * (p[:, 2] < 1.06) * (p[:, 2] > 0.87)
            ax = np.array([np.cos(np.radians(-38.0)), np.sin(np.radians(-38.0))])       # the board's width axis
            along = (p[:, 0] + 0.278) * ax[0] + (p[:, 1] + 0.208) * ax[1]
            margin = np.clip(1.0 - np.abs(along + 0.050) / 0.0025, 0.0, 1.0)
            fox = 0.93 + 0.07 * np.sin(p[:, 0] * 90.0 + p[:, 2] * 70.0) * np.sin(p[:, 2] * 45.0 - p[:, 1] * 60.0)
            out[fc] = out[fc] * fox[:, None]
            a = (np.maximum(line * 0.65, margin * 0.75))[:, None]
            out[fc] = out[fc] * (1 - a) + ink * a
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
        if (skin.get("extra") or {}).get("almanac_board"):
            log("burdam: Almanac Ledger print (ruled pauldrons, day-marks on the cleaver's back)")
            out = almanac_print(out, maps, list(names), skin_pal.get("ironstone", "#2E2A26"))
        return out

    recolour._burdam = True
    project.recolour = recolour


ARM_BONES = tuple(f"{b}.{s}" for s in "LR" for b in ("shoulder", "upper_arm", "forearm", "hand", "prop"))


MATCH_HUE = 0.25          # skin identity roles: share of the painting's own hue variation kept (see recolour)
BASE_WEBP_Q = 66          # base-colour WebP quality (optimize.mjs default 80): the lifted painting carries more
                          # shadow detail; the GLB budget (1172 KiB) holds with the painting at q74


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
        args = [node, script, path, out, "--fighter", "--q-base", str(BASE_WEBP_Q)] + (["--quantize"] if quantize else [])
        r = subprocess.run(args, cwd=scene.GAME_DIR, capture_output=True, text=True, encoding="utf-8")
        if r.returncode != 0:
            scene.log(f"optimize failed ({r.returncode}): {r.stderr.strip()[:800]}")
            return {"ok": False, "before": before, "after": before, "error": r.stderr[-800:]}
        scene.log(r.stdout.strip() + f" (burdam: base webp q{BASE_WEBP_Q})")
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


if __name__ == "__main__":
    _install_body_bind()
    _install_paint_layers()
    _install_webp_quality()
    _install_skin_print()
    fighter.main(sys.modules[__name__])
