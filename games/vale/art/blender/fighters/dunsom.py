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
    the mask's short rounded bill (1.5 cm proud, owner ruling 5) marks the front; the lantern is octagonal (0.19 m across, 0.41 m with its cupola
    and base: the painted 0.16 m lantern measured 0.3 % accent) with its four cardinal panes and a glass cupola
    glowing azure (the `accent`, ~1.9 % at the game camera: the painted blue centre pane between amber lampresin
    panes, seen from every side and from above); it hangs on one pendulum bone x_lantern (<= 6 degrees off plumb).
  * the crook is 6 cm thick (brief), the hat's game mesh a clean lathe (hat_low), the hat on x_hat taking back half
    the body's pitch / roll (the disc stays near level), the boots, trousers, hat, crook, lantern and gloves paint
    procedurally (the projection sampled the floor round the painted boots and cannot see the hat's top).

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
from common import bake as _bake, mesh as _mesh, pipeline as _pipeline  # noqa: E402
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

# THE CROOK (prop.R): the butt beside the right boot, the shaft through the fist, the hook curling out-forward.
# Fix pass 1 (review: a lumpy rope / candy-cane crook, the hook only 0.11 m over the hat, the lantern under the HP
# bar): pale carved wood in long faceted planes (FacetTube: a 7-sided section, slowly twisting, a knuckle at every
# joint) with a few gnarled kinks under an ANGULAR hook (straight carved runs between hard turns, as painted), and the
# brief's height: the hook's top 2.56 m (0.5 m over the hat's crown), the lantern hanging above the brim (1.95-2.31 m)
BUTT = np.array([-0.375, -0.085, 0.0])
CROOK_U = unit(GRIP - BUTT)
S_BUTT = -float(np.linalg.norm(GRIP - BUTT))       # the butt's place along the shaft (m from the grip)
S_TOP = 1.050                                      # where the shaft turns into the hook (z ~2.37)
SHAFT_R = 0.030                                    # 6 cm (brief: 6 cm, 5 px at 1080p)
HOOK_R = 0.034                                     # the hook ~7 cm (brief)
HOOK_YAW = 40.0                                    # the hook's plane: out (his right) turned 40 degrees to the front
GRIPS = ((-0.09, 0.12), (-0.46, -0.27))            # the leather wraps: the rest grip, the low grip (two-handed holds)
SLIDE2 = 0.365                                     # slide that puts the right fist on the low wrap


def crook_at(s):
    return GRIP + CROOK_U * s


def _hook_frame():
    h = np.array([-math.cos(math.radians(HOOK_YAW)), -math.sin(math.radians(HOOK_YAW)), 0.0])
    h = unit(h - CROOK_U * h.dot(CROOK_U))
    return h, CROOK_U


# the hook (out along h, up along the shaft, sideways): straight carved runs between hard turns, a squared shoulder,
# a flat-ish top and a tip that comes down to the lantern's ring
HOOK_PTS = [(0.000, -0.050, 0.000), (0.000, 0.000, 0.000), (-0.007, 0.104, 0.004), (0.038, 0.166, 0.000),
            (0.110, 0.192, -0.004), (0.172, 0.168, 0.003), (0.212, 0.108, 0.000), (0.217, 0.030, 0.000)]
HOOK_K = 1.0


def hook_pts():
    h, u = _hook_frame()
    side = unit(np.cross(u, h))
    top = crook_at(S_TOP)
    return [top + h * a * HOOK_K + u * b + side * c for a, b, c in HOOK_PTS]


HOOK_TIP = hook_pts()[-1]
HANG = HOOK_TIP - np.array([0.0, 0.0, 0.050])      # the lantern's pivot: the bottom of the ring through the tip
HOOK_TOP = hook_pts()[4]

# THE LANTERN (on x_lantern, hanging straight down from HANG at rest), as painted: a carved dark-wood octagon (a
# solid wooden cap with a chimney collar and a two-strut bail, a flared eave, banded frame, eight posts, a tapered base) round
# warm amber lampresin panes (the larger share of every pane), the cold azure core showing through a narrow lancet
# window in the middle of each pane ('warm lantern, cold heart') and up through the open chimney, so the team colour
# reads from the 52 degree game camera at every facing (the gate: 1.5-6 % of the silhouette)
# Fix pass 2 (review: each pane a wide azure lancet with amber only at the corners, the vents glowing blue: a BLUE
# lantern, blue:amber 7.4:1 against the concept's 0.46:1): warm amber panes dominate (the lancet window is ~45 % of a
# pane), the cap is solid carved wood (no blue vents), and the cold core shows from above through an open chimney
# collar on the cap (the 52 degree game camera's view), so the accent gate holds with amber dominant from the side
LAN_A = 0.120                                      # body apothem (the bands' faces): 0.24 m across
LAN_GLASS = 0.112
LAN_ROOF = (0.062, 0.112, 0.134, 0.104)            # the cap: top / eave below HANG, eave / top apothems
LAN_EAVE = (0.108, 0.126, 0.136)                   # the eave lip: top / bottom below HANG, apothem
LAN_BODY = (0.138, 0.406)                          # the panes: from / to below HANG (0.27 m)
LAN_BASE = (0.420, 0.456)
WIN_W, WIN_LO, WIN_SPRING, WIN_TOP = 0.0195, 0.386, 0.212, 0.176  # the lancet: half width, bottom / spring / apex
CHIM = (0.084, 0.098, 0.018, 0.014)                # the chimney collar: inner / outer r, height over the cap, glow recess
# (SDF estimate, scratchpad lantern_est: level views blue:amber 0.62 (was 5.7), the 52 degree camera's accent 250 cm2
# (was 357 = the measured 2.52 %): ~1.75 %; the recessed chimney glow is hidden below ~8 degrees of elevation, so the
# portrait / splash / front views see amber panes with a blue heart)
POST_R = 0.0075                                    # the eight corner posts (were 1 cm: they hid a third of each pane)


def lan_z(dz):
    return HANG[2] - dz


# ── the hat, the head (painted placement: the mask's centre is 1.7 cm right of the axis) ──────────────────
MX = -0.017                                        # the mask's centre line (as painted)
SLOT_X = 0.047                                     # the coat's front opening: centre at x -SLOT_X (as painted)
KX = -0.006                                        # the bill's centre line (the painted nose tile's)
HAT_C = np.array([0.0, 0.012])               # on the mirror plane (the symmetric decimate left pinholes off it)
HAT_R, HAT_EDGE, HAT_RISE, HAT_T = 0.355, 1.946, 0.095, 0.026
# fix pass 1: the felt is 3.6 cm at the edge (brief: 4 cm with bevels) and thickens toward the crown (the underside
# rises less than the top): the 2.6 cm shell's underside z-fought its top through the double-sided material in
# three's depth buffer (the 1-px dark specks on the disc from the game camera)
HAT_TE, HAT_TC = 0.036, 0.055       # thickness at the edge, + extra toward the crown (5-7 cm mid-radius)
HAT_BAND = (0.300, 0.334)           # the stitched edge band (r from / to)


def hat_top(r):
    u = np.clip(r / HAT_R, 0.0, 1.0)
    return HAT_EDGE + HAT_T * 0.5 + HAT_RISE * (1.0 - u ** 1.3)


def hat_thick(r):
    u = np.clip(r / HAT_R, 0.0, 1.0)
    return HAT_TE + HAT_TC * (1.0 - u) ** 1.2


def hat_under(r):
    return hat_top(r) - hat_thick(r)


MATERIAL_SET = "bible"
PALETTE = materials.bible_palette(cloth2="#CAC5D4", sandstone="#C28C44", wood="#ADA090", wood_dark="#5A3E31",
                                  cloth="#7D7185", lampresin="#C9954E", leather="#42322E", under="#2B2328",
                                  ironstone="#444048", ink="#17181B", accent="#3F9CFF")
VALUE_GRADIENT_STOPS = materials.BIBLE_GRADIENT_STOPS
SOCKETS = {"weapon": "prop.R", "weapon_tip": "x_crook_hook", "lantern": "x_lantern", "ferrule": "x_crook_foot"}
# fix pass 1: the splash's warm / cool rim kickers (1500 W x 1.6^2, grazing from behind) blew the dark boots' tops to
# cream and the toe caps to white, and frosted the shoulders: half strength for this figure
# (final parity client F3: fill 0.84 -> 0.90, the figure at 0.81 of the splash's height, 0.68 of W2's loading card)
SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92, "fill": 0.90, "yaw": 24.0, "portrait_yaw": 24.0,
          "icon_yaw": 14.0, "rim_cool": 0.5, "rim_warm": 0.5}
TEXTURE_SIZE = 2048
TEXTURE_SIZES = {"normal": 512, "orm": 512}      # orm 256 left tiny hat islands' AO dark (specks in three)
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


# owner ruling 5 (owner_rulings.md, integration pass): the beak keel (3.4 cm proud, growing from the brow down into
# the scarf: fullest at its lower end) read as a plague-doctor beak at chip, portrait and splash size. It is now a
# short rounded bill: a soft dome under the brow, 6.2 cm from its root between the eyes to a round tip well above the
# scarf (the mask's eye-to-chin height is 12.5 cm: eye centre z 1.840, chin z 1.715), 1.5 cm proud at its fullest
# and narrowing toward the root. It still marks the front (the facing cue) and adds nothing below z 1.788.
BILL_ROOT, BILL_TIP = 1.850, 1.788       # z of the bill's root (between the eyes, under the brow) and its round tip
BILL_OUT = 0.015                         # how far it stands proud at its fullest (m)
BILL_HW = 0.0165                         # half-width at its fullest (m)
BILL_FULL = 0.42                         # where it is fullest: fraction of the way from the tip to the root


def bill(x, z):
    """the short rounded bill's forward relief (m): an elliptic dome, rounded at the root, the sides and the tip"""
    zc = BILL_TIP + (BILL_ROOT - BILL_TIP) * BILL_FULL
    hz = np.where(z >= zc, BILL_ROOT - zc, zc - BILL_TIP)
    hw = BILL_HW * (0.80 + 0.20 * ss(BILL_ROOT, zc, z))
    d2 = ((x - KX) / hw) ** 2 + ((z - zc) / hz) ** 2
    return BILL_OUT * np.clip(1.0 - d2, 0.0, 1.0) ** 0.6


def mask_relief(P):
    """forward relief (m) on the mask: tiles pillowed between the painted cracks, the cracks cut in, the almond eye
    recesses, a brow shelf over the eyes and the short rounded bill under the brow (the facing cue)"""
    x, z = P[:, 0], P[:, 2]
    tile = face_map("tile", x, z)
    crack = face_map("crack", x, z)
    eye = face_map("eye", x, z)
    r = 0.0026 * ss(0.0, 1.0, tile) - 0.0042 * crack
    r = r - 0.020 * eye
    brow = ss(1.852, 1.866, z) * ss(1.912, 1.890, z) * (1 - ss(0.095, 0.118, np.abs(x - MX)))
    r = r + 0.006 * brow
    r = r + bill(x, z) * (1 - eye)
    return r + 0.0012 * NOISE(P, 40.0)


def finger_pts(C, a, f, out, i, s=HS, curl=1.0):
    """finger i (0 pinky .. 3 index) of a curled hand: knuckle K, middle joint M, tip T, radius. curl 1 = a fist
    round a shaft at C (Vashil's), 0.55 = a relaxed hand (an open C)"""
    o = 1.0 - curl
    sp = (i - 1.5) * 0.0245 * s
    rr = (0.0108 if i else 0.0097) * s ** 0.85         # fix pass 1: ~3 mm gaps between the fingers (were touching slabs)
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


def glove(name, C, a, f, out, bind, tris, curl=1.0, grip=True, s=HS, relaxed=False):
    """A gloved hand with sculpted fingers (no mitten block): C the centre of the fingers' curl (the shaft's axis for
    a grip), a the knuckle line (pinky -> index), f the forearm direction, out the back of the hand.
    relaxed (fix pass 2, the hanging left hand; review: 'a thin twig-like claw, a mushroom-cap cuff over a skinny
    palm with bent tube fingers'): a fuller palm and back, fingers 12 % thicker and a little more spread, and a cuff
    of the palm's own oval section blending into it (no flared disc with a rolled edge)"""
    C, a, f, out = fist_frame(C, a, f, out)
    S = Sculpt(name)
    ax = np.stack([a, f, out])
    fs = 1.12 if relaxed else 1.0
    # fix pass 1 (review: four stacked finger slabs, a paddle): a narrower palm with a domed back, raised knuckles, a
    # joint bump on every finger, gaps between the fingers, and a thumb that wraps over the index finger's middle
    # joint (a fist round the crook) or lies along it (the relaxed hand)
    if relaxed:
        S.add(RoundBox(C - f * 0.034 * s + out * 0.008 * s, (0.046 * s, 0.044 * s, 0.024 * s), 0.016 * s, axes=ax), k=0.0)
        S.add(Ellipsoid(C - f * 0.036 * s + out * 0.024 * s, (0.042 * s, 0.042 * s, 0.013 * s), axes=ax), k=0.012)
    else:
        S.add(RoundBox(C - f * 0.032 * s + out * 0.010 * s, (0.044 * s, 0.040 * s, 0.020 * s), 0.015 * s, axes=ax), k=0.0)
        S.add(Ellipsoid(C - f * 0.034 * s + out * 0.024 * s, (0.040 * s, 0.038 * s, 0.010 * s), axes=ax), k=0.010)
    for i in range(4):
        K, M, T, rr = finger_pts(C, a, f, out, i, s, curl)
        if relaxed:
            spread = a * ((i - 1.5) * 0.0030 * s)
            K, M, T, rr = K + spread * 0.5, M + spread, T + spread * 1.4, rr * fs
        S.add(Sphere(K + out * 0.007 * s, rr + 0.0045), k=0.004)                     # the knuckle
        S.add(Tube([K, M, T], [rr + 0.0010, rr + 0.0004, rr * 0.86], k=0.003), k=0.003)
        S.add(Sphere(M + unit(M - C) * 0.004, rr + 0.0012), k=0.003)                 # the middle joint
    o = 1.0 - curl
    tb = C - f * 0.034 * s - out * 0.018 * s + a * 0.046 * s
    tm = C + f * 0.006 * s - out * (0.034 - 0.006 * o) * s + a * (0.050 + 0.004 * o) * s
    tt = C + f * (0.040 + 0.010 * o) * s - out * (0.016 + 0.004 * o) * s + a * (0.034 + 0.010 * o) * s
    S.add(Tube([tb, tm, tt], [0.0150 * s * fs, 0.0128 * s * fs, 0.0105 * s * fs], k=0.004), k=0.008)
    S.add(Sphere(tm, 0.0135 * s * fs), k=0.004)                                      # the thumb's joint
    if relaxed:
        # the cuff: the palm's oval section (wide across the knuckle line, flat through the hand) from inside the
        # sleeve's opening down into the palm, one smooth form
        S.add(FlatCapsule(C - f * 0.112 * s, C - f * 0.050 * s, 0.035 * s, 0.025 * s, 0.040 * s, 0.027 * s, side=a), k=0.016)
    else:
        # the glove's flared gauntlet cuff over the wrist, a rolled edge
        S.add(RoundCone(C - f * 0.104 * s, C - f * 0.054 * s, 0.033 * s, 0.031 * s), k=0.010)      # (inside the sleeve's 5 cm
        S.add(Torus(C - f * 0.100 * s, 0.033 * s, 0.0042 * s, axes=sdf.frame(f)), k=0.004)       # opening: no ball at the wrist)
    if grip:
        S.sub(Capsule(C - a * 0.15, C + a * 0.15, SHAFT_R + 0.004), k=0.003)
    S.ops = [(op, prim.displaced(felt(0.0006, 60.0), 0.0006) if op == "add" else prim, k, tg) for op, prim, k, tg in S.ops]
    return (name, S, 0.45, "sandstone", bind, tris, 2.0)


