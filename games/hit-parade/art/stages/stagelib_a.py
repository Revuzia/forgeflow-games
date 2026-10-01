"""HIT PARADE - shared Blender helpers for the STAGES-A sets (butcher_block.py, wheel_of_pain.py). Lane STAGES-A.

Follows the Rust Theater precedent (art/stages/rust_theater.py) exactly where it can: game-axis authoring G(x, y, z),
one static `<id>_set` mesh (one primitive per material), named animated nodes, `crowd_<bay>_<row>_<i>` empties, NO
lights / cameras in the GLB, the fixed light pool + fog + IBL live in the stage definition, proof renders from the
game camera (vFOV 35, y 1.25, look-at y 1.0) with the crowd drawn as the view draws it and a three.js-matching fog
composite, then TECH_REUSE chain D (gltf-transform meshopt + webp, --flatten/--join false so the empties survive).

What is new here (and why):
  * the stage definition is a Python dict in the stage script (single source of truth) and the build WRITES the
    fragment art/stages/<id>.stage.json (+ measured build stats); tools/merge_stages.py merges fragments into
    data/stages.json. Nothing is hand-edited.
  * animated nodes carry their own pivot: `reorigin()` moves an object's origin (and axes) so the view's hooks act
    about the right point - `anim_spin_*` spins about LOCAL Y (= Blender local Z after the Y-up export), `flame_*`
    scales Y about the burner base (not about the world origin).
  * generated textures come from art/stages/stagetex_a.py (plain Python + PIL, the game's OFL fonts), run first.
  * `contact_render()` = the ENV_KIT section 8.3 side-by-side test (hero prop between qfp_Chandelier and
    jp_JP_Conditioner_01 under one HDRI).
ASCII only.
"""
import bpy
import bmesh
import sys
import os
import json
import math
import time
import shutil
import struct
import subprocess
from mathutils import Vector, Matrix
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.dont_write_bytecode = True
if HERE not in sys.path:
    sys.path.insert(0, HERE)

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
DO_CONTACT = bool(arg("--contact", False))
DO_TEX = not arg("--no-tex", False)
RES = [int(v) for v in str(arg("--res", "1920x1080")).split("x")]
SAMPLES = int(arg("--samples", 48))
SHOTS = arg("--shots", None)

CACHE = os.path.join(ROOT, "_harness", "scratch", "stages_cache")
TEXA = os.path.join(CACHE, "tex_a")
REP = os.path.join(ROOT, "_harness", "_reports", "stages")
GLTF_OUT = os.path.join(ROOT, "art", "gltf", "stages")
# CHANGED(STAGES3D-A): builds go to a STAGING dir by default (the running game loads art/gltf/stages/*): GLB + env HDR +
# fragment land in _harness/scratch/stages3d_out/, then `python tools/merge_stages.py --install <id,...>` moves them into
# art/gltf/stages/ + art/stages/ in one step and merges. `--out live` = the old in-place behaviour.
OUT_MODE = str(arg("--out", "stage"))
STAGE_OUT = os.path.join(ROOT, "_harness", "scratch", "stages3d_out")
for _d in (CACHE, TEXA, REP, GLTF_OUT, STAGE_OUT):
    os.makedirs(_d, exist_ok=True)


def out_glb_dir():
    return GLTF_OUT if OUT_MODE == "live" else STAGE_OUT


def out_frag_dir():
    return HERE if OUT_MODE == "live" else STAGE_OUT

A = "F:/games/forgeflow-games-assets"
U = "F:/games/unity-assets"
QFP = A + "/3d-models/fantasy-props-mega/Exports/glTF/"
QFP_TEX = A + "/3d-models/fantasy-props-mega/Textures/"
QMV = A + "/3d-models/medieval-village-mega/Medieval Village MegaKit[Standard]/glTF/"
BLINK = U + "/Blink__Stylized Dungeon Textures - RPG Environment/Assets/Blink/Art/Textures/StylizedDungeonTextures/"
GEN = A + "/generated-materials/"
PH_HDRI = A + "/_downloaded/polyhaven-hdris/"
JPV = U + "/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/"

T0 = time.time()
TAG = ["stage"]


def log(*a):
    print("[%s %6.1fs]" % (TAG[0], time.time() - T0), *a, flush=True)


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


def rgba(h, a=1.0):
    return hex_lin(h) + (a,)


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
COL = {}
ANIM = {}          # exported animated node name -> object (already re-originated)
HERO = {}          # hero prop name -> list of objects (for the contact render)


def init_scene(tag):
    TAG[0] = tag
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scn = bpy.context.scene
    for k in ("SET", "NODES", "PROOF", "TEMPLATES"):
        c = bpy.data.collections.new(k)
        scn.collection.children.link(c)
        COL[k] = c
    COL["TEMPLATES"].hide_render = True
    COL["TEMPLATES"].hide_viewport = True
    return scn


def link(ob, col=None):
    col = col or COL["SET"]
    for c in ob.users_collection:
        c.objects.unlink(ob)
    col.objects.link(ob)
    return ob


def run_texgen(stage_id):
    """generated textures first (plain Python + PIL; Blender's Python has no PIL)"""
    if not DO_TEX:
        return
    py = shutil.which("python") or shutil.which("python3")
    if not py:
        raise SystemExit("system python not on PATH (needed for art/stages/stagetex_a.py)")
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    r = subprocess.run([py, os.path.join(HERE, "stagetex_a.py"), stage_id], capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=env)
    log("texgen rc", r.returncode, r.stdout.strip().splitlines()[-1] if r.stdout.strip() else "")
    if r.returncode != 0:
        print(r.stderr[-3000:])
        raise SystemExit("stagetex_a.py failed")


# =============================================================== textures
def _px(img):
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def _set_px(img, arr):
    img.pixels.foreach_set(arr.astype(np.float32).ravel())
    img.update()


def prep(src, name, size, noncolor=False, fn=None, sub="tex_a_lib"):
    """library texture: load -> resize -> optional numpy fn(HxWx4) -> save PNG in the cache (the exporter reads it)"""
    d = os.path.join(CACHE, sub)
    os.makedirs(d, exist_ok=True)
    out = os.path.join(d, name + ".png")
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


def gtex(name, noncolor=False, size=None):
    """generated texture (stagetex_a.py output)"""
    p = os.path.join(TEXA, name + ".png")
    if not os.path.exists(p):
        raise SystemExit("missing generated texture %s (run art/stages/stagetex_a.py)" % p)
    img = bpy.data.images.load(p, check_existing=True)
    if noncolor:
        img.colorspace_settings.name = "Non-Color"
    if size and (img.size[0] != size):
        img = prep(p, name + "_%d" % size, size, noncolor)
    return img


def mat_pbr(name, albedo=None, normal=None, rough=None, color=(0.8, 0.8, 0.8, 1), roughness=0.85, metallic=0.0,
            emission=None, estrength=0.0, emission_tex=None, nstrength=1.0, double=False, alpha=1.0,
            metal_tex=None):
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
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(t.outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Green"], bs.inputs["Roughness"])
        if metal_tex is None and metallic > 0:
            bs.inputs["Metallic"].default_value = metallic
    else:
        bs.inputs["Roughness"].default_value = roughness
    bs.inputs["Metallic"].default_value = metallic
    if emission_tex is not None:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = emission_tex
        nt.links.new(t.outputs["Color"], bs.inputs["Emission Color"])
        bs.inputs["Emission Strength"].default_value = estrength
    elif emission is not None:
        bs.inputs["Emission Color"].default_value = emission
        bs.inputs["Emission Strength"].default_value = estrength
    if alpha < 1.0:
        bs.inputs["Alpha"].default_value = alpha
        try:
            m.surface_render_method = "BLENDED"
        except AttributeError:
            pass
    m.use_backface_culling = not double
    return m


# =============================================================== geometry
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


def finish(bm, name, mats, tile=2.0, smooth_angle=40.0, col=None, uv=True):
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
    (col or COL["SET"]).objects.link(ob)
    return ob


def gbox(name, x0, x1, y0, y1, z0, z1, mat, tile=2.0, bevel=0.0, segs=2, col=None):
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


def obox(name, center_g, size_g, yaw_deg, mat, tile=1.0, bevel=0.0, segs=2, col=None):
    """oriented box: centre + size (game axes before yaw) + yaw about +Y (degrees)"""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    sx, sy, sz = size_g
    for v in bm.verts:
        v.co = Vector((v.co.x * sx, v.co.y * sz, v.co.z * sy))
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=segs, profile=0.5, affect="EDGES",
                        clamp_overlap=True)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(yaw_deg), 3, "Z"))
    bmesh.ops.translate(bm, verts=bm.verts, vec=G(*center_g))
    return finish(bm, name, [mat], tile, col=col)


