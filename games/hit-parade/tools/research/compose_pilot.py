"""Compose pilot renders <name>_<k><view>.png into one strip per clip:
rows = views (A limb-side 62 deg / B front / C right side), cols = picked frames.
Optionally prepend the source stick-figure row from cmu_sheets.
Usage: python compose_pilot.py <dir> <name> [<name> ...]"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

FONT = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 14)


def compose(d, name):
    rep = json.load(open(os.path.join(d, name + "_report.json")))
    frames = rep["frames"]
    views = [("A", "limb-side 3/4"), ("B", "front"), ("C", "right side")]
    tiles = []
    for v, _ in views:
        row = []
        for k in range(len(frames)):
            p = os.path.join(d, "%s_%d%s.png" % (name, k, v))
            row.append(Image.open(p).convert("RGB") if os.path.exists(p) else None)
        tiles.append(row)
    w, h = 420, 520
    sc = 0.62
    tw, th = int(w * sc), int(h * sc)
    W = 120 + tw * len(frames)
    H = 70 + th * len(views)
    img = Image.new("RGB", (W, H), (255, 255, 255))
    dr = ImageDraw.Draw(img)
    c = rep["clip"]
    dr.text((6, 4), "%s  take %s  src %d/%d/%d @120fps  gate max bone-dir err %.3f deg  min foot z %.3f m" % (
        name, c["take"], c["start"], c["contact"], c["end"], rep["max_dir_err_all_frames_deg"],
        rep["min_foot_z_all_frames_m"]), fill=(0, 0, 0), font=FONT)
    labels = ["start", "windup", "CONTACT", "end"] if c.get("kind") in ("hand", "foot", "knee") else \
        ["start", "1/3", "2/3", "end"]
    for k, fr in enumerate(frames):
        dr.text((120 + k * tw + 4, 24), "%s src f%d" % (labels[k] if k < len(labels) else "", fr["src_frame"]),
                fill=(0, 0, 0), font=FONT)
        dr.text((120 + k * tw + 4, 42), "hipsZ %.2f footZ %.2f yaw %.0f" % (fr["hips_z"], fr["min_foot_z"],
                                                                        fr["hips_fwd_yaw_deg"]),
                fill=(60, 60, 60), font=FONT)
    for r, (v, lab) in enumerate(views):
        dr.text((6, 70 + r * th + 10), lab, fill=(0, 0, 0), font=FONT)
        for k, t in enumerate(tiles[r]):
            if t is not None:
                img.paste(t.resize((tw, th)), (120 + k * tw, 70 + r * th))
    out = os.path.join(d, name + "_strip.png")
    img.save(out)
    print(out)


if __name__ == "__main__":
    for nm in sys.argv[2:]:
        compose(sys.argv[1], nm)
