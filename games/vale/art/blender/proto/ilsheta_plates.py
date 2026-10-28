#!/usr/bin/env python3
"""Ilsheta's projection plates: art/tools/concept_plates.py's frame and padding with this sheet's own cut.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/ilsheta_plates.py

The shared cut (cp.figure_mask) fails this sheet: the pale linen mantle, the hood and the scarf sit within ~15 RGB
of the warm backdrop, so it cut big holes through the mantle's upper half, the hood and the clear chimney.
Here the cut is a FLOOD FILL of the backdrop from the sheet's border (Sukri's method): a pixel is backdrop when it
is close to a smooth backdrop estimate AND flat (the painted outline round the figure stops the fill). Everything
the fill does not reach is figure; above the shoulders every enclosed hole is figure (the hood, the clear chimney
whose glass shows the backdrop: that IS its paint), below them big flat islands of backdrop colour leave (between
the legs and the boots).
The HOOK-STAFF and the LAMP are modelled on their own (held in the right hand, painted in the module), so the
painted ones leave the plates: where the staff crosses the body (front: the dress, the apron, the leggings, the
mantle's left panel) its band is in-painted across (each band pixel interpolates the paint just outside the band
on both sides, perpendicular to the shaft, so the vertical panel edges carry through); where it and the lamp hang
off the body they leave the figure (front: the hook and the lamp at her left; back: the same seen from behind and
the shaft's foot between the boots). Build 3: the band crossed the mantle's left panel and sleeve diagonally and its
across-the-band blend left a muddy brown stripe there, the lamp's blue glow padded the sleeve's top: the sheet is
near-symmetric, so every prop-covered pixel whose MIRROR (about the figure's axis) is clean takes the mirrored paint
and figure state (the sleeve's top behind the lamp comes back); only pixels near the axis (the shaft's foot between
the boots) keep the across-the-band blend.
Frame: `top` = the chimney's top rim (1.72 m, the brief's height and content art.height), `ground` = the boot
soles, `cx` = the body's axis (the median mid-point of the largest run per row through the hood and the scarf).
Writes art/.cache/concept/ilsheta_{front,back}.png (edge-padded RGB), ilsheta_mask.png, ilsheta_plates.json and
a debug overlay art/renders/fighters/ilsheta/_fit/plates_mask.png (removed in red, in-painted in green).
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

ID = "ilsheta"
HEIGHT = 1.72             # the chimney's top rim (content art.height)
ERODE = 6                 # px off the edge (the anti-aliased outline)
HALO_PX, HALO_LUM = 12, 236
BG_DIST = 10.0            # RGB distance to the smooth backdrop estimate that still counts as backdrop
GRAD_MAX = 22.0           # ... and its (smoothed) Sobel gradient ceiling (painted edges stop the fill)
ISLAND_MIN = 900          # px: enclosed backdrop islands at least this big leave the figure (below the shoulders)
SHOULDER_Z = 1.16         # m: above this every enclosed hole is figure (the hood, the chimney)
HEM_Z = 0.52              # m: backdrop islands leave only below the mantle's hem (between the legs and the boots);
                          # above it the flat pale linen IS the figure (the shared cut's holes)

# the painted hook-staff's centre line (sheet px, front view), sole to the hook's root, and its half width
STAFF_F = [(545, 1374), (562, 1300), (585, 1200), (610, 1100), (636, 1000), (661, 900), (686, 800), (704, 700),
           (719, 600), (733, 500), (745, 420)]
STAFF_HW = 24.0           # the shaft (~26 px) and the blue glow painted down its right side
# off-body paint that leaves the figure (sheet px polygons): the hook and the lamp (front), the staff, hook and
# lamp seen from behind, the shaft's foot between the boots (back)
REMOVE = {
    "front": [[(728, 320), (905, 320), (905, 742), (832, 748), (815, 768), (786, 768), (768, 700), (752, 560),
               (742, 470)]],
    "back": [[(1135, 320), (1372, 320), (1366, 350), (1352, 400), (1339, 450), (1329, 500), (1319, 560), (1318, 628),
              (1302, 690), (1196, 750), (1135, 762)],
             [(1458, 1236), (1500, 1236), (1504, 1372), (1462, 1372)]],
}


def sat_of(im: np.ndarray) -> np.ndarray:
    mx, mn = im.max(axis=2), im.min(axis=2)
    return (mx - mn) / np.maximum(mx, 1)


def backdrop(im: np.ndarray, M0: np.ndarray) -> np.ndarray:
    w = (~nd.binary_dilation(M0, iterations=14)).astype(np.float32)
    num = np.stack([nd.gaussian_filter(im[..., c] * w, 45) for c in range(3)], -1)
    den = nd.gaussian_filter(w, 45)[..., None] + 1e-6
    return num / den


def poly_mask(shape, poly) -> np.ndarray:
    from PIL import ImageDraw
    m = Image.new("L", (shape[1], shape[0]), 0)
    ImageDraw.Draw(m).polygon([tuple(map(float, p)) for p in poly], fill=255)
    return np.asarray(m) > 0


def band_frame(shape, line, hw):
    """per pixel: distance to the polyline, the unit normal of the nearest segment, the nearest point"""
    H, W = shape
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    best = np.full((H, W), 1e9, np.float32)
    nx = np.zeros((H, W), np.float32)
    ny = np.zeros((H, W), np.float32)
    sd = np.zeros((H, W), np.float32)
    for (x0, y0), (x1, y1) in zip(line[:-1], line[1:]):
        dx, dy = x1 - x0, y1 - y0
        L2 = dx * dx + dy * dy
        t = np.clip(((xx - x0) * dx + (yy - y0) * dy) / L2, 0, 1)
        px, py = x0 + t * dx, y0 + t * dy
        d = np.hypot(xx - px, yy - py)
        upd = d < best
        L = np.sqrt(L2)
        n = (dy / L, -dx / L)
        best = np.where(upd, d, best)
        nx = np.where(upd, n[0], nx)
        ny = np.where(upd, n[1], ny)
        sd = np.where(upd, (xx - px) * n[0] + (yy - py) * n[1], sd)
    return best, nx, ny, sd


def inpaint_band(im, fig, line, hw):
    """the staff's band in-painted across: each band pixel lerps the paint just outside the band on both sides
    (along the shaft's normal); band pixels whose either side is not figure leave the figure"""
    H, W, _ = im.shape
    d, nx, ny, sd = band_frame((H, W), line, hw)
    band = d <= hw
    ys, xs = np.nonzero(band)
    s = sd[ys, xs]
    off_a = hw + 3 - s             # to the + side's edge
    off_b = hw + 3 + s             # to the - side's edge
    ax = np.clip(np.round(xs + nx[ys, xs] * off_a).astype(int), 0, W - 1)
    ay = np.clip(np.round(ys + ny[ys, xs] * off_a).astype(int), 0, H - 1)
    bx = np.clip(np.round(xs - nx[ys, xs] * off_b).astype(int), 0, W - 1)
    by = np.clip(np.round(ys - ny[ys, xs] * off_b).astype(int), 0, H - 1)
    ok = fig[ay, ax] & fig[by, bx]
    w = (off_b / (off_a + off_b))[:, None]
    # average a small window on each side (the painted weave, not one pixel)
    ims = np.stack([nd.uniform_filter(im[..., c], 5) for c in range(3)], -1)
    col = ims[by, bx] * (1 - w) + ims[ay, ax] * w
    out = im.copy()
    out[ys[ok], xs[ok]] = col[ok]
    fill = np.zeros((H, W), bool)
    fill[ys[ok], xs[ok]] = True
    drop = np.zeros((H, W), bool)
    drop[ys[~ok], xs[~ok]] = True
    return out, fill, drop


MIRROR_CX = {"front": 551.75, "back": 1476.75}     # the axes the frame below measures (stable across runs)
MIRROR_HW = 31.0                                    # the shaft plus its painted glow


def mirror_props(im, fig, removed_polys, H, W):
    """prop-covered pixels take their mirror's paint and figure state where the mirror is prop-free"""
    d, *_ = band_frame((H, W), STAFF_F, MIRROR_HW)
    region = {"front": d <= MIRROR_HW, "back": np.zeros((H, W), bool)}
    for side in ("front", "back"):
        for poly in removed_polys[side]:
            region[side] |= poly_mask((H, W), poly)
    out, fig2 = im.copy(), fig.copy()
    done = np.zeros((H, W), bool)
    for side, (x0, x1) in (("front", (0, W // 2)), ("back", (W // 2, W))):
        R = region[side].copy()
        R[:, :x0] = False
        R[:, x1:] = False
        ys, xs = np.nonzero(R)
        mx = np.round(2 * MIRROR_CX[side] - xs).astype(int)
        ok = (mx >= x0) & (mx < x1)
        ok[ok] &= ~R[ys[ok], mx[ok]]
        ys, xs, mx = ys[ok], xs[ok], mx[ok]
        out[ys, xs] = im[ys, mx]
        fig2[ys, xs] = fig[ys, mx]
        done[ys, xs] = True
    # feather the seam 3 px into the clean paint
    edge = nd.binary_dilation(done, iterations=3) & ~done & fig2
    soft = np.stack([nd.gaussian_filter(out[..., c], 1.5) for c in range(3)], -1)
    out[edge] = soft[edge]
    return out, fig2, done


def figure_mask(im: np.ndarray):
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
    fig = ~np.isin(lbl, list(border))
    fig = nd.binary_opening(fig, iterations=2)
    lbl2, n2 = nd.label(fig)
    s2 = nd.sum(fig, lbl2, range(1, n2 + 1))
    fig = np.isin(lbl2, np.nonzero(s2 >= 3000)[0] + 1)
    return fig, cand


def main() -> None:
    src = GAME / "_design" / "concept" / f"{ID}.webp"
    out = ART / ".cache" / "concept"
    out.mkdir(parents=True, exist_ok=True)
    im = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
    H, W, _ = im.shape
    fig, cand = figure_mask(im)
    lum = im.mean(axis=2)
    sat = sat_of(im)
    meta = {"size": [W, H], "id": ID}
    halves = (("front", (0, W // 2)), ("back", (W // 2, W)))
    removed = np.zeros_like(fig)
    # prop-covered paint mirrored from the clean side first; then the rest of the props leave the figure
    im, fig, mirrored = mirror_props(im, fig, REMOVE, H, W)
    for side, _ in halves:
        for poly in REMOVE[side]:
            pm = poly_mask((H, W), poly) & ~mirrored
            removed |= pm & fig
            fig &= ~pm
    im2, filled, drop = inpaint_band(im, fig, STAFF_F, STAFF_HW)
    im = np.where(mirrored[..., None], im, im2)
    filled &= ~mirrored
    drop &= ~mirrored
    removed |= drop & fig
    fig &= ~drop
    # backdrop pockets the painted staff walled off (between the hook and the hood) open to the border again
    lbl, _ = nd.label(cand | removed)
    border = set(np.unique(np.concatenate([lbl[0], lbl[-1], lbl[:, 0], lbl[:, -1]]))) - {0}
    pocket = np.isin(lbl, list(border)) & cand & fig
    removed |= pocket
    fig &= ~pocket
    for side, (x0, x1) in halves:
        m = fig[:, x0:x1].copy()
        lbl, n = nd.label(m)
        if n > 1:
            sz = nd.sum(m, lbl, range(1, n + 1))
            m = lbl == int(np.argmax(sz)) + 1
        dark = (lum[:, x0:x1] < 80) & m
        ground = int(np.where(dark.sum(1) > 30)[0][-1])
        rows = np.where(m.sum(1) > 30)[0]
        top = int(rows[0])
        k = (ground - top) / HEIGHT
        mids = []
        for z in np.arange(1.08, 1.40, 0.01):
            r = int(round(ground - z * k))
            lab, nn = nd.label(m[r])
            if not nn:
                continue
            sz = nd.sum(m[r], lab, range(1, nn + 1))
            cols = np.nonzero(lab == int(np.argmax(sz)) + 1)[0]
            mids.append((cols[0] + cols[-1]) / 2)
        meta[side] = {"cx": float(x0 + np.median(mids)), "ground": ground, "top": top}
        sh_row = int(round(ground - SHOULDER_Z * k))
        filled_h = nd.binary_fill_holes(m)
        holes = filled_h & ~m
        hl, hn = nd.label(holes)
        for i in range(1, hn + 1):
            hm = hl == i
            ys = np.nonzero(hm.any(1))[0]
            if ys.max() < sh_row:
                m |= hm
        isl = cand[:, x0:x1] & m
        isl[:int(round(ground - HEM_Z * k))] = False
        il, inn = nd.label(isl)
        if inn:
            sz = nd.sum(isl, il, range(1, inn + 1))
            big = np.isin(il, np.nonzero(sz >= ISLAND_MIN)[0] + 1)
            big = nd.binary_dilation(big, iterations=3) & m
            m &= ~big
            removed[:, x0:x1] |= big
        m[ground + 1:] = False
        # near the soles only the dark boots are figure (the floor shadow is a pale grey ellipse)
        band = slice(ground - 110, ground + 1)
        boot = nd.binary_closing(nd.binary_opening(lum[band, x0:x1] < 110, iterations=2), iterations=5)
        m[band] &= boot
        fig[:, x0:x1] = nd.binary_opening(m, iterations=1)
    keep = nd.binary_erosion(fig, iterations=ERODE)
    edge_d = nd.distance_transform_edt(fig)
    halo = (lum > HALO_LUM) & (edge_d < HALO_PX)
    halo = nd.binary_dilation(halo, iterations=2) & (edge_d < HALO_PX + 2)
    # the clear chimney's glass is near-white by nature: no halo trim above the hood
    for side, (x0, x1) in halves:
        g, t = meta[side]["ground"], meta[side]["top"]
        hood_row = int(round(g - 1.47 * (g - t) / HEIGHT))
        halo[:hood_row, x0:x1] = False
    keep &= ~halo
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
    src_im = np.asarray(Image.open(src).convert("RGB")).astype(np.float32)
    ov = src_im * 0.30 + 40
    ov[keep] = padded[keep]
    ov[removed] = ov[removed] * 0.4 + np.array([255, 40, 40]) * 0.6
    edge = keep & ~nd.binary_erosion(filled & keep, iterations=1) & filled
    ov[edge] = (40, 220, 60)
    for side, (x0, x1) in halves:
        g, t, cx = meta[side]["ground"], meta[side]["top"], meta[side]["cx"]
        ov[t, x0:x1] = (0, 255, 0)
        ov[g, x0:x1] = (0, 255, 0)
        ov[:, int(cx)] = (0, 160, 255)
    Image.fromarray(ov.clip(0, 255).astype(np.uint8)).resize((W // 2, H // 2), Image.LANCZOS).save(dbg / "plates_mask.png")
    Image.fromarray(padded.clip(0, 255).astype(np.uint8)).resize((W // 2, H // 2), Image.LANCZOS).save(dbg / "plates_padded.png")
    print(json.dumps(meta))


if __name__ == "__main__":
    main()