def tube(name, pts, r, mat, sides=6, col=None, caps=True, smooth=60):
    """tube along game-space points"""
    bm = bmesh.new()
    P = [G(*p) for p in pts]
    rings = []
    prev_a = None
    for i, p in enumerate(P):
        d = (P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]).normalized()
        if prev_a is None:
            up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
            a = d.cross(up).normalized()
        else:
            a = (prev_a - d * prev_a.dot(d)).normalized()     # parallel transport: no twist
        prev_a = a
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
    return finish(bm, name, [mat], 0.5, smooth_angle=smooth, col=col)


def cyl(name, center_g, axis_g, r, length, mat, sides=16, bevel=0.0, col=None, r2=None, tile=0.6):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=sides, radius1=r, radius2=r if r2 is None else r2,
                          depth=length)
    if bevel > 0:
        edges = [e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) < 1e-6 and
                 abs(abs(e.verts[0].co.z) - length / 2) < 1e-6]
        bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=2, profile=0.5, affect="EDGES", clamp_overlap=True)
    ax = G(*axis_g).normalized()
    q = Vector((0, 0, 1)).rotation_difference(ax)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=q.to_matrix())
    bmesh.ops.translate(bm, verts=bm.verts, vec=G(*center_g))
    return finish(bm, name, [mat], tile, smooth_angle=50, col=col)


