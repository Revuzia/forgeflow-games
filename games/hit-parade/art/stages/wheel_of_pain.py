"""HIT PARADE - stage 3 WHEEL OF PAIN, built headless in Blender (lane STAGES-A).

A neon game-show floor: glossy black studio floor with inset LED strips and two flush hazard-striped TRAPDOOR panels;
the splat walls at x = +/-8 m are show-set walls (neon chevron panels in chrome mullions strung with marquee bulbs,
APPLAUSE / ON AIR light boxes); behind the floor a bulb-lit stage edge, two contestant podiums with light-up PLAYER 1 /
PLAYER 2 name boards and buzzers, audience bays left and right of a runway that leads to the hero prop: a GIANT prize
wheel (16 comic prize segments, gold rim with 48 bulbs, pegs, flapper) standing on a lit plinth in front of an LED
starburst backdrop, framed by box-truss towers with par cans.

The wheel is the separate node `anim_spin_wheel` (pivot on the axle, local +Y = the axle toward the camera, radially
symmetric so the quantised pivot stays on the axle): the view's stage hook spins it about local Y.

Usage (run blender.exe directly so the log is visible; paths are resolved from this file):
  blender.exe --background --python art/stages/wheel_of_pain.py -- [--no-export] [--no-render] [--contact]
        [--shots id,id] [--res 1920x1080] [--samples 48] [--no-fighters] [--no-tex]
Outputs: art/gltf/stages/wheel_of_pain.glb + wheel_of_pain_env.hdr, art/stages/wheel_of_pain.stage.json (fragment;
then python tools/merge_stages.py), _harness/_reports/stages/wheel_of_pain_<shot>.png (proof renders, game camera).
Sources: generated textures (art/stages/stagetex_a.py: glossy floor, wheel face with prize labels, lit labels in the
game's OFL fonts, LED wall, trapdoor plate, brushed aluminium, lacquers), Blink Dwarven_Casting_Wall + Golden_Wall
(Unity EULA, ENV_KIT set 3 picks), Poly Haven adams_place_bridge (CC0) for the IBL. ASCII only.
"""
import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.dont_write_bytecode = True   # no __pycache__ inside art/stages
import stagelib_a as L  # noqa: E402
from stagelib_a import G, gbox, cyl, tube, sphere, lathe, prism, label, log  # noqa: E402
import bmesh  # noqa: E402

SID = "wheel_of_pain"
HDRI = L.PH_HDRI + "adams_place_bridge/adams_place_bridge_2k.hdr"
W = 8.0
DECK = 0.3
ZE = -3.4
HUB = (0.0, 3.34, -13.0)
RF, RO = 2.5, 2.8

