"""ART 2.0 proof on Marund: sculpted volumes (numpy SDF) fitted to the concept sheet, painted by
PROJECTING the concept's own front and back paintings onto the forms, then rendered next to the
concept for the owner's side-by-side.

    Blender -b --factory-startup --python art/blender/proto/marund_v2.py -- [--voxel 0.008] [--samples 256]

Needs the projection plates first: python3 art/tools/concept_plates.py marund --height 2.35
Writes art/renders/_art2/marund_side_by_side.png (+ each view) and art/.cache/_art2/marund_v2.blend.

Conventions: Z up, metres, the model faces -Y, soles at z = 0. Marund's right hand (the maul) is at -X.
Measurements come from the concept on a 10 cm grid (crown 2.35 m): cap rim radius 0.64 at z 1.88-1.98,
iron band z 2.0, dome to a flat crown at 2.33; mask z 1.55-1.88; sleeves to x 0.73; fists at x 0.62,
z 0.76; apron z 0.43-1.40; legs at x 0.32; boots to x 0.50.
"""
from __future__ import annotations

import json
import math
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from common import scene  # noqa: E402
from common.hifi import sdf  # noqa: E402
from common.hifi.sdf import (Capsule, Ellipsoid, FlatCapsule, HalfSpace, Lathe, RoundBox, RoundCone,  # noqa: E402
                             Sculpt, Sphere, Torus, Tube)

ID = "marund"
HEIGHT = 2.35
CACHE = os.path.join(scene.CACHE_DIR, "concept")
OUT = os.path.join(scene.RENDERS_DIR, "_art2")
NOISE = sdf.Noise(7)


def args():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--voxel", type=float, default=0.008)
    p.add_argument("--samples", type=int, default=192)
    p.add_argument("--res", type=int, default=1100, help="render height px per view")
    p.add_argument("--views", default="front,back,threeq,game")
    p.add_argument("--atlas", type=int, default=2048)
    return p.parse_args(scene.script_args())


# ── shaping helpers ───────────────────────────────────────────────────────────────────────────────
def ell_axes(sx=1.0, sy=1.0, sz=1.0):
    """Frame rows scaled: local = world * s (approximate distance; fine for sculpting)."""
    return np.diag([1.0 / sx, 1.0 / sy, 1.0 / sz])


def folds(amp, freq, axis=0, phase=0.0, zfade=None):
    """Cloth folds: vertical-ish ridges across `axis`, warped by noise, optionally deepening downward."""
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


