"""lisvel: Morning archer (Slinger, Aubade). ART 2.0: sculpted volumes painted by concept projection.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/lisvel_plates.py                # plates
    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/lisvel_fit.py
    python3 art/build.py fighter lisvel --no-skins --clip-sheet

Brief: _design/fighters/lisvel.md. Concept: _design/concept/lisvel.webp (front + back, hand-painted).
The forms are numpy SDF volumes (common/hifi/sdf.py) fitted to the concept on a 10 cm grid (the head-wrap crown
1.85 m = the plates' scale); the base colour is the concept painting projected occlusion-aware onto the game mesh
(common/hifi/project.py via PROJECTION), re-toned part by part onto the concept's own material colours; the bow,
its string and glass caps, the arrows, hands, visor and brooch are painted procedurally (a thin prop projects badly
edge-on; the plates have the painted bow inpainted out, proto/lisvel_plates.py); normals and AO bake from the sculpt.

Where the concept and the brief disagree the concept's look wins (it is the approved painting): the chalk head-wrap
wound as a turban over a carved chalk face-plate with a flat pale-blue glass visor band, the pale linen cowl, the
steel-blue tabard with stiff shoulder wings and grey trims over a linen tunic, white linen sleeves, dark wrapped
bracers on both forearms, crossed leather straps and a belt, a brown leather quiver on the RIGHT hip (the drawing
hand's side), dark leggings in tall dark-grey boots, and the pale recurve held level across her front, string up,
the left hand on the grip and the right hand on the string. The brief wins on what is geometry and on the game read:
the glass tip caps carry the accent, the string is the only non-rigid prop part (x_string), the arrows of a shot are
VFX. The bow sits 7 cm lower than the painting and its chord is 1.46 m (painting ~1.53): at the game camera (52
degrees) the far tip of a bow across her body rises h*50.5 + r*64.7 px in a lane facing, and must stay under the HP
bar ((art.height + 0.35) * 50.5 - 12 px).

Not in the shared pipeline, implemented here (module-level wrappers; common/ untouched):
  * the arms' rest pose on the concept's carry, prop.L on the bow's grip (+Y = the shot, +Z = the upper limb), prop.R
    on the string pinch, x_string (the string's draw), x_fan (Morning Draw's fan of arrows), sockets;
  * a right-hand target that blends between a free (shoulder-relative) reach and a pinch on the bow's arrow line
    (anim._solve_hand wrapper), an aim with roll for the bow (AimRoll), the foot-pitch fix the peers use;
  * x_string location and x_fan scale keys written from per-pose channels ("_str", "_fan") in every clip and in
    every posed render (anim.write_action / anim.apply_pose wrappers);
  * analytic skin weights for the tabard's lower panels, the linen tunic and the string;
  * the paint pass (project.paint wrapper) and the skins' recolour.
"""
from __future__ import annotations

import math
import os
import sys
from dataclasses import dataclass

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy  # noqa: E402,F401
import numpy as np  # noqa: E402
from mathutils import Matrix, Quaternion, Vector  # noqa: E402

from common import anim, fighter, materials, rig, scene  # noqa: E402
from common.hifi import sdf  # noqa: E402
from common.hifi.sdf import (Capsule, Ellipsoid, FlatCapsule, HalfSpace, RoundBox, RoundCone,  # noqa: E402
                             Sculpt, Sphere, Torus, Tube)

V = Vector
ID = "lisvel"
TITLE = "Morning archer"
ROLE_MASS = "slinger"
ORIGIN = "aubade"
CARD = {"primary": "#D8D2C2", "secondary": "#8E9AA6"}

# rig fitted to the sculpt: the head's crown under the wrap 1.86, skull base 1.628, neck base 1.568, shoulder joints
# x 0.185 at 1.478, hips x 0.095 at 0.95, knees 0.50, ankles x 0.145 at 0.09. The arms are re-placed in rig_extras.
PROPORTIONS = rig.proportions(height=1.86, head=0.27, neck=0.06, shoulder_width=0.37, hip_width=0.19, leg=0.861,
                              thigh_frac=0.52, arm=0.56, upper_arm_frac=0.51, hand=0.19, foot=0.26,
                              ankle_height=0.09, spine_curve=0.02, stance=0.05, toe_out_deg=8.0, knee_bend=0.015,
                              a_pose_deg=62.0, arm_forward_deg=10.0, elbow_bend_deg=20.0, shoulder_drop=0.09)
MATERIAL_SET = "bible"
# the concept's own material colours (sampled on the sheet): the chalk wrap and face-plate, the linen cowl and
# sleeves, the steel-blue tabard (hue 203, 23 %: under the 40 % reserved-hue ceiling), the dark leather, the brown
# quiver, the dark leggings and boots, the pale ash bow
# (each role at the albedo the paint pass actually lands the part on: the skins' recolour is skin / base per channel)
PALETTE = materials.bible_palette(chalk="#B6B1A7", dawnglass="#93BCD8", wood="#C9C1B1", cloth2="#AAA69E",
                                  stone="#A9B6C0", cloth="#4C6272", leather="#3F3630", under="#241E1C",
                                  ink="#17181B", accent="#3F9CFF", ironstone="#4A4743", skin="#B48F78",
                                  wrap="#A9A69F", boots="#2D2A28", quiver="#5A4A3C", linen="#7E796F", rope="#9A8F7A",
                                  fletching="#9DAFBE")
VALUE_GRADIENT_STOPS = materials.BIBLE_GRADIENT_STOPS
SOCKETS = {"weapon": "prop.R", "arrow_nock": "x_arrow_nock", "bow_tip_l": "x_bow_tip_l", "bow_tip_r": "x_bow_tip_r",
           "weapon_tip": "x_arrow_nock", "quiver": "x_quiver"}
SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92, "yaw": 22.0, "rim_cool": 0.35, "rim_warm": 0.45,
          "portrait_clip": "idle_lobby", "portrait_t": 0.0, "portrait_yaw": 28.0}
TEXTURE_SIZE = 2048
TEXTURE_SIZES = {"normal": 512, "orm": 256}
GLB_COMPRESS = True
ARMOUR_CONFORM = False
AO_INTO_BASE = 0.25

HEIGHT = 1.85             # the head-wrap crown in the concept (the projection plates' scale)
PROJECTION = {"concept": "lisvel", "height": HEIGHT}
NOISE = sdf.Noise(12)
VOXEL = 0.007
ART_HEIGHT_PAD = 0.05     # FighterArt.height = mesh top + 5 cm (the HP bar's anchor - 0.35 m; the load test allows 6)

# skins: the brief's palettes (section 9) re-colour the painting by role; the identity parts land ON the named colour
# the brief's skin tables (section 9) are written against ITS base palette (paler than the painting): the named identity
# colours are used as named (Gorgewalk's slate limbs and rope, Almanac's parchment limbs and ink fletching), every
# other role takes the brief's own change (skin / brief base) on top of the colour the paint lands the part on
BRIEF_BASE = {"chalk": "#D6D2C6", "wrap": "#D6D2C6", "cloth2": "#CFCEC6", "cloth": "#707D8B", "wood": "#D4C3A2"}


def _hl0(h):
    h = h.lstrip("#")
    c = np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _lh0(c):
    c = np.clip(c, 0, 1)
    s_ = np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)
    return "#" + "".join(f"{int(round(v * 255)):02X}" for v in s_)


def _skin_pal(identity: dict, relative: dict) -> dict:
    out = dict(identity)
    for role, hx in relative.items():
        out[role] = _lh0(_hl0(PALETTE[role]) * _hl0(hx) / np.maximum(_hl0(BRIEF_BASE[role]), 1e-4))
    return out


SKINS: list = [
    {"id": "lisvel_gorgewalk", "extra": {"rope_bind": True}, "card": {"primary": "#6E747C", "secondary": "#9A8F7A"},
     "palette": _skin_pal({"wood": "#6E747C", "rope": "#9A8F7A", "ironstone": "#3F4348", "quiver": "#545A61"},
                          {"chalk": "#D2D2CE", "wrap": "#D2D2CE", "cloth2": "#CFCFCA", "cloth": "#6B7885"})},
    {"id": "lisvel_almanac", "extra": {"page_fletching": True}, "card": {"primary": "#4A4640", "secondary": "#D8CDB4"},
     "palette": _skin_pal({"wood": "#D8CDB4", "fletching": "#2E2A26", "cloth": "#5E6369"}, {})},   # parchment-grey tabard
]
SKIN_FLAT = {}


def _n(v):
    v = np.asarray(v, dtype=np.float64)
    return v / (np.linalg.norm(v) + 1e-12)


# ── fitted geometry (metres; the model faces -Y, her right = -X) ─────────────────────────────────────────────────
# THE BOW. Its frame: U along the chord (toward her left tip at rest), D from the string toward the grip (the shot's
# direction; at rest forward and down: the bow's plane tilted BETA from the vertical, belly forward), N = U x D.
BETA = 18.0
U_REST = np.array([1.0, 0.0, 0.0])
D_REST = np.array([0.0, -math.sin(math.radians(BETA)), -math.cos(math.radians(BETA))])
N_REST = np.cross(U_REST, D_REST)
S0 = np.array([0.06, -0.165, 1.10])                  # the string's centre at rest (the nock point)
BRACE = 0.22                                          # string -> grip
GRIP_L = S0 + D_REST * BRACE                          # the grip's centre (prop.L)
HALF = 0.73                                           # half the chord (tip to tip 1.46 m)
# the limb's centreline: distance from the string line toward the belly (along D) by |u| (the painting's curve:
# a flat faceted grip, limbs sweeping up to the tips, a small recurve at the very ends)
PROF_U = (0.0, 0.10, 0.17, 0.24, 0.32, 0.42, 0.52, 0.60, 0.66, 0.70, 0.725, 0.74)
PROF_V = (0.22, 0.219, 0.214, 0.203, 0.180, 0.142, 0.096, 0.056, 0.028, 0.012, 0.004, 0.0)
LIMB_W = ((0.0, 0.054), (0.17, 0.052), (0.30, 0.046), (0.60, 0.036), (0.74, 0.028))     # across the plane (N)
LIMB_T = ((0.0, 0.040), (0.15, 0.038), (0.20, 0.027), (0.50, 0.022), (0.74, 0.016))     # in the plane
CAP0, CAP1 = 0.645, 0.745                              # the glass tip caps along |u|
NOCK_U = 0.718                                         # where the string meets each tip
PINCH_U = -0.12                                        # the right hand's pinch on the string at rest
HAND_U = 0.15                                          # the left fist at rest: on the riser's end (the painting's);
                                                       # in a shot the bow slides (prop.L location, "_slide") so the
                                                       # grip's centre comes into the fist


def prof_v(au):
    return np.interp(np.abs(au), PROF_U, PROF_V)


def _tab(tab, au):
    a, b = zip(*tab)
    return np.interp(np.abs(au), a, b)


def bow_pt(u, v_extra=0.0, n=0.0, S=S0, U=U_REST, D=D_REST, N=N_REST):
    """a point of the bow (rest frame by default): along the chord u, the limb's centreline + v_extra toward the
    belly, n across the plane"""
    return S + U * u + D * (prof_v(u) + v_extra) + N * n


def bow_tangent(u, U=U_REST, D=D_REST):
    du = 1e-3
    a, b = bow_pt(u - du, U=U, D=D), bow_pt(u + du, U=U, D=D)
    return _n(b - a)


TIP_L, TIP_R = bow_pt(NOCK_U), bow_pt(-NOCK_U)
STRING_A, STRING_B = S0 + U_REST * NOCK_U, S0 - U_REST * NOCK_U
PINCH_R = S0 + U_REST * PINCH_U                        # prop.R at rest
HAND_L = bow_pt(HAND_U)                                # the left fist's centre at rest

# THE ARMS (rest = the concept's carry), solved for fixed bone lengths
SH_R, SH_L = np.array([-0.185, 0.01, 1.478]), np.array([0.185, 0.01, 1.478])
UA, FA = 0.295, 0.285
WR_R = PINCH_R + np.array([-0.072, 0.040, 0.050])      # the right wrist: back along the forearm from the pinch
WR_L = HAND_L + np.array([0.012, 0.036, 0.072])         # the left wrist: above and behind the fist


def _elbow(sh, wr, l1, l2, pole):
    d = wr - sh
    L = float(np.linalg.norm(d))
    a = d / L
    L = min(L, l1 + l2 - 1e-3)
    p = np.asarray(pole, float) - a * (a @ pole)
    p = _n(p)
    u = (l1 * l1 - l2 * l2 + L * L) / (2 * L)
    v = math.sqrt(max(0.0, l1 * l1 - u * u))
    return sh + a * u + p * v


EL_R = _elbow(SH_R, WR_R, UA, FA, (-0.7, 0.6, -0.4))
EL_L = _elbow(SH_L, WR_L, UA, FA, (0.75, 0.55, -0.35))
L_ARM = UA + FA

# THE QUIVER: a leather tube at the right hip, slightly tilted (mouth in, bottom out), arrows standing in it
Q_BOT = np.array([-0.255, 0.035, 0.705])
Q_TOP = np.array([-0.222, 0.012, 1.215])
Q_U = _n(Q_TOP - Q_BOT)
Q_N = _n(np.array([-1.0, 0.0, 0.0]) - Q_U * Q_U[0])     # out from her hip
Q_W = np.cross(Q_U, Q_N)
Q_HW, Q_HD = 0.047, 0.040
ARROWS = [(-0.020, -0.012, 0.11, 4.0, 0.0), (0.012, -0.016, 0.135, -3.0, 40.0), (-0.004, 0.014, 0.10, 2.0, 80.0),
          (0.022, 0.012, 0.12, -6.0, 15.0), (-0.024, 0.016, 0.125, 7.0, 60.0)]   # (w, n offsets, rise over rim, lean deg, vane turn)

HEAD_C = np.array([0.0, 0.006, 1.735])


# ── shaping helpers ────────────────────────────────────────────────────────────────────────────────────────────
def folds(amp, freq, axis=0, phase=0.0, zfade=None):
    def fn(P):
        u = P[:, axis] * freq + phase + 0.7 * NOISE(P, 3.0)
        a = amp
        if zfade is not None:
            z0, z1 = zfade
            a = amp * np.clip((z0 - P[:, 2]) / (z0 - z1), 0.2, 1.0)
        return a * (np.abs(np.sin(u)) * 2.0 - 1.0) * -0.5
    return fn


def soft_folds(amp, freq, axis=0, phase=0.0):
    def fn(P):
        u = P[:, axis] * freq + phase + 0.7 * NOISE(P, 3.0)
        return amp * 0.5 * np.sin(u)
    return fn


def hfolds(amp, freq, phase=0.0, tilt=(0.0, 0.0)):
    def fn(P):
        u = (P[:, 2] + tilt[0] * P[:, 0] + tilt[1] * P[:, 1]) * freq + phase + 0.5 * NOISE(P, 4.0)
        return amp * 0.5 * np.sin(u)
    return fn


def wraps(amp, pitch, a, b, slant=0.35, phase=0.0):
    """helical cloth bands round the segment a -> b: ridges every `pitch` metres, crossing at `slant`"""
    a, b = np.asarray(a, float), np.asarray(b, float)
    u = _n(b - a)
    e1 = _n(np.cross(u, [0.0, 0.0, 1.0]) if abs(u[2]) < 0.9 else np.cross(u, [1.0, 0.0, 0.0]))
    e2 = np.cross(u, e1)

    def fn(P):
        q = P - a
        t = q @ u
        th = np.arctan2(q @ e2, q @ e1)
        ph = t / pitch + slant * th / (2 * math.pi) + phase + 0.15 * NOISE(P, 6.0)
        f = ph - np.floor(ph)
        ridge = np.clip(1.0 - np.abs(f - 0.5) * 4.0, 0.0, 1.0)
        groove = np.exp(-((f - 0.02) / 0.05) ** 2) + np.exp(-((f - 1.02) / 0.05) ** 2)
        return -amp * 0.5 * ridge + amp * groove
    return fn


def turban(P):
    """the head-wrap's wound bands: broad bands slanting round the head (up toward her right at the back, as the
    painting), a soft seam between them"""
    q = P - HEAD_C
    th = np.arctan2(q[:, 0], q[:, 1])
    ph = (q[:, 2] + 0.035 * np.sin(th) + 0.012 * NOISE(P, 9.0)) / 0.026
    f = ph - np.floor(ph)
    seam = np.exp(-((f - 0.05) / 0.09) ** 2) + np.exp(-((f - 1.05) / 0.09) ** 2)
    return 0.0038 * seam - 0.0012 * np.sin(np.pi * f)


def chips(amp, freq):
    def fn(P):
        return amp * np.clip(NOISE.ridged(P, freq, 3), 0, 1) - amp * 0.3
    return fn


def strap(S, pts, normal_fn, w, t, k=0.006):
    """a flat band through `pts` lying on a surface (normal_fn(p) -> outward normal): half width w, half thickness t"""
    for i in range(len(pts) - 1):
        a, b = np.asarray(pts[i], float), np.asarray(pts[i + 1], float)
        n = _n(normal_fn((a + b) * 0.5))
        side = _n(np.cross(b - a, n))
        S.add(FlatCapsule(a, b, w, t, w, t, side=side), k=k)


def torso_normal(p):
    c = np.array([0.0, 0.0, max(1.05, min(1.45, p[2]))])
    return _n((np.asarray(p) - c) * np.array([1.0, 1.3, 0.25]))


