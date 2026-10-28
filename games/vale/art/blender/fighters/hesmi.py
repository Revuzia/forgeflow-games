"""hesmi: Shard bearer (Plinth, Hourless). ART 2.0: sculpted volumes painted by concept projection.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/hesmi_plates.py --height 2.3 --erase-saturated-above 1.8
    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/hesmi_fit.py          # silhouette fit on the 10 cm grid
    python3 art/build.py fighter hesmi --no-skins [--fast] [--clip-sheet]

Brief: _design/fighters/hesmi.md. Concept: _design/concept/hesmi.webp (front + back, hand-painted).
The forms are numpy SDF volumes (common/hifi/sdf.py) fitted to the concept on a 10 cm grid; the base
colour is the concept painting itself, projected occlusion-aware onto the game mesh (common/hifi/project.py,
the pipeline's PROJECTION hook); normals and AO bake from the sculpt.

Where the concept and the brief disagree the concept's FORMS win (it is the approved look, as on Marund) for the
body, the hood and the wraps; the brief's hook wins at the top: three honed shards cut LEVEL at 2.30 m (the highest
mesh, art.height), each cut bevelled all round with the brief's accent inlay SET INTO it (a pocket, a dark ink ring,
no lid), pale honed upper sections and dark weathered lower bodies (the middle shard honed all the way down) bound by
a carved brace at 1.65 m. The concept's shard "eyes" (gems) are not built (brief: no gems). Fix pass 3 (10-20): the
rack is PAINTED in the concept's manner from its own stone (paint_stone), not projected (the pointed painted shards
left ghosts on the level-cut slabs). The pipeline hooks this module wraps for its own build (common/ is shared):
part binding (auto_only), the projection paint (rack paint, mask-aware fills, box-mapped slabs, repainted up-facing
tops), the skin re-colour (value-kept chroma swap with a hue push, Shadeprint's painted arris rims), a matte leather
and the portrait framing.
"""
from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy  # noqa: E402,F401
import numpy as np  # noqa: E402

from common import anim, fighter, materials, rig  # noqa: E402
from common.hifi import sdf  # noqa: E402
from common.hifi.sdf import (Capsule, Ellipsoid, FlatCapsule, HalfSpace, RoundBox, RoundCone,  # noqa: E402
                             Sculpt, Sphere, Torus, Tube)

ID = "hesmi"
TITLE = "Shard bearer"
ROLE_MASS = "plinth"
ORIGIN = "hourless"
CARD = {"primary": "#5C5A63", "secondary": "#8C8478"}

# rig fitted to the sculpt: the head's crown inside the hood 2.22 m (hood crown 2.30), skull base 1.96,
# shoulder joints x 0.42 at 1.60 (under the mantle), elbows ~(0.47, 1.29), wrists ~(0.51, 1.02), fists
# ~(0.51, 0.97); hips x 0.17 at 0.95, knees 0.52, ankles x 0.23 at 0.12 (big boots, toes out)
PROPORTIONS = rig.proportions(height=2.22, head=0.30, neck=0.06, shoulder_width=0.84, hip_width=0.34, leg=0.832,
                              thigh_frac=0.53, arm=0.59, upper_arm_frac=0.53, hand=0.20, foot=0.40,
                              ankle_height=0.12, spine_curve=0.0, stance=0.06, toe_out_deg=13.0, knee_bend=0.012,
                              a_pose_deg=81.0, arm_forward_deg=3.0, elbow_bend_deg=10.0, shoulder_drop=0.30)
MATERIAL_SET = "bible"
PALETTE = materials.bible_palette(cloth2="#CEC8BB", stone="#D3CEC3", cloth="#A39E95", ironstone="#4C4A53",
                                  gauntlet="#8A867D", leather="#4A4036", under="#34323A", ink="#17181B",
                                  accent="#3F9CFF", slate="#A39E95", rope="#9A8F7A")
# `gauntlet` (the brief's honed-dialstone fists), `slate` (the grey sash and hip wraps, the mid-band wraps a skin
# re-colours apart from the shoulder wraps; = cloth in the base) and `rope` (Gorgewalk's bindings) are roles the
# bible set lacks: extra_materials() makes them
VALUE_GRADIENT_STOPS = materials.BIBLE_GRADIENT_STOPS
# weapon "none": the stone-gauntleted fists are the weapon (anim.FISTS guard, anim._punch hooks)
# cadence 1.2: 20-frame cycle (the long legs' contact stays inside their reach, so the planted foot never
# over-stretches off the ground)
MOTION = anim.motion_profile(weight="heavy", weapon="none", stance="guard", run_ref_speed=3.35, cadence=1.2)
# the fists' guard (weapon "none"): the concept's stance and the brief's 64 px read ("two big fists at the hips"):
# arms hang a little forward with soft elbows, the gauntlets upright slabs at her sides; jab = the hook's contact
ULT_SHRUG = 17.0          # Felled Shard: the shoulders lift under the raised gauntlets (deg; 24 stretched the mantle)
RUN_LEAN = (8.0, 2.0, -7.0, 5.0, 1.0)   # run: hips, spine, chest, neck, head pitch added to the generator's run
# death's rest (PRONE: hips, spine, chest pitch, the thighs' world flexion, the knee bend, hips height) and the recall's
# upright kneel (fix pass 4: the knelt folds tore the hips; prone and upright have no deep hip fold)
DEATH_POSE = (84.0, 3.0, 2.0, -84.0, -14.0, 0.30)
DEATH_HAND = (0.10, -0.66, 0.42)          # death's rest: the forearms flat on the ground before the knees (chest frame)
RECALL_POSE = (6.0, 3.0, 4.0, 8.0, -98.0, 0.555)
DEATH_FOOT = -65.0
RACK_TILT_MAX = 2.8                       # brief: the rack within 3 degrees of level in idle, run, the a3 clack, stunned
PLANT = (46.0, 0.44, -1.30)               # Plant Shard's stab: torso lean (deg), hips drop, the driven fists' y
XREL, XSH = (0.78, -0.58, 0.34), -12.0     # Stand Firm's crossed guard: the right wrist (rel), the shoulders' draw
RECALL_FIST_Y = -0.34                     # recall: the fists on the thighs, this far before the hips' rest place
# fix pass 3: the brief's guard (§8): both fists up at chest height before her, forearms near vertical, elbows out
# (the hanging A-pose fists read as a mannequin, not a braced tank)
FISTS = {"guard": ((0.06, -0.50, -0.46), (-0.95, 0.10, -0.45)), "jab": ((0.22, -0.95, -0.12), (-0.85, 0.25, -0.45))}
# W5b (combat m-2): the basic attacks' striking fist (rel: chest frame, arm lengths; pole: the elbow) at the wound-back,
# the contact and the follow-through. attack1 (right hook): drawn back past the right hip-shoulder, then across at
# shoulder height. attack2 (left uppercut-hook): low behind the left hip, then up to chin height in front.
ATK1_WIND = ((-0.66, 0.42, -0.12), (-0.55, 0.65, 0.25))
ATK1_HIT = ((0.30, -0.97, 0.20), (-0.9, 0.05, 0.45))
ATK1_FOL = ((0.62, -0.70, 0.12), (-0.9, 0.2, 0.4))
ATK2_WIND = ((0.52, 0.34, -0.72), (0.85, 0.45, -0.35))
ATK2_HIT = ((-0.16, -0.95, -0.02), (0.75, 0.1, -0.65))
ATK2_FOL = ((-0.36, -0.74, 0.22), (0.75, 0.15, -0.6))
SOCKETS = {"weapon": "prop.R", "shard_mid": "x_shard_mid", "fist_r": "x_fist_r", "fist_l": "x_fist_l",
           "rack_top": "x_rack_top"}
# the crossed-arms hold, a front three-quarter from the character's left, the hero camera at hip height: the flat
# rack's three level cuts stand against the sky above the hood's flat crown, the eye-band under it (brief §10); the
# portrait frames the hood with BOTH flanking shards (PORTRAIT_FILL widens the shared head-box framing, _install_render)
# fix pass 4 (the camera sat level with the rack: the cut tops and their inlays never showed, the middle shard hid
# behind the hood crown): the cuts are now world-level, the victory hold leans the chest ~17 degrees into a wide stance
# (chin raised), so the three cut tops tip toward a camera a little above her left shoulder (pitch 7, yaw 22) and read
# against the sky above the hood, the eye-band under it (brief §10); the portrait uses the same hold; rims cooler-
# neutral (the cool rim graded the warm linen lilac-pink)
SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92, "yaw": 22.0, "pitch": 5.5, "x": 0.70, "fill": 0.84,
          "sun": 2.2, "ambient": 0.32, "rim_cool": 0.75, "rim_warm": 0.9,
          "portrait_clip": "victory", "portrait_t": 0.92, "portrait_yaw": 18.0, "icon_yaw": 14.0}
PORTRAIT_FILL = 0.74      # the shared portrait camera fits the head box at 0.92; lower = wider (the rack beside the hood)
PORTRAIT_PITCH = 9.0     # (the shared portrait / icon cameras sit at 6 / 3 degrees: under the level cut tops)
ICON_PITCH = 9.0
TEXTURE_SIZE = 2048      # the painted base colour; normal + ORM smaller (CONTRACT §12 Materials)
TEXTURE_SIZES = {"normal": 512, "orm": 512}
GLB_COMPRESS = True
ARMOUR_CONFORM = False
AO_INTO_BASE = 0.25       # the projected painting already carries its painted occlusion; only deepen creases
# ART 2.0 skins re-colour the projected painting part by part (each part's painted texels take the skin role /
# base role gain per channel; pipeline -> project.recolour), plus skin-only extras painted flat (SKIN_FLAT part ->
# role). Palettes: _design/fighters/hesmi.md section 9.
SKINS: list = [
    # fix pass 3 (the two skins read as the same cool-grey figure at game scale): each skin owns a HUE family the base
    # lacks (base: warm linen and tan; Gorgewalk: blue slate; Shadeprint: violet ink and lilac), pushed by `chroma`
    # (a saturation gain on the re-coloured parts, every large area still far under the bible's 40 %), and a rack of
    # its own (Gorgewalk: slate bodies under the pale cut band, four ochre rope coils, iron pins; Shadeprint: ink
    # shards to the cut, every arris and bevel light-rimmed). Each splash is a FRONT three-quarter hero pose in its
    # own scene (render._splash_cfg reads skin["splash"]).
    {"id": "hesmi_gorgewalk", "extra": {"rope_binding": True, "iron_pins": True},
     "card": {"primary": "#4A4F55", "secondary": "#9A8F7A"},
     # (the mantle, the biggest area the game camera sees, takes the lighter slate shoulder wrap: pale-hood /
     # blue-slate-mantle / slate-wraps reads apart from the base's all-linen top at game scale)
     "roles": {"torso": ("leather", "slate"), "tunic": ("slate", "slate"), "mantle": ("cloth", "cloth")},
     "dark_below": 2.00, "chroma": 1.6,
     # (fix pass 4: the Felled Shard heave, leaning in, so the level cut tops and inlays face a low hero camera)
     "splash": {"map": "map_fray", "clip": "cast_ult", "t": 0.46, "yaw": 28.0, "pitch": 5.0, "x": 0.70, "fill": 0.84,
                "sun": 2.4, "ambient": 0.32, "rim_cool": 0.9, "rim_warm": 0.7, "portrait_yaw": 30.0, "icon_yaw": 28.0},
     "palette": {"cloth2": "#B9C3CD", "stone": "#D0D3D5", "cloth": "#97A3B0", "ironstone": "#56606E",
                 "gauntlet": "#9096A0", "slate": "#6E747C", "rope": "#9A8F7A"}},
    {"id": "hesmi_shadeprint", "extra": {"light_rims": True},
     "card": {"primary": "#2B2A33", "secondary": "#B7B4BE"},
     "dark_below": 2.17, "chroma": 1.7,
     "splash": {"map": "map_bridge", "clip": "victory", "t": 0.92, "yaw": -20.0, "pitch": 6.0, "x": 0.70, "fill": 0.84,
                "sun": 2.4, "ambient": 0.30, "rim_cool": 0.8, "rim_warm": 1.2, "portrait_yaw": -18.0, "icon_yaw": -16.0},
     "palette": {"cloth2": "#BCB3CB", "stone": "#D6D3DB", "cloth": "#ADA7BE", "ironstone": "#2B2A33",
                 "gauntlet": "#6F6D79", "leather": "#3A3942", "under": "#34333C"}},
]
SKIN_FLAT = {"rope_coils": "rope", "iron_pins": "ironstone"}

HEIGHT = 2.30             # the plates' scale: the concept's hood peak (the model's flat crown sits at ~2.26)
# flat paint: the shard eyes are carved, non-emissive sockets (brief: the cut-top inlays are the ONLY emissive
# pixels; the six emissive eyes read as white googly dots under the own-champion Noonwhite tint), the eye slit ink
PROJECTION = {"concept": "hesmi", "height": HEIGHT, "flat": {"eyeslit": "#121317"}}
NOISE = sdf.Noise(11)
VOXEL = 0.007

# ── the rack: shard outlines measured on the concept's back view (world x, z; m) ──────────────────────
# Fix pass 3 (the cut tops read as tin cans: a full blue lid over a dark collar on a pill-shaped body): each honed
# shard is a crisp chisel-faceted slab cut LEVEL at TOP_Z, its flat cut bevelled all round (CUT_CH, brief 2-4 cm),
# the accent inlay SET INTO the cut (a pocket; the inlay's face INLAY_DROP under the cut, framed by the pale bevel
# and a dark ink ring LIP wide: the own-champion Noonwhite inlay still separates from the pale stone); no collar,
# no eyes (the concept's gems are not in the brief), the lower shards taper to a chisel point in profile.
TILT = 8.0                # the rack leans back: tops 0.14 m further back per metre of height
SHARD_T = 0.11            # the weathered lower shards' thickness (brief 0.09; the concept's slabs read heavier)
SHARD_T_UP = 0.18         # the honed upper sections at the cut: a 17 cm deep cut top holds the brief's ~12 cm inlay
RIDGE = 0.18              # each face falls 1:RIDGE from the centre ridge to the long edges (the chisel facets; fix pass 4:
                          # 0.13 -> 0.18, a crystal's hexagonal cut instead of a plank's rectangle)
TOP_Z = 2.30              # the three honed shards are cut FULL WIDTH at one height, the highest mesh (art.height)
POLY_TOP = TOP_Z + 0.04   # (the outlines run past the cut: fix pass 4 cuts WORLD-LEVEL planes through the leaning slabs)
BAND_Z = 2.00             # fix pass 4 (brief §4): the honed cut band is the top 0.30 m; the needle-stone below is weathered
                          # dark ironstone on all three shards (the pale band ran the whole upper section: pale posts)
CUT_CH = 0.020            # the cut's bevel all round the flat top (brief: bevels 2-4 cm, no point)
LIP = 0.012               # the dark ring (the pocket's floor) between the bevel and the inlay
POCKET = 0.010            # the pocket's depth under the cut
INLAY_DROP = 0.003        # the inlay's face this far under the cut (set in, never a lid)
UPPER = ("shard_up_L", "shard_up_R", "shard_mid")
ROPE_Z = (1.835, 1.875, 1.915, 1.955)      # Gorgewalk's rope coils (brief §9: below the cut band)
SHARDS = {
    # name: (polygon (x, z), y of the slab's mid-plane at z 1.6, thickness at the cut, role)
    "shard_up_L": ([(0.15, 1.69), (0.36, 1.69), (0.41, 1.97), (0.405, POLY_TOP), (0.168, POLY_TOP)], 0.385, SHARD_T_UP, "stone"),
    "shard_up_R": ([(-0.17, 1.69), (-0.385, 1.69), (-0.425, 2.00), (-0.42, POLY_TOP), (-0.205, POLY_TOP)], 0.385, SHARD_T_UP, "stone"),
    "shard_mid": ([(0.085, 1.70), (0.09, 2.00), (0.088, POLY_TOP), (-0.135, POLY_TOP), (-0.16, 2.05), (-0.145, 1.68),
                   (-0.075, 1.30), (-0.024, 1.19), (0.035, 1.30)], 0.325, SHARD_T_UP, "stone"),
    "shard_lo_L": ([(0.035, 1.70), (0.03, 1.06), (0.085, 1.00), (0.29, 1.30), (0.335, 1.70)], 0.37, SHARD_T, "ironstone"),
    "shard_lo_R": ([(-0.065, 1.70), (-0.06, 1.06), (-0.12, 1.00), (-0.34, 1.20), (-0.375, 1.70)], 0.37, SHARD_T, "ironstone"),
}
# thickness along each slab (z, t): the honed cuts deepen to SHARD_T_UP above the hood line, the lower ends thin to a
# chisel point in profile (they ended in a rounded pill / 'J' seen from the side)
TAPER = {
    "shard_up_L": [(1.69, 0.13), (1.98, SHARD_T_UP)],
    "shard_up_R": [(1.69, 0.13), (1.98, SHARD_T_UP)],
    "shard_mid": [(1.19, 0.04), (1.45, 0.11), (1.72, 0.125), (1.98, SHARD_T_UP)],
    "shard_lo_L": [(1.00, 0.035), (1.42, SHARD_T)],
    "shard_lo_R": [(1.00, 0.035), (1.42, SHARD_T)],
}
# the PAINTED shards on the concept's back view (world x, z; pointed tips): only the masks that keep the rack's paint
# off the parts behind it (concept_rack_mask); the rack itself is painted from its own honed / weathered stone
CONCEPT_SHARDS = {
    "shard_up_L": [(0.15, 1.69), (0.37, 1.69), (0.40, 1.97), (0.37, 2.07), (0.30, 2.20), (0.25, 2.16), (0.18, 2.10),
                   (0.165, 2.0)],
    "shard_up_R": [(-0.17, 1.69), (-0.385, 1.69), (-0.415, 2.00), (-0.40, 2.08), (-0.35, 2.16), (-0.29, 2.12),
                   (-0.23, 2.08), (-0.20, 2.0)],
    "shard_mid": [(0.085, 1.70), (0.095, 2.00), (0.085, 2.09), (-0.03, 2.23), (-0.10, 2.12), (-0.155, 2.05),
                  (-0.145, 1.68), (-0.075, 1.30), (-0.024, 1.19), (0.035, 1.30)],
    "shard_lo_L": SHARDS["shard_lo_L"][0],
    "shard_lo_R": SHARDS["shard_lo_R"][0],
}
BRACE_BAND = (1.60, 1.725)   # the painted brace across the back (excluded from every part's back paint but the brace)
# heat-weight binds limited to the bones a part may follow (ART 2.0 wrap of the pipeline's 'auto': see
# _install_bind): the skirt never takes a fist's weights, the mantle never an arm's
LEG_BIND = ("auto_only", "hips", "spine", "thigh.L", "thigh.R", "shin.L", "shin.R", "foot.L", "foot.R")
TORSO_BIND = ("auto_only", "hips", "spine", "chest", "neck", "shoulder.L", "shoulder.R", "upper_arm.L", "upper_arm.R",
              "forearm.L", "forearm.R")
MANTLE_BIND = ("auto_only", "spine", "chest", "neck", "shoulder.L", "shoulder.R")


