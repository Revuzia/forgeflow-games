#!/usr/bin/env python3
"""VALE UI vector icons for the catalog (art/out/ui/icons/<set>/<id>.svg and art/out/ui/modes/<id>.svg).

    python3 tools/ui_icons.py

Chalk line art on a transparent ground, the same shape language as the UI's drawn glyphs
(src/ui/components/Glyphs.tsx: class mass glyphs, mode marks, the candle) so the catalog art and the
fallbacks agree; rank emblems climb the sun like src/ui/components/RankEmblem.tsx, in the tier colour.
Bible rules: no gears, no runes, no text.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

GAME = Path(__file__).resolve().parent.parent
OUT = GAME / "art" / "out" / "ui"
CHALK = "#EDE6D6"
INK = "#1B1D24"


def svg(body: str, vb: str = "0 0 48 48") -> str:
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="48" height="48" fill="none" '
            f'stroke="{CHALK}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">{body}</svg>\n')


def write(rel: str, text: str) -> None:
    p = OUT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


# ── classes: the mass glyphs (24-unit shapes scaled ×2) ─────────────────────────────────────────
CLASS = {
    "class_plinth": '<polygon points="8,12 40,12 36,40 12,40" fill="{c}" stroke="none"/>',
    "class_breaker": '<polygon points="7,10 41,10 24,42" fill="{c}" stroke="none"/>',
    "class_striker": '<polygon points="12,42 21,42 37,7 28,7" fill="{c}" stroke="none"/>',
    "class_slinger": '<g fill="{c}" stroke="none"><rect x="5" y="20" width="38" height="8"/><rect x="10" y="14" width="4" height="20"/></g>',
    "class_caster": '<g fill="{c}" stroke="none"><circle cx="24" cy="12" r="7.2"/><rect x="21.6" y="21" width="4.8" height="22"/></g>',
    "class_tender": '<circle cx="24" cy="25" r="16" stroke-width="4.4"/><circle cx="24" cy="25" r="6" fill="{c}" stroke="none"/>',
}

# ── modes: the mode marks (three roads + the noon line · one line over an arc · a ring of ticks) ─
def mode_roads() -> str:
    ys = [16, 24, 32]
    return "".join(f'<line x1="9" y1="{y}" x2="39" y2="{y}"/>' for y in ys) + '<line x1="24" y1="7" x2="24" y2="41" stroke-dasharray="2.5 3.5"/>'


def mode_ring(n: int = 10) -> str:
    out = []
    for i in range(n):
        a = i / n * math.tau - math.pi / 2
        out.append(f'<line x1="{24 + math.cos(a) * 12:.2f}" y1="{24 + math.sin(a) * 12:.2f}" x2="{24 + math.cos(a) * 17:.2f}" y2="{24 + math.sin(a) * 17:.2f}"/>')
    return "".join(out)


MODES = {"rift_glyph": mode_roads(), "bridge_glyph": '<line x1="6" y1="21" x2="42" y2="21"/><path d="M9 39A15 13 0 0 1 39 39"/>',
         "fray_glyph": mode_ring(10)}

# ── nav ─────────────────────────────────────────────────────────────────────────────────────────
NAV = {
    "home": '<path d="M9 40V22L24 9l15 13v18"/><path d="M19 40V29a5 5 0 0 1 10 0v11"/>',                    # an arched door under a gable
    "play": '<polygon points="15,9 37,24 15,39" fill="' + CHALK + '" stroke="none"/>',                        # the gnomon wedge
    "collection": '<rect x="14" y="8" width="20" height="28" rx="2"/><path d="M9 14v24a2 2 0 0 0 2 2h18"/>',   # stacked cards
    "shop": '<path d="M24 7c3.2 4.2 4.2 6.6 4.2 8.6a4.2 4.2 0 0 1-8.4 0c0-2 1-4.4 4.2-8.6z" fill="' + CHALK + '" stroke="none"/>'
            '<rect x="16" y="24" width="16" height="16" rx="2"/><line x1="12" y1="40" x2="36" y2="40"/>',       # the lampwright's candle on its stand
    "profile": '<path d="M15 20a9 9 0 0 1 18 0v6a9 9 0 0 1-18 0z"/><line x1="18" y1="22" x2="30" y2="22"/><path d="M11 41c2-6 7-8 13-8s11 2 13 8"/>',  # masked bust
    "settings": '<line x1="9" y1="14" x2="39" y2="14"/><line x1="9" y1="24" x2="39" y2="24"/><line x1="9" y1="34" x2="39" y2="34"/>'
                '<circle cx="18" cy="14" r="3.5" fill="' + INK + '"/><circle cx="31" cy="24" r="3.5" fill="' + INK + '"/><circle cx="22" cy="34" r="3.5" fill="' + INK + '"/>',  # sliders, never a gear
}

# ── roles ───────────────────────────────────────────────────────────────────────────────────────
ROLES = {
    "shadehold": '<path d="M24 7l14 5v11c0 9-6 15-14 18-8-3-14-9-14-18V12z"/><path d="M24 7v34" /><path d="M24 12l14 0v11c0 9-6 15-14 18z" fill="' + CHALK + '" fill-opacity="0.35" stroke="none"/>',  # a held ward, half in shade
    "grovehunter": '<path d="M14 40V30M14 30l-6 0 6-10 6 10z"/><path d="M30 40V26M30 26l-8 0 8-14 8 14z"/><path d="M38 9l-9 9M38 9v6M38 9h-6"/>',  # dialwood and an arrow
    "dialcross": '<circle cx="24" cy="24" r="15"/><line x1="24" y1="5" x2="24" y2="43"/><line x1="12" y1="31" x2="36" y2="17"/>',  # the dial crossed by a road
    "shaftlight": '<path d="M30 6l-12 36" stroke-width="5" stroke-opacity="0.45"/><path d="M30 6l-12 36"/><circle cx="18" cy="42" r="2.5" fill="' + CHALK + '" stroke="none"/>',  # a shaft of light striking down
    "lampglass": '<path d="M18 14h12l3 20H15z"/><line x1="24" y1="6" x2="24" y2="14"/><line x1="14" y1="40" x2="34" y2="40"/><circle cx="24" cy="25" r="3.5" fill="' + CHALK + '" stroke="none"/>',  # a glass lamp
}

# ── paths (setup boon trees) ────────────────────────────────────────────────────────────────────
PATHS = {
    "shadeline": '<line x1="8" y1="36" x2="40" y2="36"/><path d="M14 36L38 14" stroke-dasharray="3 4"/><polygon points="14,36 40,36 40,30" fill="' + CHALK + '" fill-opacity="0.45" stroke="none"/>',
    "warmstone": '<rect x="11" y="26" width="26" height="14" rx="5"/><path d="M17 20c-2-3 2-5 0-8M24 20c-2-3 2-5 0-8M31 20c-2-3 2-5 0-8"/>',
    "hourturn": '<path d="M36.5 18A14 14 0 1 0 38 26"/><polyline points="38,10 37,18 29.5,17"/><circle cx="24" cy="24" r="2.6" fill="' + CHALK + '" stroke="none"/>',
}


def rank_emblem(i: int, n: int, color: str) -> str:
    """the sun climbs the horizon arc with the tier; hour-ticks under the arc count it (RankEmblem.tsx)"""
    h = (i + 1) / n
    sun_y = 70 - h * 42
    ticks = "".join(f'<line x1="{50 + (k - (i) / 2) * 7:.1f}" y1="82" x2="{50 + (k - (i) / 2) * 7:.1f}" y2="88" stroke="{color}" stroke-width="3"/>' for k in range(i + 1))
    top = i == n - 1
    rim = '<circle cx="50" cy="50" r="44" stroke="url(#prism)" stroke-width="4"/>' if top else f'<circle cx="50" cy="50" r="44" stroke="{color}" stroke-width="3" stroke-opacity="0.8"/>'
    defs = ('<defs><linearGradient id="prism" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9FD4FF"/><stop offset="0.35" stop-color="#C9B8FF"/>'
            '<stop offset="0.7" stop-color="#FFD9A8"/><stop offset="1" stop-color="#B9F2D5"/></linearGradient></defs>') if top else ""
    body = (defs + rim + f'<path d="M14 72 A36 30 0 0 1 86 72" stroke="{CHALK}" stroke-width="3"/>'
            f'<line x1="10" y1="72" x2="90" y2="72" stroke="{CHALK}" stroke-width="2"/>'
            f'<circle cx="50" cy="{sun_y:.1f}" r="11" fill="{color}" stroke="{CHALK}" stroke-width="2"/>' + ticks)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="96" height="96" fill="none" stroke-linecap="round">{body}</svg>\n')


def main() -> None:
    for k, b in CLASS.items():
        write(f"icons/classes/{k}.svg", svg(b.replace("{c}", CHALK)))
    for k, b in MODES.items():
        write(f"modes/{k}.svg", svg(b))
    for k, b in NAV.items():
        write(f"icons/nav/{k}.svg", svg(b))
    for k, b in ROLES.items():
        write(f"icons/roles/{k}.svg", svg(b))
    for k, b in PATHS.items():
        write(f"icons/paths/{k}.svg", svg(b))
    write("icons/currency/candles.svg", svg('<path d="M24 5c4 5.2 5.2 8.2 5.2 10.6a5.2 5.2 0 0 1-10.4 0c0-2.4 1.2-5.4 5.2-10.6z" fill="#F2C46B" stroke="none"/>'
                                            f'<rect x="19.2" y="23" width="9.6" height="20" fill="{CHALK}" stroke="none"/>'))
    raw = json.loads((GAME / "content" / "ranks.json").read_text())
    ranks = sorted(raw["ranks"] if isinstance(raw, dict) else raw, key=lambda r: r["minRating"])
    for i, r in enumerate(ranks):
        write(f"icons/ranks/{r['id']}.svg", rank_emblem(i, len(ranks), r["color"]))
    print(f"wrote {len(CLASS) + len(MODES) + len(NAV) + len(ROLES) + len(PATHS) + 1 + len(ranks)} icons under {OUT.relative_to(GAME)}")


if __name__ == "__main__":
    main()
