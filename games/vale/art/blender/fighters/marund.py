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
# arm blocks (anim.ONE_HAND layout: R wrist rel, R pole, R aim, L wrist rel, L pole): his arms are short (0.55 m to
# the wrist) under a 1.28 m cap, so the maul is carried one-handed at the right knee and taken in both hands
# only where the hands can meet (bespoke clips below)
BLOCKS = {
    "guard":    ((-0.10, -0.30, -0.92), (-0.8, 0.5, -0.3), (-0.08, -0.88, -0.47), (0.04, -0.42, -0.88), None),
    "run_fwd":  ((-0.06, -0.48, -0.84), (-0.8, 0.4, -0.4), (-0.06, -0.93, -0.36), (0.08, -0.40, -0.86), None),
    "run_back": ((-0.12, 0.22, -0.94), (-0.6, 0.7, -0.2), (-0.08, -0.90, -0.42), (0.10, 0.30, -0.90), None),
    "dash":     ((-0.20, 0.45, -0.80), (-0.7, 0.5, 0.2), (-0.20, 0.80, -0.56), (0.20, 0.50, -0.80), None),
    "stunned":  ((-0.06, -0.20, -0.97), (-0.8, 0.5, -0.3), (-0.10, -0.82, -0.56), (0.05, -0.20, -0.96), None),
}
MOTION = anim.motion_profile(weight="heavy", weapon="one_hand", stance="wide", run_ref_speed=3.35, blocks=BLOCKS)
MAUL_GRIP = (-0.566, -0.066, 0.773)     # palm.R of this rig (rig.build_rig joints): prop.R's head
MAUL_BUTT = 0.24                        # haft behind the grip (m)
MAUL_REACH = 0.74                       # grip -> head centre along the haft (m): 0.98 m haft, brief 0.95
SOCKETS = None
SPLASH = {"map": "map_rift", "clip": "victory", "t": 0.92}
TEXTURE_SIZE = 2048      # the painted base colour; normal + ORM at 1024 (CONTRACT §12 Materials)
TEXTURE_SIZES = {"normal": 512, "orm": 512}
GLB_COMPRESS = True
ARMOUR_CONFORM = False
AO_INTO_BASE = 0.25       # the projected painting already carries its painted occlusion; only deepen creases
# ART 2.0 skins re-colour the projected painting part by part (each part's mean moves onto the skin's role
# colour, its painted detail kept; pipeline -> project.recolour), plus skin-only extras painted flat
# (SKIN_FLAT part -> role). Palettes: _design/fighters/marund.md section 9.
SKINS: list = [
    {"id": "marund_gorgewalk", "extra": {"rope_coil": True}, "card": {"primary": "#4A4F55", "secondary": "#9A8F7A"},
     "palette": {"stone": "#BAC0C6", "ironstone": "#3F4349", "wood": "#B09478", "cloth": "#6E747C", "cloth2": "#CDC6B6",
                 "under": "#33363A", "leather": "#463A31", "rope": "#9A8F7A"}},
    {"id": "marund_long_evening", "extra": {"lamp_finial": True}, "card": {"primary": "#4A3550", "secondary": "#9C8566"},
     "palette": {"stone": "#D0BCCB", "ironstone": "#5B3A5E", "wood": "#B99B78", "cloth": "#8E6E98", "cloth2": "#D6CAD3",
                 "under": "#2F2630", "leather": "#3E2E36", "lampresin": "#9C8566"}},
]
SKIN_FLAT = {"rope_coil": "rope", "finial_post": "wood", "finial_vessel": "lampresin"}

