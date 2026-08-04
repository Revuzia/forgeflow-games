"""Blender headless: assemble the DRIFTWAKE character GLB.

  rigged mesh (Mixamo auto-rig, untextured)
+ 3 PBR maps extracted from the Meshy GLB (UVs survived the OBJ->Mixamo trip)
+ 9 locomotion clips from the owner's Mixamo library (same mixamorig skeleton,
  so a clip's action drops straight onto the character armature)
-> one driftwake_char_anims.glb with named clips, all in-place.

In-place matters: the game's controller owns world position, so a clip that
translates mixamorig:Hips in XZ would fight it. Y stays (jump arcs, crouches).

Run:  blender --background --python blender_driftwake_rig.py
"""
import bpy, os, sys

ROOT = r"F:\games\forgeflow-games-assets\meshy-driftwake"
ANIM = r"F:\games\forgeflow-games-assets\_downloaded\mixamo\animations\Action_Adventure_Pack"
OUT = os.path.join(ROOT, "driftwake_char_anims.glb")

CLIPS = [
    # ALL WITH-SKIN, exported on DRIFTWAKE_CHAR_F itself. Without-skin
    # downloads carry the GENERIC mannequin skeleton, whose upper-arm rest
    # orientation differs from this auto-rigged character's by up to 0.744
    # (probed 2026-08-04) — name-merging those actions bends the arms across
    # the chest. With-skin clips probed 0.000 on every bone. The rest
    # assertion in the clip loop makes this unskippable.
    # Base idle = Mixamo "Standing Idle": measured stillest of four candidates
    # (head lateral amp 0.003 m vs Breathing Idle's 0.100 m — the owner called
    # the sway out on 2026-08-04) and the cleanest robe hang. lookaround /
    # weightshift are the occasional idle variations meshChar.js schedules.
    ("idle",        r"..\WithSkin\standing_idle_ws65.fbx"),
    ("lookaround",  r"..\WithSkin\looking_around_ws65.fbx"),
    ("weightshift", r"..\WithSkin\weight_shift_ws65.fbx"),
    ("walk",      r"..\WithSkin\walking_ws75.fbx"),
    ("run",       r"..\WithSkin\running_ws75.fbx"),
    ("jump",      r"..\WithSkin\jumping_up_ws70.fbx"),
    ("fall",      r"..\WithSkin\falling_idle_ws70.fbx"),
    ("land",      r"..\WithSkin\hard_landing_ws70.fbx"),
    ("roll",      r"..\WithSkin\falling_to_roll_ws70.fbx"),
    # Side-on board stance, Mixamo "Skateboarding" (In Place, WITH skin —
    # rest-probed 0.000 vs character) — the BASE for the surf pose; the game
    # layers the procedural carve-lean on top of it.
    ("skate",     r"..\Extra\skateboarding_inplace.fbx"),
]

def log(*a):
    print("[driftwake]", *a, flush=True)

# ---------------------------------------------------------------- clean scene
bpy.ops.wm.read_factory_settings(use_empty=True)

# ------------------------------------------------------------ character import
bpy.ops.import_scene.fbx(filepath=os.path.join(ROOT, "driftwake_char_f_RIGGED.fbx"))
char_arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
char_meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
char_arm.name = "DriftwakeRig"

# The FBX header claims centimetres, so the importer parks 0.01 on the
# armature — but the vertex data is ALREADY in metres (the Meshy OBJ was
# authored that way and Mixamo passed the numbers through untouched; probed:
# data height 2.0 units). So the 0.01 is a lie to be deleted, not baked.
# transform_apply here is actively harmful: it shrinks the data 100x and
# bakes the -90deg FBX axis fix into vertices, flipping height into Z.
char_arm.scale = (1.0, 1.0, 1.0)
log("character:", char_arm.name, "meshes:", [m.name for m in char_meshes],
    "bones:", len(char_arm.data.bones))

# ---------------------------------------------------------------- material
mat = bpy.data.materials.new("DriftwakeChar")
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes["Principled BSDF"]

def tex_node(fname, non_color=False):
    img = bpy.data.images.load(os.path.join(ROOT, "textures", fname))
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    n = nt.nodes.new("ShaderNodeTexImage")
    n.image = img
    return n

base = tex_node("driftwake_char_basecolor.jpg")
nt.links.new(base.outputs["Color"], bsdf.inputs["Base Color"])
mr = tex_node("driftwake_char_metalrough.jpg", non_color=True)
sep = nt.nodes.new("ShaderNodeSeparateColor")
nt.links.new(mr.outputs["Color"], sep.inputs["Color"])
# glTF convention: G = roughness, B = metallic
nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
nrm_img = tex_node("driftwake_char_normal.jpg", non_color=True)
nrm = nt.nodes.new("ShaderNodeNormalMap")
nt.links.new(nrm_img.outputs["Color"], nrm.inputs["Color"])
nt.links.new(nrm.outputs["Normal"], bsdf.inputs["Normal"])

