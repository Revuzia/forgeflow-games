#!/usr/bin/env python
"""Contact sheets from the feelshots strips, cropped on the HERO.

A 1.5 m hero at the follow distance is ~80 px of a 1200x675 frame; a whole-frame
strip cannot resolve a flip, a superman stretch or a skid. This crops each of the
8 frames on the hero's projected chest (the `scr` field the driver records) and
tiles them into one sheet per move, with the frame index and state burned in."""
import json, math, os, sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SHOTS = os.path.join(ROOT, "_shots", "feel_r2")
OUT = os.path.join(ROOT, "_shots", "feel_r2_sheets")
os.makedirs(OUT, exist_ok=True)

data = json.load(open(os.path.join(HERE, "feelshots_r2shots.json"), encoding="utf-8"))
CROP = 300          # source pixels around the hero
CELL = 300          # output cell size

for name, mv in data["moves"].items():
    files = sorted(
        [f for f in os.listdir(SHOTS) if f.startswith(name + "_") and f.endswith(".png")],
        key=lambda f: int(f.rsplit("_", 1)[1].split(".")[0]))
    if not files:
        continue
    total = mv["frames"]
    # feelshots shoots at round(total * k / 8) for k in 0..7
    idx = [int(round(total * k / 8.0)) for k in range(8)]
    samples = {s["i"]: s for s in mv["samples"]}
    n = len(files)
    sheet = Image.new("RGB", (CELL * n, CELL + 22), (16, 16, 18))
    dr = ImageDraw.Draw(sheet)
    for j, f in enumerate(files):
        im = Image.open(os.path.join(SHOTS, f)).convert("RGB")
        fr = idx[j] if j < len(idx) else 0
        s = samples.get(fr) or samples.get(max(0, fr - 1)) or {}
        scr = s.get("scr")
        if scr:
            cx, cy = scr
        else:
            cx, cy = im.size[0] // 2, im.size[1] // 2
        x0 = max(0, min(im.size[0] - CROP, cx - CROP // 2))
        y0 = max(0, min(im.size[1] - CROP, cy - CROP // 2))
        cell = im.crop((x0, y0, x0 + CROP, y0 + CROP)).resize((CELL, CELL))
        sheet.paste(cell, (j * CELL, 22))
        lbl = "f%-4d %-10s y%.2f sp%.1f" % (fr, s.get("st", "?"), s.get("y", 0), s.get("sp", 0))
        dr.text((j * CELL + 4, 5), lbl, fill=(230, 230, 120))
        dr.rectangle([j * CELL, 22, j * CELL + CELL - 1, CELL + 21], outline=(60, 60, 66))
    p = os.path.join(OUT, "%s.png" % name)
    sheet.save(p)
    print("wrote %s  (%d cells)" % (p, n))
