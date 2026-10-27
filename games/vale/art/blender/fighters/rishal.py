"""rishal: Glass runner (Striker, Aubade). ART 2.0: sculpted volumes painted by concept projection.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/rishal_plates.py        # plates (crest tip 1.88 m)
    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/rishal_fit.py           # fit on the 10 cm grid
    python3 art/build.py fighter rishal --no-skins [--fast] [--clip-sheet]

Brief: _design/fighters/rishal.md. Concept: _design/concept/rishal.webp (front + back, hand-painted).
The forms are numpy SDF volumes (common/hifi/sdf.py) fitted to the concept on a 10 cm grid; the base colour is
the concept painting projected occlusion-aware onto the game mesh (common/hifi/project.py, the pipeline's
PROJECTION hook); normals and AO bake from the sculpt.

The concept is painted in a turned, staggered pose (head ~35 degrees to his right, left foot forward, the right
foot turned out, the left elbow out). The model is sculpted in the rig's symmetric rest pose; the projection
paints the mesh POSED like the painting (CONCEPT_POSE through the armature: rishal_paint below), so each painted
part lands on its own form. The knives, the boots and the accent are painted flat / procedurally (the knives are
built in the brief's reverse grip, not the painting's mixed grips; the painting's pale front boots are the
backdrop's own grey and its back boots blue-grey: the boots take the back view's blue-grey).

Where the concept and the brief disagree the concept's FORMS win (the approved look), the brief's hook wins for
the silhouette: the crest arc and two swept glass blades on the left of the helmet sweep back at ~28 degrees, the
left pauldron's long spike points up and back, both knives are reverse-gripped (blades back past the elbows in the
guard). The pipeline hooks this module wraps for its own build (common/ is shared and never edited): part binding
(auto_only / skirt panels), the projection paint (concept pose, flat knives / boots / accent), the portrait framing.
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

ID = "rishal"
TITLE = "Glass runner"
ROLE_MASS = "striker"
ORIGIN = "aubade"
CARD = {"primary": "#9AA6B4", "secondary": "#D9D4C8"}

# rig fitted to the concept (front view, 1.44 mm per px, the crest tip at 1.88 m): the dome's crown 1.79, chin 1.51,
# shoulder joints x 0.18 at 1.375, elbows ~(0.23, 1.16), wrists ~(0.29, 0.94), fists ~(0.30, 0.87); hip joints x 0.10
# at 0.93, knees 0.51, ankles x 0.16 at 0.10. Short arms and a long neck (the painting's), long runner's legs.
PROPORTIONS = rig.proportions(height=1.79, head=0.28, neck=0.10, shoulder_width=0.36, hip_width=0.20, leg=0.83,
                              thigh_frac=0.50, arm=0.47, upper_arm_frac=0.43, hand=0.17, foot=0.27,
                              ankle_height=0.10, spine_curve=0.02, stance=0.08, toe_out_deg=8.0, knee_bend=0.02,
                              a_pose_deg=76.0, arm_forward_deg=6.0, elbow_bend_deg=16.0, shoulder_drop=0.075)
MATERIAL_SET = "bible"
PALETTE = materials.bible_palette(dawnglass="#B9D0E2", chalk="#CDCECB", stone="#B5B9BD", cloth2="#CCCCC4",
                                  cloth="#74808C", leather="#403D3B", ironstone="#3E4146", under="#33363B",
                                  ink="#17181B", accent="#3F9CFF")
VALUE_GRADIENT_STOPS = materials.BIBLE_GRADIENT_STOPS
MOTION = anim.motion_profile(weight="light", weapon="dual", stance="low", run_ref_speed=3.55)
SOCKETS = {"weapon": "prop.R", "knife_tip_r": "x_knife_tip_r", "knife_tip_l": "x_knife_tip_l",
           "visor_ridge": "x_visor_ridge"}
# the brief's splash (victory hold, yaw 22) and portrait (idle_lobby t 0, yaw 28); hero renders matte (HERO_SPEC: the
# glossy glass and honed stone mirrored the bright sky into a white haze at the low hero camera) with a lower fill
# (review: the figure sat against the right edge, the face in shadow, the portrait and icon missed the visor: the
# subject moves in to 64 % of the width at 80 % fill, the portrait and icon turn further to the front so the visor
# blade, its eyes and the ridge face the camera with the crest in profile above)
# (fix pass 2: the victory hold turned him a quarter away, so the splash showed his back with no visor and no knives;
# the splash is his low guard from the front three-quarter: visor, crest, glass fins, the left spike and both
# reversed knives read)
# (fix pass 3, review: the static guard had no action beat: the splash is Glint Cut's second cut, the left knife
# flung out wide with the shoulders snapping round toward the camera, from the front three-quarter; the portrait and the icon turn
# toward his left so the sickle visor shows its beak in profile with the crest and fins behind)
# (fix pass 4, review: a small centred figure in a casual stance next to Marund's frame-filling hero shot): the
# splash_hero lunge (a splash-only pose), larger and on the right-hand columns like the roster's other splashes
SPLASH = {"map": "map_rift", "clip": "splash_hero", "t": 0.0, "yaw": 52.0, "pitch": -4.0, "fill": 0.86, "x": 0.66,
          "sun": 1.9, "rim_cool": 0.6, "rim_warm": 0.6, "portrait_yaw": 36.0, "icon_yaw": 28.0}
# (fix pass 5, review: the hero art read as untextured plastic, washed out: the sun 2.4 -> 1.9 and the sky fill
# x0.5, so the painted values, strokes and carving hold in the light; the icon turned to 28 degrees: from the front
# the crest stood edge-on over the visor, the review's down-arrow, where the crescent frame and its panes now show)
HERO_SPEC = 0.15
PORTRAIT_TIGHTEN, PORTRAIT_X = 0.15, 0.47
HERO_FILL = 0.5
HERO_SAMPLES = 2.0        # hero render samples x this, and the nlmeans denoise strength x HERO_DENOISE (grain)
HERO_DENOISE = 1.4
TEXTURE_SIZE = 2048
TEXTURE_SIZES = {"normal": 512, "orm": 512}
GLB_COMPRESS = True
ARMOUR_CONFORM = False
AO_INTO_BASE = 0.10          # (fix pass 4 / 5: the skirt's occlusion read as dark camouflage blotches on the thighs)
# ART 2.0 skins re-colour the projected painting role by role (each role's painted mean lands on the skin's colour,
# the painted detail kept: rishal_recolour), plus skin-only paint and extras. Palettes: _design/fighters/rishal.md §9.
SKINS: list = [
    # Chalkline Runner: ink-grey armour drawn over with children's chalk sketches (runners, speed lines, a sun), lines
    # under 1 cm, well under 20 % of the surface (chalk_linework); no extra geometry
    # (the painting's coat is pale linen in front: its role mean is moved onto the ink tones, `absolute`, so the coat,
    # legs, boots and straps read ink-grey under the light crest, cowl and pauldrons, and the chalk lines show on them)
    # (review: the brief's palette sits on the base's own values, so the first pass read as the base above the knees.
    # The identity now rides the big pieces, `parts` (each part's painted mean moved onto that colour): the coat,
    # apron, sleeves and chest go ink-grey under dense chalk sketches, the pauldrons a cool mid ink-grey, the scarf the
    # warm #C9C9C1; the crest and helm keep the light top in the named #A7A9AC)
    {"id": "rishal_chalkline", "extra": {"linework": True}, "card": {"primary": "#3A3F47", "secondary": "#E6E0D2"},
     "absolute": ("cloth", "ironstone", "under", "leather"),
     # (fix pass 5, review: the mid band read L* 31-40 against the brief's 45-65, the scarf a near-white bib): the
     # coat, apron, sleeves and chest a step lighter mid ink-grey, the scarf a chalky grey a step under the crest
     "parts": {"apron": "#6C7480", "sleeves": "#7E8792", "chest_plate": "#8E959F", "cowl": "#959CA3",
               "skirt_L": "#707884", "skirt_R": "#707884",
               "pauldron_L": "#98A0AA", "lames_L": "#98A0AA", "pauldron_R": "#98A0AA",
               "helm": "#959BA3", "nape": "#5F6670", "visor": "#A2A8B0", "fins": "#B2B7BD"},
     # (fix pass 3, review: the portrait was the base's: the helm itself goes a mid ink-grey under its chalk
     # sketches, the nape plates the deep ink, the crest the named #A7A9AC, and the visor and fins frosted to a
     # chalky smoke-grey glass: the role gain alone left the painted lavender-blue visor blue)
     # (the dawnglass frosted to a chalky smoke-grey: the blue visor made the select-screen portrait the base's)
     "palette": {"chalk": "#A7A9AC", "stone": "#BAC0C6", "cloth2": "#C9C9C1", "cloth": "#68707C", "ironstone": "#3A3F47",
                 "under": "#2E3238", "leather": "#34383F", "linework": "#E6E0D2", "dawnglass": "#A9AEB5"}},
    # Lamplit Visor: smoked lampresin glass and walnut armour from the evening side, a small lamp cage on the crest's
    # front horn (four carved slats round a lampresin bead, 7 cm, duller than the accent ridge)
    # (the painting's cowl and sleeves are pale blue linen: their mean moves onto the warm scarf colour, `absolute`)
    {"id": "rishal_lamplit", "extra": {"lamp_cage": True}, "card": {"primary": "#4A4036", "secondary": "#A38C6B"},
     "absolute": ("cloth2",),
     "parts": {"cowl": "#B4A690", "sleeves": "#ABA08F"},   # (fix pass 5: the scarf a step down again, L* 69: the
     # hero light still blew the painted scarf's lit folds out to near white)   # (review: the cowl blew out near white: the scarf a step
     # down, L* 74; fix pass 2: the sleeves keep the base's mid-light step under the scarf, L* 66)
     "palette": {"dawnglass": "#A38C6B", "chalk": "#D5CDBF", "stone": "#BFB09A", "cloth2": "#CFC5B3", "cloth": "#8B7A68",
                 "leather": "#5E4D3E", "ironstone": "#3F3730", "under": "#3A332D", "wood_dark": "#5A4636",
                 "lampresin": "#94774F"}},
]
SKIN_FLAT = {"cage_slats": "wood_dark", "cage_bead": "lampresin"}

HEIGHT = 1.88             # the plates' scale: the crest arc's tip
PROJECTION = {"concept": "rishal", "height": HEIGHT, "flat": {}}
NOISE = sdf.Noise(23)
VOXEL = 0.006

# the head as painted in each view: turned to his right about HEAD_PIVOT, then shifted (world m); the helmet parts
# are moved rigidly from the rest pose like this for the projection (posed_copy) and the fit overlay (rishal_fit)
HEAD_PIVOT = (0.0, 0.005, 1.53)
HEAD_POSE = {"front": (-40.0, (-0.045, 0.0, 0.0)), "back": (-45.0, (-0.060, 0.0, 0.0))}


# ── the rig's joints in numpy (rig._layout without mathutils: the fit tool runs outside Blender) ─────────────────
def layout(p: dict | None = None) -> dict:
    p = dict(p or PROPORTIONS)
    J = {}
    za = p["ankle_height"]
    hx = p["hip_width"] / 2
    ax = hx + p["stance"]
    z_hip = za + math.sqrt(max(1e-6, p["leg"] ** 2 - (ax - hx) ** 2))
    y0, sc, H = p["pelvis_depth"], p["spine_curve"], p["height"]
    z_head = H - p["head"] * 0.86
    z_neck = z_head - p["neck"]
    J["pelvis"] = np.array([0, y0, z_hip + 0.015])
    J["neck_base"] = np.array([0, y0 - sc + 0.012, z_neck])
    J["head_base"] = np.array([0, y0 - sc + 0.004, z_head])
    hip = np.array([hx, y0 + 0.005, z_hip])
    ankle = np.array([ax, y0 + 0.02, za])
    knee = hip + (ankle - hip) * p["thigh_frac"] + np.array([0, -p["knee_bend"], 0])
    J["hip.L"], J["knee.L"], J["ankle.L"] = hip, knee, ankle
    to = math.radians(p["toe_out_deg"])
    fwd = np.array([math.sin(to), -math.cos(to), 0.0])
    J["ball.L"] = np.array([ankle[0], ankle[1], 0.0]) + fwd * (p["foot"] * 0.5) + np.array([0, 0, p["foot"] * 0.07])
    J["toe.L"] = np.array([ankle[0], ankle[1], 0.0]) + fwd * (p["foot"] * 0.74) + np.array([0, 0, p["foot"] * 0.05])
    J["heel.L"] = np.array([ankle[0], ankle[1], 0.0]) - fwd * (p["foot"] * 0.26)
    J["fwd.L"] = fwd
    sw = p["shoulder_width"] / 2
    z_sh = z_neck - p["shoulder_drop"]
    sh = np.array([sw, J["neck_base"][1] + 0.018, z_sh])
    a, fw = math.radians(p["a_pose_deg"]), math.radians(p["arm_forward_deg"])
    d1 = np.array([math.cos(a) * math.cos(fw), -math.cos(a) * math.sin(fw), -math.sin(a)])
    d1 /= np.linalg.norm(d1)
    elbow = sh + d1 * (p["arm"] * p["upper_arm_frac"])
    front = np.array([0.0, -1.0, 0.0])
    zf = front - d1 * front.dot(d1)
    zf /= np.linalg.norm(zf)
    hinge = np.cross(d1, zf)
    hinge /= np.linalg.norm(hinge)
    th = math.radians(p["elbow_bend_deg"])        # Rodrigues: rotate d1 about the hinge toward the front
    d2 = d1 * math.cos(th) + np.cross(hinge, d1) * math.sin(th) + hinge * hinge.dot(d1) * (1 - math.cos(th))
    d2 /= np.linalg.norm(d2)
    wrist = elbow + d2 * (p["arm"] * (1 - p["upper_arm_frac"]))
    zf2 = front - d2 * front.dot(d2)
    zf2 /= np.linalg.norm(zf2)
    palm_n = np.cross(d2, zf2)
    palm_n /= np.linalg.norm(palm_n)
    J["shoulder.L"], J["elbow.L"], J["wrist.L"] = sh, elbow, wrist
    J["palm.L"] = wrist + d2 * (p["hand"] * 0.40) + palm_n * 0.022
    J["d1.L"], J["d2.L"], J["palm_n.L"] = d1, d2, palm_n
    for k in list(J):
        if k.endswith(".L"):
            v = J[k]
            J[k[:-2] + ".R"] = np.array([-v[0], v[1], v[2]])
    return J


# ── shaping helpers ────────────────────────────────────────────────────────────────────────────────────────
def folds(amp, freq, axis=0, phase=0.0, zfade=None, dirv=None):
    def fn(P):
        if dirv is not None:
            u = (P @ np.asarray(dirv, dtype=np.float64)) * freq + phase + 0.6 * NOISE(P, 3.0)
        else:
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


def wraps(amp, freq, axis=2):
    def fn(P):
        return amp * np.sin(P[:, axis] * freq + 0.3 * NOISE(P, 6.0))
    return fn


def unit(v):
    v = np.asarray(v, dtype=np.float64)
    return v / np.linalg.norm(v)


def smooth_poly(ctrl, n=6, closed=True):
    """Catmull-Rom through the control points (a smooth outline for Profile)"""
    P = [np.asarray(c, dtype=np.float64) for c in ctrl]
    m = len(P)
    out = []
    rng = range(m) if closed else range(m - 1)
    for i in rng:
        p0 = P[(i - 1) % m] if (closed or i > 0) else P[i]
        p1, p2 = P[i], P[(i + 1) % m]
        p3 = P[(i + 2) % m] if (closed or i + 2 < m) else P[(i + 1) % m]
        for t in np.linspace(0, 1, n, endpoint=False):
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    if not closed:
        out.append(P[-1])
    return np.array(out)


class Profile(sdf.Prim):
    """A flat piece: a 2D polygon (u, v) in the plane at `c` with frame rows (u, v, n), extruded `t` thick along n
    (optionally tapering: thickness * taper(u, v)), edges rounded by `r`."""

    def __init__(self, c, frame, poly, t, r=0.003, taper=None):
        self.c = np.asarray(c, dtype=np.float64)
        self.F = np.asarray(frame, dtype=np.float64)
        self.poly = np.asarray(poly, dtype=np.float64)
        self.t, self.r, self.taper = float(t), float(r), taper

    def bounds(self):
        lo2, hi2 = self.poly.min(0), self.poly.max(0)
        pts = np.array([lo2[0] * self.F[0] + lo2[1] * self.F[1], lo2[0] * self.F[0] + hi2[1] * self.F[1],
                        hi2[0] * self.F[0] + lo2[1] * self.F[1], hi2[0] * self.F[0] + hi2[1] * self.F[1]]) + self.c
        e = self.t
        return pts.min(0) - e, pts.max(0) + e

    def d(self, P):
        q = (P - self.c) @ self.F.T
        uv = q[:, :2]
        V = self.poly
        d2 = np.full(len(P), np.inf)
        sign = np.ones(len(P))
        for i in range(len(V)):
            a, b = V[i], V[(i + 1) % len(V)]
            e = b - a
            w = uv - a
            h = np.clip((w @ e) / (e @ e + 1e-12), 0, 1)
            dd = np.sum((w - h[:, None] * e) ** 2, axis=1)
            d2 = np.minimum(d2, dd)
            c1 = uv[:, 1] >= a[1]
            c2 = uv[:, 1] < b[1]
            c3 = e[0] * w[:, 1] > e[1] * w[:, 0]
            flip = (c1 & c2 & c3) | (~c1 & ~c2 & ~c3)
            sign = np.where(flip, -sign, sign)
        d2 = sign * np.sqrt(d2)
        half = self.t / 2 if self.taper is None else self.t / 2 * self.taper(uv[:, 0], uv[:, 1])
        dz = np.abs(q[:, 2]) - half
        r = self.r
        w = np.stack([np.maximum(d2 + r, 0.0), np.maximum(dz + r, 0.0)], 1)
        return np.linalg.norm(w, axis=1) + np.minimum(np.maximum(d2 + r, dz + r), 0.0) - r


def inset(poly, d):
    """a closed polygon offset inward by d (vertex normals; fine for gentle outlines)"""
    V = np.asarray(poly, dtype=np.float64)
    area = 0.5 * np.sum(V[:, 0] * np.roll(V[:, 1], -1) - np.roll(V[:, 0], -1) * V[:, 1])
    out = []
    for i in range(len(V)):
        a, b, c = V[i - 1], V[i], V[(i + 1) % len(V)]
        t1, t2 = unit(b - a), unit(c - b)
        n1, n2 = np.array([-t1[1], t1[0]]), np.array([-t2[1], t2[0]])
        nn = unit(n1 + n2)
        k = d / max(0.35, nn.dot(n1))
        out.append(b + nn * k * (1.0 if area > 0 else -1.0))
    return np.array(out)


class Crescent(sdf.Prim):
    """A flat crescent fin in a plane: the region between an outer and an inner circle (2D, plane frame u, v),
    `t` thick along the plane normal, rounded by `r`. frame rows = (u, v, n)."""

    def __init__(self, c, frame, ro, co, ri, ci, t, r=0.004, clip=None):
        self.c = np.asarray(c, dtype=np.float64)
        self.F = np.asarray(frame, dtype=np.float64)
        self.ro, self.co = float(ro), np.asarray(co, dtype=np.float64)
        self.ri, self.ci = float(ri), np.asarray(ci, dtype=np.float64)
        self.t, self.r = float(t), float(r)
        self.clip = clip                      # (a, b, c): keep where a*u + b*v <= c (cuts the crescent's ends)

    def bounds(self):
        e = self.ro + np.linalg.norm(self.co) + self.t
        return self.c - e, self.c + e

    def d(self, P):
        q = (P - self.c) @ self.F.T
        uv = q[:, :2]
        d2 = np.maximum(np.linalg.norm(uv - self.co, axis=1) - self.ro, self.ri - np.linalg.norm(uv - self.ci, axis=1))
        if self.clip is not None:
            a, b, c = self.clip
            d2 = np.maximum(d2, (a * uv[:, 0] + b * uv[:, 1] - c) / math.hypot(a, b))
        w = np.stack([np.maximum(d2 + self.r, 0.0), np.maximum(np.abs(q[:, 2]) - self.t / 2 + self.r, 0.0)], 1)
        return np.linalg.norm(w, axis=1) + np.minimum(np.maximum(d2 + self.r, np.abs(q[:, 2]) - self.t / 2 + self.r), 0.0) - self.r


class Blade(sdf.Prim):
    """A swept leaf blade along a quadratic centreline a -> m -> b: half-width w(s) across `side` (the blade's
    plane), half-thickness th(s) along the plane normal, a bevelled diamond section (edge bevels)."""

    def __init__(self, a, m, b, side, width, thick, n=24, edge=0.0):
        self.a, self.m, self.b = (np.asarray(x, dtype=np.float64) for x in (a, m, b))
        self.side = unit(side)
        self.width, self.thick, self.n = width, thick, n
        self.edge = edge          # a minimum half-thickness at the cut edge (thin edges came out saw-toothed)
        s = np.linspace(0, 1, n)
        self.C = ((1 - s) ** 2)[:, None] * self.a + (2 * s * (1 - s))[:, None] * self.m + (s * s)[:, None] * self.b
        self.s = s

    def bounds(self):
        e = max(self.width(np.linspace(0, 1, 11))) + 0.01
        return self.C.min(0) - e, self.C.max(0) + e

    def d(self, P):
        best = np.full(len(P), 1e3)
        for i in range(self.n - 1):
            p0, p1 = self.C[i], self.C[i + 1]
            seg = p1 - p0
            L2 = seg.dot(seg) + 1e-12
            t = np.clip(((P - p0) @ seg) / L2, 0, 1)
            s = self.s[i] + (self.s[i + 1] - self.s[i]) * t
            Q = P - (p0 + t[:, None] * seg)
            tang = seg / math.sqrt(L2)
            sd = self.side - tang * self.side.dot(tang)
            sd /= np.linalg.norm(sd)
            nrm = np.cross(tang, sd)
            u = Q @ sd
            v = Q @ nrm
            w = np.maximum(self.width(s), 1e-4)
            h = np.maximum(self.thick(s), 1e-4)
            if self.edge > 0:     # a bevelled section with a blunt edge: the diamond, never thinner than `edge`
                hv = np.maximum(h * (1.0 - np.abs(u) / w), self.edge)
                dd = np.maximum(np.abs(u) - w, (np.abs(v) - hv) * 0.9)
            else:
                dd = (np.abs(u) / w + np.abs(v) / h - 1.0) * np.minimum(w, h) * 0.9   # diamond section
            at = (P - p0) @ tang                            # capped at the segment's ends
            dd = np.maximum(dd, np.maximum(-at, at - math.sqrt(L2)))
            best = np.minimum(best, dd)
        return best


class RingBands:
    """Flat leather bands round a limb, built directly as the game mesh (no SDF, no decimation): each band is an
    elliptical ring (rx across, ry deep) about `axis`, tilted `tilt` degrees about Y, `width` wide and `thick` deep,
    an outer face and two edges (the inner face lies against the leg). mesh() mirrors Sculpt.mesh -> (verts, quads)."""
    low = True

    def __init__(self, name, bands, axis, width=0.013, thick=0.0045, segs=18, arc=None):
        self.name, self.bands, self.axis = name, bands, unit(axis)
        self.width, self.thick, self.segs = width, thick, segs
        self.arc = arc            # (t0, t1) radians: an open strap over that arc only (0 = +X, pi/2 = the back)

    def evaluate(self, voxel, bounds=None):     # no distance field (the fit tool skips it as an empty part)
        return np.ones((1, 1, 1)), np.zeros(3)

    def mesh(self, voxel=None):
        V, Q = [], []
        for c, rx, ry, tilt in self.bands:
            a = math.radians(tilt)
            Ry = np.array([[math.cos(a), 0, math.sin(a)], [0, 1, 0], [-math.sin(a), 0, math.cos(a)]])
            n = Ry @ (-self.axis)
            e1 = unit(np.array([1.0, 0, 0]) - n * n[0])
            e2 = np.cross(n, e1)
            base = len(V)
            ts = [2 * math.pi * i / self.segs for i in range(self.segs)] if self.arc is None else \
                list(np.linspace(self.arc[0], self.arc[1], self.segs))
            for t in ts:
                p = np.asarray(c) + e1 * rx * math.cos(t) + e2 * ry * math.sin(t)
                o = unit(e1 * math.cos(t) / rx + e2 * math.sin(t) / ry)          # the ellipse's outward normal
                for dr, dw in ((-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)):
                    V.append(p + o * (dr * self.thick + 0.5 * self.thick) + n * dw * self.width)
            for i in range(self.segs if self.arc is None else self.segs - 1):
                j = (i + 1) % self.segs
                a_, b_ = base + 4 * i, base + 4 * j
                Q.append((a_ + 0, b_ + 0, b_ + 1, a_ + 1))       # lower edge
                Q.append((a_ + 1, b_ + 1, b_ + 2, a_ + 2))       # outer face
                Q.append((a_ + 2, b_ + 2, b_ + 3, a_ + 3))       # upper edge
            if self.arc is not None:                              # the strap's ends (tucked under the greave)
                e0, e1_ = base, base + 4 * (self.segs - 1)
                Q.append((e0 + 0, e0 + 1, e0 + 2, e0 + 3))
                Q.append((e1_ + 3, e1_ + 2, e1_ + 1, e1_ + 0))
        return np.array(V), np.array(Q)


# ── the knives: built in the rest pose at the palm, reverse grip (the blade leaves the fist behind the little
# finger, along the prop bone's -Y; prop +Y, the aim axis, points out of the thumb side) ───────────────────────
KNIFE = {"grip": 0.095, "blade": 0.40, "width": 0.030, "thick": 0.0075}


def knife_parts(s: str, J: dict):
    sx = 1.0 if s == "L" else -1.0
    palm = J[f"palm.{s}"]
    g = np.array([0.0, -1.0, 0.0])                 # prop +Y in the rest pose (bone points front)
    up = np.array([0.0, 0.0, 1.0])
    back = -g
    c = palm + np.array([sx * 0.006, 0.0, -0.004])
    grip = Sculpt(f"knife_grip_{s}")
    grip.add(FlatCapsule(c + g * 0.055, c + back * 0.050, 0.0125, 0.016, side=(1, 0, 0)).displaced(wraps(0.0018, 260.0, 1), 0.002), k=0.0)
    grip.add(Ellipsoid(c + g * 0.068, (0.016, 0.014, 0.019)), k=0.006)          # the pommel cap (wrapped)
    guard = Sculpt(f"knife_guard_{s}")
    gc = c + back * 0.058
    guard.add(RoundBox(gc, (0.013, 0.008, 0.026), 0.005), k=0.0)
    guard.add(RoundBox(gc + up * 0.026 + back * 0.006, (0.009, 0.010, 0.008), 0.004), k=0.004)
    blade = Sculpt(f"knife_blade_{s}")
    a = gc + back * 0.004
    b = gc + back * KNIFE["blade"] + up * 0.045
    m = gc + back * (KNIFE["blade"] * 0.55) - up * 0.010
    W = KNIFE["width"]

    def width(s_):
        s_ = np.asarray(s_, dtype=np.float64)
        return W * (0.62 + 0.55 * np.sin(np.clip(s_, 0, 1) * math.pi * 0.85) ** 1.2) * np.clip((1.0 - s_) / 0.22, 0.0, 1.0) ** 0.75 + 0.0015

    def thick(s_):
        s_ = np.asarray(s_, dtype=np.float64)
        return KNIFE["thick"] * (1.0 - 0.55 * s_) + 0.0012
    blade.add(Blade(a, m, b, up, width, thick, n=20), k=0.0)
    return grip, guard, blade, (b - gc)


def _poly_inside_dist(poly, u, v):
    """signed 2D distance to a closed polygon, positive inside"""
    V = np.asarray(poly, dtype=np.float64)
    uv = np.stack([u, v], 1)
    d2 = np.full(len(uv), np.inf)
    inside = np.zeros(len(uv), dtype=bool)
    for i in range(len(V)):
        a, b = V[i], V[(i + 1) % len(V)]
        e = b - a
        w = uv - a
        h = np.clip((w @ e) / (e @ e + 1e-12), 0, 1)
        d2 = np.minimum(d2, np.sum((w - h[:, None] * e) ** 2, axis=1))
        c1 = uv[:, 1] >= a[1]
        c2 = uv[:, 1] < b[1]
        c3 = e[0] * w[:, 1] > e[1] * w[:, 0]
        inside ^= (c1 & c2 & c3) | (~c1 & ~c2 & ~c3)
    return np.where(inside, 1.0, -1.0) * np.sqrt(d2)


# ── the head (FIX PASS 3, review: the bubble visor in an egg helm with cheek guards read as a motorcycle / sci-fi
# helmet, the blank grooved back as a robot head). The concept's head: a NARROW carved skull, a slim carved stone
# mask, and the dawnglass VISOR as a sickle blade: a band across the eyes from a horn over each temple, its front a
# prow (two panes meeting in a keel, the beak: the facing cue from above) that hangs on down in front of the mouth
# into a point below the chin; carved nape plates stepping out like a lobster tail behind.
# (FIX PASS 5, review: under a beak that stopped at the upper lip the mask's long chin stuck out as a beige knob, a
# snout; the dome was a featureless egg; the hero art read as a bald mannequin in a blue band): the visor hangs on to
# a point below the chin again with the slim white mask BEHIND it, painted see-through (the concept's mask shows
# through the glass), the mask flat-fronted and recessed (no chin past the glass), the helm carved: a brow band under
# the visor's top edge, a stone ring boss at each temple where the visor's horn pivots, the back of the skull warm
# carved plates (the concept's back view) under the white crown
SKULL = {"c": (0.0, 0.014, 1.668), "r": (0.074, 0.096, 0.122)}
# the visor's prow: the lens between two ellipsoids offset +-d in x (their intersection: a keel down the front),
# `thick` deep; clipped by VISOR_PROF (side view, u = back +Y, v = up: the temple horns, the band's back edge) and
# VISOR_FRONT (front view, u = x, v = up: the top edge over the brow, the band's lower edge, the narrow beak)
# (fix pass 4, review: the band stood ~7 cm off the narrow skull at the temples, a dark void between the visor and the
# helm in every three-quarter view: the two lens ellipsoids are narrower and closer, the band hugs the temples ~1 cm off)
LENS = {"d": 0.018, "c": (0.0, 0.004, 1.620), "r": (0.080, 0.150, 0.260), "thick": 0.010}
VISOR_PROF = np.array([(-0.200, 1.700), (-0.120, 1.708), (-0.080, 1.718), (-0.040, 1.734), (0.000, 1.750),
                       (0.024, 1.760), (0.044, 1.768), (0.040, 1.740), (0.024, 1.706), (0.002, 1.674),
                       (-0.028, 1.646), (-0.056, 1.616), (-0.076, 1.580), (-0.090, 1.536), (-0.100, 1.498),
                       (-0.108, 1.470), (-0.200, 1.470)])
# (fix pass 5) the band's lower edge runs down from the temples beside the jaw into the beak, a point 2 cm under the
# chin and 5 cm in front of it: from the front the mask's jaw shows either side of the narrow beak
VISOR_FRONT = np.array([(-0.140, 1.820), (-0.084, 1.800), (-0.068, 1.758), (-0.050, 1.730), (-0.028, 1.713),
                        (0.000, 1.706), (0.028, 1.713), (0.050, 1.730), (0.068, 1.758), (0.084, 1.800), (0.140, 1.820),
                        (0.140, 1.640), (0.076, 1.632), (0.058, 1.612), (0.044, 1.584), (0.032, 1.556),
                        (0.020, 1.528), (0.009, 1.503), (0.0, 1.488), (-0.009, 1.503), (-0.020, 1.528),
                        (-0.032, 1.556), (-0.044, 1.584), (-0.058, 1.612), (-0.076, 1.632), (-0.140, 1.640)])


def lens_y(x, z, inset=0.0):
    """the visor lens's front surface y at (x, z) (NaN outside), `inset` m inside the outer surface"""
    x, z = np.asarray(x, dtype=np.float64), np.asarray(z, dtype=np.float64)
    cx, cy, cz = LENS["c"]
    rx, ry, rz = (r - inset for r in LENS["r"])
    ys = []
    for s in (1.0, -1.0):
        q = 1.0 - ((x - s * LENS["d"]) / rx) ** 2 - ((z - cz) / rz) ** 2
        ys.append(np.where(q > 0, cy - ry * np.sqrt(np.maximum(q, 0)), np.nan))
    return np.maximum(ys[0], ys[1])


