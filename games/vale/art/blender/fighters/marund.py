"""marund: Dome mason (Plinth, Serenade). ART 2.0: sculpted volumes painted by concept projection.

    python3 art/tools/concept_plates.py marund --height 2.35 --erase-saturated-above 1.95   # plates
    python3 art/blender/proto/marund_cap_top.py                                             # cap top plate
    python3 art/build.py fighter marund --no-skins [--fast]

Brief: _design/fighters/marund.md. Concept: _design/concept/marund.webp (front + back, hand-painted).
The forms are numpy SDF volumes (common/hifi/sdf.py) fitted to the concept on a 10 cm grid; the base
colour is the concept painting itself, projected occlusion-aware onto the game mesh
(common/hifi/project.py, the pipeline's PROJECTION hook); normals and AO bake from the sculpt.

Where the concept and the brief disagree the brief wins: the painted gem rings on the cap are three
WINDOWS (lampresin frames, `accent` glazing, front and +-55 degrees only); the cap is plain stone behind.
The concept's proportions win over the brief's start values (it is the approved look): cap 1.28 m
across, the mask +-0.30 m wide, short heavy arms, fists at the hips, a wide square stance.
"""
from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import bpy  # noqa: E402,F401
import numpy as np  # noqa: E402

from common import anim, fighter, materials, rig  # noqa: E402
from common.hifi import sdf  # noqa: E402
from common.hifi.sdf import (Capsule, Ellipsoid, FlatCapsule, HalfSpace, Lathe, RoundBox, RoundCone,  # noqa: E402
                             Sculpt, Sphere, Torus, Tube)

ID = "marund"
TITLE = "Dome mason"
ROLE_MASS = "plinth"
ORIGIN = "serenade"
CARD = {"primary": "#6E6358", "secondary": "#A58A6C"}

# rig fitted to the sculpt: crown of the head block under the cap 1.88 m, shoulders x 0.46 at 1.38,
# elbows ~(0.52, 1.04), wrists ~(0.55, 0.87), hips x 0.20 at 0.62, knees 0.32, ankles x 0.335 at 0.10
PROPORTIONS = rig.proportions(height=1.88, head=0.35, neck=0.04, shoulder_width=0.92, hip_width=0.40, leg=0.537,
                              thigh_frac=0.58, arm=0.55, upper_arm_frac=0.62, hand=0.20, foot=0.34,
                              ankle_height=0.10, spine_curve=0.0, stance=0.135, toe_out_deg=9.0, knee_bend=0.014,
                              a_pose_deg=78.0, arm_forward_deg=3.0, elbow_bend_deg=18.0, shoulder_drop=0.16)
MATERIAL_SET = "bible"
PALETTE = materials.bible_palette(stone="#D0C6B3", ironstone="#4A4038", wood="#B99B78", wood_dark="#58443A",
                                  cloth="#87776A", cloth2="#D0C5B1", under="#3A3430", leather="#4B3B30",
                                  lampresin="#BF8F52", ink="#17181B", accent="#3F9CFF")
VALUE_GRADIENT_STOPS = materials.BIBLE_GRADIENT_STOPS
MOTION = anim.motion_profile(weight="heavy", weapon="one_hand", stance="wide", run_ref_speed=3.35)
SOCKETS = None
SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92}
TEXTURE_SIZE = 2048      # the painted base colour; normal + ORM at 1024 (CONTRACT §12 Materials)
TEXTURE_SIZES = {"normal": 512, "orm": 512}
GLB_COMPRESS = True
ARMOUR_CONFORM = False
AO_INTO_BASE = 0.25       # the projected painting already carries its painted occlusion; only deepen creases
SKINS: list = []          # ART 2.0 skins need their own painted concepts (palette swaps cannot repaint a painting)

HEIGHT = 2.35             # crown of the cap (the projection plates' scale)
PROJECTION = {"concept": "marund", "height": HEIGHT, "tops": {"cap": ("marund_captop.png", 0.7)},
              "flat": {"windows_frame": "#BF8F52"}}
NOISE = sdf.Noise(7)
VOXEL = 0.007


def folds(amp, freq, axis=0, phase=0.0, zfade=None):
    def fn(P):
        u = P[:, axis] * freq + phase + 0.6 * NOISE(P, 3.0)
        a = amp
        if zfade is not None:
            z0, z1 = zfade
            a = amp * np.clip((z0 - P[:, 2]) / (z0 - z1), 0.15, 1.0)
        return a * (np.abs(np.sin(u)) * 2.0 - 1.0) * -0.5
    return fn


