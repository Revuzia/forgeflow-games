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
POT_DROP = 0.10                      # knot to pot rim (concept 0.32, brief 0.10 under the bar): the pots hang at
                                     # 1.12-1.40 m and their windows (1.23-1.28 m) sit in the top half
CONCEPT_POTS = {"R": (-0.544, 0.852), "L": (0.483, 0.892)}   # (x centre, bottom z) as painted
POT_X = {"R": -0.78, "L": 0.80}       # the right pot a little inboard: the sling pouch hangs between it and the cap


def _pot_hang(side):
    x = POT_X[side]
    apz = staff_z(x) - 0.042                                  # the knot just under the bar
    return (x, apz - POT_DROP - POT_H + 0.012, x, apz)


POTS = {s: _pot_hang(s) for s in ("R", "L")}  # side: (x centre, bottom z, cord apex x, cord apex z)
POT_SHIFT = {s: np.array([POTS[s][0] - CONCEPT_POTS[s][0], 0.0, POTS[s][1] - CONCEPT_POTS[s][1]]) for s in POTS}
POUCH_X = -0.932                     # the sling pouch hangs under the right end, inboard of the amber cap (the lob origin)
POUCH_DROP = 0.090                   # bar axis to the pouch's centre (a short cord loop: the pouch rides above the pot)
CAP_LEN = 0.045                      # the amber end caps: capsule segment length (+ the 0.033 radius at each end)
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
# hero renders: the key sun a step under the shared 3.0 (like Hesmi / Ervet): the painting is toned to the game's
# value read (light sandstone head, mid jerkin) and at the full hero sun the sandstone burnt to cream
SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92, "fill": 0.78, "pitch": 1.0, "yaw": 30.0, "sun": 2.6}
HERO_FILL = 0.55                      # ... and the sky fill under the map's (see _install_render): the shading carries
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
    """Carved pot (lathe, z from the pot's bottom): a small round foot (r 0.058), a full round belly (r 0.124 at
    0.120), a soft shoulder ridge at 0.170, the neck (r 0.086 from 0.214), a rolled lip to the rim at 0.266; the
    mouth is hollow from 0.236 up (the resin sits in it). The belly is a smooth ellipse all the way to the foot
    (the concept's round sandstone jar), the foot's edge rounded."""
    belly = 0.124 * np.sqrt(np.clip(1.0 - ((z - 0.120) / 0.134) ** 2, 0.0, 1.0))
    belly = np.maximum(belly, np.where(z < 0.03, 0.058 - 0.4 * np.maximum(0.0, 0.012 - z), 0.0))
    rr = np.where(z < 0.214, belly, 0.086)
    d = np.maximum(r - rr, np.maximum(-z, z - 0.255))
    rz = np.stack([r, np.zeros_like(r), z], 1)
    d = np.minimum(d, Torus((0, 0, 0.250), 0.099, 0.0165).d(rz))
    d = np.maximum(d, -np.maximum(r - 0.076, 0.236 - z))
    return np.minimum(d, Torus((0, 0, 0.170), 0.110, 0.0060).d(rz))


WIN_R = 0.056                       # the round accent window glass (11 cm: the brief's 12 cm with its ring; the
                                    # concept's inset glass is about a third of the jar's face, not a porthole)
WIN_DOME = 0.018                    # the glass is a low domed cabochon (the concept's), just proud of its ring
WIN_YAWS = (55.0, -55.0)            # TWO windows per pot, on its outer side turned front-out and back-out (the
                                    # concept paints one in the front view and one in the back view): whichever
                                    # way he faces, the camera side of each pot shows a window
WIN_TIP = 22.0                      # ... each tipped up toward the high game camera
RING_W = 0.0065                     # the dark ironstone ring each glass is set in (it frames the tinted glass
                                    # against the pale sandstone, so an enemy's marigold never melts into the pot)


def pot_window(side, radius=0.121, zc=0.150, yaw=WIN_YAWS[0]):
    """(centre on the belly, outward normal) of one pot window: on the pot's outer side turned `yaw` degrees toward
    the front (negative: toward the back) and tipped up a little, set into the round belly. `radius` = the belly's
    radius at `zc` m above the pot's bottom."""
    x, z0, _, _ = POTS[side]
    out = -1.0 if side == "R" else 1.0
    a, t = math.radians(yaw), math.radians(WIN_TIP)
    h = np.array([out * math.cos(a), -math.sin(a), 0.0])
    n = unit(h * math.cos(t) + np.array([0.0, 0.0, math.sin(t)]))
    c = np.array([x, STAFF_Y, z0 + zc]) + h * radius
    return c, n


def window_seat(c, n):
    """the shallow round seat the window glass and its ring sit in (cut into the belly)"""
    return Ellipsoid(c - n * 0.002, (WIN_R + RING_W + 0.004, WIN_R + RING_W + 0.004, 0.016), axes=sdf.frame(n))


def plane3(a, b, c, inside) -> HalfSpace:
    """the half-space bounded by the plane through a, b, c that contains `inside` (a carved facet)"""
    a, b, c, inside = (np.asarray(v, dtype=np.float64) for v in (a, b, c, inside))
    n = unit(np.cross(b - a, c - a))
    if float((inside - a) @ n) > 0.0:
        n = -n
    return HalfSpace(a, n, 1.0)


def groove(S: Sculpt, prim, xz, r=0.0045, side=-1.0, k=0.002, sink=0.0):
    """a carved V-ish groove (a thin tube half sunk in the surface) through the surface points of `prim` at the
    given (x, z), seen from the front (side -1) or the back (+1): a painted crack made a real carved line"""
    pts = []
    for x, z in xz:
        p, n = surface_at(prim, x, z, side)
        pts.append(p - n * sink)
    rr = [r] * len(pts)
    rr[0] = rr[-1] = r * 0.45                       # the crack fades out at its ends (no round pits)
    S.sub(Tube(pts, rr, k=0.002), k=k)


# ── the carved mask, fitted to the concept's painted face (art/.cache/concept/odrum_front.png on a 1 cm grid) ──
MX, FY = -0.005, -0.168             # the painted face's centre line and the mask's front plane
# the almond eye voids: (centre x, centre z, half length, half height, slant deg): the inner corners lower (the
# concept's angry slant), deep enough to read as black voids, not painted lids
EYES = {-1: (MX - 0.075, 1.654, 0.045, 0.0185, 13.0), 1: (MX + 0.073, 1.655, 0.043, 0.0180, 13.0)}
EYE_FLOOR = FY + 0.030              # the voids' flat floor (3 cm into the face)
BAND_Z = (1.708, 1.786)             # the brow band (the mask's top slab across the cap's front)
BAND_FY = -0.194                    # its front plane: 2.6 cm proud of the face, overhanging the brows
MASK_SIDE = 0.146                   # half-width of the face at the eye line (the head block continues it)


def eye_frame(sx):
    """(centre, long axis u, short axis w) of an eye void in the x-z plane"""
    x, z, L, h, sl = EYES[sx]
    a = math.radians(sl)
    u = unit((-sx * math.cos(a), 0.0, -math.sin(a)))           # outer corner -> inner corner, falling inward
    w = np.array([-u[2], 0.0, u[0]])
    if w[2] < 0:
        w = -w
    return np.array([x, 0.0, z]), u, w


def eye_void(sx) -> sdf.Blend:
    """an almond (lens) prism along Y: two cylinders' intersection, its floor flat at EYE_FLOOR"""
    c, u, w = eye_frame(sx)
    _, _, L, h, _ = EYES[sx]
    R = (L * L + h * h) / (2.0 * h)
    off = R - h
    S = Sculpt("_eye")
    for i, s in enumerate((1.0, -1.0)):
        cc = c + w * off * s
        cap = Capsule((cc[0], -0.30, cc[2]), (cc[0], EYE_FLOOR - 0.02, cc[2]), R)
        (S.add if i == 0 else S.inter)(cap, k=0.0 if i == 0 else 0.002)
    S.inter(HalfSpace((0, EYE_FLOOR, 0), (0, 1, 0), 1.0), k=0.004)
    return as_prim(S)


def in_eye(P, grow=0.0) -> np.ndarray:
    """points (n, 3) inside either eye void's prism (in x-z), in front of its floor"""
    out = np.zeros(len(P), dtype=bool)
    for sx in (-1, 1):
        c, u, w = eye_frame(sx)
        _, _, L, h, _ = EYES[sx]
        R = (L * L + h * h) / (2.0 * h)
        q = P - c
        a, b = q @ u, q @ w
        inside = (np.hypot(a, b - (R - h)) <= R + grow) & (np.hypot(a, b + (R - h)) <= R + grow)
        out |= inside & (P[:, 1] < EYE_FLOOR + 0.004)
    return out


def beak() -> sdf.Blend:
    """the big carved beak (the concept's): a faceted wedge from a narrow bridge between the brows (z 1.676) out to
    flared nostrils 11.6 cm wide (z 1.594) and down to a hooked point 7 cm proud of the face (z 1.553); its ridge
    sharp, its two lit side planes each split once at the flare, the underside tucked back to the lip"""
    rt = (MX, FY - 0.016, 1.700)            # the ridge's top (the bridge, up to the band's V notch)
    rf = (MX, FY - 0.050, 1.594)            # the ridge at the flare
    tp = (MX, FY - 0.056, 1.553)            # the hooked point
    inside = (MX, FY + 0.01, 1.61)
    S = Sculpt("_beak")
    S.add(RoundBox((MX, FY - 0.02, 1.625), (0.07, 0.06, 0.085), 0.0), k=0.0)
    for sx in (-1, 1):
        fl = (MX + sx * 0.058, FY - 0.004, 1.580)      # the flare's outer corner, near the face
        top = (MX + sx * 0.020, FY + 0.002, 1.706)     # the bridge's corner under the band
        S.inter(plane3(rt, rf, fl, inside), k=0.003)   # upper side plane (bridge to flare)
        S.inter(plane3(rt, top, fl, inside), k=0.003)  # ... and its narrow inner facet up to the brow
        S.inter(plane3(rf, tp, fl, inside), k=0.003)   # lower side plane (flare to the point)
    S.inter(plane3(tp, (MX - 0.058, FY + 0.006, 1.572), (MX + 0.058, FY + 0.006, 1.572), inside), k=0.004)   # underside
    S.inter(HalfSpace((0, FY + 0.03, 0), (0, 1, 0), 1.0), k=0.0)
    return as_prim(S)