def _interval(poly, z):
    """the (x min, x max) of a convex outline at heights z (array); NaN where z misses it"""
    p = np.asarray(poly, dtype=np.float64)
    z = np.atleast_1d(np.asarray(z, dtype=np.float64))
    lo = np.full(z.shape, np.inf)
    hi = np.full(z.shape, -np.inf)
    for (x0, z0), (x1, z1) in zip(p, np.roll(p, -1, axis=0)):
        if z0 == z1:
            continue
        t = (z - z0) / (z1 - z0)
        ok = (t >= 0) & (t <= 1)
        x = x0 + (x1 - x0) * np.clip(t, 0, 1)
        lo = np.where(ok, np.minimum(lo, x), lo)
        hi = np.where(ok, np.maximum(hi, x), hi)
    bad = ~np.isfinite(lo)
    lo[bad] = np.nan
    hi[bad] = np.nan
    return lo, hi


def _ccw(poly):
    p = np.asarray(poly, dtype=np.float64)
    a = 0.5 * np.sum(p[:, 0] * np.roll(p[:, 1], -1) - np.roll(p[:, 0], -1) * p[:, 1])
    return p if a > 0 else p[::-1]


def shard_t(name, z):
    """a shard's thickness at heights z (world, ~ the slab's v + 1.6)"""
    zs, ts = zip(*TAPER[name])
    return np.interp(z, zs, ts)


class Slab(sdf.Prim):
    """A chiselled crystal slab: a convex outline (u, v) extruded along w with a centre ridge (both faces
    slope 1:`ridge` toward the long edges) and soft bevels (`bevel`: smooth-max radius). `frame` rows are the
    world directions of u (across), w (thickness) and v (along the slab); `c` the origin of (u, v, w). `t` is the
    thickness: a number, None (the outline prism only) or [(v, t), ...] (a taper along v)."""

    def __init__(self, c, frame, poly, t, bevel=0.02, ridge=0.22):
        self.c = np.asarray(c, dtype=np.float64)
        self.ax = np.asarray(frame, dtype=np.float64)
        self.poly = _ccw(poly)
        if t is None or np.isscalar(t):
            self.t, self.tv = (None if t is None else float(t)), None
        else:
            vs, ts = zip(*t)
            self.tv = (np.asarray(vs, dtype=np.float64), np.asarray(ts, dtype=np.float64))
            self.t = float(max(ts))
        self.k, self.ridge = float(bevel), float(ridge)
        e = np.roll(self.poly, -1, axis=0) - self.poly
        n = np.stack([e[:, 1], -e[:, 0]], axis=1)
        self.n = n / np.linalg.norm(n, axis=1, keepdims=True)
        self.o = np.sum(self.n * self.poly, axis=1)
        self.uc = float(self.poly[:, 0].mean())

    def bounds(self):
        lo, hi = self.poly.min(0), self.poly.max(0)
        t = 0.3 if self.t is None else self.t
        pts = np.array([[u, w, v] for u in (lo[0], hi[0]) for v in (lo[1], hi[1]) for w in (-t, t)])
        W = pts @ self.ax + self.c
        return W.min(0), W.max(0)

    def d(self, P):
        q = (P - self.c) @ self.ax.T                 # (u, w, v)
        uv = q[:, [0, 2]]
        d2 = None
        for n, o in zip(self.n, self.o):
            di = uv @ n - o
            d2 = di if d2 is None else sdf.smax(d2, di, self.k)
        if self.t is None:
            return d2
        th = self.t if self.tv is None else np.interp(q[:, 2], self.tv[0], self.tv[1])
        dt = (np.abs(q[:, 1]) + self.ridge * np.abs(q[:, 0] - self.uc) - 0.5 * th) / math.sqrt(1 + self.ridge ** 2)
        return sdf.smax(d2, dt, self.k)


class Cyl(sdf.Prim):
    """A distance-like field in cylindrical coordinates round a vertical axis through (cx, cy): fn(r, a, z), a in
    degrees round the face (0 = straight ahead, -Y). The carved eye-band and its two eye openings (fix pass 4)."""

    def __init__(self, cx, cy, fn, rmax, z0, z1):
        self.cx, self.cy, self.fn = float(cx), float(cy), fn
        self.rmax, self.z0, self.z1 = float(rmax), float(z0), float(z1)

    def bounds(self):
        return (np.array([self.cx - self.rmax, self.cy - self.rmax, self.z0]),
                np.array([self.cx + self.rmax, self.cy + self.rmax, self.z1]))

    def d(self, P):
        x, y = P[:, 0] - self.cx, P[:, 1] - self.cy
        return self.fn(np.hypot(x, y), np.degrees(np.arctan2(x, -y)), P[:, 2])


# the eye-band (brief §3; fix pass 4): the band's lower edge dips in a shallow V at the centre (the facing keel, flush
# with the band: the proud white wedge read as a beak) and the slit is TWO shaped eye openings meeting at a carved
# bridge, the inner corners lower (the concept's stern eyes), instead of one straight slot
BAND_C = (0.0, 0.005)
EYE_Z, EYE_H, EYE_A = 2.113, 0.0125, (5.0, 37.0)     # the openings' centre height, half-height, angle span (deg)


def band_fn(r, a, z, ro=0.246, ri=0.17, zt=2.168, zb0=2.078, b=0.022):
    zb = zb0 - 0.016 * np.clip(1.0 - np.abs(a) / 17.0, 0.0, 1.0)
    box = np.maximum(np.maximum(r - ro, ri - r), np.maximum(z - zt, zb - z))
    cham = np.maximum((r - ro) + (z - zt) + b, (r - ro) + (zb - z) + b) / math.sqrt(2.0)
    return np.maximum(box, cham)


def eye_fn(r, a, z, depth=0.236):
    s = (np.abs(a) - EYE_A[0]) / (EYE_A[1] - EYE_A[0])
    inside = (s > 0) & (s < 1)
    h = np.where(inside, EYE_H * np.sin(np.pi * np.clip(s, 0, 1)) ** 0.55, -0.01)
    zc = EYE_Z - 0.006 * np.clip(1.0 - s, 0, 1) + 0.002
    return np.maximum(np.abs(z - zc) - h, depth - r)


def rack_frame():
    a = math.radians(TILT)
    return np.array([[1.0, 0.0, 0.0], [0.0, math.cos(a), -math.sin(a)], [0.0, math.sin(a), math.cos(a)]])


def shard_slab(name, bevel=None):
    poly, y0, t, _ = SHARDS[name]
    F = rack_frame()
    # local v = z - 1.6 (the frame's v axis is tilted, the outline is measured in world z: cos 8 deg ~ 0.99)
    c = np.array([0.0, y0, 1.6])
    loc = [(u, v - 1.6) for u, v in poly]
    tap = [(z - 1.6, tt) for z, tt in TAPER[name]]
    bv = (0.020 if name in UPPER else 0.018) if bevel is None else bevel
    return Slab(c, F, loc, tap, bevel=bv, ridge=RIDGE), c, F, t


def top_span(name):
    """the (u0, u1) of an upper shard's outline at the cut and the slab's ridge centre"""
    poly = SHARDS[name][0]
    lo, hi = _interval(poly, TOP_Z - 1e-4)
    return float(lo[0]), float(hi[0]), float(np.mean(_ccw(poly)[:, 0]))


def level_pt(name, u, w, z):
    """the world point at slab coordinates (u, w) whose height is z (the slab leans back TILT degrees)"""
    _, c, F, _t = shard_slab(name)
    a = math.radians(TILT)
    v = (z - 1.6 + math.sin(a) * w) / math.cos(a)
    return c + F[0] * u + F[1] * w + F[2] * v


def cut_volume(name, inset, z0, z1, bevel=0.004):
    """the cut's cross-section inset by `inset` (m) from the slab's sides and faces, between the WORLD heights z0
    and z1 (fix pass 4: the cut is level in the world, not square to the leaning slab)"""
    _, c, F, _t = shard_slab(name)
    u0, u1, _uc = top_span(name)
    th = float(shard_t(name, TOP_Z))
    rect = [(u0 + inset, z0 - 1.66), (u1 - inset, z0 - 1.66), (u1 - inset, z1 - 1.54), (u0 + inset, z1 - 1.54)]
    # (the ridge centre stays the shard's own: Slab.uc of the rectangle equals it only when centred, so pass the
    # thickness that keeps an equal inset from the faces at the shard's ridge)
    sl = Slab(c, F, rect, th - 2.0 * inset, bevel=bevel, ridge=RIDGE)
    sl.uc = _uc
    return sdf.Blend([("add", sl, 0.0), ("inter", HalfSpace((0, 0, z1), (0, 0, 1), 1.0), bevel),
                      ("inter", HalfSpace((0, 0, z0), (0, 0, -1), 1.0), bevel)])


def cut_planes(name):
    """the level cut (world horizontal: the brief's flat, level cuts; square to the leaning slab they faced 8 degrees
    away from every front camera) and its four ~45 degree bevels (half-spaces, inside = below)"""
    _, c, F, _t = shard_slab(name)
    u0, u1, uc = top_span(name)
    th = float(shard_t(name, TOP_Z))
    Z = np.array([0.0, 0.0, 1.0])
    top = level_pt(name, 0.0, 0.0, TOP_Z)
    s2 = 1.0 / math.sqrt(2.0)
    wb = 0.5 * th - CUT_CH
    nb = F[1] + Z
    nf = -F[1] + Z
    return [HalfSpace(top, Z, 0.5),
            HalfSpace(top + F[0] * (u1 - CUT_CH), (Z + F[0]) * s2, 0.5),
            HalfSpace(top + F[0] * (u0 + CUT_CH), (Z - F[0]) * s2, 0.5),
            HalfSpace(level_pt(name, uc, wb, TOP_Z), nb / np.linalg.norm(nb), 0.5),
            HalfSpace(level_pt(name, uc, -wb, TOP_Z), nf / np.linalg.norm(nf), 0.5)]


def slab_face(name, x, z, side):
    """world point on a shard's face (side +1 = back, -1 = front, 0 = mid-plane) near (x, z) and the face normal"""
    _, c, F, _t = shard_slab(name)
    u, v = x, z - 1.6
    uc = float(_ccw(SHARDS[name][0])[:, 0].mean())
    w = side * (0.5 * float(shard_t(name, z)) - RIDGE * abs(u - uc))
    p = c + F[0] * u + F[1] * w + F[2] * v
    return p, F[1] * side


def folds(amp, freq, axis=0, phase=0.0, zfade=None, dirv=None):
    def fn(P):
        s = P @ np.asarray(dirv, dtype=np.float64) if dirv is not None else P[:, axis]
        u = s * freq + phase + 0.6 * NOISE(P, 3.0)
        a = amp
        if zfade is not None:
            z0, z1 = zfade
            a = amp * np.clip((z0 - P[:, 2]) / (z0 - z1), 0.15, 1.0)
        return a * (np.abs(np.sin(u)) * 2.0 - 1.0) * -0.5
    return fn


def crown_folds(amp, n, c, z_top, z_fade=0.16):
    """folds radiating down from a crown: n soft creases round the vertical axis through c (x, y), fading out
    toward the crown (z_top) so the flat crown stays clean, strongest at the sides and back"""
    def fn(P):
        a = np.arctan2(P[:, 1] - c[1], P[:, 0] - c[0])
        u = a * n + 0.9 * NOISE(P, 4.0)
        w = np.clip((z_top - P[:, 2]) / z_fade, 0.0, 1.0) * np.clip((P[:, 1] + 0.12) / 0.15, 0.25, 1.0)
        return amp * w * (np.abs(np.sin(u)) * 2.0 - 1.0) * -0.5
    return fn


def front_only(fn, y0=0.05, floor=0.3):
    """fade a displacement toward the back (+Y): the hip wrap's diagonal folds read as rings under the rack"""
    def out(P):
        return fn(P) * np.clip((y0 - P[:, 1]) / 0.25 + floor, floor, 1.0)
    return out


def chips(amp, freq):
    def fn(P):
        return amp * np.clip(NOISE.ridged(P, freq, 3), 0, 1) - amp * 0.3
    return fn


def wraps(amp, freq, axis=2):
    """horizontal wrap ridges (bandages, face wrap): a soft saw along `axis`"""
    def fn(P):
        u = P[:, axis] * freq + 0.8 * NOISE(P, 6.0)
        return -amp * (0.5 + 0.5 * np.sin(u)) ** 2 + amp * 0.4
    return fn


