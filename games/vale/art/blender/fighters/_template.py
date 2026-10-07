"""_template — the VALE PRODUCTION TEMPLATE for one fighter (+ its skins). Copy, rename, fill.

    cp art/blender/fighters/_template.py art/blender/fighters/<id>.py     # then set ID = "<id>"
    python3 art/build.py fighter <id> --fast --no-skins     # iterate (fast bake/renders)
    python3 art/build.py fighter <id> --clip-sheet           # full build: base + every skin
    python3 art/tools/lineup_qa.py -- art/out/fighters/*/*.glb   # roster readability (IoU, value, accent)

As shipped it is a runnable demo (an Aubade CASTER: line + disc) that writes to art/out/_template/
(ids starting with `_` never enter art/out/fighters/). The bible reference that sets the quality
bar is fighters/_lookdev_reference.py (a Serenade-faced BREAKER); read both before starting.

LAW: _design/STYLE_BIBLE.md ("Fighters", "Look rules"), tokens.json `fighter`, WORLD.md §2 (faces,
materials), CONTRACT §12 (rig, clips, budgets, outputs), VOCAB.md (asset paths).

FILE STRUCTURE (sections in this order; the shared pipeline in common/pipeline.py runs them):
   0 brief            ID / TITLE / ROLE_MASS / ORIGIN from content/fighters/<id>.json + the roster brief
   1 proportions      PROPORTIONS (heroic: 6-6.5 heads, head 0.29-0.31 m at 1.9 m) + SHAPE (big hands,
                      big feet). Height class: compact 1.6 / standard 1.9 / large 2.4 m. Skins NEVER change it.
   2 body             body.humanoid_parts + boots, fused by mesh.union_fillet (materials by region)
   3 face             kit.carved_mask (+ kit.mask_beak) | kit.glass_visor | kit.hood wrap. No bare face, no hair
   4 armour/cloth/props   kit.slab_pauldron, kit.limb_shell, kit.mantle, kit.drape, mesh.slab, mesh.loft/plate;
                      bevels 2-4 cm (the brushstroke); NO metal, gems, gold filigree, gears, clock hands, runes
   5 palette          PALETTE = materials.bible_palette(...) in the bible's vocabulary (chalk, stone,
                      sandstone, ironstone, dawnglass, lampresin, wood, wood_dark, cloth, cloth2, under,
                      leather, ink, accent); CARD = FighterDef.palette (UI backdrop colours)
   6 value gradient   VALUE_GRADIENT_STOPS (Z ramp); palette values chosen per band: top quarter L* 70-85,
                      middle 45-65, feet 20-35 ON SCREEN (lineup_qa measures it)
   7 accent           the `accent` material only, <= 5 % of the silhouette, all in the top half (crown,
                      shoulders, chest, weapon head), as carved glass inlays/fins - never a gem shape
   8 motion           MOTION = anim.motion_profile(weight, weapon, stance, run_ref_speed, blocks=BLOCKS)
                      + clip_overrides(ctx): cast_a1/a2/a3/ult are DISTINCT gestures (use
                      anim.strike_keys for the 40 % impact timing); victory ends in a hold; idle_lobby loops
   9 skins            SKINS: <id>_<variant> palette swaps + optional `extra` geometry flags read in model();
                      same rig, same clips (the client plays the base GLB's clips by bone name), same
                      silhouette class (height +-5 %, footprint +-10 %), same accent locations, same gradient
  10 export           automatic: GLB (KHR_mesh_quantization + EXT_texture_webp + int16 rotations) <= 1.2 MB,
                      art.json (exact FighterArt, zod .strict()), skins.json (SkinDef asset fields)
  11 renders          automatic (common/render.py): splash 1600x900 (front three-quarter, subject in grid
                      columns 7-12, painted map backdrop, sun behind-left of camera), portrait 512² (head and
                      shoulders), icon 128² (mask close-up), turntable QA; SPLASH tunes pose/camera/map

OUTPUT FILES (VOCAB.md; art/out/... maps 1:1 to assets/... in the catalog):
  art/out/fighters/<id>/<id>.glb  portrait.png  splash.png  icon.png  art.json  skins.json
  art/out/fighters/<id>/<skin_id>.glb  <skin_id>_portrait.png  <skin_id>_splash.png
  (the base skin id is `<id>_base` in content and points at the base files)
  QA: art/renders/fighters/<id>/turntable.png, three_<id>.png, three_clips_<id>.png, build_report_<id>.json

PER-FIGHTER CHECKLIST (sign-off; numbers from build_report_<id>.json, three QA and lineup_qa):
  [ ] tris 10-25k (base and every skin)                     [ ] GLB <= 1.2 MB (base and every skin)
  [ ] rig check passes (VALE_BIPED_1 + x_ only)              [ ] <= 2 sway bones per drapery (rigid drapery)
  [ ] every required clip: idle run attack1 attack2 cast_a1 cast_a2 cast_a3 cast_ult death recall
      idle_lobby victory; attack/cast frames multiple of 5, impact at 40 %; loops closed (three_load_test)
  [ ] run foot slide < 8 % at runRefSpeed (three_load_test)  [ ] death ends at rest on the ground
  [ ] cast_a1/a2/a3/ult read as four different gestures in three_clips_<id>.png
  [ ] silhouette: role mass reads in black at 64 px; IoU <= 0.80 against every roster fighter
  [ ] facing readable from above (mask beak, asymmetric shoulder, weapon side)
  [ ] value gradient on screen: top 70-85, middle 45-65, feet 20-35 L* (lineup_qa valueBands)
  [ ] accent <= 5 % of the silhouette, >= 90 % of it in the top half, never the brightest at rest
  [ ] no banned motifs (metal bevels, gold, gems, gears, clock hands, glowing runes, teal-and-gold)
  [ ] splash: front three-quarter, subject in columns 7-12, feet grounded, sun behind-left, map backdrop
  [ ] portrait 512² head and shoulders; icon 128² reads at a glance (mask + crown)
  [ ] art.json copied verbatim into content/fighters/<id>.json `art`; skins.json fields into content/skins/<id>.json
"""
from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy  # noqa: E402,F401  (first: the bpy wheel registers mathutils on import)
from mathutils import Vector  # noqa: E402

