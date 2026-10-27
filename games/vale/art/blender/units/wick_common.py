"""VALE Wicks, shared code: the Wick spec base, the faction palettes, helpers and the build runner.

Not a build target. Each kind lives in its own module, so four builders can work in parallel without
touching the same file:

    art/blender/units/wick_shieldwick.py   melee   1.1 m   round shield (left arm) + short lamp-mace
    art/blender/units/wick_glimwick.py     caster  1.0 m   long pole with a hanging lamp
    art/blender/units/wick_greatwick.py    siege   1.5 m   broad back-lantern on a frame + heavy hammer
    art/blender/units/wick_brightwick.py   super   1.7 m   pauldrons, crown-lamp ring, two-hand lamp staff

    Blender -b --factory-startup --python-exit-code 1 --python art/blender/units/wick_<kind>.py -- [--faction aubade|serenade]
    Blender ... --python art/blender/units/wicks.py -- [--faction legacy|aubade|serenade|both|all] [--ids glimwick,...]

Builds (all through the fighter pipeline, `common.pipeline.build`, spec KIND "minion"):
  <kind>_aubade    west / team 0 (Dawn): chalk, cool blue-grey cloth, dawnglass, upward lines
  <kind>_serenade  east / team 1 (Dusk): ironstone, ochre/umber felt, lampresin, rounded heavy forms
  <kind>           LEGACY: today's GLB (content `art.model`), frozen until the faction models ship
Outputs: art/out/units/<id>.glb, art/renders/units/three_<id>.png + build_report_<id>.json.

Brief (law for these models): _design/units/wicks.md. Concepts: _design/concept/wicks/<kind>_<faction>.webp.
Method: HANDOFF.md "Art 2.0 method" (reference art/blender/fighters/marund.py): concept plates
(`art/tools/concept_plates.py wicks/<kind>_<faction> --height <m>`) -> SDF sculpt fitted to the concept ->
`PROJECTION = {"concept": "wicks/<kind>_<faction>", "height": <m>}` on the spec, or
`graded_projection(...)` below (grades the plates first: Serenade saturation, top-band lift, painted glow).

Renders: wicks ship no splash / portrait / icon, and those renders would write shared file names under
art/out/units (parallel builds would overwrite each other), so the runner always sets --no-render; the
three.js QA sheet (three_<id>.png) is the review image.
"""
from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy  # noqa: E402,F401
import numpy as np  # noqa: E402

from common import anim, fighter, materials, pipeline, rig, scene  # noqa: E402
from common.hifi import sdf  # noqa: E402
from common.hifi.sdf import Capsule, Ellipsoid, HalfSpace, Lathe, RoundBox, RoundCone, Sculpt, Sphere, Torus  # noqa: E402

FACTIONS = ("aubade", "serenade")          # index = TeamId in RIFT/BRIDGE (content art.teamModels order)
LEGACY = "legacy"

N = sdf.Noise(13)


def folds(amp, freq):
    """Radial cloth folds around the Z axis (the legacy cloak)."""
    return lambda P: amp * (np.abs(np.sin(np.arctan2(P[:, 1], P[:, 0]) * freq + 0.8 * N(P, 3.0))) * 2 - 1) * -0.5


# ── palettes (bible material roles; _design/units/wicks.md section 3) ─────────────────────────────────────
# The accent is authored Dawn azure on every wick; the renderer tints it per viewer (ally / enemy).
LEGACY_PALETTE = materials.bible_palette(cloth="#5B5650", cloth2="#C9C1AE", under="#34302C", leather="#4A3D33",
                                         stone="#B3AA98", ironstone="#4A4038", wood="#8A6E52", lampresin="#BF8F52",
                                         accent="#3F9CFF")
