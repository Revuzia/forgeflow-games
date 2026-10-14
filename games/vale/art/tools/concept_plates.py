#!/usr/bin/env python3
"""ART 2.0: turn a front/back concept sheet (_design/concept/<id>.webp) into PROJECTION PLATES.

    python3 art/tools/concept_plates.py marund [--erode 9]

The two figures (front on the left half, back on the right) are cut from the painted background
(normalised-convolution background estimate, iterated), the white outline halo is eroded off, and
every background pixel takes the colour of the nearest figure pixel (edge padding), so a model edge
that overhangs the painted silhouette by a few pixels still picks up figure colour. Writes
art/.cache/concept/<id>_{front,back}.png (padded RGB), <id>_mask.png and <id>_plates.json:
{ "size": [W, H], "front": {"cx", "ground", "top"}, "back": {...}, "m_per_px" } where `ground` is the
boot-sole row and `top` the crown row of each figure. Needs numpy, Pillow, scipy (the repo venv).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as nd

HERE = Path(__file__).resolve().parent
ART = HERE.parent
GAME = ART.parent


def figure_mask(im: np.ndarray, thresh: float = 22.0, iters: int = 4) -> np.ndarray:
    H, W, _ = im.shape
    border = np.concatenate([im[:, :40], im[:, -40:]], axis=1).mean(axis=1)
    bg = np.repeat(border[:, None, :], W, axis=1)
    M = np.linalg.norm(im - bg, axis=2) > 26
    M = nd.binary_dilation(M, iterations=25)
    for it in range(iters):
        w = (~M).astype(np.float32)
        num = np.stack([nd.gaussian_filter(im[..., c] * w, 50) for c in range(3)], -1)
        den = nd.gaussian_filter(w, 50)[..., None] + 1e-6
        d = np.linalg.norm(im - num / den, axis=2)
        M = nd.binary_fill_holes(nd.binary_opening(d > thresh, iterations=2))
        lbl, n = nd.label(M)
        sizes = nd.sum(M, lbl, range(1, n + 1))
        M = np.isin(lbl, np.argsort(sizes)[::-1][:2] + 1)
        if it < iters - 1:
            M = nd.binary_dilation(M, iterations=12)
    return M


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("id")
    ap.add_argument("--erode", type=int, default=9, help="px eroded off the silhouette (outline halo)")
    ap.add_argument("--height", type=float, default=None, help="model height in m (crown to sole)")
    ap.add_argument("--erase-saturated-above", type=float, default=None, metavar="M",
                    help="paint out saturated details (painted gems, inlays the model builds as geometry) above this height (m)")
    a = ap.parse_args()
    src = GAME / "_design" / "concept" / f"{a.id}.webp"
    out = ART / ".cache" / "concept"
    out.mkdir(parents=True, exist_ok=True)
    im = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
    H, W, _ = im.shape
    M = figure_mask(im)
    # the floor shadow is part of the cut: the sole row is where the figure is widest-then-narrow at the
    # bottom; take the lowest row whose dark (boot) pixels are present instead
    lum = im.mean(axis=2)
    meta = {"size": [W, H], "id": a.id}
    core = nd.binary_erosion(M, iterations=a.erode)
    for side, (x0, x1) in (("front", (0, W // 2)), ("back", (W // 2, W))):
        m = M[:, x0:x1]
        # crown: the first row of the eroded cut that is not the pale outline halo
        halo = (lum[:, x0:x1] > 238)
        crows = np.where((core[:, x0:x1] & ~halo).sum(1) > 12)[0]
        top = int(crows[0])
        # sole: the last row with a run of very dark (boot) pixels; the floor shadow is lighter
        dark = (lum[:, x0:x1] < 60) & m
        drows = np.where(dark.sum(1) > 30)[0]
        ground = int(drows[-1])
        # centre: mean of the leg columns in the lower fifth (symmetric stance)
        band = m[ground - (ground - top) // 5: ground - 10]
        cols = np.where(band.any(0))[0]
        cx = float(x0 + (cols[0] + cols[-1]) / 2)
        meta[side] = {"cx": cx, "ground": ground, "top": top}
    keep = nd.binary_erosion(M, iterations=a.erode)
    # trim the floor shadow: nothing below the sole row, and near the soles only the dark boot pixels
    # (the cast shadow is a pale grey ellipse; boots are dark)
    for side, (x0, x1) in (("front", (0, W // 2)), ("back", (W // 2, W))):
        g = meta[side]["ground"]
        keep[g + 1:, x0:x1] = False
        band = slice(g - 90, g + 1)
        boot = nd.binary_opening(lum[band, x0:x1] < 105, iterations=2)
        boot = nd.binary_closing(boot, iterations=6)
        keep[band, x0:x1] &= boot
        # below the hem line (lowest ~19% of the figure) the figure is dark; pale pixels there are the
        # background seen between the legs (closed off by the floor shadow before the trim)
        legs = slice(g - int(0.19 * (g - meta[side]["top"])), g + 1)
        keep[legs, x0:x1] &= ~(lum[legs, x0:x1] > 175)
        keep[:, x0:x1] = nd.binary_opening(keep[:, x0:x1], iterations=2)
    erased = np.zeros_like(keep)
    if a.erase_saturated_above is not None and a.height:
        # erased pixels leave `keep`, so the edge padding refills them from the surrounding paint
        mx, mn = im.max(axis=2), im.min(axis=2)
        sat = (mx - mn) / np.maximum(mx, 1)
        for side, (x0, x1) in (("front", (0, W // 2)), ("back", (W // 2, W))):
            g, t = meta[side]["ground"], meta[side]["top"]
            row = int(g - a.erase_saturated_above / a.height * (g - t))
            er = np.zeros_like(keep)
            sub = im[:row, x0:x1]
            gold = (((sat[:row, x0:x1] > 0.5) & (mx[:row, x0:x1] > 150)) | ((sat[:row, x0:x1] > 0.58) & (mx[:row, x0:x1] > 70))) \
                & (sub[..., 0] > sub[..., 2] + 50)
            blue = (sub[..., 2] > sub[..., 0] + 35) & (sat[:row, x0:x1] > 0.35)
            er[:row, x0:x1] = gold | blue
            er = nd.binary_fill_holes(nd.binary_closing(nd.binary_opening(er, iterations=1), iterations=4))
            er = nd.binary_dilation(er, iterations=9)
            keep &= ~er
            erased |= er
    _, (iy, ix) = nd.distance_transform_edt(~keep, return_indices=True)
    padded = im[iy, ix]
    # soften the padded field so seams on stretched sides (and refilled details) are not streaky
    soft = np.stack([nd.gaussian_filter(padded[..., c], 5) for c in range(3)], -1)
    padded = np.where(keep[..., None], im, soft)
    if erased.any():
        # refill erased details from the surrounding LIGHT paint only (the shell they sat in), never from
        # the dark bands or the background: nearest light pixel, then a wide soft blend
        src = keep & (lum > 150)
        _, (jy, jx) = nd.distance_transform_edt(~src, return_indices=True)
        fill = im[jy, jx]
        fill = np.stack([nd.gaussian_filter(fill[..., c], 9) for c in range(3)], -1)
        hole = erased & M
        a_ = nd.gaussian_filter(hole.astype(np.float32), 3)[..., None]
        padded = padded * (1 - a_) + fill * a_
    for side, (x0, x1) in (("front", (0, W // 2)), ("back", (W // 2, W))):
        Image.fromarray(padded.clip(0, 255).astype(np.uint8)).save(out / f"{a.id}_{side}.png")
    Image.fromarray((keep * 255).astype(np.uint8)).save(out / f"{a.id}_mask.png")
    hf = meta["front"]["ground"] - meta["front"]["top"]
    meta["m_per_px"] = (a.height / hf) if a.height else None
    (out / f"{a.id}_plates.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta))


if __name__ == "__main__":
    main()
