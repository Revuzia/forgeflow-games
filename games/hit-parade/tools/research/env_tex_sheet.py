# Texture-set contact sheet: albedo tiled 2x2 (exposes seams) + normal/rough insets, measured sizes.
# Usage: python env_tex_sheet.py <texlist.json> <title> <out.png> [cols] [cell]
# texlist = [{"label": str, "albedo": path, "normal": path?, "rough": path?, "lic": str, "tile": bool (default True)}]
# Also writes <out>.json with measured sizes. ASCII only.
import json, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image
from env_sheet import build

lst = json.load(open(sys.argv[1], encoding="utf-8"))
title, out = sys.argv[2], sys.argv[3]
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 6
cell = int(sys.argv[5]) if len(sys.argv) > 5 else 280
items, meas = [], []
for t in lst:
    rec = dict(t)
    for k in ("albedo", "normal", "rough"):
        p = t.get(k)
        if p:
            try:
                rec[k + "_size"] = list(Image.open(p).size)
            except Exception as e:
                rec[k + "_size"] = "ERR " + str(e)[:60]
    meas.append(rec)
    sz = rec.get("albedo_size")
    szs = "%dx%d" % tuple(sz) if isinstance(sz, list) else str(sz)
    maps = "+".join(k[0].upper() for k in ("albedo", "normal", "rough") if t.get(k))
    items.append({"img": t["albedo"], "label": t["label"], "tile2x2": t.get("tile", True),
                  "extra": [t[k] for k in ("normal", "rough") if t.get(k)],
                  "sub": "%s %s | %s" % (szs, maps, t.get("lic", ""))})
build({"title": title, "out": out, "cols": cols, "cell": cell, "items": items})
json.dump(meas, open(os.path.splitext(out)[0] + ".json", "w", encoding="utf-8"), indent=1)