FACTION_PALETTES = {
    "aubade": materials.bible_palette(
        chalk="#D6D3CA",       # chalk limestone: spire finials, hood rim, shield face, pauldrons (L* 85)
        cloth2="#BFC6CC",      # pale blue-grey linen: hood, stole, tabard (L* 79)
        cloth="#6E7A86",       # cool blue-grey wool: the cloak (L* 51)
        under="#3A3F47",       # slate under-robe, trousers (L* 26)
        leather="#36373B",     # dark cool leather: boots, mitts, straps (L* 23)
        stone="#98A2AC",       # blue-grey dialstone (the "blued steel" read, never metallic): bands, caps (L* 66)
        ironstone="#3E434A",   # dark slate: soles, toe caps, deepest trims (L* 28)
        wood="#B9AB93",        # pale ash: hafts, poles, frames (L* 71)
        wood_dark="#6A6358",   # weathered ash: grips, binding (L* 42)
        dawnglass="#A9C4DC",   # cool glass lamp panes, glossy, never emissive (L* 78)
        lampresin="#BF8F52",   # unused by Aubade
        ink="#15171B",         # the hood's inner dark
        accent="#3F9CFF"),
    "serenade": materials.bible_palette(
        sandstone="#C3A47A",   # ochre sandstone: shield rings, pauldron bands, hood crown (L* 69)
        cloth2="#C9AF8A",      # sand felt: the dome hood, mantle, tabard (L* 73)
        cloth="#765E4E",       # warm umber felt: the cloak (L* 42)
        under="#3B302A",       # warm dark under-robe (L* 21)
        leather="#45362C",     # dark umber waxed leather: boots, mitts, straps (L* 24)
        stone="#A39580",       # ochre-cast stone (L* 62)
        ironstone="#4B4039",   # ironstone: hood band, shield dome, cages, hammer head (L* 28)
        wood="#9A7A58",        # walnut, light side: lamp frames (L* 53)
        wood_dark="#5A4436",   # walnut: hafts, poles, back frame (L* 31)
        lampresin="#BF8F52",   # amber resin lamp panes, glossy, never emissive (L* 63)
        dawnglass="#A9C4DC",   # unused by Serenade
        ink="#17150F",
        accent="#3F9CFF"),
}


class Wick:
    """A Wick spec for `pipeline.build` (the fighter spec contract, KIND "minion").

    Subclass per kind (wick_<kind>.py): set KIND_ID + HEIGHT, put the legacy props in `legacy_props` (frozen), and
    override `model(ctx)` for the faction builds (self.faction is "aubade" / "serenade"). Anything the
    pipeline reads can be overridden per instance in `__init__`: PROPORTIONS, PALETTE, MOTION, PROJECTION,
    TEXTURE_SIZE / TEXTURE_SIZES, AO_INTO_BASE, rig_extras(ctx), clip_overrides(ctx), chain_config(ctx).
    """
    KIND = "minion"
    OUT_SUBDIR = "units"
    MATERIAL_SET = "bible"
    ARMOUR_CONFORM = False
    TEXTURE_SIZE = 512             # legacy; faction builds: 1024 base (see __init__), normal + ORM 256-512
    GLB_COMPRESS = True
    SKINS: list = []
    SOCKETS = None
    VALUE_GRADIENT_STOPS = materials.BIBLE_GRADIENT_STOPS
    PROJECTION = None

    KIND_ID = "wick"               # content unit id (shieldwick, glimwick, greatwick, brightwick)
    HEIGHT = 1.1                   # content art.height (m); both factions share it (CONTRACT teamModels)

    def __init__(self, faction: str = LEGACY):
        if faction not in FACTIONS + (LEGACY,):
            raise SystemExit(f"unknown faction {faction!r} (aubade | serenade | legacy)")
        self.faction = faction
        self.ID = self.KIND_ID if faction == LEGACY else f"{self.KIND_ID}_{faction}"
        self.H = self.HEIGHT
        self.PROPORTIONS = self.legacy_proportions()
        self.PALETTE = dict(LEGACY_PALETTE if faction == LEGACY else FACTION_PALETTES[faction])
        self.MOTION = anim.motion_profile(weight="light" if self.H < 1.3 else "medium", weapon="one_hand",
                                          stance="neutral", run_ref_speed=3.2)
        if faction != LEGACY:
            self.TEXTURE_SIZE = 1024
            self.TEXTURE_SIZES = {"normal": 256, "orm": 256}

    # ── the legacy body (today's GLBs; keep it byte-stable until the faction models replace it) ──────────
    def legacy_proportions(self) -> dict:
        k = self.H / 1.1
        return rig.proportions(height=self.H * 0.86, head=0.30 * k, neck=0.03 * k, shoulder_width=0.34 * k,
                               hip_width=0.18 * k, leg=0.36 * k, arm=0.36 * k, hand=0.11 * k, foot=0.17 * k,
                               ankle_height=0.05 * k, stance=0.03 * k, a_pose_deg=62.0, spine_curve=0.02 * k)

    def model(self, ctx) -> list:
        """Faction builds: override in wick_<kind>.py (Art 2.0 sculpt). Until then, the legacy geometry in the
        faction palette (a scaffold that proves the faction build path, not a look)."""
        return self.legacy_model(ctx)

    def legacy_model(self, ctx) -> list:
        P = []
        k = self.H / 1.1
        part = self.part_fn(ctx, P, vox=0.012 * k)        # the legacy voxel (keep the float expression: byte-stable GLBs)
        legacy_body(self, ctx, part)
        self.legacy_props(ctx, part)
        return P

    def legacy_props(self, ctx, part) -> None:
        """The legacy job props (per kind module)."""

    # ── helpers ────────────────────────────────────────────────────────────────────────────────────────
    @staticmethod
    def part_fn(ctx, P: list, vox: float):
        """part(name, Sculpt, material role, bind, tris, vox_scale=1.0): mesh the sculpt, append a Part."""
        def part(name, S, mat, bind, tris, vs=1.0):
            v, q = S.mesh(vox * vs)
            ob = sdf.to_object(f"{name}_high", v, q, ctx.col)
            ob.data.materials.append(ctx.mats[mat])
            P.append(fighter.Part(name, high=ob, tris=tris, bind=bind))
        return part


