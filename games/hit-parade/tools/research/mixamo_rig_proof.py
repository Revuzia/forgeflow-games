"""HIT PARADE research: visual proof -- one X Bot clip on one character body, several transfer methods.

Usage:
  blender --background --python mixamo_rig_proof.py -- <out_dir> <xbot_fbx> <clip_fbx> <clip_tag>
          <frames_csv> <body_fbx> <body_tag> <striker_bone> [<hide_regex>]

Variants rendered (same frames, same two cameras):
  xbot            the clip on the X Bot mesh it was authored on (reference)
  naive_blender   the clip's Blender action assigned to the body armature by bone name
                  (pose-basis copy: local deltas from REST re-applied on the body's own rest)
  naive_three_raw what three.js AnimationMixer does with the UNMODIFIED clip bound by bone name:
                  every bone gets X Bot's absolute parent-relative rotation AND X Bot's local
                  translation (all 65 bones carry location tracks), hips at X Bot's absolute height
  naive_three     same absolute rotations, but translation tracks stripped (body keeps its own bone
                  offsets) and hips height scaled by the hip-height ratio
  retarget_dw     driftwake blender_retarget.retarget_action (world-space delta from rest),
                  verbatim, including its hips rule (vertical offset from the clip's median height)
  retarget        same world-space rotations, hips replaced by the naive_three hips rule
                  (absolute source height x hip ratio) so rotations are compared on equal footing
  hybrid          retarget for body bones + parent-relative copy for finger bones (fist shape)
Per variant+frame it also records: lowest skinned-mesh vertex z (floor contact; 0 = on floor),
and the striker bone position relative to hips, divided by hip height (where the blow lands).
ASCII only.
"""
import bpy
import bmesh
import sys
import os
import re
import json
import math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
OUTD, XBOT, CLIP, CTAG, FRAMES, BODY, BTAG, STRIKER = argv[:8]
HIDE = argv[8] if len(argv) > 8 else ""
FRAMES = [int(x) for x in FRAMES.split(",")]
RES = 320
os.makedirs(OUTD, exist_ok=True)
sys.path.insert(0, "C:/Users/TestRun/Claude Claw/forgeflow-games/games/driftwake/tools")
import blender_retarget as BR  # noqa: E402  (prior art, reused verbatim)


def log(*a):
    print("[proof]", *a, flush=True)


def strip(n):
    return n.split(":")[-1]


bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene


def import_new(path):
    before = set(scn.objects)
    bpy.ops.import_scene.fbx(filepath=path)
    return [o for o in scn.objects if o not in before]


# ---- source clip armature
new = import_new(CLIP)
SRC = next(o for o in new if o.type == "ARMATURE")
SRC.name = "SRC"
SRC.hide_render = True
act = SRC.animation_data.action
F0, F1 = int(round(act.frame_range[0])), int(round(act.frame_range[1]))
scn.frame_start, scn.frame_end = F0, F1

# ---- X Bot reference mesh, driven by SRC
new = import_new(XBOT)
XARM = next(o for o in new if o.type == "ARMATURE")
XARM.hide_render = True
XMESH = [o for o in new if o.type == "MESH"]
for o in XMESH:
    o.color = (0.93, 0.62, 0.30, 1.0) if "Surface" in o.name else (0.18, 0.18, 0.22, 1.0)
    for m in o.modifiers:
        if m.type == "ARMATURE":
            m.object = SRC

# ---- body
new = import_new(BODY)
arms = [o for o in new if o.type == "ARMATURE"]
TGT = max(arms, key=lambda a: len(a.data.bones))
TGT.name = "TGT"
TGT.hide_render = True
if TGT.animation_data:
    TGT.animation_data.action = None
TMESH = [o for o in new if o.type == "MESH"]
hidden = []
for o in new:
    if o.type == "EMPTY":
        o.hide_render = True
for o in TMESH:
    o.color = (0.55, 0.72, 0.95, 1.0)
    if HIDE and re.search(HIDE, o.name, re.I):
        o.hide_render = True
        hidden.append(o.name)
