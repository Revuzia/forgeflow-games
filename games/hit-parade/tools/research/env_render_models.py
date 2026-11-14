# HIT PARADE environment scouting - Blender headless model preview renderer.
# Usage:
#   blender.exe --background --python env_render_models.py -- <list.json> <out_dir> [res]
# list.json = [{"id": "...", "path": "F:/.../model.glb", "tex_dir": "optional dir for unity fbx albedo lookup"}, ...]
# Writes <out_dir>/<id>.png and <out_dir>/_results.json (tris, verts, texture sizes, dims).
# ASCII only.
import bpy, sys, os, json, math, glob, re
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
LIST, OUT = os.path.abspath(argv[0]), os.path.abspath(argv[1])
RES = int(argv[2]) if len(argv) > 2 else 384
os.makedirs(OUT, exist_ok=True)
items = json.load(open(LIST, encoding="utf-8"))
results = {}
res_path = os.path.join(OUT, "_results.json")
if os.path.exists(res_path):
    try:
        results = json.load(open(res_path, encoding="utf-8"))
    except Exception:
        results = {}


def set_engine(scene):
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "BLENDER_WORKBENCH"):
        try:
            scene.render.engine = eng
            return eng
        except TypeError:
            continue
    return scene.render.engine


def find_tex(tex_dir, names):
    """Heuristic albedo lookup for Unity FBX whose textures are not embedded."""
    if not tex_dir or not os.path.isdir(tex_dir):
        return None
    cands = []
    for ext in ("png", "tga", "jpg", "jpeg", "psd"):
        cands += glob.glob(os.path.join(tex_dir, "**", "*." + ext), recursive=True)
    alb = [c for c in cands if re.search(r"(albedo|basecolor|base_color|diffuse|_a\.|_d\.|_col|color|_bc)", os.path.basename(c).lower())
           and not re.search(r"(normal|_n\.|rough|metal|_mm\.|mask|ao|height|emiss)", os.path.basename(c).lower())]
    if not alb:
        alb = [c for c in cands if not re.search(r"(normal|_n\.|rough|metal|_mm\.|mask|_ao|height|emiss)", os.path.basename(c).lower())]
    best, score = None, -1
    for c in alb:
        b = os.path.basename(c).lower()
        s = 0
        for n in names:
            n = n.lower()
            toks = [t for t in re.split(r"[^a-z0-9]+", n) if len(t) > 2]
            s += sum(1 for t in toks if t in b)
        if s > score:
            best, score = c, s
    return best if score > 0 else None