def fist(name, grip, axis, wrist, knuckle, shaft_r, scale=1.0, index_fwd=1.0, curl=1.0):
    """a sculpted fist round a shaft: palm toward the wrist, four curled fingers round the shaft (index on the
    `index_fwd` side along the axis), knuckle rolls, a thumb wrapped the other way (Ulkro's hand)"""
    S = Sculpt(name)
    u = _n(axis)
    g = np.asarray(grip, float)
    toward_w = np.asarray(wrist, float) - g
    bk = _n(toward_w - u * (toward_w @ u))
    kn = _n(np.asarray(knuckle, float) - u * (u @ knuckle))
    q = _n(np.cross(u, kn))
    fr = 0.0118 * scale
    rf = shaft_r + fr * 0.95
    S.add(Ellipsoid(g + bk * 0.046 * scale + kn * 0.006, (0.048 * scale, 0.034 * scale, 0.027 * scale),
                    axes=np.stack([u, bk, np.cross(u, bk)])), k=0.0)
    S.add(Capsule(g + bk * 0.075 * scale, np.asarray(wrist, float) + bk * 0.005, 0.030 * scale), k=0.025)
    for i in range(4):
        s = (1.5 - i) * 0.0235 * scale * index_fwd
        c = g + u * s
        ln = 1.0 - 0.07 * abs(i - 1)
        ths = np.radians(np.array([-35.0, 25.0, 95.0, 165.0, 230.0 * ln]) * np.array([1, 1, curl, curl, curl]))
        pts = [c + rf * (np.cos(t) * kn + np.sin(t) * q) for t in ths]
        pts[0] = pts[0] + bk * 0.022 * scale
        S.add(Tube(pts, [fr * 1.05, fr, fr * 0.96, fr * 0.9, fr * 0.82], k=0.006), k=0.006)
        S.add(Sphere(c + kn * (rf + 0.004) + bk * 0.012 * scale, fr * 1.05), k=0.008)
    tb = g + bk * 0.04 * scale - u * 0.03 * scale * index_fwd - q * 0.022 * scale
    S.add(Tube([tb, g - q * (rf + 0.004) + bk * 0.012 - u * 0.006 * index_fwd,
                g - q * (rf * 0.6) - kn * (rf * 0.85) + u * 0.022 * scale * index_fwd],
               [0.015 * scale, 0.0125 * scale, 0.011 * scale], k=0.006), k=0.012)
    return S


def pinch(name, pt, string_dir, wrist, scale=1.0):
    """the drawing hand on the string: palm back toward the wrist, index and middle fingers hooked over the string,
    the ring and little fingers curled into the palm, the thumb tucked along the index (an archer's hook)"""
    S = Sculpt(name)
    u = _n(string_dir)
    g = np.asarray(pt, float)
    tw = np.asarray(wrist, float) - g
    bk = _n(tw - u * (tw @ u))
    q = _n(np.cross(u, bk))
    s = scale
    S.add(Ellipsoid(g + bk * 0.055 * s, (0.047 * s, 0.036 * s, 0.026 * s), axes=np.stack([u, bk, q])), k=0.0)
    S.add(Capsule(g + bk * 0.085 * s, np.asarray(wrist, float), 0.029 * s), k=0.025)
    fr = 0.0115 * s
    for i, (du, hook) in enumerate(((0.024, 1.0), (0.0, 1.0), (-0.023, 0.6), (-0.043, 0.45))):
        c = g + u * du * s
        pts = [c + bk * 0.030 * s, c + bk * 0.004 * s - q * 0.010 * s, c - bk * 0.010 * s - q * 0.004 * s * hook,
               c - bk * 0.006 * s + q * (0.012 * hook) * s]
        if hook < 0.9:
            pts = [c + bk * 0.030 * s, c + bk * 0.018 * s - q * 0.014 * s, c + bk * 0.024 * s + q * 0.004 * s]
        S.add(Tube(pts, [fr * 1.05] + [fr] * (len(pts) - 2) + [fr * 0.85], k=0.005), k=0.007)
        S.add(Sphere(c + bk * 0.028 * s - q * 0.012 * s, fr * 1.05), k=0.008)
    S.add(Tube([g + bk * 0.05 * s + u * 0.028 * s + q * 0.012 * s, g + bk * 0.02 * s + u * 0.034 * s - q * 0.004 * s,
                g + bk * 0.012 * s + u * 0.024 * s - q * 0.016 * s], [0.014 * s, 0.012 * s, 0.010 * s], k=0.006), k=0.01)
    return S


class _Band(sdf.Prim):
    """a flat band round an elliptical waist (radii rx, ry at its mid-thickness): rectangular section of half
    thickness t and half height h, edges rounded by `rr`; `slope` tilts it (dz per metre of x)"""

    def __init__(self, c, rx, ry, t, h, rr=0.004, slope=0.0, front_dip=0.0):
        self.c = np.asarray(c, float)
        self.rx, self.ry, self.t, self.h, self.rr, self.slope, self.dip = rx, ry, t, h, rr, slope, front_dip

    def bounds(self):
        e = max(self.rx, self.ry) + self.t + 0.01
        dz = self.h + abs(self.slope) * e + abs(self.dip) + 0.02
        return self.c - (e, e, dz), self.c + (e, e, dz)

    def d(self, P):
        q = P - self.c
        th = np.arctan2(q[:, 1] / self.ry, q[:, 0] / self.rx)
        R = np.hypot(self.rx * np.cos(th), self.ry * np.sin(th))
        r = np.hypot(q[:, 0], q[:, 1])
        zz = q[:, 2] - self.slope * q[:, 0] - self.dip * np.clip(-q[:, 1] / self.ry, 0, 1)
        a = np.abs(r - R) - (self.t - self.rr)
        b = np.abs(zz) - (self.h - self.rr)
        return np.hypot(np.maximum(a, 0), np.maximum(b, 0)) + np.minimum(np.maximum(a, b), 0) - self.rr


class _VisorBand(sdf.Prim):
    """the flat glass visor: a band 4.2 cm tall round the front of the face (radius about the head's vertical
    axis), flat-fronted (a large radius across the front), its ends turning back into the wrap"""

    def __init__(self, c, R, t, h, half_ang):
        self.c = np.asarray(c, float)
        self.R, self.t, self.h, self.ha = R, t, h, math.radians(half_ang)

    def bounds(self):
        e = self.R + self.t + 0.02
        return self.c - (e, e, self.h + 0.02), self.c + (e, 0.0, self.h + 0.02)

    def d(self, P):
        q = P - self.c
        # a flattened front: the radius grows across the front (x stretched)
        r = np.hypot(q[:, 0] * 0.80, q[:, 1])
        ang = np.arctan2(q[:, 0], -q[:, 1])
        a = np.abs(r - self.R) - self.t
        b = np.abs(q[:, 2]) - self.h
        c = (np.abs(ang) - self.ha) * self.R
        box = np.maximum(np.maximum(a, b), c)
        return box


MASK_C, MASK_R = np.array([0.0, -0.046, 1.712]), np.array([0.072, 0.060, 0.103])


class _VisorShell(sdf.Prim):
    """the glass visor band laid ON the face-plate (the painting's, flush): the mask's own surface grown 7 mm, its
    front cut flat across the eyes (a straight bar), 4.1 cm tall, ending at the mask's sides under the wrap"""

    def bounds(self):
        return np.array([-0.095, -0.135, 1.70]), np.array([0.095, -0.03, 1.76])

    @staticmethod
    def _ell(P, c, R):
        q = (P - c) / R
        k0 = np.linalg.norm(q, axis=1)
        k1 = np.linalg.norm(q / R, axis=1)
        return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)

    def d(self, P):
        dm = self._ell(P, MASK_C, MASK_R)
        outer = np.maximum(dm - 0.0070, -(P[:, 1] + 0.1120))
        band = np.abs(P[:, 2] - 1.731) - 0.0205
        side = np.abs(P[:, 0]) - 0.090
        back = P[:, 1] + 0.055
        return np.maximum(np.maximum(np.maximum(outer, -(dm + 0.001)), band), np.maximum(side, back))


def _with_disp(S: Sculpt, fn, amp):
    S2 = Sculpt(S.name)
    for op, prim, k, tag in S.ops:
        if op == "add":
            prim = prim.displaced(fn, amp)
        S2.ops.append((op, prim, k, tag))
    return S2


class _HemCut(sdf.Prim):
    """inside = above the hem height function"""

    def __init__(self, hfn):
        self.hfn = hfn

    def bounds(self):
        return np.array([-1.0, -1.0, -0.5]), np.array([1.0, 1.0, 2.5])

    def d(self, P):
        return self.hfn(P) - P[:, 2]


class _Slit(sdf.Prim):
    """a vertical slit through a skirt (front, back or side), from z_top down, half width growing toward the hem"""

    def __init__(self, x0, axis, z_top, half_top, half_hem, z_hem=0.75, sign=-1.0):
        self.x0, self.axis, self.zt = x0, axis, z_top
        self.h0, self.h1, self.zh, self.sign = half_top, half_hem, z_hem, sign

    def bounds(self):
        return np.array([-0.6, -0.6, 0.3]), np.array([0.6, 0.6, self.zt + 0.02])

    def d(self, P):
        t = np.clip((self.zt - P[:, 2]) / max(1e-6, self.zt - self.zh), 0.0, 1.3)
        half = self.h0 + (self.h1 - self.h0) * t
        if self.axis == "x":                    # a front/back slit: across x, on the side sign*y > 0
            dx = np.abs(P[:, 0] - self.x0) - half
            dy = -self.sign * P[:, 1]
        else:                                   # a side slit: across y, on the side sign*x > 0
            dx = np.abs(P[:, 1] - self.x0) - half
            dy = -self.sign * P[:, 0]
        dz = P[:, 2] - self.zt
        return np.maximum(np.maximum(dx, dy), dz)


def _tabard_hem(P):
    """the tabard panels' hem: 0.79 m, the front corners a little lower, a soft wave"""
    x, y = P[:, 0], P[:, 1]
    h = 0.792 - 0.012 * np.clip((np.abs(x) - 0.06) / 0.10, 0, 1) + 0.006 * NOISE(P * np.array([1, 1, 0]), 7.0)
    return h


def _tunic_hem(P):
    """the linen tunic's hem: pointed at the front and back centre (0.755), 0.785 at the sides"""
    x = P[:, 0]
    return 0.756 + 0.06 * np.clip(np.abs(x) / 0.12, 0, 1) ** 1.3 + 0.004 * NOISE(P * np.array([1, 1, 0]), 9.0)


# ── the sculpt ─────────────────────────────────────────────────────────────────────────────────────────────────
def bow_limb_segments(S: Sculpt, U=U_REST, D=D_REST, N=N_REST, S_=S0, k=0.012, n_seg=44, grow=0.0):
    us = np.linspace(-HALF - 0.012, HALF + 0.012, n_seg + 1)
    for i in range(n_seg):
        a, b = us[i], us[i + 1]
        um = 0.5 * (a + b)
        pa = bow_pt(a, S=S_, U=U, D=D, N=N)
        pb = bow_pt(b, S=S_, U=U, D=D, N=N)
        w = float(_tab(LIMB_W, um)) * 0.5 + grow
        t = float(_tab(LIMB_T, um)) * 0.5 + grow
        tan = _n(pb - pa)
        side = _n(N - tan * (tan @ N))
        S.add(FlatCapsule(pa, pb, w, t, w, t, side=side), k=k)