def sphere(name, center_g, r, mat, seg=8, rings=6, col=None, scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    for v in bm.verts:
        v.co = Vector((v.co.x * scale[0], v.co.y * scale[2], v.co.z * scale[1]))
    bmesh.ops.translate(bm, verts=bm.verts, vec=G(*center_g))
    return finish(bm, name, [mat], 0.5, smooth_angle=80, col=col)


def lathe(name, prof, center_g, axis_g, mat, segs=24, col=None, uv_scale=(1.0, 1.0), smooth=70, cap=True,
          mats_by_ring=None):
    """revolve profile [(r, h)] (h along the axis, from centre) about axis_g through centre_g.
    UV: u around (0..uv_scale[0]), v along the profile arc length (0..uv_scale[1]).
    mats_by_ring: optional list of material indices per profile segment (len(prof)-1)."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    rings = []
    for (r, h) in prof:
        rings.append([bm.verts.new((r * math.cos(2 * math.pi * k / segs), r * math.sin(2 * math.pi * k / segs), h))
                      for k in range(segs)])
    lens = [0.0]
    for i in range(1, len(prof)):
        lens.append(lens[-1] + math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]))
    L = lens[-1] or 1.0
    for i in range(len(prof) - 1):
        for k in range(segs):
            f = bm.faces.new((rings[i][k], rings[i][(k + 1) % segs], rings[i + 1][(k + 1) % segs], rings[i + 1][k]))
            if mats_by_ring:
                f.material_index = mats_by_ring[i]
            uvs = [(k / segs, lens[i] / L), ((k + 1) / segs, lens[i] / L), ((k + 1) / segs, lens[i + 1] / L),
                   (k / segs, lens[i + 1] / L)]
            for loop, uv in zip(f.loops, uvs):
                loop[uvl].uv = (uv[0] * uv_scale[0], uv[1] * uv_scale[1])
    if cap:
        for ring, (r, h) in ((rings[0], prof[0]), (rings[-1], prof[-1])):
            if r > 1e-4:
                f = bm.faces.new(ring)
                for loop in f.loops:
                    co = loop.vert.co
                    loop[uvl].uv = (0.5 + co.x / (2 * r) * 0.2, 0.5 + co.y / (2 * r) * 0.2)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    q = Vector((0, 0, 1)).rotation_difference(G(*axis_g).normalized())
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=q.to_matrix())
    bmesh.ops.translate(bm, verts=bm.verts, vec=G(*center_g))
    mats = mat if isinstance(mat, (list, tuple)) else [mat]
    return finish(bm, name, mats, uv=False, smooth_angle=smooth, col=col)


def prism(name, poly, depth, mat, center_g=(0, 0, 0), face_g=(0, 0, 1), up_g=(0, 1, 0), bevel=0.0, segs=2,
          tile=1.0, col=None, mats=None, holes=()):
    """extrude a 2D polygon (x right, y up, metres) by depth along face_g (front face at +depth/2), bevelled edges.
    mats = [front, sides] (front+back faces get mats[0])."""
    bm = bmesh.new()
    loops = [poly] + list(holes)
    edges = []
    for L in loops:
        vs = [bm.verts.new((x, y, depth / 2)) for (x, y) in L]
        for i in range(len(vs)):
            edges.append(bm.edges.new((vs[i], vs[(i + 1) % len(vs)])))
    bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=edges)
    faces = list(bm.faces)
    for f in faces:
        f.normal_update()
        if f.normal.z < 0:
            f.normal_flip()
    ext = bmesh.ops.extrude_face_region(bm, geom=faces, use_keep_orig=True)
    ev = [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=ev, vec=Vector((0, 0, -depth)))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=segs, profile=0.5, affect="EDGES",
                        clamp_overlap=True)
    if mats:
        for f in bm.faces:
            f.material_index = 0 if abs(f.normal.z) > 0.7 else 1
    # local frame: x right, y up, z = face; -> game frame via face_g/up_g
    fz = G(*face_g).normalized()
    fy = G(*up_g).normalized()
    fx = fy.cross(fz).normalized()
    fy = fz.cross(fx).normalized()
    M = Matrix((fx, fy, fz)).transposed()
    bmesh.ops.transform(bm, matrix=M.to_4x4(), verts=bm.verts)
    bmesh.ops.translate(bm, verts=bm.verts, vec=G(*center_g))
    return finish(bm, name, mats or [mat], tile, smooth_angle=35, col=col)


FONTS = {}


def text_mesh(name, text, pos_g, size, face_mat, side_mat, font_path=None, extrude=0.03, bevel=0.006, yaw_deg=0.0,
              align="CENTER", space=1.0, col=None, tile=1.0):
    """3D text standing upright, reading toward game +Z rotated by yaw_deg about +Y; pos = centre of the text box."""
    cu = bpy.data.curves.new(name + "_txt", "FONT")
    if font_path:
        if font_path not in FONTS:
            FONTS[font_path] = bpy.data.fonts.load(font_path)
        cu.font = FONTS[font_path]
    cu.body = text
    cu.align_x = align
    cu.align_y = "CENTER"
    cu.size = size
    cu.space_character = space
    cu.extrude = extrude
    cu.offset = 0.0
    cu.bevel_depth = bevel
    cu.bevel_resolution = 1
    tob = bpy.data.objects.new(name + "_txt", cu)
    COL["PROOF"].objects.link(tob)
    tob.rotation_euler = (math.radians(90), 0, math.radians(yaw_deg))
    tob.location = G(*pos_g)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tob.evaluated_get(dg))
    me.transform(tob.matrix_world)
    bpy.data.objects.remove(tob, do_unlink=True)
    me.materials.append(face_mat)
    me.materials.append(side_mat)
    fdir = Matrix.Rotation(math.radians(yaw_deg), 3, "Z") @ Vector((0, -1, 0))
    for p in me.polygons:
        p.material_index = 0 if p.normal.dot(fdir) > 0.7 else 1
    box_uv(me, tile)
    ob = bpy.data.objects.new(name, me)
    (col or COL["SET"]).objects.link(ob)
    return ob


def quad(name, corners_g, mat, uv=((0, 0), (1, 0), (1, 1), (0, 1)), col=None):
    """single quad from 4 game-space corners (counter-clockwise seen from the front) with explicit UVs"""
    bm = bmesh.new()
    vs = [bm.verts.new(G(*c)) for c in corners_g]
    f = bm.faces.new(vs)
    uvl = bm.loops.layers.uv.new("UVMap")
    for loop, u in zip(f.loops, uv):
        loop[uvl].uv = u
    return finish(bm, name, [mat], uv=False, smooth_angle=10, col=col)


def label(name, center_g, w, h, rect, atlas_size, mat, yaw_deg=0.0, col=None, lift=0.004):
    """flat textured plate facing game +Z (rotated by yaw about +Y), UVs = pixel rect [x0,y0,x1,y1] of an atlas"""
    x0, y0, x1, y1 = rect
    W, H = atlas_size
    u0, u1 = x0 / W, x1 / W
    v0, v1 = 1 - y1 / H, 1 - y0 / H
    c, s = math.cos(math.radians(yaw_deg)), math.sin(math.radians(yaw_deg))
    right = (c, 0.0, -s)
    nrm = (s, 0.0, c)
    cx, cy, cz = center_g[0] + nrm[0] * lift, center_g[1], center_g[2] + nrm[2] * lift
    pts = []
    for (a, b) in ((-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)):
        pts.append((cx + right[0] * a * w, cy + b * h, cz + right[2] * a * w))
    return quad(name, pts, mat, uv=((u0, v0), (u1, v0), (u1, v1), (u0, v1)), col=col)


def disc_label(name, center_g, r, rect, atlas_size, mat, yaw_deg=0.0, segs=40, col=None, lift=0.004):
    """round textured plate (dial / clock face) facing game +Z rotated by yaw about +Y; UVs = the circle inscribed in
    the atlas pixel rect [x0,y0,x1,y1] (a square label would show the atlas background in its corners)"""
    x0, y0, x1, y1 = rect
    W, H = atlas_size
    cu, cv = (x0 + x1) / 2 / W, 1 - (y0 + y1) / 2 / H
    ru, rv = (x1 - x0) / 2 / W, (y1 - y0) / 2 / H
    c, s = math.cos(math.radians(yaw_deg)), math.sin(math.radians(yaw_deg))
    right = Vector((c, 0.0, -s))
    nrm = Vector((s, 0.0, c))
    ctr = Vector(center_g) + nrm * lift
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    cv0 = bm.verts.new(G(*ctr))
    ring = []
    for k in range(segs):
        a = 2 * math.pi * k / segs
        p = ctr + right * (r * math.cos(a)) + Vector((0, r * math.sin(a), 0))
        ring.append((bm.verts.new(G(*p)), (cu + ru * math.cos(a), cv + rv * math.sin(a))))
    for k in range(segs):
        (va, ua), (vb, ub) = ring[k], ring[(k + 1) % segs]
        f = bm.faces.new((cv0, va, vb))
        for loop, uv in zip(f.loops, ((cu, cv), ua, ub)):
            loop[uvl].uv = uv
    return finish(bm, name, [mat], uv=False, smooth_angle=5, col=col)


def chain(name, top_g, bottom_g, mat, link_len=0.1, r=0.026, col=None):
    bm = bmesh.new()
    a, b = G(*top_g), G(*bottom_g)
    L = (b - a).length
    n = max(2, int(L / link_len))
    d = (b - a).normalized()
    q = Vector((0, 0, 1)).rotation_difference(d)
    for i in range(n):
        c = a + d * (link_len * (i + 0.5))
        rot = q.to_matrix() @ Matrix.Rotation(math.pi / 2 * (i % 2), 3, "Z")
        seg, sides = 8, 4
        vs = []
        for j in range(seg):
            th = 2 * math.pi * j / seg
            cx, cz = r * 1.25 * math.cos(th), link_len * 0.62 * math.sin(th)
            ring = []
            for k in range(sides):
                ph = 2 * math.pi * k / sides
                rr = r * 0.32
                off = Vector((cx + rr * math.cos(ph) * math.cos(th), rr * math.sin(ph), cz + rr * math.cos(ph) * math.sin(th)))
                ring.append(bm.verts.new(c + rot @ off))
            vs.append(ring)
        for j in range(seg):
            for k in range(sides):
                bm.faces.new((vs[j][k], vs[(j + 1) % seg][k], vs[(j + 1) % seg][(k + 1) % sides], vs[j][(k + 1) % sides]))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    return finish(bm, name, [mat], tile=0.3, smooth_angle=60, col=col)


def join_objs(objs, name):
    objs = [o for o in objs if o is not None and o.type == "MESH"]
    for o in objs:
        if o.data.users > 1:
            o.data = o.data.copy()
        while len(o.data.uv_layers) > 1:
            o.data.uv_layers.remove(o.data.uv_layers[-1])
        if o.data.uv_layers:
            o.data.uv_layers[0].name = "UVMap"
        else:
            box_uv(o.data, 1.0)
    with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs, object=objs[0]):
        bpy.ops.object.join()
    objs[0].name = name
    objs[0].data.name = name
    return objs[0]


def reorigin(ob, loc_g, rot_blender=(0.0, 0.0, 0.0)):
    """keep the geometry where it is, move the object origin to loc_g with the given Blender euler (so local axes =
    rotated axes): the view's hooks act about this pivot."""
    from mathutils import Euler
    R = Euler(rot_blender, "XYZ").to_matrix().to_4x4()
    M = Matrix.Translation(G(*loc_g)) @ R
    ob.data.transform(M.inverted() @ ob.matrix_world)
    ob.matrix_world = M
    return ob


def dup(ob, name, loc_offset_g=(0, 0, 0), yaw_deg=0.0, pivot_g=None, col=None):
    """copy an object's mesh (baked world-space) moved / yawed about pivot_g (game) -> new object"""
    me = ob.data.copy()
    me.transform(ob.matrix_world)
    piv = G(*(pivot_g or (0, 0, 0)))
    M = Matrix.Translation(G(*loc_offset_g)) @ Matrix.Translation(piv) @ Matrix.Rotation(math.radians(yaw_deg), 4, "Z") \
        @ Matrix.Translation(-piv)
    me.transform(M)
    o2 = bpy.data.objects.new(name, me)
    (col or COL["SET"]).objects.link(o2)
    return o2


# =============================================================== kit templates (from rust_theater.py)
TPL = {}


def template(key, path, mat_override=None):
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
    link(base, COL["TEMPLATES"])
    vs = [v.co for v in base.data.vertices]
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    TPL[key] = (base, lo, hi)
    return base


def inst(key, name, loc_g, rot_z=0.0, scale=1.0, pivot="bottom", col=None):
    base, lo, hi = TPL[key]
    ob = bpy.data.objects.new(name, base.data)
    (col or COL["SET"]).objects.link(ob)
    if pivot == "bottom":
        off = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    elif pivot == "top":
        off = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, hi.z))
    elif pivot == "center":
        off = (lo + hi) / 2
    else:
        off = Vector((0, 0, 0))
    ob.matrix_world = Matrix.Translation(G(*loc_g)) @ Matrix.Rotation(rot_z, 4, "Z") @ Matrix.Scale(scale, 4) \
        @ Matrix.Translation(-off)
    return ob


def canon_kit_images(prefix_keep=("bb_", "wp_", "kit_", "tex_")):
    """imported kit trim sheets ship at 2048 -> re-source at 512 (rust_theater precedent; budget <= 6 MB)"""
    dirs = [QFP, QMV, QFP_TEX]
    done = {}
    for im in list(bpy.data.images):
        if any(im.name.startswith(p) for p in prefix_keep):
            continue
        base = im.name.split(".png")[0].split(".0")[0]
        src = next((d + base + ".png" for d in dirs if os.path.exists(d + base + ".png")), None)
        if not src:
            continue
        if base not in done:
            nc = any(k in base for k in ("Normal", "ORM", "Roughness"))
            done[base] = prep(src, "kit_" + base, 512, noncolor=nc)
        im.user_remap(done[base])
    canon = {}
    for m in list(bpy.data.materials):
        b = m.name.split(".")[0]
        if b.startswith("MI_") or b.startswith("M_PROP"):
            canon.setdefault(b, m)
    for key, (ob, lo, hi) in TPL.items():
        for i, sl in enumerate(ob.data.materials):
            if sl is not None and sl.name.split(".")[0] in canon:
                ob.data.materials[i] = canon[sl.name.split(".")[0]]
    log("kit images re-sourced at 512:", len(done))