# ── the sculpt, one object per part (materials differ; smooth blends only inside a part) ────────────
def build_parts():
    parts = {}

    # CAP: stone shell (rim + dome) with a flat cut crown, chipped rim edge
    def cap_prof(r, z):
        # rim: a thick flared annulus 0.40..0.64, top sloping 2.00 -> 1.965, underside 1.885 -> 1.90
        t = np.clip((r - 0.40) / 0.24, 0, 1)
        rim_top = 2.005 - 0.04 * t * t
        rim_bot = 1.905 - 0.02 * t
        d_rim = np.maximum(np.maximum(z - rim_top, rim_bot - z), r - 0.64)
        # dome: ellipse r^2/0.55^2 + (z-2.0)^2/0.34^2 <= 1, cut flat at the crown
        q = np.sqrt((r / 0.55) ** 2 + ((z - 2.0) / 0.345) ** 2)
        d_dome = (q - 1.0) * 0.30
        d_dome = np.maximum(d_dome, z - 2.315)              # the flat cut crown (CROWN_Z in marund_cap_top.py)
        d_dome = np.maximum(d_dome, 1.95 - z)
        return np.minimum(d_rim, d_dome)
    cap = Sculpt("cap")
    shell = Lathe((0, 0, 0), cap_prof, 0.66, 1.86, 2.34)
    cap.add(shell.displaced(chips(0.012, 9.0), 0.012), k=0.0)
    # banding grooves on the dome (the iron band sits in the lowest)
    for zc in (2.115, 2.215):
        cap.sub(Torus((0, 0, zc), 0.55 * math.sqrt(max(0.0, 1 - ((zc - 2.0) / 0.345) ** 2)) + 0.004, 0.009), k=0.004)
    # window recesses (front, and at +-55 degrees)
    win = []
    for ang in (0.0, 55.0, -55.0):
        a = math.radians(ang)
        z = 2.19
        rr = 0.55 * math.sqrt(1 - ((z - 2.0) / 0.345) ** 2)
        c = np.array([-math.sin(a) * rr, -math.cos(a) * rr, z])
        n = c * np.array([1, 1, 0]) / rr
        n = n + np.array([0, 0, 0.45]) * 1.0
        n /= np.linalg.norm(n)
        win.append((c, n))
        cap.sub(Capsule(c - n * 0.05, c + n * 0.05, 0.062), k=0.006)
    parts["cap"] = cap

    band = Sculpt("cap_band")
    band.add(Torus((0, 0, 2.02), 0.553, 0.026, rz=0.028), k=0.0)
    for i in range(24):
        a = 2 * math.pi * i / 24
        band.add(Sphere((math.cos(a) * 0.578, math.sin(a) * 0.578, 2.022), 0.011), k=0.004)
    parts["cap_band"] = band

    frames = Sculpt("windows_frame")
    glass = Sculpt("windows_glass")
    for c, n in win:
        frames.add(Torus(c - n * 0.004, 0.058, 0.016, axes=sdf.frame(n), rz=0.014), k=0.0)
        glass.add(Capsule(c - n * 0.02, c - n * 0.012, 0.050), k=0.0)
    parts["windows_frame"] = frames
    parts["windows_glass"] = glass

    # HEAD under the cap: a broad carved wooden block (sides, back collar, jaw) wearing the pale mask.
    # The concept's mask is wide (white face +-0.30 m, wooden side plates to +-0.36 m, z 1.53-1.88)
    head = Sculpt("head")
    head.add(RoundBox((0, 0.06, 1.71), (0.32, 0.25, 0.17), 0.08), k=0.0)
    head.add(RoundBox((0, 0.08, 1.60), (0.34, 0.26, 0.07), 0.04), k=0.03)        # back/side collar slab
    head.add(RoundBox((0, -0.17, 1.585), (0.19, 0.08, 0.055), 0.025), k=0.015)   # wooden jaw block
    for sx in (-1, 1):
        head.add(RoundBox((sx * 0.325, -0.07, 1.70), (0.045, 0.13, 0.15), 0.02), k=0.01)   # side plates
    parts["head"] = head

    mask = Sculpt("mask")
    face = Ellipsoid((0, -0.02, 1.735), (0.305, 0.25, 0.165))
    mask.add(face.displaced(lambda P: -0.004 * NOISE(P, 18.0), 0.004), k=0.0)
    mask.inter(HalfSpace((0, -0.10, 1.7), (0, 1, 0), 1.0), k=0.01)              # the front shell only
    mask.inter(HalfSpace((0, 0, 1.62), (0, 0, -1), 1.0), k=0.006)
    mask.add(RoundBox((0, -0.245, 1.84), (0.26, 0.035, 0.024), 0.014), k=0.014)  # brow shelf
    mask.add(RoundCone((0, -0.255, 1.80), (0, -0.33, 1.635), 0.06, 0.018), k=0.03)   # beak keel
    for sx in (-1, 1):
        mask.sub(Ellipsoid((sx * 0.135, -0.25, 1.785), (0.085, 0.06, 0.034), axes=sdf.rot_y(sx * -14)), k=0.01)
        mask.sub(RoundBox((sx * 0.20, -0.23, 1.69), (0.006, 0.04, 0.06), 0.003, axes=sdf.rot_y(sx * 18)), k=0.002)  # carved cheek line
    parts["mask"] = mask

    # TORSO: linen shirt over a hunched back (the back rises to ~1.7 m behind the head), puffed
    # sleeves to big wrapped forearms that hang close to the body
    torso = Sculpt("shirt")
    torso.add(Ellipsoid((0, 0.02, 1.25), (0.43, 0.30, 0.30)), k=0.0)
    torso.add(Ellipsoid((0, 0.08, 1.46), (0.37, 0.26, 0.24)), k=0.10)             # upper back / yoke
    torso.add(Ellipsoid((0, 0.00, 1.06), (0.39, 0.29, 0.14)), k=0.10)
    for sx in (-1, 1):
        torso.add(Ellipsoid((sx * 0.30, 0.05, 1.50), (0.20, 0.20, 0.12)), k=0.08)  # trapezius slope
        torso.add(Sphere((sx * 0.46, 0.03, 1.33), 0.17), k=0.08)
        torso.add(FlatCapsule((sx * 0.51, 0.03, 1.30), (sx * 0.565, 0.0, 1.06), 0.155, 0.15, 0.15, 0.145, side=(1, 0, 0)), k=0.06)
    parts["shirt"] = torso

    wraps = Sculpt("forearms")
    for sx in (-1, 1):
        fa = FlatCapsule((sx * 0.57, -0.02, 1.04), (sx * 0.55, -0.10, 0.88), 0.14, 0.13, 0.125, 0.12, side=(1, 0, 0))
        wraps.add(fa.displaced(lambda P: 0.006 * np.sin(P[:, 2] * 95.0 + 2.0 * P[:, 0]), 0.006), k=0.0)
    parts["forearms"] = wraps

    hands = Sculpt("hands")
    for sx in (-1, 1):
        c = np.array([sx * 0.545, -0.13, 0.795])
        hands.add(RoundBox(c, (0.105, 0.095, 0.095), 0.055), k=0.0)
        for i in range(4):                                     # knuckle rolls (front)
            hands.add(Capsule(c + (sx * -0.06, -0.085, 0.06 - i * 0.04), c + (sx * 0.06, -0.085, 0.06 - i * 0.04), 0.026), k=0.02)
        hands.add(Capsule(c + (sx * -0.09, -0.06, 0.07), c + (sx * -0.07, -0.08, -0.02), 0.033), k=0.02)   # thumb
    parts["hands"] = hands

    # APRON: felt bib over the chest, heavy skirt panel to the shins, folds deepening downward
    apron = Sculpt("apron")
    bib = RoundBox((0, -0.255, 1.18), (0.30, 0.05, 0.22), 0.03, axes=sdf.rot_x(-8))
    apron.add(bib, k=0.0)
    skirt = RoundBox((0, -0.31, 0.71), (0.355, 0.035, 0.29), 0.02, axes=sdf.rot_x(4))
    apron.add(skirt.displaced(folds(0.018, 16.0, axis=0, zfade=(0.95, 0.45)), 0.018), k=0.05)
    apron.add(RoundBox((-0.06, -0.30, 1.20), (0.26, 0.04, 0.16), 0.03, axes=sdf.rot_y(-28) @ sdf.rot_x(-8)), k=0.02)  # the wrap fold
    parts["apron"] = apron

    tunic = Sculpt("tunic")
    tun = FlatCapsule((0, 0.02, 0.42), (0, 0.01, 1.02), 0.47, 0.35, 0.41, 0.30, side=(1, 0, 0))
    tunic.add(tun.displaced(folds(0.014, 13.0, axis=0, phase=1.3, zfade=(1.0, 0.45)), 0.014), k=0.0)
    tunic.inter(HalfSpace((0, 0, 0.44), (0, 0, -1), 2.0), k=0.01)
    parts["tunic"] = tunic

    belt = Sculpt("belt")
    belt.add(Torus((0, 0.0, 1.0), 0.41, 0.045, axes=np.diag([1.0, 0.41 / 0.31, 1.0]), rz=0.035), k=0.0)
    belt.add(RoundBox((0.0, -0.33, 1.0), (0.05, 0.02, 0.035), 0.008), k=0.0)    # buckle slab
    for sx in (-1, 1):                                                           # apron straps
        belt.add(Tube([(sx * 0.17, -0.27, 1.38), (sx * 0.20, -0.22, 1.47), (sx * 0.24, -0.05, 1.53), (sx * 0.24, 0.20, 1.45)],
                      [0.022, 0.022, 0.022, 0.022], k=0.01), k=0.0)
    parts["belt"] = belt

    # LEGS: dark trousers, stone knee slabs, wrapped shins, big boots with toe caps
    legs = Sculpt("legs")
    for sx in (-1, 1):
        legs.add(FlatCapsule((sx * 0.22, 0.03, 0.62), (sx * 0.32, 0.0, 0.26), 0.16, 0.15, 0.14, 0.13, side=(1, 0, 0)), k=0.0)
        legs.add(FlatCapsule((sx * 0.32, 0.0, 0.30), (sx * 0.33, 0.0, 0.14), 0.135, 0.13, 0.13, 0.13, side=(1, 0, 0)), k=0.04)
    parts["legs"] = legs

    knees = Sculpt("knees")
    for sx in (-1, 1):
        slab = RoundBox((sx * 0.335, -0.10, 0.285), (0.13, 0.05, 0.105), 0.025, axes=sdf.rot_x(-6))
        knees.add(slab.displaced(chips(0.01, 7.0), 0.01), k=0.0)
    parts["knees"] = knees

    boots = Sculpt("boots")
    for sx in (-1, 1):
        boots.add(RoundBox((sx * 0.335, -0.05, 0.085), (0.165, 0.22, 0.085), 0.06), k=0.0)
        boots.add(FlatCapsule((sx * 0.335, 0.02, 0.10), (sx * 0.335, 0.02, 0.22), 0.15, 0.14, 0.145, 0.135, side=(1, 0, 0)), k=0.05)
        boots.add(Torus((sx * 0.335, 0.02, 0.20), 0.145, 0.018), k=0.01)          # boot cuff band
    boots.inter(HalfSpace((0, 0, 0.0), (0, 0, -1), 2.0), k=0.0)
    parts["boots"] = boots

    # PROPS: the maul (haft through the right fist into a stone head), a rod in the left fist, the pail
    maul = Sculpt("maul_wood")
    fist_r = np.array([-0.545, -0.13, 0.765])
    head_c = np.array([-0.285, -0.45, 0.79])
    d = head_c - fist_r
    d[2] = 0
    d /= np.linalg.norm(d)
    maul.add(Capsule(fist_r - d * 0.30, head_c, 0.036), k=0.0)
    fist_l = np.array([0.545, -0.13, 0.765])
    maul.add(Capsule(fist_l + np.array([0.27, 0.10, 0.0]), fist_l + np.array([-0.12, -0.20, 0.0]), 0.036), k=0.0)
    parts["maul_wood"] = maul

    mhead = Sculpt("maul_head")
    hb = RoundBox(head_c, (0.13, 0.11, 0.185), 0.025, axes=sdf.rot_z(-math.degrees(math.atan2(d[0], -d[1]))))
    mhead.add(hb.displaced(chips(0.014, 6.0), 0.014), k=0.0)
    parts["maul_head"] = mhead

    pail = Sculpt("pail")
    pc = np.array([0.31, -0.42, 0.72])

    def pail_prof(r, z):
        rr = 0.135 + 0.025 * (z / 0.28)
        outer = np.maximum(np.maximum(r - rr, -z), z - 0.28)
        inner = np.maximum(r - (rr - 0.02), 0.03 - z)
        return np.maximum(outer, -inner)
    pail.add(Lathe(pc, pail_prof, 0.17, 0.0, 0.29), k=0.0)
    parts["pail"] = pail
    pail_bands = Sculpt("pail_bands")
    for zz in (0.08, 0.20):
        pail_bands.add(Torus(pc + (0, 0, zz), 0.135 + 0.025 * (zz / 0.28) + 0.004, 0.012, rz=0.022), k=0.0)
    parts["pail_bands"] = pail_bands
    return parts


