#!/usr/bin/env python3
"""Sukri's projection plates: art/tools/concept_plates.py's frame and padding with this sheet's own cut.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/sukri_plates.py

The shared cut (cp.figure_mask: a colour distance to a normalised-convolution backdrop) fails this sheet twice:
  1. THE PALE GAP BETWEEN THE STAFF AND THE BODY. The staff, the right fist and the floor shadow wall in the
     backdrop between the wraps and the shaft (front: left of the body; back: right of it), and the shared hole
     fill keeps it as figure (a pale rectangle on both plates).
  2. THE PALE HOOD AND BACK CLOTH. The hood's lit dome and the pale back cloth sit within ~15 RGB of the
     vignetted backdrop, so the shared cut leaves holes through the hood's back.
Here the cut is a FLOOD FILL of the backdrop from the sheet's border: a pixel is backdrop when it is close to a
smooth 2D backdrop estimate (fitted to the shared cut's outside, so the vignette is modelled) AND flat (no painted
edge: the painted outline round the figure stops the fill). Everything the fill does not reach is figure (the hood
is solid), except big flat enclosed islands of backdrop colour BELOW THE SHOULDERS (the staff gaps, between the
legs), which leave the figure; above the shoulders every enclosed hole is filled (the hood).
Frame: `top` = the hood's crown (1.65 m, the brief's height and content art.height), `ground` = the boot soles,
`cx` = the body's axis (the median mid-point of the largest run per row through the hood and chest; the staff
is a separate run).
Writes art/.cache/concept/sukri_{front,back}.png (edge-padded RGB), sukri_mask.png, sukri_plates.json and a
debug overlay art/renders/fighters/sukri/_fit/plates_mask.png (removed backdrop in red).
"""
from __future__ import annotations

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

ID = "sukri"
HEIGHT = 1.65             # the hood's crown (content art.height)
ERODE = 4                 # px off the edge (the anti-aliased outline)
BG_DIST = 11.0            # RGB distance to the smooth backdrop estimate that still counts as backdrop
GRAD_MAX = 28.0           # ... and its (smoothed) Sobel gradient ceiling (painted edges stop the fill)
ISLAND_MIN = 1500         # px: enclosed backdrop islands at least this big leave the figure (below the shoulders)
SHOULDER_Z = 0.80         # m: above this every enclosed hole is figure (the hood, the back cloth; the shoulders are ~0.96)


def sat_of(im: np.ndarray) -> np.ndarray:
    mx, mn = im.max(axis=2), im.min(axis=2)
    return (mx - mn) / np.maximum(mx, 1)


def backdrop(im: np.ndarray, M0: np.ndarray) -> np.ndarray:
    """a smooth backdrop estimate: normalised convolution of the pixels well outside the shared cut"""
    w = (~nd.binary_dilation(M0, iterations=14)).astype(np.float32)
    num = np.stack([nd.gaussian_filter(im[..., c] * w, 45) for c in range(3)], -1)
    den = nd.gaussian_filter(w, 45)[..., None] + 1e-6
    return num / den


