"""dunsom: Dusk herder (Caster, Serenade). ART 2.0: sculpted volumes painted by concept projection.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/dunsom_plates.py      # plates (backdrop gap fix)
    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/dunsom_relief.py      # the painted mask's cracks
    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/dunsom_fit.py [--table] [--accent]   # fit check
    python3 art/build.py fighter dunsom --no-skins --clip-sheet

Brief: _design/fighters/dunsom.md. Concept: _design/concept/dunsom.webp (front + back, hand-painted). The forms are
numpy SDF volumes (common/hifi/sdf.py) fitted to the concept on a 10 cm grid (the plates' scale is the hat's crown,
2.05 m); the base colour is the concept painting projected occlusion-aware onto the game mesh (common/hifi/project.py,
wrapped below); normals and AO bake from the sculpt.

Where the concept and the brief disagree:
  * the concept's look wins (the approved look): a broad shallow felt cone-hat (0.71 m across, the brief's 0.62 is
    the painting's 0.72 read short), a lavender hood framing a golden-ochre carved mask of irregular tiles (the
    painted cracks are carved: proto/dunsom_relief.py), a khaki scarf over the chin, a long lavender felt coat open
    below the belt, ochre gloves, the crook in the right fist at chest height, its hook curling OUT with the lantern
    hanging beside the hood. The crook top stands at ~2.2 m (the painting's 2.17: under the HP bar from either facing).
  * the brief wins on the facing cue: the crook leans a little forward (the fist 0.22 m in front of the shoulder) and
    the hook's plane turns 35 degrees toward the front, so the lantern hangs in front of the hat's disc from above and
    the mask's beak keel (3.5 cm) marks the front; the lantern is octagonal (0.15 m across, 0.35 m with its roof and
    base) with its four cardinal panes glowing azure (the `accent`, the painted blue centre pane seen from every
    side) between amber lampresin panes; it hangs on one pendulum bone x_lantern (amplitude <= 6 degrees).

Not in the shared pipeline, implemented here (module-level wrappers; common/ untouched):
  * rig_extras: the right arm re-seated on the concept carry, prop.R up the crook, prop.L in the left hand's curl (the
    two-handed grips land exactly), x_lantern (the lantern's pendulum), sockets x_crook_hook / x_crook_foot.
  * prop.R location tracks (the crook slides through the fist for the two-handed carry and the sweep).
  * the lantern pendulum (anim.sample_clip wrapper): a spring-led hang, clamped to 6 degrees off plumb.
  * skin weights for the coat, hood, scarf, sleeves, trousers and boots; the corrected foot roll (Vashil's).
  * the paint (project.paint wrapper): projected cloth / mask with side fill and back match; the hat (felt), the
    crook, the lantern and the gloves paint procedurally; light-head / dark-feet ramp and the L* 86 cap.
  * skins (project.recolour wrapper): per-part targets; Highrim's wind grain, Almanac's printed tables and pages.
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
from common import render as _render  # noqa: E402
from common import mesh as _mesh, pipeline as _pipeline  # noqa: E402
from common.anim import Aim, FootTarget, HandTarget  # noqa: E402
from common.hifi import project as _project, sdf  # noqa: E402
from common.hifi.sdf import (Capsule, Ellipsoid, FlatCapsule, HalfSpace, Lathe, Prim, RoundBox,  # noqa: E402
                             RoundCone, Sculpt, Sphere, Torus, Tube)

V = Vector
ID = "dunsom"
TITLE = "Dusk herder"
ROLE_MASS = "caster"
ORIGIN = "serenade"
CARD = {"primary": "#4E4A5C", "secondary": "#A48F6E"}


def unit(v):
    v = np.asarray(v, dtype=np.float64)
    return v / np.linalg.norm(v)


def _rot(axis, deg):
    a = unit(axis)
    t = math.radians(deg)
    K = np.array([[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]])
    return np.eye(3) + math.sin(t) * K + (1 - math.cos(t)) * (K @ K)


def ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def smax(a, b, k):
    h = np.clip(0.5 - 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1 - h) + a * h + k * h * (1 - h)


# ── rig fitted to the concept (plates: 608 px/m, the hat's crown 2.05) ─────────────────────────────────
# skull crown under the hat 1.95, skull base 1.683, neck base 1.608, shoulders x 0.21 at 1.458, hips x 0.10 at 1.02,
# ankles x 0.13 at 0.095; the left arm hangs (wrist ~0.97), the right is re-seated on the crook (rig_extras)
PROPORTIONS = rig.proportions(height=1.95, head=0.31, neck=0.075, shoulder_width=0.42, hip_width=0.20, leg=0.93,
                              thigh_frac=0.50, arm=0.50, upper_arm_frac=0.52, hand=0.18, foot=0.30,
                              ankle_height=0.095, spine_curve=0.0, stance=0.03, toe_out_deg=8.0, knee_bend=0.012,
                              a_pose_deg=82.0, arm_forward_deg=4.0, elbow_bend_deg=12.0, shoulder_drop=0.15)
ARM = PROPORTIONS["arm"]
UPPER = ARM * PROPORTIONS["upper_arm_frac"]
FOREARM = ARM - UPPER
SH_L = np.array([0.21, 0.030, 1.458])
SH_R = SH_L * np.array([-1.0, 1.0, 1.0])
HS = 1.35                                          # glove scale (brief: hands x1.45; the concept's 12 cm fist)


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
# the right fist round the crook at chest height (the painting: x -0.465, z 1.33), 22 cm in front of the shoulder
GRIP = np.array([-0.465, -0.22, 1.33])
FIST_REACH = 0.07                                  # wrist -> the grip channel along the hand


def _right_arm():
    L1, L2 = UPPER, FOREARM + FIST_REACH
    d = GRIP - SH_R
    dist = float(np.linalg.norm(d))
    a = d / dist
    pole = unit((-0.55, 0.35, -0.76))
    pp = unit(pole - a * pole.dot(a))
    u = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist)
    v = math.sqrt(max(0.0, L1 * L1 - u * u))
    el = SH_R + a * u + pp * v
    fo = unit(GRIP - el)
    return el, el + fo * FOREARM, fo


E_R, W_R, FO_R = _right_arm()

# THE CROOK (prop.R): the butt beside the right boot, the shaft through the fist, the hook curling out-forward
BUTT = np.array([-0.375, -0.085, 0.0])
CROOK_U = unit(GRIP - BUTT)
S_BUTT = -float(np.linalg.norm(GRIP - BUTT))       # the butt's place along the shaft (m from the grip)
S_TOP = 0.70                                       # where the shaft turns into the hook (z ~2.02)
SHAFT_R = 0.027                                    # 5.4 cm (brief: 6 cm, 5 px at 1080p)
HOOK_R = 0.030
HOOK_YAW = 35.0                                    # the hook's plane: out (his right) turned 35 degrees to the front
GRIPS = ((-0.09, 0.12), (-0.46, -0.27))            # the leather wraps: the rest grip, the low grip (two-handed holds)
SLIDE2 = 0.365                                     # slide that puts the right fist on the low wrap


def crook_at(s):
    return GRIP + CROOK_U * s


def _hook_frame():
    h = np.array([-math.cos(math.radians(HOOK_YAW)), -math.sin(math.radians(HOOK_YAW)), 0.0])
    h = unit(h - CROOK_U * h.dot(CROOK_U))
    return h, CROOK_U


HOOK_PTS = [(0.0, -0.06), (0.0, 0.0), (0.004, 0.040), (0.022, 0.085), (0.058, 0.122), (0.105, 0.136), (0.150, 0.118),
            (0.184, 0.072), (0.199, 0.016), (0.197, -0.040), (0.184, -0.086), (0.164, -0.118), (0.146, -0.134)]
HOOK_K = 1.08                                      # the hook a little wider than painted (its plane turns 35 deg)


def hook_pts():
    h, u = _hook_frame()
    top = crook_at(S_TOP)
    return [top + h * a * HOOK_K + u * b for a, b in HOOK_PTS]


HOOK_TIP = hook_pts()[-1]
HANG = HOOK_TIP - np.array([0.0, 0.0, 0.052])      # the lantern's pivot: the bottom of the ring through the tip
HOOK_TOP = hook_pts()[5]

# THE LANTERN (on x_lantern, hanging straight down from HANG at rest): octagonal, 0.19 m across the flats, 0.41 m
# tall with its cupola and base. The azure core shows through the middle of every pane (amber lampresin at the pane
# edges, as painted: a blue centre between amber) and through a glass cupola on top, so the accent reads from the
# 52 degree game camera at every facing (the gate: 1.5-6 % of the silhouette; the painted 0.16 m lantern with one
# blue pane per side measured 0.3 %)
LAN_A = 0.095                                      # body apothem (the posts' faces)
LAN_GLASS = 0.088
LAN_CUP = (0.094, 0.080)                           # the cupola: centre below HANG, radius
LAN_EAVE = (0.080, 0.106, 0.106)                   # the eave ring: top / bottom below HANG, bottom apothem
LAN_BODY = (0.115, 0.330)                          # the panes: from / to below HANG
LAN_BASE = (0.342, 0.392)
PANE_W, PANE_H = 0.0300, 0.096                     # the core's half width / half height in each pane


def lan_z(dz):
    return HANG[2] - dz


# ── the hat, the head (painted placement: the mask's centre is 1.7 cm right of the axis) ──────────────────
MX = -0.017                                        # the mask's centre line (as painted)
KX = -0.006                                        # the beak keel's centre line (as painted)
HAT_C = np.array([-0.006, 0.012])
HAT_R, HAT_EDGE, HAT_RISE, HAT_T = 0.355, 1.946, 0.095, 0.026


def hat_top(r):
    u = np.clip(r / HAT_R, 0.0, 1.0)
    return HAT_EDGE + HAT_T * 0.5 + HAT_RISE * (1.0 - u ** 1.3)


MATERIAL_SET = "bible"
PALETTE = materials.bible_palette(cloth2="#CAC5D4", sandstone="#C28C44", wood="#ADA090", wood_dark="#5A3E31",
                                  cloth="#7D7185", lampresin="#C9954E", leather="#42322E", under="#2B2328",
                                  ironstone="#444048", ink="#17181B", accent="#3F9CFF")
VALUE_GRADIENT_STOPS = materials.BIBLE_GRADIENT_STOPS
SOCKETS = {"weapon": "prop.R", "weapon_tip": "x_crook_hook", "lantern": "x_lantern", "ferrule": "x_crook_foot"}
SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92, "fill": 0.84, "yaw": 24.0, "portrait_yaw": 24.0,
          "icon_yaw": 14.0}
TEXTURE_SIZE = 2048
TEXTURE_SIZES = {"normal": 512, "orm": 256}
GLB_COMPRESS = True
ARMOUR_CONFORM = False
AO_INTO_BASE = 0.25
ATLAS_SOFTEN = 0.45

# ART 2.0 skins (brief §9): each part moves onto the skin's colours (_recolour below, the painting's values kept);
# Highrim adds a wind grain on the hat, Almanac printed tables on the hat and three folded pages on the crook
SKINS: list = [
    {"id": "dunsom_highrim", "extra": {}, "card": {"primary": "#6E5F4E", "secondary": "#CDBB9C"},
     "palette": {"cloth2": "#CDBB9C", "wood": "#BFAE95"}},
    {"id": "dunsom_almanac", "extra": {"almanac_pages": True}, "card": {"primary": "#4A453E", "secondary": "#D8CDB4"},
     "palette": {"cloth2": "#D8CDB4", "wood": "#2E2A26", "wood_dark": "#2E2A26", "cloth": "#85818F"}},
]
SKIN_FLAT = {"almanac_pages": "cloth2", "almanac_cords": "leather"}

HEIGHT = 2.05             # the plates' scale: the hat's crown
PROJECTION = {"concept": "dunsom", "height": HEIGHT}
NOISE = sdf.Noise(23)
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


def folds_ang(amp, n, c=(0.0, 0.03), zfade=None, phase=0.0):
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


def felt(amp=0.0018, freq=30.0):
    def fn(P):
        return amp * NOISE.fbm(P, freq, 2)
    return fn


def chips(amp, freq):
    def fn(P):
        return amp * np.clip(NOISE.ridged(P, freq, 3), 0, 1) - amp * 0.3
    return fn


def wraps(amp, pitch, a, b):
    """A strip wound round the a->b axis: a ridge every `pitch` m, slanted."""
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


# the painted mask (proto/dunsom_relief.py): outline distance, cracks, eye recesses, sampled in world x, z
_FACE: dict = {}


def _face():
    if not _FACE:
        p = os.path.join(scene.CACHE_DIR, "concept", "dunsom_face.npz")
        if not os.path.isfile(p):
            raise SystemExit("dunsom: run art/blender/proto/dunsom_relief.py first (art/.cache/concept/dunsom_face.npz)")
        d = np.load(p)
        _FACE.update({k: np.asarray(d[k]) for k in d.files})
    return _FACE


def face_map(name, x, z):
    F = _face()
    A = F[name]
    m = float(F["m"])
    u = (np.asarray(x, float) - float(F["x0"])) / m
    v = (float(F["z0"]) - np.asarray(z, float)) / m
    h, w = A.shape
    u = np.clip(u, 0, w - 1.001)
    v = np.clip(v, 0, h - 1.001)
    i0, j0 = u.astype(np.int64), v.astype(np.int64)
    fu, fv = u - i0, v - j0
    a = A[j0, i0] * (1 - fu) + A[j0, i0 + 1] * fu
    b = A[j0 + 1, i0] * (1 - fu) + A[j0 + 1, i0 + 1] * fu
    return a * (1 - fv) + b * fv


def face_sd(x, z):
    """the painted mask outline (m, < 0 inside); below the scarf's top the outline continues straight down"""
    return face_map("sd", x, np.maximum(z, 1.745))


def mask_front(x, z):
    """the mask's front surface (y) before relief: a shield curved back to the sides and top"""
    return -0.128 + 2.4 * (x - MX) ** 2 + 0.9 * (z - 1.83) ** 2


def mask_relief(P):
    """forward relief (m) on the mask: tiles pillowed between the painted cracks, the cracks cut in, the almond eye
    recesses, a brow shelf over the eyes and the beak keel down the centre (the facing cue)"""
    x, z = P[:, 0], P[:, 2]
    tile = face_map("tile", x, z)
    crack = face_map("crack", x, z)
    eye = face_map("eye", x, z)
    r = 0.0026 * ss(0.0, 1.0, tile) - 0.0042 * crack
    r = r - 0.020 * eye
    brow = ss(1.852, 1.866, z) * ss(1.912, 1.890, z) * (1 - ss(0.095, 0.118, np.abs(x - MX)))
    r = r + 0.006 * brow
    hw = 0.012 + 0.012 * ss(1.85, 1.74, z)
    keel = ss(1.865, 1.770, z) * (1 - ss(hw, hw + 0.014, np.abs(x - KX)))
    r = r + 0.034 * keel * (1 - eye)
    return r + 0.0012 * NOISE(P, 40.0)


