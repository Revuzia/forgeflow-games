"""Measure the striking body part at the judged contact frames of the curated move map.

Usage: blender --background --python mixamo_contact_measure.py -- <move_map.json> <anim_root> <out_json>

For each entry with contact frames: at every contact frame, record (world metres, X Bot scale):
  reach_fwd   striker position minus hips, along the MODEL forward axis (-Y world)
  side        same, along the model right axis (-X world; + = character's right)
  height      striker height above the floor
  hips_fwd    hips travel from frame 1 to the contact frame, along the model forward axis
  t           seconds from the clip start
  front_*     the frame in [contact-8, contact+3] where the striker is farthest forward of the hips
              (sweeping strikes pass the front before the end of the motion) and its reach/side/height
Striker names: RightHand/LeftHand (Middle1 knuckles), RightFoot/LeftFoot (ToeBase), RightKnee/LeftKnee
(Leg head), Head (HeadTop_End), 'legs' (whichever foot is farther from the hips), 'body' (Spine2),
'hands' (midpoint of both hands). 'A/B/C' lists one striker per contact frame.
ASCII only.
"""
import bpy
import sys
import os
import json
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
MAP, ROOT, OUT = argv[0], argv[1], argv[2]
BONE = {"RightHand": "RightHandMiddle1", "LeftHand": "LeftHandMiddle1", "RightFoot": "RightToeBase",
        "LeftFoot": "LeftToeBase", "RightKnee": "RightLeg", "LeftKnee": "LeftLeg", "Head": "HeadTop_End",
        "body": "Spine2"}
entries = json.load(open(MAP))["entries"]
out = {}
for e in entries:
    if not e.get("contact"):
        continue
    pack, clip = e["k"].split("/", 1)
    path = os.path.join(ROOT, pack, clip + ".fbx")
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=path)
    scn = bpy.context.scene
    arm = next(o for o in scn.objects if o.type == "ARMATURE")
    pbs = {pb.name.split(":")[-1]: pb for pb in arm.pose.bones}
    wm = arm.matrix_world
    fps = scn.render.fps / scn.render.fps_base
    f0 = int(round(arm.animation_data.action.frame_range[0]))
    scn.frame_set(f0)
    hips0 = wm @ pbs["Hips"].head
    # MODEL forward (-Y world = rest toe direction of every X Bot clip, measured): the game turns the
    # whole model toward its target, so reach is measured along the model axis, not the stance feet.
    fw = Vector((0.0, -1.0, 0.0))
    right = fw.cross(Vector((0, 0, 1)))
    strikers = e["striker"].split("/") if e["striker"] else []
    res = []
    for i, f in enumerate(e["contact"]):
        st = strikers[i] if i < len(strikers) else (strikers[-1] if strikers else "")
        st = st.split("(")[0].strip()
        scn.frame_set(f)
        hips = wm @ pbs["Hips"].head
        if st in BONE:
            p = wm @ pbs[BONE[st]].head
        elif st.startswith("legs"):
            a, b = wm @ pbs["LeftToeBase"].head, wm @ pbs["RightToeBase"].head
            p = a if (a - hips).length > (b - hips).length else b
        elif st == "hands":
            p = ((wm @ pbs["LeftHandMiddle1"].head) + (wm @ pbs["RightHandMiddle1"].head)) * 0.5
        else:
            p = None
        r = {"frame": f, "t": round((f - f0) / fps, 3), "striker": st or None,
             "hips_fwd": round((hips - hips0).dot(fw), 3), "hips_z": round(hips.z, 3)}
        if p is not None:
            d = p - hips
            r.update({"reach_fwd": round(d.dot(fw), 3), "side": round(d.dot(right), 3), "height": round(p.z, 3)})
        # FRONT PASS: sweeping strikes (hooks, backfists, spins) cross the model-forward axis before the
        # judged end of the motion. Scan [f-8, f+3] and keep the frame where the striker is farthest
        # forward of the hips - the moment a target standing straight ahead would be hit.
        if st in BONE or st.startswith("legs") or st == "hands":
            f1 = int(round(arm.animation_data.action.frame_range[1]))
            best = None
            for g in range(max(f0, f - 8), min(f1, f + 3) + 1):
                scn.frame_set(g)
                hg = wm @ pbs["Hips"].head
                if st in BONE:
                    q = wm @ pbs[BONE[st]].head
                elif st == "hands":
                    q = ((wm @ pbs["LeftHandMiddle1"].head) + (wm @ pbs["RightHandMiddle1"].head)) * 0.5
                else:
                    a, b = wm @ pbs["LeftToeBase"].head, wm @ pbs["RightToeBase"].head
                    q = a if (a - hg).length > (b - hg).length else b
                dq = q - hg
                if best is None or dq.dot(fw) > best[1]:
                    best = (g, dq.dot(fw), dq.dot(right), q.z)
            r.update({"front_frame": best[0], "front_t": round((best[0] - f0) / fps, 3),
                      "front_reach_fwd": round(best[1], 3), "front_side": round(best[2], 3),
                      "front_height": round(best[3], 3)})
        res.append(r)
    out[e["k"]] = res
    print("[contact]", e["k"], res, flush=True)
json.dump(out, open(OUT, "w"), indent=1)
print("[contact] DONE", len(out))
