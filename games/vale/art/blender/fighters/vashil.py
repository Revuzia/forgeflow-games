"""vashil: Bell ringer (Caster, Aubade). ART 2.0: sculpted volumes painted by concept projection.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/vashil_plates.py --height 2.10   # plates
    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/vashil_fit.py [--table] [--accent]  # fit check
    python3 art/build.py fighter vashil --no-skins --clip-sheet

Brief: _design/fighters/vashil.md. Concept: _design/concept/vashil.webp (front + back, hand-painted).
The forms are numpy SDF volumes (common/hifi/sdf.py) fitted to the concept on a 10 cm grid (the plates' scale is
the painted halo top, 2.10 m: the hood peak stands at 1.945); the base colour is the concept painting projected
occlusion-aware onto the game mesh (common/hifi/project.py, wrapped below); normals and AO bake from the sculpt.

Where the concept and the brief disagree:
  * the concept's carry wins (the approved look): the rod stands grounded at his right, the right fist round it at
    hip height (1.10 m), the forearm reaching forward-out of a wide bell sleeve; the left arm hangs with a fist.
    The rod is drawn longer than the painting's (top 1.78 m, painting 1.61: the brief's "long striking rod" reads
    beside the 2 m figure), its glass striker a faceted block like the painting's.
  * the brief's hook wins on size: the halo ring is 0.80 m across (the painting's is ~0.62), 2.035 m high, floating
    9 cm over the hood's peak, the seven dawnglass bells hung from it at (i + 0.5) * 360/7 degrees from the front (the
    front stays clear over the visor), three clasps mark the front (one) and the back (two).
  * the bell clappers are the accent (brief §7); to reach the gate's 1.5 % they are teardrop beads (4.6 cm), and a
    thin glowing core shows through the rod's striker (the Peal / Morning Toll origin, socket rod_head).

Not in the shared pipeline, implemented here (module-level wrappers; common/ untouched):
  * the right arm's rest pose (rig_extras re-seats upper_arm.R / forearm.R / hand.R on the concept carry and points
    prop.R up the rod), the x_halo bone (the halo rocks as one rigid piece: the bells ring), sockets rod_head, halo.
  * prop.R location tracks ("prop.R_loc", Kemdo's wrappers): the rod slides through the fist (the a2 jab, the
    a3 sweep and the ult's sledge strike are held near the butt).
  * skin weights for the robe (hips + thighs + shins by height and side), cowl, sleeves, wraps and boots.
  * the paint (project.paint wrapper): the back sheet is painted in shadow, so each part's back projection is moved
    onto its front's painted colour; the halo, bells, clasps, rod and striker paint procedurally; the hood's inside
    is shadowed; bluish smears of the painted bells on the hood are refilled; a soft highlight cap (no large area
    over L* 86) and the light-head / dark-feet ramp.
  * skins (project.recolour wrapper): each part's painted classes (cream coat, blue-grey panel / lining, dark hem)
    move their measured median onto the skin colour; Chalkline adds chalk line-work on the ink-grey cloth.
"""
from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy  # noqa: E402,F401
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

from common import anim, fighter, materials, rig, scene  # noqa: E402
from common import mesh as _mesh, pipeline as _pipeline  # noqa: E402
from common.anim import Aim, FootTarget, HandTarget  # noqa: E402
from common.hifi import project as _project, sdf  # noqa: E402
from common.hifi.sdf import (Capsule, Ellipsoid, FlatCapsule, HalfSpace, Lathe, Prim, RoundBox,  # noqa: E402
                             RoundCone, Sculpt, Sphere, Torus, Tube)

V = Vector
ID = "vashil"
TITLE = "Bell ringer"
ROLE_MASS = "caster"
ORIGIN = "aubade"
CARD = {"primary": "#E1DCCF", "secondary": "#A7B5C2"}


def unit(v):
    v = np.asarray(v, dtype=np.float64)
    return v / np.linalg.norm(v)


def _rot(axis, deg):
    """Rodrigues rotation matrix about `axis` (numpy)."""
    a = unit(axis)
    t = math.radians(deg)
    K = np.array([[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]])
    return np.eye(3) + math.sin(t) * K + (1 - math.cos(t)) * (K @ K)


# ── rig fitted to the concept (plates: 661 px/m, the halo top 2.10) ────────────────────────────────────
# crown of the skull in the hood 1.90 (hood peak 1.945), skull base 1.642, neck base 1.582, shoulders x 0.22 at 1.472,
# hips x 0.10 at 0.98, ankles x 0.18 at 0.09; the left arm hangs (fist at 0.85), the right is re-seated (rig_extras)
PROPORTIONS = rig.proportions(height=1.90, head=0.30, neck=0.06, shoulder_width=0.44, hip_width=0.20, leg=0.8936,
                              thigh_frac=0.50, arm=0.55, upper_arm_frac=0.52, hand=0.18, foot=0.27,
                              ankle_height=0.09, spine_curve=0.0, stance=0.08, toe_out_deg=8.0, knee_bend=0.012,
                              a_pose_deg=82.0, arm_forward_deg=4.0, elbow_bend_deg=12.0, shoulder_drop=0.11)
ARM = PROPORTIONS["arm"]
UPPER = ARM * PROPORTIONS["upper_arm_frac"]
FOREARM = ARM - UPPER
SH_L = np.array([0.22, 0.030, 1.472])
SH_R = SH_L * np.array([-1.0, 1.0, 1.0])


def _left_arm():
    p = PROPORTIONS
    a, fw = math.radians(p["a_pose_deg"]), math.radians(p["arm_forward_deg"])
    d1 = unit((math.cos(a) * math.cos(fw), -math.cos(a) * math.sin(fw), -math.sin(a)))
    el = SH_L + d1 * UPPER
    front = np.array([0.0, -1.0, 0.0])
    zf = unit(front - d1 * front.dot(d1))
    hinge = unit(np.cross(d1, zf))
    d2 = unit(_rot(hinge, p["elbow_bend_deg"]) @ d1)
    return el, el + d2 * FOREARM, d2


E_L, W_L, FO_L = _left_arm()
FIST_L = W_L + FO_L * 0.085
# the right arm (concept carry): elbow by the ribs, the forearm forward-out to the fist round the rod
E_R = np.array([-0.270, 0.035, 1.190])
GRIP = np.array([-0.468, -0.237, 1.100])           # the rod's axis through the right fist
FO_R = unit(GRIP - E_R)
W_R = E_R + FO_R * FOREARM
ROD_U = unit((-0.077, 0.0, 1.0))                    # the rod leans 4.4 degrees out at the top (as painted)


def rod_at(z):
    return GRIP + ROD_U * ((z - GRIP[2]) / ROD_U[2])


ROD_R = 0.019
ROD_TOP = 1.80                                      # the cap's top
STRIKER = (1.645, 1.765)                            # the glass block (12 cm, brief)
COLLAR = (1.605, 1.645)

# the halo (rigid on x_halo, a child of the head): 0.80 m across, floating 9 cm over the hood's peak
HALO_C = np.array([0.0, 0.02, 2.035])
HALO_RI, HALO_RO, HALO_HZ = 0.355, 0.400, 0.0175
HALO_RM = 0.5 * (HALO_RI + HALO_RO)
CLASP_ANG = (0.0, 125.0, -125.0)                    # degrees from the front (-Y) toward the left (+X)
BELL_H = 0.11
BELL_TOP = HALO_C[2] - HALO_HZ - 0.016              # the bell crowns hang 1.6 cm under the band (a hook loop)
BEAD_R = 0.021
INLAY_HZ = 0.0055                                   # the inner accent line's half height (1.1 cm)
_N_BELLS = [7]                                      # the bells on the halo being built (First Bell: 10)


def bell_angles(n=7):
    return [(i + 0.5) * 360.0 / n for i in range(n)]


def ring_pt(deg, r=HALO_RM, z=None):
    a = math.radians(deg)
    return np.array([HALO_C[0] + math.sin(a) * r, HALO_C[1] - math.cos(a) * r, HALO_C[2] if z is None else z])


MATERIAL_SET = "bible"
PALETTE = materials.bible_palette(chalk="#D9D4C6", dawnglass="#B9D0E2", stone="#B7BCC0", cloth2="#CFCFC8",
                                  wood="#A48E72", cloth="#7D8996", ironstone="#3D434B", leather="#433E3A",
                                  under="#313439", ink="#17181B", accent="#3F9CFF")
VALUE_GRADIENT_STOPS = materials.BIBLE_GRADIENT_STOPS
SOCKETS = {"weapon": "prop.R", "weapon_tip": "x_rod_head", "rod_head": "x_rod_head", "halo": "x_halo"}
SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92, "yaw": 22.0}
TEXTURE_SIZE = 2048
TEXTURE_SIZES = {"normal": 512, "orm": 256}
GLB_COMPRESS = True
ARMOUR_CONFORM = False
AO_INTO_BASE = 0.25
ATLAS_SOFTEN = 0.45

# ART 2.0 skins (brief §9): each part's painted classes move onto the skin colours (_recolour below); skin-only
# geometry from ctx.skin["extra"] (First Bell: ten bells on the same ring)
SKINS: list = [
    {"id": "vashil_chalkline", "extra": {"linework": True}, "card": {"primary": "#3A3F47", "secondary": "#E6E0D2"},
     "palette": {"cloth": "#3A3F47", "chalk": "#D9D4C6", "cloth2": "#C9C9C1", "linework": "#E6E0D2"}},
    {"id": "vashil_first_bell", "extra": {"bells": 10}, "card": {"primary": "#4A4640", "secondary": "#D8D2C4"},
     "palette": {"chalk": "#D8D2C4", "cloth": "#8D8A84", "stone": "#C9C4B8", "ironstone": "#38363A",
                 "under": "#34322F", "leather": "#3A332D"}},
]
SKIN_FLAT: dict = {}

HEIGHT = 2.10             # the painted halo top (the projection plates' scale)
PROJECTION = {"concept": "vashil", "height": HEIGHT}
NOISE = sdf.Noise(15)
VOXEL = 0.0065


# ── sculpt helpers ──────────────────────────────────────────────────────────────────────────────────
class Fn(Prim):
    """An SDF from a function of world points (bounds given)."""

    def __init__(self, fn, lo, hi):
        self.fn, self.lo, self.hi = fn, np.asarray(lo, float), np.asarray(hi, float)

    def bounds(self):
        return self.lo, self.hi

    def d(self, P):
        return self.fn(P)


def arch_d(x, z, zs, W, zp):
    """2D pointed (bell-window) arch in x-z: half-width W at the spring line zs, the point at zp. Inside < 0."""
    h = zp - zs
    R = (W * W + h * h) / (2 * W)
    c = R - W
    dc = np.maximum(np.hypot(x + c, z - zs) - R, np.hypot(x - c, z - zs) - R)
    return np.where(z >= zs, dc, np.abs(x) - W)


def ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def folds_ang(amp, n, c=(0.0, 0.02), zfade=None, phase=0.0):
    """Vertical folds round a body axis (n per turn), fading above zfade[0] -> full below zfade[1]."""
    def fn(P):
        th = np.arctan2(P[:, 0] - c[0], -(P[:, 1] - c[1]))
        u = th * n + phase + 0.9 * NOISE(P, 2.5)
        a = amp
        if zfade is not None:
            a = amp * ss(zfade[0], zfade[1], P[:, 2])
        return a * (np.abs(np.sin(u)) * 2.0 - 1.0) * -0.5
    return fn


def cloth_noise(amp, freq=7.0):
    def fn(P):
        return amp * NOISE(P, freq)
    return fn


def chips(amp, freq):
    def fn(P):
        return amp * np.clip(NOISE.ridged(P, freq, 3), 0, 1) - amp * 0.3
    return fn


