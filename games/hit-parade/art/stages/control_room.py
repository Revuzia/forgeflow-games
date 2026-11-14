"""HIT PARADE - stage 5 THE CONTROL ROOM (boss stage, RICKY MARQUEE), built headless in Blender (lanes STAGES-B P2,
STAGES3D-B 3D ring).

3D RING (CONTRACT 35.6 / 35.11, owner: "it should be 3d or circular where we can walk around the ring to fight"): the
host's finale pit in the boiler room under the studio - an OCTAGONAL ring (inscribed radius 5.5 m, flat sides facing
+-X / +-Z) on a steel diamond-plate deck with the painted HIT PARADE finale logo, bounded by riveted kick panels with
hazard tops, 8 padded yellow corner posts and two yellow rails (<= 1.11 m), ringed by a glowing grated pipe trench.
Around it, outside a 9.5 m camera-clear radius, on ALL sides: north = the raised host dais with marquee bulbs, the curved
host desk with the lit HIT PARADE logo and the wall of CRT monitors under an ON AIR box, angled CRT banks either side;
south = the elevated CONTROL booth behind glass with the crew at the console (silhouettes); east = the riveted boiler with
its glowing firebox, the pipe manifold, the hot-water tank and a rotating amber beacon; west = the brick wall with the
riveted blast door, an OBSERVATION window with staff behind the glass above it and the second beacon; the four diagonals =
the studio crowd on steel risers; overhead = the octagonal light rig above the ring, I-beams, painted pipes, cable trays and
caged lamps under a low ceiling in an octagonal brick room.

Usage (blender.exe directly so the log is visible; paths are resolved from this file):
  blender.exe --background --python art/stages/control_room.py -- [--no-export] [--no-render] [--no-art] [--no-finish]
        [--shots id,id] [--res 1920x1080] [--samples 48] [--no-fighters] [--contact] [--orbit-only] [--no-orbit]
Outputs (STAGED until `python art/stages/stagefinish_b.py control_room --swap`):
  _harness/scratch/stages_cache/control_room_raw.glb -> _harness/scratch/stages_cache/out3d/control_room.glb (chain D)
  _harness/scratch/stages_cache/out3d/control_room_env.hdr     (512x256 IBL, Poly Haven abandoned_garage, CC0)
  _harness/scratch/stages_cache/out3d/control_room.stage.json  (StageDef fragment, CONTRACT 21.2 + 35.11)
  _harness/_reports/stages/control_room_<shot>.png + control_room_orbit_<near|far>_<k>.png (orbit proofs + sheets)
The StageDef below is the source of truth; the build reads it (ring, lights, fog, crowd bays, proof cameras).
Sources (read-only): Quaternius MegaKit T_Brick (CC0; OpenGL normal), Blink Cracked_Concrete_Floor (EULA), Japan
Village JP_Meters textures + JP_Electric_Meter_03 model (EULA), ForgeFlow generated bronze_worn (original), Poly Haven
abandoned_garage HDRI (CC0). Everything else is procedural here; 2D art is art2d_b.py. ASCII only.
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
from stagekit_b import G, gbox, obox, tube, cyl, sphere, lathe, quad, mat_pbr, bolts  # noqa: E402

HDRI = K.PHH + "abandoned_garage/abandoned_garage_2k.hdr"

APO = 5.5                                  # CONTRACT 35.11 ring.radiusM (poly: inscribed radius, centre to a side)
VRAD = APO / math.cos(math.radians(22.5))  # vertex radius 5.953
SIDE = 2.0 * APO * math.tan(math.radians(22.5))
CLEAR_R = 9.5
ROOM_APO = 18.6                            # octagonal room walls
CEIL = 7.8

CAMERA = {
    "vFovDeg": 35.0, "heightM": 1.35, "lookAtY": 1.0, "pitchDeg": -4.0, "distanceM": [4.4, 9.5], "orbit": True,
    "clearRadiusM": None, "clearBandM": [1.15, 4.5],
    "note": "CONTRACT 35.7 orbit camera: position = pair midpoint + camN * dist + up * 1.35 m, pitch -4 deg. "
            "clearRadiusM = measured at build (also build.clearance, CONTRACT 35.11.5). proofShots = the orbit set "
            "orbit_<deg>_<n|f> (CONTRACT 35.11.7: 8 angles from cameraSideDeg, 4.4 / 8.0 m, eye 1.35, look-at (0, 1.0, 0)) "
            "+ near_center / far_center aliases of orbit_000_n / _f. "
            "Proof renders: _harness/_reports/stages/control_room_*.png",
    "proofShots": K.proof_shot_list(0.0),
}

STAGE = {
    "id": "control_room",
    "name": "THE CONTROL ROOM",
    "status": "built",
    "glb": "control_room.glb",
    "source": "art/stages/control_room.py",
    "home": ["krane", "ricky"],
    "boss": "ricky",
    "look": "the host's finale pit in the boiler room under the studio: an octagonal steel ring with the painted HIT PARADE "
            "finale logo, riveted kick panels, padded yellow corner posts and rails, a glowing grated pipe trench around it; "
            "the raised host dais and desk with the lit logo under a wall of CRT monitors, the CONTROL booth behind glass with "
            "the crew at the console, the riveted boiler with a glowing firebox and pipe manifold, a brick wall with a "
            "blast door and an observation window, rotating amber beacons, the crowd on steel risers all around, the "
            "octagonal light rig, pipes, I-beams and caged lamps under a low ceiling",
    "ring": {"shape": "poly", "centre": [0.0, 0.0], "radiusM": APO, "sides": 8, "rotDeg": 0.0,
             "vertexRadiusM": round(VRAD, 4), "wallHeightM": 0.97, "thicknessM": 0.5, "dustColor": "#6f7a74",
             "surface": "steel_rail",
             "note": "CONTRACT 35.11: poly -> radiusM = inscribed radius (centre to a side), side k (= WALL_SPLAT b) has its "
                     "outward normal at yaw rotDeg + 45 k (k 0 = +Z, 2 = +X); riveted kick panels 0.42 m, yellow rails at "
                     "0.60 / 0.90 m, padded corner posts 0.97 m at the 8 vertices (yaw 22.5 + 45 k); kept low so the orbit "
                     "camera outside the ring still sees the fighters' feet"},
    "spawnAxisDeg": 90.0,
    "cameraSideDeg": 0.0,
    "cameraMaxM": 9.5,
    "floor": {"y": 0.0, "surface": "steel_deck", "fightStrip": {"x": [-8.0, 8.0], "z": [-1.5, 1.5]},
              "extent": {"x": [-ROOM_APO, ROOM_APO], "z": [-ROOM_APO, ROOM_APO]},
              "note": "fightStrip is LEGACY (P1 plane, CONTRACT 35.6); the fight area is `ring`"},
    "walls": {
        "x": [-8.0, 8.0],
        "splat": [
            {"id": 0, "x": -8.0, "normal": [1, 0, 0], "z": [-3.4, 3.4], "heightM": 1.1, "surface": "steel_rail",
             "dustColor": "#6f7a74"},
            {"id": 1, "x": 8.0, "normal": [-1, 0, 0], "z": [-3.4, 3.4], "heightM": 1.1, "surface": "steel_rail",
             "dustColor": "#6f7a74"},
        ],
        "note": "LEGACY (P1 plane walls at x -8 / +8) kept until the sim reads `ring` (CONTRACT 35.6); in 3D every side of "
                "the octagon is the riveted kick panel + rails (dust #6f7a74)",
    },
    "spawn": {"distanceM": 2.40, "p1": [-1.2, 0.0, 0.0], "p2": [1.2, 0.0, 0.0]},
    "camera": CAMERA,
    "exposure": 1.1,
    "toneMapping": "neutral",
    "fog": {"color": "#140f10", "near": 16.0, "far": 60.0},
    "environment": {"hdr": "control_room_env.hdr", "intensity": 0.32, "background": False,
                    "src": "Poly Haven abandoned_garage_2k.hdr (CC0), downsampled to 512x256",
                    "backgroundColor": "#0c0a0b"},
    "lights": [
        {"id": "key", "type": "directional", "color": "#ffd6a8", "intensity": 2.3,
         "position": [-4.0, 12.0, 5.0], "target": [0.0, 0.6, 0.0], "castShadow": True,
         "shadow": {"mapSize": 1024, "bias": -0.0004, "normalBias": 0.03,
                    "camera": {"left": -7.5, "right": 7.5, "top": 7.5, "bottom": -7.5, "near": 1.0, "far": 40.0}}},
        # CHANGED(fix_ui_stage): rim raised from 17 to ~43 deg elevation - at 17 deg its mirror image in the steel deck sat
        # at the fighters' feet in the round-start view (a cyan bloom pool round P2's boots); now it reflects below the frame
        {"id": "rim", "type": "directional", "color": "#6fd6ff", "intensity": 1.0,
         "position": [2.2, 9.5, -8.8], "target": [0.0, 1.2, 0.0], "castShadow": False},
        {"id": "fill", "type": "hemisphere", "sky": "#3c4452", "ground": "#2c1b12", "intensity": 0.8},
        # CHANGED(fix_ui_stage) (verifier D5 / modes D6, measured in the real game: _harness/_reports/progress_fix_ui_stage.md):
        # every practical light sits OFF its fixture now - a point light 0.3-0.4 m from a lit surface put 100-200 lux on it
        # (furnace door / beacon dome / CRT faces peaked at luminance 16-32 = the flares over the fighters' heads); the ring
        # spot was 320 cd 6 m over the centre (~16 lux on the tops of the heads vs the key's 2.3: both fighters blown out
        # orange-white at every orbit angle) -> 70.
        {"id": "crt_wall", "type": "point", "color": "#86d2ff", "intensity": 32.0, "distance": 14.0, "decay": 2,
         "position": [0.0, 3.6, -12.6], "flicker": {"amp": 0.05, "hz": 17.0}},
        {"id": "furnace", "type": "point", "color": "#ff6a20", "intensity": 14.0, "distance": 12.0, "decay": 2,
         "position": [9.4, 0.8, 0.0], "flicker": {"amp": 0.25, "hz": 5.0}},
        {"id": "ring_spot", "type": "spot", "color": "#fff0d8", "intensity": 70.0, "distance": 14.0, "decay": 2,
         "position": [0.0, 6.05, 0.0], "target": [0.0, 0.0, 0.0], "angleDeg": 34.0, "penumbra": 0.55},
        {"id": "beacon", "type": "point", "color": "#ffa020", "intensity": 5.0, "distance": 8.0, "decay": 2,
         "position": [-9.9, 2.9, 3.75], "flicker": {"amp": 0.6, "hz": 1.3}},
    ],
    "lightsNote": "FIXED pool: created once at stage load, never added/removed (shader programs stay warm). "
                  "No lights are embedded in the GLB. Flicker = view-only intensity modulation (beacon = the rotating "
                  "amber sweep, furnace = fire). 3D ring: key from high above + the overhead ring spot light the ring from "
                  "every orbit angle; CRT wall glow north, furnace east, beacon west, cyan rim from the CRT side. "
                  "CHANGED(fix_ui_stage): practical point lights stand 1-2 m off their fixtures (furnace 2.1 m in front of the "
                  "door, beacon 1.35 m out from the west dome, CRT glow 3.8 m in front of the wall) and the ring spot is 70 cd "
                  "(was 320: the fighters washed out); the firebox door sits low (glow 0.47-0.93 m, below the 1.35 m orbit eye).",
    "crowd": {
        "atlas": "crowd_atlas.webp", "meta": "crowd_atlas.json", "cols": 12, "rows": 6, "count": 72,
        "cardHeightM": 2.4, "cardWidthM": 1.2, "anchor": [0.5, 0.97917],
        "tint": "#dcc8b6", "brightness": 0.46,
        "moods": {"idle": ["watch"], "cheer": ["cheer", "hype"], "jeer": ["jeer"]},
        "nodes": "GLB empties crowd_<bay>_<row>_<i>: position = feet point, +Z = card facing, uniform scale = card "
                 "height; extras {bay,row,i,rand,angle}. Generated from the bays below: rows along LOCAL x facing local +Z "
                 "(the ring), then yawed about the ring centre by rotDeg (CONTRACT 35.11). booth / observation = the crew "
                 "behind the glass (south booth, west window).",
        "bays": [
            {"id": "risers_ne", "x": [-3.9, 3.9], "spacing": 0.62, "jitter": [0.12, 0.06], "faceYawDeg": 0.0, "rotDeg": -135.0,
             "rows": [{"z": -10.42, "y": 0.3}, {"z": -11.27, "y": 0.6}, {"z": -12.12, "y": 0.9}], "seed": 5101, "gapPct": 0.05},
            {"id": "risers_se", "x": [-3.9, 3.9], "spacing": 0.62, "jitter": [0.12, 0.06], "faceYawDeg": 0.0, "rotDeg": -45.0,
             "rows": [{"z": -10.42, "y": 0.3}, {"z": -11.27, "y": 0.6}, {"z": -12.12, "y": 0.9}], "seed": 5102, "gapPct": 0.05},
            {"id": "risers_sw", "x": [-3.9, 3.9], "spacing": 0.62, "jitter": [0.12, 0.06], "faceYawDeg": 0.0, "rotDeg": 45.0,
             "rows": [{"z": -10.42, "y": 0.3}, {"z": -11.27, "y": 0.6}, {"z": -12.12, "y": 0.9}], "seed": 5103, "gapPct": 0.05},
            {"id": "risers_nw", "x": [-3.9, 3.9], "spacing": 0.62, "jitter": [0.12, 0.06], "faceYawDeg": 0.0, "rotDeg": 135.0,
             "rows": [{"z": -10.42, "y": 0.3}, {"z": -11.27, "y": 0.6}, {"z": -12.12, "y": 0.9}], "seed": 5104, "gapPct": 0.05},
            {"id": "booth", "x": [-3.3, 3.3], "spacing": 1.1, "jitter": [0.18, 0.08], "faceYawDeg": 0.0, "rotDeg": 180.0,
             "rows": [{"z": -12.75, "y": 1.7}], "seed": 5105, "gapPct": 0.0, "frontHalfM": 9.0},
            {"id": "observation", "x": [-2.4, 2.4], "spacing": 1.2, "jitter": [0.15, 0.06], "faceYawDeg": 0.0, "rotDeg": 90.0,
             "rows": [{"z": -12.55, "y": 3.6}], "seed": 5106, "gapPct": 0.0, "frontHalfM": 9.0},
        ],
    },
    "music": "music_stage_control_room",
    "musicHint": "AUDIO lane cue 'control_room' (runtime/src/audio/manifest.ts music_control_room); RICKY fights use 'boss'",
    "ambient": "amb_control_room_hum",
    "ambientHint": "boiler rumble + steam hiss, CRT whine, beacon motor, crowd bed following SHOWTIME",
    "dressing": {
        "animated": [
            {"what": "warning beacons", "nodes": "anim_spin_beacon_l, anim_spin_beacon_r",
             "how": "existing view hook anim_spin_* (stage.ts: rotate about local Y); the amber dome carries a bright "
                    "sweep band, so the spin reads as a rotating beacon; point light `beacon` flickers with it"},
            {"what": "CRT screens", "nodes": "anim_flicker_crt", "how": "view: live screen feed by name (crt) / flicker"},
            {"what": "dais bulbs", "nodes": "marquee_bulbs", "how": "view chase by name (*bulbs)"},
            {"what": "furnace", "how": "point light `furnace` flicker (view-only)"},
            {"what": "crowd", "how": "instanced cards, vertex bob/sway, pose swaps by ratings mood"},
        ],
        "splatWallDust": ["#6f7a74", "#6f7a74"],
    },
}

K.init("control_room", STAGE)
S = STAGE
log = K.log

# =============================================================== materials
log("materials")
M_DECK = mat_pbr("cr_deck", "cr_deck_a", "cr_deck_n", "cr_deck_r", metallic=0.5)
M_PANEL = mat_pbr("cr_panel", "cr_panel_a", "cr_panel_n", "cr_panel_r", metallic=0.45)
M_BRICK = mat_pbr("cr_brick", "cr_brick_a", "cr_brick_n", "cr_brick_r")
M_CONC = mat_pbr("cr_conc", "cr_conc_a", "cr_conc_n", "cr_conc_r")
# BLEND, not MASK: at the game camera's grazing angle the mip-averaged bar alpha fell under 0.5 and three.js alphaTest
# discarded the whole grate (measured in the STAGES lab); blended, the far grate reads as a see-through grey mesh
M_GRATE = mat_pbr("cr_grate", "cr_grate_a", "cr_grate_n", roughness=0.55, metallic=0.8, alpha="BLEND", double=True)
M_PLASTIC = mat_pbr("cr_plastic", "cr_plastic_a", "cr_plastic_n", "cr_plastic_r")
M_PIPE = mat_pbr("cr_pipe", "cr_pipe_a", "cr_pipe_n", "cr_pipe_r", metallic=0.3)
M_BRASS = mat_pbr("cr_brass", "cr_brass_a", "cr_brass_n", "cr_brass_r", metallic=1.0)
M_METERS = mat_pbr("cr_meters", "cr_meters_a", "cr_meters_n", "cr_meters_r")
M_STEEL = mat_pbr("cr_steel", "cr_steel_a", "cr_steel_n", "cr_steel_r", metallic=0.4)
M_YELLOW = mat_pbr("cr_yellow", "cr_yellow_a", "cr_steel_n", "cr_steel_r", metallic=0.2)
M_LACQ = mat_pbr("cr_lacquer", "cr_lacquer_a", "cr_plastic_n", "cr_lacquer_r")
M_SIGN = mat_pbr("cr_sign", "cr_signs", roughness=0.45)
M_SIGNLIT = mat_pbr("cr_signlit", "cr_signs", roughness=0.35, etex="cr_signs", estrength=2.2)
M_SIGN2 = mat_pbr("cr_sign2lit", "cr_signs2", roughness=0.4, etex="cr_signs2", estrength=1.6)
M_LOGO = mat_pbr("cr_floorlogo", "cr_floorlogo", roughness=0.4, alpha="MASK")
# CHANGED(fix_ui_stage): screen glass 0.12 -> 0.4 roughness - the CRT glow light mirrored in the glossy faces as hot spots
# (luminance 11-15) right behind the pair in the round-start view
M_SCREEN = mat_pbr("cr_screen", color=(0.0, 0.0, 0.0, 1), roughness=0.4, etex="cr_screens", estrength=1.8)
M_SCREEN_F = mat_pbr("cr_screen_flicker", color=(0.0, 0.0, 0.0, 1), roughness=0.4, etex="cr_screens", estrength=1.8)
# CHANGED(fix_ui_stage): beacon dome 3.0 -> 1.4 and the trench / post-LED glow 5.0 -> 3.0 (bloom flares at the orbit camera);
# the firebox door has its own dimmer glow (it read as a white-hot flare at head height)
M_BEACON = mat_pbr("cr_beacon", color=(0.7, 0.35, 0.05, 1), roughness=0.2, etex="cr_signs", estrength=1.4)
M_GLOW = mat_pbr("cr_glow", color=(1.0, 0.45, 0.1, 1), roughness=0.6, emission=(1.0, 0.36, 0.06, 1), estrength=3.0)
M_FIRE = mat_pbr("cr_fireglow", color=(1.0, 0.45, 0.1, 1), roughness=0.7, emission=(1.0, 0.36, 0.06, 1), estrength=2.0)
M_BULB = mat_pbr("cr_bulb", color=(1.0, 0.86, 0.62, 1), roughness=0.3, emission=(1.0, 0.72, 0.4, 1), estrength=5.0)
M_RED = mat_pbr("cr_redlamp", color=(1.0, 0.12, 0.06, 1), roughness=0.3, emission=(1.0, 0.08, 0.04, 1), estrength=6.0)
M_GREEN = mat_pbr("cr_greenled", color=(0.2, 1.0, 0.3, 1), roughness=0.3, emission=(0.2, 1.0, 0.3, 1), estrength=4.0)
M_RUBBER = mat_pbr("cr_rubber", color=(0.018, 0.018, 0.02, 1), roughness=0.55)
M_GLASS = mat_pbr("cr_glass", color=(0.03, 0.035, 0.04, 1), roughness=0.05)
M_WINDOW = mat_pbr("cr_window", color=(0.05, 0.08, 0.1, 1), roughness=0.04, alpha="BLEND", alpha_value=0.32, double=True)
M_ROOMLIT = mat_pbr("cr_roomlit", color=(0.1, 0.12, 0.13, 1), roughness=0.8, emission=(0.55, 0.72, 0.85, 1), estrength=0.55)
M_PAD = mat_pbr("cr_pad", color=(0.38, 0.03, 0.04, 1), roughness=0.38)

DRESS = {"anim_spin_beacon_l": [], "anim_spin_beacon_r": [], "anim_flicker_crt": [], "marquee_bulbs": []}
PIVOT = {}


def W(lx, lz, yaw):
    """local (x, z) of a piece placed with K.placed(yaw) -> world (x, z) (three.js rotation.y)"""
    t = math.radians(yaw)
    return (lx * math.cos(t) + lz * math.sin(t), -lx * math.sin(t) + lz * math.cos(t))


def atlas_uv(px0, py0, px1, py1, size=1024):
    """pixel rect (top-left origin) -> (u0, v0, u1, v1) in Blender UV space"""
    return (px0 / size, 1 - py1 / size, px1 / size, 1 - py0 / size)


def atlas_uv_r(px0, py0, px1, py1, w=1024, h=256):
    return (px0 / w, 1 - py1 / h, px1 / w, 1 - py0 / h)


def face_toward(ob, dir_g):
    """flip a sheet so its middle polygon faces game direction dir_g"""
    p = ob.data.polygons[len(ob.data.polygons) // 2]
    if p.normal.dot(G(*dir_g)) < 0:
        ob.data.flip_normals()
    return ob


def front_quad(name, x0, x1, y0, y1, z, mat, uv=(0, 0, 1, 1)):
    """vertical quad facing local +Z"""
    u0, v0, u1, v1 = uv
    ob = quad(name, [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], mat, ((u0, v0), (u1, v0), (u1, v1), (u0, v1)))
    if ob.data.polygons[0].normal.y > 0:
        ob.data.flip_normals()
    return ob


def flat_quad(name, x0, x1, z0, z1, y, mat):
    ob = quad(name, [(x0, y, z1), (x1, y, z1), (x1, y, z0), (x0, y, z0)], mat)
    if ob.data.polygons[0].normal.z < 0:
        ob.data.flip_normals()
    return ob


STRIPES = atlas_uv(0, 0, 1023, 127)
BAND = {"green": (0.75, 1.0), "red": (0.5, 0.75), "cream": (0.25, 0.5), "black": (0.0, 0.25)}


def pipe(name, pts, r, band="green", flanges=True, fl_step=2.2):
    """painted pipe (pipe atlas band) + bolted flanges every fl_step along straight runs"""
    v0, v1 = BAND[band]
    tube(name, pts, r, M_PIPE, sides=14 if r > 0.1 else 10, uv_along=(1.2, v0 + 0.01, v1 - 0.01))
    if not flanges:
        return
    for i in range(len(pts) - 1):
        a, b = Vector(pts[i]), Vector(pts[i + 1])
        L = (b - a).length
        d = (b - a).normalized()
        n = int(L / fl_step)
        for k in range(1, n + 1):
            c = a + d * (k * L / (n + 1))
            cyl("%s_fl_%d_%d" % (name, i, k), tuple(c), tuple(d), r * 1.45, 0.07, M_STEEL, sides=16, bevel=0.008)


def valve_wheel(name, c, axis, r=0.22, mat=None):
    mat = mat or M_BRASS
    ax = Vector(axis).normalized()
    up = Vector((0, 1, 0)) if abs(ax.y) < 0.9 else Vector((1, 0, 0))
    e1 = ax.cross(up).normalized()
    e2 = ax.cross(e1).normalized()
    ring = [tuple(Vector(c) + (e1 * math.cos(t) + e2 * math.sin(t)) * r) for t in np.linspace(0, 2 * math.pi, 25)]
    tube(name + "_ring", ring, r * 0.12, mat, sides=6, caps=False)
    for t in (0.0, 2.094, 4.189):
        tube(name + "_spoke%.1f" % t, [tuple(Vector(c)), tuple(Vector(c) + (e1 * math.cos(t) + e2 * math.sin(t)) * r)],
             r * 0.07, mat, sides=5, caps=False)
    cyl(name + "_hub", tuple(Vector(c)), tuple(ax), r * 0.22, r * 0.4, mat, sides=10, bevel=0.005)


def gauge(name, c, normal, r, idx):
    """pressure gauge: brass bezel ring + dial face (sign atlas gauge idx 0..3)"""
    n = Vector(normal).normalized()
    cyl(name + "_body", tuple(Vector(c) - n * 0.03), tuple(n), r, 0.06, M_BRASS, sides=20, bevel=0.008)
    gx, gy = 512 + (idx % 2) * 128, 512 + (idx // 2) * 128
    u0, v0, u1, v1 = atlas_uv(gx, gy, gx + 128, gy + 128)
    bm = bmesh.new()
    up = Vector((0, 1, 0)) if abs(n.y) < 0.9 else Vector((0, 0, -1))
    e1 = up.cross(n).normalized() if abs(n.y) < 0.9 else Vector((1, 0, 0))
    e2 = n.cross(e1).normalized()
    ctr = Vector(c) + n * 0.002
    uvl = bm.loops.layers.uv.new("UVMap")
    vs = []
    for k in range(20):
        t = 2 * math.pi * k / 20
        p = ctr + (e1 * math.cos(t) + e2 * math.sin(t)) * (r * 0.86)
        vs.append((bm.verts.new(G(p.x, p.y, p.z)), ((u0 + u1) / 2 + (u1 - u0) / 2 * 0.94 * math.cos(t),
                                                     (v0 + v1) / 2 + (v1 - v0) / 2 * 0.94 * math.sin(t))))
    f = bm.faces.new([v for v, _ in vs])
    for loop in f.loops:
        loop[uvl].uv = next(uv for v, uv in vs if v == loop.vert)
    ob = K.finish(bm, name + "_face", [M_SIGN], uv=False)
    if ob.data.polygons[0].normal.dot(G(*n)) < 0:
        ob.data.flip_normals()


def beacon_z(name, x, y, zwall):
    """rotating warning beacon on a wall bracket facing local +Z: static plate/arm/base (set), spinning dome (node)"""
    z = zwall + 0.35
    gbox(name + "_plate", x - 0.12, x + 0.12, y - 0.25, y + 0.05, zwall, zwall + 0.02, M_STEEL, tile=0.5, bevel=0.01)
    tube(name + "_arm", [(x, y - 0.12, zwall), (x, y - 0.12, z)], 0.03, M_STEEL, sides=8)
    cyl(name + "_base", (x, y - 0.06, z), (0, 1, 0), 0.13, 0.14, M_STEEL, sides=18, bevel=0.012)
    prof = [(0.115, 0.0), (0.118, 0.12), (0.105, 0.2), (0.07, 0.26), (0.0, 0.28)]
    dome = lathe(name + "_dome", prof, (x, y + 0.01, z), M_BEACON, sides=24, uv_fn=lambda u, L, i: (u * 0.5, 0.125), cap_bot=True)
    # one material for the spinning node: a single primitive = a single three.js Mesh, so the view's anim_spin_* name
    # hook binds ONE object (a 2-material node loads as a Group + 2 child meshes that all match and spin twice)
    cap = cyl(name + "_cap", (x, y + 0.3, z), (0, 1, 0), 0.03, 0.03, M_BEACON, sides=10)
    return [dome, cap], (x, y, z)


# =============================================================== octagon helpers (CONTRACT 35.11: side k normal at 45 k)
def oct_pt(apothem, k_vertex):
    """vertex k (yaw 22.5 + 45 k) of the octagon with the given inscribed radius"""
    a = math.radians(22.5 + 45.0 * k_vertex)
    r = apothem / math.cos(math.radians(22.5))
    return (r * math.sin(a), r * math.cos(a))


def oct_band(name, a0, a1, y, mat, tile=1.6):
    """flat octagonal band between inscribed radii a0 < a1 (a0 = 0 -> full octagon), planar UV / tile"""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    outer = [bm.verts.new(G(oct_pt(a1, k)[0], y, oct_pt(a1, k)[1])) for k in range(8)]
    if a0 <= 1e-6:
        faces = [bm.faces.new(outer)]
    else:
        inner = [bm.verts.new(G(oct_pt(a0, k)[0], y, oct_pt(a0, k)[1])) for k in range(8)]
        faces = [bm.faces.new((inner[k], outer[k], outer[(k + 1) % 8], inner[(k + 1) % 8])) for k in range(8)]
    for f in faces:
        for loop in f.loops:
            co = loop.vert.co
            loop[uvl].uv = (co.x / tile, co.y / tile)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    return K.finish(bm, name, [mat], uv=False, smooth_angle=5)


def oct_wall(name, apothem, y0, y1, mat, inward=True, tile=1.6):
    """8 vertical quads on the octagon with the given inscribed radius, facing the centre (inward) or away"""
    objs = []
    for k in range(8):
        (ax, az), (bx, bz) = oct_pt(apothem, k - 1), oct_pt(apothem, k)
        L = math.hypot(bx - ax, bz - az)
        ob = quad("%s_%d" % (name, k), [(ax, y0, az), (bx, y0, bz), (bx, y1, bz), (ax, y1, az)], mat,
                  ((0, y0 / tile), (L / tile, y0 / tile), (L / tile, y1 / tile), (0, y1 / tile)))
        c = ob.data.polygons[0].center
        radial = Vector((c.x, c.y, 0.0)).normalized()
        if (ob.data.polygons[0].normal.dot(radial) > 0) == inward:
            ob.data.flip_normals()
        objs.append(ob)
    return objs


def oct_path(apothem, y, n_per_side=1):
    """closed polyline along the octagon (vertices), for pipes / cables"""
    pts = []
    for k in range(8):
        (ax, az), (bx, bz) = oct_pt(apothem, k), oct_pt(apothem, k + 1)
        for j in range(n_per_side):
            t = j / n_per_side
            pts.append((ax + (bx - ax) * t, y, az + (bz - az) * t))
    pts.append(pts[0])
    return pts


# =============================================================== BUILD: pit deck, logo, apron, trench, room floor
log("build deck")
TR0, TR1 = 6.2, 7.1                  # trench (inscribed radii)
oct_band("deck", 0.0, APO + 0.15, 0.0, M_DECK, tile=1.6)
gbox("deck_under", -0.1, 0.1, -0.3, -0.29, -0.1, 0.1, M_STEEL, tile=1.0)      # keeps the slab pivot sane (tiny)
oct_band("apron", APO + 0.15, TR0, 0.0, M_DECK, tile=1.6)
oct_band("room_floor", TR1, ROOM_APO + 0.4, 0.0, M_CONC, tile=2.5)
flat_quad("deck_logo", -3.2, 3.2, -3.2, 3.2, 0.006, M_LOGO)
# deck seams: radial from the centre ring to the vertices + an inner octagon, bolted
for k in range(8):
    (x0, z0), (x1, z1) = oct_pt(3.0, k), oct_pt(APO + 0.15, k)
    yaw = math.degrees(math.atan2(x1 - x0, z1 - z0))
    L = math.hypot(x1 - x0, z1 - z0)
    obox("deck_seam_r_%d" % k, ((x0 + x1) / 2, 0.003, (z0 + z1) / 2), (0.024, 0.006, L), M_STEEL, yaw_deg=yaw, tile=0.5)
    (ax, az), (bx, bz) = oct_pt(3.0, k), oct_pt(3.0, k + 1)
    yaw2 = math.degrees(math.atan2(bx - ax, bz - az))
    obox("deck_seam_o_%d" % k, ((ax + bx) / 2, 0.003, (az + bz) / 2), (0.024, 0.006, math.hypot(bx - ax, bz - az)), M_STEEL,
         yaw_deg=yaw2, tile=0.5)
    bolts("deck_bolts_%d" % k, [(x0 + (x1 - x0) * t, 0.006, z0 + (z1 - z0) * t) for t in np.linspace(0.05, 0.95, 5)],
          (0, 1, 0), M_STEEL, r=0.014, h=0.006)
# glowing grated pipe trench all around the ring (the P2 trench, now an octagon)
oct_band("trench_floor", TR0, TR1, -0.58, M_CONC, tile=1.0)
oct_band("trench_glow", TR0 + 0.03, TR1 - 0.03, -0.555, M_GLOW, tile=1.0)
oct_wall("trench_wall_in", TR0, -0.6, 0.0, M_STEEL, inward=False, tile=1.0)
oct_wall("trench_wall_out", TR1, -0.6, 0.0, M_STEEL, inward=True, tile=1.0)
oct_wall("trench_glow_wall", TR0 + 0.012, -0.52, -0.04, M_GLOW, inward=False, tile=1.0)
pipe("trench_pipe_a", oct_path(TR0 + 0.28, -0.36, 1), 0.09, "red", flanges=False)
pipe("trench_pipe_b", oct_path(TR0 + 0.62, -0.4, 1), 0.12, "green", flanges=False)
for k in range(8):
    for t in np.linspace(0.12, 0.88, 4):
        (ax, az), (bx, bz) = oct_pt(TR0, k), oct_pt(TR0, k + 1)
        (cx_, cz_), (dx_, dz_) = oct_pt(TR1, k), oct_pt(TR1, k + 1)
        p0 = (ax + (bx - ax) * t, -0.036, az + (bz - az) * t)
        p1 = (cx_ + (dx_ - cx_) * t, -0.036, cz_ + (dz_ - cz_) * t)
        tube("trench_bearer_%d_%.2f" % (k, t), [p0, p1], 0.022, M_STEEL, sides=4)
gr = oct_band("trench_grate", TR0, TR1, -0.004, M_GRATE, tile=1.0)

# =============================================================== BUILD: the RING boundary (kick panels, posts, rails)
log("build ring boundary")
for k in range(8):
    with K.placed(45.0 * k - 180.0):     # side k: outward normal at yaw 45 k -> local -Z
        hl = SIDE / 2
        gbox("kick_%d" % k, -hl, hl, 0.0, 0.42, -APO - 0.12, -APO, M_PANEL, tile=1.2, bevel=0.01)
        front_quad("kick_stripe_%d" % k, -hl + 0.08, hl - 0.08, 0.27, 0.41, -APO + 0.004, M_SIGN,
                   (0.0, STRIPES[1], (SIDE - 0.16) / 2.0 * STRIPES[2], STRIPES[3]))
        gbox("kick_cap_%d" % k, -hl, hl, 0.42, 0.45, -APO - 0.14, -APO + 0.02, M_STEEL, tile=0.8, bevel=0.006)
        bolts("kick_rivets_%d" % k, [(x, 0.13, -APO) for x in np.linspace(-hl + 0.2, hl - 0.2, 9)], (0, 0, 1), M_STEEL, r=0.013)
        for yy, rr in ((0.60, 0.026), (0.90, 0.03)):
            tube("rail_%d_%.2f" % (k, yy), [(-hl + 0.02, yy, -APO - 0.06), (hl - 0.02, yy, -APO - 0.06)], rr, M_YELLOW, sides=10)
        for x in (-hl * 0.34, hl * 0.34):
            tube("rail_mid_%d_%.2f" % (k, x), [(x, 0.45, -APO - 0.06), (x, 0.9, -APO - 0.06)], 0.022, M_YELLOW, sides=8)
for k in range(8):
    px, pz = oct_pt(APO + 0.02, k)
    cyl("post_%d" % k, (px, 0.44, pz), (0, 1, 0), 0.1, 0.88, M_YELLOW, sides=8, bevel=0.012)
    cyl("post_pad_%d" % k, (px, 0.915, pz), (0, 1, 0), 0.125, 0.1, M_PAD, sides=8, bevel=0.018)
    cyl("post_led_%d" % k, (px, 0.968, pz), (0, 1, 0), 0.05, 0.006, M_GLOW, sides=12)
    cyl("post_foot_%d" % k, (px, 0.012, pz), (0, 1, 0), 0.17, 0.024, M_STEEL, sides=8, bevel=0.006)

# =============================================================== BUILD: north - host dais + desk + CRT video wall (hero)
log("build dais + desk + CRT wall (north)")
SCREEN_TILES = 16


def crt(name, c, w, h, depth, yaw_deg, tile, shell="beige", screen_mat=None):
    """CRT monitor centred at c (screen face centre), facing yaw (0 = +Z): bevelled bezel block, tapered tube housing,
    bulged recessed screen (atlas tile), rubber gasket, control knobs, power LED. Built in local space, then placed."""
    screen_mat = screen_mat or M_SCREEN
    offu = 0.0 if shell == "beige" else 0.5
    d1 = 0.28 * depth
    R = Matrix.Translation(G(*c)) @ Matrix.Rotation(math.radians(yaw_deg), 4, "Z")
    parts = []
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * w, (v.co.y + 0.5) * d1, v.co.z * h))
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(w, h) * 0.07, segments=2, profile=0.6, affect="EDGES",
                    clamp_overlap=True)
    g2 = bmesh.ops.create_cube(bm, size=1.0)
    for v in g2["verts"]:
        back = v.co.y > 0
        sx = 0.55 if back else 0.8
        sz = 0.6 if back else 0.82
        v.co = Vector((v.co.x * w * sx, d1 + (v.co.y + 0.5) * (depth - d1) * 0.98, v.co.z * h * sz - (0.04 * h if back else 0.0)))
    bmesh.ops.bevel(bm, geom=list({e for v in g2["verts"] for e in v.link_edges}), offset=0.02, segments=1,
                    affect="EDGES", clamp_overlap=True)
    me = bpy.data.meshes.new(name + "_shell")
    bm.to_mesh(me)
    bm.free()
    K.box_uv(me, 2.0)
    uvl = me.uv_layers[0]
    for li in range(len(uvl.data)):
        u, v = uvl.data[li].uv
        uvl.data[li].uv = (offu + (u + 0.5) * 0.5, v + 0.5)
    me.transform(R)
    me.materials.append(M_PLASTIC)
    for p in me.polygons:
        p.use_smooth = True
    try:
        me.set_sharp_from_angle(angle=math.radians(40))
    except Exception:
        pass
    ob = bpy.data.objects.new(name + "_shell", me)
    K.COL_SET.objects.link(ob)
    parts.append(ob)
    sw, sh = w * 0.8, h * 0.72
    yc = h * 0.06
    nu, nv = 8, 6
    tu, tv = tile % 4, tile // 4
    u0, u1 = tu * 0.25 + 0.004, (tu + 1) * 0.25 - 0.004
    v1, v0 = 1 - tv * 0.25 - 0.004, 1 - (tv + 1) * 0.25 + 0.004
    bm = bmesh.new()
    uvs = bm.loops.layers.uv.new("UVMap")
    V = []
    for j in range(nv + 1):
        row = []
        for i in range(nu + 1):
            s_, t_ = i / nu * 2 - 1, j / nv * 2 - 1
            bulge = 0.035 * min(w, 1.0) * (1 - 0.55 * s_ * s_) * (1 - 0.55 * t_ * t_)
            row.append(bm.verts.new(Vector((s_ * sw / 2, -0.004 - bulge, yc + t_ * sh / 2))))
        V.append(row)
    for j in range(nv):
        for i in range(nu):
            f = bm.faces.new((V[j][i], V[j][i + 1], V[j + 1][i + 1], V[j + 1][i]))
            for loop, (ii, jj) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                loop[uvs].uv = (u0 + (u1 - u0) * ii / nu, v0 + (v1 - v0) * jj / nv)
    me = bpy.data.meshes.new(name + "_screen")
    bm.to_mesh(me)
    bm.free()
    me.transform(R)
    me.materials.append(screen_mat)
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name + "_screen", me)
    K.COL_SET.objects.link(ob)
    fwd = Matrix.Rotation(math.radians(yaw_deg), 3, "Z") @ Vector((0, -1, 0))
    if ob.data.polygons[len(ob.data.polygons) // 2].normal.dot(fwd) < 0:
        ob.data.flip_normals()
    parts.append(ob)
    bm = bmesh.new()
    for (cx, cz, sx, sz) in ((0, yc + sh / 2 + 0.012, sw + 0.05, 0.022), (0, yc - sh / 2 - 0.012, sw + 0.05, 0.022),
                             (-sw / 2 - 0.012, yc, 0.022, sh + 0.02), (sw / 2 + 0.012, yc, 0.022, sh + 0.02)):
        gg = bmesh.ops.create_cube(bm, size=1.0)
        for v in gg["verts"]:
            v.co = Vector((cx + v.co.x * sx, -0.006 + v.co.y * 0.012, cz + v.co.z * sz))
    me = bpy.data.meshes.new(name + "_gasket")
    bm.to_mesh(me)
    bm.free()
    K.box_uv(me, 1.0)
    me.transform(R)
    me.materials.append(M_RUBBER)
    ob = bpy.data.objects.new(name + "_gasket", me)
    K.COL_SET.objects.link(ob)
    parts.append(ob)
    bm = bmesh.new()
    kz = -h / 2 + (h / 2 - sh / 2 - yc) * 0.5
    for k in range(3):
        gg = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=10, radius1=0.022 * min(1.5, w),
                                   radius2=0.018 * min(1.5, w), depth=0.03)
        bmesh.ops.rotate(bm, verts=gg["verts"], cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(90), 3, "X"))
        bmesh.ops.translate(bm, verts=gg["verts"], vec=Vector((w * 0.18 + k * w * 0.09, -0.015, kz)))
    me = bpy.data.meshes.new(name + "_knobs")
    bm.to_mesh(me)
    bm.free()
    K.box_uv(me, 0.3)
    me.transform(R)
    me.materials.append(M_BRASS)
    ob = bpy.data.objects.new(name + "_knobs", me)
    K.COL_SET.objects.link(ob)
    parts.append(ob)
    led = sphere(name + "_led", (0, 0, 0), 0.01 * min(1.5, w) + 0.004, M_GREEN if tile % 3 else M_RED, seg=6, rings=4)
    led.data.transform(R @ Matrix.Translation(Vector((-w * 0.35, -0.012, kz))))
    parts.append(led)
    return parts


def rack(name, x0, x1, y0, y1, z, rows_y, depth=0.9, yaw_deg=0.0, pivot=None):
    """steel equipment rack: 4 uprights, shelves under each monitor row, back cross braces"""
    objs = []
    for x in (x0, x1):
        for dz in (0.0, -depth):
            objs.append(gbox("%s_up_%.2f_%.2f" % (name, x, dz), x - 0.04, x + 0.04, y0, y1, z + dz - 0.04, z + dz + 0.04,
                             M_STEEL, tile=0.6, bevel=0.006))
    for yy in rows_y:
        objs.append(gbox("%s_shelf_%.2f" % (name, yy), x0 - 0.04, x1 + 0.04, yy - 0.05, yy, z - depth - 0.04, z + 0.04,
                         M_STEEL, tile=0.8, bevel=0.006))
    objs.append(tube(name + "_brace_a", [(x0, y0 + 0.1, z - depth), (x1, y1 - 0.1, z - depth)], 0.018, M_STEEL, sides=6))
    objs.append(tube(name + "_brace_b", [(x1, y0 + 0.1, z - depth), (x0, y1 - 0.1, z - depth)], 0.018, M_STEEL, sides=6))
    if yaw_deg and pivot is not None:
        Rm = (Matrix.Translation(G(*pivot)) @ Matrix.Rotation(math.radians(yaw_deg), 4, "Z") @ Matrix.Translation(-G(*pivot)))
        for o in objs:
            o.data.transform(Rm)
    return objs


DZF, DZB, DH = -10.8, -15.4, 1.2


def desk(R=6.0, CZ=-18.5):
    """curved host desk: lacquered body bowed toward the ring, lit HIT PARADE logo panel, brass edge, desk top, side pods
    with small monitors, gooseneck mic, big red button, dial rack"""
    th = math.radians(21.0)
    y0, y1 = DH, DH + 1.05
    n = 24

    def arc(t, r):
        a = -th + 2 * th * t
        return (r * math.sin(a), CZ + r * math.cos(a))
    face_toward(K.surface("desk_front", n, 1, lambda u, v: (arc(u, R)[0], y1 - (y1 - y0) * v, arc(u, R)[1]), M_LACQ,
                          lambda u, v: (u * 4.5 / 1.2, (1 - v) * 1.05 / 1.2)), (0, 0, 1))
    face_toward(K.surface("desk_back", n, 1, lambda u, v: (arc(1 - u, R - 0.62)[0], y1 - 0.06 - (y1 - 0.06 - y0) * v,
                                                           arc(1 - u, R - 0.62)[1]),
                          M_LACQ, lambda u, v: (u * 4.0 / 1.2, (1 - v))), (0, 0, -1))
    for t, nm, sx in ((0.0, "l", -1), (1.0, "r", 1)):
        xa, za = arc(t, R)
        xb, zb = arc(t, R - 0.62)
        face_toward(quad("desk_end_" + nm, [(xa, y0, za), (xb, y0, zb), (xb, y1, zb), (xa, y1, za)], M_LACQ), (sx, 0, 0))
    u0, v0, u1, v1 = atlas_uv(0, 128, 1023, 383)
    face_toward(K.surface("desk_logo", n, 1, lambda u, v: (arc(0.06 + 0.88 * u, R + 0.012)[0], y0 + 0.95 - 0.8 * v,
                                                           arc(0.06 + 0.88 * u, R + 0.012)[1]), M_SIGNLIT,
                          lambda u, v: (u0 + (u1 - u0) * u, v1 - (v1 - v0) * v)), (0, 0, 1))
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    fr = [bm.verts.new(G(arc(i / n, R + 0.06)[0], y1 + 0.05, arc(i / n, R + 0.06)[1])) for i in range(n + 1)]
    bk = [bm.verts.new(G(arc(i / n, R - 0.7)[0], y1 + 0.05, arc(i / n, R - 0.7)[1])) for i in range(n + 1)]
    frd = [bm.verts.new(G(arc(i / n, R + 0.06)[0], y1, arc(i / n, R + 0.06)[1])) for i in range(n + 1)]
    bkd = [bm.verts.new(G(arc(i / n, R - 0.7)[0], y1, arc(i / n, R - 0.7)[1])) for i in range(n + 1)]
    for i in range(n):
        for vs in ((fr[i], fr[i + 1], bk[i + 1], bk[i]), (frd[i], frd[i + 1], fr[i + 1], fr[i]),
                   (bk[i], bk[i + 1], bkd[i + 1], bkd[i]), (bkd[i], bkd[i + 1], frd[i + 1], frd[i])):
            bm.faces.new(vs)
    for f in bm.faces:
        for loop in f.loops:
            co = loop.vert.co
            loop[uvl].uv = (co.x / 1.2, co.y / 1.2 + co.z)
    bm.faces.new((fr[0], bk[0], bkd[0], frd[0]))
    bm.faces.new((frd[n], bkd[n], bk[n], fr[n]))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    K.finish(bm, "desk_top", [M_PLASTIC], uv=False, smooth_angle=30)
    tube("desk_brass", [(arc(i / n, R + 0.075)[0], y1 + 0.025, arc(i / n, R + 0.075)[1]) for i in range(n + 1)], 0.03,
         M_BRASS, sides=8)
    tube("desk_kick", [(arc(i / n, R + 0.03)[0], y0 + 0.04, arc(i / n, R + 0.03)[1]) for i in range(n + 1)], 0.04,
         M_STEEL, sides=6)
    for s in (-1, 1):
        px, pz = arc(0.5 + s * 0.52, R - 0.3)
        gbox("desk_pod_%d" % s, px - 0.32, px + 0.32, y1 + 0.05, y1 + 0.2, pz - 0.28, pz + 0.28, M_LACQ, tile=0.8, bevel=0.03)
        crt("desk_crt_%d" % s, (px, y1 + 0.43, pz), 0.5, 0.38, 0.42, 180.0 + s * 25.0, 8 if s < 0 else 3, "graphite")
    mx, mz = arc(0.5, R - 0.35)
    cyl("desk_mic_base", (mx + 0.3, y1 + 0.07, mz), (0, 1, 0), 0.08, 0.04, M_STEEL, sides=14, bevel=0.008)
    tube("desk_mic_neck", [(mx + 0.3, y1 + 0.08, mz), (mx + 0.3, y1 + 0.35, mz - 0.02), (mx + 0.28, y1 + 0.5, mz + 0.1),
                           (mx + 0.25, y1 + 0.55, mz + 0.22)], 0.012, M_STEEL, sides=6)
    cyl("desk_mic_head", (mx + 0.25, y1 + 0.555, mz + 0.27), (0, 0.15, 1), 0.035, 0.11, M_RUBBER, sides=12, bevel=0.006)
    cyl("desk_button_base", (mx - 0.35, y1 + 0.075, mz), (0, 1, 0), 0.09, 0.05, M_YELLOW, sides=16, bevel=0.01)
    sphere("desk_button", (mx - 0.35, y1 + 0.1, mz), 0.065, M_RED, seg=14, rings=7, scale=(1.0, 0.55, 1.0))
    for k in range(5):
        cyl("desk_dial_%d" % k, (mx - 0.9 + k * 0.1, y1 + 0.075, mz + 0.05), (0, 1, 0), 0.025, 0.04, M_BRASS, sides=10)


with K.placed(0.0):
    gbox("dais_body", -3.8, 3.8, 0.0, DH - 0.04, DZB, DZF, M_PANEL, tile=2.4)
    gbox("dais_top", -3.84, 3.84, DH - 0.04, DH, DZB, DZF + 0.04, M_DECK, tile=1.0, bevel=0.006, segs=1)
    for k in range(4):
        x0 = -3.8 + 1.9 * k
        front_quad("dais_stripe_%d" % k, x0, x0 + 1.9, DH - 0.17, DH - 0.05, DZF + 0.012, M_SIGN,
                   (0.0, STRIPES[1], 0.95 * STRIPES[2], STRIPES[3]))
    for x in np.arange(-3.6, 3.61, 0.3):
        if abs(x) < 1.45:
            continue
        cyl("dais_socket_%.2f" % x, (x, 0.82, DZF + 0.02), (0, 0, 1), 0.045, 0.04, M_BRASS, sides=10)
        DRESS["marquee_bulbs"].append(sphere("dais_bulb_%.2f" % x, (x, 0.82, DZF + 0.07), 0.05, M_BULB, seg=10, rings=6))
    for s in (-1, 1):       # dais sides (the orbit sees them): bulb rows too
        for z in np.arange(DZF - 0.3, DZB + 0.2, -0.3):
            cyl("dais_socket_s_%d_%.2f" % (s, z), (s * 3.82, 0.82, z), (s, 0, 0), 0.045, 0.04, M_BRASS, sides=10)
            DRESS["marquee_bulbs"].append(sphere("dais_bulb_s_%d_%.2f" % (s, z), (s * 3.87, 0.82, z), 0.05, M_BULB, seg=10, rings=6))
    for k in range(3):      # steps down to the pit (the host walk-down)
        top = 0.3 * (k + 1)
        zfr = DZF + 0.33 * (3 - k)
        gbox("step_%d" % k, -1.35, 1.35, 0.0, top, DZF, zfr, M_STEEL, tile=1.0, bevel=0.01)
        gbox("step_tread_%d" % k, -1.36, 1.36, top - 0.02, top, zfr - 0.33, zfr, M_DECK, tile=1.0, bevel=0.005, segs=1)
        front_quad("step_nose_%d" % k, -1.35, 1.35, top - 0.06, top - 0.005, zfr + 0.012, M_SIGN,
                   (0.0, STRIPES[1], 1.35 * STRIPES[2], STRIPES[3]))
    for s in (-1, 1):
        tube("step_rail_%d" % s, [(s * 1.45, 1.0, DZF + 1.0), (s * 1.45, DH + 1.0, DZF - 0.1), (s * 1.45, DH + 1.0, DZF - 0.9)],
             0.025, M_YELLOW, sides=8)
        for (zz, yb) in ((DZF + 1.0, 0.0), (DZF - 0.1, DH), (DZF - 0.9, DH)):
            tube("step_rail_post_%d_%.1f" % (s, zz), [(s * 1.45, yb, zz), (s * 1.45, yb + 1.0, zz)], 0.025, M_YELLOW, sides=8)
    desk()
    # CRT video wall
    VZ = -16.4
    VW, VH, VD = 1.38, 0.86, 0.9
    COLS, ROWS = 6, 4
    vx0 = -(COLS * (VW + 0.06)) / 2 + (VW + 0.06) / 2
    row_y = [1.62 + r * (VH + 0.08) for r in range(ROWS)]
    rack("vw_rack", vx0 - VW / 2 - 0.08, -vx0 + VW / 2 + 0.08, 0.0, row_y[-1] + VH / 2 + 0.12, VZ - 0.02,
         [y - VH / 2 - 0.01 for y in row_y] + [row_y[-1] + VH / 2 + 0.1], depth=VD + 0.1)
    WALL_TILES = [[0, 3, 10, 9, 11, 15], [6, 1, 14, 5, 13, 7], [8, 2, 1, 14, 3, 12], [4, 9, 13, 10, 0, 8]]
    FLICKER = {(0, 4), (2, 0), (3, 5), (1, 5)}
    for r in range(ROWS):
        for ci in range(COLS):
            x = vx0 + ci * (VW + 0.06)
            t = WALL_TILES[ROWS - 1 - r][ci]
            flick = (r, ci) in FLICKER
            parts = crt("vw_crt_%d_%d" % (r, ci), (x, row_y[r], VZ), VW, VH, VD, 0.0, t,
                        "graphite" if (r + ci) % 3 else "beige", M_SCREEN_F if flick else M_SCREEN)
            if flick:
                DRESS["anim_flicker_crt"].append(parts[1])
    gbox("onair_box", -0.75, 0.75, row_y[-1] + VH / 2 + 0.14, row_y[-1] + VH / 2 + 0.56, VZ - 0.35, VZ - 0.05, M_STEEL,
         tile=0.6, bevel=0.02)
    front_quad("onair_face", -0.7, 0.7, row_y[-1] + VH / 2 + 0.17, row_y[-1] + VH / 2 + 0.53, VZ - 0.045, M_SIGNLIT,
               atlas_uv(0, 384, 255, 511))
    for s in (-1, 1):
        tube("onair_hanger_%d" % s, [(s * 0.6, row_y[-1] + VH / 2 + 0.56, VZ - 0.2), (s * 0.6, CEIL - 0.5, VZ - 0.2)], 0.012,
             M_STEEL, sides=4)
    # angled CRT banks either side of the video wall
    for s in (-1, 1):
        cxb, czb = s * 6.5, -15.0
        yaw = -s * 26.0
        bw, bh, bd = 0.92, 0.64, 0.62
        rows = [3.05, 3.75, 4.45]
        rack("sb_rack_%d" % s, cxb - 1.55, cxb + 1.55, 0.0, rows[-1] + bh / 2 + 0.1, czb, [y - bh / 2 - 0.01 for y in rows] +
             [1.2, 2.0], depth=bd + 0.08, yaw_deg=yaw, pivot=(cxb, 0.0, czb))
        for k, yy in enumerate((0.35, 0.95, 1.6, 2.25)):
            obox("sb_cab_%d_%d" % (s, k), (cxb, yy, czb - 0.05), (3.0, 0.5, 0.1), M_PLASTIC, yaw_deg=yaw, tile=2.0, bevel=0.015)
            for j in range(8):
                lx = cxb - 1.2 + j * 0.34
                rp = Matrix.Rotation(math.radians(yaw), 3, "Y") @ Vector((lx - cxb, 0, 0))
                sphere("sb_led_%d_%d_%d" % (s, k, j), (cxb + rp.x, yy + 0.12, czb - 0.05 + rp.z + 0.06 * math.cos(math.radians(yaw))),
                       0.018, M_GREEN if (j + k) % 3 else M_RED, seg=6, rings=4)
        for r, yy in enumerate(rows):
            for ci in range(3):
                lx = (ci - 1) * (bw + 0.06)
                rp = Matrix.Rotation(math.radians(yaw), 3, "Y") @ Vector((lx, 0, 0))
                t = [7, 11, 13, 3, 6, 4, 12, 15, 9][(r * 3 + ci + (0 if s < 0 else 4)) % 9]
                crt("sb_crt_%d_%d_%d" % (s, r, ci), (cxb + rp.x, yy, czb + rp.z), bw, bh, bd, yaw, t,
                    "beige" if (r + ci + s) % 2 else "graphite")
    # cables from the desk down to the floor + tray over the video wall
    gbox("tray_bottom", -6.0, 6.0, 6.3, 6.33, -17.3, -16.9, M_STEEL, tile=1.0)
    for zz in (-17.3, -16.9):
        gbox("tray_side_%.1f" % zz, -6.0, 6.0, 6.33, 6.45, zz - 0.01, zz + 0.01, M_STEEL, tile=1.0)
    for x in np.arange(-5.5, 5.6, 2.0):
        tube("tray_hanger_%.1f" % x, [(x, 6.45, -17.1), (x, CEIL - 0.5, -17.1)], 0.01, M_STEEL, sides=4)
    for k in range(9):
        tube("tray_cable_%d" % k, [(-6.0, 6.36 + 0.02 * (k % 2), -17.2 + 0.05 * k), (6.0, 6.36 + 0.02 * (k % 2), -17.2 + 0.05 * k)],
             0.022, M_RUBBER, sides=5, caps=False)
    for k, x in enumerate((-3.3, -1.2, 1.0, 3.1)):
        tube("drop_cable_%d" % k, [(x, 6.33, -17.1), (x + 0.1, 5.9, -16.9), (x + 0.2, 5.4, -16.75)], 0.03, M_RUBBER, sides=6)

# =============================================================== BUILD: south - CONTROL booth behind glass
log("build control booth (south)")
with K.placed(180.0):
    BZF, BZB, BHW, BF, BTOP = -11.2, -14.6, 4.0, 1.7, 4.3
    WIN0, WIN1 = 2.05, 3.85
    # undercroft wall with a door, pipes and plates
    gbox("uc_wall", -BHW, BHW, 0.0, WIN0, BZF - 0.2, BZF, M_PANEL, tile=2.4)
    gbox("uc_sill", -BHW - 0.05, BHW + 0.05, WIN0 - 0.06, WIN0 + 0.04, BZF - 0.25, BZF + 0.12, M_STEEL, tile=1.0, bevel=0.01)
    gbox("uc_door_frame", -3.0, -1.8, 0.0, 2.02, BZF, BZF + 0.05, M_STEEL, tile=1.0, bevel=0.01)
    gbox("uc_door", -2.92, -1.88, 0.02, 1.95, BZF + 0.05, BZF + 0.07, M_PANEL, tile=1.2, bevel=0.01)
    tube("uc_door_bar", [(-2.8, 1.0, BZF + 0.1), (-2.0, 1.0, BZF + 0.1)], 0.016, M_BRASS, sides=6)
    front_quad("uc_quiet", 0.6, 2.4, 1.2, 1.64, BZF + 0.01, M_SIGN2, atlas_uv_r(512, 128, 1023, 255))
    front_quad("uc_rules", -1.5, -0.2, 1.2, 1.52, BZF + 0.01, M_SIGN2, atlas_uv_r(0, 128, 511, 255))
    for yy, band_, r_ in ((0.32, "red", 0.07), (0.52, "cream", 0.06)):
        pipe("uc_pipe_%.2f" % yy, [(-BHW, yy, BZF + 0.12), (BHW, yy, BZF + 0.12)], r_, band_, fl_step=2.6)
    K.template("meter3", K.JPM + "Props/JP_Electric_Meter_03.fbx", mat=M_METERS)
    K.inst("meter3", "uc_meter", (3.3, 0.7, BZF + 0.02), 0.0, 1.1, pivot="bottom")
    # booth shell
    gbox("booth_floor", -BHW, BHW, BF - 0.15, BF, BZB, BZF, M_STEEL, tile=1.2)
    for s in (-1, 1):
        gbox("booth_side_%d" % s, s * BHW - 0.12, s * BHW + 0.12, 0.0, BTOP, BZB, BZF, M_PANEL, tile=2.4)
    gbox("booth_back", -BHW, BHW, BF, BTOP, BZB - 0.15, BZB, M_ROOMLIT, tile=2.0)
    gbox("booth_roof", -BHW - 0.15, BHW + 0.15, BTOP, BTOP + 0.18, BZB - 0.15, BZF + 0.1, M_PANEL, tile=2.4, bevel=0.02)
    gbox("booth_head", -BHW, BHW, WIN1, BTOP, BZF - 0.2, BZF, M_PANEL, tile=2.4)
    # window: glass + mullions
    front_quad("booth_window", -BHW + 0.02, BHW - 0.02, WIN0, WIN1, BZF - 0.1, M_WINDOW)
    for x in np.linspace(-BHW + 0.06, BHW - 0.06, 6):
        gbox("booth_mullion_%.2f" % x, x - 0.04, x + 0.04, WIN0, WIN1, BZF - 0.14, BZF - 0.04, M_STEEL, tile=0.6, bevel=0.006)
    gbox("booth_transom", -BHW, BHW, WIN1 - 0.05, WIN1, BZF - 0.14, BZF - 0.04, M_STEEL, tile=0.6)
    # console along the window inside + small monitors + button fields
    gbox("console_body", -3.5, 3.5, BF, BF + 0.72, BZF - 0.85, BZF - 0.25, M_PLASTIC, tile=1.2, bevel=0.02)
    obox("console_top", (0.0, BF + 0.78, BZF - 0.55), (7.0, 0.06, 0.66), M_LACQ, pitch_deg=-12.0, tile=1.0, bevel=0.01)
    rng = K.mulberry32(8080)
    for k in range(60):
        x = -3.3 + 6.6 * rng()
        z = BZF - 0.35 - 0.4 * rng()
        mat = M_GREEN if rng() < 0.55 else (M_RED if rng() < 0.5 else M_BULB)
        gbox("console_btn_%d" % k, x - 0.02, x + 0.02, BF + 0.8 + (BZF - 0.55 - z) * 0.2, BF + 0.83 + (BZF - 0.55 - z) * 0.2,
             z - 0.02, z + 0.02, mat, tile=0.2)
    for k, x in enumerate((-2.4, 0.0, 2.4)):
        crt("booth_crt_%d" % k, (x, BF + 1.12, BZF - 0.7), 0.56, 0.42, 0.45, 0.0, [1, 3, 13][k], "graphite")
    # CONTROL sign + ON AIR light over the window
    gbox("control_sign_box", -1.35, 1.35, BTOP + 0.2, BTOP + 0.72, BZF - 0.05, BZF + 0.12, M_STEEL, tile=0.6, bevel=0.02)
    front_quad("control_sign", -1.3, 1.3, BTOP + 0.23, BTOP + 0.69, BZF + 0.125, M_SIGN2, atlas_uv_r(0, 0, 511, 127))
    gbox("booth_onair_box", 2.2, 3.4, BTOP + 0.28, BTOP + 0.64, BZF - 0.05, BZF + 0.1, M_STEEL, tile=0.6, bevel=0.015)
    front_quad("booth_onair", 2.25, 3.35, BTOP + 0.31, BTOP + 0.61, BZF + 0.105, M_SIGNLIT, atlas_uv(0, 384, 255, 511))
    # ceiling strip light inside the booth (the crew reads against a lit room)
    gbox("booth_strip", -3.4, 3.4, BTOP - 0.08, BTOP - 0.02, BZF - 1.6, BZF - 1.4, M_BULB, tile=1.0)

# =============================================================== BUILD: east - boiler + manifold + beacon
log("build boiler + manifold (east)")


def boiler(cx, cz, r=1.45):
    gbox("boiler_plinth", cx - 1.9, cx + 1.9, -0.06, 0.35, cz - 1.9, cz + 1.9, M_CONC, tile=1.2, bevel=0.03)
    prof = [(r, 0.35), (r, 4.0), (r * 0.92, 4.45), (r * 0.68, 4.8), (r * 0.32, 5.0), (0.0, 5.04)]
    lathe("boiler_shell", prof, (cx, 0.0, cz), M_PANEL, sides=40, tile_u=2.4, tile_v=2.4)
    for yy in (0.62, 1.7, 2.8, 3.85):
        ring = [(cx + (r + 0.02) * math.cos(a), yy, cz + (r + 0.02) * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 41)]
        tube("boiler_band_%.2f" % yy, ring, 0.045, M_STEEL, sides=6, caps=False)
        bolts("boiler_rivets_%.2f" % yy, [(cx + (r + 0.05) * math.cos(a), yy + 0.07, cz + (r + 0.05) * math.sin(a))
                                          for a in np.linspace(0, 2 * math.pi, 37)[:-1]], (0, 1, 0), M_STEEL, r=0.018, h=0.01)
    fz = cz + r + 0.01
    # CHANGED(fix_ui_stage) (verifier D5): the firebox door sits LOW on the plinth (a real firebox is at the base) - glow
    # 0.47-0.93 m, well under the orbit camera's 1.35 m eye, so from any camera inside the clear radius it lands below the
    # fighters' heads (it was 0.68-1.42 m = on the horizon line = behind the heads), and it glows with M_FIRE (2.0)
    gbox("boiler_door_frame", cx - 0.62, cx + 0.62, 0.38, 1.02, fz - 0.05, fz + 0.1, M_STEEL, tile=0.6, bevel=0.03)
    gbox("boiler_door_glow", cx - 0.5, cx + 0.5, 0.47, 0.93, fz + 0.1, fz + 0.11, M_FIRE, tile=0.6)
    for k in range(8):
        x = cx - 0.44 + k * 0.126
        gbox("boiler_door_bar_%d" % k, x - 0.022, x + 0.022, 0.45, 0.95, fz + 0.1, fz + 0.16, M_STEEL, tile=0.3, bevel=0.006)
    for yy in (0.5, 0.9):
        cyl("boiler_door_hinge_%.2f" % yy, (cx - 0.66, yy, fz + 0.08), (0, 1, 0), 0.04, 0.16, M_STEEL, sides=10)
    tube("boiler_door_latch", [(cx + 0.58, 0.7, fz + 0.16), (cx + 0.8, 0.7, fz + 0.2)], 0.022, M_BRASS, sides=6)
    for k, (gx, gy) in enumerate(((cx - 0.55, 2.35), (cx, 2.5), (cx + 0.55, 2.35))):
        tube("boiler_gstem_%d" % k, [(gx, gy, fz - 0.02), (gx, gy, fz + 0.2)], 0.018, M_BRASS, sides=6)
        gauge("boiler_gauge_%d" % k, (gx, gy, fz + 0.24), (0, 0, 1), 0.16, k + 1)
    tube("boiler_sight", [(cx + 1.0, 1.9, cz + r * 0.72), (cx + 1.0, 3.1, cz + r * 0.72)], 0.03, M_GLASS, sides=10)
    for yy in (1.9, 3.1):
        cyl("boiler_sight_fit_%.1f" % yy, (cx + 1.0, yy, cz + r * 0.72), (0, 1, 0), 0.05, 0.08, M_BRASS, sides=10)
    pipe("boiler_flue", [(cx, 4.95, cz), (cx, 6.9, cz), (cx + 0.4, 7.3, cz)], 0.26, "black", fl_step=1.2)
    pipe("boiler_steam", [(cx + 0.9, 4.2, cz - 0.4), (cx + 0.9, 5.4, cz - 0.4), (cx + 3.2, 5.4, cz - 0.4), (cx + 3.2, 7.4, cz - 0.4)],
         0.12, "red", fl_step=1.4)
    lathe("boiler_safety", [(0.07, 0.0), (0.07, 0.25), (0.12, 0.3), (0.12, 0.42), (0.04, 0.5)], (cx - 0.7, 4.72, cz + 0.3), M_BRASS,
          sides=12, tile_u=0.3, tile_v=0.3)
    valve_wheel("boiler_valve", (cx + 1.15, 1.2, cz + 1.0), (0.7, 0.0, 0.7), 0.26)
    lx = cx - r - 0.2
    for dz in (-0.25, 0.25):
        tube("boiler_ladder_rail_%.2f" % dz, [(lx, 0.35, cz + dz), (lx, 5.2, cz + dz)], 0.02, M_STEEL, sides=6)
    for k in range(15):
        yy = 0.6 + k * 0.3
        tube("boiler_rung_%d" % k, [(lx, yy, cz - 0.25), (lx, yy, cz + 0.25)], 0.013, M_STEEL, sides=5, caps=False)


def h_column(name, x, z, y0=0.0, y1=CEIL):
    gbox(name + "_web", x - 0.02, x + 0.02, y0, y1, z - 0.14, z + 0.14, M_STEEL, tile=1.0)
    gbox(name + "_fl1", x - 0.15, x + 0.15, y0, y1, z - 0.15, z - 0.13, M_STEEL, tile=1.0)
    gbox(name + "_fl2", x - 0.15, x + 0.15, y0, y1, z + 0.13, z + 0.15, M_STEEL, tile=1.0)
    gbox(name + "_base", x - 0.26, x + 0.26, 0.0, 0.03, z - 0.26, z + 0.26, M_STEEL, tile=0.5, bevel=0.005)


YAW_E = -90.0
with K.placed(YAW_E):
    boiler(0.0, -13.0)
    MX, MZ = 3.4, -14.0
    for k, (dx, r, band_) in enumerate(((-1.1, 0.14, "green"), (-0.45, 0.1, "red"), (0.2, 0.18, "cream"), (0.95, 0.12, "black"))):
        pipe("mf_v_%d" % k, [(MX + dx, 0.0, MZ), (MX + dx, CEIL, MZ)], r, band_, fl_step=1.8)
        valve_wheel("mf_valve_%d" % k, (MX + dx, 1.35 + 0.25 * k, MZ + r + 0.2), (0, 0, 1), 0.2 + 0.03 * (k % 2))
        cyl("mf_valve_body_%d" % k, (MX + dx, 1.35 + 0.25 * k, MZ + r * 0.5), (0, 0, 1), r * 1.2, 0.3, M_BRASS, sides=12, bevel=0.01)
    pipe("mf_header", [(MX - 1.6, 2.6, MZ + 0.05), (MX + 1.5, 2.6, MZ + 0.05)], 0.16, "green", fl_step=1.0)
    for k in range(3):
        gauge("mf_gauge_%d" % k, (MX - 0.9 + k * 0.8, 3.35, MZ + 0.32), (0, 0, 1), 0.14, (k + 2) % 4)
        tube("mf_gstem_%d" % k, [(MX - 0.9 + k * 0.8, 2.6, MZ + 0.1), (MX - 0.9 + k * 0.8, 3.35, MZ + 0.1),
                                 (MX - 0.9 + k * 0.8, 3.35, MZ + 0.26)], 0.016, M_BRASS, sides=6)
    HX, HZ = -3.4, -13.6
    lathe("hw_tank", [(0.95, 0.0), (0.95, 2.7), (0.85, 3.0), (0.4, 3.18), (0.0, 3.2)], (HX, -0.06, HZ), M_PIPE, sides=32,
          uv_fn=lambda u, L, i: (u * 5.0, 0.26 + 0.2 * min(1.0, L / 3.2)))
    for yy in (0.4, 1.4, 2.4):
        tube("hw_band_%.1f" % yy, [(HX + 0.97 * math.cos(a), yy, HZ + 0.97 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 33)],
             0.03, M_STEEL, sides=6, caps=False)
    pipe("hw_link", [(HX, 3.14, HZ), (HX, 5.4, HZ), (-0.9, 5.4, HZ + 0.6)], 0.08, "cream", flanges=False)
    front_quad("boiler_danger", -2.0, -0.9, 1.9, 2.45, -11.9, M_SIGN, atlas_uv(0, 512, 511, 767))
    h_column("col_e_l", -2.1, -11.6)
    h_column("col_e_r", 2.1, -11.6)
    parts, bpos = beacon_z("beacon_r", 2.1, 3.05, -11.45)
    DRESS["anim_spin_beacon_r"] += parts
    PIVOT["beacon_r"] = bpos
    gbox("boiler_floorplate", -4.8, 5.2, 0.0, 0.02, -16.0, -10.9, M_DECK, tile=1.0)
bx, bz = W(PIVOT["beacon_r"][0], PIVOT["beacon_r"][2], YAW_E)
PIVOT["beacon_r"] = (bx, PIVOT["beacon_r"][1], bz)

# =============================================================== BUILD: west - blast-door wall + observation window
log("build blast door + observation (west)")
YAW_W = 90.0
with K.placed(YAW_W):
    WZ, WHW = -11.6, 4.4
    gbox("ww_wall_low", -WHW, WHW, 0.0, 3.95, WZ - 0.4, WZ, M_BRICK, tile=1.6)
    gbox("ww_wall_hi", -WHW, WHW, 5.7, CEIL, WZ - 0.4, WZ, M_BRICK, tile=1.6)
    for s in (-1, 1):
        gbox("ww_wall_jamb_%d" % s, s * 3.2, s * WHW, 3.95, 5.7, WZ - 0.4, WZ, M_BRICK, tile=1.6)
    gbox("ww_kick", -WHW, WHW, 0.02, 0.3, WZ, WZ + 0.01, M_SIGN, tile=1.0)
    # blast door (riveted leaf in a heavy frame), valve wheel, hinges, warning plates
    DX0, DX1, DY1 = -0.9, 0.9, 2.3
    for (a0, a1, b0, b1) in ((DX0 - 0.18, DX0, 0.0, DY1 + 0.18), (DX1, DX1 + 0.18, 0.0, DY1 + 0.18),
                             (DX0 - 0.18, DX1 + 0.18, DY1, DY1 + 0.18)):
        gbox("bd_frame_%.2f_%.2f" % (a0, b0), a0, a1, b0, b1, WZ, WZ + 0.14, M_STEEL, tile=0.8, bevel=0.03)
    bolts("bd_frame_rivets", [(x, y, WZ + 0.14) for y in np.arange(0.15, DY1 + 0.1, 0.25) for x in (DX0 - 0.09, DX1 + 0.09)] +
          [(x, DY1 + 0.09, WZ + 0.14) for x in np.arange(DX0 - 0.05, DX1 + 0.06, 0.25)], (0, 0, 1), M_STEEL, r=0.016)
    gbox("bd_leaf", DX0 + 0.03, DX1 - 0.03, 0.06, DY1 - 0.04, WZ + 0.03, WZ + 0.1, M_PANEL, tile=1.6, bevel=0.07, segs=3)
    for (yy, xx) in ((0.35, DX0 + 0.03), (DY1 - 0.35, DX0 + 0.03), (0.35, DX1 - 0.03), (DY1 - 0.35, DX1 - 0.03)):
        obox("bd_dog_%.2f_%.2f" % (yy, xx), (xx, yy, WZ + 0.14), (0.26, 0.05, 0.05), M_STEEL, tile=0.3, bevel=0.01)
    valve_wheel("bd_wheel", (0.0, 1.25, WZ + 0.22), (0, 0, 1), 0.3, M_BRASS)
    for yy in (0.45, DY1 - 0.45):
        cyl("bd_hinge_%.2f" % yy, (DX0 - 0.02, yy, WZ + 0.1), (0, 1, 0), 0.05, 0.28, M_STEEL, sides=12, bevel=0.008)
    front_quad("bd_warn", 1.3, 2.5, 1.45, 2.05, WZ + 0.01, M_SIGN, atlas_uv(0, 512, 511, 767))
    front_quad("bd_standby", -2.4, -1.8, 2.55, 2.85, WZ + 0.01, M_SIGNLIT, atlas_uv(256, 384, 511, 511))
    front_quad("bd_stencil", -2.9, -1.4, 1.2, 1.65, WZ + 0.01, M_SIGN, atlas_uv(512, 384, 1023, 511))
    gbox("bd_breaker", 2.9, 3.8, 0.9, 2.2, WZ, WZ + 0.18, M_STEEL, tile=0.6, bevel=0.015)
    front_quad("bd_breaker_face", 2.98, 3.72, 1.0, 2.1, WZ + 0.185, M_SIGN, atlas_uv(768, 512, 1023, 767))
    gauge("ww_gauge", (-3.4, 1.75, WZ + 0.14), (0, 0, 1), 0.13, 0)
    for yy, band_, r_ in ((3.25, "green", 0.12), (3.62, "red", 0.08)):
        pipe("ww_pipe_%.2f" % yy, [(-WHW, yy, WZ + 0.18), (WHW, yy, WZ + 0.18)], r_, band_, fl_step=2.0)
    # observation window + gallery behind it (staff silhouettes = crowd bay "observation")
    OY0, OY1 = 3.95, 5.7
    front_quad("obs_window", -3.2, 3.2, OY0, OY1, WZ - 0.12, M_WINDOW)
    for x in (-1.6, 0.0, 1.6):
        gbox("obs_mullion_%.1f" % x, x - 0.04, x + 0.04, OY0, OY1, WZ - 0.16, WZ - 0.06, M_STEEL, tile=0.6)
    gbox("obs_sill", -3.3, 3.3, OY0 - 0.08, OY0, WZ - 0.4, WZ + 0.12, M_STEEL, tile=0.8, bevel=0.01)
    gbox("obs_floor", -3.2, 3.2, 3.45, 3.6, WZ - 3.0, WZ - 0.4, M_STEEL, tile=1.2)
    gbox("obs_back", -3.2, 3.2, 3.6, CEIL, WZ - 3.1, WZ - 3.0, M_ROOMLIT, tile=2.0)
    for s in (-1, 1):
        gbox("obs_side_%d" % s, s * 3.2 - 0.1 * (s > 0), s * 3.2 + 0.1 * (s < 0), 3.45, CEIL, WZ - 3.1, WZ - 0.4, M_PANEL, tile=2.4)
    gbox("obs_rail", -3.1, 3.1, 4.55, 4.6, WZ - 0.6, WZ - 0.55, M_YELLOW, tile=0.8)
    gbox("obs_strip", -3.0, 3.0, CEIL - 0.3, CEIL - 0.25, WZ - 1.4, WZ - 1.2, M_BULB, tile=1.0)
    gbox("obs_sign_box", -1.6, 1.6, 5.82, 6.3, WZ - 0.05, WZ + 0.1, M_STEEL, tile=0.6, bevel=0.02)
    front_quad("obs_sign", -1.55, 1.55, 5.85, 6.27, WZ + 0.105, M_SIGN2, atlas_uv_r(512, 0, 1023, 127))
    parts, bpos = beacon_z("beacon_l", -3.75, 3.05, WZ)
    DRESS["anim_spin_beacon_l"] += parts
    PIVOT["beacon_l"] = bpos
    for (x, s) in ((3.9, 1),):
        cyl("cage_base_w", (x, 2.75, WZ + 0.03), (0, 0, 1), 0.08, 0.06, M_STEEL, sides=14, bevel=0.006)
        sphere("cage_bulb_w", (x, 2.75, WZ + 0.12), 0.065, M_BULB, seg=10, rings=7)
bx, bz = W(PIVOT["beacon_l"][0], PIVOT["beacon_l"][2], YAW_W)
PIVOT["beacon_l"] = (bx, PIVOT["beacon_l"][1], bz)
log("beacon pivots", PIVOT)

# =============================================================== BUILD: crowd risers on the diagonals
log("build risers (diagonals)")


def risers(tag):
    xa, xb = -4.2, 4.2
    TI = []
    for k in range(3):
        y = 0.3 * (k + 1)
        zf = -10.0 - 0.85 * k
        TI.append((y, zf))
        gbox("%s_tread_%d" % (tag, k), xa, xb, y - 0.05, y, zf - 0.85, zf, M_DECK, tile=1.0, bevel=0.006, segs=1)
        gbox("%s_face_%d" % (tag, k), xa, xb, y - 0.3, y - 0.05, zf - 0.02, zf, M_STEEL, tile=1.2)
        for j in range(int(math.ceil((xb - xa) / 2.0))):
            x0 = xa + 2.0 * j
            x1 = min(xb, x0 + 2.0)
            front_quad("%s_nose_%d_%d" % (tag, k, j), x0, x1, y - 0.045, y - 0.005, zf + 0.012, M_SIGN,
                       (0.0, STRIPES[1], (x1 - x0) / 2.0 * STRIPES[2], STRIPES[3]))
        for x in np.arange(xa + 0.1, xb, 2.4):
            gbox("%s_leg_%d_%.1f" % (tag, k, x), x - 0.03, x + 0.03, 0.0, y - 0.05, zf - 0.45, zf - 0.39, M_STEEL, tile=0.4)
    zback = -10.0 - 0.85 * 3
    gbox("%s_back" % tag, xa, xb, 0.0, 0.9, zback - 0.02, zback, M_STEEL, tile=1.2)
    for s in (-1, 1):
        pts = [(s * xb, 0.0, zback)]
        for k in range(2, -1, -1):
            y, zf = TI[k]
            pts += [(s * xb, y, zf - 0.85), (s * xb, y, zf)]
        pts.append((s * xb, 0.0, -10.0))
        bm = bmesh.new()
        uvl = bm.loops.layers.uv.new("UVMap")
        f = bm.faces.new([bm.verts.new(G(*p)) for p in pts])
        for loop in f.loops:
            co = loop.vert.co
            loop[uvl].uv = (-co.y / 1.2, co.z / 1.2)
        ob = K.finish(bm, "%s_side_%d" % (tag, s), [M_STEEL], uv=False)
        if (ob.data.polygons[0].normal.x > 0) != (s > 0):
            ob.data.flip_normals()
    for yy in (1.45, 1.9):
        tube("%s_rail_%.2f" % (tag, yy), [(xa, yy, zback - 0.05), (xb, yy, zback - 0.05)], 0.024, M_YELLOW, sides=8)
    for x in np.arange(xa, xb + 0.01, 2.1):
        tube("%s_rpost_%.1f" % (tag, x), [(x, 0.9, zback - 0.05), (x, 1.9, zback - 0.05)], 0.024, M_YELLOW, sides=8)
    for s in (-1, 1):
        tube("%s_end_rail_%d" % (tag, s), [(s * (xb - 0.05), 1.05, -10.1), (s * (xb - 0.05), 1.95, zback - 0.05)], 0.024,
             M_YELLOW, sides=8)
    # caged lamp hanging over each bank
    for x in (-2.0, 2.0):
        tube("%s_lamp_cord_%.0f" % (tag, x), [(x, CEIL - 0.5, -11.4), (x, 6.55, -11.4)], 0.008, M_RUBBER, sides=4)
        lathe("%s_lamp_shade_%.0f" % (tag, x), [(0.05, 0.0), (0.08, -0.05), (0.26, -0.22), (0.27, -0.25)], (x, 6.55, -11.4),
              M_STEEL, sides=18, tile_u=0.5, tile_v=0.5, cap_top=False, cap_bot=False)
        sphere("%s_lamp_bulb_%.0f" % (tag, x), (x, 6.35, -11.4), 0.07, M_BULB, seg=10, rings=6)


for a in (45.0, 135.0, 225.0, 315.0):
    with K.placed(a - 180.0):
        risers("rs_%d" % int(a))

# =============================================================== BUILD: octagonal room shell, ceiling, beams, pipes, rig
log("build room shell + overhead")
oct_wall("room_wall", ROOM_APO, 0.0, CEIL, M_BRICK, inward=True, tile=1.6)
oct_band("ceiling", 0.0, ROOM_APO + 0.4, CEIL, M_CONC, tile=3.0)
for ob in list(K.COL_SET.objects):
    if ob.name == "ceiling":
        ob.data.flip_normals()          # the ceiling faces down
# radial I-beams through the centre + an octagonal ring beam
for k in range(4):
    yaw = 22.5 + 45.0 * k
    L = 2 * ROOM_APO / math.cos(math.radians(22.5))
    obox("beam_web_%d" % k, (0.0, 7.55, 0.0), (0.04, 0.5, L), M_STEEL, yaw_deg=yaw, tile=1.2)
    obox("beam_fl_%d" % k, (0.0, 7.3, 0.0), (0.28, 0.04, L), M_STEEL, yaw_deg=yaw, tile=1.2)
for k in range(8):
    (ax, az), (bx_, bz_) = oct_pt(11.0, k), oct_pt(11.0, k + 1)
    yaw = math.degrees(math.atan2(bx_ - ax, bz_ - az))
    obox("ringbeam_%d" % k, ((ax + bx_) / 2, 7.55, (az + bz_) / 2), (0.04, 0.5, math.hypot(bx_ - ax, bz_ - az)), M_STEEL,
         yaw_deg=yaw, tile=1.2)
    obox("ringbeam_fl_%d" % k, ((ax + bx_) / 2, 7.3, (az + bz_) / 2), (0.28, 0.04, math.hypot(bx_ - ax, bz_ - az)), M_STEEL,
         yaw_deg=yaw, tile=1.2)
# painted pipes crossing the room under the ceiling
for k, (yaw, off, r, band_, yy) in enumerate(((0.0, -5.2, 0.2, "green", 6.95), (0.0, 3.6, 0.16, "cream", 6.85),
                                               (90.0, -3.1, 0.12, "red", 6.75), (90.0, 5.9, 0.1, "black", 6.65))):
    L = ROOM_APO - 0.3
    ux, uz = K.ydir(yaw)
    px, pz = uz, -ux
    pipe("ceil_pipe_%d" % k, [(px * off - ux * L, yy, pz * off - uz * L), (px * off + ux * L, yy, pz * off + uz * L)], r, band_,
         fl_step=3.0)
# the octagonal light rig above the ring: two tube rings + zig-zag, hung from the ceiling, 8 cans aimed at the ring
RIG_A, RIG_Y = 4.2, 6.1
tube("rig_ring_top", oct_path(RIG_A, RIG_Y + 0.3, 1), 0.035, M_STEEL, sides=8, caps=False)
tube("rig_ring_bot", oct_path(RIG_A, RIG_Y, 1), 0.035, M_STEEL, sides=8, caps=False)
zz = []
for k in range(8):
    (ax, az), (bx_, bz_) = oct_pt(RIG_A, k), oct_pt(RIG_A, k + 1)
    for j in range(6):
        t = j / 6
        zz.append((ax + (bx_ - ax) * t, RIG_Y + (0.3 if j % 2 else 0.0), az + (bz_ - az) * t))
zz.append(zz[0])
tube("rig_zig", zz, 0.018, M_STEEL, sides=5, caps=False)
for k in range(8):
    vx, vz = oct_pt(RIG_A, k)
    tube("rig_hanger_%d" % k, [(vx, RIG_Y + 0.3, vz), (vx, CEIL - 0.5, vz)], 0.012, M_STEEL, sides=4)
    a = math.radians(45.0 * k)
    cx_, cz_ = (RIG_A - 0.05) * math.sin(a), (RIG_A - 0.05) * math.cos(a)
    tgt = Vector((-0.4 * math.sin(a), 0.0, -0.4 * math.cos(a)))
    d = (tgt - Vector((cx_, RIG_Y - 0.25, cz_))).normalized()
    cyl("rig_can_%d" % k, (cx_, RIG_Y - 0.25, cz_), tuple(d), 0.14, 0.4, M_STEEL, sides=14, bevel=0.012, r2=0.16)
    lens = Vector((cx_, RIG_Y - 0.25, cz_)) + d * 0.205
    cyl("rig_lens_%d" % k, tuple(lens), tuple(d), 0.14, 0.01, M_BULB, sides=14)
    tube("rig_yoke_%d" % k, [(cx_, RIG_Y, cz_), (cx_, RIG_Y - 0.2, cz_)], 0.015, M_STEEL, sides=5)
# caged lamps hanging around the room (outside the rig)
for (x, z) in ((0.0, -13.0), (0.0, 13.2), (-13.4, 0.0), (13.4, 0.0)):
    tube("lamp_cord_%.0f_%.0f" % (x, z), [(x, CEIL - 0.5, z), (x, 6.55, z)], 0.008, M_RUBBER, sides=4)
    lathe("lamp_shade_%.0f_%.0f" % (x, z), [(0.05, 0.0), (0.08, -0.05), (0.26, -0.22), (0.27, -0.25)], (x, 6.55, z), M_STEEL,
          sides=18, tile_u=0.5, tile_v=0.5, cap_top=False, cap_bot=False)
    sphere("lamp_bulb_%.0f_%.0f" % (x, z), (x, 6.35, z), 0.07, M_BULB, seg=10, rings=6)
# room walls: fuse panels + pipes on the far walls (between the set pieces)
for k in range(8):
    a = 45.0 * k + 22.5          # wall behind each diagonal / cardinal gap
    with K.placed(a - 180.0 + 0.0):
        if k % 2 == 0:
            for j, x in enumerate((-2.0, 2.0)):
                K.inst("meter3", "rw_meter_%d_%d" % (k, j), (x, 1.3, -ROOM_APO + 0.03), 0.0, 1.3, pivot="bottom")
        pipe("rw_pipe_%d" % k, [(-7.4, 5.4, -ROOM_APO + 0.25), (7.4, 5.4, -ROOM_APO + 0.25)], 0.16, "green", fl_step=3.0)

# =============================================================== BUILD: cable trunks on the floor (outside the trench)
log("build cables")


def cable_bundle(name, path, n=5, r=0.034, seed=1):
    rng_ = K.mulberry32(seed)
    for k in range(n):
        off = (rng_() - 0.5) * 0.18
        pts = []
        for i, (x, y, z) in enumerate(path):
            wob = 0.03 * math.sin(i * 1.7 + k)
            pts.append((x + off * 0.3 + wob, max(r * 0.9, y + r * (k % 2)), z + off))
        tube("%s_%d" % (name, k), pts, r * (0.8 + 0.4 * rng_()), M_RUBBER, sides=6)


cable_bundle("cab_n", [(-3.9, 0.0, -11.6), (-4.6, 0.0, -9.6), (-5.9, 0.0, -8.0), (-7.6, 0.0, -6.2), (-8.1, 0.0, -3.0),
                       (-8.0, 0.0, 0.0), (-7.9, 0.0, 3.4)], seed=11)
cable_bundle("cab_s", [(3.6, 0.0, 11.4), (4.6, 0.0, 9.4), (6.4, 0.0, 7.6), (7.8, 0.0, 5.4), (8.1, 0.0, 2.2)], seed=12)
cable_bundle("cab_desk", [(0.4, DH, -12.9), (1.9, DH, -13.6), (3.2, DH, -14.2), (3.75, DH - 0.2, -14.4), (3.9, 0.2, -14.5),
                          (4.2, 0.0, -14.7)], n=3, r=0.028, seed=13)

# =============================================================== crowd nodes + clearance
K.crowd_nodes()
clear_r, offenders, low_top = K.clearance(CLEAR_R, 1.15, 4.5)
S["camera"]["clearRadiusM"] = math.floor(clear_r * 100.0) / 100.0
S["build"] = {"clearance": K.clearance_record(clear_r, offenders, low_top, CLEAR_R, 1.15, 4.5, K.LAST_NEAREST)}
S["ring"]["measuredLowTopM"] = round(low_top, 3)
if offenders:
    log("CLEARANCE FAIL: %d objects inside %.1f m in the camera band" % (len(offenders), CLEAR_R))

# =============================================================== contact render (ENV_KIT 8.3) or main
if K.DO_CONTACT:
    keep = [o for o in K.COL_SET.objects if o.name.startswith(("vw_crt_3_2", "boiler_", "desk_", "kick_0", "post_0", "rail_0_"))]
    for o in list(K.COL_SET.objects):
        if o not in keep:
            o.hide_render = True
    K.contact_render(keep, "control_room_contact.png", HDRI, span=16.0, cam_pos=[0.0, 4.0, 22.0], look=[0.0, 1.7, 0.0], fov=60.0)
else:
    if K.DO_EXPORT or not os.path.exists(os.path.join(K.OUT3D, S["environment"]["hdr"])):
        K.env_map(HDRI, "control_room_env.hdr")
    if K.DO_RENDER:
        K.render_proofs([
            {"id": "overview", "pos": [12.0, 6.6, 13.0], "look": [0.0, 1.2, 0.0], "fov": 62.0},
            {"id": "plan", "pos": [0.0, 6.95, 0.01], "look": [0.0, 0.0, 0.0], "fov": 122.0},
            {"id": "desk_detail", "pos": [1.6, 2.4, -6.8], "look": [0.0, 2.3, -15.0], "fov": 50.0},
            {"id": "booth_detail", "pos": [-1.0, 2.2, 6.4], "look": [0.0, 2.6, 12.0], "fov": 50.0},
        ], [("Swat", "Swat.fbx", S["spawn"]["p1"][0], 1, 1.82), ("Ch40", "Ch40_nonPBR.fbx", S["spawn"]["p2"][0], -1, 1.9)])
    K.tri_report(["boiler_", "desk_", "vw_crt_0_0_", "vw_crt_", "sb_crt_", "booth_", "console_", "beacon_l", "bd_", "mf_",
                  "hw_", "dais_", "step_", "rail_", "kick_", "post_", "rs_", "trench_", "ceil_", "rig_", "lamp_", "room_",
                  "obs_", "ww_", "uc_"])
    if K.DO_EXPORT:
        K.export([(n, objs, PIVOT.get(n.replace("anim_spin_", ""), None)) for n, objs in DRESS.items()])
        K.write_fragment()
        if K.DO_FINISH:
            K.run_finish()
log("DONE")
