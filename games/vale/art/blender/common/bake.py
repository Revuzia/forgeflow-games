"""UV layout + Cycles bakes into one PBR texture set per asset, then glTF-ready materials.

Flow (bake_asset):
  1. `low` is ONE joined game mesh whose vertices carry an int `vale_part` attribute; `highs`
     maps part id -> bake-source objects (organic sculpt, or the hard-surface part itself).
  2. UV: smart project (per-part islands), per-part texel weights, concave island packing.
  3. EXPLODED selected-to-active bakes: every part's low vertices and its bake sources are
     moved `EXPLODE` metres apart along X so rays can never pick up a neighbouring part. The
     sources are copied into ONE joined object (Blender tests every pixel against every selected
     object, so one object is ~4x faster than dozens) whose original object-space positions are
     stored in the `vale_obj` attribute; materials read it (materials.G.obj), so procedural
     textures and the value gradient do not move.
       base colour  EMIT (Principled Base Color re-routed to an Emission shader)
       rough+metal  EMIT, roughness in R and metallic in G of one pass
       normal       tangent-space NORMAL (high sculpt -> low, material bump included)
  4. AO on the assembled (un-exploded) low mesh: real inter-part occlusion (pauldron over arm).
  5. ORM = (AO, roughness, metallic) packed with numpy; base colour saved as JPEG q90, ORM and
     normal as PNG (lossless data maps).
  6. The low gets one material (`body` by default): Principled with the baked images +
     `glTF Material Output` occlusion hookup, which the Blender glTF exporter understands.

Time budget: < 3 min per fighter on 4 CPUs at 1024² (see README for measured numbers).
"""
from __future__ import annotations

import os
import time

import bmesh
import bpy
import numpy as np
from mathutils import Vector

from . import materials, scene

EXPLODE = 6.0                 # metres between parts during bakes


# ── UVs ──────────────────────────────────────────────────────────────────────────────────────────
def unwrap(obj, angle: float = 62.0, margin: float = 0.0035, weights: dict | None = None,
           method: str = "smart") -> None:
    """Smart-project islands, scale per part by `weights` {part_id: texel weight}, pack (concave)."""
    scene.select_only([obj], obj)
    if not obj.data.uv_layers:
        obj.data.uv_layers.new(name="UVMap")
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.reveal()
    bpy.ops.mesh.select_all(action="SELECT")
    if method == "smart":
        bpy.ops.uv.smart_project(**scene.op_kwargs(bpy.ops.uv.smart_project, angle_limit=float(np.radians(angle)),
                                                   island_margin=0.0, area_weight=0.0, correct_aspect=True,
                                                   scale_to_bounds=False))
    else:
        bpy.ops.uv.lightmap_pack(PREF_CONTEXT="ALL_FACES", PREF_PACK_IN_ONE=True, PREF_MARGIN_DIV=0.2)
    bpy.ops.object.mode_set(mode="OBJECT")
    if weights:
        _scale_parts(obj, weights)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(**scene.op_kwargs(bpy.ops.uv.pack_islands, udim_source="CLOSEST_UDIM", rotate=True,
                                              rotate_method="ANY", scale=True, merge_overlap=False,
                                              margin_method="FRACTION", margin=margin, pin=False,
                                              shape_method="CONCAVE"))
    bpy.ops.object.mode_set(mode="OBJECT")


def _scale_parts(obj, weights: dict) -> None:
    me = obj.data
    part = me.attributes.get("vale_part")
    if part is None:
        return
    pv = [0] * len(me.vertices)
    part.data.foreach_get("value", pv)
    uv = me.uv_layers.active.data
    by_part: dict[int, list[int]] = {}
    for poly in me.polygons:
        p = pv[poly.vertices[0]]
        by_part.setdefault(p, []).extend(poly.loop_indices)
    for p, loops in by_part.items():
        w = weights.get(p, 1.0)
        if abs(w - 1.0) < 1e-3:
            continue
        s = w ** 0.5
        cx = sum(uv[i].uv.x for i in loops) / len(loops)
        cy = sum(uv[i].uv.y for i in loops) / len(loops)
        for i in loops:
            u = uv[i].uv
            uv[i].uv = (cx + (u.x - cx) * s, cy + (u.y - cy) * s)


def uv_coverage(obj, res: int = 256) -> float:
    """Fraction of the 0..1 UV square covered by faces (rough packing efficiency)."""
    me = obj.data
    uv = me.uv_layers.active.data
    grid = np.zeros((res, res), dtype=bool)
    for poly in me.polygons:
        pts = [uv[i].uv for i in poly.loop_indices]
        xs = [p.x for p in pts]
        ys = [p.y for p in pts]
        x0, x1 = int(max(0, min(xs)) * res), int(min(1, max(xs)) * res)
        y0, y1 = int(max(0, min(ys)) * res), int(min(1, max(ys)) * res)
        grid[y0:y1 + 1, x0:x1 + 1] = True
    return float(grid.mean())