def sculpts(lanterns: bool = False) -> list:
    """(name, Sculpt, voxel scale, material role, bind, tris) in build order; `lanterns` swaps the pots for
    the Noon Fair skin's paper lanterns (same hang, same windows)."""
    out = []

    def part(name, S, role, bind, tris, vs=1.0):
        out.append((name, S, vs, role, bind, tris))

    # CAP (rigid on the head): a felt dome over a tall rolled brim, a knob on top
    cap = Sculpt("cap")
    # the rolled brim (the concept's back view: a felt roll x +-0.16): its front half hides behind the brow band
    brim = Lathe((0, -0.005, 0), lambda r, z: RoundBox((0.138, 0, 1.726), (0.026, 1.0, 0.058), 0.026).d(
        np.stack([r, np.zeros_like(r), z], 1)), 0.17, 1.66, 1.79, axes=np.diag([1.0, 1.12, 1.0]))
    cap.add(brim.displaced(felt(0.003, 22.0), 0.003), k=0.0)
    dome = Ellipsoid((0, -0.005, 1.765), (0.134, 0.122, 0.12))
    cap.add(dome.displaced(felt(0.0025, 24.0), 0.003), k=0.02)
    cap.add(Capsule((0, -0.005, 1.872), (0, -0.005, 1.885), 0.02), k=0.012)
    cap.add(Sphere((0, -0.005, 1.893), 0.021), k=0.008)
    cap.sub(Tube([(0.004, -0.124, 1.80), (0.006, -0.10, 1.85), (0.003, -0.05, 1.88)], [0.004] * 3), k=0.003)
    cap.sub(Tube([(0.0, 0.112, 1.80), (0.0, 0.09, 1.85), (0.0, 0.04, 1.88)], [0.004] * 3), k=0.003)
    part("cap", cap, "cloth2", "bone:head", 1000)

    # THE CARVED HEAD (rigid on the head): ONE sandstone piece, the mask's face and the head block behind it carved
    # together (no step or seam between plate and block), every feature placed on the concept's painted face (the
    # projection then lands each painted plane, crack and void on its own carved form):
    #   * the brow band: a slab across the cap's front (z 1.708-1.786, x +-0.15), 2.6 cm proud of the face, its
    #     top front edge and its corners chamfered, split into blocks by carved cracks (the painted ones);
    #   * the brows: two slanted shelves falling to the bridge (the angry V), under the band's overhang;
    #   * the almond eye voids, inner corners down, 3 cm deep (ink);
    #   * the beak (beak()): a faceted wedge 7 cm proud, 11.6 cm across the flared nostrils;
    #   * the face: planar facets: the under-eye plane and the lower cheeks receding from a cheekbone ridge, the
    #     jaw tapering to the chin (the concept: x +-0.131 at z 1.60, +-0.089 at 1.50, the chin at 1.46), the
    #     muzzle block under the beak, carved cracks on the cheeks and chin (the painted ones);
    #   * the head block behind: the mask's side walls carried straight back, rounded to a skull in plan at the
    #     back with planar back facets (the concept's back view), no painted or carved swirl.
    mask = Sculpt("mask")
    bnd = Sculpt("_band")
    bnd.add(RoundBox((MX, -0.110, 1.747), (0.153, 0.084, 0.039), 0.007), k=0.0)
    for sx in (-1, 1):                                   # the band's front corners chamfered back (plan)
        bnd.inter(HalfSpace((MX + sx * 0.126, BAND_FY, 0), unit((sx * 0.55, -0.83, 0.0)), 1.0), k=0.003)
    bnd.inter(HalfSpace((0, BAND_FY, 1.775), unit((0, -0.5, 0.866)), 1.0), k=0.003)    # top front chamfer
    bnd.inter(HalfSpace((0, BAND_FY, 1.716), unit((0, -0.62, -0.78)), 1.0), k=0.003)   # lower front edge bevel
    band = as_prim(bnd)
    mask.add(band.displaced(chips(0.0018, 16.0), 0.002), k=0.0)
    face = Sculpt("_face")
    face.add(RoundBox((MX, -0.098, 1.588), (MASK_SIDE + 0.004, 0.070, 0.128), 0.010), k=0.0)
    for sx in (-1, 1):
        # the jaw: x +-0.131 at z 1.60 to +-0.089 at 1.50 (the painted outline)
        face.inter(HalfSpace((MX + sx * 0.131, 0, 1.60), unit((sx * 1.0, 0.0, -0.42)), 1.0), k=0.006)
        # the cheek's side bevel: the front plane spans +-0.112, the side turns back at 45 degrees
        face.inter(HalfSpace((MX + sx * 0.112, FY, 1.6), unit((sx * 0.70, -0.71, 0.0)), 1.0), k=0.004)
        # the lower cheeks recede from the cheekbone ridge (z 1.625) toward the jaw
        face.inter(HalfSpace((MX + sx * 0.09, FY, 1.622), unit((sx * 0.30, -0.92, -0.20)), 1.0), k=0.004)
    face.inter(HalfSpace((MX, FY, 1.625), unit((0, -0.92, 0.39)), 1.0), k=0.004)       # under-eye plane (recedes up)
    for sx in (-1, 1):                                   # the chin: two planes meeting in a shallow V at z 1.462
        face.inter(HalfSpace((MX, 0, 1.462), unit((sx * 0.30, 0.0, -0.95)), 1.0), k=0.004)
    face.inter(HalfSpace((MX, FY, 1.492), unit((0, -0.55, -0.83)), 1.0), k=0.004)      # chin underside bevel
    fp = as_prim(face)
    mask.add(fp.displaced(chips(0.0028, 14.0), 0.003), k=0.006)
    # the muzzle block under the beak (the upper lip and chin plates), proud of the receding lower cheeks
    mz = Sculpt("_muzzle")
    mz.add(RoundBox((MX, FY + 0.032, 1.522), (0.074, 0.026, 0.046), 0.006), k=0.0)
    for sx in (-1, 1):
        mz.inter(HalfSpace((MX + sx * 0.131, 0, 1.60), unit((sx * 1.0, 0.0, -0.42)), 1.0), k=0.004)
        mz.inter(HalfSpace((MX + sx * 0.040, FY + 0.006, 1.52), unit((sx * 0.62, -0.78, 0.0)), 1.0), k=0.003)
        mz.inter(HalfSpace((MX, 0, 1.462), unit((sx * 0.30, 0.0, -0.95)), 1.0), k=0.004)
    mz.inter(HalfSpace((MX, FY + 0.006, 1.552), unit((0, -0.9, 0.44)), 1.0), k=0.003)    # the lip plane under the beak
    mz.inter(HalfSpace((MX, FY + 0.006, 1.492), unit((0, -0.55, -0.83)), 1.0), k=0.004)
    mask.add(as_prim(mz), k=0.004)
    # the brows: slanted shelves under the band, falling from the outer ends (z 1.689) to the bridge (z 1.664)
    for sx in (-1, 1):
        c, u, w = eye_frame(sx)
        bc = c + w * 0.035 + u * 0.002
        mask.add(RoundBox((bc[0], FY - 0.008, bc[2]), (0.060, 0.018, 0.019), 0.006,
                          axes=np.stack([u, np.array([0.0, 1.0, 0.0]), w])), k=0.004)
    mask.add(RoundBox((MX, FY + 0.022, 1.699), (0.128, 0.022, 0.013), 0.006), k=0.006)     # forehead under the band
    mask.add(beak(), k=0.004)
    # the head block behind the mask: its side walls carried straight back, the back rounded in planar facets
    hb = Sculpt("_hb")
    hb.add(RoundBox((MX, -0.008, 1.600), (MASK_SIDE - 0.006, 0.094, 0.106), 0.040), k=0.0)
    for sx in (-1, 1):
        hb.inter(HalfSpace((MX + sx * 0.131, 0, 1.60), unit((sx * 1.0, 0.0, -0.42)), 1.0), k=0.006)
        hb.inter(HalfSpace((MX + sx * 0.096, 0.064, 1.62), unit((sx * 0.70, 0.71, 0.0)), 1.0), k=0.006)   # back corners
        hb.inter(HalfSpace((MX + sx * 0.060, 0.080, 1.66), unit((sx * 0.45, 0.62, 0.64)), 1.0), k=0.006)  # top-back corners
    hb.inter(HalfSpace((0, 0.074, 1.672), unit((0, 0.55, 0.83)), 1.0), k=0.006)        # top-back facet (under the brim)
    hb.inter(HalfSpace((0, 0.074, 1.552), unit((0, 0.62, -0.78)), 1.0), k=0.006)       # back-under facet
    mask.add(as_prim(hb).displaced(chips(0.0018, 14.0), 0.002), k=0.008)
    # the voids and the carved cracks (each on its painted line)
    for sx in (-1, 1):
        mask.sub(eye_void(sx), k=0.003)
    groove(mask, band, [(-0.077, 1.784), (-0.068, 1.751), (-0.048, 1.739), (-0.031, 1.732), (-0.016, 1.718),
                        (-0.006, 1.710)], 0.0042)
    groove(mask, band, [(0.040, 1.784), (0.037, 1.751), (0.020, 1.733), (0.002, 1.716)], 0.0042)
    groove(mask, band, [(0.074, 1.712), (0.086, 1.732), (0.115, 1.744), (0.150, 1.751)], 0.0038)
    groove(mask, band, [(-0.150, 1.729), (-0.120, 1.722), (-0.097, 1.716)], 0.0036)
    groove(mask, fp, [(-0.112, 1.618), (-0.086, 1.603), (-0.062, 1.594)], 0.0038)
    groove(mask, fp, [(0.104, 1.615), (0.080, 1.603), (0.056, 1.595)], 0.0038)
    groove(mask, as_prim(mz), [(-0.068, 1.548), (-0.048, 1.505), (-0.030, 1.468)], 0.0036)
    groove(mask, as_prim(mz), [(0.058, 1.553), (0.045, 1.523), (0.030, 1.500)], 0.0036)
    part("mask", mask, "sandstone", "bone:head", 3000, 0.7)

    # the linen mouth-wrap (the brief's cloth2 under the mask): wound round the neck in the V under the chin
    nw = Sculpt("neckwrap")
    nwc = Tube([(0, -0.004, 1.428), (0, -0.012, 1.47), (0, -0.022, 1.515)], [0.066, 0.070, 0.062])

    def wound(P):                                        # the linen wound in a spiral: soft ridges, a little noise
        ang = np.arctan2(P[:, 0], -(P[:, 1] + 0.012))
        return 0.0032 * np.sin(P[:, 2] * 140.0 + ang * 1.0) + 0.0015 * NOISE(P, 40.0)
    nw.add(nwc.displaced(wound, 0.0045), k=0.0)
    part("neckwrap", nw, "cloth2", "auto", 300)

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
    part("coat", coat, "cloth", "auto", 2350)

    # cross straps front and back (an X from the shoulders to the belt), laid on the coat's surface
    body = as_prim(coat)
    straps = Sculpt("straps")
    for fb in (-1, 1):
        for sx in (-1, 1):
            strap_on(straps, body, [(sx * 0.10, 1.47), (sx * 0.075, 1.40), (sx * 0.01, 1.29), (-sx * 0.07, 1.19),
                                    (-sx * 0.13, 1.11)], fb, 0.036, 0.011)
    part("straps", straps, "leather", "auto", 520)
    belt = Sculpt("belt")
    belt.add(Torus((0, 0.008, 1.078), 0.150, 0.02, axes=np.diag([1.0, 0.150 / 0.122, 1.0]), rz=0.038), k=0.0)
    part("belt", belt, "leather", "auto", 450)

    # SKIRT: the jerkin below the belt, flaring to the knee hem, split at the front
    skirt = Sculpt("skirt")
    sk = FlatCapsule((0, 0.012, 0.46), (0, 0.008, 1.06), 0.278, 0.178, 0.15, 0.118, side=(1, 0, 0))
    skirt.add(sk.displaced(folds(0.012, 14.0, axis=0, phase=0.7, zfade=(1.0, 0.5)), 0.012), k=0.0)
    skirt.inter(HalfSpace((0, 0, 0.50), unit((0.0, -0.05, -1.0)), 2.0), k=0.006)       # the hem at the knee (concept 0.52)
    # the front slit as painted: closed under the belt (x -0.030, z 0.935), opening to 5.5 cm at the hem (the left
    # edge to x -0.054, the right to x +0.001): a V notch cut through the front of the skirt, so the painted dark
    # of the gap lands in the gap (no dark tongue painted on a closed panel)
    slit = Sculpt("_slit")
    slit.add(RoundBox((-0.026, -0.21, 0.66), (0.06, 0.13, 0.30), 0.0), k=0.0)
    apex = np.array([-0.030, 0.0, 0.935])
    slit.inter(HalfSpace(apex, unit((-0.455, 0.0, 0.024)), 1.0), k=0.002)     # left edge (to x -0.054 at the hem)
    slit.inter(HalfSpace(apex, unit((0.455, 0.0, 0.031)), 1.0), k=0.002)      # right edge (to x +0.001 at the hem)
    skirt.sub(as_prim(slit), k=0.005)
    part("skirt", skirt, "cloth", "auto", 1450)

    # LEGS: full trousers bloused softly over the boot tops (vertical folds, the blouse overhanging the cuff), tall
    # soft boots with a turned cuff, a fold at the ankle and a thin welt sole flush with the boot
    def blouse(P):
        u = np.arctan2(P[:, 1] + 0.005, np.abs(P[:, 0]) - 0.128) * 5.0 + 3.0 * NOISE(P, 6.0)
        a = 0.010 * np.clip((0.50 - P[:, 2]) / 0.12, 0.0, 1.0)            # the folds deepen toward the blouse
        return a * (np.abs(np.sin(u)) * 2.0 - 1.0) * -0.5 + 0.002 * NOISE(P, 30.0)
    legs = Sculpt("trousers")
    for sx in (-1, 1):
        # narrow at the top: the thighs stay inside the flaring skirt (no dark trouser poking out at the hips)
        legs.add(FlatCapsule((sx * 0.085, 0.0, 0.80), (sx * 0.126, -0.004, 0.44), 0.072, 0.08, 0.082, 0.082, side=(1, 0, 0)), k=0.0)
        # the blouse: the trouser leg (hem 0.50 to the boot top 0.31, as painted) falls straight, then gathers in a
        # soft overhang just above the boot cuff (folds, its lower edge rolled under): no ball
        legs.add(RoundCone((sx * 0.127, -0.005, 0.44), (sx * 0.131, -0.007, 0.335), 0.082, 0.091).displaced(blouse, 0.011), k=0.03)
        legs.add(Torus((sx * 0.131, -0.007, 0.322), 0.074, 0.017, rz=0.013), k=0.02)
    part("trousers", legs, "under", "auto", 760)
    boots = Sculpt("boots")
    for sx in (-1, 1):
        a = np.array([sx * 0.131, -0.006, 0.335])
        b = np.array([sx * 0.137, 0.0, 0.14])
        boots.add(FlatCapsule(a, b, 0.071, 0.071, 0.062, 0.064, side=(1, 0, 0)), k=0.0)
        boots.add(Torus((sx * 0.131, -0.006, 0.302), 0.070, 0.011, rz=0.016), k=0.012)       # the turned cuff
        boots.add(Torus((sx * 0.137, -0.005, 0.15), 0.064, 0.011, rz=0.014), k=0.015)        # ankle fold
        yaw = sdf.rot_z(sx * -10.0)
        boots.add(RoundBox((sx * 0.148, -0.055, 0.066), (0.071, 0.146, 0.066), 0.055, axes=yaw), k=0.04)
        # the welt: a thin sole flush with the boot's outline (no plank; painted dark, _paint_lit)
        boots.add(RoundBox((sx * 0.148, -0.055, 0.0085), (0.063, 0.138, 0.0085), 0.008, axes=yaw), k=0.012)
    boots.inter(HalfSpace((0, 0, 0.0), (0, 0, -1), 2.0), k=0.0)
    part("boots", boots, "leather", "auto", 980)

    # FOREARM WRAPS (rigid on the forearms) and the FISTS (rigid on the hands)
    # the forearms (the concept): brown leather straps wound CRISS-CROSS over the grey sleeve to the wrist, the
    # straps standing proud (wrap_relief), painted in _procedural("wrap")
    wl = Sculpt("wrap_L")
    a, b = WRAP_AXES["wrap_L"]
    wl.add(FlatCapsule(a, b, 0.048, 0.045, 0.045, 0.043, side=(1, 0, 0)).displaced(wrap_relief("wrap_L"), 0.004), k=0.0)
    part("wrap_L", wl, "leather", "bone:forearm.L", 300)
    wr = Sculpt("wrap_R")
    a, b = WRAP_AXES["wrap_R"]
    wr.add(FlatCapsule(a, b, 0.048, 0.046, 0.045, 0.043, side=(1, 0, 0)).displaced(wrap_relief("wrap_R"), 0.004), k=0.0)
    part("wrap_R", wr, "leather", "bone:forearm.R", 300)
    hl = Sculpt("hand_L")
    c = np.array([0.268, -0.03, 0.822])
    hl.add(RoundBox(c, (0.052, 0.056, 0.056), 0.034), k=0.0)
    for i in range(4):                                   # the curled fingers' middle rolls (front)
        hl.add(Capsule(c + (-0.04, -0.05, 0.035 - i * 0.024), c + (0.035, -0.05, 0.035 - i * 0.024), 0.016), k=0.012)
    for i in range(4):                                   # the knuckle row along the fist's bottom edge
        hl.add(Sphere(c + (0.027 - i * 0.022, -0.026, -0.052 + 0.003 * abs(i - 1.5)), 0.019), k=0.012)
    for i in range(4):                                   # tendons over the back of the hand
        x = 0.024 - i * 0.017
        hl.add(Capsule(c + (x, 0.052, 0.034), c + (x * 1.1, 0.040, -0.040), 0.0065), k=0.010)
    hl.add(Capsule(c + (0.048, -0.04, -0.03), c + (0.05, 0.0, -0.042), 0.017), k=0.012)          # index finger's side
    hl.add(Capsule(c + (-0.05, -0.035, 0.04), c + (-0.03, -0.062, -0.005), 0.02), k=0.012)       # the thumb
    hl.sub(Tube([c + (-0.045, -0.067, 0.023 - i * 0.024) for i in range(1)] + [c + (0.04, -0.067, 0.023)], [0.003, 0.003]), k=0.002)
    part("hand_L", hl, "sandstone", "bone:hand.L", 600)
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
    part("staff_wraps", wraps, "leather", "bone:prop.R", 480, 0.7)
    # the amber end caps: short glossy resin domes over a dark walnut collar (painted translucent, _procedural)
    caps = Sculpt("staff_caps")
    caps.add(Capsule(on_bar(x0 + 0.033), on_bar(x0 + 0.033 + CAP_LEN), 0.033), k=0.0)
    caps.add(Capsule(on_bar(x1 - 0.033 - CAP_LEN), on_bar(x1 - 0.033), 0.033), k=0.0)
    part("staff_caps", caps, "lampresin", "bone:prop.R", 300, 0.8)
    collars = Sculpt("staff_collars")
    for xx in (x0 + 0.033 + CAP_LEN + 0.026, x1 - 0.033 - CAP_LEN - 0.026):
        collars.add(Torus(on_bar(xx), STAFF_R + 0.004, 0.0085, axes=sdf.frame(ax)), k=0.0)
    part("staff_collars", collars, "wood_dark", "bone:prop.R", 160, 0.7)
    # the sling pouch (0.13 m, leather) on a short rigid cord loop under the right end: the lob origin. A soft
    # cupped bag, its mouth tied, the flap folded over the front: one leather, stitched (painted, _procedural)
    pouch = Sculpt("pouch")
    top = on_bar(POUCH_X)
    pc = top + np.array([0.0, -0.002, -POUCH_DROP])
    pouch.add(Ellipsoid(pc, (0.056, 0.050, 0.058)).displaced(felt(0.0015, 14.0), 0.002), k=0.0)
    pouch.add(RoundCone(pc + (0, 0, 0.036), pc + (0, 0, 0.066), 0.036, 0.018), k=0.014)
    pouch.add(Torus(pc + (0, 0, 0.056), 0.024, 0.0065, rz=0.005), k=0.003)
    pouch.add(Ellipsoid(pc + (0.0, -0.043, 0.014), (0.044, 0.010, 0.030), axes=sdf.rot_x(-14)), k=0.008)   # the flap
    for dy in (-0.018, 0.018):
        pouch.add(Capsule(pc + (0, dy * 0.4, 0.064), top + (0.0, dy, -0.004), 0.005), k=0.004)
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
        ring = Sculpt(f"ring_{side}")
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
            for yw in WIN_YAWS:
                c_, n_ = pot_window(side, 0.127, 0.15, yw)
                lan.sub(window_seat(c_, n_), k=0.004)
                ring.add(Torus(c_ - n_ * 0.006, WIN_R + RING_W * 0.5, RING_W, axes=sdf.frame(n_), rz=0.0075), k=0.0)
                glass.add(Ellipsoid(c_ - n_ * 0.012, (WIN_R, WIN_R, WIN_DOME), axes=sdf.frame(n_)), k=0.0)
            resin.add(Ellipsoid(c0 + (0, 0, 0.112), (0.056, 0.056, 0.01)), k=0.0)
            part(f"lantern_{side}", lan, "paper", hang, 800, 0.8)
            part(f"lantern_rims_{side}", rims, "lampresin", hang, 450, 0.6)
        else:
            pot, rim = Sculpt(f"pot_{side}"), Sculpt(f"pot_rim_{side}")
            pot.add(Lathe((px, STAFF_Y, z0), pot_profile, 0.13, -0.002, 0.236).displaced(chips(0.0025, 10.0), 0.0025), k=0.0)
            rim.add(Torus((px, STAFF_Y, z0 + 0.250), 0.099, 0.0165), k=0.0)
            rim.add(Lathe((px, STAFF_Y, z0), lambda r, z: np.maximum(np.maximum(r - 0.099, 0.076 - r), np.maximum(0.21 - z, z - 0.252)),
                          0.11, 0.2, 0.26), k=0.004)
            # two windows (front-out and back-out): each a seat cut into the smooth belly, a dark ironstone ring
            # flush with the belly and the low domed glass in it
            for yw in WIN_YAWS:
                c_, n_ = pot_window(side, 0.121, 0.150, yw)
                pot.sub(window_seat(c_, n_), k=0.004)
                ring.add(Torus(c_ - n_ * 0.006, WIN_R + RING_W * 0.5, RING_W, axes=sdf.frame(n_), rz=0.0075), k=0.0)
                glass.add(Ellipsoid(c_ - n_ * 0.012, (WIN_R, WIN_R, WIN_DOME), axes=sdf.frame(n_)), k=0.0)
            resin.add(Ellipsoid((px, STAFF_Y, z0 + 0.238), (0.079, 0.079, 0.011)), k=0.0)
            part(f"pot_{side}", pot, "pot", hang, 680, 0.8)
            part(f"pot_rim_{side}", rim, "rim", hang, 360, 0.6)
        # lampresin: amber, glossy, never emissive (the windows are the only emissive pixels at rest)
        part(f"resin_{side}", resin, "lampresin", hang, 100, 0.8)
        part(f"ring_{side}", ring, "ironstone", hang, 220, 0.5)
        part(f"window_{side}", glass, "accent", hang, 240, 0.6)
    return out