from common import anim, body, fighter, kit, materials, mesh, rig  # noqa: E402
from common.anim import Aim, HandTarget  # noqa: E402
from common.mesh import Cylindrical, Spherical  # noqa: E402

V = Vector

# 0 ── brief ────────────────────────────────────────────────────────────────────────────────────
ID = "_template"                      # == file name == content/fighters/<id>.json id (lower_snake_case)
TITLE = "Template Caster"
ROLE_MASS = "caster"                  # plinth | breaker | striker | slinger | caster | tender (bible: role is mass)
ORIGIN = "aubade"                     # aubade (glass visor) | serenade (carved mask) | hourless (wrap / hood)

# 1 ── proportions + shape (heroic: 6.3 heads, big hands and feet) ─────────────────────────────────
PROPORTIONS = rig.proportions(height=1.9, head=0.30, neck=0.065, shoulder_width=0.44, hip_width=0.20, leg=0.85,
                              arm=0.60, hand=0.20, foot=0.29, ankle_height=0.09, spine_curve=0.02, stance=0.03)
SHAPE = body.shape(girth=0.96, chest=0.98, waist=0.9, hips=0.96, arm=0.95, forearm=1.1, hand=1.45, leg=0.92,
                   neck=1.2, head_w=1.1, head_d=1.06, feet=False)

# 5 ── palette (bible vocabulary; values picked per value band) + card ─────────────────────────────
MATERIAL_SET = "bible"                # honed stone / glass / wood / cloth; NO metal
PALETTE = materials.bible_palette(
    chalk="#d8d3c6",                  # headpiece spire + mask (top band, brightest)
    dawnglass="#a9c4dc",              # visor + halo disc + staff lens (cool glass, NOT emissive)
    cloth2="#b9b6ac",                 # hood wrap + collar (top band)
    cloth="#6c7480",                  # robe (middle band)
    wood="#a68a68",                   # staff + bracers (pale ash)
    leather="#3e3936", under="#2e3034",   # boots + legs (feet band)
    accent="#3f9cff",                 # authored Dawn azure; the renderer tints it per viewer
)
CARD = {"primary": "#24364a", "secondary": "#a9c4dc"}

