"""HIT PARADE - stage 4 CHANNEL 13 ROOFTOP, built headless in Blender (lane STAGES-B).

The show goes up on the roof of the CHANNEL 13 building on a wet night: a bitumen roof with puddles and a worn
painted station emblem; the fight strip runs between the brick stair bulkhead (splat wall x = -8) and the corrugated
elevator machine room (splat wall x = +8); steel crowd barricades, then temporary aluminium bleachers packed with the
crowd; a big neon HIT PARADE sign on a steel frame right behind them; lighting truss towers with floods, string lights
over the crowd; behind: rooftop units, a wooden water tank, a skylight, the station's lattice broadcast mast with red
aviation lights, the show's printed billboard; beyond the parapet the city skyline with lit windows under the
jp_Sky_Night_4a night sky; rain streaks in the air (node rain_fall, VIEW animates it).

Usage (blender.exe directly so the log is visible; paths are resolved from this file):
  blender.exe --background --python art/stages/rooftop.py -- [--no-export] [--no-render] [--no-art] [--no-finish]
        [--shots id,id] [--res 1920x1080] [--samples 48] [--no-fighters] [--contact]
Outputs:
  _harness/scratch/stages_cache/rooftop_raw.glb -> art/gltf/stages/rooftop.glb (stagefinish_b.py, chain D)
  art/gltf/stages/rooftop_env.hdr                  (512x256 IBL for the view, from jp_Sky_Night_4a.exr)
  art/stages/rooftop.stage.json                    (StageDef fragment, CONTRACT 21.2; STAGES-A merges it)
  _harness/_reports/stages/rooftop_<shot>.png      (proof renders from the game camera)
The StageDef below is the source of truth; the build reads it (lights, fog, crowd bays, proof cameras).
Sources (read-only): Poly Haven bitumen / bicolour_gravel / asbestos_sheet_02 (CC0); Japan Village (Unity EULA):
JP_Red_Brick, JP_Concrete, JP_Conditioner textures, JP_Conditioner_01/05/07, JP_Electric_Meter_01/02, JP_Hatch_01 models,
JP_Sky_Night_4a.exr (sky + IBL); FANTASTIC planks (EULA, stages cache); the game's OFL fonts (Bungee for the neon).
Everything else (bulkhead, machine room, barricades, bleachers, neon sign, truss + floods, string lights, rooftop units,
water tank, skylight, mast, billboard, skyline, rain) is procedural here; 2D art is art2d_b.py. ASCII only.
"""
import bpy
import bmesh
import sys
import os
import math
import json
from mathutils import Vector, Matrix
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True
import stagekit_b as K  # noqa: E402
from stagekit_b import G, gbox, obox, tube, cyl, sphere, lathe, quad, catenary, mat_pbr, mat_unlit, bolts  # noqa: E402

JP_SKY = K.JPT + "HDRI/JP_Sky_Night_4a.exr"

CAMERA = {
    "vFovDeg": 35.0, "heightM": 1.25, "lookAtY": 1.0, "distanceM": [4.36, 7.6], "pitchDeg": [-2.0, -4.0],
    "wallClampX": 8.0,
    "note": "FIGHTING_DESIGN 7b. Camera x is clamped so the splat wall sits at the screen edge on the fight line: "
            "|camX| <= wallClampX - distance * tan(hFov/2). Proof renders: _harness/_reports/stages/rooftop_*.png",
    "proofShots": [
        {"id": "near_center", "pos": [0.0, 1.25, 4.4], "look": [0.0, 1.0, 0.0]},
        {"id": "far_center", "pos": [0.0, 1.25, 7.6], "look": [0.0, 1.0, 0.0]},
        {"id": "near_corner_r", "pos": [5.53, 1.25, 4.4], "look": [5.53, 1.0, 0.0]},
        {"id": "far_corner_l", "pos": [-3.74, 1.25, 7.6], "look": [-3.74, 1.0, 0.0]},
        {"id": "far_center_phone", "pos": [0.0, 1.25, 6.22], "look": [0.0, 1.0, 0.0], "aspect": 2.1667},
    ],
}

