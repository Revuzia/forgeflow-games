"""CMU BVH (Hahne cgspeed conversion) -> Mixamo rig (X Bot) world-space retarget.

Run headless:
  blender.exe --background --python tools/cmu_retarget.py -- <jobs.json>

jobs.json = {"rig": "<X Bot.fbx>", "out_dir": "<dir>", "fps_out": 60,
             "clips": [{"name", "take", "start", "contact", "end", "kind", "limb"}, ...]}
kind: hand | foot | knee | getup | fall | tpose   (frames are SOURCE frames @120 fps)
optional per clip: "mirror": true (swap L/R: southpaw -> orthodox; limb names the
POST-mirror limb), "fist": <deg> (constant finger curl; CMU has no finger data)

THE MATH (why not the driftwake form verbatim)
driftwake's retarget transfers the world delta from each rig's OWN REST pose.
That only works when both rests mean the same pose. The CMU BVH bind pose is
NOT a Mixamo T-pose: its legs are splayed ~20 deg outward, the clavicles rise
~23 deg, and several CMU joints (Hips, LowerBack, Neck, Spine1, LHipJoint...)
have zero-length or ambiguous bones. So each mapped target bone n gets a
rest-alignment rotation C(n) = minimal rotation taking the SOURCE rest bone
direction onto the TARGET rest bone direction (both world). Then

    D(n,t) = Yaw @ G_src(j,t) @ C(n)^-1          world delta for target bone n
    B(n)   = R_t(n)^-1 M^-1 D(p)^-1 D(n) M R_t(n)  (driftwake closed form)

G_src(j,t) is the BVH joint's GLOBAL rotation (identity at the BVH bind pose),
so the target bone's axis ends up exactly on the source bone's direction and
the source's twist carries through. CMU-only joints (LHipJoint, RHipJoint,
LowerBack's zero offset, Neck, finger bases, thumbs) are never mapped: their
rotation is already folded into their children's GLOBAL rotations.
Yaw turns the clip so the attack direction (chest->fist or hips->foot at
contact; final hips facing for getups; start facing for falls) points down
Blender -Y (= glTF +Z, the Mixamo/three.js forward).

ROOT: the pelvis point (mid hip joints) is scaled by the thigh+shin length
ratio (target/source); vertical is re-based so a planted source ankle lands on
the target's rest ankle height. Horizontal travel is kept, re-based to start
at the origin (the game can strip it).

GATE: every rendered frame re-measures, from the EVALUATED target pose, the
angle between each target bone's axis and the source bone direction; the max
is printed and written to <name>_report.json. By construction it must be ~0.
"""
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector, Quaternion

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "research"))
import bvh_lib as B  # noqa: E402

DATA = "F:/games/forgeflow-games-assets/_downloaded/cmu-mocap/cmu-mocap-master/data"

# target bone -> (source joint providing rotation, source point the bone aims at)
MAP = {
    "Hips": ("Hips", None),
    "Spine": ("LowerBack", "Spine"),
    "Spine1": ("Spine", "Spine1"),
    "Spine2": ("Spine1", None),
    "Neck": ("Neck1", "Head"),
    "Head": ("Head", "Head_End"),
    "LeftShoulder": ("LeftShoulder", "LeftArm"),
    "LeftArm": ("LeftArm", "LeftForeArm"),
    "LeftForeArm": ("LeftForeArm", "LeftHand"),
    "LeftHand": ("LeftFingerBase", "LeftHandIndex1"),  # Index1 hangs off FingerBase
    "RightShoulder": ("RightShoulder", "RightArm"),
    "RightArm": ("RightArm", "RightForeArm"),
    "RightForeArm": ("RightForeArm", "RightHand"),
    "RightHand": ("RightFingerBase", "RightHandIndex1"),
    "LeftUpLeg": ("LeftUpLeg", "LeftLeg"),
    "LeftLeg": ("LeftLeg", "LeftFoot"),
    "LeftFoot": ("LeftFoot", "LeftToeBase"),
    "LeftToeBase": ("LeftToeBase", "LeftToeBase_End"),
    "RightUpLeg": ("RightUpLeg", "RightLeg"),
    "RightLeg": ("RightLeg", "RightFoot"),
    "RightFoot": ("RightFoot", "RightToeBase"),
    "RightToeBase": ("RightToeBase", "RightToeBase_End"),
}
PFX = "mixamorig:"


def take_path(take):
    return "%s/%03d/%s.bvh" % (DATA, int(take.split("_")[0]), take)


