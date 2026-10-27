#!/usr/bin/env python3
"""Dunsom's projection plates: art/tools/concept_plates.py with the fixes this sheet needs.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/dunsom_plates.py

The shared cut (cp.figure_mask) is reused; the plate frame and the clean-up are Dunsom's own. Fixes over the
shared script (common/ and art/tools/ untouched: this wraps them):
  1. THE PALE GAP BETWEEN THE COAT AND THE CROOK. The crook, the right fist and the floor shadow wall in the
     backdrop between the coat's right side and the shaft (front: x 330-460 px, rows 640-1390; back: the same
     on the right), and the shared hole fill keeps it as figure. Those pixels are the flat backdrop: big
     connected areas within BG_DIST (RGB) of the row's border colour, low saturation. They leave the figure,
     with the soft paint edge round them; small specks of the same grey (catch-lights) stay. The gaps inside
     the hook's curl and between the lantern and the shaft go the same way.
  2. THE FRAME. The shared `top` is the crook's tip and `cx` the mean of the lower fifth (the crook's foot
     pulls it 13 cm off the body). Here `top` is the HAT CROWN (the brief's art.height reference, 2.05 m:
     PROJECTION height = 2.05) and `cx` the hat's centre column (the felt disc is symmetric and the clearest
     axis on both figures; it agrees with the mid-point between the boots within 4 px).
  3. THE FLOOR SHADOW. The shared trim keeps only dark boot pixels in the lowest 90 rows, which also eats the
     pale crook foot. Here the trim band only drops NEUTRAL (unsaturated) pale pixels: the shadow and the
     backdrop are neutral grey, the crook's wood is warm.
Writes art/.cache/concept/dunsom_{front,back}.png (edge-padded RGB), dunsom_mask.png, dunsom_plates.json and a
debug overlay art/renders/fighters/dunsom/_fit/plates_mask.png (cut in colour, removed backdrop in red).
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

ID = "dunsom"
HEIGHT = 2.05             # the hat crown (content art.height reference)
ERODE = 9
BG_DIST = 16.0            # RGB distance to the row's border colour that counts as backdrop
BG_SAT = 0.10             # ... and its saturation ceiling (the coat is lavender at ~0.10-0.16, the backdrop ~0.03)
MIN_AREA = 900            # px: smaller backdrop-grey islands are paint (catch-lights), not gaps
SHADOW_ROWS = 80          # the floor-shadow trim band above the sole row
NEUTRAL = 0.12            # saturation below which a pale pixel near the floor is shadow or backdrop (the crook
                          # foot is warm brown at 0.33+, the backdrop and its cast shadow 0.03-0.08)


def sat_of(im: np.ndarray) -> np.ndarray:
    mx, mn = im.max(axis=2), im.min(axis=2)
    return (mx - mn) / np.maximum(mx, 1)


def figure_mask(im: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    M = cp.figure_mask(im)
    border = np.concatenate([im[:, :40], im[:, -40:]], axis=1).mean(axis=1)
    d = np.linalg.norm(im - border[:, None, :], axis=2)
    bg = nd.binary_opening((d < BG_DIST) & (sat_of(im) < BG_SAT) & M, iterations=1)
    lbl, n = nd.label(bg)
    removed = np.zeros_like(M)
    if n:
        sizes = nd.sum(bg, lbl, range(1, n + 1))
        big = np.isin(lbl, np.nonzero(sizes >= MIN_AREA)[0] + 1)
        removed = nd.binary_dilation(big, iterations=3) & M
        M = M & ~removed
    M = nd.binary_opening(M, iterations=1)
    lbl, n = nd.label(M)
    sizes = nd.sum(M, lbl, range(1, n + 1))
    # the two figures plus their crooks (the crook can come off as its own component where the fist is thin)
    keep = np.argsort(sizes)[::-1][:4] + 1
    keep = [k for k in keep if sizes[k - 1] > 4000]
    return np.isin(lbl, keep), removed


def frame(M: np.ndarray, lum: np.ndarray, x0: int, x1: int) -> dict:
    m = M[:, x0:x1]
    dark = (lum[:, x0:x1] < 60) & m
    ground = int(np.where(dark.sum(1) > 30)[0][-1])
    # the hat: the widest row of the figure in the upper fifth (the rim), its centre = cx; its crown = the
    # first row of that column band (+-60 px round cx) that is figure
    H = m.shape[0]
    best, rim_row = 0, 0
    for r in range(80, int(H * 0.22)):
        lbl, n = nd.label(m[r])
        if not n:
            continue
        sizes = nd.sum(m[r], lbl, range(1, n + 1))
        j = int(np.argmax(sizes))
        if sizes[j] > best:
            best, rim_row = sizes[j], r
            cols = np.nonzero(lbl == j + 1)[0]
            span = (cols[0], cols[-1])
    cx = x0 + (span[0] + span[1]) / 2.0
    band = m[:, int(cx - x0 - 60):int(cx - x0 + 60)]
    top = int(np.nonzero(band.sum(1) > 20)[0][0])
    return {"cx": float(cx), "ground": ground, "top": top, "rim_row": int(rim_row),
            "rim_px": [int(x0 + span[0]), int(x0 + span[1])]}


def main() -> None:
    src = GAME / "_design" / "concept" / f"{ID}.webp"
    out = ART / ".cache" / "concept"
    out.mkdir(parents=True, exist_ok=True)
    im = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
    H, W, _ = im.shape
    M, removed = figure_mask(im)
    lum = im.mean(axis=2)
    neutral = sat_of(im) < NEUTRAL
    meta = {"size": [W, H], "id": ID}
    halves = (("front", (0, W // 2)), ("back", (W // 2, W)))
    for side, (x0, x1) in halves:
        meta[side] = frame(M, lum, x0, x1)
    keep = nd.binary_erosion(M, iterations=ERODE)
    # the crook is only ~28 px wide: erode it less (it would lose half its width); the crook columns are the
    # figure pixels outside the hat-rim span below the rim (and the hook above it)
    thin = nd.binary_erosion(M, iterations=4)
    for side, (x0, x1) in halves:
        g = meta[side]["ground"]
        t = meta[side]["top"]
        lo, hi = meta[side]["rim_px"]
        crook_cols = np.zeros_like(M)
        cxi = int(meta[side]["cx"])
        rr = meta[side]["rim_row"] + 30
        if side == "front":
            crook_cols[:rr, x0:lo - 40] = True
            crook_cols[rr:, x0:cxi - 200] = True
        else:
            crook_cols[:rr, hi + 40:x1] = True
            crook_cols[rr:, cxi + 200:x1] = True
        keep |= thin & crook_cols
        keep[g + 1:, x0:x1] = False
        b0 = g - SHADOW_ROWS
        band = slice(b0, g + 1)
        # near the soles: the dark boots, opened/closed on a taller strip so the band's top row leaves no seam
        # across the boots (closed over their lit toe caps); the crook's foot = its columns just above the band
        # carried down (+-3 px); the warm-grey floor shadow round the boots and the crook goes
        sub = lum[b0 - 16:g + 1, x0:x1] < 105
        sub = nd.binary_closing(nd.binary_opening(sub, iterations=2), iterations=8)[16:]
        foot = np.zeros_like(sub)
        above = M[b0 - 30:b0 - 4, x0:x1] & crook_cols[b0 - 30:b0 - 4, x0:x1]
        cols = np.nonzero(above.any(0))[0]
        if len(cols):
            foot[:, max(0, cols[0] - 3):cols[-1] + 4] = True
        top_rows = (np.arange(b0, g + 1)[:, None] < b0 + 6) & keep[band, x0:x1]
        keep[band, x0:x1] &= sub | foot | top_rows
        legs = slice(g - int(0.19 * (g - t)), g + 1)
        keep[legs, x0:x1] &= ~((lum[legs, x0:x1] > 175) & neutral[legs, x0:x1])
        keep[:, x0:x1] = nd.binary_opening(keep[:, x0:x1], iterations=1)
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
    # debug overlay
    dbg = ART / "renders" / "fighters" / ID / "_fit"
    dbg.mkdir(parents=True, exist_ok=True)
    ov = im * 0.35 + 255 * 0.65 * 0.25
    ov[keep] = im[keep]
    ov[removed] = ov[removed] * 0.4 + np.array([255, 40, 40]) * 0.6
    Image.fromarray(ov.clip(0, 255).astype(np.uint8)).resize((W // 2, H // 2), Image.LANCZOS).save(dbg / "plates_mask.png")
    print(json.dumps(meta))


if __name__ == "__main__":
    main()
