"""Count location/rotation/scale fcurves per clip (to back the 'constant translation tracks' claim).

Usage: blender --background --python mixamo_fcurve_count.py -- <out_json> <pack_dir> [<pack_dir> ...]
ASCII only.
"""
import bpy
import sys
import os
import re
import json

argv = sys.argv[sys.argv.index("--") + 1:]
OUT, PACKS = argv[0], argv[1:]
pat = re.compile(r'pose\.bones\["([^"]+)"\]\.(\w+)')
res = {}
for pdir in PACKS:
    pack = os.path.basename(os.path.normpath(pdir))
    for f in sorted(os.listdir(pdir)):
        if not f.lower().endswith(".fbx") or f == "X Bot.fbx":
            continue
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.fbx(filepath=os.path.join(pdir, f))
        arm = next((o for o in bpy.context.scene.objects if o.type == "ARMATURE"), None)
        cnt = {"location": 0, "rotation_quaternion": 0, "rotation_euler": 0, "scale": 0, "other": 0}
        nb = len(arm.data.bones) if arm else 0
        if arm and arm.animation_data and arm.animation_data.action:
            act = arm.animation_data.action
            for layer in act.layers:
                for st in layer.strips:
                    for slot in act.slots:
                        cb = st.channelbag(slot)
                        if not cb:
                            continue
                        for fc in cb.fcurves:
                            m = pat.match(fc.data_path)
                            cnt[m.group(2) if m and m.group(2) in cnt else "other"] += 1
        res[pack + "/" + os.path.splitext(f)[0]] = {"bones": nb, **cnt}
json.dump(res, open(OUT, "w"), indent=0)
print("[fc] DONE", len(res))