def hdir(v):
    v = np.array([v[0], v[1], 0.0])
    return v / (np.linalg.norm(v) + 1e-12)


def yaw_matrix(fwd_h):
    """Rotation about Z taking horizontal direction fwd_h onto -Y."""
    phi = math.atan2(fwd_h[1], fwd_h[0])
    ang = math.atan2(-1.0, 0.0) - phi
    c, s = math.cos(ang), math.sin(ang)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1.0]])


def m3(a):
    return Matrix([list(a[0]), list(a[1]), list(a[2])])


def _swap_name(n):
    for a, b in (("Left", "Right"), ("LHip", "RHip"), ("LThumb", "RThumb")):
        if n.startswith(a):
            return b + n[len(a):]
        if n.startswith(b):
            return a + n[len(b):]
    return n


def mirror_source(d):
    """Mirror the take across the subject's sagittal plane (Blender X):
    p' = S p, G' = S G S with S = diag(-1,1,1), and Left<->Right joints swapped.
    Turns a southpaw take into an orthodox one (and any L move into an R move)."""
    S = np.diag([-1.0, 1.0, 1.0])
    names = d["names"]
    idx = d["idx"]
    perm = [idx[_swap_name(n)] for n in names]
    pos = np.einsum("ij,fkj->fki", S, d["pos"][:, perm])
    rot = np.einsum("ij,fkjl,lm->fkim", S, d["rot"][:, perm], S)
    rest = (S @ d["rest"][perm].T).T
    return pos, rot, rest


FIST_BONES = [f + k for f in ("Index", "Middle", "Ring", "Pinky") for k in ("1", "2", "3")]


def apply_fist(arm, deg):
    """Constant fist: curl every finger segment +deg about its local X
    (verified on X Bot: +X curls into the palm on BOTH hands)."""
    q = Quaternion(Vector((1.0, 0.0, 0.0)), math.radians(deg))
    for side in ("Left", "Right"):
        for fb in FIST_BONES:
            pb = arm.pose.bones.get(PFX + side + "Hand" + fb)
            if pb is None:
                continue
            pb.rotation_mode = "QUATERNION"
            pb.rotation_quaternion = q
            pb.keyframe_insert("rotation_quaternion", frame=1, group=side + "Hand" + fb)


def load_rig(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=path)
    arm = [o for o in bpy.data.objects if o.type == "ARMATURE"][0]
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    arm.animation_data_clear()
    return arm