STAGE = {
    "id": "rooftop",
    "name": "CHANNEL 13 ROOFTOP",
    "status": "built",
    "glb": "rooftop.glb",
    "source": "art/stages/rooftop.py",
    "home": ["patch", "spin", "gazza"],
    "look": "the show on the roof of the CHANNEL 13 building on a wet night: bitumen roof with puddles and a worn painted "
            "13 emblem between a brick stair bulkhead and a corrugated machine room; steel barricades, aluminium bleachers "
            "packed with the crowd, a big neon HIT PARADE sign, truss floods and string lights; rooftop units, a wooden "
            "water tank, the station's lattice mast, the show billboard; the lit city skyline under a purple night sky; rain",
    "floor": {"y": 0.0, "surface": "wet_bitumen", "fightStrip": {"x": [-8.0, 8.0], "z": [-1.5, 1.5]},
              "extent": {"x": [-32.0, 32.0], "z": [-30.0, 9.0]}},
    "walls": {
        "x": [-8.0, 8.0],
        "splat": [
            {"id": 0, "x": -8.0, "normal": [1, 0, 0], "z": [-3.4, 3.4], "heightM": 3.55, "surface": "red_brick",
             "dustColor": "#8a5c50"},
            {"id": 1, "x": 8.0, "normal": [-1, 0, 0], "z": [-3.4, 3.4], "heightM": 3.95, "surface": "corrugated_steel",
             "dustColor": "#7d8986"},
        ],
        "note": "WALL_SPLAT event b = wall id (0 = x -8 stair bulkhead, 1 = x +8 machine room), CONTRACT 17.6",
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
        {"id": "key", "type": "directional", "color": "#aebfff", "intensity": 2.3,
         "position": [-6.0, 11.0, 9.0], "target": [0.0, 1.0, 0.0], "castShadow": True,
         "shadow": {"mapSize": 1024, "bias": -0.0004, "normalBias": 0.03,
                    "camera": {"left": -10.0, "right": 10.0, "top": 7.0, "bottom": -4.0, "near": 1.0, "far": 30.0}}},
        {"id": "rim", "type": "directional", "color": "#ff66b8", "intensity": 1.15,
         "position": [3.0, 6.0, -12.0], "target": [0.0, 1.2, 0.0], "castShadow": False},
        {"id": "fill", "type": "hemisphere", "sky": "#3a4786", "ground": "#1e1822", "intensity": 0.95},
        {"id": "neon", "type": "point", "color": "#ff3d9a", "intensity": 22.0, "distance": 11.0, "decay": 2,
         "position": [0.0, 3.9, -7.6], "flicker": {"amp": 0.06, "hz": 11.0}},
        {"id": "flood_l", "type": "spot", "color": "#fff0d6", "intensity": 240.0, "distance": 24.0, "decay": 2,
         "position": [-9.0, 4.1, -8.3], "target": [-1.2, 0.6, 0.0], "angleDeg": 24.0, "penumbra": 0.55},
        {"id": "flood_r", "type": "spot", "color": "#fff0d6", "intensity": 240.0, "distance": 24.0, "decay": 2,
         "position": [9.0, 4.1, -8.3], "target": [1.2, 0.6, 0.0], "angleDeg": 24.0, "penumbra": 0.55},
        {"id": "door_lamp", "type": "point", "color": "#ffb46a", "intensity": 5.0, "distance": 6.0, "decay": 2,
         "position": [-7.62, 2.8, -0.85], "flicker": {"amp": 0.08, "hz": 9.0}},
    ],
    "lightsNote": "FIXED pool: created once at stage load, never added/removed (shader programs stay warm). "
                  "No lights are embedded in the GLB. Flicker = view-only intensity modulation.",
    "crowd": {
        "atlas": "crowd_atlas.webp", "meta": "crowd_atlas.json", "cols": 12, "rows": 6, "count": 72,
        "cardHeightM": 2.4, "cardWidthM": 1.2, "anchor": [0.5, 0.97917],
        "tint": "#c0bce4", "brightness": 0.44,
        "moods": {"idle": ["watch"], "cheer": ["cheer", "hype"], "jeer": ["jeer"]},
        "nodes": "GLB empties crowd_<bay>_<row>_<i>: position = feet point, +Z = card facing, uniform scale = card "
                 "height; extras {bay,row,i,rand,angle}. Generated from the bays below (rows run along world X; "
                 "x step = spacing, jitter = [x,z] half-ranges from mulberry32(seed); gapPct = share of empty spots).",
        "bays": [
            {"id": "stand", "x": [-15.2, 15.2], "spacing": 0.62, "jitter": [0.12, 0.06], "faceYawDeg": 0.0,
             "rows": [{"z": -4.62, "y": 0.3}, {"z": -5.47, "y": 0.6}, {"z": -6.32, "y": 0.9}, {"z": -7.17, "y": 1.2}],
             "seed": 4101, "gapPct": 0.05},
        ],
    },
    "music": "music_stage_rooftop",
    "musicHint": "AUDIO lane cue 'rooftop' (runtime/src/audio/manifest.ts music_rooftop)",
    "ambient": "amb_rooftop_rain",
    "ambientHint": "rain on the roof and on the bleachers, distant traffic and sirens below, crowd bed following SHOWTIME",
    "dressing": {
        "animated": [
            {"what": "rain", "nodes": "rain_fall",
             "how": "REQUEST to VIEW: node.position.y = -((t * 9.0) % 10.0). The streak cards repeat every 10 m in y "
                    "(y 0..20), so the wrap is seamless; unlit BLEND material (fogged). Static until VIEW adds it."},
            {"what": "string lights", "nodes": "string_bulbs", "how": "optional twinkle / chase on emissive intensity"},
            {"what": "LIVE neon", "nodes": "anim_flicker_live", "how": "existing view hook anim_flicker_* (stage.ts)"},
            {"what": "crowd", "how": "instanced cards, vertex bob/sway, pose swaps by ratings mood"},
        ],
        "splatWallDust": ["#8a5c50", "#7d8986"],
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
M_SIGN = mat_pbr("rt13_sign", "rt13_signs", roughness=0.45)
M_SIGNLIT = mat_pbr("rt13_signlit", "rt13_signs", roughness=0.4, etex="rt13_signs", estrength=2.0)
M_BILL = mat_pbr("rt13_billboard", "rt13_billboard", roughness=0.55, etex="rt13_billboard", estrength=0.7)
M_NEON_P = mat_pbr("rt13_neon_pink", color=(1.0, 0.3, 0.62, 1), roughness=0.25, emission=(1.0, 0.13, 0.48, 1), estrength=7.0)
M_NEON_Y = mat_pbr("rt13_neon_yellow", color=(1.0, 0.8, 0.3, 1), roughness=0.25, emission=(1.0, 0.62, 0.1, 1), estrength=5.0)
M_NEON_B = mat_pbr("rt13_neon_blue", color=(0.4, 0.7, 1.0, 1), roughness=0.25, emission=(0.18, 0.5, 1.0, 1), estrength=6.0)
M_BULB = mat_pbr("rt13_bulb", color=(1.0, 0.86, 0.62, 1), roughness=0.3, emission=(1.0, 0.7, 0.38, 1), estrength=4.5)
M_LENS = mat_pbr("rt13_lens", color=(1.0, 0.95, 0.85, 1), roughness=0.2, emission=(1.0, 0.9, 0.72, 1), estrength=2.0)
M_RED = mat_pbr("rt13_redlamp", color=(1.0, 0.1, 0.06, 1), roughness=0.3, emission=(1.0, 0.06, 0.03, 1), estrength=7.0)
M_GLASS = mat_pbr("rt13_glass", color=(0.025, 0.03, 0.038, 1), roughness=0.06)
M_SKYLIT = mat_pbr("rt13_skylight", color=(0.1, 0.08, 0.06, 1), roughness=0.1, emission=(1.0, 0.7, 0.42, 1), estrength=0.9)
M_RUBBER = mat_pbr("rt13_rubber", color=(0.022, 0.022, 0.025, 1), roughness=0.5)
M_WIN = mat_unlit("rt13_windows", "rt13_windows")
M_CITYROOF = mat_pbr("rt13_cityroof", color=(0.018, 0.018, 0.026, 1), roughness=0.9)
M_RAIN = mat_unlit("rt13_rain", "rt13_rain", alpha="BLEND", double=True)

DRESS = {"rain_fall": [], "string_bulbs": [], "anim_flicker_live": []}


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
    """horizontal quad facing +Y; uv order = (x0,z1) (x1,z1) (x1,z0) (x0,z0) -> image top toward -z (reads from the camera)"""
    ob = quad(name, [(x0, y, z1), (x1, y, z1), (x1, y, z0), (x0, y, z0)], mat, uv)
    me = ob.data
    if me.polygons[0].normal.z < 0:
        me.flip_normals()
    return ob


def wall_quad(name, x, y0, y1, z0, z1, mat, uv, facing):
    """vertical quad on a wall plane x = const, facing +x (facing=1) or -x; uv = (u0, v0, u1, v1), image upright"""
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


def front_quad(name, x0, x1, y0, y1, z, mat, uv=(0, 0, 1, 1)):
    """vertical quad facing +Z (the camera); uv = (u0, v0, u1, v1)"""
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
            if k % 2 == 0:
                pts.append((ax, yy, az))
            else:
                pts.append((bx, yy, bz))
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
    # cooling fins: rings along the body
    for k in range(4):
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
    # lens bezel ring
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, cap_tris=False, segments=16, radius1=0.19, radius2=0.19, depth=0.05)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=q.to_matrix())
    bmesh.ops.translate(bm, verts=bm.verts, vec=lens + q @ Vector((0, 0, 0.012)))
    K.finish(bm, name + "_bezel", [body_mat], tile=0.5)
    # yoke
    p = pos_g
    tube(name + "_yoke", [(p[0] - 0.21, p[1], p[2]), (p[0] - 0.21, p[1] - 0.28, p[2]), (p[0] + 0.21, p[1] - 0.28, p[2]),
                          (p[0] + 0.21, p[1], p[2])], 0.016, M_STEEL, sides=6)


# =============================================================== BUILD: roof deck, puddles, emblem
log("build roof")
gbox("roof", -32.0, 32.0, -0.3, 0.0, -31.0, 9.0, M_ROOF, tile=3.0)
for (x0, x1, z0, z1) in ((-16.5, 16.5, -12.6, -8.0), (-32.0, 32.0, -30.0, -27.4), (-16.8, -12.0, -3.2, 3.8),
                         (12.2, 16.8, -3.2, 3.8), (-13.2, -7.2, -20.6, -14.6), (9.6, 18.4, -24.4, -17.8)):
    gbox("gravel_%.0f_%.0f" % (x0, z0), x0, x1, 0.0, 0.035, z0, z1, M_GRAVEL, tile=1.6, bevel=0.012, segs=1)
# concrete walkway pavers through the gravel behind the bleachers
for i in range(9):
    z = -8.3 - i * 0.66
    for x in (-0.62, 0.0, 0.62):
        gbox("paver_%d_%.1f" % (i, x), x - 0.29, x + 0.29, 0.0, 0.055, z - 0.29, z + 0.29, M_CONC, tile=1.2, bevel=0.01, segs=1)
PUDDLES = [(-5.4, 0.7, 0.95, 0.55, 0.3), (-1.9, -2.0, 1.25, 0.5, -0.1), (2.6, 1.7, 0.8, 0.45, 0.6), (5.9, -1.1, 1.1, 0.6, 0.2),
           (1.9, 3.4, 0.9, 0.38, 0.05), (-6.9, 2.9, 0.7, 0.4, -0.5), (4.8, -2.9, 0.9, 0.35, 0.0), (-3.6, 2.4, 0.5, 0.3, 1.0),
           (7.2, 2.6, 0.6, 0.45, 0.4), (-9.6, -1.0, 0.8, 0.5, 0.2), (10.6, 1.4, 0.7, 0.45, -0.3)]
for i, (cx, cz, rx, rz, rot) in enumerate(PUDDLES):
    puddle(i, cx, cz, rx, rz, rot)
flat_quad("emblem", -2.4, 2.4, -2.4, 2.4, 0.006, M_EMBLEM)

