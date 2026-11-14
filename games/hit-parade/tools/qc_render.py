"""HIT PARADE - QC renders of baked fighter GLBs (lane ASSETS, CONTRACT section 6).

  python tools/qc_render.py --fighter johnny          # one fighter (or a,b,c)
  python tools/qc_render.py --all                     # every fighter in tools/bodies.json

Thin entry point over the same QC step tools/build_fighters.py runs after every bake:
  art/blender/qc_render.py (blender.exe --background, log in art/renders/<id>/_build/qc.log) renders, on
  the REAL skinned body of the last bake (art/renders/<id>/_build/qc.glb = the shipping GLB before
  meshopt, imported at 30 fps):
    - every clip's contact frame (game camera) + a 4-frame strip per clip,
    - per-frame lowest / highest vertex (floor check), T-pose frame detection, fist curl,
    - flip metric: largest single-frame local bone rotation (clips above 60 deg are listed as leads),
    - a textured EEVEE turntable (8 angles) + 2 head close-ups (hair / lash cutout check);
  tools/qc_sheet.py then builds art/renders/<id>/qc/sheet_NN.png (contact sheets) + moves_NN.png.
Updates art/renders/<id>/build_report.json ("qc", "qc_sheets", "qc_turntable"). Never bakes, never
publishes, never runs `claude -p`. ASCII only.
"""
import argparse
import json
import os
import sys

TOOLS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TOOLS)

import build_fighters as BF  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fighter")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--blender", default=BF.BLENDER)
    a = ap.parse_args()
    bodies = BF.load_json(BF.P("tools", "bodies.json"))
    if a.all:
        ids = sorted(bodies["bodies"])
    elif a.fighter:
        ids = [x for x in a.fighter.split(",") if x]
    else:
        ap.error("--fighter <id>[,<id>...] or --all")
    bad = 0
    for fid in ids:
        build = BF.P("art", "renders", fid, "_build")
        if not (os.path.exists(build + "/qc.glb") and os.path.exists(build + "/clips_qc.json")):
            print("[qc] %s: no bake to check (run tools/build_fighters.py --fighter %s first)" % (fid, fid))
            bad += 1
            continue
        rep = BF.qc_only(fid, a)
        qc = rep.get("qc") or {}
        tpose = sum(v.get("tpose", 0) for v in qc.values() if isinstance(v, dict))
        sink = sum(v.get("sink3cm", 0) for v in qc.values() if isinstance(v, dict))
        errs = [k for k, v in qc.items() if isinstance(v, dict) and "error" in v]
        steps = {k: "%.0f %s f%s" % (v["max_step_deg"], v.get("step_bone"), v.get("step_frame"))
                 for k, v in sorted(qc.items(), key=lambda kv: -(kv[1].get("max_step_deg") or 0) if isinstance(kv[1], dict) else 0)
                 if isinstance(v, dict) and (v.get("max_step_deg") or 0) > 60.0}
        print("[qc]", fid, json.dumps({"rc": rep.get("qc_rc"), "secs": rep.get("qc_secs"), "clips": len(qc),
                                       "tpose_frames": tpose, "sink3cm_frames": sink, "errors": errs,
                                       "steps_gt60": steps, "turntable": rep.get("qc_turntable"),
                                       "sheets": len(rep.get("qc_sheets") or [])}))
        if rep.get("qc_rc") != 0 or tpose or sink or errs:
            bad += 1
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
