"""brightwick: the super Wick (1.7 m). Pauldrons, a crown-lamp ring on the hood, a two-hand lamp staff.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/wick_brightwick_plates.py        # plates (both)
    Blender -b --factory-startup --python art/blender/proto/wick_brightwick_fit.py -- [--faction aubade]
    Blender -b --factory-startup --python-exit-code 1 --python art/blender/units/wick_brightwick.py -- \
        [--faction aubade|serenade|both|legacy] [--fast] [--clip-sheet]

Builds brightwick_aubade + brightwick_serenade (default: both) into art/out/units/; `--faction legacy` rebuilds
today's brightwick.glb (frozen: `legacy_props` below and wick_common's legacy body). Brief:
_design/units/wicks.md §3.4 (law). Concepts: _design/concept/wicks/brightwick_{aubade,serenade}.webp.
Progress log: art/renders/units/_wick_brightwick_progress.md.

ART 2.0 (HANDOFF "Art 2.0 method", reference fighters/marund.py): numpy SDF volumes fitted to each concept on a
10 cm grid, the concept painting projected occlusion-aware onto the game mesh, normals + AO from the sculpt.

  * Concepts vs brief: the concepts' proportions win (approved look: Aubade's rounded cowl rises a little above its
    crown points, 1.75 m; Serenade's pauldrons are broader); the brief's RULES win: no face (one soft hood light,
    set back), rounded hoods only (crown points 6 cm, pauldron points <= 10 cm), every glow is `accent` geometry
    and the painted glow is erased from the plates (proto/wick_brightwick_plates.py), palette grade per §2.3-2.4.
  * Same job silhouette in both cultures: the same rig, staff layout (right grip 0.40 m from the foot, left grip
    0.72 m above it, lantern at the upper left) and the same clips; hood, crown, pauldrons, trims, lamp differ.
  * REST = A-pose (CONTRACT §12). The concept paints the wick holding its staff, so the projection runs in a
    PAINT POSE (`paint_pose`): the armature is posed to the concept's hold and the skinned mesh is painted there;
    Aubade's front view is painted a little turned to the wick's left, so the front plate is projected onto the
    paint pose turned by `PAINT_YAW` (the back plate onto the unturned one) and blended by the normal.
  * The staff rides prop.R; prop.R keeps its rest frame (+Y forward through the right fist) and the staff is
    modelled along it, so `aim.R` = the staff direction and the left hand grips `to_prop=("prop.R", GRIP_L)`.

Pipeline additions kept in this module (common/ and wick_common.py untouched): the paint-pose projection
(`_paint_object`, wraps project.paint_object for `wicks/brightwick*` concepts only) and the `("bw_auto", exclude)`
bind (bone heat over a bone subset; wraps pipeline.bind_part for that tuple only).
"""
from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

import wick_common as wc  # noqa: E402
from common import anim, fighter, mesh, pipeline, rig, scene  # noqa: E402
from common.anim import Aim, FootTarget, HandTarget  # noqa: E402
from common.hifi import project, sdf  # noqa: E402
from wick_common import (Capsule, Ellipsoid, HalfSpace, Lathe, RoundBox, RoundCone, Sculpt, Sphere,  # noqa: E402
                         Torus)

V3 = np.array
NOISE = sdf.Noise(29)
VOXEL = 0.0065
RECESS = 0.06                 # the cloak's front opening: the robe floor sits this far in (local radius)
GRIP_L = 0.72                 # left fist along the staff from the right fist (m)
STAFF_BACK = 0.40             # staff foot behind the right fist (m)
ARM_BONES = tuple(f"{b}.{s}" for s in "LR" for b in ("shoulder", "upper_arm", "forearm", "hand", "prop"))
LEG_BONES = tuple(f"{b}.{s}" for s in "LR" for b in ("thigh", "shin", "foot", "toe"))
BODY_EXCLUDE = ("root", "neck", "head") + ARM_BONES
SLEEVE_EXCLUDE = ("root", "hips", "spine", "neck", "head", "prop.L", "prop.R") + LEG_BONES

# ── per-culture forms (metres; Z up, the wick faces -Y, soles at 0, its right hand at -X) ─────────────────
# measured on the concepts (Aubade 709.3 px/m, Serenade 744 px/m; proto/wick_brightwick_plates.py)
FORM = {
    "aubade": {
        "hood": ((0.0, 0.015, 1.505), (0.184, 0.21, 0.222)),      # rounded cowl (helmet-round), top 1.727
        "hollow": ((0.0, -0.165, 1.455), (0.098, 0.165, 0.150)),  # opening x +-0.098, z 1.31-1.60
        "hood_light": ((0.0, -0.06, 1.415), (0.066, 0.032, 0.046)),
        "shoulder": 0.205,
        "cloak_rx": [(0.08, 0.425), (0.40, 0.415), (0.80, 0.395), (1.05, 0.375), (1.20, 0.33), (1.30, 0.25), (1.36, 0.17)],
        "cloak_ry": 0.70, "cloak_open": 0.155, "hem": (0.105, 0.035, 5),
        "tabard": (0.088, 1.17, 0.20, 0.31),                        # half width, top, tip, where the V starts
        "robe_rx": [(0.08, 0.26), (0.5, 0.25), (0.95, 0.23), (1.2, 0.19), (1.30, 0.15)],
        "pauldron_x": 0.27, "boot": (0.062, 0.105, 0.06),
        "staff_r": 0.024,
        # paint pose (the concept's hold): right wrist, staff direction, front-view yaw (deg)
        "paint": {"wrist_R": (-0.17, -0.25, 0.84), "staff": (0.78, -0.06, 0.62), "yaw": 12.0,
                  "pole_R": (-0.9, 0.3, -0.4), "pole_L": (0.9, 0.2, -0.5)},
    },
    "serenade": {
        "hood": ((0.0, 0.02, 1.47), (0.19, 0.21, 0.23)),          # felt dome, top 1.70
        "hood_cone": ((0.02, 1.36, 0.198), (1.52, 0.182)),          # straight felt sides below the dome
        "hollow": ((0.0, -0.175, 1.44), (0.118, 0.17, 0.125)),    # opening x +-0.118, z 1.315-1.565
        "hood_light": ((0.0, -0.065, 1.41), (0.078, 0.034, 0.048)),
        "shoulder": 0.215,
        "cloak_rx": [(0.15, 0.425), (0.40, 0.410), (0.75, 0.385), (0.95, 0.37), (1.08, 0.35), (1.16, 0.28), (1.22, 0.20)],
        "cloak_ry": 0.74, "cloak_open": 0.13, "hem": (0.165, 0.0, 1),
        "tabard": (0.11, 1.03, 0.37, 0.43),
        "robe_rx": [(0.10, 0.27), (0.5, 0.26), (0.95, 0.24), (1.2, 0.21), (1.30, 0.16)],
        "pauldron_x": 0.30, "boot": (0.072, 0.11, 0.065),
        "staff_r": 0.027,
        "paint": {"wrist_R": (-0.29, -0.22, 0.82), "staff": (0.88, -0.05, 0.40), "yaw": 0.0,
                  "pole_R": (-0.9, 0.3, -0.4), "pole_L": (0.9, 0.2, -0.5)},
    },
}


# ── small SDF helpers ────────────────────────────────────────────────────────────────────────────────
class HemCut(sdf.Prim):
    """Inside above a hem line whose height varies around the Z axis: z > z0 + amp * points(angle)."""

    def __init__(self, z0: float, amp: float, n: int, extent: float = 1.0):
        self.z0, self.amp, self.n, self.e = float(z0), float(amp), int(n), float(extent)

    def bounds(self):
        return np.array([-self.e, -self.e, self.z0 - 0.05]), np.array([self.e, self.e, self.z0 + 2.5])

    def d(self, P):
        a = np.arctan2(P[:, 0], -P[:, 1])                          # 0 = front
        tri = 1.0 - np.abs(((a * self.n / math.pi) % 2.0) - 1.0)   # 0..1 sawtooth: shallow points
        return (self.z0 + self.amp * tri) - P[:, 2]


def interp(table, z):
    zs, rs = zip(*table)
    return np.interp(z, zs, rs)


def bell(table, ry_ratio, z0, z1, inset=0.0):
    """A lathe bell with radius from `table` (z -> rx), squashed to ry = ratio * rx (approximate SDF)."""
    zs = [t[0] for t in table]
    rmax = max(t[1] for t in table) + 0.05

    def prof(r, z):
        R = np.interp(z, zs, [t[1] for t in table]) - inset
        return np.maximum(np.maximum(r - R, z - z1), z0 - z)
    return Lathe((0, 0, 0), prof, rmax, z0 - 0.02, z1 + 0.02, axes=np.diag([1.0, 1.0 / ry_ratio, 1.0]))


