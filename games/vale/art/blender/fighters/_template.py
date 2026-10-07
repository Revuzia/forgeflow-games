"""_template — copy to art/blender/fighters/<id>.py to start a fighter. Runnable as a demo:

    python3 art/build.py fighter _template --fast       # -> art/out/_template/ (ids starting with _ stay out of fighters/)

A fighter script is DATA + hand-authored modelling sections; the shared pipeline does the rest
(common/pipeline.py): rig -> model -> bind -> UV -> bake -> clips -> GLB -> optimise -> renders
-> skins -> report. Sections, in order:

  1. identity        ID (must equal the file name and content/fighters/<id>.json), OUT_SUBDIR (only
                     for technical builds; fighters use art/out/fighters/<id>/)
  2. proportions     rig.proportions(...) — drives the VALE_BIPED_1 rest pose; skins may NOT change it
  3. shape           body.shape(...) — girth/limb multipliers for the fused base body
  4. palette         materials.palette(...) — every colour the materials use (style bible drives it);
                     CARD = FighterDef.palette (portrait / splash backdrop)
  5. motion          anim.motion_profile(weight, weapon, stance, run_ref_speed) — the standard clip
                     generators read it; run_ref_speed goes to FighterDef.art.runRefSpeed
  6. rig_extras      x_ chains (capes, tails, ears, hair, wings) and x_ sockets
  7. model           hand-authored sections returning fighter.Part list (body, armour, cloth, props,
                     accent). Branch on ctx.skin for skin-only geometry.
  8. chain_config    secondary motion for the x_ chains (gravity, springs, drivers)
  9. clip_overrides  bespoke clips: replace any generated clip or add optional ones
 10. SKINS           alternate palettes (+ optional extra geometry) exported as separate GLBs that
                     share the rig (no clips: the client plays the base GLB's clips by bone name)

Rules: no primitive shapes as final art (use lofts/plates/cloth/union_fillet), deterministic (use
scene.rng(...) for any variation), budgets 10–25k tris, one 1024² texture set + `accent`.
"""
from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy  # noqa: E402,F401  (first: the bpy wheel registers mathutils on import)
from mathutils import Vector  # noqa: E402

from common import anim, body, fighter, materials, mesh, rig  # noqa: E402
from common.mesh import Cylindrical, Spherical  # noqa: E402

V = Vector

# 1 ── identity ──────────────────────────────────────────────────────────────────────────────────
ID = "_template"
TITLE = "Template Wanderer"

# 2 ── proportions (VALE_BIPED_1 rest pose; metres) ─────────────────────────────────────────────
PROPORTIONS = rig.proportions(height=1.80, shoulder_width=0.44, hip_width=0.22, leg=0.85, arm=0.57,
                              head=0.245, spine_curve=0.02, a_pose_deg=45.0)

# 3 ── base body shape ───────────────────────────────────────────────────────────────────────────
SHAPE = body.shape(girth=0.95, chest=0.98, waist=0.95, arm=0.95, forearm=1.0, leg=0.97, feet=False, hand=1.2)

# 4 ── palette (hex, style bible) + card colours ─────────────────────────────────────────────────
PALETTE = materials.palette(cloth="#55306b", cloth2="#d9c9a3", under="#2b2a33", leather="#5b3f2a",
                            leather_dark="#33241a", metal="#8e8a80", trim="#b98f45", skin="#c58f6e",
                            wood="#6d4a2e", gem="#8ff0d0", accent="#8ff0d0")
CARD = {"primary": "#3b2350", "secondary": "#8ff0d0"}

# 5 ── motion profile ────────────────────────────────────────────────────────────────────────────
MOTION = anim.motion_profile(weight="light", weapon="staff", stance="neutral", run_ref_speed=3.4)

# 10 ── skins (palette swaps + optional extra geometry; same rig) ────────────────────────────────
SKINS = [
    {"id": "_template_frost", "palette": {"cloth": "#2f5f7a", "cloth2": "#e8eef2", "trim": "#c9d6e0",
                                           "accent": "#9fe0ff", "gem": "#9fe0ff"},
     "card": {"primary": "#1d3546", "secondary": "#9fe0ff"}, "extra": {"mantle_spikes": True}},
]


# 6 ── rig extras ────────────────────────────────────────────────────────────────────────────────
def rig_extras(ctx) -> None:
    J = ctx.info.joints
    nb = J["neck_base"]
    top = V((0, nb.y + 0.11, nb.z - 0.05))
    ctx.chains["cape"] = rig.add_chain(ctx.info, "cape", "chest",
                                       [top, top + V((0, 0.04, -0.38)), top + V((0, 0.08, -0.78)),
                                        top + V((0, 0.12, -1.12))], z_hint=(0, 1, 0))
    rig.add_socket(ctx.info, "x_staff_tip", "prop.R", rig.prop_matrix(ctx.info, "prop.R") @ V((0, 0, 0.95)))


