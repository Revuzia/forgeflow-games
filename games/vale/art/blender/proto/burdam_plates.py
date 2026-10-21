#!/usr/bin/env python3
"""Burdam's projection plates: art/tools/concept_plates.py with the fixes this sheet needs.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/burdam_plates.py

Plate height 2.56 m = the cleaver's tip (the tallest painted part); the mask crown stands at 2.15 m
(content art.height), so both figures are scaled from their mask crowns (row 314 on both), not from the
blade tips (the back figure is painted 2 % smaller). Fixes over the shared cut:
  * the pale blade against the pale background: the shared cut bites the honed edge band; here the
    blade zone (above the shoulders) re-cuts with a low threshold against the background estimate,
    connected to the shared cut, then hole-filled;
  * the boot sole band: the shared trim opens a slice and leaves a 1 px seam across both boots;
  * centre: the front figure's right toe turns out further than the left, so the shared leg-extent
    centre sits 0.04 m off the body axis; cx = the legs' mid line (front 562, back 1474);
  * the blue notch gems (and the pommel gem) are geometry (`accent`), so they are painted out and
    refilled from the surrounding ironstone, not from light paint;
  * the BACK plate paints the hood over the blade, but the blade passes BEHIND the head (the front
    plate shows it there), so from the back the blade covers the hood's crown: the blade band over the
    head is bridged along the blade axis from the paint on either side of the head.
LAYERS (fighters/burdam.py paints the mask and the cleaver from their own plates, so neither takes the
other's paint where the two overlap in the concept):
  * burdam_head_{front,back}: the plates as painted (no back bridge: the gold cranium with its tally
    cuts), the painted head (gold segmentation, hole-filled) extended outward with its own rim paint, so a
    model head a little wider than the painting never samples blade, cowl or background;
  * burdam_cleaver_{front,back}: the back bridge as above, and on the FRONT the blade and heel behind the
    mask bridged the same way along the blade axis (no gold under the cleaver's outline).
Writes art/.cache/concept/burdam_{front,back}.png, burdam_mask.png, burdam_plates.json, the layer plates
(+ burdam_head_region_{front,back}.png, the painted head masks) and a debug overlay
burdam_plates_debug.png in the same folder.
"""
from __future__ import annotations

import json
import math
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
sys.path.insert(0, str(HERE))
import burdam_cleaver as cl  # noqa: E402

ID = "burdam"
HEIGHT = 2.56            # plate height: the cleaver tip
CROWN = 2.15             # the mask crown (content art.height)
CROWN_ROW = {"front": 314, "back": 314}
CX = {"front": 562.0, "back": 1474.0}
ERODE = 9
# the blade zone: rows above this are blade / pauldron tops / head only (z ~1.95 m)
BLADE_ROWS = 440


def background(im: np.ndarray, M: np.ndarray) -> np.ndarray:
    w = (~nd.binary_dilation(M, iterations=6)).astype(np.float32)
    num = np.stack([nd.gaussian_filter(im[..., c] * w, 50) for c in range(3)], -1)
    den = nd.gaussian_filter(w, 50)[..., None] + 1e-6
    return num / den


def figure_mask(im: np.ndarray) -> np.ndarray:
    M = cp.figure_mask(im)
    bg = background(im, M)
    df = nd.gaussian_filter(im - bg, (1.2, 1.2, 0))
    d = np.linalg.norm(df, axis=2)
    chroma = np.linalg.norm(df - df.mean(axis=2, keepdims=True), axis=2)   # the honed edge band is greener
    zone = np.zeros_like(M)
    zone[:BLADE_ROWS] = True
    near = nd.binary_dilation(M, iterations=26) & zone
    cand = ((d > 9.0) | (chroma > 4.5)) & near
    cand = nd.binary_opening(cand, iterations=1)
    lbl, n = nd.label(cand | M)
    keep = np.unique(lbl[M])
    add = np.isin(lbl, keep[keep > 0]) & cand
    out = M | add
    closed = nd.binary_fill_holes(nd.binary_closing(out, iterations=4))
    out[:BLADE_ROWS] = closed[:BLADE_ROWS]
    return out