def retarget(arm, clip, fps_out):
    take = clip["take"]
    d = B.load_blender(take_path(take))
    I = d["idx"]
    pos = d["pos"]
    rot = d["rot"]
    fps = d["fps"]
    rest = d["rest"]
    if clip.get("mirror"):
        pos, rot, rest = mirror_source(d)
    n = pos.shape[0]
    s, c, e = int(clip["start"]), int(clip["contact"]), int(clip["end"])
    step = max(1, int(round(fps / fps_out)))
    frames = list(range(s, e + 1, step))
    if frames[-1] != e:
        frames.append(e)

    # ---- facing
    kind = clip.get("kind")
    limb = clip.get("limb", "body")
    S = "Left" if limb.startswith("L") else "Right"
    if kind == "hand":
        fwd = hdir(pos[c, I[S + "HandIndex1_End"]] - pos[c, I["Spine1"]])
    elif kind in ("foot", "knee"):
        fwd = hdir(pos[c, I[S + ("Foot" if kind == "foot" else "Leg")]] - pos[c, I["Hips"]])
    elif kind in ("tpose", "fall"):
        fwd = hdir(rot[s, I["Hips"]] @ np.array([0, -1.0, 0]))
    else:
        fwd = hdir(rot[e, I["Hips"]] @ np.array([0, -1.0, 0]))
    if "face_override" in clip:
        fwd = hdir(np.array(clip["face_override"]))
    Yaw = yaw_matrix(fwd)

    # ---- target rest data
    M = arm.matrix_world.to_3x3().normalized()
    Mi = M.inverted()
    Mnp = np.array(M)
    Rt = {}
    for tb in MAP:
        Rt[tb] = arm.data.bones[PFX + tb].matrix_local.to_3x3()
    C = {}
    for tb, (sj, aim) in MAP.items():
        if aim is None:
            C[tb] = np.eye(3)
            continue
        ds = rest[I[aim]] - rest[I[sj]]
        ds = ds / np.linalg.norm(ds)
        dt = Mnp @ np.array(Rt[tb] @ Vector((0, 1, 0)))
        dt = dt / np.linalg.norm(dt)
        q = Vector(ds).rotation_difference(Vector(dt))
        C[tb] = np.array(q.to_matrix())

    # ---- root scaling: thigh+shin length ratio
    def tlen(a, b):
        return (arm.matrix_world @ arm.data.bones[PFX + b].head_local -
                arm.matrix_world @ arm.data.bones[PFX + a].head_local).length
    leg_t = tlen("LeftUpLeg", "LeftLeg") + tlen("LeftLeg", "LeftFoot")
    leg_s = float(np.linalg.norm(rest[I["LeftLeg"]] - rest[I["LeftUpLeg"]]) +
                  np.linalg.norm(rest[I["LeftFoot"]] - rest[I["LeftLeg"]]))
    ratio = leg_t / leg_s
    feet = [I[k] for k in ("LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase",
                           "LeftToeBase_End", "RightToeBase_End")]
    floor_s = float(np.percentile(pos[1:, feet, 2].min(1), 2))
    # planted source ankle height above the floor (median over frames where
    # the ankle is the foot's low point region, i.e. within 12 cm)
    ank = np.concatenate([pos[1:, I["LeftFoot"], 2], pos[1:, I["RightFoot"], 2]]) - floor_s
    ank_s = float(np.median(ank[ank < 0.12])) if np.any(ank < 0.12) else 0.08
    wm = arm.matrix_world
    ank_t = (wm @ arm.data.bones[PFX + "LeftFoot"].head_local).z - min(
        (wm @ b.head_local).z for b in arm.data.bones)
    hip_head_w = wm @ arm.data.bones[PFX + "Hips"].head_local
    pel_t_rest = (wm @ arm.data.bones[PFX + "LeftUpLeg"].head_local +
                  wm @ arm.data.bones[PFX + "RightUpLeg"].head_local) / 2
    off_rest = np.array(hip_head_w - pel_t_rest)  # pelvis point -> hips head, world, at rest
    pel_s = (pos[:, I["LeftUpLeg"]] + pos[:, I["RightUpLeg"]]) / 2
    start_xy = pel_s[s].copy()

    # ---- action
    try:
        bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
    except Exception:  # noqa
        pass
    arm.animation_data_create()
    act = bpy.data.actions.new(clip["name"])
    arm.animation_data.action = act
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    scn = bpy.context.scene
    scn.render.fps = fps_out
    hips_pb = arm.pose.bones[PFX + "Hips"]
    Rh = Rt["Hips"]
    order = [tb for tb in MAP]  # parents before children in MAP order
    parent = {tb: (arm.data.bones[PFX + tb].parent.name[len(PFX):]
                   if arm.data.bones[PFX + tb].parent else None) for tb in MAP}
    src_dirs = {}
    for k, f in enumerate(frames):
        fo = k + 1
        D = {}
        for tb in order:
            sj = MAP[tb][0]
            D[tb] = Yaw @ rot[f, I[sj]] @ C[tb].T
        for tb in order:
            p = parent[tb]
            Dp = D[p] if p in D else np.eye(3)
            Bm = Rt[tb].inverted() @ Mi @ m3(Dp.T @ D[tb]) @ M @ Rt[tb]
            pb = arm.pose.bones[PFX + tb]
            pb.rotation_quaternion = Bm.to_quaternion()
            pb.keyframe_insert("rotation_quaternion", frame=fo, group=tb)
        # root
        rel = pel_s[f] - start_xy
        rel = Yaw @ rel
        pel_w = np.array([ratio * rel[0], ratio * rel[1],
                          ratio * (pel_s[f, 2] - floor_s - ank_s) + ank_t +
                          0.0])
        # pel_s z measured from the floor: add back the hip-joint->ankle rest offset
        hips_w = pel_w + D["Hips"] @ off_rest
        pa = wm.inverted() @ Vector(hips_w)
        loc = Rh.inverted() @ (pa - arm.data.bones[PFX + "Hips"].head_local)
        hips_pb.location = loc
        hips_pb.keyframe_insert("location", frame=fo, group="Hips")
        src_dirs[fo] = {tb: (Yaw @ (pos[f, I[MAP[tb][1]]] - pos[f, I[MAP[tb][0]]]))
                        for tb in MAP if MAP[tb][1] is not None}
    if clip.get("fist"):
        apply_fist(arm, float(clip["fist"]))
    scn.frame_start = 1
    scn.frame_end = len(frames)
    info = {"frames_src": frames, "mirror": bool(clip.get("mirror")), "fist_deg": clip.get("fist", 0), "ratio_leg": ratio, "floor_src": floor_s, "ank_src": ank_s,
            "ank_tgt": ank_t, "fwd_src": list(map(float, fwd)), "step": step}
    return act, info, src_dirs


