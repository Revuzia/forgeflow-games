#!/usr/bin/env python3
"""Ardit's projection plates: art/tools/concept_plates.py with the fixes this sheet needs.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/ardit_plates.py [--height 2.35]

Plate height 2.35 m = the box helm's flat crown (the shared crown row; the spear tip at ~2.48 m is too thin to
count). Fixes over the shared cut (its figure estimate, edge padding and output format are reused):
  * THE GAP BETWEEN THE LEGS: the floor shadow closes the space under the tabard hem, so the shared cut keeps
    the pale backdrop there as figure (rows ~1080-1190 in both views). The backdrop is a smooth, near-neutral,
    pale grey; in the leg band (below the coat hem) such pixels in connected areas larger than MIN_AREA leave the
    figure. The tabard's pale back flap (warm, folded paint) stays: it is not smooth.
  * the same backdrop rule round the spear arm, the spear and the pavise's lower edge (pale, smooth, neutral
    regions connected to the outside background are not paint).
  * the floor-shadow trim: the shared trim keeps only dark pixels in the lowest 90 rows, which cuts a seam across
    both boots at their pale highlight band; here the trim drops only near-neutral pale pixels (shadow/backdrop).
Writes art/.cache/concept/ardit_{front,back}.png, ardit_mask.png, ardit_plates.json (+ ardit_plates_debug.png).
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

ID = "ardit"
MIN_AREA = 600          # px: smaller pale smooth islands are paint (glass glints, cloth highlights)
SMOOTH = 5.0            # local std (RGB mean, 4 px window) below which a pixel is "smooth" (backdrop)
NEUTRAL = 0.06          # saturation below which a pale pixel can be backdrop
PALE = 168.0            # luminance above which ...
HEM_FRAC = 0.42         # the leg band: the lowest 42 % of the figure (below the coat's hem)
LEG_GAP = 0.20          # m: the gap islands' centres lie this close to the body's mid line


def local_std(im: np.ndarray, r: int = 4) -> np.ndarray:
    g = im.mean(axis=2)
    m = nd.uniform_filter(g, 2 * r + 1)
    m2 = nd.uniform_filter(g * g, 2 * r + 1)
    return np.sqrt(np.maximum(m2 - m * m, 0))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--height", type=float, default=2.35)
    ap.add_argument("--erode", type=int, default=7)
    a = ap.parse_args()
    src = GAME / "_design" / "concept" / f"{ID}.webp"
    out = ART / ".cache" / "concept"
    out.mkdir(parents=True, exist_ok=True)
    im = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
    H, W, _ = im.shape
    M = cp.figure_mask(im)
    lum = im.mean(axis=2)
    mx, mn = im.max(axis=2), im.min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1)
    std = local_std(im)
    meta = {"size": [W, H], "id": ID}
    core = nd.binary_erosion(M, iterations=a.erode)
    for side, (x0, x1) in (("front", (0, W // 2)), ("back", (W // 2, W))):
        m = M[:, x0:x1]
        halo = lum[:, x0:x1] > 238
        crows = np.where((core[:, x0:x1] & ~halo).sum(1) > 12)[0]
        top = int(crows[0])
        dark = (lum[:, x0:x1] < 60) & m
        drows = np.where(dark.sum(1) > 30)[0]
        ground = int(drows[-1])
        # centre: the mid line between the two boot shafts (rows g-25 %..g-12 %, segments wider than 60 px)
        segs = []
        for r in range(ground - (ground - top) // 4, ground - (ground - top) // 8, 4):
            row = (lum[r, x0:x1] < 110) & m[r]
            lbl, n = nd.label(row)
            ss = [np.where(lbl == i)[0] for i in range(1, n + 1)]
            ss = [s for s in ss if len(s) > 60]
            if len(ss) >= 2:
                ss = sorted(ss, key=len)[-2:]
                c = sorted([(s[0] + s[-1]) / 2 for s in ss])
                segs.append((c[0] + c[1]) / 2)
        cx = float(x0 + np.median(segs))
        meta[side] = {"cx": cx, "ground": ground, "top": top}
    keep = M.copy()
    gone = np.zeros_like(keep)
    for side, (x0, x1) in (("front", (0, W // 2)), ("back", (W // 2, W))):
        g, t = meta[side]["ground"], meta[side]["top"]
        sl = (slice(0, H), slice(x0, x1))
        bgish = (lum[sl] > PALE) & (sat[sl] < NEUTRAL) & (std[sl] < SMOOTH)
        bgish = nd.binary_opening(bgish, iterations=2)
        lbl, n = nd.label(bgish)
        if n:
            sizes = nd.sum(bgish, lbl, range(1, n + 1))
            rows = nd.minimum_position(lbl, lbl, range(1, n + 1))
            drop = np.zeros(n + 1, dtype=bool)
            leg_row = g - int(HEM_FRAC * (g - t))
            cxl = meta[side]["cx"] - x0
            k = (g - t) / a.height
            cols = nd.center_of_mass(bgish, lbl, range(1, n + 1))
            for i in range(n):
                # leg band, between the legs (|x| < LEG_GAP m: never the glass pane beside them): any big smooth
                # backdrop island; elsewhere only islands touching the cut's outside
                if sizes[i] >= MIN_AREA and rows[i][0] >= leg_row and abs(cols[i][1] - cxl) < LEG_GAP * k:
                    drop[i + 1] = True
            outside = ~M[sl]
            touch = np.unique(lbl[nd.binary_dilation(outside, iterations=3) & (lbl > 0)])
            for i in touch:
                if sizes[i - 1] >= MIN_AREA:
                    drop[i] = True
            d = drop[lbl]
            d = nd.binary_dilation(d, iterations=2) & keep[sl]
            keep[sl] &= ~d
            gone[sl] |= d
    keep = nd.binary_erosion(keep, iterations=a.erode)
    for side, (x0, x1) in (("front", (0, W // 2)), ("back", (W // 2, W))):
        g = meta[side]["ground"]
        keep[g + 1:, x0:x1] = False
        band = slice(g - 90, g + 1)
        shadow = (lum[band, x0:x1] > 120) & (sat[band, x0:x1] < 0.08)
        keep[band, x0:x1] &= ~shadow
        sub = nd.binary_closing(keep[band, x0:x1], iterations=3)
        keep[band, x0:x1] = sub & ~shadow
        keep[:, x0:x1] = nd.binary_opening(keep[:, x0:x1], iterations=2)
    _, (iy, ix) = nd.distance_transform_edt(~keep, return_indices=True)
    padded = im[iy, ix]
    soft = np.stack([nd.gaussian_filter(padded[..., c], 5) for c in range(3)], -1)
    padded = np.where(keep[..., None], im, soft)
    for side in ("front", "back"):
        Image.fromarray(padded.clip(0, 255).astype(np.uint8)).save(out / f"{ID}_{side}.png")
    Image.fromarray((keep * 255).astype(np.uint8)).save(out / f"{ID}_mask.png")
    dbg = im.copy()
    dbg[~keep] = dbg[~keep] * 0.35 + np.array([255, 0, 0]) * 0.65
    dbg[gone] = dbg[gone] * 0.3 + np.array([0, 255, 0]) * 0.7
    Image.fromarray(dbg.astype(np.uint8)).resize((W // 2, H // 2)).save(out / f"{ID}_plates_debug.png")
    hf = meta["front"]["ground"] - meta["front"]["top"]
    meta["m_per_px"] = a.height / hf
    (out / f"{ID}_plates.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta))


if __name__ == "__main__":
    main()
