"""HIT PARADE - stage 2 BUTCHER BLOCK, built headless in Blender (lane STAGES-A; 360-degree arena: lane STAGES3D-A).

CHANGED(STAGES3D-A) CONTRACT 35.6 / 35.11: a circular-feel OCTAGON fight floor (apothem 5.6 m, checker tile with a red
tile border) in the middle of a huge industrial show kitchen / meat locker. The ring boundary is a 1.0 m octagonal tiled
counter wall (stainless kick plate, white subway tile, red tile band, stainless bumper rail and countertop cap, stainless
corner posts) = the splat surface. A clear tiled floor with a yellow audience line runs to r 9.5 (the camera orbit zone);
from r 9.7 all the way round: the KITCHEN LINE on the far side of the start camera (180 deg: a curved run of brushed-steel
counters with red lacquer doors, two gas ranges with live burner flames, pots and stainless hoods, the end-grain BUTCHER
BLOCK island with a giant cleaver and a glazed ham, the lit cleaver-shaped show sign on the tiled wall behind), the
walk-in FREEZER door wall (270 deg, frosted porthole, icicles, knife strip) and the plastic strip-curtain MEAT LOCKER
doorway (90 deg, cold blue light, hams inside), and between them four raked studio-audience risers (black tiers, steel
noses, stainless rail and stepped end panels) under stainless meat rails hung with comic glazed hams, sausage links and
salami (no carcasses, no gore). Lights: a fixed pool of 8 that lights the pair from every camera angle.

Usage (run blender.exe directly so the log is visible; paths are resolved from this file):
  blender.exe --background --python art/stages/butcher_block.py -- [--no-export] [--no-render] [--contact]
        [--shots id,id|orbit] [--res 1920x1080] [--samples 48] [--no-fighters] [--no-tex] [--out stage|live]
Outputs (default --out stage = _harness/scratch/stages3d_out/, swap in with `python tools/merge_stages.py --install
butcher_block`): butcher_block.glb + butcher_block_env.hdr + butcher_block.stage.json (fragment);
_harness/_reports/stages/butcher_block_<shot>.png (proof renders) + butcher_block_orbit_sheet.png.
Sources: generated textures (art/stages/stagetex_a.py: tile, brushed steel, lacquer, ham/sausage/salami skins,
end-grain block, labels in the game's OFL fonts), Blink Boss_Floor_1 checker (Unity EULA, ENV_KIT set 2 pick),
Quaternius Fantasy Props FarmCrate (CC0), Poly Haven abandoned_factory_canteen_01 (CC0) for the IBL.
Axes: game coordinates via G(x, y, z) (see stagelib_a.py). ASCII only.
"""
import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.dont_write_bytecode = True   # no __pycache__ inside art/stages
import stagelib_a as L  # noqa: E402
from stagelib_a import G, gbox, cyl, tube, sphere, lathe, prism, label, obox, log, polar, annulus, place  # noqa: E402

SID = "butcher_block"
HDRI = L.PH_HDRI + "abandoned_factory_canteen_01/abandoned_factory_canteen_01_2k.hdr"
RA = 5.6            # ring apothem (inner face of the octagonal counter wall)
WT = 0.5            # wall thickness
WH = 1.0            # wall height (cap top; low enough that an orbit camera outside it still sees the feet)
CAM_SIDE = 0.0
SPAWN_AXIS = 90.0
WM = 10.2           # set-piece wall modules (freezer / locker) face plane |x|
TIER_R = [10.3 + 0.8 * k for k in range(6)]
TIER_Y = [0.3 + 0.4 * k for k in range(6)]
BAYS = [("risers_a", 212.0, 250.0, 2301), ("risers_b", 290.0, 356.0, 2302), ("risers_c", 4.0, 70.0, 2303),
        ("risers_d", 110.0, 148.0, 2304)]
ENC_R = 15.0        # enclosure (tiled hall wall) inner radius


def oct_kw():
    return dict(segs=8, a0=-22.5, a1=337.5, poly_apothem=True)


def spot(sid, az, color, inten):
    return {"id": sid, "type": "spot", "color": color, "intensity": inten, "distance": 26.0, "decay": 2,
            "position": [round(v, 3) for v in polar(11.5, az, 8.0)], "target": [0.0, 1.0, 0.0], "angleDeg": 27.0,
            "penumbra": 0.55}


# =============================================================== the stage definition (-> fragment -> stages.json)
S = {
    "id": SID,
    "name": "BUTCHER BLOCK",
    "status": "built",
    "glb": SID + ".glb",
    "source": "art/stages/butcher_block.py",
    "home": ["bruno", "boneyard", "freak"],
    "look": "octagonal checker-tile fight floor walled by a 1.0 m white-tile / red-band stainless counter wall, in the "
            "round inside a huge industrial show kitchen: a curved kitchen line with gas ranges (live flames, pots, "
            "hoods) and an end-grain butcher block with a giant cleaver under the lit cleaver show sign, a walk-in freezer "
            "door and a strip-curtain meat-locker doorway, studio audience risers all round under meat rails hung with "
            "comic hams, sausage links and salami",
    "floor": {"y": 0.0, "surface": "tile", "fightStrip": {"x": [-8.0, 8.0], "z": [-1.5, 1.5]},
              "extent": {"x": [-15.0, 15.0], "z": [-15.0, 15.0]},
              "note": "fightStrip = legacy 2.5D (CONTRACT 35.11.7); the fight floor is the ring octagon"},
    "walls": {
        "x": [-8.0, 8.0],
        "splat": [
            {"id": 0, "x": -8.0, "normal": [1, 0, 0], "z": [-3.0, 2.8], "heightM": 4.3, "surface": "white_tile",
             "dustColor": "#e6e1d6"},
            {"id": 1, "x": 8.0, "normal": [-1, 0, 0], "z": [-3.0, 2.8], "heightM": 4.3, "surface": "white_tile",
             "dustColor": "#e6e1d6"},
        ],
        "note": "LEGACY 2.5D (CONTRACT 35.11.7): kept until the sim / view stop reading walls.x; the 3D boundary is `ring`.",
    },
    "ring": L.ring_block("poly", RA, WH, WT, "white_tile", "#e6e1d6", sides=8, rot=0.0,
                         note="CONTRACT 35.11: octagon, radiusM = apothem (centre -> each side's inner tile face); side "
                              "k's outward normal at k*45 deg (side 0 faces the start camera, +Z); corners at 22.5 + "
                              "k*45 deg (stainless posts). Tile face 0.25-0.94 m, red band 0.62-0.80 m, cap 1.0 m."),
    "spawnAxisDeg": SPAWN_AXIS,
    "cameraSideDeg": CAM_SIDE,
    "cameraMaxM": 9.5,
    "spawn": L.spawn_block(SPAWN_AXIS, 2.4),
    "camera": L.camera_block_3d(SID, CAM_SIDE),
    "exposure": 1.0,
    "toneMapping": "neutral",
    "fog": {"color": "#161a22", "near": 16.0, "far": 55.0},
    "environment": {"hdr": SID + "_env.hdr", "intensity": 0.34, "background": False,
                    "src": "Poly Haven abandoned_factory_canteen_01_2k.hdr (CC0), downsampled to 512x256",
                    "backgroundColor": "#0c0e13"},
    "lights": [
        {"id": "key", "type": "directional", "color": "#fff0de", "intensity": 2.4,
         "position": [round(v, 3) for v in polar(9.0, 200.0, 14.0)], "target": [0.0, 1.0, 0.0], "castShadow": True,
         "shadow": {"mapSize": 1024, "bias": -0.0004, "normalBias": 0.03,
                    "camera": {"left": -9.0, "right": 9.0, "top": 9.0, "bottom": -9.0, "near": 1.0, "far": 40.0}}},
        # CHANGED(fix_ui_stage) (verifier: butcher_block ring-wall cap glare across the fighters): the rim came in at 30 deg
        # elevation and its grazing specular off the stainless cap sheeted over the frame whenever the orbit camera stood
        # outside the wall on the far side (measured: 12 % of the fighters' band over the bloom threshold, peak 5.7);
        # raised to ~51 deg it reflects below the frame (with the satin cap: 0 %, peak 0.9)
        {"id": "rim", "type": "directional", "color": "#a6d2ff", "intensity": 1.3,
         "position": [round(v, 3) for v in polar(7.0, 20.0, 9.5)], "target": [0.0, 1.2, 0.0], "castShadow": False},
        {"id": "fill", "type": "hemisphere", "sky": "#d6e4ff", "ground": "#5b4640", "intensity": 0.85},
        spot("spot_60", 60.0, "#fff4ea", 110.0),
        spot("spot_300", 300.0, "#fff4ea", 110.0),
        {"id": "stove", "type": "point", "color": "#ff9440", "intensity": 4.0, "distance": 6.0, "decay": 2,
         "position": [round(v, 3) for v in polar(10.0, 180.0, 1.4)], "flicker": {"amp": 0.25, "hz": 9.0}},
        {"id": "locker", "type": "point", "color": "#7cc8ff", "intensity": 5.0, "distance": 6.0, "decay": 2,
         "position": [WM + 1.3, 2.0, 0.0], "flicker": {"amp": 0.04, "hz": 11.0}},
        {"id": "freezer", "type": "point", "color": "#a8dcff", "intensity": 3.0, "distance": 5.0, "decay": 2,
         "position": [-(WM - 0.7), 2.6, 0.0]},
    ],
    "lightsNote": "FIXED pool (8): created once at stage load, never added/removed (shader programs stay warm). No lights "
                  "in the GLB. 360 rig (CONTRACT 35.6): high key from the kitchen side + cool rim from the opposite side "
                  "+ hemisphere fill + two riser spots (60 / 300 deg) aimed at the ring centre + practical stove / "
                  "locker / freezer glows; flicker = view-only intensity modulation.",
    "crowd": L.crowd_block("#dcd3cf", 0.58, [
        {"id": bid, "arcDeg": [a0, a1], "spacing": 0.62, "jitter": [0.12, 0.08], "seed": seed,
         "rows": [{"r": round(r, 3), "y": round(y, 3)} for r, y in zip(TIER_R, TIER_Y)]}
        for bid, a0, a1, seed in BAYS]),
    "music": "music_stage_butcher_block",
    "musicHint": "AUDIO lane maps the id (router: music_stage_<stageId> -> cue <stageId>)",
    "ambient": "amb_butcher_block",
    "ambientHint": "AUDIO 9.2 item 2 loop (freezer hum + drips) under the crowd bed; burner hiss near the ranges",
    "dressing": {
        "animated": [
            {"what": "gas burner flames", "nodes": "flame_range_l, flame_range_r",
             "how": "view-side flame_* scale.y flicker about each range's burner level (node origin), synced with "
                    "the stove light flicker"},
            {"what": "show-sign bulbs", "nodes": "marquee_bulbs", "how": "optional chase pattern on emissive intensity"},
            {"what": "crowd", "how": "instanced cards, vertex bob/sway, pose swaps by ratings mood"},
        ],
        "splatWallDust": "#e6e1d6",
    },
}
S["crowd"]["nodes"] = ("GLB empties crowd_<bay>_<row>_<i>: position = feet point, +Z = card facing (the ring centre), "
                       "uniform scale = card height; extras {bay,row,i,rand,angle}. Generated from the ARC bays below "
                       "(CONTRACT 35.11.6: rows along circles r about the ring centre, spacing along the arc, jitter = "
                       "[tangential, radial] half-ranges from mulberry32(seed)).")

