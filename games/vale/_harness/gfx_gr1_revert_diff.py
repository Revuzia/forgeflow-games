#!/usr/bin/env python3
"""VALE harness: pixel deltas between gfx_gr1_revert_check.mjs captures in _harness/_shots/gfx_GR1_revert, and the labelled
GR-1 sheet (the switch at 8 before, the reverted tree after: what the revert took away)."""
import glob, json, os
import numpy as np
from PIL import Image
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_shots", "gfx_GR1_revert")
def cmp(a, b):
    x, y = (np.array(Image.open(os.path.join(D, p)).convert("RGB"), int) for p in (a, b))
    d = np.abs(x - y).max(2)
    return {"pct>0": round(100 * float((d > 0).mean()), 4), "pct>4": round(100 * float((d > 4).mean()), 4), "max": int(d.max())}
out = {}
for f in sorted(glob.glob(os.path.join(D, "after_*.png"))):
    n = os.path.basename(f)[len("after_"):]
    out[n] = {"before_off vs after": cmp("before_" + n, "after_" + n), "before_on vs after": cmp("before_" + n[:-4] + "_on.png", "after_" + n)}
    if os.path.exists(os.path.join(D, "before2_" + n)):
        out[n]["control before_off vs before2_off"] = cmp("before_" + n, "before2_" + n)
print(json.dumps(out, indent=1))
json.dump(out, open(os.path.join(D, "diff.json"), "w"), indent=1)
