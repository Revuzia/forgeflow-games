"""HIT PARADE - stage 3 WHEEL OF PAIN, built headless in Blender (lane STAGES-A; 360-degree arena: lane STAGES3D-A).

CHANGED(STAGES3D-A) CONTRACT 35.6 / 35.11: a game-show studio IN THE ROUND. The fight ring is a glossy black circular
stage floor (radius 5.8 m) with concentric LED light rings and the two flush hazard-striped TRAPDOOR plates, walled by a
1.0 m show bumper (neon chevron panels = the splat surface, chrome cap rail strung with marquee bulbs, 16 chrome mullions
marking the WALL_SPLAT sectors). A clear dark floor with radial LED spokes runs to r 9.5 (the camera orbit zone); from
r 9.7: on the far side of the start camera (180 deg) the raised wheel deck with the GIANT prize wheel (16 comic prize
segments, gold bulb rim, pegs, flapper) on a lit plinth before a curved LED starburst wall, flanked by box-truss towers
with par cans and the two contestant podiums (PLAYER 1 / PLAYER 2 boards, buzzers, gooseneck mics); all the way round
the rest, four raked audience bays (6 LED-nosed tiers, chrome rail, gold stepped end panels) split by stair aisles, with
APPLAUSE / ON AIR / WHEEL OF PAIN light boxes over the aisles; four truss towers + an overhead truss ring carry the ring
spots. Lights: a fixed pool of 8 that lights the pair from every camera angle (high key + cool rim + fill + wheel spot +
four tower spots at 45 / 135 / 225 / 315 deg).

The wheel is the separate node `anim_spin_wheel` (pivot on the axle, local +Y = the axle toward the ring centre, radially
symmetric so the quantised pivot stays on the axle): the view's stage hook spins it about local Y.

Usage (run blender.exe directly so the log is visible; paths are resolved from this file):
  blender.exe --background --python art/stages/wheel_of_pain.py -- [--no-export] [--no-render] [--contact]
        [--shots id,id|orbit] [--res 1920x1080] [--samples 48] [--no-fighters] [--no-tex] [--out stage|live]
Outputs (default --out stage = _harness/scratch/stages3d_out/, swap in with `python tools/merge_stages.py --install
wheel_of_pain`): wheel_of_pain.glb + wheel_of_pain_env.hdr + wheel_of_pain.stage.json (fragment);
_harness/_reports/stages/wheel_of_pain_<shot>.png (proof renders) + wheel_of_pain_orbit_sheet.png.
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
from stagelib_a import G, gbox, cyl, tube, sphere, lathe, prism, label, obox, log, polar, annulus, place  # noqa: E402
import bmesh  # noqa: E402

SID = "wheel_of_pain"
HDRI = L.PH_HDRI + "adams_place_bridge/adams_place_bridge_2k.hdr"
RR = 5.8            # ring radius (inner face of the bumper)
WT = 0.45           # bumper thickness
WH = 1.0            # bumper height
CAM_SIDE = 0.0      # 35.11: camera starts on +Z
SPAWN_AXIS = 90.0   # P1 at x -1.2, P2 at x +1.2
DECK = 0.3          # wheel deck height
WS = 0.92           # wheel scale (top of the rim inside the near orbit frame)
HUB = (0.0, 3.0, -14.0)
RF, RO = 2.5 * WS, 2.8 * WS
TIER_R = [10.3 + 0.8 * k for k in range(6)]
TIER_Y = [0.3 + 0.4 * k for k in range(6)]
BAYS = [("bay_a", 218.0, 266.0, 3301), ("bay_b", 274.0, 356.0, 3302), ("bay_c", 4.0, 86.0, 3303),
        ("bay_d", 94.0, 142.0, 3304)]
AISLES = [270.0, 0.0, 90.0]
TOWERS = [45.0, 135.0, 225.0, 315.0]
TOWER_R = 10.05


def ring_spot(sid, az, color, inten):
    p = polar(TOWER_R - 0.3, az, 7.0)
    return {"id": sid, "type": "spot", "color": color, "intensity": inten, "distance": 24.0, "decay": 2,
            "position": [round(v, 3) for v in p], "target": [0.0, 1.0, 0.0], "angleDeg": 27.0, "penumbra": 0.55}


S = {
    "id": SID,
    "name": "WHEEL OF PAIN",
    "status": "built",
    "glb": SID + ".glb",
    "source": "art/stages/wheel_of_pain.py",
    "home": ["zambini", "lotus"],
    "look": "game-show studio in the round: glossy black circular stage floor with LED light rings and two hazard-striped "
            "trapdoor plates inside a 1 m neon-panel bumper with a chrome bulb rail; the GIANT prize wheel (16 comic "
            "prizes, gold bulb rim) on a lit deck before a curved LED starburst wall, truss towers and contestant podiums on "
            "one side; raked LED-nosed audience risers with gold end panels all the way round the rest; truss rig overhead",
    "floor": {"y": 0.0, "surface": "gloss_black", "fightStrip": {"x": [-8.0, 8.0], "z": [-1.5, 1.5]},
              "extent": {"x": [-19.0, 19.0], "z": [-19.0, 19.0]},
              "trapdoors": [{"x": -4.7, "z": 0.0, "sizeM": 1.5}, {"x": 4.7, "z": 0.0, "sizeM": 1.5}],
              "note": "trapdoors are flush dressing (texture + frame + hinges in the static set) inside the ring; a sim "
                      "trapdoor move (zambini / ricky) can use these spots. fightStrip = legacy 2.5D (CONTRACT 35.11.7)"},
    "walls": {
        "x": [-8.0, 8.0],
        "splat": [
            {"id": 0, "x": -8.0, "normal": [1, 0, 0], "z": [-3.4, 2.8], "heightM": 4.3, "surface": "neon_panel",
             "dustColor": "#ff7ad9"},
            {"id": 1, "x": 8.0, "normal": [-1, 0, 0], "z": [-3.4, 2.8], "heightM": 4.3, "surface": "neon_panel",
             "dustColor": "#7ae4ff"},
        ],
        "note": "LEGACY 2.5D (CONTRACT 35.11.7): kept until the sim / view stop reading walls.x; the 3D boundary is `ring`.",
    },
    "ring": L.ring_block("circle", RR, WH, WT, "neon_panel", "#ff7ad9", rot=0.0),
    "spawnAxisDeg": SPAWN_AXIS,
    "cameraSideDeg": CAM_SIDE,
    "cameraMaxM": 9.5,
    "spawn": L.spawn_block(SPAWN_AXIS, 2.4),
    "camera": L.camera_block_3d(SID, CAM_SIDE),
    "exposure": 1.0,
    "toneMapping": "neutral",
    "fog": {"color": "#140b1f", "near": 18.0, "far": 60.0},
    "environment": {"hdr": SID + "_env.hdr", "intensity": 0.3, "background": False,
                    "src": "Poly Haven adams_place_bridge_2k.hdr (CC0), downsampled to 512x256",
                    "backgroundColor": "#0a0610"},
    "lights": [
        {"id": "key", "type": "directional", "color": "#f6ecff", "intensity": 2.1,
         "position": [round(v, 3) for v in polar(9.0, 200.0, 14.0)], "target": [0.0, 1.0, 0.0], "castShadow": True,
         "shadow": {"mapSize": 1024, "bias": -0.0004, "normalBias": 0.03,
                    "camera": {"left": -9.0, "right": 9.0, "top": 9.0, "bottom": -9.0, "near": 1.0, "far": 40.0}}},
        {"id": "rim", "type": "directional", "color": "#62dcff", "intensity": 1.5,
         "position": [round(v, 3) for v in polar(10.0, 20.0, 7.0)], "target": [0.0, 1.2, 0.0], "castShadow": False},
        {"id": "fill", "type": "hemisphere", "sky": "#9a88ff", "ground": "#2b1233", "intensity": 0.85},
        {"id": "wheel_spot", "type": "spot", "color": "#fff3e0", "intensity": 150.0, "distance": 30.0, "decay": 2,
         "position": [0.0, 9.0, -8.0], "target": [HUB[0], HUB[1], HUB[2]], "angleDeg": 20.0, "penumbra": 0.45},
        ring_spot("spot_45", 45.0, "#ffe6c8", 105.0),
        ring_spot("spot_135", 135.0, "#ffc8ee", 95.0),
        ring_spot("spot_225", 225.0, "#cdefff", 95.0),
        ring_spot("spot_315", 315.0, "#ffe6c8", 105.0),
    ],
    "lightsNote": "FIXED pool (8): created once at stage load, never added/removed (shader programs stay warm). No lights "
                  "in the GLB. 360 rig (CONTRACT 35.6): high key from the wheel side + cool rim from the opposite side + "
                  "hemisphere fill + wheel spot + four tower spots (45/135/225/315 deg) aimed at the ring centre, so the "
                  "pair is front-lit from whichever side the orbit camera sits.",
    "crowd": L.crowd_block("#dccfe8", 0.56, [
        {"id": bid, "arcDeg": [a0, a1], "spacing": 0.62, "jitter": [0.12, 0.08], "seed": seed,
         "rows": [{"r": round(r, 3), "y": round(y, 3)} for r, y in zip(TIER_R, TIER_Y)]}
        for bid, a0, a1, seed in BAYS]),
    "music": "music_stage_wheel_of_pain",
    "musicHint": "AUDIO lane maps the id (router: music_stage_<stageId> -> cue <stageId>)",
    "ambient": "amb_wheel_of_pain",
    "ambientHint": "AUDIO 9.2 item 2 loop (neon buzz + wheel ticks: 16 pegs x 0.8 rad/s = ~2 clicks/s) under the crowd "
                   "bed; applause-sign stingers",
    "dressing": {
        "animated": [
            {"what": "giant prize wheel", "nodes": "anim_spin_wheel",
             "how": "view stage hook anim_spin_*: rotation.y += dt * 0.8 about the node's local +Y = the axle (glTF +Z, "
                    "toward the ring centre); pivot on the axle"},
            {"what": "marquee bulbs", "nodes": "marquee_bulbs", "how": "optional chase pattern on emissive intensity"},
            {"what": "crowd", "how": "instanced cards, vertex bob/sway, pose swaps by ratings mood"},
        ],
        "splatWallDust": "#ff7ad9",
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


def bulb_arc(tag, rad, y, a0, a1, step=0.5, r=0.04):
    n = max(1, int(abs(math.radians(a1 - a0)) * rad / step))
    full = abs(abs(a1 - a0) - 360.0) < 1e-6
    return [bulb("%s_%d" % (tag, k), polar(rad, a0 + (a1 - a0) * k / n, y), r) for k in range(n if full else n + 1)]


def arc_pts(rad, y, a0, a1, step_deg=3.0):
    n = max(2, int(abs(a1 - a0) / step_deg) + 1)
    return [polar(rad, a0 + (a1 - a0) * k / (n - 1), y) for k in range(n)]


def segs_for(a0, a1, deg=2.5):
    return max(4, int(round(abs(a1 - a0) / deg)))


# =============================================================== floor: stage disc, LED rings, trapdoors, spokes
log("floor")
gbox("floor_base", -20.0, 20.0, -0.2, -0.003, -20.0, 20.0, M_BLACKP, tile=3.0)
L.disc("stage_disc", RR + 0.02, 0.0, M_FLOOR, segs=96, tile=2.4)
for (r0, r1, m) in ((1.5, 1.56, M_RING), (3.55, 3.59, M_LEDC), (5.5, 5.56, M_RING)):
    annulus("floor_ring_%.2f" % r0, r0, r1, 0.0, 0.003, m, segs=96, parts=("top", "in", "out"), tile=1.0)
for s in (-1, 1):
    tx = s * 4.7
    tr = []
    tr.append(L.quad("trap_plate_%d" % s, [(tx - 0.75, 0.004, 0.75), (tx + 0.75, 0.004, 0.75), (tx + 0.75, 0.004, -0.75),
                                           (tx - 0.75, 0.004, -0.75)], M_TRAP))
    for (x0, x1, z0, z1) in ((tx - 0.8, tx + 0.8, 0.75, 0.8), (tx - 0.8, tx + 0.8, -0.8, -0.75),
                             (tx - 0.8, tx - 0.75, -0.75, 0.75), (tx + 0.75, tx + 0.8, -0.75, 0.75)):
        tr.append(gbox("trap_frame_%d_%.2f_%.2f" % (s, x0, z0), x0, x1, -0.01, 0.007, z0, z1, M_ALU, tile=0.5, bevel=0.002))
    for k in range(3):
        tr.append(cyl("trap_hinge_%d_%d" % (s, k), (tx - 0.5 + k * 0.5, 0.013, -0.735), (1, 0, 0), 0.022, 0.16, M_ALU,
                      sides=10))
    if s < 0:
        HERO["trapdoor"] += tr
# radial LED spokes across the clear orbit zone + an outer LED ring at its edge (all flush: y <= 0.004)
for k in range(16):
    a = 11.25 + 22.5 * k
    obox("spoke_%d" % k, polar(7.95, a, 0.0015), (0.06, 0.003, 2.9), a, M_LEDC if k % 2 else M_LEDM, tile=1.0)
annulus("floor_ring_outer", 9.42, 9.48, -0.003, 0.003, M_LEDC, segs=128, parts=("top", "in", "out"), tile=1.0)

# =============================================================== the ring bumper (splat surface, r 5.8, 1.0 m)
log("ring bumper")
annulus("bump_kick", RR, RR + WT, 0.0, 0.22, M_BLACKP, segs=96, parts=("in", "out"), tile=1.0)
annulus("bump_panel", RR, RR + WT, 0.22, 0.86, M_NEON, segs=96, parts=("in", "out"), tile=1.0)
annulus("bump_cap", RR - 0.04, RR + WT + 0.04, 0.86, WH, M_ALU, segs=96, tile=1.0)
annulus("bump_kick_led", RR - 0.006, RR - 0.001, 0.15, 0.18, M_LEDM, segs=96, parts=("in",), tile=1.0)
annulus("bump_kick_led_o", RR + WT + 0.001, RR + WT + 0.006, 0.15, 0.18, M_LEDC, segs=96, parts=("out",), tile=1.0)
for k in range(16):                      # mullions at the WALL_SPLAT sector boundaries (sector k centred on k*22.5)
    a = 11.25 + 22.5 * k
    obox("bump_mullion_%d" % k, polar(RR - 0.03, a, 0.54), (0.1, 0.64, 0.06), a, M_ALU, tile=0.5, bevel=0.012)
    obox("bump_mullion_o_%d" % k, polar(RR + WT + 0.03, a, 0.54), (0.1, 0.64, 0.06), a, M_ALU, tile=0.5, bevel=0.012)
# bulbs on the cap's INNER lip (seen across the ring; an orbit camera outside the bumper never has them in its face)
bulb_arc("bump_bulb", RR - 0.06, 0.93, 0.0, 360.0, step=0.45, r=0.036)

# =============================================================== audience bays (4 arcs, 6 tiers each)
log("audience")


def tier_profile():
    """(r, y) stepped silhouette of a bay end (for the gold end panels)"""
    top = 0.45
    pts = [(TIER_R[0] - 0.5, 0.0), (TIER_R[-1] + 0.45, 0.0), (TIER_R[-1] + 0.45, TIER_Y[-1] + top)]
    for k in range(5, -1, -1):
        pts.append((TIER_R[k] - 0.4, TIER_Y[k] + top))
        if k > 0:
            pts.append((TIER_R[k] - 0.4, TIER_Y[k - 1] + top))
    pts.append((TIER_R[0] - 0.5, TIER_Y[0] + top))
    return pts


def end_panel(name, a, mat, thick=0.16):
    """gold stepped panel standing radially at angle a (prism local x = inward radial -> x = -r)"""
    t = (math.cos(math.radians(a)), 0.0, -math.sin(math.radians(a)))
    poly = [(-r, y) for (r, y) in tier_profile()]
    return prism(name, poly, thick, mat, center_g=(0.0, 0.0, 0.0), face_g=t, up_g=(0, 1, 0), bevel=0.012, segs=1)


for bid, a0, a1, seed in BAYS:
    sg = segs_for(a0, a1)
    for k in range(6):
        annulus("tier_%s_%d" % (bid, k), TIER_R[k] - 0.4, TIER_R[k] + 0.4, 0.0, TIER_Y[k], M_BLACKP, segs=sg, a0=a0,
                a1=a1, tile=2.0, parts=("in", "top", "ends"))
        annulus("tier_led_%s_%d" % (bid, k), TIER_R[k] - 0.405, TIER_R[k] - 0.4, TIER_Y[k] - 0.05, TIER_Y[k] - 0.02,
                M_LEDC if k % 2 == 0 else M_LEDM, segs=sg, a0=a0, a1=a1, parts=("in",), tile=1.0)
    for s_, a in ((0, a0), (1, a1)):
        end_panel("bay_end_%s_%d" % (bid, s_), a, M_GOLDW)
        bulb_line("bay_end_bulb_%s_%d" % (bid, s_), polar(TIER_R[0] - 0.52, a, 0.12),
                  polar(TIER_R[0] - 0.52, a, TIER_Y[0] + 0.4), step=0.16, r=0.035)
    # chrome rail in front of the bay (r 9.85, beyond the 9.5 m camera orbit)
    tube("bay_rail_%s" % bid, arc_pts(9.86, 1.0, a0 + 0.8, a1 - 0.8), 0.026, M_ALU, sides=10)
    tube("bay_rail_lo_%s" % bid, arc_pts(9.86, 0.5, a0 + 0.8, a1 - 0.8), 0.018, M_ALU, sides=8)
    n = max(2, int(math.radians(a1 - a0) * 9.86 / 1.6) + 1)
    for k in range(n):
        a = a0 + 0.8 + (a1 - a0 - 1.6) * k / (n - 1)
        tube("bay_post_%s_%d" % (bid, k), [polar(9.86, a, 0.0), polar(9.86, a, 1.0)], 0.022, M_ALU, sides=8)
    # back wall with a gold trim + LED strip
    annulus("bay_back_%s" % bid, TIER_R[-1] + 0.4, TIER_R[-1] + 0.7, 0.0, 3.6, M_BLACKP, segs=sg, a0=a0 - 2, a1=a1 + 2,
            tile=2.0, parts=("in", "top", "ends"))
    annulus("bay_back_trim_%s" % bid, TIER_R[-1] + 0.36, TIER_R[-1] + 0.74, 3.6, 3.72, M_GOLDW, segs=sg, a0=a0 - 2,
            a1=a1 + 2, tile=1.2)
    annulus("bay_back_led_%s" % bid, TIER_R[-1] + 0.395, TIER_R[-1] + 0.4, 3.3, 3.34, M_LEDM, segs=sg, a0=a0 - 2,
            a1=a1 + 2, parts=("in",), tile=1.0)

# stair aisles between the bays
for a in AISLES:
    for k in range(12):
        r = TIER_R[0] - 0.3 + 0.4 * k
        y = min(TIER_Y[-1], 0.2 * (k + 1))
        obox("aisle_step_%d_%d" % (a, k), polar(r, a, y / 2), (1.3, y, 0.4), a, M_BLACKP, tile=1.0)
        obox("aisle_nose_%d_%d" % (a, k), polar(r - 0.2, a, y - 0.02), (1.3, 0.025, 0.012), a, M_LEDC, tile=1.0)
# light boxes over the aisles: ON AIR (+X, 90), APPLAUSE (-X, 270), WHEEL OF PAIN title (behind the start camera, 0)
for a, rect, w in ((90.0, (512, 768, 1024, 1024), 1.3), (270.0, (0, 768, 512, 1024), 1.3), (0.0, (0, 512, 1024, 768), 3.2)):
    h = w * (rect[3] - rect[1]) / (rect[2] - rect[0])
    face = (a + 180.0) % 360.0
    obox("lightbox_%d" % a, polar(TIER_R[-1] + 0.62, a, 4.35), (w + 0.12, h + 0.12, 0.16), face, M_BLACKP, tile=0.5,
         bevel=0.02)
    label("lightbox_face_%d" % a, polar(TIER_R[-1] + 0.53, a, 4.35), w, h, rect, (1024, 1024), M_LABEL, yaw_deg=face)
    c_ = polar(TIER_R[-1] + 0.5, a, 4.35 + h / 2 + 0.1)
    t_ = (math.cos(math.radians(a)) * (w / 2 + 0.04), 0.0, -math.sin(math.radians(a)) * (w / 2 + 0.04))
    bulb_line("lightbox_bulb_t_%d" % a, tuple(c_[i] - t_[i] for i in range(3)), tuple(c_[i] + t_[i] for i in range(3)),
              step=0.2, r=0.035)

# =============================================================== the wheel deck (180 deg side) + runway LEDs
log("deck")
DA0, DA1 = 146.0, 214.0
annulus("deck", 9.7, 19.0, 0.0, DECK, M_BLACKP, segs=segs_for(DA0, DA1), a0=DA0, a1=DA1, tile=2.4,
        parts=("top", "in", "ends"))
annulus("deck_nose", 9.68, 9.72, DECK - 0.03, DECK + 0.004, M_ALU, segs=segs_for(DA0, DA1), a0=DA0, a1=DA1, tile=1.0)
annulus("deck_led", 9.695, 9.7, 0.235, 0.262, M_LEDM, segs=segs_for(DA0, DA1), a0=DA0, a1=DA1, parts=("in",), tile=1.0)
bulb_arc("edge_bulb", 9.68, 0.13, DA0 + 0.5, DA1 - 0.5, step=0.25, r=0.035)
for s in (-1, 1):
    gbox("runway_led_%d" % s, s * 1.62 - 0.025, s * 1.62 + 0.025, DECK, DECK + 0.004, -13.0, -9.8, M_LEDC, tile=1.0)

# =============================================================== contestant podiums (on the deck, flanking the wheel)
log("podiums")


def podium(tag, body_mat, rect):
    """built at the origin facing +Z (base y = DECK), then placed"""
    z = 0.0
    x = 0.0
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
    ob.append(tube("pod_mic_neck_%s" % tag, [(x - 0.3, DECK + 1.094, z - 0.05), (x - 0.3, DECK + 1.3, z - 0.02),
                                             (x - 0.28, DECK + 1.42, z + 0.08), (x - 0.25, DECK + 1.46, z + 0.2)], 0.009,
                   M_BLACKP, sides=6))
    ob.append(lathe("pod_mic_head_%s" % tag, [(0.0, 0.0), (0.022, 0.0), (0.026, 0.03), (0.022, 0.07), (0.0, 0.075)],
                    (x - 0.25, DECK + 1.46, z + 0.2), (0, -0.2, 1), M_BLACKP, segs=12))
    return ob


for tag, a, mat, rect in (("p1", 208.0, M_BLUE, (0, 0, 1024, 256)), ("p2", 152.0, M_VIOLET, (0, 256, 1024, 512))):
    obs = podium(tag, mat, rect)
    place(obs, polar(10.7, a, 0.0), (a + 180.0) % 360.0)
    if tag == "p1":
        HERO["podium"] += obs

# =============================================================== the GIANT prize wheel (anim_spin_wheel)
log("wheel")


def wdisc(name, center_g, r, mat, rings=6, segs=64, facing=1):
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
wparts.append(wdisc("wheel_face", (hx, hy, hz + 0.001), RF, M_WHEEL))
wparts.append(wdisc("wheel_back", (hx, hy, hz - 0.12), RF, M_BLACKP, facing=-1))
wparts.append(lathe("wheel_rim", [(RF - 0.03, -0.16), (RO - 0.06, -0.16), (RO, -0.1), (RO + 0.02, 0.0), (RO, 0.1),
                                  (RO - 0.06, 0.16), (RF - 0.03, 0.16), (RF - 0.03, 0.02)], HUB, (0, 0, 1), M_GOLD, segs=96,
                    smooth=40, cap=False))
for k in range(16):
    a = 2 * math.pi * k / 16
    px, py = hx + 2.36 * WS * math.cos(a), hy + 2.36 * WS * math.sin(a)
    wparts.append(cyl("wheel_peg_%d" % k, (px, py, hz + 0.08), (0, 0, 1), 0.032, 0.16, M_ALU, sides=10))
    wparts.append(sphere("wheel_pegcap_%d" % k, (px, py, hz + 0.165), 0.042, M_ALU, seg=10, rings=6))
for k in range(48):
    a = 2 * math.pi * (k + 0.5) / 48
    wparts.append(sphere("wheel_bulb_%d" % k, (hx + (RF + RO) / 2 * math.cos(a), hy + (RF + RO) / 2 * math.sin(a), hz + 0.17),
                         0.05, M_BULB, seg=8, rings=5))
wparts.append(lathe("wheel_hub", [(0.52, 0.0), (0.51, 0.05), (0.46, 0.12), (0.37, 0.19), (0.22, 0.24), (0.0, 0.26)],
                    (hx, hy, hz + 0.002), (0, 0, 1), M_ALU, segs=48, cap=False))
wparts.append(lathe("wheel_hub_ring", [(0.5, 0.0), (0.63, 0.0), (0.65, 0.04), (0.63, 0.08), (0.5, 0.08)],
                    (hx, hy, hz + 0.002), (0, 0, 1), M_GOLD, segs=48, cap=False))
wparts.append(sphere("wheel_hub_button", (hx, hy, hz + 0.27), 0.11, M_RED, seg=20, rings=10, scale=(1, 1, 0.55)))
for k in range(8):
    a = 2 * math.pi * k / 8
    wparts.append(cyl("wheel_hub_bolt_%d" % k, (hx + 0.57 * math.cos(a), hy + 0.57 * math.sin(a), hz + 0.09), (0, 0, 1),
                      0.022, 0.03, M_ALU, sides=8))
wheel = L.join_objs(wparts, "anim_spin_wheel")
L.reorigin(wheel, HUB, rot_blender=(math.pi / 2, 0.0, 0.0))
L.ANIM[wheel.name] = wheel
HERO["wheel"].append(wheel)

# stand, flapper, plinth, title sign (all on the deck)
st = []
PL = 0.12
for s in (-1, 1):
    st.append(tube("stand_leg_%d" % s, [(s * 1.85, DECK + PL, hz - 0.62), (s * 0.3, hy, hz - 0.45)], 0.085, M_ALU, sides=16))
    st.append(gbox("stand_foot_%d" % s, s * 1.85 - 0.26, s * 1.85 + 0.26, DECK + PL, DECK + PL + 0.08, hz - 0.85, hz - 0.4,
                   M_ALU, tile=0.5, bevel=0.02))
st.append(tube("stand_brace", [(-1.4, 1.35, hz - 0.58), (1.4, 1.35, hz - 0.58)], 0.055, M_ALU, sides=12))
st.append(cyl("stand_axle", (hx, hy, hz - 0.34), (0, 0, 1), 0.22, 0.34, M_ALU, sides=24, bevel=0.02))
FX = RO + 0.5
st.append(tube("flapper_post", [(FX, DECK + PL, hz + 0.3), (FX, hy + 0.32, hz + 0.3)], 0.05, M_ALU, sides=12))
st.append(gbox("flapper_clamp", FX - 0.1, FX + 0.1, hy - 0.12, hy + 0.12, hz + 0.23, hz + 0.39, M_ALU, tile=0.3, bevel=0.02))
st.append(prism("flapper", [(0.0, 0.14), (0.0, -0.14), (-0.6, 0.0)], 0.05, M_RED, center_g=(FX - 0.06, hy, hz + 0.31),
                face_g=(0, 0, 1), up_g=(0, 1, 0), bevel=0.012, segs=2))
st.append(lathe("plinth", [(0.0, PL), (3.1, PL), (3.2, PL - 0.03), (3.2, 0.0), (0.0, 0.0)], (hx, DECK, hz), (0, 1, 0),
                M_BLACKP, segs=64, cap=False))
st.append(lathe("plinth_led", [(3.202, 0.03), (3.21, 0.03), (3.21, 0.08), (3.202, 0.08)], (hx, DECK, hz), (0, 1, 0), M_LEDM,
                segs=64, cap=False))
ts_z = hz + 0.72
st.append(gbox("title_box", -1.65, 1.65, DECK + PL, DECK + 0.9, ts_z - 0.14, ts_z + 0.12, M_VIOLET, tile=0.8, bevel=0.03))
st.append(label("title_face", (0.0, DECK + 0.52, ts_z + 0.12), 2.8, 0.7, (0, 512, 1024, 768), (1024, 1024), M_LABEL))
st += bulb_line("title_bulb_t", (-1.58, DECK + 0.85, ts_z + 0.13), (1.58, DECK + 0.85, ts_z + 0.13), step=0.2, r=0.032)
st += bulb_line("title_bulb_b", (-1.58, DECK + 0.19, ts_z + 0.13), (1.58, DECK + 0.19, ts_z + 0.13), step=0.2, r=0.032)
HERO["wheel"] += st

# =============================================================== LED backdrop (curved) + hall + truss rig
log("backdrop + hall + truss")
BA0, BA1 = 210.0, 150.0
annulus("led_wall", 18.8, 19.0, DECK, DECK + 12.7, M_LED, segs=24, a0=BA0, a1=BA1, tile=36.0, tile_v=12.7,
        uv_off=(0.5 - (math.radians(60.0) * 18.8 / 36.0) / 2, -DECK / 12.7), parts=("in",))
annulus("led_wall_back", 19.0, 19.3, 0.0, 13.4, M_BLACKP, segs=24, a0=BA0 + 1, a1=BA1 - 1, tile=3.0, parts=("in", "top", "ends"))
annulus("led_wall_frame", 18.75, 18.85, DECK - 0.05, DECK + 0.1, M_ALU, segs=24, a0=BA0, a1=BA1, tile=1.0)
HA0, HA1 = 210.0, 510.0
annulus("hall_wall", 19.0, 19.4, 0.0, 12.0, M_BLACKP, segs=120, a0=HA0, a1=HA1, tile=3.0, parts=("in", "top", "ends"))
for k in range(30):
    a = HA0 + 5.0 + 10.0 * k
    obox("hall_led_%d" % k, polar(18.97, a, 6.4), (0.08, 9.0, 0.02), (a + 180.0) % 360.0, M_LEDC if k % 2 else M_LEDM,
         tile=1.0)


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
    n = max(1, int((x1 - x0) / w))
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
# wheel towers (on the deck, flanking the wheel)
for s in (-1, 1):
    a = 180.0 - s * 17.0
    tx, _, tz = polar(13.2, a, 0.0)
    TR += truss_vertical("truss_v_%d" % s, tx, tz, DECK, 8.6)
    for k, y in enumerate((4.4, 5.4)):
        TR += par_can("par_%d_%d" % (s, k), (tx - s * 0.32, y, tz + 0.2), (s * 1.2, 1.2 + k * 1.6, -3.0 + k * 4.0))
    TR += bulb_line("truss_bulb_%d" % s, (tx - s * 0.24, 0.8, tz + 0.24), (tx - s * 0.24, 8.3, tz + 0.24), step=0.3, r=0.04)
TR += truss_horizontal("truss_h", polar(13.2, 197.0)[0], polar(13.2, 163.0)[0], 8.2, polar(13.2, 180.0 - 17.0)[2])
# ring towers at 45 / 135 / 225 / 315 deg (nearest chord r ~9.7 > cameraMaxM 9.5) + par cans above the camera band
for a in TOWERS:
    tx, _, tz = polar(TOWER_R, a, 0.0)
    TR += truss_vertical("truss_ring_v_%d" % a, tx, tz, 0.0, 7.6)
    for k, y in enumerate((4.3, 5.3)):
        p = polar(TOWER_R - 0.34, a, y)
        TR += par_can("par_ring_%d_%d" % (a, k), p, (0.0, 1.0 + k * 0.4, 0.0))
    TR += bulb_line("truss_ring_bulb_%d" % a, polar(TOWER_R - 0.25, a, 3.2), polar(TOWER_R - 0.25, a, 7.3), step=0.3, r=0.04)
# overhead truss ring (24 chords at y 7.6) + 8 hanging par cans
NRING = 24
for k in range(NRING):
    am = 360.0 * (k + 0.5) / NRING
    half = TOWER_R * math.sin(math.radians(180.0 / NRING))
    seg = truss_horizontal("truss_ring_%d" % k, -half, half, 7.6, 0.0)
    place(seg, polar(TOWER_R * math.cos(math.radians(180.0 / NRING)), am, 0.0), (am + 180.0) % 360.0)
    TR += seg
for k in range(8):
    a = 22.5 + 45.0 * k
    TR += par_can("par_top_%d" % k, polar(TOWER_R - 0.1, a, 7.2), (0.0, 0.8, 0.0))
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
                     {"id": "overview", "pos": [13.0, 9.0, 13.0], "look": [0.0, 1.5, -2.0], "fov": 60.0},
                     {"id": "top", "pos": [0.0, 30.0, 0.01], "look": [0.0, 0.0, 0.0], "fov": 70.0},
                     {"id": "wheel", "pos": [0.0, 2.6, -5.0], "look": [0.0, 3.0, -14.0], "fov": 50.0},
                 ], heroes=heroes)