# =============================================================== scene + materials
if L.arg("--fragment-only", False):      # re-emit the fragment from S (keeps the measured build stats)
    L.write_fragment(S)
    raise SystemExit(0)
L.init_scene("butcher")
L.run_texgen(SID)
gt = L.gtex


def fn_floor(p):
    import numpy as np
    out = p.copy()
    c = p[..., :3]
    lum = c[..., 0] * 0.3 + c[..., 1] * 0.59 + c[..., 2] * 0.11
    c = c * 0.55 + lum[..., None] * 0.45                       # calmer marble veins
    out[..., :3] = np.clip(0.085 + c * 0.50, 0, 1) * np.array([1.0, 0.985, 0.95], np.float32)
    return out


def fn_floor_r(p):
    import numpy as np
    out = p.copy()
    out[..., :3] = np.clip(0.55 + 0.38 * p[..., :3], 0, 1)
    return out


log("materials")
M_FLOOR = L.mat_pbr("bb_floor", L.prep(L.BLINK + "Boss_Floor_1/Boss_Floor_1_BaseColor.png", "bb_checker_a", 1024, fn=fn_floor),
                    L.prep(L.BLINK + "Boss_Floor_1/Boss_Floor_1_Normal.png", "bb_checker_n", 1024, True),
                    L.prep(L.BLINK + "Boss_Floor_1/Boss_Floor_1_Roughness.png", "bb_checker_r", 512, True, fn=fn_floor_r))
M_TILE = L.mat_pbr("bb_tile", gt("bb_tile_a"), gt("bb_tile_n", True), gt("bb_tile_r", True), nstrength=1.0)
M_BAND = L.mat_pbr("bb_tile_band", gt("bb_tile_band_a"), gt("bb_tile_n", True), gt("bb_tile_r", True))
M_STEEL = L.mat_pbr("bb_steel", gt("bb_steel_a"), gt("bb_steel_n", True), gt("bb_steel_r", True), metallic=1.0)
M_STEELD = L.mat_pbr("bb_steel_dark", gt("bb_steeld_a"), gt("bb_steeld_n", True), gt("bb_steeld_r", True), metallic=1.0)
# CHANGED(fix_ui_stage): the ring cap + corner posts are SATIN stainless (roughness map x1.85: mean 0.31 -> 0.58) - right in
# front of the orbit camera when it stands outside the wall, the polished cap mirrored the rim / key light across the frame
def fn_satin_r(p):
    import numpy as np
    out = p.copy()
    out[..., :3] = np.clip(p[..., :3] * 1.85, 0.0, 0.95)
    return out


M_STEELCAP = L.mat_pbr("bb_steel_cap", gt("bb_steel_a"), gt("bb_steel_n", True),
                       L.prep(os.path.join(L.TEXA, "bb_steel_r.png"), "bb_steelcap_r", 512, True, fn=fn_satin_r),
                       metallic=1.0)
M_RED = L.mat_pbr("bb_red_lacquer", gt("bb_red_a"), gt("bb_red_n", True), gt("bb_red_r", True))
M_BLACK = L.mat_pbr("bb_black", gt("bb_black_a"), gt("bb_black_n", True), gt("bb_black_r", True), metallic=0.2)
M_WALLP = L.mat_pbr("bb_wallpaint", gt("bb_wallpaint_a"), gt("bb_wallpaint_n", True), gt("bb_wallpaint_r", True))
M_HAM = L.mat_pbr("bb_ham", gt("bb_ham_a"), gt("bb_ham_n", True), gt("bb_ham_r", True), nstrength=1.0)
M_SAUS = L.mat_pbr("bb_sausage", gt("bb_sausage_a"), gt("bb_sausage_n", True), gt("bb_sausage_r", True))
M_SALAMI = L.mat_pbr("bb_salami", gt("bb_salami_a"), gt("bb_salami_n", True), gt("bb_salami_r", True))
M_BLOCK = L.mat_pbr("bb_endgrain", gt("bb_block_a"), gt("bb_block_n", True), gt("bb_block_r", True))
M_BONE = L.mat_pbr("bb_bone", color=(0.86, 0.80, 0.68, 1), normal=gt("bb_sausage_n", True), roughness=0.5,
                   nstrength=0.4)
M_CERAMIC = L.mat_pbr("bb_ceramic", color=(0.88, 0.88, 0.86, 1), normal=gt("bb_tile_n", True), roughness=0.18,
                      nstrength=0.15)
M_YELLOW = L.mat_pbr("bb_mustard", color=(0.95, 0.66, 0.04, 1), normal=gt("bb_red_n", True), roughness=0.3)
M_PVC = L.mat_pbr("bb_pvc_strip", color=(0.72, 0.88, 0.92, 1), roughness=0.12, alpha=0.34, double=True)
M_FROST = L.mat_pbr("bb_frost", color=(0.80, 0.90, 1.0, 1), roughness=0.35, emission=(0.45, 0.72, 1.0, 1),
                    estrength=0.6)
LAB = gt("bb_labels")
M_LABEL = L.mat_pbr("bb_labels", LAB, roughness=0.45, emission_tex=LAB, estrength=0.12)
M_SIGNLIT = L.mat_pbr("bb_sign_lit", LAB, roughness=0.4, emission_tex=LAB, estrength=0.8)
M_BULB = L.mat_pbr("bb_bulb", color=(1.0, 0.86, 0.62, 1), roughness=0.3, emission=(1.0, 0.8, 0.55, 1), estrength=1.6)
M_OVEN = L.mat_pbr("bb_oven_glass", color=(0.018, 0.014, 0.012, 1), roughness=0.08, emission=(1.0, 0.42, 0.10, 1),
                   estrength=0.09, normal=gt("bb_steel_n", True), nstrength=0.2)
M_FLAME = L.mat_pbr("bb_flame", color=(1.0, 0.45, 0.08, 1), roughness=1.0, emission=(1.0, 0.42, 0.06, 1), estrength=2.4,
                    double=True)
M_FLAMEB = L.mat_pbr("bb_flame_blue", color=(0.25, 0.45, 1.0, 1), roughness=1.0, emission=(0.2, 0.45, 1.0, 1),
                     estrength=2.6, double=True)

HERO = {"freezer door": [], "meat rail": [], "range + pots": [], "cleaver sign": [], "strip curtain": []}
BULBS = []


def H(key, *obs):
    for o in obs:
        if isinstance(o, (list, tuple)):
            HERO[key].extend(o)
        else:
            HERO[key].append(o)
    return obs[0] if len(obs) == 1 else obs


def arc_pts(rad, y, a0, a1, step_deg=3.0):
    n = max(2, int(abs(a1 - a0) / step_deg) + 1)
    return [polar(rad, a0 + (a1 - a0) * k / (n - 1), y) for k in range(n)]


def segs_for(a0, a1, deg=2.5):
    return max(4, int(round(abs(a1 - a0) / deg)))


def tangent(a, k=1.0):
    return (math.cos(math.radians(a)) * k, 0.0, -math.sin(math.radians(a)) * k)


