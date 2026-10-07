"""_template — the VALE PRODUCTION TEMPLATE: one fighter (+ its skins) composed from the shared parts
library (common/parts.py). Copy, rename, fill each numbered section from the fighter's brief.

    cp art/blender/fighters/_template.py art/blender/fighters/<id>.py      # then set ID = "<id>"
    python3 art/build.py fighter <id> --fast --no-skins                      # iterate the base (fast bake/renders)
    python3 art/build.py portraits <id> --only splash --scale 0.5            # splash look-and-fix (from the cache)
    python3 art/build.py fighter <id> --clip-sheet                           # FINAL: base + every skin
    python3 art/tools/lineup_qa.py -- art/out/fighters/*/*.glb --name roster # roster readability gate

As shipped it is a runnable demo (an Aubade CASTER, "line + disc": peaked hood + staff = line, the
dial halo = disc) that writes to art/out/_template/ (ids starting with `_` never enter
art/out/fighters/). The quality bar is fighters/_lookdev_reference.py; the parts catalog is
art/renders/parts/sheet.png. LAW: _design/STYLE_BIBLE.md ("Fighters", "Look rules"), tokens.json
`fighter`, WORLD.md §2 (faces, materials), CONTRACT §12 (rig, clips, budgets), VOCAB.md (asset paths).

BRIEF -> CODE. The brief is `_design/fighters/<id>.md` when it exists, else the fighter's entry in
_design/ROSTER.md §3 ("### n · Name · Class (`id`)"). Map every brief section to one code section:

  brief                                                      code section
  ───────────────────────────────────────────────────────    ──────────────────────────────────────────
  header: Name · Class (`id`), Title, Origin, palette a / b  0 BRIEF: ID, TITLE, ROLE_MASS (class -> mass),
                                                               ORIGIN (face rule), CARD (palette a / b)
  Silhouette (<mass>, <height> m)                             1 PROPORTIONS: height class 1.6 / 1.9 / 2.4,
                                                               shoulder/hip ratio, SHAPE (girth, hands)
  Silhouette bullets (what the body wears)                    2 BODY (under-suit, boots) + 4 PARTS
  Origin + the mask / visor bullet                            3 FACE: parts.mask(style) | parts.visor(style)
  Hook at 96 px (the one shape that reads)                    4 PARTS: the hook part, built FIRST and BIG;
                                                               7 ACCENT: "...hold the accent" -> accent=True on it
  Weapon: <kind>, `<hold>` + how casts use it                 4 parts.<weapon>(...) + 8 MOTION weapon/stance
  Kit: Passive / A1 / A2 / A3 / Ultimate                      8 clip_overrides(): cast_a1 / cast_a2 / cast_a3 /
                                                               cast_ult = four DISTINCT gestures that act out
                                                               the ability (impact at 40 %), SOCKETS for VFX
  Presentation (lib_* presets, sfx)                           nothing to model; SOCKETS name the VFX attach bones
  Skins: *Name* (tier). colours. Extra geometry: ...          9 SKINS: {"id": "<id>_<variant>", palette, extra}

PER-FIGHTER CHECKLIST (sign-off; numbers from build_report_<id>.json, three QA and lineup_qa):
  [ ] tris 10-25k (base and every skin)                      [ ] GLB <= 1.2 MB (base and every skin)
  [ ] rig check passes (VALE_BIPED_1 + x_ only)               [ ] <= 2 sway bones per drapery (parts add them)
  [ ] three_load_test OK: every required clip (idle run attack1 attack2 cast_a1 cast_a2 cast_a3 cast_ult death
      recall idle_lobby victory), attack/cast frames multiple of 5, impact at 40 %, loops closed, run slide < 8 %
  [ ] cast_a1/a2/a3/ult read as four different gestures in three_clips_<id>.png; death ends on the ground
  [ ] silhouette: role mass reads in black at 64 px; IoU <= 0.80 against every roster fighter (lineup_qa)
  [ ] facing readable from above (mask beak/keel, asymmetric shoulder, weapon side)
  [ ] value bands on screen: top 70-85, middle 45-65, feet 20-35 L* (lineup_qa valueBands)
  [ ] accent 1.5-5 % of the silhouette, >= 90 % of it in the top half, never the brightest at rest
  [ ] only bible materials; no metal bevels, gold, gems, gears, clock hands, glowing runes, teal-and-gold
  [ ] splash: front three-quarter, subject in columns 7-12, feet grounded, sun behind-left, warm/cool rim,
      heroic pose, map backdrop; portrait 512² head and shoulders; icon 128² reads at a glance
  [ ] art.json copied verbatim into content/fighters/<id>.json `art`; skins.json fields into content/skins/

OUTPUT FILES (VOCAB.md; art/out/... maps 1:1 to assets/... in the catalog):
  art/out/fighters/<id>/<id>.glb  portrait.png  splash.png  icon.png  art.json (strict FighterArt)  skins.json
  art/out/fighters/<id>/<skin_id>.glb  <skin_id>_portrait.png  <skin_id>_splash.png
  QA: art/renders/fighters/<id>/turntable.png  three_<id>.png  three_clips_<id>.png  build_report_<sid>.json

MEASURED (4 shared CPUs, no GPU, bpy 5.2.2): this demo, base + 2 skins, full quality: see art/README.md
"Measured here" (≈ 15 min; --fast --no-skins ≈ 2.5 min).
"""
from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy  # noqa: E402,F401  (first: the bpy wheel registers mathutils on import)
from mathutils import Vector  # noqa: E402