def legacy_body(spec: Wick, ctx, part) -> None:
    """Cloak, hood, hood light, sleeves, mitts, boots: the shared legacy body (wicks.py before the split)."""
    k = spec.H / 1.1
    info = ctx.info
    head = info.j("head_base")
    crown = info.j("crown")
    hz = (head.z + crown.z) / 2
    # cloak: a bell from the shoulders to the shins, folded
    sh = info.j("neck_base")

    def cloak_prof(r, z):
        t = np.clip((z - 0.12 * k) / (sh.z - 0.12 * k), 0, 1)
        rad = 0.27 * k * (1 - t) + 0.16 * k * t + 0.03 * k * np.sin(t * 3.14)
        return np.maximum(np.maximum(r - rad, 0.12 * k - z), z - sh.z - 0.02 * k)
    cloak = Sculpt("cloak")
    cloak.add(Lathe((0, 0.0, 0), cloak_prof, 0.32 * k, 0.1 * k, sh.z + 0.05 * k).displaced(folds(0.018 * k, 7), 0.02 * k), k=0.0)
    cloak.inter(HalfSpace((0, 0, 0.12 * k), (0, 0, -1), 2.0), k=0.0)
    part("cloak", cloak, "cloth", "auto", 1400)
    # hood: deep, pointed back, the opening facing -Y; the lamplight inside is accent
    hood = Sculpt("hood")
    hood.add(Ellipsoid((0, 0.02 * k, hz), (0.19 * k, 0.21 * k, 0.2 * k)), k=0.0)
    hood.add(RoundCone((0, 0.08 * k, hz + 0.06 * k), (0, 0.27 * k, hz - 0.02 * k), 0.12 * k, 0.03 * k), k=0.06 * k)   # tip droops back (no 'ears' from above)
    hood.add(Torus((0, 0, sh.z + 0.02 * k), 0.15 * k, 0.05 * k), k=0.04 * k)       # collar roll
    hood.sub(Ellipsoid((0, -0.17 * k, hz - 0.02 * k), (0.12 * k, 0.13 * k, 0.13 * k)), k=0.02 * k)
    part("hood", hood, "cloth2", "bone:head", 900)
    glow = Sculpt("hoodlight")
    glow.add(Ellipsoid((0, -0.04 * k, hz - 0.02 * k), (0.09 * k, 0.05 * k, 0.09 * k)), k=0.0)
    part("hoodlight", glow, "accent", "bone:head", 120)
    # arms (sleeves) and mitts
    arms = Sculpt("sleeves")
    for s in ("L", "R"):
        a, e, w = info.side("shoulder", s), info.side("elbow", s), info.side("wrist", s)
        arms.add(RoundCone(tuple(a), tuple(e), 0.07 * k, 0.06 * k), k=0.0)
        arms.add(RoundCone(tuple(e), tuple(w), 0.06 * k, 0.065 * k), k=0.03 * k)
    part("sleeves", arms, "cloth", "auto", 600)
    mitts = Sculpt("mitts")
    for s in ("L", "R"):
        w = info.side("wrist", s)
        mitts.add(Sphere(tuple(w), 0.055 * k), k=0.0)
    part("mitts", mitts, "leather", "auto", 200)
    boots = Sculpt("boots")
    for s in ("L", "R"):
        an = info.side("ankle", s)
        boots.add(RoundBox((an.x, an.y - 0.04 * k, 0.045 * k), (0.06 * k, 0.1 * k, 0.045 * k), 0.035 * k), k=0.0)
    part("boots", boots, "leather", "auto", 300)


