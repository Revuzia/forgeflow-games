"""HIT PARADE - body extents along the fight line, measured on a baked fighter GLB (CHANGED(fixer) D2).

  blender.exe --background --python art/blender/measure_body.py -- <qc.glb> <clips.json> <out.json> [clip,clip,...|@neutral|@all]

Why: the sim's push box (fighters/<id>.json `pushbox`) was a build-factor guess (0.85 x 0.30 H), so two neutral bodies
touching at the minimum separation overlapped visibly (verifier D2: johnny vs bruno stop 0.52 m apart, Johnny's head
inside Bruno's chest). This measures the REAL skinned mesh per frame so the generator (data/fighters/_gen) can size it.

Per clip and baked frame (30 fps) it evaluates the skinned mesh and splits the vertices by their dominant bone:
  core   = Hips, Spine, Spine1, Spine2, Neck, Head, HeadTop_End, Left/RightShoulder, Left/RightUpLeg (the body mass a push
           box stands for; arms, forearms, hands, shins and feet may overlap an opponent the way they do in every 2D/2.5D
           fighter)
  full   = every vertex
and records, fighter-local (x_fwd = the model's forward = Blender -Y, root at the origin):
  core_front / core_back = 98th percentile of +x_fwd / -x_fwd over the core vertices (robust to a few stray vertices)
  full_front / full_back = the same over all vertices, and top = max height.
Output: { fighter, fps, clips: { <clip>: { frames, core_front:[..], core_back:[..], full_front:[..], full_back:[..], top:[..] } } }
ASCII only.
"""
import json
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import hp_common as C  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:]
GLB, CLIPS_JSON, OUT = [os.path.abspath(x).replace("\\", "/") for x in argv[:3]]
SEL = argv[3] if len(argv) > 3 else "@neutral"
FPS = 30
NEUTRAL = ["idle", "walk_f", "walk_b", "crouch_idle", "block_high", "block_low", "dash_f", "dash_b", "land"]
CORE = ("Hips", "Spine", "Spine1", "Spine2", "Neck", "Head", "HeadTop_End", "LeftShoulder", "RightShoulder",
        "LeftUpLeg", "RightUpLeg")
PCT = 98.0


def setup():
    C.reset_scene()
    bpy.context.scene.render.fps = FPS
    bpy.context.scene.render.fps_base = 1.0
    bpy.ops.import_scene.gltf(filepath=GLB)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers)]
    C.remove_objects([o for o in bpy.data.objects if o.type == "MESH" and o not in meshes])
    return arm, meshes


def core_masks(meshes):
    masks = []
    for o in meshes:
        n = len(o.data.vertices)
        names = {g.index: C.strip(g.name) if hasattr(C, "strip") else g.name.split(":")[-1] for g in o.vertex_groups}
        best_w = np.zeros(n, dtype=np.float32)
        best_core = np.zeros(n, dtype=bool)
        for v in o.data.vertices:
            for ge in v.groups:
                if ge.weight > best_w[v.index]:
                    best_w[v.index] = ge.weight
                    nm = names.get(ge.group, "")
                    nm = nm.split(":")[-1].replace("mixamorig", "")
                    best_core[v.index] = nm in CORE
        masks.append(best_core)
    return masks


def action_for(name):
    a = bpy.data.actions.get(name)
    if a:
        return a
    for a in bpy.data.actions:
        if a.name.split("_")[0] == name or a.name.startswith(name + "_") or a.name.startswith(name + "|"):
            return a
    return None


def assign(arm, act):
    arm.animation_data_create()
    arm.animation_data.action = act
    if getattr(arm.animation_data, "action_slot", None) is None and len(act.slots):
        arm.animation_data.action_slot = act.slots[0]


def sample(meshes, masks):
    deps = bpy.context.evaluated_depsgraph_get()
    core_x, all_x, top = [], [], -1e9
    for o, mk in zip(meshes, masks):
        ev = o.evaluated_get(deps)
        me = ev.to_mesh()
        n = len(me.vertices)
        co = np.empty(n * 3, dtype=np.float32)
        me.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        M = np.array(ev.matrix_world)
        w = co @ M[:3, :3].T + M[:3, 3]
        x_fwd = -w[:, 1]
        all_x.append(x_fwd)
        if len(mk) == n:
            core_x.append(x_fwd[mk])
        top = max(top, float(w[:, 2].max()))
        ev.to_mesh_clear()
    ax = np.concatenate(all_x)
    cx = np.concatenate(core_x) if core_x else ax
    return (float(np.percentile(cx, PCT)), float(np.percentile(-cx, PCT)), float(np.percentile(ax, PCT)),
            float(np.percentile(-ax, PCT)), top)


def main():
    with open(CLIPS_JSON, encoding="utf-8") as f:
        cj = json.load(f)
    fid = cj.get("fighter") or os.path.basename(CLIPS_JSON).split(".")[0]
    arm, meshes = setup()
    masks = core_masks(meshes)
    ncore = sum(int(m.sum()) for m in masks)
    nall = sum(len(m) for m in masks)
    if SEL == "@neutral":
        want = [c for c in NEUTRAL if c in cj["clips"]]
    elif SEL == "@all":
        want = list(cj["clips"].keys())
    else:
        want = [c for c in SEL.split(",") if c]
    scn = bpy.context.scene
    out = {"fighter": fid, "fps": FPS, "glb": GLB, "coreVerts": ncore, "verts": nall, "pct": PCT, "clips": {}}
    for clip in want:
        act = action_for(clip)
        if act is None or clip not in cj["clips"]:
            out["clips"][clip] = {"missing": True}
            continue
        assign(arm, act)
        frames = int(cj["clips"][clip]["frames"])
        rec = {"frames": frames, "core_front": [], "core_back": [], "full_front": [], "full_back": [], "top": []}
        for fr in range(frames):
            scn.frame_set(fr)
            cf, cb, ff, fbk, tp = sample(meshes, masks)
            rec["core_front"].append(round(cf, 4))
            rec["core_back"].append(round(cb, 4))
            rec["full_front"].append(round(ff, 4))
            rec["full_back"].append(round(fbk, 4))
            rec["top"].append(round(tp, 4))
        out["clips"][clip] = rec
        print("[measure_body] %s %s: core front %.3f..%.3f back %.3f..%.3f | full front max %.3f" % (
            fid, clip, min(rec["core_front"]), max(rec["core_front"]), min(rec["core_back"]), max(rec["core_back"]),
            max(rec["full_front"])))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, indent=1)
    print("[measure_body] wrote", OUT)


main()