S = {
    "id": SID,
    "name": "WHEEL OF PAIN",
    "status": "built",
    "glb": SID + ".glb",
    "source": "art/stages/wheel_of_pain.py",
    "home": ["zambini", "lotus"],
    "look": "neon game-show floor: glossy black floor with LED strips and two hazard-striped trapdoor panels, neon "
            "chevron set walls in chrome mullions strung with marquee bulbs; bulb-lit stage edge, contestant podiums "
            "with light-up PLAYER 1 / PLAYER 2 boards, audience bays either side of a runway to the GIANT prize wheel "
            "(16 comic prizes, gold bulb rim, pegs, flapper) on a lit plinth before an LED starburst wall; truss towers",
    "floor": {"y": 0.0, "surface": "gloss_black", "fightStrip": {"x": [-8.0, 8.0], "z": [-1.5, 1.5]},
              "extent": {"x": [-12.0, 12.0], "z": [-3.4, 8.0]},
              "trapdoors": [{"x": -4.7, "z": 0.0, "sizeM": 1.5}, {"x": 4.7, "z": 0.0, "sizeM": 1.5}],
              "note": "trapdoors are flush dressing (texture + frame + hinges in the static set); a sim trapdoor move "
                      "(zambini / ricky) can use these spots"},
    "walls": {
        "x": [-8.0, 8.0],
        "splat": [
            {"id": 0, "x": -8.0, "normal": [1, 0, 0], "z": [-3.4, 2.8], "heightM": 4.3, "surface": "neon_panel",
             "dustColor": "#ff7ad9"},
            {"id": 1, "x": 8.0, "normal": [-1, 0, 0], "z": [-3.4, 2.8], "heightM": 4.3, "surface": "neon_panel",
             "dustColor": "#7ae4ff"},
        ],
        "note": "WALL_SPLAT event b = wall id (0 = x -8, 1 = x +8), CONTRACT 17.6. Mullions at z -1.33 / 0.73: the body "
                "contact patch (z -0.5..0.5) is flat panel.",
    },
    "spawn": {"distanceM": 2.4, "p1": [-1.2, 0.0, 0.0], "p2": [1.2, 0.0, 0.0]},
    "camera": L.camera_block(SID),
    "exposure": 1.0,
    "toneMapping": "neutral",
    "fog": {"color": "#140b1f", "near": 18.0, "far": 60.0},
    "environment": {"hdr": SID + "_env.hdr", "intensity": 0.3, "background": False,
                    "src": "Poly Haven adams_place_bridge_2k.hdr (CC0), downsampled to 512x256",
                    "backgroundColor": "#0a0610"},
    "lights": [
        {"id": "key", "type": "directional", "color": "#f6ecff", "intensity": 2.3,
         "position": [-4.0, 10.0, 8.0], "target": [0.0, 1.0, 0.0], "castShadow": True,
         "shadow": {"mapSize": 1024, "bias": -0.0004, "normalBias": 0.03,
                    "camera": {"left": -10.0, "right": 10.0, "top": 7.0, "bottom": -4.0, "near": 1.0, "far": 30.0}}},
        {"id": "rim", "type": "directional", "color": "#62dcff", "intensity": 1.9,
         "position": [6.0, 7.0, -10.0], "target": [0.0, 1.2, 0.0], "castShadow": False},
        {"id": "fill", "type": "hemisphere", "sky": "#9a88ff", "ground": "#2b1233", "intensity": 0.8},
        {"id": "wheel_spot", "type": "spot", "color": "#fff3e0", "intensity": 150.0, "distance": 30.0, "decay": 2,
         "position": [0.0, 9.0, -5.5], "target": [0.0, 3.3, -13.0], "angleDeg": 20.0, "penumbra": 0.45},
        {"id": "podium_wash", "type": "spot", "color": "#ffe6c8", "intensity": 55.0, "distance": 16.0, "decay": 2,
         "position": [0.0, 7.0, 0.5], "target": [0.0, 1.0, -4.6], "angleDeg": 38.0, "penumbra": 0.6},
        {"id": "accent_l", "type": "point", "color": "#ff40b8", "intensity": 6.0, "distance": 9.0, "decay": 2,
         "position": [-7.0, 3.2, -2.2], "flicker": {"amp": 0.06, "hz": 2.0}},
        {"id": "accent_r", "type": "point", "color": "#40d8ff", "intensity": 6.0, "distance": 9.0, "decay": 2,
         "position": [7.0, 3.2, -2.2], "flicker": {"amp": 0.06, "hz": 2.3}},
    ],
    "lightsNote": "FIXED pool: created once at stage load, never added/removed (shader programs stay warm). "
                  "No lights are embedded in the GLB. Flicker = view-only intensity modulation.",
    "crowd": L.crowd_block("#dccfe8", 0.56, [
        {"id": "bay_l", "x": [-14.2, -5.0], "spacing": 0.62, "jitter": [0.14, 0.08], "faceYawDeg": 0.0,
         "rows": [{"z": -4.2, "y": 0.3}, {"z": -5.0, "y": 0.65}, {"z": -5.8, "y": 1.0}, {"z": -6.6, "y": 1.35},
                  {"z": -7.4, "y": 1.7}], "seed": 3301},
        {"id": "bay_r", "x": [5.0, 14.2], "spacing": 0.62, "jitter": [0.14, 0.08], "faceYawDeg": 0.0,
         "rows": [{"z": -4.2, "y": 0.3}, {"z": -5.0, "y": 0.65}, {"z": -5.8, "y": 1.0}, {"z": -6.6, "y": 1.35},
                  {"z": -7.4, "y": 1.7}], "seed": 3302},
    ]),
    "music": "music_stage_wheel_of_pain",
    "musicHint": "AUDIO lane maps the id (router: music_stage_<stageId> -> cue <stageId>)",
    "ambient": "amb_wheel_of_pain",
    "ambientHint": "AUDIO 9.2 item 2 loop (neon buzz + wheel ticks: 16 pegs x 0.8 rad/s = ~2 clicks/s) under the crowd "
                   "bed; applause-sign stingers",
    "dressing": {
        "animated": [
            {"what": "giant prize wheel", "nodes": "anim_spin_wheel",
             "how": "view stage hook anim_spin_*: rotation.y += dt * 0.8 about the node's local +Y = the axle (glTF +Z, "
                    "toward the camera); pivot on the axle"},
            {"what": "marquee bulbs", "nodes": "marquee_bulbs", "how": "optional chase pattern on emissive intensity"},
            {"what": "crowd", "how": "instanced cards, vertex bob/sway, pose swaps by ratings mood"},
        ],
        "splatWallDust": "#ff7ad9",
    },
}

# =============================================================== scene + materials
if L.arg("--fragment-only", False):      # re-emit the fragment from S (keeps the measured build stats)
    L.write_fragment(S)
    raise SystemExit(0)
L.init_scene("wheel")
L.run_texgen(SID)
gt = L.gtex
log("materials")
M_FLOOR = L.mat_pbr("wp_floor", gt("wp_floor_a"), gt("wp_floor_n", True), gt("wp_floor_r", True))
M_ALU = L.mat_pbr("wp_alu", gt("wp_alu_a"), gt("wp_alu_n", True), gt("wp_alu_r", True), metallic=1.0)
M_GOLD = L.mat_pbr("wp_gold", color=(1.0, 0.70, 0.30, 1), normal=gt("wp_alu_n", True), rough=gt("wp_alu_r", True),
                   metallic=1.0)