from common import anim, body, fighter, materials, mesh, parts, rig  # noqa: E402
from common.anim import Aim, HandTarget  # noqa: E402

V = Vector

# 0 ── BRIEF ──────────────────────────────────────────────────────────────────────────────────────
ID = "_template"                      # == file name == content/fighters/<id>.json id (lower_snake_case)
TITLE = "Template Caster"             # brief "Title"
ROLE_MASS = "caster"                  # class -> mass: plinth block | breaker inverted wedge | striker forward
                                      # diagonal | slinger horizontal | caster line + disc | tender round + vessel
ORIGIN = "aubade"                     # aubade -> glass visor | serenade -> carved/lacquered mask | hourless -> wrap/hood
CARD = {"primary": "#24364a", "secondary": "#a9c4dc"}       # brief "palette a / b" (FighterDef.palette, UI)

# 1 ── PROPORTIONS (brief "Silhouette (<mass>, <height>)"): heroic 6-6.5 heads, big hands and feet ──
PROPORTIONS = rig.proportions(height=1.9, head=0.30, neck=0.065, shoulder_width=0.44, hip_width=0.20, leg=0.85,
                              arm=0.60, hand=0.20, foot=0.29, ankle_height=0.09, spine_curve=0.02, stance=0.03)
SHAPE = body.shape(girth=0.96, chest=0.98, waist=0.9, hips=0.96, arm=0.95, forearm=1.1, hand=1.45, leg=0.92,
                   neck=1.2, head_w=1.1, head_d=1.06, feet=False, hands=False)     # parts.glove makes the hands

# 5 ── PALETTE (bible vocabulary; pick values per value band) ──────────────────────────────────────
MATERIAL_SET = "bible"                # honed stone / glass / wood / cloth / leather; NO metal
PALETTE = materials.bible_palette(
    chalk="#e3ddce",                  # mask (top band: the brightest value, the head reads first)
    cloth2="#c9c3b4",                 # hood + capelet linen (top band)
    dawnglass="#a9c4dc",              # visor, halo disc, staff lens (cool glass, NOT emissive)
    cloth="#7d838c",                  # robe (middle band)
    wood="#ab8f6d", wood_dark="#5c4231",   # staff (pale ash), frames (walnut)
    leather="#665040", under="#4a4743",    # boots, gloves, belt / legs (feet band)
    accent="#3f9cff",                 # authored Dawn azure; the renderer tints it per viewer
)

