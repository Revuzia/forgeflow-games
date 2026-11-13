#!/usr/bin/env python
"""HIT PARADE - the install icons (CONTRACT_MOBILE M9), rendered headlessly from the favicon mark in runtime/index.html.

The mark is original art (an ink tile, a red TV set with yellow antennas and a yellow impact star on its screen), so
this is a plain SVG -> PNG render in headless Chrome: no image generation, no spend. (dyefield _harness/build_icons.py;
only INK and GLYPHS changed.)

  runtime/public/icons/icon-192.png           purpose "any"      the favicon tile as is (transparent corners)
  runtime/public/icons/icon-512.png           purpose "any"
  runtime/public/icons/icon-maskable-512.png  purpose "maskable" full-bleed ink, the mark inside the 80 % safe circle
  runtime/public/icons/apple-touch-icon.png   180 x 180          full-bleed ink (iOS rounds the corners itself)

Run:  python _harness/build_icons.py        (prints a per-file check: size, mode, corner alpha, and the colours found)
"""
from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "runtime", "public", "icons")

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

INK = "#140d1f"
# the favicon's glyphs (runtime/index.html <link rel="icon">), 64 x 64 user units; glyph box x 9..55, y 7..59
GLYPHS = ("<path d='M24 9l8 9 8-9' fill='none' stroke='#ffd23a' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'/>"
          "<path d='M17 54h6v5h-6zM41 54h6v5h-6z' fill='#ff2e4d'/>"
          "<rect x='9' y='17' width='46' height='38' rx='8' fill='#ff2e4d'/>"
          "<rect x='14' y='22' width='36' height='29' rx='5' fill='%s'/>" % INK
          + "<path d='M32 26L33.8 32.1L39.4 29.1L36.4 34.7L42.5 36.5L36.4 38.3L39.4 43.9L33.8 40.9L32 47L30.2 40.9L24.6 43.9"
            "L27.6 38.3L21.5 36.5L27.6 34.7L24.6 29.1L30.2 32.1z' fill='#ffd23a'/>")
TILE = "<rect x='3' y='3' width='58' height='58' rx='14' fill='%s'/>" % INK
GLYPH_CX, GLYPH_CY = 32, 33


def svg(kind: str, px: int) -> str:
    if kind == "any":
        body = TILE + GLYPHS
    else:
        # full bleed; the glyph box scaled about its centre onto the tile centre. maskable: 0.8 keeps every glyph
        # point within ~24 units of the centre (the safe circle is 25.6 = 40 % of 64).
        s = 0.8 if kind == "maskable" else 0.92
        body = ("<rect width='64' height='64' fill='%s'/>" % INK
                + "<g transform='translate(32 32) scale(%s) translate(-%d -%d)'>%s</g>" % (s, GLYPH_CX, GLYPH_CY, GLYPHS))
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
        bad = 0
        for name, kind, px in JOBS:
            im = Image.open(os.path.join(OUT, name)).convert("RGBA")
            corner = im.getpixel((0, 0))
            centre = im.getpixel((px // 2, int(px * 0.57)))       # the impact star
            red = im.getpixel((int(px * 0.2), int(px * 0.5)))     # the TV body's left edge band
            ok = im.size == (px, px) and (corner[3] == 0 if kind == "any" else corner[3] == 255)
            print("check", name, im.size, "corner", corner, "star", centre[:3], "body", red[:3], "OK" if ok else "BAD")
            bad += 0 if ok else 1
        return 1 if bad else 0
    except ImportError:
        print("PIL not installed: sizes not re-checked")
    return 0


if __name__ == "__main__":
    sys.exit(main())
