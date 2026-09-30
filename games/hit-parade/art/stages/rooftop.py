"""HIT PARADE - stage 4 CHANNEL 13 ROOFTOP, built headless in Blender (lanes STAGES-B P2, STAGES3D-B 3D ring).

3D RING (CONTRACT 35.6 / 35.11, owner: "it should be 3d or circular where we can walk around the ring to fight"): the show
goes up on the roof of the CHANNEL 13 building on a wet night and the fight is a 360-degree ring - a painted helipad-style
circle (radius 5.5 m) on the bitumen roof, bounded by a concrete curb with a hazard face and a cable railing on 16 posts
(one per WALL_SPLAT sector). Everything else stands outside a 9.5 m camera-clear radius, on ALL sides: north = aluminium
bleachers packed with the crowd under the big neon HIT PARADE sign; south = a second bleacher bank under the show's
printed billboard; west = the brick stair bulkhead whose door opens onto the ring (paver path), standing crowd on both
flanks; east = the corrugated elevator machine room, standing crowd on both flanks; the diagonals = four lighting truss
towers with floods, and behind them the wooden water tank, the rooftop HVAC units + AC row, the skylight + vents, the
station's lattice broadcast mast with red aviation lights; string lights between the tower tops over the ring; steel
crowd barricades; the lit city skyline all around under the jp_Sky_Night_4a night sky; rain everywhere (node rain_fall).

Usage (blender.exe directly so the log is visible; paths are resolved from this file):
  blender.exe --background --python art/stages/rooftop.py -- [--no-export] [--no-render] [--no-art] [--no-finish]
        [--shots id,id] [--res 1920x1080] [--samples 48] [--no-fighters] [--contact] [--orbit-only] [--no-orbit]
Outputs (STAGED until `python art/stages/stagefinish_b.py rooftop --swap`):
  _harness/scratch/stages_cache/rooftop_raw.glb -> _harness/scratch/stages_cache/out3d/rooftop.glb (chain D)
  _harness/scratch/stages_cache/out3d/rooftop_env.hdr     (512x256 IBL for the view, from jp_Sky_Night_4a.exr)
  _harness/scratch/stages_cache/out3d/rooftop.stage.json  (StageDef fragment, CONTRACT 21.2 + 35.11)
  _harness/_reports/stages/rooftop_<shot>.png + rooftop_orbit_<near|far>_<k>.png (orbit proof renders + sheets)
The StageDef below is the source of truth; the build reads it (ring, lights, fog, crowd bays, proof cameras).
Sources (read-only): Poly Haven bitumen / bicolour_gravel / asbestos_sheet_02 (CC0); Japan Village (Unity EULA):
JP_Red_Brick, JP_Concrete, JP_Conditioner textures, JP_Conditioner_01/05/07, JP_Electric_Meter_01/02, JP_Hatch_01 models,
JP_Sky_Night_4a.exr (sky + IBL); FANTASTIC planks (EULA, stages cache); the game's OFL fonts (Bungee for the neon).
Everything else is procedural here; 2D art is art2d_b.py. ASCII only.
"""
import bpy
import bmesh
import sys
import os
import math
from mathutils import Vector, Matrix
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True
import stagekit_b as K  # noqa: E402
from stagekit_b import G, gbox, obox, tube, cyl, sphere, lathe, quad, catenary, mat_pbr, mat_unlit, bolts  # noqa: E402

JP_SKY = K.JPT + "HDRI/JP_Sky_Night_4a.exr"

RING_R = 5.5              # CONTRACT 35.11 ring.radiusM (the boundary the push cylinders collide with)
CLEAR_R = 9.5             # nothing of the set between y 1.15 and 4.5 m inside this radius (measured at build)
TOWER_R = 11.2            # truss towers on the diagonals
TOWERS = [45.0, 135.0, 225.0, 315.0]

CAMERA = {
    "vFovDeg": 35.0, "heightM": 1.35, "lookAtY": 1.0, "pitchDeg": -4.0, "distanceM": [4.4, 9.5], "orbit": True,
    "clearRadiusM": None, "clearBandM": [1.15, 4.5],
    "note": "CONTRACT 35.7 orbit camera: position = pair midpoint + camN * dist + up * 1.35 m, pitch -4 deg. "
            "clearRadiusM = measured at build (also build.clearance, CONTRACT 35.11.5). proofShots = the orbit set "
            "orbit_<deg>_<n|f> (CONTRACT 35.11.7: 8 angles from cameraSideDeg, 4.4 / 8.0 m, eye 1.35, look-at (0, 1.0, 0)) "
            "+ near_center / far_center aliases of orbit_000_n / _f. "
            "Proof renders: _harness/_reports/stages/rooftop_*.png",
    "proofShots": K.proof_shot_list(0.0),
}

STAGE = {
    "id": "rooftop",
    "name": "CHANNEL 13 ROOFTOP",
    "status": "built",
    "glb": "rooftop.glb",
    "source": "art/stages/rooftop.py",
    "home": ["patch", "spin", "gazza"],
    "look": "a 360-degree ring on the roof of the CHANNEL 13 building on a wet night: a painted helipad circle with a worn "
            "13 emblem inside a concrete curb and a cable railing; around it bleachers packed with the crowd under a big "
            "neon HIT PARADE sign and under the show billboard, the brick stair bulkhead and the corrugated machine room "
            "with standing crowds, four truss towers with floods and string lights over the ring, the wooden water tank, "
            "rooftop units, the station's lattice mast; the lit city skyline all around under a purple night sky; rain",
    "ring": {"shape": "circle", "centre": [0.0, 0.0], "radiusM": RING_R, "sides": 16, "rotDeg": 0.0, "wallHeightM": 0.96,
             "thicknessM": 0.35, "dustColor": "#7d8986",
             "surface": "cable_railing",
             "note": "CONTRACT 35.11: circle -> 16 WALL_SPLAT sectors (b = sector at yaw 22.5 b +- 11.25); the 16 railing "
                     "posts stand on the sector borders (yaw 11.25 + 22.5 k); concrete curb r 5.5..5.85 x 0.17 m, "
                     "3 cables at 0.36 / 0.62 / 0.88 m (top one in red vinyl), post caps 0.96 m (kept low: the orbit camera "
                     "outside the ring at 8 m still sees the fighters' feet over it)"},
    "spawnAxisDeg": 90.0,
    "cameraSideDeg": 0.0,
    "cameraMaxM": 9.5,
    "floor": {"y": 0.0, "surface": "wet_bitumen", "fightStrip": {"x": [-8.0, 8.0], "z": [-1.5, 1.5]},
              "extent": {"x": [-26.0, 26.0], "z": [-26.0, 26.0]},
              "note": "fightStrip is LEGACY (P1 plane, CONTRACT 35.6); the fight area is `ring`"},
    "walls": {
        "x": [-8.0, 8.0],
        "splat": [
            {"id": 0, "x": -8.0, "normal": [1, 0, 0], "z": [-3.4, 3.4], "heightM": 1.1, "surface": "cable_railing",
             "dustColor": "#7d8986"},
            {"id": 1, "x": 8.0, "normal": [-1, 0, 0], "z": [-3.4, 3.4], "heightM": 1.1, "surface": "cable_railing",
             "dustColor": "#7d8986"},
        ],
        "note": "LEGACY (P1 plane walls at x -8 / +8) kept until the sim reads `ring` (CONTRACT 35.6); in 3D every "
                "WALL_SPLAT sector of the ring is the cable railing (dust #7d8986)",
    },
    "spawn": {"distanceM": 2.40, "p1": [-1.2, 0.0, 0.0], "p2": [1.2, 0.0, 0.0]},
    "camera": CAMERA,
    "exposure": 1.15,
    "toneMapping": "neutral",
    "fog": {"color": "#241d3a", "near": 30.0, "far": 200.0},
    "environment": {"hdr": "rooftop_env.hdr", "intensity": 0.75, "background": False,
                    "src": "Japan Village JP_Sky_Night_4a.exr (Unity Asset Store EULA), downsampled to 512x256",
                    "backgroundColor": "#161226"},
    "lights": [
        {"id": "key", "type": "directional", "color": "#aebfff", "intensity": 2.2,
         "position": [-5.0, 13.0, 7.0], "target": [0.0, 0.6, 0.0], "castShadow": True,
         "shadow": {"mapSize": 1024, "bias": -0.0004, "normalBias": 0.03,
                    "camera": {"left": -7.5, "right": 7.5, "top": 7.5, "bottom": -7.5, "near": 1.0, "far": 40.0}}},
        {"id": "rim", "type": "directional", "color": "#ff66b8", "intensity": 1.05,
         "position": [4.0, 6.0, -13.0], "target": [0.0, 1.2, 0.0], "castShadow": False},
        {"id": "fill", "type": "hemisphere", "sky": "#3a4786", "ground": "#1e1822", "intensity": 0.95},
        {"id": "neon", "type": "point", "color": "#ff3d9a", "intensity": 32.0, "distance": 17.0, "decay": 2,
         "position": [0.0, 4.3, -13.9], "flicker": {"amp": 0.06, "hz": 11.0}},
        {"id": "flood_a", "type": "spot", "color": "#fff0d6", "intensity": 270.0, "distance": 26.0, "decay": 2,
         "position": [7.6, 5.0, -7.6], "target": [0.0, 0.7, 0.0], "angleDeg": 25.0, "penumbra": 0.55},
        {"id": "flood_b", "type": "spot", "color": "#fff0d6", "intensity": 270.0, "distance": 26.0, "decay": 2,
         "position": [-7.6, 5.0, 7.6], "target": [0.0, 0.7, 0.0], "angleDeg": 25.0, "penumbra": 0.55},
        {"id": "door_lamp", "type": "point", "color": "#ffb46a", "intensity": 6.0, "distance": 7.0, "decay": 2,
         "position": [-10.15, 2.8, -1.05], "flicker": {"amp": 0.08, "hz": 9.0}},
    ],
    "lightsNote": "FIXED pool: created once at stage load, never added/removed (shader programs stay warm). "
                  "No lights are embedded in the GLB. Flicker = view-only intensity modulation. 3D ring: key from high "
                  "above (every orbit angle lit), two floods from opposite truss towers (a = 135 / 315) cross on the ring, "
                  "neon glow from the north sign, rim from the neon side, amber lamp at the stair door (west).",
    "crowd": {
        "atlas": "crowd_atlas.webp", "meta": "crowd_atlas.json", "cols": 12, "rows": 6, "count": 72,
        "cardHeightM": 2.4, "cardWidthM": 1.2, "anchor": [0.5, 0.97917],
        "tint": "#c0bce4", "brightness": 0.44,
        "moods": {"idle": ["watch"], "cheer": ["cheer", "hype"], "jeer": ["jeer"]},
        "nodes": "GLB empties crowd_<bay>_<row>_<i>: position = feet point, +Z = card facing, uniform scale = card "
                 "height; extras {bay,row,i,rand,angle}. Generated from the bays below: rows run along LOCAL x (x step = "
                 "spacing, jitter = [x,z] half-ranges from mulberry32(seed), gapPct = share of empty spots), facing local "
                 "+Z (the ring), then the bay is yawed about the ring centre by rotDeg (CONTRACT 35.11).",
        "bays": [
            {"id": "north", "x": [-5.9, 5.9], "spacing": 0.62, "jitter": [0.12, 0.06], "faceYawDeg": 0.0, "rotDeg": 0.0,
             "rows": [{"z": -10.62, "y": 0.3}, {"z": -11.47, "y": 0.6}, {"z": -12.32, "y": 0.9}, {"z": -13.17, "y": 1.2}],
             "seed": 4101, "gapPct": 0.05},
            {"id": "south", "x": [-5.9, 5.9], "spacing": 0.62, "jitter": [0.12, 0.06], "faceYawDeg": 0.0, "rotDeg": 180.0,
             "rows": [{"z": -10.62, "y": 0.3}, {"z": -11.47, "y": 0.6}, {"z": -12.32, "y": 0.9}, {"z": -13.17, "y": 1.2}],
             "seed": 4102, "gapPct": 0.05},
            {"id": "west_a", "x": [-1.5, 1.5], "spacing": 0.58, "jitter": [0.12, 0.1], "faceYawDeg": 0.0, "rotDeg": 63.0,
             "rows": [{"z": -10.35, "y": 0.0}, {"z": -11.0, "y": 0.0}], "seed": 4103, "gapPct": 0.0, "frontHalfM": 1.0},
            {"id": "west_b", "x": [-1.5, 1.5], "spacing": 0.58, "jitter": [0.12, 0.1], "faceYawDeg": 0.0, "rotDeg": 117.0,
             "rows": [{"z": -10.35, "y": 0.0}, {"z": -11.0, "y": 0.0}], "seed": 4104, "gapPct": 0.0, "frontHalfM": 1.0},
            {"id": "east_a", "x": [-1.5, 1.5], "spacing": 0.58, "jitter": [0.12, 0.1], "faceYawDeg": 0.0, "rotDeg": -117.0,
             "rows": [{"z": -10.35, "y": 0.0}, {"z": -11.0, "y": 0.0}], "seed": 4105, "gapPct": 0.0, "frontHalfM": 1.0},
            {"id": "east_b", "x": [-1.5, 1.5], "spacing": 0.58, "jitter": [0.12, 0.1], "faceYawDeg": 0.0, "rotDeg": -63.0,
             "rows": [{"z": -10.35, "y": 0.0}, {"z": -11.0, "y": 0.0}], "seed": 4106, "gapPct": 0.0, "frontHalfM": 1.0},
        ],
    },
    "music": "music_stage_rooftop",
    "musicHint": "AUDIO lane cue 'rooftop' (runtime/src/audio/manifest.ts music_rooftop)",
    "ambient": "amb_rooftop_rain",
    "ambientHint": "rain on the roof and on the bleachers, distant traffic and sirens below, crowd bed following SHOWTIME",
    "dressing": {
        "animated": [
            {"what": "rain", "nodes": "rain_fall",
             "how": "view hook rain_* (stage.ts): node.position.y = y0 - ((t * 9.0) % 10.0). The streak cards (crossed "
                    "pairs, all yaws, an annulus r 11..16.5 m over the crowds and set pieces: never within 1.5 m of an "
                    "orbit camera) repeat every 10 m in y (y 0..20), so the wrap "
                    "is seamless; unlit BLEND material (fogged)."},
            {"what": "string lights", "nodes": "string_bulbs", "how": "view chase by name (*bulbs)"},
            {"what": "LIVE neon", "nodes": "anim_flicker_live", "how": "existing view hook anim_flicker_* (stage.ts)"},
            {"what": "crowd", "how": "instanced cards, vertex bob/sway, pose swaps by ratings mood"},
        ],
        "splatWallDust": ["#7d8986", "#7d8986"],
        "note": "the HIT PARADE neon letters are static in <id>_set (the show logo never flickers); aviation lights static",
    },
}