M_BLUE = L.mat_pbr("wp_blue", gt("wp_blue_a"), gt("wp_blue_n", True), gt("wp_blue_r", True))
M_VIOLET = L.mat_pbr("wp_violet", gt("wp_violet_a"), gt("wp_violet_n", True), gt("wp_violet_r", True))
M_BLACKP = L.mat_pbr("wp_black", gt("wp_black_a"), gt("wp_black_n", True), gt("wp_black_r", True), metallic=0.1)
M_RED = L.mat_pbr("wp_red", color=(0.78, 0.04, 0.06, 1), normal=gt("wp_blue_n", True), roughness=0.24)
WFACE = gt("wp_wheel_a")
M_WHEEL = L.mat_pbr("wp_wheel_face", WFACE, gt("wp_wheel_n", True), gt("wp_wheel_r", True), emission_tex=WFACE,
                    estrength=0.22)
LAB = gt("wp_labels")
M_LABEL = L.mat_pbr("wp_labels", LAB, roughness=0.6, emission_tex=LAB, estrength=0.28)
LED = gt("wp_led")
M_LED = L.mat_pbr("wp_led_wall", LED, roughness=0.3, emission_tex=LED, estrength=0.6)
M_LEDC = L.mat_pbr("wp_led_cyan", color=(0.2, 0.85, 1.0, 1), roughness=0.3, emission=(0.18, 0.85, 1.0, 1), estrength=1.5)
M_LEDM = L.mat_pbr("wp_led_magenta", color=(1.0, 0.2, 0.7, 1), roughness=0.3, emission=(1.0, 0.18, 0.68, 1),
                   estrength=1.5)
M_RING = L.mat_pbr("wp_floor_ring", color=(0.6, 0.12, 0.42, 1), roughness=0.3, emission=(1.0, 0.18, 0.68, 1),
                   estrength=0.55)
M_BULB = L.mat_pbr("wp_bulb", color=(1.0, 0.88, 0.62, 1), roughness=0.3, emission=(1.0, 0.82, 0.55, 1), estrength=1.6)
M_LENS = L.mat_pbr("wp_lens", color=(1.0, 0.9, 0.7, 1), roughness=0.2, emission=(1.0, 0.86, 0.62, 1), estrength=1.4)
M_TRAP = L.mat_pbr("wp_trapdoor", gt("wp_trap_a"), gt("wp_trap_n", True), gt("wp_trap_r", True), metallic=0.55)
M_NEON = L.mat_pbr("wp_neon_panel", L.prep(L.BLINK + "Dwarven_Casting_Wall/Dwarven_Casting_Wall_BaseColor.png", "wp_neonwall_a", 1024),
                   L.prep(L.BLINK + "Dwarven_Casting_Wall/Dwarven_Casting_Wall_Normal.png", "wp_neonwall_n", 1024, True),
                   L.prep(L.BLINK + "Dwarven_Casting_Wall/Dwarven_Casting_Wall_Roughness.png", "wp_neonwall_r", 512, True),
                   emission_tex=L.prep(L.BLINK + "Dwarven_Casting_Wall/Dwarven_Casting_Wall_Emissive.png", "wp_neonwall_e", 512),
                   estrength=1.3)
M_GOLDW = L.mat_pbr("wp_gold_panel", L.prep(L.BLINK + "Golden_Wall/Golden_Wall_BaseColor.png", "wp_goldwall_a", 1024),
                    L.prep(L.BLINK + "Golden_Wall/Golden_Wall_Normal.png", "wp_goldwall_n", 512, True),
                    L.prep(L.BLINK + "Golden_Wall/Golden_Wall_Roughness.png", "wp_goldwall_r", 512, True), metallic=0.35)

HERO = {"wheel": [], "podium": [], "truss": [], "trapdoor": []}
BULBS = []


def bulb(name, p, r=0.045):
    b = sphere(name, p, r, M_BULB, seg=8, rings=5)
    BULBS.append(b)
    return b


def bulb_line(tag, a, b, step=0.25, r=0.045):
    n = max(1, int(math.dist(a, b) / step))
    return [bulb("%s_%d" % (tag, k), tuple(a[i] + (b[i] - a[i]) * k / n for i in range(3)), r) for k in range(n + 1)]


# =============================================================== floor, LED strips, trapdoors
log("floor")
gbox("floor_pit", -12.0, 12.0, -0.2, 0.0, ZE, 8.0, M_FLOOR, tile=2.4)
for zc in (-1.73, 1.73):
    gbox("floor_led_%.1f" % zc, -7.9, 7.9, 0.0, 0.004, zc - 0.03, zc + 0.03, M_LEDC, tile=1.0)
lathe("floor_ring", [(1.5, 0.0), (1.56, 0.0), (1.56, 0.003), (1.5, 0.003)], (0.0, 0.0, 0.0), (0, 1, 0), M_RING, segs=64,
      cap=False)
