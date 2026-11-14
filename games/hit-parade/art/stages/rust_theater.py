"""HIT PARADE - stage 1 THE RUST THEATER, built headless in Blender (lane STAGES; 360-degree arena: lane STAGES3D-A).

CHANGED(STAGES3D-A) CONTRACT 35.6 / 35.11: a round blue-brick fight PIT (radius 5.5 m, stone floor) sunk in the middle of
a condemned vaudeville theatre. The pit wall (1.2 m: stone plinth, blue-painted brick = the splat surface, stone coping
with a ring of iron-hooded footlights) carries iron mooring rings, four barred drain arches and two low iron-banded
fighter gates (90 / 270 deg). Around it the stalls floor (old planks, flush with the coping level) is clear to r 9.5 (the
camera orbit zone); from r 9.7: on the far side of the start camera (180 deg) the old stage - apron with footlights, the
gilded proscenium arch with pilasters and opera boxes, torn red-velvet drapes and valance, the bulb-lit HIT PARADE
marquee hanging in the opening before the rear curtain; all the way round the rest a horseshoe of raked wooden bleachers
(crowd leaning over a brass-and-velvet rope rail, stone stepped end panels) split by three vomitory aisles framed by
torch pillars, the gilded dress-circle balcony with its own crowd and spot cans above, chandeliers over the stalls.
Lights: a fixed pool of 8 that lights the pair from every camera angle.

Usage (run blender.exe directly so the log is visible; paths are resolved from this file):
  blender.exe --background --python art/stages/rust_theater.py -- [--no-export] [--no-render] [--contact]
        [--shots id,id|orbit] [--res 1920x1080] [--samples 48] [--no-fighters] [--out stage|live]
Outputs (default --out stage = _harness/scratch/stages3d_out/, swap in with `python tools/merge_stages.py --install
rust_theater`): rust_theater.glb + rust_theater_env.hdr + rust_theater.stage.json (fragment - since STAGES3D-A the
Rust Theater definition lives HERE, not in write_stages_json.py; run merge_stages.py after write_stages_json.py);
_harness/_reports/stages/rust_theater_<shot>.png (proof renders) + rust_theater_orbit_sheet.png.
Sources (read-only): Quaternius Medieval Village + Fantasy Props MegaKits (CC0), Quaternius Modular Dungeon (CC0), GYP
Stylized Fantasy City textures, Blink Stylized Dungeon textures, Tidal Flask FANTASTIC Interior (curtains/planks/fabric,
extracted to _harness/scratch/stages_cache/fant), ForgeFlow generated-materials cloth_banner (original), Poly Haven
afrikaans_church_interior (CC0). Axes: game coordinates via G(x, y, z) (see stagelib_a.py). ASCII only.
"""
import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.dont_write_bytecode = True   # no __pycache__ inside art/stages
import stagelib_a as L  # noqa: E402
from stagelib_a import G, gbox, cyl, tube, sphere, lathe, prism, obox, log, polar, annulus, place  # noqa: E402
import bpy  # noqa: E402
import bmesh  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector, Matrix  # noqa: E402

SID = "rust_theater"
HDRI = L.A + "/_downloaded/polyhaven-hdris/afrikaans_church_interior/afrikaans_church_interior_2k.hdr"
RR = 5.5            # pit radius (inner face of the blue-brick wall)
WH = 1.2            # pit wall height (coping top)
CT = 0.45           # coping depth (pit wall thickness at the top)
SY = 1.0            # stalls floor level (the theatre floor around the sunk pit)
CAM_SIDE = 0.0
SPAWN_AXIS = 90.0
DECK = 2.0          # stage deck height (above the pit floor)
PZ = -11.3          # proscenium front face
APRON_Z = -10.3     # stage apron edge
TIER_R = [10.2 + 0.8 * k for k in range(6)]
TIER_Y = [SY + 0.4 * k for k in range(6)]      # row 0 stands on the stalls floor at the rope rail
BAYS = [("stalls_a", 214.0, 266.0, 1101), ("stalls_b", 274.0, 356.0, 1102), ("stalls_c", 4.0, 86.0, 1103),
        ("stalls_d", 94.0, 146.0, 1104)]
AISLES = [270.0, 0.0, 90.0]
BACK_R = 14.7       # back wall under the balcony
BAL_Y = 4.9         # dress-circle floor
BAL_A0, BAL_A1 = 150.0 + 60.0, 150.0 + 360.0 - 0.0   # 210 .. 510 (= 150): the horseshoe
A_ = L.A
QMV = L.QMV
QFP = L.QFP
QMD = A_ + "/3d-models/modular-dungeon/.Updated Modular Dungeon - May 2019/FBX/"
GYP = L.U + "/GYP Studios__Stylized Fantasy City - Exterior Modular/Assets/Stylized Fantasy City - Exterior Modular/Textures/Wall/"
BLINK = L.BLINK
FANT = os.path.join(L.CACHE, "fant", "Assets", "Fantastic Interior Pack")
GEN = L.GEN


def spot(sid, az, color, inten, r=14.6, y=6.2):
    return {"id": sid, "type": "spot", "color": color, "intensity": inten, "distance": 30.0, "decay": 2,
            "position": [round(v, 3) for v in polar(r, az, y)], "target": [0.0, 1.0, 0.0], "angleDeg": 22.0,
            "penumbra": 0.5}


