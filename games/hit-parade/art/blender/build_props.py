"""HIT PARADE - hand props, modelled procedurally in Blender headless (lane ASSETS, CONTRACT 6.4 / 17.1).

  blender.exe --background --python art/blender/build_props.py -- <job.json>
  job = {"out_dir": ".../art/renders/props/_build", "tex_dir": ".../_build/tex" (tools/prop_decals.py output),
         "props": ["brick", ...] (default: all), "fast": false}

Quality bar (ENV_KIT section 8 + the phase-2 brief): no raw box/cylinder faces - every hard edge is bevelled
(Bevel modifier or a rounded lathe profile) with secondary detail (rivets, collars, fins, seams, straps); PBR maps
baked with Cycles from procedural node materials: albedo (sRGB), ORM (R ambient occlusion, G roughness, B metallic),
tangent-space normal (bump + Bevel-node edge rounding), emissive mask where a part glows; real UVs (Smart UV
Project + pack) at 512-1024 px; 1k-8k triangles per hero prop.

PROP FRAME (glTF, what the GLB carries; Blender authoring axes in brackets - the exporter maps Blender Z-up to glTF
Y-up, glTF +Z = Blender -Y):
  origin = the grip point (centre of the fist loop / pinch / hang point) unless noted;
  +Y [Blender +Z] = the business end (blade, head, spout, top of the gun, up);
  +Z [Blender -Y] = the edge / strike face / barrel / shield front / card face.
Every prop is ONE mesh node named <id> with ONE material <id>_mat; node extras {"prop": {...}} (the attach block
is added by tools/prop_post.mjs from the grip solve, CONTRACT 17.1). Writes <out_dir>/<id>.raw.glb, <id>_*.png and
<out_dir>/props_build.json (tris, dims, textures, secs). Deterministic (seeded). ASCII only.
"""
import json
import math
import os
import random
import sys
import time
import traceback

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

TAU = math.tau
RAD = math.radians


def log(*a):
    print("[props]", *a, flush=True)


# ====================================================================== scene / mesh helpers
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for c in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.curves, bpy.data.node_groups):
        for x in list(c):
            c.remove(x)


def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def ob_from_bm(bm, name):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    return link(bpy.data.objects.new(name, me))


def select_only(obs, active=None):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or obs[0]


def apply_mods(ob):
    select_only([ob])
    for md in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=md.name)


def bevel(ob, width, segs=2, angle=35.0, profile=0.5, harden=False):
    md = ob.modifiers.new("bev", "BEVEL")
    md.width = width
    md.segments = segs
    md.limit_method = "ANGLE"
    md.angle_limit = RAD(angle)
    md.profile = profile
    md.use_clamp_overlap = True
    md.harden_normals = harden
    apply_mods(ob)


def smooth(ob, angle=40.0):
    select_only([ob])
    bpy.ops.object.shade_smooth_by_angle(angle=RAD(angle), keep_sharp_edges=True)


def weighted_normals(ob):
    md = ob.modifiers.new("wn", "WEIGHTED_NORMAL")
    md.keep_sharp = True
    md.weight = 50
    apply_mods(ob)


def transform(ob, M):
    ob.data.transform(M)
    ob.data.update()


def lathe_bm(bm, profile, segs, phase=0.0, max_seg=0.11):
    """revolve (r, z) points (first and last with r == 0) around Blender Z; returns the new faces.
    UV seams: one meridian + a ring every ~max_seg metres of profile length (long thin islands pack badly)."""
    rings = []
    for r, z in profile:
        if r < 1e-7:
            rings.append([bm.verts.new((0.0, 0.0, z))])
        else:
            rings.append([bm.verts.new((r * math.cos(TAU * i / segs + phase), r * math.sin(TAU * i / segs + phase), z))
                          for i in range(segs)])
    faces = []
    for a, b in zip(rings, rings[1:]):
        if len(a) == 1 and len(b) == 1:
            continue
        for i in range(segs):
            j = (i + 1) % segs
            if len(a) == 1:
                faces.append(bm.faces.new((a[0], b[j], b[i])))
            elif len(b) == 1:
                faces.append(bm.faces.new((a[i], a[j], b[0])))
            else:
                faces.append(bm.faces.new((a[i], a[j], b[j], b[i])))
    acc = 0.0
    for k in range(1, len(rings)):
        (r0, z0), (r1, z1) = profile[k - 1], profile[k]
        acc += math.hypot(r1 - r0, z1 - z0)
        ring = rings[k]
        if len(ring) > 1 and acc >= max_seg and k < len(rings) - 1:
            acc = 0.0
            for i in range(segs):
                e = bm.edges.get((ring[i], ring[(i + 1) % segs]))
                if e:
                    e.seam = True
    for a, b in zip(rings, rings[1:]):
        e = bm.edges.get((a[0], b[0]))
        if e:
            e.seam = True
    return faces


def lathe(name, profile, segs, phase=0.0, max_seg=0.11):
    bm = bmesh.new()
    lathe_bm(bm, profile, segs, phase, max_seg)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = ob_from_bm(bm, name)
    uv_part(ob)
    return ob