def legacy_weapon(spec: Wick, ctx, part, mat: str, head_size: tuple) -> None:
    """The legacy one-hand prop on prop.R: a haft with a block head (lamp-mace / hammer / staff head)."""
    k = spec.H / 1.1
    wr = ctx.info.side("wrist", "R")
    weap = Sculpt("weapon")
    top = (wr.x, wr.y - 0.02 * k, wr.z + 0.35 * k)
    weap.add(Capsule((wr.x, wr.y, wr.z - 0.08 * k), top, 0.018 * k), k=0.0)
    weap.add(RoundBox(top, tuple(s * k for s in head_size), 0.02 * k), k=0.01 * k)
    part("weapon", weap, mat, "bone:prop.R", 200)


def legacy_pole_lamp(spec: Wick, ctx, part, rise: float) -> None:
    """The legacy pole (floor to H + rise) with a lamp hanging off a ring near the tip, on prop.R."""
    H, k = spec.H, spec.H / 1.1
    wr = ctx.info.side("wrist", "R")
    pole = Sculpt("pole")
    bot = (wr.x, wr.y, 0.05 * k)
    tip = (wr.x, wr.y - 0.05 * k, H + rise * k)
    pole.add(Capsule(bot, tip, 0.016 * k), k=0.0)
    pole.add(Torus((tip[0], tip[1] - 0.06 * k, tip[2] - 0.04 * k), 0.06 * k, 0.012 * k), k=0.0)
    part("pole", pole, "wood", "bone:prop.R", 180)
    lamp = Sculpt("lamp")
    lc = (tip[0], tip[1] - 0.12 * k, tip[2] - 0.16 * k)
    lamp.add(Ellipsoid(lc, (0.06 * k, 0.06 * k, 0.08 * k)), k=0.0)
    part("lamp", lamp, "accent", "bone:prop.R", 100)


# ── the hood light: one soft core + its halo (fix round 4, shared by every kind) ───────────────────────────────────
# Brief §0.2 / §4: ONE soft glowing volume deep in a dark hollow, wider than tall, dark all round it. The accent is
# factor-only (the shared load test), so the core is one flat emissive colour; its falloff is a second, alpha-blended
# accent: a HALO cap (the front of an ellipsoid HALO_SCALE x the core's width and height) whose COLOR_0 vertex alpha
# runs from HALO_ALPHA0 over the core's outline to 0 at its rim. Built with the kept material HALO_MAT (`glow_`:
# never baked, split into the accent mesh), the export hook (install_halo_export) renames it `accent` (the renderer
# and the crowd path tint every material of that name per viewer), sets it BLEND and writes the vertex alpha.
HALO_MAT = "glow_halo"
HALO_SCALE = 1.6                 # the halo's rim, in core radii (across and up)
HALO_ALPHA0 = 0.85               # vertex alpha over the core's outline (0 at the rim): the light fades from the core's
HALO_ALPHA_IN = 0.90             # own value instead of stepping down at its edge; at the apex (over the core) 0.9
HALO_FALL = 1.6                  # the fall's exponent (alpha0 * (1 - s) ** HALO_FALL, s = 0 at the core .. 1 at the rim)
HALO_RINGS = (0.0, 1.0 / HALO_SCALE, 0.70, 0.78, 0.87, 1.0)


def halo_alpha(rho):
    """vertex alpha of the halo at normalized lateral radius rho (0 apex, 1 rim)"""
    rho = np.clip(np.asarray(rho, dtype=np.float64), 0.0, 1.0)
    r0 = 1.0 / HALO_SCALE
    inside = HALO_ALPHA0 + (HALO_ALPHA_IN - HALO_ALPHA0) * (1.0 - rho / r0) ** 2
    s = np.clip((rho - r0) / (1.0 - r0), 0.0, 1.0)
    return np.where(rho <= r0, inside, HALO_ALPHA0 * (1.0 - s) ** HALO_FALL)


def _frame(X, Y, Z):
    ax = np.stack([np.asarray(v, dtype=np.float64) for v in (X, Y, Z)])
    return ax / np.linalg.norm(ax, axis=1, keepdims=True)