S = {
    "id": SID,
    "name": "THE RUST THEATER",
    "status": "built",
    "glb": SID + ".glb",
    "source": "art/stages/rust_theater.py",
    "home": ["johnny", "rerun"],
    "look": "condemned vaudeville theatre turned fight pit: a round blue-painted brick pit (stone floor, iron rings, "
            "footlit stone coping) sunk in the stalls; the old stage on one side - torn red-velvet proscenium, opera "
            "boxes and the bulb HIT PARADE marquee; a horseshoe of wooden bleachers with the crowd leaning over a velvet "
            "rope rail, torch-lit aisles, a gilded dress-circle balcony and chandeliers all the way round",
    "floor": {"y": 0.0, "surface": "stone", "fightStrip": {"x": [-8.0, 8.0], "z": [-1.5, 1.5]},
              "extent": {"x": [-17.5, 17.5], "z": [-17.5, 17.5]},
              "stallsY": SY,
              "note": "the pit floor (y 0, r <= 5.5) is the fight floor; the stalls around the pit sit at y 1.0 (the pit "
                      "is sunk). fightStrip = legacy 2.5D (CONTRACT 35.11.7)"},
    "walls": {
        "x": [-8.0, 8.0],
        "splat": [
            {"id": 0, "x": -8.0, "normal": [1, 0, 0], "z": [-3.2, 3.0], "heightM": 4.2, "surface": "blue_brick",
             "dustColor": "#7d8fb0"},
            {"id": 1, "x": 8.0, "normal": [-1, 0, 0], "z": [-3.2, 3.0], "heightM": 4.2, "surface": "blue_brick",
             "dustColor": "#7d8fb0"},
        ],
        "note": "LEGACY 2.5D (CONTRACT 35.11.7): kept until the sim / view stop reading walls.x; the 3D boundary is `ring`.",
    },
    "ring": L.ring_block("circle", RR, WH, CT, "blue_brick", "#7d8fb0", rot=0.0,
                         note="CONTRACT 35.11: circle, radiusM = the pit wall's inner brick face; 16 WALL_SPLAT sectors "
                              "centred on k*22.5 deg. Stone plinth 0-0.3 m, blue brick 0.3-1.05 m, coping 1.05-1.2 m. "
                              "Low iron-banded gates (flush) at 90 / 270 deg are part of the wall."),
    "spawnAxisDeg": SPAWN_AXIS,
    "cameraSideDeg": CAM_SIDE,
    "cameraMaxM": 9.5,
    "spawn": L.spawn_block(SPAWN_AXIS, 2.4),
    "camera": L.camera_block_3d(SID, CAM_SIDE),
    "exposure": 1.0,
    "toneMapping": "neutral",
    "fog": {"color": "#17121d", "near": 16.0, "far": 52.0},
    "environment": {"hdr": SID + "_env.hdr", "intensity": 0.28, "background": False,
                    "src": "Poly Haven afrikaans_church_interior_2k.hdr (CC0), downsampled to 512x256",
                    "backgroundColor": "#0b0910"},
    "lights": [
        {"id": "key", "type": "directional", "color": "#ffd8ab", "intensity": 2.5,
         "position": [round(v, 3) for v in polar(9.0, 200.0, 14.0)], "target": [0.0, 1.0, 0.0], "castShadow": True,
         "shadow": {"mapSize": 1024, "bias": -0.0004, "normalBias": 0.03,
                    "camera": {"left": -9.0, "right": 9.0, "top": 9.0, "bottom": -9.0, "near": 1.0, "far": 40.0}}},
        {"id": "rim", "type": "directional", "color": "#86a8ff", "intensity": 1.7,
         "position": [round(v, 3) for v in polar(10.0, 20.0, 7.0)], "target": [0.0, 1.2, 0.0], "castShadow": False},
        {"id": "fill", "type": "hemisphere", "sky": "#5b6fa6", "ground": "#3b2621", "intensity": 0.9},
        {"id": "stage_wash", "type": "spot", "color": "#ff9d7e", "intensity": 150.0, "distance": 32.0, "decay": 2,
         "position": [0.0, 9.0, -1.5], "target": [0.0, 3.6, -13.0], "angleDeg": 30.0, "penumbra": 0.55},
        spot("spot_60", 60.0, "#ffe2c0", 200.0),
        spot("spot_300", 300.0, "#ffe2c0", 200.0),
        {"id": "torch_l", "type": "point", "color": "#ff8a36", "intensity": 7.0, "distance": 9.0, "decay": 2,
         "position": [round(v, 3) for v in polar(9.8, 270.0, 3.0)], "flicker": {"amp": 0.22, "hz": 7.0}},
        {"id": "torch_r", "type": "point", "color": "#ff8a36", "intensity": 7.0, "distance": 9.0, "decay": 2,
         "position": [round(v, 3) for v in polar(9.8, 90.0, 3.0)], "flicker": {"amp": 0.22, "hz": 6.3}},
    ],
    "lightsNote": "FIXED pool (8): created once at stage load, never added/removed (shader programs stay warm). No lights "
                  "in the GLB. 360 rig (CONTRACT 35.6): high warm key from the stage side + cool rim from the opposite "
                  "side + hemisphere fill + two balcony spots (60 / 300 deg) aimed at the pit + a stage wash on the "
                  "proscenium + two aisle torch glows (flicker = view-only intensity modulation).",
    "crowd": L.crowd_block("#e0d6cf", 0.6, [
        {"id": bid, "arcDeg": [a0, a1], "spacing": 0.6, "jitter": [0.12, 0.08], "seed": seed,
         "rows": [{"r": round(r, 3), "y": round(y, 3)} for r, y in zip(TIER_R, TIER_Y)]}
        for bid, a0, a1, seed in BAYS] + [
        {"id": "circle", "arcDeg": [BAL_A0 + 2.0, BAL_A1 - 2.0], "spacing": 0.62, "jitter": [0.14, 0.06], "seed": 1105,
         "gapPct": 0.18, "rows": [{"r": 15.25, "y": BAL_Y}, {"r": 16.05, "y": BAL_Y + 0.45}]}]),
    "music": "music_stage_rust_theater",
    "musicHint": "AUDIO_KIT music_stage pick 'Halloween Rocks' (Evil Mind, rock, 129 BPM) - AUDIO lane maps the id",
    "ambient": "amb_theater_crowd",
    "ambientHint": "crowd bed that follows SHOWTIME/ratings + torch crackle near the aisle torches",
    "dressing": {
        "animated": [
            {"what": "aisle torch flames", "nodes": "flame_torches",
             "how": "view-side flame_* scale.y flicker, synced with the torch_l / torch_r light flicker"},
            {"what": "marquee bulbs", "nodes": "marquee_bulbs", "how": "optional chase pattern on emissive intensity"},
            {"what": "crowd", "how": "instanced cards, vertex bob/sway, pose swaps by ratings mood"},
        ],
        "splatWallDust": "#7d8fb0",
    },
}
S["crowd"]["nodes"] = ("GLB empties crowd_<bay>_<row>_<i>: position = feet point, +Z = card facing (the ring centre), "
                       "uniform scale = card height; extras {bay,row,i,rand,angle}. Generated from the ARC bays below "
                       "(CONTRACT 35.11.6: rows along circles r about the ring centre, spacing along the arc, jitter = "
                       "[tangential, radial] half-ranges from mulberry32(seed); gapPct = share of empty seats).")

if L.arg("--fragment-only", False):      # re-emit the fragment from S (keeps the measured build stats)
    L.write_fragment(S)
    raise SystemExit(0)
L.init_scene("rust")


# =============================================================== textures (P1 recipes, lane STAGES)
def _lum(p):
    return p[..., 0] * 0.3 + p[..., 1] * 0.59 + p[..., 2] * 0.11


def _tile_noise(h, w, cells, seed):
    rng = np.random.default_rng(seed)
    g = rng.random((cells, cells)).astype(np.float32)
    ys = (np.arange(h) / h * cells)
    xs = (np.arange(w) / w * cells)
    y0 = np.floor(ys).astype(int) % cells
    x0 = np.floor(xs).astype(int) % cells
    y1 = (y0 + 1) % cells
    x1 = (x0 + 1) % cells
    fy = (ys - np.floor(ys))[:, None]
    fx = (xs - np.floor(xs))[None, :]
    fy = fy * fy * (3 - 2 * fy)
    fx = fx * fx * (3 - 2 * fx)
    a = g[y0][:, x0] * (1 - fx) + g[y0][:, x1] * fx
    b = g[y1][:, x0] * (1 - fx) + g[y1][:, x1] * fx
    return a * (1 - fy) + b * fy


def fn_blue_brick(p):
    """grey brick -> blue paint (navy mortar, steel-blue faces), chipped where noise is high."""
    Lm = _lum(p)
    lo, hi = np.percentile(Lm, 4), np.percentile(Lm, 97)
    t = np.clip((Lm - lo) / max(1e-3, hi - lo), 0, 1)
    navy = np.array([0.075, 0.125, 0.235], np.float32)
    steel = np.array([0.36, 0.49, 0.70], np.float32)
    col = navy[None, None, :] * (1 - t[..., None]) + steel[None, None, :] * t[..., None]
    h, w = Lm.shape
    n = 0.6 * _tile_noise(h, w, 12, 7) + 0.4 * _tile_noise(h, w, 40, 11)
    chip = np.clip((n - 0.64) / 0.06, 0, 1) * (t > 0.42)
    raw = p[..., :3] * np.array([0.78, 0.72, 0.66], np.float32)
    col = col * (1 - chip[..., None]) + raw * chip[..., None]
    grime = 0.86 + 0.14 * _tile_noise(h, w, 6, 3)
    out = p.copy()
    out[..., :3] = np.clip(col * grime[..., None], 0, 1)
    return out


def fn_floor(p):
    Lm = _lum(p)[..., None]
    c = p[..., :3] * 0.62 + Lm * 0.38
    out = p.copy()
    out[..., :3] = np.clip(c * np.array([0.60, 0.61, 0.67], np.float32), 0, 1)
    return out


