"""odrum: Amber setter (Slinger, Serenade). ART 2.0: sculpted volumes painted by concept projection.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/odrum_plates.py --height 1.9   # plates
    Blender -b --factory-startup --python art/blender/proto/odrum_fit.py                         # fit check
    python3 art/build.py fighter odrum --no-skins --clip-sheet

Brief: _design/fighters/odrum.md. Concept: _design/concept/odrum.webp (front + back, hand-painted).
The forms are numpy SDF volumes (common/hifi/sdf.py) fitted to the concept on a 10 cm grid (crown of the
cap knob 1.90 m); the base colour is the concept painting itself, projected occlusion-aware onto the game
mesh (common/hifi/project.py); normals and AO bake from the sculpt.

The concept's proportions and pose win over the brief's start values (it is the approved look): the yoke
rides BEHIND the neck on the back of the shoulders (y +0.13), level within 2 degrees (it rises 3 cm toward
the left end, as painted); the right fist holds it above the right shoulder (the rest pose is that pose: the
right arm is re-seated in rig_extras), the left arm hangs with a fist. The brief wins on the class hook and
on details: the yoke spans 2.06 m amber cap to amber cap (brief 2.2 m +/-10%: the widest bar in the roster;
the concept paints 1.5 m), the two carved sandstone pots hang at its ends 0.20 m below the bar on rigid cord
pairs (their windows in the top half), a leather sling pouch hangs under the right end, the resin in the pot
mouths is amber lampresin (glossy, never emissive), and each pot carries three round `accent` windows set in
carved rings (front, out, back: the painted window on the +X side is erased from the plates), the only
emissive pixels at rest. The pots keep their own painting (sampled at their painted place); the yoke's bar,
bands, caps and pouch are painted procedurally in the concept's palette and light.
"""
from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Quaternion, Vector  # noqa: E402

from common import anim, fighter, materials, rig, scene  # noqa: E402
from common.hifi import sdf  # noqa: E402
from common.hifi.sdf import (Capsule, Ellipsoid, FlatCapsule, HalfSpace, Lathe, RoundBox, RoundCone,  # noqa: E402
                             Sculpt, Sphere, Torus, Tube)

ID = "odrum"
TITLE = "Amber setter"
ROLE_MASS = "slinger"
ORIGIN = "serenade"
CARD = {"primary": "#7A6550", "secondary": "#BBA27F"}

# ── the concept, measured on the 10 cm grid (crown of the cap knob 1.90 m) ───────────────────────────
STAFF_Y = 0.13                      # the yoke rides behind the neck, on the back of the shoulders


def staff_z(x):
    return 1.50 + 0.03 * x           # rises 3 cm per metre toward the left end (+X), as painted


STAFF_R = 0.027
# The brief's class hook wins over the concept's 1.5 m bar: the yoke spans 2.06 m amber cap to amber cap
# (brief 2.2 m +/-10%, the widest horizontal read in the roster), the pots hang at its ends. The painting
# still paints the pots: each pot samples the concept at its painted place (POT_SHIFT, see _paint_lit).
STAFF_X = (-1.06, 1.00)
POT_H = 0.266
POT_DROP = 0.20                      # knot to pot rim (concept 0.32): the windows sit in the top half
CONCEPT_POTS = {"R": (-0.544, 0.852), "L": (0.483, 0.892)}   # (x centre, bottom z) as painted
POT_X = {"R": -0.80, "L": 0.80}


def _pot_hang(side):
    x = POT_X[side]
    apz = staff_z(x) - 0.042                                  # the knot just under the bar
    return (x, apz - POT_DROP - POT_H + 0.012, x, apz)


POTS = {s: _pot_hang(s) for s in ("R", "L")}  # side: (x centre, bottom z, cord apex x, cord apex z)
POT_SHIFT = {s: np.array([POTS[s][0] - CONCEPT_POTS[s][0], 0.0, POTS[s][1] - CONCEPT_POTS[s][1]]) for s in POTS}
POUCH_X = -0.985                     # the sling pouch hangs under the right end (the lob origin)
GRIP_R = np.array([-0.357, STAFF_Y, staff_z(-0.357)])        # the right fist's grip on the staff
HAND_L_C = np.array([0.268, -0.03, 0.822])                   # the hanging left fist (its sculpt centre)

# rig fitted to the sculpt: crown of the head block under the cap 1.82, skull base 1.536, shoulders x 0.20
# at 1.376, left elbow (0.255, 1.12), left wrist (0.28, 0.885), hips x 0.10 at 0.90, knees 0.45, ankles x 0.14
PROPORTIONS = rig.proportions(height=1.82, head=0.33, neck=0.06, shoulder_width=0.40, hip_width=0.20, leg=0.811,
                              thigh_frac=0.555, arm=0.50, upper_arm_frac=0.52, hand=0.13, foot=0.30,
                              ankle_height=0.09, spine_curve=0.0, stance=0.04, toe_out_deg=10.0, knee_bend=0.012,
                              a_pose_deg=77.0, arm_forward_deg=3.0, elbow_bend_deg=8.0, shoulder_drop=0.10)
# the right arm as painted (rest pose = the concept pose): elbow down and forward, fist on the yoke. The rig
# is built symmetric (A-pose); rig_extras re-seats the right arm here, keeping the arm lengths.
_J0 = rig._layout(PROPORTIONS)
SH_R = np.array(_J0["shoulder.R"][:])
L_UP = PROPORTIONS["arm"] * PROPORTIONS["upper_arm_frac"]
L_FO = PROPORTIONS["arm"] - L_UP
_E, _W = np.array([-0.368, -0.055, 1.19]), np.array([-0.374, 0.055, 1.405])
ELBOW_R = SH_R + (_E - SH_R) / np.linalg.norm(_E - SH_R) * L_UP
WRIST_R = ELBOW_R + (_W - _E) / np.linalg.norm(_W - _E) * L_FO
MATERIAL_SET = "bible"
# ART 2.0 skins (brief section 9): the painting re-coloured role by role + skin-only extras painted flat (lit, see
# _paint_lit). Noon Fair swaps the pots for paper lanterns and hangs rigid ribbon pairs at both ends; Shadeprint is
# ink below and pale above, with ink pots under pale rims (no extra geometry).
SKINS: list = [
    {"id": "odrum_noon_fair", "extra": {"paper_lanterns": True, "ribbons": True},
     "card": {"primary": "#6A4F5F", "secondary": "#E2D6C4"},
     "palette": {"wood": "#B48AA6", "paper": "#E2D6C4", "fair_rim": "#C48D4A", "ribbon": "#D3AFC2"}},
    {"id": "odrum_shadeprint", "extra": {"ink_pots": True}, "card": {"primary": "#2B2A33", "secondary": "#B7B4BE"},
     "palette": {"sandstone": "#B7B4BE", "cloth2": "#CFCBD6", "wood": "#C9C5D0", "wood_dark": "#2B2A33", "cloth": "#8A8896",
                 "lampresin": "#7A6BB0", "leather": "#3A3942", "under": "#34333C", "ironstone": "#2B2A33", "pot": "#2B2A33",
                 "rim": "#C9C5D0", "cord": "#3A3942"}},
]
SKIN_FLAT = {"lantern_R": "paper", "lantern_L": "paper", "lantern_rims_R": "fair_rim", "lantern_rims_L": "fair_rim",
             "ribbons": "ribbon", "cap_ribbon": "ribbon"}
# base palette = the painting's own mean colour per role, measured on the projected atlas (paint_means_odrum.json):
# a skin re-colours each role's painted texels by skin / base per channel, so the brief's named skin colours land as
# named; roles a skin leaves alone keep the painting
PALETTE = materials.bible_palette(sandstone="#8E5B29", cloth2="#885C39", wood="#A88762", wood_dark="#4E3A2E",
                                  cloth="#583826", lampresin="#C07A35", leather="#42291D", under="#462C1E",
                                  ironstone="#3A2E26", ink="#17181B", accent="#3F9CFF", pot="#A5672C",
                                  rim="#AD6D31", cord="#4E3A2C", paper="#E2D6C4", ribbon="#D3AFC2", fair_rim="#C48D4A")
VALUE_GRADIENT_STOPS = materials.BIBLE_GRADIENT_STOPS
SOCKETS = {"weapon": "prop.R", "weapon_tip": "x_sling_pouch", "pot_l": "x_pot_l", "pot_r": "x_pot_r",
           "pellet": "x_pellet"}
SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92, "fill": 0.78, "pitch": 1.0, "yaw": 30.0}
TEXTURE_SIZE = 2048
TEXTURE_SIZES = {"normal": 512, "orm": 512}
GLB_COMPRESS = True
ARMOUR_CONFORM = False
AO_INTO_BASE = 0.25
HEIGHT = 1.90                 # crown of the cap knob (the projection plates' scale)
PROJECTION = {"concept": "odrum", "height": HEIGHT, "tops": {}, "flat": {"cords_R": "#4E3A2C", "cords_L": "#4E3A2C"}}
NOISE = sdf.Noise(11)
VOXEL = 0.006


# ── shaping helpers ──────────────────────────────────────────────────────────────────────────────
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


def felt(amp=0.0025, freq=26.0):
    def fn(P):
        return amp * NOISE(P, freq)
    return fn


def unit(v):
    v = np.asarray(v, dtype=np.float64)
    return v / (np.linalg.norm(v) + 1e-12)


def as_prim(S: Sculpt) -> sdf.Blend:
    """a sculpt's op list as one queryable primitive (surface lookups for straps laid on a form)"""
    return sdf.Blend([(op, prim, k) for op, prim, k, _ in S.ops])


def surface_at(prim, x, z, side=-1.0):
    """the first surface point of `prim` met along Y from the front (side -1) or the back (+1) at (x, z),
    with its outward normal"""
    ys = np.linspace(side * 0.45, 0.0, 451)
    P = np.stack([np.full_like(ys, x), ys, np.full_like(ys, z)], 1)
    d = prim.d(P)
    i = int(np.argmax(d < 0.0))
    p = P[max(0, i - 1)] + (P[i] - P[max(0, i - 1)]) * (d[max(0, i - 1)] / max(1e-9, d[max(0, i - 1)] - d[i]))
    e = 0.002
    n = np.array([prim.d(np.array([p + a])).item() - prim.d(np.array([p - a])).item()
                  for a in (np.array([e, 0, 0]), np.array([0, e, 0]), np.array([0, 0, e]))])
    return p, unit(n)


def strap_on(S: Sculpt, prim, xz, side, width, thick, k=0.004):
    """a flat band (width x thick) through the surface points of `prim` at the given (x, z)"""
    pts = [surface_at(prim, x, z, side) for x, z in xz]
    pts = [(p + n * thick * 0.35, n) for p, n in pts]
    for (a, na), (b, nb) in zip(pts[:-1], pts[1:]):
        d = unit(b - a)
        w = np.cross(d, unit(na + nb))
        S.add(FlatCapsule(a, b, width * 0.5, thick * 0.5, side=w), k=k)


def pot_profile(r, z):
    """Carved pot (lathe, z from the pot's bottom): flat foot (r 0.06), round belly (r 0.123 at 0.118), a raised
    shoulder ridge at 0.166, the neck (r 0.086 from 0.212), a rolled lip to the rim at 0.266; the mouth is
    hollow from 0.236 up (the resin sits in it)."""
    belly = 0.123 * np.sqrt(np.clip(1.0 - ((z - 0.118) / 0.135) ** 2, 0.0, 1.0))
    rr = np.where(z < 0.212, belly, 0.086)
    d = np.maximum(r - rr, np.maximum(-z, z - 0.255))
    rz = np.stack([r, np.zeros_like(r), z], 1)
    d = np.minimum(d, Torus((0, 0, 0.250), 0.099, 0.0165).d(rz))
    d = np.maximum(d, -np.maximum(r - 0.076, 0.236 - z))
    return np.minimum(d, Torus((0, 0, 0.166), 0.111, 0.0075).d(rz))


WIN_R = 0.058                       # the round accent gem (the brief's 12 cm window)


def pot_windows(side):
    """(centre on the belly, outward normal) for the three windows of a pot: front (-Y), out (away from the
    body) and back (+Y), so one window faces any camera square on (the rest are edge-on bumps)."""
    x, z0, _, _ = POTS[side]
    out = -1.0 if side == "R" else 1.0
    zc = z0 + 0.112
    res = []
    for d in ((0.0, -1.0), (out, 0.0), (0.0, 1.0)):
        n = unit((d[0], d[1], 0.16))                # tipped up a little toward the high game camera
        c = np.array([x, STAFF_Y, zc]) + np.array([d[0], d[1], 0.0]) * 0.119
        res.append((c, n))
    return res


def window_pad(c, n):
    """the flat carved pad each window sits in (a short disc blended into the pot's belly)"""
    return Lathe(c, lambda r, z: np.maximum(r - WIN_R - 0.016, np.abs(z + 0.016) - 0.020) - 0.006, WIN_R + 0.03, -0.05, 0.02,
                 axes=sdf.frame(n))