def box(name, size, center=(0, 0, 0), rot=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    ob = ob_from_bm(bm, name)
    M = Matrix.Translation(center)
    if rot is not None:
        M = M @ rot
    transform(ob, M)
    return ob


def cyl(name, r, depth, segs, M=None, r2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r, radius2=r if r2 is None else r2,
                          depth=depth)
    ob = ob_from_bm(bm, name)
    if M is not None:
        transform(ob, M)
    return ob


def torus(name, R, r, segs_major, segs_minor, M=None, arc=TAU):
    bm = bmesh.new()
    closed = abs(arc - TAU) < 1e-6
    nmaj = segs_major if closed else segs_major + 1
    rings = []
    for i in range(nmaj):
        a = arc * i / segs_major
        c = Vector((R * math.cos(a), R * math.sin(a), 0.0))
        rad = Vector((math.cos(a), math.sin(a), 0.0))
        rings.append([bm.verts.new(c + rad * (r * math.cos(TAU * k / segs_minor)) + Vector((0, 0, r * math.sin(TAU * k / segs_minor))))
                      for k in range(segs_minor)])
    for i in range(segs_major if closed else segs_major):
        a, b = rings[i], rings[(i + 1) % nmaj]
        for k in range(segs_minor):
            kk = (k + 1) % segs_minor
            bm.faces.new((a[k], b[k], b[kk], a[kk]))
    if not closed:
        for ring in (rings[0], rings[-1]):
            bm.faces.new(ring)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = ob_from_bm(bm, name)
    if M is not None:
        transform(ob, M)
    return ob


def join(obs, name):
    for o in obs:
        uv_part(o)
    select_only(obs, obs[0])
    if len(obs) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def set_mat(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def dims(ob):
    co = np.zeros(len(ob.data.vertices) * 3)
    ob.data.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    lo, hi = co.min(0), co.max(0)
    # report in glTF axes: x = X, y = Blender Z, z = -Blender Y
    return {"min_gltf": [round(float(lo[0]), 4), round(float(lo[2]), 4), round(float(-hi[1]), 4)],
            "max_gltf": [round(float(hi[0]), 4), round(float(hi[2]), 4), round(float(-lo[1]), 4)]}


def uv_part(ob, angle=66.0, margin=0.01):
    """UVs for ONE part: seam-based conformal unwrap when the part has seams (lathes), else Smart UV Project."""
    me = ob.data
    if len(me.uv_layers):
        return
    seams = any(e.use_seam for e in me.edges)
    me.uv_layers.new(name="UVMap")
    select_only([ob])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    if seams:
        bpy.ops.uv.unwrap(method="CONFORMAL", margin=margin)
    else:
        bpy.ops.uv.smart_project(angle_limit=RAD(angle), island_margin=margin, area_weight=0.0, correct_aspect=True,
                                 scale_to_bounds=False)
    bpy.ops.object.mode_set(mode="OBJECT")


def unwrap(ob, margin=0.006):
    """final layout: every part's islands at one texel density, packed into [0,1]"""
    uv_part(ob)
    me = ob.data
    while len(me.uv_layers) > 1:
        me.uv_layers.remove(me.uv_layers[1])
    me.uv_layers[0].name = "UVMap"
    select_only([ob])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.context.scene.tool_settings.use_uv_select_sync = True
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=True, margin=margin, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")
    uv = np.zeros(len(me.loops) * 2, np.float32)
    me.uv_layers[0].data.foreach_get("uv", uv)
    return {"uv_min": round(float(uv.min()), 4), "uv_max": round(float(uv.max()), 4)}


# ====================================================================== node helpers
class NT:
    """thin wrapper: every helper accepts a socket or a constant for any input"""

    def __init__(self, mat):
        self.nt = mat.node_tree
        self.n = self.nt.nodes
        self.l = self.nt.links
        self._co = None
        self._geo = None

    def new(self, t, **kw):
        n = self.n.new(t)
        for k, v in kw.items():
            setattr(n, k, v)
        return n

    def feed(self, sock, v):
        if isinstance(v, bpy.types.NodeSocket):
            self.l.new(v, sock)
        elif v is not None:
            try:
                sock.default_value = v
            except (TypeError, ValueError):
                sock.default_value = tuple(v) + (1.0,)

    def co(self):
        if self._co is None:
            self._co = self.new("ShaderNodeTexCoord").outputs["Object"]
        return self._co

    def geo(self, out="Normal"):
        if self._geo is None:
            self._geo = self.new("ShaderNodeNewGeometry")
        return self._geo.outputs[out]

    def xyz(self, v=None):
        n = self.new("ShaderNodeSeparateXYZ")
        self.feed(n.inputs[0], v if v is not None else self.co())
        return n.outputs["X"], n.outputs["Y"], n.outputs["Z"]

    def vec(self, x, y, z):
        n = self.new("ShaderNodeCombineXYZ")
        self.feed(n.inputs[0], x)
        self.feed(n.inputs[1], y)
        self.feed(n.inputs[2], z)
        return n.outputs[0]

    def scale(self, v, s):
        n = self.new("ShaderNodeMapping")
        self.feed(n.inputs["Vector"], v if v is not None else self.co())
        n.inputs["Scale"].default_value = s
        return n.outputs[0]

    def math(self, op, a, b=0.0, c=0.0, clamp=False):
        n = self.new("ShaderNodeMath", operation=op, use_clamp=clamp)
        self.feed(n.inputs[0], a)
        self.feed(n.inputs[1], b)
        self.feed(n.inputs[2], c)
        return n.outputs[0]

    def vmath(self, op, a, b=None, out=0):
        n = self.new("ShaderNodeVectorMath", operation=op)
        self.feed(n.inputs[0], a)
        if b is not None:
            self.feed(n.inputs[1], b)
        return n.outputs[out]

    def mr(self, v, a, b, c=0.0, d=1.0, interp="LINEAR"):
        n = self.new("ShaderNodeMapRange", clamp=True, interpolation_type=interp)
        self.feed(n.inputs[0], v)
        n.inputs[1].default_value = a
        n.inputs[2].default_value = b
        self.feed(n.inputs[3], c)
        self.feed(n.inputs[4], d)
        return n.outputs[0]

    def noise(self, v=None, scale=10.0, detail=4.0, rough=0.5, dist=0.0, out="Factor"):
        n = self.new("ShaderNodeTexNoise")
        n.noise_dimensions = "3D"
        self.feed(n.inputs["Vector"], v if v is not None else self.co())
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        n.inputs["Distortion"].default_value = dist
        return n.outputs[out]

    def voronoi(self, v=None, scale=10.0, feature="F1", out="Distance", rnd=1.0):
        n = self.new("ShaderNodeTexVoronoi")
        n.voronoi_dimensions = "3D"
        n.feature = feature
        self.feed(n.inputs["Vector"], v if v is not None else self.co())
        n.inputs["Scale"].default_value = scale
        n.inputs["Randomness"].default_value = rnd
        return n.outputs[out]

    def wave(self, v=None, scale=5.0, dist=0.0, detail=2.0, direction="Z", kind="BANDS", out="Factor", profile="SIN"):
        n = self.new("ShaderNodeTexWave")
        n.wave_type = kind
        if kind == "BANDS":
            n.bands_direction = direction
        else:
            n.rings_direction = direction
        n.wave_profile = profile
        self.feed(n.inputs["Vector"], v if v is not None else self.co())
        n.inputs["Scale"].default_value = scale
        n.inputs["Distortion"].default_value = dist
        n.inputs["Detail"].default_value = detail
        return n.outputs[out]

    def ramp(self, fac, stops):
        n = self.new("ShaderNodeValToRGB")
        self.feed(n.inputs[0], fac)
        el = n.color_ramp.elements
        while len(el) < len(stops):
            el.new(0.5)
        for e, (p, c) in zip(el, stops):
            e.position = p
            e.color = tuple(c) + ((1.0,) if len(c) == 3 else ())
        return n.outputs["Color"]

    def mixc(self, fac, a, b, blend="MIX"):
        n = self.new("ShaderNodeMix", data_type="RGBA", blend_type=blend, clamp_factor=True)
        self.feed(n.inputs[0], fac)
        self.feed(n.inputs[6], a)
        self.feed(n.inputs[7], b)
        return n.outputs[2]

    def mixf(self, fac, a, b):
        n = self.new("ShaderNodeMix", data_type="FLOAT", clamp_factor=True)
        self.feed(n.inputs[0], fac)
        self.feed(n.inputs[2], a)
        self.feed(n.inputs[3], b)
        return n.outputs[0]

    def bevel_n(self, radius, samples=8):
        n = self.new("ShaderNodeBevel", samples=samples)
        n.inputs["Radius"].default_value = radius
        return n.outputs[0]

    def bump(self, height, strength=0.5, distance=0.001, normal=None):
        n = self.new("ShaderNodeBump")
        self.feed(n.inputs["Height"], height)
        n.inputs["Strength"].default_value = strength
        n.inputs["Distance"].default_value = distance
        if normal is not None:
            self.feed(n.inputs["Normal"], normal)
        return n.outputs[0]

    def edge(self, radius, gain=6.0):
        """0..1 mask on convex/concave edges: 1 - dot(bevel normal, true normal), scaled"""
        d = self.vmath("DOT_PRODUCT", self.bevel_n(radius, 8), self.geo("Normal"), out=1)
        return self.math("MULTIPLY", self.math("SUBTRACT", 1.0, d), gain, clamp=True)

    def ao(self, distance=0.03, samples=16):
        n = self.new("ShaderNodeAmbientOcclusion", samples=samples, only_local=True)
        n.inputs["Distance"].default_value = distance
        return n.outputs["AO"]

    def attr(self, name, out="Factor"):
        n = self.new("ShaderNodeAttribute", attribute_name=name)
        return n.outputs[out]

    def image(self, path, vec, ext="CLIP", noncolor=False, out="Color"):
        img = bpy.data.images.load(path, check_existing=True)
        if noncolor:
            img.colorspace_settings.name = "Non-Color"
        n = self.new("ShaderNodeTexImage", image=img, extension=ext, interpolation="Cubic")
        self.feed(n.inputs["Vector"], vec)
        return n.outputs[out]

    def atan2(self, y, x):
        return self.math("ARCTAN2", y, x)

    def between(self, v, a, b, soft=0.0008):
        """1 inside [a, b] with soft edges"""
        return self.math("MULTIPLY", self.mr(v, a - soft, a + soft), self.mr(v, b + soft, b - soft))


SPECS = {}     # material name -> {"color", "rough", "metal", "normal", "ao", "emit"}


def material(name, build):
    """build(t: NT) -> spec dict; also wires a Principled BSDF (for the normal bake / previews)"""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    t = NT(m)
    for n in list(t.n):
        t.n.remove(n)
    out = t.new("ShaderNodeOutputMaterial")
    bs = t.new("ShaderNodeBsdfPrincipled")
    spec = build(t)
    spec.setdefault("metal", 0.0)
    spec.setdefault("rough", 0.6)
    spec.setdefault("normal", None)
    spec.setdefault("ao", None)
    spec.setdefault("emit", None)
    t.feed(bs.inputs["Base Color"], spec["color"])
    t.feed(bs.inputs["Roughness"], spec["rough"])
    t.feed(bs.inputs["Metallic"], spec["metal"])
    if spec["normal"] is not None:
        t.feed(bs.inputs["Normal"], spec["normal"])
    t.l.new(bs.outputs["BSDF"], out.inputs["Surface"])
    spec["_out"], spec["_bsdf"], spec["_t"] = out, bs, t
    SPECS[m.name] = spec
    return m


# ====================================================================== baking
def bake(ob, pid, size, out_dir, fast=False):
    scn = bpy.context.scene
    scn.render.engine = "CYCLES"
    scn.cycles.device = "CPU"
    try:
        scn.cycles.use_denoising = False
    except Exception:  # noqa
        pass
    mats = [m for m in ob.data.materials if m is not None]
    emit_any = any(SPECS[m.name]["emit"] is not None for m in mats)
    keys = ["col", "rough", "metal", "ao", "nrm"] + (["emit"] if emit_any else [])
    imgs = {}
    for k in keys:
        imgs[k] = bpy.data.images.new("%s_%s" % (pid, k), size, size, alpha=False, float_buffer=(k == "nrm"))
        if k != "col" and k != "emit":
            imgs[k].colorspace_settings.name = "Non-Color"
    rig = {}
    for m in mats:
        s = SPECS[m.name]
        t = s["_t"]
        emi = t.new("ShaderNodeEmission")
        tgt = t.new("ShaderNodeTexImage")
        for n in t.n:
            n.select = False
        tgt.select = True
        t.n.active = tgt
        rig[m.name] = (emi, tgt)

    def route(key):
        for m in mats:
            s = SPECS[m.name]
            t = s["_t"]
            emi, tgt = rig[m.name]
            tgt.image = imgs[key]
            for l in list(emi.inputs["Color"].links):
                t.l.remove(l)
            for l in list(s["_out"].inputs["Surface"].links):
                t.l.remove(l)
            if key == "nrm":
                t.l.new(s["_bsdf"].outputs["BSDF"], s["_out"].inputs["Surface"])
                continue
            src = {"col": s["color"], "rough": s["rough"], "metal": s["metal"],
                   "ao": s["ao"] if s["ao"] is not None else t.ao(0.03, 16), "emit": s["emit"] if s["emit"] is not None else 0.0}[key]
            if isinstance(src, bpy.types.NodeSocket):
                t.l.new(src, emi.inputs["Color"])
            else:
                v = src if isinstance(src, (tuple, list)) else (src, src, src)
                emi.inputs["Color"].default_value = tuple(v)[:3] + (1.0,)
            t.l.new(emi.outputs["Emission"], s["_out"].inputs["Surface"])

    select_only([ob])
    t0 = time.time()
    for key in keys:
        route(key)
        scn.cycles.samples = {"col": 4, "rough": 4, "metal": 2, "ao": 24, "nrm": 8, "emit": 2}[key] if fast else \
            {"col": 16, "rough": 8, "metal": 4, "ao": 64, "nrm": 32, "emit": 4}[key]
        kw = dict(margin=8, margin_type="EXTEND", use_clear=True, target="IMAGE_TEXTURES", uv_layer="UVMap")
        if key == "nrm":
            bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT", **kw)
        else:
            bpy.ops.object.bake(type="EMIT", **kw)
    px = {k: np.array(imgs[k].pixels[:], dtype=np.float32).reshape(size, size, 4) for k in keys}
    orm = np.ones((size, size, 4), np.float32)
    orm[..., 0] = px["ao"][..., 0]
    orm[..., 1] = px["rough"][..., 0]
    orm[..., 2] = px["metal"][..., 0]
    paths = {}

    def save(key, arr, noncolor):
        im = bpy.data.images.new("%s_%s_out" % (pid, key), size, size, alpha=False, float_buffer=False)
        if noncolor:
            im.colorspace_settings.name = "Non-Color"
        im.pixels.foreach_set(arr.ravel())
        p = os.path.join(out_dir, "%s_%s.png" % (pid, key)).replace("\\", "/")
        im.filepath_raw = p
        im.file_format = "PNG"
        im.save()
        paths[key] = p
        return im

    out = {"col": save("albedo", px["col"], False), "orm": save("orm", orm, True),
           "nrm": save("normal", px["nrm"], True)}
    if emit_any:
        out["emit"] = save("emissive", px["emit"], False)
    stats = {"size": size, "bake_secs": round(time.time() - t0, 1),
             "ao_mean": round(float(px["ao"][..., 0].mean()), 3), "rough_mean": round(float(px["rough"][..., 0].mean()), 3),
             "metal_mean": round(float(px["metal"][..., 0].mean()), 3),
             "albedo_mean": [round(float(px["col"][..., i].mean()), 3) for i in range(3)]}
    return out, paths, stats


def gltf_output_group():
    ng = bpy.data.node_groups.get("glTF Material Output")
    if ng is None:
        ng = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        ng.interface.new_socket(name="Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
        ng.nodes.new("NodeGroupInput")
    return ng


def final_material(pid, imgs, emit_color=(1.0, 1.0, 1.0), emit_strength=1.0):
    m = bpy.data.materials.new(pid + "_mat")
    m.use_nodes = True
    t = NT(m)
    for n in list(t.n):
        t.n.remove(n)
    out = t.new("ShaderNodeOutputMaterial")
    bs = t.new("ShaderNodeBsdfPrincipled")
    uv = t.new("ShaderNodeUVMap", uv_map="UVMap").outputs["UV"]
    col = t.new("ShaderNodeTexImage", image=imgs["col"])
    t.l.new(uv, col.inputs["Vector"])
    t.l.new(col.outputs["Color"], bs.inputs["Base Color"])
    orm = t.new("ShaderNodeTexImage", image=imgs["orm"])
    imgs["orm"].colorspace_settings.name = "Non-Color"
    t.l.new(uv, orm.inputs["Vector"])
    sep = t.new("ShaderNodeSeparateColor")
    t.l.new(orm.outputs["Color"], sep.inputs["Color"])
    t.l.new(sep.outputs["Green"], bs.inputs["Roughness"])
    t.l.new(sep.outputs["Blue"], bs.inputs["Metallic"])
    grp = t.new("ShaderNodeGroup")
    grp.node_tree = gltf_output_group()
    t.l.new(sep.outputs["Red"], grp.inputs["Occlusion"])
    nrm = t.new("ShaderNodeTexImage", image=imgs["nrm"])
    imgs["nrm"].colorspace_settings.name = "Non-Color"
    t.l.new(uv, nrm.inputs["Vector"])
    nm = t.new("ShaderNodeNormalMap", uv_map="UVMap")
    t.l.new(nrm.outputs["Color"], nm.inputs["Color"])
    t.l.new(nm.outputs["Normal"], bs.inputs["Normal"])
    if imgs.get("emit") is not None:
        em = t.new("ShaderNodeTexImage", image=imgs["emit"])
        t.l.new(uv, em.inputs["Vector"])
        t.l.new(em.outputs["Color"], bs.inputs["Emission Color"])
        bs.inputs["Emission Strength"].default_value = emit_strength
    t.l.new(bs.outputs["BSDF"], out.inputs["Surface"])
    return m


def export(ob, path, extras):
    ob["prop"] = extras
    select_only([ob])
    kw = dict(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
              export_texcoords=True, export_normals=True, export_tangents=True, export_materials="EXPORT",
              export_image_format="AUTO", export_extras=True, export_animations=False, export_skins=False,
              export_morph=False, export_cameras=False, export_lights=False)
    props = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    bpy.ops.export_scene.gltf(**{k: v for k, v in kw.items() if k in props})


# ====================================================================== shared materials
def m_steel(t, base=(0.56, 0.57, 0.585), rough=0.32, brushed_axis="Z", wear=0.25, rust=0.0):
    P = t.co()
    sc = {"Z": (260.0, 260.0, 5.0), "X": (5.0, 260.0, 260.0), "Y": (260.0, 5.0, 260.0)}[brushed_axis]
    brush = t.noise(t.scale(P, sc), 1.0, 6.0, 0.6)
    blot = t.noise(P, 18.0, 4.0, 0.55)
    col = t.mixc(t.mr(blot, 0.35, 0.75), tuple(c * 0.72 for c in base), base)
    col = t.mixc(t.math("MULTIPLY", t.mr(brush, 0.4, 0.62), 0.35), col, tuple(min(1.0, c * 1.15) for c in base))
    e = t.edge(0.0025, 5.0)
    col = t.mixc(t.math("MULTIPLY", e, wear), col, (0.8, 0.8, 0.82))
    rgh = t.math("ADD", rough - 0.08, t.math("MULTIPLY", t.mr(brush, 0.3, 0.7), 0.16))
    rgh = t.mixf(t.math("MULTIPLY", e, wear), rgh, 0.16)
    metal = 1.0
    if rust > 0:
        rm = t.math("MULTIPLY", t.mr(t.noise(P, 30.0, 6.0, 0.7), 0.64, 0.72), rust)
        col = t.mixc(rm, col, t.ramp(t.noise(P, 90.0, 3.0), [(0.3, (0.2, 0.07, 0.03)), (0.7, (0.42, 0.19, 0.07))]))
        rgh = t.mixf(rm, rgh, 0.85)
        metal = t.mixf(rm, 1.0, 0.25)
    nrm = t.bump(t.math("ADD", t.math("MULTIPLY", brush, 0.3), t.math("MULTIPLY", blot, 0.2)), 0.08, 0.0004,
                 t.bevel_n(0.0012))
    return {"color": col, "rough": rgh, "metal": metal, "normal": nrm}


def m_paint(t, base, rough=0.5, metal=0.0, wear_col=(0.55, 0.55, 0.57), wear=0.6, bump_scale=160.0, bevel_r=0.0015,
            grime=0.3):
    P = t.co()
    fine = t.noise(P, bump_scale, 6.0, 0.6)
    blot = t.noise(P, 12.0, 3.0, 0.5)
    col = t.mixc(t.mr(blot, 0.3, 0.8), tuple(c * 0.8 for c in base), tuple(min(1.0, c * 1.12) for c in base))
    e = t.math("MULTIPLY", t.edge(0.002, 7.0), t.mr(t.noise(P, 45.0, 4.0), 0.42, 0.6))
    col = t.mixc(t.math("MULTIPLY", e, wear), col, wear_col)
    g = t.math("MULTIPLY", t.math("SUBTRACT", 1.0, t.ao(0.02, 8)), grime)
    col = t.mixc(g, col, (0.05, 0.045, 0.04))
    rgh = t.mixf(t.math("MULTIPLY", e, wear), t.math("ADD", rough - 0.05, t.math("MULTIPLY", blot, 0.1)), 0.3)
    met = t.mixf(t.math("MULTIPLY", e, wear), metal, 1.0 if sum(wear_col) > 1.2 else metal)
    nrm = t.bump(fine, 0.05, 0.0005, t.bevel_n(bevel_r))
    return {"color": col, "rough": rgh, "metal": met, "normal": nrm}


def m_rubber(t, base=(0.035, 0.035, 0.038), rough=0.82, pattern=None, strength=0.4):
    P = t.co()
    fine = t.noise(P, 220.0, 5.0, 0.6)
    col = t.mixc(t.mr(t.noise(P, 20.0, 3.0), 0.3, 0.8), base, tuple(min(1.0, c * 1.5 + 0.01) for c in base))
    h = fine if pattern is None else t.math("ADD", t.math("MULTIPLY", pattern, 1.0), t.math("MULTIPLY", fine, 0.15))
    nrm = t.bump(h, strength, 0.0006, t.bevel_n(0.0015))
    return {"color": col, "rough": t.math("ADD", rough - 0.04, t.math("MULTIPLY", fine, 0.08)), "metal": 0.0,
            "normal": nrm}


def m_gold(t, base=(0.86, 0.64, 0.27), rough=0.24):
    P = t.co()
    blot = t.noise(P, 24.0, 4.0)
    col = t.mixc(t.mr(blot, 0.45, 0.75), base, (base[0] * 0.55, base[1] * 0.45, base[2] * 0.3))
    e = t.edge(0.0015, 5.0)
    col = t.mixc(e, col, (1.0, 0.86, 0.55))
    return {"color": col, "rough": t.mixf(e, t.math("ADD", rough, t.math("MULTIPLY", blot, 0.12)), 0.15), "metal": 1.0,
            "normal": t.bump(t.noise(P, 300.0, 4.0), 0.03, 0.0003, t.bevel_n(0.001))}


# ====================================================================== the props
def prop_brick(ctx):
    L, W, H = 0.215, 0.1025, 0.065       # glTF X, Y, Z (Blender X, Z, -Y)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * L, v.co.y * H, v.co.z * W))
    # frog (the shallow recess) on the glTF +Z face = Blender -Y face
    bm.faces.ensure_lookup_table()
    fy = min(bm.faces, key=lambda f: f.calc_center_median().y)
    ins = bmesh.ops.inset_individual(bm, faces=[fy], thickness=0.021, depth=0.0)
    bm.faces.ensure_lookup_table()
    inner = fy
    ext = bmesh.ops.extrude_face_region(bm, geom=[inner])
    nv = [g for g in ext["geom"] if isinstance(g, bmesh.types.BMVert)]
    c = sum((v.co for v in nv), Vector()) / len(nv)
    for v in nv:
        v.co = c + (v.co - c) * 0.9
        v.co.y += 0.011
    bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if e.calc_length() > 0.02], cuts=5, use_grid_fill=True)
    rnd = random.Random(1307)
    corners = [Vector((sx * L / 2, sy * H / 2, sz * W / 2)) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    chips = rnd.sample(corners, 3)
    for v in bm.verts:
        v.co += Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * 0.0006
        for cc in chips:
            d = (v.co - cc).length
            if d < 0.024:          # jagged chip: depth varies per vertex
                v.co += (Vector((0, 0, 0)) - cc).normalized() * (0.024 - d) * rnd.uniform(0.25, 0.6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = ob_from_bm(bm, "brick")
    bevel(ob, 0.0026, 2, 30.0)
    smooth(ob, 38.0)
    weighted_normals(ob)

    def clay(t):
        P = t.co()
        big = t.noise(P, 3.0, 3.0, 0.5)
        mid = t.noise(P, 22.0, 6.0, 0.6)
        col = t.ramp(t.math("ADD", t.math("MULTIPLY", mid, 0.7), t.math("MULTIPLY", big, 0.3)),
                     [(0.25, (0.27, 0.065, 0.035)), (0.48, (0.46, 0.13, 0.055)), (0.7, (0.58, 0.22, 0.1)),
                      (0.9, (0.66, 0.34, 0.18))])
        col = t.mixc(t.mr(big, 0.3, 0.7), t.mixc(0.5, col, (0.0, 0.0, 0.0), "MULTIPLY"), col)
        burnt = t.mr(t.noise(t.scale(P, (1.0, 1.0, 1.0)), 6.0, 4.0, 0.6), 0.6, 0.7)
        col = t.mixc(t.math("MULTIPLY", burnt, 0.75), col, (0.17, 0.06, 0.045))
        flecks = t.voronoi(P, 150.0)
        col = t.mixc(t.mr(flecks, 0.1, 0.05), col, (0.13, 0.05, 0.03))
        light = t.voronoi(t.scale(P, (1.3, 1.3, 1.3)), 110.0)
        col = t.mixc(t.math("MULTIPLY", t.mr(light, 0.07, 0.04), 0.7), col, (0.78, 0.6, 0.45))
        mort = t.math("MULTIPLY", t.mr(t.noise(P, 9.0, 3.0, 0.6), 0.6, 0.66),
                      t.mr(t.math("ABSOLUTE", t.xyz(t.geo("Normal"))[1]), 0.7, 0.2))
        col = t.mixc(mort, col, t.mixc(t.noise(P, 80.0), (0.5, 0.48, 0.44), (0.66, 0.64, 0.58)))
        e = t.edge(0.004, 5.0)
        col = t.mixc(t.math("MULTIPLY", e, 0.5), col, (0.74, 0.47, 0.32))
        g = t.math("SUBTRACT", 1.0, t.ao(0.02, 8))
        col = t.mixc(t.math("MULTIPLY", g, 0.6), col, (0.12, 0.05, 0.03))
        pits = t.mr(t.voronoi(P, 45.0), 0.0, 0.13)
        sand = t.noise(P, 420.0, 4.0, 0.7)
        h = t.math("ADD", t.math("MULTIPLY", t.noise(P, 90.0, 8.0, 0.65), 0.45), t.math("MULTIPLY", pits, 0.45))
        h = t.math("ADD", h, t.math("ADD", t.math("MULTIPLY", mort, 0.7), t.math("MULTIPLY", sand, 0.25)))
        return {"color": col, "rough": t.mixf(mort, t.math("ADD", 0.8, t.math("MULTIPLY", mid, 0.12)), 0.95),
                "metal": 0.0, "normal": t.bump(h, 0.95, 0.002, t.bevel_n(0.0035)), "ao": t.ao(0.03, 16)}

    set_mat(ob, material("brick_clay", clay))
    return ob, {"origin": "centre (also the projectile pivot)", "size": 512,
                "note": "215 x 102.5 x 65 mm brick with a frog on the +Z face, chipped corners"}


def prop_baton(ctx):
    z0 = -0.10          # butt end; the grip centre is the origin
    prof = [(0.0, z0), (0.0105, z0 + 0.0003), (0.0158, z0 + 0.003), (0.0186, z0 + 0.008), (0.019, z0 + 0.016),
            (0.0182, z0 + 0.0205), (0.0166, z0 + 0.0228), (0.0176, z0 + 0.026)]
    for i in range(8):
        prof.append((0.0179, z0 + 0.034 + i * 0.021))
    prof += [(0.0178, 0.093), (0.0191, 0.096), (0.0194, 0.103), (0.0189, 0.108), (0.0158, 0.112), (0.0152, 0.118)]
    for i in range(1, 9):
        z = 0.118 + i * 0.045
        prof.append((0.0152 - 0.0017 * i / 8.0, z))
    prof += [(0.0139, 0.487), (0.0147, 0.491), (0.0148, 0.497), (0.0138, 0.5), (0.0098, 0.5018), (0.0, 0.5025)]
    ob = lathe("baton", prof, 28)
    smooth(ob, 32.0)

    def mat(t):
        _, _, Z = t.xyz()
        X, Y, _ = t.xyz()
        cap = t.math("MAXIMUM", t.mr(Z, -0.0775, -0.0785), t.mr(Z, 0.486, 0.487))
        collar = t.between(Z, 0.094, 0.111, 0.0006)
        grip = t.between(Z, -0.077, 0.093, 0.0006)
        shaft = t.math("SUBTRACT", 1.0, t.math("MAXIMUM", t.math("MAXIMUM", cap, collar), grip), clamp=True)
        # diamond knurl on the grip: two helical groove families
        u = t.math("MULTIPLY", t.atan2(Y, X), 0.0179)
        k = TAU / 0.0045
        a = t.math("SINE", t.math("MULTIPLY", t.math("ADD", u, Z), k))
        b = t.math("SINE", t.math("MULTIPLY", t.math("SUBTRACT", u, Z), k))
        knurl = t.math("MULTIPLY", a, b)
        rub = m_rubber(t, (0.03, 0.03, 0.033), 0.84)
        st = m_steel(t, (0.6, 0.6, 0.62), 0.26, "Z", 0.3)
        P = t.co()
        scr = t.mr(t.noise(t.scale(P, (500.0, 500.0, 7.0)), 1.0, 3.0), 0.66, 0.72)
        an_col = t.mixc(t.math("MULTIPLY", scr, 0.5), (0.028, 0.028, 0.032), (0.2, 0.2, 0.21))
        an_r = t.mixf(scr, t.math("ADD", 0.3, t.math("MULTIPLY", t.noise(P, 25.0), 0.1)), 0.5)
        metal_mask = t.math("MAXIMUM", cap, collar)
        col = t.mixc(grip, t.mixc(metal_mask, an_col, st["color"]), rub["color"])
        rgh = t.mixf(grip, t.mixf(metal_mask, an_r, st["rough"]), rub["rough"])
        met = t.mixf(grip, 1.0, 0.0)
        h = t.math("ADD", t.math("MULTIPLY", t.math("MULTIPLY", knurl, grip), 0.6),
                   t.math("MULTIPLY", t.math("MULTIPLY", scr, shaft), -0.15))
        return {"color": col, "rough": rgh, "metal": met, "normal": t.bump(h, 0.45, 0.0005, t.bevel_n(0.001))}

    set_mat(ob, material("baton_mat_src", mat))
    return ob, {"origin": "grip centre (0.10 m from the butt)", "size": 512,
                "note": "0.60 m black anodised baton, diamond-knurled rubber grip, steel collar and end caps"}


def prop_cleaver(ctx):
    # blade: grid over u (along the handle axis, Blender Z) x v (spine -> edge, Blender +Y -> -Y); thickness along X
    NU, NV = 30, 12
    z0, z1 = 0.071, 0.272

    def outline(u, v):
        ys = 0.0112 - 0.0012 * u
        ye = -0.083 - 0.0045 * math.sin(math.pi * u)
        y = ys + (ye - ys) * v
        zt = z1 - 0.0065 * (abs(2 * v - 1) ** 6)
        zh = z0 + 0.004 * v
        return zh + (zt - zh) * u, y

    def thick(v):      # 4.2 mm spine tapering to 3.6 mm, then the ground edge bevel to 0 at the cutting edge
        return 0.0042 - 0.0006 * v / 0.72 if v < 0.72 else 0.0036 * (1.0 - (v - 0.72) / 0.28)

    bm = bmesh.new()
    top, bot = {}, {}
    for i in range(NU + 1):
        for j in range(NV + 1):
            u, v = i / NU, j / NV
            z, y = outline(u, v)
            t = max(0.0, thick(v))
            if j == NV:
                top[i, j] = bot[i, j] = bm.verts.new((0.0, y, z))
            else:
                top[i, j] = bm.verts.new((t / 2, y, z))
                bot[i, j] = bm.verts.new((-t / 2, y, z))
    for i in range(NU):
        for j in range(NV):
            bm.faces.new((top[i, j], top[i + 1, j], top[i + 1, j + 1], top[i, j + 1]))
            bm.faces.new((bot[i, j], bot[i, j + 1], bot[i + 1, j + 1], bot[i + 1, j]))
    for i in range(NU):            # spine strip
        bm.faces.new((top[i, 0], bot[i, 0], bot[i + 1, 0], top[i + 1, 0]))
    for j in range(NV):            # heel + tip strips
        for i, flip in ((0, False), (NU, True)):
            a, b, c, d = top[i, j], top[i, j + 1], bot[i, j + 1], bot[i, j]
            quad = [a, b, c, d]
            quad = [q for k, q in enumerate(quad) if q not in quad[:k]]
            if len(quad) >= 3:
                bm.faces.new(quad[::-1] if flip else quad)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    blade = ob_from_bm(bm, "blade")
    hole = cyl("hole", 0.0066, 0.03, 20, Matrix.Translation((0, -0.004, 0.249)) @ Matrix.Rotation(RAD(90), 4, "Y"))
    md = blade.modifiers.new("hole", "BOOLEAN")
    md.operation = "DIFFERENCE"
    md.object = hole
    md.solver = "EXACT"
    apply_mods(blade)
    bpy.data.objects.remove(hole)
    smooth(blade, 25.0)
    bolster = box("bolster", (0.0172, 0.028, 0.016), (0.0, -0.0012, 0.0625))
    bevel(bolster, 0.0022, 3, 35.0)
    smooth(bolster, 40.0)
    handle = box("handle", (0.0148, 0.0252, 0.124), (0.0, -0.0014, -0.0045))
    bevel(handle, 0.0058, 5, 35.0)
    smooth(handle, 50.0)
    rivets = []
    for k, z in enumerate((-0.046, -0.0045, 0.037)):
        r = cyl("rivet%d" % k, 0.0034, 0.0162, 16, Matrix.Translation((0.0, -0.0014, z)) @ Matrix.Rotation(RAD(90), 4, "Y"))
        bevel(r, 0.0011, 2, 40.0)
        smooth(r, 45.0)
        rivets.append(r)

    def blade_mat(t):
        s = m_steel(t, (0.6, 0.61, 0.62), 0.3, "Z", 0.35, rust=0.8)
        X, Y, Z = t.xyz(t.geo("Normal"))
        band = t.mr(t.math("ABSOLUTE", X), 0.995, 0.985)        # the ground edge bevel (tilted faces)
        s["color"] = t.mixc(band, s["color"], (0.8, 0.81, 0.83))
        s["rough"] = t.mixf(band, s["rough"], 0.14)
        _, PY, PZ = t.xyz()
        grime = t.math("MULTIPLY", t.mr(PY, 0.0, 0.011), t.mr(t.noise(t.co(), 14.0, 4.0), 0.4, 0.7))
        s["color"] = t.mixc(t.math("MULTIPLY", grime, 0.6), s["color"], (0.18, 0.17, 0.16))
        return s

    def wood(t):
        P = t.co()
        grain = t.wave(t.scale(P, (1.0, 4.0, 0.25)), 28.0, 6.0, 3.0, "Y")
        fine = t.noise(t.scale(P, (40.0, 40.0, 3.0)), 8.0, 5.0)
        col = t.ramp(t.math("ADD", t.math("MULTIPLY", grain, 0.7), t.math("MULTIPLY", fine, 0.3)),
                     [(0.2, (0.075, 0.035, 0.018)), (0.55, (0.16, 0.08, 0.035)), (0.85, (0.27, 0.14, 0.06))])
        e = t.edge(0.004, 6.0)
        col = t.mixc(t.math("MULTIPLY", e, 0.5), col, (0.36, 0.22, 0.12))
        rgh = t.math("ADD", 0.5, t.math("MULTIPLY", fine, 0.2))
        return {"color": col, "rough": t.mixf(e, rgh, 0.32), "metal": 0.0,
                "normal": t.bump(t.math("ADD", grain, t.math("MULTIPLY", fine, 0.4)), 0.25, 0.0006, t.bevel_n(0.002))}

    set_mat(blade, material("cleaver_blade", blade_mat))
    set_mat(bolster, material("cleaver_bolster", lambda t: m_steel(t, (0.42, 0.42, 0.44), 0.36, "Z", 0.4)))
    set_mat(handle, material("cleaver_wood", wood))
    for r in rivets:
        set_mat(r, bpy.data.materials.get("cleaver_brass") or material("cleaver_brass", lambda t: m_gold(t, (0.78, 0.58, 0.3), 0.3)))
    ob = join([handle, blade, bolster] + rivets, "cleaver")
    weighted_normals(ob)
    return ob, {"origin": "handle centre", "size": 1024,
                "note": "butcher cleaver: 200 x 90 mm blade (ground edge toward +Z, hanging hole), steel bolster, "
                        "walnut handle, 3 brass rivets; comic flat-side smacks only - no blood, no gore"}


def prop_gourd(ctx):
    zg = 0.205         # the neck grip / hang point becomes the origin
    prof = [(0.0, 0.0), (0.024, 0.0012), (0.043, 0.006), (0.056, 0.016), (0.0635, 0.031), (0.0662, 0.049),
            (0.0645, 0.067), (0.0585, 0.085), (0.049, 0.1), (0.038, 0.113), (0.0305, 0.124), (0.0285, 0.131),
            (0.0305, 0.139), (0.037, 0.149), (0.0435, 0.161), (0.0462, 0.173), (0.0445, 0.185), (0.037, 0.196),
            (0.026, 0.204), (0.0188, 0.211), (0.0172, 0.219), (0.0184, 0.2245), (0.0178, 0.227), (0.0136, 0.2275),
            (0.0, 0.2265)]
    body = lathe("gourd_body", [(r, z - zg) for r, z in prof], 36)
    smooth(body, 50.0)
    stop = lathe("stopper", [(0.0, 0.2215 - zg), (0.0122, 0.222 - zg), (0.0128, 0.232 - zg), (0.0142, 0.2385 - zg),
                             (0.0138, 0.2432 - zg), (0.0105, 0.2462 - zg), (0.0, 0.2472 - zg)], 24)
    smooth(stop, 50.0)
    cord = torus("cord", 0.0305, 0.0034, 40, 8, Matrix.Translation((0, 0, 0.1305 - zg)))
    neck = torus("neckcord", 0.0196, 0.0026, 28, 6, Matrix.Translation((0, 0, 0.2135 - zg)))
    loop = torus("loop", 0.016, 0.0024, 24, 6, Matrix.Translation((0.021, 0.0, 0.2255 - zg)) @ Matrix.Rotation(RAD(90), 4, "X")
                 @ Matrix.Rotation(RAD(0), 4, "Z"))
    knot = lathe("knot", [(0.0, -0.007), (0.005, -0.0055), (0.0068, 0.0), (0.005, 0.0055), (0.0, 0.007)], 12)
    transform(knot, Matrix.Translation((0.0335, 0.0, 0.1305 - zg)))
    tas_prof = [(0.0, 0.0), (0.004, -0.002), (0.0045, -0.008), (0.0038, -0.012), (0.0075, -0.018), (0.0105, -0.035),
                (0.0112, -0.052), (0.0094, -0.056), (0.0, -0.057)]
    tassel = lathe("tassel", tas_prof, 16)
    transform(tassel, Matrix.Translation((0.0355, 0.0, 0.1245 - zg)) @ Matrix.Rotation(RAD(-18), 4, "Y"))
    for o in (cord, neck, loop, knot, tassel):
        smooth(o, 60.0)
    label_path = os.path.join(ctx["tex"], "gourd_label.png")

    def calabash(t):
        P = t.co()
        X, Y, Z = t.xyz()
        mott = t.noise(P, 16.0, 5.0, 0.6)
        big = t.noise(P, 5.0, 3.0)
        ang = t.atan2(Y, X)
        stripes = t.math("MULTIPLY", t.math("SINE", t.math("ADD", t.math("MULTIPLY", ang, 9.0), t.math("MULTIPLY", big, 3.0))), 0.5)
        col = t.ramp(t.math("ADD", t.math("MULTIPLY", mott, 0.75), t.math("MULTIPLY", stripes, 0.12)),
                     [(0.2, (0.23, 0.1, 0.035)), (0.45, (0.45, 0.22, 0.07)), (0.65, (0.62, 0.36, 0.12)),
                      (0.85, (0.74, 0.5, 0.2))])
        wear = t.mr(t.noise(P, 7.0, 3.0), 0.55, 0.65)
        # red paper tag on the lower bulb, facing glTF +Z (Blender -Y)
        du = t.math("MULTIPLY", t.math("SUBTRACT", ang, -math.pi / 2), 0.064)
        dv = t.math("SUBTRACT", Z, 0.052 - zg)
        uv = t.vec(t.math("ADD", t.math("DIVIDE", du, 0.05), 0.5), t.math("ADD", t.math("DIVIDE", dv, 0.05), 0.5), 0.0)
        lab_a = t.image(label_path, uv, "CLIP", out="Alpha")
        lab_c = t.image(label_path, uv, "CLIP", out="Color")
        col = t.mixc(lab_a, col, lab_c)
        rgh = t.mixf(wear, t.math("ADD", 0.28, t.math("MULTIPLY", mott, 0.12)), 0.62)
        rgh = t.mixf(lab_a, rgh, 0.7)
        h = t.math("ADD", t.math("MULTIPLY", t.noise(P, 140.0, 6.0), 0.35), t.math("MULTIPLY", big, 0.4))
        return {"color": col, "rough": rgh, "metal": 0.0, "normal": t.bump(h, 0.3, 0.0012, t.bevel_n(0.001))}

    def cordm(t):
        P = t.co()
        tw = t.wave(t.scale(P, (1.0, 1.0, 1.0)), 180.0, 4.0, 2.0, "DIAGONAL")
        col = t.mixc(t.mr(t.noise(P, 60.0), 0.3, 0.8), (0.42, 0.025, 0.03), (0.66, 0.06, 0.05))
        return {"color": col, "rough": 0.78, "metal": 0.0, "normal": t.bump(tw, 0.5, 0.0007)}

    def cork(t):
        P = t.co()
        pores = t.mr(t.voronoi(P, 380.0), 0.0, 0.25)
        col = t.mixc(t.noise(P, 90.0), (0.44, 0.3, 0.17), (0.62, 0.46, 0.28))
        col = t.mixc(t.math("SUBTRACT", 1.0, pores), col, (0.25, 0.16, 0.09))
        return {"color": col, "rough": 0.9, "metal": 0.0, "normal": t.bump(pores, 0.5, 0.0006, t.bevel_n(0.0012))}

    set_mat(body, material("gourd_calabash", calabash))
    set_mat(stop, material("gourd_cork", cork))
    red = material("gourd_cord", cordm)
    for o in (cord, neck, loop, knot, tassel):
        set_mat(o, red)
    ob = join([body, stop, cord, neck, loop, knot, tassel], "gourd")
    weighted_normals(ob)
    return ob, {"origin": "neck (the hand grip / hang point); the spout (stopper) is +Y", "size": 1024,
                "note": "lacquered calabash gourd, cork stopper, red cord + tassel, red paper tag (no text)"}


def prop_mic_cane(ctx):
    prof = [(0.0, -0.236), (0.0105, -0.2355), (0.0158, -0.232), (0.0172, -0.226), (0.0174, -0.212), (0.0168, -0.206),
            (0.0156, -0.203), (0.0162, -0.199)]
    for i in range(12):
        z = -0.192 + i * 0.0205
        prof.append((0.0163 + 0.0006 * math.sin(i * 1.7), z))
    prof += [(0.0164, 0.046), (0.0178, 0.049), (0.018, 0.056), (0.0172, 0.06), (0.018, 0.065), (0.0176, 0.071),
             (0.0132, 0.075), (0.0127, 0.08)]
    for i in range(1, 12):
        prof.append((0.0127 - 0.0013 * i / 11.0, 0.08 + i * 0.0545))
    prof += [(0.0118, 0.683), (0.014, 0.689), (0.0165, 0.698), (0.0196, 0.707), (0.0228, 0.713), (0.0232, 0.716)]
    zc, R = 0.757, 0.0435
    for k in range(0, 17):
        a = RAD(-62 + k * (152 / 16.0))
        prof.append((max(0.0, R * math.cos(a)), zc + R * math.sin(a)))
    prof.append((0.0, zc + R))
    ob = lathe("cane_body", prof, 30)
    smooth(ob, 45.0)
    band = torus("mic_band", 0.0442, 0.0031, 40, 8, Matrix.Translation((0, 0, zc - 0.004)))
    smooth(band, 60.0)

    def mat(t):
        P = t.co()
        X, Y, Z = t.xyz()
        grip = t.between(Z, -0.2025, 0.0465, 0.0006)
        gold = t.math("MAXIMUM", t.mr(Z, -0.2035, -0.2045), t.between(Z, 0.0465, 0.0735, 0.0006))
        neckm = t.between(Z, 0.683, 0.7145, 0.0006)
        head = t.mr(Z, 0.7142, 0.7152)
        shaft = t.math("SUBTRACT", 1.0, t.math("MAXIMUM", t.math("MAXIMUM", grip, gold), t.math("MAXIMUM", neckm, head)), clamp=True)
        ang = t.atan2(Y, X)
        # leather spiral wrap on the grip
        wrap = t.math("SINE", t.math("MULTIPLY", t.math("ADD", t.math("MULTIPLY", ang, 0.0163), Z), TAU / 0.018))
        lea = m_rubber(t, (0.05, 0.034, 0.028), 0.62, t.math("MULTIPLY", t.mr(wrap, 0.75, 1.0), -1.0), 0.6)
        # black lacquer shaft with gold flakes and a gold barber-pole pin-stripe
        flk = t.mr(t.voronoi(P, 900.0), 0.12, 0.05)
        flk = t.math("MULTIPLY", flk, t.mr(t.voronoi(P, 900.0, "F1", "Color"), 0.72, 0.8))
        stripe = t.mr(t.math("SINE", t.math("ADD", ang, t.math("MULTIPLY", Z, TAU / 0.11))), 0.93, 0.965)
        lac_c = t.mixc(t.math("MAXIMUM", flk, stripe), (0.018, 0.017, 0.022), (0.85, 0.62, 0.24))
        lac_m = t.math("MAXIMUM", flk, stripe)
        g = m_gold(t)
        # chrome ball grille: perforations
        cells = t.voronoi(t.scale(P, (1.0, 1.0, 1.0)), 520.0, "F1", "Distance", 0.0)
        holes = t.mr(cells, 0.3, 0.2)
        chrome_c = t.mixc(holes, (0.78, 0.79, 0.8), (0.035, 0.035, 0.04))
        chrome_r = t.mixf(holes, 0.2, 0.6)
        col = t.mixc(shaft, t.mixc(grip, t.mixc(gold, t.mixc(head, (0.8, 0.8, 0.82), chrome_c), g["color"]), lea["color"]),
                     lac_c)
        col = t.mixc(neckm, col, (0.8, 0.8, 0.82))
        rgh = t.mixf(shaft, t.mixf(grip, t.mixf(gold, t.mixf(head, 0.18, chrome_r), g["rough"]), lea["rough"]),
                     t.mixf(lac_m, 0.16, 0.25))
        rgh = t.mixf(neckm, rgh, 0.16)
        met = t.mixf(shaft, t.mixf(grip, t.mixf(head, 1.0, t.mixf(holes, 1.0, 0.2)), 0.0), lac_m)
        met = t.math("MAXIMUM", met, t.math("MAXIMUM", gold, neckm))
        h = t.math("ADD", t.math("MULTIPLY", t.math("MULTIPLY", t.mr(wrap, 0.75, 1.0), grip), -0.5),
                   t.math("MULTIPLY", t.math("MULTIPLY", holes, head), -0.6))
        return {"color": col, "rough": rgh, "metal": met, "normal": t.bump(h, 0.5, 0.0006, t.bevel_n(0.0012))}

    set_mat(ob, material("cane_src", mat))
    set_mat(band, material("cane_band", lambda t: m_gold(t)))
    ob = join([ob, band], "mic_cane")
    weighted_normals(ob)
    return ob, {"origin": "upper (right-hand) grip; the left hand sits ~0.13 m toward the pommel (-Y); the microphone "
                          "head is the business end (+Y, 0.76 m)", "size": 1024,
                "note": "Ricky's microphone cane: gold pommel + collars, leather spiral grip, black lacquer shaft with gold "
                        "flakes and a pin-stripe, chrome ball-grille microphone head with a gold band (generic, no brand)"}


def prop_taser(ctx):
    tilt = Matrix.Rotation(RAD(14), 4, "X")      # grip top leans toward the barrel (-Y)
    grip = box("grip", (0.029, 0.033, 0.105), (0, 0, 0), tilt)
    bevel(grip, 0.0085, 4, 35.0)
    body = box("body", (0.036, 0.176, 0.047), (0.0, -0.047, 0.071))
    bevel(body, 0.0085, 4, 35.0)
    cart = box("cart", (0.0385, 0.046, 0.051), (0.0, -0.157, 0.071))
    bevel(cart, 0.0038, 3, 35.0)
    rail = box("rail", (0.012, 0.09, 0.006), (0.0, -0.05, 0.097))
    bevel(rail, 0.0018, 2, 35.0)
    # trigger guard: a 270 deg loop in the side (YZ) plane, open at the top where it meets the body
    guard = torus("guard", 0.019, 0.0034, 24, 8, Matrix.Translation((0.0, -0.034, 0.03)) @ Matrix.Rotation(RAD(90), 4, "Y")
                  @ Matrix.Diagonal((1.0, 1.25, 1.0, 1.0)) @ Matrix.Rotation(RAD(225), 4, "Z"), arc=math.pi * 1.5)
    trig = box("trigger", (0.0065, 0.008, 0.021), (0.0, -0.027, 0.034), Matrix.Rotation(RAD(-18), 4, "X"))
    bevel(trig, 0.0025, 3, 35.0)
    ports = [cyl("port%d" % k, 0.0056, 0.004, 16, Matrix.Translation((0.0, -0.1805, 0.071 + dz)) @ Matrix.Rotation(RAD(90), 4, "X"))
             for k, dz in enumerate((-0.012, 0.012))]
    led = cyl("led", 0.0042, 0.004, 16, Matrix.Translation((0.0, 0.041, 0.083)) @ Matrix.Rotation(RAD(90), 4, "X"))
    screws = [cyl("screw%d" % k, 0.0028, 0.0386, 12, Matrix.Translation((0.0, y, z)) @ Matrix.Rotation(RAD(90), 4, "Y"))
              for k, (y, z) in enumerate(((-0.1, 0.058), (0.015, 0.06), (-0.004, -0.03)))]
    for o in [grip, body, cart, rail, guard, trig, led] + ports + screws:
        smooth(o, 40.0)

    def yellow(t):
        s = m_paint(t, (0.93, 0.66, 0.05), 0.42, 0.0, (0.25, 0.22, 0.18), 0.35, 200.0, 0.002, 0.35)
        return s

    def grip_m(t):
        P = t.co()
        stip = t.mr(t.voronoi(P, 700.0), 0.0, 0.3)
        return m_rubber(t, (0.03, 0.03, 0.032), 0.85, t.math("MULTIPLY", stip, 1.0), 0.5)

    def cart_m(t):
        P = t.co()
        X, Y, Z = t.xyz()
        stripes = t.mr(t.math("SINE", t.math("MULTIPLY", t.math("ADD", Y, Z), TAU / 0.014)), -0.05, 0.05)
        col = t.mixc(stripes, (0.03, 0.03, 0.03), (0.95, 0.72, 0.05))
        front = t.mr(t.xyz(t.geo("Normal"))[1], -0.7, -0.9)
        col = t.mixc(front, col, (0.05, 0.05, 0.055))
        e = t.edge(0.002, 6.0)
        col = t.mixc(t.math("MULTIPLY", e, 0.35), col, (0.35, 0.33, 0.3))
        return {"color": col, "rough": 0.45, "metal": 0.0, "normal": t.bump(t.noise(P, 250.0), 0.05, 0.0004, t.bevel_n(0.0015))}

    def led_m(t):
        return {"color": (0.1, 0.9, 0.35), "rough": 0.15, "metal": 0.0, "emit": (0.2, 1.0, 0.45)}

    set_mat(body, material("taser_yellow", yellow))
    set_mat(rail, bpy.data.materials["taser_yellow"])
    set_mat(grip, material("taser_grip", grip_m))
    set_mat(trig, bpy.data.materials["taser_grip"])
    set_mat(guard, bpy.data.materials["taser_grip"])
    set_mat(cart, material("taser_cart", cart_m))
    dark = material("taser_steel", lambda t: m_steel(t, (0.35, 0.35, 0.37), 0.35, "Y", 0.3))
    for o in ports + screws:
        set_mat(o, dark)
    set_mat(led, material("taser_led", led_m))
    ob = join([grip, body, cart, rail, guard, trig, led] + ports + screws, "taser")
    weighted_normals(ob)
    return ob, {"origin": "grip centre; +Y = top of the gun (thumb side), +Z = barrel", "size": 1024,
                "note": "generic yellow stun gun: rubber stipple grip, hazard-striped cartridge with two barb ports, "
                        "green status LED (emissive); no brand marks"}


def prop_spotlight(ctx):
    prof = [(0.0, -0.19), (0.05, -0.1885), (0.085, -0.181), (0.104, -0.168), (0.1135, -0.152), (0.1155, -0.14)]
    for s in (-0.128, -0.108, -0.088, -0.068):
        prof += [(0.1155, s - 0.0045), (0.1262, s - 0.003), (0.127, s), (0.1262, s + 0.003), (0.1155, s + 0.0045)]
    prof += [(0.1155, 0.098), (0.1275, 0.103), (0.1305, 0.11), (0.1305, 0.127), (0.124, 0.1318), (0.1125, 0.1318),
             (0.108, 0.128), (0.0, 0.128)]
    can = lathe("can", prof, 36)
    lens = lathe("lens", [(0.0, 0.1345), (0.05, 0.1335), (0.09, 0.1308), (0.1082, 0.1285), (0.1082, 0.1262), (0.0, 0.1262)], 36)
    face = Matrix.Rotation(RAD(90), 4, "X")         # can axis Blender +Z -> -Y (glTF +Z = beam)
    for o in (can, lens):
        transform(o, face)
        smooth(o, 38.0)
    parts = [can, lens]
    frame = []
    for k, (cx, cz, sx, sz) in enumerate(((0, 0.137, 0.29, 0.016), (0, -0.137, 0.29, 0.016), (0.137, 0, 0.016, 0.29),
                                          (-0.137, 0, 0.016, 0.29))):
        b = box("frame%d" % k, (sx, 0.008, sz), (cx, -0.139, cz))
        bevel(b, 0.0022, 2, 35.0)
        frame.append(b)
    doors = []
    for k, (ax, sgn) in enumerate((("X", 1), ("X", -1), ("Z", 1), ("Z", -1))):
        # hinged at the frame's outer edge, opened 38 deg outward
        if ax == "X":
            d = box("door%d" % k, (0.27, 0.105, 0.003), (0.0, -0.0525, 0.0))
            M = Matrix.Translation((0.0, -0.143, sgn * 0.143)) @ Matrix.Rotation(RAD(-sgn * 38.0), 4, "X")
        else:
            d = box("door%d" % k, (0.003, 0.105, 0.27), (0.0, -0.0525, 0.0))
            M = Matrix.Translation((sgn * 0.143, -0.143, 0.0)) @ Matrix.Rotation(RAD(sgn * 38.0), 4, "Z")
        transform(d, M)
        bevel(d, 0.0012, 2, 35.0)
        doors.append(d)
    yoke = []
    for sx in (-1, 1):
        arm = box("arm%d" % sx, (0.0075, 0.03, 0.225), (sx * 0.1375, 0.0, -0.1025))
        bevel(arm, 0.0028, 3, 35.0)
        yoke.append(arm)
        knob = cyl("knob%d" % sx, 0.022, 0.018, 28, Matrix.Translation((sx * 0.151, 0.0, 0.0)) @ Matrix.Rotation(RAD(90), 4, "Y"))
        bevel(knob, 0.0028, 3, 35.0)
        yoke.append(knob)
    bar = box("bar", (0.2825, 0.034, 0.0085), (0.0, 0.0, -0.2155))
    bevel(bar, 0.0028, 3, 35.0)
    stud = cyl("stud", 0.0125, 0.05, 20, Matrix.Translation((0.0, 0.0, -0.244)))
    bevel(stud, 0.002, 2, 35.0)
    clamp = box("clamp", (0.05, 0.03, 0.02), (0.0, 0.0, -0.276))
    bevel(clamp, 0.004, 3, 35.0)
    yoke += [bar, stud, clamp]
    for o in frame + doors + yoke:
        smooth(o, 40.0)

    def coat(t):
        return m_paint(t, (0.028, 0.028, 0.03), 0.55, 0.0, (0.6, 0.6, 0.62), 0.7, 260.0, 0.0018, 0.4)

    def glass(t):
        P = t.co()
        X, Y, Z = t.xyz()
        r = t.math("SQRT", t.math("ADD", t.math("MULTIPLY", X, X), t.math("MULTIPLY", Z, Z)))
        rings = t.math("SINE", t.math("MULTIPLY", r, TAU / 0.0075))
        return {"color": (0.93, 0.9, 0.82), "rough": 0.06, "metal": 0.0,
                "normal": t.bump(rings, 0.25, 0.0008), "emit": (1.0, 0.93, 0.78)}

    blk = material("spot_coat", coat)
    for o in [can] + frame + doors + yoke:
        set_mat(o, blk)
    set_mat(lens, material("spot_lens", glass))
    ob = join(parts[:1] + [lens] + frame + doors + yoke, "spotlight")
    weighted_normals(ob)
    return ob, {"origin": "yoke tilt pivot (can centre); +Z = beam direction; +Y = up; the yoke hangs toward -Y "
                          "(clamp at -0.28 m)", "size": 1024, "attach": None,
                "note": "stage fresnel spotlight head: finned can, fresnel lens (emissive), colour-frame holder, 4 barn "
                        "doors, yoke with tilt knobs + hanging clamp; a set / cinematic prop (no hand attach)"}


def truncated_icosahedron():
    phi = (1 + 5 ** 0.5) / 2
    V = [(-1, phi, 0), (1, phi, 0), (-1, -phi, 0), (1, -phi, 0), (0, -1, phi), (0, 1, phi), (0, -1, -phi), (0, 1, -phi),
         (phi, 0, -1), (phi, 0, 1), (-phi, 0, -1), (-phi, 0, 1)]
    V = [Vector(v).normalized() for v in V]
    F = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6),
         (7, 1, 8), (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7),
         (9, 8, 1)]
    pt = {}

    def third(a, b):          # the TI vertex on edge a-b nearest a
        if (a, b) not in pt:
            pt[a, b] = V[a] + (V[b] - V[a]) / 3.0
        return pt[a, b]

    panels = []
    for vi in range(12):
        nb = sorted({b for f in F for (a, b) in ((f[0], f[1]), (f[1], f[2]), (f[2], f[0]), (f[1], f[0]), (f[2], f[1]),
                                                   (f[0], f[2])) if a == vi})
        pts = [third(vi, b) for b in nb]
        n = V[vi]
        u = (pts[0] - n * pts[0].dot(n)).normalized()
        w = n.cross(u)
        pts.sort(key=lambda p: math.atan2((p - n).dot(w), (p - n).dot(u)))
        panels.append(("pent", n, pts))
    for (a, b, c) in F:
        pts = [third(a, b), third(b, a), third(b, c), third(c, b), third(c, a), third(a, c)]
        n = (V[a] + V[b] + V[c]).normalized()
        panels.append(("hex", n, pts))
    return panels


def prop_football(ctx):
    R = 0.110
    rings = [0.0, 0.45, 0.78, 0.925, 1.0]
    radius = [R + 0.0007, R + 0.0007, R + 0.0005, R - 0.0001, R - 0.0021]
    seamv = [0.0, 0.0, 0.0, 0.55, 1.0]
    S = 4
    bm = bmesh.new()
    lay_panel = bm.faces.layers.int.new("panel_kind")
    seam_vals = {}
    for kind, n, pts in truncated_icosahedron():
        c = sum(pts, Vector()) / len(pts)
        per = []
        for i in range(len(pts)):
            a, b = pts[i], pts[(i + 1) % len(pts)]
            for s in range(S):
                per.append(a + (b - a) * (s / S))
        ringv = []
        for k, f in enumerate(rings):
            if f == 0.0:
                p = c.normalized() * radius[k]
                v = bm.verts.new(p)
                seam_vals[v] = seamv[k]
                ringv.append([v])
            else:
                row = []
                for p0 in per:
                    p = (c + (p0 - c) * f).normalized() * radius[k]
                    v = bm.verts.new(p)
                    seam_vals[v] = seamv[k]
                    row.append(v)
                ringv.append(row)
        m = len(per)
        for k in range(len(rings) - 1):
            a, b = ringv[k], ringv[k + 1]
            for i in range(m):
                j = (i + 1) % m
                f = bm.faces.new((a[0], b[i], b[j]) if len(a) == 1 else (a[i], b[i], b[j], a[j]))
                f[lay_panel] = 1 if kind == "pent" else 0
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = True
    ob = ob_from_bm(bm, "football")
    # per-corner attributes the shader reads: panel kind (face) and seam proximity (vertex)
    me = ob.data
    pk = me.attributes.new("panel", "FLOAT", "FACE")
    kinds = np.zeros(len(me.polygons), np.int32)
    me.attributes["panel_kind"].data.foreach_get("value", kinds)
    pk.data.foreach_set("value", kinds.astype(np.float32))
    sm = me.attributes.new("seam", "FLOAT", "POINT")
    # recompute the seam value by radius (remove_doubles merged the rings' coincident border verts)
    co = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get("co", co)
    rr = np.linalg.norm(co.reshape(-1, 3), axis=1)
    sm.data.foreach_set("value", np.clip((R + 0.0003 - rr) / 0.0024, 0.0, 1.0).astype(np.float32))
    smooth(ob, 180.0)

    def leather(t):
        P = t.co()
        pan = t.attr("panel")
        seam = t.attr("seam")
        base = t.mixc(pan, (0.86, 0.85, 0.82), (0.018, 0.018, 0.02))
        scuff = t.math("MULTIPLY", t.mr(t.noise(P, 26.0, 6.0, 0.62), 0.58, 0.7), t.math("SUBTRACT", 1.0, pan))
        base = t.mixc(t.math("MULTIPLY", scuff, 0.7), base, t.mixc(t.noise(P, 60.0), (0.5, 0.48, 0.42), (0.34, 0.36, 0.22)))
        base = t.mixc(t.math("MULTIPLY", seam, 0.85), base, (0.06, 0.055, 0.05))
        grain = t.mr(t.voronoi(P, 600.0), 0.0, 0.2)
        stitch = t.math("MULTIPLY", t.mr(seam, 0.3, 0.6), t.math("SINE", t.math("MULTIPLY", t.voronoi(P, 180.0, "F1", "Distance"), 20.0)))
        rgh = t.math("ADD", 0.42, t.math("MULTIPLY", scuff, 0.3))
        rgh = t.mixf(pan, rgh, 0.36)
        h = t.math("ADD", t.math("MULTIPLY", grain, 0.3), t.math("MULTIPLY", stitch, 0.15))
        return {"color": base, "rough": rgh, "metal": 0.0, "normal": t.bump(h, 0.25, 0.0005), "ao": t.ao(0.012, 16)}

    set_mat(ob, material("ball_leather", leather))
    return ob, {"origin": "centre (the ball entity / projectile pivot)", "size": 1024,
                "note": "size-5 football (0.22 m): classic 32-panel truncated icosahedron, black pentagons / white "
                        "hexagons, stitched seam grooves, pebble grain, scuffs"}


def card_mesh(bm, cell_face, cell_back, M, uvl, W=0.0635, H=0.0889, T=0.0005, r=0.0035, seg=6):
    out = []
    for cx, cz, a0 in ((W / 2 - r, H / 2 - r, 0), (-W / 2 + r, H / 2 - r, 90), (-W / 2 + r, -H / 2 + r, 180),
                       (W / 2 - r, -H / 2 + r, 270)):
        for s in range(seg + 1):
            a = RAD(a0 + 90.0 * s / seg)
            out.append((cx + r * math.cos(a), cz + r * math.sin(a)))
    front = [bm.verts.new(M @ Vector((x, -T / 2, z))) for x, z in out]
    back = [bm.verts.new(M @ Vector((x, T / 2, z))) for x, z in out]
    ff = bm.faces.new(front[::-1])
    fb = bm.faces.new(back)
    side = []
    n = len(out)
    for i in range(n):
        j = (i + 1) % n
        side.append(bm.faces.new((front[i], front[j], back[j], back[i])))

    def uv_of(x, z, cell, mirror):
        u0, v0, u1, v1 = cell
        fx = (x + W / 2) / W
        if mirror:
            fx = 1.0 - fx
        return (u0 + fx * (u1 - u0), v0 + (z + H / 2) / H * (v1 - v0))

    for f, cell, mirror in ((ff, cell_face, False), (fb, cell_back, True)):
        for lp in f.loops:
            p = M.inverted() @ lp.vert.co
            lp[uvl].uv = uv_of(p.x, p.z, cell, mirror)
    for f in side:
        for lp in f.loops:
            lp[uvl].uv = (0.012, 0.012)
    return [ff, fb] + side


def card_material(ctx, name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    t = NT(m)
    for n in list(t.n):
        t.n.remove(n)
    out = t.new("ShaderNodeOutputMaterial")
    bs = t.new("ShaderNodeBsdfPrincipled")
    uv = t.new("ShaderNodeUVMap", uv_map="UVMap").outputs["UV"]
    tex = ctx["tex"]
    col = t.new("ShaderNodeTexImage", image=bpy.data.images.load(os.path.join(tex, "card_atlas.png"), check_existing=True))
    t.l.new(uv, col.inputs["Vector"])
    t.l.new(col.outputs["Color"], bs.inputs["Base Color"])
    orm_img = bpy.data.images.load(os.path.join(tex, "card_orm.png"), check_existing=True)
    orm_img.colorspace_settings.name = "Non-Color"
    orm = t.new("ShaderNodeTexImage", image=orm_img)
    t.l.new(uv, orm.inputs["Vector"])
    sep = t.new("ShaderNodeSeparateColor")
    t.l.new(orm.outputs["Color"], sep.inputs["Color"])
    t.l.new(sep.outputs["Green"], bs.inputs["Roughness"])
    t.l.new(sep.outputs["Blue"], bs.inputs["Metallic"])
    nimg = bpy.data.images.load(os.path.join(tex, "card_normal.png"), check_existing=True)
    nimg.colorspace_settings.name = "Non-Color"
    nrm = t.new("ShaderNodeTexImage", image=nimg)
    t.l.new(uv, nrm.inputs["Vector"])
    nm = t.new("ShaderNodeNormalMap", uv_map="UVMap")
    nm.inputs["Strength"].default_value = 0.35
    t.l.new(nrm.outputs["Color"], nm.inputs["Color"])
    t.l.new(nm.outputs["Normal"], bs.inputs["Normal"])
    t.l.new(bs.outputs["BSDF"], out.inputs["Surface"])
    return m


def prop_card(ctx):
    cells = ctx["decals"]["cards"]
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    card_mesh(bm, cells["A_spade"], cells["back"], Matrix.Identity(4), uvl)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = ob_from_bm(bm, "card")
    set_mat(ob, card_material(ctx, "card_mat"))
    return ob, {"origin": "card centre (also the projectile pivot); face (ace of spades) toward +Z, long side +Y",
                "size": 1024, "baked": False,
                "note": "63.5 x 88.9 mm playing card, rounded corners; original K13 deck art (tools/prop_decals.py)"}


def prop_card_fan(ctx):
    cells = ctx["decals"]["cards"]
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    order = ["A_spade", "A_heart", "show13", "A_club", "A_diamond"]
    for i, k in enumerate(order):
        ang = RAD(34 - 17 * i)
        # pivot 12 mm above the card's bottom edge; each card 0.7 mm nearer the viewer (+Z glTF = -Y Blender)
        M = Matrix.Translation((0.0, -0.0007 * i, 0.0)) @ Matrix.Rotation(-ang, 4, "Y") @ Matrix.Translation((0.0, 0.0, 0.0889 / 2 - 0.012))
        card_mesh(bm, cells[k], cells["back"], M, uvl)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = ob_from_bm(bm, "card_fan")
    set_mat(ob, card_material(ctx, "card_fan_mat"))
    return ob, {"origin": "the fan pivot (thumb pinch), cards spread toward +Y, faces toward +Z", "size": 1024,
                "baked": False, "note": "five-card fan: A spade, A heart, the show's 13, A club, A diamond"}


def prop_riot_shield(ctx):
    # plate outline (flat, Blender X width x Z height), then bent around Z (convex toward the front = Blender -Y)
    Wd, Ht, rc, Rb, T = 0.52, 0.92, 0.065, 0.85, 0.0065
    pts = []
    for cx, cz, a0 in ((Wd / 2 - rc, Ht / 2 - rc, 0), (-Wd / 2 + rc, Ht / 2 - rc, 90), (-Wd / 2 + rc, -Ht / 2 + rc, 180),
                       (Wd / 2 - rc, -Ht / 2 + rc, 270)):
        for s in range(9):
            a = RAD(a0 + 90.0 * s / 8)
            pts.append((cx + rc * math.cos(a), cz + rc * math.sin(a)))
    # densify straight runs so the bend and the rim tube stay smooth
    dense = []
    for i in range(len(pts)):
        a, b = Vector(pts[i]), Vector(pts[(i + 1) % len(pts)])
        n = max(1, int((b - a).length / 0.03))
        for k in range(n):
            p = a + (b - a) * (k / n)
            dense.append((p.x, p.y))
    bm = bmesh.new()
    vs = [bm.verts.new((x, 0.0, z)) for x, z in dense]
    face = bm.faces.new(vs)
    for k in range(1, 22):
        x = -Wd / 2 + Wd * k / 22.0
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-6, plane_co=(x, 0, 0),
                               plane_no=(1, 0, 0))
    for k in range(1, 30):
        z = -Ht / 2 + Ht * k / 30.0
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-6, plane_co=(0, 0, z),
                               plane_no=(0, 0, 1))
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm.faces.ensure_lookup_table()
    for f in bm.faces:
        f.normal_update()
    if bm.faces[0].normal.y > 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)

    def bend(v):
        a = v.x / Rb
        return Vector((Rb * math.sin(a), v.y + Rb * (1.0 - math.cos(a)), v.z))

    for v in bm.verts:
        v.co = bend(v.co)
    plate = ob_from_bm(bm, "plate")
    sol = plate.modifiers.new("sol", "SOLIDIFY")
    sol.thickness = T
    sol.offset = -1.0          # the shell grows toward the back (+Y); the front stays on the bent surface
    sol.use_even_offset = True
    apply_mods(plate)
    bevel(plate, 0.0016, 2, 60.0)
    smooth(plate, 35.0)
    # rubber rim bumper: a tube swept along the (bent) outline
    cu = bpy.data.curves.new("rim", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = 0.0068
    cu.bevel_resolution = 1
    cu.resolution_u = 1
    sp = cu.splines.new("POLY")
    sp.points.add(len(dense) - 1)
    for p, (x, z) in zip(sp.points, dense):
        q = bend(Vector((x, 0.0, z)))
        p.co = (q.x, q.y + T * 0.5, q.z, 1.0)
    sp.use_cyclic_u = True
    rim_ob = link(bpy.data.objects.new("rim", cu))
    select_only([rim_ob])
    bpy.ops.object.convert(target="MESH")
    rim = bpy.context.view_layer.objects.active
    smooth(rim, 70.0)
    # back hardware: vertical D-handle (bar + two standoffs), forearm strap, front bolt heads
    hx = -0.075              # handle x (the plate centre sits 0.075 m toward +X = toward the elbow)
    back_y = lambda x: Rb * (1.0 - math.cos(x / Rb)) + T
    bar = cyl("bar", 0.0145, 0.12, 20, Matrix.Translation((hx, back_y(hx) + 0.066, 0.0)))
    bevel(bar, 0.003, 2, 35.0)
    stand = []
    for sz in (-1, 1):
        s = box("stand%d" % sz, (0.026, 0.07, 0.022), (hx, back_y(hx) + 0.036, sz * 0.071))
        bevel(s, 0.0045, 3, 35.0)
        stand.append(s)
    sx = hx + 0.19
    strap = box("strap", (0.05, 0.0045, 0.15), (sx, back_y(sx) + 0.058, 0.02))
    bevel(strap, 0.0018, 2, 35.0)
    posts = []
    for sz in (-1, 1):
        p = box("post%d" % sz, (0.05, 0.058, 0.014), (sx, back_y(sx) + 0.029, 0.02 + sz * 0.082))
        bevel(p, 0.003, 2, 35.0)
        posts.append(p)
    bolts = []
    for (x, z) in ((hx, 0.071), (hx, -0.071), (sx, 0.102), (sx, -0.062)):
        y = Rb * (1.0 - math.cos(x / Rb)) - 0.0005
        b = lathe("bolt", [(0.0, -0.0032), (0.0058, -0.0026), (0.0066, -0.0008), (0.0062, 0.0015), (0.0, 0.0015)], 16)
        transform(b, Matrix.Translation((x, y, z)) @ Matrix.Rotation(RAD(90), 4, "X"))
        bolts.append(b)
    for o in [bar, strap] + stand + posts + bolts:
        smooth(o, 40.0)
    text_path = os.path.join(ctx["tex"], "shield_text.png")

    def plate_m(t):
        P = t.co()
        X, Y, Z = t.xyz()
        nY = t.xyz(t.geo("Normal"))[1]
        front = t.mr(nY, -0.3, -0.6)
        s = m_paint(t, (0.04, 0.043, 0.05), 0.3, 0.0, (0.2, 0.21, 0.23), 0.35, 320.0, 0.0012, 0.25)
        scr = t.math("MULTIPLY", t.mr(t.noise(t.scale(P, (40.0, 1.0, 900.0)), 1.0, 2.0), 0.7, 0.74),
                     t.mr(t.noise(P, 6.0), 0.45, 0.6))
        # smoked viewport window near the top
        win = t.math("MULTIPLY", t.math("MULTIPLY", t.between(X, -0.16, 0.16, 0.004), t.between(Z, 0.24, 0.35, 0.004)), front)
        col = t.mixc(win, s["color"], (0.006, 0.007, 0.01))
        # 'K13 SECURITY' (object-space projection, front faces only): 0.40 x 0.075 m centred at z 0.13
        uv = t.vec(t.math("ADD", t.math("DIVIDE", X, 0.44), 0.5), t.math("ADD", t.math("DIVIDE", t.math("SUBTRACT", Z, 0.13), 0.0825), 0.5), 0.0)
        ink = t.math("MULTIPLY", t.image(text_path, uv, "CLIP", out="Alpha"), front)
        chip = t.mr(t.noise(P, 70.0, 5.0, 0.6), 0.3, 0.36)
        ink = t.math("MULTIPLY", ink, chip)
        col = t.mixc(ink, col, (0.86, 0.86, 0.84))
        col = t.mixc(t.math("MULTIPLY", scr, 0.5), col, (0.22, 0.22, 0.24))
        grime = t.math("MULTIPLY", t.mr(Z, -0.18, -0.46), t.mr(t.noise(P, 14.0, 5.0, 0.6), 0.35, 0.65))
        col = t.mixc(t.math("MULTIPLY", grime, 0.7), col, (0.09, 0.075, 0.06))
        rgh = t.mixf(win, s["rough"], 0.05)
        rgh = t.mixf(grime, rgh, 0.7)
        rgh = t.mixf(ink, rgh, 0.45)
        rgh = t.mixf(scr, rgh, 0.55)
        wedge = t.math("MULTIPLY", t.math("MULTIPLY", t.edge(0.004, 8.0), win), 1.0)
        h = t.math("ADD", t.math("MULTIPLY", scr, -0.3), t.math("MULTIPLY", ink, 0.15))
        return {"color": col, "rough": rgh, "metal": 0.0, "normal": t.bump(h, 0.2, 0.0004, s["normal"])}

    def strap_m(t):
        P = t.co()
        web = t.wave(t.scale(P, (1.0, 1.0, 1.0)), 900.0, 0.0, 0.0, "X")
        return m_rubber(t, (0.03, 0.03, 0.032), 0.8, t.math("MULTIPLY", web, 0.4), 0.3)

    set_mat(plate, material("shield_plate", plate_m))
    set_mat(rim, material("shield_rim", lambda t: m_rubber(t, (0.025, 0.025, 0.027), 0.8)))
    set_mat(strap, material("shield_strap", strap_m))
    steel = material("shield_steel", lambda t: m_steel(t, (0.5, 0.5, 0.52), 0.35, "Z", 0.35))
    for o in [bar] + stand + posts + bolts:
        set_mat(o, steel)
    set_mat(bar, bpy.data.materials["shield_rim"])
    ob = join([plate, rim, bar, strap] + stand + posts + bolts, "riot_shield")
    # origin = the handle bar centre (the fist)
    transform(ob, Matrix.Translation((-hx, -(back_y(hx) + 0.066), 0.0)))
    weighted_normals(ob)
    return ob, {"origin": "the D-handle bar (fist) centre; plate front toward +Z (0.07 m ahead of the bar), long axis +Y, "
                          "plate centre 0.075 m toward +X (the elbow side)", "size": 1024,
                "note": "0.92 x 0.52 m curved riot shield, charcoal composite, smoked viewport, plain 'K13 SECURITY' "
                        "(never POLICE), rubber rim, D-handle + forearm strap, bolt heads"}


PROPS = {"brick": prop_brick, "riot_shield": prop_riot_shield, "baton": prop_baton, "cleaver": prop_cleaver,
         "gourd": prop_gourd, "football": prop_football, "card": prop_card, "card_fan": prop_card_fan,
         "mic_cane": prop_mic_cane, "taser": prop_taser, "spotlight": prop_spotlight}


def main():
    job = json.load(open(sys.argv[sys.argv.index("--") + 1], encoding="utf-8"))
    out_dir = job["out_dir"]
    os.makedirs(out_dir, exist_ok=True)
    ctx = {"tex": job["tex_dir"], "decals": json.load(open(os.path.join(job["tex_dir"], "decals.json"), encoding="utf-8"))}
    want = job.get("props") or list(PROPS)
    rp = os.path.join(out_dir, "props_build.json")
    report = json.load(open(rp, encoding="utf-8")) if os.path.exists(rp) else {}
    for pid in want:
        t0 = time.time()
        try:
            reset()
            SPECS.clear()
            ob, meta = PROPS[pid](ctx)
            ob.name = pid
            baked = meta.pop("baked", True)
            size = meta.pop("size", 1024)
            attach = meta.pop("attach", "solve")
            if baked:
                meta["uv"] = unwrap(ob)
                imgs, paths, bstats = bake(ob, pid, size, out_dir, job.get("fast", False))
                mat = final_material(pid, imgs)
                ob.data.materials.clear()
                ob.data.materials.append(mat)
                for p in ob.data.polygons:
                    p.material_index = 0
            else:
                paths, bstats = {}, {"size": size, "atlas": "card_atlas.png"}
            extras = {"id": pid, "frame": "origin = grip; +Y business end; +Z edge / face / barrel", "units": "m"}
            extras.update(meta)
            path = os.path.join(out_dir, pid + ".raw.glb")
            export(ob, path, extras)
            report[pid] = {"ok": True, "tris": tris(ob), "verts": len(ob.data.vertices), "bounds": dims(ob),
                           "textures": paths, "bake": bstats, "raw_bytes": os.path.getsize(path),
                           "attach": attach, "meta": meta, "secs": round(time.time() - t0, 1)}
            log("OK", pid, "tris", report[pid]["tris"], "bounds", report[pid]["bounds"], "%.1fs" % (time.time() - t0))
        except Exception as ex:  # noqa
            report[pid] = {"ok": False, "error": repr(ex), "trace": traceback.format_exc()}
            log("FAILED", pid, repr(ex))
            traceback.print_exc()
        with open(rp, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(report, fh, indent=1)
    log("DONE", sum(1 for p in want if report.get(p, {}).get("ok")), "/", len(want))


if __name__ == "__main__":
    try:
        main()
    except Exception:  # noqa
        traceback.print_exc()
        sys.exit(1)
