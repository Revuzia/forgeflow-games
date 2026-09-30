"""Compose the rig-proof renders: one sheet per (clip, body); rows = variants, cols = frames x views.

Usage: python mixamo_proof_montage.py <frames_dir> <out_dir>
ASCII only.
"""
import glob
import json
import os
import sys
from PIL import Image, ImageDraw, ImageFont

FR, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
VARS = ["xbot", "naive_blender", "naive_three_raw", "naive_three", "retarget_dw", "retarget", "hybrid"]
VIEWSETS = [("full", ["q", "side"]), ("zoom", ["feet", "upper"])]
T = 260
LW = 150
try:
    font = ImageFont.truetype("arial.ttf", 14)
    big = ImageFont.truetype("arial.ttf", 17)
except Exception:
    font = big = ImageFont.load_default()

for mpath, (setname, VIEWS) in [(mp, vs) for mp in sorted(glob.glob(os.path.join(FR, "*__metrics.json"))) for vs in VIEWSETS]:
    m = json.load(open(mpath))
    ctag, btag = os.path.basename(mpath).split("__")[:2]
    frames = m["frames"]
    cols = [(f, v) for v in VIEWS for f in frames]
    W = LW + len(cols) * T
    H = 30 + 20 + len(VARS) * T
    im = Image.new("RGB", (W, H), (28, 28, 32))
    dr = ImageDraw.Draw(im)
    dr.text((8, 6), "%s on %s   (hip ratio %.3f; hidden: %s)" % (ctag, btag, m["ratio"], ",".join(m["hidden"]) or "-"),
            fill=(255, 235, 120), font=big)
    for ci, (f, v) in enumerate(cols):
        dr.text((LW + ci * T + 6, 32), "f%d  %s" % (f, {"q": "3/4", "side": "side", "feet": "feet zoom", "upper": "upper zoom"}[v]), fill=(220, 220, 220), font=font)
    for ri, var in enumerate(VARS):
        y = 50 + ri * T
        dr.text((6, y + 8), var, fill=(140, 220, 255), font=big)
        mm = m["metrics"].get(var, {})
        lz = [mm[str(f)]["lowest_vertex_z_m"] for f in frames if str(f) in mm]
        if lz:
            dr.text((6, y + 32), "lowest vtx z:", fill=(200, 200, 200), font=font)
            for k, z in enumerate(lz):
                dr.text((6, y + 50 + 16 * k), "  f%d %+.3f m" % (frames[k], z), fill=(200, 200, 200), font=font)
        for ci, (f, v) in enumerate(cols):
            p = os.path.join(FR, "%s__%s__%s__%s__f%03d.png" % (ctag, btag, var, v, f))
            if os.path.exists(p):
                im.paste(Image.open(p).convert("RGB").resize((T, T)), (LW + ci * T, y))
    out = os.path.join(OUT, "proof_%s__%s__%s.png" % (ctag, btag, setname))
    im.save(out)
    print(out)