# normalise bone-name prefix to mixamorig: (driftwake retarget matches exact names)
renamed = 0
for b in TGT.data.bones:
    if ":" in b.name and not b.name.startswith("mixamorig:"):
        b.name = "mixamorig:" + strip(b.name)
        renamed += 1
log("body", BTAG, "bones", len(TGT.data.bones), "renamed", renamed, "hidden meshes", hidden)

dm = max(abs(a - b) for ra, rb in zip(SRC.matrix_world, TGT.matrix_world) for a, b in zip(ra, rb))
log("object transform diff SRC vs TGT", dm)
assert dm < 1e-5, "armature object transforms differ; armature-space math below would be invalid"

# ---- scene / render
scn.render.engine = "BLENDER_WORKBENCH"
sh = scn.display.shading
sh.light = "STUDIO"
sh.color_type = "OBJECT"
sh.show_cavity = True
sh.cavity_type = "BOTH"
sh.show_shadows = True
sh.shadow_intensity = 0.6
sh.show_object_outline = True
scn.display.light_direction = (0.35, -0.45, 0.82)
scn.render.resolution_x = RES
scn.render.resolution_y = RES
scn.render.image_settings.file_format = "PNG"


def tiles(name, parity, color):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    s, n = 0.5, 24
    for i in range(n):
        for j in range(n):
            if (i + j) % 2 != parity:
                continue
            x0, y0 = (i - n / 2) * s, (j - n / 2) * s
            vs = [bm.verts.new((x0, y0, 0)), bm.verts.new((x0 + s, y0, 0)),
                  bm.verts.new((x0 + s, y0 + s, 0)), bm.verts.new((x0, y0 + s, 0))]
            bm.faces.new(vs)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    scn.collection.objects.link(ob)
    ob.color = color


tiles("floorA", 0, (0.55, 0.58, 0.62, 1))
tiles("floorB", 1, (0.40, 0.43, 0.47, 1))
cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = 2.75
cam = bpy.data.objects.new("cam", cam_data)
scn.collection.objects.link(cam)
scn.camera = cam
VIEWS = {"q": (Vector((0.62, -1.0, 0.16)).normalized(), 2.75),
         "side": (Vector((1.0, 0.0, 0.08)).normalized(), 2.75),
         "feet": (Vector((0.45, -1.0, 0.04)).normalized(), 1.2),
         "upper": (Vector((0.62, -1.0, 0.16)).normalized(), 1.3),
         "rhand": (Vector((0.62, -1.0, 0.30)).normalized(), 0.5),
         "lhand": (Vector((-0.62, -1.0, 0.30)).normalized(), 0.5)}
if os.environ.get("PROOF_VIEWS"):
    VIEWS = {k: v for k, v in VIEWS.items() if k in os.environ["PROOF_VIEWS"].split(",")}
if scn.world is None:
    scn.world = bpy.data.worlds.new("W")
scn.world.color = (0.82, 0.84, 0.88)


def aim(target, view):
    cam_data.ortho_scale = VIEWS[view][1]
    cam.location = target + VIEWS[view][0] * 10.0
    cam.rotation_mode = "QUATERNION"
    cam.rotation_quaternion = (target - cam.location).to_track_quat("-Z", "Y")


# ---- helpers
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


T_ORDER = hier(TGT)
S_PB = {strip(pb.name): pb for pb in SRC.pose.bones}
S_BONE = {strip(b.name): b for b in SRC.data.bones}


def hip_h(arm):
    wm = arm.matrix_world
    zs = [(wm @ b.matrix_local.translation).z for b in arm.data.bones]
    return (wm @ arm.data.bones["mixamorig:Hips"].matrix_local.translation).z - min(zs)


RATIO = hip_h(TGT) / hip_h(SRC)
log("hip ratio", round(RATIO, 4), "src hip", round(hip_h(SRC), 4), "tgt hip", round(hip_h(TGT), 4))


def clear_tgt_anim():
    if TGT.animation_data:
        TGT.animation_data.action = None
    for pb in TGT.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)


