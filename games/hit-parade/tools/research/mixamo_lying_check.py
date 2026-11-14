"""Which way is the body lying at the end of a knockdown clip? (face up / face down / side)

Usage: blender --background --python mixamo_lying_check.py -- <out_json> <anim_root> <pack/clip> [...]
At the last frame, the chest-forward vector (Spine2's rest-forward, i.e. where the sternum points)
is taken in world space: z > +0.5 -> face UP (on back), z < -0.5 -> face DOWN (prone), else side.
Also reports the final hips height.
ASCII only.
"""
import bpy
import sys
import os
import json
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
OUT, ROOT, CLIPS = argv[0], argv[1], argv[2:]
res = {}
for k in [c.strip() for c in CLIPS if c.strip()]:
    # "pack/clip@first" measures the FIRST frame instead of the last (getup start poses)
    first = k.endswith("@first")
    pack, clip = k[:-6].split("/", 1) if first else k.split("/", 1)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=os.path.join(ROOT, pack, clip + ".fbx"))
    scn = bpy.context.scene
    arm = next(o for o in scn.objects if o.type == "ARMATURE")
    pbs = {pb.name.split(":")[-1]: pb for pb in arm.pose.bones}
    bones = {b.name.split(":")[-1]: b for b in arm.data.bones}
    wm3 = arm.matrix_world.to_3x3().normalized()
    rest_fwd_world = Vector((0.0, -1.0, 0.0))  # model forward (measured rest toe direction)
    rest3 = wm3 @ bones["Spine2"].matrix_local.to_3x3()
    local_fwd = rest3.inverted() @ rest_fwd_world
    f1 = int(round(arm.animation_data.action.frame_range[0 if first else 1]))
    scn.frame_set(f1)
    chest = (wm3 @ pbs["Spine2"].matrix.to_3x3().normalized()) @ local_fwd
    hips_z = (arm.matrix_world @ pbs["Hips"].head).z
    lying = "face UP (on back)" if chest.z > 0.5 else ("face DOWN (prone)" if chest.z < -0.5 else "on side / sitting")
    res[k] = {"frame": f1, "chest_fwd_z": round(chest.z, 3), "hips_z_end": round(hips_z, 3), "lying": lying}
    print("[lie]", k, res[k], flush=True)
json.dump(res, open(OUT, "w"), indent=1)
