"""kemdo: Burning glass (Breaker, Hourless). ART 2.0: sculpted volumes painted by concept projection.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/kemdo_plates.py --height 2.38   # plates
    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/kemdo_fit.py
    python3 art/build.py fighter kemdo --no-skins --clip-sheet

Brief: _design/fighters/kemdo.md. Concept: _design/concept/kemdo.webp (front + back, hand-painted).
The forms are numpy SDF volumes (common/hifi/sdf.py) fitted to the concept on a 10 cm grid (the fit
overlay: proto/kemdo_fit.py); the base colour is the concept painting itself, projected occlusion-aware
onto the game mesh (common/hifi/project.py via the pipeline's PROJECTION hook); normals and AO bake
from the sculpt.

Where the concept and the brief disagree the concept's proportions win (it is the approved look): the
glaive is 2.37 m (butt blade on the ground to the spear point at 2.40 m), carried 4.6 degrees off
vertical with the lens frame (0.30 m) beside the hood; the right fist holds the haft at 1.15 m with the
forearm reaching forward; the left arm hangs with a closed fist; the layered pauldron is on the LEFT
shoulder, the scarf over the right. The brief wins on what is banned: the concept's blue studs round
the lens (gems) become one continuous `accent` ring set in the frame (front and back faces), and the
lens is tilted 20 degrees toward the sky (the frame is drawn taller so its front projection still
matches the painted disc) so it reads as a bright ellipse from the 52 degree camera.

Not in the shared pipeline, implemented here (module-level wrappers; common/ untouched):
  * the right arm's rest pose. rig.proportions is symmetric, the concept is not (right forearm forward on the
    haft); rig_extras re-places upper_arm.R / forearm.R / hand.R and points prop.R up the haft (prop +Y = the
    glaive's axis, +Z = the lens's facing).
  * THE BIND POSE LOWERS THE GLAIVE (brief: art.height is the hood crown, 2.10 m, never the glaive tip). The
    model is sculpted, bound, painted and baked in the concept's carry; right after the bake (pipeline.split_forms
    wrapper) the right fist, the glaive, prop.R and its sockets are turned 62 degrees forward about the wrist, so
    the bind-pose top (art.json height, the three.js load-test gate, the health bar) is the hood crown. Every clip
    adds the inverse turn to hand.R before the IK (finisher), so the poses are exactly the concept-carry ones; the
    paint_object wrapper turns the glaive back for a re-paint on the cached .blend (proto/kemdo_paint.py).
  * prop.R location tracks ("prop.R_loc"): the glaive slides through the fist (Heat Shimmer's drag, the Long
    Thrust's reach) or is let go and stands / falls on its own (Vent's planted centre post, the death's fall).
    anim.Skeleton.basis / write_action / apply_pose are wrapped to carry it.
"""
from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy  # noqa: E402,F401
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

from common import anim, fighter, imageops, materials, render as _render, rig, scene  # noqa: E402
from common import mesh as _mesh, pipeline as _pipeline  # noqa: E402
from common.anim import Aim, FootTarget, HandTarget  # noqa: E402
from common.hifi import project as _project, sdf  # noqa: E402
from common.hifi.sdf import (Blend, Capsule, Ellipsoid, FlatCapsule, HalfSpace, Lathe, Prim, RoundBox,  # noqa: E402
                             RoundCone, Sculpt, Sphere, Torus, Tube)

V = Vector
ID = "kemdo"
TITLE = "Burning glass"
ROLE_MASS = "breaker"
ORIGIN = "hourless"
CARD = {"primary": "#8A7A66", "secondary": "#D7C9A6"}

# rig fitted to the sculpt: crown 2.10 (the hood's skull), skull base 1.81, shoulders x 0.31 at 1.60,
# left elbow (0.33, 1.31), left wrist (0.35, 1.05), hips x 0.12 at 0.98, knees 0.54, ankles x 0.195 at 0.10
PROPORTIONS = rig.proportions(height=2.10, head=0.34, neck=0.07, shoulder_width=0.62, hip_width=0.24, leg=0.88,
                              thigh_frac=0.50, arm=0.56, upper_arm_frac=0.52, hand=0.19, foot=0.30,
                              ankle_height=0.10, spine_curve=0.02, stance=0.075, toe_out_deg=12.0, knee_bend=0.014,
                              a_pose_deg=87.5, arm_forward_deg=3.0, elbow_bend_deg=10.0, shoulder_drop=0.138)
MATERIAL_SET = "bible"
PALETTE = materials.bible_palette(cloth2="#D8CEB8", sandstone="#CDB996", cloth="#9A8D7C", stone="#C4BCA9",
                                  dawnglass="#C3D8E6", wood="#B79C7F", leather="#4F4034", under="#3B3532",
                                  ironstone="#483F38", ink="#17181B", accent="#3F9CFF")
VALUE_GRADIENT_STOPS = materials.BIBLE_GRADIENT_STOPS
SOCKETS = {"weapon": "prop.R", "weapon_tip": "x_blade_tip", "lens": "x_lens", "vent": "x_vent_chest"}
SPLASH = {"map": "map_rift", "clip": "cast_ult", "t": 0.6, "fill": 0.9, "x": 0.66, "yaw": 30.0, "rim_cool": 0.35, "rim_warm": 0.45, "sun": 3.6,
          "portrait_clip": "idle", "portrait_t": 0.0, "portrait_yaw": 22.0, "icon_yaw": 18.0}
TEXTURE_SIZE = 2048
TEXTURE_SIZES = {"normal": 512, "orm": 384}         # ORM 384: GLB headroom for the bigger head (AO + roughness only)
GLB_COMPRESS = True
ARMOUR_CONFORM = False
AO_INTO_BASE = 0.25

# ART 2.0 skins re-colour the projected painting part by part, plus skin-only extras painted flat (SKIN_FLAT part
# -> role). Palettes: _design/fighters/kemdo.md section 9, pushed further where the review found them too close to
# the base (Highrim moved only 2-4 L* on two cloth roles: invisible). Kemdo's recolour (wrapped below) moves each
# part's MEASURED painted mean onto the skin colour (the shared one scales by the authored base role colour, which
# the painting does not match: the trousers came out lavender, the steel-painted plates blue-violet), and reads
# per-part skin roles (SKIN_PART_ROLES) so the shoulder cowl, the skirt and the plates can differ.
SKIN_PART_ROLES = {"cowl": "cloth_top", "pauldron_1": "plate", "pauldron_2": "plate", "pauldron_3": "plate",
                   "vambrace": "plate", "glaive_blade": "ironstone", "glaive_collar": "stone", "hood": "hood",
                   "glaive_butt": "wood"}
# Hues are authored a little off the brief's where the warm map sun shifts them on screen (measured on the splash):
# Highrim's sand stays at hue 35-38 (no peach), its hood a warm bone (not white); Long Evening's hood is lilac
# enough to survive the warm key, its trousers plum (not violet).
SKINS: list = [
    # Highrim: wind-scoured grey sand wraps, a warm bone hood (not white), pale linen, a pale sandstone frame
    {"id": "kemdo_highrim", "extra": {}, "card": {"primary": "#7A6C58", "secondary": "#DCD3C2"},
     "palette": {"cloth2": "#D9CFBC", "hood": "#C8B898", "cloth": "#9A8B76", "cloth_top": "#B2A48D", "stone": "#CDBB9C",
                 "under": "#46403A", "leather": "#58483A", "plate": "#A49A8C", "wood": "#C2AE92"}},
    # Long Evening: plum wraps (the identity plum on the shins, a deeper plum skirt, lilac-plum on the shoulders), a
    # lilac hood, a smoked-amber frame, a lilac lens, plum-dark leather and plates
    {"id": "kemdo_long_evening", "extra": {"tassel_plates": True}, "card": {"primary": "#4A3550", "secondary": "#B9A6D6"},
     "palette": {"cloth2": "#D3C6D3", "hood": "#C6B2CC", "cloth": "#74567A", "cloth_top": "#A28AA6", "stone": "#9C8566",
                 "dawnglass": "#B9A6D6", "wood": "#B7A08A", "under": "#5B3A5E", "ironstone": "#3E2B40",
                 "lampresin": "#7A4E70", "leather": "#3C2D34", "plate": "#6E5870"}},
]
SKIN_FLAT = {"tassel_plates": "lampresin"}

# ART 2.0 base re-tone (brief sections 5-6: light head, mid body, dark feet). The concept's own painted light is
# projected and then lit again, so the painting reads 15-25 L* darker on screen than on the sheet; each part's
# painted median is moved onto its brief colour (linear-light gain, painted folds and value structure kept),
# then a soft height ramp. Measured on the projection (proto/kemdo_paint.py): hood L* 33, face 30, cowl 38.
BASE_TONE = {    # part: (target median, hue strength, contrast gamma)
    "hood": ("#B8A585", 1.0, 0.62), "face": ("#D3C7B0", 1.0, 0.6), "brow": ("#C2AD89", 1.0, 0.7),
    "cowl": ("#B1A084", 0.9, 0.72), "sleeves": ("#9D917F", 0.9, 0.6), "shirt": ("#918472", 0.85, 0.6),
    "wrap": ("#89765D", 0.9, 0.8), "robe": ("#83705A", 0.9, 0.8), "panel": ("#9A8E7C", 0.85, 0.6),
    "medallion": ("#B49F79", 1.0, 0.8), "belt": ("#584334", 0.8, 0.85), "trousers": ("#3D3530", 0.6, 0.85),
    "boots": ("#3E3129", 0.6, 0.85), "forearms": ("#56463A", 0.8, 0.8), "hand_R": ("#463B33", 0.8, 0.8),
    "hand_L": ("#463B33", 0.8, 0.8), "glaive_frame": ("#A99D87", 0.9, 0.75), "glaive_wrap": ("#C2B398", 0.9, 0.7),
    "glaive_haft": ("#A28A6C", 0.9, 0.8), "glaive_butt": ("#AE987B", 0.9, 0.75),
    "vambrace": ("#8C847A", 0.9, 0.7), "glaive_collar": ("#A0978A", 0.9, 0.7),
}
VALUE_RAMP = [(0.0, 0.84), (0.30, 0.90), (0.55, 0.98), (0.75, 1.03), (1.0, 1.07)]   # z / 2.10 -> linear gain

HEIGHT = 2.38             # the glaive tip (the projection plates' scale; the hood crown is 2.10)
PROJECTION = {"concept": "kemdo", "height": HEIGHT}
NOISE = sdf.Noise(11)
VOXEL = 0.007

# ── the glaive's axis (world, rest): the haft leans 4.6 degrees out to her right, in the plane y = -0.22 ──
AX0 = np.array([-0.405, -0.22, 0.60])
AXU = np.array([-0.08, 0.0, 1.0]) / math.hypot(0.08, 1.0)
GRIP_Z = 1.15                                  # the right fist's centre on the haft
LENS_Z = 1.93
LENS_TILT = 20.0                               # degrees toward the sky
# the head is the hook (brief: a 40 cm lens in a 46 cm ring, a 0.50 m frame): drawn 1.5x the concept's painted
# head, an oval 1.10x taller than wide like the painting; the lens a domed glass disc (30 x 33 cm), the accent a
# thin band round it (2.8 cm: about 9 % of the lens, the brief's 3 cm on 40 cm)
E_HEAD = 1.10
R_LENS = 0.150                                 # lens, lateral semi-axis (vertical = x E_HEAD on the front view)
RING_IN, RING_OUT = R_LENS - 0.004, R_LENS + 0.028   # the accent band
R_FRAME = 0.240                                # the carved frame's outer edge (48 cm across, 53 cm tall)
TH_IN, TH_OUT = 0.050, 0.040                   # the frame's half thickness at the band / at the rim
COLLAR_Z0, COLLAR_Z1 = 2.18, 2.232             # the stone collar over the frame top (axis heights)
BLADE_Z0, BLADE_L = 2.225, 0.24                # the carved ironstone tip
BLADE_TOP = BLADE_Z0 + BLADE_L
HAFT_Z0 = 1.25                                 # the round haft above the fist; below it the flat pale blade-haft
# bind pose (see the docstring): the fist + glaive turned forward about the wrist after the bake
REST_TILT = 62.0


def axis_at(z: float) -> np.ndarray:
    return AX0 + AXU * ((z - AX0[2]) / AXU[2])


GRIP = axis_at(GRIP_Z)
LENS_C = axis_at(LENS_Z)
LAT = np.cross(AXU, np.array([0.0, -1.0, 0.0]))          # the glaive's lateral axis (~ +X)
LAT /= np.linalg.norm(LAT)
_t = math.radians(LENS_TILT)
LENS_N = np.array([0.0, -math.cos(_t), math.sin(_t)])     # the lens faces front and up
# the lens frame: rows X (lateral), Y (in-plane up), Z (normal); Y is stretched so the tilted disc projects
# to an oval E_HEAD taller than wide on the front view (local radius r = hypot(u, v_front / E_HEAD))
_LF = sdf.frame(LENS_N, LAT)
LENS_FRAME = np.stack([_LF[0], _LF[1] * math.cos(_t) / E_HEAD, _LF[2]])


def head_dir(theta: float) -> np.ndarray:
    """World offset of local radius 1 at angle theta in the lens plane (0 = lateral +X, 90 = up)."""
    return math.cos(theta) * _LF[0] + math.sin(theta) * _LF[1] * E_HEAD / math.cos(_t)


# the painted head on the concept plates (world x, z on the front view; measured on a 1 cm grid)
PAINT_LENS = ((-0.496, 2.018), (0.072, 0.091))           # centre, semi-axes (lateral, vertical)
PAINT_FRAME = ((-0.518, 2.028), (0.130, 0.163))

# right arm rest (concept): the upper arm hangs, the forearm reaches forward-out to the fist on the haft
R_SHOULDER = np.array([-0.31, 0.01, 1.60])
R_ELBOW_DIR = np.array([0.04, 0.10, -1.0])
R_WRIST_AIM = np.array([-0.405, -0.165, 1.19])


# ── sculpt helpers ─────────────────────────────────────────────────────────────────────────────────
class Loft(Prim):
    """Elliptic cone along Z: half-width a, half-depth b, linear from z0 to z1 (centre cx, cy).
    hem(x, y) -> the bottom z (a curved hem); approximate distance."""

    def __init__(self, c, z0, z1, a0, b0, a1, b1, hem=None):
        self.c = np.asarray(c, dtype=np.float64)
        self.z0, self.z1 = float(z0), float(z1)
        self.a0, self.b0, self.a1, self.b1 = a0, b0, a1, b1
        self.hem = hem

    def bounds(self):
        a, b = max(self.a0, self.a1), max(self.b0, self.b1)
        return self.c + np.array([-a, -b, self.z0 - 0.15]), self.c + np.array([a, b, self.z1])

    def d(self, P):
        x, y, z = P[:, 0] - self.c[0], P[:, 1] - self.c[1], P[:, 2]
        t = np.clip((z - self.z0) / (self.z1 - self.z0), 0, 1)
        a = self.a0 + (self.a1 - self.a0) * t
        b = self.b0 + (self.b1 - self.b0) * t
        rad = (np.sqrt((x / a) ** 2 + (y / b) ** 2) - 1.0) * np.minimum(a, b)
        zb = self.hem(x, y) if self.hem is not None else self.z0
        return np.maximum(rad, np.maximum(zb - z, z - self.z1))


class Leaf(Prim):
    """A flat blade along `u` from `base` (length L) in the plane (u, lat), thickness along n:
    half-width w(s) from `widths` (s 0..1 knots), lens-shaped section (thickness th at the spine)."""

    def __init__(self, base, u, lat, L, knots, th, edge=0.003):
        self.o = np.asarray(base, dtype=np.float64)
        self.u = np.asarray(u, dtype=np.float64) / np.linalg.norm(u)
        self.lat = np.asarray(lat, dtype=np.float64)
        self.lat = self.lat - self.u * self.lat.dot(self.u)
        self.lat /= np.linalg.norm(self.lat)
        self.n = np.cross(self.u, self.lat)
        self.L = float(L)
        self.ks = np.array([k[0] for k in knots])
        self.kw = np.array([k[1] for k in knots])
        self.koff = np.array([k[2] if len(k) > 2 else 0.0 for k in knots])
        self.th, self.edge = float(th), float(edge)

    def bounds(self):
        w = float(self.kw.max() + np.abs(self.koff).max()) + self.th
        pts = [self.o + self.u * s + self.lat * a + self.n * b for s in (0, self.L) for a in (-w, w) for b in (-w, w)]
        pts = np.array(pts)
        return pts.min(0), pts.max(0)

    def d(self, P):
        q = P - self.o
        s = q @ self.u
        t = q @ self.lat
        w = q @ self.n
        sn = np.clip(s / self.L, 0, 1)
        hw = np.interp(sn, self.ks, self.kw)
        off = np.interp(sn, self.ks, self.koff)
        t = t - off
        th = self.edge + (self.th - self.edge) * np.clip(1 - np.abs(t) / np.maximum(hw, 1e-4), 0, 1)
        d_t = np.abs(t) - hw
        d_w = np.abs(w) - th
        d_s = np.maximum(-s, s - self.L)
        return np.maximum(np.maximum(d_t, d_w), d_s)


