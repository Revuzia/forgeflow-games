#!/usr/bin/env python3
"""Build a roster reference board for key art: the real Blender fighters (or one of their skins), cropped
from art/out/fighters/<id>/splash.png and laid side by side, so the painted figures stay on-model.

    python3 tools/imagegen/ref_board.py ervet ardit burdam            # -> raw/refs/ervet+ardit+burdam.jpg
    python3 tools/imagegen/ref_board.py ardit:chalkline marund        # a skin: ardit_chalkline_splash.png
    python3 tools/imagegen/ref_board.py marund tunlan ervet vashil --aspect=4:3   # grid nearest 4:3 (no padding)

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


def board(roster: list[str], aspect: str | None = None, pad: bool = False) -> Path:
    """One reference image with every roster model. With aspect ("16:9", "4:3", "2:3" ...) the cells are laid
    out in the grid closest to that shape (a long strip tends to come back as a letterboxed painting). Do not
    pad by default: the edit endpoint reproduces flat padding as a grey or black frame round the painting
    (seen 2026-10-28 on ranked/rift/thumbnail); post.py trims any bars that still appear."""
    OUT.mkdir(parents=True, exist_ok=True)
    tag = "" if not aspect else "@" + aspect.replace(":", "x") + ("p" if pad else "")
    out = OUT / ("+".join(e.replace(":", "_") for e in roster) + tag + ".jpg")
    srcs = [splash(e) for e in roster]
    if out.exists() and all(out.stat().st_mtime >= s.stat().st_mtime for s in srcs):
        return out
    w, h = CELL
    n = len(srcs)
    target = None
    if aspect:
        a, b = (float(v) for v in aspect.split(":"))
        target = a / b
    cols = n if target is None else min(range(1, n + 1), key=lambda c: abs((c * w) / (-(-n // c) * h) - target))
    rows = -(-n // cols)
    gw, gh = cols * w, rows * h
    bw, bh = gw, gh
    if target is not None and pad:
        bw, bh = (max(gw, round(gh * target)), gh) if gw / gh < target else (gw, max(gh, round(gw / target)))
    im = Image.new("RGB", (bw, bh), (196, 198, 202))
    ox, oy = (bw - gw) // 2, (bh - gh) // 2
    for k, s in enumerate(srcs):
        cell = Image.open(s).convert("RGB")
        if cell.size != (1600, 900):
            cell = cell.resize((1600, 900), Image.LANCZOS)
        r, c = divmod(k, cols)
        # centre a short last row
        left = (cols - (n - r * cols)) * w // 2 if r == rows - 1 else 0
        im.paste(cell.crop(CROP).resize((w, h), Image.LANCZOS), (ox + left + c * w, oy + r * h))
    im.save(out, "JPEG", quality=90)
    return out


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    args = [a for a in sys.argv[1:] if not a.startswith("--aspect=")]
    asp = next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--aspect=")), None)
    print(board(args, asp))