def set_three(raw):
    """Pose TGT the way three.js would: absolute parent-relative rotations copied by name."""
    D = {}
    for b in T_ORDER:
        n = strip(b.name)
        pb = TGT.pose.bones[b.name]
        par = b.parent
        if n not in S_PB:
            # extra bone (eyes, hair, weapon): keeps its bind local transform under its parent
            if par is None:
                D[b.name] = b.matrix_local.copy()
            else:
                D[b.name] = D[par.name] @ (par.matrix_local.inverted() @ b.matrix_local)
            continue
        Ws = S_PB[n].matrix
        R = Ws.to_3x3().normalized()
        if par is None:
            pos = Ws.translation.copy() if raw else Ws.translation * RATIO
            # three.js: ratio applies to the whole hips vector (height AND travel)
        else:
            if raw and strip(par.name) in S_PB:
                sp = S_PB[strip(par.name)].matrix
                local = sp.to_3x3().normalized().inverted() @ (Ws.translation - sp.translation)
            else:
                local = par.matrix_local.to_3x3().inverted() @ (b.matrix_local.translation - par.matrix_local.translation)
            pos = D[par.name].translation + D[par.name].to_3x3().normalized() @ local
        M = R.to_4x4()
        M.translation = pos
        D[b.name] = M
    for b in T_ORDER:
        pb = TGT.pose.bones[b.name]
        if b.parent is None:
            basis = b.matrix_local.inverted() @ D[b.name]
        else:
            rel = b.parent.matrix_local.inverted() @ b.matrix_local
            basis = rel.inverted() @ D[b.parent.name].inverted() @ D[b.name]
        pb.matrix_basis = basis


def set_hips_scaled():
    """Hips head at (source hips head) x RATIO in armature space, orientation untouched."""
    hb = TGT.data.bones["mixamorig:Hips"]
    pb = TGT.pose.bones["mixamorig:Hips"]
    want = S_PB["Hips"].matrix.translation * RATIO
    # hips has no parent: pose = rest @ basis ; translation of pose = rest.t + rest.R @ basis.t
    pb.location = hb.matrix_local.to_3x3().inverted() @ (want - hb.matrix_local.translation)


def lowest_z(meshes):
    deps = bpy.context.evaluated_depsgraph_get()
    z = 1e9
    for o in meshes:
        if o.hide_render or not any(m.type == "ARMATURE" for m in o.modifiers):
            continue
        ev = o.evaluated_get(deps)
        me = ev.to_mesh()
        mw = ev.matrix_world
        for v in me.vertices:
            z = min(z, (mw @ v.co).z)
        ev.to_mesh_clear()
    return z


metrics = {}


def striker_rel(arm, name):
    wm = arm.matrix_world
    pbs = {strip(p.name): p for p in arm.pose.bones}
    hip = wm @ pbs["Hips"].head
    s = wm @ pbs[name].head
    return s, hip


def render_variant(var, meshes, arm, prep=None):
    for o in XMESH + TMESH:
        o.hide_render = True
    for o in meshes:
        if o.name not in hidden:
            o.hide_render = False
    metrics[var] = {}
    for f in FRAMES:
        scn.frame_set(f)
        if prep:
            prep(f)
        bpy.context.view_layer.update()
        s, hip = striker_rel(arm, STRIKER)
        hh = hip_h(arm)
        rel = (s - hip) / hh
        metrics[var][f] = {"lowest_vertex_z_m": round(lowest_z(meshes), 4),
                           "striker_rel_hips_over_hipheight": [round(v, 3) for v in rel],
                           "hips_z_m": round(hip.z, 4)}
        neck = arm.matrix_world @ {strip(p.name): p for p in arm.pose.bones}["Neck"].head
        for view in VIEWS:
            if view == "feet":
                tgt = Vector((hip.x, hip.y, 0.3))
            elif view == "upper":
                tgt = Vector((neck.x, neck.y, neck.z - 0.2))
            elif view in ("rhand", "lhand"):
                hb = "RightHand" if view == "rhand" else "LeftHand"
                tgt = arm.matrix_world @ {strip(p.name): p for p in arm.pose.bones}[hb].head
            else:
                tgt = Vector((hip.x, hip.y, 1.05))
            aim(tgt, view)
            scn.render.filepath = os.path.join(OUTD, "%s__%s__%s__%s__f%03d.png" % (CTAG, BTAG, var, view, f))
            bpy.ops.render.render(write_still=True)
    log("rendered", var, metrics[var])


