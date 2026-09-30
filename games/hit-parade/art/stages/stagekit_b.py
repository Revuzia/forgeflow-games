"""HIT PARADE - shared Blender helpers for lane STAGES-B's stage builds (art/stages/rooftop.py, control_room.py).

Adapted from the P1 precedent art/stages/rust_theater.py (same axes, materials, crowd nodes, proof-render and export
conventions; CONTRACT 21). Import from a stage script running inside blender.exe:

  import stagekit_b as K
  K.init("rooftop", STAGE_DEF)          # runs art2d_b.py (textures) unless --no-art, resets the scene
  ... build with K.gbox / K.tube / K.lathe / K.mat_pbr / K.template / K.inst ...
  K.main(dress=[("rain_fall", objs, None), ...], env_src=..., fighters=[...])

Common CLI (after `--`): --no-export --no-render --no-fighters --no-art --no-finish --contact
  --shots id,id --res 1920x1080 --samples 48 [--orbit-only] [--no-orbit]
3D ring helpers (CONTRACT 35.6 / 35.11): placed(yaw) builds a set piece in the local "behind the ring" frame (local -Z,
facing +Z = toward the ring centre) and yaws it about the ring centre; crowd bays take `rotDeg`; orbit_shots() = the 8
angles x near/far proof cameras (the stand-in pair turns with the camera, as the game's camN does); clearance() measures
the set-free radius at camera height (camera.clearRadiusM).
Everything is authored in GAME coordinates (glTF: +X fight line, +Y up, camera on +Z) through G(x, y, z) ->
Blender (x, -z, y); the glTF exporter's +Y-up conversion maps it back exactly. ASCII only.
"""
import bpy
import bmesh
import sys
import os
import json
import math
import time
import shutil
import subprocess
from mathutils import Vector, Matrix
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True   # no __pycache__ inside art/stages


def _crowd_atlas():
    """art/stages/crowd_atlas.py (lane STAGES P1: toon material + static retarget, render-only fighter stand-ins) as a
    module. The committed file has two `newline="<LF>"` string literals split across lines (SyntaxError on import,
    measured: line 437); it is loaded with those literals repaired in memory instead of editing the P1 file (the same
    approach lane STAGES-A took in stagelib_a.py)."""
    import types
    p = os.path.join(HERE, "crowd_atlas.py")
    src = open(p, encoding="utf-8").read().replace('newline="\n"', 'newline="\\n"')
    mod = types.ModuleType("crowd_atlas")
    mod.__file__ = p
    exec(compile(src, p, "exec"), mod.__dict__)
    return mod


CA = _crowd_atlas()

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
DO_ART = not arg("--no-art", False)
DO_FINISH = not arg("--no-finish", False)
DO_CONTACT = bool(arg("--contact", False))
RES = [int(v) for v in str(arg("--res", "1920x1080")).split("x")]
SAMPLES = int(arg("--samples", 48))
SHOTS = arg("--shots", None)
ORBIT_ONLY = bool(arg("--orbit-only", False))
NO_ORBIT = bool(arg("--no-orbit", False))

CACHE = os.path.join(ROOT, "_harness", "scratch", "stages_cache")
REP = os.path.join(ROOT, "_harness", "_reports", "stages")
GLTF_OUT = os.path.join(ROOT, "art", "gltf", "stages")
# 3D ring conversion (lane STAGES3D-B): every build output (finished GLB, env HDR, fragment) is STAGED here first and
# swapped into art/gltf/stages + art/stages in one move by `python art/stages/stagefinish_b.py <id> --swap` (the running
# game keeps loading the shipped files until then).
OUT3D = os.path.join(CACHE, "out3d")
for d in (CACHE, REP, GLTF_OUT, OUT3D):
    os.makedirs(d, exist_ok=True)

A = "F:/games/forgeflow-games-assets"
U = "F:/games/unity-assets"
JPM = U + "/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Models/"
JPT = U + "/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Textures/"
QFP = A + "/3d-models/fantasy-props-mega/Exports/glTF/"
PHH = A + "/_downloaded/polyhaven-hdris/"
FONTS = os.path.join(CACHE, "fonts_b")

T0 = time.time()
SID = None
S = None
TEX = None
SCN = None
COL_SET = COL_NODES = COL_PROOF = COL_TPL = None
TPL = {}
_IMG = {}


def log(*a):
    print("[%s %6.1fs]" % (SID or "kit", time.time() - T0), *a, flush=True)


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


def system_python():
    p = os.environ.get("HP_PYTHON")
    if p and os.path.exists(p):
        return p
    for c in ("python", "python3", "py"):
        w = shutil.which(c)
        if w and "WindowsApps" not in w:
            return w
    raise SystemExit("no system python on PATH (set HP_PYTHON) - art2d_b.py needs PIL + numpy")


# =============================================================== init
def init(sid, stage_def):
    global SID, S, TEX, SCN, COL_SET, COL_NODES, COL_PROOF, COL_TPL
    SID = sid
    S = stage_def
    TEX = os.path.join(CACHE, "tex_" + sid)
    if DO_ART or not os.path.isdir(TEX):
        py = system_python()
        log("art2d_b.py", sid, "with", py)
        r = subprocess.run([py, os.path.join(HERE, "art2d_b.py"), sid, "--sheet"], capture_output=True, text=True,
                           encoding="utf-8", errors="replace")
        print(r.stdout[-2000:], r.stderr[-2000:], flush=True)
        if r.returncode != 0:
            raise SystemExit("art2d_b.py failed rc=%d" % r.returncode)
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
    return SCN


def link(ob, col=None):
    col = col or COL_SET
    for c in ob.users_collection:
        c.objects.unlink(ob)
    col.objects.link(ob)
    return ob


# =============================================================== images + materials
def img(name, noncolor=False):
    """load a PNG written by art2d_b.py from the stage's texture cache"""
    key = (name, noncolor)
    if key in _IMG:
        return _IMG[key]
    p = os.path.join(TEX, name + ".png")
    im = bpy.data.images.load(p, check_existing=False)
    im.name = name
    if noncolor:
        im.colorspace_settings.name = "Non-Color"
    _IMG[key] = im
    return im