HEIGHT = 2.35             # crown of the cap (the projection plates' scale)
PROJECTION = {"concept": "marund", "height": HEIGHT, "tops": {"cap": ("marund_captop.png", 0.7)},
              # the re-modelled maul and the trowel sit where the concept paints other things: flat paint
              "flat": {"windows_frame": "#BF8F52", "maul_haft": "#58443A", "maul_bands": "#BF8F52",
                       "maul_head": "#5A4D44", "maul_faces": "#CFC4AF", "trowel": "#58443A"}}
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
    part("cap", cap, "stone", "bone:x_cap_tip", 2900)
    band = Sculpt("cap_band")
    band.add(Torus((0, 0, 2.02), 0.553, 0.026, rz=0.028), k=0.0)
    for i in range(24):
        a = 2 * math.pi * i / 24
        band.add(Sphere((math.cos(a) * 0.578, math.sin(a) * 0.578, 2.022), 0.011), k=0.004)
    part("cap_band", band, "ironstone", "bone:x_cap_tip", 800, 0.6)
    frames, glass = Sculpt("windows_frame"), Sculpt("windows_glass")
    for c, n in win:
        frames.add(Torus(c - n * 0.004, 0.098, 0.018, axes=sdf.frame(n), rz=0.015), k=0.0)
        glass.add(Capsule(c - n * 0.022, c - n * 0.010, 0.089), k=0.0)
    part("windows_frame", frames, "lampresin", "bone:x_cap_tip", 500, 0.6)
    part("windows_glass", glass, "accent", "bone:x_cap_tip", 240, 0.6)

    # HEAD + MASK (rigid on the head)
    head = Sculpt("head")
    head.add(RoundBox((0, 0.06, 1.71), (0.32, 0.25, 0.17), 0.08), k=0.0)
    head.add(RoundBox((0, 0.08, 1.60), (0.34, 0.26, 0.07), 0.04), k=0.03)
    head.add(RoundBox((0, -0.17, 1.585), (0.19, 0.08, 0.055), 0.025), k=0.015)
    for sx in (-1, 1):
        head.add(RoundBox((sx * 0.325, -0.07, 1.70), (0.045, 0.13, 0.15), 0.02), k=0.01)
    part("head", head, "wood", "bone:head", 850)
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
    part("shirt", torso, "cloth2", "auto", 2200)
    wraps = Sculpt("forearms")
    for sx in (-1, 1):
        fa = FlatCapsule((sx * 0.57, -0.02, 1.04), (sx * 0.55, -0.10, 0.88), 0.14, 0.13, 0.125, 0.12, side=(1, 0, 0))
        wraps.add(fa.displaced(lambda P: 0.006 * np.sin(P[:, 2] * 95.0 + 2.0 * P[:, 0]), 0.006), k=0.0)
    part("forearms", wraps, "leather", "auto", 650)
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
    part("apron", apron, "cloth", "auto", 1500)
    tunic = Sculpt("tunic")
    tun = FlatCapsule((0, 0.02, 0.42), (0, 0.01, 1.02), 0.47, 0.35, 0.41, 0.30, side=(1, 0, 0))
    tunic.add(tun.displaced(folds(0.014, 13.0, axis=0, phase=1.3, zfade=(1.0, 0.45)), 0.014), k=0.0)
    tunic.inter(HalfSpace((0, 0, 0.44), (0, 0, -1), 2.0), k=0.01)
    part("tunic", tunic, "cloth", "auto", 1450)
    belt = Sculpt("belt")
    belt.add(Torus((0, 0.0, 1.0), 0.41, 0.045, axes=np.diag([1.0, 0.41 / 0.31, 1.0]), rz=0.035), k=0.0)
    belt.add(RoundBox((0.0, -0.33, 1.0), (0.05, 0.02, 0.035), 0.008), k=0.0)
    for sx in (-1, 1):
        belt.add(Tube([(sx * 0.17, -0.27, 1.38), (sx * 0.20, -0.22, 1.47), (sx * 0.24, -0.05, 1.53), (sx * 0.24, 0.20, 1.45)],
                      [0.022, 0.022, 0.022, 0.022], k=0.01), k=0.0)
    part("belt", belt, "leather", "auto", 750)

    # LEGS (heat weights), knee slabs rigid on the shins
    legs = Sculpt("legs")
    for sx in (-1, 1):
        legs.add(FlatCapsule((sx * 0.22, 0.03, 0.62), (sx * 0.32, 0.0, 0.26), 0.16, 0.15, 0.14, 0.13, side=(1, 0, 0)), k=0.0)
        legs.add(FlatCapsule((sx * 0.32, 0.0, 0.30), (sx * 0.33, 0.0, 0.14), 0.135, 0.13, 0.13, 0.13, side=(1, 0, 0)), k=0.04)
    part("legs", legs, "under", "auto", 750)
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
    part("boots", boots, "leather", "auto", 1000)

    # PROPS: the maul on prop.R (modelled along the prop bone's rest axis, so an Aim points the haft exactly:
    # grip at the palm, haft forward, head block 0.74 m out with its 0.40 m length across the haft, pale
    # worn striking faces on both ends so the head reads against the road), the trowel through the belt
    G = np.array(MAUL_GRIP)
    ax = np.array([0.0, -1.0, 0.0])
    haft = Sculpt("maul_haft")
    haft.add(Capsule(G - ax * MAUL_BUTT, G + ax * (MAUL_REACH - 0.10), 0.034), k=0.0)
    haft.add(Sphere(G - ax * MAUL_BUTT, 0.045), k=0.01)                            # the pommel knob
    part("maul_haft", haft, "wood_dark", "bone:prop.R", 320)
    bands = Sculpt("maul_bands")
    for a in (0.42, 0.55):
        bands.add(Torus(G + ax * a, 0.040, 0.011, axes=sdf.rot_x(90)), k=0.0)
    part("maul_bands", bands, "lampresin", "bone:prop.R", 100, 0.6)
    hc = G + ax * MAUL_REACH
    mh = Sculpt("maul_head")
    mh.add(RoundBox(hc, (0.12, 0.12, 0.17), 0.03).displaced(chips(0.012, 6.0), 0.012), k=0.0)
    part("maul_head", mh, "ironstone", "bone:prop.R", 420)
    faces = Sculpt("maul_faces")
    for sz in (-1, 1):
        faces.add(RoundBox(hc + (0, 0, sz * 0.185), (0.128, 0.128, 0.026), 0.018).displaced(chips(0.006, 9.0), 0.006), k=0.0)
    part("maul_faces", faces, "stone", "bone:prop.R", 220, 0.6)
    trowel = Sculpt("trowel")
    trowel.add(Capsule((-0.405, -0.06, 1.13), (-0.415, -0.05, 0.98), 0.024), k=0.0)
    trowel.add(RoundBox((-0.425, -0.045, 0.88), (0.012, 0.075, 0.10), 0.01), k=0.01)
    part("trowel", trowel, "wood_dark", "bone:hips", 150, 0.6)
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
    part("pail", pail, "wood", "bone:hips", 750)
    return out