def fn_plaster(p):
    r, g = p[..., 0], p[..., 1]
    Lm = _lum(p)
    brick = np.clip(((r - g) - 0.08) / 0.12, 0, 1)
    lo, hi = np.percentile(Lm, 5), np.percentile(Lm, 98)
    t = np.clip((Lm - lo) / max(1e-3, hi - lo), 0, 1)
    dark = np.array([0.20, 0.055, 0.07], np.float32)
    lite = np.array([0.46, 0.16, 0.16], np.float32)
    paint = dark[None, None, :] * (1 - t[..., None]) + lite[None, None, :] * t[..., None]
    old = p[..., :3] * 0.62
    out = p.copy()
    out[..., :3] = np.clip(paint * (1 - brick[..., None]) + old * brick[..., None], 0, 1)
    return out


def fn_scale(k):
    def f(p):
        out = p.copy()
        out[..., :3] = np.clip(p[..., :3] * np.array(k, np.float32), 0, 1)
        return out
    return f


def T(src, name, size, noncolor=False, fn=None):
    return L.prep(src, name, size, noncolor, fn, sub="tex_rust")


log("textures")
T_BRICK_A = T(QMV + "T_Brick_BaseColor.png", "rt_bluebrick_a", 1024, fn=fn_blue_brick)
T_BRICK_N = T(QMV + "T_Brick_Normal.png", "rt_bluebrick_n", 1024, True)
T_BRICK_R = T(QMV + "T_Brick_Roughness.png", "rt_bluebrick_r", 512, True)
T_STONE_A = T(GYP + "Rock/Wall_Rock_01_Blue_Albedo.tif", "rt_bluestone_a", 1024, fn=fn_scale((0.9, 0.95, 1.05)))
T_STONE_N = T(GYP + "Rock/Wall_Rock_01_Normal.tif", "rt_bluestone_n", 512, True)
T_FLOOR_A = T(QMV + "T_UnevenBrick_BaseColor.png", "rt_floor_a", 1024, fn=fn_floor)
T_FLOOR_N = T(QMV + "T_UnevenBrick_Normal.png", "rt_floor_n", 1024, True)
T_FLOOR_R = T(QMV + "T_UnevenBrick_Roughness.png", "rt_floor_r", 512, True,
              fn=lambda p: np.dstack([0.62 + 0.38 * p[..., :3], p[..., 3:]]))
T_PLAST_A = T(GYP + "Damaged/Wall_Brick_Damaged_01_Albedo.tif", "rt_plaster_a", 1024, fn=fn_plaster)
T_PLAST_N = T(GYP + "Damaged/Wall_Brick_Damaged_01_Normal.tif", "rt_plaster_n", 512, True)
T_WOOD_A = T(os.path.join(FANT, "2d", "textures", "T_ENV_MOD_Interior_PlanksLong_01_v1_BC.png"), "rt_planks_a", 1024,
             fn=fn_scale((0.72, 0.66, 0.62)))
T_WOOD_N = T(os.path.join(FANT, "2d", "textures", "T_ENV_MOD_Interior_PlanksLong_01_N.png"), "rt_planks_n", 512, True)
T_DECO_A = T(BLINK + "Stone_Gate/Stone_Gate_BaseColor.png", "rt_deco_a", 1024)
T_DECO_N = T(BLINK + "Stone_Gate/Stone_Gate_Normal.png", "rt_deco_n", 512, True)
T_DECO_R = T(BLINK + "Stone_Gate/Stone_Gate_Roughness.png", "rt_deco_r", 512, True)
T_VELV_A = T(GEN + "cloth_banner_albedo.webp", "rt_velvet_a", 512, fn=fn_scale((0.82, 0.78, 0.8)))
T_VELV_N = T(GEN + "cloth_banner_normal.webp", "rt_velvet_n", 512, True)
T_FAB_A = T(os.path.join(FANT, "2d", "textures", "T_PROP_fabrics_interior_BC.png"), "rt_fabric_a", 512)

M = L.mat_pbr
M_BRICK = M("rt_bluebrick", T_BRICK_A, T_BRICK_N, T_BRICK_R)
M_STONE = M("rt_bluestone", T_STONE_A, T_STONE_N, roughness=0.8)
M_FLOOR = M("rt_floor", T_FLOOR_A, T_FLOOR_N, T_FLOOR_R)
M_PLAST = M("rt_plaster", T_PLAST_A, T_PLAST_N, roughness=0.9)
M_WOOD = M("rt_wood", T_WOOD_A, T_WOOD_N, roughness=0.7)
M_DECO = M("rt_deco", T_DECO_A, T_DECO_N, T_DECO_R, metallic=0.25)
M_VELV = M("rt_velvet", T_VELV_A, T_VELV_N, roughness=0.95, double=True)
M_FAB = M("rt_fabric", T_FAB_A, roughness=0.9, double=True)
M_IRON = M("rt_iron", color=(0.030, 0.032, 0.038, 1), roughness=0.5, metallic=0.85)
# CHANGED(fix_ui_stage) (verifier modes D6): burnished brass 0.35 -> 0.55 roughness - the polished faces mirrored the
# church HDRI's windows (the proscenium pilaster bases flared at luminance 8.8 right behind P1's head at orbit 45 deg)
M_BRASS = M("rt_brass", color=(0.62, 0.42, 0.14, 1), roughness=0.55, metallic=1.0)
M_FLAME = M("rt_flame", color=(1.0, 0.4, 0.05, 1), roughness=1.0, emission=(1.0, 0.34, 0.03, 1), estrength=3.0, double=True)
M_BULB = M("rt_bulb", color=(1.0, 0.85, 0.55, 1), roughness=0.3, emission=(1.0, 0.78, 0.45, 1), estrength=1.6)
M_LENS = M("rt_lens", color=(1.0, 0.8, 0.55, 1), roughness=0.2, emission=(1.0, 0.72, 0.42, 1), estrength=0.9)
M_SIGNF = M("rt_signface", color=(1.0, 0.9, 0.6, 1), roughness=0.4, emission=(1.0, 0.86, 0.5, 1), estrength=1.4)
M_SIGNB = M("rt_signbody", color=(0.36, 0.02, 0.03, 1), roughness=0.78, metallic=0.1)
M_VOID = M("rt_void", color=(0.008, 0.006, 0.01, 1), roughness=1.0)

BULBS = []
FLAMES = []
HERO = {"pit wall + gate": [], "proscenium + marquee": [], "torch pillar": []}


def segs_for(a0, a1, deg=2.5):
    return max(4, int(round(abs(a1 - a0) / deg)))


def tangent(a, k=1.0):
    return (math.cos(math.radians(a)) * k, 0.0, -math.sin(math.radians(a)) * k)


def arc_pts(rad, y, a0, a1, step_deg=3.0):
    n = max(2, int(abs(a1 - a0) / step_deg) + 1)
    return [polar(rad, a0 + (a1 - a0) * k / (n - 1), y) for k in range(n)]


def surface(name, nu, nv, fn, mat, uvfn, flip=False):
    """parametric sheet: fn(u, v) -> game xyz, u across (0..1), v down (0..1); front faces +Z"""
    bm = bmesh.new()
    V = [[bm.verts.new(G(*fn(i / nu, j / nv))) for i in range(nu + 1)] for j in range(nv + 1)]
    uvl = bm.loops.layers.uv.new("UVMap")
    for j in range(nv):
        for i in range(nu):
            idx = [(i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j)]
            if flip:
                idx = list(reversed(idx))
            f = bm.faces.new([V[b][a] for a, b in idx])
            for loop, (a, b) in zip(f.loops, idx):
                loop[uvl].uv = uvfn(a / nu, b / nv)
    return L.finish(bm, name, [mat], uv=False, smooth_angle=75)