def skin_extras(extra: dict) -> list:
    """skin-only geometry beyond the lantern swap (Noon Fair): a rigid ribbon pair tied at each tip of the yoke,
    streaming down and outward beyond the amber caps (clear of the pouch and the lanterns), and a lilac hat band
    round the felt cap with a two-loop bow at its left side"""
    out = []
    if extra.get("ribbons"):
        rib = Sculpt("ribbons")
        for xt, sgn in ((STAFF_X[0], -1.0), (STAFF_X[1], 1.0)):
            top = np.array([xt + sgn * 0.004, STAFF_Y, staff_z(xt) - 0.004])
            rib.add(Sphere(top, 0.014), k=0.0)                                           # the knot on the cap's tip
            for k, (dy, flare, ln) in enumerate(((-0.022, 0.035, 0.22), (0.024, 0.060, 0.18))):
                pts = [top + (sgn * 0.008, dy * 0.4, -0.01), top + (sgn * (0.012 + flare * 0.3), dy, -0.07),
                       top + (sgn * (0.016 + flare * 0.7), dy * 1.3, -0.14), top + (sgn * (0.02 + flare), dy * 1.5, -ln)]
                for a, b in zip(pts[:-1], pts[1:]):
                    rib.add(FlatCapsule(a, b, 0.019, 0.0042, side=(1.0, 0.0, 0.0)), k=0.004)
                rib.sub(Sphere(pts[-1] - (0.0, 0.0, 0.006), 0.010), k=0.002)          # a notched (swallowtail) end
        out.append(("ribbons", rib, 0.6, "ribbon", "bone:prop.R", 420))
        # the hat band: a ribbon 2.4 cm tall standing proud of the felt dome's lower edge, and a bow at the left
        cr = Sculpt("cap_ribbon")
        ry = 0.134 / 0.122

        def band(r, z):
            rd = 0.134 * np.sqrt(np.clip(1.0 - ((z - 1.765) / 0.12) ** 2, 0.0, 1.0))
            return np.maximum(np.abs(r - rd - 0.0015) - 0.0032, np.abs(z - 1.803) - 0.012)
        cr.add(Lathe((0, -0.005, 0), band, 0.15, 1.785, 1.82, axes=np.diag([1.0, ry, 1.0])), k=0.0)
        bow = np.array([0.122, 0.035, 1.806])
        for lp in (1.0, -1.0):                               # two flattened loops, up-forward and down-back
            c_ = bow + np.array([0.012, 0.03 * lp, 0.012 * lp])
            cr.add(Torus(c_, 0.024, 0.0045, axes=sdf.frame(unit((1.0, 0.25 * lp, 0.1))), rz=0.009), k=0.004)
        cr.add(Sphere(bow + (0.006, 0.0, 0.0), 0.011), k=0.004)
        for tip in ((0.150, 0.010, 1.73), (0.142, 0.058, 1.735)):
            cr.add(FlatCapsule(bow + (0.008, 0.0, -0.006), np.asarray(tip), 0.011, 0.0032, side=(0.0, 1.0, 0.0)), k=0.004)
        out.append(("cap_ribbon", cr, 0.5, "ribbon", "bone:head", 340))
    return out