def wraps(amp, pitch, a, b):
    """A strip wound round the a->b axis (bandage): a ridge every `pitch` m, slanted."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    u = unit(b - a)
    ref = unit(np.cross(u, (0.0, 0.0, 1.0)) if abs(u[2]) < 0.9 else np.cross(u, (1.0, 0.0, 0.0)))
    ref2 = np.cross(u, ref)

    def fn(P):
        q = P - a
        s = q @ u
        th = np.arctan2(q @ ref2, q @ ref)
        ph = (s / pitch + th / (2 * math.pi)) % 1.0
        return -amp * (ss(0.0, 0.18, ph) - ss(0.70, 1.0, ph)) + amp * 0.5
    return fn


def shell(E: Ellipsoid, t: float) -> Fn:
    """A shell of thickness t just inside ellipsoid E."""
    lo, hi = E.bounds()
    return Fn(lambda P: np.maximum(E.d(P), -E.d(P) - t), lo, hi)


def fist(name, C, a, f, out, role, bind, tris, grip=True):
    """A gloved fist with sculpted fingers. C: the centre of the fingers' curl (the rod axis for a grip); a: the
    knuckle line (pinky -> index); f: the forearm direction; out: the back of the hand."""
    C, a, f, out = (np.asarray(v, float) for v in (C, a, f, out))
    a = unit(a)
    f = unit(f - a * f.dot(a))
    out = unit(out - a * out.dot(a) - f * out.dot(f))
    S = Sculpt(name)
    ax = np.stack([a, f, out])
    S.add(RoundBox(C - f * 0.030 + out * 0.012, (0.046, 0.042, 0.026), 0.017, axes=ax), k=0.0)       # back + palm
    for i in range(4):
        s = (i - 1.5) * 0.0245
        rr = 0.0128 if i else 0.0115                                                                 # the pinky thinner
        K = C + f * 0.006 + out * 0.026 + a * s
        M = C + f * 0.040 + out * 0.004 + a * s
        T = C + f * 0.026 - out * 0.026 + a * s
        S.add(Tube([K, M, T], [rr + 0.002, rr + 0.001, rr], k=0.006), k=0.006)
        S.add(Sphere(K + out * 0.004, rr + 0.003), k=0.006)                                          # the knuckle
    tb = C - f * 0.030 - out * 0.022 + a * 0.050
    tm = C + f * 0.004 - out * 0.032 + a * 0.050
    tt = C + f * 0.026 - out * 0.020 + a * 0.028
    S.add(Tube([tb, tm, tt], [0.017, 0.0145, 0.0125], k=0.006), k=0.010)                              # the thumb
    S.add(FlatCapsule(C - f * 0.085, C - f * 0.035, 0.040, 0.030, 0.046, 0.031, side=tuple(a)), k=0.012)   # the cuff
    if grip:
        S.sub(Capsule(C - a * 0.12, C + a * 0.12, ROD_R + 0.002), k=0.003)
    return (name, S, 0.55, role, bind, tris, 2.0)


# ── the sculpt ──────────────────────────────────────────────────────────────────────────────────────
def sculpts(n_bells: int = 7) -> list:
    """(name, Sculpt, voxel scale, material role, bind, tris, uv weight) in build order."""
    out = []

    def part(name, S, role, bind, tris, vs=1.0, uvw=1.0):
        out.append((name, S, vs, role, bind, tris, uvw))

    # HOOD (the head, the lower rim blending to the neck): a pointed bell-window arch, 0.28 m wide, peak 1.945
    hood = Sculpt("hood")
    E_hood = Ellipsoid((0.0, 0.035, 1.70), (0.40, 0.172, 0.30))

    def hood_out(P):
        return np.maximum(arch_d(P[:, 0], P[:, 2], 1.78, 0.107, 1.945), E_hood.d(P))
    hood.add(Fn(hood_out, (-0.16, -0.15, 1.55), (0.16, 0.22, 1.96)).displaced(cloth_noise(0.003, 9.0), 0.003), k=0.0)
    hood.add(Ellipsoid((0.0, 0.04, 1.625), (0.150, 0.15, 0.085)), k=0.05)                            # the flare
    hood.inter(HalfSpace((0, 0, 1.565), (0, 0, -1), 1.0), k=0.01)

    def opening(P):
        return np.maximum(arch_d(P[:, 0], P[:, 2], 1.80, 0.091, 1.913), P[:, 1] + 0.035)
    hood.sub(Fn(opening, (-0.12, -0.30, 1.55), (0.12, -0.03, 1.93)), k=0.012)
    part("hood", hood, "chalk", ("zblend", "neck", "head", 1.60, 1.70), 1500, uvw=1.6)

    # VISOR: a faceted dawnglass arch (pointed top like a bell window) in a chalk frame, over the face-plate
    a_v = math.radians(24.0)
    n1, n2 = np.array([math.sin(a_v), -math.cos(a_v), 0.0]), np.array([-math.sin(a_v), -math.cos(a_v), 0.0])
    nt = unit((0.0, -math.cos(math.radians(40)), math.sin(math.radians(40))))

    def facets(P, y0, z_top=1.86):
        q = P - np.array([0.0, y0, 0.0])
        top = (P - np.array([0.0, y0, z_top])) @ nt
        return np.maximum(np.maximum(q @ n1, q @ n2), top)

    def frame_d(P):
        outer = np.maximum(arch_d(P[:, 0], P[:, 2], 1.80, 0.091, 1.909), 1.735 - P[:, 2])
        slab = np.maximum(facets(P, -0.124), -(P[:, 1] + 0.055))
        inner = np.maximum(arch_d(P[:, 0], P[:, 2], 1.80, 0.074, 1.889), 1.752 - P[:, 2])
        return np.maximum(np.maximum(outer, slab), -inner)
    vf = Sculpt("visor_frame")
    vf.add(Fn(frame_d, (-0.11, -0.14, 1.72), (0.11, -0.05, 1.92)), k=0.0)
    vf.add(RoundBox((0.0, -0.112, 1.742), (0.093, 0.020, 0.009), 0.006), k=0.004)                    # the brim bar
    part("visor_frame", vf, "chalk", "bone:head", 700, 0.5, uvw=2.2)

    def glass_d(P):
        inner = np.maximum(arch_d(P[:, 0], P[:, 2], 1.80, 0.076, 1.891), 1.750 - P[:, 2])
        return np.maximum(inner, np.maximum(facets(P, -0.118), -(P[:, 1] + 0.05)))
    vg = Sculpt("visor_glass")
    vg.add(Fn(glass_d, (-0.09, -0.13, 1.74), (0.09, -0.04, 1.90)), k=0.0)
    part("visor_glass", vg, "dawnglass", "bone:head", 500, 0.5, uvw=2.4)

    # FACE-PLATE: carved chalk under the visor (the concept's mask: a centre ridge, cheek scrolls, a mouth step)
    mask = Sculpt("mask")
    cyl = Fn(lambda P: np.hypot(P[:, 0], P[:, 1] - 0.072) - 0.183, (-0.1, -0.12, 1.64), (0.1, 0.1, 1.75))
    mask.add(cyl, k=0.0)
    mask.inter(RoundBox((0.0, 0.0, 1.698), (0.086, 0.2, 0.044), 0.018), k=0.0)
    mask.inter(HalfSpace((0, -0.02, 0), (0, 1, 0), 1.0), k=0.0)
    mask.add(Capsule((0.0, -0.110, 1.664), (0.0, -0.113, 1.735), 0.0075), k=0.006)                     # the ridge
    mask.sub(Capsule((-0.07, -0.118, 1.676), (0.07, -0.118, 1.676), 0.0042), k=0.002)                  # the mouth step
    for sx in (-1, 1):
        for R_, rr in ((0.026, 0.0038), (0.013, 0.0034)):
            mask.sub(Torus((sx * 0.047, -0.112, 1.708), R_, rr, axes=sdf.frame((sx * 0.35, -1.0, 0.0))), k=0.002)
        mask.sub(Capsule((sx * 0.024, -0.112, 1.664), (sx * 0.068, -0.103, 1.668), 0.0035), k=0.002)
    part("mask", mask, "chalk", "bone:head", 1000, 0.5, uvw=2.4)

    neck = Sculpt("neckwrap")
    neck.add(Ellipsoid((0.0, 0.0, 1.615), (0.105, 0.105, 0.060)), k=0.0)
    neck.add(Torus((0.0, 0.0, 1.592), 0.085, 0.03), k=0.02)
    part("neckwrap", neck, "ironstone", ("zblend", "chest", "neck", 1.585, 1.64), 350)

    # COWL: the draped scarf round the neck and over the shoulders, a V in front (1.43), a point at the back (1.36)
    cowl = Sculpt("cowl")
    cowl.add(Torus((0.0, 0.03, 1.588), 0.125, 0.062, rz=0.05), k=0.0)
    cowl.add(Ellipsoid((0.0, 0.035, 1.535), (0.235, 0.165, 0.075)), k=0.05)
    cowl.add(FlatCapsule((0.0, -0.118, 1.575), (0.0, -0.163, 1.43), 0.205, 0.05, 0.03, 0.022, side=(1, 0, 0)), k=0.04)
    cowl.add(FlatCapsule((0.0, 0.15, 1.585), (0.0, 0.196, 1.36), 0.20, 0.06, 0.035, 0.025, side=(1, 0, 0)), k=0.04)
    for sx in (-1, 1):
        cowl.add(Tube([(sx * 0.17, -0.10, 1.58), (sx * 0.10, -0.155, 1.50), (0.0, -0.172, 1.43)],
                      [0.024, 0.02, 0.016], k=0.01), k=0.02)                                         # the drape's folds
    cowl.ops = [(op, prim.displaced(cloth_noise(0.0035, 8.0), 0.0035) if op == "add" else prim, k, tg)
                for op, prim, k, tg in cowl.ops]
    part("cowl", cowl, "cloth2", ("weights", "cowl"), 1650, uvw=1.2)

    # PAULDRONS: three stepped stone lames per shoulder (rigid on the shoulder, the lower ones toward the upper arm)
    for s, sx in (("R", -1), ("L", 1)):
        for i, (zc, rad) in enumerate(((1.475, (0.100, 0.150, 0.088)), (1.405, (0.105, 0.158, 0.085)),
                                       (1.335, (0.110, 0.164, 0.080)))):
            L = Sculpt(f"pauldron_{s}{i + 1}")
            c = (sx * 0.200, 0.03, zc)
            E = Ellipsoid(c, rad)
            L.add(shell(E, 0.016).displaced(chips(0.004, 9.0), 0.004), k=0.0)
            L.inter(HalfSpace((0, 0, zc - 0.012), (0, 0, -1), 1.0), k=0.004)
            L.inter(HalfSpace((sx * 0.105, 0, 0), (-sx, 0, 0), 1.0), k=0.004)
            org = (sx * 0.22, 0.03, 1.472)
            part(f"pauldron_{s}{i + 1}", L, "stone", ("dblend", f"shoulder.{s}", f"upper_arm.{s}", org,
                                                        (sx * 0.14, 0.0, -0.99), 0.03 + 0.03 * i, 0.10 + 0.03 * i), 400, 0.6)

    # ROBE TOP (chalk) under the cowl, the SASH over the seam, the SKIRT to the hem (coat + blue-grey panel + band)
    top = Sculpt("robe_top")
    top.add(FlatCapsule((0.0, 0.02, 1.10), (0.0, 0.025, 1.43), 0.232, 0.165, 0.245, 0.15, side=(1, 0, 0)), k=0.0)
    for sx in (-1, 1):
        top.add(Sphere((sx * 0.20, 0.03, 1.44), 0.105), k=0.06)
    top.add(Ellipsoid((0.0, -0.06, 1.33), (0.19, 0.11, 0.12)), k=0.05)
    for sx in (-1, 1):                                                          # the crossed lapels (painted blue)
        top.add(Tube([(sx * 0.105, -0.148, 1.47), (sx * 0.04, -0.168, 1.33), (-sx * 0.03, -0.172, 1.20)],
                     [0.010, 0.010, 0.009], k=0.01), k=0.012)
    top.ops = [(op, prim.displaced(folds_ang(0.006, 9, zfade=(1.40, 1.15), phase=0.7), 0.006) if op == "add" and i == 0
                else prim, k, tg) for i, (op, prim, k, tg) in enumerate(top.ops)]
    part("robe_top", top, "chalk", ("weights", "torso"), 1300)

    sash = Sculpt("sash")
    sash.add(Torus((0.0, 0.018, 1.168), 0.247, 0.052, axes=np.diag([1.0, 0.247 / 0.182, 1.0]), rz=0.060)
             .displaced(lambda P: 0.004 * np.sin(P[:, 2] * 140.0 + 3.0 * NOISE(P, 6.0)), 0.004), k=0.0)
    sash.add(Ellipsoid((-0.105, -0.196, 1.172), (0.052, 0.034, 0.042)), k=0.012)                      # the knot
    sash.add(FlatCapsule((-0.12, -0.198, 1.14), (-0.145, -0.215, 0.87), 0.030, 0.010, 0.027, 0.008, side=(1, 0, 0)), k=0.01)
    sash.add(FlatCapsule((-0.085, -0.200, 1.14), (-0.070, -0.222, 0.90), 0.026, 0.010, 0.022, 0.008, side=(1, 0, 0)), k=0.01)
    part("sash", sash, "cloth2", ("weights", "sash"), 800)

    skirt = Sculpt("skirt")
    f1 = FlatCapsule((0.0, 0.015, 1.14), (0.0, 0.02, 0.76), 0.222, 0.165, 0.236, 0.175, side=(1, 0, 0))
    f2 = FlatCapsule((0.0, 0.02, 0.78), (0.0, 0.03, 0.12), 0.236, 0.175, 0.300, 0.240, side=(1, 0, 0))
    fold = folds_ang(0.011, 11, zfade=(1.05, 0.55))
    skirt.add(f1.displaced(fold, 0.011), k=0.0)
    skirt.add(f2.displaced(fold, 0.011), k=0.10)
    skirt.inter(HalfSpace((0, 0, 0.13), (0, 0, -1), 2.0), k=0.006)
    # the coat open at the front: the blue-grey panel recessed 2.5 cm between the coat's edges
    skirt.sub(RoundBox((-0.010, -0.33, 0.62), (0.086, 0.12, 0.47), 0.018), k=0.010)
    skirt.add(Fn(lambda P: np.hypot(np.hypot(P[:, 0] / 0.289, (P[:, 1] - 0.028) / 0.231) * 0.27 - 0.27, P[:, 2] - 0.272) - 0.010,
                 (-0.33, -0.27, 0.25), (0.33, 0.30, 0.30)), k=0.006)                                  # the coat's hem roll
    skirt.sub(RoundBox((-0.010, -0.33, 0.27), (0.086, 0.06, 0.03), 0.010), k=0.006)
    part("skirt", skirt, "chalk", ("weights", "skirt"), 2400, uvw=1.0)

    # SLEEVES: wide bell sleeves, the right hanging from the bent arm (its drape below the forearm), the left straight
    sl = Sculpt("sleeve_L")
    sl.add(FlatCapsule((0.235, 0.03, 1.42), (0.278, 0.005, 0.90), 0.070, 0.10, 0.080, 0.145, side=(1, 0, 0))
           .displaced(folds_ang(0.008, 7, c=(0.28, 0.01), zfade=(1.25, 1.0)), 0.008), k=0.0)
    nrm = unit((-0.30, -0.45, -0.84))
    sl.inter(HalfSpace((0.29, 0.0, 0.93), nrm, 1.0), k=0.008)
    sl.sub(FlatCapsule((0.262, 0.01, 1.20), (0.288, -0.005, 0.80), 0.046, 0.07, 0.058, 0.118, side=(1, 0, 0)), k=0.008)
    part("sleeve_L", sl, "chalk", ("weights", "sleeves"), 1100)
    sr = Sculpt("sleeve_R")                     # a bell sleeve hanging from the bent arm, its mouth turned front-out
    sr.add(FlatCapsule((-0.235, 0.03, 1.42), (-0.292, 0.02, 0.86), 0.070, 0.10, 0.084, 0.142, side=(1, 0, 0))
           .displaced(folds_ang(0.008, 7, c=(-0.28, 0.02), zfade=(1.25, 1.0)), 0.008), k=0.0)
    n_open = unit((-0.55, -0.80, 0.15))
    p_open = np.array([-0.29, -0.035, 1.0])
    sr.sub(Fn(lambda P: np.maximum(-((P - p_open) @ n_open), P[:, 2] - 1.235), (-0.5, -0.4, 0.7), (0.0, 0.3, 1.3)), k=0.012)
    sr.inter(HalfSpace((0.0, 0.0, 0.84), (0.25, 0.30, -0.92), 1.0), k=0.01)
    sr.sub(FlatCapsule((-0.258, 0.015, 1.24), (-0.30, 0.005, 0.80), 0.046, 0.07, 0.060, 0.118, side=(1, 0, 0)), k=0.008)
    part("sleeve_R", sr, "chalk", ("weights", "sleeves"), 1200)

    # FOREARMS: tan linen bandages out of the cuffs
    for s, E_, W_ in (("L", E_L, W_L), ("R", E_R, W_R)):
        fa = Sculpt(f"wrap_{s}")
        u = unit(W_ - E_)
        a_, b_ = E_ + u * 0.05, W_ + u * 0.012
        fa.add(RoundCone(a_, b_, 0.044, 0.037).displaced(wraps(0.0035, 0.032, a_, b_), 0.0035), k=0.0)
        part(f"wrap_{s}", fa, "cloth2", ("weights", "forearms"), 500, 0.6, uvw=1.3)

    # HANDS: slate gloves, the right closed round the rod (index up), the left a hanging fist (index forward)
    fo_out = unit(np.cross(FO_R, ROD_U))
    out.append(fist("hand_R", GRIP, ROD_U, FO_R, fo_out, "ironstone", "bone:hand.R", 800))
    out.append(fist("hand_L", FIST_L + np.array([0.0, 0.0, 0.03]), (0.0, -1.0, 0.0), FO_L, (1.0, 0.0, 0.0), "ironstone",
                    "bone:hand.L", 800, grip=False))

    # BOOTS (slate shoes, the toe a little pointed)
    # (no legs: the robe falls to the boots; legs inside only poked through the skirt in the stride)
    boots = Sculpt("boots")
    for sx in (-1, 1):
        to = math.radians(8.0) * sx
        fwd = np.array([math.sin(to), -math.cos(to), 0.0])
        a0 = np.array([sx * 0.18, 0.02, 0.0])
        boots.add(RoundBox(a0 + fwd * 0.055 + np.array([0, 0, 0.045]), (0.058, 0.135, 0.045), 0.030,
                           axes=sdf.rot_z(-math.degrees(to))), k=0.0)
        boots.add(RoundCone(a0 + fwd * 0.17 + np.array([0, 0, 0.032]), a0 + fwd * 0.20 + np.array([0, 0, 0.028]), 0.036, 0.022), k=0.03)
        boots.add(FlatCapsule(a0 + np.array([0, 0, 0.06]), a0 + np.array([0, 0, 0.17]), 0.062, 0.066, 0.058, 0.060, side=(1, 0, 0)), k=0.035)
    boots.inter(HalfSpace((0, 0, 0.0), (0, 0, -1), 2.0), k=0.0)
    part("boots", boots, "leather", ("weights", "boots"), 850)

    # THE ROD (prop.R): gnarled ash, a leather grip under the fist, a chalk collar, the faceted glass striker, a cap
    pts, rads = [], []
    for i, z in enumerate(np.linspace(0.015, COLLAR[0] + 0.01, 14)):
        p = rod_at(z)
        wob = 0.006 * np.array([math.sin(z * 7.1 + 0.3), math.cos(z * 5.3), 0.0]) if 0.2 < z < 1.0 or z > 1.22 else np.zeros(3)
        if z > 1.30:                                                    # the painted kinks under the head
            wob = wob + 0.010 * np.array([math.sin((z - 1.30) * 22.0), 0.0, 0.0])
        pts.append(p + wob)
        rads.append(ROD_R * (1.0 + 0.12 * math.sin(z * 11.0 + 1.0)) * (0.92 if z < 0.1 else 1.0))
    shaft = Sculpt("rod_shaft")
    shaft.add(Tube(pts, rads, k=0.01).displaced(lambda P: 0.0018 * NOISE(P * np.array([1.0, 1.0, 0.15]), 40.0), 0.0018), k=0.0)
    part("rod_shaft", shaft, "wood", "bone:prop.R", 420, 0.5, uvw=1.1)
    grip = Sculpt("rod_grip")
    g0, g1 = rod_at(1.00), rod_at(1.205)
    grip.add(Capsule(g0, g1, ROD_R + 0.006).displaced(wraps(0.0022, 0.016, g0, g1), 0.0022), k=0.0)
    part("rod_grip", grip, "leather", "bone:prop.R", 220, 0.5)

    def collar_prof(r, z):
        return np.maximum(r - 0.031 + 0.006 * ss(0.0, 1.0, np.abs(z - 0.02) / 0.02), np.maximum(-z, z - 0.04))
    col_ = Sculpt("rod_collar")
    col_.add(Lathe(rod_at(COLLAR[0]), collar_prof, 0.035, -0.002, 0.042, axes=sdf.frame(ROD_U)), k=0.0)
    cz = rod_at(ROD_TOP - 0.022)
    col_.add(Capsule(cz, rod_at(ROD_TOP - 0.008), 0.020), k=0.0)
    col_.add(Sphere(rod_at(ROD_TOP - 0.004), 0.012), k=0.006)
    part("rod_collar", col_, "chalk", "bone:prop.R", 300, 0.45)
    stk = Sculpt("striker")
    sc = rod_at(0.5 * (STRIKER[0] + STRIKER[1]))
    stk.add(RoundBox(sc, (0.036, 0.036, 0.5 * (STRIKER[1] - STRIKER[0])), 0.010,
                     axes=sdf.rot_z(45.0) @ sdf.frame(ROD_U)), k=0.0)
    part("striker", stk, "dawnglass", "bone:prop.R", 300, 0.45, uvw=1.6)
    core = Sculpt("striker_core")                       # the accent glow showing through the glass's four faces
    core.add(RoundBox(sc, (0.0180, 0.0400, 0.050), 0.006, axes=sdf.rot_z(45.0) @ sdf.frame(ROD_U)), k=0.0)
    core.add(RoundBox(sc, (0.0400, 0.0180, 0.050), 0.006, axes=sdf.rot_z(45.0) @ sdf.frame(ROD_U)), k=0.0)
    part("striker_core", core, "accent", "bone:prop.R", 160, 0.45)

    # THE WRIST BELL (left): a 5 cm dawnglass bell on a short cord at the wrist
    wb_top = W_L + np.array([0.048, -0.012, -0.040])
    cord = Sculpt("wrist_cord")
    cord.add(Torus(W_L + FO_L * 0.010, 0.040, 0.005, axes=sdf.frame(FO_L)), k=0.0)
    cord.add(Capsule(W_L + FO_L * 0.010 + np.array([0.040, -0.006, 0.0]), wb_top, 0.0035), k=0.004)
    part("wrist_cord", cord, "leather", "bone:forearm.L", 160, 0.45)
    wbell = Sculpt("wrist_bell")
    wbell.add(Lathe(wb_top, lambda r, z: bell_prof(r, z, 0.050), 0.03, -0.052, 0.002), k=0.0)
    part("wrist_bell", wbell, "dawnglass", "bone:forearm.L", 160, 0.45)
    wcl = Sculpt("wrist_clapper")
    wcl.add(Sphere(wb_top + np.array([0, 0, -0.058]), 0.010), k=0.0)
    part("wrist_clapper", wcl, "accent", "bone:forearm.L", 60, 0.45)

    out.extend(halo_parts(n_bells))
    return out


def bell_prof(r, z, H=BELL_H):
    """A bell in (r, z): the crown at z 0, the lip at -H (z negative down). Rounded crown, waist, flared lip."""
    u = np.clip(-z / H, 0.0, 1.0)
    R = H * (0.27 + 0.04 * np.sin(u * math.pi * 0.5) + 0.10 * ss(0.45, 1.0, u) + 0.03 * ss(0.86, 1.0, u))
    crown = np.hypot(r, z + H * 0.20) - H * 0.285
    side = np.maximum(r - R, np.maximum(z + H * 0.14, -H - z))
    return np.minimum(side, crown) * 0.85


def halo_parts(n_bells: int = 7) -> list:
    out = []
    ring = Sculpt("halo_ring")

    def ring_prof(r, z):
        q = np.stack([np.abs(r - HALO_RM) - (HALO_RO - HALO_RI) / 2 + 0.008, np.abs(z) - HALO_HZ + 0.008], -1)
        return np.hypot(np.maximum(q[..., 0], 0), np.maximum(q[..., 1], 0)) + np.minimum(np.max(q, -1), 0) - 0.008
    ring.add(Lathe(HALO_C, ring_prof, HALO_RO + 0.01, -0.03, 0.03).displaced(chips(0.0035, 8.0), 0.0035), k=0.0)
    out.append(("halo_ring", ring, 0.6, "chalk", "bone:x_halo", 1100, 1.4))
    inl = Sculpt("halo_inlay")                      # a thin glowing line round the ring's inner face (the accent ring)
    inl.add(Lathe(HALO_C, lambda r, z: np.maximum(np.abs(r - (HALO_RI + 0.001)) - 0.0045, np.abs(z) - INLAY_HZ),
                  HALO_RI + 0.01, -0.012, 0.012), k=0.0)
    out.append(("halo_inlay", inl, 0.45, "accent", "bone:x_halo", 500, 1.0))
    cl = Sculpt("halo_clasps")
    for ang in CLASP_ANG:
        c = ring_pt(ang, z=HALO_C[2] + 0.012)
        cl.add(RoundBox(c, (0.026, 0.034, 0.047), 0.008, axes=sdf.rot_z(-ang)).displaced(chips(0.003, 10.0), 0.003), k=0.0)
        cl.add(RoundBox(c + np.array([0, 0, 0.050]), (0.019, 0.026, 0.008), 0.005, axes=sdf.rot_z(-ang)), k=0.004)
    out.append(("halo_clasps", cl, 0.5, "stone", "bone:x_halo", 300, 1.0))
    win = Sculpt("clasp_windows")                   # a glowing slot through each clasp (the accent marks the facings)
    for ang in CLASP_ANG:
        c = ring_pt(ang, z=HALO_C[2] + 0.016)
        win.add(RoundBox(c, (0.013, 0.038, 0.030), 0.004, axes=sdf.rot_z(-ang)), k=0.0)
    out.append(("clasp_windows", win, 0.45, "accent", "bone:x_halo", 72, 1.0))
    bells, hooks, stems, beads = Sculpt("bells"), Sculpt("bell_hooks"), Sculpt("clapper_stems"), Sculpt("clappers")
    for ang in bell_angles(n_bells):
        top = ring_pt(ang, z=BELL_TOP)
        bells.add(Lathe(top, bell_prof, 0.05, -BELL_H - 0.004, 0.004), k=0.0)
        a = math.radians(ang)
        tang = np.array([math.cos(a), math.sin(a), 0.0])
        hooks.add(Torus(top + np.array([0, 0, 0.012]), 0.0085, 0.0035, axes=sdf.frame(tang)), k=0.0)
        bot = top + np.array([0, 0, -BELL_H - 0.030])               # the bead hangs clear of the lip (read from above)
        stems.add(Capsule(top + np.array([0, 0, -0.06]), bot, 0.0042), k=0.0)
        beads.add(Sphere(bot + np.array([0, 0, -BEAD_R * 0.75]), BEAD_R), k=0.0)
        beads.add(RoundCone(bot + np.array([0, 0, -BEAD_R * 1.0]), bot + np.array([0, 0, -BEAD_R * 2.5]), BEAD_R * 0.75, 0.004), k=0.006)
    out.append(("bells", bells, 0.5, "dawnglass", "bone:x_halo", 160 * n_bells, 1.2))
    out.append(("bell_hooks", hooks, 0.4, "ironstone", "bone:x_halo", 26 * n_bells, 0.5))
    out.append(("clapper_stems", stems, 0.4, "ironstone", "bone:x_halo", 20 * n_bells, 0.5))
    out.append(("clappers", beads, 0.45, "accent", "bone:x_halo", 50 * n_bells, 1.0))
    return out


def model(ctx) -> list:
    P = []
    extra = (ctx.skin or {}).get("extra") or {}
    _N_BELLS[0] = int(extra.get("bells", 7))
    for name, S, vs, role, bind, tris, uvw in sculpts(_N_BELLS[0]):
        v, q = S.mesh(VOXEL * vs)
        ob = sdf.to_object(f"{name}_high", v, q, ctx.col)
        ob.data.materials.append(ctx.mats[role])
        P.append(fighter.Part(name, high=ob, tris=tris, bind=bind, uv_weight=uvw))
    return P


# ── rig: the right arm on the concept carry, prop.R up the rod, the halo bone, sockets ─────────────────
def rig_extras(ctx) -> None:
    info = ctx.info
    arm = info.armature
    scene.select_only([arm], arm)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    sh = V(eb["upper_arm.R"].head)
    elv, wrv = V(tuple(E_R)), V(tuple(W_R))
    up_d, fo_d = (elv - sh).normalized(), (wrv - elv).normalized()
    eb["upper_arm.R"].tail = elv
    eb["forearm.R"].head = elv
    eb["forearm.R"].tail = wrv
    hd = (V(tuple(GRIP)) - wrv).normalized()
    eb["hand.R"].head = wrv
    eb["hand.R"].tail = wrv + hd * PROPORTIONS["hand"] * 0.5
    eb["upper_arm.R"].align_roll(fo_d - up_d * fo_d.dot(up_d))
    eb["forearm.R"].align_roll(-up_d - fo_d * (-up_d).dot(fo_d))
    eb["hand.R"].align_roll(-up_d - hd * (-up_d).dot(hd))
    g = V(tuple(GRIP))
    eb["prop.R"].head = g
    eb["prop.R"].tail = g + V(tuple(ROD_U)) * 0.12
    eb["prop.R"].align_roll(V((0.0, -1.0, 0.0)))
    hb = eb.new("x_halo")                                       # deforming: the halo rocks as one rigid piece
    hb.head = V(tuple(HALO_C))
    hb.tail = V(tuple(HALO_C + np.array([0.0, 0.0, 0.10])))
    hb.align_roll(V((0.0, -1.0, 0.0)))
    hb.parent = eb["head"]
    hb.use_deform = True
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.pose.bones["x_halo"].rotation_mode = "XYZ"
    for b in arm.data.bones:
        info.lengths[b.name] = b.length
    info.joints["elbow.R"], info.joints["wrist.R"] = elv, wrv
    info.joints["knuckle.R"] = wrv + hd * PROPORTIONS["hand"] * 0.5
    info.joints["palm.R"] = g
    info.joints["forearm_dir.R"] = fo_d
    info.joints["arm_dir.R"] = up_d
    head = rod_at(0.5 * (STRIKER[0] + STRIKER[1]))
    rig.add_socket(info, "x_rod_head", "prop.R", tuple(head), tuple(ROD_U * 0.08), z_hint=(0, -1, 0))


# ── skin weights (pipeline.bind_part wrapper) ──────────────────────────────────────────────────────────
def _w_torso(P, J):
    x, z = P[:, 0], P[:, 2]
    wh = 1 - ss(1.04, 1.22, z)
    wc = ss(1.28, 1.44, z)
    ws = np.clip(1 - wh - wc, 0, 1)
    sh = ss(0.13, 0.22, np.abs(x)) * ss(1.36, 1.48, z)
    k = 1 - sh
    return {"hips": wh * k, "spine": ws * k, "chest": wc * k, "shoulder.L": sh * (x > 0), "shoulder.R": sh * (x <= 0)}


def _w_sash(P, J):
    return {"hips": np.full(len(P), 0.55), "spine": np.full(len(P), 0.45)}


def _w_cowl(P, J):
    x, z = P[:, 0], P[:, 2]
    wn = 0.55 * ss(1.60, 1.66, z) * (1 - ss(0.10, 0.16, np.abs(x)))
    sh = 0.6 * ss(0.12, 0.22, np.abs(x)) * (1 - wn)
    wc = np.clip(1 - wn - sh, 0, 1)
    return {"chest": wc, "neck": wn, "shoulder.L": sh * (x > 0), "shoulder.R": sh * (x <= 0)}


def _w_skirt(P, J):
    """The robe from the sash to the hem: the hips at the waist, the legs below (each side its own thigh, blended
    across the middle), the shins taking a share near the hem behind the calves."""
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    leg = 0.64 * ss(1.06, 0.60, z)
    side_l = ss(-0.13, 0.13, x)
    shin = leg * 0.30 * ss(0.55, 0.20, z) * (0.4 + 0.6 * ss(-0.05, 0.12, y))
    th = leg - shin
    return {"hips": 1 - leg, "thigh.L": th * side_l, "thigh.R": th * (1 - side_l),
            "shin.L": shin * side_l, "shin.R": shin * (1 - side_l)}


def _w_sleeves(P, J):
    out = {}
    for s, sx in (("L", 1.0), ("R", -1.0)):
        m = (P[:, 0] * sx > 0).astype(float)
        j, e = J[f"upper_arm.{s}"]
        u = unit(e - j)
        lu = float(np.linalg.norm(e - j))
        d = (P - j) @ u
        wsh = 1 - ss(-0.06, 0.06, d)
        wf = ss(lu - 0.10, lu + 0.02, d) * (0.5 if s == "R" else 0.85)   # the bag below the elbow half on the forearm
        wu = np.clip(1 - wsh - wf, 0, 1)
        out[f"shoulder.{s}"] = wsh * m
        out[f"upper_arm.{s}"] = wu * m
        out[f"forearm.{s}"] = wf * m
    return out


def _w_forearms(P, J):
    out = {}
    for s, sx in (("L", 1.0), ("R", -1.0)):
        m = (P[:, 0] * sx > 0).astype(float)
        e, w = J[f"forearm.{s}"]
        u = unit(w - e)
        lf = float(np.linalg.norm(w - e))
        d = (P - e) @ u
        wu = 1 - ss(-0.04, 0.05, d)
        wh = ss(lf - 0.01, lf + 0.03, d)
        wf = np.clip(1 - wu - wh, 0, 1)
        out[f"upper_arm.{s}"] = wu * m
        out[f"forearm.{s}"] = wf * m
        out[f"hand.{s}"] = wh * m
    return out


def _w_boots(P, J):
    out = {}
    for s, sx in (("L", 1.0), ("R", -1.0)):
        m = (P[:, 0] * sx > 0).astype(float)
        knee, ankle = J[f"shin.{s}"]
        ball = J[f"toe.{s}"][0]
        z = P[:, 2]
        wsh = ss(ankle[2] + 0.02, ankle[2] + 0.10, z)
        d = (ball - ankle) * np.array([1.0, 1.0, 0.0])
        d /= max(float(np.linalg.norm(d)), 1e-6)
        sb = (P - ball) @ d
        rest = np.clip(1 - wsh, 0, 1)
        wto = ss(-0.015, 0.025, sb) * rest
        out[f"shin.{s}"] = wsh * m
        out[f"foot.{s}"] = (rest - wto) * m
        out[f"toe.{s}"] = wto * m
    return out


WEIGHTS = {"torso": _w_torso, "sash": _w_sash, "cowl": _w_cowl, "skirt": _w_skirt, "sleeves": _w_sleeves,
           "forearms": _w_forearms, "boots": _w_boots}


def _bind_weights(arm, obj, how) -> None:
    me = obj.data
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    mw = np.array(obj.matrix_world)
    P = co.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3]
    J = {b.name: (np.array(b.head_local), np.array(b.tail_local)) for b in arm.data.bones}
    W = WEIGHTS[how](P, J)
    tot = np.maximum(sum(W.values()), 1e-6)
    obj.vertex_groups.clear()
    for name, w in W.items():
        w = w / tot
        idx = np.nonzero(w > 2e-3)[0]
        if not len(idx):
            continue
        g = obj.vertex_groups.new(name=name)
        for i in idx:
            g.add([int(i)], float(w[i]), "REPLACE")
    _mesh.add_armature_modifier(obj, arm)
    _mesh.parent_keep(obj, arm)
    _mesh.limit_weights(obj)


_orig_bind_part = _pipeline.bind_part


def _bind_part(ctx, part, obj, body_low=None):
    b = part.bind
    if isinstance(b, tuple) and b[0] == "weights":
        _bind_weights(ctx.info.armature, obj, b[1])
        return {}
    return _orig_bind_part(ctx, part, obj, body_low)


_pipeline.bind_part = _bind_part


# ── paint (project.paint wrapper) ──────────────────────────────────────────────────────────────────────
PROC = ("halo_ring", "halo_clasps", "bells", "bell_hooks", "clapper_stems", "rod_shaft", "rod_grip", "rod_collar",
        "striker", "wrist_cord", "wrist_bell")
BACK_MATCH = 0.9           # how far each part's back projection moves onto its front's painted colour
VALUE_RAMP = [(0.0, 0.80), (0.20, 0.86), (0.45, 0.94), (0.70, 1.0), (1.0, 1.04)]     # z / 2.0 -> linear gain
HI_KNEE, HI_TOP = 0.56, 0.70   # linear luminance: a soft shoulder from L* 80 up to L* 87 (no large area over 86)
# per part (target median, hue strength, contrast gamma), applied after the projection; None = the painting's own
BASE_TONE: dict = {}
WARM = (1.035, 1.0, 0.90)
WARM_PARTS = ("hood", "cowl", "robe_top", "skirt", "sleeve_L", "sleeve_R", "sash", "mask", "visor_frame", "wrap_L",
              "wrap_R", "pauldron_R1", "pauldron_R2", "pauldron_R3", "pauldron_L1", "pauldron_L2", "pauldron_L3")


def _hex(h):
    return np.asarray(scene.hex_srgb(h), dtype=np.float32)


def _lin(c):
    return _project._lin(c)


def _srgb(c):
    return _project._srgb(c).astype(np.float32)


def _Y(lin):
    return lin @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def _tone(col, target_hex, strength=1.0, gamma=0.8):
    lin = _lin(col)
    Y = np.maximum(_Y(lin), 1e-5)
    Ym = float(np.median(Y))
    tgt = _lin(_hex(target_hex))
    Yt = max(float(_Y(tgt)), 1e-5)
    newY = Yt * np.power(Y / max(Ym, 1e-5), gamma)
    chroma = lin / Y[:, None] * (1 - strength) + (tgt / Yt)[None, :] * strength
    return _srgb(chroma * newY[:, None])


def _hi_cap(lin):
    Y = np.maximum(_Y(lin), 1e-6)
    hi = Y > HI_KNEE
    Y2 = Y.copy()
    Y2[hi] = HI_KNEE + (HI_TOP - HI_KNEE) * (1 - np.exp(-(Y[hi] - HI_KNEE) / (HI_TOP - HI_KNEE)))
    return lin * (Y2 / Y)[:, None]


def _fbm(P, f, o=3):
    return NOISE.fbm(P, f, o)


def _proj_sides(maps, plates, vis, names, eps=0.02, log=print):
    """project.paint's projection, the front and back colours kept apart (the shared code blends them)."""
    P, N, part = maps["P"], maps["N"], maps["part"]
    have = part >= 0
    fills = {}
    for side in ("front", "back"):
        pid = vis.part[side]
        s = vis.step
        small = plates.img[side][s // 2::s, s // 2::s][:pid.shape[0], :pid.shape[1]]
        for k in np.unique(part[have]):
            valid = pid == k
            if not valid.any():
                continue
            iy, ix = _project.nearest_index(valid)
            fills[(side, int(k))] = _project.blur(small[iy, ix], 1.0)
    idx = np.nonzero(have)
    p, n = P[idx], N[idx]
    k = part[idx].astype(np.int64)
    st = np.abs(n[:, 0]) / (np.abs(n[:, 0]) + np.abs(n[:, 1]) + 1e-6)
    ws = np.clip((st - 0.72) / 0.24, 0, 1)
    ws = (ws * ws * (3 - 2 * ws))[:, None]
    soft = {s_: _project.blur(plates.img[s_], 4.0) for s_ in ("front", "back")}
    cols = {}
    for side in ("front", "back"):
        px, py = plates.to_px(side, p[:, 0], p[:, 2])
        c = _project.bilinear(plates.img[side], px, py)
        c = c * (1 - ws) + _project.bilinear(soft[side], px, py) * ws
        dep, hid = vis.lookup(side, px, py)
        if side == "front":
            hidden = ~(p[:, 1] <= np.nan_to_num(dep, nan=1e9) + eps)
        else:
            hidden = ~(p[:, 1] >= np.nan_to_num(dep, nan=-1e9) - eps)
        for kk in np.unique(k[hidden]):
            f = fills.get((side, int(kk)))
            if f is None:
                continue
            sel = hidden & (k == kk)
            c[sel] = _project.bilinear(f, px[sel] / vis.step, py[sel] / vis.step)
        cols[side] = c
    wb = np.clip((n[:, 1] + 0.25) / 0.5, 0, 1)
    wb = wb * wb * (3 - 2 * wb)
    return idx, k, p, n, cols, wb


BACK_PARTS = ("hood", "cowl", "robe_top", "sash", "skirt", "sleeve_L", "sleeve_R", "neckwrap", "wrap_L", "wrap_R",
              "pauldron_R1", "pauldron_R2", "pauldron_R3", "pauldron_L1", "pauldron_L2", "pauldron_L3")


def _match_back(k, cols, wb, names, log):
    """The back sheet is painted in shadow: per cloth / stone part, the back projection's median (its cream class:
    no blue-grey panel, no dark hem) moves onto the front's."""
    fr, bk = _lin(cols["front"]), _lin(cols["back"])
    cf, cb = _classes(cols["front"])["coat"], _classes(cols["back"])["coat"]
    for kk in np.unique(k):
        if names[kk] not in BACK_PARTS:
            continue
        sel = k == kk
        f = sel & (wb < 0.25) & cf
        b = sel & (wb > 0.75) & cb
        if f.sum() < 150 or b.sum() < 150:
            continue
        mf = np.median(fr[f], axis=0)
        mb = np.median(bk[b], axis=0)
        gain = np.clip(mf / np.maximum(mb, 1e-4), 0.7, 2.4) ** BACK_MATCH
        bk[sel] = bk[sel] * gain
        log(f"  vashil back match {names[kk]}: gain {np.round(gain, 2).tolist()}")
    cols["back"] = _srgb(bk)


def _ring_paint(p, n):
    """the halo's chalk band: honed pale stone with grey veins, the underside and inner edge in shade"""
    base = _lin(_hex("#D8D2C3"))
    v = _fbm(p, 9.0)
    vein = np.clip(1 - np.abs(NOISE.fbm(p * np.array([1.0, 1.0, 3.0]), 5.0, 3)) * 9.0, 0, 1) ** 2
    c = base[None, :] * (1 + 0.10 * v)[:, None]
    c = c * (1 - 0.30 * vein)[:, None] + _lin(_hex("#9C978C"))[None, :] * (0.30 * vein)[:, None]
    q = p - HALO_C
    r = np.hypot(q[:, 0], q[:, 1])
    rad = np.stack([q[:, 0] / np.maximum(r, 1e-6), q[:, 1] / np.maximum(r, 1e-6)], 1)
    inward = np.clip(-(n[:, 0] * rad[:, 0] + n[:, 1] * rad[:, 1]), 0, 1)
    k = (1 - 0.40 * ss(-0.2, -0.8, n[:, 2])) * (1 - 0.18 * inward) * (1 + 0.06 * ss(0.3, 0.9, n[:, 2]))
    return c * k[:, None]


def _stone_paint(p, n, hexc, grain=0.12):
    c = _lin(_hex(hexc))[None, :] * (1 + grain * _fbm(p, 14.0))[:, None]
    k = (1 - 0.30 * ss(-0.2, -0.8, n[:, 2])) * (1 + 0.05 * ss(0.4, 0.9, n[:, 2]))
    return c * k[:, None]


def _glass_paint(p, n, axis_c, axis_u, H):
    """dawnglass: a cool pale top, a deeper body, a dark inner lip, a painted vertical sheen toward the camera"""
    q = p - axis_c
    s = np.clip(-(q @ axis_u) / H, 0, 1)                     # 0 at the crown -> 1 at the lip
    top, mid, lip = _lin(_hex("#D6E6F1")), _lin(_hex("#9DBBD6")), _lin(_hex("#5F86AC"))
    c = top[None, :] * (1 - ss(0.0, 0.55, s))[:, None] + mid[None, :] * ss(0.0, 0.55, s)[:, None]
    c = c * (1 - ss(0.80, 1.0, s))[:, None] + lip[None, :] * ss(0.80, 1.0, s)[:, None]
    view = unit((-0.25, -0.75, 0.6))
    sheen = ss(0.80, 0.97, n @ view)
    c = c + (_lin(_hex("#F2F7FA")) - c) * (0.55 * sheen)[:, None]
    under = ss(-0.3, -0.9, n[:, 2])
    return c * (1 - 0.45 * under)[:, None]


def _wood_paint(p, n):
    q = p - GRIP
    s = q @ ROD_U
    ref = unit(np.cross(ROD_U, (0, -1.0, 0.0)))
    th = np.arctan2(q @ np.cross(ROD_U, ref), q @ ref)
    grain = np.sin(th * 3.0 + s * 9.0 + 2.5 * NOISE(p * np.array([1, 1, 0.2]), 6.0)) * 0.5 + 0.5
    base = _lin(_hex("#A28B6F"))
    dark = _lin(_hex("#6E5A47"))
    c = base[None, :] * (1 - 0.35 * grain ** 3)[:, None] + dark[None, :] * (0.35 * grain ** 3)[:, None]
    knots = np.clip(NOISE.ridged(p, 11.0, 2) - 0.55, 0, 1) * 1.6
    return c * (1 - 0.35 * knots)[:, None] * (1 + 0.08 * _fbm(p, 30.0))[:, None]


def _leather_paint(p, n, hexc="#4A4440"):
    return _lin(_hex(hexc))[None, :] * (1 + 0.15 * _fbm(p, 40.0))[:, None]


def _striker_paint(p, n):
    c0 = rod_at(0.5 * (STRIKER[0] + STRIKER[1]))
    s = (p - c0) @ ROD_U
    c = _lin(_hex("#B5CDE0"))[None, :] * (1 + 0.25 * ss(-0.05, 0.06, s))[:, None]
    face = np.abs(n @ unit((-0.5, -0.8, 0.3)))
    c = c * (0.78 + 0.32 * face)[:, None]
    edge = ss(0.6, 0.9, np.abs(n @ ROD_U))
    return c * (1 - 0.25 * edge)[:, None]


def _hood_inside(p, n):
    """the hood's inside: deep shade toward the back of the opening (the painted dark gap round the face)"""
    c = np.array([0.0, 0.06, 1.74])
    dv = p - c
    dv /= np.maximum(np.linalg.norm(dv, axis=1, keepdims=True), 1e-6)
    inner = ss(0.05, -0.5, np.sum(n * dv, axis=1)) * ss(-0.02, -0.07, p[:, 1])
    return 1 - 0.78 * inner


def _paint(maps, plates, vis, names, tops=None, flat=None, eps=0.02, bleed=True, log=print):
    if "halo_ring" not in names:
        return _orig_paint(maps, plates, vis, names, tops=tops, flat=flat, eps=eps, bleed=bleed, log=log)
    P, N, part = maps["P"], maps["N"], maps["part"]
    size = maps["size"]
    out = np.zeros((size, size, 3), dtype=np.float32)
    idx, k, p, n, cols, wb = _proj_sides(maps, plates, vis, names, eps, log)
    _match_back(k, cols, wb, names, log)
    col = cols["front"] * (1 - wb[:, None]) + cols["back"] * wb[:, None]
    lin = _lin(col)

    def sel(name):
        if name not in names:
            return None
        m = k == names.index(name)
        return m if m.any() else None

    procs = {
        "halo_ring": lambda pp, nn: _ring_paint(pp, nn),
        "halo_clasps": lambda pp, nn: _stone_paint(pp, nn, "#B9B5AA", 0.10),
        "bells": None, "bell_hooks": lambda pp, nn: _stone_paint(pp, nn, "#5B5650", 0.1),
        "clapper_stems": lambda pp, nn: _stone_paint(pp, nn, "#3D434B", 0.1),
        "rod_shaft": _wood_paint, "rod_grip": lambda pp, nn: _leather_paint(pp, nn, "#4A4440"),
        "rod_collar": lambda pp, nn: _stone_paint(pp, nn, "#CFC9BA", 0.08), "striker": _striker_paint,
        "wrist_cord": lambda pp, nn: _leather_paint(pp, nn, "#4A4038"), "wrist_bell": None,
    }
    for name, fn in procs.items():
        m = sel(name)
        if m is None:
            continue
        if name == "bells":
            # each texel's own bell: the nearest bell axis
            angs = bell_angles(_N_BELLS[0])
            tops_ = np.array([ring_pt(a, z=BELL_TOP) for a in angs])
            pp = p[m]
            d = np.linalg.norm((pp[:, None, :2] - tops_[None, :, :2]), axis=2)
            j = np.argmin(d, axis=1)
            lin[m] = _glass_paint(pp, n[m], tops_[j], np.array([0.0, 0.0, 1.0]), BELL_H)
        elif name == "wrist_bell":
            top = W_L + np.array([0.048, -0.012, -0.040])
            lin[m] = _glass_paint(p[m], n[m], top, np.array([0.0, 0.0, 1.0]), 0.05)
        else:
            lin[m] = fn(p[m], n[m])
    # the hood's inside in shade; the face-plate's sides shaded by the hood
    m = sel("hood")
    if m is not None:
        lin[m] = lin[m] * _hood_inside(p[m], n[m])[:, None]
    m = sel("mask")
    if m is not None:
        pp = p[m]
        kk = 1 - 0.40 * ss(0.050, 0.088, np.abs(pp[:, 0]))
        lin[m] = lin[m] * kk[:, None]
    # the concept's cream (the sheet reads warm next to the cool blue-grey; lit in game it went white-grey): the
    # cream texels of the cloth and chalk parts a touch warmer in linear light (saturation stays under ~15 %)
    for name in WARM_PARTS:
        m = sel(name)
        if m is None:
            continue
        cream = _classes(_srgb(lin[m]))["coat"]
        sub = lin[m]
        sub[cream] = sub[cream] * np.array(WARM, dtype=np.float32)[None, :]
        lin[m] = sub
    for name, tone in BASE_TONE.items():
        m = sel(name)
        if m is not None and tone:
            lin[m] = _lin(_tone(_srgb(lin[m]), *tone))
    # the light-head / dark-feet ramp and the highlight cap on the painted body (not the rod: it is held at any height)
    body = np.ones(len(k), dtype=bool)
    for name in PROC:
        m = sel(name)
        if m is not None:
            body &= ~m
    zz = np.clip(p[:, 2] / 2.0, 0, 1)
    g = np.interp(zz, [a for a, _ in VALUE_RAMP], [b for _, b in VALUE_RAMP]).astype(np.float32)
    lin[body] = lin[body] * g[body][:, None]
    lin = _hi_cap(lin)
    out[idx] = _srgb(lin)
    out = _refill(out, maps, names, log)
    if bleed:
        iy, ix = _project.nearest_index(part >= 0)
        out = out[iy, ix]
        far = np.hypot(iy - np.arange(out.shape[0])[:, None], ix - np.arange(out.shape[1])[None, :]) > 3.0
        smooth = _project.blur(out, 6.0)
        out[far] = smooth[far]
        out = _project.blur(out, ATLAS_SOFTEN).astype(np.float32)
    return out


def _box(a, r):
    def along(x, axis):
        pad = [(0, 0)] * x.ndim
        pad[axis] = (r + 1, r)
        c = np.cumsum(np.pad(x, pad, mode="edge"), axis=axis, dtype=np.float64)
        n = x.shape[axis]
        hi = np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis)
        lo = np.take(c, np.arange(0, n), axis=axis)
        return ((hi - lo) / (2 * r + 1)).astype(np.float32)
    return along(along(a, 0), 1)


