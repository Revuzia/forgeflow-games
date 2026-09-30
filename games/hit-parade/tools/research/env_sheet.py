# HIT PARADE environment scouting - PIL contact sheets.
# Usage: python env_sheet.py <spec.json>
# spec = {"title": str, "out": png path, "cols": int, "cell": int,
#         "items": [{"img": path, "label": str, "sub": str, "tile2x2": bool, "extra": [paths]}]}
# "extra" images (e.g. normal / roughness) are drawn as small insets under the main image.
# ASCII only.
import json, sys, os
from PIL import Image, ImageDraw, ImageFont

FONT_DIR = "F:/games/forgeflow-games-assets/_downloaded/fonts"


def font(size, bold=True):
    for p in ("Oswald/static/Oswald-SemiBold.ttf", "Oswald/Oswald-VariableFont_wght.ttf", "Bebas_Neue/BebasNeue-Regular.ttf"):
        fp = os.path.join(FONT_DIR, p)
        if os.path.exists(fp):
            try:
                return ImageFont.truetype(fp, size)
            except Exception:
                pass
    return ImageFont.load_default()


def load_img(p, size):
    try:
        im = Image.open(p)
        im.load()
    except Exception:
        return None
    if im.mode in ("I;16", "I", "F"):
        im = im.point(lambda v: v / 256).convert("L")
    im = im.convert("RGBA")
    bg = Image.new("RGBA", im.size, (40, 40, 44, 255))
    bg.alpha_composite(im)
    im = bg.convert("RGB")
    im.thumbnail((size, size), Image.LANCZOS)
    return im


def tile2(im, size):
    t = Image.new("RGB", (im.width * 2, im.height * 2))
    for x in range(2):
        for y in range(2):
            t.paste(im, (x * im.width, y * im.height))
    t = t.resize((size, size), Image.LANCZOS)
    return t


def build(spec):
    cols = spec.get("cols", 5)
    cell = spec.get("cell", 300)
    items = spec["items"]
    label_h = 64
    extra_h = cell // 4 if any(i.get("extra") for i in items) else 0
    rows = (len(items) + cols - 1) // cols
    head = 70
    W = cols * (cell + 12) + 12
    H = head + rows * (cell + extra_h + label_h + 12) + 12
    sheet = Image.new("RGB", (W, H), (22, 22, 26))
    d = ImageDraw.Draw(sheet)
    d.text((14, 12), spec.get("title", ""), font=font(40), fill=(255, 214, 0))
    f1, f2 = font(20), font(15)
    for i, it in enumerate(items):
        r, c = divmod(i, cols)
        x = 12 + c * (cell + 12)
        y = head + r * (cell + extra_h + label_h + 12)
        d.rectangle([x - 1, y - 1, x + cell, y + cell + extra_h + label_h], outline=(60, 60, 66))
        im = load_img(it["img"], cell) if it.get("img") else None
        if im is not None:
            if it.get("tile2x2"):
                src = Image.open(it["img"]).convert("RGB")
                src.thumbnail((cell, cell), Image.LANCZOS)
                im = tile2(src, cell)
            sheet.paste(im, (x + (cell - im.width) // 2, y + (cell - im.height) // 2))
        else:
            d.text((x + 8, y + cell // 2), "MISSING", font=f1, fill=(255, 80, 80))
        ex = it.get("extra") or []
        if ex:
            w = cell // max(len(ex), 1)
            for j, e in enumerate(ex):
                ei = load_img(e, min(w, extra_h) - 2)
                if ei is not None:
                    sheet.paste(ei, (x + j * w, y + cell + 1))
        d.text((x + 4, y + cell + extra_h + 4), it.get("label", "")[:34], font=f1, fill=(240, 240, 240))
        sub = it.get("sub", "")
        d.text((x + 4, y + cell + extra_h + 30), sub[:44], font=f2, fill=(170, 170, 180))
        if len(sub) > 44:
            d.text((x + 4, y + cell + extra_h + 46), sub[44:88], font=f2, fill=(170, 170, 180))
    os.makedirs(os.path.dirname(spec["out"]), exist_ok=True)
    sheet.save(spec["out"])
    print("SHEET", spec["out"], sheet.size)


if __name__ == "__main__":
    build(json.load(open(sys.argv[1], encoding="utf-8")))
