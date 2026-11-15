#!/usr/bin/env python3
"""Generate public/images/og-default.png (1200x630) — the default social-share card.

Every page's og:image pointed at /images/og-default.png, which DID NOT EXIST, so
every shared link on Discord/X/Facebook/WhatsApp showed a broken preview. This
builds the card from the real logo and real game thumbnails from the registry.

Re-run any time (e.g. after new flagship games ship):
    python scripts/make-og-image.py
"""
import io
import json
import os
import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "images" / "og-default.png"
W, H = 1200, 630

BG_TOP, BG_BOT = (10, 14, 26), (20, 27, 46)
ORANGE, BLUE = (255, 136, 0), (0, 180, 255)

SUPABASE_URL = os.environ.get("VITE_SUPABASE_URL", "https://qkidwgyapmitrdxnavmi.supabase.co")
SUPABASE_KEY = os.environ.get("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_OY39hagVV9OObItwE2VYoA_YuAu0FPZ")


def font(size, bold=True):
    for name in (["segoeuib.ttf", "arialbd.ttf", "calibrib.ttf"] if bold else ["segoeui.ttf", "arial.ttf", "calibri.ttf"]):
        p = Path("C:/Windows/Fonts") / name
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


def gradient():
    img = Image.new("RGB", (W, H))
    px = img.load()
    for y in range(H):
        t = y / (H - 1)
        c = tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t) for i in range(3))
        for x in range(W):
            px[x, y] = c
    return img


def grid(img):
    d = ImageDraw.Draw(img, "RGBA")
    for x in range(0, W, 60):
        d.line([(x, 0), (x, H)], fill=(0, 180, 255, 14), width=1)
    for y in range(0, H, 60):
        d.line([(0, y), (W, y)], fill=(255, 136, 0, 14), width=1)


def fetch_thumbs(n=4):
    url = (f"{SUPABASE_URL}/rest/v1/games?status=eq.published&select=slug,thumbnail_url"
           f"&order=play_count.desc&limit=14")
    req = urllib.request.Request(url, headers={"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"})
    rows = json.load(urllib.request.urlopen(req, timeout=30))
    out = []
    for r in rows:
        if len(out) >= n:
            break
        try:
            raw = urllib.request.urlopen(urllib.request.Request(r["thumbnail_url"], headers={"User-Agent": "Mozilla/5.0"}), timeout=30).read()
            out.append(Image.open(io.BytesIO(raw)).convert("RGB"))
        except Exception as e:
            print(f"  skip {r['slug']}: {e}")
    return out


def cover(im, w, h):
    s = max(w / im.width, h / im.height)
    im = im.resize((int(im.width * s) + 1, int(im.height * s) + 1), Image.LANCZOS)
    l, t = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((l, t, l + w, t + h))


def rounded(im, r):
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, im.width - 1, im.height - 1], r, fill=255)
    out = im.convert("RGBA")
    out.putalpha(mask)
    return out


def main():
    img = gradient()
    grid(img)

    thumbs = fetch_thumbs(4)
    # 2x2 collage on the right, slightly overlapping the edge for depth
    cw, ch, gap = 236, 152, 16
    x0, y0 = W - 2 * cw - gap - 44, 124
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    for i in range(len(thumbs)):
        cx, cy = x0 + (i % 2) * (cw + gap), y0 + (i // 2) * (ch + gap) + (24 if i % 2 else 0)
        sd.rounded_rectangle([cx + 6, cy + 10, cx + cw + 6, cy + ch + 10], 16, fill=(0, 0, 0, 150))
    shadow = shadow.filter(ImageFilter.GaussianBlur(14))
    img = Image.alpha_composite(img.convert("RGBA"), shadow)
    for i, th in enumerate(thumbs):
        cx, cy = x0 + (i % 2) * (cw + gap), y0 + (i // 2) * (ch + gap) + (24 if i % 2 else 0)
        tile = rounded(cover(th, cw, ch), 16)
        img.alpha_composite(tile, (cx, cy))
        ImageDraw.Draw(img).rounded_rectangle([cx, cy, cx + cw, cy + ch], 16, outline=(255, 255, 255, 40), width=2)

    d = ImageDraw.Draw(img)
    # accent bar + wordmark
    d.rounded_rectangle([64, 156, 72, 236], 4, fill=ORANGE)
    d.text((96, 140), "FORGEFLOW", font=font(80), fill=(243, 244, 246))
    d.text((96, 222), "GAMES", font=font(80), fill=ORANGE)
    d.text((98, 346), "Free browser games.", font=font(36, bold=False), fill=(209, 213, 219))
    d.text((98, 396), "Play instantly — no download.", font=font(36, bold=False), fill=(209, 213, 219))
    # pill
    label = "forgeflowgames.com"
    f = font(30)
    tw = d.textlength(label, font=f)
    d.rounded_rectangle([98, 506, 98 + tw + 48, 566], 30, outline=BLUE, width=3)
    d.text((98 + 24, 514), label, font=f, fill=BLUE)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT}  {OUT.stat().st_size // 1024} KB  ({len(thumbs)} thumbnails)")


if __name__ == "__main__":
    main()