def sculpts() -> list:
    """(name, Sculpt, voxel scale, material role, bind, tris, uv weight) in build order"""
    out = []

    def part(name, S, role, bind, tris, vs=1.0, uvw=1.0):
        out.append((name, S, vs, role, bind, tris, uvw))

    # HEAD-WRAP (rigid on the head): a wound turban over the crown, the back and the sides of the face, the face
    # opening framing the mask
    wrap = Sculpt("wrap")
    wrap.add(Ellipsoid(HEAD_C + (0.0, 0.010, 0.032), (0.100, 0.112, 0.116)), k=0.0)                 # crown 1.883
    wrap.add(Ellipsoid(HEAD_C + (0.0, 0.040, 0.010), (0.094, 0.100, 0.108)), k=0.04)                # back bulge
    wrap.add(Ellipsoid(HEAD_C + (0.0, 0.004, -0.075), (0.096, 0.100, 0.070)), k=0.05)               # sides to the jaw
    wrap.add(Capsule((0.0, 0.03, 1.60), (0.0, 0.02, 1.66), 0.072), k=0.04)                          # the nape
    wrap.sub(Ellipsoid((0.0, -0.118, 1.695), (0.070, 0.075, 0.098)), k=0.014)                        # the face opening
    wrap.inter(HalfSpace((0, 0, 1.585), (0, 0, -1), 1.0), k=0.02)
    part("wrap", _with_disp(wrap, turban, 0.003), "wrap", "bone:head", 1050, uvw=1.6)

    # FACE-PLATE (rigid on the head): a carved chalk face, serene: brow, nose, closed lips, chin; the facets are the
    # painting's incised lines
    # (build 3 portrait: the deep shell with a beak nose, cheekbone knobs and a jutting chin read as an aged face; the
    # painting's plate is a broad, shallow, serene face: a flatter oval, a soft nose ridge, small closed lips)
    mask = Sculpt("mask")
    mask.add(Ellipsoid(MASK_C, MASK_R), k=0.0)
    mask.inter(HalfSpace((0, -0.050, 1.7), (0, 1, 0), 1.0), k=0.012)
    mask.add(RoundCone((0.0, -0.1020, 1.724), (0.0, -0.1135, 1.684), 0.007, 0.0115), k=0.016)       # nose ridge
    mask.add(Ellipsoid((0.0, -0.1045, 1.652), (0.017, 0.006, 0.0045)), k=0.006)                     # upper lip
    mask.add(Ellipsoid((0.0, -0.1025, 1.641), (0.015, 0.006, 0.0045)), k=0.006)                     # lower lip
    mask.sub(Ellipsoid((0.0, -0.1080, 1.6465), (0.017, 0.003, 0.0012)), k=0.0015)                   # lip line
    part("mask", mask, "chalk", "bone:head", 1100, vs=0.55, uvw=2.4)
    vis = Sculpt("visor")
    vis.add(_VisorShell(), k=0.0)
    part("visor", vis, "dawnglass", "bone:head", 500, vs=0.45, uvw=1.6)
    neck = Sculpt("neck")
    neck.add(Capsule((0.0, 0.012, 1.52), (0.0, 0.002, 1.630), 0.040), k=0.0)
    part("neck", neck, "skin", "bone:neck", 260, vs=0.8)

    # COWL (zblend chest -> neck): the pale linen scarf wound round the neck, draped over the upper chest in a soft
    # V and over the shoulders, a wider collar at the back
    cowl = Sculpt("cowl")
    cowl.add(Torus((0.0, 0.006, 1.588), 0.070, 0.036, axes=np.diag([1.0, 1.10, 1.0]), rz=0.038)
             .displaced(hfolds(0.006, 70.0, tilt=(0.4, 0.0)), 0.006), k=0.0)
    cowl.add(Ellipsoid((0.0, -0.080, 1.528), (0.130, 0.036, 0.058)).displaced(soft_folds(0.007, 45.0, axis=0), 0.007), k=0.04)
    cowl.add(Ellipsoid((0.0, 0.070, 1.535), (0.170, 0.062, 0.075)).displaced(hfolds(0.006, 55.0), 0.006), k=0.04)
    for sx in (-1, 1):
        cowl.add(Ellipsoid((sx * 0.120, 0.0, 1.538), (0.075, 0.085, 0.040), axes=sdf.rot_y(sx * -18)), k=0.04)
    cowl.inter(HalfSpace((0, 0, 1.475), (0, 0, -1), 1.0), k=0.02)
    part("cowl", cowl, "cloth2", ("zblend", "chest", "neck", 1.54, 1.62), 900, uvw=1.3)

    # TORSO under the tabard (the linen shirt's shoulders and the body): heat weights
    body = Sculpt("body")
    body.add(Ellipsoid((0.0, 0.005, 1.33), (0.150, 0.100, 0.20)), k=0.0)
    body.add(Ellipsoid((0.0, 0.010, 1.44), (0.170, 0.095, 0.075)), k=0.07)
    body.add(Ellipsoid((0.0, 0.000, 1.14), (0.130, 0.095, 0.11)), k=0.08)
    body.add(Ellipsoid((0.0, 0.008, 1.00), (0.150, 0.105, 0.10)), k=0.06)
    for sx in (-1, 1):
        body.add(Sphere((sx * 0.180, 0.008, 1.455), 0.058), k=0.05)
    part("body", body, "cloth2", "auto", 500)

    # TABARD (heat weights above the belt): steel-blue chest panels with stiff shoulder wings
    tab = Sculpt("tabard")
    tab.add(Ellipsoid((0.0, 0.004, 1.34), (0.158, 0.110, 0.205)), k=0.0)
    tab.add(Ellipsoid((0.0, 0.008, 1.445), (0.172, 0.104, 0.075)), k=0.06)
    tab.add(Ellipsoid((0.0, 0.002, 1.21), (0.140, 0.104, 0.075)), k=0.06)
    for sx in (-1, 1):
        # the shoulder wing: a stiff flap over the shoulder, turned down and out
        tab.add(RoundBox((sx * 0.172, 0.006, 1.508), (0.056, 0.096, 0.008), 0.007, axes=sdf.rot_y(sx * 40.0)), k=0.02)
        # the armhole (the sleeve comes out under the wing)
        tab.sub(Ellipsoid((sx * 0.215, 0.008, 1.405), (0.060, 0.080, 0.090)), k=0.012)
    tab.sub(Ellipsoid((0.0, 0.004, 1.57), (0.085, 0.075, 0.07)), k=0.01)                            # the neck hole
    tab.inter(HalfSpace((0, 0, 1.165), (0, 0, -1), 1.0), k=0.0)
    part("tabard", _with_disp(tab, soft_folds(0.003, 30.0, axis=0), 0.003), "cloth", "auto", 1150, uvw=1.3)

    # TABARD SKIRT (analytic hips -> thighs): four panels from the belt to the hem, open at the front and back centre
    # and slit at the sides
    sk = Sculpt("tabard_skirt")
    shell = FlatCapsule((0.0, 0.002, 1.20), (0.0, 0.004, 0.76), 0.142, 0.106, 0.196, 0.146, side=(1, 0, 0))
    sk.add(shell.displaced(folds(0.006, 26.0, axis=0, phase=0.4, zfade=(1.05, 0.8)), 0.006), k=0.0)
    sk.sub(FlatCapsule((0.0, 0.002, 1.25), (0.0, 0.004, 0.70), 0.130, 0.094, 0.184, 0.134, side=(1, 0, 0)), k=0.003)
    sk.inter(HalfSpace((0, 0, 1.19), (0, 0, 1), 1.0), k=0.0)
    sk.inter(_HemCut(_tabard_hem), k=0.004)
    sk.sub(_Slit(0.0, "x", 1.13, 0.012, 0.055, sign=-1.0), k=0.004)                                 # front centre
    sk.sub(_Slit(0.0, "x", 1.02, 0.008, 0.050, sign=1.0), k=0.004)                                  # back centre
    for sx in (-1, 1):
        sk.sub(_Slit(0.012, "y", 0.98, 0.004, 0.018, sign=sx), k=0.004)                             # side slits
    part("tabard_skirt", sk, "cloth", "skirt", 1100, uvw=1.2)

    # LINEN TUNIC (analytic): the pale under-tunic seen between the panels, pointed hems front and back
    tn = Sculpt("tunic")
    tsh = FlatCapsule((0.0, 0.002, 1.16), (0.0, 0.004, 0.74), 0.132, 0.098, 0.180, 0.130, side=(1, 0, 0))
    tn.add(tsh.displaced(folds(0.005, 34.0, axis=0, phase=1.1), 0.005), k=0.0)
    tn.sub(FlatCapsule((0.0, 0.002, 1.20), (0.0, 0.004, 0.70), 0.122, 0.088, 0.170, 0.120, side=(1, 0, 0)), k=0.003)
    tn.inter(HalfSpace((0, 0, 1.12), (0, 0, 1), 1.0), k=0.0)
    tn.inter(_HemCut(_tunic_hem), k=0.004)
    part("tunic", tn, "linen", "skirt", 700, uvw=1.0)

    # BELTS + STRAPS (heat weights): the waist belt, the quiver belt slanting to the right hip, the crossed straps
    belt = Sculpt("belt")
    belt.add(_Band((0.0, 0.002, 1.212), 0.150, 0.114, 0.008, 0.022, rr=0.004), k=0.0)
    belt.add(_Band((0.0, 0.004, 1.128), 0.158, 0.122, 0.007, 0.018, rr=0.004, slope=0.20, front_dip=0.012), k=0.0)
    part("belt", belt, "leather", "auto", 520)
    bk = Sculpt("buckle")
    c = np.array([0.050, -0.122, 1.212])
    bk.add(Torus(c, 0.020, 0.0045, axes=np.stack([[1, 0, 0], [0, 0, 1], [0, -1, 0]]).astype(float), rz=0.0035), k=0.0)
    bk.add(RoundBox(c + (0.0, 0.002, 0.0), (0.004, 0.003, 0.020), 0.002), k=0.002)
    part("buckle", bk, "ironstone", "auto", 160, vs=0.4)
    straps = Sculpt("straps")
    for sx in (-1, 1):
        # the painting's broad straps (5 cm), on its own paths (build 4: the painted straps beside the modelled ones
        # doubled as grey bands on the tabard)
        fr = [(sx * 0.105, -0.080, 1.52), (sx * 0.050, -0.108, 1.455), (0.0, -0.116, 1.395), (-sx * 0.065, -0.116, 1.31),
              (-sx * 0.100, -0.110, 1.262), (-sx * 0.128, -0.094, 1.222)]
        strap(straps, fr, torso_normal, 0.025, 0.0045)
        bk_ = [(sx * 0.110, 0.084, 1.52), (sx * 0.050, 0.112, 1.465), (0.0, 0.118, 1.415), (-sx * 0.10, 0.114, 1.30),
               (-sx * 0.13, 0.098, 1.235)]
        strap(straps, bk_, torso_normal, 0.025, 0.0045)
    part("straps", straps, "leather", "auto", 420, vs=0.7)

    # THE BROOCH on the cowl's edge at her right chest: a chalk ring round a glowing glass disc (accent)
    br, brg = Sculpt("brooch"), Sculpt("brooch_glass")
    bc = np.array([-0.072, -0.118, 1.508])
    bn = _n([-0.15, -1.0, 0.45])
    br.add(Torus(bc, 0.0235, 0.0055, axes=sdf.frame(bn)), k=0.0)
    brg.add(Ellipsoid(bc - bn * 0.001, (0.0215, 0.0215, 0.0080), axes=sdf.frame(bn)), k=0.0)
    part("brooch", br, "chalk", "auto", 200, vs=0.4)
    part("brooch_glass", brg, "accent", "auto", 120, vs=0.4)

    # SLEEVES (heat weights): loose white linen from the armholes to the bracers
    sl = Sculpt("sleeves")
    for sh, el, wr in ((SH_R, EL_R, WR_R), (SH_L, EL_L, WR_L)):
        sl.add(FlatCapsule(sh, el, 0.060, 0.058, 0.054, 0.052, side=(1, 0, 0)).displaced(folds(0.005, 60.0, axis=2), 0.005), k=0.0)
        sl.add(Sphere(el, 0.054), k=0.03)
        sl.add(FlatCapsule(el, el + (wr - el) * 0.35, 0.052, 0.050, 0.046, 0.044, side=(1, 0, 0)), k=0.02)
    part("sleeves", sl, "cloth2", "arm", 1000)
    brc = Sculpt("bracers")
    for el, wr in ((EL_R, WR_R), (EL_L, WR_L)):
        a, b = el + (wr - el) * 0.22, wr + (wr - el) * 0.05
        brc.add(FlatCapsule(a, b, 0.047, 0.045, 0.039, 0.037, side=(1, 0, 0)).displaced(wraps(0.004, 0.032, a, b, slant=0.8), 0.004),
                k=0.0)
    part("bracers", brc, "leather", "arm", 700)
    # HANDS: the left fist round the grip (its axis = the chord), the right hook on the string
    WK_L = _n(np.array([0.0, -0.6, -0.8]))
    part("hand_L", fist("hand_L", HAND_L, U_REST, WR_L, WK_L, 0.021, 1.12, index_fwd=-1.0), "skin", "bone:hand.L", 620, vs=0.55)
    part("hand_R", pinch("hand_R", PINCH_R, U_REST, WR_R, 1.10), "skin", "bone:hand.R", 540, vs=0.55)

    # LEGS: dark leggings, tall soft boots to below the knee
    legs = Sculpt("legs")
    for sx in (-1, 1):
        hip, knee, ank = np.array([sx * 0.095, 0.005, 0.95]), np.array([sx * 0.121, -0.012, 0.503]), np.array([sx * 0.145, 0.02, 0.09])
        legs.add(FlatCapsule(hip + (0, 0, 0.05), knee + (0, 0, 0.04), 0.066, 0.074, 0.054, 0.058, side=(1, 0, 0))
                 .displaced(folds(0.004, 40.0, axis=2, phase=sx), 0.004), k=0.0)
        legs.add(Ellipsoid(knee + (0.0, -0.004, 0.02), (0.052, 0.056, 0.06)), k=0.04)
        legs.add(FlatCapsule(knee, ank + (0, 0, 0.12), 0.046, 0.050, 0.038, 0.042, side=(1, 0, 0)), k=0.02)
    legs.add(Ellipsoid((0.0, 0.01, 0.94), (0.125, 0.092, 0.08)), k=0.05)
    part("legs", legs, "under", "auto", 620)
    boots = Sculpt("boots")
    for sx in (-1, 1):
        to = math.radians(sx * 8.0)
        fwd = np.array([math.sin(to), -math.cos(to), 0.0])
        ank = np.array([sx * 0.145, 0.02, 0.0])
        knee = np.array([sx * 0.121, -0.012, 0.503])
        boots.add(RoundBox(ank + fwd * 0.055 + (0, 0, 0.040), (0.048, 0.125, 0.040), 0.036, axes=sdf.rot_z(math.degrees(to))), k=0.0)
        boots.add(Ellipsoid(ank + fwd * 0.142 + (0, 0, 0.034), (0.046, 0.058, 0.034)), k=0.03)
        boots.add(FlatCapsule(ank + (0, 0, 0.05), knee + (0, 0.0, -0.035), 0.050, 0.054, 0.056, 0.060, side=(1, 0, 0))
                  .displaced(folds(0.004, 30.0, axis=2, phase=sx * 1.7), 0.004), k=0.03)
        boots.add(Torus(knee + (0.0, 0.0, -0.040), 0.057, 0.008, axes=np.diag([1.0, 1.06, 1.0])), k=0.008)     # cuff
    boots.inter(HalfSpace((0, 0, 0.0), (0, 0, -1), 2.0), k=0.0)
    part("boots", boots, "boots", "auto", 780)

    # QUIVER (rigid on the hips): a brown leather tube with two straps and a rim, five arrows standing in it
    qv = Sculpt("quiver")
    qc = (Q_TOP + Q_BOT) * 0.5
    qL = float(np.linalg.norm(Q_TOP - Q_BOT))
    qax = np.stack([Q_W, Q_N, Q_U])
    qv.add(RoundBox(qc, (Q_HW, Q_HD, qL * 0.5), 0.034, axes=qax).displaced(chips(0.002, 12.0), 0.002), k=0.0)
    qv.sub(RoundBox(Q_TOP + Q_U * 0.02, (Q_HW - 0.009, Q_HD - 0.009, 0.06), 0.025, axes=qax), k=0.005)
    part("quiver", qv, "quiver", "bone:hips", 560)
    qb = Sculpt("quiver_straps")
    for zz in (0.07, 0.30):
        qb.add(RoundBox(Q_TOP - Q_U * zz, (Q_HW + 0.005, Q_HD + 0.005, 0.014), 0.033, axes=qax), k=0.0)
    qb.add(RoundBox(Q_TOP - Q_U * 0.006, (Q_HW + 0.004, Q_HD + 0.004, 0.010), 0.031, axes=qax), k=0.0)
    qb.sub(RoundBox(Q_TOP + Q_U * 0.02, (Q_HW - 0.009, Q_HD - 0.009, 0.06), 0.025, axes=qax), k=0.004)
    # the loop from the quiver's upper strap to the slanting belt
    qb.add(Capsule(Q_TOP - Q_U * 0.07 + Q_N * 0.0 + Q_W * 0.03 + np.array([0.03, -0.01, 0.0]),
                   np.array([-0.150, -0.02, 1.10]), 0.010), k=0.006)
    part("quiver_straps", qb, "leather", "bone:hips", 400, vs=0.7)
    shafts, fl = Sculpt("arrow_shafts"), Sculpt("fletching")
    for w, n, rise, lean, vt in ARROWS:
        d = _n(Q_U + Q_W * math.tan(math.radians(lean)))
        base = Q_TOP - Q_U * 0.25 + Q_W * w + Q_N * n
        tip = Q_TOP + Q_W * w + Q_N * n + d * rise
        shafts.add(Capsule(base, tip, 0.0042), k=0.0)
        shafts.add(Sphere(tip, 0.0055), k=0.002)                                                   # the nock
        e1 = _n(np.cross(d, Q_N))
        for j in range(3):
            a = math.radians(vt + j * 120.0)
            vd = e1 * math.cos(a) + np.cross(d, e1) * math.sin(a)
            p0 = tip - d * 0.085
            fl.add(_Vane(p0, d, vd, 0.072, 0.017, 0.0016), k=0.0)
    part("arrow_shafts", shafts, "wood", "bone:hips", 300, vs=0.45)
    part("fletching", fl, "fletching", "bone:hips", 420, vs=0.6)

    # THE BOW (prop.L): pale ash limbs with a flat faceted grip, glass tip caps with accent inlays, the string
    bow = Sculpt("bow")
    bow_limb_segments(bow)
    # the grip: a faceted block over the middle (flat facets meeting at a crease, the painting's)
    for sgn in (-1, 1):
        a, b = bow_pt(sgn * 0.005), bow_pt(sgn * 0.165)
        tan = _n(b - a)
        side = _n(N_REST - tan * (tan @ N_REST))
        up = np.cross(tan, side)
        bow.add(RoundBox((a + b) * 0.5, (0.030, 0.082, 0.022), 0.006, axes=np.stack([side, tan, up])), k=0.008)
    part("bow", bow, "wood", "bone:prop.L", 1250, vs=0.5, uvw=1.4)
    grip = Sculpt("bow_grip")
    for sgn in (-1, 1):
        a, b = bow_pt(sgn * 0.002), bow_pt(sgn * 0.075)
        tan = _n(b - a)
        side = _n(N_REST - tan * (tan @ N_REST))
        up = np.cross(tan, side)
        grip.add(RoundBox((a + b) * 0.5, (0.0335, 0.037, 0.0255), 0.009, axes=np.stack([side, tan, up]))
                 .displaced(lambda P: 0.0012 * np.sin(((P - GRIP_L) @ U_REST) * 2 * math.pi / 0.011), 0.0012), k=0.006)
    part("bow_grip", grip, "leather", "bone:prop.L", 400, vs=0.5)
    caps, inl = Sculpt("bow_caps"), Sculpt("bow_inlays")
    for sgn in (-1, 1):
        a, b = bow_pt(sgn * CAP0), bow_pt(sgn * CAP1)
        tan = _n(b - a)
        side = _n(N_REST - tan * (tan @ N_REST))
        caps.add(FlatCapsule(a, b, 0.024, 0.017, 0.019, 0.013, side=side), k=0.0)
        for f0, f1 in ((0.12, 0.44), (0.54, 0.88)):
            pa, pb = a + (b - a) * f0, a + (b - a) * f1
            inl.add(FlatCapsule(pa, pb, 0.0262, 0.0192, 0.0250, 0.0182, side=side), k=0.0)
    part("bow_caps", caps, "dawnglass", "bone:prop.L", 500, vs=0.45)
    part("bow_inlays", inl, "accent", "bone:prop.L", 360, vs=0.45)
    st = Sculpt("string")
    st.add(Capsule(STRING_A, S0, 0.0048), k=0.0)
    st.add(Capsule(S0, STRING_B, 0.0048), k=0.0)
    part("string", st, "cloth2", "string", 260, vs=0.45)

    # MORNING DRAW's fan (x_fan, under the right hand; scaled away except in cast_a3): three arrows fanned between
    # the fingers, fletched
    fan, fanf = Sculpt("fan_shafts"), Sculpt("fan_fletch")
    for ang in (-16.0, 0.0, 16.0):
        d = fan_dir(ang)
        base = PINCH_R - d * 0.03
        tip = PINCH_R + d * 0.45
        fan.add(Capsule(base, tip, 0.0045), k=0.0)
        fan.add(RoundCone(tip, tip + d * 0.045, 0.009, 0.002), k=0.004)                            # the head
        e1 = _n(np.cross(d, [0.0, 0.0, 1.0]))
        for j in range(3):
            a = math.radians(30.0 + j * 120.0)
            vd = e1 * math.cos(a) + np.cross(d, e1) * math.sin(a)
            fanf.add(_Vane(base, d, vd, 0.07, 0.016, 0.0016), k=0.0)
    part("fan_shafts", fan, "wood", "bone:x_fan", 190, vs=0.5)
    part("fan_fletch", fanf, "fletching", "bone:x_fan", 200, vs=0.6)
    return out


FAN_AXIS = np.array([0.0, -1.0, 0.0])                  # the fan's axis at bind (forward from the right hand)


def fan_dir(ang):
    a = math.radians(ang)
    return _n(FAN_AXIS * math.cos(a) + U_REST * math.sin(a))


class _Vane(sdf.Prim):
    """one fletching vane: a thin plate from p0 along d (length L), standing out along vd (height H), its top edge
    curving down at the front (a parabolic feather), thickness T"""

    def __init__(self, p0, d, vd, L, H, T):
        self.p0, self.dv, self.vd = np.asarray(p0, float), _n(d), _n(vd)
        self.w = np.cross(self.dv, self.vd)
        self.L, self.H, self.T = L, H, T

    def bounds(self):
        pts = np.array([self.p0 + self.dv * s + self.vd * h + self.w * t for s in (-0.005, self.L + 0.005)
                        for h in (-0.003, self.H + 0.004) for t in (-0.004, 0.004)])
        return pts.min(0), pts.max(0)

    def d(self, P):
        q = P - self.p0
        s, h, t = q @ self.dv, q @ self.vd, q @ self.w
        u = np.clip(s / self.L, 0, 1)
        top = self.H * np.clip(1.0 - (1.0 - u) ** 2 * 0.9, 0.15, 1.0) * np.where(u > 0.82, np.clip((1.0 - u) / 0.18, 0, 1) ** 0.5, 1.0)
        dh = np.maximum(-h, h - top)
        ds = np.maximum(-s, s - self.L)
        return np.maximum(np.maximum(dh, ds), np.abs(t) - self.T)