# =============================================================== BUILD: stair bulkhead (splat wall x = -8)
log("build bulkhead")
XB0, XB1, ZB0, ZB1 = -12.0, -8.0, -3.4, 3.4
ZD = -1.9           # door centre
gbox("bh_plinth_a", -12.1, -7.93, 0.0, 0.32, ZB0 - 0.1, ZD - 0.6, M_CONC, tile=1.5, bevel=0.02)
gbox("bh_plinth_b", -12.1, -7.93, 0.0, 0.32, ZD + 0.6, ZB1 + 0.1, M_CONC, tile=1.5, bevel=0.02)
gbox("bh_brick", XB0, XB1, 0.32, 3.55, ZB0, ZB1, M_BRICK, tile=1.4)
gbox("bh_brick_door_low", XB0, XB1 - 0.02, 0.0, 0.32, ZD - 0.6, ZD + 0.6, M_BRICK, tile=1.4)
gbox("bh_coping", XB0 - 0.08, XB1 + 0.07, 3.55, 3.76, ZB0 - 0.08, ZB1 + 0.08, M_CONC, tile=1.5, bevel=0.03)
# door: steel frame (4 cm proud), recessed slab, push bar, kick plate, hinges, wired-glass vision panel
gbox("door_jamb_a", -8.0, -7.955, 0.0, 2.24, ZD - 0.6, ZD - 0.52, M_STEEL, tile=1.0, bevel=0.008)
gbox("door_jamb_b", -8.0, -7.955, 0.0, 2.24, ZD + 0.52, ZD + 0.6, M_STEEL, tile=1.0, bevel=0.008)
gbox("door_head", -8.0, -7.955, 2.16, 2.24, ZD - 0.6, ZD + 0.6, M_STEEL, tile=1.0, bevel=0.008)
gbox("door_slab", -8.0, -7.978, 0.015, 2.16, ZD - 0.52, ZD + 0.52, M_DOOR, tile=1.2, bevel=0.005)
gbox("door_kick", -7.978, -7.972, 0.03, 0.3, ZD - 0.49, ZD + 0.49, M_ALU, tile=0.6)
gbox("door_glass_frame", -7.978, -7.968, 1.38, 1.9, ZD + 0.05, ZD + 0.37, M_STEEL, tile=0.5, bevel=0.004)
gbox("door_glass", -7.968, -7.965, 1.42, 1.86, ZD + 0.09, ZD + 0.33, M_GLASS, tile=0.5)
tube("door_bar", [(-7.93, 1.02, ZD - 0.42), (-7.93, 1.02, ZD + 0.34)], 0.018, M_ALU, sides=8)
for zb in (ZD - 0.4, ZD + 0.32):
    tube("door_bar_bk_%.2f" % zb, [(-7.975, 1.02, zb), (-7.93, 1.02, zb)], 0.012, M_ALU, sides=6)
for yh in (0.3, 1.1, 1.9):
    cyl("door_hinge_%.1f" % yh, (-7.95, yh, ZD - 0.535), (0, 1, 0), 0.016, 0.12, M_STEEL, sides=8)
bolts("door_bolts", [(-7.955, y, z) for y in (0.08, 1.1, 2.12) for z in (ZD - 0.56, ZD + 0.56)], (1, 0, 0), M_STEEL, r=0.012)
wall_quad("door_plate", -7.97, 1.95, 2.1, ZD - 0.3, ZD - 0.02, M_SIGN, atlas_uv(256, 256, 512, 383), 1)
# EXIT box sign over the door
gbox("exit_box", -8.0, -7.9, 2.34, 2.54, ZD - 0.22, ZD + 0.22, M_STEEL, tile=0.5, bevel=0.01)
wall_quad("exit_face", -7.892, 2.36, 2.52, ZD - 0.2, ZD + 0.2, M_SIGNLIT, atlas_uv(0, 256, 256, 383), 1)
# caged bulkhead lamp + conduit
LZ = -0.85
cyl("lamp_base", (-7.975, 2.8, LZ), (1, 0, 0), 0.09, 0.05, M_STEEL, sides=16, bevel=0.008)
sphere("lamp_glass", (-7.9, 2.8, LZ), 0.075, M_BULB, seg=12, rings=8, scale=(0.8, 1.0, 1.0))
for k in range(6):
    a = k * math.pi / 3
    tube("lamp_cage_%d" % k, [(-7.95, 2.8 + 0.085 * math.sin(a), LZ + 0.085 * math.cos(a)),
                              (-7.83, 2.8 + 0.07 * math.sin(a), LZ + 0.07 * math.cos(a)),
                              (-7.81, 2.8, LZ)], 0.005, M_STEEL, sides=4, caps=False)
tube("lamp_cage_ring", [(-7.88, 2.8 + 0.09 * math.sin(a), LZ + 0.09 * math.cos(a)) for a in np.linspace(0, 2 * math.pi, 13)],
     0.005, M_STEEL, sides=4, caps=False)
tube("conduit_lamp", [(-7.975, 2.86, LZ), (-7.975, 3.3, LZ), (-7.975, 3.3, 2.55), (-7.975, 1.7, 2.55)], 0.022, M_STEEL, sides=8)
tube("conduit_run2", [(-7.97, 3.18, ZB0 + 0.2), (-7.97, 3.18, LZ - 0.2), (-7.97, 2.95, LZ - 0.2)], 0.018, M_STEEL, sides=8)
for zc in (-2.8, -1.3, 0.2, 1.4, 2.4):
    gbox("conduit_strap_%.1f" % zc, -7.99, -7.945, 3.26, 3.34, zc - 0.03, zc + 0.03, M_STEEL, tile=0.3)
K.template("meter1", K.JPM + "Props/JP_Electric_Meter_01.fbx", mat=mat_pbr("rt13_meters", "rt13_meters_a", "rt13_meters_n",
                                                                           "rt13_meters_r"))
# downpipe with bends + shoe
tube("downpipe", [(-8.08, 3.56, -3.15), (-7.92, 3.4, -3.15), (-7.92, 0.35, -3.15), (-7.8, 0.12, -3.15), (-7.62, 0.08, -3.15)],
     0.045, M_STEEL, sides=10)
for yb in (0.9, 1.9, 2.9):
    gbox("downpipe_bracket_%.1f" % yb, -8.0, -7.86, yb - 0.02, yb + 0.02, -3.21, -3.09, M_STEEL, tile=0.3)
# posters (atlas) pasted on the wall
wall_quad("poster_1", -7.99, 1.0, 2.3, -0.05, 0.82, M_SIGN, atlas_uv(0, 512, 341, 1024), 1)
wall_quad("poster_2", -7.988, 0.95, 2.25, 1.02, 1.89, M_SIGN, atlas_uv(341, 512, 682, 1024), 1)
wall_quad("caution_plate", -7.99, 1.45, 1.75, -3.0, -2.62, M_SIGN, atlas_uv(0, 384, 255, 511), 1)
# string-light mast on the bulkhead roof
tube("mast_l", [(-8.35, 3.76, -3.2), (-8.35, 5.25, -3.2)], 0.04, M_STEEL, sides=10)
tube("mast_l_stay", [(-8.35, 5.0, -3.2), (-10.5, 3.76, -3.2)], 0.008, M_STEEL, sides=4)

# =============================================================== BUILD: machine room (splat wall x = +8)
log("build machine room")
XM0, XM1 = 8.0, 12.2
gbox("mr_plinth", 7.93, 12.3, 0.0, 0.3, ZB0 - 0.1, ZB1 + 0.1, M_CONC, tile=1.5, bevel=0.02)
gbox("mr_clad", XM0, XM1, 0.3, 3.95, ZB0, ZB1, M_CORR, tile=1.8)
gbox("mr_cap", 7.94, 12.26, 3.95, 4.1, ZB0 - 0.06, ZB1 + 0.06, M_STEEL, tile=1.0, bevel=0.012)
for zc in (ZB0, ZB1):
    gbox("mr_corner_%.1f" % zc, 7.955, 8.06, 0.3, 3.95, zc - 0.06, zc + 0.06, M_STEEL, tile=0.6, bevel=0.006)