for s in (-1, 1):
    tx = s * 4.7
    tr = []
    tr.append(L.quad("trap_plate_%d" % s, [(tx - 0.75, 0.003, 0.75), (tx + 0.75, 0.003, 0.75), (tx + 0.75, 0.003, -0.75),
                                           (tx - 0.75, 0.003, -0.75)], M_TRAP))
    for (x0, x1, z0, z1) in ((tx - 0.8, tx + 0.8, 0.75, 0.8), (tx - 0.8, tx + 0.8, -0.8, -0.75),
                             (tx - 0.8, tx - 0.75, -0.75, 0.75), (tx + 0.75, tx + 0.8, -0.75, 0.75)):
        tr.append(gbox("trap_frame_%d_%.2f_%.2f" % (s, x0, z0), x0, x1, -0.01, 0.006, z0, z1, M_ALU, tile=0.5, bevel=0.002))
    for k in range(3):
        tr.append(cyl("trap_hinge_%d_%d" % (s, k), (tx - 0.5 + k * 0.5, 0.012, -0.735), (1, 0, 0), 0.022, 0.16, M_ALU,
                      sides=10))
    if s < 0:
        HERO["trapdoor"] += tr         # one plate for the contact render

# =============================================================== the stage edge + deck + runway
log("deck")
gbox("deck", -15.2, 15.2, 0.0, DECK, -20.0, ZE, M_BLACKP, tile=2.4)
gbox("deck_nose", -15.2, 15.2, DECK - 0.03, DECK + 0.004, ZE - 0.04, ZE + 0.004, M_ALU, tile=1.0, bevel=0.004)
gbox("deck_led", -15.0, 15.0, 0.235, 0.262, ZE + 0.001, ZE + 0.006, M_LEDM, tile=1.0)
bulb_line("edge_bulb", (-14.6, 0.13, ZE + 0.03), (14.6, 0.13, ZE + 0.03), step=0.25, r=0.035)
for s in (-1, 1):
    gbox("runway_led_%d" % s, s * 1.62 - 0.025, s * 1.62 + 0.025, DECK, DECK + 0.004, -9.4, ZE - 0.1, M_LEDC, tile=1.0)

# =============================================================== side set walls (splat, x = +/-8)
log("walls")
WZ0, WZ1 = -3.4, 2.8
JOINTS = [WZ0, -1.33, 0.73, WZ1]
for s in (-1, 1):
    xi, xo = s * W, s * (W + 0.5)
    led = M_LEDM if s < 0 else M_LEDC
    gbox("wall_kick_%d" % s, xi - s * 0.02, xo, 0.0, 0.3, WZ0, WZ1, M_BLACKP, tile=1.0, bevel=0.008)
    gbox("wall_kick_led_%d" % s, xi - s * 0.026, xi - s * 0.016, 0.2, 0.24, WZ0, WZ1, led, tile=1.0)
    for k in range(3):
        gbox("wall_panel_%d_%d" % (s, k), xi, xo, 0.3, 4.3, JOINTS[k], JOINTS[k + 1], M_NEON, tile=2.0)
    gbox("wall_midrail_%d" % s, xi - s * 0.05, xi, 2.26, 2.34, WZ0, WZ1, M_ALU, tile=1.0, bevel=0.01)
    gbox("wall_cornice_%d" % s, xi - s * 0.14, xo, 4.3, 4.5, WZ0, WZ1, M_VIOLET if s < 0 else M_BLUE, tile=1.0, bevel=0.02)
    bulb_line("cornice_bulb_%d" % s, (xi - s * 0.145, 4.4, WZ0 + 0.15), (xi - s * 0.145, 4.4, WZ1 - 0.15), step=0.25)
    for j, zj in enumerate(JOINTS):
        gbox("wall_mullion_%d_%d" % (s, j), xi - s * 0.07, xi, 0.3, 4.3, zj - 0.055, zj + 0.055, M_ALU, tile=1.0, bevel=0.015)
        bulb_line("mullion_bulb_%d_%d" % (s, j), (xi - s * 0.075, 0.55, zj), (xi - s * 0.075, 4.1, zj), step=0.27, r=0.04)
    # light box: APPLAUSE (left) / ON AIR (right)
    yaw = 90 if s < 0 else -90
    gbox("lightbox_%d" % s, xi - s * 0.14, xi, 3.0, 3.62, -2.95, -1.75, M_BLACKP, tile=0.5, bevel=0.02)
    label("lightbox_face_%d" % s, (xi - s * 0.14, 3.31, -2.35), 1.1, 0.55, (0, 768, 512, 1024) if s < 0 else (512, 768, 1024, 1024),
          (1024, 1024), M_LABEL, yaw_deg=yaw)
    # pilasters at the wall ends: chrome columns with LED fins
    for pz in (-3.65, 3.05):
        px = s * (W + 0.3)
        gbox("pilaster_%d_%d" % (s, pz > 0), px - 0.35, px + 0.35, 0.0, 4.95, pz - 0.35, pz + 0.35, M_ALU, tile=1.0,
             bevel=0.05, segs=3)
        gbox("pilaster_cap_%d_%d" % (s, pz > 0), px - 0.42, px + 0.42, 4.95, 5.15, pz - 0.42, pz + 0.42, M_VIOLET,
             tile=1.0, bevel=0.02)
        gbox("pilaster_led_%d_%d" % (s, pz > 0), px - s * 0.355 - 0.012, px - s * 0.355 + 0.012, 0.3, 4.8, pz - 0.2,
             pz + 0.2, led, tile=1.0)