K.init("rooftop", STAGE)
S = STAGE
log = K.log

# =============================================================== materials
log("materials")
M_ROOF = mat_pbr("rt13_roof", "rt13_roof_a", "rt13_roof_n", "rt13_roof_r")
M_GRAVEL = mat_pbr("rt13_gravel", "rt13_gravel_a", "rt13_gravel_n", "rt13_gravel_r")
M_BRICK = mat_pbr("rt13_brick", "rt13_brick_a", "rt13_brick_n", "rt13_brick_r")
M_CONC = mat_pbr("rt13_conc", "rt13_conc_a", "rt13_conc_n", "rt13_conc_r")
M_CORR = mat_pbr("rt13_corr", "rt13_corr_a", "rt13_corr_n", "rt13_corr_r", metallic=0.35)
M_AC = mat_pbr("rt13_ac", "rt13_ac_a", "rt13_ac_n", "rt13_ac_r")
M_WOOD = mat_pbr("rt13_wood", "rt13_wood_a", "rt13_wood_n", roughness=0.62)
M_STEEL = mat_pbr("rt13_steel", "rt13_steel_a", "rt13_steel_n", "rt13_steel_r", metallic=0.35)
M_DOOR = mat_pbr("rt13_door", "rt13_door_a", "rt13_steel_n", "rt13_steel_r", metallic=0.3)
M_RTU = mat_pbr("rt13_rtu", "rt13_rtu_a", "rt13_steel_n", "rt13_steel_r", metallic=0.3)
M_ALU = mat_pbr("rt13_alu", "rt13_alu_a", "rt13_alu_n", "rt13_alu_r", metallic=0.85)
# faint sky-glow emissive = the reflected purple night sky: three.js hemisphere light gives no specular and the night IBL is
# dark (EXR mean 0.05), so a pure mirror read as black holes in the STAGES lab frames (Blender's world did reflect it)
M_WATER = mat_pbr("rt13_puddle", color=(0.02, 0.022, 0.03, 1), roughness=0.08, n="rt13_ripple_n", nstrength=0.8,
                  emission=(0.075, 0.055, 0.14, 1), estrength=0.6)
M_WET = mat_pbr("rt13_wetrim", color=(0.024, 0.024, 0.03, 1), roughness=0.46)
M_EMBLEM = mat_pbr("rt13_emblem", "rt13_emblem", roughness=0.32, alpha="MASK")
M_PAINT = mat_pbr("rt13_padpaint", "rt13_padpaint", roughness=0.36, alpha="MASK")
M_HAZ = mat_pbr("rt13_hazard", "rt13_hazard", "rt13_steel_n", roughness=0.5)
M_ROPE = mat_pbr("rt13_rope", color=(0.55, 0.05, 0.06, 1), roughness=0.34)
M_PAD = mat_pbr("rt13_pad", color=(0.85, 0.62, 0.06, 1), roughness=0.4)
M_SIGN = mat_pbr("rt13_sign", "rt13_signs", roughness=0.45)
M_SIGNLIT = mat_pbr("rt13_signlit", "rt13_signs", roughness=0.4, etex="rt13_signs", estrength=2.0)
M_BILL = mat_pbr("rt13_billboard", "rt13_billboard", roughness=0.55, etex="rt13_billboard", estrength=0.7)
M_NEON_P = mat_pbr("rt13_neon_pink", color=(1.0, 0.3, 0.62, 1), roughness=0.25, emission=(1.0, 0.13, 0.48, 1), estrength=7.0)
M_NEON_Y = mat_pbr("rt13_neon_yellow", color=(1.0, 0.8, 0.3, 1), roughness=0.25, emission=(1.0, 0.62, 0.1, 1), estrength=5.0)
M_NEON_B = mat_pbr("rt13_neon_blue", color=(0.4, 0.7, 1.0, 1), roughness=0.25, emission=(0.18, 0.5, 1.0, 1), estrength=6.0)
M_BULB = mat_pbr("rt13_bulb", color=(1.0, 0.86, 0.62, 1), roughness=0.3, emission=(1.0, 0.7, 0.38, 1), estrength=3.0)
M_LENS = mat_pbr("rt13_lens", color=(1.0, 0.95, 0.85, 1), roughness=0.2, emission=(1.0, 0.9, 0.72, 1), estrength=2.0)
M_RED = mat_pbr("rt13_redlamp", color=(1.0, 0.1, 0.06, 1), roughness=0.3, emission=(1.0, 0.06, 0.03, 1), estrength=7.0)
M_GLASS = mat_pbr("rt13_glass", color=(0.025, 0.03, 0.038, 1), roughness=0.06)
M_SKYLIT = mat_pbr("rt13_skylight", color=(0.1, 0.08, 0.06, 1), roughness=0.1, emission=(1.0, 0.66, 0.36, 1), estrength=0.28)
M_RUBBER = mat_pbr("rt13_rubber", color=(0.022, 0.022, 0.025, 1), roughness=0.5)
M_WIN = mat_unlit("rt13_windows", "rt13_windows")
M_CITYROOF = mat_pbr("rt13_cityroof", color=(0.018, 0.018, 0.026, 1), roughness=0.9)
M_RAIN = mat_unlit("rt13_rain", "rt13_rain", alpha="BLEND", double=True)

DRESS = {"rain_fall": [], "string_bulbs": [], "anim_flicker_live": []}


def W(lx, lz, yaw):
    """local (x, z) of a piece placed with K.placed(yaw) -> world (x, z) (three.js rotation.y)"""
    t = math.radians(yaw)
    return (lx * math.cos(t) + lz * math.sin(t), -lx * math.sin(t) + lz * math.cos(t))


# =============================================================== small builders
def ngon_blob(name, cx, cz, rx, rz, y, mat, seed, rot=0.0, n=28, wob=0.22):
    rng = K.mulberry32(seed)
    ph = [rng() * 6.283 for _ in range(3)]
    bm = bmesh.new()
    ctr = bm.verts.new(G(cx, y, cz))
    ring = []
    for k in range(n):
        a = 2 * math.pi * k / n
        w = 1 + wob * (0.55 * math.sin(3 * a + ph[0]) + 0.3 * math.sin(5 * a + ph[1]) + 0.15 * math.sin(9 * a + ph[2]))
        lx, lz = rx * w * math.cos(a), rz * w * math.sin(a)
        x = cx + lx * math.cos(rot) - lz * math.sin(rot)
        z = cz + lx * math.sin(rot) + lz * math.cos(rot)
        ring.append(bm.verts.new(G(x, y, z)))
    for k in range(n):
        bm.faces.new((ctr, ring[(k + 1) % n], ring[k]))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    return K.finish(bm, name, [mat], tile=0.9, smooth_angle=5)


def puddle(i, cx, cz, rx, rz, rot):
    """wet rim + water, stacked 14 / 28 mm above the roof: 2-4 mm offsets z-fought in three.js at the game camera's
    grazing angles (measured in the STAGES lab, near 0.1 m: jagged bow-tie artefacts); 14 mm apart they do not"""
    ngon_blob("puddle_rim_%d" % i, cx, cz, rx * 1.28, rz * 1.28, 0.014, M_WET, 900 + i, rot)
    ngon_blob("puddle_%d" % i, cx, cz, rx, rz, 0.028, M_WATER, 950 + i, rot)


def flat_quad(name, x0, x1, z0, z1, y, mat, uv=((0, 0), (1, 0), (1, 1), (0, 1))):
    """horizontal quad facing +Y; uv order = (x0,z1) (x1,z1) (x1,z0) (x0,z0) -> image top toward -z"""
    ob = quad(name, [(x0, y, z1), (x1, y, z1), (x1, y, z0), (x0, y, z0)], mat, uv)
    me = ob.data
    if me.polygons[0].normal.z < 0:
        me.flip_normals()
    return ob


def front_quad(name, x0, x1, y0, y1, z, mat, uv=(0, 0, 1, 1)):
    """vertical quad facing local +Z (toward the ring in a placed() frame); uv = (u0, v0, u1, v1)"""
    u0, v0, u1, v1 = uv
    ob = quad(name, [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], mat, ((u0, v0), (u1, v0), (u1, v1), (u0, v1)))
    if ob.data.polygons[0].normal.y > 0:     # game +Z = Blender -Y
        ob.data.flip_normals()
    return ob


def atlas_uv(px0, py0, px1, py1, size=1024):
    """pixel rect (top-left origin) -> (u0, v0, u1, v1) in Blender UV space"""
    return (px0 / size, 1 - py1 / size, px1 / size, 1 - py0 / size)


def box_truss(name, x, z, y0, y1, a=0.36, r=0.024, mat=None):
    mat = mat or M_STEEL          # black powder-coated stage truss
    h = a / 2
    corners = [(x - h, z - h), (x + h, z - h), (x + h, z + h), (x - h, z + h)]
    for i, (cx, cz) in enumerate(corners):
        tube("%s_chord_%d" % (name, i), [(cx, y0, cz), (cx, y1, cz)], r, mat, sides=8)
    n = max(2, int((y1 - y0) / a))
    step = (y1 - y0) / n
    for f in range(4):
        (ax, az), (bx, bz) = corners[f], corners[(f + 1) % 4]
        pts = []
        for k in range(n + 1):
            yy = y0 + k * step
            pts.append((ax, yy, az) if k % 2 == 0 else (bx, yy, bz))
        for k in range(len(pts) - 1):
            tube("%s_d%d_%d" % (name, f, k), [pts[k], pts[k + 1]], r * 0.55, mat, sides=6, caps=False)
    for yy in (y0 + 0.05, y1 - 0.05):
        for f in range(4):
            (ax, az), (bx, bz) = corners[f], corners[(f + 1) % 4]
            tube("%s_h%.1f_%d" % (name, yy, f), [(ax, yy, az), (bx, yy, bz)], r * 0.7, mat, sides=6, caps=False)