# =============================================================== flames (animated by the view: flame_* scale.y)
def flame_blades(base_g, h=0.3, r=0.07, blades=3, rot=0.0):
    """list of quads (crossed teardrop cards) for one flame, game coords"""
    prof = [(0.0, 0.0), (0.72, 0.16), (1.0, 0.38), (0.8, 0.6), (0.4, 0.82), (0.0, 1.0)]
    quads = []
    for kk in range(blades):
        a = rot + math.pi * kk / blades
        dx, dz = math.cos(a), math.sin(a)
        for i in range(len(prof) - 1):
            (r0, h0), (r1, h1) = prof[i], prof[i + 1]
            quads.append([(base_g[0] + dx * r0 * r, base_g[1] + h0 * h, base_g[2] + dz * r0 * r),
                          (base_g[0] + dx * r1 * r, base_g[1] + h1 * h, base_g[2] + dz * r1 * r),
                          (base_g[0] - dx * r1 * r, base_g[1] + h1 * h, base_g[2] - dz * r1 * r),
                          (base_g[0] - dx * r0 * r, base_g[1] + h0 * h, base_g[2] - dz * r0 * r)])
    return quads


def quads_mesh(name, quads, mat, col=None):
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    for q in quads:
        f = bm.faces.new([bm.verts.new(G(*p)) for p in q])
        for loop, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            loop[uvl].uv = uv
    return finish(bm, name, [mat], uv=False, smooth_angle=10, col=col)


# =============================================================== crowd nodes (exported) + proof cards
def crowd_nodes(S):
    CROWD = S["crowd"]
    card_h = CROWD["cardHeightM"]
    nodes = []

    def emit(bay, ri, i, x, y, z, yaw, r, ang):
        e = bpy.data.objects.new("crowd_%s_%d_%d" % (bay["id"], ri, i), None)
        e.empty_display_type = "SINGLE_ARROW"
        e.location = G(x, y, z)
        e.rotation_euler = (0.0, 0.0, yaw)       # Blender Z rotation psi = game facing angle (35.11: 0 = +Z, 90 = +X)
        e.scale = (card_h, card_h, card_h)
        e["bay"] = bay["id"]
        e["row"] = ri
        e["i"] = i
        e["rand"] = round(r, 5)
        e["angle"] = ang
        COL["NODES"].objects.link(e)
        nodes.append((e, x, y, z, yaw, r, ang))

    for bay in CROWD["bays"]:
        rng = mulberry32(bay["seed"])
        if "arcDeg" in bay:
            # CHANGED(STAGES3D-A) CONTRACT 35.11.6: arc bay - rows run along circles about the ring centre, cards face it
            a0, a1 = bay["arcDeg"]
            jt, jr = bay["jitter"]
            gap = float(bay.get("gapPct", 0.0))
            arng = mulberry32(bay["seed"] * 7 + 3)
            for ri, row in enumerate(bay["rows"]):
                rr = row["r"]
                span = math.radians(a1 - a0) * rr
                n = int(math.floor(span / bay["spacing"] + 1e-6)) + 1
                stag = 0.5 * bay["spacing"] * (ri % 2)
                for i in range(n):
                    s_ = i * bay["spacing"] + stag + (rng() * 2 - 1) * jt
                    rj = rr + (rng() * 2 - 1) * jr
                    r = rng()
                    pick = arng()
                    if s_ > span + 1e-6 or s_ < -1e-6:
                        continue
                    if gap > 0 and arng() < gap:
                        continue
                    a = a0 + math.degrees(s_ / rr)
                    x, z = rj * math.sin(math.radians(a)), rj * math.cos(math.radians(a))
                    ang = bay.get("angle") or ("front" if pick < 0.6 else ("left" if pick < 0.8 else "right"))
                    emit(bay, ri, i, x, row["y"], z, math.radians(a + 180.0), r, ang)
            continue
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
                if bay.get("angle"):
                    ang = bay["angle"]
                e = bpy.data.objects.new("crowd_%s_%d_%d" % (bay["id"], ri, i), None)
                e.empty_display_type = "SINGLE_ARROW"
                e.location = G(x, row["y"], z)
                e.rotation_euler = (0.0, 0.0, yaw)
                e.scale = (card_h, card_h, card_h)
                e["bay"] = bay["id"]
                e["row"] = ri
                e["i"] = i
                e["rand"] = round(r, 5)
                e["angle"] = ang
                COL["NODES"].objects.link(e)
                nodes.append((e, x, row["y"], z, yaw, r, ang))
    log("crowd nodes", len(nodes))
    return nodes


def proof_cards(S, nodes):
    """the crowd as the view draws it: unlit atlas cards (render-only, NOT exported)"""
    atlas_meta = json.load(open(os.path.join(GLTF_OUT, "crowd_atlas.json"), encoding="utf-8"))
    CROWD = S["crowd"]
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
    cells = {(c["body"], c["pose"], c["angle"]): c for c in atlas_meta["cells"]}
    bodies = list(atlas_meta["bodies"].keys())
    ay = atlas_meta["anchor"][1]
    cw, chh = atlas_meta["metresPerCellWidth"], atlas_meta["metresPerCellHeight"]
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
        COL["PROOF"].objects.link(ob)
        cards.append(ob)
    log("proof crowd cards", len(cards), "unique", len(meshes))
    return cards


# =============================================================== env map (IBL for the view)
def env_map(hdri_path, out_name):
    img = bpy.data.images.load(hdri_path, check_existing=True)
    e2 = img.copy()
    e2.scale(512, 256)
    e2.filepath_raw = os.path.join(out_glb_dir(), out_name)
    e2.file_format = "HDR"
    e2.save()
    log("env map", e2.filepath_raw, os.path.getsize(e2.filepath_raw))
    return img


# =============================================================== proof renders
def setup_lights_world(S, hdri_path):
    for L in S["lights"]:
        t = L["type"]
        if t == "hemisphere":
            continue
        kind = {"directional": "SUN", "point": "POINT", "spot": "SPOT"}[t]
        ld = bpy.data.lights.new(L["id"], kind)
        ld.color = hex_lin(L["color"])
        ob = bpy.data.objects.new("light_" + L["id"], ld)
        COL["PROOF"].objects.link(ob)
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
    w = bpy.data.worlds.new(S["id"] + "_world")
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    for nd in list(nt.nodes):
        nt.nodes.remove(nd)
    out = nt.nodes.new("ShaderNodeOutputWorld")
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(hdri_path, check_existing=True)
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


def render_setup(S, depth=False, samples=None):
    scn = bpy.context.scene
    try:
        scn.render.engine = "BLENDER_EEVEE"
    except TypeError:
        scn.render.engine = "BLENDER_EEVEE_NEXT"
    scn.render.film_transparent = False
    scn.render.image_settings.file_format = "PNG"
    scn.render.image_settings.color_mode = "RGB"
    scn.render.image_settings.color_depth = "8"
    try:
        scn.eevee.taa_render_samples = 8 if depth else (samples or SAMPLES)
    except AttributeError:
        pass
    for attr, val in (("use_raytracing", False), ("use_shadows", True), ("use_gtao", False), ("use_bloom", False)):
        try:
            setattr(scn.eevee, attr, val)
        except AttributeError:
            pass
    vt = "Raw" if depth else "Khronos PBR Neutral"
    try:
        scn.view_settings.view_transform = vt
    except TypeError:
        scn.view_settings.view_transform = "Standard"
    scn.view_settings.look = "None"
    scn.view_settings.exposure = 0.0 if depth else math.log2(S.get("exposure", 1.0))


def make_camera(S, shot):
    cd = bpy.data.cameras.new("cam_" + shot["id"])
    cd.sensor_fit = "VERTICAL"
    cd.angle_y = math.radians(shot.get("fov", S["camera"]["vFovDeg"]))
    cd.clip_start = 0.1
    cd.clip_end = 200.0
    co = bpy.data.objects.new("cam_" + shot["id"], cd)
    COL["PROOF"].objects.link(co)
    co.location = G(*shot["pos"])
    d = G(*shot["look"]) - G(*shot["pos"])
    co.rotation_mode = "QUATERNION"
    co.rotation_quaternion = d.to_track_quat("-Z", "Y")
    return co


