"""HIT PARADE - prop contact renders (lane ASSETS; ENV_KIT section 8 side-by-side test).

  blender.exe --background --python art/blender/props_sheet.py -- <job.json>
  job = {"items": [{"id", "path" (.glb/.gltf/.fbx), "albedo"? (fbx without embedded textures), "ref": bool}],
         "hdr": "<equirect .hdr>", "out_dir": "...", "res": 512, "views": ["front", "back", "close"]}

Every item is rendered ALONE, framed by its own bounding box, under the SAME world HDRI + key/rim lights and the
same camera recipe, so a procedural prop and a library prop (qfp_Chandelier, jp_JP_Conditioner_01) are judged in
the same light. Writes <out_dir>/<id>_<view>.png and sheet_results.json (tris, dims, textures per item). ASCII only.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Vector


def log(*a):
    print("[sheet]", *a, flush=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def set_engine(scn):
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
        try:
            scn.render.engine = eng
            return eng
        except TypeError:
            continue
    return scn.render.engine


def world(hdr, strength):
    w = bpy.data.worlds.new("w")
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(hdr)
    nt.links.new(env.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = strength
    # the camera sees a neutral backdrop (light path trick): mix with a flat grey for camera rays
    lp = nt.nodes.new("ShaderNodeLightPath")
    flat = nt.nodes.new("ShaderNodeBackground")
    flat.inputs["Color"].default_value = (0.09, 0.095, 0.11, 1.0)
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(lp.outputs["Is Camera Ray"], mix.inputs[0])
    nt.links.new(bg.outputs["Background"], mix.inputs[1])
    nt.links.new(flat.outputs["Background"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])


def import_item(it):
    before = set(bpy.data.objects)
    p = it["path"]
    if p.lower().endswith((".glb", ".gltf")):
        bpy.ops.import_scene.gltf(filepath=p)
    else:
        bpy.ops.import_scene.fbx(filepath=p)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    if it.get("albedo"):
        img = bpy.data.images.load(it["albedo"])
        for o in meshes:
            for m in o.data.materials:
                if m and m.node_tree:
                    bs = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
                    if bs:
                        tx = m.node_tree.nodes.new("ShaderNodeTexImage")
                        tx.image = img
                        m.node_tree.links.new(tx.outputs["Color"], bs.inputs["Base Color"])
                        bs.inputs["Alpha"].default_value = 1.0
    for o in meshes:
        for m in o.data.materials:
            if m is not None:
                try:
                    m.surface_render_method = "DITHERED"
                except Exception:  # noqa
                    pass
    return new, meshes


def bounds(meshes):
    bpy.context.view_layer.update()
    lo, hi = Vector((1e9, 1e9, 1e9)), Vector((-1e9, -1e9, -1e9))
    for o in meshes:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
            hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
    return lo, hi


def main():
    job = json.load(open(sys.argv[sys.argv.index("--") + 1], encoding="utf-8"))
    out = job["out_dir"]
    os.makedirs(out, exist_ok=True)
    res = int(job.get("res", 512))
    results = {}
    for it in job["items"]:
        reset()
        scn = bpy.context.scene
        eng = set_engine(scn)
        scn.render.resolution_x = scn.render.resolution_y = res
        scn.render.film_transparent = False
        # the game renders with three's NeutralToneMapping (= Khronos PBR Neutral): judge the props with the same curve
        for vt in ("Khronos PBR Neutral", "Standard"):      # dynamic enum: RNA lists nothing in background mode
            try:
                scn.view_settings.view_transform = vt
                break
            except TypeError:
                continue
        if eng == "CYCLES":
            scn.cycles.samples = 48
        else:
            try:
                scn.eevee.taa_render_samples = 64
            except Exception:  # noqa
                pass
        world(job["hdr"], job.get("hdr_strength", 1.0))
        new, meshes = import_item(it)
        lo, hi = bounds(meshes)
        c = (lo + hi) / 2
        size = max((hi - lo).length, 0.05)
        tris = 0
        texs = set()
        for o in meshes:
            me = o.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
            me.calc_loop_triangles()
            tris += len(me.loop_triangles)
            for m in o.data.materials:
                if m and m.node_tree:
                    for n in m.node_tree.nodes:
                        if n.type == "TEX_IMAGE" and n.image:
                            texs.add("%s %dx%d" % (n.image.name, n.image.size[0], n.image.size[1]))
        key = bpy.data.objects.new("key", bpy.data.lights.new("key", "AREA"))
        key.data.energy = 60.0 * size * size
        key.data.size = size
        scn.collection.objects.link(key)
        rim = bpy.data.objects.new("rim", bpy.data.lights.new("rim", "AREA"))
        rim.data.energy = 40.0 * size * size
        rim.data.size = size
        rim.data.color = (0.75, 0.85, 1.0)
        scn.collection.objects.link(rim)
        cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
        cam.data.lens = 70
        cam.data.clip_start = 0.005
        scn.collection.objects.link(cam)
        scn.camera = cam
        rec = {"tris": tris, "dims": [round(x, 4) for x in (hi - lo)], "textures": sorted(texs), "engine": eng}
        for view in job.get("views", ["front", "back", "close"]):
            # Blender -Y is the glTF front (+Z); views orbit around the bbox centre
            az = {"front": -35.0, "back": 145.0, "close": -20.0, "side": 90.0, "top": -35.0}[view]
            el = {"front": 18.0, "back": 22.0, "close": 12.0, "side": 8.0, "top": 60.0}[view]
            dist = size * (2.1 if view != "close" else 1.05)
            a, e = math.radians(az), math.radians(el)
            d = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
            target = c if view != "close" else c + (hi - c) * Vector((0.3, -0.3, 0.45))
            cam.location = target + d * dist
            cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
            key.location = target + Vector((math.sin(a + 0.9), -math.cos(a + 0.9), 0.9)).normalized() * dist * 1.2
            key.rotation_euler = (target - key.location).to_track_quat("-Z", "Y").to_euler()
            rim.location = target + Vector((-math.sin(a) * 0.8, math.cos(a) * 0.8, 0.6)).normalized() * dist * 1.2
            rim.rotation_euler = (target - rim.location).to_track_quat("-Z", "Y").to_euler()
            scn.render.filepath = os.path.join(out, "%s_%s.png" % (it["id"], view))
            bpy.ops.render.render(write_still=True)
        results[it["id"]] = rec
        log("rendered", it["id"], json.dumps(rec))
    with open(os.path.join(out, "sheet_results.json"), "w", encoding="utf-8") as fh:
        json.dump(results, fh, indent=1)


if __name__ == "__main__":
    try:
        main()
    except Exception:  # noqa
        import traceback
        traceback.print_exc()
        sys.exit(1)