def finger_pts(C, a, f, out, i, s=HS, curl=1.0):
    """finger i (0 pinky .. 3 index) of a curled hand: knuckle K, middle joint M, tip T, radius. curl 1 = a fist
    round a shaft at C (Vashil's), 0.55 = a relaxed hand (an open C)"""
    o = 1.0 - curl
    sp = (i - 1.5) * 0.0245 * s
    rr = (0.0128 if i else 0.0115) * s ** 0.85
    K = C + f * 0.006 * s + out * 0.026 * s + a * sp
    M = C + f * (0.040 + 0.016 * o) * s + out * (0.004 + 0.020 * o) * s + a * sp
    T = C + f * (0.026 + 0.050 * o) * s - out * (0.026 - 0.040 * o) * s + a * sp
    return K, M, T, rr


def fist_frame(C, a, f, out):
    C, a, f, out = (np.asarray(v, float) for v in (C, a, f, out))
    a = unit(a)
    f = unit(f - a * f.dot(a))
    out = unit(out - a * out.dot(a) - f * out.dot(f))
    return C, a, f, out


def glove(name, C, a, f, out, bind, tris, curl=1.0, grip=True, s=HS):
    """A gloved hand with sculpted fingers (no mitten block): C the centre of the fingers' curl (the shaft's axis for
    a grip), a the knuckle line (pinky -> index), f the forearm direction, out the back of the hand"""
    C, a, f, out = fist_frame(C, a, f, out)
    S = Sculpt(name)
    ax = np.stack([a, f, out])
    S.add(RoundBox(C - f * 0.030 * s + out * 0.012 * s, (0.046 * s, 0.042 * s, 0.024 * s), 0.016 * s, axes=ax), k=0.0)
    for i in range(4):
        K, M, T, rr = finger_pts(C, a, f, out, i, s, curl)
        S.add(Sphere(K + out * 0.004 * s, rr + 0.003), k=0.006)
        S.add(Tube([K, M, T], [rr + 0.002, rr + 0.001, rr * 0.92], k=0.006), k=0.006)
    o = 1.0 - curl
    tb = C - f * 0.030 * s - out * 0.022 * s + a * 0.050 * s
    tm = C + f * 0.004 * s - out * (0.032 - 0.004 * o) * s + a * (0.050 + 0.006 * o) * s
    tt = C + f * (0.026 + 0.018 * o) * s - out * (0.020 - 0.006 * o) * s + a * (0.028 + 0.012 * o) * s
    S.add(Tube([tb, tm, tt], [0.017 * s, 0.0145 * s, 0.0125 * s], k=0.006), k=0.010)
    # the glove's flared gauntlet cuff over the wrist
    S.add(RoundCone(C - f * 0.105 * s, C - f * 0.050 * s, 0.040 * s, 0.034 * s), k=0.012)
    if grip:
        S.sub(Capsule(C - a * 0.15, C + a * 0.15, SHAFT_R + 0.002), k=0.003)
    S.ops = [(op, prim.displaced(felt(0.0009, 60.0), 0.0009) if op == "add" else prim, k, tg) for op, prim, k, tg in S.ops]
    return (name, S, 0.5, "sandstone", bind, tris, 2.0)


HAND_R_FRAME = fist_frame(GRIP, CROOK_U, FO_R, np.cross(FO_R, CROOK_U))
C_L = W_L + FO_L * 0.072 * HS / 1.35 + np.array([0.0, -0.004, 0.0])
HAND_L_FRAME = fist_frame(C_L, (0.0, -1.0, 0.0), FO_L, (1.0, 0.0, 0.0))
LEFT_CURL = 0.62


def octa(P, c, apo, zlo, zhi):
    """an upright octagonal prism (faces toward +-X, +-Y and the diagonals)"""
    q = P - c
    r = np.max(np.stack([q[:, 0], -q[:, 0], q[:, 1], -q[:, 1],
                         (q[:, 0] + q[:, 1]) * 0.7071, (q[:, 0] - q[:, 1]) * 0.7071,
                         (-q[:, 0] + q[:, 1]) * 0.7071, (-q[:, 0] - q[:, 1]) * 0.7071], 1), 1)
    return np.maximum(r - apo, np.maximum(zlo - P[:, 2], P[:, 2] - zhi))


def octa_r(q):
    return np.max(np.stack([q[:, 0], -q[:, 0], q[:, 1], -q[:, 1],
                            (q[:, 0] + q[:, 1]) * 0.7071, (q[:, 0] - q[:, 1]) * 0.7071,
                            (-q[:, 0] + q[:, 1]) * 0.7071, (-q[:, 0] - q[:, 1]) * 0.7071], 1), 1)


