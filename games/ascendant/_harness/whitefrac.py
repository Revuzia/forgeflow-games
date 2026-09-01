#!/usr/bin/env python
"""ASCENDANT white-fraction gate — % of PURE-WHITE pixels per battery shot.

THE LAW (lighting round 2, accepted): no gameplay frame may carry more than
2 % pure-white pixels. "Pure white" is the 245-cut used through the round-2
forensics (all three channels >= 245) — the value past which fog, bloom and
sun stack into featureless paper. This script is the numeric half of the
proof; READING the frames is the other half and is not optional.

    python whitefrac.py                 # every *.png in _shots/ (top level)
    python whitefrac.py _shots/contrast # a specific directory
    python whitefrac.py --limit 2.0     # explicit threshold (default 2.0)

Exit 1 when any GAMEPLAY frame exceeds the limit. UI frames (title / hub menu
/ pause / clear cards, matched by name) are printed but never gate — a white
card is a design choice, not a lighting defect.
"""
import argparse
import os
import sys

from PIL import Image, ImageChops

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
WHITE = 245          # the round-2 "245-white cut"
UI_MARKERS = ("title", "menu", "pause", "clear", "hud", "ui_", "_ui")


def white_fraction(path):
    """% of pixels whose MIN channel >= WHITE (i.e. all three channels)."""
    im = Image.open(path).convert("RGB")
    r, g, b = im.split()
    mn = ImageChops.darker(r, ImageChops.darker(g, b))
    hist = mn.histogram()
    return 100.0 * sum(hist[WHITE:]) / max(1, im.width * im.height)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dir", nargs="?", default=os.path.join(HERE, "..", "_shots"))
    ap.add_argument("--limit", type=float, default=2.0)
    args = ap.parse_args()

    pngs = sorted(f for f in os.listdir(args.dir)
                  if f.endswith(".png") and not f.startswith("_"))
    if not pngs:
        print(f"no .png files in {args.dir}")
        return 2

    bad = 0
    print(f"pure-white fraction (>= {WHITE} all channels), limit {args.limit}% per gameplay frame")
    for f in pngs:
        frac = white_fraction(os.path.join(args.dir, f))
        is_ui = any(m in f.lower() for m in UI_MARKERS)
        verdict = "ui" if is_ui else ("FAIL" if frac > args.limit else "ok")
        if verdict == "FAIL":
            bad += 1
        print(f"  {frac:6.2f}%  {verdict:<4}  {f}")
    print(f"\n  {bad} gameplay frame(s) over {args.limit}%")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
