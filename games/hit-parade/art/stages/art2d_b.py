"""HIT PARADE - 2D texture + art generator for lane STAGES-B (rooftop, control_room). Plain Python 3 + PIL + numpy.

  python art/stages/art2d_b.py rooftop|control_room|all [--sheet]

Writes PNGs into _harness/scratch/stages_cache/tex_<sid>/ (gitignored cache). The Blender builds
(art/stages/rooftop.py, art/stages/control_room.py) call this first and load the PNGs. Deterministic: every random
draw is seeded. --sheet also writes a contact sheet _harness/_reports/stages/<sid>_textures.png (QA, read it).

Sources (read-only): Poly Haven textures (CC0: bitumen, bicolour_gravel, asbestos_sheet_02), Japan Village textures
(Unity Asset Store EULA: JP_Red_Brick, JP_Concrete, JP_Conditioner), Quaternius Medieval Village MegaKit textures (CC0:
T_Brick + its OpenGL normal from "Normals Godot-Unity" - the root T_*_Normal.png are DirectX, green inverted, measured),
Blink Stylized Dungeon textures (EULA: Cracked_Concrete_Floor), FANTASTIC Interior planks (EULA, extracted by lane
STAGES P1 into the stages cache), ForgeFlow generated-materials bronze_worn (original).
Fonts: the game's own SIL OFL UI fonts (runtime/src/ui/fonts/*.woff2), converted to TTF with fontTools into the cache.
Everything drawn here (billboard, signs, posters, CRT screens, desk logo, city windows, diamond plate, rivets, grating,
hazard stripes, rain) is original procedural art. No logos of third parties. ASCII only.

Array convention: row 0 = TOP of the image (PIL). Normal maps are OpenGL / glTF (+Y = towards the image top).
"""
import os
import sys
import math
import json

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
CACHE = os.path.join(ROOT, "_harness", "scratch", "stages_cache")
FONTS = os.path.join(CACHE, "fonts_b")
REP = os.path.join(ROOT, "_harness", "_reports", "stages")
A = "F:/games/forgeflow-games-assets"
U = "F:/games/unity-assets"
PHT = A + "/_downloaded/polyhaven-textures/"
JPT = U + "/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Textures/"
QMV = A + "/3d-models/medieval-village-mega/Medieval Village MegaKit[Standard]/Textures/"
BLINK = U + "/Blink__Stylized Dungeon Textures - RPG Environment/Assets/Blink/Art/Textures/StylizedDungeonTextures/"
FANT = os.path.join(CACHE, "fant", "Assets", "Fantastic Interior Pack", "2d", "textures")
GEN = A + "/generated-materials/"

WRITTEN = []


# ================================================================ basics
def out_dir(sid):
    d = os.path.join(CACHE, "tex_" + sid)
    os.makedirs(d, exist_ok=True)
    return d


def save(sid, name, arr):
    """arr: HxW (grey) | HxWx3 | HxWx4 floats 0..1 -> PNG (8 bit)."""
    a = np.clip(arr, 0.0, 1.0)
    a = (a * 255.0 + 0.5).astype(np.uint8)
    if a.ndim == 2:
        im = Image.fromarray(a, "L")
    elif a.shape[2] == 3:
        im = Image.fromarray(a, "RGB")
    else:
        im = Image.fromarray(a, "RGBA")
    p = os.path.join(out_dir(sid), name + ".png")
    im.save(p, optimize=False)
    WRITTEN.append((sid, name, p))
    return p


def save_im(sid, name, im):
    p = os.path.join(out_dir(sid), name + ".png")
    im.save(p)
    WRITTEN.append((sid, name, p))
    return p


def load(path, size, mode="RGB"):
    im = Image.open(path)
    if im.mode not in ("RGB", "RGBA", "L"):
        im = im.convert("RGBA" if "A" in im.getbands() else "RGB")
    im = im.convert(mode)
    if isinstance(size, int):
        size = (size, size)
    if im.size != tuple(size):
        im = im.resize(size, Image.LANCZOS)
    return np.asarray(im).astype(np.float32) / 255.0


def lum(p):
    return p[..., 0] * 0.3 + p[..., 1] * 0.59 + p[..., 2] * 0.11


def tnoise(h, w, cells, seed, cells_y=None):
    """tileable value noise (smoothstep interpolation), 0..1"""
    cy = cells_y or cells
    rng = np.random.default_rng(seed)
    g = rng.random((cy, cells)).astype(np.float32)
    ys = np.arange(h) / h * cy
    xs = np.arange(w) / w * cells
    y0 = np.floor(ys).astype(int) % cy
    x0 = np.floor(xs).astype(int) % cells
    y1 = (y0 + 1) % cy
    x1 = (x0 + 1) % cells
    fy = (ys - np.floor(ys))[:, None]
    fx = (xs - np.floor(xs))[None, :]
    fy = fy * fy * (3 - 2 * fy)
    fx = fx * fx * (3 - 2 * fx)
    a = g[y0][:, x0] * (1 - fx) + g[y0][:, x1] * fx
    b = g[y1][:, x0] * (1 - fx) + g[y1][:, x1] * fx
    return (a * (1 - fy) + b * fy).astype(np.float32)


def fbm(h, w, cells, octaves, seed, gain=0.5):
    tot = np.zeros((h, w), np.float32)
    amp, norm = 1.0, 0.0
    for o in range(octaves):
        tot += amp * tnoise(h, w, cells * (2 ** o), seed + 17 * o)
        norm += amp
        amp *= gain
    return tot / norm


