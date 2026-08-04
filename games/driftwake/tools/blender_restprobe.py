import bpy
from mathutils import Matrix

FILES = {
    "CHARACTER": r"F:\games\forgeflow-games-assets\meshy-driftwake\driftwake_char_f_RIGGED.fbx",
    "SKATE_withskin": r"F:\games\forgeflow-games-assets\_downloaded\mixamo\animations\Extra\skateboarding_inplace.fbx",
    "SKATE_noskin": r"F:\games\forgeflow-games-assets\_downloaded\mixamo\animations\Extra\skateboarding_inplace_noskin.fbx",
    "BREATHING_noskin": r"F:\games\forgeflow-games-assets\_downloaded\mixamo\animations\Extra\breathing_idle_armspace65.fbx",
    "OLDPACK_walk": r"F:\games\forgeflow-games-assets\_downloaded\mixamo\animations\Action_Adventure_Pack\walking.fbx",
}
BONES = ["mixamorig:RightShoulder", "mixamorig:RightArm", "mixamorig:LeftUpLeg"]

def rest_of(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=path, ignore_leaf_bones=True)
    arm = next((o for o in bpy.context.scene.objects if o.type == "ARMATURE"), None)
    if arm is None:
        return None
    out = {}
    for bn in BONES:
        b = arm.data.bones.get(bn) or arm.data.bones.get(bn.replace(":", ""))
        if b is None:
            out[bn] = None
            continue
        # rest orientation, armature space, rounded for comparison
        m = b.matrix_local.to_3x3()
        out[bn] = tuple(round(v, 3) for row in m for v in row)
    return out

results = {name: rest_of(p) for name, p in FILES.items()}
ref = results["CHARACTER"]
print("[probe] bone rest-orientation match vs CHARACTER:", flush=True)
for name, r in results.items():
    if name == "CHARACTER" or r is None:
        continue
    for bn in BONES:
        a, b = ref.get(bn), r.get(bn)
        if a is None or b is None:
            verdict = "MISSING"
        else:
            diff = max(abs(x - y) for x, y in zip(a, b))
            verdict = f"match (maxdiff {diff:.3f})" if diff < 0.02 else f"DIFFERENT (maxdiff {diff:.3f})"
        print(f"[probe] {name:18} {bn:28} {verdict}", flush=True)
