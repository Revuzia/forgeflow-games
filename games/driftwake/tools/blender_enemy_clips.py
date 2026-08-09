"""Blender headless: retarget each Driftwake enemy body's clip kit onto ITS OWN rest pose.

WHY A SEPARATE BLENDER DRIVER
`build_enemy_assets.py` owns the roster maths and the manifest; it cannot import
`bpy`. This file is the Blender half: it takes a job JSON (bodies x resolved clip
paths), does the retarget through `blender_retarget.py`, and writes one
skeleton-only `<slug>_anims.glb` per body plus a result JSON the caller parses.

THREE SOURCE SHAPES, ONE ARMATURE
The 49 resolved source clips do not arrive in one form, and only two of the three
import as a Blender armature by themselves:

  fbx (36 of 49)          Mixamo download. Imports as ARMATURE + action, 65 bones,
                          object scale 0.01, and the importer OVERWRITES the scene
                          to 30 fps -- so its action is retimed x(24/30) onto the
                          24 fps output timeline before anything reads it.
  webglb family B (1)     'Khronos glTF Blender I/O' export, carries a skin, so the
                          importer builds a real armature. Its per-bone translation
                          and scale tracks are ignored: the retargeter consumes
                          orientation only (see blender_retarget.py).
  webglb family A (12)    'FBX2glTF v0.9.7' export with ZERO skins. The glTF importer
                          only builds armatures out of skins, so these land as 66
                          loose EMPTIES and there is no rig to retarget FROM.

The family-A bridge rebuilds the missing armature from the glTF node TRS, then
drives it with COPY_TRANSFORMS off the empties and bakes. That is only sound if a
family-A node's base TRS really is the Mixamo BIND pose rather than, say, frame 0
of the clip. MEASURED 2026-08-07 against two independent copies of the same
skeleton's bind pose (`--selftest` re-runs it):

    anim_idle.glb rebuilt rest  vs  mutant roaring.fbx   3x3 maxdiff 0.00000,
                                                         head delta 0.000000 m
    anim_idle.glb rebuilt rest  vs  anim_crouch.glb (B)  3x3 maxdiff 0.00001,
                                                         head delta 0.000016 m

Bone LOCAL AXIS convention does not have to match anything, incidentally: the
retarget invariant D = W(t) @ R_rest^-1 is unchanged by a constant right-multiply
of both W and R_rest, so any self-consistent axis choice retargets identically.

ONE FILE PER CLIP, THEN A JSON-LEVEL MERGE
Each retargeted action is exported on its own (`ACTIVE_ACTIONS`) and the resulting
GLBs are merged by rewriting the glTF JSON. That buys three things the exporter's
own multi-action modes do not: the animation NAME is whatever the game asks for
(never "mixamo.com"), identical sampler inputs are deduplicated across every clip
in the bundle, and each clip's byte cost is attributable -- which is the only way
to answer "which slot do I drop" when a realm goes over budget.

    blender --background --factory-startup --python blender_enemy_clips.py -- \
        --job job.json --result result.json
    blender --background --factory-startup --python blender_enemy_clips.py -- --selftest
"""
import json
import math
import os
import re
import struct
import sys
import time

import bpy
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blender_retarget as RT  # noqa: E402

# The output timeline. Every source is resampled onto it, so a bundle can hold a
# 24 fps web GLB and a 30 fps Mixamo FBX and still report honest durations.
# 24 is the rate the web clips were authored at and is well past the point where
# an enemy 8 m from the camera reads as smoother.
OUT_FPS = 24

# RETIRED 2026-08-07 (owner correction). This used to drive a pass that deleted
# every finger fcurve, on the theory that a finger joint is sub-pixel at enemy
# scale. Measured against the source library, that theory is false: in
# anim_run.glb the finger bones swing 26.8 deg (body peak 105 deg), and deleting
# a track drops its bone to BIND pose -- flat splayed T-pose fingers -- rather
# than leaving it where the clip put it. Fingers are KEPT. See reduce_keyframes()
# for where the size actually comes from. The pattern stays only so the audit can
# report finger coverage; nothing removes tracks any more.
FINGER_RE = re.compile(r"^mixamorig:(Left|Right)Hand(Thumb|Index|Middle|Ring|Pinky)\d+$")

