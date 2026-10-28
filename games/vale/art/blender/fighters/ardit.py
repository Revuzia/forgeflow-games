"""ardit: Pavise bearer (Plinth, Aubade). ART 2.0: sculpted volumes painted by concept projection.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/ardit_plates.py            # plates (leg gap fixed)
    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/ardit_fit.py
    python3 art/build.py fighter ardit --no-skins --clip-sheet

Brief: _design/fighters/ardit.md. Concept: _design/concept/ardit.webp (front + back, hand-painted).
The forms are numpy SDF volumes (common/hifi/sdf.py) fitted to the concept on a 10 cm grid (the fit overlay:
proto/ardit_fit.py); the base colour is the concept painting projected occlusion-aware onto the game mesh
(the pipeline's PROJECTION hook) through this module's paint pass (below); normals and AO bake from the sculpt.

Where the concept and the brief disagree the concept's FORMS win (the approved look, as on Marund): the box helm
0.32 m wide with the T face opening (visor band over a nasal bar, the chin showing), shoulders 1.06 m across the
square stone pauldrons, chalk stone bracers, blue-grey gauntlet fists, a tall pavise (1.48 m, pointed foot) held
in the left fist with its ironstone double-diamond spire on the top corner, a 1.9 m spear held upright in the
right fist. The brief wins on what is banned and on materials: the concept's blue diamonds and the blue visor are
the `accent` inlays (team tint), never gems; the pane is glass (dawnglass), never emissive; no metal anywhere.

Not in the shared pipeline, implemented here (module-level wrappers; common/ untouched):
  * the arms' rest pose: rig.proportions is an A-pose; rig_extras re-places upper_arm / forearm / hand / prop on
    both sides onto the concept's carry (fists at the spear and at the pavise's grip), prop.R up the spear,
    prop.L up the pavise (its +Z = the pane's facing);
  * the paint (ardit_paint, installed over common/hifi/project.paint for this build): side planes of boxy parts are
    BOX-MAPPED onto their own front / back paint (SIDEMAP: no outline streaks), round parts' sides sample inset from
    the outline, up-facing tops of the helm / pauldrons / boots take their part's own front paint mapped by depth
    (TOPMAP), the spear head and shaft and the under-collar are painted from their own materials, the pane is the
    concept's own glass (the fist ghosted through it moves with it: both are rigid on the left hand), and a value
    soft-cap keeps every large area under L* 86 (the lit chalk crown is L* 87 on the sheet);
  * the skins: project.recolour wrapped so Chalkline gets its chalk line-work (frame + tabard) and First Bell its ten
    etched hour-marks, painted after the role recolour, then the value cap again;
  * the clips: an aim with a roll (AimRoll, both props: the spear's blade and the pavise's pane face where authored),
    the shared foot solver's pitch sign (flipped, as on Ulkro / Odrum), symmetric decimation only for centred parts,
    the base colour / ORM WebP quality (Q_BASE / Q_ORM) to keep the GLB under 1172 KiB.
"""
from __future__ import annotations

import math
import os
import sys
from dataclasses import dataclass

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy  # noqa: E402,F401
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

from common import anim, fighter, materials, rig, scene  # noqa: E402
from common.anim import Aim, FootTarget, HandTarget  # noqa: E402
from common.hifi import sdf  # noqa: E402
from common.hifi.sdf import (Capsule, Ellipsoid, FlatCapsule, HalfSpace, Prim, RoundBox, RoundCone,  # noqa: E402
                             Sculpt, Sphere, Torus, Tube)

V = Vector
ID = "ardit"
TITLE = "Pavise bearer"
ROLE_MASS = "plinth"
ORIGIN = "aubade"
CARD = {"primary": "#CFCAC0", "secondary": "#8496A8"}

# rig fitted to the sculpt: the head bone's crown 2.30 inside the helm (helm crown 2.35), skull base 2.025, shoulder
# joints x 0.42 at 1.82 (under the pauldrons), hips x 0.19 at 1.13, knees ~0.63, ankles x 0.255 at 0.13
PROPORTIONS = rig.proportions(height=2.30, head=0.32, neck=0.07, shoulder_width=0.84, hip_width=0.38, leg=1.002,
                              thigh_frac=0.50, arm=0.56, upper_arm_frac=0.53, hand=0.18, foot=0.36,
                              ankle_height=0.13, spine_curve=0.0, stance=0.065, toe_out_deg=11.0, knee_bend=0.016,
                              a_pose_deg=78.0, arm_forward_deg=4.0, elbow_bend_deg=20.0, shoulder_drop=0.135)
MATERIAL_SET = "bible"
PALETTE = materials.bible_palette(chalk="#D2CFC6", stone="#C9C6BE", cloth="#6F86A3", cloth2="#D9D6CE",
                                  dawnglass="#B8D0E2", leather="#3F3632", ironstone="#3D434B", under="#2F2C2B",
                                  wood="#A88B68", sandstone="#B98E6E", ink="#17181B", accent="#3F9CFF",
                                  gauntlet="#5E6F86")
VALUE_GRADIENT_STOPS = materials.BIBLE_GRADIENT_STOPS
SOCKETS = {"weapon": "prop.R", "weapon_tip": "x_spear_tip", "spear_tip": "x_spear_tip", "pavise_top": "x_pavise_top"}
SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92, "yaw": 22.0}
TEXTURE_SIZE = 2048
TEXTURE_SIZES = {"normal": 512, "orm": 512}
GLB_COMPRESS = True
ARMOUR_CONFORM = False
AO_INTO_BASE = 0.25

# ART 2.0 skins re-colour the projected painting part by part (each part's material role -> the skin palette);
# palettes: _design/fighters/ardit.md section 9 (identity hexes stepped by band where the brief says so)
SKINS: list = [
    {"id": "ardit_chalkline", "extra": {}, "card": {"primary": "#3A3F47", "secondary": "#E6E0D2"},
     "palette": {"chalk": "#BDBFC2", "stone": "#B9BEC4", "cloth": "#7A828D", "ironstone": "#3A3F47",
                 "under": "#2E3238", "gauntlet": "#4A5059", "cloth2": "#646A73"}},
    {"id": "ardit_first_bell", "extra": {"bell": True}, "card": {"primary": "#4A4640", "secondary": "#D8D2C4"},
     "palette": {"chalk": "#D8D2C4", "stone": "#CFC8BA", "cloth": "#8D8A84", "ironstone": "#38363A",
                 "leather": "#3A332D", "under": "#34322F", "gauntlet": "#5B5750"}},
]
SKIN_FLAT = {"bell_glass": "dawnglass", "bell_bail": "ironstone"}

HEIGHT = 2.35             # the helm's flat crown (the projection plates' scale)
PROJECTION = {"concept": "ardit", "height": HEIGHT}
NOISE = sdf.Noise(19)
VOXEL = 0.007

# ── the concept's carry (world, rest = bind pose; metres, Z up, the model faces -Y, his right = -X) ──────────
HX = -0.012                                   # the helm's centre line (the painted head sits 1 cm to his right)
S_R, S_L = np.array([-0.42, 0.01, 1.82]), np.array([0.42, 0.01, 1.82])         # shoulder joints
E_R, W_R = np.array([-0.47, 0.04, 1.535]), np.array([-0.57, -0.075, 1.345])    # right elbow, wrist
E_L, W_L = np.array([0.47, 0.04, 1.50]), np.array([0.535, -0.065, 1.255])      # left elbow, wrist
F_R = np.array([-0.612, -0.135, 1.300])       # right fist centre = the spear's grip
F_L = np.array([0.552, -0.135, 1.180])        # left fist centre = the pavise handle's grip
SPEAR_U = np.array([-0.146, 0.0, 1.0]) / math.hypot(0.146, 1.0)                # the spear leans 8 deg out
SPEAR_S = {"butt": -0.735, "shaft0": -0.66, "shaft1": 0.62, "collar0": 0.58, "knot": 0.665, "collar1": 0.75,
           "head0": 0.73, "tip": 1.19}
# the pavise: a slab in the plane y = PAV_Y (front face PAV_Y - PAV_T), outline (x, z) on the concept
PAV_Y, PAV_T = -0.235, 0.032                  # mid plane, half thickness (6.4 cm frame)
PAV_OUT = [(0.372, 1.842), (0.800, 1.842), (0.800, 0.585), (0.600, 0.355), (0.372, 0.560)]
PAV_FRAME_W = 0.052                           # the chalk frame's face width
LINE_W = 0.016                                # the accent line along the window's edge (on the frame's faces)
SPIRE_X = 0.640
DIAMONDS = [((0.630, 2.030), 0.052, 0.105), ((0.668, 1.800), 0.058, 0.118)]   # (centre x, z), half w, half h
INLAY_K = 0.62                                # inlay size / bezel size


def spear_at(s: float) -> np.ndarray:
    return F_R + SPEAR_U * s


# ── extra primitives ─────────────────────────────────────────────────────────────────────────────────────────
class Fn(Prim):
    """a custom distance function with explicit bounds"""

    def __init__(self, fn, lo, hi):
        self.fn, self.lo, self.hi = fn, np.asarray(lo, float), np.asarray(hi, float)

    def bounds(self):
        return self.lo, self.hi

    def d(self, P):
        return self.fn(P)


def poly2d(pts):
    """signed distance (approximate outside corners) to a convex CCW/CW polygon in (u, v)"""
    pts = np.asarray(pts, float)
    c = pts.mean(0)
    edges = []
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        t = (b - a) / np.linalg.norm(b - a)
        n = np.array([t[1], -t[0]])
        if (c - a).dot(n) > 0:
            n = -n
        edges.append((a, n))

    def d(u, v):
        out = None
        for a, n in edges:
            di = (u - a[0]) * n[0] + (v - a[1]) * n[1]
            out = di if out is None else np.maximum(out, di)
        return out
    return d


def inset(pts, w):
    """a convex polygon moved inward by w (each edge offset; vertices re-intersected)"""
    pts = np.asarray(pts, float)
    c = pts.mean(0)
    lines = []
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        t = (b - a) / np.linalg.norm(b - a)
        n = np.array([t[1], -t[0]])
        if (c - a).dot(n) < 0:
            n = -n
        lines.append((a + n * w, t))
    out = []
    for i in range(len(lines)):
        (p0, t0), (p1, t1) = lines[i - 1], lines[i]
        A = np.array([t0, -t1]).T
        s = np.linalg.solve(A, p1 - p0)
        out.append(p0 + t0 * s[0])
    return out


def slab(pts, y0, half_t, round_=0.0, axis_pts=None):
    """a convex polygon (x, z) extruded along Y about y0 (half thickness), edges rounded by round_"""
    f = poly2d(inset(pts, round_) if round_ > 0 else pts)
    pts = np.asarray(pts, float)
    lo = [pts[:, 0].min() - 0.01, y0 - half_t - 0.01, pts[:, 1].min() - 0.01]
    hi = [pts[:, 0].max() + 0.01, y0 + half_t + 0.01, pts[:, 1].max() + 0.01]

    def d(P):
        dp = f(P[:, 0], P[:, 2])
        dy = np.abs(P[:, 1] - y0) - (half_t - round_)
        q = np.stack([np.maximum(dp, 0), np.maximum(dy, 0)], 1)
        return np.linalg.norm(q, axis=1) + np.minimum(np.maximum(dp, dy), 0) - round_
    return Fn(d, lo, hi)


def _band(c, a, b, hz, r):
    """a belt band round the body: an elliptic cylinder (semi-axes a, b; half height hz) with rounded edges r (the body
    fills it; only its outer face and rims show)"""
    c = np.asarray(c, float)
    lo, hi = c - (a + 0.02, b + 0.02, hz + 0.02), c + (a + 0.02, b + 0.02, hz + 0.02)

    def d(P):
        x, y, z = P[:, 0] - c[0], P[:, 1] - c[1], P[:, 2] - c[2]
        q = np.sqrt((x / (a - r)) ** 2 + (y / (b - r)) ** 2)
        de = (q - 1.0) * min(a, b) * 0.98
        dz = np.abs(z) - (hz - r)
        w = np.stack([np.maximum(de, 0), np.maximum(dz, 0)], 1)
        return np.linalg.norm(w, axis=1) + np.minimum(np.maximum(de, dz), 0) - r
    return Fn(d, lo, hi)


def diamond(c, hw, hh, y0, half_t, round_=0.006):
    x, z = c
    return slab([(x, z + hh), (x + hw, z), (x, z - hh), (x - hw, z)], y0, half_t, round_)


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