def folds(amp, freq, phase=0.0):
    def fn(P):
        a = np.arctan2(P[:, 0], -P[:, 1])
        u = a * freq + phase + 0.5 * NOISE(P, 3.0)
        return amp * (np.abs(np.sin(u)) * 2.0 - 1.0) * -0.5
    return fn


def wraps(a, b, amp=0.004, pitch=0.022):
    """bandage ridges around the segment a -> b"""
    a, b = V3(a, float), V3(b, float)
    u = (b - a) / np.linalg.norm(b - a)

    def fn(P):
        t = (P - a) @ u
        return -amp * np.abs(np.sin(t * math.pi / pitch + 0.6 * NOISE(P, 6.0)))
    return fn


def ell_surface_y(c, r, x, z, front=True):
    """y on an ellipsoid's front (-Y) or back surface at (x, z); nan outside."""
    q = 1.0 - ((x - c[0]) / r[0]) ** 2 - ((z - c[2]) / r[2]) ** 2
    y = r[1] * np.sqrt(np.maximum(q, 0.0))
    return np.where(q >= 0, c[1] - y if front else c[1] + y, np.nan)


def hood_front_y(F, x, z):
    """y of the hood's outer front surface at (x, z): the ellipsoid, or the straight-sided cone below it."""
    hc, hr = F["hood"]
    y = ell_surface_y(hc, hr, np.asarray(x, float), np.asarray(z, float))
    cone = F.get("hood_cone")
    if cone:
        (y0, z0, r0), (z1, r1) = cone[0], cone[1]
        t = np.clip((np.asarray(z, float) - z0) / (z1 - z0), 0, 1)
        r = r0 + (r1 - r0) * t
        q = r * r - np.asarray(x, float) ** 2
        yc = np.where((q > 0) & (np.asarray(z, float) >= z0) & (np.asarray(z, float) <= z1), y0 - np.sqrt(np.maximum(q, 0)), np.nan)
        y = np.fmin(y, yc)
    return y


def opening_loop(F, n=28, lift=0.004):
    """Points around the hood opening on the hood's front surface (the rim path)."""
    oc, orr = F["hollow"]
    pts = []
    for i in range(n):
        phi = 2 * math.pi * i / n
        dx, dz = math.sin(phi), math.cos(phi)
        rho_lo, rho_hi = 0.0, 0.3
        for _ in range(30):
            rho = 0.5 * (rho_lo + rho_hi)
            x, z = oc[0] + dx * rho, oc[2] + dz * rho
            y = float(hood_front_y(F, x, z))
            inside = (((x - oc[0]) / orr[0]) ** 2 + ((y - oc[1]) / orr[1]) ** 2 + ((z - oc[2]) / orr[2]) ** 2) < 1.0
            if inside:
                rho_lo = rho
            else:
                rho_hi = rho
        x, z = oc[0] + dx * rho_lo, oc[2] + dz * rho_lo
        y = float(hood_front_y(F, x, z)) - lift
        pts.append((x, y, z))
    return pts


def loop_tube(S, pts, r, k=0.006):
    for i in range(len(pts)):
        S.add(Capsule(pts[i], pts[(i + 1) % len(pts)], r), k=k)


def sdf_of(S: Sculpt):
    """point-evaluable SDF of a sculpt (its op list as one Blend)"""
    return sdf.Blend([(op, prim, k) for op, prim, k, _ in S.ops])


def onto_surface(D, P, n, reach=0.08, lift=0.0):
    """march each point from P + n*reach back along -n to the zero set of D (bisection); returns the surface
    points lifted by `lift` and the SDF gradient normals there"""
    P, n = np.asarray(P, float), np.asarray(n, float)
    n = n / np.linalg.norm(n, axis=1, keepdims=True)
    lo, hi = np.full(len(P), -reach), np.full(len(P), reach)          # offsets along n: lo inside, hi outside
    for _ in range(28):
        mid = 0.5 * (lo + hi)
        d = D.d(P + n * mid[:, None])
        inside = d < 0
        lo = np.where(inside, mid, lo)
        hi = np.where(inside, hi, mid)
    S = P + n * (0.5 * (lo + hi))[:, None]
    e = 1e-3
    g = np.stack([D.d(S + np.eye(3)[i] * e) - D.d(S - np.eye(3)[i] * e) for i in range(3)], 1)
    g /= np.linalg.norm(g, axis=1, keepdims=True) + 1e-12
    return S + g * lift, g


def discs(centers, normals, r, n=8):
    """flat n-gon caps (triangle fans) facing `normals`: window glazing as clean low geometry"""
    V, F = [], []
    for c, nn in zip(np.asarray(centers, float), np.asarray(normals, float)):
        fr = sdf.frame(nn)
        base = len(V)
        V.append(c)
        for k in range(n):
            a = 2 * math.pi * k / n
            V.append(c + fr[0] * math.cos(a) * r + fr[1] * math.sin(a) * r)
        for k in range(n):
            F.append((base, base + 1 + k, base + 1 + (k + 1) % n))
    return np.array(V), np.array(F)


def ribbon(pts, nrm, width, thick, sink=0.006):
    """a flat strip mesh (quads) along `pts` lying on the surface with normals `nrm`: width x (thick above,
    `sink` below the surface). Clean low geometry for the accent inlays (decimated SDF strips go ragged)."""
    pts, nrm = np.asarray(pts, float), np.asarray(nrm, float)
    n = len(pts)
    tan = np.gradient(pts, axis=0)
    tan /= np.linalg.norm(tan, axis=1, keepdims=True)
    side = np.cross(tan, nrm)
    side /= np.linalg.norm(side, axis=1, keepdims=True)
    up = np.cross(side, tan)
    V = []
    for i in range(n):
        for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            V.append(pts[i] + side[i] * sx * width / 2 + up[i] * (thick if sz > 0 else -sink))
    F = []
    for i in range(n - 1):
        a, b = 4 * i, 4 * (i + 1)
        for k in range(1, 4):                      # sides + top; the face under the surface is never seen
            k2 = (k + 1) % 4
            F.append((a + k, a + k2, b + k2, b + k))
    F.append((3, 2, 1, 0))
    e = 4 * (n - 1)
    F.append((e + 0, e + 1, e + 2, e + 3))
    return np.array(V), np.array(F)


# ── the spec ───────────────────────────────────────────────────────────────────────────────────────
class Brightwick(wc.Wick):
    KIND_ID = "brightwick"
    HEIGHT = 1.7

    def __init__(self, faction: str = wc.LEGACY):
        super().__init__(faction)
        if faction == wc.LEGACY:
            return
        self.F = FORM[faction]
        sw = self.F["shoulder"]
        # VALE_BIPED_1 at minion proportions, fitted to the concepts: head bone 1.34 -> 1.60 inside the hood,
        # shoulder joints x +-0.21 at 1.26, hips at 0.62, ankles x +-0.15 at 0.09, short heavy arms
        self.PROPORTIONS = rig.proportions(height=1.60, head=0.30, neck=0.04, shoulder_width=2 * sw, hip_width=0.20,
                                           leg=0.535, thigh_frac=0.50, arm=0.56, upper_arm_frac=0.56, hand=0.11,
                                           foot=0.21, ankle_height=0.09, stance=0.05, toe_out_deg=8.0, knee_bend=0.012,
                                           spine_curve=0.0, a_pose_deg=64.0, arm_forward_deg=12.0, elbow_bend_deg=22.0,
                                           shoulder_drop=0.04)
        self.MOTION = anim.motion_profile(weight="heavy", weapon="two_hand", stance="wide", run_ref_speed=3.3)
        self.AO_INTO_BASE = 0.25
        self.PROJECTION = {"concept": f"wicks/brightwick_{faction}_bw", "height": 1.70,
                           "flat": dict(FLAT[faction])}
        PAINT[self.PROJECTION["concept"]] = self

    # ── model ──
    def model(self, ctx) -> list:
        if self.faction == wc.LEGACY:
            return self.legacy_model(ctx)
        P = []
        for name, S, vs, role, bind, tris, uvw in self.sculpts(ctx):
            if isinstance(S, tuple):                       # ("mesh", verts, quads): explicit low geometry
                ob = sdf.to_object(f"{name}_low", S[1], S[2], ctx.col)
                ob.data.materials.append(ctx.mats[role])
                P.append(fighter.Part(name, low=ob, bind=bind, uv_weight=uvw))
                continue
            v, q = S.mesh(VOXEL * vs)
            ob = sdf.to_object(f"{name}_high", v, q, ctx.col)
            ob.data.materials.append(ctx.mats[role])
            # the game mesh: the pipeline's symmetric collapse stalls on some parts (thin slabs, the robe: 4-7x
            # over budget), so the low is made here, symmetric first, plain collapse when that stalls
            low = mesh.duplicate(ob, f"{name}_low", ctx.col)
            if mesh.decimate_to(low, tris) > tris * 1.25:
                bpy.data.objects.remove(low)
                low = mesh.duplicate(ob, f"{name}_low", ctx.col)
                mesh.decimate_to(low, tris, symmetric=False)
            P.append(fighter.Part(name, high=ob, low=low, tris=tris, bind=bind, uv_weight=uvw))
        return P

    def sculpts(self, ctx) -> list:
        out = []

        budget = TRIS[self.faction]

        def part(name, S, role, bind, tris, vs=1.0, uvw=1.0):
            out.append((name, S, vs, role, bind, budget.get(name, tris), uvw))
        info = ctx.info
        F = self.F
        aub = self.faction == "aubade"
        hood_parts(F, aub, part)
        body_parts(F, aub, info, part)
        arm_parts(F, aub, info, part)
        staff_parts(F, aub, info, part, up=staff_up_rest(self, info) if aub else None)
        return out

    # ── clips ──
    def clip_overrides(self, ctx) -> dict:
        if self.faction == wc.LEGACY:
            return {}
        skel = anim.Skeleton(ctx.info.armature)
        return clips(self, skel)

    def legacy_props(self, ctx, part) -> None:
        k = self.H / 1.1
        info = ctx.info
        hz = (info.j("head_base").z + info.j("crown").z) / 2
        wc.legacy_weapon(self, ctx, part, "ironstone", (0.07, 0.07, 0.09))
        wc.legacy_pole_lamp(self, ctx, part, rise=0.3)
        plates = Sculpt("pauldrons")
        for s in ("L", "R"):
            a = info.side("shoulder", s)
            plates.add(Ellipsoid((a.x, a.y, a.z + 0.04 * k), (0.11 * k, 0.1 * k, 0.06 * k)), k=0.0)
        part("pauldrons", plates, "stone", "bone:chest", 300)
        ring = Sculpt("crown")
        ring.add(Torus((0, 0.02 * k, hz + 0.18 * k), 0.12 * k, 0.025 * k), k=0.0)
        part("crown", ring, "accent", "bone:head", 120)