def skin_extras(extra: dict) -> list:
    """Gorgewalk: rigid gorge-rope bindings at the grip's ends and below each tip cap; Almanac: page-cut plates
    replace the gull-feather vanes (3 x 8 cm, 3 mm)"""
    out = []
    if extra.get("rope_bind"):
        rope = Sculpt("rope_bind")
        for uu in (-0.10, 0.10, -0.60, 0.60):
            c = bow_pt(uu)
            tan = bow_tangent(uu)
            if abs(uu) < 0.2:
                w, t = 0.034, 0.026
            else:
                w = float(_tab(LIMB_W, uu)) * 0.5 + 0.0045
                t = float(_tab(LIMB_T, uu)) * 0.5 + 0.0045
            side = _n(N_REST - tan * (tan @ N_REST))
            a_, b_ = c - tan * 0.022, c + tan * 0.022
            rope.add(FlatCapsule(a_, b_, w, t, w, t, side=side).displaced(wraps(0.0018, 0.0075, a_, b_, slant=0.4), 0.0018),
                     k=0.0)
        out.append(("rope_bind", rope, 0.45, "rope", "bone:prop.L", 700, 1.0))
    return out


def extra_materials(ctx) -> dict:
    """roles the bible set lacks or that need a different finish: the wrap is CLOTH (a honed-stone sheen would render
    it bone-white), skin, boots, the quiver's leather, the linen tunic, the fletching, rope; the bow matte ash"""
    pal = dict(materials.BIBLE_PALETTE, **PALETTE)
    pal.update(ctx.palette)
    g = ctx.gradient
    return {"skin": materials.waxed_leather("skin", pal, "skin", g, rough=0.72),
            "wrap": materials.heavy_cloth("wrap", pal, "wrap", g, rough=0.93, weave=0.8),
            "cloth2": materials.heavy_cloth("cloth2", pal, "cloth2", g, rough=0.92, weave=0.7),
            "cloth": materials.heavy_cloth("cloth", pal, "cloth", g, rough=0.9, weave=0.9),
            "linen": materials.heavy_cloth("linen", pal, "linen", g, rough=0.93, weave=1.0),
            "boots": materials.waxed_leather("boots", pal, "boots", g, rough=0.70),
            "quiver": materials.waxed_leather("quiver", pal, "quiver", g, rough=0.62),
            "fletching": materials.heavy_cloth("fletching", pal, "fletching", g, rough=0.8, weave=0.3),
            "rope": materials.heavy_cloth("rope", pal, "rope", g, rough=0.95, weave=1.0),
            "chalk": materials.honed_stone("chalk", pal, "chalk", g, rough=0.78, chisel=0.5),
            "wood": materials.carved_wood("wood", pal, "wood", g, rough=0.70),
            "leather": materials.waxed_leather("leather_matte", pal, "leather", g, rough=0.74)}


# ── decimation: the shared collapse keeps X symmetry, which stalls on one-sided parts ─────────────────────────────
ASYM = ("quiver", "arrow_", "fletching", "hand_", "brooch", "buckle", "belt", "bow", "string", "fan_", "rope_bind",
        "sleeves", "bracers", "tunic", "tabard_skirt")


def _install_decimate() -> None:
    from common import mesh
    orig = mesh.decimate_to
    if getattr(orig, "_lisvel", False):
        return

    def decimate_to(obj, target_tris, symmetric=True):
        if obj.name.startswith(ASYM):
            symmetric = False
        return orig(obj, target_tris, symmetric)
    decimate_to._lisvel = True
    mesh.decimate_to = decimate_to


_install_decimate()

Q_BASE = 58


def _install_optimize() -> None:
    """the shipping compression with the 2048 base colour at WebP q70 (the shared optimize.mjs takes --q-base)"""
    from common import export
    orig = export.optimize
    if getattr(orig, "_lisvel", False):
        return

    def optimize(path, out=None, quantize=False, fighter=False):
        if not fighter:
            return orig(path, out, quantize, fighter)
        import subprocess
        from common import scene as _scene
        out = out or path
        script = os.path.join(_scene.TOOLS_DIR, "optimize.mjs")
        node = export.node_exe()
        before = os.path.getsize(path)
        if not node or not os.path.isfile(script):
            return orig(path, out, quantize, fighter)
        args = [node, script, path, out] + (["--quantize"] if quantize else []) + ["--fighter", "--q-base", str(Q_BASE)]
        r = subprocess.run(args, cwd=_scene.GAME_DIR, capture_output=True, text=True, encoding="utf-8")
        if r.returncode != 0:
            _scene.log(f"optimize failed ({r.returncode}): {r.stderr.strip()[:800]}")
            return {"ok": False, "before": before, "after": before, "error": r.stderr[-800:]}
        _scene.log(r.stdout.strip())
        return {"ok": True, "before": before, "after": os.path.getsize(out), "q_base": Q_BASE}
    optimize._lisvel = True
    export.optimize = optimize


_install_optimize()


def _install_art_height() -> None:
    """FighterArt.height places the HP bar (art.height + 0.35 m): the bow's far tip rises toward it in the lane
    facings, so the reported height is the mesh top + ART_HEIGHT_PAD (inside the load test's 6 cm tolerance)"""
    from common import pipeline
    orig = pipeline.art_fragment
    if getattr(orig, "_lisvel", False):
        return

    def art_fragment(spec, clips_info, mesh_top=None):
        out = orig(spec, clips_info, mesh_top)
        if getattr(spec, "ID", None) == ID and mesh_top:
            out["height"] = round(float(mesh_top) + ART_HEIGHT_PAD, 2)
        return out
    art_fragment._lisvel = True
    pipeline.art_fragment = art_fragment


_install_art_height()


def _install_bleed() -> None:
    """the data maps (ORM 256, normal 512) are baked at 2048 with an 8 px margin and scaled down: the gaps between this
    fragmented atlas's islands stay black (roughness 0 = glossy, AO 0) and bleed into the islands at three.js's mip
    levels (pale glossy blotches on the dark leggings in build 2). Every empty texel takes its nearest island's value
    (wraps bake.bake_asset in this build process only; the files are rewritten and the loaded images reloaded)."""
    from common import bake
    orig = bake.bake_asset
    if getattr(orig, "_lisvel", False):
        return

    def bake_asset(low, highs, out_dir, *a, **kw):
        res = orig(low, highs, out_dir, *a, **kw)
        from common.hifi import project
        for kind in ("orm", "normal"):
            path = res["images"].get(kind)
            if not path:
                continue
            full = path if os.path.isabs(path) else os.path.join(scene.GAME_DIR, path)
            if not os.path.isfile(full):
                continue
            img = project.load_rgb(full)
            sz = img.shape[0]
            cov = project.rasterize(low, sz, "vale_part")["part"] >= 0
            cov = cov & ~np.all(img < 0.002, axis=2)
            iy, ix = project.nearest_index(cov)
            project.save_rgb(img[iy, ix], full)
            for im in bpy.data.images:
                if im.filepath and os.path.abspath(bpy.path.abspath(im.filepath)) == os.path.abspath(full):
                    im.reload()
            scene.log(f"bleed {kind}: {int((~cov).sum())} empty texels filled")
        return res
    bake_asset._lisvel = True
    bake.bake_asset = bake_asset


_install_bleed()


# ── rig ────────────────────────────────────────────────────────────────────────────────────────────────────────
def rig_extras(ctx) -> None:
    """re-place both arms on the concept's carry; prop.L on the bow's grip (+Y = the shot D, +Z = the upper limb U),
    prop.R on the string pinch (+Y = D); x_string (the string's draw, deforming, under prop.L), x_fan (Morning Draw's
    fan, deforming, under hand.R); sockets x_arrow_nock (hand.R), x_bow_tip_l / _r (prop.L), x_quiver (hips)"""
    info = ctx.info
    arm = info.armature
    scene.select_only([arm], arm)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    for s, el, wr, grip in (("R", EL_R, WR_R, PINCH_R), ("L", EL_L, WR_L, HAND_L)):
        sh = V(eb[f"upper_arm.{s}"].head)
        elv, wrv = V(tuple(el)), V(tuple(wr))
        up_d, fo_d = (elv - sh).normalized(), (wrv - elv).normalized()
        hd = (V(tuple(grip)) - wrv).normalized()
        eb[f"upper_arm.{s}"].tail = elv
        eb[f"forearm.{s}"].head = elv
        eb[f"forearm.{s}"].tail = wrv
        eb[f"hand.{s}"].head = wrv
        eb[f"hand.{s}"].tail = wrv + hd * PROPORTIONS["hand"] * 0.5
        eb[f"upper_arm.{s}"].align_roll(fo_d - up_d * fo_d.dot(up_d))
        eb[f"forearm.{s}"].align_roll(-up_d - fo_d * (-up_d).dot(fo_d))
        eb[f"hand.{s}"].align_roll(-up_d - hd * (-up_d).dot(hd))
        info.joints[f"elbow.{s}"], info.joints[f"wrist.{s}"] = elv, wrv
        info.joints[f"palm.{s}"] = V(tuple(grip))
    for s, p in (("L", GRIP_L), ("R", PINCH_R)):
        g = V(tuple(p))
        eb[f"prop.{s}"].head = g
        eb[f"prop.{s}"].tail = g + V(tuple(D_REST)) * 0.12
        eb[f"prop.{s}"].align_roll(V(tuple(U_REST)))
    bpy.ops.object.mode_set(mode="OBJECT")
    for b in arm.data.bones:
        info.lengths[b.name] = b.length
    rig.add_socket(info, "x_string", "prop.L", tuple(S0), tuple(D_REST * 0.06), z_hint=tuple(U_REST))
    rig.add_socket(info, "x_fan", "hand.R", tuple(PINCH_R), (0.0, 0.0, 0.08), z_hint=(0.0, -1.0, 0.0))
    for nm in ("x_string", "x_fan"):
        arm.data.bones[nm].use_deform = True
        info.lengths[nm] = arm.data.bones[nm].length
    rig.add_socket(info, "x_arrow_nock", "hand.R", tuple(PINCH_R), tuple(D_REST * 0.08), z_hint=tuple(U_REST))
    rig.add_socket(info, "x_bow_tip_l", "prop.L", tuple(TIP_L), tuple(bow_tangent(NOCK_U) * 0.06), z_hint=tuple(-D_REST))
    rig.add_socket(info, "x_bow_tip_r", "prop.L", tuple(TIP_R), tuple(-bow_tangent(-NOCK_U) * 0.06), z_hint=tuple(-D_REST))
    rig.add_socket(info, "x_quiver", "hips", tuple(Q_TOP + Q_U * 0.02), tuple(Q_U * 0.08), z_hint=(0, -1, 0))


# ── analytic weights ───────────────────────────────────────────────────────────────────────────────────────────
def _ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _skirt_weights(co):
    """hips at the belt, the thighs below by side (the panels follow their own thigh); the back keeps more hips"""
    x, y, z = co[:, 0], co[:, 1], co[:, 2]
    front = _ss(0.0, -0.06, y)
    wh = _ss(0.74, 1.08, z) * (1 - front) + _ss(0.86, 1.12, z) * front
    wh = wh + (1 - wh) * 0.40 * _ss(0.02, 0.12, y)
    sL = _ss(-0.05, 0.05, x)
    return {"hips": wh, "thigh.L": (1 - wh) * sL, "thigh.R": (1 - wh) * (1 - sL)}


def _seg_t(p, a, b):
    ab = b - a
    t = ((p - a) @ ab) / (ab @ ab)
    d = np.linalg.norm(p - (a + np.outer(np.clip(t, 0, 1), ab)), axis=1)
    return t, d


def _arm_weights(co):
    """the sleeves and bracers on their own arm only (build 8 splash: bone heat gave the right bracer's wrist end, which
    lies against the belly at bind, to the spine, and a dark strip stretched from the raised hand to the belt):
    shoulder -> upper arm -> forearm -> hand by the position along each arm's chain, soft at the joints"""
    W = {}
    for s_, sh, el, wr in (("R", SH_R, EL_R, WR_R), ("L", SH_L, EL_L, WR_L)):
        t1, d1 = _seg_t(co, sh, el)
        t2, d2 = _seg_t(co, el, wr)
        W[s_] = (t1, d1, t2, d2)
    dR = np.minimum(W["R"][1], W["R"][3])
    dL = np.minimum(W["L"][1], W["L"][3])
    out = {}
    for s_ in ("R", "L"):
        t1, d1, t2, d2 = W[s_]
        mine = (dR <= dL) if s_ == "R" else (dL < dR)
        upper = d1 <= d2
        w_sh = np.where(upper, _ss(0.16, -0.04, t1) * 0.6, 0.0)
        w_fa = np.where(upper, _ss(0.86, 1.10, t1), 1.0 - _ss(0.14, -0.10, t2))
        w_ua = np.where(upper, 1.0 - w_fa, _ss(0.14, -0.10, t2))
        w_ua = w_ua * (1.0 - w_sh)
        w_hd = np.where(upper, 0.0, _ss(0.90, 1.06, t2))
        w_fa = w_fa * (1.0 - w_hd)
        out[f"shoulder.{s_}"] = w_sh * mine
        out[f"upper_arm.{s_}"] = w_ua * mine
        out[f"forearm.{s_}"] = w_fa * mine
        out[f"hand.{s_}"] = w_hd * mine
    return out


def _string_weights(co):
    """x_string at the nock, falling linearly to the tips (prop.L): a drawn string is two straight lines"""
    u = (co - S0) @ U_REST
    w = np.clip(1.0 - np.abs(u) / NOCK_U, 0.0, 1.0)
    return {"x_string": w, "prop.L": 1.0 - w}


def _assign(obj, arm, wfn):
    from common import mesh
    obj.vertex_groups.clear()
    co = np.array([tuple(obj.matrix_world @ v.co) for v in obj.data.vertices])
    W = wfn(co)
    tot = sum(W.values())
    for name, w in W.items():
        g = obj.vertex_groups.new(name=name)
        w = w / np.maximum(tot, 1e-6)
        for i in np.nonzero(w > 1e-3)[0]:
            g.add([int(i)], float(w[i]), "REPLACE")
    mesh.add_armature_modifier(obj, arm)
    mesh.parent_keep(obj, arm)


def _install_bind() -> None:
    from common import pipeline
    orig = pipeline.bind_part
    if getattr(orig, "_lisvel", False):
        return

    def bind_part(ctx, part, obj, body_low=None):
        if part.bind == "skirt":
            _assign(obj, ctx.info.armature, _skirt_weights)
            return {}
        if part.bind == "string":
            _assign(obj, ctx.info.armature, _string_weights)
            return {}
        if part.bind == "arm":
            _assign(obj, ctx.info.armature, _arm_weights)
            return {}
        return orig(ctx, part, obj, body_low)
    bind_part._lisvel = True
    pipeline.bind_part = bind_part


_install_bind()

# ── paint: the projection, re-toned onto the concept's material colours, and painted in the concept's manner where
# the projection cannot work (wrapper of common/hifi/project.paint_object, installed in this build process only) ──────
# part -> (albedo median target, value contrast, pull toward the target's hue): the projected detail is kept as
# per-texel ratios to the part's median (linear light), so every part lands on the concept's colour for its material
# with its painted folds and wear. Pale parts sit a step under the concept's lit values (three.js lifts pale albedo).
TONE = {
    # build 1 in three.js: the pale linen and chalk rendered near-white, the tabard a light sky blue (concept: a mid
    # steel blue, L* ~52) -> every target a step down, the blue a little more saturated (three.js strips ~10 points)
    "wrap": ("#A9A69F", 0.80, 0.85), "mask": ("#B6B1A7", 0.50, 0.85),
    "cowl": ("#A8A59E", 0.80, 0.85), "sleeves": ("#AAA69E", 0.75, 0.85),
    "tabard": ("#4C6272", 0.95, 0.45), "tabard_skirt": ("#465A69", 0.95, 0.45),
    "tunic": ("#7E796F", 0.85, 0.8), "belt": ("#40372F", 0.9, 0.6), "straps": ("#3F3630", 0.9, 0.6),
    "boots": ("#2D2A28", 0.9, 0.7), "quiver": ("#5A4A3C", 0.9, 0.6), "quiver_straps": ("#352D28", 0.9, 0.6),
}
# the material classes the projection must not carry onto a part (the plates paint the neighbouring material where
# the model's part stands: the sleeves' white on the tabard's shoulder wings and back, the tabard's blue on the cowl's
# hem): such texels are calmed to the part's own colour
PALE = ("wrap", "cowl", "sleeves", "mask", "tunic")
BLUE = ("tabard", "tabard_skirt")
# side-facing texels of these parts streak (neighbours along Y take one plate pixel): blended into the part's colour
# with painted breakup; up-facing texels likewise
SIDE_PARTS = ("wrap", "cowl", "sleeves", "tabard", "tabard_skirt", "tunic", "belt", "straps", "boots", "quiver",
              "quiver_straps", "mask")
MAX_LIN = 0.60          # no texel lighter than ~L* 81 in the albedo (the brief's L* 86 cap after the top light)


