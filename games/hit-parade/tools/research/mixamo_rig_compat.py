"""HIT PARADE research: per-bone rest-orientation comparison, X Bot vs Mixamo character bodies.

Usage:
  blender --background --python mixamo_rig_compat.py -- <out_json> <xbot_fbx> <char_fbx> [<char_fbx> ...]

For every bone shared by name (the "mixamorigN:" prefix is stripped) it records, from
bone.matrix_local (armature space, the importer's bind pose):
  maxdiff      max |Bx - Bt| over the 3x3 rotation entries (the driftwake probe metric)
  angle_deg    total rotation angle between the two rest frames
  swing_deg    angle between the two bone DIRECTIONS (Blender bone +Y = head->tail)
  twist_deg    roll about the bone axis left after the swing is removed
               (swing-twist decomposition of C = Bx^-1 @ Bt about local Y)
  len_ratio    bone length ratio target/xbot after normalising both rigs by hip height
Also: armature object transform, bone-name prefix, missing/extra bones, hip height, top height.
ASCII only.
"""
import bpy
import sys
import os
import json
import math
from mathutils import Vector, Matrix, Quaternion

argv = sys.argv[sys.argv.index("--") + 1:]
OUT, XBOT, CHARS = argv[0], argv[1], argv[2:]

BODY = ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head", "LeftShoulder", "LeftArm", "LeftForeArm",
        "LeftHand", "RightShoulder", "RightArm", "RightForeArm", "RightHand", "LeftUpLeg", "LeftLeg",
        "LeftFoot", "LeftToeBase", "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase"]


def log(*a):
    print("[rig]", *a, flush=True)


def strip(n):
    return n.split(":")[-1]


def load(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=path)
    arms = [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]
    if not arms:
        return None
    arm = max(arms, key=lambda a: len(a.data.bones))
    wm = arm.matrix_world
    bones = {}
    prefixes = set()
    for b in arm.data.bones:
        if ":" in b.name:
            prefixes.add(b.name.split(":")[0] + ":")
        par = strip(b.parent.name) if b.parent else None
        bones[strip(b.name)] = {
            "rest3": b.matrix_local.to_3x3().copy(),
            "head_arm": b.matrix_local.translation.copy(),
            "head_w": (wm @ b.matrix_local.translation).copy(),
            "tail_w": (wm @ (b.matrix_local @ Vector((0, b.length, 0)))).copy(),
            "parent": par,
        }
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    skinned = [o.name for o in meshes if any(m.type == "ARMATURE" for m in o.modifiers)]
    info = {
        "armature_object": arm.name,
        "obj_loc": [round(v, 5) for v in arm.location],
        "obj_rot_euler_deg": [round(math.degrees(v), 3) for v in arm.rotation_euler],
        "obj_scale": [round(v, 5) for v in arm.scale],
        "prefixes": sorted(prefixes),
        "n_bones": len(bones),
        "meshes": [o.name for o in meshes],
        "skinned_meshes": skinned,
        "n_armatures": len(arms),
    }
    return bones, info


def mat_maxdiff(a, b):
    return max(abs(a[i][j] - b[i][j]) for i in range(3) for j in range(3))


def swing_twist(bx, bt):
    c = bx.inverted() @ bt
    q = c.to_quaternion()
    if q.w < 0:
        q = -q
    total = math.degrees(2 * math.acos(min(1.0, abs(q.w))))
    # twist about local Y
    tw = Quaternion((q.w, 0.0, q.y, 0.0))
    if tw.magnitude < 1e-9:
        twist = 180.0
    else:
        tw.normalize()
        twist = math.degrees(2 * math.acos(min(1.0, abs(tw.w))))
        if tw.y * tw.w < 0:
            twist = -twist
    yx = bx.col[1].normalized()
    yt = bt.col[1].normalized()
    swing = math.degrees(yx.angle(yt)) if yx.length > 0 and yt.length > 0 else None
    return total, swing, twist