def cap_mesh(c, X, Y, Z, rx, ry, rz, seg: int = 16, polar_deg=(0.0, 50.0, 100.0)):
    """The hood-light CORE: the front of an ellipsoid (apex toward Y, the opening's outward normal; X across, Z up;
    half sizes rx across, ry deep, rz up), from the apex to `polar_deg[-1]` degrees off it (a little past the
    outline seen from the front, so the open back never shows from in front or above). `seg` round: a smooth
    outline (review r3: a 10-sided core read as a polygon up close). Returns (V, F), faces outward."""
    c = np.asarray(c, dtype=np.float64)
    ax = _frame(X, Y, Z)
    V = [c + ry * ax[1]]
    for p in polar_deg[1:]:
        t = math.radians(p)
        for i in range(seg):
            a = 2.0 * math.pi * i / seg
            V.append(c + math.sin(t) * math.cos(a) * rx * ax[0] + math.cos(t) * ry * ax[1]
                     + math.sin(t) * math.sin(a) * rz * ax[2])
    V = np.asarray(V)
    return V, orient_out(V, _cap_faces(seg, len(polar_deg) - 1), c)


def halo_mesh(c, X, Y, Z, rx, ry, rz, seg: int = 10, depth: float = 1.15):
    """The HALO round a core of half sizes (rx, ry, rz) at c (frame as cap_mesh): the front cap of an ellipsoid
    HALO_SCALE x the core across and up, `depth` x its depth (the apex just in front of the core's), rings at
    HALO_RINGS of the lateral radius (the vertex alpha's stations). Returns (V, F), faces outward (toward Y)."""
    c = np.asarray(c, dtype=np.float64)
    ax = _frame(X, Y, Z)
    Rx, Rz, D = rx * HALO_SCALE, rz * HALO_SCALE, ry * depth
    V = [c + D * ax[1]]
    for rho in HALO_RINGS[1:]:
        dep = D * math.sqrt(max(0.0, 1.0 - rho * rho))
        for i in range(seg):
            a = 2.0 * math.pi * i / seg
            V.append(c + rho * math.cos(a) * Rx * ax[0] + dep * ax[1] + rho * math.sin(a) * Rz * ax[2])
    V = np.asarray(V)
    return V, orient_out(V, _cap_faces(seg, len(HALO_RINGS) - 1), c)


def _cap_faces(seg: int, rings: int) -> np.ndarray:
    """apex 0, then `rings` rings of `seg`; winding: outward for a cap whose apex points along +Y with X, Z the
    right-handed rows (X x Z = -Y, so the order runs a -> a+1 around +Y seen from the front)"""
    F = [(0, 1 + (i + 1) % seg, 1 + i) for i in range(seg)]
    for r in range(rings - 1):
        b0, b1 = 1 + r * seg, 1 + (r + 1) * seg
        for i in range(seg):
            j = (i + 1) % seg
            F += [(b0 + i, b0 + j, b1 + j), (b0 + i, b1 + j, b1 + i)]
    F = np.asarray(F, dtype=np.int64)
    return F


def orient_out(V, F, c):
    """flip faces so each normal points away from c (the cap's own centre)"""
    V, F = np.asarray(V, dtype=np.float64), np.asarray(F, dtype=np.int64).copy()
    cen = V[F].mean(axis=1)
    n = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    flip = np.einsum("ij,ij->i", n, cen - np.asarray(c, dtype=np.float64)[None]) < 0
    F[flip] = F[flip][:, ::-1]
    return F


def halo_material(ctx):
    """ctx.mats[HALO_MAT]: a copy of the accent (factor-only), alpha-blended; its emission a hair lower and its alpha
    below 1 so the optimizer's dedup can never merge it with the core (the export hook rewrites it anyway)."""
    if HALO_MAT in ctx.mats:
        return ctx.mats[HALO_MAT]
    acc = ctx.mats["accent"]
    m = acc.copy()
    m.name = HALO_MAT
    b = m.node_tree.nodes.get("BSDF") if m.use_nodes else None
    if b is not None:
        b.inputs["Alpha"].default_value = HALO_ALPHA0
        b.inputs["Emission Strength"].default_value = max(0.05, b.inputs["Emission Strength"].default_value - 0.02)
        b.inputs["Roughness"].default_value = 1.0
    for attr, val in (("surface_render_method", "BLENDED"), ("blend_method", "BLEND")):
        try:
            setattr(m, attr, val)
        except (AttributeError, TypeError):
            pass
    ctx.mats[HALO_MAT] = m
    return m


