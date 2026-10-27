#!/usr/bin/env python3
"""Rishal's projection plates: art/tools/concept_plates.py with fixes for this concept.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/rishal_plates.py [--height 1.88]

The plate height is the crest arc's tip (the highest painted stone; the swept glass blades reach ~2 cm higher).
Fixes over the shared script (its figure cut, edge padding and output format are reused):
1. Pale backdrop walled in by the arms (between the left bracer and the tabard, behind the right arm in the
   back view) is the flat grey backdrop: big connected areas within BG_DIST of the row's border colour leave
   the figure (as kemdo_plates.py).
2. The front view's boots are painted almost in the backdrop's own grey (RGB distance ~3): the cut and the
   floor-shadow trim dropped them. They are traced here (BOOTS, concept px) and kept.
3. The plate frame is set by hand from the painting (the shared centre and sole rows assume a symmetric
   stance; this one is staggered: the left foot forward toward the viewer, the right foot turned out and
   drawn 70 px higher). ground = the mean sole row of the two feet, cx = the shoulders' / tabard's midline,
   top = the crest arc's tip.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as nd

HERE = Path(__file__).resolve().parent
ART = HERE.parent.parent
GAME = ART.parent
sys.path.insert(0, str(ART / "tools"))
import concept_plates as cp  # noqa: E402

BG_DIST = 9.0
MIN_AREA = 1500
FRAME = {"front": {"cx": 565.0, "ground": 1425, "top": 120},
         "back": {"cx": 1440.0, "ground": 1419, "top": 122}}
# the boots (concept px), traced on a 2x grid: the front view's pale boots are the backdrop's own grey
BOOTS = [
    [(309, 1378), (330, 1362), (372, 1342), (408, 1318), (406, 1286), (486, 1290), (493, 1336), (489, 1382),
     (452, 1388), (330, 1393), (309, 1389)],
    [(741, 1318), (811, 1320), (818, 1390), (833, 1425), (823, 1453), (787, 1464), (751, 1458), (735, 1430),
     (745, 1390), (739, 1345)],
]


def figure_mask(im: np.ndarray) -> np.ndarray:
    M = cp.figure_mask(im)
    # the backdrop has a vignette (lighter toward the middle): compare with a smooth estimate of the backdrop
    # outside the cut (normalised convolution), not the border columns
    w = (~nd.binary_dilation(M, iterations=6)).astype(np.float32)
    num = np.stack([nd.gaussian_filter(im[..., c] * w, 60) for c in range(3)], -1)
    den = nd.gaussian_filter(w, 60)[..., None] + 1e-6
    d = np.linalg.norm(im - num / den, axis=2)
    bg = nd.binary_opening((d < BG_DIST) & M, iterations=1)
    lbl, n = nd.label(bg)
    if n:
        sizes = nd.sum(bg, lbl, range(1, n + 1))
        big = np.isin(lbl, np.nonzero(sizes >= MIN_AREA)[0] + 1)
        M = M & ~nd.binary_dilation(big, iterations=3)
    lbl, n = nd.label(M)
    sizes = nd.sum(M, lbl, range(1, n + 1))
    return np.isin(lbl, np.argsort(sizes)[::-1][:2] + 1)


def poly_mask(shape, polys) -> np.ndarray:
    img = Image.new("L", (shape[1], shape[0]), 0)
    d = ImageDraw.Draw(img)
    for p in polys:
        d.polygon(p, fill=255)
    return np.asarray(img) > 127


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--erode", type=int, default=7)
    ap.add_argument("--height", type=float, default=1.88)
    a = ap.parse_args()
    fid = "rishal"
    src = GAME / "_design" / "concept" / f"{fid}.webp"
    out = ART / ".cache" / "concept"
    out.mkdir(parents=True, exist_ok=True)
    im = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
    H, W, _ = im.shape
    boots = poly_mask((H, W), BOOTS)
    M = figure_mask(im) | boots
    lum = im.mean(axis=2)
    mx, mn = im.max(axis=2), im.min(axis=2)
    neutral = (mx - mn) / np.maximum(mx, 1) < 0.04
    meta = {"size": [W, H], "id": fid}
    keep = nd.binary_erosion(M, iterations=a.erode) | nd.binary_erosion(boots, iterations=2)
    halves = (("front", (0, W // 2)), ("back", (W // 2, W)))
    for side, (x0, x1) in halves:
        meta[side] = dict(FRAME[side])
        g = meta[side]["ground"]
        # the floor shadow: below the soles' band only the boots stay; near the floor neutral pale pixels go
        band = slice(g - 60, H)
        floor = (lum[band, x0:x1] > 150) & neutral[band, x0:x1] & ~boots[band, x0:x1]
        keep[band, x0:x1] &= ~floor
        keep[g + 45:, x0:x1] = False
        keep[:, x0:x1] = nd.binary_opening(keep[:, x0:x1], iterations=2) | (boots[:, x0:x1] & keep[:, x0:x1])
    _, (iy, ix) = nd.distance_transform_edt(~keep, return_indices=True)
    padded = im[iy, ix]
    soft = np.stack([nd.gaussian_filter(padded[..., c], 5) for c in range(3)], -1)
    padded = np.where(keep[..., None], im, soft)
    for side, _ in halves:
        Image.fromarray(padded.clip(0, 255).astype(np.uint8)).save(out / f"{fid}_{side}.png")
    Image.fromarray((keep * 255).astype(np.uint8)).save(out / f"{fid}_mask.png")
    meta["m_per_px"] = a.height / (meta["front"]["ground"] - meta["front"]["top"])
    (out / f"{fid}_plates.json").write_text(json.dumps(meta, indent=2))
    # inspection overlay
    vis = im.copy()
    vis[~keep] = vis[~keep] * 0.35 + np.array([255, 0, 255]) * 0.65
    Image.fromarray(vis.clip(0, 255).astype(np.uint8)).resize((W // 2, H // 2)).save(
        ART / "renders" / "fighters" / fid / "_plates_mask.png")
    print(json.dumps(meta))


if __name__ == "__main__":
    main()
