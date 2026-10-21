"""greatwick: the siege Wick (1.5 m). A broad back-lantern on a frame and a heavy hammer; it lobs light at structures.

    Blender -b --factory-startup --python-exit-code 1 --python art/blender/units/wick_greatwick.py -- [--faction aubade|serenade|both|legacy] [--fast] [--clip-sheet]

Builds greatwick_aubade + greatwick_serenade (default: both) into art/out/units/; `--faction legacy` rebuilds
today's greatwick.glb (frozen). Brief: _design/units/wicks.md (§0 hard rules, §3.3 greatwick, §4 accent).
Concepts: _design/concept/wicks/greatwick_{aubade,serenade}.webp. Shared code: wick_common.py (not forked:
the greatwick-only helpers live here). Progress log: art/renders/units/_wick_greatwick_progress.md.

ART 2.0 (HANDOFF "Art 2.0 method", reference fighters/marund.py):
  1. plates   ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/wick_greatwick_plates.py
              (hand-set frames: the shared cut put the Aubade sole row at 1285 and the top on the lantern)
  2. fit      Blender ... --python art/blender/proto/wick_greatwick_fit.py -- --faction aubade|serenade
  3. build    this script (the graded plates + top plates are made on the way, cached)

CONCEPT SPACE vs MODEL SPACE. Each faction is sculpted where its concept paints it (concept space: metres on
the plate frame, so the fit overlay is pixel-true), then each part is moved into the SHARED model layout by a
small warp (`to_model`), because the two sheets disagree with each other and with the brief:
  * Aubade: the hood is re-centred (the sheet draws it 2 cm off axis). The back-lantern is built in MODEL space
    (`lantern_aubade`, AUB_LANT): a portrait dawnglass box, 0.41 x 0.30 m, 0.955-1.53 m, one tall pane per face
    (the sheet's lantern; a first build widened it into a squat landscape case whose roof hid the glass).
  * Serenade: the sheet's whole upper body stands 13 cm taller than Aubade's (hood crown 1.33 m): the body is
    lowered (z 0.15-1.33 -> 0.15-1.25, a lower, broader dome as the brief asks) and narrowed 6 %; the drum is
    narrowed to 0.66 m and set 2 cm lower.
  * Parts sculpted directly in model space (sleeves, mitts: the rest pose is symmetric, the sheet's arms are
    not) carry the opposite map (`to_concept`).
The projection pass inverts every warp (the PAINT POSE: vertices go back to where the concept paints them for
the paint pass only; the burdam cleaver's trick, done here as a project.paint_object wrapper keyed by the
spec's PROJECTION), so the painting lands exactly while the silhouette follows the shared layout.

Paint (same wrapper): the projection paints the CLOTH only (cloak / tunic, sleeves, mitts, boots), each part
from its own region of the plate and never from ghost colours (gw_exclude: CIE Lab tests per part, e.g. the
sheet's ash haft across the Aubade stoles, its longer sand mantle on the Serenade tunic). Per-part / per-zone
TINTS move a part's painted median onto its palette role keeping the brush detail; the Aubade hem band (brief
§2.4) is a zone tint. Everything hard-surface, the trims and the hoods are PROCEDURAL-PAINTERLY (gw_proc:
palette hex with the sheet's value structure, plus stone mottle / cracks / chips / block courses, wood grain,
felt nap, dawnglass gradient): projected, they smeared or took the neighbours painted around them on the sheet.
INK fills the hood hollows (the opening's tapered volume) and the cloak's neck seen through the Aubade opening;
a value ramp darkens the Aubade's feet band.
Accent (§4): hood light (ONE soft ellipsoid at mid-height of the opening, set back 3.5-4 cm: never two points,
never a pool on the floor), the hood mark (Aubade seams / Serenade crown band), the back-lantern cores (Aubade:
a tall oval on each pane + the roof light well; Serenade: the window ring), the Aubade stole clasp, the
Serenade hammer window. No lid oculus (it read as a gem).

Motion: every clip is checked against the real game mesh skinned in numpy (`_Ground`): the death is solved onto
the ground on every frame (no float), the run's planted boots sit exactly on it and the bell never cuts it.

Rule 0.1 (no tall, pointed or conical hood): the Aubade cowl is a broad helmet dome (`helmet`, a superellipse
lathe) under a ROUND ball knob (4.5 % of the figure); the lantern's four corner spires stand at the roof corners,
never behind the hood's axis.
"""
from __future__ import annotations

import math
import os
import sys
from dataclasses import dataclass, field

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import wick_common as wc  # noqa: E402
from wick_common import (Capsule, Ellipsoid, HalfSpace, Lathe, RoundBox, RoundCone, Sculpt, Sphere, Torus,  # noqa: E402
                         anim, fighter, materials, np, rig, scene, sdf)

FlatCapsule, Tube = sdf.FlatCapsule, sdf.Tube
NOISE = sdf.Noise(29)
VOXEL = 0.0075
# concept-space plate heights (the row `top` of each plate: Aubade roof slab top, Serenade drum lid top)
PLATE_HEIGHT = {"aubade": 1.52, "serenade": 1.56}
CONCEPT = {f: f"wicks/greatwick_{f}" for f in ("aubade", "serenade")}


# ── warps (concept space <-> model space) ────────────────────────────────────────────────────────────
def _arr(P):
    return np.asarray(P, dtype=np.float64).reshape(-1, 3)


def shift(dx=0.0, dy=0.0, dz=0.0):
    d = np.array([dx, dy, dz])
    return lambda P: _arr(P) + d


def scale_about(c, s):
    """Scale about point c by s = (sx, sy, sz)."""
    c, s = np.asarray(c, float), np.asarray(s, float)
    return lambda P: (_arr(P) - c) * s + c


def zmap(pts):
    """Piecewise-linear remap of z: pts = [(z_in, z_out), ...] (extrapolated with the end slopes)."""
    zi = np.array([p[0] for p in pts], float)
    zo = np.array([p[1] for p in pts], float)

    def f(P):
        P = _arr(P).copy()
        z = P[:, 2]
        out = np.interp(z, zi, zo)
        lo, hi = z < zi[0], z > zi[-1]
        out[lo] = zo[0] + (z[lo] - zi[0]) * (zo[1] - zo[0]) / (zi[1] - zi[0])
        out[hi] = zo[-1] + (z[hi] - zi[-1]) * (zo[-1] - zo[-2]) / (zi[-1] - zi[-2])
        P[:, 2] = out
        return P
    return f


def compose(*fs):
    def f(P):
        P = _arr(P)
        for g in fs:
            P = g(P)
        return P
    return f


def invert(f, iters: int = 40):
    """Numerical inverse of a near-identity warp (fixed point P <- P - (f(P) - Q); |f' - 1| < 1)."""
    def g(Q):
        Q = _arr(Q)
        P = Q.copy()
        for _ in range(iters):
            P = P - (f(P) - Q)
        return P
    return g


def limb_offset(a, b, d):
    """Model -> concept for a limb sculpted in model space: points move by `d` scaled by their fraction
    along a -> b (0 at the shoulder, 1 at the wrist and beyond)."""
    a, b, d = (np.asarray(v, float) for v in (a, b, d))
    ab = b - a

    def f(P):
        P = _arr(P)
        t = np.clip((P - a) @ ab / (ab @ ab), 0.0, 1.0)
        return P + t[:, None] * d
    return f


# ── sculpt helpers ─────────────────────────────────────────────────────────────────────────────────────
@dataclass
class SP:
    """One sculpted part: mesh `S` (in concept space when `to_model` is given), material `role`, `bind`."""
    name: str
    S: Sculpt
    role: str
    bind: object
    tris: int
    vs: float = 1.0
    to_model: object = None          # concept -> model (applied to the mesh)
    to_concept: object = None        # model -> concept (the paint pose); default: invert(to_model)
    meta: dict = field(default_factory=dict)

    def paint_pose(self):
        if self.to_concept is not None:
            return self.to_concept
        if self.to_model is not None:
            return invert(self.to_model)
        return None


def field_of(S: Sculpt):
    return sdf.Blend([(o, p, k) for o, p, k, _ in S.ops])


def onto(S: Sculpt, pts, lift: float = 0.0, iters: int = 8, eps: float = 1e-3):
    """Move points onto the surface of S (+ lift along the normal)."""
    B = field_of(S)
    P = _arr(pts).copy()
    for _ in range(iters):
        d = B.d(P)
        g = np.stack([(B.d(P + e) - B.d(P - e)) / (2 * eps) for e in np.eye(3) * eps], axis=1)
        g /= np.linalg.norm(g, axis=1, keepdims=True) + 1e-9
        P = P - (d - lift)[:, None] * g
    return P


def folds(amp, freq, cx=0.0, cy=0.0, phase=0.0, zfade=None, warp=0.8):
    """Vertical cloth folds around the (cx, cy) axis; optionally deepening downward (zfade = (z_top, z_full))."""
    def fn(P):
        a = np.arctan2(P[:, 1] - cy, P[:, 0] - cx)
        u = np.sin(a * freq + phase + warp * NOISE(P, 3.0))
        amp_ = amp
        if zfade is not None:
            z0, z1 = zfade
            amp_ = amp * np.clip((z0 - P[:, 2]) / (z0 - z1), 0.2, 1.0)
        return amp_ * (np.abs(u) * 2 - 1) * -0.5
    return fn


def bell(c, prof_pts, depth: float, z0: float, z1: float, rmax: float):
    """A Lathe whose radius follows prof_pts [(z, r)] (linear), squashed to `depth` x along Y."""
    zs = np.array([p[0] for p in prof_pts])
    rs = np.array([p[1] for p in prof_pts])

    def prof(r, z):
        rr = np.interp(z, zs, rs)
        return np.maximum(np.maximum(r - rr, z0 - z), z - z1) * 0.9
    return Lathe(c, prof, rmax, z0 - 0.01, z1 + 0.01, axes=np.diag([1.0, 1.0 / depth, 1.0]))


def helmet(c, a, b, h, n=3.0):
    """A superellipsoid of revolution about Z through c: radius a in X, b in Y, half height h, exponent n
    (n = 2 an ellipsoid; larger = broader shoulders and a flatter top, a helmet rather than an egg)."""
    def prof(r, z):
        q = ((r / a) ** n + (np.abs(z) / h) ** n) ** (1.0 / n)
        return (q - 1.0) * min(a, h) * 0.9
    # (Lathe.bounds maps rmax through the axes, which shrinks Y when b > a: pad rmax so the box covers b)
    return Lathe(c, prof, max(a, b) * max(1.0, b / a) * 1.05, -h * 1.05, h * 1.05, axes=np.diag([1.0, a / b, 1.0]))


def capelet(c, z_top, r_top, z_bot, r_bot, thick, depth=1.0, power=0.6):
    """A thick shell of revolution whose radius grows fast under z_top and slowly toward z_bot
    (r = r_top + (r_bot - r_top) * u ** power, u = 0 at the top): rounded shoulders, not a cone."""
    def prof(r, z):
        u = np.clip((z_top - z) / (z_top - z_bot), 0, 1)
        rr = r_top + (r_bot - r_top) * u ** power
        d = np.abs(r - (rr - thick * 0.5)) - thick * 0.5
        return np.maximum(np.maximum(d, z_bot - z), z - z_top) * 0.8
    return Lathe(c, prof, r_bot + 0.05, z_bot - 0.02, z_top + 0.02, axes=np.diag([1.0, 1.0 / depth, 1.0]))


class TaperEllipsoid(sdf.Prim):
    """An ellipsoid (radii rx, ry, rz about c) whose X half-width scales with height: x / s(z), s = 1 - taper *
    (z - cz) / rz, so it narrows upward (taper > 0): the sheet's hood opening, a rounded arch over a wider sill
    (a plain wide ellipse read as a gaping mouth)."""

    def __init__(self, c, radii, taper):
        self.c = np.asarray(c, float)
        self.r = np.asarray(radii, float)
        self.t = float(taper)

    def bounds(self):
        h = self.r * np.array([1.0 + abs(self.t), 1.0, 1.0])
        return self.c - h, self.c + h

    def d(self, P):
        p = _arr(P) - self.c
        s = np.clip(1.0 - self.t * p[:, 2] / self.r[2], 0.3, 2.0)
        q = p.copy()
        q[:, 0] /= s
        k0 = np.linalg.norm(q / self.r, axis=1)
        k1 = np.linalg.norm(q / (self.r * self.r), axis=1)
        return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9) * np.minimum(s, 1.0)

    def ring(self, n: int, grow: float = 1.0, y: float | None = None):
        """n points round the opening's outline (XZ), scaled about its centre by `grow`."""
        t = np.linspace(0, 2 * np.pi, n + 1)[:-1]
        z = self.r[2] * grow * np.sin(t)
        s = 1.0 - self.t * z / self.r[2]
        x = self.r[0] * grow * s * np.cos(t)
        yy = np.full(n, self.c[1] if y is None else y)
        return np.stack([self.c[0] + x, yy, self.c[2] + z], 1)


def chips(amp, freq):
    return lambda P: amp * np.clip(NOISE.ridged(P, freq, 3), 0, 1) - amp * 0.3


def ring_pts(c, a, b, n, normal_axis="y", start=0.0, end=2 * math.pi):
    """Points of an ellipse (semi-axes a, b) around c in the XZ plane (normal_axis 'y') or XY plane ('z')."""
    t = np.linspace(start, end, n)
    c = np.asarray(c, float)
    if normal_axis == "y":
        return np.stack([c[0] + a * np.cos(t), np.full(n, c[1]), c[2] + b * np.sin(t)], 1)
    return np.stack([c[0] + a * np.cos(t), c[1] + b * np.sin(t), np.full(n, c[2])], 1)


# ── the spec ───────────────────────────────────────────────────────────────────────────────────────────
class Greatwick(wc.Wick):
    KIND_ID = "greatwick"
    HEIGHT = 1.5
    AO_INTO_BASE = 0.3          # the painting carries its own occlusion; only deepen creases

    def __init__(self, faction: str = wc.LEGACY):
        super().__init__(faction)
        if faction == wc.LEGACY:
            return
        self.L = LAYOUT[faction]
        self.PROPORTIONS = fit_proportions(self.L)
        self.MOTION = anim.motion_profile(weight="heavy", weapon="two_hand", stance="wide", run_ref_speed=3.2)
        self.VALUE_GRADIENT_STOPS = materials.BIBLE_GRADIENT_STOPS
        self._parts = None
        g = GRADE[faction]
        proj = wc.graded_projection(CONCEPT[faction], PLATE_HEIGHT[faction], tag="gw", **g)
        proj["gw_pose"] = {}          # filled in model(): part name -> model->concept map (the paint pose)
        proj["gw_roles"] = {}         # filled in model(): part name -> material role
        proj["gw_palette"] = dict(self.PALETTE)
        proj["gw_mask"] = f"{CONCEPT[faction]}_mask.png"
        proj.update(PAINT[faction])
        self.PROJECTION = proj
        _install()

    # ── model ──────────────────────────────────────────────────────────────────────────────────────
    def parts(self) -> list:
        if self._parts is None:
            self._parts = (aubade_parts if self.faction == "aubade" else serenade_parts)(self.L)
        return self._parts

    def model(self, ctx) -> list:
        if self.faction == wc.LEGACY:
            return self.legacy_model(ctx)
        P = []
        pose = self.PROJECTION["gw_pose"]
        for sp in self.parts():
            v, q = sp.S.mesh(VOXEL * sp.vs)
            if sp.to_model is not None:
                v = sp.to_model(v)
            ob = sdf.to_object(f"{sp.name}_high", v, q, ctx.col)
            ob.data.materials.append(ctx.mats[sp.role])
            P.append(fighter.Part(sp.name, high=ob, low=_low_of(ob, sp), tris=sp.tris, bind=sp.bind))
            pp = sp.paint_pose()
            if pp is not None:
                pose[sp.name] = pp
            self.PROJECTION["gw_roles"][sp.name] = sp.role
        return P

    def rig_extras(self, ctx) -> None:
        if self.faction == wc.LEGACY:
            return
        orient_prop(ctx.info, self.L)

    def clip_overrides(self, ctx) -> dict:
        if self.faction == wc.LEGACY:
            return {}
        return motion_clips(ctx, self)

    def legacy_props(self, ctx, part) -> None:
        k = self.H / 1.1
        sh = ctx.info.j("neck_base")
        wc.legacy_weapon(self, ctx, part, "stone", (0.11, 0.07, 0.08))
        pack = Sculpt("backlantern")
        bc = (0, 0.24 * k, sh.z - 0.05 * k)
        pack.add(RoundBox(bc, (0.16 * k, 0.1 * k, 0.2 * k), 0.03 * k), k=0.0)
        pack.sub(RoundBox((bc[0], bc[1] + 0.1 * k, bc[2] + 0.02 * k), (0.12 * k, 0.07 * k, 0.15 * k), 0.02 * k), k=0.01 * k)   # open to the back
        pack.add(Torus((bc[0], bc[1], bc[2] + 0.26 * k), 0.07 * k, 0.015 * k), k=0.0)                                         # carry ring
        part("backlantern", pack, "ironstone", "bone:chest", 300)
        core = Sculpt("backcore")
        core.add(Ellipsoid((bc[0], bc[1] + 0.05 * k, bc[2] + 0.04 * k), (0.12 * k, 0.07 * k, 0.15 * k)), k=0.0)
        part("backcore", core, "accent", "bone:chest", 100)