def measure(arm, fo, src_dirs):
    """Angle (deg) between each evaluated target bone axis and the source bone
    direction; lowest foot point z; hips z; forward of the hips."""
    scn = bpy.context.scene
    scn.frame_set(fo)
    bpy.context.view_layer.update()
    wm = arm.matrix_world
    worst = (-1.0, None)
    for tb, v in src_dirs[fo].items():
        pb = arm.pose.bones[PFX + tb]
        h = wm @ pb.head
        t = wm @ pb.tail
        a = (t - h).normalized()
        sv = Vector(v).normalized()
        ang = math.degrees(a.angle(sv))
        if ang > worst[0]:
            worst = (ang, tb)
    lows = [((wm @ arm.pose.bones[PFX + b].head).z, b + ".head") for b in
            ("LeftToeBase", "RightToeBase", "LeftToe_End", "RightToe_End", "LeftFoot", "RightFoot")]
    # NOTE: Toe_End.tail is Blender's synthetic leaf-bone extension (0.093 m past
    # the real toe tip at Toe_End.head), so it is deliberately not measured.
    low = min(lows)
    hips = wm @ arm.pose.bones[PFX + "Hips"].head
    # hips forward from the hip-joint line: (left - right) x up = forward (-Y at rest)
    l = wm @ arm.pose.bones[PFX + "LeftUpLeg"].head
    r = wm @ arm.pose.bones[PFX + "RightUpLeg"].head
    lr = (l - r)
    fwd = Vector((lr.y, -lr.x, 0.0))
    return {"max_dir_err_deg": round(worst[0], 3), "worst_bone": worst[1],
            "min_foot_z": round(low[0], 3), "min_foot_pt": low[1], "hips_z": round(hips.z, 3),
            "hips_xy": [round(hips.x, 3), round(hips.y, 3)],
            "hips_fwd_yaw_deg": round(math.degrees(math.atan2(fwd.y, fwd.x)), 1)}


def build_stage():
    """Checker floor (0.5 m tiles), a red forward post at 1.2 m down -Y,
    workbench shading, two cameras."""
    scn = bpy.context.scene
    try:
        scn.render.engine = "BLENDER_WORKBENCH"
    except TypeError:
        pass
    scn.display.shading.light = "STUDIO"
    scn.display.shading.color_type = "MATERIAL"
    scn.display.shading.show_shadows = True
    scn.display.shading.show_cavity = True
    scn.render.resolution_x = 420
    scn.render.resolution_y = 520
    scn.render.film_transparent = False
    world = bpy.data.worlds.new("W")
    scn.world = world
    world.color = (0.82, 0.84, 0.88)
    m1 = bpy.data.materials.new("tileA")
    m1.diffuse_color = (0.55, 0.57, 0.6, 1)
    m2 = bpy.data.materials.new("tileB")
    m2.diffuse_color = (0.75, 0.77, 0.8, 1)
    import bmesh
    me = bpy.data.meshes.new("floor")
    bm = bmesh.new()
    N = 12
    for i in range(-N, N):
        for j in range(-N, N):
            vs = [bm.verts.new((i * 0.5, j * 0.5, 0)), bm.verts.new(((i + 1) * 0.5, j * 0.5, 0)),
                  bm.verts.new(((i + 1) * 0.5, (j + 1) * 0.5, 0)), bm.verts.new((i * 0.5, (j + 1) * 0.5, 0))]
            f = bm.faces.new(vs)
            f.material_index = (i + j) % 2
    bm.to_mesh(me)
    bm.free()
    fl = bpy.data.objects.new("floor", me)
    me.materials.append(m1)
    me.materials.append(m2)
    scn.collection.objects.link(fl)
    mr = bpy.data.materials.new("post")
    mr.diffuse_color = (0.85, 0.1, 0.1, 1)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.03, depth=1.6, location=(0, -1.25, 0.8))
    post = bpy.context.active_object
    post.data.materials.append(mr)
    cam_d = bpy.data.cameras.new("cam")
    cam_d.type = "ORTHO"
    cam_d.ortho_scale = 2.9
    cam = bpy.data.objects.new("cam", cam_d)
    scn.collection.objects.link(cam)
    scn.camera = cam
    return cam