# ── projection material ───────────────────────────────────────────────────────────────────────────
def projection_material(meta, name="concept_projection", emit=0.55, top=None):
    """Albedo = the concept painting projected orthographically along Y: the front plate on surfaces
    facing -Y, the back plate (mirrored) on surfaces facing +Y, blended across the sides; top-facing
    surfaces take a softened sample so crowns do not streak. Shading = a light diffuse response under
    the scene light plus a share of the painted value as emission (the painting already carries the
    hand-painted light)."""
    W, H = meta["size"]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    N.clear()
    out = N.new("ShaderNodeOutputMaterial")
    tc = N.new("ShaderNodeTexCoord")
    sep = N.new("ShaderNodeSeparateXYZ")
    L.new(tc.outputs["Object"], sep.inputs[0])
    geo = N.new("ShaderNodeNewGeometry")
    nsep = N.new("ShaderNodeSeparateXYZ")
    L.new(geo.outputs["Normal"], nsep.inputs[0])

    def plate(side, sign):
        info = meta[side]
        s = HEIGHT / (info["ground"] - info["top"])          # m per px for this figure
        img = bpy.data.images.load(os.path.join(CACHE, f"{ID}_{side}.png"), check_existing=True)
        img.colorspace_settings.name = "sRGB"
        # u = (cx + sign * x / s) / W ; v = (H - ground + z / s) / H
        mx = N.new("ShaderNodeMath"); mx.operation = "MULTIPLY_ADD"
        L.new(sep.outputs["X"], mx.inputs[0]); mx.inputs[1].default_value = sign / (s * W); mx.inputs[2].default_value = info["cx"] / W
        mz = N.new("ShaderNodeMath"); mz.operation = "MULTIPLY_ADD"
        L.new(sep.outputs["Z"], mz.inputs[0]); mz.inputs[1].default_value = 1.0 / (s * H); mz.inputs[2].default_value = (H - info["ground"]) / H
        comb = N.new("ShaderNodeCombineXYZ")
        L.new(mx.outputs[0], comb.inputs["X"]); L.new(mz.outputs[0], comb.inputs["Y"])
        tex = N.new("ShaderNodeTexImage"); tex.image = img; tex.extension = "EXTEND"; tex.interpolation = "Cubic"
        L.new(comb.outputs[0], tex.inputs["Vector"])
        return tex

    front = plate("front", 1.0)
    back = plate("back", -1.0)
    # blend factor: 0 = front, 1 = back, by the normal's Y (smooth across the sides)
    f = N.new("ShaderNodeMapRange")
    L.new(nsep.outputs["Y"], f.inputs["Value"])
    f.inputs["From Min"].default_value = -0.25
    f.inputs["From Max"].default_value = 0.25
    f.interpolation_type = "SMOOTHSTEP"
    mix = N.new("ShaderNodeMix"); mix.data_type = "RGBA"
    L.new(f.outputs[0], mix.inputs["Factor"])
    L.new(front.outputs["Color"], mix.inputs["A"])
    L.new(back.outputs["Color"], mix.inputs["B"])
    col = mix.outputs["Result"]
    if top:
        # top plate (X, Y in [-ext, ext] -> uv) on surfaces whose normal points up
        img, ext = top
        ux = N.new("ShaderNodeMath"); ux.operation = "MULTIPLY_ADD"
        L.new(sep.outputs["X"], ux.inputs[0]); ux.inputs[1].default_value = 0.5 / ext; ux.inputs[2].default_value = 0.5
        uy = N.new("ShaderNodeMath"); uy.operation = "MULTIPLY_ADD"
        L.new(sep.outputs["Y"], uy.inputs[0]); uy.inputs[1].default_value = 0.5 / ext; uy.inputs[2].default_value = 0.5
        tc2 = N.new("ShaderNodeCombineXYZ")
        L.new(ux.outputs[0], tc2.inputs["X"]); L.new(uy.outputs[0], tc2.inputs["Y"])
        tt = N.new("ShaderNodeTexImage"); tt.image = bpy.data.images.load(img, check_existing=True); tt.extension = "EXTEND"
        L.new(tc2.outputs[0], tt.inputs["Vector"])
        ft = N.new("ShaderNodeMapRange"); ft.interpolation_type = "SMOOTHSTEP"
        L.new(nsep.outputs["Z"], ft.inputs["Value"])
        ft.inputs["From Min"].default_value = 0.55
        ft.inputs["From Max"].default_value = 0.85
        mt = N.new("ShaderNodeMix"); mt.data_type = "RGBA"
        L.new(ft.outputs[0], mt.inputs["Factor"])
        L.new(col, mt.inputs["A"]); L.new(tt.outputs["Color"], mt.inputs["B"])
        col = mt.outputs["Result"]

    bsdf = N.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = 0.8
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.25
    L.new(col, bsdf.inputs["Base Color"])
    if "Emission Color" in bsdf.inputs:
        L.new(col, bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = emit
    L.new(bsdf.outputs[0], out.inputs["Surface"])
    return m


def flat_material(name, hexcol, emit=0.0, rough=0.6):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = scene.hex_rgba(hexcol)
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = scene.hex_rgba(hexcol)
        b.inputs["Emission Strength"].default_value = emit
    return m


# ── render ───────────────────────────────────────────────────────────────────────────────────────
def setup_render(a):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    scene.cycles_device(sc)
    sc.cycles.samples = a.samples
    sc.cycles.use_denoising = True
    sc.render.film_transparent = True
    sc.view_settings.view_transform = "AgX" if "AgX" in [v.identifier for v in sc.view_settings.bl_rna.properties["view_transform"].enum_items] else "Standard"
    try:
        sc.view_settings.view_transform = "Standard"
    except Exception:
        pass
    w = sc.world or bpy.data.worlds.new("w")
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.55, 0.55, 0.58, 1)
    bg.inputs["Strength"].default_value = 0.6
    key = bpy.data.lights.new("key", "SUN")
    key.energy = 2.2
    key.angle = math.radians(8)
    ko = bpy.data.objects.new("key", key)
    sc.collection.objects.link(ko)
    ko.rotation_euler = (math.radians(50), 0, math.radians(-35))   # from upper-left-front
    rim = bpy.data.lights.new("rim", "SUN")
    rim.energy = 1.2
    ro = bpy.data.objects.new("rim", rim)
    sc.collection.objects.link(ro)
    ro.rotation_euler = (math.radians(70), 0, math.radians(160))
    return sc