# ── material re-routing for EMIT bakes ─────────────────────────────────────────────────────────
class _Route:
    """Temporarily route a Principled input into an Emission shader on every given material."""

    def __init__(self, mats, socket_name):
        self.saved = []
        self.extra = []
        for m in mats:
            if not m or not m.use_nodes:
                continue
            nt = m.node_tree
            bsdf = nt.nodes.get("BSDF") or next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
            out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output), None) \
                or next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
            if bsdf is None or out is None:
                continue
            em = nt.nodes.new("ShaderNodeEmission")
            em.name = "_bake_emit"
            em.inputs["Strength"].default_value = 1.0
            names = socket_name if isinstance(socket_name, tuple) else (socket_name,)
            if len(names) == 1:
                self._feed(nt, bsdf.inputs[names[0]], em.inputs["Color"])
            else:                                  # pack float inputs into R, G (, B)
                cc = nt.nodes.new("ShaderNodeCombineColor")
                cc.name = "_bake_pack"
                for i, nm in enumerate(names[:3]):
                    self._feed(nt, bsdf.inputs[nm], cc.inputs[i])
                nt.links.new(cc.outputs["Color"], em.inputs["Color"])
                self.extra.append((nt, cc))
            prev = out.inputs["Surface"].links[0].from_socket if out.inputs["Surface"].is_linked else None
            nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
            self.saved.append((nt, em, out, prev))

    @staticmethod
    def _feed(nt, src, dst):
        if src.is_linked:
            nt.links.new(src.links[0].from_socket, dst)
        else:
            v = src.default_value
            if dst.type == "RGBA":
                dst.default_value = (v, v, v, 1.0) if isinstance(v, float) else tuple(v)
            else:
                dst.default_value = v if isinstance(v, float) else v[0]

    def restore(self):
        for nt, n in self.extra:
            nt.nodes.remove(n)
        for nt, em, out, prev in self.saved:
            if prev is not None:
                nt.links.new(prev, out.inputs["Surface"])
            nt.nodes.remove(em)


# ── images ─────────────────────────────────────────────────────────────────────────────────────
def new_image(name: str, size: int, data: bool, color=(0.5, 0.5, 0.5, 1.0)) -> bpy.types.Image:
    old = bpy.data.images.get(name)
    if old:
        bpy.data.images.remove(old)
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = "Non-Color" if data else "sRGB"
    img.generated_color = color
    return img


def image_array(img) -> np.ndarray:
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def set_image_array(img, arr: np.ndarray) -> None:
    img.pixels.foreach_set(arr.astype(np.float32).ravel())
    img.update()


def save_image(img, path: str, fmt: str = "PNG", quality: int = 90) -> str:
    scene.ensure_dir(os.path.dirname(path))
    img.filepath_raw = path
    img.file_format = fmt
    if fmt == "PNG":
        img.alpha_mode = "NONE"
    img.save(filepath=path, quality=quality)
    return path


# ── the bake ───────────────────────────────────────────────────────────────────────────────────
def _setup_cycles(samples: int):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.cycles.use_adaptive_sampling = False
    sc.render.bake.margin = 8
    sc.render.bake.margin_type = "EXTEND"
    sc.render.bake.use_clear = True
    sc.render.bake.target = "IMAGE_TEXTURES"


def _target_material(name: str):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.name = "BSDF"
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.name = "_bake_target"
    nt.nodes.active = tex
    return m, tex