for zc in (-1.7, 0.0, 1.7):
    gbox("mr_joint_%.1f" % zc, 7.985, 8.0, 0.3, 3.95, zc - 0.035, zc + 0.035, M_STEEL, tile=0.6)
    bolts("mr_joint_bolts_%.1f" % zc, [(7.985, 0.5 + 0.45 * k, zc) for k in range(8)], (-1, 0, 0), M_STEEL, r=0.011)
# louvre vent
LV = (0.55, 2.15, 2.05, 3.25)       # z0, z1, y0, y1
gbox("louvre_frame_t", 7.93, 8.0, LV[3] - 0.06, LV[3], LV[0], LV[1], M_STEEL, tile=0.6, bevel=0.006)
gbox("louvre_frame_b", 7.93, 8.0, LV[2], LV[2] + 0.06, LV[0], LV[1], M_STEEL, tile=0.6, bevel=0.006)
gbox("louvre_frame_l", 7.93, 8.0, LV[2], LV[3], LV[0], LV[0] + 0.06, M_STEEL, tile=0.6, bevel=0.006)
gbox("louvre_frame_r", 7.93, 8.0, LV[2], LV[3], LV[1] - 0.06, LV[1], M_STEEL, tile=0.6, bevel=0.006)
gbox("louvre_back", 7.995, 8.0, LV[2], LV[3], LV[0], LV[1], M_RUBBER, tile=0.5)
for k in range(9):
    yy = LV[2] + 0.12 + k * 0.12
    obox("louvre_slat_%d" % k, (7.965, yy, (LV[0] + LV[1]) / 2), (0.09, 0.008, LV[1] - LV[0] - 0.12), M_STEEL,
         yaw_deg=0.0, roll_deg=-35.0, tile=0.5)
# electrics + DANGER plate
K.template("meter2", K.JPM + "Props/JP_Electric_Meter_02.fbx", mat=bpy.data.materials["rt13_meters"])
K.inst("meter2", "meter2_mr", (7.98, 1.0, -2.3), K.face_yaw((-1, 0, 0), Vector((0, -1, 0))), 1.0, pivot="bottom")
K.inst("meter1", "meter1_mr", (7.98, 1.15, -2.9), K.face_yaw((-1, 0, 0), Vector((0, -1, 0))), 1.0, pivot="bottom")
K.inst("meter1", "meter1_bh", (-7.98, 1.2, 2.55), K.face_yaw((1, 0, 0), Vector((0, -1, 0))), 1.0, pivot="bottom")
wall_quad("danger_plate", 7.982, 1.55, 2.0, -0.95, -0.05, M_SIGN, atlas_uv(512, 0, 1023, 255), -1)
wall_quad("crew_plate", 7.982, 1.0, 1.35, 2.45, 3.1, M_SIGN, atlas_uv(512, 320, 1023, 511), -1)
tube("mr_conduit", [(7.975, 1.55, -2.3), (7.975, 3.6, -2.3), (7.975, 3.6, 3.2)], 0.022, M_STEEL, sides=8)
tube("mr_pipe", [(7.96, 0.3, 3.0), (7.96, 0.9, 3.0), (7.8, 0.9, 3.0)], 0.03, M_ALU, sides=8)
tube("mast_r", [(8.35, 4.1, -3.2), (8.35, 5.45, -3.2)], 0.04, M_STEEL, sides=10)
tube("mast_r_stay", [(8.35, 5.2, -3.2), (10.6, 4.1, -3.2)], 0.008, M_STEEL, sides=4)

# =============================================================== BUILD: barricades
log("build barricades")
ZBAR = -3.78
SEGS = [-6.72, -4.48, -2.24, 0.0, 2.24, 4.48, 6.72]
for si, cx in enumerate(SEGS):
    hw = 1.08
    tube("bar_top_%d" % si, [(cx - hw, 1.08, ZBAR), (cx + hw, 1.08, ZBAR)], 0.019, M_ALU, sides=8)
    tube("bar_bot_%d" % si, [(cx - hw, 0.16, ZBAR), (cx + hw, 0.16, ZBAR)], 0.017, M_ALU, sides=8)
    for s in (-1, 1):
        tube("bar_post_%d_%d" % (si, s), [(cx + s * hw, 0.05, ZBAR), (cx + s * hw, 1.08, ZBAR)], 0.019, M_ALU, sides=8)
        obox("bar_foot_%d_%d" % (si, s), (cx + s * 0.86, 0.008, ZBAR), (0.05, 0.016, 0.72), M_STEEL, tile=0.5, bevel=0.003)
        tube("bar_leg_%d_%d" % (si, s), [(cx + s * 0.86, 0.16, ZBAR), (cx + s * 0.86, 0.016, ZBAR)], 0.012, M_ALU, sides=6)
    nb = 14
    for k in range(1, nb):
        x = cx - hw + 2 * hw * k / nb
        tube("bar_rod_%d_%d" % (si, k), [(x, 0.16, ZBAR), (x, 1.08, ZBAR)], 0.008, M_ALU, sides=5, caps=False)
    if si in (1, 3, 5):
        front_quad("bar_banner_%d" % si, cx - 0.98, cx + 0.98, 0.28, 0.98, ZBAR + 0.03, M_SIGN, atlas_uv(512, 320, 1023, 511))

# =============================================================== BUILD: aluminium bleachers
log("build bleachers")
BX = 15.6
TIERS = []
for k in range(4):
    y = 0.3 * (k + 1)
    zf = -4.2 - 0.85 * k
    TIERS.append((y, zf, zf - 0.85))
for k, (y, zf, zb) in enumerate(TIERS):
    gbox("tread_a_%d" % k, -BX, BX, y - 0.05, y, zf - 0.40, zf - 0.02, M_ALU, tile=1.0, bevel=0.008, segs=1)
    gbox("tread_b_%d" % k, -BX, BX, y - 0.05, y, zb + 0.02, zf - 0.45, M_ALU, tile=1.0, bevel=0.008, segs=1)
    gbox("riser_%d" % k, -BX, BX, y - 0.3, y - 0.05, zf - 0.02, zf, M_STEEL, tile=1.2)
    for x in np.arange(-BX, BX + 0.01, 2.6):
        gbox("bl_post_%d_%.1f" % (k, x), x - 0.03, x + 0.03, 0.0, y - 0.05, zf - 0.43, zf - 0.37, M_STEEL, tile=0.5)
        gbox("bl_post2_%d_%.1f" % (k, x), x - 0.03, x + 0.03, 0.0, y - 0.05, zb + 0.03, zb + 0.09, M_STEEL, tile=0.5)
gbox("bl_back", -BX, BX, 0.0, 1.2, TIERS[-1][2] - 0.02, TIERS[-1][2], M_STEEL, tile=1.2)
for x in np.arange(-BX, BX + 0.01, 2.0):
    tube("bl_rail_post_%.1f" % x, [(x, 1.2, -7.63), (x, 2.26, -7.63)], 0.022, M_ALU, sides=8)
for yr in (1.72, 2.26):
    tube("bl_rail_%.2f" % yr, [(-BX, yr, -7.63), (BX, yr, -7.63)], 0.022, M_ALU, sides=8)
# hazard stripe edge on the tier-0 riser (atlas band 512..1024 x 256..320 px, one quad per 2 m: a sub-rect cannot repeat)
for k in range(int(2 * BX / 2.0)):
    x = -BX + 2.0 * k
    front_quad("tier0_stripes_%d" % k, x, x + 2.0, 0.03, 0.2, -4.19, M_SIGN, atlas_uv(512, 256, 1023, 319))

# =============================================================== BUILD: neon HIT PARADE sign (hero)
log("build neon sign")
NZ = -8.25
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
# backing raceways behind each word (dark boxes) + tube standoffs
vs = [v.co for v in neon_main.data.vertices]
nx0, nx1 = min(v.x for v in vs), max(v.x for v in vs)
ny0, ny1 = min(v.z for v in vs), max(v.z for v in vs)
log("neon letters bbox x %.2f..%.2f y %.2f..%.2f" % (nx0, nx1, ny0, ny1))
gbox("neon_raceway", nx0 - 0.1, nx1 + 0.1, ny0 + 0.28, ny0 + 0.44, NZ + 0.02, NZ + 0.1, M_STEEL, tile=1.0, bevel=0.01)
gbox("neon_transformer_l", nx0 - 0.5, nx0 - 0.15, 3.05, 3.4, NZ - 0.02, NZ + 0.14, M_RTU, tile=0.5, bevel=0.012)
gbox("neon_transformer_r", nx1 + 0.15, nx1 + 0.5, 3.05, 3.4, NZ - 0.02, NZ + 0.14, M_RTU, tile=0.5, bevel=0.012)
# yellow neon underline (zig-zag bolt) + blue LIVE box (flickers, view hook)
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
tube("neon_live_post", [((lb[0] + lb[1]) / 2, lb[2] - 0.05, NZ + 0.05), ((lb[0] + lb[1]) / 2, 4.85, NZ + 0.05)], 0.025, M_STEEL, sides=6)