# triangle budget per part (brief §1: brightwick <= 4.0k; the decimation lands a little under these)
TRIS = {
    "aubade": {"hood": 420, "hood_rim": 130, "hood_in": 60, "hood_light": 40, "crown": 270, "crown_lamps": 110,
               "seam": 60, "cowl": 160, "pauldron_R": 190, "pauldron_L": 190, "cloak": 600, "back_stripe": 50,
               "belt": 50, "tabard": 70, "tabard_light": 90, "legs": 80, "boot_L": 90, "boot_R": 90, "sleeves": 220,
               "forearms": 170, "mitt_L": 110, "mitt_R": 110, "staff": 110, "staff_cap": 60, "lantern": 190,
               "lantern_light": 60},
    "serenade": {"hood": 380, "hood_rim": 130, "hood_in": 60, "hood_light": 40, "crown": 160, "crown_lamps": 72,
                 "collar": 140, "gorget": 110, "mantle": 230, "pauldron_R": 180, "pauldron_L": 180, "cloak": 600,
                 "tabard": 70, "tabard_light": 90, "legs": 80, "boot_L": 90, "boot_R": 90, "sleeves": 190,
                 "forearms": 140, "mitt_L": 110, "mitt_R": 110, "staff": 110, "staff_cap": 50, "lantern_collar": 70,
                 "lantern": 170, "lantern_light": 70,
                 "boss_light_L": 40, "boss_light_R": 40},
}

# flat-painted parts (no concept paint lands well on them: lantern frames, the hood's inner lining)
FLAT = {
    "aubade": {"hood_in": "#1A1F27", "lantern": "#CBC8BF", "staff_cap": "#CBC8BF"},
    "serenade": {"hood_in": "#1C1712", "lantern": "#4B4039", "staff_cap": "#4B4039", "lantern_collar": "#5A4436"},
}
PAINT: dict = {}            # concept id -> spec (the paint-pose projection looks its pose up here)


# ── hood, crown ──────────────────────────────────────────────────────────────────────────────────────
def hood_parts(F, aub, part):
    hc, hr = F["hood"]
    oc, orr = F["hollow"]
    hood = Sculpt("hood")
    hood.add(Ellipsoid(hc, hr), k=0.0)
    if aub:
        # swept back at the nape (the cowl falls back and down, never up), the lower hood flares onto the cowl
        hood.add(RoundCone((0, 0.06, 1.47), (0, 0.13, 1.33), 0.150, 0.135), k=0.06)
        hood.add(Ellipsoid((0, 0.02, 1.36), (0.20, 0.20, 0.08)), k=0.05)
    else:
        # the felt dome is a bullet: straight sides, a round top, sitting in the rolled collar
        (cy, cz0, cr0), (cz1, cr1) = F["hood_cone"]
        hood.add(RoundCone((0, cy, cz0), (0, cy, cz1), cr0, cr1), k=0.05)
    hood.sub(Ellipsoid(oc, orr), k=0.012)
    part("hood", hood, "cloth2", "bone:head", 620, 1.0, 1.4)
    # the rim around the opening: chalk lip (Aubade) / rolled dark felt (Serenade)
    rim = Sculpt("hood_rim")
    loop_tube(rim, opening_loop(F, lift=0.002 if aub else 0.0), 0.019 if aub else 0.024)
    part("hood_rim", rim, "chalk" if aub else "cloth", "bone:head", 220, 0.7, 1.4)
    if not aub:
        # Serenade: the felt rim's inner lip is lit (the concept's glowing arch): an accent strip just inside
        oc, orr = F["hollow"]
        L = np.array(opening_loop(F, n=20, lift=0.0))
        c2 = np.array((oc[0], 0.0, oc[2]))
        d = L - c2
        d[:, 1] = 0.0
        d /= np.linalg.norm(d, axis=1, keepdims=True)
        L2 = L - d * 0.03 + np.array((0.0, 0.016, 0.0))
        L2 = np.vstack([L2, L2[:1]])
        nrm = np.tile((0.0, -1.0, 0.0), (len(L2), 1)) + np.vstack([d, d[:1]]) * 0.5
        v, q = ribbon(L2, nrm, 0.022, 0.006, sink=0.004)
        part("hood_lip", ("mesh", v, q), "accent", "bone:head", None, 0.6)
    # the lining: a dark shell set just inside the hollow, so the visible inside is flat ink
    lin = Sculpt("hood_in")
    lin.add(Ellipsoid(oc, tuple(r - 0.006 for r in orr)), k=0.0)
    lin.sub(Ellipsoid(oc, tuple(r - 0.030 for r in orr)), k=0.0)
    lin.inter(HalfSpace((0, oc[1] + 0.045, 0), (0, -1, 0), 2.0), k=0.0)
    part("hood_in", lin, "ink", "bone:head", 120, 0.8, 0.4)
    # the hood light: one soft volume, wider than tall, set back in the hollow (no eye points)
    lc, lr = F["hood_light"]
    gl = Sculpt("hood_light")
    gl.add(Ellipsoid(lc, lr), k=0.0)
    part("hood_light", gl, "accent", "bone:head", 60, 0.7)
    if aub:
        crown_aubade(F, part, hood)
    else:
        crown_serenade(F, part)


def hood_radius(F, z):
    """(rx, ry) of the hood's outer surface at height z (the ellipsoid; the cone below for Serenade)."""
    hc, hr = F["hood"]
    q = max(0.0, 1.0 - ((z - hc[2]) / hr[2]) ** 2)
    return hr[0] * math.sqrt(q), hr[1] * math.sqrt(q)


