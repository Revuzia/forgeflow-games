#!/usr/bin/env python3
"""Odrum's projection plates: art/tools/concept_plates.py with one fix for this concept.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/odrum_plates.py --height 1.9

The shared cut fills every enclosed hole of the silhouette. Odrum's yoke encloses background twice per
figure: the pale triangle between the two cords of each pot (staff, cords and pot rim close it), plus
the slots between the hanging left arm and the coat, between the raised right forearm and the chest,
and between the trouser legs. Here those holes are taken back out before the plates are written:
pixels inside the cut that match the painted background (within 30 of the row's border colour, low
saturation, light) and form a region larger than 120 px leave the figure. Everything else is the shared
script unchanged.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from scipy import ndimage as nd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent / "tools"))
import concept_plates as cp  # noqa: E402

_shared = cp.figure_mask


def figure_mask(im: np.ndarray, thresh: float = 22.0, iters: int = 4) -> np.ndarray:
    M = _shared(im, thresh, iters)
    border = np.concatenate([im[:, :40], im[:, -40:]], axis=1).mean(axis=1)
    near_bg = np.linalg.norm(im - border[:, None, :], axis=2) < 30.0
    mx, mn = im.max(axis=2), im.min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1)
    lum = im.mean(axis=2)
    bg = near_bg & (sat < 0.14) & (lum > 160) & M
    bg = nd.binary_opening(bg, iterations=1)
    lbl, n = nd.label(bg)
    sizes = nd.sum(bg, lbl, range(1, n + 1))
    holes = np.isin(lbl, np.nonzero(sizes > 120)[0] + 1)
    holes = nd.binary_dilation(holes, iterations=2) & M
    out = M & ~holes
    return nd.binary_opening(out, iterations=1)


def recentre() -> None:
    """The shared centre is the mid-point of the boots, and Odrum's right boot toes out: the body's own
    centre line (the coat skirt band, 66-72 % down from the crown, below the pots and the fist) is the
    model's x = 0 instead."""
    import json
    from PIL import Image
    cache = cp.ART / ".cache" / "concept"
    meta = json.loads((cache / "odrum_plates.json").read_text())
    M = np.asarray(Image.open(cache / "odrum_mask.png")) > 0
    W = meta["size"][0]
    for side, (x0, x1) in (("front", (0, W // 2)), ("back", (W // 2, W))):
        g, t = meta[side]["ground"], meta[side]["top"]
        rows = M[int(t + 0.66 * (g - t)):int(t + 0.72 * (g - t)), x0:x1]
        lo = [np.nonzero(r)[0][0] for r in rows if r.any()]
        hi = [np.nonzero(r)[0][-1] for r in rows if r.any()]
        meta[side]["cx_boots"] = meta[side]["cx"]
        meta[side]["cx"] = float(x0 + (np.median(lo) + np.median(hi)) / 2)
    (cache / "odrum_plates.json").write_text(json.dumps(meta, indent=2))
    print("recentred:", {s: meta[s]["cx"] for s in ("front", "back")})


def erase_windows() -> None:
    """The painted pot windows (blue glass in an ochre ring, one per pot on its +X side) become real
    geometry facing out in the model (front-out and back-out on both pots): paint them out of the plates,
    glass and frame ring, refilled from the surrounding pot paint (normalised convolution) so no ghost
    window is left on the pot bodies."""
    from PIL import Image
    cache = cp.ART / ".cache" / "concept"
    im = np.asarray(Image.open(cp.GAME / "_design" / "concept" / "odrum.webp").convert("RGB")).astype(np.float32)
    mx, mn = im.max(axis=2), im.min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1)
    blue = (im[..., 2] > im[..., 0] + 35) & (sat > 0.35)
    blue = nd.binary_opening(blue, iterations=2)
    lbl, n = nd.label(blue)
    sizes = nd.sum(blue, lbl, range(1, n + 1))
    blue = np.isin(lbl, np.nonzero(sizes > 300)[0] + 1)
    hole = nd.binary_dilation(nd.binary_fill_holes(blue), iterations=27)
    keep = np.asarray(Image.open(cache / "odrum_mask.png")) > 0
    src = nd.binary_dilation(hole, iterations=10) & ~hole & keep
    _, (iy, ix) = nd.distance_transform_edt(~src, return_indices=True)
    for side in ("front", "back"):
        plate = np.asarray(Image.open(cache / f"odrum_{side}.png").convert("RGB")).astype(np.float32)
        fill = np.stack([nd.gaussian_filter(plate[..., c][iy, ix], 8) for c in range(3)], -1)
        a = nd.gaussian_filter(hole.astype(np.float32), 2.5)[..., None]
        out = plate * (1 - a) + fill * a
        Image.fromarray(out.clip(0, 255).astype(np.uint8)).save(cache / f"odrum_{side}.png")
    print("erased", int(n), "blue blobs ->", int((sizes > 300).sum()), "windows")


if __name__ == "__main__":
    cp.figure_mask = figure_mask
    sys.argv = [sys.argv[0], "odrum"] + sys.argv[1:]
    cp.main()
    recentre()
    erase_windows()
