"""Side-by-side close-up comparisons of the rig-proof renders (native 320 px tiles, no downscale).

Usage: python mixamo_proof_compare.py <frames_dir> <out_dir>
Writes compare_<view>.png for view in feet / upper / rhand / lhand:
rows = (clip, frame, body), columns = xbot | naive_three | naive_blender | retarget | hybrid.
ASCII only.
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

FR, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
font = ImageFont.truetype("arial.ttf", 15)
T = 320
VARS = ["xbot", "naive_three", "naive_blender", "retarget", "hybrid"]
BODIES = ["brute", "prisoner", "ch44"]
ROWS = {
    "feet": [("mutant_punch", 5), ("mutant_punch", 11), ("kneeing", 13)],
    "upper": [("mutant_punch", 5), ("mutant_punch", 11), ("kneeing", 13)],
    "rhand": [("mutant_punch", 11)],
    "lhand": [("mutant_punch", 5)],
}
for view, rows in ROWS.items():
    n = len(rows) * len(BODIES)
    im = Image.new("RGB", (len(VARS) * T, n * (T + 20) + 26), (28, 28, 32))
    dr = ImageDraw.Draw(im)
    dr.text((6, 4), "%s close-up: %s" % (view, " | ".join(VARS)), fill=(255, 235, 120), font=font)
    y = 26
    for clip, f in rows:
        for b in BODIES:
            for i, v in enumerate(VARS):
                p = os.path.join(FR, "%s__%s__%s__%s__f%03d.png" % (clip, b, v, view, f))
                if os.path.exists(p):
                    im.paste(Image.open(p).convert("RGB"), (i * T, y))
                dr.text((i * T + 4, y + T + 2), "%s %s f%d %s" % (clip, b, f, v), fill=(220, 220, 220), font=font)
            y += T + 20
    im.save(os.path.join(OUT, "compare_%s.png" % view))
    print(view, im.size)
