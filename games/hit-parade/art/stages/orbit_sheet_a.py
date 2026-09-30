"""HIT PARADE - orbit proof contact sheet (lane STAGES3D-A). Plain Python 3 + PIL.

  python art/stages/orbit_sheet_a.py <stage_id> [<stage_id> ...]

Reads _harness/_reports/stages/<id>_orbit_<deg>_<n|f>.png (the 16 orbit proofs rendered by the stage build from the
CONTRACT 35.7 camera: eye y 1.35, look-at (0, 1.0, 0), dist 4.4 = n / 8.0 = f, every 45 deg) and writes
_harness/_reports/stages/<id>_orbit_sheet.png: 4 columns x 4 rows (each row = two angles, near + far), each tile
labelled "<deg> deg near|far". ASCII only.
"""
import glob
import os
import re
import sys

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
REP = os.path.join(ROOT, "_harness", "_reports", "stages")
TW, TH = 640, 360


def sheet(sid):
    files = glob.glob(os.path.join(REP, "%s_orbit_*_[nf].png" % sid))
    rx = re.compile(r"_orbit_(\d{3})_([nf])\.png$")
    shots = sorted(((int(m.group(1)), m.group(2), f) for f in files for m in [rx.search(f)] if m),
                   key=lambda t: (t[0], t[1] != "n"))
    if not shots:
        print("no orbit proofs for", sid)
        return None
    cols = 4
    rows = (len(shots) + cols - 1) // cols
    out = Image.new("RGB", (cols * TW, rows * TH), (0, 0, 0))
    d = ImageDraw.Draw(out)
    try:
        fnt = ImageFont.truetype("arial.ttf", 22)
    except OSError:
        fnt = ImageFont.load_default()
    for k, (deg, tag, f) in enumerate(shots):
        im = Image.open(f).convert("RGB").resize((TW, TH), Image.LANCZOS)
        x, y = (k % cols) * TW, (k // cols) * TH
        out.paste(im, (x, y))
        lab = "%d deg %s" % (deg, "near 4.4" if tag == "n" else "far 8.0")
        d.rectangle([x, y, x + 150, y + 30], fill=(0, 0, 0))
        d.text((x + 6, y + 3), lab, fill=(255, 255, 0), font=fnt)
    p = os.path.join(REP, "%s_orbit_sheet.png" % sid)
    out.save(p, optimize=True)
    print("orbit sheet", p, len(shots), "tiles")
    return p


if __name__ == "__main__":
    for s in sys.argv[1:] or ["rust_theater"]:
        sheet(s)
