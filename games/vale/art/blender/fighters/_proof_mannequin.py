"""_proof_mannequin — TECHNICAL proof of the VALE fighter pipeline (not game content).

A stylized armoured training mannequin built through every stage the 16 fighters use:
rig (VALE_BIPED_1 + x_ tabard chains) -> fused sculpt-like body -> conformed armour plates with
trim rims -> cloth tabards on x_ chains -> sword on prop.R -> stylized materials -> exploded
Cycles bake (base colour / ORM / normal, 1024²) -> standard clips -> GLB -> gltf-transform ->
portrait, splash, icon, turntable.

    python3 art/build.py proof                 # or: blender -b --factory-startup --python <this> --
    python3 art/build.py proof --fast          # low samples while iterating
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

ID = "_proof_mannequin"
OUT_SUBDIR = "_proof"                      # art/out/_proof, art/renders/_proof
TITLE = "Proof Mannequin"

PROPORTIONS = rig.proportions()            # the default heroic biped
SHAPE = body.shape(feet=False, chest=1.04, forearm=1.08)
PALETTE = materials.palette(
    metal="#9aa3b0", metal_dark="#3d4654", trim="#c99a45", cloth="#2d5f8f", cloth2="#e3d8bd",
    under="#33363f", leather="#5a3b27", leather_dark="#33241a", accent="#6fe6ff",
)
# collection / draft background colours (FighterDef.palette) — used by the portrait backdrop
CARD = {"primary": "#24476b", "secondary": "#c99a45"}
MOTION = anim.motion_profile(weight="medium", weapon="one_hand", stance="guard", run_ref_speed=3.6)
MATERIAL_SET = "legacy"                    # predates the style bible (metal + gold trims): kept as the
                                           # technical proof only; production fighters use the bible set
SKINS = [
    # skins: alternate palettes on the same rig (+ optional extra geometry via ctx.skin in model())
    {"id": "_proof_mannequin_ember", "palette": {"cloth": "#7a3b1d", "trim": "#d8b25a", "metal": "#5b5f66",
                                                  "metal_dark": "#25282d", "accent": "#ffb347"},
     "card": {"primary": "#4a2414", "secondary": "#d8b25a"}},
]


def rig_extras(ctx) -> None:
    """x_ chains for the front/back tabards (animated by anim.secondary_motion)."""
    J = ctx.info.joints
    zt = J["spine0"].z - 0.035
    zb = zt - 0.47
    ctx.chains["tabard_f"] = rig.add_chain(ctx.info, "tabard_f", "hips", [
        V((0, -0.135, zt)), V((0, -0.16, zt - 0.22)), V((0, -0.185, zb))])
    ctx.chains["tabard_b"] = rig.add_chain(ctx.info, "tabard_b", "hips", [
        V((0, 0.15, zt)), V((0, 0.175, zt - 0.24)), V((0, 0.20, zb - 0.04))], z_hint=(0, 1, 0))


def model(ctx) -> list:
    info, M, col = ctx.info, ctx.mats, ctx.col
    J = info.joints
    P = []

    # ── body: fused sculpt (under-suit / leather gloves / leather boots / skin head) ──────────
    parts = body.humanoid_parts(info, SHAPE, col=col)
    for p in parts:
        nm = p.name
        mat = M["leather"] if nm.startswith("b_hand") else M["under"]   # head is fully helmeted
        mesh.set_material(p, mat)
    for s in ("L", "R"):
        b = body.boot(info, s, col=col, cuff=True, height=0.30, name=f"b_boot.{s}")
        mesh.set_material(b, M["leather"])
        parts.append(b)
    hi = mesh.union_fillet(parts, voxel=0.0055, fillet=0.03, name="body_high", col=col)
    ctx.body_high = hi
    ctx.targets = [hi]
    P.append(fighter.Part("body", high=hi, tris=7000, bind="auto", uv_weight=0.8))

    # ── helmet: closed sallet with crest ridge, flared tail, brow and accent visor slit ───────
    hb = J["head_base"]
    hc = V((0, hb.y + 0.004, hb.z + 0.095))

    def helm_shape(u, v, r):
        ridge = 0.010 * math.exp(-(math.sin(math.radians(u)) / 0.16) ** 2) * (1 - mesh.smoothstep(70, 105, v))
        back = max(0.0, -math.cos(math.radians(u)))
        tail = 0.030 * mesh.smoothstep(78, 120, v) * back ** 1.5
        brow = 0.008 * math.exp(-((v - 76) / 6) ** 2) * max(0.0, math.cos(math.radians(u))) ** 2
        return ridge + tail + brow

    helm = mesh.plate(Spherical(hc), [(0, -180, 180), (40, -180, 180), (80, -180, 180), (110, -180, 180),
                                      (136, -180, 180)],
                      target=ctx.targets, offset=0.022, thickness=0.010, cols=28, smooth_iters=10, rows_n=13,
                      shape_fn=helm_shape, rim=0.012, rim_height=0.004, wrap=True, name="helmet", col=col,
                      mat=M["metal"], rim_mat=M["trim"])
    P.append(fighter.Part("helmet", low=helm, bind="bone:head", uv_weight=1.6))
    # visor (upper plate) + bevor (lower plate) leave an eye slit; the accent glows in the gap
    hproj = Spherical(hc)
    visor_up = mesh.plate(hproj, [(60, -72, 72), (72, -80, 80), (83, -82, 82)], target=[helm], offset=0.008,
                          thickness=0.008, cols=16, smooth_iters=4, rows_n=5, rim=0.008,
                          name="visor_up", col=col, mat=M["metal"], rim_mat=M["trim"])
    P.append(fighter.Part("visor_up", low=visor_up, bind="bone:head"))

    def snout(u, v, r):
        return 0.016 * max(0.0, math.cos(math.radians(u))) ** 4 * mesh.smoothstep(92, 118, v)

    bevor = mesh.plate(hproj, [(89, -82, 82), (108, -76, 76), (126, -60, 60), (138, -34, 34)], target=[helm],
                       offset=0.008, thickness=0.008, cols=16, smooth_iters=4, rows_n=7, shape_fn=snout, rim=0.008,
                       name="bevor", col=col, mat=M["metal"], rim_mat=M["trim"])
    P.append(fighter.Part("bevor", low=bevor, bind="bone:head"))
    vis = []
    htree = mesh.bvh_of([helm])
    for i in range(11):
        u = -70 + 140 * i / 10
        o, d = hproj.ray(u, 86)
        r = mesh._surface_r(htree, o, d, 0.5) or 0.12
        vis.append(o + d * (r + 0.004))
    visor = mesh.sweep(vis, [(0.0045, 0.0025)] * len(vis), segments=8, caps=("round", "round"),
                       up=(0, 0, 1), name="eye_slit", col=col)
    mesh.set_material(visor, M["accent"])
    P.append(fighter.Part("eye_slit", low=visor, bind="bone:head"))
    # crest fin along the helmet's centre line (strong top-down silhouette cue)
    hb_tree = mesh.bvh_of([helm])
    crest_pts = []
    for i in range(9):
        v = -38 + 92 * i / 8                          # polar angle: front (-) over the top to the back (+)
        u = 0 if v < 0 else 180
        o, d = Spherical(hc).ray(u, abs(v))
        r = mesh._surface_r(hb_tree, o, d, 0.5) or 0.13
        crest_pts.append(o + d * (r - 0.004))
    # accent crest: the team-tinted crown read from the gameplay camera (bible: accent in the top half)
    hgt = [0.008, 0.024, 0.036, 0.044, 0.046, 0.042, 0.034, 0.022, 0.008]
    wid = [0.006, 0.010, 0.012, 0.013, 0.013, 0.013, 0.012, 0.010, 0.006]
    crest = mesh.loft([{"p": p, "rx": w, "ry": h, "ry2": 0.004, "exp": 2.4} for p, h, w in zip(crest_pts, hgt, wid)],
                      segments=8, caps=("point", "point"), up=(0, 0, 1), name="crest", col=col, rings=16)
    mesh.set_material(crest, M["accent"])
    P.append(fighter.Part("crest", low=crest, bind="bone:head"))
    # trim saddle the crest sits in (keeps a gold read along the helmet ridge)
    sad = mesh.loft([{"p": p, "rx": w + 0.006, "ry": 0.006, "ry2": 0.004, "exp": 3.0}
                     for p, w in zip(crest_pts, wid)], segments=6, caps=("round", "round"), up=(0, 0, 1),
                    name="crest_saddle", col=col, rings=14)
    mesh.set_material(sad, M["trim"])
    P.append(fighter.Part("crest_saddle", low=sad, bind="bone:head"))

    # ── cuirass: breastplate (keel ridge, trim rim) + back plate ─────────────────────────────
    nb, s1, s0 = J["neck_base"], J["spine1"], J["spine0"]
    axis = Cylindrical((0, 0.0, 0), (0, 0, 1), ref=(0, -1, 0))

    def keel(u, v, r):
        # medial ridge (peascod keel) + a waist taper below it: the cuirass reads as forged, not a slab
        ridge = 0.018 * math.exp(-(u / 20.0) ** 2) * mesh.smoothstep(s0.z, s1.z + 0.08, v)
        taper = -0.010 * (1 - mesh.smoothstep(s0.z + 0.03, s1.z, v)) * min(1.0, abs(u) / 60.0)
        return ridge + taper

    breast = mesh.plate(axis, [(nb.z - 0.030, -38, 38), (nb.z - 0.065, -70, 70), (s1.z + 0.10, -86, 86),
                               (s1.z - 0.02, -82, 82), (s0.z + 0.035, -70, 70)],
                        target=ctx.targets, offset=0.024, thickness=0.010, cols=22, smooth_iters=12,
                        shape_fn=keel, rim=0.014, name="breastplate", col=col, mat=M["metal"], rim_mat=M["trim"])
    P.append(fighter.Part("breastplate", low=breast, bind=("zblend", "spine", "chest", s1.z - 0.05, s1.z + 0.05)))
    back_axis = Cylindrical((0, 0.0, 0), (0, 0, 1), ref=(0, 1, 0))
    backp = mesh.plate(back_axis, [(nb.z - 0.020, -46, 46), (nb.z - 0.07, -74, 74), (s1.z + 0.06, -82, 82),
                                   (s0.z + 0.035, -70, 70)],
                       target=ctx.targets, offset=0.024, thickness=0.010, cols=20, smooth_iters=12,
                       rim=0.014, name="backplate", col=col, mat=M["metal"], rim_mat=M["trim"])
    P.append(fighter.Part("backplate", low=backp, bind=("zblend", "spine", "chest", s1.z - 0.05, s1.z + 0.05)))
    ctx.targets = [hi, breast, backp]
    # ── gorget: neck guard bridging helmet and cuirass (chest -> neck blend); projected onto the
    #    cuirass so its flared hem rests ON the plates instead of cutting through their rims ─────
    nb0 = J["neck_base"]
    ncyl = Cylindrical((0, nb0.y + 0.005, 0), (0, 0, 1), ref=(0, -1, 0))
    gor = mesh.plate(ncyl, [(hb.z - 0.005, -180, 180), (nb0.z - 0.01, -180, 180), (nb0.z - 0.045, -180, 180)],
                     target=ctx.targets, offset=0.012, thickness=0.008, cols=24, smooth_iters=6, wrap=True,
                     shape_fn=lambda u, v, r: 0.03 * mesh.smoothstep(nb0.z, nb0.z - 0.045, v), row_step=0.02,
                     rim=0.008, name="gorget", col=col, mat=M["metal"], rim_mat=M["trim"])
    P.append(fighter.Part("gorget", low=gor, bind=("zblend", "chest", "neck", nb0.z - 0.03, hb.z - 0.01)))


    # chest core gem (accent): a faceted lozenge on the keel
    gz = s1.z + 0.09
    o, d = axis.ray(0, gz)
    r = mesh._surface_r(mesh.bvh_of([breast]), o, d, 0.6) or 0.15
    gp = o + d * r
    gem = mesh.loft([{"p": gp + V((0, 0.0, 0.050)), "rx": 0.005, "ry": 0.004},
                     {"p": gp + V((0, -0.013, 0.0)), "rx": 0.032, "ry": 0.012, "exp": 1.3},
                     {"p": gp + V((0, 0.0, -0.050)), "rx": 0.005, "ry": 0.004}],
                    segments=8, caps=("point", "point"), up=(0, -1, 0), name="chest_gem", col=col)
    mesh.shade(gem, smooth=False)
    mesh.set_material(gem, M["accent"])
    P.append(fighter.Part("chest_gem", low=gem, bind="bone:chest"))
    # gem setting (trim ring)
    ring_pts = [gp + V((math.cos(a) * 0.041, -0.002, math.sin(a) * 0.061)) for a in
                [2 * math.pi * i / 16 for i in range(17)]]
    setting = mesh.sweep(ring_pts, [(0.006, 0.006)] * 17, segments=8, caps=(None, None), up=(0, -1, 0),
                         name="gem_setting", col=col)
    mesh.cleanup(setting, merge=1e-3)
    mesh.set_material(setting, M["trim"])
    P.append(fighter.Part("gem_setting", low=setting, bind="bone:chest"))

    # ── belt (leather band projected over body + cuirass) with a trim buckle ─────────────────
    bz0, bz1 = s0.z - 0.035, s0.z + 0.035
    belt = mesh.plate(axis, [(bz1, -180, 180), (bz0, -180, 180)], target=ctx.targets, offset=0.008,
                      thickness=0.008, cols=30, smooth_iters=6, wrap=True, rim=0.006, rim_height=0.002,
                      name="belt", col=col, mat=M["leather"])
    P.append(fighter.Part("belt", low=belt, bind="bone:hips"))
    o, d = axis.ray(0, s0.z)
    r = mesh._surface_r(mesh.bvh_of([belt]), o, d, 0.6) or 0.15
    bp = o + d * (r + 0.003)                      # proud of the tabard top edge
    buckle = mesh.loft([{"p": bp + V((0, 0, -0.045)), "rx": 0.050, "ry": 0.009, "exp": 4.0},
                        {"p": bp + V((0, -0.004, 0.0)), "rx": 0.058, "ry": 0.012, "exp": 4.0},
                        {"p": bp + V((0, 0, 0.045)), "rx": 0.050, "ry": 0.009, "exp": 4.0}],
                       segments=10, caps=("flat", "flat"), up=(0, -1, 0), name="buckle", col=col)
    mesh.bevel(buckle, 0.003, 2, angle=30)
    mesh.set_material(buckle, M["trim"])
    P.append(fighter.Part("buckle", low=buckle, bind="bone:hips"))
    ctx.targets = [hi, breast, backp, belt]

    # ── tassets: side hip plates hanging from the belt (blend hips -> thigh) ──────────────────
    for s, sx in (("L", 1), ("R", -1)):
        u0, u1 = (34, 100) if sx > 0 else (-100, -34)
        tas = mesh.plate(axis, [(bz0 + 0.005, u0, u1), (bz0 - 0.09, u0 - 4 * sx, u1 + 2 * sx),
                                (bz0 - 0.17, u0 - 2 * sx, u1)],
                         target=ctx.targets, offset=0.026, thickness=0.008, cols=10, smooth_iters=14,
                         rim=0.010, name=f"tasset.{s}", col=col, mat=M["metal"], rim_mat=M["trim"],
                         shape_fn=lambda u, v, r: 0.03 * mesh.smoothstep(bz0, bz0 - 0.17, v))
        P.append(fighter.Part(f"tasset.{s}", low=tas, bind=("zblend", f"thigh.{s}", "hips", bz0 - 0.15, bz0)))

    # ── pauldrons: dome + two overlapping lames, trimmed (blend shoulder -> upper_arm) ───────
    for s, sx in (("L", 1), ("R", -1)):
        sh = J[f"shoulder.{s}"]
        c = sh + V((-0.035 * sx, 0.0, -0.035))
        up = V((0.42 * sx, 0.0, 1.0)).normalized()
        proj = Spherical(c, up=up, front=(0, -1, 0))
        lo, hi_ = (-70, 250) if sx > 0 else (-250, 70)
        dome = mesh.plate(proj, [(0, lo, hi_), (30, lo, hi_), (58, lo + 10 * sx, hi_ - 10 * sx)],
                          target=ctx.targets, offset=0.030, thickness=0.011, cols=22, smooth_iters=16, rows_n=7,
                          rim=0.013, name=f"pauldron.{s}", col=col, mat=M["metal"], rim_mat=M["trim"])
        bind = ("dblend", f"shoulder.{s}", f"upper_arm.{s}", c, -up, 0.04, 0.12)
        P.append(fighter.Part(f"pauldron.{s}", low=dome, bind=bind))
        # accent ridge strip over the dome (front -> back): the big top-down team read
        dtree = mesh.bvh_of([dome])
        strip_pts = []
        for i in range(11):
            t = -46 + 92 * i / 10
            o, d = proj.ray(0 if t < 0 else 180, abs(t) + 1e-3)
            r = mesh._surface_r(dtree, o, d, 0.5) or 0.12
            strip_pts.append(o + d * (r + 0.001))
        sw = [0.010, 0.016, 0.019, 0.020, 0.020, 0.020, 0.020, 0.020, 0.019, 0.016, 0.010]
        stripe = mesh.loft([{"p": p, "rx": w, "ry": 0.0045, "ry2": 0.003, "exp": 3.0} for p, w in zip(strip_pts, sw)],
                           segments=6, caps=("round", "round"), up=tuple(up), name=f"pauldron_glow.{s}", col=col,
                           rings=12)
        mesh.set_material(stripe, M["accent"])
        P.append(fighter.Part(f"pauldron_glow.{s}", low=stripe, bind=bind))
        # overlapping lames are separate parts so the exploded bake never confuses the layers
        for i, (v0, v1, off) in enumerate(((52, 70, 0.040), (64, 82, 0.046))):
            lame = mesh.plate(proj, [(v0, lo + 30 * sx, hi_ - 30 * sx), (v1, lo + 34 * sx, hi_ - 34 * sx)],
                              target=ctx.targets, offset=off, thickness=0.008, cols=18, smooth_iters=10,
                              rim=0.008, name=f"lame{i}.{s}", col=col, mat=M["metal"], rim_mat=M["trim"])
            P.append(fighter.Part(f"lame{i}.{s}", low=lame, bind=bind))

    # ── bracers (forearm) with flared cuffs, greaves + knee cops ─────────────────────────────
    for s, sx in (("L", 1), ("R", -1)):
        el, wr = J[f"elbow.{s}"], J[f"wrist.{s}"]
        fa = (wr - el).length
        ax = (wr - el).normalized()
        cyl = Cylindrical(el, ax, ref=(0, 0, 1))

        def flare(u, v, r, fa=fa):
            return 0.018 * mesh.smoothstep(fa * 0.72, fa * 1.02, v)

        br = mesh.plate(cyl, [(fa * 0.30, -180, 180), (fa * 0.70, -180, 180), (fa * 1.02, -180, 180)],
                        target=ctx.targets, offset=0.012, thickness=0.008, cols=20, smooth_iters=8, wrap=True,
                        shape_fn=flare, rim=0.010, name=f"bracer.{s}", col=col, mat=M["metal"], rim_mat=M["trim"])
        P.append(fighter.Part(f"bracer.{s}", low=br, bind=f"bone:forearm.{s}"))

        kn, an = J[f"knee.{s}"], J[f"ankle.{s}"]
        sl = (an - kn).length
        cyl = Cylindrical(kn, (an - kn).normalized(), ref=(0, -1, 0))

        def greave_shape(u, v, r, sl=sl):
            ridge = 0.013 * math.exp(-(u / 13.0) ** 2) * (1 - 0.5 * mesh.smoothstep(sl * 0.5, sl * 0.7, v))
            flare = 0.016 * (1 - mesh.smoothstep(sl * 0.08, sl * 0.24, v))       # bell under the knee cop
            return ridge + flare

        gr = mesh.plate(cyl, [(sl * 0.10, -112, 112), (sl * 0.45, -116, 116), (sl * 0.70, -104, 104)],
                        target=ctx.targets, offset=0.014, thickness=0.009, cols=18, smooth_iters=10,
                        shape_fn=greave_shape, rim=0.010, name=f"greave.{s}", col=col,
                        mat=M["dark_metal"], rim_mat=M["trim"])
        P.append(fighter.Part(f"greave.{s}", low=gr, bind=f"bone:shin.{s}"))
        # poleyn: a flattened, taller-than-wide cop with a vertical ridge (not a ball) + outer fan wing
        kproj = Spherical(kn + V((0, 0.035, 0.010)), up=(0, -1, 0.25), front=(0, 0, 1))
        o, d = kproj.ray(0, 0)
        R = (mesh._surface_r(mesh.bvh_of(ctx.targets), o, d, 0.3) or 0.1) + 0.016

        def cop_r(u, v, r, R=R):
            su, cu = math.sin(math.radians(u)), math.cos(math.radians(u))
            sv, cv = math.sin(math.radians(v)), math.cos(math.radians(v))
            A, B, C = R, R * 0.92, R * 1.32                     # depth, width, height semi-axes
            e = 1.0 / math.sqrt((sv * su / B) ** 2 + (sv * cu / C) ** 2 + (cv / A) ** 2)
            ridge = 0.009 * math.exp(-(su / 0.22) ** 2) * (1 - mesh.smoothstep(25, 60, v))
            point = 0.012 * max(0.0, -cu) ** 3 * mesh.smoothstep(25, 55, v)    # drops to a point below
            return e + ridge + point

        kc = mesh.plate(kproj, [(0, -180, 180), (22, -180, 180), (44, -180, 180), (60, -180, 180)], target=None,
                        r_fn=cop_r, offset=0.0, thickness=0.009, cols=24, smooth_iters=0, wrap=True, rim=0.009,
                        rows_n=8, name=f"kneecop.{s}", col=col, mat=M["metal"], rim_mat=M["trim"])
        P.append(fighter.Part(f"kneecop.{s}", low=kc, bind=f"bone:shin.{s}"))
        uo = -90 if sx > 0 else 90                               # outer side of this knee

        def fan_r(u, v, r, R=R, uo=uo):
            k = math.cos(math.radians((u - uo) * 1.6))
            return R * (0.98 + 0.05 * mesh.smoothstep(40, 80, v)) + 0.010 * max(0.0, k) ** 2

        fan = mesh.plate(kproj, [(38, uo - 34, uo + 34), (62, uo - 44, uo + 44), (84, uo - 30, uo + 30)],
                         target=None, r_fn=fan_r, offset=0.0, thickness=0.008, cols=12, smooth_iters=0,
                         rim=0.008, rows_n=6, name=f"kneefan.{s}", col=col, mat=M["metal"], rim_mat=M["trim"])
        P.append(fighter.Part(f"kneefan.{s}", low=fan, bind=f"bone:shin.{s}"))
        # cuisses: blackened steel over the front/outer thigh (fills the leg, keeps the legs dark)
        hp = J[f"hip.{s}"]
        tl = (kn - hp).length
        tcyl = Cylindrical(hp, (kn - hp).normalized(), ref=(0, -1, 0))   # axis points down: +u is -X

        def cuisse_shape(u, v, r, tl=tl):
            return 0.006 * math.exp(-(u / 16.0) ** 2) + 0.006 * mesh.smoothstep(tl * 0.66, tl * 0.84, v)

        def urange(a, b):                                      # (front-inner a, outer-back b) per side
            return (-b, a) if sx > 0 else (-a, b)

        cu = mesh.plate(tcyl, [(tl * 0.26, *urange(40, 125)), (tl * 0.55, *urange(48, 132)),
                               (tl * 0.82, *urange(40, 118))],   # stops above the poleyn (no overlap)
                        target=ctx.targets, offset=0.016, thickness=0.009, cols=16, smooth_iters=12,
                        shape_fn=cuisse_shape, rim=0.010, name=f"cuisse.{s}", col=col,
                        mat=M["dark_metal"], rim_mat=M["trim"])
        P.append(fighter.Part(f"cuisse.{s}", low=cu, bind=f"bone:thigh.{s}"))

    # ── tabards (cloth on x_ chains): front and back, pointed hems ───────────────────────────
    avoid = [hi]
    fr_top = []
    for i in range(7):
        u = -38 + 76 * i / 6
        o, d = axis.ray(u, bz0 + 0.004)
        r = mesh._surface_r(mesh.bvh_of([belt]), o, d, 0.6) or 0.16
        fr_top.append(o + d * (r + 0.006))   # clear the belt rim (z-fights in three otherwise)
    tab_f = mesh.cloth_panel(fr_top, 0.44, folds=3, fold_depth=0.011, flare=0.06,
                             hem=lambda u: 0.22 * (1 - abs(2 * u - 1)), avoid=avoid, clearance=0.03,
                             out_dir=(0, -1, 0), name="tabard_f", col=col, seed=1)
    mesh.set_material(tab_f, M["cloth"])
    P.append(fighter.Part("tabard_f", low=tab_f, bind=("chain", "tabard_f", "hips")))
    bk_top = []
    for i in range(7):
        u = 180 - 40 + 80 * i / 6
        o, d = axis.ray(u, bz0 + 0.004)
        r = mesh._surface_r(mesh.bvh_of([belt]), o, d, 0.6) or 0.16
        bk_top.append(o + d * (r + 0.009))
    tab_b = mesh.cloth_panel(bk_top, 0.52, folds=4, fold_depth=0.013, flare=0.07,
                             hem=lambda u: 0.15 * (1 - abs(2 * u - 1)), avoid=avoid, clearance=0.03,
                             out_dir=(0, 1, 0), name="tabard_b", col=col, seed=2)
    mesh.set_material(tab_b, M["cloth"])
    P.append(fighter.Part("tabard_b", low=tab_b, bind=("chain", "tabard_b", "hips")))

    # ── sword on prop.R (modelled in prop space: grip at origin, blade +Z, edge -Y) ──────────
    P += sword(ctx)
    return P


def sword(ctx) -> list:
    M, col = ctx.mats, ctx.col
    blade = mesh.loft([
        {"p": (0, 0, 0.095), "rx": 0.0085, "ry": 0.036, "exp": 1.6},
        {"p": (0, 0, 0.16), "rx": 0.0080, "ry": 0.042, "exp": 1.4},
        {"p": (0, 0, 0.50), "rx": 0.0070, "ry": 0.040, "exp": 1.3},
        {"p": (0, 0, 0.70), "rx": 0.0060, "ry": 0.032, "exp": 1.3},
        {"p": (0, 0, 0.80), "rx": 0.0040, "ry": 0.016, "exp": 1.3},
    ], segments=10, caps=("flat", "point"), up=(0, -1, 0), name="sw_blade", col=col, rings=16)
    mesh.set_material(blade, M["metal"])
    rune = mesh.loft([{"p": (0.0072, 0, 0.17), "rx": 0.0012, "ry": 0.005},
                      {"p": (0.0066, 0, 0.56), "rx": 0.0012, "ry": 0.005},
                      {"p": (0.0055, 0, 0.66), "rx": 0.0010, "ry": 0.002}],
                     segments=4, caps=("round", "point"), up=(0, -1, 0), name="sw_rune", col=col, rings=6)
    rune2 = mesh.loft([{"p": (-0.0072, 0, 0.17), "rx": 0.0012, "ry": 0.005},
                       {"p": (-0.0066, 0, 0.56), "rx": 0.0012, "ry": 0.005},
                       {"p": (-0.0055, 0, 0.66), "rx": 0.0010, "ry": 0.002}],
                      segments=4, caps=("round", "point"), up=(0, -1, 0), name="sw_rune2", col=col, rings=6)
    rune = mesh.join([rune, rune2], "sw_rune")
    mesh.set_material(rune, M["accent"])
    guard_pts = [(0, -0.115, 0.115), (0, -0.07, 0.092), (0, 0, 0.085), (0, 0.07, 0.092), (0, 0.115, 0.115)]
    guard = mesh.loft([{"p": p, "rx": 0.012 if abs(p[1]) < 0.1 else 0.008, "ry": 0.010 if abs(p[1]) < 0.1 else 0.007,
                        "exp": 2.6} for p in guard_pts], segments=10, caps=("round", "round"), up=(1, 0, 0),
                      name="sw_guard", col=col)
    mesh.set_material(guard, M["trim"])
    grip_st = []
    for i in range(9):
        z = -0.085 + 0.165 * i / 8
        grip_st.append({"p": (0, 0, z), "rx": 0.0165 + (0.0025 if i % 2 else 0.0), "ry": 0.0185 + (0.0025 if i % 2 else 0)})
    grip = mesh.loft(grip_st, segments=10, caps=("flat", "flat"), up=(0, -1, 0), name="sw_grip", col=col, rings=17,
                     smooth_path=False)
    mesh.set_material(grip, M["leather"])
    pommel = mesh.loft([{"p": (0, 0, -0.085), "rx": 0.014, "ry": 0.014},
                        {"p": (0, 0, -0.108), "rx": 0.026, "ry": 0.026, "exp": 1.6},
                        {"p": (0, 0, -0.132), "rx": 0.012, "ry": 0.012}],
                       segments=8, caps=("flat", "point"), up=(0, -1, 0), name="sw_pommel", col=col)
    mesh.set_material(pommel, M["trim"])
    mw = rig.prop_matrix(ctx.info, "prop.R")
    for o in (blade, rune, guard, grip, pommel):
        o.data.transform(mw)
        o.data.update()
    mesh.shade(blade, True, sharp_angle=50)
    mesh.shade(pommel, False)
    return [fighter.Part("sword_blade", low=blade, bind="bone:prop.R"),
            fighter.Part("sword_rune", low=rune, bind="bone:prop.R"),
            fighter.Part("sword_guard", low=guard, bind="bone:prop.R"),
            fighter.Part("sword_grip", low=grip, bind="bone:prop.R"),
            fighter.Part("sword_pommel", low=pommel, bind="bone:prop.R")]


def chain_config(ctx) -> list:
    """Tabards: hang with gravity, follow-through on the hips, and get pushed by the thighs."""
    def push_front(p):
        return 0.8 * max(0.0, p.get("thigh.L", (0, 0, 0))[0], p.get("thigh.R", (0, 0, 0))[0])

    def push_back(p):
        return 0.8 * max(0.0, -min(p.get("thigh.L", (0, 0, 0))[0], p.get("thigh.R", (0, 0, 0))[0]))

    return [anim.ChainCfg(ctx.chains["tabard_f"], gravity=0.7, drive=push_front),
            anim.ChainCfg(ctx.chains["tabard_b"], gravity=0.7, drive=push_back)]


def clip_overrides(ctx) -> dict:
    """Bespoke clips replace or extend the generated set: {clip_name: anim.Clip}. The proof keeps
    the generated set and only tunes the lobby idle to rest the sword on the shoulder."""
    return {}


if __name__ == "__main__":
    fighter.main(sys.modules[__name__])
