"""TECH_REUSE lane: build ONE skinned + textured + animated test GLB from a Mixamo character FBX and a
Mixamo clip FBX, so gltf-transform (meshopt / webp / resize) can be tested against a realistic input.
Usage:
  blender.exe --background --python tech_fbx_to_glb.py -- <character.fbx> <clip.fbx> <out.glb>
ASCII only. Writes only <out.glb>.
"""
import bpy
import sys

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(args) < 3:
    print("usage: -- <character.fbx> <clip.fbx> <out.glb>")
    sys.exit(2)
char_fbx, clip_fbx, out_glb = args[0], args[1], args[2]

bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene

bpy.ops.import_scene.fbx(filepath=char_fbx)
char_objs = set(scn.objects)
arm = next((o for o in char_objs if o.type == "ARMATURE"), None)
if arm is None:
    print("ERROR no armature in character")
    sys.exit(3)
meshes = [o for o in char_objs if o.type == "MESH"]
print("CHAR armature", arm.name, "bones", len(arm.data.bones), "meshes", len(meshes))
for m in meshes:
    print("  mesh", m.name, "verts", len(m.data.vertices), "mats", [s.material.name if s.material else None for s in m.material_slots])
imgs = list(bpy.data.images)
print("CHAR images", len(imgs))
for im in imgs:
    print("  image", im.name, im.size[0], im.size[1], "packed", bool(im.packed_file), "file", im.filepath)

# drop any action the character came with
if arm.animation_data:
    arm.animation_data.action = None

bpy.ops.import_scene.fbx(filepath=clip_fbx)
clip_objs = set(scn.objects) - char_objs
clip_arm = next((o for o in clip_objs if o.type == "ARMATURE"), None)
if clip_arm is None or not clip_arm.animation_data or not clip_arm.animation_data.action:
    print("ERROR clip has no armature action")
    sys.exit(4)
act = clip_arm.animation_data.action
print("CLIP action", act.name, "range", tuple(act.frame_range), "slots", [s.identifier for s in act.slots])

missing = [b.name for b in clip_arm.data.bones if b.name not in arm.data.bones]
print("CLIP bones not on character:", len(missing), missing[:10])

if arm.animation_data is None:
    arm.animation_data_create()
arm.animation_data.action = act
try:
    if arm.animation_data.action_slot is None and len(act.slots):
        arm.animation_data.action_slot = act.slots[0]
except Exception as e:
    print("slot assign note:", e)
print("assigned slot:", arm.animation_data.action_slot.identifier if arm.animation_data.action_slot else None)
act.name = "clip"

for o in list(clip_objs):
    bpy.data.objects.remove(o, do_unlink=True)

scn.frame_start = int(act.frame_range[0])
scn.frame_end = int(act.frame_range[1])

bpy.ops.export_scene.gltf(
    filepath=out_glb,
    export_format="GLB",
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_skins=True,
    export_yup=True,
    export_image_format="AUTO",
)
print("WROTE", out_glb)