# dark hall beyond the audience
for s in (-1, 1):
    gbox("hall_wall_%d" % s, s * 15.2, s * 15.6, 0.0, 12.0, -20.0, ZE, M_BLACKP, tile=3.0)
    for k in range(5):
        z = -5.0 - k * 3.0
        gbox("hall_led_%d_%d" % (s, k), s * 15.19 - 0.01, s * 15.2, 2.0, 11.0, z - 0.04, z + 0.04, M_LEDC if k % 2 else M_LEDM,
             tile=1.0)

# =============================================================== audience bays (either side of the runway)
log("audience")
TIERS = [(-4.6, -5.4, 0.65), (-5.4, -6.2, 1.0), (-6.2, -7.0, 1.35), (-7.0, -7.8, 1.7)]
for s in (-1, 1):
    x0, x1 = sorted((s * 4.85, s * 15.2))
    for k, (za, zb, y) in enumerate(TIERS):
        gbox("tier_%d_%d" % (s, k), x0, x1, DECK, y, zb, za, M_BLACKP, tile=2.0, bevel=0.01, segs=1)
        gbox("tier_led_%d_%d" % (s, k), x0, x1, y - 0.045, y - 0.02, za + 0.001, za + 0.006, M_LEDC if k % 2 == 0 else M_LEDM,
             tile=1.0)
    gbox("bay_back_%d" % s, x0, x1, DECK, 3.4, -8.1, -7.8, M_BLACKP, tile=2.0)
    ex = s * 4.85
    gbox("bay_end_%d" % s, ex - 0.08, ex + 0.08, DECK, 1.45, -7.8, -3.72, M_GOLDW, tile=1.2, bevel=0.012)
    gbox("bay_end_cap_%d" % s, ex - 0.11, ex + 0.11, 1.45, 1.55, -7.85, -3.68, M_ALU, tile=1.0, bevel=0.01)
    bulb_line("bay_end_bulb_%d" % s, (ex, 1.61, -3.8), (ex, 1.61, -7.7), step=0.26, r=0.04)
    # chrome rail in front of the bay
    rx0, rx1 = sorted((s * 5.0, s * 15.0))
    tube("bay_rail_%d" % s, [(rx0, DECK + 1.0, -3.75), (rx1, DECK + 1.0, -3.75)], 0.026, M_ALU, sides=10)
    tube("bay_rail_lo_%d" % s, [(rx0, DECK + 0.5, -3.75), (rx1, DECK + 0.5, -3.75)], 0.018, M_ALU, sides=8)
    n = int((rx1 - rx0) / 1.5) + 1
    for k in range(n):
        x = rx0 + (rx1 - rx0) * k / (n - 1)
        tube("bay_post_%d_%d" % (s, k), [(x, DECK, -3.75), (x, DECK + 1.0, -3.75)], 0.022, M_ALU, sides=8)

# =============================================================== contestant podiums
log("podiums")


def podium(tag, x, body_mat, rect):
    z = -4.45
    ob = []
    ob.append(prism("pod_body_%s" % tag, [(-0.5, 0.0), (0.5, 0.0), (0.6, 1.02), (-0.6, 1.02)], 0.7, body_mat,
                    center_g=(x, DECK, z), face_g=(0, 0, 1), up_g=(0, 1, 0), bevel=0.025, segs=2))
    zf = z + 0.35
    ob.append(gbox("pod_cap_%s" % tag, x - 0.67, x + 0.67, DECK + 1.02, DECK + 1.09, z - 0.4, z + 0.4, M_ALU, tile=0.6,
                   bevel=0.018, segs=2))
    ob.append(gbox("pod_inlay_%s" % tag, x - 0.6, x + 0.6, DECK + 1.09, DECK + 1.094, z - 0.33, z + 0.33, M_GOLDW, tile=0.6))
    ob.append(gbox("pod_bezel_%s" % tag, x - 0.56, x + 0.56, DECK + 0.52, DECK + 0.9, zf, zf + 0.025, M_ALU, tile=0.5,
                   bevel=0.01))
    ob.append(label("pod_board_%s" % tag, (x, DECK + 0.71, zf + 0.025), 1.0, 0.25, rect, (1024, 1024), M_LABEL))
    ob.append(gbox("pod_led_%s" % tag, x - 0.49, x + 0.49, DECK + 0.04, DECK + 0.07, zf, zf + 0.008, M_LEDC, tile=0.5))
    ob.append(gbox("pod_stripe_%s" % tag, x - 0.53, x + 0.53, DECK + 0.3, DECK + 0.34, zf, zf + 0.006, M_GOLD, tile=0.5))
    for k in range(13):
        bx = x - 0.5 + k / 12.0
        ob.append(bulb("pod_bulb_t_%s_%d" % (tag, k), (bx, DECK + 0.95, zf + 0.03), 0.028))
        ob.append(bulb("pod_bulb_b_%s_%d" % (tag, k), (bx, DECK + 0.47, zf + 0.03), 0.028))
    for sx in (-1, 1):
        for k in range(3):
            ob.append(bulb("pod_bulb_s_%s_%d_%d" % (tag, sx, k), (x + sx * 0.59, DECK + 0.59 + k * 0.12, zf + 0.03), 0.028))
    ob.append(lathe("pod_buzz_ring_%s" % tag, [(0.0, 0.0), (0.11, 0.0), (0.115, 0.02), (0.1, 0.035), (0.0, 0.035)],
                    (x + 0.28, DECK + 1.094, z + 0.05), (0, 1, 0), M_ALU, segs=24))
    ob.append(lathe("pod_buzz_dome_%s" % tag, [(0.0, 0.0), (0.088, 0.0), (0.084, 0.03), (0.064, 0.056), (0.032, 0.07),
                                               (0.0, 0.073)], (x + 0.28, DECK + 1.129, z + 0.05), (0, 1, 0), M_RED, segs=24))
    # gooseneck mic
    ob.append(tube("pod_mic_neck_%s" % tag, [(x - 0.3, DECK + 1.094, z - 0.05), (x - 0.3, DECK + 1.3, z - 0.02),
                                             (x - 0.28, DECK + 1.42, z + 0.08), (x - 0.25, DECK + 1.46, z + 0.2)], 0.009,
                   M_BLACKP, sides=6))
    ob.append(lathe("pod_mic_head_%s" % tag, [(0.0, 0.0), (0.022, 0.0), (0.026, 0.03), (0.022, 0.07), (0.0, 0.075)],
                    (x - 0.25, DECK + 1.46, z + 0.2), (0, -0.2, 1), M_BLACKP, segs=12))
    return ob