def sculpts(lanterns: bool = False) -> list:
    """(name, Sculpt, voxel scale, material role, bind, tris) in build order; `lanterns` swaps the pots for
    the Noon Fair skin's paper lanterns (same hang, same windows)."""
    out = []

    def part(name, S, role, bind, tris, vs=1.0):
        out.append((name, S, vs, role, bind, tris))

    # CAP (rigid on the head): a felt dome over a tall rolled brim, a knob on top
    cap = Sculpt("cap")
    brim = Lathe((0, -0.005, 0), lambda r, z: RoundBox((0.148, 0, 1.726), (0.026, 1.0, 0.058), 0.026).d(
        np.stack([r, np.zeros_like(r), z], 1)), 0.18, 1.66, 1.79, axes=np.diag([1.0, 1.12, 1.0]))
    cap.add(brim.displaced(felt(0.003, 22.0), 0.003), k=0.0)
    dome = Ellipsoid((0, -0.005, 1.765), (0.134, 0.122, 0.12))
    cap.add(dome.displaced(felt(0.0025, 24.0), 0.003), k=0.02)
    cap.add(Capsule((0, -0.005, 1.872), (0, -0.005, 1.885), 0.02), k=0.012)
    cap.add(Sphere((0, -0.005, 1.893), 0.021), k=0.008)
    cap.sub(Tube([(0.004, -0.124, 1.80), (0.006, -0.10, 1.85), (0.003, -0.05, 1.88)], [0.004] * 3), k=0.003)
    cap.sub(Tube([(0.0, 0.112, 1.80), (0.0, 0.09, 1.85), (0.0, 0.04, 1.88)], [0.004] * 3), k=0.003)
    part("cap", cap, "cloth2", "bone:head", 1150)

    # HEAD (the carved block behind the mask) + MASK (rigid on the head)
    head = Sculpt("head")
    head.add(RoundBox((0, -0.005, 1.615), (0.142, 0.098, 0.088), 0.045).displaced(chips(0.008, 8.0), 0.008), k=0.0)
    head.add(RoundBox((0, -0.03, 1.69), (0.135, 0.09, 0.03), 0.02), k=0.02)
    for sx in (-1, 1):                  # the jaw taper of the mask: the block hides behind it from the front
        head.inter(HalfSpace((sx * 0.148, 0, 1.575), unit((sx * 0.124, 0.0, -0.13)), 1.0), k=0.012)
    part("head", head, "sandstone", "bone:head", 700)
    mask = Sculpt("mask")
    # the brow band: the mask's top, carved in one piece with the face. Rounded in plan to the head's curve
    # (no corners past the cap brim from behind), its top front edge chamfered, barely proud of the face
    bnd = Sculpt("_band")
    bnd.add(RoundBox((0, -0.104, 1.742), (0.160, 0.072, 0.039), 0.012), k=0.0)
    bnd.inter(Ellipsoid((0, -0.01, 1.742), (0.205, 0.205, 0.6)), k=0.012)
    bnd.inter(HalfSpace((0, -0.186, 1.776), unit((0, -0.55, 0.84)), 1.0), k=0.006)
    bnd.inter(HalfSpace((0, -0.03, 1.742), (0, 1, 0), 1.0), k=0.01)
    mask.add(sdf.Blend([(op, prim, k) for op, prim, k, _ in bnd.ops]).displaced(chips(0.006, 9.0), 0.006), k=0.0)
    face = Sculpt("_face")
    face.add(RoundBox((0, -0.098, 1.585), (0.152, 0.07, 0.125), 0.02), k=0.0)
    for sx in (-1, 1):                                   # the jaw tapers to a pointed chin
        n = unit((sx * 0.124, 0.0, -0.13))
        face.inter(HalfSpace((sx * 0.152, 0, 1.575), n, 1.0), k=0.01)
        face.inter(HalfSpace((sx * 0.02, -0.17, 1.6), unit((sx * 0.42, -0.9, 0.0)), 1.0), k=0.006)   # cheek planes recede
    face.inter(HalfSpace((0, -0.165, 1.52), unit((0, -0.78, -0.62)), 1.0), k=0.006)                  # the chin plane
    mask.add(sdf.Blend([(op, prim, k) for op, prim, k, _ in face.ops]).displaced(chips(0.007, 10.0), 0.007), k=0.02)
    for sx in (-1, 1):                                   # almond eye recesses, outer corners up
        mask.sub(Ellipsoid((sx * 0.083, -0.176, 1.657), (0.05, 0.05, 0.021), axes=sdf.rot_y(sx * 14)), k=0.008)
    nose = Sculpt("_nose")
    nose.add(RoundCone((0, -0.172, 1.70), (0, -0.212, 1.575), 0.024, 0.05), k=0.0)
    for sx in (-1, 1):
        nose.inter(HalfSpace((0, -0.235, 1.6), unit((sx * 0.8, -0.6, 0.0)), 1.0), k=0.004)
    nose.inter(HalfSpace((0, 0, 1.566), (0, 0, -1), 1.0), k=0.004)
    mask.add(sdf.Blend([(op, prim, k) for op, prim, k, _ in nose.ops]), k=0.012)
    mask.sub(Tube([(-0.05, -0.163, 1.522), (-0.02, -0.167, 1.534), (0.02, -0.167, 1.534), (0.05, -0.163, 1.522)],
                  [0.006] * 4), k=0.004)
    part("mask", mask, "sandstone", "bone:head", 1550, 0.7)

    # COAT (heat weights): felt jerkin body, the standing collar, both sleeves with rolled cuffs
    coat = Sculpt("coat")
    coat.add(Ellipsoid((0, 0.01, 1.235), (0.182, 0.132, 0.25)), k=0.0)
    coat.add(Ellipsoid((0, 0.025, 1.385), (0.205, 0.128, 0.095)), k=0.07)        # shoulders and yoke
    coat.add(Ellipsoid((0, 0.075, 1.415), (0.16, 0.075, 0.06)), k=0.05)          # upper back under the bar
    coat.add(Torus((0, 0.0, 1.462), 0.072, 0.03, rz=0.04), k=0.03)              # standing collar
    coat.add(Capsule((0, 0.0, 1.42), (0, 0.0, 1.54), 0.06), k=0.02)             # neck (under the head block)
    # left sleeve, hanging
    coat.add(Sphere((0.205, 0.02, 1.35), 0.085), k=0.05)
    coat.add(FlatCapsule((0.215, 0.02, 1.34), (0.255, 0.0, 1.13), 0.075, 0.072, 0.07, 0.068, side=(1, 0, 0)), k=0.04)
    cl = unit((0.02, -0.01, -1.0))
    coat.add(Torus((0.265, -0.005, 1.088), 0.058, 0.034, axes=sdf.frame(cl), rz=0.04), k=0.015)
    # right sleeve, raised: shoulder -> elbow down and forward, the cuff rolled just past the elbow
    sh_r = np.array([-0.20, 0.02, 1.37])
    coat.add(Sphere((-0.205, 0.02, 1.35), 0.085), k=0.05)
    coat.add(FlatCapsule(sh_r + (0.0, 0.0, -0.02), ELBOW_R, 0.076, 0.072, 0.072, 0.07, side=(1, 0, 0)), k=0.04)
    fa = unit(WRIST_R - ELBOW_R)
    coat.add(Sphere(ELBOW_R + (0.0, 0.012, -0.008), 0.070), k=0.045)      # a rounded elbow under the bunched sleeve
    coat.add(Torus(ELBOW_R + fa * 0.05, 0.052, 0.038, axes=sdf.frame(fa), rz=0.04), k=0.02)
    part("coat", coat, "cloth", "auto", 2600)

    # cross straps front and back (an X from the shoulders to the belt), laid on the coat's surface
    body = as_prim(coat)
    straps = Sculpt("straps")
    for fb in (-1, 1):
        for sx in (-1, 1):
            strap_on(straps, body, [(sx * 0.10, 1.47), (sx * 0.075, 1.40), (sx * 0.01, 1.29), (-sx * 0.07, 1.19),
                                    (-sx * 0.13, 1.11)], fb, 0.036, 0.011)
    part("straps", straps, "leather", "auto", 600)
    belt = Sculpt("belt")
    belt.add(Torus((0, 0.008, 1.078), 0.150, 0.02, axes=np.diag([1.0, 0.150 / 0.122, 1.0]), rz=0.038), k=0.0)
    part("belt", belt, "leather", "auto", 450)

    # SKIRT: the jerkin below the belt, flaring to the knee hem, split at the front
    skirt = Sculpt("skirt")
    sk = FlatCapsule((0, 0.012, 0.44), (0, 0.008, 1.06), 0.282, 0.18, 0.15, 0.118, side=(1, 0, 0))
    skirt.add(sk.displaced(folds(0.012, 14.0, axis=0, phase=0.7, zfade=(1.0, 0.5)), 0.012), k=0.0)
    skirt.inter(HalfSpace((0, 0, 0.47), unit((0.0, -0.05, -1.0)), 2.0), k=0.006)
    skirt.sub(RoundBox((-0.018, -0.21, 0.70), (0.012, 0.06, 0.26), 0.008, axes=sdf.rot_y(0)), k=0.006)
    part("skirt", skirt, "cloth", "auto", 1750)

    # LEGS: bloused trousers, tall boots with a fold at the ankle
    legs = Sculpt("trousers")
    for sx in (-1, 1):
        # narrow at the top: the thighs stay inside the flaring skirt (no dark trouser poking out at the hips)
        legs.add(FlatCapsule((sx * 0.085, 0.0, 0.80), (sx * 0.128, -0.005, 0.43), 0.072, 0.08, 0.10, 0.098, side=(1, 0, 0)), k=0.0)
        legs.add(Ellipsoid((sx * 0.128, -0.008, 0.405), (0.103, 0.1, 0.055)).displaced(folds(0.008, 30.0, axis=0), 0.008), k=0.04)
    part("trousers", legs, "under", "auto", 900)
    boots = Sculpt("boots")
    for sx in (-1, 1):
        a = np.array([sx * 0.128, -0.005, 0.37])
        b = np.array([sx * 0.137, 0.0, 0.14])
        boots.add(FlatCapsule(a, b, 0.074, 0.074, 0.062, 0.066, side=(1, 0, 0)), k=0.0)
        boots.add(Torus((sx * 0.137, -0.005, 0.15), 0.064, 0.013, rz=0.016), k=0.015)
        yaw = sdf.rot_z(sx * -10.0)
        boots.add(RoundBox((sx * 0.148, -0.055, 0.068), (0.073, 0.148, 0.066), 0.055, axes=yaw), k=0.04)
        boots.add(RoundBox((sx * 0.148, -0.058, 0.016), (0.08, 0.158, 0.016), 0.012, axes=yaw), k=0.006)
    boots.inter(HalfSpace((0, 0, 0.0), (0, 0, -1), 2.0), k=0.0)
    part("boots", boots, "leather", "auto", 1200)

    # FOREARM WRAPS (rigid on the forearms) and the FISTS (rigid on the hands)
    wl = Sculpt("wrap_L")
    a, b = np.array([0.262, -0.008, 1.06]), np.array([0.281, -0.025, 0.89])
    wl.add(FlatCapsule(a, b, 0.05, 0.047, 0.046, 0.044, side=(1, 0, 0)).displaced(
        lambda P: 0.004 * np.sin(P[:, 2] * 120.0 + 6.0 * P[:, 0]), 0.004), k=0.0)
    part("wrap_L", wl, "leather", "bone:forearm.L", 300)
    wr = Sculpt("wrap_R")
    a, b = ELBOW_R + fa * 0.07, WRIST_R + fa * 0.005
    wr.add(FlatCapsule(a, b, 0.05, 0.048, 0.047, 0.045, side=(1, 0, 0)).displaced(
        lambda P: 0.004 * np.sin(P[:, 2] * 120.0 + 6.0 * P[:, 0]), 0.004), k=0.0)
    part("wrap_R", wr, "leather", "bone:forearm.R", 300)
    hl = Sculpt("hand_L")
    c = np.array([0.268, -0.03, 0.822])
    hl.add(RoundBox(c, (0.054, 0.058, 0.058), 0.034), k=0.0)
    for i in range(4):
        hl.add(Capsule(c + (-0.04, -0.05, 0.035 - i * 0.024), c + (0.035, -0.05, 0.035 - i * 0.024), 0.016), k=0.012)
    hl.add(Capsule(c + (-0.05, -0.035, 0.04), c + (-0.03, -0.062, -0.005), 0.02), k=0.012)
    part("hand_L", hl, "sandstone", "bone:hand.L", 520)
    hr = Sculpt("hand_R")
    g = GRIP_R
    hr.add(RoundBox(g + (0.0, -0.028, -0.02), (0.07, 0.05, 0.06), 0.035), k=0.0)
    for i in range(4):                                   # four finger rolls over the top front of the bar
        x0 = g[0] - 0.052 + i * 0.035
        hr.add(Tube([(x0, g[1] - 0.04, g[2] - 0.03), (x0, g[1] - 0.035, g[2] + 0.03), (x0, g[1] + 0.005, g[2] + 0.045)],
                    [0.018, 0.019, 0.017], k=0.01), k=0.012)
    hr.add(Capsule(g + (0.06, -0.05, -0.02), g + (0.035, -0.06, 0.03), 0.02), k=0.012)
    hr.add(Capsule(g + (0.0, -0.02, -0.06), WRIST_R + (0.0, 0.0, 0.01), 0.05), k=0.02)
    part("hand_R", hr, "sandstone", "bone:hand.R", 600)

    # THE YOKE (rigid on prop.R): the walnut bar, leather grip bands and knot wraps, amber end caps, the sling
    # pouch under the right end, cord pairs and the pots. The bar, bands, caps, pouch and resin are painted
    # procedurally (_paint_lit: oiled walnut grain, wound leather, glossy amber); the pots take the concept.
    x0, x1 = STAFF_X
    ax = unit((1.0, 0.0, 0.03))

    def on_bar(x):
        return np.array([x, STAFF_Y, staff_z(x)])
    staff = Sculpt("staff")
    staff.add(Capsule(on_bar(x0 + 0.07), on_bar(x1 - 0.07), STAFF_R).displaced(
        lambda P: 0.0012 * NOISE(P * np.array([0.25, 1.0, 1.0]), 40.0), 0.0015), k=0.0)
    part("staff", staff, "wood", "bone:prop.R", 760)
    wraps = Sculpt("staff_wraps")
    bands = [(GRIP_R[0] - 0.035, GRIP_R[0] + 0.035), (-0.03, 0.03), (0.27, 0.33)]          # three grip bands
    for side in ("R", "L"):
        apx = POTS[side][2]
        bands += [(apx - 0.085, apx - 0.045), (apx + 0.045, apx + 0.085)]               # the knot wraps
    for (a_, b_) in bands:
        n_t = max(2, int(round((b_ - a_) / 0.0135)))
        for k in range(n_t):
            xx = a_ + (b_ - a_) * (k + 0.5) / n_t
            wraps.add(Torus(on_bar(xx), STAFF_R + 0.002, 0.0075, axes=sdf.frame(ax)), k=0.005)
    for side in ("R", "L"):
        _, _, apx, apz = POTS[side]
        wraps.add(Torus(np.array([apx, STAFF_Y, apz + 0.010]), 0.015, 0.0065, axes=sdf.frame((0, 1, 0))), k=0.004)
        wraps.add(Torus(on_bar(apx), STAFF_R + 0.002, 0.0075, axes=sdf.frame(ax)), k=0.005)
    part("staff_wraps", wraps, "leather", "bone:prop.R", 550, 0.7)
    caps = Sculpt("staff_caps")
    caps.add(Capsule(on_bar(x0 + 0.034), on_bar(x0 + 0.105), 0.034), k=0.0)
    caps.add(Capsule(on_bar(x1 - 0.105), on_bar(x1 - 0.034), 0.034), k=0.0)
    part("staff_caps", caps, "lampresin", "bone:prop.R", 280, 0.8)
    # the sling pouch (0.14 m, leather) on a short rigid cord loop under the right end: the lob origin
    pouch = Sculpt("pouch")
    top = on_bar(POUCH_X)
    pc = top + np.array([0.0, -0.004, -0.118])
    pouch.add(Ellipsoid(pc, (0.064, 0.056, 0.068)).displaced(felt(0.004, 18.0), 0.004), k=0.0)
    pouch.add(RoundCone(pc + (0, 0, 0.045), pc + (0, 0, 0.082), 0.042, 0.021), k=0.016)
    pouch.add(Torus(pc + (0, 0, 0.070), 0.027, 0.0075, rz=0.006), k=0.004)
    pouch.add(Ellipsoid(pc + (0.0, -0.05, 0.022), (0.05, 0.012, 0.035), axes=sdf.rot_x(-12)), k=0.01)   # the flap
    for dy in (-0.022, 0.022):
        pouch.add(Capsule(pc + (0, dy * 0.4, 0.08), top + (0.0, dy, -0.004), 0.0055), k=0.004)
    pouch.add(Torus(top, STAFF_R + 0.003, 0.0065, axes=sdf.frame(ax)), k=0.004)
    part("pouch", pouch, "leather", "bone:prop.R", 340, 0.7)
    # the cords and pots hang from the knots on x_hang_r / x_hang_l (gimbals that keep them plumb, see
    # _resolve_plumb): rigid on the staff, never swaying, always hanging straight down from the bar
    for side in ("R", "L"):
        px, z0, apx, apz = POTS[side]
        hang = f"bone:x_hang_{side.lower()}"
        cords = Sculpt(f"cords_{side}")
        rim_z = z0 + POT_H - 0.012
        for sx in (-1, 1):
            cords.add(Capsule((apx, STAFF_Y, apz), (px + sx * 0.068, STAFF_Y, rim_z), 0.0055), k=0.0)
        part(f"cords_{side}", cords, "cord", hang, 110, 0.6)
        glass = Sculpt(f"window_{side}")
        resin = Sculpt(f"resin_{side}")
        if lanterns:                                      # Noon Fair: painted paper lanterns in place of the pots
            lan, rims = Sculpt(f"lantern_{side}"), Sculpt(f"lantern_rims_{side}")
            c0 = np.array([px, STAFF_Y, z0 + 0.13])
            shell = Ellipsoid(c0, (0.13, 0.13, 0.125))
            lan.add(shell.displaced(lambda P, c=c0: 0.006 * np.abs(np.sin(np.arctan2(P[:, 1] - c[1], P[:, 0] - c[0]) * 8.0)) - 0.003, 0.006), k=0.0)
            lan.inter(HalfSpace(c0 + (0, 0, 0.11), (0, 0, 1), 1.0), k=0.01)
            lan.inter(HalfSpace(c0 - (0, 0, 0.115), (0, 0, -1), 1.0), k=0.01)
            for zz, rr in ((0.112, 0.068), (-0.117, 0.06)):
                rims.add(Torus(c0 + (0, 0, zz), rr, 0.013, rz=0.016), k=0.0)
            for c_, n_ in pot_windows(side):
                lan.add(window_pad(c_, n_), k=0.01)
                rims.add(Torus(c_ + n_ * 0.012, WIN_R + 0.008, 0.0095, axes=sdf.frame(n_), rz=0.008), k=0.0)
                glass.add(Ellipsoid(c_ + n_ * 0.006, (WIN_R, WIN_R, 0.022), axes=sdf.frame(n_)), k=0.0)
            resin.add(Ellipsoid(c0 + (0, 0, 0.112), (0.056, 0.056, 0.01)), k=0.0)
            part(f"lantern_{side}", lan, "paper", hang, 800, 0.8)
            part(f"lantern_rims_{side}", rims, "lampresin", hang, 450, 0.6)
        else:
            pot, rim = Sculpt(f"pot_{side}"), Sculpt(f"pot_rim_{side}")
            pot.add(Lathe((px, STAFF_Y, z0), pot_profile, 0.13, -0.002, 0.236).displaced(chips(0.004, 14.0), 0.004), k=0.0)
            for c_, n_ in pot_windows(side):
                pot.add(window_pad(c_, n_), k=0.012)
            rim.add(Torus((px, STAFF_Y, z0 + 0.250), 0.099, 0.0165), k=0.0)
            rim.add(Lathe((px, STAFF_Y, z0), lambda r, z: np.maximum(np.maximum(r - 0.099, 0.076 - r), np.maximum(0.21 - z, z - 0.252)),
                          0.11, 0.2, 0.26), k=0.004)
            for c_, n_ in pot_windows(side):            # the raised sandstone ring each gem is set in
                rim.add(Torus(c_ + n_ * 0.012, WIN_R + 0.008, 0.0095, axes=sdf.frame(n_), rz=0.008), k=0.0)
                glass.add(Ellipsoid(c_ + n_ * 0.006, (WIN_R, WIN_R, 0.022), axes=sdf.frame(n_)), k=0.0)
            resin.add(Ellipsoid((px, STAFF_Y, z0 + 0.238), (0.079, 0.079, 0.011)), k=0.0)
            part(f"pot_{side}", pot, "pot", hang, 720, 0.8)
            part(f"pot_rim_{side}", rim, "rim", hang, 520, 0.6)
        # lampresin: amber, glossy, never emissive (the windows are the only emissive pixels at rest)
        part(f"resin_{side}", resin, "lampresin", hang, 100, 0.8)
        part(f"window_{side}", glass, "accent", hang, 200, 0.6)
    return out