def crown_aubade(F, part, hood):
    """low chalk circlet with six short points; six small lamps (accent) between them; the accent seam over
    the dome from the brow to the nape (the Aubade hood mark)"""
    hc, hr = F["hood"]
    zb = 1.606
    rx, ry = hood_radius(F, zb)
    rx, ry = rx + 0.014, ry + 0.014
    ring = Sculpt("crown")
    ring.add(Torus((0, hc[1], zb), rx, 0.017, axes=np.diag([1.0, rx / ry, 1.0]), rz=0.025), k=0.0)
    lamps = Sculpt("crown_lamps")
    for i in range(12):
        a = math.radians(30 * i)
        sx, sy = math.sin(a), -math.cos(a)
        base = V3((sx * (rx + 0.004), hc[1] + sy * (ry + 0.004), zb + 0.018))
        out = V3((sx, sy, 0.0))
        if i % 2 == 0:            # a point: short tapered chalk spike, leaning a little outward
            ring.add(RoundCone(base, base + out * 0.012 + V3((0, 0, 0.068)), 0.016, 0.0045), k=0.008)
        else:                     # a lamp: chalk cup + an accent drop (the flame), rounded, no point
            ring.add(Sphere(base + V3((0, 0, 0.004)), 0.017), k=0.006)
            c = base + out * 0.002 + V3((0, 0, 0.030))
            lamps.add(Sphere(c + V3((0, 0, 0.006)), 0.026), k=0.0)
            lamps.add(RoundCone(c + V3((0, 0, 0.006)), c + V3((0, 0, 0.040)), 0.026, 0.009), k=0.01)
    part("crown", ring, "chalk", "bone:head", 420, 0.55, 1.2)
    part("crown_lamps", lamps, "accent", "bone:head", 160, 0.55)
    # the seam: a 4.4 cm inlaid strip on the meridian, brow -> crown -> nape, laid on the hood's real surface
    aa = np.radians(np.linspace(-60, 132, 14))
    P0 = np.stack([np.zeros_like(aa), hc[1] + hr[1] * np.sin(aa), hc[2] + hr[2] * np.cos(aa)], 1)
    N0 = np.stack([np.zeros_like(aa), np.sin(aa) / hr[1], np.cos(aa) / hr[2]], 1)
    S0, G0 = onto_surface(sdf_of(hood), P0, N0, reach=0.09)
    v, q = ribbon(S0, G0, 0.056, 0.007)
    part("seam", ("mesh", v, q), "accent", "bone:head", None, 0.6)


def crown_serenade(F, part):
    """a flush ironstone band 9 cm tall on the felt dome with round lampresin windows (accent glazing)"""
    hc, hr = F["hood"]
    zb = 1.592
    rx, ry = hood_radius(F, zb)
    band = Sculpt("crown")
    band.add(Torus((0, hc[1], zb), rx + 0.004, 0.021, axes=np.diag([1.0, rx / ry, 1.0]), rz=0.047), k=0.0)
    # twelve round windows (seven face the front): flat glazing caps laid on the band's outer face
    aa = np.radians(np.arange(12) * 30.0)
    P0 = np.stack([np.sin(aa) * (rx + 0.03), hc[1] - np.cos(aa) * (ry + 0.03), np.full(12, zb)], 1)
    N0 = np.stack([np.sin(aa) / rx, -np.cos(aa) / ry, np.zeros(12)], 1)
    S0, G0 = onto_surface(sdf_of(band), P0, N0, reach=0.05, lift=0.003)
    v, f = discs(S0, G0, 0.035, 8)
    part("crown", band, "ironstone", "bone:head", 520, 0.6, 1.2)
    part("crown_lamps", ("mesh", v, f), "accent", "bone:head", None, 0.6)