def _hl(h):
    h = h.lstrip("#")
    c = np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _lum(c):
    return c[..., 0] * 0.2126 + c[..., 1] * 0.7152 + c[..., 2] * 0.0722


def _hash(x):
    return (np.sin(x * 12.9898 + 4.1) * 43758.5453) % 1.0


def _tone(lin, tgt, contrast, desat, ref=None):
    med = np.median(lin[ref] if ref is not None and ref.sum() > 200 else lin, axis=0)
    r = lin / np.maximum(med, 1e-4)
    rl = (_lum(lin) / max(float(_lum(med)), 1e-4))[:, None]
    r = r * (1 - desat) + rl * desat
    return tgt * np.clip(r, 0.0, 4.0) ** contrast


def _seg_dist(p, a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    ab = b - a
    t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(p - (a + np.outer(t, ab)), axis=1)


def _bow_local(p):
    """(u along the chord, v toward the belly, n across the plane) of rest-frame points"""
    q = p - S0
    return q @ U_REST, q @ D_REST, q @ N_REST


def paint_bow(p, n):
    """the pale ash limbs: a long grain along the limb, the belly a step darker than the back, the edges worn paler,
    the faceted grip's crease line, the lower limb (her right) a few L* darker so the bar never reads as the
    brightest stripe; matte"""
    u, v, w = _bow_local(p)
    vc = prof_v(u)
    off = v - vc                                    # + toward the belly
    grain = 1 + 0.045 * np.sin(u * 140.0 + 9.0 * NOISE(p, 6.0) + w * 40.0) + 0.035 * NOISE(p * np.array([1, 6, 6]), 18.0)
    col = _hl("#C9C1B1") * grain[:, None]
    belly = _ss(-0.004, 0.012, off)
    col = col * (1 - 0.10 * belly)[:, None]
    wn = np.abs(w) / np.maximum(_tab(LIMB_W, u) * 0.5, 1e-3)
    col = col * (1 + 0.06 * _ss(0.75, 1.0, wn))[:, None]
    crease = np.exp(-(u / 0.004) ** 2) + 0.6 * np.exp(-((np.abs(u) - 0.165) / 0.004) ** 2)
    col = col * (1 - 0.30 * np.clip(crease, 0, 1))[:, None]
    col = col * (1 - 0.06 * _ss(0.0, -0.4, u))[:, None]
    return col


def paint_grip(p, n):
    u, v, w = _bow_local(p)
    wrap = 1 - 0.30 * np.abs(np.sin(u * 2 * math.pi / 0.011 + 3.0 * w))
    return _hl("#4A3F38") * (wrap * (0.92 + 0.08 * NOISE(p, 40.0)))[:, None]


def paint_caps(p, n):
    """the dawnglass caps: pale icy blue, a lighter rim at the tip, a darker seat where the limb enters"""
    u, v, w = _bow_local(p)
    au = np.abs(u)
    t = np.clip((au - CAP0) / (CAP1 - CAP0), 0, 1)
    v_ = (0.86 + 0.18 * t) * (1 + 0.06 * np.clip(n[:, 2], -1, 1)) * (1 - 0.25 * _ss(0.08, 0.0, t))
    return _hl("#93BCD8") * v_[:, None]


def paint_string(p, n):
    return _hl("#CFC8B8") * (0.92 + 0.08 * NOISE(p, 60.0))[:, None]


def paint_visor(p, n):
    """the flat dawnglass visor (the concept's pale-blue band): bright icy blue, a lighter upper edge, a soft
    horizontal sheen across the middle, darker at the turned-back ends and the lower edge; glossy, never emissive"""
    z = p[:, 2] - 1.731
    ang = np.arctan2(p[:, 0], -(p[:, 1] - 0.0))
    v = 0.88 + 0.16 * _ss(-0.012, 0.018, z) + 0.10 * np.exp(-((z - 0.002) / 0.006) ** 2)
    v = v * (1 - 0.30 * _ss(0.55, 0.85, np.abs(ang))) * (1 - 0.18 * _ss(-0.012, -0.020, z))
    col = _hl("#8DBBDC") * v[:, None]
    edge = _ss(0.015, 0.0205, np.abs(z))
    return col * (1 - 0.18 * edge[:, None])


def paint_skin(p, n):
    v = 0.84 + 0.22 * np.clip(n[:, 2] * 0.5 + 0.5, 0, 1) + 0.05 * NOISE(p, 40.0)
    return _hl("#B48F78") * v[:, None]


def paint_neck(p, n):
    v = (0.55 + 0.25 * np.clip(-n[:, 1], 0, 1)) * (0.70 + 0.25 * _ss(1.53, 1.60, p[:, 2]))
    return _hl("#8A6A58") * v[:, None]


def paint_legs(p, n):
    v = 1.0 + 0.10 * NOISE(p, 7.0) + 0.05 * NOISE(p, 23.0)
    v = v * (0.82 + 0.24 * np.clip(n[:, 2] * 0.5 + 0.5, 0, 1))
    knee = np.exp(-((p[:, 2] - 0.52) / 0.06) ** 2) * (n[:, 1] < 0.1)
    v = v * (1 + 0.12 * knee)
    return _hl("#241E1C") * v[:, None]


def paint_bracers(p, n):
    """the dark wrapped bracers: bands wound slanting round each forearm (the sculpt's helix), a dark groove at each
    seam, a lit ridge mid-band"""
    out = np.zeros((len(p), 3))
    dR = _seg_dist(p, EL_R, WR_R)
    dL = _seg_dist(p, EL_L, WR_L)
    for el, wr, sel in ((EL_R, WR_R, dR <= dL), (EL_L, WR_L, dL < dR)):
        if not sel.any():
            continue
        a, b = el + (wr - el) * 0.22, wr + (wr - el) * 0.05
        u = _n(b - a)
        e1 = _n(np.cross(u, [0.0, 0.0, 1.0]) if abs(u[2]) < 0.9 else np.cross(u, [1.0, 0.0, 0.0]))
        e2 = np.cross(u, e1)
        q = p[sel] - a
        th = np.arctan2(q @ e2, q @ e1)
        ph = (q @ u) / 0.032 + 0.8 * th / (2 * math.pi) + 0.15 * NOISE(p[sel], 6.0)
        f = ph - np.floor(ph)
        groove = np.exp(-((f - 0.02) / 0.07) ** 2) + np.exp(-((f - 1.02) / 0.07) ** 2)
        ridge = np.sin(np.pi * f)
        band = _hash(np.floor(ph)) - 0.5
        v = (0.80 + 0.26 * ridge) * (1 - 0.50 * np.clip(groove, 0, 1)) * (1 + 0.12 * band)
        out[sel] = _hl("#433A34") * v[:, None]
    return out * (0.88 + 0.16 * np.clip(n[:, 2] * 0.5 + 0.5, 0, 1))[:, None]


def paint_shafts(p, n):
    return _hl("#BDB29E") * (1 + 0.03 * NOISE(p * np.array([4, 4, 1]), 30.0))[:, None]


def paint_fletch(p, n):
    """gull-grey vanes with a pale blue cast (the concept's blue-grey fletching), a darker quill edge, fine barbs"""
    v = (0.92 + 0.10 * np.sin(p[:, 2] * 900.0 + 3.0 * NOISE(p, 50.0))) * (0.9 + 0.1 * np.clip(n[:, 2], -1, 1))
    return _hl("#9DAFBE") * v[:, None]


def paint_buckle(p, n):
    return _hl("#4A4743") * (0.9 + 0.12 * np.clip(n[:, 2] * 0.5 + 0.5, 0, 1))[:, None]


def paint_brooch(p, n):
    return _hl("#B6B1A6") * (0.88 + 0.14 * np.clip(-n[:, 1], 0, 1))[:, None]


def paint_body(p, n):
    """the shirt under the tabard (seen only in the armholes): linen in shade"""
    return _hl("#8F8B84") * (0.9 + 0.08 * NOISE(p, 20.0))[:, None]


def paint_rope(p, n):
    """Gorgewalk's gorge-rope bindings: twisted plies"""
    v = 0.86 + 0.18 * np.abs(np.sin((p[:, 0] + p[:, 2]) * 520.0 + 6.0 * NOISE(p, 30.0)))
    return _hl("#9A8F7A") * v[:, None]


def _calm_w(name, lin):
    """0..1 per texel: how far a texel's projected paint belongs to another material class"""
    lum = _lum(lin)
    med = float(np.median(lum))
    blue = (lin[:, 2] - lin[:, 0]) / np.maximum(lum, 1e-3)
    if name in PALE:
        w = _ss(0.10, 0.22, blue) * _ss(0.15, 0.35, lum / max(med, 1e-4))
    elif name in BLUE:
        # near-white (the sleeves), very dark, or WARM (the quiver's and straps' brown: the tabard's own trims are a
        # neutral grey) paint is another material's
        w = (_ss(0.14, 0.05, blue) * _ss(1.9, 2.6, lum / max(med, 1e-4)) + _ss(0.30, 0.16, lum / max(med, 1e-4))
             + _ss(-0.02, -0.14, blue))
    else:
        return np.zeros(len(lin))
    return np.clip(w, 0, 1)


def wrap_bands(c, p, n):
    """the turban's wound bands: a darker seam between bands (the sculpt's turban() phase), each band its own value"""
    q = p - HEAD_C
    th = np.arctan2(q[:, 0], q[:, 1])
    ph = (q[:, 2] + 0.035 * np.sin(th) + 0.012 * NOISE(p, 9.0)) / 0.026
    f = ph - np.floor(ph)
    seam = np.exp(-((f - 0.05) / 0.07) ** 2) + np.exp(-((f - 1.05) / 0.07) ** 2)
    band = _hash(np.floor(ph)) - 0.5
    k = (1 - 0.34 * np.clip(seam, 0, 1)) * (1 + 0.08 * band) * (1 + 0.05 * np.sin(np.pi * f))
    return c * k[:, None]


def mask_shade(c, p, n):
    """the face-plate under the wrap: lit straight ahead, a step darker at the sides and under the brow"""
    front = _ss(0.2, 0.85, -n[:, 1])
    side = _ss(0.045, 0.075, np.abs(p[:, 0]))
    return c * ((0.72 + 0.28 * front) * (1 - 0.25 * side))[:, None]


def wrap_shade(c, p, n):
    """inside the face opening the wrap falls into shadow round the mask"""
    to_f = np.array([0.0, -0.118, 1.695]) - p
    inward = (n * to_f).sum(1) / (np.linalg.norm(to_f, axis=1) + 1e-6)
    near = np.linalg.norm((p - np.array([0.0, -0.10, 1.70])) * np.array([1.0, 1.0, 0.75]), axis=1) < 0.105
    k = _ss(0.1, 0.6, inward) * near
    return c * (1 - 0.45 * k)[:, None]


PROC = {"bow": paint_bow, "bow_grip": paint_grip, "bow_caps": paint_caps, "string": paint_string,
        "visor": paint_visor, "hand_L": paint_skin, "hand_R": paint_skin, "neck": paint_neck, "legs": paint_legs,
        "bracers": paint_bracers, "arrow_shafts": paint_shafts, "fletching": paint_fletch, "fan_shafts": paint_shafts,
        "fan_fletch": paint_fletch, "buckle": paint_buckle, "brooch": paint_brooch, "body": paint_body,
        "rope_bind": paint_rope}


_PLATES = {}


def _back_plate(p):
    """the back plate's paint at points p (rest frame)"""
    from common.hifi import project
    if "pl" not in _PLATES:
        _PLATES["pl"] = project.Plates(os.path.join(scene.CACHE_DIR, "concept"), PROJECTION["concept"], HEIGHT)
    pl = _PLATES["pl"]
    px, py = pl.to_px("back", p[:, 0], p[:, 2])
    return project._lin(project.bilinear(pl.img["back"], px, py))


def post_paint(img: np.ndarray, maps: dict, names: list, skip=(), log=print) -> np.ndarray:
    from common.hifi import project
    part = maps["part"]
    have = part >= 0
    idx = np.nonzero(have)
    lin = project._lin(img)
    L = lin[idx]
    P = maps["P"][idx].astype(np.float64)
    N = maps["N"][idx].astype(np.float64)
    K = part[idx].astype(np.int64)
    for i, name in enumerate(names):
        if name in skip:
            continue
        m = K == i
        if not m.any():
            continue
        if name in PROC:
            L[m] = PROC[name](P[m], N[m])
            log(f"  paint {name}: procedural ({int(m.sum())} texels)")
            continue
        if name not in TONE:
            continue
        hx, con, des = TONE[name]
        tgt = _hl(hx)
        ref = None
        if name == "tabard":
            # up / back-facing texels over the shoulders: the back plate (blue tabard, straps) rather than the front
            # plate's scarf and sleeve paint that the front/back blend mixed in (build 4: pale patches on the upper back)
            n_ = N[m]
            wb = (_ss(-0.35, 0.05, n_[:, 1]) * _ss(0.25, 0.55, n_[:, 2]) * _ss(1.38, 1.44, P[m][:, 2]))[:, None]
            L[m] = L[m] * (1 - wb) + _back_plate(P[m]) * wb
        if name == "mask":
            ref = (N[m][:, 1] < -0.5) & (np.abs(P[m][:, 0]) < 0.05)
        c = _tone(L[m], tgt, con, des, ref)
        cw = _calm_w(name, L[m])
        if cw.any():
            brk0 = (1 + 0.08 * NOISE(P[m], 10.0) + 0.04 * NOISE(P[m], 35.0)) * (0.92 + 0.12 * np.clip(N[m][:, 2], -1, 1))
            c = c * (1 - cw[:, None]) + (tgt * brk0[:, None]) * cw[:, None]
            log(f"  calm {name}: {int((cw > 0.5).sum())} texels of another material")
        if name in SIDE_PARTS:
            n_ = N[m]
            side = np.abs(n_[:, 0]) / (np.abs(n_[:, 0]) + np.abs(n_[:, 1]) + 1e-6)
            ws = _ss(0.62, 0.95, side) * (1 - _ss(0.75, 0.95, np.abs(n_[:, 2])))
            wt = _ss(0.72, 0.92, n_[:, 2])
            w = np.clip(np.maximum(ws, wt) * 0.7, 0, 0.7)[:, None]
            brk = (1 + 0.10 * NOISE(P[m], 10.0) + 0.05 * NOISE(P[m], 35.0)) * (0.90 + 0.14 * np.clip(n_[:, 2], -1, 1))
            c = c * (1 - w) + (tgt * brk[:, None]) * w
        if name == "wrap":
            c = wrap_bands(wrap_shade(c, P[m], N[m]), P[m], N[m])
        L[m] = c
        log(f"  tone {name}: -> {hx}")
    L = np.clip(L, 0.0, None)
    L = L * np.minimum(1.0, MAX_LIN / np.maximum(L.max(1), 1e-6))[:, None]
    lin[idx] = L
    out = project._srgb(lin).astype(np.float32)
    iy, ix = project.nearest_index(have)
    return out[iy, ix]


def _install_paint() -> None:
    from common.hifi import project
    orig = project.paint_object
    if getattr(orig, "_lisvel", False):
        return

    def paint_object(obj, size, cfg, names, part_attr="vale_part", log=print, return_maps=False):
        img, maps = orig(obj, size, cfg, names, part_attr=part_attr, log=log, return_maps=True)
        img = post_paint(img, maps, names, skip=set((cfg.get("flat") or {}).keys()), log=log)
        return (img, maps) if return_maps else img
    paint_object._lisvel = True
    project.paint_object = paint_object


_SKIN = {"id": None}


def almanac_ruling(p):
    """Almanac's parchment limbs ruled in fine ink lines across the limb (every 9 mm) with a margin line along each
    edge, as a page of the almanac"""
    u, v, w = _bow_local(p)
    rule = np.exp(-((np.abs(u) % 0.009 - 0.0045) / 0.0007) ** 2)
    wn = np.abs(w) / np.maximum(_tab(LIMB_W, u) * 0.5, 1e-3)
    margin = np.exp(-((wn - 0.72) / 0.04) ** 2)
    k = np.clip(0.30 * rule + 0.55 * margin, 0, 0.6)
    return k


def gorge_pins(p):
    """Gorgewalk's iron-pinned quiver: a column of ironstone pin heads down the quiver's outer face"""
    q = p - Q_BOT
    t, w, nn = q @ Q_U, q @ Q_W, q @ Q_N
    pin = np.zeros(len(p))
    for tt in np.arange(0.06, 0.50, 0.075):
        for ww in (-0.025, 0.025):
            pin = np.maximum(pin, np.exp(-(((t - tt) ** 2 + (w - ww) ** 2) / 0.0055 ** 2)))
    return pin * (nn > 0.0)


def _install_recolour() -> None:
    from common.hifi import project
    orig = project.recolour
    if getattr(orig, "_lisvel", False):
        return

    def recolour(img, maps, names, roles, base_pal, skin_pal, skip=None, log=print):
        out = orig(img, maps, names, roles, base_pal, skin_pal, skip=skip, log=log)
        sid = _SKIN["id"]
        if sid not in ("lisvel_almanac", "lisvel_gorgewalk"):
            return out
        part = maps["part"]
        iy, ix = project.nearest_index(part >= 0)
        pid = part[iy, ix]
        PP = maps["P"][iy, ix].astype(np.float64)
        olin = project._lin(out)
        if sid == "lisvel_almanac" and "bow" in names:
            m = pid == names.index("bow")
            k = almanac_ruling(PP[m])[:, None]
            olin[m] = olin[m] * (1 - k) + _hl("#2E2A26") * k
            log("  skin: almanac ink ruling on the limbs")
        if sid == "lisvel_gorgewalk" and "quiver" in names:
            m = pid == names.index("quiver")
            k = gorge_pins(PP[m])[:, None]
            olin[m] = olin[m] * (1 - k) + _hl("#3F4348") * k
            log("  skin: gorgewalk quiver pins")
        return project._srgb(olin).astype(np.float32)
    recolour._lisvel = True
    project.recolour = recolour


_install_paint()
_install_recolour()

# ── motion ─────────────────────────────────────────────────────────────────────────────────────────────────────
# The concept's carry is the guard: the bow level across her front, string up, the left fist on the grip, the right
# hand resting on the string. The left (bow) hand is a shoulder-relative IK target in the chest frame plus an aim
# with roll for the bow (its shot axis D and its upper limb U); the right hand is RH: a blend between a free
# shoulder-relative reach (k = 0) and a pinch on the bow's arrow line (k = 1: `along` metres from the grip along the
# shot axis, `uoff` along the chord), so a draw keeps the drawing hand exactly on the arrow line whatever the bow does.
# Every pose carries two extra channels: "_str" (0..1: the string's nock follows the pinch; 0 = the string at rest)
# and "_fan" (0..1: Morning Draw's fan of arrows in the right hand).
HT, FT = anim.HandTarget, anim.FootTarget
POLE_R = (-0.7, 0.6, -0.4)
POLE_L = (0.9, 0.3, -0.3)
UPZ = (0.0, 0.0, 1.0)
REST_L = tuple((WR_L - SH_L) / L_ARM)
REST_R = tuple((WR_R - SH_R) / L_ARM)


@dataclass
class AimRoll(anim.Aim):
    """anim.Aim + `up`: where the held item's prop +Z faces (for the bow: its upper limb U)"""
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


@dataclass
class RH(anim.HandTarget):
    """the drawing hand: free reach (rel, chest frame, arm lengths) blended by k toward the pinch on the bow's arrow
    line (along: m from the grip along the shot axis, negative = toward the archer; uoff: m along the chord);
    fdir: when given, the hand turns so Morning Draw's fan points there"""
    along: float = -BRACE
    uoff: float = 0.0
    k: float = 1.0
    fdir: tuple | None = None

    def __post_init__(self):
        self.to_prop = ("prop.L", self.along)          # resolve() poses it after the bow hand and the aims
        if self.rel is None:
            self.rel = REST_R

    def lerp(self, o, t):
        if not isinstance(o, RH):
            o = RH(rel=o.rel or REST_R, pole=o.pole, weight=o.weight, k=0.0)
        lv = (lambda a, b: tuple(a[i] + (b[i] - a[i]) * t for i in range(3)))  # noqa: E731
        fd = None
        if self.fdir is not None and o.fdir is not None:
            fd = tuple(V(lv(self.fdir, o.fdir)).normalized())
        else:
            fd = o.fdir if t >= 0.5 else self.fdir
        pole = lv(self.pole or POLE_R, o.pole or POLE_R)
        return RH(rel=lv(self.rel, o.rel), pole=pole, weight=self.weight + (o.weight - self.weight) * t,
                  along=self.along + (o.along - self.along) * t, uoff=self.uoff + (o.uoff - self.uoff) * t,
                  k=self.k + (o.k - self.k) * t, fdir=fd)

    def mirrored(self):
        return self


def _install_solvers() -> None:
    if getattr(anim._solve_aim, "_lisvel", False):
        return
    orig_aim = anim._solve_aim

    def solve_aim(skel, pose, M, side, am):
        orig_aim(skel, pose, M, side, am)
        if not isinstance(am, AimRoll) or am.weight <= 0:
            return
        hand, prop = f"hand.{side}", f"prop.{side}"
        M2 = skel.fk(pose)
        R = M2[prop].to_3x3()
        axis = R.col[1].normalized()
        cur = R.col[2].normalized()
        want = V(am.up)
        want = want - axis * want.dot(axis)
        if want.length < 1e-5:
            return
        want.normalize()
        ang = math.atan2(cur.cross(want).dot(axis), cur.dot(want)) * am.weight
        new = Matrix.Rotation(ang, 3, axis) @ M2[hand].to_3x3()
        Ph = (M2[skel.parent[hand]] @ skel.local[hand]).to_3x3()
        pose[hand] = skel.euler_of(Ph.inverted() @ new, pose.get(hand))

    solve_aim._lisvel = True
    anim._solve_aim = solve_aim

    orig_hand = anim._solve_hand

    def solve_hand(skel, pose, M, side, ht):
        if not isinstance(ht, RH):
            return orig_hand(skel, pose, M, side, ht)
        hnd, up, fo = f"hand.{side}", f"upper_arm.{side}", f"forearm.{side}"
        Rc = M["chest"].to_3x3() @ skel.rest["chest"].to_3x3().inverted()
        pole = Rc @ V(ht.pole if ht.pole else POLE_R)
        L = skel.length[up] + skel.length[fo]
        sh = (M[skel.parent[up]] @ skel.local[up]).translation
        target = sh + Rc @ (V(ht.rel) * L)
        k = max(0.0, min(1.0, ht.k))
        end = None
        if k > 1e-4:
            Mp = _prop_l(M, pose)
            R3 = Mp.to_3x3()
            axis, upv = R3.col[1].normalized(), R3.col[2].normalized()
            grip = Mp.translation + axis * ht.along + upv * ht.uoff
            own = f"prop.{side}"
            palm_off = skel.rest[own].translation - skel.rest[hnd].translation
            hand_rest = skel.rest[hnd].to_3x3()
            relm = hand_rest.inverted() @ skel.rest[own].to_3x3()
            fwd = (grip - sh).normalized()
            end = anim._frame_from(axis, fwd, relm)
            t_str = grip - end @ (hand_rest.inverted() @ palm_off)
            target = target.lerp(t_str, k)
        skel.solve_two_bone(pose, M, up, fo, hnd, target, pole, False, None, ht.weight)
        M2 = skel.fk(pose)
        Ph = (M2[skel.parent[hnd]] @ skel.local[hnd]).to_3x3()
        cur = M2[hnd].to_3x3()
        if end is not None:
            q = cur.to_quaternion().slerp(end.to_quaternion(), k)
            cur = q.to_matrix()
        if ht.fdir is not None:
            fan_local = skel.rest[hnd].to_3x3().inverted() @ V(tuple(FAN_AXIS))
            have = (cur @ fan_local).normalized()
            cur = have.rotation_difference(V(ht.fdir).normalized()).to_matrix() @ cur
        pose[hnd] = skel.euler_of(Ph.inverted() @ cur, pose.get(hnd))

    solve_hand._lisvel = True
    anim._solve_hand = solve_hand

    # the shared foot solver turns FootTarget.pitch the wrong way on this rig family (the peers' fix): every pitch is
    # flipped and its offset moved so the foot still turns about the pivot the author meant
    orig_foot = anim._solve_foot

    def solve_foot(skel, pose, M, side, ft):
        pt = ft.pitch
        if abs(pt) > 1e-6:
            rest_f = skel.rest[f"foot.{side}"]
            ankle0 = rest_f.translation.copy()
            ball0 = skel.rest[f"toe.{side}"].translation.copy()
            heel0 = ankle0 + V((0, 0, -ankle0.z)) + (ankle0 - ball0) * V((1, 1, 0)) * 0.55
            lat = rest_f.to_3x3().col[0].normalized()
            pn = -pt
            rot = Matrix.Rotation(math.radians(ft.yaw), 3, "Z") @ Matrix.Rotation(math.radians(-pn), 3, lat)
            want_pv, got_pv = (heel0 if pt > 0 else ball0), (heel0 if pn > 0 else ball0)
            d = (want_pv - got_pv) - rot @ (want_pv - got_pv)
            near = max(0.0, min(1.0, 1.0 - ft.ankle[2] / 0.06))
            toe = ft.toe + (abs(pt) * near if pt < 0 else -pt)
            ft = FT(tuple(ft.ankle[i] + d[i] for i in range(3)), pn, ft.yaw, toe, ft.knee, ft.weight)
        orig_foot(skel, pose, M, side, ft)

    solve_foot._lisvel = True
    anim._solve_foot = solve_foot


_install_solvers()


def _slide(pose):
    return float((pose.get("_slide") or (0.0,))[0])


def _prop_l(M, pose):
    """prop.L's posed matrix with the bow's slide along its chord (pose location (0, 0, HAND_U * slide))"""
    return M["prop.L"] @ Matrix.Translation((0.0, 0.0, HAND_U * _slide(pose)))


def _string_loc(skel, pose):
    """x_string's pose location (its rest frame under the posed prop.L): the nock moved to the right hand's pinch,
    scaled by the pose's "_str" weight"""
    w = float((pose.get("_str") or (0.0,))[0])
    if w <= 1e-4:
        return V((0.0, 0.0, 0.0))
    M = skel.fk(pose)
    target = M["prop.R"].translation
    Mb = _prop_l(M, pose) @ skel.local["x_string"]
    return (Mb.inverted() @ target) * min(1.0, w)


def _fan_scale(pose):
    return max(0.001, min(1.0, float((pose.get("_fan") or (0.0,))[0])))


def _install_keys() -> None:
    if getattr(anim.write_action, "_lisvel", False):
        return
    orig_write = anim.write_action

    def write_action(arm, name, poses, bones=None):
        act = orig_write(arm, name, poses, bones)
        if "x_string" not in arm.pose.bones:
            return act
        skel = anim.Skeleton(arm)
        cb = None
        for layer in act.layers:
            for strip in layer.strips:
                cb = strip.channelbag(act.slots[0], ensure=True)
        n = len(poses)
        locs = [_string_loc(skel, p) for p in poses]
        fans = [_fan_scale(p) for p in poses]
        slides = [HAND_U * _slide(p) for p in poses]
        for i in range(3):
            fc = anim._new_fcurve(cb, 'pose.bones["prop.L"].location', i, "prop.L")
            fc.keyframe_points.add(n)
            fc.keyframe_points.foreach_set("co", [c for f, sl in zip(range(n), slides) for c in (f, sl if i == 2 else 0.0)])
            fc.keyframe_points.foreach_set("interpolation", [1] * n)
            fc.update()
            fc = anim._new_fcurve(cb, 'pose.bones["x_string"].location', i, "x_string")
            fc.keyframe_points.add(n)
            fc.keyframe_points.foreach_set("co", [c for f, l in zip(range(n), locs) for c in (f, l[i])])
            fc.keyframe_points.foreach_set("interpolation", [1] * n)
            fc.update()
            fc = anim._new_fcurve(cb, 'pose.bones["x_fan"].scale', i, "x_fan")
            fc.keyframe_points.add(n)
            fc.keyframe_points.foreach_set("co", [c for f, s in zip(range(n), fans) for c in (f, s)])
            fc.keyframe_points.foreach_set("interpolation", [1] * n)
            fc.update()
        return act

    write_action._lisvel = True
    anim.write_action = write_action

    orig_apply = anim.apply_pose

    def apply_pose(arm, pose):
        orig_apply(arm, pose)
        if "x_string" not in arm.pose.bones:
            return
        skel = anim.Skeleton(arm)
        res = anim.resolve(skel, pose)
        arm.pose.bones["prop.L"].location = (0.0, 0.0, HAND_U * _slide(res))
        arm.pose.bones["x_string"].location = _string_loc(skel, res)
        s = _fan_scale(res)
        arm.pose.bones["x_fan"].scale = (s, s, s)
        bpy.context.view_layer.update()

    apply_pose._lisvel = True
    anim.apply_pose = apply_pose


_install_keys()


def _rz(v, deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]])


