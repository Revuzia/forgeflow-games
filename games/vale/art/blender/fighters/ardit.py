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
  * the paint (ardit_paint, installed over common/hifi/project.paint for this build): sideways texels sample
    their own part's paint inset from the outline (no outline streaks on side planes), up-facing tops of the helm
    / pauldrons / boots take their part's own front paint box-mapped by depth (no streaked crowns), the pane,
    the spear and the inlays are painted from their own materials (the painted fist behind the glass and the
    eroded thin spear would otherwise ghost), and each part's painted median is graded onto its brief colour.
"""
from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy  # noqa: E402,F401
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

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
                 "under": "#2E3238", "gauntlet": "#4A5059"}},
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
    part("helm", helm, "chalk", "bone:head", 1900)
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
    neck.add(Capsule((0, 0.0, 1.86), (0, 0.01, 2.05), 0.105), k=0.0)
    part("neck", neck, "under", "auto", 300)
    gorget = Sculpt("gorget")
    gorget.add(Torus((0, 0.0, 1.925), 0.175, 0.060, axes=np.diag([1.0, 0.24 / 0.20, 1.0]), rz=0.055).displaced(chips(0.006, 9.0), 0.006), k=0.0)
    gorget.add(RoundBox((-0.01, -0.185, 1.915), (0.225, 0.045, 0.058), 0.026, axes=sdf.rot_x(-12)).displaced(chips(0.007, 8.0), 0.007), k=0.03)
    for sx in (-1, 1):                              # the notched lower edge of the bib
        gorget.sub(slab([(sx * 0.13, 1.86), (sx * 0.21, 1.86), (sx * 0.17, 1.885)], -0.21, 0.06, 0.004), k=0.004)
    part("gorget", gorget, "stone", "bone:chest", 900)

    # PAULDRONS: the square honed upper plates (rigid on the shoulders) and the lower tiers (on the upper arms)
    for s, sx in (("R", -1), ("L", 1)):
        pu = Sculpt(f"pauldron_{s}")
        tilt = sdf.rot_y(sx * 8)
        pu.add(RoundBox((sx * 0.385, 0.0, 1.915), (0.148, 0.218, 0.080), 0.034, axes=tilt).displaced(chips(0.009, 7.0), 0.009), k=0.0)
        pu.add(RoundBox((sx * 0.365, -0.005, 1.995), (0.118, 0.182, 0.026), 0.016, axes=tilt).displaced(chips(0.007, 9.0), 0.007), k=0.006)
        pu.sub(Capsule((sx * 0.25, -0.225, 1.975), (sx * 0.52, -0.225, 1.955), 0.007), k=0.004)   # the front lip line
        part(f"pauldron_{s}", pu, "stone", f"bone:shoulder.{s}", 650)
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
    part("cuirass", torso, "cloth", "auto", 2400)
    sleeves = Sculpt("sleeves")
    for E, S in ((E_R, S_R), (E_L, S_L)):
        sx = np.sign(S[0])
        sleeves.add(FlatCapsule(S + (sx * 0.01, 0.0, -0.02), E + (0, 0, -0.03), 0.098, 0.100, 0.092, 0.095, side=(1, 0, 0)).displaced(
            folds(0.007, 40.0, axis=2), 0.007), k=0.0)
    part("sleeves", sleeves, "cloth", "auto", 1000)

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
    part("fist_R", fr, "gauntlet", "bone:hand.R", 650, 0.7)
    fl = fist("fist_L", F_L, (0, 0, 1), (0.85, 0.35, 0.0), (-0.1, -1.0, 0.0), 1)
    fl.add(Torus(W_L + (W_L - E_L) * 0.05, 0.062, 0.020, axes=sdf.frame(W_L - E_L)), k=0.02)
    part("fist_L", fl, "gauntlet", "bone:hand.L", 600, 0.7)

    # BELT + BUCKLE
    belt = Sculpt("belt")
    belt.add(Torus((0, 0.01, 1.445), 0.318, 0.050, axes=np.diag([1.0, 0.318 / 0.250, 1.0]), rz=0.062), k=0.0)
    for x in (-0.24, -0.15, 0.15, 0.24):
        belt.add(Sphere((x, -0.255 + 0.06 * (abs(x) > 0.2), 1.445), 0.012), k=0.004)
    part("belt", belt, "leather", "auto", 700)
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
    part("coat", coat, "cloth", "auto", 1900)
    for s, sx in (("R", -1), ("L", 1)):
        tb = Sculpt(f"tabard_{s}")
        c = (sx * 0.086, -0.302, 1.03)
        pan = RoundBox(c, (0.082, 0.016, 0.395), 0.010, axes=sdf.rot_x(-6.5))
        tb.add(pan.displaced(folds(0.008, 26.0, axis=0, phase=sx * 1.1, zfade=(1.3, 0.7)), 0.008), k=0.0)
        part(f"tabard_{s}", tb, "cloth2", ("chain", f"tabard_{s.lower()}", "hips"), 420)

    # LEGS (dark leggings, heat weights), the greaves and knee cops (ironstone, rigid on the shins), boots
    legs = Sculpt("legs")
    for sx in (-1, 1):
        legs.add(FlatCapsule((sx * 0.185, 0.0, 1.10), (sx * 0.235, -0.012, 0.64), 0.150, 0.145, 0.125, 0.120, side=(1, 0, 0)).displaced(
            folds(0.010, 30.0, axis=2), 0.010), k=0.0)
        legs.add(FlatCapsule((sx * 0.235, -0.012, 0.66), (sx * 0.255, 0.02, 0.16), 0.110, 0.105, 0.080, 0.085, side=(1, 0, 0)), k=0.05)
    part("legs", legs, "under", "auto", 1000)
    for s, sx in (("R", -1), ("L", 1)):
        gr = Sculpt(f"greave_{s}")
        gr.add(FlatCapsule((sx * 0.256, 0.018, 0.15), (sx * 0.248, 0.004, 0.53), 0.112, 0.108, 0.118, 0.114, side=(1, 0, 0)).displaced(
            chips(0.006, 9.0), 0.006), k=0.0)
        gr.add(Torus((sx * 0.248, 0.008, 0.555), 0.112, 0.034, axes=np.diag([1.0, 0.95, 1.0])), k=0.01)              # the top cuff
        gr.add(RoundBox((sx * 0.252, -0.088, 0.33), (0.085, 0.030, 0.165), 0.024), k=0.02)                            # the shin plate
        gr.add(Capsule((sx * 0.252, -0.118, 0.18), (sx * 0.252, -0.118, 0.47), 0.010), k=0.01)                        # its ridge
        part(f"greave_{s}", gr, "ironstone", f"bone:shin.{s}", 700)
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
    part("boots", boots, "leather", "auto", 1200)

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
    part("pavise_frame", frame, "chalk", "bone:prop.L", 950)
    pane = Sculpt("pavise_pane")
    pane.add(slab(inset(PAV_OUT, PAV_FRAME_W - 0.012), PAV_Y + 0.004, 0.0085, 0.004), k=0.0)
    part("pavise_pane", pane, "dawnglass", "bone:prop.L", 160, 0.6)
    handle = Sculpt("pavise_handle")
    handle.add(Capsule(F_L + (0, 0, -0.10), F_L + (0, 0, 0.10), 0.024), k=0.0)
    for dz in (-0.10, 0.10):
        handle.add(RoundCone(F_L + (0, 0, dz), (F_L[0], PAV_Y + PAV_T - 0.01, F_L[2] + dz * 1.3), 0.022, 0.03), k=0.01)
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
    P = []
    extra = (ctx.skin or {}).get("extra") or {}
    for name, S, vs, role, bind, tris in sculpts() + skin_extras(extra):
        v, q = S.mesh(VOXEL * vs)
        ob = sdf.to_object(f"{name}_high", v, q, ctx.col)
        ob.data.materials.append(ctx.mats[role])
        P.append(fighter.Part(name, high=ob, tris=tris, bind=bind))
    return P


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
            return 0.9 * max(0.0, p.get(f"thigh.{side}", (0.0,))[0])
        return f
    return [anim.ChainCfg(ctx.chains["tabard_l"], gravity=0.8, stiffness=150.0, damping=16.0, inertia=0.5, drive=push("L")),
            anim.ChainCfg(ctx.chains["tabard_r"], gravity=0.8, stiffness=150.0, damping=16.0, inertia=0.5, drive=push("R"))]


# ── paint (Ardit's wrap of common/hifi/project.paint; common/ is shared, so it lives here) ──────────────────
SIDE_INSET = 0.045         # m: sideways texels sample their part's paint this far inside the outline
TOPMAP = {                 # up-facing texels: the part's own front paint, depth (y) mapped onto this z band
    "helm": (2.262, 2.335), "pauldron_R": (1.935, 1.995), "pauldron_L": (1.935, 1.995), "tier_R": (1.70, 1.78),
    "tier_L": (1.70, 1.78), "boots": (0.03, 0.12), "gorget": (1.88, 1.95), "cuirass": (1.70, 1.80),
    "greave_R": (0.45, 0.53), "greave_L": (0.45, 0.53), "bracer_R": (1.40, 1.48), "bracer_L": (1.40, 1.48),
}
BASE_TONE = {}             # part: (target median hex, hue strength, gamma) after the first look


def _lin(c):
    c = np.asarray(c, dtype=np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def _hex(h):
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (1, 3, 5)], dtype=np.float32)


def _glass(p, n, base="#C7D6E0", seed=0.0):
    """the pane / spear head: pale cool glass with soft diagonal glints and a darker rim toward the frame"""
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


def ardit_paint(maps, plates, vis, names, tops=None, flat=None, eps=0.02, bleed=True, log=print):
    from common.hifi import project as pj
    P, N, part = maps["P"], maps["N"], maps["part"]
    size = maps["size"]
    out = np.zeros((size, size, 3), dtype=np.float32)
    have = part >= 0
    flat = flat or {}
    fills = {}
    for side in ("front", "back"):
        pid = vis.part[side]
        s = vis.step
        small = plates.img[side][s // 2::s, s // 2::s][:pid.shape[0], :pid.shape[1]]
        for k in np.unique(part[have]):
            valid = pid == k
            if not valid.any():
                continue
            iy, ix = pj.nearest_index(valid)
            fills[(side, int(k))] = pj.blur(small[iy, ix], 1.0)
    idx = np.nonzero(have)
    p = P[idx]
    n = N[idx]
    k = part[idx].astype(np.int64)
    # part centre lines (x) for the side inset
    cxp = np.zeros(len(names), dtype=np.float32)
    for i in range(len(names)):
        sel = k == i
        if sel.any():
            cxp[i] = float(np.median(p[sel, 0]))
    st = np.abs(n[:, 0]) / (np.abs(n[:, 0]) + np.abs(n[:, 1]) + 1e-6)
    ws = np.clip((st - 0.55) / 0.35, 0, 1)
    ws = ws * ws * (3 - 2 * ws)
    xs = p[:, 0] - np.sign(p[:, 0] - cxp[k]) * SIDE_INSET * ws
    xs = np.where(np.sign(xs - cxp[k]) != np.sign(p[:, 0] - cxp[k]), cxp[k], xs)
    zs = p[:, 2].copy()
    # up-facing texels of TOPMAP parts: box-mapped from the part's own front paint
    wt = np.clip((n[:, 2] - 0.55) / 0.30, 0, 1)
    wt = wt * wt * (3 - 2 * wt)
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
    cols = {}
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
        for kk in np.unique(k[hidden]):
            f = fills.get((side, int(kk)))
            if f is None:
                continue
            sel = hidden & (k == kk)
            c[sel] = pj.bilinear(f, px[sel] / vis.step, py[sel] / vis.step)
        cols[side] = c
    wb = np.clip((n[:, 1] + 0.25) / 0.5, 0, 1)
    wb = wb * wb * (3 - 2 * wb)
    col = cols["front"] * (1 - wb[:, None]) + cols["back"] * wb[:, None]
    # own-material parts
    own = {"pavise_pane": lambda pp, nn: _glass(pp, nn), "spear_head": lambda pp, nn: _glass(pp, nn, "#CFE0EA", 1.3),
           "spear_shaft": lambda pp, nn: _wood(pp)}
    for name, fn in own.items():
        if name in names:
            sel = k == names.index(name)
            if sel.any():
                col[sel] = fn(p[sel], n[sel])
    # tone: each part's painted median onto its brief colour (linear-light gain), value structure kept
    lin = _lin(col)
    for name, (hexc, hue, gam) in BASE_TONE.items():
        if name not in names:
            continue
        sel = k == names.index(name)
        if not sel.any():
            continue
        cur = np.median(lin[sel], axis=0)
        tgt = _lin(_hex(hexc))
        Y = lambda c: 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]  # noqa: E731
        y = Y(lin[sel])
        ym, yt = max(1e-4, float(Y(cur))), float(Y(tgt))
        yy = yt * np.power(np.maximum(y / ym, 1e-4), gam)
        chroma = lin[sel] / np.maximum(y[:, None], 1e-4)
        ch_t = tgt / max(1e-4, yt)
        ch_c = cur / ym
        chroma = chroma * (1 - hue) + (chroma / np.maximum(ch_c, 1e-4) * ch_t) * hue
        lin[sel] = chroma * yy[:, None]
    col = _srgb(lin)
    for name, rgb in flat.items():
        if name in names:
            col[k == names.index(name)] = np.asarray(rgb, dtype=np.float32)
    out[idx] = col
    if bleed:
        iy, ix = pj.nearest_index(have)
        out = out[iy, ix]
    log(f"ardit paint: {len(fills)} part fills, {int((ws > 0).sum())} side texels, {int((wt > 0).sum())} top texels")
    return out


def _install() -> None:
    from common.hifi import project
    if getattr(project.paint, "_ardit", False):
        return
    ardit_paint._ardit = True
    project.paint = ardit_paint


# ── motion (brief §8) ────────────────────────────────────────────────────────────────────────────────────────
MOTION = anim.motion_profile(weight="heavy", weapon="one_hand", stance="wide", run_ref_speed=3.35)


def clip_overrides(ctx) -> dict:
    return {}


if __name__ == "__main__":
    fighter.main(sys.modules[__name__])