def _front_top(x):
    """the visor's top edge from the front (VISOR_FRONT's upper chain), z at x"""
    top = VISOR_FRONT[:11]
    return np.interp(x, top[:, 0], top[:, 1])


def _visor_top_edge(xs):
    """the visor's real top edge in 3D, temple horn to temple horn: for each x the highest lens point inside both
    clip outlines (the front view's top chain and the side view's sickle)"""
    prof = smooth_poly(VISOR_PROF, n=4, closed=True)
    out = []
    zs = np.linspace(1.62, 1.86, 241)
    for x in xs:
        y = lens_y(np.full_like(zs, x), zs)
        ok = ~np.isnan(y)
        din = np.minimum(_poly_inside_dist(prof, np.nan_to_num(y, nan=9.0), zs), _poly_inside_dist(VISOR_FRONT, np.full_like(zs, x), zs))
        ok &= din > 0.0
        if not ok.any():
            out.append(None)
            continue
        i = int(np.nonzero(ok)[0].max())
        out.append((float(x), float(y[i]), float(zs[i])))
    return out


# the accent ridge rides the visor's top edge (on the glass's outer face) from horn to horn over the brow
# (fix pass 5: the brief's ridge fin, ~30 cm of it: the whole top edge, not only the 10 cm over the brow)
_RX = np.linspace(-0.074, 0.074, 9)
RIDGE_PTS = []
RIDGE_R = []
for _pt, _r in zip(_visor_top_edge(_RX), (0.0080, 0.0100, 0.0120, 0.0134, 0.0140, 0.0134, 0.0120, 0.0100, 0.0080)):
    if _pt is not None:
        RIDGE_PTS.append((_pt[0], _pt[1] + 0.001, _pt[2] - 0.003))
        RIDGE_R.append(_r)


def _visor_low_edge(xs):
    """the visor's lower edge in 3D, side to beak to side: for each x the lowest lens point inside both outlines"""
    prof = smooth_poly(VISOR_PROF, n=4, closed=True)
    out = []
    zs = np.linspace(1.46, 1.76, 301)
    for x in xs:
        y = lens_y(np.full_like(zs, x), zs)
        ok = ~np.isnan(y)
        din = np.minimum(_poly_inside_dist(prof, np.nan_to_num(y, nan=9.0), zs), _poly_inside_dist(VISOR_FRONT, np.full_like(zs, x), zs))
        ok &= din > 0.0
        if ok.any():
            i = int(np.nonzero(ok)[0].min())
            out.append((float(x), float(y[i]), float(zs[i])))
    return out


# (fix pass 5) the accent beyond the brief's ridge: a seam along the crest's foot, a thin inlay along its crown edge
# (both seen from above at every facing) and a line down the back keel (seen from behind); never on the visor's
# lower edge (an outlined beak read as the review's blue down-arrow); three QA accent ~2 % at the game camera
# the line down the back keel from under the crest's tail to the nape (seen from behind at the game camera)
KEEL_PTS = [(0.0, 0.062, 1.792), (0.0, 0.103, 1.750), (0.0, 0.120, 1.690), (0.0, 0.113, 1.640)]
KEEL_R = [0.0070, 0.0085, 0.0085, 0.0065]
# the crest: a stone crescent from the brow (its root on the ridge), over the crown and back, its tail lifting off the
# dome (u = back, v = up). Lower and longer than fix pass 2's (from the game camera the tall arc read as an ear)
CREST_POLY = smooth_poly([(-0.112, 1.712), (-0.136, 1.746), (-0.122, 1.782), (-0.070, 1.822), (0.000, 1.850),
                          (0.080, 1.866), (0.160, 1.874), (0.238, 1.878), (0.186, 1.848), (0.126, 1.828),
                          (0.062, 1.808), (0.000, 1.786), (-0.046, 1.762), (-0.082, 1.732), (-0.098, 1.710)], n=5)
# (FIX PASS 5, review: the crest had become one solid accent-glass mohawk, 2.9-4.5 % accent at the game camera, no
# stone frame in any hero render): the concept's crest, a pale chalk crescent FRAME (a broad outer band, a narrow
# inner band on the dome, three ribs) round recessed panes of pale dawnglass; the accent is the brief's ridge fin
# only (the visor's top edge) and a narrow seam where the crest roots on the dome (seen from above at any facing)
CREST_W = 0.034
PANE_W = 0.016
_CREST_TIP = 7 * 5                 # CREST_POLY's index of the tail tip (control point 7, n = 5)


def crest_pane_poly(grow=0.0):
    """the glass panes' outline: CREST_POLY's outer chain inset 1.5 cm (the broad stone band), its inner chain 0.8 cm
    (the band on the dome); `grow` m outward (the pane part is a hair larger than the hole it fills)"""
    out_, in_ = inset(CREST_POLY, 0.015 - grow), inset(CREST_POLY, 0.008 - grow)
    return np.concatenate([out_[:_CREST_TIP + 1], in_[_CREST_TIP + 1:]], 0)


# the crest's ribs between the panes (u0, v0, u1, v1), across the crescent
CREST_RIBS = ((-0.112, 1.770, -0.078, 1.738), (-0.012, 1.840, 0.000, 1.788), (0.110, 1.866, 0.104, 1.818))
# the accent seam where the crest roots on the dome: CREST_POLY's inner chain from the brow to the crown's back,
# a band +-ROOT_H about it, ROOT_W wide (its sides stand out ~1.3 cm either side of the crest's stone)
ROOT_H, ROOT_W = (0.004, 0.015), 0.078


def crest_root_poly():
    """the seam band: from ROOT_H[0] above the crest's inner edge to ROOT_H[1] below it (into the dome)"""
    inner = CREST_POLY[_CREST_TIP + 1:]
    inner = inner[(inner[:, 0] < 0.080) & (inner[:, 0] > -0.104)]
    return np.concatenate([inner + (0.0, ROOT_H[0]), inner[::-1] - (0.0, ROOT_H[1])], 0)


# a glowing inlay line along the crest's crown edge (seen from above at every facing: the brief's 'from any angle,
# including from above'), INLAY_W wide, standing INLAY_OUT proud of the stone's top
INLAY_W, INLAY_OUT, INLAY_IN = 0.012, 0.0035, 0.006


def crest_inlay_poly():
    outer = CREST_POLY[:_CREST_TIP + 1]
    outer = outer[(outer[:, 0] > -0.128) & (outer[:, 0] < 0.200)]
    a_, b_ = inset(CREST_POLY, -INLAY_OUT)[:_CREST_TIP + 1], inset(CREST_POLY, INLAY_IN)[:_CREST_TIP + 1]
    sel = (CREST_POLY[:_CREST_TIP + 1, 0] > -0.128) & (CREST_POLY[:_CREST_TIP + 1, 0] < 0.200)
    return np.concatenate([a_[sel], b_[sel][::-1]], 0)


# the two swept glass fins on the left of the skull, rooted behind the visor's horn: (root, tip, bow, half-width,
# blade-plane normal). Built as clean game meshes (BladeMesh: the voxel remesh frayed their edges into feathers);
# rooted high beside the crest and laid flat-ish (faces up and out), so from the game camera they and the crest read
# as one swept comb of layered blades, not a second thin spike beside it (review: rabbit ears)
# (fix pass 4, review: from the game camera the crest and the flat-laid fins still split into a V of pale blades,
# 'ears': the fins are now UPRIGHT blades like the crest (the painting's: seen broad from the side), rooted under the
# crest on the left and running parallel to it close beside the head, so from the front they stack on the crest as
# one comb and from the side they are its lower strokes)
FINS = (((0.040, 0.024, 1.758), (0.066, 0.360, 1.846), 0.010, 0.034, (0.97, 0.0, 0.24)),
        ((0.054, 0.034, 1.722), (0.082, 0.300, 1.776), 0.006, 0.028, (0.95, 0.0, 0.30)))
# the nape plates: three stacked lames hugging the skull's lower back, each an offset shell of NAPE_E a step further
# out than the one above, so the back steps down and in toward the neck like a lobster tail: (top z, bottom z, offset)
NAPE_E = {"c": (0.0, 0.020, 1.640), "r": (0.070, 0.090, 0.095)}
NAPE = ((1.640, 1.612, 0.002), (1.614, 1.586, 0.0055), (1.588, 1.558, 0.009))
# (fix pass 4, review: the lames read as a brown rectangular block stuck on the white helm): each lame's edges curve up
# toward the jaw (cut planes tilted NAPE_TILT about X: z + NAPE_TILT * (y - NAPE_Y) = const), so from behind they
# read as stacked arcs following the skull, and they are painted a warm light stone a step under the helm
NAPE_TILT, NAPE_Y = 0.42, 0.110


def nape_z(z, y):
    """a nape cut height z (at the back's centre) at depth y"""
    return z + NAPE_TILT * (NAPE_Y - y)


# the temple ring bosses (fix pass 5): where each horn of the visor pivots on the skull, a carved stone ring
TEMPLE = {"c": (0.0, 0.046, 1.722), "x": 0.069, "R": 0.0175, "r": 0.0046}
# the brow band: the skull's shell 4.5 mm proud between two planes rising toward the back (z at y = 0: low, high;
# the rise per m of y), the front half only (it ends at the temple bosses)
BROW = (1.738, 1.760, 0.30)
# the helm's carved plates (painted on the sculpt): the white crown's seam over the brow band, the back of the skull
# below the crest in warm carved plates (the concept's back view) stepping down to the nape
HELM_BACK_Y = 0.020            # the warm plates start behind this (y) under the crest
HELM_BACK_ARCS = (1.722,)   # their seams (z at the back's centre, curving up toward the temples)
# carved lines of the face-plate, painted (no slit mouth: the horizontal cut read as a robot grille): the concept's
# mask: a brow line, a long line down each cheek from under the eye to the jaw, the jaw's edge, a short line under
# the cheekbone; centre lines (m) and half-width
FACE_LINES = []
for _sx in (-1.0, 1.0):
    FACE_LINES.append(([(_sx * 0.046, 1.654), (_sx * 0.024, 1.650), (_sx * 0.008, 1.641)], 0.0016))
    FACE_LINES.append(([(_sx * 0.041, 1.630), (_sx * 0.037, 1.598), (_sx * 0.031, 1.566), (_sx * 0.019, 1.537),
                        (_sx * 0.006, 1.518)], 0.0017))
    FACE_LINES.append(([(_sx * 0.050, 1.614), (_sx * 0.048, 1.580), (_sx * 0.041, 1.550), (_sx * 0.027, 1.523)], 0.0015))
    FACE_LINES.append(([(_sx * 0.020, 1.606), (_sx * 0.012, 1.586)], 0.0013))


class BladeMesh:
    """Swept glass blades built directly as the game mesh (no SDF, no remesh: clean edges): a quadratic centreline
    a -> m -> b, half-width w(s) across the blade plane (normal `nrm`), a hexagonal section (a blunt edge e, a
    spine h(s)). mesh() mirrors Sculpt.mesh -> (verts, quads)."""
    low = True

    def __init__(self, name, blades, n=22, emax=0.0011):
        self.name, self.blades, self.n, self.emax = name, blades, n, emax

    def evaluate(self, voxel, bounds=None):     # no distance field (the fit tool skips it as an empty part)
        return np.ones((1, 1, 1)), np.zeros(3)

    def mesh(self, voxel=None):
        V, Q = [], []
        for a, m, b, nrm, width, thick in self.blades:
            a, m, b = (np.asarray(x, dtype=np.float64) for x in (a, m, b))
            base = len(V)
            ss = np.linspace(0, 1, self.n)
            for s in ss:
                c = (1 - s) ** 2 * a + 2 * s * (1 - s) * m + s * s * b
                tg = unit(2 * (1 - s) * (m - a) + 2 * s * (b - m))
                nn = unit(np.asarray(nrm) - tg * np.dot(nrm, tg))
                sd = unit(np.cross(nn, tg))
                w, h = float(width(s)), float(thick(s))
                e = min(h * 0.45, self.emax)
                for du, dv in ((w, e), (0.0, h), (-w, e), (-w, -e), (0.0, -h), (w, -e)):
                    V.append(c + sd * du + nn * dv)
            for i in range(self.n - 1):
                r0, r1 = base + 6 * i, base + 6 * (i + 1)
                for j in range(6):
                    k = (j + 1) % 6
                    Q.append((r0 + j, r0 + k, r1 + k, r1 + j))
            for r in (base, base + 6 * (self.n - 1)):             # the end caps (two quads)
                cap = [(r + 0, r + 1, r + 2, r + 3), (r + 3, r + 4, r + 5, r + 0)]
                Q.extend(cap if r == base else [tuple(reversed(q_)) for q_ in cap])
        return np.array(V), np.array(Q)


def fin_blades():
    out = []
    for root, tip, bow, w, nrm in FINS:
        root, tip = np.array(root), np.array(tip)
        mid = (root + tip) / 2 + np.array([0.004, -0.012, bow])

        def width(s_, w=w):
            s_ = float(s_)
            return w * (0.70 + 0.30 * math.sin(min(1.0, s_ / 0.22) * math.pi * 0.5)) * (1.0 - s_) ** 0.80 + 0.0005

        def thick(s_):
            return 0.0042 * (1.0 - 0.6 * float(s_)) + 0.0008
        out.append((root, mid, tip, unit(nrm), width, thick))
    return out

# the game mesh budget per part (decimation targets; GLB <= 1172 KiB with the 2048 painted atlas and 17 clips)
TRIS = {"helm": 860, "face": 620, "visor": 900, "nape": 640, "crest": 640, "crest_glass": 300, "visor_ridge": 300,
        "neck": 300, "cowl": 800, "torso": 900, "chest_plate": 560, "straps": 360, "medallion": 160,
        "medallion_glass": 60, "belt": 500, "buckle": 200, "skirt_R": 620, "skirt_L": 620, "apron": 400,
        "sleeves": 700, "bracer_R": 460, "bracer_L": 460, "hand_R": 560, "hand_L": 560, "pauldron_R": 480,
        "pauldron_L": 500, "lames_L": 900, "trousers": 1200, "knee_R": 260, "knee_L": 260, "greave_R": 340,
        "greave_L": 340, "calfwrap_R": 240, "calfwrap_L": 240, "boots": 800, "knife_grip_R": 160, "knife_grip_L": 160,
        "knife_guard_R": 80, "knife_guard_L": 80, "knife_blade_R": 300, "knife_blade_L": 300}
# atlas share (texel weight): the helmet and the chest the camera reads, less on the hidden and the procedural parts
UV_WEIGHT = {"helm": 1.6, "face": 1.6, "visor": 1.5, "nape": 1.3, "crest": 1.4, "fins": 1.2, "chest_plate": 1.3, "cowl": 1.2,
             "lames_L": 1.2, "pauldron_L": 1.2, "boots": 0.6, "knife_blade_R": 0.5, "knife_blade_L": 0.5,
             "knife_grip_R": 0.4, "knife_grip_L": 0.4, "knife_guard_R": 0.4, "knife_guard_L": 0.4, "trousers": 0.8,
             "calfwrap_R": 0.7, "calfwrap_L": 0.7}


def bracer_guard(s: str, J: dict):
    """the forearm guard's shell: segment (elbow end a, wrist end b) and the outer / inner FlatCapsule radii
    (rw_a, rd_a, rw_b, rd_b) round the bracer's wrap capsule (0.047 / 0.045 -> 0.040 / 0.038)
    (fix pass 3: hugging the wraps, 4 mm off them: the 2 cm stand-off read as a plaster cast)"""
    el, wr, d2 = J[f"elbow.{s}"], J[f"wrist.{s}"], J[f"d2.{s}"]
    if s == "L":
        a_, b_ = el - d2 * 0.030, wr - d2 * 0.012
        ro, ri = (0.060, 0.057, 0.050, 0.047), (0.052, 0.050, 0.043, 0.041)
    else:
        a_, b_ = el + d2 * 0.012, wr - d2 * 0.014
        ro, ri = (0.059, 0.056, 0.050, 0.047), (0.051, 0.049, 0.043, 0.041)
    return a_, b_, ro, ri


def bracer_tip(s: str, J: dict):
    """the guard's pointed flare at the elbow end (the painting's): the tip point and the two chevron plane normals"""
    el, d2 = J[f"elbow.{s}"], J[f"d2.{s}"]
    sx = 1.0 if s == "L" else -1.0
    outv = unit(np.array([sx, 0.0, 0.0]) - d2 * (sx * d2[0]))
    e2 = unit(np.cross(d2, outv))
    a_, b_, ro, _ = bracer_guard(s, J)
    tip = a_ - d2 * (0.045 if s == "L" else 0.032) + outv * ro[0]
    th = math.radians(52.0)
    return tip, [unit(-d2 * math.cos(th) + e2 * math.sin(th)), unit(-d2 * math.cos(th) - e2 * math.sin(th))], outv, e2


# the left pauldron's four stacked stone blades out, up and back from the cap, the top one the 30 cm spike:
# (root, tip, half-width, thickness)
# (fix pass 5, review: flat planes): a third thicker, the edges blunter (BladeMesh emax)
LAMES = (((0.085, -0.015, 1.470), (0.428, 0.150, 1.672), 0.052, 0.029),
         ((0.170, -0.020, 1.418), (0.360, 0.105, 1.545), 0.050, 0.027),
         ((0.205, -0.018, 1.378), (0.385, 0.085, 1.448), 0.046, 0.025),
         ((0.225, -0.012, 1.340), (0.372, 0.065, 1.370), 0.040, 0.022))


SPIKE_TEETH = (0.42, 0.58, 0.73)       # (fix pass 5) the concept's notched spike: hooked teeth on its lower edge


def spike_teeth():
    """the spike's teeth: short hooked blades off its lower edge (the blade's +side), raked toward its tip"""
    a, m, b, side, width, thick = lame_blades()[0]
    tg0 = unit(b - a)
    sd = unit(side - tg0 * side.dot(tg0))
    nrm = unit(np.cross(tg0, sd))
    out = []
    for i, s_ in enumerate(SPIKE_TEETH):
        c = (1 - s_) ** 2 * a + 2 * s_ * (1 - s_) * m + s_ * s_ * b
        tg = unit(2 * (1 - s_) * (m - a) + 2 * s_ * (b - m))
        w = float(width(s_))
        r0 = c + sd * w * 0.55 - tg * 0.010
        tip = r0 + tg * (0.040 - 0.006 * i) + sd * (0.034 - 0.005 * i)
        mid = (r0 + tip) / 2 + sd * 0.004 - tg * 0.006

        def tw(s2, w0=0.016 - 0.002 * i):
            return w0 * (1.0 - float(s2)) ** 0.9 + 0.0008

        def tt(s2):
            return 0.010 * (1.0 - 0.6 * float(s2)) + 0.001
        out.append((r0, mid, tip, nrm, tw, tt))
    return out


def lame_mesh_blades():
    """lame_blades() for BladeMesh: the blade-plane normal from the width direction (fix pass 4, review: the voxel
    remesh of the SDF lames merged them into one slab with a saw-toothed edge)"""
    out = []
    for a, m, b, side, width, thick in lame_blades():
        tg = unit(b - a)
        out.append((a, m, b, unit(np.cross(tg, unit(side - tg * side.dot(tg)))), width, thick))
    return out + spike_teeth()


def lame_blades():
    out = []
    for root, tip, w, t in LAMES:
        root, tip = np.array(root), np.array(tip)
        mid = (root + tip) / 2 + np.array([0.012, -0.02, -0.025])
        side = unit(np.cross(tip - root, (0.0, -1.0, 0.25)))

        def width(s_, w=w):
            s_ = np.asarray(s_, dtype=np.float64)
            return w * (0.85 + 0.25 * np.sin(np.clip(s_, 0, 1) * math.pi)) * np.clip((1 - s_) / 0.35, 0, 1) ** 0.9 + 0.002

        def thick(s_, t=t):
            return t * (1.0 - 0.5 * np.asarray(s_, dtype=np.float64)) + 0.002
        out.append((root, mid, tip, side, width, thick))
    return out