def face_yaw(dir_g, local_front=Vector((0, -1, 0))):
    b = G(*dir_g)
    return math.atan2(b.y, b.x) - math.atan2(local_front.y, local_front.x)


# =============================================================== BUILD: the pit
log("pit")
gbox("floor_base", -20.0, 20.0, -0.3, -0.01, -20.0, 20.0, M_FLOOR, tile=2.0)
L.disc("pit_floor", RR + 0.02, 0.0, M_FLOOR, segs=96, tile=2.0)
annulus("pit_plinth", RR, RR + CT, 0.0, 0.3, M_STONE, segs=96, parts=("in",), tile=1.6)
annulus("pit_brick", RR, RR + CT, 0.3, 1.05, M_BRICK, segs=96, parts=("in",), tile=2.0)
annulus("pit_coping", RR - 0.05, RR + CT + 0.06, 1.05, WH, M_STONE, segs=96, tile=1.6)
annulus("stalls", RR + CT + 0.06, 17.6, SY - 0.2, SY, M_WOOD, segs=120, parts=("top",), tile=1.5)
annulus("stalls_lip", RR + CT + 0.06, RR + CT + 0.07, SY - 0.2, WH, M_STONE, segs=96, parts=("out",), tile=1.6)
# iron mooring rings + plates at the 16 sector centres (not on the gates)
for k in range(16):
    a = 22.5 * k
    if a in (90.0, 270.0):
        continue
    p = polar(RR - 0.012, a, 0.78)
    t = tangent(a)
    obox("ring_plate_%d" % k, p, (0.16, 0.16, 0.02), a, M_IRON, tile=0.3, bevel=0.005)
    pts = []
    for j in range(17):
        th = 2 * math.pi * j / 16
        rr_ = 0.075
        pts.append((p[0] + t[0] * rr_ * math.sin(th) - math.sin(math.radians(a)) * 0.03,
                    0.7 - rr_ * math.cos(th) + 0.0, p[2] + t[2] * rr_ * math.sin(th) - math.cos(math.radians(a)) * 0.03))
    tube("ring_iron_%d" % k, pts, 0.012, M_IRON, sides=6, caps=False)


def drain_arch(tag):
    """low barred drain arch in the pit wall, built at the origin facing +Z (wall face z = 0)"""
    ob = []
    w, h = 0.62, 0.52
    arch = [(-w / 2, 0.0), (w / 2, 0.0)] + [(w / 2 * math.cos(math.radians(a)), h - w / 2 + w / 2 * math.sin(math.radians(a)))
                                             for a in range(0, 181, 15)]
    ob.append(prism("drain_void_%s" % tag, arch, 0.02, M_VOID, center_g=(0.0, 0.02, 0.0), face_g=(0, 0, 1), up_g=(0, 1, 0)))
    outer = [(-w / 2 - 0.1, 0.0), (w / 2 + 0.1, 0.0)] + [((w / 2 + 0.1) * math.cos(math.radians(a)),
                                                           h - w / 2 + (w / 2 + 0.1) * math.sin(math.radians(a)))
                                                          for a in range(0, 181, 15)]
    ob.append(prism("drain_frame_%s" % tag, outer, 0.05, M_STONE, center_g=(0.0, 0.02, 0.012), face_g=(0, 0, 1), up_g=(0, 1, 0),
                    holes=[list(reversed(arch))], bevel=0.01, segs=1))
    for j in range(5):
        x = -w / 2 + w * (j + 0.5) / 5
        top = h - w / 2 + math.sqrt(max(0.0, (w / 2) ** 2 - x * x))
        ob.append(tube("drain_bar_%s_%d" % (tag, j), [(x, 0.02, 0.03), (x, top + 0.02, 0.03)], 0.014, M_IRON, sides=6))
    ob.append(tube("drain_crossbar_%s" % tag, [(-w / 2, 0.3, 0.035), (w / 2, 0.3, 0.035)], 0.012, M_IRON, sides=6))
    return ob


for a in (45.0, 135.0, 225.0, 315.0):
    place(drain_arch("%d" % a), polar(RR, a, 0.0), (a + 180.0) % 360.0)


def pit_gate(tag):
    """low iron-banded double gate (fighter entrance), flush in the wall, built at the origin facing +Z"""
    ob = []
    w, h = 1.5, 0.98
    for s in (-1, 1):
        x0, x1 = (s * 0.01, s * w / 2) if s > 0 else (s * w / 2, s * 0.01)
        ob.append(gbox("gate_leaf_%s_%d" % (tag, s), x0, x1, 0.04, h, -0.02, 0.05, M_WOOD, tile=0.8, bevel=0.01))
        for y in (0.22, 0.52, 0.82):
            ob.append(gbox("gate_band_%s_%d_%.2f" % (tag, s, y), x0, x1, y - 0.04, y + 0.04, 0.05, 0.07, M_IRON, tile=0.4,
                           bevel=0.006))
            for j in range(3):
                bx = (x0 + x1) / 2 + (j - 1) * 0.22
                ob.append(sphere("gate_rivet_%s_%d_%.2f_%d" % (tag, s, y, j), (bx, y, 0.075), 0.016, M_IRON, seg=6, rings=4))
        pts = [(s * 0.12 + 0.07 * math.sin(2 * math.pi * j / 12) * 1.0, 0.6 - 0.07 * math.cos(2 * math.pi * j / 12), 0.1)
               for j in range(13)]
        ob.append(tube("gate_ring_%s_%d" % (tag, s), pts, 0.011, M_IRON, sides=6, caps=False))
    ob.append(gbox("gate_frame_t_%s" % tag, -w / 2 - 0.1, w / 2 + 0.1, h, h + 0.07, -0.02, 0.06, M_IRON, tile=0.5, bevel=0.01))
    for s in (-1, 1):
        ob.append(gbox("gate_frame_%s_%d" % (tag, s), s * (w / 2) - 0.06, s * (w / 2) + 0.06, 0.0, h + 0.07, -0.02, 0.06,
                       M_IRON, tile=0.5, bevel=0.01))
    return ob


for a in (90.0, 270.0):
    g = pit_gate("%d" % a)
    place(g, polar(RR - 0.005, a, 0.0), (a + 180.0) % 360.0)
    if a == 270.0:
        HERO["pit wall + gate"] += g
# footlights round the pit. CHANGED(fix_ui_stage) (verifier D11): they were 48 iron hoods LYING ON the coping (0.26 m
# cylinders, top 1.285 m) - with the orbit camera behind the near pit wall they filled the lower frame as big black
# cylinders and covered the far fighter's boots. Now each lamp is RECESSED under the coping lip: a small iron housing on
# the brick face inside the lip's 5 cm overhang (y 1.0-1.05, never above the 1.05 m lip underside, never proud of the lip
# edge) with a glowing slot facing into the pit. Seen from across the pit the far wall shows the footlight ring under the
# coping; from behind the near wall the lamps face away and sit below the coping, so the wall alone decides what the camera
# sees. None over the two fighter gates (their frames reach the lip). Slots chase with the marquee bulbs.
for k in range(48):
    a = 7.5 * k + 3.75
    if min(abs(a - 90.0), abs(a - 270.0)) < 9.0:
        continue
    obox("foot_box_%d" % k, polar(RR - 0.022, a, 1.022), (0.13, 0.05, 0.044), a, M_IRON, tile=0.3, bevel=0.004)
    BULBS.append(obox("foot_lamp_%d" % k, polar(RR - 0.046, a, 1.016), (0.1, 0.018, 0.004), a, M_BULB, tile=0.3))

