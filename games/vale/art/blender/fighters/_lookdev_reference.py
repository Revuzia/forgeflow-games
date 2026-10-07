"""_lookdev_reference — the STYLE BIBLE reference fighter (technical look-dev, NOT roster content).

Sets the bar every one of the 16 fighters follows (STYLE_BIBLE "Fighters", tokens.json `fighter`):

  * a carved chalk mask with a beak keel (the facing cue from above) inside a heavy linen hood:
    no face, no hair cards; Aubade skin swaps in a dawnglass visor, Serenade a lacquered mask
  * only Vale materials: honed chalk / dialstone / ironstone, dawnglass, lampresin, carved wood,
    heavy cloth with sculpted folds, waxed leather. NO metal bevels, gems, gold, gears or runes
  * stylized heroic proportions: 1.9 m, head 0.30 m (6.3 heads), big hands (x1.5), big boots, an
    oversized gnomon blade (1.6 m) carried on ONE side: the Breaker's inverted wedge
  * 2-4 cm bevels as brushstrokes; shading baked into the base colour (cavity, edge chalk, top light,
    whole-body AO x0.6); value gradient: light crown/shoulders, dark legs and boots
  * the `accent` (team tint) only in the top half: hood crest fin, pauldron inlays, chest clasp wedge
  * rigid drapery: two 1-bone x_ chains (front and back panels)
  * four DISTINCT ability gestures (impact at 40 %): cast_a1 rising lunge cut, cast_a2 the plant
    (overhead, tip into the ground), cast_a3 knee-high sweep, cast_ult the Hourfall leap; victory
    plants the blade; idle_lobby rests it tip-down; the rest from the motion profile

    python3 art/build.py fighter _lookdev_reference [--fast] [--no-skins] [--clip-sheet]
    -> art/out/_lookdev/  (GLB + art.json + skins.json + portrait/splash/icon), QA in art/renders/_lookdev/
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

# 1 ── identity ──────────────────────────────────────────────────────────────────────────────────
ID = "_lookdev_reference"
OUT_SUBDIR = "_lookdev"
TITLE = "Look-dev Reference (Breaker)"
ROLE_MASS = "breaker"                 # bible: inverted wedge, one oversized weapon on one side

# 2 ── proportions: heroic, 6.3 heads, big hands and feet ─────────────────────────────────────────
PROPORTIONS = rig.proportions(height=1.9, head=0.30, neck=0.06, shoulder_width=0.50, hip_width=0.20, leg=0.83,
                              thigh_frac=0.50, arm=0.61, upper_arm_frac=0.52, hand=0.21, foot=0.31,
                              ankle_height=0.095, spine_curve=0.025, stance=0.05, toe_out_deg=9.0, knee_bend=0.014)
SHAPE = body.shape(girth=1.04, torso_w=1.08, torso_d=1.05, chest=1.1, waist=0.94, hips=0.92, arm=1.12, forearm=1.25,
                   leg=0.95, calf=1.05, hand=1.5, neck=1.3, head_w=1.12, head_d=1.08, jaw=1.1, feet=False)

# 3 ── palette (bible vocabulary) + value gradient ──────────────────────────────────────────────
MATERIAL_SET = "bible"
PALETTE = materials.bible_palette(
    chalk="#d6cfbe",       # carved mask (the brightest value: the head reads first)
    cloth2="#a9a190",      # hood + collar linen (top band, a step below the mask)
    stone="#aaa395",       # honed dialstone pauldrons + blade
    cloth="#77746b",       # tunic (middle band)
    felt="#71524a",        # drapes: madder felt (an extra palette role, see extra_materials)
    wood="#9a7b5b",        # bracers, clasp, grip (pale ash)
    wood_dark="#5b4231",
    leather="#4a382c",     # belt, harness, boots
    under="#34312e",       # legs
    ironstone="#463c35",   # greaves, knees, tassets, blade spine
    dawnglass="#a9c4dc", lampresin="#c98a3c",
    accent="#3f9cff",      # authored as Dawn azure; the renderer tints it per viewer
)
VALUE_GRADIENT_STOPS = materials.BIBLE_GRADIENT_STOPS
CARD = {"primary": "#2a3340", "secondary": "#cdc6b5"}
SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92}
SOCKETS = {"weapon_tip": "x_blade_tip"}

# 4 ── motion: heavy two-hander, the blade carried on the right shoulder ──────────────────────────
#       arm blocks (wrist rel to the shoulder in arm lengths, chest frame, +X left, -Y front, +Z up;
#       pole; aim of the held item; off-hand rel; off-hand pole) override anim.ONE_HAND
BLOCKS = {
    "guard":    ((0.04, -0.46, -0.44), (-0.9, 0.3, -0.3), (-0.58, 0.66, 0.48), (0.0, -0.4, -0.8), None),
    "run_fwd":  ((0.08, -0.52, -0.38), (-0.9, 0.3, -0.3), (-0.55, 0.62, 0.56), (0.0, -0.4, -0.8), None),
    "run_back": ((0.00, -0.38, -0.50), (-0.9, 0.4, -0.3), (-0.60, 0.70, 0.38), (0.0, -0.4, -0.8), None),
}
MOTION = anim.motion_profile(weight="heavy", weapon="two_hand", stance="wide", run_ref_speed=3.45, blocks=BLOCKS)

# 5 ── skins: palette swaps + optional geometry, same rig, same accent locations ──────────────────
SKINS = [
    {"id": "_lookdev_reference_dawn",            # Aubade-born look: chalk + dawnglass visor, cool linen
     "palette": {"chalk": "#d3d2c9", "cloth2": "#c6c9c6", "cloth": "#6f7a84", "stone": "#a9adb0",
                 "wood": "#a89070", "leather": "#3d3a38", "under": "#2f3236", "ironstone": "#3f4246",
                 "dawnglass": "#b4cde3"},
     "extra": {"visor": True}, "card": {"primary": "#24364a", "secondary": "#b4cde3"}},
    {"id": "_lookdev_reference_dusk",            # Serenade-born look: ochre sandstone, walnut, lampresin
     "palette": {"chalk": "#c8ab84", "cloth2": "#b7a083", "cloth": "#7a5a45", "stone": "#9a7f62",
                 "wood": "#6d4c34", "leather": "#3f2d22", "under": "#33291f", "ironstone": "#43352d",
                 "lampresin": "#cf8e3e"},
     "extra": {"resin_brow": True}, "card": {"primary": "#3a2a20", "secondary": "#cf8e3e"}},
]


def extra_materials(ctx) -> dict:
    """Extra palette roles beyond materials.bible_set: here a madder felt for the drapes."""
    return {"felt": materials.heavy_cloth("felt", dict(materials.BIBLE_PALETTE, **ctx.palette), "felt", ctx.gradient,
                                          weave=0.3, felt=1.0)}


# 6 ── rig extras: two rigid drapes on one-bone chains, the blade tip socket ──────────────────────
def rig_extras(ctx) -> None:
    J = ctx.info.joints
    zt = J["spine0"].z - 0.07
    ctx.chains["drape_f"] = rig.add_chain(ctx.info, "drape_f", "hips", [V((0, -0.15, zt)), V((0, -0.19, zt - 0.40))])
    ctx.chains["drape_b"] = rig.add_chain(ctx.info, "drape_b", "hips", [V((0, 0.16, zt)), V((0, 0.21, zt - 0.46))],
                                          z_hint=(0, 1, 0))
    rig.add_socket(ctx.info, "x_blade_tip", "prop.R", rig.prop_matrix(ctx.info, "prop.R") @ V((0, 0, 1.26)))


# 7 ── model ───────────────────────────────────────────────────────────────────────────────────
def model(ctx) -> list:
    info, M, col = ctx.info, ctx.mats, ctx.col
    J = info.joints
    extra = (ctx.skin or {}).get("extra", {})
    P = []

    # 7a body: fused sculpt; linen tunic torso, dark legs, waxed leather hands and heavy boots
    parts = body.humanoid_parts(info, SHAPE, col=col)
    for p in parts:
        nm = p.name
        if nm.startswith("b_hand"):
            mesh.set_material(p, M["leather"])
        elif nm.startswith(("b_torso", "b_arm", "b_head", "b_neck")):   # head + neck: a linen face wrap under the mask
            mesh.set_material(p, M["cloth"])
        else:
            mesh.set_material(p, M["under"])
    for s in ("L", "R"):
        b = body.boot(info, s, col=col, cuff=True, height=0.36, width=1.3, name=f"b_boot.{s}", toe_up=0.004)
        mesh.set_material(b, M["leather"])
        parts.append(b)
    hi = mesh.union_fillet(parts, voxel=0.0058, fillet=0.03, name="body_high", col=col)
    ctx.body_high = hi
    ctx.targets = [hi]
    P.append(fighter.Part("body", high=hi, tris=5600, bind="auto", uv_weight=0.85))

    # 7b face: carved chalk mask (+ beak keel) inside a heavy linen hood; crest fin = accent
    hc, hr = kit.head_frame(info)
    mask = kit.carved_mask(ctx, M["chalk"], M["ink"], target=[hi], lift=0.016, cheek=0.009, brow=0.013,
                           u_span=78.0, v_top=48.0, v_bot=140.0, eye=(25.0, 88.5, 15.0, 7.4), eye_depth=0.015,
                           slant=-0.25, col=col)
    P.append(fighter.Part("mask", low=mask, bind="bone:head", uv_weight=1.8))
    beak = kit.mask_beak(ctx, M["chalk"], mask, v0=72.0, v1=114.0, height=0.032, width=0.017, col=col)
    P.append(fighter.Part("mask_beak", low=beak, bind="bone:head", uv_weight=1.4))
    if extra.get("visor"):
        vz = kit.glass_visor(ctx, M["dawnglass"], [mask], v0=80.0, v1=95.0, lift=0.004, col=col)
        P.append(fighter.Part("visor", low=vz, bind="bone:head", uv_weight=1.2))
    if extra.get("resin_brow"):
        hproj = Spherical(hc, up=(0, 0, 1), front=(0, -1, 0))
        brow = kit.inlay(hproj, [(-48 + 96 * i / 8, 72.5) for i in range(9)], [mask], M["lampresin"], width=0.016,
                         height=0.005, name="resin_brow", col=col)
        P.append(fighter.Part("resin_brow", low=brow, bind="bone:head"))
    hood = kit.hood(ctx, M["cloth2"], target=[hi, mask], lift=0.034, open_deg=66.0, peak=0.06, folds=5,
                    fold_depth=0.011, v_end=126.0, col=col)
    hb = J["head_base"]
    P.append(fighter.Part("hood", low=hood, bind=("zblend", "neck", "head", hb.z - 0.06, hb.z + 0.02), uv_weight=1.3))
    # gnomon crest fin along the hood's top (accent): the crown read from the gameplay camera
    hp = Spherical(hc, up=(0, 0, 1), front=(0, -1, 0))
    htree = mesh.bvh_of([hood])
    pts, hts, wds = [], [], []
    for i in range(9):
        t = i / 8
        v = -34 + 84 * t                               # front (-) over the crown to the back (+)
        pts.append(kit.surface(hp, 0 if v < 0 else 180, abs(v) + 1e-3, htree, -0.004, outer=True))
        hts.append(0.010 + 0.044 * math.sin(math.pi * min(1.0, t * 1.08)) ** 0.7)
        wds.append(0.012 + 0.016 * math.sin(math.pi * t))
    fin = kit.crest(pts, hts, wds, M["accent"], name="crest_fin", col=col)
    P.append(fighter.Part("crest_fin", low=fin, bind="bone:head"))

    # 7c collar: a rolled heavy-linen scarf gathered around the neck, dipping into a cowl at the front
    nb = J["neck_base"]
    collar = kit.scarf(ctx, M["cloth2"], [hi], z=nb.z - 0.004, lift=0.0, thick=0.032, depth=0.046, cowl=0.045,
                       bunch=0.12, bunches=6, n=36, segments=10, name="collar", col=col)
    P.append(fighter.Part("collar", low=collar, bind=("zblend", "chest", "neck", nb.z - 0.07, nb.z + 0.03), uv_weight=1.1))
    ctx.targets = [hi, collar]

    # 7d pauldrons: thick honed chalk slabs (2 cm bevels) + accent inlay along each ridge
    for s in ("L", "R"):
        pd, pproj, pbind = kit.slab_pauldron(ctx, s, M["stone"], ctx.targets, size=1.0, lift=0.034, thickness=0.04,
                                             bevel_w=0.018, flare=0.024, tilt=0.6, v_end=56.0, ridge=0.014, col=col)
        P.append(fighter.Part(f"pauldron.{s}", low=pd, bind=pbind, uv_weight=1.2))
        uvs = [(0 if t < 0 else 180, abs(t) + 1e-3) for t in [-44 + 88 * i / 8 for i in range(9)]]
        inl = kit.inlay(pproj, uvs, [pd], M["accent"], width=0.062, height=0.006, lift=-0.001, name=f"pauldron_inlay.{s}",
                        col=col)
        P.append(fighter.Part(f"pauldron_inlay.{s}", low=inl, bind=pbind))

    # 7e harness: waxed leather strap (left shoulder -> right hip) + carved wood dial clasp (accent wedge)
    axis = Cylindrical((0, 0, 0), (0, 0, 1), ref=(0, -1, 0))
    tree = mesh.bvh_of(ctx.targets)
    s0, s1 = J["spine0"], J["spine1"]
    path = [(58 - 112 * i / 9, nb.z - 0.10 - (nb.z - 0.10 - (s0.z + 0.02)) * i / 9) for i in range(10)]
    strap_pts = [kit.surface(axis, u, z, tree, 0.010) for u, z in path]
    strap = mesh.loft([{"p": p, "rx": 0.030, "ry": 0.007, "ry2": 0.005, "exp": 3.2} for p in strap_pts], segments=8,
                      caps=("flat", "flat"), up=(0, -1, 0), name="harness", col=col, rings=24)
    mesh.set_material(strap, M["leather"])
    P.append(fighter.Part("harness", low=strap, bind=("zblend", "spine", "chest", s1.z - 0.06, s1.z + 0.06)))
    # the clasp is a small sundial: a carved walnut dial with a glass gnomon fin (accent, top half)
    cz = s1.z + 0.10
    cp = kit.surface(axis, 22, cz, mesh.bvh_of(ctx.targets + [strap]), 0.004)
    n = (cp - V((0, 0, cz))).normalized()
    disc, gnomon = kit.sundial_clasp(ctx, M["wood_dark"], M["accent"], cp, n, radius=0.058, thick=0.022, gnomon=0.05,
                                     col=col)
    P.append(fighter.Part("clasp", low=disc, bind="bone:chest"))
    P.append(fighter.Part("clasp_gnomon", low=gnomon, bind="bone:chest"))

    # 7f belt (waxed leather) + carved wood buckle plate + lampresin lantern on the left hip
    bz0, bz1 = s0.z - 0.05, s0.z + 0.045
    belt = mesh.plate(axis, [(bz1, -180, 180), (bz0, -180, 180)], target=ctx.targets + [strap], offset=0.014,
                      thickness=0.018, cols=36, smooth_iters=8, wrap=True, rim=0.0, bevel_w=0.006, bevel_segments=2,
                      name="belt", col=col, mat=M["leather"])
    P.append(fighter.Part("belt", low=belt, bind="bone:hips"))
    ctx.targets = [hi, collar, belt]
    bp = kit.surface(axis, 0, (bz0 + bz1) / 2, mesh.bvh_of([belt]), 0.004)
    buckle = mesh.slab([(-0.055, 0.045, -0.045), (0.0, 0.055, -0.055), (0.055, 0.045, -0.045)], thickness=0.026,
                       cols=4, rows_n=5, bevel_w=0.008, bevel_segments=2, name="buckle", col=col, mat=M["wood"])
    # slab is built in the YZ plane facing +-X: turn it to face -Y and move it onto the belt front
    from mathutils import Matrix
    buckle.data.transform(Matrix.Translation(bp + V((0, -0.010, 0))) @ Matrix.Rotation(math.radians(-90), 4, "Z"))
    P.append(fighter.Part("buckle", low=buckle, bind="bone:hips"))
    P += lantern(ctx, axis, belt)

    # 7g side tassets: ironstone tablets hanging from the belt (blend hips -> thigh)
    for s, sx in (("L", 1), ("R", -1)):
        u0, u1 = (58, 112) if sx > 0 else (-112, -58)
        tas = mesh.plate(axis, [(bz0 + 0.004, u0, u1), (bz0 - 0.11, u0 - 3 * sx, u1 + 3 * sx), (bz0 - 0.21, u0, u1 - 6 * sx)],
                         target=ctx.targets, offset=0.03, thickness=0.028, cols=6, smooth_iters=14, rim=0.0, row_step=0.06,
                         bevel_w=0.010, bevel_segments=2, name=f"tasset.{s}", col=col, mat=M["ironstone"], inner=True,
                         shape_fn=lambda u, v, r: 0.035 * mesh.smoothstep(bz0, bz0 - 0.2, v))
        P.append(fighter.Part(f"tasset.{s}", low=tas, bind=("zblend", f"thigh.{s}", "hips", bz0 - 0.18, bz0 - 0.02)))

    # 7h drapes: heavy cloth front/back panels on one-bone chains (rigid drapery)
    btree = mesh.bvh_of([belt])
    top_f = [kit.surface(axis, -34 + 68 * i / 6, bz0 + 0.006, btree, 0.006) for i in range(7)]
    df = kit.drape(top_f, 0.40, M["felt"], folds=2, fold_depth=0.014, flare=0.05, avoid=[hi], clearance=0.035,
                   hem=lambda u: 0.10 * (1 - abs(2 * u - 1)), out_dir=(0, -1, 0), name="drape_f", col=col, seed=3)
    P.append(fighter.Part("drape_f", low=df, bind=("chain", "drape_f", "hips")))
    top_b = [kit.surface(axis, 180 - 42 + 84 * i / 6, bz0 + 0.006, btree, 0.008) for i in range(7)]
    db = kit.drape(top_b, 0.48, M["felt"], folds=3, fold_depth=0.016, flare=0.07, avoid=[hi], clearance=0.035,
                   hem=lambda u: 0.06 * math.sin(math.pi * u), out_dir=(0, 1, 0), name="drape_b", col=col, seed=4)
    P.append(fighter.Part("drape_b", low=db, bind=("chain", "drape_b", "hips")))

    # 7i limbs: carved ash bracers; ironstone greaves + knee blocks
    for s in ("L", "R"):
        br = kit.limb_shell(ctx, f"elbow.{s}", f"wrist.{s}", M["wood"], [hi], t0=0.22, t1=0.97, lift=0.012,
                            thickness=0.022, bevel_w=0.009, flare=0.022, cols=16, name=f"bracer.{s}", col=col)
        P.append(fighter.Part(f"bracer.{s}", low=br, bind=f"bone:forearm.{s}"))
        gr = kit.limb_shell(ctx, f"knee.{s}", f"ankle.{s}", M["ironstone"], [hi], t0=0.14, t1=0.78, arc=105.0,
                            ref=(0, -1, 0), lift=0.016, thickness=0.024, bevel_w=0.010, flare=0.012, ridge=0.012,
                            cols=10, name=f"greave.{s}", col=col)
        P.append(fighter.Part(f"greave.{s}", low=gr, bind=f"bone:shin.{s}"))
        kn = J[f"knee.{s}"]
        kp = Spherical(kn + V((0, 0.03, 0.01)), up=(0, -1, 0.2), front=(0, 0, 1))
        R = (mesh._surface_r(mesh.bvh_of([hi]), *kp.ray(0, 0), 0.3) or 0.08) + 0.02
        kc = mesh.plate(kp, [(0, -180, 180), (30, -180, 180), (58, -180, 180)], target=None,
                        r_fn=lambda u, v, r, R=R: R * (1.0 + 0.10 * math.cos(math.radians(u)) ** 2 *
                                                       mesh.smoothstep(20, 58, v)),
                        offset=0.0, thickness=0.024, cols=16, rows_n=6, smooth_iters=0, wrap=True, rim=0.0,
                        bevel_w=0.010, bevel_segments=2, name=f"knee.{s}", col=col, mat=M["ironstone"])
        P.append(fighter.Part(f"knee.{s}", low=kc, bind=f"bone:shin.{s}"))

    # 7j the gnomon blade on prop.R
    P += gnomon_blade(ctx)
    return P


def lantern(ctx, axis, belt) -> list:
    """A small lampresin light vessel hanging from the left hip (stalled light, cupped)."""
    M, col = ctx.mats, ctx.col
    J = ctx.info.joints
    z = J["spine0"].z - 0.10
    top = kit.surface(axis, 108, z + 0.05, mesh.bvh_of([belt]), 0.05)
    c = top + V((0.0, 0.0, -0.09))
    vessel = mesh.loft([{"p": c + V((0, 0, -0.065)), "rx": 0.030, "ry": 0.030},
                        {"p": c + V((0, 0, -0.030)), "rx": 0.052, "ry": 0.052},
                        {"p": c + V((0, 0, 0.030)), "rx": 0.050, "ry": 0.050},
                        {"p": c + V((0, 0, 0.060)), "rx": 0.034, "ry": 0.034}], segments=12, caps=("round", "round"),
                       up=(0, -1, 0), name="lantern", col=col, cap_len=0.4)
    mesh.set_material(vessel, M["lampresin"])
    cap = mesh.loft([{"p": c + V((0, 0, 0.055)), "rx": 0.042, "ry": 0.042, "exp": 2.4},
                     {"p": c + V((0, 0, 0.082)), "rx": 0.030, "ry": 0.030, "exp": 2.4},
                     {"p": c + V((0, 0, 0.098)), "rx": 0.010, "ry": 0.010}], segments=10, caps=("flat", "point"),
                    up=(0, -1, 0), name="lantern_cap", col=col)
    base = mesh.loft([{"p": c + V((0, 0, -0.080)), "rx": 0.036, "ry": 0.036, "exp": 2.4},
                      {"p": c + V((0, 0, -0.058)), "rx": 0.040, "ry": 0.040, "exp": 2.4}], segments=10,
                     caps=("flat", "flat"), up=(0, -1, 0), name="lantern_base", col=col)
    ribs = []
    for k in range(4):
        a = math.radians(45 + 90 * k)
        d = V((math.cos(a), math.sin(a), 0))
        ribs.append(mesh.sweep([c + d * 0.040 + V((0, 0, -0.062)), c + d * 0.056 + V((0, 0, 0.0)),
                                c + d * 0.040 + V((0, 0, 0.058))], 0.008, segments=4, caps=("flat", "flat"), rings=6,
                               name=f"lantern_rib{k}", col=col))
    frame = mesh.join([cap, base] + ribs, "lantern_frame")
    mesh.set_material(frame, M["wood_dark"])
    return [fighter.Part("lantern", low=vessel, bind="bone:hips", uv_weight=1.2),
            fighter.Part("lantern_frame", low=frame, bind="bone:hips")]


def gnomon_blade(ctx) -> list:
    """The oversized gnomon blade (prop space: grip at the origin, blade +Z, edge -Y): an ironstone
    spine, a honed dialstone blade and a dawnglass cutting edge, carved wood grip with leather
    wraps, ironstone guard block and pommel."""
    M, col = ctx.mats, ctx.col
    blade = mesh.slab([(0.150, 0.065, -0.250), (0.42, 0.058, -0.215), (0.80, 0.045, -0.150), (1.10, 0.030, -0.070),
                       (1.27, 0.004, -0.004)],
                      thickness=lambda u, v: (0.050 - 0.036 * u) * (1.0 - 0.35 * v), cols=10, rows_n=16,
                      bevel_w=0.012, bevel_segments=3, name="gn_blade", col=col,
                      bands=[(0.16, M["ironstone"]), (0.25, M["stone"]), (0.31, M["ironstone"]), (0.86, M["stone"]),
                             (1.0, M["dawnglass"])])           # spine, carved fuller groove, glass edge
    guard = mesh.slab([(0.095, 0.085, -0.115), (0.125, 0.095, -0.13), (0.165, 0.08, -0.105)], thickness=0.07, cols=4,
                      rows_n=3, bevel_w=0.014, bevel_segments=2, name="gn_guard", col=col, mat=M["ironstone"])
    grip_st = []
    for i in range(11):
        z = -0.30 + 0.40 * i / 10
        r = 0.024 + (0.004 if i % 2 else 0.0)
        grip_st.append({"p": (0, 0, z), "rx": r, "ry": r * 1.12})
    grip = mesh.loft(grip_st, segments=10, caps=("flat", "flat"), up=(0, -1, 0), name="gn_grip", col=col, rings=21,
                     smooth_path=False)
    mesh.set_material(grip, M["wood_dark"])
    wraps = []
    for z in (-0.20, -0.06, 0.06):
        wraps.append(mesh.loft([{"p": (0, 0, z - 0.018), "rx": 0.031, "ry": 0.034, "exp": 2.6},
                                {"p": (0, 0, z + 0.018), "rx": 0.031, "ry": 0.034, "exp": 2.6}], segments=8,
                               caps=("flat", "flat"), up=(0, -1, 0), name="gn_wrap", col=col, rings=2, smooth_path=False))
    wrap = mesh.join(wraps, "gn_wraps")
    mesh.set_material(wrap, M["leather"])
    pommel = mesh.loft([{"p": (0, 0, -0.300), "rx": 0.030, "ry": 0.034, "exp": 2.4},
                        {"p": (0, 0, -0.335), "rx": 0.048, "ry": 0.052, "exp": 3.0},
                        {"p": (0, 0, -0.370), "rx": 0.026, "ry": 0.028, "exp": 2.4}], segments=10,
                       caps=("flat", "round"), up=(0, -1, 0), name="gn_pommel", col=col, cap_len=0.5)
    mesh.set_material(pommel, M["ironstone"])
    mw = rig.prop_matrix(ctx.info, "prop.R")
    for o in (blade, guard, grip, wrap, pommel):
        o.data.transform(mw)
        o.data.update()
    return [fighter.Part("gn_blade", low=blade, bind="bone:prop.R", uv_weight=1.3),
            fighter.Part("gn_guard", low=guard, bind="bone:prop.R"),
            fighter.Part("gn_grip", low=grip, bind="bone:prop.R"),
            fighter.Part("gn_wraps", low=wrap, bind="bone:prop.R"),
            fighter.Part("gn_pommel", low=pommel, bind="bone:prop.R")]


# 8 ── secondary motion: rigid drapes swing with the hips, pushed by the thighs ───────────────────
def chain_config(ctx) -> list:
    def push_front(p):
        return 0.7 * max(0.0, p.get("thigh.L", (0, 0, 0))[0], p.get("thigh.R", (0, 0, 0))[0])

    def push_back(p):
        return 0.7 * max(0.0, -min(p.get("thigh.L", (0, 0, 0))[0], p.get("thigh.R", (0, 0, 0))[0]))

    return [anim.ChainCfg(ctx.chains["drape_f"], gravity=0.8, stiffness=120.0, damping=13.0, inertia=0.7,
                          drive=push_front, limit=(-60.0, 60.0)),
            anim.ChainCfg(ctx.chains["drape_b"], gravity=0.8, stiffness=110.0, damping=12.0, inertia=0.8,
                          drive=push_back, limit=(-60.0, 60.0))]


# 9 ── bespoke clips (impact at 40 %, frame counts multiples of 5, loops close) ───────────────────
def _two_hand(g, torso=None, hips=(0.0, 0.0, 0.0), rel=(0.3, -0.5, -0.4), pole=(-0.9, 0.3, -0.3), aim=(0, -1, 0),
              feet=None, grip=-0.17):
    """A two-handed pose over guard `g`: main hand rel/pole/aim, the off hand on the grip."""
    p = anim.add(g, anim.P(**(torso or {})))
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


def clip_overrides(ctx) -> dict:
    prof = MOTION
    g = anim.guard(prof)
    F = anim.FootTarget
    gf = g["ik"]

    def step(dy_l=0.0, dz_l=0.0, dy_r=0.0, dz_r=0.0, pl=0.0, pr=0.0):
        fl, fr = gf["foot.L"], gf["foot.R"]
        return {"foot.L": F((fl.ankle[0], fl.ankle[1] + dy_l, fl.ankle[2] + dz_l), pl, fl.yaw),
                "foot.R": F((fr.ankle[0], fr.ankle[1] + dy_r, fr.ankle[2] + dz_r), pr, fr.yaw)}

    out = {}
    # cast_a1 — rising lunge cut: blade low behind on the right, lunge, carve up across to the left
    wind = _two_hand(g, dict(hips=(4, -26, 0), spine=(6, -16, 0), chest=(6, -18, 0), head=(0, 16, 0)),
                     hips=(0.0, 0.05, -0.06), rel=(0.05, 0.10, -0.80), pole=(-0.9, 0.4, 0.0), aim=(-0.35, 0.55, -0.76))
    hit = _two_hand(g, dict(hips=(12, 18, 0), spine=(4, 14, 0), chest=(-2, 18, 0), head=(-6, -14, 0)),
                    hips=(0.0, -0.20, -0.07), rel=(0.62, -0.72, 0.10), pole=(-0.6, 0.3, -0.7), aim=(0.40, -0.62, 0.68),
                    feet=step(dy_l=-0.30, pl=4))
    fol = _two_hand(g, dict(hips=(10, 24, 0), spine=(2, 16, 0), chest=(-6, 22, 0), head=(-8, -16, 0)),
                    hips=(0.0, -0.22, -0.06), rel=(0.66, -0.40, 0.38), pole=(-0.5, 0.2, -0.8), aim=(0.45, -0.10, 0.89),
                    feet=step(dy_l=-0.30, pl=2))
    N = anim.frames_for(30, prof)
    out["cast_a1"] = anim.Clip("cast_a1", N, False,
                               anim.drag(anim.keyed(anim.strike_keys(prof, wind, hit, fol, g)), N, {"head": 1.5, "neck": 1.0}),
                               impact=anim.IMPACT)
    # cast_a2 — the plant: blade overhead, driven tip-first into the ground in front at 40 %
    wind = _two_hand(g, dict(hips=(-6, 0, 0), spine=(-8, 0, 0), chest=(-10, 0, 0), neck=(-4, 0, 0), head=(-10, 0, 0)),
                     hips=(0.0, 0.03, 0.03), rel=(0.30, -0.25, 0.92), pole=(-0.8, -0.3, 0.3), aim=(0.0, 0.25, 0.97))
    hit = _two_hand(g, dict(hips=(20, 0, 0), spine=(12, 0, 0), chest=(8, 0, 0), neck=(-6, 0, 0), head=(-10, 0, 0)),
                    hips=(0.0, -0.08, -0.16), rel=(0.30, -0.86, -0.10), pole=(-0.8, 0.3, -0.3), aim=(0.0, -0.45, -0.89),
                    feet=step(dy_l=-0.12))
    fol = _two_hand(g, dict(hips=(22, 0, 0), spine=(14, 0, 0), chest=(10, 0, 0), neck=(-8, 0, 0), head=(-12, 0, 0)),
                    hips=(0.0, -0.09, -0.18), rel=(0.30, -0.84, -0.16), pole=(-0.8, 0.3, -0.3), aim=(0.0, -0.43, -0.90),
                    feet=step(dy_l=-0.12))
    N = anim.frames_for(30, prof)
    out["cast_a2"] = anim.Clip("cast_a2", N, False,
                               anim.drag(anim.keyed(anim.strike_keys(prof, wind, hit, fol, g)), N, {"head": 2.0, "neck": 1.0}),
                               impact=anim.IMPACT)
    # cast_a3 — the low sweep: coiled to the right, the blade carves a knee-high arc across the front
    wind = _two_hand(g, dict(hips=(8, 34, 0), spine=(8, 18, 0), chest=(6, 22, 0), head=(-4, -24, 0)),
                     hips=(0.0, 0.04, -0.12), rel=(-0.05, -0.05, -0.75), pole=(-0.9, 0.4, 0.0), aim=(-0.80, 0.50, -0.32))
    hit = _two_hand(g, dict(hips=(14, -26, 0), spine=(10, -14, 0), chest=(8, -18, 0), head=(-8, 16, 0)),
                    hips=(0.0, -0.06, -0.18), rel=(0.50, -0.72, -0.55), pole=(-0.7, 0.3, -0.6), aim=(0.62, -0.74, -0.26),
                    feet=step(dy_l=-0.10, dy_r=0.06))
    fol = _two_hand(g, dict(hips=(14, -44, 0), spine=(10, -20, 0), chest=(8, -26, 0), head=(-8, 22, 0)),
                    hips=(0.0, -0.06, -0.18), rel=(0.85, -0.25, -0.50), pole=(-0.5, 0.6, -0.6), aim=(0.96, 0.10, -0.26),
                    feet=step(dy_l=-0.10, dy_r=0.06))
    N = anim.frames_for(30, prof)
    out["cast_a3"] = anim.Clip("cast_a3", N, False,
                               anim.drag(anim.keyed(anim.strike_keys(prof, wind, hit, fol, g)), N, {"head": 1.5, "neck": 1.0}),
                               impact=anim.IMPACT)
    # cast_ult — the Hourfall leap: deep crouch, leap with the blade overhead, slam down at 40 %
    crouch = _two_hand(g, dict(hips=(18, 0, 0), spine=(14, 0, 0), chest=(10, 0, 0), head=(-14, 0, 0)),
                       hips=(0.0, 0.04, -0.22), rel=(0.30, -0.45, -0.60), aim=(-0.30, 0.55, 0.78))
    air = _two_hand(g, dict(hips=(-6, 0, 0), spine=(-10, 0, 0), chest=(-14, 0, 0), neck=(-4, 0, 0), head=(-8, 0, 0),
                            thigh_L=(30, 0, 0), thigh_R=(10, 0, 0)),
                    hips=(0.0, 0.0, 0.30), rel=(0.30, 0.18, 0.80), pole=(-0.8, -0.3, 0.3), aim=(0.0, 0.80, 0.60),
                    feet=step(dz_l=0.50, dz_r=0.40, dy_l=-0.10, dy_r=0.22, pl=-20, pr=-45))
    slam = _two_hand(g, dict(hips=(28, 0, 0), spine=(16, 0, 0), chest=(12, 0, 0), neck=(-8, 0, 0), head=(-12, 0, 0)),
                     hips=(0.0, -0.12, -0.24), rel=(0.30, -0.86, -0.22), pole=(-0.8, 0.3, -0.3), aim=(0.0, -0.86, -0.51),
                     feet=step(dy_l=-0.18))
    hold = _two_hand(g, dict(hips=(30, 0, 0), spine=(18, 0, 0), chest=(13, 0, 0), neck=(-8, 0, 0), head=(-14, 0, 0)),
                     hips=(0.0, -0.12, -0.26), rel=(0.30, -0.84, -0.26), pole=(-0.8, 0.3, -0.3), aim=(0.0, -0.84, -0.54),
                     feet=step(dy_l=-0.18))
    N = anim.frames_for(50, prof)
    keys = [(0.0, g, "linear"), (0.14, crouch, "inout"), (0.20, anim.lerp_pose(g, crouch, 1.1), "out"),
            (0.30, air, "out"), (0.33, anim.lerp_pose(crouch, air, 1.04), "out"), (anim.IMPACT, slam, "accel"),
            (0.47, hold, "out"), (0.70, hold, "linear"), (0.86, anim.lerp_pose(hold, g, 0.6), "inout"), (1.0, g, "settle")]
    out["cast_ult"] = anim.Clip("cast_ult", N, False, anim.drag(anim.keyed(keys), N, {"head": 1.5, "neck": 1.0}),
                                impact=anim.IMPACT)
    # victory — lift the blade, plant it tip-down in front, both hands on the grip, chest proud
    lift = _two_hand(g, dict(hips=(-4, 0, 0), spine=(-6, 0, 0), chest=(-8, 0, 0), head=(-8, 0, 0)),
                     hips=(0.0, 0.0, 0.0), rel=(0.32, -0.40, 0.40), aim=(0.0, -0.2, 0.98))
    plant = _two_hand(g, dict(hips=(-2, -4, 0), spine=(-4, -2, 0), chest=(-8, -2, 0), neck=(-4, 3, 0), head=(-9, 4, 0)),
                      hips=(0.0, 0.02, -0.02), rel=(0.42, -0.62, -0.38), pole=(-0.9, 0.2, -0.3),
                      aim=(-0.08, -0.30, -0.95), grip=-0.12)
    plant["ik"]["hand.L"] = HandTarget(to_prop=("prop.R", -0.13), pole=(0.9, 0.2, -0.3))
    N = 60
    keys = [(0.0, g, "linear"), (0.16, anim.lerp_pose(g, lift, 0.5), "inout"), (0.28, lift, "out"),
            (0.42, plant, "accel"), (0.50, anim.lerp_pose(lift, plant, 1.04), "out"), (0.62, plant, "settle"),
            (1.0, plant, "linear")]
    base = anim.keyed(keys)

    def victory(t):
        p = base(t)
        if t > 0.62:
            k = min(1.0, (t - 0.62) / 0.15)
            p = anim.add(p, anim.P(chest=(1.0 * k * anim.osc(t, 2), 0, 0), head=(0.6 * k * anim.osc(t, 2, 0.15), 0, 0)))
        return p

    out["victory"] = anim.Clip("victory", N, False, anim.drag(victory, N, {"head": 2.0, "neck": 1.0}))

    # idle_lobby — the blade rests tip-down at the right side, right hand on the grip, left fist on the
    # hip; weight shifts and a slow look-around (loops, 96 frames). Clean head and shoulders for the
    # portrait.
    st = anim.stance(dict(prof, stance="neutral"), 0.6)
    lobby = anim.merge(st, anim.arms_relaxed())
    lobby["ik"] = dict(st["ik"])
    lobby["ik"]["hand.R"] = HandTarget(rel=(-0.20, -0.22, -0.50), pole=(-0.9, 0.3, -0.2))
    lobby["ik"]["aim.R"] = Aim((-0.16, -0.12, -0.98))
    lobby["ik"]["hand.L"] = HandTarget(rel=(0.20, 0.06, -0.70), pole=(1.0, 0.4, 0.0))
    lobby = anim.add(lobby, anim.P(chest=(-3, 0, 0), head=(-2, 0, 0)))

    def lobby_fn(t):
        sw = anim.osc(t, 1)
        look = 18 * math.sin(2 * math.pi * t) ** 3
        b = anim.osc(t, 3)
        p = anim.add(lobby, anim.P(hips=(0, 3 * sw, -3 * sw), spine=(0.5 * b, -2 * sw, 1.5 * sw),
                                    chest=(1.2 * b, -2 * sw, 1.0 * sw), neck=(0, look * 0.4, 0),
                                    head=(-2 + 2 * anim.osc(t, 2, 0.3), look * 0.6, 3 * sw)))
        hx, hy, hz = p.get("hips_loc", (0, 0, 0))
        p["hips_loc"] = (hx + 0.02 * sw, hy, hz - 0.006 * abs(sw))
        return p

    out["idle_lobby"] = anim.Clip("idle_lobby", 96, True, anim.drag(lobby_fn, 96, {"head": 3.0, "neck": 2.0}, loop=True))
    return out


if __name__ == "__main__":
    fighter.main(sys.modules[__name__])