def _low_of(high, sp):
    """The game mesh of a part: a collapse-decimated copy of the sculpt. The shared step decimates with X
    symmetry, which stalls on parts whose voxel grid is not mirror-exact (a lantern slab stopped at 578 of 60
    tris); fall back to a free collapse there."""
    from common import mesh
    low = mesh.duplicate(high, f"{sp.name}_low")
    n = mesh.decimate_to(low, sp.tris, symmetric=True)
    if n > sp.tris * 1.12:
        bpy_data = low.data
        low2 = mesh.duplicate(high, f"{sp.name}_low")
        mesh.decimate_to(low2, sp.tris, symmetric=False)
        import bpy
        bpy.data.objects.remove(low, do_unlink=True)
        if bpy_data.users == 0:
            bpy.data.meshes.remove(bpy_data)
        low = low2
    return low


# ── layout: the shared model frame + each faction's concept-space landmarks ─────────────────────────────
# Model space (metres, Z up, the wick faces -Y, its left is +X). Both factions: lantern top 1.52-1.54 (content
# art.height 1.5 within 5 %), hammer head on the wick's left at hip height, haft across the body in both hands.
LAYOUT = {
    "aubade": dict(
        crown=1.205,                     # hood crown (knob tip 1.275)
        hip=0.46, ankle=0.06, stance=0.06, hip_w=0.20, foot=0.17,
        neck=0.828, shoulder=(0.22, 0.718), arm=0.42, upper_frac=0.47, hand=0.10,
        wrist=(-0.300, -0.285, 0.485),   # right wrist at rest (the left mirrors it)
        grip_r=(-0.305, -0.345, 0.468),  # right fist on the haft (prop.R head)
        haft=(0.925, 0.0, 0.135),        # haft direction toward the head (concept front view)
        grip_l_along=0.50,               # left fist this far along the haft
        lantern_y=0.48,
        topple=dict(pivot=(0.30, 0.10), corner=(0.66, 1.46), lie=67.5),    # death: back hem pivot; at `lie` the lantern
                                                                            # and the back hem both touch (probed)
    ),
    "serenade": dict(
        crown=1.25,
        hip=0.47, ankle=0.065, stance=0.09, hip_w=0.22, foot=0.19,
        neck=0.868, shoulder=(0.24, 0.758), arm=0.42, upper_frac=0.47, hand=0.10,
        wrist=(-0.330, -0.300, 0.515),
        grip_r=(-0.338, -0.360, 0.500),
        haft=(0.995, 0.0, 0.10),
        grip_l_along=0.56,
        lantern_y=0.42,
        topple=dict(pivot=(0.36, 0.15), corner=(0.666, 1.43), lie=74.5),
    ),
}


def fit_proportions(L: dict) -> dict:
    """VALE_BIPED_1 at minion proportions fitted to the layout: the arm angles are solved so the rest
    wrist lands on L['wrist'] (rig._layout's own arm formula, grid search)."""
    crown = L["crown"] - 0.035
    head = (crown - L["neck"] - 0.05) / 0.86
    neck = 0.05
    z_neck = crown - head * 0.86 - neck
    sw = L["shoulder"][0]
    drop = z_neck - L["shoulder"][1]
    arm, uf = L["arm"], L["upper_frac"]
    sh = np.array([sw, 0.0 + 0.012 + 0.018, z_neck - drop])
    want = np.array([-L["wrist"][0], L["wrist"][1], L["wrist"][2]])     # the left wrist (+X)
    A, F, B = np.meshgrid(np.radians(np.arange(10, 89, 1.0)), np.radians(np.arange(0, 85, 1.0)),
                          np.radians(np.arange(0, 100, 1.0)), indexing="ij")
    d1 = np.stack([np.cos(A) * np.cos(F), -np.cos(A) * np.sin(F), -np.sin(A)], -1)
    elbow = sh + d1 * arm * uf
    front = np.array([0.0, -1.0, 0.0])
    zf = front - d1 * (d1 @ front)[..., None]
    zf /= np.linalg.norm(zf, axis=-1, keepdims=True) + 1e-9
    hinge = np.cross(d1, zf)
    hinge /= np.linalg.norm(hinge, axis=-1, keepdims=True) + 1e-9
    # Rodrigues: rotate d1 about hinge by B
    cb, sb = np.cos(B)[..., None], np.sin(B)[..., None]
    d2 = d1 * cb + np.cross(hinge, d1) * sb + hinge * (hinge * d1).sum(-1, keepdims=True) * (1 - cb)
    wrist = elbow + d2 * arm * (1 - uf)
    err = np.linalg.norm(wrist - want, axis=-1)
    i = np.unravel_index(np.argmin(err), err.shape)
    a_deg, f_deg, b_deg = (float(np.degrees(M[i])) for M in (A, F, B))
    leg = math.hypot(L["hip"] - L["ankle"], L["stance"])
    return rig.proportions(height=crown, head=head, neck=neck, shoulder_width=2 * sw, hip_width=L["hip_w"],
                           leg=leg, thigh_frac=0.5, arm=arm, upper_arm_frac=uf, hand=L["hand"], foot=L["foot"],
                           ankle_height=L["ankle"], stance=L["stance"], spine_curve=0.0, toe_out_deg=8.0,
                           knee_bend=0.012, a_pose_deg=a_deg, arm_forward_deg=f_deg, elbow_bend_deg=b_deg,
                           shoulder_drop=drop)


def orient_prop(info, L: dict) -> None:
    """prop.R runs along the haft: head on the right fist's grip, +Y toward the hammer head, +Z = the head's
    long axis (the striking faces). anim.Aim then points the haft and HandTarget(to_prop) grips it."""
    import bpy
    from mathutils import Vector
    arm = info.armature
    scene.select_only([arm], arm)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones["prop.R"]
    g = Vector(L["grip_r"])
    d = Vector(L["haft"]).normalized()
    eb.head = g
    eb.tail = g + d * 0.12
    up = Vector((0.0, 0.0, 1.0))
    eb.align_roll(up - d * up.dot(d))
    bpy.ops.object.mode_set(mode="OBJECT")


def haft_point(L, along):
    return np.asarray(L["grip_r"]) + np.asarray(L["haft"]) / np.linalg.norm(L["haft"]) * along


# ── shared pieces (model space) ──────────────────────────────────────────────────────────────────────
def rest_arm(L, side: str):
    """(shoulder, elbow, wrist) of the rest pose, model space (mirrors rig._layout)."""
    P = fit_proportions(L)
    import types  # noqa: F401
    sw = P["shoulder_width"] / 2
    z_neck = P["height"] - P["head"] * 0.86 - P["neck"]
    sh = np.array([sw, 0.03, z_neck - P["shoulder_drop"]])
    a, fw = math.radians(P["a_pose_deg"]), math.radians(P["arm_forward_deg"])
    d1 = np.array([math.cos(a) * math.cos(fw), -math.cos(a) * math.sin(fw), -math.sin(a)])
    el = sh + d1 * P["arm"] * P["upper_arm_frac"]
    front = np.array([0.0, -1.0, 0.0])
    zf = front - d1 * d1.dot(front)
    zf /= np.linalg.norm(zf)
    h = np.cross(d1, zf)
    h /= np.linalg.norm(h)
    b = math.radians(P["elbow_bend_deg"])
    d2 = d1 * math.cos(b) + np.cross(h, d1) * math.sin(b) + h * h.dot(d1) * (1 - math.cos(b))
    wr = el + d2 * P["arm"] * (1 - P["upper_arm_frac"])
    if side == "R":
        m = np.array([-1.0, 1.0, 1.0])
        return sh * m, el * m, wr * m
    return sh, el, wr


def boots_legs(L, out: list, boot_c, boot_half, toe_r, role="leather", sole_role=None):
    """Short dark legs inside the cloak (continuity when a foot lifts) + a boot per foot (rigid on the foot)."""
    legs = Sculpt("legs")
    for sx in (-1, 1):
        hip = (sx * L["hip_w"] / 2, 0.0, L["hip"])
        ank = (sx * (L["hip_w"] / 2 + L["stance"]), 0.02, L["ankle"] + 0.03)
        legs.add(RoundCone(hip, ank, 0.075, 0.055), k=0.0)
    out.append(SP("legs", legs, "under", "auto", 80))
    for s, sx in (("L", 1), ("R", -1)):
        b = Sculpt(f"boot_{s}")
        c = (sx * boot_c[0], boot_c[1], boot_c[2])
        b.add(RoundBox(c, boot_half, 0.04), k=0.0)
        b.add(Ellipsoid((c[0], c[1] - boot_half[1] * 0.55, c[2] - 0.005), (boot_half[0] * 1.02, toe_r, boot_half[2] * 0.95)), k=0.03)
        b.add(Capsule((c[0], c[1] + 0.02, c[2]), (c[0], c[1] + 0.02, c[2] + boot_half[2] + 0.03), boot_half[0] * 0.8), k=0.03)
        b.inter(HalfSpace((0, 0, 0.0), (0, 0, -1), 1.0), k=0.0)
        out.append(SP(f"boot_{s}", b, role, f"bone:foot.{s}", 60, 0.8))


def sleeves_mitts(L, out: list, concept_mitts: dict, r_up=0.085, r_fore=0.075, role="cloth", mitt_role="leather",
                  mitt_r=0.062, body=None, top_dz=0.03, r_top=None):
    """Sleeves (model space, along the rest arms; heat-weighted on their own arm) and mitten fists (rigid on the
    hands, a thumb lobe). The rest pose is symmetric, the sheet's arms are not: the paint pose slides each sleeve
    progressively (0 at the shoulder, all of it at the cuff) and each fist onto the sheet's fists
    (concept_mitts {side: concept xyz}), then undoes the faction's body warp (`body`, concept -> model).
    top_dz / r_top: the sleeve cap's lift over the shoulder joint and its radius (a capelet over the shoulders
    needs the cap tucked under it: the decimated lows have no room for a 1-2 cm gap)."""
    back = invert(body) if body is not None else None
    for s in ("R", "L"):
        sh, el, wr = rest_arm(L, s)
        sx = -1.0 if s == "R" else 1.0
        S = Sculpt(f"sleeve_{s}")
        top = sh + np.array([sx * -0.02, 0.0, top_dz])
        rt = r_up if r_top is None else r_top
        S.add(FlatCapsule(top, el, rt, rt * 0.92, r_up * 0.95, r_up * 0.9, side=(1, 0, 0)), k=0.0)
        S.add(FlatCapsule(el, wr + (wr - el) * -0.12, r_fore, r_fore * 0.95, r_fore * 1.08, r_fore * 1.02, side=(1, 0, 0)), k=0.045)
        S.add(Sphere(el, r_up * 0.95), k=0.05)
        dw = (wr - el) / np.linalg.norm(wr - el)
        S.add(Torus(wr - dw * 0.05, r_fore * 0.92, 0.022, axes=sdf.frame(dw)), k=0.015)      # cuff roll
        S.sub(Capsule(wr - dw * 0.005, wr + dw * 0.08, r_fore * 0.6), k=0.01)                # open cuff
        cm = np.asarray(concept_mitts[s], float)
        cm_m = body(cm[None])[0] if body is not None else cm
        hand_c = wr + dw * 0.045
        d = cm_m - hand_c
        tf = limb_offset(sh, wr, d)
        out.append(SP(f"sleeve_{s}", S, role, ("gw_arm", s), 130, 0.9, to_concept=compose(tf, back) if back else tf))
        M = Sculpt(f"mitt_{s}")
        M.add(Ellipsoid(hand_c, (mitt_r, mitt_r * 1.05, mitt_r * 0.95), axes=sdf.frame(dw)), k=0.0)
        thumb = hand_c + np.array([-sx * 0.02, -0.035, 0.035])
        M.add(Ellipsoid(thumb, (0.026, 0.03, 0.022)), k=0.02)
        mt = shift(*d)
        out.append(SP(f"mitt_{s}", M, mitt_role, f"bone:hand.{s}", 50, 0.8, to_concept=compose(mt, back) if back else mt))


def segment_pose(a_m, b_m, a_c, b_c):
    """Model -> concept for a strut sculpted in model space between a_m and b_m whose paint lies between a_c and
    b_c (each point moves by the end offsets blended along the strut)."""
    a_m, b_m, a_c, b_c = (np.asarray(v, float) for v in (a_m, b_m, a_c, b_c))
    ab = b_m - a_m
    da, db = a_c - a_m, b_c - b_m

    def f(P):
        P = _arr(P)
        t = np.clip((P - a_m) @ ab / (ab @ ab), 0.0, 1.0)[:, None]
        return P + da * (1 - t) + db * t
    return f


def hood_light(c, out: list, to_model=None, s: float = 1.0, radii=(0.088, 0.034, 0.052)):
    g = Sculpt("hoodlight")
    g.add(Ellipsoid(c, tuple(r * s for r in radii)), k=0.0)        # one soft volume, wider than tall: never eyes
    out.append(SP("hoodlight", g, "accent", "bone:head", 40, 0.8, to_model=to_model))


# ══ AUBADE (concept space: front x = (px - 573) / 762, z = (1372 - py) / 762) ══════════════════════════════
# the hood opening (concept space; the hood's own axis): a carve centred BEHIND the cowl's front so its full
# section meets the curved cowl (centred in front of it, the hole came out 0.25 x 0.24 instead of 0.33 x 0.34)
AUB_OPEN_C = np.array([-0.024, -0.17, 0.915])
AUB_OPEN = (AUB_OPEN_C, (0.165, 0.17, 0.172), 0.28)


