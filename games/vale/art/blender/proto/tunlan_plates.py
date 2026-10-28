#!/usr/bin/env python3
"""Tunlan's projection plates: art/tools/concept_plates.py's frame and padding with this sheet's own cut.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/tunlan_plates.py

The sheet is clean (a flat vertical backdrop gradient, no outline halo, no floor shadow), but the shared cut
(normalised-convolution background) fails it twice: the pale lacquered hat top on the front figure is cut as
background in big patches (its highlights sit near the blurred backdrop estimate), and the shared floor trim
slices a line through both pairs of boots. Here the cut is the plain distance to each ROW's border colour (the
backdrop is a vertical gradient): every pixel further than BG_DIST from it is figure, holes are filled (the pale
mask, the hat top), the backdrop between the legs and between the arms and the robe stays background (it is
connected to the outside), and the two largest components are the figures. ERODE px come off the edge (the
anti-aliased rim). Padding as the shared script (nearest figure pixel, softened).

Writes art/.cache/concept/tunlan_{front,back}.png (edge-padded RGB), tunlan_mask.png, tunlan_plates.json and a
debug overlay art/renders/fighters/tunlan/_fit/plates_mask.png (backdrop tinted red).
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as nd

HERE = Path(__file__).resolve().parent
ART = HERE.parent.parent
GAME = ART.parent

ID = "tunlan"
HEIGHT = 2.05             # the hat's crown (content art.height reference)
BG_DIST = 13.0            # RGB distance to the row's border colour above which a pixel is figure
ERODE = 2


def main() -> None:
    src = GAME / "_design" / "concept" / f"{ID}.webp"
    out = ART / ".cache" / "concept"
    out.mkdir(parents=True, exist_ok=True)
    im = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
    H, W, _ = im.shape
    border = np.concatenate([im[:, :40], im[:, -40:]], axis=1).mean(axis=1)
    d = np.linalg.norm(im - border[:, None, :], axis=2)
    M = nd.binary_opening(d > BG_DIST, iterations=2)
    M = nd.binary_closing(M, iterations=2)
    M = nd.binary_fill_holes(M)
    lbl, n = nd.label(M)
    sizes = nd.sum(M, lbl, range(1, n + 1))
    M = np.isin(lbl, np.argsort(sizes)[::-1][:2] + 1)
    keep = nd.binary_erosion(M, iterations=ERODE)
    lum = im.mean(axis=2)
    meta = {"size": [W, H], "id": ID}
    for side, (x0, x1) in (("front", (0, W // 2)), ("back", (W // 2, W))):
        m = keep[:, x0:x1]
        rows = np.where(m.sum(1) > 6)[0]
        top = int(rows[0])
        dark = (lum[:, x0:x1] < 70) & m
        ground = int(np.where(dark.sum(1) > 20)[0][-1])
        # centre: the BODY's axis (the robe's mid-line over the chest, 1.20-1.45 m: no arm or lantern in those rows;
        # it agrees with the boots' and the mask's mid-lines within 2 px). The painted hat sits 1.7 cm to her right
        # of it on both figures; the hat paints procedurally, so the body's axis is the frame.
        k = (ground - top) / HEIGHT
        mids = []
        for z in np.arange(1.20, 1.451, 0.01):
            cols = np.where(m[int(round(ground - z * k))])[0]
            mids.append((cols[0] + cols[-1]) / 2)
        cx = float(x0 + np.median(mids))
        meta[side] = {"cx": cx, "ground": ground, "top": top}
        keep[ground + 1:, x0:x1] = False
    _, (iy, ix) = nd.distance_transform_edt(~keep, return_indices=True)
    padded = im[iy, ix]
    soft = np.stack([nd.gaussian_filter(padded[..., c], 5) for c in range(3)], -1)
    padded = np.where(keep[..., None], im, soft)
    for side in ("front", "back"):
        Image.fromarray(padded.clip(0, 255).astype(np.uint8)).save(out / f"{ID}_{side}.png")
    Image.fromarray((keep * 255).astype(np.uint8)).save(out / f"{ID}_mask.png")
    hf = meta["front"]["ground"] - meta["front"]["top"]
    meta["m_per_px"] = HEIGHT / hf
    (out / f"{ID}_plates.json").write_text(json.dumps(meta, indent=2))
    dbg = ART / "renders" / "fighters" / ID / "_fit"
    dbg.mkdir(parents=True, exist_ok=True)
    ov = np.where(keep[..., None], im, im * 0.45 + np.array([255.0, 40.0, 40.0]) * 0.55)
    Image.fromarray(ov.clip(0, 255).astype(np.uint8)).resize((W // 2, H // 2)).save(dbg / "plates_mask.png")
    print(json.dumps(meta))


if __name__ == "__main__":
    main()