# =============================================================== BUILD: the old stage (180 deg)
log("stage + proscenium")
SW = 8.2                 # proscenium wall half width
AW = 6.1                 # stage apron half width (the bleacher ends stay clear of it)
gbox("stage_deck", -AW, AW, 0.0, DECK, -17.0, APRON_Z, M_WOOD, tile=2.6)
gbox("stage_apron_trim", -AW, AW, DECK - 0.1, DECK + 0.02, APRON_Z - 0.08, APRON_Z + 0.02, M_BRASS, tile=1.0)
gbox("stage_apron_face", -AW, AW, SY, DECK - 0.1, APRON_Z - 0.02, APRON_Z + 0.04, M_DECO, tile=1.1)
for s in (-1, 1):
    gbox("stage_apron_side_%d" % s, s * AW - 0.03, s * AW + 0.03, SY, DECK, PZ, APRON_Z + 0.04, M_DECO, tile=1.1)
OPX, OPY0, OPY1, ARCH = 5.2, DECK, 6.4, 8.0
RA_ = (OPX * OPX + (ARCH - OPY1) ** 2) / (2 * (ARCH - OPY1))
CY_ = ARCH - RA_
PT = 0.8


def arch_y(x):
    return CY_ + math.sqrt(max(0.0, RA_ * RA_ - x * x))


def proscenium_wall():
    bm = bmesh.new()
    outer = [(-SW, SY), (SW, SY), (SW, 14.0), (-SW, 14.0)]
    inner = [(-OPX, OPY0)]
    n = 24
    for i in range(n + 1):
        x = -OPX + 2 * OPX * i / n
        inner.append((x, arch_y(x)))
    inner.append((OPX, OPY0))
    vo = [bm.verts.new(G(x, y, PZ)) for x, y in outer]
    vi = [bm.verts.new(G(x, y, PZ)) for x, y in inner]
    edges = []
    for Lp in (vo, vi):
        for i in range(len(Lp)):
            edges.append(bm.edges.new((Lp[i], Lp[(i + 1) % len(Lp)])))
    bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=edges)
    faces = list(bm.faces)
    for f in faces:
        f.normal_update()
        if f.normal.y > 0:
            f.normal_flip()
    ext = bmesh.ops.extrude_face_region(bm, geom=faces, use_keep_orig=True)
    ev = [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=ev, vec=Vector((0, PT, 0)))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    return L.finish(bm, "proscenium_wall", [M_PLAST], tile=3.0, smooth_angle=20)


PR = []
PR.append(proscenium_wall())
for s in (-1, 1):
    PR.append(gbox("pilaster_%d" % s, s * OPX, s * (OPX + 1.0), DECK, OPY1, PZ + 0.22, PZ - 0.05, M_DECO, tile=1.4, bevel=0.03))
    PR.append(gbox("pilaster_base_%d" % s, s * (OPX - 0.08), s * (OPX + 1.1), DECK, DECK + 0.45, PZ + 0.3, PZ - 0.05, M_BRASS,
                   tile=1.0, bevel=0.02))
    PR.append(gbox("pilaster_cap_%d" % s, s * (OPX - 0.1), s * (OPX + 1.12), OPY1 - 0.3, OPY1, PZ + 0.32, PZ - 0.05, M_BRASS,
                   tile=1.0, bevel=0.03))


def arch_band(name, r0, r1, z0, z1, mat, n=40):
    bm = bmesh.new()
    th0 = math.asin(min(1.0, OPX / RA_))
    Vf, Vb = [], []
    uvl = bm.loops.layers.uv.new("UVMap")
    for i in range(n + 1):
        th = -th0 + 2 * th0 * i / n
        sx, sy = math.sin(th), math.cos(th)
        Vf.append((bm.verts.new(G(sx * r0, CY_ + sy * r0, z0)), bm.verts.new(G(sx * r1, CY_ + sy * r1, z0))))
        Vb.append((bm.verts.new(G(sx * r0, CY_ + sy * r0, z1)), bm.verts.new(G(sx * r1, CY_ + sy * r1, z1))))
    arc = 2 * th0 * r0
    for i in range(n):
        u0, u1 = arc * i / n / 1.2, arc * (i + 1) / n / 1.2
        quads = [
            ((Vf[i][0], Vf[i + 1][0], Vf[i + 1][1], Vf[i][1]), ((u0, 0), (u1, 0), (u1, 1), (u0, 1))),
            ((Vb[i][0], Vf[i][0], Vf[i + 1][0], Vb[i + 1][0]), ((u0, 0), (u0, .2), (u1, .2), (u1, 0))),
            ((Vf[i][1], Vf[i + 1][1], Vb[i + 1][1], Vb[i][1]), ((u0, 1), (u1, 1), (u1, .8), (u0, .8))),
        ]
        for vs, uvs in quads:
            f = bm.faces.new(vs)
            for loop, uv in zip(f.loops, uvs):
                loop[uvl].uv = uv
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    return L.finish(bm, name, [mat], uv=False, smooth_angle=30)


PR.append(arch_band("arch_band", RA_, RA_ + 1.0, PZ + 0.22, PZ - 0.05, M_DECO))
PR.append(arch_band("arch_trim", RA_ - 0.02, RA_ + 0.1, PZ + 0.26, PZ + 0.1, M_BRASS))
PR.append(cyl("medallion", (0.0, ARCH + 1.25, PZ + 0.2), (0, 0, 1), 0.85, 0.22, M_DECO, sides=40, bevel=0.04))
PR.append(cyl("medallion_ring", (0.0, ARCH + 1.25, PZ + 0.3), (0, 0, 1), 0.95, 0.06, M_BRASS, sides=40))
# stage house + upstage wall
for s in (-1, 1):
    gbox("fly_wall_%d" % s, s * 6.0, s * 6.4, DECK, 13.0, -17.0, PZ - PT, M_PLAST, tile=3.0)
gbox("upstage_wall", -6.4, 6.4, DECK, 13.0, -17.4, -17.0, M_BRICK, tile=2.0)
for i in range(13):                     # stage footlights on the apron edge
    x = -5.4 + i * 0.9
    cyl("sfoot_hood_%d" % i, (x, DECK + 0.06, APRON_Z - 0.12), (1, 0, 0), 0.085, 0.34, M_IRON, sides=10)
    BULBS.append(sphere("sfoot_bulb_%d" % i, (x, DECK + 0.09, APRON_Z - 0.02), 0.045, M_BULB, seg=8, rings=5))

