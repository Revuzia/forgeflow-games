"""Blender headless: assemble the DRIFTWAKE hero_v2 character GLB.

  Mixamo-rigged mesh (mixamo_base.fbx — untextured, 41 bones, 25094 verts)
+ the Meshy 4K PBR maps extracted from driftwake_hero_retex_4k_pbr.glb
  (same mesh, same UVMap, so the maps drop straight on)
+ the SAME ten clips the previous character shipped, RETARGETED onto this
  rig (owner direction 2026-08-05: "the animations we use are the downloaded
  ones we have on F", "just match them")
-> one driftwake_hero_v2_anims.glb with named clips, all in-place.

WHY RETARGET AND NOT NAME-MERGE
Measured 2026-08-05, matrix_local maxdiff of this rig's rest against every
clip family we own:
    old-character WithSkin clips ... 0.559  (RightForeArm)
    generic mannequin clips ........ 0.233  (RightArm)
Both are far past the 0.02 that name-merging tolerates — pasting either set
by bone name reproduces the folded-arm bug. `blender_retarget.py` transfers
the world-space delta-from-rest instead, and proves itself on an identity
case (< 1e-6) before any real clip is touched.

UNITS — THE OPPOSITE OF THE OLD CHARACTER
The previous character's FBX claimed cm while its data was already metres,
so that script DELETED the 0.01 armature scale. This rig is honestly in
centimetres (probed: 190.083 units tall), so here the 0.01 is REAL and gets
APPLIED — baking cm to metres and leaving a unit-scale root, which is what
the engine's skinning path expects. Getting this backwards is what made the
previous external build render a ~175 m character.

Run:  blender --background --python blender_hero_v2_rig.py
"""
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import blender_retarget as RT  # noqa: E402

RIG = r"F:\GrokUI\driftwake_hero_mv\rig_stage\mixamo_base.fbx"
TEXDIR = r"F:\games\forgeflow-games-assets\meshy-driftwake\hero_v2\textures"
ANIM = r"F:\games\forgeflow-games-assets\_downloaded\mixamo\animations"
OUT = r"F:\games\forgeflow-games-assets\meshy-driftwake\hero_v2\driftwake_hero_v2_anims.glb"

# The shipped set, identical to the previous character's (owner: "same
# animations ... just match them"). Source rest differs per family; the
# retarget does not care.
CLIPS = [
    # Base idle = Pro Magic Pack "Standing Idle 03" (owner pick 2026-08-05:
    # the hand-wave stance — in-game it gets water-manipulation FX in the
    # palms). "cast" = "Standing 2H Magic Attack 01", the spell-1 wave cast.
    ("idle",        r"Pro_Magic_Pack\Standing Idle 03.fbx"),
    ("cast",        r"Pro_Magic_Pack\Standing 2H Magic Attack 01.fbx"),
    ("lookaround",  r"WithSkin\looking_around_ws65.fbx"),
    ("weightshift", r"WithSkin\weight_shift_ws65.fbx"),
    # Magic Locomotion pack, DEFAULT arm-space: the WithSkin ws75 exports were
    # re-exported wide for the old ROBED character's sleeve clearance — on the
    # fitted hero_v2 body that spacing reads as zombie arms (seen in the first
    # render grid). These also keep the spellcaster hand language of the
    # Standing Idle 03 base.
    ("walk",        r"Magic_Locomotion_Pack\Standing Walk Forward.fbx"),
    ("run",         r"Magic_Locomotion_Pack\Standing Run Forward.fbx"),
    ("jump",        r"WithSkin\jumping_up_ws70.fbx"),
    ("fall",        r"WithSkin\falling_idle_ws70.fbx"),
    ("land",        r"WithSkin\hard_landing_ws70.fbx"),
    ("roll",        r"WithSkin\falling_to_roll_ws70.fbx"),
    ("skate",       r"Extra\skateboarding_inplace.fbx"),
]


def log(*a):
    print("[hero_v2]", *a, flush=True)


# ---------------------------------------------------------------- clean scene
bpy.ops.wm.read_factory_settings(use_empty=True)

# ------------------------------------------------------------ character import
bpy.ops.import_scene.fbx(filepath=RIG)
char_arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
char_meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
char_arm.name = "DriftwakeHeroV2"