def skin_extras(extra: dict) -> list:
    """skin-only geometry beyond the lantern swap: Noon Fair's rigid ribbon pairs at both ends of the yoke"""
    out = []
    if extra.get("ribbons"):
        rib = Sculpt("ribbons")
        for x0_, sgn in ((STAFF_X[0] + 0.125, -1.0), (STAFF_X[1] - 0.10, 1.0)):     # inboard of the amber caps
            top = np.array([x0_, STAFF_Y, staff_z(x0_) - 0.02])
            for k, (dy, sway) in enumerate(((-0.072, -0.03), (0.074, 0.03))):          # either side of pouch / pot
                pts = [top + (0.0, dy, 0.0), top + (sgn * 0.02, dy + sway * 0.3, -0.08), top + (sgn * 0.035 + sway * 0.2, dy + sway, -0.17),
                       top + (sgn * 0.03 - sway * 0.2, dy + sway * 1.3, -0.25 + 0.02 * k)]
                for a, b in zip(pts[:-1], pts[1:]):
                    rib.add(FlatCapsule(a, b, 0.024, 0.0035, side=(1.0, 0.0, 0.0)), k=0.004)
        out.append(("ribbons", rib, 0.5, "ribbon", "bone:prop.R", 450))
        # ... and a fair ribbon round the felt cap, tied in a bow at the back-left with two short tails (the skin
        # reads in the portrait and the icon too, where the lanterns are out of frame)
        cr = Sculpt("cap_ribbon")
        cr.add(Torus((0, -0.005, 1.812), 0.124, 0.010, axes=np.diag([1.0, 1.10, 1.0]), rz=0.022), k=0.0)
        bow = np.array([0.065, 0.098, 1.818])
        for sx in (-1.0, 1.0):
            cr.add(Ellipsoid(bow + (sx * 0.028, 0.012, 0.004), (0.030, 0.009, 0.019), axes=sdf.rot_z(-35.0) @ sdf.rot_y(sx * 25.0)), k=0.006)
        cr.add(Sphere(bow + (0.0, 0.01, 0.0), 0.013), k=0.004)
        for tip in ((0.105, 0.205, 1.70), (0.045, 0.215, 1.69)):
            a_, m_ = bow + (0.0, 0.012, -0.01), (np.asarray(tip) + bow) * 0.5 + (0.0, 0.04, 0.0)
            for p0, p1 in ((a_, m_), (m_, np.asarray(tip))):
                cr.add(FlatCapsule(p0, p1, 0.014, 0.003, side=(1.0, 0.0, 0.0)), k=0.004)
        out.append(("cap_ribbon", cr, 0.5, "ribbon", "bone:head", 320))
    return out


def extra_materials(ctx) -> dict:
    """the pot, rim, cord and Noon Fair roles (skins re-colour each apart from the mask and the straps)"""
    pal = dict(ctx.palette)
    return {"wood": materials.carved_wood("wood", pal, "wood", ctx.gradient, rough=0.8),   # oiled, not glossy: the
            # bar's top is what the high game camera sees, and a sheen there mirrors the pale sky (a grey bar)
            # matte waxed leather: at 0.5 the boots and straps mirror the bright ground and sky and read pale grey
            "leather": materials.waxed_leather("leather", pal, "leather", ctx.gradient, rough=0.74),
            "pot": materials.honed_stone("pot", pal, "pot", ctx.gradient, rough=0.7, chisel=0.8),
            "rim": materials.honed_stone("rim", pal, "rim", ctx.gradient, rough=0.7, chisel=0.6),
            "cord": materials.honed_stone("cord", pal, "cord", ctx.gradient, rough=0.8, chisel=0.0),
            "paper": materials.honed_stone("paper", pal, "paper", ctx.gradient, rough=0.85, chisel=0.0),
            "ribbon": materials.honed_stone("ribbon", pal, "ribbon", ctx.gradient, rough=0.7, chisel=0.0)}


def model(ctx) -> list:
    P = []
    extra = (ctx.skin or {}).get("extra") or {}
    _BUILD["id"] = (ctx.skin or {}).get("id", ID)
    for name, S, vs, role, bind, tris in sculpts(bool(extra.get("paper_lanterns"))) + skin_extras(extra):
        v, q = S.mesh(VOXEL * vs)
        ob = sdf.to_object(f"{name}_high", v, q, ctx.col)
        ob.data.materials.append(ctx.mats[role])
        P.append(fighter.Part(name, high=ob, tris=tris, bind=bind))
    return P


# ── rig ─────────────────────────────────────────────────────────────────────────────────────────
STAFF_AX = unit((1.0, 0.0, 0.03))                        # the yoke's axis at rest (toward its left end)
KNUCK_R = WRIST_R + unit(GRIP_R + np.array([0.0, -0.01, 0.045]) - WRIST_R) * PROPORTIONS["hand"]
FRONT, UP = Vector((0.0, -1.0, 0.0)), Vector((0.0, 0.0, 1.0))


def _hang_pivot(side):
    _, _, apx, _ = POTS[side]
    return np.array([apx, STAFF_Y, staff_z(apx)])


def rig_extras(ctx) -> None:
    """Re-seat the right arm in the concept's pose (the fist on the yoke above the right shoulder) with the
    rig's own arm lengths; prop.R runs along the yoke from the grip toward its left end (the off hand's
    `to_prop` grips and every `aim` mean the yoke's axis). Adds the pot gimbals x_hang_r / x_hang_l
    (deforming, children of prop.R, kept plumb by _resolve_plumb) and the VFX sockets: x_pot_r / x_pot_l
    (the pot windows' centres), x_sling_pouch (the sling pouch under the right end: the lob origin) and x_pellet (its mouth)."""
    arm = ctx.info.armature
    scene.select_only([arm], arm)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones

    def put(name, head, tail, z):
        b = eb[name]
        b.head, b.tail = Vector(tuple(head)), Vector(tuple(tail))
        b.align_roll(z)

    put("upper_arm.R", SH_R, ELBOW_R, FRONT)
    put("forearm.R", ELBOW_R, WRIST_R, FRONT)
    put("hand.R", WRIST_R, KNUCK_R, FRONT)
    put("prop.R", GRIP_R, GRIP_R + STAFF_AX * 0.12, UP)
    # prop.L through the hole of the hanging left fist, along +X (the fist's finger rolls run along X): the off
    # hand's `to_prop` grips then close the fist round the yoke instead of floating beside it
    put("prop.L", HAND_L_C + (0.0, -0.012, 0.008), HAND_L_C + (0.12, -0.012, 0.008), FRONT)
    made = []

    def new(name, head, tail, parent, deform, z=FRONT):
        b = eb.new(name)
        b.head, b.tail = Vector(tuple(head)), Vector(tuple(tail))
        b.align_roll(z)
        b.parent = eb[parent]
        b.use_deform = deform
        made.append(name)

    for side in ("R", "L"):
        px, z0, _, _ = POTS[side]
        sl = side.lower()
        piv = _hang_pivot(side)
        new(f"x_hang_{sl}", piv, (px, STAFF_Y, z0 + POT_H * 0.5), "prop.R", True)
        c = np.array([px, STAFF_Y, z0 + 0.112])
        new(f"x_pot_{sl}", c, c + (0, 0, 0.08), f"x_hang_{sl}", False)
    pc = np.array([POUCH_X, STAFF_Y - 0.004, staff_z(POUCH_X) - 0.118])
    new("x_sling_pouch", pc, pc - STAFF_AX * 0.1, "prop.R", False, UP)
    pel = pc + np.array([0.0, -0.02, 0.085])                  # the amber bead in the pouch mouth (loaded)
    new("x_pellet", pel, pel + (0, 0, 0.05), "prop.R", False)
    bpy.ops.object.mode_set(mode="OBJECT")
    for nm in made:
        arm.pose.bones[nm].rotation_mode = "XYZ"
    for b in arm.data.bones:
        ctx.info.lengths[b.name] = b.length
    J = ctx.info.joints
    J["elbow.R"], J["wrist.R"], J["knuckle.R"] = Vector(tuple(ELBOW_R)), Vector(tuple(WRIST_R)), Vector(tuple(KNUCK_R))