def _fill_atlas(out, own, bad):
    good = (own & ~bad).astype(np.float32)
    todo = own & bad
    for r in (2, 4, 8, 16, 32):
        if not todo.any():
            break
        num = _box(out * good[..., None], r)
        den = _box(good, r)
        s_ = todo & (den > 0.12)
        out[s_] = num[s_] / den[s_][:, None]
        todo &= ~s_
    return out


def _refill(out, maps, names, log):
    """Outlier texels refilled from their own part's good texels: the painted bells' blue on the hood's flanks and
    the cowl / robe tops (the model's halo is procedural, the sheet's bells are not on the body)."""
    P, part = maps["P"], maps["part"]
    for name, zmin in (("hood", 1.70), ("cowl", 1.45), ("sleeve_L", 1.30), ("sleeve_R", 1.30), ("robe_top", 1.40)):
        if name not in names:
            continue
        own = part == names.index(name)
        if not own.any():
            continue
        c = out[own]
        bluish = (c[:, 2] > c[:, 0] + 0.045) & (c.mean(1) > 0.45) & (P[own][:, 2] > zmin)
        if not bluish.any():
            continue
        bad = np.zeros_like(own)
        bad[own] = bluish
        out = _fill_atlas(out, own, bad)
        log(f"vashil paint: {name} {int(bluish.sum())} bluish texels refilled")
    return out