def extra_materials(ctx) -> dict:
    """the pot, rim, cord and Noon Fair roles (skins re-colour each apart from the mask and the straps)"""
    pal = dict(ctx.palette)
    return {"wood": materials.carved_wood("wood", pal, "wood", ctx.gradient, rough=0.8),   # oiled, not glossy: the
            # bar's top is what the high game camera sees, and a sheen there mirrors the pale sky (a grey bar)
            # matte waxed leather: at 0.5 the boots and straps mirror the bright ground and sky and read pale grey
            "leather": materials.waxed_leather("leather", pal, "leather", ctx.gradient, rough=0.88),
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


# ── export: the shipping compression with the base colour at WebP q76 (wraps export.optimize in this build
# process only; the shared optimize.mjs takes --q-base): the toned painting (light sandstone, felt, the carved
# head's crisp cracks) costs more bytes at the default q80 than the 1172 KiB budget leaves ──
from common import export as _export  # noqa: E402

Q_BASE = 76
_optimize0 = _export.optimize


def _optimize_odrum(path, out=None, quantize=False, fighter=False):
    if not fighter:
        return _optimize0(path, out, quantize, fighter)
    import subprocess
    out = out or path
    script = os.path.join(scene.TOOLS_DIR, "optimize.mjs")
    node = _export.node_exe()
    before = os.path.getsize(path)
    if not node or not os.path.isfile(script):
        return _optimize0(path, out, quantize, fighter)
    args = [node, script, path, out] + (["--quantize"] if quantize else []) + ["--fighter", "--q-base", str(Q_BASE)]
    r = subprocess.run(args, cwd=scene.GAME_DIR, capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        scene.log(f"optimize failed ({r.returncode}): {r.stderr.strip()[:800]}")
        return {"ok": False, "before": before, "after": before, "error": r.stderr[-800:]}
    scene.log(r.stdout.strip())
    return {"ok": True, "before": before, "after": os.path.getsize(out), "q_base": Q_BASE}


_export.optimize = _optimize_odrum


# ── portrait framing (wraps render._fit_camera / fighter_renders while Odrum's renders run, this process only):
# the brief's portrait is "the mask under the cap with the near pot and its lit window in the corner", but the
# shared head-box fit (head +-0.3 m) cannot reach a pot hung 0.8 m out on the 2.06 m yoke: it showed only a sliver
# of the far pot at the edge (and the Noon Fair portrait could not show its lanterns). Odrum's portrait box runs
# from just left of the mask to past the near pot, down to the pots, seen from 36 degrees. ──
PORTRAIT = {"yaw": 36.0, "x": (-0.32, 0.98), "z0": 0.98}


def _install_render() -> None:
    from common import render
    if getattr(render.fighter_renders, "_odrum", False):
        return
    orig_fit, orig_fr, orig_ml = render._fit_camera, render.fighter_renders, render.map_lighting
    state = {"on": False}

    def ml(map_id):
        d = orig_ml(map_id)
        if state["on"]:
            d = dict(d, ambient=d["ambient"] * HERO_FILL)
        return d

    def fit(cam, lo, hi, yaw, pitch, lens, fill, aspect, x_frac, y_center=None):
        if state["on"] and abs(aspect - 1.0) < 1e-6 and abs(fill - 0.92) < 1e-6 and abs(lens - 85.0) < 1e-6:
            hx = (lo.x + hi.x) / 2
            lo = Vector((hx + PORTRAIT["x"][0], lo.y, PORTRAIT["z0"]))
            hi = Vector((hx + PORTRAIT["x"][1], hi.y, hi.z))
            yaw = PORTRAIT["yaw"]
        return orig_fit(cam, lo, hi, yaw, pitch, lens, fill, aspect, x_frac, y_center)

    def fr(ctx, *a, **k):
        state["on"] = getattr(ctx.spec, "ID", None) == ID
        try:
            return orig_fr(ctx, *a, **k)
        finally:
            state["on"] = False
    fr._odrum = True
    render._fit_camera = fit
    render.fighter_renders = fr
    render.map_lighting = ml


_install_render()


# ── binding: the jerkin's skirt hangs from the hips (wraps pipeline.bind_part in this build process only) ──
from common import mesh as _mesh, pipeline as _pipeline  # noqa: E402

_bind0 = _pipeline.bind_part
SKIRT_LEG = 0.70                     # share of the bone-heat leg weight the skirt keeps (the rest goes to the hips)
SKIRT_CROSS = 0.22                   # ... of which this much follows the OTHER thigh (the front panels blend)


def _bind_odrum(ctx, part, obj, body_low=None):
    """pipeline.bind_part, then the skirt's leg weights softened: bone heat gave the knee-length panels 100 % of
    the nearest thigh (and some shin), so in the run a panel wrapped the thigh like a trouser leg. Shin weight
    moves to its thigh, the legs keep SKIRT_LEG of it (each panel partly following the other thigh too) and
    the rest hangs from the hips: the skirt swings with the stride as one garment."""
    res = _bind0(ctx, part, obj, body_low)
    if part.name != "skirt":
        return res
    vg = obj.vertex_groups
    hips = vg.get("hips") or vg.new(name="hips")
    tl = vg.get("thigh.L") or vg.new(name="thigh.L")
    tr = vg.get("thigh.R") or vg.new(name="thigh.R")
    names = {g.index: g.name for g in vg}
    moved = 0
    for v in obj.data.vertices:
        w = {names[g.group]: g.weight for g in v.groups}
        leg_l = w.get("thigh.L", 0.0) + w.get("shin.L", 0.0) + w.get("foot.L", 0.0)
        leg_r = w.get("thigh.R", 0.0) + w.get("shin.R", 0.0) + w.get("foot.R", 0.0)
        leg = leg_l + leg_r
        if leg < 1e-4:
            continue
        own_l = leg_l / leg
        k = SKIRT_LEG * leg
        nl = k * (own_l * (1 - SKIRT_CROSS) + (1 - own_l) * SKIRT_CROSS)
        nr = k - nl
        for b in ("shin.L", "shin.R", "foot.L", "foot.R"):
            g = vg.get(b)
            if g is not None and b in w:
                g.remove([v.index])
        tl.add([v.index], nl, "REPLACE")
        tr.add([v.index], nr, "REPLACE")
        hips.add([v.index], w.get("hips", 0.0) + (leg - k), "REPLACE")
        moved += 1
    _mesh.limit_weights(obj)
    scene.log(f"odrum skirt: leg weights softened on {moved} vertices (keep {SKIRT_LEG}, cross {SKIRT_CROSS})")
    return res


_pipeline.bind_part = _bind_odrum


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

    # the arm's rolls are the ones the two-bone IK solves to for this very pose (z = away from the elbow's bend,
    # anim.Skeleton.solve_two_bone): every IK'd clip then starts from zero twist. With the rolls at FRONT the IK
    # twisted the upper arm ~110 degrees about its own axis and the raised sleeve wrung into a fin at the elbow.
    a_ = unit(WRIST_R - SH_R)
    e_ = ELBOW_R - SH_R
    p_ = unit(e_ - a_ * float(e_ @ a_))
    y1 = unit(e_)
    z1 = unit(-p_ - y1 * float(-p_ @ y1))
    x1 = np.cross(y1, z1)
    z2 = unit(np.cross(x1, unit(WRIST_R - ELBOW_R)))
    put("upper_arm.R", SH_R, ELBOW_R, Vector(tuple(z1)))
    put("forearm.R", ELBOW_R, WRIST_R, Vector(tuple(z2)))
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
    pc = np.array([POUCH_X, STAFF_Y - 0.002, staff_z(POUCH_X) - POUCH_DROP])
    new("x_sling_pouch", pc, pc - STAFF_AX * 0.1, "prop.R", False, UP)
    pel = pc + np.array([0.0, -0.02, 0.068])                  # the amber bead in the pouch mouth (loaded)
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
WALNUT = "#B49470"                                        # oiled pale walnut (the concept's bar): warm, under 40 % sat
WALNUT_GRAIN = "#6A4A30"                                  # its darker grain lines and knots
# the yoke's props are not painted on the concept at the yoke's built length: they paint procedurally, in the
# concept's palette and light (oiled pale walnut, wound leather, glossy amber lampresin)
PROCEDURAL = {"staff": "walnut", "staff_wraps": "band", "staff_caps": "amber", "staff_collars": "collar", "pouch": "pouch",
              "resin_R": "resin", "resin_L": "resin", "wrap_L": "wrap", "wrap_R": "wrap", "neckwrap": "linen",
              "ring_R": "ring", "ring_L": "ring"}
# the carved head's side planes (the front/back projection only grazes them): carved stone in the mask's own
# sandstone, lit plane by plane by the key light (the carving is in the geometry: no painted cracks or swirls)
SIDE_STONE = ("mask",)
# undersides the projection fills with the concept's background (a pale crescent under a fist): their side paint
UNDERSIDE = ("hand_L", "hand_R", "mask")
# near-flat tops streak under a front/back projection (radial pinwheels from above): there the part's own
# side paint is laid on in felt/stone value noise and the key light
DESTREAK = ("cap", "mask", "pot_R", "pot_L", "pot_rim_R", "pot_rim_L", "boots")
# projected parts cleaned of stray texels (background specks, a saturated sliver at a slit)
DESPECKLE = ("cap", "mask", "coat", "straps", "belt", "skirt", "trousers", "boots", "hand_L", "hand_R",
             "pot_R", "pot_L", "pot_rim_R", "pot_rim_L")
# the painting toned to the brief's value read (section 5/6: light head, mid jerkin, dark feet; no large area over
# 40 % saturation in the reserved marigold band): each part's painted texels keep their own light, cracks and
# shading (the luminance pattern about the part's median) in the target colour, with `keep` of the painted hue
# play. Sandstone #D8C19D and felt #CDBFA8 are the brief's; the targets sit a step warmer and darker so the
# concept's golden mask and brown felt still read (the concept painted them saturated orange-brown: in game the
# cap, mask and pots fell inside the marigold band and the whole figure read as one dark rust mass).
TONE = {"mask": ("#B5A187", 0.12), "hand_L": ("#AA957A", 0.15), "hand_R": ("#AA957A", 0.15),
        "pot_R": ("#B9A589", 0.12), "pot_L": ("#B9A589", 0.12), "pot_rim_R": ("#AD997E", 0.12), "pot_rim_L": ("#AD997E", 0.12),
        "cap": ("#9A9080", 0.18), "coat": ("#6E5646", 0.30), "skirt": ("#6B5444", 0.30), "straps": ("#4F3B2F", 0.40),
        "belt": ("#45342A", 0.40), "trousers": ("#3A3029", 0.40), "boots": ("#33281F", 0.40)}


def _hex(h):
    return np.asarray(scene.hex_srgb(h), dtype=np.float32)


def _hue(c):
    """hue in degrees of sRGB rows (n, 3)"""
    r, g, b = c[:, 0], c[:, 1], c[:, 2]
    mx, mn = c.max(axis=1), c.min(axis=1)
    d = np.maximum(mx - mn, 1e-6)
    h = np.where(mx == r, (g - b) / d % 6.0, np.where(mx == g, (b - r) / d + 2.0, (r - g) / d + 4.0))
    return h * 60.0


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
             "wrap_R": (tuple(ELBOW_R + unit(WRIST_R - ELBOW_R) * 0.07), tuple(WRIST_R + unit(WRIST_R - ELBOW_R) * 0.005))}
WRAP_STARTS, WRAP_LAMBDA = 3, 0.08       # three strap strands each way, 8 cm apart along the arm: ~40 degree straps


def wrap_bands(P, name):
    """(strap a, strap b, along) for points of a forearm wrap: two families of leather straps wound in opposite
    helices (the concept's criss-cross binding), 1 = on a strap's centre line"""
    a, b = WRAP_AXES[name]
    t, ang = _cyl(P, a, b)
    ph = 2.0 * math.pi * t / WRAP_LAMBDA
    s1 = _smooth(0.50, 0.78, np.cos(ph + WRAP_STARTS * ang))
    s2 = _smooth(0.50, 0.78, np.cos(ph - WRAP_STARTS * ang + 1.1))
    return s1, s2, t


def wrap_relief(name):
    """the straps stand proud of the sleeve under them (the sculpt displacement)"""
    def fn(P):
        s1, s2, _ = wrap_bands(np.asarray(P, dtype=np.float64), name)
        return -0.0028 * np.maximum(s1, s2)
    return fn


def _procedural(kind, name, P, N):
    """sRGB colour (n, 3) for the texels of a procedurally painted part (rest-pose points and normals)"""
    lam, shade = _light(N)
    if kind == "walnut":                                  # oiled pale walnut: long grain lines, knots, broad tone drift
        u = P[:, 0]
        ang = np.arctan2(P[:, 2] - staff_z(u), P[:, 1] - STAFF_Y)
        cyl = np.stack([u * 2.4, np.cos(ang) * 1.7, np.sin(ang) * 1.7], 1)
        grain = NOISE(cyl, 1.0) + 0.35 * NOISE(cyl * np.array([1.0, 2.6, 2.6]), 1.0, offset=(7.0, 1.0, 0.0))
        tone = NOISE(np.stack([u * 0.9, np.cos(ang) * 0.4, np.sin(ang) * 0.4], 1), 1.0, offset=(3.1, 0.0, 0.0))
        lines = np.exp(-(grain / 0.06) ** 2) + 0.5 * np.exp(-((grain - 0.33) / 0.05) ** 2)
        knot = np.clip(1.0 - np.hypot((u % 0.43) - 0.2, 0.012 * np.sin(ang * 3.0)) / 0.018, 0.0, 1.0) * (np.cos(ang) < -0.2)
        w = np.clip(0.55 * lines + 0.8 * knot, 0.0, 1.0)
        col = _hex(WALNUT)[None, :] * (1.0 + 0.13 * tone + 0.04 * NOISE(P, 140.0))[:, None]
        col = col * (1.0 - w[:, None]) + _hex(WALNUT_GRAIN)[None, :] * w[:, None]
        col *= (0.84 + 0.22 * lam)[:, None]
        col += np.array([0.10, 0.075, 0.045])[None, :] * np.clip(N @ SHEEN, 0, 1)[:, None] ** 10     # oiled warm sheen
    elif kind == "band":                                  # wound leather cord
        col = _hex("#5E4433")[None, :] * ((1.0 + 0.10 * NOISE(P, 60.0)) * shade)[:, None]
    elif kind == "pouch":                                 # one soft leather: lit body, the flap's edge, stitches, tie
        pc = np.array([POUCH_X, STAFF_Y - 0.002, staff_z(POUCH_X) - POUCH_DROP])
        q = P - pc
        dark = 0.82 + 0.18 * np.clip((q[:, 2] + 0.058) / 0.08, 0, 1)
        col = _hex("#70503A")[None, :] * ((1.0 + 0.05 * NOISE(P, 45.0) + 0.03 * NOISE(P, 130.0)) * dark
                                          * (0.80 + 0.30 * lam))[:, None]
        flap = (q[:, 1] < -0.036) & (q[:, 2] > -0.02)
        edge = flap & (np.abs(q[:, 2] + 0.014) < 0.004)              # the flap's lower edge: a dark crease
        col[edge] *= 0.55
        stitch = (np.abs(q[:, 0]) < 0.003) & (q[:, 1] > 0.0) & (np.sin(q[:, 2] * 520.0) > 0.2)   # back seam stitches
        col[stitch] = col[stitch] * 0.6 + _hex("#C9A77E") * 0.4
        tie = np.abs(q[:, 2] - 0.056) < 0.009
        col[tie] = _hex("#3E2A1E") * (0.85 + 0.25 * lam[tie])[:, None]
    elif kind == "linen":                                 # the mouth-wrap: pale linen wound round the neck
        ang = np.arctan2(P[:, 0], -(P[:, 1] + 0.012))
        fold = np.sin(P[:, 2] * 140.0 + ang)
        col = _hex("#C9BBA3")[None, :] * ((0.92 + 0.10 * fold + 0.04 * NOISE(P, 60.0)) * (0.80 + 0.30 * lam))[:, None]
        col[fold < -0.75] *= 0.80                         # the shadowed seam under each turn
    elif kind == "ring":                                  # the dark ironstone ring each window glass is set in
        col = _hex("#3B302A")[None, :] * ((1.0 + 0.08 * NOISE(P, 90.0)) * (0.80 + 0.40 * lam))[:, None]
        col += np.array([0.05, 0.045, 0.04])[None, :] * np.clip(N @ SHEEN, 0, 1)[:, None] ** 8
    elif kind == "collar":                                # dark oiled walnut collar under each amber cap
        col = _hex("#4E3526")[None, :] * ((1.0 + 0.06 * NOISE(P, 60.0)) * shade)[:, None]
    elif kind == "amber":                                 # glossy translucent amber: deep rim, glowing core, a hot spot
        deep, mid, glow, hi = _hex("#6E300C"), _hex("#C9741F"), _hex("#F2A93E"), _hex("#FFF2D2")
        f = np.clip(N @ KEY_LIGHT, -0.4, 1.0)
        u = P[:, 0]
        tip = np.clip((np.abs(u) - 0.94) / 0.11, 0.0, 1.0)            # light through the dome lights its far end
        col = deep + (mid - deep) * _smooth(-0.4, 0.35, f)[:, None]
        col = col + (glow - col) * (0.55 * _smooth(-0.6, 0.2, -f) * tip + 0.35 * _smooth(0.2, 0.7, f))[:, None]
        spec = _smooth(0.86, 0.97, np.clip(N @ SHEEN, 0, 1))
        col = col + (hi - col) * spec[:, None]
    elif kind == "resin":                                 # the resin in a pot mouth: warm amber, darker at the rim
        side = name[-1]
        px = POTS[side][0]
        rr = np.hypot(P[:, 0] - px, P[:, 1] - STAFF_Y) / 0.079
        col = _hex("#E4AE62")[None, :] + (_hex("#A25E20") - _hex("#E4AE62"))[None, :] * np.clip(rr, 0, 1)[:, None] ** 1.7
        hl = np.exp(-(((P[:, 0] - px + 0.026) ** 2 + (P[:, 1] - STAFF_Y + 0.03) ** 2) / 0.00030))
        col = col * (1.0 + 0.05 * NOISE(P, 60.0))[:, None] + 0.30 * hl[:, None]
    elif kind == "wrap":                                  # brown leather straps criss-crossed over the grey sleeve
        s1, s2, t = wrap_bands(P, name)
        top = np.where(s1 >= s2, s1, s2)                  # the strap on top where two cross
        sleeve = _hex("#5A524B")[None, :] * (1.0 + 0.06 * NOISE(P, 55.0))[:, None]
        strap = _hex("#7C5A40")[None, :] * (1.0 + 0.08 * NOISE(P, 80.0) + 0.05 * NOISE(P * np.array([1, 1, 4.0]), 30.0))[:, None]
        edge = np.clip(1.0 - np.abs(top - 0.5) / 0.5, 0, 1) ** 2      # a dark seam along each strap's edge
        col = sleeve * (1.0 - top[:, None]) + strap * top[:, None]
        col = col * (1.0 - 0.45 * edge[:, None] * (top[:, None] > 0.05))
        col *= (0.78 + 0.34 * lam + 0.05 * np.clip(N[:, 2], 0, 1))[:, None]
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
    def sel(nm):
        if nm not in names:
            return None
        m = part == names.index(nm)
        return m if m.any() else None
    # undersides (a fist's wrist, the chin): the part's side paint, in shade (no concept background crescent)
    for nm in UNDERSIDE:
        m = sel(nm)
        if m is None:
            continue
        n = N[m]
        sidem = (np.abs(n[:, 2]) < 0.3)
        if sidem.sum() < 16:
            continue
        ref = np.median(out[m][sidem], axis=0)
        w = _smooth(-0.25, -0.6, n[:, 2])
        p = Pw[m].astype(np.float64)
        under = ref[None, :] * (0.62 + 0.06 * NOISE(p, 40.0))[:, None]
        out[m] = out[m] * (1.0 - w[:, None]) + under * w[:, None]
    # the stone head's and mask's side planes: carved ochre stone (facets, cracks) in the key light
    mm = sel("mask")
    stone_ref = None
    if mm is not None and (N[mm][:, 1] < -0.6).sum() >= 16:
        stone_ref = np.median(out[mm][N[mm][:, 1] < -0.6], axis=0)      # the mask's painted front: its stone
    for nm in SIDE_STONE:
        m = sel(nm)
        if m is None or stone_ref is None:
            continue
        n = N[m].astype(np.float64)
        p = Pw[m].astype(np.float64)
        w = _smooth(0.45, 0.80, np.abs(n[:, 0]))
        # the head block's top-back under the brim (the back plate paints the brim's shadow there)
        w = np.maximum(w, _smooth(0.30, 0.65, n[:, 1]) * _smooth(1.645, 1.665, p[:, 2]))
        lam, shade = _light(n, 0.80, 0.28)                 # plane by plane in the key light: the geometry carves
        col = stone_ref[None, :] * (shade * (1.0 + 0.035 * NOISE(p, 45.0) + 0.02 * NOISE(p, 140.0)))[:, None]
        out[m] = out[m] * (1.0 - w[:, None]) + np.clip(col, 0, 1) * w[:, None]
    # the throat and collar: under the mask the concept paints the chin, its shadow and the neck (ochre and dark
    # flecks that land as dirt and slivers on the jerkin's collar) -> the collar is the jerkin's own felt there,
    # lit plane by plane (the linen mouth-wrap fills the V)
    m = sel("coat")
    if m is not None:
        p = Pw[m].astype(np.float64)
        c = out[m]
        n = N[m].astype(np.float64)
        ref_zone = (p[:, 2] > 1.18) & (p[:, 2] < 1.32) & (p[:, 1] < 0.0) & (np.abs(p[:, 0]) > 0.05) & (np.abs(p[:, 0]) < 0.16)
        if ref_zone.sum() > 64:
            ref = np.median(c[ref_zone], axis=0)
            w = (_smooth(1.355, 1.385, p[:, 2]) * _smooth(0.16, 0.13, np.abs(p[:, 0])) * _smooth(0.06, 0.02, p[:, 1]))
            lam, shade = _light(n, 0.78, 0.30)
            felt_c = ref[None, :] * (shade * (1.0 + 0.05 * NOISE(p, 50.0) + 0.03 * NOISE(p, 160.0)))[:, None]
            out[m] = c * (1.0 - w[:, None]) + np.clip(felt_c, 0, 1) * w[:, None]
            scene.log(f"odrum paint: collar repainted in felt on {int((w > 0.5).sum())} texels")
    # boot soles: the welt's bottom 2 cm in dark waxed leather (not the pale plank the ground plate gave it); the
    # toe and instep tops a step darker (they face the sun and sky: in the hero light they read paler than the
    # jerkin, against the dark-feet rule)
    m = sel("boots")
    if m is not None:
        p = Pw[m]
        k = _smooth(0.024, 0.012, p[:, 2])[:, None]
        sole = _hex("#2A1C14")[None, :] * (1.0 + 0.06 * NOISE(p.astype(np.float64), 50.0))[:, None]
        out[m] = out[m] * (1.0 - k) + sole * k
        up = (_smooth(0.30, 0.75, N[m][:, 2]) * _smooth(0.19, 0.12, p[:, 2]))[:, None]
        out[m] = out[m] * (1.0 - 0.42 * up)
    # the felt cap: the band's ochre the front plate lays on the brim's sides beside the band -> the cap's felt
    m = sel("cap")
    if m is not None:
        c = out[m]
        mx, mn = c.max(axis=1), c.min(axis=1)
        sat = (mx - mn) / np.maximum(mx, 1e-4)
        hue = _hue(c)
        ochre = (sat > 0.50) & (hue > 26.0) & (hue < 58.0) & (mx > 0.42)
        if ochre.any() and (~ochre).sum() > 64:
            ref = np.median(c[~ochre], axis=0)
            n = N[m][ochre]
            lam, shade = _light(n, 0.80, 0.26)
            c[ochre] = ref[None, :] * (shade * (1.0 + 0.06 * NOISE(Pw[m][ochre].astype(np.float64), 30.0)))[:, None]
            out[m] = c
            scene.log(f"odrum paint: {int(ochre.sum())} ochre texels on the cap -> felt")
    # chest: dark blotches the projection left beside the collar (not the stitched closure down the centre)
    m = sel("coat")
    if m is not None:
        p, c = Pw[m], out[m]
        L = c @ LUMA
        zone = (p[:, 2] > 1.24) & (p[:, 1] < 0.0) & (np.abs(p[:, 0]) > 0.035) & (np.abs(p[:, 0]) < 0.17)
        if zone.sum() > 64:
            med = float(np.median(L[zone]))
            mad = float(np.median(np.abs(L[zone] - med))) + 1e-3
            bad_c = zone & ((L < med - 4.0 * mad - 0.035) | (L > med + 4.0 * mad + 0.06))
            if bad_c.any():
                bm = np.zeros_like(m)
                bm[m] = bad_c
                iy, ix = project.nearest_index((part >= 0) & ~bm & (part == names.index("coat")))
                out[bm] = out[iy, ix][bm]
                scene.log(f"odrum paint: {int(bad_c.sum())} chest blotch texels on the coat -> felt")
    # the brief's value read: each part toned to its target (TONE), its painted light and cracks kept
    for nm, (hexc, keep) in TONE.items():
        m = sel(nm)
        if m is None:
            continue
        lin = project._lin(out[m])
        Y = lin @ LUMA
        Ym = max(float(np.median(Y)), 1e-4)
        tl = project._lin(_hex(hexc))
        Yt = float(tl @ LUMA)
        r = np.clip(Y / Ym, 0.0, 4.0)
        # a soft knee under the target's own ceiling (its brightest channel at 0.97): highlights compress in
        # value instead of clipping red first (a clipped channel turns a warm highlight yellow-green)
        rmax = 0.97 / max(float(tl.max()), 1e-4)
        kn = 0.7 * rmax
        r = np.where(r > kn, kn + (rmax - kn) * np.tanh((r - kn) / max(rmax - kn, 1e-4)), r)[:, None]
        new = tl[None, :] * r * (1.0 - keep) + lin * (Yt / Ym) * keep
        mxc = new.max(axis=1, keepdims=True)
        new = np.where(mxc > 0.98, new * (0.98 / np.maximum(mxc, 1e-4)), new)
        out[m] = project._srgb(np.clip(new, 0.0, 1.0)).astype(np.float32)
    # the eye voids: ink, darkest at the floor (the projection blends the head's back paint onto their walls)
    m = sel("mask")
    if m is not None:
        p = Pw[m].astype(np.float64)
        ev = in_eye(p, 0.0015) & (p[:, 1] > FY - 0.008)
        if ev.any():
            dep = np.clip((p[ev, 1] - (FY - 0.008)) / 0.03, 0.0, 1.0)
            c = out[m]
            c[ev] = _hex("#2E2620")[None, :] * (1.0 - 0.55 * dep)[:, None]
            out[m] = c
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
SHADEPRINT = {"ink": "#2B2A33", "pale": "#B7B4BE", "rim_col": "#DCD8E4",
              "lift": ("cap", "mask", "hand_L", "hand_R", "staff", "pot_rim_R", "pot_rim_L", "neckwrap"), "lift_k": 1.25,
              "inked": ("mask", "cap"), "inked_contrast": 1.55,      # carved cracks and stitches print in ink
              "deep": ("trousers", "boots", "belt", "straps", "wrap_L", "wrap_R", "pouch", "staff_wraps"), "deep_k": 0.45,
              # jerkin value by height (rest pose): pale shoulders, the ink rising from the hem past the belt
              "wash": ((0.45, 0.66, 0.92, 1.18, 1.40), (0.13, 0.22, 0.46, 0.92, 1.22)),
              "rim": ("coat", "skirt"), "rim_w": 0.60}

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
    shade_skin = _BUILD["id"] == "odrum_shadeprint"
    for i, n in enumerate(names):
        contrast = (SHADEPRINT["inked_contrast"] if n in SHADEPRINT["inked"] else 1.18) if shade_skin else 1.0
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
        # value relative to the brief's base colour; an inked part's own contrast (about its median) steepened
        Ym = max(float(np.median(Y)), 1e-4)
        rel = np.clip(Ym / Yr, 0.0, 4.0) ** (1.18 if shade_skin else 1.0) * np.clip(Y / Ym, 0.0, 6.0) ** contrast
        val = tgt[None, :] * np.clip(rel, 0.0, 4.0)[:, None]
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
        rimc = project._lin(scene.hex_srgb(SHADEPRINT["rim_col"]))
        for nm in SHADEPRINT["rim"]:                  # light-rimmed edges: the print's pale outline on the jerkin
            m = sel(nm)
            if m is None:
                continue
            n = Nn[m].reshape(-1, 3)
            p = P[m].reshape(-1, 3)
            side = _smooth(0.86, 0.98, np.abs(n[:, 0])) * (n[:, 2] > -0.4)          # a thin rim on the flanks' edge
            edge = np.zeros(len(p))
            if nm == "skirt":
                edge = np.maximum(edge, _smooth(0.518, 0.505, p[:, 2]))           # a fine pale line along the hem
            rim = np.clip(np.maximum(side * 0.85, edge) * SHADEPRINT["rim_w"]
                          * (0.85 + 0.15 * NOISE(p, 40.0)), 0.0, 1.0)[:, None]
            out[m] = out[m] * (1.0 - rim) + rimc[None, :] * rim
        log("  shadeprint: pale above, ink wash on the jerkin, ink below, light-rimmed edges and hem")
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
                            right fist along the bar (the centre of a spinning bar);
      "_trail" (w, 0, 0) + "_tdir" (x, y, z)   blends each pot toward TRAILING a whirling bar: in the whirl's
                            plane, POT_TRAIL_DEG off the bar's line, outward and behind the motion `_tdir` (the
                            bar's angular direction at its long end): the pots whip round behind the bar ends;
    and always: a pot never lies closer than POT_MIN_DEG to the bar's line (a plumb pot under a steep bar, or a
    flung one, would hang ALONG the shaft: the bar through its mouth and belly), and never goes through the
    ground (it tips outward / its fling eases just enough)."""
    pose = dict(pose)
    rigid = pose.get("_rigid", (0.0, 0.0, 0.0))[0]
    swing = pose.get("_swing", (0.0, 0.0, 0.0))
    fling = pose.get("_fling", (0.0, 0.0, 0.0))
    trail = pose.get("_trail", (0.0, 0.0, 0.0))[0]
    tdir = Vector(pose.get("_tdir", (0.0, 0.0, 0.0)))
    out = _resolve0(skel, pose)
    if _HANG[0] not in skel.rest:
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
        if trail > 1e-3 and tdir.length > 1e-6:
            s_knot = (POTS[side][2] - GRIP_R[0]) / STAFF_AX[0]
            sg = 1.0 if s_knot >= 0.0 else -1.0                # the knot's side of the fist: out = along +-axis
            mv = (tdir - axis * tdir.dot(axis)).normalized() * sg      # the knot's motion (in the whirl's plane)
            a_ = math.radians(POT_TRAIL_DEG)
            d_t = (axis * sg * math.cos(a_) - mv * math.sin(a_)).normalized()
            wt_ = (rest.col[1].normalized().rotation_difference(d_t).to_matrix() @ rest)
            qt = (Pm.inverted() @ wt_).to_quaternion()
            q = q.slerp(qt, min(trail, 1.0))
        # never along the shaft: the hang direction kept at least POT_MIN_DEG off the bar's line
        d_now = (Pm @ q.to_matrix()).col[1].normalized()
        cosb = d_now.dot(axis)
        lim = math.cos(math.radians(POT_MIN_DEG))
        if abs(cosb) > lim:
            perp = d_now - axis * cosb
            if perp.length < 1e-5:
                perp = axis.orthogonal()
            perp.normalize()
            d_new = axis * (lim if cosb > 0 else -lim) + perp * math.sqrt(1.0 - lim * lim)
            Wm = Pm @ q.to_matrix()
            Wn = d_now.rotation_difference(d_new).to_matrix() @ Wm
            q = (Pm.inverted() @ Wn).to_quaternion()
        if _pot_low(knot, Pm, q) < -0.004:                     # tip the pot outward off the ground (standing is fine)
            q1 = q
            lo, hi = 0.0, 90.0
            for _ in range(10):
                mid = 0.5 * (lo + hi)
                qq = (Pm.inverted() @ Matrix.Rotation(math.radians(mid), 3, out_ax) @ (Pm @ q1.to_matrix())).to_quaternion()
                lo, hi = (lo, mid) if _pot_low(knot, Pm, qq) >= -0.004 else (mid, hi)
            q = (Pm.inverted() @ Matrix.Rotation(math.radians(hi), 3, out_ax) @ (Pm @ q1.to_matrix())).to_quaternion()
        out[b] = skel.euler_of(q.to_matrix())
    return out


RUN_PITCH_FIX, RUN_TOE_K = True, 1.0                    # run foot pitch flipped (see clip_overrides' RUN)
POT_REACH = POT_DROP + POT_H * 0.5                      # knot to the pot's centre along the hang bone
POT_MIN_DEG = 62.0                                       # the closest a pot's hang may lie to the bar's line: the
                                                         # belly centre stays >= 0.26 m off the shaft, the rim >= 0.12
POT_TRAIL_DEG = 68.0                                     # a whirled pot trails this far off the bar's line


def _pot_low(knot, Pm, q) -> float:
    """lowest point (z) of a pot whose hang bone is at `knot` with parent frame Pm and local rotation q"""
    d = (Pm @ q.to_matrix()).col[1].normalized()
    c = knot + d * POT_REACH
    return c.z - 0.121 * abs(d.z) - 0.14 * math.sqrt(max(0.0, 1.0 - d.z * d.z))   # foot below the centre / belly + window


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


def chest_frame(skel, body: dict):
    """(R, t): the chest's rotation and offset from rest in `body` (its hips offset and torso rotations)"""
    b = {k: v for k, v in body.items() if k != "ik"}
    M = skel.fk(_resolve0(skel, b))
    R = M["chest"].to_3x3() @ skel.rest["chest"].to_3x3().inverted()
    return R, M["chest"].translation - R @ skel.rest["chest"].translation