YUP2ZUP = Matrix.Rotation(math.radians(90.0), 4, "X")

_SELFTEST_A = r"F:\assets\meshy-characters\_web_mixamo_pack\anims\anim_idle.glb"
_SELFTEST_B = r"F:\assets\meshy-characters\_web_mixamo_pack\anims\anim_crouch.glb"
_SELFTEST_FBX = (r"F:\games\forgeflow-games-assets\_downloaded\mixamo\animations"
                 r"\Creature_Pack\mutant roaring.fbx")


def log(*a):
    print("[clips]", *a, flush=True)


# --------------------------------------------------------------------- glTF I/O
def glb_chunks(path):
    """(json_dict, bin_bytes) of a GLB."""
    with open(path, "rb") as f:
        magic, _ver, total = struct.unpack("<III", f.read(12))
        if magic != 0x46546C67:
            raise ValueError("not a GLB: " + path)
        doc, blob = None, b""
        while f.tell() < total:
            head = f.read(8)
            if len(head) < 8:
                break
            clen, ctype = struct.unpack("<II", head)
            data = f.read(clen)
            if ctype == 0x4E4F534A:
                doc = json.loads(data.decode("utf-8"))
            elif ctype == 0x004E4942:
                blob = data
        return doc, blob


def write_glb(path, doc, blob):
    js = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    js += b" " * (-len(js) % 4)
    bl = blob + b"\0" * (-len(blob) % 4)
    total = 12 + 8 + len(js) + (8 + len(bl) if bl else 0)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A))
        f.write(js)
        if bl:
            f.write(struct.pack("<II", len(bl), 0x004E4942))
            f.write(bl)


def _node_local(n):
    if "matrix" in n:
        m = n["matrix"]
        return Matrix([[m[0], m[4], m[8], m[12]], [m[1], m[5], m[9], m[13]],
                       [m[2], m[6], m[10], m[14]], [m[3], m[7], m[11], m[15]]])
    t = Vector(n.get("translation", (0.0, 0.0, 0.0)))
    q = n.get("rotation", (0.0, 0.0, 0.0, 1.0))
    s = Vector(n.get("scale", (1.0, 1.0, 1.0)))
    R = Quaternion((q[3], q[0], q[1], q[2])).to_matrix().to_4x4()
    return Matrix.Translation(t) @ R @ Matrix.Diagonal(s.to_4d())


def rest_world_gltf(path):
    """Rest world matrix per named node, converted to Blender's Z-up space."""
    doc, _ = glb_chunks(path)
    nodes = doc["nodes"]
    parent = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", ()):
            parent[c] = i
    cache, out = {}, {}

    def world(i):
        if i not in cache:
            m = _node_local(nodes[i])
            p = parent.get(i)
            cache[i] = (world(p) @ m) if p is not None else m
        return cache[i]

    for i, n in enumerate(nodes):
        if n.get("name"):
            # NO YUP2ZUP. This rest feeds blender_retarget's world-space delta
            # D(n) = W_src(n,t) @ R_rest_src(n)^-1. A left-multiplied axis
            # conversion appears in BOTH terms, so for any bone with a parent it
            # cancels by conjugation -- but the retarget forces D(root) = I, so on
            # the ROOT it does not, and the whole body arrives 90 deg about X:
            # measured, our idle Hips rot[0] was 93.8 deg against the source's 7.0.
            # The target body armature carries no such conversion, so the source
            # must not either.
            out[n["name"]] = world(i)
    return out


