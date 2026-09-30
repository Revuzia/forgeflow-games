"""HIT PARADE - stage 1 THE RUST THEATER, built headless in Blender (lane STAGES).

A condemned vaudeville theatre turned fight pit: blue-painted brick pit walls (the splat walls at
x = +/-8 m) with iron-banded doors and wall torches on a stone floor; stepped bleachers of crowd
behind the pit; behind them the old stage - torn red-velvet proscenium, opera boxes, chandeliers and
a bulb marquee.

Usage (run blender.exe directly so the log is visible; paths are resolved from this file):
  blender.exe --background --python art/stages/rust_theater.py -- [--no-export] [--no-render]
        [--shots id,id] [--res 1920x1080] [--samples 48] [--no-fighters]
Outputs:
  _harness/scratch/stages_cache/rust_theater_raw.glb   (then: python art/stages/finish_stage.py)
  art/gltf/stages/rust_theater_env.hdr                 (512x256 IBL for the view)
  _harness/_reports/stages/rust_theater_<shot>.png     (proof renders from the game camera)
Reads data/stages.json (light pool, fog, crowd bays, camera proof shots) so renders prove the data.

Axes: everything is authored in GAME coordinates (glTF: +X fight line, +Y up, camera on +Z) via
G(x, y, z) -> Blender (x, -z, y); the glTF exporter's +Y-up conversion maps it back exactly.
Sources (read-only): Quaternius Medieval Village + Fantasy Props MegaKits (CC0), Quaternius Modular
Dungeon (CC0), GYP Stylized Fantasy City textures, Blink Stylized Dungeon textures, Tidal Flask
FANTASTIC Interior (curtains/planks/fabric, extracted to _harness/scratch/stages_cache/fant),
ForgeFlow generated-materials cloth_banner (original), Poly Haven afrikaans_church_interior (CC0).
ASCII only.
"""
import bpy
import bmesh
import sys
import os
import json
import math
import time
from mathutils import Vector, Matrix
import numpy as np

T0 = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True   # no __pycache__ inside art/stages
import crowd_atlas as CA  # noqa: E402  (toon material + static retarget, render-only stand-ins)

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    if name in ARGS:
        i = ARGS.index(name)
        if i + 1 < len(ARGS) and not ARGS[i + 1].startswith("--"):
            return ARGS[i + 1]
        return True
    return default


DO_EXPORT = not arg("--no-export", False)
DO_RENDER = not arg("--no-render", False)
DO_FIGHTERS = not arg("--no-fighters", False)
RES = [int(v) for v in str(arg("--res", "1920x1080")).split("x")]
SAMPLES = int(arg("--samples", 48))
SHOTS = arg("--shots", None)

CACHE = os.path.join(ROOT, "_harness", "scratch", "stages_cache")
TEX = os.path.join(CACHE, "tex_rust")
REP = os.path.join(ROOT, "_harness", "_reports", "stages")
GLTF_OUT = os.path.join(ROOT, "art", "gltf", "stages")
RAW_GLB = os.path.join(CACHE, "rust_theater_raw.glb")
for d in (CACHE, TEX, REP, GLTF_OUT):
    os.makedirs(d, exist_ok=True)

STAGES = json.load(open(os.path.join(ROOT, "data", "stages.json"), encoding="utf-8"))
S = next(s for s in STAGES["stages"] if s["id"] == "rust_theater")

A = "F:/games/forgeflow-games-assets"
U = "F:/games/unity-assets"
QMV = A + "/3d-models/medieval-village-mega/Medieval Village MegaKit[Standard]/glTF/"
QFP = A + "/3d-models/fantasy-props-mega/Exports/glTF/"
QMD = A + "/3d-models/modular-dungeon/.Updated Modular Dungeon - May 2019/FBX/"
GYP = U + "/GYP Studios__Stylized Fantasy City - Exterior Modular/Assets/Stylized Fantasy City - Exterior Modular/Textures/Wall/"
BLINK = U + "/Blink__Stylized Dungeon Textures - RPG Environment/Assets/Blink/Art/Textures/StylizedDungeonTextures/"
FANT = os.path.join(CACHE, "fant", "Assets", "Fantastic Interior Pack")
GEN = A + "/generated-materials/"
HDRI = A + "/_downloaded/polyhaven-hdris/afrikaans_church_interior/afrikaans_church_interior_2k.hdr"


def log(*a):
    print("[rust %6.1fs]" % (time.time() - T0), *a, flush=True)


def G(x, y, z):
    """game/glTF (x, y, z) -> Blender (x, -z, y)"""
    return Vector((x, -z, y))