def depth_materials(S, on, saved):
    fog = S["fog"]
    scn = bpy.context.scene
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
        for ob in scn.objects:
            if ob.type not in ("MESH", "FONT") or not ob.visible_get():
                continue
            saved[ob.name] = [sl.material for sl in ob.material_slots]
            for sl in ob.material_slots:
                is_c = sl.material is not None and sl.material.get("is_crowd")
                sl.link = "OBJECT"
                sl.material = crowd_d if (is_c and crowd_d) else dm
    else:
        for name, mats in saved.items():
            ob = scn.objects.get(name)
            if not ob:
                continue
            for sl in ob.material_slots:
                sl.link = "OBJECT"
                sl.material = None
                sl.link = "DATA"


def fog_composite(S, beauty_path, depth_path, out_path):
    b = bpy.data.images.load(beauty_path, check_existing=False)
    d = bpy.data.images.load(depth_path, check_existing=False)
    d.colorspace_settings.name = "Non-Color"
    b.colorspace_settings.name = "Non-Color"
    pb, pd = _px(b), _px(d)
    t = np.clip(pd[..., 0], 0, 1)
    f = (t * t * (3 - 2 * t))[..., None]
    fc = np.array(hex_srgb(S["fog"]["color"]), np.float32)
    o = pb.copy()
    o[..., :3] = pb[..., :3] * (1 - f) + fc * f
    _set_px(b, o)
    b.filepath_raw = out_path
    b.file_format = "PNG"
    b.save()


def _crowd_atlas():
    """art/stages/crowd_atlas.py (lane STAGES P1: toon material + static retarget) as a module.
    The committed file has two `newline="<LF>"` string literals split across lines (a SyntaxError on import - an
    LF-normalisation accident, reported in progress_p2_stages-a.md); load it with those two literals repaired in
    memory instead of editing another lane's file."""
    import types
    p = os.path.join(HERE, "crowd_atlas.py")
    src = open(p, encoding="utf-8").read().replace('newline="\n"', 'newline="\\n"')
    mod = types.ModuleType("crowd_atlas")
    mod.__file__ = p
    exec(compile(src, p, "exec"), mod.__dict__)
    return mod


def fighters(S, bodies):
    """render-only stand-ins at the round-start spawn (toon + outline); bodies = [(id, file, hide), (id, file, hide)]"""
    CA = _crowd_atlas()
    CA.PLAN["clips"]["stance"] = "Pro_Magic_Pack/standing idle.fbx"
    out = []
    for (body, fname, hide), (px, face) in zip(bodies, ((S["spawn"]["p1"][0], 1), (S["spawn"]["p2"][0], -1))):
        CA.PLAN["bodies"][body] = {"file": fname, "look": "stand-in", "hideMeshes": hide}
        arm, meshes = CA.load_body(body)
        for o in [arm] + meshes:
            link(o, COL["PROOF"])
        carm, fr = CA.load_clip("stance")
        link(carm, COL["PROOF"])
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


def billboard_cards(cards, cam_pos_g):
    """CHANGED(STAGES3D-A): the view billboards every crowd card about +Y toward the camera (view/crowd.ts); do the same
    per proof shot so orbit renders show the crowd as the game does. Card plane = Blender XZ, front = local -Y."""
    cb = G(*cam_pos_g)
    for ob in cards:
        dx, dy = cb.x - ob.location.x, cb.y - ob.location.y
        ob.rotation_euler = (0.0, 0.0, math.atan2(dx, -dy))


def render_proofs(S, hdri_path, nodes, bodies, extra_shots=()):
    setup_lights_world(S, hdri_path)
    cards = proof_cards(S, nodes)
    if DO_FIGHTERS and bodies:
        fighters(S, bodies)
    for ob in COL["NODES"].objects:
        ob.hide_render = True
    shots = list(S["camera"]["proofShots"]) + list(extra_shots)
    if SHOTS:
        want = str(SHOTS).split(",")
        shots = [s for s in shots if s["id"] in want or ("orbit" in want and s["id"].startswith("orbit_"))]
    scn = bpy.context.scene
    beauty = []
    for sh in shots:
        aspect = sh.get("aspect", RES[0] / RES[1])
        scn.render.resolution_x = int(round(RES[1] * aspect))
        scn.render.resolution_y = RES[1]
        cam = make_camera(S, sh)
        scn.camera = cam
        billboard_cards(cards, sh["pos"])
        render_setup(S, False)
        p = os.path.join(CACHE, "beauty_%s_%s.png" % (S["id"], sh["id"]))
        scn.render.filepath = p
        bpy.ops.render.render(write_still=True)
        beauty.append((sh, cam, p))
        log("rendered", sh["id"], scn.render.resolution_x, "x", scn.render.resolution_y)
    saved = {}
    depth_materials(S, True, saved)
    outs = []
    for sh, cam, p in beauty:
        aspect = sh.get("aspect", RES[0] / RES[1])
        scn.render.resolution_x = int(round(RES[1] * aspect))
        scn.render.resolution_y = RES[1]
        scn.camera = cam
        billboard_cards(cards, sh["pos"])
        render_setup(S, True)
        dp = os.path.join(CACHE, "depth_%s_%s.png" % (S["id"], sh["id"]))
        scn.render.filepath = dp
        bpy.ops.render.render(write_still=True)
        outp = os.path.join(REP, "%s_%s.png" % (S["id"], sh["id"]))
        fog_composite(S, p, dp, outp)
        outs.append(outp)
        log("proof", outp)
    depth_materials(S, False, saved)
    if any(os.path.basename(o).startswith(S["id"] + "_orbit_") for o in outs):
        orbit_sheet(S["id"])
    return outs


def orbit_sheet(stage_id):
    """4 x 4 labelled contact sheet of the 16 orbit proofs (plain Python + PIL: art/stages/orbit_sheet_a.py)"""
    py = shutil.which("python") or shutil.which("python3")
    if not py:
        log("orbit sheet skipped: no system python")
        return
    r = subprocess.run([py, os.path.join(HERE, "orbit_sheet_a.py"), stage_id], capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=dict(os.environ, PYTHONIOENCODING="utf-8"))
    log("orbit sheet rc", r.returncode, (r.stdout.strip().splitlines() or [""])[-1], r.stderr.strip()[-400:])


