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
# Palettes: _design/fighters/burdam.md section 9.
SKINS: list = [
    {"id": "burdam_stillwater", "extra": {"reed_plates": True, "river_glass": True},
     "card": {"primary": "#3E4A4C", "secondary": "#8FB3A8"},
     "palette": {"sandstone": "#D4C9A9", "cloth2": "#C2C3B8", "rust": "#9AA7A9", "stone": "#C4C8C4",
                 "ironstone": "#4D5A5C", "leather": "#554A3E", "cloth": "#6E7B7B", "under": "#343B3D",
                 "reed": "#7D8460", "dawnglass": "#8FB3A8"}},
    {"id": "burdam_almanac", "extra": {"almanac_board": True},
     "card": {"primary": "#4A453E", "secondary": "#D8CDB4"},
     "palette": {"cloth2": "#C6B9A5", "rust": "#D8CDB4", "stone": "#CFC8B8", "ironstone": "#2E2A26",
                 "cloth": "#8A7F72", "parchment": "#D8CDB4", "walnut": "#5A4639"}},
]
SKIN_FLAT = {"reed_plates_R": "reed", "reed_plates_L": "reed", "river_glass_tier1": "dawnglass",
             "river_glass_tier2": "dawnglass", "river_glass_tier3": "dawnglass", "almanac_wood": "walnut",
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


def tier_pts(top, thick):
    """a stone plate: its top points and the same points `thick` lower (vertical edge bands)"""
    top = np.asarray(top, dtype=np.float64)
    return np.concatenate([top, top - np.array([0.0, 0.0, thick])])


class _NotchLiner(sdf.Prim):
    """an accent crescent lining the bottom of one spine notch: the notch circle's rim band inside the heel"""

    def __init__(self, su):
        self.su, self.sv = su, cl.HEEL_SPINE_V + 0.012
        self.r0, self.r1 = cl.SCALLOP_R - 0.002, cl.SCALLOP_R + cl.NOTCH_LINER

    def bounds(self):
        lo = np.array([-0.032, self.sv - self.r1, self.su - self.r1 - cl.U_GRIP])
        hi = np.array([0.032, self.sv, self.su + self.r1 - cl.U_GRIP])
        return lo, hi

    def d(self, P):
        w, v, u = P[:, 0], P[:, 1], P[:, 2] + cl.U_GRIP
        rr = np.hypot(u - self.su, v - self.sv)
        band = np.maximum(self.r0 - rr, rr - self.r1)
        inside = cl.sd_polygon(u, v, cl.HEEL)
        return np.maximum(np.maximum(band, inside - 0.004), np.abs(w) - 0.0325)


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
    mask = Sculpt("mask")
    mask.add(Ellipsoid((-0.012, -0.005, 1.985), (0.142, 0.158, 0.172)), k=0.0)
    mask.add(RoundBox((-0.012, -0.03, 1.965), (0.118, 0.13, 0.15), 0.075), k=0.03)
    mask.inter(HalfSpace((0, -0.168, 0), (0, -1, 0), 1.0), k=0.035)                 # the flat lacquered face
    mask.add(RoundBox((-0.012, -0.160, 2.035), (0.112, 0.022, 0.013), 0.011), k=0.02)   # brow shelf
    mask.add(RoundCone((-0.012, -0.164, 1.99), (-0.012, -0.198, 1.905), 0.026, 0.013), k=0.022)   # beak keel
    mask.add(RoundBox((-0.012, -0.150, 1.840), (0.085, 0.03, 0.03), 0.025), k=0.03)     # the jaw block
    for sx, xc in ((-1, -0.068), (1, 0.058)):
        mask.sub(Ellipsoid((xc, -0.178, 2.002), (0.040, 0.032, 0.0165), axes=rot(ry=sx * 9)), k=0.006)
        mask.sub(RoundBox((xc - sx * 0.012, -0.166, 1.92), (0.004, 0.012, 0.03), 0.003, axes=rot(ry=sx * 14)),
                 k=0.002)                                                             # carved cheek line
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
    part("cowl", _displaced(cowl, folds(0.012, 22.0, axis=2, phase=0.7)), "cloth2",
         ("zblend", "chest", "neck", 1.74, 1.90), 1600)

    # COAT (heat weights): a barrel chest over a narrow waist, heavy short sleeves
    coat = Sculpt("coat")
    coat.add(Ellipsoid((0.0, 0.0, 1.45), (0.31, 0.275, 0.24)), k=0.0)
    coat.add(Ellipsoid((0.0, 0.03, 1.58), (0.29, 0.24, 0.12)), k=0.08)
    coat.add(Ellipsoid((0.0, -0.005, 1.24), (0.262, 0.25, 0.13)), k=0.10)
    for sx in (-1, 1):
        coat.add(Sphere((sx * 0.40, 0.02, 1.53), 0.11), k=0.07)
        coat.add(FlatCapsule((sx * 0.43, 0.02, 1.50), (sx * 0.475, -0.01, 1.30), 0.13, 0.13, 0.12, 0.12,
                             side=(1, 0, 0)), k=0.05)
    part("coat", _displaced(coat, folds(0.008, 26.0, axis=2, phase=0.4)), "cloth", "auto", 2400)
    skirt = Sculpt("skirt")
    sk = FlatCapsule((0.0, 0.0, 0.62), (0.0, -0.005, 1.20), 0.43, 0.31, 0.30, 0.255, side=(1, 0, 0))
    skirt.add(sk.displaced(folds(0.016, 14.0, axis=0, phase=1.3, zfade=(1.05, 0.66)), 0.016), k=0.0)
    skirt.inter(HalfSpace((0, 0, 0.665), (0, 0, -1), 2.0), k=0.01)
    skirt.sub(RoundBox((-0.25, -0.30, 0.74), (0.006, 0.06, 0.10), 0.003), k=0.004)        # the front slit
    part("skirt", skirt, "cloth", "body", 1450)

    # BELTS (heat weights)
    belt = Sculpt("belt")
    belt.add(Torus((0.0, -0.005, 1.235), 0.272, 0.028, axes=np.diag([1.0, 0.272 / 0.262, 1.0]), rz=0.063), k=0.0)
    belt.add(RoundBox((-0.10, -0.283, 1.235), (0.045, 0.014, 0.05), 0.008, axes=rot(rz=-18)), k=0.004)   # buckle
    belt.add(Torus((-0.015, -0.005, 1.095), 0.300, 0.024, axes=np.diag([1.0, 0.300 / 0.29, 1.0]) @ rot(ry=-8),
                   rz=0.042), k=0.0)                                                    # the slung hip belt
    part("belt", belt, "leather", "body", 950)

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
    part("forearms", fore, "leather", "auto", 900)
    for s, sx in (("R", -1), ("L", 1)):
        fist = Sculpt(f"fist_{s}")
        c = np.array([sx * 0.505, -0.075, 0.958])
        fist.add(RoundBox(c, (0.098, 0.090, 0.088), 0.055), k=0.0)
        for i in range(4):                                             # knuckle rolls, facing front-down
            fist.add(Capsule(c + (sx * -0.065 + sx * 0.0, -0.075, 0.055 - i * 0.038),
                             c + (sx * 0.055, -0.075, 0.055 - i * 0.038), 0.026), k=0.02)
        fist.add(Capsule(c + (sx * -0.085, -0.05, 0.065), c + (sx * -0.06, -0.085, -0.015), 0.032), k=0.02)   # thumb
        part(f"fist_{s}", fist, "leather", f"bone:hand.{s}", 650)

    # FOREARM PLATES: the big carved vambrace on the left, an iron strip on the right (rigid on the forearms)
    vb = Sculpt("vambrace")
    outer = FlatCapsule((0.468, -0.012, 1.40), (0.522, -0.06, 0.99), 0.172, 0.16, 0.13, 0.135, side=(1, 0, 0))
    inner = FlatCapsule((0.468, -0.012, 1.46), (0.522, -0.06, 0.94), 0.142, 0.133, 0.097, 0.102, side=(1, 0, 0))
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
    t1.add(Hull(tier_pts(t1_top, 0.05), k=0.012).displaced(chips(0.009, 6.5), 0.009), k=0.0)
    t1.add(Hull(tier_pts([(0.23, -0.06, 1.975), (0.36, -0.03, 1.995), (0.37, 0.12, 1.985), (0.24, 0.10, 1.965),
                          (0.20, 0.02, 1.90)], 0.12), k=0.01).displaced(chips(0.008, 7.0), 0.008), k=0.01)  # inner collar
    ap = np.array(t1_top[0])
    panel = [ap + 0.62 * (np.array(q) - ap) + (0, 0, 0.004) for q in t1_top[1:]]
    t1.add(Hull(tier_pts([tuple(ap + (0, 0, 0.012))] + [tuple(q + (0, 0, 0.012)) for q in panel], 0.03), k=0.008),
           k=0.006)                                                     # the raised inner panel
    part("tier1", t1, "rust", "bone:shoulder.L", 700)
    t2 = Sculpt("tier2")
    t2_top = [(0.20, 0.0, 1.745), (0.40, 0.0, 1.80), (0.60, 0.0, 1.79), (0.79, 0.0, 1.672), (0.60, -0.24, 1.605),
              (0.60, 0.24, 1.605), (0.36, -0.22, 1.66), (0.36, 0.22, 1.66)]
    t2.add(Hull(tier_pts(t2_top, 0.06), k=0.01).displaced(chips(0.009, 6.5), 0.009), k=0.0)
    part("tier2", t2, "rust", ("dblend", "shoulder.L", "upper_arm.L", (0.30, 0.0, 1.70), (1.0, 0.0, -0.35), 0.10, 0.36),
         600)
    t3 = Sculpt("tier3")
    t3_top = [(0.24, 0.0, 1.62), (0.45, 0.0, 1.645), (0.645, 0.0, 1.565), (0.47, -0.26, 1.48), (0.47, 0.26, 1.48)]
    t3.add(Hull(tier_pts(t3_top, 0.055), k=0.01).displaced(chips(0.008, 7.0), 0.008), k=0.0)
    part("tier3", t3, "rust", "bone:upper_arm.L", 450)
    t4 = Sculpt("tier4")
    t4_top = [(0.32, 0.0, 1.51), (0.48, 0.0, 1.525), (0.625, 0.0, 1.462), (0.48, -0.25, 1.40), (0.48, 0.25, 1.40)]
    t4.add(Hull(tier_pts(t4_top, 0.05), k=0.01).displaced(chips(0.007, 7.0), 0.007), k=0.0)
    part("tier4", t4, "rust", "bone:upper_arm.L", 350)

    # LEGS: baggy dark trousers (heat weights), wrapped shins and boots
    legs = Sculpt("trousers")
    for sx in (-1, 1):
        legs.add(FlatCapsule((sx * 0.16, 0.0, 0.84), (sx * 0.22, -0.005, 0.44), 0.165, 0.155, 0.112, 0.11,
                             side=(1, 0, 0)), k=0.0)
        legs.add(Ellipsoid((sx * 0.207, -0.01, 0.55), (0.165, 0.150, 0.11)), k=0.06)
        legs.add(Torus((sx * 0.222, -0.005, 0.425), 0.092, 0.03, rz=0.026), k=0.03)              # the cuff roll
    part("trousers", _displaced(legs, folds(0.012, 18.0, axis=2, phase=2.1)), "under", "body", 1050)
    boots = Sculpt("boots")
    for sx in (-1, 1):
        shin = FlatCapsule((sx * 0.225, -0.005, 0.43), (sx * 0.24, 0.02, 0.13), 0.098, 0.10, 0.088, 0.095,
                           side=(1, 0, 0))
        boots.add(shin.displaced(wraps(0.006, 55.0), 0.007), k=0.0)
        foot = RoundBox((sx * 0.255, -0.075, 0.068), (0.092, 0.175, 0.068), 0.055, axes=rot(rz=sx * 12.0))
        boots.add(foot, k=0.06)
        boots.add(Ellipsoid((sx * 0.24, 0.03, 0.12), (0.095, 0.10, 0.08)), k=0.04)        # heel / ankle
    boots.inter(HalfSpace((0, 0, 0.0), (0, 0, -1), 2.0), k=0.0)
    part("boots", boots, "leather", "body", 1150)

    # THE CLEAVER (prop space; see proto/burdam_cleaver.py)
    blade = Sculpt("blade")
    blade.add(Plate(cl.blade_poly(), blade_ht, r=0.0025, tmax=0.022), k=0.0)
    part("blade", blade, "stone", "bone:prop.R", 1000, 0.6, "prop")
    heel = Sculpt("heel")
    heel.add(Plate(cl.HEEL, 0.030, r=0.008), k=0.0)
    for su in cl.SCALLOPS:
        c = _uvw(su, cl.HEEL_SPINE_V + 0.012)
        heel.sub(Capsule(c + (-0.06, 0, 0), c + (0.06, 0, 0), cl.SCALLOP_R), k=0.006)
    for (gu, gv, a, b) in cl.GEMS:                                     # the notch recesses the gems sit in
        for side in (-1, 1):
            heel.sub(Plate(_diamond(gu, gv, a + 0.008, b + 0.008), 0.009, r=0.002, dw=side * 0.031), k=0.003)
    heel.add(Torus(_uvw(-0.012, 0.0), 0.038, 0.013, axes=np.eye(3)), k=0.006)          # the haft collar
    part("heel", heel, "ironstone", "bone:prop.R", 720, 0.6, "prop")
    gems = Sculpt("gems")
    for (gu, gv, a, b) in cl.GEMS:
        gems.add(Plate(_diamond(gu, gv, a, b), 0.0325, r=0.003), k=0.0)
    gems.add(Plate(_diamond(cl.POMMEL_U, 0.0, *cl.POMMEL_GEM), 0.0365, r=0.003), k=0.0)
    for su in cl.SCALLOPS:                                             # liners in the notch bottoms
        gems.add(_NotchLiner(su), k=0.0)
    part("gems", gems, "accent", "bone:prop.R", 240, 0.6, "prop")
    haft = Sculpt("haft")
    hf = Capsule(_uvw(cl.HAFT_U0, 0.0), _uvw(0.01, 0.0), 0.037)
    haft.add(hf.displaced(lambda P: 0.004 * np.sin((P[:, 2] + 0.5 * P[:, 0]) * 95.0), 0.004), k=0.0)
    part("haft", haft, "leather", "bone:prop.R", 400, 0.7, "prop")
    pom = Sculpt("pommel")
    pom.add(Plate(_diamond(cl.POMMEL_U, 0.0, 0.088, 0.078), 0.036, r=0.012), k=0.0)
    pom.add(Capsule(_uvw(cl.HAFT_U0 - 0.02, 0.0), _uvw(cl.HAFT_U0 + 0.025, 0.0), 0.042), k=0.01)
    for side in (-1, 1):
        pom.sub(Plate(_diamond(cl.POMMEL_U, 0.0, cl.POMMEL_GEM[0] + 0.009, cl.POMMEL_GEM[1] + 0.009), 0.009,
                      r=0.002, dw=side * 0.035), k=0.003)
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
        # three flat reed plates per shoulder (2 cm thick, no sway): on the right they lie over the fringe
        # and fan down the upper arm's back; on the left they rise from behind the top tier, fanned outward
        for side, sx, bone in (("R", -1, "upper_arm.R"), ("L", 1, "shoulder.L")):
            reeds = Sculpt(f"reed_plates_{side}")
            for k, fan in enumerate((-22.0, 0.0, 22.0)):
                if side == "R":
                    c = np.array([-0.47, 0.10 + 0.012 * k, 1.60])
                    ax = rot(rx=fan - 30.0, ry=-38.0, rz=10.0)
                    half = (0.012, 0.042, 0.15)
                else:
                    c = np.array([0.40, 0.17, 1.86])
                    ax = rot(rx=-26.0, ry=34.0 + fan, rz=0.0)
                    half = (0.042, 0.010, 0.17)
                plate = RoundBox(c, half, 0.008, axes=ax)
                reeds.add(plate.displaced(lambda P: 0.0025 * np.sin(P[:, 0] * 160.0 + P[:, 1] * 160.0), 0.003), k=0.004)
            reeds.add(Torus((sx * 0.43 if side == "L" else -0.45, 0.13, 1.74 if side == "L" else 1.66), 0.04, 0.009,
                            axes=rot(rx=70.0)), k=0.004)                       # the lashing that binds the fan
            out.append((f"reed_plates_{side}", reeds, 0.6, "wood", f"bone:{bone}", 450, "world"))
    if extra.get("river_glass"):
        # lens inlays on the pauldron tiers' front slopes (front and back faces), glossy, never emissive
        # (surface points and normals measured on the tier hulls: proto snap, see the module doc)
        spots = {"tier1": [((0.31, -0.111, 1.765), (-0.51, -0.76, 0.39)), ((0.45, -0.12, 1.77), (0.40, -0.77, 0.49)),
                           ((0.38, 0.123, 1.781), (-0.34, 0.79, 0.51))],
                 "tier2": [((0.62, -0.111, 1.689), (0.38, -0.55, 0.75)), ((0.62, 0.11, 1.687), (0.36, 0.56, 0.75))],
                 "tier3": [((0.50, -0.126, 1.542), (0.37, -0.41, 0.83)), ((0.50, 0.128, 1.544), (0.31, 0.59, 0.74))]}
        bones = {"tier1": "shoulder.L", "tier2": "upper_arm.L", "tier3": "upper_arm.L"}
        for tier, pts in spots.items():
            g = Sculpt(f"river_glass_{tier}")
            for (p, n) in pts:
                n = np.asarray(n) / np.linalg.norm(n)
                g.add(Ellipsoid(np.asarray(p) + n * 0.003, (0.040, 0.028, 0.011), axes=sdf.frame(n, (1.0, 0.0, 0.0))),
                      k=0.0)
            out.append((f"river_glass_{tier}", g, 0.5, "dawnglass", f"bone:{bones[tier]}", 160, "world"))
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


# ── rig sockets ───────────────────────────────────────────────────────────────────────────────────
def _prop_world(info) -> np.ndarray:
    return np.array(rig.prop_matrix(info, "prop.R"))


def rig_extras(ctx) -> None:
    M = _prop_world(ctx.info)
    _STATE["prop"] = M

    def w(p):
        return tuple((M @ np.r_[p, 1.0])[:3])
    tip = w(_uvw(1.437, 0.012))
    notch = w(_uvw(0.22, 0.03))
    axis = M[:3, 2] * 0.08
    rig.add_socket(ctx.info, "x_blade_tip", "prop.R", tip, tuple(axis))
    rig.add_socket(ctx.info, "x_notch_mid", "prop.R", notch, tuple(axis))


_STATE: dict = {}


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
        P.append(fighter.Part(name, high=ob, tris=tris, bind=bind))
    return P


def extra_materials(ctx) -> dict:
    """the oxidised-iron `rust` role (pauldrons, vambrace, plates): matte honed stone, non-metallic"""
    return {"rust": materials.honed_stone("rust", ctx.palette, "rust", ctx.gradient, rough=0.74, chisel=0.8,
                                          speckle=0.5)}


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
CARRY = dict(rel=(-0.40, 0.10, 0.45), pole=(-0.9, 0.0, -0.4), d=(0.78, 0.42, 0.47), up=(-0.30, -0.35, 0.89))
BELT_L = (0.10, -0.16, -0.94)          # the free left fist at the belt
EDGE_DOWN = (1.0, 0.0, 0.0)            # flat normal for chops in the sagittal plane (the edge leads down)


def carry_ik(rel=None, pole=None, d=None, up=None, left=BELT_L, lpole=(0.9, 0.3, -0.3)) -> dict:
    """the shoulder carry: right fist over the right shoulder, the cleaver up and back behind the head to
    the upper left (the concept's diagonal; flat up-forward, the gems toward the sky); left fist at the belt"""
    c = CARRY
    ik = {"hand.R": HT(rel=rel or c["rel"], pole=pole or c["pole"]), "aim.R": AimRoll(d or c["d"], 1.0, up or c["up"])}
    if left is not None:
        ik["hand.L"] = HT(rel=left, pole=lpole)
    return ik


def feet_b(l=(0.03, -0.05, 0.0), r=(-0.03, 0.06, 0.0), yl=8.0, yr=-14.0, pl=0.0, pr=0.0) -> dict:
    return {"foot.L": FT(l, pl, yl), "foot.R": FT(r, pr, yr)}


def stance_b(crouch: float = 1.0, feet=None) -> dict:
    """Burdam's planted stance: square and heavy, the weight on the back (right) foot"""
    torso = _P(hips=(3, 4, 0), spine=(3, -2, 0), chest=(2, -3, 0), neck=(-3, 1, 0), head=(-3, 2, 0))
    return anim.merge(torso, {"hips_loc": (0.012, 0.015, -0.062 * crouch), "ik": feet or feet_b()})


def guard_pose(crouch: float = 1.0) -> dict:
    return anim.merge(stance_b(crouch), anim.arms_relaxed(), {"ik": carry_ik()})


def _pose(base: dict, torso: dict | None = None, hips=(0.0, 0.0, 0.0), ik: dict | None = None) -> dict:
    """base + torso delta (degrees) + hips offset (m) with IK targets merged over the base's"""
    p = anim.add(base, torso or {})
    p["ik"] = dict(base.get("ik", {}), **(ik or {}))
    return anim._with_hips(p, hips)


def two(rel, d, up, pole=(-0.8, 0.3, -0.4), grip=-0.17, lpole=(0.8, 0.4, -0.4)) -> dict:
    """both fists on the haft (the off hand 0.17 m below the main one)"""
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

    def left_rel(self, pose: dict, along: float = -0.17) -> tuple:
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

    def soft_grip(self, pose: dict, along: float = -0.17) -> dict:
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


def gen_idle_carry() -> anim.Clip:
    base = guard_pose()
    N = 72

    def sample(t):
        b = anim.osc(t, 2)
        s = anim.osc(t, 1, 0.1)
        d = _P(chest=(1.6 * b, 0, 0), spine=(0.6 * b, 0, 0.7 * s), neck=(-1.0 * b, 0, 0), head=(-0.6 * b, 1.8 * s, 0),
               shoulder_L=(0, 0, 2.2 * b), shoulder_R=(0, 0, -2.2 * b), hips=(0, 1.4 * s, -1.2 * s))
        p = anim.add(base, d)
        return anim._with_hips(p, (0.010 * s, 0.0, -0.005 * (0.5 + 0.5 * b)))

    return anim.Clip("idle", N, True, sample)


def gen_run_carry() -> anim.Clip:
    """the shared run cycle (3.45 m/s, heavy) with the cleaver kept on the shoulder: the right arm swings
    short around the carry, the left fist pumps"""
    c = CARRY
    r0 = c["rel"]
    d = (0.74, 0.49, 0.46)                      # a touch further back than the idle: the run twists the chest
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
        return p

    return anim.Clip("run", base.frames, True, sample, meta=base.meta)


def clip_overrides(ctx) -> dict:
    """Brief section 8 -> gestures (impact at 40 % of every attack / cast):
      attack1  overhand chop off the shoulder (30 f, f12); attack2 backhand horizontal cut (40 f, f16)
      cast_a1  Bear Down: off the shoulder in one overhand arc, a lunge with a 20 degree lean (25 f, f10)
      cast_a2  Stubborn: the tip planted in front, both hands on the pommel, the stance locks (30 f, f12)
      cast_a3  Old Wound: a wide waist-high sweep right to left, 90 degree draw, pause at f20 (30 f, f12)
      cast_ult Settled Account: the left arm reaches, the fist yanks back to the chest as the cleaver stamps
               down in front, the body rocks back (45 f, f18)"""
    R = Rig(ctx)
    G = guard_pose()
    out = {"idle": gen_idle_carry(), "run": gen_run_carry()}
    I = anim.IMPACT

    # Burdam's arms are short (0.54 m to the wrist) under shoulders 0.8 m apart: the hands meet only in front
    # of the chest, so the big swings are one-handed (the cleaver is light for him) and the free left fist
    # counter-swings; two hands only where they can meet (the plant, the channel).

    # attack1: overhand chop off the shoulder, a short step in
    wind = _pose(G, _P(hips=(-4, -6, 0), spine=(-6, -4, 0), chest=(-8, -8, 0), head=(-4, 6, 0)), (0, 0.04, 0.0),
                 one((-0.10, 0.12, 0.95), (0.05, 0.40, 0.92), EDGE_DOWN, pole=(-0.9, -0.1, 0.0),
                     left=(0.25, -0.60, -0.35), lpole=(0.9, 0.2, -0.3)))
    hit = _pose(G, _P(hips=(8, 8, 0), spine=(6, 6, 0), chest=(6, 8, 0), head=(-6, -6, 0)), (0, -0.08, -0.05),
                dict(one((0.12, -0.92, -0.12), (0.02, -0.88, -0.47), EDGE_DOWN, pole=(-0.9, 0.3, -0.3),
                         left=(0.15, 0.10, -0.85)), **step(G, dl=(0, -0.16, 0))))
    fol = _pose(G, _P(hips=(10, 10, 0), spine=(8, 7, 0), chest=(8, 10, 0), head=(-8, -7, 0)), (0, -0.10, -0.07),
                dict(one((0.15, -0.80, -0.42), (0.02, -0.78, -0.63), EDGE_DOWN, pole=(-0.9, 0.3, -0.3),
                         left=(0.18, 0.18, -0.82)), **step(G, dl=(0, -0.16, 0))))
    out["attack1"] = anim.Clip("attack1", 30, False, anim.drag(anim.keyed(anim.strike_keys(MOTION, wind, hit, fol, G)), 30,
                                                                {"head": 1.5, "neck": 1.0, "hand.L": 1.0}), impact=I)

    # attack2: backhand horizontal cut, left to right across the front
    flat_cw = (0.0, 0.0, -1.0)                 # flat normal for a left -> right sweep (the edge leads)
    wind = _pose(G, _P(hips=(2, 22, 0), spine=(2, 14, 0), chest=(4, 22, 0), head=(0, -18, 0)), (0, 0.03, -0.02),
                 one((0.45, -0.50, -0.20), (0.75, 0.60, -0.05), flat_cw, pole=(-0.4, -0.7, -0.4),
                     left=(0.30, 0.22, -0.80), lpole=(0.9, 0.3, -0.3)))
    hit = _pose(G, _P(hips=(4, -8, 0), spine=(4, -6, 0), chest=(5, -10, 0), head=(0, 8, 0)), (0, -0.05, -0.05),
                dict(one((-0.05, -0.92, -0.15), (-0.35, -0.93, -0.05), flat_cw, pole=(-0.8, 0.3, -0.4),
                         left=(0.25, -0.30, -0.75)), **step(G, dl=(0, -0.10, 0))))
    fol = _pose(G, _P(hips=(4, -24, 0), spine=(4, -14, 0), chest=(5, -24, 0), head=(0, 18, 0)), (0, -0.05, -0.06),
                dict(one((-0.65, -0.50, -0.10), (-0.92, 0.32, 0.05), flat_cw, pole=(-0.6, 0.6, -0.5),
                         left=(0.20, -0.55, -0.55)), **step(G, dl=(0, -0.10, 0))))
    out["attack2"] = anim.Clip("attack2", 40, False, anim.drag(anim.keyed(anim.strike_keys(MOTION, wind, hit, fol, G)), 40,
                                                                {"head": 2.0, "neck": 1.5, "hand.L": 1.5}), impact=I)

    # cast_a1 Bear Down: 4-frame anticipation, one overhand arc into a lunge (20 degree lean), the chop lands
    # at f10 with the blade 20 degrees past vertical (biting down), follow-through to f17, back on the shoulder
    up_ = _pose(G, _P(hips=(-3, -4, 0), spine=(-6, -2, 0), chest=(-8, -6, 0), head=(-6, 4, 0)), (0, 0.02, 0.02),
                one((-0.10, 0.10, 0.97), (0.05, 0.30, 0.95), EDGE_DOWN, pole=(-0.9, -0.1, 0.0),
                    left=(0.25, -0.55, -0.40), lpole=(0.9, 0.2, -0.3)))
    arc = _pose(G, _P(hips=(8, 2, 0), spine=(6, 2, 0), chest=(2, 4, 0), head=(-6, -2, 0)), (0, -0.14, 0.02),
                dict(one((0.05, -0.55, 0.80), (0.03, -0.62, 0.78), EDGE_DOWN, pole=(-0.9, 0.0, 0.0),
                         left=(0.22, -0.20, -0.70)), **step(G, dl=(0, -0.20, 0.06), pl=-10)))
    lunge = step(G, dl=(0.0, -0.36, 0.0), dr=(0.0, 0.06, 0.0), pr=-14)
    hit = _pose(G, _P(hips=(14, 4, 0), spine=(8, 4, 0), chest=(6, 6, 0), neck=(-6, 0, 0), head=(-10, -4, 0)),
                (0, -0.24, -0.12), dict(one((0.12, -0.94, 0.02), (0.02, -0.50, -0.866), EDGE_DOWN, pole=(-0.9, 0.3, -0.3),
                                            left=(0.20, 0.30, -0.80)), **lunge))
    hold = anim._with_hips(hit, (0, -0.01, -0.02))
    fol = _pose(G, _P(hips=(16, 6, 0), spine=(9, 5, 0), chest=(7, 8, 0), neck=(-8, 0, 0), head=(-12, -5, 0)),
                (0, -0.26, -0.14), dict(one((0.14, -0.88, -0.08), (0.02, -0.45, -0.89), EDGE_DOWN, pole=(-0.9, 0.3, -0.3),
                                            left=(0.20, 0.34, -0.80)), **lunge))
    rec = _pose(G, _P(hips=(4, -4, 0), spine=(2, -2, 0), chest=(-2, -4, 0)), (0, -0.06, -0.02),
                one((-0.12, 0.05, 0.90), (0.30, 0.45, 0.84), CARRY["up"], pole=(-0.9, -0.1, -0.2), left=BELT_L))
    out["cast_a1"] = clip("cast_a1", 25, [(0.0, G, "linear"), (0.12, up_, "out"), (0.28, arc, "inout"), (I, hit, "accel"),
                                          (0.50, hold, "out"), (0.68, fol, "out"), (0.84, rec, "inout"), (1.0, G, "settle")],
                          impact=I)

    # cast_a2 Stubborn: plant the tip in front (sunk), the right fist on the grip at the belly, the left hand
    # cupping the pommel; head down, chest up, the stance locks wide at f12; hold, breathe
    wide = feet_b(l=(0.08, -0.06, 0.0), r=(-0.08, 0.07, 0.0), yl=14, yr=-16)
    plant_d = (0.03, -0.18, -0.98)
    plant_up = (0.0, -0.98, 0.18)              # the flat to the front (the gems face the camera)
    lift = _pose(G, _P(hips=(2, 0, 0), spine=(2, 0, 0), chest=(-2, 0, 0), head=(-4, 0, 0)), (0, 0.0, 0.0),
                 one((0.30, -0.45, 0.45), (0.10, -0.30, 0.95), plant_up, pole=(-0.9, 0.1, -0.3), left=(0.10, -0.40, -0.55)))
    pole_r = (-0.9, 0.2, -0.4)
    fold = _pose(G, _P(hips=(4, 0, 0), spine=(4, 0, 0), chest=(4, 0, 0), neck=(4, 0, 0), head=(10, 0, 0)), (0, 0.0, -0.05),
                 dict(two((0.74, -0.62, -0.32), plant_d, plant_up, pole=pole_r, grip=-0.31)))
    fold = R.soft_grip(fold, along=-0.31)
    setp = anim.merge(anim.arms_relaxed(),
                      _pose(stance_b(1.25, wide), _P(hips=(2, 0, 0), spine=(-2, 0, 0), chest=(-6, 0, 0), neck=(6, 0, 0),
                                                     head=(14, 0, 0), shoulder_L=(0, 0, 4), shoulder_R=(0, 0, -4)),
                            (0, 0.0, -0.02), dict(two((0.74, -0.62, -0.32), plant_d, plant_up, pole=pole_r, grip=-0.31),
                                                  **wide)))
    breath = anim.add(setp, _P(chest=(-2, 0, 0), head=(-2, 0, 0)))
    out_ = anim._with_hips(anim.add(setp, _P(chest=(3, 0, 0), spine=(2, 0, 0), head=(6, 0, 0))), (0, 0, -0.012))
    over = anim._with_hips(setp, (0, 0, -0.022))
    out["cast_a2"] = clip("cast_a2", 30, [(0.0, G, "linear"), (0.14, lift, "inout"), (0.28, fold, "inout"),
                                          (0.36, over, "out"), (I, setp, "settle"), (0.62, breath, "sine"),
                                          (0.80, setp, "sine"), (1.0, out_, "inout")], impact=I)

    # cast_a3 Old Wound: draw back to the right with a 90 degree turn, sweep waist-high across the cone,
    # follow through 100 degrees and pause at f20 (the wound reopening), then back to the shoulder
    flat_ccw = (0.0, 0.0, 1.0)                 # right -> left sweep
    draw = _pose(G, _P(hips=(4, -30, 0), spine=(4, -22, 0), chest=(4, -30, 0), head=(-2, 26, 0)), (0, 0.05, -0.05),
                 one((-0.58, 0.18, -0.38), (-0.86, 0.48, -0.10), flat_ccw, pole=(-0.5, 0.8, -0.3),
                     left=(0.35, -0.45, -0.55), lpole=(0.9, 0.2, -0.3)))
    hit = _pose(G, _P(hips=(8, 6, 0), spine=(6, 4, 0), chest=(6, 6, 0), head=(-4, -6, 0)), (0, -0.06, -0.10),
                dict(one((0.10, -0.92, -0.32), (0.12, -0.98, -0.10), flat_ccw, pole=(-0.9, 0.2, -0.3),
                         left=(0.30, 0.05, -0.80)), **step(G, dl=(0.04, -0.12, 0))))
    fol = _pose(G, _P(hips=(8, 30, 0), spine=(6, 20, 0), chest=(6, 30, 0), head=(-4, -24, 0)), (0, -0.06, -0.10),
                dict(one((0.62, -0.45, -0.35), (0.92, 0.36, -0.10), flat_ccw, pole=(-0.4, -0.6, -0.6),
                         left=(0.25, 0.25, -0.80)), **step(G, dl=(0.04, -0.12, 0))))
    pause = anim._with_hips(anim.add(fol, _P(chest=(2, 2, 0), head=(4, 0, 0))), (0, 0, -0.01))
    rec = _pose(G, _P(hips=(2, 8, 0), spine=(0, 4, 0), chest=(-2, 4, 0)), (0, -0.02, -0.03),
                one((-0.10, 0.02, 0.88), (0.40, 0.45, 0.80), CARRY["up"], pole=(-0.9, -0.1, -0.2), left=BELT_L))
    out["cast_a3"] = clip("cast_a3", 30, [(0.0, G, "linear"), (0.08, anim.lerp_pose(G, draw, -0.08), "inout"),
                                          (0.27, draw, "inout"), (0.33, anim.lerp_pose(draw, hit, 0.15), "in"),
                                          (I, hit, "accel"), (0.55, fol, "out"), (0.667, pause, "out"),
                                          (0.84, rec, "inout"), (1.0, G, "settle")], impact=I)

    # cast_ult Settled Account: the left arm reaches out open (f0-10), the cleaver cocked back; at f18 the fist
    # yanks back to the chest as the cleaver stamps down in front, the body rocking back 10 degrees; hold to f30
    reach = _pose(G, _P(hips=(6, -10, 0), spine=(6, -6, 0), chest=(4, -8, 0), head=(-6, 6, 0),
                        shoulder_L=(0, 0, -8)), (0, -0.06, -0.04),
                  dict(one((-0.30, 0.18, 0.55), (-0.25, 0.55, 0.80), EDGE_DOWN, pole=(-0.9, 0.0, -0.3),
                           left=(0.06, -0.97, 0.18), lpole=(1.0, 0.0, -0.4)), **step(G, dl=(0, -0.14, 0))))
    reach2 = anim.add(reach, _P(chest=(2, -2, 0), shoulder_L=(0, 0, -3)))
    stamp = _pose(G, _P(hips=(-6, 8, 0), spine=(-6, 4, 0), chest=(-8, 6, 0), neck=(4, 0, 0), head=(6, -4, 0),
                        shoulder_L=(0, 0, 6)), (0, 0.06, -0.08),
                  dict(one((-0.16, -0.78, -0.42), (-0.06, -0.64, -0.77), EDGE_DOWN, pole=(-0.9, 0.2, -0.3),
                           left=(-0.30, -0.48, -0.22), lpole=(0.9, 0.2, -0.5)), **step(G, dl=(0, -0.14, 0))))
    hold = anim.add(stamp, _P(chest=(-1, 0, 0)))
    out["cast_ult"] = clip("cast_ult", 45, [(0.0, G, "linear"), (0.08, anim.lerp_pose(G, reach, -0.08), "inout"),
                                            (0.22, reach, "out"), (0.33, reach2, "inout"), (I, stamp, "snap"),
                                            (0.47, anim._with_hips(stamp, (0, 0.01, -0.012)), "out"),
                                            (0.67, hold, "linear"), (0.86, anim.lerp_pose(hold, G, 0.6), "inout"),
                                            (1.0, G, "settle")], impact=I)

    out.update(_gen_rest_clips(R, G))
    return out


def _gen_rest_clips(R, G) -> dict:
    out = {}
    hip_h = R.skel.rest_point("hips").z

    # death: one knee down on the planted cleaver, then forward over it onto the ground
    plant_d = (-0.10, -0.25, -0.96)
    hit = _pose(G, _P(hips=(-8, 8, 0), spine=(-10, 2, 0), chest=(-14, 4, 0), neck=(-8, 0, 0), head=(-16, 6, 0)), (0, 0.08, 0.0))
    kneel = anim.merge(anim.arms_relaxed(), _P(hips=(18, -6, 0), spine=(14, 0, 0), chest=(16, 0, 0), neck=(10, 0, 0),
                                               head=(18, 0, 0), toe_R=(60, 0, 0)))
    kneel["hips_loc"] = (0.0, 0.08, -hip_h * 0.40)
    kneel["ik"] = dict(anim.feet(l=(0.03, -0.30, 0.0), r=(-0.02, 0.36, 0.06), yl=-6, yr=-8, pr=-62, kr=8),
                       **one((-0.10, -0.62, -0.30), plant_d, (0.0, -0.96, 0.25), pole=(-0.9, 0.3, -0.3),
                             left=(-0.05, -0.55, -0.55), lpole=(0.9, 0.3, -0.3)))
    slump = anim.add(kneel, _P(spine=(10, 0, 0), chest=(10, 0, 0), head=(12, 0, 0)))
    slump = anim._with_hips(slump, (0, -0.04, -0.04))
    down = anim.merge(anim.arms_relaxed(), _P(hips=(84, -8, 4), spine=(4, 0, 0), chest=(4, 4, 0), neck=(-20, 0, 0),
                                              head=(-24, 18, 0), thigh_L=(-6, 0, -8), shin_L=(-10, 0, 0),
                                              thigh_R=(-2, 0, 8), shin_R=(-24, 0, 0), foot_L=(-30, 0, 0),
                                              foot_R=(-20, 0, 0)))
    k = hip_h / 0.95
    down["hips_loc"] = (0.03, -0.55 * k, -hip_h + 0.20)
    down["ik"] = {"hand.R": HT(pos=(-0.42 * k, -1.30 * k, 0.07), pole=(-1.0, 0.0, 0.2)),
                  "aim.R": AimRoll((-0.30, -0.95, 0.0), 1.0, (0.0, 0.0, 1.0)),
                  "hand.L": HT(pos=(0.55 * k, -1.05 * k, 0.07), pole=(1.0, 0.0, 0.2))}
    bounce = anim._with_hips(anim.add(down, _P(spine=(-5, 0, 0), chest=(-4, 0, 0), head=(-6, 0, 0))), (0, 0, 0.03))
    rest = anim.add(down, _P(head=(0, 6, 0)))
    out["death"] = anim.Clip("death", 60, False, anim.keyed([(0.0, G, "linear"), (0.10, hit, "snap"),
                                                             (0.32, kneel, "inout"), (0.48, slump, "inout"),
                                                             (0.70, down, "in"), (0.78, bounce, "out"),
                                                             (0.88, rest, "inout"), (1.0, rest, "linear")]))

    # recall: the cleaver planted at his right, the fist on the grip; the left thumb lights a tally stub
    rec = anim.merge(stance_b(0.6), anim.arms_relaxed(),
                     {"ik": one((-0.22, -0.40, -0.30), (-0.08, -0.18, -0.98), (0.30, -0.95, 0.0), pole=(-0.9, 0.3, -0.3),
                                left=(-0.10, -0.62, -0.20), lpole=(0.9, 0.3, -0.4))})
    rec = anim.add(rec, _P(neck=(10, 0, 0), head=(16, -6, 0), chest=(4, -4, 0)))

    def recall(t):
        b = anim.osc(t, 2)
        p = anim.add(rec, _P(chest=(1.2 * b, 0, 0), head=(-0.8 * b, 0, 0)))
        return anim._nudge_hands(p, (0, 0, 0.004 * b), (0.012 * anim.osc(t, 4), 0.0, 0.010 * anim.osc(t, 2, 0.2)))
    out["recall"] = anim.Clip("recall", 60, True, recall)

    # idle_lobby (120 f loop): the left thumb counts along the notches on the right shoulder, a nod at
    # something only he remembers; then the cleaver crosses to the left shoulder and back
    lob = anim.merge(stance_b(0.6), anim.arms_relaxed(), {"ik": carry_ik()})
    count = anim.add(lob, _P(head=(6, -8, -5), neck=(4, -4, 0)))
    count["ik"] = dict(count["ik"], **{"hand.L": HT(rel=R.left_rel(lob, 0.30), pole=(0.6, -0.6, -0.5))})
    count2 = dict(count)
    count2["ik"] = dict(count["ik"], **{"hand.L": HT(rel=R.left_rel(lob, 0.48), pole=(0.6, -0.6, -0.5))})
    nod = anim.add(count2, _P(head=(10, -8, -5)))
    left_sh = anim.add(lob, _P(chest=(0, 8, 0), head=(0, -10, 4)))
    left_sh["ik"] = dict(left_sh["ik"], **one((0.30, -0.25, 0.42), (-0.66, 0.50, 0.56), (0.30, -0.35, 0.89),
                                              pole=(-0.6, -0.4, -0.6), left=(0.12, -0.10, -0.94)))
    keys = [(0.0, lob, "linear"), (0.10, count, "inout"), (0.22, count2, "inout"), (0.28, nod, "inout"),
            (0.34, count2, "inout"), (0.44, lob, "inout"), (0.55, left_sh, "inout"), (0.78, left_sh, "linear"),
            (0.90, lob, "inout"), (1.0, lob, "linear")]
    base = anim.keyed(keys)

    def lobby(t):
        b = anim.osc(t, 4)
        return anim.add(base(t), _P(chest=(1.0 * b, 0, 0), shoulder_L=(0, 0, 1.2 * b), shoulder_R=(0, 0, -1.2 * b)))
    out["idle_lobby"] = anim.Clip("idle_lobby", 120, True, anim.drag(lobby, 120, {"head": 3.0, "neck": 2.0}, loop=True))

    # victory: no celebration. Plant the tip, take a tally stick, score it, nod; the final hold is the
    # cleaver planted at his right and the left hand held out palm up ("you are forgiven")
    plant = anim.merge(stance_b(0.7), anim.arms_relaxed(),
                       {"ik": one((-0.22, -0.42, -0.28), (-0.10, -0.20, -0.97), (0.30, -0.95, 0.0), pole=(-0.9, 0.3, -0.3),
                                  left=BELT_L)})
    take = anim.merge(plant, {"ik": {"hand.L": HT(rel=(-0.02, -0.30, -0.70), pole=(0.9, 0.2, -0.3))}})
    take = anim.add(take, _P(head=(14, 0, 0), neck=(6, 0, 0)))
    score = anim.merge(plant, {"ik": {"hand.L": HT(rel=(-0.12, -0.60, -0.18), pole=(0.9, 0.3, -0.4))}})
    score = anim.add(score, _P(head=(16, 4, 0), neck=(6, 0, 0)))
    nod = anim.add(score, _P(head=(8, 0, 0)))
    host = anim.merge(plant, {"ik": {"hand.L": HT(rel=(0.18, -0.85, -0.38), pole=(1.0, 0.0, -0.5))}})
    host = anim.add(host, _P(chest=(-4, 6, 0), head=(-4, 10, 0), shoulder_L=(0, 0, -4)))
    keys = [(0.0, G, "linear"), (0.22, plant, "inout"), (0.36, take, "inout"), (0.52, score, "inout"),
            (0.60, nod, "inout"), (0.66, score, "inout"), (0.80, host, "inout"), (1.0, host, "linear")]
    vb = anim.keyed(keys)

    def victory(t):
        p = vb(t)
        if t > 0.8:
            p = anim.add(p, _P(chest=(0.8 * anim.osc(t, 2), 0, 0)))
        return p
    out["victory"] = anim.Clip("victory", 60, False, anim.drag(victory, 60, {"head": 2.0, "neck": 1.0, "hand.L": 1.5}))

    # dash: a heavy lunge with the cleaver kept on the shoulder
    lunge = _pose(G, _P(hips=(18, 0, 0), spine=(10, 0, 0), chest=(8, 0, 0), neck=(-12, 0, 0), head=(-12, 0, 0)),
                  (0, -0.06, -0.08), dict(carry_ik(left=(0.18, -0.55, -0.70)),
                                         **anim.feet(l=(0.03, -0.32, 0.06), r=(-0.03, 0.30, 0.02), pl=10, pr=-30)))
    out["dash"] = anim.Clip("dash", 20, False, anim.keyed([(0.0, G, "linear"), (0.3, lunge, "snap"), (0.75, lunge, "linear"),
                                                            (1.0, G, "inout")]))

    # stunned: staggered back half a step, the cleaver slid off the shoulder and hanging, its tip down, head lolling
    sag = _pose(G, _P(spine=(10, 0, 0), chest=(12, 0, 0), neck=(10, 0, 0), head=(14, 0, 0)), (0, 0.05, -0.04),
                dict(one((-0.38, -0.04, -0.80), (-0.62, 0.50, -0.60), (0.0, 0.0, 1.0), pole=(-0.9, 0.3, -0.2),
                         left=(0.08, -0.10, -0.96)),
                     **step(G, dr=(0, 0.12, 0), dl=(0, 0.06, 0))))

    def stunned(t):
        a, b = anim.osc(t, 1), anim.osc(t, 1, 0.25)
        return anim.add(sag, _P(hips=(0, 0, 4 * a), spine=(3 * b, 0, -3 * a), chest=(3 * b, 0, -3 * a), neck=(6 * b, 0, 6 * a),
                                head=(8 * b, 4 * a, 8 * a)))
    out["stunned"] = anim.Clip("stunned", 40, True, stunned)

    # channel: the cleaver planted in front, both hands on the pommel, breathing
    chan = anim.merge(stance_b(1.1), anim.arms_relaxed(),
                      {"ik": two((0.74, -0.62, -0.32), (0.03, -0.18, -0.98), (0.0, -0.98, 0.18), pole=(-0.9, 0.2, -0.4),
                                 grip=-0.31)})
    chan = anim.add(chan, _P(neck=(6, 0, 0), head=(10, 0, 0)))
    out["channel"] = anim.Clip("channel", 40, True, lambda t: anim.add(chan, _P(chest=(1.5 * anim.osc(t, 2), 0, 0),
                                                                                 head=(-1 * anim.osc(t, 2), 0, 0))))
    return out


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


def _install_paint_pose() -> None:
    from common.hifi import project
    if getattr(project.paint_object, "_burdam", False):
        return
    orig = project.paint_object

    def paint_object(obj, size, cfg, names, part_attr="vale_part", log=print, return_maps=False):
        me = obj.data
        n = len(me.vertices)
        co = np.empty(n * 3, dtype=np.float32)
        me.vertices.foreach_get("co", co)
        co = co.reshape(n, 3)
        a = me.attributes.get(part_attr)
        pv = np.zeros(n, dtype=np.int64)
        if a is not None and a.domain == "POINT":
            a.data.foreach_get("value", pv)
        M = _STATE.get("prop")
        moved = paint_pose(co.astype(np.float64), pv, list(names), M).astype(np.float32) if M is not None else co
        me.vertices.foreach_set("co", moved.ravel())
        me.update()
        try:
            log("burdam: the cleaver painted in its concept pose (behind the head)")
            return orig(obj, size, cfg, names, part_attr=part_attr, log=log, return_maps=return_maps)
        finally:
            me.vertices.foreach_set("co", co.ravel())
            me.update()

    paint_object._burdam = True
    project.paint_object = paint_object


RUST_PARTS = ("tier1", "tier2", "tier3", "tier4", "shoulder_plate", "vambrace", "strap_plate")


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
        out = orig(img, maps, names, roles, base_pal, skin_pal, skip=skip, log=log)
        skin = _STATE.get("skin") or {}
        if (skin.get("extra") or {}).get("almanac_board"):
            log("burdam: Almanac Ledger print (ruled pauldrons, day-marks on the cleaver's back)")
            out = almanac_print(out, maps, list(names), skin_pal.get("ironstone", "#2E2A26"))
        return out

    recolour._burdam = True
    project.recolour = recolour


ARM_BONES = tuple(f"{b}.{s}" for s in "LR" for b in ("shoulder", "upper_arm", "forearm", "hand", "prop"))


def _install_body_bind() -> None:
    """bind 'body': bone heat from the trunk and legs only. The fists hang beside the belt and the coat's
    skirt at rest, so plain heat weights let the raised carry arm drag the belts and the hem; the shared
    binder has no exclusion option per part, so the pipeline's bind_part is wrapped here."""
    from common import mesh, pipeline
    if getattr(pipeline.bind_part, "_burdam", False):
        return
    orig = pipeline.bind_part

    def bind_part(ctx, part, obj, body_low=None):
        if part.bind == "body":
            return mesh.bind_auto(obj, ctx.info.armature, exclude=("root",) + ARM_BONES)
        return orig(ctx, part, obj, body_low)

    bind_part._burdam = True
    pipeline.bind_part = bind_part


if __name__ == "__main__":
    _install_body_bind()
    _install_paint_pose()
    _install_skin_print()
    fighter.main(sys.modules[__name__])
