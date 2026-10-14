"""VALE RIFT jungle camp monsters (neutral, no `accent`): skinned + animated GLBs.

    Blender -b --factory-startup --python art/blender/units/creatures.py -- [--only glasshorn,...]
            [--fast] [--no-qa] [--icons] [--icons-only]

  glasshorn        2.2 m  buff camp: a chalk-pale stag whose antlers are clear faceted dawnglass
                          (a faint inner light), long legs. Clips idle, run (bounding gallop), attack1
                          (antler hook), cast_a1 (Glass Bellow: head up, antlers flare, bellow), death.
  resinback        1.8 m  buff camp: a heavy, low, broad beast; hardened amber resin plates on its
                          back with a warm light deep inside; thick forelegs. cast_a1 = Resin Spit.
  stilltusk        1.4 m  regular camp: a stocky boar with a bristled mane and carved-stone tusks
                          (sundial gnomon blades). cast_a1 = Still Stamp (rears and stamps).
  stilltusk_young  0.9 m  the camp's juvenile: rounder, banded, stubby tusk nubs (idle, run, attack1, death).

Kit: creature_kit.py (custom quadruped armature, analytic leg IK, SDF bodies, baked paint, actions
-> NLA). The run clip is authored at the unit's base.moveSpeed (the renderer's runRef for units),
so planted hooves do not skate in play. Impact frames at 40 % of attack1 / cast_a1 (frame counts are
multiples of 5). Glow (glass antlers, resin) stays at emissive <= 0.8: a glow is a warning.

Outputs: art/out/units/<id>.glb, art/out/units/{glasshorn,resinback}_icon.png (128²),
art/renders/units/<id>.png (in-engine three.js contact sheet: 8 facings at the gameplay camera + every
clip from the high 3/4 camera), art/renders/units/build_report_<id>.json, art/.cache/units/<id>.blend.
"""
from __future__ import annotations

import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
from common import bake, export, materials, mesh, scene  # noqa: E402
from common.hifi import sdf  # noqa: E402
from common.hifi.sdf import Capsule, Ellipsoid, HalfSpace, RoundCone, Sculpt, Sphere, Torus  # noqa: E402
import creature_kit as K  # noqa: E402
from creature_kit import B, Clip, Leg, LegDef, Pose, lerp, rot, smooth, spline, wave  # noqa: E402

OUT = os.path.join(scene.OUT_DIR, "units")
RENDERS = os.path.join(scene.RENDERS_DIR, "units")
CACHE = os.path.join(scene.CACHE_DIR, "units")
TEXCACHE = os.path.join(scene.CACHE_DIR, "textures", "units")
NOISE = sdf.Noise(41)
for _bin in ("/opt/homebrew/bin",):                                               # ffmpeg (icon denoise)
    if os.path.isdir(_bin) and _bin not in os.environ.get("PATH", ""):
        os.environ["PATH"] = os.environ.get("PATH", "") + os.pathsep + _bin
NODE_BIN = "/opt/homebrew/opt/node@22/bin"
if os.path.isdir(NODE_BIN) and NODE_BIN not in os.environ.get("PATH", ""):
    os.environ["PATH"] = NODE_BIN + os.pathsep + os.environ.get("PATH", "")      # optimize.mjs needs node 22


def mirror(p, s=-1):
    return (p[0] * s, p[1], p[2])


def V3(p):
    return np.asarray(p, dtype=np.float64)


def pivot(R, c, h):
    """hips_loc that rotates the body by R about point c (instead of the hips head h)."""
    c, h = V3(c), V3(h)
    return c + R @ (h - c) - h


# ── crystal prisms (hard-surface dawnglass) ──────────────────────────────────────────────────────
def crystal(verts, faces, a, b, ra, rb, sides=6, tip=0.0, twist=0.0, base_cap=True):
    """A faceted prism a->b (radius ra->rb), optionally terminated by a pyramid of length `tip`
    beyond b. Appends to verts/faces lists."""
    a, b = V3(a), V3(b)
    F = sdf.frame(b - a)
    x, y = F[0], F[1]
    i0 = len(verts)
    for r, c in ((ra, a), (rb, b)):
        for k in range(sides):
            ang = 2 * math.pi * k / sides + twist
            verts.append(c + r * (math.cos(ang) * x + math.sin(ang) * y))
    for k in range(sides):
        k2 = (k + 1) % sides
        faces.append((i0 + k, i0 + k2, i0 + sides + k2, i0 + sides + k))
    d = (b - a) / np.linalg.norm(b - a)
    if tip > 0:
        apex = len(verts)
        verts.append(b + d * tip)
        for k in range(sides):
            k2 = (k + 1) % sides
            faces.append((i0 + sides + k, i0 + sides + k2, apex))
    else:
        faces.append(tuple(i0 + sides + k for k in range(sides)))
    if base_cap:
        faces.append(tuple(i0 + k for k in reversed(range(sides))))


def mesh_object(name, verts, faces, col):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    return ob


# ════════════════════════════════════════════════════════════════════════════════════════════════
class Creature:
    ID = ""
    HEIGHT = 1.0
    BODY_TOP = 1.0                 # value-gradient top (the back), not the antler tips
    RUN_SPEED = 3.4
    TEX = 1024
    VOX_LOW = 0.012
    VOX_HIGH = 0.008
    TRIS = {"body": 7000}
    CLIPS = ("idle", "run", "attack1", "cast_a1", "death")
    HEAT_EXCLUDE = ("root",)
    GLOW = {}                      # part name -> (material name, emissive strength)
    UV_WEIGHTS = {}
    BAKE_RAY = (0.02, 0.07)        # cage extrusion, max ray distance
    VOX_PART = {}                  # per-part low voxel overrides
    WRIST_MIN = 0.03               # lowest the wrist / hock joint may go (its knob radius)
    BALL_MIN = 0.0                 # lowest the planted joint may go (paws: the sole under it)

    PART_BIND = {}                 # sdf part -> "transfer" (weights copied from the heat-bound body)
    FRONT_TOE = "hoof"

    def __init__(self):
        self.J = self.joints()

    def quad_bones(self, necks=("neck",), tails=("tail", "tail2"), ears=True, jaw=True, extra=()):
        """Root, hips -> spine -> chest -> neck chain -> head (+ jaw, ears), a tail chain off the hips, and per
        side a scapula + upper_arm/forearm/hand/<FRONT_TOE> front leg and thigh/shin/foot/toe hind leg. Joint
        names: hips spine chest <necks> head snout jaw chin <tails> tail_end ear ear_tip withers shoulder elbow
        wrist fball ftip hip knee hock hball htip."""
        J = self.J
        bl = [B("root", (0, 0, 0), (0, -0.3 * self.HEIGHT / 2, 0)),
              B("hips", J["hips"], J["spine"], "root"),
              B("spine", J["spine"], J["chest"], "hips", True),
              B("chest", J["chest"], J[necks[0]], "spine", True)]
        chain = list(necks) + ["head"]
        for i, n in enumerate(necks):
            bl.append(B(n, J[n], J[chain[i + 1]], "chest" if i == 0 else necks[i - 1], True))
        bl.append(B("head", J["head"], J["snout"], necks[-1], True))
        if jaw:
            bl.append(B("jaw", J["jaw"], J["chin"], "head"))
        tchain = list(tails) + ["tail_end"]
        for i, n in enumerate(tails):
            bl.append(B(n, J[n], J[tchain[i + 1]], "hips" if i == 0 else tails[i - 1], i > 0))
        ft = self.FRONT_TOE
        for s, sx in (("L", 1), ("R", -1)):
            m = lambda k: mirror(J[k], sx)  # noqa: E731
            if ears:
                bl.append(B(f"ear.{s}", m("ear"), m("ear_tip"), "head", xaxis=(0, -1, 0)))
            bl += [B(f"thigh.{s}", m("hip"), m("knee"), "hips"),
                   B(f"shin.{s}", m("knee"), m("hock"), f"thigh.{s}", True),
                   B(f"foot.{s}", m("hock"), m("hball"), f"shin.{s}", True),
                   B(f"toe.{s}", m("hball"), m("htip"), f"foot.{s}", True),
                   B(f"scapula.{s}", m("withers"), m("shoulder"), "chest"),
                   B(f"upper_arm.{s}", m("shoulder"), m("elbow"), f"scapula.{s}", True),
                   B(f"forearm.{s}", m("elbow"), m("wrist"), f"upper_arm.{s}", True),
                   B(f"hand.{s}", m("wrist"), m("fball"), f"forearm.{s}", True),
                   B(f"{ft}.{s}", m("fball"), m("ftip"), f"hand.{s}", True)]
        return bl + list(extra)

    def quad_legs(self):
        ft = self.FRONT_TOE
        return [LegDef("FL", ("upper_arm.L", "forearm.L", "hand.L", f"{ft}.L"), -1),
                LegDef("FR", ("upper_arm.R", "forearm.R", "hand.R", f"{ft}.R"), -1),
                LegDef("HL", ("thigh.L", "shin.L", "foot.L", "toe.L"), +1),
                LegDef("HR", ("thigh.R", "shin.R", "foot.R", "toe.R"), +1)]

    def jaw_split(self, ob, hinge, lip):
        h, lip = np.array(hinge), np.array(lip)

        def jaw_t(V):
            y, z = V[:, 1], V[:, 2]
            zl = h[2] + (y - h[1]) * (lip[2] - h[2]) / (lip[1] - h[1])
            below = _smooth_arr(zl + 0.006, zl - 0.008, z)
            fwd = _smooth_arr(h[1] + 0.03, h[1] - 0.05, y)
            return below * fwd
        K.split_weights(ob, "head", "jaw", jaw_t)

    def hard_material(self, part, grad):
        raise NotImplementedError

    # to implement
    def joints(self) -> dict: ...
    def bones(self) -> list: ...
    def legdefs(self) -> list: ...
    def sculpts(self, detail: bool) -> dict: ...         # part -> Sculpt
    def hard(self, col) -> list: return []                # [(part, obj, bone)]
    def paint(self, part, V, N, tags) -> tuple: ...      # -> (rgb srgb, rough)
    def high_material(self, part, grad): ...
    def weight_fix(self, ob): ...
    def clips(self, rig) -> list: ...

    # shared helpers
    def side_masks(self, ob, front_y=0.0, band=0.12):
        def side(sfx):
            return lambda n: n.endswith(sfx)
        legs_f = {b for lg in self.legdefs() if lg.name[0] == "F" for b in lg.bones} | {"scapula.L", "scapula.R"}
        legs_h = {b for lg in self.legdefs() if lg.name[0] == "H" for b in lg.bones}
        rules = [
            (side(".L"), lambda V: K.smooth_arr(-0.025, 0.02, V[:, 0])),
            (side(".R"), lambda V: K.smooth_arr(0.025, -0.02, V[:, 0])),
            (lambda n: n in legs_f, lambda V: K.smooth_arr(front_y + band, front_y - band, V[:, 1])),
            (lambda n: n in legs_h, lambda V: K.smooth_arr(front_y - band, front_y + band, V[:, 1])),
        ]
        K.mask_weights(ob, rules)