def path(keys, f):
    """(grip, axis, left, poles) along keyed yoke holds [(frame, grip, axis, left_w, pole_r, pole_l)]: grips eased
    point to point, axes slerped, the off hand's weight and the elbow poles blended"""
    if f <= keys[0][0]:
        k = keys[0]
        return Vector(k[1]), Vector(k[2]).normalized(), k[3], Vector(k[4]), Vector(k[5])
    for a, b in zip(keys[:-1], keys[1:]):
        if f <= b[0]:
            u = anim.ease_in_out((f - a[0]) / max(1e-6, b[0] - a[0]))
            ax = Vector(a[2]).normalized().slerp(Vector(b[2]).normalized(), u)
            return (Vector(a[1]).lerp(Vector(b[1]), u), ax, a[3] + (b[3] - a[3]) * u,
                    Vector(a[4]).lerp(Vector(b[4]), u), Vector(a[5]).lerp(Vector(b[5]), u))
    k = keys[-1]
    return Vector(k[1]), Vector(k[2]).normalized(), k[3], Vector(k[4]), Vector(k[5])


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

    # RUN (the shared run cycle for the legs, torso and bob; the yoke stays on the shoulders). On this rig the
    # shared solver turns the run's foot pitch the wrong way (the foot's local X runs along -X: + "toes up" put
    # the toes down at the heel strike, the push-off sank the heel 2 cm and the back-swing pointed the toes up),
    # so each foot target's pitch is flipped and its offset moved so the foot still turns about the pivot the
    # generator meant (heel at the strike, ball at the push-off): the heel now lifts off the planted ball.
    base_run = anim.gen_run(prof)

    def fix_pitch(side, ft):
        pt = ft.pitch
        if abs(pt) < 1e-6:
            return ft
        rest_f = skel.rest[f"foot.{side}"]
        ankle0 = rest_f.translation.copy()
        ball0 = skel.rest[f"toe.{side}"].translation.copy()
        heel0 = ankle0 + Vector((0, 0, -ankle0.z)) + (ankle0 - ball0) * Vector((1, 1, 0)) * 0.55
        lat = rest_f.to_3x3().col[0].normalized()
        pn = -pt
        rot = Matrix.Rotation(math.radians(ft.yaw), 3, "Z") @ Matrix.Rotation(math.radians(-pn), 3, lat)
        want_pv, got_pv = (heel0 if pt > 0 else ball0), (heel0 if pn > 0 else ball0)
        d = (want_pv - got_pv) - rot @ (want_pv - got_pv)
        # the toes stay on the ground while the heel lifts (the solver only counter-bends them for its own
        # negative pitch, now the strike): counter-bend at the push-off, none at the strike
        near = max(0.0, min(1.0, 1.0 - ft.ankle[2] / 0.06))       # on the ground (the push-off), not in the swing
        toe = ft.toe + (RUN_TOE_K * abs(pt) * near if pt < 0 else -pt)
        return FT(tuple(ft.ankle[i] + d[i] for i in range(3)), pn, ft.yaw, toe, ft.knee, ft.weight)

    def run_s(t):
        p = dict(base_run.sample(t))
        for b in ARM_BONES:
            p.pop(b, None)
        p["ik"] = {k: (fix_pitch(k[-1], v) if RUN_PITCH_FIX else v) for k, v in p["ik"].items() if k.startswith("foot")}
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

    def rp(body, yoke, *extra):                      # the yoke riding the chest of `body`
        return pose(body, {}, (0.0, 0.0, 0.0), ride(skel, body, *yoke), *extra)

    # ATTACK1 (25, f10): the pellet flick, small and quick (it repeats every 1.5 s, so it must not sweep the 2 m
    # yoke): the bar stays across the shoulders and only TIPS: the fist cocks the sling end up and back (f0-f6),
    # then snaps it down and a little forward (f10, the pellet leaves the pouch) with a short rock of the body;
    # the free hand does the flick you read from above: drawn back past the hip, then tossed forward and up at
    # the target. Never more than ~16 degrees of turn: attack2 (the lance) is the one that points the bar.
    b_w = pose(g, P(hips=(0, -4, 0), spine=(-2, -4, 0), chest=(-3, -6, 2), head=(2, 6, 0), upper_arm_L=(-28, 0, 6),
                    forearm_L=(22, 0, 0), hand_L=(-20, 0, 0)), (0, 0.015, 0.0))
    b_h = pose(g, P(hips=(3, 6, 0), spine=(4, 5, 0), chest=(6, 7, -2), head=(-4, -7, 0), upper_arm_L=(62, 0, 10),
                    forearm_L=(18, 0, 0), hand_L=(25, 0, 0)), (0, -0.03, -0.02))
    b_f = pose(g, P(hips=(4, 7, 0), spine=(5, 6, 0), chest=(7, 8, -2), head=(-5, -8, 0), upper_arm_L=(55, 0, 10),
                    forearm_L=(22, 0, 0), hand_L=(15, 0, 0)), (0, -0.035, -0.025))
    out["attack1"] = strike("attack1", 25, gI,
                            rp(b_w, yoke_about(PIV, -6, -12, (0.0, 0.01, 0.0)), swing(8, 0)),
                            rp(b_h, yoke_about(PIV, 13, 10, (0.0, 0.015, 0.0)), swing(26, 6)),
                            rp(b_f, yoke_about(PIV, 15, 8, (0.0, 0.015, 0.0)), swing(14, 4)))

    # ATTACK2 (25, f10): the staff jab. The fist swings the yoke off the shoulder (the long part round BEHIND the
    # head) into a lance at his right side, level at chest height and outside the arm, the sling end forward:
    # drawn back with the right shoulder back (f0-f6), then driven straight at the target with a lunge on the left
    # foot, the chest square to the target and the free hand forward (f10); held, home by f25. Silhouette: the bar
    # from across the shoulders to a level lance pointing at the target.
    lunge = feet_from(g, dl=(0.0, -0.20, 0.0))
    j_w = pose(g, P(hips=(-2, -10, 0), spine=(-2, -6, 0), chest=(-4, -8, 0), head=(2, 12, 0), upper_arm_L=(30, 0, 8),
                    forearm_L=(40, 0, 0)), (0, 0.04, -0.03))
    j_h = pose(g, P(hips=(6, 10, 0), spine=(5, 6, 0), chest=(6, 8, 0), head=(-4, -10, 0), upper_arm_L=(42, 0, 10),
                    forearm_L=(26, 0, 0)), (0, -0.12, -0.06), lunge)
    j_f = pose(g, P(hips=(7, 11, 0), spine=(6, 7, 0), chest=(7, 9, 0), head=(-5, -11, 0), upper_arm_L=(38, 0, 10),
                    forearm_L=(28, 0, 0)), (0, -0.13, -0.065), lunge)
    pole_j = (-0.8, 0.45, -0.4)
    out["attack2"] = strike(
        "attack2", 25, gI,
        pose(j_w, {}, (0.0, 0.0, 0.0), hold(Vector((-0.43, 0.10, 1.28)), Vector((0.04, 1.0, 0.02)), pole_r=pole_j), swing(4, 0)),
        pose(j_h, {}, (0.0, 0.0, 0.0), hold(Vector((-0.41, -0.34, 1.27)), Vector((0.02, 1.0, 0.0)), pole_r=pole_j), swing(14, 4)),
        pose(j_f, {}, (0.0, 0.0, 0.0), hold(Vector((-0.41, -0.37, 1.26)), Vector((0.02, 1.0, -0.01)), pole_r=pole_j), swing(8, 4)))

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

    # CAST_A2 (30, f12) Swing Out: the yoke comes off the shoulders (up over the cap, f0-f3) and down in front into
    # BOTH hands at waist height (f6); a full 360 degree whirl on the spot (the coil to -50 by f5, +410 to f20,
    # fastest through the front at the impact f12), the bar level at the belt and the pots at its ends trailing
    # and flung out wide (a spinning cross from above, the pots sweeping low and wide); from f16 he leans into the
    # run (the haste) with the left foot stepping out; the free hand lets go at f19 and pumps, the yoke goes back
    # up over the cap onto the shoulders by f29. The left arm never grips at shoulder height (no stretched sleeve).
    heel = _feet_rest(skel)
    fl0, fr0 = g["ik"]["foot.L"], g["ik"]["foot.R"]
    back_lo = (-0.34, 0.34, 1.60)                                    # back off the neck first (clear of the head)
    over_b, over_f = (-0.33, 0.28, 1.92), (-0.31, -0.30, 1.92)        # over the cap: behind, then in front of it
    waist = (-0.25, -0.235, 1.10)                                    # the right fist at the belt, the bar across
    pr_up, pl_up = (-0.9, 0.2, 0.0), (0.9, 0.2, 0.0)
    pr_lo, pl_lo = (-0.8, 0.45, -0.4), (0.8, 0.45, -0.4)
    a2_keys = [(0.0, tuple(GRIP0), tuple(AX0), 0.0, _POLES["R"], (0.8, 0.4, -0.4)),
               (1.1, back_lo, (1.0, 0.0, 0.0), 0.6, pr_up, pl_up),
               (2.4, over_b, (1.0, 0.0, 0.0), 1.0, pr_up, pl_up),
               (3.6, over_f, (1.0, -0.02, 0.0), 1.0, pr_up, pl_up),
               (6.0, waist, (1.0, 0.04, -0.02), 1.0, pr_lo, pl_lo),
               (18.0, waist, (1.0, 0.04, -0.02), 1.0, pr_lo, pl_lo),
               (19.5, (-0.26, -0.26, 1.18), (1.0, 0.0, 0.0), 0.0, pr_lo, pl_lo),
               (23.0, over_f, (1.0, -0.02, 0.0), 0.0, pr_up, pl_up),
               (25.3, over_b, (1.0, 0.0, 0.0), 0.0, pr_up, pl_up),
               (27.4, back_lo, (1.0, 0.0, 0.0), 0.0, pr_up, pl_up),
               (29.0, tuple(GRIP0), tuple(AX0), 0.0, _POLES["R"], (0.8, 0.4, -0.4))]

    def spin_at(t):
        """body yaw (deg): coil right to -50 by f5, then 410 degrees round to +360 by f20 (fastest at f12)"""
        f = t * 30
        if f <= 5:
            return -50.0 * anim.ease_in_out(f / 5)
        if f <= 20:
            u = (f - 5) / 15
            return -50.0 + 410.0 * anim.sine(u)
        return 360.0

    def a2_s(t):
        f = t * 30
        th = spin_at(t)
        crouch = 0.05 * math.sin(math.pi * min(1.0, f / 22)) + 0.03 * math.sin(math.pi * max(0.0, min(1.0, (f - 6) / 12))) ** 2
        lean = anim.ease_in_out(max(0.0, min(1.0, (f - 16) / 8)))          # leans into the run from f16, held
        pump = max(0.0, min(1.0, (f - 19) / 5)) * (1.0 - max(0.0, min(1.0, (f - 27) / 3)))
        p = anim.add(g, P(hips=(6 * lean, th, 0), spine=(4 + 5 * lean, 0, 0), chest=(3 + 3 * lean, 0, 0),
                          neck=(-3 * lean, 0, 0), head=(-5 * lean, 0, 0)))
        p = with_hips(p, (0.0, -0.05 * lean, -crouch - 0.03 * lean))
        R = Matrix.Rotation(math.radians(th), 3, "Z")
        ik = {}
        step = Vector((0.0, -0.16 * lean, 0.0))                 # the left foot steps out into the run
        for s_, ft0, h in (("L", fl0, heel["L"]), ("R", fr0, heel["R"])):
            off = R @ (h + Vector(ft0.ankle)) - h
            if s_ == "L":
                off = off + step
            ik[f"foot.{s_}"] = FT((off.x, off.y, 0.0), 0.0, ft0.yaw + th)
        p["ik"] = ik
        grip, ax, lw, prl, pll = path(a2_keys, f)
        h = ride(skel, p, grip, ax, None, pole_r=tuple(prl))
        p["ik"].update(h["ik"])
        if lw > 1e-3:
            p["ik"]["hand.L"] = HT(to_prop=("prop.R", left_on), pole=tuple(pll), weight=min(1.0, lw))
        elif pump > 0:
            p = anim.add(p, P(upper_arm_L=(34 * pump, 0, 6 * pump), forearm_L=(44 * pump, 0, 0)))
        # the pots: trailing the whirl in its plane and flung out (f5-f20), back to plumb as it stops
        Rc, _ = chest_frame(skel, p)
        axw = Rc @ ax
        tr = max(0.0, min(1.0, (f - 5.0) / 3.0)) * (1.0 - max(0.0, min(1.0, (f - 18.0) / 4.0)))
        p["_trail"] = (0.85 * tr, 0.0, 0.0)
        p["_tdir"] = tuple(Vector((0.0, 0.0, 1.0)).cross(axw))
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



