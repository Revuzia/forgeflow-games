"""brightwick paint view: the shipped GLB's base colour UNLIT (emission), orthographic, in the bind pose: front,
3/4, side, back and from the 52 deg gameplay pitch, so the painting itself (bands, folds, value ramp) is judged
without any lighting. Accent parts render flat azure.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/wick_brightwick_paintview.py \
        -- art/out/units/brightwick_aubade.glb OUT.png
"""
import math
import sys

import bpy
from mathutils import Vector

glb, out = sys.argv[sys.argv.index("--") + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
for o in bpy.data.objects:
    if o.type == "ARMATURE" and o.animation_data:
        o.animation_data.action = None
        for pb in o.pose.bones:
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.rotation_euler = (0, 0, 0)
            pb.location = (0, 0, 0)
for m in bpy.data.materials:
    if not m.use_nodes:
        continue
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    outn = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
    if bsdf is None or outn is None:
        continue
    em = nt.nodes.new("ShaderNodeEmission")
    links = bsdf.inputs["Base Color"].links
    if links and "accent" not in m.name:
        nt.links.new(links[0].from_socket, em.inputs["Color"])
    else:
        em.inputs["Color"].default_value = (0.25, 0.55, 1.0, 1.0)
    nt.links.new(em.outputs[0], outn.inputs["Surface"])
sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
sc.view_settings.view_transform = "Standard"
sc.render.resolution_x, sc.render.resolution_y = 500, 640
sc.render.film_transparent = False
w = bpy.data.worlds.new("w")
w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.18, 0.18, 0.2, 1)
sc.world = w
cd = bpy.data.cameras.new("c")
cd.type = "ORTHO"
cd.ortho_scale = 2.3
cam = bpy.data.objects.new("c", cd)
sc.collection.objects.link(cam)
sc.camera = cam
# the GLB is Y-up imported to Z-up; the wick faces -Y in Blender after import (+Z in three)
views = [(0, 0), (40, 0), (90, 0), (180, 0), (0, 52), (180, 52)]
tiles = []
for i, (yaw, pitch) in enumerate(views):
    a, p = math.radians(yaw), math.radians(pitch)
    d = Vector((math.sin(a) * math.cos(p), -math.cos(a) * math.cos(p), math.sin(p)))
    t = Vector((0, 0, 0.85))
    cam.location = t + d * 6
    cam.rotation_euler = (t - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = f"{out}_{i}.png"
    bpy.ops.render.render(write_still=True)
    tiles.append(sc.render.filepath)
ims = [bpy.data.images.load(p) for p in tiles]
import numpy as np  # noqa: E402
W, H = 500, 640
sheet = np.zeros((H, W * len(ims), 4), dtype=np.float32)
for i, im in enumerate(ims):
    sheet[:, i * W:(i + 1) * W] = np.array(im.pixels[:], dtype=np.float32).reshape(H, W, 4)
img = bpy.data.images.new("sheet", W * len(ims), H)
img.pixels.foreach_set(sheet.ravel())
img.filepath_raw = out
img.file_format = "PNG"
img.save()
print("PAINTVIEW", out)