def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def normal_from_height(hgt, strength):
    """tileable central differences; strength = slope gain (height units -> texels)"""
    dx = (np.roll(hgt, -1, 1) - np.roll(hgt, 1, 1)) * 0.5
    dup = (np.roll(hgt, 1, 0) - np.roll(hgt, -1, 0)) * 0.5
    n = np.stack([-dx * strength, -dup * strength, np.ones_like(hgt)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def blend_normals(a, b):
    """whiteout blend of two encoded normal maps"""
    na, nb = a * 2 - 1, b * 2 - 1
    n = np.stack([na[..., 0] + nb[..., 0], na[..., 1] + nb[..., 1], na[..., 2] * nb[..., 2]], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def rough_from_ms(path, size, fallback=0.8):
    """Unity MS (metal R, smoothness A) -> roughness grey (1 - A)"""
    im = Image.open(path)
    if "A" not in im.getbands():
        return np.full((size, size), fallback, np.float32)
    a = load(path, size, "RGBA")
    return 1.0 - a[..., 3]


def tint(p, rgb):
    return p * np.array(rgb, np.float32)


def desat(p, k):
    L = lum(p)[..., None]
    return p * (1 - k) + L * k


def font(name, size):
    ensure_fonts()
    return ImageFont.truetype(os.path.join(FONTS, name + ".ttf"), size)


def ensure_fonts():
    os.makedirs(FONTS, exist_ok=True)
    need = [n for n in ("bungee", "bebas-neue", "russo-one", "acme") if not os.path.exists(os.path.join(FONTS, n + ".ttf"))]
    if not need:
        return
    from fontTools.ttLib import TTFont
    for n in need:
        f = TTFont(os.path.join(ROOT, "runtime", "src", "ui", "fonts", n + "-latin-400.woff2"))
        f.flavor = None
        f.save(os.path.join(FONTS, n + ".ttf"))


def text_center(d, xy, s, fnt, fill, stroke=0, stroke_fill=None, anchor="mm"):
    d.text(xy, s, font=fnt, fill=fill, anchor=anchor, stroke_width=stroke, stroke_fill=stroke_fill)


def to_np(im):
    return np.asarray(im.convert("RGBA")).astype(np.float32) / 255.0


def halftone(w, h, cell, center, rmax, color, bg=None):
    """radial halftone dots growing away from center (comic print)"""
    im = Image.new("RGBA", (w, h), bg or (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx, cy = center
    dmax = math.hypot(max(cx, w - cx), max(cy, h - cy))
    for yy in range(0, h + cell, cell):
        for xx in range(0, w + cell, cell):
            off = (cell // 2) if (yy // cell) % 2 else 0
            px = xx + off
            t = math.hypot(px - cx, yy - cy) / dmax
            r = rmax * t
            if r > 0.6:
                d.ellipse((px - r, yy - r, px + r, yy + r), fill=color)
    return im


def starburst(d, cx, cy, r0, r1, n, fill, outline=None, width=0, rot=0.0):
    pts = []
    for i in range(2 * n):
        a = rot + math.pi * i / n
        r = r1 if i % 2 == 0 else r0
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    d.polygon(pts, fill=fill, outline=outline, width=width)


def grime_overlay(arr, seed, amount=0.25, streaks=True):
    """darkening grime + vertical rain streaks (0..1 floats, HxWx3|4)"""
    h, w = arr.shape[:2]
    g = fbm(h, w, 6, 4, seed)
    k = 1.0 - amount * sstep(0.45, 0.8, g)
    if streaks:
        s = tnoise(h, w, 90, seed + 3, cells_y=3)
        k *= 1.0 - 0.18 * sstep(0.55, 0.9, s)
    out = arr.copy()
    out[..., :3] *= k[..., None]
    return out


# ================================================================ shared procedural sets
def painted_metal(size, base, seed, rust=(0.30, 0.15, 0.07), chip=0.66, streak=True):
    """painted steel: paint chips over rust, grime, drips. returns (albedo, height, rough)"""
    h = w = size
    n1 = fbm(h, w, 8, 4, seed)
    n2 = fbm(h, w, 24, 3, seed + 5)
    chipm = sstep(chip, chip + 0.05, 0.6 * n1 + 0.4 * n2)
    grime = fbm(h, w, 5, 3, seed + 9)
    col = np.ones((h, w, 3), np.float32) * np.array(base, np.float32)
    col *= (0.85 + 0.25 * n2)[..., None]
    rc = np.array(rust, np.float32) * (0.7 + 0.6 * fbm(h, w, 40, 2, seed + 11))[..., None]
    col = col * (1 - chipm[..., None]) + rc * chipm[..., None]
    col *= (1.0 - 0.35 * sstep(0.5, 0.85, grime))[..., None]
    rough = 0.52 + 0.18 * n2 + 0.25 * chipm
    if streak:
        s = tnoise(h, w, 70, seed + 21, cells_y=2)
        drip = sstep(0.62, 0.92, s)
        col *= (1.0 - 0.25 * drip)[..., None]
        rough -= 0.2 * drip
    hgt = -0.6 * chipm + 0.15 * n2
    return col, hgt, np.clip(rough, 0.15, 1.0)


# ================================================================ ROOFTOP
def gen_rooftop():
    sid = "rooftop"
    # roof deck: Poly Haven bitumen (roll roofing), rain-dark
    a = load(PHT + "bitumen/diffuse.jpg", 1024)
    a = tint(desat(a, 0.25), (0.62, 0.62, 0.66))
    save(sid, "rt13_roof_a", a)
    # the Poly Haven bitumen displacement is flat (measured 0.569..0.592, 6 grey levels): height = albedo luminance
    # (granules, roll overlaps) + fine fbm grit
    raw = lum(load(PHT + "bitumen/diffuse.jpg", 1024))
    lo, hi = np.percentile(raw, 2), np.percentile(raw, 98)
    hgt = np.clip((raw - lo) / max(1e-3, hi - lo), 0, 1) + 0.5 * fbm(1024, 1024, 96, 2, 405)
    save(sid, "rt13_roof_n", normal_from_height(hgt, 1.6))
    r = load(PHT + "bitumen/rough.jpg", 1024, "L")
    wet = fbm(1024, 1024, 4, 3, 404)
    save(sid, "rt13_roof_r", np.clip(0.46 + 0.4 * r - 0.14 * sstep(0.5, 0.75, wet), 0.2, 1.0))
    # gravel ballast
    a = load(PHT + "bicolour_gravel/diffuse.jpg", 1024)
    save(sid, "rt13_gravel_a", tint(a, (0.55, 0.55, 0.6)))
    d = load(PHT + "bicolour_gravel/displacement.jpg", 1024, "L")
    save(sid, "rt13_gravel_n", normal_from_height(d, 24.0))
    r = load(PHT + "bicolour_gravel/rough.jpg", 1024, "L")
    save(sid, "rt13_gravel_r", np.clip(0.35 + 0.5 * r, 0, 1))
    # brick (stair bulkhead, parapets): Japan Village red brick, rain-dark
    a = load(JPT + "House/JP_Red_Brick/JP_Red_Brick_A.tga", 1024)
    a = grime_overlay(tint(desat(a, 0.15), (0.66, 0.6, 0.6)), 71, 0.3)
    save(sid, "rt13_brick_a", a)
    save(sid, "rt13_brick_n", load(JPT + "House/JP_Red_Brick/JP_Red_Brick_N.tga", 1024))
    save(sid, "rt13_brick_r", np.clip(rough_from_ms(JPT + "House/JP_Red_Brick/JP_Red_Brick_MS.tga", 1024) * 0.78, 0.2, 1))
    # concrete (coping, plinths, machine-room base)
    a = load(JPT + "House/JP_Concrete/JP_Concrete_A.tga", 1024)
    a = grime_overlay(tint(a, (0.5, 0.5, 0.53)), 72, 0.35)
    save(sid, "rt13_conc_a", a)
    save(sid, "rt13_conc_n", load(JPT + "House/JP_Concrete/JP_Concrete_N.tga", 1024))
    save(sid, "rt13_conc_r", np.clip(rough_from_ms(JPT + "House/JP_Concrete/JP_Concrete_MS.tga", 1024) * 0.8, 0.2, 1))
    # corrugated cladding (machine room): Poly Haven asbestos_sheet_02 + a green-grey paint pass
    a = load(PHT + "asbestos_sheet_02/diffuse.jpg", 1024)
    L = lum(a)[..., None]
    paint = np.array([0.20, 0.25, 0.25], np.float32) * (0.6 + 0.8 * L)
    a = grime_overlay(paint * 0.8 + a * 0.2, 73, 0.25)
    save(sid, "rt13_corr_a", a)
    d = load(PHT + "asbestos_sheet_02/displacement.jpg", 1024, "L")
    save(sid, "rt13_corr_n", normal_from_height(d, 9.0))
    r = load(PHT + "asbestos_sheet_02/rough.jpg", 1024, "L")
    save(sid, "rt13_corr_r", np.clip(0.3 + 0.45 * r, 0, 1))
    # AC units: Japan Village conditioner atlas
    save(sid, "rt13_ac_a", tint(load(JPT + "Environment/JP_Conditioner/JP_Conditioner_A.tga", 1024), (0.8, 0.8, 0.82)))
    save(sid, "rt13_ac_n", load(JPT + "Environment/JP_Conditioner/JP_Conditioner_N.tga", 1024))
    save(sid, "rt13_ac_r", np.clip(rough_from_ms(JPT + "Environment/JP_Conditioner/JP_Conditioner_MS.tga", 1024, 0.6) * 0.85, 0.15, 1))
    # electric meters / fuse boxes: Japan Village meters atlas (the JP_Electric_Meter models' own UVs)
    save(sid, "rt13_meters_a", tint(load(JPT + "Environment/JP_Meters/JP_Meters_A.tga", 1024), (0.72, 0.72, 0.74)))
    save(sid, "rt13_meters_n", load(JPT + "Environment/JP_Meters/JP_Meters_N.tga", 1024))
    save(sid, "rt13_meters_r", rough_from_ms(JPT + "Environment/JP_Meters/JP_Meters_MS.tga", 1024, 0.6) * 0.8)
    # water tank staves: FANTASTIC planks, weathered grey-brown, wet
    a = load(os.path.join(FANT, "T_ENV_MOD_Interior_PlanksLong_01_v1_BC.png"), 1024)
    a = grime_overlay(tint(desat(a, 0.45), (0.55, 0.5, 0.45)), 74, 0.3)
    save(sid, "rt13_wood_a", a)
    save(sid, "rt13_wood_n", load(os.path.join(FANT, "T_ENV_MOD_Interior_PlanksLong_01_N.png"), 1024))
    # painted steel (door, frames, dunnage, tank legs, antenna, billboard frame)
    col, hgt, rough = painted_metal(1024, (0.13, 0.14, 0.15), 501)
    save(sid, "rt13_steel_a", col)
    save(sid, "rt13_steel_n", blend_normals(normal_from_height(hgt, 3.0), normal_from_height(fbm(1024, 1024, 64, 2, 502), 1.5)))
    save(sid, "rt13_steel_r", rough * 0.85)
    col, _, _ = painted_metal(1024, (0.30, 0.075, 0.06), 503)          # red-oxide door / hatch paint
    save(sid, "rt13_door_a", col)
    col, _, _ = painted_metal(1024, (0.40, 0.41, 0.40), 504, chip=0.72)  # light galvanised paint (RTU cabinets)
    save(sid, "rt13_rtu_a", col)
    # aluminium bleacher planks: ribbed extrusion along U, dirty + wet
    h = w = 1024
    v = np.arange(h, dtype=np.float32)[:, None] / h
    ribs = 0.5 + 0.5 * np.cos(2 * math.pi * v * 48)
    ribs = np.broadcast_to(ribs, (h, w)).copy()
    seam = sstep(0.0, 0.004, np.abs(((v * 4) % 1.0) - 0.5) - 0.495)   # plank joints every 25 cm
    ribs = ribs * 0.35 - 0.8 * np.broadcast_to(seam, (h, w))
    n2 = fbm(h, w, 32, 3, 611)
    grime = fbm(h, w, 6, 3, 612)
    col = np.ones((h, w, 3), np.float32) * np.array([0.46, 0.47, 0.49], np.float32)
    col *= (0.82 + 0.3 * n2)[..., None]
    col *= (1.0 - 0.45 * sstep(0.45, 0.8, grime))[..., None]
    save(sid, "rt13_alu_a", col)
    save(sid, "rt13_alu_n", blend_normals(normal_from_height(ribs, 6.0), normal_from_height(n2, 1.0)))
    save(sid, "rt13_alu_r", np.clip(0.28 + 0.2 * n2 + 0.3 * sstep(0.5, 0.85, grime), 0, 1))
    gen_rooftop_art(sid)
    gen_ring_art(sid)


def hazard_band(w, h, period_px, seed, yellow=(0.96, 0.77, 0.08), black=(0.06, 0.055, 0.05), wear=0.3):
    """tileable (in U) diagonal hazard stripes, worn + grimy: HxWx3 floats. period_px must divide w."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    ph = ((xx + yy * (period_px / 2.0) / max(1, h) * 2.0) % period_px) / period_px
    m = (ph < 0.5).astype(np.float32)
    # soft edge
    e = np.minimum(np.abs(ph - 0.5), np.minimum(ph, 1 - ph)) * period_px
    m = np.where(e < 1.0, 0.5, m)
    col = np.array(black, np.float32) * (1 - m[..., None]) + np.array(yellow, np.float32) * m[..., None]
    n = fbm(h, w, 16, 4, seed)
    chip = sstep(0.62, 0.66, n)
    col = col * (1 - wear * chip[..., None]) + np.array([0.3, 0.3, 0.3], np.float32) * wear * chip[..., None]
    col *= (0.85 + 0.25 * fbm(h, w, 32, 2, seed + 1))[..., None]
    return col


def gen_ring_art(sid):
    """3D ring conversion (lane STAGES3D-B): the helipad-style ring paint + the curb's hazard face (both tileable along
    the ring: the Blender build maps u = arc length / tile)"""
    # ---------------------------------------------------------- curb hazard face (1.0 m per tile along the ring)
    save(sid, "rt13_hazard", hazard_band(512, 64, 128, 1301))
    # ---------------------------------------------------------- worn road-paint band (RGBA, MASK): top half white,
    # bottom half yellow; alpha = paint left after years of rain and boots (tileable in U, 2 m per tile)
    W, H = 1024, 256
    arr = np.zeros((H, W, 4), np.float32)
    wear = fbm(H, W, 24, 5, 1311)
    grit = tnoise(H, W, 256, 1312, cells_y=64)
    edge_v = np.abs(((np.arange(H, dtype=np.float32) / (H / 2.0)) % 1.0) - 0.5)[:, None]   # 0 at band centre
    edge = sstep(0.5, 0.44, edge_v + 0.03 * fbm(H, W, 64, 2, 1313))                         # ragged painted edges
    keep = sstep(0.34, 0.40, wear) * (grit > 0.12) * edge
    arr[: H // 2, :, 0:3] = np.array([0.66, 0.65, 0.62], np.float32)       # rain-dulled white
    arr[H // 2:, :, 0:3] = np.array([0.72, 0.52, 0.10], np.float32)        # rain-dulled yellow
    arr[..., 0:3] *= (0.8 + 0.3 * fbm(H, W, 32, 3, 1314))[..., None]
    arr[..., 3] = keep
    save(sid, "rt13_padpaint", arr)


def gen_control_ring_art(sid):
    """3D ring conversion (lane STAGES3D-B): the octagon deck's painted centre logo (RGBA, MASK) + booth signs"""
    S = 1024
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = S // 2
    red, yel, cream = (190, 34, 44, 255), (224, 168, 26, 255), (214, 204, 184, 255)
    # octagon outline ring + starburst + title
    oct_pts = [(c + 480 * math.cos(math.radians(22.5 + 45 * k)), c + 480 * math.sin(math.radians(22.5 + 45 * k))) for k in range(8)]
    d.polygon(oct_pts, outline=yel, width=26)
    oct2 = [(c + 420 * math.cos(math.radians(22.5 + 45 * k)), c + 420 * math.sin(math.radians(22.5 + 45 * k))) for k in range(8)]
    d.polygon(oct2, outline=cream, width=10)
    starburst(d, c, c, 190, 330, 14, fill=red, rot=0.11)
    starburst(d, c, c, 160, 280, 14, fill=(30, 12, 24, 255), rot=0.11)
    text_center(d, (c, c - 40), "HIT", font("bungee", 150), yel)
    text_center(d, (c, c + 80), "PARADE", font("bungee", 96), yel)
    fr = font("bebas-neue", 64)
    for i, ch_ in enumerate("SEASON FINALE"):
        if ch_ == " ":
            continue
        ang = math.radians(-66 + i * 11)
        x = c + 372 * math.sin(ang)
        y = c - 372 * math.cos(ang)
        g = Image.new("RGBA", (110, 110), (0, 0, 0, 0))
        ImageDraw.Draw(g).text((55, 55), ch_, font=fr, fill=cream, anchor="mm")
        g = g.rotate(-math.degrees(ang), resample=Image.BICUBIC)
        im.alpha_composite(g, (int(x - 55), int(y - 55)))
    arr = to_np(im)
    wear = fbm(S, S, 20, 5, 2911)
    keep = sstep(0.36, 0.42, wear)
    arr[..., 3] *= keep
    arr[..., 0:3] *= (0.75 + 0.3 * fbm(S, S, 48, 3, 2912))[..., None]
    save(sid, "cr_floorlogo", arr)
    # ---------------------------------------------------------- booth signs 1024 x 256: CONTROL (lit) + OBSERVATION
    im = Image.new("RGB", (1024, 256), (14, 12, 14))
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, 511, 127), fill=(18, 16, 20))
    d.rectangle((8, 8, 503, 119), outline=(255, 208, 30), width=5)
    text_center(d, (256, 64), "CONTROL", font("bungee", 74), (255, 208, 30))
    d.rectangle((512, 0, 1023, 127), fill=(18, 16, 20))
    d.rectangle((520, 8, 1015, 119), outline=(120, 200, 255), width=5)
    text_center(d, (768, 64), "OBSERVATION", font("bungee", 56), (140, 210, 255))
    # [0..512, 128..256] studio rules plate, [512..1024, 128..256] "STAGE 13 - QUIET PLEASE" plate
    d.rectangle((0, 128, 511, 255), fill=(200, 196, 186))
    text_center(d, (256, 170), "NO FOOD - NO DRINKS", font("bebas-neue", 50), (30, 28, 26))
    text_center(d, (256, 222), "CREW ONLY BEYOND THIS POINT", font("bebas-neue", 38), (150, 20, 20))
    d.rectangle((512, 128, 1023, 255), fill=(150, 20, 24))
    text_center(d, (768, 180), "STAGE B2", font("bungee", 58), (255, 240, 225))
    text_center(d, (768, 232), "QUIET WHILE ON AIR", font("bebas-neue", 36), (255, 220, 200))
    arr = np.asarray(im).astype(np.float32) / 255.0
    save(sid, "cr_signs2", grime_overlay(arr, 2913, 0.15, streaks=False))


def gen_rooftop_art(sid):
    # ---------------------------------------------------------- billboard (printed art, lit at night)
    W, H = 2048, 1024
    im = Image.new("RGBA", (W, H), (22, 14, 44, 255))
    g = np.zeros((H, W, 4), np.float32)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    rr = np.hypot((xx - 700) / W, (yy - 520) / H)
    base = np.stack([0.34 - 0.25 * rr, 0.05 + 0.02 * rr, 0.36 - 0.1 * rr, np.ones_like(rr)], -1)
    im = Image.fromarray((np.clip(base, 0, 1) * 255).astype(np.uint8), "RGBA")
    im.alpha_composite(halftone(W, H, 26, (700, 520), 11, (255, 60, 120, 110)))
    # speed rays from the burst (own layer: ImageDraw replaces RGBA pixels, it does not blend)
    rays = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rays)
    for i in range(36):
        a0 = i * 2 * math.pi / 36
        a1 = a0 + 0.05
        rd.polygon([(700, 520), (700 + 2400 * math.cos(a0), 520 + 2400 * math.sin(a0)),
                    (700 + 2400 * math.cos(a1), 520 + 2400 * math.sin(a1))], fill=(255, 210, 60, 40))
    im.alpha_composite(rays)
    d = ImageDraw.Draw(im)
    starburst(d, 700, 520, 300, 470, 14, fill=(255, 208, 30, 255), outline=(15, 8, 20, 255), width=14, rot=0.12)
    starburst(d, 700, 520, 250, 395, 14, fill=(236, 38, 58, 255), rot=0.34)
    fb = font("bungee", 230)
    text_center(d, (700, 470), "LIVE!", fb, (255, 244, 214, 255), stroke=14, stroke_fill=(15, 8, 20, 255))
    text_center(d, (700, 640), "FRIDAYS 11PM", font("bebas-neue", 110), (255, 230, 90, 255), stroke=6,
                stroke_fill=(15, 8, 20, 255))
    # right column: channel roundel + tagline
    d.ellipse((1330, 110, 1830, 610), fill=(15, 8, 20, 255))
    d.ellipse((1352, 132, 1808, 588), fill=(236, 38, 58, 255))
    d.ellipse((1400, 180, 1760, 540), fill=(15, 8, 20, 255))
    text_center(d, (1580, 372), "13", font("russo-one", 260), (255, 244, 214, 255))
    text_center(d, (1580, 690), "CHANNEL 13", font("bungee", 104), (255, 244, 214, 255), stroke=6,
                stroke_fill=(15, 8, 20, 255))
    text_center(d, (1580, 800), "THE NO-RULES FIGHT SHOW", font("bebas-neue", 70), (255, 208, 30, 255))
    text_center(d, (1580, 880), "HOSTED BY RICKY MARQUEE", font("bebas-neue", 58), (200, 190, 255, 255))
    # bottom stripe
    d.rectangle((0, 930, W, 1024), fill=(255, 208, 30, 255))
    text_center(d, (1024, 978), "KNOCKOUT 13  -  EVERY HIT IS A SHOW  -  KNOCKOUT 13  -  EVERY HIT IS A SHOW",
                font("bebas-neue", 70), (15, 8, 20, 255))
    arr = to_np(im)
    arr = grime_overlay(arr, 81, 0.22)
    im = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8), "RGBA").convert("RGB")
    save_im(sid, "rt13_billboard", im.resize((1024, 512), Image.LANCZOS))

    # ---------------------------------------------------------- sign atlas 1024 (box sign, plates, posters)
    S = 1024
    im = Image.new("RGB", (S, S), (20, 20, 22))
    d = ImageDraw.Draw(im)
    # [0..512, 0..256] CHANNEL 13 box-sign face (lit letters on black)
    d.rectangle((0, 0, 511, 255), fill=(12, 10, 14))
    d.ellipse((24, 28, 224, 228), fill=(236, 38, 58))
    d.ellipse((46, 50, 202, 206), fill=(12, 10, 14))
    text_center(d, (124, 132), "13", font("russo-one", 110), (255, 238, 210))
    text_center(d, (372, 96), "CHANNEL", font("bungee", 50), (255, 238, 210))
    text_center(d, (372, 170), "LIVE 24/7", font("bebas-neue", 64), (255, 208, 30))
    # [512..1024, 0..256] DANGER plate
    d.rectangle((512, 0, 1023, 255), fill=(245, 196, 20))
    d.rectangle((530, 18, 1005, 237), outline=(15, 12, 10), width=10)
    d.polygon([(600, 190), (660, 60), (720, 190)], fill=(15, 12, 10))
    d.polygon([(640, 100), (672, 100), (652, 140), (680, 140), (628, 185), (648, 148), (624, 148)], fill=(245, 196, 20))
    text_center(d, (860, 90), "DANGER", font("bungee", 58), (15, 12, 10))
    text_center(d, (860, 170), "HIGH VOLTAGE", font("bebas-neue", 52), (15, 12, 10))
    # [0..256, 256..384] EXIT (green), [256..512, 256..384] ROOF ACCESS plate
    d.rectangle((0, 256, 255, 383), fill=(18, 140, 70))
    d.rectangle((8, 264, 247, 375), outline=(230, 255, 235), width=5)
    text_center(d, (128, 320), "EXIT", font("bungee", 70), (240, 255, 244))
    d.rectangle((256, 256, 511, 383), fill=(210, 210, 205))
    text_center(d, (384, 300), "ROOF ACCESS", font("bebas-neue", 46), (30, 30, 34))
    text_center(d, (384, 350), "STAFF ONLY", font("bebas-neue", 40), (170, 20, 30))
    # [512..1024, 256..512] hazard stripe band + "STAGE CREW" plate
    for i in range(-4, 40):
        x0 = 512 + i * 36
        d.polygon([(x0, 256), (x0 + 18, 256), (x0 + 18 + 60, 320), (x0 + 60, 320)], fill=(245, 196, 20))
    d.rectangle((512, 256, 1023, 319), outline=None)
    d.rectangle((512, 320, 1023, 511), fill=(40, 40, 46))
    text_center(d, (768, 392), "KNOCKOUT 13", font("bungee", 60), (255, 208, 30))
    text_center(d, (768, 462), "STAGE CREW ONLY", font("bebas-neue", 50), (230, 230, 235))
    # [0..512, 384..512] small caution plates (two)
    d.rectangle((0, 384, 255, 511), fill=(230, 230, 225))
    text_center(d, (128, 420), "CAUTION", font("bungee", 40), (190, 20, 30))
    text_center(d, (128, 470), "WET ROOF", font("bebas-neue", 44), (30, 30, 34))
    d.rectangle((256, 384, 511, 511), fill=(30, 60, 150))
    text_center(d, (384, 420), "NO", font("bungee", 40), (240, 240, 250))
    text_center(d, (384, 470), "UNAUTHORIZED ACCESS", font("bebas-neue", 30), (240, 240, 250))
    im.paste(Image.new("RGB", (1, 1)), (0, 0))
    # posters [0..1024, 512..1024]: 3 comic fight posters, weathered
    posters = [
        ((236, 38, 58), (255, 208, 30), "HIT", "PARADE", "LIVE ON 13"),
        ((30, 36, 90), (255, 90, 160), "SEASON", "FINALE", "THIS FRIDAY"),
        ((250, 200, 30), (236, 38, 58), "RATINGS", "SPIKE!", "STAY TUNED"),
    ]
    pw = S // 3
    for k, (bg, fg, t1, t2, t3) in enumerate(posters):
        x0 = k * pw
        p = Image.new("RGBA", (pw, 512), bg + (255,))
        pd = ImageDraw.Draw(p)
        p.alpha_composite(halftone(pw, 512, 14, (pw // 2, 300), 6, fg + (90,)))
        starburst(pd, pw // 2, 330, 80, 150, 11, fill=fg + (255,), outline=(15, 8, 20, 255), width=6, rot=0.2 * k)
        text_center(pd, (pw // 2, 330), "13", font("russo-one", 90), (255, 244, 214, 255), stroke=4, stroke_fill=(15, 8, 20, 255))
        text_center(pd, (pw // 2, 70), t1, font("bungee", 58), (255, 244, 214, 255), stroke=5, stroke_fill=(15, 8, 20, 255))
        text_center(pd, (pw // 2, 140), t2, font("bungee", 58), fg + (255,), stroke=5, stroke_fill=(15, 8, 20, 255))
        text_center(pd, (pw // 2, 470), t3, font("bebas-neue", 50), (255, 244, 214, 255), stroke=3, stroke_fill=(15, 8, 20, 255))
        im.paste(p.convert("RGB"), (x0, 512))
    arr = np.asarray(im).astype(np.float32) / 255.0
    h2 = 512
    wear = fbm(h2, S, 12, 4, 91)
    arr[512:] = grime_overlay(arr[512:], 92, 0.3)
    peel = sstep(0.7, 0.74, wear)
    arr[512:] = arr[512:] * (1 - peel[..., None]) + np.array([0.55, 0.53, 0.5]) * peel[..., None] * 0.6
    save(sid, "rt13_signs", arr)

    # ---------------------------------------------------------- city windows atlas 1024 (4 facade styles, 2x2)
    S = 1024
    Q = S // 2
    arr = np.zeros((S, S, 3), np.float32)
    rng = np.random.default_rng(1313)
    styles = [
        dict(cols=10, rows=14, wf=0.62, hf=0.58, face=(0.045, 0.05, 0.065), lit=0.34),     # office grid
        dict(cols=8, rows=12, wf=0.42, hf=0.5, face=(0.09, 0.05, 0.045), lit=0.42),        # brick apartments
        dict(cols=6, rows=16, wf=0.5, hf=0.72, face=(0.07, 0.07, 0.08), lit=0.28),         # deco piers
        dict(cols=14, rows=10, wf=0.8, hf=0.44, face=(0.03, 0.035, 0.05), lit=0.22),       # glass tower bands
    ]
    lights = [np.array(c, np.float32) for c in ((1.0, 0.78, 0.42), (1.0, 0.86, 0.6), (0.72, 0.82, 1.0), (0.45, 0.6, 1.0),
                                                (1.0, 0.55, 0.3))]
    for k, st in enumerate(styles):
        ox, oy = (k % 2) * Q, (k // 2) * Q
        tile = np.ones((Q, Q, 3), np.float32) * np.array(st["face"], np.float32)
        tile *= (0.8 + 0.4 * fbm(Q, Q, 8, 3, 1400 + k))[..., None]
        cw, ch = Q / st["cols"], Q / st["rows"]
        for r in range(st["rows"]):
            floor_lit = rng.random() < 0.85
            for c in range(st["cols"]):
                x0 = int(c * cw + cw * (1 - st["wf"]) / 2)
                x1 = int(c * cw + cw * (1 + st["wf"]) / 2)
                y0 = int(r * ch + ch * (1 - st["hf"]) / 2)
                y1 = int(r * ch + ch * (1 + st["hf"]) / 2)
                if floor_lit and rng.random() < st["lit"]:
                    lc = lights[rng.integers(0, len(lights))] * (0.55 + 0.6 * rng.random())
                    win = np.ones((y1 - y0, x1 - x0, 3), np.float32) * lc
                    # blinds / silhouettes: a darker lower band sometimes
                    if rng.random() < 0.4:
                        b = int((y1 - y0) * (0.3 + 0.4 * rng.random()))
                        win[:b] *= 0.35
                else:
                    g = 0.02 + 0.03 * rng.random()
                    win = np.ones((y1 - y0, x1 - x0, 3), np.float32) * np.array([g * 0.8, g * 0.9, g * 1.4])
                tile[y0:y1, x0:x1] = win
            if k == 3:
                tile[int(r * ch):int(r * ch) + 2, :] = np.array([0.08, 0.09, 0.1])
        arr[oy:oy + Q, ox:ox + Q] = tile
    save(sid, "rt13_windows", arr)

    # ---------------------------------------------------------- rain streak card (RGBA, BLEND)
    Wr, Hr = 256, 1024
    rain = np.zeros((Hr, Wr, 4), np.float32)
    rng = np.random.default_rng(777)
    for i in range(22):
        x = rng.integers(3, Wr - 3)
        L = int(Hr * (0.12 + 0.3 * rng.random()))
        y0 = rng.integers(0, Hr)
        a = 0.35 + 0.55 * rng.random()
        for j in range(L):
            y = (y0 + j) % Hr
            t = j / L
            al = a * math.sin(math.pi * t) ** 0.6
            for dx, f in ((0, 1.0), (-1, 0.35), (1, 0.35)):
                rain[y, (x + dx) % Wr, 3] = max(rain[y, (x + dx) % Wr, 3], al * f)
    rain[..., 0:3] = np.array([0.78, 0.84, 1.0], np.float32)
    save(sid, "rt13_rain", rain)

    # ---------------------------------------------------------- rain ripples on puddles (normal map, 1 m tile)
    S = 512
    rng = np.random.default_rng(3131)
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32) / S
    hgt = np.zeros((S, S), np.float32)
    for i in range(46):
        cx_, cy_ = rng.random(), rng.random()
        rad = 0.02 + 0.09 * rng.random()
        amp = 0.4 + 0.6 * rng.random()
        dx_ = np.abs(xx - cx_)
        dx_ = np.minimum(dx_, 1 - dx_)
        dy_ = np.abs(yy - cy_)
        dy_ = np.minimum(dy_, 1 - dy_)
        dd = np.hypot(dx_, dy_)
        for kk in range(3):
            rr_ = rad * (1 - 0.3 * kk)
            hgt += amp * (1 - rad * 6) * np.exp(-((dd - rr_) / 0.006) ** 2) * (0.6 ** kk)
    hgt += 0.15 * fbm(S, S, 8, 3, 3132)
    save(sid, "rt13_ripple_n", normal_from_height(hgt, 2.2))

    # ---------------------------------------------------------- roof emblem (worn paint, alpha MASK)
    S = 1024
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = S // 2
    paint, yel = (150, 146, 138, 255), (170, 128, 30, 255)          # old, rain-dulled road paint
    d.ellipse((40, 40, S - 40, S - 40), outline=paint, width=46)
    d.ellipse((150, 150, S - 150, S - 150), outline=yel, width=20)
    text_center(d, (c, c + 10), "13", font("russo-one", 400), paint)
    fr = font("bebas-neue", 70)
    for i, ch_ in enumerate("KNOCKOUT"):
        ang = math.radians(-70 + i * 20)
        x = c + 380 * math.sin(ang)
        y = c - 380 * math.cos(ang)
        g = Image.new("RGBA", (120, 120), (0, 0, 0, 0))
        ImageDraw.Draw(g).text((60, 60), ch_, font=fr, fill=paint, anchor="mm")
        g = g.rotate(-math.degrees(ang), resample=Image.BICUBIC)
        im.alpha_composite(g, (int(x - 60), int(y - 60)))
    arr = to_np(im)
    wear = fbm(S, S, 16, 5, 1717)
    keep = sstep(0.40, 0.45, wear)
    arr[..., 3] *= keep
    save(sid, "rt13_emblem", arr)


# ================================================================ CONTROL ROOM
def diamond_plate(size, seed, pitch_px=32):
    h = w = size
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    cu = (xx % pitch_px) / pitch_px - 0.5
    cv = (yy % pitch_px) / pitch_px - 0.5
    ci = (xx // pitch_px).astype(int)
    cj = (yy // pitch_px).astype(int)
    sgn = np.where((ci + cj) % 2 == 0, 1.0, -1.0)
    c45 = math.sqrt(0.5)
    a = (cu + sgn * cv) * c45
    b = (-sgn * cu + cv) * c45
    q = (np.abs(a) / 0.40) ** 2 + (np.abs(b) / 0.085) ** 2
    lz = sstep(1.0, 0.55, q)
    n = fbm(h, w, 16, 3, seed)
    dirt = fbm(h, w, 3, 4, seed + 3)
    oil = sstep(0.66, 0.74, fbm(h, w, 3, 3, seed + 7))
    rust = sstep(0.74, 0.8, fbm(h, w, 10, 3, seed + 9)) * 0.6
    col = np.ones((h, w, 3), np.float32) * np.array([0.30, 0.31, 0.33], np.float32)
    col *= (0.85 + 0.25 * n)[..., None]
    col = col * (1 - 0.5 * lz[..., None]) + np.array([0.52, 0.53, 0.55]) * (0.5 * lz[..., None])
    col *= (1 - 0.22 * sstep(0.45, 0.85, dirt) * (1 - lz))[..., None]
    col = col * (1 - 0.35 * oil[..., None]) + np.array([0.06, 0.055, 0.05]) * (0.35 * oil[..., None])
    col = col * (1 - rust[..., None]) + np.array([0.28, 0.13, 0.06]) * rust[..., None] * (0.7 + 0.5 * n[..., None])
    rough = 0.56 - 0.2 * lz + 0.18 * sstep(0.45, 0.85, dirt) + 0.3 * rust - 0.15 * oil
    hgt = lz * 1.0 + 0.05 * n - 0.1 * rust
    return col, hgt, np.clip(rough, 0.12, 1)


def riveted_panels(size, seed, paint=(0.12, 0.16, 0.16), panels=2):
    h = w = size
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    p = size / panels
    fu = (xx % p) / p
    fv = (yy % p) / p
    du = np.minimum(fu, 1 - fu) * p
    dv = np.minimum(fv, 1 - fv) * p
    dseam = np.minimum(du, dv)
    seam = sstep(4.0, 1.0, dseam)
    # rivets every p/10 along the seams, 9 px in from the seam
    step = p / 10
    rv = np.zeros((h, w), np.float32)
    for inset in (9.0,):
        for axis in (0, 1):
            along = (yy if axis == 0 else xx)
            across = (du if axis == 0 else dv)
            k = np.abs(((along + step / 2) % step) - step / 2)
            dd = np.hypot(k, across - inset)
            rv = np.maximum(rv, sstep(5.5, 2.0, dd))
    n = fbm(h, w, 12, 3, seed)
    canning = fbm(h, w, panels * 2, 2, seed + 1)
    chip = sstep(0.7, 0.74, 0.6 * fbm(h, w, 10, 4, seed + 2) + 0.4 * n)
    col = np.ones((h, w, 3), np.float32) * np.array(paint, np.float32) * (0.85 + 0.3 * n)[..., None]
    # rust streaks below rivet rows
    streak = tnoise(h, w, 60, seed + 4, cells_y=2)
    sm = sstep(0.55, 0.85, streak) * sstep(0.2, 1.0, (fv * 1.0))
    rust = np.array([0.30, 0.14, 0.06], np.float32)
    col = col * (1 - 0.55 * sm[..., None]) + rust * (0.55 * sm[..., None])
    col = col * (1 - chip[..., None]) + rust * 0.8 * chip[..., None]
    # grime towards each panel's bottom edge
    col *= (1 - 0.35 * sstep(0.6, 1.0, fv))[..., None]
    col *= (1 - 0.5 * seam)[..., None]
    col = col * (1 - 0.3 * rv[..., None]) + np.array([0.3, 0.3, 0.3]) * 0.3 * rv[..., None]
    rough = 0.55 + 0.15 * n + 0.25 * chip + 0.15 * sm - 0.1 * rv
    hgt = -1.2 * seam + 1.4 * rv + 0.4 * canning - 0.3 * chip
    return col, hgt, np.clip(rough, 0.15, 1)


def gen_control_room():
    sid = "control_room"
    col, hgt, rough = diamond_plate(1024, 2101)
    save(sid, "cr_deck_a", col)
    save(sid, "cr_deck_n", normal_from_height(hgt, 4.0))
    save(sid, "cr_deck_r", rough)
    col, hgt, rough = riveted_panels(1024, 2201)
    save(sid, "cr_panel_a", col)
    save(sid, "cr_panel_n", normal_from_height(hgt, 2.5))
    save(sid, "cr_panel_r", rough)
    # sooty brick (CC0 QMV T_Brick, OpenGL normal)
    a = load(QMV + "T_Brick_BaseColor.png", 1024)
    L = lum(a)
    lo, hi = np.percentile(L, 4), np.percentile(L, 97)
    t = np.clip((L - lo) / max(1e-3, hi - lo), 0, 1)[..., None]
    dark = np.array([0.05, 0.035, 0.03], np.float32)
    lite = np.array([0.30, 0.13, 0.09], np.float32)
    a = grime_overlay(dark * (1 - t) + lite * t, 2301, 0.35)
    save(sid, "cr_brick_a", a)
    save(sid, "cr_brick_n", load(QMV + "Normals Godot-Unity/T_Brick_Normal.png", 1024))
    save(sid, "cr_brick_r", np.clip(0.2 + load(QMV + "T_Brick_Roughness.png", 1024, "L") * 0.8, 0, 1))
    # concrete floor (Blink cracked concrete, desaturated + oil stains)
    a = load(BLINK + "Cracked_Concrete_Floor/Cracked_Concrete_Floor_BaseColor.png", 1024)
    a = tint(desat(a, 0.85), (0.42, 0.40, 0.38))
    oil = sstep(0.6, 0.7, fbm(1024, 1024, 4, 3, 2401))
    a = a * (1 - 0.6 * oil[..., None]) + 0.02 * oil[..., None]
    save(sid, "cr_conc_a", a)
    save(sid, "cr_conc_n", load(BLINK + "Cracked_Concrete_Floor/Cracked_Concrete_Floor_Normal.png", 1024))
    r = load(BLINK + "Cracked_Concrete_Floor/Cracked_Concrete_Floor_Roughness.png", 1024, "L")
    save(sid, "cr_conc_r", np.clip(r * 0.9 - 0.3 * oil, 0.1, 1))
    # bar grating (RGBA, alpha MASK), 1 m tile
    S = 1024
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    bear = np.abs(((xx + 17) % 34) - 17)        # bearing bars along V every 34 px (3.3 cm)
    cross = np.abs(((yy + 51) % 102) - 51)     # cross rods every 102 px (10 cm)
    bb = sstep(3.6, 2.2, bear)
    cr = sstep(3.0, 1.6, cross)
    solid = np.maximum(bb, cr)
    n = fbm(S, S, 16, 3, 2501)
    col = np.ones((S, S, 3), np.float32) * np.array([0.22, 0.225, 0.23]) * (0.8 + 0.4 * n)[..., None]
    rust = sstep(0.65, 0.75, fbm(S, S, 8, 3, 2502))
    col = col * (1 - rust[..., None]) + np.array([0.26, 0.12, 0.05]) * rust[..., None]
    rgba = np.concatenate([col, solid[..., None]], -1)
    save(sid, "cr_grate_a", rgba)
    hgt = np.maximum(bb * (1 - (bear / 3.6) ** 2), cr * 0.8 * (1 - (cross / 3.0) ** 2))
    save(sid, "cr_grate_n", normal_from_height(hgt, 5.0))
    # CRT plastic housings: 2-colour atlas (left beige, right graphite), speckle + dust
    S = 512
    n = fbm(S, S, 48, 2, 2601)
    dust = fbm(S, S, 6, 3, 2602)
    col = np.zeros((S, S, 3), np.float32)
    col[:, :S // 2] = np.array([0.56, 0.52, 0.44])
    col[:, S // 2:] = np.array([0.10, 0.10, 0.11])
    col *= (0.9 + 0.2 * n)[..., None]
    col = col * (1 - 0.3 * sstep(0.5, 0.85, dust)[..., None]) + np.array([0.25, 0.24, 0.22]) * 0.3 * sstep(0.5, 0.85, dust)[..., None]
    save(sid, "cr_plastic_a", col)
    save(sid, "cr_plastic_n", normal_from_height(fbm(S, S, 96, 2, 2603), 0.8))
    save(sid, "cr_plastic_r", np.clip(0.45 + 0.15 * n + 0.2 * sstep(0.5, 0.85, dust), 0, 1))
    # pipe paint atlas: 4 bands (green-grey, oxide red, cream, black), tileable in U
    S = 1024
    bands = [(0.16, 0.24, 0.2), (0.36, 0.08, 0.06), (0.62, 0.58, 0.46), (0.07, 0.07, 0.075)]
    cols, hs, rs = [], [], []
    for k, b in enumerate(bands):
        c_, h_, r_ = painted_metal(S, b, 2700 + k, chip=0.7)
        cols.append(c_[:S // 4])
        hs.append(h_[:S // 4])
        rs.append(r_[:S // 4])
    save(sid, "cr_pipe_a", np.concatenate(cols, 0))
    save(sid, "cr_pipe_n", normal_from_height(np.concatenate(hs, 0), 3.0))
    save(sid, "cr_pipe_r", np.concatenate(rs, 0))
    # structural painted steel (dark green-grey) + safety yellow + deep red lacquer (host desk), shared normal/rough
    col, hgt, rough = painted_metal(1024, (0.1, 0.12, 0.115), 2801)
    save(sid, "cr_steel_a", col)
    save(sid, "cr_steel_n", blend_normals(normal_from_height(hgt, 3.0), normal_from_height(fbm(1024, 1024, 64, 2, 2802), 1.2)))
    save(sid, "cr_steel_r", rough * 0.9)
    col, _, _ = painted_metal(1024, (0.62, 0.45, 0.04), 2803, chip=0.7)
    save(sid, "cr_yellow_a", col)
    S = 512
    n = fbm(S, S, 64, 3, 2804)
    scratch = sstep(0.62, 0.66, tnoise(S, S, 140, 2805, cells_y=6))
    col = np.ones((S, S, 3), np.float32) * np.array([0.22, 0.025, 0.03], np.float32) * (0.9 + 0.2 * n)[..., None]
    col = col * (1 - 0.35 * scratch[..., None]) + 0.12 * scratch[..., None]
    save(sid, "cr_lacquer_a", col)
    save(sid, "cr_lacquer_r", np.clip(0.18 + 0.1 * n + 0.3 * scratch, 0, 1))
    # brass fittings (ForgeFlow generated bronze_worn, original)
    save(sid, "cr_brass_a", load(GEN + "bronze_worn_albedo.webp", 512))
    save(sid, "cr_brass_n", load(GEN + "bronze_worn_normal.webp", 512))
    save(sid, "cr_brass_r", load(GEN + "bronze_worn_rough.webp", 512, "L"))
    # JP meters atlas (fuse boxes / meters on the walls)
    save(sid, "cr_meters_a", tint(load(JPT + "Environment/JP_Meters/JP_Meters_A.tga", 1024), (0.75, 0.75, 0.75)))
    save(sid, "cr_meters_n", load(JPT + "Environment/JP_Meters/JP_Meters_N.tga", 1024))
    save(sid, "cr_meters_r", rough_from_ms(JPT + "Environment/JP_Meters/JP_Meters_MS.tga", 1024, 0.6))
    gen_control_room_art(sid)
    gen_control_ring_art(sid)


def crt_finish(tile, seed, tintc=(1.0, 1.0, 1.0)):
    """scanlines + phosphor tint + vignette on a 256 px CRT tile (HxWx3 floats)"""
    h, w = tile.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    scan = 0.78 + 0.22 * (np.sin(yy * math.pi / 2.0) ** 2)
    r = np.hypot((xx - w / 2) / (w / 2), (yy - h / 2) / (h / 2))
    vig = np.clip(1.15 - 0.5 * r ** 2.2, 0, 1)
    noise = 0.94 + 0.12 * np.random.default_rng(seed).random((h, w)).astype(np.float32)
    out = tile * (scan * vig * noise)[..., None] * np.array(tintc, np.float32)
    return np.clip(out, 0, 1)


def figure(d, x, y, s, pose, fill):
    """chunky comic fighter silhouette (thick round-capped limbs) at feet (x, y), height s px"""
    lw = max(3, int(s * 0.12))
    hip = (x, y - s * 0.48)
    neck = (x + pose.get("lean", 0) * s, y - s * 0.82)
    head = (neck[0] + pose.get("lean", 0) * s * 0.3, y - s * 0.93)
    def ln(a, b, wd=lw):
        d.line([a, b], fill=fill, width=wd)
        r = wd / 2
        d.ellipse((b[0] - r, b[1] - r, b[0] + r, b[1] + r), fill=fill)
        d.ellipse((a[0] - r, a[1] - r, a[0] + r, a[1] + r), fill=fill)
    ln(hip, neck, int(lw * 1.5))
    hr = s * 0.085
    d.ellipse((head[0] - hr, head[1] - hr, head[0] + hr, head[1] + hr), fill=fill)
    for (kx, ky, fx, fy) in pose["legs"]:
        k = (hip[0] + kx * s, hip[1] + ky * s)
        ln(hip, k)
        ln(k, (hip[0] + fx * s, hip[1] + fy * s))
    for (ex, ey, hx, hy) in pose["arms"]:
        e = (neck[0] + ex * s, neck[1] + ey * s)
        ln(neck, e)
        ln(e, (neck[0] + hx * s, neck[1] + hy * s))


PUNCH = {"lean": 0.06, "legs": [(0.12, 0.24, 0.22, 0.48), (-0.08, 0.25, -0.2, 0.48)],
         "arms": [(0.2, 0.05, 0.42, 0.0), (0.08, 0.14, 0.14, 0.02)]}
GUARD = {"lean": -0.03, "legs": [(0.1, 0.25, 0.16, 0.48), (-0.12, 0.24, -0.2, 0.48)],
         "arms": [(0.1, 0.14, 0.15, -0.02), (0.02, 0.16, 0.08, 0.0)]}
KICK = {"lean": -0.08, "legs": [(0.25, 0.02, 0.5, -0.05), (-0.05, 0.25, -0.1, 0.48)],
        "arms": [(-0.15, 0.1, -0.25, 0.2), (0.1, 0.12, 0.2, 0.0)]}
FALL = {"lean": -0.35, "legs": [(0.2, 0.15, 0.4, 0.2), (0.15, 0.25, 0.35, 0.35)],
        "arms": [(-0.2, -0.1, -0.35, -0.2), (-0.1, -0.2, -0.1, -0.35)]}
CHEER = {"lean": 0.0, "legs": [(0.06, 0.25, 0.08, 0.48), (-0.06, 0.25, -0.08, 0.48)],
         "arms": [(0.12, -0.15, 0.16, -0.32), (-0.12, -0.15, -0.16, -0.32)]}


def gen_control_room_art(sid):
    # ---------------------------------------------------------- CRT screen atlas 1024 (4x4 tiles of 256)
    T = 256
    atlas = np.zeros((1024, 1024, 3), np.float32)
    tiles = []

    def new(bg):
        im = Image.new("RGB", (T, T), bg)
        return im, ImageDraw.Draw(im)
    # 0 color bars
    im, d = new((0, 0, 0))
    bars = [(192, 192, 192), (192, 192, 0), (0, 192, 192), (0, 192, 0), (192, 0, 192), (192, 0, 0), (0, 0, 192)]
    bw = T / 7
    for i, c in enumerate(bars):
        d.rectangle((i * bw, 0, (i + 1) * bw, T * 0.68), fill=c)
    for i, c in enumerate([(0, 0, 192), (19, 19, 19), (192, 0, 192), (19, 19, 19), (0, 192, 192), (19, 19, 19), (192, 192, 192)]):
        d.rectangle((i * bw, T * 0.68, (i + 1) * bw, T * 0.76), fill=c)
    d.rectangle((0, T * 0.76, T, T), fill=(16, 16, 16))
    d.rectangle((T * 0.2, T * 0.76, T * 0.45, T), fill=(235, 235, 235))
    text_center(d, (T * 0.72, T * 0.88), "CH 13", font("russo-one", 26), (230, 230, 230))
    tiles.append((im, (1.0, 1.0, 1.0)))
    # 1 LIVE fight A (two fighters, HUD bars)
    im, d = new((40, 16, 60))
    d.rectangle((0, T * 0.72, T, T), fill=(26, 30, 60))
    for i in range(0, T, 16):
        d.line([(i, T * 0.72), (T / 2 + (i - T / 2) * 2.2, T)], fill=(40, 46, 90), width=1)
    d.rectangle((10, 12, 110, 22), fill=(255, 208, 30))
    d.rectangle((146, 12, 246, 22), fill=(255, 208, 30))
    d.rectangle((118, 8, 138, 26), fill=(20, 20, 30))
    figure(d, 92, T * 0.86, 120, PUNCH, (12, 8, 16))
    figure(d, 170, T * 0.86, 124, GUARD, (12, 8, 16))
    d.polygon([(150, 118), (162, 104), (158, 122), (172, 116), (160, 130)], fill=(255, 230, 90))
    d.rectangle((10, T - 30, 58, T - 12), fill=(220, 30, 40))
    text_center(d, (34, T - 21), "LIVE", font("bebas-neue", 20), (255, 255, 255))
    tiles.append((im, (1.0, 0.96, 1.0)))
    # 2 K.O. frame
    im, d = new((255, 208, 30))
    starburst(d, T / 2, T / 2 - 10, 60, 120, 12, fill=(236, 38, 58))
    figure(d, 70, T * 0.9, 110, CHEER, (15, 8, 20))
    figure(d, 180, T * 0.9, 110, FALL, (15, 8, 20))
    text_center(d, (T / 2, T / 2 - 12), "K.O.", font("bungee", 60), (255, 244, 214), stroke=4, stroke_fill=(15, 8, 20))
    tiles.append((im, (1.0, 1.0, 1.0)))
    # 3 ratings graph
    im, d = new((6, 20, 12))
    for i in range(0, T, 32):
        d.line([(i, 0), (i, T)], fill=(18, 60, 30))
        d.line([(0, i), (T, i)], fill=(18, 60, 30))
    pts = [(x, T * 0.82 - (x / T) ** 1.7 * T * 0.62 - 10 * math.sin(x * 0.12)) for x in range(10, T - 10, 6)]
    d.line(pts, fill=(80, 255, 120), width=4)
    text_center(d, (T / 2, 24), "RATINGS", font("bebas-neue", 36), (80, 255, 120))
    text_center(d, (T - 50, T - 30), "+212%", font("russo-one", 24), (255, 230, 90))
    tiles.append((im, (0.9, 1.0, 0.92)))
    # 4 static
    rng = np.random.default_rng(4040)
    st = (rng.random((T, T)) * 255).astype(np.uint8)
    im = Image.fromarray(st, "L").convert("RGB")
    tiles.append((im, (0.9, 0.95, 1.0)))
    # 5 host silhouette (Ricky, mic-cane, spotlight)
    im, d = new((20, 8, 30))
    d.polygon([(T / 2 - 20, 0), (T / 2 + 20, 0), (T / 2 + 110, T), (T / 2 - 110, T)], fill=(90, 60, 120))
    d.ellipse((T / 2 - 90, T - 40, T / 2 + 90, T + 20), fill=(140, 110, 170))
    figure(d, T / 2, T - 16, 190, CHEER, (12, 6, 18))
    d.line([(T / 2 + 30, 60), (T / 2 + 60, T - 16)], fill=(230, 200, 90), width=5)
    d.ellipse((T / 2 + 22, 52, T / 2 + 40, 70), fill=(230, 200, 90))
    text_center(d, (T / 2, 22), "YOUR HOST", font("bebas-neue", 30), (255, 208, 30))
    tiles.append((im, (1.0, 0.95, 1.0)))
    # 6 PLEASE STAND BY
    im, d = new((20, 40, 110))
    d.ellipse((T / 2 - 70, 30, T / 2 + 70, 170), fill=(236, 38, 58))
    d.ellipse((T / 2 - 52, 48, T / 2 + 52, 152), fill=(20, 40, 110))
    text_center(d, (T / 2, 100), "13", font("russo-one", 70), (255, 244, 214))
    text_center(d, (T / 2, 200), "PLEASE STAND BY", font("bebas-neue", 34), (255, 244, 214))
    tiles.append((im, (1.0, 1.0, 1.0)))
    # 7 APPLAUSE
    im, d = new((60, 0, 0))
    d.rectangle((16, 80, T - 16, 176), fill=(230, 30, 30), outline=(255, 200, 200), width=4)
    text_center(d, (T / 2, 128), "APPLAUSE", font("bungee", 36), (255, 240, 220))
    tiles.append((im, (1.0, 1.0, 1.0)))
    # 8 big 13 ident
    im, d = new((10, 10, 14))
    text_center(d, (T / 2, T / 2), "13", font("russo-one", 180), (236, 38, 58), stroke=6, stroke_fill=(255, 208, 30))
    tiles.append((im, (1.0, 1.0, 1.0)))
    # 9 HIT PARADE logo
    im, d = new((30, 10, 50))
    starburst(d, T / 2, T / 2, 70, 118, 14, fill=(255, 208, 30), rot=0.1)
    text_center(d, (T / 2, T / 2 - 22), "HIT", font("bungee", 58), (236, 38, 58), stroke=4, stroke_fill=(15, 8, 20))
    text_center(d, (T / 2, T / 2 + 30), "PARADE", font("bungee", 42), (236, 38, 58), stroke=4, stroke_fill=(15, 8, 20))
    tiles.append((im, (1.0, 1.0, 1.0)))
    # 10 crowd silhouettes cheering
    im, d = new((60, 30, 80))
    d.rectangle((0, 0, T, 60), fill=(200, 120, 255))
    for i in range(9):
        figure(d, 14 + i * 29, T + 40, 150 + (i % 3) * 14, CHEER, (18, 10, 24))
    tiles.append((im, (1.0, 1.0, 1.0)))
    # 11 oscilloscope
    im, d = new((4, 16, 8))
    pts = [(x, T / 2 + 60 * math.sin(x * 0.07) * math.cos(x * 0.013)) for x in range(0, T, 2)]
    d.line(pts, fill=(120, 255, 150), width=3)
    tiles.append((im, (0.85, 1.0, 0.9)))
    # 12 ON AIR
    im, d = new((80, 0, 0))
    d.rounded_rectangle((20, 70, T - 20, 186), radius=14, fill=(240, 40, 40))
    text_center(d, (T / 2, 128), "ON AIR", font("bungee", 44), (255, 245, 235))
    tiles.append((im, (1.0, 1.0, 1.0)))
    # 13 timer 99
    im, d = new((0, 0, 0))
    text_center(d, (T / 2, T / 2 + 6), "99", font("russo-one", 150), (255, 208, 30))
    text_center(d, (T / 2, 30), "ROUND 3", font("bebas-neue", 34), (255, 255, 255))
    tiles.append((im, (1.0, 1.0, 1.0)))
    # 14 kick frame
    im, d = new((20, 60, 90))
    d.rectangle((0, T * 0.74, T, T), fill=(30, 26, 40))
    figure(d, 100, T * 0.9, 130, KICK, (10, 8, 14))
    figure(d, 186, T * 0.9, 126, GUARD, (10, 8, 14))
    starburst(d, 168, 130, 12, 30, 9, fill=(255, 240, 120))
    tiles.append((im, (1.0, 1.0, 1.0)))
    # 15 SEASON FINALE
    im, d = new((236, 38, 58))
    text_center(d, (T / 2, 96), "SEASON", font("bungee", 44), (255, 244, 214), stroke=3, stroke_fill=(15, 8, 20))
    text_center(d, (T / 2, 156), "FINALE", font("bungee", 50), (255, 208, 30), stroke=3, stroke_fill=(15, 8, 20))
    tiles.append((im, (1.0, 1.0, 1.0)))
    for k, (im, tc) in enumerate(tiles):
        t = np.asarray(im.convert("RGB")).astype(np.float32) / 255.0
        t = crt_finish(t, 5000 + k, tc)
        ox, oy = (k % 4) * T, (k // 4) * T
        atlas[oy:oy + T, ox:ox + T] = t
    save(sid, "cr_screens", atlas)

    # ---------------------------------------------------------- sign/trim atlas 1024
    S = 1024
    im = Image.new("RGB", (S, S), (24, 24, 26))
    d = ImageDraw.Draw(im)
    # [0..1024, 0..128] hazard stripes
    d.rectangle((0, 0, S, 127), fill=(18, 16, 14))
    for i in range(-4, 40):
        x0 = i * 64
        d.polygon([(x0, 0), (x0 + 32, 0), (x0 + 32 + 128, 127), (x0 + 128, 127)], fill=(245, 190, 20))
    # [0..1024, 128..384] desk logo panel HIT PARADE
    d.rectangle((0, 128, S, 383), fill=(16, 8, 22))
    for i in range(0, S, 22):
        d.line([(S / 2, 256), (i, 128)], fill=(46, 20, 60), width=3)
        d.line([(S / 2, 256), (i, 383)], fill=(46, 20, 60), width=3)
    starburst(d, 150, 256, 70, 118, 12, fill=(236, 38, 58), rot=0.2)
    text_center(d, (150, 256), "13", font("russo-one", 70), (255, 244, 214))
    text_center(d, (S / 2 + 118, 236), "HIT PARADE", font("bungee", 96), (255, 208, 30), stroke=7, stroke_fill=(120, 10, 20))
    text_center(d, (S / 2 + 118, 330), "WITH YOUR HOST RICKY MARQUEE", font("bebas-neue", 46), (255, 244, 214))
    for i in range(24):
        x = 20 + i * 42
        d.ellipse((x, 140, x + 14, 154), fill=(255, 230, 150))
        d.ellipse((x, 358, x + 14, 372), fill=(255, 230, 150))
    # [0..256, 384..512] ON AIR box face
    d.rectangle((0, 384, 255, 511), fill=(200, 20, 24))
    text_center(d, (128, 448), "ON AIR", font("bungee", 50), (255, 242, 230))
    # [256..512, 384..512] STAND BY (amber)
    d.rectangle((256, 384, 511, 511), fill=(200, 120, 10))
    text_center(d, (384, 448), "STAND BY", font("bungee", 36), (40, 20, 5))
    # [512..1024, 384..512] BOILER ROOM stencil plate
    d.rectangle((512, 384, 1023, 511), fill=(150, 146, 136))
    text_center(d, (768, 425), "BOILER ROOM B2", font("bungee", 46), (30, 28, 26))
    text_center(d, (768, 480), "AUTHORIZED CREW ONLY", font("bebas-neue", 40), (150, 20, 20))
    # [0..512, 512..768] DANGER HIGH PRESSURE
    d.rectangle((0, 512, 511, 767), fill=(245, 190, 20))
    d.rectangle((14, 526, 497, 753), outline=(18, 16, 14), width=10)
    text_center(d, (256, 600), "DANGER", font("bungee", 76), (18, 16, 14))
    text_center(d, (256, 690), "HIGH PRESSURE STEAM", font("bebas-neue", 52), (18, 16, 14))
    # [512..1024, 512..768] 4 gauge faces (128 px), 2x2 in a 256 block + fuse labels
    for k in range(4):
        gx, gy = 512 + (k % 2) * 128, 512 + (k // 2) * 128
        d.ellipse((gx + 4, gy + 4, gx + 124, gy + 124), fill=(236, 230, 214), outline=(30, 30, 30), width=5)
        for t_ in range(11):
            a = math.radians(225 - t_ * 27)
            r0, r1 = 46, 56
            d.line([(gx + 64 + r0 * math.cos(a), gy + 64 - r0 * math.sin(a)),
                    (gx + 64 + r1 * math.cos(a), gy + 64 - r1 * math.sin(a))], fill=(30, 30, 30), width=3)
        d.arc((gx + 14, gy + 14, gx + 114, gy + 114), start=-45, end=10, fill=(200, 20, 20), width=6)
        a = math.radians(225 - (60 + 70 * k))
        d.line([(gx + 64, gy + 64), (gx + 64 + 48 * math.cos(a), gy + 64 - 48 * math.sin(a))], fill=(180, 10, 10), width=4)
        d.ellipse((gx + 58, gy + 58, gx + 70, gy + 70), fill=(20, 20, 20))
    d.rectangle((768, 512, 1023, 767), fill=(40, 40, 44))
    for k in range(6):
        y = 530 + k * 38
        d.rectangle((784, y, 1008, y + 28), fill=(220, 214, 196))
        text_center(d, (896, y + 14), ["MAIN FEED", "CAM 1-4", "MONITOR WALL", "DESK", "BEACONS", "SPARE"][k],
                    font("bebas-neue", 26), (30, 28, 26))
    # [0..1024, 768..1024] beacon sweep gradient (amber) + red variant (for rotating beacon domes)
    grad = np.zeros((256, 1024, 3), np.float32)
    u = np.arange(512, dtype=np.float32) / 512
    sweep = np.exp(-((((u + 0.5) % 1.0) - 0.5) / 0.09) ** 2) * 1.0 + 0.18
    grad[:, :512] = (sweep[:, None] * np.array([1.0, 0.55, 0.08]))[None, :, :]
    grad[:, 512:] = (sweep[:, None] * np.array([1.0, 0.12, 0.08]))[None, :, :]
    arr = np.asarray(im).astype(np.float32) / 255.0
    arr[768:] = np.clip(grad, 0, 1)
    arr[:768] = grime_overlay(arr[:768], 2901, 0.18, streaks=False)
    save(sid, "cr_signs", arr)


# ================================================================ contact sheet (QA)
def sheet(sid):
    items = [(n, p) for (s, n, p) in WRITTEN if s == sid]
    cols = 6
    cw, ch = 256, 280
    rows = (len(items) + cols - 1) // cols
    im = Image.new("RGB", (cols * cw, rows * ch), (18, 16, 22))
    d = ImageDraw.Draw(im)
    for i, (n, p) in enumerate(items):
        t = Image.open(p).convert("RGBA")
        bg = Image.new("RGBA", t.size, (255, 0, 255, 255))
        bg.alpha_composite(t)
        t = bg.convert("RGB")
        t.thumbnail((cw - 8, ch - 32))
        x, y = (i % cols) * cw, (i // cols) * ch
        im.paste(t, (x + 4, y + 4))
        d.text((x + 6, y + ch - 24), n, fill=(230, 230, 230))
    os.makedirs(REP, exist_ok=True)
    p = os.path.join(REP, "%s_textures.png" % sid)
    im.save(p)
    print("sheet", p)


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    args = sys.argv[1:]
    which = args[0] if args else "all"
    if which in ("rooftop", "all"):
        gen_rooftop()
    if which in ("control_room", "all"):
        gen_control_room()
    if "--sheet" in args:
        for s in ("rooftop", "control_room"):
            if which in (s, "all"):
                sheet(s)
    print(json.dumps({"written": len(WRITTEN)}))


if __name__ == "__main__":
    main()