def spotcan(name, pos_g, target_g, body_mat=None):
    body_mat = body_mat or M_STEEL
    d = Vector(target_g) - Vector(pos_g)
    q = Vector((0, 0, 1)).rotation_difference(G(*d).normalized())
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=16, radius1=0.15, radius2=0.18, depth=0.44)
    bmesh.ops.bevel(bm, geom=[e for e in bm.edges if len(e.link_faces) == 2 and
                              abs(e.link_faces[0].normal.dot(e.link_faces[1].normal)) < 0.3], offset=0.015,
                    segments=1, affect="EDGES", clamp_overlap=True)
    for k in range(4):   # cooling fins
        geom = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=16, radius1=0.175, radius2=0.175, depth=0.018)
        bmesh.ops.translate(bm, verts=geom["verts"], vec=Vector((0, 0, -0.15 + k * 0.07)))
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=q.to_matrix())
    bmesh.ops.translate(bm, verts=bm.verts, vec=G(*pos_g))
    K.finish(bm, name + "_body", [body_mat], tile=0.5)
    lens = G(*pos_g) + q @ Vector((0, 0, 0.225))
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, segments=16, radius=0.16)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=q.to_matrix())
    bmesh.ops.translate(bm, verts=bm.verts, vec=lens)
    K.finish(bm, name + "_lens", [M_LENS], tile=0.5)
    bm = bmesh.new()      # lens bezel ring
    bmesh.ops.create_cone(bm, cap_ends=False, cap_tris=False, segments=16, radius1=0.19, radius2=0.19, depth=0.05)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=q.to_matrix())
    bmesh.ops.translate(bm, verts=bm.verts, vec=lens + q @ Vector((0, 0, 0.012)))
    K.finish(bm, name + "_bezel", [body_mat], tile=0.5)
    # yoke across the can, perpendicular to the beam in the horizontal plane
    side = Vector((-d[2], 0.0, d[0]))
    side = side.normalized() * 0.21 if side.length > 1e-6 else Vector((0.21, 0, 0))
    p = Vector(pos_g)
    tube(name + "_yoke", [tuple(p - side), tuple(p - side + Vector((0, -0.28, 0))), tuple(p + side + Vector((0, -0.28, 0))),
                          tuple(p + side)], 0.016, M_STEEL, sides=6)


# =============================================================== BUILD: roof deck, gravel, puddles
log("build roof")
gbox("roof", -26.0, 26.0, -0.3, 0.0, -26.0, 26.0, M_ROOF, tile=3.0)
for s in (-1, 1):
    gbox("parapet_x_%d" % s, s * 26.0, s * 26.35, 0.0, 1.05, -26.35, 26.35, M_BRICK, tile=1.4)
    gbox("parapet_x_cap_%d" % s, s * 25.93, s * 26.42, 1.05, 1.15, -26.42, 26.42, M_CONC, tile=1.5, bevel=0.015)
    gbox("parapet_z_%d" % s, -26.0, 26.0, 0.0, 1.05, s * 26.0, s * 26.35, M_BRICK, tile=1.4)
    gbox("parapet_z_cap_%d" % s, -25.93, 25.93, 1.05, 1.15, s * 25.93, s * 26.42, M_CONC, tile=1.5, bevel=0.015)
PUDDLES = [(-3.9, 1.4, 0.8, 0.45, 0.3), (2.9, -2.6, 0.9, 0.4, -0.2), (1.2, 3.9, 0.7, 0.35, 0.5), (-2.4, -3.8, 0.6, 0.3, 0.1),
           (6.7, 3.1, 0.9, 0.5, 0.4), (-7.2, -2.2, 1.0, 0.55, -0.3), (7.5, -4.1, 0.7, 0.4, 0.2), (-6.4, 5.3, 0.8, 0.45, 0.6),
           (3.6, 7.7, 0.9, 0.4, -0.1), (-2.8, -8.0, 0.8, 0.4, 0.3), (8.9, 0.8, 0.6, 0.35, 0.0), (-8.1, 2.9, 0.7, 0.4, 0.5),
           (0.4, -6.6, 0.7, 0.35, 0.9), (5.2, -6.9, 0.6, 0.3, 0.3)]
for i, (cx, cz, rx, rz, rot) in enumerate(PUDDLES):
    puddle(i, cx, cz, rx, rz, rot)

# =============================================================== BUILD: the RING (helipad paint, curb, cable railing)
log("build ring")
flat_quad("emblem", -2.4, 2.4, -2.4, 2.4, 0.006, M_EMBLEM)
# painted helipad circle (white band just inside the curb), yellow dashed inner circle, 16 sector ticks
K.annulus("pad_ring_white", 4.62, 5.02, 0.008, M_PAINT, n=128, u_len=2.0, v_range=(0.52, 0.98))
for k in range(24):
    a0 = k * 15.0
    K.annulus("pad_dash_%d" % k, 3.52, 3.72, 0.008, M_PAINT, n=240, a0_deg=a0 + 2.5, a1_deg=a0 + 12.5, u_len=2.0,
              v_range=(0.02, 0.48))
for k in range(16):
    a = math.radians(22.5 * k)
    ux, uz = math.sin(a), math.cos(a)
    px, pz = math.cos(a), -math.sin(a)
    r0, r1, w = 5.08, 5.42, 0.06
    quad("pad_tick_%d" % k, [(ux * r0 - px * w, 0.008, uz * r0 - pz * w), (ux * r1 - px * w, 0.008, uz * r1 - pz * w),
                             (ux * r1 + px * w, 0.008, uz * r1 + pz * w), (ux * r0 + px * w, 0.008, uz * r0 + pz * w)],
         M_PAINT, ((0.1 * k, 0.55), (0.1 * k + 0.17, 0.55), (0.1 * k + 0.17, 0.95), (0.1 * k, 0.95)))
for ob in list(K.COL_SET.objects):
    if ob.name.startswith("pad_tick_") and ob.data.polygons[0].normal.z < 0:
        ob.data.flip_normals()
# concrete curb r 5.5..5.85 x 0.17 with a hazard face toward the ring
lathe("ring_curb", [(RING_R, 0.0), (RING_R, 0.15), (RING_R + 0.02, 0.17), (RING_R + 0.33, 0.17), (RING_R + 0.35, 0.15),
                    (RING_R + 0.35, 0.0)], (0.0, 0.0, 0.0), M_CONC, sides=128, tile_u=1.5, tile_v=1.5, cap_top=False,
      cap_bot=False)
K.ring_wall("ring_curb_hazard", RING_R - 0.004, 0.015, 0.145, M_HAZ, n=128, u_len=1.0, v_range=(0.0, 1.0), inward=True)
# 16 posts on the sector borders, padded yellow caps (<= 1.10 m), 3 cables (steel, steel, red vinyl top)
POST_R = RING_R + 0.18
for k in range(16):
    a = math.radians(11.25 + 22.5 * k)
    px, pz = POST_R * math.sin(a), POST_R * math.cos(a)
    tube("rail_post_%d" % k, [(px, 0.17, pz), (px, 0.88, pz)], 0.036, M_STEEL, sides=10)
    cyl("rail_post_base_%d" % k, (px, 0.18, pz), (0, 1, 0), 0.085, 0.022, M_STEEL, sides=12, bevel=0.005)
    cyl("rail_post_cap_%d" % k, (px, 0.905, pz), (0, 1, 0), 0.05, 0.11, M_PAD, sides=12, bevel=0.012)
    bolts("rail_post_bolts_%d" % k, [(px + 0.06 * math.cos(t), 0.191, pz + 0.06 * math.sin(t)) for t in (0.5, 2.1, 3.7, 5.3)],
          (0, 1, 0), M_STEEL, r=0.011, h=0.008)
CABLE_R = RING_R + 0.13
for yy, rr, mat in ((0.36, 0.011, M_STEEL), (0.62, 0.011, M_STEEL), (0.88, 0.024, M_ROPE)):
    pts = [(x, yy, z) for (x, z) in K.ring_points(CABLE_R, 128)]
    tube("rail_cable_%.2f" % yy, pts, rr, mat, sides=8 if rr > 0.02 else 5, caps=False)
# turnbuckle sleeves where the cables meet each post
for k in range(16):
    a = math.radians(11.25 + 22.5 * k)
    cx, cz = CABLE_R * math.sin(a), CABLE_R * math.cos(a)
    tx, tz = math.cos(a), -math.sin(a)
    for yy in (0.36, 0.62):
        tube("rail_sleeve_%d_%.1f" % (k, yy), [(cx - tx * 0.09, yy, cz - tz * 0.09), (cx + tx * 0.09, yy, cz + tz * 0.09)],
             0.02, M_RUBBER, sides=8)