# 7 ── model: hand-authored sections ────────────────────────────────────────────────────────────
def model(ctx) -> list:
    info, M, col = ctx.info, ctx.mats, ctx.col
    J = info.joints
    P = []
    extra = (ctx.skin or {}).get("extra", {})

    # 7a body: lofted anatomy fused into one sculpt (face/hands in skin, suit in `under`)
    parts = body.humanoid_parts(info, SHAPE, col=col)
    for p in parts:
        mesh.set_material(p, M["skin"] if p.name in ("b_head",) or p.name.startswith("b_hand") else M["under"])
    for s in ("L", "R"):
        b = body.boot(info, s, col=col, cuff=True, height=0.34, name=f"b_boot.{s}")
        mesh.set_material(b, M["leather_dark"])
        parts.append(b)
    hi = mesh.union_fillet(parts, voxel=0.0055, fillet=0.03, name="body_high", col=col)
    ctx.targets = [hi]
    P.append(fighter.Part("body", high=hi, tris=8000, bind="auto", uv_weight=1.0))

    # 7b hood: a conformed cloth shell around the head, open at the face
    hb = J["head_base"]
    hood = mesh.plate(Spherical(V((0, hb.y + 0.01, hb.z + 0.09))),
                      [(0, -180, 180), (60, -180, 180), (95, -140, 140), (125, -120, 120)],
                      target=ctx.targets, offset=0.03, thickness=0.012, cols=26, rows_n=10, smooth_iters=12,
                      shape_fn=lambda u, v, r: 0.03 * max(0.0, -math.cos(math.radians(u))) * mesh.smoothstep(40, 120, v),
                      rim=0.012, rim_height=0.003, bevel_w=0.003, name="hood", col=col,
                      mat=M["cloth"], rim_mat=M["cloth2"], inner=True)
    P.append(fighter.Part("hood", low=hood, bind=("zblend", "neck", "head", hb.z - 0.04, hb.z + 0.02), uv_weight=1.3))

    # 7c sash + belt: plates projected over the body
    s0 = J["spine0"]
    axis = Cylindrical((0, 0, 0), (0, 0, 1))
    belt = mesh.plate(axis, [(s0.z + 0.03, -180, 180), (s0.z - 0.04, -180, 180)], target=ctx.targets, offset=0.008,
                      thickness=0.006, cols=36, wrap=True, rim=0.006, name="belt", col=col, mat=M["leather"],
                      rim_mat=M["trim"])
    P.append(fighter.Part("belt", low=belt, bind="bone:hips"))

    # 7d bracers
    for s in ("L", "R"):
        el, wr = J[f"elbow.{s}"], J[f"wrist.{s}"]
        fa = (wr - el).length
        br = mesh.plate(Cylindrical(el, (wr - el).normalized(), ref=(0, 0, 1)),
                        [(fa * 0.35, -180, 180), (fa * 0.98, -180, 180)], target=ctx.targets, offset=0.01,
                        thickness=0.006, cols=16, wrap=True, rim=0.008, name=f"bracer.{s}", col=col,
                        mat=M["leather"], rim_mat=M["trim"])
        P.append(fighter.Part(f"bracer.{s}", low=br, bind=f"bone:forearm.{s}"))

    # 7e cape on the x_cape chain (cloth panel hanging from the shoulders)
    nb = J["neck_base"]
    top = [V((x, nb.y + 0.10 + 0.25 * x * x, nb.z - 0.04 - 0.3 * abs(x))) for x in (-0.20, -0.12, -0.04, 0.04, 0.12, 0.20)]
    cape = mesh.cloth_panel(top, 1.05, folds=5, fold_depth=0.016, flare=0.14, out_dir=(0, 1, 0),
                            hem=lambda u: 0.06 * math.sin(math.pi * u), avoid=ctx.targets, clearance=0.04,
                            name="cape", col=col, seed=4, rows=16)
    mesh.set_material(cape, M["cloth"])
    P.append(fighter.Part("cape", low=cape, bind=("chain", "cape", "chest")))
    # cloak clasp at the collar (accent, chest/top half): a second, always-visible readability spot
    o, d = Cylindrical((0, 0, 0), (0, 0, 1)).ray(0, nb.z - 0.06)
    cz = o + d * ((mesh._surface_r(mesh.bvh_of(ctx.targets), o, d, 0.6) or 0.14) + 0.012)
    clasp = mesh.loft([{"p": cz + V((0, 0.006, 0.045)), "rx": 0.008, "ry": 0.006},
                       {"p": cz + V((0, -0.008, 0.0)), "rx": 0.042, "ry": 0.014, "exp": 1.4},
                       {"p": cz + V((0, 0.006, -0.045)), "rx": 0.008, "ry": 0.006}],
                      segments=8, caps=("point", "point"), up=(0, -1, 0), name="clasp", col=col)
    mesh.shade(clasp, smooth=False)
    mesh.set_material(clasp, M["accent"])
    P.append(fighter.Part("clasp", low=clasp, bind="bone:chest"))

    # 7f skin-only geometry example
    if extra.get("mantle_spikes"):
        for s, sx in (("L", 1), ("R", -1)):
            sh = J[f"shoulder.{s}"]
            spike = mesh.loft([{"p": sh + V((0, 0.02, 0.06)), "rx": 0.03, "ry": 0.03},
                               {"p": sh + V((0.06 * sx, 0.03, 0.16)), "rx": 0.012, "ry": 0.012}],
                              segments=8, caps=("flat", "point"), name=f"spike.{s}", col=col)
            mesh.set_material(spike, M["trim"])
            P.append(fighter.Part(f"spike.{s}", low=spike, bind=f"bone:shoulder.{s}"))

    # 7g prop: staff on prop.R (prop space: grip at origin, shaft +Z, face -Y), crystal = accent
    shaft = mesh.loft([{"p": (0, 0, -0.75), "rx": 0.014, "ry": 0.014}, {"p": (0, 0, 0.0), "rx": 0.017, "ry": 0.017},
                       {"p": (0.01, 0, 0.62), "rx": 0.015, "ry": 0.015}, {"p": (-0.03, 0, 0.86), "rx": 0.02, "ry": 0.02}],
                      segments=10, caps=("round", "round"), name="staff", col=col, rings=24)
    mesh.set_material(shaft, M["wood"])
    claw = mesh.loft([{"p": (-0.03, 0, 0.84), "rx": 0.03, "ry": 0.03}, {"p": (0.0, 0, 0.92), "rx": 0.045, "ry": 0.04},
                      {"p": (0.02, 0, 1.02), "rx": 0.02, "ry": 0.02}], segments=10, caps=("flat", "point"),
                     name="staff_head", col=col)
    mesh.set_material(claw, M["trim"])
    # the accent must READ at the game camera (bible: ~2-6 % of the silhouette, top half): the build
    # warns below 1.5 % (three QA accentPct). A thumbnail-sized gem is invisible at 100 px.
    crystal = mesh.loft([{"p": (0.0, 0, 0.88), "rx": 0.006, "ry": 0.006},
                         {"p": (0.0, -0.002, 0.97), "rx": 0.068, "ry": 0.06, "exp": 1.2},
                         {"p": (0.0, 0, 1.10), "rx": 0.006, "ry": 0.006}], segments=6, caps=("point", "point"),
                        name="staff_crystal", col=col)
    mesh.shade(crystal, smooth=False)
    mesh.set_material(crystal, M["accent"])
    mw = rig.prop_matrix(info, "prop.R")
    for o in (shaft, claw, crystal):
        o.data.transform(mw)
    P += [fighter.Part("staff", low=shaft, bind="bone:prop.R"), fighter.Part("staff_head", low=claw, bind="bone:prop.R"),
          fighter.Part("staff_crystal", low=crystal, bind="bone:prop.R")]
    return P