for it in items:
    iid, path = it["id"], it["path"]
    if iid in results and results[iid].get("png") and os.path.exists(results[iid]["png"]) and not it.get("force"):
        continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    ext = os.path.splitext(path)[1].lower()
    rec = {"path": path}
    try:
        if ext in (".glb", ".gltf"):
            bpy.ops.import_scene.gltf(filepath=path)
        elif ext == ".fbx":
            bpy.ops.import_scene.fbx(filepath=path)
        elif ext == ".obj":
            bpy.ops.wm.obj_import(filepath=path)
        elif ext == ".blend":
            with bpy.data.libraries.load(path) as (src, dst):
                dst.objects = src.objects
            for o in dst.objects:
                if o is not None:
                    scene.collection.objects.link(o)
        else:
            raise RuntimeError("unsupported " + ext)
    except Exception as e:
        rec["error"] = "import: " + str(e)[:300]
        results[iid] = rec
        continue

    # force opaque + alpha 1 (Unity FBX often import with alpha 0 / blend modes -> invisible)
    for m in bpy.data.materials:
        try:
            m.blend_method = "OPAQUE"
        except Exception:
            pass
        try:
            m.surface_render_method = "DITHERED"
        except Exception:
            pass
        if m.use_nodes and m.node_tree:
            for n in m.node_tree.nodes:
                if n.type == "BSDF_PRINCIPLED":
                    a = n.inputs.get("Alpha")
                    if a is not None:
                        for l in list(a.links):
                            m.node_tree.links.remove(l)
                        a.default_value = 1.0
                    t = n.inputs.get("Transmission Weight") or n.inputs.get("Transmission")
                    if t is not None and not t.links:
                        t.default_value = 0.0
    for o in scene.objects:
        o.hide_render = False
        o.hide_viewport = False
    meshes = [o for o in scene.objects if o.type == "MESH"]
    dg = bpy.context.evaluated_depsgraph_get()
    tris = verts = 0
    mn = Vector((1e9, 1e9, 1e9)); mx = Vector((-1e9, -1e9, -1e9))
    for o in meshes:
        oe = o.evaluated_get(dg)
        me = oe.to_mesh()
        me.calc_loop_triangles()
        tris += len(me.loop_triangles)
        verts += len(me.vertices)
        for v in me.vertices:
            w = o.matrix_world @ v.co
            mn = Vector((min(mn.x, w.x), min(mn.y, w.y), min(mn.z, w.z)))
            mx = Vector((max(mx.x, w.x), max(mx.y, w.y), max(mx.z, w.z)))
        oe.to_mesh_clear()
    rec["tris"] = tris
    rec["verts"] = verts
    rec["meshes"] = len(meshes)
    if not meshes:
        rec["error"] = "no meshes"
        results[iid] = rec
        continue
    dims = mx - mn
    rec["dims_m"] = [round(dims.x, 4), round(dims.y, 4), round(dims.z, 4)]
    rec["materials"] = sorted({s.material.name for o in meshes for s in o.material_slots if s.material})

    # Unity FBX: try to attach an albedo when none embedded
    has_img = any(img.size[0] > 0 for img in bpy.data.images)
    tex_dir = it.get("tex_dir")
    if (not has_img and tex_dir) or it.get("albedo"):
        names = rec["materials"] + [os.path.splitext(os.path.basename(path))[0]]
        tpath = it.get("albedo") or find_tex(tex_dir, names)
        if tpath:
            try:
                img = bpy.data.images.load(tpath)
                for o in meshes:
                    if not o.material_slots:
                        o.data.materials.append(bpy.data.materials.new("auto"))
                    for s in o.material_slots:
                        m = s.material or bpy.data.materials.new("auto")
                        s.material = m
                        m.use_nodes = True
                        nt = m.node_tree
                        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
                        if bsdf is None:
                            bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
                        tn = nt.nodes.new("ShaderNodeTexImage")
                        tn.image = img
                        nt.links.new(tn.outputs["Color"], bsdf.inputs["Base Color"])
                rec["albedo_attached"] = tpath
            except Exception as e:
                rec["albedo_error"] = str(e)[:200]
    rec["textures"] = sorted({"%s %dx%d" % (img.name, img.size[0], img.size[1]) for img in bpy.data.images if img.size[0] > 0})

    # camera framing 3/4 view
    ctr = (mn + mx) / 2
    radius = max(dims.length / 2, 1e-5)
    cam_d = bpy.data.cameras.new("cam")
    cam_d.lens = 50
    cam = bpy.data.objects.new("cam", cam_d)
    scene.collection.objects.link(cam)
    direction = Vector((1.0, -1.25, 0.8)).normalized()
    fov = 2 * math.atan(36 / (2 * cam_d.lens))
    dist = radius / math.sin(fov / 2) * 1.05
    cam.location = ctr + direction * dist
    cam.rotation_euler = (ctr - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam_d.clip_end = dist * 10 + 100
    cam_d.clip_start = max(0.01, dist / 1000)
    scene.camera = cam
    # lights
    sun_d = bpy.data.lights.new("sun", "SUN"); sun_d.energy = 3.0
    sun = bpy.data.objects.new("sun", sun_d); scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    fill_d = bpy.data.lights.new("fill", "SUN"); fill_d.energy = 1.0
    fill = bpy.data.objects.new("fill", fill_d); scene.collection.objects.link(fill)
    fill.rotation_euler = (math.radians(60), 0, math.radians(-140))
    world = bpy.data.worlds.new("w"); scene.world = world
    world.use_nodes = True
    bg = next((n for n in world.node_tree.nodes if n.type == "BACKGROUND"), None)
    if bg:
        bg.inputs[0].default_value = (0.42, 0.44, 0.48, 1.0)
        bg.inputs[1].default_value = 0.8
    eng = set_engine(scene)
    if eng == "BLENDER_WORKBENCH":
        scene.display.shading.color_type = "TEXTURE"
        scene.display.shading.light = "STUDIO"
    scene.render.resolution_x = RES
    scene.render.resolution_y = RES
    scene.render.film_transparent = False
    try:
        scene.view_settings.view_transform = "Standard"
    except Exception:
        pass
    try:
        scene.eevee.taa_render_samples = 16
    except Exception:
        pass
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = os.path.join(OUT, iid + ".png")
    try:
        bpy.ops.render.render(write_still=True)
        rec["png"] = scene.render.filepath
        rec["engine"] = eng
    except Exception as e:
        rec["error"] = "render: " + str(e)[:300]
    results[iid] = rec
    json.dump(results, open(res_path, "w", encoding="utf-8"), indent=1)
    print("RENDERED", iid, tris, rec.get("textures"))

json.dump(results, open(res_path, "w", encoding="utf-8"), indent=1)
print("DONE", len(results))