def main() -> None:
    src = GAME / "_design" / "concept" / f"{ID}.webp"
    out = ART / ".cache" / "concept"
    out.mkdir(parents=True, exist_ok=True)
    im = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
    H, W, _ = im.shape
    M = figure_mask(im)
    lum = im.mean(axis=2)
    meta = {"size": [W, H], "id": ID}
    halves = (("front", (0, W // 2)), ("back", (W // 2, W)))
    for side, (x0, x1) in halves:
        m = M[:, x0:x1]
        dark = (lum[:, x0:x1] < 60) & m
        ground = int(np.where(dark.sum(1) > 30)[0][-1])
        top = ground - HEIGHT / CROWN * (ground - CROWN_ROW[side])
        meta[side] = {"cx": CX[side], "ground": ground, "top": round(float(top), 2)}
    keep = nd.binary_erosion(M, iterations=ERODE)
    for side, (x0, x1) in halves:
        g = meta[side]["ground"]
        keep[g + 1:, x0:x1] = False
        # near the soles keep the dark boot pixels only (the cast shadow is a pale ellipse); the band is
        # opened with margin above it so its top row does not leave a seam across the boots
        b0 = g - 90
        sub = lum[b0 - 12:g + 1, x0:x1] < 105
        sub = nd.binary_closing(nd.binary_opening(sub, iterations=2), iterations=6)[12:]
        keep[b0:g + 1, x0:x1] &= sub | (np.arange(b0, g + 1)[:, None] < b0 + 6) & keep[b0:g + 1, x0:x1]
        legs = slice(g - int(0.19 * (g - meta[side]["top"])), g + 1)
        keep[legs, x0:x1] &= ~(lum[legs, x0:x1] > 175)
        keep[:, x0:x1] = nd.binary_opening(keep[:, x0:x1], iterations=2)
    # the notch gems: saturated blue, painted out (they are `accent` geometry)
    mx, mn = im.max(axis=2), im.min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1)
    blue = (im[..., 2] > im[..., 0] + 35) & (sat > 0.35) & M
    blue = nd.binary_dilation(nd.binary_opening(blue, iterations=1), iterations=4)
    keep_paint = keep & ~blue
    _, (iy, ix) = nd.distance_transform_edt(~keep_paint, return_indices=True)
    padded = im[iy, ix]
    soft = np.stack([nd.gaussian_filter(padded[..., c], 5) for c in range(3)], -1)
    padded = np.where(keep_paint[..., None], im, soft)
    # refill the gem holes from the ironstone around them (nearest kept, not-blue pixel), softened
    fill = np.stack([nd.gaussian_filter(im[iy, ix][..., c], 2.5) for c in range(3)], -1)
    a = nd.gaussian_filter((blue & keep).astype(np.float32), 1.5)[..., None]
    padded = padded * (1 - a) + fill * a
    painted = padded.copy()
    padded = bridge_back_blade(padded, meta)
    for side, _ in halves:
        Image.fromarray(padded.clip(0, 255).astype(np.uint8)).save(out / f"{ID}_{side}.png")
    # the layer plates (see the module doc)
    heads = {side: head_region(im, side) for side, _ in halves}
    head_img = painted.copy()
    for side, (x0, x1) in halves:
        head_img[:, x0:x1] = extend_head(painted[:, x0:x1], heads[side][:, x0:x1])
        Image.fromarray((heads[side] * 255).astype(np.uint8)).save(out / f"{ID}_head_region_{side}.png")
    cleaver_img = bridge_front_blade(padded, meta, heads["front"])
    for layer, img_l in (("head", head_img), ("cleaver", cleaver_img)):
        for side, _ in halves:
            Image.fromarray(img_l.clip(0, 255).astype(np.uint8)).save(out / f"{ID}_{layer}_{side}.png")
        (out / f"{ID}_{layer}_plates.json").write_text(json.dumps(dict(meta, id=f"{ID}_{layer}"), indent=2))
    Image.fromarray((keep * 255).astype(np.uint8)).save(out / f"{ID}_mask.png")
    meta["m_per_px"] = (meta["front"]["ground"] - meta["front"]["top"]) and HEIGHT / (meta["front"]["ground"] - meta["front"]["top"])
    (out / f"{ID}_plates.json").write_text(json.dumps(meta, indent=2))
    dbg = im.copy()
    dbg[~keep] = dbg[~keep] * 0.35 + np.array([255, 0, 255]) * 0.65
    dbg[blue & keep] = [0, 255, 0]
    Image.fromarray(np.concatenate([dbg, padded], 0).clip(0, 255).astype(np.uint8)).resize((W // 2, H)).save(
        out / f"{ID}_plates_debug.png")
    print(json.dumps(meta))


# ── the painted head and its layer ────────────────────────────────────────────────────────────────
def head_region(im: np.ndarray, side: str) -> np.ndarray:
    """the painted gold mask / cranium: saturated ochre-gold pixels near the head, the largest blob,
    closed and hole-filled (the ink tally cuts and eye holes inside it count as head)"""
    W = im.shape[1]
    x0, x1 = (0, W // 2) if side == "front" else (W // 2, W)
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    mx, mn = im.max(axis=2), im.min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1)
    gold = (r > g) & (g > b + 22) & (sat > 0.30) & (r > 95)
    m = np.zeros(gold.shape, bool)
    m[200:560, x0:x1] = gold[200:560, x0:x1]
    m = nd.binary_opening(m, iterations=2)                 # drops the thin warm streak along the blade's edge
    lbl, n = nd.label(nd.binary_closing(m, iterations=3))
    sizes = nd.sum(m, lbl, range(1, n + 1))
    reg = lbl == (int(np.argmax(sizes)) + 1)
    reg = nd.binary_fill_holes(nd.binary_closing(reg, iterations=8))
    return nd.binary_opening(reg, iterations=3)


def extend_head(img: np.ndarray, reg: np.ndarray, band: int = 90) -> np.ndarray:
    """outside the painted head (a band around it) take the nearest head paint a few px inside its rim
    (past the dark outline), softened: a slightly wider model head keeps the lacquer to its silhouette"""
    src = nd.binary_erosion(reg, iterations=5)
    _, (iy, ix) = nd.distance_transform_edt(~src, return_indices=True)
    near = img[iy, ix]
    near = np.stack([nd.gaussian_filter(near[..., c], 2.5) for c in range(3)], -1)
    ring = nd.binary_dilation(reg, iterations=band) & ~nd.binary_erosion(reg, iterations=2)
    out = img.copy()
    out[ring] = near[ring]
    return out


def bridge_front_blade(img: np.ndarray, meta: dict, head: np.ndarray) -> np.ndarray:
    """Front plate: the mask stands in front of the cleaver. Where the cleaver (paint pose) runs behind the
    painted mask, repaint it with the cleaver's own paint from beside the mask along the blade axis (heel
    from the heel left of the mask, blade from the blade right of it), so no gold sits under its outline."""
    info = meta["front"]
    k = (info["ground"] - info["top"]) / HEIGHT
    to_px = lambda x, z: (info["cx"] + np.asarray(x) * k, info["ground"] - np.asarray(z) * k)  # noqa: E731
    over_px = nd.binary_dilation(head, iterations=7)
    ys, xs = np.nonzero(over_px)
    wx = (xs - info["cx"]) / k
    wz = (info["ground"] - ys) / k
    u, v = cl.to_uv(wx, wz)
    heel = cl.in_heel(u, v)
    blade = cl.in_blade(u, v) & ~heel
    hx = wx[(heel | blade)] if (heel | blade).any() else wx
    xl, xr = float(wx.min()) - 0.015, float(wx.max()) + 0.015     # the dilated mask's extent across the cleaver
    out = img.copy()
    for sel, xe in ((heel, xl), (blade, xr)):
        if not sel.any():
            continue
        uu, vv = u[sel], v[sel]
        ue = (xe - cl.G[0] - vv * cl.NV[0]) / cl.AX[0]
        shift = float((ue - uu).max()) if xe > 0 else float((ue - uu).min())
        su = uu + shift
        if xe > 0:
            e0, s0 = cl.v_edge(uu), cl.v_spine(uu)
            e1, s1 = cl.v_edge(su), cl.v_spine(su)
            vv = e1 + (vv - e0) / np.maximum(s0 - e0, 1e-3) * (s1 - e1)
        sx = cl.G[0] + su * cl.AX[0] + vv * cl.NV[0]
        sz = cl.G[1] + su * cl.AX[1] + vv * cl.NV[1]
        px, py = to_px(sx, sz)
        col = np.stack([nd.map_coordinates(img[..., c], [py, px], order=1, mode="nearest") for c in range(3)], -1)
        out[ys[sel], xs[sel]] = col
    del hx
    band = np.zeros(img.shape[:2], bool)
    band[ys[heel | blade], xs[heel | blade]] = True
    soft = np.stack([nd.gaussian_filter(out[..., c], 1.2) for c in range(3)], -1)
    edge = nd.binary_dilation(band, iterations=2) & ~nd.binary_erosion(band, iterations=2)
    out[edge] = soft[edge]
    return out


# ── the blade over the hood (back plate) ──────────────────────────────────────────────────────────
HOOD_X = (-0.165, 0.150)         # the hood's painted extent across the blade (world x, back view)
HOOD_Z0 = 1.93                   # above the cowl


def bridge_back_blade(img: np.ndarray, meta: dict) -> np.ndarray:
    """Back plate: where the cleaver (in its paint pose) crosses the painted hood, repaint it with the
    cleaver's own paint from beside the hood at the same distance across the blade: heel pixels from the
    heel to the right of the hood, blade pixels from the blade to its left (a crisp collar edge where the
    sculpt puts it)."""
    info = meta["back"]
    k = (info["ground"] - info["top"]) / HEIGHT
    to_px = lambda x, z: (info["cx"] - np.asarray(x) * k, info["ground"] - np.asarray(z) * k)  # noqa: E731
    xa, ya = to_px(HOOD_X[1] + 0.02, 2.45)
    xb, yb = to_px(HOOD_X[0] - 0.02, HOOD_Z0)
    ys, xs = np.mgrid[int(ya):int(yb) + 1, int(xa):int(xb) + 1]
    wx = (info["cx"] - xs) / k
    wz = (info["ground"] - ys) / k
    u, v = cl.to_uv(wx, wz)
    heel = cl.in_heel(u, v)
    blade = cl.in_blade(u, v) & ~heel
    FEATHER = 0.035
    over = (wx > HOOD_X[0] - FEATHER) & (wx < HOOD_X[1] + FEATHER) & (wz > HOOD_Z0)
    # 1 over the hood, ramping to 0 across FEATHER beyond its sides (the copy blends into the real paint)
    alpha = np.clip(np.minimum(wx - (HOOD_X[0] - FEATHER), (HOOD_X[1] + FEATHER) - wx) / FEATHER, 0, 1)
    out = img.copy()
    for sel, xe in ((heel & over, HOOD_X[0] - FEATHER - 0.02), (blade & over, HOOD_X[1] + FEATHER + 0.02)):
        if not sel.any():
            continue
        # copy a whole patch of the cleaver's own paint from beside the hood, shifted along the blade axis
        # (keeps the painted texture; a per-row sample would streak)
        uu, vv = u[sel], v[sel]
        ue = (xe - cl.G[0] - vv * cl.NV[0]) / cl.AX[0]
        shift = float((ue - uu).max()) if xe > 0 else float((ue - uu).min())
        su = uu + shift
        if xe > 0:                                    # follow the blade's taper: keep the same share across it
            e0, s0 = cl.v_edge(uu), cl.v_spine(uu)
            e1, s1 = cl.v_edge(su), cl.v_spine(su)
            vv = e1 + (vv - e0) / np.maximum(s0 - e0, 1e-3) * (s1 - e1)
        sx = cl.G[0] + su * cl.AX[0] + vv * cl.NV[0]
        sz = cl.G[1] + su * cl.AX[1] + vv * cl.NV[1]
        px, py = to_px(sx, sz)
        col = np.stack([nd.map_coordinates(img[..., c], [py, px], order=1, mode="nearest") for c in range(3)], -1)
        a = alpha[sel][:, None]
        out[ys[sel], xs[sel]] = img[ys[sel], xs[sel]] * (1 - a) + col * a
    # soften the bridge into its surroundings (1.5 px)
    soft = np.stack([nd.gaussian_filter(out[..., c], 1.2) for c in range(3)], -1)
    band = np.zeros(img.shape[:2], bool)
    band[ys[(heel | blade) & over], xs[(heel | blade) & over]] = True
    edge = nd.binary_dilation(band, iterations=2) & ~nd.binary_erosion(band, iterations=2)
    out[edge] = soft[edge]
    return out


if __name__ == "__main__":
    main()
