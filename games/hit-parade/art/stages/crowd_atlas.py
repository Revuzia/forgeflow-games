"""HIT PARADE - crowd impostor bake (lane STAGES).

Renders the 6 crowd bodies (research ROSTER "Crowd bodies for baked impostors") in cheer/jeer
poses from several view angles as toon-shaded, outlined, transparent cells. A second step
(crowd_compose.py, plain Python + PIL) packs the cells into art/gltf/stages/crowd_atlas.webp
+ crowd_atlas.json.

Poses come from X Bot Mixamo clips, applied to each body with a STATIC hybrid retarget
(research rig_compat.md): body bones = world-space delta from rest; finger bones = parent-relative
copy (fist/hand shape); hips = body rest + vertical source delta x hip ratio; horizontal root
motion stripped; the posed body is then dropped so its lowest vertex sits on the floor.

Usage (blender.exe directly, logs visible):
  blender.exe --background --python art/stages/crowd_atlas.py -- preview <out_dir> <body_id> <clip_ids_csv|all>
  blender.exe --background --python art/stages/crowd_atlas.py -- bake <out_dir> [<body_id_csv>]
The plan (bodies, poses = clip + frame, angles) lives in art/stages/crowd_plan.json.
ASCII only.
"""
import bpy
import sys
import os
import json
import math
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
PLAN = json.load(open(os.path.join(HERE, "crowd_plan.json"), encoding="utf-8"))
MIX = PLAN["mixamoRoot"]
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
MODE = argv[0] if argv else "bake"
OUT = os.path.abspath(argv[1] if len(argv) > 1 else os.path.join(HERE, "_out"))
if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)

CELL = PLAN["cell"]                       # {"w": 256, "h": 512, "supersample": 2, "frameM": [-0.05, 2.35], "widthM": 1.2}
SS = CELL["supersample"]
RX, RY = CELL["w"] * SS, CELL["h"] * SS
Y0, Y1 = CELL["frameM"]
FRAME_H = Y1 - Y0


def log(*a):
    print("[crowd]", *a, flush=True)


def strip(n):
    return n.split(":")[-1]


def is_finger(n):
    return "Hand" in n and n not in ("LeftHand", "RightHand")


# ---------------------------------------------------------------- scene
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scn = bpy.context.scene
    try:
        scn.render.engine = "BLENDER_EEVEE"
    except TypeError:
        scn.render.engine = "BLENDER_EEVEE_NEXT"
    scn.render.resolution_x = RX
    scn.render.resolution_y = RY
    scn.render.resolution_percentage = 100
    scn.render.film_transparent = True
    scn.render.image_settings.file_format = "PNG"
    scn.render.image_settings.color_mode = "RGBA"
    scn.render.image_settings.color_depth = "8"
    scn.view_settings.view_transform = "Standard"
    scn.view_settings.look = "None"
    scn.view_settings.exposure = 0.0
    scn.view_settings.gamma = 1.0
    try:
        scn.eevee.taa_render_samples = 32
    except AttributeError:
        pass
    # world: flat dim ambient (the toon ramp does the shaping)
    w = bpy.data.worlds.new("W")
    scn.world = w
    w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs[0].default_value = (0.20, 0.20, 0.22, 1.0)
    bg.inputs[1].default_value = 1.0
    # key sun: front-left-high (camera on -Y looking +Y; the character faces -Y)
    kd = bpy.data.lights.new("key", "SUN")
    kd.energy = 3.2
    kd.angle = math.radians(8)
    ko = bpy.data.objects.new("key", kd)
    scn.collection.objects.link(ko)
    ko.rotation_euler = (math.radians(52), 0.0, math.radians(-48))
    # camera: orthographic, sensor fit vertical so ortho_scale = frame height in metres
    cd = bpy.data.cameras.new("cam")
    cd.type = "ORTHO"
    cd.sensor_fit = "VERTICAL"
    cd.ortho_scale = FRAME_H
    cd.clip_start = 0.1
    cd.clip_end = 50.0
    co = bpy.data.objects.new("cam", cd)
    scn.collection.objects.link(co)
    co.location = (0.0, -10.0, (Y0 + Y1) * 0.5)
    co.rotation_euler = (math.radians(90), 0.0, 0.0)
    scn.camera = co
    return scn


