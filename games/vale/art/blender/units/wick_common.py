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
