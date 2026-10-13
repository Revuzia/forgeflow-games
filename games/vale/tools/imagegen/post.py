#!/usr/bin/env python3
"""Turn raw generated images (tools/imagegen/raw/<id>.png) into shipped VALE assets.

    python tools/imagegen/post.py                 # process every raw image that has a manifest record
    python tools/imagegen/post.py --apply-refs    # …and point content refs at the new files
    python tools/imagegen/post.py --pick ability_x=2   # use raw/ability_x__2.png instead of the first variant

Per kind:  icon → 256² WebP (centre crop) · keyart/backdrop → cover-crop to the record's size class
(wide 1920×1080, landscape 1280×960, portrait 768×1152) WebP · texture → square, made SEAMLESS by
an offset-and-feather pass, 1024² WebP · concept → PNG copy for the modellers. Requires Pillow + numpy.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
VALE = HERE.parent.parent
RAW = HERE / "raw"


def cover(img: Image.Image, w: int, h: int) -> Image.Image:
    sw, sh = img.size
    s = max(w / sw, h / sh)
    img = img.resize((max(w, round(sw * s)), max(h, round(sh * s))), Image.LANCZOS)
    x, y = (img.width - w) // 2, (img.height - h) // 2
    return img.crop((x, y, x + w, y + h))


def seamless(img: Image.Image) -> Image.Image:
    """Offset by half and feather the cross seam with the original, so the texture tiles."""
    a = np.asarray(img.convert("RGB")).astype(np.float32)
    h, w, _ = a.shape
    b = np.roll(np.roll(a, h // 2, 0), w // 2, 1)
    yy, xx = np.mgrid[0:h, 0:w]
    dx = np.abs(xx - w / 2) / (w / 2)
    dy = np.abs(yy - h / 2) / (h / 2)
    # weight of the rolled copy: high near the original's borders (where the rolled seam is in the centre)
    m = np.clip(np.maximum(dx, dy) * 1.6 - 0.6, 0, 1)[..., None]
    out = a * (1 - m) + b * m
    return Image.fromarray(out.clip(0, 255).astype(np.uint8))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply-refs", action="store_true")
    ap.add_argument("--pick", action="append", default=[], help="id=variant")
    a = ap.parse_args()
    picks = dict(p.split("=", 1) for p in a.pick)
    man = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    sizes = man["sizes"]
    done, swaps = 0, {}
    for it in man["items"]:
        v = picks.get(it["id"])
        src = RAW / (f"{it['id']}__{v}.png" if v and v != "1" else f"{it['id']}.png")
        if not src.exists():
            continue
        img = Image.open(src).convert("RGB")
        out = VALE / it["out"]
        out.parent.mkdir(parents=True, exist_ok=True)
        k = it["kind"]
        if k == "icon":
            img = cover(img, 256, 256)
        elif k == "texture":
            img = seamless(cover(img, 1024, 1024))
        elif k in ("keyart", "backdrop"):
            w, h = sizes[it["size"]]
            img = cover(img, w, h)
        if out.suffix == ".webp":
            img.save(out, "WEBP", quality=88, method=6)
        else:
            img.save(out)
        done += 1
        if it.get("ref_from") and a.apply_refs:
            new_ref = "assets/" + it["out"].split("/", 2)[2] if it["out"].startswith("content/ui/") else None
            if new_ref and new_ref != it["ref_from"]:
                swaps[it["ref_from"]] = new_ref
    print(f"processed {done} images")
    if a.apply_refs and swaps:
        n = 0
        for f in list((VALE / "content").rglob("*.json")):
            t = f.read_text(encoding="utf-8")
            t2 = t
            for old, new in swaps.items():
                t2 = re.sub(r'"' + re.escape(old) + r'"', '"' + new + '"', t2)
            if t2 != t:
                f.write_text(t2, encoding="utf-8")
                n += 1
        print(f"refs updated in {n} content files ({len(swaps)} refs). Run: node tools/build_content.ts --check")


if __name__ == "__main__":
    main()
