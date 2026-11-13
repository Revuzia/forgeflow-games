"""Find the Mixamo finger curl axis/sign on X Bot: curl every finger segment by
+ANG about local X (left hand) and -ANG (right hand), render both hands."""
import math
import sys

import bpy
from mathutils import Quaternion, Vector

args = sys.argv[sys.argv.index("--") + 1:]
rig, out = args[0], args[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=rig)
arm = [o for o in bpy.data.objects if o.type == "ARMATURE"][0]
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
arm.animation_data_clear()
ANG = math.radians(80)
for pb in arm.pose.bones:
    pb.rotation_mode = "QUATERNION"
    n = pb.name
    for f in ("Index", "Middle", "Ring", "Pinky"):
        for k in ("1", "2", "3"):
            if n.endswith("Hand" + f + k):
                sgn = 1.0 if "Left" in n else -1.0
                pb.rotation_quaternion = Quaternion(Vector((1, 0, 0)), ANG)
    if "Thumb" in n and n[-1] in "123":
        pb.rotation_quaternion = Quaternion(Vector((0, 0, 1)), math.radians(-35 if "Left" in n else 35))
bpy.context.view_layer.update()
scn = bpy.context.scene
scn.render.engine = "BLENDER_WORKBENCH"
scn.display.shading.light = "STUDIO"
scn.render.resolution_x = 500
scn.render.resolution_y = 300
scn.render.resolution_x = 300
cam_d = bpy.data.cameras.new("c")
cam_d.type = "ORTHO"
cam_d.ortho_scale = 0.45
cam = bpy.data.objects.new("c", cam_d)
scn.collection.objects.link(cam)
scn.camera = cam
w = bpy.data.worlds.new("w")
w.color = (0.9, 0.9, 0.9)
scn.world = w
for tag, loc, tgt in (("Rfront", (-0.82, -4, 1.44), (-0.82, 0.04, 1.43)), ("Rside", (-4.0, 0.04, 1.44), (-0.82, 0.04, 1.43)),
                      ("Lfront", (0.82, -4, 1.44), (0.82, 0.04, 1.43)), ("Lside", (4.0, 0.04, 1.44), (0.82, 0.04, 1.43))):
    cam.location = Vector(loc)
    cam.rotation_euler = (Vector(tgt) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scn.render.filepath = out + "_" + tag + ".png"
    bpy.ops.render.render(write_still=True)
