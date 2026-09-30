"""HIT PARADE asset pipeline - body preparation (lane ASSETS, CONTRACT section 6.1).

prepare_body(cfg, work_dir) takes a Mixamo character FBX to a game-ready rig:
  1. import, pick the main armature, rename bone prefix /^mixamorig\\d*:/ -> 'mixamorig:'
  2. drop the character's own T-pose action (TECH_REUSE E46) and every EMPTY
  3. remove prop meshes (cfg['hide'] regexes; Brute 'BattleAxe_GEO')
  4. ATLAS: every kept material's albedo (+ alpha) is re-baked (Cycles EMIT) into ONE
     square albedo atlas (default 1024) on a new packed UV layout. Islands are pre-scaled by
     their source texture's resolution so the artist's texel-density choices survive the pack.
     Specular / roughness / normal maps are dropped (CONTRACT 6.1: "one 1024 albedo + normal
     max; drop specular/gloss"). Faces whose source material fed the BSDF Alpha become the
     '<id>_cutout' material (alpha clip, glTF alphaMode MASK); all others '<id>_skin'.
  5. join all meshes into one object '<id>_body' (2 primitives max)
  6. apply the FBX object transforms (rot 90 / scale 0.01) and normalise the rest height to
     cfg['heightM'] with the lowest rest vertex on z = 0.
Returns a dict of body facts. ASCII only.
"""
import math
import os
import re

import bpy
import numpy as np
from mathutils import Matrix, Vector

import hp_common as C


def _albedo_and_alpha(mat):
    """(albedo image node or None, base colour rgba, alpha source (node, socket) or None)."""
    alb, base, alpha = None, (0.8, 0.8, 0.8, 1.0), None
    if not mat or not mat.node_tree:
        return alb, base, alpha
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        return alb, base, alpha
    bc = bsdf.inputs["Base Color"]
    base = tuple(bc.default_value)
    for l in bc.links:
        if l.from_node.type == "TEX_IMAGE" and l.from_node.image is not None:
            alb = l.from_node
    al = bsdf.inputs["Alpha"]
    for l in al.links:
        if l.from_node.type == "TEX_IMAGE" and l.from_node.image is not None:
            alpha = (l.from_node, l.from_socket.name)
    return alb, base, alpha


def _render_uv_name(me):
    for uv in me.uv_layers:
        if uv.active_render:
            return uv.name
    return me.uv_layers[0].name if me.uv_layers else None


def _select_only(objs, active=None):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or (objs[0] if objs else None)