def _rx(v, deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([v[0], c * v[1] - s * v[2], s * v[1] + c * v[2]])


def chest_rel(v_world, yaw=0.0, lean=0.0):
    """a world (character-space) wrist offset in arm lengths -> the chest frame of a pose turned `yaw` (deg, + = to
    her left) and leant `lean` (deg, + = forward)"""
    return tuple(_rx(_rz(np.asarray(v_world, float), -yaw), -lean))


def bowl(rel=REST_L, aim=tuple(D_REST), up=tuple(U_REST), pole=POLE_L) -> dict:
    """the bow hand: wrist target (chest frame, arm lengths), the bow's shot axis and upper limb"""
    return {"hand.L": HT(rel=tuple(rel), pole=tuple(pole)), "aim.L": AimRoll(tuple(_n(aim)), 1.0, tuple(_n(up)))}


def rh(along=-BRACE, uoff=PINCH_U, k=1.0, rel=REST_R, pole=POLE_R, fdir=None) -> dict:
    return {"hand.R": RH(rel=tuple(rel), pole=tuple(pole), along=along, uoff=uoff, k=k, fdir=fdir)}


def feet_(l=(0.0, 0.0, 0.0), r=(0.0, 0.0, 0.0), yl=2.0, yr=-8.0, pl=0.0, pr=0.0, kl=0.0, kr=0.0) -> dict:
    return anim.feet(l=l, r=r, yl=yl, yr=yr, pl=pl, pr=pr, kl=kl, kr=kr)


FEET0 = feet_(l=(0.012, -0.03, 0.0), r=(-0.012, 0.04, 0.0))


def pz(lean=2.0, yaw=0.0, roll=0.0, drop=0.02, dx=0.0, dy=0.0, look=(0.0, 0.0, 0.0), feet=None, L=None, R=None,
       string=0.0, fan=0.0, slide=0.0, extra=None, keep_head=0.9) -> dict:
    """a body pose: lean / yaw / roll spread over hips, spine and chest, the head held toward the front (keep_head of
    the yaw countered; look = extra head pitch / yaw / roll), hips dropped by `drop`, feet planted by IK"""
    p = anim.merge(anim.arms_relaxed(), anim.P(
        hips=(lean * 0.40, yaw * 0.30, roll * 0.5), spine=(lean * 0.30, yaw * 0.30, -roll * 0.3),
        chest=(lean * 0.30, yaw * 0.40, -roll * 0.2),
        neck=(-lean * 0.45 + look[0] * 0.4, -yaw * keep_head * 0.45 + look[1] * 0.4, look[2] * 0.4),
        head=(-lean * 0.45 + look[0] * 0.6, -yaw * keep_head * 0.55 + look[1] * 0.6, look[2] * 0.6)))
    p["hips_loc"] = (dx, dy, -drop)
    ik = dict(feet if feet is not None else FEET0)
    ik.update(L if L is not None else bowl())
    ik.update(R if R is not None else rh())
    p["ik"] = ik
    p["_str"] = (float(string), 0.0, 0.0)
    p["_fan"] = (float(fan), 0.0, 0.0)
    p["_slide"] = (float(slide), 0.0, 0.0)
    if extra:
        p = anim.add(p, extra)
    return p


def G(**kw) -> dict:
    """the guard: the concept's carry, upright, the weight even"""
    kw.setdefault("lean", 2.0)
    kw.setdefault("yaw", -4.0)
    return pz(**kw)


def shot_arms(draw, elev=0.0, cant=12.0, yaw=-45.0, lean=0.0, reach=0.93, side=0.0, k=1.0, uoff=0.0, rel_r=REST_R):
    """the bow arm straight at the target (elevation `elev` deg, `side` deg toward her left), the bow canted `cant`
    deg (its upper limb toward her right), the string drawn `draw` m past brace"""
    e, s_ = math.radians(elev), math.radians(side)
    d = np.array([math.sin(s_) * math.cos(e), -math.cos(s_) * math.cos(e), math.sin(e)])
    c = math.radians(cant)
    up = np.array([-math.sin(c), 0.0, math.cos(c)])
    up = _rz(up, side)
    # the bow arm a little above level (build 4: the fist hangs ~7 cm under the wrist, so a level arm put the arrow line
    # at the chest and the drawing hand at the belt; the anchor belongs under the jaw)
    rel = chest_rel(d * reach + np.array([0.0, 0.0, 0.22]), yaw, lean)
    out = bowl(rel=rel, aim=tuple(d), up=tuple(up), pole=(0.75, 0.25, -0.6))
    out.update(rh(along=-(BRACE + draw), uoff=uoff, k=k, rel=rel_r, pole=(-0.85, 0.45, 0.15)))
    return out


def _shoot(p, *a, slide=1.0, **kw):
    """pose `p` takes a shot's arms (shot_arms) and the bow slides its grip into the fist"""
    p["ik"].update(shot_arms(*a, **kw))
    p["_slide"] = (float(slide), 0.0, 0.0)
    return p


def clip(name, N, keys, loop=False, impact=None, lags=None) -> anim.Clip:
    fn = anim.keyed(keys)
    if lags:
        fn = anim.drag(fn, N, lags, loop=loop)
    return anim.Clip(name, N, loop, fn, impact=impact)


BLOCKS: dict = {}
MOTION = anim.motion_profile(weight="light", weapon="bow", stance="neutral", run_ref_speed=3.35, cadence=0.95,
                             arm_swing=0.85)
RUN_LEAN = anim.P(hips=(2.0, 0, 0), spine=(1.5, 0, 0), chest=(0.5, 0, 0), neck=(-1.5, 0, 0), head=(-2.5, 0, 0))
# the run's carry: the bow level at the hip in front, its plane near horizontal (the tips low: the HP bar), the
# right arm pumping free
RUN_BOW = bowl(rel=(-0.06, -0.42, -0.80), aim=(0.0, -0.80, -0.60), up=(1.0, 0.0, 0.0), pole=(0.8, 0.3, -0.5))
RUN_R_FWD = (-0.10, -0.55, -0.62)
RUN_R_BACK = (-0.14, 0.34, -0.82)


def gen_run() -> anim.Clip:
    c = anim.gen_run(MOTION)
    base = c.sample
    N = c.frames

    def sample(t):
        p = anim.add(base(t), RUN_LEAN)
        q = t % 1.0
        sw = MOTION["arm_swing"] * math.cos(2 * math.pi * (q - 0.03))
        tR = 0.5 - 0.5 * sw
        rr = tuple(RUN_R_FWD[i] + (RUN_R_BACK[i] - RUN_R_FWD[i]) * tR for i in range(3))
        ik = dict(p["ik"])
        for k_ in ("hand.L", "hand.R", "aim.L", "aim.R"):
            ik.pop(k_, None)
        bob = 0.02 * math.cos(4 * math.pi * q)
        ik.update(bowl(rel=(RUN_BOW["hand.L"].rel[0], RUN_BOW["hand.L"].rel[1], RUN_BOW["hand.L"].rel[2] + bob),
                       aim=RUN_BOW["aim.L"].dir, up=RUN_BOW["aim.L"].up, pole=(0.8, 0.3, -0.5)))
        ik.update(rh(k=0.0, rel=rr, pole=(-0.8, 0.4, -0.3)))
        p = dict(p)
        p["ik"] = ik
        p["_str"] = (0.0, 0.0, 0.0)
        p["_fan"] = (0.0, 0.0, 0.0)
        return p
    return anim.Clip("run", N, True, sample, meta=c.meta)


def run_pose(q: float) -> dict:
    return gen_run().sample(q % 1.0)


def gen_idle() -> anim.Clip:
    """breathing over the carry; the head turns slowly toward something far away and back"""
    base = G()
    N = 90

    def sample(t):
        b = anim.osc(t, 3)
        s = anim.osc(t, 1, 0.1)
        h = anim.osc(t, 1, 0.3)
        d = anim.P(chest=(1.0 * b, 0, 0), spine=(0.4 * b, 0, 0.5 * s), neck=(-0.6 * b, 3.0 * h, 0),
                   head=(-0.4 * b, 7.0 * h, 1.5 * h), shoulder_L=(0, 0, 1.0 * b), shoulder_R=(0, 0, -1.0 * b),
                   hips=(0, 1.0 * s, -0.8 * s))
        p = anim.add(base, d)
        dz = 0.008 * anim.osc(t, 3, 0.08)
        p = dict(p)
        p["ik"] = dict(p["ik"])
        hl = p["ik"]["hand.L"]
        p["ik"]["hand.L"] = HT(rel=(hl.rel[0], hl.rel[1], hl.rel[2] + dz), pole=hl.pole)
        return anim._with_hips(p, (0.008 * s, 0.0, -0.004 * (0.5 + 0.5 * b)))

    return anim.Clip("idle", N, True, sample)


FEET_SHOT = feet_(l=(0.04, -0.10, 0.0), r=(-0.04, 0.11, 0.0), yl=-24.0, yr=-58.0)
FEET_STEPB = feet_(l=(0.04, -0.06, 0.0), r=(-0.06, 0.22, 0.0), yl=-22.0, yr=-56.0)
FEET_LUNGE = feet_(l=(0.05, -0.24, 0.0), r=(-0.04, 0.12, 0.0), yl=-26.0, yr=-60.0, pr=-10.0)


def _shot_clip(name, N, wind, draw, hit, fol, g=None, extra_keys=None, lags=None):
    """a bow shot on the VALE timing: guard -> lift (0.10) -> wind (0.24) -> full draw (0.33) -> anchor drift (0.37) ->
    RELEASE at 0.40 (the string snaps back on the impact frame, the drawing hand slides back along the line) ->
    follow-through (0.56) -> recover (0.78) -> guard"""
    g = g or G()
    rec = anim.lerp_pose(fol, g, 0.5)
    keys = [(0.0, g, "linear"), (0.10, wind, "inout"), (0.26, draw, "inout"),
            (0.36, anim._with_hips(anim.lerp_pose(draw, hit, 0.08), (0, 0, -0.004)), "out"),
            (anim.IMPACT, hit, "accel"), (0.56, fol, "out"), (0.78, rec, "inout"), (1.0, g, "settle")]
    if extra_keys:
        keys = sorted(keys + extra_keys, key=lambda k_: k_[0])
    return clip(name, N, keys, impact=anim.IMPACT, lags=lags or {"head": 1.0, "neck": 0.5})


def gen_attack1() -> anim.Clip:
    """a quick draw and release, the bow near upright: the bow rises from level, the left arm straight at the target,
    the right hand draws to the jaw; the arrow leaves at f8 (the string snaps back), the drawing hand slides back"""
    wind = pz(lean=2.0, yaw=-22.0, drop=0.03, feet=FEET_SHOT, string=1.0)
    _shoot(wind, 0.10, elev=-18, cant=55, yaw=-22, reach=0.78, uoff=-0.05)
    draw = pz(lean=0.0, yaw=-70.0, drop=0.04, feet=FEET_SHOT, string=1.0, look=(0.0, 6.0, 0.0))
    _shoot(draw, 0.43, elev=2, cant=22, yaw=-70)
    hit = pz(lean=1.0, yaw=-72.0, drop=0.05, feet=FEET_SHOT, string=0.0, look=(0.0, 6.0, 0.0))
    _shoot(hit, 0.56, elev=3, cant=24, yaw=-72)
    fol = pz(lean=2.0, yaw=-66.0, drop=0.045, feet=FEET_SHOT, string=0.0, look=(0.0, 4.0, 0.0))
    _shoot(fol, 0.60, elev=0, cant=26, yaw=-66, k=0.75, rel_r=(-0.30, 0.22, 0.10))
    return _shot_clip("attack1", 20, wind, draw, hit, fol)


def gen_attack2() -> anim.Clip:
    """a draw with a half-step back: the right foot steps back as the bow comes up canted (45 degrees), the release
    at f8 low and flat"""
    wind = pz(lean=4.0, yaw=-26.0, drop=0.05, feet=FEET_STEPB, string=1.0, dy=0.03)
    _shoot(wind, 0.12, elev=-14, cant=60, yaw=-26, reach=0.80, uoff=-0.05)
    draw = pz(lean=4.0, yaw=-64.0, drop=0.07, feet=FEET_STEPB, string=1.0, dy=0.05, look=(0.0, 6.0, 0.0))
    _shoot(draw, 0.42, elev=-3, cant=44, yaw=-64)
    hit = pz(lean=5.0, yaw=-66.0, drop=0.075, feet=FEET_STEPB, string=0.0, dy=0.05, look=(0.0, 6.0, 0.0))
    _shoot(hit, 0.55, elev=-2, cant=46, yaw=-66)
    fol = pz(lean=6.0, yaw=-60.0, drop=0.07, feet=FEET_STEPB, string=0.0, dy=0.04)
    _shoot(fol, 0.58, elev=-4, cant=50, yaw=-60, k=0.7, rel_r=(-0.32, 0.20, 0.0))
    return _shot_clip("attack2", 20, wind, draw, hit, fol)


def gen_dawn_line() -> anim.Clip:
    """cast_a1 Dawn Line, 25 f, the arrow leaves at f10: the level bar rises and cants into a long diagonal (40
    degrees), a long step in with the left foot, the right hand drawing past the jaw (the string stretched long);
    at f10 the release with a small recoil (the bow kicks, the body rocks back); the drawing hand opens behind the
    shoulder; recovers by f25"""
    wind = pz(lean=4.0, yaw=-24.0, drop=0.05, feet=FEET_SHOT, string=1.0)
    _shoot(wind, 0.10, elev=-20, cant=62, yaw=-24, reach=0.76, uoff=-0.06)
    draw = pz(lean=-3.0, yaw=-76.0, drop=0.09, feet=FEET_LUNGE, string=1.0, dy=-0.03, look=(0.0, 8.0, 0.0))
    _shoot(draw, 0.47, elev=4, cant=40, yaw=-76, reach=0.95)
    hit = pz(lean=-6.0, yaw=-78.0, drop=0.10, feet=FEET_LUNGE, string=0.0, dy=-0.01, look=(0.0, 8.0, 0.0))
    _shoot(hit, 0.62, elev=9, cant=42, yaw=-78, reach=0.96)
    fol = pz(lean=-2.0, yaw=-72.0, drop=0.09, feet=FEET_LUNGE, string=0.0, dy=-0.02, look=(0.0, 6.0, 0.0))
    _shoot(fol, 0.64, elev=3, cant=40, yaw=-72, k=0.6, rel_r=(-0.34, 0.26, 0.14))
    return _shot_clip("cast_a1", 25, wind, draw, hit, fol, lags={"head": 1.0, "neck": 0.5})


def _hop(lift, tuck, lean=6.0, draw=0.10):
    """the Backstep's airborne pose: hips up `lift`, both knees drawn up by `tuck` (m), the bow level and a little
    high, the drawing hand nocking an arrow on the string"""
    p = pz(lean=lean, drop=-lift, dy=0.02, look=(-6.0, 0.0, 0.0),
           feet=feet_(l=(0.02, -0.04, tuck), r=(-0.02, 0.06, tuck * 0.9), pl=-25.0, pr=-30.0), string=1.0)
    p["ik"].update(bowl(rel=(REST_L[0] - 0.02, REST_L[1] - 0.10, REST_L[2] + 0.16), aim=tuple(D_REST), up=tuple(U_REST)))
    p["ik"].update(rh(along=-(BRACE + draw), uoff=-0.03))
    return p


def gen_backstep() -> anim.Clip:
    """cast_a2 Backstep, 15 f, apex f6 (castTime 0.1: a 2-frame dip): a sprung crouch, both feet leave the ground,
    the knees drawn up, the bow held level, the free hand nocking an arrow in the air; she lands in a ready stance.
    The `dash` clip is the airborne hold of the same pose (no second take-off)."""
    g = G()
    dip = pz(lean=10.0, drop=0.11, dy=0.01, feet=FEET0)
    push = pz(lean=8.0, drop=-0.06, feet=feet_(l=(0.012, -0.03, 0.06), r=(-0.012, 0.04, 0.06), pl=-35.0, pr=-35.0),
              string=0.6)
    apex = _hop(0.26, 0.30)
    fall = _hop(0.14, 0.16, lean=4.0, draw=0.06)
    land = pz(lean=12.0, drop=0.12, dy=0.0, feet=FEET0, string=0.0)
    keys = [(0.0, g, "linear"), (0.12, dip, "inout"), (0.24, push, "out"), (anim.IMPACT, apex, "out"),
            (0.60, fall, "in"), (0.70, land, "in"), (0.84, anim._with_hips(anim.lerp_pose(land, g, 0.6), (0, 0, 0.004)), "out"),
            (1.0, g, "settle")]
    return clip("cast_a2", 15, keys, impact=anim.IMPACT, lags={"head": 1.0})


def gen_dash() -> anim.Clip:
    """the Backstep's flight (cast_a2's follow-through): the apex tuck held, a small float (loops)"""
    N = 10

    def sample(t):
        b = 0.5 + 0.5 * math.cos(2 * math.pi * t)
        return anim.lerp_pose(_hop(0.24, 0.28), _hop(0.27, 0.31), b)

    return anim.Clip("dash", N, True, sample)


Q_REACH = chest_rel((Q_TOP + np.array([-0.01, 0.0, 0.10]) - SH_R) / L_ARM)


def gen_morning_draw() -> anim.Clip:
    """cast_a3 Morning Draw, 20 f, the fan at f8 (castTime 0: two frames of anticipation): the right hand leaves the
    string, sweeps back to the quiver at her right hip and pulls three arrows, fanning them between the fingers at
    the shoulder as her chest lifts with a breath (f8); they snap back into the quiver and the hand returns to the
    string"""
    g = G()
    reach = pz(lean=4.0, yaw=8.0, drop=0.03, look=(4.0, -16.0, 0.0),
               R=rh(k=0.0, rel=Q_REACH, pole=(-0.6, 0.8, 0.0)))
    pull = pz(lean=0.0, yaw=4.0, drop=0.02, look=(0.0, -20.0, 0.0), fan=1.0,
              R=rh(k=0.0, rel=(-0.30, 0.06, -0.12), pole=(-0.7, 0.6, -0.3), fdir=(-0.2, 0.3, 0.93)))
    fan = pz(lean=-7.0, yaw=-6.0, drop=0.0, look=(-6.0, -26.0, -4.0), fan=1.0,
             R=rh(k=0.0, rel=(-0.34, -0.12, 0.22), pole=(-0.8, 0.3, -0.5), fdir=(-0.38, -0.12, 0.92)),
             extra=anim.P(chest=(-3.0, 0, 0), shoulder_R=(0, 0, 6.0)))
    hold = pz(lean=-6.0, yaw=-5.0, drop=0.0, look=(-5.0, -24.0, -4.0), fan=1.0,
              R=rh(k=0.0, rel=(-0.35, -0.13, 0.24), pole=(-0.8, 0.3, -0.5), fdir=(-0.40, -0.10, 0.91)),
              extra=anim.P(chest=(-3.0, 0, 0), shoulder_R=(0, 0, 6.0)))
    back = pz(lean=3.0, yaw=8.0, drop=0.03, look=(2.0, -12.0, 0.0), fan=0.0,
              R=rh(k=0.0, rel=Q_REACH, pole=(-0.6, 0.8, 0.0), fdir=(0.0, 0.0, 1.0)))
    ret = G()
    ret["ik"].update(rh(k=0.55, rel=(-0.18, -0.15, -0.45)))
    keys = [(0.0, g, "linear"), (0.10, anim.lerp_pose(g, reach, 0.35), "in"), (0.22, reach, "out"),
            (0.30, pull, "inout"), (anim.IMPACT, fan, "out"), (0.52, hold, "inout"), (0.64, back, "in"),
            (0.82, ret, "out"), (1.0, g, "settle")]
    return clip("cast_a3", 20, keys, impact=anim.IMPACT, lags={"head": 1.0})


def gen_sun_corridor() -> anim.Clip:
    """cast_ult Sun Corridor, 35 f, the great arrow leaves at f14: she raises the bow over her head and draws toward
    the sky (a wide diagonal; f4-f10, the pose breathes and the string trembles), then swings it down to the aim
    line, the bow turned flat (a long horizontal bar), and looses at f14, rocking back with the shot; the
    follow-through holds the bow level along the cast line to f26, then lowers"""
    g = G()
    dip = pz(lean=8.0, yaw=-8.0, drop=0.07, string=0.0)
    dip["ik"].update(bowl(rel=(REST_L[0], REST_L[1] + 0.05, REST_L[2] - 0.05), aim=(0.0, -0.20, -0.98), up=(1.0, 0.0, 0.0)))
    sky = pz(lean=-14.0, yaw=-48.0, drop=0.05, string=1.0, look=(-26.0, 4.0, 0.0), feet=FEET_SHOT)
    _shoot(sky, 0.40, elev=62, cant=28, yaw=-48, lean=-14, reach=0.95)
    sky2 = pz(lean=-15.0, yaw=-49.0, drop=0.055, string=1.0, look=(-28.0, 4.0, 0.0), feet=FEET_SHOT)
    _shoot(sky2, 0.44, elev=63, cant=30, yaw=-49, lean=-15, reach=0.96)
    sky3 = pz(lean=-14.0, yaw=-48.0, drop=0.05, string=1.0, look=(-26.0, 4.0, 0.0), feet=FEET_SHOT)
    _shoot(sky3, 0.42, elev=62, cant=28, yaw=-48, lean=-14, reach=0.95)
    aim = pz(lean=-2.0, yaw=-40.0, drop=0.08, string=1.0, look=(2.0, 4.0, 0.0), feet=FEET_LUNGE)
    _shoot(aim, 0.50, elev=1, cant=86, yaw=-40, reach=0.94)
    hit = pz(lean=-9.0, yaw=-40.0, drop=0.08, dy=0.05, string=0.0, look=(0.0, 4.0, 0.0), feet=FEET_LUNGE)
    _shoot(hit, 0.66, elev=4, cant=88, yaw=-40, reach=0.94)
    fol = pz(lean=-5.0, yaw=-38.0, drop=0.08, dy=0.03, string=0.0, look=(0.0, 3.0, 0.0), feet=FEET_LUNGE)
    _shoot(fol, 0.62, elev=1, cant=88, yaw=-38, reach=0.94, k=0.7, rel_r=(-0.34, 0.24, 0.08))
    fol2 = anim._with_hips(anim.lerp_pose(fol, hit, 0.1), (0, 0, -0.003))
    keys = [(0.0, g, "linear"), (0.10, dip, "inout"), (0.26, sky, "out"), (0.30, sky2, "inout"), (0.33, sky3, "inout"),
            (0.375, aim, "inout"), (anim.IMPACT, hit, "accel"), (0.52, fol, "out"), (0.74, fol2, "inout"),
            (0.90, anim.lerp_pose(fol2, g, 0.6), "inout"), (1.0, g, "settle")]
    return clip("cast_ult", 35, keys, impact=anim.IMPACT, lags={"head": 1.0, "neck": 0.5})


def gen_death(skel) -> anim.Clip:
    """struck, she rocks back, the bow sags out of the draw line, her knees go and she drops to them, then topples
    onto her right side, the bow falling flat beside her (at rest)"""
    g = G()
    hip_h = skel.rest_point("hips").z
    recoil = pz(lean=-14.0, yaw=10.0, drop=0.04, dy=0.05, look=(-16.0, 0.0, 0.0), string=0.0)
    recoil["ik"].update(bowl(rel=(REST_L[0] + 0.05, REST_L[1] + 0.05, REST_L[2] - 0.05), aim=(0.2, -0.3, -0.93), up=(0.9, 0.1, 0.4)))
    recoil["ik"].update(rh(k=0.0, rel=(-0.20, 0.0, -0.80)))
    kneel = pz(lean=18.0, yaw=6.0, drop=0.44, dy=0.08, look=(14.0, 0.0, 0.0), string=0.0,
               feet=feet_(l=(0.02, 0.22, 0.04), r=(-0.02, 0.26, 0.04), pl=-62.0, pr=-62.0, yl=2.0, yr=-6.0))
    kneel["ik"].update(bowl(rel=(0.16, -0.20, -0.95), aim=(0.4, -0.2, -0.9), up=(0.85, 0.3, 0.4)))
    kneel["ik"].update(rh(k=0.0, rel=(-0.12, -0.20, -0.95)))
    down = anim.merge(anim.arms_relaxed(), anim.P(hips=(-10.0, 4.0, 78.0), spine=(8, 0, 6), chest=(6, 0, 4), neck=(4, 0, -10),
                                                  head=(2, 0, -14), thigh_L=(70, 0, -6), shin_L=(-95, 0, 0), foot_L=(30, 0, 0),
                                                  thigh_R=(62, 0, 4), shin_R=(-100, 0, 0), foot_R=(30, 0, 0),
                                                  upper_arm_L=(30, 0, 30), forearm_L=(20, 0, 0),
                                                  upper_arm_R=(40, 0, -10), forearm_R=(30, 0, 0)))
    down["hips_loc"] = (-0.32, 0.10, -hip_h + 0.17)
    down["ik"] = {"aim.L": AimRoll((0.25, -0.97, -0.05), 1.0, (0.97, 0.25, 0.0))}      # the bow fallen flat
    down["_str"] = (0.0, 0.0, 0.0)
    down["_fan"] = (0.0, 0.0, 0.0)
    bounce = anim._with_hips(anim.add(down, anim.P(spine=(-3, 0, 0), chest=(-3, 0, 0))), (0.0, 0.0, 0.03))
    rest = anim.add(down, anim.P(head=(4, 0, -2)))
    N = 45
    keys = [(0.0, g, "linear"), (0.10, recoil, "snap"), (0.36, kneel, "in"), (0.46, kneel, "linear"),
            (0.70, down, "in"), (0.78, bounce, "out"), (0.88, rest, "inout"), (1.0, rest, "linear")]
    return clip("death", N, keys)


def gen_recall() -> anim.Clip:
    """recall (loops): the bow lowered and turned upright before her like a harp, the string to her chest; the right
    hand plucks it slowly, up and down its length, the head tilted as she hums"""
    N = 90
    base = pz(lean=4.0, yaw=0.0, drop=0.03, look=(10.0, 0.0, 8.0), string=0.0)
    harp_l = bowl(rel=(-0.10, -0.62, -0.36), aim=(-1.0, -0.05, 0.0), up=(0.0, 0.0, 1.0), pole=(0.8, 0.4, -0.4))

    def sample(t):
        p = dict(base)
        p["ik"] = dict(base["ik"])
        p["ik"].update(harp_l)
        a = math.sin(2 * math.pi * 2 * t)
        pl = 0.5 + 0.5 * math.sin(2 * math.pi * 4 * t)
        p["ik"].update(rh(along=-(BRACE + 0.012 * pl), uoff=0.05 + 0.13 * a, k=1.0, pole=(-0.8, 0.2, -0.5)))
        b = anim.osc(t, 3)
        p = anim.add(p, anim.P(chest=(1.0 * b, 0, 0), head=(0, 3.0 * a, 1.5 * b)))
        p["_str"] = (0.35 * pl, 0.0, 0.0)
        return p

    return anim.Clip("recall", N, True, sample)


def gen_idle_lobby() -> anim.Clip:
    """open and unhurried: the bow lowered at her left side, the right hand conducting four slow counts of the dawn
    motif, then a stop, the head tilted as if waiting for someone to supply the fifth; she looks over her shoulder at
    the camera, then counts again (120 f, closed loop)"""
    N = 120
    # the bow lowered and stood upright at her left side like a staff, its upper tip cap by her shoulder (the brief's
    # portrait: idle_lobby t 0 shows the visor, the wrap and the near bow tip cap)
    low = bowl(rel=(0.16, -0.16, -0.86), aim=(0.30, -0.95, 0.0), up=(0.10, 0.12, 0.99), pole=(0.8, 0.4, -0.3))
    g = pz(lean=1.0, yaw=0.0, drop=0.02, L=low, R=rh(k=0.0, rel=(-0.12, -0.42, -0.50)))
    beats = [(-0.10, -0.46, -0.36), (-0.02, -0.50, -0.50), (-0.22, -0.48, -0.44), (-0.12, -0.52, -0.24)]

    def seg(t, a, b):
        return min(1.0, max(0.0, (t - a) / (b - a)))

    def sample(t):
        p = dict(g)
        p["ik"] = dict(g["ik"])
        rel = np.array((-0.12, -0.42, -0.50))
        head = np.zeros(3)
        chest = np.zeros(3)
        hips = np.zeros(3)
        # 0.00-0.40 four slow counts (down, in, out, up), the hand swinging between the beats
        if t < 0.42:
            u = seg(t, 0.02, 0.40) * 4.0
            i = min(3, int(u))
            f = u - i
            a = np.array(beats[i - 1] if i > 0 else (-0.12, -0.42, -0.50))
            b = np.array(beats[i])
            e = anim.ease_in_out(min(1.0, f * 1.6))
            rel = a + (b - a) * e
            env = math.sin(math.pi * seg(t, 0.0, 0.42))
            rel = np.array((-0.12, -0.42, -0.50)) * (1 - env) + rel * env
            head = np.array((2.0 * math.sin(math.pi * u), 0.0, 3.0 * math.sin(math.pi * u * 0.5))) * env
        # 0.40-0.55 the stop: the hand held up, the head tilted, waiting for the fifth
        w = math.sin(math.pi * seg(t, 0.38, 0.60)) if 0.38 < t < 0.60 else 0.0
        if w > 0:
            rel = rel * (1 - w) + np.array((-0.14, -0.50, -0.20)) * w
            head = head + np.array((-4.0, 6.0, 14.0)) * w
        # 0.55-0.85 a look over her right shoulder at the camera (a smile behind the visor)
        c = math.sin(math.pi * seg(t, 0.56, 0.88)) if 0.56 < t < 0.88 else 0.0
        if c > 0:
            head = head + np.array((-2.0, -38.0, -6.0)) * c
            chest = chest + np.array((0.0, -10.0, 0.0)) * c
            hips = hips + np.array((0.0, -5.0, 0.0)) * c
            rel = rel * (1 - 0.6 * c) + np.array((-0.10, -0.30, -0.70)) * 0.6 * c
        # 0.86-1.00 the first count again (a lift into the next bar)
        d = math.sin(math.pi * seg(t, 0.86, 1.0)) if t > 0.86 else 0.0
        if d > 0:
            rel = rel * (1 - d) + np.array(beats[0]) * d
        p["ik"].update(rh(k=0.0, rel=tuple(rel), pole=(-0.8, 0.3, -0.4)))
        b = anim.osc(t, 4)
        p = anim.add(p, anim.P(chest=(0.8 * b + chest[0], chest[1], chest[2]), neck=tuple(head * 0.35),
                               head=tuple(head * 0.65), hips=tuple(hips)))
        return p

    return anim.Clip("idle_lobby", N, True, sample)


SALUTE = chest_rel((np.array([-0.128, -0.045, 1.810]) - SH_R) / L_ARM)    # the wrist above her right temple, the
                                                                          # flat hand over the wrap's brow (build 6
                                                                          # splash: lower, it covered the face)


def gen_victory() -> anim.Clip:
    """she looses an arrow along the ground (a quick draw aimed down-forward, released at f13) and steps onto the line
    of light; the hold: the bow level across her body, the right hand raised to the visor in a salute to the dawn,
    a quarter turned from the camera (50 f, then the hold)"""
    g = G()
    draw = pz(lean=8.0, yaw=-58.0, drop=0.06, feet=FEET_SHOT, string=1.0, look=(12.0, 4.0, 0.0))
    _shoot(draw, 0.40, elev=-26, cant=18, yaw=-58, lean=8, reach=0.92)
    hit = pz(lean=9.0, yaw=-58.0, drop=0.065, feet=FEET_SHOT, string=0.0, look=(12.0, 4.0, 0.0))
    _shoot(hit, 0.54, elev=-25, cant=20, yaw=-58, lean=9, reach=0.92)
    step = pz(lean=3.0, yaw=-10.0, drop=0.05, dy=-0.06, string=0.0,
              feet=feet_(l=(0.02, -0.22, 0.06), r=(-0.012, 0.04, 0.0), yl=0.0, yr=-10.0, pl=10.0))
    hold_l = bowl(rel=(REST_L[0] - 0.02, REST_L[1] - 0.10, REST_L[2] + 0.12), aim=tuple(D_REST), up=tuple(U_REST))
    hold = pz(lean=0.0, yaw=24.0, drop=0.02, dy=-0.10, look=(-6.0, -6.0, 0.0), string=0.0,
              feet=feet_(l=(0.02, -0.22, 0.0), r=(-0.012, 0.04, 0.0), yl=10.0, yr=0.0), L=hold_l,
              R=rh(k=0.0, rel=SALUTE, pole=(-0.9, -0.1, -0.4)), keep_head=0.6)
    keys = [(0.0, g, "linear"), (0.10, anim.lerp_pose(g, draw, 0.5), "inout"), (0.22, draw, "out"),
            (0.26, hit, "accel"), (0.40, step, "inout"), (0.62, hold, "out"), (1.0, hold, "linear")]
    base = anim.drag(anim.keyed(keys), 50, {"head": 2.0, "neck": 1.0})

    def sample(t):
        p = base(t)
        if t > 0.62:
            k = min(1.0, (t - 0.62) / 0.15)
            p = anim.add(p, anim.P(chest=(0.8 * k * anim.osc(t, 2), 0, 0)))
        return p

    return anim.Clip("victory", 50, False, sample)


def gen_taunt() -> anim.Clip:
    """taps the bow's lower tip on the ground twice, a clear glass note, and nods"""
    g = G()
    side_l = bowl(rel=(0.34, -0.10, -0.88), aim=(1.0, -0.15, 0.0), up=(0.0, 0.0, 1.0), pole=(0.7, 0.5, -0.4))
    up_ = pz(lean=4.0, yaw=8.0, roll=-6.0, drop=0.08, look=(10.0, 10.0, 0.0), L=side_l,
             R=rh(k=0.0, rel=(-0.10, -0.25, -0.80)))
    tap = pz(lean=6.0, yaw=8.0, roll=-8.0, drop=0.13, look=(14.0, 12.0, 0.0), L=side_l,
             R=rh(k=0.0, rel=(-0.10, -0.25, -0.80)))
    nod = anim.add(up_, anim.P(head=(12, 6, 0), neck=(4, 4, 0)))
    keys = [(0.0, g, "linear"), (0.22, up_, "inout"), (0.32, tap, "in"), (0.40, up_, "out"), (0.48, tap, "in"),
            (0.56, up_, "out"), (0.70, nod, "inout"), (0.80, up_, "inout"), (1.0, g, "inout")]
    return clip("taunt", 60, keys, lags={"head": 1.5})


def gen_stunned() -> anim.Clip:
    """stumbling, the bow raised before her face"""
    base = pz(lean=10.0, drop=0.07, look=(12.0, 0.0, 0.0), string=0.0,
              L=bowl(rel=(0.02, -0.55, -0.10), aim=(0.1, -0.55, 0.83), up=(1.0, 0.0, 0.1)),
              R=rh(k=0.0, rel=(-0.10, -0.40, -0.40)))
    N = 40

    def sample(t):
        a, b = anim.osc(t, 1), anim.osc(t, 1, 0.25)
        return anim.add(base, anim.P(hips=(0, 0, 4 * a), spine=(3 * b, 0, -3 * a), chest=(3 * b, 0, -3 * a),
                                     neck=(6 * b, 0, 6 * a), head=(8 * b, 4 * a, 8 * a)))

    return anim.Clip("stunned", N, True, sample)


def gen_channel() -> anim.Clip:
    """a held half draw, the bow raised, breathing"""
    base = pz(lean=0.0, yaw=-62.0, drop=0.04, feet=FEET_SHOT, string=1.0, look=(0.0, 6.0, 0.0))
    _shoot(base, 0.25, elev=8, cant=20, yaw=-62)
    N = 40

    def sample(t):
        p = anim.add(base, anim.P(chest=(1.0 * anim.osc(t, 2), 0, 0), head=(-0.6 * anim.osc(t, 2), 0, 0)))
        return p

    return anim.Clip("channel", N, True, sample)


def clip_overrides(ctx) -> dict:
    skel = anim.Skeleton(ctx.info.armature)
    return {"idle": gen_idle(), "run": gen_run(), "attack1": gen_attack1(), "attack2": gen_attack2(),
            "cast_a1": gen_dawn_line(), "cast_a2": gen_backstep(), "cast_a3": gen_morning_draw(),
            "cast_ult": gen_sun_corridor(), "death": gen_death(skel), "recall": gen_recall(),
            "idle_lobby": gen_idle_lobby(), "victory": gen_victory(), "dash": gen_dash(), "stunned": gen_stunned(),
            "channel": gen_channel(), "taunt": gen_taunt()}


def model(ctx) -> list:
    P = []
    _SKIN["id"] = (ctx.skin or {}).get("id")
    extra = (ctx.skin or {}).get("extra") or {}
    items = sculpts() + skin_extras(extra)
    for name, S, vs, role, bind, tris, uvw in items:
        if name == "string":
            low = string_mesh(ctx.col)
            low.data.materials.append(ctx.mats[role])
            high = string_mesh(ctx.col)                 # its own bake source (the pipeline reads the part's role
            high.name = "string_high"                   # from the high after the low is joined into the body)
            high.data.materials.append(ctx.mats[role])
            P.append(fighter.Part(name, high=high, low=low, bind=bind, uv_weight=uvw))
            continue
        if extra.get("page_fletching") and name in ("fletching", "fan_fletch"):
            S = page_fletching(name)
        v, q = S.mesh(VOXEL * vs)
        ob = sdf.to_object(f"{name}_high", v, q, ctx.col)
        ob.data.materials.append(ctx.mats[role])
        P.append(fighter.Part(name, high=ob, tris=tris, bind=bind, uv_weight=uvw))
    return P


def string_mesh(col, sides=5, rings=26, r=0.0046):
    """the bow string as a thin tube built ring by ring (tip -> nock -> tip): a decimated capsule collapses into long
    triangles that span the nock and open into a sheet when the string is drawn"""
    import bmesh
    from common import mesh as _mesh
    bm = bmesh.new()
    pts = [STRING_A + (S0 - STRING_A) * (i / rings) for i in range(rings)] + \
          [S0 + (STRING_B - S0) * (i / rings) for i in range(rings + 1)]
    ax = _n(STRING_B - STRING_A)
    e1 = _n(np.cross(ax, D_REST))
    e2 = np.cross(ax, e1)
    ringv = []
    for c in pts:
        ringv.append([bm.verts.new(tuple(c + r * (math.cos(2 * math.pi * k / sides) * e1 + math.sin(2 * math.pi * k / sides) * e2)))
                      for k in range(sides)])
    for i in range(len(ringv) - 1):
        a, b = ringv[i], ringv[i + 1]
        for k in range(sides):
            bm.faces.new((a[k], a[(k + 1) % sides], b[(k + 1) % sides], b[k]))
    bm.faces.new(list(reversed(ringv[0])))
    bm.faces.new(ringv[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _mesh.bm_to_obj(bm, "string_low", col)


def page_fletching(name: str) -> Sculpt:
    """Almanac: rigid page-cut plates (flat 3 x 8 cm, 3 mm) in place of the gull-feather vanes"""
    S = Sculpt(name)
    if name == "fletching":
        for w, n, rise, lean, vt in ARROWS:
            d = _n(Q_U + Q_W * math.tan(math.radians(lean)))
            tip = Q_TOP + Q_W * w + Q_N * n + d * rise
            e1 = _n(np.cross(d, Q_N))
            for j in range(2):
                a = math.radians(vt + j * 90.0)
                vd = e1 * math.cos(a) + np.cross(d, e1) * math.sin(a)
                c = tip - d * 0.050
                S.add(RoundBox(c, (0.0015, 0.040, 0.015), 0.001, axes=np.stack([np.cross(d, vd), d, vd])), k=0.0)
    else:
        for ang in (-16.0, 0.0, 16.0):
            d = fan_dir(ang)
            base = PINCH_R - d * 0.03
            e1 = _n(np.cross(d, [0.0, 0.0, 1.0]))
            for j in range(2):
                a = math.radians(30.0 + j * 90.0)
                vd = e1 * math.cos(a) + np.cross(d, e1) * math.sin(a)
                S.add(RoundBox(base + d * 0.035, (0.0015, 0.040, 0.015), 0.001, axes=np.stack([np.cross(d, vd), d, vd])), k=0.0)
    return S


if __name__ == "__main__":
    fighter.main(sys.modules[__name__])