def _explode_low(low, slot: dict, sign: float) -> None:
    me = low.data
    pv = [0] * len(me.vertices)
    me.attributes["vale_part"].data.foreach_get("value", pv)
    co = np.empty(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    co[:, 0] += np.array([slot.get(p, 0) * EXPLODE * sign for p in pv], dtype=np.float32)
    me.vertices.foreach_set("co", co.ravel())
    me.update()


def _joined_high(highs: dict, slot: dict, col) -> bpy.types.Object:
    """One exploded bake-source object: every high copied with transforms applied, its original
    object-space positions stored in `vale_obj` (+ `vale_has` = 1) so the materials' procedural
    textures do not move, then shifted to its part's slot and joined. One object keeps
    selected-to-active cheap (Blender casts each pixel against every selected object)."""
    bm_all = bmesh.new()
    mats: list = []
    for p, objs in highs.items():
        for o in objs:
            me = o.data
            n = len(me.vertices)
            loc = np.empty(n * 3, dtype=np.float32)
            me.vertices.foreach_get("co", loc)
            tmp = me.copy()
            for name, typ, dom in (("vale_obj", "FLOAT_VECTOR", "POINT"), ("vale_has", "FLOAT", "POINT")):
                if tmp.attributes.get(name):
                    tmp.attributes.remove(tmp.attributes[name])
                tmp.attributes.new(name, typ, dom)
            tmp.attributes["vale_obj"].data.foreach_set("vector", loc)
            tmp.attributes["vale_has"].data.foreach_set("value", np.ones(n, dtype=np.float32))
            m = o.matrix_world.copy()
            m.translation.x += slot[p] * EXPLODE
            tmp.transform(m)
            # remap material indices into the joined slot list
            local = [s.material for s in o.material_slots]
            for mt in local:
                if mt not in mats:
                    mats.append(mt)
            if local:
                idx = np.empty(len(tmp.polygons), dtype=np.int32)
                tmp.polygons.foreach_get("material_index", idx)
                remap = np.array([mats.index(mt) for mt in local], dtype=np.int32)
                tmp.polygons.foreach_set("material_index", remap[np.clip(idx, 0, len(local) - 1)])
            bm_all.from_mesh(tmp)
            bpy.data.meshes.remove(tmp)
    me = bpy.data.meshes.new("_bake_high")
    bm_all.to_mesh(me)
    bm_all.free()
    for mt in mats:
        me.materials.append(mt)
    ob = bpy.data.objects.new("_bake_high", me)
    col.objects.link(ob)
    return ob


def bake_asset(low, highs: dict, out_dir: str, name: str = "body", size: int = 1024, samples: int = 4,
               ao_samples: int = 48, ao_distance: float = 0.25, ao_lift: float = 0.25, cage: float = 0.012,
               ray: float = 0.05, mat_name: str = "body", fast: bool = False, ao_extra=(),
               base_quality: int = 90, ao_into_base: float = 0.0) -> dict:
    """Bake `highs` ({part: [objects]}) onto `low` into `<out_dir>/<name>_{base,orm,normal}`.
    `ao_into_base` (bible: 0.6, tokens.json fighter.bakeIntoBaseColor.aoStrength) multiplies the
    whole-body AO into the base colour (painted occlusion that survives direct light; three's
    aoMap only darkens indirect light); the ORM occlusion channel is then lifted so the two do not
    double up. Returns {'material', 'images': {kind: path}, 'timings': {...}}."""
    t0 = time.perf_counter()
    T = {}
    if fast:
        samples, ao_samples = 1, 8
    _setup_cycles(samples)
    sc = bpy.context.scene
    base = new_image(f"{name}_base", size, False)
    rough = new_image(f"{name}_rough", size, True)          # R = roughness, G = metallic
    normal = new_image(f"{name}_normal", size, True, (0.5, 0.5, 1.0, 1.0))
    ao = new_image(f"{name}_ao", size, True, (1, 1, 1, 1))
    tmat, tex = _target_material("_bake_target")
    low.data.materials.clear()
    low.data.materials.append(tmat)
    all_high = [o for objs in highs.values() for o in objs]
    src_mats = {s.material for o in all_high for s in o.material_slots if s.material}
    # visibility: only low + highs participate
    others = [o for o in sc.objects if o not in all_high and o != low and o.type in ("MESH", "CURVE")]
    vis = {o: o.hide_render for o in sc.objects}
    for o in others:
        o.hide_render = True
    for o in all_high:
        o.hide_render = False
    low.hide_render = False
    arm_mods = []
    for o in [low] + all_high:
        for m in o.modifiers:
            if m.type == "ARMATURE" and m.show_render:
                m.show_render = False
                arm_mods.append(m)
    order = sorted(highs)
    slot = {p: i for i, p in enumerate(order)}
    hi = _joined_high(highs, slot, sc.collection)
    hi.hide_render = False
    for o in all_high:
        o.hide_render = True
    _explode_low(low, slot, +1.0)
    try:
        scene.select_only([hi, low], low)
        bk = sc.render.bake
        bk.use_selected_to_active = True
        bk.use_cage = False
        bk.cage_extrusion = cage
        bk.max_ray_distance = ray
        for kind, img, sock in (("base", base, "Base Color"), ("rough_metal", rough, ("Roughness", "Metallic"))):
            t = time.perf_counter()
            tex.image = img
            r = _Route(src_mats, sock)
            try:
                bpy.ops.object.bake(type="EMIT", use_selected_to_active=True, cage_extrusion=cage,
                                    max_ray_distance=ray, margin=8, use_clear=True)
            finally:
                r.restore()
            T[kind] = round(time.perf_counter() - t, 2)
        t = time.perf_counter()
        tex.image = normal
        bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT", use_selected_to_active=True,
                            cage_extrusion=cage, max_ray_distance=ray, margin=8, use_clear=True)
        T["normal"] = round(time.perf_counter() - t, 2)
    finally:
        _explode_low(low, slot, -1.0)
        me = hi.data
        bpy.data.objects.remove(hi, do_unlink=True)
        bpy.data.meshes.remove(me)
    # AO on the assembled low (+ ao_extra, e.g. the accent mesh); highs hidden
    t = time.perf_counter()
    for o in sc.objects:
        o.hide_render = not (o == low or o in ao_extra)
    sc.cycles.samples = ao_samples
    if sc.world is None:
        sc.world = bpy.data.worlds.new("bake_world")
    sc.world.light_settings.distance = ao_distance
    tex.image = ao
    scene.select_only([low], low)
    bpy.ops.object.bake(type="AO", use_selected_to_active=False, margin=8, use_clear=True)
    T["ao"] = round(time.perf_counter() - t, 2)
    for o, h in vis.items():
        o.hide_render = h
    for m in arm_mods:
        m.show_render = True
    # pack + save
    t = time.perf_counter()
    # tangent normals tilted > ~70° are ray misses on tiny islands (rim walls, bevel strips) where the
    # cage ray grazes the neighbouring face: no surface here legitimately bends that far -> flat
    nrm = image_array(normal)
    nz = nrm[..., 2] * 2.0 - 1.0
    bad = nz < 0.34
    T["normal_fixed_px"] = int(bad.sum())
    if bad.any():
        nrm[bad] = (0.5, 0.5, 1.0, 1.0)
        set_image_array(normal, nrm)
    a = image_array(ao)[..., 0]
    if ao_into_base > 0:
        # soft painted occlusion: AO is eased (a^0.8) so creases darken but broad forms keep their colour
        b = image_array(base)
        k = (1.0 - ao_into_base) + ao_into_base * np.power(np.clip(a, 0, 1), 0.8)
        b[..., :3] *= k[..., None]
        set_image_array(base, b)
        ao_lift = max(ao_lift, 0.55)
    a = ao_lift + (1.0 - ao_lift) * a
    rm = image_array(rough)
    orm_arr = np.stack([a, rm[..., 0], rm[..., 1], np.ones_like(a)], axis=-1)
    orm = new_image(f"{name}_orm", size, True)
    set_image_array(orm, orm_arr)
    paths = {
        "base": save_image(base, os.path.join(out_dir, f"{name}_base.jpg"), "JPEG", base_quality),
        "orm": save_image(orm, os.path.join(out_dir, f"{name}_orm.png"), "PNG"),
        "normal": save_image(normal, os.path.join(out_dir, f"{name}_normal.png"), "PNG"),
    }
    for img in (rough, ao):
        bpy.data.images.remove(img)
    T["pack_save"] = round(time.perf_counter() - t, 2)
    mat = gltf_material(mat_name, paths)
    low.data.materials.clear()
    low.data.materials.append(mat)
    bpy.data.materials.remove(tmat)
    T["total"] = round(time.perf_counter() - t0, 2)
    scene.log(f"bake {name} {size}²: {T}")
    return {"material": mat, "images": paths, "timings": T}


