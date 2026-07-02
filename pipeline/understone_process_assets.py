#!/usr/bin/env python3
"""understone_process_assets.py — post-process Grok-generated raw images into game assets.

Tiles/walls: 1024^2 -> 64x64 (LANCZOS) -> 16-color quantize -> RGB PNG (seamless 4x4 tile texture).
Sprites: magenta-keyed background -> transparent RGBA, content crop, resize to target height,
         light quantize to keep the pixel look.
Background: wide parallax layer, resized + quantized.

Usage: python pipeline/understone_process_assets.py [--only key1,key2]
Reads pipeline/understone_assets_manifest.json; raw from asset_gen/understone/raw/;
writes into games/understone/assets/.
"""
import argparse
import json
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "asset_gen" / "understone" / "raw"
OUT = ROOT / "games" / "understone" / "assets"
MANIFEST = Path(__file__).resolve().parent / "understone_assets_manifest.json"

# sprite target sizes (height px unless noted; width follows aspect)
SPRITE_TARGETS = {
    "sprite_player": 56,
    "sprite_slime": 22,
    "sprite_zombie": 52,
    "sprite_skeleton": 52,
    "sprite_eye": 26,
    "sprite_bat": 20,
    "sprite_imp": 46,
    "sprite_worm": 20,
    "sprite_eoc": 84,
    "sprite_kingslime": 96,
}


def process_tile(raw_path: Path, out_path: Path, size: int) -> None:
    img = Image.open(raw_path).convert("RGB")
    img = img.resize((size, size), Image.LANCZOS)
    img = img.quantize(colors=16, method=Image.MEDIANCUT).convert("RGB")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path)


def key_background(img: Image.Image, tol: int = 70) -> Image.Image:
    """Remove the solid background using the median of the 4 corner colors."""
    img = img.convert("RGBA")
    px = img.load()
    w, h = img.size
    corners = [px[2, 2], px[w - 3, 2], px[2, h - 3], px[w - 3, h - 3]]
    bg = tuple(sorted(c[i] for c in corners)[len(corners) // 2] for i in range(3))
    data = img.getdata()
    out = []
    for r, g, b, a in data:
        if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) < tol:
            out.append((0, 0, 0, 0))
        else:
            out.append((r, g, b, a))
    img.putdata(out)
    return img


def process_sprite(raw_path: Path, out_path: Path, target_h: int) -> None:
    img = key_background(Image.open(raw_path))
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
    ratio = target_h / img.height
    tw = max(1, round(img.width * ratio))
    img = img.resize((tw, target_h), Image.LANCZOS)
    # clean semi-transparent fringe
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, 255 if a > 110 else 0)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path)


def process_bg(raw_path: Path, out_path: Path) -> None:
    img = Image.open(raw_path).convert("RGB")
    img = img.resize((1024, 512), Image.LANCZOS)
    img = img.quantize(colors=32, method=Image.MEDIANCUT).convert("RGB")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=None)
    args = ap.parse_args()
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    only = set(args.only.split(",")) if args.only else None

    done, missing, failed = [], [], []
    for key, spec in manifest["assets"].items():
        if only and key not in only:
            continue
        raw = RAW / f"{key}.png"
        if not raw.exists():
            missing.append(key)
            continue
        out = OUT / spec["target"]
        try:
            if key.startswith("sprite_"):
                process_sprite(raw, out, SPRITE_TARGETS.get(key, 32))
            elif key.startswith("bg_"):
                process_bg(raw, out)
            else:
                process_tile(raw, out, spec.get("size", 64) or 64)
            done.append(key)
        except Exception as e:  # noqa: BLE001
            failed.append((key, str(e)))

    print(f"[process] ok={len(done)} missing_raw={len(missing)} failed={len(failed)}")
    for k in missing:
        print(f"  [missing] {k}")
    for k, e in failed:
        print(f"  [FAIL] {k}: {e}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