def gltf_parent_names(path):
    doc, _ = glb_chunks(path)
    nodes = doc["nodes"]
    out = {}
    for n in nodes:
        for c in n.get("children", ()):
            if n.get("name") and nodes[c].get("name"):
                out[nodes[c]["name"]] = n["name"]
    return out


# ------------------------------------------------------- Blender 5.x action API
def act_fcurves(act):
    """Blender 4.4+ moved fcurves behind slotted actions; Action.fcurves is gone
    in 5.1 (AttributeError, probed 2026-08-07)."""
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


def act_channelbags(act):
    for layer in act.layers:
        for strip in layer.strips:
            if strip.type != "KEYFRAME":
                continue
            for slot in act.slots:
                cb = strip.channelbag(slot)
                if cb:
                    yield cb


def retime_action(act, factor):
    """Scale every keyframe's frame number -- the resample onto OUT_FPS."""
    if abs(factor - 1.0) < 1e-9:
        return
    for fc in act_fcurves(act):
        for kp in fc.keyframe_points:
            kp.co.x *= factor
            kp.handle_left.x *= factor
            kp.handle_right.x *= factor
        fc.update()


# Rotation quaternion components live in [-1,1]; a whole-bone angular error of
# THETA degrees perturbs a component by about sin(THETA/2). 0.25 deg -> 0.0022.
# That is well under the ~0.4 deg quantisation an artist would accept and far
# under what survives being drawn on a 1.2 m body at 10-40 m.
ROT_TOL = 0.0022
# Hips translation is carried as a hip-height-relative ratio, so this is a
# fraction of the body's own hip height, not metres. 0.0015 of a ~1 m hip is
# 1.5 mm of vertical bob error.
LOC_TOL = 0.0015


def _rdp_keep(points, tol):
    """Ramer-Douglas-Peucker over (frame, value): which indices must survive.

    A keyframe is redundant when removing it moves the curve by less than `tol`
    at that frame -- i.e. when it already lies on the straight line between the
    keys that would remain. Endpoints are always kept, so clip length and the
    pose at t=0 and t=end are exact.
    """
    n = len(points)
    if n <= 2:
        return set(range(n))
    keep = {0, n - 1}
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        x0, y0 = points[a]
        x1, y1 = points[b]
        dx = x1 - x0
        worst, wi = -1.0, -1
        for i in range(a + 1, b):
            x, y = points[i]
            lin = y0 if dx == 0 else y0 + (y1 - y0) * (x - x0) / dx
            d = abs(y - lin)
            if d > worst:
                worst, wi = d, i
        if worst > tol:
            keep.add(wi)
            stack.append((a, wi))
            stack.append((wi, b))
    return keep


def reduce_keyframes(act):
    """Drop keyframes that no longer describe anything, track by track.

    WHY THIS AND NOT FINGER-STRIPPING (owner correction 2026-08-07):
    an earlier pass deleted all ~30 finger fcurves on the theory that fingers are
    invisible at enemy scale. MEASURED, and it is wrong: in `anim_run.glb` the
    finger bones swing 26.8 deg (body peak 105 deg). Worse, deleting a track does
    not freeze the bone where the clip left it -- it drops the bone back to BIND
    pose, which on a Mixamo rig is flat splayed T-pose fingers. That is a visible
    downgrade on every weapon-holding role, paid to save bytes that were never the
    problem.

    The bytes were somewhere else entirely. In the pilot bundle, `idle` was 32% of
    the file: 200 keyframes spent describing 1.8 degrees of breathing. So this
    keeps EVERY track at full fidelity -- all 52, fingers included -- and instead
    removes keys that lie within an imperceptible tolerance of the interpolation
    between their neighbours. Near-static tracks collapse toward two keys; a run
    cycle or an attack keeps the detail that earns its place. Strictly better than
    the strip: smaller AND higher fidelity.

    Returns (keys_before, keys_after, tracks).
    """
    before = after = tracks = 0
    for fc in act_fcurves(act):
        pts = [(kp.co.x, kp.co.y) for kp in fc.keyframe_points]
        before += len(pts)
        tracks += 1
        if len(pts) <= 2:
            after += len(pts)
            continue
        tol = ROT_TOL if "rotation" in fc.data_path else LOC_TOL
        keep = _rdp_keep(pts, tol)
        for i in range(len(pts) - 1, -1, -1):
            if i not in keep:
                fc.keyframe_points.remove(fc.keyframe_points[i], fast=True)
        fc.update()
        after += len(keep)
    return before, after, tracks


