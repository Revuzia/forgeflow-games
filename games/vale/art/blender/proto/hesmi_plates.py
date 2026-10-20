#!/usr/bin/env python3
"""Hesmi's projection plates: art/tools/concept_plates.py with three fixes for this concept.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/hesmi_plates.py --height 2.3 --erase-saturated-above 1.6

Same outputs as the shared script (art/.cache/concept/hesmi_{front,back,mask}.png + hesmi_plates.json); the
shared script is not edited (other fighters use it). Fixes (1-2 in figure_mask, 3-4 in main):

1. Hood crown. The warm back-light glow sits right behind the pale hood crown and the shard tips, so the
   shared background estimate cuts a bite out of the hood's top. Above row 200 cool pale pixels (R - B < 27:
   the hood cloth and honed stone are near-neutral; the glow is cream, R - B 33-45) within 60 px of the
   shared cut join the figure.
2. Pale bevels. The light-grey bevels on the gauntlets and the shard tips read as background, which leaves
   notches through the silhouette. The painted outline halo (a light rim brighter than the background) is
   unioned with the cut and SMALL enclosed holes (< 6000 px) are filled: notches close, the real gaps (between
   the legs, arms and body, all far bigger) stay open. The halo itself is eroded off afterwards as before.
3. Centre. The plate centre is the median midpoint of the outer extents (shins to shoulders), not the boots.
4. Boot band seam. The shared sole trim closes the boot mask on a row slice, which erodes the slice's top row
   (a 1 px seam across both boots); here the band is padded before the closing.
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

TOP_ROWS = 200            # the hood crown and shard tips live above this row (the glow is warm only up here)


def figure_mask(im: np.ndarray, thresh: float = 22.0, iters: int = 4) -> np.ndarray:
    M = cp.figure_mask(im, thresh, iters)
    rb = im[..., 0] - im[..., 2]
    lum = im.mean(axis=2)
    # 1. the pale hood crown under the warm glow
    cool = (rb < 27) & (lum > 150)
    cool[TOP_ROWS:] = False
    cand = cool & nd.binary_dilation(M, iterations=60)
    lbl, _ = nd.label(cand | M)
    keep = np.unique(lbl[M])
    out = M | (np.isin(lbl, keep[keep > 0]) & cand)
    out = nd.binary_opening(out, iterations=2)
    out[:TOP_ROWS] = nd.binary_closing(out, iterations=3)[:TOP_ROWS]
    out = nd.binary_fill_holes(out)
    # 2. halo closure: the light outline rim around the figure closes notches cut by pale bevels
    w = (~nd.binary_dilation(out, iterations=6)).astype(np.float32)
    num = np.stack([nd.gaussian_filter(im[..., c] * w, 40) for c in range(3)], -1)
    den = nd.gaussian_filter(w, 40)[..., None] + 1e-6
    d = lum - (num / den).mean(axis=2)
    ring = nd.binary_dilation(out, iterations=20) & ~nd.binary_erosion(out, iterations=2)
    U = out | ((d > 5) & ring)
    holes = nd.binary_fill_holes(U) & ~U
    lbl, n = nd.label(holes)
    if n:
        sz = nd.sum(holes, lbl, range(1, n + 1))
        out |= np.isin(lbl, np.nonzero(sz < 6000)[0] + 1)
    return nd.binary_fill_holes(out)


# fix pass (review 10-20): paint-overs on the FRONT figure (plate px, the concept's 2048 x 1536 frame)
EYE_DISCS = (("front", 0.284, 2.045), ("front", -0.270, 2.001), ("back", -0.035, 2.073), ("back", 0.267, 2.040),
             ("back", -0.331, 2.019))                   # (plate, world x, z) of the concept's five painted eyes
CLASPS = ((386, 488, 466, 582), (568, 488, 646, 580))        # the 'E' / '3'-shaped harness clasps
BAND_JOINTS = ((476, 233, 491, 258), (573, 231, 588, 256))   # the vertical joints on the eye-band's lower band


def repaint(img: np.ndarray) -> np.ndarray:
    """5. The chest clasps read as the letters 'E' and '3': painted out of the straps and redrawn as plain square
    buckles. 6. The two joints on the eye-band's lower band read as teeth from the 52 degree camera: painted out
    (each row interpolated across the joint), the upper band keeps its carved blocks."""
    from PIL import ImageDraw
    out = img.copy()
    lum = img.mean(axis=2)
    boxes = []
    for x0, y0, x1, y1 in CLASPS:
        sub = img[y0:y1, x0:x1]
        metal = (sub[..., 2] - sub[..., 0] > 6) & (lum[y0:y1, x0:x1] > 80)
        metal = nd.binary_opening(metal, iterations=1)
        hole = nd.binary_dilation(metal, iterations=7)
        sl = lum[y0:y1, x0:x1]
        leather = ~hole & (sub[..., 0] > sub[..., 2] + 4) & (sl > 45) & (sl < 120)
        _, (iy, ix) = nd.distance_transform_edt(~leather, return_indices=True)
        fill = sub[iy, ix]
        fill = np.stack([nd.gaussian_filter(fill[..., c], 3.0) for c in range(3)], -1)
        a_ = nd.gaussian_filter(hole.astype(np.float32), 1.5)[..., None]
        out[y0:y1, x0:x1] = sub * (1 - a_) + fill * a_
        ys, xs = np.nonzero(metal)
        boxes.append((x0 + xs.mean(), y0 + ys.mean(), np.median(sub[metal], axis=0)))
    for x0, y0, x1, y1 in BAND_JOINTS:
        a, b = out[y0:y1, x0 - 2:x0].mean(1), out[y0:y1, x1:x1 + 2].mean(1)
        t = np.linspace(0, 1, x1 - x0)[None, :, None]
        out[y0:y1, x0:x1] = a[:, None] * (1 - t) + b[:, None] * t
    im = Image.fromarray(out.clip(0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    for cx, cy, metal_c in boxes:
        w, h = 34, 40
        r = (cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2)
        mc = tuple(int(v) for v in metal_c)
        hi = tuple(int(min(255, v * 1.25 + 12)) for v in metal_c)
        d.rounded_rectangle(r, radius=6, outline=(34, 30, 36), width=11)
        d.rounded_rectangle((r[0] + 2, r[1] + 2, r[2] - 2, r[3] - 2), radius=5, outline=mc, width=7)
        d.line((r[0] + 7, r[1] + 4, r[2] - 7, r[1] + 4), fill=hi, width=2)
        d.line((cx, r[1] + 7, cx, r[3] - 7), fill=(34, 30, 36), width=4)          # the tongue
        d.line((cx, r[1] + 8, cx, r[3] - 8), fill=mc, width=2)
    drawn = np.asarray(im).astype(np.float32)
    soft = np.stack([nd.gaussian_filter(drawn[..., c], 0.7) for c in range(3)], -1)
    m = np.zeros(lum.shape, bool)
    for x0, y0, x1, y1 in CLASPS:
        m[y0:y1, x0:x1] = True
    return np.where(m[..., None], soft, drawn)


def _close_padded(m: np.ndarray, it: int) -> np.ndarray:
    p = np.pad(m, it + 1, mode="edge")
    return nd.binary_closing(p, iterations=it)[it + 1:-it - 1, it + 1:-it - 1]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--erode", type=int, default=9, help="px eroded off the silhouette (outline halo)")
    ap.add_argument("--height", type=float, default=2.3, help="model height in m (crown to sole)")
    ap.add_argument("--erase-saturated-above", type=float, default=None, metavar="M",
                    help="paint out the blue shard inlays (built as accent geometry) above this height (m)")
    a = ap.parse_args()
    fid = "hesmi"
    src = GAME / "_design" / "concept" / f"{fid}.webp"
    out = ART / ".cache" / "concept"
    out.mkdir(parents=True, exist_ok=True)
    im = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
    H, W, _ = im.shape
    M = figure_mask(im)
    lum = im.mean(axis=2)
    meta = {"size": [W, H], "id": fid}
    core = nd.binary_erosion(M, iterations=a.erode)
    halves = (("front", (0, W // 2)), ("back", (W // 2, W)))
    for side, (x0, x1) in halves:
        m = M[:, x0:x1]
        halo = lum[:, x0:x1] > 238
        crows = np.where((core[:, x0:x1] & ~halo).sum(1) > 12)[0]
        top = int(crows[0])
        dark = (lum[:, x0:x1] < 60) & m
        ground = int(np.where(dark.sum(1) > 30)[0][-1])
        # centre: the median midpoint of the figure's outer extents from the shins to the shoulders (the
        # front figure stands with its boots 3 cm off the body's axis, so the shared "leg columns" centre
        # would shift the front paint 3 cm against the symmetric model)
        mids = []
        for z in np.linspace(0.3, 1.5, 25):
            row = int(ground - z / a.height * (ground - top))
            cols = np.where(m[row])[0]
            if len(cols):
                mids.append(x0 + (cols[0] + cols[-1]) / 2)
        meta[side] = {"cx": float(np.median(mids)), "ground": ground, "top": top}
    keep = core.copy()
    for side, (x0, x1) in halves:
        g = meta[side]["ground"]
        keep[g + 1:, x0:x1] = False
        band = slice(g - 90, g + 1)
        boot = nd.binary_opening(lum[band, x0:x1] < 105, iterations=2)
        boot = _close_padded(boot, 6)
        keep[band, x0:x1] &= boot
        legs = slice(g - int(0.19 * (g - meta[side]["top"])), g + 1)
        keep[legs, x0:x1] &= ~(lum[legs, x0:x1] > 175)
        keep[:, x0:x1] = nd.binary_opening(keep[:, x0:x1], iterations=2)
    erased = np.zeros_like(keep)
    if a.erase_saturated_above is not None:
        mx, mn = im.max(axis=2), im.min(axis=2)
        sat = (mx - mn) / np.maximum(mx, 1)
        for side, (x0, x1) in halves:
            g, t = meta[side]["ground"], meta[side]["top"]
            row = int(g - a.erase_saturated_above / a.height * (g - t))
            sub = im[:row, x0:x1]
            er = np.zeros_like(keep)
            er[:row, x0:x1] = (sub[..., 2] > sub[..., 0] + 35) & (sat[:row, x0:x1] > 0.35)
            er = nd.binary_fill_holes(nd.binary_closing(nd.binary_opening(er, iterations=1), iterations=4))
            er = nd.binary_dilation(er, iterations=7)
            keep &= ~er
            erased |= er
    # the painted eyes (built as flush accent lenses in an ink rim, hesmi.EYES): discs at their centres, so the
    # paler, less saturated front-right eye goes too (the saturation test misses it)
    yy, xx = np.mgrid[0:H, 0:W]
    for side, x, z in EYE_DISCS:
        g, t, cxs = meta[side]["ground"], meta[side]["top"], meta[side]["cx"]
        k = (g - t) / a.height
        px = cxs + (1 if side == "front" else -1) * x * k
        py = g - z * k
        disc = (xx - px) ** 2 + ((yy - py) / 1.15) ** 2 < (0.034 * k) ** 2
        keep &= ~disc
        erased |= disc
    _, (iy, ix) = nd.distance_transform_edt(~keep, return_indices=True)
    padded = im[iy, ix]
    soft = np.stack([nd.gaussian_filter(padded[..., c], 5) for c in range(3)], -1)
    padded = np.where(keep[..., None], im, soft)
    if erased.any():
        # refill the inlays from the surrounding honed stone (light paint only), soft-blended
        srcm = keep & (lum > 140)
        _, (jy, jx) = nd.distance_transform_edt(~srcm, return_indices=True)
        fill = im[jy, jx]
        fill = np.stack([nd.gaussian_filter(fill[..., c], 6) for c in range(3)], -1)
        hole = erased & M
        a_ = nd.gaussian_filter(hole.astype(np.float32), 2.5)[..., None]
        padded = padded * (1 - a_) + fill * a_
    padded = repaint(padded)
    for side, _ in halves:
        Image.fromarray(padded.clip(0, 255).astype(np.uint8)).save(out / f"{fid}_{side}.png")
    Image.fromarray((keep * 255).astype(np.uint8)).save(out / f"{fid}_mask.png")
    meta["m_per_px"] = a.height / (meta["front"]["ground"] - meta["front"]["top"])
    (out / f"{fid}_plates.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta))


if __name__ == "__main__":
    main()