for m in char_meshes:
    m.data.materials.clear()
    m.data.materials.append(mat)
log("material bound")

# ------------------------------------------------------------------- clips
def strip_root_xz(action):
    """Zero the XZ of mixamorig:Hips location so the clip runs in place.

    Blender bone location channels are in the bone's LOCAL rest space. For
    Mixamo rigs the Hips rest orientation maps world forward/side into local
    X and Z... which varies. The robust rule used by every Mixamo-to-game
    pipeline: keep ONLY the local Y (vertical) channel of Hips location and
    flatten the other two to their first-frame value.
    """
    # Blender 5.x layered actions: fcurves live in per-slot channelbags.
    # (Legacy `action.fcurves` was removed with the slotted-action redesign.)
    bags = []
    if hasattr(action, "fcurves"):
        bags = [action]
    else:
        for layer in action.layers:
            for strip in layer.strips:
                bags.extend(strip.channelbags)
    for bag in bags:
        for fc in list(bag.fcurves):
            if fc.data_path.endswith('pose.bones["mixamorig:Hips"].location') and fc.array_index != 1:
                first = fc.keyframe_points[0].co[1] if fc.keyframe_points else 0.0
                for kp in fc.keyframe_points:
                    kp.co[1] = first
                fc.update()

kept = []
for clip_name, fname in CLIPS:
    path = os.path.join(ANIM, fname)
    if not os.path.exists(path):
        log("MISSING:", fname)
        continue
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.fbx(filepath=path, ignore_leaf_bones=True)
    new = [o for o in bpy.context.scene.objects if o not in before]
    src_arm = next((o for o in new if o.type == "ARMATURE"), None)
    if src_arm is None or src_arm.animation_data is None or src_arm.animation_data.action is None:
        log("no action in", fname)
        for o in new:
            bpy.data.objects.remove(o, do_unlink=True)
        continue
    # REST ASSERTION — the folded-arm incident fix. A clip whose skeleton
    # rest orientation differs from the character's produces silently-wrong
    # bone-local rotations when the action is name-merged; refuse it loudly.
    bad = None
    for bname in ("mixamorig:RightArm", "mixamorig:LeftArm", "mixamorig:Hips"):
        rb, sb = char_arm.data.bones.get(bname), src_arm.data.bones.get(bname)
        if rb is None or sb is None:
            bad = (bname, "missing")
            break
        a, b = rb.matrix_local.to_3x3(), sb.matrix_local.to_3x3()
        diff = max(abs(a[i][j] - b[i][j]) for i in range(3) for j in range(3))
        if diff > 0.02:
            bad = (bname, f"rest maxdiff {diff:.3f}")
            break
    if bad is not None:
        log(f"CLIP-REST-BAD: {fname} {bad[0]} {bad[1]} — SKIPPED")
        for o in new:
            bpy.data.objects.remove(o, do_unlink=True)
        continue
    act = src_arm.animation_data.action
    act.name = clip_name
    act.use_fake_user = True          # survive the source armature's deletion
    strip_root_xz(act)
    # The rig was baked from cm to metres, but clip location channels are still
    # authored in cm. Rotations dominate Mixamo clips and are scale-free; only
    # location tracks (Hips-Y after the strip) need the 0.01.
    for bag in ([act] if hasattr(act, "fcurves") else
                [b for l in act.layers for st in l.strips for b in st.channelbags]):
        for fc in bag.fcurves:
            if fc.data_path.endswith(".location"):
                for kp in fc.keyframe_points:
                    kp.co[1] *= 0.01
                fc.update()
    for o in new:
        bpy.data.objects.remove(o, do_unlink=True)
    kept.append(clip_name)
    log("clip:", clip_name, f"({fname})")

# Bind one action so the exporter sees animation data on the rig; the exporter
# in 'ACTIONS' mode exports every action targeting this armature as a clip.
if char_arm.animation_data is None:
    char_arm.animation_data_create()
if kept:
    char_arm.animation_data.action = bpy.data.actions[kept[0]]

# -------------------------------------------------------------------- export
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_optimize_animation_size=True,
    export_apply=False,               # never bake the armature away
    export_yup=True,
)
log("exported:", OUT, f"{os.path.getsize(OUT)/1e6:.1f} MB", "clips:", kept)