HAND_R_FRAME = fist_frame(GRIP, CROOK_U, FO_R, np.cross(FO_R, CROOK_U))
C_L = W_L + FO_L * 0.072 * HS / 1.35 + np.array([0.0, -0.004, 0.0])
# fix pass 2: the hanging hand turned 35 degrees so the back of the hand faces out-FRONT (as painted: the knuckles
# and the thumb read from the front, not the hand's edge); the two-handed grips are unchanged (prop.L turns with it)
HAND_L_FRAME = fist_frame(C_L, (-0.574, -0.819, 0.0), FO_L, (0.819, -0.574, 0.0))
LEFT_CURL = 0.74                                   # a loose curl: hangs relaxed, still wraps the crook in the grips


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


class FacetTube(Prim):
    """A carved polyline: every segment an n-sided prism (flat carved planes, not a round tube) whose facets turn
    slowly along the length (parallel transported + a small random twist at each joint), each segment overshooting
    its ends by `ext` x its radius so the turns close into angular knuckles. radii per point."""

    def __init__(self, pts, radii, n=7, twist=0.5, seed=3, jitter=0.06, ext=0.85, ref=(0.0, 0.0, 1.0)):
        self.pts = [np.asarray(p, float) for p in pts]
        self.radii = [float(r) for r in radii]
        rng = np.random.default_rng(seed)
        self.segs = []
        e1 = None
        acc = 0.0
        for i in range(len(self.pts) - 1):
            a, b = self.pts[i], self.pts[i + 1]
            u = unit(b - a)
            L = float(np.linalg.norm(b - a))
            if e1 is None:
                r0 = np.asarray(ref, float)
                if abs(r0 @ u) > 0.9:
                    r0 = np.array([1.0, 0.0, 0.0])
                e1 = unit(r0 - u * (r0 @ u))
            else:
                e1 = unit(e1 - u * (e1 @ u))
            e2 = np.cross(u, e1)
            acc += twist * L + float(rng.uniform(-0.12, 0.12))
            th = acc + 2 * math.pi * np.arange(n) / n + rng.uniform(-0.16, 0.16, n)
            N = np.cos(th)[:, None] * e1[None, :] + np.sin(th)[:, None] * e2[None, :]
            sc = 1.0 + rng.uniform(-jitter, jitter, n)
            self.segs.append((a, u, L, self.radii[i], self.radii[i + 1], N, sc))
        self.ext = ext
        self.pad = 0.0

    def bounds(self):
        P = np.array(self.pts)
        r = max(self.radii) * 1.6
        return P.min(0) - r, P.max(0) + r

    def d(self, P):
        d = np.full(len(P), 1e3)
        for a, u, L, ra, rb, N, sc in self.segs:
            q = P - a
            s = q @ u
            t = np.clip(s / L, 0.0, 1.0)
            r = ra + (rb - ra) * t
            qp = q - s[:, None] * u[None, :]
            poly = np.max(qp @ N.T - r[:, None] * sc[None, :], axis=1)
            e = self.ext * max(ra, rb)
            cap = np.maximum(-s - e, s - L - e)
            d = np.minimum(d, np.maximum(poly, cap))
        return d


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
        th = hat_thick(r)
        zm = zt - th * 0.5
        shell = np.abs(z - zm) - th * 0.5
        d = smax(shell, r - HAT_R, 0.016)
        crown = np.maximum(np.maximum(r - 0.168, 1.958 - z), z - zt)
        d = np.minimum(d, crown)
        # the stitched edge band: a felt strip 3.4 cm wide laid round the top just inside the edge (a 1.8 mm step at
        # each side), a soft seam ring round the crown
        band = 0.0018 * ss(HAT_BAND[0] - 0.003, HAT_BAND[0] + 0.002, r) * (1 - ss(HAT_BAND[1] - 0.002, HAT_BAND[1] + 0.003, r))
        seam = -0.0012 * np.exp(-((r - 0.172) / 0.004) ** 2)
        return (d - (band + seam) * (z > zm)) * 0.93
    hat = Sculpt("hat")
    hat.add(Lathe((HAT_C[0], HAT_C[1], 0.0), hat_prof, HAT_R + 0.01, 1.90, 2.08), k=0.0)
    hat.add(Sphere((HAT_C[0], HAT_C[1], 2.032), 0.026), k=0.03)
    part("hat", hat, "cloth2", "bone:x_hat", 2800, 0.6, uvw=1.5)

    # HOOD: a lavender column from under the hat to the scarf, framing the mask (the painted outline cut out in
    # front, a rolled edge round it); rigid on the head above the chin, blending to the neck and chest below
    # fix pass 1: a TAPERED cowl (the concept's back view), not a straight column: narrow under the crown, flaring
    # to the shoulders, a soft centre-back crease and two folds falling into the scarf
    # fix pass 2 (review: still a near-straight column from behind, 0.27 m under the brim / 0.33 m over the scarf
    # against the concept's 0.20 / 0.35, and a flat-topped 'stovepipe' with the hat off in the death): a lofted cowl
    # (super-ellipse sections) narrow under the brim and flaring into the scarf, a rounded crown over the skull (inside
    # the hat's crown in play), and a face frame that follows the painted mask outline (+2 cm) so the mask's width
    # sets the hood only round the face (1.4 cm margin + a 1 cm rolled edge)
    hood = Sculpt("hood")
    hz = np.array([1.56, 1.64, 1.70, 1.74, 1.78, 1.82, 1.86, 1.90, 1.93, 1.96, 1.99])
    hxs = np.array([0.170, 0.164, 0.154, 0.148, 0.141, 0.132, 0.123, 0.113, 0.105, 0.098, 0.090])
    hys = np.array([0.160, 0.156, 0.150, 0.148, 0.146, 0.142, 0.137, 0.130, 0.123, 0.114, 0.100])
    hyc = np.array([0.027, 0.024, 0.022, 0.020, 0.018, 0.016, 0.015, 0.014, 0.013, 0.012, 0.012])

    def cowl(P):
        y, z = P[:, 1], P[:, 2]
        x = P[:, 0] - MX * (1 - ss(-0.05, 0.10, y) * ss(1.74, 1.80, z))   # the back half above the scarf centred under
                                                                           # the hat (the front and the scarf's on the mask)
        hx, hy, yc = np.interp(z, hz, hxs), np.interp(z, hz, hys), np.interp(z, hz, hyc)
        e = 2.6
        r = (np.abs(x / hx) ** e + np.abs((y - yc) / hy) ** e) ** (1.0 / e)
        return np.maximum((r - 1.0) * np.minimum(hx, hy), np.maximum(1.56 - z, z - 1.97))
    hood.add(Fn(cowl, (MX - 0.20, -0.18, 1.54), (MX + 0.20, 0.21, 1.99)).displaced(cloth_noise(0.003, 8.0), 0.003), k=0.0)
    hood.add(Ellipsoid((MX, 0.012, 1.950), (0.097, 0.113, 0.058)), k=0.025)            # the rounded crown

    def frame(P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        return np.maximum(face_sd(x, z) - 0.014, np.maximum(mask_front(x, z) + 0.006 - y, y - 0.0))
    hood.add(Fn(frame, (MX - 0.17, -0.20, 1.66), (MX + 0.17, 0.02, 1.98)), k=0.014)

    def hood_pt(z, ang, inset=0.003):
        hx, hy, yc = float(np.interp(z, hz, hxs)), float(np.interp(z, hz, hys)), float(np.interp(z, hz, hyc))
        a = math.radians(ang)
        s_, c_ = math.sin(a), math.cos(a)
        r = 1.0 / ((abs(s_) ** 2.6 + abs(c_) ** 2.6) ** (1 / 2.6))
        y_ = yc + hy * c_ * r - inset * c_
        return (MX * (1 - float(ss(-0.05, 0.10, y_) * ss(1.74, 1.80, z))) + hx * s_ * r - inset * s_, y_, z)
    hood.add(Tube([hood_pt(1.93, 0), hood_pt(1.80, 0), hood_pt(1.69, 0)], [0.007, 0.010, 0.011], k=0.01), k=0.025)
    for sx in (-1, 1):                                                    # soft folds falling into the scarf
        hood.add(Tube([hood_pt(1.88, 38 * sx, 0.004), hood_pt(1.77, 42 * sx, 0.004), hood_pt(1.68, 46 * sx, 0.005)],
                      [0.006, 0.009, 0.009], k=0.01), k=0.03)

    def opening(P):
        return np.maximum(face_sd(P[:, 0], P[:, 2]) - 0.006, P[:, 1] + 0.030)
    hood.sub(Fn(opening, (MX - 0.16, -0.30, 1.62), (MX + 0.16, -0.02, 1.98)), k=0.010)

    def rim(P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        d2 = face_sd(x, z) - 0.008
        yf = mask_front(x, z) + 0.004
        return np.maximum(np.hypot(d2, (y - yf) * 1.3) - 0.0095, 1.70 - z)
    hood.add(Fn(rim, (MX - 0.20, -0.22, 1.66), (MX + 0.20, 0.02, 1.98)), k=0.010)
    part("hood", hood, "cloth", ("weights", "hood"), 1600, uvw=1.4)

    # MASK: the carved ochre face, its outline, tiles, cracks and eyes read from the painting
    def mask_d(P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        sd2 = face_sd(x, z) + 0.002
        yf = mask_front(x, z) - mask_relief(P)
        d = smax(sd2, (yf - y) * 0.9, 0.006)
        return np.maximum(np.maximum(d, y - 0.03), 1.665 - z)
    mask = Sculpt("mask")
    mask.add(Fn(mask_d, (MX - 0.15, -0.20, 1.66), (MX + 0.15, 0.04, 1.97)), k=0.0)
    part("mask", mask, "sandstone", "bone:head", 1800, 0.42, uvw=3.0)

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
    # (fix pass 1: no tail down the back: the concept's back view shows the wrap only; the tail painted as white drips)
    scarf.ops = [(op, prim.displaced(cloth_noise(0.004, 9.0), 0.004) if op == "add" else prim, k, tg)
                 for op, prim, k, tg in scarf.ops]
    part("scarf", scarf, "cloth2", ("weights", "scarf"), 1500, uvw=1.3)

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
    part("coat_top", top, "cloth", ("weights", "torso"), 1200)

    # BELT (fix pass 1: was a round hose with toggle-like sides): a flat leather strap 4.8 cm tall, 1.1 cm thick,
    # laid on the coat's waist ellipse, a rectangular frame buckle at the front and the strap's end hanging from it
    BY = 0.735                                                      # the waist ellipse's depth / width

    def belt_d(P):
        x, y, z = P[:, 0], (P[:, 1] - 0.026) / BY, P[:, 2]
        r = np.hypot(x, y)
        q0 = np.abs(r - 0.1885) - (0.0055 - 0.002)
        q1 = np.abs(z - 1.250) - (0.024 - 0.002)
        d = np.hypot(np.maximum(q0, 0), np.maximum(q1, 0)) + np.minimum(np.maximum(q0, q1), 0) - 0.002
        return d * BY
    belt = Sculpt("belt")
    belt.add(Fn(belt_d, (-0.22, -0.15, 1.21), (0.22, 0.20, 1.29)).displaced(chips(0.0008, 30.0), 0.0008), k=0.0)
    # the strap's end: through the buckle, hanging 9 cm down the front, a little to his left
    belt.add(RoundBox((0.040, -0.123, 1.206), (0.016, 0.0035, 0.046), 0.003,
                      axes=sdf.axes_from_rot(_rot((0, 0, 1), -6.0) @ _rot((0, 1, 0), 5.0))), k=0.003)
    part("belt", belt, "leather", ("weights", "belt"), 500, 0.6)
    buckle = Sculpt("buckle")
    buckle.add(RoundBox((-0.004, -0.126, 1.250), (0.030, 0.0045, 0.029), 0.004), k=0.0)
    buckle.sub(RoundBox((-0.004, -0.126, 1.250), (0.019, 0.012, 0.018), 0.003), k=0.002)
    buckle.add(RoundBox((-0.004, -0.124, 1.250), (0.021, 0.004, 0.020), 0.002), k=0.0)       # the strap in the frame
    buckle.add(Capsule((-0.004, -0.131, 1.234), (-0.004, -0.131, 1.266), 0.0035), k=0.002)   # the pin
    part("buckle", buckle, "wood_dark", ("weights", "belt"), 200, 0.4)

    skirt = Sculpt("skirt")
    f1 = FlatCapsule((0.0, 0.025, 1.235), (0.0, 0.030, 0.80), 0.182, 0.135, 0.228, 0.165, side=(1, 0, 0))
    f2 = FlatCapsule((0.0, 0.030, 0.82), (0.0, 0.040, 0.30), 0.228, 0.165, 0.285, 0.205, side=(1, 0, 0))
    fold = folds_ang(0.010, 9, zfade=(1.15, 0.70))
    deep = folds_ang(0.018, 4, zfade=(1.10, 0.55), phase=0.6)
    skirt.add(f1.displaced(lambda P: fold(P) + deep(P), 0.028), k=0.0)
    skirt.add(f2.displaced(lambda P: fold(P) + deep(P), 0.028), k=0.10)
    skirt.inter(HalfSpace((0, 0, 0.300), (0, 0, -1), 2.0), k=0.006)
    skirt.inter(HalfSpace((0, 0, 1.24), (0, 0, 1), 2.0), k=0.006)

    # fix pass 2 (review: the coat front read closed, a uniform skirt with a faint seam): the slot sits where the
    # concept paints it (centre x -0.047, 1.4 cm wide under the belt, 10 cm at the hem; it was 2.7 cm off, so the
    # under-robe sampled the painted coat and the tone clamp painted it lavender) over a dark under-robe panel
    def slot(P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        hw = 0.008 + 0.046 * ss(1.15, 0.34, z)
        # (fix pass 2: was -(y + 0.055): the cut lay INSIDE the skirt's solid, behind the front, and never opened it;
        # the dark slot the old renders showed was painted on the closed skirt, and the tone clamp flattened it)
        return np.maximum(np.maximum(np.abs(x + SLOT_X) - hw, y + 0.055), z - 1.205)
    skirt.sub(Fn(slot, (-0.12, -0.40, 0.2), (0.08, 0.0, 1.22)), k=0.008)
    skirt.add(Fn(lambda P: np.hypot(np.hypot(P[:, 0] / 0.287, (P[:, 1] - 0.040) / 0.207) * 0.25 - 0.25, P[:, 2] - 0.312) - 0.009,
                 (-0.32, -0.20, 0.28), (0.32, 0.27, 0.34)), k=0.006)
    skirt.sub(Fn(slot, (-0.12, -0.40, 0.2), (0.08, 0.0, 1.22)), k=0.006)
    part("skirt", skirt, "cloth", ("weights", "skirt"), 2150)

    # fix pass 1 (review: dark ragged blotches on the coat in strides, kneels and the bow): the full under-robe and the
    # trousers' knees poked through the skirt wherever the legs move it (its side verts blend the thighs differently):
    # the under-robe is now only the dark panel behind the front opening, 2.5 cm inside the skirt everywhere
    under = Sculpt("under_robe")
    under.add(FlatCapsule((-SLOT_X, -0.035, 1.21), (-SLOT_X, -0.050, 0.36), 0.060, 0.050, 0.105, 0.088, side=(1, 0, 0)), k=0.0)
    under.inter(HalfSpace((0, 0, 0.33), (0, 0, -1), 2.0), k=0.004)
    part("under_robe", under, "under", ("weights", "skirt"), 260)

    legs = Sculpt("trousers")
    for sx in (-1, 1):
        legs.add(FlatCapsule((sx * 0.128, 0.022, 0.33), (sx * 0.130, 0.020, 0.15), 0.057, 0.059, 0.054, 0.056, side=(1, 0, 0))
                 .displaced(cloth_noise(0.002, 10.0), 0.002), k=0.0)       # (fix pass 1: only what shows under the hem)
    part("trousers", legs, "under", ("weights", "trousers"), 180, 0.8)

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
    out.append(glove("hand_R", *HAND_R_FRAME, "bone:hand.R", 1050, curl=1.0, grip=True))
    out.append(glove("hand_L", *HAND_L_FRAME, "bone:hand.L", 1000, curl=LEFT_CURL, grip=False, relaxed=True))

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
    part("boots", boots, "under", ("weights", "boots"), 950)      # matte (waxed leather caught the sky in the splash)
    part("toecaps", caps, "ironstone", ("weights", "boots"), 220, 0.6)

    out.extend(crook_parts())
    out.extend(lantern_parts())
    return out


# shaft knots: (s along the shaft, offset along h, offset sideways, radius): straight and even under the two wraps
# (the hands' grip channels), a few gnarled kinks and knots above the rest grip, as painted
SHAFT_KNOTS = [(None, 0.0, 0.0, 0.0275), (-1.10, 0.003, -0.002, 0.029), (-0.82, -0.003, 0.004, 0.030),
               (-0.57, 0.0, 0.0, 0.030), (-0.17, 0.0, 0.0, 0.030), (0.22, 0.0, 0.0, 0.030), (0.44, 0.006, -0.007, 0.033),
               (0.64, -0.009, 0.006, 0.030), (0.84, 0.012, 0.004, 0.034), (0.96, 0.002, -0.003, 0.031)]


def crook_line():
    """the crook's carved centreline: the shaft knots, then the hook (points, radii)"""
    h, u = _hook_frame()
    side = unit(np.cross(u, h))
    pts, rads = [], []
    for s, oh, os_, r in SHAFT_KNOTS:
        s = S_BUTT + 0.006 if s is None else s
        pts.append(crook_at(s) + h * oh + side * os_)
        rads.append(r)
    hp = hook_pts()
    for i, p in enumerate(hp[1:]):
        t = i / (len(hp) - 2)
        pts.append(p)
        rads.append(SHAFT_R + (HOOK_R - SHAFT_R) * min(1.0, t * 3.0) + (0.003 if i in (2, 5) else 0.0))
    return pts, rads


def crook_parts() -> list:
    """the crook on prop.R: the pale carved shaft and its angular hook (one faceted polyline), the carved knob at the
    hook's tip, the carved ironstone ferrule, the leather wraps"""
    out = []
    h, u = _hook_frame()
    pts, rads = crook_line()
    shaft = Sculpt("crook_shaft")
    shaft.add(FacetTube(pts, rads, n=7, twist=0.55, seed=5, jitter=0.07, ext=0.80, ref=h)
              .displaced(lambda P: 0.0007 * NOISE(P * np.array([1.0, 1.0, 0.25]), 45.0), 0.0007), k=0.0)
    tip_d = unit(pts[-1] - pts[-2])
    shaft.add(FacetTube([HOOK_TIP - tip_d * 0.030, HOOK_TIP + tip_d * 0.006], [HOOK_R + 0.002, HOOK_R + 0.005], n=6,
                        twist=0.0, seed=11, jitter=0.10, ext=0.55, ref=h), k=0.004)      # the carved knob at the tip
    shaft.inter(HalfSpace((0, 0, 0.004), (0, 0, -1), 2.0), k=0.0)              # the butt sits on the ground (load test)
    out.append(("crook_shaft", shaft, 0.5, "wood", "bone:prop.R", 1300, 1.1))
    grip = Sculpt("crook_grip")
    for a_, b_ in GRIPS:
        g0, g1 = crook_at(a_), crook_at(b_)
        grip.add(Capsule(g0, g1, SHAFT_R + 0.0065).displaced(wraps(0.0020, 0.017, g0, g1), 0.0020), k=0.0)
        for e in (g0 + u * 0.006, g1 - u * 0.006):
            grip.add(Torus(e, SHAFT_R + 0.0065, 0.0042, axes=sdf.frame(u)), k=0.002)
    out.append(("crook_grip", grip, 0.5, "leather", "bone:prop.R", 360, 0.8))
    fer = Sculpt("crook_ferrule")
    b0 = crook_at(S_BUTT)
    fer.add(RoundCone(b0 + u * 0.008, b0 + u * 0.075, 0.029, SHAFT_R + 0.004).displaced(chips(0.002, 20.0), 0.002), k=0.0)
    fer.add(Torus(b0 + u * 0.074, SHAFT_R + 0.004, 0.0045, axes=sdf.frame(u)), k=0.003)
    fer.inter(HalfSpace((0, 0, 0.0), (0, 0, -1), 1.0), k=0.0)
    out.append(("crook_ferrule", fer, 0.45, "ironstone", "bone:prop.R", 160, 0.6))
    return out


def lancet(t, z, w, z_lo, z_spring, z_top):
    """2D distance (m, < 0 inside) of a pointed-arch window: half width w from z_lo up to the spring line, then two
    arcs meeting at z_top (all heights world z, z_lo < z_spring < z_top)"""
    hgt = z_top - z_spring
    R = (w * w + hgt * hgt) / (2 * w)                       # the two arcs' radius (centres on the spring line)
    body = np.maximum(np.abs(t) - w, np.maximum(z_lo - z, z - z_spring))
    arc = np.hypot(np.abs(t) + (R - w), z - z_spring) - R
    arc = np.maximum(arc, np.maximum(z_spring - z, z - z_top))
    return np.minimum(body, arc)


def lantern_parts() -> list:
    """the lantern (rigid on x_lantern): a ring through the hook's knob and a link down to the bail, a carved dark-wood
    octagon (a solid cap with an open chimney collar, the bail arching over it, a flared eave, banded frame, eight
    posts, a tapered base), amber lampresin panes, the azure core (the accent) in a narrow lancet window in the middle
    of every pane and glowing up the chimney"""
    out = []
    c = np.array([HANG[0], HANG[1], 0.0])
    ring = Sculpt("lantern_ring")
    h, u = _hook_frame()
    hp = unit(np.cross(h, (0, 0, 1)))                              # normal of the hook's (vertical) plane
    ring.add(Torus(HANG + np.array([0, 0, 0.026]), 0.022, 0.0055, axes=sdf.frame(hp)), k=0.0)
    ring.add(Torus(HANG + np.array([0, 0, -0.012]), 0.013, 0.0048, axes=sdf.frame(h)), k=0.0)
    out.append(("lantern_ring", ring, 0.4, "wood_dark", "bone:x_lantern", 140, 0.5))
    za, ze, a_e, a_a = lan_z(LAN_ROOF[0]), lan_z(LAN_ROOF[1]), LAN_ROOF[2], LAN_ROOF[3]
    zl0, zl1, a_l = lan_z(LAN_EAVE[0]), lan_z(LAN_EAVE[1]), LAN_EAVE[2]
    zb0, zb1 = lan_z(LAN_BODY[0]), lan_z(LAN_BODY[1])
    zs0, zs1 = lan_z(LAN_BASE[0]), lan_z(LAN_BASE[1])
    face_ang = [math.radians(45.0 * i) for i in range(8)]          # octa_r's facet normals: 0, 45, ... degrees
    r_in, r_out, ch_h, ch_rec = CHIM

    def roof(P):
        q = P - c
        k = np.clip((za - P[:, 2]) / (za - ze), 0.0, 1.0)
        slope = (a_e - a_a) / (za - ze)
        d = (octa_r(q) - (a_a + (a_e - a_a) * k)) / math.sqrt(1 + slope * slope)
        return np.maximum(d, np.maximum(P[:, 2] - za, ze - P[:, 2]))

    def collar(P):
        q = P - c
        rr = np.hypot(q[:, 0], q[:, 1])
        return np.maximum(np.abs(rr - 0.5 * (r_in + r_out)) - 0.5 * (r_out - r_in),
                          np.maximum(P[:, 2] - (za + ch_h), (za - 0.012) - P[:, 2]))

    def flue(P):
        """the chimney's open throat (cut through the collar and 2 cm into the cap)"""
        q = P - c
        return np.maximum(np.hypot(q[:, 0], q[:, 1]) - r_in, np.maximum(P[:, 2] - (za + ch_h + 0.02), (za - 0.020) - P[:, 2]))

    hf = unit(np.array([h[0], h[1], 0.0]))
    bail_top = np.array([c[0], c[1], HANG[2] - 0.022])
    bail_feet = [np.array([c[0], c[1], za + ch_h - 0.002]) + hf * sg * 0.5 * (r_in + r_out) for sg in (-1, 1)]

    def eave(P):
        q = P - c
        return np.maximum(octa_r(q) - a_l, np.maximum(P[:, 2] - zl0, zl1 - P[:, 2]))

    def base(P):
        q = P - c
        k = np.clip((zs0 - P[:, 2]) / (zs0 - zs1), 0.0, 1.0)
        d = (octa_r(q) - (LAN_A - 0.058 * k)) * 0.8
        return np.maximum(d, np.maximum(P[:, 2] - zs0, zs1 - P[:, 2]))
    fr = Sculpt("lantern_frame")
    lo, hi = c + np.array([-0.145, -0.145, zs1 - 0.03]), c + np.array([0.145, 0.145, HANG[2] + 0.01])
    fr.add(Fn(roof, lo, hi), k=0.0)
    fr.add(Fn(eave, lo, hi), k=0.004)
    fr.add(Fn(collar, lo, hi), k=0.006)                                                          # the chimney collar
    fr.add(Fn(lambda P: octa(P, c, LAN_A, zb0 - 0.004, zb0 + 0.013), lo, hi), k=0.004)          # the top band
    fr.add(Fn(lambda P: octa(P, c, LAN_A, zb1 - 0.012, zb1 + 0.003), lo, hi), k=0.004)          # the bottom band
    R_post = LAN_GLASS / math.cos(math.radians(22.5)) + POST_R * 0.35
    for i in range(8):
        a = math.radians(22.5 + 45.0 * i)
        pc = c + np.array([math.cos(a) * R_post, math.sin(a) * R_post, 0.0])
        fr.add(Capsule((pc[0], pc[1], zb1), (pc[0], pc[1], zb0), POST_R), k=0.004)
    fr.add(Fn(base, lo, hi), k=0.004)
    fr.add(Sphere((c[0], c[1], zs1 - 0.008), 0.016), k=0.006)
    fr.ops = [(op, prim.displaced(chips(0.0012, 26.0), 0.0012) if op == "add" else prim, k, tg) for op, prim, k, tg in fr.ops]
    fr.sub(Fn(flue, lo, hi), k=0.002)
    for ft in bail_feet:                                     # the bail: two struts from the collar's rim to the link
        fr.add(Capsule(ft, bail_top, 0.0050), k=0.003)                                           # (after the flue cut)
    out.append(("lantern_frame", fr, 0.4, "wood_dark", "bone:x_lantern", 1200, 1.2))
    gl = Sculpt("lantern_glass")
    gl.add(Fn(lambda P: octa(P, c, LAN_GLASS, zb1, zb0), lo, hi), k=0.0)
    out.append(("lantern_glass", gl, 0.45, "lampresin", "bone:x_lantern", 300, 0.9))

    def windows(P):
        q = P - c
        best = np.full(len(P), 1e3)
        for th in face_ang:
            n = np.array([math.cos(th), math.sin(th)])
            along = q[:, :2] @ n - LAN_GLASS
            across = q[:, :2] @ np.array([-n[1], n[0]])
            w = lancet(across, P[:, 2], WIN_W, lan_z(WIN_LO), lan_z(WIN_SPRING), lan_z(WIN_TOP))
            best = np.minimum(best, np.maximum(w, np.abs(along - 0.0020) - 0.0045))   # 6.5 mm proud of the glass
        return best

    def chimney_glow(P):
        q = P - c
        return np.maximum(np.hypot(q[:, 0], q[:, 1]) - (r_in - 0.001),
                          np.maximum(P[:, 2] - (za + ch_h - ch_rec), (za - 0.018) - P[:, 2]))
    core = Sculpt("lantern_core")
    core.add(Fn(windows, lo, hi), k=0.0)
    core.add(Fn(chimney_glow, lo, hi), k=0.0)                       # the core's light up the chimney (1 cm down)
    out.append(("lantern_core", core, 0.4, "accent", "bone:x_lantern", 680, 0.6))   # (420 collapsed the thin lancets)
    return out


PAGE_FRAMES: list = []          # (centre, across, up, normal) of each almanac page (the print reads its own frame)


def skin_extras(extra: dict) -> list:
    """Almanac Crook: three folded almanac pages (0.12 x 0.16 m rigid 1 cm plates) on short cords; fix pass 1 (review:
    the three pages read as one small block): spread 0.26 m apart down the shaft under the hook, on alternate sides"""
    out = []
    PAGE_FRAMES.clear()
    if extra.get("almanac_pages"):
        pages, cords = Sculpt("almanac_pages"), Sculpt("almanac_cords")
        h, u = _hook_frame()
        side = unit(np.cross(u, h))
        for i, (s, ang, off) in enumerate(((0.95, -28.0, 0.0), (0.69, 24.0, 0.01), (0.43, -12.0, -0.01))):
            sg = 1 if i % 2 else -1
            anchor = crook_at(s) + side * (SHAFT_R + 0.004) * sg
            dirn = unit(-side * sg * 0.55 + np.array([0, 0, -1.0]) + h * 0.10)
            top = anchor + dirn * 0.050
            cords.add(Capsule(anchor, top, 0.0030), k=0.0)
            cords.add(Torus(anchor - side * sg * (SHAFT_R + 0.004), SHAFT_R + 0.005, 0.0032, axes=sdf.frame(u)), k=0.002)
            cen = top + np.array([0, 0, -0.084]) + side * sg * 0.050 + h * off
            Rm = _rot((0, 0, 1), ang)
            fold = Rm @ np.array([0, 1.0, 0])
            pages.add(RoundBox(cen + fold * 0.004, (0.060, 0.004, 0.080), 0.003, axes=sdf.axes_from_rot(_rot((0, 0, 1), ang) @ _rot((1, 0, 0), 4.0))), k=0.0)
            pages.add(RoundBox(cen - fold * 0.004, (0.058, 0.004, 0.078), 0.003, axes=sdf.axes_from_rot(_rot((0, 0, 1), ang) @ _rot((1, 0, 0), -4.0))), k=0.002)
            PAGE_FRAMES.append((cen, Rm @ np.array([1.0, 0, 0]), np.array([0, 0, 1.0]), fold))
        out.append(("almanac_pages", pages, 0.45, "cloth2", "bone:prop.R", 520, 1.0))
        out.append(("almanac_cords", cords, 0.35, "leather", "bone:prop.R", 160, 0.4))
    return out


_BUILD: dict = {}


def hat_profile() -> list:
    """the hat's game-mesh profile (r, z) from the crown down the top, round the edge roll, back along the underside
    and in under the crown (to the axis)"""
    re_ = HAT_R - 0.016                                  # where the edge roll starts
    pts = [(0.0, hat_top(0.0))]                          # (fix pass 2: no 6 mm nub: the crown is 2.054 = art.height)
    for r in (0.007, 0.018, 0.032, 0.050, 0.072, 0.098, 0.128, 0.160, 0.168, 0.176, 0.200, 0.230, 0.260, 0.285,
              HAT_BAND[0] - 0.004, HAT_BAND[0] + 0.002, 0.317, HAT_BAND[1] - 0.002, re_):
        b = 0.0018 if HAT_BAND[0] < r < HAT_BAND[1] else 0.0
        b -= 0.0012 if abs(r - 0.172) < 0.005 else 0.0
        pts.append((r, hat_top(r) + b))
    zt, th = hat_top(re_), hat_thick(re_)
    c = (re_, zt - th * 0.5)
    for a in (70.0, 40.0, 10.0, -20.0, -50.0, -80.0):
        t = math.radians(a)
        pts.append((c[0] + 0.016 * math.cos(t), c[1] + th * 0.5 * math.sin(t)))
    for r in (re_ - 0.010, 0.30, 0.27, 0.24, 0.21, 0.19):
        pts.append((r, hat_under(r)))
    pts += [(0.168, max(1.962, hat_under(0.168))), (0.12, 1.958), (0.0, 1.958)]
    return pts


def hat_low(ctx, mat, seg: int = 60):
    """the hat's game mesh as a clean lathe (the decimated SDF shell left 1-px pinholes on the broad top in three);
    the SDF sculpt stays the bake source for its normals"""
    import bmesh
    bm = bmesh.new()
    rings = []
    for r, z in hat_profile():
        if r < 1e-6:
            rings.append([bm.verts.new((HAT_C[0], HAT_C[1], z))])
        else:
            rings.append([bm.verts.new((HAT_C[0] + r * math.cos(2 * math.pi * j / seg),
                                        HAT_C[1] + r * math.sin(2 * math.pi * j / seg), z)) for j in range(seg)])
    for A, B in zip(rings[:-1], rings[1:]):
        for j in range(seg):
            if len(A) == 1:
                bm.faces.new((A[0], B[(j + 1) % seg], B[j]))
            elif len(B) == 1:
                bm.faces.new((A[j], A[(j + 1) % seg], B[0]))
            else:
                bm.faces.new((A[j], A[(j + 1) % seg], B[(j + 1) % seg], B[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("hat_low")
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = True
    ob = bpy.data.objects.new("hat_low", me)
    ctx.col.objects.link(ob)
    ob.data.materials.append(mat)
    return ob


def model(ctx) -> list:
    P = []
    extra = (ctx.skin or {}).get("extra") or {}
    _BUILD["dunsom"] = True
    _BUILD["skin"] = (ctx.skin or {}).get("id")
    items = sculpts() + [x + (1.0,) if len(x) == 6 else x for x in skin_extras(extra)]
    if ctx.skin is None:                       # part ids -> names for proto/dunsom_paint.py (the cached .blend)
        scene.write_json(os.path.join(scene.CACHE_DIR, "fighters", "dunsom_parts.json"), [it[0] for it in items])
    for name, S, vs, role, bind, tris, uvw in items:
        v, q = S.mesh(VOXEL * vs)
        ob = sdf.to_object(f"{name}_high", v, q, ctx.col)
        ob.data.materials.append(ctx.mats[role])
        if name == "hat":
            P.append(fighter.Part(name, high=ob, low=hat_low(ctx, ctx.mats[role]), bind=bind, uv_weight=uvw))
            continue
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
    shin = leg * 0.40 * ss(0.66, 0.30, z) * (0.60 + 0.40 * ss(-0.05, 0.12, y))   # (fp1: the front hem follows the shin more)
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
PROC = ("hat", "belt", "boots", "trousers", "crook_shaft", "crook_grip", "crook_ferrule", "lantern_ring", "lantern_frame", "lantern_glass",
        "hand_R", "hand_L", "toecaps", "buckle", "almanac_pages", "almanac_cords")
BACK_MATCH = 0.85
# z / 2.0 -> linear gain: the light head (hat, mask) and the darker coat skirt toward the boots (brief §6)
# fix pass 2 (lineup_qa f0 middle band L* 39.9, bible 45-65: the brim's shadow falls on the scarf and the chest): the
# ramp now peaks over the chest, scarf and shoulders (x1.12 at z 1.3-1.56) and darkens the hem and boots a little more
VALUE_RAMP = [(0.0, 0.62), (0.08, 0.66), (0.15, 0.71), (0.25, 0.80), (0.35, 0.90), (0.45, 0.99), (0.55, 1.06),
              (0.65, 1.12), (0.78, 1.12), (0.88, 1.06), (1.0, 1.03)]
HI_KNEE, HI_TOP = 0.56, 0.70   # linear luminance: a soft shoulder from L* 80 up to L* 87 (no large area over 86)
SIDE_PARTS = ("hood", "scarf", "coat_top", "belt", "skirt", "under_robe", "trousers", "sleeve_L", "sleeve_R", "boots",
              "mask")
SIDE_FACE = (0.24, 0.60)
SIDE_FACE_PART = {"hood": (0.35, 0.80), "mask": (0.30, 0.70)}
SIDE_HI = 1.15
BACK_PARTS = ("hood", "scarf", "coat_top", "belt", "skirt", "sleeve_L", "sleeve_R", "trousers", "boots")
OBLIQUE = {"coat_top": 0.65, "skirt": 0.45, "sleeve_L": 0.55, "sleeve_R": 0.60, "scarf": 0.40, "hood": 0.45}
DARK_FLOOR, DARK_KNEE = 0.70, 0.88


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
        if nm == "hood":
            # the painted hood is a narrower column with its own brim shadow (a ghost head inside the model's wider
            # hood from behind): plain felt with soft vertical folds instead
            pp = p[sel]
            r = 1 + 0.07 * np.sin(np.arctan2(pp[:, 0] - MX, pp[:, 1] - 0.02) * 7.0 + 2.0 * NOISE(pp, 4.0)) + 0.03 * NOISE(pp, 25.0)
        bk[sel] = tf * r[:, None]
        log(f"  dunsom back match {nm}: front band tones x back detail ({int(b.sum())} texels)")
    cols["back"] = _srgb(bk)


KEY = unit((-0.45, -0.70, 0.55))                    # the painted key light: upper front, his right
COAT_LIFT, COAT_DESAT = 1.52, 0.0       # fix pass 1: x1.52 / 22 % read white-washed in three (the concept's mid lavender);
                                        # fix pass 2: 1.26 left the coat albedo at L* 41 (bible cloth L* 49, 'not under
                                        # 45'): 1.52 with the hue kept (no grey wash), the ramp lifting the chest
                                        # (1.40 measured lineup mid 41.6, three coat L* ~54)
SCARF_LIFT = 1.28                       # fix pass 2: the khaki scarf to the painted L* ~54 (was 44)
HOOD_FLOOR = 0.62           # no hood texel darker than this x the lit hood's median (the back sheet paints its back
                            # in the brim's shadow: a black column from behind) except inside the face opening
HOOD_HEX = "#7A6E86"        # the hood's felt (the coat's lavender): 40 % of its hue / chroma


def _lam(n, lo=0.70, k=0.36):
    return lo + k * np.clip(n @ KEY, -0.4, 1.0)


def _hat_paint(p, n):
    """the felt hat: pale dusk-lavender felt (toned under L* 86) with a mottled felt nap and soft radial brushing, a
    lit crown; fix pass 1 (review: a featureless plate from the game camera): the stitched EDGE BAND a full value
    step darker (a 3.4 cm felt strip with a row of pale stitches along each edge), the crown seam, the rolled edge
    darker still; the underside a deep warm mauve in shade"""
    q = p[:, :2] - HAT_C[None, :]
    r = np.hypot(q[:, 0], q[:, 1])
    th = np.arctan2(q[:, 1], q[:, 0])
    top = _lin(_hex("#C8BFD2"))                     # fix pass 2: toward the brief's L* 80 felt (lineup top band 69.7)
    band_c = _lin(_hex("#A196AE"))
    under = _lin(_hex("#5E4A55"))
    up = ss(-0.15, 0.35, n[:, 2])
    zt = hat_top(r)
    on_top = ss(zt - hat_thick(r) * 0.75, zt - hat_thick(r) * 0.35, p[:, 2]) * up
    nap = 1 + 0.050 * _fbm(p * np.array([1.0, 1.0, 0.0]) + np.array([0.0, 0.0, 0.0]), 16.0) + 0.030 * _fbm(p, 55.0)
    brush = 1 + 0.035 * NOISE(np.stack([th * 3.0, r * 18.0, p[:, 2] * 0.0], 1), 1.0)
    c = top[None, :] * (nap * brush * (0.88 + 0.18 * ss(0.30, 0.04, r)) * (0.92 + 0.12 * ss(-0.2, 0.8, n @ KEY)))[:, None]
    bw = ss(HAT_BAND[0] - 0.002, HAT_BAND[0] + 0.002, r) * (1 - ss(HAT_BAND[1] - 0.002, HAT_BAND[1] + 0.002, r))
    bc = band_c[None, :] * (nap * (0.95 + 0.08 * ss(-0.2, 0.8, n @ KEY)))[:, None]
    c = c * (1 - bw[:, None]) + bc * bw[:, None]
    per = 2 * math.pi * r / 0.011                       # a stitch every 1.1 cm along each edge of the band
    st = (np.sin(th * per / (2 * math.pi) * 2 * math.pi) > 0.25).astype(np.float32)
    for e in (HAT_BAND[0] + 0.0045, HAT_BAND[1] - 0.0045):
        sw = st * np.exp(-((r - e) / 0.0016) ** 2)
        c = c * (1 - 0.55 * sw[:, None]) + (top[None, :] * 1.10) * (0.55 * sw[:, None])
    seam = np.exp(-((r - 0.172) / 0.0035) ** 2)
    c = c * (1 - 0.16 * seam)[:, None]
    edge = ss(HAT_R - 0.016, HAT_R, r)
    c = c * (1 - 0.22 * edge)[:, None]
    u_ = under[None, :] * (1 + 0.06 * _fbm(p, 18.0))[:, None] * (0.85 + 0.25 * ss(0.12, 0.34, r))[:, None]
    w = on_top[:, None]
    return c * w + u_ * (1 - w)


def _crook_local(p):
    """(s along the shaft from the grip, angle round it) of crook texels (upright-carry coordinates)"""
    q = p - GRIP
    s = q @ CROOK_U
    h, u = _hook_frame()
    th = np.arctan2(q @ np.cross(u, h), q @ h)
    return s, th


def _wood_paint(p, n):
    """fix pass 1 (review: a mid greige rope): pale bone-white carved wood (the concept's L* 69-78): a fine grain
    running ALONG the shaft (not round it), darker carving cuts where the planes meet (the facet edges catch less
    light: n's curvature from the bake does the rest), a few knots, a little grime toward the butt"""
    s, th = _crook_local(p)
    base = _lin(_hex("#BFB6A8"))
    dark = _lin(_hex("#837A6E"))
    grain = np.sin(th * 9.0 + 2.2 * NOISE(p * np.array([1.0, 1.0, 0.12]), 5.0)) * 0.5 + 0.5
    fine = np.sin(th * 23.0 + 3.0 * NOISE(p * np.array([1.0, 1.0, 0.10]), 9.0)) * 0.5 + 0.5
    g = 0.55 * grain ** 4 + 0.30 * fine ** 6
    c = base[None, :] * (1 - 0.30 * g)[:, None] + dark[None, :] * (0.30 * g)[:, None]
    knots = np.clip(NOISE.ridged(p, 9.0, 2) - 0.62, 0, 1) * 1.8
    z = p[:, 2]
    butt = 0.72 + 0.28 * ss(0.05, 0.70, z)
    c = c * ((1 - 0.30 * knots) * butt * _lam(n, 0.86, 0.14))[:, None] * (1 + 0.05 * _fbm(p, 30.0))[:, None]
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


def _boot_paint(p, n):
    """plain dark-brown leather boots (the projection sampled the pale floor round the painted boots): lit tops and
    shins, a darker sole edge, creases over the instep, the turned top band"""
    base = _lin(_hex("#4A3631"))
    z = p[:, 2]
    crease = np.clip(np.sin(z * 260.0 + 3.0 * NOISE(p, 12.0)), 0, 1) ** 6 * ss(0.05, 0.08, z) * (1 - ss(0.12, 0.16, z))
    sole = 1 - ss(0.006, 0.020, z)
    band = ss(0.212, 0.220, z)
    k = _lam(n, 0.72, 0.45) * (1 - 0.25 * crease) * (1 - 0.45 * sole) * (1 + 0.10 * band) * (1 + 0.10 * _fbm(p, 35.0))
    return base[None, :] * k[:, None]


def _lantern_frame_paint(p, n):
    """the carved dark-wood frame and cap (as painted: a warm dark brown, lighter on the cap's lit planes and the
    eave's edge, the grain running down the posts)"""
    c = _lin(_hex("#62463A"))[None, :] * (1 + 0.14 * _fbm(p * np.array([1, 1, 4.0]), 30.0))[:, None]
    up = ss(0.3, 0.9, n[:, 2])
    return c * (_lam(n, 0.78, 0.34) * (1 + 0.18 * up))[:, None]


def _lantern_glass_paint(p, n):
    """fix pass 2: warm amber lampresin panes lit from within (the larger share of every pane, as painted): a glowing
    gold halo round each pane's blue core window, a warm amber field, deeper orange only in a thin rim at the posts
    and the bands"""
    c0 = np.array([HANG[0], HANG[1]])
    q = p[:, :2] - c0
    ang = np.arctan2(q[:, 1], q[:, 0])
    k = np.round(ang / (math.pi / 4))
    th = k * (math.pi / 4)
    across = -q[:, 0] * np.sin(th) + q[:, 1] * np.cos(th)
    wd = lancet(across, p[:, 2], WIN_W, lan_z(WIN_LO), lan_z(WIN_SPRING), lan_z(WIN_TOP))
    halo = np.exp(-np.clip(wd, 0.0, None) / 0.016)
    half = LAN_GLASS * math.tan(math.radians(22.5))
    rim = np.maximum(ss(half - 0.012, half - 0.002, np.abs(across)),
                     np.maximum(ss(lan_z(LAN_BODY[1]) + 0.014, lan_z(LAN_BODY[1]) + 0.003, p[:, 2]),
                                ss(lan_z(LAN_BODY[0]) - 0.012, lan_z(LAN_BODY[0]) - 0.002, p[:, 2])))
    gold, amber, deep = _lin(_hex("#F1B556")), _lin(_hex("#DE9338")), _lin(_hex("#A9581E"))
    c = amber[None, :] * (1 - halo)[:, None] + gold[None, :] * halo[:, None]
    c = c * (1 - 0.65 * rim)[:, None] + deep[None, :] * (0.65 * rim)[:, None]
    return c * (1 + 0.05 * _fbm(p, 60.0))[:, None]


def _under_paint(p, n):
    """fix pass 2: the under-robe in the coat's front opening, a dark plum-brown felt (as painted: near black under
    the lavender coat), soft vertical folds and a little light on the folds' crowns"""
    base = _lin(_hex("#2E2531"))
    folds = 0.5 + 0.5 * np.sin(p[:, 0] * 90.0 + 2.0 * NOISE(p * np.array([1.0, 1.0, 0.2]), 6.0))
    return base[None, :] * (_lam(n, 0.80, 0.30) * (0.90 + 0.18 * folds) * (1 + 0.08 * _fbm(p, 30.0)))[:, None]


def _belt_paint(p, n):
    """the flat leather strap (as painted: a warm mid-dark brown), a lighter worn top edge, darker stitched edges"""
    z = p[:, 2]
    c = _lin(_hex("#5A4033"))[None, :] * (1 + 0.12 * _fbm(p * np.array([1.0, 1.0, 3.0]), 40.0))[:, None]
    edge = np.exp(-((np.abs(z - 1.250) - 0.019) / 0.0025) ** 2)
    top = ss(1.262, 1.272, z)
    return c * (_lam(n, 0.80, 0.30) * (1 - 0.30 * edge) * (1 + 0.10 * top))[:, None]


# fix pass 1 (review: burn-hole blotches and a dark block on the skirt, an unpainted white inner sleeve, white frost on
# the shoulders and drips off the back of the scarf, brown blobs in the coat islands): every cloth texel becomes its
# part's own banded tone (median colour per 3 cm band, front and back apart, blended by the normal) x its painted
# value relative to that tone, the contrast eased (keep) and clamped (lo, hi): the painted folds stay, the projection's
# outliers (glove / crook / backdrop texels, the back sheet's rim strokes, hidden fills) cannot survive in value or hue
TONE_CLAMP = {"coat_top": (0.80, 1.07, 0.55), "skirt": (0.86, 1.07, 0.55), "sleeve_L": (0.80, 1.07, 0.55),
              "sleeve_R": (0.80, 1.07, 0.55), "hood": (0.72, 1.08, 0.65), "scarf": (0.72, 1.12, 0.80),
              "under_robe": (0.70, 1.25, 0.70)}


COAT_GROUP = ("coat_top", "skirt", "sleeve_L", "sleeve_R")    # one felt: one value and hue (the sleeves' own paler
                                                              # value met the coat's at the shoulders as a ragged patch)


def _tone_clamp(lin, k, p, n, names, log):
    """(see above) the absolute tone is the FRONT's (texels squarely facing the front plate): the back sheet's rim
    strokes and the shoulder tops that see neither plate cannot set a paler tone (the 'frost'); each texel's detail is
    measured against its own side's 6 cm band"""
    grp = np.isin(k, [names.index(g) for g in COAT_GROUP if g in names])
    gf = grp & (n[:, 1] < -0.6) & (_Y(lin) > 0.003)
    g_hue = g_y = None
    if gf.sum() >= 200:
        g_hue = np.median(lin[gf], axis=0)
        g_hue = g_hue / max(float(_Y(g_hue[None, :])[0]), 1e-5)
        g_y = float(np.median(_Y(lin[gf])))
    for kk in np.unique(k):
        nm = names[kk]
        if nm not in TONE_CLAMP:
            continue
        lo, hi, keep = TONE_CLAMP[nm]
        sel = k == kk
        c = lin[sel]
        zs = p[sel, 2]
        ny = n[sel, 1]
        Y = _Y(c)
        ok = Y > 0.003
        if nm == "hood":              # one felt tone all round (front / back apart left a darker 'ghost' column behind)
            f = b = ok & (ny > -0.30)
        else:
            f, b = ok & (ny < -0.6), ok & (ny > 0.6)
            if f.sum() < 40:
                f = ok & (ny < 0.0)
            if b.sum() < 40:
                b = ok & (ny >= 0.0)
        tf = _band_tone(zs[f], c[f], zs, step=0.06) if f.sum() >= 40 else None
        tb = _band_tone(zs[b], c[b], zs, step=0.06) if b.sum() >= 40 else None
        if tf is None and tb is None:
            continue
        tf = tf if tf is not None else tb
        tb = tb if tb is not None else tf
        wbb = ss(-0.35, 0.35, ny)
        ref = tf * (1 - wbb[:, None]) + tb * wbb[:, None]
        # one hue for the whole part (its well-lit front median's chroma): the bands keep only their VALUE (a warm rim
        # stroke or a glove-tinted band left a pink stripe round the back of the coat)
        good = f if nm == "hood" else (ok & (ny < -0.5) if (ok & (ny < -0.5)).sum() >= 40 else ok)
        hue = np.median(c[good], axis=0)
        hue = hue / max(float(_Y(hue[None, :])[0]), 1e-5)
        # ONE value for the whole part (the median of its texels that face the front plate squarely): the painted
        # light (the concept's lit shoulders) set pale bands that wrapped round the back as 'frost'; the light-head /
        # dark-feet ramp and the baked folds give the value structure, the painting only its fold detail (r)
        yv = float(np.median(Y[f])) if f.sum() >= 40 else float(np.median(Y[ok]))
        if nm in COAT_GROUP and g_y is not None:
            hue, yv = g_hue, g_y
        tone = hue[None, :] * (yv * (1 - 0.05 * wbb))[:, None]
        r = Y / np.maximum(_Y(ref), 1e-5)
        r2 = 1 + (r - 1) * keep
        lo_ = np.full(len(r2), lo, dtype=np.float32)
        if nm == "coat_top":          # the painted dark V between the lapels (under the scarf) keeps its depth
            pp = p[sel]
            v = (np.abs(pp[:, 0] + 0.004) < 0.018 + 0.085 * ss(1.27, 1.47, pp[:, 2])) & (pp[:, 2] > 1.265) & (ny < -0.4)
            lo_[v] = 0.30
        r2 = np.clip(r2, lo_, hi)
        bad = float(((r < lo) | (r > hi * 1.15)).mean())
        lin[sel] = tone * r2[:, None]
        log(f"  dunsom tone clamp {nm}: {100 * bad:.1f}% outliers pulled in")
    return lin


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
    lin = _tone_clamp(lin, k, p, n, names, log)

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
        "toecaps": lambda pp, nn: _stone_paint(pp, nn, "#2F2B31", 0.12),
        "boots": _boot_paint, "trousers": lambda pp, nn: _leather_paint(pp, nn, "#2A2228"),
        "buckle": lambda pp, nn: _stone_paint(pp, nn, "#4B3A31", 0.10),
        "belt": _belt_paint, "under_robe": _under_paint,
        "almanac_pages": lambda pp, nn: _stone_paint(pp, nn, "#BDB39C", 0.05),
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
        # (fix pass 1: was ss(-0.10, -0.05, y), 1 for every y > -0.05: it darkened the hood's BACK inside the face's x-z
        # outline -- the 'ghost' head column seen from behind; only the front rim round the mask is in shade)
        inner = ss(0.004, -0.006, sd) * ss(-0.03, -0.08, pp[:, 1])
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
    # lineup_qa (the game's chain) measured the middle band at L* 36.8 (bible 45-65) and the grade pushes the painted
    # lavender toward violet: the coat's cloth parts are lifted (COAT_LIFT, linear) and eased 20 % toward grey
    for name in ("coat_top", "skirt", "sleeve_L", "sleeve_R", "hood"):
        m = sel(name)
        if m is not None:
            c = lin[m]
            Y = _Y(c)[:, None]
            lin[m] = (c * (1 - COAT_DESAT) + Y * COAT_DESAT) * COAT_LIFT
    m = sel("scarf")
    if m is not None:
        lin[m] = lin[m] * SCARF_LIFT
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
        # fix pass 1: the islands' own colour fills the whole 7 px gutter (mip levels of the many small islands
        # pulled their neighbours' colours in: the pale crook's into the coat as 'frost')
        far = np.hypot(iy - np.arange(out.shape[0])[:, None], ix - np.arange(out.shape[1])[None, :]) > 9.0
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


# ── the ORM's gutters (bake.bake_asset wrapper) ────────────────────────────────────────────────────────
# fix pass 1 (review: white frost-like smears over the shoulders and sleeves): the ORM is baked at 2048 with an 8 px
# margin and scaled to 512, so its gutters are mostly empty: roughness 0 (a mirror) round every island. The cloth is
# cut into many small islands, and at the game camera's mip levels their borders sampled that gloss and caught the
# sky as white smears. Every gutter texel now takes its nearest island's roughness / metal / occlusion.
def _fill_gutters(arr, valid, iters=40):
    """nearest-ish fill of invalid texels from valid neighbours (iterative 8-neighbour mean), in place"""
    a = arr.copy()
    v = valid.astype(np.float32)
    for _ in range(iters):
        if v.min() > 0.5:
            break
        acc = np.zeros_like(a)
        cnt = np.zeros(v.shape, dtype=np.float32)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0:
                    continue
                vs = np.roll(np.roll(v, dy, 0), dx, 1)
                acc += np.roll(np.roll(a, dy, 0), dx, 1) * vs[..., None]
                cnt += vs
        new = (v < 0.5) & (cnt > 0)
        a[new] = acc[new] / cnt[new][:, None]
        v = np.where(new, 1.0, v)
    return a


_orig_bake_asset = _bake.bake_asset


def _bake_asset(low, highs, out_dir, name="body", *a, **k):
    res = _orig_bake_asset(low, highs, out_dir, name, *a, **k)
    path = (res.get("images") or {}).get("orm")
    if not str(name).startswith(ID) or not path:
        return res
    img = bpy.data.images.load(path, check_existing=True)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    valid = px[..., 1] > 0.035                       # roughness: never below ~0.2 on this figure; 0 = an empty gutter
    before = float(1 - valid.mean())
    px[..., :3] = _fill_gutters(px[..., :3], valid)
    img.pixels.foreach_set(px.ravel())
    img.update()
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    scene.log(f"dunsom ORM gutters filled: {100 * before:.1f}% of the {w}x{h} map took their island's roughness / AO")
    return res


_bake.bake_asset = _bake_asset


# ── skins (project.recolour wrapper) ────────────────────────────────────────────────────────────────────
# Each listed part's painted median moves onto the skin's colour (linear gain per channel: the painted values and
# detail keep their relationships); the coat parts follow the cloth role's own change. Highrim: a wind-carved
# grain across the hat (light and dark streaks flowing one way, ~6 %); Almanac: printed tables on the hat (rings and
# spokes of ruled cells with tick 'figures', ink at 60 %), printed pages on the crook.
# targets are the parts' painted MEDIANS: the brief's identity hexes x the base's own albedo-to-brief ratio (the base hat
# paints at 0.70 x the brief's #CAC5D4 in linear light, so it reads L* ~80 under the game's top light, not white)
SKIN_PARTS = {
    # fix pass 1 (review: Highrim read as the base with a warmer disc): a sandstone hat with eroded strata rings and
    # the wind grain, a sand scarf, a warm bleached-walnut crook, weathered tan leather gloves, a grey weathered lantern
    # frame and (SKIN_CLOTH) a dusty taupe coat at the base coat's value
    "dunsom_highrim": {"hat": "#B9A684", "scarf": "#B39C78", "crook_shaft": "#C6AF8C", "hand_R": "#7C5B3E",
                       "hand_L": "#7C5B3E", "lantern_frame": "#6C6258", "lantern_ring": "#6C6258"},
    "dunsom_almanac": {"hat": "#BDB49E", "scarf": "#A39A86", "crook_shaft": "#2E2A26", "lantern_frame": "#2E2A26",
                       "lantern_ring": "#2E2A26", "buckle": "#2E2A26", "crook_ferrule": "#262326"},
}
COAT_PARTS = ("coat_top", "skirt", "sleeve_L", "sleeve_R", "hood")
SKIN_CLOTH = {"dunsom_almanac": ("#85818F", "#7D7185", COAT_PARTS),
              "dunsom_highrim": ("#827A6E", "#7D7185", COAT_PARTS)}
INK_HEX = "#3A342C"


def _shift_to(c, target_hex, med):
    gain = np.clip(_lin(_hex(target_hex)) / np.maximum(med, 1e-4), 0.02, 4.0)
    return _srgb(_hi_cap(_lin(c) * gain[None, :]))


def _ink(d, hw=0.0016, aa=0.0009):
    return 1 - ss(hw - aa, hw + aa, d)


def _tables(P):
    """Almanac: ruled tables printed round the hat's top; fix pass 1 (review: the tables vanished at game zoom): bold
    6 mm rules every 5 cm, 16 cell walls, every other cell washed in ink, tick 'figures', and the edge band printed
    solid (a dark ring round the disc from above)"""
    q = P[:, :2] - HAT_C[None, :]
    r = np.hypot(q[:, 0], q[:, 1])
    th = np.arctan2(q[:, 1], q[:, 0])
    pitch = 0.050
    rings = np.abs(((r - 0.05) / pitch + 0.5) % 1.0 - 0.5) * pitch
    d = np.where((r > 0.05) & (r < 0.30), rings, 1e9)
    seg = 2 * math.pi / 16
    wall = np.abs(((th / seg) + 0.5) % 1.0 - 0.5) * seg * r
    d = np.minimum(d, np.where((r > 0.10) & (r < 0.30), wall, 1e9))
    lines = _ink(d, 0.0030, 0.0010)
    ci = np.floor((r - 0.05) / pitch).astype(int) + np.floor(th / seg).astype(int)
    wash = ((ci % 2) == 0) & (r > 0.10) & (r < 0.30)
    cell_r = ((r - 0.05) / pitch) % 1.0
    cell_t = (th / seg) % 1.0
    fig = (np.abs(cell_r - 0.5) < 0.16) & ((np.abs(cell_t - 0.30) < 0.07) | (np.abs(cell_t - 0.58) < 0.12)) & (r > 0.10) & (r < 0.30)
    band = ss(HAT_BAND[0] - 0.002, HAT_BAND[0] + 0.002, r) * (1 - ss(HAT_BAND[1] - 0.002, HAT_BAND[1] + 0.002, r))
    cov = np.maximum.reduce([lines, fig.astype(np.float32) * 0.85, wash.astype(np.float32) * 0.28, band * 0.85])
    return cov * (1 - ss(HAT_R - 0.012, HAT_R - 0.004, r))


def _page_print(P):
    """Almanac pages: an inked border and two columns of thick printed lines in each page's own frame"""
    cov = np.zeros(len(P), dtype=np.float32)
    if not PAGE_FRAMES:
        z = P[:, 2]
        rows = np.abs(((z / 0.011) % 1.0) - 0.5) < 0.18
        return rows.astype(np.float32) * 0.6
    C = np.array([f[0] for f in PAGE_FRAMES])
    near = np.argmin(np.linalg.norm(P[:, None, :] - C[None, :, :], axis=2), axis=1)
    for i, (cen, ax, up, nrm) in enumerate(PAGE_FRAMES):
        m = near == i
        if not m.any():
            continue
        q = P[m] - cen
        uu, vv = q @ ax, q @ up
        border = (np.abs(np.abs(uu) - 0.050) < 0.0025) & (np.abs(vv) < 0.071) | (np.abs(np.abs(vv) - 0.070) < 0.0025) & (np.abs(uu) < 0.051)
        col = (np.abs(np.abs(uu) - 0.024) < 0.020)
        rowl = (np.abs(((vv + 0.07) / 0.0115) % 1.0 - 0.5) < 0.20) & (np.abs(vv) < 0.058)
        head = (np.abs(vv - 0.060) < 0.004) & (np.abs(uu) < 0.040)
        cov[m] = np.maximum.reduce([border.astype(np.float32) * 0.9, (col & rowl).astype(np.float32) * 0.7,
                                    head.astype(np.float32) * 0.9])
    return cov


def _wind_grain(P):
    """Highrim: the wind-carved grain across the hat: streaks flowing along one direction, warped"""
    w = P[:, 0] * 0.8 + P[:, 1] * 0.6
    v = P[:, 0] * -0.6 + P[:, 1] * 0.8
    s = np.sin(v * 140.0 + 4.0 * NOISE(P, 5.0) + 2.0 * np.sin(w * 9.0))
    return 0.06 * s + 0.03 * NOISE(P * np.array([4.0, 4.0, 1.0]), 30.0)


def _strata(P):
    """Highrim: eroded sandstone strata round the hat's top: wavy concentric layers every ~4.5 cm (0..1 per texel)"""
    q = P[:, :2] - HAT_C[None, :]
    r = np.hypot(q[:, 0], q[:, 1])
    s_ = np.sin(2 * math.pi * r / 0.045 + 3.0 * NOISE(P * np.array([1.0, 1.0, 0.0]), 9.0) + 1.2 * NOISE(P * np.array([1.0, 1.0, 0.0]), 23.0))
    return ss(-0.15, 0.55, s_) * ss(0.04, 0.08, r)


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
            st = _strata(P) * top
            rust = _lin(_hex("#9C7452"))
            lc = _lin(c) * (1 + _wind_grain(P) * top)[:, None] * (1 - 0.10 * st)[:, None]
            lc = lc * (1 - 0.22 * st[:, None]) + rust[None, :] * _Y(lc)[:, None] / max(float(_Y(rust[None, :])[0]), 1e-4) * (0.22 * st[:, None])
            c = _srgb(_hi_cap(lc))
            log(f"  dunsom highrim strata: {100 * float((st > 0.5).mean()):.0f}% of the hat's texels")
        if nm == "hat" and sid == "dunsom_almanac":
            cov = _tables(P) * ss(HAT_EDGE, HAT_EDGE + 0.02, P[:, 2]) * 0.80
            c = c * (1 - cov[:, None]) + _hex(INK_HEX)[None, :] * cov[:, None]
            log(f"  dunsom almanac tables: {100 * float((cov > 0.3).mean()):.1f}% of the hat's texels")
        if nm == "almanac_pages":
            cov = _page_print(P)
            c = c * (1 - cov[:, None]) + _hex(INK_HEX)[None, :] * cov[:, None]
        out[m] = c
    return out.astype(np.float32)


_orig_recolour = _project.recolour
_project.recolour = _recolour


# ── location tracks (Vashil's wrappers): the crook slides through the fist; fix pass 1: x_hat too (the death's
# fallen hat) and pinned bones (a world matrix held while the parent moves) ──────────────────────────────────
LOC_BONES = ("prop.R", "x_hat")
_orig_basis = anim.Skeleton.basis


def _basis(self, pose, b):
    m = _orig_basis(self, pose, b)
    if b in LOC_BONES:
        loc = pose.get(b + "_loc")
        if loc is not None:
            m = Matrix.Translation(V(tuple(loc))) @ m
    return m


anim.Skeleton.basis = _basis
_orig_write_action = anim.write_action


def _write_action(arm, name, poses, bones=None):
    act = _orig_write_action(arm, name, poses, bones)
    for b in LOC_BONES:
        if b not in arm.data.bones or not any(b + "_loc" in p for p in poses):
            continue
        strip = act.layers[0].strips[0]
        cb = strip.channelbag(act.slots[0], ensure=True)
        n = len(poses)
        for i in range(3):
            fc = anim._new_fcurve(cb, f'pose.bones["{b}"].location', i, b)
            vals = [float(p.get(b + "_loc", (0.0, 0.0, 0.0))[i]) for p in poses]
            fc.keyframe_points.add(n)
            fc.keyframe_points.foreach_set("co", [c for f, v in zip(range(n), vals) for c in (f, v)])
            fc.keyframe_points.foreach_set("interpolation", [1] * n)
            fc.update()
    return act


anim.write_action = _write_action
_orig_apply_pose = anim.apply_pose


def _apply_pose(arm, pose):
    _orig_apply_pose(arm, pose)
    moved = False
    for b in LOC_BONES:
        if b in arm.pose.bones:
            loc = pose.get(b + "_loc") if pose else None
            arm.pose.bones[b].location = tuple(loc) if loc is not None else (0.0, 0.0, 0.0)
            moved = True
    if moved:
        bpy.context.view_layer.update()


anim.apply_pose = _apply_pose


def _pin(skel, pose, b, W):
    """set bone b's rotation + location so its world (armature-space) matrix is W"""
    M = skel.fk(pose)
    par = skel.parent[b]
    base = M[par] @ skel.local[b]
    B = base.inverted() @ W
    pose[b] = anim.Skeleton.euler_of(B.to_3x3(), pose.get(b))
    pose[b + "_loc"] = tuple(B.translation)


def _prop_rest0(skel) -> Matrix:
    """prop.R's rest in the upright carry (where the sculpt's world coordinates live)"""
    R = skel.rest["prop.R"]
    tilt = _rest_tilt(skel)
    return Matrix([list(r) for r in _turn(-tilt)]) @ R if abs(tilt) > 1e-6 else R


def _crook_world(skel, M, p_up):
    """world position of a crook point given in the upright-carry coordinates, under the FK result M"""
    return M["prop.R"] @ (_prop_rest0(skel).inverted() @ V(tuple(p_up)))


def _floor_crook(skel, pose):
    """the crook's butt never sinks into the floor: the crook slides up through the fist (prop.R_loc) by the
    deficit (only while the shaft is fairly upright; a levelled crook is never near its butt's floor)"""
    M = skel.fk(pose)
    butt = _crook_world(skel, M, crook_at(S_BUTT))
    ax = M["prop.R"].to_3x3().col[1].normalized()
    if butt.z >= 0.003 or ax.z < 0.25:
        return pose
    loc = list(pose.get("prop.R_loc", (0.0, 0.0, 0.0)))
    loc[1] += (0.003 - butt.z) / ax.z
    pose["prop.R_loc"] = tuple(loc)
    return pose


# ── the lantern's pendulum (anim.sample_clip wrapper) ───────────────────────────────────────────────────
# x_lantern hangs plumb: every frame its bone is pointed at a spring-led direction that follows straight down
# (solved in world space, 2 axes), never more than LAN_MAX degrees off plumb (brief: <= 6 degrees, heavily damped, the
# accent never blurs). An authored "x_lantern" key (a knock in the taunt) rides on top. Loops run three cycles.
LAN_K, LAN_D, LAN_MAX = 120.0, 15.0, 6.0
LAN_LEN = 0.47                            # the lantern's pivot -> its base knob (fix pass 2: the 0.27 m panes)
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
        # fix pass 1: the lantern never goes through the floor (the sweep skimmed it, the fallen crook lies on it):
        # it tips toward the horizontal until its base clears the ground
        piv = Pm.translation
        need = (0.025 - piv.z) / LAN_LEN
        if d.z < need:
            hd = V((d.x, d.y, 0.0))
            if hd.length < 1e-3:
                hd = V((R.col[0].x, R.col[0].y, 0.0))
            hd.normalize()
            dz = min(0.3, need)
            d = (hd * math.sqrt(max(0.0, 1 - dz * dz)) + V((0.0, 0.0, dz))).normalized()
        kx = poses[f].get(b)
        if kx:
            d = (Matrix.Rotation(math.radians(kx[0]), 3, R.col[0].normalized()) @
                 Matrix.Rotation(math.radians(kx[2]), 3, R.col[2].normalized()) @ d).normalized()
        q = y.rotation_difference(d)
        loc = R.inverted() @ q.to_matrix() @ R
        out[f][b] = anim.Skeleton.euler_of(loc)
    return out


def _sample_clip(skel, clip, chains=None):
    poses = _orig_sample_clip(skel, clip, chains)
    post = getattr(clip, "dunsom_post", None)
    if post is not None:                       # pinned bones (the death's released crook, its fallen hat)
        poses = post(skel, poses)
    pinned = getattr(clip, "dunsom_pinned", None)
    poses = [p if (pinned and pinned(f / max(1, clip.frames))) else _floor_crook(skel, p) for f, p in enumerate(poses)]
    poses = _hang_lantern(skel, poses, clip.loop)
    _brim_check(skel, poses, clip.name)
    return poses


_BRIM_LOGGED: set = set()


def _brim_check(skel, poses, name):
    """log (once per clip) frames where the lantern's body comes inside the hat's brim cylinder"""
    if name in _BRIM_LOGGED or "x_hat" not in skel.bones or "x_lantern" not in skel.bones:
        return
    _BRIM_LOGGED.add(name)
    worst, wf = 1e9, -1
    for f, p in enumerate(poses):
        M = skel.fk(p)
        Lm = M["x_lantern"]
        cen = Lm.translation + Lm.to_3x3().col[1].normalized() * 0.20
        q = M["x_hat"].inverted() @ cen
        rad = math.hypot(q.x, q.z)
        if -0.36 < q.y < 0.20:
            c = rad - (HAT_R + 0.115)
            if c < worst:
                worst, wf = c, f
    if worst < 0.0:
        scene.log(f"dunsom WARNING: {name} f{wf}: the lantern is {-worst * 100:.0f} cm inside the hat's brim")


anim.sample_clip = _sample_clip


# ── portrait / icon framing (render._fit_camera wrapper): the head boxes take in the hat's brim and the lantern ──
_orig_fit_camera = _render._fit_camera


def _fit_camera(cam, lo, hi, yaw, pitch, lens, fill, aspect, x_frac, y_center=None):
    arm = next((o for o in bpy.data.objects if o.type == "ARMATURE" and o.name.startswith(ID + "_")), None)
    if arm is not None and (hi.z - lo.z) < 1.0:
        pts = [V((HAT_C[0] - HAT_R, HAT_C[1], 1.95)), V((HAT_C[0] + HAT_R, HAT_C[1], 1.95))]
        if arm is not None and "head" in arm.pose.bones:
            mw = arm.matrix_world
            hb = arm.pose.bones["head"]
            pts = [mw @ hb.matrix @ V((x, hb.length * 0.85, 0.0)) for x in (-HAT_R, HAT_R)]
            if "x_lantern" in arm.pose.bones:
                lb = arm.pose.bones["x_lantern"]
                c = mw @ lb.head
                if (hi.z - lo.z) > 0.6:                 # the portrait: the whole lantern
                    pts += [c + V((dx, dy, dz)) for dx in (-0.12, 0.12) for dy in (-0.12, 0.12) for dz in (0.0, -0.47)]
                else:                                   # fix pass 1, the icon: the lantern's glowing middle at the edge
                    pts += [c + V((dx, dy, dz)) for dx in (-0.05, 0.05) for dy in (-0.05, 0.05) for dz in (-0.14, -0.32)]
        for q in pts:
            lo = V((min(lo.x, q.x - 0.06), min(lo.y, q.y - 0.06), lo.z))
            hi = V((max(hi.x, q.x + 0.06), max(hi.y, q.y + 0.06), max(hi.z, q.z + 0.10)))
        # the shared fit frames the box's height only: a square frame must be as tall as the box is wide
        w = max(hi.x - lo.x, hi.y - lo.y) * 0.92
        if aspect <= 1.01 and w > hi.z - lo.z:
            lo = V((lo.x, lo.y, hi.z - w))
    return _orig_fit_camera(cam, lo, hi, yaw, pitch, lens, fill, aspect, x_frac, y_center)


_render._fit_camera = _fit_camera

# fix pass 1 (review: the splash rendered the dark boots cream with white toes): the low hero camera sees the boots'
# tops at a 3-degree graze, where the Principled sheen mirrors the bright hazy horizon of the map sky (Vashil's and
# Marund's feet show it too); this all-felt-and-leather figure renders its splash / portrait / icon with the body's
# specular eased to SPEC_RENDER (the in-game material is untouched)
SPEC_RENDER = 0.12
_orig_fighter_renders = _render.fighter_renders


def _fighter_renders(ctx, objs, P, skin, *a, **k):
    saved = []
    if getattr(ctx.spec, "ID", None) == ID:
        for o in objs:
            if o.type != "MESH":
                continue
            for m in o.data.materials:
                if m is None or not m.use_nodes:
                    continue
                for nd in m.node_tree.nodes:
                    if nd.type == "BSDF_PRINCIPLED" and "Specular IOR Level" in nd.inputs:
                        inp = nd.inputs["Specular IOR Level"]
                        if not inp.is_linked:
                            saved.append((inp, inp.default_value))
                            inp.default_value = SPEC_RENDER
    try:
        return _orig_fighter_renders(ctx, objs, P, skin, *a, **k)
    finally:
        for inp, v in saved:
            inp.default_value = v


_render.fighter_renders = _fighter_renders


# ── the bind pose (fix pass 1; Kemdo's method): art.height is the hat's crown, never the crook's hook ────────
# The crook now stands 2.56 m (the brief's line over the disc), which would set the bind-pose top (art.json height,
# the three.js load-test gate, the HP bar). The model is sculpted, painted and baked with the crook upright in the
# fist; right after the bake (pipeline.split_forms wrapper) the right fist, the crook, the lantern, prop.R and their
# sockets are turned REST_TILT degrees forward about the right wrist, so the bind-pose top is the hat's crown. Every
# clip adds the inverse turn to hand.R before its IK (_comp), so every pose is exactly the upright-carry one; the
# paint_object wrapper turns them back for a re-paint on the cached .blend (proto/dunsom_paint.py).
REST_TILT = 60.0
REPOSE_PARTS = ("hand_R", "crook_shaft", "crook_grip", "crook_ferrule", "lantern_ring", "lantern_frame", "lantern_glass",
                "lantern_core", "almanac_pages", "almanac_cords")
REPOSE_BONES = ("hand.R", "prop.R", "x_lantern", "x_crook_hook", "x_crook_foot")
ART_LIFT = 0.0            # fix pass 2 (review: 2.11 is 6 cm over the brief's 2.05 crown): art.height IS the bind-pose
                          # crown (2.054 -> 2.05); the old +5 cm did not clear the brim's far edge anyway (from the
                          # 52 degree camera the far edge projects ~0.35 m over the crown)


def _turn(deg: float) -> np.ndarray:
    """4x4: `deg` about +X through the right wrist (positive tips the crook's head forward, -Y)."""
    R = sdf.rot_x(deg)
    M = np.eye(4)
    M[:3, :3] = R
    M[:3, 3] = W_R - R @ W_R
    return M


def _repose_mask(obj, names) -> np.ndarray | None:
    me = obj.data
    a = me.attributes.get("vale_part")
    if a is None or a.domain != "POINT":
        return None
    pv = np.empty(len(me.vertices), dtype=np.int64)
    a.data.foreach_get("value", pv)
    ids = [i for i, n in enumerate(names) if n in REPOSE_PARTS]
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
    Ml = np.linalg.inv(mw) @ M @ mw
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
    """Turn the right fist, the crook, the lantern (+ the accent core), prop.R and the crook's sockets to `deg` about
    the wrist (0 = the upright carry the sculpt, the paint and the bake use). Idempotent (`dunsom_rest_tilt`)."""
    arm = body.find_armature() or body.parent
    if arm is None or arm.type != "ARMATURE":
        return
    done = float(arm.get("dunsom_rest_tilt", 0.0))
    if abs(done - deg) < 1e-6:
        return
    M = _turn(deg - done)
    mask = _repose_mask(body, names)
    if mask is None:
        raise SystemExit("dunsom: no vale_part attribute on the body; cannot set the bind pose")
    _turn_vertices(body, M, mask)
    acc = bpy.data.objects.get(f"{ID}_accent")
    if acc is not None and acc.type == "MESH":
        _turn_vertices(acc, M)                       # the accent is the lantern's core only
    prev = bpy.context.view_layer.objects.active
    scene.select_only([arm], arm)
    bpy.ops.object.mode_set(mode="EDIT")
    Mm = Matrix([list(r) for r in M])
    for b in REPOSE_BONES:
        eb = arm.data.edit_bones.get(b)
        if eb is not None:
            eb.matrix = Mm @ eb.matrix.copy()
    bpy.ops.object.mode_set(mode="OBJECT")
    if prev is not None:
        bpy.context.view_layer.objects.active = prev
    arm["dunsom_rest_tilt"] = float(deg)
    scene.log(f"dunsom: bind pose crook tilt {done:.0f} -> {deg:.0f} deg ({int(mask.sum())} body verts)")


_orig_split_forms = _pipeline.split_forms


def _split_forms(body, parts, col):
    names = [p.name for p in parts]
    if "crook_shaft" in names and body.name.startswith(ID):
        set_rest_tilt(body, names, REST_TILT)
    return _orig_split_forms(body, parts, col)


_pipeline.split_forms = _split_forms
_orig_paint_object = _project.paint_object


def _paint_object(obj, size, cfg, names, part_attr="vale_part", log=print, return_maps=False):
    """Paint in the upright carry: a cached (re-posed) mesh is turned back for the paint pass only."""
    arm = obj.find_armature()
    tilt = float(arm.get("dunsom_rest_tilt", 0.0)) if arm is not None else 0.0
    if "crook_shaft" not in names or abs(tilt) < 1e-6:
        return _orig_paint_object(obj, size, cfg, names, part_attr=part_attr, log=log, return_maps=return_maps)
    mask = _repose_mask(obj, names)
    _turn_vertices(obj, _turn(-tilt), mask)
    try:
        log(f"dunsom: painting with the crook turned back {tilt:.0f} deg (the upright carry)")
        return _orig_paint_object(obj, size, cfg, names, part_attr=part_attr, log=log, return_maps=return_maps)
    finally:
        _turn_vertices(obj, _turn(tilt), mask)


_project.paint_object = _paint_object
_orig_art_fragment = _pipeline.art_fragment


def _art_fragment(spec, clips_info, mesh_top=None):
    frag = _orig_art_fragment(spec, clips_info, mesh_top)
    if getattr(spec, "ID", None) == ID and mesh_top:
        frag["height"] = round(float(mesh_top) + ART_LIFT, 2)
    return frag


_pipeline.art_fragment = _art_fragment
_orig_write_json = scene.write_json


def _write_json(path, data, *a, **k):
    """fix pass 2 (review: build_report height_m a stale 1.95 against art.height): the build report's height_m is the
    measured bind-pose crown (what art.height and the HP bar use); the rig's skull crown under the hat is kept as
    rig_crown_m (PROPORTIONS height 1.95 also drives the rig and the gradient, so it is not changed)"""
    if os.path.basename(str(path)).startswith(f"build_report_{ID}") and isinstance(data, dict) and data.get("mesh_top_m"):
        data = dict(data)
        data["rig_crown_m"] = data.get("height_m")
        data["height_m"] = round(float(data["mesh_top_m"]) + ART_LIFT, 2)
    return _orig_write_json(path, data, *a, **k)


scene.write_json = _write_json


def _rest_tilt(skel) -> float:
    arm = getattr(skel, "arm", None)
    return float(arm.get("dunsom_rest_tilt", 0.0)) if arm is not None else 0.0


def _hand_comp(skel):
    """3x3 basis that turns hand.R from the re-posed rest back to the upright carry (None when not re-posed)."""
    if not hasattr(skel, "_dunsom_comp"):
        tilt = _rest_tilt(skel)
        if abs(tilt) < 1e-6:
            skel._dunsom_comp = None
        else:
            H1 = skel.rest["hand.R"]
            T = Matrix([list(r) for r in _turn(tilt)])
            skel._dunsom_comp = (H1.inverted() @ T.inverted() @ H1).to_3x3()
    return skel._dunsom_comp


def _comp(skel, raw):
    """the inverse bind-pose turn on hand.R (raw poses, before the IK)"""
    C = _hand_comp(skel)
    if C is None:
        return raw
    from mathutils import Euler
    q = dict(raw)
    e = q.get("hand.R")
    B = Euler([math.radians(a) for a in e], "XYZ").to_matrix() if e else Matrix.Identity(3)
    q["hand.R"] = anim.Skeleton.euler_of(C @ B)
    return q


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
    if aim is not None:                                   # None: the hand has let go (the death's pinned crook)
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


TWIST_BACK = -75.0                        # ... and out-back (idle_lobby: the lantern beside the head)
TWIST_OUT = -35.0                         # prop.R's twist that turns the hook from out-forward to straight out
HAT_LEVEL = 0.5                           # share of the body's pitch / roll the hat takes back (brief: the disc level)


def level(fn, k=HAT_LEVEL):
    """the hat's disc stays near level: x_hat takes back k (HAT_LEVEL) of the summed hips..head pitch and roll (the
    brim tilts half as far as the head through bows and kneels; the stun takes back 80 %)"""
    def sample(t):
        p = dict(fn(t))
        sx = sum(p.get(b, (0.0, 0.0, 0.0))[0] for b in ("hips", "spine", "chest", "neck", "head"))
        sz = sum(p.get(b, (0.0, 0.0, 0.0))[2] for b in ("hips", "spine", "chest", "neck", "head"))
        h = p.get("x_hat", (0.0, 0.0, 0.0))
        p["x_hat"] = (h[0] - k * sx, h[1], h[2] - k * sz)
        return p
    return sample


def _finish(skel, fn):
    """every clip's last raw-pose step: the inverse bind-pose turn on hand.R (see the bind pose)"""
    def sample(t):
        return _comp(skel, fn(t))
    return sample


DEATH_FALL = (0.55, -0.83)        # the released crook topples toward his front-left, across his front
HAT_REST_AT = (-0.86, -0.40)      # where the fallen hat comes to rest (his right side, clear of the crook and knees)


def _death_pins(skel, clip, keys, t_let, t_land, t_hat0, t_hat1):
    """the death's world-pinned props (clip.dunsom_post, run on the resolved poses): the crook let go at t_let topples
    about its butt (gravity ease, a 4 degree rebound) and lies flat; the hat slides off at t_hat0, tumbles down and
    lands level at HAT_REST_AT, rocking to rest"""
    from mathutils import Quaternion
    N = clip.frames

    def post(skel_, poses):
        out = [dict(p) for p in poses]
        fL = int(round(t_let * N))
        M0 = skel_.fk(out[fL])
        W0 = M0["prop.R"].copy()
        butt = _crook_world(skel_, M0, crook_at(S_BUTT))
        piv = V((butt.x, butt.y, 0.0))
        a0 = W0.to_3x3().col[1].normalized()
        a1 = V((DEATH_FALL[0], DEATH_FALL[1], 0.0)).normalized()
        q_end = a0.rotation_difference(a1)
        fH = int(round(t_hat0 * N))
        Wh0 = skel_.fk(out[fH])["x_hat"].copy()
        Rr = skel_.rest["x_hat"].to_3x3()
        q_h1 = (Matrix.Rotation(math.radians(28.0), 3, "Z") @ Rr).to_quaternion()
        low = 0.032 + 0.004                               # the bone head over the brim's lowest point, + 4 mm
        p_h1 = V((HAT_REST_AT[0], HAT_REST_AT[1], low))
        p_h0 = Wh0.translation.copy()
        q_h0 = Wh0.to_3x3().to_quaternion()
        side = (p_h1 - p_h0)
        side.z = 0.0
        tumble_ax = V((0.0, 0.0, 1.0)).cross(side.normalized()) if side.length > 1e-4 else V((1.0, 0.0, 0.0))
        for f in range(len(out)):
            t = f / N
            p = out[f]
            if f >= fL:
                u = min(1.0, (t - t_let) / (t_land - t_let))
                e = u * u
                q = Quaternion().slerp(q_end, e)
                if t > t_land:                             # the rebound off the ground
                    r = (t - t_land) / 0.10
                    if r < 1.0:
                        q = Quaternion().slerp(q_end, 1.0 - 0.045 * math.sin(math.pi * r))
                lift = 0.036 * e
                W = (Matrix.Translation(piv + V((0.0, 0.0, lift))) @ q.to_matrix().to_4x4() @ Matrix.Translation(-piv)) @ W0
                _pin(skel_, p, "prop.R", W)
            if f >= fH:
                u = min(1.0, (t - t_hat0) / (t_hat1 - t_hat0))
                sm = u * u * (3 - 2 * u)
                pos = p_h0.lerp(p_h1, sm)
                pos.z = p_h0.z + (p_h1.z - p_h0.z) * (u ** 1.6) + 0.06 * math.sin(math.pi * u) * (1 - u)
                q = q_h0.slerp(q_h1, sm)
                q = Quaternion(tumble_ax, math.radians(34.0) * math.sin(math.pi * u)) @ q
                if t > t_hat1:                             # rocking to rest on the brim
                    r = (t - t_hat1)
                    a = math.radians(5.0) * math.exp(-r / 0.06) * math.cos(2 * math.pi * r / 0.08)
                    q = Quaternion(tumble_ax, a) @ q
                    pos = pos + V((0.0, 0.0, HAT_R * abs(math.sin(a))))
                W = Matrix.Translation(pos) @ q.to_matrix().to_4x4()
                _pin(skel_, p, "x_hat", W)
        return out
    clip.dunsom_post = post
    clip.dunsom_pinned = lambda t: t >= t_let


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
        r = anim.resolve(skel, _comp(skel, dict(p)))
        M = skel.fk(r)
        Rc = M["chest"].to_3x3() @ skel.rest["chest"].to_3x3().inverted()
        return tuple(Rc.inverted() @ (M["hand.L"].translation - M["upper_arm.L"].translation) / ARM)

    def lantern_at(p):
        r = anim.resolve(skel, _comp(skel, dict(p)))
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
    # (fix pass 2: the wind tilted the crook 3 degrees down and hung the lantern 0.13 m off the ground at f10-12: the
    # wind now carries it 11 degrees up, the fists 4 cm higher; the lantern's base stays >= ~0.45 m all through)
    wind = pose(torso=dict(hips=(6, 16, 0), spine=(4, 12, 0), chest=(5, 16, 0), neck=(0, -6, 0), head=(-2, -14, 0)),
                hips=(0, 0.02, -0.10), R=(0.22, -0.55, -0.58), aim=(0.80, -0.53, 0.20), slide=S, grip=0.36,
                feet=_feet(**crouch))
    gather = pose(torso=dict(hips=(3, 8, 0), spine=(2, 6, 0), chest=(3, 8, 0), head=(-1, -6, 0)), hips=(0, 0.01, -0.05),
                  R=(0.10, -0.45, -0.70), aim=(0.55, -0.40, 0.73), slide=S * 0.7, L=left_at(wind), Lp=(0.8, 0.4, -0.4))
    hit = pose(torso=dict(hips=(8, 0, 0), spine=(6, 0, 0), chest=(7, -2, 0), neck=(-2, 0, 0), head=(-4, 2, 0)),
               hips=(0, -0.03, -0.11), R=(-0.12, -0.46, -0.66), aim=(0.12, -0.97, 0.20), slide=S, grip=0.36,
               feet=_feet(**crouch))
    # fix pass 2 (review: f5-6 the lantern still hung at ground level from the down-turned hook): the follow-through
    # carries the crook UP out of the sweep (the hook end ~0.55 m over the fists), so the lantern rides at knee height
    fol = pose(torso=dict(hips=(6, -16, 0), spine=(5, -12, 0), chest=(6, -18, 0), neck=(0, 6, 0), head=(-2, 14, 0)),
               hips=(0, -0.02, -0.11), R=(0.20, -0.60, -0.60), aim=(-0.80, -0.45, 0.40), slide=S, grip=0.36,
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
    # the herding circle, small stepping hops); fix pass 1 (review: the hold read as a vertical crook hugged to the
    # chest): the drive is ONE LONG POINTING LINE: the crook slid out through the fist and levelled at the target, the
    # right arm fully extended, the left hand behind on the shaft (both hands, a lance), the lead foot stamping at f18
    # (the impact) with the lantern swinging forward; held to f30, relaxed by f45
    ring_R = (-0.62, -0.30, -0.12)
    ring_aim = (-0.92, -0.28, 0.27)

    ring = pose(torso=dict(hips=(3, 0, 0), spine=(2, 0, -3), chest=(2, 0, -4), neck=(0, 0, 2), head=(-2, 0, 3)),
                hips=(0, 0, -0.05), R=ring_R, aim=ring_aim, L=(0.30, -0.10, -0.70), Lp=(0.8, 0.3, -0.5))
    T0, T1 = 0.06, 0.35                                   # the full turn (the hips' yaw 0 -> 360, the feet stepping round)
    PT_AIM = (-0.04, -0.96, 0.27)                          # the line: forward, 15 degrees up toward the target
    PT_TORSO = dict(hips=(4, 10, 0), spine=(4, 6, 0), chest=(6, 8, 0), neck=(-4, -4, 0), head=(-7, -8, 0))
    lift = pose(torso=PT_TORSO, hips=(0, -0.04, -0.06), R=(-0.10, -0.92, 0.12), aim=PT_AIM, slide=0.45, grip=-0.34,
                feet=_feet(l=(0.0, -0.20, 0.10), r=(0.0, 0.08, 0.0), yl=6.0, yr=-10.0, pl=8.0))
    stamp = pose(torso=dict(hips=(7, 11, 0), spine=(6, 7, 0), chest=(7, 9, 0), neck=(-5, -4, 0), head=(-8, -8, 0)),
                 hips=(0, -0.10, -0.11), R=(-0.08, -0.99, 0.10), aim=PT_AIM, slide=0.62, grip=-0.36,
                 feet=_feet(l=(0.0, -0.32, 0.0), r=(0.0, 0.10, 0.0), yl=6.0, yr=-12.0))
    hold = pose(torso=dict(hips=(6, 10, 0), spine=(5, 7, 0), chest=(6, 9, 0), neck=(-4, -4, 0), head=(-7, -8, 0)),
                hips=(0, -0.09, -0.10), R=(-0.08, -0.98, 0.11), aim=PT_AIM, slide=0.62, grip=-0.36,
                feet=_feet(l=(0.0, -0.32, 0.0), r=(0.0, 0.10, 0.0), yl=6.0, yr=-12.0))
    k = [(0.0, G, "linear"), (0.08, ring, "inout"), (0.31, ring, "linear"),
         (0.36, anim.lerp_pose_w(ring, lift, 0.75, {"aim.R": 1.0}), "inout"),
         (0.40, stamp, "accel"), (0.46, hold, "out"), (0.67, hold, "linear"),
         (0.84, pose(R=(GUARD_R[0], GUARD_R[1] - 0.05, GUARD_R[2]), slide=0.10, L=(0.10, -0.30, -0.85)), "inout"),
         (1.0, G, "settle")]
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

    # DEATH (fix pass 1: the old end pose knelt upright holding the lit crook, a prayer): the blow rocks him, the right
    # hand opens and LETS GO (f8): the crook, pinned to the world, topples about its butt across his front and lands
    # flat on the ground (f28, a small rebound); his knees give, he sinks to a kneel and folds forward over his knees,
    # arms hanging; the hat slides off his bowed head and lands level on the ground at his right (f32)
    hip_h = skel.rest_point("hips").z
    T_LET, T_LAND = 0.16, 0.56
    T_HAT0, T_HAT1 = 0.40, 0.64
    hit = pose(torso=dict(hips=(-3, 2, 0), spine=(-3, 0, 2), chest=(-4, 2, 3), neck=(-2, 0, 0), head=(-6, 4, 4)),
               hips=(0, 0.03, -0.02))
    kfeet = _feet(l=(-0.06, 0.33, 0.04), r=(0.06, 0.35, 0.04), yl=4.0, yr=-6.0, pl=-62.0, pr=-62.0)   # boots clear of the coat
    limp_R = (-0.10, -0.20, -0.96)
    let_go = pose(torso=dict(hips=(2, 2, 2), spine=(6, 0, 3), chest=(8, 2, 4), neck=(6, 0, 0), head=(10, 4, 4)),
                  hips=(0.01, 0.03, -0.10), R=limp_R, aim=None, L=(0.10, -0.12, -0.92))
    kneel = pose(torso=dict(hips=(10, 3, 0), spine=(10, 0, 3), chest=(10, 3, 4), neck=(8, 0, 0), head=(12, 6, 6)),
                 hips=(0.02, 0.06, -(hip_h - 0.60)), R=(-0.06, -0.45, -0.85), aim=None, L=(0.06, -0.45, -0.85),
                 feet=kfeet)
    fold = pose(torso=dict(hips=(30, 4, 2), spine=(20, 0, 4), chest=(18, 3, 4), neck=(10, 0, 2), head=(14, 6, 6)),
                hips=(0.02, 0.14, -(hip_h - 0.44)), R=(-0.04, -0.62, -0.78), aim=None, L=(0.08, -0.62, -0.78),
                feet=kfeet)
    k = [(0.0, G, "linear"), (0.08, hit, "out"), (0.22, let_go, "inout"), (0.48, kneel, "in"),
         (0.56, anim.lerp_pose(kneel, fold, 0.45), "linear"), (0.74, fold, "out"),
         (0.80, anim.lerp_pose(fold, kneel, -0.06), "inout"), (0.90, fold, "inout"), (1.0, fold, "linear")]
    out["death"] = clip("death", 50, k)
    death_keys = k

    # RECALL: the crook lifted so the lantern hangs at eye level before him, the left hand cupped under it (loops)
    # (fix pass 1: the 2.56 m crook leans forward 40 degrees so the lantern still comes down to eye level)
    RC_R, RC_AIM, RC_S = (-0.22, -0.72, 0.02), (0.20, -0.35, 0.91), -0.30
    up_c = pose(torso=dict(chest=(-2, 6, 0), neck=(-2, 4, 0), head=(-2, 8, 0)), R=RC_R, aim=RC_AIM, slide=RC_S)
    lp = lantern_at(up_c)
    cup = lp + V((0.0, 0.0, -(LAN_BASE[1] + 0.05)))
    rc = pose(torso=dict(chest=(-2, 6, 0), neck=(-2, 4, 0), head=(-2, 8, 0)), R=RC_R, aim=RC_AIM, slide=RC_S, Lpos=tuple(cup),
              Lp=(0.9, 0.2, -0.3), fk=dict(hand_L=(-20, 0, 30)))
    scene.log(f"dunsom recall: lantern pivot at {tuple(round(v, 3) for v in lp)}, cupped hand at z {cup.z:.2f}")

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
    # (fix pass 1: the lolling summed to ~20 degrees of brim tilt: half the sway, and the hat takes back 80 %)
    st = pose(torso=dict(spine=(2, 0, 0), chest=(3, 0, 0), neck=(2, 0, 0), head=(4, 0, 0)), hips=(0, 0.02, -0.04),
              R=(-0.30, -0.35, -0.30), aim=(-0.15, -0.10, 0.98), grip=-0.40)

    def stun_s(t):
        a, b = math.sin(2 * math.pi * t), math.sin(2 * math.pi * (t + 0.25))
        p = anim.add(st, P_(hips=(0, 0, 2 * a), spine=(1 * b, 0, -1 * a), chest=(1 * b, 0, -2 * a), neck=(3 * b, 0, 3 * a),
                            head=(4 * b, 5 * a, 4 * a)))
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
    # (fix pass 1: with the 2.56 m crook an out-back hook hung the lantern into the brim: the hook stays out-forward,
    # the lantern in front of his right shoulder above the brim's height, the face clear)
    # fix pass 2 (review: the shaft ran down the middle of the mask, the lantern over the hat): he leans on the crook
    # planted just before his LEFT toe and resting against his RIGHT shoulder (the shaft leaning 15 degrees out, so it
    # passes 0.2 m right of the mask at face height, clear from the front and the 3/4 views), both hands stacked on it
    # at the right chest, the body turned 18 degrees toward it, the head back to the front; the hook a little more
    # outward so the lantern hangs beside the brim, not over it
    TW = dict(prop_R=(0, -20.0, 0))
    SR, SA, SS = (0.08, -0.56, -0.30), (-0.249, 0.040, 0.968), -0.045
    ST = dict(hips=(0, -6, 0), spine=(2, -5, 0), chest=(3, -7, 0), neck=(0, 6, 0), head=(2, 8, 0))
    stack = pose(torso=ST, hips=(0.0, 0.0, -0.01), R=SR, aim=SA, grip=0.12, slide=SS, fk=TW)
    look = pose(torso=dict(chest=(-2, -4, 0), neck=(-4, -6, 0), head=(-8, -14, 0)), R=(-0.20, -0.60, 0.12),
                aim=(-0.20, -0.30, 0.93), L=(0.10, -0.40, -0.70), fk=dict(prop_R=(0, -10.0, 0)))
    nod = lambda a: pose(torso=dict(hips=(0, -6, 0), spine=(2, -5, 0), chest=(3, -7, 0), neck=(2 + a, 6, 0), head=(4 + 2 * a, 8, 0)),
                         hips=(0.0, 0.0, -0.01), R=SR, aim=SA, grip=0.12, slide=SS, fk=TW)  # noqa: E731
    sky = pose(torso=dict(hips=(0, -6, 0), spine=(-2, -5, 0), chest=(-4, -7, 0), neck=(-8, 6, 0), head=(-16, 10, 0)),
               R=SR, aim=SA, grip=0.12, slide=SS, fk=TW)
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
    bow_t = dict(hips=(16, 0, 0), spine=(12, 0, 0), chest=(10, 0, 0), neck=(4, 0, 0), head=(4, 0, 0))
    bow0 = pose(torso=bow_t, hips=(0, 0.06, -0.02), R=(-0.42, -0.42, -0.22), aim=(-0.06, -0.05, 1.0),
                fk=dict(prop_R=(0, TWIST_OUT, 0)))
    # the left hand on the brim's front-left edge: found on the bowed (half-levelled) hat, the wrist 11 cm under it
    rb = anim.resolve(skel, dict(level(lambda t: bow0)(0.0)))
    Mh = skel.fk(rb)["x_hat"]
    brim_pt = Mh @ V((0.25, -0.012, 0.17))
    bow = pose(torso=bow_t, hips=(0, 0.06, -0.02), R=(-0.42, -0.42, -0.22), aim=(-0.06, -0.05, 1.0),
               Lpos=tuple(brim_pt - V((0.0, 0.0, 0.11))), Lp=(0.9, 0.2, -0.3),
               fk=dict(hand_L=(-10, -20, 30), prop_R=(0, TWIST_OUT, 0)))
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
        c.sample = _finish(skel, level(c.sample, 0.8 if c.name == "stunned" else HAT_LEVEL))
    _death_pins(skel, out["death"], death_keys, T_LET, T_LAND, T_HAT0, T_HAT1)
    return out


if __name__ == "__main__":
    fighter.main(sys.modules[__name__])
