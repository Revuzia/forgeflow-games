# Font specimen + HUD mock sheet for HIT PARADE.
# Usage: python env_font_sheet.py <fonts.json> <out_specimen.png> <out_hudmock.png>
# fonts.json = [{"label": str, "path": str, "lic": str, "role": str}]
# ASCII only.
import json, sys, os
from PIL import Image, ImageDraw, ImageFont

fonts = json.load(open(sys.argv[1], encoding="utf-8"))
OUT1, OUT2 = sys.argv[2], sys.argv[3]
LBL = ImageFont.truetype(fonts[0]["path"], 18) if False else None


def f(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception as e:
        return None


label_font = None
for c in fonts:
    if "Oswald" in c["label"]:
        label_font = f(c["path"], 18)
if label_font is None:
    label_font = ImageFont.load_default()

# ---- specimen sheet
ROW = 118
W = 1900
H = 60 + ROW * len(fonts)
im = Image.new("RGB", (W, H), (18, 18, 22))
d = ImageDraw.Draw(im)
d.text((16, 14), "HIT PARADE - font candidates (rendered from the actual files)", font=f(fonts[0]["path"], 30) or label_font, fill=(255, 214, 0))
for i, c in enumerate(fonts):
    y = 60 + i * ROW
    d.rectangle([8, y, W - 8, y + ROW - 8], outline=(52, 52, 60))
    d.text((16, y + 6), "%s  |  %s  |  %s" % (c["label"], c.get("lic", ""), c.get("role", "")), font=label_font, fill=(170, 170, 185))
    big = f(c["path"], 54)
    small = f(c["path"], 26)
    if big is None:
        d.text((16, y + 40), "LOAD FAILED: " + c["path"], font=label_font, fill=(255, 80, 80))
        continue
    d.text((16, y + 34), "HIT PARADE  LIVE  SCORE 128,450", font=big, fill=(255, 255, 255))
    d.text((1120, y + 40), "ROUND 3  01:24  x4 COMBO", font=small, fill=(255, 214, 0))
    d.text((1120, y + 74), "\"He's going for the STOMP!\" 0123456789", font=small, fill=(210, 210, 220))
os.makedirs(os.path.dirname(OUT1), exist_ok=True)
im.save(OUT1)
print("SPECIMEN", OUT1, im.size)

# ---- HUD mock: one panel per display-font candidate (role contains 'display')
disp = [c for c in fonts if "display" in c.get("role", "")]
body = next((c for c in fonts if "body" in c.get("role", "")), fonts[0])
PW, PH = 900, 300
cols = 2
rows = (len(disp) + cols - 1) // cols
mock = Image.new("RGB", (cols * (PW + 16) + 16, rows * (PH + 16) + 16), (18, 18, 22))
for i, c in enumerate(disp):
    r, k = divmod(i, cols)
    ox, oy = 16 + k * (PW + 16), 16 + r * (PH + 16)
    p = Image.new("RGB", (PW, PH), (40, 60, 110))
    pd = ImageDraw.Draw(p)
    # fake arena gradient
    for yy in range(PH):
        t = yy / PH
        pd.line([(0, yy), (PW, yy)], fill=(int(30 + 40 * t), int(45 + 30 * t), int(90 - 30 * t)))
    # LIVE bug top-left
    pd.rounded_rectangle([14, 14, 250, 64], 6, fill=(20, 20, 24))
    fb = f(c["path"], 30)
    lw = pd.textlength("LIVE", font=fb)
    pd.rectangle([20, 20, 32 + lw, 58], fill=(230, 30, 40))
    pd.text((26, 22), "LIVE", font=fb, fill=(255, 255, 255))
    tx = 44 + lw
    fb2 = f(c["path"], 26)
    pd.rounded_rectangle([14, 14, tx + pd.textlength("HIT PARADE", font=fb2) + 14, 64], 6, outline=(20, 20, 24), width=0)
    pd.text((tx, 16), "HIT PARADE", font=fb2, fill=(255, 214, 0))
    pd.text((tx + 2, 46), "EP 1  THE RUST THEATER", font=f(body["path"], 13), fill=(220, 220, 230))
    # slanted score frame top-right
    x0 = PW - 330
    pd.polygon([(x0 + 30, 12), (PW - 12, 12), (PW - 42, 84), (x0, 84)], fill=(20, 20, 24))
    pd.polygon([(x0 + 38, 18), (PW - 20, 18), (PW - 48, 78), (x0 + 10, 78)], fill=(255, 214, 0))
    pd.text((x0 + 48, 20), "SCORE", font=f(c["path"], 18), fill=(20, 20, 24))
    pd.text((x0 + 48, 36), "128,450", font=f(c["path"], 38), fill=(20, 20, 24))
    # caption bar
    pd.rectangle([120, PH - 96, PW - 120, PH - 56], fill=(10, 10, 12))
    pd.text((136, PH - 90), "HOST: \"Somebody call a janitor - and a priest!\"", font=f(body["path"], 22), fill=(255, 255, 255))
    # round/timer bottom-right
    ft = f(c["path"], 30)
    pd.text((PW - 16 - pd.textlength("ROUND 3  1:24", font=ft), PH - 48), "ROUND 3  1:24", font=ft, fill=(255, 255, 255))
    pd.text((14, PH - 30), c["label"] + " + body: " + body["label"], font=label_font, fill=(255, 255, 255))
    mock.paste(p, (ox, oy))
mock.save(OUT2)
print("HUDMOCK", OUT2, mock.size)