# 6 ── VALUE GRADIENT (fraction of height -> multiplier): top 70-85, middle 45-65, feet 20-35 L* ──
VALUE_GRADIENT_STOPS = materials.BIBLE_GRADIENT_STOPS

# 8 ── MOTION (brief "Weapon: <kind>, `<hold>`") ──────────────────────────────────────────────────
BLOCKS = {}                           # per-fighter arm blocks over anim.ONE_HAND (see the reference's carry)
MOTION = anim.motion_profile(weight="light", weapon="staff", stance="neutral", run_ref_speed=3.5, blocks=BLOCKS)

# 10/11 ── EXPORT + RENDER settings ───────────────────────────────────────────────────────────────
SOCKETS = {"weapon_tip": "x_staff_tip"}          # FighterArt.sockets extras (VFX attach points)
SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.95}   # see common/render.py SPLASH_DEFAULTS
TEXTURE_SIZE = 1024
GLB_COMPRESS = True                   # quantize + WebP + int16 rotations (budget <= 1.2 MB)

# 9 ── SKINS (brief "Skins:"): <id>_<variant>; palette swaps + optional extra parts; same rig, clips,
#       silhouette class (height +-5 %, footprint +-10 %), accent places and value gradient ───────────
SKINS = [
    {"id": "_template_dusk",          # a Serenade-born look: ochre sandstone + walnut + lampresin
     "palette": {"chalk": "#d8c09a", "cloth2": "#c7b190", "cloth": "#86664f", "dawnglass": "#c98a3c",
                 "wood": "#6d4c34", "leather": "#5e4434", "under": "#4b3d2f"},
     "extra": {"staff_head": "vessel"},          # model() reads ctx.skin["extra"]
     "card": {"primary": "#3a2a20", "secondary": "#c98a3c"}},
    {"id": "_template_slate",         # a cool slate look + a stole (extra geometry inside the silhouette)
     "palette": {"chalk": "#dcdedf", "cloth2": "#b9c0c6", "cloth": "#5f6a75", "wood": "#8d8a84",
                 "leather": "#4f5257", "under": "#3f4348"},
     "extra": {"stole": True},
     "card": {"primary": "#1f2730", "secondary": "#b9c0c6"}},
]


# 2-4, 7 ── MODEL: proportions -> body -> face -> parts (order matters: later parts sit on earlier ones) ─
def model(ctx) -> list:
    info, M, col = ctx.info, ctx.mats, ctx.col
    extra = (ctx.skin or {}).get("extra", {})
    P = []

    # 2 BODY: fused sculpt (materials by region) + parts.boot shapes fused in (they skin with the legs)
    bp = body.humanoid_parts(info, SHAPE, col=col)
    for p in bp:
        mesh.set_material(p, M["cloth"] if p.name.startswith(("b_torso", "b_arm")) else
                          M["cloth2"] if p.name.startswith(("b_head", "b_neck")) else M["under"])
    for s in ("L", "R"):
        b = parts.boot(ctx, s, "wrapped")
        mesh.set_material(b, M["leather"])
        bp.append(b)
    hi = mesh.union_fillet(bp, voxel=0.0058, fillet=0.03, name="body_high", col=col)
    ctx.body_high, ctx.targets = hi, [hi]
    P.append(fighter.Part("body", high=hi, tris=5200, bind="auto", uv_weight=0.85))
    P += parts.glove(ctx, "fingers", pose="fist", mat="leather")
    P += parts.boot_trim(ctx, "wrapped", band="cloth2")

    # 3 FACE (Aubade): a smooth oval chalk mask under a dawnglass visor band
    P += parts.mask(ctx, "oval", mat="chalk")
    P += parts.visor(ctx, "band", accent=True)                 # 7 accent: a channel along the visor top

    # 4 PARTS. The HOOK (caster "line + disc"): a tall peaked hood (line) and the dial halo (disc)
    P += parts.hood(ctx, "peaked", mat="cloth2")
    P += parts.halo(ctx, "disc", radius=0.19, back=0.26, accent=True)   # 7 accent: the inlay ring on its face
    P += parts.mantle(ctx, "capelet", mat="cloth2")
    P += parts.belt(ctx, buckle="dial", pouches=[(64, 0.9), (-64, 0.9)])
    P += parts.tabard(ctx, mat="cloth", length=0.62, span=40.0, cut="point", chest=False)    # robe panels (x_ chains)
    P += parts.bracer(ctx, "wrap", mat="cloth2")
    if extra.get("stole"):                                      # 9 skin-only geometry
        P += parts.stole(ctx, mat="cloth2", length=0.5)
    P += parts.staff(ctx, head=extra.get("staff_head", "lens"), hand="R", socket="x_staff_tip")
    return P