# ── paint: the concept projection + Odrum's own fixes (wraps project.paint / project.recolour, this process only) ──
from common.hifi import project  # noqa: E402

_BUILD = {"id": ID}
_paint0 = project.paint
KEY_LIGHT = unit((-0.45, -0.55, 0.70))                    # the concept's key: upper left of the front view
SHEEN = unit((-0.2, -0.45, 0.87))
WALNUT = "#A88762"                                        # oiled pale walnut (the concept's bar, a shade deeper)
# the yoke's props are not painted on the concept at the yoke's built length: they paint procedurally, in the
# concept's palette and light (oiled pale walnut, wound leather, glossy amber lampresin)
PROCEDURAL = {"staff": "walnut", "staff_wraps": "band", "staff_caps": "amber", "pouch": "pouch",
              "resin_R": "resin", "resin_L": "resin", "wrap_L": "wrap", "wrap_R": "wrap"}
# near-flat tops streak under a front/back projection (radial pinwheels from above): there the part's own
# side paint is laid on in felt/stone value noise and the key light
DESTREAK = ("cap", "mask", "head", "pot_R", "pot_L", "pot_rim_R", "pot_rim_L")
# projected parts cleaned of stray texels (background specks, a saturated sliver at a slit)
DESPECKLE = ("cap", "head", "mask", "coat", "straps", "belt", "skirt", "trousers", "boots", "hand_L", "hand_R",
             "pot_R", "pot_L", "pot_rim_R", "pot_rim_L")


def _hex(h):
    return np.asarray(scene.hex_srgb(h), dtype=np.float32)


def _smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _light(n, base=0.72, k=0.34):
    lam = np.clip(n @ KEY_LIGHT, 0.0, 1.0)
    return lam, base + k * lam + 0.05 * np.clip(n[:, 2], 0, 1)


def _axis_frame(a, b):
    d = unit(np.asarray(b, dtype=np.float64) - np.asarray(a, dtype=np.float64))
    e1 = unit(np.cross(d, (0.0, 0.0, 1.0)) if abs(d[2]) < 0.9 else np.cross(d, (1.0, 0.0, 0.0)))
    return np.asarray(a, dtype=np.float64), d, e1, np.cross(d, e1)


def _cyl(P, a, b):
    """(along, angle) of points about the axis a -> b"""
    o, d, e1, e2 = _axis_frame(a, b)
    q = P - o
    return q @ d, np.arctan2(q @ e2, q @ e1)


WRAP_AXES = {"wrap_L": ((0.262, -0.008, 1.06), (0.281, -0.025, 0.89)),
             "wrap_R": (tuple(ELBOW_R + unit(WRIST_R - ELBOW_R) * 0.07), tuple(WRIST_R))}


def _procedural(kind, name, P, N):
    """sRGB colour (n, 3) for the texels of a procedurally painted part (rest-pose points and normals)"""
    lam, shade = _light(N)
    if kind == "walnut":                                  # oiled pale walnut: long grain lines, broad tone drift
        u = P[:, 0]
        ang = np.arctan2(P[:, 2] - staff_z(u), P[:, 1] - STAFF_Y)
        grain = NOISE(np.stack([u * 2.4, np.cos(ang) * 1.7, np.sin(ang) * 1.7], 1), 1.0)
        tone = NOISE(np.stack([u * 0.9, np.cos(ang) * 0.4, np.sin(ang) * 0.4], 1), 1.0, offset=(3.1, 0.0, 0.0))
        lines = np.exp(-(grain / 0.07) ** 2)
        col = _hex(WALNUT)[None, :] * ((1.0 + 0.12 * tone) * (1.0 - 0.26 * lines)
                                       * (1.0 + 0.04 * NOISE(P, 140.0)))[:, None]
        col *= (0.86 + 0.18 * lam)[:, None]
        col += 0.06 * np.clip(N @ SHEEN, 0, 1)[:, None] ** 14
    elif kind == "band":                                  # wound leather cord
        col = _hex("#5E4433")[None, :] * ((1.0 + 0.10 * NOISE(P, 60.0)) * shade)[:, None]
    elif kind == "pouch":                                 # soft leather bag, darker at its bottom
        z0 = staff_z(POUCH_X) - 0.19
        dark = 0.80 + 0.20 * np.clip((P[:, 2] - z0) / 0.12, 0, 1)
        col = _hex("#6A4A34")[None, :] * ((1.0 + 0.08 * NOISE(P, 45.0) + 0.04 * NOISE(P, 130.0)) * dark * shade)[:, None]
    elif kind == "amber":                                 # glossy amber lampresin: deep body, bright lit face, a hot spot
        deep, mid, hi = _hex("#7C3D10"), _hex("#D08A38"), _hex("#F4D29A")
        f = np.clip(N @ KEY_LIGHT, -0.2, 1.0)
        col = deep + (mid - deep) * _smooth(-0.2, 0.55, f)[:, None] + (hi - mid) * _smooth(0.72, 0.97, f)[:, None]
    elif kind == "resin":                                 # the resin in a pot mouth: warm amber, darker at the rim
        side = name[-1]
        px = POTS[side][0]
        rr = np.hypot(P[:, 0] - px, P[:, 1] - STAFF_Y) / 0.079
        col = _hex("#E4AE62")[None, :] + (_hex("#A25E20") - _hex("#E4AE62"))[None, :] * np.clip(rr, 0, 1)[:, None] ** 1.7
        hl = np.exp(-(((P[:, 0] - px + 0.026) ** 2 + (P[:, 1] - STAFF_Y + 0.03) ** 2) / 0.00030))
        col = col * (1.0 + 0.05 * NOISE(P, 60.0))[:, None] + 0.30 * hl[:, None]
    elif kind == "wrap":                                  # leather strips wound in a spiral round the forearm
        a, b = WRAP_AXES[name]
        t, ang = _cyl(P, a, b)
        s = np.sin(2 * math.pi * t / 0.026 + ang)
        strip = _smooth(-0.55, 0.35, s)
        edge = np.exp(-((s - 0.55) / 0.22) ** 2)
        col = _hex("#2C1E16")[None, :] + (_hex("#5C4130") - _hex("#2C1E16"))[None, :] * strip[:, None]
        col = col + 0.06 * edge[:, None]
        col *= ((1.0 + 0.07 * NOISE(P, 70.0)) * shade)[:, None]
    else:
        raise ValueError(kind)
    return np.clip(col, 0.0, 1.0)


def _paint_lit(maps, plates, vis, names, tops=None, flat=None, **kw):
    """project.paint with Odrum's fixes, in order:
      * the pots sample the concept at their PAINTED place (POT_SHIFT: the built yoke is longer than the
        painted one and the pots hang higher), so each pot keeps its own painting;
      * the yoke's bar, bands, amber caps and sling pouch, the resin in the pot mouths and the forearm wraps
        paint procedurally (_procedural): the projection put background and the gripping hand on the bar and
        smeared the wraps' sides;
      * near-flat tops (cap crown, mask band, pot rims and bottoms) take their part's side paint in value
        noise and the key light instead of the projection's radial streaks;
      * stray texels (background specks, saturated slivers) on projected parts take their neighbours' paint;
      * every flat-painted part (cords, skin extras) is shaded like the painting around it.
    Logs the painted mean colour of every part (sRGB) to art/renders/fighters/odrum/paint_means_<build>.json."""
    bleed = kw.pop("bleed", True)
    part, N, Pw = maps["part"], maps["N"], maps["P"]
    P2 = Pw.copy()
    for side, d in POT_SHIFT.items():
        for nm in (f"pot_{side}", f"pot_rim_{side}"):
            if nm in names:
                P2[part == names.index(nm)] -= d.astype(np.float32)
    out = _paint0(dict(maps, P=P2), plates, vis, names, tops=tops, flat=flat, bleed=False, **kw)
    # stray texels on projected parts
    lum = out @ LUMA
    mx, mn = out.max(axis=2), out.min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1e-4)
    bad = np.zeros(part.shape, dtype=bool)
    for nm in DESPECKLE:
        if nm not in names:
            continue
        m = part == names.index(nm)
        if not m.any():
            continue
        L = lum[m]
        med = float(np.median(L))
        mad = float(np.median(np.abs(L - med))) + 1e-3
        b = (L > med + 7.0 * mad + 0.10) & (sat[m] < 0.30)                  # pale background specks
        if nm in ("coat", "skirt", "straps", "belt", "trousers"):
            c = out[m]
            b |= (c[:, 0] > 0.45) & (c[:, 0] > 2.4 * c[:, 1]) & (c[:, 0] > 2.4 * c[:, 2])   # a red sliver
        bm = np.zeros_like(m)
        bm[m] = b
        bad |= bm
        if b.any():
            scene.log(f"odrum paint: {int(b.sum())} stray texels on {nm}")
    if bad.any():
        iy, ix = project.nearest_index((part >= 0) & ~bad)
        out[bad] = out[iy, ix][bad]
    # de-streaked tops
    for nm in DESTREAK:
        if nm not in names:
            continue
        m = part == names.index(nm)
        if not m.any():
            continue
        n = N[m]
        sidem = np.abs(n[:, 2]) < 0.35
        if sidem.sum() < 16:
            continue
        ref = np.median(out[m][sidem], axis=0)
        w = _smooth(0.42, 0.80, np.abs(n[:, 2]))
        if not (w > 0).any():
            continue
        p = Pw[m].astype(np.float64)
        lam, shade = _light(n, 0.80, 0.26)
        under = np.where(n[:, 2] < 0, 0.62, 1.0)
        brk = 1.0 + 0.07 * NOISE(p, 28.0) + 0.04 * NOISE(p, 85.0)
        top = ref[None, :] * (shade * under * brk)[:, None]
        out[m] = out[m] * (1.0 - w[:, None]) + np.clip(top, 0, 1) * w[:, None]
    # procedural props
    for nm, kind in PROCEDURAL.items():
        if nm not in names:
            continue
        m = part == names.index(nm)
        if m.any():
            out[m] = _procedural(kind, nm, Pw[m].astype(np.float64), N[m].astype(np.float64))
    # flat-painted parts take the light
    for name in (flat or {}):
        if name not in names or name in PROCEDURAL:
            continue
        m = part == names.index(name)
        if not m.any():
            continue
        n = N[m]
        lam = np.clip(n @ KEY_LIGHT, 0.0, 1.0)
        shade = 0.70 + 0.36 * lam + 0.06 * np.clip(n[:, 2], 0, 1)
        brk = 1.0 + 0.05 * NOISE(Pw[m].astype(np.float64), 34.0)
        col = out[m] * (shade * brk)[:, None]
        col[:, 2] *= 1.0 + 0.06 * (1.0 - lam)                # cool shadow side
        out[m] = np.clip(col, 0.0, 1.0)
    if bleed:
        iy, ix = project.nearest_index(part >= 0)
        out = out[iy, ix]
    means = {}
    for i, nm in enumerate(names):
        m = part == i
        if m.any():
            c = (np.clip(out[m].mean(axis=0), 0, 1) * 255).round().astype(int)
            means[nm] = {"hex": "#%02X%02X%02X" % tuple(c), "texels": int(m.sum())}
    try:
        scene.write_json(os.path.join(scene.RENDERS_DIR, "fighters", ID, f"paint_means_{_BUILD['id']}.json"), means)
    except Exception as e:  # noqa: BLE001
        scene.log(f"paint means not written: {e}")
    return out


LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
project.paint = _paint_lit
_recolour0 = project.recolour
# The skins' palettes (brief section 9) are authored against the brief's base palette (section 5), not against
# the painting's own (darker, warmer) means: a skin's change is skin / brief-base, applied to the painting, so
# the painted values keep their relationships (the approved look's value gradient) in the skin's colours. The yoke
# is painted procedurally in WALNUT, so that is its wood reference (a skin's named yoke colour lands as named).
BRIEF_BASE = {"sandstone": "#D8C19D", "cloth2": "#CDBFA8", "wood": WALNUT, "wood_dark": "#634C3E",
              "cloth": "#8D7D6B", "lampresin": "#C48D4A", "leather": "#4D3D32", "under": "#3A3532",
              "ironstone": "#453B35", "pot": "#D8C19D", "rim": "#D8C19D", "cord": "#4D3D32"}
SHADEPRINT = {"ink": "#2B2A33", "pale": "#B7B4BE",
              "lift": ("cap", "head", "mask", "hand_L", "hand_R", "staff", "pot_rim_R", "pot_rim_L"), "lift_k": 1.55,
              "deep": ("trousers", "boots", "belt", "straps", "wrap_L", "wrap_R", "pouch", "staff_wraps"), "deep_k": 0.55,
              "wash": ((0.45, 0.72, 1.02, 1.38), (0.30, 0.55, 0.95, 1.30)),     # jerkin value by height (rest pose)
              "rim": ("coat", "skirt"), "rim_w": 0.36}