def aubade_parts(L: dict) -> list:
    out: list = []
    hood_tf = shift(dx=0.022)
    # ── HOOD: a soft rounded cowl, round on top like a helmet, swept back and down at the nape ─────────────
    hc = np.array([-0.022, 0.02, 0.93])
    hood = Sculpt("hood")
    hood.add(Ellipsoid(hc + (0, 0, -0.03), (0.25, 0.25, 0.245)), k=0.0)              # widest low: an arch, not a ball
    hood.add(Ellipsoid(hc + (0, 0.08, -0.11), (0.20, 0.14, 0.15)), k=0.07)              # nape, swept back + down
    hood.add(Ellipsoid(hc + (0, 0.03, -0.155), (0.268, 0.245, 0.09)), k=0.07)           # drape over the shoulders
    # the crown: a broad helmet dome (a superellipse lathe, n = 3: 0.43 m wide at 1.10 m like the sheet, flat
    # on top at 1.19 m). An ellipsoid here narrowed into a bullet over the pale cowl (rule 0.1): never again.
    hood.add(helmet((-0.022, 0.02, 0.95), 0.238, 0.245, 0.24, 3.0).displaced(chips(0.003, 6.0), 0.003), k=0.03)
    # the opening: the sheet's rounded arch, narrow at the brow (0.11 m at 1.04) and widest low (0.28 m at
    # 0.83), 0.30 m tall (0.765-1.065). The first build's 0.38 x 0.34 oval read as a gaping mouth.
    opening = TaperEllipsoid(*AUB_OPEN)
    hood.sub(opening, k=0.016)
    out.append(SP("hood", hood, "cloth2", "bone:head", 460, to_model=hood_tf))
    # the carved chalk rim (3.8 cm) round the opening, laid on the cowl's surface, coming to a soft point at the
    # chin like the sheet's
    # a FLAT carved band (a sunk 2.4 cm tube: 1.2 cm proud, 4 cm wide), not a round roll (a pale roll round a
    # dark hole read as lips)
    ring = opening.ring(48, grow=1.15, y=-0.30)
    ring[:, 2] -= 0.04 * np.clip(-(ring[:, 2] - AUB_OPEN_C[2]) / 0.198, 0, 1) ** 4 * np.clip(
        1 - np.abs(ring[:, 0] - AUB_OPEN_C[0]) / 0.09, 0, 1)
    ring = onto(hood, ring, lift=-0.010)
    rim = Sculpt("hood_rim")
    pts = np.vstack([ring, ring[:1]])
    rim.add(Tube(pts, [0.022] * len(pts), k=0.008), k=0.0)
    out.append(SP("hood_rim", rim, "chalk", "bone:head", 170, 0.7, to_model=hood_tf))
    # the knob: a small ROUND chalk knob on a collar ring (crown 1.19 -> top 1.257: 4.5 % of the figure). No
    # point on it: over a pale cowl with a dark opening a tip is the one silhouette rule 0.1 forbids.
    knob = Sculpt("knob")
    kc = np.array([-0.024, 0.005, 1.217])
    knob.add(Ellipsoid(kc + (0, 0, -0.004), (0.037, 0.037, 0.036)), k=0.0)       # (all 50 tris on the ball: round)
    out.append(SP("knob", knob, "chalk", "bone:head", 50, 0.6, to_model=hood_tf))
    # the hood mark: accent seams from the rim's top corners over the crown to the knob, one down the back
    seam = Sculpt("seam")
    for sx in (-1, 1):
        a = np.linspace(0, 1, 9)
        p0 = np.array([AUB_OPEN_C[0] + sx * 0.115, -0.19, 1.07])        # the rim's upper corners
        p1 = kc + (sx * 0.03, -0.01, -0.02)
        mid = (p0 + p1) / 2 + np.array([sx * 0.04, -0.03, 0.06])
        pts = (1 - a)[:, None] ** 2 * p0 + 2 * (a * (1 - a))[:, None] * mid + (a ** 2)[:, None] * p1
        pts = onto(hood, pts, lift=0.002)
        seam.add(Tube(pts, [0.0135] * len(pts), k=0.006), k=0.006)
    ang = np.radians(np.linspace(8, 150, 14))
    back = np.stack([np.full(len(ang), -0.024), 0.02 + 0.30 * np.sin(ang), 0.93 + 0.30 * np.cos(ang)], 1)
    back = onto(hood, back, lift=0.002)
    seam.add(Tube(back, [0.0135] * len(back), k=0.006), k=0.006)
    out.append(SP("seam", seam, "accent", "bone:head", 100, 0.55, to_model=hood_tf))
    # the light: ONE soft ellipsoid at mid-height of the opening, set back 3.5 cm behind the lip plane (y -0.24),
    # wider than tall (rule 0.2). The first build's flat pool on the hollow's floor sat on the lower lip like a
    # tongue in a mouth.
    hood_light(np.array([AUB_OPEN_C[0], -0.145, 0.89]), out, to_model=hood_tf, radii=(0.066, 0.032, 0.045))

    # ── BODY: a straight-folded cloak bell to the shins, a pointed hem, chalk stoles, a dawnglass clasp ──────
    cloak = Sculpt("cloak")
    prof = [(0.06, 0.392), (0.20, 0.372), (0.40, 0.335), (0.55, 0.305), (0.68, 0.272), (0.78, 0.225), (0.85, 0.17)]
    cl = bell((-0.01, 0.0, 0.0), prof, 0.80, 0.06, 0.85, 0.42)
    cloak.add(cl.displaced(folds(0.016, 9, cx=-0.01, zfade=(0.75, 0.25)), 0.016), k=0.0)
    cloak.add(Ellipsoid((-0.01, 0.0, 0.70), (0.275, 0.24, 0.12)), k=0.06)                 # shoulders under the drape

    def hem_cut(P):
        a = np.arctan2(P[:, 1], P[:, 0] + 0.01)
        return -0.032 * np.clip(np.cos(a * 5 + 0.4), 0, 1) ** 2.5
    # the 6-8 cm hem band: a raised lip (painted dark by a zone tint, brief §2.4)
    lip = bell((-0.01, 0.0, 0.0), [(0.06, 0.403), (0.20, 0.385)], 0.80, 0.06, 0.175, 0.43)
    cloak.add(lip.displaced(folds(0.016, 9, cx=-0.01, zfade=(0.75, 0.25)), 0.016), k=0.005)
    cloak.inter(HalfSpace((0, 0, 0.115), (0, 0, -1), 1.0).displaced(hem_cut, 0.04), k=0.004)
    out.append(SP("cloak", cloak, "cloth", ("gw_cloak",), 560))
    # chalk stoles over the cloak's front edges (the sheet: x -0.20..-0.10 and -0.02..+0.09, chin to 0.13)
    # each ends in the sheet's slanted cut, lower on the inner edge (the first build's 45-degree tips read as
    # loose pale shards at the hem)
    stole = Sculpt("stole")
    for (x0, x1), (zi, zo) in (((-0.200, -0.110), (0.150, 0.200)), ((-0.022, 0.078), (0.150, 0.190))):
        xc, hw = (x0 + x1) / 2, (x1 - x0) / 2
        top, bot = np.array([xc, -0.17, 0.74]), np.array([xc, -0.32, 0.12])
        top = onto(cloak, top[None], lift=0.011)[0]
        bot = onto(cloak, bot[None], lift=0.011)[0]
        d = bot - top
        Ld = np.linalg.norm(d)
        ax = sdf.frame(d / Ld, (1, 0, 0))
        S1 = Sculpt("s1")
        S1.add(RoundBox((top + bot) / 2, (hw, 0.011, Ld / 2), 0.008, axes=ax), k=0.0)
        xin, xout = (x1, x0) if xc < -0.05 else (x0, x1)
        slope = (zo - zi) / (xout - xin)
        S1.inter(HalfSpace((xin, 0.0, zi), (slope, 0.0, -1.0), 1.0), k=0.006)
        stole.add(field_of(S1), k=0.0)
    out.append(SP("stole", stole, "chalk", ("gw_cloak",), 100, 0.8))
    # the dawnglass clasp between the stoles (a chalk ring around an accent core)
    cc = onto(cloak, np.array([[-0.058, -0.25, 0.62]]), lift=0.012)[0]
    clasp = Sculpt("clasp")
    clasp.add(Torus(cc, 0.034, 0.012, axes=sdf.frame((0, -1, 0.15))), k=0.0)
    out.append(SP("clasp", clasp, "chalk", ("gw_cloak",), 40, 0.6))
    core = Sculpt("clasp_core")
    core.add(Ellipsoid(cc + (0, -0.004, 0), (0.024, 0.011, 0.024)), k=0.0)
    out.append(SP("clasp_core", core, "accent", ("gw_cloak",), 20, 0.6))

    # ── ARMS, FISTS, LEGS, BOOTS ───────────────────────────────────────────────────────────────────────
    sleeves_mitts(L, out, {"R": (-0.31, -0.345, 0.475), "L": (0.205, -0.345, 0.545)}, r_up=0.088, r_fore=0.08)
    boots_legs(L, out, (0.165, -0.035, 0.05), (0.072, 0.105, 0.05), 0.07)

    # ── HAMMER (concept space, rigid on prop.R): pale ash haft, chalk head with wedge faces, stone bindings ──
    hammer_aubade(L, out)
    # ── BACK-LANTERN ────────────────────────────────────────────────────────────────────────────────────
    lantern_aubade(L, out)
    return out


def hammer_aubade(L, out):
    d = np.asarray(L["haft"], float)
    d /= np.linalg.norm(d)
    g = np.asarray(L["grip_r"], float)
    pom = g - d * 0.215                         # pommel end (the sheet: x -0.515)
    head_c = g + d * 0.73                       # head centre (the sheet: x 0.40, z 0.57)
    up = np.array([-d[2], 0.0, d[0]])           # the head's long axis (perpendicular to the haft, in the view plane)
    ax = np.stack([d, np.cross(up, d), up])     # rows: local X along the haft, Y, Z = the long axis
    haft = Sculpt("haft")
    haft.add(Capsule(pom + d * 0.03, head_c, 0.024).displaced(lambda P: 0.002 * np.sin(P[:, 0] * 160), 0.002), k=0.0)
    out.append(SP("haft", haft, "wood", "bone:prop.R", 60, 0.7))
    grip = Sculpt("grip")
    grip.add(Capsule(pom + d * 0.035, pom + d * 0.085, 0.031), k=0.0)                    # stone-blue wrap
    for i in range(2):
        grip.add(Torus(pom + d * (0.045 + 0.03 * i), 0.029, 0.009, axes=sdf.frame(d)), k=0.006)
    out.append(SP("grip", grip, "stone", "bone:prop.R", 40, 0.6))
    pm = Sculpt("pommel")
    pm.add(RoundBox(pom, (0.03, 0.04, 0.045), 0.012, axes=ax).displaced(chips(0.004, 14.0), 0.004), k=0.0)
    out.append(SP("pommel", pm, "chalk", "bone:prop.R", 40, 0.6))
    hd = Sculpt("hammer_head")
    # a chunky chalk block, 0.27 wide (along the haft) x 0.23 deep x 0.38 tall, its faces chamfered to wedges
    hd.add(RoundBox(head_c, (0.125, 0.105, 0.17), 0.03, axes=ax).displaced(chips(0.007, 8.0), 0.007), k=0.0)
    for sz in (-1, 1):
        face = head_c + up * sz * 0.17
        hd.add(RoundBox(face + up * sz * 0.012, (0.115, 0.095, 0.02), 0.015, axes=ax), k=0.012)
    hd.sub(RoundBox(head_c, (0.2, 0.2, 0.012), 0.004, axes=ax), k=0.006)             # the stone-joint groove
    out.append(SP("hammer_head", hd, "chalk", "bone:prop.R", 200))
    st = Sculpt("hammer_bind")
    # crossed stone-blue bindings over the head's inner face (the sheet's X straps) + a collar on the haft
    for sg in (-1, 1):
        a = head_c - d * 0.128 + up * 0.10 * sg + np.array([0, -0.09, 0])
        b = head_c - d * 0.128 - up * 0.10 * sg + np.array([0, 0.09, 0])
        st.add(Capsule(a, b, 0.016), k=0.004)
        for fy in (-1, 1):                      # and crossed over the front and back faces (seen from the camera)
            a = head_c + d * 0.095 * sg + up * 0.125 + np.array([0, fy * 0.108, 0])
            b = head_c - d * 0.095 * sg - up * 0.125 + np.array([0, fy * 0.108, 0])
            st.add(Capsule(a, b, 0.014), k=0.004)
    st.add(Torus(head_c - d * 0.16, 0.034, 0.013, axes=sdf.frame(d)), k=0.006)
    out.append(SP("hammer_bind", st, "stone", "bone:prop.R", 120, 0.6))


# the Aubade back-lantern (model space): a PORTRAIT dawnglass box. The first build widened the sheet's box into
# a squat landscape case with cross-mullioned windows (a cottage window / TV read) whose roof hid the glass from
# the game camera; the sheet's lantern is narrow and tall with one tall pane per face and a glowing core.
AUB_LANT = dict(hw=0.205, hd=0.150, z_base=0.955, z_pane=(0.995, 1.405), z_cap=1.440, z_eave=1.462, z_ridge=1.530,
                post=0.026, eave=0.030)


def lantern_aubade(L, out):
    """Body 0.41 x 0.30 m, 0.955-1.53 m (brief: body 0.92-1.48, roof to 1.52): a chalk base slab, four chalk
    corner posts that run on up into the four corner spires (upward lines), ONE tall dawnglass pane per face
    (0.41 m tall) with a tall glowing core oval on it (the accent: it shows from the front over the hood, from the
    sides and the back), a chalk cap course, a low four-sided roof with a small eave and a square light well
    (the core from above), on a pale ash shelf and carrying frame. Panes are `dawnglass` (glossy, not emissive),
    the cores are `accent`."""
    A = AUB_LANT
    yl = L["lantern_y"]
    hw, hd, po = A["hw"], A["hd"], A["post"]
    zp0, zp1 = A["z_pane"]
    zb, zc, ze, zr = A["z_base"], A["z_cap"], A["z_eave"], A["z_ridge"]
    # corner posts (separate bars: a cage is genus 5 and collapses under a small decimation)
    bars = Sculpt("lantern_bars")
    for px in (-1, 1):
        for py in (-1, 1):
            c0 = np.array([px * (hw - po), yl + py * (hd - po), (zb + zc) / 2])
            bars.add(RoundBox(c0, (po, po, (zc - zb) / 2 + 0.004), 0.007), k=0.0)
    out.append(SP("lantern_bars", bars, "chalk", "bone:chest", 96, 0.8))
    # base slab + cap course (chalk plates, a little wider than the posts)
    slabs = Sculpt("lantern_slabs")
    slabs.add(RoundBox((0, yl, zb + 0.016), (hw + 0.016, hd + 0.016, 0.022), 0.009), k=0.0)
    slabs.add(RoundBox((0, yl, (zp1 + zc) / 2), (hw + 0.010, hd + 0.010, (zc - zp1) / 2 + 0.003), 0.008), k=0.0)
    out.append(SP("lantern_slabs", slabs, "chalk", "bone:chest", 56, 0.8))
    # the glass: one box inset 1.5 cm behind the post faces (one tall pane per face)
    glass = Sculpt("lantern_glass")
    glass.add(RoundBox((0, yl, (zp0 + zp1) / 2), (hw - 0.015, hd - 0.015, (zp1 - zp0) / 2 + 0.004), 0.010), k=0.0)
    out.append(SP("lantern_glass", glass, "dawnglass", "bone:chest", 36, 0.8))
    # the glowing cores: a tall oval lens on each pane (half sunk into the glass) + the light well's core
    glow = Sculpt("lantern_glow")
    zm, hz = (zp0 + zp1) / 2 + 0.01, (zp1 - zp0) / 2 - 0.07
    for py in (-1, 1):                             # front / back faces (normal -Y / +Y)
        glow.add(Ellipsoid((0, yl + py * (hd - 0.015), zm), (hw - 0.10, 0.011, hz)), k=0.0)
    for px in (-1, 1):                             # side faces
        glow.add(Ellipsoid((px * (hw - 0.015), yl, zm), (0.011, hd - 0.085, hz)), k=0.0)
    glow.add(RoundBox((0, yl, zr - 0.012), (0.050, 0.044, 0.016), 0.010), k=0.0)
    out.append(SP("lantern_glow", glow, "accent", "bone:chest", 150, 0.6))
    # the roof: an eave course + a low four-sided top (ridge flat at the light well), a 3 cm overhang only
    roof = Sculpt("lantern_roof")
    rh, rd = hw + A["eave"], hd + A["eave"]

    def slope(P):                                  # zr at the light well's rim, ze at the eave line
        q = np.abs(P - np.array([0.0, yl, 0.0]))
        f = np.clip(np.maximum((q[:, 0] - 0.07) / (rh - 0.07), (q[:, 1] - 0.065) / (rd - 0.065)), 0, 1)
        return -(ze + (zr - ze) * (1 - f))
    roof.add(RoundBox((0, yl, (zc + zr) / 2), (rh, rd, (zr - zc) / 2), 0.012), k=0.0)
    roof.inter(sdf.Displaced(HalfSpace((0, yl, 0.0), (0, 0, 1), 3.0), slope, 0.2), k=0.006)
    roof.sub(RoundBox((0, yl, zr + 0.02), (0.058, 0.052, 0.04), 0.010), k=0.004)             # the light well
    out.append(SP("lantern_roof", roof, "chalk", "bone:chest", 120, 0.8))
    # four short corner spires on the post lines (to 1.62 front, 1.60 back); never on the hood's axis
    sp = Sculpt("spires")
    for px in (-1, 1):
        for py in (-1, 1):
            c = np.array([px * (hw - po + 0.004), yl + py * (hd - po + 0.004), ze])
            top = 1.62 if py < 0 else 1.60
            sp.add(RoundBox(c + (0, 0, 0.012), (0.026, 0.026, 0.016), 0.008), k=0.0)            # a plinth
            sp.add(RoundCone(c + (0, 0, 0.03), c + (0, 0, top - ze), 0.020, 0.004), k=0.008)
    out.append(SP("spires", sp, "chalk", "bone:chest", 88, 0.6))
    # the pale ash shelf under the box and the carrying frame: two uprights up the back (waist to the shelf's
    # front edge), a cross bar at the waist and two brackets under the shelf's back edge
    sh = Sculpt("shelf")
    sh.add(RoundBox((0, yl, zb - 0.014), (hw + 0.032, hd + 0.03, 0.016), 0.006), k=0.0)
    out.append(SP("shelf", sh, "wood", "bone:chest", 40, 0.8))
    fr = Sculpt("frame_posts")
    for px in (-1, 1):
        a = np.array([px * 0.15, 0.245, 0.64])
        b = np.array([px * 0.15, yl - hd + 0.03, zb - 0.02])
        fr.add(RoundBox((a + b) / 2, (0.026, 0.024, np.linalg.norm(b - a) / 2), 0.008,
                        axes=sdf.frame((b - a) / np.linalg.norm(b - a), (1, 0, 0))), k=0.0)
        c = np.array([px * 0.15, yl + hd - 0.035, zb - 0.025])
        e = np.array([px * 0.15, 0.29, 0.80])
        fr.add(RoundBox((c + e) / 2, (0.020, 0.019, np.linalg.norm(c - e) / 2), 0.007,
                        axes=sdf.frame((c - e) / np.linalg.norm(c - e), (1, 0, 0))), k=0.006)
    fr.add(RoundBox((0, 0.252, 0.70), (0.17, 0.022, 0.026), 0.008, axes=sdf.rot_x(-10)), k=0.008)   # cross bar
    out.append(SP("frame_posts", fr, "wood", "bone:chest", 96, 0.8))