def frame_of(u, w_hint):
    """rows = local X, Y, Z (world) with local Z along u and X toward w_hint"""
    return sdf.frame(u, w_hint)


# ── the sculpt ───────────────────────────────────────────────────────────────────────────────────────────────
def fist(name, F, u, out, knuckle_dir, sx):
    """a gauntlet fist round a bar along u through F: the back of the hand facing `out`, the knuckle row toward
    knuckle_dir, four curled fingers (segmented plates), the thumb over the index finger, a wrist cuff"""
    S = Sculpt(name)
    u = np.asarray(u, float) / np.linalg.norm(u)
    o = np.asarray(out, float)
    o = o - u * o.dot(u)
    o /= np.linalg.norm(o)
    kd = np.asarray(knuckle_dir, float)
    kd = kd - u * kd.dot(u) - o * kd.dot(o)
    kd /= np.linalg.norm(kd)
    r_bar = 0.026
    # the back of the hand: a plate outside the bar
    ax = np.stack([kd, o, u])                       # rows: local X (knuckles), Y (out), Z (along the bar)
    S.add(RoundBox(F + o * 0.040 - kd * 0.010, (0.050, 0.026, 0.062), 0.020, axes=ax), k=0.0)
    for i, h in enumerate((-0.045, -0.015, 0.015, 0.045)):
        c = F + u * h
        r = 0.020 if i in (1, 2) else 0.018
        pts = [c + o * 0.045 + kd * 0.030, c + kd * (r_bar + r) * 1.02 + o * 0.020, c + kd * (r_bar + r) * 0.8 - o * 0.020,
               c - o * (r_bar + r) * 0.98 + kd * 0.012, c - o * (r_bar + r) * 0.75 - kd * 0.022]
        S.add(Tube(pts, [r * 1.08, r, r, r * 0.95, r * 0.9], k=0.006), k=0.006)
        S.add(Sphere(c + o * 0.046 + kd * 0.034, r * 1.05), k=0.008)              # the knuckle
    # the thumb: from the back of the hand round over the index finger (top), pressing on the bar
    t0 = F + o * 0.03 - kd * 0.035 + u * 0.05
    S.add(Tube([t0, t0 + u * 0.03 - o * 0.02 + kd * 0.01, F + u * 0.075 - o * 0.035 + kd * 0.040],
               [0.022, 0.020, 0.018], k=0.008), k=0.012)
    # the wrist cuff: a short flared ring toward the forearm
    return S


