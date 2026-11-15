"""Pixel-diff the rig-proof renders: where does each naive variant differ from the world-space retarget?

naive_three and retarget use the SAME hips rule (source height x hip ratio), so pixels that differ
between those two are caused by bone ROTATIONS only. naive_blender carries its own hips rule (the
clip's hips delta added to the body's rest height), so its diff also contains a hips-height shift. Usage: python mixamo_proof_diff.py <frames_dir> <out_dir>
Writes diff_<clip>__<body>.png (rows: naive_three vs retarget, naive_blender vs retarget; columns:
views at the contact frame) and diff_stats.json (count of pixels whose max channel difference > 40).
ASCII only.
"""
import glob
import json
import os
import sys
from PIL import Image, ImageChops, ImageDraw, ImageFont

FR, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
T = 300
try:
    font = ImageFont.truetype("arial.ttf", 15)
except Exception:
    font = ImageFont.load_default()
PAIRS = [("naive_three", "retarget"), ("naive_blender", "retarget")]
VIEWS = ["feet", "upper", "q"]
stats = {}
for mpath in sorted(glob.glob(os.path.join(FR, "*__metrics.json"))):
    m = json.load(open(mpath))
    ctag, btag = os.path.basename(mpath).split("__")[:2]
    fc = m["frames"][1]  # middle frame = contact
    cols = len(VIEWS) * 3
    im = Image.new("RGB", (cols * T, 30 + len(PAIRS) * (T + 22)), (28, 28, 32))
    dr = ImageDraw.Draw(im)
    dr.text((8, 6), "%s on %s, contact frame f%d: A | B | |A-B| x3" % (ctag, btag, fc), fill=(255, 235, 120), font=font)
    for ri, (a, b) in enumerate(PAIRS):
        y = 30 + ri * (T + 22)
        for vi, v in enumerate(VIEWS):
            pa = os.path.join(FR, "%s__%s__%s__%s__f%03d.png" % (ctag, btag, a, v, fc))
            pb = os.path.join(FR, "%s__%s__%s__%s__f%03d.png" % (ctag, btag, b, v, fc))
            A = Image.open(pa).convert("RGB")
            B = Image.open(pb).convert("RGB")
            D = ImageChops.difference(A, B)
            n = sum(1 for px in D.getdata() if max(px) > 40)
            stats["%s|%s|%s-vs-%s|%s" % (ctag, btag, a, b, v)] = n
            Dv = D.point(lambda x: min(255, x * 3))
            x0 = vi * 3 * T
            for k, img in enumerate((A, B, Dv)):
                im.paste(img.resize((T, T)), (x0 + k * T, y))
            dr.text((x0 + 4, y + T + 3), "%s: %s vs %s  (%d px differ)" % (v, a, b, n), fill=(220, 220, 220), font=font)
    im.save(os.path.join(OUT, "diff_%s__%s.png" % (ctag, btag)))
json.dump(stats, open(os.path.join(OUT, "diff_stats.json"), "w"), indent=1)
for k, v in sorted(stats.items()):
    print(k, v)