def _gltf_output_group():
    ng = bpy.data.node_groups.get("glTF Material Output")
    if ng is None:
        ng = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
        ng.interface.new_socket("Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
        ng.interface.new_socket("Thickness", in_out="INPUT", socket_type="NodeSocketFloat")
    return ng


def gltf_material(name: str, paths: dict) -> bpy.types.Material:
    """Principled material wired to baked images the way the glTF exporter expects:
    base colour texture, ORM (R = occlusion via 'glTF Material Output', G = roughness,
    B = metallic) and a tangent-space normal map."""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (600, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.name = "BSDF"
    bsdf.location = (300, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    def tex(path, data, loc):
        img = bpy.data.images.load(path, check_existing=True)
        img.colorspace_settings.name = "Non-Color" if data else "sRGB"
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = img
        n.location = loc
        return n

    b = tex(paths["base"], False, (-400, 300))
    nt.links.new(b.outputs["Color"], bsdf.inputs["Base Color"])
    o = tex(paths["orm"], True, (-600, 0))
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    sep.location = (-300, 0)
    nt.links.new(o.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    grp = nt.nodes.new("ShaderNodeGroup")
    grp.node_tree = _gltf_output_group()
    grp.location = (300, -400)
    nt.links.new(sep.outputs["Red"], grp.inputs["Occlusion"])
    n = tex(paths["normal"], True, (-400, -300))
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nm.space = "TANGENT"
    nm.location = (-100, -300)
    nt.links.new(n.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def strip_procedural(mat) -> None:
    """Reduce a kept (unbaked) material to factor-only Principled values the exporter maps 1:1."""
    if not mat.use_nodes:
        return
    bsdf = mat.node_tree.nodes.get("BSDF")
    if bsdf is None:
        return
    for sock in ("Base Color", "Roughness", "Metallic", "Emission Color", "Emission Strength"):
        s = bsdf.inputs[sock]
        while s.is_linked:
            mat.node_tree.links.remove(s.links[0])
