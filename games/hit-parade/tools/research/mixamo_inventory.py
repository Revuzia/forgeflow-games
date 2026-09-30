"""HIT PARADE research: measure every Mixamo pack clip (timing, root motion, strike contact).

Usage:
  blender --background --python mixamo_inventory.py -- <out_json> <ref_xbot_fbx> <pack_dir> [<pack_dir> ...]

For each *.fbx in each pack dir (X Bot.fbx skipped) the clip is imported into a clean scene and
sampled on every integer frame of its action. All positions are WORLD metres (the FBX armature
object carries the 0.01 cm->m scale and the +90 deg X stand-up; arm.matrix_world folds both in).

Per clip:
  timing      fps, frame range, frames, duration_s
  skeleton    bone count, missing/extra vs reference X Bot, rest-orientation maxdiff vs X Bot
  hips        horizontal travel (start->end, split into forward/right of the INITIAL facing),
              max horizontal excursion, path length, vertical min/max/range, net yaw
  loop        pose error first vs last frame (max body-bone angle, deg) -> is it a cycle
  tracks      bones whose location fcurves actually vary (non-hips translation = proportion risk)
  effectors   per end-effector peak speed RELATIVE TO HIPS (m/s) and frame
  hits        strike candidates: effector with the highest limb-normalised speed peak, the peak
              frame, and the CONTACT frame = first frame after the peak where the effector stops
              extending (distance from its limb root reaches a local max) or its speed falls
              below 50% of the peak, whichever comes first.
ASCII only.
"""
import bpy
import sys
import os
import json
import math
import re
import time
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0]
REF = argv[1]
PACKS = argv[2:]

P = "mixamorig:"

EFFECTORS = {
    # name: (bone for position, fallback, limb root bone)
    "RightHand": ("RightHandMiddle1", "RightHand", "RightArm"),
    "LeftHand": ("LeftHandMiddle1", "LeftHand", "LeftArm"),
    "RightElbow": ("RightForeArm", None, "RightArm"),
    "LeftElbow": ("LeftForeArm", None, "LeftArm"),
    "RightFoot": ("RightToeBase", "RightFoot", "RightUpLeg"),
    "LeftFoot": ("LeftToeBase", "LeftFoot", "LeftUpLeg"),
    "RightKnee": ("RightLeg", None, "RightUpLeg"),
    "LeftKnee": ("LeftLeg", None, "LeftUpLeg"),
    "Head": ("HeadTop_End", "Head", "Hips"),
}
BODY_BONES = ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head", "LeftShoulder", "LeftArm",
              "LeftForeArm", "LeftHand", "RightShoulder", "RightArm", "RightForeArm", "RightHand",
              "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase", "RightUpLeg", "RightLeg",
              "RightFoot", "RightToeBase"]

ATTACK_RE = re.compile(r"attack|kick|punch|swip|slash|knee|header|tackle|throw|strike|combo|"
                       r"backhand|horizontal|downward|360|scissor|penalty|flair|bit(e|ing)|"
                       r"body block|trip|swipes|power up|casting|spell|magic", re.I)


def log(*a):
    print("[inv]", *a, flush=True)


def act_fcurves(act):
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


def clean_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_fbx(path):
    bpy.ops.import_scene.fbx(filepath=path)
    arm = next((o for o in bpy.context.scene.objects if o.type == "ARMATURE"), None)
    return arm


def strip(n):
    return n.split(":")[-1]


def rest_table(arm):
    wm3 = arm.matrix_world.to_3x3().normalized()
    wm = arm.matrix_world
    out = {}
    for b in arm.data.bones:
        out[strip(b.name)] = (wm3 @ b.matrix_local.to_3x3(), wm @ b.matrix_local.translation)
    return out


def mat_maxdiff(a, b):
    return max(abs(a[i][j] - b[i][j]) for i in range(3) for j in range(3))


def rot_angle_deg(a, b):
    q = (a.transposed() @ b).to_quaternion()
    w = min(1.0, abs(q.w))
    return math.degrees(2.0 * math.acos(w))


# ------------------------------------------------------------------ reference X Bot
clean_scene()
ref_arm = import_fbx(REF)
REF_REST = rest_table(ref_arm)
REF_NAMES = set(REF_REST.keys())
# facing: rest toe direction (Toe_End minus Foot), horizontal, both feet averaged
_fw = Vector((0, 0, 0))
for side in ("Left", "Right"):
    _fw += REF_REST[side + "Toe_End"][1] - REF_REST[side + "Foot"][1]
_fw.z = 0
_fw.normalize()
REST_FWD_WORLD = _fw.copy()
REF_HIP_H = REF_REST["Hips"][1].z
log("reference", REF, "bones", len(REF_NAMES), "rest forward", tuple(round(v, 3) for v in REST_FWD_WORLD),
    "hip height", round(REF_HIP_H, 4))