def mat_pbr(name, a=None, n=None, r=None, color=(0.8, 0.8, 0.8, 1), roughness=0.85, metallic=0.0, emission=None,
            estrength=0.0, etex=None, nstrength=1.0, double=False, alpha=None, alpha_value=1.0):
    """Principled BSDF the glTF exporter maps 1:1 (baseColor/normal/roughness/emissive[+strength], alphaMode).
    a/n/r/etex: bpy images or texture-cache names. alpha: None | 'MASK' (tex alpha -> Round) | 'BLEND'."""
    if isinstance(a, str):
        a = img(a)
    if isinstance(n, str):
        n = img(n, True)
    if isinstance(r, str):
        r = img(r, True)
    if isinstance(etex, str):
        etex = img(etex)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bs = next(nd for nd in nt.nodes if nd.type == "BSDF_PRINCIPLED")
    ta = None
    if a is not None:
        ta = nt.nodes.new("ShaderNodeTexImage")
        ta.image = a
        nt.links.new(ta.outputs["Color"], bs.inputs["Base Color"])
    else:
        bs.inputs["Base Color"].default_value = color
    if n is not None:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = n
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = nstrength
        nt.links.new(t.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bs.inputs["Normal"])
    if r is not None:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = r
        nt.links.new(t.outputs["Color"], bs.inputs["Roughness"])
    else:
        bs.inputs["Roughness"].default_value = roughness
    bs.inputs["Metallic"].default_value = metallic
    if etex is not None:
        te = ta if (ta is not None and etex == a) else None
        if te is None:
            te = nt.nodes.new("ShaderNodeTexImage")
            te.image = etex
        nt.links.new(te.outputs["Color"], bs.inputs["Emission Color"])
        bs.inputs["Emission Strength"].default_value = estrength if estrength > 0 else 1.0
    elif emission is not None:
        bs.inputs["Emission Color"].default_value = emission
        bs.inputs["Emission Strength"].default_value = estrength
    if alpha == "MASK" and ta is not None:
        rd = nt.nodes.new("ShaderNodeMath")
        rd.operation = "ROUND"
        nt.links.new(ta.outputs["Alpha"], rd.inputs[0])
        nt.links.new(rd.outputs[0], bs.inputs["Alpha"])
        try:
            m.surface_render_method = "DITHERED"
        except AttributeError:
            pass
    elif alpha == "BLEND":
        if ta is not None:
            nt.links.new(ta.outputs["Alpha"], bs.inputs["Alpha"])
        else:
            bs.inputs["Alpha"].default_value = alpha_value
        try:
            m.surface_render_method = "BLENDED"
        except AttributeError:
            pass
    m.use_backface_culling = not double
    return m


def mat_unlit(name, tex=None, color=(1, 1, 1, 1), alpha=None, double=False, strength=1.0):
    """KHR_materials_unlit (three MeshBasicMaterial: cheap, not lit, still fogged): the exporter's lightpath trick
    Output <- Mix(IsCameraRay, Transparent, Emission(tex)) [+ outer Mix(alpha, Transparent, ...) for MASK / BLEND]."""
    if isinstance(tex, str):
        tex = img(tex)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for nd in list(nt.nodes):
        nt.nodes.remove(nd)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = strength
    t = None
    if tex is not None:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = tex
        nt.links.new(t.outputs["Color"], em.inputs["Color"])
    else:
        em.inputs["Color"].default_value = color
    lp = nt.nodes.new("ShaderNodeLightPath")
    tr0 = nt.nodes.new("ShaderNodeBsdfTransparent")
    mx = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(lp.outputs["Is Camera Ray"], mx.inputs[0])
    nt.links.new(tr0.outputs[0], mx.inputs[1])
    nt.links.new(em.outputs[0], mx.inputs[2])
    if alpha in ("MASK", "BLEND") and t is not None:
        tr = nt.nodes.new("ShaderNodeBsdfTransparent")
        mo = nt.nodes.new("ShaderNodeMixShader")
        if alpha == "MASK":
            rd = nt.nodes.new("ShaderNodeMath")
            rd.operation = "ROUND"
            nt.links.new(t.outputs["Alpha"], rd.inputs[0])
            nt.links.new(rd.outputs[0], mo.inputs[0])
        else:
            nt.links.new(t.outputs["Alpha"], mo.inputs[0])
        nt.links.new(tr.outputs[0], mo.inputs[1])
        nt.links.new(mx.outputs[0], mo.inputs[2])
        nt.links.new(mo.outputs[0], out.inputs["Surface"])
        try:
            m.surface_render_method = "BLENDED" if alpha == "BLEND" else "DITHERED"
        except AttributeError:
            pass
    else:
        nt.links.new(mx.outputs[0], out.inputs["Surface"])
    m.use_backface_culling = not double
    return m


# =============================================================== geometry helpers
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
    (col or COL_SET).objects.link(ob)
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