def sculpts() -> list:
    """(name, Sculpt, voxel scale, material role, bind, tris) in build order."""
    out = []

    def part(name, S, role, bind, tris, vs=1.0):
        out.append((name, S, vs, role, bind, tris))

    # HOOD (rigid on the head): a deep peaked cowl, the face opening carved into its front
    hood = Sculpt("hood")
    # soft cloth folds falling from the crown round the cowl (fix pass 2: at game zoom the plain dome read as a
    # smooth steel helmet with one hot highlight), plus the fine diagonal weave of the painting
    hood.add(Ellipsoid((0, 0.02, 2.035), (0.245, 0.235, 0.235)).displaced(
        lambda P: folds(0.004, 11.0, dirv=(0.6, 0.0, 0.8))(P) + crown_folds(0.009, 7.0, (0.0, 0.03), 2.26)(P), 0.013), k=0.0)
    hood.add(RoundCone((0, 0.03, 2.10), (0, 0.05, 2.235), 0.17, 0.065), k=0.07)
    # the brow lip round the face opening: a thin flat hem blended into the cowl (a round 3 cm tube read as a
    # rolled ring / 'ear' in profile and a donut from above)
    hood.add(Torus((0, -0.19, 2.035), 0.165, 0.014, axes=np.diag([1.0, 1.0 / 1.18, 1.0]) @ sdf.frame((0, -1, 0)), rz=0.02),
             k=0.07)
    for sx in (-1, 1):                      # the gothic-arch sides of the cowl (front view: +-0.24 at 1.98, +-0.13 at 2.25)
        hood.inter(HalfSpace((sx * 0.25, 0, 1.98), (sx * 0.934, 0, 0.358), 1.0), k=0.05)
    hood.inter(HalfSpace((0, 0, 2.262), (0, 0, 1), 1.0), k=0.04)           # a flat crown (brief §1): the rack stands above
    hood.sub(Ellipsoid((0, -0.215, 2.04), (0.150, 0.165, 0.178)), k=0.02)
    part("hood", hood, "cloth2", "bone:head", 1550)

    # FACE: the carved honed eye-band (brief §3: 0.20 x 0.06 m face, 3 cm bevels, an ink slit, a forward keel), set
    # proud of the face opening so the 52 degree camera sees it under the hood's brow; the slit is a real slot with
    # an ink plate at its back; the layered face wrap under it (all rigid on the head)
    band = Sculpt("eyeband")
    band.add(Cyl(BAND_C[0], BAND_C[1], band_fn, 0.26, 2.04, 2.18), k=0.0)
    band.inter(HalfSpace((0, -0.12, 2.1), (0, 1, 0), 0.5), k=0.03)          # the band's ends round off into the cowl
    band.inter(Ellipsoid((0, -0.215, 2.04), (0.158, 0.20, 0.19)), k=0.012)  # ...and stay inside the face opening (the
                                                                             # ends poked through the cowl's sides)
    # the two eye openings, 1 cm deep: their ink floor (eyeslit) 6 mm under the face
    band.sub(Cyl(BAND_C[0], BAND_C[1], eye_fn, 0.27, 2.08, 2.14), k=0.002)
    for x, z, a in ((-0.07, 2.150, 20), (0.05, 2.145, -30), (0.10, 2.092, 15)):     # chisel cracks across the stone
        band.sub(RoundBox((x, -0.25, z), (0.0025, 0.02, 0.016), 0.001, axes=sdf.rot_y(a)), k=0.002)
    # fix pass 3: the concept's band is carved in BLOCKS: four joints cut across it (painted dark too, hesmi_paint)
    for a in BAND_JOINTS:
        r = math.radians(a)
        tang = (math.cos(r), math.sin(r), 0.0)
        cj = (0.252 * math.sin(r), 0.005 - 0.252 * math.cos(r), 2.123)
        band.sub(RoundBox(cj, (0.0028, 0.014, 0.06), 0.001, axes=sdf.frame((0, 0, 1), tang)), k=0.0015)
    part("eyeband", band, "stone", "bone:head", 520, 0.55)
    slit = Sculpt("eyeslit")
    slit.add(sdf.Blend([("add", sdf.Lathe((0, 0.005, 0), lambda r, z: np.maximum(np.maximum(0.226 - r, r - 0.240),
                                                                              np.abs(z - 2.111) - 0.0155), 0.25, 2.09, 2.13), 0.0),
                        ("inter", HalfSpace((0, -0.10, 2.1), (0, 1, 0), 0.5), 0.0),
                        ("inter", Sphere((0, -0.2, 2.112), 0.165), 0.0)]), k=0.0)
    part("eyeslit", slit, "ink", "bone:head", 60, 0.6)
    wrap = Sculpt("facewrap")
    wrap.add(Ellipsoid((0, -0.085, 1.99), (0.150, 0.130, 0.105)).displaced(wraps(0.006, 85.0), 0.006), k=0.0)
    wrap.add(Capsule((0, -0.02, 1.86), (0, -0.04, 1.97), 0.13), k=0.05)
    wrap.inter(HalfSpace((0, 0, 2.082), (0, 0, 1), 0.6), k=0.01)
    part("facewrap", wrap, "cloth2", "bone:head", 650, 0.8)

    # MANTLE (heat weights): the rolled shawl round the hood base, over both shoulders, hanging in a U at the
    # front; the brown cape over the shoulders behind
    mant = Sculpt("mantle")
    mant.add(Torus((0, 0.0, 1.905), 0.25, 0.08, axes=sdf.rot_x(-10), rz=0.07), k=0.0)
    for sx in (-1, 1):
        mant.add(Ellipsoid((sx * 0.29, 0.03, 1.835), (0.205, 0.27, 0.085), axes=sdf.rot_y(sx * 16)), k=0.06)
    mant.add(Tube([(-0.43, -0.10, 1.785), (-0.25, -0.26, 1.715), (0.0, -0.31, 1.675), (0.25, -0.27, 1.71), (0.45, -0.10, 1.775)],
                  [0.055, 0.075, 0.082, 0.075, 0.055], k=0.03), k=0.03)
    mant.add(Tube([(-0.30, -0.16, 1.865), (-0.12, -0.27, 1.80), (0.12, -0.27, 1.80), (0.32, -0.15, 1.86)],
                  [0.05, 0.06, 0.06, 0.05], k=0.03), k=0.025)
    mant.add(Ellipsoid((0, 0.17, 1.82), (0.44, 0.17, 0.12)).displaced(folds(0.012, 14.0, axis=0), 0.012), k=0.06)
    part("mantle", mant, "cloth2", MANTLE_BIND, 1850)

    # PAULDRONS: layered rigid shoulder wraps (grey over purple), shoulder -> upper arm by distance
    for s, sx in (("R", -1), ("L", 1)):
        pd = Sculpt(f"pauldron_{s}")
        # (fix pass 4: softer chips; at 8 mm the thin rims decimated into a sawtooth poking out under the mantle hem)
        pd.add(Ellipsoid((sx * 0.43, 0.0, 1.70), (0.135, 0.23, 0.062), axes=sdf.rot_y(sx * 24)).displaced(chips(0.004, 5.0), 0.004), k=0.0)
        pd.add(Ellipsoid((sx * 0.485, 0.0, 1.615), (0.09, 0.205, 0.060), axes=sdf.rot_y(sx * 42)).displaced(chips(0.004, 5.0), 0.004), k=0.012)
        part(f"pauldron_{s}", pd, "cloth", ("dblend", f"shoulder.{s}", f"upper_arm.{s}", (sx * 0.40, 0.0, 1.68), (sx * 0.5, 0.0, -1.0), 0.0, 0.24), 440)

    # TORSO + SLEEVES (heat weights): the wrapped chest, barrel belly, beige puffed sleeves to the elbows
    torso = Sculpt("torso")
    torso.add(Ellipsoid((0, 0.0, 1.47), (0.315, 0.24, 0.30)).displaced(folds(0.010, 16.0, dirv=(0.7, 0.0, 0.7)), 0.010), k=0.0)
    torso.add(Ellipsoid((0, 0.0, 1.20), (0.295, 0.23, 0.22)), k=0.08)
    torso.add(Ellipsoid((0, 0.08, 1.60), (0.30, 0.20, 0.18)), k=0.08)
    torso.add(Capsule((0, 0.0, 1.70), (0, 0.01, 1.95), 0.12), k=0.04)
    for sx in (-1, 1):
        torso.add(FlatCapsule((sx * 0.42, 0.0, 1.60), (sx * 0.47, -0.01, 1.33), 0.14, 0.15, 0.115, 0.125, side=(1, 0, 0)), k=0.06)
        torso.add(Ellipsoid((sx * 0.475, -0.01, 1.44), (0.11, 0.14, 0.10)).displaced(folds(0.008, 22.0, axis=2), 0.008), k=0.04)
    part("torso", torso, "cloth", TORSO_BIND, 1750)

    # (the chest harness and its iron clasps stay the painting's: strap tubes that miss the painted straps by a
    # few cm pick up the pale chest paint as light ridges, so the X is paint on the torso's folds)

    # BELT, SASH (heat weights): the grey sash over the belt, the heavy belt with its buckle, the hip wrap
    belt = Sculpt("belt")
    belt.add(Torus((0, 0.0, 1.32), 0.285, 0.045, axes=np.diag([1.0, 0.285 / 0.235, 1.0]), rz=0.052), k=0.0)
    # the buckle and the strap end sit IN the belt's surface (one connected mesh: a floating island took its own
    # heat weights and hung off the belt when the torso twisted)
    belt.add(RoundBox((-0.205, -0.205, 1.31), (0.042, 0.018, 0.058), 0.01, axes=sdf.rot_z(38)), k=0.008)
    belt.add(RoundBox((0.15, -0.235, 1.29), (0.035, 0.014, 0.07), 0.008, axes=sdf.rot_z(-26)), k=0.008)
    part("belt", belt, "leather", ("auto_only", "hips", "spine", "chest"), 560)
    sash = Sculpt("sash")
    sash.add(Torus((0, 0.0, 1.405), 0.29, 0.035, axes=np.diag([1.0, 0.29 / 0.235, 1.0])), k=0.0)
    hw = FlatCapsule((0, 0.0, 1.03), (0, 0.0, 1.26), 0.355, 0.265, 0.31, 0.245, side=(1, 0, 0))
    sash.add(hw.displaced(front_only(folds(0.012, 18.0, dirv=(0.45, 0.0, 0.9))), 0.012), k=0.02)
    sash.inter(HalfSpace((0, 0, 1.025), (0, 0, -1), 1.0), k=0.01)
    part("sash", sash, "slate", ("auto_only", "hips", "spine", "chest"), 950)

    # TUNIC SKIRT (heat weights): the beige panels flaring to the hem at 0.76, the front panel to 0.73
    tun = Sculpt("tunic")
    sk = FlatCapsule((0, 0.01, 0.78), (0, 0.0, 1.10), 0.43, 0.32, 0.34, 0.26, side=(1, 0, 0))
    tun.add(sk.displaced(folds(0.014, 13.0, axis=0, phase=0.7, zfade=(1.05, 0.78)), 0.014), k=0.0)
    tun.inter(HalfSpace((0, 0, 0.765), (0, 0, -1), 1.0), k=0.008)
    # the front panel: a soft, thin relief under the painted tabard (a hard box creased the low mesh across the panel)
    tun.add(RoundBox((0.0, -0.292, 0.905), (0.14, 0.014, 0.17), 0.012, axes=sdf.rot_x(6)), k=0.04)
    part("tunic", tun, "cloth", ("auto_only", "hips", "spine", "thigh.L", "thigh.R"), 1400)

    # LEGS (heat weights): puffed trousers to the knees, wrapped shins
    legs = Sculpt("legs")
    legs.add(Ellipsoid((0, 0.0, 0.98), (0.30, 0.22, 0.14)), k=0.0)
    for sx in (-1, 1):
        legs.add(FlatCapsule((sx * 0.16, 0.0, 0.93), (sx * 0.225, -0.01, 0.55), 0.165, 0.16, 0.15, 0.145, side=(1, 0, 0)), k=0.05)
        # (fix pass 4: the concept's PUFFED trousers balloon over the knee plates)
        legs.add(Ellipsoid((sx * 0.215, -0.012, 0.675), (0.19, 0.175, 0.13)).displaced(folds(0.011, 20.0, axis=2), 0.011), k=0.05)
        legs.add(FlatCapsule((sx * 0.228, -0.01, 0.55), (sx * 0.235, 0.0, 0.17), 0.13, 0.125, 0.115, 0.11, side=(1, 0, 0)).displaced(
            wraps(0.006, 70.0), 0.006), k=0.04)
    part("legs", legs, "under", LEG_BIND, 1150)

    # SHIN GUARDS (rigid on the shins; fix pass 4, the concept's legs): a big chamfered KNEE PLATE (flat top, clipped
    # upper corners, a shallow V at the foot) over a tall SHIN PLATE, both chisel-faceted ironstone slabs on the
    # outer front of the shin (the two small square tiles read as stuck-on tiles)
    for s, sx in (("R", -1), ("L", 1)):
        sg = Sculpt(f"shinguard_{s}")
        kp = [(-0.104, 0.588), (-0.076, 0.618), (0.076, 0.618), (0.104, 0.588), (0.104, 0.440), (0.0, 0.420), (-0.104, 0.440)]
        sp = [(-0.084, 0.432), (0.084, 0.432), (0.080, 0.235), (0.056, 0.205), (-0.056, 0.205), (-0.080, 0.235)]
        for poly, xc, yc, t, tilt, ch in ((kp, 0.292, -0.166, 0.058, 8.0, 0.008), (sp, 0.280, -0.156, 0.048, 3.0, 0.006)):
            ta = math.radians(tilt)            # the top leans back (rows: u, w, v world directions, as rack_frame)
            Fr = np.array([[1.0, 0.0, 0.0], [0.0, math.cos(ta), -math.sin(ta)], [0.0, math.sin(ta), math.cos(ta)]])
            loc = [(u, z - 0.5) for u, z in poly]
            sg.add(Slab((sx * xc, yc, 0.5), Fr, loc, t, bevel=0.014, ridge=0.16).displaced(chips(ch, 7.0), ch), k=0.0)
        part(f"shinguard_{s}", sg, "ironstone", f"bone:shin.{s}", 380)
    # the shin's brown LEATHER STRAPS (rigid on the shins; the concept's back view): a broad band under the knee and a
    # band above the boot (the crossing straps between stay the trousers' painted X: the GLB budget); painted leather
    for s, sx in (("R", -1), ("L", 1)):
        st = Sculpt(f"straps_{s}")
        ax = np.diag([1.0, 0.118 / 0.128, 1.0])
        for z, R_, r_, rz_ in ((0.458, 0.130, 0.011, 0.034), (0.188, 0.128, 0.010, 0.026)):
            st.add(Torus((sx * 0.232, -0.004, z), R_, r_, axes=ax, rz=rz_), k=0.004)
        part(f"straps_{s}", st, "leather", f"bone:shin.{s}", 190, 0.8)

    # BOOTS (heat weights; fix pass 4, the concept's chunky boots): a crisp upper on a thick sole, a faceted TOE CAP
    # standing proud of the upper (a hard crease at its back edge), a heel block, toes out 13 degrees (the soft rounded
    # block read as a slipper)
    boots = Sculpt("boots")
    Zv = np.array([0.0, 0.0, 1.0])
    for sx in (-1, 1):
        R = sdf.rot_z(sx * 13)
        c = np.array([sx * 0.258, -0.07, 0.088])
        fwd = -R[:, 1]
        nrm = fwd * 0.6 + Zv
        up_ = sdf.Blend([("add", RoundBox(c, (0.126, 0.205, 0.086), 0.024, axes=R.T).displaced(chips(0.004, 8.0), 0.004), 0.0),
                         ("inter", HalfSpace(c + fwd * 0.07 + np.array([0, 0, 0.07]), nrm / np.linalg.norm(nrm), 0.5), 0.02)])
        boots.add(up_, k=0.0)
        boots.add(RoundBox(c + np.array([0, 0, -0.066]), (0.137, 0.219, 0.024), 0.009, axes=R.T), k=0.004)       # sole
        nc = fwd * 0.95 + Zv
        cap = sdf.Blend([("add", RoundBox(c + fwd * 0.128 + np.array([0, 0, -0.014]), (0.133, 0.092, 0.07), 0.02,
                                          axes=R.T).displaced(chips(0.006, 7.0), 0.006), 0.0),
                         ("inter", HalfSpace(c + fwd * 0.15 + np.array([0, 0, 0.03]), nc / np.linalg.norm(nc), 0.5), 0.012)])
        boots.add(cap, k=0.003)
        boots.add(RoundBox(c - fwd * 0.16 + np.array([0, 0, -0.035]), (0.124, 0.055, 0.05), 0.014, axes=R.T), k=0.006)
        boots.add(FlatCapsule((sx * 0.235, 0.01, 0.09), (sx * 0.235, 0.01, 0.23), 0.135, 0.13, 0.125, 0.12, side=(1, 0, 0)), k=0.04)
    boots.inter(HalfSpace((0, 0, 0.0), (0, 0, -1), 2.0), k=0.0)
    part("boots", boots, "leather", ("auto_only", "shin.L", "shin.R", "foot.L", "foot.R", "toe.L", "toe.R"), 950)

    # FOREARMS (heat weights): leather-wrapped forearms
    fa = Sculpt("forearms")
    for sx in (-1, 1):
        fa.add(FlatCapsule((sx * 0.48, -0.01, 1.33), (sx * 0.525, -0.04, 1.03), 0.09, 0.105, 0.085, 0.10, side=(1, 0, 0)).displaced(
            wraps(0.007, 60.0), 0.007), k=0.0)
    part("forearms", fa, "leather", ("auto_only", "upper_arm.L", "upper_arm.R", "forearm.L", "forearm.R", "hand.L", "hand.R"), 560)

    # GAUNTLETS (rigid on the forearms): the honed-dialstone slabs on the outer forearms, top cut on a slant
    for s, sx in (("R", -1), ("L", 1)):
        g = Sculpt(f"gauntlet_{s}")
        g.add(RoundBox((sx * 0.615, -0.03, 1.215), (0.085, 0.145, 0.235), 0.032).displaced(chips(0.012, 6.0), 0.012), k=0.0)
        g.inter(HalfSpace((sx * 0.615, 0, 1.445), (sx * -0.25, 0, 1.0), 1.0), k=0.012)
        g.inter(HalfSpace((sx * 0.615, -0.175, 1.0), (0, -0.7, -0.7), 1.0), k=0.012)
        part(f"gauntlet_{s}", g, "gauntlet", f"bone:forearm.{s}", 480)

    # FISTS (rigid on the hands): big leather-gloved fists, honed knuckle plates on the outer front
    for s, sx in (("R", -1), ("L", 1)):
        h = Sculpt(f"fist_{s}")
        c = np.array([sx * 0.515, -0.085, 0.965])      # the x1.7 fists sit forward of the slabs (they read from above)
        h.add(RoundBox(c, (0.108, 0.10, 0.10), 0.05), k=0.0)
        for i in range(4):
            h.add(Capsule(c + (sx * -0.065, -0.088, 0.055 - i * 0.037), c + (sx * 0.035, -0.088, 0.055 - i * 0.037), 0.026), k=0.018)
        h.add(Capsule(c + (sx * -0.095, -0.06, 0.06), c + (sx * -0.075, -0.09, -0.02), 0.032), k=0.02)
        part(f"fist_{s}", h, "leather", f"bone:hand.{s}", 380)
        kp = Sculpt(f"knuckle_{s}")
        kp.add(RoundBox(c + (sx * 0.095, -0.045, -0.015), (0.062, 0.085, 0.07), 0.025).displaced(chips(0.008, 8.0), 0.008), k=0.0)
        part(f"knuckle_{s}", kp, "gauntlet", f"bone:hand.{s}", 200)

    # THE RACK (rigid on the chest): five slab sections and the carved brace. The honed upper shards: crisp chisel
    # facets, a level cut with 45 degree bevels all round, a pocket in the cut that the accent inlay is set into
    F = rack_frame()
    for name in ("shard_up_L", "shard_up_R", "shard_mid", "shard_lo_L", "shard_lo_R"):
        sl, *_ = shard_slab(name)
        S = Sculpt(name)
        if name in UPPER:
            S.add(sl.displaced(chips(0.005, 6.0), 0.005), k=0.0)
            for hs in cut_planes(name):
                S.inter(hs, k=0.003)
            S.sub(cut_volume(name, CUT_CH, TOP_Z - POCKET, TOP_Z + 0.08), k=0.002)
        else:
            S.add(sl.displaced(chips(0.009, 5.0), 0.009), k=0.0)
        # (fix pass 4: fewer tris on the flat slabs; the leg armour, straps and toe caps cost ~1.7k and the GLB budget is
        # 1172 KiB)
        part(name, S, SHARDS[name][3], "bone:chest", (620 if name == "shard_mid" else 480) if name in UPPER else 400,
             0.75 if name in UPPER else 1.0)
    br = Sculpt("brace")
    bc = np.array([0.0, 0.37, 1.6]) + F[2] * 0.055 + F[1] * 0.075
    # (fix pass 3: the strap tubes that ran on over the shoulders read as a flap sticking out sideways in profile)
    br.add(RoundBox(bc, (0.43, 0.024, 0.048), 0.016, axes=F).displaced(chips(0.006, 9.0), 0.006), k=0.0)
    part("brace", br, "leather", "bone:chest", 380)
    # the brief's cut-top inlays: a flat accent plate set INTO each cut (Felled Shard's warning), framed by the pale
    # bevel and the dark pocket floor
    inlays = Sculpt("inlays")
    for name in UPPER:
        inlays.add(sdf.Blend([("add", cut_volume(name, CUT_CH + LIP, TOP_Z - POCKET - 0.006, TOP_Z - INLAY_DROP, 0.003), 0.0)]), k=0.0)
    part("inlays", inlays, "accent", "bone:chest", 120, 0.5)       # (built as clean plates: inlay_mesh)
    return out


def extra_materials(ctx) -> dict:
    """roles the bible set lacks: gauntlet (honed dialstone, darker than the cut bands), slate, rope"""
    pal = dict(materials.BIBLE_PALETTE, **PALETTE)
    pal.update(ctx.palette)
    # (fix pass 3: the bible's waxed leather at roughness 0.5 flared the boot toe tops white under the splash key)
    return {"leather": materials.waxed_leather("leather_matte", pal, "leather", ctx.gradient, rough=0.74),
            "gauntlet": materials.honed_stone("gauntlet", pal, "gauntlet", ctx.gradient, rough=0.64, chisel=0.9),
            "slate": materials.heavy_cloth("slate", pal, "slate", ctx.gradient),
            "rope": materials.heavy_cloth("rope", pal, "rope", ctx.gradient, weave=0.4)}


def skin_extras(extra: dict) -> list:
    """skin-only geometry (brief §9): Gorgewalk's gorge-rope bindings (three 3 cm coils round each honed shard just
    above the brace, never up into the cut band) and four iron pins through the brace. Shadeprint's light rims are
    painted, not built (hesmi_recolour; brief §9 "no extra geometry")."""
    out = []
    F = rack_frame()
    if extra.get("rope_binding"):
        # (fix pass 3: the three 3 cm coils were invisible at game scale) four 4 cm coils round each honed shard,
        # between the brace and the hood line (never up into the cut band)
        rope = Sculpt("rope_coils")
        for name in UPPER:
            sl, c, Fr, _t = shard_slab(name)
            for z in ROPE_Z:
                lo, hi = _interval(SHARDS[name][0], z)
                u0, u1 = float(lo[0]), float(hi[0])
                cc = c + Fr[0] * 0.5 * (u0 + u1) + Fr[2] * (z - 1.6)
                hu, ht = 0.5 * (u1 - u0), 0.5 * float(shard_t(name, z))
                ring = sdf.Blend([("add", RoundBox(cc, (hu + 0.016, ht + 0.012, 0.019), 0.019, axes=Fr), 0.0),
                                  ("sub", RoundBox(cc, (hu - 0.004, ht - 0.010, 0.05), 0.01, axes=Fr), 0.0)])
                rope.add(ring.displaced(lambda P: 0.003 * np.sin(np.arctan2(P[:, 1], P[:, 0]) * 40.0 + P[:, 2] * 90.0), 0.003), k=0.004)
        out.append(("rope_coils", rope, 0.6, "rope", "bone:chest", 900))
    if extra.get("iron_pins"):
        pins = Sculpt("iron_pins")
        bc = np.array([0.0, 0.37, 1.6]) + F[2] * 0.055 + F[1] * 0.075
        for x in (-0.33, -0.11, 0.11, 0.33):
            a = bc + F[0] * x
            pins.add(Capsule(a - F[1] * 0.03, a + F[1] * 0.045, 0.013), k=0.0)
            pins.add(Sphere(a + F[1] * 0.045, 0.021), k=0.006)
        out.append(("iron_pins", pins, 0.5, "ironstone", "bone:chest", 300))
    return out