# =============================================================== BUILD: stair bulkhead (west, door opens onto the ring)
log("build bulkhead (west)")
YAW_W = 90.0            # placed at a = 270 (-X)
with K.placed(YAW_W):
    ZF, ZBk, HW = -10.4, -14.4, 2.8
    gbox("bh_plinth_a", -HW - 0.1, -0.6, 0.0, 0.32, ZBk - 0.1, ZF + 0.07, M_CONC, tile=1.5, bevel=0.02)
    gbox("bh_plinth_b", 0.6, HW + 0.1, 0.0, 0.32, ZBk - 0.1, ZF + 0.07, M_CONC, tile=1.5, bevel=0.02)
    gbox("bh_brick", -HW, HW, 0.32, 3.55, ZBk, ZF, M_BRICK, tile=1.4)
    gbox("bh_brick_door_low", -0.6, 0.6, 0.0, 0.32, ZBk, ZF - 0.02, M_BRICK, tile=1.4)
    gbox("bh_coping", -HW - 0.08, HW + 0.08, 3.55, 3.76, ZBk - 0.08, ZF + 0.07, M_CONC, tile=1.5, bevel=0.03)
    # door: steel frame (4.5 cm proud), recessed slab, push bar, kick plate, hinges, wired-glass vision panel
    gbox("door_jamb_a", -0.6, -0.52, 0.0, 2.24, ZF, ZF + 0.045, M_STEEL, tile=1.0, bevel=0.008)
    gbox("door_jamb_b", 0.52, 0.6, 0.0, 2.24, ZF, ZF + 0.045, M_STEEL, tile=1.0, bevel=0.008)
    gbox("door_head", -0.6, 0.6, 2.16, 2.24, ZF, ZF + 0.045, M_STEEL, tile=1.0, bevel=0.008)
    gbox("door_slab", -0.52, 0.52, 0.015, 2.16, ZF, ZF + 0.022, M_DOOR, tile=1.2, bevel=0.005)
    gbox("door_kick", -0.49, 0.49, 0.03, 0.3, ZF + 0.022, ZF + 0.028, M_ALU, tile=0.6)
    gbox("door_glass_frame", 0.05, 0.37, 1.38, 1.9, ZF + 0.022, ZF + 0.032, M_STEEL, tile=0.5, bevel=0.004)
    gbox("door_glass", 0.09, 0.33, 1.42, 1.86, ZF + 0.032, ZF + 0.035, M_GLASS, tile=0.5)
    tube("door_bar", [(-0.42, 1.02, ZF + 0.07), (0.34, 1.02, ZF + 0.07)], 0.018, M_ALU, sides=8)
    for xb in (-0.4, 0.32):
        tube("door_bar_bk_%.2f" % xb, [(xb, 1.02, ZF + 0.025), (xb, 1.02, ZF + 0.07)], 0.012, M_ALU, sides=6)
    for yh in (0.3, 1.1, 1.9):
        cyl("door_hinge_%.1f" % yh, (-0.535, yh, ZF + 0.05), (0, 1, 0), 0.016, 0.12, M_STEEL, sides=8)
    bolts("door_bolts", [(x, y, ZF + 0.045) for y in (0.08, 1.1, 2.12) for x in (-0.56, 0.56)], (0, 0, 1), M_STEEL, r=0.012)
    front_quad("door_plate", -0.3, -0.02, 1.95, 2.1, ZF + 0.03, M_SIGN, atlas_uv(256, 256, 512, 383))
    gbox("exit_box", -0.22, 0.22, 2.34, 2.54, ZF, ZF + 0.1, M_STEEL, tile=0.5, bevel=0.01)
    front_quad("exit_face", -0.2, 0.2, 2.36, 2.52, ZF + 0.108, M_SIGNLIT, atlas_uv(0, 256, 256, 383))
    # caged bulkhead lamp + conduit (the door_lamp light sits here)
    LX = 1.05
    cyl("lamp_base", (LX, 2.8, ZF + 0.025), (0, 0, 1), 0.09, 0.05, M_STEEL, sides=16, bevel=0.008)
    sphere("lamp_glass", (LX, 2.8, ZF + 0.1), 0.075, M_BULB, seg=12, rings=8, scale=(1.0, 1.0, 0.8))
    for k in range(6):
        a = k * math.pi / 3
        tube("lamp_cage_%d" % k, [(LX + 0.085 * math.cos(a), 2.8 + 0.085 * math.sin(a), ZF + 0.05),
                                  (LX + 0.07 * math.cos(a), 2.8 + 0.07 * math.sin(a), ZF + 0.17),
                                  (LX, 2.8, ZF + 0.19)], 0.005, M_STEEL, sides=4, caps=False)
    tube("lamp_cage_ring", [(LX + 0.09 * math.cos(a), 2.8 + 0.09 * math.sin(a), ZF + 0.12) for a in np.linspace(0, 2 * math.pi, 13)],
         0.005, M_STEEL, sides=4, caps=False)
    tube("conduit_lamp", [(LX, 2.86, ZF + 0.025), (LX, 3.3, ZF + 0.025), (-2.55, 3.3, ZF + 0.025), (-2.55, 1.7, ZF + 0.025)],
         0.022, M_STEEL, sides=8)
    for xc in (-2.2, -1.0, 0.2, 1.8):
        gbox("conduit_strap_%.1f" % xc, xc - 0.03, xc + 0.03, 3.26, 3.34, ZF - 0.01, ZF + 0.045, M_STEEL, tile=0.3)
    K.template("meter1", K.JPM + "Props/JP_Electric_Meter_01.fbx", mat=mat_pbr("rt13_meters", "rt13_meters_a", "rt13_meters_n",
                                                                               "rt13_meters_r"))
    K.inst("meter1", "meter1_bh", (-2.2, 1.2, ZF + 0.02), 0.0, 1.0, pivot="bottom")
    tube("downpipe", [(2.55, 3.56, ZF - 0.08), (2.55, 3.4, ZF + 0.08), (2.55, 0.35, ZF + 0.08), (2.55, 0.12, ZF + 0.2),
                      (2.55, 0.08, ZF + 0.38)], 0.045, M_STEEL, sides=10)
    for yb in (0.9, 1.9, 2.9):
        gbox("downpipe_bracket_%.1f" % yb, 2.49, 2.61, yb - 0.02, yb + 0.02, ZF, ZF + 0.14, M_STEEL, tile=0.3)
    front_quad("poster_1", 1.45, 2.32, 1.0, 2.3, ZF + 0.01, M_SIGN, atlas_uv(0, 512, 341, 1024))
    front_quad("poster_2", -1.92, -1.05, 0.95, 2.25, ZF + 0.012, M_SIGN, atlas_uv(341, 512, 682, 1024))
    front_quad("caution_plate", -1.0, -0.66, 1.45, 1.75, ZF + 0.01, M_SIGN, atlas_uv(0, 384, 255, 511))
    # roof of the bulkhead: vent stack + small aerial
    lathe("bh_vent", [(0.22, 0.0), (0.22, 0.05), (0.14, 0.06), (0.14, 0.9), (0.16, 0.92), (0.16, 0.96)], (-1.2, 3.76, -12.6), M_ALU,
          sides=14, tile_u=0.5, tile_v=0.5, cap_top=False)
    lathe("bh_vent_cap", [(0.0, 1.22), (0.32, 1.06), (0.3, 1.04)], (-1.2, 3.76, -12.6), M_STEEL, sides=14, tile_u=0.5, tile_v=0.5)
    tube("bh_aerial", [(1.6, 3.76, -13.6), (1.6, 6.2, -13.6)], 0.025, M_STEEL, sides=6)
    for k, yy in enumerate((5.2, 5.6, 6.0)):
        tube("bh_aerial_x_%d" % k, [(1.6 - 0.5 + 0.1 * k, yy, -13.6), (1.6 + 0.5 - 0.1 * k, yy, -13.6)], 0.012, M_STEEL, sides=5)
    # concrete paver path from the door to the ring (floor level)
    for i in range(7):
        z = ZF + 0.55 + i * 0.62
        gbox("paver_%d" % i, -0.36, 0.36, 0.0, 0.05, z - 0.28, z + 0.28, M_CONC, tile=1.2, bevel=0.01, segs=1)
    gbox("bh_gravel", -HW - 1.2, HW + 1.2, 0.0, 0.035, ZBk - 1.6, ZBk - 0.1, M_GRAVEL, tile=1.6, bevel=0.012, segs=1)

# =============================================================== BUILD: machine room (east)
log("build machine room (east)")
YAW_E = -90.0           # placed at a = 90 (+X)
with K.placed(YAW_E):
    ZF, ZBk, HW = -10.4, -14.6, 2.8
    gbox("mr_plinth", -HW - 0.07, HW + 0.07, 0.0, 0.3, ZBk - 0.1, ZF + 0.07, M_CONC, tile=1.5, bevel=0.02)
    gbox("mr_clad", -HW, HW, 0.3, 3.95, ZBk, ZF, M_CORR, tile=1.8)
    gbox("mr_cap", -HW - 0.06, HW + 0.06, 3.95, 4.1, ZBk - 0.06, ZF + 0.06, M_STEEL, tile=1.0, bevel=0.012)
    for xc in (-HW, HW):
        gbox("mr_corner_%.1f" % xc, xc - 0.06, xc + 0.06, 0.3, 3.95, ZF - 0.1, ZF + 0.045, M_STEEL, tile=0.6, bevel=0.006)
    for xc in (-0.95, 0.65):
        gbox("mr_joint_%.1f" % xc, xc - 0.035, xc + 0.035, 0.3, 3.95, ZF, ZF + 0.015, M_STEEL, tile=0.6)
        bolts("mr_joint_bolts_%.1f" % xc, [(xc, 0.5 + 0.45 * k, ZF + 0.015) for k in range(8)], (0, 0, 1), M_STEEL, r=0.011)
    # steel service door (left)
    gbox("mr_door_frame", -2.4, -1.14, 0.3, 2.5, ZF, ZF + 0.04, M_STEEL, tile=1.0, bevel=0.008)
    gbox("mr_door", -2.33, -1.21, 0.32, 2.43, ZF + 0.04, ZF + 0.06, M_DOOR, tile=1.2, bevel=0.005)
    tube("mr_door_handle", [(-1.35, 1.25, ZF + 0.06), (-1.35, 1.25, ZF + 0.1), (-1.5, 1.25, ZF + 0.1)], 0.014, M_ALU, sides=6)
    front_quad("mr_door_plate", -2.1, -1.45, 1.8, 2.05, ZF + 0.065, M_SIGN, atlas_uv(256, 384, 511, 511))
    # louvre vent (right)
    LV = (0.95, 2.45, 2.05, 3.25)       # x0, x1, y0, y1
    gbox("louvre_frame_t", LV[0], LV[1], LV[3] - 0.06, LV[3], ZF, ZF + 0.07, M_STEEL, tile=0.6, bevel=0.006)
    gbox("louvre_frame_b", LV[0], LV[1], LV[2], LV[2] + 0.06, ZF, ZF + 0.07, M_STEEL, tile=0.6, bevel=0.006)
    gbox("louvre_frame_l", LV[0], LV[0] + 0.06, LV[2], LV[3], ZF, ZF + 0.07, M_STEEL, tile=0.6, bevel=0.006)
    gbox("louvre_frame_r", LV[1] - 0.06, LV[1], LV[2], LV[3], ZF, ZF + 0.07, M_STEEL, tile=0.6, bevel=0.006)
    gbox("louvre_back", LV[0], LV[1], LV[2], LV[3], ZF, ZF + 0.005, M_RUBBER, tile=0.5)
    for k in range(9):
        yy = LV[2] + 0.12 + k * 0.12
        obox("louvre_slat_%d" % k, ((LV[0] + LV[1]) / 2, yy, ZF + 0.035), (LV[1] - LV[0] - 0.12, 0.008, 0.09), M_STEEL,
             pitch_deg=35.0, tile=0.5)
    # electrics + DANGER plate + crew plate
    K.template("meter2", K.JPM + "Props/JP_Electric_Meter_02.fbx", mat=bpy.data.materials["rt13_meters"])
    K.inst("meter2", "meter2_mr", (-0.55, 1.0, ZF + 0.02), 0.0, 1.0, pivot="bottom")
    K.inst("meter1", "meter1_mr", (0.1, 1.15, ZF + 0.02), 0.0, 1.0, pivot="bottom")
    front_quad("danger_plate", -0.95, -0.05, 2.25, 2.7, ZF + 0.02, M_SIGN, atlas_uv(512, 0, 1023, 255))
    front_quad("crew_plate", 1.0, 2.4, 1.0, 1.35, ZF + 0.02, M_SIGN, atlas_uv(512, 320, 1023, 511))
    tube("mr_conduit", [(-0.55, 1.55, ZF + 0.025), (-0.55, 3.6, ZF + 0.025), (2.6, 3.6, ZF + 0.025)], 0.022, M_STEEL, sides=8)
    tube("mr_pipe", [(2.62, 0.3, ZF + 0.04), (2.62, 0.9, ZF + 0.04), (2.62, 0.9, ZF + 0.2)], 0.03, M_ALU, sides=8)
    # AC condensers on the machine-room roof
    AC_MAT = M_AC
    for key, f in (("ac1", "JP_Conditioner_01"), ("ac5", "JP_Conditioner_05"), ("ac7", "JP_Conditioner_07")):
        K.template(key, K.JPM + "Environment/%s.fbx" % f, mat=AC_MAT)
    for k, (key, x) in enumerate((("ac1", -1.6), ("ac5", -0.4), ("ac7", 0.9))):
        K.inst(key, "ac_mr_%d" % k, (x, 4.1, -12.9), K.face_yaw((0, 0, 1), Vector((-1, 0, 0))), 1.0)
    gbox("mr_gravel", -HW - 1.2, HW + 1.2, 0.0, 0.035, ZBk - 1.6, ZBk - 0.1, M_GRAVEL, tile=1.6, bevel=0.012, segs=1)

# =============================================================== BUILD: aluminium bleachers (north + south)
log("build bleachers")
BX = 6.2


def bleachers(tag):
    TIERS = []
    for k in range(4):
        y = 0.3 * (k + 1)
        zf = -10.2 - 0.85 * k
        TIERS.append((y, zf, zf - 0.85))
    for k, (y, zf, zb) in enumerate(TIERS):
        gbox("%s_tread_a_%d" % (tag, k), -BX, BX, y - 0.05, y, zf - 0.40, zf - 0.02, M_ALU, tile=1.0, bevel=0.008, segs=1)
        gbox("%s_tread_b_%d" % (tag, k), -BX, BX, y - 0.05, y, zb + 0.02, zf - 0.45, M_ALU, tile=1.0, bevel=0.008, segs=1)
        gbox("%s_riser_%d" % (tag, k), -BX, BX, y - 0.3, y - 0.05, zf - 0.02, zf, M_STEEL, tile=1.2)
        for x in np.arange(-BX, BX + 0.01, 2.48):
            gbox("%s_post_%d_%.1f" % (tag, k, x), x - 0.03, x + 0.03, 0.0, y - 0.05, zf - 0.43, zf - 0.37, M_STEEL, tile=0.5)
            gbox("%s_post2_%d_%.1f" % (tag, k, x), x - 0.03, x + 0.03, 0.0, y - 0.05, zb + 0.03, zb + 0.09, M_STEEL, tile=0.5)
    zback = TIERS[-1][2]
    gbox("%s_back" % tag, -BX, BX, 0.0, 1.2, zback - 0.02, zback, M_STEEL, tile=1.2)
    for s in (-1, 1):       # side skirts (the orbit sees the bank ends): stepped outline, facing outward
        pts = [(s * BX, 0.0, zback)]
        for k in range(3, -1, -1):
            y, zf, zb = TIERS[k]
            pts += [(s * BX, y, zb), (s * BX, y, zf)]
        pts.append((s * BX, 0.0, -10.2))
        bm = bmesh.new()
        uvl = bm.loops.layers.uv.new("UVMap")
        f = bm.faces.new([bm.verts.new(G(*p)) for p in pts])
        for loop in f.loops:
            co = loop.vert.co
            loop[uvl].uv = (-co.y / 1.2, co.z / 1.2)
        ob = K.finish(bm, "%s_side_%d" % (tag, s), [M_STEEL], uv=False)
        if (ob.data.polygons[0].normal.x > 0) != (s > 0):
            ob.data.flip_normals()
    for x in np.arange(-BX, BX + 0.01, 2.0):
        tube("%s_rail_post_%.1f" % (tag, x), [(x, 1.2, zback - 0.03), (x, 2.26, zback - 0.03)], 0.022, M_ALU, sides=8)
    for yr in (1.72, 2.26):
        tube("%s_rail_%.2f" % (tag, yr), [(-BX, yr, zback - 0.03), (BX, yr, zback - 0.03)], 0.022, M_ALU, sides=8)
    for s in (-1, 1):       # end handrails down the stairs
        tube("%s_endrail_%d" % (tag, s), [(s * (BX - 0.05), 1.05, -10.25), (s * (BX - 0.05), 2.26, zback - 0.03)], 0.022,
             M_ALU, sides=8)
    # hazard stripe edge on the tier-0 riser (atlas band 512..1024 x 256..320 px, one quad per 2 m)
    for k in range(int(round(2 * BX / 2.0))):
        x = -BX + 2.0 * k
        front_quad("%s_stripes_%d" % (tag, k), x, min(BX, x + 2.0), 0.03, 0.2, -10.19, M_SIGN, atlas_uv(512, 256, 1023, 319))