def aim(cam, target, az_deg, el_deg, dist=6.0):
    """az measured from the character's forward (-Y), positive toward its right (-X)."""
    az = math.radians(az_deg)
    el = math.radians(el_deg)
    fwd = Vector((0, -1, 0))
    right = Vector((-1, 0, 0))
    d = (fwd * math.cos(az) + right * math.sin(az)) * math.cos(el) + Vector((0, 0, math.sin(el)))
    cam.location = Vector(target) + d * dist
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()


def export_glb(arm, path):
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    for ch in arm.children:
        ch.select_set(True)
    bpy.context.view_layer.objects.active = arm
    kw = dict(filepath=path, export_format="GLB", use_selection=True, export_animations=True,
              export_force_sampling=True, export_frame_range=True, export_def_bones=False,
              export_optimize_animation_size=False)
    try:
        bpy.ops.export_scene.gltf(export_animation_mode="ACTIVE_ACTIONS", **kw)
    except TypeError as ex:
        print("GLTF kwargs rejected, retrying minimal:", ex)
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True,
                                  export_animations=True)


def main():
    jobs = json.load(open(sys.argv[sys.argv.index("--") + 1]))
    od = jobs["out_dir"]
    os.makedirs(od, exist_ok=True)
    fps_out = jobs.get("fps_out", 60)
    summary = []
    for clip in jobs["clips"]:
        arm = load_rig(jobs["rig"])
        act, info, src_dirs = retarget(arm, clip, fps_out)
        n_out = len(info["frames_src"])
        if not clip.get("no_glb"):
            export_glb(arm, os.path.join(od, clip["name"] + ".glb"))
        cam = build_stage()
        # frames to render: start, windup, contact, end (in OUTPUT frame numbers)
        fr = info["frames_src"]

        def out_of(src):
            return 1 + min(range(len(fr)), key=lambda k: abs(fr[k] - src))
        s, c, e = int(clip["start"]), int(clip["contact"]), int(clip["end"])
        if clip.get("kind") in ("getup", "fall"):
            picks = [s, s + (e - s) // 3, s + 2 * (e - s) // 3, e]
        elif clip.get("kind") == "tpose":
            picks = [s]
        else:
            picks = [s, (s + c) // 2, c, e]
        rep = {"clip": clip, "info": info, "frames": []}
        side = 1.0 if clip.get("limb", "R").startswith("R") else -1.0
        worst = 0.0
        # gate over EVERY output frame
        for fo in range(1, n_out + 1):
            mm = measure(arm, fo, src_dirs)
            worst = max(worst, mm["max_dir_err_deg"])
        rep["max_dir_err_all_frames_deg"] = round(worst, 4)
        allm = [(measure(arm, fo, src_dirs), fo) for fo in range(1, n_out + 1)]
        mlow = min(allm, key=lambda t: t[0]["min_foot_z"])
        minz = mlow[0]["min_foot_z"]
        rep["min_foot_z_all_frames_m"] = minz
        rep["min_foot_at"] = {"out_frame": mlow[1], "src_frame": info["frames_src"][mlow[1] - 1],
                              "point": mlow[0]["min_foot_pt"]}
        # frames whose lowest foot point is > 3 cm under the floor
        rep["frames_foot_below_3cm"] = sum(1 for m, _ in allm if m["min_foot_z"] < -0.03)
        rep["frames_total"] = n_out
        for k, sf in enumerate(picks):
            fo = out_of(sf)
            mm = measure(arm, fo, src_dirs)
            mm["src_frame"] = sf
            mm["out_frame"] = fo
            rep["frames"].append(mm)
            tgt = (mm["hips_xy"][0], mm["hips_xy"][1], 0.95)
            for tag, az, el in (("A", 62.0 * side, 12.0), ("B", 0.0, 8.0), ("C", 90.0, 5.0)):
                aim(cam, tgt, az, el)
                bpy.context.scene.frame_set(fo)
                bpy.context.scene.render.filepath = os.path.join(od, "%s_%d%s.png" % (clip["name"], k, tag))
                bpy.ops.render.render(write_still=True)
        with open(os.path.join(od, clip["name"] + "_report.json"), "w") as fh:
            json.dump(rep, fh, indent=1)
        print("CLIP", clip["name"], "frames_out", n_out, "max_dir_err_deg", rep["max_dir_err_all_frames_deg"],
              "min_foot_z", minz, "ratio", round(info["ratio_leg"], 4))
        summary.append({"name": clip["name"], "max_dir_err_deg": rep["max_dir_err_all_frames_deg"],
                        "min_foot_z": minz})
    with open(os.path.join(od, "pilot_summary.json"), "w") as fh:
        json.dump(summary, fh, indent=1)


if __name__ == "__main__":
    main()
