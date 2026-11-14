"""Probe X Bot.fbx in headless Blender: bones, rest, armature transform."""
import bpy
import sys

path = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=path)
for o in bpy.data.objects:
    print("OBJ", o.name, o.type, "loc", tuple(round(x, 4) for x in o.location),
          "rot", tuple(round(x, 4) for x in o.rotation_euler), "scale", tuple(round(x, 4) for x in o.scale),
          "parent", o.parent.name if o.parent else None)
arm = [o for o in bpy.data.objects if o.type == "ARMATURE"][0]
wm = arm.matrix_world
print("ARM matrix_world", [list(map(lambda v: round(v, 4), r)) for r in wm])
for b in arm.data.bones:
    h = wm @ b.head_local
    t = wm @ b.tail_local
    print("BONE", b.name, "parent", b.parent.name if b.parent else None,
          "head_w", tuple(round(x, 3) for x in h), "tail_w", tuple(round(x, 3) for x in t))
print("ACTIONS", [a.name for a in bpy.data.actions])
for m in [o for o in bpy.data.objects if o.type == "MESH"]:
    print("MESH", m.name, len(m.data.vertices), "mods", [x.type for x in m.modifiers])
