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
bpy.context.view_layer.update()

# ------------------------------------------------- robe skirt weight repair
# The auto-rig skinned the robe's between-legs panel to BOTH legs with no
# pelvis anchor (probed 2026-08-04: 54% of the centre-strip verts at knee
# height split across the two leg chains; mean Hips weight 0.012). Any leg
# stagger shears that panel into a boxy fold — the "swollen leg" the owner
# boxed. Repair: for that strip only, symmetrise the two legs' pull and give
# a share to Hips, fading out toward the leg centrelines and the belt. The
# panel then drapes from the pelvis and follows the legs' AVERAGE — it can
# no longer be torn apart. Mesh coords here: origin mid-height, feet z=-1,
# belt z~0.0, knees z~-0.5, leg centres x~±0.095.
L_CHAIN = ["mixamorig:LeftUpLeg", "mixamorig:LeftLeg",
           "mixamorig:LeftFoot", "mixamorig:LeftToeBase"]
R_CHAIN = ["mixamorig:RightUpLeg", "mixamorig:RightLeg",
           "mixamorig:RightFoot", "mixamorig:RightToeBase"]

def fix_skirt_weights(mesh_obj):
    me = mesh_obj.data
    vg = mesh_obj.vertex_groups
    gidx = {g.name: g.index for g in vg}
    l_ids = [gidx[n] for n in L_CHAIN if n in gidx]
    r_ids = [gidx[n] for n in R_CHAIN if n in gidx]
    hips = vg.get("mixamorig:Hips")
    if hips is None or not l_ids or not r_ids:
        log("skirt fix: chains missing, skipped")
        return
    mw = mesh_obj.matrix_world
    touched = 0
    for v in me.vertices:
        co = mw @ v.co
        x, z = co.x, co.z
        if z > -0.05 or abs(x) > 0.15:
            continue
        # Falloffs: full inside |x|<=0.06, gone by 0.15; full below z=-0.25,
        # gone by the belt. 0.85 cap keeps a little natural asymmetry.
        tx = 1.0 if abs(x) <= 0.06 else max(0.0, (0.15 - abs(x)) / 0.09)
        tz = 1.0 if z <= -0.25 else max(0.0, (z + 0.05) / -0.20)
        t = 0.85 * tx * tz
        if t <= 0.0:
            continue
        wL = {g.group: g.weight for g in v.groups if g.group in l_ids}
        wR = {g.group: g.weight for g in v.groups if g.group in r_ids}
        sL, sR = sum(wL.values()), sum(wR.values())
        S = sL + sR
        if S < 0.2:
            continue     # not leg-driven cloth (belt, pouch, etc.)
        touched += 1
        # Equal halves of a reduced leg total; the remainder anchors to Hips.
        legTotal = S * (1.0 - 0.45 * t)
        tgtL = sL + (legTotal / 2 - sL) * t
        tgtR = sR + (legTotal / 2 - sR) * t
        hipsAdd = S - tgtL - tgtR
        # Distribute each side over its chain: own shape if it has one, the
        # mirrored side's shape otherwise (bone-for-bone, same order).
        for ids, mirror, tot, own in ((l_ids, r_ids, tgtL, wL),
                                      (r_ids, l_ids, tgtR, wR)):
            shape = own if sum(own.values()) > 1e-6 else \
                {ids[mirror.index(k)]: w for k, w in
                 (wR if ids is l_ids else wL).items() if k in mirror}
            ssum = sum(shape.values())
            if ssum <= 1e-6:
                shape = {ids[0]: 1.0}
                ssum = 1.0
            for gi in ids:
                w = tot * shape.get(gi, 0.0) / ssum
                vg[gi].add([v.index], w, "REPLACE")
        cur = 0.0
        for g in v.groups:
            if g.group == hips.index:
                cur = g.weight
                break
        hips.add([v.index], cur + hipsAdd, "REPLACE")
    log(f"skirt fix: rebalanced {touched} verts")