def sculpts() -> list:
    """(name, Sculpt, voxel scale, material role, bind, tris) in build order."""
    out = []
    J = layout()

    def part(name, S, role, bind, tris, vs=1.0):
        out.append((name, S, vs, role, bind, TRIS.get(name, tris)))

    # ── HELMET (rigid on the head; head space = the rest pose, facing -Y). FIX PASS 3: the concept's narrow carved
    # skull (no cheek guards), the slim stone mask under a SICKLE visor (a band across the eyes from a horn over each
    # temple, its front a keeled prow that hangs on into a beak below the chin), carved nape plates behind, the crest
    # crescent from the brow back over the crown, two swept glass fins off the left temple
    F_mid = np.array([[0.0, 1.0, 0.0], [0.0, 0.0, 1.0], [1.0, 0.0, 0.0]])        # u = back (+Y), v = up, n = +X
    F_front = np.array([[1.0, 0.0, 0.0], [0.0, 0.0, 1.0], [0.0, 1.0, 0.0]])      # u = x, v = up, n = +Y
    helm = Sculpt("helm")
    helm.add(Ellipsoid(SKULL["c"], SKULL["r"]).displaced(chips(0.0012, 7.0), 0.0012), k=0.0)
    # the raised keel down the back of the skull, from under the crest's tail to the nape
    keel = [(0.0, 0.055, 1.786), (0.0, 0.094, 1.746), (0.0, 0.110, 1.690), (0.0, 0.104, 1.636)]
    helm.add(Tube(keel, [0.0105, 0.0115, 0.0115, 0.0095], k=0.004), k=0.006)
    # (fix pass 5) the brow band: a raised carved band round the front of the skull just above the visor's top edge
    # (the white crown above it, the glass below), stepping the egg into a carved helm
    sr = np.asarray(SKULL["r"])
    helm.add(sdf.Blend([("add", Ellipsoid(SKULL["c"], tuple(sr + 0.0045)), 0.0),
                        ("inter", HalfSpace((0, 0, BROW[1]), unit((0, -BROW[2], 1)), 0.5), 0.0),
                        ("inter", HalfSpace((0, 0, BROW[0]), unit((0, BROW[2], -1)), 0.5), 0.0),
                        ("inter", HalfSpace((0, 0.036, 0), (0, 1, 0), 0.5), 0.004)]), k=0.003)
    # the temple ring bosses where the visor's horns pivot: a stone ring round a shallow disc
    tc = np.asarray(TEMPLE["c"])
    for sx in (-1.0, 1.0):
        c_ = tc + (sx * TEMPLE["x"], 0.0, 0.0)
        helm.add(Torus(c_, TEMPLE["R"], TEMPLE["r"], axes=sdf.frame((sx, 0.0, 0.0))), k=0.004)
        helm.add(Ellipsoid(c_ - (sx * 0.002, 0, 0), (0.006, 0.0145, 0.0145)), k=0.004)
    helm.inter(HalfSpace((0, 0, 1.585), (0, 0, -1), 0.5), k=0.01)
    part("helm", helm, "chalk", "bone:head", 900, 0.6)
    # the nape plates: three warm-stone lames stepping out below the skull's back, wrapping to the jaw
    # (fix pass 4: one smooth shell continuing the skull, the three lames painted on it as carved arcs: the stepped
    # 4.5 mm shells came out as a jagged ribbed block)
    nape = Sculpt("nape")
    r_ = np.asarray(NAPE_E["r"])
    nape.add(sdf.Blend([("add", Ellipsoid(NAPE_E["c"], tuple(r_ + 0.004)), 0.0),
                        ("sub", Ellipsoid(NAPE_E["c"], tuple(r_ - 0.004)), 0.0),
                        ("inter", HalfSpace((0, NAPE_Y, NAPE[-1][1]), unit((0, -NAPE_TILT, -1)), 0.5), 0.0),
                        ("inter", HalfSpace((0, NAPE_Y, NAPE[0][0] + 0.010), unit((0, NAPE_TILT, 1)), 0.5), 0.0)]),
             k=0.0)
    for sx in (-1.0, 1.0):                                       # the back and the sides behind the jaw only
        nape.inter(HalfSpace((0, 0.012, 1.6), unit((sx * -0.55, -1, 0.0)), 0.5), k=0.006)
    part("nape", nape, "stone", "bone:head", 640, 0.5)
    # the slim carved stone mask (fix pass 5): flat-fronted and recessed behind the glass, a brow ridge, high flat
    # cheek planes, a narrow nose line, the chin tapering DOWN (not forward: the long forward chin read as a snout)
    face = Sculpt("face")
    face.add(Ellipsoid((0, -0.020, 1.600), (0.052, 0.060, 0.088)), k=0.0)
    face.inter(HalfSpace((0, -0.074, 1.6), (0, -1, 0), 0.5), k=0.012)                             # the flat front
    face.add(RoundBox((0, -0.070, 1.652), (0.044, 0.010, 0.009), 0.006, axes=sdf.rot_x(-8)), k=0.010)  # the brow
    for sx in (-1, 1):                                                                             # cheek planes
        face.add(RoundBox((sx * 0.032, -0.066, 1.606), (0.016, 0.008, 0.024), 0.006, axes=sdf.rot_z(sx * 18)), k=0.012)
    face.add(RoundBox((0, -0.078, 1.612), (0.0055, 0.007, 0.026), 0.004), k=0.008)                # the nose line
    face.add(RoundCone((0, -0.048, 1.548), (0, -0.050, 1.512), 0.026, 0.011), k=0.02)             # the chin, down
    face.inter(HalfSpace((0, 0.02, 1.6), (0, 1, 0), 0.5), k=0.01)
    part("face", face, "chalk", "bone:head", 620, 0.5)
    # the VISOR (the hook): the lens shell (the keeled prow) clipped to the sickle (side) and the band + beak (front)
    visor = Sculpt("visor")
    d_, lc, lr, th = LENS["d"], np.asarray(LENS["c"]), LENS["r"], LENS["thick"]
    outer = sdf.Blend([("add", Ellipsoid(lc + (d_, 0, 0), lr), 0.0), ("inter", Ellipsoid(lc - (d_, 0, 0), lr), 0.0)])
    inner = sdf.Blend([("add", Ellipsoid(lc + (d_, 0, 0), tuple(r - th for r in lr)), 0.0),
                       ("inter", Ellipsoid(lc - (d_, 0, 0), tuple(r - th for r in lr)), 0.0)])
    visor.add(sdf.Blend([("add", outer, 0.0), ("sub", inner, 0.0)]), k=0.0)
    visor.inter(Profile((0, 0, 0), F_mid, smooth_poly(VISOR_PROF, n=4, closed=True), 0.40, 0.003), k=0.003)
    visor.inter(Profile((0, 0, 0), F_front, VISOR_FRONT, 0.60, 0.003), k=0.003)
    part("visor", visor, "dawnglass", "bone:head", 900, 0.42)
    # the brief's accent fin: a ridge along the visor's top edge, horn to horn, into the crest's root
    ridge = Sculpt("visor_ridge")
    ridge.add(Tube(RIDGE_PTS, RIDGE_R, k=0.004), k=0.0)
    ridge.add(Tube(KEEL_PTS, KEEL_R, k=0.003), k=0.0)
    ridge.add(Profile((0, 0, 0), F_mid, crest_inlay_poly(), INLAY_W, 0.003), k=0.0)
    # ...and the seam where the crest roots on the dome (fix pass 5: the crest's glass is dawnglass again; the team
    # colour reads from above along the crest's foot at any facing)
    ridge.add(Profile((0, 0, 0), F_mid, crest_root_poly(), ROOT_W, 0.004), k=0.004)
    part("visor_ridge", ridge, "accent", "bone:head", 300, 0.5)
    # the crest: the carved stone frame (outer band, the inner band on the dome, the ribs) round recessed glass panes
    crest = Sculpt("crest")
    crest.add(Profile((0, 0, 0), F_mid, CREST_POLY, CREST_W, 0.007), k=0.0)
    crest.sub(Profile((0, 0, 0), F_mid, crest_pane_poly(), CREST_W + 0.02, 0.003), k=0.002)
    for (u0, v0, u1, v1) in CREST_RIBS:
        crest.add(Capsule((0.0, u0, v0), (0.0, u1, v1), 0.0062), k=0.003)
    crest.inter(Profile((0, 0, 0), F_mid, inset(CREST_POLY, -0.001), CREST_W + 0.004, 0.006), k=0.0)
    part("crest", crest, "chalk", "bone:head", 700, 0.45)
    glass = Sculpt("crest_glass")
    glass.add(Profile((0, 0, 0), F_mid, crest_pane_poly(0.003), PANE_W, 0.003), k=0.0)
    part("crest_glass", glass, "dawnglass", "bone:head", 360, 0.45)
    part("fins", BladeMesh("fins", fin_blades()), "dawnglass", "bone:head", 600)

    # ── NECK + COWL ──────────────────────────────────────────────────────────────────────────────────────────
    neck = Sculpt("neck")
    neck.add(FlatCapsule((0, 0.012, 1.41), (0, 0.000, 1.585), 0.050, 0.046, 0.040, 0.040, side=(1, 0, 0)).displaced(
        folds(0.002, 60.0, axis=0), 0.002), k=0.0)
    part("neck", neck, "wood", ("auto_only", "chest", "neck", "head"), 380, 0.7)
    cowl = Sculpt("cowl")
    # (fix pass 5, review: a lumpy white bib instead of the concept's draped light-blue scarf): a slimmer collar
    # round the neck, the scarf's front hanging in a loose loop across the top of the chest (the clasp at its left
    # end), the hood bunched on the upper back, thin drapes over the shoulders; long folds along the drape
    cowl.add(Torus((0, 0.012, 1.434), 0.072, 0.031, axes=sdf.rot_x(-8), rz=0.028).displaced(folds(0.0035, 26.0, axis=2), 0.0035), k=0.0)
    loop = [(0.100, -0.048, 1.432), (0.076, -0.094, 1.386), (0.036, -0.117, 1.352), (0.0, -0.121, 1.344),
            (-0.036, -0.117, 1.352), (-0.076, -0.094, 1.386), (-0.100, -0.048, 1.432)]
    cowl.add(Tube(loop, [0.022, 0.025, 0.027, 0.028, 0.027, 0.025, 0.022], k=0.01).displaced(
        folds(0.004, 70.0, dirv=(1.0, 0.0, 0.0)), 0.004), k=0.02)
    cowl.add(Ellipsoid((0.0, 0.076, 1.400), (0.112, 0.044, 0.068), axes=sdf.rot_x(14)).displaced(folds(0.0045, 26.0, dirv=(1, 0, 0.3)), 0.0045), k=0.04)
    for sx in (-1, 1):
        cowl.add(Ellipsoid((sx * 0.102, 0.012, 1.424), (0.070, 0.070, 0.026), axes=sdf.rot_y(sx * 24)), k=0.035)
    part("cowl", cowl, "cloth2", ("auto_only", "chest", "neck"), 1000)

    # ── TORSO (the close blue under-suit) + the carved chest plate ───────────────────────────────────────────────
    torso = Sculpt("torso")
    torso.add(Ellipsoid((0, 0.008, 1.262), (0.150, 0.100, 0.150)), k=0.0)
    torso.add(Ellipsoid((0, 0.020, 1.350), (0.160, 0.095, 0.075)), k=0.06)
    torso.add(Ellipsoid((0, 0.004, 1.085), (0.122, 0.088, 0.100)), k=0.07)
    torso.add(Ellipsoid((0, 0.012, 0.955), (0.140, 0.100, 0.095)), k=0.06)
    for sx in (-1, 1):
        torso.add(Ellipsoid((sx * 0.085, 0.030, 1.405), (0.075, 0.055, 0.040)), k=0.04)
        torso.add(Sphere((sx * 0.178, 0.020, 1.358), 0.056), k=0.04)
    part("torso", torso, "cloth", ("auto_only", "hips", "spine", "chest", "shoulder.L", "shoulder.R"), 1100)
    plate = Sculpt("chest_plate")
    plate.add(Ellipsoid((0, -0.004, 1.272), (0.158, 0.112, 0.140)).displaced(chips(0.002, 9.0), 0.002), k=0.0)
    for sx in (-1, 1):
        plate.add(Ellipsoid((sx * 0.068, -0.078, 1.312), (0.072, 0.040, 0.056)), k=0.025)       # the pecs
    plate.inter(HalfSpace((0, -0.015, 1.27), (0, 1, 0), 0.5), k=0.02)
    plate.inter(HalfSpace((0, 0, 1.165), (0, 0, -1), 0.5), k=0.015)
    plate.inter(HalfSpace((0, 0, 1.392), (0, 0, 1), 0.5), k=0.015)
    plate.sub(Capsule((0, -0.13, 1.18), (0, -0.13, 1.37), 0.006), k=0.004)                       # the sternum groove
    for z in (1.205, 1.245):                                                                    # carved ab bands
        plate.sub(Torus((0, 0.0, z), 0.152, 0.0035, axes=np.diag([1.0, 1.25, 1.0])), k=0.002)
    part("chest_plate", plate, "chalk", ("zblend", "spine", "chest", 1.18, 1.30), 700)
    # (fix pass 3: no strap geometry: the tubes never lay on the painted straps, so a second, pale X showed under the
    # painted one on the back and a pale strap crossed the brown ones in front; the painting's straps carry them)
    med = Sculpt("medallion")                                    # the scarf's clasp at the left collar
    mc, mn = np.array([0.062, -0.122, 1.416]), unit((0.25, -1.0, 0.2))      # (fix pass 5: on the scarf's loop)
    med.add(Torus(mc, 0.026, 0.008, axes=sdf.frame(mn)), k=0.0)
    med.add(Torus(mc + np.array([-0.045, -0.002, -0.025]), 0.012, 0.0045, axes=sdf.frame(mn)), k=0.0)
    part("medallion", med, "chalk", "bone:chest", 260, 0.5)
    medg = Sculpt("medallion_glass")
    medg.add(Ellipsoid(mc - mn * 0.002, (0.022, 0.022, 0.007), axes=sdf.frame(mn)), k=0.0)
    part("medallion_glass", medg, "dawnglass", "bone:chest", 90, 0.5)

    # ── BELT, BUCKLE, HIP SASH ───────────────────────────────────────────────────────────────────────────────────
    belt = Sculpt("belt")
    belt.add(Torus((0, 0.004, 1.075), 0.128, 0.034, axes=np.diag([1.0, 0.128 / 0.098, 1.0]), rz=0.036), k=0.0)
    belt.add(Tube([(-0.150, -0.050, 1.035), (-0.06, -0.122, 1.005), (0.06, -0.128, 0.975), (0.150, -0.060, 0.950),
                   (0.155, 0.060, 0.990), (0.0, 0.118, 1.025), (-0.150, 0.065, 1.040), (-0.150, -0.050, 1.035)],
                  [0.016] * 8, k=0.01), k=0.0)
    belt.add(Torus((0.012, -0.135, 0.978), 0.018, 0.0055, axes=sdf.frame((0, -1, 0.1))), k=0.003)
    part("belt", belt, "leather", ("auto_only", "hips", "spine"), 620)
    buckle = Sculpt("buckle")
    bk = np.array([-0.010, -0.112, 1.072])
    buckle.add(RoundBox(bk, (0.060, 0.012, 0.030), 0.008, axes=sdf.rot_x(-6)), k=0.0)
    buckle.add(RoundBox(bk + (0, -0.004, -0.030), (0.028, 0.010, 0.016), 0.006), k=0.01)
    buckle.sub(RoundBox(bk + (0, -0.014, 0.0), (0.018, 0.006, 0.014), 0.003), k=0.003)
    part("buckle", buckle, "stone", "bone:spine", 300, 0.6)

    # ── SKIRT: the long coat skirt split at the back and the sides (the halves follow their thighs), the front
    # apron over the front opening ─────────────────────────────────────────────────────────────────────────────
    def skirt_fn(P):
        return folds(0.007, 20.0, axis=0, zfade=(0.98, 0.62))(P)
    for s, sx in (("R", -1), ("L", 1)):
        sk = Sculpt(f"skirt_{s}")
        shell = sdf.Blend([("add", FlatCapsule((0, 0.012, 1.035), (0, 0.025, 0.585), 0.148, 0.112, 0.255, 0.180, side=(1, 0, 0)), 0.0),
                           ("sub", FlatCapsule((0, 0.012, 1.05), (0, 0.025, 0.55), 0.134, 0.099, 0.243, 0.167, side=(1, 0, 0)), 0.0)])
        sk.add(shell.displaced(skirt_fn, 0.007), k=0.0)
        sk.inter(HalfSpace((0, 0, 0.60), (0, 0, -1), 1.0), k=0.004)
        sk.inter(HalfSpace((0, 0, 1.05), (0, 0, 1), 1.0), k=0.004)
        sk.inter(HalfSpace((sx * 0.006, 0, 0.8), (-sx, 0, 0), 1.0), k=0.003)                   # own half
        # the back slit (from the hem to 0.80) and the side slits
        sk.sub(RoundBox((0, 0.20, 0.66), (0.012, 0.10, 0.17), 0.006, axes=sdf.rot_x(4)), k=0.004)
        sk.sub(RoundBox((sx * 0.25, 0.0, 0.66), (0.10, 0.012, 0.13), 0.006), k=0.004)
        part(f"skirt_{s}", sk, "cloth", ("skirt", f"thigh.{s}", 1.00, 0.60, 0.55), 760)
    apron = Sculpt("apron")
    apron.add(RoundBox((-0.020, -0.168, 0.835), (0.105, 0.010, 0.205), 0.008, axes=sdf.rot_x(-7)).displaced(
        folds(0.004, 26.0, axis=0, zfade=(0.95, 0.65)), 0.004), k=0.0)
    apron.inter(HalfSpace((-0.020, -0.17, 0.635), unit((0.30, 0, -1)), 0.5), k=0.004)          # the slanted hem
    part("apron", apron, "cloth2", ("skirt", "both", 1.03, 0.62, 0.35), 500)

    # ── ARMS: sleeves, bracers, gloved fists (sculpted fingers round the knife grip), pauldrons ────────────────────
    sleeves = Sculpt("sleeves")
    for s in ("L", "R"):
        sh, el, wr = J[f"shoulder.{s}"], J[f"elbow.{s}"], J[f"wrist.{s}"]
        sleeves.add(FlatCapsule(sh + (0, 0.0, -0.01), el, 0.050, 0.052, 0.042, 0.044, side=(1, 0, 0)).displaced(
            folds(0.004, 40.0, axis=2), 0.004), k=0.0)
        sleeves.add(FlatCapsule(el, el + (wr - el) * 0.35, 0.042, 0.044, 0.040, 0.042, side=(1, 0, 0)), k=0.02)
    part("sleeves", sleeves, "cloth2", ("auto_only", "chest", "shoulder.L", "shoulder.R", "upper_arm.L", "upper_arm.R",
                                         "forearm.L", "forearm.R"), 850)
    for s, sx in (("R", -1.0), ("L", 1.0)):
        el, wr, d2 = J[f"elbow.{s}"], J[f"wrist.{s}"], J[f"d2.{s}"]
        outv = unit(np.array([sx, 0.0, 0.0]) - d2 * (sx * d2[0]))
        br = Sculpt(f"bracer_{s}")
        br.add(FlatCapsule(el + d2 * 0.035, wr - d2 * 0.005, 0.047, 0.045, 0.040, 0.038, side=(1, 0, 0)).displaced(
            wraps(0.0025, 120.0), 0.0025), k=0.0)
        # the stone guard: a curved plate wrapping the outer forearm (fix pass 2: the flat 2 cm board stood off the
        # arm like a white plank in every hero render), an open trough cut from a shell round the wraps, flaring
        # toward the elbow; the left one runs on past the elbow (the painting's long left guard)
        a_, b_, ro, ri = bracer_guard(s, J)
        tip, chev, _, _ = bracer_tip(s, J)
        a2 = a_ - d2 * 0.06                                  # the shell runs on past the elbow end into the flare
        shell = sdf.Blend([("add", FlatCapsule(a2, b_, *ro, side=(1, 0, 0)), 0.0),
                           ("sub", FlatCapsule(a2, b_, *ri, side=(1, 0, 0)), 0.0)])
        gd = sdf.Blend([("add", shell, 0.0),
                        ("inter", HalfSpace(el + outv * 0.010, -outv, 0.5), 0.004),
                        ("inter", HalfSpace(b_, d2, 0.5), 0.004),
                        ("inter", HalfSpace(tip, chev[0], 0.5), 0.003),
                        ("inter", HalfSpace(tip, chev[1], 0.5), 0.003)])
        br.add(gd, k=0.004)
        part(f"bracer_{s}", br, "stone", f"bone:forearm.{s}", 560)
    for s, sx in (("R", -1.0), ("L", 1.0)):
        palm, d2, pn = J[f"palm.{s}"], J[f"d2.{s}"], J[f"palm_n.{s}"]
        g = np.array([0.0, -1.0, 0.0])            # the grip axis (prop +Y in the rest pose)
        lat = unit(np.cross(g, d2)) * sx          # out of the fist's knuckle side (lateral)
        lat = unit(lat - g * lat.dot(g))
        hd = Sculpt(f"hand_{s}")
        wr = J[f"wrist.{s}"]
        hd.add(FlatCapsule(wr - d2 * 0.012, palm + lat * 0.006, 0.034, 0.024, 0.040, 0.028, side=g), k=0.0)    # the back of the hand
        # four curled fingers wrapped round the grip (index at the front, little finger at the back)
        for i, off in enumerate((-0.030, -0.010, 0.010, 0.029)):
            r = 0.0115 - 0.0008 * i
            base = palm + g * (-off) + lat * 0.024 + d2 * 0.010
            k1 = palm + g * (-off) + lat * 0.020 + d2 * 0.040
            k2 = palm + g * (-off) - lat * 0.012 + d2 * 0.046
            tipp = palm + g * (-off) - lat * 0.022 + d2 * 0.018
            hd.add(Tube([base, k1, k2, tipp], [r, r, r * 0.95, r * 0.85], k=0.006), k=0.008)
        th0 = palm + g * 0.036 + lat * 0.012 - d2 * 0.004
        hd.add(Tube([th0, palm + g * 0.050 - lat * 0.008 + d2 * 0.018, palm + g * 0.044 - lat * 0.022 + d2 * 0.034],
                    [0.013, 0.011, 0.0095], k=0.006), k=0.012)                                      # the thumb over the front
        hd.add(Torus(wr + d2 * 0.004, 0.036, 0.008, axes=sdf.frame(d2), rz=0.010), k=0.006)           # the glove cuff
        part(f"hand_{s}", hd, "under", f"bone:hand.{s}", 700, 0.5)
    for s, sx in (("R", -1.0), ("L", 1.0)):
        pd = Sculpt(f"pauldron_{s}")
        sh = J[f"shoulder.{s}"]
        if s == "R":    # the small round chalk cap with a rolled rim
            pd.add(Ellipsoid(sh + (sx * 0.014, 0.0, 0.018), (0.060, 0.066, 0.047), axes=sdf.rot_y(sx * 30)).displaced(chips(0.003, 8.0), 0.003), k=0.0)
            pd.add(Torus(sh + (sx * 0.026, 0.0, -0.006), 0.052, 0.008, axes=sdf.rot_y(sx * 36) @ np.diag([1, 0.85, 1]), rz=0.007), k=0.01)
            pd.sub(Ellipsoid(sh + (sx * -0.008, 0.0, -0.020), (0.054, 0.060, 0.040), axes=sdf.rot_y(sx * 30)), k=0.006)
            part("pauldron_R", pd, "stone", ("dblend", "shoulder.R", "upper_arm.R", tuple(sh + (0, 0, 0.05)), (-0.4, 0, -1), 0.0, 0.10), 650)
        else:           # the stacked blade lames: four swept blades out, up and back from the cap, the top one the long spike
            pd.add(Ellipsoid(sh + (0.028, 0.0, 0.035), (0.078, 0.085, 0.058), axes=sdf.rot_y(26)).displaced(chips(0.0015, 8.0), 0.0015), k=0.0)
            pd.sub(Ellipsoid(sh + (0.004, 0.0, -0.010), (0.068, 0.076, 0.048), axes=sdf.rot_y(26)), k=0.006)
            part("pauldron_L", pd, "stone", ("dblend", "shoulder.L", "upper_arm.L", tuple(sh + (0, 0, 0.05)), (0.4, 0, -1), 0.0, 0.10), 700)
            lm = BladeMesh("lames_L", lame_mesh_blades(), n=18, emax=0.0042)
            part("lames_L", lm, "stone", ("dblend", "shoulder.L", "upper_arm.L", tuple(sh + (0, 0, 0.05)), (0.4, 0, -1), 0.05, 0.22), 1100)

    # ── LEGS: baggy trousers, ironstone knee plates and greaves, blue-grey boots ──────────────────────────────────
    legs = Sculpt("trousers")
    legs.add(Ellipsoid((0, 0.015, 0.905), (0.150, 0.105, 0.080)), k=0.0)
    for s in ("L", "R"):
        hp, kn, an = J[f"hip.{s}"], J[f"knee.{s}"], J[f"ankle.{s}"]
        legs.add(FlatCapsule(hp + (0, 0.004, 0.0), kn + (0, 0.012, 0.03), 0.092, 0.090, 0.097, 0.088, side=(1, 0, 0)).displaced(
            folds(0.006, 26.0, axis=2, phase=1.0 if s == "L" else 2.4), 0.006), k=0.05)
        legs.add(Ellipsoid(kn + (0, 0.008, 0.080), (0.097, 0.090, 0.080)), k=0.04)           # the blouse above the knee
        legs.add(FlatCapsule(kn + (0, 0.012, 0.0), an + (0, 0.0, 0.06), 0.060, 0.064, 0.042, 0.045, side=(1, 0, 0)), k=0.03)
    part("trousers", legs, "under", ("auto_only", "hips", "thigh.L", "thigh.R", "shin.L", "shin.R"), 1450)
    for s, sx in (("R", -1.0), ("L", 1.0)):
        kn, an = J[f"knee.{s}"], J[f"ankle.{s}"]
        sd = unit(an - kn)
        kp = Sculpt(f"knee_{s}")
        # (fix pass 5, review: a flat chevron plate floating on the thigh in the lunge: it reached 13 cm above the knee
        # on the shin bone, so a bent knee swung it out over the thigh): the plate sits on the knee and the top of the
        # shin, its point no more than 6 cm above the joint
        kc = kn + np.array([0.0, -0.066, -0.004])
        kp.add(RoundBox(kc, (0.050, 0.016, 0.052), 0.012, axes=sdf.rot_x(-8)).displaced(chips(0.003, 8.0), 0.003), k=0.0)
        kp.add(RoundCone(kc + (0, 0.004, 0.036), kc + (0, 0.012, 0.064), 0.030, 0.006), k=0.02)     # the pointed top
        kp.inter(HalfSpace(kc + (0, 0.010, 0), (0, 1, 0), 0.4), k=0.006)
        part(f"knee_{s}", kp, "ironstone", f"bone:shin.{s}", 360)
        gr = Sculpt(f"greave_{s}")
        g0, g1 = kn + sd * 0.08, an + np.array([0, 0, 0.035])
        gr.add(sdf.Blend([("add", FlatCapsule(g0 + (0, -0.006, 0), g1 + (0, -0.004, 0), 0.066, 0.066, 0.048, 0.050, side=(1, 0, 0)), 0.0),
                          ("sub", FlatCapsule(g0 + (0, 0.002, 0), g1, 0.054, 0.054, 0.036, 0.040, side=(1, 0, 0)), 0.0)]), k=0.0)
        gr.inter(HalfSpace(g0 + (0, 0.022, 0), unit((0, 1, 0.05)), 0.6), k=0.008)                 # the front and sides
        # the keel down the shin's front (frame: X along the shin, Z forward; the first pass had the long axis on Z,
        # a 26 cm rod through the leg)
        gr.add(RoundBox((g0 + g1) / 2 + (0, -0.058, 0.0), (0.13, 0.005, 0.007), 0.004, axes=sdf.frame((0, -1, 0), sd)), k=0.008)
        part(f"greave_{s}", gr, "ironstone", f"bone:shin.{s}", 420)
        # the leather calf wraps: three flat bands built directly as the game mesh (a decimated 6 mm torus collapsed
        # into chords across the leg): two crossing at the back (the X), one level band under the knee
        bands = []
        a0, a1 = kn + np.array([0.0, 0.012, 0.0]), an + np.array([0.0, 0.0, 0.06])     # the trouser leg's axis
        for z, tilt in ((an[2] + 0.165, 17.0), (an[2] + 0.165, -17.0), (an[2] + 0.255, 0.0)):
            t2 = (a0[2] - z) / (a0[2] - a1[2])
            c0 = a0 + (a1 - a0) * t2
            rw, rd = 0.060 + (0.042 - 0.060) * t2, 0.064 + (0.045 - 0.064) * t2
            bands.append((c0, rw + 0.0035 + 0.006 * abs(math.sin(math.radians(tilt))), rd + 0.0035, tilt))
        # (fix pass 5, review: orange staples standing off the greave): flat straps lying on the calf, round the back
        # only, their ends tucked under the greave's edges
        part(f"calfwrap_{s}", RingBands(f"calfwrap_{s}", bands, sd, width=0.020, thick=0.0035, segs=12,
                                        arc=(math.pi / 2 - 0.95, math.pi / 2 + 0.95)), "leather", f"bone:shin.{s}", 300)
    boots = Sculpt("boots")
    for s, sx in (("R", -1.0), ("L", 1.0)):
        an, fw = J[f"ankle.{s}"], J[f"fwd.{s}"]
        heel = J[f"heel.{s}"]
        toe = J[f"toe.{s}"]
        ax = sdf.frame((0, 0, 1), fw)
        mid = (heel + toe) / 2
        fr = np.array([fw, np.cross((0.0, 0.0, 1.0), fw), (0.0, 0.0, 1.0)])
        boots.add(RoundBox(np.array([mid[0], mid[1], 0.045]), (0.128, 0.046, 0.045), 0.026, axes=fr), k=0.0)
        boots.add(RoundCone(np.array([toe[0], toe[1], 0.035]) - fw * 0.06, np.array([toe[0], toe[1], 0.022]) + fw * 0.040, 0.036, 0.012), k=0.03)   # the pointed toe
        boots.add(FlatCapsule(np.array([an[0], an[1] + 0.008, 0.03]), np.array([an[0], an[1] + 0.004, 0.17]), 0.050, 0.055, 0.046, 0.050, side=(1, 0, 0)), k=0.04)
        boots.add(RoundBox(np.array([heel[0], heel[1] + 0.012, 0.022]), (0.032, 0.030, 0.022), 0.008), k=0.006)   # the wedge heel
        boots.add(Torus(np.array([an[0], an[1] + 0.006, 0.165]), 0.050, 0.009, axes=np.diag([1.0, 0.92, 1.0])), k=0.008)
    boots.inter(HalfSpace((0, 0, 0.0), (0, 0, -1), 2.0), k=0.0)
    part("boots", boots, "leather", ("auto_only", "shin.L", "shin.R", "foot.L", "foot.R", "toe.L", "toe.R"), 1000)

    # ── KNIVES (rigid on the props) ─────────────────────────────────────────────────────────────────────────────
    for s in ("R", "L"):
        grip, guard, blade, _ = knife_parts(s, J)
        part(f"knife_grip_{s}", grip, "leather", f"bone:prop.{s}", 260, 0.45)
        part(f"knife_guard_{s}", guard, "ironstone", f"bone:prop.{s}", 120, 0.45)
        part(f"knife_blade_{s}", blade, "dawnglass", f"bone:prop.{s}", 420, 0.45)
    return out


THIN = ("fins", "lames_L", "crest", "crest_glass", "visor", "knife_blade_R", "knife_blade_L", "bracer_R", "bracer_L")


def skin_extras(extra: dict) -> list:
    """Lamplit's lamp cage on the crest's front horn: four carved-wood slats round a lampresin bead (7 cm)"""
    out = []
    if extra.get("lamp_cage"):
        c = np.array([0.0, -0.152, 1.758])       # before the crest's front edge (clear of its glass), above the ridge
        slats, bead = Sculpt("cage_slats"), Sculpt("cage_bead")
        for i in range(4):
            a = math.radians(45 + 90 * i)
            o = np.array([math.cos(a) * 0.021, math.sin(a) * 0.017, 0.0])
            slats.add(Tube([c + o + (0, 0, -0.034), c + o * 1.18 + (0, 0, 0.0), c + o + (0, 0, 0.034)], [0.0042, 0.0048, 0.0042]), k=0.003)
        slats.add(Torus(c + (0, 0, -0.034), 0.021, 0.0045, axes=np.diag([1.0, 1.22, 1.0])), k=0.003)
        slats.add(Torus(c + (0, 0, 0.034), 0.020, 0.0045, axes=np.diag([1.0, 1.22, 1.0])), k=0.003)
        slats.add(RoundCone(c + (0, 0, 0.036), c + (0, 0, 0.047), 0.008, 0.003), k=0.003)
        bead.add(Ellipsoid(c, (0.014, 0.012, 0.018)), k=0.0)
        out.append(("cage_slats", slats, 0.45, "wood_dark", "bone:head", 300))
        out.append(("cage_bead", bead, 0.45, "lampresin", "bone:head", 120))
    return out


def _install_render() -> None:
    """hero renders only (portrait, splash, icon, turntable): a matte specular level and a lower sky fill; the game's
    material is untouched (common/render.py is shared, so the wrap lives here)"""
    from common import render
    if getattr(render.fighter_renders, "_rishal", False):
        return
    orig_fr, orig_ml = render.fighter_renders, render.map_lighting
    state = {"on": False}

    def ml(map_id):
        d = orig_ml(map_id)
        return dict(d, ambient=d["ambient"] * HERO_FILL) if state["on"] else d

    orig_setup, orig_dn = render.setup, render.imageops.denoise

    def setup(w, h, samples, *a_, **k_):            # (review: render grain on the glass and in the shadows)
        return orig_setup(w, h, int(samples * HERO_SAMPLES) if state["on"] else samples, *a_, **k_)

    def denoise(path, strength=2.5):
        return orig_dn(path, strength * (HERO_DENOISE if state["on"] else 1.0))
    render.setup = setup
    render.imageops.denoise = denoise

    def fr(ctx, *a, **k):
        state["on"] = getattr(ctx.spec, "ID", None) == ID
        saved = []
        if state["on"]:
            for mat in bpy.data.materials:
                if mat.node_tree is None:
                    continue
                for nd in mat.node_tree.nodes:
                    if nd.type == "BSDF_PRINCIPLED" and not nd.inputs["Specular IOR Level"].is_linked:
                        saved.append((nd, nd.inputs["Specular IOR Level"].default_value))
                        nd.inputs["Specular IOR Level"].default_value = HERO_SPEC
        try:
            return orig_fr(ctx, *a, **k)
        finally:
            state["on"] = False
            for nd, v in saved:
                nd.inputs["Specular IOR Level"].default_value = v
    fr._rishal = True
    render.fighter_renders = fr
    orig_fit = render._fit_camera

    def fit(cam, lo, hi, yaw, pitch, lens, fill, aspect, x_frac, y_center=None):
        # (fix pass 5, review: the portrait left a small head in a mostly empty frame): the portrait's box starts
        # PORTRAIT_TIGHTEN higher (head, visor, crest and the shoulders' tops), the head a little left of centre
        if state["on"] and abs(pitch - 6.0) < 1e-6 and abs(lens - 85.0) < 1e-6 and abs(fill - 0.92) < 1e-6:
            lo = lo.copy()
            lo.z += PORTRAIT_TIGHTEN
            x_frac = PORTRAIT_X
        return orig_fit(cam, lo, hi, yaw, pitch, lens, fill, aspect, x_frac, y_center)
    render._fit_camera = fit
    render.map_lighting = ml
    orig_fc = render.fighter_clips

    def fc(ctx, *a, **k):                # the splash's hero pose (not a shipped clip)
        clips = orig_fc(ctx, *a, **k)
        if getattr(ctx.spec, "ID", None) == ID and _GUARD.get("pose") is not None:
            clips = dict(clips, splash_hero=_splash_hero(_GUARD["pose"]))
        return clips
    render.fighter_clips = fc


def _visor_material(src):
    """the visor's own copy of the dawnglass material (same role: the copy keeps the name before the '.'), its
    roughness raised by VISOR_ROUGH: the glossy pane mirrored the sky as a chrome shell"""
    m = src.copy()
    nt = m.node_tree
    bsdf = next(nd for nd in nt.nodes if nd.type == "BSDF_PRINCIPLED")
    sock = bsdf.inputs["Roughness"]
    if sock.is_linked:
        lk = sock.links[0]
        add = nt.nodes.new("ShaderNodeMath")
        add.operation = "ADD"
        add.use_clamp = True
        add.inputs[1].default_value = VISOR_ROUGH
        nt.links.new(lk.from_socket, add.inputs[0])
        nt.links.new(add.outputs[0], sock)
    else:
        sock.default_value = min(1.0, sock.default_value + VISOR_ROUGH)
    return m