def hip_top(bones):
    zs = [v["head_w"].z for v in bones.values()]
    hips = bones.get("Hips")
    top = bones.get("HeadTop_End")
    floor = min(zs)
    return (hips["head_w"].z - floor if hips else None), ((top["head_w"].z - floor) if top else max(zs) - floor)


xb, xinfo = load(XBOT)
xh, xtop = hip_top(xb)
log("xbot", XBOT, xinfo["n_bones"], "hip", round(xh, 4), "top", round(xtop, 4))
out = {"xbot": {"file": XBOT, "info": xinfo, "hip_height": xh, "top_height": xtop}, "bodies": []}

for path in CHARS:
    try:
        r = load(path)
    except Exception as e:
        out["bodies"].append({"file": path, "error": repr(e)})
        continue
    if r is None:
        out["bodies"].append({"file": path, "error": "no armature"})
        continue
    tb, tinfo = r
    th, ttop = hip_top(tb)
    shared = [n for n in xb if n in tb]
    per = {}
    for n in shared:
        bx, bt = xb[n]["rest3"], tb[n]["rest3"]
        total, swing, twist = swing_twist(bx, bt)
        lx = (xb[n]["tail_w"] - xb[n]["head_w"]).length / xh
        lt = (tb[n]["tail_w"] - tb[n]["head_w"]).length / th if th else None
        # offset from parent, normalised by hip height (proportions)
        px = xb[n]["parent"]
        if px and px in xb and px in tb:
            ox = (xb[n]["head_w"] - xb[px]["head_w"]).length / xh
            ot = (tb[n]["head_w"] - tb[px]["head_w"]).length / th
            off_ratio = ot / ox if ox > 1e-6 else None
        else:
            off_ratio = None
        per[n] = {
            "maxdiff": round(mat_maxdiff(bx, bt), 4),
            "angle_deg": round(total, 2),
            "swing_deg": None if swing is None else round(swing, 2),
            "twist_deg": round(twist, 2),
            "parent_same": xb[n]["parent"] == tb[n]["parent"],
            "offset_ratio_norm": None if off_ratio is None else round(off_ratio, 3),
        }
    body = [n for n in BODY if n in per]
    fingers = [n for n in per if n not in BODY and ("Hand" in n and n not in ("LeftHand", "RightHand"))]

    def worst(names, key):
        if not names:
            return None
        n = max(names, key=lambda k: abs(per[k][key]) if per[k][key] is not None else -1)
        return {"bone": n, key: per[n][key]}

    rec = {
        "file": path.replace("\\", "/"), "name": os.path.splitext(os.path.basename(path))[0],
        "info": tinfo, "hip_height": round(th, 4) if th else None, "top_height": round(ttop, 4),
        "hip_ratio_vs_xbot": round(th / xh, 4) if th else None,
        "missing_vs_xbot": sorted(set(xb) - set(tb)), "extra_vs_xbot": sorted(set(tb) - set(xb)),
        "parent_mismatch": sorted(n for n in shared if not per[n]["parent_same"]),
        "body_worst_maxdiff": worst(body, "maxdiff"),
        "body_worst_swing": worst(body, "swing_deg"),
        "body_worst_twist": worst(body, "twist_deg"),
        "finger_worst_maxdiff": worst(fingers, "maxdiff"),
        "finger_worst_twist": worst(fingers, "twist_deg"),
        "per_bone": per,
    }
    out["bodies"].append(rec)
    log(rec["name"], "bones", tinfo["n_bones"], "prefix", tinfo["prefixes"], "hip", rec["hip_height"],
        "body maxdiff", rec["body_worst_maxdiff"], "twist", rec["body_worst_twist"])
    with open(OUT, "w") as fh:
        json.dump(out, fh, indent=1)
with open(OUT, "w") as fh:
    json.dump(out, fh, indent=1)
log("DONE", len(out["bodies"]))