with K.placed(0.0):
    bleachers("bn")
with K.placed(180.0):
    bleachers("bs")

# =============================================================== BUILD: crowd barricades (r 9.8, in front of every crowd)
log("build barricades")
BAR_R = 9.8


def barricade(tag, banner=False):
    cx, hw, Z = 0.0, 1.08, -BAR_R
    tube(tag + "_top", [(cx - hw, 1.08, Z), (cx + hw, 1.08, Z)], 0.019, M_ALU, sides=8)
    tube(tag + "_bot", [(cx - hw, 0.16, Z), (cx + hw, 0.16, Z)], 0.017, M_ALU, sides=8)
    for s in (-1, 1):
        tube(tag + "_post_%d" % s, [(cx + s * hw, 0.05, Z), (cx + s * hw, 1.08, Z)], 0.019, M_ALU, sides=8)
        obox(tag + "_foot_%d" % s, (cx + s * 0.86, 0.008, Z), (0.05, 0.016, 0.72), M_STEEL, tile=0.5, bevel=0.003)
        tube(tag + "_leg_%d" % s, [(cx + s * 0.86, 0.16, Z), (cx + s * 0.86, 0.016, Z)], 0.012, M_ALU, sides=6)
    nb = 14
    for k in range(1, nb):
        x = cx - hw + 2 * hw * k / nb
        tube(tag + "_rod_%d" % k, [(x, 0.16, Z), (x, 1.08, Z)], 0.008, M_ALU, sides=5, caps=False)
    if banner:
        front_quad(tag + "_banner", cx - 0.98, cx + 0.98, 0.28, 0.98, Z + 0.03, M_SIGN, atlas_uv(512, 320, 1023, 511))


STEP = math.degrees(2.26 / BAR_R)
BARS = [(180.0 + STEP * k, k % 2 == 0) for k in (-2, -1, 0, 1, 2)] + [(STEP * k, k % 2 == 0) for k in (-2, -1, 0, 1, 2)]
for wedge in (243.0, 297.0, 63.0, 117.0):
    BARS += [(wedge - STEP / 2, False), (wedge + STEP / 2, True)]
for i, (a, ban) in enumerate(BARS):
    with K.placed(a - 180.0):
        barricade("bar_%d" % i, ban)

# =============================================================== BUILD: neon HIT PARADE sign (north, hero)
log("build neon sign")
NZ = -14.6
with K.placed(0.0):
    for s in (-1, 1):
        gbox("neon_post_%d" % s, s * 6.7 - 0.07, s * 6.7 + 0.07, 0.0, 5.0, NZ - 0.07, NZ + 0.07, M_STEEL, tile=0.8, bevel=0.01)
        gbox("neon_post_base_%d" % s, s * 6.7 - 0.25, s * 6.7 + 0.25, 0.0, 0.03, NZ - 0.25, NZ + 0.25, M_STEEL, tile=0.8, bevel=0.005)
        tube("neon_brace_%d" % s, [(s * 6.7, 3.2, NZ - 0.05), (s * 6.7, 0.03, NZ - 2.2)], 0.035, M_STEEL, sides=8)
        bolts("neon_base_bolts_%d" % s, [(s * 6.7 + dx, 0.03, NZ + dz) for dx in (-0.18, 0.18) for dz in (-0.18, 0.18)],
              (0, 1, 0), M_STEEL, r=0.02)
    for yy in (2.95, 4.85):
        gbox("neon_rail_%.2f" % yy, -6.7, 6.7, yy - 0.05, yy + 0.05, NZ - 0.05, NZ + 0.05, M_STEEL, tile=1.0, bevel=0.008)
    for x in np.arange(-5.6, 5.7, 1.4):
        gbox("neon_strut_%.1f" % x, x - 0.03, x + 0.03, 2.95, 4.85, NZ - 0.03, NZ + 0.03, M_STEEL, tile=0.5)
    BUNGEE = os.path.join(K.FONTS, "bungee.ttf")
    neon_main = K.text_mesh("neon_hit_parade", "HIT PARADE", BUNGEE, 3.1, (0.0, 3.92, NZ + 0.14), [M_NEON_P], neon_r=0.034,
                            space=1.05, resolution=4)
    vs = [v.co for v in neon_main.data.vertices]
    nx0, nx1 = min(v.x for v in vs), max(v.x for v in vs)
    ny0, ny1 = min(v.z for v in vs), max(v.z for v in vs)
    log("neon letters bbox x %.2f..%.2f y %.2f..%.2f" % (nx0, nx1, ny0, ny1))
    gbox("neon_raceway", nx0 - 0.1, nx1 + 0.1, ny0 + 0.28, ny0 + 0.44, NZ + 0.02, NZ + 0.1, M_STEEL, tile=1.0, bevel=0.01)
    gbox("neon_transformer_l", nx0 - 0.5, nx0 - 0.15, 3.05, 3.4, NZ - 0.02, NZ + 0.14, M_RTU, tile=0.5, bevel=0.012)
    gbox("neon_transformer_r", nx1 + 0.15, nx1 + 0.5, 3.05, 3.4, NZ - 0.02, NZ + 0.14, M_RTU, tile=0.5, bevel=0.012)
    zig = []
    for k in range(15):
        t = k / 14
        zig.append((nx0 + (nx1 - nx0) * t, ny0 - 0.16 + (0.1 if k % 2 else -0.05), NZ + 0.14))
    tube("neon_zig", zig, 0.028, M_NEON_Y, sides=8)
    live = K.text_mesh("neon_live", "LIVE", BUNGEE, 1.0, (nx0 + 0.55, ny1 + 0.38, NZ + 0.14), [M_NEON_B], neon_r=0.022)
    lx = [v.co.x for v in live.data.vertices]
    ly = [v.co.z for v in live.data.vertices]
    lb = (min(lx) - 0.14, max(lx) + 0.14, min(ly) - 0.1, max(ly) + 0.1)
    live_box = tube("neon_live_box", [(lb[0], lb[2], NZ + 0.14), (lb[1], lb[2], NZ + 0.14), (lb[1], lb[3], NZ + 0.14),
                                      (lb[0], lb[3], NZ + 0.14), (lb[0], lb[2], NZ + 0.14)], 0.02, M_NEON_B, sides=6)
    DRESS["anim_flicker_live"] += [live, live_box]
    gbox("neon_live_back", lb[0] - 0.05, lb[1] + 0.05, lb[2] - 0.05, lb[3] + 0.05, NZ + 0.02, NZ + 0.08, M_STEEL, tile=0.5, bevel=0.01)
    tube("neon_live_post", [((lb[0] + lb[1]) / 2, lb[2] - 0.05, NZ + 0.05), ((lb[0] + lb[1]) / 2, 4.85, NZ + 0.05)], 0.025,
         M_STEEL, sides=6)
    # back of the sign (seen from behind the north bank? no - but the orbit sees its ends): cable trays to the posts
    for s in (-1, 1):
        tube("neon_cable_%d" % s, [(s * 6.7, 0.03, NZ - 0.3), (s * 6.0, 0.03, NZ - 0.8), (s * 3.0, 0.03, NZ - 1.0)], 0.024,
             M_RUBBER, sides=6)

# =============================================================== BUILD: truss towers + floods (diagonals)
log("build truss + floods")
FLOOD_AIMS = {45.0: [(1.6, 0.8), (0.0, -0.8), (-1.4, 0.6)], 135.0: [(1.2, 1.0), (-0.6, -1.2), (-1.8, 0.2)],
              225.0: [(-1.4, -0.6), (0.8, 1.0), (1.6, -1.2)], 315.0: [(-1.2, -1.0), (0.6, 1.2), (1.8, -0.2)]}
TOWER_TOPS = {}
for a in TOWERS:
    ux, uz = K.ydir(a)
    tx, tz = TOWER_R * ux, TOWER_R * uz
    tag = "truss_%d" % int(a)
    box_truss(tag, tx, tz, 0.06, 7.0)
    gbox(tag + "_base", tx - 0.45, tx + 0.45, 0.0, 0.06, tz - 0.45, tz + 0.45, M_STEEL, tile=0.8, bevel=0.01)
    for (dx, dz) in ((-0.62, 0.0), (0.62, 0.0), (0.0, -0.62), (0.0, 0.62)):
        gbox(tag + "_ballast_%.1f_%.1f" % (dx, dz), tx + dx - 0.2, tx + dx + 0.2, 0.0, 0.32, tz + dz - 0.2, tz + dz + 0.2,
             M_CONC, tile=0.8, bevel=0.015)
    for k, yy in enumerate((3.8, 4.5, 5.2)):
        fx, fz = tx - ux * 0.34, tz - uz * 0.34
        tube(tag + "_arm_%d" % k, [(tx, yy + 0.3, tz), (fx, yy + 0.3, fz)], 0.02, M_STEEL, sides=6)
        ax, az = FLOOD_AIMS[a][k]
        spotcan(tag + "_flood_%d" % k, (fx, yy, fz), (ax, 0.8, az))
    gbox(tag + "_cap", tx - 0.24, tx + 0.24, 7.0, 7.06, tz - 0.24, tz + 0.24, M_STEEL, tile=0.5, bevel=0.005)
    sphere(tag + "_beacon", (tx, 7.15, tz), 0.09, M_RED, seg=10, rings=6)
    TOWER_TOPS[a] = (tx - ux * 0.2, 6.8, tz - uz * 0.2)
    # floor cable from the tower base outward (floor level)
    tube(tag + "_cable", [(tx, 0.03, tz), (tx + ux * 1.2 + uz * 0.4, 0.03, tz + uz * 1.2 - ux * 0.4),
                          (tx + ux * 3.0, 0.03, tz + uz * 3.0)], 0.026, M_RUBBER, sides=6)

# =============================================================== BUILD: string lights (between the tower tops, over the ring)
log("build string lights")
T = TOWER_TOPS
STRANDS = [(T[45.0], T[135.0], 1.0), (T[135.0], T[225.0], 1.0), (T[225.0], T[315.0], 1.0), (T[315.0], T[45.0], 1.0),
           (T[45.0], T[225.0], 1.1), (T[135.0], T[315.0], 1.1)]
nb_total = 0
for si, (p0, p1, sag) in enumerate(STRANDS):
    pts = catenary(p0, p1, sag, 40)
    tube("strand_%d" % si, pts, 0.006, M_RUBBER, sides=4, caps=False)
    L = sum((Vector(pts[i + 1]) - Vector(pts[i])).length for i in range(len(pts) - 1))
    n = int(L / 0.6)
    acc = [0.0]
    for i in range(len(pts) - 1):
        acc.append(acc[-1] + (Vector(pts[i + 1]) - Vector(pts[i])).length)
    for b in range(1, n):
        d = b * L / n
        j = max(0, min(len(pts) - 2, int(np.searchsorted(acc, d)) - 1))
        t = (d - acc[j]) / max(1e-6, acc[j + 1] - acc[j])
        p = Vector(pts[j]).lerp(Vector(pts[j + 1]), t)
        cyl("socket_%d_%d" % (si, b), (p.x, p.y - 0.035, p.z), (0, 1, 0), 0.016, 0.05, M_RUBBER, sides=6)
        DRESS["string_bulbs"].append(sphere("bulb_%d_%d" % (si, b), (p.x, p.y - 0.085, p.z), 0.042, M_BULB, seg=8, rings=5,
                                            scale=(1.0, 1.25, 1.0)))
        nb_total += 1
