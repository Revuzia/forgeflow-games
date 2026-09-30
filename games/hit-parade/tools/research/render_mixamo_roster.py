# HIT PARADE research: render + measure Mixamo character FBX files (Blender 5.1 headless).
# Usage:
#   blender.exe --background --factory-startup --python render_mixamo_roster.py -- <list.json> <out_dir> [engine]
# list.json = JSON array of absolute FBX paths. For each FBX writes into out_dir:
#   <stem>_front.png, <stem>_34.png (RGBA, film transparent), <stem>.json (metrics)
#   or <stem>.error.txt on failure. Already-finished stems (json present) are skipped.
import bpy, sys, os, json, math, time, traceback
import numpy as np
from mathutils import Vector, Matrix

RES = 400
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
LIST_FILE = argv[0]
OUT_DIR = argv[1]
ENGINE = argv[2] if len(argv) > 2 else "BLENDER_EEVEE"
os.makedirs(OUT_DIR, exist_ok=True)


def log(*a):
    print("[roster]", *a, flush=True)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def setup_scene():
    sc = bpy.context.scene
    try:
        sc.render.engine = ENGINE
    except TypeError as e:
        log("engine fallback", e)
        sc.render.engine = "BLENDER_WORKBENCH"
    sc.render.resolution_x = RES
    sc.render.resolution_y = RES
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    try:
        sc.view_settings.view_transform = "Standard"
    except TypeError as e:
        log("view transform", e)
    try:
        sc.view_settings.look = "None"
    except Exception:
        pass
    if sc.render.engine == "BLENDER_EEVEE":
        try:
            sc.eevee.taa_render_samples = 24
        except Exception:
            pass
    if sc.render.engine == "BLENDER_WORKBENCH":
        sh = sc.display.shading
        sh.light = "STUDIO"
        sh.color_type = "TEXTURE"
    # world: neutral grey ambient (background itself is transparent; composited later on mid-grey)
    w = bpy.data.worlds.new("RosterWorld")
    sc.world = w
    try:
        w.use_nodes = True
    except Exception:
        pass
    bg = None
    if w.node_tree:
        bg = next((n for n in w.node_tree.nodes if n.type == "BACKGROUND"), None)
    if bg is not None:
        bg.inputs[0].default_value = (0.5, 0.5, 0.5, 1.0)
        bg.inputs[1].default_value = 0.45
    else:
        w.color = (0.2, 0.2, 0.2)


def image_info(img):
    info = {"name": img.name, "source": img.source}
    try:
        info["w"], info["h"] = int(img.size[0]), int(img.size[1])
    except Exception:
        info["w"], info["h"] = 0, 0
    info["has_data"] = bool(getattr(img, "has_data", False))
    pf = img.packed_file
    fp = bpy.path.abspath(img.filepath) if img.filepath else ""
    info["filepath"] = img.filepath
    if pf is not None:
        info["storage"] = "embedded"
        info["bytes"] = int(pf.size)
    elif fp and os.path.isfile(fp):
        info["storage"] = "sidecar"
        info["bytes"] = int(os.path.getsize(fp))
    else:
        info["storage"] = "missing"
        info["bytes"] = 0
    return info


def material_images(mat):
    imgs = []
    if mat is None or not mat.node_tree:
        return imgs
    for n in mat.node_tree.nodes:
        if n.type == "TEX_IMAGE" and n.image is not None:
            imgs.append(n.image)
    return imgs


def material_flags(mat):
    flags = []
    if mat is None:
        return ["empty_slot"]
    if not mat.node_tree:
        return ["no_nodes"]
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        flags.append("no_principled")
        return flags
    a = bsdf.inputs.get("Alpha")
    if a is not None:
        if a.is_linked:
            flags.append("alpha_linked")
        elif a.default_value < 0.99:
            flags.append("alpha_const_%.2f" % a.default_value)
    bc = bsdf.inputs.get("Base Color")
    if bc is not None and not bc.is_linked:
        flags.append("base_color_untextured")
    return flags


def mesh_world_coords(obj, dg):
    oe = obj.evaluated_get(dg)
    me = oe.to_mesh()
    n = len(me.vertices)
    co = np.empty(n * 3, dtype=np.float64)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    mw = np.array(oe.matrix_world, dtype=np.float64)
    co = co @ mw[:3, :3].T + mw[:3, 3]
    oe.to_mesh_clear()
    return co


def make_sun(name, direction, strength, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, "SUN")
    ld.energy = strength
    ld.color = color
    try:
        ld.angle = math.radians(8)
    except Exception:
        pass
    ob = bpy.data.objects.new(name, ld)
    bpy.context.scene.collection.objects.link(ob)
    d = Vector(direction).normalized()
    ob.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    return ob


def dir_from(az_deg, el_deg):
    # az measured from the front (-Y) toward +X (character's left side)
    az, el = math.radians(az_deg), math.radians(el_deg)
    return Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))