def model(ctx) -> list:
    _install_bind()
    _install_paint()
    _install_render()
    P = []
    from common import mesh
    extra = (ctx.skin or {}).get("extra") or {}
    _SKIN.clear()
    _SKIN.update(ctx.skin or {})
    for name, S, vs, role, bind, tris in sculpts() + skin_extras(extra):
        v, q = S.mesh(VOXEL * vs)
        if getattr(S, "low", False):          # built directly as the game mesh; a copy is its bake source (the
            ob = sdf.to_object(f"{name}_high", v, q, ctx.col)        # skin path reads a part's role off its
            ob.data.materials.append(ctx.mats[role])                  # high after the lows are joined)
            low = mesh.duplicate(ob, f"{name}_low", ctx.col)
            P.append(fighter.Part(name, high=ob, low=low, bind=bind, uv_weight=UV_WEIGHT.get(name, 1.0)))
            continue
        ob = sdf.to_object(f"{name}_high", v, q, ctx.col)
        ob.data.materials.append(_visor_material(ctx.mats[role]) if name == "visor" else ctx.mats[role])
        if abs(float(np.mean(v[:, 0]))) > 0.03 or name in THIN:
            # one-sided parts (the fins, the lames, a hand): the shared decimation is X-symmetric and stalls on them;
            # thin blades (fins, lames, knives, crest) come out of the surface nets with non-manifold edges where they
            # thin to a voxel, which the collapse decimator will not touch: a voxel remesh makes them manifold first
            low = mesh.duplicate(ob, f"{name}_low", ctx.col)
            if name in THIN:
                rm = low.modifiers.new("Remesh", "REMESH")
                rm.mode = "VOXEL"
                rm.voxel_size = VOXEL * vs * 0.8
                rm.adaptivity = 0.0
                mesh.apply_modifiers(low)
            mesh.decimate_to(low, tris, symmetric=False)
            low.data.polygons.foreach_set("use_smooth", np.ones(len(low.data.polygons), dtype=bool))   # the remesh is flat
            low.data.update()
            P.append(fighter.Part(name, high=ob, low=low, bind=bind, uv_weight=UV_WEIGHT.get(name, 1.0)))
        else:
            P.append(fighter.Part(name, high=ob, tris=tris, bind=bind, uv_weight=UV_WEIGHT.get(name, 1.0)))
    return P


def rig_extras(ctx) -> None:
    """VFX sockets (brief §4): the knife tips (Glass Dash / Feint tracks), the visor ridge (the accent fin)"""
    J = layout()
    for s in ("R", "L"):
        _, _, _, tip = knife_parts(s, J)
        palm = J[f"palm.{s}"]
        gc = palm + np.array([0.0, 0.058, -0.004])
        rig.add_socket(ctx.info, f"x_knife_tip_{s.lower()}", f"prop.{s}", tuple(gc + tip), (0, 0.05, 0))
    rig.add_socket(ctx.info, "x_visor_ridge", "head", tuple(np.asarray(RIDGE_PTS[4]) + (0, 0, 0.006)), (0, 0, 0.05))


# ── binding: Rishal's wrap of the pipeline's part bind (common/ is shared, so it lives here) ────────────────────
#  ("auto_only", bone, ...)            the pipeline's heat bind restricted to those bones
#  ("skirt", thigh | "both", z0, z1, k) hips above z0, blending to k of the thigh below z1 (the skirt halves follow
#                                       their own thigh, the apron both by x): the coat swings with the legs in the
#                                       run and the dash without tearing between them
def _bind_skirt(obj, arm, thigh, z0, z1, k):
    from common import mesh
    obj.vertex_groups.clear()
    gh = obj.vertex_groups.new(name="hips")
    gl = obj.vertex_groups.new(name="thigh.L")
    gr = obj.vertex_groups.new(name="thigh.R")
    mw = obj.matrix_world
    for v in obj.data.vertices:
        co = mw @ v.co
        t = min(1.0, max(0.0, (z0 - co.z) / (z0 - z1)))
        t = t * t * (3.0 - 2.0 * t) * k
        if thigh == "both":
            u = min(1.0, max(0.0, (co.x + 0.07) / 0.14))
            u = u * u * (3.0 - 2.0 * u)
            wl, wr = t * u, t * (1.0 - u)
        else:
            wl, wr = (t, 0.0) if thigh.endswith("L") else (0.0, t)
        gh.add([v.index], 1.0 - t, "REPLACE")
        if wl > 1e-4:
            gl.add([v.index], wl, "REPLACE")
        if wr > 1e-4:
            gr.add([v.index], wr, "REPLACE")
    mesh.add_armature_modifier(obj, arm)
    mesh.parent_keep(obj, arm)


def _install_bind() -> None:
    from common import mesh, pipeline
    orig = pipeline.bind_part
    if getattr(orig, "_rishal", False):
        return

    def bind_part(ctx, part, obj, body_low=None):
        b = part.bind
        if isinstance(b, tuple) and b and b[0] == "auto_only":
            arm = ctx.info.armature
            keep = set(b[1:])
            return mesh.bind_auto(obj, arm, exclude=tuple(x.name for x in arm.data.bones if x.name not in keep))
        if isinstance(b, tuple) and b and b[0] == "skirt":
            _bind_skirt(obj, ctx.info.armature, *b[1:])
            mesh.limit_weights(obj)
            return {}
        return orig(ctx, part, obj, body_low)
    bind_part._rishal = True
    pipeline.bind_part = bind_part


# ── projection paint: Rishal's wrap of common/hifi/project.paint_object ──────────────────────────────────────────
# The painting's pose is not the rest pose: each plate is projected onto the mesh POSED like that view of the
# painting (CONCEPT_POSE[side], anim poses with IK targets placed on the painting's joints, through the armature),
# so the head turned 40 degrees to his right, the left elbow out, the splayed legs and the turned-out right foot each
# take their own paint. Texel maps come from the posed meshes (same UVs), so the atlas lands on the rest mesh.
# Parts the painting does not show as built are painted procedurally (PAINTED): the knives (reverse-gripped glass,
# the painting holds them two different ways), the boots (the back view's blue-grey with dark soles).
def _feet(l=(0.0, 0.0, 0.0), r=(0.0, 0.0, 0.0), yl=0.0, yr=0.0, pl=0.0, pr=0.0):
    return anim.feet(l=l, r=r, yl=yl, yr=yr, pl=pl, pr=pr)


CONCEPT_POSE = {
    "front": {"chest": (0.0, -4.0, 0.0),
              "ik": dict(_feet(l=(0.09, -0.08, -0.01), r=(0.0, 0.08, 0.04), yl=-4.0, yr=-70.0),
                         **{"hand.R": anim.HandTarget(pos=(-0.315, -0.05, 0.955), pole=(-0.6, 0.6, -0.4)),
                            "hand.L": anim.HandTarget(pos=(0.250, -0.06, 0.930), pole=(1.0, 0.4, 0.0))})},
    "back": {"chest": (0.0, -4.0, 0.0),
             "ik": dict(_feet(l=(0.13, -0.08, 0.0), r=(-0.09, 0.08, 0.0), yl=-4.0, yr=-70.0),
                        **{"hand.R": anim.HandTarget(pos=(-0.300, -0.05, 0.955), pole=(-0.8, 0.5, -0.3)),
                           "hand.L": anim.HandTarget(pos=(0.260, -0.06, 0.940), pole=(1.0, 0.3, -0.2))})},
}
PAINTED = ("knife_blade_R", "knife_blade_L", "knife_grip_R", "knife_grip_L", "knife_guard_R", "knife_guard_L", "boots",
           "bracer_R", "bracer_L")
PROC_HIDDEN = {"face"}          # parts whose texels the painting hides take procedural paint, not the nearest pixel
FACE_COL = {"lit": "#E2E0DB", "mid": "#C8C7C3", "shade": "#9C9EA1", "cool": "#8B97A3", "ink": "#4A4644",
            "lip": "#EEECE7"}
HELM_COL = {"lit": "#E2DFDA", "mid": "#C9C5BF", "shade": "#9F9A94", "cool": "#97A0AA", "ink": "#5E5650",
            "keel": "#ECE9E4"}
# the warm carved plates of the helm's back and the nape (the painting's back of the head: warm taupe carved stone
# with dark seams and lit lips)
NAPE_COL = {"lit": "#C8BBAB", "mid": "#A99A8B", "shade": "#7C6F64", "ink": "#463B33", "lip": "#DACFC2"}
# the visor (fix pass 5): ice-blue glass (the fix pass 4 lavender washed out pale lavender in the three QA light),
# the mask seen through it; the pale cyan rim #C1E9F5 with a dark outline (the concept's)
VISOR_COL = {"top": "#7FA2C8", "core": "#5E86AE", "low": "#567C9E", "streak": "#D6E8F4", "sheen": "#AECBE2",
             "keel": "#C2DAEE", "rim": "#A8D4EA", "rim_hi": "#D2ECF7", "outline": "#3A4D66", "inner_line": "#557499",
             "inner": "#40597A", "ring": "#C6DEF0", "ring_in": "#5F7EA6", "tint": "#6E99C0"}
# the fins: smooth pale glass like the knives (fix pass 3: the lavender gradient and frayed edges read as feathers)
FIN_COL = {"root": "#93B1C6", "mid": "#B2CADA", "tip": "#C6D8E4", "spine": "#7896AE", "edge": "#DDE9F0"}
# the crest's stone frame (painted: the projection put the painting's sky and fins on the moved crest)
CREST_COL = {"lit": "#DCDAD4", "mid": "#BCBAB5", "shade": "#8E8D8A", "ink": "#56524D", "edge": "#ECEAE4"}
VISOR_ROUGH = 0.42        # added to the dawnglass roughness on the visor only (a broad sheen, not a chrome hot spot)
BOOT_COL = {"upper": "#5E6874", "toe": "#7A8490", "sole": "#232428", "cuff": "#5B4535", "cuff_lit": "#7A5D47",
            "seam": "#2E343B", "strap": "#5E4737"}
# the bible's light head / dark feet over the painting (rest height m -> multiplier, linear between)
VALUE_RAMP = ((0.0, 0.70), (0.25, 0.76), (0.55, 0.90), (0.95, 0.98), (1.30, 1.0), (1.60, 1.02), (1.95, 1.03))
# the bible: no large area lighter than L* 86 (the painting's helmet is near white): luminance above the knee is
# compressed (linear Y 0.52 -> L* 77; Y 0.85 -> ~0.64, L* 84)
VALUE_KNEE = (0.52, 0.32)
SOFTEN = 0.55             # px gaussian on the finished atlas (the painting is soft; keeps the WebP in budget)
GLASS_COL = {"core": "#8FB2CC", "mid": "#B4CEE0", "edge": "#DCE8F0", "spine": "#6F94B2"}
GRIP_COL = {"wrap": "#4A3A30", "dark": "#2C241F"}
SIDE_SOFT = 4.0


def _hexrgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], dtype=np.float32)


def head_matrix(side: str) -> np.ndarray:
    """4x4 rigid transform of the helmet from the rest pose to the painting's head in `side`"""
    turn, shift = HEAD_POSE[side]
    a = math.radians(turn)
    R = np.array([[math.cos(a), -math.sin(a), 0], [math.sin(a), math.cos(a), 0], [0, 0, 1.0]])
    pv = np.asarray(HEAD_PIVOT)
    M = np.eye(4)
    M[:3, :3] = R
    M[:3, 3] = pv - R @ pv + np.asarray(shift)
    return M


HEAD_PARTS = ("helm", "nape", "face", "visor", "visor_ridge", "crest", "crest_glass", "crest_ribs", "fins", "cage_slats",
              "cage_bead")


HEAD_CHALK = ("helm", "nape", "face", "crest", "crest_ribs")
HEAD_GLASS = ("visor", "fins")


def _rimlit(c):
    """the painting's warm-yellow rim light (and the backdrop inpaint it bled into): never a material colour here"""
    c = np.asarray(c)
    return ((c[..., 1] - c[..., 2]) > 0.065) & ((c[..., 0] - c[..., 2]) > 0.10) & (c[..., 1] > 0.45) & \
        ((c[..., 1] - c[..., 2]) > 0.12 * c[..., 1])


def _glassy(c):
    """the painting's dawnglass: cool, clearly bluer than it is red"""
    c = np.asarray(c)
    return ((c[..., 2] - c[..., 0]) > 0.085) & (c[..., 2] > 0.40)


def posed_copy(obj, pose: dict, name: str, side: str | None = None, names=None):
    """an evaluated copy of the skinned body in `pose` (world = local; the same loops and UVs); with `side`, the
    helmet parts (HEAD_PARTS) are placed rigidly from the rest pose by head_matrix(side)"""
    arm = obj.find_armature()
    anim.apply_pose(arm, pose)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    me.transform(obj.matrix_world)
    if side is not None and names is not None and obj.data.attributes.get("vale_part") is not None:
        pv = np.empty(len(obj.data.vertices), dtype=np.int64)
        obj.data.attributes["vale_part"].data.foreach_get("value", pv)
        ids = [i for i, n in enumerate(names) if n in HEAD_PARTS]
        sel = np.isin(pv, ids)
        rest = np.empty(len(obj.data.vertices) * 3, dtype=np.float64)
        obj.data.vertices.foreach_get("co", rest)
        rest = rest.reshape(-1, 3)
        cur = np.empty(len(me.vertices) * 3, dtype=np.float64)
        me.vertices.foreach_get("co", cur)
        cur = cur.reshape(-1, 3)
        M = head_matrix(side)
        cur[sel] = rest[sel] @ M[:3, :3].T + M[:3, 3]
        me.vertices.foreach_set("co", cur.ravel())
        me.update()
    ob = bpy.data.objects.new(name, me)
    anim.apply_pose(arm, {})
    if me.attributes.get("vale_part") is None and obj.data.attributes.get("vale_part") is not None:
        src = obj.data.attributes["vale_part"]
        vals = np.empty(len(src.data), dtype=np.int64)
        src.data.foreach_get("value", vals)
        a = me.attributes.new("vale_part", "INT", src.domain)
        a.data.foreach_set("value", vals)
    return ob


def knife_paint(p, n, s):
    """reverse-gripped dawnglass: a cool core along the fuller, the bevels lighter toward the edge, a darker spine;
    the rest pose blade runs back (+Y) from the guard, edge down"""
    J = layout()
    palm = J[f"palm.{s}"]
    y0 = palm[1] + 0.06
    u = np.clip((p[:, 1] - y0) / KNIFE["blade"], 0.0, 1.0)
    zc = palm[2] - 0.004 - 0.010 * np.sin(u * math.pi) * 0.9 + 0.045 * u * u
    h = (p[:, 2] - zc) / np.maximum(KNIFE["width"] * (0.75 + 0.5 * np.sin(u * math.pi * 0.85)), 0.01)
    flat = np.clip(np.abs(n[:, 0]), 0.0, 1.0)                     # 1 on the flats, lower on the bevels
    c_core, c_mid, c_edge, c_sp = (_hexrgb(GLASS_COL[k]) for k in ("core", "mid", "edge", "spine"))
    t_edge = np.clip(1.0 - flat * 1.15 + np.clip(-h - 0.4, 0, 1), 0, 1)[:, None]
    col = c_core[None] * (1 - np.abs(h)[:, None].clip(0, 1)) + c_mid[None] * np.abs(h)[:, None].clip(0, 1)
    col = col * (1 - t_edge) + c_edge[None] * t_edge
    sp = np.clip((h - 0.55) / 0.3, 0, 1)[:, None]
    col = col * (1 - sp * 0.6) + c_sp[None] * sp * 0.6
    col = col * (0.92 + 0.12 * u[:, None])                       # the tip catches more light
    return col


# the forearm guards (fix pass 2: the painting's guards and wraps projected as brown / blue stripes across the
# forearms): honed stone plates with two carved frames inset from the edge and a lit bevel; under them the forearm
# wrapped in leather bands (the sculpt's own wrap ridges) over the pale sleeve near the elbow
BRACER_COL = {"lit": "#8E99A0", "mid": "#737F88", "shade": "#535E67", "carve": "#3C464F", "bevel": "#A3ADB3",
              "outline": "#30383F",
              "wrap": "#6E5444", "wrap_lit": "#866853", "wrap_dark": "#33271F", "cloth": "#8E9EAB", "cloth_dk": "#6F7F8C"}
BRACER_GUARD = None        # (the guard's shell: bracer_guard)


def bracer_paint(p, n, s, zones=False):
    """the procedural forearm; zones=True returns (guard, leather) weights instead (the skins re-colour each zone by
    its own role: the stone guard, the leather straps, the cloth under them with the sleeves)"""
    J = layout()
    sx = 1.0 if s == "L" else -1.0
    el, d2 = J[f"elbow.{s}"], J[f"d2.{s}"]
    outv = unit(np.array([sx, 0.0, 0.0]) - d2 * (sx * d2[0]))
    C = {k: _hexrgb(h) for k, h in BRACER_COL.items()}
    a_, b_, ro, ri = bracer_guard(s, J)
    ax = sdf.frame(b_ - a_, (1.0, 0.0, 0.0))
    loc = (p - a_) @ ax.T
    Lg = float(np.linalg.norm(b_ - a_))
    tg = np.clip(loc[:, 2] / Lg, 0, 1)
    rw_i = ri[0] + (ri[2] - ri[0]) * tg
    rd_i = ri[1] + (ri[3] - ri[1]) * tg
    q = np.hypot(loc[:, 0] / rw_i, loc[:, 1] / rd_i)                  # 1 on the guard's inner face
    tip, chev, _, _ = bracer_tip(s, J)
    dch = np.minimum(-(p - tip) @ chev[0], -(p - tip) @ chev[1])          # inside the pointed elbow end
    on = (q > 0.93) & ((p - el) @ outv > 0.006) & (dch > -0.006) & (loc[:, 2] < Lg + 0.006)
    # the forearm: the pale blue-grey sleeve, two leather straps wound across it in an X (opposite helices), a
    # leather band at the wrist; each strap with a dark edge and a lit top
    t = (p - el) @ d2
    r_ = p - el - d2[None] * t[:, None]
    e2 = np.cross(d2, outv)
    th = np.arctan2(r_ @ e2, r_ @ outv)
    tl0 = np.clip(0.55 + 0.4 * n[:, 2], 0, 1)
    wrap = _mix(C["cloth_dk"][None].repeat(len(p), 0), C["cloth"][None], tl0)
    wrap = wrap * (1.0 + 0.04 * NOISE(p, 25.0))[:, None]
    L_ = float(np.linalg.norm(J[f"wrist.{s}"] - el))
    strap = np.zeros(len(p))
    for hand in (1.0, -1.0):
        u_ = (t + hand * 0.030 * th / math.pi) / 0.050
        f_ = np.abs((u_ % 1.0) - 0.5) * 0.050                  # distance (m) from the strap's centre line
        strap = np.maximum(strap, np.clip((0.0085 - f_) / 0.0025, 0, 1) * np.clip((t - 0.075) / 0.01, 0, 1))
    strap = np.maximum(strap, np.clip((0.018 - np.abs(t - (L_ - 0.022))) / 0.003, 0, 1))
    leather = _mix(C["wrap"][None].repeat(len(p), 0), C["wrap_lit"][None], np.clip(n[:, 2] * 0.8 + 0.3, 0, 1))
    leather = _mix(C["wrap_dark"][None].repeat(len(p), 0), leather, np.clip(strap * 1.6 - 0.3, 0, 1))
    wrap = _mix(wrap, leather, np.clip(strap * 2.5, 0, 1))
    if zones:
        return on.astype(np.float32), (np.clip(strap * 2.5, 0, 1) * ~on).astype(np.float32)
    # the stone guard: lit from above, two carved frames inset from its edges (the long edges are the cut at 1.2 cm
    # off the axis: arc distance from there; the ends: distance along the arm), the bevel
    tl = np.clip(0.55 + 0.35 * n[:, 2] + 0.15 * (n @ outv), 0, 1)
    stone = np.where((tl < 0.5)[:, None], _mix(C["shade"][None], C["mid"][None], tl * 2), _mix(C["mid"][None], C["lit"][None], tl * 2 - 1))
    e2g = np.cross(d2, outv)
    rr = p - el
    xo, yo = rr @ outv, rr @ e2g
    rho = np.maximum(np.hypot(xo, yo), 1e-4)
    phi_max = np.arccos(np.clip(0.010 / rho, -1, 1))
    de_side = (phi_max - np.abs(np.arctan2(yo, xo))) * rho
    de = np.minimum(de_side, np.minimum(dch, Lg - loc[:, 2]))
    # the painting's carving: two grooves following the edge (and the pointed flare), each with a lit lip under it
    for d_, w_ in ((0.012, 0.0030), (0.024, 0.0026)):
        stone = _mix(stone, C["carve"][None], np.clip(1 - np.abs(de - d_) / w_, 0, 1) * 0.85)
        stone = _mix(stone, C["bevel"][None], np.clip(1 - np.abs(de - d_ - w_ * 1.6) / (w_ * 0.6), 0, 1) * 0.35)
    stone = _mix(stone, C["bevel"][None], np.clip((0.0065 - de) / 0.002, 0, 1) * np.clip((de - 0.0025) / 0.0015, 0, 1) * 0.55)
    stone = _mix(stone, C["outline"][None], np.clip((0.0028 - de) / 0.0012, 0, 1) * 0.8)
    stone = stone * (1.0 + 0.04 * NOISE(p, 30.0))[:, None]
    return np.where(on[:, None], stone, wrap)


def boot_paint(p, n):
    """blue-grey boots (fix pass 4, review: unpainted clay): lit from above, a lighter toe cap behind a carved seam,
    a leather strap over the instep, the leather cuff lit on its roll, the dark sole"""
    C = {k: _hexrgb(h) for k, h in BOOT_COL.items()}
    J = layout()
    col = np.repeat(C["upper"][None], len(p), 0) * (0.86 + 0.20 * np.clip(n[:, 2], 0, 1) + 0.06 * np.clip(-n[:, 1], 0, 1))[:, None]
    for s in ("L", "R"):
        an, fw = J[f"ankle.{s}"], J[f"fwd.{s}"]
        on = (np.sign(p[:, 0]) == np.sign(an[0]))[:, None]
        along = (p - np.array([an[0], an[1], 0.0])) @ fw                  # metres forward of the ankle
        toe = np.clip((along - 0.105) / 0.012, 0, 1) * np.clip(n[:, 2] + 0.5, 0, 1)
        c = _mix(col, C["toe"][None] * (0.9 + 0.2 * np.clip(n[:, 2], 0, 1))[:, None], toe * 0.8)
        c = _mix(c, C["seam"][None], np.clip(1 - np.abs(along - 0.100) / 0.003, 0, 1) * 0.8 * (p[:, 2] > 0.02))
        strap = np.clip(1 - np.abs(along - 0.045) / 0.011, 0, 1) * (p[:, 2] > 0.025)
        c = _mix(c, C["strap"][None] * (0.85 + 0.3 * np.clip(n[:, 2], 0, 1))[:, None], strap * 0.9)
        col = np.where(on, c, col)
    so = np.clip((0.030 - p[:, 2]) / 0.010, 0, 1)
    col = _mix(col, C["sole"][None], so)
    cu = np.clip(1.0 - np.abs(p[:, 2] - 0.165) / 0.016, 0, 1)
    cuff = _mix(C["cuff"][None].repeat(len(p), 0), C["cuff_lit"][None], np.clip(n[:, 2] + 0.2, 0, 1))
    col = _mix(col, cuff, cu)
    return col * (1.0 + 0.03 * NOISE(p, 30.0))[:, None]


def _polyline_dist(p, pts):
    """distance from points (N, 3) to a 3D polyline"""
    P = np.asarray(pts, dtype=np.float64)
    d = np.full(len(p), 1e3)
    for a, b in zip(P[:-1], P[1:]):
        e = b - a
        t = np.clip(((p - a) @ e) / (e @ e + 1e-12), 0, 1)
        d = np.minimum(d, np.linalg.norm(p - (a + t[:, None] * e), axis=1))
    return d


def _mix(a, b, t):
    t = np.asarray(t, dtype=np.float32)[:, None]
    return a * (1 - t) + b * t