def camera(sc, kind):
    cam = bpy.data.cameras.new(kind)
    co = bpy.data.objects.new(kind, cam)
    sc.collection.objects.link(co)
    target = np.array([0.0, 0.0, 1.17])
    if kind in ("front", "back"):
        cam.type = "ORTHO"
        cam.ortho_scale = 2.6
        y = -6.0 if kind == "front" else 6.0
        co.location = (0, y, 1.17)
        co.rotation_euler = (math.radians(90), 0, 0 if kind == "front" else math.radians(180))
    elif kind == "threeq":
        cam.lens = 70
        p = np.array([-3.6, -6.2, 2.4])
        co.location = p
        look(co, p, target)
    else:  # game camera: pitch 52 deg, from the front-ish
        cam.lens = 60
        p = np.array([0.0, -7.5, 1.17 + 7.5 * math.tan(math.radians(52))])
        co.location = p
        look(co, p, target)
    return co


def look(obj, p, t):
    from mathutils import Vector
    d = Vector(tuple(t)) - Vector(tuple(p))
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


# triangle budgets per part for the game mesh (total ~23k; CONTRACT GLB budget 10-25k)
TRIS = {"cap": 4200, "cap_band": 1100, "windows_frame": 600, "windows_glass": 240, "head": 1200, "mask": 1700,
        "shirt": 3000, "forearms": 800, "hands": 1200, "apron": 2000, "tunic": 2000, "belt": 900, "legs": 900,
        "knees": 500, "boots": 1200, "maul_wood": 300, "maul_head": 400, "pail": 700, "pail_bands": 300}


