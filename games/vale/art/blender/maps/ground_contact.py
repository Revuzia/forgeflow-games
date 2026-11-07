"""VALE, lane GE: bake a map's ground contact shade (GE-2).

The ground is a shader with no UVs and the walls are generated at run time, so nothing in the game has ever computed real
occlusion on the floor: the wall foot is a distance-field ramp (even along a wall, no deeper in a corner) and landmarks,
boulders and structures have no contact on the ground at all beyond N8AO on High and up, and the sun shadow.

This takes the static world dumped from the real client (_harness/gfx_ge_dump_static.mjs: float32 triangles, z up) and a
map-sized plane at y = 0, Cycles-bakes AO onto the plane within `--dist` metres, and writes one grey image: 0.25 m a texel,
v running with map y. The ground shader multiplies it in (terrain_glsl.ts, the contact role).

  Blender -b --factory-startup --python-exit-code 1 --python art/blender/maps/ground_contact.py -- \
      --static /tmp/map_rift_static.bin --size 170,110 --out /tmp/rift_contact.png [--texel 0.25] [--dist 2.2] [--samples 64]
"""
import argparse
import array
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
p = argparse.ArgumentParser()
p.add_argument("--static", required=True)
p.add_argument("--size", required=True)
p.add_argument("--out", required=True)
p.add_argument("--texel", type=float, default=0.25)
p.add_argument("--dist", type=float, default=2.2)
p.add_argument("--samples", type=int, default=64)
a = p.parse_args(argv)
SX, SY = (float(v) for v in a.size.split(","))
W, H = round(SX / a.texel), round(SY / a.texel)

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)

# the world's triangles
f = array.array("f")
with open(a.static, "rb") as fh:
    f.frombytes(fh.read())
n = len(f) // 9
verts = [(f[i], f[i + 1], f[i + 2]) for i in range(0, len(f), 3)]
faces = [(i * 3, i * 3 + 1, i * 3 + 2) for i in range(n)]
me = bpy.data.meshes.new("static")
me.from_pydata(verts, [], faces)
me.update()
ob = bpy.data.objects.new("static", me)
bpy.context.scene.collection.objects.link(ob)

# the ground plane: map (x, y) -> Blender (x, -y), u = x / SX, v = y / SY. It runs past the map by nothing: the map's own rect
pm = bpy.data.meshes.new("plane")
pm.from_pydata([(0, 0, 0), (SX, 0, 0), (SX, -SY, 0), (0, -SY, 0)], [], [(0, 3, 2, 1)])
pm.update()
pl = bpy.data.objects.new("plane", pm)
bpy.context.scene.collection.objects.link(pl)
uv = pm.uv_layers.new(name="UVMap")
for poly in pm.polygons:
    for li in poly.loop_indices:
        v = pm.vertices[pm.loops[li].vertex_index].co
        uv.data[li].uv = (v.x / SX, -v.y / SY)

mat = bpy.data.materials.new("bake")
mat.use_nodes = True
img = bpy.data.images.new("contact", W, H, alpha=False, float_buffer=True)
img.colorspace_settings.name = "Non-Color"
node = mat.node_tree.nodes.new("ShaderNodeTexImage")
node.image = img
mat.node_tree.nodes.active = node
pm.materials.append(mat)

sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = a.samples
sc.cycles.use_denoising = False
sc.world = bpy.data.worlds.new("w")
sc.world.light_settings.distance = a.dist
bpy.context.view_layer.objects.active = pl
pl.select_set(True)
ob.select_set(False)
bpy.ops.object.bake(type="AO", use_selected_to_active=False, margin=0, use_clear=True)
img.filepath_raw = a.out
img.file_format = "PNG"
s = sc.view_settings
s.view_transform = "Raw"
img.save_render(a.out)
print("contact", W, H, "tris", n, "->", a.out)