def render_view(V, az_deg, el_deg, out_png):
    sc = bpy.context.scene
    for o in [o for o in sc.objects if o.type in ("CAMERA", "LIGHT")]:
        bpy.data.objects.remove(o, do_unlink=True)
    back = dir_from(az_deg, el_deg)
    up = Vector((0, 0, 1))
    cx = up.cross(back).normalized()
    cy = back.cross(cx).normalized()
    X = np.array(cx); Y = np.array(cy); Z = np.array(back)
    pr, pu, pz = V @ X, V @ Y, V @ Z
    cr, cu = (pr.min() + pr.max()) / 2, (pu.min() + pu.max()) / 2
    span = max(pr.max() - pr.min(), pu.max() - pu.min()) * 1.08
    loc = cx * cr + cy * cu + back * (pz.max() + 3.0)
    cd = bpy.data.cameras.new("Cam")
    cd.type = "ORTHO"
    cd.ortho_scale = float(span)
    cd.clip_start = 0.01
    cd.clip_end = float(pz.max() - pz.min() + 10.0)
    cam = bpy.data.objects.new("Cam", cd)
    sc.collection.objects.link(cam)
    rot = Matrix((cx, cy, back)).transposed()
    cam.matrix_world = Matrix.Translation(loc) @ rot.to_4x4()
    sc.camera = cam
    # 3-point lighting relative to the camera azimuth
    make_sun("Key", dir_from(az_deg - 45, 40), 3.0, (1.0, 0.97, 0.92))
    make_sun("Fill", dir_from(az_deg + 55, 15), 1.2, (0.92, 0.96, 1.0))
    make_sun("Rim", dir_from(az_deg + 170, 35), 2.6)
    sc.render.filepath = out_png
    bpy.ops.render.render(write_still=True)
    return float(span)