# ══ SERENADE (concept space: front x = (px - 527) / 754.5, z = (1353 - py) / 754.5) ════════════════════════
SER_OPEN = (np.array([-0.035, -0.185, 0.99]), (0.19, 0.19, 0.155), 0.16)
SER_BODY = compose(zmap([(0.0, 0.0), (0.15, 0.15), (1.33, 1.25), (1.6, 1.4789)]), scale_about((0, 0, 0), (0.94, 1, 1)))


def serenade_parts(L: dict) -> list:
    out: list = []
    body = SER_BODY
    hood_tf = compose(shift(dx=0.035), body)
    # ── HOOD: a low broad sand-felt dome on a thick dark rolled collar, the opening a rounded arch ─────────
    hc = np.array([-0.035, 0.03, 1.07])
    hood = Sculpt("hood")
    hood.add(Ellipsoid(hc, (0.238, 0.245, 0.26)), k=0.0)
    hood.add(Ellipsoid(hc + (0, 0.05, -0.12), (0.245, 0.19, 0.145)), k=0.06)          # the nape (above the collar roll)
    hood.add(Ellipsoid(hc + (0, 0.0, 0.03), (0.236, 0.24, 0.23)).displaced(lambda P: 0.003 * NOISE.fbm(P, 22.0, 2), 0.003), k=0.02)
    opening = TaperEllipsoid(*SER_OPEN)                                                      # a rounded arch, not a slit
    hood.sub(opening, k=0.02)
    out.append(SP("hood", hood, "cloth2", "bone:head", 420, to_model=hood_tf))
    # the dark felt rim round the opening (wide, soft: thin over the brow, full at the chin); 48 stations and its
    # own budget (with the collar in one 220-tri part it decimated into an octagon)
    ring = opening.ring(48, grow=1.13, y=-0.32)
    tt = np.linspace(0, 2 * np.pi, 49)[:-1]
    ring = onto(hood, ring, lift=0.006)
    rim = Sculpt("hood_rim")
    pts = np.vstack([ring, ring[:1]])
    rr = 0.026 + 0.016 * np.clip(-np.sin(np.r_[tt, tt[:1]]), 0, 1)
    rim.add(Tube(pts, rr.tolist(), k=0.02), k=0.0)
    out.append(SP("hood_rim", rim, "under", "bone:head", 180, 0.75, to_model=hood_tf))
    # the rolled felt collar: a thick dark roll round the hood's foot, under the chin at the front and riding up
    # to 1.0 m at the back where the sheet shows it above the mantle (it was buried in the hood's nape)
    col = Sculpt("collar")
    ax_c = np.diag([1.0, 1 / 1.18, 1.0]) @ sdf.rot_x(-21.0)
    col.add(Torus((-0.035, 0.035, 0.90), 0.232, 0.050, axes=ax_c, rz=0.044).displaced(
        lambda P: 0.003 * NOISE.fbm(P, 18.0, 2), 0.003), k=0.0)
    out.append(SP("collar", col, "under", "bone:head", 150, 0.8, to_model=hood_tf))
    # the hood mark: an accent crown band round the dome, arching over the opening at the front
    a = np.linspace(0, 2 * np.pi, 41)
    zc = 1.105 + 0.11 * np.clip(-np.sin(a), 0, 1) ** 1.5
    band = np.stack([-0.035 + 0.30 * np.cos(a), 0.03 + 0.30 * np.sin(a), zc], 1)
    band = onto(hood, band, lift=0.003)
    cb = Sculpt("crown_band")
    cb.add(Tube(band, [0.0185] * len(band), k=0.008), k=0.0)
    out.append(SP("crown_band", cb, "accent", "bone:head", 110, 0.55, to_model=hood_tf))
    # the light: one soft ellipsoid at mid-height of the opening, set back ~4 cm (rule 0.2; the first build's pool
    # lay low on the hollow's floor)
    hood_light(np.array([SER_OPEN[0][0], -0.15, 0.975]), out, to_model=hood_tf, radii=(0.072, 0.032, 0.046))

    # ── BODY: wide umber bell, two dark hem bands, a belt, the sand mantle with pointed lapels ───────────────
    tunic = Sculpt("cloak")
    # above the belt the tunic only has to stay inside the mantle (it never shows there): kept 5-7 cm in, so the
    # decimated lows cannot cross (they did: umber patches through the sand mantle)
    prof = [(0.15, 0.452), (0.24, 0.452), (0.40, 0.415), (0.55, 0.37), (0.70, 0.305), (0.80, 0.225), (0.92, 0.15)]
    tunic.add(bell((-0.0, 0.0, 0.0), prof, 0.80, 0.15, 0.93, 0.48).displaced(folds(0.010, 7, zfade=(0.6, 0.2), warp=1.2), 0.01), k=0.0)
    tunic.add(Torus((0.0, 0.0, 0.205), 0.43, 0.052, axes=np.diag([1.0, 1 / 0.80, 1.0]), rz=0.055), k=0.02)     # rolled hem band
    tunic.add(Torus((0.0, 0.0, 0.315), 0.428, 0.02, axes=np.diag([1.0, 1 / 0.80, 1.0])), k=0.012)              # upper band
    tunic.add(Torus((0.0, 0.0, 0.59), 0.355, 0.024, axes=np.diag([1.0, 1 / 0.82, 1.0]), rz=0.022), k=0.012)    # belt
    tunic.inter(HalfSpace((0, 0, 0.15), (0, 0, -1), 1.0), k=0.01)
    out.append(SP("cloak", tunic, "cloth", ("gw_cloak",), 560, to_model=body))
    mantle = Sculpt("mantle")
    # a thick felt capelet (8 cm: a thin shell decimates into a zigzag rim) with ROUNDED shoulders (a convex
    # profile: a straight cone read as a lampshade), soft folds
    mantle.add(capelet((-0.03, 0.02, 0.0), 0.95, 0.23, 0.625, 0.455, 0.08, depth=0.86).displaced(
        folds(0.005, 6, cx=-0.03, cy=0.02, warp=1.0), 0.005), k=0.0)

    def lapels(P):
        """two pointed lapels either side of a V collar notch at the front (the sheet's mantle: the hood's chin
        sits in the V), a smooth edge elsewhere (a scallop here decimated into a torn-paper zigzag)"""
        a = np.arctan2(P[:, 1] - 0.02, P[:, 0] + 0.03) + np.pi / 2       # 0 = the front
        a = (a + np.pi) % (2 * np.pi) - np.pi
        pts = np.zeros(len(P))
        for c in (-0.42, 0.42):
            pts = np.maximum(pts, np.clip(1 - np.abs(a - c) / 0.22, 0, 1) ** 1.6)
        notch = np.clip(1 - np.abs(a) / 0.28, 0, 1) ** 1.3
        # the back hangs lower in a soft U between the frame posts (the sheet: 0.66 m at the centre, 0.78 at the
        # shoulder blades); the first build cut it dead straight at 0.745
        back = _smooth01((np.abs(a) - 1.55) / 1.3) ** 1.2
        return -0.08 * pts + 0.21 * notch - 0.085 * back
    mantle.inter(HalfSpace((0, 0, 0.745), (0, 0, -1), 1.0).displaced(lapels, 0.3), k=0.03)        # a rolled edge
    out.append(SP("mantle", mantle, "cloth2", "auto", 400, to_model=compose(shift(dx=0.03), body)))
    # leather straps from the frame posts over the shoulders (the sheet's back view), laid on the mantle
    st = Sculpt("straps")
    for sx in (-1, 1):
        pts = np.array([[sx * 0.215 - 0.03, 0.30, 0.92], [sx * 0.265 - 0.03, 0.20, 0.905], [sx * 0.285 - 0.03, 0.06, 0.88],
                        [sx * 0.275 - 0.03, -0.08, 0.845], [sx * 0.25 - 0.03, -0.17, 0.80]])
        pts = onto(mantle, pts, lift=0.008)
        st.add(Tube(pts, [0.019] * len(pts), k=0.01), k=0.0)
    out.append(SP("straps", st, "leather", "auto", 70, 0.7, to_model=compose(shift(dx=0.03), body)))

    # ── ARMS, FISTS, LEGS, BOOTS ───────────────────────────────────────────────────────────────────────
    sleeves_mitts(L, out, {"R": (-0.365, -0.36, 0.53), "L": (0.24, -0.36, 0.56)}, r_up=0.092, r_fore=0.085,
                  mitt_r=0.07, body=body, top_dz=-0.025, r_top=0.078)
    boots_legs(L, out, (0.205, -0.04, 0.055), (0.085, 0.115, 0.055), 0.08)

    hammer_serenade(L, out, body)
    lantern_serenade(L, out, body)
    return out


def hammer_serenade(L, out, body):
    """The sheet: pommel (-0.55, 0.48), the haft through both fists to an ironstone drum head centred (0.475,
    0.62), 0.29 across x 0.40 tall; two sandstone bands, a lampresin window on its outer face. Sculpted on the
    MODEL haft line; the paint pose moves it back onto the sheet's (a body-warp inverse + a small shift)."""
    d = np.asarray(L["haft"], float)
    d /= np.linalg.norm(d)
    g = np.asarray(L["grip_r"], float)
    up = np.array([-d[2], 0.0, d[0]])
    ax = np.stack([d, np.cross(up, d), up])
    pom = g - d * 0.20
    head_c = g + d * 0.79
    # model -> concept: the head and haft go back onto the painted hammer (fit by eye on the sheet)
    cg = np.array([-0.36, -0.36, 0.53])                 # the sheet's right fist on the haft
    mg = invert(body)(g[None])[0]
    pose = compose(invert(body), shift(*(cg - mg)))
    haft = Sculpt("haft")
    haft.add(Capsule(pom + d * 0.04, head_c, 0.027).displaced(lambda P: 0.0025 * np.sin(np.arctan2(P[:, 1] - g[1], P[:, 2] - g[2]) * 7), 0.0025), k=0.0)
    out.append(SP("haft", haft, "wood_dark", "bone:prop.R", 60, 0.7, to_concept=pose))
    pm = Sculpt("pommel")
    pm.add(Capsule(pom - d * 0.012, pom + d * 0.045, 0.044).displaced(chips(0.004, 14.0), 0.004), k=0.0)
    out.append(SP("pommel", pm, "ironstone", "bone:prop.R", 40, 0.6, to_concept=pose))
    hd = Sculpt("hammer_head")
    hd.add(Capsule(head_c - up * 0.16, head_c + up * 0.16, 0.125).displaced(chips(0.008, 7.0), 0.008), k=0.0)
    hd.inter(RoundBox(head_c, (0.2, 0.2, 0.185), 0.03, axes=ax), k=0.02)                 # flat drum faces
    for sz in (-1, 1):
        hd.add(Torus(head_c + up * sz * 0.155, 0.13, 0.026, axes=ax), k=0.012)          # heavy cap rims
    out.append(SP("hammer_head", hd, "ironstone", "bone:prop.R", 200, to_concept=pose))
    bands = Sculpt("hammer_bands")
    for sz in (-1, 1):
        bands.add(Torus(head_c + up * sz * 0.075, 0.13, 0.024, axes=ax, rz=0.028), k=0.0)
    bands.add(Torus(head_c - d * 0.13, 0.04, 0.013, axes=sdf.frame(d)), k=0.006)         # haft collar
    out.append(SP("hammer_bands", bands, "sandstone", "bone:prop.R", 80, 0.7, to_concept=pose))
    win = Sculpt("hammer_window")
    wc_ = head_c + d * 0.122
    win.add(Ellipsoid(wc_, (0.012, 0.055, 0.055), axes=ax), k=0.0)
    out.append(SP("hammer_window", win, "accent", "bone:prop.R", 30, 0.6, to_concept=pose))


def lantern_serenade(L, out, body):
    """The drum lantern (sheet: lower ironstone band 1.14-1.26 m 0.75 m across, lampresin windows 1.26-1.40,
    upper band 1.40-1.475, a felt-and-strap lid to 1.56; walnut posts splay from the drum down to the belt).
    Model: narrowed to 0.66 m (an oval drum, 0.52 m deep), 2 cm lower, centred on the back."""
    yl = L["lantern_y"]
    xc = 0.015
    sx, sy = 0.88, 0.62
    # concept -> model: centred, narrowed to 0.66 m, squeezed to 1.195-1.545 m (clear of the hood's back)
    lt = compose(shift(dx=-xc), scale_about((0, yl, 0), (sx, 1, 1)), zmap([(1.14, 1.195), (1.56, 1.545)]))
    ax_oval = np.diag([1.0, 1.0 / sy, 1.0])
    R0 = 0.37
    bands = Sculpt("drum_bands")                     # the two ironstone bands (each a genus-1 ring)
    bands.add(Torus((xc, yl, 1.20), R0 - 0.01, 0.06, axes=ax_oval, rz=0.058).displaced(chips(0.008, 9.0), 0.008), k=0.0)
    bands.add(Torus((xc, yl, 1.438), R0 - 0.025, 0.052, axes=ax_oval, rz=0.04).displaced(chips(0.007, 9.0), 0.007), k=0.0)
    out.append(SP("drum_bands", bands, "ironstone", "bone:chest", 190, 0.9, to_model=lt))
    ups = Sculpt("drum_posts")                       # ironstone uprights between the windows (separate bars)
    for i in range(8):
        a = 2 * math.pi * (i + 0.5) / 8 - math.pi / 2
        c = np.array([xc + (R0 - 0.035) * math.cos(a), yl + (R0 - 0.035) * sy * math.sin(a), 1.33])
        ups.add(RoundBox(c, (0.020, 0.022, 0.085), 0.008, axes=sdf.rot_z(math.degrees(a) + 90)), k=0.0)
    out.append(SP("drum_posts", ups, "ironstone", "bone:chest", 100, 0.8, to_model=lt))
    glow = Sculpt("drum_glow")
    # the windows: the glowing ring flush with the posts' faces (8 cm back inside the bands, the upper band hid
    # most of it from the game camera)
    glow.add(Lathe((xc, yl, 0), lambda r, z: np.maximum(r - (R0 - 0.018), np.maximum(1.24 - z, z - 1.42)), R0, 1.22, 1.44,
                   axes=ax_oval), k=0.0)
    out.append(SP("drum_glow", glow, "accent", "bone:chest", 80, 0.8, to_model=lt))
    # no oculus in the lid (the sheet's lid is a closed padded dome): a glowing disc set in a ring of converging
    # straps read as a faceted gem from the game camera, round or not (bible: no gems). The window ring shows
    # over the hood, from the sides and from the 52-degree camera.
    lid = Sculpt("drum_lid")

    def lid_prof(r, z):
        q = np.sqrt((r / 0.30) ** 2 + ((z - 1.47) / 0.09) ** 2)
        return np.maximum((q - 1.0) * 0.09, 1.465 - z)
    lid.add(Lathe((xc, yl, 0), lid_prof, 0.32, 1.45, 1.57, axes=ax_oval).displaced(lambda P: 0.003 * NOISE.fbm(P, 20.0, 2), 0.003), k=0.0)
    out.append(SP("drum_lid", lid, "cloth2", "bone:chest", 130, 0.9, to_model=lt))
    straps = Sculpt("lid_straps")
    for i in range(4):
        a = math.pi / 4 + i * math.pi / 2
        pts = []
        for tt in np.linspace(0.0, 1.0, 6):
            r = 0.30 * tt
            pts.append((xc + r * math.cos(a), yl + r * sy * math.sin(a), 1.47 + 0.09 * math.sqrt(max(0.0, 1 - tt * tt)) + 0.006))
        straps.add(Tube(np.array(pts), [0.015] * len(pts), k=0.005), k=0.005)
    straps.add(Ellipsoid((xc, yl, 1.562), (0.036, 0.036, 0.016)), k=0.008)              # the button where they cross
    out.append(SP("lid_straps", straps, "wood", "bone:chest", 72, 0.6, to_model=lt))     # walnut (light side)
    # walnut posts from the drum's underside down to the belt at the back (model space; the paint follows the
    # sheet's back view: x +-0.265 at z 1.18 -> +-0.12 at z 0.64)
    posts = Sculpt("frame_posts")
    for px in (-1, 1):
        a = np.array([px * 0.235, yl - 0.08, 1.215])
        b = np.array([px * 0.115, 0.255, 0.585])
        posts.add(RoundBox((a + b) / 2, (0.026, 0.022, np.linalg.norm(b - a) / 2), 0.008,
                           axes=sdf.frame((b - a) / np.linalg.norm(b - a), (1, 0, 0))), k=0.0)
    pose = segment_pose((0.235, 0, 1.215), (0.115, 0, 0.585), (0.265 + xc, 0, 1.18), (0.12 + xc, 0, 0.64))
    pose_l = segment_pose((-0.235, 0, 1.215), (-0.115, 0, 0.585), (-0.265 + xc, 0, 1.18), (-0.12 + xc, 0, 0.64))

    def post_pose(P):
        P = _arr(P)
        return np.where(P[:, :1] >= 0, pose(P), pose_l(P))
    out.append(SP("frame_posts", posts, "wood_dark", "bone:chest", 90, 0.8, to_concept=post_pose))