def folds(amp, freq, axis=0, phase=0.0, zfade=None):
    def fn(P):
        u = P[:, axis] * freq + phase + 0.6 * NOISE(P, 3.0)
        a = amp
        if zfade is not None:
            z0, z1 = zfade
            a = amp * np.clip((z0 - P[:, 2]) / (z0 - z1), 0.15, 1.0)
        return a * (np.abs(np.sin(u)) * 2.0 - 1.0) * -0.5
    return fn


def dfolds(amp, freq, n, phase=0.0):
    """Fold ridges running across the direction n (world)."""
    n = np.asarray(n, dtype=np.float64)

    def fn(P):
        u = (P @ n) * freq + phase + 0.5 * NOISE(P, 4.0)
        return amp * (np.abs(np.sin(u)) * 2.0 - 1.0) * -0.5
    return fn


def wraps(amp, freq, axis_pt, axis_u, slant=7.0):
    """Helical wrap ridges round an axis (bands of cloth or leather)."""
    o = np.asarray(axis_pt, dtype=np.float64)
    u = np.asarray(axis_u, dtype=np.float64) / np.linalg.norm(axis_u)

    def fn(P):
        q = P - o
        s = q @ u
        r = q - np.outer(s, u)
        ang = np.arctan2(r[:, 1], r[:, 0])
        return amp * np.clip(np.sin(s * freq + ang * slant / (2 * math.pi) * 2.0), -0.3, 1.0) * -0.7
    return fn


def chips(amp, freq):
    def fn(P):
        return amp * np.clip(NOISE.ridged(P, freq, 3), 0, 1) - amp * 0.3
    return fn


class Boxed(Prim):
    """A prim with explicit bounds (sdf's framed prims under-bound when the frame rows are scaled)."""

    def __init__(self, prim, c, r):
        self.p = prim
        self.lo, self.hi = np.asarray(c, float) - r, np.asarray(c, float) + r
        self.pad = getattr(prim, "pad", 0.0)

    def bounds(self):
        return self.lo, self.hi

    def d(self, P):
        return self.p.d(P)


def band(p0, p1, half_w):
    """Blend-intersection prim: the slab |dist to the plane through p0->p1 (normal in XZ)| < half_w."""
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    d = p1 - p0
    n = np.array([-d[2], 0.0, d[0]])
    n /= np.linalg.norm(n)
    c = (p0 + p1) / 2
    return [("inter", HalfSpace(c + n * half_w, n, 1.5), 0.02), ("inter", HalfSpace(c - n * half_w, -n, 1.5), 0.02)]


# ── binding (not in the shared pipeline: wraps pipeline.bind_part for this fighter's process) ─────────────
# Heat weights on the hanging arms bled upper_arm / forearm / hand weights into the torso sides, the sash and the
# belt (the buckle rode the right hand). The torso cloth is weighted by height instead, the sleeves along the arm,
# each pauldron lame with constant weights, and the skirt / legs by heat without the arm and chest bones.
NO_LEGS_EX = tuple(f"{b}.{s}" for b in ("shoulder", "upper_arm", "forearm", "hand") for s in "LR") + ("chest", "neck", "head")


def _ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _w_torso(P, J):
    x, z = P[:, 0], P[:, 2]
    wh = 1 - _ss(1.10, 1.30, z)
    wc = _ss(1.32, 1.52, z)
    ws = np.clip(1 - wh - wc, 0, 1)
    wn = 0.45 * _ss(1.74, 1.82, z) * (1 - _ss(0.07, 0.12, np.abs(x)))     # the collar mostly rides the chest (arms-up / head-back poses)
    sh = _ss(0.15, 0.25, np.abs(x)) * _ss(1.44, 1.58, z)
    k = (1 - sh) * (1 - wn)
    return {"hips": wh * k, "spine": ws * k, "chest": wc * k, "neck": wn * (1 - sh),
            "shoulder.L": sh * (x > 0), "shoulder.R": sh * (x <= 0)}


def _w_sleeves(P, J):
    out = {}
    for s, sx in (("L", 1.0), ("R", -1.0)):
        m = (P[:, 0] * sx > 0).astype(float)
        j = J[f"upper_arm.{s}"][0]
        e = J[f"forearm.{s}"][0]
        u = e - j
        lu = float(np.linalg.norm(u))
        u /= lu
        d = (P - j) @ u
        wsh = 1 - _ss(-0.05, 0.07, d)
        wf = _ss(lu - 0.07, lu + 0.02, d)
        wu = np.clip(1 - wsh - wf, 0, 1)
        out[f"shoulder.{s}"] = wsh * m
        out[f"upper_arm.{s}"] = wu * m
        out[f"forearm.{s}"] = wf * m
    return out


def _w_forearms(P, J):
    """The forearm wraps along their bone: the upper arm at the elbow, the forearm, the hand at the left wrist.
    No right-hand weight (the bind pose turns the right fist + glaive alone; heat weights also pinched the left
    wrap's wrist and elbow into torn facets when the forearm crossed the chest)."""
    out = {}
    for s, sx in (("L", 1.0), ("R", -1.0)):
        m = (P[:, 0] * sx > 0).astype(float)
        e, w = J[f"forearm.{s}"]
        u = w - e
        lf = float(np.linalg.norm(u))
        u = u / lf
        d = (P - e) @ u
        wu = 1 - _ss(-0.05, 0.05, d)
        wh = _ss(lf + 0.0, lf + 0.06, d) if s == "L" else np.zeros_like(d)    # past the wrist: the wrap under the vambrace stays rigid
        wf = np.clip(1 - wu - wh, 0, 1)
        out[f"upper_arm.{s}"] = wu * m
        out[f"forearm.{s}"] = wf * m
        if s == "L":
            out["hand.L"] = wh * m
    return out


def _bind_weights(arm, obj, how) -> None:
    me = obj.data
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    mw = np.array(obj.matrix_world)
    P = co.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3]
    J = {b.name: (np.array(b.head_local), np.array(b.tail_local)) for b in arm.data.bones}
    if isinstance(how, tuple) and how[0] == "const":
        W = {k: np.full(len(P), v) for k, v in how[1].items() if v > 0}
    else:
        W = {"torso": _w_torso, "sleeves": _w_sleeves, "forearms": _w_forearms}[how](P, J)
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
    if isinstance(b, tuple) and b[0] == "auto_ex":
        return _mesh.bind_auto(obj, ctx.info.armature, exclude=("root", "prop.L", "prop.R") + tuple(b[1]))
    return _orig_bind_part(ctx, part, obj, body_low)


_pipeline.bind_part = _bind_part


# ── paint fixes (not in the shared pipeline: wraps project.paint for this fighter's process) ─────────────
# The projected concept keeps everything it paints; the brief bans some of it and the head is drawn bigger than
# the painting. After the shared projection, per part:
#   glaive_frame  the painted frame annulus (studs inpainted away) warped onto the bigger oval frame, both faces;
#                 the rim and bore sample the face next to them (no grazing-angle streaks)
#   glaive_lens   procedural burning glass (_lens_glass): dark refractive rim, warm inner light, painted hot spot
#   glaive_blade / glaive_collar / vambrace   matte stone: highlights compressed, no gold, no steel
#   pauldron_*    procedural stepped stone lames (_pauldron): no front/back projection streaks on their sides
#   cowl          the right shoulder's top and side take the front painting (the drape), not a front/back mush
#   robe / wrap / cowl / panel / trousers   the sheet's projection artifacts refilled (_clean)
#   every part    BASE_TONE + VALUE_RAMP: the brief's light head, mid body, dark feet
#   glaive_butt   a pale bevel along the blade-haft's inner edge
_orig_paint = _project.paint


def _lum(c):
    return c[..., 0] * 0.299 + c[..., 1] * 0.587 + c[..., 2] * 0.114


def _dilate(m, it):
    for _ in range(it):
        d = m.copy()
        d[1:] |= m[:-1]
        d[:-1] |= m[1:]
        d[:, 1:] |= m[:, :-1]
        d[:, :-1] |= m[:, 1:]
        m = d
    return m


def _clean_plates(plates) -> None:
    """Inpaint the concept's blue studs round the lens (banned gems) on both plates (in memory)."""
    if getattr(plates, "_kemdo_clean", False):
        return
    for side in ("front", "back"):
        im = plates.img[side]
        (lx, lz), (la, lb) = PAINT_LENS
        (fx, fz), (fa, fb) = PAINT_FRAME
        px, py = plates.to_px(side, np.array([lx, fx]), np.array([lz, fz]))
        k = plates.ppm(side)
        H, W = im.shape[:2]
        x0, x1 = int(max(0, px[1] - fa * k * 1.5)), int(min(W, px[1] + fa * k * 1.5))
        y0, y1 = int(max(0, py[1] - fb * k * 1.5)), int(min(H, py[1] + fb * k * 1.5))
        c = im[y0:y1, x0:x1].copy()
        yy, xx = np.mgrid[y0:y1, x0:x1]
        rl = np.hypot((xx - px[0]) / (la * k), (yy - py[0]) / (lb * k))      # 1 at the painted lens edge
        rf = np.hypot((xx - px[1]) / (fa * k), (yy - py[1]) / (fb * k))      # 1 at the painted frame edge
        r, g, b = c[..., 0], c[..., 1], c[..., 2]
        blue = (b - r > 0.05) & (b > g + 0.005) & (rl > 1.12) & (rf < 1.08)
        blue = _dilate(blue, 4)
        w = (~blue).astype(np.float32)[..., None]
        todo = blue.copy()
        out = c.copy()
        for s_ in (2.0, 4.0, 8.0, 16.0):
            num = _project.blur(c * w, s_)
            den = _project.blur(w, s_)
            sel = todo & (den[..., 0] > 0.25)
            out[sel] = (num / np.maximum(den, 1e-4))[sel]
            todo &= ~sel
        im = im.copy()
        im[y0:y1, x0:x1] = out
        plates.img[side] = im
    plates._kemdo_blur = {s: _project.blur(plates.img[s], 3.0) for s in ("front", "back")}
    plates._kemdo_clean = True


def _sample(plates, side, x, z, blur=False):
    px, py = plates.to_px(side, x, z)
    img = plates._kemdo_blur[side] if blur else plates.img[side]
    return _project.bilinear(img, px, py)


def _head_polar(p):
    q = p - LENS_C
    u = q @ _LF[0]
    vf = (q @ _LF[1]) * math.cos(_t)                                # vertical offset on the front view
    w = q @ LENS_N
    return np.hypot(u, vf / E_HEAD), np.arctan2(vf / E_HEAD, u), w


def _painted(theta, frac, c_ab):
    (cx, cz), (a, b) = c_ab
    return cx + a * frac * np.cos(theta), cz + b * frac * np.sin(theta)


def _two_sided(plates, n, x, z, blur=False):
    """Front plate for faces turned to the lens front, back plate behind, blended across the rim."""
    wb = _ss(-0.35, 0.35, -(n @ LENS_N))[:, None]
    return _sample(plates, "front", x, z, blur) * (1 - wb) + _sample(plates, "back", x, z, blur) * wb


def _matte(c, tone, contrast, cap, keep=0.15):
    """Matte painted stone from a painted-metal patch: the value structure compressed round its median and
    capped (no sheen bands), the hue and chroma of `tone` (no gold, no blue steel)."""
    L = _lum(c)
    m = float(np.median(L)) if L.size else 0.5
    L2 = np.minimum(m + (L - m) * contrast, cap)
    t = np.asarray(scene_hex(tone), dtype=np.float32)
    out = t[None, :] * (L2 / max(float(_lum(t)), 1e-3))[:, None]
    return np.clip(out * (1 - keep) + c * keep * (L2 / np.maximum(L, 1e-3))[:, None], 0, 1)


def scene_hex(h):
    from common import scene as _scene
    return _scene.hex_srgb(h)


def _hexlin(h):
    return _project._lin(np.asarray(scene_hex(h), dtype=np.float32))


def _ylin(c):
    return c @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def _soft_clip(x, knee=0.62):
    """Linear-light shoulder: identity below `knee`, a smooth approach to 1 above (no clipped highlights)."""
    y = np.array(x, dtype=np.float32, copy=True)
    hi = y > knee
    y[hi] = knee + (1 - knee) * (1 - np.exp(-(y[hi] - knee) / (1 - knee)))
    return y


def _tone(col, target_hex, strength=1.0, gamma=0.75):
    """Move a part's painted median onto `target_hex` in linear light: luminance ratio to the median raised to
    `gamma` (< 1 compresses the painted contrast, so a big lift does not blow the painted highlights out to white),
    chromaticity blended from the painting's (0) to the target's (1) by `strength`."""
    lin = _project._lin(col)
    Y = np.maximum(_ylin(lin), 1e-5)
    Ym = float(np.median(Y))
    tgt = _hexlin(target_hex)
    Yt = max(float(_ylin(tgt)), 1e-5)
    newY = Yt * np.power(Y / max(Ym, 1e-5), gamma)
    chroma = lin / Y[:, None] * (1 - strength) + (tgt / Yt)[None, :] * strength
    return _project._srgb(_soft_clip(chroma * newY[:, None])).astype(np.float32)


def _box(a, r):
    """Mean filter of radius r (cumulative sums, edge-clamped), both image axes."""
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
    """Refill the `bad` texels of one part from its own good texels (atlas-space normalised box filters growing
    from 2 to 32 px): smooth, no blocks."""
    good = (own & ~bad).astype(np.float32)
    todo = own & bad
    for r in (2, 4, 8, 16, 32):
        if not todo.any():
            break
        num = _box(out * good[..., None], r)
        den = _box(good, r)
        sel = todo & (den > 0.12)
        out[sel] = num[sel] / den[sel][:, None]
        todo &= ~sel
    return out


def _local_mean(P, C, cell=0.04):
    """Per-texel mean colour of its 3D cell (all texels): the local reference for speckle tests."""
    k = np.floor(P / cell).astype(np.int64)
    h = (k[:, 0] * 73856093) ^ (k[:, 1] * 19349663) ^ (k[:, 2] * 83492791)
    u, inv = np.unique(h, return_inverse=True)
    cnt = np.bincount(inv, minlength=len(u)).astype(np.float32)
    sums = np.stack([np.bincount(inv, weights=C[:, c], minlength=len(u)) for c in range(3)], axis=1)
    return (sums / cnt[:, None])[inv]


# projection artifacts the concept sheet leaves (review): the cut-out's pale halo along the robe / panel hems, the
# robe lining's brown on the trouser crotch, the shirt's blue-white on the cowl's lower rim, dark speckles on the
# panel, blotches on the trouser knees. Each part's outliers are refilled from its own good texels nearest in 3D.
def _clean(name, C, P):
    """Outlier texels of a part (thin lines and specks against their 4 cm 3D neighbourhood)."""
    L = _lum(C)
    med = float(np.median(L))
    loc = _lum(_local_mean(P, C, 0.04))
    bluish = C[:, 2] > C[:, 0] - 0.005
    if name in ("robe", "wrap"):
        return ((L > loc + 0.12) & (L > med + 0.15)) | (bluish & (L > loc + 0.07) & (L > med + 0.06))
    if name == "cowl":
        return (bluish & (L > loc + 0.05)) | (L > loc + 0.20)
    if name == "panel":
        return L < loc - 0.14
    if name == "trousers":
        rb = C[:, 0] - C[:, 2]
        warm = (rb > float(np.median(rb)) + 0.05) & (C[:, 0] > C[:, 1] + 0.01)
        return warm | (L < loc - 0.10) | (L > loc + 0.15)
    return None


PAULDRON_TONE = "#AAA295"


def _pauldron(name, p, n, col):
    """Procedural matte stone lame (the concept's steel plates, banned as metal): a value step per plate (lighter
    top face, the shadow tucked under the lame above), a pale chipped lip, a carved groove round the plate's
    middle, darker inner face; 25 % of the painted structure kept as breakup."""
    i = int(name[-1]) - 1
    z0, z1 = ((1.63, 1.77), (1.55, 1.665), (1.47, 1.585))[i]
    v = np.clip((p[:, 2] - z0) / (z1 - z0), 0.0, 1.0)
    base = _hexlin(PAULDRON_TONE)
    k = 0.92 + 0.16 * _ss(0.15, 0.8, v)                                        # lighter toward the top face
    if i > 0:
        k = k * (1 - 0.42 * _ss(0.78, 0.97, v))                                 # tucked under the lame above
    k = k * (1 - 0.30 * np.exp(-((v - 0.47) / 0.035) ** 2))                     # the carved groove
    lip = 1 - _ss(0.0, 0.16, v)
    k = k * (1 + 0.12 * lip) + 0.42 * (1 - _ss(0.0, 0.05, v)) * (p[:, 2] < z0 + 0.012)   # the chipped lip rim
    inner = _ss(-0.1, -0.5, n[:, 0])                                            # faces turned to the neck / body
    k = k * (1 - 0.45 * inner)
    L = _lum(col)
    brk = np.clip(1 + 0.55 * (L - float(np.median(L))), 0.75, 1.25)             # the painting's chips as breakup
    lin = base[None, :] * (k * brk)[:, None]
    return _project._srgb(_soft_clip(lin)).astype(np.float32)