def _recolour_value(img, maps, names, roles, base_pal, skin_pal, skip=None, log=print):
    """A skin from the base painting, role by role, relative to the BRIEF's base palette (BRIEF_BASE):
      * a small change (per-channel gains within 1.5x of each other) keeps the painted hue play: each texel is
        multiplied by skin / brief-base per channel (linear light);
      * a hue change (Odrum's painting is warm brown throughout; a lilac-grey or ink skin needs gains far apart)
        keeps the painting's VALUE instead: each texel becomes the skin colour at the texel's luminance relative
        to the brief-base colour's;
      * Shadeprint then washes ink up from the jerkin's hem, lifts the shoulders toward the pale, and rims the
        cloth's side-facing edges in pale (the print's light-rimmed edges)."""
    part = maps["part"]
    iy, ix = project.nearest_index(part >= 0)
    pid = part[iy, ix]
    lin = project._lin(img)
    out = lin.copy()
    skip = skip or set()
    contrast = 1.18 if _BUILD["id"] == "odrum_shadeprint" else 1.0
    for i, n in enumerate(names):
        r = roles.get(n)
        if n in skip or not r or r == "accent" or r not in skin_pal or r not in base_pal:
            continue
        if str(base_pal[r]).lower() == str(skin_pal[r]).lower():
            continue
        ref = project._lin(scene.hex_srgb(BRIEF_BASE.get(r, base_pal[r])))
        tgt = project._lin(scene.hex_srgb(skin_pal[r]))
        gain = tgt / np.maximum(ref, 1e-4)
        spread = float(gain.max() / max(float(gain.min()), 1e-4))
        w = float(np.clip((spread - 1.15) / 0.35, 0.0, 1.0))
        m = pid == i
        Y = lin[m] @ LUMA
        Yr = max(float(ref @ LUMA), 1e-4)
        val = tgt[None, :] * np.clip(Y / Yr, 0.0, 4.0)[:, None] ** contrast
        out[m] = (lin[m] * np.clip(gain, 0.02, 12.0)) * (1.0 - w) + val * w
        log(f"  recolour {n} ({r}): {BRIEF_BASE.get(r, base_pal[r])} -> {skin_pal[r]}, spread {spread:.2f}, value weight {w:.2f}")
    if _BUILD["id"] == "odrum_shadeprint":
        P = maps["P"][iy, ix].astype(np.float64)
        Nn = maps["N"][iy, ix].astype(np.float64)
        ink = project._lin(scene.hex_srgb(SHADEPRINT["ink"]))
        pale = project._lin(scene.hex_srgb(SHADEPRINT["pale"]))

        def sel(nm):
            return pid == names.index(nm) if nm in names else None
        for nm in SHADEPRINT["lift"]:                 # pale above: the cap, mask, hands and the yoke lift toward paper
            m = sel(nm)
            if m is not None:
                out[m] = np.clip(out[m] * SHADEPRINT["lift_k"], 0.0, 0.92)
        for nm in SHADEPRINT["deep"]:                 # ink below: trousers, boots, straps and wraps sink to ink
            m = sel(nm)
            if m is not None:
                out[m] = out[m] * SHADEPRINT["deep_k"]
        zs, ks = SHADEPRINT["wash"]
        for nm in ("coat", "skirt"):                  # the jerkin washes from pale shoulders to an ink hem, brushy
            m = sel(nm)
            if m is None:
                continue
            p = P[m].reshape(-1, 3)
            z = p[:, 2] + 0.06 * NOISE(p * np.array([1.0, 1.0, 0.35]), 7.0) + 0.02 * NOISE(p, 30.0)
            k = np.interp(z, zs, ks)
            Y = out[m] @ LUMA
            inkish = ink[None, :] * np.clip(Y / max(float(Y.mean()), 1e-4), 0.5, 1.6)[:, None]
            w = np.clip((0.75 - k) / 0.45, 0.0, 1.0)[:, None]            # the low part takes the ink's hue
            out[m] = (out[m] * (1.0 - w) + inkish * w) * k[:, None]
        for nm in SHADEPRINT["rim"]:                  # light-rimmed edges: side-facing texels catch a pale rim
            m = sel(nm)
            if m is None:
                continue
            n = Nn[m].reshape(-1, 3)
            rim = (_smooth(0.74, 0.97, np.abs(n[:, 0])) * (n[:, 2] > -0.4) * SHADEPRINT["rim_w"])[:, None]
            out[m] = out[m] * (1.0 - rim) + pale[None, :] * 0.85 * rim
        log("  shadeprint: pale above, ink wash on the jerkin, ink below, light-rimmed edges")
    return project._srgb(out).astype(np.float32)


project.recolour = _recolour_value


# ── the pots hang plumb: a resolve pass after the IK (wraps anim.resolve in this build process only) ──
_HANG = ("x_hang_r", "x_hang_l")
_resolve0 = anim.resolve


def _resolve_plumb(skel, pose: dict) -> dict:
    """anim.resolve, then the pot gimbals counter-rotate the yoke's posed rotation so the cords and pots
    hang straight down from their knots whatever the bar does. Pose keys (they stay in the resolved pose:
    bone-keyed consumers ignore them, so a second resolve gives the same pots):
      "_rigid" (w, 0, 0)    blends toward rigid-on-the-staff (1 = the pots turn with the bar);
      "_swing" (r, l, 0)    flings each pot OUTWARD from plumb by r / l degrees, away from the body's vertical
                            axis (the hips): the centrifugal swing-out of a whirl or a whip of the bar;
      "_fling" (w, s, 0)    blends each pot toward lying ALONG the bar, outward from the point s m from the
                            right fist along the bar (the centre of a spinning bar: the ult's windmill);
    and always: a pot never goes through the ground (it tips outward / its fling eases just enough)."""
    pose = dict(pose)
    rigid = pose.get("_rigid", (0.0, 0.0, 0.0))[0]
    swing = pose.get("_swing", (0.0, 0.0, 0.0))
    fling = pose.get("_fling", (0.0, 0.0, 0.0))
    out = _resolve0(skel, pose)
    if _HANG[0] not in skel.rest or (rigid >= 0.999 and fling[0] <= 1e-3):
        return out
    M = skel.fk(out)
    centre = M["hips"].translation
    axis = M["prop.R"].to_3x3().col[1].normalized()
    for b, sw, side in zip(_HANG, (swing[0], swing[1]), ("R", "L")):
        Pm = (M[skel.parent[b]] @ skel.local[b]).to_3x3()
        rest = skel.rest[b].to_3x3()
        knot = M[b].translation
        r = knot - centre
        r.z = 0.0
        out_ax = r.normalized().cross(Vector((0.0, 0.0, 1.0))) if r.length > 1e-4 else Vector((1.0, 0.0, 0.0))
        want = rest
        if abs(sw) > 1e-3:
            want = Matrix.Rotation(math.radians(sw), 3, out_ax) @ want
        q = (Pm.inverted() @ want).to_quaternion()
        if rigid > 1e-4:
            q = q.slerp(Quaternion(), min(rigid, 1.0))
        if fling[0] > 1e-3:
            s_knot = (POTS[side][2] - GRIP_R[0]) / STAFF_AX[0]
            d_out = axis * (1.0 if s_knot >= fling[1] else -1.0)
            wf = (rest.col[1].normalized().rotation_difference(d_out).to_matrix() @ rest)
            qf = (Pm.inverted() @ wf).to_quaternion()
            q0 = q

            def at(w):
                return q0.slerp(qf, w)
            w = min(fling[0], 1.0)
            if _pot_low(knot, Pm, at(w)) < 0.03:
                lo, hi = 0.0, w
                for _ in range(10):
                    mid = 0.5 * (lo + hi)
                    lo, hi = (mid, hi) if _pot_low(knot, Pm, at(mid)) >= 0.03 else (lo, mid)
                w = lo
            q = at(w)
        if _pot_low(knot, Pm, q) < 0.02:                       # tip the pot outward off the ground
            q1 = q
            lo, hi = 0.0, 90.0
            for _ in range(10):
                mid = 0.5 * (lo + hi)
                qq = (Pm.inverted() @ Matrix.Rotation(math.radians(mid), 3, out_ax) @ (Pm @ q1.to_matrix())).to_quaternion()
                lo, hi = (lo, mid) if _pot_low(knot, Pm, qq) >= 0.02 else (mid, hi)
            q = (Pm.inverted() @ Matrix.Rotation(math.radians(hi), 3, out_ax) @ (Pm @ q1.to_matrix())).to_quaternion()
        out[b] = skel.euler_of(q.to_matrix())
    return out


POT_REACH = POT_DROP + POT_H * 0.5                      # knot to the pot's centre along the hang bone


def _pot_low(knot, Pm, q) -> float:
    """lowest point (z) of a pot whose hang bone is at `knot` with parent frame Pm and local rotation q"""
    d = (Pm @ q.to_matrix()).col[1].normalized()
    c = knot + d * POT_REACH
    return c.z - 0.135 * abs(d.z) - 0.16 * math.sqrt(max(0.0, 1.0 - d.z * d.z))   # belly + window pads


anim.resolve = _resolve_plumb


# ── motion ──────────────────────────────────────────────────────────────────────────────────────
MOTION = anim.motion_profile(weight="medium", weapon="staff", stance="neutral", run_ref_speed=3.35)
HT, Aim, FT, P = anim.HandTarget, anim.Aim, anim.FootTarget, anim.P
PIV = Vector((0.0, 0.17, staff_z(0.0)))                  # behind the neck: the yoke turns about it on the shoulders
GRIP0, WRIST0, AX0 = Vector(tuple(GRIP_R)), Vector(tuple(WRIST_R)), Vector(tuple(STAFF_AX))
ARM_BONES = ("upper_arm.L", "forearm.L", "hand.L", "upper_arm.R", "forearm.R", "hand.R")


def yoke_rot(yaw=0.0, tilt=0.0, roll=0.0) -> Matrix:
    """the yoke's rotation from rest: `tilt` raises its left (+X) end in the frontal plane, `yaw` brings its
    right end (the sling) forward, `roll` turns it about its own axis (degrees)"""
    return (Matrix.Rotation(math.radians(yaw), 3, "Z") @ Matrix.Rotation(math.radians(-tilt), 3, "Y")
            @ Matrix.Rotation(math.radians(roll), 3, AX0))


def yoke_about(pivot, yaw=0.0, tilt=0.0, move=(0.0, 0.0, 0.0)):
    """(grip, axis) of the yoke turned about `pivot` (armature space) and moved"""
    R = yoke_rot(yaw, tilt)
    return Vector(pivot) + R @ (GRIP0 - Vector(pivot)) + Vector(move), R @ AX0


_POLES: dict = {}                                        # the rest arms' elbow poles (chest frame), set in clip_overrides


def hold(grip, axis, left=None, pole_r=None, pole_l=(0.8, 0.4, -0.4), rigid=0.0) -> dict:
    """IK for the yoke in the right fist with its grip at `grip` and its axis along `axis`; `left` = the off
    hand's grip along the yoke (m from the right fist toward the left end) or a HandTarget"""
    axis = Vector(axis).normalized()
    q = AX0.rotation_difference(axis)
    wrist = Vector(grip) - q @ (GRIP0 - WRIST0)
    ik = {"hand.R": HT(pos=tuple(wrist), pole=pole_r or _POLES.get("R")), "aim.R": Aim(tuple(axis))}
    if isinstance(left, (int, float)):
        ik["hand.L"] = HT(to_prop=("prop.R", float(left)), pole=pole_l)
    elif left is not None:
        ik["hand.L"] = left
    out = {"ik": ik}
    if rigid:
        out["_rigid"] = (rigid, 0.0, 0.0)
    return out


def ride(skel, body: dict, grip, axis, left=None, **kw) -> dict:
    """hold() for a yoke placed in the CHEST's frame: (grip, axis) are rest-space values (yoke_about(...)) carried
    by the chest of `body` (its hips offset and torso rotations), so the bar rides the shoulders through a lean,
    a twist or a recoil instead of staying put in the world while the head moves into it"""
    b = {k: v for k, v in body.items() if k != "ik"}
    M = skel.fk(_resolve0(skel, b))
    R = M["chest"].to_3x3() @ skel.rest["chest"].to_3x3().inverted()
    t = M["chest"].translation - R @ skel.rest["chest"].translation
    axis = Vector(axis).normalized()
    wrist = Vector(grip) - AX0.rotation_difference(axis) @ (GRIP0 - WRIST0)     # hold()'s wrist, in rest space
    h = hold(R @ Vector(grip) + t, R @ axis, left, **kw)
    # the wrist carried by the chest too (not re-derived from the turned axis): the arm keeps its rest bend, so
    # the coat's raised sleeve never stretches into a fin at the elbow
    h["ik"]["hand.R"] = HT(pos=tuple(R @ wrist + t), pole=kw.get("pole_r") or _POLES.get("R"))
    return h


def with_hips(p: dict, d) -> dict:
    hx, hy, hz = p.get("hips_loc", (0.0, 0.0, 0.0))
    p = dict(p)
    p["hips_loc"] = (hx + d[0], hy + d[1], hz + d[2])
    return p


def pose(base: dict, torso: dict | None = None, hips=(0.0, 0.0, 0.0), *extra) -> dict:
    """base + additive torso deltas + hips offset, then IK / FK overrides merged (ik dicts merge)"""
    p = anim.add(base, torso or {})
    p = with_hips(p, hips)
    for e in extra:
        p = anim.merge(p, e)
    return p


def feet_from(g: dict, dl=(0.0, 0.0, 0.0), dr=(0.0, 0.0, 0.0), pl=None, pr=None) -> dict:
    fl, fr = g["ik"]["foot.L"], g["ik"]["foot.R"]
    return {"ik": {"foot.L": FT(tuple(fl.ankle[i] + dl[i] for i in range(3)), fl.pitch if pl is None else pl, fl.yaw),
                   "foot.R": FT(tuple(fr.ankle[i] + dr[i] for i in range(3)), fr.pitch if pr is None else pr, fr.yaw)}}


def lhand(x, y, z, pole=(0.9, 0.3, -0.4), w=1.0) -> dict:
    return {"ik": {"hand.L": HT(pos=(x, y, z), pole=pole, weight=w)}}


def strike(name, frames, g, wind, hit, fol, lags=None):
    fn = anim.keyed(anim.strike_keys(MOTION, wind, hit, fol, g))
    return anim.Clip(name, frames, False, anim.drag(fn, frames, lags or {"head": 1.5, "neck": 1.0}), impact=anim.IMPACT)