# Apply the REAL 0.01 (see module docstring): bake cm -> metres so the export
# carries unit scale, then verify rather than trust.
bpy.ops.object.select_all(action="DESELECT")
char_arm.select_set(True)
for m in char_meshes:
    m.select_set(True)
bpy.context.view_layer.objects.active = char_arm
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
bpy.context.view_layer.update()

from mathutils import Vector  # noqa: E402
_bb = [char_meshes[0].matrix_world @ Vector(c) for c in char_meshes[0].bound_box]
_h = max(v.z for v in _bb) - min(v.z for v in _bb)
log(f"character height {_h:.3f} m  armature scale {tuple(round(s, 4) for s in char_arm.scale)}"
    f"  bones {len(char_arm.data.bones)}  verts {len(char_meshes[0].data.vertices)}")
if not (1.2 < _h < 2.6):
    raise SystemExit(f"ABORT: character height {_h:.3f} is not human scale — unit handling wrong")

# ---------------------------------------------------------------- material
mat = bpy.data.materials.new("DriftwakeHeroV2")
mat.use_nodes = True
nt = mat.node_tree
bsdf = nt.nodes["Principled BSDF"]


def tex_node(fname, non_color=False):
    img = bpy.data.images.load(os.path.join(TEXDIR, fname))
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    n = nt.nodes.new("ShaderNodeTexImage")
    n.image = img
    return n


base = tex_node("base_color.jpg")
nt.links.new(base.outputs["Color"], bsdf.inputs["Base Color"])
mr = tex_node("metallic_roughness.jpg", non_color=True)
sep = nt.nodes.new("ShaderNodeSeparateColor")
nt.links.new(mr.outputs["Color"], sep.inputs["Color"])
# glTF convention: G = roughness, B = metallic
nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
nrm_img = tex_node("normal.jpg", non_color=True)
nrm = nt.nodes.new("ShaderNodeNormalMap")
nt.links.new(nrm_img.outputs["Color"], nrm.inputs["Color"])
nt.links.new(nrm.outputs["Normal"], bsdf.inputs["Normal"])
for m in char_meshes:
    m.data.materials.clear()
    m.data.materials.append(mat)
log("material bound (4K base + 4K normal + 2K metal/rough)")

# ------------------------------------------------------------------- clips
kept = []
for clip_name, rel in CLIPS:
    path = os.path.join(ANIM, rel)
    if not os.path.exists(path):
        log("MISSING:", rel)
        continue
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.fbx(filepath=path, ignore_leaf_bones=True)
    new = [o for o in bpy.context.scene.objects if o not in before]
    src = next((o for o in new if o.type == "ARMATURE"), None)
    if src is None or src.animation_data is None or src.animation_data.action is None:
        log("no action in", rel)
        for o in new:
            bpy.data.objects.remove(o, do_unlink=True)
        continue
    src_act = src.animation_data.action
    act = RT.retarget_action(src, char_arm, clip_name)
    # Sanity: a correct retarget never produces metre-scale bone offsets.
    worst = 0.0
    for fc in [c for l in act.layers for st in l.strips for b in st.channelbags for c in b.fcurves]:
        if fc.data_path.endswith(".location"):
            for kp in fc.keyframe_points:
                worst = max(worst, abs(kp.co[1]))
    if worst > 0.8:
        raise SystemExit(f"ABORT: {clip_name} has |translation| {worst:.2f} m — retarget diverged")
    for o in new:
        bpy.data.objects.remove(o, do_unlink=True)
    # The glTF ACTIONS exporter ships EVERY action in the file — leaving the
    # imported source action behind is how the external build ended up with
    # eleven stray `Armature|mixamo.com|Layer0` animations in its GLB.
    if src_act and src_act.name != clip_name:
        bpy.data.actions.remove(src_act)
    kept.append(clip_name)
    log(f"clip: {clip_name:12s} <- {rel}   max|loc| {worst:.3f} m")

if char_arm.animation_data is None:
    char_arm.animation_data_create()
if kept:
    char_arm.animation_data.action = bpy.data.actions[kept[0]]

# -------------------------------------------------------------------- export
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_optimize_animation_size=True,
    export_apply=False,
    export_yup=True,
)
log("exported:", OUT, f"{os.path.getsize(OUT)/1e6:.1f} MB", "clips:", kept)