def _lens_glass(p, n):
    """Procedural burning glass (no projection): a cool domed disc with a dark refractive rim, a lighter sky
    reflection over the top, a warm inner light low in the bowl, a white specular hot spot upper-left and a small
    catch light lower-right, a rim catch-light arc. Painted at L* ~75 (the face wrap stays the lightest large area);
    the real gloss (dawnglass, roughness 0.14) adds the moving glint."""
    r, th, w = _head_polar(p)
    rn = np.clip(r / R_LENS, 0.0, 1.0)
    u, v = rn * np.cos(th), rn * np.sin(th)
    u = np.where((n @ LENS_N) < 0, -u, u)                     # the back face: the hot spot upper-left from behind too
    a = _ss(0.10, 0.82, rn)[:, None]
    b = _ss(0.80, 0.985, rn)[:, None]
    col = _hexlin("#C2CFD8") * (1 - a) + _hexlin("#93A7B7") * a
    col = col * (1 - b) + _hexlin("#4E6072") * b
    sky = (_ss(0.0, 0.7, v) * (1 - _ss(0.72, 0.92, rn)) * 0.45)[:, None]
    col = col * (1 - sky) + _hexlin("#DCE5EB") * sky
    dw = np.hypot((u - 0.08) / 0.66, (v + 0.30) / 0.52)
    warm = ((1 - _ss(0.0, 1.0, dw)) ** 1.4 * 0.78)[:, None]
    col = col * (1 - warm) + _hexlin("#EAC48C") * warm
    ang = np.arctan2(v, u)
    arc = (_ss(0.76, 0.85, rn) * (1 - _ss(0.90, 0.97, rn)) * _ss(0.3, 0.95, np.cos(ang + 0.75)) * 0.65)[:, None]
    col = col * (1 - arc) + _hexlin("#EEF3F5") * arc
    ca, sa = math.cos(math.radians(35)), math.sin(math.radians(35))
    qx, qy = u + 0.36, v - 0.40
    d1 = np.hypot((qx * ca + qy * sa) / 0.21, (-qx * sa + qy * ca) / 0.12)
    hs = (1 - _ss(0.45, 1.0, d1))[:, None]
    col = col * (1 - hs) + np.ones(3, dtype=np.float32) * hs
    d2 = np.hypot((u - 0.42) / 0.075, (v + 0.47) / 0.06)
    hs2 = ((1 - _ss(0.5, 1.0, d2)) * 0.85)[:, None]
    col = col * (1 - hs2) + _hexlin("#F7F2E8") * hs2
    return _project._srgb(col).astype(np.float32)


def _ramp(z):
    zz = np.clip(z / 2.10, 0.0, 1.0)
    return np.interp(zz, [s for s, _ in VALUE_RAMP], [g for _, g in VALUE_RAMP]).astype(np.float32)


def _paint(maps, plates, vis, names, tops=None, flat=None, eps=0.02, bleed=True, log=print):
    if "glaive_frame" not in names:
        return _orig_paint(maps, plates, vis, names, tops=tops, flat=flat, eps=eps, bleed=bleed, log=log)
    _clean_plates(plates)
    out = _orig_paint(maps, plates, vis, names, tops=tops, flat=flat, eps=eps, bleed=False, log=log)
    P, N, part = maps["P"], maps["N"], maps["part"]
    flat = flat or {}

    def sel(name):
        if name not in names or name in flat:
            return None
        m = part == names.index(name)
        return m if m.any() else None

    # the frame: the painted annulus (lens rim -> outer edge) warped onto the visible stone band
    m = sel("glaive_frame")
    if m is not None:
        p, n = P[m], N[m]
        r, th, w = _head_polar(p)
        f = np.clip((r - RING_OUT) / (R_FRAME - RING_OUT), 0.0, 1.0)
        lo = np.array(_painted(th, 1.16, PAINT_LENS))
        hi = np.array(_painted(th, 0.93, PAINT_FRAME))
        x, z = lo + (hi - lo) * f
        col = _two_sided(plates, n, x, z)
        below = p[:, 2] < LENS_Z - R_FRAME * E_HEAD + 0.01             # the throat: the painted throat above the wrap
        if below.any():
            zt = np.clip(1.855 + (p[below, 2] - (LENS_Z - R_FRAME * E_HEAD)) * 0.6, 1.80, 1.87)
            col[below] = _two_sided(plates, n[below], p[below, 0], zt)
        out[m] = col
        log(f"kemdo paint: frame {int(m.sum())} texels re-projected")
    m = sel("glaive_lens")
    if m is not None:
        out[m] = _lens_glass(P[m], N[m])
    # the blade tip: the painted tip (2.18-2.40) stretched onto the longer model tip, then matte ironstone
    m = sel("glaive_blade")
    if m is not None:
        p = P[m]
        s_ = (p - axis_at(BLADE_Z0)) @ AXU
        zp = 2.20 + np.clip(s_, 0, BLADE_L) * (0.20 / BLADE_L)
        ax_ = np.array([axis_at(zz) for zz in zp])
        off = (p - np.array([axis_at(BLADE_Z0) + AXU * ss_ for ss_ in s_])) @ LAT
        x = ax_[:, 0] + off * 0.6
        col = _sample(plates, "front", x, zp) * 0.5 + _sample(plates, "back", x, zp) * 0.5
        out[m] = _matte(col, "#4E453E", 0.55, 0.36)
    for name, tone, contrast, cap in (("glaive_collar", "#A39A8A", 0.5, 0.72), ("vambrace", "#8A8278", 0.55, 0.66)):
        m = sel(name)
        if m is not None:
            out[m] = _matte(out[m], tone, contrast, cap)
    # the right shoulder's top and side: the front drape, not half the dark back cape
    m = sel("cowl")
    if m is not None:
        p, n = P[m], N[m]
        side = (p[:, 0] < -0.14) & (n[:, 1] > -0.6) & (p[:, 1] < 0.09)
        if side.any():
            mm = np.zeros_like(m)
            mm[np.nonzero(m)[0][side], np.nonzero(m)[1][side]] = True
            maps2 = dict(maps)
            maps2["part"] = np.where(mm, part, -1).astype(part.dtype)
            N2 = N.copy()
            N2[..., 1] = -1.0
            N2[..., 0] = 0.0
            maps2["N"] = N2
            front = _orig_paint(maps2, plates, vis, names, tops=None, flat=None, eps=eps, bleed=False, log=lambda *a: None)
            wf = (1 - _ss(0.03, 0.09, p[side, 1]))[:, None]
            out[mm] = front[mm] * wf + out[mm] * (1 - wf)
            log(f"kemdo paint: cowl right shoulder {int(side.sum())} texels from the front")
    # projection artifacts: refill each part's outliers from its own good texels (3D neighbours)
    for name in ("robe", "wrap", "cowl", "panel", "trousers"):
        m = sel(name)
        if m is None:
            continue
        bad = _clean(name, out[m], P[m])
        if bad is None or not bad.any():
            continue
        bm = np.zeros_like(m)
        bm[m] = bad
        out = _fill_atlas(out, m, bm)
        log(f"kemdo paint: {name} {int(bad.sum())} of {int(m.sum())} outlier texels refilled")
    # the base re-tone (brief value bands), the procedural lames, the blade-haft's pale edge
    for name, tone in BASE_TONE.items():
        m = sel(name)
        if m is not None:
            out[m] = _tone(out[m], *tone)
    for name in ("pauldron_1", "pauldron_2", "pauldron_3"):
        m = sel(name)
        if m is not None:
            out[m] = _pauldron(name, P[m], N[m], out[m])
    m = sel("glaive_butt")
    if m is not None:
        p = P[m]
        off = (p - axis_at(HAFT_Z0)) @ LAT
        s_ = -(p - axis_at(HAFT_Z0)) @ AXU
        hw = 0.026 + 0.010 * _ss(0.0, 0.9, s_ / HAFT_Z0)
        edge = _ss(hw * 0.45, hw * 0.85, off) * _ss(0.04, 0.12, s_)
        out[m] = np.clip(out[m] * (1 - 0.5 * edge[:, None]) + np.array(scene_hex("#E6DCC8"))[None, :] * 0.5 * edge[:, None], 0, 1)
    # the light-head / dark-feet ramp on the body (not the glaive: it is held at every height)
    body = np.zeros_like(part, dtype=bool)
    for i, nm in enumerate(names):
        if not nm.startswith("glaive_") and nm not in flat and nm not in ("tassel_plates", "head_core"):
            body |= part == i
    if body.any():
        g = _ramp(P[body][:, 2])
        out[body] = _project._srgb(_soft_clip(_project._lin(out[body]) * g[:, None])).astype(np.float32)
    # Long Evening's lacquer tassel plates (painted flat by the pipeline): a lacquer gradient and lighter edges
    m = part == names.index("tassel_plates") if "tassel_plates" in names else None
    if m is not None and m.any():
        p, n = P[m], N[m]
        top = float(p[:, 2].max())
        v = np.clip((top - p[:, 2]) / 0.14, 0, 1)
        k = 1.18 - 0.38 * v
        rim = 1 - np.abs(n @ LENS_N)
        k = k * (1 + 0.35 * _ss(0.4, 0.9, rim))
        out[m] = np.clip(out[m] * k[:, None], 0, 1)
    if bleed:
        iy, ix = _project.nearest_index(part >= 0)
        out = out[iy, ix]
    return out


_project.paint = _paint


def _recolour(img, maps, names, roles, base_pal, skin_pal, skip=None, log=print):
    """Skin recolour: every part whose (per-part) role the skin sets moves its measured painted median onto the
    skin colour. Luminance ratio to the median kept (gamma 0.9), chromaticity 85 % the skin colour's: a per-channel
    gain (the shared recolour) multiplied the painting's small hue noise by gains up to 3.7 and turned Long
    Evening's plum trousers violet in one fold and magenta in the next."""
    if "glaive_frame" not in names:
        return _orig_recolour(img, maps, names, roles, base_pal, skin_pal, skip=skip, log=log)
    part = maps["part"]
    iy, ix = _project.nearest_index(part >= 0)
    pid = part[iy, ix]
    lin = _project._lin(img)
    out = lin.copy()
    skip = skip or set()
    for i, n in enumerate(names):
        r = SKIN_PART_ROLES.get(n) if SKIN_PART_ROLES.get(n) in skin_pal else roles.get(n)
        if n in skip or not r or r == "accent" or r not in skin_pal:
            continue
        if r in base_pal and str(base_pal[r]).lower() == str(skin_pal[r]).lower():
            continue
        m = pid == i
        core = part == i
        if not core.any():
            continue
        Y = np.maximum(_ylin(lin[m]), 1e-5)
        Ym = max(float(np.median(_ylin(lin[core]))), 1e-5)
        tgt = _hexlin(skin_pal[r])
        Yt = max(float(_ylin(tgt)), 1e-5)
        newY = Yt * np.power(Y / Ym, 0.9)
        chroma = lin[m] / Y[:, None] * 0.15 + (tgt / Yt)[None, :] * 0.85
        new_c = _soft_clip(chroma * newY[:, None])
        if n == "glaive_lens":                       # the painted hot spots stay white (glass, not tinted paint)
            keep = _ss(0.55, 0.85, Y)[:, None]
            new_c = new_c * (1 - keep) + lin[m] * keep
        out[m] = new_c
        log(f"  recolour {n} ({r}): median -> {skin_pal[r]}")
    return _project._srgb(out).astype(np.float32)


_orig_recolour = _project.recolour
_project.recolour = _recolour


# ── the bind pose (brief: art.height = the hood crown; see the docstring) ───────────────────────────────────
REPOSE_PARTS = ("hand_R", "tassel_plates")                  # + every glaive_* part
REPOSE_BONES = ("hand.R", "prop.R", "x_blade_tip", "x_lens")


def _turn(deg: float) -> np.ndarray:
    """4x4: `deg` about +X through the right wrist (positive tips the glaive's head forward, -Y)."""
    _, wr = right_arm_points()
    R = sdf.rot_x(deg)
    M = np.eye(4)
    M[:3, :3] = R
    M[:3, 3] = wr - R @ wr
    return M


def _repose_mask(obj, names) -> np.ndarray | None:
    me = obj.data
    a = me.attributes.get("vale_part")
    if a is None or a.domain != "POINT":
        return None
    pv = np.empty(len(me.vertices), dtype=np.int64)
    a.data.foreach_get("value", pv)
    ids = [i for i, n in enumerate(names) if n.startswith("glaive_") or n in REPOSE_PARTS]
    return np.isin(pv, ids)