def sculpts() -> list:
    """(name, Sculpt, voxel scale, material role, bind, tris) in build order"""
    out = []

    def part(name, S, role, bind, tris, vs=1.0):
        out.append((name, S, vs, role, bind, tris))

    # HELM (rigid on the head): a chalk box with a projecting crown ledge, the visor band, the T face opening
    helm = Sculpt("helm")
    box = RoundBox((HX, 0.0, 2.185), (0.160, 0.170, 0.163), 0.024)
    helm.add(box.displaced(chips(0.008, 8.0), 0.008), k=0.0)
    helm.add(RoundBox((HX, 0.0, 2.302), (0.167, 0.177, 0.046), 0.016).displaced(chips(0.009, 7.0), 0.009), k=0.004)
    helm.sub(RoundBox((HX, -0.18, 2.236), (0.136, 0.05, 0.028), 0.006), k=0.004)           # the visor band
    # the face opening below the visor: the cheek guards' inner edges slant inward toward the chin
    helm.sub(slab([(HX - 0.098, 2.212), (HX + 0.098, 2.212), (HX + 0.084, 1.96), (HX - 0.084, 1.96)], -0.17, 0.07, 0.008), k=0.006)
    helm.add(RoundBox((HX, -0.163, 2.133), (0.022, 0.016, 0.082), 0.008), k=0.006)          # the nasal bar
    helm.add(RoundBox((HX, -0.172, 2.214), (0.050, 0.010, 0.010), 0.006), k=0.006)          # the nasal's brow root
    helm.inter(HalfSpace((0, 0, 2.018), (0, 0, -1), 0.5), k=0.0)
    part("helm", helm, "chalk", "bone:head", 1500)
    visor = Sculpt("visor")
    visor.add(RoundBox((HX, -0.148, 2.236), (0.130, 0.010, 0.022), 0.006), k=0.0)
    part("visor", visor, "accent", "bone:head", 120, 0.6)
    face = Sculpt("face")
    face.add(Ellipsoid((HX, -0.02, 2.11), (0.118, 0.132, 0.120)), k=0.0)
    face.add(RoundBox((HX, -0.115, 2.035), (0.060, 0.035, 0.035), 0.030), k=0.03)            # the chin
    face.add(Ellipsoid((HX, -0.133, 2.105), (0.020, 0.016, 0.034)), k=0.012)                  # the nose under the nasal
    face.sub(Capsule((HX - 0.028, -0.152, 2.062), (HX + 0.028, -0.152, 2.062), 0.0045), k=0.004)  # the mouth
    part("face", face, "sandstone", "bone:head", 600, 0.7)

    # NECK + GORGET (the pale stone collar, rigid on the chest)
    neck = Sculpt("neck")
    neck.add(FlatCapsule((0, 0.008, 1.84), (0, 0.004, 2.045), 0.128, 0.152, 0.112, 0.130, side=(1, 0, 0)), k=0.0)
    part("neck", neck, "leather", "auto", 300)
    gorget = Sculpt("gorget")
    gorget.add(Torus((0, 0.0, 1.925), 0.175, 0.060, axes=np.diag([1.0, 0.24 / 0.20, 1.0]), rz=0.055).displaced(chips(0.006, 9.0), 0.006), k=0.0)
    gorget.add(RoundBox((-0.01, -0.185, 1.915), (0.225, 0.045, 0.058), 0.026, axes=sdf.rot_x(-12)).displaced(chips(0.007, 8.0), 0.007), k=0.03)
    for sx in (-1, 1):                              # the notched lower edge of the bib
        gorget.sub(slab([(sx * 0.13, 1.86), (sx * 0.21, 1.86), (sx * 0.17, 1.885)], -0.21, 0.06, 0.004), k=0.004)
    part("gorget", gorget, "stone", "bone:chest", 760)

    # PAULDRONS: the square honed upper plates (rigid on the shoulders) and the lower tiers (on the upper arms)
    for s, sx in (("R", -1), ("L", 1)):
        pu = Sculpt(f"pauldron_{s}")
        tilt = sdf.rot_y(sx * 8)
        pu.add(RoundBox((sx * 0.385, 0.0, 1.915), (0.148, 0.218, 0.080), 0.034, axes=tilt).displaced(chips(0.009, 7.0), 0.009), k=0.0)
        pu.add(RoundBox((sx * 0.365, -0.005, 1.995), (0.118, 0.182, 0.026), 0.016, axes=tilt).displaced(chips(0.007, 9.0), 0.007), k=0.006)
        pu.sub(Capsule((sx * 0.25, -0.225, 1.975), (sx * 0.52, -0.225, 1.955), 0.007), k=0.004)   # the front lip line
        part(f"pauldron_{s}", pu, "stone", f"bone:shoulder.{s}", 560)
        pl = Sculpt(f"tier_{s}")
        pl.add(RoundBox((sx * 0.470, 0.005, 1.742), (0.080, 0.185, 0.066), 0.030, axes=sdf.rot_y(sx * 14)).displaced(chips(0.008, 8.0), 0.008), k=0.0)
        part(f"tier_{s}", pl, "stone", f"bone:upper_arm.{s}", 420)

    # TORSO (the blued cuirass, heat weights)
    torso = Sculpt("cuirass")
    torso.add(Ellipsoid((0, 0.0, 1.70), (0.355, 0.245, 0.29)), k=0.0)
    torso.add(RoundBox((0, 0.0, 1.76), (0.30, 0.205, 0.15), 0.12), k=0.08)
    torso.add(Ellipsoid((0, 0.01, 1.50), (0.350, 0.235, 0.18)), k=0.10)
    for sx in (-1, 1):
        torso.add(Sphere((sx * 0.37, 0.01, 1.79), 0.135), k=0.08)
        torso.add(RoundBox((sx * 0.125, -0.205, 1.69), (0.115, 0.04, 0.095), 0.045), k=0.035)    # pec plates
    torso.sub(Capsule((0, -0.255, 1.82), (0, -0.25, 1.50), 0.006), k=0.004)                       # the centre seam
    for z in (1.585, 1.525):                                                                    # abdomen bands
        torso.sub(Torus((0, 0.01, z), 0.30, 0.006, axes=np.diag([1.0, 0.30 / 0.235, 1.0])), k=0.004)
    part("cuirass", torso, "cloth", "auto", 2000)
    sleeves = Sculpt("sleeves")
    for E, S in ((E_R, S_R), (E_L, S_L)):
        sx = np.sign(S[0])
        sleeves.add(FlatCapsule(S + (sx * 0.01, 0.0, -0.02), E + (0, 0, -0.03), 0.098, 0.100, 0.092, 0.095, side=(1, 0, 0)).displaced(
            folds(0.007, 40.0, axis=2), 0.007), k=0.0)
    part("sleeves", sleeves, "cloth", "auto", 860)

    # BRACERS (chalk stone, rigid on the forearms) and the GAUNTLET FISTS (rigid on the hands)
    for s, E, W in (("R", E_R, W_R), ("L", E_L, W_L)):
        d = (W - E) / np.linalg.norm(W - E)
        br = Sculpt(f"bracer_{s}")
        a, b = E + d * 0.06, W + d * 0.005
        br.add(FlatCapsule(a, b, 0.098, 0.094, 0.090, 0.086, side=(1, 0, 0)).displaced(chips(0.008, 8.0), 0.008), k=0.0)
        br.add(Torus(b - d * 0.012, 0.080, 0.016, axes=sdf.frame(d)), k=0.006)
        br.add(Torus(a + d * 0.025, 0.093, 0.016, axes=sdf.frame(d)), k=0.006)
        br.sub(Torus(a + d * 0.11, 0.098, 0.006, axes=sdf.frame(d)), k=0.003)
        part(f"bracer_{s}", br, "stone", f"bone:forearm.{s}", 420)
    fr = fist("fist_R", F_R, SPEAR_U, (-0.85, 0.35, 0.0), (0.15, -1.0, 0.0), -1)
    fr.add(Torus(W_R + (W_R - E_R) * 0.05, 0.062, 0.020, axes=sdf.frame(W_R - E_R)), k=0.02)
    part("fist_R", fr, "gauntlet", "bone:hand.R", 580, 0.7)
    fl = fist("fist_L", F_L, (0, 0, 1), (0.85, 0.35, 0.0), (-0.1, -1.0, 0.0), 1)
    fl.add(Torus(W_L + (W_L - E_L) * 0.05, 0.062, 0.020, axes=sdf.frame(W_L - E_L)), k=0.02)
    part("fist_L", fl, "gauntlet", "bone:hand.L", 520, 0.7)

    # BELT + BUCKLE
    belt = Sculpt("belt")
    belt.add(_band((0.0, 0.008, 1.445), 0.352, 0.268, 0.042, 0.014), k=0.0)
    for x in (-0.24, -0.15, 0.15, 0.24):
        belt.add(Sphere((x, -0.255 + 0.06 * (abs(x) > 0.2), 1.445), 0.012), k=0.004)
    part("belt", belt, "leather", "auto", 560)
    buckle = Sculpt("buckle")
    buckle.add(RoundBox((0.0, -0.268, 1.445), (0.072, 0.022, 0.058), 0.012), k=0.0)
    buckle.sub(RoundBox((0.0, -0.29, 1.445), (0.042, 0.03, 0.030), 0.006), k=0.004)
    buckle.add(RoundBox((0.0, -0.262, 1.445), (0.040, 0.012, 0.028), 0.006), k=0.004)
    part("buckle", buckle, "ironstone", "bone:hips", 220, 0.7)

    # COAT SKIRT (cloth, heat weights): flared from the belt to the hem at 0.80; the tabard panels hang over it
    coat = Sculpt("coat")
    c0 = FlatCapsule((0, 0.012, 0.86), (0, 0.008, 1.42), 0.400, 0.335, 0.330, 0.250, side=(1, 0, 0))
    coat.add(c0.displaced(folds(0.012, 15.0, axis=0, zfade=(1.30, 0.85)), 0.012), k=0.0)
    coat.inter(HalfSpace((0, 0, 0.80), (0, 0, -1), 2.0), k=0.012)
    coat.sub(slab([(-0.165, 1.40), (0.165, 1.40), (0.175, 0.70), (-0.175, 0.70)], -0.36, 0.06, 0.01), k=0.02)   # the front opening
    part("coat", coat, "cloth", "auto", 1600)
    for s, sx in (("R", -1), ("L", 1)):
        tb = Sculpt(f"tabard_{s}")
        c = (sx * 0.086, -0.302, 1.0175)
        pan = RoundBox(c, (0.082, 0.016, 0.3925), 0.010, axes=sdf.rot_x(-6.5))
        tb.add(pan.displaced(folds(0.008, 26.0, axis=0, phase=sx * 1.1, zfade=(1.3, 0.7)), 0.008), k=0.0)
        part(f"tabard_{s}", tb, "cloth2", ("chain", f"tabard_{s.lower()}", "hips"), 420)

    # LEGS (dark leggings, heat weights), the greaves and knee cops (ironstone, rigid on the shins), boots
    legs = Sculpt("legs")
    for sx in (-1, 1):
        legs.add(FlatCapsule((sx * 0.185, 0.0, 1.10), (sx * 0.235, -0.012, 0.64), 0.150, 0.145, 0.125, 0.120, side=(1, 0, 0)).displaced(
            folds(0.010, 30.0, axis=2), 0.010), k=0.0)
        legs.add(FlatCapsule((sx * 0.235, -0.012, 0.66), (sx * 0.255, 0.02, 0.16), 0.110, 0.105, 0.080, 0.085, side=(1, 0, 0)), k=0.05)
    part("legs", legs, "under", "auto", 800)
    for s, sx in (("R", -1), ("L", 1)):
        gr = Sculpt(f"greave_{s}")
        gr.add(FlatCapsule((sx * 0.256, 0.018, 0.15), (sx * 0.248, 0.004, 0.53), 0.112, 0.108, 0.118, 0.114, side=(1, 0, 0)).displaced(
            chips(0.006, 9.0), 0.006), k=0.0)
        gr.add(Torus((sx * 0.248, 0.008, 0.555), 0.112, 0.034, axes=np.diag([1.0, 0.95, 1.0])), k=0.01)              # the top cuff
        gr.add(RoundBox((sx * 0.252, -0.088, 0.33), (0.085, 0.030, 0.165), 0.024), k=0.02)                            # the shin plate
        gr.add(Capsule((sx * 0.252, -0.118, 0.18), (sx * 0.252, -0.118, 0.47), 0.010), k=0.01)                        # its ridge
        part(f"greave_{s}", gr, "ironstone", f"bone:shin.{s}", 560)
        kn = Sculpt(f"knee_{s}")
        hexa = [(sx * 0.248 + dx, z) for dx, z in ((-0.125, 0.70), (-0.06, 0.775), (0.06, 0.775), (0.125, 0.70),
                                                   (0.11, 0.55), (0.0, 0.515), (-0.11, 0.55))]
        hexa = sorted(hexa, key=lambda p: math.atan2(p[1] - 0.645, p[0] - sx * 0.248))
        kn.add(slab(hexa, -0.118, 0.040, 0.020), k=0.0)
        kn.add(Ellipsoid((sx * 0.248, -0.090, 0.645), (0.115, 0.07, 0.11)), k=0.03)
        kn.sub(Capsule((sx * 0.248 - 0.11, -0.165, 0.625), (sx * 0.248 + 0.11, -0.165, 0.625), 0.006), k=0.004)
        part(f"knee_{s}", kn, "ironstone", f"bone:shin.{s}", 420)
    boots = Sculpt("boots")
    for sx in (-1, 1):
        rz = sdf.rot_z(sx * 11)
        boots.add(RoundBox((sx * 0.268, -0.055, 0.075), (0.120, 0.190, 0.075), 0.055, axes=rz), k=0.0)
        boots.add(FlatCapsule((sx * 0.258, 0.02, 0.06), (sx * 0.257, 0.02, 0.19), 0.122, 0.118, 0.118, 0.115, side=(1, 0, 0)), k=0.04)
        boots.add(RoundBox((sx * 0.272, -0.05, 0.022), (0.128, 0.198, 0.022), 0.012, axes=rz), k=0.008)              # the welted sole
    boots.inter(HalfSpace((0, 0, 0.0), (0, 0, -1), 2.0), k=0.0)
    part("boots", boots, "leather", "auto", 1000)

    # SPEAR (prop.R): ash shaft, the chalk collar with its knot, the dawnglass leaf head, the chalk butt
    shaft = Sculpt("spear_shaft")
    shaft.add(Capsule(spear_at(SPEAR_S["shaft0"]), spear_at(SPEAR_S["shaft1"]), 0.0215), k=0.0)
    part("spear_shaft", shaft, "wood", "bone:prop.R", 260, 0.6)
    col = Sculpt("spear_collar")
    col.add(RoundCone(spear_at(SPEAR_S["collar0"]), spear_at(SPEAR_S["knot"] - 0.02), 0.030, 0.024), k=0.0)
    col.add(Ellipsoid(spear_at(SPEAR_S["knot"]), (0.038, 0.030, 0.045), axes=frame_of(SPEAR_U, (1, 0, 0))), k=0.01)
    col.add(RoundCone(spear_at(SPEAR_S["knot"] + 0.02), spear_at(SPEAR_S["collar1"]), 0.026, 0.017), k=0.008)
    col.add(RoundCone(spear_at(SPEAR_S["butt"]), spear_at(SPEAR_S["shaft0"] + 0.01), 0.010, 0.031), k=0.0)       # the butt cap
    part("spear_collar", col, "chalk", "bone:prop.R", 360, 0.6)
    head = Sculpt("spear_head")
    L = SPEAR_S["tip"] - SPEAR_S["head0"]
    bw = 0.046
    R = (0.25 * L * L * 0.25 * 4 + bw * bw) / (2 * bw)
    ax = frame_of(SPEAR_U, (1, 0, 0))               # local X across the blade, Y its thickness (front), Z along
    c = spear_at(SPEAR_S["head0"] + L * 0.5)

    def leaf(P):
        q = (P - c) @ ax.T
        u, t, v = q[:, 0], q[:, 1], q[:, 2]
        # vesica (pointed both ends), the base end blunted into the collar; a diamond section (ridge)
        d1 = np.sqrt((u - (R - bw)) ** 2 + v ** 2) - R
        d2 = np.sqrt((u + (R - bw)) ** 2 + v ** 2) - R
        d = np.maximum(d1, d2)
        dt = np.abs(t) + 0.30 * np.abs(u) - 0.011
        return np.maximum(d, dt * 0.9)
    lo, hi = c - 0.30, c + 0.30
    head.add(Fn(leaf, lo, hi), k=0.0)
    part("spear_head", head, "dawnglass", "bone:prop.R", 220, 0.5)

    # PAVISE (prop.L): the chalk frame, the glass pane, the leather handle, the ironstone spire + diamond inlays
    frame = Sculpt("pavise_frame")
    frame.add(slab(PAV_OUT, PAV_Y, PAV_T, 0.012).displaced(chips(0.006, 8.0), 0.006), k=0.0)
    win = inset(PAV_OUT, PAV_FRAME_W)
    frame.sub(slab(win, PAV_Y, PAV_T + 0.03, 0.0), k=0.008)
    part("pavise_frame", frame, "chalk", "bone:prop.L", 820)
    pane = Sculpt("pavise_pane")
    pane.add(slab(inset(PAV_OUT, PAV_FRAME_W - 0.012), PAV_Y + 0.004, 0.0085, 0.004), k=0.0)
    part("pavise_pane", pane, "dawnglass", "bone:prop.L", 160, 0.6)
    # the concept's thin pale-blue line round the window, on both faces of the frame: the dawnglass edge catching the
    # light (`accent`, the team tint: with the visor and the spire inlays about 2 % of the game-camera silhouette)
    line = Sculpt("pane_line")
    for sgn in (-1, 1):
        yy = PAV_Y + sgn * (PAV_T + 0.0015)
        line.add(slab(inset(PAV_OUT, PAV_FRAME_W - LINE_W), yy, 0.0045, 0.002), k=0.0)
    line.sub(slab(inset(PAV_OUT, PAV_FRAME_W + 0.002), PAV_Y, PAV_T + 0.02, 0.0), k=0.0)
    part("pane_line", line, "accent", "bone:prop.L", 420, 0.5)
    handle = Sculpt("pavise_handle")
    handle.add(Capsule(F_L + (0, 0, -0.10), F_L + (0, 0, 0.10), 0.024), k=0.0)
    for dz in (-0.10, 0.10):
        handle.add(RoundCone(F_L + (0, 0, dz), (F_L[0], PAV_Y + 0.0125 + 0.030, F_L[2] + dz * 1.3), 0.022, 0.026), k=0.01)
    part("pavise_handle", handle, "leather", "bone:prop.L", 220, 0.7)
    spire = Sculpt("spire")
    spire.add(RoundCone((SPIRE_X + 0.02, PAV_Y, 1.70), (SPIRE_X - 0.01, PAV_Y, 2.15), 0.026, 0.012), k=0.0)
    for (cx, cz), hw, hh in DIAMONDS:
        spire.add(diamond((cx, cz), hw, hh, PAV_Y, PAV_T + 0.012, 0.008).displaced(chips(0.004, 10.0), 0.004), k=0.008)
        for sgn in (-1, 1):                         # the inlay pockets, front and back
            spire.sub(diamond((cx, cz), hw * INLAY_K + 0.008, hh * INLAY_K + 0.012, PAV_Y + sgn * (PAV_T + 0.012), 0.010, 0.004), k=0.003)
    part("spire", spire, "ironstone", "bone:prop.L", 520, 0.6)
    inl = Sculpt("inlays")
    for (cx, cz), hw, hh in DIAMONDS:
        for sgn in (-1, 1):
            inl.add(diamond((cx, cz), hw * INLAY_K, hh * INLAY_K, PAV_Y + sgn * (PAV_T + 0.006), 0.006, 0.003), k=0.0)
    part("inlays", inl, "accent", "bone:prop.L", 160, 0.5)
    return out


def skin_extras(extra: dict) -> list:
    """First Bell's small glass bell (0.08 m) on a rigid 3 cm bail above the spire tip (duller than the inlays)"""
    out = []
    if extra.get("bell"):
        top = np.array([SPIRE_X - 0.012, PAV_Y, 2.15])
        bail, bell = Sculpt("bell_bail"), Sculpt("bell_glass")
        bail.add(Torus(top + (0, 0, 0.026), 0.016, 0.005, axes=sdf.rot_x(90)), k=0.0)
        bail.add(Capsule(top, top + (0, 0, 0.012), 0.007), k=0.004)

        def bell_prof(r, z):
            rr = 0.016 + 0.024 * np.clip((0.052 - z) / 0.052, 0, 1) ** 1.6
            return np.maximum(np.maximum(r - rr, z - 0.052), -z)
        bell.add(sdf.Lathe(top + (0, 0, -0.010), bell_prof, 0.045, 0.0, 0.055, axes=sdf.rot_x(180)), k=0.0)
        out.append(("bell_bail", bail, 0.4, "ironstone", "bone:prop.L", 120))
        out.append(("bell_glass", bell, 0.5, "dawnglass", "bone:prop.L", 200))
    return out


def extra_materials(ctx) -> dict:
    """`gauntlet`: the concept's blue-grey stone gauntlets (a role the bible set lacks, so a skin can re-colour the
    fists apart from the cuirass)"""
    return {"gauntlet": materials.honed_stone("gauntlet", ctx.palette, "gauntlet", ctx.gradient, rough=0.66, chisel=0.8)}


def model(ctx) -> list:
    _install()
    _SKIN["id"] = (ctx.skin or {}).get("id")
    P = []
    extra = (ctx.skin or {}).get("extra") or {}
    for name, S, vs, role, bind, tris in sculpts() + skin_extras(extra):
        v, q = S.mesh(VOXEL * vs)
        ob = sdf.to_object(f"{name}_high", v, q, ctx.col)
        ob.data.materials.append(ctx.mats[role])
        P.append(fighter.Part(name, high=ob, tris=tris, bind=bind))
    return P