def figure_mask(im: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    H, W, _ = im.shape
    M0 = cp.figure_mask(im)
    bg = backdrop(im, M0)
    d = np.linalg.norm(im - bg, axis=2)
    lum = im.mean(axis=2)
    g = np.hypot(nd.sobel(lum, 0), nd.sobel(lum, 1))
    g = nd.gaussian_filter(g, 1.2)
    cand = (d < BG_DIST) & (g < GRAD_MAX)
    cand = nd.binary_opening(cand, iterations=1)
    lbl, n = nd.label(cand)
    border = set(np.unique(np.concatenate([lbl[0], lbl[-1], lbl[:, 0], lbl[:, -1]]))) - {0}
    outside = np.isin(lbl, list(border))
    fig = ~outside
    fig = nd.binary_opening(fig, iterations=2)
    lbl2, n2 = nd.label(fig)
    s2 = nd.sum(fig, lbl2, range(1, n2 + 1))
    fig = np.isin(lbl2, np.nonzero(s2 >= 3000)[0] + 1)
    return fig, cand, d


def main() -> None:
    src = GAME / "_design" / "concept" / f"{ID}.webp"
    out = ART / ".cache" / "concept"
    out.mkdir(parents=True, exist_ok=True)
    im = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
    H, W, _ = im.shape
    fig, cand, dist = figure_mask(im)
    lum = im.mean(axis=2)
    sat = sat_of(im)
    meta = {"size": [W, H], "id": ID}
    halves = (("front", (0, W // 2)), ("back", (W // 2, W)))
    removed = np.zeros_like(fig)
    for side, (x0, x1) in halves:
        m = fig[:, x0:x1]
        # sole: the last row with a run of very dark (boot) pixels
        dark = (lum[:, x0:x1] < 70) & m
        ground = int(np.where(dark.sum(1) > 30)[0][-1])
        # crown: the hood's top (the first row with a run of > 40 px, the staff's crook is narrower)
        rows = np.where(m.sum(1) > 40)[0]
        top = int(rows[0])
        k = (ground - top) / HEIGHT
        mids = []
        for z in np.arange(1.05, 1.52, 0.01):
            r = int(round(ground - z * k))
            lab, nn = nd.label(m[r])
            if not nn:
                continue
            sz = nd.sum(m[r], lab, range(1, nn + 1))
            cols = np.nonzero(lab == int(np.argmax(sz)) + 1)[0]
            mids.append((cols[0] + cols[-1]) / 2)
        meta[side] = {"cx": float(x0 + np.median(mids)), "ground": ground, "top": top}
        # enclosed holes: above the shoulders figure (the hood); below, big flat backdrop islands leave
        sh_row = int(round(ground - SHOULDER_Z * k))
        filled = nd.binary_fill_holes(m)
        holes = filled & ~m
        hl, hn = nd.label(holes)
        for i in range(1, hn + 1):
            hm = hl == i
            ys = np.nonzero(hm.any(1))[0]
            if ys.max() < sh_row:
                m |= hm                                            # a hole in the hood: figure
        # big islands of backdrop colour inside the figure below the shoulders (the staff gap, between the legs)
        isl = cand[:, x0:x1] & m
        isl[:sh_row] = False
        il, inn = nd.label(isl)
        if inn:
            sz = nd.sum(isl, il, range(1, inn + 1))
            big = np.isin(il, np.nonzero(sz >= ISLAND_MIN)[0] + 1)
            big = nd.binary_dilation(big, iterations=3) & m
            m &= ~big
            removed[:, x0:x1] |= big
        # below the soles nothing; the floor shadow (neutral pale grey) round the boots goes
        m[ground + 1:] = False
        band = slice(ground - 70, ground + 1)
        shadow = (sat[band, x0:x1] < 0.10) & (lum[band, x0:x1] > 120)
        m[band] &= ~shadow
        # the white outline halo and the pale floor shadow round the legs and boots (the lowest 24 % of the figure:
        # the shin wraps are cream, saturation 0.12+; the halo and the shadow are neutral)
        legs = slice(ground - int(0.24 * (ground - top)), ground + 1)
        m[legs] &= ~((lum[legs, x0:x1] > 205) & (sat[legs, x0:x1] < 0.075))
        fig[:, x0:x1] = nd.binary_opening(m, iterations=1)
    keep = nd.binary_erosion(fig, iterations=ERODE)
    _, (iy, ix) = nd.distance_transform_edt(~keep, return_indices=True)
    padded = im[iy, ix]
    soft = np.stack([nd.gaussian_filter(padded[..., c], 5) for c in range(3)], -1)
    padded = np.where(keep[..., None], im, soft)
    for side, _ in halves:
        Image.fromarray(padded.clip(0, 255).astype(np.uint8)).save(out / f"{ID}_{side}.png")
    Image.fromarray((keep * 255).astype(np.uint8)).save(out / f"{ID}_mask.png")
    meta["m_per_px"] = HEIGHT / (meta["front"]["ground"] - meta["front"]["top"])
    meta["height"] = HEIGHT
    (out / f"{ID}_plates.json").write_text(json.dumps(meta, indent=2))
    dbg = ART / "renders" / "fighters" / ID / "_fit"
    dbg.mkdir(parents=True, exist_ok=True)
    ov = im * 0.30 + 40
    ov[keep] = im[keep]
    ov[removed] = ov[removed] * 0.4 + np.array([255, 40, 40]) * 0.6
    for side, (x0, x1) in halves:
        g, t, cx = meta[side]["ground"], meta[side]["top"], meta[side]["cx"]
        ov[t, x0:x1] = (0, 255, 0)
        ov[g, x0:x1] = (0, 255, 0)
        ov[:, int(cx)] = (0, 160, 255)
    Image.fromarray(ov.clip(0, 255).astype(np.uint8)).resize((W // 2, H // 2), Image.LANCZOS).save(dbg / "plates_mask.png")
    print(json.dumps(meta))


if __name__ == "__main__":
    main()