_orig_paint = _project.paint
_project.paint = _paint


# ── skins (project.recolour wrapper): painted classes -> the skin's colours ─────────────────────────────
CLASS_ROLE = {   # part -> {class: role}; classes: coat (cream), panel (blue-grey), band (dark)
    "skirt": {"coat": "chalk", "panel": "cloth", "band": "ironstone"},
    "robe_top": {"coat": "chalk", "panel": "cloth"},
    "sleeve_L": {"coat": "sleeve", "panel": "lining"}, "sleeve_R": {"coat": "sleeve", "panel": "lining"},
    "hood": {"coat": "chalk"}, "cowl": {"coat": "chalk"}, "mask": {"coat": "chalk"}, "visor_frame": {"coat": "chalk"},
    "halo_ring": {"coat": "chalk"},
    "pauldron_R1": {"coat": "stone"}, "pauldron_R2": {"coat": "stone"}, "pauldron_R3": {"coat": "stone"},
    "pauldron_L1": {"coat": "stone"}, "pauldron_L2": {"coat": "stone"}, "pauldron_L3": {"coat": "stone"},
    "sash": {"coat": "cloth2"}, "boots": {"coat": "leather", "band": "leather"}, "legs": {"coat": "under", "band": "under"},
    "neckwrap": {"coat": "ironstone", "band": "ironstone"},
}
SKIN_ROLES = {   # per skin: the derived roles the painting's classes move to
    "vashil_chalkline": {"cloth": "#3A3F47", "sleeve": "#3A3F47", "lining": "#2E3238", "cloth2": "#C9C9C1"},
    "vashil_first_bell": {"chalk": "#D8D2C4", "cloth": "#8D8A84", "lining": "#8D8A84", "stone": "#C9C4B8",
                          "ironstone": "#38363A", "under": "#34322F", "leather": "#3A332D"},
}