def obox(name, c, size, mat, yaw_deg=0.0, tile=2.0, bevel=0.0, segs=2, col=None, pitch_deg=0.0, roll_deg=0.0):
    """box centred at game point c with game-axis size (sx, sy, sz), rotated yaw about game +Y (then pitch/roll)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    sx, sy, sz = size
    for v in bm.verts:
        v.co = Vector((v.co.x * sx, v.co.y * sz, v.co.z * sy))
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=segs, profile=0.5, affect="EDGES",
                        clamp_overlap=True)
    R = (Matrix.Rotation(math.radians(yaw_deg), 4, "Z") @ Matrix.Rotation(math.radians(pitch_deg), 4, "X")
         @ Matrix.Rotation(math.radians(roll_deg), 4, "Y"))
    bmesh.ops.transform(bm, matrix=R, verts=bm.verts)
    bmesh.ops.translate(bm, verts=bm.verts, vec=G(*c))
    return finish(bm, name, [mat], tile, col=col)


def tube(name, pts, r, mat, sides=6, col=None, caps=True, tile=0.5, uv_along=None):
    """tube along game-space points. uv_along=(tile_len, v0, v1): u = length / tile_len, v = around in [v0, v1]
    (pipe paint atlas bands); default: box UV."""
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
            a = (prev_a - d * prev_a.dot(d)).normalized()   # parallel transport: no twist
        b = d.cross(a).normalized()
        prev_a = a
        rings.append([bm.verts.new(p + (a * math.cos(2 * math.pi * k / sides) + b * math.sin(2 * math.pi * k / sides)) * r)
                      for k in range(sides)])
    uvl = bm.loops.layers.uv.new("UVMap") if uv_along else None
    L = [0.0]
    for i in range(1, len(P)):
        L.append(L[-1] + (P[i] - P[i - 1]).length)
    for i in range(len(rings) - 1):
        for k in range(sides):
            f = bm.faces.new((rings[i][k], rings[i][(k + 1) % sides], rings[i + 1][(k + 1) % sides], rings[i + 1][k]))
            if uvl:
                tl, v0, v1 = uv_along
                vv = [v0 + (v1 - v0) * (k / sides), v0 + (v1 - v0) * ((k + 1) / sides)]
                uu = [L[i] / tl, L[i + 1] / tl]
                for loop, (ui, vi) in zip(f.loops, ((0, 0), (0, 1), (1, 1), (1, 0))):
                    loop[uvl].uv = (uu[ui], vv[vi])
    if caps:
        f0 = bm.faces.new(list(reversed(rings[0])))
        f1 = bm.faces.new(rings[-1])
        if uvl:
            tl, v0, v1 = uv_along
            for f in (f0, f1):
                for loop in f.loops:
                    loop[uvl].uv = (0.0, (v0 + v1) / 2)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    return finish(bm, name, [mat], tile, smooth_angle=60, col=col, uv=not uv_along)


def cyl(name, center_g, axis_g, r, length, mat, sides=16, bevel=0.0, col=None, tile=0.6, r2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=sides, radius1=r, radius2=(r if r2 is None else r2),
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


def surface(name, nu, nv, fn, mat, uvfn, col=None, flip=False, smooth_angle=75):
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
    return finish(bm, name, [mat], uv=False, smooth_angle=smooth_angle, col=col)


def quad(name, corners_g, mat, uvs=((0, 0), (1, 0), (1, 1), (0, 1)), col=None):
    """one quad from 4 game points (counter-clockwise seen from the front), explicit UVs"""
    bm = bmesh.new()
    vs = [bm.verts.new(G(*p)) for p in corners_g]
    f = bm.faces.new(vs)
    uvl = bm.loops.layers.uv.new("UVMap")
    for loop, uv in zip(f.loops, uvs):
        loop[uvl].uv = uv
    return finish(bm, name, [mat], uv=False, col=col)


def lathe(name, prof, center_g, mat, sides=24, tile_u=1.0, tile_v=1.0, col=None, smooth_angle=50, cap_top=True,
          cap_bot=True, uv_fn=None):
    """revolve profile [(r, y), ...] (bottom to top, local y) about the vertical axis through center_g."""
    bm = bmesh.new()
    cx, cy, cz = center_g
    rings = []
    for (r, y) in prof:
        rings.append([bm.verts.new(G(cx + r * math.cos(2 * math.pi * k / sides), cy + y, cz + r * math.sin(2 * math.pi * k / sides)))
                      for k in range(sides)])
    uvl = bm.loops.layers.uv.new("UVMap")
    L = [0.0]
    for i in range(1, len(prof)):
        L.append(L[-1] + math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]))
    rmax = max(p[0] for p in prof)
    for i in range(len(rings) - 1):
        for k in range(sides):
            f = bm.faces.new((rings[i][k], rings[i + 1][k], rings[i + 1][(k + 1) % sides], rings[i][(k + 1) % sides]))
            for loop, (ii, kk) in zip(f.loops, ((i, k), (i + 1, k), (i + 1, k + 1), (i, k + 1))):
                if uv_fn:
                    loop[uvl].uv = uv_fn(kk / sides, L[ii], ii)
                else:
                    loop[uvl].uv = (kk / sides * 2 * math.pi * rmax / tile_u, L[ii] / tile_v)
    if cap_bot and prof[0][0] > 1e-4:
        f = bm.faces.new(list(reversed(rings[0])))
        for loop in f.loops:
            co = loop.vert.co
            loop[uvl].uv = ((co.x - cx) / tile_u, (co.y + cz) / tile_u)
    if cap_top and prof[-1][0] > 1e-4:
        f = bm.faces.new(rings[-1])
        for loop in f.loops:
            co = loop.vert.co
            loop[uvl].uv = ((co.x - cx) / tile_u, (co.y + cz) / tile_u)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    return finish(bm, name, [mat], uv=False, smooth_angle=smooth_angle, col=col)


def catenary(p0, p1, sag, n=16):
    pts = []
    for k in range(n + 1):
        t = k / n
        pts.append((p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t - sag * 4 * t * (1 - t),
                    p0[2] + (p1[2] - p0[2]) * t))
    return pts


def chain(name, top_g, bottom_g, mat, link_len=0.11, r=0.028, col=None):
    bm = bmesh.new()
    a, b = G(*top_g), G(*bottom_g)
    L = (b - a).length
    n = max(2, int(L / link_len))
    d = (b - a).normalized()
    q = Vector((0, 0, 1)).rotation_difference(d)
    for i in range(n):
        c = a + d * (link_len * (i + 0.5))
        rot = q.to_matrix() @ Matrix.Rotation(math.pi / 2 * (i % 2), 3, "Z")
        vs = []
        seg, sides = 8, 4
        for j in range(seg):
            th = 2 * math.pi * j / seg
            cx, cz = 0.035 * math.cos(th), 0.06 * math.sin(th)
            ring = []
            for qq in range(sides):
                ph = 2 * math.pi * qq / sides
                rr = r * 0.35
                off = Vector((cx + rr * math.cos(ph) * math.cos(th), rr * math.sin(ph), cz + rr * math.cos(ph) * math.sin(th)))
                ring.append(bm.verts.new(c + rot @ off))
            vs.append(ring)
        for j in range(seg):
            for qq in range(sides):
                bm.faces.new((vs[j][qq], vs[(j + 1) % seg][qq], vs[(j + 1) % seg][(qq + 1) % sides], vs[j][(qq + 1) % sides]))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    return finish(bm, name, [mat], tile=0.3, smooth_angle=60, col=col)


def bolts(name, pts_g, normal_g, mat, r=0.018, h=0.012, sides=6, col=None):
    """hex bolt heads at game points, pointing along normal_g (secondary detail at 3 m)"""
    bm = bmesh.new()
    nrm = G(*normal_g).normalized()
    q = Vector((0, 0, 1)).rotation_difference(nrm)
    for p in pts_g:
        geom = bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=sides, radius1=r, radius2=r * 0.85, depth=h)
        vs = geom["verts"]
        bmesh.ops.rotate(bm, verts=vs, cent=(0, 0, 0), matrix=q.to_matrix())
        bmesh.ops.translate(bm, verts=vs, vec=G(*p) + nrm * (h / 2))
    return finish(bm, name, [mat], tile=0.2, smooth_angle=30, col=col)


def text_mesh(name, body, font_file, size, loc_g, mats, extrude=0.03, bevel=0.004, align="CENTER", yaw_deg=0.0,
              neon_r=None, space=1.0, col=None, resolution=3):
    """text in the game XY plane facing +Z at loc_g. mats = [face, side]. neon_r: outline tubes instead of solid glyphs
    (curve fill NONE + bevel = round tubes along the glyph outlines, a real neon-sign build)."""
    cu = bpy.data.curves.new(name + "_crv", "FONT")
    cu.body = body
    if font_file:
        cu.font = bpy.data.fonts.load(font_file, check_existing=True)
    cu.align_x = align
    cu.align_y = "CENTER"
    cu.size = size
    cu.space_character = space
    cu.resolution_u = resolution
    if neon_r:
        cu.fill_mode = "NONE"
        cu.extrude = 0.0
        cu.bevel_depth = neon_r
        cu.bevel_resolution = 2
    else:
        cu.extrude = extrude
        cu.bevel_depth = bevel
        cu.bevel_resolution = 1
    tob = bpy.data.objects.new(name + "_tmp", cu)
    COL_PROOF.objects.link(tob)
    tob.rotation_euler = (math.radians(90), 0, math.radians(yaw_deg))
    tob.location = G(*loc_g)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tob.evaluated_get(dg))
    me.transform(tob.matrix_world)
    bpy.data.objects.remove(tob, do_unlink=True)
    for mm in mats:
        me.materials.append(mm)
    fwd = G(math.sin(math.radians(yaw_deg)), 0, math.cos(math.radians(yaw_deg)))
    if len(mats) > 1:
        for p in me.polygons:
            p.material_index = 0 if p.normal.dot(fwd) > 0.7 else 1
    box_uv(me, 1.0)
    ob = bpy.data.objects.new(name, me)
    (col or COL_SET).objects.link(ob)
    return ob


# =============================================================== prop templates
def template(key, path, mat=None, mats=None):
    """import once (FBX/glTF), bake world transforms (FBX 0.01 trap), join; mat = override every slot, mats = {slot
    name prefix: material} overrides (others kept)."""
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
    if mat is not None:
        base.data.materials.clear()
        base.data.materials.append(mat)
    elif mats:
        for i, sl in enumerate(base.data.materials):
            nm = sl.name if sl else ""
            for pre, mm in mats.items():
                if nm.startswith(pre):
                    base.data.materials[i] = mm
    base.name = "tpl_" + key
    link(base, COL_TPL)
    vs = [v.co for v in base.data.vertices]
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    TPL[key] = (base, lo, hi)
    log("template", key, "tris", sum(len(p.vertices) - 2 for p in base.data.polygons),
        "dims %.2f x %.2f x %.2f" % tuple(hi - lo), [m.name for m in base.data.materials if m])
    return base


def inst(key, name, loc_g, rot_z=0.0, scale=1.0, pivot="bottom", col=None):
    """linked copy of a template; pivot: 'bottom' (bbox bottom centre), 'origin', 'center', 'top'"""
    base, lo, hi = TPL[key]
    ob = bpy.data.objects.new(name, base.data)
    (col or COL_SET).objects.link(ob)
    if pivot == "bottom":
        off = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    elif pivot == "top":
        off = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, hi.z))
    elif pivot == "center":
        off = (lo + hi) / 2
    else:
        off = Vector((0, 0, 0))
    sc = scale if isinstance(scale, (tuple, list)) else (scale, scale, scale)
    M = (Matrix.Translation(G(*loc_g)) @ Matrix.Rotation(rot_z, 4, "Z") @ Matrix.Diagonal((sc[0], sc[1], sc[2], 1.0))
         @ Matrix.Translation(-off))
    ob.matrix_world = M
    return ob


def face_yaw(dir_g, local_front=Vector((0, -1, 0))):
    """Blender Z rotation that turns local_front (Blender) toward game direction dir_g"""
    b = G(*dir_g)
    return math.atan2(b.y, b.x) - math.atan2(local_front.y, local_front.x)


# =============================================================== 3D ring placement (CONTRACT 35.1 / 35.11 yaw)
def yaw_matrix(yaw_deg, pivot_g=(0.0, 0.0)):
    """game yaw about +Y (0 = +Z, +90 turns +Z toward +X = three.js rotation.y) about the vertical axis through
    game (x, z) = pivot_g. Game (x, y, z) -> Blender (x, -z, y): game yaw theta == Blender rotation +theta about +Z
    (Rz(90) maps Blender -Y = game +Z onto Blender +X = game +X)."""
    p = G(pivot_g[0], 0.0, pivot_g[1])
    return Matrix.Translation(p) @ Matrix.Rotation(math.radians(yaw_deg), 4, "Z") @ Matrix.Translation(-p)


def rot_objs(objs, yaw_deg, pivot_g=(0.0, 0.0)):
    """yaw objects about the ring centre through their world matrices (instances share mesh data, so data is never
    transformed here; join_all bakes the matrices at export)"""
    R = yaw_matrix(yaw_deg, pivot_g)
    for o in objs:
        o.matrix_world = R @ o.matrix_world
    return objs


class placed:
    """with K.placed(yaw_deg): build a set piece in the LOCAL frame (behind the ring at local -Z, its front facing +Z =
    toward the ring centre, exactly how the P2 stages were authored) -> every object created inside the block is yawed
    about the ring centre by yaw_deg. A piece meant to sit in direction a (dir(a) = (sin a, cos a)) uses yaw = a - 180."""

    def __init__(self, yaw_deg, pivot_g=(0.0, 0.0)):
        self.yaw = yaw_deg
        self.pivot = pivot_g
        self.objs = []

    def __enter__(self):
        self.before = set(o.name for o in COL_SET.objects)
        return self

    def __exit__(self, *exc):
        if exc[0] is not None:
            return False
        self.objs = [o for o in COL_SET.objects if o.name not in self.before]
        if abs(self.yaw) > 1e-9:
            rot_objs(self.objs, self.yaw, self.pivot)
        return False


def ydir(a_deg):
    """dir(a) in game (x, z): yaw convention of CONTRACT 35.1"""
    a = math.radians(a_deg)
    return (math.sin(a), math.cos(a))


def ring_points(r, n, a0_deg=0.0, closed=True):
    """n points on a horizontal circle (game x, z) starting at yaw a0; closed repeats the first point"""
    pts = []
    for k in range(n + (1 if closed else 0)):
        a = math.radians(a0_deg + 360.0 * (k % n) / n)
        pts.append((r * math.sin(a), r * math.cos(a)))
    return pts


def annulus(name, r0, r1, y, mat, n=96, a0_deg=0.0, a1_deg=360.0, u_len=1.5, v_range=(0.0, 1.0), col=None):
    """flat ring band (faces +Y) between radii r0 < r1 from yaw a0 to a1: u = arc length along r0.. / u_len (tileable
    texture along the ring), v across the band in v_range (inner edge = v_range[0])"""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    span = a1_deg - a0_deg
    segs = max(2, int(round(n * abs(span) / 360.0)))
    rm = 0.5 * (r0 + r1)
    inner, outer = [], []
    for k in range(segs + 1):
        a = math.radians(a0_deg + span * k / segs)
        inner.append(bm.verts.new(G(r0 * math.sin(a), y, r0 * math.cos(a))))
        outer.append(bm.verts.new(G(r1 * math.sin(a), y, r1 * math.cos(a))))
    for k in range(segs):
        f = bm.faces.new((inner[k], outer[k], outer[k + 1], inner[k + 1]))
        u0 = rm * math.radians(abs(span)) * k / segs / u_len
        u1 = rm * math.radians(abs(span)) * (k + 1) / segs / u_len
        for loop, uv in zip(f.loops, ((u0, v_range[0]), (u0, v_range[1]), (u1, v_range[1]), (u1, v_range[0]))):
            loop[uvl].uv = uv
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    return finish(bm, name, [mat], uv=False, smooth_angle=5, col=col)


def ring_wall(name, r, y0, y1, mat, n=96, a0_deg=0.0, a1_deg=360.0, u_len=1.5, v_range=(0.0, 1.0), inward=True, col=None):
    """vertical cylindrical band at radius r (y0..y1), facing the ring centre (inward) or away; u = arc / u_len"""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    span = a1_deg - a0_deg
    segs = max(2, int(round(n * abs(span) / 360.0)))
    lo, hi = [], []
    for k in range(segs + 1):
        a = math.radians(a0_deg + span * k / segs)
        lo.append(bm.verts.new(G(r * math.sin(a), y0, r * math.cos(a))))
        hi.append(bm.verts.new(G(r * math.sin(a), y1, r * math.cos(a))))
    for k in range(segs):
        f = bm.faces.new((lo[k], lo[k + 1], hi[k + 1], hi[k]))
        u0 = r * math.radians(abs(span)) * k / segs / u_len
        u1 = r * math.radians(abs(span)) * (k + 1) / segs / u_len
        for loop, uv in zip(f.loops, ((u0, v_range[0]), (u1, v_range[0]), (u1, v_range[1]), (u0, v_range[1]))):
            loop[uvl].uv = uv
    ob = finish(bm, name, [mat], uv=False, smooth_angle=30, col=col)
    me = ob.data
    p = me.polygons[len(me.polygons) // 2]
    c = p.center
    radial = Vector((c.x, c.y, 0.0)).normalized()
    if (p.normal.dot(radial) > 0) == inward:
        me.flip_normals()
    return ob


# =============================================================== crowd nodes (exported) + proof cards
def crowd_nodes():
    """crowd_<bay>_<row>_<i> empties from S.crowd.bays (CONTRACT 21.3): feet point, +Z facing, scale = card height"""
    crowd = S["crowd"]
    card_h = crowd["cardHeightM"]
    nodes = []
    for bay in crowd["bays"]:
        rng = mulberry32(bay["seed"])
        x0, x1 = bay.get("localX", bay["x"])
        jx, jz = bay["jitter"]
        face = math.radians(bay.get("faceYawDeg", 0.0))
        rot = bay.get("rotDeg", 0.0)                   # CONTRACT 35.11: bay yawed about the ring centre
        R = yaw_matrix(rot)
        yaw = face
        for ri, row in enumerate(bay["rows"]):
            n = int(math.floor((x1 - x0) / bay["spacing"] + 1e-6)) + 1
            stag = 0.5 * bay["spacing"] * (ri % 2)
            for i in range(n):
                x = x0 + i * bay["spacing"] + stag + (rng() * 2 - 1) * jx
                if x > x1 + 1e-6:
                    continue
                z = row["z"] + (rng() * 2 - 1) * jz
                r = rng()
                skip = bay.get("gapPct", 0.0)
                if skip and rng() < skip:
                    continue
                if abs(yaw) > 1e-3:
                    ang = "right" if yaw > 0 else "left"
                else:
                    ang = "front" if abs(x) < bay.get("frontHalfM", 3.0) else ("left" if x > 0 else "right")
                e = bpy.data.objects.new("crowd_%s_%d_%d" % (bay["id"], ri, i), None)
                e.empty_display_type = "SINGLE_ARROW"
                e.location = R @ G(x, row["y"], z)
                e.rotation_euler = (0.0, 0.0, yaw + math.radians(rot))
                e.scale = (card_h, card_h, card_h)
                e["bay"] = bay["id"]
                e["row"] = ri
                e["i"] = i
                e["rand"] = round(r, 5)
                e["angle"] = ang
                COL_NODES.objects.link(e)
                nodes.append((e, e.location.x, row["y"], -e.location.y, yaw + math.radians(rot), r, ang))
    log("crowd nodes", len(nodes))
    return nodes


def proof_cards(nodes):
    """the crowd as the view would draw it: unlit atlas cards (render-only, NOT exported)"""
    crowd = S["crowd"]
    meta = json.load(open(os.path.join(GLTF_OUT, crowd["meta"]), encoding="utf-8"))
    im = bpy.data.images.load(os.path.join(GLTF_OUT, crowd["atlas"]), check_existing=True)
    m = bpy.data.materials.new("proof_crowd")
    m.use_nodes = True
    nt = m.node_tree
    for nd in list(nt.nodes):
        nt.nodes.remove(nd)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tx = nt.nodes.new("ShaderNodeTexImage")
    tx.image = im
    tint = hex_lin(crowd["tint"])
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs["Factor"].default_value = 1.0
    b = crowd["brightness"]
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
    cells = {(c["body"], c["pose"], c["angle"]): c for c in meta["cells"]}
    bodies = list(meta["bodies"].keys())
    ay = meta["anchor"][1]
    cw, chh = meta["metresPerCellWidth"], meta["metresPerCellHeight"]
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
def env_map(src, out_name, exposure=1.0):
    im = bpy.data.images.load(src, check_existing=True)
    e2 = im.copy()
    e2.scale(512, 256)
    if abs(exposure - 1.0) > 1e-6:
        w, h = e2.size
        a = np.empty(w * h * 4, np.float32)
        e2.pixels.foreach_get(a)
        a = a.reshape(h, w, 4)
        a[..., :3] *= exposure
        e2.pixels.foreach_set(a.ravel())
    e2.filepath_raw = os.path.join(OUT3D, out_name)       # staged; stagefinish_b.py --swap moves it into art/gltf
    e2.file_format = "HDR"
    e2.save()
    log("env map", e2.filepath_raw, os.path.getsize(e2.filepath_raw))
    return im


# =============================================================== proof renders
def fighters(pairs):
    """render-only stand-ins at the round-start spawn (toon + outline like the game's cel look).
    pairs = [(body_key, fbx_file, x, face +1/-1, heightM), ...] (bodies + heights from tools/bodies.json; the game
    normalises every fighter to heightM, so the stand-ins are scaled to it)"""
    CA.PLAN["clips"]["stance"] = "Pro_Magic_Pack/standing idle.fbx"
    out = []
    for body, fbx, px, face, hm in pairs:
        CA.PLAN["bodies"][body] = {"file": fbx, "look": "stand-in", "hideMeshes": []}
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
        k = hm / max(1e-3, hi.z - lo.z)
        arm.scale = tuple(v * k for v in arm.scale)
        bpy.context.view_layer.update()
        hp = arm.matrix_world @ hb.head
        lo, hi = CA.mesh_min_max(meshes)
        arm.location = (arm.location.x + px - hp.x, arm.location.y - hp.y, arm.location.z - lo.z)
        bpy.context.view_layer.update()
        lo, hi = CA.mesh_min_max(meshes)
        log("fighter", body, "height %.2f" % (hi.z - lo.z), "x %.2f..%.2f" % (lo.x, hi.x))
        out += [arm] + meshes
    return out


def env_path():
    """the staged env HDR when this build wrote one, else the shipped one"""
    p = os.path.join(OUT3D, S["environment"]["hdr"])
    return p if os.path.exists(p) else os.path.join(GLTF_OUT, S["environment"]["hdr"])


def setup_lights_world(hdri):
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
    # world = env HDRI x intensity + hemisphere fill (three.js irradiance I*C == Blender radiance I*C/pi)
    w = bpy.data.worlds.new(SID + "_world")
    SCN.world = w
    w.use_nodes = True
    nt = w.node_tree
    for nd in list(nt.nodes):
        nt.nodes.remove(nd)
    out = nt.nodes.new("ShaderNodeOutputWorld")
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(env_path(), check_existing=True)
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


def make_camera(shot):
    cd = bpy.data.cameras.new("cam_" + shot["id"])
    cd.sensor_fit = "VERTICAL"
    cd.angle_y = math.radians(shot.get("fov", S["camera"]["vFovDeg"]))
    cd.clip_start = 0.1
    cd.clip_end = 120.0     # the game camera's far plane (view/camera.ts)
    co = bpy.data.objects.new("cam_" + shot["id"], cd)
    COL_PROOF.objects.link(co)
    co.location = G(*shot["pos"])
    d = G(*shot["look"]) - G(*shot["pos"])
    co.rotation_mode = "QUATERNION"
    co.rotation_quaternion = d.to_track_quat("-Z", "Y")
    return co


def _px(im):
    w, h = im.size
    a = np.empty(w * h * 4, dtype=np.float32)
    im.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def _set_px(im, arr):
    im.pixels.foreach_set(arr.astype(np.float32).ravel())
    im.update()


def depth_materials(on, saved):
    """swap every material for a view-depth emission (crowd cards and MASK/BLEND sets keep their alpha)"""
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
        alpha_d = {}

        def alpha_depth(src):
            """depth emission with the source material's alpha texture (cutout / blend kept)"""
            if src.name in alpha_d:
                return alpha_d[src.name]
            ta = None
            bs = next((nd for nd in src.node_tree.nodes if nd.type == "BSDF_PRINCIPLED"), None) if src.use_nodes else None
            if bs is not None and bs.inputs["Alpha"].links:
                ta = next((nd for nd in src.node_tree.nodes if nd.type == "TEX_IMAGE" and nd.outputs["Alpha"].links), None)
            if ta is None:
                alpha_d[src.name] = dm
                return dm
            m2 = bpy.data.materials.new("depth_" + src.name)
            m2.use_nodes = True
            n2 = m2.node_tree
            for nd in list(n2.nodes):
                n2.nodes.remove(nd)
            o2 = n2.nodes.new("ShaderNodeOutputMaterial")
            t2 = n2.nodes.new("ShaderNodeTexImage")
            t2.image = ta.image
            c2 = n2.nodes.new("ShaderNodeCameraData")
            r2 = n2.nodes.new("ShaderNodeMapRange")
            r2.inputs["From Min"].default_value = fog["near"]
            r2.inputs["From Max"].default_value = fog["far"]
            r2.clamp = True
            n2.links.new(c2.outputs["View Z Depth"], r2.inputs["Value"])
            e2 = n2.nodes.new("ShaderNodeEmission")
            n2.links.new(r2.outputs["Result"], e2.inputs["Color"])
            g2 = n2.nodes.new("ShaderNodeMath")
            g2.operation = "GREATER_THAN"
            g2.inputs[1].default_value = 0.5
            n2.links.new(t2.outputs["Alpha"], g2.inputs[0])
            tr = n2.nodes.new("ShaderNodeBsdfTransparent")
            mx = n2.nodes.new("ShaderNodeMixShader")
            n2.links.new(g2.outputs[0], mx.inputs["Fac"])
            n2.links.new(tr.outputs[0], mx.inputs[1])
            n2.links.new(e2.outputs[0], mx.inputs[2])
            n2.links.new(mx.outputs[0], o2.inputs["Surface"])
            try:
                m2.surface_render_method = "DITHERED"
            except AttributeError:
                pass
            alpha_d[src.name] = m2
            return m2
        crowd_d = bpy.data.materials["proof_crowd"].copy() if "proof_crowd" in bpy.data.materials else None
        if crowd_d:
            nt2 = crowd_d.node_tree
            emn = next(nd for nd in nt2.nodes if nd.type == "EMISSION")
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
                src = sl.material
                is_c = src is not None and src.get("is_crowd")
                sl.link = "OBJECT"
                if is_c and crowd_d:
                    sl.material = crowd_d
                elif src is not None and src.get("no_fog"):
                    sl.material = src         # e.g. BLEND rain: keeps its look in the depth pass (fog ~0 there)
                elif src is not None:
                    sl.material = alpha_depth(src)
                else:
                    sl.material = dm
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


ORBIT_DEGS = [0, 45, 90, 135, 180, 225, 270, 315]
ORBIT_DISTS = (("n", 4.4), ("f", 8.0))
LAST_NEAREST = None


def orbit_shots(height=1.35, look_y=1.0, centre=(0.0, 0.0), camera_side_deg=0.0):
    """CONTRACT 35.7 / 35.11.7 orbit camera around a pair at the ring centre: 8 angles every 45 deg from cameraSideDeg,
    position = centre + dir(a) * dist + up * height (dist 4.4 / 8.0), look-at the pair midpoint (centre, y 1.0) - ids
    orbit_<deg>_<n|f> (STAGES3D-A's naming, so the lab and merge_stages see one set). `pairYaw` = a: the stand-in pair
    turns with the camera (the game keeps camN perpendicular to the pair)."""
    out = []
    for a0 in ORBIT_DEGS:
        a = (a0 + camera_side_deg) % 360.0
        for tag, d in ORBIT_DISTS:
            dx, dz = ydir(a)
            pos = [round(centre[0] + dx * d, 4), height, round(centre[1] + dz * d, 4)]
            out.append({"id": "orbit_%03d_%s" % (int(round(a0)), tag), "pos": pos, "look": [centre[0], look_y, centre[1]],
                        "pairYaw": a, "orbitDeg": a0, "distM": d})
    return out


def proof_shot_list(camera_side_deg=0.0):
    """camera.proofShots for the fragment: the 16 orbit shots + near_center / far_center aliases of orbit_000_n/_f
    (merge_stages warns without near_center; the lab renders any id)"""
    orb = [{k: v for k, v in s.items() if k in ("id", "pos", "look")} for s in orbit_shots(camera_side_deg=camera_side_deg)]
    alias = []
    for s in orb:
        if s["id"] == "orbit_000_n":
            alias.append(dict(s, id="near_center"))
        if s["id"] == "orbit_000_f":
            alias.append(dict(s, id="far_center"))
    return alias + orb


_PAIR = {"pivot": None}


def _pair_yaw(deg):
    pv = _PAIR["pivot"]
    if pv is not None:
        pv.rotation_euler = (0.0, 0.0, math.radians(deg))
        bpy.context.view_layer.update()


def orbit_sheets(shots, tag):
    """2x2 labelled contact sheets of the orbit proofs (1920 x 1080 each, PIL in the system python: stagefinish_b.py
    --sheets) so every angle is READ at a useful size"""
    r = subprocess.run([system_python(), os.path.join(HERE, "stagefinish_b.py"), SID, "--sheets"], capture_output=True,
                       text=True, encoding="utf-8", errors="replace")
    log("orbit sheets rc=%d" % r.returncode, r.stdout[-1500:], r.stderr[-1500:])


def render_proofs(extra_shots, fighter_pairs, orbit=True):
    setup_lights_world(None)
    nodes = [(e, e.location.x, e.location.z, -e.location.y, e.rotation_euler.z, e["rand"], e["angle"])
             for e in COL_NODES.objects if e.name.startswith("crowd_")]
    proof_cards(nodes)
    if DO_FIGHTERS and fighter_pairs:
        objs = fighters(fighter_pairs)
        pv = bpy.data.objects.new("pair_pivot", None)
        COL_PROOF.objects.link(pv)
        for o in objs:
            if o.type == "ARMATURE" and o.parent is None:
                mw = o.matrix_world.copy()
                o.parent = pv
                o.matrix_world = mw
        _PAIR["pivot"] = pv
    for ob in COL_NODES.objects:
        ob.hide_render = True
    shots = [] if ORBIT_ONLY else list(extra_shots)
    if orbit and not NO_ORBIT:
        shots = orbit_shots() + shots
    if SHOTS:
        want = str(SHOTS).split(",")
        shots = [s for s in shots if s["id"] in want]
    beauty = []
    for sh in shots:
        aspect = sh.get("aspect", RES[0] / RES[1])
        SCN.render.resolution_x = int(round(RES[1] * aspect))
        SCN.render.resolution_y = RES[1]
        cam = make_camera(sh)
        SCN.camera = cam
        _pair_yaw(sh.get("pairYaw", 0.0))
        render_setup(False)
        p = os.path.join(CACHE, "%s_beauty_%s.png" % (SID, sh["id"]))
        SCN.render.filepath = p
        bpy.ops.render.render(write_still=True)
        beauty.append((sh, cam, p))
        log("rendered", sh["id"], SCN.render.resolution_x, "x", SCN.render.resolution_y)
    saved = {}
    hidden = [o for o in SCN.objects if o.get("depth_hide") and not o.hide_render]
    for o in hidden:
        o.hide_render = True      # transparent dressing (rain): the fog pass reads what is behind it
    depth_materials(True, saved)
    for sh, cam, p in beauty:
        aspect = sh.get("aspect", RES[0] / RES[1])
        SCN.render.resolution_x = int(round(RES[1] * aspect))
        SCN.render.resolution_y = RES[1]
        SCN.camera = cam
        _pair_yaw(sh.get("pairYaw", 0.0))
        render_setup(True)
        dp = os.path.join(CACHE, "%s_depth_%s.png" % (SID, sh["id"]))
        SCN.render.filepath = dp
        bpy.ops.render.render(write_still=True)
        outp = os.path.join(REP, "%s_%s.png" % (SID, sh["id"]))
        fog_composite(p, dp, outp)
        log("proof", outp)
    depth_materials(False, saved)
    for o in hidden:
        o.hide_render = False
    _pair_yaw(0.0)
    orbit_sheets([sh for sh, _, _ in beauty], SID)


# =============================================================== camera clearance (CONTRACT 35.11 clearRadiusM)
def _tri_dist2d(P):
    """P: (n, 3, 2) triangles in the plane -> distance from the origin to each triangle (0 when it contains it)"""
    A, B, C = P[:, 0], P[:, 1], P[:, 2]

    def seg(a, b):
        ab = b - a
        t = np.clip(-(a * ab).sum(1) / np.maximum((ab * ab).sum(1), 1e-12), 0.0, 1.0)
        q = a + ab * t[:, None]
        return np.sqrt((q * q).sum(1))
    d = np.minimum(np.minimum(seg(A, B), seg(B, C)), seg(C, A))

    def cr(u, v):
        return u[:, 0] * v[:, 1] - u[:, 1] * v[:, 0]
    s1, s2, s3 = cr(B - A, -A), cr(C - B, -B), cr(A - C, -C)
    inside = ((s1 >= 0) & (s2 >= 0) & (s3 >= 0)) | ((s1 <= 0) & (s2 <= 0) & (s3 <= 0))
    inside &= np.abs(cr(B - A, C - A)) > 1e-6        # vertical faces project to zero-area triangles: never "inside"
    d[inside] = 0.0
    return d


def clearance_record(clear_r, offenders, low_top, r_clear, y0, y1, nearest):
    """the fragment's build.clearance (CONTRACT 35.11.5, the shape tools/merge_stages.py validates)"""
    return {"ok": not offenders and clear_r >= r_clear, "minRadiusM": round(clear_r, 3), "bandY": [y0, y1],
            "requiredM": r_clear, "nearest": nearest, "tallestInsideM": round(low_top, 3),
            "method": "stagekit_b.clearance: every set triangle whose height range touches bandY, horizontal distance "
                      "from the ring centre (conservative: full triangle height range), rain cards excluded"}


def clearance(r_clear=9.5, y0=1.15, y1=4.5, skip=("rain_",), centre=(0.0, 0.0), report=12):
    """measured camera clearance: the smallest horizontal distance from the ring centre to any set triangle whose
    height range touches [y0, y1] (conservative: a triangle counts with its full height range). Returns
    (clearRadius, offenders inside r_clear [(dist, object, ymin, ymax)], ring-top height of everything inside r_clear).
    The band 1.15..4.5 m contains STAGES3D-A's 1.30..3.00 m (CONTRACT 35.11.5), so a pass here passes theirs."""
    dg = bpy.context.evaluated_depsgraph_get()
    best = []
    low_top = 0.0
    cx, cz = centre
    for ob in COL_SET.objects:
        if ob.type != "MESH" or ob.name.startswith(skip) or ob.hide_render:
            continue
        me = ob.data
        if not len(me.polygons):
            continue
        me.calc_loop_triangles()
        mw = np.array(ob.matrix_world)
        co = np.empty(len(me.vertices) * 3, np.float32)
        me.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        co = co @ mw[:3, :3].T + mw[:3, 3]
        tri = np.empty(len(me.loop_triangles) * 3, np.int32)
        me.loop_triangles.foreach_get("vertices", tri)
        P = co[tri.reshape(-1, 3)]                          # Blender: x, y (= -game z), z (= game y)
        ymin, ymax = P[:, :, 2].min(1), P[:, :, 2].max(1)
        P2 = np.stack([P[:, :, 0] - cx, P[:, :, 1] + cz], -1)
        d = _tri_dist2d(P2)
        inner = d < r_clear
        if inner.any():
            low_top = max(low_top, float(ymax[inner & (ymax < y0)].max()) if (inner & (ymax < y0)).any() else 0.0)
        band = (ymax >= y0) & (ymin <= y1)
        if band.any():
            k = int(np.argmin(np.where(band, d, 1e9)))
            best.append((float(d[k]), ob.name, float(ymin[k]), float(ymax[k])))
    best.sort()
    clear_r = best[0][0] if best else 99.0
    offenders = [b for b in best if b[0] < r_clear]
    global LAST_NEAREST
    LAST_NEAREST = ("%s at %.3f m (y %.2f..%.2f)" % (best[0][1], best[0][0], best[0][2], best[0][3])) if best else None
    log("CLEARANCE band y %.2f..%.2f: clear radius %.3f m (need >= %.1f); tallest low item inside %.1f m: %.3f m" % (
        y0, y1, clear_r, r_clear, r_clear, low_top))
    for b in best[:report]:
        log("  nearest in band: %.3f m  %s  (y %.2f..%.2f)%s" % (b[0], b[1], b[2], b[3], "  <-- INSIDE" if b[0] < r_clear else ""))
    return clear_r, offenders, low_top


# =============================================================== EXPORT
def join_all(objs, name):
    objs = [o for o in objs if o.type == "MESH"]
    for o in objs:
        if o.data.users > 1:
            o.data = o.data.copy()
        while len(o.data.uv_layers) > 1:        # one UV set only (imported kit meshes carry a second one)
            o.data.uv_layers.remove(o.data.uv_layers[-1])
        if o.data.uv_layers:
            o.data.uv_layers[0].name = "UVMap"
        for a in list(o.data.color_attributes):   # no vertex colours in the file (FBX kits carry them)
            o.data.color_attributes.remove(a)
    with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs, object=objs[0]):
        bpy.ops.object.join()
    objs[0].name = name
    objs[0].data.name = name
    return objs[0]