# =============================================================== floor
log("floor")
gbox("floor_base", -16.0, 16.0, -0.2, 0.0, -16.0, 16.0, M_FLOOR, tile=2.4)
annulus("floor_border", RA - 0.5, RA + 0.02, 0.0, 0.0015, M_BAND, parts=("top",), tile=1.2, **oct_kw())
annulus("floor_line", 9.18, 9.3, 0.0, 0.0015, M_YELLOW, parts=("top",), tile=1.0, **oct_kw())
for k, (dx, dz) in enumerate(((2.6, -1.05), (-2.9, 1.7))):
    lathe("drain_ring_%d" % k, [(0.13, 0.0), (0.15, 0.004), (0.15, 0.008), (0.13, 0.01), (0.12, 0.006)], (dx, 0.0, dz),
          (0, 1, 0), M_STEELD, segs=28)
    cyl("drain_grate_%d" % k, (dx, 0.003, dz), (0, 1, 0), 0.12, 0.006, M_BLACK, sides=28)
    for j in range(5):
        gbox("drain_slot_%d_%d" % (k, j), dx - 0.08 + j * 0.04, dx - 0.065 + j * 0.04, 0.0055, 0.0065, dz - 0.08, dz + 0.08,
             M_BLACK)

# =============================================================== the ring: octagonal tiled counter wall (splat surface)
log("ring wall")
annulus("ring_kick", RA, RA + WT, 0.0, 0.25, M_STEELD, parts=("in", "out"), tile=1.2, **oct_kw())
annulus("ring_tile_lo", RA, RA + WT, 0.25, 0.62, M_TILE, parts=("in", "out"), tile=1.2, **oct_kw())
annulus("ring_band", RA, RA + WT, 0.62, 0.8, M_BAND, parts=("in", "out"), tile=1.2, **oct_kw())
annulus("ring_tile_hi", RA, RA + WT, 0.8, 0.94, M_TILE, parts=("in", "out"), tile=1.2, **oct_kw())
annulus("ring_cap", RA - 0.03, RA + WT + 0.03, 0.94, WH, M_STEELCAP, tile=1.2, **oct_kw())
CR = 1.0 / math.cos(math.radians(22.5))
rail_in = [polar((RA - 0.07) * CR, -22.5 + 45.0 * k, 0.55) for k in range(9)]
tube("ring_rail", rail_in, 0.028, M_STEEL, sides=10, caps=False)
for k in range(8):
    a = 45.0 * k
    for off in (-1.6, 0.0, 1.6):
        c = polar(RA - 0.035, a, 0.55)
        t = tangent(a, off)
        cyl("ring_rail_so_%d_%.1f" % (k, off), (c[0] + t[0], 0.55, c[2] + t[2]), polar(1.0, a, 0.0), 0.016, 0.07, M_STEEL,
            sides=8)
    ca = 22.5 + 45.0 * k                     # stainless corner posts (1.2 m, below the camera band)
    obox("ring_post_%d" % k, polar(RA * CR + 0.15, ca, 0.56), (0.36, 1.12, 0.36), ca, M_STEELCAP, tile=0.6, bevel=0.03)
    obox("ring_post_cap_%d" % k, polar(RA * CR + 0.15, ca, 1.135), (0.4, 0.03, 0.4), ca, M_STEELD, tile=0.4,
         bevel=0.01)


# =============================================================== set-piece wall runs (freezer 270 / locker 90)
def wall_run(s, z0, z1, y_hi=4.3, tag="", W=WM):
    """one vertical run of the tiled set wall at x = s*W between z0..z1 (kick plate, white tile, red band, cornice)"""
    xi, xo = s * W, s * (W + 0.5)
    parts = []
    parts.append(gbox("wall_kick_%d%s" % (s, tag), xi - s * 0.03, xo, 0.0, 0.32, z0, z1, M_STEELD, tile=1.2, bevel=0.01))
    parts.append(gbox("wall_tile_lo_%d%s" % (s, tag), xi, xo, 0.32, 1.25, z0, z1, M_TILE, tile=1.2))
    parts.append(gbox("wall_band_%d%s" % (s, tag), xi, xo, 1.25, 1.55, z0, z1, M_BAND, tile=1.2))
    parts.append(gbox("wall_tile_hi_%d%s" % (s, tag), xi, xo, 1.55, y_hi, z0, z1, M_TILE, tile=1.2))
    parts.append(gbox("wall_cornice_%d%s" % (s, tag), xi - s * 0.1, xo, y_hi, y_hi + 0.16, z0, z1, M_STEEL, tile=1.2,
                      bevel=0.012))
    parts.append(tube("wall_rail_%d%s" % (s, tag), [(xi - s * 0.07, 0.95, z0 + 0.05), (xi - s * 0.07, 0.95, z1 - 0.05)],
                      0.028, M_STEEL, sides=10))
    return parts


MZ = 3.6            # module half-length along z
for s in (-1, 1):   # stainless-clad columns at the module ends
    for pz in (-MZ - 0.3, MZ + 0.3):
        px = s * (WM + 0.3)
        gbox("pilaster_%d_%d" % (s, pz > 0), px - 0.35, px + 0.35, 0.35, 4.9, pz - 0.35, pz + 0.35, M_STEEL, tile=1.2,
             bevel=0.03)
        gbox("pilaster_base_%d_%d" % (s, pz > 0), px - 0.4, px + 0.4, 0.0, 0.35, pz - 0.4, pz + 0.4, M_STEELD, tile=1.2,
             bevel=0.02)
        gbox("pilaster_cap_%d_%d" % (s, pz > 0), px - 0.42, px + 0.42, 4.9, 5.08, pz - 0.42, pz + 0.42, M_STEELD,
             tile=1.2, bevel=0.02)

# ---------------------------------------------------------------- FREEZER wall (x = -WM, faces +X = the ring)
log("freezer door")
W = WM
wall_run(-1, -MZ, MZ)
ZC = 0.0
FZ0, FZ1, FH = ZC - 0.625, ZC + 0.625, 2.25
fd = []
fd.append(gbox("fz_jamb_a", -W, -W + 0.08, 0.0, FH + 0.15, FZ0 - 0.13, FZ0, M_STEELD, tile=1.0, bevel=0.01))
fd.append(gbox("fz_jamb_b", -W, -W + 0.08, 0.0, FH + 0.15, FZ1, FZ1 + 0.13, M_STEELD, tile=1.0, bevel=0.01))
fd.append(gbox("fz_header", -W, -W + 0.08, FH, FH + 0.15, FZ0 - 0.13, FZ1 + 0.13, M_STEELD, tile=1.0, bevel=0.01))
fd.append(gbox("fz_gasket", -W, -W + 0.1, 0.0, FH + 0.01, FZ0 - 0.005, FZ1 + 0.005, M_BLACK, tile=1.0))
fd.append(gbox("fz_slab", -W + 0.01, -W + 0.14, 0.02, FH - 0.01, FZ0 + 0.015, FZ1 - 0.015, M_STEEL, tile=1.2, bevel=0.022,
               segs=3))
fd.append(gbox("fz_kick", -W + 0.14, -W + 0.15, 0.05, 0.42, FZ0 + 0.06, FZ1 - 0.06, M_STEELD, tile=0.6, bevel=0.004))
for y in (0.95, 1.95):
    fd.append(gbox("fz_rib_%.2f" % y, -W + 0.14, -W + 0.152, y - 0.012, y + 0.012, FZ0 + 0.09, FZ1 - 0.09, M_STEEL,
                   tile=0.5, bevel=0.004))
for y in (0.45, 1.8):                    # hinges (hinge side = FZ0)
    fd.append(cyl("fz_hinge_barrel_%.1f" % y, (-W + 0.16, y, FZ0 - 0.03), (0, 1, 0), 0.034, 0.32, M_STEEL, sides=14,
                  bevel=0.006))
    fd.append(gbox("fz_hinge_leaf_%.1f" % y, -W + 0.14, -W + 0.17, y - 0.12, y + 0.12, FZ0 - 0.03, FZ0 + 0.36, M_STEEL,
                   tile=0.4, bevel=0.008))
    fd.append(gbox("fz_hinge_leaf2_%.1f" % y, -W + 0.07, -W + 0.1, y - 0.12, y + 0.12, FZ0 - 0.2, FZ0 - 0.03, M_STEEL,
                   tile=0.4, bevel=0.008))
    for k in range(3):
        fd.append(cyl("fz_bolt_%.1f_%d" % (y, k), (-W + 0.175, y - 0.08 + k * 0.08, FZ0 + 0.26), (1, 0, 0), 0.013, 0.012,
                      M_STEELD, sides=8))
fd.append(gbox("fz_latch_plate", -W + 0.14, -W + 0.17, 1.0, 1.3, FZ1 - 0.2, FZ1 - 0.06, M_STEEL, tile=0.3, bevel=0.01))
fd.append(tube("fz_latch_lever", [(-W + 0.17, 1.2, FZ1 - 0.13), (-W + 0.24, 1.2, FZ1 - 0.13), (-W + 0.26, 1.2, FZ1 - 0.2),
                                  (-W + 0.26, 1.18, FZ1 - 0.5)], 0.019, M_STEEL, sides=10))
fd.append(sphere("fz_latch_knob", (-W + 0.26, 1.18, FZ1 - 0.52), 0.035, M_BLACK, seg=12, rings=8))
fd.append(gbox("fz_keeper", -W + 0.08, -W + 0.2, 1.08, 1.26, FZ1 + 0.02, FZ1 + 0.11, M_STEEL, tile=0.3, bevel=0.01))
fd.append(lathe("fz_port_ring", [(0.15, 0.0), (0.2, 0.0), (0.215, 0.018), (0.205, 0.038), (0.155, 0.04)],
                (-W + 0.14, 1.62, ZC), (1, 0, 0), M_STEEL, segs=32))
