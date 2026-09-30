"""HIT PARADE - texture repaint for goon bodies (lane ASSETS; research ROSTER content flag: Ch35 prints POLICE / SWAT).

  python tools/goon_repaint.py <fighter_id>        (reads tools/bodies.json bodies.<id>.repaint)

Called by tools/build_fighters.py BEFORE the Blender bake of a body that has a `repaint` block; never by hand.
  1. the body FBX's embedded textures are dumped once with Blender (tools/research/dump_fbx_textures.py) into
     art/renders/<id>/_src/ (cached);
  2. for every op {rect [x0,y0,x1,y1] px, text, rot (deg, CCW), font, donor [dx,dy] | null}: the printed lettering
     inside rect (pixels clearly brighter than the fabric) is removed - cloned from a clean donor area of the same
     garment when `donor` is given, else filled by normalised convolution from the surrounding fabric plus matched
     grain - and the new show lettering is printed in the ORIGINAL ink colour with the fabric weave showing through and
     a little wear (seeded);
  3. writes art/renders/<id>/_src/<image>_repaint.png (full size) + repaint_check.png (before / after crops) and
     prints {"overrides": {image_stem: path}} for the bake job (hp_body swaps the image before the atlas bake).
Deterministic. Fonts: the game's own SIL-OFL fonts (runtime/src/ui/fonts). ASCII only.
"""
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

TOOLS = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(TOOLS)
BLENDER = "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe"
FONTS = {"russo": "russo-one-latin-400.woff2", "bebas": "bebas-neue-latin-400.woff2", "oswald": "oswald-latin-400.woff2"}
ENV = dict(os.environ, PYTHONIOENCODING="utf-8")


def lum(a):
    return a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114


def blur(a, s):
    from scipy.ndimage import gaussian_filter
    a = a.astype(np.float32)
    if a.ndim == 2:
        return gaussian_filter(a, s, mode="nearest")
    return np.stack([gaussian_filter(a[..., i], s, mode="nearest") for i in range(a.shape[-1])], -1)


def dump_textures(fbx, out):
    os.makedirs(out, exist_ok=True)
    if not any(f.endswith("_diffuse.png") for f in os.listdir(out)):
        p = subprocess.run([BLENDER, "--background", "--factory-startup", "--python",
                            os.path.join(TOOLS, "research", "dump_fbx_textures.py"), "--", fbx, out],
                           capture_output=True, text=True, encoding="utf-8", errors="replace", env=ENV)
        if p.returncode:
            raise SystemExit("texture dump failed: " + p.stdout[-1500:] + p.stderr[-1500:])