# opera boxes (one tier each side, projecting from the proscenium wall above the bleacher ends)
L.template("curtain_a", os.path.join(FANT, "3d", "PROPS", "SM_PROP_curtain_interior_01.fbx"), mat_override=M_FAB)
L.template("curtain_b", os.path.join(FANT, "3d", "PROPS", "SM_PROP_curtain_interior_03.fbx"), mat_override=M_FAB)
L.template("pelmet", os.path.join(FANT, "3d", "PROPS", "SM_PROP_curtain_interior_04.fbx"), mat_override=M_FAB)
BZ0 = APRON_Z + 0.0
for s in (-1, 1):
    xa, xb = s * 6.3, s * 8.1
    fy = 3.5
    tag = "%d" % s
    gbox("box_slab_" + tag, xa, xb, fy - 0.22, fy, PZ, BZ0, M_WOOD, tile=2.0, bevel=0.02)
    gbox("box_corbel_" + tag, xa + s * 0.25, xb - s * 0.25, fy - 0.6, fy - 0.22, PZ, BZ0 - 0.35, M_DECO, tile=1.2, bevel=0.03)
    gbox("box_front_" + tag, xa, xb, fy, fy + 0.95, BZ0 - 0.12, BZ0, M_DECO, tile=1.0, bevel=0.015)
    gbox("box_rail_" + tag, xa - s * 0.04, xb + s * 0.04, fy + 0.95, fy + 1.06, BZ0 - 0.16, BZ0 + 0.04, M_WOOD, tile=1.5,
         bevel=0.02)
    for xp in (xa, xb):
        gbox("box_part_%s_%.1f" % (tag, xp), xp - 0.06, xp + 0.06, fy, fy + 2.45, PZ, BZ0 - 0.05, M_PLAST, tile=2.0, bevel=0.02)
    gbox("box_roof_" + tag, xa, xb, fy + 2.45, fy + 2.6, PZ, BZ0 + 0.05, M_WOOD, tile=2.0, bevel=0.02)
    gbox("box_door_" + tag, (xa + xb) / 2 - 0.5, (xa + xb) / 2 + 0.5, fy, fy + 2.0, PZ + 0.01, PZ + 0.02, M_VOID)
    L.inst("curtain_a", "boxdrape_in_" + tag, (xa + s * 0.4, fy + 0.02, BZ0 - 0.15), 0.0, 1.0, pivot="bottom")
    L.inst("curtain_b", "boxdrape_out_" + tag, (xb - s * 0.4, fy + 0.02, BZ0 - 0.15), math.pi, 1.0, pivot="bottom")
    for j in range(3):
        x = xa + (xb - xa) * (j + 0.5) / 3
        L.inst("pelmet", "boxpelmet_%s_%d" % (tag, j), (x, fy + 2.44, BZ0 - 0.05), 0.0, 1.0, pivot="top")

# curtains: torn red drapes tied back, valance, rear curtain
log("curtains")
DTOP, DTB = 7.9, DECK + 2.2
VTB = (DTOP - DTB) / (DTOP - DECK)
DZ = PZ - 0.35


def drape(s):
    xo, xt, xtb, xbot = s * 5.3, s * 2.3, s * 4.5, s * 3.9
    wtop = abs(xt - xo)
    rng = L.mulberry32(900 + s)
    tear = [rng() for _ in range(41)]

    def xin(v):
        if v <= VTB:
            t = v / VTB
            return xt + (xtb - xt) * (t ** 1.5)
        t = (v - VTB) / (1 - VTB)
        return xtb + (xbot - xtb) * math.sin(t * math.pi / 2)

    def fn(u, v):
        xi = xin(v)
        x = xo + (xi - xo) * u
        w = abs(xi - xo)
        amp = 0.05 + 0.11 * (1 - w / wtop)
        z = DZ + amp * math.sin(2 * math.pi * 9 * u + 0.6)
        if v < VTB:
            z += 0.14 * math.sin(math.pi * v / VTB) * u
        y = DTOP - (DTOP - DECK - 0.02) * v
        if v > 0.86:
            k = min(40, int(u * 40))
            y += (tear[k] ** 2) * 0.5 * ((v - 0.86) / 0.14)
        return (x, y, z)

    def uvfn(u, v):
        return ((u if s < 0 else 1 - u) * wtop / 1.3, (1 - v) * (DTOP - DECK) / 1.3)
    return surface("drape_%d" % s, 40, 36, fn, M_VELV, uvfn, flip=(s > 0))


PR += [drape(-1), drape(1)]


def valance():
    NS = 5
    x0, x1 = -5.5, 5.5
    ytop = DTOP + 0.2

    def bottom(u):
        p = (u * NS) % 1.0
        return ytop - 1.05 - 0.5 * math.sin(math.pi * p)

    def fn(u, v):
        x = x0 + (x1 - x0) * u
        yb = bottom(u)
        y = ytop - (ytop - yb) * v
        p = (u * NS) % 1.0
        z = DZ + 0.13 + 0.035 * math.sin(2 * math.pi * 60 * u) + 0.13 * math.sin(math.pi * p) * v
        return (x, y, z)

    out = [surface("valance", 240, 8, fn, M_VELV, lambda u, v: (u * 11.0 / 1.3, (1 - v) * 1.6 / 1.3))]

    def fringe(u, v):
        x = x0 + (x1 - x0) * u
        yb = bottom(u)
        p = (u * NS) % 1.0
        z = DZ + 0.13 + 0.035 * math.sin(2 * math.pi * 60 * u) + 0.13 * math.sin(math.pi * p) + 0.01
        return (x, yb + 0.02 - 0.14 * v, z)
    out.append(surface("valance_fringe", 240, 1, fringe, M_BRASS, lambda u, v: (u * 16, v)))
    return out


PR += valance()


def rear_curtain():
    rng = L.mulberry32(77)
    tear = [rng() for _ in range(121)]

    def fn(u, v):
        x = -6.0 + 12.0 * u
        y = 11.0 - (11.0 - DECK - 0.03) * v
        if v > 0.9:
            y += (tear[min(120, int(u * 120))] ** 3) * 0.28 * ((v - 0.9) / 0.1)
        z = -15.6 + 0.13 * math.sin(2 * math.pi * 18 * u)
        return (x, y, z)
    return surface("rear_curtain", 100, 10, fn, M_VELV, lambda u, v: (u * 12.0 / 1.3, (1 - v) * 9.0 / 1.3))


PR.append(rear_curtain())

# the HIT PARADE marquee hanging in the opening (y 3.45-5.15: inside the near orbit frame)
log("marquee")
MZ = -13.1
MB0, MB1, MW = 3.45, 5.15, 3.9
PR.append(gbox("marquee_board", -MW, MW, MB0, MB1, MZ - 0.25, MZ, M_SIGNB, tile=2.0, bevel=0.04))
PR.append(gbox("marquee_frame_t", -MW - 0.1, MW + 0.1, MB1 - 0.05, MB1 + 0.1, MZ - 0.25, MZ + 0.06, M_BRASS, tile=1.0,
               bevel=0.02))
PR.append(gbox("marquee_frame_b", -MW - 0.1, MW + 0.1, MB0 - 0.1, MB0 + 0.05, MZ - 0.25, MZ + 0.06, M_BRASS, tile=1.0,
               bevel=0.02))
for s in (-1, 1):
    PR.append(gbox("marquee_frame_%d" % s, s * (MW - 0.02), s * (MW + 0.1), MB0 - 0.1, MB1 + 0.1, MZ - 0.25, MZ + 0.06,
                   M_BRASS, tile=1.0, bevel=0.02))
    PR.append(tube("marquee_cable_%d" % s, [(s * (MW - 0.8), MB1 + 0.1, MZ - 0.12), (s * (MW - 0.8), 12.5, MZ - 0.12)], 0.02,
                   M_IRON, sides=5))


def sign_text():
    cu = bpy.data.curves.new("sign_txt", "FONT")
    cu.body = "HIT PARADE"
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.size = 0.98
    cu.space_character = 1.06
    cu.extrude = 0.06
    cu.offset = 0.02
    cu.bevel_depth = 0.011
    cu.bevel_resolution = 1
    tob = bpy.data.objects.new("sign_txt", cu)
    L.COL["PROOF"].objects.link(tob)
    tob.rotation_euler = (math.radians(90), 0, 0)
    tob.location = G(0.0, (MB0 + MB1) / 2, MZ + 0.08)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tob.evaluated_get(dg))
    me.transform(tob.matrix_world)
    bpy.data.objects.remove(tob, do_unlink=True)
    me.materials.append(M_SIGNF)
    me.materials.append(M_SIGNB)
    for p in me.polygons:
        p.material_index = 0 if p.normal.y < -0.7 else 1
    L.box_uv(me, 1.0)
    ob = bpy.data.objects.new("marquee_letters", me)
    L.COL["SET"].objects.link(ob)
    return ob