def seq(keys):
    """keyed() over (frame fraction, pose, ease) with the poses taken as full poses"""
    return anim.keyed(keys)


def _feet_rest(skel):
    """rest heel points (for orbiting the feet about the body centre in the spin)"""
    out = {}
    for s in ("L", "R"):
        a0 = skel.rest[f"foot.{s}"].translation.copy()
        b0 = skel.rest[f"toe.{s}"].translation.copy()
        out[s] = a0 + Vector((0, 0, -a0.z)) + (a0 - b0) * Vector((1, 1, 0)) * 0.55
    return out


def clip_overrides(ctx) -> dict:
    """Every clip is bespoke: the yoke rides the shoulders in the right fist (the rest pose IS that hold), the
    left arm hangs free. Off the shoulders the yoke turns about the right fist (a positive yaw swings its long left
    part round BEHIND the head, never through it). Gestures (brief section 8):
      idle       breathing under the bar, the pots hanging still
      run        3.35 m/s, the bar steady on the shoulders, the left arm swinging
      attack1    pellet flick: the sling end hauled up over the right shoulder, then whipped down and forward
      attack2    staff jab: the yoke swung to point ahead at the right side and driven forward like a lance, a lunge
      cast_a1    Resin Shot: one loop of the sling end at the right side: off the shoulder, the pour (the right pot
                 tips over the pouch), down past the hip and up behind (the cock), over the top to the release at
                 f12 (pouch high in front, the bar a long diagonal), follow-through at the target, the free arm
                 pointing too, back behind the head onto the shoulders by f30
      cast_a2    Swing Out: a full 360 degree whirl on the spot with the yoke in both hands, the pots flung out
                 wide (a spinning cross from above); it ends leaning into the run (the haste)
      cast_a3    Step and Load: instant (castTime 0): a tucked hop back, the left hand thumbs a pellet from the
                 belt, the bar tipping up to 38 degrees (the sling end low at his right), landing at f8
      cast_ult   Amber Hour: the yoke swings off to the right side and becomes a vertical wheel (two circles and
                 more, the pots flung out along the bar), the free arm out for balance, a lean back, the throw at
                 f18 (the sling end over the top), follow-through low, back onto the shoulders by f45
      death      recoils, drops to his knees as the yoke swings off behind his head, rises upright at his side and
                 is set down in front of him; he slumps over his knees
      recall     on one knee under the yoke, head bowed; a shrug settles the pots, then a deeper bow
      idle_lobby reaches out and taps the near pot at the yoke's end, dips a finger in its resin, pulls a thread,
                 rolls it, bobs to a tune
      victory    pops the yoke off the shoulders and catches it, left fist on the hip, a small bow with the cap
                 tipped, one foot forward (hold)
      dash       a tucked hop under the bar; stunned: the bar slipped off the left shoulder, its long end sagging;
                 channel: the free hand raised"""
    prof = MOTION
    skel = anim.Skeleton(ctx.info.armature)
    g = anim.stance(prof)
    hip_h = skel.rest_point("hips").z
    out = {}
    osc = anim.osc
    # the guard as IK targets that reproduce the FK rest exactly (the fist on the yoke, the left arm hanging):
    # every gesture blends IK to IK from it, never FK to IK (large Euler blends swing the bar through the body)
    M = skel.fk(_resolve0(skel, g))
    Rc = M["chest"].to_3x3() @ skel.rest["chest"].to_3x3().inverted()
    rest_ik = {}
    for sd in ("R", "L"):
        sh, el, wr = (M[f"{b}.{sd}"].translation for b in ("upper_arm", "forearm", "hand"))
        a = (wr - sh).normalized()
        e = el - sh
        _POLES[sd] = tuple(Rc.inverted() @ (e - a * e.dot(a)).normalized())
        rest_ik[sd] = HT(pos=tuple(wr), pole=_POLES[sd])
    gI = anim.merge(g, {"ik": {"hand.R": rest_ik["R"], "aim.R": Aim(tuple(M["prop.R"].to_3x3().col[1].normalized()))}})

    # IDLE (72, loop)
    def idle_s(t):
        b, w = osc(t, 2), osc(t, 1, 0.1)
        d = P(chest=(1.2 * b, 0, 0), spine=(0.5 * b, 0, 0.6 * w), neck=(-0.8 * b, 0, 0), head=(-0.4 * b, 1.5 * w, 0),
              hips=(0, 1.2 * w, -1.0 * w), shoulder_L=(0, 0, 1.2 * b), shoulder_R=(0, 0, -1.0 * b),
              upper_arm_L=(1.5 * w, 0, 0), forearm_L=(3.0 + 2.0 * b, 0, 0))
        return with_hips(anim.add(g, d), (0.012 * w, 0.0, -0.004 * (0.5 + 0.5 * b)))
    out["idle"] = anim.Clip("idle", 72, True, idle_s)

    # RUN (the shared run cycle for the legs, torso and bob; the yoke stays on the shoulders)
    base_run = anim.gen_run(prof)

    def run_s(t):
        p = dict(base_run.sample(t))
        for b in ARM_BONES:
            p.pop(b, None)
        p["ik"] = {k: v for k, v in p["ik"].items() if k.startswith("foot")}
        for b, k in (("chest", 0.55), ("spine", 0.6)):
            x, y, z = p[b]
            p[b] = (x, y * k, z)
        sw = math.cos(2 * math.pi * (t % 1.0 - 0.03))
        p["upper_arm.L"] = (-24.0 * sw + 4.0, 0.0, 2.0)
        p["forearm.L"] = (24.0 + 16.0 * max(0.0, -sw), 0.0, 0.0)
        p["hand.L"] = (4.0, 0.0, 0.0)
        p["upper_arm.R"] = (0.0, 0.0, 0.0)
        return p
    out["run"] = anim.Clip("run", base_run.frames, True, run_s, meta=dict(base_run.meta))

    # the yoke's contact points on the shoulders: a yaw about the RIGHT one swings the bar's left part back,
    # away from the head (the sling end forward); a yaw about the LEFT one swings its right part back
    PR = Vector((-0.25, 0.17, staff_z(-0.25)))
    PL = Vector((0.20, 0.17, staff_z(0.20)))

    def swing(r, l=None):
        return {"_swing": (float(r), float(r if l is None else l), 0.0)}

    # The yoke turns about the RIGHT FIST in both basic attacks: a positive yaw about the fist swings the long left
    # part round BEHIND the head (never through it) and brings the sling end forward.
    # ATTACK1 (25, f10): the pellet flick. The fist hauls the sling end up and back over the right shoulder (f0-f6,
    # the long part dipping at the left), then whips it down and forward past the right hip (f10, the long part
    # flung up behind the head, the pots flung outward), a short hold, home by f25. Silhouette: a seesaw, then a
    # long diagonal from high behind-left to low in front-right.
    free_back = P(upper_arm_L=(-16, 0, 2), forearm_L=(18, 0, 0))
    free_fwd = P(upper_arm_L=(20, 0, 6), forearm_L=(30, 0, 0))
    out["attack1"] = strike(
        "attack1", 25, gI,
        pose(g, P(hips=(0, -8, 0), spine=(-3, -8, 0), chest=(-6, -12, 3), head=(2, 10, 0)), (0, 0.02, 0.0),
             hold(*yoke_about(GRIP0, 8, -30, (0.02, 0.05, 0.10))), free_fwd, swing(6, 0)),
        pose(g, P(hips=(4, 14, 0), spine=(6, 10, 0), chest=(8, 16, -4), head=(-4, -12, 0)), (0, -0.04, -0.03),
             hold(*yoke_about(GRIP0, 50, 22, (-0.06, -0.12, -0.10))), free_back, swing(40, 12)),
        pose(g, P(hips=(5, 16, 0), spine=(7, 11, 0), chest=(9, 18, -5), head=(-5, -13, 0)), (0, -0.045, -0.035),
             hold(*yoke_about(GRIP0, 56, 26, (-0.07, -0.14, -0.12))), free_back, swing(28, 8)))

    # ATTACK2 (25, f10): the staff jab. The yoke swings off the shoulder to point ahead at his right side, the fist
    # drawn back (f0-f6), then the fist drives it straight forward like a lance with a lunge on the left foot (f10);
    # held, home by f25. Silhouette: the bar from across the shoulders to a long lance along the right side.
    lunge = feet_from(g, dl=(0.0, -0.20, 0.0))
    out["attack2"] = strike(
        "attack2", 25, gI,
        pose(g, P(hips=(-2, -10, 0), spine=(-2, -6, 0), chest=(-4, -10, 0), head=(2, 10, 0)), (0, 0.04, -0.03),
             hold(*yoke_about(GRIP0, 42, -5, (-0.04, 0.10, -0.04))), free_fwd, swing(4, 0)),
        pose(g, P(hips=(8, 16, 0), spine=(6, 10, 0), chest=(6, 14, 0), head=(-4, -14, 0)), (0, -0.12, -0.06),
             hold(*yoke_about(GRIP0, 88, 4, (-0.08, -0.36, -0.12))), free_back, lunge, swing(16, 6)),
        pose(g, P(hips=(9, 17, 0), spine=(7, 11, 0), chest=(7, 15, 0), head=(-5, -15, 0)), (0, -0.13, -0.065),
             hold(*yoke_about(GRIP0, 90, 5, (-0.08, -0.40, -0.13))), free_back, lunge, swing(8, 4)))

    # CAST_A1 (30, f12) Resin Shot, one long loop of the sling end at the right side: the right fist swings the
    # yoke off the shoulders (f0-f4: the long part sweeps round BEHIND the head until the bar points ahead at his
    # right side), dips the sling end forward so the right pot tips over the pouch (the pour, f7), loops it down
    # past the hip and up behind the shoulder (the cock, f10, leaning back), then over the top: the release at
    # f12 with the pouch high in front and the bar a long diagonal, a step in; the follow-through levels the bar
    # at the target with the free arm pointing too (f15-f20); the bar returns along the right side and sweeps
    # back behind the head onto the shoulders (f25-f30).
    left_on = 0.62
    pole_out = (-0.7, 0.35, -0.6)

    def bar(F, pouch_dir, pole_r=pole_out, left=None, rigid=0.0):
        """the yoke in the right fist at F with its sling (right) end pointing along pouch_dir"""
        return hold(Vector(F), -Vector(pouch_dir).normalized(), left, pole_r=pole_r, rigid=rigid)

    step_in = feet_from(g, dl=(0.0, -0.16, 0.0))
    a1_off = pose(g, P(chest=(0, -4, 2), head=(2, 4, 0)), (0, 0, -0.01), bar((-0.36, 0.12, 1.53), (0.0, -1.0, 0.05), pole_r=None))
    a1_pour = pose(g, P(hips=(3, -4, -1), spine=(4, -4, -2), chest=(6, -6, -3), head=(10, 6, -4)), (0.01, -0.01, -0.04),
                   bar((-0.45, -0.16, 1.44), (-0.05, -0.75, -0.66), rigid=0.75))
    a1_down = pose(g, P(hips=(0, -8, 0), spine=(0, -6, 0), chest=(-2, -8, 0), head=(4, 8, 0),
                        upper_arm_L=(20, 0, 8), forearm_L=(20, 0, 0)), (0.0, 0.01, -0.03),
                   bar((-0.49, -0.04, 1.55), (-0.10, 0.28, -0.95)), swing(10, 0))
    a1_cock = pose(g, P(hips=(-5, -12, 0), spine=(-7, -9, 0), chest=(-9, -13, 0), head=(4, 10, 0),
                        upper_arm_L=(45, 0, 12), forearm_L=(25, 0, 0)), (0, 0.04, -0.01),
                   bar((-0.45, 0.06, 1.70), (-0.06, 0.75, 0.66)), swing(30, 10))
    a1_hit = pose(g, P(hips=(6, 12, 0), spine=(8, 9, 0), chest=(10, 13, 0), head=(-6, -9, 0),
                       upper_arm_L=(-20, 0, 8), forearm_L=(15, 0, 0)), (0, -0.07, -0.03),
                  bar((-0.43, -0.25, 1.66), (-0.12, -0.70, 0.70)), step_in, swing(40, 20))
    a1_fol = pose(g, P(hips=(8, 14, 0), spine=(9, 10, 0), chest=(10, 14, 0), head=(-9, -11, 0),
                       upper_arm_L=(68, 0, 10), forearm_L=(6, 0, 0)), (0, -0.08, -0.04),
                  bar((-0.41, -0.42, 1.42), (-0.08, -0.97, -0.22)), step_in, swing(18, 10))
    a1_aim = pose(g, P(hips=(7, 13, 0), spine=(8, 9, 0), chest=(9, 13, 0), head=(-8, -10, 0),
                       upper_arm_L=(64, 0, 10), forearm_L=(8, 0, 0)), (0, -0.075, -0.035),
                  bar((-0.41, -0.40, 1.43), (-0.08, -0.98, -0.18)), step_in, swing(4, 2))
    a1_back = pose(g, P(chest=(-2, -4, 3)), (0.0, 0.0, -0.015), bar((-0.37, 0.10, 1.55), (0.0, -1.0, 0.04), pole_r=None))
    keys = [(0.0, gI, "linear"), (4 / 30, a1_off, "inout"), (7 / 30, a1_pour, "inout"), (8.5 / 30, a1_down, "linear"),
            (10 / 30, a1_cock, "out"), (anim.IMPACT, a1_hit, "accel"), (15 / 30, a1_fol, "out"), (20 / 30, a1_aim, "linear"),
            (25 / 30, a1_back, "inout"), (1.0, gI, "inout")]
    out["cast_a1"] = anim.Clip("cast_a1", 30, False, anim.drag(seq(keys), 30, {"head": 1.5, "neck": 1.0}), impact=anim.IMPACT)

    # CAST_A2 (30, f12) Swing Out: a full whirl on the spot (f4-f20) with the yoke on the shoulders in both
    # hands, the pots flung out wide by the spin (a spinning cross from above), the feet pivoting on the
    # ground; it ends leaning into the run (the haste), the left foot forward
    heel = _feet_rest(skel)
    fl0, fr0 = g["ik"]["foot.L"], g["ik"]["foot.R"]

    def spin_at(t):
        """body yaw (deg): coil right to -50 by f4, then 410 degrees round to +360 by f20 (fastest at f12)"""
        f = t * 30
        if f <= 4:
            return -50.0 * anim.ease_in_out(f / 4)
        if f <= 20:
            u = (f - 4) / 16
            return -50.0 + 410.0 * anim.sine(u)
        return 360.0

    def a2_s(t):
        f = t * 30
        th = spin_at(t)
        k_in = min(1.0, f / 4)                                  # the off hand climbs onto the bar
        k_out = 1.0 - max(0.0, min(1.0, (f - 17) / 4))
        crouch = 0.05 * math.sin(math.pi * min(1.0, f / 22)) + 0.035 * math.sin(math.pi * max(0.0, min(1.0, (f - 8) / 10))) ** 2
        lean = anim.ease_in_out(max(0.0, min(1.0, (f - 16) / 9)))          # leans into the run from f16, held
        pump = max(0.0, min(1.0, (f - 17) / 5))                 # the freed left arm pumps forward into the run
        p = anim.add(g, P(hips=(8 * lean, th, 0), spine=(4 + 6 * lean, 0, 0), chest=(3 + 5 * lean, 0, 0),
                          neck=(-4 * lean, 0, 0), head=(-7 * lean, 0, 0), upper_arm_L=(30 * pump, 0, 6 * pump),
                          forearm_L=(40 * pump, 0, 0)))
        p = with_hips(p, (0.0, -0.05 * lean, -crouch - 0.035 * lean))
        R = Matrix.Rotation(math.radians(th), 3, "Z")
        ik = {}
        step = Vector((0.0, -0.16 * lean, 0.0))                 # the left foot steps out into the run
        for s_, ft0, h in (("L", fl0, heel["L"]), ("R", fr0, heel["R"])):
            off = R @ (h + Vector(ft0.ankle)) - h
            if s_ == "L":
                off = off + step
            ik[f"foot.{s_}"] = FT((off.x, off.y, 0.0), 0.0, ft0.yaw + th)
        w = k_in * k_out
        if w > 1e-3:
            ik["hand.L"] = HT(to_prop=("prop.R", left_on), pole=(0.8, 0.4, -0.4), weight=w)
        p["ik"] = ik
        sp = 72.0 * math.sin(math.pi * max(0.0, min(1.0, (f - 3) / 25))) ** 0.7     # centrifugal swing-out
        p["_swing"] = (sp, sp, 0.0)
        return p
    out["cast_a2"] = anim.Clip("cast_a2", 30, False, a2_s, impact=anim.IMPACT)

    # CAST_A3 (20, f8) Step and Load: instant (castTime 0, 2 frames of anticipation): a tucked hop back, the left hand
    # thumbs a pellet from the belt (f5), the yoke tips up on the shoulders to 38 degrees (the sling end low at his
    # right), and he lands at f8 with the free hand flicking the pellet toward the pouch (the loaded read)
    def rp(body, yoke, *extra):                      # the yoke riding the chest of `body`
        return pose(body, {}, (0.0, 0.0, 0.0), ride(skel, body, *yoke), *extra)
    a3_dip = rp(pose(g, P(hips=(6, 0, 0), spine=(5, 0, 0), chest=(4, 0, 0)), (0, 0.0, -0.07)), yoke_about(PIV, 0, 8, (0, 0.02, 0)))
    a3_air = rp(pose(g, P(hips=(-6, 4, 0), spine=(-4, 0, 0), chest=(-2, 0, 0), head=(4, 0, 0), thigh_L=(30, 0, 0), thigh_R=(36, 0, 0)),
                     (0, 0.10, 0.11), feet_from(g, dl=(0.0, 0.14, 0.24), dr=(0.0, 0.16, 0.26), pl=-24, pr=-28)),
                yoke_about(PIV, 4, 26, (0, 0.06, 0.02)), lhand(0.10, -0.13, 1.03))
    a3_land = rp(pose(g, P(hips=(10, 6, 0), spine=(6, 2, 0), chest=(4, 4, 0), head=(-6, -6, 0)), (0, 0.02, -0.10),
                      feet_from(g, dl=(0.0, -0.02, 0.0))),
                 yoke_about(PIV, 6, 38, (0, 0.06, 0)), lhand(-0.08, -0.30, 1.12, pole=(0.9, 0.2, -0.5)))
    a3_hold = rp(pose(g, P(hips=(8, 6, 0), spine=(5, 2, 0), chest=(3, 4, 0), head=(-5, -6, 0)), (0, 0.02, -0.085),
                      feet_from(g, dl=(0.0, -0.02, 0.0))),
                 yoke_about(PIV, 6, 37, (0, 0.06, 0)), lhand(-0.06, -0.31, 1.13, pole=(0.9, 0.2, -0.5)))
    gIL = anim.merge(gI, {"ik": {"hand.L": rest_ik["L"]}})
    keys = [(0.0, gIL, "linear"), (2 / 20, anim.merge(a3_dip, {"ik": {"hand.L": rest_ik["L"]}}), "out"), (5 / 20, a3_air, "out"),
            (anim.IMPACT, a3_land, "in"), (11 / 20, a3_hold, "out"), (1.0, gIL, "inout")]
    out["cast_a3"] = anim.Clip("cast_a3", 20, False, anim.drag(seq(keys), 20, {"head": 1.0}), impact=anim.IMPACT)

    out["cast_ult"] = _ult(skel, g, gI)
    out.update(_others(skel, g, gI, rest_ik, hip_h))
    return out