def value_noise(h, w, cell, rng):
    gy, gx = h // cell + 2, w // cell + 2
    g = rng.random((gy, gx)).astype(np.float32)
    ys = np.linspace(0, gy - 2, h, endpoint=False)
    xs = np.linspace(0, gx - 2, w, endpoint=False)
    y0, x0 = ys.astype(int), xs.astype(int)
    fy, fx = (ys - y0)[:, None], (xs - x0)[None, :]
    a, b = g[y0][:, x0], g[y0][:, x0 + 1]
    c, d = g[y0 + 1][:, x0], g[y0 + 1][:, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def text_mask(w, h, text, font_key, rot):
    """white-on-black L mask of `text`, fitted into w x h after rotation by `rot` degrees (CCW)"""
    path = os.path.join(GAME, "runtime", "src", "ui", "fonts", FONTS[font_key])
    vertical = abs(rot) % 180 == 90
    bw, bh = (h, w) if vertical else (w, h)
    S = 3
    px = int(bh * S)
    while px > 6:
        f = ImageFont.truetype(path, px)
        bb = ImageDraw.Draw(Image.new("L", (8, 8))).textbbox((0, 0), text, font=f)
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
        if tw <= bw * S * 0.86 and th <= bh * S * 0.62:
            break
        px -= 2
    im = Image.new("L", (bw * S, bh * S), 0)
    ImageDraw.Draw(im).text(((bw * S - tw) / 2 - bb[0], (bh * S - th) / 2 - bb[1]), text, font=f, fill=255)
    im = im.rotate(rot, expand=True).resize((w, h), Image.LANCZOS)
    return np.asarray(im, np.float32) / 255.0


def repaint_op(img, op, rng):
    x0, y0, x1, y1 = op["rect"]
    reg = img[y0:y1, x0:x1].astype(np.float32)
    L = lum(reg)
    bg = np.median(L)
    hi = np.percentile(L, 99)
    thr = bg + op.get("thr", 0.4) * (hi - bg)
    m = (L > thr).astype(np.float32)
    m = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(op.get("dilate", 9))),
                   np.float32) / 255.0
    ink = np.median(reg[L > thr], 0) if (L > thr).any() else np.array([200.0, 200.0, 196.0])
    if op.get("donor"):
        dx, dy = op["donor"]
        fill = img[y0 + dy:y1 + dy, x0 + dx:x1 + dx].astype(np.float32)
        # match the donor's low frequencies to the region's clean fabric
        clean = 1.0 - m
        if clean.sum() > 50:
            fill = fill + (reg[clean > 0.5].mean(0) - fill[clean > 0.5].mean(0))
    else:
        keep = 1.0 - m
        num = blur(reg * keep[..., None], op.get("sigma", 7.0))
        den = blur(keep, op.get("sigma", 7.0))[..., None]
        fill = num / np.maximum(den, 1e-3)
        for s in (16.0, 32.0, 64.0):                     # wide holes: widen the kernel until every pixel is reached
            num2, den2 = blur(reg * keep[..., None], s), blur(keep, s)[..., None]
            low = den < 0.05
            fill = np.where(low, num2 / np.maximum(den2, 1e-3), fill)
            den = np.maximum(den, den2)
        hp = reg - blur(reg, 2.0)
        grain = hp[keep > 0.5].std(0) if (keep > 0.5).sum() > 50 else np.array([4.0, 4.0, 4.0])
        fill = fill + blur(rng.standard_normal(reg.shape).astype(np.float32), 0.7) * grain * 1.4
    feather = np.clip(blur(m, 2.0) * 1.6, 0.0, 1.0)[..., None]
    base = reg * (1 - feather) + fill * feather
    # new lettering in the original ink, weave showing through, light wear
    tm = text_mask(x1 - x0, y1 - y0, op["text"], op.get("font", "russo"), op.get("rot", 0))
    wear = (value_noise(y1 - y0, x1 - x0, op.get("wear_cell", 5), rng) > op.get("wear", 0.12)).astype(np.float32)
    a = np.clip(tm * (0.55 + 0.45 * blur(wear, 0.8)), 0.0, 1.0)[..., None]
    bl = lum(base)
    weave = (0.82 + 0.36 * (bl / max(float(bl.mean()), 1.0)))[..., None]
    out = base * (1 - a) + np.clip(ink * weave, 0, 255) * a
    img[y0:y1, x0:x1] = np.clip(out, 0, 255)
    return {"rect": op["rect"], "text": op["text"], "ink": [round(float(v), 1) for v in ink],
            "removed_px": int((L > thr).sum()), "bg_lum": round(float(bg), 1)}


def main():
    fid = sys.argv[1]
    bodies = json.load(open(os.path.join(TOOLS, "bodies.json"), encoding="utf-8"))
    cfg = bodies["bodies"][fid]
    rp = cfg.get("repaint")
    if not rp:
        print(json.dumps({"overrides": {}}))
        return
    src = os.path.join(GAME, "art", "renders", fid, "_src").replace("\\", "/")
    dump_textures(bodies["characters_root"] + "/" + cfg["fbx"], src)
    rng = np.random.default_rng(int(rp.get("seed", 1335)))
    overrides, report, checks = {}, {}, []
    for stem, ops in rp["images"].items():
        im = Image.open(os.path.join(src, stem + ".png")).convert("RGB")
        before = np.asarray(im, np.float32).copy()
        arr = before.copy()
        report[stem] = [repaint_op(arr, op, rng) for op in ops]
        out = os.path.join(src, stem + "_repaint.png").replace("\\", "/")
        Image.fromarray(arr.astype(np.uint8)).save(out)
        overrides[stem] = out
        for op in ops:
            x0, y0, x1, y1 = op["rect"]
            pad = 40
            box = (max(0, x0 - pad), max(0, y0 - pad), min(arr.shape[1], x1 + pad), min(arr.shape[0], y1 + pad))
            b = Image.fromarray(before.astype(np.uint8)).crop(box)
            a = Image.fromarray(arr.astype(np.uint8)).crop(box)
            checks.append((b, a))
    # before | after strip for the log / a human read
    W = max(b.size[0] for b, _ in checks) * 2 + 10
    H = sum(max(b.size[1], 1) for b, _ in checks) + 10 * len(checks)
    sheet = Image.new("RGB", (W, H), (255, 0, 255))
    y = 0
    for b, a in checks:
        sheet.paste(b, (0, y))
        sheet.paste(a, (b.size[0] + 10, y))
        y += b.size[1] + 10
    sheet.save(os.path.join(src, "repaint_check.png"))
    print(json.dumps({"overrides": overrides, "report": report}))


if __name__ == "__main__":
    main()