def _ss(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ── the painterly finish (FIX PASS 5, review: the procedural parts rendered as smooth untextured plastic next to the
# painted torso): every procedurally painted surface is painted the way the concept is: a warm key from above-front
# (his left), cool shadow colours (never a darker copy of the light ones), a chalky top light, directional brush
# strokes along the form and a broken, mottled value; the carved lines get an ink cut and a lit lip
KEY = unit((0.30, -0.42, 0.86))


def strokes(p, axis=None, f_across=95.0, f_along=22.0, seed=0.0):
    """directional brush strokes: noise stretched along `axis` (None: isotropic dabs), roughly -1..1"""
    p = np.asarray(p, dtype=np.float64)
    off = (seed * 13.1, seed * 7.3, seed * 3.7)
    if axis is None:
        return NOISE(p, f_across * 0.6, off) * 0.65 + NOISE(p, f_across * 1.7, off) * 0.35
    a = unit(axis)
    q = p * f_across - (p @ a)[:, None] * a[None] * (f_across - f_along)
    return NOISE(q, 1.0, off) * 0.65 + NOISE(q * 2.13, 1.0, off) * 0.35


def painted(base, n, p, k_light=0.55, axis=None, stroke=0.07, f_across=95.0, f_along=22.0, top=0.10, seed=0.0,
            warm=(1.035, 1.0, 0.955), cool=(0.93, 0.975, 1.07)):
    """a base colour (3,) or (N, 3) painted: wrapped key light with cool shadows and warm lights, a chalky top light,
    brush strokes"""
    b = np.broadcast_to(np.asarray(base, dtype=np.float32), (len(n), 3))
    lam = _ss(0.5 + 0.5 * (n @ KEY))
    shade = b * (1.0 - 0.55 * k_light) * np.asarray(cool, dtype=np.float32)[None]
    lit = b * (1.0 + 0.22 * k_light) * np.asarray(warm, dtype=np.float32)[None]
    col = shade + (lit - shade) * lam[:, None]
    col = col * (1.0 + top * _ss((n[:, 2] - 0.55) / 0.4))[:, None]
    s = strokes(p, axis, f_across, f_along, seed)
    col = col * (1.0 + stroke * s)[:, None]
    hue = NOISE(p, 14.0, (seed + 3.0, 1.0, 2.0))          # a slow warm / cool drift, like mixed paint
    col = col * (1.0 + 0.025 * hue[:, None] * np.array([1.0, 0.2, -1.0], dtype=np.float32)[None])
    return col.astype(np.float32)


def _ink_line(col, d, w, ink, lip=None, lip_d=None, depth=0.80, lip_k=0.40):
    """a carved line at distance d (m) from its centre: the ink cut, and a lit lip `lip_d` (signed) beside it"""
    col = _mix(col, ink, _ss((w + 0.0009 - d) / 0.0012) * depth)
    if lip is not None and lip_d is not None:
        col = _mix(col, lip, _ss((w * 0.9 - np.abs(lip_d)) / 0.0011) * lip_k)
    return col


def _polyline_dist2(u, v, pts):
    """distance from 2D points to a 2D polyline, and the signed offset across it (left of the direction +)"""
    P = np.asarray(pts, dtype=np.float64)
    d = np.full(len(u), 1e3)
    sgn = np.zeros(len(u))
    for a, b in zip(P[:-1], P[1:]):
        e = b - a
        L2 = e @ e + 1e-12
        t = np.clip(((u - a[0]) * e[0] + (v - a[1]) * e[1]) / L2, 0, 1)
        du, dv = u - (a[0] + t * e[0]), v - (a[1] + t * e[1])
        dd = np.hypot(du, dv)
        cr = (e[0] * dv - e[1] * du) / math.sqrt(L2)
        sel = dd < d
        d = np.where(sel, dd, d)
        sgn = np.where(sel, cr, sgn)
    return d, sgn


def face_paint(p, n):
    """the slim carved chalk mask (fix pass 5, review: a beige-peach knob): near-white stone lit from above, cool
    grey in its turns and under the brow and chin (no warm flesh tones), the concept's carved lines inked with a lit
    lip under each, painterly strokes"""
    C = {k: _hexrgb(h) for k, h in FACE_COL.items()}
    t = _ss(0.52 + 0.36 * n[:, 2] - 0.30 * np.abs(n[:, 0]) - 0.22 * _ss((1.548 - p[:, 2]) / 0.04))
    col = np.where((t < 0.5)[:, None], _mix(C["shade"][None].repeat(len(p), 0), C["mid"][None], t * 2),
                   _mix(C["mid"][None].repeat(len(p), 0), C["lit"][None], t * 2 - 1))
    col = _mix(col, C["cool"][None], _ss(-n[:, 2] - 0.15) * 0.45)
    col = col * (1.0 + 0.05 * strokes(p, (0, 0, 1), 120.0, 30.0, 1.0))[:, None]
    front = _ss((-n[:, 1] + 0.05) / 0.35)
    for pts, w in FACE_LINES:
        d, sg = _polyline_dist2(p[:, 0], p[:, 2], pts)
        cut = _ss((w + 0.0009 - d) / 0.0012) * front
        col = _mix(col, C["ink"][None], cut * 0.78)
        lip = _ss((w * 1.1 - np.abs(d - w * 2.2)) / 0.0011) * front * (sg < 0)
        col = _mix(col, C["lip"][None], lip * 0.35)
    return col


def _brow(p):
    """0..1 on the helm's brow band, and the distance (m, along z) to its lower / upper edges"""
    lo = BROW[0] + BROW[2] * p[:, 1]
    hi = BROW[1] + BROW[2] * p[:, 1]
    on = (p[:, 2] > lo) & (p[:, 2] < hi) & (p[:, 1] < 0.036)
    return on, p[:, 2] - lo, hi - p[:, 2]


def helm_paint(p, n):
    """the carved helm (fix pass 5, review: a featureless egg): the white chalk crown lit from above with painterly
    strokes; the brow band with lit top and inked edges; the temple ring bosses; the back of the skull below the crest
    in warm carved plates (the concept's back view) stepping down in arcs to the nape, each lit at its top lip and
    shaded to an inked seam; the keel lit along its ridge; chips"""
    C = {k: _hexrgb(h) for k, h in HELM_COL.items()}
    N_ = {k: _hexrgb(h) for k, h in NAPE_COL.items()}
    t = _ss(0.48 + 0.42 * n[:, 2] - 0.12 * n[:, 1] - 0.20 * _ss((1.66 - p[:, 2]) / 0.06))
    col = np.where((t < 0.5)[:, None], _mix(C["shade"][None].repeat(len(p), 0), C["mid"][None], t * 2),
                   _mix(C["mid"][None].repeat(len(p), 0), C["lit"][None], t * 2 - 1))
    col = _mix(col, C["cool"][None], _ss(-n[:, 2] - 0.10) * 0.45)
    col = col * (1.0 + 0.055 * strokes(p, (0, 1, 0.6), 110.0, 26.0, 2.0))[:, None]
    # the warm carved plates on the back of the skull, below the crest (stepped arcs curving up toward the temples)
    back = _ss((p[:, 1] - HELM_BACK_Y) / 0.035) * _ss((1.80 - p[:, 2]) / 0.03)
    ax = np.clip(np.abs(p[:, 0]) / 0.070, 0, 1)
    zc = p[:, 2] - 0.030 * ax * ax                      # the seams rise toward the temples
    arcs = np.asarray(HELM_BACK_ARCS)
    above = np.array([a for a in arcs])
    top_of = np.full(len(p), 1.85)
    bot_of = np.full(len(p), 1.55)
    for a in above:
        top_of = np.where((zc < a) & (a < top_of), a, top_of)
        bot_of = np.where((zc >= a) & (a > bot_of), a, bot_of)
    f = np.clip((top_of - zc) / np.maximum(top_of - bot_of, 1e-3), 0, 1)          # 0 at a plate's top, 1 at its foot
    tp = _ss(0.62 + 0.30 * n[:, 2] + 0.18 * n[:, 1] - 0.55 * f)
    warm = np.where((tp < 0.5)[:, None], _mix(N_["shade"][None].repeat(len(p), 0), N_["mid"][None], tp * 2),
                    _mix(N_["mid"][None].repeat(len(p), 0), N_["lit"][None], tp * 2 - 1))
    warm = warm * (1.0 + 0.06 * strokes(p, (1, 0, 0), 120.0, 30.0, 3.0))[:, None]
    for a in arcs:
        d = np.abs(zc - a)
        warm = _mix(warm, N_["ink"][None], _ss((0.0024 - d) / 0.0012) * 0.85)
        warm = _mix(warm, N_["lip"][None], _ss((0.0022 - np.abs(zc - a + 0.0042)) / 0.0012) * 0.45)
    col = _mix(col, warm, back)
    # the edge between the white crown and the warm plates: an inked carved line
    eb = np.abs(p[:, 1] - HELM_BACK_Y - 0.012) * (p[:, 2] < 1.79)
    col = _mix(col, C["ink"][None], _ss((0.0022 - eb) / 0.0012) * 0.6 * (p[:, 2] < 1.80))
    # the brow band: lit top lip, inked lower and upper edges, a carved line along it
    on, dl, dh = _brow(p)
    bandc = col * 1.04
    bandc = _mix(bandc, C["lit"][None] * 1.03, _ss((0.006 - dh) / 0.004) * 0.6)
    col = np.where(on[:, None], bandc, col)
    col = _mix(col, C["ink"][None], _ss((0.0024 - np.abs(dl)) / 0.0013) * 0.75 * (p[:, 1] < 0.04))
    col = _mix(col, C["ink"][None], _ss((0.0020 - np.abs(dh)) / 0.0012) * 0.55 * (p[:, 1] < 0.04))
    # the temple ring bosses: a lit stone ring round a darker disc, inked round
    for sx in (-1.0, 1.0):
        c_ = np.asarray(TEMPLE["c"]) + (sx * TEMPLE["x"], 0.0, 0.0)
        r = np.hypot(p[:, 1] - c_[1], p[:, 2] - c_[2])
        side = _ss((sx * n[:, 0] - 0.35) / 0.3) * (np.sign(p[:, 0]) == sx)
        col = _mix(col, C["shade"][None] * 0.92, _ss((TEMPLE["R"] - 0.006 - r) / 0.002) * side * 0.7)
        col = _mix(col, C["ink"][None], _ss((0.0018 - np.abs(r - TEMPLE["R"] + 0.0055)) / 0.001) * side * 0.7)
        col = _mix(col, C["lit"][None] * 1.04, _ss((0.0030 - np.abs(r - TEMPLE["R"])) / 0.0015) * side * 0.5)
        col = _mix(col, C["ink"][None], _ss((0.0016 - np.abs(r - TEMPLE["R"] - 0.0055)) / 0.001) * side * 0.6)
    # the back keel: a lit ridge with inked flanks
    kd = np.abs(p[:, 0])
    onk = _ss((p[:, 1] - 0.04) / 0.02)
    col = _mix(col, C["keel"][None], _ss((0.004 - kd) / 0.003) * onk * 0.45)
    col = _mix(col, N_["ink"][None], _ss(1 - np.abs(kd - 0.0118) / 0.0022) * onk * 0.55)
    ch = NOISE.ridged(p, 60.0, 2)
    col = col * (1.0 - 0.06 * _ss((ch - 0.80) / 0.12))[:, None]                  # small chips and pits
    return col


def nape_paint(p, n):
    """the nape plates: the warm carved stone of the helm's back, each lame lit at its top lip and shaded down to the
    inked seam under it, painterly strokes across"""
    C = {k: _hexrgb(h) for k, h in NAPE_COL.items()}
    col = np.zeros((len(p), 3), dtype=np.float32)
    best = np.full(len(p), 1e3)
    for z1, z0, _ in NAPE:
        z1y, z0y = nape_z(z1, p[:, 1]), nape_z(z0, p[:, 1])
        zc = (z0y + z1y) / 2
        f = np.clip((z1y - p[:, 2]) / (z1 - z0), 0, 1)                      # 0 at the lame's top, 1 at its bottom
        tl = _ss(0.58 + 0.30 * n[:, 2] + 0.15 * n[:, 1] - 0.50 * f)
        c = np.where((tl < 0.5)[:, None], _mix(C["shade"][None].repeat(len(p), 0), C["mid"][None], tl * 2),
                     _mix(C["mid"][None].repeat(len(p), 0), C["lit"][None], tl * 2 - 1))
        c = _mix(c, C["lip"][None], np.clip(1 - f / 0.16, 0, 1) * 0.45)
        c = _mix(c, C["ink"][None], np.clip((f - 0.86) / 0.14, 0, 1) * 0.6 + np.clip(-n[:, 2] - 0.4, 0, 1) * 0.4)
        dz = np.abs(p[:, 2] - zc)
        sel = dz < best
        col[sel] = c[sel]
        best = np.minimum(best, dz)
    return col * (1.0 + 0.06 * strokes(p, (1, 0, 0), 120.0, 30.0, 4.0))[:, None]


NECK_COL = {"lit": "#ABA39A", "mid": "#8E867E", "shade": "#686059", "ink": "#4A433D"}


def neck_paint(p, n):
    """the neck under the mask (fix pass 5, review: brown projection smudges under the visor): the concept's carved
    warm column, clean: vertical carved ribs round it, lit on the left-front, painterly"""
    C = {k: _hexrgb(h) for k, h in NECK_COL.items()}
    col = painted(C["mid"], n, p, 0.75, axis=(0, 0, 1), stroke=0.06, f_across=130.0, f_along=25.0, seed=5.0)
    ang = np.arctan2(p[:, 0], -(p[:, 1] - 0.006))
    rib = np.abs(((ang / (2 * math.pi / 14.0)) % 1.0) - 0.5) * 2                # 0 on a groove, 1 mid-rib
    col = _mix(col, C["ink"][None], _ss((0.14 - rib) / 0.10) * 0.45)
    col = _mix(col, C["lit"][None], _ss((rib - 0.55) / 0.3) * 0.25 * _ss(n @ KEY + 0.2))
    return col


def crest_paint(p, n):
    """the crest's carved chalk frame (fix pass 5): pale gull-grey stone lit from above, a lit bevel along the outer
    edge, a carved line down the middle of the broad outer band, the edges round the panes inked, painterly strokes
    along the arc"""
    C = {k: _hexrgb(h) for k, h in CREST_COL.items()}
    t = _ss(0.55 + 0.40 * n[:, 2] - 0.12 * np.abs(n[:, 0]))
    col = np.where((t < 0.5)[:, None], _mix(C["shade"][None].repeat(len(p), 0), C["mid"][None], t * 2),
                   _mix(C["mid"][None].repeat(len(p), 0), C["lit"][None], t * 2 - 1))
    col = col * (1.0 + 0.06 * strokes(p, (0, 1, 0.35), 110.0, 22.0, 6.0))[:, None]
    de = _poly_inside_dist(CREST_POLY, p[:, 1], p[:, 2])            # depth inside the outline (m)
    dp = -_poly_inside_dist(crest_pane_poly(), p[:, 1], p[:, 2])   # distance outside the panes' hole (m)
    side = _ss((np.abs(n[:, 0]) - 0.5) / 0.3)                      # the flat faces (not the rims)
    col = _mix(col, C["edge"][None], _ss((0.0045 - de) / 0.002) * _ss(n[:, 2] + 0.3) * 0.55)
    col = _mix(col, C["ink"][None], _ss((0.0026 - np.abs(dp - 0.0016)) / 0.0013) * side * 0.75)
    # the carved line along the broad outer band (the band's middle: 7.5 mm in from the outer edge)
    mid_band = (dp > 0.004) & (de < 0.013)
    col = _mix(col, C["ink"][None], _ss((0.0017 - np.abs(de - 0.0076)) / 0.0010) * side * mid_band * 0.55)
    col = _mix(col, C["edge"][None], _ss((0.0015 - np.abs(de - 0.0101)) / 0.0010) * side * mid_band * 0.30)
    ch = NOISE.ridged(p, 55.0, 2)
    col = col * (1.0 - 0.07 * _ss((ch - 0.80) / 0.12))[:, None]
    return col


CRESTGLASS_COL = {"deep": "#6E93B2", "mid": "#98BCD4", "pale": "#C3DAE8", "streak": "#E1EDF4", "edge": "#D5E6F0"}


def crest_glass_paint(p, n):
    """the crest's panes: pale ice dawnglass, deeper toward the dome, each pane crossed by a diagonal light streak,
    pale where it meets the stone"""
    C = {k: _hexrgb(h) for k, h in CRESTGLASS_COL.items()}
    de = _poly_inside_dist(crest_pane_poly(), p[:, 1], p[:, 2])
    dout = _poly_inside_dist(CREST_POLY, p[:, 1], p[:, 2])
    u = np.clip(dout / 0.050, 0, 1)                               # 0 at the outer band, 1 toward the dome
    col = _mix(C["mid"][None].repeat(len(p), 0), C["deep"][None], _ss(u * 1.2 - 0.1))
    col = _mix(col, C["pale"][None], _ss((0.5 - u) / 0.5) * 0.35)
    s = ((p[:, 1] * 0.8 + p[:, 2] * 0.6) / 0.085) % 1.0
    col = _mix(col, C["streak"][None], _ss((0.10 - np.abs(s - 0.35)) / 0.06) * 0.50)
    col = _mix(col, C["pale"][None], _ss((0.05 - np.abs(s - 0.50)) / 0.03) * 0.30)
    col = _mix(col, C["edge"][None], _ss((0.004 - de) / 0.003) * 0.6)
    return col * (1.0 + 0.03 * NOISE(p, 70.0))[:, None]


def _visor_edge(p):
    """distance (m) inside the visor's cut outline (the side sickle and the front band / beak)"""
    dprof = _poly_inside_dist(smooth_poly(VISOR_PROF, n=4, closed=True), p[:, 1], p[:, 2])
    dfront = _poly_inside_dist(VISOR_FRONT, p[:, 0], p[:, 2])
    return np.minimum(dprof, dfront)


def visor_paint(p, n):
    """the dawnglass visor, painted SEE-THROUGH (fix pass 5, review: an opaque lavender-blue plate; the concept's
    slim white mask shows through the glass): the mask (face_paint) and the helm behind the glass under an ice-blue
    cast, deeper across the eye band, a broad sheen and a thin bright streak on the outer face, a light line down the
    keel; the thick pale rim along every cut edge with a dark outline outside and a fine line inside; a ring at each
    temple on the side faces; the inside faces deeper"""
    C = {k: _hexrgb(h) for k, h in VISOR_COL.items()}
    yo = lens_y(p[:, 0], p[:, 2])
    dd = p[:, 1] - np.nan_to_num(yo, nan=-1.0)                     # 0 on the outer face, ~thick on the inner
    outer = np.where(np.isnan(yo), 0.0, np.clip((0.0075 - dd) / 0.004, 0, 1))
    # what is behind the glass: the mask (seen straight through, 4.5 cm in) below the brow, the helm above it
    pf = p + np.array([0.0, 0.045, 0.0])
    nf = np.repeat(np.array([[0.0, -0.94, 0.33]]), len(p), 0)
    nf[:, 0] = np.clip(p[:, 0] / 0.06, -1, 1) * 0.5
    nf = nf / np.linalg.norm(nf, axis=1, keepdims=True)
    behind = face_paint(pf, nf)
    behind = _mix(behind, helm_paint(pf, nf), _ss((p[:, 2] - 1.690) / 0.02))
    side_w = _ss((np.abs(p[:, 0]) - 0.050) / 0.025)                # the side band: the dark gap to the skull behind
    behind = _mix(behind, C["inner"][None] * 0.9, side_w * 0.75)
    eye = _ss((p[:, 2] - 1.612) / 0.012) * _ss((1.700 - p[:, 2]) / 0.012)   # the deep band across the eyes
    k = 0.56 + 0.24 * eye + 0.14 * side_w            # (the first try's 0.40 washed out pale grey in the QA light)
    col = behind * (1 - k[:, None]) + C["tint"][None] * k[:, None]
    col = _mix(col, C["core"][None], eye * 0.30)
    band = 0.40 * p[:, 0] + (p[:, 2] - 1.668)
    col = _mix(col, C["sheen"][None], np.clip(1 - np.abs(band) / 0.022, 0, 1) ** 1.5 * np.clip(-n[:, 1] + 0.2, 0, 1) * 0.45)
    streak = np.clip(1 - np.abs(0.52 * p[:, 0] + (p[:, 2] - 1.690)) / 0.0040, 0, 1) * np.clip(-n[:, 1], 0, 1)
    col = _mix(col, C["streak"][None], streak * 0.65)
    streak2 = np.clip(1 - np.abs(0.52 * p[:, 0] + (p[:, 2] - 1.562)) / 0.0030, 0, 1) * np.clip(-n[:, 1], 0, 1)
    col = _mix(col, C["streak"][None], streak2 * 0.45)
    keel = np.clip(1 - np.abs(p[:, 0]) / 0.0040, 0, 1) * np.clip((1.69 - p[:, 2]) / 0.03, 0, 1)
    col = _mix(col, C["keel"][None], keel * 0.55)
    side = np.clip((np.abs(n[:, 0]) - 0.55) / 0.25, 0, 1) * outer
    dr = np.hypot(p[:, 1] - 0.000, p[:, 2] - 1.716)
    col = _mix(col, C["ring_in"][None], np.clip((0.0120 - dr) / 0.003, 0, 1) * side * 0.35)
    col = _mix(col, C["ring"][None], np.clip(1 - np.abs(dr - 0.0150) / 0.0026, 0, 1) * side * 0.9)
    col = _mix(col, C["outline"][None], np.clip(1 - np.abs(dr - 0.0182) / 0.0012, 0, 1) * side * 0.6)
    col = _mix(col, C["inner"][None], (1 - outer) * 0.85)
    de = _visor_edge(p)
    col = _mix(col, C["inner_line"][None], np.clip(1 - np.abs(de - 0.0092) / 0.0014, 0, 1) * 0.55)
    rim = np.clip((0.0080 - de) / 0.0014, 0, 1)
    rim_c = _mix(C["rim"][None].repeat(len(p), 0), C["rim_hi"][None], np.clip((n[:, 2] + 0.1) / 0.6, 0, 1) * 0.8)
    col = _mix(col, rim_c, rim * 0.95)
    col = _mix(col, C["outline"][None], np.clip((0.0026 - de) / 0.0012, 0, 1) * 0.85)
    return col


def fin_paint(p, n):
    """the glass fins (painted like the knives' glass): a cool root lightening to the tip, a darker spine line, the
    bevels and the cut edges pale"""
    C = {k: _hexrgb(h) for k, h in FIN_COL.items()}
    col = np.zeros((len(p), 3), dtype=np.float32)
    best = np.full(len(p), 1e3)
    for a, m, b, nrm, width, thick in fin_blades():
        ax = b - a
        L = np.linalg.norm(ax)
        t = np.clip(((p - a) @ ax) / (L * L), 0, 1)
        cl = (1 - t)[:, None] ** 2 * a + (2 * t * (1 - t))[:, None] * m + (t * t)[:, None] * b
        d = np.linalg.norm(p - cl, axis=1)
        tg = unit(ax)
        sd = unit(np.cross(nrm, tg))
        w = np.array([width(s_) for s_ in t])
        across = np.abs((p - cl) @ sd) / np.maximum(w, 1e-4)             # 0 on the spine, 1 at the edge
        c = np.where((t < 0.5)[:, None], _mix(C["root"][None].repeat(len(p), 0), C["mid"][None], t * 2),
                     _mix(C["mid"][None].repeat(len(p), 0), C["tip"][None], t * 2 - 1))
        c = _mix(c, C["spine"][None], np.clip(1 - across / 0.14, 0, 1) * 0.55)
        c = _mix(c, C["edge"][None], np.clip((across - 0.72) / 0.22, 0, 1) * 0.75)
        c = c * (0.94 + 0.10 * np.clip(n @ np.asarray(nrm), 0, 1))[:, None]
        sel = d < best
        col[sel] = c[sel]
        best = np.minimum(best, d)
    return col


# the left pauldron (fix pass 3, review: the lames' back a flat grey cut-out, the projection's ghost of the shoulder
# cap inside the lames): painted stone, each blade lit on its upper face, a carved groove along it, a lit bevel and a
# dark outline at the edge; the cap lit from above with a rolled rim
# (fix pass 5, review: flat plastic planes with none of the concept's carved feather layering): each blade painted
# like the concept's carved feather: a groove along its spine, barbs cut diagonally toward the tip on its outer half,
# the lit bevel and the dark outline, painterly strokes along it, chips; the caps get carved rings
STONE_COL = {"lit": "#C3CACE", "mid": "#A0ABB2", "shade": "#6C7882", "groove": "#46515B", "edge": "#D5DCDF",
             "outline": "#38414A"}
KNEE_COL = {"lit": "#6E7882", "mid": "#505962", "shade": "#343B42", "carve": "#22272D", "edge": "#86909A"}


def _stone(n, C, k_up=0.42):
    t = np.clip(0.52 + k_up * n[:, 2] - 0.10 * n[:, 1], 0, 1)
    return np.where((t < 0.5)[:, None], _mix(C["shade"][None].repeat(len(n), 0), C["mid"][None], t * 2),
                    _mix(C["mid"][None].repeat(len(n), 0), C["lit"][None], t * 2 - 1))


def _chips(col, p, freq=55.0, k=0.08, light=None):
    ch = NOISE.ridged(p, freq, 2)
    col = col * (1.0 - k * _ss((ch - 0.80) / 0.12))[:, None]
    if light is not None:
        col = _mix(col, light, _ss((NOISE(p, freq * 1.6, (4.0, 2.0, 9.0)) - 0.55) / 0.15) * 0.25)
    return col


def lames_paint(p, n):
    C = {k: _hexrgb(h) for k, h in STONE_COL.items()}
    col = _stone(n, C)
    col = col * (0.92 + 0.12 * _ss(0.5 + 0.5 * (n @ KEY)))[:, None]
    best = np.full(len(p), 1e3)
    groove = np.zeros(len(p), dtype=np.float32)
    bev = np.zeros(len(p), dtype=np.float32)
    outl = np.zeros(len(p), dtype=np.float32)
    lip = np.zeros(len(p), dtype=np.float32)
    along = np.zeros((len(p), 3), dtype=np.float64)
    for a, m, b, side, width, thick in lame_blades():
        ax = b - a
        L = np.linalg.norm(ax)
        t = np.clip(((p - a) @ ax) / (L * L), 0, 1)
        cl = (1 - t)[:, None] ** 2 * a + (2 * t * (1 - t))[:, None] * m + (t * t)[:, None] * b
        d = np.linalg.norm(p - cl, axis=1)
        sd = unit(side - unit(ax) * side.dot(unit(ax)))
        w = np.maximum(width(t), 1e-3)
        u = ((p - cl) @ sd) / w                                    # -1 .. 1 across the blade
        g = _ss(1 - np.abs(u - 0.10) / 0.09) * _ss((0.88 - t) / 0.08)                          # the spine groove
        lp = _ss(1 - np.abs(u - 0.24) / 0.07) * _ss((0.88 - t) / 0.08)                         # its lit lip
        # the barbs: short cuts from the spine out to the outer edge, slanting toward the tip, every ~3.5 cm
        s_ = (t * L - np.abs(u) * w * 0.9) / 0.035
        barb = _ss(1 - np.abs((s_ % 1.0) - 0.5) / 0.09) * _ss((u - 0.32) / 0.1) * _ss((0.82 - u) / 0.1) * _ss((0.9 - t) / 0.1)
        e = _ss((np.abs(u) - 0.78) / 0.14)
        o = _ss((np.abs(u) - 0.94) / 0.05) * _ss((1.10 - np.abs(u)) / 0.05)     # (past it: the spike's teeth)
        sel = d < best
        best = np.minimum(best, d)
        groove[sel] = np.maximum(g, barb * 0.85)[sel]
        lip[sel] = lp[sel]
        bev[sel] = e[sel]
        outl[sel] = o[sel]
        along[sel] = unit(ax)
    col = col * (1.0 + 0.07 * strokes(p, None, 140.0))[:, None]
    col = _mix(col, C["groove"][None], groove * 0.85)
    col = _mix(col, C["edge"][None], lip * 0.35)
    col = _mix(col, C["edge"][None], bev * 0.50)
    col = _mix(col, C["outline"][None], outl * 0.75)
    return _chips(col, p, 50.0, 0.10)


def _cap_rings(col, p, n, c, axis, rings, C):
    """carved concentric rings on a shoulder cap: distance from its crown along the surface ~ angle from `axis`"""
    v = p - np.asarray(c)
    r = np.linalg.norm(v, axis=1) + 1e-6
    ang = np.arccos(np.clip((v @ unit(axis)) / r, -1, 1))
    for a0, w in rings:
        col = _mix(col, C["groove"][None], _ss((w - np.abs(ang - a0)) / (w * 0.6)) * 0.50)
        col = _mix(col, C["edge"][None], _ss((w * 0.9 - np.abs(ang - a0 - w * 2.0)) / (w * 0.5)) * 0.45)
    return col


def pauldron_paint(p, n):
    """the left cap: honed stone lit from above, two carved rings round its crown, chips"""
    C = {k: _hexrgb(h) for k, h in STONE_COL.items()}
    J = layout()
    sh = J["shoulder.L"]
    col = painted(_hexrgb(STONE_COL["mid"]) * 1.06, n, p, 0.75, None, 0.07, 120.0, seed=7.0)
    col = _cap_rings(col, p, n, sh + (0.004, 0.0, -0.010), (0.45, 0.0, 0.89), ((0.55, 0.05), (0.95, 0.045)), C)
    return _chips(col, p, 45.0, 0.10)


def pauldron_r_paint(p, n):
    """the small round right cap (fix pass 5: was the projection's smear): honed stone, a carved ring inside the
    rolled rim, chips"""
    C = {k: _hexrgb(h) for k, h in STONE_COL.items()}
    J = layout()
    sh = J["shoulder.R"]
    col = painted(_hexrgb("#ACADAB"), n, p, 0.75, None, 0.07, 120.0, seed=8.0)
    col = _cap_rings(col, p, n, sh + (0.008, 0.0, -0.020), (-0.50, 0.0, 0.86), ((0.62, 0.05),), C)
    return _chips(col, p, 45.0, 0.10)


def _iron(n, C, k_up=0.45, k_front=0.25):
    t = np.clip(0.50 + k_up * n[:, 2] - k_front * n[:, 1], 0, 1)
    return np.where((t < 0.5)[:, None], _mix(C["shade"][None].repeat(len(n), 0), C["mid"][None], t * 2),
                    _mix(C["mid"][None].repeat(len(n), 0), C["lit"][None], t * 2 - 1))


def _groove(col, d, w, C, depth=0.85, lip=0.4):
    """a carved line at distance 0 of d (m): the ink cut and a lit lip just past it"""
    col = _mix(col, C["carve"][None], np.clip(1 - np.abs(d) / w, 0, 1) * depth)
    return _mix(col, C["edge"][None], np.clip(1 - np.abs(d - w * 1.8) / (w * 0.7), 0, 1) * lip)


def knee_paint(p, n):
    """the ironstone knee plates (fix pass 4, review: plain slabs): dark slate lit on top, two carved chevrons down
    the front face with lit lips, a lit bevel round the plate, a dark outline at its edge"""
    C = {k: _hexrgb(h) for k, h in KNEE_COL.items()}
    J = layout()
    col = _iron(n, C)
    col = col * (1.0 + 0.08 * strokes(p, (0, 0, 1), 120.0, 30.0, 9.0))[:, None]
    front = np.clip((-n[:, 1] - 0.45) / 0.3, 0, 1)
    for s in ("L", "R"):
        kc = J[f"knee.{s}"] + np.array([0.0, -0.066, -0.010])
        on = (np.sign(p[:, 0]) == np.sign(kc[0])) if abs(kc[0]) > 1e-3 else np.ones(len(p), dtype=bool)
        u, v = np.abs(p[:, 0] - kc[0]), p[:, 2] - kc[2]
        for c0 in (-0.028, 0.006):
            d = (v - (0.62 * u + c0)) / math.sqrt(1 + 0.62 ** 2)
            g = _groove(col, d, 0.0024, C)
            col = np.where((on & (front > 0))[:, None], _mix(col, g, front), col)
    bev = np.clip((np.abs(n[:, 0]) - 0.45) / 0.3, 0, 1) + np.clip((n[:, 2] - 0.55) / 0.3, 0, 1)
    col = _mix(col, C["edge"][None], np.clip(bev, 0, 1) * 0.45)
    col = _mix(col, C["carve"][None], np.clip((n[:, 1] - 0.15) / 0.3, 0, 1) * 0.6)
    return _chips(col, p, 50.0, 0.10, C["edge"][None])


GREAVE_COL = {"lit": "#7A848E", "mid": "#58616B", "shade": "#363D45", "carve": "#20252B", "edge": "#98A2AB"}
WRAP_COL = {"base": "#5A4536", "lit": "#735945", "dark": "#2E231C"}


def greave_paint(p, n):
    """the ironstone shin plates (fix pass 5, review: smooth plastic): dark slate painted with the key light and
    strokes down the shin, the keel's ridge lit, two carved grooves either side of it with lit lips, carved bands
    under the knee and over the ankle, worn pale chips on the edges, the cut edges dark"""
    C = {k: _hexrgb(h) for k, h in GREAVE_COL.items()}
    J = layout()
    col = _iron(n, C, 0.40, 0.35)
    col = col * (0.92 + 0.14 * _ss(0.5 + 0.5 * (n @ KEY)))[:, None]
    col = col * (1.0 + 0.09 * strokes(p, (0, 0, 1), 130.0, 24.0, 10.0))[:, None]
    for s in ("L", "R"):
        kn, an = J[f"knee.{s}"], J[f"ankle.{s}"]
        sd = unit(an - kn)
        g0, g1 = kn + sd * 0.08, an + np.array([0, 0, 0.035])
        on = np.sign(p[:, 0]) == np.sign(kn[0])
        L = float(np.linalg.norm(g1 - g0))
        t = (p - g0) @ unit(g1 - g0)
        ax = g0[None] + np.clip(t, 0, L)[:, None] * unit(g1 - g0)[None]
        u = np.abs(p[:, 0] - ax[:, 0])                         # across the shin
        front = np.clip((-n[:, 1] - 0.2) / 0.3, 0, 1)
        c = _mix(col, C["edge"][None], np.clip(1 - u / 0.006, 0, 1) * front * 0.6)       # the keel's lit ridge
        for d0 in (0.020, 0.036):
            c = _mix(c, _groove(c, u - d0, 0.0022, C), front)
        for tt in (0.018, 0.032, L - 0.016):                                              # the carved bands
            c = _groove(c, t - tt, 0.0024, C)
        c = _mix(c, C["carve"][None], np.clip((n[:, 1] - 0.10) / 0.3, 0, 1) * 0.55)     # cut edges / insides
        col = np.where(on[:, None], c, col)
    return _chips(col, p, 48.0, 0.12, C["edge"][None])


def wrap_paint(p, n):
    """the leather calf straps (fix pass 5, review: orange staples): dark worn leather lit on the upper edge, dark
    under, scuffed"""
    C = {k: _hexrgb(h) for k, h in WRAP_COL.items()}
    t = np.clip(0.55 + 0.45 * n[:, 2] - 0.15 * n[:, 1], 0, 1)
    col = np.where((t < 0.5)[:, None], _mix(C["dark"][None].repeat(len(p), 0), C["base"][None], t * 2),
                   _mix(C["base"][None].repeat(len(p), 0), C["lit"][None], t * 2 - 1))
    return col * (1.0 + 0.10 * strokes(p, (1, 0, 0), 150.0, 40.0, 11.0))[:, None]


# ── the cloth (FIX PASS 5, review: the thighs blotchy light and dark, the coat's back carrying the projected ghost of
# the painting's back-view hand and knife, a brown strap smear at its hem, hairline streaks under the belt, the side
# skirts translucent with the thigh's outline ghosted through them): the trousers, the coat skirt, the hood and the
# sleeves are painted, not projected, in the concept's material colours: painterly key light with cool shadows,
# strokes along the drape, fold shadows, the coat's hem trim and its darker lining
TROUSER_COL = {"base": "#5A6A78", "fold": "#3B4652", "lit": "#71818E"}
COAT_COL = {"front": "#97A6AD", "back": "#8A959D", "lining": "#69747D", "trim": "#5F6B74", "trim_lit": "#B3BFC4",
            "ink": "#3A434B"}
COWL_COL = {"front": "#8DA6B8", "back": "#9AADBB", "fold": "#5E7486", "lit": "#AFC4D2"}
SLEEVE_COL = {"base": "#8E9FAC", "fold": "#64747F"}


def _folds(p, axis, f_across, f_along, seed):
    """long soft fold shadows along `axis`: 0 in a valley .. 1 on a ridge"""
    s = strokes(p, axis, f_across, f_along, seed)
    return _ss(0.5 + 0.9 * s)


def trouser_paint(p, n):
    C = {k: _hexrgb(h) for k, h in TROUSER_COL.items()}
    col = painted(C["base"], n, p, 0.60, (0, 0, 1), 0.06, 110.0, 20.0, seed=12.0)
    # fold streaks (long and narrow down the leg, never blotches: the first try's 3 cm patches read as camouflage)
    f = _folds(p, (0.10, 0, 1), 70.0, 5.0, 13.0)
    col = _mix(col, C["fold"][None], (1 - f) * 0.13)
    col = _mix(col, C["lit"][None], _ss((f - 0.75) / 0.2) * _ss(n @ KEY) * 0.18)
    # the gathered cloth over the boot tops and under the knee: crumpled horizontal creases
    cr = _ss((0.30 - p[:, 2]) / 0.08) * (1 - _folds(p, (1, 0, 0), 160.0, 30.0, 14.0))
    col = _mix(col, C["fold"][None], cr * 0.35)
    return col


def coat_paint(p, n):
    """the coat skirt: the pale linen front panels and the mid-grey back, the darker lining inside, a trim along the
    hem with an inked edge, fold shadows down the drape"""
    C = {k: _hexrgb(h) for k, h in COAT_COL.items()}
    fb = _ss((p[:, 1] - 0.025) / 0.06)                                # 0 front .. 1 back (behind the side slits)
    base = _mix(C["front"][None].repeat(len(p), 0), C["back"][None], fb)
    col = painted(base, n, p, 0.50, (0, 0, 1), 0.07, 100.0, 18.0, seed=15.0)
    f = _folds(p, (0, 0, 1), 34.0, 6.0, 16.0)
    col = col * (0.84 + 0.22 * f)[:, None]
    # the lining: the faces turned in toward the legs
    rad = np.stack([p[:, 0], p[:, 1] - 0.02, np.zeros(len(p))], 1)
    rad = rad / np.maximum(np.linalg.norm(rad, axis=1, keepdims=True), 1e-6)
    inner = _ss((-np.sum(n * rad, axis=1) - 0.15) / 0.3)
    lin = painted(C["lining"], n, p, 0.5, (0, 0, 1), 0.06, 100.0, 18.0, seed=17.0)
    col = _mix(col, lin, inner)
    # the hem trim: a band 2.4 cm deep above the hem, lit on its upper edge, inked above
    hz = p[:, 2] - 0.600
    trim = _ss((0.024 - hz) / 0.004) * (1 - inner)
    tc = painted(C["trim"], n, p, 0.6, (1, 0, 0), 0.05, 120.0, 30.0, seed=18.0)
    col = _mix(col, tc, trim * 0.85)
    col = _mix(col, C["ink"][None], _ss((0.0022 - np.abs(hz - 0.026)) / 0.0012) * (1 - inner) * 0.6)
    col = _mix(col, C["trim_lit"][None], _ss((0.0018 - np.abs(hz - 0.0305)) / 0.0010) * (1 - inner) * 0.35)
    return col


def cowl_paint(p, n):
    """the hood and scarf (fix pass 5, review: a lumpy white bib): the concept's light blue linen, deep fold shadows
    following the drape, the lit crests of the folds"""
    C = {k: _hexrgb(h) for k, h in COWL_COL.items()}
    fb = _ss((p[:, 1] + 0.01) / 0.06)
    base = _mix(C["front"][None].repeat(len(p), 0), C["back"][None], fb)
    col = painted(base, n, p, 0.85, (0.8, 0, 0.6), 0.06, 110.0, 25.0, seed=19.0)
    f = _folds(p, (0.8, 0.0, 0.6), 46.0, 9.0, 20.0)
    col = _mix(col, C["fold"][None], (1 - f) * 0.40)
    col = _mix(col, C["lit"][None], _ss((f - 0.7) / 0.25) * _ss(n @ KEY) * 0.30)
    return col


def sleeve_paint(p, n):
    """the sleeves: the pale blue-grey linen, folds round the arm, painterly"""
    C = {k: _hexrgb(h) for k, h in SLEEVE_COL.items()}
    col = painted(C["base"], n, p, 0.55, (0.25, 0, -1), 0.07, 110.0, 25.0, seed=21.0)
    f = _folds(p, (1, 0, 0.3), 60.0, 14.0, 22.0)
    return _mix(col, C["fold"][None], (1 - f) * 0.30)


def neck_part_paint(p, n):
    return neck_paint(p, n)


PROC_BODY = {"lames_L": lames_paint, "pauldron_L": pauldron_paint, "pauldron_R": pauldron_r_paint,
             "knee_L": knee_paint, "knee_R": knee_paint, "greave_L": greave_paint, "greave_R": greave_paint,
             "calfwrap_L": wrap_paint, "calfwrap_R": wrap_paint, "trousers": trouser_paint, "skirt_L": coat_paint,
             "skirt_R": coat_paint, "cowl": cowl_paint, "sleeves": sleeve_paint, "neck": neck_part_paint}


PROC_HEAD = {"helm": helm_paint, "nape": nape_paint, "face": face_paint, "visor": visor_paint, "fins": fin_paint,
             "crest": crest_paint, "crest_glass": crest_glass_paint}
# the projection's mud (review: camouflage blotches on the trousers, brown smears and a dark patch on the coat's back):
# part -> (side, luminance squeeze, hue pull): the painted value variation is squeezed toward the part's median (in
# log luminance) and the hue pulled onto the median's, so folds and edges stay but the blotches go
# (fix pass 2: an optional 4th entry is the painting's own colour for the part, the median moved onto it: the
# trousers had gone neutral grey #3B3B3D against the painting's slate-teal #3A4348 / #687D86, the sleeves carried
# brown wrap smears over the pale blue-grey linen)
# (fix pass 3, review: camouflage patches on the trousers and the knee plates, a smudgy coat back, the arms one pale
# tube: the trousers and the coat's back squeezed harder, the greaves onto the painting's slate, the sleeves a step
# darker so the arm reads in the mid band)
# (fix pass 4, review: the body read as a dark navy figure with a pale head: on screen the middle band was L* 26-39
# against the bible's 45-65, the back coat and tabard near black; the painting's own values are low because they carry
# its shading): every large cloth piece is moved onto the concept's MATERIAL colour, side by side (the light blue-grey
# tunic and hood, the pale coat front and apron, the mid-grey coat back, the pale carved chest, slate-teal trousers),
# its painted variation kept (squeezed) and the brown leather straps across it protected (keep_brown)
# (part, side, luminance squeeze, hue pull, target, keep_brown); side None = all, "front" / "back" = that side's texels
HARMONIZE = [("torso", None, 0.55, 0.70, "#7D8E9B", True),
             ("apron", "front", 0.40, 0.35, "#9DADB1", True), ("apron", "back", 0.60, 0.60, "#7E8A90", True),
             ("chest_plate", None, 0.40, 0.30, "#A9A59E", True),
             ("belt", None, 0.50, 0.70, "#5E4838", False),
             ("hand_R", None, 0.50, 0.60, "#59636C", True), ("hand_L", None, 0.50, 0.60, "#59636C", True)]
# (fix pass 5: the trousers, the coat skirt, the hood, the sleeves, the neck and the right cap are painted, PROC_BODY)
# the projection's grazing-angle streaks (fix pass 4, review: the top faces of the cowl and the shoulders, right under
# the visor, carried brown / white / blue texels stretched into streaks): where a surface turns up away from the
# front / back projection (|n.y| small, n.z up) the texel takes its part's well-projected median colour, lit by the
# normal, instead of the stretched plate pixel
TOP_FIX = ("torso", "chest_plate", "apron", "belt", "hand_R", "hand_L")


def _brownish(c):
    """the painting's leather straps (warm, saturated, dark-mid): 0..1"""
    c = np.asarray(c)
    mx, mn = c.max(-1), c.min(-1)
    sat = (mx - mn) / np.maximum(mx, 1e-4)
    return np.clip((c[..., 0] - c[..., 2] - 0.035) / 0.05, 0, 1) * np.clip((sat - 0.12) / 0.10, 0, 1) * \
        np.clip((0.62 - mx) / 0.1, 0, 1)


def top_fix(col, n, p, wb):
    """the grazing-angle fill for one part's texels (see TOP_FIX)"""
    wt = np.clip((0.52 - np.abs(n[:, 1])) / 0.30, 0, 1) * np.clip((n[:, 2] - 0.20) / 0.25, 0, 1)
    wt = wt * wt * (3 - 2 * wt)
    if not (wt > 0.05).any():
        return col
    good = np.abs(n[:, 1]) > 0.55
    fill = np.zeros_like(col)
    for side_w in (wb < 0.5, wb >= 0.5):
        ref = good & side_w
        if ref.sum() < 20:
            ref = good if good.sum() >= 20 else np.ones(len(col), dtype=bool)
        m = np.median(col[ref], 0)
        fill[side_w] = m[None]
    fill = fill * (0.90 + 0.14 * np.clip(n[:, 2], 0, 1))[:, None] * (1.0 + 0.035 * NOISE(p, 22.0))[:, None]
    return _mix(col, fill, wt * 0.9).astype(np.float32)


def harmonize(col, w, s_lum, s_hue, p, target=None):
    lin = _lin(col)
    wsum = np.maximum(w.sum(), 1e-6)
    m = np.array([np.median(lin[w > 0.5, i]) if (w > 0.5).any() else (lin[:, i] * w).sum() / wsum for i in range(3)])
    lw = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    Y = np.maximum(lin @ lw, 1e-5)
    Ym = max(float(m @ lw), 1e-5)
    t = _lin(_hexrgb(target)) if target else m
    Yt = max(float(t @ lw), 1e-5)
    Y2 = Yt * (Y / Ym) ** (1.0 - s_lum) * (1.0 + 0.04 * NOISE(p, 9.0))
    chrom = lin / Y[:, None]
    chrom = chrom * (1 - s_hue) + (t / Yt)[None] * s_hue
    out = _srgb(chrom * Y2[:, None])
    w = np.clip(w, 0, 1)[:, None]
    return (col * (1 - w) + out * w).astype(np.float32)


def _value_grade(col, z):
    """the bible's light head / dark feet ramp and the luminance knee (rishal_paint's last step)"""
    zr = np.array([v for v, _ in VALUE_RAMP])
    mr = np.array([m for _, m in VALUE_RAMP])
    col = np.clip(col * np.interp(z, zr, mr)[:, None], 0.0, 1.0)
    lin = _lin(col)
    Y = lin @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    k0, sl = VALUE_KNEE
    Yc = np.where(Y > k0, k0 + (Y - k0) * sl, Y)
    return _srgb(lin * (Yc / np.maximum(Y, 1e-5))[:, None]).astype(np.float32)


def head_preview_colour(name, p, n, pal, role, skin=None):
    """proto/rishal_head.py: the procedural head paint (with a skin's role change as a per-channel gain, the
    recolour's rule) or the flat role colour, graded like the atlas"""
    fn = PROC_HEAD.get(name) or PROC_BODY.get(name)
    if fn is not None:
        col = fn(p, n).astype(np.float32)
        if skin and role in skin.get("palette", {}):
            gain = _lin(_hexrgb(skin["palette"][role])) / np.maximum(_lin(_hexrgb(PALETTE[role])), 1e-4)
            col = _srgb(_lin(col) * gain).astype(np.float32)
    else:
        col = np.repeat(_hexrgb(pal.get(role, "#808080"))[None], len(p), 0)
    return _value_grade(col, p[:, 2])


def grip_paint(p, n, s):
    J = layout()
    palm = J[f"palm.{s}"]
    w = 0.5 + 0.5 * np.sin((p[:, 1] - palm[1]) * 260.0 + (p[:, 2] - palm[2]) * 90.0)
    a, b = _hexrgb(GRIP_COL["wrap"]), _hexrgb(GRIP_COL["dark"])
    return a[None] * (1 - w[:, None] * 0.6) + b[None] * w[:, None] * 0.6


def _erode(m, r):
    out = m.copy()
    for _ in range(r):
        out = out & np.roll(out, 1, 0) & np.roll(out, -1, 0) & np.roll(out, 1, 1) & np.roll(out, -1, 1)
    return out


def _paint_debug(names, k, cols, hid, wb):
    """RISHAL_PAINT_DEBUG=1: per part, the projected colour each side gives the texels it owns (median, L* p50) and
    the share of them taking a fill (hidden)"""
    lw = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    print("[rishal_paint] part  front: n hid% med L* | back: n hid% med L*")
    for i, nm in enumerate(names):
        row = f"  {nm:16s}"
        for side, sel_w in (("front", wb < 0.5), ("back", wb >= 0.5)):
            sel = (k == i) & sel_w
            if not sel.any():
                row += " |      -"
                continue
            c = cols[side][0][sel]
            med = np.median(c, 0)
            Y = float(_lin(med) @ lw)
            L = 116 * Y ** (1 / 3) - 16 if Y > 0.008856 else 903.3 * Y
            row += (f" | {int(sel.sum()):6d} {100 * hid[side][sel].mean():4.0f}% "
                    f"#{int(med[0] * 255):02X}{int(med[1] * 255):02X}{int(med[2] * 255):02X} {L:3.0f}")
        print(row)


def rishal_paint(maps0, sides, plates, names, flat=None, eps=0.02, log=print, mask=None):
    """the shared project.paint with per-side posed texel maps: sides = {side: (maps, vis)}; `mask` (the plates'
    figure mask, row 0 = top): texels landing outside it (the backdrop's inpaint, e.g. the gap between the left arm and
    the body, fix pass 2) count as hidden and take their part's nearest painted pixel"""
    from common.hifi import project as pj
    part = maps0["part"]
    size = maps0["size"]
    out = np.zeros((size, size, 3), dtype=np.float32)
    have = part >= 0
    idx = np.nonzero(have)
    k = part[idx].astype(np.int64)
    n0 = maps0["N"][idx]
    p0 = maps0["P"][idx]
    cols, _dbg = {}, {}
    for side in ("front", "back"):
        maps, vis = sides[side]
        p = maps["P"][idx]
        n = maps["N"][idx]
        fills = {}
        pid = vis.part[side]
        st = vis.step
        small = plates.img[side][st // 2::st, st // 2::st][:pid.shape[0], :pid.shape[1]]
        gsmall = _glassy(small)
        ysmall = _rimlit(small)
        msmall = mask[st // 2::st, st // 2::st][:pid.shape[0], :pid.shape[1]] if mask is not None else None
        for kk in np.unique(k):
            valid = pid == kk
            nm = names[int(kk)] if int(kk) < len(names) else ""
            if nm in HEAD_CHALK:
                valid = valid & ~gsmall          # the chalk helmet never takes the painted visor's glass
            elif nm in HEAD_GLASS:
                valid = valid & gsmall           # ...and the visor never the white face
            elif nm not in HEAD_PARTS:
                valid = valid & ~ysmall          # ...and no body part the rim light
            if msmall is not None and (valid & msmall).any():
                valid = valid & msmall           # never the backdrop's inpaint
            if valid.any():
                iy, ix = pj.nearest_index(valid)
                fills[int(kk)] = pj.blur(small[iy, ix], 1.0)
        sideways = np.abs(n[:, 0]) / (np.abs(n[:, 0]) + np.abs(n[:, 1]) + 1e-6)
        ws = np.clip((sideways - 0.72) / 0.24, 0, 1)
        ws = (ws * ws * (3 - 2 * ws))[:, None]
        soft = pj.blur(plates.img[side], SIDE_SOFT)
        px, py = plates.to_px(side, p[:, 0], p[:, 2])
        c = pj.bilinear(plates.img[side], px, py) * (1 - ws) + pj.bilinear(soft, px, py) * ws
        dep, hid = vis.lookup(side, px, py)
        if side == "front":
            hidden = ~(p[:, 1] <= np.nan_to_num(dep, nan=1e9) + eps)
        else:
            hidden = ~(p[:, 1] >= np.nan_to_num(dep, nan=-1e9) - eps)
        gl = _glassy(c)
        chalk_ids = [i for i, n_ in enumerate(names) if n_ in HEAD_CHALK]
        glass_ids = [i for i, n_ in enumerate(names) if n_ in HEAD_GLASS]
        body_ids = [i for i, n_ in enumerate(names) if n_ not in HEAD_PARTS]
        hidden = hidden | (np.isin(k, chalk_ids) & gl) | (np.isin(k, glass_ids) & ~gl) | (np.isin(k, body_ids) & _rimlit(c))
        if mask is not None:
            mh, mw = mask.shape
            inm = mask[np.clip(py.astype(np.int64), 0, mh - 1), np.clip(px.astype(np.int64), 0, mw - 1)]
            hidden = hidden | (np.isin(k, body_ids) & ~inm)
        for kk in np.unique(k[hidden]):
            sel = hidden & (k == kk)
            if names[int(kk)] in PROC_HIDDEN:
                c[sel] = face_paint(p0[sel], n0[sel])
                continue
            f = fills.get(int(kk))
            if f is None:
                continue
            c[sel] = pj.bilinear(f, px[sel] / st, py[sel] / st)
        cols[side] = (c, n)
        _dbg[side] = hidden
    nf, nb = cols["front"][1], cols["back"][1]
    wb = np.clip((0.5 * (nb[:, 1] + nf[:, 1]) + 0.25) / 0.5, 0, 1)
    wb = wb * wb * (3 - 2 * wb)
    if os.environ.get("RISHAL_PAINT_DEBUG"):
        _paint_debug(names, k, cols, _dbg, wb)
    col = cols["front"][0] * (1 - wb[:, None]) + cols["back"][0] * wb[:, None]
    for name in PAINTED:
        if name not in names:
            continue
        sel = k == names.index(name)
        if not sel.any():
            continue
        if name.startswith("knife_blade"):
            col[sel] = knife_paint(p0[sel], n0[sel], name[-1])
        elif name.startswith("knife_grip"):
            col[sel] = grip_paint(p0[sel], n0[sel], name[-1])
        elif name.startswith("knife_guard"):
            col[sel] = _hexrgb("#3E4146")[None] * (0.85 + 0.3 * np.clip(n0[sel, 2], 0, 1))[:, None]
        elif name == "boots":
            col[sel] = boot_paint(p0[sel], n0[sel])
        elif name.startswith("bracer"):
            col[sel] = bracer_paint(p0[sel], n0[sel], name[-1])
    for name, fn in list(PROC_HEAD.items()) + list(PROC_BODY.items()):   # painted, not projected
        if name in names:
            sel = k == names.index(name)
            if sel.any():
                col[sel] = fn(p0[sel], n0[sel])
    for name in TOP_FIX:
        if name in names:
            sel = k == names.index(name)
            if sel.any():
                col[sel] = top_fix(col[sel], n0[sel], p0[sel], wb[sel])
    for name, side, s_lum, s_hue, target, keep in HARMONIZE:
        if name in names:
            sel = k == names.index(name)
            if sel.any():
                w = wb[sel] if side == "back" else (1 - wb[sel] if side == "front" else np.ones(int(sel.sum())))
                if keep:
                    w = w * (1.0 - _brownish(col[sel]))
                col[sel] = harmonize(col[sel], w, s_lum, s_hue, p0[sel], target)
    for name, rgb in (flat or {}).items():
        if name in names:
            col[k == names.index(name)] = np.asarray(rgb, dtype=np.float32)
    zr = np.array([v for v, _ in VALUE_RAMP])
    mr = np.array([m for _, m in VALUE_RAMP])
    col = np.clip(col * np.interp(p0[:, 2], zr, mr)[:, None], 0.0, 1.0)
    lin = _lin(col)
    Y = lin @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    k0, sl = VALUE_KNEE
    Yc = np.where(Y > k0, k0 + (Y - k0) * sl, Y)
    col = _srgb(lin * (Yc / np.maximum(Y, 1e-5))[:, None]).astype(np.float32)
    out[idx] = col
    iy, ix = pj.nearest_index(have)
    out = out[iy, ix]
    return pj.blur(out, SOFTEN) if SOFTEN > 0 else out


def paint_object(obj, size, cfg, names, part_attr="vale_part", log=print, return_maps=False):
    from common import scene
    from common.hifi import project as pj
    cache = os.path.join(scene.CACHE_DIR, "concept")
    plates = pj.Plates(cache, cfg["concept"], cfg["height"])
    maps0 = pj.rasterize(obj, size, part_attr)
    sides = {}
    for side in ("front", "back"):
        ob = posed_copy(obj, CONCEPT_POSE[side], f"_paint_{side}", side, names)
        m = pj.rasterize(ob, size, part_attr)
        m["part"] = maps0["part"]
        vis = pj.VisibilityMaps.build(ob, plates, step=2, part_attr=part_attr)
        sides[side] = (m, vis)
        me = ob.data
        bpy.data.objects.remove(ob)
        bpy.data.meshes.remove(me)
    flat = {k_: scene.hex_srgb(h) for k_, h in (cfg.get("flat") or {}).items()}
    mpath = os.path.join(cache, f"{cfg['concept']}_mask.png")
    mask = _erode(pj.load_rgb(mpath)[..., 0] > 0.5, 3) if os.path.exists(mpath) else None
    img = rishal_paint(maps0, sides, plates, names, flat=flat, log=log, mask=mask)
    return (img, maps0) if return_maps else img


# ── skins: the role re-colour (each role's painted mean onto the skin colour, linear light) and Chalkline's chalk
# line-work (vector strokes laid on the rest-pose surface: decals with a plane, an up axis and a reach) ──────────────
def _lin(c):
    c = np.asarray(c, dtype=np.float32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def _runner(h, lean=0.0):
    """a child's chalk runner (polylines in a 2D frame, metres): a big round head with a dot of an eye and a tuft of
    hair, a short bent body, one arm swinging forward and one back (bent, uneven), the legs mid-stride with bent
    knees and stubby feet; drawn wobbly by _sketchy (fix pass 3, review: the crisp stick runner read as the exit-sign
    pictogram; never the arms-up V, which reads as a rune)"""
    k = h

    def P_(u, v):
        return (u * k + lean * v * k, v * k)
    head = [P_(0.15 * math.cos(a) + 0.06, 0.80 + 0.14 * math.sin(a)) for a in np.linspace(0.4, 2 * math.pi + 0.7, 16)]
    eye = [P_(0.11, 0.83), P_(0.125, 0.835)]
    hair = [P_(-0.02, 0.92), P_(0.02, 0.99), P_(0.05, 0.93), P_(0.09, 1.00), P_(0.12, 0.93)]
    return [head, eye, hair, [P_(0.04, 0.66), P_(0.02, 0.50), P_(0.00, 0.36)],
            [P_(0.03, 0.60), P_(0.20, 0.55), P_(0.28, 0.66)], [P_(0.03, 0.60), P_(-0.12, 0.50), P_(-0.16, 0.38)],
            [P_(0.00, 0.36), P_(0.16, 0.24), P_(0.14, 0.04), P_(0.24, 0.03)],
            [P_(0.00, 0.36), P_(-0.12, 0.22), P_(-0.28, 0.20), P_(-0.30, 0.12)]]


def _sketchy(strokes, seed=0.0):
    """a hand-drawn pass over the strokes: each line cut into ~8 mm pieces that wobble about 1.5 mm, then drawn a
    second time a little off and shorter (chalk is redrawn, never ruled)"""
    out = []
    for j, line in enumerate(strokes):
        L = np.asarray(line, dtype=np.float64)
        for pass_, (du, dv, cut) in enumerate(((0.0, 0.0, 0.0), (0.0016, -0.0011, 0.12))):
            pts = []
            for a_, b_ in zip(L[:-1], L[1:]):
                m = max(2, int(np.linalg.norm(b_ - a_) / 0.008) + 1)
                for t in np.linspace(0, 1, m, endpoint=False):
                    pts.append(a_ + (b_ - a_) * t)
            pts.append(L[-1])
            P = np.array(pts)
            if cut and len(P) > 4:
                c0 = int(len(P) * cut)
                P = P[c0:len(P) - c0 // 2]
            ph = seed * 3.1 + j * 1.7 + pass_ * 2.3
            idx = np.arange(len(P))
            wob = np.stack([np.sin(idx * 1.9 + ph), np.cos(idx * 2.7 + ph * 1.3)], 1) * 0.0014
            out.append([tuple(q) for q in P + wob + np.array([du, dv])])
    return out


def _speed(n, L, gap, ang=20.0):
    a = math.radians(ang)
    d = np.array([math.cos(a), math.sin(a)])
    nrm = np.array([-d[1], d[0]])
    return [[tuple(-d * L * 0.5 + nrm * (i - (n - 1) / 2) * gap - d * 0.15 * L * i),
             tuple(d * L * 0.5 + nrm * (i - (n - 1) / 2) * gap - d * 0.15 * L * i)] for i in range(n)]


def _sun(r):
    ring = [(r * math.cos(a), r * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 17)]
    rays = [[(1.4 * r * math.cos(a), 1.4 * r * math.sin(a)), (2.0 * r * math.cos(a), 2.0 * r * math.sin(a))]
            for a in np.linspace(0, 2 * math.pi, 9)[:-1]]
    return [ring] + rays


def _ground(L, n=3):
    """a chalk ground line with a few dashes under a runner"""
    return [[(-L / 2, 0.0), (L / 2, 0.0)]] + [[(-L / 2 + L * (i + 0.2) / n, -0.012), (-L / 2 + L * (i + 0.6) / n, -0.012)]
                                             for i in range(n)]


def _shift(strokes, du, dv):
    return [[(u + du, v + dv) for u, v in line] for line in strokes]


def chalk_decals() -> list:
    """(centre, normal, up, reach, strokes, parts) in the rest pose: children's chalk sketches (stick runners, speed
    lines, suns, ground dashes) drawn densely over the ink-grey pieces (the coat, the apron, the sleeves, the chest,
    the pauldrons, the legs), lines under 1 cm"""
    J = layout()
    run_row = _runner(0.15, 0.20) + _shift(_runner(0.13, 0.20), 0.16, 0.0) + _shift(_ground(0.34), 0.06, -0.01)
    out = [((0.0, -0.128, 1.300), (0, -1, 0), (0, 0, 1), 0.05, _sun(0.022), ("chest_plate",)),
           ((0.075, -0.115, 1.215), (0, -1, 0), (0, 0, 1), 0.05, _runner(0.075, 0.25), ("chest_plate",)),
           ((-0.080, -0.112, 1.225), (0, -1, 0), (0, 0, 1), 0.05, _speed(3, 0.07, 0.016, 160), ("chest_plate",)),
           # the coat's back: a row of runners on a ground line, speed lines streaming behind, a sun up by the belt
           ((-0.07, 0.185, 0.700), (0, 1, 0), (0, 0, 1), 0.07, run_row, ("skirt_L", "skirt_R")),
           ((0.10, 0.175, 0.880), (0, 1, 0), (0, 0, 1), 0.07, _sun(0.024), ("skirt_L", "skirt_R")),
           ((-0.11, 0.170, 0.890), (0, 1, 0), (0, 0, 1), 0.07, _speed(4, 0.10, 0.018, 160), ("skirt_L", "skirt_R")),
           # the coat's sides and front panels
           ((0.235, 0.0, 0.760), (1, 0, 0), (0, 0, 1), 0.06, _runner(0.12, 0.25), ("skirt_L",)),
           ((0.230, 0.0, 0.900), (1, 0, 0), (0, 0, 1), 0.06, _speed(3, 0.08, 0.018, 200), ("skirt_L",)),
           ((-0.235, 0.0, 0.740), (-1, 0, 0), (0, 0, 1), 0.06, _speed(4, 0.09, 0.018, 200), ("skirt_R",)),
           ((-0.230, 0.0, 0.900), (-1, 0, 0), (0, 0, 1), 0.06, _runner(0.10, 0.25), ("skirt_R",)),
           ((0.16, -0.13, 0.80), (0.6, -0.8, 0), (0, 0, 1), 0.06, _speed(3, 0.07, 0.016, 20), ("skirt_L",)),
           ((-0.16, -0.13, 0.80), (-0.6, -0.8, 0), (0, 0, 1), 0.06, _sun(0.018), ("skirt_R",)),
           # the apron: a big runner over a ground line and a sun
           ((-0.030, -0.172, 0.800), (0, -1, 0), (0, 0, 1), 0.04, _runner(0.17, 0.20) + _shift(_ground(0.18), 0.02, -0.01), ("apron",)),
           ((0.035, -0.170, 0.960), (0, -1, 0), (0, 0, 1), 0.04, _sun(0.018), ("apron",)),
           ((-0.070, -0.170, 0.700), (0, -1, 0), (0, 0, 1), 0.04, _speed(3, 0.06, 0.014, 20), ("apron",)),
           # the shoulders and the crest side of the helm
           ((-0.215, 0.0, 1.425), (-0.8, 0, 0.6), (0, -0.2, 1), 0.05, _runner(0.075, 0.2), ("pauldron_R",)),
           ((0.230, 0.0, 1.440), (0.8, 0, 0.6), (0, -0.2, 1), 0.05, _speed(3, 0.06, 0.014, 30), ("pauldron_L",)),
           ((0.09, -0.002, 1.665), (1, 0, 0), (0, 0, 1), 0.03, _speed(2, 0.07, 0.016, 200), ("helm",)),
           ((-0.09, -0.002, 1.665), (-1, 0, 0), (0, 0, 1), 0.03, _speed(2, 0.07, 0.016, -20), ("helm",)),
           ((0.0, 0.10, 1.66), (0, 1, 0), (0, 0, 1), 0.04, _sun(0.016), ("helm",))]
    for s, sx in (("R", -1.0), ("L", 1.0)):
        kn, an = J[f"knee.{s}"], J[f"ankle.{s}"]
        c = kn + (an - kn) * 0.45 + np.array([0.0, -0.065, 0.0])
        out.append((tuple(c), (0, -1, 0), (0, 0, 1), 0.05, _speed(3, 0.08, 0.018, 70 if s == "L" else 110), (f"greave_{s}",)))
        out.append((tuple(kn + np.array([0.0, -0.085, 0.03])), (0, -1, 0), (0, 0, 1), 0.04, _runner(0.075, 0.2), (f"knee_{s}",)))
        hp = J[f"hip.{s}"]
        out.append((tuple(hp + (J[f"knee.{s}"] - hp) * 0.75 + np.array([sx * 0.02, -0.09, 0.0])),
                    (0, -1, 0), (0, 0, 1), 0.05, _speed(2, 0.07, 0.02, 75 if s == "L" else 105), ("trousers",)))
        out.append((tuple(hp + (J[f"knee.{s}"] - hp) * 0.80 + np.array([0.0, 0.09, 0.0])),
                    (0, 1, 0), (0, 0, 1), 0.05, _runner(0.09, 0.25), ("trousers",)))
        el, d2 = J[f"elbow.{s}"], J[f"d2.{s}"]
        outv = unit(np.array([sx, 0.0, 0.0]) - d2 * (sx * d2[0]))
        c = el + d2 * 0.12 + outv * 0.05
        out.append((tuple(c), tuple(outv), tuple(-d2), 0.04, _speed(3, 0.07, 0.016, 90), (f"bracer_{s}",)))
        sh = J[f"shoulder.{s}"]                                   # the sleeves: speed lines down the upper arm
        c = sh + (el - sh) * 0.55 + np.array([sx * 0.045, 0.0, 0.0])
        out.append((tuple(c), (sx, 0, 0), tuple(unit(sh - el)), 0.05, _speed(3, 0.09, 0.016, 90), ("sleeves",)))
        out.append((tuple(sh + (el - sh) * 0.5 + np.array([0.0, 0.05, 0.0])), (0, 1, 0), (0, 0, 1), 0.04,
                    _runner(0.07, 0.2), ("sleeves",)))
    root, tip = np.array((0.085, -0.015, 1.470)), np.array((0.428, 0.150, 1.672))
    n = unit(np.cross(tip - root, (0.0, -1.0, 0.25)))
    if n[2] < 0:
        n = -n
    c = root + (tip - root) * 0.45
    out.append((tuple(c), tuple(n), tuple(unit(tip - root)), 0.05, _runner(0.09, 0.1), ("lames_L",)))
    out.append((tuple(root + (tip - root) * 0.72), tuple(n), tuple(unit(tip - root)), 0.05, _speed(2, 0.06, 0.014, 0), ("lames_L",)))
    # the helmet: a sun and speed lines over the nape plates and a scribble of speed lines down the back keel
    out.append(((0.0, 0.108, 1.600), (0, 1, 0), (0, 0, 1), 0.04, _speed(3, 0.07, 0.012, 0), ("nape",)))
    out.append(((0.05, 0.085, 1.700), (0.5, 0.85, 0), (0, 0, 1), 0.04, _sun(0.014), ("helm",)))
    return [(c, n, up, reach, _sketchy(st, i), parts) for i, (c, n, up, reach, st, parts) in enumerate(out)]


def chalk_linework(img_lin, maps, names, col_hex, log=print):
    P, N, part = maps["P"], maps["N"], maps["part"]
    have = part >= 0
    lw = _lin(_hexrgb(col_hex))
    tot = 0
    for c, n, up, reach, strokes, parts in chalk_decals():
        c, n = np.asarray(c, dtype=np.float64), unit(n)
        u_ax = unit(np.cross(up, n)) if abs(np.dot(unit(up), n)) < 0.95 else unit(np.cross((1, 0, 0), n))
        v_ax = unit(np.cross(n, u_ax))
        ids = [names.index(p_) for p_ in parts if p_ in names]
        sel = have & np.isin(part, ids)
        if not sel.any():
            continue
        iy, ix = np.nonzero(sel)
        p = P[iy, ix].astype(np.float64) - c
        facing = N[iy, ix] @ n
        near = (np.abs(p @ n) < reach) & (facing > 0.25)
        uv = np.stack([p @ u_ax, p @ v_ax], 1)
        dmin = np.full(len(p), 1e3)
        for line in strokes:
            L = np.asarray(line, dtype=np.float64)
            for a, b in zip(L[:-1], L[1:]):
                e = b - a
                t = np.clip(((uv - a) @ e) / (e @ e + 1e-12), 0, 1)
                dmin = np.minimum(dmin, np.linalg.norm(uv - (a + t[:, None] * e), axis=1))
        w = np.clip((0.0047 - dmin) / 0.0016, 0, 1) * near          # (fix pass 4: bolder, still under 1 cm)
        grain = 0.75 + 0.25 * np.sin(p[:, 0] * 900.0) * np.sin(p[:, 2] * 700.0 + p[:, 1] * 500.0)
        w = w * np.clip(grain, 0, 1) * 0.92
        img_lin[iy, ix] = img_lin[iy, ix] * (1 - w[:, None]) + lw[None] * w[:, None]
        tot += int((w > 0.3).sum())
    log(f"  chalk line-work: {tot} texels ({100.0 * tot / max(1, int(have.sum())):.1f} % of the atlas)")
    return img_lin


_SKIN: dict = {}


def rishal_recolour(img, maps, names, roles, base_pal, skin_pal, skip=None, log=print):
    """each role the skin changes takes the brief's change, skin colour / base colour per channel in linear light (the
    shared recolour's rule: the painting's values and detail keep their relationships to the base), then Chalkline's
    chalk line-work"""
    from common.hifi import project as pj
    part = maps["part"]
    iy, ix = pj.nearest_index(part >= 0)
    pid = part[iy, ix]
    lin = _lin(img)
    out = lin.copy()
    skip = skip or set()
    gains = {}
    for role in sorted(set(r for r in roles.values() if r)):
        if role == "accent" or role not in skin_pal or role not in base_pal:
            continue
        if str(base_pal[role]).lower() == str(skin_pal[role]).lower():
            continue
        ids = [i for i, n in enumerate(names) if roles.get(n) == role and n not in skip]
        if not ids:
            continue
        if role in (_SKIN.get("absolute") or ()):
            m = np.isin(part, ids)            # the role's painted mean lands on the skin colour (an identity change)
            ref = lin[m].mean(0) if m.any() else _lin(_hexrgb(base_pal[role]))
        else:
            ref = _lin(_hexrgb(base_pal[role]))
        gain = np.clip(_lin(_hexrgb(skin_pal[role])) / np.maximum(ref, 1e-4), 0.05, 8.0)
        gains[role] = gain
        sel = np.isin(pid, ids)
        out[sel] = lin[sel] * gain
        log(f"  recolour {role}: {base_pal[role]} -> {skin_pal[role]}, gain {np.round(gain, 2).tolist()}")
    for pn, hx in (_SKIN.get("parts") or {}).items():         # identity pieces: the part's painted mean -> hx
        if pn not in names:
            continue
        m = part == names.index(pn)
        if not m.any():
            continue
        gain = np.clip(_lin(_hexrgb(hx)) / np.maximum(lin[m].mean(0), 1e-4), 0.05, 8.0)
        gains["part:" + pn] = gain
        sel = pid == names.index(pn)
        out[sel] = lin[sel] * gain
        log(f"  recolour part {pn} -> {hx}, gain {np.round(gain, 2).tolist()}")
    # the forearms (one part, three materials): the guard keeps the stone gain, the straps take the leather's, the
    # cloth under them the sleeves' (their part gain, else the linen's)
    one = np.ones(3, dtype=np.float32)
    g_leather = gains.get("leather", one)
    g_cloth = gains.get("part:sleeves", gains.get(roles.get("sleeves"), one))
    g_stone = gains.get("stone", one)
    for s_ in ("R", "L"):
        nm = f"bracer_{s_}"
        if nm not in names:
            continue
        sel = pid == names.index(nm)
        if not sel.any():
            continue
        iy2, ix2 = np.nonzero(sel)
        jy, jx = iy[iy2, ix2], ix[iy2, ix2]          # the nearest painted texel (gutters carry no position)
        pp = maps["P"][jy, jx].astype(np.float64)
        nn = maps["N"][jy, jx].astype(np.float64)
        wg, wl = bracer_paint(pp, nn, s_, zones=True)
        wc = np.clip(1.0 - wg - wl, 0, 1)
        gz = wg[:, None] * g_stone[None] + wl[:, None] * g_leather[None] + wc[:, None] * g_cloth[None]
        out[iy2, ix2] = lin[iy2, ix2] * gz
    log(f"  recolour bracers by zone: leather {np.round(g_leather, 2).tolist()}, cloth {np.round(g_cloth, 2).tolist()}")
    # the bible's value limit after the gains (fix pass 2: Lamplit's warm linen gain lifted the lit sleeves and scarf
    # past L* 86): luminance above L* 81 is compressed, capped at L* 85 (the chalk line-work after this is exempt)
    lw_ = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    Y = np.maximum(out @ lw_, 1e-5)
    Yc = np.minimum(np.where(Y > 0.58, 0.58 + (Y - 0.58) * 0.35, Y), 0.665)
    out = out * (Yc / Y)[..., None]
    if (_SKIN.get("extra") or {}).get("linework") and "linework" in skin_pal:
        out = chalk_linework(out, maps, names, skin_pal["linework"], log=log)
    return _srgb(out).astype(np.float32)


def _install_paint() -> None:
    from common.hifi import project
    if getattr(project.paint_object, "_rishal", False):
        return
    paint_object._rishal = True
    project.paint_object = paint_object
    rishal_recolour._rishal = True
    project.recolour = rishal_recolour




# ── MOTION (brief §8): light, dual reverse-gripped knives, low stance ──────────────────────────────────────────
# Hand IK: wrist `rel` from the posed shoulder in arm lengths (chest frame: +X left, -Y front, +Z up), elbow poles;
# the knives are reverse-gripped, so each pose names the BLADE's direction (armature space) and the aim (the prop's
# +Y, out of the thumb side) is its opposite. Feet are planted by IK; the guard is a staggered low stance, the left
# foot forward. In game a dash plays its effect's present.anim (the unit faces where it goes): Glass Dash plays
# cast_a1 and Feint cast_a3 (natural speed from frame 0, so each clip's launch, flight and touchdown sit inside the
# ~0.3 s dash), Long Glint's rush plays `dash` (stretched over the rush) straight on from cast_ult's burst
# (fix pass 3, review: all three dashes played one planted `dash` crouch, so the four gestures never showed).
HandTarget, Aim, FootTarget = anim.HandTarget, anim.Aim, anim.FootTarget
LEAN = 20.0                       # the guard's chest-axis lean (deg), brief: 10 in idle, 15 in run (reads ~10)


def _blade(d):
    v = np.asarray(d, dtype=np.float64)
    v = v / np.linalg.norm(v)
    return Aim(tuple(-v))


def _guard() -> dict:
    """the guard: a low staggered stance (left foot forward, the weight on it), the chest leaning ~11 degrees, both
    fists low and wide of the hips, the reversed blades flaring out and back (the concept's hold)"""
    # (fix pass 3: the lean deepened, 11 -> ~20 degrees on the chest axis with the hips back over the rear foot: from
    # the game and three-quarter cameras the guard read upright)
    st = anim.merge(anim.P(hips=(9, -6, 0), spine=(6, 3, 0), chest=(5, 3, 0), neck=(-8, 1, 0), head=(-10, 2, 0)),
                    {"hips_loc": (0.0, 0.01, -0.07),
                     "ik": anim.feet(l=(0.035, -0.15, 0.0), r=(-0.03, 0.15, 0.0), yl=-4.0, yr=-24.0)})
    # (fix pass 5, review: the fists sat on the hips akimbo, the blades short stubs at hip height): the concept's low
    # outward hold: both arms down and out from the body, the fists a hand's width forward of the hips and wide of
    # them, each reversed blade flaring out, down and back from the little finger, so the two glass blades open an
    # inverted V either side of the coat from the front and trail behind from the side
    arms = anim.merge(anim.arms_relaxed(), {"ik": {
        "hand.R": HandTarget(rel=(-0.30, -0.36, -0.82), pole=(-0.90, 0.40, -0.10)),
        "hand.L": HandTarget(rel=(0.28, -0.42, -0.80), pole=(0.90, 0.35, -0.10)),
        "aim.R": _blade((-0.70, 0.45, -0.55)), "aim.L": _blade((0.70, 0.40, -0.58))}})
    return anim.merge(st, arms)


def _feet(g, dl=(0.0, 0.0, 0.0), dr=(0.0, 0.0, 0.0), pl=None, pr=None, yl=None, yr=None, wl=1.0, wr=1.0):
    fl, fr = g["ik"]["foot.L"], g["ik"]["foot.R"]
    return {"foot.L": FootTarget(tuple(fl.ankle[i] + dl[i] for i in range(3)), fl.pitch if pl is None else pl,
                                 fl.yaw if yl is None else yl, 0.0, 0.0, wl),
            "foot.R": FootTarget(tuple(fr.ankle[i] + dr[i] for i in range(3)), fr.pitch if pr is None else pr,
                                 fr.yaw if yr is None else yr, 0.0, 0.0, wr)}


def _pose(g, torso=None, hips=(0.0, 0.0, 0.0), R=None, Rp=None, Rb=None, L=None, Lp=None, Lb=None, feet=None,
          extra=None, Rpos=None, Lpos=None) -> dict:
    """a pose over the guard: torso deltas (deg), a hips offset (m), wrists (rel) + poles, blade directions, feet"""
    p = anim.add(g, anim.P(**(torso or {})))
    if extra:
        p = anim.merge(p, anim.P(**extra))
    ik = dict(g["ik"])
    for side, rel, pos, pole, bl in (("R", R, Rpos, Rp, Rb), ("L", L, Lpos, Lp, Lb)):
        old = ik[f"hand.{side}"]
        if rel is not None or pos is not None:
            ik[f"hand.{side}"] = HandTarget(rel=tuple(rel) if rel is not None else None,
                                            pos=tuple(pos) if pos is not None else None,
                                            pole=tuple(pole) if pole is not None else old.pole)
        elif pole is not None:
            ik[f"hand.{side}"] = HandTarget(rel=old.rel, pos=old.pos, pole=tuple(pole))
        if bl is not None:
            ik[f"aim.{side}"] = _blade(bl)
    if feet:
        ik.update(feet)
    p["ik"] = ik
    hx, hy, hz = g.get("hips_loc", (0.0, 0.0, 0.0))
    p["hips_loc"] = (hx + hips[0], hy + hips[1], hz + hips[2])
    return p


def _clip(name, N, keys, loop=False, impact=None, lags=None):
    fn = anim.keyed(keys)
    if lags:
        fn = anim.drag(fn, N, lags, loop)
    return anim.Clip(name, N, loop, fn, impact=impact)


def _idle(g) -> anim.Clip:
    """idle (60 f loop): the guard breathing, a weight rock onto the front foot, a quick glance back over the right
    shoulder (he is always checking who follows), the knives ticking"""
    N = 60

    def sample(t):
        b = anim.osc(t, 2)
        s = anim.osc(t, 1, 0.1)
        look = math.sin(math.pi * min(1.0, max(0.0, (t - 0.52) / 0.30))) ** 2
        d = anim.P(chest=(1.8 * b, 0, 0), spine=(0.8 * b, 0, 1.0 * s), neck=(-1.0 * b, -6 * look, 0),
                   head=(-0.8 * b, 2.0 * s - 22.0 * look, -3 * look), shoulder_L=(0, 0, 1.8 * b), shoulder_R=(0, 0, -1.8 * b),
                   hips=(0, 1.6 * s, -1.2 * s))
        p = anim.add(g, d)
        ik = dict(p["ik"])
        for side, ph in (("R", 0.0), ("L", 0.3)):
            h = ik[f"hand.{side}"]
            ik[f"hand.{side}"] = HandTarget(rel=(h.rel[0], h.rel[1] - 0.012 * anim.osc(t, 2, ph), h.rel[2] + 0.018 * anim.osc(t, 2, ph + 0.1)),
                                            pole=h.pole)
        p["ik"] = ik
        hx, hy, hz = g["hips_loc"]
        p["hips_loc"] = (hx + 0.012 * s, hy - 0.010 * (0.5 + 0.5 * s), hz - 0.006 * (0.5 + 0.5 * b))
        return p
    return anim.Clip("idle", N, True, sample)


def _run() -> anim.Clip:
    """run at 3.55 m/s (the shared generator's planted feet, 16 f), a 15 degree lean, sprinter's arms swinging
    opposite the legs, the knives trailing behind the fists"""
    base = anim.gen_run(dict(MOTION, weapon="none"))
    N = base.frames

    def sample(t):
        # the lean (the generator's light lean is ~9 deg; the brief's run is 15 on the chest axis), the head kept up
        p = anim.add(base.sample(t), anim.P(hips=(2, 0, 0), spine=(4, 0, 0), chest=(3, 0, 0), neck=(-5, 0, 0), head=(-5, 0, 0)))
        q = t % 1.0
        sw = math.cos(2 * math.pi * (q - 0.03))                 # + : the right arm forward
        ik = dict(p["ik"])
        for side, k in (("R", 0.5 - 0.5 * sw), ("L", 0.5 + 0.5 * sw)):     # k: 0 forward, 1 back
            sx = -1.0 if side == "R" else 1.0
            # a sprinter's arms: elbows in by the ribs and bent ~90 degrees, the fist driving up to the chest in front
            # and back past the hip; the knives trail back along the forearms and out behind on the back swing
            fwd, back = np.array([-sx * 0.06, -0.58, -0.36]), np.array([sx * 0.10, 0.42, -0.70])
            u = 0.5 - 0.5 * math.cos(math.pi * k)
            r = fwd * (1 - u) + back * u
            pole = (sx * 0.30, 0.90, -0.30) if k < 0.5 else (sx * 0.35, 0.85, 0.20)
            bf, bb = np.array([sx * 0.12, 0.70, -0.70]), np.array([sx * 0.22, 0.95, 0.20])
            ik[f"hand.{side}"] = HandTarget(rel=tuple(r), pole=pole)
            ik[f"aim.{side}"] = _blade(bf * (1 - u) + bb * u)
        for side in ("L", "R"):          # a lower knee lift (the generator's swing path lifts the ankle 0.36 m);
            ft = ik[f"foot.{side}"]      # the contact (ankle offset z 0) and its heel-ball roll are left exact
            if ft.ankle[2] > 1e-4:
                ik[f"foot.{side}"] = FootTarget((ft.ankle[0], ft.ankle[1], ft.ankle[2] * 0.74), ft.pitch, ft.yaw,
                                                ft.toe, ft.knee, ft.weight)
        p["ik"] = ik
        return p
    return anim.Clip("run", N, True, sample, meta=base.meta)


def _attack1(g) -> anim.Clip:
    """attack1 (20 f, impact f8): a quick right-knife jab with the reverse grip, an ice-pick stab: the fist cocks up
    by the right ear (the blade tip forward), the hips and the right shoulder drive in and the fist punches forward
    and down, the blade leading point-first forward-down at chest height; the left fist pulled back to the ribs
    (fix pass 3, review: the impact frame showed the knife hanging straight down beside a lowered arm)"""
    wind = _pose(g, dict(hips=(0, -10, 0), spine=(-3, -9, 2), chest=(-5, -14, 4), head=(0, 10, 0)), (0.0, 0.03, -0.01),
                 R=(-0.02, -0.22, 0.46), Rp=(-0.9, 0.3, 0.2), Rb=(0.02, -0.85, 0.52),
                 L=(-0.12, -0.62, -0.44))
    step = _feet(g, dl=(0.0, -0.10, 0.0), pl=0.0)
    # (fix pass 5, review: the chest yawed 43 and the head 54 degrees at the impact, the stab aimed beside the target):
    # the shoulders turn ~18 degrees into it, the head stays on the target, the fist drives straight down the line
    hit = _pose(g, dict(hips=(3, 7, 0), spine=(2, 5, -3), chest=(1, 6, -4), head=(-1, -16, 0)), (0.0, -0.07, -0.035),
                R=(0.30, -0.95, 0.02), Rp=(-0.8, 0.2, -0.5), Rb=(0.10, -0.74, -0.66),
                L=(-0.04, -0.30, -0.64), Lp=(0.8, 0.6, -0.2), feet=step)
    fol = _pose(g, dict(hips=(4, 9, 0), spine=(3, 6, -3), chest=(2, 7, -5), head=(-2, -17, 0)), (0.0, -0.08, -0.04),
                R=(0.30, -0.86, -0.24), Rp=(-0.7, 0.3, -0.6), Rb=(0.10, -0.40, -0.91),
                L=(-0.04, -0.30, -0.64), feet=step)
    return _clip("attack1", 20, anim.strike_keys(MOTION, wind, hit, fol, g), impact=anim.IMPACT, lags={"head": 1.5, "neck": 1.0})


def _attack2(g) -> anim.Clip:
    """attack2 (20 f, impact f8): a left-knife backhand slash: the left fist coils across to the right shoulder, the
    chest unwinds and the arm sweeps flat out to his left-front, the blade flicked out edge-first through the line"""
    wind = _pose(g, dict(hips=(2, -12, 0), spine=(2, -10, 0), chest=(3, -16, 0), head=(0, 12, 0)), (0.0, 0.02, -0.015),
                 L=(-0.48, -0.40, -0.10), Lp=(0.6, 0.0, -0.8), Lb=(0.75, 0.55, -0.15),
                 R=(0.10, -0.42, -0.62))
    step = _feet(g, dl=(0.05, -0.06, 0.0), yl=10.0)
    # (fix pass 5, review: at the impact the left blade was 55-60 degrees to his left, the head turned 59): the blade
    # crosses the line in front of him at the impact (the shoulders squared, the head on the target) and only the
    # follow-through carries it out to his left
    hit = _pose(g, dict(hips=(4, 6, 0), spine=(5, 5, 0), chest=(6, 7, 0), head=(0, -14, 0)), (0.02, -0.05, -0.03),
                L=(-0.04, -0.97, -0.16), Lp=(0.8, 0.3, -0.5), Lb=(0.16, -0.94, -0.30),
                R=(0.14, -0.36, -0.64), Rp=(-0.8, 0.6, -0.2), feet=step)
    fol = _pose(g, dict(hips=(4, 14, 0), spine=(5, 10, 0), chest=(6, 14, 0), head=(0, -18, 0)), (0.03, -0.05, -0.035),
                L=(0.55, -0.70, -0.22), Lp=(0.6, 0.6, -0.5), Lb=(0.85, -0.35, -0.30),
                R=(0.14, -0.34, -0.66), feet=step)
    return _clip("attack2", 20, anim.strike_keys(MOTION, wind, hit, fol, g), impact=anim.IMPACT, lags={"head": 1.5, "neck": 1.0})


def _crit(g) -> anim.Clip:
    """crit (20 f, impact f8): both knives at once, an X cut: the fists cross high before the face and rip down and
    out to either side"""
    wind = _pose(g, dict(hips=(-2, 0, 0), spine=(-4, 0, 0), chest=(-6, 0, 0), head=(-4, 0, 0)), (0.0, 0.03, 0.01),
                 R=(0.40, -0.45, 0.20), Rp=(-0.8, 0.2, 0.4), Rb=(-0.55, 0.40, 0.72),
                 L=(-0.40, -0.45, 0.18), Lp=(0.8, 0.2, 0.4), Lb=(0.55, 0.40, 0.72))
    step = _feet(g, dl=(0.0, -0.10, 0.0))
    hit = _pose(g, dict(hips=(10, 0, 0), spine=(8, 0, 0), chest=(6, 0, 0), head=(-6, 0, 0)), (0.0, -0.06, -0.05),
                R=(-0.42, -0.72, -0.42), Rp=(-0.8, 0.3, -0.5), Rb=(-0.55, -0.60, -0.58),
                L=(0.42, -0.72, -0.44), Lp=(0.8, 0.3, -0.5), Lb=(0.55, -0.60, -0.58), feet=step)
    fol = _pose(g, dict(hips=(12, 0, 0), spine=(9, 0, 0), chest=(7, 0, 0), head=(-8, 0, 0)), (0.0, -0.07, -0.06),
                R=(-0.62, -0.45, -0.55), Rb=(-0.80, -0.10, -0.60), L=(0.62, -0.45, -0.56), Lb=(0.80, -0.10, -0.60), feet=step)
    return _clip("crit", 20, anim.strike_keys(MOTION, wind, hit, fol, g), impact=anim.IMPACT, lags={"head": 1.5, "neck": 1.0})


def _sprint(g, k=1.0, phase=0.0) -> dict:
    """Glass Dash's sprint (lean ~35 degrees), airborne between strides: the lead knee driven up, the rear foot kicked
    high behind, both fists swept low behind the hips with the blades pointing back and down so their tips skim the
    ground behind him (the track); `phase` 0/1 = which leg leads (fix pass 3: the feet were 10 cm off the floor, a
    planted crouch sliding)"""
    lead = "L" if phase < 0.5 else "R"
    fwd, back = np.array((0.0, -0.22, 0.22)), np.array((0.0, 0.40, 0.30))
    xs = {"L": 0.02, "R": -0.02}
    ft = {f"foot.{s_}": FootTarget(tuple((fwd if s_ == lead else back) * k + (xs[s_], 0, 0)),
                                   12.0 if s_ == lead else -58.0, 0.0) for s_ in ("L", "R")}
    # (fix pass 5, review: the knife tips stayed at hip height): the body lower, both arms reaching straight down and
    # back, the blades pointing down-back so the glass tips run a hand's height over the ground behind him
    return _pose(g, dict(hips=(22 * k, 0, 0), spine=(10 * k, 0, 0), chest=(6 * k, 0, 0), neck=(-16 * k, 0, 0), head=(-14 * k, 0, 0)),
                 (0.0, -0.12 * k, -0.15 * k),
                 R=(-0.06, 0.30, -0.96), Rp=(-0.7, 0.5, 0.2), Rb=(-0.10, 0.28, -0.95),
                 L=(0.06, 0.30, -0.96), Lp=(0.7, 0.5, 0.2), Lb=(0.10, 0.28, -0.95), feet=ft)


def _ult_burst(g) -> dict:
    """Long Glint's burst: full extension, the body near horizontal, both knives forward and low either side of the
    line, the rear leg trailing straight, the front foot skimming"""
    # (fix pass 4, review: in the burst and the rush one blade pointed steeply down through the floor: the fists ride
    # higher and the blades point forward and slightly UP, level with the line of the rush)
    return _pose(g, dict(hips=(38, 0, 0), spine=(14, 0, 0), chest=(10, 0, 0), neck=(-22, 0, 0), head=(-24, 0, 0)), (0.0, -0.30, -0.24),
                 R=(-0.22, -0.88, -0.16), Rp=(-0.8, 0.4, -0.3), Rb=(-0.30, -0.92, 0.22),
                 L=(0.22, -0.88, -0.17), Lp=(0.8, 0.4, -0.3), Lb=(0.30, -0.92, 0.22),
                 feet=_feet(g, dl=(0.0, -0.42, 0.0), dr=(0.0, 0.42, 0.0), pl=0.0, pr=-48.0))


def _dash(g) -> anim.Clip:
    """dash (15 f, stretched over the dash): Long Glint's rush, straight on from cast_ult's burst: the spear held, the
    body near horizontal and the knives forward and low, the rear leg trailing and the front foot skimming in a long
    glide (the shoulders pulsing), then a skid up toward the guard"""
    burst = _ult_burst(g)
    glide = anim.add(burst, anim.P(hips=(2, 0, 0), chest=(-2, 0, 0), head=(-2, 0, 0)))
    glide["hips_loc"] = (burst["hips_loc"][0], burst["hips_loc"][1], burst["hips_loc"][2] + 0.02)
    gk = dict(glide["ik"])
    gk.update(_feet(g, dl=(0.0, -0.44, 0.03), dr=(0.0, 0.50, 0.08), pl=6.0, pr=-55.0))
    glide["ik"] = gk
    skid = _pose(g, dict(hips=(18, 0, 0), spine=(8, 0, 0), chest=(4, 0, 0), neck=(-8, 0, 0), head=(-8, 0, 0)), (0.0, -0.06, -0.12),
                 R=(-0.30, -0.66, -0.30), Rb=(-0.50, -0.80, -0.10), L=(0.30, -0.66, -0.31), Lb=(0.50, -0.80, -0.10),
                 feet=_feet(g, dl=(0.0, -0.18, 0.0), dr=(0.0, 0.20, 0.0), pr=-24.0))
    keys = [(0.0, burst, "linear"), (0.22, glide, "inout"), (0.50, burst, "inout"), (0.74, glide, "inout"),
            (0.90, skid, "out"), (1.0, anim.lerp_pose(skid, g, 0.35), "inout")]
    return _clip("dash", 15, keys, lags={"head": 1.0})


def _cast_a1(g) -> anim.Clip:
    """cast_a1 Glass Dash (15 f, impact f6, castTime 0; in game it plays at its own pace from frame 0 across the
    ~0.31 s dash): a 2-frame crouch with both knives dragged back, the launch, the lean peaking at ~35 degrees at f6
    as the sim fires him 5 m at 16 m/s, airborne sprinting strides with the blades trailing low (the track); no
    second swing"""
    crouch = _pose(g, dict(hips=(12, 0, 0), spine=(6, 0, 0), chest=(4, 0, 0), neck=(-8, 0, 0), head=(-8, 0, 0)), (0.0, 0.02, -0.11),
                   R=(0.02, 0.10, -0.85), Rp=(-0.8, 0.5, 0.0), Rb=(-0.30, 0.80, -0.50),
                   L=(-0.02, 0.10, -0.85), Lp=(0.8, 0.5, 0.0), Lb=(0.30, 0.80, -0.50),
                   feet=_feet(g, dl=(0.0, -0.04, 0.0), dr=(0.0, 0.06, 0.0), pr=-20.0))
    keys = [(0.0, g, "linear"), (0.12, crouch, "out"), (0.26, _sprint(g, 0.8, 0.0), "accel"),
            (anim.IMPACT, _sprint(g, 1.12, 0.0), "out"), (0.62, _sprint(g, 1.0, 1.0), "inout"),
            (0.82, _sprint(g, 1.0, 0.0), "inout"), (1.0, _sprint(g, 1.0, 1.0), "inout")]
    return _clip("cast_a1", 15, keys, impact=anim.IMPACT, lags={"head": 1.0})


def _cast_a2(g) -> anim.Clip:
    """cast_a2 Glint Cut (25 f, impact f10, second cut f16): a crossing X. Anticipation 4 frames (both fists coil to
    the left shoulder), the right knife cuts out to his right at f10 with the shoulders snapping round, the left
    follows at f16 the other way; recovered by f25"""
    coil = _pose(g, dict(hips=(2, 16, 0), spine=(2, 12, 0), chest=(3, 22, 0), head=(0, -14, 0)), (0.0, 0.03, -0.02),
                 R=(0.48, -0.42, 0.02), Rp=(-0.4, 0.3, 0.8), Rb=(0.55, 0.45, 0.70),
                 L=(0.20, -0.20, -0.42), Lp=(0.9, 0.4, -0.2), Lb=(0.40, 0.88, -0.20))
    step = _feet(g, dl=(0.0, -0.09, 0.0))
    cut1 = _pose(g, dict(hips=(5, -18, 0), spine=(5, -14, 0), chest=(6, -22, 0), head=(-2, 14, 0)), (0.0, -0.05, -0.04),
                 R=(-0.60, -0.68, -0.20), Rp=(-0.8, 0.2, -0.5), Rb=(-0.80, -0.45, -0.38),
                 L=(-0.40, -0.40, -0.10), Lp=(0.5, 0.0, -0.8), Lb=(-0.70, 0.55, -0.20), feet=step)
    cut2 = _pose(g, dict(hips=(5, 18, 0), spine=(5, 14, 0), chest=(6, 22, 0), head=(-2, -14, 0)), (0.0, -0.06, -0.045),
                 R=(-0.15, -0.40, -0.55), Rp=(-0.8, 0.5, -0.3), Rb=(-0.55, 0.70, -0.45),
                 L=(0.62, -0.66, -0.22), Lp=(0.8, 0.2, -0.5), Lb=(0.80, -0.45, -0.38), feet=step)
    fol = anim.lerp_pose(cut2, g, 0.35)
    keys = [(0.0, g, "linear"), (0.16, coil, "inout"), (0.26, anim.lerp_pose(coil, cut1, 0.12), "out"),
            (anim.IMPACT, cut1, "accel"), (0.50, anim.lerp_pose(cut1, cut2, 0.25), "inout"), (0.64, cut2, "accel"),
            (0.76, fol, "out"), (1.0, g, "settle")]
    return _clip("cast_a2", 25, keys, impact=anim.IMPACT, lags={"head": 1.5, "neck": 1.0})


def _cast_a3(g) -> anim.Clip:
    """cast_a3 Feint (20 f, impact f8, castTime 0; in game it plays at its own pace from frame 0 across the ~0.29 s
    spring, the unit turned to where it springs): a 2-frame head fake (the right shoulder dips into a false lunge),
    the push-off, a long bound away: the body arched back, chin up, the left knee tucked and the right leg trailing,
    both arms swept wide and back with the knives up behind as two wings (the apex f5); the touchdown at f8 (the
    impact: the track is laid) on a bent front knee, the wings still open; the guard by f20"""
    fake = _pose(g, dict(hips=(12, 14, -2), spine=(10, 10, -6), chest=(10, 12, -8), neck=(-6, -6, 0), head=(-8, -8, 0)),
                 (0.02, -0.08, -0.07),
                 R=(0.14, -0.88, -0.42), Rp=(-0.8, 0.4, -0.5), Rb=(0.15, -0.45, -0.88),
                 L=(-0.06, -0.48, -0.56), feet=_feet(g, dl=(0.0, -0.06, 0.0), pr=-14.0))
    push = _pose(g, dict(hips=(-2, 4, 0), spine=(-4, 2, 0), chest=(-6, 0, 0), neck=(4, 0, 0), head=(4, 0, 0)),
                 (0.0, -0.04, 0.03),
                 R=(-0.50, 0.12, -0.32), Rp=(-0.4, 0.8, -0.4), Rb=(-0.55, 0.80, 0.10),
                 L=(0.50, 0.12, -0.32), Lp=(0.4, 0.8, -0.4), Lb=(0.55, 0.80, 0.10),
                 feet=_feet(g, dl=(0.0, -0.06, 0.06), dr=(0.0, 0.08, 0.02), pl=-10.0, pr=-42.0))
    apex = _pose(g, dict(hips=(-10, 0, 0), spine=(-12, 0, 0), chest=(-12, 0, 0), neck=(8, 0, 0), head=(4, 0, 0)),
                 (0.0, 0.0, 0.20),
                 R=(-0.60, 0.55, -0.12), Rp=(-0.3, 0.3, -0.9), Rb=(-0.55, 0.45, 0.70),
                 L=(0.60, 0.55, -0.10), Lp=(0.3, 0.3, -0.9), Lb=(0.55, 0.45, 0.70),
                 feet={"foot.L": FootTarget(tuple(np.array(g["ik"]["foot.L"].ankle) + (0.02, -0.16, 0.42)), 20.0, -4.0),
                       "foot.R": FootTarget(tuple(np.array(g["ik"]["foot.R"].ankle) + (0.0, 0.30, 0.30)), -55.0, -20.0)})
    touch = _pose(g, dict(hips=(10, 0, 0), spine=(2, 0, 0), chest=(-2, 0, 0), neck=(-2, 0, 0), head=(-4, 0, 0)), (0.0, -0.04, -0.10),
                  R=(-0.55, 0.40, -0.25), Rp=(-0.6, 0.5, -0.5), Rb=(-0.60, 0.55, 0.45),
                  L=(0.55, 0.40, -0.24), Lp=(0.6, 0.5, -0.5), Lb=(0.60, 0.55, 0.45),
                  feet=_feet(g, dl=(0.0, -0.08, 0.0), dr=(0.0, 0.18, 0.06), pr=-40.0))
    land = _pose(g, dict(hips=(16, 0, 0), spine=(8, 0, 0), chest=(4, 0, 0), neck=(-8, 0, 0), head=(-8, 0, 0)), (0.0, 0.0, -0.15),
                 R=(-0.38, -0.40, -0.50), Rp=(-0.8, 0.4, -0.3), Rb=(-0.45, 0.80, -0.40),
                 L=(0.38, -0.42, -0.50), Lp=(0.8, 0.4, -0.3), Lb=(0.45, 0.80, -0.40),
                 feet=_feet(g, dl=(0.0, -0.04, 0.0), dr=(0.0, 0.06, 0.0)))
    keys = [(0.0, g, "linear"), (0.08, fake, "out"), (0.16, push, "inout"), (0.27, apex, "out"),
            (anim.IMPACT, touch, "in"), (0.56, land, "out"), (0.78, anim.lerp_pose(land, g, 0.6), "inout"), (1.0, g, "settle")]
    return _clip("cast_a3", 20, keys, impact=anim.IMPACT, lags={"head": 1.0})


def _cast_ult(g) -> anim.Clip:
    """cast_ult Long Glint (35 f, impact f14, castTime 0.2): a still coil, knees low, both knives crossed at the chest
    pointing back, the head down, the shoulders breathing (f0-f12); the burst at f14: full extension, the body near
    horizontal, both knives forward and low, one each side of the line; the skid held, then up"""
    coil = _pose(g, dict(hips=(16, 0, 0), spine=(10, 0, 0), chest=(8, 0, 0), neck=(10, 0, 0), head=(14, 0, 0)), (0.0, 0.04, -0.15),
                 R=(0.52, -0.45, -0.22), Rp=(-0.6, 0.2, -0.7), Rb=(0.45, 0.85, 0.25),
                 L=(-0.52, -0.43, -0.20), Lp=(0.6, 0.2, -0.7), Lb=(-0.45, 0.85, 0.25),
                 feet=_feet(g, dl=(0.02, -0.04, 0.0), dr=(-0.02, 0.06, 0.0)))
    coil2 = anim.add(coil, anim.P(hips=(3, 0, 0), spine=(2, 0, 0), chest=(2, 0, 0)))
    coil2["hips_loc"] = (coil["hips_loc"][0], coil["hips_loc"][1], coil["hips_loc"][2] - 0.025)
    burst = _ult_burst(g)
    skid = anim.lerp_pose(burst, g, 0.15)
    keys = [(0.0, g, "linear"), (0.10, coil, "inout"), (0.32, coil2, "sine"), (anim.IMPACT, burst, "snap"),
            (0.74, skid, "linear"), (0.88, anim.lerp_pose(burst, g, 0.65), "inout"), (1.0, g, "settle")]
    base = anim.keyed(keys)

    def sample(t):
        p = base(t)
        if t < 0.36:                       # the held coil breathes (never a freeze)
            p = anim.add(p, anim.P(chest=(1.6 * anim.osc(t, 2.5), 0, 0), shoulder_L=(0, 0, 2.0 * anim.osc(t, 2.5)),
                                   shoulder_R=(0, 0, -2.0 * anim.osc(t, 2.5))))
        return p
    return anim.Clip("cast_ult", 35, False, anim.drag(sample, 35, {"head": 1.0}), impact=anim.IMPACT)


def _stunned(g) -> anim.Clip:
    """stunned (40 f loop): knocked back onto his heels (toes up), the chest arched back and the hips pushed out, the
    arms flung loose and wide for balance with the knives dangling, the head lolling round; he stumbles back a step
    on each foot and catches himself (fix pass 4, review: it read as the idle)"""
    base = _pose(g, dict(hips=(-14, 0, 0), spine=(-10, 0, 0), chest=(-10, 0, 0), neck=(10, 0, 0), head=(16, 0, 0)),
                 (0.0, 0.10, -0.05),
                 R=(-0.42, -0.10, -0.70), Rp=(-0.9, 0.3, 0.2), Rb=(-0.30, 0.10, -0.95),
                 L=(0.42, -0.12, -0.68), Lp=(0.9, 0.3, 0.2), Lb=(0.30, 0.10, -0.95),
                 feet=_feet(g, dl=(0.02, -0.02, 0.0), dr=(-0.02, 0.04, 0.0), pl=16.0, pr=14.0))

    def sample(t):
        a, b = anim.osc(t, 1), anim.osc(t, 1, 0.25)
        c = anim.osc(t, 2, 0.1)
        p = anim.add(base, anim.P(hips=(3 * c, 6 * a, 5 * b), spine=(3 * c, 0, -4 * a), chest=(4 * c, 0, -5 * a),
                                  neck=(6 * b, 8 * a, 8 * a), head=(8 * b, 10 * a, 10 * a),
                                  shoulder_L=(0, 0, 4 * c), shoulder_R=(0, 0, -4 * c)))
        ik = dict(p["ik"])
        # the stumble: each foot in turn lifts and plants a step further back (toes up, on the heel), then slides home
        sl = max(0.0, math.sin(2 * math.pi * t))           # left foot's step (first half)
        sr = max(0.0, -math.sin(2 * math.pi * t))          # right foot's step (second half)
        ik.update(_feet(g, dl=(0.02, -0.02 + 0.07 * sl, 0.05 * sl ** 2), dr=(-0.02, 0.04 + 0.07 * sr, 0.05 * sr ** 2),
                        pl=16.0 + 8 * sl, pr=14.0 + 8 * sr))
        for side, sx, ph in (("R", -1.0, 0.0), ("L", 1.0, 0.5)):          # the loose arms flail for balance
            h = ik[f"hand.{side}"]
            w = anim.osc(t, 1, ph)
            ik[f"hand.{side}"] = HandTarget(rel=(h.rel[0] + sx * 0.08 * w, h.rel[1] - 0.06 * w, h.rel[2] + 0.10 * max(0.0, w)),
                                            pole=h.pole)
        p["ik"] = ik
        hx, hy, hz = base["hips_loc"]
        p["hips_loc"] = (hx + 0.03 * a, hy + 0.03 * (sl + sr), hz - 0.015 * (sl + sr))
        return p
    return anim.Clip("stunned", 40, True, sample)


def _recall(g) -> anim.Clip:
    """recall (60 f loop): he presses the two knives together before his chest, points down, and bows his head; the
    weight settles, the shoulders breathe"""
    base = _pose(g, dict(hips=(2, 6, 0), spine=(4, 0, 0), chest=(6, 0, 0), neck=(14, 0, 0), head=(16, 0, 0)), (0.0, 0.02, -0.03),
                 R=(0.40, -0.58, -0.30), Rp=(-0.8, 0.2, -0.6), Rb=(0.04, -0.20, -0.98),
                 L=(-0.40, -0.58, -0.28), Lp=(0.8, 0.2, -0.6), Lb=(-0.04, -0.20, -0.98),
                 feet=_feet(g, dl=(-0.02, 0.08, 0.0), dr=(0.02, -0.06, 0.0), yr=-14.0))

    def sample(t):
        b = anim.osc(t, 2)
        return anim.add(base, anim.P(chest=(1.5 * b, 0, 0), neck=(-0.8 * b, 0, 0), shoulder_L=(0, 0, 1.6 * b),
                                     shoulder_R=(0, 0, -1.6 * b)))
    return anim.Clip("recall", 60, True, sample)


def _channel(g) -> anim.Clip:
    base = _pose(g, dict(spine=(3, 0, 0), chest=(4, 0, 0), head=(4, 0, 0)), R=(0.30, -0.62, -0.30), Rb=(0.1, -0.3, -0.95),
                 L=(-0.30, -0.62, -0.30), Lb=(-0.1, -0.3, -0.95))
    return anim.Clip("channel", 40, True, lambda t: anim.add(base, anim.P(chest=(1.4 * anim.osc(t, 2), 0, 0))))


def _death(g, skel) -> anim.Clip:
    """death (45 f): hit, a spin on the right heel, and a fall onto his back with the knives flung wide; ends at rest"""
    hip_h = skel.rest_point("hips").z
    recoil = _pose(g, dict(hips=(-4, 16, 0), spine=(-8, 8, 0), chest=(-12, 10, 0), neck=(-8, 0, 0), head=(-14, 12, 0)),
                   (0.0, 0.04, -0.06), R=(-0.40, -0.20, -0.60), Rb=(-0.8, 0.2, -0.5), L=(0.55, -0.30, -0.25), Lb=(0.8, 0.3, 0.4))
    spin = anim.merge(anim.arms_relaxed(), anim.P(hips=(-30, 110, -6), spine=(-10, 10, 0), chest=(-8, 10, 0), neck=(0, 0, 0),
                                                  head=(10, 12, 0), thigh_L=(40, 0, -10), shin_L=(-70, 0, 0),
                                                  thigh_R=(20, 0, 10), shin_R=(-40, 0, 0),
                                                  upper_arm_R=(10, -10, 40), forearm_R=(30, 0, 0),
                                                  upper_arm_L=(10, 10, -40), forearm_L=(30, 0, 0)))
    spin["hips_loc"] = (0.02, 0.16, -hip_h * 0.48)
    # the feet stay planted through the spin (the knees fold under the dropping hips: no straight-legged pivot)
    spin["ik"] = _feet(g, dl=(0.02, -0.02, 0.0), dr=(0.0, 0.04, 0.0), yl=20.0, yr=-60.0, pl=10.0, pr=16.0)
    down = anim.merge(anim.arms_relaxed(), anim.P(hips=(-86, 160, 0), spine=(-4, 0, 0), chest=(-4, 0, 0), neck=(8, 0, 0),
                                                  head=(10, -16, 0), thigh_L=(30, 0, -18), shin_L=(-60, 0, 0),
                                                  thigh_R=(10, 0, 12), shin_R=(-12, 0, 0), foot_R=(20, 0, 0),
                                                  upper_arm_R=(4, -14, -12), forearm_R=(58, 0, 0),
                                                  upper_arm_L=(-20, 0, 52), forearm_L=(32, 0, 0)))
    # (fix pass 5, review: a stiff spread-eagle, both arms rigid and horizontal): the right arm folded across his
    # body with its knife over the hip, the left flung up past the head with the elbow bent, the knife loose
    down["hips_loc"] = (0.04, 0.40, -hip_h + 0.12)
    down["ik"] = {"aim.R": _blade((-0.55, -0.80, 0.0)), "aim.L": _blade((0.80, -0.55, 0.0))}   # the knives flat on the ground
    bounce = anim.add(down, anim.P(spine=(6, 0, 0), chest=(6, 0, 0), head=(8, 0, 0)))
    bounce["hips_loc"] = (0.04, 0.40, -hip_h + 0.15)
    rest = anim.add(down, anim.P(head=(0, -8, 0), shin_L=(8, 0, 0)))
    rest["hips_loc"] = (0.04, 0.40, -hip_h + 0.115)
    # the knees go first (the first pass tipped him back stiff on planted feet like a plank): the hips drop and the
    # torso curls round the hit before the spin
    buckle = _pose(g, dict(hips=(6, 45, -4), spine=(10, 12, 0), chest=(12, 10, 0), neck=(6, 0, 0), head=(4, 14, 0)),
                   (0.03, 0.08, -0.20), R=(-0.45, -0.10, -0.70), Rb=(-0.8, 0.3, -0.5), L=(0.50, -0.20, -0.45),
                   Lb=(0.8, 0.3, 0.2), feet=_feet(g, yr=-36.0, pr=12.0))
    keys = [(0.0, g, "linear"), (0.10, recoil, "snap"), (0.24, buckle, "inout"), (0.42, spin, "in"), (0.64, down, "in"),
            (0.72, bounce, "out"), (0.84, rest, "inout"), (1.0, rest, "linear")]
    return _clip("death", 45, keys)


def _lobby(g) -> anim.Clip:
    """idle_lobby (90 f loop): restless: bouncing on his toes, the right knife flipped once round his fingers (f18-f34),
    a glance back over his shoulder (f40-f58), two taps of the left boot (f60-f74), a neck roll that swings the crest;
    the left hand on his hip"""
    N = 90
    base = _pose(g, dict(hips=(-3, 4, 0), spine=(-2, 0, 0), chest=(-2, 0, 0), neck=(2, 0, 0), head=(2, 0, 0)), (0.0, 0.04, 0.035),
                 R=(0.10, -0.55, -0.50), Rp=(-0.8, 0.4, -0.4), Rb=(-0.25, 0.80, -0.55),
                 L=(0.25, 0.05, -0.75), Lp=(0.9, -0.1, 0.1), Lb=(0.30, 0.60, -0.75),
                 feet=_feet(g, dl=(-0.02, 0.09, 0.0), dr=(0.02, -0.10, 0.0), yr=-10.0))
    flip = [(-0.25, 0.80, -0.55), (0.10, -0.40, -0.91), (0.15, -0.95, 0.27), (0.05, 0.10, 0.99), (-0.25, 0.80, 0.55),
            (-0.25, 0.80, -0.55)]

    def flip_dir(t):
        u = (t - 0.20) / 0.18
        if u <= 0 or u >= 1:
            return flip[0]
        f = u * (len(flip) - 1)
        i = min(len(flip) - 2, int(f))
        w = f - i
        a, b = np.array(flip[i]), np.array(flip[i + 1])
        v = a * (1 - w) + b * w
        return tuple(v / np.linalg.norm(v))

    def sample(t):
        # (fix pass 4, review: little of the bounce or the glance showed): a springy bounce up onto the balls of both
        # feet (heels up 20 degrees, the hips rising 4 cm) that pauses for the glance, and the glance itself a full look
        # back over the right shoulder (hips, chest, neck and head together, ~95 degrees)
        look = math.sin(math.pi * min(1.0, max(0.0, (t - 0.42) / 0.22))) ** 2
        bounce = abs(math.sin(2 * math.pi * 3 * t)) * (1.0 - 0.85 * look)
        roll = math.sin(2 * math.pi * min(1.0, max(0.0, (t - 0.84) / 0.16)))
        p = anim.add(base, anim.P(hips=(0, -12 * look, 0), neck=(4 * roll, -20 * look, 6 * roll),
                                  head=(3 * roll - 6 * look, -40 * look, 8 * roll),
                                  chest=(1.2 * anim.osc(t, 3) - 3 * bounce, -16 * look, 0), spine=(0, -8 * look, 0)))
        ik = dict(p["ik"])
        ik["aim.R"] = _blade(flip_dir(t))
        tap = max(0.0, math.sin(2 * math.pi * min(1.0, max(0.0, (t - 0.66) / 0.16)) * 2)) if 0.66 < t < 0.82 else 0.0
        fl = ik["foot.L"]
        ik["foot.L"] = FootTarget((fl.ankle[0], fl.ankle[1], fl.ankle[2] + 0.04 * tap), -20.0 * bounce - 14.0 * tap, fl.yaw)
        fr = ik["foot.R"]
        ik["foot.R"] = FootTarget(fr.ankle, -20.0 * bounce, fr.yaw)
        p["ik"] = ik
        hx, hy, hz = base["hips_loc"]
        p["hips_loc"] = (hx, hy, hz + 0.040 * bounce)
        return p
    return anim.Clip("idle_lobby", N, True, sample)


def _victory(g) -> anim.Clip:
    """victory (60 f, the final pose from f45 held): a skid to a stop dropping onto his right knee, the right knife's
    glass tip drawing a short line on the ground, up, one flick of the knife; the hold: arms crossed behind him,
    the knives pointing back, chin up, turned a quarter away"""
    hip_h = 0.93
    skid = _pose(g, dict(hips=(14, 0, 0), spine=(6, 0, 0), chest=(2, 0, 0), neck=(-8, 0, 0), head=(-6, 0, 0)), (0.0, 0.02, -0.10),
                 R=(0.05, 0.25, -0.80), Rb=(-0.3, 0.8, -0.5), L=(-0.05, 0.25, -0.80), Lb=(0.3, 0.8, -0.5),
                 feet=_feet(g, dl=(0.0, -0.18, 0.0), dr=(0.0, 0.16, 0.0), pr=-30.0))
    kneel = _pose(g, dict(hips=(18, -10, 0), spine=(12, 0, 0), chest=(14, 0, 0), neck=(6, 0, 0), head=(14, 0, 0)), (0.0, 0.06, -hip_h * 0.40),
                  R=(0.10, -0.80, -0.50), Rp=(-0.9, 0.3, -0.2), Rb=(0.05, -0.80, -0.60),
                  L=(-0.10, -0.55, -0.70), Lp=(0.9, 0.3, -0.2), Lb=(0.30, 0.70, -0.60),
                  feet=_feet(g, dl=(0.0, -0.12, 0.0), dr=(0.0, 0.22, 0.06), pr=-62.0))
    draw = _pose(g, dict(hips=(18, -16, 0), spine=(12, -6, 0), chest=(14, -8, 0), neck=(6, 0, 0), head=(16, 10, 0)), (0.0, 0.06, -hip_h * 0.40),
                 R=(-0.30, -0.70, -0.50), Rp=(-0.9, 0.3, -0.2), Rb=(-0.30, -0.72, -0.62),
                 L=(-0.10, -0.55, -0.70), Lb=(0.30, 0.70, -0.60), feet=_feet(g, dl=(0.0, -0.12, 0.0), dr=(0.0, 0.22, 0.06), pr=-62.0))
    up = _pose(g, dict(hips=(-2, 0, 0), spine=(-2, 0, 0), chest=(-2, 0, 0), neck=(0, 0, 0), head=(-2, 0, 0)), (0.0, 0.02, 0.03),
               R=(-0.30, -0.60, -0.20), Rp=(-0.9, 0.3, -0.2), Rb=(-0.6, -0.4, 0.69), L=(-0.05, -0.40, -0.70))
    flick = _pose(g, dict(hips=(-2, 0, 0), spine=(-2, 0, 0), chest=(-2, 0, 0), head=(-2, 0, 0)), (0.0, 0.02, 0.03),
                  R=(-0.40, -0.55, -0.30), Rb=(-0.5, 0.75, -0.43), L=(-0.05, -0.40, -0.70))
    # (the head turns a quarter away to his right, chin up: from the splash camera on his left the visor's beak points
    # into the frame and the crest arc and both glass fins show in profile; the first pass turned it toward the camera,
    # the crest edge-on and the fins hidden behind the helm)
    # (fix pass 4, review: the hold read as a frontal stand with the knives at the hips): the whole body turned ~45
    # degrees away to his right (hips, chest and the planted feet), chest up and chin raised, both wrists crossed in the
    # small of his back with the elbows out like folded wings, the two blades jutting back and up past the hips in an X
    hold = _pose(g, dict(hips=(-6, -42, 0), spine=(-8, -10, 0), chest=(-10, -10, 0), neck=(-8, 8, 0), head=(-16, 12, 0)), (0.0, 0.05, 0.04),
                 R=(0.42, 0.46, -0.52), Rp=(-0.9, 0.6, 0.1), Rb=(0.12, 0.95, 0.28),
                 L=(-0.42, 0.46, -0.50), Lp=(0.9, 0.6, 0.1), Lb=(-0.12, 0.95, 0.28),
                 feet=_feet(g, dl=(0.14, 0.08, 0.0), dr=(-0.10, -0.10, 0.0), yr=-70.0, yl=-46.0))
    keys = [(0.0, g, "linear"), (0.08, skid, "out"), (0.22, kneel, "inout"), (0.36, draw, "inout"), (0.50, up, "inout"),
            (0.60, flick, "snap"), (0.75, hold, "inout"), (1.0, hold, "linear")]
    base = anim.keyed(keys)

    def sample(t):
        p = base(t)
        if t > 0.75:
            k = min(1.0, (t - 0.75) / 0.1)
            p = anim.add(p, anim.P(chest=(1.0 * k * anim.osc(t, 1.5), 0, 0)))
        return p
    return anim.Clip("victory", 60, False, anim.drag(sample, 60, {"head": 1.5, "neck": 1.0}))


def _taunt(g) -> anim.Clip:
    """taunt (40 f loop): he tosses the right knife up, it spins, he catches it reversed (the hand follows the arc)"""
    base = _pose(g, dict(hips=(-2, 6, 0), chest=(-3, 4, 0), head=(-4, 0, 0)), (0.0, 0.03, 0.03),
                 R=(0.10, -0.55, -0.40), Rb=(-0.25, 0.80, -0.55))
    seq = [(0.0, (0.10, -0.55, -0.40), (-0.25, 0.80, -0.55)), (0.2, (0.10, -0.60, 0.05), (0.05, -0.30, 0.95)),
           (0.4, (0.05, -0.55, 0.30), (0.10, 0.90, 0.40)), (0.6, (0.08, -0.62, 0.10), (0.05, 0.10, -0.99)),
           (0.8, (0.10, -0.55, -0.30), (-0.20, 0.70, -0.68)), (1.0, (0.10, -0.55, -0.40), (-0.25, 0.80, -0.55))]

    def sample(t):
        for i in range(1, len(seq)):
            if t <= seq[i][0]:
                a, b = seq[i - 1], seq[i]
                w = anim.sine((t - a[0]) / (b[0] - a[0]))
                r = tuple(a[1][j] + (b[1][j] - a[1][j]) * w for j in range(3))
                d = np.array(a[2]) * (1 - w) + np.array(b[2]) * w
                break
        p = anim.add(base, anim.P(head=(-6 * math.sin(math.pi * t), 0, 0)))
        ik = dict(p["ik"])
        ik["hand.R"] = HandTarget(rel=r, pole=(-0.8, 0.4, -0.3))
        ik["aim.R"] = _blade(d / np.linalg.norm(d))
        p["ik"] = ik
        return p
    return anim.Clip("taunt", 40, True, sample)


def _splash_hero(g) -> anim.Clip:
    """the splash only (never shipped: _install_render adds it to the hero renders' clip set): the runner exploding out
    of his guard toward the camera's side, a long low lunge onto the bent left leg with the right leg driving straight
    behind, the chest leaning in and turned to the camera, chin up; the right fist cocked high behind with its blade
    swept back over the shoulder like a wing, the left fist punched forward low with its blade reversed along the
    forearm: the crest, the left spike and both knives make one comb of backward diagonals
    (fix pass 4, review: Glint Cut's second cut read as a casual knock-kneed stand with a hand on the hip)
    (fix pass 5, review: the raised right knife read as a forward grip, blade up out of the fist): the right fist
    swept low behind the hip with its reversed blade trailing back from the little finger"""
    hero = _pose(g, dict(hips=(16, 14, 0), spine=(8, 8, 0), chest=(6, 10, 0), neck=(-16, -6, 0), head=(-22, -8, 0)),
                 (0.0, -0.12, -0.23),
                 R=(-0.34, 0.50, -0.52), Rp=(-0.8, 0.5, 0.1), Rb=(-0.25, 0.80, 0.30),
                 L=(0.14, -0.70, -0.56), Lp=(0.9, 0.3, -0.3), Lb=(0.30, 0.90, 0.10),
                 feet=_feet(g, dl=(0.07, -0.30, 0.0), dr=(-0.06, 0.42, 0.0), pr=-48.0, yl=6.0, yr=-14.0))
    return anim.Clip("splash_hero", 10, False, lambda t: hero)


def clip_overrides(ctx) -> dict:
    skel = anim.Skeleton(ctx.info.armature)
    g = _guard()
    _GUARD["pose"] = g
    return {"idle": _idle(g), "run": _run(), "attack1": _attack1(g), "attack2": _attack2(g), "crit": _crit(g),
            "cast_a1": _cast_a1(g), "cast_a2": _cast_a2(g), "cast_a3": _cast_a3(g), "cast_ult": _cast_ult(g),
            "dash": _dash(g), "stunned": _stunned(g), "recall": _recall(g), "channel": _channel(g),
            "death": _death(g, skel), "idle_lobby": _lobby(g), "victory": _victory(g), "taunt": _taunt(g)}


_GUARD: dict = {}

if __name__ == "__main__":
    fighter.main(sys.modules[__name__])