ULT_TILT = 68.0                                          # the wheel's plane leans its top in over the head, 68 deg
                                                         # from vertical (a sling whirled overhead): >= 0.53 face-on
                                                         # to the 52 degree game camera at every facing (a tilt near
                                                         # 38 deg would be edge-on from one side)


def _ult(skel, g, gI) -> anim.Clip:
    """CAST_ULT (45, f18) Amber Hour (brief section 8): f0-f4 he heaves the whole yoke up over the cap in both hands;
    f4-f6 it swings to his right side and becomes a WHEEL whirled over his head like a sling, its plane tilted 68
    degrees from vertical, rising in over the cap (the right arm raised along its axis, the fist turning the bar),
    the free arm out for balance: from the high game camera an ellipse at every facing, never a pole waving
    edge-on (the brief's vertical windmill was edge-on to the camera whenever he faced it). f6-f15 the wheel spins up (a circle and a
    quarter), the pots whipped round trailing the bar ends (rigid on their cords, never along the shaft); f15-f17 a
    full-body lean back, head up, the sling end cocked low behind, the free arm aiming high at the target; f17-f18
    the throw: the sling end snaps over the top to high in front, the body following through UP and forward (the
    head stays up after the lob: a high throw, not a smash), the aiming arm pulled down; f18-f30 the wheel turns on
    with the momentum, slowing, the pots settling; f30-f45 the yoke swings back behind the head onto the
    shoulders. In game the 0.35 s castTime lands on f18 (the clip plays 1.7x: the whole gesture in 0.88 s)."""
    N = 45
    W_WM = Vector((-0.40, -0.02, 1.80))                     # the arm raised along the wheel's axis (up, a little out):
    pole_wm = (-0.85, -0.3, 0.0)                            # fitted so the fist's twist sweeps the wheel's plane (13 deg)
    lean_t = P(hips=(2, -6, -1), spine=(2, -4, -4), chest=(2, -6, -5), head=(0, 8, 4))   # leans off the wheel
    wm = pose(g, lean_t, (0.03, 0.0, -0.03), {"ik": {"hand.R": HT(pos=tuple(W_WM), pole=pole_wm)}},
              feet_from(g, dr=(-0.05, 0.02, 0.0)))
    T = math.radians(ULT_TILT)

    def ax_at(ph_deg):
        ph = math.radians(ph_deg)                        # the long end: 0 back, 90 up (in over the cap), 180 front
        return Vector((math.sin(T) * math.sin(ph), math.cos(ph), math.cos(T) * math.sin(ph)))

    def dax_at(ph_deg):
        ph = math.radians(ph_deg)
        return Vector((math.sin(T) * math.cos(ph), -math.sin(ph), math.cos(T) * math.cos(ph)))

    def axis_for(base, psi):
        p = dict(base)
        p["hand.R"] = (0.0, psi, 0.0)
        p.pop("_rigid", None)
        r = _resolve0(skel, p)
        return skel.fk(r)["prop.R"].to_3x3().col[1].normalized()

    want = Vector((0.0, 1.0, 0.0))
    best = min(range(-180, 180, 2), key=lambda a: -axis_for(wm, a).dot(want))
    psi0 = min((best + d * 0.25 for d in range(-8, 9)), key=lambda a: -axis_for(wm, a).dot(want))
    a30 = axis_for(wm, psi0 + 30.0)
    sgn = 1.0 if a30.dot(ax_at(30.0)) > a30.dot(ax_at(-30.0)) else -1.0   # + phi: back -> up -> front -> down
    dev = max(axis_for(wm, psi0 + sgn * a).angle(ax_at(a)) for a in range(0, 360, 30))
    scene.log(f"odrum ult wheel: psi0 {psi0:.1f}, sign {sgn:+.0f}, off-plane {math.degrees(dev):.0f} deg (the aim trues it)")

    def phi_at(f):
        """the long end's angle; the sling end is opposite (phi + 180)"""
        if f <= 6:
            return 0.0
        if f <= 15:
            u = (f - 6) / 9
            return 450.0 * (0.45 * u + 0.55 * u * u)          # spinning up: a circle and a quarter
        if f <= 17:
            return 450.0 + 45.0 * anim.ease_out((f - 15) / 2)   # the lean back cocks the sling end low behind
        if f <= 18:
            return 495.0 + 180.0 * anim.accel(f - 17)          # the throw: the sling end over the top, high in front
        if f <= 30:
            return 675.0 + 405.0 * anim.ease_out((f - 18) / 12)  # momentum: on round, slowing, to rest at 1080
        return 1080.0

    arm_bal = (0.42, -0.24, 1.12)                            # the free arm out and forward, elbow bent
    arm_aim = (0.26, -0.40, 1.66)                            # ... up at the target (the thrower's aiming arm)
    arm_pull = (0.30, -0.02, 1.06)                           # ... pulled down to the hip at the throw
    torso = {  # frame: (torso delta, hips offset, right wrist, left wrist)
        6: (lean_t, (0.03, 0.0, -0.03), W_WM, arm_bal),
        13: (P(hips=(1, -8, -1), spine=(-1, -6, -3), chest=(-3, -8, -4), head=(-2, 9, 3)), (0.03, 0.02, -0.05),
             W_WM + Vector((0.0, 0.02, 0.01)), arm_aim),
        17: (P(hips=(-9, -14, -1), spine=(-14, -10, -3), chest=(-20, -12, -4), neck=(-4, 0, 0), head=(-10, 12, 3)),
             (0.04, 0.12, -0.04), W_WM + Vector((0.02, 0.14, -0.02)), (0.30, -0.40, 1.66)),
        18: (P(hips=(7, 12, -1), spine=(6, 10, -2), chest=(7, 12, -2), neck=(-3, 0, 0), head=(-12, -10, 2)), (0.02, -0.14, -0.05),
             W_WM + Vector((0.04, -0.18, 0.10)), arm_pull),
        24: (P(hips=(8, 14, -1), spine=(6, 10, -1), chest=(6, 12, -1), head=(-8, -10, 0)), (0.02, -0.12, -0.06),
             W_WM + Vector((0.05, -0.14, 0.02)), (0.26, -0.20, 1.05)),
        30: (P(hips=(3, -2, -1), spine=(2, -2, -2), chest=(2, -3, -2), head=(-2, 3, 2)), (0.02, -0.02, -0.03),
             W_WM + Vector((0.02, 0.0, -0.02)), (0.40, -0.10, 1.10)),
    }
    tk = sorted(torso)
    eases = {13: anim.sine, 17: anim.ease_out, 18: anim.accel, 24: anim.ease_out, 30: anim.sine}
    feet_wm = feet_from(g, dr=(-0.05, 0.02, 0.0))
    feet_throw = feet_from(g, dl=(0.0, -0.20, 0.0), dr=(-0.05, 0.04, 0.0))
    pole_l = (0.5, 0.3, -0.8)

    def wheel(f):
        i = max(0, min(len(tk) - 2, next((j for j in range(len(tk) - 1) if f <= tk[j + 1]), len(tk) - 2)))
        f0, f1 = tk[i], tk[i + 1]
        u = eases[f1](max(0.0, min(1.0, (f - f0) / (f1 - f0))))
        (ta, ha, wa, la), (tb, hb, wb, lb) = torso[f0], torso[f1]
        tor = anim.lerp_pose(ta, tb, u)
        hp = tuple(ha[k] + (hb[k] - ha[k]) * u for k in range(3))
        wr = wa.lerp(wb, u)
        lw = tuple(la[k] + (lb[k] - la[k]) * u for k in range(3))
        ft = feet_throw if f >= 17.5 else feet_wm
        ph = phi_at(f)
        p = pose(g, tor, hp, {"ik": {"hand.R": HT(pos=tuple(wr), pole=pole_wm), "hand.L": HT(pos=lw, pole=pole_l),
                                     "aim.R": Aim(tuple(ax_at(ph)))}}, ft)
        p["hand.R"] = (0.0, psi0 + sgn * ph, 0.0)            # the fist turns the bar; the aim trues it to the plane
        p["prop.R"] = (0.0, 180.0, 0.0)                       # the pouch on the wheel's outer side
        tr = max(0.0, min(1.0, (f - 5.0) / 3.0)) * (1.0 - max(0.0, min(1.0, (f - 27.0) / 3.0)))
        p["_trail"] = (tr, 0.0, 0.0)
        p["_tdir"] = tuple(dax_at(ph))
        return p

    # up overhead in both hands, then off to the side; back onto the shoulders at the end: IK holds, plumb pots
    lift = pose(g, P(spine=(-3, 0, 0), chest=(-4, 0, 0), neck=(-4, 0, 0), head=(-8, 0, 0)), (0.0, 0.0, 0.02),
                hold(Vector((-0.33, 0.26, 1.88)), Vector((1.0, 0.0, 0.0)), 0.62, pole_r=(-0.9, 0.2, 0.0),
                     pole_l=(0.9, 0.2, 0.0)))                # up and BACK: the bar clears the cap's brim on the way
    at_wm = wheel(6.0)
    at_wm["ik"] = dict(at_wm["ik"], **{"aim.R": Aim((0.0, 1.0, 0.0))})
    back_in = pose(g, P(chest=(-2, -4, 3)), (0.0, 0.0, -0.02), hold(*yoke_about(GRIP0, 40, 0, (-0.08, 0.05, 0.10))))
    end_wm = wheel(30.0)
    end_wm["hand.R"] = (0.0, psi0, 0.0)
    end_wm["ik"] = dict(end_wm["ik"], **{"aim.R": Aim((0.0, 1.0, 0.0))})
    back_off = pose(g, P(spine=(-1, 0, 0), chest=(-2, 0, 0)), (0.0, 0.0, 0.0),
                    hold(Vector((-0.34, 0.34, 1.60)), Vector((1.0, 0.0, 0.0)), 0.62, pole_r=(-0.9, 0.2, 0.0),
                         pole_l=(0.9, 0.2, 0.0)))
    on = anim.keyed([(0.0, gI, "linear"), (1.6 / N, back_off, "inout"), (4 / N, lift, "out"), (6 / N, at_wm, "inout")])
    off = anim.keyed([(30 / N, end_wm, "linear"), (36 / N, back_in, "inout"), (42 / N, gI, "inout"), (1.0, gI, "linear")])

    def sample(t):
        f = t * N
        if f < 6:
            p = on(t)
            p["_trail"] = (max(0.0, min(1.0, (f - 5.0) / 3.0)), 0.0, 0.0)
            p["_tdir"] = tuple(dax_at(0.0))
            return p
        if f <= 30:
            return wheel(f)
        return off(t)

    return anim.Clip("cast_ult", N, False, anim.drag(sample, N, {"head": 1.0, "neck": 0.7}), impact=anim.IMPACT)