def chips(amp, freq):
    def fn(P):
        return amp * np.clip(NOISE.ridged(P, freq, 3), 0, 1) - amp * 0.3
    return fn


def _cap_prof(r, z):
    t = np.clip((r - 0.40) / 0.24, 0, 1)
    rim_top = 2.005 - 0.04 * t * t
    rim_bot = 1.905 - 0.02 * t
    d_rim = np.maximum(np.maximum(z - rim_top, rim_bot - z), r - 0.64)
    q = np.sqrt((r / 0.55) ** 2 + ((z - 2.0) / 0.345) ** 2)
    d_dome = np.maximum(np.maximum((q - 1.0) * 0.30, z - 2.315), 1.95 - z)
    return np.minimum(d_rim, d_dome)


def sculpts() -> list:
    """(name, Sculpt, voxel scale, material role, bind, tris) in build order."""
    out = []

    def part(name, S, role, bind, tris, vs=1.0):
        out.append((name, S, vs, role, bind, tris))

    # CAP (rigid on the head)
    cap = Sculpt("cap")
    cap.add(Lathe((0, 0, 0), _cap_prof, 0.66, 1.86, 2.34).displaced(chips(0.012, 9.0), 0.012), k=0.0)
    for zc in (2.115, 2.215):
        cap.sub(Torus((0, 0, zc), 0.55 * math.sqrt(max(0.0, 1 - ((zc - 2.0) / 0.345) ** 2)) + 0.004, 0.009), k=0.004)
    win = []
    for ang in (0.0, 55.0, -55.0):
        a = math.radians(ang)
        z = 2.19
        rr = 0.55 * math.sqrt(1 - ((z - 2.0) / 0.345) ** 2)
        c = np.array([-math.sin(a) * rr, -math.cos(a) * rr, z])
        n = c * np.array([1, 1, 0]) / rr + np.array([0, 0, 0.45])
        n /= np.linalg.norm(n)
        win.append((c, n))
        cap.sub(Capsule(c - n * 0.05, c + n * 0.05, 0.104), k=0.006)
    part("cap", cap, "stone", "bone:head", 3600)
    band = Sculpt("cap_band")
    band.add(Torus((0, 0, 2.02), 0.553, 0.026, rz=0.028), k=0.0)
    for i in range(24):
        a = 2 * math.pi * i / 24
        band.add(Sphere((math.cos(a) * 0.578, math.sin(a) * 0.578, 2.022), 0.011), k=0.004)
    part("cap_band", band, "ironstone", "bone:head", 1100, 0.6)
    frames, glass = Sculpt("windows_frame"), Sculpt("windows_glass")
    for c, n in win:
        frames.add(Torus(c - n * 0.004, 0.098, 0.018, axes=sdf.frame(n), rz=0.015), k=0.0)
        glass.add(Capsule(c - n * 0.022, c - n * 0.010, 0.089), k=0.0)
    part("windows_frame", frames, "lampresin", "bone:head", 600, 0.6)
    part("windows_glass", glass, "accent", "bone:head", 240, 0.6)

    # HEAD + MASK (rigid on the head)
    head = Sculpt("head")
    head.add(RoundBox((0, 0.06, 1.71), (0.32, 0.25, 0.17), 0.08), k=0.0)
    head.add(RoundBox((0, 0.08, 1.60), (0.34, 0.26, 0.07), 0.04), k=0.03)
    head.add(RoundBox((0, -0.17, 1.585), (0.19, 0.08, 0.055), 0.025), k=0.015)
    for sx in (-1, 1):
        head.add(RoundBox((sx * 0.325, -0.07, 1.70), (0.045, 0.13, 0.15), 0.02), k=0.01)
    part("head", head, "wood", "bone:head", 1000)
    mask = Sculpt("mask")
    face = Ellipsoid((0, -0.02, 1.735), (0.305, 0.25, 0.165))
    mask.add(face.displaced(lambda P: -0.004 * NOISE(P, 18.0), 0.004), k=0.0)
    mask.inter(HalfSpace((0, -0.10, 1.7), (0, 1, 0), 1.0), k=0.01)
    mask.inter(HalfSpace((0, 0, 1.62), (0, 0, -1), 1.0), k=0.006)
    mask.add(RoundBox((0, -0.245, 1.84), (0.26, 0.035, 0.024), 0.014), k=0.014)
    mask.add(RoundCone((0, -0.255, 1.80), (0, -0.33, 1.635), 0.06, 0.018), k=0.03)
    for sx in (-1, 1):
        mask.sub(Ellipsoid((sx * 0.135, -0.25, 1.785), (0.085, 0.06, 0.034), axes=sdf.rot_y(sx * -14)), k=0.01)
        mask.sub(RoundBox((sx * 0.20, -0.23, 1.69), (0.006, 0.04, 0.06), 0.003, axes=sdf.rot_y(sx * 18)), k=0.002)
    part("mask", mask, "wood", "bone:head", 1500, 0.6)

    # TORSO + ARMS (heat weights)
    torso = Sculpt("shirt")
    torso.add(Ellipsoid((0, 0.02, 1.25), (0.43, 0.30, 0.30)), k=0.0)
    torso.add(Ellipsoid((0, 0.08, 1.46), (0.37, 0.26, 0.24)), k=0.10)
    torso.add(Ellipsoid((0, 0.00, 1.06), (0.39, 0.29, 0.14)), k=0.10)
    for sx in (-1, 1):
        torso.add(Ellipsoid((sx * 0.30, 0.05, 1.50), (0.20, 0.20, 0.12)), k=0.08)
        torso.add(Sphere((sx * 0.46, 0.03, 1.33), 0.17), k=0.08)
        torso.add(FlatCapsule((sx * 0.51, 0.03, 1.30), (sx * 0.565, 0.0, 1.06), 0.155, 0.15, 0.15, 0.145, side=(1, 0, 0)), k=0.06)
    part("shirt", torso, "cloth2", "auto", 2600)
    wraps = Sculpt("forearms")
    for sx in (-1, 1):
        fa = FlatCapsule((sx * 0.57, -0.02, 1.04), (sx * 0.55, -0.10, 0.88), 0.14, 0.13, 0.125, 0.12, side=(1, 0, 0))
        wraps.add(fa.displaced(lambda P: 0.006 * np.sin(P[:, 2] * 95.0 + 2.0 * P[:, 0]), 0.006), k=0.0)
    part("forearms", wraps, "leather", "auto", 800)
    for s, sx in (("R", -1), ("L", 1)):
        hand = Sculpt(f"hand_{s}")
        c = np.array([sx * 0.545, -0.13, 0.795])
        hand.add(RoundBox(c, (0.105, 0.095, 0.095), 0.055), k=0.0)
        for i in range(4):
            hand.add(Capsule(c + (sx * -0.06, -0.085, 0.06 - i * 0.04), c + (sx * 0.06, -0.085, 0.06 - i * 0.04), 0.026), k=0.02)
        hand.add(Capsule(c + (sx * -0.09, -0.06, 0.07), c + (sx * -0.07, -0.08, -0.02), 0.033), k=0.02)
        part(f"hand_{s}", hand, "wood", f"bone:hand.{s}", 600)

    # APRON, TUNIC, BELT (heat weights)
    apron = Sculpt("apron")
    apron.add(RoundBox((0, -0.255, 1.18), (0.30, 0.05, 0.22), 0.03, axes=sdf.rot_x(-8)), k=0.0)
    skirt = RoundBox((0, -0.31, 0.71), (0.355, 0.035, 0.29), 0.02, axes=sdf.rot_x(4))
    apron.add(skirt.displaced(folds(0.018, 16.0, axis=0, zfade=(0.95, 0.45)), 0.018), k=0.05)
    apron.add(RoundBox((-0.06, -0.30, 1.20), (0.26, 0.04, 0.16), 0.03, axes=sdf.rot_y(-28) @ sdf.rot_x(-8)), k=0.02)
    part("apron", apron, "cloth", "auto", 1800)
    tunic = Sculpt("tunic")
    tun = FlatCapsule((0, 0.02, 0.42), (0, 0.01, 1.02), 0.47, 0.35, 0.41, 0.30, side=(1, 0, 0))
    tunic.add(tun.displaced(folds(0.014, 13.0, axis=0, phase=1.3, zfade=(1.0, 0.45)), 0.014), k=0.0)
    tunic.inter(HalfSpace((0, 0, 0.44), (0, 0, -1), 2.0), k=0.01)
    part("tunic", tunic, "cloth", "auto", 1700)
    belt = Sculpt("belt")
    belt.add(Torus((0, 0.0, 1.0), 0.41, 0.045, axes=np.diag([1.0, 0.41 / 0.31, 1.0]), rz=0.035), k=0.0)
    belt.add(RoundBox((0.0, -0.33, 1.0), (0.05, 0.02, 0.035), 0.008), k=0.0)
    for sx in (-1, 1):
        belt.add(Tube([(sx * 0.17, -0.27, 1.38), (sx * 0.20, -0.22, 1.47), (sx * 0.24, -0.05, 1.53), (sx * 0.24, 0.20, 1.45)],
                      [0.022, 0.022, 0.022, 0.022], k=0.01), k=0.0)
    part("belt", belt, "leather", "auto", 900)

    # LEGS (heat weights), knee slabs rigid on the shins
    legs = Sculpt("legs")
    for sx in (-1, 1):
        legs.add(FlatCapsule((sx * 0.22, 0.03, 0.62), (sx * 0.32, 0.0, 0.26), 0.16, 0.15, 0.14, 0.13, side=(1, 0, 0)), k=0.0)
        legs.add(FlatCapsule((sx * 0.32, 0.0, 0.30), (sx * 0.33, 0.0, 0.14), 0.135, 0.13, 0.13, 0.13, side=(1, 0, 0)), k=0.04)
    part("legs", legs, "under", "auto", 900)
    for s, sx in (("R", -1), ("L", 1)):
        kn = Sculpt(f"knee_{s}")
        kn.add(RoundBox((sx * 0.335, -0.10, 0.285), (0.13, 0.05, 0.105), 0.025, axes=sdf.rot_x(-6)).displaced(chips(0.01, 7.0), 0.01), k=0.0)
        part(f"knee_{s}", kn, "stone", f"bone:shin.{s}", 250)
    boots = Sculpt("boots")
    for sx in (-1, 1):
        boots.add(RoundBox((sx * 0.335, -0.05, 0.085), (0.165, 0.22, 0.085), 0.06), k=0.0)
        boots.add(FlatCapsule((sx * 0.335, 0.02, 0.10), (sx * 0.335, 0.02, 0.22), 0.15, 0.14, 0.145, 0.135, side=(1, 0, 0)), k=0.05)
        boots.add(Torus((sx * 0.335, 0.02, 0.20), 0.145, 0.018), k=0.01)
    boots.inter(HalfSpace((0, 0, 0.0), (0, 0, -1), 2.0), k=0.0)
    part("boots", boots, "leather", "auto", 1200)

    # PROPS: the maul on prop.R, the rod in the left fist, the pail on the hips
    fist_r = np.array([-0.545, -0.13, 0.765])
    head_c = np.array([-0.285, -0.45, 0.79])
    d = head_c - fist_r
    d[2] = 0
    d /= np.linalg.norm(d)
    haft = Sculpt("maul_haft")
    haft.add(Capsule(fist_r - d * 0.30, head_c, 0.036), k=0.0)
    part("maul_haft", haft, "wood_dark", "bone:prop.R", 200)
    mh = Sculpt("maul_head")
    mh.add(RoundBox(head_c, (0.13, 0.11, 0.185), 0.025, axes=sdf.rot_z(-math.degrees(math.atan2(d[0], -d[1])))).displaced(chips(0.014, 6.0), 0.014), k=0.0)
    part("maul_head", mh, "ironstone", "bone:prop.R", 400)
    fist_l = np.array([0.545, -0.13, 0.765])
    rod = Sculpt("rod_l")
    rod.add(Capsule(fist_l + np.array([0.27, 0.10, 0.0]), fist_l + np.array([-0.12, -0.20, 0.0]), 0.036), k=0.0)
    part("rod_l", rod, "wood_dark", "bone:hand.L", 150)
    pc = np.array([0.31, -0.42, 0.72])

    def pail_prof(r, z):
        rr = 0.135 + 0.025 * (z / 0.28)
        outer = np.maximum(np.maximum(r - rr, -z), z - 0.28)
        inner = np.maximum(r - (rr - 0.02), 0.03 - z)
        return np.maximum(outer, -inner)
    pail = Sculpt("pail")
    pail.add(Lathe(pc, pail_prof, 0.17, 0.0, 0.29), k=0.0)
    for zz in (0.08, 0.20):
        pail.add(Torus(pc + (0, 0, zz), 0.135 + 0.025 * (zz / 0.28) + 0.004, 0.012, rz=0.022), k=0.0)
    part("pail", pail, "wood", "bone:hips", 900)
    return out


def model(ctx) -> list:
    P = []
    for name, S, vs, role, bind, tris in sculpts():
        v, q = S.mesh(VOXEL * vs)
        ob = sdf.to_object(f"{name}_high", v, q, ctx.col)
        ob.data.materials.append(ctx.mats[role])
        P.append(fighter.Part(name, high=ob, tris=tris, bind=bind))
    return P


if __name__ == "__main__":
    fighter.main(sys.modules[__name__])