def skin_extras(extra: dict) -> list:
    """skin-only geometry: Gorgewalk's rope coil on the left shoulder, Long Evening's lamp finial on the crown"""
    out = []
    if extra.get("rope_coil"):
        coil = Sculpt("rope_coil")
        tilt = sdf.rot_y(-22)                                            # lies on the shoulder's outward slope
        for k, z in enumerate((1.455, 1.49)):
            coil.add(Torus((0.50 - 0.012 * k, 0.02, z), 0.062 - 0.008 * k, 0.021, axes=tilt, rz=0.021).displaced(
                lambda P: 0.004 * np.sin(np.arctan2(P[:, 1] - 0.02, P[:, 0] - 0.5) * 9), 0.004), k=0.004)
        coil.add(Capsule((0.44, 0.075, 1.47), (0.44, 0.075, 1.52), 0.011), k=0.003)   # an iron pin at the rope's end
        out.append(("rope_coil", coil, 0.6, "cloth2", "bone:shoulder.L", 500))
    if extra.get("lamp_finial"):
        post, vessel = Sculpt("finial_post"), Sculpt("finial_vessel")
        post.add(Lathe((0, 0, 0), lambda r, z: np.maximum(r - (0.032 - 0.012 * np.clip((z - 2.30) / 0.06, 0, 1)), np.maximum(2.30 - z, z - 2.365)),
                       0.04, 2.29, 2.37), k=0.0)
        post.add(Torus((0, 0, 2.362), 0.03, 0.007), k=0.004)
        vessel.add(Ellipsoid((0, 0, 2.383), (0.03, 0.03, 0.026)), k=0.0)        # top 2.409: +0.094 m over the crown
        out.append(("finial_post", post, 0.5, "wood", "bone:x_cap_tip", 160))
        out.append(("finial_vessel", vessel, 0.5, "lampresin", "bone:x_cap_tip", 120))
    return out


def model(ctx) -> list:
    P = []
    extra = (ctx.skin or {}).get("extra") or {}
    for name, S, vs, role, bind, tris in sculpts() + skin_extras(extra):
        v, q = S.mesh(VOXEL * vs)
        ob = sdf.to_object(f"{name}_high", v, q, ctx.col)
        ob.data.materials.append(ctx.mats[role])
        P.append(fighter.Part(name, high=ob, tris=tris, bind=bind))
    return P


# ── RIG: the cap rides its own two bones ───────────────────────────────────────────────────────────
# x_cap (pivot on the crown, child of head) is LEVEL-LOCKED in every clip (closing review marund-M1: the
# 1.28 m disc pitching with the head 17-73 deg turned every action into a disc nod): clip_overrides
# solves its rotation per frame so the disc stays level and only follows the head's yaw; a clip may let
# it follow the head (`follow`, 0..1: Shoulder In's ram tip, the stunned slip, the death fall).
# x_cap_tip (pivot on the rear rim, child of x_cap) carries the authored tips: the recall's lift of the
# front rim, the knock in victory.
CAP_PIVOT = (0.0, 0.004, 1.88)
CAP_TIP_PIVOT = (0.0, 0.60, 1.93)


def rig_extras(ctx) -> None:
    from mathutils import Vector
    from common import scene
    arm = ctx.info.armature
    scene.select_only([arm], arm)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    for nm, head, par in (("x_cap", CAP_PIVOT, "head"), ("x_cap_tip", CAP_TIP_PIVOT, "x_cap")):
        b = eb.new(nm)
        b.head = Vector(head)
        b.tail = Vector(head) + Vector((0.0, 0.0, 0.12))
        b.align_roll(Vector((0.0, -1.0, 0.0)))
        b.parent = eb[par]
        b.use_deform = True
    bpy.ops.object.mode_set(mode="OBJECT")
    for nm in ("x_cap", "x_cap_tip"):
        arm.pose.bones[nm].rotation_mode = "XYZ"
        ctx.info.lengths[nm] = arm.data.bones[nm].length


def _levelled(skel, clip, follow=None):
    """wrap a clip: x_cap's rotation is solved every frame so the disc stays level (yaw follows the head);
    follow(t) in 0..1 lets it ride the head instead (slerp)."""
    from mathutils import Matrix, Quaternion
    rest = skel.rest["x_cap"].to_3x3()
    loc = skel.local["x_cap"].to_3x3()
    src = clip.sample

    def sample(t):
        p = dict(src(t))
        M = skel.fk(p)
        Mh = M["head"].to_3x3()
        f = Mh.col[2]
        yaw = math.atan2(f.x, -f.y)
        des = Matrix.Rotation(yaw, 3, "Z") @ rest
        q = ((Mh @ loc).inverted() @ des).to_quaternion()
        w = max(0.0, min(1.0, follow(t))) if follow else 0.0
        if w > 0.0:
            q = q.slerp(Quaternion(), w)
        p["x_cap"] = tuple(math.degrees(a) for a in q.to_euler("XYZ"))
        return p

    return anim.Clip(clip.name, clip.frames, clip.loop, sample, clip.impact, clip.secondary, dict(clip.meta))


