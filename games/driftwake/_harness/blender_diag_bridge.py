"""Diagnostic 2: instrument the family-A bridge stage by stage.

For anim_idle.glb, dump for Hips / Spine / LeftUpLeg / LeftFoot / LeftArm:
  1. the raw glTF node ANIMATED world matrix at t=0 (json math, no Blender)
  2. the raw glTF node REST world matrix (json math)
  3. the imported EMPTY's matrix_world at frame f0 (what COPY_TRANSFORMS sees)
  4. the rebuilt edit bone's matrix_local (rest the retarget uses)
  5. the baked pose bone's matrix at f0
Each as: bone-Y direction (the axis a limb points along) + translation.

Run:
  blender --background --factory-startup --python _harness/blender_diag_bridge.py
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector

GAME = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(GAME, "tools"))
import blender_enemy_clips as EC  # noqa: E402

SRC = r"F:\assets\meshy-characters\_web_mixamo_pack\anims\anim_idle.glb"
WATCH = ["mixamorig:Hips", "mixamorig:Spine", "mixamorig:LeftUpLeg",
         "mixamorig:LeftFoot", "mixamorig:LeftArm"]


def yof(m):
    v = m.to_3x3() @ Vector((0.0, 1.0, 0.0))
    v.normalize()
    return "Y=(%5.2f,%5.2f,%5.2f) T=(%6.2f,%6.2f,%6.2f)" % (
        v.x, v.y, v.z, m.translation.x, m.translation.y, m.translation.z)


def gltf_anim_world_t0(path):
    """Node world matrices at the first animation keyframe, raw json math."""
    doc, blob = EC.glb_chunks(path)
    import struct as st
    CT = {5126: ("<f", 4)}

    def acc_first(ai):
        a = doc["accessors"][ai]
        bv = doc["bufferViews"][a["bufferView"]]
        off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        n = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}[a["type"]]
        fmt, sz = CT[a["componentType"]]
        return st.unpack_from("<%df" % n, blob, off)

    nodes = doc["nodes"]
    # start from the node base TRS, override with each channel's first key
    trs = {}
    for i, n in enumerate(nodes):
        trs[i] = [list(n.get("translation", (0, 0, 0))),
                  list(n.get("rotation", (0, 0, 0, 1))),
                  list(n.get("scale", (1, 1, 1)))]
    for ch in doc["animations"][0]["channels"]:
        tgt = ch["target"]["node"]
        v = acc_first(doc["animations"][0]["samplers"][ch["sampler"]]["output"])
        p = ch["target"]["path"]
        if p == "translation":
            trs[tgt][0] = list(v)
        elif p == "rotation":
            trs[tgt][1] = list(v)
        elif p == "scale":
            trs[tgt][2] = list(v)
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", ()):
            parent[c] = i
    cache = {}

    def local(i):
        t, q, s = trs[i]
        R = Quaternion((q[3], q[0], q[1], q[2])).to_matrix().to_4x4()
        return (Matrix.Translation(Vector(t)) @ R
                @ Matrix.Diagonal(Vector(s).to_4d()))

    def world(i):
        if i not in cache:
            p = parent.get(i)
            cache[i] = (world(p) @ local(i)) if p is not None else local(i)
        return cache[i]

    return {n["name"]: world(i) for i, n in enumerate(nodes) if n.get("name")}


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = EC.OUT_FPS

    print("\n[1] raw glTF ANIMATED world @ first key:")
    aw = gltf_anim_world_t0(SRC)
    for n in WATCH:
        print("   %-22s %s" % (n.replace("mixamorig:", ""), yof(aw[n])))

    print("\n[2] raw glTF REST world (rest_world_gltf):")
    rw = EC.rest_world_gltf(SRC)
    for n in WATCH:
        print("   %-22s %s" % (n.replace("mixamorig:", ""), yof(rw[n])))

    # ---- import, keep the empties alive for inspection --------------------
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=SRC)
    imported = [o for o in bpy.data.objects if o not in before]
    empties = {o.name: o for o in imported if o.type == "EMPTY"}
    print("\n[import] %d objects, %d empties; top-level objects:" % (
        len(imported), len(empties)))
    for o in imported:
        if o.parent is None:
            print("   top: %r type=%s rot_euler=%s scale=%s" % (
                o.name, o.type,
                tuple(round(math.degrees(e), 1) for e in o.rotation_euler),
                tuple(round(s, 3) for s in o.scale)))

    f0 = 10 ** 9
    for o in imported:
        ad = o.animation_data
        if ad and ad.action:
            f0 = min(f0, int(math.floor(ad.action.frame_range[0])))
    scn = bpy.context.scene
    deps = bpy.context.evaluated_depsgraph_get()
    scn.frame_set(f0)
    deps.update()
    print("\n[3] EMPTY matrix_world @ f0=%d:" % f0)
    for n in WATCH:
        if n in empties:
            print("   %-22s %s" % (n.replace("mixamorig:", ""),
                                   yof(empties[n].matrix_world)))
        else:
            print("   %-22s MISSING from empties dict!" % n)

    # ---- now run the real bridge (fresh import inside) --------------------
    for o in imported:
        bpy.data.objects.remove(o, do_unlink=True)
    arm = EC._build_family_a_armature(SRC, "SRC_BRIDGE")

    print("\n[4] rebuilt edit-bone rest (matrix_local):")
    for n in WATCH:
        print("   %-22s %s" % (n.replace("mixamorig:", ""),
                               yof(arm.data.bones[n].matrix_local)))

    scn.frame_set(f0)
    deps.update()
    print("\n[5] BAKED pose bone matrix @ f0:")
    for n in WATCH:
        print("   %-22s %s" % (n.replace("mixamorig:", ""),
                               yof(arm.pose.bones[n].matrix)))


main()