# 8b ── secondary motion for the x_ chains the parts added (roles from the chain names) ─────────────
def chain_config(ctx) -> list:
    return parts.chain_configs(ctx)


# 8c ── ABILITY GESTURES: one bespoke clip per ability, four DISTINCT gestures, impact at 40 % ─────────
def clip_overrides(ctx) -> dict:
    """Brief kit -> gestures (the demo caster):
      cast_a1  "lens thrust"   step in, the staff driven lens-first at chest height (a bolt)
      cast_a2  "ground ring"   staff lifted, butt driven into the ground in front (a ring pulse)
      cast_a3  "arc sweep"     wide horizontal sweep of the staff head, right to left (a cone)
      cast_ult "raise the dial" crouch, rise, staff thrust overhead in both hands, wide stance (the zone)
    Every strike uses anim.strike_keys (counter, wind, coil, drive, IMPACT at 0.40, hold, follow,
    recover, settle) and anim.drag on head/neck so overlap never moves the impact frame."""
    prof = MOTION
    g = anim.guard(prof)
    gf = g["ik"]
    F = anim.FootTarget

    def step(dy_l=0.0, dy_r=0.0, dz_l=0.0, dz_r=0.0, pl=0.0, pr=0.0):
        fl, fr = gf["foot.L"], gf["foot.R"]
        return {"foot.L": F((fl.ankle[0], fl.ankle[1] + dy_l, fl.ankle[2] + dz_l), pl, fl.yaw),
                "foot.R": F((fr.ankle[0], fr.ankle[1] + dy_r, fr.ankle[2] + dz_r), pr, fr.yaw)}

    def two_hand(torso, hips, rel, aim, grip=0.36, pole=(-0.9, 0.3, -0.3), feet=None):
        p = anim.add(g, anim.P(**torso))
        ik = dict(g["ik"])
        ik["hand.R"] = HandTarget(rel=rel, pole=pole)
        ik["aim.R"] = Aim(aim)
        ik["hand.L"] = HandTarget(to_prop=("prop.R", grip), pole=(0.8, 0.4, -0.4))
        if feet:
            ik.update(feet)
        p["ik"] = ik
        hx, hy, hz = g.get("hips_loc", (0, 0, 0))
        p["hips_loc"] = (hx + hips[0], hy + hips[1], hz + hips[2])
        return p

    def strike(name, base, wind, hit, fol, lags=None):
        N = anim.frames_for(base, prof)
        return anim.Clip(name, N, False, anim.drag(anim.keyed(anim.strike_keys(prof, wind, hit, fol, g)), N,
                                                   lags or {"head": 1.5, "neck": 1.0}), impact=anim.IMPACT)

    out = {}
    # cast_a1 — lens thrust
    out["cast_a1"] = strike(
        "cast_a1", 30,
        two_hand(dict(hips=(-2, 14, 0), spine=(-2, 8, 0), chest=(-4, 10, 0), head=(-2, -12, 0)), (0, 0.05, 0.0),
                 (0.10, 0.10, -0.55), (0.0, -0.45, 0.89), grip=0.30),
        two_hand(dict(hips=(10, -10, 0), spine=(6, -6, 0), chest=(4, -8, 0), head=(-6, 8, 0)), (0, -0.16, -0.05),
                 (0.20, -0.95, -0.10), (0.0, -0.99, 0.12), grip=0.30, feet=step(dy_l=-0.24, pl=3)),
        two_hand(dict(hips=(11, -12, 0), spine=(7, -7, 0), chest=(5, -9, 0), head=(-7, 9, 0)), (0, -0.18, -0.06),
                 (0.22, -0.97, -0.08), (0.0, -0.99, 0.14), grip=0.30, feet=step(dy_l=-0.24, pl=2)))
    # cast_a2 — ground ring: staff up, butt driven down in front
    out["cast_a2"] = strike(
        "cast_a2", 30,
        two_hand(dict(hips=(-4, 0, 0), spine=(-6, 0, 0), chest=(-8, 0, 0), head=(-6, 0, 0)), (0, 0.02, 0.03),
                 (0.30, -0.35, 0.10), (0.0, 0.15, 0.99)),
        two_hand(dict(hips=(14, 0, 0), spine=(10, 0, 0), chest=(8, 0, 0), head=(-8, 0, 0)), (0, -0.04, -0.10),
                 (0.30, -0.55, -0.20), (0.0, 0.10, 0.99), feet=step(dy_l=-0.08)),
        two_hand(dict(hips=(15, 0, 0), spine=(11, 0, 0), chest=(9, 0, 0), head=(-9, 0, 0)), (0, -0.05, -0.11),
                 (0.30, -0.56, -0.24), (0.0, 0.10, 0.99), feet=step(dy_l=-0.08)), {"head": 2.0, "neck": 1.0})
    # cast_a3 — arc sweep: coiled right, the head carves a wide arc to the left at waist height
    out["cast_a3"] = strike(
        "cast_a3", 30,
        two_hand(dict(hips=(4, 30, 0), spine=(4, 16, 0), chest=(4, 20, 0), head=(-2, -22, 0)), (0, 0.04, -0.06),
                 (-0.10, 0.05, -0.55), (-0.85, 0.40, 0.34), pole=(-0.9, 0.4, 0.0)),
        two_hand(dict(hips=(8, -24, 0), spine=(6, -12, 0), chest=(4, -16, 0), head=(-6, 14, 0)), (0, -0.06, -0.10),
                 (0.45, -0.75, -0.30), (0.70, -0.70, 0.12), pole=(-0.7, 0.3, -0.6), feet=step(dy_l=-0.10, dy_r=0.06)),
        two_hand(dict(hips=(8, -40, 0), spine=(6, -18, 0), chest=(4, -24, 0), head=(-6, 20, 0)), (0, -0.06, -0.10),
                 (0.80, -0.30, -0.30), (0.98, 0.05, 0.15), pole=(-0.5, 0.6, -0.6), feet=step(dy_l=-0.10, dy_r=0.06)))
    # cast_ult — raise the dial: counter crouch, rise, staff thrust overhead, wide stance, settle
    wind = two_hand(dict(hips=(10, 0, 0), spine=(10, 0, 0), chest=(8, 0, 0), head=(6, 0, 0)), (0, 0.02, -0.12),
                    (0.30, -0.50, -0.55), (0.0, -0.3, -0.95))
    hit = two_hand(dict(hips=(-6, 0, 0), spine=(-8, 0, 0), chest=(-12, 0, 0), head=(-16, 0, 0)), (0, 0, 0.03),
                   (0.30, -0.15, 0.95), (0.0, -0.05, 1.0), feet=step(dy_l=-0.10, dy_r=0.08))
    fol = two_hand(dict(hips=(-5, 0, 0), spine=(-7, 0, 0), chest=(-10, 0, 0), head=(-14, 0, 0)), (0, 0, 0.02),
                   (0.30, -0.18, 0.92), (0.0, -0.08, 1.0), feet=step(dy_l=-0.10, dy_r=0.08))
    out["cast_ult"] = strike("cast_ult", 50, wind, hit, fol)
    return out


if __name__ == "__main__":
    fighter.main(sys.modules[__name__])