def clip_overrides(ctx) -> dict:
    """Marund's own clips (brief §8; closing review marund-M1/M2/M3). Every clip runs through _levelled.
      attack1     overhead chop from high outside the right rim, the head landing ~1.3 m out on the ground
      attack2     flat side sweep at knee height, right to left, a shoulder turn behind it
      cast_a1     Shoulder In: the left shoulder drops under the rim, the disc tips like a ram (follow 0.55)
      cast_a2     Shelter Dome: the maul raised level across the face, head out past the left rim (cap back 8
                  deg), then planted head-down in front, both hands stacked on the pommel, held to f30
      cast_a3     Mortar Pail: the left hand dips into the pail and flings underhand, the maul hangs behind
      cast_ult    Domefall wind: crouch, arms swung back, explosive launch at the impact frame (the release);
                  if no leap follows it slams and kneels
      domefall_leap  the leap itself, made to play over the ult dash's progress: launch -> airborne apex
                  (hips +0.5 m, knees tucked, maul raised high outside the right rim) -> two-footed slam with
                  the maul head driven into the ground in front -> slam hold
      idle        breathing (chest 2-3 cm), a slow weight shift, the maul bobbing at the knee
      recall      6 s: plants the maul and leans on it, lifts the front-left of the dome off his brow,
                  rubs the rim, sets it back with a settle and two knocks, taps the maul head into his palm,
                  looks about, back to the lean (closes on its first pose)
      channel     stirs the pail with the left hand, the maul planted
      idle_lobby  taps the maul head into his palm twice, runs a hand along the rim, peers into the pail
      victory     sets the maul head down, hands stacked, a nod, two knocks on the rim, chin up"""
    prof = MOTION
    skel = anim.Skeleton(ctx.info.armature)
    g = anim.guard(prof)
    gf = g["ik"]
    F, H, A = anim.FootTarget, anim.HandTarget, anim.Aim
    hip_h = skel.rest_point("hips").z

    def feet(dl=(0, 0, 0), dr=(0, 0, 0), pl=0.0, pr=0.0, yl=None, yr=None, kl=0.0, kr=0.0):
        fl, fr = gf["foot.L"], gf["foot.R"]
        return {"foot.L": F(tuple(fl.ankle[i] + dl[i] for i in range(3)), pl, fl.yaw if yl is None else yl, 0.0, kl),
                "foot.R": F(tuple(fr.ankle[i] + dr[i] for i in range(3)), pr, fr.yaw if yr is None else yr, 0.0, kr)}

    def pose(torso=None, hips=(0, 0, 0), R=None, Rp=(-0.8, 0.4, -0.3), aim=None, L=None, Lp=None, Lprop=None,
             ft=None, cap_tip=None, extra=None):
        p = anim.add(g, anim.P(**(torso or {})))
        ik = dict(g["ik"])
        if R is not None:
            ik["hand.R"] = H(rel=R, pole=Rp)
        if aim is not None:
            ik["aim.R"] = A(aim)
        if Lprop is not None:
            ik["hand.L"] = H(to_prop=("prop.R", Lprop), pole=(0.8, 0.4, -0.4))
        elif L is not None:
            ik["hand.L"] = H(rel=L, pole=Lp)
        if ft:
            ik.update(ft)
        p["ik"] = ik
        hx, hy, hz = g.get("hips_loc", (0, 0, 0))
        p["hips_loc"] = (hx + hips[0], hy + hips[1], hz + hips[2])
        if cap_tip is not None:
            p["x_cap_tip"] = cap_tip
        if extra:
            p.update(anim.P(**extra))
        return p

    def strike(name, frames, wind, hit, fol, lags=None):
        return anim.Clip(name, frames, False, anim.drag(anim.keyed(anim.strike_keys(prof, wind, hit, fol, g)), frames,
                                                        lags or {"head": 1.5, "neck": 1.0}), impact=anim.IMPACT)

    out = {}
    # attack1 — overhead chop: wound up high outside the right rim, lands ~1.3 m out
    out["attack1"] = strike(
        "attack1", 40,
        pose(dict(hips=(-4, -14, 0), spine=(-6, -8, 4), chest=(-8, -12, 6), head=(4, 10, 0)), (0.0, 0.05, 0.0),
             R=(-0.42, 0.10, 0.80), Rp=(-0.9, 0.3, 0.3), aim=(-0.40, 0.50, 0.77), L=(0.10, -0.70, -0.45)),
        pose(dict(hips=(10, 12, 0), spine=(10, 6, -2), chest=(12, 8, -3), head=(-12, -6, 0)), (0.0, -0.16, -0.06),
             R=(0.12, -0.95, 0.20), Rp=(-0.8, 0.2, -0.5), aim=(0.05, -0.80, -0.60), L=(0.15, 0.15, -0.90),
             ft=feet(dl=(0.0, -0.28, 0.0), pl=4)),
        pose(dict(hips=(12, 14, 0), spine=(11, 7, -2), chest=(13, 9, -3), head=(-13, -7, 0)), (0.0, -0.18, -0.07),
             R=(0.16, -0.94, 0.12), Rp=(-0.8, 0.2, -0.5), aim=(0.08, -0.72, -0.69), L=(0.18, 0.20, -0.88),
             ft=feet(dl=(0.0, -0.28, 0.0), pl=2)))
    # attack2 — flat sweep at knee height, right to left
    out["attack2"] = strike(
        "attack2", 40,
        pose(dict(hips=(4, -24, 0), spine=(4, -14, 0), chest=(6, -18, 0), head=(0, 18, 0)), (0.0, 0.03, -0.04),
             R=(-0.55, 0.20, -0.62), Rp=(-0.3, 0.8, -0.3), aim=(-0.72, 0.52, -0.46), L=(0.15, -0.60, -0.55)),
        pose(dict(hips=(10, 20, 0), spine=(8, 12, 0), chest=(10, 16, 0), head=(-8, -16, 0)), (0.0, -0.10, -0.09),
             R=(0.12, -0.94, -0.26), Rp=(-0.8, 0.3, -0.4), aim=(0.40, -0.82, -0.40), L=(0.30, 0.25, -0.80),
             ft=feet(dr=(0.0, -0.10, 0.0), dl=(0.04, -0.12, 0.0))),
        pose(dict(hips=(10, 30, 0), spine=(8, 18, 0), chest=(10, 22, 0), head=(-8, -22, 0)), (0.0, -0.10, -0.09),
             R=(0.42, -0.74, -0.36), Rp=(-0.6, 0.4, -0.6), aim=(0.86, -0.34, -0.36), L=(0.32, 0.30, -0.78),
             ft=feet(dr=(0.0, -0.10, 0.0), dl=(0.04, -0.12, 0.0))))
    # cast_a1 — Shoulder In (25 f, impact f10): the left shoulder and the rim hit the line, maul tucked back
    tuck = dict(R=(-0.30, 0.38, -0.84), Rp=(-0.7, 0.6, -0.2), aim=(-0.12, 0.62, -0.78))
    out["cast_a1"] = strike(
        "cast_a1", 25,
        pose(dict(hips=(-3, -12, 0), spine=(-3, -8, 0), chest=(-4, -10, 0), head=(4, 8, 0)), (0.0, 0.05, -0.02),
             L=(0.10, -0.30, -0.80), **tuck),
        pose(dict(hips=(20, 20, -6), spine=(10, 10, -8), chest=(12, 14, -10), head=(-6, -10, 0)), (0.0, -0.20, -0.10),
             L=(0.28, -0.55, -0.50), Lp=(0.6, 0.6, -0.4), ft=feet(dl=(0.0, -0.26, 0.0), dr=(0.0, -0.06, 0.0), pl=4, pr=-12),
             **tuck),
        pose(dict(hips=(22, 22, -6), spine=(11, 11, -8), chest=(13, 15, -10), head=(-7, -11, 0)), (0.0, -0.24, -0.11),
             L=(0.30, -0.58, -0.48), Lp=(0.6, 0.6, -0.4), ft=feet(dl=(0.0, -0.26, 0.0), dr=(0.0, -0.14, 0.0), pl=2, pr=-20),
             **tuck))
    a1_follow = lambda t: 0.40 * anim.sine(min(1.0, max(0.0, (t - 0.20) / 0.18))) * (1.0 - anim.sine(min(1.0, max(0.0, (t - 0.62) / 0.30))))  # noqa: E731
    # cast_a2 — Shelter Dome (40 f, impact f16): level across the face, then planted head-down, hands stacked
    across = pose(dict(hips=(-4, 0, 0), spine=(-6, 4, 0), chest=(-8, 6, 0), head=(4, -4, 0)), (0.0, 0.02, 0.02),
                  R=(0.52, -0.66, 0.36), Rp=(-0.6, -0.2, -0.8), aim=(0.97, -0.20, 0.10), Lprop=0.40,
                  cap_tip=(-8.0, 0.0, 0.0))
    plant = pose(dict(hips=(10, 0, 0), spine=(6, 4, 0), chest=(8, 6, 0), head=(-10, -4, 0)), (0.0, -0.06, -0.08),
                 R=(0.50, -0.86, 0.10), Rp=(-0.8, 0.3, -0.4), aim=(0.0, -0.10, -0.99), Lprop=-0.16,
                 ft=feet(dl=(0.08, -0.06, 0.0), dr=(-0.08, 0.02, 0.0)))
    plant2 = anim.add(plant, anim.P(chest=(1.5, 0, 0)))
    plant2["hips_loc"] = tuple(plant["hips_loc"][i] + (0, 0, -0.012)[i] for i in range(3))
    out["cast_a2"] = anim.Clip("cast_a2", 40, False, anim.drag(anim.keyed([
        (0.0, g, "linear"), (0.06, anim.lerp_pose(g, across, -0.08), "inout"), (0.20, across, "out"),
        (0.28, anim.lerp_pose(g, across, 1.05), "out"), (0.40, plant2, "accel"), (0.46, plant, "out"),
        (0.75, plant, "linear"), (0.88, anim.lerp_pose(plant, g, 0.6), "inout"), (1.0, g, "settle")]),
        40, {"head": 1.5, "neck": 1.0}), impact=anim.IMPACT)
    # cast_a3 — Mortar Pail (30 f, impact f12)
    hang = dict(R=(-0.16, 0.28, -0.92), Rp=(-0.7, 0.6, -0.2), aim=(-0.10, 0.58, -0.81))
    out["cast_a3"] = strike(
        "cast_a3", 30,
        pose(dict(hips=(12, 12, 0), spine=(10, 8, 0), chest=(12, 10, 0), head=(6, -6, 0)), (0.0, 0.04, -0.09),
             L=(-0.22, -0.70, -0.62), Lp=(0.8, 0.5, -0.2), ft=feet(dr=(0.0, 0.06, 0.0)), **hang),
        pose(dict(hips=(-2, -16, 0), spine=(-4, -10, 0), chest=(-6, -14, 0), head=(-4, 12, 0)), (0.0, -0.12, -0.04),
             L=(-0.05, -0.90, 0.38), Lp=(0.8, 0.2, -0.5), ft=feet(dl=(0.0, -0.26, 0.0), dr=(0.0, 0.06, 0.0), pl=6),
             **hang),
        pose(dict(hips=(-3, -18, 0), spine=(-5, -11, 0), chest=(-7, -15, 0), head=(-5, 13, 0)), (0.0, -0.14, -0.04),
             L=(-0.08, -0.76, 0.60), Lp=(0.8, 0.2, -0.5), ft=feet(dl=(0.0, -0.26, 0.0), dr=(0.0, 0.06, 0.0), pl=4),
             **hang),
        {"head": 1.5, "neck": 1.0})
    # cast_ult — Domefall wind-up (45 f, impact f18 = the launch)
    crouch = pose(dict(hips=(20, 0, 0), spine=(14, 0, 0), chest=(12, 0, 0), head=(-10, 0, 0)), (0.0, 0.06, -0.24),
                  R=(-0.32, 0.42, -0.80), Rp=(-0.6, 0.7, -0.1), aim=(-0.22, 0.70, -0.68), L=(0.28, 0.40, -0.80),
                  ft=feet(dl=(0.02, 0.0, 0.0), dr=(-0.02, 0.0, 0.0)))
    launch = pose(dict(hips=(-4, 0, 0), spine=(-6, 0, 0), chest=(-8, 0, 0), head=(-6, 0, 0)), (0.0, -0.04, 0.12),
                  R=(-0.46, -0.30, 0.78), Rp=(-0.9, 0.0, 0.3), aim=(-0.42, -0.08, 0.90), L=(0.55, -0.30, 0.60),
                  Lp=(0.9, 0.0, 0.3), ft=feet(dl=(0.0, 0.0, 0.07), dr=(0.0, 0.0, 0.07), pl=-34, pr=-34))
    slam = pose(dict(hips=(16, 0, 0), spine=(10, 0, 0), chest=(10, 0, 0), head=(-12, 0, 0)), (0.0, -0.10, -0.28),
                R=(0.06, -0.97, 0.15), Rp=(-0.8, 0.2, -0.5), aim=(0.05, -0.60, -0.80), L=(0.30, -0.55, -0.60),
                ft=feet(dl=(0.05, -0.16, 0.0), dr=(-0.05, 0.10, 0.0), pr=-30))
    out["cast_ult"] = anim.Clip("cast_ult", 45, False, anim.drag(anim.keyed([
        (0.0, g, "linear"), (0.08, anim.lerp_pose(g, crouch, -0.10), "inout"), (0.30, crouch, "inout"),
        (0.36, anim.lerp_pose(g, crouch, 1.06), "out"), (0.40, launch, snap_in), (0.48, launch, "out"),
        (0.56, slam, "in"), (0.67, slam, "linear"), (0.86, anim.lerp_pose(slam, g, 0.7), "inout"),
        (1.0, g, "settle")]), 45, {"head": 1.5, "neck": 1.0}), impact=anim.IMPACT)
    # domefall_leap — plays over the ult dash (progress-mapped): launch -> apex -> slam -> hold
    apex = pose(dict(hips=(-6, 0, 0), spine=(-8, 0, 0), chest=(-10, 0, 0), head=(-4, 0, 0)), (0.0, 0.0, 0.50),
                R=(-0.40, -0.12, 0.86), Rp=(-0.9, 0.0, 0.3), aim=(-0.36, 0.18, 0.92), L=(0.62, -0.20, 0.50),
                Lp=(0.9, 0.0, 0.3), ft=feet(dl=(0.02, 0.06, 0.36), dr=(-0.02, 0.10, 0.32), pl=-24, pr=-28))
    apex2 = anim.add(apex, anim.P(chest=(-3, 0, 0), spine=(-2, 0, 0)))
    apex2["hips_loc"] = tuple(apex["hips_loc"][i] + (0, 0, -0.04)[i] for i in range(3))
    slam_hold = anim.add(slam, anim.P(chest=(2, 0, 0)))
    slam_hold["hips_loc"] = tuple(slam["hips_loc"][i] + (0, 0, -0.015)[i] for i in range(3))
    out["domefall_leap"] = anim.Clip("domefall_leap", 20, False, anim.drag(anim.keyed([
        (0.0, launch, "linear"), (0.40, apex, "out"), (0.55, apex2, "linear"), (0.82, slam, "in"),
        (1.0, slam_hold, "out")]), 20, {"head": 1.0}), meta={"role": "dash", "apex_t": 0.40, "slam_t": 0.82})

    # idle — breathing, weight shift, maul bob at the knee (72 f loop)
    def idle(t):
        b = anim.osc(t, 2)
        s = anim.osc(t, 1, 0.1)
        p = anim.add(g, anim.P(chest=(2.6 * b, 0, 0), spine=(0.8 * b, 0, 0.8 * s), neck=(-1.2 * b, 0, 0),
                               head=(-1.0 * b, 3.0 * s, 0), hips=(0, 1.5 * s, -1.2 * s),
                               shoulder_L=(0, 0, 1.8 * b), shoulder_R=(0, 0, -1.8 * b)))
        ik = dict(p["ik"])
        hR = ik["hand.R"]
        ik["hand.R"] = H(rel=(hR.rel[0], hR.rel[1] - 0.03 * anim.osc(t, 2, 0.1), hR.rel[2] + 0.02 * anim.osc(t, 2, 0.15)), pole=hR.pole)
        ik["aim.R"] = A((-0.08, -0.88 + 0.05 * anim.osc(t, 2, 0.2), -0.47))
        p["ik"] = ik
        hx, hy, hz = p["hips_loc"]
        p["hips_loc"] = (hx + 0.022 * s, hy, hz - 0.010 * (0.5 + 0.5 * b))
        return p
    out["idle"] = anim.Clip("idle", 72, True, idle)

    # the planted lean shared by recall and channel: maul head on the ground right-front, leaning on the haft
    lean = pose(dict(hips=(4, -6, 0), spine=(4, -4, 2), chest=(5, -6, 2), head=(-3, 6, 0)), (0.02, 0.0, -0.02),
                R=(-0.12, -0.56, -0.80), Rp=(-0.8, 0.4, -0.3), aim=(-0.10, -0.85, -0.52), L=(0.04, -0.42, -0.88))

    def at(key_list):
        return anim.keyed(key_list)

    # recall — 6 s (180 f, the load test caps a clip at 6 s; over RIFT's 7 s the loop replays its opening lean and
    # breath, seamless: it closes on its first pose)
    rim_L = (0.30, -0.06, 0.96)
    lift = pose(dict(hips=(2, 4, 0), spine=(0, 4, -2), chest=(-2, 6, -3), neck=(6, 0, 0), head=(14, -6, 0)),
                (0.0, 0.0, 0.0), R=(-0.12, -0.56, -0.80), aim=(-0.10, -0.85, -0.52), L=rim_L, Lp=(0.9, 0.2, 0.0),
                cap_tip=(-11.0, 0.0, 9.0))
    rub_a = anim.merge(lift, {"ik": {"hand.L": H(rel=(0.34, -0.20, 0.92), pole=(0.9, 0.2, 0.0))}})
    rub_b = anim.merge(lift, {"ik": {"hand.L": H(rel=(0.26, 0.10, 0.95), pole=(0.9, 0.2, 0.0))}})
    seated = pose(dict(hips=(4, -2, 0), spine=(3, 0, 0), chest=(2, 2, 0), head=(-4, 0, 0)), (0.0, 0.0, -0.03),
                  R=(-0.12, -0.56, -0.80), aim=(-0.10, -0.85, -0.52), L=(0.30, -0.04, 0.92), Lp=(0.9, 0.2, 0.0),
                  cap_tip=(1.5, 0.0, -1.0))
    seated0 = anim.merge(seated, {"x_cap_tip": (0.0, 0.0, 0.0)})
    knock_out = anim.merge(seated0, {"ik": {"hand.L": H(rel=(0.42, -0.10, 0.80), pole=(0.9, 0.2, 0.0))}})
    knock_in = anim.merge(seated0, {"ik": {"hand.L": H(rel=(0.31, -0.06, 0.95), pole=(0.9, 0.2, 0.0))}},
                          {"x_cap_tip": (0.6, 0.0, -0.8)})
    palm_up = pose(dict(hips=(4, 8, 0), spine=(4, 6, 0), chest=(6, 8, 0), head=(8, 8, 0)), (0.0, -0.02, -0.03),
                   R=(0.22, -0.78, -0.48), Rp=(-0.8, 0.3, -0.5), aim=(0.62, -0.62, 0.24), Lprop=0.60)
    palm_tap = anim.add(palm_up, anim.P(chest=(2, 0, 0)))
    palm_tap["ik"] = dict(palm_up["ik"])
    palm_tap["ik"]["hand.R"] = H(rel=(0.22, -0.78, -0.58), pole=(-0.8, 0.3, -0.5))
    look_l = anim.add(lean, anim.P(chest=(0, 6, 0), neck=(0, 10, 0), head=(-4, 18, 0), hips=(0, 4, 0)))
    look_r = anim.add(lean, anim.P(chest=(0, -6, 0), neck=(0, -10, 0), head=(-4, -18, 0), hips=(0, -4, 0)))
    breathe_in = anim.add(lean, anim.P(chest=(-3, 0, 0), spine=(-1.5, 0, 0), head=(-4, 0, 0)))
    breathe_in["hips_loc"] = tuple(lean["hips_loc"][i] + (0, 0, 0.012)[i] for i in range(3))
    rec = at([
        (0.00, lean, "linear"), (0.06, breathe_in, "inout"), (0.11, lean, "inout"),
        (0.18, lift, "inout"), (0.24, rub_a, "inout"), (0.29, rub_b, "inout"), (0.34, rub_a, "inout"),
        (0.39, rub_b, "inout"), (0.44, lift, "inout"),
        (0.50, seated, "in"), (0.53, seated0, "settle"),
        (0.56, knock_out, "out"), (0.58, knock_in, "in"), (0.61, knock_out, "out"), (0.63, knock_in, "in"),
        (0.66, seated0, "inout"),
        (0.71, palm_up, "inout"), (0.735, palm_tap, "in"), (0.76, palm_up, "out"), (0.785, palm_tap, "in"),
        (0.81, palm_up, "out"),
        (0.86, look_l, "inout"), (0.91, look_r, "inout"), (0.95, breathe_in, "inout"), (1.0, lean, "inout")])
    out["recall"] = anim.Clip("recall", 180, True, anim.drag(rec, 180, {"head": 2.0, "neck": 1.0}, loop=True))

    # channel — stirring the pail (60 f loop)
    stir = pose(dict(hips=(8, 10, 0), spine=(8, 8, 0), chest=(10, 10, 0), neck=(6, 6, 0), head=(14, 12, 0)),
                (0.0, 0.0, -0.05), R=(-0.12, -0.56, -0.80), aim=(-0.10, -0.85, -0.52), L=(-0.24, -0.74, -0.64),
                Lp=(0.8, 0.5, -0.2))

    def channel(t):
        c, s = math.cos(2 * math.pi * t * 2), math.sin(2 * math.pi * t * 2)
        b = anim.osc(t, 1, 0.2)
        p = anim.add(stir, anim.P(chest=(3.0 * c, 4.0 * s, 1.5 * b), spine=(1.5 * c, 2.0 * s, 0), neck=(0, 3.0 * b, 0),
                                  head=(3.0 * s, 4.0 * c + 6.0 * b, 0), hips=(0, 2.5 * s, 0)))
        ik = dict(p["ik"])
        ik["hand.L"] = H(rel=(-0.24 + 0.18 * c, -0.70 + 0.18 * s, -0.60 + 0.04 * c), pole=(0.8, 0.5, -0.2))
        p["ik"] = ik
        hx, hy, hz = p["hips_loc"]
        p["hips_loc"] = (hx + 0.025 * s, hy - 0.015 * c, hz - 0.012 * (0.5 + 0.5 * c))
        return p
    out["channel"] = anim.Clip("channel", 48, True, channel)

    # idle_lobby — palm taps, a hand along the rim, a look into the pail (120 f loop)
    rest_l = pose(dict(hips=(2, -4, 0), spine=(2, -2, 0), chest=(3, -4, 0), head=(-2, 4, 0)), (0.0, 0.0, -0.02),
                  R=(-0.14, -0.50, -0.84), aim=(-0.10, -0.85, -0.52), L=(0.04, -0.42, -0.88))
    rim_a = anim.merge(rest_l, anim.add(rest_l, anim.P(head=(4, 10, 0), neck=(0, 6, 0))),
                       {"ik": {"hand.L": H(rel=(0.30, -0.24, 0.90), pole=(0.9, 0.2, 0.0))}})
    rim_b = anim.merge(rim_a, {"ik": {"hand.L": H(rel=(0.30, 0.16, 0.92), pole=(0.9, 0.2, 0.0))}})
    peer = pose(dict(hips=(8, 10, 0), spine=(8, 8, 0), chest=(10, 10, 0), neck=(8, 8, 0), head=(18, 14, 0)),
                (0.0, 0.0, -0.05), R=(-0.14, -0.50, -0.84), aim=(-0.10, -0.85, -0.52), L=(-0.10, -0.62, -0.74),
                Lp=(0.8, 0.5, -0.2))
    lob = at([
        (0.00, rest_l, "linear"), (0.10, palm_up, "inout"), (0.14, palm_tap, "in"), (0.18, palm_up, "out"),
        (0.22, palm_tap, "in"), (0.26, palm_up, "out"), (0.34, rest_l, "inout"),
        (0.42, rim_a, "inout"), (0.54, rim_b, "inout"), (0.60, rest_l, "inout"),
        (0.70, peer, "inout"), (0.80, anim.add(peer, anim.P(head=(4, -10, 0))), "inout"), (0.90, rest_l, "inout"),
        (1.0, rest_l, "linear")])
    out["idle_lobby"] = anim.Clip("idle_lobby", 120, True, anim.drag(lob, 120, {"head": 2.0, "neck": 1.0}, loop=True))

    # victory — maul head set down, hands stacked, a nod, two knocks on the rim, chin up (60 f, hold)
    stack = pose(dict(hips=(8, 0, 0), spine=(8, 2, 0), chest=(10, 4, 0), head=(-6, 0, 0)), (0.0, -0.04, -0.06),
                 R=(0.42, -0.86, 0.10), Rp=(-0.8, 0.3, -0.4), aim=(0.0, -0.12, -0.99), Lprop=-0.16,
                 ft=feet(dl=(0.0, -0.14, 0.0)))
    nod = anim.add(stack, anim.P(neck=(6, 0, 0), head=(14, 0, 0)))
    kn_o = anim.merge(stack, {"ik": {"hand.L": H(rel=(0.42, -0.10, 0.80), pole=(0.9, 0.2, 0.0))}})
    kn_i = anim.merge(stack, {"ik": {"hand.L": H(rel=(0.31, -0.06, 0.95), pole=(0.9, 0.2, 0.0))}},
                      {"x_cap_tip": (0.6, 0.0, -0.8)})
    proud = anim.add(stack, anim.P(chest=(-4, 0, 0), neck=(-4, 0, 0), head=(-8, 0, 0)))
    out["victory"] = anim.Clip("victory", 60, False, anim.drag(at([
        (0.0, g, "linear"), (0.18, stack, "inout"), (0.28, nod, "inout"), (0.36, stack, "inout"),
        (0.46, kn_o, "inout"), (0.52, kn_i, "in"), (0.57, kn_o, "out"), (0.62, kn_i, "in"), (0.68, kn_o, "out"),
        (0.78, proud, "inout"), (1.0, proud, "linear")]), 60, {"head": 2.0, "neck": 1.0}))

    # level-lock everything (generic run / death / stunned / dash too)
    clips = anim.standard_clips(skel, prof, out)
    follows = {"cast_a1": a1_follow,
               "stunned": lambda t: 0.20,
               "death": lambda t: anim.sine(min(1.0, max(0.0, (t - 0.10) / 0.35)))}
    return {k: _levelled(skel, c, follows.get(k)) for k, c in clips.items()}


def snap_in(t):
    return t ** 1.6


if __name__ == "__main__":
    fighter.main(sys.modules[__name__])
