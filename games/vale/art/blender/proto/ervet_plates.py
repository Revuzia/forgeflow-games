#!/usr/bin/env python3
"""Ervet's projection plates: art/tools/concept_plates.py with the fixes this concept needs.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/ervet_plates.py --height 2.15

Fixes before the plates are written (everything else is the shared script unchanged):
  * the pale chalk helmet and crest sit on a pale background, so the shared cut bites holes out of them:
    inside the head boxes, pixels that differ from the local background by a lower threshold and touch
    the cut join it, then holes are filled;
  * the pale-blue blade tips fade into the background: bluish pixels (B - R > 12) near the cut join it;
  * pale background seen between the legs under the coat hem and between the right arm and the coat in
    the back view is cut away (near-background colour, low saturation, not bluish).
After the shared script, two plate edits:
  * painted blue GEMS on the body (shoulder clasps, belt, the mantle's back) are painted out (the brief
    bans gems; the visor slit and the crossguard/pommel inlays are real `accent` geometry instead);
  * BLADE-FREE plates `ervet_{front,back}_body.png`: the sword (blade, crossguard, grip, pommel) is
    inpainted out of the body behind it, across the blade, so body texels the sword hides in the concept
    (and the coat the back view paints the blade over) take the coat/greave paint, never ghost blades.
Writes art/.cache/concept/ervet_{front,back,mask}.png, ervet_plates.json, ervet_{front,back}_body.png,
ervet_sword_mask.png (the inpainted band) and ervet_check.png (mask overlay for review).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as nd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent / "tools"))
import concept_plates as cp  # noqa: E402

ART = HERE.parent.parent
CACHE = ART / ".cache" / "concept"
_shared = cp.figure_mask

# head boxes (rows, cols) in the 2048 x 1536 concept: front figure left, back figure right
HEAD = {"front": (slice(140, 400), slice(400, 720)), "back": (slice(130, 330), slice(1330, 1620))}
# the sword in each view, concept px: (crossguard centre, blade tip, blade half-width), the guard
# box (x0, y0, x1, y1) and the grip line (hand -> pommel end, half-width)
SWORD = {
    "front": {"root": (365, 830), "tip": (980, 1276), "hw": 38, "guard": (250, 738, 472, 960),
              "grip": ((256, 744), (158, 668), 28), "no_src": [(700, 760, 820, 880)]},
    "back": {"root": (1680, 832), "tip": (1058, 1276), "hw": 38, "guard": (1595, 738, 1845, 960),
             "grip": ((1774, 742), (1872, 670), 28)},
}


def bg_estimate(im: np.ndarray, M: np.ndarray, sigma: float = 40.0) -> np.ndarray:
    w = (~nd.binary_dilation(M, iterations=20)).astype(np.float32)
    num = np.stack([nd.gaussian_filter(im[..., c] * w, sigma) for c in range(3)], -1)
    den = nd.gaussian_filter(w, sigma)[..., None] + 1e-6
    return num / den


def figure_mask(im: np.ndarray, thresh: float = 22.0, iters: int = 4) -> np.ndarray:
    M = _shared(im, thresh, iters)
    bg = bg_estimate(im, M)
    d = np.linalg.norm(im - bg, axis=2)
    lum = im.mean(axis=2)
    R, G, B = im[..., 0], im[..., 1], im[..., 2]
    # 1. helmet + crest: lower threshold inside the head boxes, connected to the cut, holes filled
    for side, (rs, cs) in HEAD.items():
        sub = (d[rs, cs] > 9.0) | M[rs, cs]
        sub = nd.binary_opening(sub, iterations=1)
        lbl, n = nd.label(sub)
        keep = np.unique(lbl[M[rs, cs]])
        sub = np.isin(lbl, keep[keep > 0])
        sub = nd.binary_closing(sub, iterations=4)
        sub = nd.binary_fill_holes(sub)
        sub = nd.binary_opening(sub, iterations=2)
        M[rs, cs] |= sub
    # 2. blade tips: bluish pixels near the cut (lower half only: the blades)
    blu = (B - R > 12) & (d > 8)
    blu[:700] = False
    near = nd.binary_dilation(M, iterations=40)
    lbl, n = nd.label(blu & near | M)
    keep = np.unique(lbl[M])
    M |= np.isin(lbl, keep[keep > 0]) & blu
    M = nd.binary_closing(M, iterations=2)
    # 3. pale background gaps: near the background colour, pale, not bluish; between the legs under the
    #    hem (rows > 1080) and between the right arm and the coat in the back view
    sat = im.max(axis=2) - im.min(axis=2)
    gap = ((d < 16) | (sat < 16)) & (lum > 180) & (B - R < 10)
    region = np.zeros_like(M)
    region[1080:] = True
    region[560:860, 1560:1760] = True
    region[560:860, 260:420] = True
    gap &= region
    gap = nd.binary_opening(gap, iterations=2)
    lbl, n = nd.label(gap)
    if n:
        sizes = nd.sum(gap, lbl, range(1, n + 1))
        gap = np.isin(lbl, np.nonzero(sizes > 150)[0] + 1)
        gap = nd.binary_dilation(gap, iterations=3)
    M &= ~gap
    return nd.binary_opening(M, iterations=1)


def line_coords(shape, p0, p1):
    """per pixel: (t along p0->p1 in px, s signed across, unit dir, unit normal)"""
    H, W = shape
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    p0 = np.asarray(p0, np.float32)
    p1 = np.asarray(p1, np.float32)
    u = (p1 - p0) / np.linalg.norm(p1 - p0)
    n = np.array([-u[1], u[0]], np.float32)
    dx, dy = xx - p0[0], yy - p0[1]
    return dx * u[0] + dy * u[1], dx * n[0] + dy * n[1], u, n


def sword_band(shape, sw: dict):
    """(blade + grip band, crossguard rectangle) masks for one view"""
    t, s, u, n = line_coords(shape, sw["root"], sw["tip"])
    L = np.linalg.norm(np.subtract(sw["tip"], sw["root"]))
    band = (t > -10) & (t < L + 20) & (np.abs(s) < sw["hw"] * np.clip(1.0 - (t - L + 140) / 200, 0.35, 1.0))
    (a, b, hw) = sw["grip"]
    tg, sg, _, _ = line_coords(shape, a, b)
    Lg = np.linalg.norm(np.subtract(b, a))
    band |= (tg > -6) & (tg < Lg + 16) & (np.abs(sg) < hw)
    guard = (t > -40) & (t < 80) & (np.abs(s) < 118)
    return band, guard


def inpaint_across(img: np.ndarray, src: np.ndarray, hole: np.ndarray, d, reach: int = 70) -> np.ndarray:
    """Fill `hole` pixels from `src` paint on either side along direction d (unit, px): walk both ways to
    the first source pixel and blend the two by distance. Returns (filled image, filled mask)."""
    H, W = hole.shape
    out = img.copy()
    ys, xs = np.nonzero(hole)
    acc = np.zeros((len(ys), 3), np.float32)
    wsum = np.zeros(len(ys), np.float32)
    for sign in (1.0, -1.0):
        found = np.zeros(len(ys), bool)
        col = np.zeros((len(ys), 3), np.float32)
        dist = np.zeros(len(ys), np.float32)
        for k in range(1, reach):
            px = np.clip(np.round(xs + sign * d[0] * k).astype(int), 0, W - 1)
            py = np.clip(np.round(ys + sign * d[1] * k).astype(int), 0, H - 1)
            hit = ~found & src[py, px]
            if hit.any():
                px2 = np.clip(np.round(xs + sign * d[0] * (k + 3)).astype(int), 0, W - 1)
                py2 = np.clip(np.round(ys + sign * d[1] * (k + 3)).astype(int), 0, H - 1)
                ok2 = src[py2, px2]
                c = img[py[hit], px[hit]].astype(np.float32)
                c2 = np.where(ok2[hit][:, None], img[py2[hit], px2[hit]].astype(np.float32), c)
                col[hit] = 0.5 * (c + c2)
                dist[hit] = k
                found |= hit
        w = np.where(found, 1.0 / np.maximum(dist, 1.0), 0.0)
        acc += col * w[:, None]
        wsum += w
    ok = wsum > 0
    out[ys[ok], xs[ok]] = acc[ok] / wsum[ok][:, None]
    done = np.zeros_like(hole)
    done[ys[ok], xs[ok]] = True
    return out, done


def fill_hole(img: np.ndarray, fig: np.ndarray, hole: np.ndarray, cx: float, sw: dict, mirror_from: int,
              no_src=None) -> np.ndarray:
    """Paint the body behind the sword: the MIRRORED body paint (the figure is near-symmetric; real painted
    greaves, coat folds and trims) where the mirror pixel is clean body below row `mirror_from`, else paint
    interpolated across the blade (crossguard: along the blade); the leftovers take the nearest body paint.
    Each fill matches the local mean of the paint around it and the seams are feathered."""
    H, W = hole.shape
    out = img.copy()
    src = fig & ~hole
    msrc = src.copy()
    for (x0, y0, x1, y1) in (no_src or ()):
        msrc[y0:y1, x0:x1] = False                              # never mirror these (the free fist)
    ys, xs = np.nonzero(hole)
    mx = np.round(2 * cx - xs).astype(int)
    okm = (mx >= 0) & (mx < W) & (ys >= mirror_from)
    okm[okm] = msrc[ys[okm], mx[okm]]
    filled = np.zeros_like(hole)
    out[ys[okm], xs[okm]] = img[ys[okm], mx[okm]]
    filled[ys[okm], xs[okm]] = True
    # mirrored paint is matched to the local mean around the hole (lighting differs side to side)
    if okm.any():
        ring = nd.binary_dilation(hole, iterations=10) & src
        loc = np.stack([nd.gaussian_filter(np.where(ring, img[..., c], 0), 18) for c in range(3)], -1)
        locw = nd.gaussian_filter(ring.astype(np.float32), 18)[..., None]
        mirr = np.zeros_like(img)
        mirr[ys[okm], xs[okm]] = img[ys[okm], mx[okm]]
        mm = np.stack([nd.gaussian_filter(np.where(filled, mirr[..., c], 0), 18) for c in range(3)], -1)
        mw = nd.gaussian_filter(filled.astype(np.float32), 18)[..., None]
        gain = (loc / np.maximum(locw, 1e-3) + 1.0) / (mm / np.maximum(mw, 1e-3) + 1.0)
        gain = np.clip(gain, 0.7, 1.4)
        out[filled] = out[filled] * gain[filled]
    rest = hole & ~filled
    t, s, u, n = line_coords(hole.shape, sw["root"], sw["tip"])
    guard = (t > -40) & (t < 80) & (np.abs(s) < 118)
    for region, d in ((rest & ~guard, n), (rest & guard, n)):
        if region.any():
            o2, done = inpaint_across(out, src | filled, region, d)
            out[done] = o2[done]
            filled |= done
    miss = hole & ~filled
    if miss.any():
        _, (iy, ix) = nd.distance_transform_edt(~(src | filled), return_indices=True)
        out[miss] = out[iy[miss], ix[miss]]
    soft = np.stack([nd.gaussian_filter(out[..., c], 1.6) for c in range(3)], -1)
    a = nd.gaussian_filter(hole.astype(np.float32), 1.0)[..., None]
    edge = np.clip(a * (1 - a) * 4, 0, 1)                       # feather the seam only
    return out * (1 - edge) + soft * edge


def erase_gems(img: np.ndarray, fig: np.ndarray, protect: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """paint out saturated blue gems on the body (not the sword, not the visor slit)"""
    mx, mn = img.max(axis=2), img.min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1)
    R, B = img[..., 0], img[..., 2]
    gem = fig & (B > R + 45) & (sat > 0.42) & ~protect
    gem = nd.binary_opening(gem, iterations=1)
    gem = nd.binary_dilation(gem, iterations=5)
    src = fig & ~gem & ~(B > R + 30)
    _, (iy, ix) = nd.distance_transform_edt(~src, return_indices=True)
    fill = img[iy, ix].astype(np.float32)
    fill = np.stack([nd.gaussian_filter(fill[..., c], 3) for c in range(3)], -1)
    a = nd.gaussian_filter(gem.astype(np.float32), 2.0)[..., None]
    return img * (1 - a) + fill * a, gem


def recentre(keep: np.ndarray, meta: dict, height: float) -> dict:
    """The shared centre is the mean of the lower fifth's columns, which here includes the blade tip; the
    body's own midline is the middle of the two shins (z 0.2-0.4 m) - the model is built about it."""
    for side, (x0, x1) in (("front", (0, keep.shape[1] // 2)), ("back", (keep.shape[1] // 2, keep.shape[1]))):
        i = meta[side]
        k = (i["ground"] - i["top"]) / height
        mids = []
        for z in np.arange(0.20, 0.41, 0.02):
            y = int(round(i["ground"] - z * k))
            r = np.nonzero(keep[y, x0:x1])[0] + x0
            if len(r) < 2:
                continue
            br = np.nonzero(np.diff(r) > 20)[0]
            if len(br) != 1:
                continue
            a, b = r[: br[0] + 1], r[br[0] + 1:]
            mids.append(0.25 * (a[0] + a[-1] + b[0] + b[-1]))
        if mids:
            i["cx_shared"] = i["cx"]
            i["cx"] = float(np.median(mids))
    return meta


def main() -> None:
    cp.figure_mask = figure_mask
    argv = sys.argv[1:]
    sys.argv = [sys.argv[0], "ervet"] + argv
    height = float(argv[argv.index("--height") + 1]) if "--height" in argv else 2.15
    cp.main()
    meta = json.loads((CACHE / "ervet_plates.json").read_text())
    meta = recentre(np.asarray(Image.open(CACHE / "ervet_mask.png")) > 0, meta, height)
    (CACHE / "ervet_plates.json").write_text(json.dumps(meta, indent=2))
    im = np.asarray(Image.open(ART.parent / "_design" / "concept" / "ervet.webp").convert("RGB")).astype(np.float32)
    plate = np.asarray(Image.open(CACHE / "ervet_front.png").convert("RGB")).astype(np.float32)
    keep = np.asarray(Image.open(CACHE / "ervet_mask.png")) > 0
    fig = nd.binary_dilation(keep, iterations=9)                 # the un-eroded figure
    H, W = keep.shape
    sword = np.zeros_like(keep)
    for side, sw in SWORD.items():
        band, guard = sword_band(keep.shape, sw)
        sword |= (band | guard) & fig
    # protect: the sword itself and the visor slit (head boxes) from the gem erase
    protect = nd.binary_dilation(sword, iterations=6)
    for rs, cs in HEAD.values():
        protect[rs, cs] = True
    plate, gems = erase_gems(plate, fig, protect)
    Image.fromarray(plate.clip(0, 255).astype(np.uint8)).save(CACHE / "ervet_front.png")
    Image.fromarray(plate.clip(0, 255).astype(np.uint8)).save(CACHE / "ervet_back.png")
    # blade-free body plates
    body = plate.copy()
    for side, sw in SWORD.items():
        x0 = 0 if side == "front" else W // 2
        x1 = W // 2 if side == "front" else W
        hole = np.zeros_like(sword)
        hole[:, x0:x1] = sword[:, x0:x1]
        body = fill_hole(body, fig, hole, meta[side]["cx"], sw, mirror_from=960, no_src=sw.get("no_src"))
    Image.fromarray(body.clip(0, 255).astype(np.uint8)).save(CACHE / "ervet_front_body.png")
    Image.fromarray(body.clip(0, 255).astype(np.uint8)).save(CACHE / "ervet_back_body.png")
    Image.fromarray((sword * 255).astype(np.uint8)).save(CACHE / "ervet_sword_mask.png")
    # review overlay: outside the cut magenta, the sword band cyan-tinted, erased gems yellow
    ov = im.copy()
    ov[~keep] = ov[~keep] * 0.35 + np.array([255, 0, 255]) * 0.33
    ov[sword & keep] = ov[sword & keep] * 0.6 + np.array([0, 255, 255]) * 0.4
    ov[gems] = ov[gems] * 0.4 + np.array([255, 255, 0]) * 0.6
    Image.fromarray(ov.clip(0, 255).astype(np.uint8)).save(CACHE / "ervet_check.png")
    print("plates", meta)


if __name__ == "__main__":
    main()
