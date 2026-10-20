#!/usr/bin/env python3
"""Brightwick projection plates (both factions): art/tools/concept_plates.py's cut with the fixes these two
concepts need, then the painted-glow erase and the palette grade of brief §2.3-2.4 / §5.2.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/wick_brightwick_plates.py [--faction aubade|serenade|both]

Reads _design/concept/wicks/brightwick_<faction>.webp; writes art/.cache/concept/wicks/brightwick_<faction>_bw_
{front,back,mask}.png + _plates.json (the PROJECTION concept `wicks/brightwick_<faction>_bw`, height 1.70) and a
review image art/renders/units/_brightwick_<faction>_plates.jpg (mask outline red, erased paint cyan).

Fixes over the default cut (art/.cache/concept/wicks/brightwick_<faction>_*):
  * MASK: Aubade's chalk pauldrons, crown points, staff foot and lantern frame are pale on a pale background and
    the default cut drops them. A smooth background estimate (normalised convolution far from the figure) and a
    low threshold (7 levels; background noise p99 is 3.5) recovers them; only components touching the default
    cut join. Floor shadow and the background between the boots are trimmed like the shared script. The cut is
    eroded 3 px (no white halo on these sheets, only anti-aliased edges).
  * FRAME: the projection scale is fixed per faction (Aubade 709.3 px/m: crown points at 1.70 m, hood dome
    1.75; Serenade 744 px/m: dome top 1.70). `top` is written as ground - 1.70 * ppm (a virtual row) so
    PROJECTION height 1.70 reproduces that scale. cx stays the default (hem/boot centre); Aubade's front view is
    painted slightly turned to the wick's left, which the build corrects with a yaw in the paint pose.
  * GLOW: painted lamp glow is not team colour (brief §4): the crown lamps, the hood seam and tabard/back stripes
    (Aubade blue), the crown windows, sash and chevron (Serenade amber) and the lantern glow are refilled from
    the paint around them. The accent geometry carries all the light.
  * GRADE (brief §2.3-2.4): Aubade's bottom quarter darkens to L* 30-40 (a value ramp toward the hem);
    Serenade's warm hues are soft-clipped to <= 40 % saturation (the concept paints the cloak at 78 %), its
    darks lifted a little and its top band lifted toward the palette.
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

CACHE = ART / ".cache" / "concept" / "wicks"
HEIGHT = 1.70
FRAMES = {
    "aubade": {"ppm": 709.3, "front": {"cx": 473.0, "ground": 1404}, "back": {"cx": 1568.5, "ground": 1402}},
    "serenade": {"ppm": 744.0, "front": {"cx": 541.5, "ground": 1408}, "back": {"cx": 1489.5, "ground": 1407}},
}
SIDES = {"front": (0, 1024), "back": (1024, 2048)}

# painted glow to erase: (side, (x0, x1, z0, z1) in model metres, test, source)
#   test   blue: saturated bright blue (lamps, stripes, seam)      pale: any bluish-bright pixel (lantern + halo)
#          amber: saturated bright warm (windows, sash, chevron, lantern)
#   source chalk: refill only from light, unsaturated paint        any: from every other figure pixel
#          dark: refill only from darker paint (iron bands, cages)
ERASE = {
    "aubade": [
        ("front", (-0.30, 0.34, 1.52, 1.80), "blue", "any"),         # crown lamps + the seam over the dome
        ("front", (-0.02, 0.12, 1.62, 1.80), "seam", "any"),         # the pale seam on the dome's front
        ("front", (-0.06, 0.24, 0.12, 1.20), "blue", "chalk"),       # tabard edge stripes + chevron
        ("front", (0.47, 0.85, 1.29, 1.90), "pale", "chalk"),        # staff lantern panes + halo (clear of the L mitt)
        ("back", (-0.30, 0.30, 1.50, 1.80), "blue", "any"),          # crown lamps (back)
        ("back", (-0.06, 0.06, 0.05, 1.80), "blue", "any"),          # seam down the hood + the cloak's back stripe
        ("back", (0.40, 0.90, 1.20, 1.90), "pale", "chalk"),         # staff lantern (back view, wick's left)
        ("back", (0.34, 0.54, 0.42, 0.99), "chalky", "cloth"),       # the staff painted down the cloak's edge
    ],
    "serenade": [
        ("front", (-0.24, 0.24, 1.50, 1.68), "amber", "dark"),       # crown windows
        ("front", (-0.14, 0.16, 0.30, 1.02), "amber", "any"),        # sash bands + tabard chevron
        ("front", (0.35, 0.80, 0.90, 1.45), "amber", "dark"),        # staff lantern
        ("back", (-0.24, 0.24, 1.48, 1.66), "amber", "dark"),        # crown windows (back)
        ("back", (0.40, 0.85, 0.90, 1.40), "amber", "dark"),         # staff lantern (back view)
    ],
}


def model_box_to_px(side: str, fr: dict, box) -> tuple:
    x0, x1, z0, z1 = box
    f = fr[side]
    k = fr["ppm"]
    sign = 1.0 if side == "front" else -1.0
    xs = sorted([f["cx"] + sign * x0 * k, f["cx"] + sign * x1 * k])
    return int(xs[0]), int(xs[1]), int(f["ground"] - z1 * k), int(f["ground"] - z0 * k)


def background(im: np.ndarray, M0: np.ndarray) -> np.ndarray:
    far = ~nd.binary_dilation(M0, iterations=30)
    w = far.astype(np.float32)
    num = np.stack([nd.gaussian_filter(im[..., c] * w, 60) for c in range(3)], -1)
    den = nd.gaussian_filter(w, 60)[..., None] + 1e-6
    return num / den


def cut(im: np.ndarray, fr: dict) -> tuple:
    """(keep mask, figure mask before erosion, background estimate)"""
    M0 = cp.figure_mask(im)
    bg = background(im, M0)
    d = np.linalg.norm(nd.gaussian_filter(im, (1.2, 1.2, 0)) - bg, axis=2)
    C = nd.binary_fill_holes(nd.binary_closing(d > 7.0, iterations=3))
    C = nd.binary_opening(C, iterations=2)
    lbl, _ = nd.label(C)
    M = nd.binary_fill_holes(np.isin(lbl, np.unique(lbl[M0 & (lbl > 0)])) & (lbl > 0) | M0)
    lum = im.mean(axis=2)
    H = im.shape[0]
    for side, (x0, x1) in SIDES.items():
        g = fr[side]["ground"]
        M[g + 1:, x0:x1] = False
        # near the soles only the dark boots (the floor shadow is a pale ellipse)
        band = slice(g - 90, g + 1)
        boot = nd.binary_closing(nd.binary_opening(lum[band, x0:x1] < 150, iterations=2), iterations=6)
        M[band, x0:x1] &= boot | (d[band, x0:x1] > 40)
        # below the hem: background seen between the boots
        legs = slice(g - int(0.19 * HEIGHT * fr["ppm"]), g + 1)
        M[legs, x0:x1] &= d[legs, x0:x1] > 12
        M[:, x0:x1] = nd.binary_opening(M[:, x0:x1], iterations=2)
    lbl, n = nd.label(M)
    sizes = nd.sum(M, lbl, range(1, n + 1))
    M = np.isin(lbl, np.argsort(sizes)[::-1][:2] + 1)
    keep = nd.binary_erosion(M, iterations=3)
    return keep, M, bg


def tests(im: np.ndarray) -> dict:
    mx, mn = im.max(axis=2), im.min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1.0)
    r, b = im[..., 0], im[..., 2]
    return {"blue": (sat > 0.30) & (b - r > 40) & (mx > 165),
            "seam": (sat > 0.24) & (b - r > 45) & (mx > 200),
            "chalky": (mx > 120) & (sat < 0.12) & (b - r < 14),
            "pale": (b - r > 8) & (mx > 185),
            "amber": (sat > 0.55) & (mx > 200) & (r - b > 90)}


def erase(im: np.ndarray, keep: np.ndarray, fr: dict, specs: list) -> tuple:
    """Refill painted glow from the paint around it. Returns (image, erased mask)."""
    T = tests(im)
    lum = im.mean(axis=2)
    mx, mn = im.max(axis=2), im.min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1.0)
    out = im.copy()
    b_minus_r = im[..., 2] - im[..., 0]
    erased = np.zeros(keep.shape, dtype=bool)
    for side, box, test, source in specs:
        x0, x1, y0, y1 = model_box_to_px(side, fr, box)
        reg = np.zeros_like(keep)
        reg[max(0, y0):y1, max(0, x0):x1] = True
        hole = reg & T[test]
        hole = nd.binary_dilation(nd.binary_closing(hole, iterations=2), iterations=4) & reg
        if not hole.any():
            continue
        src = keep & ~hole & ~erased
        if source == "chalk":
            src &= (lum > 150) & (sat < 0.12)
        elif source == "dark":
            src &= lum < 110
        elif source == "cloth":
            src &= (b_minus_r > 10) & (sat > 0.06)
        win = nd.binary_dilation(reg, iterations=60)
        src &= win
        if not src.any():
            src = keep & ~hole
        _, (iy, ix) = nd.distance_transform_edt(~src, return_indices=True)
        fill = out[iy, ix]
        fill = np.stack([nd.gaussian_filter(fill[..., c], 3.0) for c in range(3)], -1)
        a = nd.gaussian_filter(hole.astype(np.float32), 1.5)[..., None]
        out = out * (1 - a) + fill * a
        erased |= hole
    return out, erased


def model_z(fr: dict, side: str, H: int) -> np.ndarray:
    f = fr[side]
    return (f["ground"] - np.arange(H, dtype=np.float32)) / fr["ppm"]


def ramp(z: np.ndarray, keys: list) -> np.ndarray:
    zs, vs = zip(*keys)
    return np.interp(z, zs, vs).astype(np.float32)


def grade(im: np.ndarray, fac: str, fr: dict) -> np.ndarray:
    """Palette grade in HSV (brief §2.3-2.4). im 0..255 float."""
    H, W, _ = im.shape
    x = im / 255.0
    mx, mn = x.max(axis=2), x.min(axis=2)
    d = np.maximum(mx - mn, 1e-6)
    r, g, b = x[..., 0], x[..., 1], x[..., 2]
    hue = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60.0
    s = np.where(mx > 1e-4, (mx - mn) / np.maximum(mx, 1e-4), 0.0)
    v = mx.copy()
    zz = np.zeros((H, W), dtype=np.float32)
    for side, (x0, x1) in SIDES.items():
        zz[:, x0:x1] = model_z(fr, side, H)[:, None]
    if fac == "serenade":
        warm = np.clip(np.minimum(hue + 15.0, 62.0 - hue) / 8.0, 0, 1) * (mx - mn > 0.01)
        s2 = 0.40 * np.tanh(s / 0.40)
        s = s * (1 - warm) + s2 * warm
        v = v * (1 - warm) + (v ** 0.88) * warm                      # lift the umber darks toward L* 40
        v = v * ramp(zz, [(1.02, 1.0), (1.25, 1.10), (1.9, 1.12)])   # top band toward the palette (L* 70-80)
    else:
        v = v * ramp(zz, [(0.0, 0.62), (0.14, 0.64), (0.45, 0.80), (0.90, 0.94), (1.20, 1.0)])
        s = s * ramp(zz, [(0.0, 1.05), (0.5, 1.0)])
    v = np.clip(v, 0, 1)
    s = np.clip(s, 0, 1)
    # back to RGB (HSV)
    h6 = (hue / 60.0) % 6
    c = v * s
    xx = c * (1 - np.abs(h6 % 2 - 1))
    m = v - c
    z0 = np.zeros_like(c)
    sel = [(h6 < 1), (h6 >= 1) & (h6 < 2), (h6 >= 2) & (h6 < 3), (h6 >= 3) & (h6 < 4), (h6 >= 4) & (h6 < 5), (h6 >= 5)]
    trip = [(c, xx, z0), (xx, c, z0), (z0, c, xx), (z0, xx, c), (xx, z0, c), (c, z0, xx)]
    rgb = np.zeros_like(x)
    for sl, (a, b_, c_) in zip(sel, trip):
        rgb[sl] = np.stack([a[sl], b_[sl], c_[sl]], -1)
    rgb += m[..., None]
    return np.clip(rgb * 255.0, 0, 255)


def build(fac: str) -> dict:
    fr = FRAMES[fac]
    src = GAME / "_design" / "concept" / "wicks" / f"brightwick_{fac}.webp"
    im = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
    keep, M, _ = cut(im, fr)
    im2, erased = erase(im, keep, fr, ERASE[fac])
    _, (iy, ix) = nd.distance_transform_edt(~keep, return_indices=True)
    padded = im2[iy, ix]
    soft = np.stack([nd.gaussian_filter(padded[..., c], 5) for c in range(3)], -1)
    padded = np.where(keep[..., None], im2, soft)
    graded = grade(padded, fac, fr)
    cid = f"brightwick_{fac}_bw"
    CACHE.mkdir(parents=True, exist_ok=True)
    for side in ("front", "back"):
        Image.fromarray(graded.astype(np.uint8)).save(CACHE / f"{cid}_{side}.png")
    Image.fromarray((keep * 255).astype(np.uint8)).save(CACHE / f"{cid}_mask.png")
    H, W, _ = im.shape
    meta = {"size": [W, H], "id": f"wicks/{cid}", "m_per_px": 1.0 / fr["ppm"], "height": HEIGHT}
    for side in ("front", "back"):
        f = fr[side]
        meta[side] = {"cx": f["cx"], "ground": f["ground"], "top": round(f["ground"] - HEIGHT * fr["ppm"], 2)}
    (CACHE / f"{cid}_plates.json").write_text(json.dumps(meta, indent=2))
    # review image: graded plate, mask outline red, erased paint cyan
    rev = graded.copy()
    e = M & ~nd.binary_erosion(M, iterations=2)
    rev[e] = (255, 0, 0)
    rev[erased] = rev[erased] * 0.4 + np.array([0, 255, 255]) * 0.6
    Image.fromarray(rev.astype(np.uint8)).resize((W // 2, H // 2)).save(
        GAME / "art" / "renders" / "units" / f"_brightwick_{fac}_plates.jpg", quality=88)
    print(json.dumps({"faction": fac, "erased_px": int(erased.sum()), "keep_px": int(keep.sum()), **meta}))
    return meta


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--faction", default="both", choices=("aubade", "serenade", "both"))
    a = ap.parse_args()
    for fac in (("aubade", "serenade") if a.faction == "both" else (a.faction,)):
        build(fac)


if __name__ == "__main__":
    main()
