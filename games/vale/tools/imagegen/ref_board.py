#!/usr/bin/env python3
"""Build a roster reference board for key art: the real Blender fighters (or one of their skins), cropped
from art/out/fighters/<id>/splash.png and laid side by side, so the painted figures stay on-model.

    python3 tools/imagegen/ref_board.py ervet ardit burdam            # -> raw/refs/ervet+ardit+burdam.jpg
    python3 tools/imagegen/ref_board.py ardit:chalkline marund        # a skin: ardit_chalkline_splash.png

run_xai.py calls board() itself for any manifest record with a "roster" list, so this CLI is only for
looking at a board. Boards are build products (tools/imagegen/raw/ is git-ignored).
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
VALE = HERE.parent.parent
OUT = HERE / "raw" / "refs"
CROP = (700, 40, 1500, 900)   # every splash frames its fighter in this window (1600x900 renders)
CELL = (560, 602)


def splash(entry: str) -> Path:
    fid, _, skin = entry.partition(":")
    d = VALE / "art" / "out" / "fighters" / fid
    p = d / (f"{fid}_{skin}_splash.png" if skin else "splash.png")
    if not p.exists():
        raise SystemExit(f"no splash for {entry}: {p}")
    return p


def board(roster: list[str]) -> Path:
    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / ("+".join(e.replace(":", "_") for e in roster) + ".jpg")
    srcs = [splash(e) for e in roster]
    if out.exists() and all(out.stat().st_mtime >= s.stat().st_mtime for s in srcs):
        return out
    w, h = CELL
    im = Image.new("RGB", (w * len(srcs), h), (200, 200, 200))
    for k, s in enumerate(srcs):
        cell = Image.open(s).convert("RGB")
        if cell.size != (1600, 900):
            cell = cell.resize((1600, 900), Image.LANCZOS)
        im.paste(cell.crop(CROP).resize((w, h), Image.LANCZOS), (k * w, 0))
    im.save(out, "JPEG", quality=90)
    return out


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    print(board(sys.argv[1:]))
