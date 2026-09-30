"""HIT PARADE - crowd impostor atlas packer (lane STAGES). Plain Python 3 + Pillow.

  python art/stages/crowd_compose.py sheet <cells_dir> <prefix> <out.png> [cols]
      labelled contact sheet of every <prefix>*.png in cells_dir (preview / QA)
  python art/stages/crowd_compose.py atlas <cells_dir>
      packs the baked cells (crowd_atlas.py bake) into
      art/gltf/stages/crowd_atlas.webp + crowd_atlas.json and writes a QA contact image
      _harness/_reports/stages/crowd_atlas_contact.png

Cells are rendered at `supersample` x the atlas cell size; downscaling is done on
premultiplied alpha (no dark fringes), then RGB is bled into transparent texels so mipmaps and
alphaTest edges stay clean. ASCII only.
"""
import sys
import os
import json
import glob
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
PLAN = json.load(open(os.path.join(HERE, "crowd_plan.json"), encoding="utf-8"))


def on_bg(im, col=(92, 92, 104)):
    bg = Image.new("RGBA", im.size, col + (255,))
    bg.alpha_composite(im.convert("RGBA"))
    return bg.convert("RGB")


def sheet(cells_dir, prefix, out, cols=6, scale=0.5):
    fs = sorted(glob.glob(os.path.join(cells_dir, prefix + "*.png")))
    if not fs:
        raise SystemExit("no cells for " + prefix)
    ims = [Image.open(f) for f in fs]
    w, h = ims[0].size
    W, H = int(w * scale), int(h * scale)
    rows = (len(ims) + cols - 1) // cols
    sh = Image.new("RGB", (W * cols, (H + 18) * rows), (30, 30, 36))
    d = ImageDraw.Draw(sh)
    for i, (f, im) in enumerate(zip(fs, ims)):
        x, y = (i % cols) * W, (i // cols) * (H + 18)
        sh.paste(on_bg(im).resize((W, H), Image.LANCZOS), (x, y))
        d.text((x + 3, y + H + 3), os.path.basename(f)[len(prefix):-4][:40], fill=(230, 230, 230))
    sh.save(out)
    print("SHEET", len(ims), "cells ->", out, sh.size)


def downscale(im, w, h):
    pm = im.convert("RGBa")
    pm = pm.resize((w, h), Image.LANCZOS)
    return pm.convert("RGBA")


def bleed(im, passes=6):
    """Fill RGB of fully transparent texels from nearby opaque ones (alpha untouched)."""
    base = im.copy()
    a = base.getchannel("A")
    rgb = base.convert("RGB")
    mask = a.point(lambda v: 255 if v > 8 else 0)
    acc = Image.new("RGB", base.size, (0, 0, 0))
    acc.paste(rgb, (0, 0), mask)
    filled = mask
    for _ in range(passes):
        grow = filled.filter(ImageFilter.MaxFilter(5))
        blur = acc.filter(ImageFilter.BoxBlur(2))
        wblur = filled.filter(ImageFilter.BoxBlur(2))
        # normalise the blurred colour by blurred coverage
        bpx, wpx = blur.load(), wblur.load()
        new = acc.copy()
        npx = new.load()
        gpx, fpx = grow.load(), filled.load()
        for y in range(base.size[1]):
            for x in range(base.size[0]):
                if fpx[x, y] == 0 and gpx[x, y] and wpx[x, y] > 0:
                    k = 255.0 / wpx[x, y]
                    r, g, b = bpx[x, y]
                    npx[x, y] = (min(255, int(r * k)), min(255, int(g * k)), min(255, int(b * k)))
        acc = new
        filled = grow
    out = acc.convert("RGBA")
    out.putalpha(a)
    return out


def atlas(cells_dir):
    cw, ch = PLAN["cell"]["w"], PLAN["cell"]["h"]
    y0, y1 = PLAN["cell"]["frameM"]
    frame_h = y1 - y0
    px_per_m = ch / frame_h
    bodies = list(PLAN["bodies"].keys())
    poses = [p["id"] for p in PLAN["poses"]]
    angles = [a["id"] for a in PLAN["angles"]]
    facts = {}
    for f in glob.glob(os.path.join(cells_dir, "cells_*.json")):
        for r in json.load(open(f)):
            facts[(r["body"], r["pose"], r["angle"])] = r
    cols = len(poses) * len(angles)
    rows = len(bodies)
    W, H = cols * cw, rows * ch
    at = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    cells = []
    for bi, b in enumerate(bodies):
        for pi, p in enumerate(poses):
            for ai, a in enumerate(angles):
                path = os.path.join(cells_dir, "cell_%s__%s__%s.png" % (b, p, a))
                im = Image.open(path)
                im = downscale(im, cw, ch)
                im = bleed(im)
                x, y = (pi * len(angles) + ai) * cw, bi * ch
                at.paste(im, (x, y))
                fr = facts.get((b, p, a), {})
                cells.append({
                    "body": b, "pose": p, "angle": a,
                    "rect": [x, y, cw, ch],
                    "uv": [round(x / W, 6), round(1 - (y + ch) / H, 6), round((x + cw) / W, 6), round(1 - y / H, 6)],
                    "restHeightM": fr.get("restHeightM"),
                    "poseTopM": fr.get("topZ"),
                    "extentXM": [fr.get("minX"), fr.get("maxX")],
                })
    out_dir = os.path.join(ROOT, "art", "gltf", "stages")
    os.makedirs(out_dir, exist_ok=True)
    webp = os.path.join(out_dir, "crowd_atlas.webp")
    at.save(webp, "WEBP", quality=PLAN.get("webpQuality", 82), method=6, alpha_quality=90)
    meta = {
        "version": 1,
        "image": "crowd_atlas.webp",
        "size": [W, H],
        "cell": [cw, ch],
        "grid": {"cols": cols, "rows": rows, "rowIs": "body", "colIs": "pose*%d+angle" % len(angles)},
        "metresPerCellHeight": round(frame_h, 4),
        "metresPerCellWidth": round(cw / px_per_m, 4),
        "anchor": [0.5, round(1 - (0 - y0) / frame_h, 5)],
        "anchorNote": "anchor = feet/ground point in cell-normalised coords (x right, y DOWN from the cell top). Scale a card to metresPerCellWidth x metresPerCellHeight and place the anchor on the floor; the figure keeps its real size.",
        "material": "unlit, alphaTest 0.5, sRGB colours already toon-shaded + outlined (use toneMapped=false or accept the stage grade); cards may be mirrored in U for variety",
        "bodies": {b: PLAN["bodies"][b]["look"] for b in bodies},
        "poses": [{"id": p["id"], "mood": p["mood"], "src": PLAN["clips"][p["clip"]], "frame": p["frame"]} for p in PLAN["poses"]],
        "angles": PLAN["angles"],
        "cells": cells,
    }
    json.dump(meta, open(os.path.join(out_dir, "crowd_atlas.json"), "w", encoding="utf-8", newline="
"), indent=1)
    # QA contact image: the atlas on a mid background, labelled
    rep = os.path.join(ROOT, "_harness", "_reports", "stages")
    os.makedirs(rep, exist_ok=True)
    back = Image.open(webp)
    qa = on_bg(back, (70, 74, 90))
    d = ImageDraw.Draw(qa)
    for c in cells:
        x, y, w, h = c["rect"]
        d.rectangle([x, y, x + w - 1, y + h - 1], outline=(40, 40, 50))
        d.text((x + 4, y + 4), "%s %s %s" % (c["body"], c["pose"], c["angle"]), fill=(255, 240, 120))
    qa.save(os.path.join(rep, "crowd_atlas_contact.png"))
    print("ATLAS", W, H, "cells", len(cells), "webp bytes", os.path.getsize(webp))


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "sheet":
        sheet(sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5]) if len(sys.argv) > 5 else 6)
    elif cmd == "atlas":
        atlas(sys.argv[2])