log("string bulbs", nb_total)

# =============================================================== BUILD: rooftop units + AC row (a = 135)
log("build rooftop units (a=135)")


def rtu(name, cx, cz, flip=1):
    """packaged rooftop HVAC unit: bevelled cabinet on a curb, access panels with handles + bolts, louvre band,
    two condenser fan shrouds with grilles, supply duct"""
    L, H, D = 3.2, 1.45, 1.9
    gbox(name + "_curb", cx - L / 2 - 0.08, cx + L / 2 + 0.08, 0.0, 0.26, cz - D / 2 - 0.08, cz + D / 2 + 0.08, M_CONC,
         tile=1.2, bevel=0.015)
    y0 = 0.26
    gbox(name + "_body", cx - L / 2, cx + L / 2, y0, y0 + H, cz - D / 2, cz + D / 2, M_RTU, tile=1.6, bevel=0.035, segs=2)
    gbox(name + "_lid", cx - L / 2 - 0.03, cx + L / 2 + 0.03, y0 + H, y0 + H + 0.06, cz - D / 2 - 0.03, cz + D / 2 + 0.03,
         M_RTU, tile=1.6, bevel=0.02)
    for k, (px0, px1) in enumerate(((-1.5, -0.55), (-0.45, 0.45), (0.55, 1.5))):
        gbox(name + "_panel_%d" % k, cx + px0, cx + px1, y0 + 0.12, y0 + H - 0.12, cz + D / 2, cz + D / 2 + 0.012, M_RTU,
             tile=1.0, bevel=0.006, segs=1)
        tube(name + "_handle_%d" % k, [(cx + px1 - 0.1, y0 + 0.62, cz + D / 2 + 0.012), (cx + px1 - 0.1, y0 + 0.62, cz + D / 2 + 0.05),
                                       (cx + px1 - 0.1, y0 + 0.86, cz + D / 2 + 0.05), (cx + px1 - 0.1, y0 + 0.86, cz + D / 2 + 0.012)],
             0.011, M_ALU, sides=6)
        bolts(name + "_pbolts_%d" % k, [(cx + x, y, cz + D / 2 + 0.012) for x in (px0 + 0.05, px1 - 0.05)
                                         for y in (y0 + 0.17, y0 + H - 0.17)], (0, 0, 1), M_STEEL, r=0.012)
    sx = cx + flip * (L / 2 + 0.005)
    for k in range(8):
        obox(name + "_lv_%d" % k, (sx, y0 + 0.25 + k * 0.13, cz), (0.07, 0.008, D - 0.3), M_STEEL, yaw_deg=0.0,
             roll_deg=flip * 38.0, tile=0.5)
    for k, fx in enumerate((-0.78, 0.78)):
        fc = (cx + fx, y0 + H + 0.06, cz)
        lathe(name + "_shroud_%d" % k, [(0.56, 0.0), (0.6, 0.02), (0.6, 0.24), (0.57, 0.26), (0.5, 0.26), (0.5, 0.04)], fc,
              M_RTU, sides=28, tile_u=1.0, tile_v=0.5, cap_top=False, cap_bot=False)
        for rr in (0.14, 0.26, 0.38, 0.49):
            tube(name + "_grille_%d_%.2f" % (k, rr), [(fc[0] + rr * math.cos(a), fc[1] + 0.25, fc[2] + rr * math.sin(a))
                                                      for a in np.linspace(0, 2 * math.pi, 25)], 0.006, M_STEEL, sides=4, caps=False)
        for a in (0.0, math.pi / 2, math.pi, 1.5 * math.pi):
            tube(name + "_spoke_%d_%.1f" % (k, a), [(fc[0], fc[1] + 0.25, fc[2]),
                                                    (fc[0] + 0.5 * math.cos(a), fc[1] + 0.25, fc[2] + 0.5 * math.sin(a))],
                 0.007, M_STEEL, sides=4, caps=False)
        cyl(name + "_hub_%d" % k, (fc[0], fc[1] + 0.2, fc[2]), (0, 1, 0), 0.1, 0.12, M_STEEL, sides=14, bevel=0.01)
        cyl(name + "_fanbg_%d" % k, (fc[0], fc[1] + 0.03, fc[2]), (0, 1, 0), 0.5, 0.01, M_RUBBER, sides=24)
    dx = cx - flip * (L / 2 + 0.45)
    gbox(name + "_duct", dx - 0.35, dx + 0.35, 0.0, y0 + 0.9, cz - 0.4, cz + 0.4, M_ALU, tile=0.8, bevel=0.012)
    gbox(name + "_duct_top", min(dx - 0.35, cx - flip * (L / 2)), max(dx + 0.35, cx - flip * (L / 2)), y0 + 0.55, y0 + 0.9,
         cz - 0.4, cz + 0.4, M_ALU, tile=0.8, bevel=0.012)
    for fy in (0.3, 0.75):
        gbox(name + "_flange_%.2f" % fy, dx - 0.38, dx + 0.38, fy, fy + 0.03, cz - 0.43, cz + 0.43, M_STEEL, tile=0.5)


def dunnage(name, x0, x1, z, y=0.28):
    for dz in (-0.3, 0.3):
        gbox(name + "_beam_%.1f" % dz, x0, x1, y - 0.12, y, z + dz - 0.05, z + dz + 0.05, M_STEEL, tile=1.0, bevel=0.006)
    for x in np.arange(x0 + 0.2, x1, 1.2):
        gbox(name + "_leg_%.1f" % x, x - 0.05, x + 0.05, 0.0, y - 0.12, z - 0.35, z + 0.35, M_STEEL, tile=0.5)
        gbox(name + "_pad_%.1f" % x, x - 0.18, x + 0.18, 0.0, 0.04, z - 0.42, z + 0.42, M_RUBBER, tile=0.5)


with K.placed(135.0 - 180.0):
    rtu("rtu_a", -2.0, -15.4, flip=1)
    rtu("rtu_b", 2.6, -17.8, flip=-1)
    dunnage("dun_a", -2.4, 2.0, -12.7)
    for k, (key, x) in enumerate((("ac1", -1.9), ("ac5", -0.7), ("ac7", 0.6), ("ac1", 1.6))):
        K.inst(key, "ac_a_%d" % k, (x, 0.28, -12.7), K.face_yaw((0, 0, 1), Vector((-1, 0, 0))), 1.0)
    for x in (-1.9, -0.7, 0.6):
        tube("ac_line_%.1f" % x, [(x, 0.5, -13.0), (x, 0.5, -13.4), (x, 0.06, -13.6), (x + 0.3, 0.06, -14.4)], 0.022,
             M_RUBBER, sides=6)
    gbox("rtu_gravel", -4.4, 5.0, 0.0, 0.035, -19.4, -13.9, M_GRAVEL, tile=1.6, bevel=0.012, segs=1)

# =============================================================== BUILD: skylight, vents, hatch (a = 45)
log("build skylight + vents (a=45)")


def vent(name, x, z, h=1.1, r=0.16):
    lathe(name, [(r * 1.5, 0.0), (r * 1.5, 0.05), (r, 0.06), (r, h), (r * 1.05, h + 0.02), (r * 1.05, h + 0.06)], (x, 0.0, z),
          M_ALU, sides=16, tile_u=0.5, tile_v=0.5, cap_top=False)
    lathe(name + "_cap", [(0.0, h + 0.3), (r * 2.1, h + 0.14), (r * 2.0, h + 0.12)], (x, 0.0, z), M_STEEL, sides=16,
          tile_u=0.5, tile_v=0.5, cap_bot=True)
    for a in (0.0, 2.1, 4.2):
        tube(name + "_leg%.1f" % a, [(x + r * math.cos(a), h + 0.02, z + r * math.sin(a)),
                                     (x + r * 1.7 * math.cos(a), h + 0.15, z + r * 1.7 * math.sin(a))], 0.008, M_STEEL, sides=4)


def skylight(name, cx, cz, L=3.2, D=2.0, H=0.55):
    gbox(name + "_curb", cx - L / 2, cx + L / 2, 0.0, H, cz - D / 2, cz + D / 2, M_BRICK, tile=1.4, bevel=0.01)
    gbox(name + "_cap", cx - L / 2 - 0.04, cx + L / 2 + 0.04, H, H + 0.06, cz - D / 2 - 0.04, cz + D / 2 + 0.04, M_STEEL,
         tile=0.8, bevel=0.008)
    rh = 0.75
    glass = []
    for s in (-1, 1):
        zz0, zz1 = cz + s * (D / 2), cz
        glass.append(quad(name + "_glass_%d" % s, [(cx - L / 2 + 0.05, H + 0.06, zz0), (cx + L / 2 - 0.05, H + 0.06, zz0),
                                                    (cx + L / 2 - 0.05, H + rh, zz1), (cx - L / 2 + 0.05, H + rh, zz1)], M_SKYLIT))
        for k in range(6):
            x = cx - L / 2 + 0.05 + (L - 0.1) * k / 5
            tube(name + "_mull_%d_%d" % (s, k), [(x, H + 0.08, zz0), (x, H + rh + 0.01, zz1)], 0.02, M_STEEL, sides=4)
    tube(name + "_ridge", [(cx - L / 2, H + rh + 0.02, cz), (cx + L / 2, H + rh + 0.02, cz)], 0.035, M_STEEL, sides=6)
    for ob in glass:
        if ob.data.polygons[0].normal.z < 0:
            ob.data.flip_normals()


with K.placed(45.0 - 180.0):
    skylight("skylight", 0.0, -14.4)
    skylight("skylight2", 0.0, -17.4)
    for i, (x, z, h) in enumerate(((-3.3, -12.6, 1.2), (3.1, -13.0, 1.5), (-2.1, -19.4, 1.4), (2.9, -20.2, 1.9), (0.2, -22.0, 1.0))):
        vent("vent_%d" % i, x, z, h)
    K.template("hatch", K.JPM + "Street/JP_Hatch_01.fbx", mat=M_DOOR)
    K.inst("hatch", "roof_hatch", (-3.6, 0.0, -16.2), 0.3, 1.2)
    gbox("sky_gravel", -4.6, 4.6, 0.0, 0.035, -23.0, -12.0, M_GRAVEL, tile=1.6, bevel=0.012, segs=1)

# =============================================================== BUILD: water tank (a = 225, hero)
log("build water tank (a=225)")