def process(path):
    stem = os.path.splitext(os.path.basename(path))[0]
    t0 = time.time()
    reset_scene()
    setup_scene()
    m = {"file": os.path.basename(path), "fbx_bytes": os.path.getsize(path)}
    importer = "import_scene.fbx"
    try:
        bpy.ops.import_scene.fbx(filepath=path)
    except Exception as e:
        log("python importer failed, trying wm.fbx_import:", e)
        importer = "wm.fbx_import"
        bpy.ops.wm.fbx_import(filepath=path)
    m["importer"] = importer
    m["import_s"] = round(time.time() - t0, 2)
    sc = bpy.context.scene
    arms = [o for o in sc.objects if o.type == "ARMATURE"]
    meshes = [o for o in sc.objects if o.type == "MESH"]
    m["objects"] = {"armatures": len(arms), "meshes": len(meshes),
                    "mesh_names": [o.name for o in meshes]}
    for a in arms:
        a.data.pose_position = "REST"
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    # geometry
    tris = 0; verts = 0
    for o in meshes:
        me = o.data
        verts += len(me.vertices)
        lt = np.empty(len(me.polygons), dtype=np.int32)
        me.polygons.foreach_get("loop_total", lt)
        tris += int((lt - 2).clip(min=0).sum())
    m["triangles"] = tris
    m["vertices"] = verts
    vis = [o for o in meshes if not o.hide_render]
    per = {o.name: mesh_world_coords(o, dg) for o in vis}
    V = np.concatenate(list(per.values()), axis=0)
    skinned = [o for o in vis if any(md.type == "ARMATURE" for md in o.modifiers) and len(o.vertex_groups) > 0]
    props = [o.name for o in vis if o not in skinned]
    m["unskinned_meshes"] = props
    VB = np.concatenate([per[o.name] for o in skinned], axis=0) if skinned else V
    amn, amx = V.min(axis=0), V.max(axis=0)
    m["height_all_meshes_m"] = round(float(amx[2] - amn[2]), 3)
    mn, mx = VB.min(axis=0), VB.max(axis=0)
    m["bbox_min"] = [round(float(x), 4) for x in mn]
    m["bbox_max"] = [round(float(x), 4) for x in mx]
    h = float(mx[2] - mn[2])
    m["height_m"] = round(h, 3)
    m["span_x_m"] = round(float(mx[0] - mn[0]), 3)
    m["depth_y_m"] = round(float(mx[1] - mn[1]), 3)
    # rough torso bulk: slice at 60-66% height, within 0.25*h of the centre line
    cxm = float(np.median(VB[:, 0]))
    sl = VB[(VB[:, 2] > mn[2] + 0.60 * h) & (VB[:, 2] < mn[2] + 0.66 * h) & (np.abs(VB[:, 0] - cxm) < 0.25 * h)]
    if len(sl):
        m["torso_width_m"] = round(float(sl[:, 0].max() - sl[:, 0].min()), 3)
        m["torso_depth_m"] = round(float(sl[:, 1].max() - sl[:, 1].min()), 3)
    # materials + textures
    mats = []
    for o in meshes:
        for s in o.material_slots:
            if s.material is not None and s.material not in mats:
                mats.append(s.material)
    m["material_count"] = len(mats)
    used = []
    seen_keys = set()
    matinfo = []
    for mat in mats:
        ims = material_images(mat)
        matinfo.append({"name": mat.name, "images": [i.name for i in ims], "flags": material_flags(mat)})
        for i in ims:
            key = os.path.basename(i.filepath.replace("\\", "/")).lower() if i.filepath else i.name
            if key not in seen_keys:
                seen_keys.add(key)
                used.append(i)
    m["materials"] = matinfo
    tex = [image_info(i) for i in used]
    m["textures"] = tex
    m["texture_count"] = len(tex)
    m["all_images_in_file"] = len([i for i in bpy.data.images if i.type == "IMAGE"])
    if tex:
        big = max(tex, key=lambda t: t["w"] * t["h"])
        m["largest_texture"] = "%dx%d" % (big["w"], big["h"])
        m["largest_texture_px"] = max(max(t["w"], t["h"]) for t in tex)
    else:
        m["largest_texture"] = "none"
        m["largest_texture_px"] = 0
    m["texture_bytes"] = int(sum(t["bytes"] for t in tex))
    m["texture_mb"] = round(m["texture_bytes"] / 1048576.0, 2)
    st = sorted(set(t["storage"] for t in tex))
    m["texture_storage"] = "+".join(st) if st else "none"
    m["broken_textures"] = [t["name"] for t in tex if t["storage"] == "missing" or t["w"] == 0]
    fbm = os.path.join(os.path.dirname(path), stem + ".fbm")
    m["sidecar_fbm_dir"] = os.path.isdir(fbm)
    # skeleton
    if arms:
        a = max(arms, key=lambda o: len(o.data.bones))
        bones = a.data.bones
        names = [b.name for b in bones]
        m["bone_count"] = len(bones)
        pref = sorted(set(n.split(":")[0] + ":" for n in names if n.lower().startswith("mixamorig")))
        m["mixamorig_prefix"] = bool(pref)
        m["bone_prefixes"] = pref
        m["mixamorig_bones"] = sum(1 for n in names if n.lower().startswith("mixamorig"))
        la = next((b for b in bones if b.name.split(":")[-1] == "LeftArm"), None)
        if la is not None:
            mw = a.matrix_world
            hd = mw @ la.head_local
            ch = next((c for c in la.children if "ForeArm" in c.name), None)
            tl = mw @ (ch.head_local if ch is not None else la.tail_local)
            d = tl - hd
            horiz = math.hypot(d.x, d.y)
            ang = math.degrees(math.atan2(d.z, horiz))  # negative = arm drooping below horizontal
            m["left_upper_arm_deg"] = round(ang, 1)
            aa = abs(ang)
            m["rest_pose"] = "T-pose" if aa < 15 else ("A-pose" if aa <= 60 else "other")
        else:
            m["rest_pose"] = "unknown(no LeftArm bone)"
    else:
        m["bone_count"] = 0
        m["mixamorig_prefix"] = False
        m["rest_pose"] = "no armature"
    # scouting look: unlink spec/gloss/rough maps, fixed moderate roughness (albedo + normals kept)
    for mat in mats:
        if not mat.node_tree:
            continue
        for n in mat.node_tree.nodes:
            if n.type != "BSDF_PRINCIPLED":
                continue
            for nm, val in (("Roughness", 0.62), ("Specular IOR Level", 0.25), ("Metallic", 0.0)):
                inp = n.inputs.get(nm)
                if inp is None:
                    continue
                for l in list(inp.links):
                    mat.node_tree.links.remove(l)
                inp.default_value = val
    # renders
    t1 = time.time()
    m["span_front"] = render_view(V, 0, 4, os.path.join(OUT_DIR, stem + "_front.png"))
    m["span_34"] = render_view(V, 38, 10, os.path.join(OUT_DIR, stem + "_34.png"))
    m["render_s"] = round(time.time() - t1, 2)
    m["engine"] = bpy.context.scene.render.engine
    m["total_s"] = round(time.time() - t0, 2)
    with open(os.path.join(OUT_DIR, stem + ".json"), "w", encoding="utf-8") as f:
        json.dump(m, f, indent=1)
    log("OK", stem, "tris", tris, "tex", m["texture_count"], m["largest_texture"], "%.1fMB" % m["texture_mb"],
        "h", m["height_m"], m.get("rest_pose"), "%.1fs" % m["total_s"])


def main():
    files = json.load(open(LIST_FILE, encoding="utf-8"))
    for p in files:
        stem = os.path.splitext(os.path.basename(p))[0]
        if os.path.isfile(os.path.join(OUT_DIR, stem + ".json")):
            log("SKIP (done)", stem)
            continue
        try:
            process(p)
        except Exception:
            tb = traceback.format_exc()
            log("FAIL", stem, tb)
            with open(os.path.join(OUT_DIR, stem + ".error.txt"), "w", encoding="utf-8") as f:
                f.write(tb)


main()