fd.append(cyl("fz_port_glass", (-W + 0.155, 1.62, ZC), (1, 0, 0), 0.155, 0.01, M_FROST, sides=32))
for k in range(8):
    a = 2 * math.pi * k / 8
    fd.append(cyl("fz_port_bolt_%d" % k, (-W + 0.182, 1.62 + 0.18 * math.sin(a), ZC + 0.18 * math.cos(a)), (1, 0, 0),
                  0.011, 0.012, M_STEELD, sides=6))
fd.append(label("fz_sign", (-W + 0.01, FH + 0.4, ZC), 0.96, 0.24, (0, 256, 512, 384), (1024, 1024), M_LABEL, yaw_deg=90))
fd.append(gbox("fz_sign_back", -W, -W + 0.01, FH + 0.26, FH + 0.54, ZC - 0.5, ZC + 0.5, M_STEELD, tile=0.5))
fd.append(label("fz_stencil", (-W + 0.152, 0.72, ZC - 0.06), 0.74, 0.185, (512, 256, 1024, 384), (1024, 1024), M_LABEL,
                yaw_deg=90, lift=0.002))
fd.append(cyl("fz_dial_bezel", (-W + 0.02, 1.62, ZC - 1.25), (1, 0, 0), 0.135, 0.05, M_STEEL, sides=28, bevel=0.01))
fd.append(L.disc_label("fz_dial_face", (-W + 0.046, 1.62, ZC - 1.25), 0.118, (512, 384, 768, 640), (1024, 1024), M_LABEL,
                       yaw_deg=90, lift=0.001))
rng = L.mulberry32(77)
for k in range(9):
    z = FZ0 - 0.05 + (FZ1 - FZ0 + 0.1) * (k + 0.5) / 9
    ln = 0.05 + rng() * 0.1
    fd.append(cyl("fz_icicle_%d" % k, (-W + 0.06, FH - ln / 2, z), (0, 1, 0), 0.016, ln, M_FROST, sides=6, r2=0.0015))
H("freezer door", fd)
gbox("knife_strip", -W, -W + 0.03, 1.72, 1.8, 1.9, 3.1, M_STEELD, tile=0.5, bevel=0.006)
for k, z in enumerate((2.05, 2.35, 2.65, 2.95)):
    blade_h = 0.22 if k % 2 == 0 else 0.3
    prism("knife_blade_%d" % k, [(-0.03, 0.0), (0.03, 0.0), (0.03, -blade_h * 0.8), (0.0, -blade_h), (-0.03, -blade_h * 0.9)],
          0.004, M_STEEL, center_g=(-W + 0.035, 1.74, z), face_g=(1, 0, 0), up_g=(0, 1, 0), bevel=0.001, segs=1)
    gbox("knife_handle_%d" % k, -W + 0.025, -W + 0.05, 1.76, 1.9, z - 0.016, z + 0.016, M_BLACK, tile=0.2, bevel=0.006)

# ---------------------------------------------------------------- MEAT LOCKER doorway (x = +WM, faces -X)
log("strip curtain doorway")
DZ0, DZ1, DH = -0.8, 0.8, 2.55
wall_run(1, -MZ, DZ0, tag="a")
wall_run(1, DZ1, MZ, tag="b")
gbox("wall_lintel_1", W, W + 0.5, DH, 4.3, DZ0, DZ1, M_TILE, tile=1.2)
gbox("wall_lintel_cornice_1", W - 0.1, W + 0.5, 4.3, 4.46, DZ0, DZ1, M_STEEL, tile=1.2, bevel=0.012)
sc = []
sc.append(gbox("lk_jamb_a", W - 0.06, W + 0.5, 0.0, DH + 0.1, DZ0 - 0.1, DZ0, M_STEEL, tile=1.0, bevel=0.012))
sc.append(gbox("lk_jamb_b", W - 0.06, W + 0.5, 0.0, DH + 0.1, DZ1, DZ1 + 0.1, M_STEEL, tile=1.0, bevel=0.012))
sc.append(gbox("lk_header", W - 0.06, W + 0.5, DH, DH + 0.12, DZ0 - 0.1, DZ1 + 0.1, M_STEEL, tile=1.0, bevel=0.012))
sc.append(tube("lk_strip_rail", [(W + 0.06, DH - 0.03, DZ0), (W + 0.06, DH - 0.03, DZ1)], 0.02, M_STEEL, sides=8))
n_strips = 8
wst = (DZ1 - DZ0) / n_strips + 0.03
for k in range(n_strips):
    z = DZ0 + (k + 0.5) * (DZ1 - DZ0) / n_strips
    yaw = (rng() - 0.5) * 12.0
    sc.append(obox("lk_strip_%d" % k, (W + 0.07 + (k % 2) * 0.012, (DH - 0.05) / 2 + 0.02, z), (0.004, DH - 0.06, wst),
                   yaw, M_PVC, tile=1.0))
gbox("lk_floor", W, W + 2.6, -0.2, 0.001, DZ0 - 0.6, DZ1 + 0.6, M_FLOOR, tile=2.4)
gbox("lk_wall_back", W + 2.6, W + 2.8, 0.0, 3.0, DZ0 - 0.6, DZ1 + 0.6, M_TILE, tile=1.2)
gbox("lk_wall_a", W + 0.5, W + 2.6, 0.0, 3.0, DZ0 - 0.8, DZ0 - 0.6, M_TILE, tile=1.2)
gbox("lk_wall_b", W + 0.5, W + 2.6, 0.0, 3.0, DZ1 + 0.6, DZ1 + 0.8, M_TILE, tile=1.2)
gbox("lk_ceiling", W + 0.5, W + 2.8, 2.9, 3.0, DZ0 - 0.8, DZ1 + 0.8, M_WALLP, tile=2.0)
sc.append(label("lk_sign", (W - 0.01, DH + 0.42, 0.0), 1.12, 0.28, (0, 384, 512, 512), (1024, 1024), M_LABEL, yaw_deg=-90))
H("strip curtain", sc)
cyl("clock_bezel", (W - 0.03, 3.25, 2.3), (1, 0, 0), 0.3, 0.07, M_RED, sides=36, bevel=0.015)
L.disc_label("clock_face", (W - 0.068, 3.25, 2.3), 0.262, (768, 384, 1024, 640), (1024, 1024), M_LABEL, yaw_deg=-90,
             lift=0.001)

# =============================================================== meat: hams, sausage links, salami (procedural)
log("meat")
HAM_PROF = [(0.0, 0.0), (0.07, 0.008), (0.13, 0.035), (0.175, 0.085), (0.198, 0.15), (0.2, 0.22), (0.188, 0.3),
            (0.16, 0.38), (0.12, 0.45), (0.082, 0.505), (0.062, 0.54), (0.058, 0.55), (0.034, 0.552), (0.03, 0.62),
            (0.044, 0.635), (0.05, 0.665), (0.036, 0.695), (0.0, 0.705)]
HAM_MATS = [0] * 10 + [1] * 7


def ham(name, top_g, yaw=0.0, lying=False, scale=1.0):
    """comic glazed ham: lathe body (netting texture) + bone knob; hangs bone-up from top_g (or lies along +X)"""
    prof = [(r * scale, h * scale) for (r, h) in HAM_PROF]
    if lying:
        ob = lathe(name, prof, (top_g[0] + 0.705 * scale, top_g[1] + 0.19 * scale, top_g[2]), (-1, 0, 0), [M_HAM, M_BONE],
                   segs=20, mats_by_ring=HAM_MATS)
    else:
        ob = lathe(name, prof, (top_g[0], top_g[1] - 0.705 * scale, top_g[2]), (0, 1, 0), [M_HAM, M_BONE], segs=20,
                   mats_by_ring=HAM_MATS)
    from mathutils import Matrix, Vector
    piv = G(*top_g)
    ob.data.transform(Matrix.Translation(piv) @ Matrix.Rotation(yaw, 4, "Z") @ Matrix.Scale(0.86, 4, Vector((1, 0, 0)))
                      @ Matrix.Translation(-piv))
    return ob


def s_hook(name, x, yr, z, mat=None):
    """S-hook hanging from a rail at height yr; returns (object, hook-bottom y)"""
    r = 0.042
    pts = []
    for k in range(10):
        a = math.radians(-35 + 215 * k / 9)
        pts.append((x + r * math.cos(a), yr + r * math.sin(a), z))
    yb = yr - 0.15
    pts.append((x - r, yr - 0.07, z))
    for k in range(10):
        a = math.radians(180 + 215 * k / 9)
        pts.append((x + r * math.cos(a), yb + r * math.sin(a), z))
    return tube(name, pts, 0.0075, mat or M_STEEL, sides=6), yb - r


def trolley(name, x, yr, z):
    a = cyl(name + "_wheel", (x, yr + 0.035, z), (0, 0, 1), 0.03, 0.05, M_STEELD, sides=12)
    b = gbox(name + "_plate", x - 0.02, x + 0.02, yr - 0.02, yr + 0.07, z - 0.035, z + 0.035, M_STEELD, tile=0.2, bevel=0.004)
    return [a, b]


