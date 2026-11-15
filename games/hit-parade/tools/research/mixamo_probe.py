"""Probe: what does a Mixamo pack clip / X Bot / character look like after FBX import in Blender 5.1.
Usage: blender --background --python mixamo_probe.py -- <fbx> [<fbx> ...]
ASCII only.
"""
import bpy
import sys
import re

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def act_fcurves(act):
    out = []
    for layer in act.layers:
        for strip in layer.strips:
            if strip.type != "KEYFRAME":
                continue
            for slot in act.slots:
                cb = strip.channelbag(slot)
                if cb:
                    out.extend(cb.fcurves)
    return out


for path in args:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=path)
    scn = bpy.context.scene
    print("=" * 70)
    print("FILE", path)
    print("scene fps", scn.render.fps, "fps_base", scn.render.fps_base, "frames", scn.frame_start, scn.frame_end)
    for o in scn.objects:
        print(" obj", o.type, repr(o.name), "loc", tuple(round(v, 4) for v in o.location),
              "rot", tuple(round(v, 4) for v in o.rotation_euler), "scale", tuple(round(v, 4) for v in o.scale),
              "parent", o.parent.name if o.parent else None)
    arm = next((o for o in scn.objects if o.type == "ARMATURE"), None)
    if arm is None:
        print(" NO ARMATURE")
        continue
    bones = arm.data.bones
    print(" bones", len(bones))
    print(" names", [b.name for b in bones][:70])
    ad = arm.animation_data
    if ad and ad.action:
        act = ad.action
        print(" action", act.name, "range", tuple(act.frame_range), "slots", [s.identifier for s in act.slots],
              "slot assigned", ad.action_slot.identifier if ad.action_slot else None)
        fcs = act_fcurves(act)
        pat = re.compile(r'pose\.bones\["([^"]+)"\]\.(\w+)')
        loc_bones = {}
        chan = {}
        for fc in fcs:
            m = pat.match(fc.data_path)
            if not m:
                chan.setdefault(fc.data_path, 0)
                chan[fc.data_path] += 1
                continue
            bn, prop = m.group(1), m.group(2)
            chan.setdefault(prop, 0)
            chan[prop] += 1
            if prop == "location":
                vals = [kp.co.y for kp in fc.keyframe_points]
                rng = max(vals) - min(vals) if vals else 0
                loc_bones.setdefault(bn, 0.0)
                loc_bones[bn] = max(loc_bones[bn], rng)
        print(" fcurves", len(fcs), "by prop", chan)
        print(" location-keyed bones", len(loc_bones), "varying>1e-3:",
              sorted([(k, round(v, 4)) for k, v in loc_bones.items() if v > 1e-3], key=lambda x: -x[1])[:12])
        kp0 = fcs[0].keyframe_points
        print(" keys on first fcurve", len(kp0), "first", kp0[0].co.x, "last", kp0[-1].co.x)
    else:
        print(" no action")
    hips = bones.get("mixamorig:Hips") or next((b for b in bones if b.name.endswith("Hips")), None)
    if hips:
        wm = arm.matrix_world
        print(" hips rest world", tuple(round(v, 4) for v in (wm @ hips.matrix_local.translation)))
        zs = [(wm @ b.matrix_local.translation).z for b in bones]
        print(" rest world z range", round(min(zs), 4), round(max(zs), 4))
        for bn in ["Hips", "Spine", "LeftArm", "RightArm", "LeftUpLeg", "LeftForeArm"]:
            b = next((x for x in bones if x.name.endswith(":" + bn) or x.name == bn), None)
            if b:
                m = b.matrix_local.to_3x3()
                print("  rest3", bn, [tuple(round(v, 3) for v in row) for row in m])
