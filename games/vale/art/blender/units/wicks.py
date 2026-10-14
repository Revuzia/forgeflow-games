"""VALE Wicks: the lane minions (small lamp-bearers that walk the roads), built on the fighter pipeline.

    Blender -b --factory-startup --python art/blender/units/wicks.py -- [--only shieldwick,...] [--fast]

Four kinds share one silhouette family: a deep hood (no face: lamplight inside the hood is the accent,
tinted per viewer), a heavy cloak to the shins, small boots, and one carried lamp that names the job:
  shieldwick  (melee, 1.1 m)   a round stone shield on the left arm, a short lamp-mace in the right
  glimwick    (caster, 1.0 m)  a long pole with a hanging lamp
  greatwick   (siege, 1.5 m)   a broad back-lantern on a frame, a stone hammer
  brightwick  (super, 1.7 m)   stone pauldrons, a crown-lamp ring on the hood, a two-hand lamp staff
Forms are numpy SDF volumes; materials are the bible set baked (painted shading into the base colour);
the rig is VALE_BIPED_1 at minion proportions with the standard clips (the renderer plays idle, run,
attack1, death). Output: art/out/units/<id>.glb.
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
from common.hifi.sdf import Capsule, Ellipsoid, FlatCapsule, HalfSpace, Lathe, RoundBox, RoundCone, Sculpt, Sphere, Torus  # noqa: E402

N = sdf.Noise(13)


def folds(amp, freq):
    return lambda P: amp * (np.abs(np.sin(np.arctan2(P[:, 1], P[:, 0]) * freq + 0.8 * N(P, 3.0))) * 2 - 1) * -0.5


class Wick:
    """A Wick spec for pipeline.build (the fighter spec contract)."""
    KIND = "minion"
    OUT_SUBDIR = "units"
    MATERIAL_SET = "bible"
    ARMOUR_CONFORM = False
    TEXTURE_SIZE = 512
    GLB_COMPRESS = True
    SKINS: list = []
    SOCKETS = None
    VALUE_GRADIENT_STOPS = materials.BIBLE_GRADIENT_STOPS

    def __init__(self, id_: str, height: float, build: str):
        self.ID = id_
        self.H = height
        self.build_kind = build
        k = height / 1.1
        self.PROPORTIONS = rig.proportions(height=height * 0.86, head=0.30 * k, neck=0.03 * k, shoulder_width=0.34 * k, hip_width=0.18 * k,
                                           leg=0.36 * k, arm=0.36 * k, hand=0.11 * k, foot=0.17 * k, ankle_height=0.05 * k, stance=0.03 * k,
                                           a_pose_deg=62.0, spine_curve=0.02 * k)
        self.PALETTE = materials.bible_palette(cloth="#5B5650", cloth2="#C9C1AE", under="#34302C", leather="#4A3D33",
                                               stone="#B3AA98", ironstone="#4A4038", wood="#8A6E52", lampresin="#BF8F52", accent="#3F9CFF")
        self.MOTION = anim.motion_profile(weight="light" if height < 1.3 else "medium", weapon="one_hand", stance="neutral", run_ref_speed=3.2)

    def model(self, ctx) -> list:
        H, k = self.H, self.H / 1.1
        info, M, col = ctx.info, ctx.mats, ctx.col
        P = []

        def part(name, S, mat, bind, tris, vox=0.012):
            v, q = S.mesh(vox * k)
            ob = sdf.to_object(f"{name}_high", v, q, col)
            ob.data.materials.append(M[mat])
            P.append(fighter.Part(name, high=ob, tris=tris, bind=bind))

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
        hood.add(RoundCone((0, 0.08 * k, hz + 0.08 * k), (0, 0.2 * k, hz + 0.26 * k), 0.12 * k, 0.02 * k), k=0.06 * k)
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
        # the job props
        wr, wl = info.side("wrist", "R"), info.side("wrist", "L")
        b = self.build_kind
        if b in ("shield", "great", "bright"):
            weap = Sculpt("weapon")
            top = (wr.x, wr.y - 0.02 * k, wr.z + 0.35 * k)
            weap.add(Capsule((wr.x, wr.y, wr.z - 0.08 * k), top, 0.018 * k), k=0.0)
            weap.add(RoundBox(top, (0.07 * k, 0.07 * k, 0.09 * k) if b != "great" else (0.11 * k, 0.07 * k, 0.08 * k), 0.02 * k), k=0.01 * k)
            part("weapon", weap, "ironstone" if b != "great" else "stone", "bone:prop.R", 200)
        if b == "shield":
            sd = Sculpt("shield")
            c = (wl.x + 0.06 * k, wl.y - 0.06 * k, wl.z + 0.06 * k)
            sd.add(Lathe(c, lambda r, z: np.maximum(r - 0.2 * k, np.abs(z) - 0.025 * k), 0.22 * k, -0.04 * k, 0.04 * k,
                         axes=sdf.frame((0.6, -0.8, 0.0))), k=0.0)
            sd.add(Torus(c, 0.2 * k, 0.02 * k, axes=sdf.frame((0.6, -0.8, 0.0))), k=0.0)
            part("shield", sd, "stone", "bone:hand.L", 300)
            boss = Sculpt("boss")
            n = np.array([0.6, -0.8, 0.0])
            bp = np.array(c) + n * 0.03 * k
            boss.add(Ellipsoid(tuple(bp), (0.085 * k, 0.085 * k, 0.04 * k), axes=sdf.frame(tuple(n))), k=0.0)
            part("boss", boss, "accent", "bone:hand.L", 100)
        if b in ("glim", "bright"):
            pole = Sculpt("pole")
            bot = (wr.x, wr.y, 0.05 * k)
            tip = (wr.x, wr.y - 0.05 * k, H + (0.15 if b == "glim" else 0.3) * k)
            pole.add(Capsule(bot, tip, 0.016 * k), k=0.0)
            pole.add(Torus((tip[0], tip[1] - 0.06 * k, tip[2] - 0.04 * k), 0.06 * k, 0.012 * k), k=0.0)
            part("pole", pole, "wood", "bone:prop.R", 180)
            lamp = Sculpt("lamp")
            lc = (tip[0], tip[1] - 0.12 * k, tip[2] - 0.16 * k)
            lamp.add(Ellipsoid(lc, (0.06 * k, 0.06 * k, 0.08 * k)), k=0.0)
            part("lamp", lamp, "accent", "bone:prop.R", 100)
        if b == "great":
            pack = Sculpt("backlantern")
            bc = (0, 0.24 * k, sh.z - 0.05 * k)
            pack.add(RoundBox(bc, (0.16 * k, 0.1 * k, 0.2 * k), 0.03 * k), k=0.0)
            pack.sub(RoundBox((bc[0], bc[1] + 0.1 * k, bc[2] + 0.02 * k), (0.12 * k, 0.07 * k, 0.15 * k), 0.02 * k), k=0.01 * k)   # open to the back
            pack.add(Torus((bc[0], bc[1], bc[2] + 0.26 * k), 0.07 * k, 0.015 * k), k=0.0)                                         # carry ring
            part("backlantern", pack, "ironstone", "bone:chest", 300)
            core = Sculpt("backcore")
            core.add(Ellipsoid((bc[0], bc[1] + 0.05 * k, bc[2] + 0.04 * k), (0.12 * k, 0.07 * k, 0.15 * k)), k=0.0)
            part("backcore", core, "accent", "bone:chest", 100)
        if b == "bright":
            plates = Sculpt("pauldrons")
            for s in ("L", "R"):
                a = info.side("shoulder", s)
                plates.add(Ellipsoid((a.x, a.y, a.z + 0.04 * k), (0.11 * k, 0.1 * k, 0.06 * k)), k=0.0)
            part("pauldrons", plates, "stone", "bone:chest", 300)
            ring = Sculpt("crown")
            ring.add(Torus((0, 0.02 * k, hz + 0.18 * k), 0.12 * k, 0.025 * k), k=0.0)
            part("crown", ring, "accent", "bone:head", 120)
        return P


WICKS = {"shieldwick": (1.1, "shield"), "glimwick": (1.0, "glim"), "greatwick": (1.5, "great"), "brightwick": (1.7, "bright")}


def main() -> None:
    def extra(p):
        p.add_argument("--skin", default="")
        p.add_argument("--no-skins", action="store_true")
        p.add_argument("--skins-only", action="store_true")
        p.add_argument("--clip-sheet", action="store_true")
        p.add_argument("--ids", default="")
    args = scene.parse_args(extra)
    for wid, (h, b) in WICKS.items():
        if args.ids and wid not in args.ids.split(","):
            continue
        pipeline.build(Wick(wid, h, b), args)


if __name__ == "__main__":
    main()