# =============================================================== BUILD: truss towers + floods
log("build truss + floods")
for s in (-1, 1):
    tx, tz = s * 9.3, -8.8
    box_truss("truss_%d" % s, tx, tz, 0.06, 7.0)
    gbox("truss_base_%d" % s, tx - 0.45, tx + 0.45, 0.0, 0.06, tz - 0.45, tz + 0.45, M_STEEL, tile=0.8, bevel=0.01)
    for (dx, dz) in ((-0.62, 0.0), (0.62, 0.0), (0.0, -0.62), (0.0, 0.62)):
        gbox("truss_ballast_%d_%.1f_%.1f" % (s, dx, dz), tx + dx - 0.2, tx + dx + 0.2, 0.0, 0.32, tz + dz - 0.2, tz + dz + 0.2,
             M_CONC, tile=0.8, bevel=0.015)
    for k, yy in enumerate((3.4, 4.1, 4.8)):
        tx2 = tx - s * 0.32
        tube("flood_arm_%d_%d" % (s, k), [(tx, yy + 0.3, tz), (tx2, yy + 0.3, tz + 0.1)], 0.02, M_STEEL, sides=6)
        spotcan("flood_%d_%d" % (s, k), (tx2, yy, tz + 0.1), (s * (1.0 + 0.6 * k), 0.8, 0.0))
    gbox("truss_cap_%d" % s, tx - 0.24, tx + 0.24, 7.0, 7.06, tz - 0.24, tz + 0.24, M_STEEL, tile=0.5, bevel=0.005)
    sphere("truss_beacon_%d" % s, (tx, 7.15, tz), 0.09, M_RED, seg=10, rings=6)

# =============================================================== BUILD: string lights
log("build string lights")
STRANDS = [((-8.35, 5.15, -3.2), (8.35, 5.35, -3.2), 1.25), ((-8.35, 5.15, -3.2), (9.3, 6.6, -8.8), 1.1),
           ((8.35, 5.35, -3.2), (-9.3, 6.6, -8.8), 1.1), ((-9.3, 6.75, -8.8), (9.3, 6.75, -8.8), 1.2)]
nb_total = 0
for si, (p0, p1, sag) in enumerate(STRANDS):
    pts = catenary(p0, p1, sag, 40)
    tube("strand_%d" % si, pts, 0.006, M_RUBBER, sides=4, caps=False)
    L = sum((Vector(pts[i + 1]) - Vector(pts[i])).length for i in range(len(pts) - 1))
    n = int(L / 0.55)
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

# =============================================================== BUILD: rooftop units (hero), AC units, vents, hatch
log("build rooftop units")


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
    # access panels on the front (+z) face
    for k, (px0, px1) in enumerate(((-1.5, -0.55), (-0.45, 0.45), (0.55, 1.5))):
        gbox(name + "_panel_%d" % k, cx + px0, cx + px1, y0 + 0.12, y0 + H - 0.12, cz + D / 2, cz + D / 2 + 0.012, M_RTU,
             tile=1.0, bevel=0.006, segs=1)
        tube(name + "_handle_%d" % k, [(cx + px1 - 0.1, y0 + 0.62, cz + D / 2 + 0.012), (cx + px1 - 0.1, y0 + 0.62, cz + D / 2 + 0.05),
                                       (cx + px1 - 0.1, y0 + 0.86, cz + D / 2 + 0.05), (cx + px1 - 0.1, y0 + 0.86, cz + D / 2 + 0.012)],
             0.011, M_ALU, sides=6)
        bolts(name + "_pbolts_%d" % k, [(cx + x, y, cz + D / 2 + 0.012) for x in (px0 + 0.05, px1 - 0.05)
                                         for y in (y0 + 0.17, y0 + H - 0.17)], (0, 0, 1), M_STEEL, r=0.012)
    # louvre band on the side facing the fight
    sx = cx + flip * (L / 2 + 0.005)
    for k in range(8):
        obox(name + "_lv_%d" % k, (sx, y0 + 0.25 + k * 0.13, cz), (0.07, 0.008, D - 0.3), M_STEEL, yaw_deg=0.0,
             roll_deg=flip * 38.0, tile=0.5)
    # condenser fans on the lid
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
    # supply duct into the roof
    dx = cx - flip * (L / 2 + 0.45)
    gbox(name + "_duct", dx - 0.35, dx + 0.35, 0.0, y0 + 0.9, cz - 0.4, cz + 0.4, M_ALU, tile=0.8, bevel=0.012)
    gbox(name + "_duct_top", dx - 0.35, cx - flip * (L / 2), y0 + 0.55, y0 + 0.9, cz - 0.4, cz + 0.4, M_ALU, tile=0.8, bevel=0.012)
    for fy in (0.3, 0.75):
        gbox(name + "_flange_%.2f" % fy, dx - 0.38, dx + 0.38, fy, fy + 0.03, cz - 0.43, cz + 0.43, M_STEEL, tile=0.5)


rtu("rtu_r", 12.9, -11.6, flip=-1)
rtu("rtu_l", -13.4, -12.8, flip=1)
AC_MAT = M_AC
for key, f in (("ac1", "JP_Conditioner_01"), ("ac5", "JP_Conditioner_05"), ("ac7", "JP_Conditioner_07")):
    K.template(key, K.JPM + "Environment/%s.fbx" % f, mat=AC_MAT)


def dunnage(name, x0, x1, z, y=0.28):
    for dz in (-0.3, 0.3):
        gbox(name + "_beam_%.1f" % dz, x0, x1, y - 0.12, y, z + dz - 0.05, z + dz + 0.05, M_STEEL, tile=1.0, bevel=0.006)
    for x in np.arange(x0 + 0.2, x1, 1.2):
        gbox(name + "_leg_%.1f" % x, x - 0.05, x + 0.05, 0.0, y - 0.12, z - 0.35, z + 0.35, M_STEEL, tile=0.5)
        gbox(name + "_pad_%.1f" % x, x - 0.18, x + 0.18, 0.0, 0.04, z - 0.42, z + 0.42, M_RUBBER, tile=0.5)


dunnage("dun_l", -16.2, -12.2, -9.6)
for k, (key, x) in enumerate((("ac1", -15.5), ("ac5", -14.4), ("ac7", -13.2))):
    K.inst(key, "ac_l_%d" % k, (x, 0.28, -9.6), K.face_yaw((0, 0, 1), Vector((-1, 0, 0))), 1.0)
dunnage("dun_r", 13.2, 16.4, -9.2)
for k, (key, x) in enumerate((("ac5", 14.0), ("ac1", 15.3))):
    K.inst(key, "ac_r_%d" % k, (x, 0.28, -9.2), K.face_yaw((0, 0, 1), Vector((-1, 0, 0))), 1.0)
# tubing from the AC units into the roof
for x in (-15.5, -14.4, -13.2):
    tube("ac_line_%.1f" % x, [(x, 0.5, -9.9), (x, 0.5, -10.3), (x, 0.06, -10.5), (x + 0.3, 0.06, -11.4)], 0.022, M_RUBBER, sides=6)


def vent(name, x, z, h=1.1, r=0.16):
    lathe(name, [(r * 1.5, 0.0), (r * 1.5, 0.05), (r, 0.06), (r, h), (r * 1.05, h + 0.02), (r * 1.05, h + 0.06)], (x, 0.0, z),
          M_ALU, sides=16, tile_u=0.5, tile_v=0.5, cap_top=False)
    lathe(name + "_cap", [(0.0, h + 0.3), (r * 2.1, h + 0.14), (r * 2.0, h + 0.12)], (x, 0.0, z), M_STEEL, sides=16,
          tile_u=0.5, tile_v=0.5, cap_bot=True)
    for a in (0.0, 2.1, 4.2):
        tube(name + "_leg%.1f" % a, [(x + r * math.cos(a), h + 0.02, z + r * math.sin(a)),
                                     (x + r * 1.7 * math.cos(a), h + 0.15, z + r * 1.7 * math.sin(a))], 0.008, M_STEEL, sides=4)