def _classes(c):
    lin = _lin(c)
    Y = _Y(lin)
    blue = c[:, 2] - c[:, 0]
    band = Y < 0.07
    panel = ~band & (blue > 0.035) & (Y < 0.40)
    return {"band": band, "panel": panel, "coat": ~band & ~panel}


def _shift(c, target_hex, strength=0.9, gamma=0.9):
    return _tone(c, target_hex, strength, gamma)


def _linework(P, n):
    """Chalkline: thin chalk lines drawn on the ink-grey cloth: bell outlines in rows, spire strokes, a sun."""
    th = np.arctan2(P[:, 0], -(P[:, 1] - 0.02))
    u = th * 0.30 / (2 * math.pi) * 6.0          # ~ metres round the body
    z = P[:, 2]
    row = 0.17
    zr = (z % row) / row
    cell = 0.12
    cx = (u % cell) / cell - 0.5
    rr = np.hypot(cx * 1.6, (zr - 0.35) * 1.2)
    bell = np.abs(rr - 0.32) < 0.035
    bell &= zr > 0.20
    spire = (np.abs(((u + 0.06 * np.floor(z / row)) % 0.24) - 0.12) < 0.004) & (zr < 0.55)
    return bell | spire


def _recolour(img, maps, names, roles, base_pal, skin_pal, skip=None, log=print):
    if "halo_ring" not in names:
        return _orig_recolour(img, maps, names, roles, base_pal, skin_pal, skip=skip, log=log)
    sid = next((s["id"] for s in SKINS if s["palette"] == skin_pal or all(skin_pal.get(k) == v for k, v in s["palette"].items())), None)
    tgt = SKIN_ROLES.get(sid, {})
    part = maps["part"]
    iy, ix = _project.nearest_index(part >= 0)
    pid = part[iy, ix]
    out = img.copy()
    Pm = maps["P"][iy, ix]
    for i, nm in enumerate(names):
        cr = CLASS_ROLE.get(nm)
        if not cr:
            continue
        m = pid == i
        if not m.any():
            continue
        c = out[m]
        cls = _classes(c)
        for cname, role in cr.items():
            h = tgt.get(role)
            sm = cls.get(cname)
            if not h or sm is None or sm.sum() < 20:
                continue
            c[sm] = _shift(c[sm], h)
            log(f"  vashil recolour {nm}.{cname} ({role}) -> {h}")
        if sid == "vashil_chalkline" and (nm.startswith("sleeve") or nm in ("skirt", "robe_top")):
            ink = cls["panel"] | (cls["coat"] if nm.startswith("sleeve") else np.zeros_like(cls["coat"]))
            lw = _linework(Pm[m], None) & ink
            c[lw] = _hex("#E6E0D2") * 0.92
            log(f"  vashil linework {nm}: {100 * lw.sum() / max(1, ink.sum()):.1f}% of the ink cloth")
        out[m] = c
    return out.astype(np.float32)