# ── cowl/collar, pauldrons, cloak, robe, tabard, legs, boots ──────────────────────────────────────────────
def body_parts(F, aub, info, part):
    sh = F["shoulder"]
    # COWL (Aubade: blue scarf with a V front and back) / ROLLED COLLAR + iron gorget + sand MANTLE (Serenade)
    if aub:
        cowl = Sculpt("cowl")
        cowl.add(Torus((0, 0.01, 1.285), 0.165, 0.055, axes=np.diag([1.0, 1.0 / 0.92, 1.0]), rz=0.05), k=0.0)
        cowl.add(Ellipsoid((0, -0.13, 1.225), (0.13, 0.07, 0.075), axes=sdf.rot_x(-18)), k=0.04)
        cowl.add(RoundCone((0, -0.17, 1.22), (0, -0.19, 1.165), 0.04, 0.012), k=0.04)            # the V point
        cowl.add(Ellipsoid((0, 0.14, 1.24), (0.20, 0.09, 0.10), axes=sdf.rot_x(14)), k=0.05)
        cowl.add(RoundCone((0, 0.20, 1.22), (0, 0.22, 1.17), 0.05, 0.012), k=0.04)
        part("cowl", cowl, "cloth2", ("zblend", "chest", "neck", 1.24, 1.34), 300, 1.0, 1.1)
    else:
        col = Sculpt("collar")
        col.add(Torus((0, 0.045, 1.335), 0.195, 0.068, axes=sdf.frame((0, -0.32, 0.95))), k=0.0)
        part("collar", col, "cloth", ("zblend", "chest", "neck", 1.28, 1.40), 300, 1.0, 1.1)
        gor = Sculpt("gorget")
        gor.add(Torus((0, -0.01, 1.225), 0.225, 0.042, axes=np.diag([1.0, 1.0 / 0.82, 1.0]), rz=0.052).displaced(
            lambda P: 0.006 * np.clip(NOISE.ridged(P, 11.0, 2), 0, 1) - 0.002, 0.006), k=0.0)
        gor.inter(HalfSpace((0, 0.06, 0), (0, 1, 0), 2.0), k=0.02)
        part("gorget", gor, "ironstone", "bone:chest", 260, 0.8, 1.1)
        man = Sculpt("mantle")
        tab = [(0.98, 0.40), (1.10, 0.39), (1.20, 0.34), (1.28, 0.26), (1.33, 0.19)]
        man.add(bell(tab, 0.80, 0.99, 1.33), k=0.0)
        # the front opening between the two rounded lapels
        man.sub(RoundBox((0, -0.36, 0.95), (0.105, 0.2, 0.17), 0.05), k=0.02)
        man.inter(HemCut(1.0, 0.03, 2, 0.6), k=0.01)
        part("mantle", man, "cloth2", ("zblend", "spine", "chest", 0.98, 1.12), 420, 1.0, 1.1)
    # PAULDRONS
    for s, sx in (("R", -1.0), ("L", 1.0)):
        pa = Sculpt(f"pauldron_{s}")
        px = F["pauldron_x"] * sx
        if aub:
            # stepped chalk plates, each top plate rising into two short upward points (<= 10 cm)
            pa.add(RoundBox((px, 0.0, 1.335), (0.105, 0.125, 0.032), 0.028, axes=sdf.rot_y(sx * 26)), k=0.0)
            pa.add(RoundBox((px + sx * 0.04, 0.0, 1.268), (0.090, 0.130, 0.028), 0.024, axes=sdf.rot_y(sx * 38)), k=0.012)
            pa.add(RoundBox((px + sx * 0.07, 0.0, 1.205), (0.064, 0.118, 0.024), 0.02, axes=sdf.rot_y(sx * 52)), k=0.012)
            pa.add(RoundCone((px + sx * 0.06, 0.0, 1.36), (px + sx * 0.085, 0.0, 1.455), 0.030, 0.006), k=0.012)
            pa.add(RoundCone((px - sx * 0.055, 0.01, 1.37), (px - sx * 0.065, 0.015, 1.47), 0.038, 0.008), k=0.014)
        else:
            # rounded ironstone domes, a lip at the lower edge, a round boss at the front
            dome = Ellipsoid((px, 0.01, 1.245), (0.155, 0.172, 0.125), axes=sdf.rot_y(sx * 24))
            pa.add(dome, k=0.0)
            pa.inter(HalfSpace((px, 0, 1.145), (-sx * 0.42, 0, -0.91), 2.0), k=0.02)
            pa.add(Torus((px + sx * 0.035, 0.01, 1.165), 0.135, 0.016, axes=sdf.frame((-sx * 0.42, 0, 0.91)) @ np.diag([1, 1 / 1.12, 1]), rz=0.016), k=0.01)
            bn = V3((-sx * 0.25, -0.95, 0.15))
            bn /= np.linalg.norm(bn)
            bc = V3((px - sx * 0.10, -0.135, 1.215))
            pa.add(Torus(tuple(bc), 0.046, 0.013, axes=sdf.frame(bn)), k=0.006)            # the boss ring
            pa.sub(Capsule(tuple(bc - bn * 0.03), tuple(bc + bn * 0.02), 0.036), k=0.004)
            bl = Sculpt(f"boss_light_{s}")
            bl.add(Capsule(tuple(bc - bn * 0.03), tuple(bc + bn * 0.004), 0.037), k=0.0)    # a lampresin boss window
            part(f"boss_light_{s}", bl, "accent",
                 ("dblend", f"shoulder.{s}", f"upper_arm.{s}", (sx * sh, 0.0, 1.30), (sx * 0.55, 0.0, -0.83), 0.06, 0.16), 50, 0.6)
        part(f"pauldron_{s}", pa, "chalk" if aub else "ironstone",
             ("dblend", f"shoulder.{s}", f"upper_arm.{s}", (sx * sh, 0.0, 1.30), (sx * 0.55, 0.0, -0.83), 0.06, 0.16),
             300 if aub else 280, 0.7, 1.2)
    # CLOAK: an open bell (a 2.8 cm shell), straight vertical folds, open in front over the tabard
    tab = F["cloak_rx"]
    z0, z1 = tab[0][0], tab[-1][0]
    # a SOLID bell (no inner shell: half the triangles for the same form); the front opening is a recess down
    # to the robe's surface, so the robe and the cloak's inner edges are one painted surface
    cl = Sculpt("cloak")
    cl.add(bell(tab, F["cloak_ry"], z0 - 0.04, z1).displaced(folds(0.012, 9.0), 0.012), k=0.0)
    if not aub:
        # the ironstone band near the hem: a raised ring (the paint colours it)
        cl.add(bell([(0.26, 0.430), (0.34, 0.422)], F["cloak_ry"], 0.268, 0.332, inset=-0.006), k=0.006)
    hz0, hamp, hn = F["hem"]
    cl.inter(HemCut(hz0, hamp, hn, 0.8), k=0.006)
    op = F["cloak_open"]
    robe = bell(tab, F["cloak_ry"], 0.0, z1, inset=RECESS)          # the floor: 4 cm in from the cloak
    cl.sub(sdf.Blend([("add", RoundBox((0, -0.45, 0.5), (op, 0.25, 0.62), 0.03), 0.0), ("sub", robe, 0.0)]), k=0.02)
    part("cloak", cl, "cloth", ("bw_auto", BODY_EXCLUDE), 900 if aub else 860, 1.0, 1.0)
    if aub:
        # the back stripe (accent) down the cloak's spine, below the cowl's V
        zz = np.linspace(0.15, 1.17, 10)
        P0 = np.stack([np.zeros_like(zz), interp(tab, zz) * F["cloak_ry"], zz], 1)
        S0, G0 = onto_surface(sdf_of(cl), P0, np.tile((0.0, 1.0, 0.0), (len(zz), 1)), reach=0.06)
        v, q = ribbon(S0, G0, 0.062, 0.007)
        part("back_stripe", ("mesh", v, q), "accent", ("bw_transfer", "cloak"), None, 0.7)
    if aub:
        # the chalk bandage belt wrapped over the robe and tabard
        belt = Sculpt("belt")
        rb = float(interp(tab, 0.965)) - RECESS + 0.004
        belt.add(Torus((0, 0.0, 0.965), rb, 0.03, axes=np.diag([1.0, 1.0 / F["cloak_ry"], 1.0]), rz=0.04).displaced(
            wraps((0, 0, 0.9), (0, 0, 1.03), 0.004, 0.03), 0.004), k=0.0)
        belt.inter(HalfSpace((0, -0.16, 0), (0, 1, 0), 2.0), k=0.01)            # only the front shows
        part("belt", belt, "cloth2", ("bw_transfer", "cloak"), 60, 0.8, 1.0)
    # TABARD on the front (chalk-white, Aubade / sand felt, Serenade), pointed at the hem
    hw, ztop, ztip, zv = F["tabard"]
    y_top = -(float(interp(tab, ztop)) - RECESS) * F["cloak_ry"] - 0.012
    y_bot = -(float(interp(tab, ztip)) - RECESS) * F["cloak_ry"] - 0.016

    def ytab(z):
        return y_bot + (z - ztip) * (y_top - y_bot) / (ztop - ztip)
    tb = Sculpt("tabard")
    zax = V3((0.0, y_top - y_bot, ztop - ztip))
    tb.add(RoundBox((0, ytab((ztop + ztip) / 2), (ztop + ztip) / 2), (hw, 0.012, (ztop - ztip) / 2), 0.008,
                    axes=sdf.frame(zax, (1, 0, 0))), k=0.0)
    slope = (zv - ztip) / hw
    for sx in (-1.0, 1.0):
        n = V3((sx * slope, 0, -1.0))
        tb.inter(HalfSpace((0, 0, ztip), n / np.linalg.norm(n), 2.0), k=0.004)
    part("tabard", tb, "cloth2", ("bw_transfer", "cloak"), 160, 0.7, 1.3)
    # accent on the tabard: Aubade two edge stripes + the chevron; Serenade the double sash + the hem chevron
    acc = Sculpt("tabard_light")
    def yf(z):
        return ytab(z) - 0.012
    if aub:
        ins = 0.022
        path = [(-hw + ins, ztop - 0.04), (-hw + ins, zv + 0.012), (0.0, ztip + 0.034), (hw - ins, zv + 0.012),
                (hw - ins, ztop - 0.04)]
        path = [(x, yf(z), z) for x, z in path]
        for i in range(len(path) - 1):
            acc.add(Capsule(path[i], path[i + 1], 0.017), k=0.003)
    else:
        for zc in (0.902, 0.958):
            acc.add(RoundBox((0, yf(zc) + 0.004, zc), (hw + 0.016, 0.010, 0.025), 0.007), k=0.0)
        for sx in (-1.0, 1.0):
            acc.add(Capsule((sx * (hw - 0.012), yf(zv + 0.03), zv + 0.03), (0.0, yf(ztip + 0.03), ztip + 0.03), 0.019), k=0.004)
    part("tabard_light", acc, "accent", ("bw_transfer", "cloak"), 140, 0.6)
    # LEGS (dark trousers) and BOOTS
    legs = Sculpt("legs")
    for s in ("L", "R"):
        hp, kn, an = info.side("hip", s), info.side("knee", s), info.side("ankle", s)
        legs.add(RoundCone(tuple(hp), tuple(kn), 0.075, 0.065), k=0.0)
        legs.add(RoundCone(tuple(kn), (an.x, an.y, an.z + 0.03), 0.065, 0.055), k=0.03)
    part("legs", legs, "under", ("bw_auto", ("root", "spine", "chest", "neck", "head") + ARM_BONES), 220, 1.0, 0.5)
    bw, bl, bh = F["boot"]
    for s in ("L", "R"):
        an = info.side("ankle", s)
        b = Sculpt(f"boot_{s}")
        b.add(RoundBox((an.x, an.y - 0.035, bh * 0.75), (bw, bl, bh * 0.75), 0.045), k=0.0)
        b.add(RoundCone((an.x, an.y + 0.005, 0.07), (an.x, an.y + 0.01, 0.145), bw * 0.95, bw * 0.9), k=0.03)
        if aub:
            b.add(RoundCone((an.x, an.y - 0.10, 0.04), (an.x, an.y - 0.165, 0.055), 0.04, 0.016), k=0.03)
        else:
            b.add(Torus((an.x, an.y + 0.005, 0.135), bw * 0.92, 0.016), k=0.01)
        b.inter(HalfSpace((0, 0, 0.0), (0, 0, -1), 2.0), k=0.0)
        part(f"boot_{s}", b, "leather", ("zblend", f"foot.{s}", f"shin.{s}", 0.08, 0.14), 150, 1.0, 0.7)


# ── arms: sleeves, wraps/cuffs, mitts ────────────────────────────────────────────────────────────────
def hand_frame(info, s):
    w = np.array(info.side("wrist", s))
    a = np.array(info.joints[f"forearm_dir.{s}"])
    fwd = np.array((0.0, -1.0, 0.0))
    wv = fwd - a * fwd.dot(a)
    wv /= np.linalg.norm(wv)
    t = np.cross(a, wv)
    return w, a, wv, t


def arm_parts(F, aub, info, part):
    sl, wr = Sculpt("sleeves"), Sculpt("forearms")
    for s in ("L", "R"):
        sh, el, w = (np.array(info.side(n, s)) for n in ("shoulder", "elbow", "wrist"))
        if aub:
            sl.add(RoundCone(tuple(sh), tuple(el), 0.075, 0.088), k=0.0)          # bell sleeve flaring at the elbow
            sl.add(RoundCone(tuple(el), tuple(el + (w - el) * 0.25), 0.088, 0.078), k=0.02)
            wr.add(RoundCone(tuple(el + (w - el) * 0.15), tuple(w), 0.066, 0.060).displaced(wraps(el, w), 0.004), k=0.0)
        else:
            sl.add(RoundCone(tuple(sh), tuple(el), 0.088, 0.100), k=0.0)          # puffy felt sleeve
            sl.add(RoundCone(tuple(el), tuple(el + (w - el) * 0.35), 0.100, 0.082), k=0.03)
            wr.add(Torus(tuple(el + (w - el) * 0.36), 0.074, 0.022, axes=sdf.frame(w - el)), k=0.0)   # ironstone cuff
            wr.add(RoundCone(tuple(el + (w - el) * 0.35), tuple(w), 0.068, 0.062).displaced(wraps(el, w, 0.005, 0.03), 0.005), k=0.01)
    part("sleeves", sl, "cloth", ("bw_auto", SLEEVE_EXCLUDE), 360, 1.0, 1.0)
    part("forearms", wr, "cloth2" if aub else "leather", ("bw_auto", SLEEVE_EXCLUDE), 300, 0.8, 1.0)
    for s in ("L", "R"):
        w, a, wv, t = hand_frame(info, s)
        m = Sculpt(f"mitt_{s}")
        c = w + a * 0.06
        big = 1.0 if aub else 1.08
        m.add(RoundBox(tuple(c), (0.052 * big, 0.058 * big, 0.058 * big), 0.042 * big, axes=np.stack([t, wv, a])), k=0.0)
        # the thumb: a separate lobe over the staff, on the front of the fist
        th = c - wv * 0.045 * big + a * -0.01 + t * 0.03 * (1 if s == "L" else -1)
        m.add(Ellipsoid(tuple(th), (0.026, 0.03, 0.022), axes=np.stack([t, wv, a])), k=0.015)
        part(f"mitt_{s}", m, "leather", f"bone:hand.{s}", 180, 0.8, 1.0)