# 6 ── value gradient (fraction of height -> multiplier) ─────────────────────────────────────────
VALUE_GRADIENT_STOPS = [(0.0, 0.62), (0.12, 0.70), (0.30, 0.84), (0.55, 0.95), (0.80, 1.02), (1.0, 1.06)]

# 8 ── motion profile (+ per-fighter arm blocks over anim.ONE_HAND) ──────────────────────────────
BLOCKS = {}                           # e.g. {"guard": ((rel), (pole), (aim), (off rel), (off pole))}
MOTION = anim.motion_profile(weight="light", weapon="staff", stance="neutral", run_ref_speed=3.5, blocks=BLOCKS)

# 10/11 ── export + render settings ─────────────────────────────────────────────────────────────
SOCKETS = {"weapon_tip": "x_staff_tip"}          # FighterArt.sockets extras (VFX attach points)
SPLASH = {"map": "map_rift", "clip": "idle_lobby", "t": 0.0}   # see common/render.py SPLASH_DEFAULTS
TEXTURE_SIZE = 1024
GLB_COMPRESS = True                   # quantize + WebP + int16 rotations (fighter budget <= 1.2 MB)

# 9 ── skins: <id>_<variant>; palette swaps + optional extra geometry; same rig/clips/accent places ─
SKINS = [
    {"id": "_template_dusk",
     "palette": {"chalk": "#cbb08c", "cloth2": "#a8927a", "cloth": "#6e4f3f", "dawnglass": "#c98a3c",
                 "wood": "#6d4c34", "leather": "#3b2c22", "under": "#30281f"},
     "extra": {"resin_lantern": True},           # model() reads ctx.skin["extra"]
     "card": {"primary": "#3a2a20", "secondary": "#c98a3c"}},
]


# 6b ── rig extras: x_ chains (<= 2 sway bones per drapery) and x_ sockets ─────────────────────────
def rig_extras(ctx) -> None:
    J = ctx.info.joints
    zt = J["spine0"].z - 0.06
    ctx.chains["robe_f"] = rig.add_chain(ctx.info, "robe_f", "hips", [V((0, -0.14, zt)), V((0, -0.17, zt - 0.62))])
    ctx.chains["robe_b"] = rig.add_chain(ctx.info, "robe_b", "hips", [V((0, 0.15, zt)), V((0, 0.19, zt - 0.66))],
                                         z_hint=(0, 1, 0))
    rig.add_socket(ctx.info, "x_staff_tip", "prop.R", rig.prop_matrix(ctx.info, "prop.R") @ V((0, 0, 1.02)))