# ── build wrappers (this build process only; common/ untouched) ──────────────────────────────────────────────
# one-sided parts decimate without the X-mirror constraint (it is meaningless off the centre line)
SYM = ("helm", "visor", "face", "neck", "gorget", "cuirass", "sleeves", "belt", "buckle", "coat", "legs", "boots")
Q_BASE = 70                # the base colour's WebP quality (the shared default 80 left the GLB over 1172 KiB)
Q_ORM = 64                 # occlusion / roughness (shared default 72)


def _install_build() -> None:
    from common import export, mesh
    if not getattr(mesh.decimate_to, "_ardit", False):
        orig_d = mesh.decimate_to

        def decimate_to(obj, target_tris, symmetric=True):
            nm = obj.name[:-4] if obj.name.endswith("_low") else obj.name
            if not nm.startswith(SYM):
                symmetric = False
            return orig_d(obj, target_tris, symmetric)
        decimate_to._ardit = True
        mesh.decimate_to = decimate_to
    if not getattr(export.optimize, "_ardit", False):
        orig_o = export.optimize

        def optimize(path, out=None, quantize=False, fighter=False):
            if not fighter:
                return orig_o(path, out, quantize, fighter)
            import subprocess
            out = out or path
            script = os.path.join(scene.TOOLS_DIR, "optimize.mjs")
            node = export.node_exe()
            before = os.path.getsize(path)
            if not node or not os.path.isfile(script):
                return orig_o(path, out, quantize, fighter)
            args = [node, script, path, out] + (["--quantize"] if quantize else []) + ["--fighter", "--q-base", str(Q_BASE), "--q-orm", str(Q_ORM)]
            r = subprocess.run(args, cwd=scene.GAME_DIR, capture_output=True, text=True, encoding="utf-8")
            if r.returncode != 0:
                scene.log(f"optimize failed ({r.returncode}): {r.stderr.strip()[:800]}")
                return {"ok": False, "before": before, "after": before, "error": r.stderr[-800:]}
            scene.log(r.stdout.strip())
            return {"ok": True, "before": before, "after": os.path.getsize(out), "q_base": Q_BASE, "q_orm": Q_ORM}
        optimize._ardit = True
        export.optimize = optimize


_install_build()


# ── rig ──────────────────────────────────────────────────────────────────────────────────────────────────────
def rig_extras(ctx) -> None:
    """the arms onto the concept's carry, the props' frames, the tabard chains, the VFX sockets"""
    info = ctx.info
    arm = info.armature
    scene.select_only([arm], arm)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    for s, E, W, F, pu in (("R", E_R, W_R, F_R, SPEAR_U), ("L", E_L, W_L, F_L, np.array([0.0, 0.0, 1.0]))):
        sh = V(eb[f"upper_arm.{s}"].head)
        elv, wrv, fv = V(tuple(E)), V(tuple(W)), V(tuple(F))
        up_d, fo_d = (elv - sh).normalized(), (wrv - elv).normalized()
        hd = (fv - wrv).normalized()
        eb[f"upper_arm.{s}"].tail = elv
        eb[f"forearm.{s}"].head = elv
        eb[f"forearm.{s}"].tail = wrv
        eb[f"hand.{s}"].head = wrv
        eb[f"hand.{s}"].tail = wrv + hd * 0.10
        # rolls: local +Z = the direction of flexion (rig.py: +X rotation flexes)
        bend = fo_d - up_d * fo_d.dot(up_d)
        if bend.length < 1e-3:
            bend = V((0, -1, 0))
        eb[f"upper_arm.{s}"].align_roll(bend)
        eb[f"forearm.{s}"].align_roll(-up_d - fo_d * (-up_d).dot(fo_d))
        eb[f"hand.{s}"].align_roll(-up_d - hd * (-up_d).dot(hd))
        eb[f"prop.{s}"].head = fv
        eb[f"prop.{s}"].tail = fv + V(tuple(pu)) * 0.12
        eb[f"prop.{s}"].align_roll(V((0.0, -1.0, 0.0)))
        info.joints[f"elbow.{s}"], info.joints[f"wrist.{s}"] = elv, wrv
        info.joints[f"palm.{s}"] = fv
        info.joints[f"forearm_dir.{s}"], info.joints[f"arm_dir.{s}"] = fo_d, up_d
    bpy.ops.object.mode_set(mode="OBJECT")
    for b in arm.data.bones:
        info.lengths[b.name] = b.length
    for s, sx in (("l", 1), ("r", -1)):
        ctx.chains[f"tabard_{s}"] = rig.add_chain(info, f"tabard_{s}", "hips",
                                                  [V((sx * 0.086, -0.27, 1.40)), V((sx * 0.086, -0.345, 0.66))])
    rig.add_socket(info, "x_spear_tip", "prop.R", tuple(spear_at(SPEAR_S["tip"])), tuple(SPEAR_U * 0.08), z_hint=(0, -1, 0))
    rig.add_socket(info, "x_pavise_top", "prop.L", (SPIRE_X - 0.01, PAV_Y, 2.15), (0, 0, 0.08), z_hint=(0, -1, 0))


def chain_config(ctx) -> list:
    """the tabard panels: one bone each, hanging with gravity, pushed forward by their own thigh"""
    def push(side):
        def f(p):
            return min(28.0, 0.5 * max(0.0, p.get(f"thigh.{side}", (0.0,))[0]))      # never flipped up like a board
        return f
    return [anim.ChainCfg(ctx.chains["tabard_l"], gravity=0.8, stiffness=150.0, damping=16.0, inertia=0.5, drive=push("L")),
            anim.ChainCfg(ctx.chains["tabard_r"], gravity=0.8, stiffness=150.0, damping=16.0, inertia=0.5, drive=push("R"))]


# ── paint (Ardit's wrap of common/hifi/project.paint; common/ is shared, so it lives here) ──────────────────
SIDE_INSET = 0.045         # m: sideways texels of round parts sample their part's paint this far inside the outline
# sideways texels of boxy parts are BOX-MAPPED (review lesson: no projection streaks on side planes): a side face of
# depth D wraps onto the outer band (band = frac x the part's width) of its own front paint for its front half and of
# its own back paint for its back half, so it carries the painted bevels, cracks and seams instead of one pixel
# stretched along Y. mode "wrap" = front then back; "back" = the back plate only (the helm: its front band is the visor
# and the face opening, its back is plain carved chalk). Parts in PAIRS hold both sides (left/right halves apart).
SIDEMAP = {"helm": (0.42, "back"), "pauldron_R": (0.50, "wrap"), "pauldron_L": (0.50, "wrap"),
           "tier_R": (0.50, "wrap"), "tier_L": (0.50, "wrap"), "boots": (0.45, "wrap"), "greave_R": (0.45, "wrap"),
           "greave_L": (0.45, "wrap"), "knee_R": (0.40, "wrap"), "knee_L": (0.40, "wrap"), "bracer_R": (0.45, "wrap"),
           "bracer_L": (0.45, "wrap"), "gorget": (0.28, "wrap"), "cuirass": (0.22, "wrap"), "coat": (0.20, "wrap"),
           "legs": (0.40, "wrap"), "sleeves": (0.45, "wrap"), "fist_R": (0.45, "wrap"), "fist_L": (0.45, "wrap"),
           "pavise_frame": (0.06, "wrap"), "belt": (0.10, "wrap")}
PAIRS = ("boots", "legs", "sleeves")
TOPMAP = {                 # up-facing texels: the part's own front paint, depth (y) mapped onto this z band
    "helm": (2.262, 2.335), "pauldron_R": (1.935, 1.995), "pauldron_L": (1.935, 1.995), "tier_R": (1.70, 1.78),
    "tier_L": (1.70, 1.78), "boots": (0.03, 0.12), "gorget": (1.88, 1.95), "cuirass": (1.70, 1.80),
    "greave_R": (0.45, 0.53), "greave_L": (0.45, 0.53), "bracer_R": (1.40, 1.48), "bracer_L": (1.40, 1.48),
    "belt": (1.415, 1.475),
}
BASE_TONE = {}             # part: (target median hex, hue strength, gamma) after the first look
# the value cap (brief: no large area lighter than L* 86): albedo luminance above KNEE (L* ~80) is compressed by SLOPE,
# so the concept's lit chalk crown (median L* 87) lands near L* 84 and its brightest licks near L* 88
KNEE_Y, SLOPE = 0.56, 0.55


def _lin(c):
    c = np.asarray(c, dtype=np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def _hex(h):
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (1, 3, 5)], dtype=np.float32)


def _ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def _glass(p, n, base="#C7D6E0", seed=0.0):
    """the spear head: pale cool glass with soft diagonal glints"""
    b = _hex(base)
    u = p[:, 0] * 2.2 + p[:, 2] * 1.0 + seed
    streak = np.clip(np.sin(u * 9.0) * 1.4 - 0.6, 0, 1) * 0.5 + np.clip(np.sin(u * 23.0 + 1.0) * 2.0 - 1.6, 0, 1) * 0.35
    lift = 0.88 + 0.10 * (p[:, 2] - p[:, 2].min()) / max(1e-6, np.ptp(p[:, 2])) + 0.08 * streak
    col = b[None, :] * lift[:, None]
    col = col * (1 - 0.25 * streak[:, None]) + np.array([0.93, 0.96, 0.98])[None, :] * 0.25 * streak[:, None]
    return np.clip(col, 0, 1)


def _wood(p, base="#A1855F"):
    b = _hex(base)
    g = 0.5 + 0.5 * np.sin((p[:, 0] * 37.0 + p[:, 1] * 41.0) + 3.0 * NOISE(p * np.array([1.0, 1.0, 0.15]), 6.0))
    return np.clip(b[None, :] * (0.86 + 0.20 * g[:, None]), 0, 1)


def _collar(p, n, base="#4A3B33"):
    """the concept's dark brown under-collar in the gorget's ring: soft folds, darker down into the ring"""
    b = _hex(base)
    f = 0.5 + 0.5 * np.sin(np.arctan2(p[:, 1], p[:, 0]) * 9.0 + 2.0 * NOISE(p, 9.0))
    shade = 0.80 + 0.22 * f - 0.25 * np.clip((1.93 - p[:, 2]) / 0.08, 0, 1)
    return np.clip(b[None, :] * shade[:, None], 0, 1)