# ── the sculpt ──────────────────────────────────────────────────────────────────────────────────────
def sculpts() -> list:
    """(name, Sculpt, voxel scale, material role, bind, tris, uv weight) in build order."""
    out = []

    def part(name, S, role, bind, tris, vs=1.0, uvw=1.0):
        out.append((name, S, vs, role, bind, tris, uvw))

    # HAT: the broad shallow felt cone (0.71 m across, 2.6 cm felt, edge 1.946, crown 2.05), a stitched band 3 cm in
    # from the edge, a small rounded crown; solid under the crown where it sits on the hood (no gap under the brim)
    def hat_prof(r, z):
        zt = hat_top(r)
        zm = zt - HAT_T * 0.5
        shell = np.abs(z - zm) - HAT_T * 0.5
        d = smax(shell, r - HAT_R, 0.011)
        crown = np.maximum(np.maximum(r - 0.168, 1.958 - z), z - zt)
        d = np.minimum(d, crown)
        band = 0.0022 * np.exp(-((r - 0.322) / 0.0055) ** 2) * (z > zm)
        return (d - band) * 0.93
    hat = Sculpt("hat")
    hat.add(Lathe((HAT_C[0], HAT_C[1], 0.0), hat_prof, HAT_R + 0.01, 1.90, 2.08).displaced(felt(0.0007, 18.0), 0.0007), k=0.0)
    hat.add(Sphere((HAT_C[0], HAT_C[1], 2.032), 0.026), k=0.03)
    part("hat", hat, "cloth2", "bone:x_hat", 2300, 0.6, uvw=1.5)

    # HOOD: a lavender column from under the hat to the scarf, framing the mask (the painted outline cut out in
    # front, a rolled edge round it); rigid on the head above the chin, blending to the neck and chest below
    hood = Sculpt("hood")
    hood.add(FlatCapsule((MX, 0.025, 1.585), (MX, 0.018, 1.935), 0.178, 0.172, 0.150, 0.158, side=(1, 0, 0))
             .displaced(cloth_noise(0.003, 8.0), 0.003), k=0.0)
    hood.add(Ellipsoid((MX, 0.018, 1.935), (0.150, 0.158, 0.060)), k=0.02)
    hood.inter(HalfSpace((0, 0, 1.972), (0, 0, 1), 1.0), k=0.0)
    for sx in (-1, 1):                                                    # soft folds falling down the back
        hood.add(Tube([(MX + sx * 0.07, 0.16, 1.90), (MX + sx * 0.085, 0.175, 1.74), (MX + sx * 0.09, 0.18, 1.62)],
                      [0.010, 0.014, 0.012], k=0.01), k=0.03)

    def opening(P):
        return np.maximum(face_sd(P[:, 0], P[:, 2]) - 0.006, P[:, 1] + 0.030)
    hood.sub(Fn(opening, (MX - 0.16, -0.30, 1.62), (MX + 0.16, -0.02, 1.98)), k=0.010)

    def rim(P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        d2 = face_sd(x, z) - 0.020
        yf = mask_front(x, z) + 0.004
        return np.maximum(np.hypot(d2, (y - yf) * 1.3) - 0.017, 1.70 - z)
    hood.add(Fn(rim, (MX - 0.20, -0.22, 1.66), (MX + 0.20, 0.02, 1.98)), k=0.012)
    part("hood", hood, "cloth", ("weights", "hood"), 1500, uvw=1.4)

    # MASK: the carved ochre face, its outline, tiles, cracks and eyes read from the painting
    def mask_d(P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        sd2 = face_sd(x, z) + 0.002
        yf = mask_front(x, z) - mask_relief(P)
        d = smax(sd2, (yf - y) * 0.9, 0.006)
        return np.maximum(np.maximum(d, y - 0.03), 1.665 - z)
    mask = Sculpt("mask")
    mask.add(Fn(mask_d, (MX - 0.15, -0.20, 1.66), (MX + 0.15, 0.04, 1.97)), k=0.0)
    part("mask", mask, "sandstone", "bone:head", 1900, 0.42, uvw=3.0)

    # SCARF: a thick khaki wrap: a roll over the chin, a second round the neck, a loose drape over the chest
    scarf = Sculpt("scarf")
    tilt = sdf.rot_x(-9.0)
    scarf.add(Torus((MX, -0.004, 1.688), 0.118, 0.046, axes=tilt, rz=0.040), k=0.0)
    scarf.add(Torus((MX, 0.012, 1.628), 0.150, 0.056, axes=sdf.rot_x(-5.0), rz=0.048), k=0.025)
    scarf.add(Ellipsoid((MX, 0.025, 1.64), (0.16, 0.15, 0.09)), k=0.03)
    scarf.add(Ellipsoid((0.0, 0.035, 1.560), (0.255, 0.170, 0.052)), k=0.04)
    scarf.add(FlatCapsule((MX + 0.01, -0.150, 1.615), (0.012, -0.170, 1.490), 0.150, 0.040, 0.128, 0.030, side=(1, 0, 0)), k=0.035)
    for sx in (-1, 1):
        scarf.add(Tube([(MX + sx * 0.15, -0.09, 1.64), (sx * 0.10, -0.165, 1.56), (sx * 0.03, -0.185, 1.50)],
                       [0.024, 0.022, 0.016], k=0.01), k=0.02)
    scarf.add(Tube([(0.06, 0.15, 1.62), (0.10, 0.20, 1.55), (0.11, 0.21, 1.47)], [0.03, 0.03, 0.022], k=0.01), k=0.03)
    scarf.ops = [(op, prim.displaced(cloth_noise(0.004, 9.0), 0.004) if op == "add" else prim, k, tg)
                 for op, prim, k, tg in scarf.ops]
    part("scarf", scarf, "cloth2", ("weights", "scarf"), 1700, uvw=1.3)

    # COAT: the chest and shoulders (lapels in a V under the scarf), the belt, the skirt to the shins (open in front
    # over the dark under-robe, 4 deep folds), the sleeves with turned cuffs
    top = Sculpt("coat_top")
    top.add(FlatCapsule((0.0, 0.025, 1.22), (0.0, 0.030, 1.43), 0.180, 0.128, 0.205, 0.132, side=(1, 0, 0)), k=0.0)
    for sx in (-1, 1):
        top.add(Sphere((sx * 0.205, 0.030, 1.445), 0.082), k=0.06)
    top.add(Ellipsoid((0.0, -0.02, 1.36), (0.185, 0.12, 0.11)), k=0.05)
    for sx in (-1, 1):
        top.add(Tube([(sx * 0.10, -0.140, 1.47), (sx * 0.045, -0.152, 1.36), (sx * 0.012, -0.155, 1.27)],
                     [0.011, 0.011, 0.010], k=0.01), k=0.012)
    top.ops = [(op, prim.displaced(folds_ang(0.005, 9, zfade=(1.42, 1.25), phase=0.4), 0.005) if op == "add" and i == 0
                else prim, k, tg) for i, (op, prim, k, tg) in enumerate(top.ops)]
    part("coat_top", top, "cloth", ("weights", "torso"), 1300)

    belt = Sculpt("belt")
    belt.add(Torus((0.0, 0.025, 1.250), 0.184, 0.020, axes=np.diag([1.0, 0.140 / 0.184, 1.0]), rz=0.027)
             .displaced(chips(0.0015, 30.0), 0.0015), k=0.0)
    part("belt", belt, "leather", ("weights", "belt"), 450, 0.6)
    buckle = Sculpt("buckle")
    buckle.add(RoundBox((-0.004, -0.128, 1.250), (0.034, 0.010, 0.030), 0.007), k=0.0)
    buckle.sub(RoundBox((-0.004, -0.140, 1.250), (0.020, 0.010, 0.017), 0.004), k=0.003)
    buckle.add(Capsule((-0.004, -0.138, 1.236), (-0.004, -0.138, 1.264), 0.0045), k=0.002)
    part("buckle", buckle, "wood_dark", ("weights", "belt"), 160, 0.4)

    skirt = Sculpt("skirt")
    f1 = FlatCapsule((0.0, 0.025, 1.235), (0.0, 0.030, 0.80), 0.182, 0.135, 0.228, 0.165, side=(1, 0, 0))
    f2 = FlatCapsule((0.0, 0.030, 0.82), (0.0, 0.040, 0.30), 0.228, 0.165, 0.285, 0.205, side=(1, 0, 0))
    fold = folds_ang(0.010, 9, zfade=(1.15, 0.70))
    deep = folds_ang(0.018, 4, zfade=(1.10, 0.55), phase=0.6)
    skirt.add(f1.displaced(lambda P: fold(P) + deep(P), 0.028), k=0.0)
    skirt.add(f2.displaced(lambda P: fold(P) + deep(P), 0.028), k=0.10)
    skirt.inter(HalfSpace((0, 0, 0.300), (0, 0, -1), 2.0), k=0.006)
    skirt.inter(HalfSpace((0, 0, 1.24), (0, 0, 1), 2.0), k=0.006)

    def slot(P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        hw = 0.010 + 0.048 * ss(1.20, 0.30, z)
        return np.maximum(np.maximum(np.abs(x + 0.020) - hw, -(y + 0.055)), z - 1.205)
    skirt.sub(Fn(slot, (-0.12, -0.40, 0.2), (0.08, 0.0, 1.22)), k=0.008)
    skirt.add(Fn(lambda P: np.hypot(np.hypot(P[:, 0] / 0.287, (P[:, 1] - 0.040) / 0.207) * 0.25 - 0.25, P[:, 2] - 0.312) - 0.009,
                 (-0.32, -0.20, 0.28), (0.32, 0.27, 0.34)), k=0.006)
    skirt.sub(Fn(slot, (-0.12, -0.40, 0.2), (0.08, 0.0, 1.22)), k=0.006)
    part("skirt", skirt, "cloth", ("weights", "skirt"), 2300)

    under = Sculpt("under_robe")
    under.add(FlatCapsule((0.0, 0.030, 1.22), (0.0, 0.040, 0.36), 0.160, 0.112, 0.215, 0.150, side=(1, 0, 0)), k=0.0)
    under.inter(HalfSpace((0, 0, 0.33), (0, 0, -1), 2.0), k=0.004)
    part("under_robe", under, "under", ("weights", "skirt"), 500)

    legs = Sculpt("trousers")
    for sx in (-1, 1):
        legs.add(FlatCapsule((sx * 0.125, 0.025, 0.46), (sx * 0.130, 0.020, 0.15), 0.060, 0.062, 0.054, 0.056, side=(1, 0, 0))
                 .displaced(cloth_noise(0.002, 10.0), 0.002), k=0.0)
    part("trousers", legs, "under", ("weights", "trousers"), 320, 0.8)

    for s, sh, el, wr, fo in (("L", SH_L, E_L, W_L, FO_L), ("R", SH_R, E_R, W_R, FO_R)):
        sx = 1.0 if s == "L" else -1.0
        sl = Sculpt(f"sleeve_{s}")
        top_ = sh + np.array([sx * 0.004, 0.0, 0.004])
        sl.add(FlatCapsule(top_, el, 0.072, 0.070, 0.061, 0.060, side=(0, 1, 0)), k=0.0)
        sl.add(FlatCapsule(el, wr - fo * 0.075, 0.061, 0.060, 0.057, 0.056, side=(0, 1, 0)), k=0.03)
        sl.add(RoundCone(wr - fo * 0.095, wr - fo * 0.008, 0.062, 0.069), k=0.012)          # the turned cuff
        sl.add(Torus(wr - fo * 0.090, 0.062, 0.006, axes=sdf.frame(fo)), k=0.006)
        sl.sub(Capsule(wr - fo * 0.03, wr + fo * 0.05, 0.050), k=0.010)
        sl.ops = [(op, prim.displaced(cloth_noise(0.003, 9.0), 0.003) if op == "add" else prim, k, tg)
                  for op, prim, k, tg in sl.ops]
        part(f"sleeve_{s}", sl, "cloth", ("weights", "sleeves"), 900 if s == "R" else 800)

    # HANDS: ochre gloves, the right closed round the crook (thumb up), the left a relaxed curl hanging at the hip
    out.append(glove("hand_R", *HAND_R_FRAME, "bone:hand.R", 950, curl=1.0, grip=True))
    out.append(glove("hand_L", *HAND_L_FRAME, "bone:hand.L", 900, curl=LEFT_CURL, grip=False))

    # BOOTS: plain dark leather, a little wide (x1.2), ironstone toe caps
    boots, caps = Sculpt("boots"), Sculpt("toecaps")
    for sx in (-1, 1):
        to = math.radians(8.0) * sx
        fwd = np.array([math.sin(to), -math.cos(to), 0.0])
        a0 = np.array([sx * 0.13, 0.02, 0.0])
        R = sdf.rot_z(-math.degrees(to))
        boots.add(RoundBox(a0 + fwd * 0.055 + np.array([0, 0, 0.046]), (0.060, 0.150, 0.046), 0.032, axes=R), k=0.0)
        boots.add(RoundCone(a0 + fwd * 0.15 + np.array([0, 0, 0.040]), a0 + fwd * 0.185 + np.array([0, 0, 0.034]), 0.050, 0.040), k=0.03)
        boots.add(FlatCapsule(a0 + np.array([0, 0, 0.06]), a0 + np.array([0, 0.0, 0.235]), 0.064, 0.068, 0.066, 0.068, side=(1, 0, 0)), k=0.035)
        boots.add(Torus(a0 + np.array([0, 0.0, 0.228]), 0.066, 0.010), k=0.008)
        boots.add(RoundBox(a0 - fwd * 0.07 + np.array([0, 0, 0.018]), (0.050, 0.030, 0.018), 0.008, axes=R), k=0.008)
        caps.add(Ellipsoid(a0 + fwd * 0.175 + np.array([0, 0, 0.040]), (0.060, 0.058, 0.044), axes=R), k=0.0)
        caps.inter(HalfSpace(a0 + fwd * 0.135, -fwd, 1.0), k=0.01)
    boots.inter(HalfSpace((0, 0, 0.0), (0, 0, -1), 2.0), k=0.0)
    caps.inter(HalfSpace((0, 0, 0.006), (0, 0, -1), 2.0), k=0.0)
    part("boots", boots, "leather", ("weights", "boots"), 950)
    part("toecaps", caps, "ironstone", ("weights", "boots"), 220, 0.6)

    out.extend(crook_parts())
    out.extend(lantern_parts())
    return out


def crook_parts() -> list:
    """the crook on prop.R: the gnarled pale shaft (straight and even under the two wraps), the hook, the carved
    ironstone ferrule, the leather wraps"""
    out = []

    def free(s):
        f = 1.0
        for a_, b_ in GRIPS:
            f = min(f, 1.0 - float(ss(a_ - 0.10, a_ - 0.03, s)) * (1.0 - float(ss(b_ + 0.03, b_ + 0.10, s))))
        return f
    h, u = _hook_frame()
    side = unit(np.cross(u, h))
    pts, rads = [], []
    for s in np.linspace(S_BUTT + 0.012, S_TOP - 0.07, 34):
        p = crook_at(s)
        z = p[2]
        wob = 0.007 * (h * math.sin(s * 6.3 + 0.4) + side * math.cos(s * 4.7 + 1.1)) * float(ss(-1.25, -1.05, s))
        if s > 0.25:                                                     # the painted kinks under the hook
            wob = wob + 0.012 * h * math.sin((s - 0.25) * 9.0)
        fz = free(s)
        pts.append(p + wob * fz)
        rads.append(SHAFT_R * (1.0 + 0.10 * math.sin(s * 9.0 + 1.0) * fz) * (0.95 if z < 0.1 else 1.0))
    hp = hook_pts()
    for i, p in enumerate(hp[1:]):
        t = i / (len(hp) - 2)
        pts.append(p)
        rads.append(SHAFT_R + (HOOK_R - SHAFT_R) * min(1.0, t * 2.5) + 0.004 * math.sin(t * 7.0))
    shaft = Sculpt("crook_shaft")
    shaft.add(Tube(pts, rads, k=0.012).displaced(lambda P: 0.0020 * NOISE(P * np.array([1.0, 1.0, 0.18]), 36.0), 0.0020), k=0.0)
    shaft.add(Sphere(HOOK_TIP + u * -0.004, HOOK_R + 0.006), k=0.012)          # the carved knob at the hook's tip
    out.append(("crook_shaft", shaft, 0.5, "wood", "bone:prop.R", 1050, 1.1))
    grip = Sculpt("crook_grip")
    for a_, b_ in GRIPS:
        g0, g1 = crook_at(a_), crook_at(b_)
        grip.add(Capsule(g0, g1, SHAFT_R + 0.0060).displaced(wraps(0.0020, 0.017, g0, g1), 0.0020), k=0.0)
        for e in (g0 + u * 0.006, g1 - u * 0.006):
            grip.add(Torus(e, SHAFT_R + 0.0060, 0.0042, axes=sdf.frame(u)), k=0.002)
    out.append(("crook_grip", grip, 0.5, "leather", "bone:prop.R", 360, 0.8))
    fer = Sculpt("crook_ferrule")
    b0 = crook_at(S_BUTT)
    fer.add(RoundCone(b0 + u * 0.008, b0 + u * 0.075, 0.029, SHAFT_R + 0.004).displaced(chips(0.002, 20.0), 0.002), k=0.0)
    fer.add(Torus(b0 + u * 0.074, SHAFT_R + 0.004, 0.0045, axes=sdf.frame(u)), k=0.003)
    fer.inter(HalfSpace((0, 0, 0.0), (0, 0, -1), 1.0), k=0.0)
    out.append(("crook_ferrule", fer, 0.45, "ironstone", "bone:prop.R", 160, 0.6))
    return out


def lantern_parts() -> list:
    """the lantern (rigid on x_lantern): a ring through the hook's knob, a carved dark-wood octagon (finial and ribs
    over a glass cupola, a flared eave, banded frame, eight posts, a tapered base), amber lampresin panes, the azure
    core (the accent) in the middle of every pane and in the cupola"""
    out = []
    c = np.array([HANG[0], HANG[1], 0.0])
    ring = Sculpt("lantern_ring")
    h, u = _hook_frame()
    ring.add(Torus(HANG + np.array([0, 0, 0.026]), 0.022, 0.0055, axes=sdf.frame(unit(np.cross(h, (0, 0, 1))))), k=0.0)
    ring.add(Torus(HANG + np.array([0, 0, -0.010]), 0.012, 0.0045, axes=sdf.frame(h)), k=0.0)
    out.append(("lantern_ring", ring, 0.4, "wood_dark", "bone:x_lantern", 140, 0.5))
    zc_cup = lan_z(LAN_CUP[0])
    ze0, ze1, a_eave = lan_z(LAN_EAVE[0]), lan_z(LAN_EAVE[1]), LAN_EAVE[2]
    zb0, zb1 = lan_z(LAN_BODY[0]), lan_z(LAN_BODY[1])
    zs0, zs1 = lan_z(LAN_BASE[0]), lan_z(LAN_BASE[1])

    def eave(P):
        q = P - c
        k = np.clip((ze0 - P[:, 2]) / (ze0 - ze1), 0.0, 1.0)
        d = (octa_r(q) - (0.062 + (a_eave - 0.062) * k)) * 0.62
        inner = octa_r(q) - (0.050 + 0.012 * k)
        return np.maximum(np.maximum(d, -inner), np.maximum(P[:, 2] - ze0, ze1 - P[:, 2]))

    def base(P):
        q = P - c
        k = np.clip((zs0 - P[:, 2]) / (zs0 - zs1), 0.0, 1.0)
        d = (octa_r(q) - (0.099 - 0.060 * k)) * 0.75
        return np.maximum(d, np.maximum(P[:, 2] - zs0, zs1 - P[:, 2]))
    fr = Sculpt("lantern_frame")
    lo, hi = c + np.array([-0.13, -0.13, zs1 - 0.03]), c + np.array([0.13, 0.13, HANG[2] + 0.01])
    fr.add(Fn(eave, lo, hi), k=0.0)
    fr.add(Sphere((c[0], c[1], zc_cup + LAN_CUP[1] + 0.006), 0.017), k=0.004)                    # the finial
    for i in range(4):                                                                         # ribs over the cupola
        a = math.radians(45.0 * i + 22.5)
        pts = [(c[0] + math.cos(a) * LAN_CUP[1] * math.sin(t) * 1.03 * sg, c[1] + math.sin(a) * LAN_CUP[1] * math.sin(t) * 1.03 * sg,
                zc_cup + LAN_CUP[1] * math.cos(t) * 1.03) for sg in (-1.0, 1.0) for t in np.linspace(1.45, 0.0, 6)[::(1 if sg < 0 else -1)]]
        fr.add(Tube(pts, [0.0045] * len(pts), k=0.003), k=0.003)
    fr.add(Fn(lambda P: octa(P, c, 0.099, zb0 - 0.004, zb0 + 0.012), lo, hi), k=0.004)
    fr.add(Fn(lambda P: octa(P, c, 0.099, zb1 - 0.014, zb1 + 0.003), lo, hi), k=0.004)
    R_post = LAN_A / math.cos(math.radians(22.5))
    for i in range(8):
        a = math.radians(22.5 + 45.0 * i)
        pc = c + np.array([math.cos(a) * R_post, math.sin(a) * R_post, 0.0])
        fr.add(Capsule((pc[0], pc[1], zb1), (pc[0], pc[1], zb0), 0.0095), k=0.004)
    fr.add(Fn(base, lo, hi), k=0.004)
    fr.add(Sphere((c[0], c[1], zs1 - 0.008), 0.016), k=0.006)
    fr.ops = [(op, prim.displaced(chips(0.0015, 26.0), 0.0015) if op == "add" else prim, k, tg) for op, prim, k, tg in fr.ops]
    out.append(("lantern_frame", fr, 0.4, "wood_dark", "bone:x_lantern", 1350, 1.2))
    gl = Sculpt("lantern_glass")
    gl.add(Fn(lambda P: octa(P, c, LAN_GLASS, zb1, zb0), lo, hi), k=0.0)
    out.append(("lantern_glass", gl, 0.45, "lampresin", "bone:x_lantern", 220, 0.8))
    core = Sculpt("lantern_core")
    for i in range(4):
        a = math.radians(90.0 * i)
        n = np.array([math.cos(a), math.sin(a), 0.0])
        t = np.array([-math.sin(a), math.cos(a), 0.0])
        pc = c + n * (LAN_GLASS + 0.0015) + np.array([0, 0, 0.5 * (zb0 + zb1)])
        core.add(RoundBox(pc, (PANE_W, 0.0040, PANE_H), 0.003, axes=np.stack([t, n, (0, 0, 1)])), k=0.0)
    core.add(Fn(lambda P: np.maximum(np.linalg.norm(P - np.array([c[0], c[1], zc_cup]), axis=1) - LAN_CUP[1], zc_cup - 0.012 - P[:, 2]),
                c + np.array([-0.07, -0.07, zc_cup - 0.02]), c + np.array([0.07, 0.07, zc_cup + 0.07])), k=0.0)
    out.append(("lantern_core", core, 0.4, "accent", "bone:x_lantern", 420, 0.6))
    return out


def skin_extras(extra: dict) -> list:
    """Almanac Crook: three folded almanac pages (0.12 x 0.16 m rigid 1 cm plates) on short cords under the hook"""
    out = []
    if extra.get("almanac_pages"):
        pages, cords = Sculpt("almanac_pages"), Sculpt("almanac_cords")
        h, u = _hook_frame()
        side = unit(np.cross(u, h))
        for i, (s, ang, off) in enumerate(((0.60, -25.0, 0.0), (0.48, 20.0, 0.02), (0.36, -8.0, -0.01))):
            anchor = crook_at(s) + side * (SHAFT_R + 0.004) * (1 if i % 2 else -1)
            dirn = unit(-side * (1 if i % 2 else -1) * 0.35 + np.array([0, 0, -1.0]) + h * 0.15)
            top = anchor + dirn * 0.045
            cords.add(Capsule(anchor, top, 0.0028), k=0.0)
            cords.add(Torus(anchor, SHAFT_R + 0.004, 0.003, axes=sdf.frame(u)), k=0.002)
            R = _rot((0, 0, 1), ang)
            ax = np.stack([R @ np.array([1.0, 0, 0]), R @ np.array([0, 1.0, 0]), np.array([0, 0, 1.0])])
            cen = top + np.array([0, 0, -0.082]) + h * off
            fold = R @ np.array([0, 1.0, 0])
            pages.add(RoundBox(cen + fold * 0.004, (0.060, 0.004, 0.080), 0.003, axes=sdf.axes_from_rot(_rot((0, 0, 1), ang) @ _rot((1, 0, 0), 4.0))), k=0.0)
            pages.add(RoundBox(cen - fold * 0.004, (0.058, 0.004, 0.078), 0.003, axes=sdf.axes_from_rot(_rot((0, 0, 1), ang) @ _rot((1, 0, 0), -4.0))), k=0.002)
        out.append(("almanac_pages", pages, 0.45, "cloth2", "bone:prop.R", 420, 1.0))
        out.append(("almanac_cords", cords, 0.35, "leather", "bone:prop.R", 120, 0.4))
    return out


_BUILD: dict = {}


def model(ctx) -> list:
    P = []
    extra = (ctx.skin or {}).get("extra") or {}
    _BUILD["dunsom"] = True
    _BUILD["skin"] = (ctx.skin or {}).get("id")
    for name, S, vs, role, bind, tris, uvw in sculpts() + [x + (1.0,) if len(x) == 6 else x for x in skin_extras(extra)]:
        v, q = S.mesh(VOXEL * vs)
        ob = sdf.to_object(f"{name}_high", v, q, ctx.col)
        ob.data.materials.append(ctx.mats[role])
        P.append(fighter.Part(name, high=ob, tris=tris, bind=bind, uv_weight=uvw))
    return P


# ── rig: the right arm on the crook, prop.R up the shaft, prop.L in the left curl, the lantern bone, sockets ──
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
    eb["prop.R"].tail = g + V(tuple(CROOK_U)) * 0.12
    eb["prop.R"].align_roll(V((0.0, -1.0, 0.0)))
    cl = V(tuple(HAND_L_FRAME[0]))
    eb["prop.L"].head = cl
    eb["prop.L"].tail = cl + V(tuple(HAND_L_FRAME[1])) * 0.12
    eb["prop.L"].align_roll(V(tuple(-HAND_L_FRAME[3])))
    lb = eb.new("x_lantern")                                     # deforming: the lantern swings as one rigid piece
    lb.head = V(tuple(HANG))
    lb.tail = V(tuple(HANG - np.array([0.0, 0.0, 0.12])))
    lb.align_roll(V((0.0, -1.0, 0.0)))
    lb.parent = eb["prop.R"]
    lb.use_deform = True
    hb = eb.new("x_hat")                                         # deforming: the hat stays near level (see level())
    hb.head = V((HAT_C[0], HAT_C[1], 1.96))
    hb.tail = V((HAT_C[0], HAT_C[1], 2.06))
    hb.align_roll(V((0.0, -1.0, 0.0)))
    hb.parent = eb["head"]
    hb.use_deform = True
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.pose.bones["x_lantern"].rotation_mode = "XYZ"
    arm.pose.bones["x_hat"].rotation_mode = "XYZ"
    for b in arm.data.bones:
        info.lengths[b.name] = b.length
    info.joints["elbow.R"], info.joints["wrist.R"] = elv, wrv
    info.joints["knuckle.R"] = wrv + hd * PROPORTIONS["hand"] * 0.5
    info.joints["palm.R"] = g
    info.joints["forearm_dir.R"] = fo_d
    info.joints["arm_dir.R"] = up_d
    rig.add_socket(info, "x_crook_hook", "prop.R", tuple(HOOK_TOP), tuple(CROOK_U * 0.08), z_hint=(0, -1, 0))
    rig.add_socket(info, "x_crook_foot", "prop.R", tuple(crook_at(S_BUTT)), tuple(-CROOK_U * 0.08), z_hint=(0, -1, 0))


# ── skin weights (pipeline.bind_part wrapper) ──────────────────────────────────────────────────────────
def _seg_dist(P, a, b):
    ab = b - a
    t = np.clip(((P - a) @ ab) / float(ab @ ab), 0.0, 1.0)
    return np.linalg.norm(P - (a + t[:, None] * ab[None, :]), axis=1)


def _w_torso(P, J):
    x, z = P[:, 0], P[:, 2]
    wh = 1 - ss(1.20, 1.30, z)
    wc = ss(1.30, 1.42, z)
    ws = np.clip(1 - wh - wc, 0, 1)
    sh = ss(0.12, 0.21, np.abs(x)) * ss(1.36, 1.47, z)
    k = 1 - sh
    return {"hips": wh * k, "spine": ws * k, "chest": wc * k, "shoulder.L": sh * (x > 0), "shoulder.R": sh * (x <= 0)}


def _w_belt(P, J):
    return {"hips": np.full(len(P), 0.6), "spine": np.full(len(P), 0.4)}


def _w_hood(P, J):
    z = P[:, 2]
    wh = ss(1.66, 1.74, z)
    wc = 1 - ss(1.56, 1.64, z)
    wn = np.clip(1 - wh - wc, 0, 1)
    return {"head": wh, "neck": wn, "chest": wc}


def _w_scarf(P, J):
    x, z = P[:, 0], P[:, 2]
    wn = 0.75 * ss(1.63, 1.70, z) * (1 - ss(0.12, 0.18, np.abs(x - MX)))
    wh = 0.25 * ss(1.66, 1.72, z) * (1 - ss(0.12, 0.18, np.abs(x - MX)))
    sh = 0.55 * ss(0.14, 0.24, np.abs(x)) * (1 - ss(1.58, 1.64, z)) * (1 - wn - wh)
    wc = np.clip(1 - wn - wh - sh, 0, 1)
    return {"chest": wc, "neck": wn, "head": wh, "shoulder.L": sh * (x > 0), "shoulder.R": sh * (x <= 0)}


def _w_skirt(P, J):
    """the coat from the belt to the hem: the hips at the waist, the legs below (each side its own thigh, blended
    across the middle), the shins taking a share near the hem behind the calves"""
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    leg = 0.64 * ss(1.12, 0.66, z)
    side_l = ss(-0.13, 0.13, x)
    shin = leg * 0.40 * ss(0.66, 0.30, z) * (0.35 + 0.65 * ss(-0.05, 0.12, y))
    th = leg - shin
    return {"hips": 1 - leg, "thigh.L": th * side_l, "thigh.R": th * (1 - side_l),
            "shin.L": shin * side_l, "shin.R": shin * (1 - side_l)}


def _w_trousers(P, J):
    x, z = P[:, 0], P[:, 2]
    m = (x > 0).astype(float)
    ws = 1 - ss(0.40, 0.50, z)
    return {"shin.L": ws * m, "shin.R": ws * (1 - m), "thigh.L": (1 - ws) * m, "thigh.R": (1 - ws) * (1 - m)}


def _w_sleeves(P, J):
    out = {}
    for s, sx in (("L", 1.0), ("R", -1.0)):
        m = (P[:, 0] * sx > 0).astype(float)
        j, e = J[f"upper_arm.{s}"]
        fe, fw = J[f"forearm.{s}"]
        u = unit(e - j)
        d = (P - j) @ u
        wsh = 1 - ss(-0.06, 0.05, d)
        d1, d2 = _seg_dist(P, j, e), _seg_dist(P, fe, fw)
        uf = unit(fw - fe)
        past = ss(-0.03, 0.03, (P - fe) @ uf)
        wf = np.clip(ss(-0.025, 0.025, d1 - d2) * 0.5 + past * 0.5, 0, 1) * (1 - wsh)
        wu = np.clip(1 - wsh - wf, 0, 1)
        out[f"shoulder.{s}"] = wsh * m
        out[f"upper_arm.{s}"] = wu * m
        out[f"forearm.{s}"] = wf * m
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


WEIGHTS = {"torso": _w_torso, "belt": _w_belt, "hood": _w_hood, "scarf": _w_scarf, "skirt": _w_skirt,
           "trousers": _w_trousers, "sleeves": _w_sleeves, "boots": _w_boots}


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
PROC = ("hat", "crook_shaft", "crook_grip", "crook_ferrule", "lantern_ring", "lantern_frame", "lantern_glass",
        "hand_R", "hand_L", "toecaps", "buckle", "almanac_pages", "almanac_cords")
BACK_MATCH = 0.85
# z / 2.0 -> linear gain: the light head (hat, mask) and the darker coat skirt toward the boots (brief §6)
VALUE_RAMP = [(0.0, 0.60), (0.08, 0.64), (0.15, 0.70), (0.25, 0.78), (0.35, 0.88), (0.50, 0.96), (0.70, 1.0), (1.0, 1.03)]
HI_KNEE, HI_TOP = 0.56, 0.70   # linear luminance: a soft shoulder from L* 80 up to L* 87 (no large area over 86)
SIDE_PARTS = ("hood", "scarf", "coat_top", "belt", "skirt", "under_robe", "trousers", "sleeve_L", "sleeve_R", "boots",
              "mask")
SIDE_FACE = (0.24, 0.60)
SIDE_FACE_PART = {"hood": (0.35, 0.80), "mask": (0.30, 0.70)}
SIDE_HI = 1.15
BACK_PARTS = ("hood", "scarf", "coat_top", "belt", "skirt", "sleeve_L", "sleeve_R", "trousers", "boots")
OBLIQUE = {"coat_top": 0.65, "skirt": 0.45, "sleeve_L": 0.55, "sleeve_R": 0.60, "scarf": 0.40, "hood": 0.45}
DARK_FLOOR, DARK_KNEE = 0.62, 0.86


def _hex(h):
    return np.asarray(scene.hex_srgb(h), dtype=np.float32)


def _lin(c):
    return _project._lin(c)


def _srgb(c):
    return _project._srgb(c).astype(np.float32)


def _Y(lin):
    return lin @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def _hi_cap(lin):
    Y = np.maximum(_Y(lin), 1e-6)
    hi = Y > HI_KNEE
    Y2 = Y.copy()
    Y2[hi] = HI_KNEE + (HI_TOP - HI_KNEE) * (1 - np.exp(-(Y[hi] - HI_KNEE) / (HI_TOP - HI_KNEE)))
    return lin * (Y2 / Y)[:, None]


def _fbm(P, f, o=3):
    return NOISE.fbm(P, f, o)


_HID = [None]


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
    hid_both = np.ones(len(p), dtype=bool)
    for side in ("front", "back"):
        px, py = plates.to_px(side, p[:, 0], p[:, 2])
        c = _project.bilinear(plates.img[side], px, py)
        c = c * (1 - ws) + _project.bilinear(soft[side], px, py) * ws
        dep, hid = vis.lookup(side, px, py)
        if side == "front":
            hidden = ~(p[:, 1] <= np.nan_to_num(dep, nan=1e9) + eps)
        else:
            hidden = ~(p[:, 1] >= np.nan_to_num(dep, nan=-1e9) - eps)
        hid_both &= hidden
        for kk in np.unique(k[hidden]):
            f = fills.get((side, int(kk)))
            if f is None:
                continue
            sel = hidden & (k == kk)
            c[sel] = _project.bilinear(f, px[sel] / vis.step, py[sel] / vis.step)
        cols[side] = c
    wb = np.clip((n[:, 1] + 0.25) / 0.5, 0, 1)
    wb = wb * wb * (3 - 2 * wb)
    _HID[0] = hid_both
    return idx, k, p, n, cols, wb


def _band_tone(z, lin, zq, step=0.03):
    """median colour of `lin` (texels at heights z) per `step` band, read at the heights zq (interpolated)"""
    lo, hi = float(z.min()), float(z.max())
    nb = max(1, int(math.ceil((hi - lo) / step)))
    b = np.clip(((z - lo) / step).astype(int), 0, nb - 1)
    cen, med = [], []
    for i in range(nb):
        m = b == i
        if m.sum() >= 12:
            cen.append(lo + (i + 0.5) * step)
            med.append(np.median(lin[m], axis=0))
    if not cen:
        return np.repeat(np.median(lin, axis=0)[None, :], len(zq), 0)
    cen, med = np.array(cen), np.array(med)
    return np.stack([np.interp(zq, cen, med[:, c]) for c in range(3)], 1).astype(np.float32)


def _felt_w(lin):
    """1 on the painted cloth (not the near-black shadow gaps), soft"""
    return ss(0.012, 0.03, _Y(lin))


def _side_fill(lin, k, p, n, names, log):
    """Edge-on texels (both plates see them badly: zebra streaks) and texels hidden from both plates take the part's
    own painted tone at their height (front and back blended by the normal), broken by soft vertical brush strokes;
    none brighter than SIDE_HI x its band (Vashil's fix-pass method)."""
    face = np.abs(n[:, 1])
    hid = _HID[0] if _HID[0] is not None and len(_HID[0]) == len(k) else np.zeros(len(k), dtype=bool)
    strokes = 1 + 0.065 * NOISE.fbm(p * np.array([1.0, 1.0, 0.30]), 9.0, 3) + 0.03 * NOISE(p, 30.0)
    for kk in np.unique(k):
        nm = names[kk]
        if nm not in SIDE_PARTS:
            continue
        sel = k == kk
        f0, f1 = SIDE_FACE_PART.get(nm, SIDE_FACE)
        w = np.maximum(1 - ss(f0, f1, face), hid.astype(np.float32))
        good = sel & (face > 0.78) & ~hid
        if good.sum() < 40:
            continue
        zs = p[sel, 2]
        gf, gb = good & (n[:, 1] < 0), good & (n[:, 1] > 0)
        tf = _band_tone(p[gf, 2], lin[gf], zs) if gf.sum() >= 40 else None
        tb = _band_tone(p[gb, 2], lin[gb], zs) if gb.sum() >= 40 else None
        if tf is None and tb is None:
            continue
        tf = tf if tf is not None else tb
        tb = tb if tb is not None else tf
        wbb = ss(-0.35, 0.35, n[sel, 1])[:, None]
        tone = tf * (1 - wbb) + tb * wbb
        ws_ = w[sel][:, None]
        c = lin[sel] * (1 - ws_) + tone * strokes[sel][:, None] * ws_
        Yc, Yt = _Y(c), np.maximum(_Y(tone), 1e-4)
        cap = np.where(face[sel] < 0.9, Yt * SIDE_HI, 1e9)
        c = c * np.minimum(1.0, cap / np.maximum(Yc, 1e-5))[:, None]
        lin[sel] = c
        log(f"  dunsom side fill {nm}: {100 * float((w[sel] > 0.5).mean()):.0f}% of its texels")
    return lin


def _calm(lin, k, p, n, names, log):
    """where cloth turns away from the plates (|normal.y| 0.95 -> 0.55) the painted fold strokes stretch into bands
    in a three-quarter view: there they ease toward the part's banded tone, no texel darker than DARK_FLOOR x it"""
    hid = _HID[0] if _HID[0] is not None and len(_HID[0]) == len(k) else np.zeros(len(k), dtype=bool)
    strokes = 1 + 0.05 * NOISE.fbm(p * np.array([1.0, 1.0, 0.30]), 9.0, 3) + 0.025 * NOISE(p, 30.0)
    face = np.abs(n[:, 1])
    fw = _felt_w(lin)
    for kk in np.unique(k):
        nm = names[kk]
        if nm not in OBLIQUE:
            continue
        sel = k == kk
        c = lin[sel]
        zs = p[sel, 2]
        good = (face[sel] > 0.85) & (fw[sel] > 0.8) & ~hid[sel]
        gf, gb = good & (n[sel, 1] < 0), good & (n[sel, 1] > 0)
        tf = _band_tone(zs[gf], c[gf], zs) if gf.sum() >= 40 else None
        tb = _band_tone(zs[gb], c[gb], zs) if gb.sum() >= 40 else None
        if tf is None and tb is None:
            continue
        tf = tf if tf is not None else tb
        tb = tb if tb is not None else tf
        wbb = ss(-0.35, 0.35, n[sel, 1])[:, None]
        tone = tf * (1 - wbb) + tb * wbb
        obl = (1 - ss(0.55, 0.95, face[sel])) * fw[sel]
        wo = (OBLIQUE[nm] * obl)[:, None]
        c = c * (1 - wo) + (tone * strokes[sel][:, None] + (c - tone) * 0.35) * wo
        r = _Y(c) / np.maximum(_Y(tone), 1e-5)
        D = DARK_KNEE - DARK_FLOOR
        r2 = np.where(r < DARK_KNEE, DARK_KNEE - D * (1 - np.exp(-(DARK_KNEE - r) / D)), r)
        g = 1 + (r2 / np.maximum(r, 1e-5) - 1) * obl
        lin[sel] = c * g[:, None]
        log(f"  dunsom oblique calm {nm}: {100 * float((obl > 0.5).mean()):.0f}% of its texels")
    return lin


BACK_DETAIL = 0.65          # how much of the back sheet's own value variation (its fold strokes) survives


def _match_back(k, p, cols, wb, names, log):
    """The back sheet is lit differently (in shadow at the centre, a hot rim on the sides): a plain gain (build 2)
    turned its rim strokes into white smears. Per cloth part, each back texel takes the FRONT's banded tone at its
    height times its own value relative to the back's band (BACK_DETAIL of the contrast): the back keeps its painted
    folds in the front's colour. The hood (its front is mostly the face opening) takes the hood's felt tone, a little
    darker under the brim."""
    fr, bk = _lin(cols["front"]), _lin(cols["back"])
    hood_lin = _lin(_hex(HOOD_HEX))
    for kk in np.unique(k):
        nm = names[kk]
        if nm not in BACK_PARTS:
            continue
        sel = k == kk
        zs = p[sel, 2]
        b = sel & (wb > 0.6) & (_Y(bk) > 0.004)
        if b.sum() < 150:
            continue
        if nm == "hood":
            tf = hood_lin[None, :] * (1 - 0.30 * ss(1.78, 1.94, zs))[:, None]
        else:
            f = sel & (wb < 0.25) & (_Y(fr) > 0.012)
            if f.sum() < 150:
                continue
            tf = _band_tone(p[f, 2], fr[f], zs, step=0.04)
        tb = _band_tone(p[b, 2], bk[b], zs, step=0.04)
        r = np.clip(_Y(bk[sel]) / np.maximum(_Y(tb), 1e-4), 0.35, 1.8) ** BACK_DETAIL
        bk[sel] = tf * r[:, None]
        log(f"  dunsom back match {nm}: front band tones x back detail ({int(b.sum())} texels)")
    cols["back"] = _srgb(bk)


KEY = unit((-0.45, -0.70, 0.55))                    # the painted key light: upper front, his right
HOOD_FLOOR = 0.62           # no hood texel darker than this x the lit hood's median (the back sheet paints its back
                            # in the brim's shadow: a black column from behind) except inside the face opening
HOOD_HEX = "#7A6E86"        # the hood's felt (the coat's lavender): 40 % of its hue / chroma


def _lam(n, lo=0.70, k=0.36):
    return lo + k * np.clip(n @ KEY, -0.4, 1.0)


def _hat_paint(p, n):
    """the felt hat: pale dusk-lavender felt (the back view's top, toned under L* 86), soft radial brushing, a lit
    crown, the stitched band a shade darker, the edge roll darker, the underside a deep warm mauve in shade"""
    q = p[:, :2] - HAT_C[None, :]
    r = np.hypot(q[:, 0], q[:, 1])
    th = np.arctan2(q[:, 1], q[:, 0])
    top = _lin(_hex("#ACA2B6"))
    under = _lin(_hex("#5E4A55"))
    up = ss(-0.15, 0.35, n[:, 2])
    zt = hat_top(r)
    on_top = ss(zt - HAT_T * 0.75, zt - HAT_T * 0.35, p[:, 2]) * up
    brush = 1 + 0.045 * NOISE(np.stack([th * 3.0, r * 18.0, p[:, 2] * 0.0], 1), 1.0) + 0.03 * _fbm(p, 22.0)
    c = top[None, :] * (brush * (0.86 + 0.20 * ss(0.32, 0.04, r)) * (0.90 + 0.14 * ss(-0.2, 0.8, n @ KEY)))[:, None]
    band = np.exp(-((r - 0.322) / 0.006) ** 2)
    stitch = (np.sin(th * 0.5 * 2 * math.pi * HAT_R / 0.012) > 0.3) * np.exp(-((r - 0.322) / 0.0025) ** 2)
    c = c * (1 - 0.10 * band - 0.10 * stitch)[:, None]
    edge = ss(HAT_R - 0.012, HAT_R, r)
    c = c * (1 - 0.18 * edge)[:, None]
    u_ = under[None, :] * (1 + 0.06 * _fbm(p, 18.0))[:, None] * (0.85 + 0.25 * ss(0.12, 0.34, r))[:, None]
    w = on_top[:, None]
    return c * w + u_ * (1 - w)


def _wood_paint(p, n):
    """the crook: pale weathered grey-beige wood, grain along the shaft, knots, darker toward the butt"""
    q = p - GRIP
    s = q @ CROOK_U
    h, u = _hook_frame()
    th = np.arctan2(q @ np.cross(u, h), q @ h)
    grain = np.sin(th * 3.0 + s * 11.0 + 2.6 * NOISE(p * np.array([1, 1, 0.2]), 6.0)) * 0.5 + 0.5
    base = _lin(_hex("#8E7F70"))
    dark = _lin(_hex("#54473C"))
    c = base[None, :] * (1 - 0.38 * grain ** 3)[:, None] + dark[None, :] * (0.38 * grain ** 3)[:, None]
    knots = np.clip(NOISE.ridged(p, 10.0, 2) - 0.55, 0, 1) * 1.6
    z = p[:, 2]
    butt = 0.55 + 0.45 * ss(0.05, 0.60, z)
    c = c * ((1 - 0.35 * knots) * butt * _lam(n, 0.80, 0.22))[:, None] * (1 + 0.07 * _fbm(p, 30.0))[:, None]
    return c


def _leather_paint(p, n, hexc="#4A3833"):
    return _lin(_hex(hexc))[None, :] * ((1 + 0.15 * _fbm(p, 40.0)) * _lam(n, 0.85, 0.2))[:, None]


def _stone_paint(p, n, hexc, grain=0.12):
    c = _lin(_hex(hexc))[None, :] * (1 + grain * _fbm(p, 14.0))[:, None]
    k = (1 - 0.30 * ss(-0.2, -0.8, n[:, 2])) * (1 + 0.06 * ss(0.4, 0.9, n[:, 2]))
    return c * k[:, None]


def _glove_paint(p, n, frame, curl):
    """the ochre gloves (the mask's ochre, a little duller): lit backs of the fingers, dark creases between them and
    in the curl, a darker cuff band"""
    C, a, f, out = frame
    base = _lin(_hex("#A8732F"))
    q = p - C
    sa = q @ a / HS
    crease = np.zeros(len(p), dtype=np.float32)
    for i in range(3):
        sp = (i - 1.0) * 0.0245
        crease = np.maximum(crease, np.exp(-((sa - sp) / 0.0035) ** 2))
    inner = ss(0.0, -0.035 * HS, q @ out) * ss(-0.01, 0.03 * HS, q @ f)
    cuff = ss(-0.07 * HS, -0.085 * HS, q @ f)
    c = base[None, :] * (_lam(n, 0.72, 0.42) * (1 - 0.35 * crease * ss(0.0, 0.02 * HS, q @ f)) * (1 - 0.30 * inner)
                         * (1 - 0.22 * cuff) * (1 + 0.06 * _fbm(p, 50.0)))[:, None]
    return c


def _lantern_frame_paint(p, n):
    c = _lin(_hex("#5E4234"))[None, :] * (1 + 0.12 * _fbm(p * np.array([1, 1, 4.0]), 30.0))[:, None]
    edge = ss(0.5, 0.95, np.abs(n[:, 2]))
    return c * (_lam(n, 0.75, 0.35) * (1 + 0.12 * edge * (n[:, 2] > 0)))[:, None]


def _lantern_glass_paint(p, n):
    """amber lampresin panes lit from within: a warm bright centre column, deeper toward the posts and the bands"""
    c0 = np.array([HANG[0], HANG[1]])
    q = p[:, :2] - c0
    zc = 0.5 * (lan_z(LAN_BODY[0]) + lan_z(LAN_BODY[1]))
    ang = np.arctan2(q[:, 1], q[:, 0])
    off = (ang - math.radians(45.0)) % math.radians(45.0) - math.radians(22.5)
    mid = 1 - ss(0.0, math.radians(18.0), np.abs(off))
    hot = mid * (1 - ss(0.04, 0.085, np.abs(p[:, 2] - zc)))
    c = _lin(_hex("#B8641A"))[None, :] * (1 - hot)[:, None] + _lin(_hex("#E59A3C"))[None, :] * hot[:, None]
    return c


def _paint(maps, plates, vis, names, tops=None, flat=None, eps=0.02, bleed=True, log=print):
    if "crook_shaft" not in names or "hat" not in names:
        return _orig_paint(maps, plates, vis, names, tops=tops, flat=flat, eps=eps, bleed=bleed, log=log)
    P, N, part = maps["P"], maps["N"], maps["part"]
    size = maps["size"]
    out = np.zeros((size, size, 3), dtype=np.float32)
    idx, k, p, n, cols, wb = _proj_sides(maps, plates, vis, names, eps, log)
    _match_back(k, p, cols, wb, names, log)
    col = cols["front"] * (1 - wb[:, None]) + cols["back"] * wb[:, None]
    lin = _lin(col)
    lin = _side_fill(lin, k, p, n, names, log)
    lin = _calm(lin, k, p, n, names, log)

    def sel(name):
        if name not in names:
            return None
        m = k == names.index(name)
        return m if m.any() else None

    procs = {
        "hat": _hat_paint, "crook_shaft": _wood_paint, "crook_grip": lambda pp, nn: _leather_paint(pp, nn, "#4A3730"),
        "crook_ferrule": lambda pp, nn: _stone_paint(pp, nn, "#4A464E", 0.12),
        "lantern_ring": _lantern_frame_paint, "lantern_frame": _lantern_frame_paint, "lantern_glass": _lantern_glass_paint,
        "hand_R": lambda pp, nn: _glove_paint(pp, nn, HAND_R_FRAME, 1.0),
        "hand_L": lambda pp, nn: _glove_paint(pp, nn, HAND_L_FRAME, LEFT_CURL),
        "toecaps": lambda pp, nn: _stone_paint(pp, nn, "#47434B", 0.12),
        "buckle": lambda pp, nn: _stone_paint(pp, nn, "#4B3A31", 0.10),
        "almanac_pages": lambda pp, nn: _stone_paint(pp, nn, "#D8CDB4", 0.05),
        "almanac_cords": lambda pp, nn: _leather_paint(pp, nn, "#4A3730"),
    }
    for name, fn in procs.items():
        m = sel(name)
        if m is not None:
            lin[m] = fn(p[m], n[m])
    # the hood's inside round the mask in deep shade; the mask's edges shaded by the hood
    m = sel("hood")
    if m is not None:
        pp = p[m]
        sd = face_sd(pp[:, 0], pp[:, 2])
        inner = ss(0.004, -0.006, sd) * ss(-0.10, -0.05, pp[:, 1])
        c = lin[m]
        Y = _Y(c)
        fl = HOOD_FLOOR * float(_Y(_lin(_hex(HOOD_HEX))[None, :])[0])
        lift = np.where(Y < fl, (fl - (fl - Y) * 0.35) / np.maximum(Y, 1e-4), 1.0)
        lift = 1 + (np.minimum(lift, 3.0) - 1) * (1 - inner)
        tone = _lin(_hex(HOOD_HEX))[None, :] * Y[:, None] / max(float(_Y(_lin(_hex(HOOD_HEX))[None, :])[0]), 1e-4)
        c = c * 0.6 + tone * 0.4
        lin[m] = c * (lift * (1 - 0.40 * inner))[:, None]
    m = sel("mask")
    if m is not None:
        pp = p[m]
        sd = face_sd(pp[:, 0], pp[:, 2])
        lin[m] = lin[m] * (1 - 0.35 * ss(-0.012, 0.0, sd))[:, None]
    # the light-head / dark-feet ramp and the highlight cap (not on the crook / lantern: held at any height)
    body = np.ones(len(k), dtype=bool)
    for name in ("crook_shaft", "crook_grip", "crook_ferrule", "lantern_ring", "lantern_frame", "lantern_glass",
                 "almanac_pages", "almanac_cords"):
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
        nn = x.shape[axis]
        hi = np.take(c, np.arange(2 * r + 1, 2 * r + 1 + nn), axis=axis)
        lo = np.take(c, np.arange(0, nn), axis=axis)
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
    """outlier texels refilled from their own part's good texels: the painted crook's grey and the gloves' ochre
    where they lie over the model's sleeve and coat (the model's fist sits forward of the painted one)"""
    P, part = maps["P"], maps["part"]
    for name in ("sleeve_R", "coat_top", "sleeve_L", "skirt"):
        if name not in names:
            continue
        own = part == names.index(name)
        if not own.any():
            continue
        c = out[own]
        mx, mn = c.max(1), c.min(1)
        sat = (mx - mn) / np.maximum(mx, 1e-3)
        warm = ((c[:, 0] > c[:, 2] + 0.06) & (sat > 0.32)) | ((c[:, 0] > c[:, 2] + 0.025) & (sat > 0.18))
        Yc = c @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
        warm |= (Yc > 1.35 * float(np.median(Yc))) & (c[:, 0] >= c[:, 2] - 0.005)
        if not warm.any():
            continue
        bad = np.zeros_like(own)
        bad[own] = warm
        out = _fill_atlas(out, own, bad)
        log(f"dunsom paint: {name} {int(warm.sum())} warm texels refilled")
    return out


_orig_paint = _project.paint
_project.paint = _paint


# ── skins (project.recolour wrapper) ────────────────────────────────────────────────────────────────────
# Each listed part's painted median moves onto the skin's colour (linear gain per channel: the painted values and
# detail keep their relationships); the coat parts follow the cloth role's own change. Highrim: a wind-carved
# grain across the hat (light and dark streaks flowing one way, ~6 %); Almanac: printed tables on the hat (rings and
# spokes of ruled cells with tick 'figures', ink at 60 %), printed pages on the crook.
SKIN_PARTS = {
    "dunsom_highrim": {"hat": "#CDBB9C", "scarf": "#A69477", "crook_shaft": "#BFAE95"},
    "dunsom_almanac": {"hat": "#D8CDB4", "scarf": "#B3A891", "crook_shaft": "#3A342E", "lantern_frame": "#2E2A26",
                       "lantern_ring": "#2E2A26", "buckle": "#2E2A26"},
}
SKIN_CLOTH = {"dunsom_almanac": ("#85818F", "#7D7185", ("coat_top", "skirt", "sleeve_L", "sleeve_R", "hood"))}
INK_HEX = "#3A342C"


def _shift_to(c, target_hex, med):
    gain = np.clip(_lin(_hex(target_hex)) / np.maximum(med, 1e-4), 0.02, 4.0)
    return _srgb(_hi_cap(_lin(c) * gain[None, :]))


def _ink(d, hw=0.0016, aa=0.0009):
    return 1 - ss(hw - aa, hw + aa, d)


def _tables(P):
    """Almanac: ruled tables printed round the hat's top (concentric rule lines, radial cell walls, tick figures)"""
    q = P[:, :2] - HAT_C[None, :]
    r = np.hypot(q[:, 0], q[:, 1])
    th = np.arctan2(q[:, 1], q[:, 0])
    rings = np.abs(((r - 0.06) / 0.042 + 0.5) % 1.0 - 0.5) * 0.042
    d = np.where((r > 0.06) & (r < 0.33), rings, 1e9)
    seg = 2 * math.pi / 24
    wall = np.abs(((th / seg) + 0.5) % 1.0 - 0.5) * seg * r
    d = np.minimum(d, np.where((r > 0.10) & (r < 0.315), wall, 1e9))
    # the 'figures': short ticks in each cell (two per cell, staggered rows)
    cell_r = ((r - 0.06) / 0.042) % 1.0
    cell_t = ((th / seg) % 1.0)
    fig = (np.abs(cell_r - 0.5) < 0.18) & ((np.abs(cell_t - 0.33) < 0.06) | (np.abs(cell_t - 0.62) < 0.10)) & (r > 0.10) & (r < 0.31)
    cov = np.maximum(_ink(d), fig.astype(np.float32) * 0.8)
    return cov * (1 - ss(HAT_R - 0.03, HAT_R - 0.015, r))


def _page_print(P):
    """Almanac pages: ruled rows of tiny figures"""
    z = P[:, 2]
    rows = np.abs(((z / 0.011) % 1.0) - 0.5) < 0.18
    cols = np.abs(np.sin(P[:, 0] * 260.0 + P[:, 1] * 260.0)) > 0.35
    return (rows & cols).astype(np.float32) * 0.65


def _wind_grain(P):
    """Highrim: the wind-carved grain across the hat: streaks flowing along one direction, warped"""
    w = P[:, 0] * 0.8 + P[:, 1] * 0.6
    v = P[:, 0] * -0.6 + P[:, 1] * 0.8
    s = np.sin(v * 140.0 + 4.0 * NOISE(P, 5.0) + 2.0 * np.sin(w * 9.0))
    return 0.06 * s + 0.03 * NOISE(P * np.array([4.0, 4.0, 1.0]), 30.0)


def _recolour(img, maps, names, roles, base_pal, skin_pal, skip=None, log=print):
    if "crook_shaft" not in names:
        return _orig_recolour(img, maps, names, roles, base_pal, skin_pal, skip=skip, log=log)
    sid = next((s["id"] for s in SKINS if all(skin_pal.get(k_) == v for k_, v in s["palette"].items())), None)
    targets = SKIN_PARTS.get(sid, {})
    part = maps["part"]
    iy, ix = _project.nearest_index(part >= 0)
    pid = part[iy, ix]
    Pm = maps["P"][iy, ix]
    out = img.copy()
    cloth = SKIN_CLOTH.get(sid)
    for i, nm in enumerate(names):
        m = pid == i
        if not m.any():
            continue
        c = out[m]
        own = part[m] >= 0
        if nm in targets:
            lin = _lin(c[own]) if own.any() else _lin(c)
            Y = _Y(lin)
            mid = (Y > np.quantile(Y, 0.25)) & (Y < np.quantile(Y, 0.9))
            if nm == "hat":
                mid &= Pm[m][own if own.any() else slice(None)][:, 2] > HAT_EDGE + 0.01
            med = np.median(lin[mid] if mid.sum() > 20 else lin, axis=0)
            c = _shift_to(c, targets[nm], med)
            log(f"  dunsom recolour {nm} -> {targets[nm]}")
        elif cloth and nm in cloth[2]:
            gain = np.clip(_lin(_hex(cloth[0])) / np.maximum(_lin(_hex(cloth[1])), 1e-4), 0.2, 4.0)
            c = _srgb(_hi_cap(_lin(c) * gain[None, :]))
            log(f"  dunsom recolour {nm} (cloth) -> {cloth[0]}")
        P = Pm[m]
        if nm == "hat" and sid == "dunsom_highrim":
            top = ss(HAT_EDGE, HAT_EDGE + 0.02, P[:, 2])
            c = _srgb(_hi_cap(_lin(c) * (1 + _wind_grain(P) * top)[:, None]))
        if nm == "hat" and sid == "dunsom_almanac":
            cov = _tables(P) * ss(HAT_EDGE, HAT_EDGE + 0.02, P[:, 2]) * 0.6
            c = c * (1 - cov[:, None]) + _hex(INK_HEX)[None, :] * cov[:, None]
            log(f"  dunsom almanac tables: {100 * float((cov > 0.3).mean()):.1f}% of the hat's texels")
        if nm == "almanac_pages":
            cov = _page_print(P)
            c = c * (1 - cov[:, None]) + _hex(INK_HEX)[None, :] * cov[:, None]
        out[m] = c
    return out.astype(np.float32)


_orig_recolour = _project.recolour
_project.recolour = _recolour


# ── prop.R location tracks (Vashil's wrappers): the crook slides through the fist ───────────────────────
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


# ── the lantern's pendulum (anim.sample_clip wrapper) ───────────────────────────────────────────────────
# x_lantern hangs plumb: every frame its bone is pointed at a spring-led direction that follows straight down
# (solved in world space, 2 axes), never more than LAN_MAX degrees off plumb (brief: <= 6 degrees, heavily damped, the
# accent never blurs). An authored "x_lantern" key (a knock in the taunt) rides on top. Loops run three cycles.
LAN_K, LAN_D, LAN_MAX = 120.0, 15.0, 6.0
_orig_sample_clip = anim.sample_clip


def _hang_lantern(skel, poses, loop, extra=None):
    b = "x_lantern"
    if b not in skel.bones:
        return poses
    n = len(poses)
    m = n - 1 if loop else n
    dt = 1.0 / FPS
    down = V((0.0, 0.0, -1.0))
    frames = []
    for f in range(m):
        M = skel.fk(poses[f])
        Pm = M[skel.parent[b]] @ skel.local[b]
        frames.append(Pm)
    cur = down.copy()
    vel = V((0.0, 0.0, 0.0))
    rec = []
    for r in range(3 if loop else 1):
        for f in range(m):
            # the pivot's acceleration swings the lantern (inertia, damped x0.35), springs pull it plumb
            acc = V((0.0, 0.0, 0.0))
            if 0 < f < m - 1 or loop:
                a0, a1, a2 = frames[(f - 1) % m].translation, frames[f].translation, frames[(f + 1) % m].translation
                acc = (a0 - 2 * a1 + a2) / (dt * dt)
            g_eff = down * 9.81 - acc * 0.35
            tgt = g_eff.normalized() if g_eff.length > 1e-6 else down
            vel += (tgt - cur) * (LAN_K * dt) - vel * (LAN_D * dt)
            cur = (cur + vel * dt).normalized()
            ang = math.degrees(cur.angle(down))
            if ang > LAN_MAX:
                ax = down.cross(cur)
                if ax.length > 1e-8:
                    cur = (Matrix.Rotation(math.radians(LAN_MAX), 3, ax.normalized()) @ down).normalized()
                    vel *= 0.5
            if r == (2 if loop else 0):
                rec.append(cur.copy())
    if loop:
        rec.append(rec[0])
    out = [dict(p) for p in poses]
    for f in range(n):
        Pm = frames[f % m]
        R = Pm.to_3x3()
        y = R.col[1].normalized()
        d = rec[f]
        kx = poses[f].get(b)
        if kx:
            d = (Matrix.Rotation(math.radians(kx[0]), 3, R.col[0].normalized()) @
                 Matrix.Rotation(math.radians(kx[2]), 3, R.col[2].normalized()) @ d).normalized()
        q = y.rotation_difference(d)
        loc = R.inverted() @ q.to_matrix() @ R
        out[f][b] = anim.Skeleton.euler_of(loc)
    return out


def _sample_clip(skel, clip, chains=None):
    return _hang_lantern(skel, _orig_sample_clip(skel, clip, chains), clip.loop)


anim.sample_clip = _sample_clip


# ── portrait / icon framing (render._fit_camera wrapper): the head boxes take in the hat's brim and the lantern ──
_orig_fit_camera = _render._fit_camera


def _fit_camera(cam, lo, hi, yaw, pitch, lens, fill, aspect, x_frac, y_center=None):
    if _BUILD.get("dunsom") and (hi.z - lo.z) < 1.0:
        arm = next((o for o in bpy.data.objects if o.type == "ARMATURE" and o.name.startswith(ID)), None)
        pts = [V((HAT_C[0] - HAT_R, HAT_C[1], 1.95)), V((HAT_C[0] + HAT_R, HAT_C[1], 1.95))]
        if arm is not None and "head" in arm.pose.bones:
            mw = arm.matrix_world
            hb = arm.pose.bones["head"]
            pts = [mw @ hb.matrix @ V((x, hb.length * 0.85, 0.0)) for x in (-HAT_R, HAT_R)]
            if "x_lantern" in arm.pose.bones and (hi.z - lo.z) > 0.6:
                lb = arm.pose.bones["x_lantern"]
                pts += [mw @ lb.head, mw @ lb.tail]
        for q in pts:
            lo = V((min(lo.x, q.x - 0.06), min(lo.y, q.y - 0.06), lo.z))
            hi = V((max(hi.x, q.x + 0.06), max(hi.y, q.y + 0.06), max(hi.z, q.z + 0.10)))
    return _orig_fit_camera(cam, lo, hi, yaw, pitch, lens, fill, aspect, x_frac, y_center)


_render._fit_camera = _fit_camera


# ── the foot roll (anim._solve_foot, wrapped by Vashil's corrected copy: + pitch = toes up about the heel) ──
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
# `aim` = the crook's shaft (prop.R +Y up the shaft), the left hand grips the crook with to_prop ("prop.R", along)
# measured from the prop's origin (which slides with the crook: along = -slide + offset).
GUARD_R = tuple(np.round((W_R - SH_R) / ARM, 4))
GUARD_L = tuple(np.round((W_L - SH_L) / ARM, 4))
UP = tuple(np.round(CROOK_U, 4))


def _pole(S, E, W):
    d = unit(W - S)
    v = (E - S) - d * float((E - S) @ d)
    return tuple(np.round(unit(v), 3))


POLE_R = _pole(SH_R, E_R, W_R)
POLE_L = _pole(SH_L, E_L, W_L)
POLE_RF = (-0.45, 0.55, -0.70)
BLOCKS = {
    "guard": (GUARD_R, POLE_R, UP, GUARD_L, POLE_L),
    "run_fwd": ((-0.12, -0.50, -0.70), POLE_RF, (0.42, -0.42, 0.80), GUARD_L, POLE_L),
    "run_back": ((-0.12, -0.46, -0.72), POLE_RF, (0.42, -0.40, 0.81), GUARD_L, POLE_L),
    "lobby": (GUARD_R, POLE_R, UP, GUARD_L, POLE_L),
    "victory": (GUARD_R, POLE_R, UP, GUARD_L, POLE_L),
    "recall": (GUARD_R, POLE_R, UP, GUARD_L, POLE_L),
}
MOTION = anim.motion_profile(weight="medium", weapon="staff", stance="neutral", run_ref_speed=3.35, blocks=BLOCKS)
P_ = anim.P
FPS = anim.FPS


def _feet(l=(0.0, 0.0, 0.0), r=(0.0, 0.0, 0.0), yl=0.0, yr=0.0, pl=0.0, pr=0.0, wl=1.0, wr=1.0):
    return {"foot.L": FootTarget(tuple(l), pl, yl, 0.0, 0.0, wl), "foot.R": FootTarget(tuple(r), pr, yr, 0.0, 0.0, wr)}


def pose(torso=None, hips=(0.0, 0.0, 0.0), R=GUARD_R, Rp=None, aim=UP, L=GUARD_L, Lp=POLE_L, grip=None,
         Lpos=None, feet=None, slide=0.0, fk=None) -> dict:
    """A full pose: torso rotations (deg), hips_loc offset, the right wrist + crook aim, the left wrist (or `grip`: the
    left hand on the crook at `grip` m from the right fist toward the hook; or `Lpos`: an absolute left-hand target),
    feet, the crook's slide through the fist, FK extras."""
    t = dict(hips=(0.0, 0.0, 0.0), spine=(0.0, 0.0, 0.0), chest=(0.0, 0.0, 0.0), neck=(0.0, 0.0, 0.0), head=(0.0, 0.0, 0.0))
    t.update(torso or {})
    p = P_(**t)
    p["hips_loc"] = (hips[0], hips[1], -0.006 + hips[2])
    p["prop.R_loc"] = (0.0, float(slide), 0.0)
    ik = {}
    ik.update(feet or _feet())
    if Rp is None:
        Rp = POLE_R if float(np.linalg.norm(np.subtract(R, GUARD_R))) < 0.15 else POLE_RF
    ik["hand.R"] = HandTarget(rel=tuple(R), pole=tuple(Rp))
    ik["aim.R"] = Aim(tuple(aim))
    if grip is not None:
        ik["hand.L"] = HandTarget(to_prop=("prop.R", -float(slide) + float(grip)), pole=(0.8, 0.4, -0.4))
    elif Lpos is not None:
        ik["hand.L"] = HandTarget(pos=tuple(Lpos), pole=tuple(Lp))
    else:
        ik["hand.L"] = HandTarget(rel=tuple(L), pole=tuple(Lp))
    p["ik"] = ik
    if fk:
        p.update(P_(**fk))
    return p


def _spin_feet(deg, lift_l=0.0, lift_r=0.0):
    """feet stepping round with a turn of `deg` about the body's axis (ankle offsets from the rest ankles)"""
    out = {}
    for s, sx, lift in (("L", 1.0, lift_l), ("R", -1.0, lift_r)):
        a0 = np.array([sx * 0.13, 0.02])
        c, s_ = math.cos(math.radians(deg)), math.sin(math.radians(deg))
        a1 = np.array([c * a0[0] - s_ * a0[1], s_ * a0[0] + c * a0[1]])
        d = a1 - a0
        out[f"foot.{s}"] = FootTarget((float(d[0]), float(d[1]), float(lift)), 0.0, float(deg), 0.0, 0.0, 1.0)
    return out


TWIST_OUT = -35.0                         # prop.R's twist that turns the hook from out-forward to straight out
HAT_LEVEL = 0.5                           # share of the body's pitch / roll the hat takes back (brief: the disc level)


def level(fn):
    """the hat's disc stays near level: x_hat takes back HAT_LEVEL of the summed hips..head pitch and roll (the brim
    tilts half as far as the head through bows, kneels and stuns)"""
    def sample(t):
        p = dict(fn(t))
        sx = sum(p.get(b, (0.0, 0.0, 0.0))[0] for b in ("hips", "spine", "chest", "neck", "head"))
        sz = sum(p.get(b, (0.0, 0.0, 0.0))[2] for b in ("hips", "spine", "chest", "neck", "head"))
        h = p.get("x_hat", (0.0, 0.0, 0.0))
        p["x_hat"] = (h[0] - HAT_LEVEL * sx, h[1], h[2] - HAT_LEVEL * sz)
        return p
    return sample


def clip_overrides(ctx) -> dict:
    """Brief §8: four distinct ability gestures, bespoke basics, impact at exactly 40 % of attacks / casts.
      attack1   a crook flick forward (25 f, f10)            attack2  a back-handed flick across (25 f, f10)
      cast_a1   Draw In: the crook thrust out full length, hook to the target, a hard reeling yank to the hip (30 f, f12)
      cast_a2   Crook Sweep: both hands, a low sweep along the ground from his left to his right, level at f14 (35 f)
      cast_a3   Step Through Dusk: a 3-frame cross-step, squared arrival with a salute to the hat's rim at f8 (20 f)
      cast_ult  Driving Hour: a full turn with the crook ringing round at chest height, the hook pointed and the
                butt stamped at f18, held to f30 (45 f)
    """
    skel = anim.Skeleton(ctx.info.armature)
    G = pose()
    out = {}

    def clip(name, N, keys, impact=None, loop=False, lags=None):
        fn = anim.keyed(keys)
        if lags:
            fn = anim.drag(fn, N, lags, loop=loop)
        return anim.Clip(name, N, loop, fn, impact=impact)

    def breathe(fn, amp=1.0, cycles=2, phase=0.0):
        def s(t):
            p = dict(fn(t))
            b = math.sin(2 * math.pi * (cycles * t + phase))
            p["chest"] = tuple(np.add(p.get("chest", (0, 0, 0)), (1.0 * amp * b, 0, 0)))
            p["neck"] = tuple(np.add(p.get("neck", (0, 0, 0)), (-0.6 * amp * b, 0, 0)))
            return p
        return s

    def left_at(p):
        """the left wrist's rel (chest frame, arm lengths) where a `grip` pose puts it (to unlock the grip smoothly)"""
        r = anim.resolve(skel, dict(p))
        M = skel.fk(r)
        Rc = M["chest"].to_3x3() @ skel.rest["chest"].to_3x3().inverted()
        return tuple(Rc.inverted() @ (M["hand.L"].translation - M["upper_arm.L"].translation) / ARM)

    def lantern_at(p):
        r = anim.resolve(skel, dict(p))
        M = skel.fk(r)
        return M["x_lantern"].translation.copy()

    # IDLE: upright on the crook, breathing, the free hand drifting, the lantern settling
    def idle_s(t):
        b = math.sin(2 * math.pi * 2 * t)
        s = math.sin(2 * math.pi * t)
        return pose(torso=dict(hips=(0, 0.8 * s, -0.6 * s), spine=(0.4 * b, 0, 0.4 * s), chest=(0.9 * b, 0.6 * s, 0),
                               neck=(-0.5 * b, 0, 0), head=(-0.3 * b, 1.2 * s, 0.4 * s)),
                    hips=(0.006 * s, 0, -0.003 * (0.5 + 0.5 * b)),
                    R=(GUARD_R[0], GUARD_R[1], GUARD_R[2] + 0.006 * b), Rp=POLE_R,
                    L=(GUARD_L[0] + 0.012 * s, GUARD_L[1] - 0.01 * b, GUARD_L[2]))
    out["idle"] = anim.Clip("idle", 72, True, idle_s)

    # RUN: the generator's planted gait (medium, 3.35 m/s); the crook carried across the body, leaning forward to
    # his left, the right fist on the low wrap at the hip, the left hand on the rest grip before the chest
    run = anim.gen_run(MOTION)

    def run_s(t):
        p = dict(run.sample(t))
        q = t % 1.0
        sw = math.cos(2 * math.pi * (q - 0.03))
        ik = dict(p.get("ik", {}))
        ik["hand.R"] = HandTarget(rel=(-0.10 + 0.015 * sw, -0.50 - 0.03 * sw, -0.66), pole=POLE_RF)
        ik["aim.R"] = Aim((0.40, -0.45, 0.80))
        ik["hand.L"] = HandTarget(to_prop=("prop.R", 0.0), pole=(0.8, 0.4, -0.4))
        p["ik"] = ik
        p["prop.R_loc"] = (0.0, SLIDE2, 0.0)
        return p
    out["run"] = anim.Clip("run", run.frames, True, run_s, meta=run.meta)

    # ATTACK1: a flick of the crook forward (the bolt leaves the hook at f10)
    w1 = pose(torso=dict(chest=(-3, -6, 0), head=(-2, 4, 0)), R=(-0.30, -0.30, -0.10), aim=(-0.10, 0.35, 0.93))
    h1 = pose(torso=dict(hips=(2, 6, 0), spine=(3, 5, 0), chest=(5, 8, 0), head=(-4, -6, 0)), hips=(0, -0.02, -0.01),
              R=(-0.22, -0.68, -0.12), aim=(-0.05, -0.78, 0.62), L=(0.08, -0.25, -0.92))
    f1 = pose(torso=dict(hips=(2, 7, 0), spine=(3, 6, 0), chest=(6, 9, 0), head=(-5, -7, 0)), hips=(0, -0.02, -0.012),
              R=(-0.21, -0.70, -0.15), aim=(-0.05, -0.84, 0.54), L=(0.08, -0.22, -0.93))
    out["attack1"] = anim.Clip("attack1", 25, False, anim.drag(anim.keyed(anim.strike_keys(MOTION, w1, h1, f1, G)),
                                                               25, {"head": 1.5, "neck": 1.0}), impact=0.4)
    # ATTACK2: a back-handed flick: the hook drawn out to his right, then flicked across to the front-left at f10
    k2 = [(0.0, G, "linear"),
          (0.20, pose(torso=dict(chest=(-2, -10, 0), head=(0, 6, 0)), R=(-0.40, -0.30, -0.05), aim=(-0.62, -0.10, 0.78)), "inout"),
          (0.32, pose(torso=dict(chest=(-3, -12, 0), head=(0, 8, 0)), R=(-0.42, -0.28, -0.02), aim=(-0.70, 0.05, 0.71)), "out"),
          (0.40, pose(torso=dict(hips=(2, 10, 0), spine=(3, 8, 0), chest=(5, 14, 0), head=(-3, -8, 0)), hips=(0, -0.02, -0.012),
                      R=(-0.12, -0.70, -0.12), aim=(0.48, -0.70, 0.52), L=(0.14, -0.28, -0.88)), "accel"),
          (0.50, pose(torso=dict(hips=(2, 12, 0), spine=(3, 9, 0), chest=(5, 16, 0), head=(-4, -9, 0)), hips=(0, -0.02, -0.015),
                      R=(-0.08, -0.70, -0.15), aim=(0.62, -0.62, 0.46), L=(0.14, -0.26, -0.89)), "out"),
          (0.75, pose(torso=dict(chest=(2, 4, 0)), R=(-0.28, -0.42, -0.10), aim=(0.10, -0.25, 0.96)), "inout"),
          (1.0, G, "settle")]
    out["attack2"] = clip("attack2", 25, k2, impact=0.4, lags={"head": 1.5, "neck": 1.0})

    # CAST_A1 Draw In: the crook thrust out full length, hook turned to the target (f0-f9), the hard reeling yank back
    # to the hip, the body rocking back 12 degrees and the free hand clenching (the catch at f12), follow-through as
    # the crook sweeps back (f20), guard by f30
    reach = pose(torso=dict(hips=(4, 6, 0), spine=(5, 4, 0), chest=(7, 6, 0), neck=(-4, 0, 0), head=(-6, -4, 0)),
                 hips=(0, -0.05, -0.03), R=(-0.36, -0.88, 0.02), aim=(0.10, -0.96, 0.24), slide=SLIDE2 * 0.8,
                 L=(0.10, 0.25, -0.90), feet=_feet(l=(0.0, -0.12, 0.0), yl=4.0))
    pre = pose(torso=dict(chest=(-2, -6, 0), head=(-2, 3, 0)), hips=(0, 0.01, 0.0), R=(-0.30, -0.40, 0.02),
               aim=(-0.10, -0.30, 0.95), slide=SLIDE2 * 0.4)
    catch = pose(torso=dict(hips=(-6, -8, 0), spine=(-6, -4, 0), chest=(-8, -8, 0), neck=(2, 0, 0), head=(4, 4, 0)),
                 hips=(0, 0.04, -0.03), R=(-0.30, -0.25, -0.62), aim=(-0.20, -0.62, 0.76), slide=SLIDE2 * 0.8,
                 L=(0.12, -0.40, -0.70), feet=_feet(l=(0.0, -0.12, 0.0), yl=4.0), fk=dict(hand_L=(0, 0, 22)))
    fol = pose(torso=dict(hips=(-4, -10, 0), spine=(-4, -6, 0), chest=(-5, -10, 0), head=(2, 6, 0)), hips=(0, 0.03, -0.02),
               R=(-0.34, -0.12, -0.60), aim=(-0.25, 0.15, 0.96), slide=SLIDE2 * 0.5, L=(0.12, -0.35, -0.75),
               feet=_feet(l=(0.0, -0.10, 0.0), yl=4.0), fk=dict(hand_L=(0, 0, 18)))
    k = [(0.0, G, "linear"), (0.13, pre, "inout"), (0.30, reach, "out"),
         (0.36, anim.lerp_pose_w(reach, catch, 0.25, {"hips": 0.5, "spine": 0.4, "hips_loc": 0.5}), "in"),
         (0.40, catch, "accel"), (0.50, anim.lerp_pose(catch, fol, 0.4), "out"), (0.67, fol, "out"),
         (0.85, pose(R=(GUARD_R[0], GUARD_R[1] + 0.05, GUARD_R[2]), slide=0.05), "inout"), (1.0, G, "settle")]
    out["cast_a1"] = clip("cast_a1", 30, k, impact=0.4, lags={"head": 1.0, "neck": 0.5})

    # CAST_A2 Crook Sweep: both hands (the right on the low wrap), a wide pivot from his left to his right at knee
    # height, the hook leading; the crook level at f14 (the impact, mid-sweep); guard by f35
    S = SLIDE2
    crouch = dict(l=(0.04, -0.10, 0.0), r=(-0.04, 0.08, 0.0), yl=10.0, yr=-8.0)
    # the right fist is the back hand (toward the butt), the left 0.36 m up the shaft toward the hook; the hands
    # stay before the chest as it turns (left 44 deg at the wind, right 46 at the follow), and at the level mid-sweep
    # the right fist is at the right hip so the butt passes beside it
    wind = pose(torso=dict(hips=(6, 16, 0), spine=(4, 12, 0), chest=(5, 16, 0), neck=(0, -6, 0), head=(-2, -14, 0)),
                hips=(0, 0.02, -0.10), R=(0.22, -0.55, -0.72), aim=(0.80, -0.53, -0.22), slide=S, grip=0.36,
                feet=_feet(**crouch))
    gather = pose(torso=dict(hips=(3, 8, 0), spine=(2, 6, 0), chest=(3, 8, 0), head=(-1, -6, 0)), hips=(0, 0.01, -0.05),
                  R=(0.10, -0.45, -0.70), aim=(0.55, -0.40, 0.73), slide=S * 0.7, L=left_at(wind), Lp=(0.8, 0.4, -0.4))
    hit = pose(torso=dict(hips=(8, 0, 0), spine=(6, 0, 0), chest=(7, -2, 0), neck=(-2, 0, 0), head=(-4, 2, 0)),
               hips=(0, -0.03, -0.11), R=(-0.12, -0.42, -0.80), aim=(0.12, -0.99, -0.06), slide=S, grip=0.36,
               feet=_feet(**crouch))
    fol = pose(torso=dict(hips=(6, -16, 0), spine=(5, -12, 0), chest=(6, -18, 0), neck=(0, 6, 0), head=(-2, 14, 0)),
               hips=(0, -0.02, -0.11), R=(0.20, -0.60, -0.70), aim=(-0.85, -0.48, -0.14), slide=S, grip=0.36,
               feet=_feet(**crouch))
    rel_ = pose(torso=dict(hips=(1, -6, 0), chest=(2, -5, 0), head=(-1, 4, 0)), R=(-0.30, -0.45, -0.25),
                aim=(-0.20, -0.25, 0.95), slide=S * 0.3, L=(0.18, -0.35, -0.85))
    k = [(0.0, G, "linear"), (0.17, gather, "inout"), (0.29, wind, "inout"),
         (0.34, anim.lerp_pose_w(wind, hit, 0.18, {"hips": 0.5, "spine": 0.35, "hips_loc": 0.5}), "out"),
         (0.40, hit, "accel"), (0.47, anim.lerp_pose(hit, fol, 0.45), "out"), (0.60, fol, "out"),
         (0.80, rel_, "inout"), (1.0, G, "settle")]
    out["cast_a2"] = clip("cast_a2", 35, k, impact=0.4, lags={"head": 1.0, "neck": 0.5})

    # CAST_A3 Step Through Dusk (castTime 0: 3 frames of anticipation): the crook held upright, a cross-step to his
    # left through his own shade, a squared arrival at f8 with the free hand raised to the hat's brim (the salute)
    salute = (-0.02, -0.46, 0.72)
    dip = pose(torso=dict(hips=(3, 8, -4), spine=(2, 4, 0), chest=(3, 6, 2), head=(-2, -4, 0)), hips=(0.05, -0.01, -0.06),
               R=(GUARD_R[0] + 0.03, GUARD_R[1], GUARD_R[2] - 0.04), L=(0.10, 0.05, -0.92),
               feet=_feet(l=(0.0, 0.0, 0.0), r=(0.10, -0.10, 0.06), yr=10.0, wr=1.0))
    cross = pose(torso=dict(hips=(2, 14, -2), spine=(2, 6, 0), chest=(2, 6, 0), head=(-2, -6, 0)), hips=(0.08, -0.02, -0.07),
                 R=(GUARD_R[0] + 0.04, GUARD_R[1], GUARD_R[2] - 0.03), L=(0.12, 0.0, -0.88),
                 feet=_feet(l=(0.04, 0.06, 0.03), r=(0.20, -0.08, 0.0), yl=6.0, yr=14.0))
    arrive = pose(torso=dict(hips=(0, 0, 0), spine=(-1, 0, 0), chest=(-2, 0, 0), neck=(-1, 0, 0), head=(-3, 0, 0)),
                  hips=(0, 0.0, -0.01), L=salute, Lp=(0.9, 0.25, -0.2), fk=dict(hand_L=(0, -30, 10)),
                  feet=_feet(l=(0.01, 0.0, 0.0), r=(-0.01, 0.0, 0.0)))
    hold = pose(torso=dict(spine=(-1, 0, 0), chest=(-2, 0, 0), head=(-2, 0, 0)), L=salute, Lp=(0.9, 0.25, -0.2),
                fk=dict(hand_L=(0, -30, 10)))
    k = [(0.0, G, "linear"), (0.15, dip, "out"), (0.28, cross, "linear"), (0.40, arrive, "out"), (0.58, hold, "linear"),
         (0.80, pose(L=(0.08, -0.25, -0.80)), "inout"), (1.0, G, "settle")]
    out["cast_a3"] = clip("cast_a3", 20, k, impact=0.4, lags={"head": 0.5})

    # CAST_ULT Driving Hour: the crook held out at chest height rings round him as he turns a full circle (f0-f14,
    # the herding circle, small stepping hops), then the hook points at the destination, the arm extended, the
    # lantern swinging forward, and the butt stamps down (f18); held to f30, relaxed by f45
    ring_R = (-0.62, -0.30, -0.12)
    ring_aim = (-0.92, -0.28, 0.27)

    ring = pose(torso=dict(hips=(3, 0, 0), spine=(2, 0, -3), chest=(2, 0, -4), neck=(0, 0, 2), head=(-2, 0, 3)),
                hips=(0, 0, -0.05), R=ring_R, aim=ring_aim, L=(0.30, -0.10, -0.70), Lp=(0.8, 0.3, -0.5))
    T0, T1 = 0.06, 0.35                                   # the full turn (the hips' yaw 0 -> 360, the feet stepping round)
    point = pose(torso=dict(hips=(4, 4, 0), spine=(4, 3, 0), chest=(5, 4, 0), neck=(-3, 0, 0), head=(-5, -3, 0)),
                 hips=(0, -0.05, -0.07), R=(-0.30, -0.78, -0.30), aim=(-0.04, -0.52, 0.85), slide=-0.10,
                 L=(0.25, 0.10, -0.75), feet=_feet(l=(0.0, -0.12, 0.0), r=(0.0, 0.06, 0.0), yl=4.0, yr=-6.0))
    stamp = pose(torso=dict(hips=(6, 4, 0), spine=(5, 3, 0), chest=(6, 4, 0), neck=(-4, 0, 0), head=(-6, -3, 0)),
                 hips=(0, -0.06, -0.10), R=(-0.30, -0.80, -0.40), aim=(-0.04, -0.50, 0.87), slide=-0.16,
                 L=(0.25, 0.10, -0.78), feet=_feet(l=(0.0, -0.12, 0.0), r=(0.0, 0.06, 0.0), yl=4.0, yr=-6.0))
    k = [(0.0, G, "linear"), (0.08, ring, "inout"), (0.31, ring, "linear"),
         (0.36, anim.lerp_pose_w(ring, point, 0.6, {"aim.R": 1.0}), "inout"),
         (0.40, stamp, "accel"), (0.46, point, "out"), (0.67, point, "linear"),
         (0.84, pose(R=(GUARD_R[0], GUARD_R[1] - 0.05, GUARD_R[2]), slide=-0.03), "inout"), (1.0, G, "settle")]
    ult_k = anim.keyed(k)

    def ult_s(t):
        p = dict(ult_k(t))
        u = float(np.clip((t - T0) / (T1 - T0), 0.0, 1.0))
        if 0.0 < u < 1.0:
            e = anim.ease_in_out(u)
            deg = 360.0 * e
            h = p.get("hips", (0.0, 0.0, 0.0))
            p["hips"] = (h[0], h[1] + deg, h[2])
            st = math.sin(2 * math.pi * 2.0 * e)
            ik = dict(p["ik"])
            ik.update(_spin_feet(deg, 0.05 * max(0.0, st), 0.05 * max(0.0, -st)))
            p["ik"] = ik
        elif u >= 1.0:                                     # one full turn on: the same facing, no unwinding
            h = p.get("hips", (0.0, 0.0, 0.0))
            p["hips"] = (h[0], h[1] + 360.0, h[2])
        return p
    out["cast_ult"] = anim.Clip("cast_ult", 45, False, anim.drag(ult_s, 45, {"head": 1.0}), impact=0.4)

    # DEATH: lets go of the crook (it topples across him), sags, folds at the knees and slumps forward
    hip_h = skel.rest_point("hips").z
    sway = pose(torso=dict(spine=(4, 0, 2), chest=(6, 2, 3), head=(8, 4, 4)), hips=(0, 0.02, -0.02))
    kfeet = _feet(l=(-0.06, 0.24, 0.04), r=(0.06, 0.26, 0.04), yl=4.0, yr=-6.0, pl=-60.0, pr=-60.0)
    # the fist loosens and slides down the crook as he sinks; the crook tips over and comes to rest leaning across
    # his chest to the left shoulder, its butt on the ground by his right knee
    let_go = pose(torso=dict(hips=(-2, 4, 2), spine=(6, 0, 3), chest=(8, 4, 4), neck=(6, 0, 0), head=(10, 6, 4)),
                  hips=(0.02, 0.04, -0.12), R=(-0.30, -0.42, -0.55), aim=(0.22, -0.10, 0.97), L=(0.14, -0.15, -0.88),
                  slide=0.25)
    kneel = pose(torso=dict(hips=(6, 4, 0), spine=(7, 0, 3), chest=(7, 4, 4), neck=(5, 0, 0), head=(8, 8, 6)),
                 hips=(0.02, 0.05, -(hip_h - 0.62)), R=(-0.05, -0.62, -0.72), aim=(0.40, -0.10, 0.91), L=(-0.02, -0.50, -0.80),
                 feet=kfeet, slide=0.68)
    slump = pose(torso=dict(hips=(8, 4, 0), spine=(9, 0, 3), chest=(8, 4, 5), neck=(6, 0, 0), head=(8, 10, 8)),
                 hips=(0.02, 0.07, -(hip_h - 0.60)), R=(-0.03, -0.62, -0.76), aim=(0.42, -0.08, 0.90), L=(-0.04, -0.52, -0.84),
                 feet=kfeet, slide=0.70)
    k = [(0.0, G, "linear"), (0.12, sway, "inout"), (0.30, let_go, "inout"), (0.55, kneel, "in"),
         (0.63, anim.lerp_pose(kneel, slump, 1.15), "out"), (0.80, slump, "inout"), (1.0, slump, "linear")]
    out["death"] = clip("death", 50, k)

    # RECALL: the crook lifted so the lantern hangs at eye level before him, the left hand cupped under it (loops)
    up_c = pose(torso=dict(chest=(-2, 6, 0), neck=(-2, 4, 0), head=(-2, 8, 0)), R=(-0.18, -0.70, 0.20),
                aim=(0.30, -0.25, 0.92))
    lp = lantern_at(up_c)
    cup = lp + V((0.0, 0.0, -(LAN_BASE[1] + 0.05)))
    rc = pose(torso=dict(chest=(-2, 6, 0), neck=(-2, 4, 0), head=(-2, 8, 0)), R=(-0.18, -0.70, 0.20),
              aim=(0.30, -0.25, 0.92), Lpos=tuple(cup), Lp=(0.9, 0.2, -0.3), fk=dict(hand_L=(-20, 0, 30)))

    def recall_s(t):
        p = dict(rc)
        b = math.sin(2 * math.pi * 2 * t)
        p["chest"] = (-2 + 0.8 * b, 6, 0)
        p["head"] = (-2 + 1.0 * math.sin(2 * math.pi * t), 8, 0)
        return p
    out["recall"] = anim.Clip("recall", 60, True, recall_s)

    # CHANNEL: the crook raised forward, the lantern out before him, the free hand open (loops)
    ch = pose(torso=dict(chest=(2, 3, 0), head=(-3, -2, 0)), R=(-0.20, -0.70, -0.05), aim=(-0.05, -0.40, 0.92),
              L=(0.05, -0.80, -0.30), Lp=(0.8, 0.3, -0.4))

    def channel_s(t):
        b = math.sin(2 * math.pi * 2 * t)
        return anim.add(ch, P_(chest=(1.2 * b, 0, 0), head=(-0.8 * b, 0, 0)))
    out["channel"] = anim.Clip("channel", 40, True, channel_s)

    # DASH: a low glide, the crook carried forward-up in both hands, the feet sliding (no step)
    gl = pose(torso=dict(hips=(12, 0, 0), spine=(8, 0, 0), chest=(6, 0, 0), neck=(-8, 0, 0), head=(-8, 0, 0)),
              hips=(0, -0.06, -0.07), R=(-0.10, -0.50, -0.62), aim=(0.30, -0.55, 0.78), slide=SLIDE2, grip=0.36,
              feet=_feet(l=(0.0, -0.14, 0.0), r=(0.0, 0.16, 0.0), pr=-14.0))
    out["dash"] = clip("dash", 15, [(0.0, G, "linear"), (0.25, gl, "snap"), (0.75, gl, "linear"), (1.0, G, "inout")])

    # STUNNED: clutches the crook as it wobbles, the head lolling (loops)
    st = pose(torso=dict(spine=(4, 0, 0), chest=(5, 0, 0), neck=(4, 0, 0), head=(7, 0, 0)), hips=(0, 0.02, -0.04),
              R=(-0.30, -0.35, -0.30), aim=(-0.15, -0.10, 0.98), grip=-0.40)

    def stun_s(t):
        a, b = math.sin(2 * math.pi * t), math.sin(2 * math.pi * (t + 0.25))
        p = anim.add(st, P_(hips=(0, 0, 3 * a), spine=(2 * b, 0, -2 * a), chest=(2 * b, 0, -3 * a), neck=(5 * b, 0, 5 * a),
                            head=(7 * b, 4 * a, 7 * a)))
        ik = dict(p["ik"])
        ik["aim.R"] = Aim((-0.15 + 0.12 * a, -0.10 + 0.10 * b, 0.98))
        p["ik"] = ik
        return p
    out["stunned"] = anim.Clip("stunned", 40, True, stun_s)

    # TAUNT: rattles the crook so the lantern knocks against the hook, twice, then a slow nod
    tu = pose(torso=dict(chest=(-2, -4, -2), head=(-3, 4, 0)), R=(-0.30, -0.40, 0.08), aim=(-0.10, -0.15, 0.98))
    tt = pose(torso=dict(chest=(-2, -4, -2), head=(-3, 4, 0)), R=(-0.30, -0.40, 0.04), aim=(-0.22, -0.20, 0.95))
    tt["x_lantern"] = (5.0, 0.0, 4.0)
    nod = pose(torso=dict(chest=(2, 2, 0), neck=(4, 0, 0), head=(10, 2, 0)))
    k = [(0.0, G, "linear"), (0.16, tu, "inout"), (0.24, tt, "accel"), (0.32, tu, "out"), (0.40, tt, "accel"),
         (0.52, tu, "out"), (0.72, nod, "inout"), (1.0, G, "inout")]
    out["taunt"] = clip("taunt", 45, k)

    # IDLE_LOBBY (120 f, loops): a watchful shepherd: leans on the crook with both hands stacked, lifts the lantern on
    # the hook to look into it, counts under his breath (the head nods in threes), tilts the hat's rim to the sky
    TW = dict(prop_R=(0, TWIST_OUT, 0))
    SR, SA = (-0.02, -0.60, -0.18), (-0.08, -0.10, 0.99)
    stack = pose(torso=dict(hips=(0, -4, 0), spine=(2, -2, 0), chest=(3, -2, 0), head=(2, 4, 0)), hips=(0.0, 0.0, -0.01),
                 R=SR, aim=SA, grip=0.07, fk=TW)
    look = pose(torso=dict(chest=(-2, -4, 0), neck=(-4, -6, 0), head=(-8, -14, 0)), R=(-0.20, -0.60, 0.12),
                aim=(-0.20, -0.30, 0.93), L=(0.10, -0.40, -0.70), fk=TW)
    nod = lambda a: pose(torso=dict(hips=(0, -4, 0), spine=(2, -2, 0), chest=(3, -2, 0), neck=(2 + a, 0, 0), head=(4 + 2 * a, 4, 0)),
                         hips=(0.0, 0.0, -0.01), R=SR, aim=SA, grip=0.07, fk=TW)  # noqa: E731
    sky = pose(torso=dict(hips=(0, -2, 0), spine=(-2, 0, 0), chest=(-4, 0, 0), neck=(-8, 0, 0), head=(-16, 4, 0)),
               R=SR, aim=SA, grip=0.07, fk=TW)
    k = [(0.0, stack, "linear"), (0.10, stack, "linear"), (0.20, look, "inout"), (0.32, look, "linear"),
         (0.40, stack, "inout"), (0.46, nod(6), "inout"), (0.50, nod(0), "inout"), (0.54, nod(6), "inout"),
         (0.58, nod(0), "inout"), (0.62, nod(6), "inout"), (0.66, stack, "inout"), (0.76, sky, "inout"),
         (0.88, sky, "linear"), (1.0, stack, "inout")]
    out["idle_lobby"] = anim.Clip("idle_lobby", 120, True, breathe(anim.keyed(k), 0.8, 4))

    # VICTORY (60 f, ends in a hold): plants the crook, lifts the lantern high on the hook, then bows deeply from the
    # waist with the left hand on the hat's brim, the crook upright beside him: a shepherd's bow to the flock
    plant = pose(torso=dict(chest=(-2, 0, 0)), R=(GUARD_R[0], GUARD_R[1], GUARD_R[2] - 0.08), aim=UP, hips=(0, 0, -0.01),
                 fk=dict(prop_R=(0, TWIST_OUT * 0.5, 0)))
    lift = pose(torso=dict(spine=(-3, 0, 0), chest=(-6, -4, 0), neck=(-4, 0, 0), head=(-10, -6, 0)),
                R=(-0.30, -0.36, 0.60), aim=(-0.22, -0.08, 0.97), L=(0.20, -0.20, -0.70), fk=dict(prop_R=(0, TWIST_OUT, 0)))
    brim = (0.04, -0.62, 0.50)
    bow = pose(torso=dict(hips=(14, 0, 0), spine=(10, 0, 0), chest=(8, 0, 0), neck=(2, 0, 0), head=(0, 0, 0)),
               hips=(0, 0.06, -0.02), R=(-0.42, -0.42, -0.22), aim=(-0.06, -0.05, 1.0), L=brim, Lp=(0.9, 0.2, -0.3),
               fk=dict(hand_L=(0, -20, 10), prop_R=(0, TWIST_OUT, 0)))
    k = [(0.0, G, "linear"), (0.14, plant, "inout"), (0.30, lift, "inout"), (0.45, lift, "linear"),
         (0.62, anim.lerp_pose(lift, bow, 0.5), "inout"), (0.80, bow, "out"), (1.0, bow, "linear")]
    vic = anim.keyed(k)

    def vic_s(t):
        p = dict(vic(t))
        if t > 0.82:
            b = math.sin(2 * math.pi * 1.5 * t)
            p["chest"] = tuple(np.add(p["chest"], (0.6 * b, 0, 0)))
        return p
    out["victory"] = anim.Clip("victory", 60, False, vic_s)
    for c in out.values():
        c.sample = level(c.sample)
    return out


if __name__ == "__main__":
    fighter.main(sys.modules[__name__])
