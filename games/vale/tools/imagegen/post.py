#!/usr/bin/env python3
"""Turn raw generated images (tools/imagegen/raw/<id>.png) into shipped VALE assets.

    python tools/imagegen/post.py                 # process every raw image that has a manifest record
    python tools/imagegen/post.py --apply-refs    # …and point content refs at the new files
    python tools/imagegen/post.py --pick ability_x=2   # use raw/ability_x__2.png instead of the first variant
    python tools/imagegen/post.py --only concept_wick_   # only ids starting with this prefix (leave other outputs alone)

Per kind:  icon → 256² WebP (centre crop) · keyart/backdrop → flat letterbox bars trimmed, then cover-crop to
the record's size class (wide 1920×1080, landscape 1280×960, tile 1280×640 = the 16:8 Home tile frame,
portrait 768×1152) WebP · texture → square, made SEAMLESS by
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


def cover(img: Image.Image, w: int, h: int, anchor: tuple[float, float] = (0.5, 0.5)) -> Image.Image:
    """Scale to cover w x h and crop; anchor (0..1, 0..1) picks which part survives (0.5, 0.5 = centre)."""
    sw, sh = img.size
    s = max(w / sw, h / sh)
    img = img.resize((max(w, round(sw * s)), max(h, round(sh * s))), Image.LANCZOS)
    x, y = round((img.width - w) * anchor[0]), round((img.height - h) * anchor[1])
    return img.crop((x, y, x + w, y + h))


def trim_bars(img: Image.Image, tol: float = 7.0, min_frac: float = 0.02) -> Image.Image:
    """Cut flat letterbox / pillarbox bars that a generation sometimes paints round the picture (the reference
    edit endpoint copies a padded or strip-shaped reference frame). A bar is a run of near-uniform rows or
    columns touching the edge; runs thinner than min_frac of the side are left alone. Repeats until stable,
    so a grey frame inside a black band is peeled too."""
    for _ in range(4):
        a = np.asarray(img.convert("L")).astype(np.float32)
        h, w = a.shape
        rows, cols = a.std(axis=1), a.std(axis=0)

        def run(v: np.ndarray) -> int:
            n = 0
            while n < len(v) and v[n] < tol:
                n += 1
            return n
        t, b = run(rows), run(rows[::-1])
        l, r = run(cols), run(cols[::-1])
        t, b = (t if t >= h * min_frac else 0), (b if b >= h * min_frac else 0)
        l, r = (l if l >= w * min_frac else 0), (r if r >= w * min_frac else 0)
        if not (t or b or l or r):
            break
        img = img.crop((l, t, w - r, h - b))
    return img


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
    ap.add_argument("--kind", help="only this kind (icon | concept | keyart | backdrop | texture)")
    ap.add_argument("--only", help="only ids starting with this prefix (comma list allowed)")
    a = ap.parse_args()
    pf = HERE / "picks.json"
    picks = {k: str(v) for k, v in json.loads(pf.read_text(encoding="utf-8")).items() if not k.startswith("$")} if pf.exists() else {}
    picks.update(dict(p.split("=", 1) for p in a.pick))
    man = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    sizes = man["sizes"]
    done, swaps = 0, {}
    for it in man["items"]:
        if a.kind and it["kind"] != a.kind:
            continue
        if a.only and not any(it["id"].startswith(p) for p in a.only.split(",") if p):
            continue
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
            img = cover(trim_bars(img), w, h, tuple(it.get("anchor", (0.5, 0.5))))   # record "anchor": [x, y]
        elif k == "concept" and img.width > 2048:   # modelling reference: 2048 wide is plenty
            img = img.resize((2048, round(img.height * 2048 / img.width)), Image.LANCZOS)
        if out.suffix == ".webp":
            img.save(out, "WEBP", quality=88, method=6)
        else:
            img.save(out)
        done += 1
        if it.get("ref_from") and a.apply_refs:
            new_ref = "assets/" + it["out"].split("/", 1)[1] if it["out"].startswith("content/ui/") else None
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