_orig_recolour = _project.recolour
_project.recolour = _recolour


# ── prop.R location tracks (Kemdo's wrappers): the rod slides through the fist ─────────────────────────
_orig_basis = anim.Skeleton.basis


def _basis(self, pose, b):
    m = _orig_basis(self, pose, b)
    if b == "prop.R":
        loc = pose.get("prop.R_loc")
        if loc is not None:
            m = Matrix.Translation(V(tuple(loc))) @ m
    return m


anim.Skeleton.basis = _basis
_orig_write_action = anim.write_action


def _write_action(arm, name, poses, bones=None):
    act = _orig_write_action(arm, name, poses, bones)
    if "prop.R" not in arm.data.bones or not any("prop.R_loc" in p for p in poses):
        return act
    strip = act.layers[0].strips[0]
    cb = strip.channelbag(act.slots[0], ensure=True)
    n = len(poses)
    for i in range(3):
        fc = anim._new_fcurve(cb, 'pose.bones["prop.R"].location', i, "prop.R")
        vals = [float(p.get("prop.R_loc", (0.0, 0.0, 0.0))[i]) for p in poses]
        fc.keyframe_points.add(n)
        fc.keyframe_points.foreach_set("co", [c for f, v in zip(range(n), vals) for c in (f, v)])
        fc.keyframe_points.foreach_set("interpolation", [1] * n)
        fc.update()
    return act


anim.write_action = _write_action
_orig_apply_pose = anim.apply_pose


def _apply_pose(arm, pose):
    _orig_apply_pose(arm, pose)
    loc = pose.get("prop.R_loc") if pose else None
    if loc is not None and "prop.R" in arm.pose.bones:
        arm.pose.bones["prop.R"].location = tuple(loc)
        bpy.context.view_layer.update()


anim.apply_pose = _apply_pose


# ── the foot roll (anim._solve_foot, wrapped by a corrected copy) ──────────────────────────────────────
# The shared solver rotates the foot by -pitch about its local X (~ -X world), which turns the toes DOWN for a
# positive pitch (the doc: + toes up): Vashil's light 16-frame run dipped the ankle 4 cm on the toe-off frame and the
# three load test found no planted frames. Here the pitch follows the doc: + toes up about the heel, - heel up about
# the ball (the run's heel-strike and toe-off rolls, the kneel on the toes).
def _solve_foot(skel, pose, M, side, ft):
    foot, toe = f"foot.{side}", f"toe.{side}"
    rest_f = skel.rest[foot]
    ankle0 = rest_f.translation.copy()
    ball0 = skel.rest[toe].translation.copy()
    heel0 = ankle0 + V((0, 0, -ankle0.z)) + (ankle0 - ball0) * V((1, 1, 0)) * 0.55
    off = V(ft.ankle)
    lat = rest_f.to_3x3().col[0].normalized()
    rot = Matrix.Rotation(math.radians(ft.yaw), 3, "Z") @ Matrix.Rotation(math.radians(ft.pitch), 3, lat)
    pivot = (heel0 if ft.pitch > 0 else ball0) + off
    ankle_t = pivot + rot @ (ankle0 + off - pivot)
    knee_dir = Matrix.Rotation(math.radians(ft.yaw + ft.knee), 3, "Z") @ V((0, -1, 0))
    hips_fwd = M["hips"].to_3x3() @ (skel.rest["hips"].to_3x3().inverted() @ V((0, -1, 0)))
    hips_fwd.z = 0
    if hips_fwd.length > 1e-4:
        knee_dir = (knee_dir + hips_fwd.normalized()).normalized()
    end_frame = rot @ rest_f.to_3x3()
    skel.solve_two_bone(pose, M, f"thigh.{side}", f"shin.{side}", foot, ankle_t, knee_dir, True, end_frame, ft.weight)
    t = pose.get(toe, (0.0, 0.0, 0.0))
    toe_counter = -ft.pitch if ft.pitch < 0 else 0.0
    pose[toe] = (t[0] + (toe_counter + ft.toe) * ft.weight, t[1], t[2])


anim._solve_foot = _solve_foot


# ── motion (brief §8) ─────────────────────────────────────────────────────────────────────────────────
# Arms are IK: wrist targets `rel` to the posed shoulder in arm lengths (chest frame: +X his left, -Y front, +Z up),
# `aim` = the rod's axis (prop.R +Y up the rod to the striker), the left hand grips the rod with to_prop
# ("prop.R", along) measured from the prop's origin (which slides with the rod: along = -slide + offset).
GUARD_R = tuple(np.round((W_R - SH_R) / ARM, 4))
GUARD_L = tuple(np.round((W_L - SH_L) / ARM, 4))
UP = tuple(np.round(ROD_U, 4))
def _pole(S, E, W):
    d = unit(W - S)
    v = (E - S) - d * float((E - S) @ d)
    return tuple(np.round(unit(v), 3))


POLE_R = _pole(SH_R, E_R, W_R)            # the rest elbows (the IK reproduces the concept carry exactly)
POLE_L = _pole(SH_L, E_L, W_L)
POLE_RF = (-0.45, 0.25, -0.86)            # the right elbow out and down once the hand leaves the carry
HALO_LEVEL = 0.6                          # share of the body's pitch / roll the floating halo takes back (sits level)
BLOCKS = {
    "guard": (GUARD_R, POLE_R, UP, GUARD_L, POLE_L),
    "run_fwd": ((-0.30, -0.52, -0.52), POLE_R, (-0.08, -0.42, 0.90), (0.06, -0.42, -0.86), POLE_L),
    "run_back": ((-0.34, -0.40, -0.58), POLE_R, (-0.08, -0.48, 0.87), (0.10, 0.22, -0.92), POLE_L),
    "stunned": ((-0.34, -0.30, -0.70), POLE_R, (-0.20, -0.10, 0.97), (0.10, -0.10, -0.95), POLE_L),
    "dash": ((-0.30, -0.50, -0.50), POLE_R, (-0.05, -0.62, 0.78), (0.15, 0.30, -0.85), POLE_L),
    "channel": ((-0.25, -0.70, -0.25), POLE_R, (-0.05, -0.35, 0.94), (0.05, -0.85, -0.25), POLE_L),
    "lobby": (GUARD_R, POLE_R, UP, GUARD_L, POLE_L),
    "victory": (GUARD_R, POLE_R, UP, GUARD_L, POLE_L),
    "recall": (GUARD_R, POLE_R, UP, GUARD_L, POLE_L),
}
MOTION = anim.motion_profile(weight="light", weapon="one_hand", stance="neutral", run_ref_speed=3.35, blocks=BLOCKS,
                             arm_swing=0.8)
P_ = anim.P
FPS = anim.FPS


def _feet(l=(0.0, 0.0, 0.0), r=(0.0, 0.0, 0.0), yl=0.0, yr=0.0, pl=0.0, pr=0.0, wl=1.0, wr=1.0):
    return {"foot.L": FootTarget(tuple(l), pl, yl, 0.0, 0.0, wl), "foot.R": FootTarget(tuple(r), pr, yr, 0.0, 0.0, wr)}


def pose(torso=None, hips=(0.0, 0.0, 0.0), R=GUARD_R, Rp=None, aim=UP, L=GUARD_L, Lp=POLE_L, grip=None,
         feet=None, halo=(0.0, 0.0, 0.0), slide=0.0, fk=None) -> dict:
    """A full pose: torso rotations (deg), hips_loc offset, the right wrist + rod aim, the left wrist (or `grip`: the
    left hand on the rod at `grip` m from the right fist toward the striker), feet, the halo's rock, the rod's slide."""
    t = dict(hips=(0.0, 0.0, 0.0), spine=(0.0, 0.0, 0.0), chest=(0.0, 0.0, 0.0), neck=(0.0, 0.0, 0.0), head=(0.0, 0.0, 0.0))
    t.update(torso or {})
    p = P_(**t)
    p["x_halo"] = tuple(halo)
    p["hips_loc"] = (hips[0], hips[1], -0.006 + hips[2])
    p["prop.R_loc"] = (0.0, float(slide), 0.0)
    ik = {}
    ik.update(feet or _feet())
    if Rp is None:
        Rp = POLE_R if tuple(R) == tuple(GUARD_R) else POLE_RF
    ik["hand.R"] = HandTarget(rel=tuple(R), pole=tuple(Rp))
    ik["aim.R"] = Aim(tuple(aim))
    if grip is not None:
        ik["hand.L"] = HandTarget(to_prop=("prop.R", -float(slide) + float(grip)), pole=(0.8, 0.4, -0.4))
    else:
        ik["hand.L"] = HandTarget(rel=tuple(L), pole=tuple(Lp))
    p["ik"] = ik
    if fk:
        p.update(P_(**fk))
    return p


def ring(t, t0, amp, frames, decay=0.30, hz=2.6, axis=(1.0, 0.0, 0.0)):
    """the halo's ringing after a strike at t0: a decaying rock (degrees about the halo bone's local axes)"""
    if t < t0:
        return (0.0, 0.0, 0.0)
    s = (t - t0) * frames / FPS
    v = amp * math.exp(-s / decay) * math.sin(2 * math.pi * hz * s)
    return tuple(v * a for a in axis)


def with_halo(fn, rings, frames):
    def sample(t):
        p = fn(t)
        h = p.get("x_halo", (0.0, 0.0, 0.0))
        for t0, amp, axis in rings:
            r = ring(t, t0, amp, frames, axis=axis)
            h = (h[0] + r[0], h[1] + r[1], h[2] + r[2])
        p = dict(p)
        p["x_halo"] = h
        return p
    return sample


def level(fn):
    """The halo floats: it takes back HALO_LEVEL of the summed hips..head pitch and roll, so it stays near level
    through bows, kneels and stuns (the authored rocks ride on top)."""
    def sample(t):
        p = dict(fn(t))
        sx = sum(p.get(b, (0.0, 0.0, 0.0))[0] for b in ("hips", "spine", "chest", "neck", "head"))
        sz = sum(p.get(b, (0.0, 0.0, 0.0))[2] for b in ("hips", "spine", "chest", "neck", "head"))
        h = p.get("x_halo", (0.0, 0.0, 0.0))
        p["x_halo"] = (h[0] - HALO_LEVEL * sx, h[1], h[2] - HALO_LEVEL * sz)
        return p
    return sample