# ── grading, top plates, tints ─────────────────────────────────────────────────────────────────────────
GRADE = {
    # wick_common.graded_projection: painted glow refilled (the accent geometry carries every light), the
    # Serenade sheet's saturation pulled down and its top band lifted (brief §5.2)
    "aubade": dict(sat=1.0, top_lift=1.0, glow=(0.84, 0.18)),
    "serenade": dict(sat=0.62, top_lift=1.05, glow=(0.78, 0.45)),
}
_A_LANT = (0.0, LAYOUT["aubade"]["lantern_y"])
_S_LANT = (0.015, LAYOUT["serenade"]["lantern_y"])
_AL = AUB_LANT
# procedural-painterly parts (gw_proc): every hard-surface prop and the trims. Projected, they smeared: a part
# whose sculpt runs where the sheet paints something else takes that paint (the sheet's X binding across the chalk
# head, its haft across the stoles, streaks down the sides of the drum bands). Painted here from the palette with
# the sheet's value structure (lit tops, key from the front-left, darker undersides), brush-scale mottling, chips,
# cracks, stone courses and wood grain, they stay crisp at any distance.
_CHALK = {"kind": "stone", "hex": "#D6D3CA", "light": (0.80, 1.07), "cracks": 0.07, "crack_t": 0.72, "freq": 6.0,
          "mottle": 0.05}
_ASH = {"kind": "wood", "hex": "#B9AB93", "light": (0.82, 1.08)}
_IRON = {"kind": "stone", "hex": "#5C5149", "light": (0.80, 1.30), "cracks": 0.18, "freq": 9.0, "chip_light": 0.30}
_WALNUT = {"kind": "wood", "hex": "#5A4436", "light": (0.82, 1.18)}
PAINT = {
    "aubade": {
        # own-region erosion (plate cells of 2 px = ~5 mm): wide where the sheet's outline runs inside the sculpt
        "gw_erode": {"*": 4, "hood": 7, "boot_L": 2, "boot_R": 2, "mitt_L": 3, "mitt_R": 3},
        "gw_proc": {
            "legs": {"kind": "flat"},
            # the hood flat-painterly (the sheet's own look: a smooth blue-grey cowl, lighter on the crown):
            # projected, its sides took the chalk rim and the ash frame painted around / behind it on the sheet
            "hood": {"kind": "flat", "hex": "#9AA8B8", "light": (0.80, 1.20), "key": 0.07, "noise": 0.06},
            "hood_rim": dict(_CHALK, light=(0.78, 1.06)), "knob": _CHALK, "clasp": _CHALK, "pommel": _CHALK,
            "stole": {"kind": "felt", "hex": "#DAD6CC", "light": (0.84, 1.05), "nap": 0.025},
            "hammer_head": dict(_CHALK, hex="#C9C4B9", light=(0.74, 1.05), cracks=0.10, chip_light=0.0),
            "hammer_bind": {"kind": "felt", "hex": "#8C97A2", "light": (0.80, 1.10), "bands": 0.35},
            "grip": {"kind": "felt", "hex": "#8C97A2", "light": (0.80, 1.10), "bands": 0.35},
            "haft": _ASH, "shelf": _ASH,
            "frame_posts": dict(_ASH, segs="frame"),
            "lantern_bars": _CHALK, "lantern_slabs": _CHALK, "spires": dict(_CHALK, cracks=0.05),
            "lantern_roof": _CHALK,
            "lantern_glass": {"kind": "glass", "hex": "#A9C4DC",
                              "box": (0.0, _A_LANT[1], _AL["hw"] - 0.015, _AL["hd"] - 0.015, *_AL["z_pane"])},
        },
        "gw_top": {
            "lantern_roof": {"kind": "roof", "box": (_A_LANT[0], _A_LANT[1], _AL["hw"] + _AL["eave"], _AL["hd"] + _AL["eave"]),
                             "from": 0.5},
            "hood": {"kind": "patch", "rect": (-0.09, 1.125, 0.05, 1.185), "tile": 0.10, "from": 0.6},
            "sleeve_L": {"kind": "patch", "rect": (-0.385, 0.58, -0.32, 0.68), "tile": 0.08, "from": 0.6},
            "sleeve_R": {"kind": "patch", "rect": (-0.385, 0.58, -0.32, 0.68), "tile": 0.08, "from": 0.6},
        },
        # ghost paint the projected cloth must not take (CIE L*a*b* tests on the plate): the sheet's warm ash haft
        # and frame (b* > 3), its chalk stoles / hammer (L* > 80), the black gap of its open robe (L* < 20)
        "gw_exclude": {"cloak": {"b_gt": 3.0, "L_gt": 80.0, "L_lt": 20.0},
                       "sleeve_L": {"b_gt": 3.0, "L_gt": 80.0}, "sleeve_R": {"b_gt": 3.0, "L_gt": 80.0},
                       "mitt_L": {"b_gt": 3.0, "L_gt": 80.0}, "mitt_R": {"b_gt": 3.0, "L_gt": 80.0}},
        # (part, zone (z0, z1) in concept space or None, target hex (None = the part's role), strength)
        "gw_tints": [("cloak", (0.0, 0.175), "#3E434A", 0.85), ("cloak", (0.175, 2.0), "#6E7A86", 0.65),
                     ("sleeve_L", None, "#6E7A86", 0.55), ("sleeve_R", None, "#6E7A86", 0.55)],
        # the hood's hollow (the opening recess of aubade_parts, its taper too): ink-dark; the cloak's neck that
        # shows at the back of the hollow is inked as well (it read as a chin)
        "gw_ink": [("hood", AUB_OPEN[0], (0.175, 0.185, 0.182), "#15171B", AUB_OPEN[2]),
                   ("cloak", AUB_OPEN[0], (0.185, 0.20, 0.19), "#15171B", AUB_OPEN[2])],
        # the bottom quarter measured L* 50-54 at the game camera (lineup_qa; target 30-38): darken the lower bell,
        # the stoles' lower ends and the boots; the chalk hammer (the job read at hip height) is left alone
        "gw_ramp": [{"stops": [(0.0, 0.60), (0.18, 0.68), (0.36, 0.82), (0.55, 0.96), (0.7, 1.0)],
                     "skip": ("hammer_head", "hammer_bind", "haft", "grip", "pommel")},
                    # the pale stoles fade into the dark hem band (front bottom quarter L* 52 at the game camera)
                    {"stops": [(0.15, 0.62), (0.35, 0.80), (0.55, 1.0)], "only": ("stole",)}],
    },
    "serenade": {
        "gw_erode": {"*": 4, "hood": 6, "boot_L": 2, "boot_R": 2, "mitt_L": 3, "mitt_R": 3},
        "gw_proc": {
            "legs": {"kind": "flat"},
            # the mantle flat-painterly: the sheet paints tunic and collar where the shell sits (its arms cover the
            # shoulders), and the own-region fill left hard-edged sand/umber patches on it
            "mantle": {"kind": "flat", "light": (0.80, 1.10), "key": 0.05},
            "hood": {"kind": "flat", "hex": "#C9AF8A", "light": (0.78, 1.12), "key": 0.07, "noise": 0.06},
            "hood_rim": {"kind": "felt", "hex": "#3E332C", "light": (0.85, 1.30), "nap": 0.06},
            "collar": {"kind": "felt", "hex": "#3E332C", "light": (0.80, 1.35), "nap": 0.06},
            "straps": {"kind": "felt", "hex": "#4A3A2F", "light": (0.80, 1.25), "nap": 0.03},
            "haft": _WALNUT, "pommel": _IRON,
            "hammer_head": dict(_IRON, blocks="hammer"),
            "hammer_bands": {"kind": "stone", "hex": "#C3A47A", "light": (0.80, 1.10), "cracks": 0.10, "freq": 10.0},
            # the drum is the top quarter at the game camera (L* 51-54, the bible's top band 70-85): its ironstone
            # is painted a weathered, lighter grey-brown with lit tops; the lid's felt lit
            "drum_bands": dict(_IRON, hex="#74695F", light=(0.82, 1.38), chip_light=0.35, blocks="drum"),
            "drum_posts": dict(_IRON, hex="#6E635A"),
            "drum_lid": {"kind": "felt", "hex": "#CDB48F", "light": (0.86, 1.12), "nap": 0.05},
            "lid_straps": {"kind": "wood", "hex": "#8A6C4E", "light": (0.85, 1.20)},
            "frame_posts": dict(_WALNUT, segs="posts"),
        },
        "gw_top": {
            "drum_lid": {"kind": "lid", "disc": (_S_LANT[0], _S_LANT[1], 0.30, 0.30 * 0.62), "from": 0.35},
            "hood": {"kind": "patch", "rect": (-0.16, 1.235, 0.04, 1.30), "tile": 0.10, "from": 0.6},
            "mantle": {"kind": "patch", "rect": (-0.36, 0.78, -0.22, 0.88), "tile": 0.10, "from": 0.55},
        },
        # the sheet's sand mantle hangs lower than the model's at the back (a sand ghost on the tunic): the
        # projected umber cloth never takes sand-light paint
        "gw_exclude": {"cloak": {"L_gt": 55.0}, "sleeve_L": {"L_gt": 58.0}, "sleeve_R": {"L_gt": 58.0}},
        "gw_tints": [("cloak", None, "#7E6553", 0.6)],
        "gw_ink": [("hood", SER_OPEN[0], (0.20, 0.20, 0.165), "#17150F", SER_OPEN[2]),
                   ("hood_rim", SER_OPEN[0], (0.185, 0.20, 0.15), "#17150F", SER_OPEN[2])],
        "gw_inner": {"mantle": ((-0.03, 0.02), 0.45)},
        "gw_ramp": [],
    },
}
# wood grain directions: per part, the segments (paint space) whose nearest one gives a texel its grain axis
_SEGS = {
    "frame": [((s * 0.15, 0.245, 0.64), (s * 0.15, 0.36, 0.935)) for s in (-1, 1)] +
             [((s * 0.15, 0.595, 0.93), (s * 0.15, 0.29, 0.80)) for s in (-1, 1)] +
             [((-0.17, 0.252, 0.70), (0.17, 0.252, 0.70))],
    "posts": [((s * 0.265 + 0.015, 0.34, 1.18), (s * 0.12 + 0.015, 0.255, 0.64)) for s in (-1, 1)],
}


# ── pipeline hooks (installed once, keyed by the spec's PROJECTION: inert for every other build) ──────────
def _install() -> None:
    """Hook the shared pipeline (idempotent; inert for every other build):
      project.paint_object  -> paint_greatwick() when the PROJECTION carries `gw_pose`
      pipeline.bind_part    -> the cloak / sleeve binders for ("gw_cloak",) / ("gw_arm", side) binds."""
    from common import pipeline
    from common.hifi import project
    if not getattr(project.paint_object, "_greatwick", False):
        orig = project.paint_object

        def paint_object(obj, size, cfg, names, part_attr="vale_part", log=print, return_maps=False):
            if not cfg.get("gw_pose") and "gw_pose" not in cfg:
                return orig(obj, size, cfg, names, part_attr=part_attr, log=log, return_maps=return_maps)
            img, maps = paint_greatwick(obj, size, cfg, names, part_attr, log)
            return (img, maps) if return_maps else img

        paint_object._greatwick = True
        project.paint_object = paint_object
    if not getattr(pipeline.bind_part, "_greatwick", False):
        orig_bind = pipeline.bind_part

        def bind_part(ctx, part, obj, body_low=None):
            b = part.bind
            if isinstance(b, tuple) and b and b[0] == "gw_cloak":
                return bind_cloak(ctx, obj)
            if isinstance(b, tuple) and b and b[0] == "gw_arm":
                return bind_arm(ctx, obj, b[1])
            return orig_bind(ctx, part, obj, body_low)

        bind_part._greatwick = True
        pipeline.bind_part = bind_part
    from common import export
    if not getattr(export.optimize, "_greatwick", False):
        orig_opt = export.optimize

        def optimize(path, *a, **kw):
            res = orig_opt(path, *a, **kw)
            out = kw.get("out") or (a[0] if a else None) or path
            if os.path.basename(out).startswith("greatwick_"):
                res["metallic_zero"] = glb_metallic_zero(out)
            return res

        optimize._greatwick = True
        export.optimize = optimize


def glb_metallic_zero(path: str) -> int:
    """Bible: every material has metalness 0. The exporter writes no metallicFactor (glTF default 1.0) and the
    lossy-WebP ORM's metal channel picks up chroma noise from AO / roughness (up to 107/255 on stone): set
    metallicFactor 0 on every material so the texture's B channel is ignored. Returns the materials patched."""
    import json
    import struct
    with open(path, "rb") as fh:
        data = fh.read()
    magic, ver, _ = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67:
        return 0
    jlen, jtype = struct.unpack_from("<II", data, 12)
    js = json.loads(data[20:20 + jlen].decode("utf-8"))
    rest = data[20 + jlen:]
    n = 0
    for m in js.get("materials", []):
        pbr = m.setdefault("pbrMetallicRoughness", {})
        if pbr.get("metallicFactor", 1.0) != 0.0:
            pbr["metallicFactor"] = 0.0
            n += 1
    raw = json.dumps(js, separators=(",", ":")).encode("utf-8")
    raw += b" " * ((4 - len(raw) % 4) % 4)
    body = struct.pack("<II", len(raw), jtype) + raw + rest
    with open(path, "wb") as fh:
        fh.write(struct.pack("<III", magic, ver, 12 + len(body)) + body)
    return n


# ── the paint pass ─────────────────────────────────────────────────────────────────────────────────────
# project.paint (the shared pass) samples the plate wherever a texel is the first hit of the projection ray.
# Where the sculpt's silhouette runs a little outside the painted one (a hood 1-2 cm wider than the sheet's,
# with the lantern painted behind it) that texel takes the neighbour's paint: pale glass smeared on blue
# cloth. Here a texel takes the plate only inside its OWN part's region of the plate, eroded by a margin
# (per part); everything else takes the nearest own-region paint. Up-facing surfaces the 52-degree camera
# sees first (roof, lid, hood crowns, shoulders) take procedural / tiled-patch TOP paint instead of streaks.
# Parts can be painted FLAT-PAINTERLY (role colour, brush-scale value noise, top light). The visibility grid
# is cropped to the model (4-8x faster than the shared pass on these plates).
class _Vis:
    def __init__(self, obj, plates, step: int, part_attr: str):
        from mathutils import Vector
        from mathutils.bvhtree import BVHTree
        from common.hifi import project
        me = obj.data
        verts = [v.co.copy() for v in me.vertices]
        polys = [tuple(p.vertices) for p in me.polygons]
        bvh = BVHTree.FromPolygons(verts, polys)
        pop = project.poly_parts(me, part_attr)
        co = np.array([v[:] for v in verts])
        self.step = step
        self.depth, self.part, self.o = {}, {}, {}
        for side, y0, d in (("front", -50.0, Vector((0, 1, 0))), ("back", 50.0, Vector((0, -1, 0)))):
            xs = [co[:, 0].min() - 0.03, co[:, 0].max() + 0.03]
            px, py = plates.to_px(side, np.array(xs), np.array([co[:, 2].max() + 0.03, max(0.0, co[:, 2].min() - 0.03)]))
            i0, i1 = int(min(px)) // step, int(max(px)) // step + 1
            j0, j1 = int(py[0]) // step, int(py[1]) // step + 1
            gx = (np.arange(i0, i1) + 0.5) * step
            gy = (np.arange(j0, j1) + 0.5) * step
            x, _ = plates.to_world(side, gx, np.zeros_like(gx))
            _, zz = plates.to_world(side, np.zeros_like(gy), gy)
            dep = np.full((len(gy), len(gx)), np.nan, dtype=np.float32)
            pid = np.full((len(gy), len(gx)), -1, dtype=np.int16)
            for j in range(len(gy)):
                zj = float(zz[j])
                for i in range(len(gx)):
                    hit = bvh.ray_cast(Vector((float(x[i]), y0, zj)), d)
                    if hit[0] is not None:
                        dep[j, i] = hit[0].y
                        pid[j, i] = pop[hit[2]]
            self.depth[side], self.part[side], self.o[side] = dep, pid, (i0, j0)

    def cell(self, side, px, py):
        i0, j0 = self.o[side]
        d = self.depth[side]
        j = np.clip((np.asarray(py) / self.step).astype(np.int64) - j0, 0, d.shape[0] - 1)
        i = np.clip((np.asarray(px) / self.step).astype(np.int64) - i0, 0, d.shape[1] - 1)
        return j, i