def inlay_mesh():
    """the three cut-top inlays as clean flat-shaded hexagonal plates (the SDF plates, thin as they are, decimated
    into spikes that poked out over the bevel): the pocket's cross-section inset by LIP, INLAY_DROP under the cut"""
    V, Fc = [], []
    for name in UPPER:
        _, c, F, _t = shard_slab(name)
        u0, u1, uc = top_span(name)
        th = float(shard_t(name, TOP_Z))
        a, b = u0 + CUT_CH + LIP, u1 - CUT_CH - LIP
        hw = lambda u: 0.5 * th - CUT_CH - LIP - RIDGE * abs(u - uc)    # noqa: E731
        ring = [(a, -hw(a)), (uc, -hw(uc)), (b, -hw(b)), (b, hw(b)), (uc, hw(uc)), (a, hw(a))]
        base = len(V)
        for vz in (TOP_Z - INLAY_DROP, TOP_Z - POCKET - 0.004):
            for u, w in ring:
                V.append(level_pt(name, u, w, vz))
        for i in range(1, 5):                                    # top fan, bottom fan, the six sides
            Fc.append((base, base + i, base + i + 1))
            Fc.append((base + 6, base + 6 + i + 1, base + 6 + i))
        for i in range(6):
            j = (i + 1) % 6
            Fc.append((base + i, base + 6 + i, base + 6 + j))
            Fc.append((base + i, base + 6 + j, base + j))
    V = np.asarray(V)
    Fc = np.asarray(Fc, dtype=np.int64)
    ctr = V.reshape(len(UPPER), 12, 3).mean(1)
    for f in range(len(Fc)):                                     # outward winding
        pa, pb, pc = V[Fc[f]]
        nrm = np.cross(pb - pa, pc - pa)
        if nrm @ ((pa + pb + pc) / 3.0 - ctr[Fc[f][0] // 12]) < 0:
            Fc[f] = Fc[f][::-1]
    return V, Fc


def model(ctx) -> list:
    _SKIN.clear()
    _SKIN.update(ctx.skin or {})
    P = []
    extra = (ctx.skin or {}).get("extra") or {}
    for name, S, vs, role, bind, tris in sculpts() + skin_extras(extra):
        v, q = inlay_mesh() if name == "inlays" else S.mesh(VOXEL * vs)
        ob = sdf.to_object(f"{name}_high", v, q, ctx.col)
        if name == "inlays":
            ob.data.polygons.foreach_set("use_smooth", np.zeros(len(ob.data.polygons), dtype=bool))
        ob.data.materials.append(ctx.mats[role])
        P.append(fighter.Part(name, high=ob, tris=tris, bind=bind))
    return P


def rig_extras(ctx) -> None:
    """VFX sockets (brief §4): the middle shard's tip (Plant Shard / Felled Shard origin), the rack top, the
    fists (the Shoulder the Stone / Stand Firm clacks)"""
    top = [q for q in SHARDS["shard_mid"][0] if q[1] >= TOP_Z - 1e-6]      # the middle shard's level cut
    p = level_pt("shard_mid", 0.5 * (top[0][0] + top[-1][0]), 0.0, TOP_Z)
    rig.add_socket(ctx.info, "x_shard_mid", "chest", tuple(p), (0, 0, 0.1))
    rig.add_socket(ctx.info, "x_rack_top", "chest", (0.0, float(p[1]), TOP_Z), (0, 0, 0.1))
    for s, sx in (("r", -1), ("l", 1)):
        rig.add_socket(ctx.info, f"x_fist_{s}", f"hand.{s.upper()}", (sx * 0.515, -0.085, 0.965), (0, -0.1, 0))


# fix pass 4 (the hips tore in every deep crouch: the skirt's back took the thighs' heat weights, so a thigh flexed
# 90+ degrees dragged the seat panel down and forward round the buttocks into open, dark-lined tubes): the BACK of the
# tunic skirt (and the hip wrap's lower hem) hangs from the pelvis; the thighs' share fades out from the sides (y0) to
# the back (y1). part: (bones moved, onto, y0, y1, z top of the effect)
BACK_TO_HIPS = {"tunic": (("thigh.L", "thigh.R"), "hips", -0.14, 0.18, 9.0)}


def reweight_back(obj, src, dst, y0, y1, ztop):
    """move the `src` bones' weights onto `dst` by smoothstep(y0, y1, y) (rest pose, armature space, +Y = back)"""
    from mathutils import Vector  # noqa: F401
    gd = obj.vertex_groups.get(dst) or obj.vertex_groups.new(name=dst)
    gs = [obj.vertex_groups.get(n) for n in src]
    gs = [g for g in gs if g is not None]
    idx = {g.index for g in gs}
    mw = obj.matrix_world
    moved = 0
    for v in obj.data.vertices:
        co = mw @ v.co
        t = min(1.0, max(0.0, (co.y - y0) / (y1 - y0)))
        t = t * t * (3.0 - 2.0 * t)
        if t <= 1e-4 or co.z > ztop:
            continue
        acc = 0.0
        for g in v.groups:
            if g.group in idx and g.weight > 1e-5:
                dw = g.weight * t
                acc += dw
                obj.vertex_groups[g.group].add([v.index], g.weight - dw, "REPLACE")
        if acc > 0:
            cur = 0.0
            for g in v.groups:
                if g.group == gd.index:
                    cur = g.weight
            gd.add([v.index], cur + acc, "REPLACE")
            moved += 1
    print(f"[hesmi] reweight_back {obj.name}: {moved} vertices {'/'.join(src)} -> {dst}")


def _install_bind() -> None:
    """Wrap the pipeline's part binding (common/ is shared; this lives in the fighter module): a Part bind
    ("auto_only", bone, ...) is the pipeline's heat-weight bind (mesh.bind_auto) restricted to those bones."""
    from common import mesh, pipeline
    orig = pipeline.bind_part
    if getattr(orig, "_hesmi", False):
        return

    def bind_part(ctx, part, obj, body_low=None):
        b = part.bind
        if isinstance(b, tuple) and b and b[0] == "auto_only":
            arm = ctx.info.armature
            keep = set(b[1:])
            res = mesh.bind_auto(obj, arm, exclude=tuple(x.name for x in arm.data.bones if x.name not in keep))
            if part.name in BACK_TO_HIPS:
                reweight_back(obj, *BACK_TO_HIPS[part.name])
            return res
        return orig(ctx, part, obj, body_low)
    bind_part._hesmi = True
    pipeline.bind_part = bind_part


# ── projection paint: Hesmi's wrap of common/hifi/project.paint (common/ is shared, so it lives here) ────────
# Changes to the shared pass, installed by _install_paint() for this build only:
#  * THE RACK (fix pass 3) is painted in the concept's manner from its own stone, not projected: the concept's shards
#    are pointed with notches and eyes, the model's are level-cut slabs, and every projection (even warped) left ghost
#    tips, notches and hood paint on the slabs, and smeared silhouette pixels down their sides. Each slab's colours
#    (base / shadow / light) are measured from its painted shard; the paint is chisel-facet planes (3D Voronoi cells
#    in the slab's own frame: continuous over faces, sides and the cut, never stretched), the two ridge facets lit /
#    shaded, sparse crack strokes with a light lip, pale rims on every arris and bevel, the honed cut lighter, the
#    pocket round the inlay ink. The weathered lower shards keep the concept's painted faces (their outlines match
#    the painting) with the same painted sides and rims;
#  * every other part's BACK paint excludes the painted shards and brace (they are the rack's paint), so the tunic
#    and mantle under / beside the rack never carry crack strokes or a shard tip;
#  * part fills are built from each part's visible pixels ERODED off its borders with other parts (the 1-2 cm
#    misfit band where the concept's knee plate / belt / rack paint lies on the neighbouring part) and inside the
#    concept's cut: plate pixels outside the painted figure (the background bleed) are never paint (the belt ends and
#    heel cuffs faded into a grey haze);
#  * BOX-MAPPED slabs: the gauntlets', knuckle plates' and shin slabs' faces (front AND back: the back faces showed the
#    forearm wraps behind them through the stone) and their side faces and cut tops take their OWN front-plate paint;
#  * UP-FACING tops the 52 degree camera sees: the hood crown gets painted folds (crests and valleys round the crown,
#    brush mottling, the back seam) instead of a smooth satin gradient; the boot tops take the toe caps' painted
#    leather / ironstone (they were near-white);
#  * sideways texels sample their own part's paint SIDE_INSET inside the silhouette (no outline/rim streaks);
#  * occluded texels fill from their own part's paint by pull-push (smooth) instead of nearest-pixel streaks;
#  * the face (eye-band, slit, wrap) samples the painted face where the painting put it (FACE_SHIFT), the band
#    lifted to the concept's pale honed stone (the lightest thing in the hood) and cut into carved blocks (joints);
#  * a value ramp by height (VALUE_RAMP: the bible's light head / dark feet);
#  * the back plate is lifted a little (the concept's back is a lit tan; under the game's sun it read near-black).
BOX_PARTS = ("gauntlet_R", "gauntlet_L", "knuckle_R", "knuckle_L", "shinguard_R", "shinguard_L", "fist_R", "fist_L")
# (fix pass 4: the fists too: their inner sides sampled the tunic's panel edge through the fist in three-quarter view)
RACK = ("shard_up_L", "shard_up_R", "shard_mid", "shard_lo_L", "shard_lo_R")
SIDE_INSET = 0.045
BACK_GAMMA = 0.84
FACE_PARTS = ("eyeband", "facewrap")
# front-view paint OWNED by a part (x0, x1, z0, z1 on the concept): the painted knee pads and shin plates belong to the
# shin slabs only; the trousers / boots / tunic there fill from their own paint (the knee bend drops the rigid slabs a
# few cm down the thigh in every pose, and the painted pad then showed on the trousers above them)
FRONT_OWNED = (({"shinguard_R"}, -0.40, -0.17, 0.20, 0.645), ({"shinguard_L"}, 0.17, 0.40, 0.20, 0.645))
STRAP_PARTS = ("straps_R", "straps_L")   # painted leather (paint_strap), never projected
FACE_SHIFT = (0.95, -0.022)        # concept x = model x * a + b (the painted face sits 2 cm to her right)
BAND_LIFT = 0.15                   # the eye-band's paint pulled this far toward the stone role colour
BAND_JOINTS = (-40.0, -17.0, 17.0, 40.0)   # the carved band's block joints (deg round the face, 0 = the centre)
ERODE_PX = 3                       # fill erosion at the visibility grid (step 2: ~1 cm)
MASK_GROW_PX = 2                   # plate pixels this far outside the concept's cut are still the figure's paint
UPFACE = {"boots": 0.075}          # up-facing texels take the part's own front paint at this height (the toe caps)
CUT_INK = "#24252D"                # the pocket floor round each inlay
RIM_LIGHT = 0.80                   # the arris / bevel rims' pull toward the shard's light colour
VALUE_RAMP = ((0.0, 1.15), (0.30, 1.13), (0.62, 1.10), (0.95, 1.12), (1.60, 1.14), (2.0, 1.16), (2.30, 1.16))
# (fix pass 4: the feet band lifted again: the bigger ironstone knee / shin plates darkened it to 15-19)
# (lineup_qa, 4 facings: pass 2 top 56-63 / mid 34-45 / feet 14-16, pass 3 before this lift 57-64 / 36-46 / 14-18,
# against the bible's 70-85 / 45-65 / 20-35 and Marund's approved 57-61 / 38-43 / 16-20: every band lifts, the feet most)


def _pullpush(img: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """fill the invalid pixels of img (h, w, 3) smoothly from the valid ones (pull-push)"""
    C = [img * valid[..., None]]
    W = [valid.astype(np.float32)]
    while min(C[-1].shape[:2]) > 1:
        c, w = C[-1], W[-1]
        h, ww = c.shape[:2]
        c = np.pad(c, ((0, h % 2), (0, ww % 2), (0, 0)))
        w = np.pad(w, ((0, h % 2), (0, ww % 2)))
        c2 = c[0::2, 0::2] + c[1::2, 0::2] + c[0::2, 1::2] + c[1::2, 1::2]
        w2 = w[0::2, 0::2] + w[1::2, 0::2] + w[0::2, 1::2] + w[1::2, 1::2]
        wn = np.minimum(w2, 1.0)
        sc = np.where(w2 > 0, wn / np.maximum(w2, 1e-9), 0.0)
        C.append(c2 * sc[..., None])
        W.append(wn)
    R = C[-1] / np.maximum(W[-1], 1e-9)[..., None]
    for c, w in zip(C[-2::-1], W[-2::-1]):
        # (smoothed upsampling: a nearest-pixel repeat left stepped contour rings in large fills, the 'bullseye'
        # under the rack)
        up = _smooth3(_smooth3(np.repeat(np.repeat(R, 2, axis=0), 2, axis=1)[:c.shape[0], :c.shape[1]]))
        R = c + (1.0 - w)[..., None] * up
    return R.astype(np.float32)


def _smooth3(a: np.ndarray) -> np.ndarray:
    """1-2-1 binomial blur on both image axes (edge padded)"""
    p = np.pad(a, ((1, 1), (0, 0), (0, 0)), mode="edge")
    a = (p[:-2] + 2.0 * p[1:-1] + p[2:]) * 0.25
    p = np.pad(a, ((0, 0), (1, 1), (0, 0)), mode="edge")
    return (p[:, :-2] + 2.0 * p[:, 1:-1] + p[:, 2:]) * 0.25


def _dilate(m: np.ndarray, r: int) -> np.ndarray:
    """binary dilation by a (2r+1) square (numpy only: Blender's Python has no scipy)"""
    out = m.copy()
    for d in range(1, r + 1):
        out[d:] |= m[:-d]
        out[:-d] |= m[d:]
    m2 = out.copy()
    for d in range(1, r + 1):
        out[:, d:] |= m2[:, :-d]
        out[:, :-d] |= m2[:, d:]
    return out


def _erode(m: np.ndarray, r: int) -> np.ndarray:
    return ~_dilate(~m, r)


def _inside(poly, x, z, grow=0.0):
    """points (x, z) inside a convex outline grown by `grow` m (negative shrinks)"""
    p = _ccw(poly)
    ok = np.ones(np.shape(x), bool)
    for a, b in zip(p, np.roll(p, -1, axis=0)):
        e = b - a
        n = np.array([e[1], -e[0]]) / np.linalg.norm(e)            # outward normal of a CCW outline
        ok &= (np.asarray(x) - a[0]) * n[0] + (np.asarray(z) - a[1]) * n[1] <= grow
    return ok


def concept_rack_mask(x, z, grow=0.0):
    """the concept back view's painted shards and brace at world (x, z)"""
    m = (z >= BRACE_BAND[0] - grow) & (z <= BRACE_BAND[1] + grow) & (np.abs(x) <= 0.44 + grow)
    for poly in CONCEPT_SHARDS.values():
        m |= _inside(poly, x, z, grow)
    return m


def _ramp(z):
    zs, fs = zip(*VALUE_RAMP)
    return np.interp(z, zs, fs)


def _lum(c):
    return c[..., 0] * 0.2126 + c[..., 1] * 0.7152 + c[..., 2] * 0.0722


def _poly_edge_dist(uv: np.ndarray, poly) -> np.ndarray:
    pg = _ccw(poly)
    d = np.full(len(uv), 1e9)
    for a, b in zip(pg, np.roll(pg, -1, axis=0)):
        ab = b - a
        t = np.clip(((uv - a) @ ab) / max(1e-12, ab @ ab), 0, 1)
        d = np.minimum(d, np.linalg.norm(uv - (a + t[:, None] * ab), axis=1))
    return d


def _hash3(c: np.ndarray, seed: float) -> np.ndarray:
    h = np.sin(c[:, 0] * 127.1 + c[:, 1] * 311.7 + c[:, 2] * 74.7 + seed * 19.19) * 43758.5453
    return h - np.floor(h)


def _vor3(Q: np.ndarray, cell: float, seed: float):
    """jittered-grid Voronoi in 3D: (F1, F2 distances in m, the nearest cell's hash in 0..1)"""
    g = Q / cell
    i0 = np.floor(g)
    d1 = np.full(len(Q), 9.0)
    d2 = np.full(len(Q), 9.0)
    hid = np.zeros(len(Q))
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                c = i0 + np.array([dx, dy, dz], dtype=np.float64)
                p = c + 0.1 + 0.8 * np.stack([_hash3(c, seed), _hash3(c, seed + 1.3), _hash3(c, seed + 2.7)], 1)
                d = np.linalg.norm(g - p, axis=1)
                hh = _hash3(c, seed + 5.1)
                closer = d < d1
                d2 = np.where(closer, d1, np.minimum(d2, d))
                hid = np.where(closer, hh, hid)
                d1 = np.where(closer, d, d1)
    return d1 * cell, d2 * cell, hid


def _rack_stats(plates, img_back):
    """per shard: (base, shadow, light) sRGB colours measured from its painted shard on the concept's back view"""
    x0p, y0p = plates.to_px("back", 0.52, 2.36)
    x1p, y1p = plates.to_px("back", -0.52, 0.95)
    a, b = int(min(x0p, x1p)), int(max(x0p, x1p)) + 1
    c, d = int(y0p), int(y1p) + 1
    yy, xx = np.mgrid[c:d, a:b]
    X, Z = plates.to_world("back", xx + 0.5, yy + 0.5)
    crop = img_back[c:d, a:b].reshape(-1, 3)
    out = {}
    for name in RACK:
        m = _inside(CONCEPT_SHARDS[name], X, Z, -0.02)
        m &= ((Z > 1.74) & (Z < 2.06)) if name in UPPER else ((Z > 1.10) & (Z < 1.58))
        px = crop[m.reshape(-1)]
        L = _lum(px)
        lo, mid_lo, mid_hi, hi = np.percentile(L, [12, 35, 65, 90])
        base = px[(L >= mid_lo) & (L <= mid_hi)].mean(0)
        out[name] = (base, px[L <= lo].mean(0), px[L >= hi].mean(0))
    return out


def _rack_fills(plates, img_back, log=print):
    """per lower shard: the back plate's painted shard pixels (eroded off the outline and the brace), pull-push
    filled, on a crop round the rack: (fill, (px0, py0))"""
    out = {}
    x0p, y0p = plates.to_px("back", 0.52, 2.36)
    x1p, y1p = plates.to_px("back", -0.52, 0.95)
    a, b = int(min(x0p, x1p)), int(max(x0p, x1p)) + 1
    c, d = int(y0p), int(y1p) + 1
    crop = img_back[c:d, a:b]
    yy, xx = np.mgrid[c:d, a:b]
    X, Z = plates.to_world("back", xx + 0.5, yy + 0.5)
    for name in ("shard_lo_L", "shard_lo_R"):
        valid = _inside(CONCEPT_SHARDS[name], X, Z, -0.008) & (Z < BRACE_BAND[0])
        valid = _dilate(_erode(valid, 1), 1)
        out[name] = (_pullpush(crop, valid), (a, c))
    log(f"project (hesmi): lower shard fills {sorted(out)}")
    return out


def rack_stats(stats):
    """fix pass 4: ONE honed stone for all three cut bands (the brief's `stone`; the per-shard painted colours read as
    a lilac and a pink stone side by side) and one weathered ironstone for every shard body below BAND_Z: (base,
    shadow, light) sRGB each"""
    from common import scene
    up = np.mean([np.asarray(stats[k][0], dtype=np.float64) for k in UPPER if k in stats], axis=0)
    pal = np.asarray(scene.hex_srgb(PALETTE["stone"]), dtype=np.float64)
    bb = 0.45 * pal + 0.55 * up
    band = (bb, bb * np.array([0.78, 0.78, 0.83]), np.clip(bb * 1.12 + 0.05, 0, 1))
    lo = [k for k in ("shard_lo_L", "shard_lo_R") if k in stats]
    wea = tuple(np.mean([np.asarray(stats[k][i], dtype=np.float64) for k in lo], axis=0) for i in range(3))
    return band, wea


def _sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def paint_stone(name, p, n, band, wea, seed):
    """the rack's painted stone at texels p (N, 3, rest pose), normals n: sRGB (N, 3). Two zones (brief §4): the
    HONED cut band above BAND_Z (one pale stone: a soft painted value ramp to the cut, a broad soft light on the lit
    ridge facet, crisp arris lights, no cracks) and the WEATHERED needle-stone below (soft-edged chisel planes,
    sparse cracks with a light lip, chipped pale arrises); a fresh-cut lip where they meet; the inlay's pocket ink.
    Fix pass 4: the facet planes blend softly at their borders (the hard Voronoi patches read as camouflage) and the
    cut band carries no crack strokes (one read as a letter on the signature prop)."""
    from common import scene
    _, c0, F, _t = shard_slab(name)
    q = (p - c0) @ F.T                                  # (u, w, v)
    u, w, v = q[:, 0], q[:, 1], q[:, 2] + 1.6
    pz, nz = p[:, 2], n[:, 2]
    m = n @ F.T
    poly = SHARDS[name][0]
    uc = float(_ccw(poly)[:, 0].mean())
    th = shard_t(name, v)
    Q = np.stack([u, w, v], 1)
    face = np.abs(m[:, 1]) >= np.maximum(np.abs(m[:, 0]), np.abs(m[:, 2]))
    side = (np.abs(m[:, 0]) > np.abs(m[:, 1])) & (np.abs(m[:, 0]) >= np.abs(m[:, 2]))
    if name in UPPER:
        zb = BAND_Z + 0.012 * NOISE(Q, 7.0, (seed, 2.0, 0.0)) + 0.007 * np.sin(u * 37.0 + seed)
        hb = _sstep(zb - 0.003, zb + 0.003, pz)         # 1 = the honed cut band
    else:
        zb = np.full(len(p), -9.0)
        hb = np.zeros(len(p))
    # ── weathered needle-stone ──
    wb_, wd_, wl_ = (np.asarray(x, dtype=np.float64) for x in wea)
    d1, d2, hid = _vor3(Q * np.array([1.0, 1.0, 0.7]), 0.095, seed)     # cells a little taller: the needle's grain
    soft = _sstep(0.0, 0.014, d2 - d1)                  # the planes blend at their borders
    val = 1.0 + 0.13 * (hid - 0.5) * soft
    lit = np.tanh((u - uc) * np.sign(w + 1e-9) / 0.02)  # the ridge facets: one lit, one shaded, a soft turn
    val *= np.where(face, 1.0 + 0.05 * lit, 1.0)
    val *= 1.0 + 0.05 * NOISE(Q, 16.0, (seed, 0.0, 0.0)) + 0.03 * NOISE(Q, 42.0, (0.0, seed, 0.0))
    colw = wb_[None] * val[:, None]
    darkcell = (hid > 0.84) * soft
    colw = colw * (1 - 0.45 * darkcell[:, None]) + wd_[None] * 0.45 * darkcell[:, None]
    border = d2 - d1
    picked = _hash3(np.floor(Q / 0.095), seed + 9.0) > 0.74
    crack = np.clip(1.0 - border / 0.0035, 0, 1) * picked
    lip = np.clip(1.0 - np.abs(border - 0.0065) / 0.0025, 0, 1) * picked
    colw = colw * (1 - 0.70 * crack[:, None]) + wd_[None] * 0.70 * crack[:, None]
    colw = colw * (1 - 0.30 * lip[:, None]) + wl_[None] * 0.30 * lip[:, None]
    # ── the honed cut band ──
    bb_, bd_, bl_ = (np.asarray(x, dtype=np.float64) for x in band)
    valb = 0.90 + 0.13 * np.clip((pz - zb) / 0.28, 0, 1)                 # the painted ramp up to the cut
    valb *= np.where(face, 1.0 + 0.10 * lit, np.where(side, 0.86, 1.0))   # a lit and a shaded facet, darker narrow sides
    # broad honed planes (large soft cells) and soft brush mottling: painted, never patchy
    e1, e2, eh = _vor3(Q * np.array([1.0, 1.0, 0.8]), 0.16, seed + 4.0)
    valb *= 1.0 + 0.09 * (eh - 0.5) * _sstep(0.0, 0.03, e2 - e1)
    valb *= 1.0 + 0.045 * NOISE(Q, 6.0, (seed, 1.0, 0.0)) + 0.02 * NOISE(Q, 24.0, (0.0, seed, 2.0))
    hl = np.exp(-((u - (uc + 0.035 * np.sign(w + 1e-9))) / 0.03) ** 2) * np.clip((pz - zb) / 0.2, 0, 1)
    colb = bb_[None] * valb[:, None]
    colb = colb * (1 - 0.30 * (hl * face)[:, None]) + bl_[None] * 0.30 * (hl * face)[:, None]
    col = colw * (1 - hb[:, None]) + colb * hb[:, None]
    # the fresh-cut lip (light) over a thin shadow line where the band meets the weathered stone
    if name in UPPER:
        lipz = np.exp(-((pz - zb - 0.006) / 0.004) ** 2)
        shz = np.exp(-((pz - zb + 0.003) / 0.003) ** 2)
        col = col * (1 - 0.45 * lipz[:, None]) + bl_[None] * 0.45 * lipz[:, None]
        col = col * (1 - 0.35 * shz[:, None])
    # light rims on the arrises: the outline edges of the faces, the faces' edges on the sides, the cut's bevels
    loc = [(a_, b_ - 1.6) for a_, b_ in poly]
    d_poly = _poly_edge_dist(np.stack([u, v - 1.6], 1), loc)
    d_side = 0.5 * th - RIDGE * np.abs(u - uc) - np.abs(w)
    d_ar = np.where(face, d_poly, np.where(side, np.maximum(d_side, 0.0), 0.05))
    rim = np.clip(1.0 - d_ar / 0.011, 0, 1) ** 1.5 * RIM_LIGHT
    rimc = wl_[None] * (1 - hb[:, None]) + bl_[None] * hb[:, None]
    if name in UPPER:
        bevel = (pz > TOP_Z - CUT_CH - 0.008) & (nz > 0.35) & (nz < 0.93)
        rim = np.where(bevel, 0.85, rim)
        cut = (nz >= 0.93) & (pz > TOP_Z - 0.004)
        rim = np.where(cut, 0.45, rim)
    col = col * (1 - rim[:, None]) + rimc * rim[:, None]
    if name in UPPER:                                   # the pocket round the inlay (floor and walls): ink
        u0, u1, _ = top_span(name)
        thtop = float(shard_t(name, TOP_Z))
        inner = ((u > u0 + CUT_CH - 0.003) & (u < u1 - CUT_CH + 0.003) &
                 (np.abs(w) + RIDGE * np.abs(u - uc) < 0.5 * thtop - CUT_CH + 0.003) & (pz < TOP_Z - 0.0015) &
                 (pz > TOP_Z - POCKET - 0.006))
        ink = np.asarray(scene.hex_srgb(CUT_INK), dtype=np.float64)
        col = np.where(inner[:, None], ink[None], col)
    return np.clip(col, 0, 1)


def hesmi_paint(maps, plates, vis, names, tops=None, flat=None, eps=0.02, bleed=True, log=print):
    from common import scene
    from common.hifi import project as pj
    P, N, part = maps["P"], maps["N"], maps["part"]
    size = maps["size"]
    out = np.zeros((size, size, 3), dtype=np.float32)
    have = part >= 0
    tops = tops or {}
    flat = flat or {}
    img = {"front": plates.img["front"], "back": np.power(np.clip(plates.img["back"], 0, 1), BACK_GAMMA)}
    rack_ids = {names.index(n) for n in RACK if n in names}
    # the concept's cut (the painted figure): outside it the plates hold only background bleed
    mpath = os.path.join(scene.CACHE_DIR, "concept", f"{PROJECTION['concept']}_mask.png")
    cut = _dilate(pj.load_rgb(mpath)[..., 0] > 0.5, MASK_GROW_PX)
    fills = {}
    s_ = vis.step
    # the concept's rack paint on the back plate, at the visibility grid
    pidb = vis.part["back"]
    gy, gx = np.mgrid[0:pidb.shape[0], 0:pidb.shape[1]]
    GX, GZ = plates.to_world("back", gx * s_ + s_ * 0.5, gy * s_ + s_ * 0.5)
    rack_paint = concept_rack_mask(GX, GZ, 0.012)
    pidf = vis.part["front"]
    fy, fx = np.mgrid[0:pidf.shape[0], 0:pidf.shape[1]]
    FX, FZ = plates.to_world("front", fx * s_ + s_ * 0.5, fy * s_ + s_ * 0.5)
    own_ids = [({names.index(o) for o in owners if o in names}, x0, x1, z0, z1) for owners, x0, x1, z0, z1 in FRONT_OWNED]

    def not_owned(ids_k, X, Z):
        m = np.zeros(np.shape(X), bool)
        for ids, x0, x1, z0, z1 in own_ids:
            if ids_k not in ids:
                m |= (X >= x0) & (X <= x1) & (Z >= z0) & (Z <= z1)
        return m
    for side in ("front", "back"):
        pid = vis.part[side]
        small = img[side][s_ // 2::s_, s_ // 2::s_][:pid.shape[0], :pid.shape[1]]
        incut = _erode(cut[s_ // 2::s_, s_ // 2::s_][:pid.shape[0], :pid.shape[1]], 1)
        for k in np.unique(part[have]):
            valid = (pid == k) & incut
            if not valid.any():
                valid = pid == k
                if not valid.any():
                    continue
            other = (pid >= 0) & (pid != k)
            v2 = valid & ~_dilate(other, ERODE_PX)
            if side == "back" and int(k) not in rack_ids:
                v2 &= ~rack_paint
            if side == "front":
                v2 &= ~not_owned(int(k), FX, FZ)
            if v2.sum() >= max(12, 0.15 * valid.sum()):
                valid = v2
            elif side == "back" and int(k) not in rack_ids and (valid & ~rack_paint).sum() >= 12:
                valid = valid & ~rack_paint
            fills[(side, int(k))] = pj.blur(_pullpush(small, valid), 0.8)
    log(f"project (hesmi): {len(fills)} part fills (pull-push, eroded {ERODE_PX} px, in the cut, rack paint excluded)")
    idx = np.nonzero(have)
    p, n = P[idx], N[idx]
    k = part[idx].astype(np.int64)
    st = np.abs(n[:, 0]) / (np.abs(n[:, 0]) + np.abs(n[:, 1]) + 1e-6)
    ws = np.clip((st - 0.66) / 0.26, 0, 1)
    ws = ws * ws * (3 - 2 * ws)
    inset = -np.sign(n[:, 0]) * SIDE_INSET * ws
    face = np.isin(k, [names.index(f) for f in FACE_PARTS if f in names])
    xs = np.where(face, p[:, 0] * FACE_SHIFT[0] + FACE_SHIFT[1], p[:, 0])
    cols = {}
    H, W = cut.shape
    for side in ("front", "back"):
        px, py = plates.to_px(side, xs, p[:, 2])
        c = pj.bilinear(img[side], px, py)
        dep, hid = vis.lookup(side, px, py)
        if side == "front":
            hidden = ~(p[:, 1] <= np.nan_to_num(dep, nan=1e9) + eps)
            # the face wrap under the eye-band's lower edge takes the painting directly (the band's overhang hid it
            # from the plate and the hidden fill painted a hard grey-teal patch under the keel; fix pass 4)
            if "facewrap" in names:
                hidden &= ~((k == names.index("facewrap")) & (n[:, 1] < -0.25))
            for ids, x0, x1, z0, z1 in own_ids:
                hidden |= ((xs >= x0) & (xs <= x1) & (p[:, 2] >= z0) & (p[:, 2] <= z1) & ~np.isin(k, list(ids))
                           & ~np.isin(k, list(rack_ids)))
        else:
            hidden = ~(p[:, 1] >= np.nan_to_num(dep, nan=-1e9) - eps)
            hidden |= concept_rack_mask(p[:, 0], p[:, 2], 0.012) & ~np.isin(k, list(rack_ids))
        hidden |= ~cut[np.clip(py.astype(np.int64), 0, H - 1), np.clip(px.astype(np.int64), 0, W - 1)]
        qx, qy = plates.to_px(side, xs + inset, p[:, 2])
        for kk in np.unique(k):
            f = fills.get((side, int(kk)))
            if f is None:
                continue
            sel = k == kk
            hs = sel & hidden
            if hs.any():
                c[hs] = pj.bilinear(f, px[hs] / s_, py[hs] / s_)
            sd = sel & (ws > 0)
            if sd.any():
                c[sd] = c[sd] * (1 - ws[sd, None]) + pj.bilinear(f, qx[sd] / s_, qy[sd] / s_) * ws[sd, None]
        cols[side] = c
    wb = np.clip((n[:, 1] + 0.25) / 0.5, 0, 1)
    wb = wb * wb * (3 - 2 * wb)
    col = cols["front"] * (1 - wb[:, None]) + cols["back"] * wb[:, None]
    # THE RACK: painted stone (upper shards), the concept's painted faces + painted sides / rims (lower shards)
    stats = _rack_stats(plates, img["back"])
    band, wea = rack_stats(stats)
    lf = _rack_fills(plates, img["back"], log)
    for j, name in enumerate(RACK):
        if name not in names:
            continue
        sel = k == names.index(name)
        if not sel.any():
            continue
        cc = paint_stone(name, p[sel].astype(np.float64), n[sel].astype(np.float64), band, wea, 3.0 + 7.0 * j)
        if name in lf:
            f, (a0, c0p) = lf[name]
            bx, by = plates.to_px("back", p[sel, 0], p[sel, 2])
            fc = pj.bilinear(f, bx - a0, by - c0p)
            _, _c, F, _t = shard_slab(name)
            mf = np.abs(n[sel] @ F[1])
            wf = np.clip((mf - 0.55) / 0.3, 0, 1)[:, None]
            # the painted face, its own rims kept; the procedural sides and arris rims elsewhere
            cc = fc * wf + cc * (1 - wf)
        col[sel] = cc
        log(f"  rack (hesmi) {name}: base {np.round(np.asarray(stats[name][0]) * 255).astype(int).tolist()}")
    # box-mapped slabs: every face (front, back, sides, cut tops) from the part's own front paint
    for name in BOX_PARTS:
        if name not in names:
            continue
        i = names.index(name)
        sel = k == i
        f = fills.get(("front", i))
        if f is None or not sel.any():
            continue
        q, m = p[sel], n[sel]
        x0, x1 = np.percentile(q[:, 0], [2, 98])
        y0, y1 = np.percentile(q[:, 1], [2, 98])
        z0, z1 = np.percentile(q[:, 2], [2, 98])
        fx_, fy_ = plates.to_px("front", q[:, 0], q[:, 2])
        front_c = pj.bilinear(f, fx_ / s_, fy_ / s_)
        u = np.clip((q[:, 1] - y0) / max(1e-6, y1 - y0), 0, 1)
        xo = np.where(m[:, 0] > 0, x1, x0)
        xr = xo - np.sign(m[:, 0]) * u * (x1 - x0) * 0.92
        ax, ay = plates.to_px("front", xr, q[:, 2])
        side_c = pj.bilinear(f, ax / s_, ay / s_)
        wx = np.clip((np.abs(m[:, 0]) - 0.45) / 0.3, 0, 1)
        wx = (wx * wx * (3 - 2 * wx))[:, None]
        zr = np.clip(z1 - u * min(0.12, 0.5 * (z1 - z0)), z0, z1)
        bx, by = plates.to_px("front", q[:, 0], zr)
        top_c = pj.bilinear(f, bx / s_, by / s_)
        wz = np.clip((m[:, 2] - 0.5) / 0.3, 0, 1)
        wz = (wz * wz * (3 - 2 * wz))[:, None]
        cc = front_c * (1 - wx) + side_c * wx
        col[sel] = cc * (1 - wz) + top_c * wz
    # the shin straps: painted leather in the concept's strap brown (measured on the back plate's painted straps), a
    # lit upper edge and a shaded lower one, lengthwise grain
    sids = [names.index(nm) for nm in STRAP_PARTS if nm in names]
    if sids:
        sel = np.isin(k, sids)
        cxb, gb = plates.to_px("back", np.array([0.17, 0.32, -0.32, -0.17]), np.array([0.49, 0.42, 0.49, 0.42]))
        a0, a1 = int(min(cxb[:2])), int(max(cxb[:2]))
        b0, b1 = int(min(gb[:2])), int(max(gb[:2]))
        reg = img["back"][b0:b1, a0:a1].reshape(-1, 3)
        Ls = _lum(reg)
        base_s = reg[(Ls >= np.percentile(Ls, 35)) & (Ls <= np.percentile(Ls, 75))].mean(0)
        q = p[sel].astype(np.float64)
        val = 1.0 + 0.08 * NOISE(q, 22.0, (1.0, 0.0, 0.0)) + 0.04 * NOISE(q * np.array([1.0, 1.0, 3.0]), 40.0)
        val *= 1.0 + 0.22 * np.clip(n[sel, 2], 0, 1) - 0.25 * np.clip(-n[sel, 2], 0, 1)
        col[sel] = base_s[None] * val[:, None]
        log(f"project (hesmi): straps painted leather {np.round(base_s * 255).astype(int).tolist()}")
    # up-facing tops: the boot tops take the toe caps' paint
    for name, zt in UPFACE.items():
        if name not in names:
            continue
        i = names.index(name)
        sel = k == i
        f = fills.get(("front", i))
        if f is None or not sel.any():
            continue
        wz = np.clip((n[sel, 2] - 0.40) / 0.30, 0, 1)
        wz = (wz * wz * (3 - 2 * wz))[:, None]
        bx, by = plates.to_px("front", p[sel, 0], np.full(int(sel.sum()), zt))
        col[sel] = col[sel] * (1 - wz) + pj.bilinear(f, bx / s_, by / s_) * wz
    # the hood crown (what the 52 degree camera sees most): the front / back projection streaks the painting's top
    # edge highlight along Y across the whole dome (a satin sheen), so the up-facing texels are REPAINTED: the hood's
    # own painted linen (the median of its front-facing paint), folds round the crown (crests light, valleys dark),
    # brush mottling, occlusion toward the cowl's sides and the seam down the back
    if "hood" in names:
        sel = k == names.index("hood")
        q, m = p[sel].astype(np.float64), n[sel]
        # the linen of the cowl's outer sides (never the face opening's dark interior: the first try read brown)
        fr = (m[:, 1] < -0.3) & (q[:, 2] > 1.95) & (np.abs(q[:, 0]) > 0.17)
        src = col[sel][fr] if fr.sum() > 20 else col[sel]
        Ls = _lum(src)
        med = src[(Ls >= np.percentile(Ls, 55)) & (Ls <= np.percentile(Ls, 85))].mean(0)
        med = 0.5 * med + 0.5 * np.asarray(scene.hex_srgb(PALETTE["cloth2"]), dtype=np.float32)
        up = np.clip((m[:, 2] - 0.20) / 0.40, 0, 1) * np.clip((q[:, 2] - 2.04) / 0.10, 0, 1)
        up = up * up * (3 - 2 * up)
        ang = np.arctan2(q[:, 1] - 0.03, q[:, 0])
        wob = NOISE(q, 4.0)
        fold = np.sin(ang * 7.0 + 0.9 * wob)
        valley = (1.0 - np.abs(np.sin(ang * 3.5 + 0.45 * wob))) ** 5
        rr = np.hypot(q[:, 0], q[:, 1] - 0.03)
        wr = np.clip((rr - 0.05) / 0.09, 0, 1)                 # the creases fall from the crown's edge, not its centre
        val = 1.0 + wr * (0.08 * fold - 0.14 * valley) + 0.05 * NOISE(q, 22.0, (3.0, 1.0, 0.0)) \
            + 0.03 * NOISE(q, 60.0, (0.0, 2.0, 1.0))
        val -= 0.16 * np.exp(-(q[:, 0] / 0.012) ** 2) * np.clip((q[:, 1] - 0.02) / 0.06, 0, 1)
        val *= 1.0 - 0.10 * np.clip((np.hypot(q[:, 0], q[:, 1] - 0.03) - 0.10) / 0.12, 0, 1)
        crown = med[None] * val[:, None]
        col[sel] = col[sel] * (1 - up[:, None]) + crown * up[:, None]
    for name, (top, ext) in tops.items():
        if name not in names:
            continue
        sel = k == names.index(name)
        th_, tw = top.shape[:2]
        tcol = pj.bilinear(top, (p[sel, 0] + ext) / (2 * ext) * tw, (1 - (p[sel, 1] + ext) / (2 * ext)) * th_)
        wt = np.clip((n[sel, 2] - 0.55) / 0.30, 0, 1)
        wt = (wt * wt * (3 - 2 * wt))[:, None]
        col[sel] = col[sel] * (1 - wt) + tcol * wt
    if "eyeband" in names:                            # the honed band: the concept's pale stone, carved in blocks
        sel = k == names.index("eyeband")
        stone = np.asarray(scene.hex_srgb(PALETTE["stone"]), dtype=np.float32)
        col[sel] = col[sel] * (1 - BAND_LIFT) + stone[None] * BAND_LIFT
        col[sel] = 1.0 - (1.0 - col[sel]) * 0.94
        a = np.degrees(np.arctan2(p[sel, 0], -(p[sel, 1] - 0.005)))
        jd = np.min(np.abs(a[:, None] - np.asarray(BAND_JOINTS)[None]), axis=1)
        joint = np.clip(1.0 - (jd - 0.5) / 0.8, 0, 1)[:, None]
        col[sel] = col[sel] * (1 - 0.6 * joint)
    col *= _ramp(p[:, 2])[:, None].astype(np.float32)
    for name, rgb in flat.items():
        if name in names:
            col[k == names.index(name)] = np.asarray(rgb, dtype=np.float32)
    out[idx] = np.clip(col, 0, 1)
    if bleed:
        iy, ix = pj.nearest_index(have)
        out = out[iy, ix]
    return out


# ── skins: a stronger per-part re-colour than the shared gain (common/hifi/project.recolour) ─────────────────
# The shared pass multiplies the painting by skin/base per channel, which keeps the CONCEPT's own hues (the
# warm-brown shard faces, the violet trousers) and so left the three looks nearly identical. Here each texel
# keeps its painted VALUE relative to its role but takes the skin's colour (SKIN_CHROMA of the way), and the
# shards and the chest read two roles by value (dark weathered body -> ironstone/leather, honed face -> stone/
# cloth), so Gorgewalk's shards turn slate and Shadeprint's ink. Shadeprint's light rims are painted here too
# (brief §9: a 1 cm light band on every shard edge, no geometry).
SKIN_CHROMA = 0.85
DUAL_ROLES = {"shard_up_L": ("ironstone", "stone"), "shard_up_R": ("ironstone", "stone"),
              "shard_mid": ("ironstone", "stone"), "torso": ("leather", "cloth")}
RIM_W = 0.016
# roles the skin's chroma push barely touches (fix pass 4: Gorgewalk's gauntlets and cut bands went icy sky-blue at
# 31-33 % saturation; the brief's slate gauntlet is 10 %)
CHROMA_SOFT = {"gauntlet", "stone", "ironstone"}
RIM_PARTS = ("shard_up_L", "shard_up_R", "shard_mid", "shard_lo_L", "shard_lo_R")
_SKIN: dict = {}


def hesmi_recolour(img, maps, names, roles, base_pal, skin_pal, skip=None, log=print):
    from common import scene
    from common.hifi import project as pj
    part = maps["part"]
    iy, ix = pj.nearest_index(part >= 0)
    pid = part[iy, ix]
    Pn = maps["P"][iy, ix]
    lin = pj._lin(img)
    out = lin.copy()
    skip = skip or set()
    full = dict(materials.BIBLE_PALETTE, **PALETTE)
    full.update(base_pal)

    def col(pal, r):
        return pj._lin(np.asarray(scene.hex_srgb(pal.get(r, full.get(r)))))
    for i, nm in enumerate(names):
        r = roles.get(nm)
        if nm in skip or not r or r == "accent":
            continue
        lo_r, hi_r = DUAL_ROLES.get(nm, (r, r))
        # a skin may re-assign a part's roles (Gorgewalk: the chest wraps and the tunic are its slate mid-band wraps)
        lo_s, hi_s = (_SKIN.get("roles") or {}).get(nm, (lo_r, hi_r))
        if any(x not in full for x in (lo_r, hi_r, lo_s, hi_s)):
            continue
        if all(str(skin_pal.get(xs, full[xs])).lower() == str(full[xb]).lower() for xb, xs in ((lo_r, lo_s), (hi_r, hi_s))):
            continue
        m = pid == i
        if not m.any():
            continue
        c = lin[m]
        Y = _lum(c)
        b_lo, b_hi, s_lo, s_hi = col(full, lo_r), col(full, hi_r), col(skin_pal, lo_s), col(skin_pal, hi_s)
        if lo_r == hi_r:
            t = np.zeros(len(c))
        else:
            ya, yb = float(_lum(b_lo)) * 1.4, float(_lum(b_hi)) * 0.75
            t = np.clip((Y - ya) / max(1e-6, yb - ya), 0, 1)
            t = t * t * (3 - 2 * t)
        ts = t
        zb = _SKIN.get("dark_below")
        if zb and nm in RIM_PARTS and lo_r != hi_r:    # below the cut band the honed stone takes the weathered skin role
            ts = t * np.clip((Pn[m][:, 2] - (zb - 0.03)) / 0.06, 0, 1)
        bref = b_lo[None] * (1 - t[:, None]) + b_hi[None] * t[:, None]
        sref = s_lo[None] * (1 - ts[:, None]) + s_hi[None] * ts[:, None]
        gain_out = c * np.clip(sref / np.maximum(bref, 1e-4), 0.05, 8.0)
        chroma_out = sref * np.clip(Y / np.maximum(_lum(bref), 1e-4), 0.0, 4.0)[:, None]
        o = gain_out * (1 - SKIN_CHROMA) + chroma_out * SKIN_CHROMA
        kc = float(_SKIN.get("chroma", 1.0))
        if {lo_s, hi_s} & CHROMA_SOFT:                  # (fix pass 4: honed stone, gauntlets, shard bodies: a quarter)
            kc = 1.0 + (kc - 1.0) * 0.25
        if kc != 1.0:                                   # the skin's hue family, pushed (value kept)
            Yo = _lum(o)[:, None]
            o = np.maximum(Yo + (o - Yo) * kc, 0.0)
        out[m] = o
        log(f"  recolour (hesmi) {nm} ({lo_r}/{hi_r} -> {lo_s}/{hi_s}) -> {skin_pal.get(lo_s, full[lo_s])}/{skin_pal.get(hi_s, full[hi_s])}")
    if (_SKIN.get("extra") or {}).get("light_rims"):
        # light rims on every ARRIS (fix pass 3: the rims were hairlines on the face outlines, the sides washed
        # light): the faces' outline edges, the faces' edges on the narrow sides, the cut's bevels and the cut
        rim = col(skin_pal, "stone")
        Nn = maps["N"][iy, ix]
        for nm in RIM_PARTS:
            if nm not in names:
                continue
            m = pid == names.index(nm)
            _, c0, F, t = shard_slab(nm)
            q = (Pn[m] - c0) @ F.T
            mm = Nn[m] @ F.T
            u, w, v = q[:, 0], q[:, 1], q[:, 2] + 1.6
            poly = SHARDS[nm][0]
            uc = float(_ccw(poly)[:, 0].mean())
            loc = [(a_, b_ - 1.6) for a_, b_ in poly]
            face = np.abs(mm[:, 1]) >= np.maximum(np.abs(mm[:, 0]), np.abs(mm[:, 2]))
            side = (np.abs(mm[:, 0]) > np.abs(mm[:, 1])) & (np.abs(mm[:, 0]) >= np.abs(mm[:, 2]))
            d_poly = _poly_edge_dist(np.stack([u, v - 1.6], 1), loc)
            d_side = np.maximum(0.5 * shard_t(nm, v) - RIDGE * np.abs(u - uc) - np.abs(w), 0.0)
            d = np.where(face, d_poly, np.where(side, d_side, 0.0))
            a = np.clip(1.0 - (d - RIM_W * 0.5) / (RIM_W * 0.5), 0, 1)[:, None]
            out[m] = out[m] * (1 - 0.92 * a) + rim[None] * 0.92 * a
        log("  recolour (hesmi): light rims painted on the shard arrises")
    return pj._srgb(out).astype(np.float32)


def _install_render() -> None:
    """Portrait framing for Hesmi only (common/render.py is shared): the head box the shared portrait camera fits is
    narrower than her rack, so the flanking shards were cut at the frame edge. While Hesmi's renders run, the
    square portrait fit (aspect 1, fill 0.92) uses PORTRAIT_FILL and centres a little higher (the cut tops)."""
    from common import render
    if getattr(render.fighter_renders, "_hesmi", False):
        return
    orig_fit, orig_fr = render._fit_camera, render.fighter_renders
    state = {"on": False}

    def fit(cam, lo, hi, yaw, pitch, lens, fill, aspect, x_frac, y_center=None):
        if state["on"] and abs(aspect - 1.0) < 1e-6 and abs(fill - 0.92) < 1e-6:
            fill = PORTRAIT_FILL
            pitch = PORTRAIT_PITCH
            y_center = (lo.z + hi.z) / 2 + 0.02
        elif state["on"] and abs(aspect - 1.0) < 1e-6 and abs(fill - 0.9) < 1e-6:
            pitch = ICON_PITCH
        return orig_fit(cam, lo, hi, yaw, pitch, lens, fill, aspect, x_frac, y_center)

    def fr(ctx, *a, **k):
        state["on"] = getattr(ctx.spec, "ID", None) == ID
        try:
            return orig_fr(ctx, *a, **k)
        finally:
            state["on"] = False
    fr._hesmi = True
    render._fit_camera = fit
    render.fighter_renders = fr


def _install_paint() -> None:
    from common.hifi import project
    if getattr(project.paint, "_hesmi", False):
        return
    hesmi_paint._hesmi = True
    project.paint = hesmi_paint
    hesmi_recolour._hesmi = True
    project.recolour = hesmi_recolour


def _ground_pts() -> dict:
    """rest-pose points (armature space, m) on the lowest surfaces each bone carries: the knee and shin slabs, the
    boot sole, heel and toe cap, the fists and the gauntlets' lower ends (the grounding check of `grounded`)"""
    pts = {}
    for s, sx in (("L", 1.0), ("R", -1.0)):
        pts[f"thigh.{s}"] = [(sx * 0.20, -0.17, 0.66)]
        # (fix pass 4: the knee / shin plates and the straps)
        pts[f"shin.{s}"] = [(sx * 0.292, -0.196, 0.44), (sx * 0.292, -0.19, 0.60), (sx * 0.20, -0.18, 0.52),
                            (sx * 0.39, -0.18, 0.52), (sx * 0.28, -0.18, 0.25), (sx * 0.28, -0.18, 0.40),
                            (sx * 0.20, -0.18, 0.66), (sx * 0.232, -0.136, 0.458), (sx * 0.232, 0.130, 0.458),
                            (sx * 0.374, -0.004, 0.458), (sx * 0.090, -0.004, 0.458), (sx * 0.232, -0.134, 0.188),
                            (sx * 0.232, 0.128, 0.188), (sx * 0.36, -0.06, 0.52), (sx * 0.12, -0.06, 0.52),
                            (sx * 0.23, 0.14, 0.50), (sx * 0.23, 0.13, 0.25)]
        pts[f"foot.{s}"] = [(sx * 0.235, 0.14, 0.0), (sx * 0.37, 0.0, 0.0), (sx * 0.12, 0.0, 0.0), (sx * 0.235, 0.13, 0.12)]
        pts[f"toe.{s}"] = [(sx * 0.306, -0.279, 0.0), (sx * 0.437, -0.249, 0.0), (sx * 0.175, -0.309, 0.0),
                           (sx * 0.306, -0.27, 0.10)]
        pts[f"hand.{s}"] = [(sx * 0.515, -0.085, 0.86), (sx * 0.515, -0.20, 0.93), (sx * 0.60, -0.05, 0.87)]
        pts[f"forearm.{s}"] = [(sx * 0.615, -0.17, 0.99), (sx * 0.70, 0.0, 1.0)]
    # the body's own outer surfaces (the toppled death lies on them): hood, mantle, pauldrons, rack, belt, tunic
    pts["head"] = [(0, -0.25, 2.11), (0, -0.12, 2.26), (0.24, 0.0, 2.0), (-0.24, 0.0, 2.0), (0, 0.25, 2.05)]
    pts["chest"] = [(0, -0.33, 1.68), (0.5, -0.1, 1.78), (-0.5, -0.1, 1.78), (0.56, -0.12, 1.62), (-0.56, -0.12, 1.62),
                    (0, -0.27, 1.5), (0.41, 0.44, 2.30), (-0.42, 0.44, 2.30), (0.40, 0.31, 2.30), (-0.41, 0.31, 2.30),
                    (0.0, 0.30, 1.19), (0.08, 0.32, 1.0), (-0.12, 0.32, 1.0)]
    pts["spine"] = [(0, -0.29, 1.28), (0.33, 0.0, 1.30), (-0.33, 0.0, 1.30)]
    pts["hips"] = [(0, -0.33, 0.85), (0.43, 0.0, 0.80), (-0.43, 0.0, 0.80), (0, 0.30, 0.80)]
    return pts


def grounded(clip, skel, floor: float = 0.0):
    """Keep every sample above the floor (the fix for the sunk death/recall/dash holds): an IK foot whose sole or
    toe cap dips under the floor rises by the dip (tiptoe pivots), a planted fist (HandTarget pos) likewise, and
    whatever is still under (a kneeling shin, a knee, a toe of an FK leg) lifts the hips."""
    from mathutils import Vector
    FT, HT = anim.FootTarget, anim.HandTarget
    PTS = {b: [Vector(q) for q in lst] for b, lst in _ground_pts().items() if b in skel.rest}
    INV = {b: skel.rest[b].inverted() for b in PTS}

    def low(M, bones):
        return min((M[b] @ (INV[b] @ q)).z for b in bones for q in PTS[b])

    def sample(t):
        p = dict(clip.sample(t))
        p["ik"] = dict(p.get("ik", {}))
        for _ in range(4):
            M = skel.fk(anim.resolve(skel, p))
            changed = False
            for sd in ("L", "R"):
                ft = p["ik"].get(f"foot.{sd}")
                if ft is not None and ft.weight > 0.5:
                    lz = low(M, (f"foot.{sd}", f"toe.{sd}"))
                    if lz < floor - 0.001:
                        p["ik"][f"foot.{sd}"] = FT((ft.ankle[0], ft.ankle[1], ft.ankle[2] + floor - lz + 0.002), ft.pitch,
                                                   ft.yaw, ft.toe, ft.knee, ft.weight)
                        changed = True
                ht = p["ik"].get(f"hand.{sd}")
                if ht is not None and ht.pos is not None and ht.weight > 0.5:
                    lz = low(M, (f"hand.{sd}", f"forearm.{sd}"))
                    if lz < floor - 0.001:
                        p["ik"][f"hand.{sd}"] = HT(pos=(ht.pos[0], ht.pos[1], ht.pos[2] + floor - lz + 0.004), pole=ht.pole,
                                                   weight=ht.weight)
                        changed = True
            if changed:
                M = skel.fk(anim.resolve(skel, p))
            planted = {f"{k}.{sd}" for sd in ("L", "R") for k in ("hand", "forearm")
                       if (p["ik"].get(f"hand.{sd}") is not None and p["ik"][f"hand.{sd}"].pos is not None)}
            lz = low(M, [b for b in PTS if b not in planted])
            if lz < floor - 0.001:
                hx, hy, hz = p.get("hips_loc", (0.0, 0.0, 0.0))
                p["hips_loc"] = (hx, hy, hz + floor - lz + 0.002)
                continue
            if not changed:
                break
        return p
    return anim.Clip(clip.name, clip.frames, clip.loop, sample, impact=clip.impact, secondary=clip.secondary,
                     meta=clip.meta)


def level_chest(clip, skel, limit: float = RACK_TILT_MAX):
    """Keep the rack (rigid on the chest) within `limit` degrees of upright (brief per-fighter check: tilt <= 3 in
    idle, run and the Stand Firm clack; the stagger sways ~3): per sample, the chest's world tilt beyond the limit is
    rotated back out in the chest's own rotation (the arms' rel targets follow the chest)."""
    from mathutils import Matrix, Vector
    Z = Vector((0.0, 0.0, 1.0))
    R0 = skel.rest["chest"].to_3x3().inverted()
    par = skel.parent["chest"]

    def sample(t):
        p = dict(clip.sample(t))
        M = skel.fk(anim.resolve(skel, p))
        up = (M["chest"].to_3x3() @ R0) @ Z
        ang = math.degrees(up.angle(Z))
        if ang > limit:
            ax = up.cross(Z)
            if ax.length > 1e-8:
                corr = Matrix.Rotation(math.radians(ang - limit), 3, ax.normalized())
                new = corr @ M["chest"].to_3x3()
                Ph = (M[par] @ skel.local["chest"]).to_3x3()
                p["chest"] = skel.euler_of(Ph.inverted() @ new, p.get("chest"))
        return p
    return anim.Clip(clip.name, clip.frames, clip.loop, sample, impact=clip.impact, secondary=clip.secondary,
                     meta=clip.meta)


def clip_overrides(ctx) -> dict:
    """Brief §8 gestures (weapon none: the stone fists). Impact at exactly 40 %.
      idle      the guard (fists at chest height, elbows out), breathing, the weight rolling foot to foot, looking
      run       heavy ~15 degree lean (head over hips), fists pumping at the ribs (the generator's planted feet)
      attack1/2 a right / left hook at head height from a torso twist (40 f, contact f16)
      cast_a1   Plant Shard: reach back over the right shoulder for a shard, then a deep lunge (the rear knee to
                the ground) and a two-handed stab that drives both fists to the ground (35 f, f14), hold, rise
      cast_a2   Shoulder the Stone: a low shoulder charge, right shoulder dropped forward, left fist back (25 f, f10)
      cast_a3   Stand Firm (castTime 0): forearms crossed before the face by f3, the gauntlets clack at f10 (25 f)
      cast_ult  Felled Shard: both gauntlets rise OVER the head (fists above the rack), onto the toes, head and
                rack tipping back (f0-f14), at f20 a two-fisted hammer heave forward and down with a stamp (50 f)
      channel   both fists low before the hips, a slow heavy sway (never frozen)
      death     a kneeling collapse forward onto the fists, the forearms fold to the floor, AT REST (knees, shins,
                forearms on the ground; the rack drops last)
      recall    kneels, sits back and sets both fists on the ground, listening: slow breath, head turning
      stunned   a stagger: hips lurching, a foot shuffle, the head lolling (the rack sways ~3 degrees)
      idle_lobby, victory (chin level in the final crossed-arms hold, the splash pose)
    Every clip goes through `grounded` (nothing under the floor; the review measured -0.17 m in death)."""
    anim.FISTS = dict(FISTS)                       # this Blender process builds only Hesmi
    prof = MOTION
    skel = anim.Skeleton(ctx.info.armature)
    g = anim.guard(prof)
    gf = g["ik"]
    HT, FT = anim.HandTarget, anim.FootTarget
    hip_h = ctx.info.armature.data.bones["hips"].head_local.z      # (portraits.py passes a RigInfo without joints)

    def feet(dl=(0, 0, 0), dr=(0, 0, 0), pl=None, pr=None, yl=None, yr=None):
        fl, fr = gf["foot.L"], gf["foot.R"]
        return {"foot.L": FT(tuple(fl.ankle[i] + dl[i] for i in range(3)), fl.pitch if pl is None else pl,
                             fl.yaw if yl is None else yl),
                "foot.R": FT(tuple(fr.ankle[i] + dr[i] for i in range(3)), fr.pitch if pr is None else pr,
                             fr.yaw if yr is None else yr)}

    def pose(torso=None, hips=(0.0, 0.0, 0.0), R=None, L=None, ft=None, base=None):
        b = base or g
        p = anim.add(b, anim.P(**torso)) if torso else dict(b)
        ik = dict(b["ik"])
        if R:
            ik["hand.R"] = HT(rel=R[0], pole=R[1])
        if L:
            ik["hand.L"] = HT(rel=L[0], pole=L[1])
        if ft:
            ik.update(ft)
        p["ik"] = ik
        hx, hy, hz = b.get("hips_loc", (0.0, 0.0, 0.0))
        p["hips_loc"] = (hx + hips[0], hy + hips[1], hz + hips[2])
        return p

    def to_pos(q):
        """the pose with its hands' rel targets resolved to absolute positions (keys that switch between rel and
        pos targets jump half way through the segment: HandTarget.lerp swaps the mode at t 0.5)"""
        from mathutils import Vector
        q = dict(q)
        ik = dict(q.get("ik", {}))
        base = dict(q)
        base["ik"] = {k_: v_ for k_, v_ in ik.items() if k_.startswith("foot")}
        M = skel.fk(anim.resolve(skel, base))
        Rc = M["chest"].to_3x3() @ skel.rest["chest"].to_3x3().inverted()
        for sd in ("R", "L"):
            h = ik.get(f"hand.{sd}")
            if h is None or h.rel is None:
                continue
            up_, fo_ = f"upper_arm.{sd}", f"forearm.{sd}"
            Lr = skel.length[up_] + skel.length[fo_]
            sh = (M[skel.parent[up_]] @ skel.local[up_]).translation
            tgt = sh + Rc @ (Vector(h.rel) * Lr)
            ik[f"hand.{sd}"] = HT(pos=tuple(tgt), pole=h.pole, weight=h.weight)
        q["ik"] = ik
        return q

    def strike(name, N, wind, hit, fol, lags=None):
        return anim.Clip(name, N, False, anim.drag(anim.keyed(anim.strike_keys(prof, wind, hit, fol, g)), N,
                                                   lags or {"head": 1.5, "neck": 1.0}), impact=anim.IMPACT)

    out = {}
    PR, PL = (-0.85, 0.30, -0.40), (0.85, 0.30, -0.40)

    # idle (fix pass 3): the braced guard, fists up before the chest, ALIVE: two heavy breaths (chest, shoulders and
    # fists rise together), the weight rolling from foot to foot (hips 3.5 cm side to side, a knee dip as it lands),
    # a slow look left / right under the hood, the fists working in the guard; the rack within 3 degrees
    def idle(t):
        b = anim.osc(t, 2)
        sw = anim.osc(t, 1, 0.1)
        look = anim.osc(t, 1, 0.35)
        dip = 0.5 + 0.5 * anim.osc(t, 2, 0.35)
        d = anim.P(chest=(-6.0 + 1.6 * b, 1.2 * sw, -0.8 * sw), spine=(-2.0 + 0.6 * b, 0.8 * sw, 1.4 * sw),
                   neck=(5.0 - 1.4 * b, 3.0 * look, 0), head=(-1.0 * b, 7.0 * look, 1.5 * sw),
                   shoulder_L=(0, 0, 4.0 * b), shoulder_R=(0, 0, -4.0 * b), hips=(0, 2.5 * sw, -3.0 * sw))
        p = anim.add(g, d)
        ik = dict(p["ik"])
        for sd, ph, sx in (("R", 0.08, -1.0), ("L", 0.15, 1.0)):
            h = ik[f"hand.{sd}"]
            ik[f"hand.{sd}"] = HT(rel=(h.rel[0] + 0.03 * sx * anim.osc(t, 1, ph + 0.2), h.rel[1] - 0.04 * anim.osc(t, 1, ph),
                                       h.rel[2] + 0.06 * anim.osc(t, 2, ph)), pole=h.pole)
        p["ik"] = ik
        hx, hy, hz = p.get("hips_loc", (0.0, 0.0, 0.0))
        p["hips_loc"] = (hx + 0.035 * sw, hy, hz - 0.012 * (0.5 + 0.5 * b) - 0.018 * dip)
        return p
    out["idle"] = anim.Clip("idle", 72, True, idle)

    # run: the generator's planted feet (exact speed), toe-off roll halved for the long boot; a heavier forward
    # lean and the fists pumping at the ribs instead of swinging at the hips
    run = anim.gen_run(prof)

    def run_sample(t):
        # the heavy lean comes from the hips; the chest counter-rotates so the rack stays near level (brief §8)
        # fix pass 3: the brief's 13 degree heavy lean (head over hips; it measured 6-7): the hips and spine lean
        # in, the chest counter-rotates only part of it, the neck drives the hood forward
        p = anim.add(dict(run.sample(t)), anim.P(hips=(RUN_LEAN[0], 0, 0), spine=(RUN_LEAN[1], 0, 0),
                                                 chest=(RUN_LEAN[2], 0, 0), neck=(RUN_LEAN[3], 0, 0), head=(RUN_LEAN[4], 0, 0)))
        ik = dict(p["ik"])
        for k in ("foot.L", "foot.R"):
            f = ik[k]
            if f.ankle[2] <= 1e-6 and f.pitch < 0:
                ik[k] = FT(f.ankle, f.pitch * 0.45, f.yaw, f.toe, f.knee, f.weight)
        for sd, sx in (("R", -1.0), ("L", 1.0)):
            h = ik.get(f"hand.{sd}")
            if h is not None and h.rel is not None:
                fwd = -h.rel[1]                    # + = this fist forward
                ik[f"hand.{sd}"] = HT(rel=(h.rel[0] * 0.5 - sx * 0.04, h.rel[1] * 1.15, -0.42 + 0.30 * max(0.0, fwd)),
                                      pole=(sx * 0.85, 0.45, -0.3))
        p["ik"] = ik
        return p
    out["run"] = anim.Clip("run", run.frames, True, run_sample, meta=run.meta)

    # attack1 / attack2 (fix pass 4: they read as shadow-boxing: the fist 0.64 m ahead, an 11 degree lean, no step, and
    # attack2 an exact mirror). attack1: a right HOOK that steps in on the left foot, the weight thrown into it, the arm
    # long at shoulder height and the head on the target. attack2: a LEFT UPPERCUT-HOOK from a dip, stepping in on the
    # right foot, the fist rising from the hip to chin height, elbow down; a different arc and timing of the weight,
    # not a mirror. 40 frames, contact f16.
    # W5b (combat m-2, the review: the fist travelled 0.61 m over a 13-frame wind-up, against ~3 m of blade tip for
    # Kemdo and Marund; r12 M5: three readable poses, the weapon travels >= 0.6x the fighter's height): a real wound-
    # back and a whip. The wind-up COILS the whole body away (hips, spine and chest ~45 degrees round, the weight on the
    # back foot, the striking fist drawn back past the hip), reaches it by 17 % and HOLDS it (a slow drift, never a
    # freeze) to 34.5 %; the hips lead the drive; the fist then crosses the whole arc in the last 5.5 % before the
    # contact (two game frames at the sim's 0.40-0.45 s wind-up) with a step in, and follows through across the body.
    # Measured in game frames (proto-free: the clip time-scaled so its 40 % lands on the wind-up) in the W5b report.
    def punch_keys(wind, hit, fol, lead):
        """Hesmi's punch timing (impact at exactly 40 %): guard, counter, wound-back by 0.17, a moving hold to 0.31,
        the hips-first drive at 0.345 (the striking fist still back), the whip to the contact at 0.40, the impact
        hold, the follow-through and the settle. `lead`: the striking hand ('hand.R' / 'hand.L')."""
        hv = anim.HEAVY[prof["weight"]]
        still = {"hand.R": 0.0, "hand.L": 0.0, "foot.L": 0.0, "foot.R": 0.0}
        counter = anim._with_hips(anim.lerp_pose_w(g, wind, -0.12, still), (0.0, 0.0, -0.012 * hv))
        coil = anim.lerp_pose_w(g, wind, 1.06, {"foot.L": 1.0, "foot.R": 1.0})
        drive = anim.lerp_pose_w(coil, hit, 0.10, {"hips": 0.55, "spine": 0.40, "chest": 0.22, "hips_loc": 0.45,
                                                     "foot.L": 0.75, "foot.R": 0.75, "thigh.L": 0.6, "thigh.R": 0.6,
                                                     lead: 0.04})
        hit2 = anim._with_hips(hit, (0.0, 0.0, -0.020 * hv))
        hold = anim._with_hips(anim.lerp_pose(hit, fol, 0.25), (0.0, 0.0, -0.026 * hv))
        fol2 = anim._with_hips(anim.lerp_pose_w(hit, fol, 1.0, {"head": 0.6, "neck": 0.7}), (0.0, 0.0, -0.010 * hv))
        rec = anim.lerp_pose(fol, g, 0.5)
        return [(0.0, g, "linear"), (0.05, counter, "inout"), (0.17, wind, "inout"), (0.31, coil, "out"),
                (0.345, drive, "in"), (anim.IMPACT, hit2, "accel"), (0.46, hold, "out"), (0.58, fol2, "out"),
                (0.78, rec, "inout"), (1.0, g, "settle")]

    def punch(name, wind, hit, fol, lead, lags):
        return anim.Clip(name, 40, False, anim.drag(anim.keyed(punch_keys(wind, hit, fol, lead)), 40, lags),
                         impact=anim.IMPACT)

    w1 = pose(dict(hips=(2, -14, 0), spine=(-1, -12, 3), chest=(-3, -18, 4), neck=(0, 14, 0), head=(0, 18, 0)),
              (0.03, 0.08, -0.05), R=ATK1_WIND, L=((0.12, -0.72, -0.22), (0.85, 0.30, -0.40)),
              ft=feet(dl=(0, -0.02, 0), dr=(0, 0.06, 0)))
    h1 = pose(dict(hips=(9, 9, 0), spine=(6, 7, -2), chest=(4, 9, -5), neck=(-6, -6, 0), head=(-10, -10, 0)),
              (-0.02, -0.22, -0.08), R=ATK1_HIT, L=((0.18, -0.40, -0.30), (0.85, 0.30, -0.40)),
              ft=feet(dl=(0.03, -0.32, 0), dr=(0, 0.02, 0), pr=-14))
    f1 = pose(dict(hips=(10, 14, 0), spine=(6, 10, -2), chest=(4, 14, -6), neck=(-6, -10, 0), head=(-10, -14, 0)),
              (-0.03, -0.24, -0.08), R=ATK1_FOL, L=((0.20, -0.38, -0.32), (0.85, 0.30, -0.40)),
              ft=feet(dl=(0.03, -0.32, 0), dr=(0, 0.02, 0), pr=-14))
    out["attack1"] = punch("attack1", w1, h1, f1, "hand.R", {"head": 1.0, "neck": 0.5, "hand.L": 2.0})
    w2 = pose(dict(hips=(6, 14, 0), spine=(6, 12, 4), chest=(8, 18, 6), neck=(-2, -14, 0), head=(-2, -16, 0)),
              (-0.02, 0.06, -0.10), L=ATK2_WIND, R=((-0.10, -0.62, -0.18), (-0.85, 0.30, -0.40)),
              ft=feet(dr=(0, -0.02, 0), dl=(0, 0.06, 0)))
    h2 = pose(dict(hips=(9, -10, 0), spine=(5, -8, -3), chest=(1, -10, -5), neck=(-4, 6, 0), head=(-8, 10, 0)),
              (0.02, -0.20, -0.01), L=ATK2_HIT, R=((-0.16, -0.42, -0.26), (-0.85, 0.30, -0.40)),
              ft=feet(dr=(-0.02, -0.28, 0), dl=(0, 0.02, 0), pl=-12))
    f2 = pose(dict(hips=(9, -14, 0), spine=(5, -11, -3), chest=(0, -15, -5), neck=(-4, 9, 0), head=(-8, 13, 0)),
              (0.02, -0.21, 0.01), L=ATK2_FOL, R=((-0.18, -0.40, -0.28), (-0.85, 0.30, -0.40)),
              ft=feet(dr=(-0.02, -0.28, 0), dl=(0, 0.02, 0), pl=-12))
    out["attack2"] = punch("attack2", w2, h2, f2, "hand.L", {"head": 1.5, "neck": 0.8, "hand.R": 2.5})

    # cast_a1 Plant Shard (castTime 0.3 s). In game only the clip's first 40 % plays (time-scaled to the cast, then a
    # 0.1 s fade to idle), so the READABLE pose arrives early: the reach back to the rack by f4, the drive by f9, the stab
    # at the impact f14 (t 0.40), held to f24, rise by f35. Fix pass 4 (it read as a head-first ram: a 72 degree fold,
    # the rack flat at the target, the fists under the hood): a deep LUNGE on the left foot, the rear knee down, the
    # torso at ~48 degrees with the head up on the target, both arms driven straight down-forward to the ground AHEAD of
    # the hood (her short arms reach ~0.3 m off the ground at this lean: the shard itself is the VFX at the target).
    # Every key's hands are absolute positions (no rel/pos swap mid-segment).
    reach = pose(dict(hips=(-2, -10, 0), spine=(-4, -7, 0), chest=(-6, -10, 0), head=(-4, 10, 0)), (0, 0.04, 0.02),
                 R=((0.32, 0.22, 0.80), (-0.5, -0.4, 0.75)), L=((0.08, -0.50, -0.50), PL))
    lunge_deep = feet(dl=(0.03, -0.52, 0.0), dr=(0.0, 0.40, 0.0), pr=-60)
    drive = pose(dict(hips=(12, 3, 0), spine=(6, 1, 0), chest=(4, 1, 0), neck=(-8, 0, 0), head=(-8, 0, 0)), (0, -0.10, -0.16),
                 R=((0.30, -0.80, 0.30), (-0.9, 0.2, 0.1)), L=((-0.30, -0.80, 0.30), (0.9, 0.2, 0.1)),
                 ft=feet(dl=(0.02, -0.40, 0.0), dr=(0.0, 0.18, 0.0), pr=-24))
    plant = pose(dict(hips=(PLANT[0] * 0.55, 3, 0), spine=(PLANT[0] * 0.25, 1, 0), chest=(PLANT[0] * 0.20, 1, 0),
                      neck=(-22, 0, 0), head=(-18, 0, 0)), (0, -0.20, -PLANT[1]), ft=lunge_deep)
    plant["ik"]["hand.R"] = HT(pos=(-0.10, PLANT[2], 0.25), pole=(-0.9, 0.35, 0.1))
    plant["ik"]["hand.L"] = HT(pos=(0.08, PLANT[2] - 0.02, 0.26), pole=(0.9, 0.35, 0.1))
    plant2 = anim.add(plant, anim.P(hips=(2, 0, 0), chest=(1, 0, 0)))
    plant2["hips_loc"] = (0.0, -0.21, -PLANT[1] - 0.02)
    reach, drive = to_pos(reach), to_pos(drive)
    gp = to_pos(g)
    keys = [(0.0, gp, "linear"), (0.11, reach, "out"), (0.26, drive, "accel"), (0.40, plant, "out"), (0.48, plant2, "out"),
            (0.69, plant2, "linear"), (0.86, anim.lerp_pose(plant2, gp, 0.65), "inout"), (1.0, gp, "settle")]
    a1 = anim.Clip("cast_a1", 35, False, anim.drag(anim.keyed(keys), 35, {"head": 1.0, "neck": 0.5}), impact=anim.IMPACT)
    # (the last frames hand back to the guard's rel targets)
    out["cast_a1"] = anim.Clip("cast_a1", 35, False, lambda t: g if t >= 0.999 else a1.sample(t), impact=anim.IMPACT)

    # cast_a2 Shoulder the Stone
    wind = pose(dict(hips=(6, 12, 0), spine=(6, 10, 0), chest=(6, 12, 0), head=(-6, -14, 0)), (0, 0.04, -0.05),
                R=((0.30, -0.40, -0.40), (-0.9, 0.1, -0.3)), L=((0.20, 0.20, -0.75), (0.8, 0.3, -0.3)))
    hit = pose(dict(hips=(22, 18, 0), spine=(10, 10, 0), chest=(8, 14, -6), neck=(-8, -8, 0), head=(-14, -14, 0)),
               (0, -0.22, -0.12), R=((0.38, -0.42, -0.30), (-0.9, 0.0, -0.3)), L=((0.28, 0.45, -0.70), (0.8, 0.3, -0.3)),
               ft=feet(dl=(0.0, -0.30, 0.0), dr=(0.0, 0.16, 0.02), pr=-14))
    fol = pose(dict(hips=(24, 20, 0), spine=(11, 11, 0), chest=(9, 15, -6), neck=(-8, -8, 0), head=(-15, -15, 0)),
               (0, -0.25, -0.13), R=((0.38, -0.44, -0.30), (-0.9, 0.0, -0.3)), L=((0.30, 0.48, -0.68), (0.8, 0.3, -0.3)),
               ft=feet(dl=(0.0, -0.32, 0.0), dr=(0.0, 0.18, 0.02), pr=-14))
    out["cast_a2"] = strike("cast_a2", 25, wind, hit, fol)

    # cast_a3 Stand Firm (castTime 0: 3 frames to the X, the clack at f10)
    wide = feet(dl=(0.08, 0.0, 0.0), dr=(-0.08, 0.0, 0.0))
    # (fix pass 3: the fists met before the face with the forearms upright, a prayer, not the brief's X): the elbows
    # thrown OUT and the shoulders drawn in, so the gauntlet slabs cross diagonally before the chin
    PRX, PLX = (-0.95, 0.05, -0.30), (0.95, 0.05, -0.30)
    SH = dict(shoulder_R=(0, XSH, 0), shoulder_L=(0, -XSH, 0))
    xo = pose(dict(hips=(2, 0, 0), spine=(-2, 0, 0), chest=(-4, 0, 0), head=(4, 0, 0), **SH), (0, 0.0, -0.02),
              R=((XREL[0], XREL[1], XREL[2]), PRX), L=((-XREL[0], XREL[1] - 0.05, XREL[2] + 0.02), PLX), ft=wide)
    clack = pose(dict(hips=(2, 0, 0), spine=(-4, 0, 0), chest=(-7, 0, 0), neck=(2, 0, 0), head=(6, 0, 0), **SH), (0, 0.0, -0.06),
                 R=((XREL[0] + 0.06, XREL[1] + 0.06, XREL[2] + 0.06), PRX),
                 L=((-XREL[0] - 0.06, XREL[1] + 0.01, XREL[2] + 0.08), PLX), ft=wide)
    recoil = pose(dict(hips=(3, 0, 0), spine=(-3, 0, 0), chest=(-5, 0, 0), neck=(2, 0, 0), head=(5, 0, 0), **SH), (0, 0.0, -0.075),
                  R=((XREL[0] + 0.04, XREL[1] + 0.04, XREL[2] + 0.03), PRX),
                  L=((-XREL[0] - 0.04, XREL[1] - 0.01, XREL[2] + 0.05), PLX), ft=wide)
    keys = [(0.0, g, "linear"), (0.12, xo, "out"), (0.40, clack, "accel"), (0.46, recoil, "out"), (0.80, clack, "inout"),
            (1.0, g, "settle")]
    out["cast_a3"] = anim.Clip("cast_a3", 25, False, anim.drag(anim.keyed(keys), 25, {"head": 1.0}), impact=anim.IMPACT)

    # cast_ult Felled Shard: the TALL COMB (brief §8): both gauntlets rise overhead, fists together above the rack's
    # cut, onto the toes, head and rack tipping back (f0-f14); at f20 a two-fisted hammer heave forward and down
    crouch = pose(dict(hips=(8, 0, 0), spine=(8, 0, 0), chest=(6, 0, 0), head=(6, 0, 0)), (0, 0.02, -0.08),
                  R=((0.25, -0.55, -0.70), PR), L=((-0.25, -0.55, -0.70), PL))
    UP_R, UP_L = (-1.0, 0.30, 0.10), (1.0, 0.30, 0.10)
    up = pose(dict(hips=(-4, 0, 0), spine=(-6, 0, 0), chest=(-8, 0, 0), neck=(-4, 0, 0), head=(-8, 0, 0),
                   shoulder_L=(0, 0, ULT_SHRUG), shoulder_R=(0, 0, -ULT_SHRUG)), (0, 0.03, 0.06),
              R=((0.34, -0.12, 0.89), UP_R), L=((-0.34, -0.12, 0.89), UP_L),
              ft=feet(dl=(0, 0, 0.05), dr=(0, 0, 0.05), pl=-18, pr=-18))
    up2 = pose(dict(hips=(-5, 0, 0), spine=(-7, 0, 0), chest=(-10, 0, 0), neck=(-5, 0, 0), head=(-10, 0, 0),
                    shoulder_L=(0, 0, ULT_SHRUG * 1.1), shoulder_R=(0, 0, -ULT_SHRUG * 1.1)), (0, 0.035, 0.07),
               R=((0.35, -0.09, 0.90), UP_R), L=((-0.35, -0.09, 0.90), UP_L),
               ft=feet(dl=(0, -0.06, 0.06), dr=(0, 0, 0.06), pl=-18, pr=-20))
    # the heave: a 20 degree lean (brief), the arms thrown out level before her, fists together (a hammer throw), so
    # the release reads as arms flung FORWARD, not a bow (it looked like the Plant Shard stab and the recall)
    heave = pose(dict(hips=(9, 0, 0), spine=(6, 0, 0), chest=(4, 0, 0), neck=(-6, 0, 0), head=(-8, 0, 0)), (0, -0.10, -0.10),
                 R=((0.30, -0.95, -0.08), PR), L=((-0.30, -0.95, -0.08), PL), ft=feet(dl=(0, -0.16, 0)))
    heave2 = pose(dict(hips=(10, 0, 0), spine=(7, 0, 0), chest=(5, 0, 0), neck=(-6, 0, 0), head=(-8, 0, 0)), (0, -0.11, -0.12),
                  R=((0.30, -0.94, -0.16), PR), L=((-0.30, -0.94, -0.16), PL), ft=feet(dl=(0, -0.16, 0)))
    keys = [(0.0, g, "linear"), (0.07, crouch, "inout"), (0.22, up, "inout"), (0.33, up2, "out"), (0.40, heave, "accel"),
            (0.46, heave2, "out"), (0.64, heave2, "linear"), (0.82, anim.lerp_pose(heave2, g, 0.6), "inout"), (1.0, g, "settle")]
    out["cast_ult"] = anim.Clip("cast_ult", 50, False, anim.drag(anim.keyed(keys), 50, {"head": 1.5, "neck": 1.0}),
                                impact=anim.IMPACT)

    # channel: fists low before the hips, a slow heavy sway (the review measured it frozen)
    ch = pose(dict(spine=(4, 0, 0), chest=(4, 0, 0), head=(4, 0, 0)), (0, 0.0, -0.03),
              R=((0.22, -0.55, -0.72), PR), L=((-0.22, -0.55, -0.72), PL))

    def channel(t):
        b, s2 = anim.osc(t, 1), anim.osc(t, 2, 0.2)
        p = anim.add(ch, anim.P(chest=(2.0 * s2, 3.0 * b, 0), spine=(1.0 * s2, 2.0 * b, 0), head=(-1.5 * s2, -2.0 * b, 0),
                                hips=(0, -1.5 * b, 0)))
        ik = dict(p["ik"])
        for sd, sx in (("R", -1.0), ("L", 1.0)):
            h = ik[f"hand.{sd}"]
            ik[f"hand.{sd}"] = HT(rel=(h.rel[0], h.rel[1] - 0.06 * s2, h.rel[2] + 0.07 * anim.osc(t, 2, 0.45 if sx > 0 else 0.2)),
                                  pole=h.pole)
        p["ik"] = ik
        return p
    out["channel"] = anim.Clip("channel", 40, True, channel)

    # death (fix pass 4): the brief's kneeling collapse forward onto her fists, ending AT REST - now PRONE (the knelt
    # fold tore the hips open for the whole death timer and read the same as the recall and the victory crouch).
    # Recoil; the knees buckle into a kneel; she pitches forward and catches herself on both fists; the arms give and
    # she slides down flat on her front, the legs straightening out behind; the chest (and the rack on it) comes down
    # last; the hood turned to one side on the ground, the fists by her head; a small settle, rest.
    fk = anim.arms_relaxed()
    recoil = pose(dict(hips=(-6, 6, 0), spine=(-8, 0, 0), chest=(-10, 4, 0), neck=(-8, 0, 0), head=(-12, 6, 0)), (0, 0.05, 0.0),
                  R=((0.0, -0.20, -0.95), PR), L=((0.0, -0.20, -0.95), PL))

    def knelt(hp, sp, ch, nk, hd, tflex, shin, hz, hy=0.0, foot=-30.0, yaw=0.0, roll=0.0, hdyaw=0.0):
        """both knees on the floor: hips / spine / chest / neck / head pitch, the thighs' WORLD flexion (local =
        world + hips pitch), the knee bend, the hips' height above the floor"""
        q = anim.merge(fk, anim.P(hips=(hp, yaw, roll), spine=(sp, 0, 0), chest=(ch, 0, 0), neck=(nk, 0.4 * hdyaw, 0),
                                  head=(hd, 0.6 * hdyaw, 0),
                                  thigh_L=(tflex + hp, 0, -4), shin_L=(shin, 0, 0), foot_L=(foot, 0, 0),
                                  thigh_R=(tflex + hp - 2, 0, 4), shin_R=(shin + 3, 0, 0), foot_R=(foot, 0, 0)))
        q["hips_loc"] = (0.0, hy, hz - hip_h)
        q["ik"] = {}
        return q
    kneel = knelt(8, 6, 4, 6, 12, 2, -100, 0.55, 0.0)
    kneel["ik"] = {"hand.R": HT(rel=(0.05, -0.25, -0.92), pole=PR), "hand.L": HT(rel=(-0.05, -0.25, -0.92), pole=PL)}
    kneel = to_pos(kneel)
    catch = knelt(40, 14, 8, -18, -14, 8, -104, 0.50, -0.16)
    catch["ik"] = {"hand.R": HT(pos=(-0.26, -0.86, 0.16), pole=(-0.9, 0.3, -0.2)),
                   "hand.L": HT(pos=(0.26, -0.84, 0.16), pole=(0.9, 0.3, -0.2))}
    # (the knees slide back as she goes flat: the body ends centred near her root, not 1.6 m ahead of it)
    give = knelt(62, 10, 0, -22, -10, -30, -70, 0.40, -0.26, foot=-40)
    give["ik"] = {"hand.R": HT(pos=(-0.44, -0.94, 0.14), pole=(-0.9, -0.1, -0.4)),
                  "hand.L": HT(pos=(0.44, -0.92, 0.14), pole=(0.9, -0.1, -0.4))}
    down = knelt(DEATH_POSE[0], DEATH_POSE[1], DEATH_POSE[2], -26, -12, DEATH_POSE[3], DEATH_POSE[4], DEATH_POSE[5], -0.28,
                 foot=DEATH_FOOT, yaw=3, roll=4, hdyaw=70.0)
    down["ik"] = {"hand.R": HT(pos=(-0.56, -0.94, 0.145), pole=(-0.8, -0.2, -0.5)),
                  "hand.L": HT(pos=(0.54, -0.96, 0.145), pole=(0.8, -0.2, -0.5))}
    rack_drop = anim.add(down, anim.P(chest=(-12, 0, 0), spine=(-6, 0, 0)))   # the chest and rack still up, then down
    rack_drop["hips_loc"] = (0.0, -0.27, DEATH_POSE[5] - hip_h + 0.03)
    settle = anim.add(down, anim.P(chest=(2, 0, 0), head=(2, 0, 0)))
    keys = [(0.0, g, "linear"), (0.10, recoil, "snap"), (0.28, kneel, "inout"), (0.42, catch, "in"), (0.56, give, "inout"),
            (0.70, rack_drop, "inout"), (0.80, settle, "accel"), (0.88, down, "out"), (1.0, down, "linear")]
    out["death"] = anim.Clip("death", 60, False, anim.keyed(keys))

    # recall (fix pass 4): both knees on the ground (the shin plates down, touching), the body UPRIGHT (the knelt fold
    # tore the hips), the fists set on the thighs, the head bowed, listening: slow breath, the head turning slowly to
    # one side and the other. Her arms (0.59 m) cannot reach the ground from an upright kneel. Distinct from the prone
    # death. (A kneel-DOWN cannot live in the clip: the loop must close and stay under 6 s, three_load_test; the engine
    # crossfades into it in 0.1 s.)
    rk = knelt(RECALL_POSE[0], RECALL_POSE[1], RECALL_POSE[2], 14, 12, RECALL_POSE[3], RECALL_POSE[4], RECALL_POSE[5], 0.0,
               foot=-35.0)
    rk["ik"] = {"hand.R": HT(pos=(-0.30, RECALL_FIST_Y, 0.56), pole=(-0.9, 0.35, -0.2)),
                "hand.L": HT(pos=(0.30, RECALL_FIST_Y, 0.56), pole=(0.9, 0.35, -0.2))}
    RN = 90

    def recall(t):
        b = anim.osc(t, 3)
        turn = anim.osc(t, 1, 0.25)
        tilt = anim.osc(t, 2, 0.1)
        p = anim.add(rk, anim.P(chest=(-2.0 * b, 2.0 * turn, 0), spine=(-1.0 * b, 1.5 * turn, 0), neck=(2.0 * tilt, 9.0 * turn, 3.0 * turn),
                                head=(-2.5 * b + 3.0 * tilt, 15.0 * turn, 8.0 * turn), shoulder_L=(0, 0, 4.0 * b),
                                shoulder_R=(0, 0, -4.0 * b), hips=(0, 1.5 * turn, 0)))
        hx, hy, hz = p["hips_loc"]
        p["hips_loc"] = (hx + 0.01 * turn, hy, hz + 0.012 * b)
        return p
    out["recall"] = anim.Clip("recall", RN, True, recall)

    # dash = SHOULDER THE STONE's charge (the sim plays 'dash' for the 0.35 s, 13 m/s charge after a 0.1 s cast; the
    # generator's arms-swept-back lunge read as a generic dash): the contact pose of cast_a2 driving forward, right
    # shoulder low and leading, chin tucked, the left fist back, two short driving steps; ends still charging
    # (fix pass 4: one frozen pose skated over the 4.5 m): two driving STRIDES under the held charge, left then right
    # foot reaching, the hips bobbing, the trailing fist pumping
    def d_pose(lf, rf, bob, pump):
        return pose(dict(hips=(17, 17, 0), spine=(8, 9, 0), chest=(6, 12, -6), neck=(-8, -7, 0), head=(-14, -12, 0)),
                    (0, -0.22, -0.13 + bob), R=((0.38, -0.44, -0.29), (-0.9, 0.0, -0.3)),
                    L=((0.28 - 0.04 * pump, 0.45 + 0.08 * pump, -0.70 + 0.06 * pump), (0.8, 0.3, -0.3)),
                    ft=feet(dl=lf[0], dr=rf[0], pl=lf[1], pr=rf[1]))
    dk = [(0.0, d_pose(((0.0, -0.34, 0.0), 0), ((0.0, 0.22, 0.03), -24), -0.02, 0), "linear"),
          (0.25, d_pose(((0.0, -0.02, 0.0), 0), ((0.0, -0.06, 0.14), -6), 0.03, 1), "inout"),
          (0.50, d_pose(((0.0, 0.24, 0.03), -24), ((0.0, -0.34, 0.0), 0), -0.02, 0), "inout"),
          (0.75, d_pose(((0.0, -0.06, 0.14), -6), ((0.0, -0.02, 0.0), 0), 0.03, 1), "inout"),
          (1.0, d_pose(((0.0, -0.34, 0.0), 0), ((0.0, 0.22, 0.03), -24), -0.02, 0), "inout")]
    out["dash"] = anim.Clip("dash", 15, False, anim.keyed(dk))
    # stunned (fix pass 3: a 6 cm drift read as nothing): a dazed STAGGER. The hips lurch 7 cm to one side and back with
    # a knee dip, the left foot shuffles out to catch the weight and returns, the torso rolls against the lurch (the
    # chest counter-rolls so the rack sways ~3 degrees, brief), the head lolls 15 degrees, the guard drops and the
    # fists swing loose
    daze = pose(dict(hips=(3, 0, 0), spine=(2, 0, 0), chest=(-2, 0, 0), neck=(10, 0, 0), head=(14, 0, 0)), (0, 0.0, -0.05),
                R=((0.10, -0.32, -0.78), PR), L=((-0.10, -0.32, -0.78), PL))

    def stunned(t):
        a, b = anim.osc(t, 1), anim.osc(t, 1, 0.25)
        dip = 0.5 + 0.5 * anim.osc(t, 2, 0.25)
        step = max(0.0, anim.osc(t, 1, 0.0))                     # the left foot's shuffle (half the loop)
        p = anim.add(daze, anim.P(hips=(2.0 * b, 4.0 * a, 6.0 * a), spine=(2.0 * b, 1.5 * a, -3.5 * a),
                                  chest=(1.5 * b, 0, -2.5 * a), neck=(6 * b, 4 * a, 9 * a), head=(9 * b, 9 * a, 12 * a),
                                  shoulder_L=(0, 0, -4 * a), shoulder_R=(0, 0, -4 * a)))
        ik = dict(p["ik"])
        fl = ik["foot.L"]
        ik["foot.L"] = FT((fl.ankle[0] + 0.07 * step, fl.ankle[1] - 0.03 * step, fl.ankle[2] + 0.05 * math.sin(math.pi * step)),
                          fl.pitch, fl.yaw, fl.toe, fl.knee, fl.weight)
        for sd, sx in (("R", -1.0), ("L", 1.0)):
            h = ik[f"hand.{sd}"]
            ik[f"hand.{sd}"] = HT(rel=(h.rel[0] + 0.10 * a, h.rel[1] - 0.06 * b * sx, h.rel[2] + 0.05 * anim.osc(t, 2, 0.1 if sx > 0 else 0.35)),
                                  pole=h.pole)
        p["ik"] = ik
        hx, hy, hz = p["hips_loc"]
        p["hips_loc"] = (hx + 0.07 * a, hy - 0.02 * b, hz - 0.04 * dip)
        return p
    out["stunned"] = anim.Clip("stunned", 40, True, stunned)

    # idle_lobby: a standing stone
    st = anim.stance(dict(prof, stance="wide"), 0.5)
    rest = dict(st)
    rest["ik"] = {k: v for k, v in st["ik"].items() if k.startswith("foot")}
    rest["ik"]["hand.R"] = HT(rel=(-0.16, -0.14, -0.95), pole=(-0.6, 0.7, -0.2))        # arms hang, fists loose
    rest["ik"]["hand.L"] = HT(rel=(0.16, -0.14, -0.95), pole=(0.6, 0.7, -0.2))

    def lobby(t):
        b = anim.osc(t, 3)
        roll = math.sin(math.pi * min(1.0, max(0.0, (t - 0.16) / 0.18))) ** 2          # shoulder roll 0.16-0.34
        look = math.sin(math.pi * min(1.0, max(0.0, (t - 0.48) / 0.36))) ** 2          # look down 0.48-0.84
        d = anim.P(chest=(1.0 * b - 2.0 * roll, 4.0 * roll, -3.0 * roll), spine=(0.4 * b, 0, -1.5 * roll),
                   shoulder_R=(0, 0, -7.0 * roll), shoulder_L=(0, 0, 2.0 * roll), upper_arm_R=(6.0 * roll, 0, 4.0 * roll),
                   neck=(8.0 * look, -3.0 * look, 0), head=(12.0 * look - 0.6 * b, -4.0 * look, 0),
                   hips=(0, 1.0 * anim.osc(t, 1), 0))
        return anim.add(rest, d)
    out["idle_lobby"] = anim.Clip("idle_lobby", 120, True, lobby)

    # victory: a fist planted on the ground, rise, cross the arms (gauntlets crossed before the chest), chin level
    # (fix pass 3: the fist stopped at 0.55 m; now a deep crouch over the planted fist, which reaches the ground)
    # (fix pass 4: a shallower crouch, the right knee down and the chest rolled to the right so the right fist reaches
    # down toward the ground without the 74 degree fold that tore the hips)
    plant = pose(dict(hips=(24, -10, -6), spine=(12, -6, -8), chest=(8, -6, -8), neck=(-14, 0, 6), head=(-10, 4, 4)),
                 (0, -0.04, -0.42), L=((-0.10, -0.40, -0.60), PL), ft=feet(dl=(0.06, -0.30, 0), dr=(-0.04, 0.30, 0), pr=-55))
    plant["ik"]["hand.R"] = HT(pos=(-0.42, -0.50, 0.22), pole=(-0.8, 0.4, 0.3))     # the fist down to the ground
    # the final hold (fix pass 4): arms crossed, the weight set FORWARD into a wide stance, the chin raised against it:
    # the chest leans ~17 degrees so the rack's three level cut tops tip toward the viewer and catch the light (the
    # splash pose, brief §10: upright, they faced straight up, edge-on to any camera under the rack)
    cross = pose(dict(hips=(5, 0, 0), spine=(6, 0, 0), chest=(6, 0, 0), neck=(-8, 0, 0), head=(-9, 0, 0)), (0, 0.04, -0.01),
                 R=((0.66, -0.62, -0.44), (-0.9, 0.1, -0.4)), L=((-0.64, -0.50, -0.36), (0.9, 0.1, -0.4)),
                 ft=feet(dl=(0.07, -0.05, 0), dr=(-0.07, 0.06, 0)))
    over = anim.add(cross, anim.P(chest=(-3, 0, 0), head=(-3, 0, 0)))
    base = anim.keyed([(0.0, g, "linear"), (0.20, plant, "inout"), (0.30, plant, "linear"), (0.52, over, "out"),
                       (0.62, cross, "inout"), (1.0, cross, "linear")])

    def vic(t):
        p = base(t)
        if t > 0.62:
            k = min(1.0, (t - 0.62) / 0.12)
            p = anim.add(p, anim.P(chest=(0.8 * k * anim.osc(t, 2), 0, 0)))
        return p
    out["victory"] = anim.Clip("victory", 60, False, anim.drag(vic, 60, {"head": 2.0, "neck": 1.0}))
    for k_ in ("idle", "run", "stunned", "cast_a3"):
        out[k_] = level_chest(out[k_], skel)
    return {k: (v if k == "run" else grounded(v, skel)) for k, v in out.items()}


try:
    _install_render()      # also when portraits.py imports this module (re-renders from the cache)
except Exception:          # (the venv fit tools import this module with Blender stubbed out)
    pass

if __name__ == "__main__":
    _install_bind()
    _install_paint()
    fighter.main(sys.modules[__name__])