# =============================================================== ENV_KIT 8.3 contact render
def contact_render(S, hdri_path, heroes, out_png):
    """each hero prop between qfp_Chandelier and jp_JP_Conditioner_01, one HDRI + one sun, same render settings.
    heroes = [(label, [objects], fit_height_m)] - copies are made; the stage objects are untouched."""
    scn = bpy.context.scene
    col = bpy.data.collections.new("CONTACT")
    scn.collection.children.link(col)
    hidden = []
    for c in (COL["SET"], COL["NODES"], COL["PROOF"]):
        hidden.append((c, c.hide_render))
        c.hide_render = True
    ch = template("ref_chandelier", QFP + "Chandelier.gltf")
    cond_mat = mat_pbr("ref_cond", prep(JPV + "Textures/Environment/JP_Conditioner/JP_Conditioner_A.tga", "ref_cond_a", 1024),
                       prep(JPV + "Textures/Environment/JP_Conditioner/JP_Conditioner_N.tga", "ref_cond_n", 1024, True),
                       roughness=0.55, metallic=0.2)
    co = template("ref_cond", JPV + "Models/Environment/JP_Conditioner_01.fbx", mat_override=cond_mat)
    canon_kit_images()
    world = bpy.data.worlds.new("contact_world")
    world.use_nodes = True
    nt = world.node_tree
    bg = next(n for n in nt.nodes if n.type == "BACKGROUND")
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(hdri_path, check_existing=True)
    nt.links.new(env.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 0.9
    old_world = scn.world
    scn.world = world
    sun_d = bpy.data.lights.new("contact_sun", "SUN")
    sun_d.energy = 2.2
    sun = bpy.data.objects.new("contact_sun", sun_d)
    col.objects.link(sun)
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    floor_m = mat_pbr("contact_floor", color=(0.18, 0.18, 0.2, 1), roughness=0.8)
    panels = []
    X0 = 400.0
    for pi, (lab, objs, fit_h) in enumerate(heroes):
        ox = X0 + pi * 60.0
        # hero copy, scaled to fit_h, bottom on the floor at x = ox
        me_objs = []
        for o in objs:
            if o.type != "MESH":
                continue
            me = o.data.copy()
            me.transform(o.matrix_world)
            c2 = bpy.data.objects.new("contact_" + o.name, me)
            col.objects.link(c2)
            me_objs.append(c2)
        lo = Vector((1e9, 1e9, 1e9))
        hi = Vector((-1e9, -1e9, -1e9))
        for c2 in me_objs:
            for v in c2.data.vertices:
                lo = Vector((min(lo.x, v.co.x), min(lo.y, v.co.y), min(lo.z, v.co.z)))
                hi = Vector((max(hi.x, v.co.x), max(hi.y, v.co.y), max(hi.z, v.co.z)))
        ext = max(hi.x - lo.x, hi.y - lo.y)
        flat = (hi.z - lo.z) < 0.25 * ext               # floor plates: fit the footprint, look from higher up
        k = fit_h / max(1e-3, ext if flat else hi.z - lo.z)
        cen = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
        for c2 in me_objs:
            c2.data.transform(Matrix.Translation(Vector((ox, 0, 0))) @ Matrix.Scale(k, 4) @ Matrix.Translation(-cen))
        # references left/right at native scale (conditioner x2 so it reads at the same size class)
        o1 = bpy.data.objects.new("contact_ch_%d" % pi, TPL["ref_chandelier"][0].data)
        col.objects.link(o1)
        b0, l0, h0 = TPL["ref_chandelier"]
        o1.matrix_world = Matrix.Translation(Vector((ox - 2.3, 0, 0))) @ Matrix.Translation(Vector((-(l0.x + h0.x) / 2, -(l0.y + h0.y) / 2, -l0.z)))
        o2 = bpy.data.objects.new("contact_co_%d" % pi, TPL["ref_cond"][0].data)
        col.objects.link(o2)
        b1_, l1, h1 = TPL["ref_cond"]
        o2.matrix_world = Matrix.Translation(Vector((ox + 2.3, 0, 0))) @ Matrix.Scale(2.0, 4) @ \
            Matrix.Translation(Vector((-(l1.x + h1.x) / 2, -(l1.y + h1.y) / 2, -l1.z)))
        bm = bmesh.new()
        bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=6.0)
        bmesh.ops.translate(bm, verts=bm.verts, vec=Vector((ox, 2.0, 0)))
        fl = finish(bm, "contact_floor_%d" % pi, [floor_m], col=col)
        cd = bpy.data.cameras.new("contact_cam_%d" % pi)
        cd.angle_y = math.radians(30)
        cd.sensor_fit = "VERTICAL"
        cam = bpy.data.objects.new("contact_cam_%d" % pi, cd)
        col.objects.link(cam)
        tgt = Vector((ox, 0, max(fit_h, 1.4) * 0.5))
        cam.location = tgt + (Vector((1.2, -5.6, 4.6)) if flat else Vector((1.2, -7.4, 1.1)))
        cam.rotation_mode = "QUATERNION"
        cam.rotation_quaternion = (tgt - cam.location).to_track_quat("-Z", "Y")
        scn.camera = cam
        scn.render.resolution_x, scn.render.resolution_y = 960, 540
        render_setup({"exposure": 1.0}, False, samples=32)
        p = os.path.join(CACHE, "contact_%s_%d.png" % (S["id"], pi))
        scn.render.filepath = p
        bpy.ops.render.render(write_still=True)
        panels.append(p)
        log("contact panel", lab)
    # montage (2 columns)
    ims = [_px(bpy.data.images.load(p, check_existing=False)) for p in panels]
    h, w = ims[0].shape[:2]
    cols = 2
    rows = (len(ims) + cols - 1) // cols
    sheet = np.zeros((rows * h, cols * w, 4), np.float32)
    sheet[..., 3] = 1
    for i, a in enumerate(ims):
        r, c = i // cols, i % cols
        yy = (rows - 1 - r) * h                      # Blender pixel rows run bottom-up
        sheet[yy:yy + h, c * w:(c + 1) * w] = a
    img = bpy.data.images.new("contact_sheet", cols * w, rows * h)
    _set_px(img, sheet)
    img.filepath_raw = out_png
    img.file_format = "PNG"
    img.save()
    log("contact sheet", out_png)
    for c, v in hidden:
        c.hide_render = v
    scn.world = old_world
    for o in list(col.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.collections.remove(col)


# =============================================================== export + finish + fragment
def glb_stats(path):
    """draws (primitives on mesh nodes), triangles, bytes, materials, textures, crowd nodes (write_stages_json.py rule)"""
    b = open(path, "rb").read()
    jl = struct.unpack_from("<I", b, 12)[0]
    g = json.loads(b[20:20 + jl].decode("utf-8"))
    draws = tris = 0
    for n in g.get("nodes", []):
        if "mesh" not in n:
            continue
        m = g["meshes"][n["mesh"]]
        inst_ = n.get("extensions", {}).get("EXT_mesh_gpu_instancing")
        count = g["accessors"][list(inst_["attributes"].values())[0]]["count"] if inst_ else 1
        for p in m["primitives"]:
            draws += 1
            if "indices" in p:
                t = g["accessors"][p["indices"]]["count"] // 3
            else:
                t = g["accessors"][p["attributes"]["POSITION"]]["count"] // 3
            tris += t * count
    crowd = [n for n in g.get("nodes", []) if str(n.get("name", "")).startswith("crowd_")]
    lights = len(g.get("extensions", {}).get("KHR_lights_punctual", {}).get("lights", []))
    named = sorted(str(n.get("name")) for n in g.get("nodes", []) if "mesh" in n)
    return {"bytes": len(b), "draws": draws, "triangles": tris, "materials": len(g.get("materials", [])),
            "textures": len(g.get("textures", [])), "crowdNodes": len(crowd), "lights": lights,
            "meshNodes": named, "extensions": g.get("extensionsUsed", [])}


def export(stage_id, exclude=()):
    """join COL SET (minus animated / excluded objects) into <id>_set; export set + ANIM nodes + crowd empties"""
    raw = os.path.join(CACHE, stage_id + "_raw.glb")
    anim_objs = set(ANIM.values())
    set_objs = [o for o in COL["SET"].objects if o.type == "MESH" and o not in anim_objs and o not in exclude]
    set_ob = join_objs(set_objs, stage_id + "_set")
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    sel = [set_ob] + list(ANIM.values()) + list(COL["NODES"].objects)
    for o in sel:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = set_ob
    kw = dict(filepath=raw, export_format="GLB", use_selection=True, export_apply=True, export_extras=True,
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
    log("exported", raw, os.path.getsize(raw), "bytes; set tris", tris, "materials", len(set_ob.data.materials),
        "anim nodes", sorted(ANIM.keys()))
    return raw


def finish_glb(stage_id, raw):
    """TECH_REUSE chain D, same flags as art/stages/finish_stage.py (keeps the crowd_* empties)"""
    out = os.path.join(out_glb_dir(), stage_id + ".glb")
    gt = shutil.which("gltf-transform")
    if not gt:
        raise SystemExit("gltf-transform not on PATH")
    cmd = [gt, "optimize", raw, out, "--compress", "meshopt", "--texture-compress", "webp", "--texture-size", "1024",
           "--prune", "false", "--simplify", "false", "--flatten", "false", "--join", "false",
           "--palette", "false", "--instance", "false"]
    log("RUN gltf-transform optimize ...")
    r = subprocess.run(cmd, shell=(os.name == "nt"), capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        print(r.stdout[-3000:], r.stderr[-3000:])
        raise SystemExit("gltf-transform failed rc=%d" % r.returncode)
    log("raw", os.path.getsize(raw), "->", out, os.path.getsize(out))
    return out


def write_fragment(S, build=None):
    frag = json.loads(json.dumps(S))
    if build is not None:
        frag["build"] = build
    else:
        old = os.path.join(out_frag_dir(), S["id"] + ".stage.json")
        # CHANGED(fix_ui_stage): `--fragment-only` into an empty staging dir carries the SHIPPED fragment's measured build
        # (GLB stats + the camera-band clearance probe) - the GLB is unchanged, merge_stages --install validates against it
        if not os.path.exists(old):
            old = os.path.join(HERE, S["id"] + ".stage.json")
        if os.path.exists(old):
            prev = json.load(open(old, encoding="utf-8"))
            if "build" in prev:
                frag["build"] = prev["build"]
    p = os.path.join(out_frag_dir(), S["id"] + ".stage.json")
    with open(p, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(frag, indent=2) + "\n")
    log("fragment", p)
    return p


def camera_block(stage_id):
    """the game camera facts (FIGHTING_DESIGN 7b / CONTRACT 7) + the same proof shots as rust_theater"""
    return {
        "vFovDeg": 35.0, "heightM": 1.25, "lookAtY": 1.0, "distanceM": [4.36, 7.6], "pitchDeg": [-2.0, -4.0],
        "wallClampX": 8.0,
        "note": "FIGHTING_DESIGN 7b. Camera x is clamped so the splat wall sits at the screen edge on the fight line: "
                "|camX| <= wallClampX - distance * tan(hFov/2). Proof renders: _harness/_reports/stages/%s_*.png" % stage_id,
        "proofShots": [
            {"id": "near_center", "pos": [0.0, 1.25, 4.4], "look": [0.0, 1.0, 0.0]},
            {"id": "far_center", "pos": [0.0, 1.25, 7.6], "look": [0.0, 1.0, 0.0]},
            {"id": "near_corner_r", "pos": [5.53, 1.25, 4.4], "look": [5.53, 1.0, 0.0]},
            {"id": "far_corner_l", "pos": [-3.74, 1.25, 7.6], "look": [-3.74, 1.0, 0.0]},
            {"id": "far_center_phone", "pos": [0.0, 1.25, 6.22], "look": [0.0, 1.0, 0.0], "aspect": 2.1667},
        ],
    }


def crowd_block(tint, brightness, bays):
    return {
        "atlas": "crowd_atlas.webp", "meta": "crowd_atlas.json", "cols": 12, "rows": 6, "count": 72,
        "cardHeightM": 2.4, "cardWidthM": 1.2, "anchor": [0.5, 0.97917], "tint": tint, "brightness": brightness,
        "moods": {"idle": ["watch"], "cheer": ["cheer", "hype"], "jeer": ["jeer"]},
        "nodes": "GLB empties crowd_<bay>_<row>_<i>: position = feet point, +Z = card facing, uniform scale = card "
                 "height; extras {bay,row,i,rand,angle}. Generated from the bays below (rows run along world X; "
                 "x step = spacing, jitter = [x,z] half-ranges from mulberry32(seed); card yaw = faceYawDeg about +Y).",
        "bays": bays,
    }


def build_and_ship(S, hdri_path, nodes, bodies, extra_shots=(), heroes=None):
    """the common tail: fragment -> proofs -> contact -> export -> gltf-transform -> measured fragment"""
    write_fragment(S)
    clear = clearance_probe(S) if "ring" in S else None
    if DO_RENDER:
        render_proofs(S, hdri_path, nodes, bodies, extra_shots)
    if DO_CONTACT and heroes:
        contact_render(S, hdri_path, heroes, os.path.join(REP, "%s_contact.png" % S["id"]))
    if DO_EXPORT:
        raw = export(S["id"])
        out = finish_glb(S["id"], raw)
        st = glb_stats(out)
        envp = os.path.join(out_glb_dir(), S["environment"]["hdr"])
        st["envBytes"] = os.path.getsize(envp) if os.path.exists(envp) else None
        mesh_nodes = st.pop("meshNodes")
        if clear is not None:
            st["clearance"] = clear
        log("measured", json.dumps(st), "mesh nodes", mesh_nodes)
        write_fragment(S, st)
        budget_b = 6000000
        tot = st["bytes"] + (st["envBytes"] or 0)
        log("BUDGET bytes %d (glb %d + env %s) <= %d: %s; draws %d <= 150: %s; lights in GLB %d" % (
            tot, st["bytes"], st["envBytes"], budget_b, tot <= budget_b, st["draws"], st["draws"] <= 150, st["lights"]))
        log("OUTPUT (%s): %s + %s" % (OUT_MODE, out, os.path.join(out_frag_dir(), S["id"] + ".stage.json")))
    log("DONE")


# =============================================================== CHANGED(STAGES3D-A): 360-degree ring arenas (CONTRACT 35.6 / 35.11)
def polar(r, deg, y=0.0):
    """game point at radius r, angle deg (35.11: 0 = +Z, 90 = +X), height y"""
    a = math.radians(deg)
    return (r * math.sin(a), y, r * math.cos(a))


def _orient(bm, faces_expect):
    """flip faces whose normal disagrees with the expected (game-space) outward direction"""
    for f, n_g in faces_expect:
        if not f.is_valid:
            continue
        f.normal_update()
        if f.normal.dot(G(*n_g)) < 0:
            f.normal_flip()


def annulus(name, r_in, r_out, y0, y1, mat, segs=64, a0=0.0, a1=360.0, tile=2.0, poly_apothem=False, mats=None,
            parts=("in", "out", "top", "bottom", "ends"), col=None, smooth=35.0, tile_v=None, uv_off=(0.0, 0.0)):
    """annular sector solid between radii r_in..r_out and heights y0..y1 over angles a0..a1 (35.11 convention), `segs`
    straight segments. poly_apothem=True: r_* are apothems (flat sides, e.g. an octagon with segs=8 and a0 = rot - 22.5).
    UVs: in/out faces u = chord length along the polygon / tile, v = y / tile; top/bottom planar x, z / tile.
    mats = {part: material index} with `mat` a list (default all 0). tile_v / uv_off: separate vertical tile and a UV offset
    for the in/out faces (u = cum / tile + uo, v = y / tile_v + vo; a texture mapped once across a curved wall)."""
    tv = tile_v or tile
    uo, vo = uv_off
    full = abs((a1 - a0) - 360.0) < 1e-6
    k = 1.0 / math.cos(math.radians((a1 - a0) / segs / 2.0)) if poly_apothem else 1.0
    ri, ro = r_in * k, r_out * k
    n = segs if full else segs + 1
    angs = [a0 + (a1 - a0) * i / segs for i in range(n)]
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")

    def V(r, a, y):
        return bm.verts.new(G(*polar(r, a, y)))
    vi0 = [V(ri, a, y0) for a in angs]
    vi1 = [V(ri, a, y1) for a in angs]
    vo0 = [V(ro, a, y0) for a in angs]
    vo1 = [V(ro, a, y1) for a in angs]
    cum_i, cum_o = [0.0], [0.0]
    for i in range(1, n + (1 if full else 0)):
        pa, pb = angs[i - 1], angs[i % n] if i < n else angs[0] + (360.0 if full else 0)
        ch = 2 * math.sin(math.radians(abs(pb - pa)) / 2)
        cum_i.append(cum_i[-1] + ri * ch)
        cum_o.append(cum_o[-1] + ro * ch)
    mi = mats or {}
    exp = []
    m = n if full else n - 1
    for i in range(m):
        j = (i + 1) % n
        am = math.radians((angs[i] + (angs[i] + (a1 - a0) / segs)) / 2)
        radial = (math.sin(am), 0.0, math.cos(am))
        if "in" in parts and r_in > 1e-4:
            f = bm.faces.new((vi0[i], vi0[j], vi1[j], vi1[i]))
            f.material_index = mi.get("in", 0)
            for loop, (u, v) in zip(f.loops, ((cum_i[i], y0), (cum_i[i + 1], y0), (cum_i[i + 1], y1), (cum_i[i], y1))):
                loop[uvl].uv = (u / tile + uo, v / tv + vo)
            exp.append((f, (-radial[0], 0, -radial[2])))
        if "out" in parts:
            f = bm.faces.new((vo0[i], vo0[j], vo1[j], vo1[i]))
            f.material_index = mi.get("out", 0)
            for loop, (u, v) in zip(f.loops, ((cum_o[i], y0), (cum_o[i + 1], y0), (cum_o[i + 1], y1), (cum_o[i], y1))):
                loop[uvl].uv = (u / tile + uo, v / tv + vo)
            exp.append((f, radial))
        for part, vs_a, vs_b, ny in (("top", vi1, vo1, 1.0), ("bottom", vi0, vo0, -1.0)):
            if part not in parts:
                continue
            if r_in > 1e-4:
                f = bm.faces.new((vs_a[i], vs_a[j], vs_b[j], vs_b[i]))
            else:
                f = bm.faces.new((vs_a[i], vs_b[j], vs_b[i]))
            f.material_index = mi.get(part, 0)
            for loop in f.loops:
                co = loop.vert.co
                loop[uvl].uv = (co.x / tile, co.y / tile)
            exp.append((f, (0, ny, 0)))
    if not full and "ends" in parts:
        for idx, sgn in ((0, -1), (n - 1, 1)):
            a = math.radians(angs[idx])
            tang = (math.cos(a) * sgn, 0.0, -math.sin(a) * sgn)
            if r_in > 1e-4:
                f = bm.faces.new((vi0[idx], vo0[idx], vo1[idx], vi1[idx]))
            else:
                f = bm.faces.new((vo0[idx], vo1[idx], vi1[idx], vi0[idx]))
            f.material_index = mi.get("ends", 0)
            for loop in f.loops:
                co = loop.vert.co
                rr = math.hypot(co.x, co.y)
                loop[uvl].uv = (rr / tile, co.z / tile)
            exp.append((f, tang))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    _orient(bm, exp)
    mats_l = mat if isinstance(mat, (list, tuple)) else [mat]
    return finish(bm, name, mats_l, uv=False, smooth_angle=smooth, col=col)


def disc(name, r, y, mat, segs=64, tile=2.0, col=None, poly_apothem=False, a0=0.0):
    """flat upward disc (triangle fan) at height y, planar UV x, z / tile"""
    return annulus(name, 0.0, r, y - 0.001, y, mat, segs=segs, a0=a0, a1=a0 + 360.0, tile=tile, poly_apothem=poly_apothem,
                   parts=("top",), col=col, smooth=10.0)


def place(objs, pos_g, face_deg):
    """move objects authored at the origin facing game +Z to pos_g, facing angle face_deg (35.11 convention; Blender
    Z rotation psi turns game +Z toward (sin psi, cos psi))"""
    M = Matrix.Translation(G(*pos_g)) @ Matrix.Rotation(math.radians(face_deg), 4, "Z")
    for o in objs:
        if o is not None:
            o.matrix_world = M @ o.matrix_world
    return objs


def collect_new(fn, *a, **kw):
    """run a builder and return every object it added to COL SET (for place())"""
    before = set(COL["SET"].objects)
    fn(*a, **kw)
    return [o for o in COL["SET"].objects if o not in before]


def ring_block(shape, radius, wall_h, thickness, surface, dust, sides=None, rot=0.0, note=""):
    return {"shape": shape, "radiusM": radius, "sides": sides if sides else (16 if shape == "circle" else 8),
            "rotDeg": rot, "wallHeightM": wall_h, "thicknessM": thickness, "surface": surface, "dustColor": dust,
            "note": note or "CONTRACT 35.11: radiusM = centre -> inner face (poly: apothem); poly side k normal at rotDeg + "
                            "k*360/sides; circle: 16 WALL_SPLAT sectors centred on rotDeg + k*22.5"}


def orbit_shots(side_deg=0.0, dists=(4.4, 8.0), eye=1.35):
    out = []
    for k in range(8):
        a = (side_deg + 45.0 * k) % 360.0
        for d, tag in zip(dists, "nf"):
            p = polar(d, a, eye)
            out.append({"id": "orbit_%03d_%s" % (int(round(a)), tag), "pos": [round(v, 3) for v in p],
                        "look": [0.0, 1.0, 0.0]})
    return out


def camera_block_3d(stage_id, side_deg=0.0):
    """35.7 orbit camera facts + legacy 2.5D fields + proof shots (near/far centre at the camera side + 16 orbit shots)"""
    near, far = polar(4.4, side_deg, 1.35), polar(8.0, side_deg, 1.35)
    return {
        "vFovDeg": 35.0, "heightM": 1.35, "lookAtY": 1.0, "distanceM": [4.4, 9.5], "pitchDeg": [-4.0, -4.0],
        "orbit": True, "wallClampX": 8.0,
        "note": "CONTRACT 35.7 orbit camera (eye y 1.35, look-at y 1.0, dist 4.4..9.5 from the pair midpoint). wallClampX = "
                "legacy 2.5D. Proof renders: _harness/_reports/stages/%s_<shot>.png, orbit sheet %s_orbit_sheet.png"
                % (stage_id, stage_id),
        "proofShots": [
            {"id": "near_center", "pos": [round(v, 3) for v in near], "look": [0.0, 1.0, 0.0]},
            {"id": "far_center", "pos": [round(v, 3) for v in far], "look": [0.0, 1.0, 0.0]},
            {"id": "far_center_phone", "pos": [round(v, 3) for v in polar(6.6, side_deg, 1.35)], "look": [0.0, 1.0, 0.0],
             "aspect": 2.1667},
        ] + orbit_shots(side_deg),
    }


def spawn_block(axis_deg=90.0, dist=2.4):
    a = math.radians(axis_deg)
    h = dist / 2.0
    return {"distanceM": dist, "p1": [round(-h * math.sin(a), 4), 0.0, round(-h * math.cos(a), 4)],
            "p2": [round(h * math.sin(a), 4), 0.0, round(h * math.cos(a), 4)]}


def clearance_probe(S, band=(1.30, 3.00), rmax=None):
    """CONTRACT 35.11.5: exact min horizontal radius of any set triangle inside the camera band y band[0]..band[1]
    (triangles clipped to the band, then the 2D distance of the clipped polygon to the ring axis). Every exported
    mesh (COL SET + ANIM) counts. Logs the offenders inside cameraMaxM; returns the fragment `build.clearance` block."""
    rmax = rmax or S.get("cameraMaxM", 9.5)
    lo, hi = band
    worst = []
    deps = bpy.context.evaluated_depsgraph_get()
    objs = [o for o in COL["SET"].objects if o.type == "MESH"] + [o for o in ANIM.values() if o.type == "MESH"]
    seen = set()
    for ob in objs:
        if ob.name in seen:
            continue
        seen.add(ob.name)
        me = ob.data
        me.calc_loop_triangles()
        mw = ob.matrix_world
        vco = [mw @ v.co for v in me.vertices]
        # game coords: x = bx, y = bz, z = -by
        vg = [(c.x, c.z, -c.y) for c in vco]
        best = 1e9
        for t in me.loop_triangles:
            P = [vg[i] for i in t.vertices]
            ys = [p[1] for p in P]
            if max(ys) < lo or min(ys) > hi:
                continue
            poly = P
            for plane, keep_above in ((lo, True), (hi, False)):
                out = []
                for i in range(len(poly)):
                    a, b = poly[i], poly[(i + 1) % len(poly)]
                    ina = (a[1] >= plane) if keep_above else (a[1] <= plane)
                    inb = (b[1] >= plane) if keep_above else (b[1] <= plane)
                    if ina:
                        out.append(a)
                    if ina != inb:
                        tt = (plane - a[1]) / (b[1] - a[1])
                        out.append((a[0] + (b[0] - a[0]) * tt, plane, a[2] + (b[2] - a[2]) * tt))
                poly = out
                if not poly:
                    break
            if not poly:
                continue
            q = [(p[0], p[2]) for p in poly]
            # origin inside the polygon (2D)? -> 0
            inside = False
            for i in range(len(q)):
                (x1, z1), (x2, z2) = q[i], q[(i + 1) % len(q)]
                if (z1 > 0) != (z2 > 0) and 0 < (x2 - x1) * (0 - z1) / (z2 - z1 + 1e-300) + x1:
                    inside = not inside
            if inside and len(q) >= 3:
                d = 0.0
            else:
                d = 1e9
                for i in range(len(q)):
                    (x1, z1), (x2, z2) = q[i], q[(i + 1) % len(q)]
                    ex, ez = x2 - x1, z2 - z1
                    L2 = ex * ex + ez * ez
                    tt = 0.0 if L2 < 1e-12 else max(0.0, min(1.0, -(x1 * ex + z1 * ez) / L2))
                    d = min(d, math.hypot(x1 + ex * tt, z1 + ez * tt))
            best = min(best, d)
        if best < 1e8:
            worst.append((best, ob.name))
    worst.sort()
    inside = [(round(d, 3), n) for d, n in worst if d < rmax]
    minr = round(worst[0][0], 3) if worst else None
    log("CLEARANCE band y %.2f..%.2f: min radius %s (%s); inside cameraMaxM %.2f: %d object(s) %s" % (
        lo, hi, minr, worst[0][1] if worst else "-", rmax, len(inside), inside[:12]))
    if inside:
        log("CLEARANCE FAIL")
    return {"bandY": [lo, hi], "minRadiusM": minr, "nearest": worst[0][1] if worst else None,
            "cameraMaxM": rmax, "ok": not inside}