def _nearest(valid: np.ndarray):
    """project.nearest_index on a grid padded to a power-of-two square (its jump flood assumes the grid is at
    least as large as its first step in both directions; the cropped visibility grids are not)."""
    from common.hifi import project
    h, w = valid.shape
    n = 1 << int(math.ceil(math.log2(max(h, w, 2))))
    pad = np.zeros((n, n), dtype=bool)
    pad[:h, :w] = valid
    iy, ix = project.nearest_index(pad)
    return np.clip(iy[:h, :w], 0, h - 1), np.clip(ix[:h, :w], 0, w - 1)


def _erode(m: np.ndarray, r: int) -> np.ndarray:
    for _ in range(max(0, r)):
        e = m.copy()
        e[1:, :] &= m[:-1, :]
        e[:-1, :] &= m[1:, :]
        e[:, 1:] &= m[:, :-1]
        e[:, :-1] &= m[:, 1:]
        m = e
    return m


def _smooth01(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


def paint_greatwick(obj, size, cfg, names, part_attr, log):
    import time
    from common.hifi import project
    t0 = time.time()
    cache = os.path.join(scene.CACHE_DIR, "concept")
    pose = cfg.get("gw_pose") or {}
    me = obj.data
    n = len(me.vertices)
    co = np.empty(n * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(n, 3)
    pv = np.zeros(n, dtype=np.int64)
    a = me.attributes.get(part_attr)
    if a is not None and a.domain == "POINT":
        a.data.foreach_get("value", pv)
    moved = co.astype(np.float64).copy()
    for i, nm in enumerate(names):
        f = pose.get(nm)
        sel = pv == i
        if f is not None and sel.any():
            moved[sel] = f(moved[sel])
    me.vertices.foreach_set("co", moved.astype(np.float32).ravel())
    me.update()
    try:
        plates = project.Plates(cache, cfg["concept"], cfg["height"])
        maps = project.rasterize(obj, size, part_attr)
        vis = _Vis(obj, plates, 2, part_attr)
    finally:
        me.vertices.foreach_set("co", co.ravel())
        me.update()
    log(f"greatwick paint: paint pose on {len(pose)} parts, raster + visibility {time.time() - t0:.1f}s")
    P, N, part = maps["P"], maps["N"], maps["part"]
    have = part >= 0
    idx = np.nonzero(have)
    p, nrm, k = P[idx], N[idx], part[idx].astype(np.int64)
    erode = cfg.get("gw_erode") or {}
    pal = cfg.get("gw_palette") or {}
    roles = cfg.get("gw_roles") or {}
    procp = cfg.get("gw_proc") or {}
    excl = cfg.get("gw_exclude") or {}
    cols, ok = {}, {}
    mask_img = None
    if cfg.get("gw_mask"):
        mask_img = project.load_rgb(os.path.join(cache, cfg["gw_mask"]))[..., 0] > 0.5
    st = np.abs(nrm[:, 0]) / (np.abs(nrm[:, 0]) + np.abs(nrm[:, 1]) + 1e-6)
    ws = _smooth01((st - 0.72) / 0.24)[:, None]
    for side in ("front", "back"):
        img = plates.img[side]
        soft = project.blur(img, 3.0)
        px, py = plates.to_px(side, p[:, 0], p[:, 2])
        c = project.bilinear(img, px, py) * (1 - ws) + project.bilinear(soft, px, py) * ws
        j, i = vis.cell(side, px, py)
        dep = vis.depth[side][j, i]
        hid = vis.part[side][j, i]
        if side == "front":
            hidden = ~(p[:, 1] <= np.nan_to_num(dep, nan=1e9) + 0.02)
        else:
            hidden = ~(p[:, 1] >= np.nan_to_num(dep, nan=-1e9) - 0.02)
        s_ = vis.step
        i0, j0 = vis.o[side]
        sh = vis.part[side].shape
        small = img[j0 * s_ + s_ // 2::s_, i0 * s_ + s_ // 2::s_][:sh[0], :sh[1]]
        inside = None
        if mask_img is not None:                     # the sheet's painted figure (the cut), 2 cells in from its edge
            mm = mask_img[j0 * s_ + s_ // 2::s_, i0 * s_ + s_ // 2::s_][:sh[0], :sh[1]]
            inside = np.zeros(sh, dtype=bool)
            inside[:mm.shape[0], :mm.shape[1]] = mm
            inside = _erode(inside, 2)
        lab = _lab(small) if excl else None
        okk = np.ones(len(k), dtype=bool)
        for kk in np.unique(k):
            sel = k == kk
            nm = names[kk]
            reg = _erode(vis.part[side] == kk, int(erode.get(nm, erode.get("*", 4))))
            if inside is not None and nm not in (cfg.get("gw_unmasked") or ()):
                rm = reg & inside
                if rm.sum() > max(8, 0.25 * reg.sum()):
                    reg = rm
            if nm in excl and reg.any():               # ghost paint (another object on the sheet): never sampled
                ex = _excluded(lab, excl[nm])
                if (reg & ~ex).sum() > max(6, 0.15 * reg.sum()):
                    reg = reg & ~ex
            if not reg.any():
                reg = vis.part[side] == kk
            if not reg.any():
                okk[sel] = False                     # never seen from this side: the other plate paints it
                continue
            bad = sel & (hidden | ~reg[j, i])
            if bad.any():
                iy, ix = _nearest(reg)
                fill = project.blur(small[iy, ix], 1.0)
                jj, ii = j[bad], i[bad]
                c[bad] = fill[jj, ii]
        cols[side], ok[side] = c, okk
    wb = _smooth01((nrm[:, 1] + 0.25) / 0.5)
    wb = np.where(~ok["front"] & ok["back"], 1.0, np.where(ok["front"] & ~ok["back"], 0.0, wb))
    col = cols["front"] * (1 - wb[:, None]) + cols["back"] * wb[:, None]
    neither = ~ok["front"] & ~ok["back"]
    col = _tint_texels(col, p, k, names, cfg, log)
    # procedural-painterly parts (and parts no plate shows: flat in their role colour)
    for kk in np.unique(k):
        nm = names[kk]
        sel = k == kk
        if nm in procp or (neither & sel).any():
            spec = procp.get(nm) or {"kind": "flat"}
            spec = dict(spec, hex=spec.get("hex") or pal.get(roles.get(nm, ""), "#808080"))
            col[sel] = PROC_PAINTERS[spec["kind"]](p[sel], nrm[sel], spec)
    # the hood hollows: ink (the opening's tapered volume grown a little), deepest at the back, barely lighter at
    # the lip (a pale lip ring read as lips round a mouth)
    for item in cfg.get("gw_ink") or []:
        nm, c0, rr, hexc = item[:4]
        taper = item[4] if len(item) > 4 else 0.0
        if nm not in names:
            continue
        sel = k == names.index(nm)
        d = p[sel] - np.asarray(c0)
        d[:, 0] /= np.clip(1.0 - taper * d[:, 2] / rr[2], 0.3, 2.0)
        q = np.linalg.norm(d / np.asarray(rr), axis=1)
        w = _smooth01((1.07 - q) / 0.06)
        depth = _smooth01((p[sel, 1] - c0[1] + 0.02) / 0.12)                              # 0 at the lip -> 1 deep
        ink = np.asarray(scene.hex_srgb(hexc), np.float32)
        lip = np.clip(ink * 1.5, 0, 1)
        tone = lip[None, :] * (1 - depth[:, None]) + ink[None, :] * depth[:, None]
        col[sel] = col[sel] * (1 - w[:, None]) + tone * w[:, None]
    # shells seen from inside (the mantle's lining between its lapels): in shadow
    for nm, (cxy, dk) in (cfg.get("gw_inner") or {}).items():
        if nm not in names:
            continue
        sel = k == names.index(nm)
        rad = p[sel, :2] - np.asarray(cxy)
        inward = -(nrm[sel, 0] * rad[:, 0] + nrm[sel, 1] * rad[:, 1]) / (np.linalg.norm(rad, axis=1) + 1e-6)
        w = _smooth01((inward + 0.05) / 0.3)
        col[sel] = col[sel] * (1 - w[:, None] * (1 - dk))
    # top paint on up-facing texels
    for nm, spec in (cfg.get("gw_top") or {}).items():
        if nm not in names:
            continue
        sel = k == names.index(nm)
        if not sel.any():
            continue
        wt = _smooth01((nrm[sel, 2] - spec.get("from", 0.45)) / spec.get("width", 0.35))[:, None]
        tcol = TOP_PAINTERS[spec["kind"]](p[sel], nrm[sel], spec, plates, pal)
        col[sel] = col[sel] * (1 - wt) + tcol * wt
    # the value ramp (brief §2.4, the bible's light-top / dark-feet bands): a gain by height (paint-pose z), per
    # part set; the projection replaces the procedural base, so the materials' own gradient never applies here
    for rp in cfg.get("gw_ramp") or []:
        zs = np.array([q[0] for q in rp["stops"]])
        gs = np.array([q[1] for q in rp["stops"]])
        for kk in np.unique(k):
            nm = names[kk]
            if nm in rp.get("skip", ()) or ("only" in rp and nm not in rp["only"]):
                continue
            sel = k == kk
            col[sel] = np.clip(col[sel] * np.interp(p[sel, 2], zs, gs)[:, None], 0, 1)
    out = np.zeros((size, size, 3), dtype=np.float32)
    out[idx] = col
    iy, ix = project.nearest_index(have)
    out = out[iy, ix]
    log(f"greatwick paint: done in {time.time() - t0:.1f}s")
    return out, maps


def _top_patch(p, nrm, spec, plates, pal):
    """Tiled concept paint: a rectangle of the plate (side, (x0, z0, x1, z1) in concept metres), mirror-tiled
    over the part's X/Y, with a soft key-light falloff (front-left lighter)."""
    from common.hifi import project
    side = spec.get("side", "front")
    x0, z0, x1, z1 = spec["rect"]
    t = spec.get("tile", 0.14)

    def tri(u):
        u = np.mod(u, 2.0)
        return np.where(u > 1.0, 2.0 - u, u)
    u = tri((p[:, 0] + 0.37 * p[:, 1]) / t)
    v = tri((p[:, 1] - 0.21 * p[:, 0]) / t)
    px, py = plates.to_px(side, x0 + u * (x1 - x0), z0 + v * (z1 - z0))
    c = project.bilinear(project.blur(plates.img[side], 1.5), px, py)
    light = 1.0 + spec.get("key", 0.08) * np.clip(-nrm[:, 1] * 0.6 - nrm[:, 0] * 0.4, -1, 1)
    return np.clip(c * spec.get("gain", 1.0) * light[:, None], 0, 1)


def _top_roof(p, nrm, spec, plates, pal):
    """Aubade roof from above: four chalk hip facets, slab courses parallel to the eaves, lighter hips, chipped
    stone; the facet facing the key (front-left) lightest."""
    cx, cy, hx, hy = spec["box"]
    base = np.asarray(scene.hex_srgb(spec.get("hex") or pal.get("chalk", "#D6D3CA")), np.float32)
    qx, qy = (p[:, 0] - cx) / hx, (p[:, 1] - cy) / hy
    f = np.maximum(np.abs(qx), np.abs(qy))                  # 0 at the ridge, 1 at the eave
    facet = np.where(np.abs(qx) > np.abs(qy), np.where(qx > 0, 0, 1), np.where(qy < 0, 2, 3))
    shade = np.array([0.93, 1.04, 1.07, 0.88])[facet]        # +x (right, away from key), -x (key side), front, back
    course = 0.94 + 0.06 * _smooth01(np.abs(np.sin(f * math.pi * 5.0)) * 3.0)
    hip = 1.0 + 0.08 * np.clip(1 - np.abs(np.abs(qx) - np.abs(qy)) * 14.0, 0, 1)
    eave = 1.0 - 0.10 * _smooth01((f - 0.9) / 0.1)
    noise = 1.0 + 0.06 * NOISE.fbm(p, 14.0, 3) - 0.08 * np.clip(NOISE.ridged(p, 22.0, 2) - 0.55, 0, 1) * 3
    v = shade * course * hip * eave * noise
    tint = np.array([1.0, 1.0, 1.02], np.float32)
    return np.clip(base[None, :] * tint * v[:, None], 0, 1)


def _top_lid(p, nrm, spec, plates, pal):
    """Serenade lid from above: sand felt, soft radial dome light, felt nap noise, a darker rim ring."""
    cx, cy, r, ry = spec["disc"]
    base = np.asarray(scene.hex_srgb(spec.get("hex") or pal.get("cloth2", "#C9AF8A")), np.float32)
    q = np.sqrt(((p[:, 0] - cx) / r) ** 2 + ((p[:, 1] - cy) / ry) ** 2)
    dome = 1.06 - 0.16 * _smooth01((q - 0.2) / 0.8)
    key = 1.0 + 0.07 * np.clip(-(p[:, 0] - cx) / r * 0.5 - (p[:, 1] - cy) / ry * 0.5, -1, 1)
    nap = 1.0 + 0.05 * NOISE.fbm(p, 26.0, 3) + 0.03 * NOISE(p, 70.0)
    return np.clip(base[None, :] * (dome * key * nap)[:, None], 0, 1)


TOP_PAINTERS = {"patch": _top_patch, "roof": _top_roof, "lid": _top_lid}


# ── procedural-painterly parts (gw_proc) ─────────────────────────────────────────────────────────────
def _lab(rgb):
    """sRGB 0..1 (..., 3) -> CIE L*a*b* (D65)."""
    c = np.clip(np.asarray(rgb, np.float64), 0, 1)
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = lin @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def _excluded(lab, rule: dict):
    m = np.zeros(lab.shape[:2], dtype=bool)
    if "L_gt" in rule:
        m |= lab[..., 0] > rule["L_gt"]
    if "L_lt" in rule:
        m |= lab[..., 0] < rule["L_lt"]
    if "b_gt" in rule:
        m |= lab[..., 2] > rule["b_gt"]
    return m


def _hash(i):
    x = np.sin(np.asarray(i, np.float64) * 12.9898 + 78.233) * 43758.5453
    return x - np.floor(x)


def _lit(n, spec, lo=0.84, hi=1.08, key=0.06):
    """The sheet's value structure: lit tops, a key from the front-left, darker undersides."""
    lo, hi = spec.get("light", (lo, hi))
    v = lo + (hi - lo) * _smooth01((n[:, 2] + 0.4) / 1.2)
    return v * (1.0 + spec.get("key", key) * np.clip(-n[:, 1] * 0.6 - n[:, 0] * 0.4, -1, 1))


def _pca(p):
    c = p.mean(0)
    w, V = np.linalg.eigh(np.cov((p - c).T))
    return c, V[:, -1]


def _out(base, v, tint=None):
    col = np.asarray(scene.hex_srgb(base), np.float32)[None, :] * np.asarray(v, np.float32)[:, None]
    if tint is not None:
        col = col * tint
    return np.clip(col, 0, 1).astype(np.float32)


def _pp_flat(p, n, spec):
    v = 1.0 + spec.get("noise", 0.07) * NOISE.fbm(p, 9.0, 3) + 0.04 * NOISE(p, 31.0)
    return _out(spec["hex"], v * _lit(n, spec, 0.86, 1.08, spec.get("key", 0.0)))


def _pp_felt(p, n, spec):
    """Felt, linen, leather wraps: a soft mottle and a fine nap; `bands` = wrapped cloth (bands along the part)."""
    v = _lit(n, spec) * (1.0 + 0.05 * NOISE.fbm(p, 8.0, 3) + spec.get("nap", 0.04) * NOISE(p, 70.0))
    if spec.get("bands"):
        c, a = _pca(p)
        u = (p - c) @ a
        v = v * (1.0 - spec["bands"] * 0.5 * (1 - np.abs(np.cos(u * math.pi / 0.032))) ** 4)
    return _out(spec["hex"], v)


def _pp_stone(p, n, spec):
    """Honed stone (chalk, ironstone, sandstone): brush-scale mottle, ridged cracks, light chipped edges on the
    lit tops; `blocks` cuts it into a ring of stone blocks (the drum bands, the hammer drum), each its own tone
    with dark joints."""
    v = _lit(n, spec, 0.82, 1.10, 0.07)
    f = spec.get("freq", 8.0)
    v = v * (1.0 + spec.get("mottle", 0.06) * NOISE.fbm(p, f, 3)) * (1.0 + 0.03 * NOISE(p, 55.0))
    cr = np.clip((NOISE.ridged(p, f * 1.4, 3) - spec.get("crack_t", 0.68)) * 5.0, 0, 1)
    v = v * (1.0 - spec.get("cracks", 0.12) * cr)
    ch = np.clip((NOISE.ridged(p, f * 2.3, 2, offset=(3.0, 1.0, 7.0)) - 0.78) * 6.0, 0, 1)
    v = v * (1.0 + spec.get("chip_light", 0.12) * ch * _smooth01((n[:, 2] + 0.1) / 0.7))
    blocks = spec.get("blocks")
    if blocks:
        if blocks == "drum":
            c, a = p.mean(0), np.array([0.0, 0.0, 1.0])
            nb, sq = 11, 0.62
        else:
            c, a = _pca(p)
            nb, sq = 7, 1.0
        q = p - c
        if blocks == "drum":            # the drum's oval about the vertical
            ang = np.arctan2(q[:, 1] / sq, q[:, 0])
        else:
            e1 = np.cross(a, [0.0, 1.0, 0.0] if abs(a[1]) < 0.9 else [1.0, 0.0, 0.0])
            e1 /= np.linalg.norm(e1)
            ang = np.arctan2(q @ np.cross(a, e1), q @ e1)
        u = (ang / (2 * math.pi) + 0.5) * nb + 0.37 * NOISE(p, 6.0)
        bi = np.floor(u)
        fr = u - bi
        joint = np.clip(1.0 - np.minimum(fr, 1.0 - fr) * nb * 4.2, 0, 1) ** 2
        v = v * (0.90 + 0.18 * _hash(bi)) * (1.0 - 0.45 * joint)
        tint = (1.0 + 0.05 * (_hash(bi + 7.0) - 0.5)[:, None] * np.array([[1.0, 0.6, -0.4]])).astype(np.float32)
        return _out(spec["hex"], v, tint)
    return _out(spec["hex"], v)


def _pp_wood(p, n, spec):
    """Wood: grain streaks and dark grain lines along each texel's axis (the nearest of the part's segments, or
    the part's long axis)."""
    segs = _SEGS.get(spec.get("segs") or "")
    if segs:
        best = np.full(len(p), 1e9)
        ax = np.zeros_like(p)
        for a_, b_ in segs:
            a_, b_ = np.asarray(a_, float), np.asarray(b_, float)
            ab = b_ - a_
            t = np.clip((p - a_) @ ab / (ab @ ab), 0, 1)
            dd = np.linalg.norm(p - (a_ + t[:, None] * ab), axis=1)
            m = dd < best
            best[m] = dd[m]
            ax[m] = ab / np.linalg.norm(ab)
    else:
        _, a = _pca(p)
        ax = np.broadcast_to(a, p.shape)
    u = (p * ax).sum(1)
    perp = p - u[:, None] * ax
    g = perp * 26.0 + (u * 1.3)[:, None] * ax
    grain = NOISE.fbm(g, 1.0, 3)
    lines = np.clip((NOISE.ridged(g * 1.7, 1.0, 2) - 0.72) * 5.0, 0, 1)
    v = _lit(n, spec) * (1.0 + 0.11 * grain) * (1.0 - 0.22 * lines) * (1.0 + 0.04 * NOISE.fbm(p, 6.0, 2))
    return _out(spec["hex"], v)


def _pp_glass(p, n, spec):
    """Dawnglass panes (glossy in the material; the core oval on each is the accent): cool, lighter toward the
    top, deeper toward the frame, one soft diagonal sheen."""
    cx, cy, hw, hd, z0, z1 = spec["box"]
    t = np.clip((p[:, 2] - z0) / (z1 - z0), 0, 1)
    front = np.abs(n[:, 1]) >= np.abs(n[:, 0])
    lat = np.where(front, (p[:, 0] - cx) / hw, (p[:, 1] - cy) / hd)
    v = (0.80 + 0.26 * t) * (1.0 - 0.22 * _smooth01((np.abs(lat) - 0.55) / 0.45))
    sheen = np.clip(1.0 - np.abs(np.sin((lat * 0.9 + t * 1.6) * 2.2)) * 3.0, 0, 1)
    v = v * (1.0 + 0.10 * sheen) * (1.0 + 0.03 * NOISE(p, 40.0))
    v = v * (1.0 + 0.10 * _smooth01((n[:, 2] - 0.3) / 0.5))
    return _out(spec["hex"], v)


PROC_PAINTERS = {"flat": _pp_flat, "felt": _pp_felt, "stone": _pp_stone, "wood": _pp_wood, "glass": _pp_glass}


def _tint_texels(col, p, k, names, cfg, log):
    """Move a part's (or a height zone's) painted median onto a palette colour, keeping the brush detail
    (per-channel gain in linear light, blended by `strength`). Runs on the projected paint, before the ink,
    lining and top passes, so a hood's dark hollow never drags its median down."""
    from common.hifi import project
    tints = cfg.get("gw_tints") or []
    pal = cfg.get("gw_palette") or {}
    roles = cfg.get("gw_roles") or {}
    ink = {it[0]: (np.asarray(it[1]), np.asarray(it[2])) for it in (cfg.get("gw_ink") or [])}
    lin = project._lin(np.clip(col, 0, 1))
    for nm, zone, hexcol, kk in tints:
        if nm not in names:
            continue
        sel = k == names.index(nm)
        w = sel.astype(np.float32)
        if zone is not None:
            z0, z1 = zone
            w = w * np.clip((z1 + 0.008 - p[:, 2]) / 0.016, 0, 1) * np.clip((p[:, 2] - z0 + 0.008) / 0.016, 0, 1)
        stat = w > 0.5
        if nm in ink:
            c0, rr = ink[nm]
            stat &= np.linalg.norm((p - c0) / rr, axis=1) > 1.12          # the outer surface only
        if not stat.any():
            continue
        hexc = hexcol or pal.get(roles.get(nm, ""), "#808080")
        tgt = project._lin(np.asarray(scene.hex_srgb(hexc), np.float32))
        lum = lin[stat] @ np.array([0.2126, 0.7152, 0.0722])
        upper = lum >= np.percentile(lum, 45)                     # the part's own material, not its shadows/trim
        mean = np.median(lin[stat][upper], axis=0)
        gain = np.clip(tgt / np.maximum(mean, 1e-4), 0.05, 6.0)
        lin = lin * (1 + (gain - 1) * (w * kk)[:, None])
        log(f"  tint {nm} {zone or ''}: median {np.round(mean, 3).tolist()} -> {hexc} x{kk}")
    return project._srgb(lin).astype(np.float32)


def bind_cloak(ctx, obj) -> dict:
    """The cloak: hips -> spine -> chest by height, and toward the hem a share of the thigh on its side, so the
    bell sways with the waddle without the legs tearing it (the legs are short and hidden)."""
    from common import mesh
    arm = ctx.info.armature
    info = ctx.info
    obj.vertex_groups.clear()
    G = {b: obj.vertex_groups.new(name=b) for b in ("hips", "spine", "chest", "thigh.L", "thigh.R")}
    z_hip = info.j("pelvis").z
    z_sp = info.j("spine1").z
    z_ch = info.j("neck_base").z
    for v in obj.data.vertices:
        p = obj.matrix_world @ v.co
        w = {}
        t1 = mesh.smoothstep(z_hip + 0.02, z_sp, p.z)
        t2 = mesh.smoothstep(z_sp, z_ch - 0.03, p.z)
        w["hips"] = (1 - t1)
        w["spine"] = t1 * (1 - t2)
        w["chest"] = t2
        leg = 0.22 * mesh.smoothstep(z_hip - 0.02, 0.14, p.z) * min(1.0, abs(p.x) / 0.14)   # (0.42 dipped the hem 9 cm)
        side = "thigh.L" if p.x > 0 else "thigh.R"
        if leg > 0:
            w = {k: v_ * (1 - leg) for k, v_ in w.items()}
            w[side] = leg
        for k, val in w.items():
            if val > 1e-3:
                G[k].add([v.index], val, "REPLACE")
    mesh.add_armature_modifier(obj, arm)
    mesh.parent_keep(obj, arm)
    mesh.limit_weights(obj)
    return {"custom": "gw_cloak"}


def bind_arm(ctx, obj, side: str) -> dict:
    """A sleeve: bone heat over its own arm chain + the chest only (never the other arm or the legs)."""
    from common import mesh
    other = "L" if side == "R" else "R"
    excl = ("root", "prop.L", "prop.R", "hips", "spine", "neck", "head") + tuple(
        f"{b}.{other}" for b in ("shoulder", "upper_arm", "forearm", "hand")) + tuple(
        f"{b}.{s}" for b in ("thigh", "shin", "foot", "toe") for s in "LR")
    return mesh.bind_auto(obj, ctx.info.armature, exclude=excl)


# ── motion (brief §3.3): idle, run, attack1, death; the standard generators fill the unplayed rest ───────────
from dataclasses import dataclass as _dc  # noqa: E402

HT, FT = anim.HandTarget, anim.FootTarget


@_dc
class AimUp(anim.Aim):
    """anim.Aim + a roll: after the haft is pointed along `dir`, the hammer head's long axis (prop +Z, the
    striking faces) turns toward `up` (projected off the haft). Solved by the wrapper installed below."""
    up: tuple = (0.0, 0.0, 1.0)

    def lerp(self, o, t):
        b = anim.Aim.lerp(self, o, t)
        t = max(0.0, min(1.0, t))
        u = self.up
        if isinstance(o, AimUp):
            a_, c_ = np.asarray(self.up, float), np.asarray(o.up, float)
            u = tuple(a_ + (c_ - a_) * t)
        return AimUp(b.dir, b.weight, u)

    def mirrored(self):
        return AimUp((-self.dir[0], self.dir[1], self.dir[2]), self.weight, (-self.up[0], self.up[1], self.up[2]))


def _install_aim_up() -> None:
    if getattr(anim._solve_aim, "_gw", False):
        return
    from mathutils import Matrix, Vector
    orig = anim._solve_aim

    def solve(skel, pose, M, side, am):
        orig(skel, pose, M, side, am)
        if not isinstance(am, AimUp) or am.weight <= 0:
            return
        hand, prop = f"hand.{side}", f"prop.{side}"
        M2 = skel.fk(pose)
        R = M2[prop].to_3x3()
        axis = R.col[1].normalized()
        cur = R.col[2].normalized()
        want = Vector(am.up)
        want = want - axis * want.dot(axis)
        if want.length < 1e-5:
            return
        want.normalize()
        ang = math.atan2(cur.cross(want).dot(axis), cur.dot(want)) * am.weight
        new = Matrix.Rotation(ang, 3, axis) @ M2[hand].to_3x3()
        Ph = (M2[skel.parent[hand]] @ skel.local[hand]).to_3x3()
        pose[hand] = skel.euler_of(Ph.inverted() @ new, pose.get(hand))

    solve._gw = True
    anim._solve_aim = solve


class _Arms:
    """IK targets from WORLD points of the rest pose: `rel` is (point - rest shoulder) / arm length, which the
    solver reads in the posed chest frame (so torso turns carry the hands, as the anim library intends)."""

    def __init__(self, spec):
        self.L = spec.L
        self.P = spec.PROPORTIONS
        self.len = self.P["arm"]

    def rel(self, side, pt):
        sh, _, _ = rest_arm(self.L, side)
        return tuple((np.asarray(pt, float) - sh) / self.len)

    def hold(self, grip, d, up=(0.0, 0.0, 1.0), along=None, pole=(-0.8, 0.3, -0.5), lpole=(0.8, 0.3, -0.5)):
        """Right fist on the haft at `grip` (world, rest frame), the haft along `d`, the left fist `along` the haft."""
        d = np.asarray(d, float)
        d = d / np.linalg.norm(d)
        grip = np.asarray(grip, float)
        # the right hand target is the WRIST: the grip sits a hand-width beyond it (rest offset prop.R - wrist)
        _, _, wr = rest_arm(self.L, "R")
        off = np.asarray(self.L["grip_r"], float) - wr
        ik = {"hand.R": HT(rel=self.rel("R", grip - off), pole=pole), "aim.R": AimUp(tuple(d), 1.0, tuple(up))}
        if along is not None:
            ik["hand.L"] = HT(to_prop=("prop.R", along), pole=lpole)
        return ik


def _feet(st=(0.0, 0.0), yl=6.0, yr=-6.0, dl=(0, 0, 0), dr=(0, 0, 0), pl=0.0, pr=0.0, kl=0.0, kr=0.0):
    return {"foot.L": FT((st[0] + dl[0], st[1] + dl[1], dl[2]), pl, yl, 0.0, kl),
            "foot.R": FT((-st[0] + dr[0], -st[1] + dr[1], dr[2]), pr, yr, 0.0, kr)}


def _P(**kw):
    return anim.P(**kw)


def _pose(torso: dict, hips=(0.0, 0.0, 0.0), ik: dict | None = None) -> dict:
    p = anim.merge(anim.arms_relaxed(), torso)
    p["hips_loc"] = tuple(hips)
    p["ik"] = dict(ik or {})
    return p


HAMMER_PARTS = ("haft", "hammer_head", "hammer_bind", "hammer_bands", "hammer_window", "grip", "pommel")


class _Ground:
    """The built game mesh skinned in numpy (linear blend, the exported weights) for any resolved pose: the clips
    are solved against the real silhouette, so nothing floats or sinks (the first death hung 7-14 cm in the air
    and the run's feet sat 1-2 cm in the ground)."""

    def __init__(self, ctx, spec):
        import bpy
        self.skel = anim.Skeleton(ctx.info.armature)
        self.bones = list(self.skel.order)
        bi = {b: i for i, b in enumerate(self.bones)}
        self.rest_inv = np.stack([np.array(self.skel.rest[b].inverted()) for b in self.bones])
        names = [sp.name for sp in spec.parts()]
        Vs, Bs, Ws, Ps = [], [], [], []
        for o in (bpy.data.objects.get(spec.ID), bpy.data.objects.get(f"{spec.ID}_accent")):
            if o is None or o.type != "MESH":
                continue
            me = o.data
            n = len(me.vertices)
            co = np.empty(n * 3, np.float32)
            me.vertices.foreach_get("co", co)
            mw = np.array(o.matrix_world)
            co = co.reshape(n, 3) @ mw[:3, :3].T + mw[:3, 3]
            pid = np.zeros(n, np.int64)
            a = me.attributes.get("vale_part")
            if a is not None and a.domain == "POINT":
                a.data.foreach_get("value", pid)
            gname = {g.index: g.name for g in o.vertex_groups}
            B = np.zeros((n, 4), np.int64)
            W = np.zeros((n, 4), np.float64)
            for v in me.vertices:
                ws = sorted(((bi[gname[g.group]], g.weight) for g in v.groups
                             if gname.get(g.group) in bi and g.weight > 1e-4), key=lambda q: -q[1])[:4]
                tot = sum(w for _, w in ws) or 1.0
                for j, (b, w) in enumerate(ws):
                    B[v.index, j], W[v.index, j] = b, w / tot
            Vs.append(co)
            Bs.append(B)
            Ws.append(W)
            Ps.append(pid)
        self.V = np.concatenate(Vs)
        self.Vh = np.c_[self.V, np.ones(len(self.V))]
        self.B, self.W, self.pid = np.concatenate(Bs), np.concatenate(Ws), np.concatenate(Ps)
        self.names = names

    def sel(self, *prefixes):
        m = np.zeros(len(self.V), bool)
        for i, nm in enumerate(self.names):
            if nm.startswith(prefixes):
                m |= self.pid == i
        return m

    def points(self, pose: dict, mask=None) -> np.ndarray:
        """World positions of the (masked) vertices under a RESOLVED pose (no ik left in it)."""
        M = self.skel.fk(pose)
        S = np.stack([np.array(M[b]) for b in self.bones]) @ self.rest_inv            # (nb, 4, 4)
        B, W, Vh = (self.B, self.W, self.Vh) if mask is None else (self.B[mask], self.W[mask], self.Vh[mask])
        X = np.einsum("nk,nkij,nj->ni", W, S[B], Vh)
        return X[:, :3]

    def grounded(self, fn, aim_key: str = "aim.R"):
        """Wrap a clip sample: resolve its IK, then lift / drop the whole body so the lowest point of the BODY
        (the hammer and the arms excluded: they must never prop it up) is on z = 0; then, if the hammer dips under
        the ground, its aim is raised toward level just enough (bisection) that it rests on it."""
        body = ~self.sel(*HAMMER_PARTS, "sleeve", "mitt")
        prop = self.sel(*HAMMER_PARTS)

        def sample(t):
            raw = fn(t)
            pose = anim.resolve(self.skel, raw)
            lo = float(self.points(pose, body)[:, 2].min())
            hx, hy, hz = pose.get("hips_loc", (0.0, 0.0, 0.0))
            loc = (hx, hy, hz - lo)
            pose["hips_loc"] = loc
            am = (raw.get("ik") or {}).get(aim_key)
            if am is None or float(self.points(pose, prop)[:, 2].min()) > -0.004:
                return pose
            d0 = np.asarray(am.dir, float)
            lo_u, hi_u, best = 0.0, 1.0, pose
            for _ in range(8):
                u = (lo_u + hi_u) / 2
                d = d0.copy()
                d[2] = d0[2] * (1 - u) + 0.35 * u
                d /= np.linalg.norm(d)
                r2 = dict(raw)
                r2["ik"] = dict(raw["ik"])
                r2["ik"][aim_key] = AimUp(tuple(d), am.weight, getattr(am, "up", (0.0, 0.0, 1.0)))
                p2 = anim.resolve(self.skel, r2)
                p2["hips_loc"] = loc
                if float(self.points(p2, prop)[:, 2].min()) < 0.0:
                    lo_u = u
                else:
                    hi_u, best = u, p2
            return best
        return sample


def motion_clips(ctx, spec) -> dict:
    _install_aim_up()
    A = _Arms(spec)
    GR = _Ground(ctx, spec)
    L = spec.L
    d0 = np.asarray(L["haft"], float) / np.linalg.norm(L["haft"])
    g0 = np.asarray(L["grip_r"], float)
    along0 = L["grip_l_along"]
    feet0 = _feet((0.012, 0.0))
    hold0 = A.hold(g0, d0, (0, 0, 1), along0)
    G = _pose(_P(hips=(2, 0, 0), spine=(2, 0, 0), chest=(1, 0, 0), neck=(-2, 0, 0), head=(-2, 0, 0)), (0, 0.0, -0.012),
              dict(hold0, **feet0))
    out = {}

    # IDLE (72 f): the hammer across the hips, a slow heave, the lantern rocking ~2 degrees on the yoke
    def idle(t):
        b = anim.osc(t, 1)
        r = anim.osc(t, 1, 0.25)
        p = anim.add(G, _P(spine=(0.8 * b, 0, 0.5 * r), chest=(1.6 * b, 0, 1.6 * r), neck=(-1.2 * b, 0, 0),
                           head=(-0.8 * b, 2.0 * anim.osc(t, 1, 0.1), -0.8 * r), shoulder_L=(0, 0, 1.2 * b),
                           shoulder_R=(0, 0, -1.2 * b)))
        p["hips_loc"] = (0.006 * r, 0.0, -0.012 - 0.008 * (0.5 + 0.5 * b))
        return p
    out["idle"] = anim.Clip("idle", 72, True, anim.drag(idle, 72, {"head": 3.0, "neck": 2.0}, loop=True))

    # RUN (10 f at 3.2 m/s): a short-legged rolling waddle. Planted feet move back at exactly run_ref_speed;
    # the hips roll side to side, the chest counter-rolls so the lantern stays near level; the hammer is
    # carried diagonally (head up by the left shoulder), bouncing with the steps
    out["run"] = _run_clip(spec, A, d0, GR)

    # ATTACK1 (30 f, impact f12 = 40 % = the 0.40 s windup): a full two-hand swing from low behind the right
    # hip, up past the right shoulder (outside the lantern), forward; at the impact the head is at its highest
    # forward point (the lob leaves there), the follow-through drops it to the ground in front
    out["attack1"] = _attack_clip(spec, A, G, feet0)

    # DEATH (60 f): the hammer drops, the wick sits back heavily against its lantern frame and tips back onto
    # it; ends at rest (propped on the lantern, the hammer flat on the ground beside it)
    out["death"] = _death_clip(spec, A, G, GR)
    return out


def _run_clip(spec, A, d0, GR):
    """A heavy rolling run (brief §3.3): 14 frames (0.467 s, 4.3 steps/s against the first build's 6), a 0.75 m
    step with a short contact (each foot planted 30 % of the cycle, moving back at exactly run_ref_speed) and a
    flight between steps; the body HEAVES 5.5 cm (low as the planted leg takes the weight, high in the flight),
    sways 4.5 cm onto the planted side and rolls 9 degrees (the chest gives back 5: the lantern rocks, near
    level), the hammer bounces late on the steps. Planted boots are solved onto the ground against the skinned
    mesh every frame; swinging ones clear it."""
    v = spec.MOTION["run_ref_speed"]
    N = 14
    T = N / anim.FPS
    c = 0.26
    Ls = v * c * T                                   # planted foot travel (m) during contact
    lift = 0.10
    swing = [(0.00, Ls / 2, 0.0, -22.0), (0.22, Ls / 2 + 0.06, lift * 0.8, -38.0), (0.5, 0.0, lift, -14.0),
             (0.80, -Ls / 2 - 0.04, lift * 0.45, 6.0), (1.0, -Ls / 2, 0.0, 4.0)]

    def swing_at(s_):
        for i in range(1, len(swing)):
            if s_ <= swing[i][0]:
                a_, b_ = swing[i - 1], swing[i]
                u = anim.sine((s_ - a_[0]) / (b_[0] - a_[0]))
                return tuple(a_[k] + (b_[k] - a_[k]) * u for k in (1, 2, 3))
        return swing[-1][1:]

    def foot_at(q):
        q %= 1.0
        if q < c:
            u = q / c
            return (0.0, -Ls / 2 + Ls * u, 0.0), 4.0 * (1 - u) - 16.0 * max(0.0, (u - 0.75) / 0.25) ** 1.5, True
        dy, dz, pitch = swing_at((q - c) / (1 - c))
        return (0.0, dy, dz), pitch, False

    def heave(q):
        """hips z offset over one step (q in 0..0.5, 0 = a foot strikes): loading to the lowest at mid-stance,
        then up through the push-off into the flight's peak."""
        s_ = (q % 0.5) / 0.5
        st = c / 0.5                                  # the stance share of a step
        if s_ < st:
            u = s_ / st
            return -0.050 - 0.010 * math.sin(math.pi * u)        # -0.050 at strike / toe-off (the leg's reach), -0.060 mid-stance
        u = (s_ - st) / (1 - st)
        return -0.050 + 0.042 * math.sin(math.pi * u)            # the flight's peak -0.008

    L = spec.L
    grip = np.array([-0.27, -0.33, L["grip_r"][2] - 0.02])
    dr = np.array([0.88, -0.05, 0.47])
    dr /= np.linalg.norm(dr)
    hold = A.hold(grip, dr, (-0.47, 0.0, 0.88), 0.40)
    sw = L["hip_w"] / 2 + L["stance"]                 # the feet's half spread

    def build(t, dz_l=0.0, dz_r=0.0, dh=0.0):
        q = t % 1.0
        fl, pl, cl = foot_at(q)
        fr, pr, cr = foot_at(q + 0.5)
        ph = 2 * math.pi * q
        # weight on the planted side: the left foot plants at q 0..c (sin > 0 on that half)
        side = math.sin(ph + 0.35)
        roll = 6.5 * side
        pose = anim.merge(anim.arms_relaxed(), _P(
            hips=(5.0, -6.0 * math.cos(ph), roll), spine=(5.0, 2.5 * math.cos(ph), -roll * 0.30),
            chest=(3.0 + 2.5 * math.cos(2 * ph + 0.8), 3.0 * math.cos(ph), -roll * 0.25),
            neck=(-6.0 - 2.5 * math.cos(2 * ph + 1.2), 0, 0), head=(-5.0, 0, -roll * 0.25)))
        pose["hips_loc"] = (0.05 * side * (sw / 0.16), 0.012, heave(q) + dh)
        ik = dict(hold)
        bounce = 0.022 * math.cos(2 * ph + 1.4)
        h = ik["hand.R"]
        ik["hand.R"] = HT(rel=(h.rel[0], h.rel[1], h.rel[2] + bounce / A.len), pole=h.pole)
        ik["foot.L"] = FT((0.012 + fl[0], fl[1] - 0.01, fl[2] + dz_l), pl, 4.0, 0.0, 0.0)
        ik["foot.R"] = FT((-0.012 + fr[0], fr[1] - 0.01, fr[2] + dz_r), pr, -4.0, 0.0, 0.0)
        pose["ik"] = ik
        return pose, cl, cr

    boots = {"L": GR.sel("boot_L"), "R": GR.sel("boot_R")}
    bell = GR.sel("cloak", "stole", "legs", "mantle")

    def sample(t):
        dz = {"L": 0.0, "R": 0.0}
        dh = 0.0
        for _ in range(3):
            pose, cl, cr = build(t, dz["L"], dz["R"], dh)
            res = anim.resolve(GR.skel, pose)
            lo = float(GR.points(res, bell)[:, 2].min())
            if lo < 0.004:                             # the hem never cuts the ground: the body rides up instead
                dh += 0.004 - lo
            for s_, planted in (("L", cl), ("R", cr)):
                lo = float(GR.points(res, boots[s_])[:, 2].min())
                if planted:
                    dz[s_] -= lo                       # the sole exactly on the ground
                elif lo < 0.012:
                    dz[s_] += 0.012 - lo               # a swinging boot clears it
        pose, _, _ = build(t, dz["L"], dz["R"], dh)
        return anim.resolve(GR.skel, pose)

    return anim.Clip("run", N, True, sample, meta={"run_ref_speed": v, "stride_m": round(v * T / 2, 3), "cycle_s": round(T, 3)})


def _unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def _attack_clip(spec, A, G, feet0):
    """Hands slide together near the butt for the swing (0.42 m arms cannot hold a haft apart overhead), the swing
    plane passes the right side (the lantern fills the space behind the head), and the torso pitches little so
    the lantern stays near level: the arms and the hips' turn carry the arc."""
    L = spec.L
    z0 = L["grip_r"][2]
    wind_d = _unit((-0.40, 0.72, -0.37))           # the head LOW behind the right hip (it read as held out sideways)
    up_d = _unit((-0.55, 0.22, 0.81))
    hit_d = _unit((-0.05, -0.68, 0.73))
    fol_d = _unit((0.04, -0.86, -0.50))
    lf = _feet((0.012, 0.0), dl=(0.0, -0.07, 0.0))
    wind = _pose(_P(hips=(4, -24, 0), spine=(3, -12, 0), chest=(1, -14, 0), neck=(-2, 12, 0), head=(-2, 12, 0)),
                 (0.0, 0.02, -0.045), dict(A.hold((-0.18, 0.03, z0 + 0.02), wind_d, _unit((-0.3, -0.35, 0.88)), 0.14), **lf))
    rise = _pose(_P(hips=(-1, -14, 0), spine=(-3, -6, 0), chest=(-3, -8, 0), neck=(-2, 6, 0), head=(-3, 6, 0)),
                 (0.0, 0.025, 0.0), dict(A.hold((-0.22, -0.10, z0 + 0.34), up_d, _unit((0.3, -0.9, 0.2)), 0.13), **lf))
    hf = _feet((0.012, 0.0), dl=(0.0, -0.17, 0.0))
    hit = _pose(_P(hips=(5, 10, 0), spine=(3, 4, 0), chest=(0, 6, 0), neck=(-4, 0, 0), head=(-6, -4, 0)),
                (0.0, -0.07, -0.04), dict(A.hold((-0.06, -0.30, z0 + 0.38), hit_d, _unit((0.0, -0.73, -0.68)), 0.13), **hf))
    fol = _pose(_P(hips=(10, 12, 0), spine=(6, 4, 0), chest=(2, 6, 0), neck=(-8, 0, 0), head=(-8, -4, 0)),
                (0.0, -0.09, -0.07), dict(A.hold((-0.03, -0.34, z0 + 0.28), fol_d, _unit((0.0, -0.50, 0.86)), 0.15), **hf))
    hv = 1.35
    still = {"hand.R": 0.0, "hand.L": 0.0, "aim.R": 0.0, "foot.L": 0.0, "foot.R": 0.0}
    counter = anim._with_hips(anim.lerp_pose_w(G, wind, -0.10, still), (0.0, 0.0, -0.012 * hv))
    coil = anim.lerp_pose_w(G, wind, 1.05, {"aim.R": 1.0, "foot.L": 1.0, "foot.R": 1.0, "hand.R": 1.0, "hand.L": 1.0})
    hit2 = anim._with_hips(hit, (0.0, 0.0, -0.02))
    hold = anim._with_hips(anim.lerp_pose(hit, fol, 0.12), (0.0, 0.0, -0.024))
    rec = anim.lerp_pose(fol, G, 0.5)
    keys = [(0.0, G, "linear"), (0.08, counter, "inout"), (0.22, wind, "inout"), (0.28, coil, "out"),
            (0.335, rise, "in"), (anim.IMPACT, hit2, "accel"), (0.46, hold, "out"), (0.60, fol, "in"),
            (0.68, anim._with_hips(fol, (0, 0, 0.012)), "out"), (0.84, rec, "inout"), (1.0, G, "settle")]
    fn = anim.drag(anim.keyed(keys), 30, {"head": 1.5, "neck": 1.0})
    return anim.Clip("attack1", 30, False, fn, impact=anim.IMPACT)


def _death_clip(spec, A, G, GR):
    """The hammer drops, the wick sits back heavily (knees give, the bell's back hem meets the ground) and
    topples backward as one heavy bell, lantern first, accelerating; the lantern lands, the body rocks 1.5
    degrees on it and rests there (propped on the lantern, the hammer on the ground beside it). Every frame is
    solved onto the ground against the skinned mesh (no float, no rebound off the ground)."""
    L = spec.L
    tp = L["topple"]
    py_, pz_ = tp["pivot"]
    pel = np.array([0.0, 0.0, L["hip"] + 0.015])

    def tilt(theta, extra=None, hips_d=(0.0, 0.0, 0.0), ik=None):
        th = math.radians(theta)
        rel = pel - np.array([0.0, py_, pz_])
        y = rel[1] * math.cos(th) + rel[2] * math.sin(th)
        z = -rel[1] * math.sin(th) + rel[2] * math.cos(th)
        loc = np.array([0.0, py_ + y, pz_ + z]) - pel + np.asarray(hips_d)
        p = anim.merge(anim.arms_relaxed(), _P(hips=(-theta, 0, 0)), extra or {})
        p["hips_loc"] = tuple(loc)
        p["ik"] = dict(ik or {})
        return p

    lie = tp["lie"]
    loose = {"hand.R": HT(rel=A.rel("R", (-0.36, -0.22, 0.34)), pole=(-0.9, 0.3, -0.3)),
             "aim.R": AimUp(tuple(_unit((0.55, -0.70, -0.45))), 1.0, (0, 0, 1)),
             "hand.L": HT(rel=A.rel("L", (0.34, -0.10, 0.40)), pole=(0.9, 0.3, -0.3))}
    flop = {"hand.R": HT(rel=A.rel("R", (-0.42, -0.06, 0.36)), pole=(-0.9, 0.1, -0.2)),
            "aim.R": AimUp(tuple(_unit((0.25, -0.97, -0.10))), 1.0, (-1.0, 0.0, 0.0)),
            "hand.L": HT(rel=A.rel("L", (0.42, 0.0, 0.40)), pole=(0.9, 0.1, -0.2))}
    feet = _feet((0.012, 0.0))
    recoil = _pose(_P(hips=(-5, 6, 0), spine=(-6, 0, 0), chest=(-8, 4, 0), neck=(-6, 0, 0), head=(-10, 6, 0)),
                   (0.0, 0.03, -0.01), dict(loose, **feet))
    legs = _P(thigh_L=(30, 0, -6), shin_L=(-34, 0, 0), thigh_R=(26, 0, 8), shin_R=(-30, 0, 0))
    # the sit: knees give (feet still planted), the body settles 5-9 cm and leans back onto its back hem
    sink = -0.05 if spec.faction == "aubade" else -0.085
    sit = tilt(10.0, _P(spine=(-4, 0, 0), neck=(6, 0, 0), head=(8, 0, 0)), (0, 0.0, sink), dict(loose, **feet))
    tip = tilt(lie * 0.55, anim.merge(legs, _P(spine=(-2, 0, 0), neck=(10, 0, 0), head=(12, 4, 0))), (0, 0, 0), flop)
    land = tilt(lie + 2.0, anim.merge(legs, _P(neck=(14, 0, 0), head=(16, 6, 0))), (0, 0, 0.0), flop)
    rest = tilt(lie, anim.merge(legs, _P(neck=(12, 0, 0), head=(12, -8, 0))), (0, 0, 0.0), flop)
    keys = [(0.0, G, "linear"), (0.10, recoil, "snap"), (0.32, sit, "inout"), (0.50, tip, "in"),
            (0.62, land, "in"), (0.74, rest, "out"), (1.0, rest, "linear")]
    fn = anim.drag(anim.keyed(keys), 60, {"head": 2.0, "neck": 1.0})
    return anim.Clip("death", 60, False, GR.grounded(fn))


KINDS = [Greatwick]

if __name__ == "__main__":
    wc.run(KINDS)