def sausage_capsule(prof_len, r):
    return [(0.0, 0.0), (r * 0.62, prof_len * 0.02), (r * 0.94, prof_len * 0.12), (r, prof_len * 0.3), (r, prof_len * 0.7),
            (r * 0.94, prof_len * 0.88), (r * 0.62, prof_len * 0.98), (0.0, prof_len)]


def sausage_links(name, a_g, b_g, sag, n=12, r=0.03):
    """a draped chain of links between two hook bottoms (parabola), each link a lathe capsule along the tangent"""
    obs = []
    pts = []
    N = 200
    for i in range(N + 1):
        t = i / N
        pts.append((a_g[0] + (b_g[0] - a_g[0]) * t, a_g[1] + (b_g[1] - a_g[1]) * t - sag * 4 * t * (1 - t),
                    a_g[2] + (b_g[2] - a_g[2]) * t))
    lens = [0.0]
    for i in range(1, len(pts)):
        lens.append(lens[-1] + math.dist(pts[i], pts[i - 1]))
    total = lens[-1]
    link = total / n

    def at(sv):
        for i in range(1, len(lens)):
            if lens[i] >= sv:
                f = (sv - lens[i - 1]) / max(1e-9, lens[i] - lens[i - 1])
                return tuple(pts[i - 1][k] + (pts[i][k] - pts[i - 1][k]) * f for k in range(3))
        return pts[-1]
    for k in range(n):
        p0 = at(k * link + 0.006)
        p1 = at((k + 1) * link - 0.006)
        ln = math.dist(p0, p1)
        axis = tuple((p1[i] - p0[i]) / ln for i in range(3))
        obs.append(lathe("%s_%d" % (name, k), sausage_capsule(ln, r * (0.93 + 0.14 * ((k * 37) % 7) / 7)), p0, axis, M_SAUS,
                         segs=10, cap=False))
    return obs


def salami(name, top_g, length=0.42, r=0.045):
    return lathe(name, sausage_capsule(length, r), (top_g[0], top_g[1] - length, top_g[2]), (0, 1, 0), M_SALAMI, segs=12,
                 cap=False)


def twine(name, a_g, b_g):
    return tube(name, [a_g, b_g], 0.004, M_BONE, sides=4, caps=False)


def meat_rail(tag, half, yr, hams_at, links_at, salami_at, supports, top):
    """one straight stainless meat rail along local x (-half..half) at z 0, built at the origin facing +Z; place() it"""
    z = 0.0
    obs = []
    obs.append(tube("rail_%s" % tag, [(-half, yr, z), (half, yr, z)], 0.03, M_STEEL, sides=10))
    for x in (-half, half):
        obs.append(sphere("rail_end_%s_%.1f" % (tag, x), (x, yr, z), 0.04, M_STEEL, seg=10, rings=6))
    for x in supports:
        obs.append(tube("rail_rod_%s_%.1f" % (tag, x), [(x, yr + 0.03, z), (x, top, z)], 0.016, M_STEELD, sides=6))
        obs.append(gbox("rail_bracket_%s_%.1f" % (tag, x), x - 0.05, x + 0.05, yr + 0.02, yr + 0.1, z - 0.04, z + 0.04,
                        M_STEELD, tile=0.2, bevel=0.006))
    for i, (x, yaw, dy) in enumerate(hams_at):
        obs += trolley("trol_%s_h%d" % (tag, i), x, yr, z)
        hk, yb = s_hook("hook_%s_h%d" % (tag, i), x, yr - 0.07, z)
        obs.append(hk)
        top_y = yb - 0.05 - dy
        obs.append(twine("twine_%s_h%d" % (tag, i), (x, yb + 0.01, z), (x, top_y, z)))
        obs.append(ham("ham_%s_%d" % (tag, i), (x, top_y, z), yaw=yaw))
    for i, (xa, xb, sag) in enumerate(links_at):
        ends = []
        for j, x in enumerate((xa, xb)):
            obs += trolley("trol_%s_l%d_%d" % (tag, i, j), x, yr, z)
            hk, yb = s_hook("hook_%s_l%d_%d" % (tag, i, j), x, yr - 0.07, z)
            obs.append(hk)
            ends.append((x, yb, z))
        obs += sausage_links("links_%s_%d" % (tag, i), ends[0], ends[1], sag, n=max(8, int(abs(xb - xa) / 0.13)))
    for i, x in enumerate(salami_at):
        obs += trolley("trol_%s_s%d" % (tag, i), x, yr, z)
        hk, yb = s_hook("hook_%s_s%d" % (tag, i), x, yr - 0.07, z)
        obs.append(hk)
        for j, (dx, dz, dl) in enumerate(((-0.06, 0.02, 0.05), (0.06, -0.02, 0.12), (0.0, 0.05, 0.2))):
            obs.append(twine("twine_%s_s%d_%d" % (tag, i, j), (x, yb + 0.01, z), (x + dx, yb - dl, z + dz)))
            obs.append(salami("salami_%s_%d_%d" % (tag, i, j), (x + dx, yb - dl, z + dz), length=0.36 + 0.06 * j))
    return obs


def rail_arc(tag, rad, yr, a0, a1, nseg, top, pattern, seed):
    """a polygonal run of straight meat rails along an arc (chord segments), each hung with a pattern of meat"""
    rr = L.mulberry32(seed)
    out = []
    step = (a1 - a0) / nseg
    for k in range(nseg):
        am = a0 + step * (k + 0.5)
        half = rad * math.sin(math.radians(abs(step) / 2)) - 0.08
        p = pattern[k % len(pattern)]
        hams_at, links_at, salami_at = [], [], []
        for (kind, u) in p:
            x = u * half
            if kind == "h":
                hams_at.append((x, (rr() - 0.5) * 1.2, rr() * 0.07))
            elif kind == "l":
                links_at.append((x, x + 0.33 * half, 0.28 + rr() * 0.1))
            else:
                salami_at.append(x)
        obs = meat_rail("%s_%d" % (tag, k), half, yr, hams_at, links_at, salami_at, [-half * 0.7, half * 0.7], top)
        place(obs, polar(rad * math.cos(math.radians(abs(step) / 2)), am, 0.0), (am + 180.0) % 360.0)
        out += obs
    return out


# =============================================================== the kitchen line (148..212 deg, front r 10.35)
log("kitchen line")
KR = 10.35                # counter front radius
ZF, ZB = 0.375, -0.375    # module local front / back (module centre at r KR + 0.375)
TOP = 0.88
KMODS = [("cab", 1.3), ("range_r", 1.8), ("cab", 1.0), ("block", 3.3), ("cab", 1.0), ("range_l", 1.8), ("cab", 1.3)]
# (angles grow from 148 deg = screen RIGHT of the start camera to 212 deg = screen left)
KSPAN = sum(w for _, w in KMODS)
KA0 = 180.0 - math.degrees(KSPAN / KR) / 2


def cab_arc(tag, a0, a1):
    """curved cabinet run between angles (front at KR): toe kick, steel body, red doors + bar handles, steel top"""
    sg = max(3, segs_for(a0, a1, 2.0))
    annulus("cab_toe_%s" % tag, KR + 0.07, KR + 0.7, 0.0, 0.12, M_BLACK, segs=sg, a0=a0, a1=a1, tile=1.0)
    annulus("cab_body_%s" % tag, KR, KR + 0.75, 0.12, TOP, M_STEEL, segs=sg, a0=a0, a1=a1, tile=1.2, parts=("in", "top", "ends"))
    annulus("top_%s" % tag, KR - 0.05, KR + 0.8, TOP, TOP + 0.055, M_STEEL, segs=sg, a0=a0, a1=a1, tile=1.2)
    arc = math.radians(a1 - a0) * KR
    n = max(1, int(round(arc / 0.6)))
    for k in range(n):
        am = a0 + (a1 - a0) * (k + 0.5) / n
        w = arc / n
        c = polar(KR - 0.012, am, (0.17 + TOP - 0.06) / 2)
        obox("cab_door_%s_%d" % (tag, k), c, (w - 0.05, TOP - 0.06 - 0.17, 0.02), am, M_RED, tile=0.8, bevel=0.009)
        hc = polar(KR - 0.05, am, TOP - 0.13)
        t = tangent(am, w * 0.25)
        tube("cab_handle_%s_%d" % (tag, k), [tuple(hc[i] - t[i] for i in range(3)), tuple(hc[i] + t[i] for i in range(3))],
             0.009, M_STEEL, sides=8)


def pot(name, c, r, h, lid=True, handles="loops", mat=None):
    mat = mat or M_STEEL
    obs = [lathe(name, [(0.0, 0.0), (r * 0.9, 0.0), (r, 0.012), (r, h), (r + 0.008, h + 0.006), (r - 0.006, h + 0.008),
                        (r - 0.006, 0.02), (0.0, 0.02)], c, (0, 1, 0), mat, segs=24, cap=False)]
    if lid:
        obs.append(lathe(name + "_lid", [(r + 0.006, 0.0), (r * 0.8, 0.02), (r * 0.4, 0.035), (0.03, 0.04), (0.0, 0.04)],
                         (c[0], c[1] + h + 0.004, c[2]), (0, 1, 0), mat, segs=24))
        obs.append(lathe(name + "_knob", [(0.0, 0.0), (0.02, 0.0), (0.028, 0.02), (0.02, 0.035), (0.0, 0.035)],
                         (c[0], c[1] + h + 0.042, c[2]), (0, 1, 0), M_BLACK, segs=12))
    if handles == "loops":
        for s in (-1, 1):
            obs.append(tube(name + "_h%d" % s, [(c[0] + s * r, c[1] + h * 0.8, c[2] - 0.04),
                                                (c[0] + s * (r + 0.05), c[1] + h * 0.82, c[2] - 0.03),
                                                (c[0] + s * (r + 0.05), c[1] + h * 0.82, c[2] + 0.03),
                                                (c[0] + s * r, c[1] + h * 0.8, c[2] + 0.04)], 0.008, M_STEEL, sides=6))
    elif handles == "long":
        obs.append(tube(name + "_hl", [(c[0] + r, c[1] + h * 0.7, c[2]), (c[0] + r + 0.26, c[1] + h * 0.85, c[2])], 0.012,
                        M_BLACK, sides=8))
    return obs


