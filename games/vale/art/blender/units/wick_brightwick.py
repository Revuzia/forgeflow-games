"""brightwick: the super Wick (1.7 m). Pauldrons, a crown-lamp ring on the hood, a two-hand lamp staff.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/wick_brightwick_plates.py        # plates (both)
    Blender -b --factory-startup --python art/blender/proto/wick_brightwick_fit.py -- [--faction aubade]
    Blender -b --factory-startup --python art/blender/proto/wick_brightwick_pose.py -- [--faction aubade]
    Blender -b --factory-startup --python-exit-code 1 --python art/blender/units/wick_brightwick.py -- \
        [--faction aubade|serenade|both|legacy] [--fast] [--clip-sheet]

Builds brightwick_aubade + brightwick_serenade (default: both) into art/out/units/; `--faction legacy` rebuilds
today's brightwick.glb (frozen: `legacy_props` below and wick_common's legacy body). Brief:
_design/units/wicks.md §3.4 (law). Concepts: _design/concept/wicks/brightwick_{aubade,serenade}.webp.
Progress log: art/renders/units/_wick_brightwick_progress.md.

ART 2.0 (HANDOFF "Art 2.0 method", reference fighters/marund.py): numpy SDF volumes fitted to each concept on a
10 cm grid (proto/wick_brightwick_fit.py), normals + AO from the sculpt.

  * Concepts vs brief: the concepts' proportions win (approved look: Aubade's rounded cowl rises a little above its
    crown points, 1.73 m; Serenade's pauldrons are broader); the brief's RULES win: no face (one soft hood light,
    set back at mid-height of the hollow), rounded hoods only (crown points <= 9 cm, pauldron points <= 10 cm),
    every glow is `accent` geometry (clean explicit meshes: the decimated SDF lamps went gem-cut), palette per
    §2.3-2.4.
  * PAINT (fix pass): the concept projection (graded plates, paint pose) misregistered at minion scale (blotchy
    banded felt, a doubled chalk rim, smears across the Serenade dome) and the concepts paint their own light, so
    the base colour is now PAINTED FROM THE SCULPT (`paint_procedural`): the palette per part and region (hem
    bands, pauldron stripes, robe floor, wood grain, felt grain), fold light and valley shadow read from each
    part's SDF (Laplacian + SDF occlusion), a soft top light, hue-shifted shadows and the bible's light-top /
    dark-feet ramp. The concepts drive form, layout and colour placement; the colours are the palette.
  * Same job silhouette in both cultures: the same rig, staff layout (right grip 0.40 m from the foot, left grip
    0.72 m above it, lantern at the upper left) and the same clips; hood, crown, pauldrons, trims, lamp differ.
  * REST = A-pose (CONTRACT §12). The staff rides prop.R; prop.R keeps its rest frame (+Y forward through the right
    fist) and the staff is modelled along it, so `aim.R` = the staff direction and the left hand grips
    `to_prop=("prop.R", GRIP_L)`. The PAINT POSE (`paint_pose`: the concept's hold) now only orients the Aubade
    staff head and the fit check.
  * The cloak is a rigid bell on the hips (thighs <= 22 %, averaged at the centre front: no shear, no tear in the
    run); the death clip is ground-solved on the skinned mesh frame by frame (`ground_solve`: nothing below z 0).

Pipeline additions kept in this module (common/ and wick_common.py untouched): the procedural paint
(`_paint_object`, wraps project.paint_object for `wicks/brightwick*` ids only), the binds `("bw_auto", exclude)`
(bone heat over a bone subset), `("bw_transfer", part)` and `("bw_cloak",)` (wraps pipeline.bind_part for those
tuples only), a deeper bake cage (`_bake_asset`), the ORM's empty texels filled + per-material roughness before
its 256 scale (`_set_image_array`) and a non-metallic baked material (`_gltf_material`: metallic through a x0
multiply, so the GLB carries metallicFactor 0 and the ORM's B channel is 0); the last three touch brightwick
faction textures only.
"""
from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

import wick_common as wc  # noqa: E402
from common import anim, bake, fighter, mesh, pipeline, rig, scene  # noqa: E402
from common.anim import Aim, FootTarget, HandTarget  # noqa: E402
from common.hifi import project, sdf  # noqa: E402
from wick_common import (Capsule, Ellipsoid, HalfSpace, Lathe, RoundBox, RoundCone, Sculpt, Sphere,  # noqa: E402
                         Torus)

