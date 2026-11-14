"""Render the best-candidate contact sheets from cmu_segments.json.
Usage: python best_sheets.py <anim_dir>"""
import json
import os
import sys

import cmu_sheets as SH

ad = sys.argv[1]
d = json.load(open(os.path.join(ad, "cmu_segments.json")))["segments"]
# curated best list: (class, take, limb, contact) - picked from the review verdicts
CURATED = [
    ("jab", "14_02", "R_hand", 4953), ("jab", "13_18", "R_hand", 1445), ("jab", "14_03", "R_hand", 489),
    ("jab", "14_02", "R_hand", 3534), ("jab", "17_10", "L_hand", 1609), ("jab", "13_17", "L_hand", 1211),
    ("cross", "13_17", "R_hand", 239), ("cross", "14_02", "R_hand", 2822), ("cross", "14_03", "R_hand", 1763),
    ("cross", "14_01", "R_hand", 2608),
    ("hook", "14_03", "R_hand", 4078), ("hook", "79_08", "R_hand", 314), ("hook", "14_01", "L_hand", 3509),
    ("hook", "14_01", "L_hand", 2917), ("hook", "14_02", "L_hand", 1989),
    ("uppercut", "14_02", "L_hand", 1759), ("uppercut", "17_10", "R_hand", 1573),
    ("uppercut", "14_01", "L_hand", 2136), ("uppercut", "13_18", "L_hand", 88),
    ("body_blow", "14_03", "R_hand", 3245), ("body_blow", "144_14", "L_hand", 891),
    ("body_blow", "144_20", "R_hand", 714), ("body_blow", "13_17", "L_hand", 4620),
    ("front_kick", "144_05", "R_foot", 360), ("front_kick", "135_04", "R_foot", 375),
    ("front_kick", "144_06", "R_foot", 920), ("front_kick", "86_06", "R_foot", 3509),
    ("front_kick", "113_13", "R_foot", 991), ("front_kick", "144_09", "L_foot", 902),
    ("roundhouse", "135_07", "R_foot", 118), ("roundhouse", "135_07", "L_foot", 442),
    ("roundhouse", "135_07", "R_foot", 772), ("roundhouse", "135_01", "R_foot", 3760),
    ("roundhouse", "144_05", "R_foot", 1441),
    ("side_kick", "135_11", "R_foot", 608), ("side_kick", "135_11", "L_foot", 1307),
    ("side_kick", "143_24", "L_foot", 297),
    ("knee", "86_06", "R_foot", 6272), ("knee", "86_06", "R_knee", 6527), ("knee", "86_06", "R_foot", 6770),
    ("knee", "135_02", "R_foot", 1431), ("knee", "135_02", "R_foot", 3121),
    ("jump_kick", "90_05", "L_foot", 282), ("jump_kick", "90_06", "L_foot", 435), ("jump_kick", "90_07", "L_foot", 699),
    ("spin_kick", "88_06", "R_foot", 68), ("spin_kick", "87_01", "L_foot", 256),
    ("getup_back", "140_08", "body", 534), ("getup_back", "140_09", "body", 452),
    ("getup_back", "139_18", "body", 361), ("getup_back", "140_03", "body", 628),
    ("getup_front", "139_16", "body", 234), ("getup_front", "140_01", "body", 275),
    ("getup_front", "140_02", "body", 320), ("getup_front", "139_17", "body", 263),
    ("fall_forward", "90_16", "body", 447), ("fall_backward", "90_18", "body", 116),
    ("fall_backward", "90_17", "body", 427),
    ("stagger_forward", "104_13", "body", 150), ("stagger_light", "91_59", "body", 81),
    ("flex_taunt", "79_94", "body", 321), ("grab_pull", "18_05", "body", 301),
    ("punt_kick", "74_04", "R_foot", 169), ("punt_kick", "74_06", "R_foot", 177),
    ("stomp", "135_01", "R_foot", 3019), ("lunge_punch", "135_09", "R_hand", 305),
    ("lunge_punch", "135_06", "R_hand", 2053), ("hammer_chop", "86_06", "R_hand", 4894),
    ("duck_counter", "17_10", "L_hand", 2176),
]
best = []
count = {}
for cls, take, limb, c in CURATED:
    tol = 80 if limb == "body" else 15
    xs = [s for s in d if s["take"] == take and s.get("limb") == limb and abs(s["contact"] - c) <= tol
          and s["class"] == cls]
    if not xs:
        print("MISSING", cls, take, limb, c)
        continue
    s = dict(min(xs, key=lambda x: abs(x["contact"] - c)))
    count[cls] = count.get(cls, 0) + 1
    s["id"] = "%s.%d" % (cls, count[cls])
    best.append(s)
od = os.path.join(ad, "sheets")
os.makedirs(od, exist_ok=True)
for f in os.listdir(od):
    if f.startswith("best_"):
        os.remove(os.path.join(od, f))
for k in range(0, len(best), 6):
    chunk = best[k:k + 6]
    p = os.path.join(od, "best_%02d.png" % (k // 6))
    SH.render_sheet(chunk, p, "HIT PARADE CMU best candidates, sheet %d" % (k // 6))
    print(p, [(s["id"], s["take"], s["contact"]) for s in chunk])
json.dump(best, open(os.path.join(ad, "best_candidates.json"), "w"), indent=1)
