"""Merge auto segments with the visual-review verdicts into cmu_segments.json.
Usage: python merge_segments.py <anim_dir>"""
import json
import os
import sys

import cmu_segment as CS

ad = sys.argv[1]
auto = json.load(open(os.path.join(ad, "cmu_segments_auto.json")))
rev = json.load(open(os.path.join(ad, "review_verdicts.json")))
for s in auto:
    s["class_auto"] = s.pop("class")
    s["class"] = s["class_auto"]
    s["quality"] = "unreviewed"
    s["review_notes"] = ""
unmatched = []
for take, limb, c, cls, q, note in rev["rows"]:
    tol = 80 if limb == "body" else 15
    cands = [s for s in auto if s["take"] == take and s.get("limb") == limb and abs(s["contact"] - c) <= tol]
    if not cands:
        unmatched.append((take, limb, c, cls))
        continue
    s = min(cands, key=lambda x: abs(x["contact"] - c))
    s["class"] = cls
    s["quality"] = q
    s["review_notes"] = note
out = list(auto)
for take, limb, a, c, b, cls, q, note in rev["manual"]:
    T = CS.Take(take)
    out.append({"take": take, "fps": round(T.fps, 3), "start": a, "contact": c, "end": b,
                "kind": "manual", "limb": limb, "class_auto": None, "class": cls, "quality": q,
                "review_notes": note, "notes": [], "foot_drift_cm": T.foot_slide(a, b), "pops": T.pops(a, b)})
qorder = {"clean": 0, "usable": 1, "unreviewed": 2, "junk": 3}
out.sort(key=lambda s: (s["class"], qorder[s["quality"]], s["take"], s["contact"]))
meta = {"_doc": "CMU mocap fighting-move segments for HIT PARADE. Frames are SOURCE frames at the take's fps "
                "(all 120). Frame 0 of every file is a T-pose calibration frame and is never used. "
                "start = windup start (hands: nearest guard / extension minimum; legs: last planted frame), "
                "contact = max reach (punch/kick) or the lying->standing transition (getup) / impact (fall), "
                "end = recovery (guard or foot planted again). class = final class after visual review "
                "(class_auto = geometric classifier). quality: clean | usable | junk | unreviewed (not viewed). "
                "Metrics: foot_drift_cm = max planted-foot horizontal path length in the window; pops = frames with "
                "a main joint > 3 cm off its 5-frame median; other_hand_peak_ms = combo contamination.",
        "duplicates": CS.DUPLICATES,
        "source": "F:/games/forgeflow-games-assets/_downloaded/cmu-mocap/cmu-mocap-master/data",
        "generator": "tools/research/cmu_segment.py + review_verdicts.json via tools/research/merge_segments.py"}
json.dump({"meta": meta, "segments": out}, open(os.path.join(ad, "cmu_segments.json"), "w"), indent=1)
from collections import Counter
print("segments", len(out), "reviewed", sum(1 for s in out if s["quality"] != "unreviewed"))
print("unmatched verdict rows", len(unmatched))
for u in unmatched:
    print("  ", u)
good = Counter((s["class"], s["quality"]) for s in out if s["quality"] in ("clean", "usable"))
for k in sorted(good):
    print(k, good[k])
