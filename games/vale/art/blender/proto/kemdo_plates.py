#!/usr/bin/env python3
"""Kemdo's projection plates: art/tools/concept_plates.py with fixes for this concept.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/kemdo_plates.py --height 2.38

The plate height is the glaive tip (the tallest painted part): the hood crown is 2.10 m (content art.height)
at eroded-mask row 232, the sole row 1455 and the glaive tip row 70, so the tip stands at
2.10 * (1455 - 70) / (1455 - 232) = 2.38 m.

Fixes over the shared script (its figure cut, edge padding and output format are reused):
1. Pale backdrop kept inside the cut: the shared estimate walls in the gaps between the glaive and the robe,
   between the left arm and the robe and between the knees (closed by the haft and the floor shadow). Those
   gaps are the flat grey backdrop: big connected areas within 10 (RGB distance) of the row's border colour.
   They leave the figure; small specks of the same grey (the lens highlight, linen catch-lights) stay.
2. The floor-shadow trim: the shared script keeps only dark boot pixels in the lowest 90 rows, which cuts a
   line through both boots at the pale boot-top strap (87 px up) and eats the glaive's pale lower blade. The
   cast shadow and the backdrop are NEUTRAL grey (saturation < 0.02); the blade is warm. Here the trim band
   is the lowest 75 rows and it, and the pale cut between the legs, only drop neutral pixels.
3. The plate frame: the shared centre (mean of the lower fifth) includes the glaive's lower blade, which
   puts cx 30 px (5 cm) left of the body in both views; here cx is the midpoint between the legs (rows
   g-20 %..g-12 %, segments wider than 45 px: the haft is ~25 px), which also splits the hood. The front
   view's turned-out left toe is drawn 18 px below the heels (the painter's slightly high eye point), so
   the shared sole row (1455) shrinks the front scale 1.3 % against the back; the front sole is the heels'
   row (the last row with both feet dark), 1438: hood crown 2.10 m in both views.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as nd

HERE = Path(__file__).resolve().parent
ART = HERE.parent.parent
GAME = ART.parent
sys.path.insert(0, str(ART / "tools"))
import concept_plates as cp  # noqa: E402

BG_DIST = 10.0            # RGB distance to the row's border colour that counts as backdrop
MIN_AREA = 1500           # px: smaller backdrop-grey islands are paint (highlights), not gaps
SHADOW_ROWS = 75          # the floor-shadow trim band above the sole row
NEUTRAL = 0.04            # saturation below which a pale/mid pixel near the floor is shadow or backdrop


def figure_mask(im: np.ndarray) -> np.ndarray:
    M = cp.figure_mask(im)
    border = np.concatenate([im[:, :40], im[:, -40:]], axis=1).mean(axis=1)
    d = np.linalg.norm(im - border[:, None, :], axis=2)
    bg = nd.binary_opening((d < BG_DIST) & M, iterations=1)
    lbl, n = nd.label(bg)
    if n:
        sizes = nd.sum(bg, lbl, range(1, n + 1))
        big = np.isin(lbl, np.nonzero(sizes >= MIN_AREA)[0] + 1)
        M = M & ~nd.binary_dilation(big, iterations=3)       # with the soft paint edge round each gap
    lbl, n = nd.label(M)
    sizes = nd.sum(M, lbl, range(1, n + 1))
    return np.isin(lbl, np.argsort(sizes)[::-1][:2] + 1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--erode", type=int, default=9)
    ap.add_argument("--height", type=float, default=2.38)
    a = ap.parse_args()
    fid = "kemdo"
    src = GAME / "_design" / "concept" / f"{fid}.webp"
    out = ART / ".cache" / "concept"
    out.mkdir(parents=True, exist_ok=True)
    im = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
    H, W, _ = im.shape
    M = figure_mask(im)
    lum = im.mean(axis=2)
    mx, mn = im.max(axis=2), im.min(axis=2)
    neutral = (mx - mn) / np.maximum(mx, 1) < NEUTRAL
    meta = {"size": [W, H], "id": fid}
    core = nd.binary_erosion(M, iterations=a.erode)
    halves = (("front", (0, W // 2)), ("back", (W // 2, W)))
    for side, (x0, x1) in halves:
        halo = lum[:, x0:x1] > 238
        crows = np.where((core[:, x0:x1] & ~halo).sum(1) > 12)[0]
        top = int(crows[0])
        dark = (lum[:, x0:x1] < 60) & M[:, x0:x1]
        ground = int(np.where(dark.sum(1) > 30)[0][-1])
        for r in range(ground, top, -1):                  # both feet: the heels' sole row
            lbl, n = nd.label(dark[r])
            if n >= 2 and (np.sort(nd.sum(dark[r], lbl, range(1, n + 1)))[-2] >= 20):
                ground = r
                break
        mids = []
        for r in range(ground - (ground - top) // 5, ground - int(0.12 * (ground - top))):
            lbl, n = nd.label(M[r, x0:x1])
            segs = [np.nonzero(lbl == j)[0] for j in range(1, n + 1)]
            legs = [c for c in segs if c[-1] - c[0] > 45]
            if len(legs) == 2:
                mids.append((legs[0][0] + legs[1][-1]) / 2)
        meta[side] = {"cx": float(x0 + np.median(mids)), "ground": ground, "top": top}
    keep = core.copy()
    for side, (x0, x1) in halves:
        g, t = meta[side]["ground"], meta[side]["top"]
        keep[g + 1:, x0:x1] = False
        band = slice(g - SHADOW_ROWS, g + 1)
        boot = nd.binary_opening(lum[band, x0:x1] < 105, iterations=2)
        boot = nd.binary_closing(boot, iterations=6) | ~neutral[band, x0:x1]
        keep[band, x0:x1] &= boot
        legs = slice(g - int(0.19 * (g - t)), g + 1)
        keep[legs, x0:x1] &= ~((lum[legs, x0:x1] > 175) & neutral[legs, x0:x1])
        keep[:, x0:x1] = nd.binary_opening(keep[:, x0:x1], iterations=2)
    _, (iy, ix) = nd.distance_transform_edt(~keep, return_indices=True)
    padded = im[iy, ix]
    soft = np.stack([nd.gaussian_filter(padded[..., c], 5) for c in range(3)], -1)
    padded = np.where(keep[..., None], im, soft)
    for side, _ in halves:
        Image.fromarray(padded.clip(0, 255).astype(np.uint8)).save(out / f"{fid}_{side}.png")
    Image.fromarray((keep * 255).astype(np.uint8)).save(out / f"{fid}_mask.png")
    meta["m_per_px"] = a.height / (meta["front"]["ground"] - meta["front"]["top"])
    (out / f"{fid}_plates.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta))


if __name__ == "__main__":
    main()