# ── staff + lantern on prop.R ───────────────────────────────────────────────────────────────────────
def staff_frame(info):
    """Rest frame of the held staff: P = the right palm (prop.R head), u = prop.R +Y (forward = toward the
    lantern), v/w = the cross axes (world X, Z)."""
    P = np.array(info.armature.data.bones["prop.R"].head_local)
    u = np.array((0.0, -1.0, 0.0))
    return {"P": P, "u": u, "v": np.array((1.0, 0.0, 0.0)), "w": np.array((0.0, 0.0, 1.0))}


def staff_up_rest(spec, info) -> np.ndarray:
    """The rest-frame direction (perpendicular to the staff) that points UP while the wick holds the staff in
    the paint pose: the Aubade staff head bends that way so its lantern stands upright on the diagonal."""
    skel = anim.Skeleton(info.armature)
    M = skel.fk(anim.resolve(skel, paint_pose(spec)))
    R = np.array(M["prop.R"].to_3x3()) @ np.array(skel.rest["prop.R"].to_3x3()).T
    d = R @ np.array((0.0, -1.0, 0.0))
    up = np.array((0.0, 0.0, 1.0)) - d * d[2]
    n = R.T @ (up / np.linalg.norm(up))
    n[1] = 0.0
    return n / np.linalg.norm(n)


def rodrigues(k, a):
    k = k / np.linalg.norm(k)
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + math.sin(a) * K + (1 - math.cos(a)) * K @ K


BEND_S, BEND_DEG = 0.80, 22.0       # Aubade: the staff head bends up 22 deg above the left fist


def staff_parts(F, aub, info, part, up=None):
    st = staff_frame(info)
    P, u, v, w = st["P"], st["u"], st["v"], st["w"]

    def at(s, dv=0.0, dw=0.0):
        return tuple(P + u * s + v * dv + w * dw)
    r = F["staff_r"]
    shaft = Sculpt("staff")
    if aub:
        # the head frame: bent toward `up` at BEND_S
        Rb = rodrigues(np.cross(u, up), math.radians(BEND_DEG))
        O = P + u * BEND_S
        u2, v2, w2 = Rb @ u, Rb @ v, Rb @ w

        def hat(s, dv=0.0, dw=0.0):
            return tuple(O + u2 * (s - BEND_S) + v2 * dv + w2 * dw)
        shaft.add(Capsule(at(-STAFF_BACK + 0.06), at(BEND_S), r).displaced(
            lambda Q: 0.0035 * NOISE(Q, 14.0) - 0.002 * np.abs(np.sin(np.arctan2((Q - P) @ w, (Q - P) @ v) * 3)), 0.0035), k=0.0)
        shaft.add(RoundCone(at(-STAFF_BACK + 0.07), at(-STAFF_BACK - 0.03), r * 1.05, 0.006), k=0.01)   # the pointed foot
        shaft.add(RoundCone(hat(BEND_S), hat(0.88), r * 1.05, r * 1.6), k=0.03)                       # bends up, flares
        part("staff", shaft, "wood", "bone:prop.R", 180, 0.7, 0.8)
        cap, lan, glass = Sculpt("staff_cap"), Sculpt("lantern"), Sculpt("lantern_light")
        fr2 = sdf.frame(u2, v2)
        # tall pointed four-sided dawnglass lantern in a chalk frame with a slender spire cap
        cap.add(Lathe(tuple(O), lambda rr, z: np.maximum(rr - (0.03 + 0.05 * np.clip((z - 0.06) / 0.05, 0, 1)),
                                                          np.maximum(0.05 - z, z - 0.115)), 0.09, 0.04, 0.13, axes=fr2), k=0.0)
        part("staff_cap", cap, "chalk", "bone:prop.R", 120, 0.6, 0.6)
        s0, s1, s2 = 0.905, 1.01, 1.125
        for cv, cw in [(1, 1), (1, -1), (-1, -1), (-1, 1)]:
            lan.add(Capsule(hat(s0, cv * 0.042, cw * 0.042), hat(s1, cv * 0.068, cw * 0.068), 0.0135), k=0.0)
            lan.add(Capsule(hat(s1, cv * 0.068, cw * 0.068), hat(s2, cv * 0.036, cw * 0.036), 0.0135), k=0.008)
        lan.add(RoundCone(hat(s2 - 0.01), hat(s2 + 0.06), 0.068, 0.022), k=0.012)                # pointed roof
        lan.add(RoundCone(hat(s2 + 0.05), hat(s2 + 0.19), 0.02, 0.004), k=0.01)                  # the spire
        lan.add(Sphere(hat(s2 + 0.085), 0.02), k=0.008)
        lan.add(Lathe(tuple(O), lambda rr, z: np.maximum(rr - 0.058, np.abs(z - (s0 - BEND_S)) - 0.012), 0.07,
                      s0 - BEND_S - 0.02, s0 - BEND_S + 0.02, axes=fr2), k=0.006)
        glass.add(RoundBox(hat(s1 - 0.003), (0.062, 0.062, 0.106), 0.035, axes=np.stack([v2, w2, u2])), k=0.0)
        glass.inter(RoundCone(hat(s0 - 0.01), hat(s2 + 0.02), 0.078, 0.052), k=0.01)
        part("lantern", lan, "chalk", "bone:prop.R", 360, 0.55, 0.6)
        part("lantern_light", glass, "accent", "bone:prop.R", 120, 0.6)
        return
    shaft.add(Capsule(at(-STAFF_BACK + 0.06), at(0.84), r).displaced(lambda Q: 0.004 * NOISE(Q, 10.0), 0.004), k=0.0)
    part("staff", shaft, "wood_dark", "bone:prop.R", 170, 0.7, 0.8)
    cap = Sculpt("staff_cap")
    lan, glass = Sculpt("lantern"), Sculpt("lantern_light")
    # the foot cap (ironstone), two collar rings, a round caged lampresin lantern, an iron cap + knob
    cap.add(Capsule(at(-STAFF_BACK + 0.0), at(-STAFF_BACK + 0.07), r * 1.55), k=0.0)
    cap.add(Capsule(at(-STAFF_BACK - 0.02), at(-STAFF_BACK + 0.0), r * 1.2), k=0.01)
    part("staff_cap", cap, "ironstone", "bone:prop.R", 80, 0.7, 0.5)
    col = Sculpt("lantern_collar")
    for s_, rr in ((0.78, 0.040), (0.835, 0.046)):
        col.add(Capsule(at(s_ - 0.016), at(s_ + 0.016), rr), k=0.004)
    part("lantern_collar", col, "ironstone", "bone:prop.R", 120, 0.6, 0.5)
    c = 0.97
    R = 0.112
    lan.add(Torus(at(c), R, 0.0125, axes=np.stack([u, w, v])), k=0.0)      # meridian band (u-w plane)
    lan.add(Torus(at(c), R, 0.0125, axes=np.stack([v, u, w])), k=0.006)    # meridian band (u-v plane)
    lan.add(Torus(at(c), R, 0.013, axes=np.stack([v, w, u])), k=0.006)     # equator (around u)
    lan.add(Capsule(at(c - R - 0.03), at(c - R + 0.01), 0.04), k=0.01)     # throat into the collar
    lan.add(Capsule(at(c + R - 0.005), at(c + R + 0.05), 0.036), k=0.01)   # iron cap
    lan.add(Sphere(at(c + R + 0.075), 0.03), k=0.012)                      # knob
    glass.add(Sphere(at(c), R - 0.005), k=0.0)
    part("lantern", lan, "ironstone", "bone:prop.R", 380, 0.6, 0.6)
    part("lantern_light", glass, "accent", "bone:prop.R", 140, 0.7)


