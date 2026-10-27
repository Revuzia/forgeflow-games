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
SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92, "yaw": 22.0, "pitch": -1.0, "fill": 0.80, "x": 0.64,
          "sun": 2.4, "rim_cool": 0.6, "rim_warm": 0.6, "portrait_yaw": 18.0, "icon_yaw": 14.0}
HERO_SPEC = 0.15
HERO_FILL = 0.6
HERO_SAMPLES = 2.0        # hero render samples x this, and the nlmeans denoise strength x HERO_DENOISE (grain)
HERO_DENOISE = 1.4
TEXTURE_SIZE = 2048
TEXTURE_SIZES = {"normal": 512, "orm": 512}
GLB_COMPRESS = True
ARMOUR_CONFORM = False
AO_INTO_BASE = 0.25
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
     "parts": {"apron": "#474D56", "sleeves": "#5B626C", "chest_plate": "#747B86", "cowl": "#C9C9C1",
               "pauldron_L": "#98A0AA", "lames_L": "#98A0AA", "pauldron_R": "#98A0AA"},
     "palette": {"chalk": "#A7A9AC", "stone": "#BAC0C6", "cloth2": "#C9C9C1", "cloth": "#535A64", "ironstone": "#3A3F47",
                 "under": "#2E3238", "leather": "#34383F", "linework": "#E6E0D2"}},
    # Lamplit Visor: smoked lampresin glass and walnut armour from the evening side, a small lamp cage on the crest's
    # front horn (four carved slats round a lampresin bead, 7 cm, duller than the accent ridge)
    # (the painting's cowl and sleeves are pale blue linen: their mean moves onto the warm scarf colour, `absolute`)
    {"id": "rishal_lamplit", "extra": {"lamp_cage": True}, "card": {"primary": "#4A4036", "secondary": "#A38C6B"},
     "absolute": ("cloth2",),
     "parts": {"cowl": "#C4B6A0"},          # (review: the cowl blew out near white: the scarf a step down, L* 74)
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

    def __init__(self, a, m, b, side, width, thick, n=24):
        self.a, self.m, self.b = (np.asarray(x, dtype=np.float64) for x in (a, m, b))
        self.side = unit(side)
        self.width, self.thick, self.n = width, thick, n
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

    def __init__(self, name, bands, axis, width=0.013, thick=0.0045, segs=18):
        self.name, self.bands, self.axis = name, bands, unit(axis)
        self.width, self.thick, self.segs = width, thick, segs

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
            for i in range(self.segs):
                t = 2 * math.pi * i / self.segs
                p = np.asarray(c) + e1 * rx * math.cos(t) + e2 * ry * math.sin(t)
                o = unit(e1 * math.cos(t) / rx + e2 * math.sin(t) / ry)          # the ellipse's outward normal
                for dr, dw in ((-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)):
                    V.append(p + o * (dr * self.thick + 0.5 * self.thick) + n * dw * self.width)
            for i in range(self.segs):
                j = (i + 1) % self.segs
                a_, b_ = base + 4 * i, base + 4 * j
                Q.append((a_ + 0, b_ + 0, b_ + 1, a_ + 1))       # lower edge
                Q.append((a_ + 1, b_ + 1, b_ + 2, a_ + 2))       # outer face
                Q.append((a_ + 2, b_ + 2, b_ + 3, a_ + 3))       # upper edge
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


# the visor blade (rest pose, head space facing -Y): an ellipsoid shell `thick` deep, clipped by the side profile
# VISOR_PROF (u = back +Y, v = up) and a front V (z >= v0.z + vslope |x|)
VISOR = {"c": np.array([0.0, -0.014, 1.632]), "r": (0.110, 0.136, 0.118), "tilt": -10.0, "thick": 0.012,
         "v0": (0.0, 0.0, 1.522), "vslope": 1.05}
VISOR_PROF = smooth_poly([(-0.170, 1.708), (-0.120, 1.712), (-0.070, 1.722), (-0.020, 1.736), (0.015, 1.742),
                          (0.030, 1.725), (0.010, 1.690), (-0.025, 1.650), (-0.060, 1.622), (-0.090, 1.592),
                          (-0.112, 1.548), (-0.130, 1.505), (-0.165, 1.540), (-0.180, 1.620)], n=5)
# the accent ridge rides the visor's top edge, where the glass meets the dome (measured: front z 1.712, x +-0.05 at
# 1.700, x +-0.08 at 1.685), half on the glass, half on the chalk
RIDGE_PTS = [(-0.098, -0.036, 1.680), (-0.084, -0.070, 1.692), (-0.052, -0.096, 1.707), (0.0, -0.107, 1.718),
             (0.052, -0.096, 1.707), (0.084, -0.070, 1.692), (0.098, -0.036, 1.680)]
# the two swept glass fins on the left of the dome: (root, tip, bow, half-width, tilt)
FINS = (((0.074, 0.028, 1.682), (0.172, 0.405, 1.895), -0.012, 0.029, 0.55),
        ((0.086, 0.052, 1.648), (0.150, 0.280, 1.716), -0.004, 0.024, 0.65))
# carved lines of the face-plate (centre lines, radius): the cut mouth, two cheek lines a side, the chin cleft
FACE_LINES = [([(-0.022, -0.104, 1.541), (0.0, -0.107, 1.538), (0.022, -0.104, 1.541)], 0.0030),
              ([(0.0, -0.101, 1.522), (0.0, -0.095, 1.504)], 0.0024)]
for _sx in (-1.0, 1.0):            # one long curved line down each cheek, from under the glass round to the jaw
    FACE_LINES.append(([(_sx * 0.052, -0.090, 1.604), (_sx * 0.056, -0.087, 1.578), (_sx * 0.048, -0.088, 1.550),
                        (_sx * 0.030, -0.092, 1.522)], 0.0026))

# the game mesh budget per part (decimation targets; GLB <= 1172 KiB with the 2048 painted atlas and 17 clips)
TRIS = {"helm": 900, "face": 650, "visor": 800, "crest": 460, "crest_glass": 360, "crest_ribs": 120, "fins": 480,
        "neck": 300, "cowl": 800, "torso": 900, "chest_plate": 560, "straps": 360, "medallion": 160,
        "medallion_glass": 60, "belt": 500, "buckle": 200, "skirt_R": 620, "skirt_L": 620, "apron": 400,
        "sleeves": 700, "bracer_R": 460, "bracer_L": 460, "hand_R": 560, "hand_L": 560, "pauldron_R": 480,
        "pauldron_L": 500, "lames_L": 900, "trousers": 1200, "knee_R": 260, "knee_L": 260, "greave_R": 340,
        "greave_L": 340, "calfwrap_R": 240, "calfwrap_L": 240, "boots": 800, "knife_grip_R": 160, "knife_grip_L": 160,
        "knife_guard_R": 80, "knife_guard_L": 80, "knife_blade_R": 300, "knife_blade_L": 300}
# atlas share (texel weight): the helmet and the chest the camera reads, less on the hidden and the procedural parts
UV_WEIGHT = {"helm": 1.6, "face": 1.6, "visor": 1.5, "crest": 1.4, "fins": 1.2, "chest_plate": 1.3, "cowl": 1.2,
             "lames_L": 1.2, "pauldron_L": 1.2, "boots": 0.6, "knife_blade_R": 0.5, "knife_blade_L": 0.5,
             "knife_grip_R": 0.4, "knife_grip_L": 0.4, "knife_guard_R": 0.4, "knife_guard_L": 0.4, "trousers": 0.8,
             "calfwrap_R": 0.7, "calfwrap_L": 0.7}


def sculpts() -> list:
    """(name, Sculpt, voxel scale, material role, bind, tris) in build order."""
    out = []
    J = layout()

    def part(name, S, role, bind, tris, vs=1.0):
        out.append((name, S, vs, role, bind, TRIS.get(name, tris)))

    # ── HELMET (rigid on the head; head space = the rest pose, facing -Y). The concept's head: a chalk dome with a
    # nape guard, a carved jaw / cheek plate, a dawnglass VISOR that wraps the eyes and runs on forward and down into a
    # beak before the chin (the facing cue), the CREST: a stone crescent standing on the dome from the brow, flying
    # back off the crown into a tip behind the head (glass panes in the stone frame = the accent), and two swept
    # glass blades from the left of the dome, back and up (38 / 30 cm)
    F_mid = np.array([[0.0, 1.0, 0.0], [0.0, 0.0, 1.0], [1.0, 0.0, 0.0]])        # u = back (+Y), v = up, n = +X
    helm = Sculpt("helm")
    helm.add(Ellipsoid((0, 0.004, 1.665), (0.094, 0.100, 0.125)).displaced(chips(0.0025, 7.0), 0.0025), k=0.0)
    helm.add(Ellipsoid((0, 0.040, 1.585), (0.080, 0.070, 0.066)), k=0.04)                      # the nape guard
    helm.add(RoundBox((0, 0.066, 1.548), (0.058, 0.022, 0.032), 0.016, axes=sdf.rot_x(-20)), k=0.03)
    for sx in (-1, 1):                                                                           # cheek guards
        helm.add(RoundBox((sx * 0.080, -0.006, 1.592), (0.018, 0.050, 0.058), 0.014, axes=sdf.rot_z(sx * -12)), k=0.02)
    helm.sub(Torus((0, 0.040, 1.640), 0.100, 0.0032, axes=sdf.rot_x(70)), k=0.002)                # a carved seam
    part("helm", helm, "chalk", "bone:head", 1100)
    # the carved chalk face-plate under the glass (the concept's: a long mask, carved cheek lines, a cut mouth, the
    # long chin): FACE_LINES are carved into the form and inked by face_paint
    face = Sculpt("face")
    face.add(Ellipsoid((0, -0.040, 1.588), (0.070, 0.074, 0.086)), k=0.0)
    face.add(RoundCone((0, -0.066, 1.570), (0, -0.080, 1.506), 0.040, 0.017), k=0.03)          # the long chin
    for sx in (-1, 1):                                                                           # cheekbones
        face.add(Ellipsoid((sx * 0.044, -0.088, 1.598), (0.026, 0.020, 0.030), axes=sdf.rot_z(sx * 20)), k=0.012)
    face.add(RoundBox((0, -0.104, 1.585), (0.009, 0.010, 0.030), 0.007), k=0.012)                # the nose ridge
    face.inter(HalfSpace((0, 0.02, 1.6), (0, 1, 0), 0.5), k=0.01)
    for pts, r in FACE_LINES:
        face.sub(Tube(pts, [r] * len(pts)), k=0.0015)
    part("face", face, "chalk", "bone:head", 650, 0.5)
    # the VISOR (the hook): one dawnglass blade across the eyes, standing off the face: its top edge along the brow
    # rising back to a point over each temple, its lower edge running from there along the cheekbones down into the
    # beak, a point before the mouth (the facing cue from above); 1.2 cm thick glass whose cut edges carry the pale
    # rim (visor_paint); the dome shows above it, the carved face below it
    visor = Sculpt("visor")
    vc, VR, vax = VISOR["c"], VISOR["r"], sdf.rot_x(VISOR["tilt"])
    th = VISOR["thick"]
    shell = sdf.Blend([("add", Ellipsoid(vc, VR, axes=vax), 0.0),
                       ("sub", Ellipsoid(vc + (0, 0.003, 0), tuple(x - th for x in VR), axes=vax), 0.0)])
    visor.add(shell, k=0.0)
    visor.inter(Profile((0, 0, 0), F_mid, VISOR_PROF, 0.40, 0.004), k=0.004)
    for sx in (-1, 1):            # from the front: the lower edge a V from the beak up to the cheekbones
        visor.inter(HalfSpace(VISOR["v0"], unit((sx * VISOR["vslope"], 0, -1.0)), 0.5), k=0.005)
    part("visor", visor, "dawnglass", "bone:head", 800, 0.45)
    # the brief's accent fin: a ridge along the visor's top edge, temple to temple, running into the crest's root
    ridge = Sculpt("visor_ridge")
    ridge.add(Tube(RIDGE_PTS, [0.0040, 0.0055, 0.0068, 0.0075, 0.0068, 0.0055, 0.0040], k=0.004), k=0.0)
    part("visor_ridge", ridge, "accent", "bone:head", 180, 0.5)
    # the crest: outer edge from the brow over the crown and back to the tip; inner edge on the dome, lifting off
    # (its front root lands on the ridge at the brow: the first pass ran it on down over the glass like a nose guard)
    crest_poly = smooth_poly([(-0.112, 1.708), (-0.130, 1.742), (-0.112, 1.776), (-0.058, 1.816), (0.020, 1.852),
                              (0.120, 1.874), (0.236, 1.882), (0.180, 1.842), (0.115, 1.818), (0.050, 1.795),
                              (-0.030, 1.758), (-0.068, 1.722), (-0.092, 1.704)], n=5)
    crest = Sculpt("crest")
    crest.add(Profile((0, 0, 0), F_mid, crest_poly, 0.022, 0.006), k=0.0)
    part("crest", crest, "chalk", "bone:head", 560, 0.5)
    glass = Sculpt("crest_glass")
    gpoly = inset(crest_poly, 0.0085)
    glass.add(Profile((0, 0, 0), F_mid, gpoly, 0.028, 0.003), k=0.0)
    glass.inter(HalfSpace((0, -0.120, 1.712), unit((0, -0.6, -1)), 0.5), k=0.003)
    glass.inter(HalfSpace((0, 0.205, 1.87), unit((0, 1, -0.2)), 0.5), k=0.003)
    ribs = Sculpt("crest_ribs")
    for (u0, v0, u1, v1) in ((-0.128, 1.775, -0.085, 1.745), (-0.010, 1.850, 0.010, 1.785), (0.110, 1.880, 0.110, 1.825)):
        glass.sub(Capsule((0.0, u0, v0), (0.0, u1, v1), 0.0055), k=0.002)
        ribs.add(Capsule((0.0, u0, v0), (0.0, u1, v1), 0.0042), k=0.0)
        ribs.inter(Profile((0, 0, 0), F_mid, crest_poly, 0.034, 0.004), k=0.0)
    part("crest_glass", glass, "accent", "bone:head", 420, 0.45)
    part("crest_ribs", ribs, "chalk", "bone:head", 160, 0.45)
    fins = Sculpt("fins")
    for root, tip, bow, w, tilt in FINS:
        root, tip = np.array(root), np.array(tip)
        mid = (root + tip) / 2 + np.array([0.012, -0.020, bow])
        side = unit(np.cross(tip - root, (1.0, 0.0, -tilt)))

        def width(s_, w=w):
            s_ = np.asarray(s_, dtype=np.float64)
            return w * np.clip(0.50 + 0.85 * np.sin(np.clip(s_, 0, 1) * math.pi * 0.75), 0, 1.25) * np.clip((1 - s_) / 0.32, 0, 1) ** 0.85 + 0.0018

        def thick(s_):
            return 0.0070 * (1.0 - 0.5 * np.asarray(s_, dtype=np.float64)) + 0.0014
        fins.add(Blade(root, mid, tip, side, width, thick, n=16), k=0.006)
    fins.add(Ellipsoid((0.074, 0.034, 1.680), (0.020, 0.040, 0.034), axes=sdf.rot_x(-30)), k=0.012)   # the root boss
    part("fins", fins, "dawnglass", "bone:head", 600, 0.5)

    # ── NECK + COWL ──────────────────────────────────────────────────────────────────────────────────────────
    neck = Sculpt("neck")
    neck.add(FlatCapsule((0, 0.012, 1.41), (0, 0.000, 1.585), 0.050, 0.046, 0.040, 0.040, side=(1, 0, 0)).displaced(
        folds(0.002, 60.0, axis=0), 0.002), k=0.0)
    part("neck", neck, "wood", ("auto_only", "chest", "neck", "head"), 380, 0.7)
    cowl = Sculpt("cowl")
    cowl.add(Torus((0, 0.012, 1.432), 0.072, 0.040, axes=sdf.rot_x(-8), rz=0.034).displaced(folds(0.006, 30.0, axis=2), 0.006), k=0.0)
    cowl.add(Ellipsoid((-0.01, -0.085, 1.385), (0.115, 0.050, 0.065), axes=sdf.rot_x(-12)).displaced(folds(0.007, 28.0, dirv=(0.8, 0, 0.6)), 0.007), k=0.04)
    cowl.add(Ellipsoid((0.0, 0.085, 1.37), (0.150, 0.055, 0.105), axes=sdf.rot_x(12)).displaced(folds(0.008, 22.0, dirv=(1, 0, 0.3)), 0.008), k=0.05)
    for sx in (-1, 1):
        cowl.add(Ellipsoid((sx * 0.105, 0.010, 1.420), (0.085, 0.085, 0.040), axes=sdf.rot_y(sx * 22)), k=0.04)
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
    straps = Sculpt("straps")
    # the crossing chest straps (leather): left shoulder -> right hip and right shoulder -> left ribs, front and back
    straps.add(Tube([(0.13, -0.075, 1.385), (0.04, -0.118, 1.30), (-0.07, -0.118, 1.20), (-0.14, -0.08, 1.115)],
                    [0.010, 0.010, 0.010, 0.010], k=0.01), k=0.0)
    straps.add(Tube([(-0.14, -0.06, 1.355), (-0.05, -0.120, 1.285), (0.07, -0.112, 1.215), (0.14, -0.06, 1.17)],
                    [0.009, 0.009, 0.009, 0.009], k=0.01), k=0.0)
    straps.add(Tube([(0.13, 0.090, 1.37), (0.02, 0.112, 1.27), (-0.10, 0.100, 1.16), (-0.14, 0.06, 1.12)],
                    [0.011, 0.011, 0.011, 0.011], k=0.01), k=0.0)
    straps.add(Tube([(-0.13, 0.090, 1.37), (-0.02, 0.112, 1.27), (0.10, 0.100, 1.16), (0.14, 0.06, 1.12)],
                    [0.011, 0.011, 0.011, 0.011], k=0.01), k=0.0)
    part("straps", straps, "leather", ("zblend", "spine", "chest", 1.15, 1.30), 480, 0.7)
    med = Sculpt("medallion")                                    # the scarf's clasp at the left collar
    mc, mn = np.array([0.058, -0.112, 1.405]), unit((0.25, -1.0, 0.2))
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
        if s == "L":     # the big flared guard on the outer forearm, jutting past the elbow
            ax = sdf.frame(outv, d2)              # rows: X ~ along the forearm, Y across, Z outward
            br.add(RoundBox(el + d2 * 0.110 + outv * 0.043, (0.140, 0.040, 0.011), 0.008, axes=ax).displaced(chips(0.003, 9.0), 0.003), k=0.01)
            br.add(RoundBox(el - d2 * 0.030 + outv * 0.050 + np.array([0, 0, 0.02]), (0.030, 0.030, 0.010), 0.008, axes=ax), k=0.012)
        else:
            ax = sdf.frame(outv, d2)
            br.add(RoundBox(el + d2 * 0.120 + outv * 0.038, (0.110, 0.034, 0.010), 0.008, axes=ax).displaced(chips(0.003, 9.0), 0.003), k=0.01)
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
            pd.add(Ellipsoid(sh + (0.028, 0.0, 0.035), (0.078, 0.085, 0.058), axes=sdf.rot_y(26)).displaced(chips(0.003, 8.0), 0.003), k=0.0)
            pd.sub(Ellipsoid(sh + (0.004, 0.0, -0.010), (0.068, 0.076, 0.048), axes=sdf.rot_y(26)), k=0.006)
            part("pauldron_L", pd, "stone", ("dblend", "shoulder.L", "upper_arm.L", tuple(sh + (0, 0, 0.05)), (0.4, 0, -1), 0.0, 0.10), 700)
            lm = Sculpt("lames_L")
            for i, (root, tip, w, t) in enumerate((
                    ((0.085, -0.015, 1.470), (0.428, 0.150, 1.672), 0.052, 0.020),     # the 30 cm spike (up and back)
                    ((0.170, -0.020, 1.418), (0.360, 0.105, 1.545), 0.050, 0.019),
                    ((0.205, -0.018, 1.378), (0.385, 0.085, 1.448), 0.046, 0.018),
                    ((0.225, -0.012, 1.340), (0.372, 0.065, 1.370), 0.040, 0.016))):
                root, tip = np.array(root), np.array(tip)
                mid = (root + tip) / 2 + np.array([0.012, -0.02, -0.025])
                side = unit(np.cross(tip - root, (0.0, -1.0, 0.25)))

                def width(s_, w=w):
                    s_ = np.asarray(s_, dtype=np.float64)
                    return w * (0.85 + 0.25 * np.sin(np.clip(s_, 0, 1) * math.pi)) * np.clip((1 - s_) / 0.35, 0, 1) ** 0.9 + 0.002

                def thick(s_, t=t):
                    return t * (1.0 - 0.5 * np.asarray(s_, dtype=np.float64)) + 0.002
                lm.add(Blade(root, mid, tip, side, width, thick, n=16).displaced(chips(0.002, 14.0), 0.002), k=0.010)
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
        kc = kn + np.array([0.0, -0.068, 0.020])
        kp.add(RoundBox(kc, (0.052, 0.016, 0.070), 0.012, axes=sdf.rot_x(-8)).displaced(chips(0.004, 8.0), 0.004), k=0.0)
        kp.add(RoundCone(kc + (0, 0.004, 0.06), kc + (0, 0.012, 0.115), 0.034, 0.006), k=0.02)     # the pointed top
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
            bands.append((c0, rw + 0.006 + 0.008 * abs(math.sin(math.radians(tilt))), rd + 0.006, tilt))
        part(f"calfwrap_{s}", RingBands(f"calfwrap_{s}", bands, sd), "leather", f"bone:shin.{s}", 300)
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


THIN = ("fins", "lames_L", "crest", "crest_glass", "visor", "knife_blade_R", "knife_blade_L")


def skin_extras(extra: dict) -> list:
    """Lamplit's lamp cage on the crest's front horn: four carved-wood slats round a lampresin bead (7 cm)"""
    out = []
    if extra.get("lamp_cage"):
        c = np.array([0.0, -0.140, 1.758])       # on the crest's front edge, clear of the accent ridge below
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
    render.map_lighting = ml


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
    rig.add_socket(ctx.info, "x_visor_ridge", "head", (0.0, -0.112, 1.752), (0, 0, 0.05))


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
PAINTED = ("knife_blade_R", "knife_blade_L", "knife_grip_R", "knife_grip_L", "knife_guard_R", "knife_guard_L", "boots")
PROC_HIDDEN = {"face"}          # parts whose texels the painting hides take procedural paint, not the nearest pixel
FACE_COL = {"lit": "#DCDAD5", "shade": "#A9A49E", "warm": "#9E8C80", "ink": "#5C5550"}
HELM_COL = {"lit": "#E4E2DF", "mid": "#CCC9C4", "shade": "#A29E99", "cool": "#98A1AB", "ink": "#6F6A66"}
# the concept's visor (sampled): lavender-blue glass #94A4C9 / #8FAFC4 / #96B6CB, the cyan rim #C0E8F7
# (a step deeper than the sample: the game's light and the glass's gloss lift it toward white)
VISOR_COL = {"top": "#93AED4", "core": "#7D98C3", "low": "#6C89B4", "streak": "#B3CAE4", "rim": "#C2E6F5",
             "inner": "#5B769E", "eye": "#3E5682", "eye_ring": "#A9C3E0"}
VISOR_ROUGH = 0.26        # added to the dawnglass roughness on the visor only (a broad sheen, not a chrome hot spot)
BOOT_COL = {"upper": "#5E6773", "toe": "#727C88", "sole": "#232428", "cuff": "#3F362F"}
# the bible's light head / dark feet over the painting (rest height m -> multiplier, linear between)
VALUE_RAMP = ((0.0, 0.70), (0.25, 0.76), (0.55, 0.86), (0.95, 0.96), (1.30, 1.0), (1.60, 1.02), (1.95, 1.03))
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


HEAD_PARTS = ("helm", "face", "visor", "visor_ridge", "crest", "crest_glass", "crest_ribs", "fins", "cage_slats", "cage_bead")


HEAD_CHALK = ("helm", "face", "crest", "crest_ribs")
HEAD_GLASS = ("visor", "fins")


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


def boot_paint(p, n):
    up, toe, sole, cuff = (_hexrgb(BOOT_COL[k]) for k in ("upper", "toe", "sole", "cuff"))
    col = np.repeat(up[None], len(p), 0)
    t = np.clip((-p[:, 1] - 0.02) / 0.10, 0, 1)[:, None] * np.clip(n[:, 2] + 0.3, 0, 1)[:, None]
    col = col * (1 - t * 0.6) + toe[None] * t * 0.6
    so = np.clip((0.030 - p[:, 2]) / 0.010, 0, 1)[:, None]
    col = col * (1 - so) + sole[None] * so
    cu = np.clip(1.0 - np.abs(p[:, 2] - 0.165) / 0.014, 0, 1)[:, None]
    col = col * (1 - cu) + cuff[None] * cu
    return col


def _polyline_dist(p, pts):
    """distance from points (N, 3) to a 3D polyline"""
    P = np.asarray(pts, dtype=np.float64)
    d = np.full(len(p), 1e3)
    for a, b in zip(P[:-1], P[1:]):
        e = b - a
        t = np.clip(((p - a) @ e) / (e @ e + 1e-12), 0, 1)
        d = np.minimum(d, np.linalg.norm(p - (a + t[:, None] * e), axis=1))
    return d


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


def _mix(a, b, t):
    t = np.asarray(t, dtype=np.float32)[:, None]
    return a * (1 - t) + b * t


def face_paint(p, n):
    """the carved chalk face-plate under the visor: pale chalk lit from above, a warm grey under the cheekbones and
    the jaw, the carved lines (FACE_LINES) inked, a soft painterly mottle"""
    lit, shade, warm, ink = (_hexrgb(FACE_COL[k]) for k in ("lit", "shade", "warm", "ink"))
    t = np.clip(0.55 + 0.40 * n[:, 2] - 0.30 * np.abs(n[:, 0]) - 0.20 * np.clip((1.545 - p[:, 2]) / 0.05, 0, 1), 0, 1)
    col = _mix(shade[None], lit[None], t)
    col = _mix(col, warm[None], np.clip((1.56 - p[:, 2]) / 0.06, 0, 1) * 0.30 + np.clip(-n[:, 2] - 0.2, 0, 1) * 0.25)
    for pts, r in FACE_LINES:
        d = _polyline_dist(p, pts)
        col = _mix(col, ink[None], np.clip((r + 0.0028 - d) / 0.0022, 0, 1) * 0.75)
    col = col * (1.0 + 0.03 * NOISE(p, 40.0))[:, None]
    return col


def helm_paint(p, n):
    """the chalk dome (painted, not projected: the turned head left the neck's brown on its back): pale chalk lit from
    above, a cool bounce under the nape, the carved seam inked, chips and a painterly mottle"""
    lit, mid, shade, cool, ink = (_hexrgb(HELM_COL[k]) for k in ("lit", "mid", "shade", "cool", "ink"))
    t = np.clip(0.50 + 0.42 * n[:, 2] - 0.10 * n[:, 1] - 0.22 * np.clip((1.62 - p[:, 2]) / 0.07, 0, 1), 0, 1)
    col = np.where((t < 0.5)[:, None], _mix(shade[None], mid[None], t * 2), _mix(mid[None], lit[None], t * 2 - 1))
    col = _mix(col, cool[None], np.clip(-n[:, 2] - 0.15, 0, 1) * 0.45)
    q = (p - np.array([0.0, 0.040, 1.640])) @ sdf.rot_x(70).T                 # the carved seam (helm.sub Torus)
    d = np.sqrt((np.linalg.norm(q[:, :2], axis=1) - 0.100) ** 2 + q[:, 2] ** 2)
    col = _mix(col, ink[None], np.clip((0.0062 - d) / 0.002, 0, 1) * 0.55)
    col = col * (1.0 + 0.035 * NOISE(p, 26.0) + 0.02 * NOISE(p, 75.0))[:, None]
    return col


def visor_paint(p, n):
    """the dawnglass visor: lavender-blue glass, lighter at the brow and darker toward the beak, a soft reflected
    streak, ink almond recesses seen through it at the eyes, and the pale cyan rim on the cut edges (the concept's
    bright edge); the inside faces darker"""
    C = {k: _hexrgb(h) for k, h in VISOR_COL.items()}
    c, R = VISOR["c"], np.asarray(VISOR["r"], dtype=np.float64)
    q = (p - c) @ sdf.rot_x(VISOR["tilt"]).T
    kk = np.linalg.norm(q / R, axis=1)
    outer = np.clip((kk - 0.935) / 0.04, 0, 1)
    tv = np.clip((p[:, 2] - 1.53) / 0.20, 0, 1)
    col = np.where((tv < 0.45)[:, None], _mix(C["low"][None], C["core"][None], tv / 0.45),
                   _mix(C["core"][None], C["top"][None], (tv - 0.45) / 0.55))
    streak = np.clip(1 - np.abs(0.55 * p[:, 0] + (p[:, 2] - 1.672)) / 0.007, 0, 1) * np.clip(-n[:, 1], 0, 1)
    col = _mix(col, C["streak"][None], streak * 0.55)
    for sx in (-1.0, 1.0):                       # the almond eyes behind the glass
        dx = (p[:, 0] - sx * 0.041) / 0.027
        dz = (p[:, 2] - 1.650 - sx * dx * 0.0035) / 0.0105
        a_ = np.clip(1.0 - dx * dx, 0, 1)
        inside = np.abs(dz) - a_
        front = np.clip(-n[:, 1] * 2.0, 0, 1) * outer
        col = _mix(col, C["eye_ring"][None], np.clip(1 - np.abs(inside - 0.45) / 0.18, 0, 1) * (np.abs(dx) < 1) * front * 0.35)
        col = _mix(col, C["eye"][None], np.clip(-inside / 0.25, 0, 1) * front * 0.9)
    col = _mix(col, C["inner"][None], 1 - outer)
    dprof = _poly_inside_dist(VISOR_PROF, p[:, 1], p[:, 2])
    v0, sl = VISOR["v0"], VISOR["vslope"]
    dv = ((p[:, 2] - v0[2]) - sl * np.abs(p[:, 0])) / math.hypot(1.0, sl)
    de = np.minimum(dprof, dv)
    rim = np.clip(1 - (de - 0.003) / 0.005, 0, 1)
    col = _mix(col, C["rim"][None], rim * 0.9)
    return col


def fin_paint(p, n):
    """the glass fins (painted like the visor's glass, not projected: the painting's pale fins vanished against the
    splash sky): deeper blue at the root lightening to the tip, a darker spine down the middle, the cut edges pale"""
    C = {k: _hexrgb(h) for k, h in VISOR_COL.items()}
    col = np.zeros((len(p), 3), dtype=np.float32)
    best = np.full(len(p), 1e3)
    for root, tip, bow, w, tilt in FINS:
        root, tip = np.array(root), np.array(tip)
        ax = tip - root
        L = np.linalg.norm(ax)
        t = np.clip(((p - root) @ ax) / (L * L), 0, 1)
        d = np.linalg.norm(p - (root + t[:, None] * ax), axis=1)
        side = unit(np.cross(ax, (1.0, 0.0, -tilt)))
        across = np.abs((p - (root + t[:, None] * ax)) @ side)          # distance from the spine across the blade
        c = _mix(C["low"][None].repeat(len(p), 0), C["top"][None], t)
        c = _mix(c, C["inner"][None], np.clip(1 - across / 0.008, 0, 1) * 0.6)
        c = _mix(c, C["rim"][None], np.clip((np.abs(n @ side) - 0.55) / 0.3, 0, 1) * 0.85)
        sel = d < best
        col[sel] = c[sel]
        best = np.minimum(best, d)
    return col


PROC_HEAD = {"helm": helm_paint, "face": face_paint, "visor": visor_paint, "fins": fin_paint}
# the projection's mud (review: camouflage blotches on the trousers, brown smears and a dark patch on the coat's back):
# part -> (side, luminance squeeze, hue pull): the painted value variation is squeezed toward the part's median (in
# log luminance) and the hue pulled onto the median's, so folds and edges stay but the blotches go
HARMONIZE = {"trousers": (None, 0.68, 0.9), "skirt_L": ("back", 0.55, 0.9), "skirt_R": ("back", 0.55, 0.9)}


def harmonize(col, w, s_lum, s_hue, p):
    lin = _lin(col)
    wsum = np.maximum(w.sum(), 1e-6)
    m = np.array([np.median(lin[w > 0.5, i]) if (w > 0.5).any() else (lin[:, i] * w).sum() / wsum for i in range(3)])
    lw = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    Y = np.maximum(lin @ lw, 1e-5)
    Ym = max(float(m @ lw), 1e-5)
    Y2 = Ym * (Y / Ym) ** (1.0 - s_lum) * (1.0 + 0.04 * NOISE(p, 9.0))
    chrom = lin / Y[:, None]
    chrom = chrom * (1 - s_hue) + (m / Ym)[None] * s_hue
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
    if name in PROC_HEAD:
        col = PROC_HEAD[name](p, n).astype(np.float32)
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


def rishal_paint(maps0, sides, plates, names, flat=None, eps=0.02, log=print):
    """the shared project.paint with per-side posed texel maps: sides = {side: (maps, vis)}"""
    from common.hifi import project as pj
    part = maps0["part"]
    size = maps0["size"]
    out = np.zeros((size, size, 3), dtype=np.float32)
    have = part >= 0
    idx = np.nonzero(have)
    k = part[idx].astype(np.int64)
    n0 = maps0["N"][idx]
    p0 = maps0["P"][idx]
    cols = {}
    for side in ("front", "back"):
        maps, vis = sides[side]
        p = maps["P"][idx]
        n = maps["N"][idx]
        fills = {}
        pid = vis.part[side]
        st = vis.step
        small = plates.img[side][st // 2::st, st // 2::st][:pid.shape[0], :pid.shape[1]]
        gsmall = _glassy(small)
        for kk in np.unique(k):
            valid = pid == kk
            nm = names[int(kk)] if int(kk) < len(names) else ""
            if nm in HEAD_CHALK:
                valid = valid & ~gsmall          # the chalk helmet never takes the painted visor's glass
            elif nm in HEAD_GLASS:
                valid = valid & gsmall           # ...and the visor never the white face
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
        hidden = hidden | (np.isin(k, chalk_ids) & gl) | (np.isin(k, glass_ids) & ~gl)
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
    nf, nb = cols["front"][1], cols["back"][1]
    wb = np.clip((0.5 * (nb[:, 1] + nf[:, 1]) + 0.25) / 0.5, 0, 1)
    wb = wb * wb * (3 - 2 * wb)
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
    for name, fn in PROC_HEAD.items():     # the helmet, the visor and the face-plate are painted, not projected
        if name in names:
            sel = k == names.index(name)
            if sel.any():
                col[sel] = fn(p0[sel], n0[sel])
    for name, (side, s_lum, s_hue) in HARMONIZE.items():
        if name in names:
            sel = k == names.index(name)
            if sel.any():
                w = wb[sel] if side == "back" else (1 - wb[sel] if side == "front" else np.ones(int(sel.sum())))
                col[sel] = harmonize(col[sel], w, s_lum, s_hue, p0[sel])
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
    img = rishal_paint(maps0, sides, plates, names, flat=flat, log=log)
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
    """a child's stick runner (polylines in a 2D frame, metres): mid-stride, leaning into the run"""
    k = h

    def P_(u, v):
        return (u * k + lean * v * k, v * k)
    head = [P_(0.10 * math.cos(a) + 0.02, 0.86 + 0.10 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 13)]
    return [head, [P_(0.02, 0.76), P_(0.06, 0.40)], [P_(0.04, 0.66), P_(0.22, 0.56), P_(0.30, 0.70)],
            [P_(0.04, 0.66), P_(-0.12, 0.54), P_(-0.20, 0.42)], [P_(0.06, 0.40), P_(0.24, 0.22), P_(0.20, 0.0)],
            [P_(0.06, 0.40), P_(-0.08, 0.20), P_(-0.26, 0.16)]]


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
    run_row = _runner(0.12, 0.25) + _shift(_runner(0.12, 0.25), 0.13, 0.0) + _shift(_ground(0.30), 0.06, -0.01)
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
           ((-0.030, -0.172, 0.820), (0, -1, 0), (0, 0, 1), 0.04, _runner(0.15, 0.25) + _shift(_ground(0.16), 0.02, -0.01), ("apron",)),
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
    return out


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
        w = np.clip((0.0042 - dmin) / 0.0018, 0, 1) * near
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
        sel = pid == names.index(pn)
        out[sel] = lin[sel] * gain
        log(f"  recolour part {pn} -> {hx}, gain {np.round(gain, 2).tolist()}")
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
# foot forward. The sim plays `dash` across every dash (Glass Dash, Feint's spring, Long Glint's rush; the unit faces
# where it goes), so the cast clips of the two castTime-0 dashes hand off to `dash` from their launch frame on.
HandTarget, Aim, FootTarget = anim.HandTarget, anim.Aim, anim.FootTarget
LEAN = 11.0                       # the guard's chest-axis lean (deg), brief: 10 in idle, 15 in run


def _blade(d):
    v = np.asarray(d, dtype=np.float64)
    v = v / np.linalg.norm(v)
    return Aim(tuple(-v))


def _guard() -> dict:
    """the guard: a low staggered stance (left foot forward, the weight on it), the chest leaning ~11 degrees, both
    fists before the lower ribs, forearms close, the blades back along the forearms past the elbows"""
    st = anim.merge(anim.P(hips=(4, -6, 0), spine=(4, 3, 0), chest=(3, 3, 0), neck=(-4, 1, 0), head=(-6, 2, 0)),
                    {"hips_loc": (0.0, -0.02, -0.065),
                     "ik": anim.feet(l=(0.035, -0.15, 0.0), r=(-0.03, 0.15, 0.0), yl=-4.0, yr=-24.0)})
    arms = anim.merge(anim.arms_relaxed(), {"ik": {
        "hand.R": HandTarget(rel=(0.12, -0.53, -0.58), pole=(-0.85, 0.45, -0.30)),
        "hand.L": HandTarget(rel=(-0.10, -0.62, -0.50), pole=(0.85, 0.40, -0.35)),
        "aim.R": _blade((-0.34, 0.92, -0.18)), "aim.L": _blade((0.34, 0.92, -0.14))}})
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
    """attack1 (20 f, impact f8): a quick right-knife jab, the reverse grip's stab: the fist cocks by the right ear,
    the hips turn in and the fist punches forward and down, the blade driving point-first forward-down at chest
    height, the left fist pulled back to the ribs"""
    wind = _pose(g, dict(hips=(0, -9, 0), spine=(-2, -8, 2), chest=(-4, -12, 4), head=(0, 9, 0)), (0.0, 0.03, -0.01),
                 R=(-0.04, -0.06, 0.12), Rp=(-0.9, 0.2, 0.3), Rb=(-0.15, 0.35, -0.92),
                 L=(-0.12, -0.66, -0.42))
    step = _feet(g, dl=(0.0, -0.08, 0.0), pl=0.0)
    hit = _pose(g, dict(hips=(5, 12, 0), spine=(6, 10, -3), chest=(7, 14, -4), head=(-2, -10, 0)), (0.0, -0.05, -0.03),
                R=(0.12, -0.94, -0.22), Rp=(-0.8, 0.3, -0.5), Rb=(0.10, -0.72, -0.69),
                L=(-0.02, -0.40, -0.62), Lp=(0.8, 0.6, -0.2), feet=step)
    fol = _pose(g, dict(hips=(6, 15, 0), spine=(7, 12, -3), chest=(8, 17, -5), head=(-3, -12, 0)), (0.0, -0.06, -0.035),
                R=(0.18, -0.86, -0.42), Rp=(-0.7, 0.4, -0.6), Rb=(0.18, -0.35, -0.92),
                L=(-0.02, -0.38, -0.64), feet=step)
    return _clip("attack1", 20, anim.strike_keys(MOTION, wind, hit, fol, g), impact=anim.IMPACT, lags={"head": 1.5, "neck": 1.0})


def _attack2(g) -> anim.Clip:
    """attack2 (20 f, impact f8): a left-knife backhand slash: the left fist coils across to the right shoulder, the
    chest unwinds and the arm sweeps flat out to his left-front, the blade flicked out edge-first through the line"""
    wind = _pose(g, dict(hips=(2, -12, 0), spine=(2, -10, 0), chest=(3, -16, 0), head=(0, 12, 0)), (0.0, 0.02, -0.015),
                 L=(-0.48, -0.40, -0.10), Lp=(0.6, 0.0, -0.8), Lb=(0.75, 0.55, -0.15),
                 R=(0.10, -0.42, -0.62))
    step = _feet(g, dl=(0.05, -0.06, 0.0), yl=10.0)
    hit = _pose(g, dict(hips=(4, 14, 0), spine=(5, 12, 0), chest=(6, 18, 0), head=(0, -12, 0)), (0.02, -0.05, -0.03),
                L=(0.32, -0.88, -0.18), Lp=(0.8, 0.3, -0.5), Lb=(0.62, -0.68, -0.30),
                R=(0.14, -0.36, -0.64), Rp=(-0.8, 0.6, -0.2), feet=step)
    fol = _pose(g, dict(hips=(4, 20, 0), spine=(5, 15, 0), chest=(6, 22, 0), head=(0, -14, 0)), (0.03, -0.05, -0.035),
                L=(0.70, -0.45, -0.22), Lp=(0.6, 0.6, -0.5), Lb=(0.92, 0.20, -0.30),
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
    """the dash's sprint (lean ~35 degrees), both fists swept low behind the hips, the blades pointing back and
    down so their tips skim the ground behind him (Glass Dash's track); `phase` 0/1 = which leg drives"""
    lead = "L" if phase < 0.5 else "R"
    fwd = (0.05, -0.30, 0.10) if lead == "L" else (-0.05, -0.30, 0.10)
    back = (-0.03, 0.34, 0.12) if lead == "L" else (0.03, 0.34, 0.12)
    ft = {"foot.L": FootTarget(tuple(np.array(fwd if lead == "L" else back) * k), 10.0 if lead == "L" else -40.0, -2.0),
          "foot.R": FootTarget(tuple(np.array(fwd if lead == "R" else back) * k), 10.0 if lead == "R" else -40.0, 2.0)}
    return _pose(g, dict(hips=(18 * k, 0, 0), spine=(10 * k, 0, 0), chest=(6 * k, 0, 0), neck=(-14 * k, 0, 0), head=(-14 * k, 0, 0)),
                 (0.0, -0.10 * k, -0.08 * k),
                 R=(0.02, 0.38, -0.80), Rp=(-0.7, 0.5, 0.2), Rb=(-0.30, 0.70, -0.65),
                 L=(-0.02, 0.38, -0.80), Lp=(0.7, 0.5, 0.2), Lb=(0.30, 0.70, -0.65), feet=ft)


def _dash(g) -> anim.Clip:
    """dash (15 f, played across every dash: Glass Dash 0.31 s, Feint 0.29 s, Long Glint 0.5 s): the low sprint, two
    driving strides, the knives trailing low (the glass track), and a short skid back toward the guard"""
    a, b = _sprint(g, 1.0, 0.0), _sprint(g, 1.0, 1.0)
    skid = _pose(g, dict(hips=(6, 0, 0), spine=(4, 0, 0), chest=(2, 0, 0), neck=(-4, 0, 0), head=(-4, 0, 0)), (0.0, 0.0, -0.09),
                 R=(0.12, -0.20, -0.75), Rb=(-0.35, 0.85, -0.38), L=(-0.10, -0.40, -0.62), Lb=(0.35, 0.85, -0.38),
                 feet=_feet(g, dl=(0.0, -0.10, 0.0), dr=(0.0, 0.12, 0.0), pr=-20.0))
    keys = [(0.0, a, "linear"), (0.30, b, "inout"), (0.60, a, "inout"), (0.82, skid, "out"), (1.0, skid, "linear")]
    return _clip("dash", 15, keys, lags={"head": 1.0})


def _cast_a1(g) -> anim.Clip:
    """cast_a1 Glass Dash (15 f, impact f6, castTime 0): a 3-frame crouch with both knives dragged back, then the
    launch: the lean peaks at ~35 degrees at f6 as the sim fires him 5 m at 16 m/s, the blades trailing low; it ends
    on the dash clip's first pose (the renderer cross-fades into `dash`: no second swing)"""
    crouch = _pose(g, dict(hips=(10, 0, 0), spine=(6, 0, 0), chest=(4, 0, 0), neck=(-6, 0, 0), head=(-6, 0, 0)), (0.0, 0.03, -0.10),
                   R=(0.02, 0.10, -0.85), Rp=(-0.8, 0.5, 0.0), Rb=(-0.30, 0.80, -0.50),
                   L=(-0.02, 0.10, -0.85), Lp=(0.8, 0.5, 0.0), Lb=(0.30, 0.80, -0.50))
    launch = _sprint(g, 1.12, 0.0)
    keys = [(0.0, g, "linear"), (0.20, crouch, "out"), (0.40, launch, "accel"), (0.70, _sprint(g, 1.0, 0.5), "inout"),
            (1.0, _sprint(g, 1.0, 0.0), "inout")]
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
    """cast_a3 Feint (20 f, impact f8 = the apex, castTime 0): a 3-frame head fake (the right shoulder dives into a
    false lunge, the right knife stabbing low, the head committed forward), then he springs BACKWARD: the push-off
    from the right foot, the body arcing back (hips and chest thrown back, chin down, eyes on the target), the left
    knee tucked up before him, both arms swept wide and back with the knives as two wings (blades out and up behind);
    the apex at f8 with both feet clear; a deep bent-knee landing at f14 (the arms folding in), the guard by f20"""
    fake = _pose(g, dict(hips=(12, 14, -2), spine=(10, 10, -6), chest=(10, 12, -8), neck=(-6, -6, 0), head=(-8, -8, 0)),
                 (0.02, -0.09, -0.07),
                 R=(0.14, -0.88, -0.42), Rp=(-0.8, 0.4, -0.5), Rb=(0.15, -0.45, -0.88),
                 L=(-0.06, -0.48, -0.56), feet=_feet(g, dl=(0.0, -0.07, 0.0), dr=(0.0, 0.0, 0.0), pr=-14.0))
    push = _pose(g, dict(hips=(-6, 4, 0), spine=(-6, 2, 0), chest=(-6, 0, 0), neck=(6, 0, 0), head=(6, 0, 0)),
                 (0.0, 0.08, 0.02),
                 R=(-0.55, 0.10, -0.30), Rp=(-0.4, 0.8, -0.4), Rb=(-0.55, 0.80, 0.10),
                 L=(0.55, 0.10, -0.30), Lp=(0.4, 0.8, -0.4), Lb=(0.55, 0.80, 0.10),
                 feet=_feet(g, dl=(0.0, -0.02, 0.05), dr=(0.0, 0.04, 0.0), pl=-20.0, pr=-38.0))
    apex = _pose(g, dict(hips=(-24, 0, 0), spine=(-14, 0, 0), chest=(-12, 0, 0), neck=(12, 0, 0), head=(10, 0, 0)),
                 (0.0, 0.20, 0.16),
                 R=(-0.52, 0.68, -0.22), Rp=(-0.3, 0.3, -0.9), Rb=(-0.55, 0.40, 0.73),
                 L=(0.52, 0.68, -0.20), Lp=(0.3, 0.3, -0.9), Lb=(0.55, 0.40, 0.73),
                 feet={"foot.L": FootTarget(tuple(np.array(g["ik"]["foot.L"].ankle) + (0.03, 0.02, 0.40)), 24.0, -4.0),
                       "foot.R": FootTarget(tuple(np.array(g["ik"]["foot.R"].ankle) + (0.0, 0.22, 0.14)), -48.0, -24.0)})
    land = _pose(g, dict(hips=(16, 0, 0), spine=(8, 0, 0), chest=(4, 0, 0), neck=(-8, 0, 0), head=(-8, 0, 0)), (0.0, 0.03, -0.16),
                 R=(-0.38, -0.40, -0.50), Rp=(-0.8, 0.4, -0.3), Rb=(-0.45, 0.80, -0.40),
                 L=(0.38, -0.42, -0.50), Lp=(0.8, 0.4, -0.3), Lb=(0.45, 0.80, -0.40),
                 feet=_feet(g, dl=(0.0, 0.02, 0.0), dr=(0.0, 0.04, 0.0)))
    keys = [(0.0, g, "linear"), (0.15, fake, "out"), (0.26, push, "inout"), (anim.IMPACT, apex, "out"),
            (0.56, anim.lerp_pose(apex, land, 0.5), "in"), (0.70, land, "accel"),
            (0.84, anim.lerp_pose(land, g, 0.6), "inout"), (1.0, g, "settle")]
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
    burst = _pose(g, dict(hips=(38, 0, 0), spine=(14, 0, 0), chest=(10, 0, 0), neck=(-22, 0, 0), head=(-24, 0, 0)), (0.0, -0.30, -0.24),
                  R=(-0.22, -0.86, -0.30), Rp=(-0.8, 0.4, -0.3), Rb=(-0.30, -0.90, -0.12),
                  L=(0.22, -0.86, -0.31), Lp=(0.8, 0.4, -0.3), Lb=(0.30, -0.90, -0.12),
                  feet=_feet(g, dl=(0.0, -0.42, 0.0), dr=(0.0, 0.42, 0.0), pl=0.0, pr=-48.0))
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
    """stunned (40 f loop): rocked back on his heels, the knives hanging, stumbling small steps"""
    base = _pose(g, dict(hips=(-6, 0, 0), spine=(-4, 0, 0), chest=(-2, 0, 0), neck=(8, 0, 0), head=(10, 0, 0)), (0.0, 0.05, -0.03),
                 R=(-0.10, -0.25, -0.92), Rb=(-0.20, 0.20, -0.96), L=(0.10, -0.22, -0.92), Lb=(0.20, 0.20, -0.96))

    def sample(t):
        a, b = anim.osc(t, 1), anim.osc(t, 1, 0.25)
        p = anim.add(base, anim.P(hips=(0, 4 * a, 3 * b), spine=(2 * b, 0, -3 * a), chest=(2 * b, 0, -3 * a),
                                  neck=(4 * b, 0, 5 * a), head=(6 * b, 5 * a, 7 * a)))
        ik = dict(p["ik"])
        lift = max(0.0, a)
        ik.update(_feet(g, dl=(0.0, 0.03 * lift, 0.03 * lift), dr=(0.0, -0.02 * max(0.0, -a), 0.03 * max(0.0, -a)),
                        pl=-10 * lift, pr=-10 * max(0.0, -a)))
        p["ik"] = ik
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
                                                  upper_arm_R=(-10, 0, -70), forearm_R=(10, 0, 0),
                                                  upper_arm_L=(-10, 0, 70), forearm_L=(12, 0, 0)))
    down["hips_loc"] = (0.04, 0.40, -hip_h + 0.12)
    down["ik"] = {"aim.R": _blade((-0.92, 0.38, 0.0)), "aim.L": _blade((0.92, 0.38, 0.0))}   # the knives flat on the ground
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
        bounce = abs(math.sin(2 * math.pi * 3 * t))
        look = math.sin(math.pi * min(1.0, max(0.0, (t - 0.44) / 0.20))) ** 2
        roll = math.sin(2 * math.pi * min(1.0, max(0.0, (t - 0.84) / 0.16)))
        p = anim.add(base, anim.P(neck=(4 * roll, -12 * look, 6 * roll), head=(3 * roll, -34 * look, 8 * roll),
                                  chest=(1.2 * anim.osc(t, 3), -8 * look, 0), spine=(0, -4 * look, 0)))
        ik = dict(p["ik"])
        ik["aim.R"] = _blade(flip_dir(t))
        tap = max(0.0, math.sin(2 * math.pi * min(1.0, max(0.0, (t - 0.66) / 0.16)) * 2)) if 0.66 < t < 0.82 else 0.0
        fl = ik["foot.L"]
        ik["foot.L"] = FootTarget((fl.ankle[0], fl.ankle[1], fl.ankle[2] + 0.04 * tap), -14.0 * tap, fl.yaw)
        fr = ik["foot.R"]
        ik["foot.R"] = FootTarget(fr.ankle, -10.0 * bounce * 0.6, fr.yaw)
        p["ik"] = ik
        hx, hy, hz = base["hips_loc"]
        p["hips_loc"] = (hx, hy, hz + 0.018 * bounce)
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
                  R=(0.10, -0.80, -0.70), Rp=(-0.9, 0.3, -0.2), Rb=(0.05, -0.40, -0.92),
                  L=(-0.10, -0.55, -0.70), Lp=(0.9, 0.3, -0.2), Lb=(0.30, 0.70, -0.60),
                  feet=_feet(g, dl=(0.0, -0.12, 0.0), dr=(0.0, 0.22, 0.06), pr=-62.0))
    draw = _pose(g, dict(hips=(18, -16, 0), spine=(12, -6, 0), chest=(14, -8, 0), neck=(6, 0, 0), head=(16, 10, 0)), (0.0, 0.06, -hip_h * 0.40),
                 R=(-0.30, -0.70, -0.78), Rp=(-0.9, 0.3, -0.2), Rb=(-0.25, -0.30, -0.92),
                 L=(-0.10, -0.55, -0.70), Lb=(0.30, 0.70, -0.60), feet=_feet(g, dl=(0.0, -0.12, 0.0), dr=(0.0, 0.22, 0.06), pr=-62.0))
    up = _pose(g, dict(hips=(-2, 0, 0), spine=(-2, 0, 0), chest=(-2, 0, 0), neck=(0, 0, 0), head=(-2, 0, 0)), (0.0, 0.02, 0.03),
               R=(-0.30, -0.60, -0.20), Rp=(-0.9, 0.3, -0.2), Rb=(-0.6, -0.4, 0.69), L=(-0.05, -0.40, -0.70))
    flick = _pose(g, dict(hips=(-2, 0, 0), spine=(-2, 0, 0), chest=(-2, 0, 0), head=(-2, 0, 0)), (0.0, 0.02, 0.03),
                  R=(-0.40, -0.55, -0.30), Rb=(-0.5, 0.75, -0.43), L=(-0.05, -0.40, -0.70))
    # (the head turns a quarter away to his right, chin up: from the splash camera on his left the visor's beak points
    # into the frame and the crest arc and both glass fins show in profile; the first pass turned it toward the camera,
    # the crest edge-on and the fins hidden behind the helm)
    hold = _pose(g, dict(hips=(-4, -10, 0), spine=(-6, -4, 0), chest=(-8, -4, 0), neck=(-4, -10, 0), head=(-8, -18, 0)), (0.0, 0.05, 0.035),
                 R=(0.30, 0.38, -0.78), Rp=(-0.8, -0.1, 0.4), Rb=(-0.55, 0.75, 0.37),
                 L=(-0.30, 0.38, -0.78), Lp=(0.8, -0.1, 0.4), Lb=(0.55, 0.75, 0.37),
                 feet=_feet(g, dl=(0.04, 0.05, 0.0), dr=(-0.04, -0.02, 0.0), yr=-30.0, yl=-12.0))
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