for i, (x, z, h) in enumerate(((-4.2, -12.4, 1.2), (2.4, -18.3, 1.6), (7.6, -15.8, 0.9), (-6.2, -21.4, 1.4), (5.8, -26.0, 1.9))):
    vent("vent_%d" % i, x, z, h)
K.template("hatch", K.JPM + "Street/JP_Hatch_01.fbx", mat=M_DOOR)
K.inst("hatch", "roof_hatch", (1.6, 0.0, -11.4), 0.3, 1.2)


def skylight(name, cx, cz, L=3.2, D=2.0, H=0.55):
    gbox(name + "_curb", cx - L / 2, cx + L / 2, 0.0, H, cz - D / 2, cz + D / 2, M_BRICK, tile=1.4, bevel=0.01)
    gbox(name + "_cap", cx - L / 2 - 0.04, cx + L / 2 + 0.04, H, H + 0.06, cz - D / 2 - 0.04, cz + D / 2 + 0.04, M_STEEL,
         tile=0.8, bevel=0.008)
    rh = 0.75
    for s in (-1, 1):
        zz0, zz1 = cz + s * (D / 2), cz
        quad(name + "_glass_%d" % s, [(cx - L / 2 + 0.05, H + 0.06, zz0), (cx + L / 2 - 0.05, H + 0.06, zz0),
                                      (cx + L / 2 - 0.05, H + rh, zz1), (cx - L / 2 + 0.05, H + rh, zz1)], M_SKYLIT)
        for k in range(6):
            x = cx - L / 2 + 0.05 + (L - 0.1) * k / 5
            tube(name + "_mull_%d_%d" % (s, k), [(x, H + 0.08, zz0), (x, H + rh + 0.01, zz1)], 0.02, M_STEEL, sides=4)
    tube(name + "_ridge", [(cx - L / 2, H + rh + 0.02, cz), (cx + L / 2, H + rh + 0.02, cz)], 0.035, M_STEEL, sides=6)
    for ob in list(K.COL_SET.objects):
        if ob.name.startswith(name + "_glass"):
            me = ob.data
            if me.polygons[0].normal.z < 0:
                me.flip_normals()


skylight("skylight", 4.4, -13.9)
# floor cables from the truss towers to the neon sign / bleachers
for s in (-1, 1):
    pts = [(s * 9.3, 0.03, -8.4), (s * 8.4, 0.03, -8.6), (s * 7.0, 0.03, -8.4), (s * 6.7, 0.03, -8.35)]
    tube("cable_%d" % s, pts, 0.028, M_RUBBER, sides=6)
    tube("cable2_%d" % s, [(s * 9.2, 0.03, -8.1), (s * 11.5, 0.03, -8.0), (s * 12.2, 0.03, -9.4)], 0.022, M_RUBBER, sides=6)

# =============================================================== BUILD: water tank (hero)
log("build water tank")


def water_tank(cx, cz, legs_h=3.1, r=1.72, h=3.6):
    y0 = legs_h
    # steel stand: 4 legs (square tube) + cross bracing + ring beam + deck
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
    # deck railing
    for f in range(4):
        a = [(cx - 1.9, cz - 1.9), (cx + 1.9, cz - 1.9), (cx + 1.9, cz + 1.9), (cx - 1.9, cz + 1.9)]
        (ax, az), (bx, bz) = a[f], a[(f + 1) % 4]
        tube("tank_rail_%d" % f, [(ax, y0 + 0.95, az), (bx, y0 + 0.95, bz)], 0.018, M_STEEL, sides=6)
        tube("tank_rail_post_%d" % f, [(ax, y0, az), (ax, y0 + 0.95, az)], 0.018, M_STEEL, sides=6)
    # staves (lathe; slight barrel taper) + chime + floor beams
    prof = [(r * 0.985, 0.0), (r, 0.3), (r * 1.01, h * 0.5), (r, h - 0.3), (r * 0.985, h)]

    def stave_uv(u, L, i):
        return (L / 1.6, u * 2 * math.pi * r / 1.6)
    lathe("tank_staves", prof, (cx, y0, cz), M_WOOD, sides=40, uv_fn=stave_uv, cap_top=True, cap_bot=True)
    # conical roof + finial + hatch
    lathe("tank_roof", [(r * 1.08, 0.0), (r * 1.08, 0.05), (0.18, 1.0), (0.0, 1.05)], (cx, y0 + h, cz), M_WOOD, sides=40,
          uv_fn=lambda u, L, i: (u * 2 * math.pi * r * 1.08 / 1.6, L / 1.6), cap_bot=True)
    lathe("tank_finial", [(0.09, 0.0), (0.09, 0.2), (0.14, 0.26), (0.0, 0.42)], (cx, y0 + h + 1.0, cz), M_STEEL, sides=12,
          tile_u=0.3, tile_v=0.3)
    # steel hoops with lugs
    for k in range(7):
        yy = y0 + 0.25 + k * (h - 0.5) / 6
        rr = r * (1.0 + 0.012 * math.sin(math.pi * (yy - y0) / h)) + 0.018
        tube("tank_hoop_%d" % k, [(cx + rr * math.cos(a), yy, cz + rr * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 41)],
             0.016, M_STEEL, sides=6, caps=False)
        la = 0.4 + k * 0.9
        gbox("tank_lug_%d" % k, cx + (rr + 0.02) * math.cos(la) - 0.05, cx + (rr + 0.02) * math.cos(la) + 0.05, yy - 0.04, yy + 0.04,
             cz + (rr + 0.02) * math.sin(la) - 0.05, cz + (rr + 0.02) * math.sin(la) + 0.05, M_STEEL, tile=0.3, bevel=0.006)
    # ladder up the front-right side
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
    # overflow + feed pipe down to the roof
    px, pz = cx - r * 0.7, cz + r * 0.72
    tube("tank_pipe", [(px, y0 + 0.4, pz), (px - 0.15, y0 + 0.2, pz + 0.12), (px - 0.15, 0.3, pz + 0.12), (px - 0.4, 0.06, pz + 0.12)],
         0.06, M_STEEL, sides=10)
    for yy in (0.8, 2.0):
        gbox("tank_pipe_clamp_%.1f" % yy, px - 0.24, px - 0.06, yy - 0.03, yy + 0.03, pz + 0.04, pz + 0.2, M_STEEL, tile=0.3)


water_tank(-10.2, -17.4)