def keyed_bone_names(act):
    """Bone names this action actually drives -- the coverage check's input."""
    names = set()
    pat = re.compile(r'pose\.bones\["([^"]+)"\]')
    for fc in act_fcurves(act):
        m = pat.match(fc.data_path)
        if m:
            names.add(m.group(1))
    return names


# ------------------------------------------------------------- scene management
def purge_objects(objs):
    for o in objs:
        if o.name in bpy.data.objects:
            bpy.data.objects.remove(o, do_unlink=True)


def reset_pose(arm):
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)


# ---------------------------------------------------------------- source clips
def _build_family_a_armature(path, name):
    """Rebuild the missing armature for a 0-skin FBX2glTF clip and bake the
    empties' motion onto it. See the module docstring for why this is sound."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    imported = [o for o in bpy.data.objects if o not in before]
    empties = {o.name: o for o in imported if o.type == "EMPTY"}

    rest = {k: v for k, v in rest_world_gltf(path).items() if k.startswith("mixamorig:")}
    parents = gltf_parent_names(path)

    arm_data = bpy.data.armatures.new(name)
    arm = bpy.data.objects.new(name, arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm

    bpy.ops.object.mode_set(mode="EDIT")
    eb = {}
    for nm, m in rest.items():
        b = arm_data.edit_bones.new(nm)
        b.head, b.tail = (0.0, 0.0, 0.0), (0.0, 0.1, 0.0)
        r = m.to_3x3()
        for i in range(3):
            r[i].normalize()
        mm = r.to_4x4()
        mm.translation = m.translation
        b.matrix = mm
        eb[nm] = b
    for nm in rest:
        p = parents.get(nm)
        if p in eb:
            eb[nm].parent = eb[p]
    bpy.ops.object.mode_set(mode="OBJECT")

    for nm in rest:
        if nm in empties:
            c = arm.pose.bones[nm].constraints.new("COPY_TRANSFORMS")
            c.target = empties[nm]

    f0, f1 = 10 ** 9, -(10 ** 9)
    for o in imported:
        ad = o.animation_data
        if ad and ad.action:
            fr = ad.action.frame_range
            f0 = min(f0, int(math.floor(fr[0])))
            f1 = max(f1, int(math.ceil(fr[1])))
    if f1 < f0:
        raise RuntimeError("no animation in " + path)

    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.nla.bake(frame_start=f0, frame_end=f1, only_selected=False,
                     visual_keying=True, clear_constraints=True,
                     clear_parents=False, use_current_action=False,
                     bake_types={"POSE"})
    bpy.ops.object.mode_set(mode="OBJECT")
    purge_objects(imported)
    return arm


def load_source(path, name):
    """Import one resolved source clip as an armature carrying its action, with
    the action retimed onto the OUT_FPS timeline."""
    scn = bpy.context.scene
    ext = os.path.splitext(path)[1].lower()
    if ext == ".fbx":
        scn.render.fps = OUT_FPS
        before = set(bpy.data.objects)
        bpy.ops.import_scene.fbx(filepath=path)
        imported = [o for o in bpy.data.objects if o not in before]
        arm = next(o for o in imported if o.type == "ARMATURE")
        purge_objects([o for o in imported if o is not arm])
        src_fps = scn.render.fps  # the FBX importer overwrites this from the file
        arm.name = name
        retime_action(arm.animation_data.action, OUT_FPS / float(src_fps))
        scn.render.fps = OUT_FPS
        return arm

    scn.render.fps = OUT_FPS
    doc, _ = glb_chunks(path)
    if doc.get("skins"):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=path)
        imported = [o for o in bpy.data.objects if o not in before]
        arm = next(o for o in imported if o.type == "ARMATURE")
        purge_objects([o for o in imported if o is not arm])
        arm.name = name
        return arm
    return _build_family_a_armature(path, name)


# --------------------------------------------------------------- glTF merging
_COMP_SIZE = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
_TYPE_COUNT = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def _accessor_bytes(doc, blob, idx):
    acc = doc["accessors"][idx]
    bv = doc["bufferViews"][acc["bufferView"]]
    stride = _COMP_SIZE[acc["componentType"]] * _TYPE_COUNT[acc["type"]]
    off = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    return blob[off:off + stride * acc["count"]]


def merge_clip_glbs(parts, out_path):
    """parts = [(slot_name, glb_path)]. Emits one bundle; returns per-clip stats.

    Every part is an export of the SAME armature, so the node arrays must match
    exactly -- asserted, because a channel whose target index shifted would drive
    the wrong bone silently."""
    base_doc, base_blob = glb_chunks(parts[0][1])
    node_names = [n.get("name") for n in base_doc.get("nodes", ())]

    out_bin = bytearray()
    out_bvs, out_accs, out_anims, stats = [], [], [], []
    dedupe = {}

    def put_accessor(doc, blob, idx, is_input):
        acc = doc["accessors"][idx]
        raw = bytes(_accessor_bytes(doc, blob, idx))
        key = (acc["componentType"], acc["count"], acc["type"],
               bool(acc.get("normalized")), raw)
        if key in dedupe:
            return dedupe[key], 0
        while len(out_bin) % 4:
            out_bin.append(0)
        off = len(out_bin)
        out_bin.extend(raw)
        out_bvs.append({"buffer": 0, "byteOffset": off, "byteLength": len(raw)})
        new = {"bufferView": len(out_bvs) - 1, "componentType": acc["componentType"],
               "count": acc["count"], "type": acc["type"]}
        if acc.get("normalized"):
            new["normalized"] = True
        # min/max are MANDATORY on an animation sampler's input and pointless on
        # its output. Blender writes both; carrying the output pair costs ~120
        # bytes of JSON per accessor -- 18 KiB across a nine-clip bundle.
        if is_input:
            for k in ("min", "max"):
                if k in acc:
                    new[k] = acc[k]
        out_accs.append(new)
        dedupe[key] = len(out_accs) - 1
        return len(out_accs) - 1, len(raw)

    for slot, path in parts:
        doc, blob = glb_chunks(path)
        names = [n.get("name") for n in doc.get("nodes", ())]
        if names != node_names:
            raise RuntimeError("node array drift in %s (%s)" % (path, slot))
        if len(doc.get("animations", ())) != 1:
            raise RuntimeError("%s: expected exactly 1 animation, got %d"
                               % (path, len(doc.get("animations", ()))))
        anim = doc["animations"][0]
        added, dur = 0, 0.0
        samplers = []
        for s in anim["samplers"]:
            i_idx, n1 = put_accessor(doc, blob, s["input"], True)
            o_idx, n2 = put_accessor(doc, blob, s["output"], False)
            added += n1 + n2
            dur = max(dur, float(doc["accessors"][s["input"]].get("max", [0.0])[0]))
            samplers.append({"input": i_idx, "output": o_idx,
                             "interpolation": s.get("interpolation", "LINEAR")})
        out_anims.append({"name": slot, "samplers": samplers,
                          "channels": [dict(c) for c in anim["channels"]]})
        stats.append({"name": slot, "bytes": added, "durationS": round(dur, 4),
                      "channels": len(anim["channels"]),
                      "bones": sorted({node_names[c["target"]["node"]]
                                       for c in anim["channels"]})})

    base_doc["bufferViews"] = out_bvs
    base_doc["accessors"] = out_accs
    base_doc["animations"] = out_anims
    base_doc["buffers"] = [{"byteLength": len(out_bin)}]
    for k in ("meshes", "skins", "images", "materials", "textures", "samplers"):
        base_doc.pop(k, None)
    base_doc["asset"] = {"version": "2.0",
                         "generator": "driftwake tools/blender_enemy_clips.py"}
    write_glb(out_path, base_doc, bytes(out_bin))
    return stats


# ------------------------------------------------------------------ export leg
_EXPORT_KW = {
    "export_format": "GLB",
    "use_selection": True,
    "export_animations": True,
    "export_animation_mode": "ACTIVE_ACTIONS",
    "export_anim_slide_to_zero": True,
    "export_optimize_animation_size": True,
    "export_optimize_animation_keep_anim_armature": False,
    "export_bake_animation": False,
    "export_frame_range": False,
    "export_current_frame": False,
    "export_rest_position_armature": True,
    "export_anim_single_armature": True,
    "export_def_bones": False,
    "export_materials": "NONE",
    "export_apply": False,
    "export_extras": False,
    "export_cameras": False,
    "export_lights": False,
    "export_yup": True,
}
_export_kw_cache = None


def export_kwargs():
    """Filter against the operator's actual RNA -- exporter flags come and go
    between Blender releases and an unknown keyword is a hard TypeError."""
    global _export_kw_cache
    if _export_kw_cache is None:
        props = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
        _export_kw_cache = {k: v for k, v in _EXPORT_KW.items() if k in props}
        dropped = sorted(set(_EXPORT_KW) - set(_export_kw_cache))
        if dropped:
            log("exporter does not know these flags, dropped:", dropped)
    return _export_kw_cache


def export_active_action(arm, path):
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(filepath=path, **export_kwargs())


# ---------------------------------------------------------------------- bodies
def load_body(path, name="TGT"):
    """Import an enemy body and strip it back to a bare, un-posed armature."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    imported = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in imported if o.type == "ARMATURE")
    purge_objects([o for o in imported if o is not arm])
    arm.name = name
    # The bodies ship one animation, "mixamo.com", with a single key at t=0 --
    # bind pose, no motion. Clearing it leaves the last evaluated pose behind,
    # so the basis has to be reset by hand or every clip inherits that offset.
    if arm.animation_data:
        arm.animation_data_clear()
    reset_pose(arm)
    return arm


