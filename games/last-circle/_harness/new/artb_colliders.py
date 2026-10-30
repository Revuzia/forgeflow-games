"""The manifest collider rule shared by artb_check.py and artb_decode.py (Wave 8, lane K3).

Every type's colliders are non-empty, min < max on every axis and inside the bbox (+0.3 m) - EXCEPT a type the kit tool marks collider_mode "none"
(art_b_city.py: "nothing drawn above 0.30 m" - the interior kit's rugs and the pallet), which carries NO collider on purpose (a rug is walked over,
citykit.js places no box for it; probe_citykit.js's agreement row already exempts the same mode). Such a type must really have an empty collider list:
a "none" type WITH colliders is judged like any other, and a type of any other mode with no colliders still fails (control: --plant drop-colliders
empties one boxed type in memory and the row must FAIL).
"""
from __future__ import annotations


def judge(types, plant=None):
    """-> (bad list, exempt list, boxes, note). plant 'drop-colliders' empties the first boxed type's colliders in memory (never the file)."""
    note = None
    if plant == "drop-colliders":
        for k, t in types.items():
            if t.get("collider_mode") != "none" and t.get("colliders"):
                t = dict(t, colliders=[])
                types = dict(types, **{k: t})
                note = "PLANT drop-colliders: %s's %s colliders emptied in memory" % (k, t.get("collider_mode"))
                break
    bad, exempt, boxes = [], [], 0
    for k, t in types.items():
        cs = t.get("colliders") or []
        boxes += len(cs)
        if not cs and t.get("collider_mode") == "none":
            exempt.append(k)
            continue
        lo, hi = t["bbox_min_m"], t["bbox_max_m"]
        ok = bool(cs) and all(all(c["max"][i] > c["min"][i] and c["min"][i] >= lo[i] - 0.3 and c["max"][i] <= hi[i] + 0.3 for i in range(3)) for c in cs)
        if not ok:
            bad.append(k)
    return bad, exempt, boxes, note