def _turn_vertices(obj, M: np.ndarray, mask=None) -> None:
    me = obj.data
    n = len(me.vertices)
    if not n:
        return
    co = np.empty(n * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(n, 3)
    mw = np.array(obj.matrix_world)
    Ml = np.linalg.inv(mw) @ M @ mw                             # the turn in the object's local space
    sel = np.ones(n, dtype=bool) if mask is None else mask
    co[sel] = co[sel] @ Ml[:3, :3].T + Ml[:3, 3]
    if me.has_custom_normals:
        lv = np.empty(len(me.loops), dtype=np.int64)
        me.loops.foreach_get("vertex_index", lv)
        cn = np.array([tuple(c.vector) for c in me.corner_normals])
        ls = sel[lv]
        cn[ls] = cn[ls] @ Ml[:3, :3].T
        me.vertices.foreach_set("co", co.ravel())
        me.normals_split_custom_set([tuple(v) for v in cn])
    else:
        me.vertices.foreach_set("co", co.ravel())
    me.update()


def set_rest_tilt(body, names, deg: float) -> None:
    """Turn the right fist, the glaive (+ its accent ring), prop.R and the glaive sockets to `deg` about the wrist
    (0 = the concept carry the sculpt, the paint and the bake use). Idempotent: reads the armature's
    `kemdo_rest_tilt`."""
    arm = body.find_armature() or body.parent
    if arm is None or arm.type != "ARMATURE":
        return
    done = float(arm.get("kemdo_rest_tilt", 0.0))
    if abs(done - deg) < 1e-6:
        return
    M = _turn(deg - done)
    mask = _repose_mask(body, names)
    if mask is None:
        raise SystemExit("kemdo: no vale_part attribute on the body; cannot set the bind pose")
    _turn_vertices(body, M, mask)
    acc = bpy.data.objects.get(f"{ID}_accent")
    if acc is not None and acc.type == "MESH":
        _turn_vertices(acc, M)
    prev = bpy.context.view_layer.objects.active
    scene.select_only([arm], arm)
    bpy.ops.object.mode_set(mode="EDIT")
    Mm = Matrix([list(r) for r in M])
    for b in REPOSE_BONES:                          # the whole bone frame (EditBone.transform mis-rolled prop.R)
        eb = arm.data.edit_bones.get(b)
        if eb is not None:
            eb.matrix = Mm @ eb.matrix.copy()
    bpy.ops.object.mode_set(mode="OBJECT")
    if prev is not None:
        bpy.context.view_layer.objects.active = prev
    arm["kemdo_rest_tilt"] = float(deg)
    scene.log(f"kemdo: bind pose glaive tilt {done:.0f} -> {deg:.0f} deg ({int(mask.sum())} body verts)")


_orig_split_forms = _pipeline.split_forms


def _split_forms(body, parts, col):
    names = [p.name for p in parts]
    if "glaive_frame" in names and body.name.startswith(ID):
        set_rest_tilt(body, names, REST_TILT)
    return _orig_split_forms(body, parts, col)


_pipeline.split_forms = _split_forms
_orig_paint_object = _project.paint_object


def _paint_object(obj, size, cfg, names, part_attr="vale_part", log=print, return_maps=False):
    """Paint in the concept carry: a cached (re-posed) mesh is turned back for the paint pass only."""
    arm = obj.find_armature()
    tilt = float(arm.get("kemdo_rest_tilt", 0.0)) if arm is not None else 0.0
    if "glaive_frame" not in names or abs(tilt) < 1e-6:
        return _orig_paint_object(obj, size, cfg, names, part_attr=part_attr, log=log, return_maps=return_maps)
    mask = _repose_mask(obj, names)
    _turn_vertices(obj, _turn(-tilt), mask)
    try:
        log(f"kemdo: painting with the glaive turned back {tilt:.0f} deg (the concept carry)")
        return _orig_paint_object(obj, size, cfg, names, part_attr=part_attr, log=log, return_maps=return_maps)
    finally:
        _turn_vertices(obj, _turn(tilt), mask)


_project.paint_object = _paint_object


# ── prop.R location tracks (anim wraps): the glaive slides in the fist or is let go ───────────────────────
_orig_basis = anim.Skeleton.basis


def _basis(self, pose, b):
    m = _orig_basis(self, pose, b)
    if b.startswith("prop."):
        loc = pose.get(b + "_loc")
        if loc is not None:
            m = Matrix.Translation(V(tuple(loc))) @ m
    return m


anim.Skeleton.basis = _basis
_orig_write_action = anim.write_action


def _write_action(arm, name, poses, bones=None):
    act = _orig_write_action(arm, name, poses, bones)
    for b in ("prop.R", "prop.L"):
        k = b + "_loc"
        if b not in arm.data.bones or not any(k in p for p in poses):
            continue
        strip = act.layers[0].strips[0]
        cb = strip.channelbag(act.slots[0], ensure=True)
        n = len(poses)
        for i in range(3):
            fc = anim._new_fcurve(cb, f'pose.bones["{b}"].location', i, b)
            vals = [float(p.get(k, (0.0, 0.0, 0.0))[i]) for p in poses]
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


# ── the sculpt ─────────────────────────────────────────────────────────────────────────────────────
def sculpts() -> list:
    """(name, Sculpt, voxel scale, material role, bind, tris, uv_weight) in build order."""
    out = []

    def part(name, S, role, bind, tris, vs=1.0, uvw=1.0):
        out.append((name, S, vs, role, bind, tris, uvw))

    # HOOD (rigid on the head): a peaked hood with a deep face opening and a thick rim
    hood = Sculpt("hood")
    hood.add(Ellipsoid((0, 0.02, 1.93), (0.138, 0.175, 0.172)), k=0.0)
    hood.add(RoundCone((0, 0.035, 2.0), (0, 0.005, 2.104), 0.075, 0.008), k=0.05)
    hood.add(Ellipsoid((0, 0.03, 1.80), (0.16, 0.18, 0.07)), k=0.07)
    hood.sub(Ellipsoid((0, -0.185, 1.885), (0.104, 0.12, 0.158)), k=0.02)
    hood.add(Torus((0, -0.118, 1.885), 0.112, 0.016, axes=sdf.frame((0, -1, 0.12), (1, 0, 0)) * np.array([[1.0], [0.72], [1.0]]),
                   rz=0.02), k=0.02)
    hood = _with_cloth_folds(hood, 0.006, 22.0)
    part("hood", hood, "cloth2", "bone:head", 1600, 0.8, 1.4)

    # FACE: the linen wrap over nose and jaw, the carved brow band, the dark slit between them
    face = Sculpt("face")
    fw = Ellipsoid((0, -0.06, 1.855), (0.094, 0.105, 0.125))
    face.add(fw.displaced(lambda P: 0.004 * np.sin(P[:, 2] * 85.0 + 3.0 * P[:, 0]) - 0.002, 0.005), k=0.0)
    face.add(RoundCone((0, -0.148, 1.925), (0, -0.164, 1.862), 0.026, 0.03), k=0.03)
    face.inter(HalfSpace((0, 0, 1.944), (0, 0, 1), 1.0), k=0.006)
    part("face", face, "cloth2", "bone:head", 780, 0.6, 1.6)
    brow = Sculpt("brow")
    bshell = Ellipsoid((0, -0.045, 1.985), (0.096, 0.122, 0.078))
    brow.add(bshell.displaced(chips(0.004, 26.0), 0.004), k=0.0)
    brow.inter(HalfSpace((0, 0, 1.955), (0, 0, -1), 1.0), k=0.004)
    brow.inter(HalfSpace((0, 0, 2.048), (0, 0, 1), 1.0), k=0.006)
    brow.inter(HalfSpace((0, -0.07, 2.0), (0, 1, 0), 1.0), k=0.006)
    brow.add(RoundBox((0, -0.155, 1.962), (0.085, 0.022, 0.008), 0.006, axes=sdf.rot_x(-6)), k=0.008)   # the eave lip
    part("brow", brow, "sandstone", "bone:head", 500, 0.5, 1.6)
    core = Sculpt("head_core")
    core.add(Ellipsoid((0, -0.02, 1.92), (0.088, 0.11, 0.12)), k=0.0)
    part("head_core", core, "ink", "bone:head", 120, 1.0, 0.6)

    # SHIRT: the linen torso (weights by height: hips -> spine -> chest, the shoulder caps on the clavicles) and
    # the sleeves as their own part (shoulder -> upper arm -> elbow): no arm weight bleeds into the torso sides
    sh = Sculpt("shirt")
    sh.add(Ellipsoid((-0.01, 0.0, 1.47), (0.235, 0.155, 0.21)), k=0.0)
    sh.add(Ellipsoid((-0.01, 0.012, 1.27), (0.185, 0.135, 0.16)), k=0.08)
    sh.add(Ellipsoid((0, 0.045, 1.57), (0.22, 0.13, 0.12)), k=0.08)
    sh.add(Capsule((0, 0.015, 1.60), (0, 0.025, 1.80), 0.07), k=0.05)
    for sx in (-1, 1):
        sh.add(Sphere((sx * 0.255, 0.012, 1.585), 0.095), k=0.07)
    part("shirt", sh, "cloth2", ("weights", "torso"), 950)
    sl = Sculpt("sleeves")
    el_r, wr_r = right_arm_points()
    sl.add(FlatCapsule(R_SHOULDER + np.array([0.0, 0.0, 0.01]), el_r, 0.075, 0.08, 0.072, 0.075, side=(1, 0, 0))
           .displaced(folds(0.008, 40.0, axis=2, phase=0.7), 0.008), k=0.0)
    el_l0, _ = left_arm_points()
    sl.add(FlatCapsule((0.31, 0.012, 1.61), el_l0, 0.08, 0.085, 0.078, 0.078, side=(1, 0, 0))
           .displaced(folds(0.008, 40.0, axis=2, phase=2.1), 0.008), k=0.0)
    part("sleeves", sl, "cloth2", ("weights", "sleeves"), 600)

    # COWL: the scarf rolled round the neck, hanging in U folds in front, over the right shoulder and the back
    cowl = Sculpt("cowl")
    roll = np.stack([sdf.rot_x(-14)[0], sdf.rot_x(-14)[1] * (0.155 / 0.17), sdf.rot_x(-14)[2]])
    cowl.add(Torus((0, 0.012, 1.735), 0.158, 0.058, axes=roll, rz=0.05), k=0.0)
    drape = RoundBox((0.0, -0.17, 1.625), (0.17, 0.035, 0.10), 0.03, axes=sdf.rot_x(-12))
    cowl.add(drape.displaced(folds(0.012, 36.0, axis=2, phase=0.4), 0.012), k=0.05)
    cowl.add(Ellipsoid((-0.265, 0.0, 1.685), (0.135, 0.17, 0.064), axes=sdf.rot_y(26)), k=0.06)
    cowl.add(Ellipsoid((0.19, 0.0, 1.70), (0.085, 0.15, 0.05), axes=sdf.rot_y(-20)), k=0.06)
    cape = Blend([("add", Ellipsoid((-0.02, 0.0, 1.66), (0.322, 0.192, 0.172)), 0.0),
                  ("inter", HalfSpace((0, 0.03, 1.7), (0, -1, 0), 1.0), 0.02),
                  ("inter", HalfSpace((0.15, 0, 1.62), (-0.154, 0, -0.988), 1.0), 0.015)])
    cowl.add(cape.displaced(dfolds(0.01, 32.0, np.array([-0.154, 0.0, -0.988])), 0.01), k=0.04)
    # rigid with the chest, the right shoulder mantle easing onto the right clavicle (no stretch when the arms lift)
    part("cowl", cowl, "cloth", ("dblend", "chest", "shoulder.R", (-0.10, 0.0, 1.70), (-1.0, 0.0, 0.0), 0.04, 0.22), 1550)

    # WRAP: the robe's sash over the left shoulder: in front it covers the left chest and crosses to the right
    # of the belt (the linen shows on the right chest); behind, it covers the left of the back up to the strap
    def shell():
        return [("add", Ellipsoid((-0.01, 0.0, 1.47), (0.253, 0.173, 0.228)), 0.0),
                ("add", Ellipsoid((-0.01, 0.012, 1.27), (0.203, 0.153, 0.178)), 0.08),
                ("add", Ellipsoid((0, 0.045, 1.57), (0.238, 0.148, 0.138)), 0.08)]
    up_n = np.array([-0.734, 0.0, 0.679])
    front = Blend(shell() + [("inter", HalfSpace((0.13, 0, 1.80), up_n, 1.5), 0.012),
                             ("inter", HalfSpace((0.30, 0, 1.75), (0.949, 0, -0.316), 1.5), 0.02),
                             ("inter", HalfSpace((0, 0, 1.33), (0, 0, -1), 1.5), 0.01),
                             ("inter", HalfSpace((0, -0.02, 1.4), (0, 1, 0), 1.5), 0.03)])
    backp = Blend(shell() + [("inter", HalfSpace((0.06, 0, 1.64), (-0.748, 0, 0.665), 1.5), 0.012),
                             ("inter", HalfSpace((0.22, 0, 1.5), (1, 0, 0), 1.5), 0.02),
                             ("inter", HalfSpace((0, 0, 1.33), (0, 0, -1), 1.5), 0.01),
                             ("inter", HalfSpace((0, 0.02, 1.4), (0, -1, 0), 1.5), 0.03)])
    wrap = Sculpt("wrap")
    wrap.add(front.displaced(dfolds(0.009, 55.0, up_n), 0.009), k=0.0)
    wrap.add(backp.displaced(dfolds(0.008, 45.0, np.array([0.665, 0.0, 0.748])), 0.008), k=0.0)
    part("wrap", wrap, "cloth", ("weights", "torso"), 900)

    # PAULDRON (left shoulder): three stepped lames, each its own rigid part (the top two on the clavicle, the
    # bottom one strapped to the upper arm), so no lame shears or shrinks; 2.5 cm wider than the concept for the
    # Breaker wedge. Each lame is a thin plate (1.5 cm) with a crisp rolled lip 1 cm proud at its lower edge that
    # overhangs the lame below (the concept's overlapping plates), its outer face flattened front and back.
    lames = (((0.31, 0.0, 1.615), (0.128, 0.160, 0.13), 1.63, 1.77, 0.0),
             ((0.318, 0.0, 1.575), (0.133, 0.165, 0.135), 1.55, 1.665, 0.0),
             ((0.325, 0.0, 1.525), (0.129, 0.163, 0.135), 1.47, 1.585, 1.0))
    for i, (c, R, z0, z1, wu) in enumerate(lames):
        pa = Sculpt(f"pauldron_{i + 1}")
        cut_in = ("inter", HalfSpace((0.20 + 0.01 * i, 0, 1.6), (-1, 0, 0), 1.0), 0.006)
        inner = ("sub", Ellipsoid(c, tuple(r - 0.015 for r in R)), 0.0)
        lame = Blend([("add", Ellipsoid(c, R), 0.0), inner,
                      ("inter", HalfSpace((0, 0, z0), (0, 0, -1), 1.0), 0.002),
                      ("inter", HalfSpace((0, 0, z1), (0, 0, 1), 1.0), 0.003), cut_in])
        pa.add(lame.displaced(chips(0.0025, 22.0), 0.0025), k=0.0)
        lip = Blend([("add", Ellipsoid(c, tuple(r + 0.010 for r in R)), 0.0), inner,
                     ("inter", HalfSpace((0, 0, z0 - 0.002), (0, 0, -1), 1.0), 0.0015),
                     ("inter", HalfSpace((0, 0, z0 + 0.019), (0, 0, 1), 1.0), 0.0015), cut_in])
        pa.add(lip, k=0.002)
        part(f"pauldron_{i + 1}", pa, "ironstone", ("weights", ("const", {"shoulder.L": 1.0 - wu, "upper_arm.L": wu})),
             (360, 300, 300)[i], 0.55)
    med = Sculpt("medallion")
    mc = np.array([0.155, -0.185, 1.635])
    med.add(Lathe(mc, lambda r, z: np.maximum(r - 0.04, np.abs(z) - 0.008), 0.045, -0.01, 0.01,
                  axes=sdf.frame((0.15, -1.0, 0.2), (1, 0, 0))), k=0.0)
    part("medallion", med, "sandstone", "bone:chest", 100, 0.5)

    # BELT: the wide wrapped leather sash; the buckle hook
    belt = Sculpt("belt")
    for z, tilt, R in ((1.215, 3.0, 0.172), (1.268, -2.0, 0.176), (1.32, 2.5, 0.172)):
        ax = sdf.rot_y(tilt)
        ax = np.stack([ax[0], ax[1] * (0.176 / 0.142), ax[2]])
        belt.add(Torus((-0.012, 0.004, z), R, 0.03, axes=ax, rz=0.028), k=0.012)
    belt.add(RoundBox((-0.09, -0.172, 1.31), (0.03, 0.012, 0.024), 0.008), k=0.004)
    belt.add(Tube([(0.075, 0.178, 1.65), (-0.05, 0.188, 1.50), (-0.185, 0.16, 1.36)], [0.013, 0.013, 0.013], k=0.01), k=0.006)
    part("belt", belt, "leather", ("weights", "torso"), 750)

    # ROBE: the long coat skirt; open in front over the linen panel; the back hem dips in the middle
    def hem(x, y):
        back = np.clip(y / 0.12, 0, 1)
        return 0.70 - 0.085 * back * np.clip(1 - (x / 0.30) ** 2, 0, 1)
    robe = Sculpt("robe")
    sk = Loft((-0.005, 0.01, 0), 0.70, 1.215, 0.29, 0.20, 0.195, 0.152, hem=hem)
    robe.add(sk.displaced(folds(0.014, 30.0, axis=0, phase=0.9, zfade=(1.15, 0.72)), 0.014), k=0.0)
    slot = Blend([("add", RoundBox((-0.005, -0.25, 0.85), (0.20, 0.15, 0.40)), 0.0)] +
                 [("inter", HalfSpace((-0.05, 0, 1.17), (-0.995, 0, 0.1), 1.0), 0.01),
                  ("inter", HalfSpace((0.045, 0, 1.17), (0.995, 0, 0.1), 1.0), 0.01)])
    robe.sub(slot, k=0.012)
    robe.add(Torus((-0.005, 0.01, 1.185), 0.19, 0.018, axes=np.stack([np.eye(3)[0], np.eye(3)[1] * (0.19 / 0.15), np.eye(3)[2]])),
             k=0.01)
    part("robe", robe, "cloth", ("auto_ex", NO_LEGS_EX), 1700)
    panel = Sculpt("panel")
    pn = RoundBox((-0.005, -0.13, 0.93), (0.115, 0.022, 0.27), 0.012)
    panel.add(pn.displaced(folds(0.008, 70.0, axis=0, phase=0.2), 0.008), k=0.0)
    panel.inter(HalfSpace((-0.005, 0, 0.655), (-0.5, 0, -0.87), 1.0), k=0.008)
    panel.inter(HalfSpace((-0.005, 0, 0.655), (0.5, 0, -0.87), 1.0), k=0.008)
    under = RoundBox((-0.005, -0.085, 0.80), (0.14, 0.035, 0.18), 0.025)
    panel.add(under.displaced(folds(0.01, 40.0, axis=0), 0.01), k=0.01)
    panel.inter(HalfSpace((0, 0, 0.62), (0, 0, -1), 1.0), k=0.01)
    part("panel", panel, "cloth2", ("auto_ex", NO_LEGS_EX), 650)

    # LEGS: bloused trousers over the knee, tall laced boots
    legs = Sculpt("trousers")
    for sx in (-1, 1):
        legs.add(FlatCapsule((sx * 0.12, 0.005, 0.97), (sx * 0.178, -0.01, 0.60), 0.11, 0.105, 0.102, 0.1,
                             side=(1, 0, 0)), k=0.0)
        legs.add(Ellipsoid((sx * 0.18, -0.008, 0.575), (0.102, 0.1, 0.06)).displaced(folds(0.01, 34.0, axis=0), 0.01),
                 k=0.04)
    part("trousers", legs, "under", ("auto_ex", NO_LEGS_EX), 700)
    # BOOTS: slim shafts and narrow feet (x1.2 of a plain boot, not clogs): a heel block and a tapered toe; the
    # crossed lacing is the concept's paint (no lacing geometry standing off the shaft)
    boots = Sculpt("boots")
    for sx in (-1, 1):
        boots.add(FlatCapsule((sx * 0.178, 0.0, 0.535), (sx * 0.192, 0.018, 0.16), 0.090, 0.086, 0.050, 0.056,
                              side=(1, 0, 0)), k=0.0)
        yaw = sx * PROPORTIONS["toe_out_deg"]
        fax = sdf.rot_z(-yaw)
        fc = np.array([sx * 0.205, -0.045, 0.0])
        Rf = fax.T                                            # foot-local -> world (fax rows are the local axes)
        boots.add(RoundBox(fc + Rf @ np.array([0.0, 0.035, 0.056]), (0.047, 0.085, 0.056), 0.04, axes=fax), k=0.045)
        boots.add(Ellipsoid(fc + Rf @ np.array([0.0, -0.06, 0.046]), (0.045, 0.10, 0.046), axes=fax), k=0.035)
        boots.add(Ellipsoid((sx * 0.194, 0.035, 0.12), (0.056, 0.066, 0.07)), k=0.05)
        boots.add(Torus((sx * 0.178, 0.0, 0.51), 0.086, 0.012, axes=np.stack([np.eye(3)[0], np.eye(3)[1] * (0.090 / 0.086), np.eye(3)[2]])),
                  k=0.01)
    boots.inter(HalfSpace((0, 0, 0.0), (0, 0, -1), 2.0), k=0.0)
    part("boots", boots, "leather", ("auto_ex", NO_LEGS_EX), 950)

    # FOREARMS: wrapped leather (right), the vambrace plate rides the left forearm
    fa = Sculpt("forearms")
    fa.add(FlatCapsule(el_r, wr_r, 0.07, 0.066, 0.058, 0.055, side=(1, 0, 0))
           .displaced(wraps(0.005, 120.0, el_r, wr_r - el_r), 0.005), k=0.0)
    el_l, wr_l = left_arm_points()
    fa.add(FlatCapsule(el_l, wr_l, 0.07, 0.066, 0.058, 0.055, side=(1, 0, 0))
           .displaced(wraps(0.005, 120.0, el_l, wr_l - el_l), 0.005), k=0.0)
    part("forearms", fa, "leather", ("weights", "forearms"), 700)
    vb = Sculpt("vambrace")
    d = wr_l - el_l
    vb.add(FlatCapsule(el_l + d * 0.18, el_l + d * 0.88, 0.082, 0.077, 0.069, 0.065, side=(1, 0, 0)), k=0.0)
    vb.sub(FlatCapsule(el_l + d * 0.1, el_l + d * 0.97, 0.069, 0.065, 0.057, 0.054, side=(1, 0, 0)), k=0.0)
    vb.inter(HalfSpace((0.31, 0, 1.2), (-1, 0.35, 0), 1.0), k=0.01)
    vb = _with_chips(vb, 0.004, 16.0)
    part("vambrace", vb, "ironstone", "bone:forearm.L", 520, 1.0)

    # HANDS (rigid): the right fist closed round the haft, the left fist hanging
    hr = Sculpt("hand_R")
    hd = GRIP - wr_r
    e1 = AXU
    e2 = hd - e1 * hd.dot(e1)
    e2 /= np.linalg.norm(e2)
    e3 = np.cross(e1, e2)
    fax = np.stack([e3, e2, e1])                            # rows: thickness, wrist->knuckle, haft
    hr.add(RoundBox(GRIP - e2 * 0.012, (0.05, 0.062, 0.062), 0.038, axes=fax), k=0.0)
    for i in range(4):
        c = GRIP + e2 * 0.034 + e1 * (0.045 - i * 0.03)
        hr.add(Capsule(c - e3 * 0.045, c + e3 * 0.045, 0.021), k=0.014)
    hr.add(Capsule(GRIP - e2 * 0.03 + e3 * 0.04 + e1 * 0.055, GRIP + e2 * 0.03 + e3 * 0.035 + e1 * 0.07, 0.022), k=0.016)
    part("hand_R", hr, "leather", "bone:hand.R", 450, 0.6)
    hl = Sculpt("hand_L")
    lc = np.array([0.322, -0.03, 0.985])
    hl.add(RoundBox(lc, (0.052, 0.062, 0.07), 0.04, axes=sdf.rot_x(-8)), k=0.0)
    for i in range(4):
        c = lc + np.array([0.0, -0.05, 0.04 - i * 0.026])
        hl.add(Capsule(c + np.array([-0.04, 0.005, -0.012]), c + np.array([0.04, 0.005, -0.01]), 0.019), k=0.012)
    hl.add(Capsule(lc + np.array([-0.05, -0.02, 0.05]), lc + np.array([-0.03, -0.065, 0.0]), 0.021), k=0.015)
    part("hand_L", hl, "leather", "bone:hand.L", 450, 0.6)

    # THE GLAIVE (all rigid on prop.R)
    tip_base = axis_at(BLADE_Z0)
    blade = Sculpt("glaive_blade")
    blade.add(Leaf(tip_base, AXU, LAT, BLADE_L, [(0.0, 0.030), (0.18, 0.066), (0.42, 0.070), (0.75, 0.040), (1.0, 0.002)],
                   0.024, edge=0.004), k=0.0)
    blade.add(Capsule(tip_base, axis_at(BLADE_TOP - 0.02), 0.009), k=0.007)    # the spine ridge
    part("glaive_blade", blade, "ironstone", "bone:prop.R", 280, 0.5)
    collar = Sculpt("glaive_collar")
    collar.add(Capsule(axis_at(COLLAR_Z0), axis_at(COLLAR_Z1), 0.040), k=0.0)
    collar.add(Torus(axis_at((COLLAR_Z0 + COLLAR_Z1) / 2), 0.040, 0.009, axes=sdf.frame(AXU, (1, 0, 0))), k=0.004)
    part("glaive_collar", collar, "stone", "bone:prop.R", 110, 0.5)

    def frame_prof(r, z):
        th = TH_IN - (TH_IN - TH_OUT) * np.clip((r - RING_OUT) / (R_FRAME - RING_OUT), 0, 1)
        return np.maximum(np.maximum(R_LENS - 0.010 - r, r - R_FRAME), np.abs(z) - th)
    fr = Sculpt("glaive_frame")
    fr.add(Boxed(Lathe(LENS_C, frame_prof, R_FRAME, -0.06, 0.06, axes=LENS_FRAME).displaced(chips(0.003, 26.0), 0.003),
                 LENS_C, 0.32), k=0.0)
    rm = (RING_IN + RING_OUT) / 2
    for s in (-1, 1):                                                          # the band's seat, both faces
        fr.sub(Boxed(Torus(LENS_C + LENS_N * s * TH_IN, rm, (RING_OUT - RING_IN) / 2 + 0.002, axes=LENS_FRAME, rz=0.012),
                     LENS_C, 0.32), k=0.003)
        for i in range(8):                                                     # carved radial segment cuts
            a = (i + 0.5) * math.pi / 4
            d = head_dir(a)
            th0 = TH_IN - 0.002
            fr.sub(Capsule(LENS_C + d * (RING_OUT + 0.012) + LENS_N * s * th0,
                           LENS_C + d * (R_FRAME + 0.02) + LENS_N * s * (TH_OUT - 0.002), 0.0055), k=0.002)
    fr.sub(Boxed(Torus(LENS_C, R_FRAME, 0.009, axes=LENS_FRAME, rz=0.012), LENS_C, 0.32), k=0.002)   # the rim groove
    fr.add(RoundCone(axis_at(1.60), axis_at(1.72), 0.058, 0.048), k=0.03)     # the throat into the wrap
    part("glaive_frame", fr, "stone", "bone:prop.R", 1450, 0.5, 1.5)
    lens = Sculpt("glaive_lens")
    lens.add(Boxed(Ellipsoid(LENS_C, (R_LENS - 0.002, R_LENS - 0.002, TH_IN + 0.017), axes=LENS_FRAME), LENS_C, 0.34),
             k=0.0)
    part("glaive_lens", lens, "dawnglass", "bone:prop.R", 440, 0.5, 1.6)
    ring = Sculpt("glaive_ring")
    for s in (-1, 1):
        ring.add(Boxed(Torus(LENS_C + LENS_N * s * (TH_IN - 0.005), rm, (RING_OUT - RING_IN) / 2, axes=LENS_FRAME, rz=0.011),
                       LENS_C, 0.36), k=0.0)
    part("glaive_ring", ring, "accent", "bone:prop.R", 300, 0.45)
    gw = Sculpt("glaive_wrap")
    gw.add(RoundCone(axis_at(1.48), axis_at(1.64), 0.036, 0.056).displaced(wraps(0.006, 60.0, axis_at(1.48), AXU, 9.0), 0.006),
           k=0.0)
    part("glaive_wrap", gw, "cloth2", "bone:prop.R", 360, 0.6)
    haft = Sculpt("glaive_haft")                     # the round pale-ash haft between the fist and the wrap
    haft.add(Capsule(axis_at(HAFT_Z0 - 0.02), axis_at(1.50), 0.026), k=0.0)
    haft.add(Torus(axis_at(HAFT_Z0 + 0.01), 0.029, 0.008, axes=sdf.frame(AXU, (1, 0, 0))), k=0.004)   # the socket ring
    part("glaive_haft", haft, "wood", "bone:prop.R", 160, 0.6)
    # the blade-haft (concept): below the fist the haft is a long flat pale-ash blade, 6 cm wide and 3 cm thick at
    # its spine, bevelled to its edges, widening a little to the ground and ending in a hook that turns in
    butt = Sculpt("glaive_butt")
    butt.add(Leaf(axis_at(HAFT_Z0), -AXU, LAT, HAFT_Z0 - 0.008,
                  [(0.0, 0.026, 0.0), (0.06, 0.029, 0.0), (0.45, 0.031, 0.0), (0.74, 0.035, 0.004), (0.88, 0.036, 0.010),
                   (0.95, 0.027, 0.018), (1.0, 0.005, 0.027)], 0.016, edge=0.006), k=0.0)
    part("glaive_butt", butt, "wood", "bone:prop.R", 420, 0.5)
    return out


def left_arm_points():
    """The left elbow and wrist in the rest pose (from the rig layout)."""
    J = rig._layout(rig.proportions(**PROPORTIONS))
    return np.array(tuple(J["elbow.L"])), np.array(tuple(J["wrist.L"]))


def right_arm_points():
    """The right elbow and wrist in the rest pose (rig + sculpt share them)."""
    L = PROPORTIONS["arm"]
    lu, lf = L * PROPORTIONS["upper_arm_frac"], L * (1 - PROPORTIONS["upper_arm_frac"])
    d1 = R_ELBOW_DIR / np.linalg.norm(R_ELBOW_DIR)
    el = R_SHOULDER + d1 * lu
    d2 = R_WRIST_AIM - el
    wr = el + d2 / np.linalg.norm(d2) * lf
    return el, wr


def _with_cloth_folds(S: Sculpt, amp: float, freq: float) -> Sculpt:
    out = Sculpt(S.name)
    out.add(Blend([(op, prim, k) for op, prim, k, _ in S.ops]).displaced(
        lambda P: amp * NOISE(P, freq) + 0.5 * amp * NOISE(P, freq * 2.3, (3.1, 0.7, 1.9)), amp * 1.6), k=0.0)
    return out


def _with_chips(S: Sculpt, amp: float, freq: float) -> Sculpt:
    out = Sculpt(S.name)
    out.add(Blend([(op, prim, k) for op, prim, k, _ in S.ops]).displaced(chips(amp, freq), amp), k=0.0)
    return out


def skin_extras(extra: dict) -> list:
    """skin-only geometry: Long Evening's four lacquer tassel plates hung in a fan from the frame's lower edge"""
    out = []
    if extra.get("tassel_plates"):
        # four lacquer plates (brief: 5 x 12 cm, 1 cm thick) hanging nearly plumb from the frame's lower rim on
        # short cords, a tight fan (10-22 degrees off plumb), each a tapered lozenge with a domed face and a bead
        tp = Sculpt("tassel_plates")
        for i, ang in enumerate((-50.0, -25.0, 25.0, 50.0)):
            a = math.radians(ang)
            rim = LENS_C + head_dir(-math.pi / 2 + a) * R_FRAME * 0.97 + LENS_N * 0.01
            splay = math.copysign(0.10 + 0.14 * (abs(ang) > 30), ang)
            dirv = np.array([0.0, 0.0, -1.0]) + LAT * splay
            dirv /= np.linalg.norm(dirv)
            bead = rim + dirv * 0.03
            tp.add(Capsule(rim, bead, 0.0045), k=0.0)                                   # the cord
            tp.add(Sphere(bead, 0.011), k=0.004)                                         # the bead
            c = bead + dirv * 0.072
            ax = sdf.frame(LENS_N, np.cross(dirv, LENS_N))
            plate = Blend([("add", RoundBox(c, (0.022, 0.058, 0.004), 0.0035, axes=ax), 0.0),
                           ("add", Ellipsoid(c, (0.020, 0.054, 0.0075), axes=ax), 0.004)])
            tp.add(plate, k=0.004)
        out.append(("tassel_plates", tp, 0.4, "lampresin", "bone:prop.R", 420, 1.0))
    return out


# ── rig: the concept's right arm, prop.R up the haft, VFX sockets ─────────────────────────────────────
def extra_materials(ctx) -> dict:
    """Rougher leather than the bible default (0.5): the waxed boots and gloves caught the splash sky as a
    chalky grey sheen."""
    return {"leather": materials.waxed_leather("leather", ctx.palette, "leather", ctx.gradient, rough=0.8)}


def rig_extras(ctx) -> None:
    info = ctx.info
    arm = info.armature
    el, wr = right_arm_points()
    scene.select_only([arm], arm)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    sh = V(eb["upper_arm.R"].head)
    elv, wrv = V(tuple(el)), V(tuple(wr))
    up_d, fo_d = (elv - sh).normalized(), (wrv - elv).normalized()
    eb["upper_arm.R"].tail = elv
    eb["forearm.R"].head = elv
    eb["forearm.R"].tail = wrv
    hd = (V(tuple(GRIP)) - wrv).normalized()
    eb["hand.R"].head = wrv
    eb["hand.R"].tail = wrv + hd * PROPORTIONS["hand"] * 0.5
    # rolls: local +Z = the direction of flexion (rig.py convention: +X rotation flexes)
    eb["upper_arm.R"].align_roll(fo_d - up_d * fo_d.dot(up_d))
    eb["forearm.R"].align_roll(-up_d - fo_d * (-up_d).dot(fo_d))
    eb["hand.R"].align_roll(-up_d - hd * (-up_d).dot(hd))
    g = V(tuple(GRIP))
    eb["prop.R"].head = g
    eb["prop.R"].tail = g + V(tuple(AXU)) * 0.12
    eb["prop.R"].align_roll(V((0.0, -1.0, 0.0)))
    bpy.ops.object.mode_set(mode="OBJECT")
    for b in arm.data.bones:
        info.lengths[b.name] = b.length
    info.joints["elbow.R"], info.joints["wrist.R"] = elv, wrv
    info.joints["knuckle.R"] = wrv + hd * PROPORTIONS["hand"] * 0.5
    info.joints["palm.R"] = g
    info.joints["forearm_dir.R"] = fo_d
    info.joints["arm_dir.R"] = up_d
    rig.add_socket(info, "x_blade_tip", "prop.R", tuple(axis_at(BLADE_TOP)), tuple(AXU * 0.08), z_hint=(0, -1, 0))
    rig.add_socket(info, "x_lens", "prop.R", tuple(LENS_C), tuple(LENS_N * 0.08), z_hint=(0, 0, 1))
    rig.add_socket(info, "x_vent_chest", "chest", (0.0, -0.19, 1.47), (0.0, -0.08, 0.0), z_hint=(0, 0, 1))


# ── motion (brief §8) ───────────────────────────────────────────────────────────────────────────────
# Arms are IK: wrist targets `rel` to the posed shoulder in arm lengths (chest frame: +X her left, -Y front,
# +Z up), `aim` = the glaive's axis (prop.R +Y points up the haft to the lens; the lens faces prop.R +Z),
# the left hand grips the haft with to_prop ("prop.R", along): + toward the lens, - toward the butt.
BLOCKS = {
    "guard":    ((-0.30, -0.42, -0.50), (-0.9, 0.35, -0.3), (-0.10, -0.16, 0.98), (0.0, -0.4, -0.8), None),
    "run_fwd":  ((-0.10, -0.62, -0.42), (-0.9, 0.3, -0.3), (-0.10, -0.78, 0.60), (0.0, -0.4, -0.8), None),
    "run_back": ((-0.22, -0.48, -0.52), (-0.9, 0.4, -0.3), (-0.10, -0.70, 0.70), (0.0, -0.4, -0.8), None),
}
MOTION = anim.motion_profile(weight="medium", weapon="two_hand", stance="wide", run_ref_speed=3.45, blocks=BLOCKS)

P_ = anim.P
F_ = FootTarget
UP = (-0.08, -0.06, 0.99)


def _feet(l=(0.0, 0.0, 0.0), r=(0.0, 0.0, 0.0), yl=6.0, yr=-8.0, pl=0.0, pr=0.0, kl=0.0, kr=0.0, wl=1.0, wr=1.0):
    return {"foot.L": F_(tuple(l), pl, yl, 0.0, kl, wl), "foot.R": F_(tuple(r), pr, yr, 0.0, kr, wr)}


FEET0 = dict(l=(0.02, -0.02, 0.0), r=(-0.02, 0.05, 0.0))


def _pose(torso=None, hips=(0.0, 0.01, -0.035), R=(-0.18, -0.33, -0.72), Rp=(-0.5, 0.75, -0.3), aim=UP,
          L=None, Lp=(0.8, 0.3, -0.45), feet=None, extra=None, arms_fk=None):
    """A full pose: torso rotations (deg), hips offset (m), the right wrist + the glaive's axis, the left hand
    (None = hanging FK; ('prop', along) = on the haft; ('rel', (x, y, z)) = a free reach), feet targets."""
    p = P_(upper_arm_L=(6, 0, 4), forearm_L=(14, 0, 0), hand_L=(0, 0, -4))
    if arms_fk:
        p.update(P_(**arms_fk))
    p.update(P_(**(torso or {})))
    p["hips_loc"] = tuple(hips)
    ik = {"hand.R": HandTarget(rel=tuple(R), pole=tuple(Rp)), "aim.R": Aim(tuple(aim))}
    if L is not None:
        if L[0] == "prop":
            ik["hand.L"] = HandTarget(to_prop=("prop.R", L[1]), pole=tuple(Lp))
        else:
            ik["hand.L"] = HandTarget(rel=tuple(L[1]), pole=tuple(Lp))
    ik.update(_feet(**(feet or FEET0)))
    p["ik"] = ik
    if extra:
        p.update(P_(**extra))
    return p


TORSO0 = dict(hips=(2, 0, 0), spine=(2, 0, 0), chest=(1, 0, 0), neck=(-2, 0, 0), head=(-3, 0, 0))


def guard_pose() -> dict:
    """The concept's carry: the glaive upright at her right side in the right fist, the left arm hanging
    (closed fist), weight a little back, a wide easy stance."""
    return _pose(TORSO0)


def _breathe(p, t, cycles=2, amp=1.0):
    b = anim.osc(t, cycles)
    return anim.add(p, P_(chest=(1.2 * b * amp, 0, 0), spine=(0.4 * b * amp, 0, 0), neck=(-0.6 * b * amp, 0, 0),
                          shoulder_L=(0, 0, 1.2 * b * amp), shoulder_R=(0, 0, -1.2 * b * amp)))


def _with_hips_off(p, d):
    q = dict(p)
    hx, hy, hz = q.get("hips_loc", (0.0, 0.0, 0.0))
    q["hips_loc"] = (hx + d[0], hy + d[1], hz + d[2])
    return q


# ── clip finishing (not in the shared anim: per-frame IK post-steps for this fighter) ───────────────────
#   * the bind pose turns the right fist (see the docstring): every raw pose gets the inverse turn on hand.R first,
#     so the IK starts from the concept carry and the poses match it exactly
#   * the glaive never sinks into the floor: the right hand's target rises until its lowest point clears it
#   * the lens can be rolled about the haft to face a direction (the ult's mirror toward the target)
#   * lying / kneeling clips lift the whole body so no vertex goes under the floor (sampled from the bound mesh)
#   * two-hand grips: the off hand takes the point on the haft nearest its shoulder (key poses, `_grip`)
#   * a PINNED glaive (Vent's planted post, the death's fall): prop.R gets the rotation + location that hold its
#     world matrix while the hand lets go
ARM_L = PROPORTIONS["arm"]


def _mat(M4: np.ndarray) -> Matrix:
    return Matrix([list(r) for r in M4])


def _rest_tilt(skel) -> float:
    arm = getattr(skel, "arm", None)
    return float(arm.get("kemdo_rest_tilt", 0.0)) if arm is not None else 0.0


def _hand_comp(skel):
    """3x3 basis that turns hand.R from the re-posed rest back to the concept carry (None when not re-posed)."""
    if not hasattr(skel, "_kemdo_comp"):
        tilt = _rest_tilt(skel)
        if abs(tilt) < 1e-6:
            skel._kemdo_comp = None
        else:
            H1 = skel.rest["hand.R"]
            skel._kemdo_comp = (H1.inverted() @ _mat(_turn(tilt)).inverted() @ H1).to_3x3()
    return skel._kemdo_comp


def _comp_raw(skel, raw):
    C = _hand_comp(skel)
    if C is None:
        return raw
    q = dict(raw)
    e = q.get("hand.R")
    from mathutils import Euler
    B = Euler([math.radians(a) for a in e], "XYZ").to_matrix() if e else Matrix.Identity(3)
    q["hand.R"] = anim.Skeleton.euler_of(C @ B)
    return q


def _prop_rest0(skel) -> Matrix:
    """prop.R's rest in the concept carry (where the sculpt's world coordinates live)."""
    R = skel.rest["prop.R"]
    tilt = _rest_tilt(skel)
    return _mat(_turn(-tilt)) @ R if abs(tilt) > 1e-6 else R


def _glaive_points(skel):
    inv = _prop_rest0(skel).inverted()
    pts = [axis_at(0.008) + LAT * 0.027, axis_at(0.05) + LAT * 0.036, axis_at(0.05) - LAT * 0.036,
           axis_at(0.30) + LAT * 0.032, axis_at(0.30) - LAT * 0.032, axis_at(BLADE_TOP),
           axis_at(BLADE_TOP - 0.12) + LAT * 0.07, axis_at(BLADE_TOP - 0.12) - LAT * 0.07]
    for i in range(12):
        th = 2 * math.pi * i / 12
        for s in (-1, 1):
            pts.append(LENS_C + head_dir(th) * R_FRAME + LENS_N * s * 0.045)
    return np.array([tuple(inv @ V(tuple(p))) + (1.0,) for p in pts])


def _body_points(skel, step=1):
    """Skinned sample of the bound body mesh (no glaive): rest positions + weights for an exact LBS floor test."""
    ob = bpy.data.objects.get(ID)
    if ob is None or ob.type != "MESH" or not ob.vertex_groups:
        return None
    gname = {g.index: g.name for g in ob.vertex_groups}
    bones = [b for b in skel.order if b in set(gname.values()) and not b.startswith("prop.")]
    bi = {b: i for i, b in enumerate(bones)}
    mw = ob.matrix_world
    P, W = [], []
    verts = ob.data.vertices
    for i in range(0, len(verts), step):
        v = verts[i]
        ws = [(gname.get(g.group), g.weight) for g in v.groups if g.weight > 1e-3]
        if not ws or any(n is not None and n.startswith("prop.") and w > 0.5 for n, w in ws):
            continue
        row = np.zeros(len(bones))
        for n, w in ws:
            if n in bi:
                row[bi[n]] = w
        if row.sum() < 1e-3:
            continue
        P.append(tuple(mw @ v.co) + (1.0,))
        W.append(row / row.sum())
    inv = np.stack([_np(skel.rest[b].inverted()) for b in bones])
    return bones, np.array(P), np.array(W), inv


def _np(M):
    return np.array([list(r) for r in M])


def _min_z(M, pts):
    return float((pts @ _np(M).T)[:, 2].min())


def _raise_hand(raw, dz):
    q = dict(raw)
    ik = dict(q.get("ik", {}))
    ht = ik.get("hand.R")
    if ht is None:
        return q
    if ht.rel is not None:
        ik["hand.R"] = HandTarget(rel=(ht.rel[0], ht.rel[1], ht.rel[2] + dz / ARM_L), pole=ht.pole, weight=ht.weight)
    elif ht.pos is not None:
        ik["hand.R"] = HandTarget(pos=(ht.pos[0], ht.pos[1], ht.pos[2] + dz), pole=ht.pole, weight=ht.weight)
    q["ik"] = ik
    return q


def _roll_lens(skel, p, raw, want):
    """Roll the right hand about the glaive's axis so the lens (prop.R +Z) faces `want` (character space)."""
    M = skel.fk(p)
    R3 = M["prop.R"].to_3x3()
    a, z = R3.col[1].normalized(), R3.col[2].normalized()
    w = V(want)
    w = w - a * w.dot(a)
    if w.length < 1e-4:
        return p
    w.normalize()
    ang = math.atan2(a.dot(z.cross(w)), z.dot(w))
    new = Matrix.Rotation(ang, 3, a) @ M["hand.R"].to_3x3()
    Ph = (M[skel.parent["hand.R"]] @ skel.local["hand.R"]).to_3x3()
    q = dict(p)
    q["hand.R"] = anim.Skeleton.euler_of(Ph.inverted() @ new, p.get("hand.R"))
    hl = (raw.get("ik") or {}).get("hand.L")
    if hl is not None and hl.to_prop:
        q["ik"] = {"hand.L": hl}
        q = anim.resolve(skel, q)
    return q


def _lift_body(skel, p, BF, floor=0.0):
    if not BF:
        return p
    bones, P, W, inv = BF
    M = skel.fk(p)
    S = np.stack([_np(M[b]) for b in bones]) @ inv                     # skinning matrices (B, 4, 4)
    z = np.einsum("nb,bn->n", W, np.einsum("bj,nj->bn", S[:, 2, :], P))
    zmin = float(z.min())
    if zmin >= floor:
        return p
    return _with_hips_off(p, (0.0, 0.0, floor - zmin))


def _grip(skel, pose, bias=0.0, pole=(0.8, 0.1, -0.5)):
    """Two hands on the haft: the left hand takes the haft point nearest its shoulder (+ bias toward the lens)."""
    q = dict(pose)
    ik = dict(q.get("ik", {}))
    ik.pop("hand.L", None)
    q["ik"] = ik
    r = anim.resolve(skel, _comp_raw(skel, q))
    M = skel.fk(r)
    o = M["prop.R"].translation
    a = M["prop.R"].to_3x3().col[1].normalized()
    s = M["upper_arm.L"].translation
    along = (s - o).dot(a) + bias
    ik = dict(ik)
    ik["hand.L"] = HandTarget(to_prop=("prop.R", along), pole=tuple(pole))
    q["ik"] = ik
    return q


def _lens_world(skel, pose):
    """World (armature-space) centre of the lens and its facing for a resolved pose."""
    M = skel.fk(pose)["prop.R"]
    L0 = _prop_rest0(skel).inverted()
    c = M @ (L0 @ V(tuple(LENS_C)))
    n = (M.to_3x3() @ (L0.to_3x3() @ V(tuple(LENS_N)))).normalized()
    return c, n


def _pin_glaive(skel, p, W):
    """prop.R's rotation + location (relative to the hand) that put the glaive at the world matrix W."""
    M = skel.fk(p)
    B = (M["hand.R"] @ skel.local["prop.R"]).inverted() @ W
    q = dict(p)
    q["prop.R"] = anim.Skeleton.euler_of(B.to_3x3(), p.get("prop.R"))
    q["prop.R_loc"] = tuple(B.translation)
    return q


def pin_hold(t0, t1):
    """The glaive let go between t0 and t1 stays where the hand left it at t0 (planted)."""
    def pin(t, ref):
        return ref(t0) if t0 <= t <= t1 else None
    return pin


def pin_fall(skel, t0, t_land, fall_dir, GL):
    """The glaive let go at t0 topples about its butt (gravity ease) to lie along `fall_dir`, the lens rolled up to
    the sky, lands at t_land with a small rebound; it never goes under the floor."""
    cache = {}
    L0 = _prop_rest0(skel)
    b_l = L0.inverted() @ V(tuple(axis_at(0.03)))                       # the butt, prop space
    n_l = (L0.to_3x3().inverted() @ V(tuple(LENS_N))).normalized()      # the lens facing, prop space

    def lowest(W):
        return float((GL @ _np(W).T)[:, 2].min())

    def setup(W0):
        d = V((fall_dir[0], fall_dir[1], 0.0)).normalized()
        d = (d + V((0, 0, 0.10))).normalized()
        up = V((0, 0, 1)) - d * d.z
        up.normalize()
        y_l = V((0, 1, 0))
        n_lp = (n_l - y_l * n_l.dot(y_l)).normalized()
        Rl = Matrix((y_l, n_lp, y_l.cross(n_lp))).transposed()
        Rw = Matrix((d, up, d.cross(up))).transposed()
        R1 = Rw @ Rl.inverted()
        b0 = W0 @ b_l
        W1 = Matrix.Translation(V((b0.x, b0.y, 0.0))) @ R1.to_4x4() @ Matrix.Translation(-b_l)
        W1 = Matrix.Translation(V((0, 0, 0.016 - lowest(W1)))) @ W1
        return W0.to_quaternion(), R1.to_quaternion(), b0, W1 @ b_l

    def pin(t, ref):
        if t < t0:
            return None
        if "s" not in cache:
            cache["s"] = setup(ref(t0))
        q0, q1, b0, b1 = cache["s"]
        if t <= t_land:
            u = (t - t0) / max(1e-6, t_land - t0)
            s = u * u
        else:
            u = min(1.0, (t - t_land) / 0.10)
            s = 1.0 - 0.06 * math.sin(math.pi * u)
        R = q0.slerp(q1, s).to_matrix().to_4x4()
        b = b0.lerp(b1, min(1.0, s))
        W = Matrix.Translation(b) @ R @ Matrix.Translation(-b_l)
        z = lowest(W)
        if z < 0.016:
            W = Matrix.Translation(V((0, 0, 0.016 - z))) @ W
        return W
    return pin


def _finisher(skel):
    GL = _glaive_points(skel)
    BF = _body_points(skel)

    def core(fn, t, lens, floor, body_floor, held=True):
        raw = _comp_raw(skel, fn(t))
        p = anim.resolve(skel, raw)
        if held:
            for _ in range(4):
                z = _min_z(skel.fk(p)["prop.R"], GL)
                if z >= floor - 0.002:
                    break
                raw = _raise_hand(raw, floor - z + 0.004)
                p = anim.resolve(skel, raw)
            want = lens(t) if callable(lens) else lens
            if want is not None:
                p = _roll_lens(skel, p, raw, want)
        if body_floor:
            p = _lift_body(skel, p, BF)
        return p

    def finish(fn, body_floor=False, lens=None, floor=0.015, pin=None):
        cache = {}

        def ref(tt):
            if tt not in cache:
                cache[tt] = skel.fk(core(fn, tt, lens, floor, body_floor))["prop.R"].copy()
            return cache[tt]

        def g(t):
            W = pin(t, ref) if pin is not None else None
            p = core(fn, t, lens, floor, body_floor, held=W is None)
            return _pin_glaive(skel, p, W) if W is not None else p
        return g
    finish.GL = GL
    return finish


def clip_overrides(ctx) -> dict:
    """Brief §8: four distinct ability gestures + bespoke basics, impact at exactly 40 % of attack/cast clips.
      attack1  a short low jab from the hip (both hands, no lunge)
      attack2  the butt-stroke: the blade-haft swung up and out in front of her, the lens end dropped behind
      cast_a1  Long Thrust   the rear foot drives a deep lunge, the glaive levelled in both hands and SLID forward
                             through them at f10 (the longest reach of the kit: one horizontal line through the
                             body); hold to f15, the glaive swings upright, retract by f25
      cast_a2  Heat Shimmer  castTime 0: 2 frames of dip while her fist slides up to the frame, then a low sprint
                             DRAGGING the glaive (the blade-haft's butt on the ground behind her, the lens at her
                             hip); the skid at f8 swings the lens up into the light (the glint); recover by f20
      cast_a3  Vent          castTime 0: the glaive planted upright in front of her (3 f), let go: it stands as the
                             centre post while BOTH arms burst wide and up, head back, chest open, wraps flared at
                             f10 (stamp); the open X held to f18; she takes the post back and returns to guard
      cast_ult Held Focus    the glaive lifted in both hands (the haft clear of the face), tipped 55 degrees toward
                             the target with the lens turned at it like a mirror; still at f16, hold to f30
      dash     the drag sprint (loop)       death  knees buckle, the glaive is let go and topples forward-right
      recall   kneeling over the lowered lens, the left hand cupped over it, bowing (a breathing loop)
    """
    arm = ctx.info.armature
    skel = anim.Skeleton(arm)
    hip_h = arm.data.bones["hips"].head_local.z
    finish = _finisher(skel)
    G = guard_pose()
    grip = lambda pose, bias=0.0, pole=(0.8, 0.1, -0.5): _grip(skel, pose, bias, pole)  # noqa: E731
    out = {}

    def mk(name, N, fn, impact=None, loop=False, meta=None, body_floor=True, **kw):
        return anim.Clip(name, N, loop, finish(fn, body_floor=body_floor, **kw), impact=impact, meta=meta or {})

    def keyed(keys, N=None, lags=None, loop=False):
        fn = anim.keyed(keys)
        if lags:
            fn = anim.drag(fn, N, lags, loop=loop)
        return fn

    def slid(pose, s):
        q = dict(pose)
        q["prop.R_loc"] = (0.0, float(s), 0.0)
        return q

    # idle: breathing, a slow weight shift, the lens drifting a few degrees (72 f loop)
    def idle_s(t):
        s = anim.osc(t, 1, 0.1)
        p = _breathe(G, t)
        p = anim.add(p, P_(hips=(0, 1.0 * s, -1.0 * s), spine=(0, 0, 0.6 * s), head=(0, 2.0 * s, 0),
                           upper_arm_L=(1.5 * anim.osc(t, 2, 0.2), 0, 0)))
        ik = dict(p["ik"])
        ik["aim.R"] = Aim((UP[0] + 0.03 * anim.osc(t, 1, 0.3), UP[1] + 0.02 * anim.osc(t, 2), UP[2]))
        h = ik["hand.R"]
        ik["hand.R"] = HandTarget(rel=(h.rel[0], h.rel[1], h.rel[2] + 0.01 * anim.osc(t, 2, 0.1)), pole=h.pole)
        p["ik"] = ik
        hx, hy, hz = p["hips_loc"]
        p["hips_loc"] = (hx + 0.012 * s, hy, hz - 0.004 * (0.5 + 0.5 * anim.osc(t, 2)))
        return p
    out["idle"] = mk("idle", 72, idle_s, loop=True)

    # run (3.45 m/s): the glaive carried at port, tipped 30 degrees forward in both hands (the lens high beside her
    # head, not levelled like a thrust), the butt trailing low behind
    base_run = anim.gen_run(MOTION)

    def run_s(t):
        p = base_run.sample(t)
        sw = math.cos(2 * math.pi * ((t % 1.0) - 0.03))
        ik = dict(p["ik"])
        ik["hand.R"] = HandTarget(rel=(0.02, -0.34 - 0.03 * sw, -0.82 + 0.02 * sw), pole=(-0.6, 0.6, -0.4))
        ik["aim.R"] = Aim((0.06, -0.48, 0.87 + 0.02 * sw))
        ik["hand.L"] = HandTarget(to_prop=("prop.R", 0.42), pole=(0.8, 0.2, -0.5))
        p["ik"] = ik
        return p
    out["run"] = mk("run", base_run.frames, run_s, loop=True, meta=base_run.meta, body_floor=False)

    # the glaive swung upright at the right side, the left hand free (the recoveries pass OUTSIDE the hips)
    def upright(torso, R=(-0.26, -0.42, -0.62), aim=(-0.16, -0.42, 0.89), hips=(0.0, 0.0, -0.04), feet=None):
        return _pose(torso, hips=hips, R=R, Rp=(-0.8, 0.4, -0.2), aim=aim, feet=feet)

    # attack1: a short low jab (25 f, impact f10): from the hip, the head dipped below level, no step
    a1w = grip(_pose(dict(hips=(-2, -16, 0), spine=(-2, -8, 0), chest=(-3, -12, 0), neck=(0, 6, 0), head=(2, 12, 0)),
                     hips=(0, 0.04, -0.05), R=(-0.12, 0.02, -0.84), Rp=(-0.7, 0.6, -0.2), aim=(0.34, -0.92, -0.12)), 0.04)
    a1h = grip(_pose(dict(hips=(5, -6, 0), spine=(4, -3, 0), chest=(3, -6, 0), neck=(-2, 3, 0), head=(-4, 6, 0)),
                     hips=(0, -0.05, -0.06), R=(0.14, -0.56, -0.62), Rp=(-0.8, 0.3, -0.4), aim=(0.20, -0.94, -0.26),
                     feet=dict(l=(0.02, -0.08, 0.0), r=(-0.02, 0.05, 0.0))), 0.04)
    a1f = grip(_pose(dict(hips=(5, -6, 0), spine=(5, -3, 0), chest=(4, -6, 0), neck=(-2, 3, 0), head=(-5, 6, 0)),
                     hips=(0, -0.055, -0.065), R=(0.15, -0.58, -0.61), Rp=(-0.8, 0.3, -0.4), aim=(0.20, -0.94, -0.27),
                     feet=dict(l=(0.02, -0.08, 0.0), r=(-0.02, 0.05, 0.0))), 0.04)
    k1 = anim.strike_keys(MOTION, a1w, a1h, a1f, G)
    k1[8] = (0.78, upright(dict(hips=(3, -2, 0), spine=(3, -2, 0), chest=(2, -3, 0), neck=(-2, 1, 0), head=(-3, 2, 0)),
                           feet=dict(l=(0.02, -0.06, 0.0), r=(-0.02, 0.05, 0.0))), "inout")
    out["attack1"] = mk("attack1", 25, keyed(k1, 25, {"head": 1.5, "neck": 1.0}), impact=anim.IMPACT)

    # attack2: the butt-stroke (30 f, impact f12): the blade-haft swings up and out IN FRONT of her (the hooked
    # butt at shoulder height a metre ahead), the lens end dropped low behind her right hip
    a2w = grip(_pose(dict(hips=(0, 16, 0), spine=(-2, 10, 0), chest=(-4, 14, 0), neck=(0, -6, 0), head=(0, -10, 0)),
                     hips=(0, 0.03, -0.04), R=(0.12, -0.36, -0.60), Rp=(-0.8, 0.4, -0.2), aim=(0.32, -0.52, 0.79)),
               -0.02, pole=(0.7, 0.5, -0.4))
    a2h = grip(_pose(dict(hips=(5, -10, 0), spine=(6, -6, 0), chest=(7, -8, 0), neck=(-4, 4, 0), head=(-6, 6, 0)),
                     hips=(0, -0.07, -0.07), R=(0.10, -0.66, -0.50), Rp=(-0.7, 0.5, -0.4), aim=(-0.30, 0.80, -0.52),
                     feet=dict(l=(0.02, -0.12, 0.0), r=(-0.02, 0.05, 0.0))), 0.0, pole=(0.8, 0.2, -0.4))
    a2f = grip(_pose(dict(hips=(6, -12, 0), spine=(7, -7, 0), chest=(8, -9, 0), neck=(-4, 5, 0), head=(-7, 8, 0)),
                     hips=(0, -0.08, -0.075), R=(0.12, -0.66, -0.47), Rp=(-0.7, 0.5, -0.4), aim=(-0.34, 0.80, -0.49),
                     feet=dict(l=(0.02, -0.12, 0.0), r=(-0.02, 0.05, 0.0))), 0.0, pole=(0.8, 0.2, -0.4))
    out["attack2"] = mk("attack2", 30, keyed(anim.strike_keys(MOTION, a2w, a2h, a2f, G), 30, {"head": 1.5, "neck": 1.0}),
                        impact=anim.IMPACT)

    # cast_a1 Long Thrust (25 f, impact f10, hold to f15, swing upright and retract by f25): a deep lunge, the body
    # one long diagonal, both arms fully out and the glaive slid 0.32 m forward through the fists (the reach)
    t1w = grip(_pose(dict(hips=(-3, -22, 0), spine=(-3, -12, 0), chest=(-4, -16, 0), neck=(2, 10, 0), head=(4, 18, 0)),
                     hips=(0, 0.10, -0.10), R=(-0.12, 0.10, -0.80), Rp=(-0.7, 0.6, -0.2), aim=(0.36, -0.93, 0.03),
                     feet=dict(l=(0.02, -0.08, 0.0), r=(-0.02, 0.10, 0.0))), 0.04)
    lunge = dict(l=(0.04, -0.62, 0.0), r=(-0.02, 0.30, 0.0), pr=-30.0, yr=-16.0, pl=4.0)
    t1h = grip(slid(_pose(dict(hips=(22, -6, 0), spine=(10, -6, 0), chest=(6, -10, 0), neck=(-12, 4, 0), head=(-16, 8, 0)),
                          hips=(0, -0.40, -0.22), R=(0.46, -0.90, -0.10), Rp=(-0.8, 0.2, -0.5), aim=(0.04, -1.0, 0.03),
                          feet=lunge), 0.32), 0.16)
    t1o = grip(slid(_pose(dict(hips=(23, -6, 0), spine=(11, -6, 0), chest=(7, -10, 0), neck=(-13, 4, 0), head=(-17, 8, 0)),
                          hips=(0, -0.42, -0.23), R=(0.47, -0.91, -0.09), Rp=(-0.8, 0.2, -0.5), aim=(0.04, -1.0, 0.02),
                          feet=lunge), 0.32), 0.16)
    t1u = upright(dict(hips=(8, -3, 0), spine=(4, -3, 0), chest=(3, -5, 0), neck=(-4, 2, 0), head=(-6, 4, 0)),
                  hips=(0, -0.14, -0.10), feet=dict(l=(0.03, -0.24, 0.0), r=(-0.02, 0.14, 0.0), pr=-8.0))
    out["cast_a1"] = mk("cast_a1", 25, keyed([
        (0.0, G, "linear"), (0.08, anim.lerp_pose(G, t1w, -0.12), "inout"), (0.24, t1w, "inout"),
        (0.30, anim.lerp_pose(G, t1w, 1.06), "out"), (0.40, t1h, "accel"), (0.60, t1o, "out"),
        (0.80, t1u, "inout"), (1.0, G, "settle")], 25, {"head": 1.5, "neck": 1.0}), impact=anim.IMPACT)

    # cast_a2 Heat Shimmer (20 f, impact f8) and dash: the DRAG. The fist slides up the haft to just under the wrap
    # (prop.R_loc -0.30 m: the hand holds the glaive near its head), the lens rides at her right hip and the
    # blade-haft trails down and back with its butt on the ground; the left arm pumps
    DRAG = 0.30
    drag_arm = dict(R=(-0.20, 0.06, -0.92), Rp=(-0.6, -0.2, -0.8), aim=(0.06, -0.80, 0.60))
    s2a = slid(_with_hips_off(anim.add(G, P_(spine=(4, 0, 0), chest=(4, 0, 0))), (0, 0.02, -0.05)), -DRAG * 0.6)

    def sprint(lfwd=True, lean=24):
        f = (dict(l=(0.03, -0.34, 0.07), r=(-0.03, 0.30, 0.05), pl=12.0, pr=-30.0) if lfwd else
             dict(l=(0.03, 0.30, 0.05), r=(-0.03, -0.32, 0.07), pl=-30.0, pr=12.0))
        arm_l = (0.06, -0.72, -0.34) if lfwd else (0.12, 0.30, -0.80)
        return slid(_pose(dict(hips=(lean, 4 if lfwd else -4, 0), spine=(8, 0, 0), chest=(6, 2 if lfwd else -2, 0),
                               neck=(-14, 0, 0), head=(-16, 0, 0)),
                          hips=(0, -0.10, -0.13), L=("rel", arm_l), Lp=(0.8, 0.4, -0.3), feet=f, **drag_arm), -DRAG)
    # the skid: planted side-on, low, the glaive swung up in front in both hands, the lens turned up to the light
    skid = grip(slid(_pose(dict(hips=(10, -24, 0), spine=(4, -8, 0), chest=(0, -10, 0), neck=(-6, 6, 0), head=(-8, 10, 0)),
                           hips=(0, -0.05, -0.17), R=(0.16, -0.62, -0.42), Rp=(-0.7, 0.4, -0.5), aim=(0.30, -0.62, 0.72),
                           feet=dict(l=(0.12, -0.34, 0.0), r=(-0.08, 0.26, 0.0), pl=8.0, pr=-16.0, yl=30.0)), -DRAG * 0.3),
                0.10)
    out["cast_a2"] = mk("cast_a2", 20, keyed([
        (0.0, G, "linear"), (0.10, s2a, "out"), (0.22, sprint(True), "out"), (0.32, sprint(False, 26), "inout"),
        (0.40, skid, "in"), (0.55, anim.lerp_pose(skid, G, 0.15), "out"), (0.80, anim.lerp_pose(skid, G, 0.7), "inout"),
        (1.0, G, "settle")], 20, {"head": 1.0, "neck": 0.5}), impact=anim.IMPACT, lens=lambda t: (0.1, -0.3, 0.95) if 0.36 <= t <= 0.62 else None)

    # dash (15 f loop): the drag sprint, two strides
    sA, sB = sprint(True), sprint(False, 26)
    out["dash"] = mk("dash", 15, keyed([(0.0, sA, "linear"), (0.5, sB, "inout"), (1.0, sA, "inout")]), loop=True)

    # cast_a3 Vent (25 f, impact f10): the glaive lifted a hand's breadth and slammed upright into the ground at her
    # right side (f3), the left fist drawn to the chest, head bowed; then LET GO: it stands on its own as the post
    # while BOTH arms burst wide and up (the X), head back, chest open, the wraps flared (stamp at f10); the open X
    # holds to f18; the right hand takes the post back (f21) and returns to guard
    gtorso = dict(hips=(6, 0, 0), spine=(8, 0, 0), chest=(10, 0, 0), neck=(6, 0, 0), head=(10, 0, 0))
    raise_ = _pose(dict(hips=(3, 0, 0), spine=(4, 0, 0), chest=(5, 0, 0), neck=(3, 0, 0), head=(5, 0, 0)),
                   hips=(0, 0.0, -0.05), R=(-0.20, -0.44, -0.38), Rp=(-0.8, 0.4, -0.3), aim=(-0.06, -0.06, 1.0),
                   L=("rel", (-0.05, -0.55, -0.40)), Lp=(0.7, 0.2, -0.6))
    plant = _pose(gtorso, hips=(0, 0.0, -0.10), R=(-0.20, -0.44, -0.64), Rp=(-0.8, 0.4, -0.3), aim=(-0.06, -0.06, 1.0),
                  L=("rel", (-0.10, -0.55, -0.38)), Lp=(0.7, 0.2, -0.6))
    xopen = _pose(dict(hips=(-4, 0, 0), spine=(-6, 0, 0), chest=(-10, 0, 0), neck=(-8, 0, 0), head=(-14, 0, 0),
                       shoulder_L=(0, 0, 3), shoulder_R=(0, 0, -3)),
                  hips=(0, 0.04, -0.12), R=(-0.80, -0.16, 0.46), Rp=(-0.3, 0.3, -0.9), aim=(-0.4, -0.2, 0.9),
                  L=("rel", (0.80, -0.16, 0.46)), Lp=(0.3, 0.3, -0.9),
                  feet=dict(l=(0.12, -0.03, 0.0), r=(-0.10, 0.04, 0.0), yl=16.0, yr=-16.0))
    xhold = _with_hips_off(anim.add(xopen, P_(chest=(-2, 0, 0), head=(-2, 0, 0))), (0, 0, -0.01))
    stamp = anim.lerp_pose(plant, xopen, 0.55)
    stamp["ik"] = dict(stamp["ik"])
    stamp["ik"].pop("hand.L", None)
    stamp["ik"]["hand.L"] = HandTarget(rel=(0.55, -0.45, 0.05), pole=(0.6, 0.3, -0.8))
    stamp["ik"]["foot.L"] = F_((0.10, -0.03, 0.07), 6.0, 14.0)
    out["cast_a3"] = mk("cast_a3", 25, keyed([
        (0.0, G, "linear"), (0.06, raise_, "out"), (0.12, plant, "accel"), (0.30, stamp, "in"), (0.40, xopen, "accel"),
        (0.72, xhold, "out"), (0.86, plant, "inout"), (1.0, G, "settle")],
        25, {"head": 1.5, "neck": 1.0}), impact=anim.IMPACT, pin=pin_hold(0.12, 0.86))

    # cast_ult Held Focus (40 f, impact f16): lift in both hands (the haft passes outside the face), tip the lens
    # 55 degrees at the target, freeze
    brace = dict(l=(0.10, -0.16, 0.0), r=(-0.10, 0.12, 0.0), yl=10.0, yr=-16.0)
    ulw = grip(_pose(dict(hips=(8, -6, 0), spine=(8, -4, 0), chest=(8, -4, 0), neck=(4, 0, 0), head=(8, 0, 0)),
                     hips=(0, 0.03, -0.10), R=(-0.12, -0.50, -0.60), Rp=(-0.7, 0.5, -0.4), aim=(-0.24, -0.26, 0.94)), 0.10)
    lift = grip(_pose(dict(hips=(-3, 0, 0), spine=(-4, 0, 0), chest=(-6, 0, 0), neck=(-4, 0, 0), head=(-8, 0, 0)),
                      hips=(0, 0.0, -0.03), R=(-0.08, -0.64, -0.30), Rp=(-0.8, 0.3, -0.3), aim=(-0.24, -0.40, 0.88),
                      feet=brace), 0.20)
    aimp = grip(_pose(dict(hips=(6, -4, 0), spine=(4, -4, 0), chest=(2, -6, 0), neck=(-4, 2, 0), head=(-2, 2, 0)),
                      hips=(0, -0.05, -0.12), R=(0.40, -0.68, -0.36), Rp=(-0.8, 0.2, -0.4), aim=(0.06, -0.82, 0.57),
                      feet=brace), 0.22, pole=(0.7, -0.2, -0.6))
    aimo = _with_hips_off(anim.lerp_pose(lift, aimp, 1.06), (0, 0, -0.004))
    hold = _with_hips_off(anim.add(aimp, P_(chest=(0.6, 0, 0))), (0, 0, -0.003))
    LENS_AT = (0.0, -1.0, -0.25)

    def ult_lens(t):
        return LENS_AT if 0.30 <= t <= 0.86 else None
    out["cast_ult"] = mk("cast_ult", 40, keyed([
        (0.0, G, "linear"), (0.12, ulw, "inout"), (0.28, lift, "inout"), (0.36, aimo, "out"), (0.40, aimp, "out"),
        (0.75, hold, "linear"), (0.88, anim.lerp_pose(hold, G, 0.6), "inout"), (1.0, G, "settle")],
        40, {"head": 1.5, "neck": 1.0}), impact=anim.IMPACT, lens=ult_lens)

    # channel: the aim hold, slow breathing (90 f loop)
    out["channel"] = mk("channel", 90, lambda t: _breathe(
        _with_hips_off(aimp, (0, 0, -0.004 * (0.5 + 0.5 * anim.osc(t, 2)))), t, 2, 0.7), loop=True, lens=LENS_AT)

    # death (50 f): recoil, the knees buckle to a kneel; the fist opens at f19 and the glaive topples forward-right
    # on its own (lands f30, the lens rolled up to the sky); she folds forward onto the ground (whole body kept on
    # the floor)
    recoil = _pose(dict(hips=(-6, 6, 0), spine=(-8, 0, 0), chest=(-12, 4, 0), neck=(-8, 0, 0), head=(-16, 6, 0)),
                   hips=(0, 0.05, -0.02), R=(-0.20, -0.30, -0.70), aim=(-0.10, 0.06, 0.99), L=("rel", (0.30, -0.40, -0.55)))
    kneel = _pose(dict(hips=(10, 0, 0), spine=(14, 0, 0), chest=(10, 0, 0), neck=(14, 0, 0), head=(18, 0, 0)),
                  hips=(0, 0.16, -hip_h * 0.46), R=(-0.16, -0.50, -0.70), aim=(-0.20, -0.30, 0.93),
                  L=("rel", (-0.05, -0.55, -0.70)))
    kneel["ik"]["foot.L"] = F_((0.02, 0.30, 0.06), -64.0, 4.0, 0.0, 0.0, 1.0)
    kneel["ik"]["foot.R"] = F_((-0.02, 0.32, 0.06), -64.0, -6.0, 0.0, 0.0, 1.0)
    k = hip_h / 0.98
    prone = P_(hips=(84, 4, 0), spine=(4, 0, 0), chest=(2, 0, 0), neck=(-14, 0, 0), head=(-18, 18, 0),
               thigh_L=(4, 0, 4), shin_L=(-10, 0, 0), foot_L=(-30, 0, 0), thigh_R=(14, 0, -4), shin_R=(-30, 0, 0),
               foot_R=(-30, 0, 0), upper_arm_L=(-20, 0, 30), forearm_L=(20, 0, 0))
    prone["hips_loc"] = (0.02, 0.10, -hip_h + 0.16 * k)
    prone["ik"] = {"hand.R": HandTarget(pos=(-0.30 * k, -0.90 * k, 0.09), pole=(-1.0, 0.0, 0.2)),
                   "aim.R": Aim((0.15, -0.99, 0.0)),
                   "hand.L": HandTarget(pos=(0.36 * k, -0.80 * k, 0.09), pole=(1.0, 0.0, 0.2))}
    fall = anim.lerp_pose(kneel, prone, 0.55)
    fall["hips_loc"] = (0.01, 0.14, -hip_h * 0.60)
    bounce = anim.add(prone, P_(chest=(-4, 0, 0), head=(-6, 0, 0)))
    bounce["hips_loc"] = (0.02, 0.10, -hip_h + 0.19 * k)
    rest = anim.add(prone, P_(head=(2, 4, 0)))
    out["death"] = mk("death", 50, keyed([
        (0.0, G, "linear"), (0.12, recoil, "snap"), (0.40, kneel, "inout"), (0.58, fall, "in"), (0.70, prone, "in"),
        (0.78, bounce, "out"), (0.88, rest, "inout"), (1.0, rest, "linear")]), body_floor=True,
        pin=pin_fall(skel, 0.38, 0.60, (-0.85, -0.53), finish.GL))

    # recall (60 f loop): kneeling, the glaive lowered before her with the lens at chest height, the left hand
    # cupped over it like a flame, head bowed over it; she breathes, the hand hovers in a slow circle, the lens
    # turns a little in the light
    rk = _pose(dict(hips=(10, -8, 0), spine=(12, 4, 0), chest=(12, 4, 0), neck=(16, 0, 0), head=(22, 0, 0)),
               hips=(0, 0.10, -hip_h * 0.40), R=(0.22, -0.60, -0.56), Rp=(-0.7, 0.6, -0.3), aim=(0.22, -0.66, 0.72),
               feet=dict(l=(0.03, -0.30, 0.0), r=(-0.02, 0.36, 0.10), yl=-6.0, yr=-8.0, pr=-62.0, kr=8.0))
    rk["toe.R"] = (60, 0, 0)

    def recall_s(t):
        b = anim.osc(t, 2)
        c1, s1 = math.cos(2 * math.pi * t), math.sin(2 * math.pi * t)
        p = anim.add(rk, P_(chest=(4.0 * b, 0, 0), spine=(1.5 * b, 0, 0), head=(-6.0 * b + 3.0, 6.0 * s1, 0),
                            neck=(-2.5 * b, 0, 0), hips=(0, 0, 2.0 * s1)))
        p = _with_hips_off(p, (0.0, 0.0, 0.012 * b))
        ik = dict(p["ik"])
        a = ik["aim.R"].dir
        ik["aim.R"] = Aim((a[0] + 0.10 * s1, a[1] + 0.06 * c1, a[2]))
        p["ik"] = ik
        q = anim.resolve(skel, _comp_raw(skel, {k_: v for k_, v in p.items() if k_ != "ik"} | {"ik": {kk: vv for kk, vv in ik.items() if kk != "hand.L"}}))
        c, nrm = _lens_world(skel, q)
        tgt = c + V((0.07 * c1, 0.03 + 0.05 * s1, 0.15 + 0.03 * b))
        ik["hand.L"] = HandTarget(pos=tuple(tgt), pole=(0.9, 0.2, -0.3))
        p["ik"] = ik
        p["hand.L"] = (0.0, 0.0, -30.0)
        return p
    out["recall"] = mk("recall", 60, recall_s, loop=True, body_floor=True,
                       lens=lambda t: (0.10 * math.sin(2 * math.pi * t), -0.45, 0.89))

    out["idle_lobby"] = mk("idle_lobby", 120, _idle_lobby(G), loop=True)
    out["victory"] = mk("victory", 60, _victory(G), lens=lambda t: (0.25, -0.35, 0.90) if t >= 0.30 else None)

    # stunned: clutching the haft in both hands, the lens wobbling (40 f loop)
    st = _pose(dict(hips=(4, 0, 0), spine=(10, 0, 0), chest=(10, 0, 0), neck=(10, 0, 0), head=(14, 0, 0)),
               hips=(0, 0.02, -0.07), R=(0.02, -0.40, -0.66), Rp=(-0.6, 0.6, -0.4), aim=(0.06, -0.12, 0.99),
               L=("prop", 0.16), Lp=(0.8, 0.3, -0.4))

    def stun_s(t):
        a, b = anim.osc(t, 1), anim.osc(t, 1, 0.25)
        p = anim.add(st, P_(hips=(0, 0, 4 * a), spine=(3 * b, 0, -3 * a), chest=(3 * b, 0, -3 * a),
                            neck=(6 * b, 0, 6 * a), head=(8 * b, 4 * a, 8 * a)))
        ik = dict(p["ik"])
        ik["aim.R"] = Aim((0.06 + 0.10 * a, -0.12 + 0.08 * b, 0.99))
        p["ik"] = ik
        return p
    out["stunned"] = mk("stunned", 40, stun_s, loop=True)
    return out


def _idle_lobby(G):
    """Shy and playful (120 f loop): the thumb tilts the lens (0-25 %), she catches a glint on the ground and
    chases the bright dot round like a toy (25-55 %), squints (55-65 %), then shades the lens with her free
    hand as if scolding it (65-85 %), and settles back."""
    st = dict(l=(0.0, -0.02, 0.0), r=(0.0, 0.03, 0.0), yl=4.0, yr=-6.0)
    adjust = _pose(dict(hips=(1, -4, 0), spine=(2, -2, 0), chest=(2, -2, 0), neck=(2, -6, 0), head=(4, -10, 0)),
                   hips=(0, 0.0, -0.02), R=(0.18, -0.46, -0.58), Rp=(-0.6, 0.6, -0.4), aim=(-0.04, -0.10, 0.99),
                   L=("prop", 0.50), Lp=(0.7, 0.0, -0.5), feet=st)
    play = _pose(dict(hips=(2, 4, 0), spine=(3, 2, 0), chest=(3, 2, 0), neck=(10, 4, 0), head=(16, 6, 0)),
                 hips=(0, 0.0, -0.025), R=(-0.10, -0.34, -0.74), Rp=(-0.6, 0.6, -0.4), aim=(0.10, -0.40, 0.91),
                 feet=st, arms_fk=dict(upper_arm_L=(4, 0, 10), forearm_L=(30, 0, 0)))
    squint = anim.add(play, P_(neck=(4, 0, 0), head=(6, 0, 0)))
    shade = _pose(dict(hips=(1, -2, 0), spine=(2, -2, 0), chest=(2, -3, 0), neck=(2, -6, 0), head=(4, -10, 0)),
                  hips=(0, 0.0, -0.02), R=(0.0, -0.36, -0.78), Rp=(-0.6, 0.6, -0.4), aim=(0.36, -0.42, 0.83),
                  L=("prop", 0.90), Lp=(0.6, 0.0, 0.2), feet=st)
    shake = anim.add(shade, P_(head=(0, 6, 0)))
    keys = [(0.0, adjust, "linear"), (0.10, anim.add(adjust, P_(head=(2, -4, 0))), "inout"), (0.20, adjust, "inout"),
            (0.30, play, "inout"), (0.55, squint, "inout"), (0.65, shade, "inout"), (0.72, shake, "inout"),
            (0.79, shade, "inout"), (0.86, anim.add(shade, P_(head=(0, 4, 0))), "inout"), (1.0, adjust, "inout")]
    base = anim.keyed(keys)

    def sample(t):
        p = base(t)
        p = _breathe(p, t, 3, 0.8)
        if 0.30 <= t <= 0.55:                               # chasing the glint: the wrist circles, the head follows
            u = (t - 0.30) / 0.25
            w = math.sin(math.pi * u)
            ik = dict(p["ik"])
            a = ik["aim.R"].dir
            ik["aim.R"] = Aim((a[0] + 0.16 * w * math.sin(4 * math.pi * u), a[1] - 0.10 * w * math.cos(4 * math.pi * u), a[2]))
            p["ik"] = ik
            p = anim.add(p, P_(head=(4 * w * math.cos(4 * math.pi * u), 14 * w * math.sin(4 * math.pi * u), 0)))
        return p

    return anim.drag(sample, 120, {"head": 2.0, "neck": 1.0}, loop=True)


def _victory(G):
    """The glaive raised high and out in the right hand with the lens tilted up into the sun, the left hand a
    visor over the brow (the face stays clear), chest open, both boots planted wide (60 f, ends in the hold)."""
    crouch = _with_hips_off(anim.add(G, P_(hips=(8, 0, 0), spine=(8, 0, 0), chest=(8, 0, 0), head=(10, 0, 0))),
                            (0, 0, -0.06))
    up = _pose(dict(hips=(-2, 6, 0), spine=(-3, 4, 0), chest=(-6, 6, 0), neck=(-4, 6, 0), head=(-10, 14, 0)),
               hips=(0, 0.02, -0.03), R=(-0.42, -0.36, 0.52), Rp=(-0.9, 0.3, -0.2), aim=(0.30, -0.30, 0.91),
               L=("rel", (-0.27, -0.40, 0.71)), Lp=(0.95, -0.25, 0.0),
               feet=dict(l=(0.06, -0.10, 0.0), r=(-0.05, 0.08, 0.0), yl=12.0, yr=-16.0),
               extra=dict(hand_L=(0, 0, -20)))
    up2 = anim.add(up, P_(chest=(-1, 0, 0)))
    keys = [(0.0, G, "linear"), (0.18, crouch, "inout"), (0.26, _with_hips_off(anim.lerp_pose(G, crouch, 1.1), (0, 0, -0.008)), "out"),
            (0.45, up, "back"), (1.0, up2, "linear")]
    return anim.drag(anim.keyed(keys), 60, {"head": 2.0, "neck": 1.0})


# ── the icon (not in the shared renders: wraps render.fighter_renders for this fighter) ──────────────────────
# Brief: "the brow eave over the eye slit and the lens ring" at 128 px. The shared icon frames the head alone
# (the ring was cut in half at the edge) over a hazy pale plate (the pale hood sank into it): this one frames the
# hood with the lens ring beside it and lays them on a darkened, vignetted plate.
ICON = {"yaw": 30.0, "pitch": 3.0, "z0": -0.10, "z1": 0.31, "lens_pull": 0.30, "fill": 0.80, "bg_gain": 0.52}


def _icon(ctx, objs, P, fast: bool, scale: float):
    R = _render
    spec = ctx.spec
    arm = ctx.info.armature
    cfg = R._splash_cfg(spec, None)
    light = R.map_lighting(cfg["map"])
    clips = R.fighter_clips(ctx)
    R.pose_frame(arm, spec.MOTION, cfg["portrait_clip"], t=cfg["portrait_t"], chains=[], clips=clips)
    head = R.bone_pos(arm, "head")
    lens = R.bone_pos(arm, "x_lens")
    c = head.lerp(lens, ICON["lens_pull"])
    lo = V((c.x - 0.1, c.y - 0.1, head.z + ICON["z0"]))
    hi = V((c.x + 0.1, c.y + 0.1, head.z + ICON["z1"]))
    cam = bpy.data.objects.get("vale_cam") or R.camera(lens=50)
    R.sky_world(light["sky"], light["ambient"], camera_strength=1.0)
    R._fit_camera(cam, lo, hi, ICON["yaw"], ICON["pitch"], 85.0, ICON["fill"], 1.0, 0.5)
    R.bible_lights(cam, cfg, light, rim=1.2, scale=0.6, pair=True, target=(lo + hi) * 0.5)
    t0 = __import__("time").perf_counter()
    S = 8 if fast else 1
    sz = max(32, int(round(128 * scale)))
    plate = R.backdrop_plate(cam, cfg, light, sz, sz, os.path.join(P["renders"], "_iplate.png"), fast, paint_r=1)
    R.setup(2 * sz, 2 * sz, max(16, 96 // S), view="Khronos PBR Neutral")
    raw = os.path.join(P["renders"], "icon_raw.png")
    R.render(raw)
    imageops.denoise(raw)
    fg = imageops.premul_resize(imageops.load(raw), sz, sz)
    os.remove(raw)
    yy, xx = np.mgrid[0:sz, 0:sz].astype(np.float32) / max(1, sz - 1)
    vig = 1.0 - 0.35 * np.clip(((xx - 0.55) / 0.7) ** 2 + ((yy - 0.45) / 0.7) ** 2, 0.0, 1.0)
    bg = plate.copy()
    bg[..., :3] = bg[..., :3] * ICON["bg_gain"] * vig[..., None]
    dest = (os.path.join(P["renders"], "preview_icon.png") if abs(scale - 1.0) > 1e-6
            else os.path.join(P["out"], "icon.png"))
    imageops.save(imageops.grade(imageops.over(fg, bg)), dest, alpha=False)
    for o in list(bpy.context.scene.objects):
        if o.type == "LIGHT" and o.name.startswith("vale_key_sun"):
            o.hide_render = True
    cam.data.shift_x = cam.data.shift_y = 0.0
    anim.apply_pose(arm, {})
    return dest, round(__import__("time").perf_counter() - t0, 2)


_orig_fighter_renders = _render.fighter_renders


def _fighter_renders(ctx, objs, P, skin, fast=False, clip_sheet=False, only=None, scale=1.0):
    if getattr(ctx.spec, "ID", None) != ID or skin:
        return _orig_fighter_renders(ctx, objs, P, skin, fast=fast, clip_sheet=clip_sheet, only=only, scale=scale)
    rest = (set(only) - {"icon"}) if only else {"splash", "portrait", "turntable"}
    res = {"files": {}, "seconds": {}}
    if rest:
        res = _orig_fighter_renders(ctx, objs, P, skin, fast=fast, clip_sheet=clip_sheet, only=rest, scale=scale)
    if not only or "icon" in only:
        f, sec = _icon(ctx, objs, P, fast, scale)
        res["files"]["icon"] = scene.rel(f)
        res["seconds"]["icon"] = sec
    return res


_render.fighter_renders = _fighter_renders


# ── the base model ──────────────────────────────────────────────────────────────────────────────────
def model(ctx) -> list:
    P = []
    extra = (ctx.skin or {}).get("extra") or {}
    items = sculpts() + skin_extras(extra)
    if ctx.skin is None:                       # part ids -> names for proto/kemdo_qa.py (the cached .blend)
        scene.write_json(os.path.join(scene.CACHE_DIR, "fighters", "kemdo_parts.json"), [it[0] for it in items])
    for name, S, vs, role, bind, tris, uvw in items:
        v, q = S.mesh(VOXEL * vs)
        ob = sdf.to_object(f"{name}_high", v, q, ctx.col)
        ob.data.materials.append(ctx.mats[role])
        P.append(fighter.Part(name, high=ob, tris=tris, bind=bind, uv_weight=uvw))
    return P


if __name__ == "__main__":
    fighter.main(sys.modules[__name__])