# 8 ── secondary motion for x_ chains ────────────────────────────────────────────────────────────
def chain_config(ctx) -> list:
    def push(p):  # legs swinging back push the cape back
        return 0.6 * max(0.0, -min(p.get("thigh.L", (0, 0, 0))[0], p.get("thigh.R", (0, 0, 0))[0]))
    return [anim.ChainCfg(ctx.chains["cape"], gravity=0.85, stiffness=110.0, damping=12.0, inertia=0.9, drive=push, limit=(-55.0, 55.0))]


# 9 ── bespoke clips ─────────────────────────────────────────────────────────────────────────────
def clip_overrides(ctx) -> dict:
    """Replace or add clips. Helpers: anim.guard, anim.gesture_keys, anim.keyed, anim.P, anim.osc,
    anim.HandTarget/Aim/FootTarget. Impact at 40 %, frame counts multiple of 5, loops close."""
    prof = MOTION
    g = anim.guard(prof)
    # a bespoke ultimate: staff planted overhead, spun once, slammed at 40 %
    wind, hit, follow = anim.gesture_keys(prof, "slam")
    spin = anim.add(wind, anim.P(hips=(0, 40, 0), chest=(0, 30, 0)))
    N = anim.frames_for(50, prof)
    ult = anim.Clip("cast_ult", N, False, anim.keyed([(0.0, g, "linear"), (0.18, spin, "inout"), (0.30, wind, "inout"),
                                                       (anim.IMPACT, hit, "accel"), (0.55, follow, "out"),
                                                       (1.0, g, "inout")]), impact=anim.IMPACT)
    # an optional taunt: a loopable sway with the staff held high
    def taunt_pose(t):
        return anim.add(g, anim.P(hips=(0, 6 * anim.osc(t, 1), 0), chest=(0, 10 * anim.osc(t, 1), 0),
                                  head=(-4, -8 * anim.osc(t, 1), 0)))
    taunt = anim.Clip("taunt", 60, True, taunt_pose)
    return {"cast_ult": ult, "taunt": taunt}


if __name__ == "__main__":
    fighter.main(sys.modules[__name__])