HERO["podium"] += podium("p1", -3.35, M_BLUE, (0, 0, 1024, 256))
podium("p2", 3.35, M_VIOLET, (0, 256, 1024, 512))

# =============================================================== the GIANT prize wheel (anim_spin_wheel)
log("wheel")


def disc(name, center_g, r, mat, rings=6, segs=64, facing=1):
    """flat disc facing game +Z (facing=1) with planar UV u = 0.5 + x/2r, v = 0.5 + y/2r"""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    cx, cy, cz = center_g
    c = bm.verts.new(G(cx, cy, cz))
    R = [[bm.verts.new(G(cx + r * (i / rings) * math.cos(2 * math.pi * k / segs), cy + r * (i / rings) * math.sin(2 * math.pi * k / segs), cz))
          for k in range(segs)] for i in range(1, rings + 1)]

    def uv(v):
        co = v.co
        return (0.5 + (co.x - cx) / (2 * r), 0.5 + (co.z - cy) / (2 * r))
    faces = []
    for k in range(segs):
        faces.append((c, R[0][k], R[0][(k + 1) % segs]))
    for i in range(rings - 1):
        for k in range(segs):
            faces.append((R[i][k], R[i + 1][k], R[i + 1][(k + 1) % segs], R[i][(k + 1) % segs]))
    for f in faces:
        vs = f if facing > 0 else tuple(reversed(f))
        ff = bm.faces.new(vs)
        for loop in ff.loops:
            loop[uvl].uv = uv(loop.vert)
    return L.finish(bm, name, [mat], uv=False, smooth_angle=5)


hx, hy, hz = HUB
wparts = []
wparts.append(disc("wheel_face", (hx, hy, hz + 0.001), RF, M_WHEEL))
wparts.append(disc("wheel_back", (hx, hy, hz - 0.12), RF, M_BLACKP, facing=-1))
wparts.append(lathe("wheel_rim", [(RF - 0.03, -0.16), (RO - 0.06, -0.16), (RO, -0.1), (RO + 0.02, 0.0), (RO, 0.1),
                                  (RO - 0.06, 0.16), (RF - 0.03, 0.16), (RF - 0.03, 0.02)], HUB, (0, 0, 1), M_GOLD, segs=96,
                    smooth=40, cap=False))
for k in range(16):
    a = 2 * math.pi * k / 16
    px, py = hx + 2.36 * math.cos(a), hy + 2.36 * math.sin(a)
    wparts.append(cyl("wheel_peg_%d" % k, (px, py, hz + 0.08), (0, 0, 1), 0.032, 0.16, M_ALU, sides=10))
    wparts.append(sphere("wheel_pegcap_%d" % k, (px, py, hz + 0.165), 0.042, M_ALU, seg=10, rings=6))
WBULBS = []
for k in range(48):
    a = 2 * math.pi * (k + 0.5) / 48
    WBULBS.append(sphere("wheel_bulb_%d" % k, (hx + (RF + RO) / 2 * math.cos(a), hy + (RF + RO) / 2 * math.sin(a), hz + 0.17),
                         0.052, M_BULB, seg=8, rings=5))
wparts += WBULBS
wparts.append(lathe("wheel_hub", [(0.56, 0.0), (0.55, 0.05), (0.5, 0.12), (0.4, 0.19), (0.24, 0.24), (0.0, 0.26)],
                    (hx, hy, hz + 0.002), (0, 0, 1), M_ALU, segs=48, cap=False))
wparts.append(lathe("wheel_hub_ring", [(0.54, 0.0), (0.68, 0.0), (0.7, 0.04), (0.68, 0.08), (0.54, 0.08)],
                    (hx, hy, hz + 0.002), (0, 0, 1), M_GOLD, segs=48, cap=False))
