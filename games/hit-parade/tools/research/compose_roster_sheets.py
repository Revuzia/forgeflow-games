# HIT PARADE research: compose labelled contact sheets from the Mixamo roster renders.
# Usage: python compose_roster_sheets.py            -> sheets/sheet_NN.png (6 characters each, front + 3/4)
#        python compose_roster_sheets.py lineup name1,name2,... out.png [title]
#            -> height-to-scale front lineup of the named stems
import os, sys, json, glob
from PIL import Image, ImageDraw, ImageFont

ROOT = "C:/Users/TestRun/Claude Claw/forgeflow-games/games/hit-parade/_research/characters"
REN = ROOT + "/renders"
SHEETS = ROOT + "/sheets"
GREY = (128, 128, 128)
CELL = 330
LABEL_H = 46
COLS, ROWS = 2, 3
os.makedirs(SHEETS, exist_ok=True)


def font(sz):
    for f in ("C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/arial.ttf"):
        if os.path.isfile(f):
            return ImageFont.truetype(f, sz)
    return ImageFont.load_default()


F1, F2 = font(17), font(13)


def on_grey(path, size):
    im = Image.open(path).convert("RGBA")
    bg = Image.new("RGBA", im.size, GREY + (255,))
    bg.alpha_composite(im)
    return bg.convert("RGB").resize((size, size), Image.LANCZOS)


def stems():
    js = sorted(glob.glob(REN + "/*.json"), key=lambda p: os.path.basename(p).lower())
    return [os.path.splitext(os.path.basename(p))[0] for p in js]


def sheets():
    ss = stems()
    per = COLS * ROWS
    cw, ch = CELL * 2, CELL + LABEL_H
    index = []
    for si in range(0, len(ss), per):
        grp = ss[si:si + per]
        sheet = Image.new("RGB", (COLS * cw + (COLS - 1) * 8, ROWS * ch + (ROWS - 1) * 8), (40, 40, 40))
        d = ImageDraw.Draw(sheet)
        for k, s in enumerate(grp):
            m = json.load(open(os.path.join(REN, s + ".json"), encoding="utf-8"))
            x = (k % COLS) * (cw + 8)
            y = (k // COLS) * (ch + 8)
            for vi, v in enumerate(("front", "34")):
                p = os.path.join(REN, "%s_%s.png" % (s, v))
                if os.path.isfile(p):
                    sheet.paste(on_grey(p, CELL), (x + vi * CELL, y + LABEL_H))
            d.rectangle([x, y, x + cw - 1, y + LABEL_H - 1], fill=(18, 18, 18))
            d.text((x + 6, y + 3), m["file"], font=F1, fill=(255, 230, 90))
            info = "h %.2fm | %dk tris | %d mat | tex %d @%s %.0fMB | %s %d bones" % (
                m["height_m"], round(m["triangles"] / 1000.0), m["material_count"], m["texture_count"],
                m["largest_texture"], m["texture_mb"], m.get("rest_pose", "?"), m.get("bone_count", 0))
            d.text((x + 6, y + 25), info, font=F2, fill=(220, 220, 220))
        out = os.path.join(SHEETS, "sheet_%02d.png" % (si // per + 1))
        sheet.save(out)
        index.append({"sheet": os.path.basename(out), "characters": grp})
        print("wrote", out, grp)
    json.dump(index, open(os.path.join(SHEETS, "index.json"), "w"), indent=1)


def lineup(names, out, title=""):
    # height-to-scale: every front render is ortho with span_front metres across 400 px
    # an entry may be "stem=1.80" to normalise that body to a target game height (file unit scales differ)
    px_per_m = 260.0
    ims = []
    for entry in names:
        s, _, tgt = entry.partition("=")
        m = json.load(open(os.path.join(REN, s + ".json"), encoding="utf-8"))
        im = Image.open(os.path.join(REN, s + "_front.png")).convert("RGBA")
        k = (float(tgt) / m["height_m"]) if tgt else 1.0
        m = dict(m)
        m["height_m"] = m["height_m"] * k
        scale = px_per_m * m["span_front"] * k / im.size[0]
        im = im.resize((max(1, int(im.size[0] * scale)), max(1, int(im.size[1] * scale))), Image.LANCZOS)
        bb = im.getbbox()
        if bb:
            im = im.crop(bb)
        ims.append((s, m, im))
    H = int(max(i.size[1] for _, _, i in ims)) + 90
    W = sum(i.size[0] for _, _, i in ims) + 30 * (len(ims) + 1)
    W = max(W, 600)
    sheet = Image.new("RGBA", (W, H), GREY + (255,))
    d = ImageDraw.Draw(sheet)
    x = 30
    base = H - 50
    for s, m, im in ims:
        sheet.alpha_composite(im, (x, base - im.size[1]))
        d.text((x, base + 6), s[:24], font=F2, fill=(15, 15, 15))
        d.text((x, base + 24), "%.2fm" % m["height_m"], font=F2, fill=(15, 15, 15))
        x += im.size[0] + 30
    if title:
        d.text((12, 8), title, font=F1, fill=(10, 10, 10))
    # 1 m / 2 m guide lines
    for mtr in (1.0, 2.0):
        yy = int(base - mtr * px_per_m)
        if yy > 0:
            d.line([(0, yy), (W, yy)], fill=(95, 95, 95), width=1)
            d.text((2, yy - 15), "%.0fm" % mtr, font=F2, fill=(60, 60, 60))
    sheet.convert("RGB").save(out)
    print("wrote", out)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "lineup":
        lineup(sys.argv[2].split(","), sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else "")
    else:
        sheets()