# =============================================================== BUILD: broadcast mast (hero)
log("build mast")


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
    # red aviation lights
    for k, yy in enumerate((8.0, 16.0, 24.0, 32.0)):
        lx, lz = legs[k % 3]
        sphere("mast_red_%d" % k, (lx, yy, lz), 0.16, M_RED, seg=10, rings=6)
        cyl("mast_red_base_%d" % k, (lx, yy - 0.16, lz), (0, 1, 0), 0.1, 0.08, M_STEEL, sides=8)
    sphere("mast_top_light", (cx, H + 0.6, cz), 0.22, M_RED, seg=12, rings=7)
    tube("mast_top_rod", [(cx, H, cz), (cx, H + 0.45, cz)], 0.05, M_STEEL, sides=8)
    # microwave drum dishes + panel antennas
    for k, (yy, ang) in enumerate(((11.0, 0.6), (13.5, -0.9), (19.0, 2.2))):
        dx, dz = math.sin(ang), math.cos(ang)
        c = (cx + dx * 1.2, yy, cz + dz * 1.2)
        ob = cyl("mast_dish_%d" % k, c, (dx, 0.0, dz), 0.7, 0.45, M_RTU, sides=24, bevel=0.03)
        cyl("mast_dish_face_%d" % k, (c[0] + dx * 0.24, c[1], c[2] + dz * 0.24), (dx, 0.0, dz), 0.66, 0.02, M_CONC, sides=24)
        tube("mast_dish_arm_%d" % k, [(cx + dx * 0.4, yy, cz + dz * 0.4), (c[0], yy, c[2])], 0.04, M_STEEL, sides=6)
    for k in range(3):
        lx, lz = legs[k]
        gbox("mast_panel_%d" % k, lx - 0.12, lx + 0.12, 26.0, 28.4, lz - 0.12, lz + 0.12, M_RTU, tile=0.8, bevel=0.02)
    # base: concrete pier + equipment shelter
    gbox("mast_pier", cx - 1.3, cx + 1.3, 0.0, 0.45, cz - 1.3, cz + 1.3, M_CONC, tile=1.2, bevel=0.03)
    gbox("mast_shelter", cx - 3.8, cx - 1.8, 0.0, 2.3, cz - 1.2, cz + 1.2, M_RTU, tile=1.2, bevel=0.03)
    gbox("mast_shelter_roof", cx - 3.9, cx - 1.7, 2.3, 2.4, cz - 1.3, cz + 1.3, M_STEEL, tile=1.0, bevel=0.01)
    gbox("mast_shelter_door", cx - 3.3, cx - 2.4, 0.05, 2.0, cz + 1.2, cz + 1.22, M_DOOR, tile=1.0, bevel=0.006)
    tube("mast_feeders", [(cx - 1.8, 2.0, cz), (cx - 0.6, 2.0, cz), (cx, 2.4, cz), (cx, 12.0, cz)], 0.06, M_RUBBER, sides=6)


mast(-17.6, -23.6)

# =============================================================== BUILD: show billboard (hero)
log("build billboard")
BZ, BXC, BW, BH, BY0 = -24.0, 12.4, 11.0, 5.5, 3.6
bx0, bx1 = BXC - BW / 2, BXC + BW / 2
gbox("bill_back", bx0, bx1, BY0, BY0 + BH, BZ - 0.18, BZ - 0.02, M_STEEL, tile=2.0)
front_quad("bill_face", bx0, bx1, BY0, BY0 + BH, BZ - 0.015, M_BILL)
for (a, b_, c, d) in ((bx0 - 0.2, bx1 + 0.2, BY0 + BH, BY0 + BH + 0.2), (bx0 - 0.2, bx1 + 0.2, BY0 - 0.2, BY0),
                      (bx0 - 0.2, bx0, BY0, BY0 + BH), (bx1, bx1 + 0.2, BY0, BY0 + BH)):
    gbox("bill_frame_%.1f_%.1f" % (a, c), a, b_, c, d, BZ - 0.22, BZ + 0.06, M_STEEL, tile=1.0, bevel=0.02)
for x in (bx0 + 1.5, BXC, bx1 - 1.5):
    gbox("bill_col_%.1f" % x, x - 0.14, x + 0.14, 0.0, BY0 + BH, BZ - 0.55, BZ - 0.25, M_STEEL, tile=1.0, bevel=0.012)
    tube("bill_brace_%.1f" % x, [(x, 0.05, BZ - 3.4), (x, BY0 + BH * 0.7, BZ - 0.45)], 0.07, M_STEEL, sides=8)
    gbox("bill_col_foot_%.1f" % x, x - 0.35, x + 0.35, 0.0, 0.3, BZ - 0.75, BZ - 0.05, M_CONC, tile=1.0, bevel=0.02)
# catwalk + railing + gooseneck lamps
gbox("bill_catwalk", bx0, bx1, BY0 - 0.34, BY0 - 0.28, BZ - 0.1, BZ + 0.75, M_STEEL, tile=1.0, bevel=0.006)
for x in np.arange(bx0, bx1 + 0.01, 1.5):
    tube("bill_cw_post_%.1f" % x, [(x, BY0 - 0.28, BZ + 0.72), (x, BY0 + 0.7, BZ + 0.72)], 0.02, M_STEEL, sides=6)
tube("bill_cw_rail", [(bx0, BY0 + 0.7, BZ + 0.72), (bx1, BY0 + 0.7, BZ + 0.72)], 0.022, M_STEEL, sides=6)
for k in range(8):
    x = bx0 + 0.75 + k * (BW - 1.5) / 7
    pts = [(x, BY0 - 0.28, BZ + 0.6), (x, BY0 + 0.1, BZ + 0.95), (x, BY0 + 0.55, BZ + 1.2), (x, BY0 + 0.8, BZ + 1.1)]
    tube("bill_neck_%d" % k, pts, 0.02, M_STEEL, sides=6)
    cyl("bill_lamp_%d" % k, (x, BY0 + 0.84, BZ + 1.05), (0, 0.6, -0.8), 0.13, 0.22, M_STEEL, sides=14, r2=0.07)
    cyl("bill_lamp_lens_%d" % k, (x, BY0 + 0.78, BZ + 0.97), (0, 0.6, -0.8), 0.115, 0.01, M_LENS, sides=14)

# =============================================================== BUILD: parapets
log("build parapets")
gbox("parapet_back", -32.0, 32.0, 0.0, 1.05, -30.35, -30.0, M_BRICK, tile=1.4)
gbox("parapet_back_cap", -32.1, 32.1, 1.05, 1.15, -30.42, -29.93, M_CONC, tile=1.5, bevel=0.015)
for s in (-1, 1):
    gbox("parapet_side_%d" % s, s * 32.0, s * 32.35, 0.0, 1.05, -30.35, 9.0, M_BRICK, tile=1.4)
    gbox("parapet_side_cap_%d" % s, s * 31.93, s * 32.42, 1.05, 1.15, -30.42, 9.0, M_CONC, tile=1.5, bevel=0.015)

# =============================================================== BUILD: city skyline (lit windows)
log("build skyline")
QUAD = {0: (0.0, 1.0), 1: (0.5, 1.0), 2: (0.0, 0.5), 3: (0.5, 0.5)}     # quadrant (u0, v_top)


def facade_box(name, x0, x1, ytop, z0, z1, style, rng, ybase=-45.0):
    """window-textured upper part (<= 56 m) + dark base; UVs keep ~2.4 m bays / 3.5 m floors from the roofline down"""
    yb = max(ybase, ytop - 56.0)
    if yb > ybase:
        gbox(name + "_base", x0, x1, ybase, yb, z0, z1, M_CITYROOF, tile=8.0)
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
    return ob


rng = K.mulberry32(1313)
BANDS = [(-40.0, 11, 46.0, (3.0, 15.0), (8.0, 18.0)), (-56.0, 13, 62.0, (9.0, 34.0), (10.0, 22.0)),
         (-78.0, 15, 82.0, (16.0, 46.0), (12.0, 24.0))]
nb = 0
for bi, (zc, n, X, (h0, h1), (w0, w1)) in enumerate(BANDS):
    x = -X
    while x < X:
        w = w0 + (w1 - w0) * rng()
        d = 8.0 + 8.0 * rng()
        top = h0 + (h1 - h0) * rng() ** 1.3
        z = zc - 6.0 * rng()
        style = int(rng() * 4) % 4
        facade_box("bld_%d_%d" % (bi, nb), x, x + w, top, z - d, z, style, rng)
        if rng() < 0.45:
            cw = w * (0.45 + 0.25 * rng())
            cx0 = x + (w - cw) * rng()
            facade_box("bld_%d_%d_crown" % (bi, nb), cx0, cx0 + cw, top + 3.0 + 7.0 * rng(), z - d * 0.8, z - d * 0.1, (style + 1) % 4, rng)
        # rooftop silhouettes: tank, mast with red light, AC boxes
        rsel = rng()
        if rsel < 0.3:
            tx, tz = x + w * (0.2 + 0.6 * rng()), z - d * 0.5
            lathe("bld_tank_%d" % nb, [(1.2, 0.0), (1.2, 2.4), (1.3, 2.45), (0.0, 3.2)], (tx, top + 1.8, tz), M_CITYROOF, sides=10)
            for k in range(4):
                a = k * math.pi / 2 + 0.785
                tube("bld_tank_leg_%d_%d" % (nb, k), [(tx + math.cos(a), top, tz + math.sin(a)),
                                                      (tx + math.cos(a), top + 1.8, tz + math.sin(a))], 0.08, M_CITYROOF, sides=4)
        elif rsel < 0.55:
            mx, mz = x + w * (0.2 + 0.6 * rng()), z - d * 0.4
            mh = 4.0 + 9.0 * rng()
            tube("bld_mast_%d" % nb, [(mx, top, mz), (mx, top + mh, mz)], 0.15, M_CITYROOF, sides=4)
            sphere("bld_mast_red_%d" % nb, (mx, top + mh + 0.2, mz), 0.35, M_RED, seg=8, rings=5)
        elif rsel < 0.75:
            for k in range(int(2 + 3 * rng())):
                ax = x + 1.0 + (w - 3.0) * rng()
                gbox("bld_ac_%d_%d" % (nb, k), ax, ax + 1.6, top, top + 1.2, z - d * 0.7, z - d * 0.7 + 1.2, M_CITYROOF, tile=4.0)
        x += w + 0.6 + 2.5 * rng()
        nb += 1