def water_tank(cx, cz, legs_h=3.1, r=1.72, h=3.6):
    y0 = legs_h
    for k, (sx, sz) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
        lx, lz = cx + sx * 1.25, cz + sz * 1.25
        gbox("tank_leg_%d" % k, lx - 0.08, lx + 0.08, 0.0, y0, lz - 0.08, lz + 0.08, M_STEEL, tile=1.0, bevel=0.012)
        gbox("tank_foot_%d" % k, lx - 0.25, lx + 0.25, 0.0, 0.2, lz - 0.25, lz + 0.25, M_CONC, tile=0.8, bevel=0.015)
        bolts("tank_foot_bolts_%d" % k, [(lx + dx, 0.2, lz + dz) for dx in (-0.15, 0.15) for dz in (-0.15, 0.15)],
              (0, 1, 0), M_STEEL, r=0.018)
    corners = [(cx - 1.25, cz - 1.25), (cx + 1.25, cz - 1.25), (cx + 1.25, cz + 1.25), (cx - 1.25, cz + 1.25)]
    for f in range(4):
        (ax, az), (bx, bz) = corners[f], corners[(f + 1) % 4]
        for (ya, yb) in ((0.35, 1.7), (1.7, 3.0)):
            tube("tank_x_%d_%.1f_a" % (f, ya), [(ax, ya, az), (bx, yb, bz)], 0.016, M_STEEL, sides=6)
            tube("tank_x_%d_%.1f_b" % (f, ya), [(bx, ya, bz), (ax, yb, az)], 0.016, M_STEEL, sides=6)
        gbox("tank_ring_%d" % f, min(ax, bx) - 0.07, max(ax, bx) + 0.07, 1.66, 1.74, min(az, bz) - 0.07, max(az, bz) + 0.07,
             M_STEEL, tile=1.0, bevel=0.005)
    gbox("tank_deck", cx - 1.95, cx + 1.95, y0 - 0.1, y0, cz - 1.95, cz + 1.95, M_STEEL, tile=1.0, bevel=0.01)
    for f in range(4):
        a = [(cx - 1.9, cz - 1.9), (cx + 1.9, cz - 1.9), (cx + 1.9, cz + 1.9), (cx - 1.9, cz + 1.9)]
        (ax, az), (bx, bz) = a[f], a[(f + 1) % 4]
        tube("tank_rail_%d" % f, [(ax, y0 + 0.95, az), (bx, y0 + 0.95, bz)], 0.018, M_STEEL, sides=6)
        tube("tank_rail_post_%d" % f, [(ax, y0, az), (ax, y0 + 0.95, az)], 0.018, M_STEEL, sides=6)
    prof = [(r * 0.985, 0.0), (r, 0.3), (r * 1.01, h * 0.5), (r, h - 0.3), (r * 0.985, h)]

    def stave_uv(u, L, i):
        return (L / 1.6, u * 2 * math.pi * r / 1.6)
    lathe("tank_staves", prof, (cx, y0, cz), M_WOOD, sides=40, uv_fn=stave_uv, cap_top=True, cap_bot=True)
    lathe("tank_roof", [(r * 1.08, 0.0), (r * 1.08, 0.05), (0.18, 1.0), (0.0, 1.05)], (cx, y0 + h, cz), M_WOOD, sides=40,
          uv_fn=lambda u, L, i: (u * 2 * math.pi * r * 1.08 / 1.6, L / 1.6), cap_bot=True)
    lathe("tank_finial", [(0.09, 0.0), (0.09, 0.2), (0.14, 0.26), (0.0, 0.42)], (cx, y0 + h + 1.0, cz), M_STEEL, sides=12,
          tile_u=0.3, tile_v=0.3)
    for k in range(7):
        yy = y0 + 0.25 + k * (h - 0.5) / 6
        rr = r * (1.0 + 0.012 * math.sin(math.pi * (yy - y0) / h)) + 0.018
        tube("tank_hoop_%d" % k, [(cx + rr * math.cos(a), yy, cz + rr * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 41)],
             0.016, M_STEEL, sides=6, caps=False)
        la = 0.4 + k * 0.9
        gbox("tank_lug_%d" % k, cx + (rr + 0.02) * math.cos(la) - 0.05, cx + (rr + 0.02) * math.cos(la) + 0.05, yy - 0.04, yy + 0.04,
             cz + (rr + 0.02) * math.sin(la) - 0.05, cz + (rr + 0.02) * math.sin(la) + 0.05, M_STEEL, tile=0.3, bevel=0.006)
    la = math.radians(35)
    lx, lz = cx + (r + 0.18) * math.sin(la), cz + (r + 0.18) * math.cos(la)
    tx, tz = math.cos(la), -math.sin(la)
    for s in (-1, 1):
        tube("tank_ladder_rail_%d" % s, [(lx + s * 0.22 * tx, y0, lz + s * 0.22 * tz), (lx + s * 0.22 * tx, y0 + h + 0.5, lz + s * 0.22 * tz)],
             0.018, M_STEEL, sides=6)
    for k in range(int((h + 0.4) / 0.3)):
        yy = y0 + 0.2 + k * 0.3
        tube("tank_rung_%d" % k, [(lx - 0.22 * tx, yy, lz - 0.22 * tz), (lx + 0.22 * tx, yy, lz + 0.22 * tz)], 0.012, M_STEEL,
             sides=5, caps=False)
    px, pz = cx - r * 0.7, cz + r * 0.72
    tube("tank_pipe", [(px, y0 + 0.4, pz), (px - 0.15, y0 + 0.2, pz + 0.12), (px - 0.15, 0.3, pz + 0.12), (px - 0.4, 0.06, pz + 0.12)],
         0.06, M_STEEL, sides=10)
    for yy in (0.8, 2.0):
        gbox("tank_pipe_clamp_%.1f" % yy, px - 0.24, px - 0.06, yy - 0.03, yy + 0.03, pz + 0.04, pz + 0.2, M_STEEL, tile=0.3)


with K.placed(225.0 - 180.0):
    water_tank(0.0, -16.8)
    gbox("tank_gravel", -3.2, 3.2, 0.0, 0.035, -20.0, -13.6, M_GRAVEL, tile=1.6, bevel=0.012, segs=1)

# =============================================================== BUILD: broadcast mast (a = 315, hero)
log("build mast (a=315)")


def mast(cx, cz, H=34.0, a=1.3):
    rr = a / math.sqrt(3)
    legs = [(cx + rr * math.cos(t), cz + rr * math.sin(t)) for t in (math.pi / 2, math.pi / 2 + 2.094, math.pi / 2 + 4.189)]
    for i, (lx, lz) in enumerate(legs):
        tube("mast_leg_%d" % i, [(lx, 0.0, lz), (lx, H, lz)], 0.055, M_STEEL, sides=8)
    bay = 1.5
    n = int(H / bay)
    for k in range(n):
        y0, y1 = k * bay, (k + 1) * bay
        for i in range(3):
            (ax, az), (bx, bz) = legs[i], legs[(i + 1) % 3]
            tube("mast_h_%d_%d" % (k, i), [(ax, y0 + 0.02, az), (bx, y0 + 0.02, bz)], 0.022, M_STEEL, sides=5, caps=False)
            if k % 2 == 0:
                tube("mast_d_%d_%d" % (k, i), [(ax, y0, az), (bx, y1, bz)], 0.018, M_STEEL, sides=5, caps=False)
            else:
                tube("mast_d_%d_%d" % (k, i), [(bx, y0, bz), (ax, y1, az)], 0.018, M_STEEL, sides=5, caps=False)
    for k, yy in enumerate((8.0, 16.0, 24.0, 32.0)):
        lx, lz = legs[k % 3]
        sphere("mast_red_%d" % k, (lx, yy, lz), 0.16, M_RED, seg=10, rings=6)
        cyl("mast_red_base_%d" % k, (lx, yy - 0.16, lz), (0, 1, 0), 0.1, 0.08, M_STEEL, sides=8)
    sphere("mast_top_light", (cx, H + 0.6, cz), 0.22, M_RED, seg=12, rings=7)
    tube("mast_top_rod", [(cx, H, cz), (cx, H + 0.45, cz)], 0.05, M_STEEL, sides=8)
    for k, (yy, ang) in enumerate(((11.0, 0.6), (13.5, -0.9), (19.0, 2.2))):
        dx, dz = math.sin(ang), math.cos(ang)
        c = (cx + dx * 1.2, yy, cz + dz * 1.2)
        cyl("mast_dish_%d" % k, c, (dx, 0.0, dz), 0.7, 0.45, M_RTU, sides=24, bevel=0.03)
        cyl("mast_dish_face_%d" % k, (c[0] + dx * 0.24, c[1], c[2] + dz * 0.24), (dx, 0.0, dz), 0.66, 0.02, M_CONC, sides=24)
        tube("mast_dish_arm_%d" % k, [(cx + dx * 0.4, yy, cz + dz * 0.4), (c[0], yy, c[2])], 0.04, M_STEEL, sides=6)
    for k in range(3):
        lx, lz = legs[k]
        gbox("mast_panel_%d" % k, lx - 0.12, lx + 0.12, 26.0, 28.4, lz - 0.12, lz + 0.12, M_RTU, tile=0.8, bevel=0.02)
    gbox("mast_pier", cx - 1.3, cx + 1.3, 0.0, 0.45, cz - 1.3, cz + 1.3, M_CONC, tile=1.2, bevel=0.03)
    gbox("mast_shelter", cx - 3.8, cx - 1.8, 0.0, 2.3, cz - 1.2, cz + 1.2, M_RTU, tile=1.2, bevel=0.03)
    gbox("mast_shelter_roof", cx - 3.9, cx - 1.7, 2.3, 2.4, cz - 1.3, cz + 1.3, M_STEEL, tile=1.0, bevel=0.01)
    gbox("mast_shelter_door", cx - 3.3, cx - 2.4, 0.05, 2.0, cz + 1.2, cz + 1.22, M_DOOR, tile=1.0, bevel=0.006)
    tube("mast_feeders", [(cx - 1.8, 2.0, cz), (cx - 0.6, 2.0, cz), (cx, 2.4, cz), (cx, 12.0, cz)], 0.06, M_RUBBER, sides=6)


with K.placed(315.0 - 180.0):
    mast(0.8, -20.5)
    gbox("mast_gravel", -4.2, 3.4, 0.0, 0.035, -23.0, -18.0, M_GRAVEL, tile=1.6, bevel=0.012, segs=1)

# =============================================================== BUILD: show billboard (south, hero)
log("build billboard (south)")
with K.placed(180.0):
    BZ, BXC, BW, BH, BY0 = -19.5, 0.0, 9.6, 4.8, 3.4
    bx0, bx1 = BXC - BW / 2, BXC + BW / 2
    gbox("bill_back", bx0, bx1, BY0, BY0 + BH, BZ - 0.18, BZ - 0.02, M_STEEL, tile=2.0)
    front_quad("bill_face", bx0, bx1, BY0, BY0 + BH, BZ - 0.015, M_BILL)
    for (a, b_, c, d) in ((bx0 - 0.2, bx1 + 0.2, BY0 + BH, BY0 + BH + 0.2), (bx0 - 0.2, bx1 + 0.2, BY0 - 0.2, BY0),
                          (bx0 - 0.2, bx0, BY0, BY0 + BH), (bx1, bx1 + 0.2, BY0, BY0 + BH)):
        gbox("bill_frame_%.1f_%.1f" % (a, c), a, b_, c, d, BZ - 0.22, BZ + 0.06, M_STEEL, tile=1.0, bevel=0.02)
    for x in (bx0 + 1.3, BXC, bx1 - 1.3):
        gbox("bill_col_%.1f" % x, x - 0.14, x + 0.14, 0.0, BY0 + BH, BZ - 0.55, BZ - 0.25, M_STEEL, tile=1.0, bevel=0.012)
        tube("bill_brace_%.1f" % x, [(x, 0.05, BZ - 3.4), (x, BY0 + BH * 0.7, BZ - 0.45)], 0.07, M_STEEL, sides=8)
        gbox("bill_col_foot_%.1f" % x, x - 0.35, x + 0.35, 0.0, 0.3, BZ - 0.75, BZ - 0.05, M_CONC, tile=1.0, bevel=0.02)
    gbox("bill_catwalk", bx0, bx1, BY0 - 0.34, BY0 - 0.28, BZ - 0.1, BZ + 0.75, M_STEEL, tile=1.0, bevel=0.006)
    for x in np.arange(bx0, bx1 + 0.01, 1.6):
        tube("bill_cw_post_%.1f" % x, [(x, BY0 - 0.28, BZ + 0.72), (x, BY0 + 0.7, BZ + 0.72)], 0.02, M_STEEL, sides=6)
    tube("bill_cw_rail", [(bx0, BY0 + 0.7, BZ + 0.72), (bx1, BY0 + 0.7, BZ + 0.72)], 0.022, M_STEEL, sides=6)
    for k in range(7):
        x = bx0 + 0.75 + k * (BW - 1.5) / 6
        pts = [(x, BY0 - 0.28, BZ + 0.6), (x, BY0 + 0.1, BZ + 0.95), (x, BY0 + 0.55, BZ + 1.2), (x, BY0 + 0.8, BZ + 1.1)]
        tube("bill_neck_%d" % k, pts, 0.02, M_STEEL, sides=6)
        cyl("bill_lamp_%d" % k, (x, BY0 + 0.84, BZ + 1.05), (0, 0.6, -0.8), 0.13, 0.22, M_STEEL, sides=14, r2=0.07)
        cyl("bill_lamp_lens_%d" % k, (x, BY0 + 0.78, BZ + 0.97), (0, 0.6, -0.8), 0.115, 0.01, M_LENS, sides=14)
    gbox("bill_gravel", bx0 - 0.8, bx1 + 0.8, 0.0, 0.035, BZ - 4.0, BZ + 0.3, M_GRAVEL, tile=1.6, bevel=0.012, segs=1)

# =============================================================== BUILD: city skyline all around (lit windows)
log("build skyline")
QUAD = {0: (0.0, 1.0), 1: (0.5, 1.0), 2: (0.0, 0.5), 3: (0.5, 0.5)}     # quadrant (u0, v_top)