PR.append(sign_text())
k = 0
for (xa, ya, xb, yb, n) in ((-MW + 0.2, MB1 - 0.13, MW - 0.2, MB1 - 0.13, 24), (-MW + 0.2, MB0 + 0.13, MW - 0.2, MB0 + 0.13, 24),
                            (-MW + 0.14, MB0 + 0.36, -MW + 0.14, MB1 - 0.36, 4), (MW - 0.14, MB0 + 0.36, MW - 0.14, MB1 - 0.36, 4)):
    for i in range(n):
        t = i / max(1, n - 1)
        p = (xa + (xb - xa) * t, ya + (yb - ya) * t, MZ + 0.07)
        dead = (k % 9 == 4) or (k % 13 == 7)
        sp = sphere("mbulb_%d" % k, p, 0.05, M_IRON if dead else M_BULB, seg=8, rings=5)
        if not dead:
            BULBS.append(sp)
        k += 1
HERO["proscenium + marquee"] += PR

# =============================================================== kit props
log("kit props")
L.template("torch", QFP + "Torch_Metal.gltf")
L.template("chandelier", QFP + "Chandelier.gltf")
L.template("cage", QFP + "Cage_Small.gltf")
L.template("chaincoil", QFP + "Chain_Coil.gltf")
L.template("bucket", QFP + "Bucket_Metal.gltf")
L.template("cobweb", QMD + "Cobweb.fbx", mat_override=M("rt_cobweb", color=(0.55, 0.55, 0.58, 1), roughness=1.0, double=True))
L.canon_kit_images(prefix_keep=("rt_", "kit_", "tex_"))


def flame(name, base_g):
    """stylised 3-blade flame (crossed teardrop cards), emissive; animated by the view"""
    bm = bmesh.new()
    prof = [(0.0, 0.0), (0.055, 0.05), (0.075, 0.12), (0.06, 0.2), (0.03, 0.28), (0.0, 0.34)]
    for kk in range(3):
        a = math.pi * kk / 3
        d = Vector((math.cos(a), math.sin(a), 0))
        vs = []
        for (r, h) in prof:
            vs.append((d * r + Vector((0, 0, h)), d * -r + Vector((0, 0, h))))
        for i in range(len(prof) - 1):
            bm.faces.new((bm.verts.new(vs[i][0]), bm.verts.new(vs[i + 1][0]), bm.verts.new(vs[i + 1][1]),
                          bm.verts.new(vs[i][1])))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.translate(bm, verts=bm.verts, vec=G(*base_g))
    ob = L.finish(bm, name, [M_FLAME], tile=0.4, smooth_angle=10)
    FLAMES.append(ob)
    return ob


# torch pillars framing the three aisles (r 10.25: the torch heads stay outside the 9.5 m camera orbit)
for a in AISLES:
    for s in (-1, 1):
        pa = a + s * 4.6
        c = polar(10.25, pa, 0.0)
        pil = [obox("pillar_%d_%d" % (a, s), (c[0], SY + 1.0, c[2]), (0.5, 2.0, 0.5), pa, M_STONE, tile=1.6, bevel=0.03),
               obox("pillar_cap_%d_%d" % (a, s), (c[0], SY + 2.06, c[2]), (0.62, 0.14, 0.62), pa, M_STONE, tile=1.6,
                    bevel=0.02),
               obox("pillar_base_%d_%d" % (a, s), (c[0], SY + 0.12, c[2]), (0.62, 0.24, 0.62), pa, M_STONE, tile=1.6,
                    bevel=0.02)]
        inward = polar(-1.0, pa, 0.0)
        ry = face_yaw(inward, Vector((0, -1, 0)))
        tb, tlo, thi = L.TPL["torch"]
        fp = polar(10.25 - 0.26, pa, SY + 1.5)
        t = L.inst("torch", "torch_%d_%d" % (a, s), fp, ry, 1.0, pivot="origin")
        cup = t.matrix_world @ Vector((0.0, (tlo.y + thi.y) * 0.5 - 0.06, thi.z))
        cg = (cup.x, cup.z, -cup.y)
        flame("flame_%d_%d" % (a, s), (cg[0], cg[1] - 0.02, cg[2]))
        L.inst("cobweb", "cobweb_%d_%d" % (a, s), polar(10.25, pa, SY + 1.9), ry + math.radians(35), 0.7, pivot="origin")
        if a == 270.0 and s < 0:
            HERO["torch pillar"] += pil + [t]
    # vomitory arch in the back wall at the aisle end (dark tunnel mouth, stone frame)
    face = (a + 180.0) % 360.0
    arch = [(-0.8, 0.0), (0.8, 0.0)] + [(0.8 * math.cos(math.radians(q)), 1.7 + 0.8 * math.sin(math.radians(q)))
                                         for q in range(0, 181, 15)]
    frame = [(-1.05, 0.0), (1.05, 0.0)] + [(1.05 * math.cos(math.radians(q)), 1.7 + 1.05 * math.sin(math.radians(q)))
                                            for q in range(0, 181, 15)]
    vo = [prism("vom_void_%d" % a, arch, 0.02, M_VOID, center_g=(0.0, 0.0, 0.0), face_g=(0, 0, 1), up_g=(0, 1, 0)),
          prism("vom_frame_%d" % a, frame, 0.14, M_STONE, center_g=(0.0, 0.0, 0.05), face_g=(0, 0, 1), up_g=(0, 1, 0),
                holes=[list(reversed(arch))], bevel=0.015, segs=1)]
    place(vo, polar(BACK_R - 0.02, a, SY), face)
    L.inst("chaincoil", "chaincoil_%d" % a, polar(12.9, a + 1.8, SY), math.radians(a), 1.0)
    L.inst("bucket", "bucket_%d" % a, polar(13.6, a - 2.0, SY), math.radians(a + 40), 1.0)

# chandeliers over the stalls (bottoms ~5.7 m, r 11.8) on chains
for k, a in enumerate((50.0, 130.0, 230.0, 310.0)):
    top = 7.3
    p = polar(11.8, a, top)
    L.inst("chandelier", "chandelier_%d" % k, p, math.radians(a), 1.25, pivot="top")
    L.chain("chandelier_chain_%d" % k, polar(11.8, a, 13.0), p, M_IRON, link_len=0.11, r=0.028)
L.inst("cage", "cage_1", (-4.5, DECK + 1.5, -14.6), 0.4, 1.4, pivot="bottom")
L.chain("cage_chain", (-4.5, 12.0, -14.6), (-4.5, DECK + 1.5 + 0.76 * 1.4, -14.6), M_IRON, link_len=0.11, r=0.028)

# =============================================================== bleachers (horseshoe), rope rail, back wall, dress circle
log("bleachers + balcony")


def tier_profile():
    top = 0.4
    pts = [(TIER_R[0] - 0.45, SY), (TIER_R[-1] + 0.45, SY), (TIER_R[-1] + 0.45, TIER_Y[-1] + top)]
    for k in range(5, 0, -1):
        pts.append((TIER_R[k] - 0.4, TIER_Y[k] + top))
        pts.append((TIER_R[k] - 0.4, TIER_Y[k - 1] + top))
    pts.append((TIER_R[0] - 0.45, TIER_Y[0] + top))
    return pts


def end_panel(name, a, mat, thick=0.3):
    poly = [(-r, y) for (r, y) in tier_profile()]
    return prism(name, poly, thick, mat, center_g=(0.0, 0.0, 0.0), face_g=tangent(a), up_g=(0, 1, 0), bevel=0.02, segs=1)


