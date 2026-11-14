# Build a contact sheet from env_render_models.py _results.json
# Usage: python env_sheet_from_results.py <results.json> <title> <out.png> [cols] [cell] [id_filter_substrings_comma]
# ASCII only.
import json, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from env_sheet import build

res = json.load(open(sys.argv[1], encoding="utf-8"))
title, out = sys.argv[2], sys.argv[3]
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 8
cell = int(sys.argv[5]) if len(sys.argv) > 5 else 260
flt = sys.argv[6].split(",") if len(sys.argv) > 6 and sys.argv[6] else None
items = []
for k, v in res.items():
    if flt and not any(f in k for f in flt):
        continue
    tex = v.get("textures", [])
    mx = 0
    for t in tex:
        try:
            mx = max(mx, int(t.split()[-1].split("x")[0]))
        except Exception:
            pass
    dims = "x".join(str(round(d, 1)) for d in v.get("dims_m", []))
    items.append({"img": v.get("png", ""), "label": k,
                  "sub": "%d tris | tex %s | %sm" % (v.get("tris", 0), mx if mx else "none", dims)})
build({"title": title, "out": out, "cols": cols, "cell": cell, "items": items})
