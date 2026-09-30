#!/usr/bin/env python
"""DYEFIELD — the install icons (CONTRACT_MOBILE M9), rendered headlessly from the favicon mark in runtime/index.html.

The mark is original art (a navy tile, an amber dye wave, a cream sun, a violet crest triangle), so this is a plain
SVG -> PNG render in headless Chrome: no image generation, no spend.

  runtime/public/icons/icon-192.png           purpose "any"      the favicon tile as is (transparent corners)
  runtime/public/icons/icon-512.png           purpose "any"
  runtime/public/icons/icon-maskable-512.png  purpose "maskable" full-bleed navy, the mark inside the 80 % safe circle
  runtime/public/icons/apple-touch-icon.png   180 x 180          full-bleed navy (iOS rounds the corners itself)

Run:  python _harness/build_icons.py        (then check: python -c "from PIL import Image; ...")
"""
from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "runtime", "public", "icons")

NAVY = "#14203a"
# the favicon's glyphs (runtime/index.html <link rel="icon">), 64 x 64 user units
GLYPHS = ("<path d='M12 40c2-10 10-17 20-17s18 7 20 17c-4-3-8-3-11 1-3-3-6-3-9 0-3-3-6-3-9 0-3-4-7-4-11-1z' fill='#ff8a1f'/>"
          "<circle cx='24' cy='20' r='5' fill='#fff8ec'/>"
          "<path d='M38 15l7 11h-14z' fill='#5b4bf0' stroke='#fff8ec' stroke-width='2' stroke-linejoin='round'/>")
TILE = "<rect x='3' y='3' width='58' height='58' rx='16' fill='%s'/>" % NAVY


def svg(kind: str, px: int) -> str:
    if kind == "any":
        body = TILE + GLYPHS
    else:
        # full bleed; the glyph box (x 12..52, y 14..41, centre 32 / 27.5) scaled about its centre onto the tile centre.
        # maskable: 0.85 keeps every glyph corner within 21 units of the centre (the safe circle is 25.6 = 40 %).
        s = 0.85 if kind == "maskable" else 0.95
        body = ("<rect width='64' height='64' fill='%s'/>" % NAVY
                + "<g transform='translate(32 32) scale(%s) translate(-32 -27.5)'>%s</g>" % (s, GLYPHS))
    return ("<svg xmlns='http://www.w3.org/2000/svg' width='%d' height='%d' viewBox='0 0 64 64' shape-rendering='geometricPrecision'>%s</svg>"
            % (px, px, body))


JOBS = [("icon-192.png", "any", 192), ("icon-512.png", "any", 512), ("icon-maskable-512.png", "maskable", 512),
        ("apple-touch-icon.png", "apple", 180)]


def main() -> int:
    from playwright.sync_api import sync_playwright
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as pw:
        b = pw.chromium.launch(channel="chrome", headless=True)
        try:
            for name, kind, px in JOBS:
                page = b.new_page(viewport={"width": px, "height": px}, device_scale_factor=1)
                page.set_content("<!doctype html><html><body style='margin:0;background:transparent'>%s</body></html>" % svg(kind, px))
                path = os.path.join(OUT, name)
                page.screenshot(path=path, omit_background=(kind == "any"), clip={"x": 0, "y": 0, "width": px, "height": px})
                page.close()
                print("wrote", os.path.relpath(path, ROOT), px, "x", px, kind)
        finally:
            b.close()
    try:
        from PIL import Image
        for name, kind, px in JOBS:
            im = Image.open(os.path.join(OUT, name))
            corner = im.convert("RGBA").getpixel((0, 0))
            ok = im.size == (px, px) and (corner[3] == 0 if kind == "any" else corner[3] == 255)
            print("check", name, im.size, im.mode, "corner", corner, "OK" if ok else "BAD")
            if not ok:
                return 1
    except ImportError:
        print("PIL not installed: sizes not re-checked")
    return 0


if __name__ == "__main__":
    sys.exit(main())