def _glb_read(path):
    import json
    import struct
    with open(path, "rb") as fh:
        data = fh.read()
    magic, ver, _ = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67:
        return None
    jlen, _jt = struct.unpack_from("<II", data, 12)
    js = json.loads(data[20:20 + jlen].decode("utf-8"))
    off = 20 + jlen
    bin_ = b""
    if off + 8 <= len(data):
        blen, _bt = struct.unpack_from("<II", data, off)
        bin_ = data[off + 8:off + 8 + blen]
    return ver, js, bytearray(bin_)


def _glb_write(path, ver, js, bin_):
    import json
    import struct
    raw = json.dumps(js, separators=(",", ":")).encode("utf-8")
    raw += b" " * ((4 - len(raw) % 4) % 4)
    bin_ = bytes(bin_) + b"\0" * ((4 - len(bin_) % 4) % 4)
    body = struct.pack("<II", len(raw), 0x4E4F534A) + raw + struct.pack("<II", len(bin_), 0x004E4942) + bin_
    with open(path, "wb") as fh:
        fh.write(struct.pack("<III", 0x46546C67, ver, 12 + len(body)) + body)


def _accessor_array(js, bin_, idx):
    acc = js["accessors"][idx]
    comp = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}[acc["componentType"]]
    ncomp = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[acc["type"]]
    bv = js["bufferViews"][acc["bufferView"]]
    start = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    isz = np.dtype(comp).itemsize
    stride = bv.get("byteStride", isz * ncomp)
    n = acc["count"]
    raw = np.frombuffer(bytes(bin_[start:start + stride * (n - 1) + isz * ncomp]), dtype=np.uint8)
    out = np.empty((n, ncomp), dtype=comp)
    for i in range(ncomp):
        out[:, i] = np.ndarray((n,), dtype=comp, buffer=raw.tobytes(), offset=i * isz, strides=(stride,))
    return out.astype(np.float64) if ncomp > 1 else out.reshape(-1).astype(np.int64)


def _halo_rho(P, F):
    """normalized lateral radius of every vertex of a halo primitive: per connected cap (vertices welded by position),
    the two widest principal axes span the cap's face; rho = the elliptic radius from the cap's centre (bbox centre
    on those axes), 1 at its rim"""
    n = len(P)
    key = np.round(P / 1e-5).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    inv = np.asarray(inv).reshape(-1)
    parent = np.arange(inv.max() + 1)

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for f in F.reshape(-1, 3):
        a, b, c = find(inv[f[0]]), find(inv[f[1]]), find(inv[f[2]])
        parent[b] = a
        parent[find(c)] = a
    comp = np.array([find(inv[i]) for i in range(n)])
    rho = np.zeros(n)
    for cid in np.unique(comp):
        sel = comp == cid
        Q = P[sel] - P[sel].mean(axis=0)
        _, _, vt = np.linalg.svd(Q, full_matrices=False)
        uv = Q @ vt[:2].T
        mid = 0.5 * (uv.max(axis=0) + uv.min(axis=0))
        uv = uv - mid
        half = np.maximum(np.abs(uv).max(axis=0), 1e-9)
        rho[sel] = np.sqrt(((uv / half) ** 2).sum(axis=1))
    return np.clip(rho, 0.0, 1.0)


def inject_halo(path: str) -> int:
    """GLB post-export (before the optimizer): every material named HALO_MAT becomes a BLEND copy of the core
    `accent` (same factors and extensions, name `accent`), and every primitive drawn with it gets a COLOR_0 (white,
    alpha = halo_alpha(rho)). Returns the primitives patched."""
    import json
    got = _glb_read(path)
    if got is None:
        return 0
    ver, js, bin_ = got
    mats = js.get("materials", [])
    halo = {i for i, m in enumerate(mats) if m.get("name") == HALO_MAT}
    if not halo:
        return 0
    core = next((m for m in mats if m.get("name") == "accent"), None)
    for i in halo:
        m = mats[i]
        src = core if core is not None else m
        pbr = dict(src.get("pbrMetallicRoughness", {}))
        bc = list(pbr.get("baseColorFactor", [1.0, 1.0, 1.0, 1.0]))[:3] + [1.0]
        new = {"name": "accent", "alphaMode": "BLEND", "doubleSided": False,
               "emissiveFactor": list(src.get("emissiveFactor", m.get("emissiveFactor", [0.25, 0.61, 1.0]))),
               "pbrMetallicRoughness": {"baseColorFactor": bc, "metallicFactor": 0.0, "roughnessFactor": 1.0}}
        if "extensions" in src:
            new["extensions"] = json.loads(json.dumps(src["extensions"]))
        m.clear()
        m.update(new)
    n = 0
    buf_views = js.setdefault("bufferViews", [])
    accs = js.setdefault("accessors", [])
    for mesh_ in js.get("meshes", []):
        for prim in mesh_.get("primitives", []):
            if prim.get("material") not in halo or "COLOR_0" in prim.get("attributes", {}):
                continue
            P = _accessor_array(js, bin_, prim["attributes"]["POSITION"])
            if "indices" in prim:
                F = _accessor_array(js, bin_, prim["indices"])
            else:
                F = np.arange(len(P))
            a = halo_alpha(_halo_rho(P, F))
            col = np.ones((len(P), 4), dtype=np.float32)
            col[:, 3] = a.astype(np.float32)
            pad = (4 - len(bin_) % 4) % 4
            bin_ += b"\0" * pad
            off = len(bin_)
            raw = col.tobytes()
            bin_ += raw
            buf_views.append({"buffer": 0, "byteOffset": off, "byteLength": len(raw), "target": 34962})
            accs.append({"bufferView": len(buf_views) - 1, "componentType": 5126, "count": int(len(P)), "type": "VEC4"})
            prim["attributes"]["COLOR_0"] = len(accs) - 1
            n += 1
    js["buffers"][0]["byteLength"] = len(bin_) + (4 - len(bin_) % 4) % 4
    _glb_write(path, ver, js, bin_)
    return n