def bake_atlas(meshes, fighter_id, work_dir, size=1024):
    """Re-bake all albedo (+alpha) into one atlas on a new 'atlas' UV layer. Returns info dict."""
    scn = bpy.context.scene
    mats = []
    for o in meshes:
        for m in o.data.materials:
            if m is not None and m not in mats:
                mats.append(m)
    minfo = {}
    maxres = 1
    for m in mats:
        alb, base, alpha = _albedo_and_alpha(m)
        res = max(alb.image.size) if alb is not None else 0
        maxres = max(maxres, res)
        minfo[m.name] = {"alb": alb, "base": base, "alpha": alpha, "res": res}
    # linear pre-scale per material: texel density relative to the largest source texture
    for m in mats:
        r = minfo[m.name]["res"]
        minfo[m.name]["scale"] = (r / float(maxres)) if r > 0 else 0.04
    C.log("atlas materials:", [(m.name, minfo[m.name]["res"], round(minfo[m.name]["scale"], 3),
                                "alpha" if minfo[m.name]["alpha"] else "") for m in mats])

    # 1. new UV layer 'atlas' from each mesh's render UV, islands pre-scaled + offset per material
    src_uv = {}
    for o in meshes:
        me = o.data
        rn = _render_uv_name(me)
        src_uv[o.name] = rn
        me.uv_layers.active = me.uv_layers[rn]
        lay = me.uv_layers.new(name="atlas", do_init=True)
        uv = lay.data
        for p in me.polygons:
            m = me.materials[p.material_index] if p.material_index < len(me.materials) else None
            mi = mats.index(m) if m in mats else 0
            s = minfo[m.name]["scale"] if m is not None else 0.04
            off = 1.2 * mi
            for li in p.loop_indices:
                u, v = uv[li].uv
                uv[li].uv = (u * s + off, v * s)
        me.uv_layers.active = lay
    # 2. pack islands (all meshes together in multi-object edit mode)
    _select_only(meshes)
    bpy.ops.object.mode_set(mode="EDIT")
    scn.tool_settings.use_uv_select_sync = True
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, rotate_method="ANY", scale=True,
                            merge_overlap=True, margin_method="SCALED", margin=0.004, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")
    # sanity: packed UVs inside [0,1]
    lo, hi = 9.0, -9.0
    for o in meshes:
        arr = np.zeros(len(o.data.loops) * 2, dtype=np.float32)
        o.data.uv_layers["atlas"].data.foreach_get("uv", arr)
        if len(arr):
            lo, hi = min(lo, float(arr.min())), max(hi, float(arr.max()))
    C.log("packed atlas uv range", round(lo, 4), round(hi, 4))
    if lo < -0.01 or hi > 1.01:
        raise RuntimeError("pack_islands left UVs outside [0,1]: %.3f..%.3f" % (lo, hi))

    # 3. bake targets
    img_rgb = bpy.data.images.new("hp_bake_rgb", size, size, alpha=True, float_buffer=False)
    img_a = bpy.data.images.new("hp_bake_a", size, size, alpha=False, float_buffer=False)
    img_a.colorspace_settings.name = "Non-Color"
    try:
        scn.render.engine = "CYCLES"
    except TypeError as ex:
        raise RuntimeError("Cycles unavailable: %s" % ex)
    scn.cycles.device = "CPU"
    scn.cycles.samples = 1
    try:
        scn.cycles.use_denoising = False
    except Exception:  # noqa
        pass
    rig = {}
    for m in mats:
        nt = m.node_tree
        info = minfo[m.name]
        out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL" and n.is_active_output), None)
        if out is None:
            out = nt.nodes.new("ShaderNodeOutputMaterial")
        emi = nt.nodes.new("ShaderNodeEmission")
        emi.inputs["Strength"].default_value = 1.0
        tgt = nt.nodes.new("ShaderNodeTexImage")
        tgt.image = img_rgb
        tgt.name = "HP_BAKE_TARGET"
        rig[m.name] = {"emi": emi, "tgt": tgt, "out": out}
        # explicit source-UV nodes on every image node we sample
        for key in ("alb",):
            n = info[key]
            if n is not None:
                uvn = nt.nodes.new("ShaderNodeUVMap")
                # all meshes using this material share the same render-UV name in these FBXs;
                # take the first mesh that uses it
                owner = next(o for o in meshes if m.name in [mm.name for mm in o.data.materials if mm])
                uvn.uv_map = src_uv[owner.name]
                nt.links.new(uvn.outputs["UV"], n.inputs["Vector"])
        if info["alpha"] is not None:
            an = info["alpha"][0]
            owner = next(o for o in meshes if m.name in [mm.name for mm in o.data.materials if mm])
            uvn = nt.nodes.new("ShaderNodeUVMap")
            uvn.uv_map = src_uv[owner.name]
            nt.links.new(uvn.outputs["UV"], an.inputs["Vector"])
        nt.links.new(emi.outputs["Emission"], out.inputs["Surface"])
        for n in nt.nodes:
            n.select = False
        tgt.select = True
        nt.nodes.active = tgt

    def set_pass(which):
        for m in mats:
            nt = m.node_tree
            info, r = minfo[m.name], rig[m.name]
            emi = r["emi"]
            for l in list(emi.inputs["Color"].links):
                nt.links.remove(l)
            if which == "rgb":
                r["tgt"].image = img_rgb
                if info["alb"] is not None:
                    nt.links.new(info["alb"].outputs["Color"], emi.inputs["Color"])
                else:
                    emi.inputs["Color"].default_value = info["base"]
            else:
                r["tgt"].image = img_a
                if info["alpha"] is not None:
                    node, sock = info["alpha"]
                    nt.links.new(node.outputs[sock], emi.inputs["Color"])
                else:
                    emi.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)

    _select_only(meshes)
    for which in ("rgb", "a"):
        set_pass(which)
        bpy.ops.object.bake(type="EMIT", margin=6, margin_type="EXTEND", use_clear=True,
                            target="IMAGE_TEXTURES", uv_layer="atlas")
        C.log("baked pass", which)
    px_rgb = np.array(img_rgb.pixels[:], dtype=np.float32).reshape(size, size, 4)
    px_a = np.array(img_a.pixels[:], dtype=np.float32).reshape(size, size, 4)
    comb = px_rgb.copy()
    comb[..., 3] = px_a[..., 0]
    alb = bpy.data.images.new(fighter_id + "_albedo", size, size, alpha=True, float_buffer=False)
    alb.pixels.foreach_set(comb.ravel())
    png = os.path.abspath(os.path.join(work_dir, fighter_id + "_albedo.png")).replace("\\", "/")
    alb.filepath_raw = png
    alb.file_format = "PNG"
    alb.save()
    if not os.path.exists(png):
        scn.render.image_settings.file_format = "PNG"
        scn.render.image_settings.color_mode = "RGBA"
        alb.save_render(png)
    if not os.path.exists(png):
        raise RuntimeError("atlas PNG was not written: " + png)
    alb.pack()
    coverage = float((px_rgb[..., 3] > 0.5).mean()) if px_rgb[..., 3].max() > 0 else None
    info = {"size": size, "materials": {m.name: {"res": minfo[m.name]["res"],
                                                  "scale": round(minfo[m.name]["scale"], 4),
                                                  "cutout": minfo[m.name]["alpha"] is not None}
                                         for m in mats},
            "alpha_min": round(float(px_a[..., 0].min()), 3), "rgb_alpha_coverage": coverage,
            "png": alb.filepath_raw}
    return alb, info, {m.name: (minfo[m.name]["alpha"] is not None) for m in mats}