# 1 reference
render_variant("xbot", XMESH, SRC)

# 2 naive_blender: assign the clip action by bone name
clear_tgt_anim()
TGT.animation_data_create()
TGT.animation_data.action = act
if TGT.animation_data.action_slot is None and act.slots:
    TGT.animation_data.action_slot = act.slots[0]
log("naive_blender slot", TGT.animation_data.action_slot.identifier if TGT.animation_data.action_slot else None)
render_variant("naive_blender", TMESH, TGT)

# 3 naive_three_raw / 4 naive_three
clear_tgt_anim()
render_variant("naive_three_raw", TMESH, TGT, prep=lambda f: set_three(True))
clear_tgt_anim()
render_variant("naive_three", TMESH, TGT, prep=lambda f: set_three(False))

# 5 retarget_dw (verbatim prior art) + identity gate on the source
clear_tgt_anim()
ok, worst, who = BR.identity_test(SRC)
log("identity_test on source clip:", ok, worst, who)
scn.frame_set(F0)
ract = BR.retarget_action(SRC, TGT, "RT_" + CTAG)
render_variant("retarget_dw", TMESH, TGT)

# 6 retarget with the scaled-absolute hips rule
def hips_prep(f):
    # the retarget action keys hips location; override after evaluation
    set_hips_scaled()
# mute the hips location fcurves so the override sticks through render re-evaluation
for layer in ract.layers:
    for st in layer.strips:
        for slot in ract.slots:
            cb = st.channelbag(slot)
            if cb:
                for fc in cb.fcurves:
                    if fc.data_path == 'pose.bones["mixamorig:Hips"].location':
                        fc.mute = True
render_variant("retarget", TMESH, TGT, prep=hips_prep)

# 7 hybrid: world-space retarget for the body, parent-relative (three.js-style) copy for FINGERS.
# Finger rests differ most between bodies (hand modelling), and the fist shape is defined relative
# to the hand, so fingers take X Bot's local rotations while every other bone keeps the retarget.
def is_finger(n):
    return "Hand" in n and n not in ("LeftHand", "RightHand")


for layer in ract.layers:
    for st in layer.strips:
        for slot in ract.slots:
            cb = st.channelbag(slot)
            if cb:
                for fc in cb.fcurves:
                    m_ = re.match(r'pose\.bones\["([^"]+)"\]', fc.data_path)
                    if m_ and is_finger(strip(m_.group(1))):
                        fc.mute = True


def hybrid_prep(f):
    set_hips_scaled()
    for b in T_ORDER:
        n = strip(b.name)
        if not is_finger(n) or n not in S_PB or b.parent is None or strip(b.parent.name) not in S_PB:
            continue
        Ls = S_PB[strip(b.parent.name)].matrix.to_3x3().normalized().inverted() @ S_PB[n].matrix.to_3x3().normalized()
        rel = (b.parent.matrix_local.to_3x3().inverted() @ b.matrix_local.to_3x3())
        TGT.pose.bones[b.name].matrix_basis = (rel.inverted() @ Ls).to_4x4()


render_variant("hybrid", TMESH, TGT, prep=hybrid_prep)

json.dump({"clip": CLIP, "body": BODY, "frames": FRAMES, "ratio": RATIO, "hidden": hidden,
           "identity_test": {"ok": ok, "worst": worst, "bone": who}, "metrics": metrics},
          open(os.path.join(OUTD, "%s__%s__metrics.json" % (CTAG, BTAG)), "w"), indent=1)
log("DONE")