# 2-4, 7 ── model ─────────────────────────────────────────────────────────────────────────────
def model(ctx) -> list:
    info, M, col = ctx.info, ctx.mats, ctx.col
    J = info.joints
    extra = (ctx.skin or {}).get("extra", {})
    P = []

    # 2 body: fused sculpt; materials by region (robe torso/arms, dark legs, leather hands + boots)
    parts = body.humanoid_parts(info, SHAPE, col=col)
    for p in parts:
        mat = M["leather"] if p.name.startswith("b_hand") else M["cloth"] if p.name.startswith(("b_torso", "b_arm")) \
            else M["under"]
        mesh.set_material(p, mat)
    for s in ("L", "R"):
        b = body.boot(info, s, col=col, cuff=True, height=0.32, width=1.2, name=f"b_boot.{s}")
        mesh.set_material(b, M["leather"])
        parts.append(b)
    hi = mesh.union_fillet(parts, voxel=0.0058, fillet=0.03, name="body_high", col=col)
    ctx.body_high, ctx.targets = hi, [hi]
    P.append(fighter.Part("body", high=hi, tris=5600, bind="auto", uv_weight=0.85))

    # 3 face (Aubade): carved chalk mask + a dawnglass visor band; a cloth wrap hood around it
    mask = kit.carved_mask(ctx, M["chalk"], M["ink"], target=[hi], lift=0.014, eye=(26.0, 88.0, 13.0, 4.0), col=col)
    P.append(fighter.Part("mask", low=mask, bind="bone:head", uv_weight=1.6))
    visor = kit.glass_visor(ctx, M["dawnglass"], [mask], v0=79.0, v1=96.0, lift=0.005, col=col)
    P.append(fighter.Part("visor", low=visor, bind="bone:head", uv_weight=1.2))
    hood = kit.hood(ctx, M["cloth2"], target=[hi, mask], lift=0.03, open_deg=68.0, peak=0.0, folds=6, col=col)
    hb = J["head_base"]
    P.append(fighter.Part("hood", low=hood, bind=("zblend", "neck", "head", hb.z - 0.06, hb.z + 0.02), uv_weight=1.2))

    # 4a caster "line + disc": a chalk spire headpiece (line) and a dawnglass dial halo (disc)
    hc, hr = kit.head_frame(info)
    top = kit.surface(Spherical(hc), 0, 1e-3, mesh.bvh_of([hood]), -0.01)
    spire = mesh.loft([{"p": top, "rx": 0.05, "ry": 0.04, "exp": 2.2},
                       {"p": top + V((0, 0.01, 0.10)), "rx": 0.035, "ry": 0.03, "exp": 2.2},
                       {"p": top + V((0, 0.02, 0.24)), "rx": 0.006, "ry": 0.006}], segments=8, caps=("flat", "point"),
                      up=(0, -1, 0), name="spire", col=col)
    mesh.set_material(spire, M["chalk"])
    P.append(fighter.Part("spire", low=spire, bind="bone:head"))
    hcen = hc + V((0, 0.17, 0.06))
    halo = mesh.loft([{"p": hcen + V((0, -0.012, 0)), "rx": 0.20, "ry": 0.20, "exp": 2.0},
                      {"p": hcen + V((0, 0.012, 0)), "rx": 0.20, "ry": 0.20, "exp": 2.0}], segments=28,
                     caps=("flat", "flat"), up=(0, 0, 1), name="halo", col=col, smooth_path=False, rings=2)
    mesh.bevel(halo, 0.008, 2, angle=30)
    mesh.set_material(halo, M["dawnglass"])
    P.append(fighter.Part("halo", low=halo, bind="bone:head", uv_weight=0.8))

    # 7 accent: an inlay ring on the halo's face + a strip up the spire (top half only, <= 5 %)
    ring = [hcen + V((math.cos(a) * 0.17, -0.016, math.sin(a) * 0.17)) for a in [2 * math.pi * i / 24 for i in range(25)]]
    acc = mesh.sweep(ring, [(0.016, 0.006)] * 25, segments=6, caps=(None, None), up=(0, -1, 0), name="halo_inlay",
                     col=col)
    mesh.cleanup(acc, merge=1e-4)
    mesh.set_material(acc, M["accent"])
    P.append(fighter.Part("halo_inlay", low=acc, bind="bone:head"))

    # 4b collar + robe drapes (rigid drapery on one-bone chains) + sash
    nb = J["neck_base"]
    collar = kit.scarf(ctx, M["cloth2"], [hi], z=nb.z - 0.004, thick=0.03, depth=0.044, cowl=0.04, bunch=0.12,
                       name="collar", col=col)
    P.append(fighter.Part("collar", low=collar, bind=("zblend", "chest", "neck", nb.z - 0.07, nb.z + 0.03)))
    axis = Cylindrical((0, 0, 0), (0, 0, 1), ref=(0, -1, 0))
    s0 = J["spine0"]
    sash = mesh.plate(axis, [(s0.z + 0.04, -180, 180), (s0.z - 0.05, -180, 180)], target=[hi], offset=0.014,
                      thickness=0.016, cols=30, smooth_iters=8, wrap=True, bevel_w=0.006, name="sash", col=col,
                      mat=M["cloth2"])
    P.append(fighter.Part("sash", low=sash, bind="bone:hips"))
    st = mesh.bvh_of([sash])
    z = s0.z - 0.05
    for nm, u0, u1, L, out in (("robe_f", -36, 36, 0.62, (0, -1, 0)), ("robe_b", 140, 220, 0.68, (0, 1, 0))):
        top = [kit.surface(axis, u0 + (u1 - u0) * i / 6, z, st, 0.006) for i in range(7)]
        d = kit.drape(top, L, M["cloth"], folds=3, fold_depth=0.016, flare=0.08, avoid=[hi], clearance=0.035,
                      hem=lambda u: 0.05 * math.sin(math.pi * u), out_dir=out, name=nm, col=col, seed=len(nm))
        P.append(fighter.Part(nm, low=d, bind=("chain", nm, "hips")))

    # 4c bracers (carved ash)
    for s in ("L", "R"):
        br = kit.limb_shell(ctx, f"elbow.{s}", f"wrist.{s}", M["wood"], [hi], t0=0.3, t1=0.97, thickness=0.02,
                            bevel_w=0.008, cols=14, name=f"bracer.{s}", col=col)
        P.append(fighter.Part(f"bracer.{s}", low=br, bind=f"bone:forearm.{s}"))

    # 4d prop: staff on prop.R (prop space: grip at the origin, shaft +Z, face -Y)
    shaft = mesh.loft([{"p": (0, 0, -0.78), "rx": 0.016, "ry": 0.016}, {"p": (0, 0, 0.0), "rx": 0.02, "ry": 0.02},
                       {"p": (0, 0, 0.80), "rx": 0.018, "ry": 0.018}], segments=8, caps=("round", "flat"),
                      name="staff", col=col, rings=14)
    mesh.set_material(shaft, M["wood"])
    head = mesh.loft([{"p": (0, 0, 0.78), "rx": 0.03, "ry": 0.03}, {"p": (0, 0, 0.84), "rx": 0.075, "ry": 0.022, "exp": 2.6},
                      {"p": (0, 0, 1.0), "rx": 0.085, "ry": 0.024, "exp": 2.6}, {"p": (0, 0, 1.06), "rx": 0.03, "ry": 0.02}],
                     segments=12, caps=("flat", "round"), up=(0, -1, 0), name="staff_head", col=col)
    mesh.set_material(head, M["chalk"])
    if extra.get("resin_lantern"):               # 9: skin-only geometry: a lampresin vessel replaces the lens
        lens = mesh.loft([{"p": (0, 0, 0.86), "rx": 0.03, "ry": 0.03}, {"p": (0, 0, 0.92), "rx": 0.055, "ry": 0.055},
                          {"p": (0, 0, 0.99), "rx": 0.04, "ry": 0.04}], segments=12, caps=("round", "round"),
                         up=(0, -1, 0), name="staff_lens", col=col)
        mesh.set_material(lens, M["lampresin"])
    else:
        lens = mesh.loft([{"p": (0, 0.0, 0.92), "rx": 0.06, "ry": 0.008}, {"p": (0, -0.012, 0.92), "rx": 0.062, "ry": 0.012},
                          {"p": (0, -0.022, 0.92), "rx": 0.05, "ry": 0.006}], segments=14, caps=("flat", "round"),
                         up=(0, 0, 1), name="staff_lens", col=col, smooth_path=False, rings=3)
        mesh.set_material(lens, M["dawnglass"])
    mw = rig.prop_matrix(info, "prop.R")
    for o in (shaft, head, lens):
        o.data.transform(mw)
    P += [fighter.Part("staff", low=shaft, bind="bone:prop.R"), fighter.Part("staff_head", low=head, bind="bone:prop.R"),
          fighter.Part("staff_lens", low=lens, bind="bone:prop.R")]
    return P


