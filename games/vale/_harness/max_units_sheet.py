#!/usr/bin/env python3
"""VALE harness — MAX units lane: an A/B sheet from max_units_ab.mjs crops.
    python3 _harness/max_units_sheet.py <tag> <variantA>,<variantB>[,...] out.png [--scale 2] [--frame]
One row per entity: each variant side by side at an integer upscale (nearest), labelled; a mean |diff| per crop is
printed (and written beside the sheet as JSON)."""
import glob, json, os, sys
import numpy as np
from PIL import Image, ImageDraw
tag, vs, out = sys.argv[1], sys.argv[2].split(","), sys.argv[3]
sc = int(sys.argv[sys.argv.index("--scale") + 1]) if "--scale" in sys.argv else 2
d = f"_harness/_shots/maxunits/{tag}"
names = sorted({os.path.basename(p)[len(vs[0]) + 1:-4] for p in glob.glob(f"{d}/{vs[0]}_*.png")} - {"frame"})
rows, stats = [], {}
for n in names:
    ims = [Image.open(f"{d}/{v}_{n}.png").convert("RGB") for v in vs if os.path.exists(f"{d}/{v}_{n}.png")]
    if len(ims) != len(vs):
        continue
    a = [np.asarray(i).astype(float) for i in ims]
    stats[n] = {f"{vs[0]}->{v}": round(float(np.abs(a[k] - a[0]).mean()), 2) for k, v in enumerate(vs) if k}
    w, h = ims[0].size
    row = Image.new("RGB", (w * sc * len(ims) + 4 * len(ims), h * sc + 16), (20, 20, 24))
    dr = ImageDraw.Draw(row)
    for k, im in enumerate(ims):
        row.paste(im.resize((w * sc, h * sc), Image.NEAREST), (k * (w * sc + 4), 16))
        dr.text((k * (w * sc + 4) + 4, 2), f"{n}  {vs[k]}", fill=(230, 230, 230))
    rows.append(row)
W = max(r.size[0] for r in rows)
sheet = Image.new("RGB", (W, sum(r.size[1] for r in rows)), (20, 20, 24))
y = 0
for r in rows:
    sheet.paste(r, (0, y)); y += r.size[1]
os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
sheet.save(out)
json.dump(stats, open(out[:-4] + ".json", "w"), indent=1)
print(out, sheet.size, json.dumps(stats))