def facade_box(name, x0, x1, ytop, z0, z1, style, rng, ybase=-45.0):
    """window-textured upper part (<= 56 m) + dark base; UVs keep ~2.4 m bays / 3.5 m floors from the roofline down"""
    objs = []
    yb = max(ybase, ytop - 56.0)
    if yb > ybase:
        objs.append(gbox(name + "_base", x0, x1, ybase, yb, z0, z1, M_CITYROOF, tile=8.0))
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x = x0 + (v.co.x + 0.5) * (x1 - x0)
        v.co.y = -z1 + (v.co.y + 0.5) * (z1 - z0)
        v.co.z = yb + (v.co.z + 0.5) * (ytop - yb)
    uvl = bm.loops.layers.uv.new("UVMap")
    qu, qv = QUAD[style]
    offu = int(rng() * 4) / 8.0 * 0.5
    for f in bm.faces:
        n = f.normal
        if abs(n.z) > 0.5:
            f.material_index = 1
            for loop in f.loops:
                loop[uvl].uv = (0.0, 0.0)
            continue
        horiz = (x1 - x0) if abs(n.y) > 0.5 else (z1 - z0)
        for loop in f.loops:
            co = loop.vert.co
            along = (co.x - x0) if abs(n.y) > 0.5 else (co.y + z1)
            u = qu + offu + (along / max(1e-3, horiz)) * min(0.5 - offu, 0.5 * horiz / 24.0)
            v = qv - (ytop - co.z) / 56.0 * 0.5
            loop[uvl].uv = (u, v)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(M_WIN)
    me.materials.append(M_CITYROOF)
    ob = bpy.data.objects.new(name, me)
    K.COL_SET.objects.link(ob)
    objs.append(ob)
    return objs


rng = K.mulberry32(1313)
RINGS = [(40.0, (3.0, 15.0), (8.0, 18.0)), (56.0, (9.0, 34.0), (10.0, 22.0)), (76.0, (16.0, 46.0), (12.0, 24.0))]
nb = 0
for bi, (Rb, (h0, h1), (w0, w1)) in enumerate(RINGS):
    ang = rng() * 20.0
    while ang < 360.0:
        w = w0 + (w1 - w0) * rng()
        d = 8.0 + 8.0 * rng()
        top = h0 + (h1 - h0) * rng() ** 1.3
        z = -Rb - 5.0 * rng()
        style = int(rng() * 4) % 4
        with K.placed(ang):
            facade_box("bld_%d_%d" % (bi, nb), -w / 2, w / 2, top, z - d, z, style, rng)
            if rng() < 0.45:
                cw = w * (0.45 + 0.25 * rng())
                cx0 = -w / 2 + (w - cw) * rng()
                facade_box("bld_%d_%d_crown" % (bi, nb), cx0, cx0 + cw, top + 3.0 + 7.0 * rng(), z - d * 0.8, z - d * 0.1,
                           (style + 1) % 4, rng)
            rsel = rng()
            if rsel < 0.3:
                tx, tz = -w / 2 + w * (0.2 + 0.6 * rng()), z - d * 0.5
                lathe("bld_tank_%d" % nb, [(1.2, 0.0), (1.2, 2.4), (1.3, 2.45), (0.0, 3.2)], (tx, top + 1.8, tz), M_CITYROOF, sides=10)
                for k in range(4):
                    a = k * math.pi / 2 + 0.785
                    tube("bld_tank_leg_%d_%d" % (nb, k), [(tx + math.cos(a), top, tz + math.sin(a)),
                                                          (tx + math.cos(a), top + 1.8, tz + math.sin(a))], 0.08, M_CITYROOF, sides=4)
            elif rsel < 0.55:
                mx, mz = -w / 2 + w * (0.2 + 0.6 * rng()), z - d * 0.4
                mh = 4.0 + 9.0 * rng()
                tube("bld_mast_%d" % nb, [(mx, top, mz), (mx, top + mh, mz)], 0.15, M_CITYROOF, sides=4)
                sphere("bld_mast_red_%d" % nb, (mx, top + mh + 0.2, mz), 0.35, M_RED, seg=8, rings=5)
            elif rsel < 0.75:
                for k in range(int(2 + 3 * rng())):
                    ax = -w / 2 + 1.0 + max(0.0, w - 3.0) * rng()
                    gbox("bld_ac_%d_%d" % (nb, k), ax, ax + 1.6, top, top + 1.2, z - d * 0.7, z - d * 0.7 + 1.2, M_CITYROOF, tile=4.0)
        ang += math.degrees((w + 0.6 + 2.5 * rng()) / Rb)
        nb += 1
log("buildings", nb)

# =============================================================== BUILD: night sky all around (jp_Sky_Night_4a, 2 halves)
log("build sky")


def sky_textures():
    """the equirect around its horizon glow as TWO 180-degree halves (elevation -14..+34 deg), exposure-normalised,
    sRGB 8 bit: half 0 is centred on the glow (placed behind the neon sign, north), half 1 is the rest. Image columns run
    left -> right = decreasing yaw as seen from the ring (the P2 crop's orientation, extended to 360)."""
    src = bpy.data.images.load(JP_SKY, check_existing=True)
    Wd, H = src.size
    a = np.empty(Wd * H * 4, np.float32)
    src.pixels.foreach_get(a)
    a = a.reshape(H, Wd, 4)                  # row 0 = bottom (elevation -90)
    lumi = a[..., :3] @ np.array([0.2126, 0.7152, 0.0722], np.float32)

    def row_of(e):
        return int(round((e + 90.0) / 180.0 * H))
    band = lumi[row_of(0.5):row_of(6.0)].mean(0)
    k = np.ones(64, np.float32) / 64
    sm = np.convolve(np.concatenate([band, band[:64]]), k, mode="same")[:Wd]
    c = int(np.argmax(sm))
    r0, r1 = row_of(-14.0), row_of(34.0)
    ow, oh = 1024, 384
    halves = []
    ps = []
    crops = []
    for hh in range(2):
        start = c - Wd // 4 + hh * (Wd // 2)
        cols = np.arange(start, start + Wd // 2) % Wd
        crop = a[r0:r1][:, cols, :3]
        yi = (np.linspace(0, crop.shape[0] - 1, oh)).astype(int)
        xi = (np.linspace(0, crop.shape[1] - 1, ow)).astype(int)
        acc = np.zeros((oh, ow, 3), np.float32)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                acc += crop[np.clip(yi + dy, 0, crop.shape[0] - 1)][:, np.clip(xi + dx, 0, crop.shape[1] - 1)]
        acc /= 9.0
        crops.append(acc)
        ps.append(np.percentile(acc, 99.7))
    p = max(ps)                              # one exposure for both halves (no seam in brightness)
    for hh, acc in enumerate(crops):
        lin = np.clip(acc * (0.85 / max(p, 1e-6)), 0, 1)
        srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
        im = bpy.data.images.new("rt13_sky_%d" % hh, ow, oh, alpha=True)
        out = np.ones((oh, ow, 4), np.float32)
        out[..., :3] = srgb
        im.pixels.foreach_set(out.ravel())
        im.filepath_raw = os.path.join(K.TEX, "rt13_sky_%d.png" % hh)
        im.file_format = "PNG"
        im.save()
        halves.append(im)
    log("sky: glow azimuth column %d of %d, p99.7 %.4f / %.4f -> %.4f" % (c, Wd, ps[0], ps[1], p))
    return halves


SKY_R = 100.0
E0, E1 = math.radians(-14.0), math.radians(34.0)
for hh, im in enumerate(sky_textures()):
    msky = mat_unlit("rt13_sky_%d" % hh, im)
    a_left = 270.0 - 180.0 * hh           # half 0: yaw 270 -> 90 through 180 (north); half 1: yaw 90 -> -90 through 0

    def sky_fn(u, v, a_left=a_left):
        th = math.radians(a_left - 180.0 * u)
        e = E1 - (E1 - E0) * v
        y = 1.35 + SKY_R * math.tan(e)
        return (SKY_R * math.sin(th), y, SKY_R * math.cos(th))
    K.surface("sky_backdrop_%d" % hh, 36, 10, sky_fn, msky, lambda u, v: (u, 1 - v), flip=False)
    sk = K.COL_SET.objects["sky_backdrop_%d" % hh]
    p = sk.data.polygons[len(sk.data.polygons) // 2]
    if p.normal.dot(-p.center.normalized()) < 0:      # the backdrop faces the ring
        sk.data.flip_normals()

# =============================================================== BUILD: rain streaks (node rain_fall)
log("build rain")
rng = K.mulberry32(4242)
PER = 10.0
for i in range(120):
    rr = math.sqrt(11.0 ** 2 + (16.5 ** 2 - 11.0 ** 2) * rng())    # annulus r 11..16.5: >= 1.5 m from any orbit camera
    aa = rng() * 2 * math.pi
    x, z = rr * math.sin(aa), rr * math.cos(aa)
    y = PER * rng()
    w, h = 0.7, 3.4
    uo, vo = rng(), rng()
    yaw0 = rng() * math.pi
    for cross in (0.0, math.pi / 2):          # crossed pair: visible from every orbit angle
        yw = yaw0 + cross
        dx, dz = math.cos(yw) * w / 2, -math.sin(yw) * w / 2
        for rep in (0.0, PER):
            yy = y + rep
            ob = quad("rain_%d_%d_%d" % (i, int(cross > 0), int(rep)), [(x - dx, yy, z - dz), (x + dx, yy, z + dz),
                                                                        (x + dx, yy + h, z + dz), (x - dx, yy + h, z - dz)],
                      M_RAIN, ((uo, vo), (uo + 1, vo), (uo + 1, vo + 1), (uo, vo + 1)))
            ob["depth_hide"] = 1
            DRESS["rain_fall"].append(ob)

# =============================================================== crowd nodes + clearance
K.crowd_nodes()
clear_r, offenders, low_top = K.clearance(CLEAR_R, 1.15, 4.5, skip=("rain_",))
S["camera"]["clearRadiusM"] = math.floor(clear_r * 100.0) / 100.0
S["build"] = {"clearance": K.clearance_record(clear_r, offenders, low_top, CLEAR_R, 1.15, 4.5, K.LAST_NEAREST)}
S["ring"]["measuredLowTopM"] = round(low_top, 3)
if offenders:
    log("CLEARANCE FAIL: %d objects inside %.1f m in the camera band" % (len(offenders), CLEAR_R))

# =============================================================== contact render (ENV_KIT 8.3) or main
if K.DO_CONTACT:
    keep = [o for o in K.COL_SET.objects if o.name.startswith(("tank_", "rtu_a", "truss_45_", "bar_0_", "rail_post_0",
                                                                 "rail_cable", "neon_"))]
    for o in list(K.COL_SET.objects):
        if o not in keep:
            o.hide_render = True
    for o in K.COL_NODES.objects:
        o.hide_render = True
    K.contact_render(keep, "rooftop_contact.png", K.PHH + "abandoned_parking/abandoned_parking_2k.hdr",
                     span=16.0, cam_pos=[0.0, 5.0, 26.0], look=[0.0, 2.8, 0.0], fov=60.0)
else:
    if K.DO_EXPORT or not os.path.exists(os.path.join(K.OUT3D, S["environment"]["hdr"])):
        K.env_map(JP_SKY, "rooftop_env.hdr")
    if K.DO_RENDER:
        K.render_proofs([
            {"id": "overview", "pos": [13.0, 9.0, 15.0], "look": [0.0, 1.2, 0.0], "fov": 58.0},
            {"id": "plan", "pos": [0.0, 34.0, 0.01], "look": [0.0, 0.0, 0.0], "fov": 62.0},
            {"id": "ring_detail", "pos": [3.2, 1.6, 7.4], "look": [4.6, 0.6, 3.6], "fov": 45.0},
        ], [("Eve", "Eve By J.Gonzales.fbx", S["spawn"]["p1"][0], 1, 1.72),
            ("Ch06", "Ch06_nonPBR.fbx", S["spawn"]["p2"][0], -1, 1.78)])
    K.tri_report(["tank_", "rtu_a", "rtu_b", "mast_", "bill_", "neon_", "truss_45_", "bar_", "bn_", "bs_", "door_",
                  "bh_", "mr_", "louvre_", "skylight", "vent_0", "bld_", "sky_", "puddle", "bulb_", "strand_", "ac_a_0",
                  "rail_", "ring_", "pad_", "rain_"])
    if K.DO_EXPORT:
        K.export([(n, objs, None) for n, objs in DRESS.items()])
        K.write_fragment()
        if K.DO_FINISH:
            K.run_finish()
log("DONE")
