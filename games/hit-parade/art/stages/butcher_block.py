"""HIT PARADE - stage 2 BUTCHER BLOCK, built headless in Blender (lane STAGES-A).

A cooking-show set in a meat locker: white subway-tile walls with a red tile band and stainless kick plates (the splat
walls at x = +/-8 m); a walk-in FREEZER door on the left wall, a plastic strip-curtain MEAT LOCKER doorway (cold blue
light behind the strips) on the right; behind the fight floor the show's "kitchen line" - brushed-steel counters with
red lacquer doors, two gas ranges with live burner flames and pots, and a thick end-grain butcher block with a giant
cleaver stuck in it; a stainless meat rail over the line hung with comic glazed hams, sausage links and salami
(no carcasses, no gore); the studio audience on black risers behind; a cleaver-shaped lit show sign on the back wall.

Usage (run blender.exe directly so the log is visible; paths are resolved from this file):
  blender.exe --background --python art/stages/butcher_block.py -- [--no-export] [--no-render] [--contact]
        [--shots id,id] [--res 1920x1080] [--samples 48] [--no-fighters] [--no-tex]
Outputs:
  art/gltf/stages/butcher_block.glb + butcher_block_env.hdr, art/stages/butcher_block.stage.json (fragment; then run
  python tools/merge_stages.py), _harness/_reports/stages/butcher_block_<shot>.png (proof renders, game camera).
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
from stagelib_a import G, gbox, cyl, tube, sphere, lathe, prism, label, obox, log  # noqa: E402

SID = "butcher_block"
HDRI = L.PH_HDRI + "abandoned_factory_canteen_01/abandoned_factory_canteen_01_2k.hdr"
W = 8.0

# =============================================================== the stage definition (-> fragment -> stages.json)
S = {
    "id": SID,
    "name": "BUTCHER BLOCK",
    "status": "built",
    "glb": SID + ".glb",
    "source": "art/stages/butcher_block.py",
    "home": ["bruno", "boneyard", "freak"],
    "look": "cooking-show set in a meat locker: white subway tile with a red band and stainless kick plates, a walk-in "
            "freezer door (left wall) and a strip-curtain meat-locker doorway (right wall); behind the floor the "
            "kitchen line - brushed-steel counters with red doors, two gas ranges with live flames and pots, an "
            "end-grain butcher block with a giant cleaver; comic hams, sausage links and salami on a meat rail; studio "
            "audience on black risers; a cleaver-shaped lit show sign on the back wall",
    "floor": {"y": 0.0, "surface": "tile", "fightStrip": {"x": [-8.0, 8.0], "z": [-1.5, 1.5]},
              "extent": {"x": [-12.0, 12.0], "z": [-3.2, 8.0]}},
    "walls": {
        "x": [-8.0, 8.0],
        "splat": [
            {"id": 0, "x": -8.0, "normal": [1, 0, 0], "z": [-3.0, 2.8], "heightM": 4.3, "surface": "white_tile",
             "dustColor": "#e6e1d6"},
            {"id": 1, "x": 8.0, "normal": [-1, 0, 0], "z": [-3.0, 2.8], "heightM": 4.3, "surface": "white_tile",
             "dustColor": "#e6e1d6"},
        ],
        "note": "WALL_SPLAT event b = wall id (0 = x -8, 1 = x +8), CONTRACT 17.6. Left wall carries the freezer door "
                "(flush, z -1.9..-0.7), right wall the strip-curtain doorway (z -2.1..-0.5, strips 5 cm behind the "
                "wall line): the body contact patch (z -0.5..0.5) is tile on both walls.",
    },
    "spawn": {"distanceM": 2.4, "p1": [-1.2, 0.0, 0.0], "p2": [1.2, 0.0, 0.0]},
    "camera": L.camera_block(SID),
    "exposure": 1.0,
    "toneMapping": "neutral",
    "fog": {"color": "#161a22", "near": 16.0, "far": 55.0},
    "environment": {"hdr": SID + "_env.hdr", "intensity": 0.34, "background": False,
                    "src": "Poly Haven abandoned_factory_canteen_01_2k.hdr (CC0), downsampled to 512x256",
                    "backgroundColor": "#0c0e13"},
    "lights": [
        {"id": "key", "type": "directional", "color": "#fff0de", "intensity": 2.5,
         "position": [-4.0, 10.0, 8.0], "target": [0.0, 1.0, 0.0], "castShadow": True,
         "shadow": {"mapSize": 1024, "bias": -0.0004, "normalBias": 0.03,
                    "camera": {"left": -10.0, "right": 10.0, "top": 7.0, "bottom": -4.0, "near": 1.0, "far": 30.0}}},
        {"id": "rim", "type": "directional", "color": "#a6d2ff", "intensity": 1.7,
         "position": [5.0, 7.0, -10.0], "target": [0.0, 1.2, 0.0], "castShadow": False},
        {"id": "fill", "type": "hemisphere", "sky": "#d6e4ff", "ground": "#5b4640", "intensity": 0.85},
        {"id": "stove_l", "type": "point", "color": "#ff9440", "intensity": 3.2, "distance": 4.5, "decay": 2,
         "position": [-5.5, 1.35, -3.3], "flicker": {"amp": 0.25, "hz": 9.0}},
        {"id": "stove_r", "type": "point", "color": "#ff9440", "intensity": 3.2, "distance": 4.5, "decay": 2,
         "position": [5.5, 1.35, -3.3], "flicker": {"amp": 0.25, "hz": 8.1}},
        {"id": "locker", "type": "point", "color": "#7cc8ff", "intensity": 5.0, "distance": 6.0, "decay": 2,
         "position": [9.3, 2.0, -1.3], "flicker": {"amp": 0.04, "hz": 11.0}},
        {"id": "sign_wash", "type": "spot", "color": "#fff4ea", "intensity": 110.0, "distance": 26.0, "decay": 2,
         "position": [0.0, 9.5, -5.0], "target": [0.0, 4.4, -12.4], "angleDeg": 34.0, "penumbra": 0.6},
    ],
    "lightsNote": "FIXED pool: created once at stage load, never added/removed (shader programs stay warm). "
                  "No lights are embedded in the GLB. Flicker = view-only intensity modulation.",
    "crowd": L.crowd_block("#dcd3cf", 0.58, [
        {"id": "risers", "x": [-13.6, 13.6], "spacing": 0.62, "jitter": [0.14, 0.08], "faceYawDeg": 0.0,
         "rows": [{"z": -4.6, "y": 0.3}, {"z": -5.4, "y": 0.6}, {"z": -6.2, "y": 0.9}, {"z": -7.0, "y": 1.2}],
         "seed": 2301},
    ]),
    "music": "music_stage_butcher_block",
    "musicHint": "AUDIO lane maps the id (router: music_stage_<stageId> -> cue <stageId>)",
    "ambient": "amb_butcher_block",
    "ambientHint": "AUDIO 9.2 item 2 loop (freezer hum + drips) under the crowd bed; burner hiss near the ranges",
    "dressing": {
        "animated": [
            {"what": "gas burner flames", "nodes": "flame_range_l, flame_range_r",
             "how": "view-side flame_* scale.y flicker about each range's burner level (node origin), synced with "
                    "the stove_l / stove_r light flicker"},
            {"what": "show-sign bulbs", "nodes": "marquee_bulbs", "how": "optional chase pattern on emissive intensity"},
            {"what": "crowd", "how": "instanced cards, vertex bob/sway, pose swaps by ratings mood"},
        ],
        "splatWallDust": "#e6e1d6",
    },
}

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


def H(key, *obs):
    for o in obs:
        if isinstance(o, (list, tuple)):
            HERO[key].extend(o)
        else:
            HERO[key].append(o)
    return obs[0] if len(obs) == 1 else obs


# =============================================================== floor
log("floor + walls")
gbox("floor_pit", -12.0, 12.0, -0.2, 0.0, -3.2, 8.0, M_FLOOR, tile=2.4)
gbox("floor_back", -14.9, 14.9, -0.2, 0.0, -13.0, -3.2, M_FLOOR, tile=2.4)
# floor drain (flush, stainless ring + slotted grate)
lathe("drain_ring", [(0.13, 0.0), (0.15, 0.004), (0.15, 0.008), (0.13, 0.01), (0.12, 0.006)], (2.6, 0.0, -1.05),
      (0, 1, 0), M_STEELD, segs=28)
cyl("drain_grate", (2.6, 0.003, -1.05), (0, 1, 0), 0.12, 0.006, M_BLACK, sides=28)
for k in range(5):
    gbox("drain_slot_%d" % k, 2.52 + k * 0.04, 2.535 + k * 0.04, 0.0055, 0.0065, -1.13, -0.97, M_BLACK)


# =============================================================== splat walls (x = +/-8)
def wall_run(s, z0, z1, y_lo=0.0, y_hi=4.3, tag=""):
    """one vertical run of the tiled set wall between z0..z1 (kick plate, white tile, red band, tile, cornice)"""
    xi, xo = s * W, s * (W + 0.5)
    parts = []
    if y_lo < 0.32:
        parts.append(gbox("wall_kick_%d%s" % (s, tag), xi - s * 0.03, xo, 0.0, 0.32, z0, z1, M_STEELD, tile=1.2, bevel=0.01))
    if y_lo < 1.25:
        parts.append(gbox("wall_tile_lo_%d%s" % (s, tag), xi, xo, max(0.32, y_lo), 1.25, z0, z1, M_TILE, tile=1.2))
    if y_lo < 1.55:
        parts.append(gbox("wall_band_%d%s" % (s, tag), xi, xo, max(1.25, y_lo), 1.55, z0, z1, M_BAND, tile=1.2))
    parts.append(gbox("wall_tile_hi_%d%s" % (s, tag), xi, xo, max(1.55, y_lo), y_hi, z0, z1, M_TILE, tile=1.2))
    parts.append(gbox("wall_cornice_%d%s" % (s, tag), xi - s * 0.1, xo, y_hi, y_hi + 0.16, z0, z1, M_STEEL, tile=1.2,
                      bevel=0.012))
    if y_lo < 0.95:
        # stainless bumper rail on stand-offs
        parts.append(tube("wall_rail_%d%s" % (s, tag), [(xi - s * 0.07, 0.95, z0 + 0.05), (xi - s * 0.07, 0.95, z1 - 0.05)],
                          0.028, M_STEEL, sides=10))
        n = max(2, int((z1 - z0) / 1.2) + 1)
        for k in range(n):
            z = z0 + 0.15 + (z1 - z0 - 0.3) * k / (n - 1)
            parts.append(cyl("wall_rail_so_%d%s_%d" % (s, tag, k), (xi - s * 0.035, 0.95, z), (1, 0, 0), 0.016, 0.07,
                             M_STEEL, sides=8))
    return parts


# left wall: continuous (the freezer door sits proud of it)
wall_run(-1, -3.0, 2.8)
# right wall: opening for the strip-curtain doorway z -2.1..-0.5, h 2.55
DZ0, DZ1, DH = -2.1, -0.5, 2.55
wall_run(1, -3.0, DZ0, tag="a")
wall_run(1, DZ1, 2.8, tag="b")
gbox("wall_lintel_1", W, W + 0.5, DH, 4.3, DZ0, DZ1, M_TILE, tile=1.2)
gbox("wall_lintel_cornice_1", W - 0.1, W + 0.5, 4.3, 4.46, DZ0, DZ1, M_STEEL, tile=1.2, bevel=0.012)

# pilasters at the wall ends (stainless-clad columns)
for s in (-1, 1):
    for pz in (-3.45, 3.25):
        px = s * (W + 0.3)
        gbox("pilaster_%d_%d" % (s, pz > 0), px - 0.45, px + 0.45, 0.35, 4.9, pz - 0.45, pz + 0.45, M_STEEL, tile=1.2,
             bevel=0.03)
        gbox("pilaster_base_%d_%d" % (s, pz > 0), px - 0.5, px + 0.5, 0.0, 0.35, pz - 0.5, pz + 0.5, M_STEELD, tile=1.2,
             bevel=0.02)
        gbox("pilaster_cap_%d_%d" % (s, pz > 0), px - 0.52, px + 0.52, 4.9, 5.08, pz - 0.52, pz + 0.52, M_STEELD,
             tile=1.2, bevel=0.02)
        for k in range(9):          # rivet columns on the two faces the camera sees
            y = 0.6 + k * 0.5
            for (cx, cz, ax) in ((px - s * 0.455, pz - 0.36, (1, 0, 0)), (px - s * 0.455, pz + 0.36, (1, 0, 0)),
                                 (px - 0.36, pz + 0.455, (0, 0, 1)), (px + 0.36, pz + 0.455, (0, 0, 1))):
                cyl("pil_rivet_%d_%d_%d_%.2f" % (s, pz > 0, k, cx + cz), (cx, y, cz), ax, 0.014, 0.012, M_STEELD, sides=6)

# ---------------------------------------------------------------- LEFT WALL: walk-in freezer door
log("freezer door")
FZ0, FZ1, FH = -1.925, -0.675, 2.25
fd = []
fd.append(gbox("fz_jamb_a", -W, -W + 0.08, 0.0, FH + 0.15, FZ0 - 0.13, FZ0, M_STEELD, tile=1.0, bevel=0.01))
fd.append(gbox("fz_jamb_b", -W, -W + 0.08, 0.0, FH + 0.15, FZ1, FZ1 + 0.13, M_STEELD, tile=1.0, bevel=0.01))
fd.append(gbox("fz_header", -W, -W + 0.08, FH, FH + 0.15, FZ0 - 0.13, FZ1 + 0.13, M_STEELD, tile=1.0, bevel=0.01))
fd.append(gbox("fz_gasket", -W, -W + 0.1, 0.0, FH + 0.01, FZ0 - 0.005, FZ1 + 0.005, M_BLACK, tile=1.0))
fd.append(gbox("fz_slab", -W + 0.01, -W + 0.14, 0.02, FH - 0.01, FZ0 + 0.015, FZ1 - 0.015, M_STEEL, tile=1.2, bevel=0.022,
               segs=3))
fd.append(gbox("fz_kick", -W + 0.14, -W + 0.15, 0.05, 0.42, FZ0 + 0.06, FZ1 - 0.06, M_STEELD, tile=0.6, bevel=0.004))
# embossed panel lines on the slab
for y in (0.95, 1.95):
    fd.append(gbox("fz_rib_%.2f" % y, -W + 0.14, -W + 0.152, y - 0.012, y + 0.012, FZ0 + 0.09, FZ1 - 0.09, M_STEEL,
                   tile=0.5, bevel=0.004))
for y in (0.45, 1.8):                    # hinges (hinge side = back, z FZ0)
    fd.append(cyl("fz_hinge_barrel_%.1f" % y, (-W + 0.16, y, FZ0 - 0.03), (0, 1, 0), 0.034, 0.32, M_STEEL, sides=14,
                  bevel=0.006))
    fd.append(gbox("fz_hinge_leaf_%.1f" % y, -W + 0.14, -W + 0.17, y - 0.12, y + 0.12, FZ0 - 0.03, FZ0 + 0.36, M_STEEL,
                   tile=0.4, bevel=0.008))
    fd.append(gbox("fz_hinge_leaf2_%.1f" % y, -W + 0.07, -W + 0.1, y - 0.12, y + 0.12, FZ0 - 0.2, FZ0 - 0.03, M_STEEL,
                   tile=0.4, bevel=0.008))
    for k in range(3):
        fd.append(cyl("fz_bolt_%.1f_%d" % (y, k), (-W + 0.175, y - 0.08 + k * 0.08, FZ0 + 0.26), (1, 0, 0), 0.013, 0.012,
                      M_STEELD, sides=8))
# latch: plate + lever + knob, keeper on the jamb
fd.append(gbox("fz_latch_plate", -W + 0.14, -W + 0.17, 1.0, 1.3, FZ1 - 0.2, FZ1 - 0.06, M_STEEL, tile=0.3, bevel=0.01))
fd.append(tube("fz_latch_lever", [(-W + 0.17, 1.2, FZ1 - 0.13), (-W + 0.24, 1.2, FZ1 - 0.13), (-W + 0.26, 1.2, FZ1 - 0.2),
                                  (-W + 0.26, 1.18, FZ1 - 0.5)], 0.019, M_STEEL, sides=10))
fd.append(sphere("fz_latch_knob", (-W + 0.26, 1.18, FZ1 - 0.52), 0.035, M_BLACK, seg=12, rings=8))
fd.append(gbox("fz_keeper", -W + 0.08, -W + 0.2, 1.08, 1.26, FZ1 + 0.02, FZ1 + 0.11, M_STEEL, tile=0.3, bevel=0.01))
# porthole (frosted, lit from inside)
fd.append(lathe("fz_port_ring", [(0.15, 0.0), (0.2, 0.0), (0.215, 0.018), (0.205, 0.038), (0.155, 0.04)],
                (-W + 0.14, 1.62, -1.3), (1, 0, 0), M_STEEL, segs=32))
fd.append(cyl("fz_port_glass", (-W + 0.155, 1.62, -1.3), (1, 0, 0), 0.155, 0.01, M_FROST, sides=32))
for k in range(8):
    a = 2 * math.pi * k / 8
    fd.append(cyl("fz_port_bolt_%d" % k, (-W + 0.182, 1.62 + 0.18 * math.sin(a), -1.3 + 0.18 * math.cos(a)), (1, 0, 0),
                  0.011, 0.012, M_STEELD, sides=6))
fd.append(label("fz_sign", (-W + 0.01, FH + 0.4, -1.3), 0.96, 0.24, (0, 256, 512, 384), (1024, 1024), M_LABEL,
                yaw_deg=90))
fd.append(gbox("fz_sign_back", -W, -W + 0.01, FH + 0.26, FH + 0.54, -1.3 - 0.5, -1.3 + 0.5, M_STEELD, tile=0.5))
fd.append(label("fz_stencil", (-W + 0.152, 0.72, -1.36), 0.74, 0.185, (512, 256, 1024, 384), (1024, 1024), M_LABEL,
                yaw_deg=90, lift=0.002))
# thermometer dial beside the door
fd.append(cyl("fz_dial_bezel", (-W + 0.02, 1.62, -2.55), (1, 0, 0), 0.135, 0.05, M_STEEL, sides=28, bevel=0.01))
fd.append(L.disc_label("fz_dial_face", (-W + 0.046, 1.62, -2.55), 0.118, (512, 384, 768, 640), (1024, 1024), M_LABEL,
                       yaw_deg=90, lift=0.001))
# icicles along the header (comic frost)
rng = L.mulberry32(77)
for k in range(9):
    z = FZ0 - 0.05 + (FZ1 - FZ0 + 0.1) * (k + 0.5) / 9
    ln = 0.05 + rng() * 0.1
    fd.append(cyl("fz_icicle_%d" % k, (-W + 0.06, FH - ln / 2, z), (0, 1, 0), 0.016, ln, M_FROST, sides=6, r2=0.0015))
H("freezer door", fd)
# knife strip on the left wall (outside the body contact patch)
gbox("knife_strip", -W, -W + 0.03, 1.72, 1.8, 0.9, 2.1, M_STEELD, tile=0.5, bevel=0.006)
for k, z in enumerate((1.05, 1.35, 1.65, 1.95)):
    blade_h = 0.22 if k % 2 == 0 else 0.3
    prism("knife_blade_%d" % k, [(-0.03, 0.0), (0.03, 0.0), (0.03, -blade_h * 0.8), (0.0, -blade_h), (-0.03, -blade_h * 0.9)],
          0.004, M_STEEL, center_g=(-W + 0.035, 1.74, z), face_g=(1, 0, 0), up_g=(0, 1, 0), bevel=0.001, segs=1)
    gbox("knife_handle_%d" % k, -W + 0.025, -W + 0.05, 1.76, 1.9, z - 0.016, z + 0.016, M_BLACK, tile=0.2, bevel=0.006)

# ---------------------------------------------------------------- RIGHT WALL: strip-curtain meat-locker doorway
log("strip curtain doorway")
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
# locker interior: tiled room, cold light, hams hanging inside
gbox("lk_floor", W, W + 2.6, -0.2, 0.0, DZ0 - 0.6, DZ1 + 0.6, M_FLOOR, tile=2.4)
gbox("lk_wall_back", W + 2.6, W + 2.8, 0.0, 3.0, DZ0 - 0.6, DZ1 + 0.6, M_TILE, tile=1.2)
gbox("lk_wall_a", W + 0.5, W + 2.6, 0.0, 3.0, DZ0 - 0.8, DZ0 - 0.6, M_TILE, tile=1.2)
gbox("lk_wall_b", W + 0.5, W + 2.6, 0.0, 3.0, DZ1 + 0.6, DZ1 + 0.8, M_TILE, tile=1.2)
gbox("lk_ceiling", W + 0.5, W + 2.8, 2.9, 3.0, DZ0 - 0.8, DZ1 + 0.8, M_WALLP, tile=2.0)
sc.append(label("lk_sign", (W - 0.01, DH + 0.42, -1.3), 1.12, 0.28, (0, 384, 512, 512), (1024, 1024), M_LABEL,
                yaw_deg=-90))
H("strip curtain", sc)
# wall clock (right wall, above the splat zone)
cyl("clock_bezel", (W - 0.03, 3.25, 1.35), (1, 0, 0), 0.3, 0.07, M_RED, sides=36, bevel=0.015)
L.disc_label("clock_face", (W - 0.068, 3.25, 1.35), 0.262, (768, 384, 1024, 640), (1024, 1024), M_LABEL, yaw_deg=-90,
             lift=0.001)

# =============================================================== meat: hams, sausage links, salami (procedural)
log("meat rail")
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
    # squash a little (comic, not a cylinder of revolution) + yaw
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


def meat_rail(tag, z, yr, x0, x1, hams_at, links_at, salami_at, supports, top=5.6):
    obs = []
    obs.append(tube("rail_%s" % tag, [(x0, yr, z), (x1, yr, z)], 0.03, M_STEEL, sides=10))
    for x in (x0, x1):
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


# front rail over the kitchen line: ham bottoms ~1.95 m, links sag to ~2.25 m
front = meat_rail("front", -3.72, 2.95, -13.6, 13.6,
                  hams_at=[(-11.8, 0.3, 0.0), (-7.6, -0.4, 0.06), (-2.35, 0.5, 0.0), (2.35, -0.3, 0.05), (7.5, 0.2, 0.0),
                           (11.9, -0.5, 0.07)],
                  links_at=[(-10.5, -8.9, 0.34), (-5.5, -3.9, 0.3), (3.9, 5.6, 0.32), (9.0, 10.6, 0.36)],
                  salami_at=[-13.0, -0.02, 13.0],
                  supports=[-13.2, -6.6, 6.6, 13.2])
H("meat rail", [o for o in front if o.name.startswith(("ham_front_0", "hook_front_h0", "twine_front_h0",
                                                        "links_front_0", "trol_front_h0", "trol_front_l0"))])
# back rail over the audience (reads in far shots above the crowd)
meat_rail("back", -8.6, 4.55, -13.6, 13.6,
          hams_at=[(-10.2, 0.2, 0.0), (-4.4, -0.3, 0.05), (1.1, 0.4, 0.0), (6.3, -0.2, 0.04), (11.6, 0.1, 0.0)],
          links_at=[(-8.4, -6.6, 0.38), (-2.6, -0.9, 0.3), (2.9, 4.6, 0.34), (8.0, 9.8, 0.36)],
          salami_at=[-12.6, 12.8], supports=[-12.0, -3.5, 3.5, 12.0], top=8.0)

# two hams hanging inside the meat locker (seen through the strips)
lk = []
for k, z in enumerate((-1.75, -0.95)):
    hx = W + 1.4 + k * 0.4
    lk.append(tube("lk_rail_%d" % k, [(W + 0.6, 2.6, z), (W + 2.5, 2.6, z)], 0.025, M_STEEL, sides=8))
    hk, yb = s_hook("lk_hook_%d" % k, hx, 2.53, z)
    lk.append(hk)
    lk.append(twine("lk_twine_%d" % k, (hx, yb + 0.01, z), (hx, yb - 0.05, z)))
    lk.append(ham("lk_ham_%d" % k, (hx, yb - 0.05, z), yaw=0.4 * k))
H("strip curtain", lk)

# =============================================================== the kitchen line (back barrier z -3.14 .. -4.06)
log("kitchen line")
ZF, ZB = -3.25, -4.0          # cabinet front / back
TOP = 0.88


def cabinet_run(x0, x1, tag):
    gbox("cab_toe_%s" % tag, x0, x1, 0.0, 0.12, ZF - 0.07, ZB + 0.05, M_BLACK, tile=1.0)
    gbox("cab_body_%s" % tag, x0, x1, 0.12, TOP, ZF, ZB, M_STEEL, tile=1.2, bevel=0.006, segs=1)
    n = max(1, int(round((x1 - x0) / 0.6)))
    w = (x1 - x0) / n
    for k in range(n):
        bx = x0 + k * w
        gbox("cab_door_%s_%d" % (tag, k), bx + 0.025, bx + w - 0.025, 0.17, TOP - 0.06, ZF + 0.002, ZF + 0.022, M_RED,
             tile=0.8, bevel=0.009, segs=2)
        hx0, hx1 = bx + w * 0.25, bx + w * 0.75
        tube("cab_handle_%s_%d" % (tag, k), [(hx0, TOP - 0.13, ZF + 0.02), (hx0, TOP - 0.13, ZF + 0.058),
                                             (hx1, TOP - 0.13, ZF + 0.058), (hx1, TOP - 0.13, ZF + 0.02)],
             0.009, M_STEEL, sides=8)


def countertop(x0, x1, tag, mat=None, y1=TOP + 0.055):
    gbox("top_%s" % tag, x0, x1, TOP, y1, ZF + 0.11, ZB - 0.06, mat or M_STEEL, tile=1.2, bevel=0.008, segs=2)
    if mat is None:
        tube("top_edge_%s" % tag, [(x0 + 0.01, y1, ZF + 0.1), (x1 - 0.01, y1, ZF + 0.1)], 0.011, M_STEEL, sides=8)


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
    """blue inner ring always; bare burners also get tall orange licks. returns (blue quads, orange quads)"""
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


def gas_range(xc, side, pots):
    tag = "rng%d" % side
    rg = []
    rg.append(gbox("rng_toe_%s" % tag, xc - 0.9, xc + 0.9, 0.0, 0.12, ZF - 0.07, ZB + 0.05, M_BLACK, tile=1.0))
    rg.append(gbox("rng_body_%s" % tag, xc - 0.9, xc + 0.9, 0.12, TOP, ZF, ZB, M_STEEL, tile=1.2, bevel=0.008))
    rg.append(gbox("rng_ovendoor_%s" % tag, xc - 0.78, xc + 0.78, 0.18, 0.64, ZF + 0.0, ZF + 0.03, M_STEEL, tile=0.9,
                   bevel=0.014, segs=2))
    rg.append(gbox("rng_window_%s" % tag, xc - 0.52, xc + 0.52, 0.29, 0.55, ZF + 0.03, ZF + 0.034, M_OVEN, tile=0.6,
                   bevel=0.01))
    for ry in (0.36, 0.47):          # oven racks seen through the glass
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
    # cast-iron grates over 4 burners (2 x 2)
    yg = TOP + 0.085
    for gz in (ZF + 0.02, -3.625, ZB - 0.0):
        rg.append(tube("rng_grate_x_%s_%.2f" % (tag, gz), [(xc - 0.84, yg, gz), (xc + 0.84, yg, gz)], 0.011, M_BLACK, sides=6))
    for gx in (-0.84, -0.42, 0.0, 0.42, 0.84):
        rg.append(tube("rng_grate_z_%s_%.2f" % (tag, gx), [(xc + gx, yg, ZF + 0.02), (xc + gx, yg, ZB)], 0.011, M_BLACK, sides=6))
        for gz in (ZF + 0.02, ZB):
            rg.append(cyl("rng_grate_foot_%s_%.2f_%.2f" % (tag, gx, gz), (xc + gx, TOP + 0.066, gz), (0, 1, 0), 0.012, 0.04,
                          M_BLACK, sides=6))
    blue, orange = [], []
    for bi, (bx, bz) in enumerate(((-0.42, -3.44), (0.42, -3.44), (-0.42, -3.81), (0.42, -3.81))):
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
                    a0 = (base[0] - 0.09 + sk * 0.055, base[1] + 0.035, base[2] - 0.07)
                    rg.append(lathe("pan_saus_%s_%d_%d" % (tag, bi, sk), sausage_capsule(0.15, 0.024), a0, (0.12, 0.0, 1.0),
                                    M_SAUS, segs=10, cap=False))
    fb = L.quads_mesh("flameb_%s" % tag, blue, M_FLAMEB)
    fo = L.quads_mesh("flameo_%s" % tag, orange, M_FLAME) if orange else None
    fl = L.join_objs([fb] + ([fo] if fo else []), "flame_range_%s" % ("l" if side < 0 else "r"))
    L.reorigin(fl, (xc, TOP + 0.075, -3.62))
    L.ANIM[fl.name] = fl
    return rg + [fl]


cabinet_run(-14.3, -6.4, "L1")
countertop(-14.3, -6.4, "L1")
rng_l = gas_range(-5.5, -1, {2: "stock", 0: "pan"})
cabinet_run(-4.6, -1.75, "L2")
countertop(-4.6, -1.75, "L2")
cabinet_run(1.75, 4.6, "R2")
countertop(1.75, 4.6, "R2")
rng_r = gas_range(5.5, 1, {1: "sauce", 2: "stock"})
cabinet_run(6.4, 14.3, "R1")
countertop(6.4, 14.3, "R1")
H("range + pots", rng_l)

# centre: the BUTCHER BLOCK island section (black cabinet + show logo, thick end-grain top, giant cleaver)
gbox("blk_toe", -1.75, 1.75, 0.0, 0.12, ZF - 0.07, ZB + 0.05, M_BLACK, tile=1.0)
gbox("blk_body", -1.75, 1.75, 0.12, 0.86, ZF, ZB, M_BLACK, tile=1.2, bevel=0.01)
for s in (-1, 1):
    gbox("blk_corner_%d" % s, s * 1.75 - 0.05, s * 1.75 + 0.05, 0.0, 0.86, ZF - 0.03, ZF + 0.03, M_STEEL, tile=0.5,
         bevel=0.01)
gbox("blk_logo_frame", -1.3, 1.3, 0.18, 0.82, ZF, ZF + 0.02, M_STEEL, tile=0.6, bevel=0.008)
label("blk_logo", (0.0, 0.5, ZF + 0.02), 2.44, 0.61, (0, 0, 1024, 256), (1024, 1024), M_LABEL)
gbox("blk_top", -1.78, 1.78, 0.86, 1.06, ZF + 0.14, ZB - 0.08, M_BLOCK, tile=0.64, bevel=0.022, segs=3)
# giant cleaver stuck in the block
blade = [(-0.2, 0.0), (0.16, 0.0), (0.19, 0.03), (0.19, 0.24), (-0.17, 0.24), (-0.2, 0.2)]
hole = [(0.13 + 0.022 * math.cos(2 * math.pi * k / 12), 0.2 + 0.022 * math.sin(2 * math.pi * k / 12)) for k in range(12)]
cl = []
cl.append(prism("cleaver_blade", blade, 0.012, M_STEEL, center_g=(0.9, 1.035, -3.62), face_g=(0.26, 0, 0.97),
                up_g=(0, 1, 0), bevel=0.003, segs=1, holes=[list(reversed(hole))]))
cl.append(obox("cleaver_handle", (0.9 + 0.3 * 0.97, 1.035 + 0.215, -3.62 - 0.3 * 0.26), (0.24, 0.042, 0.032), 15.0,
               M_BLACK, tile=0.2, bevel=0.012))
for k in range(3):
    cl.append(cyl("cleaver_rivet_%d" % k, (0.9 + (0.23 + k * 0.065) * 0.97, 1.25, -3.62 - (0.23 + k * 0.065) * 0.26 + 0.018),
                  (0.26, 0, 0.97), 0.009, 0.042, M_STEEL, sides=8))
# ham on a board + knife block + bowl, bottles, plates
gbox("board_ham", -1.2, -0.45, 1.06, 1.09, -3.42, -3.86, M_BLOCK, tile=0.5, bevel=0.01)
ham("ham_lying", (-1.2, 1.09, -3.64), lying=True, scale=0.9)
obox("knife_block", (1.45, 1.16, -3.78), (0.16, 0.2, 0.12), 0.0, M_BLOCK, tile=0.3, bevel=0.012)
for k in range(4):
    obox("knife_block_h%d" % k, (1.40 + (k % 2) * 0.1, 1.3 + (k // 2) * 0.03, -3.78 - 0.03 + (k // 2) * 0.06),
         (0.028, 0.12, 0.022), 0.0, M_BLACK, tile=0.1, bevel=0.008)
lathe("bowl_l", [(0.0, 0.0), (0.08, 0.0), (0.15, 0.04), (0.19, 0.11), (0.2, 0.12), (0.185, 0.115), (0.14, 0.05),
                 (0.0, 0.01)], (-3.25, TOP + 0.055, -3.66), (0, 1, 0), M_STEEL, segs=24, cap=False)
for k, (x, m) in enumerate(((-2.75, M_RED), (-2.6, M_YELLOW), (2.55, M_YELLOW), (2.7, M_RED))):
    lathe("bottle_%d" % k, [(0.0, 0.0), (0.035, 0.0), (0.038, 0.01), (0.038, 0.17), (0.03, 0.2), (0.012, 0.23),
                            (0.004, 0.26), (0.0, 0.262)], (x, TOP + 0.055, -3.5 - 0.04 * (k % 2)), (0, 1, 0), m, segs=12)
for k in range(6):
    lathe("plate_%d" % k, [(0.0, 0.0), (0.09, 0.0), (0.13, 0.012), (0.135, 0.018), (0.125, 0.017), (0.085, 0.006),
                           (0.0, 0.006)], (3.4, TOP + 0.055 + k * 0.019, -3.6), (0, 1, 0), M_CERAMIC, segs=24, cap=False)
gbox("board_r", 3.75, 4.35, TOP + 0.055, TOP + 0.08, -3.4, -3.82, M_BLOCK, tile=0.5, bevel=0.008)
L.template("crate_carrot", L.QFP + "FarmCrate_Carrot.gltf")
L.template("crate_apple", L.QFP + "FarmCrate_Apple.gltf")
L.inst("crate_carrot", "crate_1", (-9.6, TOP + 0.055, -3.62), 0.12, 0.62)
L.inst("crate_apple", "crate_2", (9.8, TOP + 0.055, -3.64), -0.2, 0.62)
L.inst("crate_carrot", "crate_3", (12.6, TOP + 0.055, -3.6), 0.4, 0.62)
pot("pot_big_l", (-12.2, TOP + 0.055, -3.64), 0.2, 0.36)
pot("pot_big_2", (-7.6, TOP + 0.055, -3.66), 0.15, 0.24)
L.canon_kit_images()

# =============================================================== audience risers + rail
log("risers")
TIERS = [(-4.2, -5.0, 0.3), (-5.0, -5.8, 0.6), (-5.8, -6.6, 0.9), (-6.6, -7.4, 1.2)]
for k, (za, zb, y) in enumerate(TIERS):
    gbox("tier_%d" % k, -14.5, 14.5, 0.0 if k == 0 else y - 0.3, y, zb, za, M_BLACK, tile=2.0, bevel=0.01, segs=1)
    gbox("tier_nose_%d" % k, -14.5, 14.5, y - 0.035, y + 0.004, za - 0.05, za + 0.004, M_STEELD, tile=1.2)
gbox("tier_back", -14.5, 14.5, 0.0, 1.2, -7.6, -7.4, M_BLACK, tile=2.0)
for k in range(15):
    x = -14.0 + k * 2.0
    tube("rail_post_%d" % k, [(x, 1.2, -7.48), (x, 2.2, -7.48)], 0.022, M_STEEL, sides=8)
tube("rail_top", [(-14.3, 2.2, -7.48), (14.3, 2.2, -7.48)], 0.026, M_STEEL, sides=10)
tube("rail_mid", [(-14.3, 1.72, -7.48), (14.3, 1.72, -7.48)], 0.018, M_STEEL, sides=8)

# =============================================================== hall + back wall + cleaver sign
log("hall + sign")
BZ = -12.6
for s in (-1, 1):
    gbox("hall_tile_%d" % s, s * 14.5, s * 14.9, 0.0, 5.2, BZ, -3.2, M_TILE, tile=1.2)
    gbox("hall_band_%d" % s, s * 14.48, s * 14.5, 1.25, 1.55, BZ, -3.2, M_BAND, tile=1.2)
    gbox("hall_paint_%d" % s, s * 14.5, s * 14.9, 5.2, 11.0, BZ, -3.2, M_WALLP, tile=3.0)
    gbox("hall_trim_%d" % s, s * 14.42, s * 14.5, 5.1, 5.3, BZ, -3.2, M_STEEL, tile=1.2, bevel=0.01)
gbox("back_tile", -14.9, 14.9, 0.0, 5.2, BZ - 0.4, BZ, M_TILE, tile=1.2)
gbox("back_band", -14.9, 14.9, 2.3, 2.6, BZ + 0.0, BZ + 0.02, M_BAND, tile=1.2)
gbox("back_paint", -14.9, 14.9, 5.2, 11.0, BZ - 0.4, BZ, M_WALLP, tile=3.0)
gbox("back_trim", -14.9, 14.9, 5.1, 5.3, BZ, BZ + 0.08, M_STEEL, tile=1.2, bevel=0.01)
# back-wall cage lamps (between the crowd and the sign)
for k, x in enumerate((-11.0, -7.0, 7.0, 11.0)):
    lathe("cage_lamp_%d" % k, [(0.0, 0.0), (0.12, 0.0), (0.13, 0.03), (0.12, 0.2), (0.07, 0.26), (0.0, 0.27)],
          (x, 3.6, BZ + 0.02), (0, 0, 1), M_FROST, segs=16)
    lathe("cage_lamp_base_%d" % k, [(0.0, 0.0), (0.15, 0.0), (0.15, 0.04), (0.0, 0.04)], (x, 3.6, BZ + 0.0), (0, 0, 1),
          M_STEELD, segs=16)

# the cleaver sign: steel blade with the lit show logo + bulb border, black handle, bolster, rivets
SZ, SY = BZ + 0.3, 5.0
# blade outline counter-clockwise: bottom-left arc -> bowed cutting edge -> bottom-right -> top-right -> top-left
arcs = {}
for (cx, cy, r, a0, a1), key in zip(((-2.85, 0.7, 0.35, 90, 180), (-2.85, -0.7, 0.35, 180, 270), (1.8, -0.95, 0.1, 270, 360),
                                     (1.8, 0.95, 0.1, 0, 90)), ("tl", "bl", "br", "tr")):
    arcs[key] = [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * k / 6)), cy + r * math.sin(math.radians(a0 + (a1 - a0) * k / 6)))
                 for k in range(7)]
edge = []
for k in range(1, 12):          # the cutting edge bows down a little
    x = -2.85 + (1.8 - -2.85) * k / 12
    edge.append((x, -1.05 - 0.09 * math.sin(math.pi * k / 12)))
poly = arcs["bl"] + edge + arcs["br"] + arcs["tr"] + arcs["tl"]
hole = [(-2.55 + 0.26 * math.cos(2 * math.pi * k / 20), 0.52 + 0.26 * math.sin(2 * math.pi * k / 20)) for k in range(20)]
sg = []
sg.append(prism("sign_blade", poly, 0.14, M_STEEL, center_g=(0.0, SY, SZ), face_g=(0, 0, 1), up_g=(0, 1, 0), bevel=0.025,
                segs=2, holes=[list(reversed(hole))]))
sg.append(prism("sign_edge", [(x, y) for (x, y) in edge] + [(1.8, -0.93), (-2.85, -0.93)], 0.145, M_STEELD,
                center_g=(0.0, SY, SZ), face_g=(0, 0, 1), up_g=(0, 1, 0), bevel=0.01, segs=1))
sg.append(label("sign_logo", (-0.2, SY + 0.02, SZ + 0.07), 4.0, 1.5, (0, 640, 1024, 1024), (1024, 1024), M_SIGNLIT,
                lift=0.006))
handle = [(0.0, -0.33), (1.9, -0.33)] + [(1.9 + 0.33 * math.cos(math.radians(a)), 0.33 * math.sin(math.radians(a)))
                                          for a in range(-80, 81, 20)] + [(1.9, 0.33), (0.0, 0.33)]
sg.append(prism("sign_handle", handle, 0.2, M_RED, center_g=(2.15, SY + 0.35, SZ), face_g=(0, 0, 1), up_g=(0, 1, 0),
                bevel=0.04, segs=2))
sg.append(gbox("sign_bolster", 1.75, 2.2, SY - 0.1, SY + 0.8, SZ - 0.13, SZ + 0.13, M_STEELD, tile=0.5, bevel=0.03))
for k in range(3):
    sg.append(cyl("sign_rivet_%d" % k, (2.75 + k * 0.55, SY + 0.35, SZ + 0.1), (0, 0, 1), 0.075, 0.04, M_STEEL, sides=16,
                  bevel=0.012))
for s in (-1, 1):
    sg.append(L.chain("sign_chain_%d" % s, (s * 1.6 - 0.5, 11.0, SZ), (s * 1.6 - 0.5, SY + 0.98, SZ), M_STEELD,
                      link_len=0.12, r=0.03))
BULBS = []
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
    BULBS.append(sphere("sbulb_%d" % len(BULBS), (ix, SY + iy, SZ + 0.085), 0.045, M_BULB, seg=8, rings=5))
bulbs = L.join_objs(BULBS, "marquee_bulbs")
L.ANIM["marquee_bulbs"] = bulbs
H("cleaver sign", sg + [bulbs])
log("sign bulbs", len(BULBS))

# =============================================================== crowd nodes + ship
nodes = L.crowd_nodes(S)
L.env_map(HDRI, SID + "_env.hdr") if L.DO_EXPORT else None
heroes = [("freezer door", HERO["freezer door"], 2.4), ("meat rail: ham + links", HERO["meat rail"], 1.3),
          ("gas range + pots + flames", HERO["range + pots"], 1.2), ("cleaver show sign", HERO["cleaver sign"], 2.2),
          ("strip curtain doorway", HERO["strip curtain"], 2.6)]
L.build_and_ship(S, HDRI, nodes, [("Ch05", "Ch05_nonPBR.fbx", []), ("Brute", "Brute.fbx", ["BattleAxe"])],
                 extra_shots=[
                     {"id": "overview", "pos": [10.5, 6.5, 12.0], "look": [0.0, 2.0, -6.0], "fov": 52.0},
                     {"id": "wall_r", "pos": [4.0, 1.7, 2.8], "look": [8.0, 1.5, -1.2], "fov": 50.0},
                     {"id": "wall_l", "pos": [-4.0, 1.7, 2.8], "look": [-8.0, 1.5, -1.2], "fov": 50.0},
                     {"id": "kitchen", "pos": [-3.6, 1.6, -0.6], "look": [-5.5, 1.1, -3.7], "fov": 45.0},
                 ], heroes=heroes)