def ardit_paint(maps, plates, vis, names, tops=None, flat=None, eps=0.02, bleed=True, log=print):
    from common.hifi import project as pj
    P, N, part = maps["P"], maps["N"], maps["part"]
    size = maps["size"]
    out = np.zeros((size, size, 3), dtype=np.float32)
    have = part >= 0
    flat = flat or {}
    # the concept figure mask: plate pixels outside it are padding (blurred neighbours, often the pale floor or another
    # part); a texel whose sample lands there takes its own part's nearest paint instead (no bleeding between parts)
    from common import scene as _sc
    fig = pj.load_rgb(os.path.join(_sc.CACHE_DIR, "concept", f"{ID}_mask.png"))[..., 0] > 0.5
    fills = {}
    for side in ("front", "back"):
        pid = vis.part[side]
        s = vis.step
        small = plates.img[side][s // 2::s, s // 2::s][:pid.shape[0], :pid.shape[1]]
        fsmall = fig[s // 2::s, s // 2::s][:pid.shape[0], :pid.shape[1]]
        for k in np.unique(part[have]):
            valid = (pid == k) & fsmall
            if not valid.any():
                valid = pid == k
            if not valid.any():
                continue
            iy, ix = pj.nearest_index(valid)
            fills[(side, int(k))] = pj.blur(small[iy, ix], 1.0)

    def off_figure(px, py):
        H, W = fig.shape
        return ~fig[np.clip(np.round(py).astype(np.int64), 0, H - 1), np.clip(np.round(px).astype(np.int64), 0, W - 1)]
    idx = np.nonzero(have)
    p = P[idx]
    n = N[idx]
    k = part[idx].astype(np.int64)
    M = len(p)
    # part centre lines (x) for the round parts' side inset (pairs: per side)
    cx = np.zeros(M, dtype=np.float32)
    for i in range(len(names)):
        sel = k == i
        if not sel.any():
            continue
        if names[i] in PAIRS:
            for sg in (1, -1):
                ss_ = sel & (np.sign(p[:, 0] + 1e-6) == sg)
                if ss_.any():
                    cx[ss_] = float(np.median(p[ss_, 0]))
        else:
            cx[sel] = float(np.median(p[sel, 0]))
    OWN_IDS = [names.index(nm) for nm in ("spear_head", "spear_shaft", "neck") if nm in names]
    st = np.abs(n[:, 0]) / (np.abs(n[:, 0]) + np.abs(n[:, 1]) + 1e-6)
    ws = _ss(0.55, 0.90, st)
    xs = p[:, 0] - np.sign(p[:, 0] - cx) * SIDE_INSET * ws
    xs = np.where(np.sign(xs - cx) != np.sign(p[:, 0] - cx), cx, xs)
    # box-mapped sides
    box = np.zeros(M, dtype=bool)
    xf, xb = p[:, 0].copy(), p[:, 0].copy()
    fb = np.zeros(M, dtype=np.float32)               # the back plate's share on a box-mapped side texel
    for name, (frac, mode) in SIDEMAP.items():
        if name not in names:
            continue
        i = names.index(name)
        selp = k == i
        if not selp.any():
            continue
        groups = [selp & (p[:, 0] >= 0), selp & (p[:, 0] < 0)] if name in PAIRS else [selp]
        for g in groups:
            if g.sum() < 20:
                continue
            gp = p[g]
            xlo, xhi = np.percentile(gp[:, 0], 1), np.percentile(gp[:, 0], 99)
            y0, y1 = np.percentile(gp[:, 1], 2), np.percentile(gp[:, 1], 98)
            band = frac * (xhi - xlo)
            sel = g & (ws > 0)
            if not sel.any():
                continue
            sg = np.sign(n[sel, 0])
            f = np.clip((p[sel, 1] - y0) / max(1e-4, y1 - y0), 0, 1)
            xf[sel] = p[sel, 0] - sg * band * f
            xb[sel] = p[sel, 0] - sg * band * (1 - f)
            fb[sel] = 1.0 if mode == "back" else _ss(0.30, 0.70, f)
            box |= sel
    zs = p[:, 2].copy()
    # up-facing texels of TOPMAP parts: box-mapped from the part's own front paint
    wt = _ss(0.55, 0.85, n[:, 2])
    for name, (z0, z1) in TOPMAP.items():
        if name not in names:
            continue
        i = names.index(name)
        sel = (k == i) & (wt > 0)
        if not sel.any():
            continue
        allp = p[k == i]
        y0, y1 = np.percentile(allp[:, 1], 2), np.percentile(allp[:, 1], 98)
        f = np.clip((p[sel, 1] - y0) / max(1e-6, y1 - y0), 0, 1)
        zt = z1 - f * (z1 - z0)
        zs[sel] = zs[sel] * (1 - wt[sel]) + zt * wt[sel]
    soft = {s_: pj.blur(plates.img[s_], 2.5) for s_ in ("front", "back")}
    cols, bcols = {}, {}
    for side in ("front", "back"):
        px, py = plates.to_px(side, xs, zs)
        c = pj.bilinear(plates.img[side], px, py)
        c = c * (1 - ws[:, None]) + pj.bilinear(soft[side], px, py) * ws[:, None]
        dep, hid = vis.lookup(side, *plates.to_px(side, p[:, 0], p[:, 2]))
        if side == "front":
            hidden = ~(p[:, 1] <= np.nan_to_num(dep, nan=1e9) + eps)
        else:
            hidden = ~(p[:, 1] >= np.nan_to_num(dep, nan=-1e9) - eps)
        hidden &= ~(wt > 0.5)
        hidden |= off_figure(px, py) & ~np.isin(k, OWN_IDS)
        for kk in np.unique(k[hidden]):
            f = fills.get((side, int(kk)))
            if f is None:
                continue
            sel = hidden & (k == kk)
            c[sel] = pj.bilinear(f, px[sel] / vis.step, py[sel] / vis.step)
        cols[side] = c
        # the box-mapped sample: the plate at the wrapped x where that pixel shows this part, else its own fill
        bx = np.where(box, xf if side == "front" else xb, xs)
        qx, qy = plates.to_px(side, bx[box], zs[box])
        cb = pj.bilinear(plates.img[side], qx, qy)
        _, hid2 = vis.lookup(side, qx, qy)
        other = (hid2 != k[box]) | off_figure(qx, qy)
        for kk in np.unique(k[box][other]):
            f = fills.get((side, int(kk)))
            if f is None:
                continue
            sel = other & (k[box] == kk)
            cb[sel] = pj.bilinear(f, qx[sel] / vis.step, qy[sel] / vis.step)
        bcols[side] = cb
    wb = _ss(-0.25, 0.25, n[:, 1])
    col = cols["front"] * (1 - wb[:, None]) + cols["back"] * wb[:, None]
    if box.any():
        cbox = bcols["front"] * (1 - fb[box, None]) + bcols["back"] * fb[box, None]
        w = ws[box, None]
        col[box] = col[box] * (1 - w) + cbox * w
    # own-material parts
    own = {"spear_head": lambda pp, nn: _glass(pp, nn, "#CFE0EA", 1.3), "spear_shaft": lambda pp, nn: _wood(pp),
           "neck": _collar}
    for name, fn in own.items():
        if name in names:
            sel = k == names.index(name)
            if sel.any():
                col[sel] = fn(p[sel], n[sel])
    lin = _lin(col)
    Y = 0.2126 * lin[:, 0] + 0.7152 * lin[:, 1] + 0.0722 * lin[:, 2]
    # tone: each part's painted median onto its brief colour (linear-light gain), value structure kept
    for name, (hexc, hue, gam) in BASE_TONE.items():
        if name not in names:
            continue
        sel = k == names.index(name)
        if not sel.any():
            continue
        cur = np.median(lin[sel], axis=0)
        tgt = _lin(_hex(hexc))
        lum = lambda c: 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]  # noqa: E731
        y = lum(lin[sel])
        ym, yt = max(1e-4, float(lum(cur))), float(lum(tgt))
        yy = yt * np.power(np.maximum(y / ym, 1e-4), gam)
        chroma = lin[sel] / np.maximum(y[:, None], 1e-4)
        ch_t = tgt / max(1e-4, yt)
        ch_c = cur / ym
        chroma = chroma * (1 - hue) + (chroma / np.maximum(ch_c, 1e-4) * ch_t) * hue
        lin[sel] = chroma * yy[:, None]
    Y = 0.2126 * lin[:, 0] + 0.7152 * lin[:, 1] + 0.0722 * lin[:, 2]
    Yc = np.where(Y > KNEE_Y, KNEE_Y + (Y - KNEE_Y) * SLOPE, Y)
    lin = lin * (Yc / np.maximum(Y, 1e-5))[:, None]
    col = _srgb(lin)
    for name, rgb in flat.items():
        if name in names:
            col[k == names.index(name)] = np.asarray(rgb, dtype=np.float32)
    out[idx] = col
    if bleed:
        iy, ix = pj.nearest_index(have)
        out = out[iy, ix]
    log(f"ardit paint: {len(fills)} part fills, {int((ws > 0).sum())} side texels ({int(box.sum())} box-mapped), "
        f"{int((wt > 0).sum())} top texels")
    return out


# ── skins (base painting re-coloured by role in the pipeline; the brief's surface marks painted on top here) ─────
_SKIN = {"id": None}
LINEWORK = "#E6E0D2"           # Chalkline's chalk line-work (thin lines only; exempt from the L* 86 area rule)
HOUR_INK = "#4F4A42"           # First Bell's etched hour-marks (carved, never emissive)


def _frame_inside(x, z):
    """distance inside the pavise outline (m, + inside), on the frame's face plane"""
    return -poly2d(PAV_OUT)(x, z)


def _chalk(img_lin, sel, mask, rgb, p):
    """lay a chalk colour over the masked texels with a dry-chalk grain (coverage 0.72-1.0)"""
    if not mask.any():
        return
    grain = 0.72 + 0.28 * np.clip(0.5 + 0.9 * NOISE(p[mask] * np.array([1.0, 1.0, 1.0]), 70.0), 0, 1)
    tgt = _lin(_hex(rgb))[None, :]
    ii = np.nonzero(sel)[0][mask]
    img_lin[ii] = img_lin[ii] * (1 - grain[:, None]) + tgt * grain[:, None]


def _skin_marks(img, maps, names, sid, log=print):
    """Chalkline: chalk line-work drawn across the pavise frame (two rails + diagonal strokes between them) and the
    tabard panels (a border and three rising chevrons); First Bell: ten etched hour-marks across the frame (four on
    each side rail, two on the top), front and back"""
    P, N, part = maps["P"], maps["N"], maps["part"]
    have = part >= 0
    idx = np.nonzero(have)
    p, n, k = P[idx], N[idx], part[idx]
    lin = _lin(img[idx])
    drawn = 0
    if "pavise_frame" in names:
        sel = (k == names.index("pavise_frame")) & (np.abs(n[:, 1]) > 0.6)
        fp = p[sel]
        d = _frame_inside(fp[:, 0], fp[:, 2])
        if sid == "ardit_chalkline":
            rails = (np.abs(d - 0.012) < 0.0038) | (np.abs(d - 0.040) < 0.0038)
            u = (fp[:, 0] * 0.8 + fp[:, 2]) / 0.075
            strokes = (np.abs((u % 1.0) - 0.5) < 0.07) & (d > 0.012) & (d < 0.040)
            m = rails | strokes
            _chalk(lin, sel, m, LINEWORK, fp)
            drawn += int(m.sum())
        elif sid == "ardit_first_bell":
            m = np.zeros(len(fp), dtype=bool)
            rails_x = (PAV_OUT[0][0] + PAV_FRAME_W / 2, PAV_OUT[1][0] - PAV_FRAME_W / 2)
            for xr in rails_x:
                for zc in (0.78, 1.04, 1.30, 1.56):
                    m |= (np.abs(fp[:, 2] - zc) < 0.0045) & (np.abs(fp[:, 0] - xr) < 0.019)
            for xc in (0.52, 0.66):
                m |= (np.abs(fp[:, 0] - xc) < 0.0045) & (np.abs(fp[:, 2] - (PAV_OUT[0][1] - PAV_FRAME_W / 2)) < 0.019)
            ink = _lin(_hex(HOUR_INK))[None, :]
            ii = np.nonzero(sel)[0][m]
            lin[ii] = lin[ii] * 0.25 + ink * 0.75
            drawn += int(m.sum())
    if sid == "ardit_chalkline":
        for nm, sx in (("tabard_R", -1), ("tabard_L", 1)):
            if nm not in names:
                continue
            sel = (k == names.index(nm)) & (np.abs(n[:, 1]) > 0.5)
            tp = p[sel]
            xc = sx * 0.086
            ax = np.abs(tp[:, 0] - xc)
            border = ((np.abs(ax - 0.064) < 0.004) & (tp[:, 2] > 0.665)) | ((np.abs(tp[:, 2] - 0.672) < 0.004) & (ax < 0.068))
            chev = np.zeros(len(tp), dtype=bool)
            for z0 in (0.76, 0.84, 0.92):
                chev |= (np.abs(tp[:, 2] - (z0 + 0.0 - ax * 0.55)) < 0.0042) & (ax < 0.050)
            m = border | chev
            _chalk(lin, sel, m, LINEWORK, tp)
            drawn += int(m.sum())
    out = img.copy()
    out[idx] = _srgb(lin)
    log(f"ardit skin marks ({sid}): {drawn} texels")
    return out


def _cap(img):
    """the value soft-cap (KNEE_Y / SLOPE) over a whole sRGB atlas"""
    lin = _lin(img)
    Y = 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]
    Yc = np.where(Y > KNEE_Y, KNEE_Y + (Y - KNEE_Y) * SLOPE, Y)
    return _srgb(lin * (Yc / np.maximum(Y, 1e-5))[..., None]).astype(np.float32)


def _install() -> None:
    from common.hifi import project
    if not getattr(project.recolour, "_ardit", False):
        orig = project.recolour

        def recolour(img, maps, names, roles, base_pal, skin_pal, skip=None, log=print):
            out = orig(img, maps, names, roles, base_pal, skin_pal, skip=skip, log=log)
            if _SKIN["id"] in ("ardit_chalkline", "ardit_first_bell"):
                out = _skin_marks(out, maps, names, _SKIN["id"], log=log)
            return _cap(out)
        recolour._ardit = True
        project.recolour = recolour
    _install_paint()


def _install_paint() -> None:
    from common.hifi import project
    if getattr(project.paint, "_ardit", False):
        return
    ardit_paint._ardit = True
    project.paint = ardit_paint