def build_body(body, tmpdir, sources):
    slug = body["slug"]
    t0 = time.time()
    arm = load_body(body["mesh"], "TGT_" + slug)
    rig_bones = {b.name for b in arm.data.bones}
    parts, per_clip, made = [], [], []
    try:
        for c in body["clips"]:
            slot, path = c["slot"], c["path"]
            src = sources.get(path)
            if src is None:
                src = load_source(path, "SRC_%03d" % len(sources))
                sources[path] = src
            reset_pose(arm)
            act = RT.retarget_action(src, arm, "%s|%s" % (slug, slot))
            kept = keyed_bone_names(act)
            kb, ka, ktracks = reduce_keyframes(act)
            arm.animation_data.action = act
            out = os.path.join(tmpdir, "%s__%s.glb" % (slug, slot))
            export_active_action(arm, out)
            parts.append((slot, out))
            made.append(act)
            per_clip.append({"slot": slot, "src": path,
                             "tracks": ktracks,
                             "keysBefore": kb, "keysAfter": ka,
                             "keyReductionPct": round(100.0 * (1 - ka / kb), 1) if kb else 0,
                             "bonesKeyed": len(kept),
                             "bonesOutsideRig": sorted(kept - rig_bones)})
        stats = merge_clip_glbs(parts, body["out"])
    finally:
        for a in made:
            a.use_fake_user = False
            if a.name in bpy.data.actions:
                try:
                    bpy.data.actions.remove(a)
                except Exception:
                    pass
        purge_objects([arm])
        for _slot, p in parts:
            try:
                os.remove(p)
            except OSError:
                pass
    by_slot = {s["name"]: s for s in stats}
    for pc in per_clip:
        s = by_slot.get(pc["slot"], {})
        pc["bytes"] = s.get("bytes")
        pc["durationS"] = s.get("durationS")
        pc["channels"] = s.get("channels")
    return {"slug": slug, "ok": True, "out": body["out"],
            "bytes": os.path.getsize(body["out"]),
            "rigBones": len(rig_bones), "clips": per_clip,
            "seconds": round(time.time() - t0, 1)}


