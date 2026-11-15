"""Whole-take overview: split a take into ~1 s chunks, one sheet row per chunk
(4 poses, side view following the hips). For takes with no strike events
(stagger / flex / pull) so they can be segmented by eye.
Usage: python overview_sheets.py <out_dir> <chunk_s> take[:start:end] ..."""
import os
import sys

import cmu_segment as CS
import cmu_sheets as SH

od = sys.argv[1]
chunk = float(sys.argv[2])
rows = []
for arg in sys.argv[3:]:
    parts = arg.split(":")
    take = parts[0]
    T = CS.Take(take)
    s0 = int(parts[1]) if len(parts) > 1 else 1
    s1 = int(parts[2]) if len(parts) > 2 else T.n - 1
    step = int(chunk * T.fps)
    for a in range(s0, s1, step):
        b = min(s1, a + step)
        if b - a < 10:
            continue
        rows.append({"take": take, "start": a, "contact": (a + b) // 2, "end": b, "kind": "overview",
                     "class": "overview", "fps": T.fps, "limb": "body", "foot_drift_cm": T.foot_slide(a, b),
                     "pops": T.pops(a, b), "id": "%s@%d" % (take, a)})
os.makedirs(od, exist_ok=True)
for k in range(0, len(rows), 6):
    p = os.path.join(od, "overview_%02d.png" % (k // 6))
    SH.render_sheet(rows[k:k + 6], p, "overview %d" % (k // 6))
    print(p, [r["id"] for r in rows[k:k + 6]])