def clip_overrides(ctx) -> dict:
    """Brief §8: four distinct ability gestures, bespoke basics, impact at exactly 40 % of attacks / casts.
      attack1   a tap of the rod head forward (20 f, f8)
      attack2   tap-and-twirl: the head circles once and taps forward-down (20 f, f8)
      cast_a1   Peal: the rod lifted overhead, its head drawing a wide circle, the strike at f10, the left hand open
                to the target, the halo rocked (25 f)
      cast_a2   Glass Chime: a fast flick, the rod sliding forward through the fist like a cue, snapped back (15 f, f6)
      cast_a3   Ring Out: the left hand joins, both hands near the butt, a horizontal sweep across the front, the
                centre of the arc at f8, the shoulders turning (20 f)
      cast_ult  Morning Toll: the rod raised high in both hands, head back (the halo tilts up, the bells sway in turn),
                at f16 the striker brought down onto the ground like a hammer on a bell, held to f30, lifted (40 f)
    """
    skel = anim.Skeleton(ctx.info.armature)
    G = pose()
    out = {}

    def clip(name, N, keys, impact=None, loop=False, rings=(), lags=None):
        fn = anim.keyed(keys)
        if lags:
            fn = anim.drag(fn, N, lags, loop=loop)
        if rings:
            fn = with_halo(fn, rings, N)
        return anim.Clip(name, N, loop, fn, impact=impact)

    def breathe(fn, amp=1.0, cycles=2, phase=0.0):
        def s(t):
            p = dict(fn(t))
            b = math.sin(2 * math.pi * (cycles * t + phase))
            p["chest"] = tuple(np.add(p.get("chest", (0, 0, 0)), (1.0 * amp * b, 0, 0)))
            p["neck"] = tuple(np.add(p.get("neck", (0, 0, 0)), (-0.6 * amp * b, 0, 0)))
            return p
        return s

    # IDLE: upright, breathing, the halo swaying a degree, the free hand drifting
    def idle_s(t):
        b = math.sin(2 * math.pi * 2 * t)
        s = math.sin(2 * math.pi * t)
        p = pose(torso=dict(hips=(0, 0.8 * s, -0.6 * s), spine=(0.4 * b, 0, 0.4 * s), chest=(0.9 * b, 0.6 * s, 0),
                            neck=(-0.5 * b, 0, 0), head=(-0.3 * b, 1.2 * s, 0.5 * s)),
                 hips=(0.006 * s, 0, -0.003 * (0.5 + 0.5 * b)),
                 L=(GUARD_L[0] + 0.012 * s, GUARD_L[1] - 0.01 * b, GUARD_L[2]),
                 halo=(0.8 * math.sin(2 * math.pi * t + 0.6), 0.0, 1.1 * math.sin(2 * math.pi * t)))
        return p
    out["idle"] = anim.Clip("idle", 72, True, idle_s)

    # RUN: the generator's planted gait, the rod carried leaning forward; the halo rocks with the bob
    run = anim.gen_run(MOTION)

    def run_s(t):
        p = dict(run.sample(t))
        p["x_halo"] = (2.0 * math.sin(4 * math.pi * t + 0.8), 0.0, 1.5 * math.sin(2 * math.pi * t + 0.4))
        return p
    out["run"] = anim.Clip("run", run.frames, True, run_s, meta=run.meta)

    # ATTACK1: a tap of the rod head forward (the bolt leaves at f8)
    w1 = pose(torso=dict(chest=(-3, -6, 0), head=(-2, 4, 0)), R=(-0.37, -0.28, -0.60), aim=(-0.10, 0.30, 0.95))
    h1 = pose(torso=dict(hips=(2, 6, 0), spine=(3, 5, 0), chest=(5, 8, 0), head=(-4, -6, 0)), hips=(0, -0.02, -0.01),
              R=(-0.28, -0.66, -0.42), aim=(-0.05, -0.80, 0.60), L=(0.10, -0.25, -0.92))
    f1 = pose(torso=dict(hips=(2, 7, 0), spine=(3, 6, 0), chest=(6, 9, 0), head=(-5, -7, 0)), hips=(0, -0.02, -0.012),
              R=(-0.27, -0.68, -0.44), aim=(-0.05, -0.84, 0.54), L=(0.10, -0.22, -0.93))
    out["attack1"] = anim.Clip("attack1", 20, False, with_halo(anim.drag(anim.keyed(anim.strike_keys(MOTION, w1, h1, f1, G)),
                                                                         20, {"head": 1.5, "neck": 1.0}),
                                                               [(0.4, 2.5, (1, 0, 0))], 20), impact=0.4)
    # ATTACK2: tap-and-twirl (the head circles out, back and over, then taps forward-down at f8)
    k2 = [(0.0, G, "linear"),
          (0.12, pose(torso=dict(chest=(-2, -8, 0)), R=(-0.40, -0.36, -0.52), aim=(-0.62, -0.20, 0.76)), "inout"),
          (0.22, pose(torso=dict(chest=(-4, -10, 0), head=(-3, 5, 0)), R=(-0.36, -0.30, -0.42), aim=(-0.15, 0.62, 0.77)), "inout"),
          (0.30, pose(torso=dict(chest=(-5, -11, 0), head=(-4, 6, 0)), R=(-0.34, -0.28, -0.36), aim=(0.20, 0.45, 0.87)), "out"),
          (0.40, pose(torso=dict(hips=(3, 8, 0), spine=(4, 6, 0), chest=(7, 10, 0), head=(-5, -7, 0)), hips=(0, -0.025, -0.015),
                      R=(-0.26, -0.70, -0.36), aim=(-0.05, -0.93, 0.36), L=(0.14, -0.30, -0.88)), "accel"),
          (0.48, pose(torso=dict(hips=(3, 9, 0), spine=(4, 7, 0), chest=(7, 11, 0), head=(-6, -8, 0)), hips=(0, -0.025, -0.02),
                      R=(-0.26, -0.71, -0.37), aim=(-0.05, -0.94, 0.33), L=(0.14, -0.28, -0.89)), "out"),
          (0.75, pose(torso=dict(chest=(2, 3, 0)), R=(-0.33, -0.48, -0.56), aim=(-0.07, -0.25, 0.96)), "inout"),
          (1.0, G, "settle")]
    out["attack2"] = clip("attack2", 20, k2, impact=0.4, rings=[(0.40, 3.0, (1, 0, 0.4))], lags={"head": 1.5, "neck": 1.0})

    # CAST_A1 Peal: lift, circle, strike (f10), the halo rocking, the left hand opening to the target
    lift = dict(spine=(-2, 0, 0), chest=(-5, -4, 0), neck=(-2, 0, 0), head=(-4, 3, 0))
    k = [(0.0, G, "linear"),
         (0.08, pose(torso=lift, R=(-0.32, -0.42, -0.25), aim=(-0.10, -0.20, 0.97), hips=(0, 0, 0.01)), "inout"),
         (0.16, pose(torso=lift, R=(-0.22, -0.38, 0.22), aim=(-0.50, -0.30, 0.81)), "inout"),
         (0.22, pose(torso=lift, R=(-0.18, -0.46, 0.26), aim=(-0.05, -0.62, 0.78)), "linear"),
         (0.28, pose(torso=lift, R=(-0.14, -0.40, 0.30), aim=(0.48, -0.28, 0.83)), "linear"),
         (0.34, pose(torso=dict(spine=(-3, 0, 0), chest=(-7, -6, 0), head=(-6, 4, 0)), R=(-0.18, -0.30, 0.36),
                     aim=(0.06, 0.18, 0.98)), "out"),
         (0.40, pose(torso=dict(hips=(3, 4, 0), spine=(5, 4, 0), chest=(9, 6, 0), neck=(-3, 0, 0), head=(-6, -4, 0)),
                     hips=(0, -0.03, -0.015), R=(-0.20, -0.78, 0.06), aim=(-0.05, -0.85, 0.52), L=(0.12, -0.80, -0.22),
                     Lp=(0.8, 0.3, -0.4)), "accel"),
         (0.50, pose(torso=dict(hips=(3, 5, 0), spine=(5, 5, 0), chest=(9, 7, 0), neck=(-3, 0, 0), head=(-7, -4, 0)),
                     hips=(0, -0.03, -0.02), R=(-0.20, -0.79, 0.02), aim=(-0.05, -0.88, 0.47), L=(0.13, -0.82, -0.20),
                     Lp=(0.8, 0.3, -0.4)), "out"),
         (0.66, pose(torso=dict(chest=(4, 3, 0), head=(-3, -2, 0)), R=(-0.26, -0.62, -0.20), aim=(-0.06, -0.55, 0.83),
                     L=(0.12, -0.50, -0.60)), "inout"),
         (0.84, pose(R=(-0.34, -0.42, -0.55), aim=(-0.08, -0.15, 0.98), L=(0.13, -0.20, -0.90)), "inout"),
         (1.0, G, "settle")]
    out["cast_a1"] = clip("cast_a1", 25, k, impact=0.4, rings=[(0.40, 5.0, (1, 0, 0.3))], lags={"head": 1.5, "neck": 1.0})

    # CAST_A2 Glass Chime: the rod slides forward through the fist like a cue and snaps back (f6); the body still
    k = [(0.0, G, "linear"),
         (0.20, pose(torso=dict(chest=(-2, -3, 0)), R=(-0.37, -0.30, -0.58), aim=(-0.10, 0.20, 0.97), slide=-0.04), "inout"),
         (0.40, pose(torso=dict(hips=(1, 3, 0), chest=(3, 5, 0), head=(-2, -3, 0)), hips=(0, -0.015, -0.006),
                     R=(-0.24, -0.80, -0.30), aim=(-0.05, -0.97, 0.24), slide=0.34, L=(0.12, -0.20, -0.92)), "accel"),
         (0.52, pose(torso=dict(hips=(1, 3, 0), chest=(3, 5, 0), head=(-2, -3, 0)), R=(-0.30, -0.55, -0.50),
                     aim=(-0.07, -0.40, 0.91), slide=0.05), "snap"),
         (0.75, pose(R=(-0.35, -0.42, -0.60), aim=(-0.08, -0.10, 0.99)), "inout"),
         (1.0, G, "settle")]
    out["cast_a2"] = clip("cast_a2", 15, k, impact=0.4, rings=[(0.42, 3.5, (1, 0, -0.3))])

    # CAST_A3 Ring Out: both hands near the butt, a horizontal sweep across the front (the arc's centre at f8)
    S = 0.95
    coil = dict(hips=(2, -16, 0), spine=(2, -12, 0), chest=(3, -18, 0), neck=(0, 6, 0), head=(-2, 14, 0))
    w = pose(torso=coil, hips=(0, 0.02, -0.03), R=(-0.12, -0.42, -0.70), aim=(-0.86, 0.28, 0.42), slide=S, grip=0.13,
             feet=_feet(l=(0.0, -0.06, 0.0), yl=6.0))
    reach_l = anim.resolve(skel, dict(w))                      # where the left hand meets the rod at the wind
    Ml = skel.fk(reach_l)
    shl = Ml["upper_arm.L"].translation
    Rc = Ml["chest"].to_3x3() @ skel.rest["chest"].to_3x3().inverted()
    wl = Rc.inverted() @ (Ml["hand.L"].translation - shl) / ARM
    pre = pose(torso=dict(hips=(1, -8, 0), spine=(1, -6, 0), chest=(2, -9, 0), head=(-1, 7, 0)), hips=(0, 0.01, -0.015),
               R=(-0.24, -0.45, -0.62), aim=(-0.60, 0.10, 0.79), slide=S * 0.6, L=tuple(wl), Lp=(0.8, 0.4, -0.4))
    hit = pose(torso=dict(hips=(4, 10, 0), spine=(4, 8, 0), chest=(6, 12, 0), neck=(0, -4, 0), head=(-4, -10, 0)),
               hips=(0, -0.04, -0.05), R=(0.20, -0.74, -0.52), aim=(0.02, -0.98, 0.20), slide=S, grip=0.13,
               feet=_feet(l=(0.0, -0.08, 0.0), r=(0.0, 0.04, 0.0), yl=10.0, yr=-4.0))
    fol = pose(torso=dict(hips=(4, 26, 0), spine=(4, 18, 0), chest=(6, 26, 0), neck=(0, -8, 0), head=(-4, -18, 0)),
               hips=(0, -0.04, -0.05), R=(0.42, -0.58, -0.48), aim=(0.88, -0.42, 0.22), slide=S, grip=0.13,
               feet=_feet(l=(0.0, -0.08, 0.0), r=(0.0, 0.04, 0.0), yl=14.0, yr=-2.0))
    rel_ = pose(torso=dict(hips=(1, 8, 0), chest=(2, 8, 0), head=(-1, -5, 0)), R=(-0.30, -0.48, -0.55),
                aim=(-0.10, -0.25, 0.96), slide=0.25, L=(0.20, -0.40, -0.82))
    k = [(0.0, G, "linear"), (0.12, pre, "inout"), (0.26, w, "inout"),
         (0.32, anim.lerp_pose_w(w, hit, 0.15, {"hips": 0.5, "spine": 0.4, "chest": 0.25, "hips_loc": 0.4}), "out"),
         (0.40, hit, "accel"), (0.47, anim.lerp_pose(hit, fol, 0.35), "out"), (0.60, fol, "out"),
         (0.80, rel_, "inout"), (1.0, G, "settle")]
    out["cast_a3"] = clip("cast_a3", 20, k, impact=0.4, rings=[(0.36, 6.0, (0, 0, -1)), (0.62, 3.0, (0, 0, 1))],
                          lags={"head": 1.0, "neck": 0.5})

    # CAST_ULT Morning Toll: raised high in both hands, head back (f0-f12, breathing, the bells swaying in turn),
    # brought down (f16) like a hammer on a great bell, held grounded to f30, lifted
    S = 0.95
    up_t = dict(hips=(-2, 0, 0), spine=(-4, 0, 0), chest=(-8, 0, 0), neck=(-8, 0, 0), head=(-14, 0, 0))
    raise_ = pose(torso=up_t, hips=(0, 0.02, 0.01), R=(0.22, -0.74, 0.50), aim=(0.0, -0.30, 0.95), slide=S, grip=0.15,
                  halo=(-6, 0, 0))
    reach_l = anim.resolve(skel, dict(raise_))
    Ml = skel.fk(reach_l)
    Rc = Ml["chest"].to_3x3() @ skel.rest["chest"].to_3x3().inverted()
    wl = Rc.inverted() @ (Ml["hand.L"].translation - Ml["upper_arm.L"].translation) / ARM
    pre = pose(torso=dict(chest=(-3, 0, 0), head=(-4, 0, 0)), R=(-0.05, -0.62, 0.05), aim=(-0.04, -0.20, 0.98),
               slide=S * 0.7, L=tuple(wl), Lp=(0.8, 0.4, -0.4), halo=(-2, 0, 0))
    raise2 = pose(torso=dict(hips=(-3, 0, 0), spine=(-5, 0, 0), chest=(-9, 0, 0), neck=(-9, 0, 0), head=(-16, 0, 0)),
                  hips=(0, 0.025, 0.012), R=(0.22, -0.72, 0.54), aim=(0.0, -0.26, 0.97), slide=S, grip=0.15, halo=(-7, 0, 0))
    back = pose(torso=dict(hips=(-4, 0, 0), spine=(-6, 0, 0), chest=(-11, 0, 0), neck=(-6, 0, 0), head=(-10, 0, 0)),
                hips=(0, 0.03, 0.015), R=(0.20, -0.56, 0.70), aim=(0.0, 0.40, 0.92), slide=S, grip=0.15, halo=(-5, 0, 0))
    strike = pose(torso=dict(hips=(12, 0, 0), spine=(12, 0, 0), chest=(10, 0, 0), neck=(-6, 0, 0), head=(-8, 0, 0)),
                  hips=(0, -0.06, -0.10), R=(0.22, -0.80, -0.48), aim=(0.0, -0.79, -0.61), slide=S, grip=0.15,
                  feet=_feet(l=(0.0, -0.16, 0.0), r=(0.0, 0.05, 0.0), yl=6.0, yr=-8.0), halo=(4, 0, 0))
    held = pose(torso=dict(hips=(13, 0, 0), spine=(13, 0, 0), chest=(11, 0, 0), neck=(-7, 0, 0), head=(-9, 0, 0)),
                hips=(0, -0.065, -0.11), R=(0.22, -0.80, -0.50), aim=(0.0, -0.78, -0.62), slide=S, grip=0.15,
                feet=_feet(l=(0.0, -0.16, 0.0), r=(0.0, 0.05, 0.0), yl=6.0, yr=-8.0), halo=(3, 0, 0))
    lift2 = pose(torso=dict(chest=(2, 0, 0)), R=(-0.20, -0.62, -0.40), aim=(-0.05, -0.40, 0.91), slide=0.35,
                 L=(0.15, -0.40, -0.80))
    k = [(0.0, G, "linear"), (0.10, pre, "inout"), (0.20, raise_, "inout"), (0.29, raise2, "inout"),
         (0.34, back, "out"), (0.40, strike, "accel"), (0.46, held, "out"), (0.75, held, "linear"),
         (0.88, lift2, "inout"), (1.0, G, "settle")]
    sway = [(0.12 + 0.04 * i, 2.2, (0.3 * (-1) ** i, 0, 1.0 * (-1) ** i)) for i in range(4)]
    out["cast_ult"] = clip("cast_ult", 40, k, impact=0.4, rings=sway + [(0.40, 7.0, (1, 0, 0.3)), (0.55, 4.0, (0.3, 0, 1)),
                                                                          (0.66, 3.0, (1, 0, -0.4))],
                           lags={"head": 1.0, "neck": 0.5})

    # DEATH: rings the rod once on the ground, sinks to his knees, the halo tilting, the rod across his lap
    hip_h = skel.rest_point("hips").z
    tap_up = pose(R=(-0.34, -0.38, -0.50), aim=UP, halo=(0, 0, 0))
    tap = pose(torso=dict(chest=(3, 0, 0), head=(4, 0, 0)), hips=(0, 0, -0.01))
    sag = pose(torso=dict(hips=(-4, 4, 2), spine=(8, 0, 2), chest=(10, 4, 3), neck=(8, 0, 0), head=(12, 6, 4)),
               hips=(0.02, 0.06, -0.20), R=(-0.30, -0.45, -0.62), aim=(-0.20, -0.30, 0.93), L=(0.16, -0.15, -0.90),
               halo=(3, 0, 6))
    kfeet = _feet(l=(0.0, 0.42, 0.045), r=(0.0, 0.44, 0.045), yl=4.0, yr=-6.0, pl=-55.0, pr=-55.0)
    kneel = pose(torso=dict(hips=(4, 4, 0), spine=(5, 0, 3), chest=(6, 4, 4), neck=(8, 0, 0), head=(10, 8, 6)),
                 hips=(0.02, 0.05, -(hip_h - 0.585)), R=(0.10, -0.62, -0.72), aim=(0.97, -0.20, -0.08), slide=0.22,
                 L=(-0.10, -0.55, -0.78), feet=kfeet, halo=(6, 0, 10))
    slump = pose(torso=dict(hips=(5, 4, 0), spine=(7, 0, 3), chest=(8, 4, 5), neck=(10, 0, 0), head=(14, 10, 8)),
                 hips=(0.02, 0.06, -(hip_h - 0.575)), R=(0.10, -0.60, -0.74), aim=(0.97, -0.20, -0.10), slide=0.22,
                 L=(-0.10, -0.52, -0.80), feet=kfeet, halo=(8, 0, 12))
    k = [(0.0, G, "linear"), (0.10, tap_up, "inout"), (0.18, tap, "accel"), (0.30, sag, "inout"),
         (0.56, kneel, "in"), (0.64, anim.lerp_pose(kneel, slump, 1.15), "out"), (0.80, slump, "inout"), (1.0, slump, "linear")]
    out["death"] = clip("death", 50, k, rings=[(0.18, 4.0, (1, 0, 0)), (0.56, 5.0, (0.3, 0, 1))])

    # RECALL: the rod grounded, the wrist bell rung three times at the chest, head tilted to listen (loops)
    rc = pose(torso=dict(chest=(2, 4, 0), neck=(2, 0, 0), head=(6, 8, 8)), L=(-0.10, -0.62, -0.30), Lp=(0.9, 0.3, -0.2))

    def recall_s(t):
        p = dict(rc)
        b = math.sin(2 * math.pi * 2 * t)
        ringt = math.sin(2 * math.pi * 3 * t) * (0.5 + 0.5 * math.sin(2 * math.pi * 6 * t))
        p["hand.L"] = (0.0, 0.0, 14.0 * ringt)
        p["chest"] = (2 + 0.8 * b, 4, 0)
        p["x_halo"] = (0.8 * math.sin(2 * math.pi * 3 * t), 0.0, 1.2 * math.sin(2 * math.pi * 3 * t + 0.5))
        return p
    out["recall"] = anim.Clip("recall", 60, True, recall_s)

    # CHANNEL: the rod raised forward, the free hand open to the front (loops)
    ch = pose(torso=dict(chest=(2, 3, 0), head=(-3, -2, 0)), R=(-0.25, -0.70, -0.25), aim=(-0.05, -0.35, 0.94),
              L=(0.05, -0.85, -0.25), Lp=(0.8, 0.3, -0.4))

    def channel_s(t):
        b = math.sin(2 * math.pi * 2 * t)
        p = anim.add(ch, P_(chest=(1.2 * b, 0, 0), head=(-0.8 * b, 0, 0)))
        p["x_halo"] = (1.5 * math.sin(2 * math.pi * 2 * t), 0.0, 1.5 * math.sin(2 * math.pi * t))
        return p
    out["channel"] = anim.Clip("channel", 40, True, channel_s)

    # DASH: the glide: low, leaning, the rod carried forward, the feet sliding (no step)
    gl = pose(torso=dict(hips=(12, 0, 0), spine=(8, 0, 0), chest=(6, 0, 0), neck=(-8, 0, 0), head=(-8, 0, 0)),
              hips=(0, -0.06, -0.07), R=(-0.30, -0.55, -0.45), aim=(-0.05, -0.62, 0.78), L=(0.16, 0.30, -0.85),
              feet=_feet(l=(0.0, -0.14, 0.0), r=(0.0, 0.16, 0.0), pr=-14.0), halo=(-5, 0, 0))
    out["dash"] = clip("dash", 15, [(0.0, G, "linear"), (0.25, gl, "snap"), (0.75, gl, "linear"), (1.0, G, "inout")])

    # STUNNED: a jolt, the halo ringing, the head wobbling (loops)
    st = pose(torso=dict(spine=(4, 0, 0), chest=(5, 0, 0), neck=(4, 0, 0), head=(7, 0, 0)), hips=(0, 0.02, -0.04),
              R=(-0.34, -0.30, -0.70), aim=(-0.20, -0.10, 0.97), L=(0.10, -0.10, -0.95))

    def stun_s(t):
        a, b = math.sin(2 * math.pi * t), math.sin(2 * math.pi * (t + 0.25))
        p = anim.add(st, P_(hips=(0, 0, 3 * a), spine=(2 * b, 0, -2 * a), chest=(2 * b, 0, -3 * a), neck=(5 * b, 0, 5 * a),
                            head=(7 * b, 4 * a, 7 * a)))
        p["x_halo"] = (5.0 * math.sin(2 * math.pi * 3 * t), 0.0, 6.0 * math.sin(2 * math.pi * 2 * t + 0.4))
        return p
    out["stunned"] = anim.Clip("stunned", 40, True, stun_s)

    # TAUNT: taps the rod head on the halo ring for a clear note (twice), listens
    tu = pose(torso=dict(chest=(-2, -4, -3), head=(-3, 4, 0)), R=(-0.40, -0.18, 0.02), aim=(0.22, 0.12, 0.97))
    tt = pose(torso=dict(chest=(-2, -4, -3), head=(-3, 4, 0)), R=(-0.40, -0.18, -0.02), aim=(0.30, 0.12, 0.95))
    lis = pose(torso=dict(chest=(0, 2, 0), head=(4, 8, 10)), R=(-0.36, -0.34, -0.52), aim=(-0.04, -0.06, 0.99))
    k = [(0.0, G, "linear"), (0.16, tu, "inout"), (0.24, tt, "accel"), (0.32, tu, "out"), (0.40, tt, "accel"),
         (0.52, tu, "out"), (0.72, lis, "inout"), (1.0, G, "inout")]
    out["taunt"] = clip("taunt", 45, k, rings=[(0.24, 3.0, (0, 0, -1)), (0.40, 3.5, (0, 0, -1))])

    # IDLE_LOBBY (120 f, loops): rings the wrist bell once and listens, checks the halo's bells with a finger, finds
    # one flat and smiles, glances at the sun, then the camera, and nods
    bellchk = (-0.06, -0.60, 0.72)
    k = [(0.0, G, "linear"),
         (0.08, pose(torso=dict(chest=(1, 2, 0)), L=(-0.08, -0.62, -0.32), Lp=(0.9, 0.3, -0.2)), "inout"),
         (0.12, pose(torso=dict(chest=(1, 2, 0)), L=(-0.06, -0.64, -0.28), Lp=(0.9, 0.3, -0.2), fk=dict(hand_L=(0, 0, 18))), "out"),
         (0.15, pose(torso=dict(chest=(1, 2, 0)), L=(-0.07, -0.63, -0.30), Lp=(0.9, 0.3, -0.2), fk=dict(hand_L=(0, 0, -10))), "out"),
         (0.28, pose(torso=dict(chest=(1, 2, 0), neck=(2, 0, 0), head=(4, 6, 12)), L=(-0.07, -0.63, -0.30), Lp=(0.9, 0.3, -0.2)), "inout"),
         (0.40, pose(torso=dict(chest=(-2, 6, 0), neck=(-3, 4, 0), head=(-8, 10, 4)), L=bellchk, Lp=(0.9, 0.2, 0.0)), "inout"),
         (0.46, pose(torso=dict(chest=(-2, 6, 0), neck=(-3, 4, 0), head=(-8, 10, 4)), L=(bellchk[0] - 0.02, bellchk[1], bellchk[2] + 0.03),
                     Lp=(0.9, 0.2, 0.0)), "out"),
         (0.52, pose(torso=dict(chest=(-2, 8, 0), neck=(-3, 6, 0), head=(-8, 14, 8)), L=(bellchk[0] - 0.08, bellchk[1] + 0.06, bellchk[2]),
                     Lp=(0.9, 0.2, 0.0)), "inout"),
         (0.62, pose(torso=dict(chest=(0, 4, 0), head=(2, 4, -6)), L=(0.06, -0.40, -0.70)), "inout"),
         (0.72, pose(torso=dict(chest=(-2, -4, 0), neck=(-4, -6, 0), head=(-14, -10, 0))), "inout"),
         (0.84, pose(torso=dict(chest=(0, -8, 0), neck=(0, -8, 0), head=(-2, -12, 0))), "inout"),
         (0.90, pose(torso=dict(chest=(0, -8, 0), neck=(4, -8, 0), head=(9, -12, 0))), "inout"),
         (0.95, pose(torso=dict(chest=(0, -6, 0), neck=(0, -6, 0), head=(0, -9, 0))), "inout"),
         (1.0, G, "inout")]
    out["idle_lobby"] = anim.Clip("idle_lobby", 120, True, with_halo(breathe(anim.keyed(k), 0.8, 4),
                                                                    [(0.12, 1.5, (0, 0, 1)), (0.46, 2.5, (0.5, 0, 1)),
                                                                     (0.52, 1.5, (0.5, 0, -1))], 120))

    # VICTORY (55 f, ends in a hold): two bright strokes, the third held back; the rod grounded at the right, the left
    # fist raised (the stroke he did not ring), the halo level, a quarter turned from the camera
    up1 = pose(torso=dict(chest=(-4, -6, 0), head=(-5, 4, 0)), R=(-0.26, -0.50, -0.05), aim=(-0.05, -0.20, 0.98))
    s1 = pose(torso=dict(chest=(4, 4, 0), head=(-3, -2, 0)), R=(-0.22, -0.72, -0.10), aim=(-0.05, -0.80, 0.60))
    held_back = pose(torso=dict(chest=(-5, -6, 0), head=(-6, 3, 0)), R=(-0.22, -0.40, 0.20), aim=(-0.05, 0.25, 0.97),
                     L=(0.10, -0.40, -0.40))
    final = pose(torso=dict(hips=(0, -14, 0), spine=(0, -6, 0), chest=(-2, -8, 0), neck=(0, 6, 0), head=(-4, 10, -3)),
                 L=(0.06, -0.38, 0.42), Lp=(0.9, 0.3, -0.3), feet=_feet(l=(0.0, -0.04, 0.0), yl=-6.0, yr=-16.0))
    k = [(0.0, G, "linear"), (0.12, up1, "inout"), (0.20, s1, "accel"), (0.30, up1, "out"), (0.38, s1, "accel"),
         (0.50, held_back, "out"), (0.64, held_back, "linear"), (0.80, final, "inout"), (1.0, final, "linear")]
    vic = with_halo(anim.keyed(k), [(0.20, 4.0, (1, 0, 0.3)), (0.38, 4.0, (1, 0, -0.3))], 55)

    def vic_s(t):
        p = dict(vic(t))
        if t > 0.82:
            b = math.sin(2 * math.pi * 1.5 * t)
            p["chest"] = tuple(np.add(p["chest"], (0.6 * b, 0, 0)))
        return p
    out["victory"] = anim.Clip("victory", 55, False, vic_s)
    for c in out.values():
        c.sample = level(c.sample)
    return out


if __name__ == "__main__":
    fighter.main(sys.modules[__name__])