# ── motion ───────────────────────────────────────────────────────────────────────────────────────────
def hold(rel, staff, pole_r=(-0.9, 0.3, -0.4), pole_l=(0.9, 0.2, -0.5), grip=GRIP_L) -> dict:
    """both fists on the staff: the right wrist at `rel` (arm lengths from the posed right shoulder, chest
    frame), the staff pointing along `staff` (character space: +X left, -Y front, +Z up), the left fist
    `grip` m up the staff"""
    return {"ik": {"hand.R": HandTarget(rel=tuple(rel), pole=tuple(pole_r)), "aim.R": Aim(tuple(staff)),
                   "hand.L": HandTarget(to_prop=("prop.R", grip), pole=tuple(pole_l))}}


def stance_feet(kx=0.03):
    return anim.feet(l=(kx, -0.02, 0.0), r=(-kx, 0.03, 0.0), yl=8, yr=-8)


GUARD_R = (0.06, -0.50, -0.72)          # right wrist: low in front of the right hip
GUARD_STAFF = (0.78, -0.14, 0.60)       # staff diagonal: lantern up on the wick's left, slightly forward


def guard_pose() -> dict:
    base = anim.P(hips=(2, 0, 0), spine=(2, 0, 0), chest=(2, 0, 0), neck=(-2, 0, 0), head=(-2, 0, 0))
    p = anim.merge(anim.arms_relaxed(), base, {"hips_loc": (0.0, 0.01, -0.035), "ik": stance_feet()},
                   hold(GUARD_R, GUARD_STAFF))
    return p


def paint_pose(spec) -> dict:
    """the concept's hold (the projection paints the mesh in this pose): absolute right wrist, staff dir"""
    pp = spec.F["paint"]
    p = anim.merge(anim.arms_relaxed(), {"ik": {
        "hand.R": HandTarget(pos=tuple(pp["wrist_R"]), pole=tuple(pp["pole_R"])),
        "aim.R": Aim(tuple(pp["staff"])),
        "hand.L": HandTarget(to_prop=("prop.R", GRIP_L), pole=tuple(pp["pole_L"]))}})
    return p


def clips(spec, skel) -> dict:
    out = {}
    g = guard_pose()
    hip_h = skel.rest_point("hips").z

    # IDLE (80 f): slow heave, the staff steady on the diagonal, crown level, a half-step settle per loop
    N = 80

    def idle(t):
        b = anim.osc(t, 2)
        s = anim.osc(t, 1, 0.1)
        d = anim.P(chest=(1.4 * b, 0, 0), spine=(0.6 * b, 0, 0.5 * s), neck=(-1.0 * b, 0, 0), head=(-0.5 * b, 0, 0),
                   hips=(0, 0, -0.8 * s))
        p = anim.add(g, d)
        # half-step: the right foot lifts and resettles 3 cm wider in the first half, back in the second
        u = max(0.0, math.sin(2 * math.pi * t))
        lift = 0.03 * max(0.0, math.sin(4 * math.pi * t)) if t < 0.5 else 0.0
        ik = dict(p["ik"])
        ik["foot.R"] = FootTarget((-0.03 - 0.025 * u, 0.03, lift), 0.0, -8 - 4 * u)
        ik["hand.R"] = HandTarget(rel=(GUARD_R[0], GUARD_R[1], GUARD_R[2] + 0.012 * b), pole=(-0.9, 0.3, -0.4))
        p["ik"] = ik
        return anim._with_hips(p, (0.006 * s, 0.0, -0.006 * (0.5 + 0.5 * b)))
    out["idle"] = anim.Clip("idle", N, True, anim.drag(idle, N, {"head": 2.0, "neck": 1.0}, loop=True))

    # RUN: a heavy, long stride at 3.3 m/s with the planted foot exact (anim.gen_run's foot law, scaled to a
    # 0.53 m leg), the staff held steady on the diagonal, the crown level
    out["run"] = run_clip(spec, skel, g)

    # ATTACK1 (30 f, impact at 40 % = 0.4 s windup): the staff swings up until the lantern stands over the hood,
    # then the wick levers it over the top and down in front (right fist up beside the hood, left fist driving
    # down at the waist), the body folding into the blow; then it recovers to the diagonal. Both fists stay on
    # the staff (the arms are short: the right fist is the lever's back end).
    wind = anim.merge(g, anim.P(hips=(-4, 4, 0), spine=(-6, 6, 0), chest=(-8, 8, 0), neck=(4, -4, 0), head=(6, -6, 0)),
                      {"hips_loc": (0.0, 0.03, -0.015)},
                      hold((0.22, -0.50, -0.52), (0.14, 0.30, 0.94), pole_r=(-0.9, 0.2, -0.4), pole_l=(0.9, 0.1, -0.2)))
    over = (0.24, -0.46, 0.86)                     # the lantern goes over the top, not round the side
    hit = anim.merge(g, anim.P(hips=(14, -4, 0), spine=(10, -6, 0), chest=(8, -8, 0), neck=(-6, 4, 0), head=(-8, 6, 0)),
                     {"hips_loc": (0.0, -0.06, -0.08)},
                     hold((-0.04, 0.02, 0.34), (0.45, -0.57, -0.69), pole_r=(-0.8, 0.4, -0.4), pole_l=(0.9, 0.3, -0.4)))
    hit["ik"]["foot.L"] = FootTarget((0.03, -0.12, 0.0), 0.0, 6.0)
    fol = anim.merge(hit, anim.P(hips=(16, -4, 0), spine=(11, -6, 0), chest=(9, -8, 0)),
                     {"hips_loc": (0.0, -0.07, -0.09)},
                     hold((-0.04, 0.0, 0.30), (0.42, -0.52, -0.74), pole_r=(-0.8, 0.4, -0.4), pole_l=(0.9, 0.3, -0.4)))
    fol["ik"]["foot.L"] = FootTarget((0.03, -0.12, 0.0), 0.0, 6.0)
    keys = anim.strike_keys(spec.MOTION, wind, hit, fol, guard_pose=g)
    keys = [(t, _with_aim(p, over) if abs(t - 0.34) < 1e-6 else p, e) for t, p, e in keys]
    fn = anim.keyed(keys)
    out["attack1"] = anim.Clip("attack1", 30, False, anim.drag(fn, 30, {"head": 1.5, "neck": 1.0}), impact=anim.IMPACT)

    # DEATH (60 f): recoil -> down on the right knee, the staff planted upright -> hold -> slides sideways off
    # the staff to the ground (onto its right side); the crown stays on the hood. Ends at rest.
    out["death"] = death_clip(spec, skel, g, hip_h)
    # a minion never recalls or stands in the lobby: short breathing loops keep the required set (CONTRACT
    # §12) without paying ~60 KB of GLB for clips the renderer never plays
    for name in ("recall", "idle_lobby"):
        out[name] = anim.Clip(name, 30, True, lambda t: anim.add(g, anim.P(chest=(1.2 * anim.osc(t, 1), 0, 0))))
    return out


def _with_aim(pose: dict, d) -> dict:
    p = dict(pose)
    p["ik"] = dict(p.get("ik", {}))
    p["ik"]["aim.R"] = Aim(tuple(d))
    return p


def run_clip(spec, skel, g) -> anim.Clip:
    prof = spec.MOTION
    v = prof["run_ref_speed"]
    leg = spec.PROPORTIONS["leg"]
    ks = leg / 0.86                                            # gen_run's swing is authored for a 0.86 m leg
    c = 0.36
    N = 16
    T = N / anim.FPS
    Ls = v * c * T
    swing = [(0.00, Ls / 2, 0.0, -26.0), (0.18, Ls / 2 + 0.06 * ks, 0.16 * ks, -48.0), (0.42, 0.06 * ks, 0.26 * ks, -30.0),
             (0.66, -Ls / 2 - 0.05 * ks, 0.17 * ks, -4.0), (0.86, -Ls / 2 - 0.02 * ks, 0.06 * ks, 9.0), (1.00, -Ls / 2, 0.0, 8.0)]

    def swing_at(s):
        for i in range(1, len(swing)):
            if s <= swing[i][0]:
                a, b = swing[i - 1], swing[i]
                uu = anim.sine((s - a[0]) / (b[0] - a[0]))
                return tuple(a[k] + (b[k] - a[k]) * uu for k in (1, 2, 3))
        return swing[-1][1:]

    def foot_at(q):
        q %= 1.0
        if q < c:
            uu = q / c
            y = -Ls / 2 + Ls * uu
            pitch = 8.0 * (1 - anim.sine(min(1.0, uu / 0.25))) - 26.0 * max(0.0, (uu - 0.62) / 0.38) ** 1.6
            return (0.0, y, 0.0), pitch
        dy, dz, pitch = swing_at((q - c) / (1 - c))
        return (0.0, dy, dz), pitch

    bob, drop, lean = 0.026, 0.05, 10.0

    def sample(t):
        q = t % 1.0
        fl, pl = foot_at(q)
        fr, pr = foot_at(q + 0.5)
        z = -drop - bob * math.cos(2 * math.pi * (2 * q - c)) * 0.5 - bob * 0.5
        x = 0.014 * math.cos(2 * math.pi * (q - c / 2))
        yaw = -6.0 * math.cos(2 * math.pi * q)
        roll = 4.0 * math.sin(2 * math.pi * (q - c / 2))
        p = anim.merge(anim.arms_relaxed(), anim.P(
            hips=(lean * 0.5, yaw, roll), spine=(lean * 0.3, -yaw * 0.5, -roll * 0.6),
            chest=(lean * 0.2 + 1.5 * math.cos(4 * math.pi * q), -yaw * 0.4, -roll * 0.3),
            neck=(-lean * 0.5, 0, 0), head=(-lean * 0.45, 0, 0)))
        bz = 0.015 * math.cos(4 * math.pi * (q - 0.08))
        p = anim.merge(p, hold((GUARD_R[0], GUARD_R[1] - 0.04, GUARD_R[2] + bz), (0.72, -0.20, 0.66)))
        p["ik"]["foot.L"] = FootTarget((0.015 + fl[0], fl[1] - 0.02, fl[2]), pl, -3, 0, 0)
        p["ik"]["foot.R"] = FootTarget((-0.015 + fr[0], fr[1] - 0.02, fr[2]), pr, 3, 0, 0)
        p["hips_loc"] = (x, 0.02, z)
        return p
    return anim.Clip("run", N, True, sample, meta={"run_ref_speed": v, "stride_m": round(v * T / 2, 3),
                                                     "cycle_s": round(T, 3)})