def analyse(path, pack):
    clean_scene()
    t0 = time.time()
    arm = import_fbx(path)
    scn = bpy.context.scene
    rec = {"pack": pack, "clip": os.path.splitext(os.path.basename(path))[0], "file": path.replace("\\", "/")}
    if arm is None:
        rec["error"] = "no armature"
        return rec
    fps = scn.render.fps / scn.render.fps_base
    meshes = [o.name for o in scn.objects if o.type == "MESH"]
    rec["has_skin_mesh"] = bool(meshes)
    ad = arm.animation_data
    if not ad or not ad.action:
        rec["error"] = "no action"
        return rec
    act = ad.action
    f0, f1 = int(round(act.frame_range[0])), int(round(act.frame_range[1]))
    rec["fps"] = fps
    rec["frame_start"] = f0
    rec["frame_end"] = f1
    rec["frames"] = f1 - f0 + 1
    rec["duration_s"] = round((f1 - f0) / fps, 4)

    # skeleton check vs reference
    rest = rest_table(arm)
    names = set(rest.keys())
    rec["n_bones"] = len(names)
    rec["missing_vs_xbot"] = sorted(REF_NAMES - names)
    rec["extra_vs_xbot"] = sorted(names - REF_NAMES)
    md, mdb = 0.0, None
    pd, pdb = 0.0, None
    for n in names & REF_NAMES:
        m_ = mat_maxdiff(rest[n][0], REF_REST[n][0])
        if m_ > md:
            md, mdb = m_, n
        p_ = (rest[n][1] - REF_REST[n][1]).length
        if p_ > pd:
            pd, pdb = p_, n
    rec["rest_rot_maxdiff_vs_xbot"] = round(md, 5)
    rec["rest_rot_maxdiff_bone"] = mdb
    rec["rest_pos_maxdiff_vs_xbot_m"] = round(pd, 5)
    rec["rest_pos_maxdiff_bone"] = pdb
    rec["rest_hip_height_clip"] = round(rest["Hips"][1].z, 4) if "Hips" in rest else None

    # varying translation tracks
    pat = re.compile(r'pose\.bones\["([^"]+)"\]\.location')
    loc_var = {}
    for fc in act_fcurves(act):
        m = pat.match(fc.data_path)
        if not m:
            continue
        vals = [kp.co.y for kp in fc.keyframe_points]
        if vals:
            r = max(vals) - min(vals)
            bn = strip(m.group(1))
            loc_var[bn] = max(loc_var.get(bn, 0.0), r)
    rec["location_varying_bones"] = sorted([k for k, v in loc_var.items() if v > 0.01])  # armature units (cm)

    # sample
    pbs = {strip(pb.name): pb for pb in arm.pose.bones}
    wm = arm.matrix_world
    wm3 = wm.to_3x3().normalized()
    hips_rest3 = rest["Hips"][0]  # world
    fwd_local = hips_rest3.inverted() @ REST_FWD_WORLD

    def epos(key):
        b, fb, root = EFFECTORS[key]
        pb = pbs.get(b) or (pbs.get(fb) if fb else None)
        return pb

    eff_pb = {k: epos(k) for k in EFFECTORS}
    root_pb = {k: pbs.get(EFFECTORS[k][2]) for k in EFFECTORS}
    frames = list(range(f0, f1 + 1))
    H, FW, EFF, ROOT, BODYW = [], [], {k: [] for k in EFFECTORS}, {k: [] for k in EFFECTORS}, []
    for f in frames:
        scn.frame_set(f)
        hp = wm @ pbs["Hips"].head
        H.append(hp.copy())
        hw3 = wm3 @ pbs["Hips"].matrix.to_3x3().normalized()
        fv = hw3 @ fwd_local
        fv.z = 0
        if fv.length > 1e-6:
            fv.normalize()
        FW.append(fv)
        for k in EFFECTORS:
            pb = eff_pb[k]
            EFF[k].append((wm @ pb.head).copy() if pb else None)
            rp = root_pb[k]
            ROOT[k].append((wm @ rp.head).copy() if rp else None)
        if f == f0 or f == f1:
            BODYW.append({n: (wm3 @ pbs[n].matrix.to_3x3().normalized()) for n in BODY_BONES if n in pbs})

    n = len(frames)
    # MODEL axes: the game turns the whole model to face its target, so strikes and root motion are
    # expressed along the model's fixed forward (rest toe direction, -Y world) - not the hips, which
    # are twisted in side-on stances. Hips-facing values are kept as *_hipsfacing.
    hf0 = FW[0]
    hr0 = hf0.cross(Vector((0, 0, 1)))
    fwd0 = REST_FWD_WORLD.copy()
    right0 = fwd0.cross(Vector((0, 0, 1)))  # right = fwd x up
    d = H[-1] - H[0]
    dh = Vector((d.x, d.y, 0))
    exc = max(Vector(((h - H[0]).x, (h - H[0]).y, 0)).length for h in H)
    path = sum(Vector(((H[i + 1] - H[i]).x, (H[i + 1] - H[i]).y, 0)).length for i in range(n - 1))
    zs = [h.z for h in H]
    yaw0 = math.atan2(FW[0].y, FW[0].x)
    # unwrap yaw
    tot = 0.0
    prev = yaw0
    for fv in FW[1:]:
        y = math.atan2(fv.y, fv.x)
        dy = y - prev
        while dy > math.pi:
            dy -= 2 * math.pi
        while dy < -math.pi:
            dy += 2 * math.pi
        tot += dy
        prev = y
    rec["hips"] = {
        "start_z": round(H[0].z, 4), "end_z": round(H[-1].z, 4),
        "z_min": round(min(zs), 4), "z_max": round(max(zs), 4), "z_range": round(max(zs) - min(zs), 4),
        "travel_h": round(dh.length, 4),
        "travel_fwd": round(dh.dot(fwd0), 4), "travel_right": round(dh.dot(right0), 4),
        "travel_fwd_hipsfacing": round(dh.dot(hf0), 4), "travel_right_hipsfacing": round(dh.dot(hr0), 4),
        "start_hips_yaw_vs_model_deg": round(math.degrees(math.atan2(fwd0.cross(hf0).z, fwd0.dot(hf0))), 1),
        "max_excursion_h": round(exc, 4), "path_h": round(path, 4),
        "net_yaw_deg": round(math.degrees(tot), 2),
        "ref_rest_hip_height": round(REF_HIP_H, 4),
    }
    # loop error first vs last
    if len(BODYW) == 2:
        le = 0.0
        for nm in BODYW[0]:
            if nm in BODYW[1]:
                le = max(le, rot_angle_deg(BODYW[0][nm], BODYW[1][nm]))
        rec["loop_pose_err_deg"] = round(le, 2)
        rec["loop_hips_z_err"] = round(abs(H[-1].z - H[0].z), 4)

    # effector kinematics relative to hips
    dt = 1.0 / fps
    eff_out = {}
    speed = {}
    ext = {}
    rel = {}
    limb_len = {}
    for k in EFFECTORS:
        if EFF[k][0] is None or ROOT[k][0] is None:
            continue
        r = [EFF[k][i] - H[i] for i in range(n)]
        rel[k] = r
        s = [0.0] * n
        for i in range(n):
            a = r[max(0, i - 1)]
            b = r[min(n - 1, i + 1)]
            span = (min(n - 1, i + 1) - max(0, i - 1)) * dt
            s[i] = (b - a).length / span if span > 0 else 0.0
        speed[k] = s
        ext[k] = [(EFF[k][i] - ROOT[k][i]).length for i in range(n)]
        # rest limb length from the reference rest (root -> effector bone head)
        b, fb, rootb = EFFECTORS[k]
        bb = b if b in REF_REST else fb
        limb_len[k] = max(0.05, (REF_REST[bb][1] - REF_REST[rootb][1]).length)
        im = max(range(n), key=lambda i: s[i])
        eff_out[k] = {"peak_speed": round(s[im], 3), "peak_frame": frames[im],
                      "max_ext_ratio": round(max(ext[k]) / limb_len[k], 3)}
    rec["effectors"] = eff_out

    # head displacement (reaction direction) relative to start, in the initial facing frame
    if "Head" in rel:
        hd = [EFF["Head"][i] - EFF["Head"][0] for i in range(n)]
        im = max(range(n), key=lambda i: Vector((hd[i].x, hd[i].y, 0)).length)
        rec["head_max_disp"] = {"frame": frames[im], "fwd": round(hd[im].dot(fwd0), 3),
                                "right": round(hd[im].dot(right0), 3), "up": round(hd[im].z, 3)}

    # hit candidates: striking END-effectors (hands, feet, head) by raw speed relative to hips.
    # Elbow/knee strikes are resolved afterwards from the joint angle at contact.
    STRIKERS = ("RightHand", "LeftHand", "RightFoot", "LeftFoot", "Head")
    norm = {k: speed[k] for k in speed if k in STRIKERS}
    gmax = max((max(v) for v in norm.values()), default=0.0)

    JA = {}  # interior angle at elbow/knee per frame (180 = straight)
    for side in ("Left", "Right"):
        for limb, (ra, rb, rc) in (("arm", ("Arm", "ForeArm", "Hand")), ("leg", ("UpLeg", "Leg", "Foot"))):
            JA[(side, limb)] = []
    # re-sample joint angles (cheap second pass)
    for i, f in enumerate(frames):
        scn.frame_set(f)
        for side in ("Left", "Right"):
            for limb, (ra, rb, rc) in (("arm", ("Arm", "ForeArm", "Hand")), ("leg", ("UpLeg", "Leg", "Foot"))):
                pa, pb_, pc = pbs.get(side + ra), pbs.get(side + rb), pbs.get(side + rc)
                if not (pa and pb_ and pc):
                    JA[(side, limb)].append(None)
                    continue
                u = pa.head - pb_.head
                v = pc.head - pb_.head
                JA[(side, limb)].append(math.degrees(u.angle(v)) if u.length > 1e-6 and v.length > 1e-6 else None)
    cands = []
    for k, sv in norm.items():
        for i in range(2, n - 2):
            if sv[i] < 0.5 * gmax:
                continue
            if not (sv[i] >= sv[i - 1] and sv[i] >= sv[i + 1] and sv[i] >= sv[i - 2] and sv[i] >= sv[i + 2]):
                continue
            # contact: first frame after peak where extension stops rising or speed < 50% peak
            c = None
            for j in range(i, min(n - 1, i + 15)):
                if ext[k][j + 1] < ext[k][j] - 1e-4 or speed[k][j + 1] < 0.5 * speed[k][i]:
                    c = j
                    break
            if c is None:
                c = min(n - 1, i + 15)
            a0 = max(0, i - 4)
            extending = ext[k][c] >= ext[k][a0] - 0.03
            fwd_gain = (rel[k][c] - rel[k][a0]).dot(fwd0)
            cands.append({"eff": k, "peak_i": i, "contact_i": c, "norm": sv[i], "speed": speed[k][i],
                          "extending": extending, "fwd_gain": fwd_gain,
                          "ext_ratio": ext[k][c] / limb_len[k],
                          "height": EFF[k][c].z})
    # group by time, keep best normalised speed among extending candidates
    cands.sort(key=lambda c: c["peak_i"])
    groups = []
    for c in cands:
        if groups and c["peak_i"] - groups[-1][-1]["peak_i"] <= 5:
            groups[-1].append(c)
        else:
            groups.append([c])
    hits = []
    for g in groups:
        ext_g = [c for c in g if c["extending"]]
        pool = ext_g if ext_g else g
        best = max(pool, key=lambda c: c["norm"])
        eff = best["eff"]
        ci = best["contact_i"]
        jang = None
        striker = eff
        if eff.endswith("Hand"):
            side = eff[:-4]
            jang = JA[(side, "arm")][ci]
            if jang is not None and jang < 70.0:
                striker = side + "Elbow"
        elif eff.endswith("Foot"):
            side = eff[:-4]
            jang = JA[(side, "leg")][ci]
            if jang is not None and jang < 100.0:
                striker = side + "Knee"
        hits.append({
            "effector": striker, "fastest_end_effector": eff,
            "joint_angle_at_contact_deg": None if jang is None else round(jang, 1),
            "extending": best["extending"],
            "peak_frame": frames[best["peak_i"]], "contact_frame": frames[best["contact_i"]],
            "contact_t": round((frames[best["contact_i"]] - f0) / fps, 3),
            "peak_speed": round(best["speed"], 2), "norm_speed": round(best["norm"], 2),
            "ext_ratio_at_contact": round(best["ext_ratio"], 3),
            "fwd_gain_m": round(best["fwd_gain"], 3),
            "contact_height_m": round((EFF[striker][ci].z if EFF.get(striker) and EFF[striker][ci] is not None
                                       else best["height"]), 3),
            "contact_fwd_m": round(((EFF[striker][ci] if EFF.get(striker) and EFF[striker][ci] is not None
                                     else EFF[eff][ci]) - H[ci]).dot(fwd0), 3),
            "runners_up": sorted({c["eff"] for c in g if c is not best}),
        })
    rec["hits"] = hits
    rec["attack_like"] = bool(ATTACK_RE.search(rec["clip"]))
    rec["t_analyse_s"] = round(time.time() - t0, 2)
    return rec


results = []
for pdir in PACKS:
    pack = os.path.basename(os.path.normpath(pdir))
    files = sorted(f for f in os.listdir(pdir) if f.lower().endswith(".fbx") and f != "X Bot.fbx")
    log("pack", pack, len(files), "clips")
    for f in files:
        try:
            rec = analyse(os.path.join(pdir, f), pack)
        except Exception as e:  # keep going, record the failure verbatim
            rec = {"pack": pack, "clip": os.path.splitext(f)[0], "error": repr(e)}
        results.append(rec)
        log(pack, rec["clip"], "frames", rec.get("frames"), "hits",
            [(h["effector"], h["contact_frame"]) for h in rec.get("hits", [])][:4], rec.get("error", ""))
    with open(OUT, "w") as fh:
        json.dump(results, fh, indent=1)
with open(OUT, "w") as fh:
    json.dump(results, fh, indent=1)
log("DONE", len(results), "->", OUT)
