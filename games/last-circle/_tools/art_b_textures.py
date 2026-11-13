#!/usr/bin/env python3
"""art_b_textures.py - Last Circle ground / road texture intake (dev-only; _tools/ never ships).

Poly Haven CC0 diffuse maps (F:/games/forgeflow-games-assets/_downloaded/polyhaven-textures/<name>/diffuse.jpg,
2048 px) -> assets/tex/<out>.jpg at 1024 px.

Why a wrap-aware resize: Poly Haven textures are seamless tiles. A plain resize clamps at the border and puts a faint
seam on every repeat, so the image is padded with PAD px of its own wrapped content, resized, and the pad cropped.
`--check` reports the seam metric: mean |col[0]-col[W-1]| over mean |col[i]-col[i+1]| (about 1.0 = seamless).

No normal maps: the sets on disk carry diffuse / ao / displacement / rough only (no normal map), and a normal map
derived from displacement would be a guess that costs MB. The sources have no alpha. Colour is NOT altered (the town
code tints through material.color), so the files stay faithful to the CC0 source.

USAGE   python games/last-circle/_tools/art_b_textures.py [--check]
Exit codes: 0 ok, 1 an assertion failed (size cap / seam), 2 environment problem (source missing).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
GAME = HERE.parent
SRC = Path("F:/games/forgeflow-games-assets/_downloaded/polyhaven-textures")
OUT = GAME / "assets" / "tex"

SIZE = 1024
PAD = 32          # source-pixel pad (2048 source -> 16 px at 1024)
QUALITY = 80
PER_FILE_CAP = 400 * 1024     # a single JPG over 400 KB is refused

# out name -> (poly haven set, what it is for)
MAP = {
    "road_asphalt": ("aerial_asphalt_01", "road surface (neutral grey, faint tyre wear; tint darker through material.color)"),
    "sidewalk_concrete": ("asphalt_04", "sidewalk / plaza concrete (light grey, low contrast)"),
    "ground_grass_rock": ("aerial_grass_rock", "savanna / meadow ground: dry grass + rock"),
    "ground_beach": ("aerial_beach_01", "beach sand (pale, fine ripples)"),
    "ground_sand": ("aerial_sand", "dry sand / dirt lots (warm, with faint tracks)"),
}


def wrap_resize(path: Path, size: int, pad: int) -> Image.Image:
    im = Image.open(path).convert("RGB")
    a = np.asarray(im)
    h, w = a.shape[:2]
    ap = np.pad(a, ((pad, pad), (pad, pad), (0, 0)), mode="wrap")
    big = Image.fromarray(ap)
    k = size / w
    pw, ph = round((w + 2 * pad) * k), round((h + 2 * pad) * k)
    big = big.resize((pw, ph), Image.LANCZOS)
    off = round(pad * k)
    return big.crop((off, off, off + size, off + size))


def seam_ratio(a: np.ndarray) -> tuple[float, float]:
    a = a.astype(np.float32)
    inner_x = np.abs(a[:, 1:] - a[:, :-1]).mean()
    inner_y = np.abs(a[1:] - a[:-1]).mean()
    edge_x = np.abs(a[:, 0] - a[:, -1]).mean()
    edge_y = np.abs(a[0] - a[-1]).mean()
    return float(edge_x / max(inner_x, 1e-6)), float(edge_y / max(inner_y, 1e-6))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="only verify what is on disk")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    bad = 0
    total = 0
    for out, (name, why) in MAP.items():
        dst = OUT / f"{out}.jpg"
        if not args.check:
            src = SRC / name / "diffuse.jpg"
            if not src.exists():
                print(f"MISSING source {src}")
                return 2
            im = wrap_resize(src, SIZE, PAD)
            im.save(dst, "JPEG", quality=QUALITY, optimize=True, progressive=True, subsampling=2)
        if not dst.exists():
            print(f"FAIL {out}: not on disk")
            bad += 1
            continue
        im = Image.open(dst)
        a = np.asarray(im.convert("RGB"))
        sx, sy = seam_ratio(a)
        size = dst.stat().st_size
        total += size
        mean = a.reshape(-1, 3).mean(0).round(0).astype(int).tolist()
        ok = im.size == (SIZE, SIZE) and size <= PER_FILE_CAP and sx < 2.5 and sy < 2.5
        bad += 0 if ok else 1
        print(f"{'ok  ' if ok else 'FAIL'} {out:18s} <- {name:18s} {im.size[0]}x{im.size[1]} {size:7d} B  seam x{sx:.2f} y{sy:.2f}  mean RGB {mean}")
    print(f"total {total} B ({total / 1048576:.2f} MB) in {len(MAP)} files")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
