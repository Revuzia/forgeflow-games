#!/usr/bin/env python3
"""Lisvel's projection plates: art/tools/concept_plates.py with the fixes this sheet needs.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/lisvel_plates.py

The shared cut (cp.figure_mask) is reused; the clean-up is Lisvel's own (common/ and art/tools/ untouched):
  1. THE PALE GAP BETWEEN THE BOW AND THE LEGS. The longbow's limbs, its string and the body wall in the backdrop
     between the string and the limbs (and between the limbs and the skirt / quiver), and the shared hole fill keeps
     it as figure. Those pixels are the flat backdrop: big connected areas within BG_DIST (RGB) of the row's border
     colour at low saturation. They leave the figure, with the soft paint edge round them; small specks of the same
     grey (catch-lights on the linen) stay.
  2. THE BOW AND THE STRING OVER THE BODY. The bow is modelled and painted procedurally (a thin prop projects badly
     edge-on), so the painted bow must not ghost onto the tabard behind it in either plate (the back view even paints
     it across her back). The pale, unsaturated pixels of the long horizontal structures in the bow's band (the limbs,
     the faceted grip, the string) are filled column by column from the paint just above and below them.
  3. THE FACE-PLATE (front plate): the painting's face carries the painter's lighting (one cheek in shadow) under its
     incised facet lines; projected onto the sculpted face (which takes its own light) it read as an aged, creased face.
     Inside the mask's outline the paint is flattened to its chalk tone and the incised lines are kept at half strength
     (a high-pass of the painting), the small features (lips, nostrils) a little stronger.
  4. THE FLOOR SHADOW and the frame as the shared script (top = the head-wrap crown, 1.85 m = HEIGHT).
Writes art/.cache/concept/lisvel_{front,back}.png (edge-padded RGB), lisvel_mask.png, lisvel_plates.json and a
debug overlay art/renders/fighters/lisvel/_fit/plates_mask.png (cut in colour, removed backdrop red, inpainted bow
blue).
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

ID = "lisvel"
HEIGHT = 1.85             # the head-wrap crown (content art.height reference)
ERODE = 9
BG_DIST = 18.0            # RGB distance to the row's border colour that counts as backdrop
BG_SAT = 0.06             # ... and its saturation ceiling (the backdrop ~0.01-0.03; the bow limbs ~0.06 but thin)
MIN_AREA = 700            # px: smaller backdrop-grey islands are paint (catch-lights), not gaps
BOW_BAND = (0.83, 1.27)   # m: the bow + string rows (both figures)
BOW_LUM, BOW_SAT = 168.0, 0.11


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
    M = nd.binary_opening(M, iterations=2)
    lbl, n = nd.label(M)
    sizes = nd.sum(M, lbl, range(1, n + 1))
    keep = np.argsort(sizes)[::-1][:2] + 1
    return np.isin(lbl, keep), removed


def _runs(col: np.ndarray) -> list:
    r = np.nonzero(col)[0]
    if not len(r):
        return []
    return [(int(x[0]), int(x[-1])) for x in np.split(r, np.nonzero(np.diff(r) > 1)[0] + 1)]


def bow_pixels(im: np.ndarray, M: np.ndarray, meta: dict, lum: np.ndarray, sat: np.ndarray) -> np.ndarray:
    """the painted bow + string over each figure. The limb's centreline is traced where the bow is the only figure in
    its column (outside the body), fitted with a smooth curve across the body, then tracked over the body (the pale run
    nearest the curve); every pale, unsaturated pixel within the limb's half thickness of that line is bow. The string
    is the pale 1-row line at the tips' height across the body."""
    W = im.shape[1]
    out = np.zeros(lum.shape, bool)
    pale = (lum > 112) & (sat < 0.13)
    for side, (x0, x1) in (("front", (0, W // 2)), ("back", (W // 2, W))):
        g, t = meta[side]["ground"], meta[side]["top"]
        k = (g - t) / HEIGHT
        r0, r1 = int(g - BOW_BAND[1] * k), int(g - BOW_BAND[0] * k)
        rs = int(g - 1.135 * k)                                   # under the string
        body = M[r0:r1, x0:x1].sum(0) > 0.22 * k                  # columns the body fills
        cs, zs = [], []
        for c in range(x0, x1):
            if body[c - x0] or not M[rs:r1, c].any():
                continue
            runs = _runs(M[rs:r1, c])
            if not runs:
                continue
            a, b = max(runs, key=lambda r: r[1] - r[0])
            if 3 <= b - a <= 0.06 * k:
                cs.append(c)
                zs.append(rs + (a + b) / 2.0)
        cs, zs = np.array(cs, float), np.array(zs, float)
        cxp = meta[side]["cx"]
        u = (cs - cxp) / k
        sel = np.abs(u) < 0.95
        coef = np.polyfit(u[sel], zs[sel], 6)
        cols = np.arange(x0, x1)
        uc = (cols - cxp) / k
        lo, hi = u[sel].min() - 0.02, u[sel].max() + 0.02
        centre = np.full(len(cols), np.nan)
        for i, c in enumerate(cols):
            if not (lo <= uc[i] <= hi):
                continue
            zc = np.polyval(coef, uc[i])
            a0, b0 = int(zc - 0.05 * k), int(zc + 0.05 * k)
            runs = [(a + a0, b + a0) for a, b in _runs(pale[a0:b0, c])]
            runs = [r for r in runs if r[1] - r[0] >= 2]
            if runs:
                a, b = min(runs, key=lambda r: abs((r[0] + r[1]) / 2 - zc))
                centre[i] = (a + b) / 2.0 if abs((a + b) / 2 - zc) < 0.035 * k else zc
            else:
                centre[i] = zc
        ok = ~np.isnan(centre)
        sm = nd.median_filter(np.where(ok, centre, 0.0), 9)
        sm = np.where(ok, sm, np.nan)
        for i, c in enumerate(cols):
            if np.isnan(sm[i]):
                continue
            half = (0.036 if abs(uc[i]) < 0.34 else 0.020) * k
            a, b = int(sm[i] - half), int(sm[i] + half) + 1
            out[a:b, c] |= pale[a:b, c] & M[a:b, c]
        # the string: rows round the tips' height, a pale line through the whole figure
        rr0, rr1 = int(g - 1.24 * k), int(g - 1.10 * k)
        outside = ~body[None, :] & M[rr0:rr1, x0:x1] & pale[rr0:rr1, x0:x1]
        ztip = rr0 + int(np.argmax(outside.sum(1)))                  # the string's row
        a, b = int(ztip - 0.008 * k), int(ztip + 0.020 * k)
        strip = pale[a:b, x0:x1] & M[a:b, x0:x1]
        out[a:b, x0:x1] |= strip & (nd.uniform_filter(strip.astype(float), (1, 41)) > 0.6)
        # the nocked arrow along the string by the right hand (front): every bright unsaturated pixel there
        c0, c1 = int(cxp - 0.30 * k), int(cxp + 0.30 * k)
        out[a:b, c0:c1] |= (lum[a:b, c0:c1] > 150) & (sat[a:b, c0:c1] < 0.15) & M[a:b, c0:c1]
    return nd.binary_dilation(out, iterations=2) & nd.binary_dilation(M, iterations=2)


def inpaint_columns(im: np.ndarray, hole: np.ndarray, M: np.ndarray) -> np.ndarray:
    """every hole run in a column takes a linear blend of the figure paint just above and below it (the tabard's
    panels and trims run vertically, so the paint continues through the band); runs touching the backdrop take the
    one figure side they have"""
    out = im.copy()
    filled = np.zeros_like(hole)
    H, W = hole.shape
    cols = np.nonzero(hole.any(0))[0]
    for c in cols:
        col = hole[:, c]
        rows = np.nonzero(col)[0]
        # runs
        br = np.split(rows, np.nonzero(np.diff(rows) > 1)[0] + 1)
        for run in br:
            a, b = run[0] - 1, run[-1] + 1
            ok_a = a >= 0 and M[a, c] and not hole[a, c]
            ok_b = b < H and M[b, c] and not hole[b, c]
            if not (ok_a or ok_b):
                continue
            ca = im[max(0, a - 2):a + 1, c].mean(0) if ok_a else None
            cb = im[b:b + 3, c].mean(0) if ok_b else None
            if ca is None:
                ca = cb
            if cb is None:
                cb = ca
            u = (np.arange(len(run)) + 1.0) / (len(run) + 1.0)
            out[run, c] = ca[None] * (1 - u[:, None]) + cb[None] * u[:, None]
            filled[run, c] = True
    # soften the filled band a little across columns (no barcode)
    soft = np.stack([nd.gaussian_filter(out[..., ch], (1.0, 2.5)) for ch in range(3)], -1)
    return np.where(hole[..., None], soft, out), filled


def calm_face(im: np.ndarray, meta: dict) -> np.ndarray:
    """the front face-plate: chalk tone + half-strength incised detail (see 3. above)"""
    g, t, cx = meta["front"]["ground"], meta["front"]["top"], meta["front"]["cx"]
    k = (g - t) / HEIGHT
    H, W, _ = im.shape
    yy, xx = np.mgrid[0:H, 0:W]
    x = (xx - cx) / k
    z = (g - yy) / k
    # the mask's outline (an ellipse round the face, 7.2 x 10.2 cm), the visor band left as painted
    e = (x / 0.071) ** 2 + ((z - 1.712) / 0.103) ** 2
    face = (e < 1.0) & ~((np.abs(z - 1.731) < 0.024) & (np.abs(x) < 0.095))
    w = nd.gaussian_filter(face.astype(np.float32), 3.0)
    lum = im.mean(axis=2)
    low = np.stack([nd.gaussian_filter(im[..., c], 9.0) for c in range(3)], -1)
    det = im - low
    sel = face
    tone = np.median(im[sel & (lum > np.percentile(lum[sel], 40))], axis=0)
    # lines: the dark high-pass detail at half strength, plus the lower face's features a little more
    feat = np.clip((1.66 - z) / 0.04, 0, 1) * 0.25
    out = tone[None, None, :] + det * (0.5 + feat[..., None])
    # a gentle lit-from-above gradient so the plate is not flat
    out = out * (0.94 + 0.08 * np.clip((z - 1.61) / 0.2, 0, 1))[..., None]
    return im * (1 - w[..., None]) + out * w[..., None]


def main() -> None:
    src = GAME / "_design" / "concept" / f"{ID}.webp"
    out = ART / ".cache" / "concept"
    out.mkdir(parents=True, exist_ok=True)
    im = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
    H, W, _ = im.shape
    M, removed = figure_mask(im)
    lum = im.mean(axis=2)
    sat = sat_of(im)
    meta = {"size": [W, H], "id": ID}
    halves = (("front", (0, W // 2)), ("back", (W // 2, W)))
    core = nd.binary_erosion(M, iterations=ERODE)
    for side, (x0, x1) in halves:
        m = M[:, x0:x1]
        halo = lum[:, x0:x1] > 238
        crows = np.where((core[:, x0:x1] & ~halo).sum(1) > 12)[0]
        top = int(crows[0])
        dark = (lum[:, x0:x1] < 60) & m
        ground = int(np.where(dark.sum(1) > 30)[0][-1])
        band = m[ground - (ground - top) // 5: ground - 10]
        cols = np.where(band.any(0))[0]
        cx = float(x0 + (cols[0] + cols[-1]) / 2)
        meta[side] = {"cx": cx, "ground": ground, "top": top}
    bow = bow_pixels(im, M, meta, lum, sat)
    im2, filled = inpaint_columns(im, bow, M & ~bow)
    im2 = calm_face(im2, meta)
    keep = nd.binary_erosion(M, iterations=ERODE)
    for side, (x0, x1) in halves:
        g, t = meta[side]["ground"], meta[side]["top"]
        keep[g + 1:, x0:x1] = False
        b0 = g - 90
        sub = lum[b0 - 16:g + 1, x0:x1] < 105
        sub = nd.binary_closing(nd.binary_opening(sub, iterations=2), iterations=8)[16:]
        top_rows = (np.arange(b0, g + 1)[:, None] < b0 + 6) & keep[b0:g + 1, x0:x1]
        keep[b0:g + 1, x0:x1] &= sub | top_rows
        legs = slice(g - int(0.40 * (g - t)), g + 1)
        keep[legs, x0:x1] &= ~((lum[legs, x0:x1] > 175) & (sat[legs, x0:x1] < 0.08))
        keep[:, x0:x1] = nd.binary_opening(keep[:, x0:x1], iterations=1)
    keep &= ~(nd.binary_dilation(bow & ~filled, iterations=3))
    keep = nd.binary_opening(keep, iterations=2)
    # the bow outside the body is no figure paint (the model's bow is painted procedurally): only the body stays
    lbl, n = nd.label(keep)
    sizes = nd.sum(keep, lbl, range(1, n + 1))
    keep = np.isin(lbl, np.argsort(sizes)[::-1][:2] + 1)
    _, (iy, ix) = nd.distance_transform_edt(~keep, return_indices=True)
    padded = im2[iy, ix]
    soft = np.stack([nd.gaussian_filter(padded[..., c], 5) for c in range(3)], -1)
    padded = np.where(keep[..., None], im2, soft)
    for side, _ in halves:
        Image.fromarray(padded.clip(0, 255).astype(np.uint8)).save(out / f"{ID}_{side}.png")
    Image.fromarray((keep * 255).astype(np.uint8)).save(out / f"{ID}_mask.png")
    meta["m_per_px"] = HEIGHT / (meta["front"]["ground"] - meta["front"]["top"])
    meta["height"] = HEIGHT
    (out / f"{ID}_plates.json").write_text(json.dumps(meta, indent=2))
    dbg = ART / "renders" / "fighters" / ID / "_fit"
    dbg.mkdir(parents=True, exist_ok=True)
    ov = im2 * 0.35 + 255 * 0.65 * 0.25
    ov[keep] = im2[keep]
    ov[removed] = ov[removed] * 0.4 + np.array([255, 40, 40]) * 0.6
    ov[bow] = ov[bow] * 0.5 + np.array([40, 90, 255]) * 0.5
    Image.fromarray(ov.clip(0, 255).astype(np.uint8)).resize((W // 2, H // 2), Image.LANCZOS).save(dbg / "plates_mask.png")
    Image.fromarray(padded.clip(0, 255).astype(np.uint8)).resize((W // 2, H // 2), Image.LANCZOS).save(dbg / "plates_padded.png")
    print(json.dumps(meta))


if __name__ == "__main__":
    main()