def import_fbx(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == "ARMATURE")
    meshes = [o for o in new if o.type == "MESH"]
    return arm, meshes, new


# ---------------------------------------------------------------- materials
def find_image(node, seen=None):
    """First TEX_IMAGE reachable upstream of a socket-owning node."""
    seen = seen or set()
    if node in seen:
        return None
    seen.add(node)
    if node.type == "TEX_IMAGE":
        return node
    for inp in node.inputs:
        for l in inp.links:
            r = find_image(l.from_node, seen)
            if r:
                return r
    return None


def toon_material(src, name, outline=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    if outline:
        em = nt.nodes.new("ShaderNodeEmission")
        em.inputs["Color"].default_value = (0.018, 0.016, 0.022, 1.0)
        nt.links.new(em.outputs[0], out.inputs["Surface"])
        m.use_backface_culling = True
        return m
    # albedo
    img_node = None
    base_col = (0.6, 0.6, 0.6, 1.0)
    alpha_linked = False
    if src and src.use_nodes:
        pr = next((n for n in src.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if pr:
            bc = pr.inputs["Base Color"]
            if bc.links:
                img_node = find_image(bc.links[0].from_node)
            else:
                base_col = tuple(bc.default_value)
            alpha_linked = bool(pr.inputs["Alpha"].links)
    tex = None
    if img_node and img_node.image:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img_node.image
        tex.interpolation = "Linear"
    # lighting term -> 3-band ramp
    dif = nt.nodes.new("ShaderNodeBsdfDiffuse")
    dif.inputs["Color"].default_value = (1, 1, 1, 1)
    s2r = nt.nodes.new("ShaderNodeShaderToRGB")
    nt.links.new(dif.outputs[0], s2r.inputs[0])
    bw = nt.nodes.new("ShaderNodeRGBToBW")
    nt.links.new(s2r.outputs["Color"], bw.inputs[0])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    els = ramp.color_ramp.elements
    bands = PLAN["toon"]["bands"]        # [[pos, value], ...]
    els[0].position = bands[0][0]
    els[0].color = (bands[0][1],) * 3 + (1,)
    els[1].position = bands[1][0]
    els[1].color = (bands[1][1],) * 3 + (1,)
    for p, v in bands[2:]:
        e = els.new(p)
        e.color = (v, v, v, 1)
    nt.links.new(bw.outputs[0], ramp.inputs[0])
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs["Factor"].default_value = 1.0
    if tex:
        nt.links.new(tex.outputs["Color"], mul.inputs["A"])
    else:
        mul.inputs["A"].default_value = base_col
    nt.links.new(ramp.outputs["Color"], mul.inputs["B"])
    # rim: facing term, upper-facing normals only, warm
    lw = nt.nodes.new("ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = PLAN["toon"]["rimBlend"]
    rr = nt.nodes.new("ShaderNodeValToRGB")
    rr.color_ramp.interpolation = "CONSTANT"
    rr.color_ramp.elements[0].color = (0, 0, 0, 1)
    rr.color_ramp.elements[1].position = PLAN["toon"]["rimAt"]
    rr.color_ramp.elements[1].color = (1, 1, 1, 1)
    nt.links.new(lw.outputs["Facing"], rr.inputs[0])
    rim = nt.nodes.new("ShaderNodeMix")
    rim.data_type = "RGBA"
    rim.blend_type = "ADD"
    rc = PLAN["toon"]["rimColor"]
    rim_col = nt.nodes.new("ShaderNodeMix")
    rim_col.data_type = "RGBA"
    rim_col.blend_type = "MULTIPLY"
    rim_col.inputs["Factor"].default_value = 1.0
    rim_col.inputs["B"].default_value = (rc[0], rc[1], rc[2], 1)
    nt.links.new(rr.outputs["Color"], rim_col.inputs["A"])
    nt.links.new(mul.outputs["Result"], rim.inputs["A"])
    nt.links.new(rim_col.outputs["Result"], rim.inputs["B"])
    rim.inputs["Factor"].default_value = 1.0
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(rim.outputs["Result"], em.inputs["Color"])
    em.inputs["Strength"].default_value = 1.0
    if tex and alpha_linked:
        tr = nt.nodes.new("ShaderNodeBsdfTransparent")
        mx = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(tex.outputs["Alpha"], mx.inputs["Fac"])
        nt.links.new(tr.outputs[0], mx.inputs[1])
        nt.links.new(em.outputs[0], mx.inputs[2])
        nt.links.new(mx.outputs[0], out.inputs["Surface"])
        try:
            m.surface_render_method = "DITHERED"
        except AttributeError:
            pass
    else:
        nt.links.new(em.outputs[0], out.inputs["Surface"])
    return m


def setup_body(meshes):
    outline = toon_material(None, "outline", outline=True)
    for o in meshes:
        mats = []
        for i, slot in enumerate(o.material_slots):
            mats.append(toon_material(slot.material, "%s_toon_%d" % (o.name, i)))
        o.data.materials.clear()
        for mm in mats:
            o.data.materials.append(mm)
        o.data.materials.append(outline)
        mod = o.modifiers.new("outline", "SOLIDIFY")
        ws = o.matrix_world.to_scale()[0] or 1.0
        mod.thickness = PLAN["toon"]["outlineM"] / ws
        mod.offset = 1.0
        mod.use_flip_normals = True
        mod.use_rim = False
        mod.material_offset = len(mats)
        mod.material_offset_rim = len(mats)


# ---------------------------------------------------------------- retarget
def hier(arm):
    out, seen = [], set()

    def visit(b):
        if b.name in seen:
            return
        if b.parent:
            visit(b.parent)
        seen.add(b.name)
        out.append(b)
    for b in arm.data.bones:
        visit(b)
    return out


def hip_height_world(arm):
    wm = arm.matrix_world
    zs = [(wm @ b.head_local).z for b in arm.data.bones]
    hb = next(b for b in arm.data.bones if strip(b.name) == "Hips")
    return (wm @ hb.head_local).z - min(zs)


def pose_static(src, tgt, order):
    """Pose tgt from src's CURRENT evaluated pose (hybrid world-space retarget, no root travel)."""
    S_pb = {strip(pb.name): pb for pb in src.pose.bones}
    S_b = {strip(b.name): b for b in src.data.bones}
    Sw = src.matrix_world
    Tw = tgt.matrix_world
    Sw3 = Sw.to_3x3().normalized()
    Tw3 = Tw.to_3x3().normalized()
    Tw3i = Tw3.inverted()
    ratio = hip_height_world(tgt) / hip_height_world(src)
    D = {}
    for b in order:
        n = strip(b.name)
        par = b.parent
        rest_arm = b.matrix_local
        if n in S_pb and not (is_finger(n) and par is not None and strip(par.name) in S_pb):
            s_rest = (Sw3 @ S_b[n].matrix_local.to_3x3()).normalized()
            s_pose = (Sw3 @ S_pb[n].matrix.to_3x3()).normalized()
            t_rest = (Tw3 @ rest_arm.to_3x3()).normalized()
            want_w = s_pose @ s_rest.inverted() @ t_rest
            R = (Tw3i @ want_w).normalized()
        elif n in S_pb:
            # finger: parent-relative copy of the source's local rotation
            sp = S_pb[strip(par.name)].matrix.to_3x3().normalized()
            ls = sp.inverted() @ S_pb[n].matrix.to_3x3().normalized()
            R = (D[par.name].to_3x3() @ ls).normalized()
        else:
            R = None
        if par is None:
            # hips: rest head + vertical source delta x ratio (horizontal travel stripped)
            s_rest_h = Sw @ S_b[n].head_local
            s_pose_h = Sw @ S_pb[n].head
            dz = (s_pose_h - s_rest_h).z * ratio
            pos = rest_arm.translation + Tw3i @ Vector((0.0, 0.0, dz)) / Tw.to_scale()[0]
            if R is None:
                R = rest_arm.to_3x3()
        else:
            local = par.matrix_local.inverted() @ rest_arm.translation
            pos = D[par.name] @ local
            if R is None:
                R = D[par.name].to_3x3() @ (par.matrix_local.to_3x3().inverted() @ rest_arm.to_3x3())
        M = R.to_4x4()
        M.translation = pos
        D[b.name] = M
    for b in order:
        pb = tgt.pose.bones[b.name]
        if b.parent is None:
            pb.matrix_basis = b.matrix_local.inverted() @ D[b.name]
        else:
            rel = b.parent.matrix_local.inverted() @ b.matrix_local
            pb.matrix_basis = rel.inverted() @ D[b.parent.name].inverted() @ D[b.name]
    return ratio


def mesh_min_max(meshes):
    dg = bpy.context.evaluated_depsgraph_get()
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in meshes:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        mw = o.matrix_world
        for v in me.vertices:
            p = mw @ v.co
            lo.x, lo.y, lo.z = min(lo.x, p.x), min(lo.y, p.y), min(lo.z, p.z)
            hi.x, hi.y, hi.z = max(hi.x, p.x), max(hi.y, p.y), max(hi.z, p.z)
        ev.to_mesh_clear()
    return lo, hi


# ---------------------------------------------------------------- clips
_clip_cache = {}


def load_clip(clip_id):
    if clip_id in _clip_cache:
        return _clip_cache[clip_id]
    rel = PLAN["clips"][clip_id]
    arm, meshes, new = import_fbx(os.path.join(MIX, "animations", rel))
    for o in new:
        if o is not arm:
            bpy.data.objects.remove(o, do_unlink=True)
    arm.hide_render = True
    arm.location.x += 20.0   # out of frame
    act = arm.animation_data.action if arm.animation_data else None
    fr = tuple(act.frame_range) if act else (1, 1)
    _clip_cache[clip_id] = (arm, fr)
    log("clip", clip_id, "frames", fr)
    return arm, fr


def activate_clip(clip_id, frame):
    arm, fr = load_clip(clip_id)
    # only this clip's armature is evaluated at the frame; others keep their own actions
    bpy.context.scene.frame_set(int(frame))
    bpy.context.view_layer.update()
    return arm


def load_body(body_id):
    path = os.path.join(MIX, "characters", PLAN["bodies"][body_id]["file"])
    arm, meshes, new = import_fbx(path)
    # the body FBX carries its own (bind) action; render re-evaluation would reset our pose
    if arm.animation_data:
        arm.animation_data_clear()
    for o in meshes:
        o.hide_render = False
    hide = PLAN["bodies"][body_id].get("hideMeshes", [])
    for o in list(meshes):
        if any(h.lower() in o.name.lower() for h in hide):
            bpy.data.objects.remove(o, do_unlink=True)
            meshes.remove(o)
    setup_body(meshes)
    return arm, meshes


def render_to(path):
    scn = bpy.context.scene
    scn.render.filepath = path
    bpy.ops.render.render(write_still=True)


def place_and_render(arm, meshes, yaw_deg, path, facts):
    # rest-rotated body: rotate the armature object about Z (world), then drop to the floor
    base_rot = facts["baseRot"]
    arm.rotation_euler = (base_rot[0], base_rot[1], base_rot[2] + math.radians(yaw_deg))
    arm.location = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()
    lo, hi = mesh_min_max(meshes)
    cx, cy = (lo.x + hi.x) * 0.5, (lo.y + hi.y) * 0.5
    # anchor = the hips' ground projection so the feet stay centred in the cell
    hb = next(b for b in arm.pose.bones if strip(b.name) == "Hips")
    hp = arm.matrix_world @ hb.head
    arm.location = (-hp.x, -hp.y + 0.0, -lo.z)
    bpy.context.view_layer.update()
    lo2, hi2 = mesh_min_max(meshes)
    render_to(path)
    return {"minX": round(lo2.x, 4), "maxX": round(hi2.x, 4), "topZ": round(hi2.z, 4),
            "minZ": round(lo2.z, 4)}


def run_preview(body_id, clips):
    reset_scene()
    arm, meshes = load_body(body_id)
    facts = {"baseRot": tuple(arm.rotation_euler)}
    order = hier(arm)
    rows = []
    for cid in clips:
        carm, fr = load_clip(cid)
        n = PLAN.get("previewSamples", 6)
        f0, f1 = int(fr[0]), int(fr[1])
        for k in range(n):
            f = f0 + round((f1 - f0) * (k + 0.5) / n)
            activate_clip(cid, f)
            for pb in arm.pose.bones:
                pb.matrix_basis = Matrix.Identity(4)
            bpy.context.view_layer.update()
            ratio = pose_static(carm, arm, order)
            p = os.path.join(OUT, "pv_%s__%s__f%03d.png" % (body_id, cid, f))
            ext = place_and_render(arm, meshes, 0.0, p, facts)
            rows.append({"clip": cid, "frame": f, "png": p, "ratio": round(ratio, 4), **ext})
            log("preview", cid, f, ext)
    json.dump(rows, open(os.path.join(OUT, "preview_%s.json" % body_id), "w", newline="
"), indent=1)


def run_bake(bodies):
    all_rows = []
    for body_id in bodies:
        reset_scene()
        _clip_cache.clear()
        arm, meshes = load_body(body_id)
        facts = {"baseRot": tuple(arm.rotation_euler)}
        order = hier(arm)
        # standing height from the rest pose
        bpy.context.view_layer.update()
        lo, hi = mesh_min_max(meshes)
        rest_h = hi.z - lo.z
        for pose in PLAN["poses"]:
            carm, fr = load_clip(pose["clip"])
            activate_clip(pose["clip"], pose["frame"])
            for pb in arm.pose.bones:
                pb.matrix_basis = Matrix.Identity(4)
            bpy.context.view_layer.update()
            ratio = pose_static(carm, arm, order)
            for ang in PLAN["angles"]:
                p = os.path.join(OUT, "cell_%s__%s__%s.png" % (body_id, pose["id"], ang["id"]))
                ext = place_and_render(arm, meshes, ang["yawDeg"], p, facts)
                row = {"body": body_id, "pose": pose["id"], "angle": ang["id"], "png": p,
                       "restHeightM": round(rest_h, 4), "ratio": round(ratio, 4), **ext}
                all_rows.append(row)
                log("cell", body_id, pose["id"], ang["id"], ext)
        json.dump(all_rows, open(os.path.join(OUT, "cells_%s.json" % "_".join(bodies)), "w", newline="
"), indent=1)
    return all_rows


if __name__ == "__main__":
    if MODE == "preview":
        body = argv[2] if len(argv) > 2 else "Ch01"
        clips = list(PLAN["clips"].keys()) if (len(argv) < 4 or argv[3] == "all") else argv[3].split(",")
        run_preview(body, clips)
    elif MODE == "bake":
        bodies = argv[2].split(",") if len(argv) > 2 else list(PLAN["bodies"].keys())
        run_bake(bodies)
    log("DONE", MODE)