def burner_flames(bc, bare, rot):
    blue, orange = [], []
    for k in range(10):
        a = 2 * math.pi * k / 10 + rot
        p = (bc[0] + 0.062 * math.cos(a), bc[1], bc[2] + 0.062 * math.sin(a))
        blue += L.flame_blades(p, h=0.05, r=0.014, blades=2, rot=a)
    if bare:
        for k in range(6):
            a = 2 * math.pi * k / 6 + rot + 0.3
            p = (bc[0] + 0.045 * math.cos(a), bc[1] + 0.02, bc[2] + 0.045 * math.sin(a))
            orange += L.flame_blades(p, h=0.13 + 0.07 * ((k * 5) % 3) / 2, r=0.028, blades=2, rot=a * 1.7)
    return blue, orange


def gas_range(side, pots):
    """one 1.8 m range module at the local origin facing +Z (front z ZF); returns (static objects, flame node)"""
    tag = "rng%d" % side
    xc = 0.0
    rg = []
    rg.append(gbox("rng_toe_%s" % tag, xc - 0.9, xc + 0.9, 0.0, 0.12, ZF - 0.07, ZB + 0.05, M_BLACK, tile=1.0))
    rg.append(gbox("rng_body_%s" % tag, xc - 0.9, xc + 0.9, 0.12, TOP, ZF, ZB, M_STEEL, tile=1.2, bevel=0.008))
    rg.append(gbox("rng_ovendoor_%s" % tag, xc - 0.78, xc + 0.78, 0.18, 0.64, ZF + 0.0, ZF + 0.03, M_STEEL, tile=0.9,
                   bevel=0.014, segs=2))
    rg.append(gbox("rng_window_%s" % tag, xc - 0.52, xc + 0.52, 0.29, 0.55, ZF + 0.03, ZF + 0.034, M_OVEN, tile=0.6,
                   bevel=0.01))
    for ry in (0.36, 0.47):
        rg.append(gbox("rng_rack_%s_%.2f" % (tag, ry), xc - 0.5, xc + 0.5, ry - 0.007, ry + 0.007, ZF + 0.034, ZF + 0.036,
                       M_STEELD, tile=0.5))
    rg.append(tube("rng_ovenhandle_%s" % tag, [(xc - 0.62, 0.62, ZF + 0.03), (xc - 0.62, 0.62, ZF + 0.075),
                                              (xc + 0.62, 0.62, ZF + 0.075), (xc + 0.62, 0.62, ZF + 0.03)], 0.013,
                   M_STEEL, sides=10))
    rg.append(gbox("rng_panel_%s" % tag, xc - 0.9, xc + 0.9, 0.7, TOP, ZF + 0.0, ZF + 0.02, M_STEELD, tile=0.9, bevel=0.006))
    for k in range(5):
        kx = xc - 0.64 + 0.32 * k
        rg.append(lathe("rng_knob_%s_%d" % (tag, k), [(0.0, 0.0), (0.036, 0.0), (0.04, 0.012), (0.034, 0.04), (0.0, 0.042)],
                        (kx, 0.79, ZF + 0.02), (0, 0, 1), M_BLACK, segs=14))
        rg.append(gbox("rng_knob_mark_%s_%d" % (tag, k), kx - 0.004, kx + 0.004, 0.79, 0.823, ZF + 0.062, ZF + 0.064,
                       M_STEEL, tile=0.1))
    rg.append(label("rng_hot_%s" % tag, (xc, 0.06, ZF - 0.069), 0.4, 0.1, (0, 512, 512, 640), (1024, 1024), M_LABEL))
    rg.append(gbox("rng_top_%s" % tag, xc - 0.9, xc + 0.9, TOP, TOP + 0.05, ZF + 0.11, ZB - 0.06, M_BLACK, tile=1.0,
                   bevel=0.008))
    yg = TOP + 0.085
    for gz in (ZF + 0.02, 0.0, ZB):
        rg.append(tube("rng_grate_x_%s_%.2f" % (tag, gz), [(xc - 0.84, yg, gz), (xc + 0.84, yg, gz)], 0.011, M_BLACK, sides=6))
    for gx in (-0.84, -0.42, 0.0, 0.42, 0.84):
        rg.append(tube("rng_grate_z_%s_%.2f" % (tag, gx), [(xc + gx, yg, ZF + 0.02), (xc + gx, yg, ZB)], 0.011, M_BLACK, sides=6))
        for gz in (ZF + 0.02, ZB):
            rg.append(cyl("rng_grate_foot_%s_%.2f_%.2f" % (tag, gx, gz), (xc + gx, TOP + 0.066, gz), (0, 1, 0), 0.012, 0.04,
                          M_BLACK, sides=6))
    blue, orange = [], []
    for bi, (bx, bz) in enumerate(((-0.42, 0.185), (0.42, 0.185), (-0.42, -0.185), (0.42, -0.185))):
        bc = (xc + bx, TOP + 0.075, bz)
        rg.append(lathe("rng_burner_%s_%d" % (tag, bi), [(0.0, 0.0), (0.075, 0.0), (0.08, 0.012), (0.068, 0.025), (0.05, 0.03),
                                                         (0.0, 0.032)], (bc[0], TOP + 0.05, bc[2]), (0, 1, 0), M_BLACK, segs=18))
        b, o = burner_flames(bc, bi not in pots, bi * 0.7 + side)
        blue += b
        orange += o
        if bi in pots:
            kind = pots[bi]
            base = (bc[0], yg + 0.012, bc[2])
            if kind == "stock":
                rg += pot("pot_%s_%d" % (tag, bi), base, 0.17, 0.3)
            elif kind == "sauce":
                rg += pot("sauce_%s_%d" % (tag, bi), base, 0.12, 0.13, lid=False, handles="long")
            elif kind == "pan":
                rg.append(lathe("pan_%s_%d" % (tag, bi), [(0.0, 0.0), (0.13, 0.0), (0.155, 0.012), (0.175, 0.05), (0.18, 0.056),
                                                           (0.17, 0.052), (0.148, 0.016), (0.0, 0.014)], base, (0, 1, 0), M_BLACK,
                                segs=24, cap=False))
                rg.append(tube("pan_handle_%s_%d" % (tag, bi), [(base[0] - 0.17, base[1] + 0.045, base[2]),
                                                                (base[0] - 0.45, base[1] + 0.09, base[2] + 0.02)], 0.013,
                               M_BLACK, sides=8))
                for sk in range(4):
                    a0_ = (base[0] - 0.09 + sk * 0.055, base[1] + 0.035, base[2] - 0.07)
                    rg.append(lathe("pan_saus_%s_%d_%d" % (tag, bi, sk), sausage_capsule(0.15, 0.024), a0_, (0.12, 0.0, 1.0),
                                    M_SAUS, segs=10, cap=False))
    # stainless canopy hood over the range (top 2.95 m, r > 9.5: outside the camera orbit)
    rg.append(prism("rng_hood_%s" % tag, [(-0.95, 0.0), (0.95, 0.0), (0.7, 0.55), (-0.7, 0.55)], 0.9, M_STEEL,
                    center_g=(xc, 2.2, ZB + 0.45), face_g=(0, 0, 1), up_g=(0, 1, 0), bevel=0.012, segs=1))
    rg.append(gbox("rng_hood_lip_%s" % tag, xc - 0.95, xc + 0.95, 2.14, 2.2, ZB, ZB + 0.9, M_STEELD, tile=0.8, bevel=0.006))
    rg.append(gbox("rng_duct_%s" % tag, xc - 0.28, xc + 0.28, 2.75, 7.5, ZB + 0.17, ZB + 0.73, M_STEELD, tile=1.0, bevel=0.01))
    fb = L.quads_mesh("flameb_%s" % tag, blue, M_FLAMEB)
    fo = L.quads_mesh("flameo_%s" % tag, orange, M_FLAME) if orange else None
    fl = L.join_objs([fb] + ([fo] if fo else []), "flame_range_%s" % ("l" if side < 0 else "r"))
    L.reorigin(fl, (xc, TOP + 0.075, 0.0))
    L.ANIM[fl.name] = fl
    return rg, fl


