"""Compose rendered clip frames into labelled contact sheets (PIL).

Usage: python mixamo_montage.py <selection.json> <frames_dir> <out_dir> <clips_per_sheet> [<prefix>]
One row per clip: title strip + its frames (tile 240 px). Contact frames get a red border and
"CONTACT" label. Sheets are named <prefix>_<NN>.png in selection order (grouped by pack).
ASCII only.
"""
import json
import os
import sys
from PIL import Image, ImageDraw, ImageFont

SEL, FR, OUT, PER = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
PREFIX = sys.argv[5] if len(sys.argv) > 5 else "sheet"
TILE = 240
TITLE_H = 22
LAB_H = 18
os.makedirs(OUT, exist_ok=True)
sel = json.load(open(SEL))
try:
    font = ImageFont.truetype("arial.ttf", 15)
    fsm = ImageFont.truetype("arial.ttf", 13)
except Exception:
    font = fsm = ImageFont.load_default()

ids = sorted(sel.keys(), key=lambda k: (sel[k]["pack"], sel[k]["clip"]))
maxcols = max(len(sel[k]["frames"]) for k in ids)
index = {}
for s in range(0, len(ids), PER):
    chunk = ids[s:s + PER]
    W = maxcols * TILE
    H = len(chunk) * (TITLE_H + TILE + LAB_H)
    im = Image.new("RGB", (W, H), (30, 30, 34))
    dr = ImageDraw.Draw(im)
    y = 0
    for cid in chunk:
        it = sel[cid]
        hits = it.get("primary_hits") or []
        hs = "; ".join("%s c=%d" % (h["effector"], h["contact_frame"]) for h in hits[:4])
        dr.text((6, y + 3), "%s / %s   %s" % (it["pack"], it["clip"], hs), fill=(255, 235, 120), font=font)
        y += TITLE_H
        for i, (f, role) in enumerate(it["frames"]):
            p = os.path.join(FR, "%s__f%03d.png" % (cid, f))
            x = i * TILE
            if os.path.exists(p):
                t = Image.open(p).convert("RGB").resize((TILE, TILE))
                im.paste(t, (x, y))
            else:
                dr.rectangle([x, y, x + TILE - 1, y + TILE - 1], outline=(255, 0, 255))
            if role == "contact":
                dr.rectangle([x, y, x + TILE - 1, y + TILE - 1], outline=(230, 30, 30), width=4)
            dr.text((x + 6, y + TILE + 2), "f%d %s" % (f, "CONTACT" if role == "contact" else role),
                    fill=(255, 90, 90) if role == "contact" else (220, 220, 220), font=fsm)
        y += TILE + LAB_H
    name = "%s_%02d.png" % (PREFIX, s // PER)
    im.save(os.path.join(OUT, name))
    for cid in chunk:
        index[cid] = name
json.dump(index, open(os.path.join(OUT, PREFIX + "_index.json"), "w"), indent=1)
print("sheets", (len(ids) + PER - 1) // PER)