log("buildings", nb)

# =============================================================== BUILD: night sky backdrop (jp_Sky_Night_4a)
log("build sky")


def sky_texture():
    """crop of the equirect around its horizon glow (azimuth span 124 deg, elevation -14..+34 deg), exposure-normalised,
    sRGB-encoded 8 bit -> the unlit backdrop texture"""
    src = bpy.data.images.load(JP_SKY, check_existing=True)
    W, H = src.size
    a = np.empty(W * H * 4, np.float32)
    src.pixels.foreach_get(a)
    a = a.reshape(H, W, 4)                  # row 0 = bottom (elevation -90)
    lumi = a[..., :3] @ np.array([0.2126, 0.7152, 0.0722], np.float32)

    def row_of(e):
        return int(round((e + 90.0) / 180.0 * H))
    band = lumi[row_of(0.5):row_of(6.0)].mean(0)
    k = np.ones(64, np.float32) / 64
    sm = np.convolve(np.concatenate([band, band[:64]]), k, mode="same")[:W]
    c = int(np.argmax(sm))
    span = int(round(124.0 / 360.0 * W))
    cols = (np.arange(c - span // 2, c + span // 2) % W)
    r0, r1 = row_of(-14.0), row_of(34.0)
    crop = a[r0:r1][:, cols, :3]
    ow, oh = 1024, 384
    yi = (np.linspace(0, crop.shape[0] - 1, oh)).astype(int)
    xi = (np.linspace(0, crop.shape[1] - 1, ow)).astype(int)
    # box-filter down: average a 3x3 neighbourhood around each sample
    acc = np.zeros((oh, ow, 3), np.float32)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            acc += crop[np.clip(yi + dy, 0, crop.shape[0] - 1)][:, np.clip(xi + dx, 0, crop.shape[1] - 1)]
    acc /= 9.0
    p = np.percentile(acc, 99.7)
    lin = np.clip(acc * (0.85 / max(p, 1e-6)), 0, 1)
    srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
    im = bpy.data.images.new("rt13_sky", ow, oh, alpha=True)
    out = np.ones((oh, ow, 4), np.float32)
    out[..., :3] = srgb
    im.pixels.foreach_set(out.ravel())
    im.filepath_raw = os.path.join(K.TEX, "rt13_sky.png")
    im.file_format = "PNG"
    im.save()
    log("sky crop: glow azimuth column %d of %d, p99.7 %.4f, mean %.4f" % (c, W, p, float(acc.mean())))
    return im


M_SKY = mat_unlit("rt13_sky", sky_texture())
R, CZ, TH = 104.0, 8.0, math.radians(62.0)
E0, E1 = math.radians(-14.0), math.radians(34.0)


def sky_fn(u, v):
    th = -TH + 2 * TH * u
    e = E1 - (E1 - E0) * v
    y = 1.25 + R * math.tan(e)
    return (R * math.sin(th), y, CZ - R * math.cos(th))


K.surface("sky_backdrop", 40, 12, sky_fn, M_SKY, lambda u, v: (u, 1 - v), flip=False)
sk = K.COL_SET.objects["sky_backdrop"]
# the backdrop must face the origin (normals toward the camera)
c0 = sum((p.center for p in sk.data.polygons), Vector()) / len(sk.data.polygons)
if sk.data.polygons[len(sk.data.polygons) // 2].normal.dot(-c0.normalized()) < 0:
    sk.data.flip_normals()

# =============================================================== BUILD: rain streaks (node rain_fall)
log("build rain")
rng = K.mulberry32(4242)
PER = 10.0
for i in range(64):
    x = -15.0 + 30.0 * rng()
    z = -9.5 + 10.8 * rng()
    y = PER * rng()
    w, h = 0.7, 3.4
    uo, vo = rng(), rng()
    yaw = math.radians((rng() * 2 - 1) * 8)
    dx, dz = math.cos(yaw) * w / 2, -math.sin(yaw) * w / 2
    for rep in (0.0, PER):
        yy = y + rep
        ob = quad("rain_%d_%d" % (i, int(rep)), [(x - dx, yy, z - dz), (x + dx, yy, z + dz), (x + dx, yy + h, z + dz),
                                                 (x - dx, yy + h, z - dz)], M_RAIN,
                  ((uo, vo), (uo + 1, vo), (uo + 1, vo + 1), (uo, vo + 1)))
        ob["depth_hide"] = 1
        DRESS["rain_fall"].append(ob)

# =============================================================== crowd nodes
K.crowd_nodes()

# =============================================================== contact render (ENV_KIT 8.3) or main
if K.DO_CONTACT:
    # hero procedural props moved next to the two library references (same HDRI, same sun)
    keep = [o for o in K.COL_SET.objects if o.name.startswith(("tank_", "rtu_r", "flood_1_", "truss_1_", "bar_", "neon_"))]
    for o in list(K.COL_SET.objects):
        if o not in keep:
            o.hide_render = True
    for o in K.COL_NODES.objects:
        o.hide_render = True

    def move(prefix, off):
        for o in keep:
            if o.name.startswith(prefix):
                o.matrix_world = Matrix.Translation(G(*off)) @ o.matrix_world
    move("tank_", (10.2 + 3.0, 0.0, 17.4))
    move("rtu_r", (-12.9 + 8.0, 0.0, 11.6))
    move("flood_1_", (-9.3 + 11.5, -2.2, 8.8))
    move("truss_1_", (-9.3 + 11.5, 0.0, 8.8))
    move("bar_", (0.0 + 14.0, 0.0, 3.78 + 1.5))
    move("neon_", (0.0 + 5.0, -1.4, 8.25 - 4.5))
    K.contact_render(keep, "rooftop_contact.png", K.PHH + "abandoned_parking/abandoned_parking_2k.hdr",
                     span=16.0, cam_pos=[5.6, 3.6, 15.5], look=[5.6, 2.8, 0.0], fov=46.0)
else:
    if K.DO_EXPORT or not os.path.exists(os.path.join(K.GLTF_OUT, S["environment"]["hdr"])):
        K.env_map(JP_SKY, "rooftop_env.hdr")
    if K.DO_RENDER:
        K.render_proofs([
            {"id": "overview", "pos": [12.0, 8.0, 14.0], "look": [0.0, 2.5, -9.0], "fov": 55.0},
            {"id": "wall_left", "pos": [-3.6, 1.7, 2.8], "look": [-8.0, 1.7, -0.6], "fov": 50.0},
            {"id": "wall_right", "pos": [3.8, 1.7, 2.6], "look": [8.0, 1.8, -0.6], "fov": 50.0},
        ], [("Eve", "Eve By J.Gonzales.fbx", S["spawn"]["p1"][0], 1, 1.72),
            ("Ch06", "Ch06_nonPBR.fbx", S["spawn"]["p2"][0], -1, 1.78)])
    K.tri_report(["tank_", "rtu_r", "rtu_l", "mast_", "bill_", "neon_", "truss_1_", "flood_1_0", "bar_", "tread_", "door_",
                  "bh_", "mr_", "louvre_", "skylight", "vent_0", "bld_", "sky_", "puddle", "bulb_", "strand_", "ac_l_0"])
    if K.DO_EXPORT:
        K.export([(n, objs, None) for n, objs in DRESS.items()])
        K.write_fragment()
        if K.DO_FINISH:
            K.run_finish()
log("DONE")