wparts.append(sphere("wheel_hub_button", (hx, hy, hz + 0.27), 0.12, M_RED, seg=20, rings=10, scale=(1, 1, 0.55)))
for k in range(8):
    a = 2 * math.pi * k / 8
    wparts.append(cyl("wheel_hub_bolt_%d" % k, (hx + 0.61 * math.cos(a), hy + 0.61 * math.sin(a), hz + 0.09), (0, 0, 1),
                      0.022, 0.03, M_ALU, sides=8))
wheel = L.join_objs(wparts, "anim_spin_wheel")
L.reorigin(wheel, HUB, rot_blender=(math.pi / 2, 0.0, 0.0))
L.ANIM[wheel.name] = wheel
HERO["wheel"].append(wheel)

# stand, flapper, plinth, title sign
st = []
for s in (-1, 1):
    st.append(tube("stand_leg_%d" % s, [(s * 1.95, DECK + 0.18, hz - 0.62), (s * 0.3, hy, hz - 0.45)], 0.09, M_ALU, sides=16))
    st.append(gbox("stand_foot_%d" % s, s * 1.95 - 0.28, s * 1.95 + 0.28, DECK + 0.18, DECK + 0.26, hz - 0.85, hz - 0.4, M_ALU,
                   tile=0.5, bevel=0.02))
st.append(tube("stand_brace", [(-1.45, 1.5, hz - 0.58), (1.45, 1.5, hz - 0.58)], 0.06, M_ALU, sides=12))
st.append(cyl("stand_axle", (hx, hy, hz - 0.34), (0, 0, 1), 0.24, 0.34, M_ALU, sides=24, bevel=0.02))
st.append(tube("flapper_post", [(3.18, DECK + 0.18, hz + 0.3), (3.18, hy + 0.32, hz + 0.3)], 0.05, M_ALU, sides=12))
st.append(gbox("flapper_clamp", 3.08, 3.28, hy - 0.12, hy + 0.12, hz + 0.23, hz + 0.39, M_ALU, tile=0.3, bevel=0.02))
st.append(prism("flapper", [(0.0, 0.14), (0.0, -0.14), (-0.62, 0.0)], 0.05, M_RED, center_g=(3.12, hy, hz + 0.31),
                face_g=(0, 0, 1), up_g=(0, 1, 0), bevel=0.012, segs=2))
st.append(lathe("plinth", [(0.0, 0.18), (3.3, 0.18), (3.4, 0.14), (3.4, 0.0), (0.0, 0.0)], (hx, DECK, hz), (0, 1, 0),
                M_BLACKP, segs=64, cap=False))
st.append(lathe("plinth_led", [(3.402, 0.05), (3.41, 0.05), (3.41, 0.11), (3.402, 0.11)], (hx, DECK, hz), (0, 1, 0), M_LEDM,
                segs=64, cap=False))
st.append(lathe("plinth_nose", [(3.28, 0.18), (3.36, 0.18), (3.41, 0.155), (3.41, 0.14), (3.28, 0.185)], (hx, DECK, hz),
                (0, 1, 0), M_ALU, segs=64, cap=False))
ts_z = hz + 0.72
st.append(gbox("title_box", -1.65, 1.65, DECK + 0.18, DECK + 0.98, ts_z - 0.14, ts_z + 0.12, M_VIOLET, tile=0.8, bevel=0.03))
st.append(label("title_face", (0.0, DECK + 0.58, ts_z + 0.12), 3.0, 0.75, (0, 512, 1024, 768), (1024, 1024), M_LABEL))
st += bulb_line("title_bulb_t", (-1.58, DECK + 0.93, ts_z + 0.13), (1.58, DECK + 0.93, ts_z + 0.13), step=0.2, r=0.032)
st += bulb_line("title_bulb_b", (-1.58, DECK + 0.23, ts_z + 0.13), (1.58, DECK + 0.23, ts_z + 0.13), step=0.2, r=0.032)
HERO["wheel"] += st

# =============================================================== LED backdrop + truss towers + par cans
log("backdrop + truss")
L.quad("led_wall", [(-18.0, DECK, -19.0), (18.0, DECK, -19.0), (18.0, DECK + 12.7, -19.0), (-18.0, DECK + 12.7, -19.0)], M_LED)
gbox("led_wall_back", -18.4, 18.4, 0.0, 13.4, -19.4, -19.02, M_BLACKP, tile=3.0)
gbox("led_wall_frame_b", -18.2, 18.2, DECK - 0.05, DECK + 0.08, -19.05, -18.9, M_ALU, tile=1.0, bevel=0.01)


def truss_vertical(tag, x, z, y0, y1, w=0.45):
    obs = []
    h = w / 2
    corners = [(x - h, z - h), (x + h, z - h), (x + h, z + h), (x - h, z + h)]
    for i, (cx, cz) in enumerate(corners):
        obs.append(tube("%s_chord_%d" % (tag, i), [(cx, y0, cz), (cx, y1, cz)], 0.025, M_ALU, sides=8))
    n = int((y1 - y0) / w)
    for f in range(4):
        a, b = corners[f], corners[(f + 1) % 4]
        pts = []
        for k in range(n + 1):
            c = a if k % 2 == 0 else b
            pts.append((c[0], y0 + k * (y1 - y0) / n, c[1]))
        for k in range(n):
            obs.append(tube("%s_lace_%d_%d" % (tag, f, k), [pts[k], pts[k + 1]], 0.011, M_ALU, sides=5, caps=False))
    obs.append(gbox("%s_base" % tag, x - 0.4, x + 0.4, y0, y0 + 0.06, z - 0.4, z + 0.4, M_ALU, tile=0.5, bevel=0.01))
    return obs


