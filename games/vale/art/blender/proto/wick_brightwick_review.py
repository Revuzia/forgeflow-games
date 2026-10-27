#!/usr/bin/env python3
"""Brightwick review sheet: each faction's concept (front, back) beside the three.js QA close-ups (front, 3/4,
back), the UNLIT painted base colour (front, back: the paint itself, no lighting; render it first with
proto/wick_brightwick_paintview.py into art/.cache/brightwick_paint/paintview_<f>.png) and the gameplay-camera
facings, both factions stacked, so the cultures read side by side.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/wick_brightwick_review.py

Reads _design/concept/wicks/brightwick_<f>.webp and art/renders/units/three_brightwick_<f>.png (the build's QA
sheet: row 1 = 8 facings at the 52 deg camera, row 3 = close-ups); writes art/renders/units/review_brightwick.jpg.
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

GAME = Path(__file__).resolve().parents[3]
UNITS = GAME / "art" / "renders" / "units"
H = 520


def fit_h(im: Image.Image, h: int) -> Image.Image:
    return im.resize((max(1, round(im.width * h / im.height)), h), Image.LANCZOS)


def row(fac: str) -> Image.Image:
    con = Image.open(GAME / "_design" / "concept" / "wicks" / f"brightwick_{fac}.webp").convert("RGB")
    qa = Image.open(UNITS / f"three_brightwick_{fac}.png").convert("RGB")
    c = qa.width // 8
    close = [qa.crop((i * c, 2 * c, (i + 1) * c, 3 * c)) for i in (0, 1, 3)]
    games = [qa.crop((i * c, 0, (i + 1) * c, c)) for i in (0, 1, 7)]
    cw = con.width // 2
    tiles = [fit_h(con.crop((0, 0, cw, con.height)), H), fit_h(con.crop((cw, 0, con.width, con.height)), H)]
    tiles += [fit_h(t, H) for t in close]
    pv = GAME / "art" / ".cache" / "brightwick_paint" / f"paintview_{fac}.png"
    if pv.exists():                      # the unlit paint: 6 tiles of 500 x 640 (front, 3/4, side, back, top views)
        im = Image.open(pv).convert("RGB")
        for i in (0, 3):
            tiles.append(fit_h(im.crop((i * 500 + 70, 30, i * 500 + 430, 610)), H))
    g = Image.new("RGB", (H // 2, H), (40, 42, 46))
    for k, t in enumerate(games[:2]):
        g.paste(fit_h(t, H // 2), (0, k * H // 2))
    tiles.append(g)
    W = sum(t.width for t in tiles) + 6 * (len(tiles) - 1)
    out = Image.new("RGB", (W, H), (30, 30, 34))
    x = 0
    for t in tiles:
        out.paste(t, (x, 0))
        x += t.width + 6
    ImageDraw.Draw(out).text((8, 8), fac, fill=(20, 20, 20))
    return out


def main() -> None:
    rows = [row(f) for f in ("aubade", "serenade")]
    W = max(r.width for r in rows)
    sheet = Image.new("RGB", (W, sum(r.height for r in rows) + 8), (30, 30, 34))
    y = 0
    for r in rows:
        sheet.paste(r, (0, y))
        y += r.height + 8
    out = UNITS / "review_brightwick.jpg"
    sheet.save(out, quality=88)
    print(out)


if __name__ == "__main__":
    main()
