#!/usr/bin/env python3
"""Nurrow's projection plates: art/tools/concept_plates.py with fixes for this concept.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/nurrow_plates.py [--height 1.98]

The plate height is the tip of the snuffer knob on the hat (the highest painted point, art.height): the knob tip
is the first figure row (front 94, back 102), the sole row is the RIGHT boot's sole (front 1446, back 1424).

Fixes over the shared script (its figure cut, edge padding and output format are reused):
1. The plate frame. The shared centre (mean of the lower fifth) is pulled 13 cm to her right by the cape points and
   the wide right leg; here cx is the mask's / head's centre line (front 598, back 1446).
2. The left boot is drawn higher than the right in both views (the painter's eye point above the figure: the right
   foot is the nearer one). The model stands both soles on the floor, so the left lower leg is stretched down from
   the knee to the right sole's row (front +71 px, back +43 px; a soft column band round the left leg), image and
   cut together.
3. Pale backdrop kept inside the cut (between the arms and the cape, under the cape points) leaves the figure: big
   connected areas within 10 (RGB) of the row's border colour.
4. The blue studs on the hat rim and the shoulder brooch are erased and refilled from the surrounding paint (the
   model builds them as accent glass), as --erase-saturated-above does for the gems on Marund's cap.
5. THE LEGS ARE RE-POSED in the plates. The concept's stance is wide and asymmetric (the right leg reaches out to
   her right, the left knee bows out); the model is bound in a symmetric stance (ankles +-0.23 m, knees +-0.165,
   toes out 25 degrees) so every clip and the run work from one rest pose. A thin-plate-spline warp below the belt
   maps each model leg (hip, thigh, knee, shin, ankle, heel, toe + both edges) onto the painted leg, the belt line
   and the cape points held in place, so the painted trousers, wraps and boots land on the model's legs.
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

FID = "nurrow"
BG_DIST = 10.0
MIN_AREA = 1500
FRAME = {"front": {"cx": 598.0, "ground": 1446, "top": 94}, "back": {"cx": 1446.0, "ground": 1424, "top": 102}}
# the left lower leg: (column band c0..c1 with a soft edge, the knee row where the stretch starts, its sole row)
LEFT_LEG = {"front": (612, 880, 1030, 1375), "back": (1170, 1400, 1040, 1381)}
EDGE = 24


def figure_mask(im: np.ndarray) -> np.ndarray:
    M = cp.figure_mask(im)
    border = np.concatenate([im[:, :40], im[:, -40:]], axis=1).mean(axis=1)
    d = np.linalg.norm(im - border[:, None, :], axis=2)
    bg = nd.binary_opening((d < BG_DIST) & M, iterations=1)
    lbl, n = nd.label(bg)
    if n:
        sizes = nd.sum(bg, lbl, range(1, n + 1))
        big = np.isin(lbl, np.nonzero(sizes >= MIN_AREA)[0] + 1)
        M = M & ~nd.binary_dilation(big, iterations=3)
    lbl, n = nd.label(M)
    sizes = nd.sum(M, lbl, range(1, n + 1))
    return np.isin(lbl, np.argsort(sizes)[::-1][:2] + 1)


def stretch_left_leg(im: np.ndarray, M: np.ndarray):
    """warp rows below each figure's left knee so its left sole lands on the right sole's row"""
    H, W, _ = im.shape
    out, Mo = im.copy(), M.astype(np.float32).copy()
    for side, (c0, c1, r0, sole) in LEFT_LEG.items():
        g = FRAME[side]["ground"]
        if sole >= g:
            continue
        cols = np.arange(max(0, c0 - EDGE), min(W, c1 + EDGE))
        w = np.clip(np.minimum(cols - (c0 - EDGE), (c1 + EDGE) - cols) / EDGE, 0, 1)
        rows = np.arange(r0, H)
        # output row r takes input row r0 + (r - r0) * k (k < 1 below the knee: stretched), clamped past the ground
        k = (sole - r0) / (g - r0)
        src_full = np.where(rows <= g, r0 + (rows - r0) * k, sole + (rows - g))
        for j, c in enumerate(cols):
            src = rows + (src_full - rows) * w[j]
            for ch in range(3):
                out[rows, c, ch] = np.interp(src, np.arange(H), im[:, c, ch])
            Mo[rows, c] = np.interp(src, np.arange(H), M[:, c].astype(np.float32))
    return out, Mo > 0.5


# leg centre lines (x, z) in metres, MODEL (rest pose) -> CONCEPT per view (measured on the stretched plates)
MODEL_LEG = {"R": [(-0.09, 0.90), (-0.128, 0.70), (-0.165, 0.505), (-0.197, 0.31), (-0.23, 0.11), (-0.215, 0.025),
                   (-0.32, 0.03)],
             "L": [(0.09, 0.90), (0.128, 0.70), (0.165, 0.505), (0.197, 0.31), (0.23, 0.11), (0.215, 0.025),
                   (0.32, 0.03)]}
CONCEPT_LEG = {
    "front": {"R": [(-0.10, 0.88), (-0.21, 0.70), (-0.31, 0.52), (-0.39, 0.33), (-0.47, 0.16), (-0.46, 0.03),
                    (-0.62, 0.03)],
              "L": [(0.10, 0.88), (0.18, 0.72), (0.23, 0.57), (0.21, 0.36), (0.165, 0.17), (0.11, 0.03),
                    (0.35, 0.03)]},
    "back": {"R": [(-0.10, 0.88), (-0.20, 0.70), (-0.30, 0.52), (-0.39, 0.33), (-0.47, 0.15), (-0.47, 0.03),
                   (-0.62, 0.03)],
             "L": [(0.10, 0.88), (0.19, 0.72), (0.27, 0.58), (0.21, 0.36), (0.15, 0.15), (0.11, 0.03),
                   (0.37, 0.03)]},
}
LEG_HALF = 0.07             # edge points either side of each leg's centre line (same width in both poses)
HOLD = [(x / 10.0, z) for x in range(-7, 8) for z in (1.02, 1.12)] + [(-0.72, 0.44), (-0.62, 0.62), (-0.48, 0.80),
        (0.45, 0.60), (0.62, 0.40), (-1.2, 0.0), (1.2, 0.0), (-1.2, 0.9), (1.2, 0.9)]
WARP_TOP = 1.06             # no warp above this height (m)


def _edges(pts):
    """centre line -> centre + both edge points (2D normal of the polyline at each point)"""
    P = np.asarray(pts, float)
    out = []
    for i in range(len(P)):
        a, b = P[max(0, i - 1)], P[min(len(P) - 1, i + 1)]
        t = (b - a) / (np.linalg.norm(b - a) + 1e-9)
        n = np.array([-t[1], t[0]])
        out += [P[i], P[i] + n * LEG_HALF, P[i] - n * LEG_HALF]
    return out


def warp_legs(im: np.ndarray, M: np.ndarray, height: float):
    """thin-plate-spline re-pose of the painted legs (model leg -> painted leg), per view, below WARP_TOP"""
    from scipy.interpolate import RBFInterpolator
    from scipy.ndimage import map_coordinates
    H, W, _ = im.shape
    out, Mo = im.copy(), M.astype(np.float32).copy()
    for side in ("front", "back"):
        f = FRAME[side]
        k = (f["ground"] - f["top"]) / height
        sg = 1.0 if side == "front" else -1.0
        src, dst = [], []
        for s in ("R", "L"):
            # hip..ankle with both edges; the heel and the toe as single points (the foot turns: no edge normals)
            src += _edges(MODEL_LEG[s][:5]) + list(MODEL_LEG[s][5:])
            dst += _edges(CONCEPT_LEG[side][s][:5]) + list(CONCEPT_LEG[side][s][5:])
        src += HOLD
        dst += HOLD
        src, dst = np.asarray(src), np.asarray(dst)
        rbf = RBFInterpolator(src, dst - src, kernel="thin_plate_spline", smoothing=1e-4)
        x0 = 0 if side == "front" else W // 2
        x1 = W // 2 if side == "front" else W
        r0 = int(f["ground"] - WARP_TOP * k)
        yy, xx = np.mgrid[r0:H, x0:x1]
        mx = sg * (xx - f["cx"]) / k
        mz = (f["ground"] - yy) / k
        d = rbf(np.stack([mx.ravel(), mz.ravel()], 1)).reshape(mx.shape + (2,))
        # fade the warp in below the belt line (no seam at WARP_TOP)
        fade = np.clip((WARP_TOP - mz) / 0.08, 0, 1)[..., None]
        cx_ = mx + d[..., 0:1][..., 0] * fade[..., 0]
        cz_ = mz + d[..., 1:2][..., 0] * fade[..., 0]
        px = f["cx"] + sg * cx_ * k
        py = f["ground"] - cz_ * k
        for ch in range(3):
            out[r0:H, x0:x1, ch] = map_coordinates(im[..., ch], [py, px], order=1, mode="nearest")
        Mo[r0:H, x0:x1] = map_coordinates(M.astype(np.float32), [py, px], order=1, mode="nearest")
    return out, Mo > 0.5


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--erode", type=int, default=9)
    ap.add_argument("--height", type=float, default=1.98)
    a = ap.parse_args()
    src = GAME / "_design" / "concept" / f"{FID}.webp"
    out = ART / ".cache" / "concept"
    out.mkdir(parents=True, exist_ok=True)
    im0 = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
    H, W, _ = im0.shape
    M0 = figure_mask(im0)
    im, M = stretch_left_leg(im0, M0)
    im, M = warp_legs(im, M, a.height)
    lum = im.mean(axis=2)
    mx, mn = im.max(axis=2), im.min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1)
    neutral = sat < 0.04
    meta = {"size": [W, H], "id": FID}
    halves = (("front", (0, W // 2)), ("back", (W // 2, W)))
    keep = nd.binary_erosion(M, iterations=a.erode)
    for side, (x0, x1) in halves:
        meta[side] = dict(FRAME[side])
        g, t = FRAME[side]["ground"], FRAME[side]["top"]
        keep[g + 1:, x0:x1] = False
        # the floor shadow: only neutral pale pixels near the soles leave the cut
        band = slice(g - 60, g + 1)
        keep[band, x0:x1] &= ~((lum[band, x0:x1] > 120) & neutral[band, x0:x1])
        keep[:, x0:x1] = nd.binary_opening(keep[:, x0:x1], iterations=2)
        # the thin knob is eroded away by the outline cut: keep its dark core
        knob = slice(t, t + 75)
        keep[knob, x0:x1] |= nd.binary_erosion(M[knob, x0:x1], iterations=3) & (lum[knob, x0:x1] < 140)
    # the blue studs (hat rim) and the brooch: erase + refill from the surrounding paint
    blue = (im[..., 2] > im[..., 0] + 30) & (sat > 0.25) & M
    zone = np.zeros_like(M)
    for side, (x0, x1) in halves:
        g, t = FRAME[side]["ground"], FRAME[side]["top"]
        zone[t: int(g - 1.20 / a.height * (g - t)), x0:x1] = True
    er = nd.binary_dilation(nd.binary_closing(blue & zone, iterations=2), iterations=6)
    keep_er = keep & ~er
    _, (iy, ix) = nd.distance_transform_edt(~keep_er, return_indices=True)
    padded = im[iy, ix]
    soft = np.stack([nd.gaussian_filter(padded[..., c], 5) for c in range(3)], -1)
    padded = np.where(keep_er[..., None], im, soft)
    if er.any():
        # refill the studs from the rim's own dark paint (never the pale hat): nearest dark pixel, softened
        src_ok = keep_er & (lum < 120)
        _, (jy, jx) = nd.distance_transform_edt(~src_ok, return_indices=True)
        fill = np.stack([nd.gaussian_filter(im[jy, jx][..., c], 2) for c in range(3)], -1)
        a_ = nd.gaussian_filter((er & M).astype(np.float32), 2)[..., None]
        padded = padded * (1 - a_) + fill * a_
    for side, _ in halves:
        Image.fromarray(padded.clip(0, 255).astype(np.uint8)).save(out / f"{FID}_{side}.png")
    Image.fromarray((keep * 255).astype(np.uint8)).save(out / f"{FID}_mask.png")
    meta["m_per_px"] = a.height / (FRAME["front"]["ground"] - FRAME["front"]["top"])
    meta["height"] = a.height
    (out / f"{FID}_plates.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta))


if __name__ == "__main__":
    main()