def truss_horizontal(tag, x0, x1, y, z, w=0.4):
    obs = []
    h = w / 2
    corners = [(y - h, z - h), (y + h, z - h), (y + h, z + h), (y - h, z + h)]
    for i, (cy, cz) in enumerate(corners):
        obs.append(tube("%s_chord_%d" % (tag, i), [(x0, cy, cz), (x1, cy, cz)], 0.022, M_ALU, sides=8))
    n = int((x1 - x0) / w)
    for f in range(4):
        a, b = corners[f], corners[(f + 1) % 4]
        for k in range(n):
            ca, cb = (a, b) if k % 2 == 0 else (b, a)
            obs.append(tube("%s_lace_%d_%d" % (tag, f, k), [(x0 + k * (x1 - x0) / n, ca[0], ca[1]),
                                                          (x0 + (k + 1) * (x1 - x0) / n, cb[0], cb[1])], 0.01, M_ALU,
                            sides=5, caps=False))
    return obs


def par_can(tag, pos, target):
    d = tuple(target[i] - pos[i] for i in range(3))
    ln = math.sqrt(sum(v * v for v in d))
    ax = tuple(v / ln for v in d)
    obs = [lathe("%s_can" % tag, [(0.0, -0.2), (0.1, -0.2), (0.13, -0.16), (0.13, 0.12), (0.145, 0.14), (0.145, 0.2),
                                  (0.12, 0.2), (0.12, 0.15), (0.0, 0.15)], pos, ax, M_BLACKP, segs=16, cap=False)]
    obs.append(L.cyl("%s_lens" % tag, tuple(pos[i] + ax[i] * 0.16 for i in range(3)), ax, 0.118, 0.01, M_LENS, sides=16))
    obs.append(tube("%s_yoke" % tag, [(pos[0] - 0.17, pos[1] + 0.02, pos[2]), (pos[0] - 0.17, pos[1] + 0.24, pos[2]),
                                      (pos[0] + 0.17, pos[1] + 0.24, pos[2]), (pos[0] + 0.17, pos[1] + 0.02, pos[2])], 0.014,
                    M_ALU, sides=6))
    return obs


TR = []
for s in (-1, 1):
    tx, tz = s * 5.7, -12.4
    TR += truss_vertical("truss_v_%d" % s, tx, tz, DECK, 9.0)
    for k, y in enumerate((4.6, 5.8)):
        TR += par_can("par_%d_%d" % (s, k), (tx - s * 0.32, y, tz + 0.1), (s * 1.5, 3.3 - k * 1.8, -10.0 + k * 5.0))
    TR += bulb_line("truss_bulb_%d" % s, (tx - s * 0.24, 0.8, tz + 0.24), (tx - s * 0.24, 8.6, tz + 0.24), step=0.3, r=0.04)
TR += truss_horizontal("truss_h", -5.7, 5.7, 8.2, -12.4)
for k, x in enumerate((-3.0, -1.0, 1.0, 3.0)):
    TR += par_can("par_top_%d" % k, (x, 7.75, -12.4), (x * 0.4, 0.0, -2.0))
HERO["truss"] += [o for o in TR if o.name.startswith(("truss_v_-1", "par_-1_"))]

# =============================================================== bulbs node, crowd, ship
_bset = set(BULBS)
for _k in HERO:
    HERO[_k] = [o for o in HERO[_k] if o not in _bset]      # bulbs are joined into marquee_bulbs below
bulbs = L.join_objs(BULBS, "marquee_bulbs")
L.ANIM["marquee_bulbs"] = bulbs
log("bulbs", len(BULBS))
nodes = L.crowd_nodes(S)
L.env_map(HDRI, SID + "_env.hdr") if L.DO_EXPORT else None
heroes = [("giant prize wheel + stand", HERO["wheel"], 2.6), ("contestant podium", HERO["podium"], 1.5),
          ("truss tower + par cans", HERO["truss"], 2.6), ("show trapdoor", HERO["trapdoor"], 1.6)]
L.build_and_ship(S, HDRI, nodes, [("WhiteclownNHallin", "Whiteclown N Hallin.fbx", []),
                                  ("KachujinGRosales", "Kachujin G Rosales.fbx", [])],
                 extra_shots=[
                     {"id": "overview", "pos": [10.5, 6.5, 12.0], "look": [0.0, 2.0, -7.0], "fov": 52.0},
                     {"id": "wheel", "pos": [0.0, 2.8, -4.2], "look": [0.0, 3.3, -13.0], "fov": 50.0},
                     {"id": "podium", "pos": [-1.7, 1.5, -1.3], "look": [-3.35, 1.0, -4.45], "fov": 45.0},
                     {"id": "wall_r", "pos": [4.0, 1.7, 2.8], "look": [8.0, 1.8, -1.0], "fov": 50.0},
                 ], heroes=heroes)
