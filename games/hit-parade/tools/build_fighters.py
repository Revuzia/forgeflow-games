"""HIT PARADE - per-fighter GLB pipeline driver (lane ASSETS, CONTRACT section 6).

  python tools/build_fighters.py --fighter johnny            # shared + fighter clipplan
  python tools/build_fighters.py --all                       # every fighter in tools/bodies.json
  python tools/build_fighters.py --all --skip johnny,bruno   # the rest (or --fighter a,b,c)
  python tools/build_fighters.py --fighter bruno --shared-only --clips idle,walk_f   (subset, testing)
  python tools/build_fighters.py --fighter johnny --check     # resolve + validate the plan only, no bake
  options: --no-qc  --keep-blend  --budget-mb 3.0  --blender <exe>  --no-publish (subset tests)
           --from-raw (re-compress/publish the last bake)  --qc-only  --layer-attach yaw|full|world

Per fighter:
  1. resolve the clip plan: tools/clipplan/_shared.json (lane ASSETS) + tools/clipplan/<id>.json
     (lane FIGHTERS; same id overrides the shared entry for this fighter). Keys starting '_' skipped.
     Fighter entries default to contact 'auto'; shared entries to what _shared.json says.
  2. validate every source (Mixamo FBX exists, CMU take exists, authored spec exists)
  3. blender.exe --background --python art/blender/bake_fighter.py -- job.json (blender.exe directly,
     log kept in art/renders/<id>/_build/bake.log; TECH_REUSE E51)
  4. tools/compress_glb.py chain C -> art/gltf/fighters/<id>.glb (+ an un-meshopt'd qc.glb copy)
  5. structural check of the shipped GLB (tools/glb_post.mjs facts): clip names == clips.json ids,
     rotation + Hips translation only, texture <= 1024, size <= budget
  6. data/clips/<id>.clips.json (generated; never hand-edited)
  7. QC: art/blender/qc_render.py + tools/qc_sheet.py -> art/renders/<id>/qc/sheet_NN.png, turntable.png
     (re-run alone: python tools/qc_render.py --fighter <id>, same as --qc-only)
Writes art/renders/<id>/build_report.json. Exit 1 if any fighter failed a hard check.
Never runs `claude -p`, never calls paid APIs. ASCII only.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time

TOOLS = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(TOOLS)
BLENDER = "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe"
CMU_DATA = "F:/games/forgeflow-games-assets/_downloaded/cmu-mocap/cmu-mocap-master/data"
ENV = dict(os.environ, PYTHONIOENCODING="utf-8")
FPS = 30


def P(*a):
    return os.path.join(GAME, *a).replace("\\", "/")


def load_json(p):
    with open(p, encoding="utf-8") as fh:
        return json.load(fh)


def resolve_plan(fid, shared_only=False):
    shared = load_json(P("tools", "clipplan", "_shared.json"))
    plan, origin = {}, {}
    for k, v in shared.items():
        if k.startswith("_"):
            continue
        plan[k] = dict(v)
        origin[k] = "shared"
    fp = P("tools", "clipplan", fid + ".json")
    if not shared_only and os.path.exists(fp):
        fplan = load_json(fp)
        for k, v in fplan.items():
            if k.startswith("_"):
                continue
            e = dict(v)
            e.setdefault("contact", "auto")
            plan[k] = e
            origin[k] = "fighter" if origin.get(k) != "shared" else "fighter-override"
    return plan, origin


def author_names():
    txt = open(P("art", "blender", "author_clips.py"), encoding="utf-8").read()
    return set(re.findall(r'^    "([a-z0-9_]+)": \{', txt, re.M))


def validate(cid, e, mixroot, authored):
    """Return a list of problems (empty = ok)."""
    errs = []
    src = e.get("src", "mixamo")

    def chk(x, where):
        if isinstance(x, str):
            x = {"src": "mixamo", "file": x}
        s = x.get("src", "mixamo")
        f = x.get("file", "")
        if s == "mixamo":
            if not os.path.exists(os.path.join(mixroot, f + ".fbx")):
                errs.append("%s: missing Mixamo clip %s.fbx" % (where, f))
        elif s == "cmu":
            m = re.match(r"^(\d+)_\d+$", f)
            if not m or not os.path.exists("%s/%03d/%s.bvh" % (CMU_DATA, int(m.group(1)), f)):
                errs.append("%s: missing CMU take %s" % (where, f))
            if not x.get("range"):
                errs.append("%s: cmu needs range" % where)
        elif s == "author":
            if f not in authored:
                errs.append("%s: no authored spec '%s' in art/blender/author_clips.py" % (where, f))
        else:
            errs.append("%s: unknown src %s" % (where, s))

    if src == "layer":
        lay = e.get("layer") or {}
        if "lower" not in lay or "upper" not in lay:
            errs.append("layer needs lower + upper")
        else:
            chk(lay["lower"], "layer.lower")
            chk(lay["upper"], "layer.upper")
    elif src == "seq":
        segs = e.get("seq") or []
        if not segs:
            errs.append("seq needs a non-empty 'seq' list")
        for i, s in enumerate(segs):
            if isinstance(s, dict) and s.get("src") in ("seq",):
                errs.append("seq[%d]: nested seq is not supported" % i)
                continue
            errs += ["seq[%d] %s" % (i, x) for x in validate(cid, s if isinstance(s, dict) else
                                                             {"src": "mixamo", "file": s}, mixroot, authored)]
    else:
        chk(e, "src")
    return errs


def run_blender(exe, script, args, log_path, timeout):
    cmd = [exe, "--background", "--python", script, "--"] + args
    t = time.time()
    with open(log_path, "w", encoding="utf-8", errors="replace") as lf:
        p = subprocess.run(cmd, stdout=lf, stderr=subprocess.STDOUT, env=ENV, timeout=timeout)
    return p.returncode, round(time.time() - t, 1)


def tail(path, n=25, pat=None):
    try:
        lines = open(path, encoding="utf-8", errors="replace").read().splitlines()
    except OSError:
        return []
    if pat:
        lines = [l for l in lines if re.search(pat, l)]
    return lines[-n:]


def glb_facts(path):
    p = subprocess.run(["node", P("tools", "glb_post.mjs"), "facts", path], capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=ENV)
    if p.returncode != 0:
        raise RuntimeError("glb facts failed: " + p.stderr[-2000:])
    return json.loads(p.stdout.strip().splitlines()[-1])


def structural_check(facts, clips, budget_mb, joints_expected):
    probs = []
    names = [a["name"] for a in facts["animations"]]
    if sorted(names) != sorted(clips):
        probs.append("GLB animations %s != clips.json %s" % (sorted(set(names) ^ set(clips)), ""))
    for a in facts["animations"]:
        if a["paths"].get("scale"):
            probs.append("%s has scale tracks" % a["name"])
        tn = a.get("translationNodes", [])
        if len(tn) != 1 or not tn[0].endswith("Hips"):
            probs.append("%s translation tracks %s" % (a["name"], tn))
        if a["paths"].get("rotation", 0) != joints_expected:
            probs.append("%s rotation tracks %d != joints %d" % (a["name"], a["paths"].get("rotation", 0), joints_expected))
    for t in facts["textures"]:
        if max(t["size"] or [0]) > 1024:
            probs.append("texture %s is %s" % (t["name"], t["size"]))
    if facts["bytes"] > budget_mb * 1e6:
        probs.append("GLB %d bytes > budget %.1f MB" % (facts["bytes"], budget_mb))
    return probs


CLIPS_META = {
    "units": "seconds, metres, fighter-local axes: x = forward (the model faces +Z in glTF), y = up",
    "fps": "clips are baked at 30 fps; dur = (frames - 1) / 30",
    "contact": "seconds from clip start of the strike frame (front-pass rule: fastest end effector's extension peak, then the frame in [c-8, c+3] where it is farthest forward), or the clip plan's explicit frame; null = not a strike",
    "effector": "{bone, at: [x_fwd, y_up]} the striking point at contact (knuckles = <Side>HandMiddle1 head, ball of foot = <Side>ToeBase head, knee = <Side>Leg head, head = HeadTop_End), fighter-local metres with the root at the sim position",
    "root": "[[t, dx_fwd_m], ...] one row per baked frame: the hips' forward travel since frame 0 that was STRIPPED from the clip (the GLB keeps the hips above the root); the sim's `move` curve can be derived from it",
    "apexY": "for clips baked with air='strip' (jumps): the lift that was removed so the feet stay at the root (the clip's own jump height); null otherwise",
    "loop": "true = plays cyclically (loopBlend eased the last frames into frame 0)",
    "marks": "optional named sync times in seconds (throw victims: grab / slam; wall_splat: splat; multi-hit strikes: hit1..hitN)",
    "marksAt": "optional, per strike mark (names starting 'hit'): {bone, at: [x_fwd, y_up]} the striking point at that mark, measured exactly like effector.at (bone = the clip effector unless another limb is > 1.6x faster around the mark)",
    "body": "heightM = rest height top of hair to sole; hipsM = rest Hips head height; handReachM = lateral distance hips -> middle fingertip in the T-pose bind; footReachM = hip joint -> toe tip (leg length)",
}


def run_qc(fid, a, build, rep):
    """art/blender/qc_render.py on the --qc copy of the shipping GLB + tools/qc_sheet.py."""
    qdir = P("art", "renders", fid, "qc")
    if os.path.isdir(qdir):
        shutil.rmtree(qdir, ignore_errors=True)
    os.makedirs(qdir, exist_ok=True)
    cjq = build + "/clips_qc.json"
    rc2, s2 = run_blender(a.blender, P("art", "blender", "qc_render.py"), [build + "/qc.glb", cjq, qdir],
                          build + "/qc.log", 3600)
    rep["qc_rc"], rep["qc_secs"] = rc2, s2
    print("[build] %s qc rc=%d %.0fs" % (fid, rc2, s2), flush=True)
    if os.path.exists(qdir + "/qc.json"):
        q = load_json(qdir + "/qc.json")
        summ = {}
        for cid, m in q["clips"].items():
            if "error" in m:
                summ[cid] = m
                continue
            summ[cid] = {"low": [m["lowest_min"], m["lowest_max"]], "tpose": len(m["tpose_frames"]),
                         "sink3cm": m["sink_frames_lt_-0.03"], "float3cm": m["float_frames_gt_0.03"],
                         "max_step_deg": m.get("max_step_deg"), "step_bone": m.get("step_bone"),
                         "step_frame": m.get("step_frame")}
        rep["qc"] = summ
        rep["qc_turntable"] = q.get("turntable", q.get("turntable_error"))
        sp = subprocess.run([sys.executable, P("tools", "qc_sheet.py"), qdir, fid], capture_output=True,
                            text=True, encoding="utf-8", errors="replace", env=ENV)
        rep["qc_sheets"] = json.loads(sp.stdout.strip().splitlines()[-1]).get("sheets") if sp.returncode == 0 else sp.stderr[-500:]
    else:
        rep["problems"].append("qc produced no qc.json: " + " | ".join(tail(build + "/qc.log", 6)))


def qc_only(fid, a):
    """Re-run the QC of the last bake (art/renders/<id>/_build/qc.glb + clips_qc.json) and update
    build_report.json; nothing is baked or published."""
    build = P("art", "renders", fid, "_build")
    rp = P("art", "renders", fid, "build_report.json")
    rep = load_json(rp) if os.path.exists(rp) else {"fighter": fid, "problems": []}
    rep["problems"] = [x for x in rep.get("problems", []) if not (isinstance(x, str) and x.startswith("qc produced"))]
    run_qc(fid, a, build, rep)
    with open(rp, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(rep, fh, indent=1)
    return rep


def build_one(fid, a, bodies):
    t0 = time.time()
    rep = {"fighter": fid, "ok": False, "problems": []}
    bcfg = dict(bodies["bodies"][fid])
    fj = P("data", "fighters", fid + ".json")
    if os.path.exists(fj):
        try:
            h = load_json(fj).get("heightM")
            if h:
                bcfg["heightM"] = float(h)
                rep["heightM_from"] = "data/fighters/%s.json" % fid
        except Exception as ex:  # noqa
            rep["problems"].append("could not read %s: %r" % (fj, ex))
    bcfg["fbx"] = bodies["characters_root"] + "/" + bcfg["fbx"]
    plan, origin = resolve_plan(fid, a.shared_only)
    if a.clips:
        want = set(a.clips.split(","))
        plan = {k: v for k, v in plan.items() if k in want}
    authored = author_names()
    clips, skipped = [], {}
    for cid, e in plan.items():
        errs = validate(cid, e, bodies["mixamo_root"], authored)
        if errs:
            skipped[cid] = errs
            continue
        e = dict(e)
        e["id"] = cid
        clips.append(e)
    if skipped:
        rep["problems"].append({"invalid_clip_entries": skipped})
    rep["clips_planned"] = len(plan)
    rep["origin"] = origin
    build = P("art", "renders", fid, "_build")
    os.makedirs(build, exist_ok=True)
    job = {"fighter": fid, "body": bcfg, "work_dir": build, "raw_glb": build + "/raw.glb",
           "bake_json": build + "/bake.json", "mixamo_root": bodies["mixamo_root"],
           "xbot_fbx": bodies["xbot_fbx"], "tools_dir": TOOLS.replace("\\", "/"), "atlas": 1024,
           "clips": clips, "layer_attach": a.layer_attach}
    if a.keep_blend:
        job["save_blend"] = build + "/baked.blend"
    jp = build + "/job.json"
    if a.from_raw:
        # re-compress / re-check / re-publish the LAST bake (raw.glb + bake.json) without Blender
        rc, secs = (0, 0.0) if os.path.exists(build + "/raw.glb") and os.path.exists(build + "/bake.json") else (1, 0.0)
        rep["from_raw"] = True
    else:
        json.dump(job, open(jp, "w"), indent=1)
        for stale in ("raw.glb", "bake.json"):
            if os.path.exists(os.path.join(build, stale)):
                os.remove(os.path.join(build, stale))
        rc, secs = run_blender(a.blender, P("art", "blender", "bake_fighter.py"), [jp], build + "/bake.log", 3600)
    rep["bake_rc"], rep["bake_secs"] = rc, secs
    print("[build] %s bake rc=%d %.0fs%s" % (fid, rc, secs, " (from raw)" if a.from_raw else ""), flush=True)
    for l in tail(build + "/bake.log", 12, r"\[hp\] (IDENTITY|FK GATE|CLIP FAILED|BAKE DONE|height)|Error|Traceback"):
        print("   ", l)
    if rc != 0 or not os.path.exists(build + "/bake.json") or not os.path.exists(build + "/raw.glb"):
        rep["problems"].append("bake failed: " + " | ".join(tail(build + "/bake.log", 8)))
        return rep
    bake = load_json(build + "/bake.json")
    rep["gates"] = bake.get("gates", {})
    rep["body"] = bake.get("body")
    if bake.get("errors"):
        rep["problems"].append({"clip_errors": [(e["clip"], e["error"]) for e in bake["errors"]]})
    if not bake["gates"].get("identity", {}).get("ok", False):
        rep["problems"].append("identity gate failed: %s" % bake["gates"].get("identity"))
    # ---- compress
    sys.path.insert(0, TOOLS)
    import compress_glb
    out = P("art", "gltf", "fighters", fid + ".glb")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    tmp_out = build + "/final.glb"
    comp = compress_glb.compress(build + "/raw.glb", tmp_out, 1024, 85, build + "/qc.glb", True)
    rep["compress"] = comp["sizes"]
    # ---- clips.json
    clips_json = {"fighter": fid, "generated_by": "tools/build_fighters.py (lane ASSETS) - do not hand-edit",
                  "fps": FPS, "body": {k: bake["body_facts"][k] for k in ("heightM", "hipsM", "handReachM", "footReachM")},
                  "clips": {cid: bake["clips"][cid]["clip"] for cid in sorted(bake["clips"])},
                  "_meta": CLIPS_META}
    # ---- structural check of the shipping GLB
    facts = glb_facts(tmp_out)
    rep["glb_facts"] = {"bytes": facts["bytes"], "extensions": facts["extensionsUsed"], "skins": facts["skins"],
                        "textures": facts["textures"], "materials": facts["materials"],
                        "animations": len(facts["animations"])}
    joints = facts["skins"][0]["joints"] if facts["skins"] else 0
    probs = structural_check(facts, list(clips_json["clips"]), a.budget_mb, joints)
    if probs:
        rep["problems"].append({"structural": probs})
    hard = [p for p in probs if "budget" in p or "!=" in p]
    if not hard and not bake.get("errors") and not a.no_publish:
        shutil.copyfile(tmp_out, out)
        cj = P("data", "clips", fid + ".clips.json")
        os.makedirs(os.path.dirname(cj), exist_ok=True)
        with open(cj, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(clips_json, fh, indent=1)
        rep["published"] = {"glb": out, "bytes": os.path.getsize(out), "clips_json": cj}
    else:
        rep["problems"].append("NOT published (--no-publish)" if a.no_publish else
                               "NOT published (hard structural problems or clip errors)")
        with open(build + "/clips.json", "w", encoding="utf-8", newline="\n") as fh:
            json.dump(clips_json, fh, indent=1)
    # ---- QC
    if not a.no_qc:
        cjq = build + "/clips_qc.json"
        json.dump(clips_json, open(cjq, "w"), indent=1)
        run_qc(fid, a, build, rep)
    rep["secs"] = round(time.time() - t0, 1)
    rep["ok"] = "published" in rep
    with open(P("art", "renders", fid, "build_report.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(rep, fh, indent=1)
    return rep


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fighter")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--skip", default="", help="comma list of fighters to leave out (with --all)")
    ap.add_argument("--shared-only", action="store_true")
    ap.add_argument("--clips", default="")
    ap.add_argument("--no-qc", action="store_true")
    ap.add_argument("--keep-blend", action="store_true")
    ap.add_argument("--budget-mb", type=float, default=3.0)
    ap.add_argument("--blender", default=BLENDER)
    ap.add_argument("--check", action="store_true", help="resolve + validate the clip plan only")
    ap.add_argument("--layer-attach", default="yaw", choices=("yaw", "full", "world"),
                    help="default LAYER re-attach (hp_retarget.LayerSampler); a layer entry's own 'attach' wins")
    ap.add_argument("--qc-only", action="store_true", help="re-run QC renders/sheets of the last bake only")
    ap.add_argument("--from-raw", action="store_true",
                    help="skip the Blender bake: compress + check + publish + QC the last raw.glb / bake.json")
    ap.add_argument("--no-publish", action="store_true",
                    help="bake + QC into art/renders/<id>/ only; never touch art/gltf or data/clips (subset tests)")
    a = ap.parse_args()
    bodies = load_json(P("tools", "bodies.json"))
    if a.all:
        ids = sorted(bodies["bodies"])
    elif a.fighter and "," in a.fighter:
        ids = [x for x in a.fighter.split(",") if x]
    else:
        ids = [a.fighter]
    skip = set(x for x in a.skip.split(",") if x)
    ids = [i for i in ids if i not in skip]
    if not ids or ids == [None]:
        ap.error("--fighter <id>[,<id>...] or --all [--skip a,b]")
    bad = 0
    for fid in ids:
        if fid not in bodies["bodies"]:
            print("[build] unknown fighter", fid)
            bad += 1
            continue
        if a.check:
            plan, origin = resolve_plan(fid, a.shared_only)
            authored = author_names()
            bad_e = {c: validate(c, e, bodies["mixamo_root"], authored) for c, e in plan.items()}
            bad_e = {c: v for c, v in bad_e.items() if v}
            print("[check]", fid, "clips", len(plan), "shared", sum(1 for v in origin.values() if v == "shared"),
                  "fighter", sum(1 for v in origin.values() if v != "shared"), "invalid", json.dumps(bad_e))
            bad += 1 if bad_e else 0
            continue
        if a.qc_only:
            rep = qc_only(fid, a)
            print("[build] QC-ONLY", fid, json.dumps({k: rep.get(k) for k in ("qc_rc", "qc_secs")}))
            continue
        rep = build_one(fid, a, bodies)
        brief = {k: rep.get(k) for k in ("fighter", "ok", "secs", "compress", "problems")}
        brief["published"] = rep.get("published")
        print("[build] RESULT", json.dumps(brief))
        if not rep["ok"]:
            bad += 1
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