V3 = np.array
NOISE = sdf.Noise(29)
PNOISE = sdf.Noise(71)        # paint noise
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
        "hood_light": ((0.0, -0.128, 1.448), (0.072, 0.016, 0.058)),   # a soft lens at mid-height, 5 cm behind the opening
        "shoulder": 0.205,
        "cloak_rx": [(0.08, 0.425), (0.40, 0.415), (0.80, 0.395), (1.05, 0.375), (1.20, 0.33), (1.30, 0.25), (1.36, 0.17)],
        "cloak_ry": 0.70, "cloak_open": 0.155, "hem": (0.105, 0.035, 5),
        "folds": (0.030, 7.0, 0.10),                                # long straight vertical folds (14 around)
        "tabard": (0.088, 1.17, 0.20, 0.31),                        # half width, top, tip, where the V starts
        "pauldron_x": 0.255, "boot": (0.062, 0.105, 0.06),
        "staff_r": 0.024,
        # paint pose (the concept's hold): right wrist, staff direction, front-view yaw (deg)
        "paint": {"wrist_R": (-0.17, -0.25, 0.84), "staff": (0.78, -0.06, 0.62), "yaw": 12.0,
                  "pole_R": (-0.9, 0.3, -0.4), "pole_L": (0.9, 0.2, -0.5)},
    },
    "serenade": {
        "hood": ((0.0, 0.02, 1.47), (0.19, 0.21, 0.23)),          # felt dome, top 1.70
        "hood_cone": ((0.02, 1.36, 0.198), (1.52, 0.182)),          # straight felt sides below the dome
        "hollow": ((0.0, -0.175, 1.44), (0.118, 0.17, 0.125)),    # opening x +-0.118, z 1.315-1.565
        "hood_light": ((0.0, -0.132, 1.436), (0.080, 0.016, 0.056)),
        "shoulder": 0.215,
        "cloak_rx": [(0.15, 0.425), (0.40, 0.410), (0.75, 0.385), (0.95, 0.37), (1.08, 0.35), (1.16, 0.28), (1.22, 0.20)],
        "cloak_ry": 0.74, "cloak_open": 0.13, "hem": (0.165, 0.0, 1),
        "folds": (0.020, 6.0, 0.35),                                # soft heavy felt folds (12 around)
        "tabard": (0.11, 1.03, 0.37, 0.43),
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
        return hem_line(self.z0, self.amp, self.n, P) - P[:, 2]


def hem_line(z0, amp, n, P):
    a = np.arctan2(P[:, 0], -P[:, 1])                          # 0 = front
    tri = 1.0 - np.abs(((a * n / math.pi) % 2.0) - 1.0)        # 0..1 sawtooth: shallow points
    return z0 + amp * tri


def _smooth_bell(F):
    """the cloak's bell without folds (a guide surface for the inlaid back stripe)"""
    tab = F["cloak_rx"]
    return bell(tab, F["cloak_ry"], tab[0][0] - 0.04, tab[-1][0])


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


def folds(amp, freq, wobble=0.5, phase=0.0):
    """vertical cloth folds around the Z axis: rounded crests, sharp valleys (|sin|); faded out near the axis
    (the bell's top and bottom caps: the angle is singular there and the creases met in non-manifold knots
    that stalled the decimation)"""
    def fn(P):
        a = np.arctan2(P[:, 0], -P[:, 1])
        u = a * freq + phase + wobble * NOISE(P, 3.0)
        r = np.hypot(P[:, 0], P[:, 1])
        return amp * smooth(0.10, 0.22, r) * (np.abs(np.sin(u)) * 2.0 - 1.0) * -0.5
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


# ── explicit low meshes (accent lamps and lenses: clean, smooth, never gem-cut) ───────────────────────────
def orient(V, F, outward):
    """flip triangles whose normal points against `outward` (a point inside, or a (3,) direction if
    `outward` is ('dir', d))"""
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    n = np.cross(b - a, c - a)
    if isinstance(outward, tuple) and outward and outward[0] == "dir":
        o = np.broadcast_to(np.asarray(outward[1], float), n.shape)
    else:
        o = (a + b + c) / 3.0 - np.asarray(outward, float)
    flip = (n * o).sum(1) < 0
    F = F.copy()
    F[flip] = F[flip][:, ::-1]
    return F


def lathe_mesh(c, axes, prof, nu, aspect=(1.0, 1.0)):
    """surface of revolution (triangles) about axes[2] through c: prof = [(z, s), ...] in order, s = 0 makes a
    pole; ring radius s * aspect along axes[0] / axes[1]"""
    c, ax = np.asarray(c, float), np.asarray(axes, float)
    V, rings = [], []
    for z, s in prof:
        if s <= 1e-7:
            rings.append([len(V)])
            V.append(c + ax[2] * z)
            continue
        idx = []
        for i in range(nu):
            a = 2 * math.pi * (i + 0.5) / nu
            idx.append(len(V))
            V.append(c + ax[0] * math.cos(a) * s * aspect[0] + ax[1] * math.sin(a) * s * aspect[1] + ax[2] * z)
        rings.append(idx)
    F = []
    for A, B in zip(rings[:-1], rings[1:]):
        if len(A) == 1:
            F += [(A[0], B[(i + 1) % nu], B[i]) for i in range(nu)]
        elif len(B) == 1:
            F += [(A[i], A[(i + 1) % nu], B[0]) for i in range(nu)]
        else:
            for i in range(nu):
                j = (i + 1) % nu
                F += [(A[i], A[j], B[j]), (A[i], B[j], B[i])]
    V = np.array(V)
    F = np.array(F, dtype=np.int64)
    zs = [z for z, _ in prof]
    mid = c + ax[2] * (0.5 * (min(zs) + max(zs)))
    return V, orient(V, F, mid)


def ellipsoid_mesh(c, r, nu=10, nv=6, axes=None):
    ax = np.eye(3) if axes is None else np.asarray(axes, float)
    prof = [(r[2] * math.cos(math.pi * j / nv), math.sin(math.pi * j / nv)) for j in range(nv, -1, -1)]
    return lathe_mesh(c, ax, prof, nu, aspect=(r[0], r[1]))


def merge_meshes(meshes):
    V, F, o = [], [], 0
    for v, f in meshes:
        V.append(v)
        F.append(f + o)
        o += len(v)
    return np.concatenate(V), np.concatenate(F)


def cap_patches(D, centers, normals, r, nseg=10, lift=0.0015):
    """round glazing caps that FOLLOW a curved surface (D): a centre + a ring of `nseg` points laid onto the
    surface along each normal, lifted `lift` (a flat card would stand off the curve and show edge-on)"""
    out = []
    for c, nn in zip(np.asarray(centers, float), np.asarray(normals, float)):
        nn = nn / np.linalg.norm(nn)
        fr = sdf.frame(nn)
        pts = [c] + [c + fr[0] * math.cos(2 * math.pi * i / nseg) * r + fr[1] * math.sin(2 * math.pi * i / nseg) * r
                     for i in range(nseg)]
        S, _ = onto_surface(D, np.array(pts), np.tile(nn, (len(pts), 1)), reach=0.03, lift=lift)
        F = np.array([(0, 1 + i, 1 + (i + 1) % nseg) for i in range(nseg)], dtype=np.int64)
        out.append((S, orient(S, F, ("dir", nn))))
    return merge_meshes(out)


def ribbon(pts, nrm, width, thick, sink=0.006):
    """a flat strip mesh (quads) along `pts` lying on the surface with normals `nrm`: width x (thick above,
    `sink` below the surface). Clean low geometry for the accent inlays (decimated SDF strips go ragged)."""
    pts, nrm = np.asarray(pts, float), np.asarray(nrm, float)
    n = len(pts)
    width = np.broadcast_to(np.asarray(width, float), (n,))
    tan = np.gradient(pts, axis=0)
    tan /= np.linalg.norm(tan, axis=1, keepdims=True)
    side = np.cross(tan, nrm)
    side /= np.linalg.norm(side, axis=1, keepdims=True)
    up = np.cross(side, tan)
    V = []
    for i in range(n):
        for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            V.append(pts[i] + side[i] * sx * width[i] / 2 + up[i] * (thick if sz > 0 else -sink))
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
        self.AO_INTO_BASE = 0.3
        # the pipeline paints the base colour through project.paint_object when PROJECTION is set; this id
        # routes it to `paint_procedural` (no concept plates are projected)
        self.PROJECTION = {"concept": f"wicks/brightwick_{faction}_bw", "height": 1.70}
        self.parts_info: dict = {}            # part -> (material role, (SDF grid, lo, voxel) or None)
        PAINT[self.PROJECTION["concept"]] = self
        SPECS[self.ID] = self

    # ── model ──
    def model(self, ctx) -> list:
        if self.faction == wc.LEGACY:
            return self.legacy_model(ctx)
        P = []
        self.parts_info = {}
        for name, S, vs, role, bind, tris, uvw in self.sculpts(ctx):
            if isinstance(S, tuple):                       # ("mesh", verts, faces): explicit low geometry
                ob = sdf.to_object(f"{name}_low", S[1], S[2], ctx.col)
                ob.data.materials.append(ctx.mats[role])
                self.parts_info[name] = (role, None)
                P.append(fighter.Part(name, low=ob, bind=bind, uv_weight=uvw))
                continue
            vox = VOXEL * vs
            D, lo = S.evaluate(vox)
            v, q = sdf.surface_nets(D, lo, vox)
            self.parts_info[name] = (role, (np.clip(D, -0.1, 0.1).astype(np.float32), np.asarray(lo, float), vox))
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
        staff_parts(self, F, aub, info, part)
        return out

    # ── clips ──
    def clip_overrides(self, ctx) -> dict:
        if self.faction == wc.LEGACY:
            return {}
        skel = anim.Skeleton(ctx.info.armature)
        return clips(self, skel, ctx)

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


# triangle budget per part (brief §1: brightwick <= 4.0k; the decimation lands a little under these). Explicit
# meshes (hood light, crown lamps/windows, boss lenses, lantern glass, seam, stripe) count their own triangles.
TRIS = {
    "aubade": {"hood": 400, "hood_rim": 130, "hood_in": 60, "crown": 230,
               "seam": 60, "cowl": 150, "pauldron_R": 170, "pauldron_L": 170, "cloak": 600, "back_stripe": 50,
               "belt": 50, "tabard": 70, "tabard_light": 90, "legs": 70, "boot_L": 90, "boot_R": 90, "sleeves": 200,
               "forearms": 150, "mitt_L": 100, "mitt_R": 100, "staff": 110, "staff_cap": 60, "lantern": 170,
               "lantern_light": 60},
    "serenade": {"hood": 350, "hood_rim": 130, "hood_in": 60, "crown": 160,
                 "collar": 130, "gorget": 110, "mantle": 210, "pauldron_R": 170, "pauldron_L": 170, "cloak": 600,
                 "tabard": 70, "tabard_light": 90, "legs": 70, "boot_L": 90, "boot_R": 90, "sleeves": 180,
                 "cuffs": 70, "forearms": 100, "mitt_L": 100, "mitt_R": 100, "staff": 110, "staff_cap": 50,
                 "lantern_collar": 60, "lantern": 160},
}
PAINT: dict = {}            # paint id -> spec (the procedural paint looks its spec up here)
SPECS: dict = {}            # build id -> spec (the ORM hook)


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
    # the lining: a dark shell set just inside the hollow, so the visible inside is flat ink
    lin = Sculpt("hood_in")
    lin.add(Ellipsoid(oc, tuple(r - 0.006 for r in orr)), k=0.0)
    lin.sub(Ellipsoid(oc, tuple(r - 0.030 for r in orr)), k=0.0)
    lin.inter(HalfSpace((0, oc[1] + 0.045, 0), (0, -1, 0), 2.0), k=0.0)
    part("hood_in", lin, "ink", "bone:head", 120, 0.8, 0.4)
    # the hood light: ONE soft volume, wider than tall, at mid-height of the hollow and set back behind the
    # opening (brief §0.2 / §4): a smooth explicit ellipsoid (the decimated SDF one went faceted)
    lc, lr = F["hood_light"]
    v, f = ellipsoid_mesh(lc, lr, nu=12, nv=6)
    part("hood_light", ("mesh", v, f), "accent", "bone:head", None, 0.6)
    if aub:
        crown_aubade(F, part, hood)
    else:
        crown_serenade(F, part)


def hood_radius(F, z):
    """(rx, ry) of the hood's outer surface at height z (the ellipsoid; the cone below for Serenade)."""
    hc, hr = F["hood"]
    q = max(0.0, 1.0 - ((z - hc[2]) / hr[2]) ** 2)
    return hr[0] * math.sqrt(q), hr[1] * math.sqrt(q)


FLAME = [(0.0, 0.0), (0.010, 0.0190), (0.026, 0.0180), (0.044, 0.0085), (0.060, 0.0)]   # a small flame drop


def crown_aubade(F, part, hood):
    """low chalk circlet with six short chalk points (<= 9 cm), each with a small chalk cup holding a flame drop
    (accent, smooth: small lamps on the points, never gems); the accent seam over the dome from the brow to the
    nape (the Aubade hood mark)"""
    hc, hr = F["hood"]
    zb = 1.606
    rx, ry = hood_radius(F, zb)
    rx, ry = rx + 0.014, ry + 0.014
    ring = Sculpt("crown")
    ring.add(Torus((0, hc[1], zb), rx, 0.017, axes=np.diag([1.0, rx / ry, 1.0]), rz=0.025), k=0.0)
    drops = []
    for i in range(6):
        a = math.radians(60 * i)
        sx, sy = math.sin(a), -math.cos(a)
        out = V3((sx, sy, 0.0))
        base = V3((sx * (rx + 0.002), hc[1] + sy * (ry + 0.002), zb + 0.016))
        # the point rises behind the lamp, leaning a little outward (chalk spire motif, short)
        pb = base - out * 0.004
        ring.add(RoundCone(pb, pb + out * 0.010 + V3((0, 0, 0.078)), 0.017, 0.0045), k=0.008)
        # the cup on the point's outer face, the flame drop standing in it
        cup = base + out * 0.020 + V3((0, 0, 0.006))
        ring.add(Ellipsoid(cup, (0.021, 0.021, 0.011)), k=0.008)
        drops.append(lathe_mesh(cup + V3((0, 0, 0.004)), np.eye(3), FLAME, 6))
    part("crown", ring, "chalk", "bone:head", 420, 0.55, 1.2)
    v, f = merge_meshes(drops)
    part("crown_lamps", ("mesh", v, f), "accent", "bone:head", None, 0.55)
    # the seam: a 5.6 cm inlaid strip on the meridian, brow -> crown -> nape, laid on the hood's real surface
    aa = np.radians(np.linspace(-60, 132, 14))
    P0 = np.stack([np.zeros_like(aa), hc[1] + hr[1] * np.sin(aa), hc[2] + hr[2] * np.cos(aa)], 1)
    N0 = np.stack([np.zeros_like(aa), np.sin(aa) / hr[1], np.cos(aa) / hr[2]], 1)
    S0, G0 = onto_surface(sdf_of(hood), P0, N0, reach=0.09)
    v, q = ribbon(S0, G0, 0.074, 0.007)
    part("seam", ("mesh", v, q), "accent", "bone:head", None, 0.6)


def crown_serenade(F, part):
    """a flush ironstone band 10 cm tall on the felt dome with round lampresin windows (accent glazing that follows
    the band's curve, so nothing stands proud of the band edge-on)"""
    hc, hr = F["hood"]
    zb = 1.592
    rx, ry = hood_radius(F, zb)
    band = Sculpt("crown")
    R0, hw, hh, rr = rx + 0.010, 0.014, 0.050, 0.010          # a rounded-rectangle band section, 10 cm tall

    def prof(r, z):
        qx, qz = np.abs(r - R0) - (hw - rr), np.abs(z) - (hh - rr)
        return np.hypot(np.maximum(qx, 0), np.maximum(qz, 0)) + np.minimum(np.maximum(qx, qz), 0) - rr
    band.add(Lathe((0, hc[1], zb), prof, R0 + hw + 0.01, -hh - 0.01, hh + 0.01, axes=np.diag([1.0, rx / ry, 1.0])), k=0.0)
    # twelve round windows (seven face the front)
    aa = np.radians(np.arange(12) * 30.0)
    P0 = np.stack([np.sin(aa) * (rx + 0.04), hc[1] - np.cos(aa) * (ry + 0.04), np.full(12, zb)], 1)
    N0 = np.stack([np.sin(aa) / rx, -np.cos(aa) / ry, np.zeros(12)], 1)
    D = sdf_of(band)
    S0, G0 = onto_surface(D, P0, N0, reach=0.06)
    v, f = cap_patches(D, S0, G0, 0.040, nseg=10, lift=0.0018)
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
        bind = ("dblend", f"shoulder.{s}", f"upper_arm.{s}", (sx * sh, 0.0, 1.30), (sx * 0.55, 0.0, -0.83), 0.06, 0.16)
        if aub:
            # three massive stepped chalk plates (8-10 cm thick, the widest point of the figure: 0.74 m across),
            # the top plate rising into two short upward points (<= 10 cm)
            pa.add(RoundBox((px, 0.0, 1.345), (0.125, 0.150, 0.046), 0.034, axes=sdf.rot_y(sx * 16)), k=0.0)
            pa.add(RoundBox((px + sx * 0.045, 0.0, 1.262), (0.112, 0.150, 0.044), 0.032, axes=sdf.rot_y(sx * 28)), k=0.010)
            pa.add(RoundBox((px + sx * 0.085, 0.0, 1.183), (0.088, 0.138, 0.040), 0.028, axes=sdf.rot_y(sx * 42)), k=0.010)
            pa.add(RoundCone((px + sx * 0.075, 0.005, 1.37), (px + sx * 0.105, 0.005, 1.47), 0.036, 0.007), k=0.012)
            pa.add(RoundCone((px - sx * 0.050, 0.015, 1.38), (px - sx * 0.058, 0.020, 1.465), 0.040, 0.008), k=0.014)
            part(f"pauldron_{s}", pa, "chalk", bind, 300, 0.7, 1.2)
            continue
        # rounded ironstone domes, a lip at the lower edge, a round boss at the front with a lampresin lens
        dome = Ellipsoid((px, 0.01, 1.245), (0.155, 0.172, 0.125), axes=sdf.rot_y(sx * 24))
        pa.add(dome, k=0.0)
        pa.inter(HalfSpace((px, 0, 1.145), (-sx * 0.42, 0, -0.91), 2.0), k=0.02)
        pa.add(Torus((px + sx * 0.035, 0.01, 1.165), 0.135, 0.016, axes=sdf.frame((-sx * 0.42, 0, 0.91)) @ np.diag([1, 1 / 1.12, 1]), rz=0.016), k=0.01)
        bn = V3((-sx * 0.45, -0.85, 0.20))           # the boss lens reads from the front and the side
        bn /= np.linalg.norm(bn)
        bc0 = V3((px - sx * 0.10, -0.135, 1.215))
        Sb, Gb = onto_surface(sdf_of(pa), bc0[None], bn[None], reach=0.08)
        bc, bn2 = Sb[0], Gb[0]
        pa.add(Torus(tuple(bc + bn2 * 0.004), 0.052, 0.014, axes=sdf.frame(bn2)), k=0.006)            # the boss ring
        part(f"pauldron_{s}", pa, "ironstone", bind, 280, 0.7, 1.2)
        v, f = lathe_mesh(bc + bn2 * 0.002, sdf.frame(bn2), [(0.0, 0.041), (0.011, 0.035), (0.019, 0.020), (0.023, 0.0)], 10)
        part(f"boss_light_{s}", ("mesh", v, f), "accent", bind, None, 0.6)
    # CLOAK: a SOLID bell (no inner shell: half the triangles of a shell for the same form), deep vertical folds,
    # open in front over the tabard: the opening is a recess down to the robe's surface
    tab = F["cloak_rx"]
    z0, z1 = tab[0][0], tab[-1][0]
    famp, ffreq, fwob = F["folds"]
    cl = Sculpt("cloak")
    cl.add(bell(tab, F["cloak_ry"], z0 - 0.04, z1).displaced(folds(famp, ffreq, fwob), famp), k=0.0)
    if not aub:
        # the upper ironstone hem band: a raised ring (the paint colours both bands)
        cl.add(bell([(0.26, 0.432), (0.34, 0.424)], F["cloak_ry"], 0.268, 0.332, inset=-0.008), k=0.006)
    hz0, hamp, hn = F["hem"]
    cl.inter(HemCut(hz0, hamp, hn, 0.8), k=0.006)
    op = F["cloak_open"]
    robe = bell(tab, F["cloak_ry"], 0.0, z1, inset=RECESS)          # the floor: RECESS in from the cloak
    cl.sub(sdf.Blend([("add", RoundBox((0, -0.45, 0.5), (op, 0.25, 0.62), 0.03), 0.0), ("sub", robe, 0.0)]), k=0.02)
    part("cloak", cl, "cloth", ("bw_cloak",), 900 if aub else 860, 1.0, 1.0)
    if aub:
        # the back stripe (accent) down the cloak's spine, below the cowl's V
        # laid on the SMOOTH bell just over the fold crests (on the folded surface its normal twisted with every
        # fold and the strip zigzagged), tapering toward the hem: most of its light sits in the top half
        zz = np.linspace(0.15, 1.17, 10)
        P0 = np.stack([np.zeros_like(zz), interp(tab, zz) * F["cloak_ry"], zz], 1)
        S0, G0 = onto_surface(_smooth_bell(F), P0,
                              np.tile((0.0, 1.0, 0.0), (len(zz), 1)), reach=0.06, lift=famp * 0.5)
        v, q = ribbon(S0, G0, np.interp(zz, [0.15, 0.85, 1.17], [0.030, 0.050, 0.080]), 0.007)
        part("back_stripe", ("mesh", v, q), "accent", ("bw_transfer", "cloak"), None, 0.7)
        # the chalk bandage belt wrapped over the robe and tabard
        belt = Sculpt("belt")
        rb = float(interp(tab, 0.965)) - RECESS + 0.004
        belt.add(Torus((0, 0.0, 0.965), rb, 0.03, axes=np.diag([1.0, 1.0 / F["cloak_ry"], 1.0]), rz=0.04).displaced(
            wraps((0, 0, 0.9), (0, 0, 1.03), 0.004, 0.03), 0.004), k=0.0)
        belt.inter(HalfSpace((0, -0.16, 0), (0, 1, 0), 2.0), k=0.01)            # only the front shows
        part("belt", belt, "cloth2", ("bw_transfer", "cloak"), 60, 0.8, 1.0)
    else:
        # the sash wraps on round the waist under the mantle's edge (accent: the back and sides read too)
        aa = np.radians(np.linspace(42.0, 318.0, 24))
        zs_ = 0.905
        rr_ = float(interp(tab, zs_))
        P0 = np.stack([np.sin(aa) * rr_, -np.cos(aa) * rr_ * F["cloak_ry"], np.full(len(aa), zs_)], 1)
        N0 = np.stack([np.sin(aa) / rr_, -np.cos(aa) / (rr_ * F["cloak_ry"]), np.zeros(len(aa))], 1)
        S0, G0 = onto_surface(_smooth_bell(F), P0, N0, reach=0.06, lift=famp * 0.5 + 0.002)
        v, q = ribbon(S0, G0, 0.056, 0.006)
        part("sash", ("mesh", v, q), "accent", ("bw_transfer", "cloak"), None, 0.7)
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
        # the two edge stripes taper toward the hem (4 cm at the belt, 2.6 cm at the chevron): the light leans up
        ins = 0.022
        path = [(-hw + ins, ztop - 0.04, 0.020), (-hw + ins, zv + 0.012, 0.013), (0.0, ztip + 0.034, 0.013),
                (hw - ins, zv + 0.012, 0.013), (hw - ins, ztop - 0.04, 0.020)]
        path = [((x, yf(z), z), r) for x, z, r in path]
        for i in range(len(path) - 1):
            acc.add(RoundCone(path[i][0], path[i + 1][0], path[i][1], path[i + 1][1]), k=0.003)
    else:
        for zc in (0.925, 0.992):
            acc.add(RoundBox((0, yf(zc) + 0.004, zc), (hw + 0.016, 0.010, 0.030), 0.007), k=0.0)
        for sx in (-1.0, 1.0):
            acc.add(Capsule((sx * (hw - 0.012), yf(zv + 0.03), zv + 0.03), (0.0, yf(ztip + 0.03), ztip + 0.03), 0.022), k=0.004)
    part("tabard_light", acc, "accent", ("bw_transfer", "cloak"), 140, 0.6)
    # LEGS (dark trousers, slim: they live under the bell) and BOOTS
    legs = Sculpt("legs")
    for s in ("L", "R"):
        hp, kn, an = info.side("hip", s), info.side("knee", s), info.side("ankle", s)
        legs.add(RoundCone(tuple(hp), tuple(kn), 0.062, 0.052), k=0.0)
        legs.add(RoundCone(tuple(kn), (an.x, an.y, an.z + 0.03), 0.052, 0.046), k=0.03)
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
    sl, wr, cf = Sculpt("sleeves"), Sculpt("forearms"), Sculpt("cuffs")
    for s in ("L", "R"):
        sh, el, w = (np.array(info.side(n, s)) for n in ("shoulder", "elbow", "wrist"))
        if aub:
            sl.add(RoundCone(tuple(sh), tuple(el), 0.075, 0.088), k=0.0)          # bell sleeve flaring at the elbow
            sl.add(RoundCone(tuple(el), tuple(el + (w - el) * 0.25), 0.088, 0.078), k=0.02)
            wr.add(RoundCone(tuple(el + (w - el) * 0.15), tuple(w), 0.066, 0.060).displaced(wraps(el, w), 0.004), k=0.0)
        else:
            sl.add(RoundCone(tuple(sh), tuple(el), 0.088, 0.100), k=0.0)          # puffy felt sleeve
            sl.add(RoundCone(tuple(el), tuple(el + (w - el) * 0.35), 0.100, 0.082), k=0.03)
            cf.add(Torus(tuple(el + (w - el) * 0.36), 0.074, 0.022, axes=sdf.frame(w - el)), k=0.0)   # ironstone cuff
            wr.add(RoundCone(tuple(el + (w - el) * 0.42), tuple(w), 0.066, 0.061).displaced(wraps(el, w, 0.005, 0.03), 0.005), k=0.0)
    part("sleeves", sl, "cloth", ("bw_auto", SLEEVE_EXCLUDE), 360, 1.0, 1.0)
    part("forearms", wr, "cloth2" if aub else "leather", ("bw_auto", SLEEVE_EXCLUDE), 300, 0.8, 1.0)
    if not aub:
        part("cuffs", cf, "ironstone", ("bw_auto", SLEEVE_EXCLUDE), 120, 0.8, 0.8)
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


def prop_rotation(info, pose) -> np.ndarray:
    """3x3 rotation that carries prop.R's rest frame to its frame in `pose` (armature space)"""
    skel = anim.Skeleton(info.armature)
    M = skel.fk(anim.resolve(skel, pose))
    return np.array(M["prop.R"].to_3x3()) @ np.array(skel.rest["prop.R"].to_3x3()).T


def staff_up_rest(spec, info) -> np.ndarray:
    """The rest-frame direction (perpendicular to the staff) that points UP while the wick holds the staff in
    the paint pose: the Aubade staff head bends that way so its lantern stands upright on the diagonal."""
    R = prop_rotation(info, paint_pose(spec))
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


def staff_parts(spec, F, aub, info, part):
    st = staff_frame(info)
    P, u, v, w = st["P"], st["u"], st["v"], st["w"]

    def at(s, dv=0.0, dw=0.0):
        return tuple(P + u * s + v * dv + w * dw)
    r = F["staff_r"]
    shaft = Sculpt("staff")
    if aub:
        up = staff_up_rest(spec, info)
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
        s0, s1, s2 = 0.900, 1.010, 1.135
        for cv, cw in [(1, 1), (1, -1), (-1, -1), (-1, 1)]:
            lan.add(Capsule(hat(s0, cv * 0.046, cw * 0.046), hat(s1, cv * 0.075, cw * 0.075), 0.0135), k=0.0)
            lan.add(Capsule(hat(s1, cv * 0.075, cw * 0.075), hat(s2, cv * 0.040, cw * 0.040), 0.0135), k=0.008)
        lan.add(RoundCone(hat(s2 - 0.01), hat(s2 + 0.06), 0.072, 0.022), k=0.012)                # pointed roof
        lan.add(RoundCone(hat(s2 + 0.05), hat(s2 + 0.19), 0.02, 0.004), k=0.01)                  # the spire
        lan.add(Sphere(hat(s2 + 0.085), 0.02), k=0.008)
        lan.add(Lathe(tuple(O), lambda rr, z: np.maximum(rr - 0.058, np.abs(z - (s0 - BEND_S)) - 0.012), 0.07,
                      s0 - BEND_S - 0.02, s0 - BEND_S + 0.02, axes=fr2), k=0.006)
        glass.add(RoundBox(hat(s1 - 0.003), (0.074, 0.074, 0.118), 0.040, axes=np.stack([v2, w2, u2])), k=0.0)
        glass.inter(RoundCone(hat(s0 - 0.01), hat(s2 + 0.02), 0.092, 0.060), k=0.01)
        part("lantern", lan, "chalk", "bone:prop.R", 360, 0.55, 0.6)
        part("lantern_light", glass, "accent", "bone:prop.R", 120, 0.6)
        return
    shaft.add(Capsule(at(-STAFF_BACK + 0.06), at(0.84), r).displaced(lambda Q: 0.004 * NOISE(Q, 10.0), 0.004), k=0.0)
    part("staff", shaft, "wood_dark", "bone:prop.R", 170, 0.7, 0.8)
    cap = Sculpt("staff_cap")
    lan = Sculpt("lantern")
    # the foot cap (ironstone), two collar rings, a round caged lampresin lantern, an iron cap + knob
    cap.add(Capsule(at(-STAFF_BACK + 0.0), at(-STAFF_BACK + 0.07), r * 1.55), k=0.0)
    cap.add(Capsule(at(-STAFF_BACK - 0.02), at(-STAFF_BACK + 0.0), r * 1.2), k=0.01)
    part("staff_cap", cap, "ironstone", "bone:prop.R", 80, 0.7, 0.5)
    col = Sculpt("lantern_collar")
    for s_, rr in ((0.78, 0.040), (0.835, 0.046)):
        col.add(Capsule(at(s_ - 0.016), at(s_ + 0.016), rr), k=0.004)
    part("lantern_collar", col, "ironstone", "bone:prop.R", 120, 0.6, 0.5)
    c = 0.975
    R = 0.120
    # the cage reads as a "+" in the guard pose (as on the sheet): one band in the world's vertical plane through
    # the view axis, one horizontal; both in prop.R's rest frame
    Rg = prop_rotation(info, guard_pose())
    nA, nB = Rg.T @ np.array((1.0, 0.0, 0.0)), Rg.T @ np.array((0.0, 0.0, 1.0))
    lan.add(Torus(at(c), R, 0.0115, axes=sdf.frame(nA)), k=0.0)
    lan.add(Torus(at(c), R, 0.0115, axes=sdf.frame(nB)), k=0.006)
    lan.add(Capsule(at(c - R - 0.03), at(c - R + 0.012), 0.042), k=0.01)    # throat into the collar
    lan.add(Capsule(at(c + R - 0.008), at(c + R + 0.05), 0.040), k=0.01)    # iron cap
    lan.add(Sphere(at(c + R + 0.078), 0.031), k=0.012)                      # knob
    part("lantern", lan, "ironstone", "bone:prop.R", 380, 0.6, 0.6)
    # the lampresin ball (accent), a smooth sphere just inside the bands so the cage stands proud
    v_, f_ = ellipsoid_mesh(at(c), (R - 0.006,) * 3, nu=12, nv=8)
    part("lantern_light", ("mesh", v_, f_), "accent", "bone:prop.R", None, 0.7)


# ── paint: the base colour painted from the sculpt ───────────────────────────────────────────────────
# part colours beyond the role palette (the concepts' colour placement)
PART_HEX = {
    "aubade": {"cowl": "#A5B1BD", "forearms": "#CCC8BD", "belt": "#CCC8BD", "tabard": "#D6D3CA",
               "mitt_L": "#6E7A86", "mitt_R": "#6E7A86", "hood_in": "#15171B"},
    "serenade": {"hood_rim": "#5A4436", "collar": "#584437", "forearms": "#45362C", "hood_in": "#17150F"},
}
CLOTH_ROLES = ("cloth", "cloth2", "under")
ROUGH = {"cloth": 0.93, "cloth2": 0.92, "under": 0.92, "chalk": 0.86, "stone": 0.82, "ironstone": 0.80,
         "leather": 0.66, "wood": 0.76, "wood_dark": 0.74, "ink": 0.95}
RAMP = {   # value (linear multiplier) by height: light top, dark feet (bible §2.4)
    "aubade": [(0.0, 0.50), (0.20, 0.58), (0.45, 0.76), (0.80, 0.93), (1.05, 1.0), (1.28, 1.10), (1.80, 1.16)],
    "serenade": [(0.0, 0.62), (0.20, 0.72), (0.45, 0.85), (0.80, 0.95), (1.05, 1.0), (1.30, 1.12), (1.80, 1.18)],
}
SHADOW_TINT = {"aubade": (-0.10, -0.03, 0.14), "serenade": (0.10, -0.02, -0.14)}
KEY = np.array((-0.35, -0.60, 0.72)) / np.linalg.norm((-0.35, -0.60, 0.72))   # painted key: front, upper right


def lin(h) -> np.ndarray:
    return project._lin(np.asarray(scene.hex_srgb(h), dtype=np.float32))


def smooth(a, b, x):
    t = np.clip((np.asarray(x, float) - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def mix(col, h, m):
    m = np.asarray(m, float)[:, None]
    return col * (1 - m) + lin(h)[None] * m


def grid_sampler(grid):
    """trilinear sampler of a part's SDF grid (clipped to +-0.1)"""
    D, lo, vox = grid
    n = np.array(D.shape)

    def f(Q):
        u = (Q - lo) / vox
        i = np.clip(np.floor(u).astype(np.int64), 0, n - 2)
        t = np.clip(u - i, 0.0, 1.0)
        x, y, z = i[:, 0], i[:, 1], i[:, 2]
        tx, ty, tz = t[:, 0], t[:, 1], t[:, 2]
        c00 = D[x, y, z] * (1 - tx) + D[x + 1, y, z] * tx
        c10 = D[x, y + 1, z] * (1 - tx) + D[x + 1, y + 1, z] * tx
        c01 = D[x, y, z + 1] * (1 - tx) + D[x + 1, y, z + 1] * tx
        c11 = D[x, y + 1, z + 1] * (1 - tx) + D[x + 1, y + 1, z + 1] * tx
        return (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz
    return f


def surface_fields(grid, P, N):
    """per texel: the point on the sculpt's surface, its normal, the SDF Laplacian (fold crests > 0, valleys < 0)
    and an SDF occlusion (0 open .. 1 deep in a fold)"""
    f = grid_sampler(grid)
    vox = grid[2]
    E = np.eye(3)

    def grad(Q, e):
        return np.stack([f(Q + E[i] * e) - f(Q - E[i] * e) for i in range(3)], 1) / (2 * e)
    p = P.copy()
    for _ in range(5):
        d = f(p)
        g = grad(p, vox)
        step = np.clip(d / ((g * g).sum(1) + 1e-6), -0.03, 0.03)
        p = p - g * step[:, None]
    g = grad(p, vox)
    gl = np.linalg.norm(g, axis=1)
    bad = (np.abs(f(p)) > 0.012) | (gl < 0.3) | ~np.isfinite(gl)
    g = g / np.maximum(gl, 1e-6)[:, None]
    p[bad], g[bad] = P[bad], N[bad]
    h = 1.6 * vox
    lap = (sum(f(p + E[i] * h) + f(p - E[i] * h) for i in range(3)) - 6 * f(p)) / (h * h)
    occ = np.zeros(len(p))
    for hh, w in ((0.010, 0.45), (0.022, 0.35), (0.045, 0.20)):
        occ += w * np.clip((hh - f(p + g * hh)) / hh, 0.0, 1.0)
    lap[bad] = 0.0
    occ[bad] = 0.0
    return p, g, lap, occ


# region painters (linear colour in, linear colour out)
def _cloak_aubade(spec, p, g, col):
    F = spec.F
    hz0, hamp, hn = F["hem"]
    hem = hem_line(hz0, hamp, hn, p)
    col = _robe_floor(spec, p, col, "#C3C8CB", "#56616C", low="#7D8893")
    # the 6.5 cm ironstone hem band follows the pointed hem (bible §2.4: dark feet)
    band = 1.0 - smooth(hem + 0.060, hem + 0.068, p[:, 2])
    return mix(col, "#3E434A", band)


def _cloak_serenade(spec, p, g, col):
    col = _robe_floor(spec, p, col, "#9A7A5B", "#5E4A3D", low="#6A5444")
    z = p[:, 2]
    b1 = smooth(0.176, 0.181, z) * (1 - smooth(0.212, 0.217, z))
    b2 = smooth(0.266, 0.271, z) * (1 - smooth(0.330, 0.335, z))
    return mix(col, "#4B4039", np.maximum(b1, b2))


def _robe_floor(spec, p, col, robe, lining, low=None):
    """the front opening: the robe floor (RECESS in) and the cloak's inner edge walls (the lining); the robe
    darkens toward the hem (`low`) so the feet stay in the bible's dark band"""
    F = spec.F
    tab = F["cloak_rx"]
    R = np.interp(p[:, 2], [t[0] for t in tab], [t[1] for t in tab])
    re = np.sqrt(p[:, 0] ** 2 + (p[:, 1] / F["cloak_ry"]) ** 2)
    front = (p[:, 1] < 0) & (np.abs(p[:, 0]) < F["cloak_open"] + 0.05)
    depth = np.clip((R - re) / RECESS, 0.0, 1.5) * front
    col = mix(col, lining, smooth(0.25, 0.45, depth))
    m = smooth(0.70, 0.88, depth)
    col = mix(col, robe, m)
    if low is not None:
        col = mix(col, low, m * (1 - smooth(0.25, 0.65, p[:, 2])))
    return col


def _pauldron_serenade(spec, p, g, col, sx):
    """two ochre sandstone bands running down the shoulder slope (the sheet's stripes)"""
    px = spec.F["pauldron_x"] * sx
    c = np.array((px, 0.01, 1.245))
    nrm = np.array((sx * 0.50, 0.0, 0.866))
    s = (p - c) @ nrm
    b1 = smooth(0.012, 0.016, s) * (1 - smooth(0.046, 0.050, s))
    b2 = smooth(-0.050, -0.046, s) * (1 - smooth(-0.020, -0.016, s))
    # the round boss and its ring stay iron; the lower lip too
    lip = smooth(1.18, 1.17, p[:, 2])
    m = np.maximum(b1, b2) * (1 - lip)
    return mix(col, "#C3A47A", m)


def _grain(spec, p, g, col, k=0.12):
    """wood grain along the staff (rest frame: the staff runs along -Y from the right fist)"""
    n = PNOISE(p * np.array((22.0, 1.4, 22.0)), 1.0) + 0.5 * PNOISE(p * np.array((60.0, 3.0, 60.0)), 1.0, (3.1, 0, 0))
    return col * (1 + k * n)[:, None]


def _gorget(spec, p, g, col):
    cr = np.clip(NOISE.ridged(p, 11.0, 2), 0, 1)
    return col * (1 - 0.35 * smooth(0.55, 0.85, cr))[:, None]


REGIONS = {
    "aubade": {"cloak": _cloak_aubade, "staff": _grain},
    "serenade": {"cloak": _cloak_serenade, "staff": _grain, "gorget": _gorget,
                 "pauldron_R": lambda s, p, g, c: _pauldron_serenade(s, p, g, c, -1.0),
                 "pauldron_L": lambda s, p, g, c: _pauldron_serenade(s, p, g, c, 1.0)},
}


def paint_part(spec, name, role, p, g, lap, occ) -> np.ndarray:
    fac = spec.faction
    col = np.tile(lin(PART_HEX[fac].get(name) or spec.PALETTE.get(role, "#808080")), (len(p), 1))
    fn = REGIONS[fac].get(name)
    if fn is not None:
        col = fn(spec, p, g, col)
    if role == "ink":
        return col
    cloth = role in CLOTH_ROLES
    crest = np.clip(lap / 40.0, -1.0, 1.0)
    shade = 1.0 - (0.55 if cloth else 0.36) * occ
    shade *= 1.0 + (0.16 if cloth else 0.18) * crest
    shade *= 0.80 + 0.28 * (0.5 + 0.5 * g[:, 2])                         # soft sky light (painted)
    shade *= 1.0 + 0.07 * np.clip(g @ KEY, -1.0, 1.0)                    # the painted key
    shade *= np.interp(p[:, 2], *zip(*RAMP[fac]))                        # light top, dark feet
    nz = 0.030 * PNOISE(p, 7.0) + 0.016 * PNOISE(p, 23.0, (1.7, 0.3, 0.9))
    if fac == "serenade" and cloth:
        nz = nz + 0.022 * PNOISE(p, 140.0, (0.4, 2.2, 1.3))              # felt grain
    shade *= 1.0 + nz
    t = np.asarray(SHADOW_TINT[fac])
    dark = np.clip(1.0 - shade, 0.0, 0.6)[:, None]
    col = col * (1.0 + dark * t[None])
    return col * shade[:, None]


def paint_procedural(spec, obj, size, names, part_attr="vale_part", log=print):
    maps = project.rasterize(obj, size, part_attr)
    P, N, part = maps["P"].astype(np.float64), maps["N"].astype(np.float64), maps["part"]
    mw = np.array(obj.matrix_world)
    if not np.allclose(mw, np.eye(4), atol=1e-6):
        P = P @ mw[:3, :3].T + mw[:3, 3]
        N = N @ np.linalg.inv(mw[:3, :3])
    out = np.zeros((size, size, 3), dtype=np.float32)
    for k in np.unique(part[part >= 0]):
        name = names[int(k)]
        role, grid = spec.parts_info.get(name, ("cloth", None))
        sel = part == k
        p, n = P[sel], N[sel]
        if grid is not None:
            p, g, lap, occ = surface_fields(grid, p, n)
        else:
            g, lap, occ = n, np.zeros(len(p)), np.zeros(len(p))
        out[sel] = paint_part(spec, name, role, p, g, lap, occ)
    iy, ix = project.nearest_index(part >= 0)
    out = out[iy, ix]
    log(f"brightwick: painted from the sculpt ({len(np.unique(part[part >= 0]))} parts)")
    return project._srgb(out).astype(np.float32), maps


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
    """the concept's hold (the fit check, the Aubade staff-head bend): absolute right wrist, staff dir"""
    pp = spec.F["paint"]
    p = anim.merge(anim.arms_relaxed(), {"ik": {
        "hand.R": HandTarget(pos=tuple(pp["wrist_R"]), pole=tuple(pp["pole_R"])),
        "aim.R": Aim(tuple(pp["staff"])),
        "hand.L": HandTarget(to_prop=("prop.R", GRIP_L), pole=tuple(pp["pole_L"]))}})
    return p


def attack_poses() -> tuple:
    """the slam's blocked poses (wind, hit, follow): the staff swings up over the hood, then the lantern comes
    down IN FRONT, the staff ~35 deg below level reaching for a target 1.8 m out, the hood still facing it"""
    wind = anim.merge(anim.P(hips=(-5, 6, 0), spine=(-7, 8, 0), chest=(-9, 8, 0), neck=(5, -5, 0), head=(7, -7, 0)),
                      {"hips_loc": (0.0, 0.035, -0.02), "ik": stance_feet()},
                      hold((0.18, -0.42, -0.42), (0.18, 0.34, 0.92), pole_r=(-0.9, 0.2, -0.4), pole_l=(0.9, 0.1, -0.2),
                           grip=0.50))
    hit = anim.merge(anim.P(hips=(12, -6, 0), spine=(9, -6, 0), chest=(7, -6, 0), neck=(-9, 4, 0), head=(-13, 5, 0)),
                     {"hips_loc": (0.0, -0.07, -0.075)},
                     hold((0.30, -0.80, -0.30), (0.20, -0.82, -0.54), pole_r=(-0.8, 0.3, -0.5), pole_l=(0.9, 0.3, -0.4),
                          grip=0.42))
    hit["ik"].update(anim.feet(l=(0.03, -0.14, 0.0), r=(-0.03, 0.05, 0.0), yl=6, yr=-8))
    fol = anim.merge(hit, anim.P(hips=(14, -6, 0), spine=(10, -6, 0), chest=(8, -6, 0)),
                     {"hips_loc": (0.0, -0.08, -0.085)},
                     hold((0.30, -0.80, -0.36), (0.20, -0.80, -0.58), pole_r=(-0.8, 0.3, -0.5), pole_l=(0.9, 0.3, -0.4),
                          grip=0.42))
    return wind, hit, fol


def clips(spec, skel, ctx=None) -> dict:
    out = {}
    g = guard_pose()

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

    # RUN: a heavy rolling stride at 3.3 m/s under the bell (planted foot exact), the staff steady on the diagonal
    out["run"] = run_clip(spec, skel, g)

    # ATTACK1 (30 f, impact at 40 % = 0.4 s windup): the staff swings up over the hood, then the lantern slams
    # down in front (forward of the boots, toward a target 1.8 m out), then recovers to the diagonal
    wind, hit, fol = attack_poses()
    keys = anim.strike_keys(spec.MOTION, anim.merge(g, wind), anim.merge(g, hit), anim.merge(g, fol), guard_pose=g)
    over = (0.30, -0.30, 0.90)                     # the lantern goes over the top, not round the side
    keys = [(t, _with_aim(p, over) if abs(t - 0.34) < 1e-6 else p, e) for t, p, e in keys]
    fn = anim.keyed(keys)
    out["attack1"] = anim.Clip("attack1", 30, False, anim.drag(fn, 30, {"head": 1.5, "neck": 1.0}), impact=anim.IMPACT)
    objs = []
    if ctx is not None:
        objs = [o for o in (bpy.data.objects.get(spec.ID), bpy.data.objects.get(f"{spec.ID}_accent")) if o is not None]
        # the lantern lands ON the ground at the impact, never through it (the staff turns up about the fists)
        out["attack1"] = ground_solve(out["attack1"], ctx.info.armature, objs, body=False)

    # DEATH (60 f): recoil -> sinks onto the right knee, leaning on the staff planted foot-down beside it (lantern
    # up) -> holds -> slides sideways off the staff into a curled heap, the staff and its lantern on the ground
    # beside it; ground-solved on the skinned mesh (nothing below z 0)
    death = death_clip(spec, skel, g)
    if objs:
        death = ground_solve(death, ctx.info.armature, objs)
    out["death"] = death
    # the rest of the required set (CONTRACT §12) the renderer never plays for a minion: short stand-ins
    # (the strike reused at 10 frames, the run, a breathing loop) instead of ~50 KB of GLB for unused clips
    for name in ("attack2", "cast_a1", "cast_a2", "cast_a3", "cast_ult"):
        out[name] = anim.Clip(name, 10, False, out["attack1"].sample, impact=anim.IMPACT)
    for name in ("recall", "idle_lobby", "channel", "stunned", "victory"):
        out[name] = anim.Clip(name, 30, True, lambda t: anim.add(g, anim.P(chest=(1.2 * anim.osc(t, 1), 0, 0))))
    out["dash"] = anim.Clip("dash", 16, False, out["run"].sample)
    return out


def _with_aim(pose: dict, d) -> dict:
    p = dict(pose)
    p["ik"] = dict(p.get("ik", {}))
    p["ik"]["aim.R"] = Aim(tuple(d))
    return p


RUN_FRAMES, RUN_CONTACT = 14, 0.34      # 0.47 s cycle: a 0.52 m stride stays under the hem


def run_clip(spec, skel, g) -> anim.Clip:
    prof = spec.MOTION
    v = prof["run_ref_speed"]
    leg = spec.PROPORTIONS["leg"]
    ks = leg / 0.86 * 0.80                                     # gen_run's swing (0.86 m leg), kept low under the bell
    c = RUN_CONTACT
    N = RUN_FRAMES
    T = N / anim.FPS
    Ls = v * c * T
    swing = [(0.00, Ls / 2, 0.0, -20.0), (0.18, Ls / 2 + 0.04 * ks, 0.13 * ks, -36.0), (0.42, 0.04 * ks, 0.20 * ks, -22.0),
             (0.66, -Ls / 2 - 0.04 * ks, 0.13 * ks, -4.0), (0.86, -Ls / 2 - 0.015 * ks, 0.05 * ks, 7.0), (1.00, -Ls / 2, 0.0, 6.0)]

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
            pitch = 6.0 * (1 - anim.sine(min(1.0, uu / 0.25))) - 20.0 * max(0.0, (uu - 0.62) / 0.38) ** 1.6
            return (0.0, y, 0.0), pitch
        dy, dz, pitch = swing_at((q - c) / (1 - c))
        return (0.0, dy, dz), pitch

    # heavy: a deep double bob (the weight drops on each contact), a rolling side-to-side sway, a forward lean
    bob, drop, lean = 0.034, 0.05, 11.0

    def sample(t):
        q = t % 1.0
        fl, pl = foot_at(q)
        fr, pr = foot_at(q + 0.5)
        z = -drop - bob * math.cos(2 * math.pi * (2 * q - c)) * 0.5 - bob * 0.5
        x = 0.022 * math.cos(2 * math.pi * (q - c / 2))
        yaw = -7.0 * math.cos(2 * math.pi * q)
        roll = 6.0 * math.sin(2 * math.pi * (q - c / 2))
        p = anim.merge(anim.arms_relaxed(), anim.P(
            hips=(lean * 0.5, yaw, roll), spine=(lean * 0.3, -yaw * 0.5, -roll * 0.6),
            chest=(lean * 0.2 + 2.0 * math.cos(4 * math.pi * q), -yaw * 0.4, -roll * 0.3),
            neck=(-lean * 0.5, 0, 0), head=(-lean * 0.45, 0, -roll * 0.3)))
        bz = 0.018 * math.cos(4 * math.pi * (q - 0.08))
        p = anim.merge(p, hold((GUARD_R[0], GUARD_R[1] - 0.04, GUARD_R[2] + bz), (0.72, -0.20, 0.66)))
        p["ik"]["foot.L"] = FootTarget((0.012 + fl[0], fl[1] - 0.02, fl[2]), pl, -3, 0, 0)
        p["ik"]["foot.R"] = FootTarget((-0.012 + fr[0], fr[1] - 0.02, fr[2]), pr, 3, 0, 0)
        p["hips_loc"] = (x, 0.02, z)
        return p
    return anim.Clip("run", N, True, sample, meta={"run_ref_speed": v, "stride_m": round(v * T / 2, 3),
                                                     "cycle_s": round(T, 3)})


def death_clip(spec, skel, g) -> anim.Clip:
    N = 60
    hip_h = skel.rest_point("hips").z
    fk_arms = anim.arms_relaxed()
    recoil = anim.merge(g, anim.P(hips=(-6, 0, 4), spine=(-8, 0, 0), chest=(-12, 4, 0), neck=(-8, 0, 0), head=(-12, 0, 0)),
                        {"hips_loc": (0.0, 0.05, -0.02)})
    # down on the right knee inside the bell, leaning right onto the staff planted foot-down beside the right
    # boot, the lantern up by the hood (the light stays high and visible)
    kneel = anim.merge(fk_arms, anim.P(hips=(8, 0, 6), spine=(8, 0, 4), chest=(6, 0, 2), neck=(4, 0, 0), head=(12, 0, -4),
                                       thigh_R=(18, 0, 4), shin_R=(-100, 0, 0), foot_R=(-10, 0, 0),
                                       thigh_L=(78, 0, -4), shin_L=(-80, 0, 0), foot_L=(0, 0, 0)),
                       {"ik": {"hand.R": HandTarget(rel=(-0.10, -0.30, -0.95), pole=(-0.9, 0.2, -0.3)),
                               "aim.R": Aim((0.10, -0.22, 0.97)),
                               "hand.L": HandTarget(to_prop=("prop.R", 0.62), pole=(0.9, 0.2, -0.5))}})
    kneel["hips_loc"] = (-0.02, 0.0, -hip_h * 0.30)
    sag = anim.add(kneel, anim.P(spine=(5, 0, 2), chest=(5, 0, 0), head=(8, 0, 0)))
    sag["hips_loc"] = (-0.02, 0.0, -hip_h * 0.32)
    # the slide: off the staff, sideways and forward to its left, into a kneeling heap: the knees stay under it
    # (the bell folds at the hips, never a rigid slab on the ground), the torso and hood come down onto the
    # ground ahead-left, the staff slips out ahead-right and lies on the ground with its lantern still lit
    down = anim.merge(fk_arms, anim.P(hips=(52, 10, -22), spine=(16, 0, -6), chest=(14, 0, -4), neck=(6, 0, 4),
                                      head=(10, 0, 10),
                                      thigh_R=(70, 0, 6), shin_R=(-112, 0, 0), foot_R=(-30, 0, 0),
                                      thigh_L=(78, 0, -4), shin_L=(-108, 0, 0), foot_L=(-30, 0, 0),
                                      upper_arm_L=(64, 0, -6), forearm_L=(24, 0, 0)))
    down["hips_loc"] = (0.10, -0.10, -hip_h * 0.5)
    down["ik"] = {"hand.R": HandTarget(rel=(-0.10, -0.95, -0.05), pole=(-0.8, 0.2, -0.6)),
                  "aim.R": Aim((-0.42, -0.90, -0.10))}
    bounce = anim.add(down, anim.P(hips=(-4, 0, 3), spine=(-3, 0, 0), head=(-5, 0, 0)))
    rest = anim.add(down, anim.P(head=(3, 0, 3), hips=(2, 0, 0)))
    keys = [(0.0, g, "linear"), (0.12, recoil, "snap"), (0.34, kneel, "inout"), (0.52, sag, "inout"),
            (0.78, down, "in"), (0.85, bounce, "out"), (0.93, rest, "inout"), (1.0, rest, "linear")]
    return anim.Clip("death", N, False, anim.keyed(keys), meta={"settle": 0.80})


def ground_solve(clip: anim.Clip, arm, objs, exclude=("prop.R",), floor=0.0, log=print, body=True) -> anim.Clip:
    """Sample `clip`, pose the SKINNED mesh frame by frame and move the hips vertically so the lowest vertex of the
    body (not the held prop) touches `floor`: no foot, knee or cloak below the ground in any frame, no float.
    Logs the held prop's lowest point per frame (authored to stay above the ground)."""
    skel = anim.Skeleton(arm)
    N = clip.frames
    poses = [anim.resolve(skel, clip.sample(f / N)) for f in range(N + 1)]
    masks = []
    for o in objs:
        names = [gr.name for gr in o.vertex_groups]
        keep = np.ones(len(o.data.vertices), dtype=bool)
        for v in o.data.vertices:
            if v.groups:
                gmax = max(v.groups, key=lambda gg: gg.weight)
                keep[v.index] = names[gmax.group] not in exclude
        masks.append(keep)

    def lows(pose):
        anim.apply_pose(arm, pose)
        dg = bpy.context.evaluated_depsgraph_get()
        zb, zp = [], []
        for o, m in zip(objs, masks):
            e = o.evaluated_get(dg)
            me = e.to_mesh()
            co = np.empty(len(me.vertices) * 3)
            me.vertices.foreach_get("co", co)
            co = co.reshape(-1, 3) @ np.array(e.matrix_world)[:3, :3].T + np.array(e.matrix_world)[:3, 3]
            e.to_mesh_clear()
            if m.any():
                zb.append(co[m, 2].min())
            if (~m).any():
                zp.append(co[~m, 2].min())
        return min(zb), (min(zp) if zp else 0.0)
    dz = np.array([floor - lows(p)[0] for p in poses]) if body else np.zeros(len(poses))
    sm = np.convolve(np.pad(dz, 1, mode="edge"), [0.25, 0.5, 0.25], "valid")
    dz = np.maximum(sm, dz)                       # smoothed, never below the ground
    out = []
    for pose, d in zip(poses, dz):
        q = dict(pose)
        hx, hy, hz = q.get("hips_loc", (0.0, 0.0, 0.0))
        q["hips_loc"] = (hx, hy, hz + float(d))
        out.append(q)
    settle = (clip.meta or {}).get("settle")
    settle_prop(skel, out, objs, int(round(settle * N)) if settle is not None else 10 * N, floor, log)
    check = [lows(p) for p in out]
    anim.apply_pose(arm, {})
    body_min = min(c[0] for c in check)
    prop_min = [round(c[1], 3) for c in check]
    log(f"[brightwick] {clip.name} ground solve: hips dz {dz.min():+.3f}..{dz.max():+.3f} m, body min z "
        f"{body_min:+.3f}, prop min z {min(prop_min):+.3f} (frames {[i for i, z in enumerate(prop_min) if z < -0.01]})")

    def sample(t):
        u = min(max(t, 0.0), 1.0) * N
        i = int(math.floor(u))
        if i >= N:
            return out[N]
        f = u - i
        return out[i] if f < 1e-6 else anim.lerp_pose(out[i], out[i + 1], f)
    meta = dict(clip.meta or {})
    meta["ground"] = {"body_min_z": round(float(body_min), 3), "prop_min_z": float(min(prop_min))}
    return anim.Clip(clip.name, N, clip.loop, sample, impact=clip.impact, meta=meta)


def settle_prop(skel, poses, objs, f_rest, floor=0.0, log=print, bone="prop.R"):
    """The held staff, rigid on prop.R, turned about the fist (a horizontal axis across the staff) so that its
    lowest vertex never goes below `floor` in any frame, and from frame `f_rest` on rests ON the floor (the
    dropped staff lies on the ground, its lantern visible). Ramped in over 6 frames; edits poses in place."""
    from mathutils import Matrix
    pts = []
    for o in objs:
        names = [gr.name for gr in o.vertex_groups]
        mw = np.array(o.matrix_world)
        for v in o.data.vertices:
            if v.groups and names[max(v.groups, key=lambda gg: gg.weight).group] == bone:
                pts.append(mw[:3, :3] @ np.array(v.co) + mw[:3, 3])
    if not pts:
        return
    R0 = np.array(skel.rest[bone].to_3x3())
    t0 = np.array(skel.rest[bone].translation)
    loc = (np.array(pts) - t0) @ R0                       # prop-local coordinates
    ths = np.radians(np.arange(-70.0, 70.5, 0.5))
    lift, rest = [], []
    for pose in poses:
        M = skel.fk(pose)
        R = np.array(M[bone].to_3x3())
        t = np.array(M[bone].translation)
        W = loc @ R.T
        k = np.cross(R[:, 1], (0.0, 0.0, 1.0))
        k = k / (np.linalg.norm(k) + 1e-9)
        mz = np.array([(W @ rodrigues(k, a).T)[:, 2].min() + t[2] for a in ths])
        ok = mz >= floor - 1e-4
        lift.append(0.0 if mz[len(ths) // 2] >= floor else (ths[ok][np.argmin(np.abs(ths[ok]))] if ok.any() else 0.0))
        near = ok & (mz <= floor + 0.012)
        rest.append(ths[near][np.argmin(np.abs(ths[near]))] if near.any() else lift[-1])
    th = []
    for f in range(len(poses)):
        w = float(np.clip((f - (f_rest - 6)) / 6.0, 0.0, 1.0))
        th.append(lift[f] * (1 - w) + rest[f] * w)
    for f, pose in enumerate(poses):
        if abs(th[f]) < 1e-6:
            continue
        M = skel.fk(pose)
        R = np.array(M[bone].to_3x3())
        k = np.cross(R[:, 1], (0.0, 0.0, 1.0))
        k = k / (np.linalg.norm(k) + 1e-9)
        Rn = rodrigues(k, th[f]) @ R
        base = M[skel.parent[bone]] @ skel.local[bone]
        B = np.array(base.to_3x3()).T @ Rn
        e = Matrix([list(r) for r in B]).to_euler("XYZ")
        pose[bone] = tuple(math.degrees(a) for a in e)
    log(f"[brightwick] staff settle: turned {min(th) * 57.3:+.0f}..{max(th) * 57.3:+.0f} deg, rests from frame {f_rest}")


# ── pipeline hooks (this module's builds only) ────────────────────────────────────────────────────────
_orig_paint_object = project.paint_object


def _paint_object(obj, size, cfg, names, part_attr="vale_part", log=print, return_maps=False):
    spec = PAINT.get(cfg.get("concept"))
    if spec is None:
        return _orig_paint_object(obj, size, cfg, names, part_attr=part_attr, log=log, return_maps=return_maps)
    img, maps = paint_procedural(spec, obj, size, names, part_attr=part_attr, log=log)
    spec.paint_maps = (maps, list(names))
    return (img, maps) if return_maps else img


project.paint_object = _paint_object
_orig_bind_part = pipeline.bind_part


def bind_cloak(obj, arm, th_max=0.5):
    """the bell rides the hips (spine, chest above the waist); the lower cloak follows the AVERAGE of the two
    thighs (both sides alike, up to th_max at the hem): in the run the thighs swing opposite ways, so the hem
    neither shears into a parallelogram nor tears open between the legs; when both thighs flex (kneeling, the
    curled death) the bell folds at the hips instead of lying as a rigid slab"""
    obj.vertex_groups.clear()
    G = {n: obj.vertex_groups.new(name=n) for n in ("hips", "spine", "chest", "thigh.L", "thigh.R")}
    co = np.array([obj.matrix_world @ v.co for v in obj.data.vertices])
    z = co[:, 2]
    up1 = smooth(0.92, 1.10, z)
    up2 = smooth(1.10, 1.26, z)
    th = th_max * (1.0 - smooth(0.15, 0.70, z))
    sl = np.full(len(z), 0.5)
    rest = 1.0 - th
    W = {"hips": rest * (1 - up1), "spine": rest * up1 * (1 - up2), "chest": rest * up1 * up2,
         "thigh.L": th * sl, "thigh.R": th * (1 - sl)}
    for n, w in W.items():
        for i in np.nonzero(w > 1e-3)[0]:
            G[n].add([int(i)], float(w[i]), "REPLACE")
    mesh.add_armature_modifier(obj, arm)
    mesh.parent_keep(obj, arm)


def _bind_part(ctx, part, obj, body_low=None):
    b = part.bind
    if isinstance(b, tuple) and b and b[0] == "bw_auto":
        res = mesh.bind_auto(obj, ctx.info.armature, exclude=tuple(b[1]))
        mesh.limit_weights(obj)
        return res
    if isinstance(b, tuple) and b and b[0] == "bw_cloak":
        bind_cloak(obj, ctx.info.armature)
        mesh.limit_weights(obj)
        return {}
    if isinstance(b, tuple) and b and b[0] == "bw_transfer":     # ride the named (already bound) part's skin
        src = bpy.data.objects.get(f"{b[1]}_low")
        mesh.transfer_weights(src, obj)
        mesh.add_armature_modifier(obj, ctx.info.armature)
        mesh.parent_keep(obj, ctx.info.armature)
        return {}
    return _orig_bind_part(ctx, part, obj, body_low)


pipeline.bind_part = _bind_part
FACTION_TEX = ("brightwick_aubade", "brightwick_serenade")   # the wrappers below touch these builds only
ROUGH_MIN = 0.5             # the lowest roughness a body material authors (leather, walnut)
_orig_bake_asset = bake.bake_asset
_orig_gltf_material = bake.gltf_material


def _bake_asset(low, highs, out_dir, name="body", **kw):
    """A deeper cage for these lows: the module decimates the folded cloak/mantle bells to ~600 tris, so the low
    cuts up to ~2 cm inside the folds; the default 1.2 cm cage then starts the ray inside the high and misses
    (EMIT bakes 0 = roughness 0: chrome-like cloak panels in three). Parts are exploded apart per slot during
    the bake, so the deeper cage only ever meets the part's own high."""
    if str(name).startswith(FACTION_TEX):
        kw.setdefault("cage", 0.03)
        kw.setdefault("ray", 0.08)
    return _orig_bake_asset(low, highs, out_dir, name=name, **kw)


def _gltf_material(name, paths):
    """Non-metallic, never glossy (bible: every material metalness 0, cloth/stone/leather roughness >= 0.5).
    The ORM's roughness is floored at ROUGH_MIN and its B (metal) channel zeroed; Metallic is wired through a
    x0 multiply, which the glTF exporter writes as metallicFactor 0 on the same ORM texture (the lossy WebP's
    chroma bleed into B can never turn into metal). Faction brightwick builds only (the legacy GLB stays frozen)."""
    mine = os.path.basename(str(paths.get("base", ""))).startswith(FACTION_TEX)
    if mine and paths.get("orm"):
        img = bpy.data.images.load(paths["orm"], check_existing=True)
        px = np.empty(len(img.pixels), dtype=np.float32)
        img.pixels.foreach_get(px)
        px = px.reshape(-1, 4)
        low = int((px[:, 1] < ROUGH_MIN).sum())
        px[:, 1] = np.maximum(px[:, 1], ROUGH_MIN)
        px[:, 2] = 0.0
        img.pixels.foreach_set(px.ravel())
        img.save()
        print(f"[brightwick] ORM: roughness floored at {ROUGH_MIN} on {low} texels ({100.0 * low / len(px):.1f} %)")
    m = _orig_gltf_material(name, paths)
    if mine:
        nt = m.node_tree
        bsdf = nt.nodes.get("BSDF")
        for ln in list(bsdf.inputs["Metallic"].links):
            src = ln.from_socket
            nt.links.remove(ln)
            mul = nt.nodes.new("ShaderNodeMath")
            mul.operation = "MULTIPLY"
            mul.inputs[1].default_value = 0.0
            nt.links.new(src, mul.inputs[0])
            nt.links.new(mul.outputs[0], bsdf.inputs["Metallic"])
    return m


_orig_set_image_array = bake.set_image_array


def _set_image_array(img, arr):
    """The full-size ORM, before bake_asset scales it to 256: texels the bake left at roughness 0 (outside the
    islands past the 8 px margin, and ray misses) are filled from their neighbours, then the roughness is set per
    material role from the painted part map (cloth 0.92, chalk 0.86, ironstone 0.80, leather 0.66: the bake's
    procedural roughness averaged into a satin sheen on the small cloak islands) and the metal channel is 0."""
    if img.name.endswith("_orm") and img.name.startswith(FACTION_TEX):
        arr = np.array(arr, dtype=np.float32, copy=True)
        rgb = arr[..., :3]
        valid = rgb[..., 1] > 0.02
        n0 = int((~valid).sum())
        for _ in range(48):
            if valid.all():
                break
            acc = np.zeros_like(rgb)
            cnt = np.zeros(valid.shape, dtype=np.float32)
            for d in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                sv = np.roll(valid, d, (0, 1))
                acc += np.roll(rgb, d, (0, 1)) * sv[..., None]
                cnt += sv
            new = (~valid) & (cnt > 0)
            rgb[new] = acc[new] / cnt[new][:, None]
            valid |= new
        if not valid.all():
            rgb[~valid] = rgb[valid].mean(axis=0)
        spec = SPECS.get(img.name[:-4])
        pm = getattr(spec, "paint_maps", None) if spec is not None else None
        if pm is not None and pm[0]["part"].shape == rgb.shape[:2]:
            part, names = pm[0]["part"][::-1], pm[1]                  # rasterize row 0 = top; image row 0 = bottom
            iy, ix = project.nearest_index(part >= 0)
            part = part[iy, ix]
            rough = np.full(part.shape, 0.9, dtype=np.float32)
            for k, n in enumerate(names):
                role = spec.parts_info.get(n, ("cloth", None))[0]
                rough[part == k] = ROUGH.get(role, 0.9)
            rgb[..., 1] = rough
        rgb[..., 2] = 0.0
        arr[..., :3] = rgb
        print(f"[brightwick] ORM fill: {n0} empty texels ({100.0 * n0 / valid.size:.1f} %) filled from neighbours; "
              f"roughness per role: {pm is not None}")
    return _orig_set_image_array(img, arr)


bake.bake_asset = _bake_asset
bake.gltf_material = _gltf_material
bake.set_image_array = _set_image_array

KINDS = [Brightwick]

if __name__ == "__main__":
    wc.run(KINDS)