def _others(skel, g, gI, rest_ik, hip_h) -> dict:
    out = {}
    osc = anim.osc

    # DEATH (50): a recoil; he drops to both knees as the yoke swings off his right shoulder (the long part round
    # behind his head) and up at his side; it comes down in front of him and he sets it down level, its two pots
    # standing on the ground (the ends at rest); then he folds forward over his knees, the head dropping, the free
    # arm hanging limp to the ground: still.
    def bar(F, long_dir, rigid=0.0):
        return hold(Vector(F), Vector(long_dir).normalized(), pole_r=(-0.7, 0.3, -0.6), rigid=rigid)

    knees = feet_from(g, dl=(0.02, 0.36, 0.10), dr=(-0.02, 0.36, 0.10), pl=-56, pr=-56)
    recoil_b = pose(g, P(hips=(-4, 6, 0), spine=(-8, 4, 0), chest=(-12, 6, 0), neck=(-4, 0, 0), head=(-8, 8, 0),
                        upper_arm_L=(30, 0, 10), forearm_L=(40, 0, 0)), (0.0, 0.05, 0.0))
    recoil = pose(recoil_b, {}, (0.0, 0.0, 0.0), ride(skel, recoil_b, *yoke_about(PIV, 0, 4, (0.0, 0.03, 0.02))))
    off = pose(g, P(hips=(10, 4, 0), spine=(6, 0, 0), chest=(4, -4, 0), head=(12, 4, 0), upper_arm_L=(10, 0, 0)),
               (0.0, 0.08, -hip_h * 0.22), bar((-0.40, 0.08, 1.30), (0.0, 1.0, 0.05)),
               feet_from(g, dl=(0.02, 0.18, 0.03), dr=(-0.02, 0.20, 0.04), pl=-26, pr=-30))
    up = pose(g, P(hips=(14, 4, 0), spine=(8, 0, 0), chest=(6, -4, 0), head=(14, 0, 0), upper_arm_L=(14, 0, 0),
                   forearm_L=(20, 0, 0)), (0.0, 0.11, -hip_h * 0.36), bar((-0.45, -0.09, 1.05), (0.05, 0.42, 0.90)), knees)
    # tipped forward-left (its long end away from his face) as it comes down in front
    tilt = pose(g, P(hips=(18, 2, 0), spine=(10, 0, 0), chest=(8, -2, 0), head=(12, 0, 0), upper_arm_L=(16, 0, 2),
                     forearm_L=(20, 0, 0)), (0.0, 0.12, -hip_h * 0.36), bar((-0.30, -0.42, 0.86), (0.55, -0.35, 0.76)), knees)
    # lowered in front, level along his shoulders' line, then set down: the bar's axis 0.428 m up (pots on the ground)
    lower = pose(g, P(hips=(22, 2, 0), spine=(14, 0, 0), chest=(10, 0, 0), neck=(6, 0, 0), head=(10, 0, 0),
                      upper_arm_L=(20, 0, 4), forearm_L=(20, 0, 0)), (0.0, 0.14, -hip_h * 0.355),
                 bar((-0.14, -0.44, 0.60), (1.0, 0.0, 0.0)), knees)
    sett = pose(g, P(hips=(26, 2, 0), spine=(16, 0, 0), chest=(12, 0, 0), neck=(8, 0, 0), head=(12, 0, 0),
                     upper_arm_L=(24, 0, 4), forearm_L=(16, 0, 0)), (0.0, 0.16, -hip_h * 0.355),
                bar((-0.13, -0.44, 0.462), (1.0, 0.0, 0.0)), knees)
    # the collapse: the hips sink back toward the heels, the back folds over the knees, the head hangs, the free
    # arm drops limp beside the knee, the right hand slack on the bar
    slump = pose(g, P(hips=(30, 4, -2), spine=(18, 0, -8), chest=(14, 2, -7), neck=(12, 0, -4), head=(18, -6, -12),
                      upper_arm_L=(8, 0, -2), forearm_L=(6, 0, 0), hand_L=(10, 0, 0)), (0.0, 0.18, -hip_h * 0.36),
                 bar((-0.13, -0.44, 0.462), (1.0, 0.0, 0.0)), knees)
    bounce = with_hips(anim.add(slump, P(spine=(-3, 0, 0), chest=(-2, 0, 0), head=(-4, 0, 0))), (0, 0, 0.012))
    rest = with_hips(anim.add(slump, P(head=(5, -3, 0), spine=(2, 0, 0))), (0, 0, -0.006))
    out["death"] = anim.Clip("death", 50, False, anim.keyed([
        (0.0, gI, "linear"), (0.12, recoil, "snap"), (0.26, off, "inout"), (0.40, up, "inout"), (0.47, tilt, "inout"),
        (0.55, lower, "inout"),
        (0.64, sett, "in"), (0.76, slump, "in"), (0.84, bounce, "out"), (0.92, rest, "inout"), (1.0, rest, "linear")]))

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
    hand_keys = [(0, None), (12, None), (20, (0.545, 0.08, 1.24)), (23, (0.51, 0.06, 1.27)), (26, (0.545, 0.08, 1.24)),
                 (30, (0.51, 0.06, 1.27)), (40, (0.63, 0.05, 1.46)), (46, (0.64, 0.05, 1.43)), (52, (0.62, 0.04, 1.47)),
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

    # VICTORY (60, hold): a dip, then the flourish: he heaves the yoke up over his head in both hands (one pot
    # swinging into the light) and bounces it down onto his shoulders; two knuckles of the free hand go to the cap's
    # brim and tip it with a nod; then the free fist goes to his hip, elbow out. Hold (the splash): the fist on the
    # bar, the other on the hip, the left foot forward, the head (and the cap) tipped: a clean, confident shape (an
    # arm hooked over the bar read as a broken stump at the splash angle: the cuff's hollow, a mitten hand).
    def rp(body, yoke, *extra):                      # the yoke riding the chest of `body`
        return pose(body, {}, (0.0, 0.0, 0.0), ride(skel, body, *yoke), *extra)
    foot_fwd = feet_from(g, dl=(0.03, -0.15, 0.0))
    crouch = rp(pose(g, P(hips=(4, 0, 0), spine=(2, 0, 0), chest=(1, 0, 0), head=(2, 0, 0), upper_arm_L=(-8, 0, 0)), (0, 0, -0.07)),
                yoke_about(PIV, 0, 0), {"ik": {"hand.L": rest_ik["L"]}})
    heave = pose(g, P(hips=(-2, 0, 0), spine=(-2, 0, 0), chest=(-2, 0, 0), head=(4, 0, 0)), (0.0, 0.0, 0.0),
                 hold(Vector((-0.34, 0.30, 1.64)), Vector((1.0, 0.0, 0.0)), 0.62, pole_r=(-0.9, 0.3, -0.2), pole_l=(0.9, 0.3, -0.2)))
    overhead = pose(g, P(hips=(-3, 0, 0), spine=(-4, 0, 0), chest=(-5, 0, 0), neck=(-3, 0, 0), head=(2, 0, 0)), (0.0, 0.0, 0.035),
                    hold(Vector((-0.33, 0.26, 1.88)), Vector((1.0, 0.0, 0.0)), 0.62, pole_r=(-0.9, 0.2, 0.0), pole_l=(0.9, 0.2, 0.0)))
    overhead2 = pose(g, P(hips=(-3, 4, 0), spine=(-4, 3, 0), chest=(-6, 4, 0), neck=(-3, 0, 0), head=(2, -4, 0)), (0.0, 0.0, 0.04),
                     hold(Vector((-0.31, 0.25, 1.91)), Vector((1.0, 0.0, 0.08)), 0.62, pole_r=(-0.9, 0.2, 0.0), pole_l=(0.9, 0.2, 0.0)))
    down = pose(g, P(hips=(1, 2, 0), spine=(0, 1, 0), chest=(-1, 2, 0), head=(6, 0, 0)), (0.0, 0.0, 0.0),
                hold(Vector((-0.34, 0.28, 1.62)), Vector((1.0, 0.0, 0.04)), 0.62, pole_r=(-0.9, 0.3, -0.2), pole_l=(0.9, 0.3, -0.2)))
    catch = rp(pose(g, P(hips=(3, -2, 0), spine=(3, -2, 0), chest=(2, -3, 0), head=(2, 4, 0)), (0, 0, -0.045)),
               yoke_about(PIV, 0, 3, (0.0, 0.01, 0.0)), lhand(0.40, -0.06, 1.30, pole=(0.9, 0.3, -0.3)))
    settle = rp(pose(g, P(hips=(-1, 4, 0), spine=(-2, 3, 0), chest=(-3, 4, 0), head=(0, -2, 0)), (0, 0, -0.01), foot_fwd),
                yoke_about(PIV, 0, 0, (0.0, 0.015, 0.005)), lhand(0.30, -0.12, 1.22, pole=(0.9, 0.3, -0.3)))
    tip = rp(pose(g, P(hips=(-1, 6, 0), spine=(-2, 4, 0), chest=(-3, 5, 0), neck=(4, -2, 4), head=(10, -6, 9)), (0, 0, -0.01), foot_fwd),
             yoke_about(PIV, 0, 0, (0.0, 0.015, 0.005)), lhand(0.10, -0.25, 1.62, pole=(0.9, 0.0, -0.4)))
    tipped = rp(pose(g, P(hips=(-1, 6, 0), spine=(-2, 4, 0), chest=(-3, 5, 0), neck=(5, -2, 5), head=(13, -6, 11)), (0, 0, -0.012), foot_fwd),
                yoke_about(PIV, 0, 0, (0.0, 0.015, 0.005)), lhand(0.14, -0.24, 1.58, pole=(0.9, 0.0, -0.4)))
    hooked = rp(pose(g, P(hips=(-2, 9, 0), spine=(-4, 5, 0), chest=(-5, 6, 0), neck=(4, -3, 4), head=(9, -6, 7), hand_L=(-10, 0, 25)),
                     (0, 0, -0.005), foot_fwd),
                yoke_about(PIV, 0, 0, (0.0, 0.015, 0.005)), lhand(0.235, 0.02, 1.035, pole=(1.0, 0.55, 0.15)))
    vic = anim.keyed([(0.0, gI, "linear"), (0.10, crouch, "inout"), (0.14, heave, "linear"), (0.21, overhead, "back"),
                      (0.30, overhead2, "inout"), (0.36, down, "in"), (0.41, catch, "linear"), (0.48, settle, "out"), (0.58, tip, "inout"), (0.66, tipped, "out"),
                      (0.78, hooked, "inout"), (1.0, hooked, "linear")])

    def vic_s(t):
        p = vic(t)
        if t > 0.8:
            k = min(1.0, (t - 0.8) / 0.1)
            p = anim.add(p, P(chest=(0.8 * k * osc(t, 2), 0, 0), head=(0.5 * k * osc(t, 2, 0.2), 0, 0)))
        return p
    out["victory"] = anim.Clip("victory", 60, False, anim.drag(vic_s, 60, {"head": 2.0, "neck": 1.0}))

    # DASH (15): Step and Load (Odrum's only dash, castTime 0: the sim plays `dash`, fitted to the 0.25 s hop, never
    # cast_a3, so THIS carries the ability's read). A crouch (f2); in the air the yoke tips up to 40 degrees on the
    # shoulders (the sling end low at his right) while the free hand crosses the body to the belt at the right hip
    # (f5: thumbing a pellet); it lifts the pellet high in front of the mask (f9: shown) and presses it toward the
    # sling as he lands (f12), held with the bar still tipped: the loaded read, big enough to see from above.
    gIL = anim.merge(gI, {"ik": {"hand.L": rest_ik["L"]}})
    d_dip = rp(pose(g, P(hips=(8, 0, 0), spine=(6, 0, 0), chest=(4, 0, 0), head=(-4, 0, 0)), (0, -0.01, -0.08)),
               yoke_about(PIV, 0, 14, (0, 0.03, 0)), {"ik": {"hand.L": rest_ik["L"]}})
    d_air = rp(pose(g, P(hips=(10, -8, 0), spine=(6, -6, 0), chest=(4, -8, 0), head=(-6, 10, 0)), (0, -0.03, 0.11),
                    feet_from(g, dl=(0.0, 0.10, 0.26), dr=(0.0, 0.14, 0.30), pl=-26, pr=-30)),
               yoke_about(PIV, 4, 34, (0, 0.05, 0.02)), lhand(-0.10, -0.15, 1.00, pole=(0.9, 0.3, -0.4)))
    d_show = rp(pose(g, P(hips=(6, -4, 0), spine=(3, -3, 0), chest=(1, -4, 0), head=(-8, 4, 0)), (0, -0.03, 0.07),
                     feet_from(g, dl=(0.0, 0.05, 0.12), dr=(0.0, 0.08, 0.15), pl=-14, pr=-16)),
                yoke_about(PIV, 6, 40, (0, 0.06, 0.01)), lhand(0.02, -0.36, 1.50, pole=(0.9, 0.2, -0.5)))
    d_land = rp(pose(g, P(hips=(10, 6, 0), spine=(6, 4, 0), chest=(4, 6, 0), head=(-6, -6, 0)), (0, -0.02, -0.10),
                     feet_from(g, dl=(0.0, -0.04, 0.0))),
                yoke_about(PIV, 6, 40, (0, 0.06, 0)), lhand(-0.20, -0.34, 1.30, pole=(0.9, 0.2, -0.5)))
    d_hold = rp(pose(g, P(hips=(8, 6, 0), spine=(5, 4, 0), chest=(3, 6, 0), head=(-5, -6, 0)), (0, -0.02, -0.085),
                     feet_from(g, dl=(0.0, -0.04, 0.0))),
                yoke_about(PIV, 6, 39, (0, 0.06, 0)), lhand(-0.21, -0.33, 1.32, pole=(0.9, 0.2, -0.5)))
    out["dash"] = anim.Clip("dash", 15, False, anim.keyed([(0.0, gIL, "linear"), (2 / 15, d_dip, "out"), (5 / 15, d_air, "out"),
                                                            (9 / 15, d_show, "inout"), (12 / 15, d_land, "in"),
                                                            (1.0, d_hold, "out")]))

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

    # CHANNEL (40, loop): both forearms hooked over the yoke (the free arm too), the head up, a slow sway: the
    # waiting stance, two arms over the bar, never the idle's hanging arm
    ch = rp(pose(g, P(spine=(-2, 0, 0), chest=(-3, 0, 0), head=(-5, 0, 0), hand_L=(30, 0, 0)), (0, 0, 0)),
            yoke_about(PIV, 0, 0, (0.0, 0.015, 0.005)), lhand(0.45, -0.06, 1.47, pole=(0.3, 0.5, 0.8)))
    out["channel"] = anim.Clip("channel", 40, True, lambda t: anim.add(ch, P(chest=(1.5 * osc(t, 2), 0, 0), spine=(0, 0, 1.2 * osc(t, 1)),
                                                                             head=(-1 * osc(t, 2), 2.0 * osc(t, 1, 0.2), 0))))
    return out


if __name__ == "__main__":
    fighter.main(sys.modules[__name__])
