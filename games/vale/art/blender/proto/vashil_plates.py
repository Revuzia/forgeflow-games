#!/usr/bin/env python3
"""Vashil's projection plates: art/tools/concept_plates.py's output format with a cut made for this concept.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/vashil_plates.py [--height 2.10]

Why not the shared cut: Vashil is chalk-pale on a pale backdrop. The shared estimate (RGB distance > 22 to a
normalised-convolution backdrop) loses the hood's lit flank, the visor's top and the top of the left pauldron,
and fills the halo's whole inside (back view). Here the backdrop is a smooth cubic surface fitted to the
pixels far from the figure (residual < 3 RGB on the backdrop), so a threshold of 8 holds every painted edge;
small enclosed holes are filled, big ones (the halo's inside, the gaps beside the staff) stay backdrop.

The plate scale (`--height`) is the HALO TOP: the concept's ring top row is `top`. At 2.10 m the hood peak
stands at ~1.98 m (the brief's body height, 2.05 m with the cowl's crown) and the sole at 0.
`cx` is the mid-point between the boots (rows 6-14 % above the sole, segments wider than 40 px: the staff is
~25 px). The halo, its bells and the striker are painted in vashil.py (procedural, not projected), so their
plate pixels only need to be the figure's own colours.
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

THRESH = 8.0              # RGB distance to the fitted backdrop
HOLE_MAX = 6000           # px: enclosed holes smaller than this are paint (filled), bigger ones backdrop
ERODE = 4                 # px eroded off the cut (the soft paint edge; the shared script uses 9)
SHADOW_ROWS = 70
NEUTRAL = 0.05


def backdrop(im: np.ndarray, M0: np.ndarray) -> np.ndarray:
    H, W, _ = im.shape
    far = ~nd.binary_dilation(M0, iterations=40)
    yy, xx = np.mgrid[0:H, 0:W]
    u, v = xx.ravel() / W, yy.ravel() / H
    X = np.stack([np.ones(H * W), u, v, u * u, v * v, u * v, u ** 3, v ** 3, u * u * v, u * v * v], 1)
    sel = far.ravel()
    bg = np.zeros_like(im)
    for c in range(3):
        coef, *_ = np.linalg.lstsq(X[sel][::5], im[..., c].ravel()[sel][::5], rcond=None)
        bg[..., c] = (X @ coef).reshape(H, W)
    return bg


def figure_mask(im: np.ndarray) -> np.ndarray:
    M0 = cp.figure_mask(im)
    d = np.linalg.norm(im - backdrop(im, M0), axis=2)
    M = nd.binary_closing(nd.binary_opening(d > THRESH, iterations=1), iterations=3)
    filled = nd.binary_fill_holes(M)
    holes = filled & ~M
    lbl, n = nd.label(holes)
    if n:
        sizes = nd.sum(holes, lbl, range(1, n + 1))
        M = M | np.isin(lbl, np.nonzero(sizes < HOLE_MAX)[0] + 1)
    lbl, n = nd.label(M)
    sizes = nd.sum(M, lbl, range(1, n + 1))
    return np.isin(lbl, np.nonzero(sizes > 3000)[0] + 1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--height", type=float, default=2.10, help="the halo top (m)")
    a = ap.parse_args()
    fid = "vashil"
    out = ART / ".cache" / "concept"
    out.mkdir(parents=True, exist_ok=True)
    im = np.asarray(Image.open(GAME / "_design" / "concept" / f"{fid}.webp").convert("RGB")).astype(np.float32)
    H, W, _ = im.shape
    M = figure_mask(im)
    lum = im.mean(axis=2)
    mx, mn = im.max(axis=2), im.min(axis=2)
    neutral = (mx - mn) / np.maximum(mx, 1) < NEUTRAL
    meta = {"size": [W, H], "id": fid}
    halves = (("front", (0, W // 2)), ("back", (W // 2, W)))
    for side, (x0, x1) in halves:
        m = M[:, x0:x1]
        top = int(np.where(m.sum(1) > 12)[0][0])
        dark = (lum[:, x0:x1] < 70) & m
        ground = int(np.where(dark.sum(1) > 30)[0][-1])
        mids = []
        for r in range(ground - int(0.14 * (ground - top)), ground - int(0.06 * (ground - top))):
            lbl, n = nd.label(m[r])
            segs = [np.nonzero(lbl == j)[0] for j in range(1, n + 1)]
            legs = [c for c in segs if c[-1] - c[0] > 40]
            if len(legs) == 2:
                mids.append((legs[0][0] + legs[1][-1]) / 2)
            elif len(legs) == 1 and legs[0][-1] - legs[0][0] > 150:
                mids.append((legs[0][0] + legs[0][-1]) / 2)
        meta[side] = {"cx": float(x0 + np.median(mids)), "ground": ground, "top": top}
    keep = nd.binary_erosion(M, iterations=ERODE)
    for side, (x0, x1) in halves:
        g = meta[side]["ground"]
        keep[g + 1:, x0:x1] = False
        band = slice(g - SHADOW_ROWS, g + 1)
        keep[band, x0:x1] &= ~(neutral[band, x0:x1] & (lum[band, x0:x1] > 120))       # the floor shadow
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