for bid, a0, a1, seed in BAYS:
    sg = segs_for(a0, a1)
    for k in range(1, 6):
        annulus("tier_%s_%d" % (bid, k), TIER_R[k] - 0.4, TIER_R[k] + 0.4, SY, TIER_Y[k], M_WOOD, segs=sg, a0=a0, a1=a1,
                tile=2.4, parts=("in", "top", "ends"))
        annulus("tier_nose_%s_%d" % (bid, k), TIER_R[k] - 0.43, TIER_R[k] - 0.37, TIER_Y[k] - 0.05, TIER_Y[k] + 0.01,
                M_WOOD, segs=sg, a0=a0, a1=a1, parts=("in", "top"), tile=1.2)
    for s_, a in ((0, a0), (1, a1)):
        end_panel("bay_end_%s_%d" % (bid, s_), a, M_STONE)
    # brass stanchions + velvet ropes (r 9.75, on the stalls floor)
    n = max(2, int(math.radians(a1 - a0) * 9.75 / 2.4) + 1)
    posts = [a0 + 1.2 + (a1 - a0 - 2.4) * j / (n - 1) for j in range(n)]
    for j, a in enumerate(posts):
        c = polar(9.75, a, 0.0)
        cyl("stanchion_%s_%d" % (bid, j), (c[0], SY + 0.46, c[2]), (0, 1, 0), 0.028, 0.92, M_BRASS, sides=10)
        cyl("stanchion_base_%s_%d" % (bid, j), (c[0], SY + 0.02, c[2]), (0, 1, 0), 0.08, 0.04, M_BRASS, sides=14)
        sphere("stanchion_top_%s_%d" % (bid, j), (c[0], SY + 0.95, c[2]), 0.055, M_BRASS)
    for j in range(len(posts) - 1):
        pts = []
        for q in range(13):
            t = q / 12.0
            aa = posts[j] + (posts[j + 1] - posts[j]) * t
            c = polar(9.75, aa, 0.0)
            pts.append((c[0], SY + 0.86 - 0.2 * 4 * t * (1 - t), c[2]))
        tube("rope_%s_%d" % (bid, j), pts, 0.03, M_VELV, sides=6)
# back wall under the balcony (maroon plaster over a brick dado), balcony slab, gilded parapet, balcony crowd tiers
BA0, BA1 = 214.0 - 4.0, 146.0 + 360.0 + 4.0
annulus("back_dado", BACK_R, BACK_R + 0.3, SY, SY + 1.1, M_BRICK, segs=segs_for(BA0, BA1), a0=BA0, a1=BA1, tile=2.0,
        parts=("in",))
annulus("back_wall", BACK_R, BACK_R + 0.3, SY + 1.1, BAL_Y - 0.2, M_PLAST, segs=segs_for(BA0, BA1), a0=BA0, a1=BA1,
        tile=3.0, parts=("in", "ends"))
annulus("bal_slab", BACK_R - 0.1, 17.6, BAL_Y - 0.25, BAL_Y, M_WOOD, segs=segs_for(BA0, BA1), a0=BA0, a1=BA1, tile=2.4,
        parts=("top", "bottom", "in", "ends"))
annulus("bal_parapet", BACK_R - 0.1, BACK_R + 0.05, BAL_Y, BAL_Y + 0.85, M_DECO, segs=segs_for(BA0, BA1), a0=BA0, a1=BA1,
        tile=1.0, parts=("in", "out", "ends"))
annulus("bal_rail", BACK_R - 0.14, BACK_R + 0.09, BAL_Y + 0.85, BAL_Y + 0.95, M_WOOD, segs=segs_for(BA0, BA1), a0=BA0,
        a1=BA1, tile=1.5)
annulus("bal_tier", 15.65, 16.45, BAL_Y, BAL_Y + 0.45, M_WOOD, segs=segs_for(BA0, BA1), a0=BA0, a1=BA1, tile=2.4,
        parts=("in", "top", "ends"))
annulus("bal_back", 17.3, 17.6, BAL_Y, 12.0, M_PLAST, segs=segs_for(BA0, BA1), a0=BA0, a1=BA1, tile=3.0, parts=("in", "ends"))
annulus("bal_soffit_trim", BACK_R - 0.12, BACK_R + 0.02, BAL_Y - 0.4, BAL_Y - 0.25, M_BRASS, segs=segs_for(BA0, BA1),
        a0=BA0, a1=BA1, tile=1.0)
for k in range(10):                      # box pilasters along the balcony front
    a = BA0 + 8.0 + (BA1 - BA0 - 16.0) * k / 9
    obox("bal_pil_%d" % k, polar(BACK_R - 0.14, a, BAL_Y + 0.42), (0.22, 0.95, 0.12), a, M_BRASS, tile=0.5, bevel=0.02)


def spotcan(name, pos_g, target_g):
    d = Vector(target_g) - Vector(pos_g)
    q = Vector((0, 0, 1)).rotation_difference(G(*d).normalized())
    parts = []
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=14, radius1=0.15, radius2=0.17, depth=0.42)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=q.to_matrix())
    bmesh.ops.translate(bm, verts=bm.verts, vec=G(*pos_g))
    parts.append(L.finish(bm, name + "_body", [M_IRON], tile=0.5))
    lens = G(*pos_g) + q @ Vector((0, 0, 0.215))
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, segments=14, radius=0.14)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=q.to_matrix())
    bmesh.ops.translate(bm, verts=bm.verts, vec=lens)
    parts.append(L.finish(bm, name + "_lens", [M_LENS], tile=0.5))
    return parts


for a in (30.0, 60.0, 90.0, 270.0, 300.0, 330.0):     # spot cans on the balcony rail (60 / 300 = the pool's spots)
    spotcan("bal_spot_%d" % a, polar(BACK_R - 0.3, a, BAL_Y + 1.2), (0.0, 1.0, 0.0))

# upper circle wall with dark boxes (reads as the upper circle in far / high shots)
annulus("upper_wall", 17.6, 17.9, 12.0, 14.0, M_PLAST, segs=segs_for(BA0, BA1), a0=BA0, a1=BA1, tile=3.0, parts=("in",))

# =============================================================== nodes, crowd, ship
bl = L.join_objs(BULBS, "marquee_bulbs")
L.ANIM["marquee_bulbs"] = bl
fl = L.join_objs(FLAMES, "flame_torches")
L.ANIM["flame_torches"] = fl
log("bulbs", len(BULBS), "flames", len(FLAMES))
nodes = L.crowd_nodes(S)
L.env_map(HDRI, SID + "_env.hdr") if L.DO_EXPORT else None
heroes = [("pit wall + gate", HERO["pit wall + gate"], 1.2), ("proscenium + marquee", HERO["proscenium + marquee"], 3.0),
          ("torch pillar", HERO["torch pillar"], 2.2)]
L.build_and_ship(S, HDRI, nodes, [("Ch42", "Ch42_nonPBR.fbx", []), ("Brute", "Brute.fbx", ["BattleAxe"])],
                 extra_shots=[
                     {"id": "overview", "pos": [13.0, 9.0, 13.0], "look": [0.0, 1.5, -2.0], "fov": 60.0},
                     {"id": "top", "pos": [0.0, 32.0, 0.01], "look": [0.0, 0.0, 0.0], "fov": 70.0},
                     {"id": "stage", "pos": [0.0, 2.2, -3.0], "look": [0.0, 3.6, -12.0], "fov": 55.0},
                     {"id": "pit_wall", "pos": [-2.5, 1.2, 1.5], "look": [-5.5, 0.6, 0.0], "fov": 50.0},
                 ], heroes=heroes)