def set_pivot(ob, pivot_g):
    p = G(*pivot_g)
    mw = ob.matrix_world.copy()
    ob.data.transform(mw)
    ob.data.transform(Matrix.Translation(-p))
    ob.matrix_world = Matrix.Translation(p)


def raw_path():
    return os.path.join(CACHE, SID + "_raw.glb")


def export(dress):
    """dress = [(node_name, [objs], pivot_g | None)] separate named nodes (view hooks / animated dressing);
    everything else in SET joins into one mesh `<id>_set` (one primitive per material)."""
    log("join + export")
    taken = set()
    for (_, objs, _) in dress:
        for o in objs:
            taken.add(o.name)
    set_objs = [o for o in COL_SET.objects if o.type == "MESH" and o.name not in taken]
    set_ob = join_all(set_objs, SID + "_set")
    extra = []
    for (name, objs, pivot) in dress:
        objs = [o for o in objs if o.name in bpy.data.objects]
        if not objs:
            continue
        ob = join_all(objs, name)
        if pivot is not None:
            set_pivot(ob, pivot)
        extra.append(ob)
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    sel = [set_ob] + extra + [o for o in COL_NODES.objects]
    for o in sel:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = set_ob
    kw = dict(filepath=raw_path(), export_format="GLB", use_selection=True, export_apply=True, export_extras=True,
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
    log("exported", raw_path(), os.path.getsize(raw_path()), "bytes; set tris", tris, "materials",
        len(set_ob.data.materials), "dress", [(o.name, sum(len(p.vertices) - 2 for p in o.data.polygons)) for o in extra])
    return set_ob


def write_fragment():
    """<id>.stage.json = the StageDef (CONTRACT 21.2 + 35.11) this script authors, STAGED in OUT3D (moved to
    art/stages/ together with the GLB by stagefinish_b.py --swap, so data/stages.json never pairs a new ring with the old
    GLB); `build` is filled by stagefinish_b.py from the finished GLB."""
    p = os.path.join(OUT3D, SID + ".stage.json")
    d = json.loads(json.dumps(S))
    if os.path.exists(p):
        try:
            old = json.load(open(p, encoding="utf-8"))
            if "build" in old and "build" not in d:
                d["build"] = old["build"]
        except Exception:
            pass
    with open(p, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(d, indent=2) + "\n")
    log("fragment", p)
    return p


def run_finish():
    import stagefinish_b as F
    F.finish(SID, merge=False, staged=True)


# =============================================================== contact render (ENV_KIT section 8.3)
def contact_render(objs, out_name, hdri, span=12.0, cam_pos=None, look=None, res=(1920, 900), fov=40.0):
    """hero props next to qfp_Chandelier + jp_JP_Conditioner_01 under the stage HDRI on a neutral floor.
    objs are already placed by the caller along +X; the references are added at x < 0."""
    tplc = template("ref_chandelier", QFP + "Chandelier.gltf")
    jc = JPT + "Environment/JP_Conditioner/JP_Conditioner_"
    ra = bpy.data.images.load(jc + "A.tga", check_existing=True)
    rn = bpy.data.images.load(jc + "N.tga", check_existing=True)
    rn.colorspace_settings.name = "Non-Color"
    tpla = template("ref_conditioner", JPM + "Environment/JP_Conditioner_01.fbx", mat=mat_pbr("ref_ac", ra, rn, None, roughness=0.55))
    refs = [inst("ref_chandelier", "REF_chandelier", (-2.2, 0.9, 1.5), 0.3, 1.0, col=COL_PROOF),
            inst("ref_conditioner", "REF_conditioner", (-0.6, 0.0, 1.5), -0.9, 1.0, col=COL_PROOF)]
    chain("REF_chain", (-2.2, 3.4, 1.5), (-2.2, 0.9 + 1.46, 1.5), mat_pbr("ref_iron", color=(0.03, 0.03, 0.035, 1),
                                                                          roughness=0.5, metallic=0.9), col=COL_PROOF)
    fl = gbox("contact_floor", -6, span + 4, -0.05, 0.0, -6, 6, mat_pbr("contact_grey", color=(0.18, 0.18, 0.19, 1),
                                                                        roughness=0.7), col=COL_PROOF)
    w = bpy.data.worlds.new("contact_world")
    SCN.world = w
    w.use_nodes = True
    nt = w.node_tree
    bg = next(nd for nd in nt.nodes if nd.type == "BACKGROUND")
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(hdri, check_existing=True)
    nt.links.new(env.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 1.0
    sun = bpy.data.lights.new("contact_sun", "SUN")
    sun.energy = 2.5
    so = bpy.data.objects.new("contact_sun", sun)
    COL_PROOF.objects.link(so)
    so.rotation_euler = (math.radians(50), 0, math.radians(-35))
    for o in COL_NODES.objects:
        o.hide_render = True
    sh = {"id": "contact", "pos": cam_pos or [span * 0.35, 2.6, 8.5], "look": look or [span * 0.35, 1.0, 0.0], "fov": fov}
    SCN.render.resolution_x, SCN.render.resolution_y = res
    cam = make_camera(sh)
    SCN.camera = cam
    render_setup(False)
    SCN.view_settings.exposure = 0.0
    p = os.path.join(REP, out_name)
    SCN.render.filepath = p
    bpy.ops.render.render(write_still=True)
    log("contact", p)
    return p


def tri_report(prefixes):
    """triangles per hero prop (object-name prefixes) before the join - ENV_KIT 8.4 budget evidence"""
    out = {}
    for pre in prefixes:
        t = 0
        for o in COL_SET.objects:
            if o.type == "MESH" and o.name.startswith(pre):
                t += sum(len(p.vertices) - 2 for p in o.data.polygons)
        out[pre] = t
    log("hero tris", json.dumps(out))
    return out


def tri_count(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    t = 0
    for o in objs:
        if o.type == "MESH":
            t += sum(len(p.vertices) - 2 for p in o.data.polygons)
    return t