# ── motion (brief §8) ────────────────────────────────────────────────────────────────────────────────────────
# Arms are blocked with IK (anim.HandTarget rel: the wrist from the posed shoulder joint in the chest frame, in arm
# lengths; the helpers take metres) and BOTH props are aimed with a roll (AimRoll): the spear's axis + where its blade
# faces, the pavise's axis (up its height) + where its pane faces. Aims are in armature space (+X his left, -Y front).
HT, FT = HandTarget, FootTarget
SH_R, SH_L = np.array([-0.42, 0.03, 1.8198]), np.array([0.42, 0.03, 1.8198])      # the rig's shoulder joints
L_R = float(np.linalg.norm(E_R - SH_R) + np.linalg.norm(W_R - E_R))
L_L = float(np.linalg.norm(E_L - SH_L) + np.linalg.norm(W_L - E_L))
REST_R, REST_L = W_R - SH_R, W_L - SH_L
POLE_R, POLE_L = (-0.70, 0.60, -0.40), (0.70, 0.60, -0.40)
FRONT, UP = (0.0, -1.0, 0.0), (0.0, 0.0, 1.0)
SPEAR0 = tuple(float(c) for c in SPEAR_U)       # the spear's rest axis (upright, 8 deg out)
LEVEL = (0.0, 0.0, -1.0)                        # the blade's face roll when the spear is levelled forward
PAV0 = (0.06, 0.0, 0.998)                       # the pavise's guard axis (top edge leaning out a little)


def _n(v):
    v = np.asarray(v, dtype=float)
    return v / max(1e-9, np.linalg.norm(v))


def _yawd(v, deg):
    """a direction turned about Z by deg (+ = toward his left, like the body's yaw)"""
    a = math.radians(deg)
    x, y, z = v
    return (x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a), z)


@dataclass
class AimRoll(anim.Aim):
    """anim.Aim + `up`: where the held item's +Z faces (the spear blade's flat, the pavise's pane)"""
    up: tuple = (0.0, -1.0, 0.0)

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


def _install_anim() -> None:
    """the roll after the shared aim; and the shared foot solver's pitch sign (on VALE_BIPED_1 the foot's local X runs
    along -X, so FootTarget.pitch turns the toes DOWN about the heel: flipped here, pivot kept, as Ulkro/Odrum do)"""
    if not getattr(anim._solve_aim, "_ardit", False):
        orig = anim._solve_aim

        def solve(skel, pose, M, side, am):
            orig(skel, pose, M, side, am)
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
        solve._ardit = True
        anim._solve_aim = solve
    if not getattr(anim._solve_foot, "_ardit", False):
        orig_f = anim._solve_foot

        def solve_f(skel, pose, M, side, ft):
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
            orig_f(skel, pose, M, side, ft)
        solve_f._ardit = True
        anim._solve_foot = solve_f


_install_anim()


def rh(v, aim=SPEAR0, up=FRONT, pole=POLE_R) -> dict:
    """the spear hand: wrist offset (m, chest frame) from the right shoulder; the spear's axis and blade facing"""
    return {"hand.R": HT(rel=tuple(float(c) / L_R for c in v), pole=tuple(pole)),
            "aim.R": AimRoll(tuple(_n(aim)), 1.0, tuple(up))}


def rhp(pos, aim=SPEAR0, up=FRONT, pole=POLE_R) -> dict:
    """the spear hand at an absolute wrist position (planted / grounded)"""
    return {"hand.R": HT(pos=tuple(pos), pole=tuple(pole)), "aim.R": AimRoll(tuple(_n(aim)), 1.0, tuple(up))}


def lh(v, aim=PAV0, face=FRONT, pole=POLE_L) -> dict:
    """the pavise hand: wrist offset (m, chest frame) from the left shoulder; the pavise's axis and pane facing"""
    return {"hand.L": HT(rel=tuple(float(c) / L_L for c in v), pole=tuple(pole)),
            "aim.L": AimRoll(tuple(_n(aim)), 1.0, tuple(face))}


def lhp(pos, aim=PAV0, face=FRONT, pole=POLE_L) -> dict:
    return {"hand.L": HT(pos=tuple(pos), pole=tuple(pole)), "aim.L": AimRoll(tuple(_n(aim)), 1.0, tuple(face))}


def feet_(l=(0.0, 0.0, 0.0), r=(0.0, 0.0, 0.0), yl=0.0, yr=0.0, pl=0.0, pr=0.0, kl=0.0, kr=0.0) -> dict:
    return anim.feet(l=l, r=r, yl=yl, yr=yr, pl=pl, pr=pr, kl=kl, kr=kr)


FEET0 = feet_(l=(0.01, -0.01, 0.0), r=(-0.01, 0.01, 0.0), yl=2.0, yr=-2.0)          # the concept's square stance
R0 = rh(tuple(REST_R))
L0 = lh(tuple(REST_L))


def pz(lean=3.0, yaw=0.0, roll=0.0, drop=0.03, dx=0.0, dy=0.0, look=(0.0, 0.0, 0.0), feet=None, R=None, L=None,
       extra=None) -> dict:
    """a body pose: lean / yaw / roll spread over hips, spine and chest, the head held level toward the front (look =
    extra head pitch / yaw / roll), hips dropped by `drop`, feet planted by IK, both props aimed"""
    p = anim.merge(anim.arms_relaxed(), anim.P(
        hips=(lean * 0.40, yaw * 0.30, roll * 0.5), spine=(lean * 0.30, yaw * 0.30, -roll * 0.3),
        chest=(lean * 0.30, yaw * 0.40, -roll * 0.2),
        neck=(-lean * 0.45 + look[0] * 0.4, -yaw * 0.40 + look[1] * 0.4, look[2] * 0.4),
        head=(-lean * 0.45 + look[0] * 0.6, -yaw * 0.50 + look[1] * 0.6, look[2] * 0.6)))
    p["hips_loc"] = (dx, dy, -drop)
    ik = dict(feet if feet is not None else FEET0)
    ik.update(R if R is not None else R0)
    ik.update(L if L is not None else L0)
    p["ik"] = ik
    if extra:
        p = anim.add(p, extra)
    return p


def G(**kw) -> dict:
    """the guard: the concept's carry, the pavise at his left, the spear upright in the right fist"""
    return pz(**kw)


def clip(name, N, keys, loop=False, impact=None, lags=None) -> anim.Clip:
    fn = anim.keyed(keys)
    if lags:
        fn = anim.drag(fn, N, lags, loop=loop)
    return anim.Clip(name, N, loop, fn, impact=impact)


def strike(name, N, wind, hit, fol, g=None) -> anim.Clip:
    keys = anim.strike_keys(MOTION, wind, hit, fol, guard_pose=g or G())
    return clip(name, N, keys, impact=anim.IMPACT, lags={"head": 1.5, "neck": 1.0})


def _m(v):
    return tuple(float(c) for c in v)


# run: the spear carried upright (leaning into the run), a short heavy arm swing; the pavise held back and low on the
# left, its pane turned out so it never hides the legs (aims added in gen_run: the shared run aims only the right hand)
BLOCKS: dict = {
    "guard": (_m(REST_R / L_R), POLE_R, SPEAR0, _m(REST_L / L_L), POLE_L),
    "run_fwd": (_m(np.array([-0.12, -0.22, -0.44]) / L_R), POLE_R, (-0.10, -0.22, 0.97),
                _m(np.array([0.13, -0.07, -0.54]) / L_L), POLE_L),
    "run_back": (_m(np.array([-0.15, 0.04, -0.47]) / L_R), POLE_R, (-0.12, 0.02, 0.99),
                 _m(np.array([0.14, 0.06, -0.54]) / L_L), POLE_L),
}
MOTION = anim.motion_profile(weight="heavy", weapon="one_hand", stance="wide", run_ref_speed=3.35, blocks=BLOCKS,
                             arm_swing=0.7)
RUN_LEAN = anim.P(hips=(2.0, 0, 0), spine=(1.5, 0, 0), chest=(1.0, 0, 0), neck=(-2.0, 0, 0), head=(-2.5, 0, 0))
RUN_PAV = (0.10, -0.20, 0.975)                  # the pavise's axis in the run: the top tipped forward and out
RUN_FACE = (0.62, -0.78, 0.0)                   # its pane turned out 38 deg (edge-on enough to keep the legs clear)


def gen_run() -> anim.Clip:
    c = anim.gen_run(MOTION)
    base = c.sample

    def sample(t):
        p = anim.add(base(t), RUN_LEAN)
        ik = dict(p["ik"])
        a = ik.get("aim.R")
        if a is not None:
            ik["aim.R"] = AimRoll(a.dir, a.weight, FRONT)
        sw = math.cos(2 * math.pi * (t - 0.03))
        ik["aim.L"] = AimRoll(tuple(_n(np.array(RUN_PAV) + np.array([0.0, -0.04 * sw, 0.0]))), 1.0, RUN_FACE)
        p["ik"] = ik
        return p
    return anim.Clip("run", c.frames, True, sample, meta=c.meta)


def gen_idle() -> anim.Clip:
    base = G()
    N = 80

    def sample(t):
        b = anim.osc(t, 2)
        s = anim.osc(t, 1, 0.1)
        d = anim.P(chest=(1.2 * b, 0, 0), spine=(0.5 * b, 0, 0.5 * s), neck=(-0.8 * b, 0, 0), head=(-0.4 * b, 1.5 * s, 0),
                   shoulder_L=(0, 0, 1.0 * b), shoulder_R=(0, 0, -1.0 * b), hips=(0, 1.0 * s, -0.8 * s))
        p = anim.add(base, d)
        p = anim._nudge_hands(p, (0.0, 0.0, 0.010 * anim.osc(t, 2, 0.08)), (0.0, 0.0, 0.008 * anim.osc(t, 2, 0.15)))
        ik = dict(p["ik"])
        ik["aim.L"] = AimRoll(tuple(_n(np.array(PAV0) + np.array([0.015 * s, 0.0, 0.0]))), 1.0, _yawd(FRONT, 2.0 * s))
        p["ik"] = ik
        return anim._with_hips(p, (0.010 * s, 0.0, -0.004 * (0.5 + 0.5 * b)))

    return anim.Clip("idle", N, True, sample)


# feet
FEET_THRUST = feet_(l=(0.03, -0.30, 0.0), r=(-0.02, 0.10, 0.0), yl=4.0, yr=-14.0, pr=-10.0)
FEET_BASH = feet_(l=(0.04, -0.32, 0.0), r=(-0.02, 0.08, 0.0), yl=-6.0, yr=-10.0, pr=-8.0)
FEET_CHARGE = feet_(l=(0.03, -0.40, 0.0), r=(-0.03, 0.24, 0.03), yl=0.0, yr=-8.0, pr=-34.0)
FEET_WIDE = feet_(l=(0.06, -0.04, 0.0), r=(-0.06, 0.04, 0.0), yl=8.0, yr=-8.0)


def gen_attack1() -> anim.Clip:
    """a spear thrust: the right side drawn back with the spear levelled at the hip, then driven straight out at f10
    off a short lunge of the left foot (the right shoulder through), the pavise held up on the left; recovers to guard"""
    wind = pz(lean=2.0, yaw=-16.0, drop=0.06, dy=0.05,
              R=rh((-0.12, 0.14, -0.40), aim=(0.06, -0.99, 0.10), up=LEVEL, pole=(-0.8, 0.5, -0.3)),
              L=lh(REST_L + np.array([0.0, -0.04, 0.03]), face=_yawd(FRONT, -16.0)))
    hit = pz(lean=14.0, yaw=16.0, drop=0.09, dy=-0.10, feet=FEET_THRUST,
             R=rh((0.02, -0.46, -0.24), aim=(0.02, -0.996, -0.08), up=LEVEL, pole=(-0.8, 0.2, -0.5)),
             L=lh(REST_L + np.array([-0.02, -0.08, 0.04]), aim=(0.04, -0.05, 0.998), face=_yawd(FRONT, 16.0)))
    fol = pz(lean=16.0, yaw=20.0, drop=0.10, dy=-0.12, feet=FEET_THRUST,
             R=rh((0.04, -0.47, -0.26), aim=(0.06, -0.99, -0.12), up=LEVEL, pole=(-0.8, 0.2, -0.5)),
             L=lh(REST_L + np.array([-0.02, -0.08, 0.03]), aim=(0.04, -0.05, 0.998), face=_yawd(FRONT, 20.0)))
    return strike("attack1", 25, wind, hit, fol)