def make_low(high, name, idx, col):
    """Decimated game copy of one sculpted part, tagged with its part index (face attribute)."""
    me = high.data.copy()
    ob = bpy.data.objects.new(name + "_low", me)
    col.objects.link(ob)
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    target = TRIS.get(name, 800)
    if tris > target:
        mod = ob.modifiers.new("dec", "DECIMATE")
        mod.ratio = max(0.002, target / tris)
        mod.use_collapse_triangulate = True
        with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob]):
            bpy.ops.object.modifier_apply(modifier=mod.name)
    attr = ob.data.attributes.new("part", "INT", "FACE")
    attr.data.foreach_set("value", np.full(len(ob.data.polygons), idx, dtype=np.int32))
    ob.data.polygons.foreach_set("use_smooth", np.ones(len(ob.data.polygons), dtype=bool))
    return ob


def main():
    from common.hifi import project
    a = args()
    meta = json.load(open(os.path.join(CACHE, f"{ID}_plates.json")))
    scene.reset()
    sc = bpy.context.scene
    col = scene.collection("marund_v2")
    lowcol = scene.collection("marund_v2_low")
    parts = build_parts()
    names = list(parts.keys())
    highs, lows = [], []
    for i, (name, S) in enumerate(parts.items()):
        v, q = S.mesh(a.voxel * (0.6 if name in ("mask", "windows_frame", "windows_glass", "cap_band") else 1.0))
        hi = sdf.to_object(name, v, q, col)
        highs.append(hi)
        lows.append(make_low(hi, name, i, lowcol))
        scene.log(f"{name}: {len(v)} verts high, {sum(len(p.vertices) - 2 for p in lows[-1].data.polygons)} tris low")
    # one game mesh, one atlas
    scene.select_only(lows, active=lows[0])
    bpy.ops.object.join()
    low = bpy.context.view_layer.objects.active
    low.name = "marund_low"
    tris = sum(len(p.vertices) - 2 for p in low.data.polygons)
    scene.log(f"game mesh: {tris} tris")
    scene.set_mode(low, "EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(62), island_margin=0.003, area_weight=0.0)
    scene.set_mode(low, "OBJECT")
    t0 = __import__("time").time()
    maps = project.rasterize(low, a.atlas)
    scene.log(f"rasterised {a.atlas}^2 in {__import__('time').time() - t0:.1f}s")
    plates = project.Plates(CACHE, ID, HEIGHT)
    t0 = __import__("time").time()
    vis = project.VisibilityMaps.build(low, plates, step=2)
    scene.log(f"visibility in {__import__('time').time() - t0:.1f}s")
    top = project.load_rgb(os.path.join(CACHE, f"{ID}_captop.png"))
    rgb = project.paint(maps, plates, vis, names, tops={"cap": (top, 0.7)},
                        flat={"windows_frame": scene.hex_srgb("#BF8F52"), "windows_glass": scene.hex_srgb("#3F9CFF")},
                        log=scene.log)
    atlas_path = os.path.join(OUT, "marund_v2_albedo.png")
    os.makedirs(OUT, exist_ok=True)
    project.save_rgb(rgb, atlas_path)
    # the game material: the painted atlas, a share of it as emission (the paint carries its own light)
    m = bpy.data.materials.new("marund_paint")
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get("Principled BSDF")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(atlas_path)
    nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
    nt.links.new(tex.outputs["Color"], b.inputs["Emission Color"])
    b.inputs["Emission Strength"].default_value = 0.55
    b.inputs["Roughness"].default_value = 0.8
    low.data.materials.clear()
    low.data.materials.append(m)
    for h in highs:
        h.hide_render = True
    blend_dir = os.path.join(scene.CACHE_DIR, "_art2")
    os.makedirs(blend_dir, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(blend_dir, "marund_v2.blend"))
    sc = setup_render(a)
    for kind in a.views.split(","):
        co = camera(sc, kind)
        sc.camera = co
        hgt = a.res
        sc.render.resolution_y = hgt
        sc.render.resolution_x = int(hgt * (0.8 if kind in ("front", "back") else 1.0))
        if kind in ("front", "back"):
            co.data.ortho_scale = 2.6
            co.data.sensor_fit = "VERTICAL"
        sc.render.filepath = os.path.join(OUT, f"marund_v2_{kind}.png")
        bpy.ops.render.render(write_still=True)
        scene.log(f"rendered {kind}")


class _null:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


if __name__ == "__main__":
    main()