# -------------------------------------------------------------------- selftest
def selftest():
    """identity_test() plus the family-A bind-pose claim this tool rests on."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = OUT_FPS
    arm = load_source(_SELFTEST_A, "SELFTEST_SRC")
    act = arm.animation_data.action
    log("selftest source: %s bones=%d action=%s range=%s fcurves=%d"
        % (os.path.basename(_SELFTEST_A), len(arm.data.bones), act.name,
           tuple(act.frame_range), len(act_fcurves(act))))
    ok, worst, who = RT.identity_test(arm)
    log("identity_test: ok=%s worst=%.3e bone=%s tolerance=1e-04" % (ok, worst, who))

    def norm3(m):
        r = m.to_3x3()
        for i in range(3):
            r[i].normalize()
        return r

    mine = {b.name: (norm3(arm.matrix_world @ b.matrix_local),
                     (arm.matrix_world @ b.matrix_local).translation)
            for b in arm.data.bones}
    for label, path in (("mutant roaring.fbx", _SELFTEST_FBX),
                        ("anim_crouch.glb (family B)", _SELFTEST_B)):
        ref = load_source(path, "SELFTEST_REF")
        wo = wp = 0.0
        for b in ref.data.bones:
            if b.name not in mine:
                continue
            r = norm3(ref.matrix_world @ b.matrix_local)
            p = (ref.matrix_world @ b.matrix_local).translation
            wo = max(wo, max(abs(r[i][j] - mine[b.name][0][i][j])
                             for i in range(3) for j in range(3)))
            wp = max(wp, (p - mine[b.name][1]).length)
        log("family-A rest vs %-26s 3x3 maxdiff=%.5f  head delta=%.6f m"
            % (label, wo, wp))
        purge_objects([ref])
    return 0 if ok else 3


# ------------------------------------------------------------------------ main
def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if "--selftest" in argv:
        return selftest()
    job_path = argv[argv.index("--job") + 1]
    res_path = argv[argv.index("--result") + 1]
    job = json.load(open(job_path, encoding="utf-8"))
    tmpdir = os.path.join(os.path.dirname(res_path), "_clipparts")
    os.makedirs(tmpdir, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = OUT_FPS
    sources, results = {}, []
    # Bodies arrive grouped by animRole so the source armatures -- the expensive
    # part, a family-A bake is 200 frames x 65 bones -- are imported once and
    # reused by every body that shares the role.
    for i, body in enumerate(job["bodies"]):
        log("[%d/%d] %s" % (i + 1, len(job["bodies"]), body["slug"]))
        try:
            r = build_body(body, tmpdir, sources)
            log("      ok  %.0f KiB  %.1fs" % (r["bytes"] / 1024.0, r["seconds"]))
        except Exception as exc:  # one bad body must not kill the batch
            import traceback
            traceback.print_exc()
            r = {"slug": body["slug"], "ok": False,
                 "error": "%s: %s" % (type(exc).__name__, exc)}
            log("      FAIL", r["error"])
        results.append(r)
    with open(res_path, "w", encoding="utf-8") as f:
        json.dump({"fps": OUT_FPS, "bodies": results}, f, indent=1)
    return 0 if all(r.get("ok") for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
