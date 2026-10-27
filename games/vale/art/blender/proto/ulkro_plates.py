#!/usr/bin/env python3
"""Ulkro's projection plates: art/tools/concept_plates.py with fixes for this concept.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/ulkro_plates.py [--height 1.85]

The plate height is the HOOD'S PEAK (the crown of the figure without the darts): content art.height is the mesh top
(the dart crest stands above it). The sole row is the planted right boot's sole in both views.

Fixes over the shared script (its figure cut, edge padding and output format are reused):
1. Pale backdrop kept inside the cut (between the arms and the tunic, between the quiver and the hood) leaves the
   figure: big connected areas within 10 (RGB) of the row's border colour.
2. The plate frame: the shared centre (mean of the lower fifth) is pulled by the walking stride; here cx is the
   face wrap's / hood's centre line (front) and the hood's centre line (back).
3. Everything below the tunic hem (trousers, shin wraps, boots: a walking stride in both views) is painted by the
   model module procedurally from the concept's own colours (the model stands in a symmetric rest stance), so the
   leg paint here is only the edge padding; the darts, the thrower and the pale-blue heads are painted by the
   module too (thin props: no projection).
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

FID = "ulkro"


def figure_mask(im: np.ndarray) -> np.ndarray:
    """The figure = everything NOT reached by a flood fill from the sheet's border through backdrop pixels.
    The shared cut (a colour distance to a normalised-convolution backdrop) also cuts the pale stone shoulder
    plates, the linen quiver and the pale sleeves (they are the backdrop's grey); here its cut only seeds the
    backdrop estimate. Backdrop = close to that estimate AND flat (no painted edge), connected to the border;
    big flat enclosed backdrop islands (between the legs) leave the figure too."""
    M0 = cp.figure_mask(im)
    w = (~nd.binary_dilation(M0, iterations=8)).astype(np.float32)
    bg = np.stack([nd.gaussian_filter(im[..., c] * w, 40) for c in range(3)], -1) / (nd.gaussian_filter(w, 40)[..., None] + 1e-6)
    d = np.linalg.norm(im - bg, axis=2)
    g = np.hypot(nd.sobel(im.mean(2), 0), nd.sobel(im.mean(2), 1))
    cand = (d < 13) & (nd.gaussian_filter(g, 1.5) < 45)
    lbl, n = nd.label(cand)
    border = set(np.unique(np.concatenate([lbl[0], lbl[-1], lbl[:, 0], lbl[:, -1]]))) - {0}
    outside = np.isin(lbl, list(border))
    sizes = nd.sum(cand, lbl, range(1, n + 1))
    flat_big = np.isin(lbl, np.nonzero(sizes >= 2500)[0] + 1)
    fig = nd.binary_opening(~(outside | flat_big), iterations=2)
    lbl2, n2 = nd.label(fig)
    s2 = nd.sum(fig, lbl2, range(1, n2 + 1))
    return np.isin(lbl2, np.nonzero(s2 >= 300)[0] + 1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--erode", type=int, default=5)
    ap.add_argument("--height", type=float, default=1.85)
    ap.add_argument("--frame", default="", help="json override of the plate frame")
    a = ap.parse_args()
    src = GAME / "_design" / "concept" / f"{FID}.webp"
    out = ART / ".cache" / "concept"
    out.mkdir(parents=True, exist_ok=True)
    im = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
    H, W, _ = im.shape
    M = figure_mask(im)
    lum = im.mean(axis=2)
    meta = {"size": [W, H], "id": FID}
    frame = json.loads(a.frame) if a.frame else FRAME
    keep = nd.binary_erosion(M, iterations=a.erode)
    for side, (x0, x1) in (("front", (0, W // 2)), ("back", (W // 2, W))):
        meta[side] = dict(frame[side])
        g = frame[side]["ground"]
        keep[g + 1:, x0:x1] = False
        keep[:, x0:x1] = nd.binary_opening(keep[:, x0:x1], iterations=2)
    _, (iy, ix) = nd.distance_transform_edt(~keep, return_indices=True)
    padded = im[iy, ix]
    soft = np.stack([nd.gaussian_filter(padded[..., c], 5) for c in range(3)], -1)
    padded = np.where(keep[..., None], im, soft)
    for side in ("front", "back"):
        Image.fromarray(padded.clip(0, 255).astype(np.uint8)).save(out / f"{FID}_{side}.png")
    Image.fromarray((keep * 255).astype(np.uint8)).save(out / f"{FID}_mask.png")
    Image.fromarray((M * 255).astype(np.uint8)).save(out / f"{FID}_mask_raw.png")
    meta["m_per_px"] = a.height / (frame["front"]["ground"] - frame["front"]["top"])
    meta["height"] = a.height
    (out / f"{FID}_plates.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta))


# measured on the sheet (2048 x 1536): hood peak row, right-boot sole row, face / hood centre column
FRAME = {"front": {"cx": 563.0, "ground": 1458, "top": 174}, "back": {"cx": 1482.0, "ground": 1458, "top": 174}}

if __name__ == "__main__":
    main()