def hex_lin(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return tuple((v / 12.92) if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


def hex_srgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def mulberry32(seed):
    st = [seed & 0xFFFFFFFF]

    def f():
        st[0] = (st[0] + 0x6D2B79F5) & 0xFFFFFFFF
        t = st[0]
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t = (t ^ ((t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0
    return f


# =============================================================== scene
bpy.ops.wm.read_factory_settings(use_empty=True)
SCN = bpy.context.scene
COL_SET = bpy.data.collections.new("SET")          # exported geometry
COL_NODES = bpy.data.collections.new("NODES")      # exported empties (crowd_*)
COL_PROOF = bpy.data.collections.new("PROOF")      # render-only (fighters, crowd cards, lights)
COL_TPL = bpy.data.collections.new("TEMPLATES")    # imported prop templates (hidden)
for c in (COL_SET, COL_NODES, COL_PROOF, COL_TPL):
    SCN.collection.children.link(c)
COL_TPL.hide_render = True
COL_TPL.hide_viewport = True


def link(ob, col=COL_SET):
    for c in ob.users_collection:
        c.objects.unlink(ob)
    col.objects.link(ob)
    return ob


# =============================================================== textures
def _px(img):
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def _set_px(img, arr):
    img.pixels.foreach_set(arr.astype(np.float32).ravel())
    img.update()


def prep(src, name, size, noncolor=False, fn=None):
    """load -> resize -> optional numpy fn(HxWx4 sRGB-encoded floats) -> save PNG in the cache."""
    out = os.path.join(TEX, name + ".png")
    img = bpy.data.images.load(src, check_existing=False)
    img.name = name
    if noncolor:
        img.colorspace_settings.name = "Non-Color"
    if img.size[0] != size or img.size[1] != size:
        img.scale(size, size)
    if fn is not None:
        _set_px(img, fn(_px(img)))
    img.filepath_raw = out
    img.file_format = "PNG"
    img.save()
    return img


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
    L = _lum(p)
    lo, hi = np.percentile(L, 4), np.percentile(L, 97)
    t = np.clip((L - lo) / max(1e-3, hi - lo), 0, 1)
    navy = np.array([0.075, 0.125, 0.235], np.float32)
    steel = np.array([0.36, 0.49, 0.70], np.float32)
    col = navy[None, None, :] * (1 - t[..., None]) + steel[None, None, :] * t[..., None]
    h, w = L.shape
    n = 0.6 * _tile_noise(h, w, 12, 7) + 0.4 * _tile_noise(h, w, 40, 11)
    chip = np.clip((n - 0.64) / 0.06, 0, 1) * (t > 0.42)
    raw = p[..., :3] * np.array([0.78, 0.72, 0.66], np.float32)   # old brick under the paint
    col = col * (1 - chip[..., None]) + raw * chip[..., None]
    grime = 0.86 + 0.14 * _tile_noise(h, w, 6, 3)
    out = p.copy()
    out[..., :3] = np.clip(col * grime[..., None], 0, 1)
    return out


def fn_floor(p):
    L = _lum(p)[..., None]
    c = p[..., :3] * 0.62 + L * 0.38
    out = p.copy()
    out[..., :3] = np.clip(c * np.array([0.60, 0.61, 0.67], np.float32), 0, 1)
    return out


def fn_plaster(p):
    """white plaster -> old maroon theatre paint; exposed brick kept but darkened."""
    r, g, b = p[..., 0], p[..., 1], p[..., 2]
    L = _lum(p)
    brick = np.clip(((r - g) - 0.08) / 0.12, 0, 1)
    lo, hi = np.percentile(L, 5), np.percentile(L, 98)
    t = np.clip((L - lo) / max(1e-3, hi - lo), 0, 1)
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


def fn_rough_from_smooth(p):
    """Unity MTSM (metal R, smoothness A) -> roughness grey."""
    out = p.copy()
    r = 1.0 - p[..., 3]
    out[..., 0] = r
    out[..., 1] = r
    out[..., 2] = r
    out[..., 3] = 1.0
    return out


# =============================================================== materials
def mat_pbr(name, albedo=None, normal=None, rough=None, color=(0.8, 0.8, 0.8, 1), roughness=0.85,
            metallic=0.0, emission=None, estrength=0.0, nstrength=1.0, double=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bs = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    if albedo is not None:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = albedo
        nt.links.new(t.outputs["Color"], bs.inputs["Base Color"])
    else:
        bs.inputs["Base Color"].default_value = color
    if normal is not None:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = normal
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = nstrength
        nt.links.new(t.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bs.inputs["Normal"])
    if rough is not None:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = rough
        nt.links.new(t.outputs["Color"], bs.inputs["Roughness"])
    else:
        bs.inputs["Roughness"].default_value = roughness
    bs.inputs["Metallic"].default_value = metallic
    if emission is not None:
        bs.inputs["Emission Color"].default_value = emission
        bs.inputs["Emission Strength"].default_value = estrength
    m.use_backface_culling = not double
    return m


log("textures")
T_BRICK_A = prep(QMV + "T_Brick_BaseColor.png", "rt_bluebrick_a", 1024, fn=fn_blue_brick)
T_BRICK_N = prep(QMV + "T_Brick_Normal.png", "rt_bluebrick_n", 1024, True)
T_BRICK_R = prep(QMV + "T_Brick_Roughness.png", "rt_bluebrick_r", 512, True)
T_STONE_A = prep(GYP + "Rock/Wall_Rock_01_Blue_Albedo.tif", "rt_bluestone_a", 1024, fn=fn_scale((0.9, 0.95, 1.05)))
T_STONE_N = prep(GYP + "Rock/Wall_Rock_01_Normal.tif", "rt_bluestone_n", 512, True)
T_FLOOR_A = prep(QMV + "T_UnevenBrick_BaseColor.png", "rt_floor_a", 1024, fn=fn_floor)
T_FLOOR_N = prep(QMV + "T_UnevenBrick_Normal.png", "rt_floor_n", 1024, True)
T_FLOOR_R = prep(QMV + "T_UnevenBrick_Roughness.png", "rt_floor_r", 512, True, fn=lambda p: np.dstack([0.62 + 0.38 * p[..., :3], p[..., 3:]]))
T_PLAST_A = prep(GYP + "Damaged/Wall_Brick_Damaged_01_Albedo.tif", "rt_plaster_a", 1024, fn=fn_plaster)
T_PLAST_N = prep(GYP + "Damaged/Wall_Brick_Damaged_01_Normal.tif", "rt_plaster_n", 512, True)
T_WOOD_A = prep(os.path.join(FANT, "2d", "textures", "T_ENV_MOD_Interior_PlanksLong_01_v1_BC.png"), "rt_planks_a", 1024,
                fn=fn_scale((0.72, 0.66, 0.62)))
T_WOOD_N = prep(os.path.join(FANT, "2d", "textures", "T_ENV_MOD_Interior_PlanksLong_01_N.png"), "rt_planks_n", 512, True)
T_DECO_A = prep(BLINK + "Stone_Gate/Stone_Gate_BaseColor.png", "rt_deco_a", 1024)
T_DECO_N = prep(BLINK + "Stone_Gate/Stone_Gate_Normal.png", "rt_deco_n", 512, True)
T_DECO_R = prep(BLINK + "Stone_Gate/Stone_Gate_Roughness.png", "rt_deco_r", 512, True)
T_VELV_A = prep(GEN + "cloth_banner_albedo.webp", "rt_velvet_a", 512, fn=fn_scale((0.82, 0.78, 0.8)))
T_VELV_N = prep(GEN + "cloth_banner_normal.webp", "rt_velvet_n", 512, True)
T_FAB_A = prep(os.path.join(FANT, "2d", "textures", "T_PROP_fabrics_interior_BC.png"), "rt_fabric_a", 512)

M_BRICK = mat_pbr("rt_bluebrick", T_BRICK_A, T_BRICK_N, T_BRICK_R)
M_STONE = mat_pbr("rt_bluestone", T_STONE_A, T_STONE_N, roughness=0.8)
M_FLOOR = mat_pbr("rt_floor", T_FLOOR_A, T_FLOOR_N, T_FLOOR_R)
M_PLAST = mat_pbr("rt_plaster", T_PLAST_A, T_PLAST_N, roughness=0.9)
M_WOOD = mat_pbr("rt_wood", T_WOOD_A, T_WOOD_N, roughness=0.7)
M_DECO = mat_pbr("rt_deco", T_DECO_A, T_DECO_N, T_DECO_R, metallic=0.25)
M_VELV = mat_pbr("rt_velvet", T_VELV_A, T_VELV_N, roughness=0.95, double=True)
M_FAB = mat_pbr("rt_fabric", T_FAB_A, roughness=0.9, double=True)
M_IRON = mat_pbr("rt_iron", color=(0.030, 0.032, 0.038, 1), roughness=0.5, metallic=0.85)
M_BRASS = mat_pbr("rt_brass", color=(0.62, 0.42, 0.14, 1), roughness=0.35, metallic=1.0)
M_FLAME = mat_pbr("rt_flame", color=(1.0, 0.4, 0.05, 1), roughness=1.0, emission=(1.0, 0.34, 0.03, 1), estrength=3.0,
                  double=True)
M_BULB = mat_pbr("rt_bulb", color=(1.0, 0.85, 0.55, 1), roughness=0.3, emission=(1.0, 0.78, 0.45, 1), estrength=5.0)
M_LENS = mat_pbr("rt_lens", color=(1.0, 0.8, 0.55, 1), roughness=0.2, emission=(1.0, 0.72, 0.42, 1), estrength=0.9)
M_SIGNF = mat_pbr("rt_signface", color=(1.0, 0.9, 0.6, 1), roughness=0.4, emission=(1.0, 0.86, 0.5, 1), estrength=3.5)
M_SIGNB = mat_pbr("rt_signbody", color=(0.36, 0.02, 0.03, 1), roughness=0.78, metallic=0.1)
M_VOID = mat_pbr("rt_void", color=(0.008, 0.006, 0.01, 1), roughness=1.0)


# =============================================================== geometry helpers
def finish(bm, name, mats, tile=2.0, smooth_angle=40.0, col=COL_SET, uv=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for mm in mats:
        me.materials.append(mm)
    if uv and not me.uv_layers:
        box_uv(me, tile)
    for p in me.polygons:
        p.use_smooth = True
    try:
        me.set_sharp_from_angle(angle=math.radians(smooth_angle))
    except Exception:
        pass
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    return ob


def box_uv(me, tile, off=(0.0, 0.0)):
    uvl = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        n = poly.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if az >= ax and az >= ay:
                u, v = co.x, co.y * (1 if n.z > 0 else -1)
            elif ax >= ay:
                u, v = co.y * (1 if n.x > 0 else -1), co.z
            else:
                u, v = -co.x * (1 if n.y > 0 else -1), co.z
            uvl.data[li].uv = (u / tile + off[0], v / tile + off[1])


def gbox(name, x0, x1, y0, y1, z0, z1, mat, tile=2.0, bevel=0.0, segs=2, col=COL_SET):
    """axis-aligned box in GAME coordinates, optional bevel on every edge."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bx0, bx1 = min(x0, x1), max(x0, x1)
    by0, by1 = -max(z0, z1), -min(z0, z1)
    bz0, bz1 = min(y0, y1), max(y0, y1)
    for v in bm.verts:
        v.co.x = bx0 + (v.co.x + 0.5) * (bx1 - bx0)
        v.co.y = by0 + (v.co.y + 0.5) * (by1 - by0)
        v.co.z = bz0 + (v.co.z + 0.5) * (bz1 - bz0)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=segs, profile=0.5, affect="EDGES",
                        clamp_overlap=True)
    return finish(bm, name, [mat], tile, col=col)


def tube(name, pts, r, mat, sides=6, col=COL_SET, caps=True):
    """tube along game-space points"""
    bm = bmesh.new()
    P = [G(*p) for p in pts]
    rings = []
    for i, p in enumerate(P):
        d = (P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]).normalized()
        up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
        a = d.cross(up).normalized()
        b = d.cross(a).normalized()
        rings.append([bm.verts.new(p + (a * math.cos(2 * math.pi * k / sides) + b * math.sin(2 * math.pi * k / sides)) * r)
                      for k in range(sides)])
    for i in range(len(rings) - 1):
        for k in range(sides):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % sides], rings[i + 1][(k + 1) % sides], rings[i + 1][k]))
    if caps:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    return finish(bm, name, [mat], 0.5, smooth_angle=60, col=col)


def cyl(name, center_g, axis_g, r, length, mat, sides=16, bevel=0.0, col=COL_SET):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=sides, radius1=r, radius2=r, depth=length)
    if bevel > 0:
        edges = [e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) < 1e-6 and abs(abs(e.verts[0].co.z) - length / 2) < 1e-6]
        bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=2, profile=0.5, affect="EDGES", clamp_overlap=True)
    ax = G(*axis_g).normalized()
    q = Vector((0, 0, 1)).rotation_difference(ax)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=q.to_matrix())
    bmesh.ops.translate(bm, verts=bm.verts, vec=G(*center_g))
    return finish(bm, name, [mat], 0.6, smooth_angle=50, col=col)


def sphere(name, center_g, r, mat, seg=8, rings=6, col=COL_SET):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    bmesh.ops.translate(bm, verts=bm.verts, vec=G(*center_g))
    return finish(bm, name, [mat], 0.5, smooth_angle=80, col=col)


def surface(name, nu, nv, fn, mat, uvfn, col=COL_SET, flip=False):
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
    return finish(bm, name, [mat], uv=False, smooth_angle=75, col=col)


def aim_quat(dir_g, local_axis=Vector((0, 0, 1))):
    return local_axis.rotation_difference(G(*dir_g).normalized())


# =============================================================== prop templates
TPL = {}


def template(key, path, mat_override=None, keep_mats=True):
    before = set(bpy.data.objects)
    if path.lower().endswith(".fbx"):
        bpy.ops.import_scene.fbx(filepath=path)
    else:
        bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    for o in meshes:
        o.data = o.data.copy()
        o.data.transform(o.matrix_world)
    for o in new:
        if o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)
    # bake world transforms into the mesh data (FBX 0.01 scale trap), join into one template object
    for o in meshes:
        o.parent = None
        o.matrix_world = Matrix.Identity(4)
    base = meshes[0]
    if len(meshes) > 1:
        with bpy.context.temp_override(active_object=base, selected_editable_objects=meshes, object=base):
            bpy.ops.object.join()
    if mat_override is not None:
        base.data.materials.clear()
        base.data.materials.append(mat_override)
    base.name = "tpl_" + key
    link(base, COL_TPL)
    vs = [v.co for v in base.data.vertices]
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    TPL[key] = (base, lo, hi)
    return base


def inst(key, name, loc_g, rot_z=0.0, scale=1.0, pivot="bottom", col=COL_SET):
    """linked copy of a template; pivot: 'bottom' (bbox bottom centre), 'origin' (asset origin),
    'wall' (bbox centre x/z, +Y side = asset back), 'top' (bbox top centre)"""
    base, lo, hi = TPL[key]
    ob = bpy.data.objects.new(name, base.data)
    col.objects.link(ob)
    if pivot == "bottom":
        off = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    elif pivot == "top":
        off = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, hi.z))
    elif pivot == "center":
        off = (lo + hi) / 2
    else:
        off = Vector((0, 0, 0))
    M = Matrix.Translation(G(*loc_g)) @ Matrix.Rotation(rot_z, 4, "Z") @ Matrix.Scale(scale, 4) @ Matrix.Translation(-off)
    ob.matrix_world = M
    return ob


def face_yaw(dir_g, local_front=Vector((0, -1, 0))):
    """Blender Z rotation that turns local_front (Blender) toward game direction dir_g"""
    b = G(*dir_g)
    return math.atan2(b.y, b.x) - math.atan2(local_front.y, local_front.x)


# =============================================================== BUILD: pit
log("build pit")
W = 8.0          # splat wall inner face |x|
WT = 0.6         # wall thickness
WZ0, WZ1 = -3.0, 2.8   # wall run between the pillars
PZB, PZF = -3.45, 3.25  # pillar centres (back / front)
gbox("floor_pit", -12.0, 12.0, -0.2, 0.0, -3.2, 8.0, M_FLOOR, tile=2.0)
gbox("floor_hall", -14.3, 14.3, -0.2, 0.0, -9.2, -3.2, M_FLOOR, tile=2.0)

for s in (-1, 1):
    xi, xo = s * W, s * (W + WT)
    gbox("wall_plinth_%d" % s, xi - s * 0.05, xo, 0.0, 0.85, WZ0, WZ1, M_STONE, tile=1.6, bevel=0.02)
    gbox("wall_brick_%d" % s, xi, xo, 0.85, 4.2, WZ0, WZ1, M_BRICK, tile=2.0)
    gbox("wall_cornice_%d" % s, xi - s * 0.12, xo, 4.2, 4.45, WZ0, WZ1, M_STONE, tile=1.6, bevel=0.03)
    for pz in (PZB, PZF):
        px = s * (W + 0.3)
        gbox("pillar_%d_%d" % (s, pz > 0), px - 0.45, px + 0.45, 0.0, 4.9, pz - 0.45, pz + 0.45, M_STONE, tile=1.6,
             bevel=0.035)
        gbox("pillar_base_%d_%d" % (s, pz > 0), px - 0.52, px + 0.52, 0.0, 0.45, pz - 0.52, pz + 0.52, M_STONE, tile=1.6,
             bevel=0.03)
        gbox("pillar_cap_%d_%d" % (s, pz > 0), px - 0.53, px + 0.53, 4.9, 5.12, pz - 0.53, pz + 0.53, M_STONE, tile=1.6,
             bevel=0.03)

# pit back barrier (between and beyond the back pillars)
for (xa, xb) in ((-14.3, -8.82), (-7.78, 7.78), (8.82, 14.3)):
    gbox("barrier_plinth_%.0f" % xa, xa, xb, 0.0, 0.5, -3.7, -3.18, M_STONE, tile=1.6, bevel=0.02)
    gbox("barrier_brick_%.0f" % xa, xa, xb, 0.5, 1.15, -3.68, -3.2, M_BRICK, tile=2.0)
    gbox("barrier_cap_%.0f" % xa, xa, xb, 1.15, 1.27, -3.76, -3.12, M_STONE, tile=1.6, bevel=0.025)

# brass stanchions + velvet ropes on the barrier cap
posts = [-7.5, -5.0, -2.5, 0.0, 2.5, 5.0, 7.5]
for i, x in enumerate(posts):
    cyl("stanchion_%d" % i, (x, 1.27 + 0.37, -3.44), (0, 1, 0), 0.028, 0.74, M_BRASS, sides=10)
    cyl("stanchion_base_%d" % i, (x, 1.29, -3.44), (0, 1, 0), 0.075, 0.04, M_BRASS, sides=14)
    sphere("stanchion_top_%d" % i, (x, 2.03, -3.44), 0.055, M_BRASS)
for i in range(len(posts) - 1):
    xa, xb = posts[i], posts[i + 1]
    pts = []
    for k in range(13):
        t = k / 12.0
        pts.append((xa + (xb - xa) * t, 1.93 - 0.2 * 4 * t * (1 - t), -3.44))
    tube("rope_%d" % i, pts, 0.03, M_VELV, sides=6)

# bleachers (4 stepped tiers) + back rail
TIERS = [(-3.7, -4.5, 0.3), (-4.5, -5.3, 0.6), (-5.3, -6.1, 0.9), (-6.1, -6.9, 1.2)]
for k, (za, zb, y) in enumerate(TIERS):
    gbox("tier_%d" % k, -14.3, 14.3, y - 0.3 if k else 0.0, y, zb, za, M_WOOD, tile=2.4, bevel=0.012, segs=1)
gbox("tier_back", -14.3, 14.3, 0.0, 1.2, -7.1, -6.9, M_WOOD, tile=2.4)

# hall side walls + parterre
for s in (-1, 1):
    gbox("hall_wall_%d" % s, s * 14.3, s * 14.7, 0.0, 12.0, -10.2, -3.2, M_PLAST, tile=3.0)
    gbox("hall_wainscot_%d" % s, s * 14.2, s * 14.3, 0.0, 1.3, -10.2, -3.2, M_BRICK, tile=2.0)

# =============================================================== BUILD: stage + proscenium
log("build stage")
PZ = -10.2        # proscenium front face
PT = 0.8          # thickness
DECK = 1.1
gbox("stage_deck", -14.3, 14.3, 0.0, DECK, -24.0, -9.0, M_WOOD, tile=2.6)
gbox("stage_apron_trim", -14.3, 14.3, DECK - 0.1, DECK + 0.02, -9.08, -8.98, M_BRASS, tile=1.0)
gbox("stage_apron_face", -14.3, 14.3, 0.0, DECK - 0.1, -9.02, -8.96, M_DECO, tile=1.1)

# proscenium wall with a segmental-arch opening (scanfill with a hole, then extruded back)
OPX, OPY0, OPY1, ARCH = 6.5, DECK, 7.2, 8.8
R = (OPX * OPX + (ARCH - OPY1) ** 2) / (2 * (ARCH - OPY1))
CY = ARCH - R


def arch_y(x):
    return CY + math.sqrt(max(0.0, R * R - x * x))


def proscenium_wall():
    bm = bmesh.new()
    outer = [(-14.3, 0.0), (14.3, 0.0), (14.3, 16.0), (-14.3, 16.0)]
    inner = [(-OPX, OPY0)]
    n = 24
    for i in range(n + 1):
        x = -OPX + 2 * OPX * i / n
        inner.append((x, arch_y(x)))
    inner.append((OPX, OPY0))
    vo = [bm.verts.new(G(x, y, PZ)) for x, y in outer]
    vi = [bm.verts.new(G(x, y, PZ)) for x, y in inner]
    edges = []
    for L in (vo, vi):
        for i in range(len(L)):
            edges.append(bm.edges.new((L[i], L[(i + 1) % len(L)])))
    bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=edges)
    faces = list(bm.faces)
    for f in faces:
        f.normal_update()
        if f.normal.y > 0:          # front must face game +Z = Blender -Y
            f.normal_flip()
    ext = bmesh.ops.extrude_face_region(bm, geom=faces, use_keep_orig=True)
    ev = [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=ev, vec=Vector((0, PT, 0)))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    return finish(bm, "proscenium_wall", [M_PLAST], tile=3.0, smooth_angle=20)


proscenium_wall()

# gilded frame: pilasters + arch band + medallion
for s in (-1, 1):
    gbox("pilaster_%d" % s, s * OPX, s * (OPX + 1.15), DECK, OPY1, PZ + 0.22, PZ - 0.05, M_DECO, tile=1.4, bevel=0.03)
    gbox("pilaster_base_%d" % s, s * (OPX - 0.08), s * (OPX + 1.25), DECK, DECK + 0.45, PZ + 0.3, PZ - 0.05, M_BRASS,
         tile=1.0, bevel=0.02)
    gbox("pilaster_cap_%d" % s, s * (OPX - 0.1), s * (OPX + 1.27), OPY1 - 0.3, OPY1, PZ + 0.32, PZ - 0.05, M_BRASS,
         tile=1.0, bevel=0.03)


def arch_band(name, r0, r1, z0, z1, mat, n=40):
    bm = bmesh.new()
    th0 = math.asin(min(1.0, (OPX + 0.0) / R))
    Vf, Vb = [], []
    uvl = bm.loops.layers.uv.new("UVMap")
    for i in range(n + 1):
        th = -th0 + 2 * th0 * i / n
        sx, sy = math.sin(th), math.cos(th)
        Vf.append((bm.verts.new(G(sx * r0, CY + sy * r0, z0)), bm.verts.new(G(sx * r1, CY + sy * r1, z0))))
        Vb.append((bm.verts.new(G(sx * r0, CY + sy * r0, z1)), bm.verts.new(G(sx * r1, CY + sy * r1, z1))))
    arc = 2 * th0 * r0
    for i in range(n):
        u0, u1 = arc * i / n / 1.2, arc * (i + 1) / n / 1.2
        quads = [
            ((Vf[i][0], Vf[i + 1][0], Vf[i + 1][1], Vf[i][1]), ((u0, 0), (u1, 0), (u1, 1), (u0, 1))),   # front
            ((Vb[i][0], Vf[i][0], Vf[i + 1][0], Vb[i + 1][0]), ((u0, 0), (u0, .2), (u1, .2), (u1, 0))),   # soffit
            ((Vf[i][1], Vf[i + 1][1], Vb[i + 1][1], Vb[i][1]), ((u0, 1), (u1, 1), (u1, .8), (u0, .8))),   # top
        ]
        for vs, uvs in quads:
            f = bm.faces.new(vs)
            for loop, uv in zip(f.loops, uvs):
                loop[uvl].uv = uv
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    return finish(bm, name, [mat], uv=False, smooth_angle=30)


arch_band("arch_band", R, R + 1.15, PZ + 0.22, PZ - 0.05, M_DECO)
arch_band("arch_trim", R - 0.02, R + 0.1, PZ + 0.26, PZ + 0.1, M_BRASS)
cyl("medallion", (0.0, ARCH + 1.35, PZ + 0.2), (0, 0, 1), 0.95, 0.22, M_DECO, sides=40, bevel=0.04)
cyl("medallion_ring", (0.0, ARCH + 1.35, PZ + 0.3), (0, 0, 1), 1.05, 0.06, M_BRASS, sides=40)

# opera boxes (2 tiers each side) on the proscenium wall
for s in (-1, 1):
    xa, xb = s * 7.9, s * 11.3
    for tier, fy in enumerate((3.0, 5.6)):
        tag = "%d_%d" % (s, tier)
        gbox("box_slab_" + tag, xa, xb, fy - 0.22, fy, PZ, -8.9, M_WOOD, tile=2.0, bevel=0.02)
        gbox("box_corbel_" + tag, xa + s * 0.25, xb - s * 0.25, fy - 0.7, fy - 0.22, PZ, -9.25, M_DECO, tile=1.2,
             bevel=0.03)
        gbox("box_front_" + tag, xa, xb, fy, fy + 0.95, -9.02, -8.9, M_DECO, tile=1.0, bevel=0.015)
        gbox("box_rail_" + tag, xa - s * 0.04, xb + s * 0.04, fy + 0.95, fy + 1.06, -9.06, -8.86, M_WOOD, tile=1.5,
             bevel=0.02)
        for xp in (xa, xb):
            gbox("box_part_%s_%.1f" % (tag, xp), xp - 0.06, xp + 0.06, fy, fy + 2.45, PZ, -8.95, M_PLAST, tile=2.0,
                 bevel=0.02)
        gbox("box_roof_" + tag, xa, xb, fy + 2.45, fy + 2.6, PZ, -8.85, M_WOOD, tile=2.0, bevel=0.02)
        gbox("box_door_" + tag, (xa + xb) / 2 - 0.55, (xa + xb) / 2 + 0.55, fy, fy + 2.0, PZ + 0.01, PZ + 0.02, M_VOID)

# stage house behind the proscenium + upstage wall
for s in (-1, 1):
    gbox("fly_wall_%d" % s, s * 9.8, s * 10.2, DECK, 14.0, -24.0, PZ - PT, M_PLAST, tile=3.0)
gbox("upstage_wall", -10.2, 10.2, DECK, 14.0, -24.4, -24.0, M_BRICK, tile=2.0)

# footlights
for i in range(15):
    x = -6.3 + i * 0.9
    cyl("foot_hood_%d" % i, (x, DECK + 0.06, -9.18), (1, 0, 0), 0.085, 0.34, M_IRON, sides=10)
    sphere("foot_bulb_%d" % i, (x, DECK + 0.09, -9.28), 0.045, M_BULB, seg=8, rings=5)

# =============================================================== BUILD: curtains
log("build curtains")
TOP, TB = 9.4, 3.3
VTB = (TOP - TB) / (TOP - DECK)


def drape(s):
    xo, xt, xtb, xbot = s * 6.75, s * 2.6, s * 5.75, s * 4.95
    wtop = abs(xt - xo)
    rng = mulberry32(900 + s)
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
        z = -10.55 + amp * math.sin(2 * math.pi * 9 * u + 0.6)
        if v < VTB:
            z += 0.14 * math.sin(math.pi * v / VTB) * u
        y = TOP - (TOP - DECK - 0.02) * v
        if v > 0.86:
            k = min(40, int(u * 40))
            y += (tear[k] ** 2) * 0.55 * ((v - 0.86) / 0.14)
        return (x, y, z)

    def uvfn(u, v):
        return ((u if s < 0 else 1 - u) * wtop / 1.3, (1 - v) * (TOP - DECK) / 1.3)
    return surface("drape_%d" % s, 40, 36, fn, M_VELV, uvfn, flip=(s > 0))


drape(-1)
drape(1)


def valance():
    NS = 5
    x0, x1 = -6.95, 6.95

    def bottom(u):
        p = (u * NS) % 1.0
        return 7.95 - 0.62 * math.sin(math.pi * p)

    def fn(u, v):
        x = x0 + (x1 - x0) * u
        yb = bottom(u)
        y = 9.7 - (9.7 - yb) * v
        p = (u * NS) % 1.0
        z = -10.42 + 0.035 * math.sin(2 * math.pi * 70 * u) + 0.13 * math.sin(math.pi * p) * v
        return (x, y, z)

    surface("valance", 280, 8, fn, M_VELV, lambda u, v: (u * 13.9 / 1.3, (1 - v) * 1.8 / 1.3))

    def fringe(u, v):
        x = x0 + (x1 - x0) * u
        yb = bottom(u)
        p = (u * NS) % 1.0
        z = -10.42 + 0.035 * math.sin(2 * math.pi * 70 * u) + 0.13 * math.sin(math.pi * p) + 0.01
        return (x, yb + 0.02 - 0.16 * v, z)
    surface("valance_fringe", 280, 1, fringe, M_BRASS, lambda u, v: (u * 20, v))


valance()


def rear_curtain():
    rng = mulberry32(77)
    tear = [rng() for _ in range(121)]

    def fn(u, v):
        x = -9.6 + 19.2 * u
        y = 11.5 - (11.5 - DECK - 0.03) * v
        if v > 0.9:
            y += (tear[min(120, int(u * 120))] ** 3) * 0.7 * ((v - 0.9) / 0.1)
        z = -19.5 + 0.13 * math.sin(2 * math.pi * 26 * u)
        return (x, y, z)
    surface("rear_curtain", 120, 10, fn, M_VELV, lambda u, v: (u * 19.2 / 1.3, (1 - v) * 10.4 / 1.3))


rear_curtain()

# =============================================================== BUILD: marquee sign
log("build marquee")
MZ = -17.3
gbox("marquee_board", -5.4, 5.4, 4.4, 6.65, MZ - 0.25, MZ, M_SIGNB, tile=2.0, bevel=0.04)
gbox("marquee_frame_t", -5.5, 5.5, 6.6, 6.75, MZ - 0.25, MZ + 0.06, M_BRASS, tile=1.0, bevel=0.02)
gbox("marquee_frame_b", -5.5, 5.5, 4.3, 4.45, MZ - 0.25, MZ + 0.06, M_BRASS, tile=1.0, bevel=0.02)
for s in (-1, 1):
    gbox("marquee_frame_%d" % s, s * 5.38, s * 5.5, 4.3, 6.75, MZ - 0.25, MZ + 0.06, M_BRASS, tile=1.0, bevel=0.02)
    tube("marquee_cable_%d" % s, [(s * 4.6, 6.75, MZ - 0.12), (s * 4.6, 14.0, MZ - 0.12)], 0.02, M_IRON, sides=5)


def sign_text():
    cu = bpy.data.curves.new("sign_txt", "FONT")
    cu.body = "HIT PARADE"
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.size = 1.28
    cu.space_character = 1.06
    cu.extrude = 0.07
    cu.offset = 0.022
    cu.bevel_depth = 0.012
    cu.bevel_resolution = 1
    tob = bpy.data.objects.new("sign_txt", cu)
    COL_PROOF.objects.link(tob)
    tob.rotation_euler = (math.radians(90), 0, 0)
    tob.location = G(0.0, 5.52, MZ + 0.09)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tob.evaluated_get(dg))
    me.transform(tob.matrix_world)
    bpy.data.objects.remove(tob, do_unlink=True)
    me.materials.append(M_SIGNF)
    me.materials.append(M_SIGNB)
    for p in me.polygons:
        p.material_index = 0 if p.normal.y < -0.7 else 1
    box_uv(me, 1.0)
    ob = bpy.data.objects.new("marquee_letters", me)
    COL_SET.objects.link(ob)
    return ob


sign_text()
BULBS = []
DEAD = []
k = 0
for (xa, ya, xb, yb, n) in ((-5.2, 6.52, 5.2, 6.52, 30), (-5.2, 4.53, 5.2, 4.53, 30), (-5.25, 4.75, -5.25, 6.3, 5),
                            (5.25, 4.75, 5.25, 6.3, 5)):
    for i in range(n):
        t = i / max(1, n - 1)
        p = (xa + (xb - xa) * t, ya + (yb - ya) * t, MZ + 0.07)
        dead = (k % 9 == 4) or (k % 13 == 7)
        sp = sphere("mbulb_%d" % k, p, 0.055, M_IRON if dead else M_BULB, seg=8, rings=5)
        (DEAD if dead else BULBS).append(sp)
        k += 1

# =============================================================== BUILD: kit props
log("import kit props")
template("door", QMV + "Door_1_Round.gltf")
template("doorframe", QMV + "DoorFrame_Round_Brick.gltf")
template("torch", QFP + "Torch_Metal.gltf")
template("lantern", QFP + "Lantern_Wall.gltf")
template("chandelier", QFP + "Chandelier.gltf")
template("cage", QFP + "Cage_Small.gltf")
template("chaincoil", QFP + "Chain_Coil.gltf")
template("bucket", QFP + "Bucket_Metal.gltf")
template("balcony", QMV + "Balcony_Simple_Straight.gltf")
template("cobweb", QMD + "Cobweb.fbx", mat_override=mat_pbr("rt_cobweb", color=(0.55, 0.55, 0.58, 1), roughness=1.0,
                                                               double=True))
template("curtain_a", os.path.join(FANT, "3d", "PROPS", "SM_PROP_curtain_interior_01.fbx"), mat_override=M_FAB)
template("curtain_b", os.path.join(FANT, "3d", "PROPS", "SM_PROP_curtain_interior_03.fbx"), mat_override=M_FAB)
template("pelmet", os.path.join(FANT, "3d", "PROPS", "SM_PROP_curtain_interior_04.fbx"), mat_override=M_FAB)

# canonicalise imported duplicates (MI_Trim_Metal.001 -> MI_Trim_Metal) so they merge into one draw
canon = {}
for m in list(bpy.data.materials):
    base = m.name.split(".")[0]
    if base.startswith("MI_") or base.startswith("M_PROP"):
        canon.setdefault(base, m)
for key, (ob, lo, hi) in TPL.items():
    for i, sl in enumerate(ob.data.materials):
        if sl is not None and sl.name.split(".")[0] in canon:
            ob.data.materials[i] = canon[sl.name.split(".")[0]]

# imported kit trim sheets ship at 2048: props are small on screen, 512 is enough (budget: CONTRACT 6.4 <= 6 MB)
KIT_DIRS = [QFP, QMV, A + "/3d-models/fantasy-props-mega/Textures/"]
_kit_done = {}
for im in list(bpy.data.images):
    if im.name.startswith("rt_") or im.name.startswith("kit_"):
        continue
    base = im.name.split(".png")[0].split(".0")[0]
    src = next((d + base + ".png" for d in KIT_DIRS if os.path.exists(d + base + ".png")), None)
    if not src:
        log("kit image not re-sourced (kept):", im.name, tuple(im.size))
        continue
    if base not in _kit_done:
        nc = any(k in base for k in ("Normal", "ORM", "Roughness"))
        _kit_done[base] = prep(src, "kit_" + base, 512, noncolor=nc)
    im.user_remap(_kit_done[base])
log("kit images re-sourced at 512:", len(_kit_done))

FLAMES = []


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
    ob = finish(bm, name, [M_FLAME], tile=0.4, smooth_angle=10)
    FLAMES.append(ob)
    return ob


TORCH_FLAME = {}
for s in (-1, 1):
    room = (-s, 0, 0)       # direction into the pit
    # door + frame on the splat wall (frame +Y protrudes; door hinge pivot re-centred via bbox)
    rz = face_yaw(room, Vector((0, 1, 0)))
    inst("doorframe", "doorframe_%d" % s, (s * (W - 0.02), 0.0, -1.35), rz, 1.0, pivot="origin")
    inst("door", "door_%d" % s, (s * (W - 0.04), 0.0, -1.35), rz, 1.0, pivot="bottom")
    # wall torch (plate on local +Y = wall side)
    ry = face_yaw(room, Vector((0, -1, 0)))
    tb, tlo, thi = TPL["torch"]
    t = inst("torch", "torch_%d" % s, (s * W, 2.0, -0.15), ry, 1.0, pivot="origin")
    cup = t.matrix_world @ Vector((0.0, (tlo.y + thi.y) * 0.5 - 0.06, thi.z))
    cg = (cup.x, cup.z, -cup.y)
    TORCH_FLAME[s] = cg
    flame("flame_%s" % ("l" if s < 0 else "r"), (cg[0], cg[1] - 0.02, cg[2]))
    log("torch flame base (game xyz) %.3f %.3f %.3f" % cg)
    # lantern on the back pillar's inner face, arm reaching over the pit corner
    inst("lantern", "lantern_%d" % s, (s * (W - 0.15), 2.55, PZB), ry, 1.0, pivot="origin")
    inst("cobweb", "cobweb_%d" % s, (s * (W - 0.05), 3.45, PZB + 0.42), ry + math.radians(35), 0.85, pivot="origin")

inst("chaincoil", "chaincoil_1", (-7.05, 0.0, -2.45), 0.7, 1.0)
inst("bucket", "bucket_1", (7.15, 0.0, -2.55), 0.3, 1.0)
inst("bucket", "bucket_2", (-10.5, 0.0, 2.2), 1.3, 1.0)

# chandeliers over the bleachers + hanging cage upstage (chains made of links)


def chain(name, top_g, bottom_g, link_len=0.11, r=0.028):
    bm = bmesh.new()
    a, b = G(*top_g), G(*bottom_g)
    L = (b - a).length
    n = max(2, int(L / link_len))
    d = (b - a).normalized()
    for i in range(n):
        c = a + d * (link_len * (i + 0.5))
        rot = Matrix.Rotation(math.pi / 2 * (i % 2), 3, "Z")
        vs = []
        seg, sides = 8, 4
        for j in range(seg):
            th = 2 * math.pi * j / seg
            cx, cz = 0.035 * math.cos(th), 0.06 * math.sin(th)
            ring = []
            for q in range(sides):
                ph = 2 * math.pi * q / sides
                rr = r * 0.35
                off = Vector((cx + rr * math.cos(ph) * math.cos(th), rr * math.sin(ph), cz + rr * math.cos(ph) * math.sin(th)))
                ring.append(bm.verts.new(c + rot @ off))
            vs.append(ring)
        for j in range(seg):
            for q in range(sides):
                bm.faces.new((vs[j][q], vs[(j + 1) % seg][q], vs[(j + 1) % seg][(q + 1) % sides], vs[j][(q + 1) % sides]))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    return finish(bm, name, [M_IRON], tile=0.3, smooth_angle=60)


for s in (-1, 1):
    top = 6.35
    inst("chandelier", "chandelier_%d" % s, (s * 4.8, top, -7.2), 0.2 * s, 1.3, pivot="top")
    chain("chandelier_chain_%d" % s, (s * 4.8, 13.0, -7.2), (s * 4.8, top, -7.2))
inst("cage", "cage_1", (-2.3, 5.9, -14.4), 0.4, 1.55, pivot="bottom")
chain("cage_chain", (-2.3, 13.0, -14.4), (-2.3, 5.9 + 0.76 * 1.55, -14.4))

# box drapes + pelmets (FANTASTIC curtains, 2.2 m - the right scale for opera boxes)
for s in (-1, 1):
    xa, xb = s * 7.9, s * 11.3
    for tier, fy in enumerate((3.0, 5.6)):
        tag = "%d_%d" % (s, tier)
        inst("curtain_a", "boxdrape_in_" + tag, (xa + s * 0.45, fy + 0.02, -9.05), 0.0, 1.0, pivot="bottom")
        inst("curtain_b", "boxdrape_out_" + tag, (xb - s * 0.45, fy + 0.02, -9.05), math.pi, 1.0, pivot="bottom")
        for j in range(4):
            x = xa + (xb - xa) * (j + 0.5) / 4
            inst("pelmet", "boxpelmet_%s_%d" % (tag, j), (x, fy + 2.44, -8.95), 0.0, 1.0, pivot="top")

# bleacher back rail (QMV balcony railing, 2 m pieces)
for i in range(14):
    x = -13.0 + 2.0 * i
    inst("balcony", "backrail_%d" % i, (x, 1.2, -6.98), 0.0, 1.0, pivot="bottom")

# spot cans on the lower box rails, aimed at the pit


def spotcan(name, pos_g, target_g):
    d = Vector(target_g) - Vector(pos_g)
    q = Vector((0, 0, 1)).rotation_difference(G(*d).normalized())
    parts = []
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=14, radius1=0.15, radius2=0.17, depth=0.42)
    bmesh.ops.bevel(bm, geom=[e for e in bm.edges if e.is_boundary is False and len(e.link_faces) == 2 and
                              abs(e.link_faces[0].normal.dot(e.link_faces[1].normal)) < 0.3], offset=0.015,
                    segments=1, affect="EDGES", clamp_overlap=True)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=q.to_matrix())
    bmesh.ops.translate(bm, verts=bm.verts, vec=G(*pos_g))
    parts.append(finish(bm, name + "_body", [M_IRON], tile=0.5))
    lens = G(*pos_g) + q @ Vector((0, 0, 0.215))
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, segments=14, radius=0.14)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=q.to_matrix())
    bmesh.ops.translate(bm, verts=bm.verts, vec=lens)
    parts.append(finish(bm, name + "_lens", [M_LENS], tile=0.5))
    yoke_top = (pos_g[0], pos_g[1] - 0.3, pos_g[2])
    parts.append(tube(name + "_yoke", [(pos_g[0] - 0.19, pos_g[1], pos_g[2]), (pos_g[0] - 0.19, pos_g[1] - 0.26, pos_g[2]),
                                      (pos_g[0] + 0.19, pos_g[1] - 0.26, pos_g[2]), (pos_g[0] + 0.19, pos_g[1], pos_g[2])],
                      0.018, M_IRON, sides=5))
    return parts


for s in (-1, 1):
    for x in (s * 8.55, s * 10.65):
        spotcan("spot_%.2f" % x, (x, 4.42, -8.8), (s * 1.8, 1.2, 0.0))

# =============================================================== crowd nodes (exported) + proof cards
log("crowd nodes")
ATLAS_META = json.load(open(os.path.join(GLTF_OUT, "crowd_atlas.json"), encoding="utf-8"))
CROWD = S["crowd"]
CARD_H = CROWD["cardHeightM"]
nodes = []
for bay in CROWD["bays"]:
    rng = mulberry32(bay["seed"])
    x0, x1 = bay["x"]
    jx, jz = bay["jitter"]
    yaw = math.radians(bay.get("faceYawDeg", 0.0))
    for ri, row in enumerate(bay["rows"]):
        n = int(math.floor((x1 - x0) / bay["spacing"] + 1e-6)) + 1
        stag = 0.5 * bay["spacing"] * (ri % 2)
        for i in range(n):
            x = x0 + i * bay["spacing"] + stag + (rng() * 2 - 1) * jx
            if x > x1 + 1e-6:
                continue
            z = row["z"] + (rng() * 2 - 1) * jz
            r = rng()
            if abs(yaw) > 1e-3:
                ang = "right" if yaw > 0 else "left"
            else:
                ang = "front" if abs(x) < 3.0 else ("left" if x > 0 else "right")
            e = bpy.data.objects.new("crowd_%s_%d_%d" % (bay["id"], ri, i), None)
            e.empty_display_type = "SINGLE_ARROW"
            e.location = G(x, row["y"], z)
            e.rotation_euler = (0.0, 0.0, yaw)
            e.scale = (CARD_H, CARD_H, CARD_H)
            e["bay"] = bay["id"]
            e["row"] = ri
            e["i"] = i
            e["rand"] = round(r, 5)
            e["angle"] = ang
            COL_NODES.objects.link(e)
            nodes.append((e, x, row["y"], z, yaw, r, ang))
log("crowd nodes", len(nodes))


def proof_cards():
    """the crowd as the view would draw it: unlit atlas cards (render-only, NOT exported)"""
    img = bpy.data.images.load(os.path.join(GLTF_OUT, "crowd_atlas.webp"), check_existing=True)
    m = bpy.data.materials.new("proof_crowd")
    m.use_nodes = True
    nt = m.node_tree
    for nd in list(nt.nodes):
        nt.nodes.remove(nd)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tx = nt.nodes.new("ShaderNodeTexImage")
    tx.image = img
    tint = hex_lin(CROWD["tint"])
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs["Factor"].default_value = 1.0
    b = CROWD["brightness"]
    mul.inputs["B"].default_value = (tint[0] * b, tint[1] * b, tint[2] * b, 1)
    nt.links.new(tx.outputs["Color"], mul.inputs["A"])
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(mul.outputs["Result"], em.inputs["Color"])
    gt = nt.nodes.new("ShaderNodeMath")
    gt.operation = "GREATER_THAN"
    gt.inputs[1].default_value = 0.5
    nt.links.new(tx.outputs["Alpha"], gt.inputs[0])
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mx = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(gt.outputs[0], mx.inputs["Fac"])
    nt.links.new(tr.outputs[0], mx.inputs[1])
    nt.links.new(em.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs["Surface"])
    try:
        m.surface_render_method = "DITHERED"
    except AttributeError:
        pass
    m["is_crowd"] = 1
    W_, H_ = ATLAS_META["size"]
    cells = {(c["body"], c["pose"], c["angle"]): c for c in ATLAS_META["cells"]}
    bodies = list(ATLAS_META["bodies"].keys())
    ay = ATLAS_META["anchor"][1]
    cw, chh = ATLAS_META["metresPerCellWidth"], ATLAS_META["metresPerCellHeight"]
    poses = ["cheer", "cheer", "hype", "jeer", "watch", "cheer", "hype", "jeer"]
    meshes = {}
    cards = []
    for (e, x, y, z, yaw, r, ang) in nodes:
        body = bodies[int(r * 997) % len(bodies)]
        pose = poses[int(r * 7919) % len(poses)]
        mirror = (int(r * 104729) % 2 == 1) and ang == "front"
        c = cells[(body, pose, ang)]
        key = (body, pose, ang, mirror)
        if key not in meshes:
            u0, v0, u1, v1 = c["uv"]
            if mirror:
                u0, u1 = u1, u0
            me = bpy.data.meshes.new("card_%s_%s_%s_%d" % key)
            bot = -(1 - ay) * chh
            vs = [(-cw / 2, 0, bot), (cw / 2, 0, bot), (cw / 2, 0, bot + chh), (-cw / 2, 0, bot + chh)]
            me.from_pydata(vs, [], [(0, 1, 2, 3)])
            uvl = me.uv_layers.new(name="UVMap")
            for li, uv in zip(range(4), ((u0, v0), (u1, v0), (u1, v1), (u0, v1))):
                uvl.data[li].uv = uv
            me.materials.append(m)
            meshes[key] = me
        ob = bpy.data.objects.new("card_" + e.name, meshes[key])
        ob.location = e.location
        ob.rotation_euler = (0, 0, yaw)
        COL_PROOF.objects.link(ob)
        cards.append(ob)
    log("proof crowd cards", len(cards), "unique", len(meshes))
    return cards


# =============================================================== env map (IBL for the view)
def env_map():
    img = bpy.data.images.load(HDRI, check_existing=True)
    e2 = img.copy()
    e2.scale(512, 256)
    e2.filepath_raw = os.path.join(GLTF_OUT, "rust_theater_env.hdr")
    e2.file_format = "HDR"
    e2.save()
    log("env map", e2.filepath_raw, os.path.getsize(e2.filepath_raw))
    return img


# =============================================================== EXPORT
def join_all(objs, name):
    objs = [o for o in objs if o.type == "MESH"]
    for o in objs:
        if o.data.users > 1:
            o.data = o.data.copy()
        # one UV set only (imported kit meshes carry a second, unused one)
        while len(o.data.uv_layers) > 1:
            o.data.uv_layers.remove(o.data.uv_layers[-1])
        if o.data.uv_layers:
            o.data.uv_layers[0].name = "UVMap"
    with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs, object=objs[0]):
        bpy.ops.object.join()
    objs[0].name = name
    objs[0].data.name = name
    return objs[0]


def export():
    log("join + export")
    set_objs = [o for o in COL_SET.objects if o.type == "MESH" and o not in FLAMES and o not in BULBS]
    set_ob = join_all(set_objs, "rust_theater_set")
    fl = join_all(FLAMES, "flame_torches") if FLAMES else None
    mb = join_all(BULBS, "marquee_bulbs") if BULBS else None
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    sel = [set_ob] + [o for o in (fl, mb) if o] + list(COL_NODES.objects)
    for o in sel:
        o.select_set(True)
    bpy.context.view_layer.objects.active = set_ob
    kw = dict(filepath=RAW_GLB, export_format="GLB", use_selection=True, export_apply=True, export_extras=True,
              export_lights=False, export_cameras=False, export_yup=True, export_texcoords=True,
              export_normals=True, export_tangents=False, export_materials="EXPORT", export_image_format="AUTO",
              export_animations=False, export_skins=False, export_morph=False)
    while True:
        try:
            bpy.ops.export_scene.gltf(**kw)
            break
        except TypeError as ex:
            msg = str(ex)
            bad = [k for k in list(kw) if ('"%s"' % k) in msg or ("'%s'" % k) in msg]
            if not bad:
                raise
            for k2 in bad:
                kw.pop(k2)
                log("export kw dropped:", k2)
    tris = sum(len(p.vertices) - 2 for p in set_ob.data.polygons)
    log("exported", RAW_GLB, os.path.getsize(RAW_GLB), "bytes; set tris", tris, "materials", len(set_ob.data.materials))
    return set_ob


# =============================================================== PROOF RENDER
def fighters():
    """render-only stand-ins at the round-start spawn (toon + outline like the game's cel look)"""
    CA.PLAN["bodies"]["Ch42"] = {"file": "Ch42_nonPBR.fbx", "look": "johnny stand-in"}
    CA.PLAN["bodies"]["Brute"] = {"file": "Brute.fbx", "look": "bruno stand-in", "hideMeshes": ["BattleAxe"]}
    CA.PLAN["clips"]["stance"] = "Pro_Magic_Pack/standing idle.fbx"
    out = []
    for body, (px, face) in (("Ch42", (S["spawn"]["p1"][0], 1)), ("Brute", (S["spawn"]["p2"][0], -1))):
        arm, meshes = CA.load_body(body)
        for o in [arm] + meshes:
            link(o, COL_PROOF)
        carm, fr = CA.load_clip("stance")
        link(carm, COL_PROOF)
        CA.activate_clip("stance", 20)
        for pb in arm.pose.bones:
            pb.matrix_basis = Matrix.Identity(4)
        bpy.context.view_layer.update()
        CA.pose_static(carm, arm, CA.hier(arm))
        base = tuple(arm.rotation_euler)
        arm.rotation_euler = (base[0], base[1], base[2] + math.radians(90 * face))
        arm.location = (0, 0, 0)
        bpy.context.view_layer.update()
        hb = next(b for b in arm.pose.bones if CA.strip(b.name) == "Hips")
        hp = arm.matrix_world @ hb.head
        lo, hi = CA.mesh_min_max(meshes)
        arm.location = (px - hp.x, -hp.y, -lo.z)
        bpy.context.view_layer.update()
        lo, hi = CA.mesh_min_max(meshes)
        log("fighter", body, "height %.2f" % (hi.z - lo.z), "x %.2f..%.2f" % (lo.x, hi.x))
        out += [arm] + meshes
    return out


def setup_lights_world():
    for L in S["lights"]:
        t = L["type"]
        if t == "hemisphere":
            continue
        kind = {"directional": "SUN", "point": "POINT", "spot": "SPOT"}[t]
        ld = bpy.data.lights.new(L["id"], kind)
        ld.color = hex_lin(L["color"])
        ob = bpy.data.objects.new("light_" + L["id"], ld)
        COL_PROOF.objects.link(ob)
        ob.location = G(*L["position"])
        if kind == "SUN":
            ld.energy = L["intensity"]
            ld.angle = math.radians(2.0)
            d = G(*L["target"]) - G(*L["position"])
            ob.rotation_mode = "QUATERNION"
            ob.rotation_quaternion = Vector((0, 0, -1)).rotation_difference(d.normalized())
            ld.use_shadow = bool(L.get("castShadow", False))
        else:
            ld.energy = 4.0 * math.pi * L["intensity"]
            ld.shadow_soft_size = 0.05
            ld.use_shadow = False
            if L.get("distance"):
                ld.use_custom_distance = True
                ld.cutoff_distance = L["distance"]
            if kind == "SPOT":
                d = G(*L["target"]) - G(*L["position"])
                ob.rotation_mode = "QUATERNION"
                ob.rotation_quaternion = Vector((0, 0, -1)).rotation_difference(d.normalized())
                ld.spot_size = math.radians(2 * L["angleDeg"])
                ld.spot_blend = L.get("penumbra", 0.0)
    # world = env HDRI x intensity + hemisphere fill (three.js irradiance I*C  ==  Blender radiance I*C/pi)
    w = bpy.data.worlds.new("rust_world")
    SCN.world = w
    w.use_nodes = True
    nt = w.node_tree
    for nd in list(nt.nodes):
        nt.nodes.remove(nd)
    out = nt.nodes.new("ShaderNodeOutputWorld")
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(HDRI, check_existing=True)
    b1 = nt.nodes.new("ShaderNodeBackground")
    b1.inputs["Strength"].default_value = S["environment"]["intensity"]
    nt.links.new(env.outputs["Color"], b1.inputs["Color"])
    hemi = next(L for L in S["lights"] if L["type"] == "hemisphere")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = -1.0
    mr.inputs["From Max"].default_value = 1.0
    nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    sky, gnd = hex_lin(hemi["sky"]), hex_lin(hemi["ground"])
    mix.inputs["A"].default_value = gnd + (1,)
    mix.inputs["B"].default_value = sky + (1,)
    nt.links.new(mr.outputs["Result"], mix.inputs["Factor"])
    b2 = nt.nodes.new("ShaderNodeBackground")
    b2.inputs["Strength"].default_value = hemi["intensity"] / math.pi
    nt.links.new(mix.outputs["Result"], b2.inputs["Color"])
    add = nt.nodes.new("ShaderNodeAddShader")
    nt.links.new(b1.outputs[0], add.inputs[0])
    nt.links.new(b2.outputs[0], add.inputs[1])
    bgc = hex_lin(S["environment"]["backgroundColor"])
    b3 = nt.nodes.new("ShaderNodeBackground")
    b3.inputs["Color"].default_value = bgc + (1,)
    lp = nt.nodes.new("ShaderNodeLightPath")
    ms = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(lp.outputs["Is Camera Ray"], ms.inputs["Fac"])
    nt.links.new(add.outputs[0], ms.inputs[1])
    nt.links.new(b3.outputs[0], ms.inputs[2])
    nt.links.new(ms.outputs[0], out.inputs["Surface"])


def render_setup(depth=False):
    try:
        SCN.render.engine = "BLENDER_EEVEE"
    except TypeError:
        SCN.render.engine = "BLENDER_EEVEE_NEXT"
    SCN.render.film_transparent = False
    SCN.render.image_settings.file_format = "PNG"
    SCN.render.image_settings.color_mode = "RGB"
    SCN.render.image_settings.color_depth = "8"
    try:
        SCN.eevee.taa_render_samples = 8 if depth else SAMPLES
    except AttributeError:
        pass
    for attr, val in (("use_raytracing", False), ("use_shadows", True), ("use_gtao", False), ("use_bloom", False)):
        try:
            setattr(SCN.eevee, attr, val)
        except AttributeError:
            pass
    vt = "Raw" if depth else "Khronos PBR Neutral"
    try:
        SCN.view_settings.view_transform = vt
    except TypeError:
        SCN.view_settings.view_transform = "Standard"
    SCN.view_settings.look = "None"
    SCN.view_settings.exposure = 0.0 if depth else math.log2(S.get("exposure", 1.0))


def make_camera(shot, aspect):
    cd = bpy.data.cameras.new("cam_" + shot["id"])
    cd.sensor_fit = "VERTICAL"
    cd.angle_y = math.radians(S["camera"]["vFovDeg"])
    cd.clip_start = 0.1
    cd.clip_end = 200.0
    co = bpy.data.objects.new("cam_" + shot["id"], cd)
    COL_PROOF.objects.link(co)
    co.location = G(*shot["pos"])
    d = G(*shot["look"]) - G(*shot["pos"])
    co.rotation_mode = "QUATERNION"
    co.rotation_quaternion = d.to_track_quat("-Z", "Y")
    return co


def depth_materials(on, saved):
    """swap every material for a view-depth emission (crowd cards keep their alpha cutout)"""
    fog = S["fog"]
    if on:
        dm = bpy.data.materials.new("depth")
        dm.use_nodes = True
        nt = dm.node_tree
        for nd in list(nt.nodes):
            nt.nodes.remove(nd)
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        cam = nt.nodes.new("ShaderNodeCameraData")
        mr = nt.nodes.new("ShaderNodeMapRange")
        mr.inputs["From Min"].default_value = fog["near"]
        mr.inputs["From Max"].default_value = fog["far"]
        mr.clamp = True
        nt.links.new(cam.outputs["View Z Depth"], mr.inputs["Value"])
        em = nt.nodes.new("ShaderNodeEmission")
        nt.links.new(mr.outputs["Result"], em.inputs["Color"])
        nt.links.new(em.outputs[0], out.inputs["Surface"])
        crowd_d = bpy.data.materials["proof_crowd"].copy() if "proof_crowd" in bpy.data.materials else None
        if crowd_d:
            nt2 = crowd_d.node_tree
            emn = next(n for n in nt2.nodes if n.type == "EMISSION")
            cam2 = nt2.nodes.new("ShaderNodeCameraData")
            mr2 = nt2.nodes.new("ShaderNodeMapRange")
            mr2.inputs["From Min"].default_value = fog["near"]
            mr2.inputs["From Max"].default_value = fog["far"]
            mr2.clamp = True
            nt2.links.new(cam2.outputs["View Z Depth"], mr2.inputs["Value"])
            nt2.links.new(mr2.outputs["Result"], emn.inputs["Color"])
        for ob in SCN.objects:
            if ob.type not in ("MESH", "FONT") or not ob.visible_get():
                continue
            saved[ob.name] = [sl.material for sl in ob.material_slots]
            for sl in ob.material_slots:
                is_c = sl.material is not None and sl.material.get("is_crowd")
                sl.link = "OBJECT"
                sl.material = crowd_d if (is_c and crowd_d) else dm
    else:
        for name, mats in saved.items():
            ob = SCN.objects.get(name)
            if not ob:
                continue
            for sl in ob.material_slots:
                sl.link = "OBJECT"
                sl.material = None
                sl.link = "DATA"


def fog_composite(beauty_path, depth_path, out_path):
    b = bpy.data.images.load(beauty_path, check_existing=False)
    d = bpy.data.images.load(depth_path, check_existing=False)
    d.colorspace_settings.name = "Non-Color"
    b.colorspace_settings.name = "Non-Color"
    pb, pd = _px(b), _px(d)
    t = np.clip(pd[..., 0], 0, 1)
    f = (t * t * (3 - 2 * t))[..., None]                     # three.js Fog: smoothstep(near, far, depth)
    fc = np.array(hex_srgb(S["fog"]["color"]), np.float32)
    o = pb.copy()
    o[..., :3] = pb[..., :3] * (1 - f) + fc * f
    _set_px(b, o)
    b.filepath_raw = out_path
    b.file_format = "PNG"
    b.save()


def render_proofs():
    setup_lights_world()
    proof_cards()
    if DO_FIGHTERS:
        fighters()
    for ob in COL_NODES.objects:
        ob.hide_render = True
    shots = S["camera"]["proofShots"] + [
        {"id": "overview", "pos": [10.5, 7.5, 13.0], "look": [0.0, 2.5, -7.0], "fov": 52.0},
        {"id": "wall_detail", "pos": [4.2, 1.7, 2.6], "look": [8.0, 1.7, -0.9], "fov": 50.0}]
    if SHOTS:
        want = str(SHOTS).split(",")
        shots = [s for s in shots if s["id"] in want]
    beauty = []
    for sh in shots:
        aspect = sh.get("aspect", RES[0] / RES[1])
        SCN.render.resolution_x = int(round(RES[1] * aspect))
        SCN.render.resolution_y = RES[1]
        cam = make_camera(sh, aspect)
        if sh.get("fov"):
            cam.data.angle_y = math.radians(sh["fov"])
        SCN.camera = cam
        render_setup(False)
        p = os.path.join(CACHE, "beauty_%s.png" % sh["id"])
        SCN.render.filepath = p
        bpy.ops.render.render(write_still=True)
        beauty.append((sh, cam, p))
        log("rendered", sh["id"], SCN.render.resolution_x, "x", SCN.render.resolution_y)
    saved = {}
    depth_materials(True, saved)
    for sh, cam, p in beauty:
        aspect = sh.get("aspect", RES[0] / RES[1])
        SCN.render.resolution_x = int(round(RES[1] * aspect))
        SCN.render.resolution_y = RES[1]
        SCN.camera = cam
        render_setup(True)
        dp = os.path.join(CACHE, "depth_%s.png" % sh["id"])
        SCN.render.filepath = dp
        bpy.ops.render.render(write_still=True)
        outp = os.path.join(REP, "rust_theater_%s.png" % sh["id"])
        fog_composite(p, dp, outp)
        log("proof", outp)
    depth_materials(False, saved)


# =============================================================== main
if DO_EXPORT:
    env_map()
if DO_RENDER:
    render_proofs()
if DO_EXPORT:
    export()
# counts for the report (set objects before the join are gone after export; count what is in the file instead)
log("DONE")