def install_halo_export() -> None:
    """Wrap common.export.optimize once: inject_halo on the raw export, then the optimizer (which keeps COLOR_0,
    quantizes it, and dedups nothing of it: the halo differs from the core by alphaMode)."""
    from common import export
    if getattr(export.optimize, "_wick_halo", False):
        return
    orig = export.optimize

    def optimize(path, *a, **kw):
        k = inject_halo(path)
        if k:
            scene.log(f"wick halo: {k} hood-light halo primitive(s) -> BLEND accent + COLOR_0 alpha")
        return orig(path, *a, **kw)

    optimize._wick_halo = True
    export.optimize = optimize


# ── projection plates ────────────────────────────────────────────────────────────────────────────────
def graded_projection(concept: str, height: float, sat: float = 1.0, warm: tuple = (5.0, 55.0),
                      top_lift: float = 1.0, top_band: tuple = (0.22, 0.42), glow: tuple | None = None,
                      tag: str = "graded", **extra) -> dict:
    """Grade a concept's projection plates, then return the PROJECTION dict that projects the graded copy.

    Brief §5.2: the Serenade concepts are painted far more saturated and darker on top than the palette, and
    every concept paints lamp glow (team-neutral paint where the accent geometry must carry the light).
    Reads art/.cache/concept/<concept>_{front,back}.png + _plates.json (art/tools/concept_plates.py), writes
    <concept>_<tag>_{front,back}.png + _plates.json beside them, returns
    {"concept": "<concept>_<tag>", "height": height, **extra}. Call it in the spec's __init__ (runs in Blender):
        self.PROJECTION = wc.graded_projection("wicks/glimwick_serenade", 1.0, sat=0.5, top_lift=1.25, glow=(0.8, 0.5))
      sat        chroma scale (about the pixel's luma) for hues inside `warm` (degrees, 6 deg feather)
      top_lift   value gain on the top of each figure: full above top_band[0] of the crown-to-sole span,
                 fading to none at top_band[1] (lifts a dark hood into the bible's top band, L* 70-85)
      glow       (min_value, min_saturation) in 0..1: bright saturated pixels (painted lamp glow and its
                 spill) are refilled from the nearest other paint and softened. Aubade glow is pale blue
                 (saturation about 0.25), Serenade glow amber (about 0.6); check the result by eye.
    """
    import json
    from common.hifi import project
    cache = os.path.join(scene.CACHE_DIR, "concept")
    src = os.path.join(cache, f"{concept}_plates.json")
    if not os.path.isfile(src):
        raise SystemExit(f"no plates for {concept}: run art/tools/concept_plates.py {concept} --height <m> first")
    meta = json.load(open(src))
    out_id = f"{concept}_{tag}"
    result = dict({"concept": out_id, "height": float(height)}, **extra)
    # skip when the graded copy was made from these plates with these settings (about 30 s per concept)
    key = {"sat": sat, "warm": list(warm), "top_lift": top_lift, "top_band": list(top_band),
           "glow": list(glow) if glow else None,
           "src": [os.path.getmtime(os.path.join(cache, f"{concept}_{s}.png")) for s in ("front", "back")] +
                  [os.path.getmtime(src)]}
    done = os.path.join(cache, f"{out_id}_plates.json")
    if os.path.isfile(done) and all(os.path.isfile(os.path.join(cache, f"{out_id}_{s}.png")) for s in ("front", "back")):
        try:
            if json.load(open(done)).get("grade") == key:
                scene.log(f"graded plates {out_id}: up to date")
                return result
        except ValueError:
            pass
    for side in ("front", "back"):
        img = np.clip(project.load_rgb(os.path.join(cache, f"{concept}_{side}.png")), 0.0, 1.0)
        H, W = img.shape[:2]
        mx, mn = img.max(axis=2), img.min(axis=2)
        s = (mx - mn) / np.maximum(mx, 1e-4)
        if glow:
            m = (mx >= glow[0]) & (s >= glow[1])
            m = project.blur(m.astype(np.float32), 2.0) > 0.02                       # grow over the halo edge
            if m.any() and not m.all():
                iy, ix = project.nearest_index(~m)
                fill = project.blur(img[iy, ix], 6.0)
                a = project.blur(m.astype(np.float32), 2.0)[..., None]
                img = img * (1 - a) + fill * a
                mx, mn = img.max(axis=2), img.min(axis=2)
                s = (mx - mn) / np.maximum(mx, 1e-4)
        if sat != 1.0:
            r, g, b = img[..., 0], img[..., 1], img[..., 2]
            d = np.maximum(mx - mn, 1e-6)
            hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60.0
            lo, hi = warm
            w = np.clip(np.minimum(hue - lo, hi - hue) / 6.0 + 0.5, 0, 1) * (mx - mn > 1e-3)
            luma = (0.2126 * r + 0.7152 * g + 0.0722 * b)[..., None]
            img = luma + (img - luma) * (1 + (sat - 1) * w)[..., None]
        if top_lift != 1.0:
            gain = np.ones((H, W), dtype=np.float32)
            for half, (x0, x1) in (("front", (0, W // 2)), ("back", (W // 2, W))):
                top, ground = meta[half]["top"], meta[half]["ground"]
                t = (np.arange(H, dtype=np.float32) - top) / max(1, ground - top)
                u = np.clip((t - top_band[0]) / max(1e-3, top_band[1] - top_band[0]), 0, 1)
                u = u * u * (3 - 2 * u)
                gain[:, x0:x1] = (top_lift + (1 - top_lift) * u)[:, None]
            img = img * gain[..., None]
        project.save_rgb(np.clip(img, 0, 1), os.path.join(cache, f"{out_id}_{side}.png"))
    meta = dict(meta, id=out_id, grade=key)
    with open(done, "w") as f:
        json.dump(meta, f, indent=2)
    scene.log(f"graded plates {out_id}: sat {sat} in {warm}, top x{top_lift}, glow {glow}")
    return result


# ── runner ─────────────────────────────────────────────────────────────────────────────────────────────
def parse_args(default_faction: str):
    def extra(p):
        p.add_argument("--faction", default=default_faction, choices=FACTIONS + (LEGACY, "both", "all"),
                       help="aubade | serenade | both (= aubade + serenade) | legacy (today's <kind>.glb) | all")
        p.add_argument("--ids", default="", help="comma list of kinds or build ids (wicks.py driver)")
        p.add_argument("--clip-sheet", action="store_true", help="also render the three.js clip sheet")
    args = scene.parse_args(extra)
    args.no_render = True          # see the module docstring: wicks ship no splash/portrait/icon
    return args


def factions_of(arg: str) -> tuple:
    return {"both": FACTIONS, "all": (LEGACY,) + FACTIONS}.get(arg, (arg,))


def run(kinds: list, default_faction: str = "both") -> list:
    """Build every (kind, faction) the command line asks for; returns the build reports."""
    args = parse_args(default_faction)
    ids = {s for s in args.ids.split(",") if s}
    reports = []
    for cls in kinds:
        for fac in factions_of(args.faction):
            bid = cls.KIND_ID if fac == LEGACY else f"{cls.KIND_ID}_{fac}"
            if ids and cls.KIND_ID not in ids and bid not in ids:
                continue                 # filter before __init__ (a spec may grade plates there)
            reports.append(pipeline.build(cls(fac), args))
    return reports


if __name__ == "__main__":     # `art/build.py units` runs every units/*.py; this one is a library
    print("[wick_common] shared code, not a build target: run wicks.py or wick_<kind>.py")