def gen_attack2() -> anim.Clip:
    """a pavise bash: the left shoulder drawn back, then the pane driven face-first into the target at f10 off a step
    of the left foot, the top edge leading; the spear stays upright in the right fist"""
    wind = pz(lean=-2.0, yaw=24.0, drop=0.07, dy=0.06,
              R=rh(REST_R + np.array([0.04, -0.08, 0.03]), aim=(-0.06, -0.12, 0.99)),
              L=lh((0.18, 0.14, -0.48), aim=(0.14, 0.18, 0.97), face=_yawd(FRONT, 40.0)))
    hit = pz(lean=14.0, yaw=-24.0, drop=0.10, dy=-0.12, feet=FEET_BASH,
             R=rh(REST_R + np.array([0.0, 0.06, 0.0]), aim=(-0.18, 0.10, 0.98)),
             L=lh((-0.14, -0.44, -0.34), aim=(-0.04, -0.34, 0.94), face=_yawd(FRONT, -22.0), pole=(0.85, 0.3, -0.4)))
    fol = pz(lean=16.0, yaw=-28.0, drop=0.11, dy=-0.14, feet=FEET_BASH,
             R=rh(REST_R + np.array([0.0, 0.07, 0.0]), aim=(-0.20, 0.12, 0.97)),
             L=lh((-0.16, -0.46, -0.32), aim=(-0.04, -0.40, 0.92), face=_yawd(FRONT, -26.0), pole=(0.85, 0.3, -0.4)))
    return strike("attack2", 25, wind, hit, fol)


def charge_pose(bob=0.0) -> dict:
    """Lancing Run's ram: crouched behind the pavise, which is carried square in front of the body (pane first, top
    edge tipped forward), the spear levelled low beside it on the right, shoulders driving"""
    return pz(lean=24.0, drop=0.17 - bob, dy=-0.16, look=(-14.0, 0.0, 0.0), feet=FEET_CHARGE,
              R=rh((0.04, -0.30, -0.40), aim=(0.04, -0.995, -0.06), up=LEVEL, pole=(-0.8, 0.3, -0.4)),
              L=lh((-0.30, -0.36, -0.32), aim=(0.0, -0.30, 0.95), face=(0.0, -0.95, -0.30), pole=(0.8, 0.2, -0.5)))


def gen_lancing_run() -> anim.Clip:
    """cast_a1 Lancing Run, 20 f, the lunge peaks at f8 (castTime 0.15 s: the sim dashes him at 16 m/s from there): a
    2-frame crouch behind the pavise, then one drive into the ram (pavise square in front, spear levelled low); held
    while the dash runs; back to guard with the spear upright by f20. No second swing (the dash clip holds the ram)."""
    g = G()
    crouch = pz(lean=10.0, drop=0.11, dy=0.02, look=(-4.0, 0.0, 0.0),
                R=rh(REST_R + np.array([0.02, -0.04, -0.02]), aim=(-0.06, -0.45, 0.89)),
                L=lh((-0.10, -0.24, -0.44), aim=(0.0, -0.10, 0.99), face=(0.2, -0.98, 0.0)))
    ram = charge_pose()
    hold = anim._with_hips(charge_pose(), (0.0, -0.02, -0.006))
    back = anim.lerp_pose(ram, g, 0.6)
    keys = [(0.0, g, "linear"), (0.10, crouch, "out"), (anim.IMPACT, ram, "accel"), (0.60, hold, "out"),
            (0.82, back, "inout"), (1.0, g, "settle")]
    return clip("cast_a1", 20, keys, impact=anim.IMPACT, lags={"head": 1.0})


def gen_dash() -> anim.Clip:
    """the ram carried through the dash: the pavise square in front, the spear level, short driving strides (the clip
    is stretched over the dash's duration by the renderer; it starts and ends in cast_a1's ram)"""
    N = 15

    def sample(t):
        ph = 2 * math.pi * 2 * t
        bob = 0.025 * abs(math.sin(ph))
        p = charge_pose(bob)
        ik = dict(p["ik"])
        s = math.sin(ph)
        lift_l = max(0.0, s) * 0.10
        lift_r = max(0.0, -s) * 0.10
        ik["foot.L"] = FT((0.03, -0.40 + 0.30 * max(0.0, -s), lift_l), 0.0, 0.0)
        ik["foot.R"] = FT((-0.03, 0.24 - 0.30 * max(0.0, s), 0.03 + lift_r), -20.0 * (1 - max(0.0, s)), -8.0)
        p["ik"] = ik
        return anim.add(p, anim.P(chest=(0, 3.0 * s, 0), hips=(0, -3.0 * s, 0)))

    return anim.Clip("dash", N, False, sample)


def gen_glare() -> anim.Clip:
    """cast_a2 Glare, 30 f, release f12: the left arm lifts the pavise in front of the left shoulder and tilts it 35
    degrees back toward the sun (the pale rectangle swings from vertical to a sail), the spear's point drops forward to
    guard; at f12 the pane catches the light (the accent blooms in the wind-up), a short trembling hold, back by f30"""
    g = G()
    lift = pz(lean=4.0, yaw=4.0, drop=0.06, dy=0.02,
              R=rh(REST_R + np.array([0.02, -0.06, 0.02]), aim=(-0.08, -0.40, 0.91)),
              L=lh((-0.04, -0.32, -0.30), aim=(0.03, 0.10, 0.99), face=(0.0, -1.0, 0.1)))
    tilt = pz(lean=-6.0, yaw=6.0, drop=0.05, dy=0.03, look=(-8.0, 0.0, 0.0), feet=FEET_WIDE,
              R=rh(REST_R + np.array([0.04, -0.14, 0.06]), aim=(-0.05, -0.72, 0.69), up=(0.0, -0.69, -0.72)),
              L=lh((-0.06, -0.40, -0.14), aim=(0.04, 0.574, 0.819), face=(0.0, -0.819, 0.574)))
    hold = anim.lerp_pose(tilt, lift, -0.04)
    keys = [(0.0, g, "linear"), (0.20, lift, "inout"), (anim.IMPACT, tilt, "snap"), (0.52, hold, "inout"),
            (0.66, tilt, "inout"), (1.0, g, "inout")]
    return clip("cast_a2", 30, keys, impact=anim.IMPACT, lags={"head": 1.5})


def gen_spire_strike() -> anim.Clip:
    """cast_a3 Spire Strike, 25 f, impact f10: the pavise cartwheeled up over his left side in the left fist (lying
    flat above his head at f5: a tall pale T) and on over until it hangs overhead with the spire tip pointing down; the
    knees bend and at f10 he drives the spire tip into the ground beside his left foot (the VFX strike point, 0.75 m to
    his left); the pane trembles but stays rigid; he pulls it up overhead and wheels it back over to guard by f25 (the
    same path reversed: the pavise never swings through his body)"""
    g = G()
    lean_r = anim.P(spine=(0, 0, 3.0), chest=(0, 0, 4.0))       # the chest tipped to his right (+Z = his right)
    tee = pz(lean=-2.0, yaw=4.0, drop=-0.01, dy=0.02, look=(-8.0, 0.0, 0.0), extra=lean_r,
             R=rh(REST_R + np.array([0.02, -0.04, 0.03]), aim=(-0.10, -0.15, 0.98)),
             L=lh((0.16, -0.12, 0.55), aim=(0.995, 0.0, 0.10), face=FRONT, pole=(0.9, 0.1, -0.2)))
    up_ = pz(lean=-4.0, yaw=6.0, drop=-0.01, dy=0.03, look=(-10.0, 0.0, 0.0), extra=lean_r,
             R=rh(REST_R + np.array([0.02, -0.04, 0.03]), aim=(-0.10, -0.15, 0.98)),
             L=lh((0.10, -0.20, 0.54), aim=(0.10, -0.06, -0.99), face=FRONT, pole=(0.9, 0.1, -0.2)))
    hit = pz(lean=14.0, yaw=8.0, drop=0.24, dx=0.05, dy=-0.02, look=(4.0, 0.0, 0.0), feet=FEET_WIDE,
             extra=anim.P(spine=(0, 0, -3.0), chest=(0, 0, -4.0)),
             R=rh(REST_R + np.array([0.02, -0.06, 0.06]), aim=(-0.14, -0.20, 0.97)),
             L=lh((0.22, -0.16, -0.50), aim=(0.04, -0.06, -0.997), face=FRONT, pole=(0.9, 0.3, -0.1)))
    tremble = anim._with_hips(anim.lerp_pose(hit, up_, -0.03), (0.0, 0.0, -0.01))
    pull = anim._with_hips(anim.lerp_pose(up_, hit, 0.35), (0.0, 0.0, 0.0))
    keys = [(0.0, g, "linear"), (0.07, anim._with_hips(g, (0, 0, -0.02)), "inout"), (0.20, tee, "inout"),
            (0.30, up_, "out"), (anim.IMPACT, hit, "accel"), (0.48, tremble, "out"), (0.54, hit, "inout"),
            (0.66, pull, "inout"), (0.80, tee, "inout"), (1.0, g, "inout")]
    return clip("cast_a3", 25, keys, impact=anim.IMPACT, lags={"head": 1.0})


def gen_muster() -> anim.Clip:
    """cast_ult Muster, 40 f, f16: he brings the pavise round square in front of him and steps in behind it, the
    right fist rising to its frame with the spear laid back over his right shoulder; at f16 the accent flares along the
    spire tip and the figure stands tall and still behind the raised pane (a pale spire with a figure behind it);
    held f16-f30, then lowered to guard"""
    g = G()
    step = pz(lean=4.0, drop=0.07, dy=0.06, feet=feet_(l=(0.02, -0.02, 0.0), r=(-0.02, 0.14, 0.0), yr=-6.0),
              R=rh(REST_R + np.array([0.06, -0.06, 0.06]), aim=(-0.2, 0.25, 0.95)),
              L=lh((-0.30, -0.36, -0.42), aim=(0.0, 0.0, 1.0), face=FRONT))
    tall = pz(lean=-2.0, drop=0.0, dy=0.05, look=(-6.0, 0.0, 0.0), feet=feet_(l=(0.02, -0.02, 0.0), r=(-0.02, 0.14, 0.0),
                                                                               yr=-6.0),
              R=rh((0.26, -0.40, -0.10), aim=(-0.38, 0.48, 0.79), up=(0.0, -0.85, 0.53), pole=(-0.6, 0.2, -0.8)),
              L=lh((-0.36, -0.40, -0.24), aim=(0.0, 0.0, 1.0), face=FRONT, pole=(0.8, 0.3, -0.5)))
    breathe = anim._with_hips(anim.add(tall, anim.P(chest=(-1.0, 0, 0))), (0, 0, 0.004))
    keys = [(0.0, g, "linear"), (0.18, step, "inout"), (anim.IMPACT, tall, "back"), (0.58, breathe, "inout"),
            (0.75, tall, "inout"), (1.0, g, "inout")]
    return clip("cast_ult", 40, keys, impact=anim.IMPACT, lags={"head": 1.5})