# 8b ── secondary motion for the x_ chains ─────────────────────────────────────────────────────
def chain_config(ctx) -> list:
    def push_f(p):
        return 0.7 * max(0.0, p.get("thigh.L", (0, 0, 0))[0], p.get("thigh.R", (0, 0, 0))[0])

    def push_b(p):
        return 0.7 * max(0.0, -min(p.get("thigh.L", (0, 0, 0))[0], p.get("thigh.R", (0, 0, 0))[0]))

    return [anim.ChainCfg(ctx.chains["robe_f"], gravity=0.8, drive=push_f, limit=(-55.0, 55.0)),
            anim.ChainCfg(ctx.chains["robe_b"], gravity=0.8, drive=push_b, limit=(-55.0, 55.0))]


# 8c ── bespoke clips: each ability a DISTINCT gesture; impact at 40 % (anim.strike_keys) ──────────
def clip_overrides(ctx) -> dict:
    """Generated: attack1/attack2 (staff strikes), cast_a1 = thrust (the lens aimed forward),
    cast_a3 = sweep. Bespoke here: cast_a2 = the staff butt driven into the ground (a ring pulse),
    cast_ult = the halo raised overhead on the staff (wide stance, both hands)."""
    prof = MOTION
    g = anim.guard(prof)

    def two_hand(torso, hips, rel, aim, grip=0.36, pole=(-0.9, 0.3, -0.3)):
        p = anim.add(g, anim.P(**torso))
        ik = dict(g["ik"])
        ik["hand.R"] = HandTarget(rel=rel, pole=pole)
        ik["aim.R"] = Aim(aim)
        ik["hand.L"] = HandTarget(to_prop=("prop.R", grip), pole=(0.8, 0.4, -0.4))
        p["ik"] = ik
        hx, hy, hz = g.get("hips_loc", (0, 0, 0))
        p["hips_loc"] = (hx + hips[0], hy + hips[1], hz + hips[2])
        return p

    out = {}
    wind = two_hand(dict(hips=(-4, 0, 0), spine=(-6, 0, 0), chest=(-8, 0, 0), head=(-6, 0, 0)), (0, 0.02, 0.03),
                    (0.30, -0.35, 0.10), (0.0, 0.15, 0.99))
    hit = two_hand(dict(hips=(14, 0, 0), spine=(10, 0, 0), chest=(8, 0, 0), head=(-8, 0, 0)), (0, -0.04, -0.10),
                   (0.30, -0.55, -0.20), (0.0, 0.10, 0.99))
    fol = two_hand(dict(hips=(15, 0, 0), spine=(11, 0, 0), chest=(9, 0, 0), head=(-9, 0, 0)), (0, -0.05, -0.11),
                   (0.30, -0.56, -0.24), (0.0, 0.10, 0.99))
    N = anim.frames_for(30, prof)
    out["cast_a2"] = anim.Clip("cast_a2", N, False, anim.drag(anim.keyed(anim.strike_keys(prof, wind, hit, fol, g)), N,
                                                               {"head": 1.5, "neck": 1.0}), impact=anim.IMPACT)
    wind = two_hand(dict(hips=(10, 0, 0), spine=(10, 0, 0), chest=(8, 0, 0), head=(6, 0, 0)), (0, 0.02, -0.10),
                    (0.30, -0.50, -0.55), (0.0, -0.3, -0.95))
    hit = two_hand(dict(hips=(-6, 0, 0), spine=(-8, 0, 0), chest=(-12, 0, 0), head=(-16, 0, 0)), (0, 0, 0.02),
                   (0.30, -0.15, 0.95), (0.0, -0.05, 1.0))
    fol = two_hand(dict(hips=(-5, 0, 0), spine=(-7, 0, 0), chest=(-10, 0, 0), head=(-14, 0, 0)), (0, 0, 0.01),
                   (0.30, -0.18, 0.92), (0.0, -0.08, 1.0))
    N = anim.frames_for(50, prof)
    out["cast_ult"] = anim.Clip("cast_ult", N, False, anim.drag(anim.keyed(anim.strike_keys(prof, wind, hit, fol, g)), N,
                                                                 {"head": 1.5, "neck": 1.0}), impact=anim.IMPACT)
    return out


if __name__ == "__main__":
    fighter.main(sys.modules[__name__])