def _ult(skel, g, gI) -> anim.Clip:
    """CAST_ULT (45, f18) Amber Hour. f0-f5 the yoke swings off the shoulders to the right side (yaw about the
    fist, the long part sweeping round behind the head) and the right arm goes up and out, the forearm level, the
    left arm out for balance; f5-f14 two full circles and more of a vertical wheel at his right side (the fist
    turns the bar about the forearm; the pots whip round flung out along the bar, easing only where they would
    reach the ground); f14-f16 a lean back, the sling end cocked low behind; f16-f18 the throw: the sling end
    snaps over the top to high in front, the free arm drives forward; f18-f24 follow-through low in front, the
    pots falling back to plumb; f24-f34 the bar rises level, long end back; f34-f45 back onto the shoulders."""
    N = 45
    W_WM = Vector((-0.60, -0.03, 1.56))                     # upper arm up and out, forearm level and outward
    pole_wm = (0.43, -0.15, 0.89)                           # the elbow up, level with the wrist: the forearm points
                                                            # straight out, so the wheel turns in the side plane
    lean_t = P(hips=(2, -6, -1), spine=(2, -4, -4), chest=(2, -6, -5), head=(0, 8, 4))   # leans off the wheel
    wm = pose(g, lean_t, (0.03, 0.0, -0.03), {"ik": {"hand.R": HT(pos=tuple(W_WM), pole=pole_wm)}},
              feet_from(g, dr=(-0.05, 0.02, 0.0)))

    def axis_for(base, psi):
        p = dict(base)
        p["hand.R"] = (0.0, psi, 0.0)
        p.pop("_rigid", None)
        r = _resolve0(skel, p)
        return skel.fk(r)["prop.R"].to_3x3().col[1].normalized()

    want = Vector((0.0, 1.0, 0.0))
    best = min(range(-180, 180, 2), key=lambda a: -axis_for(wm, a).dot(want))
    psi0 = min((best + d * 0.25 for d in range(-8, 9)), key=lambda a: -axis_for(wm, a).dot(want))
    up = axis_for(wm, psi0 + 15.0)
    sgn = 1.0 if up.z > 0 else -1.0                          # + phi: the long end goes back -> up -> front -> down
    dev = max(abs(axis_for(wm, psi0 + sgn * a).x) for a in range(0, 360, 30))
    scene.log(f"odrum ult wheel: psi0 {psi0:.1f}, sign {sgn:+.0f}, out-of-plane {dev:.2f}")

    # phi = the long end's angle (0 back, 90 up, 180 front, 270 down); the sling end is opposite (phi + 180)
    def phi_at(f):
        if f <= 5:
            return 0.0
        if f <= 14:
            u = (f - 5) / 9
            return 860.0 * (0.35 * u + 0.65 * anim.sine(u))       # two circles and on to the cock (sling low behind)
        if f <= 16:
            return 860.0 - 20.0 * anim.ease_out((f - 14) / 2)      # the lean back coils it a little
        if f <= 18:
            return 840.0 + 195.0 * anim.accel((f - 16) / 2)        # the throw: sling end over the top to high in front
        if f <= 24:
            return 1035.0 + 75.0 * anim.ease_out((f - 18) / 6)     # follow-through, the sling end low in front
        if f <= 34:
            return 1110.0 - 30.0 * anim.sine((f - 24) / 10)        # up to level, long end back
        return 1080.0

    arm_out = (0.60, -0.08, 1.40)                            # the free arm out to the left for balance
    arm_fwd = (0.22, -0.50, 1.46)                            # ... and driving forward at the throw
    torso = {  # frame: (torso delta, hips offset, right wrist, left wrist)
        5: (lean_t, (0.03, 0.0, -0.03), W_WM, arm_out),
        14: (P(hips=(0, -10, -1), spine=(-2, -8, -4), chest=(-4, -10, -5), head=(-2, 10, 4)), (0.04, 0.02, -0.04),
             W_WM + Vector((0.0, 0.02, 0.02)), arm_out),
        16: (P(hips=(-6, -14, -1), spine=(-8, -10, -3), chest=(-12, -12, -4), head=(-8, 12, 3)), (0.04, 0.06, -0.02),
             W_WM + Vector((0.02, 0.08, 0.06)), (0.58, 0.02, 1.36)),
        18: (P(hips=(10, 12, -1), spine=(8, 10, -2), chest=(10, 12, -2), head=(-10, -10, 2)), (0.02, -0.10, -0.08),
             W_WM + Vector((0.04, -0.16, -0.02)), arm_fwd),
        24: (P(hips=(14, 14, -1), spine=(10, 10, -1), chest=(12, 12, -1), head=(-12, -10, 0)), (0.02, -0.12, -0.10),
             W_WM + Vector((0.05, -0.20, -0.14)), (0.24, -0.46, 1.30)),
        34: (P(hips=(2, -4, -1), spine=(2, -2, -2), chest=(2, -4, -2), head=(0, 4, 2)), (0.02, 0.0, -0.03),
             W_WM + Vector((0.02, 0.0, -0.02)), (0.36, -0.20, 1.10)),
    }
    tk = sorted(torso)
    eases = {14: anim.sine, 16: anim.ease_out, 18: anim.accel, 24: anim.ease_out, 34: anim.sine}
    feet_wm = feet_from(g, dr=(-0.05, 0.02, 0.0))
    feet_throw = feet_from(g, dl=(0.0, -0.20, 0.0), dr=(-0.05, 0.04, 0.0))
    pole_l = (0.3, 0.6, -0.7)

    def wheel(f):
        i = max(0, min(len(tk) - 2, next((j for j in range(len(tk) - 1) if f <= tk[j + 1]), len(tk) - 2)))
        f0, f1 = tk[i], tk[i + 1]
        u = eases[f1](max(0.0, min(1.0, (f - f0) / (f1 - f0))))
        (ta, ha, wa, la), (tb, hb, wb, lb) = torso[f0], torso[f1]
        tor = anim.lerp_pose(ta, tb, u)
        hp = tuple(ha[k] + (hb[k] - ha[k]) * u for k in range(3))
        wr = wa.lerp(wb, u)
        lw = tuple(la[k] + (lb[k] - la[k]) * u for k in range(3))
        ft = feet_throw if f >= 17 else feet_wm
        ph = math.radians(phi_at(f))
        lean_out = math.radians(10.0)                     # the wheel's top leans out, away from the head
        ax_w = (-math.sin(lean_out) * math.sin(ph), math.cos(ph), math.cos(lean_out) * math.sin(ph))
        p = pose(g, tor, hp, {"ik": {"hand.R": HT(pos=tuple(wr), pole=pole_wm), "hand.L": HT(pos=lw, pole=pole_l),
                                     "aim.R": Aim(ax_w)}}, ft)
        p["hand.R"] = (0.0, psi0 + sgn * phi_at(f), 0.0)      # the fist turns the bar; the aim trues it to the plane
        p["prop.R"] = (0.0, 180.0, 0.0)                       # pots on the wheel's outer side, clear of the body
        k = max(0.0, min(1.0, (f - 18.0) / 8.0))              # after the throw the pots fall back to plumb
        p["_rigid"] = (1.0 - k, 0.0, 0.0)
        p["_fling"] = (max(0.0, 1.0 - (f - 18.0) / 6.0) if f > 18 else min(1.0, (f - 3.0) / 3.0), 0.0, 0.0)
        return p

    # off the shoulders and back on: IK holds with the aim, plumb pots
    swing_out = pose(g, P(chest=(-2, -6, 4), head=(0, 6, 0)), (0.0, 0.0, -0.02),
                     hold(*yoke_about(GRIP0, 48, 0, (-0.10, 0.06, 0.10)), rigid=0.0), lhand(0.42, -0.06, 1.18, pole=pole_l, w=0.6))
    at_wm = wheel(5.0)
    at_wm["ik"] = dict(at_wm["ik"], **{"aim.R": Aim((0.0, 1.0, 0.0))})
    back_in = pose(g, P(chest=(-2, -4, 3)), (0.0, 0.0, -0.02), hold(*yoke_about(GRIP0, 40, 0, (-0.08, 0.05, 0.10))))
    end_wm = wheel(34.0)
    end_wm["hand.R"] = (0.0, psi0, 0.0)
    end_wm["ik"] = dict(end_wm["ik"], **{"aim.R": Aim((0.0, 1.0, 0.0))})
    on = anim.keyed([(0.0, gI, "linear"), (2.5 / N, swing_out, "inout"), (5 / N, at_wm, "out")])
    off = anim.keyed([(34 / N, end_wm, "linear"), (39 / N, back_in, "inout"), (1.0, gI, "inout")])

    def sample(t):
        f = t * N
        if f < 5:
            p = on(t)
            p["_rigid"] = (max(0.0, min(1.0, (f - 3.0) / 2.0)), 0.0, 0.0)
            p["_fling"] = (max(0.0, min(1.0, (f - 3.0) / 3.0)), 0.0, 0.0)
            return p
        if f <= 34:
            return wheel(f)
        return off(t)

    return anim.Clip("cast_ult", N, False, anim.drag(sample, N, {"head": 1.5, "neck": 1.0}), impact=anim.IMPACT)