def block_island():
    """the BUTCHER BLOCK island (3.3 m): black cabinet + show logo, thick end-grain top, giant cleaver, ham, knife block"""
    ob = []
    ob.append(gbox("blk_toe", -1.65, 1.65, 0.0, 0.12, ZF - 0.07, ZB + 0.05, M_BLACK, tile=1.0))
    ob.append(gbox("blk_body", -1.65, 1.65, 0.12, 0.86, ZF, ZB, M_BLACK, tile=1.2, bevel=0.01))
    for s in (-1, 1):
        ob.append(gbox("blk_corner_%d" % s, s * 1.65 - 0.05, s * 1.65 + 0.05, 0.0, 0.86, ZF - 0.03, ZF + 0.03, M_STEEL,
                       tile=0.5, bevel=0.01))
    ob.append(gbox("blk_logo_frame", -1.3, 1.3, 0.18, 0.82, ZF, ZF + 0.02, M_STEEL, tile=0.6, bevel=0.008))
    ob.append(label("blk_logo", (0.0, 0.5, ZF + 0.02), 2.44, 0.61, (0, 0, 1024, 256), (1024, 1024), M_LABEL))
    ob.append(gbox("blk_top", -1.68, 1.68, 0.86, 1.06, ZF + 0.14, ZB - 0.08, M_BLOCK, tile=0.64, bevel=0.022, segs=3))
    blade = [(-0.2, 0.0), (0.16, 0.0), (0.19, 0.03), (0.19, 0.24), (-0.17, 0.24), (-0.2, 0.2)]
    hole = [(0.13 + 0.022 * math.cos(2 * math.pi * k / 12), 0.2 + 0.022 * math.sin(2 * math.pi * k / 12)) for k in range(12)]
    ob.append(prism("cleaver_blade", blade, 0.012, M_STEEL, center_g=(0.9, 1.035, 0.005), face_g=(0.26, 0, 0.97),
                    up_g=(0, 1, 0), bevel=0.003, segs=1, holes=[list(reversed(hole))]))
    ob.append(obox("cleaver_handle", (0.9 + 0.3 * 0.97, 1.035 + 0.215, 0.005 - 0.3 * 0.26), (0.24, 0.042, 0.032), 15.0,
                   M_BLACK, tile=0.2, bevel=0.012))
    for k in range(3):
        ob.append(cyl("cleaver_rivet_%d" % k, (0.9 + (0.23 + k * 0.065) * 0.97, 1.25, 0.005 - (0.23 + k * 0.065) * 0.26 + 0.018),
                      (0.26, 0, 0.97), 0.009, 0.042, M_STEEL, sides=8))
    ob.append(gbox("board_ham", -1.2, -0.45, 1.06, 1.09, 0.205, -0.235, M_BLOCK, tile=0.5, bevel=0.01))
    ob.append(ham("ham_lying", (-1.2, 1.09, -0.015), lying=True, scale=0.9))
    ob.append(obox("knife_block", (1.35, 1.16, -0.155), (0.16, 0.2, 0.12), 0.0, M_BLOCK, tile=0.3, bevel=0.012))
    for k in range(4):
        ob.append(obox("knife_block_h%d" % k, (1.30 + (k % 2) * 0.1, 1.3 + (k // 2) * 0.03, -0.185 + (k // 2) * 0.06),
                       (0.028, 0.12, 0.022), 0.0, M_BLACK, tile=0.1, bevel=0.008))
    return ob


ka = KA0
rng_objs = []
for kind, w in KMODS:
    dang = math.degrees(w / KR)
    a0_, a1_ = ka, ka + dang
    am = (a0_ + a1_) / 2
    if kind == "cab":
        cab_arc("k%.0f" % am, a0_, a1_)
    else:
        if kind == "block":
            obs = block_island()
        else:
            side = -1 if kind == "range_l" else 1
            obs, fl = gas_range(side, {2: "stock", 0: "pan"} if side < 0 else {1: "sauce", 2: "stock"})
            obs = obs + [fl]
            if side < 0:
                rng_objs = obs
        place(obs, polar(KR + 0.375, am, 0.0), (am + 180.0) % 360.0)
    ka = a1_
H("range + pots", rng_objs)
KA1 = ka
# upstand / backsplash behind the line (tile, steel cap), floor-to-hood run of tile behind the ranges
annulus("backsplash", KR + 0.75, KR + 0.85, 0.0, 1.6, M_TILE, segs=segs_for(KA0, KA1, 2.0), a0=KA0, a1=KA1, tile=1.2,
        parts=("in", "top", "ends"))
annulus("backsplash_cap", KR + 0.72, KR + 0.88, 1.6, 1.64, M_STEEL, segs=segs_for(KA0, KA1, 2.0), a0=KA0, a1=KA1, tile=1.2)
# counter clutter: bowl, bottles, plates, boards, crates, big pots (on the curved tops)
TOPY = TOP + 0.055
lathe("bowl_l", [(0.0, 0.0), (0.08, 0.0), (0.15, 0.04), (0.19, 0.11), (0.2, 0.12), (0.185, 0.115), (0.14, 0.05),
                 (0.0, 0.01)], polar(KR + 0.4, KA0 + 3.0, TOPY), (0, 1, 0), M_STEEL, segs=24, cap=False)
for k, (a, m) in enumerate(((168.5, M_RED), (169.3, M_YELLOW), (190.8, M_YELLOW), (191.6, M_RED))):
    lathe("bottle_%d" % k, [(0.0, 0.0), (0.035, 0.0), (0.038, 0.01), (0.038, 0.17), (0.03, 0.2), (0.012, 0.23),
                            (0.004, 0.26), (0.0, 0.262)], polar(KR + 0.2 + 0.04 * (k % 2), a, TOPY), (0, 1, 0), m, segs=12)
for k in range(6):
    lathe("plate_%d" % k, [(0.0, 0.0), (0.09, 0.0), (0.13, 0.012), (0.135, 0.018), (0.125, 0.017), (0.085, 0.006),
                           (0.0, 0.006)], polar(KR + 0.38, KA1 - 3.2, TOPY + k * 0.019), (0, 1, 0), M_CERAMIC, segs=24, cap=False)
L.template("crate_carrot", L.QFP + "FarmCrate_Carrot.gltf")
L.template("crate_apple", L.QFP + "FarmCrate_Apple.gltf")
L.inst("crate_carrot", "crate_1", polar(KR + 0.4, KA0 + 1.1, TOPY), math.radians(KA0 + 1.1), 0.5)
L.inst("crate_apple", "crate_2", polar(KR + 0.4, KA1 - 1.2, TOPY), math.radians(KA1 - 1.2), 0.55)
pot("pot_big_l", polar(KR + 0.4, KA0 + 5.2, TOPY), 0.18, 0.32)
pot("pot_big_r", polar(KR + 0.4, KA1 - 5.4, TOPY), 0.15, 0.24)
L.canon_kit_images()
# meat rail over the line (y 3.2, hams hang to ~2.2 over the counters; clear of the hoods)
front = rail_arc("krail", 10.95, 3.25, KA0 + 1.0, KA1 - 1.0, 3, 5.6,
                 [[("h", -0.55), ("l", 0.05), ("s", 0.8)], [("h", -0.75), ("h", 0.75), ("s", 0.0)],
                  [("s", -0.8), ("l", -0.35), ("h", 0.55)]], 811)
H("meat rail", [o for o in front if o.name.startswith(("ham_krail_1_0", "hook_krail_1_h0", "twine_krail_1_h0",
                                                        "trol_krail_1_h0"))])

# =============================================================== audience risers (4 arc bays, 6 tiers)
log("risers")


def tier_profile():
    top = 0.45
    pts = [(TIER_R[0] - 0.5, 0.0), (TIER_R[-1] + 0.45, 0.0), (TIER_R[-1] + 0.45, TIER_Y[-1] + top)]
    for k in range(5, -1, -1):
        pts.append((TIER_R[k] - 0.4, TIER_Y[k] + top))
        if k > 0:
            pts.append((TIER_R[k] - 0.4, TIER_Y[k - 1] + top))
    pts.append((TIER_R[0] - 0.5, TIER_Y[0] + top))
    return pts


def end_panel(name, a, mat, thick=0.14):
    poly = [(-r, y) for (r, y) in tier_profile()]
    return prism(name, poly, thick, mat, center_g=(0.0, 0.0, 0.0), face_g=tangent(a), up_g=(0, 1, 0), bevel=0.01, segs=1)


for bid, a0, a1, seed in BAYS:
    sg = segs_for(a0, a1)
    for k in range(6):
        annulus("tier_%s_%d" % (bid, k), TIER_R[k] - 0.4, TIER_R[k] + 0.4, 0.0, TIER_Y[k], M_BLACK, segs=sg, a0=a0, a1=a1,
                tile=2.0, parts=("in", "top", "ends"))
        annulus("tier_nose_%s_%d" % (bid, k), TIER_R[k] - 0.42, TIER_R[k] - 0.38, TIER_Y[k] - 0.035, TIER_Y[k] + 0.004,
                M_STEELD, segs=sg, a0=a0, a1=a1, parts=("in", "top"), tile=1.2)
    for s_, a in ((0, a0), (1, a1)):
        end_panel("bay_end_%s_%d" % (bid, s_), a, M_STEEL)
    tube("bay_rail_%s" % bid, arc_pts(9.86, 1.0, a0 + 0.8, a1 - 0.8), 0.026, M_STEEL, sides=10)
    tube("bay_rail_lo_%s" % bid, arc_pts(9.86, 0.55, a0 + 0.8, a1 - 0.8), 0.018, M_STEEL, sides=8)
    n = max(2, int(math.radians(a1 - a0) * 9.86 / 1.6) + 1)
    for k in range(n):
        a = a0 + 0.8 + (a1 - a0 - 1.6) * k / (n - 1)
        tube("bay_post_%s_%d" % (bid, k), [polar(9.86, a, 0.0), polar(9.86, a, 1.0)], 0.022, M_STEEL, sides=8)
    # meat rails over the bay (y 5.0: hams at ~4-4.7 m, above the back rows' heads)
    nseg = max(2, int(round((a1 - a0) / 22.0)))
    rail_arc("brail_%s" % bid, 12.9, 5.0, a0 + 1.5, a1 - 1.5, nseg, 8.5,
             [[("h", -0.6), ("l", -0.15), ("h", 0.7)], [("s", -0.7), ("h", 0.0), ("l", 0.3)],
              [("h", -0.3), ("s", 0.5)]], seed)

# stair aisle at 0 deg (behind the start camera) + the second lit show sign over it
for k in range(12):
    r = TIER_R[0] - 0.3 + 0.4 * k
    y = min(TIER_Y[-1], 0.2 * (k + 1))
    obox("aisle_step_%d" % k, polar(r, 0.0, y / 2), (1.4, y, 0.4), 0.0, M_BLACK, tile=1.0)
    obox("aisle_nose_%d" % k, polar(r - 0.2, 0.0, y - 0.02), (1.4, 0.03, 0.02), 0.0, M_STEELD, tile=1.0)

# =============================================================== hall enclosure + cleaver show sign + lit sign over the aisle
log("hall + signs")
annulus("hall_tile", ENC_R, ENC_R + 0.4, 0.0, 5.2, M_TILE, segs=120, tile=1.2, parts=("in", "top"))
annulus("hall_band", ENC_R - 0.02, ENC_R, 2.3, 2.6, M_BAND, segs=120, tile=1.2, parts=("in",))
annulus("hall_paint", ENC_R, ENC_R + 0.4, 5.2, 11.0, M_WALLP, segs=120, tile=3.0, parts=("in", "top"))
annulus("hall_trim", ENC_R - 0.08, ENC_R, 5.1, 5.3, M_STEEL, segs=120, tile=1.2, parts=("in", "top", "bottom"))
for k in range(12):                       # cage lamps on the hall wall
    a = 15.0 + 30.0 * k
    y = 3.6 if 150.0 < a < 210.0 else 6.2
    c = polar(ENC_R - 0.02, a, y)
    inward = polar(-1.0, a, 0.0)
    lathe("cage_lamp_%d" % k, [(0.0, 0.0), (0.12, 0.0), (0.13, 0.03), (0.12, 0.2), (0.07, 0.26), (0.0, 0.27)], c, inward,
          M_FROST, segs=16)
    lathe("cage_lamp_base_%d" % k, [(0.0, 0.0), (0.15, 0.0), (0.15, 0.04), (0.0, 0.04)], c, inward, M_STEELD, segs=16)


def cleaver_sign(tag, SY, SZ, bulbs_list):
    """steel cleaver blade with the lit show logo + bulb border, red handle, bolster, rivets; faces +Z at z SZ"""
    arcs = {}
    for (cx, cy, r, a0_, a1_), key in zip(((-2.85, 0.7, 0.35, 90, 180), (-2.85, -0.7, 0.35, 180, 270), (1.8, -0.95, 0.1, 270, 360),
                                           (1.8, 0.95, 0.1, 0, 90)), ("tl", "bl", "br", "tr")):
        arcs[key] = [(cx + r * math.cos(math.radians(a0_ + (a1_ - a0_) * k / 6)), cy + r * math.sin(math.radians(a0_ + (a1_ - a0_) * k / 6)))
                     for k in range(7)]
    edge = []
    for k in range(1, 12):
        x = -2.85 + (1.8 - -2.85) * k / 12
        edge.append((x, -1.05 - 0.09 * math.sin(math.pi * k / 12)))
    poly = arcs["bl"] + edge + arcs["br"] + arcs["tr"] + arcs["tl"]
    hole = [(-2.55 + 0.26 * math.cos(2 * math.pi * k / 20), 0.52 + 0.26 * math.sin(2 * math.pi * k / 20)) for k in range(20)]
    sg = []
    sg.append(prism("sign_blade_%s" % tag, poly, 0.14, M_STEEL, center_g=(0.0, SY, SZ), face_g=(0, 0, 1), up_g=(0, 1, 0),
                    bevel=0.025, segs=2, holes=[list(reversed(hole))]))
    sg.append(prism("sign_edge_%s" % tag, [(x, y) for (x, y) in edge] + [(1.8, -0.93), (-2.85, -0.93)], 0.145, M_STEELD,
                    center_g=(0.0, SY, SZ), face_g=(0, 0, 1), up_g=(0, 1, 0), bevel=0.01, segs=1))
    sg.append(label("sign_logo_%s" % tag, (-0.2, SY + 0.02, SZ + 0.07), 4.0, 1.5, (0, 640, 1024, 1024), (1024, 1024),
                    M_SIGNLIT, lift=0.006))
    handle = [(0.0, -0.33), (1.9, -0.33)] + [(1.9 + 0.33 * math.cos(math.radians(a)), 0.33 * math.sin(math.radians(a)))
                                              for a in range(-80, 81, 20)] + [(1.9, 0.33), (0.0, 0.33)]
    sg.append(prism("sign_handle_%s" % tag, handle, 0.2, M_RED, center_g=(2.15, SY + 0.35, SZ), face_g=(0, 0, 1),
                    up_g=(0, 1, 0), bevel=0.04, segs=2))
    sg.append(gbox("sign_bolster_%s" % tag, 1.75, 2.2, SY - 0.1, SY + 0.8, SZ - 0.13, SZ + 0.13, M_STEELD, tile=0.5, bevel=0.03))
    for k in range(3):
        sg.append(cyl("sign_rivet_%s_%d" % (tag, k), (2.75 + k * 0.55, SY + 0.35, SZ + 0.1), (0, 0, 1), 0.075, 0.04, M_STEEL,
                      sides=16, bevel=0.012))
    for s in (-1, 1):
        sg.append(L.chain("sign_chain_%s_%d" % (tag, s), (s * 1.6 - 0.5, SY + 6.3, SZ), (s * 1.6 - 0.5, SY + 0.98, SZ), M_STEELD,
                          link_len=0.12, r=0.03))
    pts = []
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        seg = math.dist(a, b)
        n = max(1, int(seg / 0.24))
        for k in range(n):
            t = k / n
            pts.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    cx0, cy0 = -0.5, 0.0
    last = None
    for (x, y) in pts:
        if last and math.dist(last, (x, y)) < 0.2:
            continue
        last = (x, y)
        dx, dy = cx0 - x, cy0 - y
        dl = math.hypot(dx, dy)
        ix, iy = x + dx / dl * 0.11, y + dy / dl * 0.11
        b = sphere("sbulb_%s_%d" % (tag, len(bulbs_list)), (ix, SY + iy, SZ + 0.085), 0.045, M_BULB, seg=8, rings=5)
        bulbs_list.append(b)
        sg.append(b)
    return sg


# the hero show sign on the hall wall behind the kitchen (180 deg): hung at z -(ENC_R - 0.45), centre y 4.45
sg = cleaver_sign("main", 4.45, -(ENC_R - 0.45), BULBS)
H("cleaver sign", sg)
# a second lit sign over the 0 deg aisle (facing the kitchen side): built facing +Z at the origin then placed
sg2 = cleaver_sign("aisle", 0.0, 0.0, BULBS)
place(sg2, polar(ENC_R - 0.5, 0.0, 4.7), 180.0)
log("sign bulbs", len(BULBS))

_bset = set(BULBS)
for _k in HERO:
    HERO[_k] = [o for o in HERO[_k] if o not in _bset]
bulbs = L.join_objs(BULBS, "marquee_bulbs")
L.ANIM["marquee_bulbs"] = bulbs

# =============================================================== crowd nodes + ship
nodes = L.crowd_nodes(S)
L.env_map(HDRI, SID + "_env.hdr") if L.DO_EXPORT else None
heroes = [("freezer door", HERO["freezer door"], 2.4), ("meat rail: ham + links", HERO["meat rail"], 1.3),
          ("gas range + pots + flames", HERO["range + pots"], 1.2), ("cleaver show sign", HERO["cleaver sign"], 2.2),
          ("strip curtain doorway", HERO["strip curtain"], 2.6)]
L.build_and_ship(S, HDRI, nodes, [("Ch05", "Ch05_nonPBR.fbx", []), ("Brute", "Brute.fbx", ["BattleAxe"])],
                 extra_shots=[
                     {"id": "overview", "pos": [13.0, 9.0, 13.0], "look": [0.0, 1.5, -2.0], "fov": 60.0},
                     {"id": "top", "pos": [0.0, 30.0, 0.01], "look": [0.0, 0.0, 0.0], "fov": 70.0},
                     {"id": "kitchen", "pos": [0.0, 1.8, -5.0], "look": [0.0, 1.4, -11.0], "fov": 55.0},
                     {"id": "wall_l", "pos": [-5.0, 1.7, 1.5], "look": [-10.2, 1.4, 0.0], "fov": 50.0},
                     {"id": "wall_r", "pos": [5.0, 1.7, 1.5], "look": [10.2, 1.4, 0.0], "fov": 50.0},
                 ], heroes=heroes)