def _smooth_arr(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


K.smooth_arr = _smooth_arr


# ════════════════════════════════════════════════════════════════════════════════════════════════
class Glasshorn(Creature):
    ID = "glasshorn"
    HEIGHT = 2.2
    BODY_TOP = 1.45
    RUN_SPEED = 3.4                 # units.json base.moveSpeed
    TRIS = {"body": 7600}
    HEAT_EXCLUDE = ("root", "antler.L", "antler.R")
    GLOW = {"antlers": ("glasshorn_dawnglass", 0.55)}
    UV_WEIGHTS = {1: 0.55}
    PAL = {"hide": "#D9D1C1", "flank": "#CCC2AF", "belly": "#ECE7DC", "leg": "#9A9083", "sock": "#6E655B",
           "ruff": "#BBAD97", "muzzle": "#6A615A", "nose": "#2E2A28", "eye": "#1B1917", "hoof": "#3F3832",
           "ear_in": "#C7A99A", "rump": "#F1EDE5", "tick": "#A79C8C", "pedicle": "#E8E1D2"}

    def joints(self):
        return dict(
            hips=(0, 0.46, 1.10), spine=(0, 0.06, 1.13), chest=(0, -0.34, 1.18), neck=(0, -0.56, 1.30),
            neck2=(0, -0.72, 1.50), head=(0, -0.83, 1.67), snout=(0, -1.17, 1.52),
            jaw=(0, -0.92, 1.585), chin=(0, -1.13, 1.475),
            tail=(0, 0.66, 1.14), tail2=(0, 0.75, 1.05), tail_end=(0, 0.79, 0.95),
            ear=(0.085, -0.865, 1.725), ear_tip=(0.225, -0.84, 1.795),
            withers=(0.11, -0.36, 1.30),
            antler=(0.075, -0.87, 1.77), antler_tip=(0.17, -0.83, 1.97),
            # each leg's joints share one x (the IK plane is the body's sagittal plane)
            hip=(0.15, 0.50, 1.00), stifle=(0.15, 0.33, 0.70), hock=(0.15, 0.60, 0.50), hfet=(0.15, 0.56, 0.125),
            htip=(0.15, 0.47, 0.012),
            shoulder=(0.155, -0.47, 1.02), elbow=(0.155, -0.36, 0.76), carpus=(0.155, -0.44, 0.42),
            ffet=(0.155, -0.47, 0.125), ftip=(0.155, -0.56, 0.012),
        )

    def bones(self):
        J = self.J
        bl = [B("root", (0, 0, 0), (0, -0.3, 0)),
              B("hips", J["hips"], J["spine"], "root"),
              B("spine", J["spine"], J["chest"], "hips", True),
              B("chest", J["chest"], J["neck"], "spine", True),
              B("neck", J["neck"], J["neck2"], "chest", True),
              B("neck2", J["neck2"], J["head"], "neck", True),
              B("head", J["head"], J["snout"], "neck2", True),
              B("jaw", J["jaw"], J["chin"], "head"),
              B("tail", J["tail"], J["tail2"], "hips"),
              B("tail2", J["tail2"], J["tail_end"], "tail", True)]
        for s, sx in (("L", 1), ("R", -1)):
            m = lambda k: mirror(J[k], sx)  # noqa: E731
            bl += [B(f"ear.{s}", m("ear"), m("ear_tip"), "head", xaxis=(0, -1, 0)),
                   B(f"antler.{s}", m("antler"), m("antler_tip"), "head", xaxis=(0, -1, 0)),
                   B(f"thigh.{s}", m("hip"), m("stifle"), "hips"),
                   B(f"shin.{s}", m("stifle"), m("hock"), f"thigh.{s}", True),
                   B(f"foot.{s}", m("hock"), m("hfet"), f"shin.{s}", True),
                   B(f"toe.{s}", m("hfet"), m("htip"), f"foot.{s}", True),
                   B(f"scapula.{s}", m("withers"), m("shoulder"), "chest"),
                   B(f"upper_arm.{s}", m("shoulder"), m("elbow"), f"scapula.{s}", True),
                   B(f"forearm.{s}", m("elbow"), m("carpus"), f"upper_arm.{s}", True),
                   B(f"hand.{s}", m("carpus"), m("ffet"), f"forearm.{s}", True),
                   B(f"hoof.{s}", m("ffet"), m("ftip"), f"hand.{s}", True)]
        return bl

    def legdefs(self):
        return [LegDef("FL", ("upper_arm.L", "forearm.L", "hand.L", "hoof.L"), -1),
                LegDef("FR", ("upper_arm.R", "forearm.R", "hand.R", "hoof.R"), -1),
                LegDef("HL", ("thigh.L", "shin.L", "foot.L", "toe.L"), +1),
                LegDef("HR", ("thigh.R", "shin.R", "foot.R", "toe.R"), +1)]

    # ── sculpt ──
    def sculpts(self, detail):
        J = self.J
        S = Sculpt("body")

        def fur(amp, sc=(1.0, 0.35, 1.0), f=22.0):
            if not detail:
                return None
            scv = np.array(sc)
            return (lambda P: amp * NOISE.fbm(P * scv, f, 3)), amp

        def add(prim, k, tag="hide", d=None):
            if d is not None:
                prim = prim.displaced(d[0], d[1] + 0.004)
            S.add(prim, k=k, tag=tag)

        hide = fur(0.0035)
        # torso: barrel, deep chest, withers, croup
        add(Ellipsoid((0, 0.03, 1.07), (0.225, 0.55, 0.245)), 0.0, d=hide)
        add(Ellipsoid((0, -0.35, 1.03), (0.215, 0.26, 0.285)), 0.10, d=hide)
        add(Ellipsoid((0, -0.43, 1.23), (0.12, 0.2, 0.12)), 0.08, d=hide)
        add(Ellipsoid((0, 0.41, 1.10), (0.205, 0.25, 0.225)), 0.10, d=hide)
        add(Ellipsoid((0, 0.62, 1.10), (0.13, 0.08, 0.13)), 0.07, tag="rump")
        for sx in (1, -1):
            add(Ellipsoid((sx * 0.125, -0.43, 1.02), (0.085, 0.15, 0.24), axes=sdf.axes_from_rot(sdf.rot_x(-14))), 0.06, d=hide)
            add(Ellipsoid((sx * 0.115, 0.44, 0.99), (0.10, 0.19, 0.24), axes=sdf.axes_from_rot(sdf.rot_x(10))), 0.06, d=hide)
        # neck + throat ruff (shaggy, the stag's readable mane)
        add(RoundCone((0, -0.50, 1.19), (0, -0.80, 1.62), 0.155, 0.08), 0.08, d=hide)
        ruffd = None
        if detail:
            ruffd = (lambda P: 0.013 * NOISE.ridged(P * np.array([1.6, 1.6, 0.5]), 18.0, 3) - 0.004), 0.013
        neck_ax = sdf.frame(np.array(J["neck2"]) - np.array(J["neck"]))
        add(Ellipsoid((0, -0.70, 1.34), (0.12, 0.12, 0.24), axes=neck_ax), 0.05, tag="ruff", d=ruffd)
        add(Ellipsoid((0, -0.63, 1.44), (0.11, 0.09, 0.19), axes=neck_ax), 0.05, tag="ruff", d=ruffd)
        add(RoundCone((0, -0.71, 1.30), (0, -0.67, 1.13), 0.085, 0.025), 0.05, tag="ruff", d=ruffd)   # throat fringe
        # head: cranium, muzzle, nose, cheeks, eyes, ears, pedicles
        add(Ellipsoid((0, -0.895, 1.665), (0.078, 0.115, 0.083)), 0.05)
        add(RoundCone((0, -0.95, 1.635), (0, -1.15, 1.527), 0.066, 0.041), 0.04)
        add(Sphere((0, -1.155, 1.517), 0.041), 0.02, tag="nose")
        add(RoundCone((0, -0.905, 1.60), (0, -1.115, 1.497), 0.052, 0.03), 0.04, tag="muzzle")
        add(Ellipsoid((0, -1.06, 1.53), (0.05, 0.08, 0.04)), 0.03, tag="muzzle")
        if detail:
            S.sub(Ellipsoid((0, -1.12, 1.503), (0.048, 0.07, 0.0055)), k=0.004)      # the mouth line (bake only)
        for sx in (1, -1):
            S.add(Ellipsoid((sx * 0.071, -0.957, 1.677), (0.019, 0.025, 0.017)), k=0.006, tag="eye")
            add(Ellipsoid((sx * 0.06, -0.93, 1.70), (0.03, 0.05, 0.02)), 0.03)      # brow
            e0, e1 = np.array(mirror(J["ear"], sx)), np.array(mirror(J["ear_tip"], sx))
            ec = (e0 + e1) / 2
            ax = sdf.frame(e1 - e0, (0, 0, 1))
            add(Ellipsoid(ec, (0.042, 0.017, 0.085), axes=ax), 0.03, tag="ear")
            add(RoundCone(mirror((0.055, -0.872, 1.725), sx), mirror(J["antler"], sx), 0.03, 0.033), 0.02, tag="pedicle")
            add(Torus(mirror(J["antler"], sx), 0.03, 0.012, axes=sdf.frame(np.array(J["antler_tip"]) * [sx, 1, 1] - np.array(mirror(J["antler"], sx)))), 0.006, tag="pedicle")
        # tail (short, pale underside)
        add(RoundCone(J["tail"], J["tail2"], 0.055, 0.05), 0.04, tag="tail")
        add(RoundCone(J["tail2"], J["tail_end"], 0.05, 0.022), 0.02, tag="tail")
        # legs
        for sx in (1, -1):
            m = lambda k: mirror(J[k], sx)  # noqa: E731
            add(RoundCone(m("hip"), m("stifle"), 0.115, 0.07), 0.08, d=hide)
            add(RoundCone(m("stifle"), m("hock"), 0.068, 0.038), 0.05, d=hide)
            add(Sphere(m("hock"), 0.038), 0.02, tag="leg")
            add(RoundCone(m("hock"), m("hfet"), 0.033, 0.029), 0.02, tag="leg")
            add(Sphere(m("hfet"), 0.035), 0.015, tag="leg")
            add(RoundCone(m("shoulder"), m("elbow"), 0.095, 0.068), 0.07, d=hide)
            add(RoundCone(m("elbow"), m("carpus"), 0.062, 0.037), 0.035, d=hide)
            add(Sphere(m("carpus"), 0.041), 0.02, tag="leg")
            add(RoundCone(m("carpus"), m("ffet"), 0.032, 0.029), 0.02, tag="leg")
            add(Sphere(m("ffet"), 0.035), 0.015, tag="leg")
            for fet, tip in (("hfet", "htip"), ("ffet", "ftip")):
                f, t = np.array(m(fet)), np.array(m(tip))
                base = np.array([f[0], (f[1] + t[1]) / 2 + 0.005, 0.03])
                add(RoundCone(f + np.array([0, -0.004, -0.03]), base, 0.031, 0.043), 0.012, tag="hoof")
        S.inter(HalfSpace((0, 0, 0.004), (0, 0, -1), extent=3.0), k=0.004)
        return {"body": S}

    def hard(self, col):
        """Antlers: clusters of faceted dawnglass crystals on chalk pedicles (rigid to antler.L/R)."""
        out = []
        for s, sx in (("L", 1), ("R", -1)):
            v, f = [], []
            m = lambda p: (p[0] * sx, p[1], p[2])  # noqa: E731
            tw = 0.3 if sx > 0 else -0.3
            # main beam (three stacked crystals) up, out and back, the top curling forward
            crystal(v, f, m((0.072, -0.872, 1.765)), m((0.165, -0.835, 1.96)), 0.05, 0.043, twist=tw)
            crystal(v, f, m((0.155, -0.838, 1.94)), m((0.265, -0.80, 2.09)), 0.042, 0.034, twist=tw + 0.4)
            crystal(v, f, m((0.255, -0.802, 2.075)), m((0.33, -0.85, 2.165)), 0.033, 0.024, tip=0.05, twist=tw + 0.8)
            # brow tine (forward over the face), trez tine, crown points, a back point
            crystal(v, f, m((0.095, -0.86, 1.83)), m((0.135, -0.98, 1.875)), 0.03, 0.022, tip=0.07, twist=tw)
            crystal(v, f, m((0.19, -0.83, 1.99)), m((0.23, -0.95, 2.065)), 0.026, 0.019, tip=0.06, twist=tw + 0.2)
            crystal(v, f, m((0.27, -0.80, 2.09)), m((0.36, -0.73, 2.15)), 0.024, 0.017, tip=0.055, twist=tw + 0.5)
            crystal(v, f, m((0.285, -0.81, 2.10)), m((0.29, -0.90, 2.16)), 0.022, 0.016, tip=0.05, twist=tw + 0.9)
            crystal(v, f, m((0.215, -0.81, 2.02)), m((0.27, -0.71, 2.07)), 0.022, 0.016, tip=0.05, twist=tw + 1.2)
            # small shards at the beam joints (crystal growth)
            crystal(v, f, m((0.16, -0.84, 1.95)), m((0.205, -0.86, 1.995)), 0.016, 0.012, tip=0.03, twist=tw)
            crystal(v, f, m((0.26, -0.80, 2.08)), m((0.235, -0.75, 2.12)), 0.014, 0.01, tip=0.03, twist=tw)
            ob = mesh_object(f"antler_{s}", v, f, col)
            ob.data.polygons.foreach_set("use_smooth", np.zeros(len(ob.data.polygons), dtype=bool))
            out.append(("antlers", ob, f"antler.{s}"))
        return out

    # ── paint ──
    def paint(self, part, V, N, tags):
        P = self.PAL
        c = lambda k: K.hexc(P[k])  # noqa: E731
        n = len(V)
        z, y, x = V[:, 2], V[:, 1], V[:, 0]
        nz = N[:, 2]
        # base hide: chalk back, slightly greyer flanks, pale belly, legs darkening into socks
        col = np.tile(c("hide"), (n, 1))
        flank = _smooth_arr(0.6, 0.0, nz)[:, None]
        col = col * (1 - 0.6 * flank) + c("flank") * 0.6 * flank
        belly = (_smooth_arr(-0.2, -0.7, nz) * _smooth_arr(1.1, 0.85, z))[:, None]
        col = col * (1 - belly) + c("belly") * belly
        legz = _smooth_arr(0.78, 0.5, z)[:, None]
        col = col * (1 - legz) + c("leg") * legz
        sock = _smooth_arr(0.32, 0.18, z)[:, None]
        col = col * (1 - sock) + c("sock") * sock
        # hour-tick bands across the back (faint dial marks), from above
        top = _smooth_arr(0.3, 0.8, nz) * _smooth_arr(0.98, 1.15, z) * _smooth_arr(-0.25, -0.15, y) * _smooth_arr(0.62, 0.52, y)
        ticks = np.clip(1 - np.abs(((y + 0.2) / 0.16) % 1.0 - 0.5) / 0.09, 0, 1) ** 2 * top
        col = col * (1 - 0.55 * ticks[:, None]) + c("tick") * 0.55 * ticks[:, None]
        rough = np.full(n, 0.82)
        # tagged regions (nearest tag wins, 1 cm blend)
        dmin = np.min(np.stack(list(tags.values())), 0)
        for tag, key, r in (("ruff", "ruff", 0.9), ("muzzle", "muzzle", 0.7), ("nose", "nose", 0.4), ("eye", "eye", 0.15),
                            ("ear", None, 0.8), ("hoof", "hoof", 0.5), ("rump", "rump", 0.85), ("tail", None, 0.85),
                            ("pedicle", "pedicle", 0.6)):
            if tag not in tags:
                continue
            w = np.clip(1 - (tags[tag] - dmin) / 0.01, 0, 1) * (tags[tag] < 0.02)
            if tag == "muzzle":
                # the dark muzzle fades in toward the nose
                w = w * _smooth_arr(-0.98, -1.1, y)
                key_col = c("muzzle")
            elif tag == "ear":
                inner = _smooth_arr(0.1, 0.6, -N[:, 1])
                key_col = c("hide") * (1 - inner[:, None]) + c("ear_in") * inner[:, None]
            elif tag == "tail":
                under = _smooth_arr(0.2, -0.5, nz)
                key_col = c("hide") * (1 - under[:, None]) + c("rump") * under[:, None]
            else:
                key_col = c(key)
            col = col * (1 - w[:, None]) + key_col * w[:, None]
            rough = rough * (1 - w) + r * w
        # eye catch light rim: a lighter lid ring around the dark eye
        return col, rough

    def high_material(self, part, grad):
        return K.painted_material(f"{self.ID}_{part}_src", self.PAL["hide"], grad, fur=0.05, fur_scale=(2.0, 0.6, 2.0))

    def hard_material(self, part, grad):
        pal = materials.bible_palette(dawnglass="#C9DDEB")
        return materials.glass(f"{self.ID}_{part}_src", pal, "dawnglass", grad, rough=0.12, depth=0.45, inclusions=0.25)

    def weight_fix(self, ob):
        self.side_masks(ob, front_y=0.0, band=0.14)
        J = self.J
        h, lip = np.array(J["jaw"]), np.array((0, -1.12, 1.503))

        def jaw_t(V):
            y, z = V[:, 1], V[:, 2]
            zl = h[2] + (y - h[1]) * (lip[2] - h[2]) / (lip[1] - h[1])
            below = _smooth_arr(zl + 0.004, zl - 0.006, z)
            fwd = _smooth_arr(h[1] + 0.02, h[1] - 0.04, y)
            return below * fwd
        K.split_weights(ob, "head", "jaw", jaw_t)
        K.smooth_weights(ob, iters=2, k=0.5)

    # ── clips ──
    def clips(self, rig):
        J = self.J
        R0 = rig.rest_pose().legs
        C = np.array([0, 0.0, 1.07])          # body pivot (centre of mass)
        H = np.array(J["hips"])
        spd = self.RUN_SPEED

        def legs_planted(P, d=None):
            for k, lg in R0.items():
                P.legs[k] = Leg(p=lg.p, a=lg.a, t=lg.t)

        def body(P, pitch=0.0, roll=0.0, yaw=0.0, lift=(0, 0, 0), c=C):
            R = rot(pitch, yaw, roll)
            P.hips_rot = R
            P.hips_loc = pivot(R, c, H) + np.array(lift, dtype=np.float64)

        # idle: 3 s breathing, a slow look around, an ear flick, a tail flick, weight shifts
        def idle(t):
            P = rig.rest_pose()
            body(P, pitch=0.6 * wave(t, 0.1, 2), roll=0.8 * wave(t, 0.3), lift=(0.01 * wave(t, 0.05), 0, 0.006 * wave(t, 0, 2)))
            look = spline([(0, 0), (0.18, 9), (0.42, 9), (0.58, -7), (0.82, -7), (1.0, 0)], t, period=1.0)
            nod = spline([(0, 0), (0.2, -3), (0.45, 2), (0.6, -4), (0.85, 1), (1.0, 0)], t, period=1.0)
            P.r("spine", p=0.6 * wave(t, 0, 2)).r("chest", p=-0.9 * wave(t, 0.05, 2))
            P.r("neck", y=look * 0.35, p=nod * 0.5).r("neck2", y=look * 0.35, p=nod * 0.5).r("head", y=look * 0.3, r=-look * 0.25, p=nod)
            flick = math.exp(-((t - 0.62) / 0.02) ** 2) * 35
            P.r("ear.L", y=6 + 4 * wave(t, 0.2, 2) + flick).r("ear.R", y=-6 - 4 * wave(t, 0.4, 2))
            swish = math.exp(-((t - 0.3) / 0.035) ** 2)
            P.r("tail", y=20 * swish * wave(t, 0.3, 9), p=-6 * swish).r("tail2", y=25 * swish * wave(t, 0.25, 9))
            P.r("jaw", p=-1.5 * max(0, wave(t, 0.4, 3)))
            return P

        # run: bounding gallop at 3.4 m/s (hinds together, fronts together, a gathered suspension)
        RUN_F = 21
        stride = spd * RUN_F / K.FPS
        G = {"HL": (0.00, 0.36, 0.21, 18, -32, -58, 28, 1.0), "HR": (0.07, 0.36, 0.21, 18, -32, -58, 28, 1.0),
             "FL": (0.43, 0.33, 0.26, 10, -26, -62, 24, 1.0), "FR": (0.51, 0.33, 0.26, 10, -26, -62, 24, 1.0)}

        def run(t):
            P = rig.rest_pose()
            for k, (ph, duty, lift, a_td, a_lo, a_fold, a_reach, _) in G.items():
                r = R0[k]
                u = (t - ph) % 1.0
                dy, dz, st, s = K.foot_path(u, duty, stride, lift, tangent=0.5 if k[0] == "F" else 0.8, lift_peak=0.4)
                p = (r.p[0], r.p[1] + dy, r.p[2] + dz)
                if st:
                    a = lerp(a_td, a_lo, s)
                    tt = r.t
                else:
                    a = spline([(0, a_lo), (0.3, a_fold), (0.75, a_reach), (1.0, a_td)], s)
                    tt = spline([(0, r.t), (0.25, r.t - 55), (0.7, r.t - 10), (1.0, r.t)], s)
                P.legs[k] = Leg(p=p, a=a, t=tt)
            z = spline([(0, -0.04), (0.18, -0.07), (0.36, -0.02), (0.5, -0.06), (0.68, -0.07), (0.92, 0.01), (1.0, -0.04)], t, period=1.0)
            pitch = spline([(0, 2), (0.22, 6), (0.42, -1), (0.66, -6), (0.9, -1), (1.0, 2)], t, period=1.0)
            flex = spline([(0, 5), (0.25, -2), (0.45, -6), (0.7, 0), (0.93, 7), (1.0, 5)], t, period=1.0)
            body(P, pitch=pitch, lift=(0, 0, z))
            P.r("hips", p=flex * 0.6)
            P.r("spine", p=-flex * 0.45).r("chest", p=-flex * 0.45)
            P.r("neck", p=-pitch * 0.5 + 4 + 3 * wave(t, 0.1)).r("neck2", p=-pitch * 0.2 + 2).r("head", p=-pitch * 0.4 - 3 * wave(t, 0.15))
            P.r("ear.L", y=32).r("ear.R", y=-32)
            P.r("tail", p=-25 + 8 * wave(t, 0.3)).r("tail2", p=-10 + 10 * wave(t, 0.4))
            P.r("jaw", p=-3)
            return P

        # attack1: antler hook (wind back, drive in and up at 40 %, toss, recover)
        def attack(t):
            P = rig.rest_pose()
            legs_planted(P)
            k = [(0, 0), (0.28, -1), (0.4, 1), (0.55, 0.6), (1.0, 0)]
            w = spline(k, t)
            back = max(0.0, -w)
            fw = max(0.0, w)
            body(P, pitch=-4 * back - 3 * fw, lift=(0, 0.07 * back - 0.13 * fw, -0.05 * back - 0.03 * fw))
            # step: FL plants forward during the lunge
            st = smooth((t - 0.26) / 0.12) - smooth((t - 0.72) / 0.16)
            fl = R0["FL"]
            lift = 0.12 * math.sin(math.pi * min(1, max(0, (t - 0.26) / 0.12))) + 0.1 * math.sin(math.pi * min(1, max(0, (t - 0.72) / 0.16)))
            P.legs["FL"] = Leg(p=(fl.p[0], fl.p[1] - 0.16 * st, fl.p[2] + lift), a=fl.a + 8 * st, t=fl.t)
            head_p = spline([(0, 0), (0.28, -38), (0.36, -40), (0.42, -8), (0.55, 14), (0.75, 4), (1.0, 0)], t)
            neck_p = spline([(0, 0), (0.28, -14), (0.4, 6), (0.55, 10), (1.0, 0)], t)
            hook = spline([(0, 0), (0.28, 8), (0.4, -10), (0.55, -14), (1.0, 0)], t)
            P.r("neck", p=neck_p, y=hook * 0.3).r("neck2", p=neck_p * 0.8).r("head", p=head_p, r=hook)
            P.r("ear.L", y=25 * (back + fw)).r("ear.R", y=-25 * (back + fw))
            P.r("tail", p=-15 * fw).r("jaw", p=-4 * fw)
            P.r("spine", p=3 * back).r("chest", p=-4 * back + 3 * fw)
            return P

        # cast_a1: Glass Bellow (rear the head up, antlers flare; at 40 % drive forward and bellow)
        def bellow(t):
            P = rig.rest_pose()
            legs_planted(P)
            rear = spline([(0, 0), (0.3, 1), (0.36, 0.95), (0.42, -0.2), (0.75, -0.25), (1.0, 0)], t)
            blow = spline([(0, 0), (0.36, 0), (0.42, 1), (0.72, 0.9), (0.88, 0.2), (1.0, 0)], t)
            body(P, pitch=3 * max(0, rear) - 3 * blow, lift=(0, 0.03 * max(0, rear) - 0.06 * blow, -0.03 * blow))
            P.r("chest", p=4 * max(0, rear) - 2 * blow)
            P.r("neck", p=22 * max(0, rear) - 12 * blow).r("neck2", p=16 * max(0, rear) - 6 * blow)
            P.r("head", p=26 * max(0, rear) - 12 * blow + 3 * blow * wave(t, 0, 9))
            flare = spline([(0, 0), (0.3, 1), (0.45, 1.1), (0.8, 0.9), (1.0, 0)], t)
            P.r("antler.L", y=-12 * flare, r=14 * flare).r("antler.R", y=12 * flare, r=-14 * flare)
            P.r("jaw", p=-26 * blow - 4 * max(0, rear))
            P.r("ear.L", y=40 * blow + 10 * max(0, rear)).r("ear.R", y=-40 * blow - 10 * max(0, rear))
            P.r("tail", p=-20 * max(0, rear) - 10 * blow)
            return P

        # death: stagger, kneel on the front knees, roll onto the left side, settle
        def death(t):
            P = rig.rest_pose()
            kneel = smooth(t / 0.3)
            fall = smooth((t - 0.28) / 0.34)
            settle = smooth((t - 0.6) / 0.4)
            pitch = -14 * kneel * (1 - fall) - 2 * fall
            roll = -(94 * fall + 3 * math.sin(math.pi * settle))       # onto the right side, legs out
            sway = 4 * math.sin(math.pi * min(1, t / 0.25))
            R = rot(pitch, 0, roll + sway * (1 - fall))
            c_kneel = np.array([0.0, 0.05, 0.80])
            c_lie = np.array([-0.30, 0.05, 0.265])
            c1 = (C * (1 - kneel) + c_kneel * kneel) * (1 - fall) + c_lie * fall
            P.hips_rot = R
            P.hips_loc = c1 + R @ (H - C) - H
            # front legs fold under (kneel on the carpus), then everything goes limp in the body frame
            for k in ("FL", "FR"):
                r = R0[k]
                kp = (r.p[0], -0.14, 0.06)
                p = tuple(lerp(np.array(r.p), np.array(kp), kneel))
                a = lerp(r.a, -88, kneel)
                P.legs[k] = Leg(p=p, a=a, t=lerp(r.t, 70, kneel), pb=(0, 0.16, 0.24), ab=-40, tb=15, wb=fall)
            for k in ("HL", "HR"):
                r = R0[k]
                P.legs[k] = Leg(p=r.p, a=r.a, t=r.t, pb=(0, -0.12, 0.16), ab=-20, tb=25, wb=fall)
            drop = smooth((t - 0.5) / 0.4)
            # the neck lies out along the ground; the head counter-rolls so the glass antlers lie flat
            P.r("neck", p=-18 * kneel * (1 - fall) - 6 * fall, y=8 * fall).r("neck2", y=6 * fall, p=-4 * drop)
            P.r("head", p=-20 * kneel * (1 - fall) - 6 * drop, r=40 * fall)
            P.r("jaw", p=-8 * drop)
            P.r("ear.L", y=30 * fall, p=-10 * drop).r("ear.R", y=-30 * fall)
            P.r("tail", p=12 * fall, y=10 * drop)
            P.r("spine", r=6 * drop).r("chest", r=4 * drop)
            return P

        return [Clip("idle", 90, idle, loop=True), Clip("run", RUN_F, run, loop=True),
                Clip("attack1", 30, attack, impact=0.4), Clip("cast_a1", 35, bellow, impact=0.4),
                Clip("death", 45, death)]


# ════════════════════════════════════════════════════════════════════════════════════════════════
def surface_point(prim, origin, direction, far: float = 2.0, step: float = 0.01):
    """First crossing (inside -> outside) of an SDF primitive along a ray from an interior origin."""
    o, d = V3(origin), K.nrm(direction)
    ts = np.arange(0.0, far, step)
    P = o[None, :] + ts[:, None] * d[None, :]
    dd = prim.d(P)
    i = int(np.argmax(dd > 0))
    a, b = ts[max(0, i - 1)], ts[i]
    for _ in range(20):
        m = (a + b) / 2
        if prim.d((o + m * d)[None, :])[0] > 0:
            b = m
        else:
            a = m
    return o + d * (a + b) / 2


def resin_material(name: str):
    """Bake source for hardened lamp resin: vertex colour (deep rim -> warm core) with suspended
    bubbles and a soft streak breakup; glossy. The GLB material re-uses the baked colour as its
    (faint) emission, so the warm core reads as light deep inside the resin."""
    m, g = materials._new(name)
    at = g.n("ShaderNodeAttribute")
    at.attribute_name = "Col"
    at.attribute_type = "GEOMETRY"
    c = at.outputs["Color"]
    st = g.noise(g.mapping(g.obj, scale=(1.0, 1.0, 2.5)), scale=9.0, detail=2.0, rough=0.5, distortion=1.2)
    c = g.mix(c, g.ramp(st.outputs["Fac"], [(0.3, 0.86), (0.7, 1.08)]), 1.0, "MULTIPLY")
    sp = g.voronoi(scale=38.0, feature="F1")
    dots = g.ramp(sp.outputs["Distance"], [(0.0, 1.0), (0.09, 0.0)])
    c = g.mix(c, materials.shade_hex("#FFD27A", 1.0, 0.8), g.math("MULTIPLY", dots, 0.45))
    ao = g.ao(distance=0.05, samples=8)
    c = g.mix(c, materials.shade_hex("#4A1C08"), g.math("MULTIPLY", g.ramp(ao, [(0.35, 1.0), (0.9, 0.0)]), 0.6))
    g.set_bsdf(color=c, rough=at.outputs["Alpha"], metal=0.0, specular=0.6,
               normal=g.bump(st.outputs["Fac"], strength=0.05, distance=0.002))
    return m


class Resinback(Creature):
    ID = "resinback"
    HEIGHT = 1.8
    BODY_TOP = 1.4
    RUN_SPEED = 3.3                 # units.json base.moveSpeed
    TRIS = {"body": 7000, "resin": 3200}
    VOX_PART = {"resin": 0.011}
    PART_BIND = {"resin": "transfer"}
    GLOW = {"resin": ("resinback_lampresin", 0.6)}
    UV_WEIGHTS = {1: 0.8}
    FRONT_TOE = "paw"
    BAKE_RAY = (0.025, 0.08)
    WRIST_MIN = 0.10
    BALL_MIN = 0.058
    PAL = {"hide": "#544234", "belly": "#6A5644", "leg": "#45372B", "paw": "#2F2721", "claw": "#CDBFA3",
           "muzzle": "#6E6153", "nose": "#211B17", "eye": "#140E0A", "throat": "#7B6551", "stain": "#8E5A28",
           "ear_in": "#8A6A58", "rim": "#6A2C0A", "mid": "#B25F18", "core": "#F2A83C"}

    def joints(self):
        return dict(
            hips=(0, 0.52, 0.98), spine=(0, 0.12, 1.08), chest=(0, -0.30, 1.16), neck=(0, -0.58, 1.12),
            head=(0, -0.86, 1.00), snout=(0, -1.30, 0.84), jaw=(0, -0.93, 0.87), chin=(0, -1.24, 0.75),
            tail=(0, 0.86, 0.92), tail2=(0, 1.04, 0.78), tail_end=(0, 1.16, 0.62),
            ear=(0.15, -0.88, 1.10), ear_tip=(0.25, -0.84, 1.17),
            withers=(0.20, -0.36, 1.30), shoulder=(0.30, -0.50, 0.95), elbow=(0.30, -0.36, 0.62),
            wrist=(0.30, -0.52, 0.20), fball=(0.30, -0.68, 0.06), ftip=(0.30, -0.82, 0.015),
            hip=(0.24, 0.58, 0.85), knee=(0.24, 0.40, 0.52), hock=(0.24, 0.66, 0.22), hball=(0.24, 0.58, 0.05),
            htip=(0.24, 0.47, 0.015),
        )

    def bones(self):
        return self.quad_bones(necks=("neck",))

    def legdefs(self):
        return self.quad_legs()

    def body_sculpt(self, detail):
        J = self.J
        S = Sculpt("body")
        hair = ((lambda P: 0.006 * NOISE.fbm(P * np.array([1.0, 0.4, 1.0]), 16.0, 3)), 0.006) if detail else None

        def add(prim, k, tag="hide", d=None):
            if d is not None:
                prim = prim.displaced(d[0], d[1] + 0.004)
            S.add(prim, k=k, tag=tag)
        add(Ellipsoid((0, -0.30, 0.98), (0.46, 0.46, 0.42)), 0.0, d=hair)               # forequarters
        add(Ellipsoid((0, 0.15, 0.93), (0.40, 0.45, 0.35)), 0.15, d=hair)               # barrel
        add(Ellipsoid((0, 0.55, 0.86), (0.36, 0.36, 0.30)), 0.15, d=hair)               # hindquarters
        add(Ellipsoid((0, -0.32, 1.22), (0.34, 0.36, 0.20)), 0.12, d=hair)              # shoulder hump
        add(RoundCone((0, -0.55, 1.06), (0, -0.86, 0.98), 0.30, 0.22), 0.10, d=hair)    # neck
        add(Ellipsoid((0, -0.82, 0.76), (0.19, 0.17, 0.14)), 0.08, tag="throat")        # dewlap
        add(Ellipsoid((0, -0.98, 0.97), (0.22, 0.24, 0.165)), 0.06)                      # skull
        add(Ellipsoid((0, -1.06, 1.045), (0.20, 0.08, 0.055)), 0.04)                    # brow ridge
        add(RoundCone((0, -1.05, 0.93), (0, -1.27, 0.865), 0.15, 0.11), 0.05, tag="muzzle")
        add(Ellipsoid((0, -1.35, 0.865), (0.09, 0.05, 0.07)), 0.03, tag="nose")
        add(RoundCone((0, -0.92, 0.82), (0, -1.22, 0.765), 0.16, 0.09), 0.05)            # heavy jaw
        if detail:
            S.sub(Ellipsoid((0, -1.13, 0.818), (0.115, 0.14, 0.008)), k=0.006)           # the mouth line
        for sx in (1, -1):
            S.add(Ellipsoid((sx * 0.155, -1.085, 0.99), (0.026, 0.03, 0.022)), k=0.008, tag="eye")
            e0, e1 = np.array(mirror(J["ear"], sx)), np.array(mirror(J["ear_tip"], sx))
            add(Ellipsoid((e0 + e1) / 2, (0.05, 0.022, 0.07), axes=sdf.frame(e1 - e0, (0, 0, 1))), 0.03, tag="ear")
        add(RoundCone(J["tail"], J["tail2"], 0.11, 0.08), 0.06)
        add(RoundCone(J["tail2"], J["tail_end"], 0.08, 0.035), 0.03)
        for sx in (1, -1):
            m = lambda k: mirror(J[k], sx)  # noqa: E731
            # thick forelegs: a heavy upper arm, a forearm with a muscle bulge, a broad paw with four claws
            add(RoundCone(m("shoulder"), m("elbow"), 0.21, 0.16), 0.12, d=hair)
            add(RoundCone(m("elbow"), m("wrist"), 0.155, 0.10), 0.05, d=hair)
            add(Ellipsoid(mirror((0.315, -0.43, 0.46), sx), (0.13, 0.12, 0.18)), 0.05, d=hair)
            add(Sphere(m("wrist"), 0.10), 0.04, tag="leg")
            add(Ellipsoid(mirror((0.30, -0.665, 0.075), sx), (0.14, 0.17, 0.075)), 0.05, tag="paw")
            for dx in (-0.075, -0.025, 0.025, 0.075):
                a = np.array(mirror((0.30 + dx, -0.78, 0.06), sx))
                b = np.array(mirror((0.30 + dx * 1.15, -0.865, 0.018), sx))
                add(RoundCone(a, b, 0.024, 0.008), 0.008, tag="claw")
            add(RoundCone(m("hip"), m("knee"), 0.20, 0.13), 0.12, d=hair)
            add(RoundCone(m("knee"), m("hock"), 0.12, 0.075), 0.05, d=hair)
            add(Sphere(m("hock"), 0.07), 0.03, tag="leg")
            add(RoundCone(m("hock"), m("hball"), 0.07, 0.06), 0.03, tag="leg")
            add(Ellipsoid(mirror((0.24, 0.55, 0.055), sx), (0.11, 0.14, 0.055)), 0.04, tag="paw")
            for dx in (-0.05, 0.0, 0.05):
                a = np.array(mirror((0.24 + dx, 0.45, 0.045), sx))
                b = np.array(mirror((0.24 + dx * 1.1, 0.39, 0.016), sx))
                add(RoundCone(a, b, 0.02, 0.007), 0.007, tag="claw")
        S.inter(HalfSpace((0, 0, 0.004), (0, 0, -1), extent=3.0), k=0.004)
        return S

    def resin_sculpt(self, detail):
        """Hardened lamp-resin plates: an upright crest of slabs along the spine (tallest over the shoulder
        hump: the 1.8 m top) and two staggered rows of shingled slabs down each flank (lower edges
        lifted), a few drips. Each plate is a rounded slab; its centre carries the warm inner light."""
        body = sdf.Blend([(op, prim, k) for op, prim, k, _ in self.body_sculpt(False).ops])
        R = Sculpt("resin")
        lump = ((lambda P: 0.006 * NOISE.fbm(P, 8.0, 2)), 0.006) if detail else None
        self.plates = []

        def slab(c, half, F, tag_k=0.012, rr=0.03, thin=2):
            prim = sdf.RoundBox(c, half, rr, axes=F)
            if lump:
                prim = prim.displaced(lump[0], lump[1] + 0.004)
            R.add(prim, k=tag_k, tag=f"p{len(self.plates)}")
            u, v = [i for i in range(3) if i != thin]
            # (centre, face normal, in-plane axes u / v, half extents along u / v)
            self.plates.append((V3(c), F[thin], F[u], F[v], np.array([half[u], half[v]])))
        # crest: (y, half length along the body, height; None = reach the 1.8 m top)
        crest = [(-0.62, 0.085, 0.13), (-0.39, 0.12, None), (-0.13, 0.115, 0.30), (0.12, 0.105, 0.24), (0.35, 0.09, 0.18),
                 (0.56, 0.075, 0.12)]
        lean = 24.0
        for y, L, h in crest:
            sp = surface_point(body, (0, y, 0.8), (0, 0, 1))
            if h is None:
                h = (1.775 - sp[2]) / (0.75 * math.cos(math.radians(lean)))
            # rows of F: X lateral (thin), Y along the body, Z up - leaning back (top toward +Y)
            Rl = sdf.rot_x(-lean)
            F = np.stack([Rl @ np.array([1.0, 0, 0]), Rl @ np.array([0, 1.0, 0]), Rl @ np.array([0, 0, 1.0])])
            c = sp + F[2] * (h * 0.25)
            slab(c, (0.065, L, h * 0.5), F, rr=0.05, thin=0)
        rows = [(-0.47, 33, 1.2), (-0.21, 35, 1.1), (0.05, 33, 1.0), (0.29, 36, 0.92), (0.51, 38, 0.78),
                (-0.34, 61, 1.0), (-0.08, 59, 0.95), (0.18, 62, 0.88), (0.42, 60, 0.76)]
        rng = np.random.RandomState(11)
        for sx in (1, -1):
            for y, th, sz in rows:
                sz *= 1 + 0.1 * rng.uniform(-1, 1)
                th += rng.uniform(-3, 3)
                d = np.array([sx * math.sin(math.radians(th)), 0, math.cos(math.radians(th))])
                sp = surface_point(body, (0, y + rng.uniform(-0.02, 0.02), 0.85), d)
                # slab frame: Z = outward normal, Y = along the body; shingle: the lower edge lifts away and
                # the rear edge laps over the next plate; each slab turned a little (grown, not laid)
                Fz = K.nrm(d)
                Fy = K.nrm(np.array([0, 1.0, 0]) - Fz * Fz[1])
                Fx = np.cross(Fy, Fz)
                F = np.stack([Fx, Fy, Fz])
                Rs = K.rodrigues_m(Fy, math.radians(-14 * sx)) @ K.rodrigues_m(Fx, math.radians(-8)) @ \
                    K.rodrigues_m(Fz, math.radians(rng.uniform(-12, 12)))
                F = (Rs @ F.T).T
                slab(sp + Fz * 0.01, (0.15 * sz, 0.13 * sz, 0.032 + 0.012 * sz), F, rr=0.055 * sz)
            for y in (-0.36, 0.12, 0.46):
                d = np.array([sx * math.sin(math.radians(76)), 0, math.cos(math.radians(76))])
                sp = surface_point(body, (0, y, 0.85), d)
                R.add(RoundCone(sp + d * 0.015, sp + d * 0.03 + np.array([0, 0.01, -0.12]), 0.028, 0.015), k=0.02,
                      tag=f"p{len(self.plates)}")
                self.plates.append((sp, d, np.array([0, 1.0, 0]), np.array([0, 0, -1.0]), np.array([0.03, 0.06])))
        return R

    def sculpts(self, detail):
        return {"body": self.body_sculpt(detail), "resin": self.resin_sculpt(detail)}

    def paint(self, part, V, N, tags):
        P = self.PAL
        c = lambda k: K.hexc(P[k])  # noqa: E731
        n = len(V)
        z, y = V[:, 2], V[:, 1]
        if part == "resin":
            # nearest plate: its edges and sides are deep red-brown, its middle holds the warm light
            keys = [k for k in tags if k.startswith("p")]
            D = np.stack([tags[k] for k in keys])
            idx = np.array([int(keys[i][1:]) for i in np.argmin(D, 0)])
            ctr = np.array([p[0] for p in self.plates])[idx]
            ax = np.array([p[1] for p in self.plates])[idx]
            ux = np.array([p[2] for p in self.plates])[idx]
            uy = np.array([p[3] for p in self.plates])[idx]
            hs = np.array([p[4] for p in self.plates])[idx]
            rel = V - ctr
            r = np.sqrt((np.einsum("ij,ij->i", rel, ux) / np.maximum(hs[:, 0], 1e-3)) ** 2 +
                        (np.einsum("ij,ij->i", rel, uy) / np.maximum(hs[:, 1] * 1.1, 1e-3)) ** 2)
            facing = np.abs(np.einsum("ij,ij->i", N, ax))
            body_ = _smooth_arr(0.2, 0.75, facing) * _smooth_arr(1.0, 0.55, r)
            core = _smooth_arr(0.62, 0.12, r) * _smooth_arr(0.5, 0.9, facing)
            col = c("rim") * (1 - body_[:, None]) + c("mid") * body_[:, None]
            col = col * (1 - core[:, None]) + c("core") * core[:, None]
            return col, np.full(n, 0.18)
        col = np.tile(c("hide"), (n, 1))
        nz = N[:, 2]
        belly = (_smooth_arr(-0.2, -0.75, nz) * _smooth_arr(0.9, 0.6, z))[:, None]
        col = col * (1 - belly) + c("belly") * belly
        legz = _smooth_arr(0.55, 0.3, z)[:, None]
        col = col * (1 - legz) + c("leg") * legz
        # resin seeps into the hide around the plate bases
        resin = sdf.Blend([(op, prim, k) for op, prim, k, _ in self.resin_sculpt(False).ops])
        near = np.full(n, 1.0)
        m = (z > 0.6)
        if m.any():
            near[m] = resin.d(V[m])
        stain = _smooth_arr(0.07, 0.0, near)[:, None] * 0.7
        col = col * (1 - stain) + c("stain") * stain
        rough = np.full(n, 0.86)
        dmin = np.min(np.stack(list(tags.values())), 0)
        for tag, key, r in (("throat", "throat", 0.85), ("muzzle", "muzzle", 0.7), ("nose", "nose", 0.45),
                            ("eye", "eye", 0.15), ("paw", "paw", 0.7), ("claw", "claw", 0.45), ("ear", None, 0.8),
                            ("leg", "leg", 0.86)):
            if tag not in tags:
                continue
            w = np.clip(1 - (tags[tag] - dmin) / 0.012, 0, 1) * (tags[tag] < 0.03)
            if tag == "ear":
                inner = _smooth_arr(0.1, 0.6, -N[:, 1])
                kc = c("hide") * (1 - inner[:, None]) + c("ear_in") * inner[:, None]
            else:
                kc = c(key)
            col = col * (1 - w[:, None]) + kc * w[:, None]
            rough = rough * (1 - w) + r * w
        return col, rough

    def high_material(self, part, grad):
        if part == "resin":
            return resin_material(f"{self.ID}_resin_src")
        return K.painted_material(f"{self.ID}_{part}_src", self.PAL["hide"], grad, fur=0.06, fur_scale=(1.5, 0.5, 1.5),
                                  chalk=(1.45, 0.7))

    def weight_fix(self, ob):
        self.side_masks(ob, front_y=0.05, band=0.16)
        self.jaw_split(ob, self.J["jaw"], (0, -1.24, 0.818))
        K.smooth_weights(ob, iters=2, k=0.5)

    # ── clips ──
    def clips(self, rig):
        J = self.J
        R0 = rig.rest_pose().legs
        C = np.array([0, 0.0, 0.95])
        H = np.array(J["hips"])
        spd = self.RUN_SPEED

        def planted(P):
            for k, lg in R0.items():
                P.legs[k] = Leg(p=lg.p, a=lg.a, t=lg.t)

        def body(P, pitch=0.0, roll=0.0, yaw=0.0, lift=(0, 0, 0), c=C):
            R = rot(pitch, yaw, roll)
            P.hips_rot = R
            P.hips_loc = pivot(R, c, H) + np.array(lift, dtype=np.float64)

        def idle(t):
            P = rig.rest_pose()
            body(P, pitch=0.8 * wave(t, 0.1, 2), roll=1.4 * wave(t, 0.25), lift=(0.015 * wave(t, 0.0), 0, 0.01 * wave(t, 0, 2)))
            P.r("spine", p=1.0 * wave(t, 0, 2)).r("chest", p=-1.4 * wave(t, 0.05, 2))
            sway = spline([(0, 0), (0.25, 7), (0.5, 2), (0.75, -6), (1.0, 0)], t, period=1.0)
            sniff = math.exp(-((t - 0.55) / 0.05) ** 2)
            P.r("neck", y=sway * 0.5, p=-2 * wave(t, 0.2, 2) - 4 * sniff).r("head", y=sway * 0.5, p=-3 * sniff + 2 * sniff * wave(t, 0, 12))
            P.r("jaw", p=-2 * max(0, wave(t, 0.3, 3)))
            P.r("ear.L", y=5 * wave(t, 0.1, 2) + 25 * math.exp(-((t - 0.3) / 0.025) ** 2)).r("ear.R", y=-5 * wave(t, 0.4, 2))
            P.r("tail", y=10 * wave(t, 0.1), p=3 * wave(t, 0.3, 2)).r("tail2", y=14 * wave(t, 0.0))
            return P

        RUN_F = 18
        stride = spd * RUN_F / K.FPS
        G = {"HL": (0.00, 0.42, 0.16, 35, -5, -45, 40), "HR": (0.10, 0.42, 0.16, 35, -5, -45, 40),
             "FL": (0.50, 0.40, 0.20, 58, 18, -35, 62), "FR": (0.60, 0.40, 0.20, 58, 18, -35, 62)}

        def run(t):
            P = rig.rest_pose()
            for k, (ph, duty, lift, a_td, a_lo, a_fold, a_reach) in G.items():
                r = R0[k]
                u = (t - ph) % 1.0
                dy, dz, st, s = K.foot_path(u, duty, stride, lift, tangent=0.5 if k[0] == "F" else 0.9, lift_peak=0.4)
                if st:
                    a, tt = lerp(a_td, a_lo, s), r.t
                else:
                    a = spline([(0, a_lo), (0.3, a_fold), (0.75, a_reach), (1.0, a_td)], s)
                    tt = spline([(0, r.t), (0.3, r.t - 50), (0.75, r.t - 5), (1.0, r.t)], s)
                P.legs[k] = Leg(p=(r.p[0], r.p[1] + dy, r.p[2] + dz), a=a, t=tt)
            z = spline([(0, -0.02), (0.22, -0.06), (0.42, 0.0), (0.72, -0.07), (0.92, 0.0), (1.0, -0.02)], t, period=1.0)
            pitch = spline([(0, 2), (0.25, 4), (0.5, -1), (0.75, -4), (1.0, 2)], t, period=1.0)
            body(P, pitch=pitch, roll=2.5 * wave(t, 0.1), yaw=1.5 * wave(t, 0.35), lift=(0, 0, z))
            flex = spline([(0, 2), (0.3, -3), (0.55, -2), (0.8, 3), (1.0, 2)], t, period=1.0)
            P.r("spine", p=-flex * 0.5).r("chest", p=-flex * 0.5)
            P.r("neck", p=-pitch * 0.6 + 2 * wave(t, 0.2), y=-2 * wave(t, 0.35)).r("head", p=-pitch * 0.3 - 3 * wave(t, 0.25))
            P.r("jaw", p=-5 - 3 * wave(t, 0.3))
            P.r("ear.L", y=25).r("ear.R", y=-25)
            P.r("tail", p=-8 + 6 * wave(t, 0.4), y=6 * wave(t, 0.1)).r("tail2", p=6 * wave(t, 0.55))
            return P

        def attack(t):
            # right forepaw raised high, slammed down ahead at 40 %, a shake, recover
            P = rig.rest_pose()
            planted(P)
            up = spline([(0, 0), (0.3, 1), (0.36, 1.05), (0.4, 0), (1.0, 0)], t)
            slam = spline([(0, 0), (0.3, 0), (0.4, 1), (0.6, 0.9), (0.85, 0.15), (1.0, 0)], t)
            body(P, pitch=4 * up - 5 * slam, roll=-4 * up + 2 * slam, lift=(0.05 * up, 0.05 * up - 0.12 * slam, -0.02 * up - 0.05 * slam))
            fr = R0["FR"]
            fwd = spline([(0, 0), (0.3, 0.12), (0.4, 0.28), (0.72, 0.28), (0.9, 0.04), (1.0, 0)], t)
            lift = 0.42 * up + 0.10 * math.sin(math.pi * min(1, max(0, (t - 0.72) / 0.2)))
            a = lerp(fr.a, -20, up) if t < 0.4 else fr.a
            P.legs["FR"] = Leg(p=(fr.p[0], fr.p[1] - fwd, fr.p[2] + lift), a=a, t=lerp(fr.t, fr.t - 40, up))
            P.r("neck", y=-8 * up - 4 * slam, p=4 * up - 8 * slam).r("head", y=-6 * up, p=-6 * slam + 3 * slam * wave(t, 0, 8))
            P.r("jaw", p=-14 * up - 8 * slam)
            P.r("chest", r=3 * up).r("ear.L", y=30 * up).r("ear.R", y=-30 * up)
            P.r("tail", p=-12 * slam)
            return P

        def spit(t):
            # rear back (head up, throat full), lunge and spit at 40 %, hold, recover
            P = rig.rest_pose()
            rear = spline([(0, 0), (0.3, 1), (0.36, 1), (0.42, -0.3), (0.7, -0.25), (1.0, 0)], t)
            fire = spline([(0, 0), (0.34, 0), (0.4, 1), (0.62, 0.85), (0.85, 0.15), (1.0, 0)], t)
            rp = max(0.0, rear)
            body(P, pitch=9 * rp - 5 * fire, lift=(0, 0.1 * rp - 0.1 * fire, 0.02 * rp - 0.03 * fire))
            for k in ("FL", "FR"):
                r = R0[k]
                lf = 0.06 * rp
                P.legs[k] = Leg(p=(r.p[0], r.p[1] + 0.08 * rp, r.p[2] + lf), a=r.a - 25 * rp, t=r.t - 10 * rp)
            for k in ("HL", "HR"):
                P.legs[k] = Leg(p=R0[k].p, a=R0[k].a, t=R0[k].t)
            P.r("neck", p=22 * rp - 14 * fire).r("head", p=20 * rp - 8 * fire + 2 * fire * wave(t, 0, 10))
            P.r("jaw", p=-6 * rp - 34 * fire)
            P.r("chest", p=3 * rp - 2 * fire).r("ear.L", y=30 * (rp + fire)).r("ear.R", y=-30 * (rp + fire))
            P.r("tail", p=-14 * rp)
            return P

        def death(t):
            # buckles, collapses onto its belly with the legs splayed, the head drops, a last slump
            P = rig.rest_pose()
            sag = smooth(t / 0.22)
            fall = smooth((t - 0.15) / 0.4)
            slump = smooth((t - 0.6) / 0.35)
            c1 = C + np.array([0.02 * sag, 0.03 * fall, -0.43 * fall - 0.03 * sag])
            R = rot(-3 * sag * (1 - fall) - 2 * fall, 0, 6 * math.sin(math.pi * min(1, t / 0.3)) * (1 - fall) - 9 * slump)
            P.hips_rot = R
            P.hips_loc = c1 + R @ (H - C) - H
            for k, sx in (("FL", 1), ("FR", -1)):
                r = R0[k]
                P.legs[k] = Leg(p=r.p, a=r.a, t=r.t, pb=(0.16 * sx, -0.22, 0.45), ab=84, tb=92, wb=fall)
            for k, sx in (("HL", 1), ("HR", -1)):
                r = R0[k]
                P.legs[k] = Leg(p=r.p, a=r.a, t=r.t, pb=(0.12 * sx, 0.24, 0.43), ab=-85, tb=-95, wb=fall)
            drop = smooth((t - 0.35) / 0.45)
            P.r("neck", p=-6 * sag - 7 * drop, y=-8 * slump).r("head", p=-4 * drop, r=6 * slump)
            P.r("jaw", p=-10 * drop)
            P.r("ear.L", y=20 * drop).r("ear.R", y=-20 * drop)
            P.r("tail", p=18 * fall, y=12 * slump).r("tail2", p=10 * fall)
            return P

        return [Clip("idle", 90, idle, loop=True), Clip("run", RUN_F, run, loop=True),
                Clip("attack1", 30, attack, impact=0.4), Clip("cast_a1", 35, spit, impact=0.4),
                Clip("death", 45, death)]


# ════════════════════════════════════════════════════════════════════════════════════════════════
class Stilltusk(Creature):
    """A stocky boar: dial-stone grey hide, a black bristle mane with grizzled tips standing over the
    shoulders, and carved-stone tusks shaped like sundial gnomons (flat blades with hour notches)."""
    ID = "stilltusk"
    RUN_F = 12                      # frames per stride
    RUN_CYCLES = 2                  # strides per run clip
    HEIGHT = 1.4
    BODY_TOP = 1.12
    RUN_SPEED = 3.4                 # units.json base.moveSpeed
    TRIS = {"body": 6400, "tusks": 420}
    VOX_LOW = 0.010
    VOX_HIGH = 0.0065
    PART_BIND = {"tusks": "head"}
    UV_WEIGHTS = {1: 0.9}
    BAKE_RAY = (0.015, 0.05)
    WRIST_MIN = 0.04
    S = 1.0                         # overall scale (the juvenile is built from the same joints, smaller)
    YOUNG = False
    PAL = {"hide": "#5A4D44", "flank": "#4D423B", "belly": "#76695C", "leg": "#362E29", "hoof": "#26201C",
           "mane": "#1E1916", "mane_tip": "#9C8E7B", "snout": "#7E655C", "nose": "#3A2C28", "eye": "#120D0B",
           "ear_in": "#7A5E55", "tick": "#4A423C", "stripe": "#A1937F", "tusk": "#DCCFB5"}

    def joints(self):
        J = dict(
            hips=(0, 0.48, 0.82), spine=(0, 0.10, 0.90), chest=(0, -0.28, 0.98), neck=(0, -0.48, 0.95),
            head=(0, -0.66, 0.84), snout=(0, -1.10, 0.52), jaw=(0, -0.70, 0.66), chin=(0, -1.00, 0.46),
            tail=(0, 0.74, 0.86), tail2=(0, 0.84, 0.74), tail_end=(0, 0.88, 0.58),
            ear=(0.11, -0.66, 0.98), ear_tip=(0.19, -0.62, 1.11),
            withers=(0.13, -0.28, 1.02), shoulder=(0.19, -0.40, 0.70), elbow=(0.19, -0.30, 0.46),
            wrist=(0.19, -0.38, 0.22), fball=(0.19, -0.40, 0.075), ftip=(0.19, -0.47, 0.012),
            hip=(0.17, 0.48, 0.72), knee=(0.17, 0.34, 0.48), hock=(0.17, 0.54, 0.26), hball=(0.17, 0.50, 0.075),
            htip=(0.17, 0.43, 0.012),
        )
        return {k: tuple(self.zmap_pt(np.array(v) * self.S)) for k, v in J.items()}

    LEG_SHORTEN = 0.0               # adult units: the juvenile's legs are compressed by this much

    def zmap(self, z):
        """Vertical remap applied to the sculpted meshes AND the joints: legs below the belly compress by
        LEG_SHORTEN (scaled), everything above drops rigidly (stubby juvenile legs, same sculpt)."""
        if self.LEG_SHORTEN <= 0:
            return z
        s = self.S
        r = np.clip((z - 0.05 * s) / (0.42 * s), 0, 1)
        return z - self.LEG_SHORTEN * s * r

    def zmap_pt(self, p):
        p = np.array(p, dtype=np.float64)
        p[2] = self.zmap(p[2])
        return p

    def bones(self):
        return self.quad_bones(necks=("neck",))

    def legdefs(self):
        return self.quad_legs()

    def unmap(self, k):
        """A joint back in sculpt space (before the vertical remap)."""
        p = np.array(self.J[k], dtype=np.float64)
        if self.LEG_SHORTEN > 0:
            zs = np.linspace(-0.2, 2.0, 4000) * self.S
            p[2] = float(np.interp(p[2], self.zmap(zs), zs))
        return tuple(p)

    def body_sculpt(self, detail):
        J, s = {k: self.unmap(k) for k in self.J}, self.S
        S = Sculpt("body")
        bristle = ((lambda P: 0.005 * s * NOISE.fbm(P / s * np.array([1.4, 0.4, 1.4]), 20.0, 3)), 0.005 * s) if detail else None

        def add(prim, k, tag="hide", d=None):
            if d is not None:
                prim = prim.displaced(d[0], d[1] + 0.003)
            S.add(prim, k=k * s, tag=tag)

        def E(c, r, axes=None):
            return Ellipsoid(tuple(np.array(c) * s), tuple(np.array(r) * s), axes=axes)

        def RC(a, b, ra, rb):
            return RoundCone(tuple(np.array(a) * s), tuple(np.array(b) * s), ra * s, rb * s)
        y = self.YOUNG
        add(E((0, -0.22, 0.80), (0.30, 0.40, 0.32) if not y else (0.31, 0.40, 0.33)), 0.0, d=bristle)   # forequarters
        add(E((0, 0.15, 0.76), (0.27, 0.42, 0.27) if not y else (0.30, 0.40, 0.30)), 0.12, d=bristle)   # barrel
        add(E((0, 0.48, 0.74), (0.24, 0.26, 0.24)), 0.10, d=bristle)                                    # hams
        add(E((0, -0.25, 0.97), (0.22, 0.28, 0.14)), 0.10, d=bristle)                                   # hump
        add(RC((0, -0.42, 0.88), (0, -0.66, 0.82), 0.26, 0.20), 0.10, d=bristle)                        # neck
        hb = 1.0 if not y else 1.16                                                                     # big young head
        add(E((0, -0.74, 0.78), (0.17 * hb, 0.20 * hb, 0.17 * hb)), 0.06)                               # head
        add(RC((0, -0.78, 0.74), (0, -1.06, 0.56) if not y else (0, -1.02, 0.585), 0.14 * hb, 0.08 * hb), 0.06)
        add(RC((0, -0.72, 0.64), (0, -1.00, 0.49) if not y else (0, -0.96, 0.51), 0.11 * hb, 0.06 * hb), 0.05)
        sn = sdf.frame(np.array([0, -0.75, -0.66]))
        add(E((0, -1.095, 0.54) if not y else (0, -1.06, 0.565), (0.085 * hb, 0.085 * hb, 0.04), axes=sn), 0.03, tag="snout")
        if detail:
            for sx in (1, -1):
                S.sub(Sphere(tuple(np.array((sx * 0.032, -1.13, 0.535)) * s), 0.016 * s), k=0.005 * s)  # nostrils
            S.sub(E((0, -0.93, 0.55), (0.09, 0.15, 0.008)), k=0.005 * s)                                 # mouth line
        for sx in (1, -1):
            S.add(E((sx * 0.125 * (1.1 if y else 1), -0.84, 0.815), (0.022, 0.026, 0.02) if not y else (0.03, 0.034, 0.028)),
                  k=0.006 * s, tag="eye")
            add(E((sx * 0.11, -0.82, 0.86), (0.05, 0.06, 0.025)), 0.03)                                 # brow
            add(E((sx * 0.15, -0.86, 0.65), (0.05, 0.08, 0.05)), 0.04)                                  # cheek lump
            e0, e1 = np.array(mirror(J["ear"], sx)), np.array(mirror(J["ear_tip"], sx))
            S.add(Ellipsoid((e0 + e1) / 2, (0.045 * s, 0.017 * s, 0.075 * s), axes=sdf.frame(e1 - e0, (0, 0, 1))),
                  k=0.025 * s, tag="ear")
        add(RC(J["tail"] / np.array(s), J["tail2"] / np.array(s), 0.03, 0.02), 0.03, tag="tail")
        add(RC(J["tail2"] / np.array(s), J["tail_end"] / np.array(s), 0.02, 0.012), 0.01, tag="tail")
        add(E(np.array(J["tail_end"]) / s + np.array([0, 0.01, -0.02]), (0.03, 0.028, 0.06)), 0.02, tag="mane")
        for sx in (1, -1):
            m = lambda k: np.array(mirror(J[k], sx)) / s  # noqa: E731
            add(RC(m("shoulder"), m("elbow"), 0.13, 0.09), 0.10, d=bristle)
            add(RC(m("elbow"), m("wrist"), 0.075, 0.05), 0.035, tag="leg")
            add(Sphere(tuple(m("wrist") * s), 0.05 * s), 0.02, tag="leg")
            add(RC(m("wrist"), m("fball"), 0.045, 0.04), 0.02, tag="leg")
            add(RC(m("hip"), m("knee"), 0.15, 0.09), 0.10, d=bristle)
            add(RC(m("knee"), m("hock"), 0.08, 0.05), 0.035, tag="leg")
            add(Sphere(tuple(m("hock") * s), 0.05 * s), 0.02, tag="leg")
            add(RC(m("hock"), m("hball"), 0.045, 0.04), 0.02, tag="leg")
            for fet, tip in (("hball", "htip"), ("fball", "ftip")):
                f, t = m(fet), m(tip)
                base = np.array([f[0], (f[1] + t[1]) / 2 + 0.005, 0.03])
                add(RC(f + np.array([0, -0.004, -0.02]), base, 0.04, 0.05), 0.012, tag="hoof")
        self.mane(S, detail)
        S.inter(HalfSpace((0, 0, 0.004 * s), (0, 0, -1), extent=3.0), k=0.004 * s)
        return S

    def mane(self, S, detail):
        """A crest of bristle clumps from the poll over the shoulders to mid-back (the 1.4 m top)."""
        s = self.S
        body = sdf.Blend([(op, prim, k) for op, prim, k, _ in S.ops])
        rng = np.random.RandomState(5)
        ys = np.linspace(-0.66, 0.30, 15)
        top = 1.40 if not self.YOUNG else None
        for i, yv in enumerate(ys):
            prof = math.exp(-((yv + 0.25) / 0.32) ** 2)          # tallest over the shoulders
            for lat in ((-1, 0, 1) if not self.YOUNG else (0,)):
                sp = surface_point(body, (lat * 0.02 * s, yv * s, 0.6 * s), (lat * 0.25, 0, 1))
                L = (0.07 + 0.2 * prof) * s if not self.YOUNG else (0.035 + 0.05 * prof) * s
                if top is not None and lat == 0:
                    L = max(L, 0.0)
                back = math.radians(28 + 10 * rng.uniform(-1, 1))
                side = math.radians(lat * 22 + 8 * rng.uniform(-1, 1))
                d = np.array([math.sin(side), math.sin(back), math.cos(back) * math.cos(side)])
                r0 = (0.042 if lat == 0 else 0.034) * s
                r1 = (0.008 if detail else 0.016) * s          # the game mesh keeps the tips >= 1.5 voxels
                S.add(RoundCone(sp - d * 0.03 * s, sp + d * L, r0, r1), k=0.02 * s, tag="mane")
        if top is not None:
            # scale check: the tallest clump tip sets the model top
            pass

    def tusk_sculpt(self, detail):
        """Carved-stone gnomon tusks: flat triangular blades rising up-forward-out from the lower lip, a
        carved collar at the root, hour notches cut across the blade (bake detail)."""
        s = self.S
        T = Sculpt("tusks")
        big = 1.0 if not self.YOUNG else 0.32
        for sx in (1, -1):
            b = (np.array([sx * 0.10, -0.95, 0.55]) if not self.YOUNG else np.array([sx * 0.115, -0.92, 0.565])) * s
            t = b + np.array([sx * 0.21, -0.15, 0.40]) * s * big
            dv = K.nrm(t - b)
            # the blade's broad face turns 45 degrees between "seen from the side" (the gnomon triangle) and
            # "seen from above" (the game camera)
            up_out = K.nrm(np.array([0.0, 0.0, 1.0]) - dv * dv[2])
            out = K.nrm(np.cross(dv, up_out)) * (1 if np.cross(dv, up_out)[0] * sx > 0 else -1)
            wid = K.nrm(up_out + out)
            T.add(sdf.FlatCapsule(b, t, 0.068 * s * big + 0.014 * s, 0.03 * s * big + 0.01 * s, 0.008 * s, 0.006 * s,
                                  side=wid), k=0.0, tag="tusk")
            side = K.nrm(np.cross(dv, wid))
            T.add(Torus(b + (t - b) * 0.08, 0.035 * s * (big + 0.3) / 1.3, 0.012 * s, axes=sdf.frame(t - b)), k=0.01 * s,
                  tag="collar")
            if detail and not self.YOUNG:
                for j in range(5):                         # hour notches across the blade
                    p = b + (t - b) * (0.24 + 0.13 * j)
                    T.sub(Capsule(p - wid * 0.08 * s, p + wid * 0.08 * s, 0.007 * s), k=0.003 * s)
        return T

    def sculpts(self, detail):
        return {"body": self.body_sculpt(detail), "tusks": self.tusk_sculpt(detail)}

    def paint(self, part, V, N, tags):
        P = self.PAL
        c = lambda k: K.hexc(P[k])  # noqa: E731
        n = len(V)
        s = self.S
        z, y, x = V[:, 2] / s, V[:, 1] / s, V[:, 0] / s
        if part == "tusks":
            col = np.tile(c("tusk"), (n, 1))
            return col, np.full(n, 0.6)
        nz = N[:, 2]
        col = np.tile(c("hide"), (n, 1))
        flank = _smooth_arr(0.5, -0.1, nz)[:, None]
        col = col * (1 - 0.6 * flank) + c("flank") * 0.6 * flank
        belly = (_smooth_arr(-0.25, -0.75, nz) * _smooth_arr(0.75, 0.5, z))[:, None]
        col = col * (1 - belly) + c("belly") * belly
        legz = _smooth_arr(0.48, 0.28, z)[:, None]
        col = col * (1 - legz) + c("leg") * legz
        if self.YOUNG:
            # juvenile bands: pale stripes running along the flanks
            band = np.clip(1 - np.abs(((z - 0.62 + 0.04 * np.sin(y * 8)) / 0.12) % 1.0 - 0.5) / 0.26, 0, 1) ** 1.2
            band *= _smooth_arr(0.45, 0.55, z) * _smooth_arr(1.0, 0.9, z) * _smooth_arr(-0.55, -0.4, y) * _smooth_arr(0.65, 0.5, y)
            col = col * (1 - 0.7 * band[:, None]) + c("stripe") * 0.7 * band[:, None]
        else:
            # hour ticks: short dark bars on the flank, the dial's numerals worn into the hide
            ang = np.arctan2(z - 0.62, np.abs(x))
            ticks = np.clip(1 - np.abs((y + 0.45) / 0.13 % 1.0 - 0.5) / 0.08, 0, 1) ** 2
            ticks *= _smooth_arr(0.2, 0.35, ang) * _smooth_arr(0.75, 0.6, ang) * _smooth_arr(-0.4, -0.25, y) * _smooth_arr(0.5, 0.38, y)
            col = col * (1 - 0.45 * ticks[:, None]) + c("tick") * 0.45 * ticks[:, None]
        rough = np.full(n, 0.86)
        dmin = np.min(np.stack(list(tags.values())), 0)
        for tag, key, r in (("mane", None, 0.9), ("snout", "snout", 0.55), ("eye", "eye", 0.15), ("hoof", "hoof", 0.5),
                            ("ear", None, 0.8), ("leg", "leg", 0.86), ("tail", "leg", 0.86)):
            if tag not in tags:
                continue
            w = np.clip(1 - (tags[tag] - dmin) / (0.01 * s), 0, 1) * (tags[tag] < 0.03 * s)
            if tag == "mane":
                tip = (_smooth_arr(1.24, 1.38, z) if not self.YOUNG else _smooth_arr(0.9, 1.0, z)) * 0.8
                kc = c("mane") * (1 - tip[:, None]) + c("mane_tip") * tip[:, None]
            elif tag == "ear":
                inner = _smooth_arr(0.1, 0.6, -N[:, 1])
                kc = c("hide") * (1 - inner[:, None]) + c("ear_in") * inner[:, None]
            elif tag == "snout":
                face = _smooth_arr(0.3, 0.8, -N[:, 1])
                kc = c("snout") * (1 - 0.5 * face[:, None]) + c("nose") * 0.5 * face[:, None]
            else:
                kc = c(key)
            col = col * (1 - w[:, None]) + kc * w[:, None]
            rough = rough * (1 - w) + r * w
        return col, rough

    def high_material(self, part, grad):
        if part == "tusks":
            pal = materials.bible_palette(chalk=self.PAL["tusk"])
            return materials.honed_stone(f"{self.ID}_tusk_src", pal, "chalk", grad, rough=0.6, chisel=0.9, scale=3.0)
        return K.painted_material(f"{self.ID}_{part}_src", self.PAL["hide"], grad, fur=0.07, fur_scale=(1.6, 0.5, 1.6),
                                  chalk=(1.4, 0.65))

    def weight_fix(self, ob):
        s = self.S
        self.side_masks(ob, front_y=0.06 * s, band=0.12 * s)
        self.jaw_split(ob, self.J["jaw"], tuple(np.array((0, -1.06, 0.55)) * s))
        K.smooth_weights(ob, iters=2, k=0.5)

    # ── clips ──
    def clips(self, rig):
        J, s = self.J, self.S
        R0 = rig.rest_pose().legs
        C = np.array([0, 0.0, 0.78]) * s
        H = np.array(J["hips"])
        spd = self.RUN_SPEED

        def planted(P):
            for k, lg in R0.items():
                P.legs[k] = Leg(p=lg.p, a=lg.a, t=lg.t)

        def body(P, pitch=0.0, roll=0.0, yaw=0.0, lift=(0, 0, 0), c=C):
            R = rot(pitch, yaw, roll)
            P.hips_rot = R
            P.hips_loc = pivot(R, c, H) + np.array(lift, dtype=np.float64) * s

        def idle(t):
            # breathing, rooting at the ground (snout dips and snuffles), ear flicks, a tail swish
            P = rig.rest_pose()
            body(P, pitch=0.8 * wave(t, 0.1, 2), roll=1.2 * wave(t, 0.3), lift=(0.01 * wave(t, 0.05), 0, 0.006 * wave(t, 0, 2)))
            root = spline([(0, 0), (0.15, 0), (0.3, 1), (0.5, 1), (0.62, 0), (1.0, 0)], t)
            look = spline([(0, 0), (0.2, -4), (0.62, 6), (0.85, 8), (1.0, 0)], t, period=1.0)
            P.r("spine", p=0.8 * wave(t, 0, 2)).r("chest", p=-1.2 * wave(t, 0.05, 2))
            P.r("neck", p=-10 * root + 1.5 * wave(t, 0.2, 2), y=look * 0.5).r("head", p=-10 * root + 3 * root * wave(t, 0, 10), y=look * 0.5)
            P.r("jaw", p=-3 * root * max(0, wave(t, 0.1, 10)))
            P.r("ear.L", y=6 * wave(t, 0.1, 2) + 30 * math.exp(-((t - 0.72) / 0.02) ** 2)).r("ear.R", y=-6 * wave(t, 0.4, 2) - 30 * math.exp(-((t - 0.15) / 0.02) ** 2))
            sw = math.exp(-((t - 0.82) / 0.05) ** 2)
            P.r("tail", y=35 * sw * wave(t, 0, 12)).r("tail2", y=30 * sw * wave(t, 0.2, 12))
            return P

        RUN_F = self.RUN_F
        stride = spd * RUN_F / K.FPS
        G = {"FL": (0.00, 0.36, 0.13, 22, -24, -70, 26), "HR": (0.03, 0.38, 0.11, 22, -22, -55, 28),
             "FR": (0.50, 0.36, 0.13, 22, -24, -70, 26), "HL": (0.53, 0.38, 0.11, 22, -22, -55, 28)}

        def run(t):
            # a quick diagonal trot: hooves scurry, the heavy head bobs twice a stride, the mane shakes. The
            # clip holds RUN_CYCLES strides (a 0.67-0.8 s loop) with a slow head sway across them.
            P = rig.rest_pose()
            T = t
            t = (t * self.RUN_CYCLES) % 1.0
            for k, (ph, duty, lift, a_td, a_lo, a_fold, a_reach) in G.items():
                r = R0[k]
                u = (t - ph) % 1.0
                dy, dz, st, sp = K.foot_path(u, duty, stride, lift * s, tangent=0.6 if k[0] == "F" else 0.85, lift_peak=0.42)
                if st:
                    a, tt = r.a + lerp(a_td, a_lo, sp), r.t
                else:
                    a = r.a + spline([(0, a_lo), (0.35, a_fold), (0.78, a_reach), (1.0, a_td)], sp)
                    tt = spline([(0, r.t), (0.3, r.t - 50), (0.75, r.t - 5), (1.0, r.t)], sp)
                P.legs[k] = Leg(p=(r.p[0], r.p[1] + dy, r.p[2] + dz), a=a, t=tt)
            z = -0.035 + 0.02 * math.cos(4 * math.pi * (t - 0.28))
            body(P, pitch=1.5 * wave(t, 0.1, 2), roll=1.8 * wave(t, 0.05), yaw=1.2 * wave(t, 0.3), lift=(0, 0, z))
            P.r("neck", p=2 - 3 * wave(t, 0.2, 2), y=3 * wave(T, 0.1)).r("head", p=-2 * wave(t, 0.3, 2), y=2 * wave(T, 0.2))
            P.r("ear.L", y=22 + 6 * wave(t, 0.3, 2)).r("ear.R", y=-22 - 6 * wave(t, 0.3, 2))
            P.r("tail", p=-30 + 6 * wave(t, 0.4, 2), y=8 * wave(T, 0.0)).r("tail2", p=-15 + 10 * wave(t, 0.5, 2))
            return P

        def attack(t):
            # tusk hook: drop the head low and to the side, drive forward and rip up-and-across at 40 %
            P = rig.rest_pose()
            planted(P)
            w = spline([(0, 0), (0.28, -1), (0.4, 1), (0.56, 0.8), (1.0, 0)], t)
            bk, fw = max(0.0, -w), max(0.0, w)
            body(P, pitch=-5 * bk + 2 * fw, roll=3 * bk - 4 * fw, yaw=-6 * bk + 8 * fw, lift=(0, 0.07 * bk - 0.13 * fw, -0.04 * bk))
            st = smooth((t - 0.24) / 0.14) - smooth((t - 0.7) / 0.2)
            fl = R0["FL"]
            lf = 0.09 * s * (math.sin(math.pi * min(1, max(0, (t - 0.24) / 0.14))) + math.sin(math.pi * min(1, max(0, (t - 0.7) / 0.2))))
            P.legs["FL"] = Leg(p=(fl.p[0], fl.p[1] - 0.14 * s * st, fl.p[2] + lf), a=fl.a, t=fl.t)
            P.r("neck", p=-14 * bk + 10 * fw, y=10 * bk - 14 * fw).r("head", p=-14 * bk + 18 * fw, y=8 * bk - 10 * fw, r=-12 * bk + 18 * fw)
            P.r("jaw", p=-10 * fw).r("ear.L", y=28 * (bk + fw)).r("ear.R", y=-28 * (bk + fw))
            P.r("tail", p=-25 * fw)
            return P

        def stamp(t):
            # rear up on the hams (forelegs tucked), stamp both forehooves down at 40 %, a shudder, settle
            P = rig.rest_pose()
            rear = spline([(0, 0), (0.3, 1), (0.36, 1.02), (0.4, 0), (1.0, 0)], t)
            slam = spline([(0, 0), (0.34, 0), (0.4, 1), (0.55, 0.7), (0.8, 0.15), (1.0, 0)], t)
            hip_piv = np.array([0, J["hip"][1], J["hip"][2]])
            R = rot(24 * rear - 4 * slam, 0, 0)
            P.hips_rot = R
            P.hips_loc = pivot(R, hip_piv, H) + np.array([0, 0.03 * rear, -0.03 * rear - 0.05 * slam]) * s
            for k in ("HL", "HR"):
                P.legs[k] = Leg(p=R0[k].p, a=R0[k].a, t=R0[k].t)
            for k in ("FL", "FR"):
                r = R0[k]
                # forelegs fold up in the body frame while reared, stamp straight down to the ground at 40 %
                P.legs[k] = Leg(p=(r.p[0], r.p[1] - 0.04 * s * slam, r.p[2]), a=r.a, t=r.t,
                                pb=(0, 0.10 * s, 0.22 * s), ab=-70, tb=-20, wb=rear)
            P.r("neck", p=-10 * rear - 12 * slam).r("head", p=-12 * rear - 8 * slam + 3 * slam * wave(t, 0, 9))
            P.r("ear.L", y=30 * (rear + slam)).r("ear.R", y=-30 * (rear + slam))
            P.r("tail", p=-30 * rear).r("jaw", p=-8 * slam)
            return P

        def death(t):
            # legs buckle, it drops and rolls onto its right side, the head flops, a last kick
            P = rig.rest_pose()
            sag = smooth(t / 0.25)
            fall = smooth((t - 0.2) / 0.4)
            settle = smooth((t - 0.6) / 0.4)
            roll = -(92 * fall + 3 * math.sin(math.pi * settle))
            R = rot(-6 * sag * (1 - fall), 0, roll + 5 * math.sin(math.pi * min(1, t / 0.25)) * (1 - fall))
            c_lie = np.array([-0.27, 0.03, 0.315]) * s
            c_sag = C + np.array([0, 0, -0.12]) * s
            c1 = (C * (1 - sag) + c_sag * sag) * (1 - fall) + c_lie * fall
            P.hips_rot = R
            P.hips_loc = c1 + R @ (H - C) - H
            kick = math.exp(-((t - 0.86) / 0.04) ** 2)
            for k in ("FL", "FR", "HL", "HR"):
                r = R0[k]
                fr = k[0] == "F"
                down = k[1] == "R"                              # the side it falls on folds its legs higher
                pb = (0, (0.10 if fr else -0.08) * s, (0.16 + 0.07 * down + 0.05 * kick) * s)
                P.legs[k] = Leg(p=(r.p[0], r.p[1], r.p[2]), a=r.a, t=r.t, pb=pb, ab=-30 if fr else -15, tb=20, wb=fall)
            drop = smooth((t - 0.45) / 0.4)
            P.r("neck", p=-10 * sag * (1 - fall) - 4 * drop, y=6 * fall).r("head", p=-6 * drop, r=34 * fall)
            P.r("jaw", p=-10 * drop).r("ear.L", y=25 * fall).r("ear.R", y=-25 * fall, p=-10 * drop)
            P.r("tail", p=12 * fall)
            return P

        out = [Clip("idle", 90, idle, loop=True), Clip("run", RUN_F * self.RUN_CYCLES, run, loop=True),
               Clip("attack1", 25, attack, impact=0.4), Clip("cast_a1", 35, stamp, impact=0.4),
               Clip("death", 40, death)]
        return [c for c in out if c.name in self.CLIPS]


class StilltuskYoung(Stilltusk):
    """The camp's juvenile: same family, rounder, a big head on stubby legs, pale bands along the flanks,
    a low soft mane and stubby tusk nubs."""
    ID = "stilltusk_young"
    HEIGHT = 0.9
    BODY_TOP = 0.78
    RUN_SPEED = 3.5                 # units.json base.moveSpeed
    RUN_F = 10
    CLIPS = ("idle", "run", "attack1", "death")
    TRIS = {"body": 3700, "tusks": 120}
    VOX_LOW = 0.008
    VOX_HIGH = 0.0055
    S = 0.803
    LEG_SHORTEN = 0.13
    YOUNG = True
    WRIST_MIN = 0.03
    PAL = dict(Stilltusk.PAL, hide="#6E5847", flank="#634E3E", belly="#8E7B68", mane="#3A2C24", stripe="#C2AE8E")


# ════════════════════════════════════════════════════════════════════════════════════════════════
# build pipeline
def build(cr: Creature, args) -> dict:
    T = scene.Timer(cr.ID)
    report = {"id": cr.ID}
    scene.reset()
    col = scene.collection(cr.ID)
    src = scene.collection(f"{cr.ID}_src")
    with T.step("rig"):
        arm = K.build_armature(f"{cr.ID}_rig", cr.bones(), col)
        rig = K.Rig(arm, cr.legdefs())
        # the solver must reproduce the rest pose exactly
        P = rig.solve(rig.rest_pose())
        err = max(float(np.abs(P[n] - rig.rest[n]).max()) for n in rig.order)
        report["rest_solve_err"] = err
        if err > 1e-4:
            raise SystemExit(f"{cr.ID}: rest pose solve error {err}")
    grad = materials.bible_gradient(cr.BODY_TOP)
    parts, highs = [], {}
    pid = {}
    with T.step("sculpt"):
        lows = cr.sculpts(False)
        his = cr.sculpts(True)
        for name, S in lows.items():
            low = K.low_from(S, cr.VOX_LOW if name not in cr.VOX_PART else cr.VOX_PART[name], cr.TRIS.get(name, 6000),
                             f"{cr.ID}_{name}", col)
            hi = K.high_from(his[name], cr.VOX_HIGH, f"{cr.ID}_{name}_hi", src)
            if hasattr(cr, "zmap") and getattr(cr, "LEG_SHORTEN", 0) > 0:
                for ob in (low, hi):
                    co = np.empty(len(ob.data.vertices) * 3)
                    ob.data.vertices.foreach_get("co", co)
                    co = co.reshape(-1, 3)
                    co[:, 2] = cr.zmap(co[:, 2])
                    ob.data.vertices.foreach_set("co", co.ravel())
                    ob.data.update()
            Vh, Nh = K.arrays(hi)
            tags = K.tag_distances(his[name], Vh)
            rgb, rough = cr.paint(name, Vh, Nh, tags)
            K.set_colors(hi, rgb, rough)
            hi.data.materials.append(cr.high_material(name, grad))
            pid[name] = len(pid)
            parts.append((name, low, cr.PART_BIND.get(name)))
            highs.setdefault(pid[name], []).append(hi)
            scene.log(f"{name}: low {K.tri_count(low)} tris, high {len(hi.data.polygons)} faces")
        for name, ob, bone in cr.hard(col):
            if name not in pid:
                pid[name] = len(pid)
            hi = mesh.duplicate(ob, ob.name + "_hi", src)
            hi.data.materials.clear()
            hi.data.materials.append(cr.hard_material(name, grad))
            highs.setdefault(pid[name], []).append(hi)
            parts.append((name, ob, bone))
    with T.step("bind"):
        bodies = []
        for name, ob, bone in sorted(parts, key=lambda p: 0 if p[2] is None else 1):
            mesh.set_part(ob, pid[name])
            if bone is None:
                res = mesh.bind_auto(ob, arm, exclude=cr.HEAT_EXCLUDE)
                report[f"heat_{name}"] = {k: v for k, v in res.items() if k != "empty_groups"}
                cr.weight_fix(ob)
                bodies.append(ob)
            elif bone == "transfer":
                mesh.transfer_weights(bodies[0], ob)
                mesh.add_armature_modifier(ob, arm)
                mesh.parent_keep(ob, arm)
            else:
                mesh.bind_rigid(ob, arm, bone)
        low = mesh.join([p[1] for p in parts], cr.ID)
        if low.data.validate(verbose=False, clean_customdata=False):
            scene.log("validate: repaired the joined low")
        report["tris"] = K.tri_count(low)
    with T.step("uv"):
        bake.unwrap(low, weights=cr.UV_WEIGHTS)
        report["uv_coverage"] = round(bake.uv_coverage(low), 3)
    with T.step("bake"):
        res = bake.bake_asset(low, highs, os.path.join(TEXCACHE, cr.ID), name=cr.ID, size=cr.TEX,
                              samples=4, ao_samples=48 if not args.fast else 8, ao_distance=0.3,
                              cage=cr.BAKE_RAY[0], ray=cr.BAKE_RAY[1], mat_name=f"{cr.ID}_body", fast=args.fast,
                              ao_into_base=materials.BIBLE_BAKE["ao"], sizes={"orm": 512})
        report["bake"] = res["timings"]
        body_mat = res["material"]
        base_img = next(n.image for n in body_mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image
                        and n.image.filepath.endswith("_base.jpg"))
        report["bake_holes_filled"] = K.fill_bake_holes(base_img, low)
        scene.log(f"bake holes filled: {report['bake_holes_filled']} px")
        for part, (mname, strength) in cr.GLOW.items():
            gm = body_mat.copy()
            gm.name = mname
            nt = gm.node_tree
            bsdf = nt.nodes["BSDF"]
            img = next(n for n in nt.nodes if n.type == "TEX_IMAGE" and n.image and n.image.filepath.endswith("_base.jpg"))
            nt.links.new(img.outputs["Color"], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = strength
            low.data.materials.append(gm)
            mi = len(low.data.materials) - 1
            pv = np.empty(len(low.data.vertices), dtype=np.int32)
            low.data.attributes["vale_part"].data.foreach_get("value", pv)
            idx = np.empty(len(low.data.polygons), dtype=np.int32)
            low.data.polygons.foreach_get("material_index", idx)
            for p in low.data.polygons:
                if pv[p.vertices[0]] == pid[part]:
                    idx[p.index] = mi
            low.data.polygons.foreach_set("material_index", idx)
    for o in list(src.objects):
        o.hide_render = True
        o.hide_viewport = True
    if "vale_part" in low.data.attributes:
        low.data.attributes.remove(low.data.attributes["vale_part"])
    with T.step("clips"):
        rig.ground = (max(rig.head_pos[cr.legdefs()[0].bones[3]][2] * 0.55, cr.BALL_MIN), 0.012, cr.WRIST_MIN)
        clips = cr.clips(rig)
        report["clips"] = {c.name: K.write_clip(rig, c) for c in clips}
        if arm.animation_data:
            arm.animation_data.action = None
    arm["vale_kind"] = "monster"
    arm["vale_id"] = cr.ID
    arm["vale_height"] = float(cr.HEIGHT)
    arm["vale_run_ref_speed"] = float(cr.RUN_SPEED)
    report["mesh_top_m"] = round(max((low.matrix_world @ v.co).z for v in low.data.vertices), 3)
    if not args.no_qa:
        with T.step("ground_qa"):
            report["min_z"] = K.min_z_over_clips(rig, [low], clips)
            scene.log(f"min z per clip: {report['min_z']}")
    glb = os.path.join(OUT, f"{cr.ID}.glb")
    with T.step("export"):
        K.clear_pose(rig)
        export.export_glb([arm, low], glb)
        report["glb_bytes_raw"] = os.path.getsize(glb)
    with T.step("optimize"):
        report["optimize"] = export.optimize(glb, fighter=True)
    report["glb_bytes"] = os.path.getsize(glb)
    os.makedirs(CACHE, exist_ok=True)
    scene.save_blend(os.path.join(CACHE, f"{cr.ID}.blend"))
    if not args.no_qa:
        with T.step("qa"):
            rc, out = K.run_node(["art/tools/inspect_glb.mjs", scene.rel(glb)])
            report["inspect"] = out.strip().splitlines()[-12:]
            scene.log(out)
            rc, out = K.run_node(["art/tools/three_load_test.mjs", scene.rel(glb), "--unit", "--clips", ",".join(cr.CLIPS),
                                  "--feet", f"toe.L,toe.R,{cr.FRONT_TOE}.L,{cr.FRONT_TOE}.R", "--budget-kb", "1024"])
            report["load_test"] = {"ok": rc == 0, "log": out.strip().splitlines()[-14:]}
            scene.log(out)
            sheet = os.path.join(RENDERS, f"{cr.ID}.png")
            rc, out = K.run_node(["art/tools/three_snapshot.mjs", scene.rel(glb), scene.rel(sheet), "--unit",
                                  "--chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"], timeout=900)
            report["sheet"] = {"ok": rc == 0, "out": scene.rel(sheet), "log": out.strip().splitlines()[-3:]}
            scene.log(out[-1500:])
    report["timings"] = T.report()
    scene.write_json(os.path.join(RENDERS, f"build_report_{cr.ID}.json"), report)
    scene.log(f"{cr.ID}: {report['tris']} tris, {report['glb_bytes'] / 1024:.0f} KiB, top {report['mesh_top_m']} m, "
              f"total {T.total():.0f}s")
    return report


# ── icons (128², head-and-shoulders three-quarter on a dark painted ground, like the fighter icons) ──
# The bible lighting with the side-back rim pair turned down (rim): at full strength it washes the
# monsters' hides out (the fighters' rims are tuned for armour).
ICONS = {
    # clip / frame: the pose; lo / hi: framing box relative to the head bone's middle; glow: backdrop accent
    "glasshorn": {"clip": "idle", "frame": 0, "lo": (-0.42, -0.3, -0.3), "hi": (0.42, 0.35, 0.58), "yaw": 34.0,
                  "pitch": 8.0, "fill": 0.92, "glow": "#5F7488", "ink": "#211C19", "rim": 0.3},
    "resinback": {"clip": "idle", "frame": 0, "lo": (-0.42, -0.2, -0.26), "hi": (0.42, 0.62, 0.74), "yaw": 32.0,
                  "pitch": 12.0, "fill": 0.9, "glow": "#7A4720", "ink": "#221A16", "rim": 0.15},
}


def render_icon(cid: str, fast: bool = False) -> str:
    from common import imageops, render
    cfg = ICONS[cid]
    bpy.ops.wm.open_mainfile(filepath=os.path.join(CACHE, f"{cid}.blend"))
    sc = bpy.context.scene
    arm = bpy.data.objects[f"{cid}_rig"]
    body = bpy.data.objects[cid]
    for o in sc.objects:
        if o.type in ("MESH", "LIGHT") and o != body:
            o.hide_render = True
    act = bpy.data.actions[cfg["clip"]]
    ad = arm.animation_data or arm.animation_data_create()
    ad.action = act
    try:
        ad.action_slot = act.slots[0]
    except (AttributeError, IndexError):
        pass
    sc.frame_set(cfg["frame"])
    bpy.context.view_layer.update()
    h0, h1 = render.bone_pos(arm, "head"), render.bone_pos(arm, "head", tail=True)
    c = (h0 + h1) * 0.5
    lo, hi = c + Vector(cfg["lo"]), c + Vector(cfg["hi"])
    cam = render.camera(lens=85)
    render._fit_camera(cam, lo, hi, cfg["yaw"], cfg["pitch"], 70.0, cfg["fill"], 1.0, 0.5)
    light = render.map_lighting("map_rift")
    render.sky_world(light["sky"], light["ambient"] * cfg.get("ambient", 1.0), camera_strength=1.0)
    rc = dict(render.SPLASH_DEFAULTS)
    rc["sun"] = rc["sun"] * cfg.get("sun", 1.0)
    rc["rim_cool"] = rc["rim_warm"] = cfg.get("rim", 1.0)
    render.bible_lights(cam, rc, light, rim=1.2, scale=0.6, pair=True, target=(lo + hi) * 0.5)
    render.setup(256, 256, 24 if fast else 160, transparent=True, view="Khronos PBR Neutral")
    os.makedirs(RENDERS, exist_ok=True)
    raw = os.path.join(RENDERS, f"_{cid}_icon_raw.png")
    render.render(raw)
    imageops.denoise(raw, 2.0)
    fg = imageops.premul_resize(imageops.load(raw), 128, 128)
    bg = imageops.painted_backdrop(128, 128, cfg["ink"], cfg["glow"], seed=scene.seed_of(cid) % 1000, glow=(0.5, 0.4),
                                   glow_size=0.6)
    out = os.path.join(OUT, f"{cid}_icon.png")
    imageops.save(imageops.grade(imageops.over(fg, bg)), out, alpha=False)
    os.remove(raw)
    scene.log(f"icon {scene.rel(out)}")
    return out


CREATURES = {"glasshorn": Glasshorn, "resinback": Resinback, "stilltusk": Stilltusk,
             "stilltusk_young": StilltuskYoung}


def main():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--only", default="")
    p.add_argument("--fast", action="store_true")
    p.add_argument("--no-qa", action="store_true")
    p.add_argument("--icons", action="store_true")
    p.add_argument("--icons-only", action="store_true")
    a = p.parse_args(scene.script_args())
    ids = [i for i in CREATURES if not a.only or i in a.only.split(",")]
    if not a.icons_only:
        for i in ids:
            build(CREATURES[i](), a)
    if a.icons or a.icons_only:
        for i in ids:
            if i in ICONS:
                render_icon(i, a.fast)


if __name__ == "__main__":
    main()