def _others(skel, g, gI, rest_ik, hip_h) -> dict:
    out = {}
    osc = anim.osc

    # DEATH (50): recoil; the yoke swings off the shoulder (the long part round behind the head) as he drops to
    # his knees, rises upright at his right side, then comes down in front of him and is set on the ground (the
    # far pot tips over on the ground); he slumps over his knees, the right fist still on the bar.
    def bar(F, long_dir):
        return hold(Vector(F), Vector(long_dir).normalized(), pole_r=(-0.7, 0.3, -0.6))

    knees = feet_from(g, dl=(0.02, 0.36, 0.10), dr=(-0.02, 0.36, 0.10), pl=-56, pr=-56)
    recoil_b = pose(g, P(hips=(-4, 6, 0), spine=(-8, 4, 0), chest=(-12, 6, 0), neck=(-4, 0, 0), head=(-8, 8, 0),
                        upper_arm_L=(30, 0, 10), forearm_L=(40, 0, 0)), (0.0, 0.05, 0.0))
    recoil = pose(recoil_b, {}, (0.0, 0.0, 0.0), ride(skel, recoil_b, *yoke_about(PIV, 0, 4, (0.0, 0.03, 0.02))))
    off = pose(g, P(hips=(10, 4, 0), spine=(6, 0, 0), chest=(4, -4, 0), head=(12, 4, 0), upper_arm_L=(10, 0, 0)),
               (0.0, 0.08, -hip_h * 0.22), bar((-0.40, 0.08, 1.30), (0.0, 1.0, 0.05)),
               feet_from(g, dl=(0.02, 0.18, 0.03), dr=(-0.02, 0.20, 0.04), pl=-26, pr=-30))
    up = pose(g, P(hips=(14, 4, 0), spine=(8, 0, 0), chest=(6, -4, 0), head=(14, 0, 0), upper_arm_L=(14, 0, 0),
                   forearm_L=(20, 0, 0)), (0.0, 0.11, -hip_h * 0.36), bar((-0.44, -0.10, 1.04), (0.05, 0.25, 0.97)), knees)
    plant = pose(g, P(hips=(18, 4, 0), spine=(12, 0, 0), chest=(10, 4, 0), head=(22, 0, 0), upper_arm_L=(14, 0, 0),
                      forearm_L=(22, 0, 0)), (0.0, 0.13, -hip_h * 0.38), bar((-0.40, -0.26, 0.85), (0.34, -0.82, -0.45)), knees)
    slump = pose(g, P(hips=(14, 6, -4), spine=(14, 0, -4), chest=(12, 0, -4), neck=(10, 0, 0), head=(20, -10, -6),
                      upper_arm_L=(10, 0, 6), forearm_L=(16, 0, 0)), (0.02, 0.16, -hip_h * 0.40),
                  bar((-0.38, -0.30, 0.80), (0.34, -0.82, -0.45)), knees)
    bounce = with_hips(anim.add(slump, P(spine=(-4, 0, 0), chest=(-3, 0, 0), head=(-5, 0, 0))), (0, 0, 0.015))
    rest = with_hips(anim.add(slump, P(head=(4, -4, 0), spine=(2, 0, 0))), (0, 0, -0.005))
    out["death"] = anim.Clip("death", 50, False, anim.keyed([
        (0.0, gI, "linear"), (0.12, recoil, "snap"), (0.28, off, "inout"), (0.46, up, "inout"), (0.62, plant, "in"),
        (0.72, slump, "out"), (0.80, bounce, "out"), (0.90, rest, "inout"), (1.0, rest, "linear")]))

    # RECALL (60, loop): down on the right knee under the yoke, head bowed, the left hand on the knee; once a loop he
    # shrugs the yoke up to settle the pots, lifts his head a little, then bows deeper
    kneel = pose(g, P(hips=(8, -10, 0), spine=(10, 4, 0), chest=(8, 4, 0), neck=(12, 0, 0), head=(16, 0, 0), toe_R=(60, 0, 0)),
                 (0.0, 0.10, -hip_h * 0.42 - g.get("hips_loc", (0, 0, 0))[2]),
                 {"ik": anim.feet(l=(0.03, -0.30, 0.0), r=(-0.02, 0.36, 0.11), yl=-6, yr=-8, pr=-55, kr=8)},
                 lhand(0.15, -0.28, 0.58, pole=(0.9, 0.2, -0.3)))

    def recall_s(t):
        b = osc(t, 2)
        shrug = math.sin(math.pi * min(1.0, max(0.0, t / 0.4))) ** 2          # f0-f24: the yoke shrugged up
        bow = math.sin(math.pi * min(1.0, max(0.0, (t - 0.45) / 0.5))) ** 2   # f27-f57: a deeper bow
        p = anim.add(kneel, P(chest=(1.2 * b - 4 * shrug + 6 * bow, 0, 0), spine=(-2 * shrug + 3 * bow, 0, 0),
                              neck=(-6 * shrug + 4 * bow, 0, 0), head=(-0.8 * b - 8 * shrug + 8 * bow, 0, 0),
                              shoulder_L=(0, 0, 6 * shrug), shoulder_R=(0, 0, -6 * shrug)))
        return with_hips(p, (0.0, 0.0, 0.003 * b + 0.012 * shrug))
    out["recall"] = anim.Clip("recall", 60, True, recall_s)

    # IDLE_LOBBY (120, loop): reaches out to the near (left) pot at the yoke's end and taps it twice with a knuckle,
    # dips a finger in the resin at its mouth, pulls a thread up to his chest, rolls it, bobs to a tune
    hand_keys = [(0, None), (12, None), (20, (0.57, 0.09, 1.17)), (23, (0.53, 0.06, 1.20)), (26, (0.57, 0.09, 1.17)),
                 (30, (0.53, 0.06, 1.20)), (40, (0.61, 0.11, 1.36)), (46, (0.62, 0.12, 1.33)), (52, (0.60, 0.10, 1.37)),
                 (64, (0.33, -0.10, 1.42)), (76, (0.14, -0.27, 1.27)), (80, (0.15, -0.265, 1.28)), (84, (0.135, -0.275, 1.265)),
                 (88, (0.15, -0.265, 1.28)), (92, (0.14, -0.27, 1.27)), (102, (0.20, -0.20, 1.18)), (112, None), (120, None)]
    base = anim.stance(dict(MOTION, stance="neutral"), 0.7)
    keys = []
    for f, h in hand_keys:
        pz = anim.merge(base, lhand(*h, pole=(0.9, 0.35, -0.3)) if h else {"ik": {"hand.L": rest_ik["L"]}})
        keys.append((f / 120, pz, "inout"))
    lob = anim.keyed(keys)

    def lobby_s(t):
        p = lob(t)
        s_, bob = osc(t, 1), osc(t, 8)
        look = 14 * math.sin(2 * math.pi * t) ** 3
        d = P(hips=(0, 3 * s_, -2.5 * s_), spine=(0.5 * bob, -2 * s_, 1.5 * s_), chest=(0.8 * bob, -2 * s_, 1.0 * s_),
              neck=(1.5 * bob, look * 0.4, 0), head=(3.0 * bob, look * 0.6, 3 * s_))
        if t < 0.1 or t > 0.93:
            d.update(P(upper_arm_L=(1.5 * s_, 0, 0)))
        p = anim.add(p, d)
        return with_hips(p, (0.02 * s_, 0.0, -0.006 * abs(s_) - 0.004 * (0.5 + 0.5 * bob)))
    out["idle_lobby"] = anim.Clip("idle_lobby", 120, True, lobby_s)

    # VICTORY (60, hold): dip, pop the yoke off the shoulders and catch it with a wobble, hook the left arm
    # over the bar, tip the head (the cap tipped) with the left foot forward, and hold
    def rp(body, yoke, *extra):                      # the yoke riding the chest of `body`
        return pose(body, {}, (0.0, 0.0, 0.0), ride(skel, body, *yoke), *extra)
    crouch = rp(pose(g, P(hips=(4, 0, 0), spine=(2, 0, 0), chest=(1, 0, 0), head=(2, 0, 0), upper_arm_L=(-8, 0, 0)), (0, 0, -0.07)),
                yoke_about(PIV, 0, 0), {"ik": {"hand.L": rest_ik["L"]}})
    pop = rp(pose(g, P(hips=(-4, -6, 0), spine=(-5, -4, 0), chest=(-6, -6, 0), head=(4, 6, 0), upper_arm_L=(30, 0, 14),
                       forearm_L=(50, 0, 0)), (0, 0, 0.015)), yoke_about(PIV, 0, -8, (0.0, 0.10, 0.16)))   # up and back
    catch = rp(pose(g, P(hips=(3, -4, 0), spine=(3, -3, 0), chest=(2, -4, 0), head=(2, 6, 0), upper_arm_L=(14, 0, 8),
                         forearm_L=(40, 0, 0)), (0, 0, -0.03)), yoke_about(PIV, 0, 5, (0.0, 0.01, 0.0)))
    # the hold: the yoke settled back on the shoulders in the right fist, the left fist on the hip, the head
    # tipped in a small bow (the cap at an angle, its dome toward the viewer), the left foot forward (the splash)
    hooked = rp(pose(g, P(hips=(-2, 9, 0), spine=(-4, 5, 0), chest=(-5, 6, 0), neck=(4, -3, 4), head=(11, -6, 8)), (0, 0, -0.005),
                     feet_from(g, dl=(0.03, -0.15, 0.0))), yoke_about(PIV, 0, 0, (0.0, 0.015, 0.005)),
                lhand(0.245, -0.03, 1.085, pole=(1.0, 0.45, 0.05)))
    vic = anim.keyed([(0.0, gI, "linear"), (0.15, crouch, "inout"), (0.25, pop, "out"), (0.35, catch, "in"),
                      (0.50, hooked, "inout"), (0.58, anim.add(hooked, P(head=(-2, 2, 3))), "back"), (1.0, hooked, "linear")])

    def vic_s(t):
        p = vic(t)
        if t > 0.6:
            k = min(1.0, (t - 0.6) / 0.15)
            p = anim.add(p, P(chest=(0.8 * k * osc(t, 2), 0, 0), head=(0.5 * k * osc(t, 2, 0.2), 0, 0)))
        return p
    out["victory"] = anim.Clip("victory", 60, False, anim.drag(vic_s, 60, {"head": 2.0, "neck": 1.0}))

    # DASH (15): a tucked hop under the bar
    dip = pose(g, P(hips=(10, 0, 0), spine=(6, 0, 0), chest=(4, 0, 0), head=(-4, 0, 0)), (0, -0.02, -0.06))
    air = pose(g, P(hips=(14, 0, 0), spine=(8, 0, 0), chest=(6, 0, 0), head=(-10, 0, 0), upper_arm_L=(-20, 0, 0), forearm_L=(30, 0, 0)),
               (0, -0.04, 0.08), feet_from(g, dl=(0.0, 0.10, 0.20), dr=(0.0, 0.14, 0.24), pl=-20, pr=-24))
    land = pose(g, P(hips=(10, 0, 0), spine=(6, 0, 0), chest=(4, 0, 0), head=(-4, 0, 0)), (0, -0.02, -0.07))
    out["dash"] = anim.Clip("dash", 15, False, anim.keyed([(0.0, g, "linear"), (0.2, dip, "out"), (0.47, air, "out"),
                                                            (0.73, land, "in"), (1.0, g, "inout")]))

    # STUNNED (40, loop): the bar has slipped off the left shoulder onto the back of the arm, its long end drooping
    # and sagging further in time with the dazed sway, the right fist clutching it, the head wobbling
    slip0 = pose(anim.stance(MOTION, 1.3), P(spine=(10, 0, 0), chest=(10, 0, 0), neck=(8, 0, 0), head=(12, 0, 0),
                                             upper_arm_L=(8, 0, 4), forearm_L=(16, 0, 0)), (0.0, 0.0, 0.0))

    def stun_s(t):
        a, b = osc(t, 1), osc(t, 1, 0.25)
        p = anim.merge(slip0, ride(skel, slip0, *yoke_about(GRIP0, 6, -22 + 5 * a, (0.0, 0.08, -0.04 - 0.01 * a))))
        return anim.add(p, P(hips=(0, 0, 4 * a), spine=(3 * b, 0, -3 * a), chest=(3 * b, 0, -3 * a),
                             neck=(6 * b, 0, 6 * a), head=(8 * b, 4 * a, 8 * a)))
    out["stunned"] = anim.Clip("stunned", 40, True, stun_s)

    # CHANNEL (40, loop): the free hand raised forward, the yoke on the shoulders
    ch = pose(g, P(spine=(3, 0, 0), chest=(3, 0, 0)), (0, 0, 0), lhand(0.17, -0.38, 1.30, pole=(0.9, 0.3, -0.4)))
    out["channel"] = anim.Clip("channel", 40, True, lambda t: anim.add(ch, P(chest=(1.5 * osc(t, 2), 0, 0), head=(-1 * osc(t, 2), 0, 0))))
    return out


if __name__ == "__main__":
    fighter.main(sys.modules[__name__])