def _make_material(name, img, cutout):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    uvn = nt.nodes.new("ShaderNodeUVMap")
    uvn.uv_map = "UVMap"
    nt.links.new(uvn.outputs["UV"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.8
    if cutout:
        rnd = nt.nodes.new("ShaderNodeMath")
        rnd.operation = "ROUND"          # glTF exporter reads ROUND as alphaMode MASK, cutoff 0.5
        nt.links.new(tex.outputs["Alpha"], rnd.inputs[0])
        nt.links.new(rnd.outputs["Value"], bsdf.inputs["Alpha"])
        try:
            m.surface_render_method = "DITHERED"
        except Exception:  # noqa
            pass
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


def _world_bounds_rest(meshes):
    zmin, zmax = 1e9, -1e9
    xs, ys = [], []
    for o in meshes:
        mw = o.matrix_world
        co = np.zeros(len(o.data.vertices) * 3, dtype=np.float64)
        o.data.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        M = np.array(mw)
        w = co @ M[:3, :3].T + M[:3, 3]
        zmin, zmax = min(zmin, float(w[:, 2].min())), max(zmax, float(w[:, 2].max()))
        xs.append((float(w[:, 0].min()), float(w[:, 0].max())))
        ys.append((float(w[:, 1].min()), float(w[:, 1].max())))
    return zmin, zmax, (min(a for a, _ in xs), max(b for _, b in xs)), (min(a for a, _ in ys), max(b for _, b in ys))


def prepare_body(cfg, fighter_id, work_dir, atlas_size=1024):
    objs = C.import_fbx(cfg["fbx"])
    arms = [o for o in objs if o.type == "ARMATURE"]
    arm = max(arms, key=lambda a: len(a.data.bones))
    renamed = C.rename_prefix(arm)
    if arm.animation_data:
        arm.animation_data_clear()
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    for o in objs:
        if o.type == "ARMATURE" and o is not arm:
            C.remove_objects([o])
    empties = [o for o in objs if o.type == "EMPTY"]
    hide_res = [re.compile(h, re.I) for h in cfg.get("hide", [])]
    meshes, removed = [], []
    for o in objs:
        if o.type != "MESH":
            continue
        if any(r.search(o.name) for r in hide_res):
            removed.append(o.name)
            continue
        meshes.append(o)
    C.remove_objects([o for o in objs if o.type == "MESH" and o.name in removed])
    for e in empties:
        for ch in list(e.children):
            mw = ch.matrix_world.copy()
            ch.parent = None
            ch.matrix_world = mw
    C.remove_objects(empties)
    C.log("body", fighter_id, "bones", len(arm.data.bones), "renamed", renamed, "meshes",
          [o.name for o in meshes], "removed", removed)

    # ---- transforms: unparent (keep world), scale to heightM, floor at z=0, apply, re-parent
    z0, z1, xr, yr = _world_bounds_rest(meshes)
    file_h = z1 - z0
    k = float(cfg["heightM"]) / file_h
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    T = Matrix.Translation((0.0, 0.0, -z0 * k)) @ Matrix.Scale(k, 4)
    for o in [arm] + meshes:
        o.matrix_world = T @ o.matrix_world
    _select_only([arm] + meshes, arm)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in meshes:
        o.parent = arm
        o.matrix_parent_inverse = Matrix.Identity(4)
        for md in o.modifiers:
            if md.type == "ARMATURE":
                md.object = arm
    z0b, z1b, xrb, yrb = _world_bounds_rest(meshes)
    C.log("height file %.4f -> %.4f (k %.4f), floor %.4f" % (file_h, z1b - z0b, k, z0b))

    # ---- atlas + materials
    alb, ainfo, cut_by_mat = bake_atlas(meshes, fighter_id, work_dir, atlas_size)
    m_skin = _make_material(fighter_id + "_skin", alb, False)
    m_cut = _make_material(fighter_id + "_cutout", alb, True)
    for o in meshes:
        me = o.data
        old = [mm.name if mm else "" for mm in me.materials]
        flags = [cut_by_mat.get(n, False) for n in old]
        idx = np.zeros(len(me.polygons), dtype=np.int32)
        me.polygons.foreach_get("material_index", idx)
        newidx = np.array([1 if (i < len(flags) and flags[i]) else 0 for i in idx], dtype=np.int32)
        me.materials.clear()
        me.materials.append(m_skin)
        me.materials.append(m_cut)
        me.polygons.foreach_set("material_index", newidx)
        # keep only the atlas UV (renamed UVMap), drop colour attributes
        for uv in [u for u in me.uv_layers if u.name != "atlas"]:
            me.uv_layers.remove(uv)
        me.uv_layers["atlas"].name = "UVMap"
        for ca in list(me.color_attributes):
            me.color_attributes.remove(ca)
        me.update()
    # ---- join
    _select_only(meshes, meshes[0])
    if len(meshes) > 1:
        bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = fighter_id + "_body"
    body.data.name = fighter_id + "_body"
    # drop material slots that ended up unused
    used = set()
    idx = np.zeros(len(body.data.polygons), dtype=np.int32)
    body.data.polygons.foreach_get("material_index", idx)
    used = set(int(i) for i in np.unique(idx))
    arm.name = fighter_id + "_rig"
    arm.data.name = fighter_id + "_rig"
    for m in list(bpy.data.materials):
        if m not in (m_skin, m_cut):
            bpy.data.materials.remove(m)
    for im in list(bpy.data.images):
        if im is not alb:
            bpy.data.images.remove(im)
    C.purge_orphans()
    tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
    facts = {"bones": len(arm.data.bones), "renamed": renamed, "removed_meshes": removed,
             "file_height_m": round(file_h, 4), "scale_k": round(k, 5), "heightM": round(z1b - z0b, 4),
             "tris": tris, "verts": len(body.data.vertices), "material_slots_used": sorted(used),
             "atlas": ainfo}
    return arm, body, facts
