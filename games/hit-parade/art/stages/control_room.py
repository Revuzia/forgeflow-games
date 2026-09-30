"""HIT PARADE - stage 5 THE CONTROL ROOM (boss stage, RICKY MARQUEE), built headless in Blender (lane STAGES-B).

The host's finale set in the boiler room under the studio: a steel diamond-plate fight deck with a glowing grated pipe
trench, between a riveted steel boiler-room bulkhead (splat wall x = -8, pipe runs, a rotating amber warning beacon) and
a sooty brick wall with a riveted blast door (splat wall x = +8, second beacon); yellow safety rail; the studio crowd on
steel risers left and right; centre: the raised host dais with marquee bulbs and the host desk with the lit HIT PARADE
logo panel, and behind it a wall of CRT monitors showing the show (live fight, K.O., ratings, host, colour bars...) with
an ON AIR box; angled CRT banks over the crowd; the riveted boiler with a glowing firebox and a pipe manifold at the back,
I-beams, pipes, cable trays and caged lamps under a low ceiling; cable trunks on the floor.

Usage (blender.exe directly so the log is visible; paths are resolved from this file):
  blender.exe --background --python art/stages/control_room.py -- [--no-export] [--no-render] [--no-art] [--no-finish]
        [--shots id,id] [--res 1920x1080] [--samples 48] [--no-fighters] [--contact]
Outputs:
  _harness/scratch/stages_cache/control_room_raw.glb -> art/gltf/stages/control_room.glb (stagefinish_b.py, chain D)
  art/gltf/stages/control_room_env.hdr                 (512x256 IBL, Poly Haven abandoned_garage, CC0)
  art/stages/control_room.stage.json                   (StageDef fragment, CONTRACT 21.2; STAGES-A merges it)
  _harness/_reports/stages/control_room_<shot>.png     (proof renders from the game camera)
The StageDef below is the source of truth; the build reads it (lights, fog, crowd bays, proof cameras).
Sources (read-only): Quaternius MegaKit T_Brick (CC0; OpenGL normal), Blink Cracked_Concrete_Floor (EULA), Japan
Village JP_Meters textures + JP_Electric_Meter_03 model (EULA), ForgeFlow generated bronze_worn (original), Poly Haven
abandoned_garage HDRI (CC0). Everything else (deck, trench grate, walls, blast door, beacons, pipes, rail, risers, dais,
host desk, CRT monitors + racks, boiler, manifold, beams, lamps, cables) is procedural here; 2D art is art2d_b.py.
ASCII only.
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

CAMERA = {
    "vFovDeg": 35.0, "heightM": 1.25, "lookAtY": 1.0, "distanceM": [4.36, 7.6], "pitchDeg": [-2.0, -4.0],
    "wallClampX": 8.0,
    "note": "FIGHTING_DESIGN 7b. Camera x is clamped so the splat wall sits at the screen edge on the fight line: "
            "|camX| <= wallClampX - distance * tan(hFov/2). Proof renders: _harness/_reports/stages/control_room_*.png",
    "proofShots": [
        {"id": "near_center", "pos": [0.0, 1.25, 4.4], "look": [0.0, 1.0, 0.0]},
        {"id": "far_center", "pos": [0.0, 1.25, 7.6], "look": [0.0, 1.0, 0.0]},
        {"id": "near_corner_r", "pos": [5.53, 1.25, 4.4], "look": [5.53, 1.0, 0.0]},
        {"id": "far_corner_l", "pos": [-3.74, 1.25, 7.6], "look": [-3.74, 1.0, 0.0]},
        {"id": "far_center_phone", "pos": [0.0, 1.25, 6.22], "look": [0.0, 1.0, 0.0], "aspect": 2.1667},
    ],
}

STAGE = {
    "id": "control_room",
    "name": "THE CONTROL ROOM",
    "status": "built",
    "glb": "control_room.glb",
    "source": "art/stages/control_room.py",
    "home": ["krane", "ricky"],
    "boss": "ricky",
    "look": "the host's finale set in the boiler room under the studio: steel diamond-plate deck with a glowing grated "
            "pipe trench between a riveted boiler-room bulkhead and a brick wall with a blast door, rotating amber "
            "beacons, the crowd on steel risers, the raised host dais and desk with the lit HIT PARADE logo, a wall of CRT "
            "monitors showing the show under an ON AIR box, the riveted boiler with a glowing firebox, pipes, I-beams, "
            "cable trunks and caged lamps",
    "floor": {"y": 0.0, "surface": "steel_deck", "fightStrip": {"x": [-8.0, 8.0], "z": [-1.5, 1.5]},
              "extent": {"x": [-17.0, 17.0], "z": [-17.0, 5.0]}},
    "walls": {
        "x": [-8.0, 8.0],
        "splat": [
            {"id": 0, "x": -8.0, "normal": [1, 0, 0], "z": [-3.4, 3.4], "heightM": 7.8, "surface": "riveted_steel",
             "dustColor": "#6f7a74"},
            {"id": 1, "x": 8.0, "normal": [-1, 0, 0], "z": [-3.4, 3.4], "heightM": 7.8, "surface": "sooty_brick",
             "dustColor": "#6a4a3e"},
        ],
        "note": "WALL_SPLAT event b = wall id (0 = x -8 riveted bulkhead, 1 = x +8 brick + blast door), CONTRACT 17.6",
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
        {"id": "key", "type": "directional", "color": "#ffd6a8", "intensity": 2.4,
         "position": [-5.0, 10.0, 8.0], "target": [0.0, 1.0, 0.0], "castShadow": True,
         "shadow": {"mapSize": 1024, "bias": -0.0004, "normalBias": 0.03,
                    "camera": {"left": -10.0, "right": 10.0, "top": 7.0, "bottom": -4.0, "near": 1.0, "far": 30.0}}},
        {"id": "rim", "type": "directional", "color": "#6fd6ff", "intensity": 1.1,
         "position": [3.0, 5.0, -10.0], "target": [0.0, 1.2, 0.0], "castShadow": False},
        {"id": "fill", "type": "hemisphere", "sky": "#3c4452", "ground": "#2c1b12", "intensity": 0.8},
        {"id": "crt_wall", "type": "point", "color": "#86d2ff", "intensity": 26.0, "distance": 12.0, "decay": 2,
         "position": [0.0, 3.4, -8.6], "flicker": {"amp": 0.05, "hz": 17.0}},
        {"id": "furnace", "type": "point", "color": "#ff6a20", "intensity": 30.0, "distance": 12.0, "decay": 2,
         "position": [-10.4, 1.3, -10.6], "flicker": {"amp": 0.25, "hz": 5.0}},
        {"id": "desk_spot", "type": "spot", "color": "#fff0d8", "intensity": 260.0, "distance": 18.0, "decay": 2,
         "position": [0.0, 7.3, -2.6], "target": [0.0, 1.8, -7.0], "angleDeg": 22.0, "penumbra": 0.5},
        {"id": "beacon", "type": "point", "color": "#ffa020", "intensity": 8.0, "distance": 8.0, "decay": 2,
         "position": [7.45, 3.2, -0.5], "flicker": {"amp": 0.6, "hz": 1.3}},
    ],
    "lightsNote": "FIXED pool: created once at stage load, never added/removed (shader programs stay warm). "
                  "No lights are embedded in the GLB. Flicker = view-only intensity modulation (beacon = the rotating "
                  "amber sweep, furnace = fire).",
    "crowd": {
        "atlas": "crowd_atlas.webp", "meta": "crowd_atlas.json", "cols": 12, "rows": 6, "count": 72,
        "cardHeightM": 2.4, "cardWidthM": 1.2, "anchor": [0.5, 0.97917],
        "tint": "#dcc8b6", "brightness": 0.46,
        "moods": {"idle": ["watch"], "cheer": ["cheer", "hype"], "jeer": ["jeer"]},
        "nodes": "GLB empties crowd_<bay>_<row>_<i>: position = feet point, +Z = card facing, uniform scale = card "
                 "height; extras {bay,row,i,rand,angle}. Generated from the bays below (rows run along world X; "
                 "x step = spacing, jitter = [x,z] half-ranges from mulberry32(seed); gapPct = share of empty spots).",
        "bays": [
            {"id": "risers_l", "x": [-15.3, -4.6], "spacing": 0.62, "jitter": [0.12, 0.06], "faceYawDeg": 0.0,
             "rows": [{"z": -4.62, "y": 0.3}, {"z": -5.47, "y": 0.6}, {"z": -6.32, "y": 0.9}], "seed": 5101, "gapPct": 0.05},
            {"id": "risers_r", "x": [4.6, 15.3], "spacing": 0.62, "jitter": [0.12, 0.06], "faceYawDeg": 0.0,
             "rows": [{"z": -4.62, "y": 0.3}, {"z": -5.47, "y": 0.6}, {"z": -6.32, "y": 0.9}], "seed": 5102, "gapPct": 0.05},
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
            {"what": "CRT screens", "nodes": "anim_flicker_crt", "how": "existing view hook anim_flicker_* (4 screens)"},
            {"what": "dais bulbs", "nodes": "marquee_bulbs", "how": "optional chase on emissive intensity (rust_theater name)"},
            {"what": "furnace", "how": "point light `furnace` flicker (view-only)"},
            {"what": "crowd", "how": "instanced cards, vertex bob/sway, pose swaps by ratings mood"},
        ],
        "splatWallDust": ["#6f7a74", "#6a4a3e"],
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
M_SCREEN = mat_pbr("cr_screen", color=(0.0, 0.0, 0.0, 1), roughness=0.12, etex="cr_screens", estrength=1.8)
M_SCREEN_F = mat_pbr("cr_screen_flicker", color=(0.0, 0.0, 0.0, 1), roughness=0.12, etex="cr_screens", estrength=1.8)
M_BEACON = mat_pbr("cr_beacon", color=(0.7, 0.35, 0.05, 1), roughness=0.2, etex="cr_signs", estrength=3.0)
M_GLOW = mat_pbr("cr_glow", color=(1.0, 0.45, 0.1, 1), roughness=0.6, emission=(1.0, 0.36, 0.06, 1), estrength=5.0)
M_BULB = mat_pbr("cr_bulb", color=(1.0, 0.86, 0.62, 1), roughness=0.3, emission=(1.0, 0.72, 0.4, 1), estrength=5.0)
M_RED = mat_pbr("cr_redlamp", color=(1.0, 0.12, 0.06, 1), roughness=0.3, emission=(1.0, 0.08, 0.04, 1), estrength=6.0)
M_GREEN = mat_pbr("cr_greenled", color=(0.2, 1.0, 0.3, 1), roughness=0.3, emission=(0.2, 1.0, 0.3, 1), estrength=4.0)
M_RUBBER = mat_pbr("cr_rubber", color=(0.018, 0.018, 0.02, 1), roughness=0.55)
M_GLASS = mat_pbr("cr_glass", color=(0.03, 0.035, 0.04, 1), roughness=0.05)
M_VOID = mat_pbr("cr_void", color=(0.006, 0.005, 0.006, 1), roughness=1.0)

DRESS = {"anim_spin_beacon_l": [], "anim_spin_beacon_r": [], "anim_flicker_crt": [], "marquee_bulbs": []}
PIVOT = {}


def atlas_uv(px0, py0, px1, py1, size=1024):
    """pixel rect (top-left origin) -> (u0, v0, u1, v1) in Blender UV space"""
    return (px0 / size, 1 - py1 / size, px1 / size, 1 - py0 / size)


def face_toward(ob, dir_g):
    """flip a sheet so its middle polygon faces game direction dir_g"""
    p = ob.data.polygons[len(ob.data.polygons) // 2]
    if p.normal.dot(G(*dir_g)) < 0:
        ob.data.flip_normals()
    return ob


def front_quad(name, x0, x1, y0, y1, z, mat, uv=(0, 0, 1, 1)):
    u0, v0, u1, v1 = uv
    ob = quad(name, [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], mat, ((u0, v0), (u1, v0), (u1, v1), (u0, v1)))
    if ob.data.polygons[0].normal.y > 0:
        ob.data.flip_normals()
    return ob


def wall_quad(name, x, y0, y1, z0, z1, mat, uv, facing):
    u0, v0, u1, v1 = uv
    if facing > 0:
        pts = [(x, y0, z1), (x, y0, z0), (x, y1, z0), (x, y1, z1)]
    else:
        pts = [(x, y0, z0), (x, y0, z1), (x, y1, z1), (x, y1, z0)]
    ob = quad(name, pts, mat, ((u0, v0), (u1, v0), (u1, v1), (u0, v1)))
    n = ob.data.polygons[0].normal
    if (n.x > 0) != (facing > 0):
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
    """pressure gauge: brass bezel ring + dial face (sign atlas gauge idx 0..3) + stem"""
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
    nn = ob.data.polygons[0].normal
    if nn.dot(G(*n)) < 0:
        ob.data.flip_normals()


def beacon(name, pos, side):
    """rotating warning beacon on a wall bracket: static bracket + base (set), spinning amber dome (node)"""
    x, y, z = pos
    wx = x - side * 0.35
    gbox(name + "_plate", wx - 0.02 * side, wx, y - 0.25, y + 0.05, z - 0.12, z + 0.12, M_STEEL, tile=0.5, bevel=0.01)
    tube(name + "_arm", [(wx, y - 0.12, z), (x, y - 0.12, z)], 0.03, M_STEEL, sides=8)
    cyl(name + "_base", (x, y - 0.06, z), (0, 1, 0), 0.13, 0.14, M_STEEL, sides=18, bevel=0.012)
    prof = [(0.115, 0.0), (0.118, 0.12), (0.105, 0.2), (0.07, 0.26), (0.0, 0.28)]
    dome = lathe(name + "_dome", prof, (x, y + 0.01, z), M_BEACON, sides=24,
                 uv_fn=lambda u, L, i: (u * 0.5, 0.125), cap_bot=True)
    cap = cyl(name + "_cap", (x, y + 0.3, z), (0, 1, 0), 0.03, 0.03, M_STEEL, sides=10)
    PIVOT[name] = (x, y, z)
    return [dome, cap]


# =============================================================== BUILD: fight deck + trench grate
log("build deck")
gbox("deck_a", -8.0, 8.0, -0.3, 0.0, -3.4, 2.0, M_DECK, tile=1.6)
gbox("deck_b", -8.0, 8.0, -0.3, 0.0, 3.2, 5.0, M_DECK, tile=1.6)
gbox("floor_conc", -17.0, 17.0, -0.3, -0.06, -17.0, 5.0, M_CONC, tile=2.5)
for zs in (-3.4, -1.3, 0.75):
    gbox("deck_seam_%.2f" % zs, -8.0, 8.0, 0.0, 0.006, zs - 0.012, zs + 0.012, M_STEEL, tile=0.5)
for xs in (-6.0, -4.0, -2.0, 0.0, 2.0, 4.0, 6.0):
    gbox("deck_seamx_%.1f" % xs, xs - 0.012, xs + 0.012, 0.0, 0.006, -3.4, 2.0, M_STEEL, tile=0.5)
bolts("deck_bolts", [(x, 0.006, z) for x in np.arange(-7.8, 7.9, 1.0) for z in (-3.3, -1.4, 0.65, 1.9)], (0, 1, 0), M_STEEL,
      r=0.014, h=0.006)
# trench: walls, floor, pipes, glow strip, grate on top (flush with the deck)
gbox("trench_floor", -8.0, 8.0, -0.62, -0.55, 2.0, 3.2, M_CONC, tile=1.0)
gbox("trench_wall_a", -8.0, 8.0, -0.6, 0.0, 1.98, 2.0, M_STEEL, tile=1.0)
gbox("trench_wall_b", -8.0, 8.0, -0.6, 0.0, 3.2, 3.22, M_STEEL, tile=1.0)
pipe("trench_pipe_a", [(-8.0, -0.36, 2.35), (8.0, -0.36, 2.35)], 0.09, "red", fl_step=2.5)
pipe("trench_pipe_b", [(-8.0, -0.4, 2.8), (8.0, -0.4, 2.8)], 0.12, "green", fl_step=3.0)
gbox("trench_glow", -8.0, 8.0, -0.55, -0.535, 2.02, 3.18, M_GLOW, tile=1.0)
gbox("trench_glow_wall", -8.0, 8.0, -0.52, -0.04, 2.0, 2.012, M_GLOW, tile=1.0)      # the far camera sees the back wall
for x in np.arange(-7.5, 7.6, 1.5):
    gbox("trench_bearer_%.1f" % x, x - 0.03, x + 0.03, -0.06, -0.012, 2.0, 3.2, M_STEEL, tile=0.5)
g = quad("trench_grate", [(-8.0, -0.004, 3.2), (8.0, -0.004, 3.2), (8.0, -0.004, 2.0), (-8.0, -0.004, 2.0)], M_GRATE,
         ((0, 0), (16.0, 0), (16.0, 1.2), (0, 1.2)))
if g.data.polygons[0].normal.z < 0:
    g.data.flip_normals()

# =============================================================== BUILD: left splat wall (riveted bulkhead, x = -8)
log("build walls")
gbox("wall_l", -8.4, -8.0, 0.0, 7.8, -3.4, 3.4, M_PANEL, tile=2.4)
gbox("wall_r", 8.0, 8.4, 0.0, 7.8, -3.4, 3.4, M_BRICK, tile=1.6)
for s, x in ((1, -7.99), (-1, 7.99)):
    for k in range(4):
        z0 = -3.4 + 1.7 * k
        wall_quad("kick_%d_%d" % (s, k), x, 0.02, 0.3, z0, z0 + 1.7, M_SIGN, STRIPES, s)
# pipe runs on the left wall + valve, vertical riser with gauge, breaker panel, stencil plate
pipe("lw_pipe_1", [(-7.72, 3.55, -3.4), (-7.72, 3.55, 3.4)], 0.12, "green")
pipe("lw_pipe_2", [(-7.78, 4.0, -3.4), (-7.78, 4.0, 3.4)], 0.08, "red")
pipe("lw_pipe_3", [(-7.8, 4.35, -3.4), (-7.8, 4.35, 3.4)], 0.065, "cream")
for z in np.arange(-3.0, 3.1, 1.6):
    for (yy, r) in ((3.55, 0.12), (4.0, 0.08), (4.35, 0.065)):
        gbox("lw_strap_%.1f_%.2f" % (z, yy), -8.0, -7.72 + r * 0.2 if r > 0.1 else -7.78 + r * 0.2, yy - r - 0.03,
             yy - r, z - 0.04, z + 0.04, M_STEEL, tile=0.3)
valve_wheel("lw_valve", (-7.5, 3.55, 1.25), (1, 0, 0), 0.24)
cyl("lw_valve_body", (-7.62, 3.55, 1.25), (1, 0, 0), 0.16, 0.18, M_BRASS, sides=14, bevel=0.01)
pipe("lw_riser", [(-7.8, 0.0, -2.75), (-7.8, 3.43, -2.75), (-7.72, 3.55, -2.75)], 0.07, "red", flanges=False)
gauge("lw_gauge", (-7.62, 1.75, -2.45), (1, 0, 0), 0.13, 0)
tube("lw_gauge_stem", [(-7.8, 1.75, -2.75), (-7.8, 1.75, -2.45), (-7.66, 1.75, -2.45)], 0.015, M_BRASS, sides=6)
gbox("lw_breaker", -8.0, -7.82, 0.9, 2.2, 0.6, 1.5, M_STEEL, tile=0.6, bevel=0.015)
wall_quad("lw_breaker_face", -7.815, 1.0, 2.1, 0.68, 1.42, M_SIGN, atlas_uv(768, 512, 1023, 767), 1)
tube("lw_breaker_handle", [(-7.81, 1.3, 1.45), (-7.7, 1.3, 1.45), (-7.7, 1.8, 1.45), (-7.81, 1.8, 1.45)], 0.015, M_BRASS, sides=6)
wall_quad("lw_stencil", -7.99, 2.35, 2.8, -1.1, 0.4, M_SIGN, atlas_uv(512, 384, 1023, 511), 1)
K.template("meter3", K.JPM + "Props/JP_Electric_Meter_03.fbx", mat=M_METERS)
K.inst("meter3", "lw_meter", (-7.96, 1.1, 2.4), K.face_yaw((1, 0, 0), Vector((0, -1, 0))), 1.2, pivot="bottom")
tube("lw_conduit", [(-7.96, 1.5, 2.4), (-7.96, 3.2, 2.4), (-7.96, 3.2, 3.4)], 0.02, M_STEEL, sides=8)
DRESS["anim_spin_beacon_l"] += beacon("beacon_l", (-7.45, 3.05, -1.6), -1)
# caged wall lamps
for (x, z, s) in ((-7.9, 2.9, 1), (7.9, 2.9, -1)):
    cyl("cage_base_%d" % s, (x, 2.75, z), (s, 0, 0), 0.08, 0.06, M_STEEL, sides=14, bevel=0.006)
    sphere("cage_bulb_%d" % s, (x + s * 0.09, 2.75, z), 0.065, M_BULB, seg=10, rings=7)
    for k in range(6):
        a = k * math.pi / 3
        tube("cage_bar_%d_%d" % (s, k), [(x + s * 0.02, 2.75 + 0.08 * math.sin(a), z + 0.08 * math.cos(a)),
                                         (x + s * 0.17, 2.75 + 0.06 * math.sin(a), z + 0.06 * math.cos(a)),
                                         (x + s * 0.19, 2.75, z)], 0.005, M_STEEL, sides=4, caps=False)

# =============================================================== BUILD: right splat wall (brick + blast door, x = +8)
DZ0, DZ1, DY1 = -2.75, -0.95, 2.3
for (a0, a1, b0, b1) in ((DZ0 - 0.18, DZ0, 0.0, DY1 + 0.18), (DZ1, DZ1 + 0.18, 0.0, DY1 + 0.18),
                         (DZ0 - 0.18, DZ1 + 0.18, DY1, DY1 + 0.18)):
    gbox("bd_frame_%.2f_%.2f" % (a0, b0), 7.86, 8.0, b0, b1, a0, a1, M_STEEL, tile=0.8, bevel=0.03)
bolts("bd_frame_rivets", [(7.86, y, z) for y in np.arange(0.15, DY1 + 0.1, 0.25) for z in (DZ0 - 0.09, DZ1 + 0.09)] +
      [(7.86, DY1 + 0.09, z) for z in np.arange(DZ0 - 0.05, DZ1 + 0.06, 0.25)], (-1, 0, 0), M_STEEL, r=0.016)
gbox("bd_leaf", 7.9, 7.97, 0.06, DY1 - 0.04, DZ0 + 0.03, DZ1 - 0.03, M_PANEL, tile=1.6, bevel=0.07, segs=3)
for (yy, zz) in ((0.35, DZ0 + 0.03), (DY1 - 0.35, DZ0 + 0.03), (0.35, DZ1 - 0.03), (DY1 - 0.35, DZ1 - 0.03)):
    obox("bd_dog_%.2f_%.2f" % (yy, zz), (7.86, yy, zz), (0.05, 0.05, 0.26), M_STEEL, yaw_deg=0.0, roll_deg=0.0,
         tile=0.3, bevel=0.01)
valve_wheel("bd_wheel", (7.78, 1.25, (DZ0 + DZ1) / 2), (-1, 0, 0), 0.3, M_BRASS)
for yy in (0.45, DY1 - 0.45):
    cyl("bd_hinge_%.2f" % yy, (7.9, yy, DZ0 - 0.02), (0, 1, 0), 0.05, 0.28, M_STEEL, sides=12, bevel=0.008)
wall_quad("bd_warn", 7.985, 1.45, 2.05, 0.3, 1.5, M_SIGN, atlas_uv(0, 512, 511, 767), -1)
wall_quad("rw_standby", 7.985, 2.55, 2.85, 1.7, 2.3, M_SIGNLIT, atlas_uv(256, 384, 511, 511), -1)
pipe("rw_pipe_1", [(7.74, 3.6, -3.4), (7.74, 3.6, 3.4)], 0.1, "black")
pipe("rw_pipe_2", [(7.8, 4.1, -3.4), (7.8, 4.1, 3.4)], 0.07, "cream")
for z in np.arange(-3.0, 3.1, 1.6):
    gbox("rw_strap_%.1f" % z, 7.8, 8.0, 3.47, 3.5, z - 0.04, z + 0.04, M_STEEL, tile=0.3)
tube("rw_conduit", [(7.97, 0.3, 2.9), (7.97, 3.1, 2.9), (7.97, 3.1, -0.3)], 0.022, M_STEEL, sides=8)
DRESS["anim_spin_beacon_r"] += beacon("beacon_r", (7.45, 3.05, -0.5), 1)
# end columns (H-section steel) where the bulkheads meet the wide back room
for s in (-1, 1):
    for zc in (-3.55, 3.55):
        x = s * 8.12
        gbox("col_web_%d_%.1f" % (s, zc), x - 0.02, x + 0.02, 0.0, 7.8, zc - 0.14, zc + 0.14, M_STEEL, tile=1.0)
        gbox("col_fl1_%d_%.1f" % (s, zc), x - 0.15, x + 0.15, 0.0, 7.8, zc - 0.15, zc - 0.13, M_STEEL, tile=1.0)
        gbox("col_fl2_%d_%.1f" % (s, zc), x - 0.15, x + 0.15, 0.0, 7.8, zc + 0.13, zc + 0.15, M_STEEL, tile=1.0)
        gbox("col_base_%d_%.1f" % (s, zc), x - 0.26, x + 0.26, 0.0, 0.03, zc - 0.26, zc + 0.26, M_STEEL, tile=0.5, bevel=0.005)

# =============================================================== BUILD: guard rail, risers
log("build rail + risers")
ZR = -3.8
for (xa, xb) in ((-8.0, -1.45), (1.45, 8.0)):
    for yy in (0.55, 1.05):
        tube("rail_%.1f_%.2f" % (xa, yy), [(xa, yy, ZR), (xb, yy, ZR)], 0.026, M_YELLOW, sides=10)
    n = int(round((xb - xa) / 1.3))
    for k in range(n + 1):
        x = xa + (xb - xa) * k / n
        tube("rail_post_%.2f" % x, [(x, 0.0, ZR), (x, 1.05, ZR)], 0.026, M_YELLOW, sides=10)
        cyl("rail_foot_%.2f" % x, (x, 0.01, ZR), (0, 1, 0), 0.07, 0.02, M_STEEL, sides=12)
    L = xb - xa
    for k in range(int(math.ceil(L / 2.0))):
        x0 = xa + 2.0 * k
        x1 = min(xb, x0 + 2.0)
        front_quad("rail_toe_%.1f_%d" % (xa, k), x0, x1, 0.0, 0.14, ZR + 0.012, M_SIGN,
                   (0.0, STRIPES[1], (x1 - x0) / 2.0 * STRIPES[2], STRIPES[3]))
        gbox("rail_toeb_%.1f_%d" % (xa, k), x0, x1, 0.0, 0.14, ZR - 0.004, ZR + 0.008, M_STEEL, tile=0.5)
for s in (-1, 1):
    xa, xb = (-15.6, -4.2) if s < 0 else (4.2, 15.6)
    for k in range(3):
        y = 0.3 * (k + 1)
        zf = -4.2 - 0.85 * k
        gbox("riser_tread_%d_%d" % (s, k), xa, xb, y - 0.05, y, zf - 0.85, zf, M_DECK, tile=1.0, bevel=0.006, segs=1)
        gbox("riser_face_%d_%d" % (s, k), xa, xb, y - 0.3, y - 0.05, zf - 0.02, zf, M_STEEL, tile=1.2)
        for j in range(int(math.ceil((xb - xa) / 2.0))):
            x0 = xa + 2.0 * j
            x1 = min(xb, x0 + 2.0)
            front_quad("riser_nose_%d_%d_%d" % (s, k, j), x0, x1, y - 0.045, y - 0.005, zf + 0.012, M_SIGN,
                       (0.0, STRIPES[1], (x1 - x0) / 2.0 * STRIPES[2], STRIPES[3]))
        for x in np.arange(xa + 0.1, xb, 2.4):
            gbox("riser_leg_%d_%d_%.1f" % (s, k, x), x - 0.03, x + 0.03, 0.0, y - 0.05, zf - 0.45, zf - 0.39, M_STEEL, tile=0.4)
    gbox("riser_back_%d" % s, xa, xb, 0.0, 0.9, -6.77, -6.75, M_STEEL, tile=1.2)
    for yy in (1.45, 1.9):
        tube("riser_rail_%d_%.2f" % (s, yy), [(xa, yy, -6.8), (xb, yy, -6.8)], 0.024, M_YELLOW, sides=8)
    for x in np.arange(xa, xb + 0.01, 1.9):
        tube("riser_rpost_%d_%.1f" % (s, x), [(x, 0.9, -6.8), (x, 1.9, -6.8)], 0.024, M_YELLOW, sides=8)
    # side staircase end rails
    xe = xb if s < 0 else xa
    tube("riser_end_rail_%d" % s, [(xe, 1.05, -4.1), (xe, 1.95, -6.8)], 0.024, M_YELLOW, sides=8)

# =============================================================== BUILD: host dais + desk (hero)
log("build dais + desk")
DZF, DZB, DH = -4.6, -9.8, 1.2
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
# steps up to the dais (host walk-down to the fight floor) + handrails
for k in range(3):
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
        tube("step_rail_post_%d_%.1f" % (s, zz), [(s * 1.45, yb, zz), (s * 1.45, yb + 1.0 + (0 if yb else 0.0), zz)],
             0.025, M_YELLOW, sides=8)


def desk():
    """curved host desk: lacquered body bowed toward the camera, lit HIT PARADE logo panel, brass edge, desk top,
    side pods with small monitors, gooseneck mic, big red button, dial rack; tall host chair behind"""
    R, CZ = 6.0, -12.3
    th = math.radians(21.0)
    y0, y1 = DH, DH + 1.05
    n = 24

    def arc(t, r):
        a = -th + 2 * th * t
        return (r * math.sin(a), CZ + r * math.cos(a))
    # front body (curved sheet) + back sheet + ends -> closed shell
    face_toward(K.surface("desk_front", n, 1, lambda u, v: (arc(u, R)[0], y1 - (y1 - y0) * v, arc(u, R)[1]), M_LACQ,
                          lambda u, v: (u * 4.5 / 1.2, (1 - v) * 1.05 / 1.2)), (0, 0, 1))
    face_toward(K.surface("desk_back", n, 1, lambda u, v: (arc(1 - u, R - 0.62)[0], y1 - 0.06 - (y1 - 0.06 - y0) * v,
                                                           arc(1 - u, R - 0.62)[1]),
                          M_LACQ, lambda u, v: (u * 4.0 / 1.2, (1 - v))), (0, 0, -1))
    for t, nm, sx in ((0.0, "l", -1), (1.0, "r", 1)):
        xa, za = arc(t, R)
        xb, zb = arc(t, R - 0.62)
        face_toward(quad("desk_end_" + nm, [(xa, y0, za), (xb, y0, zb), (xb, y1, zb), (xa, y1, za)], M_LACQ), (sx, 0, 0))
    # logo panel: slightly proud curved surface with the atlas logo (emissive)
    u0, v0, u1, v1 = atlas_uv(0, 128, 1023, 383)
    face_toward(K.surface("desk_logo", n, 1, lambda u, v: (arc(0.06 + 0.88 * u, R + 0.012)[0], y0 + 0.95 - 0.8 * v,
                                                           arc(0.06 + 0.88 * u, R + 0.012)[1]), M_SIGNLIT,
                          lambda u, v: (u0 + (u1 - u0) * u, v1 - (v1 - v0) * v)), (0, 0, 1))
    # desk top slab following the arc (two arcs + fan of quads)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    fr = [bm.verts.new(G(arc(i / n, R + 0.06)[0], y1 + 0.05, arc(i / n, R + 0.06)[1])) for i in range(n + 1)]
    bk = [bm.verts.new(G(arc(i / n, R - 0.7)[0], y1 + 0.05, arc(i / n, R - 0.7)[1])) for i in range(n + 1)]
    frd = [bm.verts.new(G(arc(i / n, R + 0.06)[0], y1, arc(i / n, R + 0.06)[1])) for i in range(n + 1)]
    bkd = [bm.verts.new(G(arc(i / n, R - 0.7)[0], y1, arc(i / n, R - 0.7)[1])) for i in range(n + 1)]
    for i in range(n):
        for vs in ((fr[i], fr[i + 1], bk[i + 1], bk[i]), (frd[i], frd[i + 1], fr[i + 1], fr[i]),
                   (bk[i], bk[i + 1], bkd[i + 1], bkd[i]), (bkd[i], bkd[i + 1], frd[i + 1], frd[i])):
            f = bm.faces.new(vs)
    for f in bm.faces:
        for loop in f.loops:
            co = loop.vert.co
            loop[uvl].uv = (co.x / 1.2, co.y / 1.2 + co.z)
    bm.faces.new((fr[0], bk[0], bkd[0], frd[0]))
    bm.faces.new((frd[n], bkd[n], bk[n], fr[n]))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    K.finish(bm, "desk_top", [M_PLASTIC], uv=False, smooth_angle=30)
    # brass edge band on the front top edge + base kick
    tube("desk_brass", [(arc(i / n, R + 0.075)[0], y1 + 0.025, arc(i / n, R + 0.075)[1]) for i in range(n + 1)], 0.03,
         M_BRASS, sides=8)
    tube("desk_kick", [(arc(i / n, R + 0.03)[0], y0 + 0.04, arc(i / n, R + 0.03)[1]) for i in range(n + 1)], 0.04,
         M_STEEL, sides=6)
    # side pods with small CRTs facing the host
    for s in (-1, 1):
        px, pz = arc(0.5 + s * 0.52, R - 0.3)
        gbox("desk_pod_%d" % s, px - 0.32, px + 0.32, y1 + 0.05, y1 + 0.2, pz - 0.28, pz + 0.28, M_LACQ, tile=0.8, bevel=0.03)
        crt("desk_crt_%d" % s, (px, y1 + 0.43, pz), 0.5, 0.38, 0.42, 180.0 + s * 25.0, 8 if s < 0 else 3, "graphite")
    # gooseneck mic + big red button + dial rack
    mx, mz = arc(0.5, R - 0.35)
    cyl("desk_mic_base", (mx + 0.3, y1 + 0.07, mz), (0, 1, 0), 0.08, 0.04, M_STEEL, sides=14, bevel=0.008)
    tube("desk_mic_neck", [(mx + 0.3, y1 + 0.08, mz), (mx + 0.3, y1 + 0.35, mz - 0.02), (mx + 0.28, y1 + 0.5, mz + 0.1),
                           (mx + 0.25, y1 + 0.55, mz + 0.22)], 0.012, M_STEEL, sides=6)
    cyl("desk_mic_head", (mx + 0.25, y1 + 0.555, mz + 0.27), (0, 0.15, 1), 0.035, 0.11, M_RUBBER, sides=12, bevel=0.006)
    cyl("desk_button_base", (mx - 0.35, y1 + 0.075, mz), (0, 1, 0), 0.09, 0.05, M_YELLOW, sides=16, bevel=0.01)
    sphere("desk_button", (mx - 0.35, y1 + 0.1, mz), 0.065, M_RED, seg=14, rings=7, scale=(1.0, 0.55, 1.0))
    for k in range(5):
        cyl("desk_dial_%d" % k, (mx - 0.9 + k * 0.1, y1 + 0.075, mz + 0.05), (0, 1, 0), 0.025, 0.04, M_BRASS, sides=10)
    # (no host chair: read as a wooden lectern in front of the CRT wall in the proof renders - removed)


# =============================================================== CRT monitors (hero dressing) + racks
SCREEN_TILES = 16


def crt(name, c, w, h, depth, yaw_deg, tile, shell="beige", screen_mat=None):
    """CRT monitor centred at c (screen face centre), facing yaw (0 = +Z): bevelled bezel block, tapered tube housing,
    bulged recessed screen (atlas tile), rubber gasket, control knobs, power LED, vents. Built in local space, UVs
    local (plastic atlas half: beige 0..0.5 / graphite 0.5..1), then placed."""
    screen_mat = screen_mat or M_SCREEN
    offu = 0.0 if shell == "beige" else 0.5
    d1 = 0.28 * depth
    R = Matrix.Translation(G(*c)) @ Matrix.Rotation(math.radians(yaw_deg), 4, "Z")
    parts = []
    # bezel block (local Blender coords: x right, -y forward (game +z), z up)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * w, (v.co.y + 0.5) * d1, v.co.z * h))     # bezel front face at local y = 0
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(w, h) * 0.07, segments=2, profile=0.6, affect="EDGES",
                    clamp_overlap=True)
    # rear tube housing (frustum)
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
    # screen: bulged grid recessed into the bezel
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
            row.append(bm.verts.new(Vector((s_ * sw / 2, -0.004 - bulge, yc + t_ * sh / 2))))     # glass proud of the bezel
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
    # gasket frame around the screen (4 thin bars, local) + knobs + LED + badge
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


desk()

# =============================================================== BUILD: CRT video wall + side banks
log("build CRT banks")
VZ = -10.3
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
# ON AIR box on top of the wall
gbox("onair_box", -0.75, 0.75, row_y[-1] + VH / 2 + 0.14, row_y[-1] + VH / 2 + 0.56, VZ - 0.35, VZ - 0.05, M_STEEL,
     tile=0.6, bevel=0.02)
front_quad("onair_face", -0.7, 0.7, row_y[-1] + VH / 2 + 0.17, row_y[-1] + VH / 2 + 0.53, VZ - 0.045, M_SIGNLIT,
           atlas_uv(0, 384, 255, 511))
for s in (-1, 1):
    tube("onair_hanger_%d" % s, [(s * 0.6, row_y[-1] + VH / 2 + 0.56, VZ - 0.2), (s * 0.6, 7.3, VZ - 0.2)], 0.012, M_STEEL, sides=4)
# side banks over the crowd, angled toward the fight
for s in (-1, 1):
    cxb, czb = s * 7.4, -8.3
    yaw = -s * 26.0
    bw, bh, bd = 0.92, 0.64, 0.62
    rows = [3.05, 3.75, 4.45]
    objs = rack("sb_rack_%d" % s, cxb - 1.55, cxb + 1.55, 0.0, rows[-1] + bh / 2 + 0.1, czb, [y - bh / 2 - 0.01 for y in rows] +
                [1.2, 2.0], depth=bd + 0.08, yaw_deg=yaw, pivot=(cxb, 0.0, czb))
    # equipment cabinet in the lower rack: panels with LED rows
    for k, yy in enumerate((0.35, 0.95, 1.6, 2.25)):
        ob = obox("sb_cab_%d_%d" % (s, k), (cxb, yy, czb - 0.05), (3.0, 0.5, 0.1), M_PLASTIC, yaw_deg=yaw, tile=2.0, bevel=0.015)
        for j in range(8):
            lx = cxb - 1.2 + j * 0.34
            p = Vector((lx - cxb, 0, 0))
            rp = Matrix.Rotation(math.radians(yaw), 3, "Y") @ p
            sphere("sb_led_%d_%d_%d" % (s, k, j), (cxb + rp.x, yy + 0.12, czb - 0.05 + rp.z + 0.06 * math.cos(math.radians(yaw))),
                   0.018, M_GREEN if (j + k) % 3 else M_RED, seg=6, rings=4)
    for r, yy in enumerate(rows):
        for ci in range(3):
            lx = (ci - 1) * (bw + 0.06)
            rp = Matrix.Rotation(math.radians(yaw), 3, "Y") @ Vector((lx, 0, 0))
            t = [7, 11, 13, 3, 6, 4, 12, 15, 9][(r * 3 + ci + (0 if s < 0 else 4)) % 9]
            crt("sb_crt_%d_%d_%d" % (s, r, ci), (cxb + rp.x, yy, czb + rp.z), bw, bh, bd, yaw, t,
                "beige" if (r + ci + s) % 2 else "graphite")

# =============================================================== BUILD: boiler (hero) + manifold
log("build boiler + manifold")


def boiler(cx, cz, r=1.45):
    gbox("boiler_plinth", cx - 1.9, cx + 1.9, -0.06, 0.35, cz - 1.9, cz + 1.9, M_CONC, tile=1.2, bevel=0.03)
    prof = [(r, 0.35), (r, 4.0), (r * 0.92, 4.45), (r * 0.68, 4.8), (r * 0.32, 5.0), (0.0, 5.04)]
    lathe("boiler_shell", prof, (cx, 0.0, cz), M_PANEL, sides=40, tile_u=2.4, tile_v=2.4)
    for yy in (0.62, 1.7, 2.8, 3.85):
        ring = [(cx + (r + 0.02) * math.cos(a), yy, cz + (r + 0.02) * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 41)]
        tube("boiler_band_%.2f" % yy, ring, 0.045, M_STEEL, sides=6, caps=False)
        bolts("boiler_rivets_%.2f" % yy, [(cx + (r + 0.05) * math.cos(a), yy + 0.07, cz + (r + 0.05) * math.sin(a))
                                          for a in np.linspace(0, 2 * math.pi, 37)[:-1]], (0, 1, 0), M_STEEL, r=0.018, h=0.01)
    # firebox door (faces +z toward the fight) with a glowing grille
    fz = cz + r + 0.01
    gbox("boiler_door_frame", cx - 0.62, cx + 0.62, 0.55, 1.55, fz - 0.05, fz + 0.1, M_STEEL, tile=0.6, bevel=0.03)
    gbox("boiler_door_glow", cx - 0.5, cx + 0.5, 0.68, 1.42, fz + 0.1, fz + 0.11, M_GLOW, tile=0.6)
    for k in range(8):
        x = cx - 0.44 + k * 0.126
        gbox("boiler_door_bar_%d" % k, x - 0.022, x + 0.022, 0.66, 1.44, fz + 0.1, fz + 0.16, M_STEEL, tile=0.3, bevel=0.006)
    for yy in (0.72, 1.38):
        cyl("boiler_door_hinge_%.2f" % yy, (cx - 0.66, yy, fz + 0.08), (0, 1, 0), 0.04, 0.16, M_STEEL, sides=10)
    tube("boiler_door_latch", [(cx + 0.58, 1.05, fz + 0.16), (cx + 0.8, 1.05, fz + 0.2)], 0.022, M_BRASS, sides=6)
    # gauges on a manifold stub + sight glass
    for k, (gx, gy) in enumerate(((cx - 0.55, 2.35), (cx, 2.5), (cx + 0.55, 2.35))):
        tube("boiler_gstem_%d" % k, [(gx, gy, fz - 0.02), (gx, gy, fz + 0.2)], 0.018, M_BRASS, sides=6)
        gauge("boiler_gauge_%d" % k, (gx, gy, fz + 0.24), (0, 0, 1), 0.16, k + 1)
    tube("boiler_sight", [(cx + 1.0, 1.9, cz + r * 0.72), (cx + 1.0, 3.1, cz + r * 0.72)], 0.03, M_GLASS, sides=10)
    for yy in (1.9, 3.1):
        cyl("boiler_sight_fit_%.1f" % yy, (cx + 1.0, yy, cz + r * 0.72), (0, 1, 0), 0.05, 0.08, M_BRASS, sides=10)
    # flue + steam pipes to the ceiling, safety valve
    pipe("boiler_flue", [(cx, 4.95, cz), (cx, 6.9, cz), (cx + 0.4, 7.3, cz)], 0.26, "black", fl_step=1.2)
    pipe("boiler_steam", [(cx + 0.9, 4.2, cz - 0.4), (cx + 0.9, 5.4, cz - 0.4), (cx + 3.2, 5.4, cz - 0.4), (cx + 3.2, 7.4, cz - 0.4)],
         0.12, "red", fl_step=1.4)
    lathe("boiler_safety", [(0.07, 0.0), (0.07, 0.25), (0.12, 0.3), (0.12, 0.42), (0.04, 0.5)], (cx - 0.7, 4.72, cz + 0.3), M_BRASS,
          sides=12, tile_u=0.3, tile_v=0.3)
    valve_wheel("boiler_valve", (cx + 1.15, 1.2, cz + 1.0), (0.7, 0.0, 0.7), 0.26)
    # ladder
    lx = cx - r - 0.2
    for dz in (-0.25, 0.25):
        tube("boiler_ladder_rail_%.2f" % dz, [(lx, 0.35, cz + dz), (lx, 5.2, cz + dz)], 0.02, M_STEEL, sides=6)
    for k in range(15):
        yy = 0.6 + k * 0.3
        tube("boiler_rung_%d" % k, [(lx, yy, cz - 0.25), (lx, yy, cz + 0.25)], 0.013, M_STEEL, sides=5, caps=False)


boiler(-11.4, -12.2)
# manifold (right back): vertical pipes, header, valves, gauges, hot water tank
MX, MZ = 11.2, -12.4
for k, (dx, r, band) in enumerate(((-1.1, 0.14, "green"), (-0.45, 0.1, "red"), (0.2, 0.18, "cream"), (0.95, 0.12, "black"))):
    pipe("mf_v_%d" % k, [(MX + dx, 0.0, MZ), (MX + dx, 7.8, MZ)], r, band, fl_step=1.8)
    valve_wheel("mf_valve_%d" % k, (MX + dx, 1.35 + 0.25 * k, MZ + r + 0.2), (0, 0, 1), 0.2 + 0.03 * (k % 2))
    cyl("mf_valve_body_%d" % k, (MX + dx, 1.35 + 0.25 * k, MZ + r * 0.5), (0, 0, 1), r * 1.2, 0.3, M_BRASS, sides=12, bevel=0.01)
pipe("mf_header", [(MX - 1.6, 2.6, MZ + 0.05), (MX + 1.5, 2.6, MZ + 0.05)], 0.16, "green", fl_step=1.0)
for k in range(3):
    gauge("mf_gauge_%d" % k, (MX - 0.9 + k * 0.8, 3.35, MZ + 0.32), (0, 0, 1), 0.14, (k + 2) % 4)
    tube("mf_gstem_%d" % k, [(MX - 0.9 + k * 0.8, 2.6, MZ + 0.1), (MX - 0.9 + k * 0.8, 3.35, MZ + 0.1),
                             (MX - 0.9 + k * 0.8, 3.35, MZ + 0.26)], 0.016, M_BRASS, sides=6)
lathe("hw_tank", [(0.95, 0.0), (0.95, 2.7), (0.85, 3.0), (0.4, 3.18), (0.0, 3.2)], (MX + 2.9, -0.06, MZ + 0.6), M_PIPE, sides=32,
      uv_fn=lambda u, L, i: (u * 5.0, 0.26 + 0.2 * min(1.0, L / 3.2)))
for yy in (0.4, 1.4, 2.4):
    tube("hw_band_%.1f" % yy, [(MX + 2.9 + 0.97 * math.cos(a), yy, MZ + 0.6 + 0.97 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 33)],
         0.03, M_STEEL, sides=6, caps=False)
pipe("hw_link", [(MX + 1.95, 2.0, MZ + 0.6), (MX + 1.5, 2.0, MZ + 0.6), (MX + 1.5, 2.6, MZ + 0.05)], 0.08, "cream", flanges=False)

# =============================================================== BUILD: back room shell, ceiling, beams, pipes, lamps
log("build room shell")
for s in (-1, 1):
    gbox("side_wall_%d" % s, s * 17.0, s * 17.4, 0.0, 7.8, -17.0, 5.0, M_BRICK, tile=1.6)
gbox("back_wall", -17.4, 17.4, 0.0, 7.8, -17.4, -17.0, M_BRICK, tile=1.6)
gbox("ceiling", -17.4, 17.4, 7.8, 8.1, -17.4, 5.0, M_CONC, tile=3.0)
for z in (-1.0, -4.0, -7.0, -10.0, -13.0, -16.0):
    xa, xb = (-8.0, 8.0) if z > -3.4 else (-17.0, 17.0)
    gbox("beam_web_%.0f" % z, xa, xb, 7.3, 7.8, z - 0.02, z + 0.02, M_STEEL, tile=1.2)
    gbox("beam_fl_%.0f" % z, xa, xb, 7.28, 7.32, z - 0.14, z + 0.14, M_STEEL, tile=1.2)
for k, (x, r, band) in enumerate(((-5.2, 0.2, "green"), (-3.1, 0.12, "red"), (3.6, 0.16, "cream"), (5.9, 0.1, "black"))):
    pipe("ceil_pipe_%d" % k, [(x, 6.95 - 0.1 * k, 5.0), (x, 6.95 - 0.1 * k, -17.0)], r, band, fl_step=3.0)
# cable tray across the back, cables dropping to the video wall
gbox("tray_bottom", -9.0, 9.0, 6.3, 6.33, -11.3, -10.9, M_STEEL, tile=1.0)
for zz in (-11.3, -10.9):
    gbox("tray_side_%.1f" % zz, -9.0, 9.0, 6.33, 6.45, zz - 0.01, zz + 0.01, M_STEEL, tile=1.0)
for x in np.arange(-8.5, 8.6, 2.0):
    tube("tray_hanger_%.1f" % x, [(x, 6.45, -11.1), (x, 7.28, -11.1)], 0.01, M_STEEL, sides=4)
rng = K.mulberry32(777)
for k in range(9):
    zz = -11.2 + 0.05 * k
    yy = 6.36 + 0.02 * (k % 2)
    pts = [(-9.0, yy, zz), (9.0, yy, zz)]
    tube("tray_cable_%d" % k, pts, 0.022, M_RUBBER, sides=5, caps=False)
for k, x in enumerate((-3.3, -1.2, 1.0, 3.1)):
    tube("drop_cable_%d" % k, [(x, 6.33, -11.1), (x + 0.1, 5.9, -10.9), (x + 0.2, 5.4, -10.75)], 0.03, M_RUBBER, sides=6)
# caged ceiling lamps
for (x, z) in ((-4.5, -6.2), (4.5, -6.2), (-10.5, -9.0), (10.5, -9.0), (-6.0, -14.0), (6.0, -14.0), (0.0, -14.5)):
    tube("lamp_cord_%.1f_%.1f" % (x, z), [(x, 7.28, z), (x, 6.55, z)], 0.008, M_RUBBER, sides=4)
    lathe("lamp_shade_%.1f_%.1f" % (x, z), [(0.05, 0.0), (0.08, -0.05), (0.26, -0.22), (0.27, -0.25)], (x, 6.55, z), M_STEEL,
          sides=18, tile_u=0.5, tile_v=0.5, cap_top=False, cap_bot=False)
    sphere("lamp_bulb_%.1f_%.1f" % (x, z), (x, 6.35, z), 0.07, M_BULB, seg=10, rings=6)
# back wall details: fuse panels (JP meters atlas), pipes, stencil
for k, x in enumerate((-6.0, -3.8, 3.8, 6.0)):
    K.inst("meter3", "bw_meter_%d" % k, (x, 1.3, -16.97), K.face_yaw((0, 0, 1), Vector((0, -1, 0))), 1.3, pivot="bottom")
pipe("bw_pipe_1", [(-17.0, 5.4, -16.75), (17.0, 5.4, -16.75)], 0.18, "green", fl_step=3.0)
pipe("bw_pipe_2", [(-17.0, 5.95, -16.8), (17.0, 5.95, -16.8)], 0.1, "red", fl_step=3.0)
front_quad("bw_stencil", -1.5, 1.5, 2.8, 3.55, -16.985, M_SIGN, atlas_uv(512, 384, 1023, 511))

# =============================================================== BUILD: cable trunks on the floor
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


cable_bundle("cab_l", [(-4.2, 0.0, -10.2), (-4.4, 0.0, -9.0), (-4.2, 0.0, -7.2), (-4.1, 0.0, -4.4), (-5.5, 0.0, -4.05),
                       (-7.6, 0.0, -4.0), (-8.6, 0.0, -3.9)], seed=11)
cable_bundle("cab_r", [(4.2, 0.0, -10.2), (4.3, 0.0, -8.6), (4.1, 0.0, -6.0), (4.15, 0.0, -4.4), (6.0, 0.0, -4.05),
                       (8.6, 0.0, -3.95)], seed=12)
cable_bundle("cab_desk", [(0.4, DH, -7.4), (1.9, DH, -8.0), (3.2, DH, -8.4), (3.75, DH - 0.2, -8.6), (3.9, 0.2, -8.7),
                          (4.2, 0.0, -8.9)], n=3, r=0.028, seed=13)
cable_bundle("cab_boiler", [(-8.6, 0.0, -3.9), (-10.0, 0.0, -5.5), (-10.6, 0.0, -9.0), (-11.0, 0.0, -10.2)], n=4, seed=14)

# =============================================================== crowd nodes
K.crowd_nodes()

# =============================================================== contact render (ENV_KIT 8.3) or main
if K.DO_CONTACT:
    keep = [o for o in K.COL_SET.objects if o.name.startswith(("vw_crt_3_2", "vw_crt_2_2", "boiler_", "desk_", "beacon_r", "bd_"))]
    for o in list(K.COL_SET.objects):
        if o not in keep:
            o.hide_render = True

    def move(prefix, off):
        for o in keep:
            if o.name.startswith(prefix):
                o.matrix_world = Matrix.Translation(G(*off)) @ o.matrix_world
    move("vw_crt_3_2", (1.0 - (vx0 + 2 * (VW + 0.06)), -row_y[3] + 0.9 + 0.0, 10.3))
    move("vw_crt_2_2", (1.0 - (vx0 + 2 * (VW + 0.06)), -row_y[2] + 0.43, 10.3))
    move("desk_", (4.2, -DH, 12.3 - 6.0 + 1.0))
    move("boiler_", (11.4 + 9.5, 0.06, 12.2 - 1.5))
    move("beacon_r", (-7.45 + 1.0, -3.05 + 2.4, 0.5))
    move("bd_", (-7.9 + 13.8, 0.0, 1.85 + 2.2))
    K.contact_render(keep, "control_room_contact.png", HDRI, span=16.0, cam_pos=[5.4, 2.8, 13.5], look=[5.4, 1.7, 0.0], fov=46.0)
else:
    if K.DO_EXPORT or not os.path.exists(os.path.join(K.GLTF_OUT, S["environment"]["hdr"])):
        K.env_map(HDRI, "control_room_env.hdr")
    if K.DO_RENDER:
        K.render_proofs([
            {"id": "overview", "pos": [11.0, 5.2, 12.5], "look": [0.0, 2.2, -7.0], "fov": 58.0},
            {"id": "wall_left", "pos": [-3.6, 1.7, 2.8], "look": [-8.0, 2.0, -0.6], "fov": 55.0},
            {"id": "wall_right", "pos": [3.8, 1.7, 2.6], "look": [8.0, 1.8, -1.0], "fov": 55.0},
            {"id": "desk_detail", "pos": [1.6, 2.4, -1.2], "look": [0.0, 2.3, -8.5], "fov": 50.0},
        ], [("Swat", "Swat.fbx", S["spawn"]["p1"][0], 1, 1.82), ("Ch40", "Ch40_nonPBR.fbx", S["spawn"]["p2"][0], -1, 1.9)])
    K.tri_report(["boiler_", "desk_", "vw_crt_0_0_", "vw_crt_", "sb_crt_", "beacon_l", "bd_", "mf_", "hw_", "dais_", "step_",
                  "rail_", "riser_", "lw_", "rw_", "cab_", "ceil_", "tray_", "lamp_"])
    if K.DO_EXPORT:
        K.export([(n, objs, PIVOT.get(n.replace("anim_spin_", ""), None)) for n, objs in DRESS.items()])
        K.write_fragment()
        if K.DO_FINISH:
            K.run_finish()
log("DONE")