def smooth_deform_weights(mesh_obj, zmax=-0.30, factor=0.5, iters=3):
    """Laplacian-smooth the deform weights of the lower skirt/hem.

    The tattered hem tears into shards mid-stride ("texture drag", owner
    2026-08-05): adjacent cloth verts carry sharply different leg/foot
    weights, so one vert follows the swing leg while its neighbour stays —
    the face between them stretches into a spike. Averaging each vert's
    weights with its topological neighbours removes the discontinuity.
    Body areas are near-uniform already, so this is a no-op there, and the
    boots are a separate shell — smoothing cannot bleed across shells.
    """
    me = mesh_obj.data
    vg = mesh_obj.vertex_groups
    names = [g.name for g in vg]
    mw = mesh_obj.matrix_world
    sel = set(v.index for v in me.vertices if (mw @ v.co).z <= zmax)
    if not sel:
        log("weight smooth: no verts in band")
        return
    adj = {i: set() for i in sel}
    for e in me.edges:
        a, b = e.vertices
        if a in adj and b in sel: adj[a].add(b)
        if b in adj and a in sel: adj[b].add(a)
    # weights[v] = {group_index: w}
    weights = {}
    for i in sel:
        weights[i] = {g.group: g.weight for g in me.vertices[i].groups}
    for _ in range(iters):
        nxt = {}
        for i in sel:
            nb = adj[i]
            if not nb:
                nxt[i] = weights[i]
                continue
            acc = {}
            for j in nb:
                for gi, w in weights[j].items():
                    acc[gi] = acc.get(gi, 0.0) + w
            inv = 1.0 / len(nb)
            merged = {}
            for gi in set(weights[i]) | set(acc):
                merged[gi] = (1 - factor) * weights[i].get(gi, 0.0) + \
                    factor * acc.get(gi, 0.0) * inv
            s = sum(merged.values())
            if s > 1e-6:
                merged = {gi: w / s for gi, w in merged.items() if w > 0.004}
            nxt[i] = merged
        weights = nxt
    for i, ws in weights.items():
        for g in list(me.vertices[i].groups):
            if g.group not in ws:
                vg[g.group].remove([i])
        for gi, w in ws.items():
            vg[gi].add([i], w, "REPLACE")
    log(f"weight smooth: {len(sel)} verts, {iters} iterations")

def decouple_hem_from_feet(mesh_obj):
    """Hem cloth must not ride the FOOT bones.

    Tatter points skinned partly to Foot/ToeBase flick with every toe lift —
    the residual "texture drag" after smoothing. Cloth is anything at
    horizontal radius > 0.11 from both leg axes (legs stand at x = ±0.095,
    y = 0 in the T-pose; boot shafts stay inside r ~0.085). For those verts,
    each side's Foot/ToeBase weight moves up to the same side's shin
    (mixamorig:*Leg) — the tatters keep following the leg, but stop
    mirroring the foot's pitch. Boot geometry is untouched.
    """
    me = mesh_obj.data
    vg = mesh_obj.vertex_groups
    gidx = {g.name: g.index for g in vg}
    moves = []
    for side in ("Left", "Right"):
        src = [gidx.get(f"mixamorig:{side}Foot"), gidx.get(f"mixamorig:{side}ToeBase")]
        dst = gidx.get(f"mixamorig:{side}Leg")
        if dst is not None:
            moves.append(([s for s in src if s is not None], dst))
    mw = mesh_obj.matrix_world
    touched = 0
    for v in me.vertices:
        co = mw @ v.co
        if co.z > -0.35:
            continue
        dl = ((co.x - 0.095) ** 2 + co.y ** 2) ** 0.5
        dr = ((co.x + 0.095) ** 2 + co.y ** 2) ** 0.5
        if min(dl, dr) <= 0.11:
            continue                      # boot/leg surface — leave it
        w = {g.group: g.weight for g in v.groups}
        hit = False
        for srcs, dst in moves:
            take = sum(w.get(s, 0.0) for s in srcs)
            if take <= 1e-4:
                continue
            hit = True
            for s in srcs:
                if s in w:
                    vg[s].remove([v.index])
            vg[dst].add([v.index], w.get(dst, 0.0) + take, "REPLACE")
            w[dst] = w.get(dst, 0.0) + take
        if hit:
            touched += 1
    log(f"hem-foot decouple: {touched} verts")

for m in char_meshes:
    fix_skirt_weights(m)
    decouple_hem_from_feet(m)
    smooth_deform_weights(m)

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