def gen_death(skel) -> anim.Clip:
    """struck, he drops to his right knee behind the pavise, which tips forward and falls flat on its face in front of
    him (his left fist still on it), then he sinks onto his right side; ends at rest"""
    g = G()
    hip_h = skel.rest_point("hips").z
    recoil = pz(lean=-10.0, yaw=6.0, drop=0.05, dy=0.05, look=(-12.0, 0.0, 0.0),
                R=rh(REST_R + np.array([-0.03, 0.02, 0.0]), aim=(-0.25, 0.10, 0.96)),
                L=lh(REST_L + np.array([0.02, 0.04, 0.02]), aim=(0.15, 0.10, 0.98)))
    kneel = pz(lean=14.0, yaw=4.0, drop=0.50, dy=0.04, look=(10.0, 0.0, 0.0),
               feet=feet_(l=(0.04, -0.22, 0.0), r=(-0.02, 0.38, 0.06), yl=2.0, yr=-8.0, pr=-55.0),
               R=rh((-0.10, -0.12, -0.46), aim=(-0.4, -0.3, 0.87)),
               L=lh((-0.02, -0.36, -0.40), aim=(0.0, -0.55, 0.83), face=(0.0, -0.83, -0.55)))
    tip = pz(lean=26.0, yaw=4.0, drop=0.58, dy=0.02, look=(14.0, 0.0, 0.0),
             feet=feet_(l=(0.04, -0.22, 0.0), r=(-0.02, 0.40, 0.04), yl=2.0, yr=-8.0, pr=-60.0),
             R=rh((-0.12, -0.10, -0.46), aim=(-0.6, -0.2, 0.77)),
             L=lh((-0.04, -0.46, -0.30), aim=(0.0, -0.99, 0.12), face=(0.0, 0.12, 0.99)))
    side = anim.merge(anim.arms_relaxed(), anim.P(hips=(10, 0, -78), spine=(8, 0, -6), chest=(6, 0, -4),
                                                  neck=(4, 0, 8), head=(6, 10, 14), thigh_L=(30, 0, 0), shin_L=(-50, 0, 0),
                                                  thigh_R=(40, 0, 0), shin_R=(-70, 0, 0), foot_L=(10, 0, 0),
                                                  foot_R=(15, 0, 0)))
    side["hips_loc"] = (-0.62, 0.06, -hip_h + 0.30)
    side["ik"] = {"hand.L": HT(pos=(0.15, -0.70, 0.62), pole=(0.3, 0.8, 0.4)),
                  "aim.L": AimRoll((0.0, -1.0, 0.02), 1.0, (0.0, 0.0, 1.0)),
                  "hand.R": HT(pos=(-1.15, -0.20, 0.10), pole=(-0.2, 0.5, 1.0)),
                  "aim.R": AimRoll((0.60, -0.80, 0.02), 1.0, (0.0, 0.0, 1.0))}
    rest = anim.add(side, anim.P(head=(4, 4, 4), spine=(-2, 0, 0)))
    keys = [(0.0, g, "linear"), (0.10, recoil, "snap"), (0.32, kneel, "in"), (0.50, tip, "inout"), (0.74, side, "in"),
            (0.84, rest, "out"), (1.0, rest, "linear")]
    return clip("death", 50, keys)


def kneel_pose(bow=0.0) -> dict:
    """down on the right knee, the pavise stood on its foot at his left, the spear stood on its butt at his right, the
    head bowed"""
    p = pz(lean=8.0 + 4.0 * bow, drop=0.55, dy=0.06, look=(18.0 + 10.0 * bow, 0.0, 0.0),
           feet=feet_(l=(0.06, -0.24, 0.0), r=(-0.02, 0.40, 0.05), yl=6.0, yr=-10.0, pr=-58.0),
           R=rhp((-0.53, -0.30, 0.83), aim=(-0.04, -0.06, 0.998), pole=(-0.8, 0.5, -0.2)),
           L=lhp((0.60, -0.24, 0.93), aim=(0.04, 0.0, 0.999), face=_yawd(FRONT, -12.0), pole=(0.8, 0.4, -0.3)))
    return p


def gen_recall() -> anim.Clip:
    """recall (loops): a vigil on one knee, the pavise stood up at his left, the spear stood on its butt, the head
    bowed; slow breaths"""
    N = 90
    base = kneel_pose()

    def sample(t):
        b = anim.osc(t, 2)
        return anim.add(base, anim.P(chest=(1.2 * b, 0, 0), spine=(0.4 * b, 0, 0), head=(1.5 * b, 0, 0)))

    return anim.Clip("recall", N, True, sample)


def gen_idle_lobby() -> anim.Clip:
    """patient and courteous (120 f loop): behind the pavise, he turns it a few degrees to catch the light, wipes a
    smudge from the pane with his right cuff, glances over the top at the camera with a small apologetic nod, then
    settles his weight and lets the pavise lean. He never raises the spear."""
    N = 120
    stand = pz(lean=2.0, yaw=8.0, drop=0.03, feet=FEET_WIDE,
               L=lh((-0.12, -0.24, -0.44), aim=(0.10, 0.0, 0.995), face=_yawd(FRONT, 8.0)))

    def seg(t, a, b):
        return min(1.0, max(0.0, (t - a) / (b - a)))

    def bump(t, a, b):
        return math.sin(math.pi * seg(t, a, b)) if a < t < b else 0.0

    def sample(t):
        p = dict(stand)
        p["ik"] = dict(stand["ik"])
        # 0.06-0.34 the pavise turned to catch the light and back
        k = bump(t, 0.06, 0.34)
        turn = 14.0 * math.sin(2 * math.pi * seg(t, 0.06, 0.34)) * (1.0 if t < 0.34 else 0.0)
        lw = np.array([-0.12, -0.24, -0.44]) + np.array([0.0, -0.05 * k, 0.05 * k])
        p["ik"].update(lh(lw, aim=(0.10 - 0.06 * k, -0.08 * k, 0.995), face=_yawd(FRONT, 8.0 + turn)))
        p = anim.add(p, anim.P(head=(4 * k, -6 * k, 0), neck=(2 * k, -3 * k, 0)))
        # 0.32-0.62 a smudge wiped off the pane with the right cuff (small circles, the spear carried along upright)
        w = bump(t, 0.32, 0.62)
        if w > 0:
            ph = 2 * math.pi * 3 * seg(t, 0.32, 0.62)
            rw = REST_R * (1 - w) + np.array([0.30, -0.40, -0.30]) * w + np.array([0.04 * math.cos(ph), 0.0, 0.035 * math.sin(ph)]) * w
            p["ik"].update(rh(rw, aim=_n(np.array(SPEAR0) * (1 - w) + np.array([0.15, -0.12, 0.98]) * w),
                              pole=(-0.6 + 0.3 * w, 0.6, -0.4 - 0.3 * w)))
            p = anim.add(p, anim.P(head=(8 * w, 6 * w, 0), chest=(2 * w, 4 * w, 0)))
        # 0.62-0.84 a glance over the top at the camera, a small apologetic nod
        c = bump(t, 0.62, 0.84)
        nod = max(0.0, math.sin(2 * math.pi * seg(t, 0.70, 0.80))) if 0.70 < t < 0.80 else 0.0
        p = anim.add(p, anim.P(head=(-6 * c + 12 * nod, -10 * c, -6 * c), neck=(-3 * c + 4 * nod, -4 * c, 0),
                               chest=(-2 * c, 0, 0)))
        p = anim._with_hips(p, (0.0, 0.0, 0.015 * c))
        # 0.84-1.0 settles the weight, lets the pavise lean out
        s2 = bump(t, 0.84, 1.0)
        p["ik"]["aim.L"] = AimRoll(tuple(_n(np.array(p["ik"]["aim.L"].dir) + np.array([0.10 * s2, 0.0, 0.0]))), 1.0,
                                   p["ik"]["aim.L"].up)
        p = anim._with_hips(p, (0.02 * s2, 0.0, -0.02 * s2))
        b = anim.osc(t, 3)
        return anim.add(p, anim.P(chest=(0.8 * b, 0, 0)))

    return anim.Clip("idle_lobby", N, True, sample)


def gen_victory() -> anim.Clip:
    """he steps out from behind the pavise for the first time, sets it down at his left and tilts it so the sun passes
    across his visor. Final hold: the pavise low at his left, the spear upright at his right, chin up, the visor in
    the light, a quarter turned from the camera (50 f, hold)"""
    g = G()
    behind = pz(lean=4.0, yaw=6.0, drop=0.05, L=lh((-0.18, -0.30, -0.40), face=_yawd(FRONT, 6.0)))
    out_ = pz(lean=2.0, yaw=-10.0, drop=0.05, dx=-0.10, feet=feet_(l=(-0.04, -0.04, 0.0), r=(-0.14, 0.02, 0.04), yl=-8.0,
                                                                   yr=-20.0),
              L=lh((0.12, -0.10, -0.55), aim=(0.12, 0.0, 0.99), face=_yawd(FRONT, -6.0)))
    hold = pz(lean=-8.0, yaw=-26.0, drop=0.03, dx=-0.10, look=(-26.0, 16.0, 0.0),
              feet=feet_(l=(-0.04, -0.04, 0.0), r=(-0.16, 0.06, 0.0), yl=-18.0, yr=-30.0),
              R=rh(REST_R + np.array([0.02, -0.04, 0.02]), aim=(-0.10, -0.06, 0.99)),
              L=lh((0.14, -0.14, -0.50), aim=(0.26, 0.30, 0.92), face=(-0.45, -0.75, 0.48)))
    keys = [(0.0, g, "linear"), (0.16, behind, "inout"), (0.40, out_, "inout"), (0.66, hold, "out"), (1.0, hold, "linear")]
    base = anim.drag(anim.keyed(keys), 50, {"head": 2.0, "neck": 1.0})

    def sample(t):
        p = base(t)
        if t > 0.66:
            k = min(1.0, (t - 0.66) / 0.15)
            p = anim.add(p, anim.P(chest=(0.8 * k * anim.osc(t, 2), 0, 0)))
        return p

    return anim.Clip("victory", 50, False, sample)


def gen_taunt() -> anim.Clip:
    """raps the spear shaft twice on the pavise frame (a clear glass note), then a small nod"""
    g = G()
    ready = pz(lean=3.0, yaw=10.0, drop=0.04,
               R=rh((0.10, -0.30, -0.30), aim=(0.55, -0.30, 0.78), pole=(-0.8, 0.3, -0.4)),
               L=lh((-0.16, -0.24, -0.42), face=_yawd(FRONT, 18.0)))
    tap = pz(lean=3.0, yaw=10.0, drop=0.045,
             R=rh((0.12, -0.31, -0.32), aim=(0.68, -0.28, 0.68), pole=(-0.8, 0.3, -0.4)),
             L=lh((-0.16, -0.24, -0.42), face=_yawd(FRONT, 18.0)))
    nod = anim.add(ready, anim.P(head=(12, -6, 0), neck=(4, -2, 0)))
    keys = [(0.0, g, "linear"), (0.24, ready, "inout"), (0.32, tap, "in"), (0.40, ready, "out"), (0.48, tap, "in"),
            (0.56, ready, "out"), (0.72, nod, "inout"), (0.82, ready, "inout"), (1.0, g, "inout")]
    return clip("taunt", 50, keys, lags={"head": 1.5})


def gen_stunned() -> anim.Clip:
    """staggering, the pavise slipping in his fist (its top lolling outward), the head swimming"""
    base = pz(lean=10.0, drop=0.08, look=(12.0, 0.0, 0.0),
              R=rh(REST_R + np.array([0.0, 0.0, -0.04]), aim=(-0.25, -0.15, 0.96)),
              L=lh(REST_L + np.array([0.02, 0.02, -0.04]), aim=(0.30, 0.0, 0.95), face=(0.2, -0.98, 0.0)))
    N = 40

    def sample(t):
        a, b = anim.osc(t, 1), anim.osc(t, 1, 0.25)
        p = anim.add(base, anim.P(hips=(0, 0, 3 * a), spine=(3 * b, 0, -3 * a), chest=(3 * b, 0, -3 * a),
                                  neck=(6 * b, 0, 6 * a), head=(8 * b, 4 * a, 8 * a)))
        p["ik"] = dict(p["ik"])
        p["ik"]["aim.L"] = AimRoll(tuple(_n((0.30 + 0.08 * a, 0.05 * b, 0.95))), 1.0, (0.2, -0.98, 0.0))
        return p

    return anim.Clip("stunned", N, True, sample)


def gen_channel() -> anim.Clip:
    base = G(drop=0.05)
    N = 40

    def sample(t):
        p = anim.add(base, anim.P(chest=(1.2 * anim.osc(t, 2), 0, 0), head=(-0.8 * anim.osc(t, 2), 0, 0)))
        return anim._nudge_hands(p, (0, 0, 0.006 * anim.osc(t, 2)), (0, 0, 0.006 * anim.osc(t, 2, 0.2)))

    return anim.Clip("channel", N, True, sample)


def clip_overrides(ctx) -> dict:
    skel = anim.Skeleton(ctx.info.armature)
    return {"idle": gen_idle(), "run": gen_run(), "attack1": gen_attack1(), "attack2": gen_attack2(),
            "cast_a1": gen_lancing_run(), "cast_a2": gen_glare(), "cast_a3": gen_spire_strike(),
            "cast_ult": gen_muster(), "death": gen_death(skel), "recall": gen_recall(), "idle_lobby": gen_idle_lobby(),
            "victory": gen_victory(), "dash": gen_dash(), "stunned": gen_stunned(), "channel": gen_channel(),
            "taunt": gen_taunt()}


if __name__ == "__main__":
    fighter.main(sys.modules[__name__])