def death_clip(spec, skel, g, hip_h) -> anim.Clip:
    N = 60
    fk_arms = anim.arms_relaxed()
    recoil = anim.merge(g, anim.P(hips=(-6, 0, 4), spine=(-8, 0, 0), chest=(-12, 4, 0), neck=(-8, 0, 0), head=(-12, 0, 0)),
                        {"hips_loc": (0.0, 0.05, -0.02)})
    lean = (0.36, -0.62, -0.70)           # down on the right knee, leaning on the staff, the lantern on the ground ahead
    kneel = anim.merge(fk_arms, anim.P(hips=(10, 0, 0), spine=(10, 0, 0), chest=(8, 0, 0), neck=(4, 0, 0), head=(10, 0, 0),
                                       thigh_R=(20, 0, 4), shin_R=(-100, 0, 0), foot_R=(-10, 0, 0),
                                       thigh_L=(80, 0, -4), shin_L=(-82, 0, 0), foot_L=(0, 0, 0)),
                       {"ik": {"hand.R": HandTarget(rel=(0.10, -0.62, -0.30), pole=(-0.9, 0.1, -0.4)), "aim.R": Aim(lean),
                               "hand.L": HandTarget(rel=(-0.10, -0.40, -0.80), pole=(0.9, 0.3, -0.3))}})
    kneel["hips_loc"] = (0.0, 0.02, -hip_h * 0.40)
    sag = anim.add(kneel, anim.P(spine=(6, 0, 0), chest=(6, 0, 0), head=(8, 0, 0)))
    sag["hips_loc"] = (0.0, 0.02, -hip_h * 0.43)
    # down: rolled onto its right side (+Z on the spine chain tips the top toward -X), knees drawn up a little
    down = anim.merge(fk_arms, anim.P(hips=(16, 0, 84), spine=(6, 0, 4), chest=(6, 0, 2), neck=(0, 0, -8), head=(6, 0, -12),
                                      thigh_R=(40, 0, 0), shin_R=(-50, 0, 0), thigh_L=(30, 0, 0), shin_L=(-40, 0, 0),
                                      upper_arm_R=(30, 0, 30), forearm_R=(30, 0, 0), upper_arm_L=(20, 0, -10), forearm_L=(40, 0, 0)))
    down["hips_loc"] = (-0.30, 0.0, -hip_h + 0.20)
    down["ik"] = {"aim.R": Aim((0.15, -0.98, 0.0)), "hand.L": HandTarget(to_prop=("prop.R", GRIP_L), pole=(0.9, 0.2, -0.5))}
    bounce = anim.add(down, anim.P(hips=(0, 0, -4), spine=(-3, 0, 0)))
    bounce["hips_loc"] = (-0.30, 0.0, -hip_h + 0.225)
    rest = anim.add(down, anim.P(head=(0, 0, -3)))
    rest["hips_loc"] = (-0.31, 0.0, -hip_h + 0.195)
    keys = [(0.0, g, "linear"), (0.12, recoil, "snap"), (0.34, kneel, "inout"), (0.52, sag, "inout"),
            (0.78, down, "in"), (0.85, bounce, "out"), (0.93, rest, "inout"), (1.0, rest, "linear")]
    return anim.Clip("death", N, False, anim.keyed(keys))


# ── pipeline hooks (this module's builds only) ────────────────────────────────────────────────────────
def _armature_of(obj):
    for m in obj.modifiers:
        if m.type == "ARMATURE" and m.object is not None:
            return m.object
    return obj.parent if obj.parent and obj.parent.type == "ARMATURE" else None


def posed_coords(obj, pose: dict) -> np.ndarray:
    """vertex positions of the skinned `obj` with its armature in `pose` (the armature is reset after)"""
    arm = _armature_of(obj)
    anim.apply_pose(arm, pose)
    dg = bpy.context.evaluated_depsgraph_get()
    eo = obj.evaluated_get(dg)
    me = eo.to_mesh()
    co = np.empty(len(me.vertices) * 3, dtype=np.float64)
    me.vertices.foreach_get("co", co)
    mw = np.array(obj.matrix_world)
    eo.to_mesh_clear()
    anim.apply_pose(arm, {})
    co = co.reshape(-1, 3)
    return co @ mw[:3, :3].T + mw[:3, 3]


def yawed(co: np.ndarray, deg: float) -> np.ndarray:
    a = math.radians(deg)
    R = np.array([[math.cos(a), -math.sin(a), 0], [math.sin(a), math.cos(a), 0], [0, 0, 1]])
    return co @ R.T


_orig_paint_object = project.paint_object


def _paint_object(obj, size, cfg, names, part_attr="vale_part", log=print, return_maps=False):
    spec = PAINT.get(cfg.get("concept"))
    if spec is None:
        return _orig_paint_object(obj, size, cfg, names, part_attr=part_attr, log=log, return_maps=return_maps)
    me = obj.data
    n = len(me.vertices)
    rest = np.empty(n * 3, dtype=np.float32)
    me.vertices.foreach_get("co", rest)
    posed = posed_coords(obj, paint_pose(spec))
    mwi = np.linalg.inv(np.array(obj.matrix_world))

    def set_co(world):
        loc = world @ mwi[:3, :3].T + mwi[:3, 3]
        me.vertices.foreach_set("co", loc.astype(np.float32).ravel())
        me.update()
    yaw = spec.F["paint"]["yaw"]
    try:
        set_co(posed)
        img_b, maps = _orig_paint_object(obj, size, cfg, names, part_attr=part_attr, log=log, return_maps=True)
        if abs(yaw) > 1e-6:
            set_co(yawed(posed, yaw))
            img_f = _orig_paint_object(obj, size, cfg, names, part_attr=part_attr, log=log)
            ny = maps["N"][..., 1]
            wb = np.clip((ny + 0.25) / 0.5, 0, 1)
            wb = (wb * wb * (3 - 2 * wb))[..., None]
            img = img_f * (1 - wb) + img_b * wb
        else:
            img = img_b
        log(f"brightwick: painted in the concept's pose (front yaw {yaw} deg)")
    finally:
        me.vertices.foreach_set("co", rest)
        me.update()
    return (img, maps) if return_maps else img


project.paint_object = _paint_object
_orig_bind_part = pipeline.bind_part


def _bind_part(ctx, part, obj, body_low=None):
    b = part.bind
    if isinstance(b, tuple) and b and b[0] == "bw_auto":
        res = mesh.bind_auto(obj, ctx.info.armature, exclude=tuple(b[1]))
        mesh.limit_weights(obj)
        return res
    if isinstance(b, tuple) and b and b[0] == "bw_transfer":     # ride the named (already bound) part's skin
        src = bpy.data.objects.get(f"{b[1]}_low")
        mesh.transfer_weights(src, obj)
        mesh.add_armature_modifier(obj, ctx.info.armature)
        mesh.parent_keep(obj, ctx.info.armature)
        return {}
    return _orig_bind_part(ctx, part, obj, body_low)


pipeline.bind_part = _bind_part

KINDS = [Brightwick]

if __name__ == "__main__":
    wc.run(KINDS)
