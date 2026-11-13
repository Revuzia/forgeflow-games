"""Pick a review subset: per (take, class) the top-2 segments by a simple
cleanliness/snap score; all ground segments. Writes review_<group>.json."""
import json
import os
import sys
from collections import defaultdict

src = sys.argv[1]
od = os.path.dirname(src)
segs = json.load(open(src))
for i, s in enumerate(segs):
    s["id"] = i


def score(s):
    sc = s.get("peak_speed_ms", 0.0) or 0.0
    sc -= 0.6 * s["pops"]
    sc -= 0.08 * max(0.0, s["foot_drift_cm"] - 8.0)
    return sc


groups = {
    "straight": ("jab", "cross", "straight_L", "straight_R"),
    "arc": ("hook", "uppercut", "body_blow", "elbow", "hammer_chop", "punch_other"),
    "kick": ("front_kick", "roundhouse", "side_kick", "jump_kick", "spin_kick", "knee", "knee_low", "kick_other"),
}
by = defaultdict(list)
for s in segs:
    by[(s["take"], s["class"])].append(s)
out = defaultdict(list)
for (take, cls), lst in by.items():
    lst.sort(key=lambda s: -score(s))
    g = [k for k, v in groups.items() if cls in v]
    if not g:
        out["ground"].extend(lst)
        continue
    n = 3 if g[0] in ("arc", "kick") else 2
    out[g[0]].extend(lst[:n])
for g, lst in out.items():
    lst.sort(key=lambda s: (s["class"], s["take"], s["start"]))
    json.dump(lst, open(os.path.join(od, "review_%s.json" % g), "w"), indent=1)
    print(g, len(lst))
json.dump(segs, open(src, "w"), indent=1)
