#!/usr/bin/env python3
"""VALE art: card QA for the per-skin splash and portrait staging (closing review, CW5 cards pipeline).

    python3 art/tools/card_qa.py vashil [ardit ...] [--out _harness/_reports/fw_CW5_cards.txt] [--json out.json]

Reads the shipped cards (art/out/fighters/<fid>/[<skin>_]splash.png / portrait.png) and the kept subject passes
(art/.cache/fighters/plates/<sid>_<kind>.png: their alpha is the figure mask). Per card:
  grain    the closing reviewers' measure: std of (grey - gaussian blur sigma 2) in 16 x 16 blocks. `fig` = blocks
           wholly inside the figure (mask > 0.98 over the block), `plate` = blocks with no figure in them; reported
           as p50 / p90 over the blocks. Diagnostic since ruling 12 (was GATE: figure p50 <= 2 x the plate's p50; the
           reviewers saw on flat cloth; the p90 blocks hold the figure's real edges and are reported only), and the
           reviewers' half-image p90 pair (x >= 800 / x < 800) for comparison with closing_vashil_splash_grain.txt.
  speckle  GATE (ruling 12): figure p50 <= 2.5 (pre-fix cards read 6+). std of (grey - 3x3 median) per block, figure vs plate p50: pixel-scale render
           noise only (painted strokes and folds wider than ~2 px survive the median), to tell grain from detail.
  hi       the figure's luma (Rec. 709, 0-255) p99 / p99.7 / p99.9 / max. GATE: p99.9 >= 230 (highlights).
  mad      figure-box mean absolute difference (RGB, /255) against the base card of the fighter (the box: the
           union of both figures' bounds + 16 px). GATE for a skin: >= 30.
  frame    (splash) the figure's mass centre across (fraction of the width), its top and feet rows (fractions of
           the height). GUIDE: mass 0.66-0.76, head ~0.10, feet ~0.95.
  blockers (max2) the by-eye blocker detector (face_blockers) on the face disc (render notes' head point + face_off; the
           disc resampled to 128 px so splash and portrait read alike). Measures: hollow (a dark interior slot: its
           inscribed size x how much paler its rim is, no pale white beside it, no catch-light), blank (the face's darkest
           5 % at least BLOCKER["blank"] of its median: no lid, pupil or eye shadow anywhere on it), glow (saturated spots
           off the face's own hue), streak (thin dark vertical lines in the lower face), cracked (thin dark line share),
           dots (small bright blobs the 3D render does not carry, painted cards). GATE: hollow / blank / glow over
           BLOCKER; streak, cracked and dots are reported. Calibration on the round-1 verdicts: --calibrate (below).
Exit 1 when a gate fails.

    python3 art/tools/card_qa.py --calibrate _design/reviews/cards/max2_blocker_calib.json
re-fits the BLOCKER thresholds from that file's per-card measures (round-1 cards, verify_ks2 / roll1 / roll2 labels),
greedy at <= 10 % false alarms on the ok cards, and prints the hit rate in-sample and leave-one-fighter-out.
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(GAME, "art", "out", "fighters")
CACHE = os.path.join(GAME, "art", ".cache", "fighters", "plates")
Y709 = np.array([0.2126, 0.7152, 0.0722], np.float32)


def load(p: str) -> np.ndarray:
    im = Image.open(p)
    im = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
    return np.asarray(im).astype(np.float32) / 255.0


def gaussian(a: np.ndarray, s: float) -> np.ndarray:
    r = max(1, int(s * 3))
    x = np.arange(-r, r + 1, dtype=np.float32)
    k = np.exp(-(x * x) / (2 * s * s))
    k /= k.sum()
    out = a.astype(np.float32)
    for ax in (0, 1):
        pad = [(0, 0)] * out.ndim
        pad[ax] = (r, r)
        p = np.pad(out, pad, mode="edge")
        acc = np.zeros_like(out)
        for i, w in enumerate(k):
            sl = [slice(None)] * out.ndim
            sl[ax] = slice(i, i + out.shape[ax])
            acc += w * p[tuple(sl)]
        out = acc
    return out


def blocks(grey: np.ndarray, sel, B: int = 16) -> np.ndarray:
    hp = grey - gaussian(grey, 2.0)
    H, W = grey.shape
    v = []
    for by in range(0, H - B + 1, B):
        for bx in range(0, W - B + 1, B):
            if sel(by, bx):
                v.append(float(hp[by:by + B, bx:bx + B].std()))
    return np.array(v, np.float32)


def median3(a: np.ndarray) -> np.ndarray:
    p = np.pad(a, 1, mode="edge")
    H, W = a.shape
    st = np.stack([p[y:y + H, x:x + W] for y in range(3) for x in range(3)])
    return np.median(st, axis=0)


def speckle_blocks(grey: np.ndarray, sel, B: int = 16) -> np.ndarray:
    """pixel-scale speckle only: std of (grey - its 3x3 median) per block (a painted stroke or a fold wider than
    ~2 px survives the median, so this separates render noise from the figure's painted detail)"""
    hp = grey - median3(grey)
    H, W = grey.shape
    v = []
    for by in range(0, H - B + 1, B):
        for bx in range(0, W - B + 1, B):
            if sel(by, bx):
                v.append(float(hp[by:by + B, bx:bx + B].std()))
    return np.array(v, np.float32)


def q(v, f):
    return float(np.percentile(v, f)) if len(v) else float("nan")


def card(sid: str, fid: str, kind: str) -> dict | None:
    pre = "" if sid == fid else f"{sid}_"
    ip = os.path.join(OUT, fid, f"{pre}{kind}.png")
    rp = os.path.join(CACHE, f"{sid}_{kind}.png")
    if not (os.path.isfile(ip) and os.path.isfile(rp)):
        return None
    img = load(ip)[..., :3]
    raw = load(rp)
    a = raw[..., 3] if raw.shape[2] == 4 else np.ones(raw.shape[:2], np.float32)
    H, W = img.shape[:2]
    if a.shape != (H, W):                        # the portrait's raw is the 1.5x / 2x frame: box-reduce its alpha
        f = a.shape[0] / H
        if abs(f - round(f)) < 1e-6:
            f = int(round(f))
            a = a[:H * f, :W * f].reshape(H, f, W, f).mean(axis=(1, 3))
        else:
            a = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR)).astype(np.float32) / 255
    grey = (img @ Y709) * 255.0
    B = 16
    inside = lambda by, bx: bool((a[by:by + B, bx:bx + B] > 0.98).all())      # noqa: E731
    empty = lambda by, bx: bool((a[by:by + B, bx:bx + B] < 0.02).all())       # noqa: E731
    gf, gp = blocks(grey, inside), blocks(grey, empty)
    r = {"sid": sid, "kind": kind, "file": os.path.relpath(ip, GAME), "size": [W, H],
         "grain": {"fig_p50": round(q(gf, 50), 2), "fig_p90": round(q(gf, 90), 2), "plate_p50": round(q(gp, 50), 2),
                   "plate_p90": round(q(gp, 90), 2), "fig_blocks": int(len(gf)), "plate_blocks": int(len(gp))}}
    if kind == "splash" and W == 1600:
        hr = blocks(grey, lambda by, bx: bx >= 800)
        hl = blocks(grey, lambda by, bx: bx < 800)
        r["grain"]["half_right_p90"] = round(q(hr, 90), 2)
        r["grain"]["half_left_p90"] = round(q(hl, 90), 2)
    m = a > 0.9
    L = grey[m]
    sf, sp = speckle_blocks(grey, inside), speckle_blocks(grey, empty)
    r["speckle"] = {"fig_p50": round(q(sf, 50), 2), "plate_p50": round(q(sp, 50), 2)}
    r["hi"] = {"p50": round(q(L, 50)), "p99": round(q(L, 99)), "p99_7": round(q(L, 99.7)), "p99_9": round(q(L, 99.9)),
               "max": round(float(L.max())) if len(L) else None}
    ys, xs = np.nonzero(a > 0.6)
    if len(xs):
        w = a[a > 0.6]
        r["frame"] = {"mass_x": round(float((xs * w).sum() / w.sum()) / W, 3), "x0": round(xs.min() / W, 3),
                      "x1": round(xs.max() / W, 3), "top": round(ys.min() / H, 3), "feet": round(ys.max() / H, 3)}
    r["pupil"] = pupils(img, a, sid, fid, kind, rp)
    r["blockers"] = blockers_of(img, a, sid, fid, kind, rp)
    r["_img"], r["_a"] = img, a
    return r


def blockers_of(img: np.ndarray, a: np.ndarray, sid: str, fid: str, kind: str, rp: str) -> dict | None:
    mp = rp + ".json"
    if not os.path.isfile(mp):
        return None
    sys.path.insert(0, os.path.join(GAME, "art", "blender", "common"))
    import plates  # noqa: E402
    with open(mp, encoding="utf-8") as f:
        meta = json.load(f)
    p = plates.params(fid, None if sid == fid else sid) or {}
    ref = None
    r3 = os.path.join(GAME, "art", ".cache", "fighters", "paint", f"{sid}_{kind}_3d.png")
    if os.path.isfile(r3):
        ref = load(r3)[..., :3]
    return face_blockers(img, a, plates.face_point(meta, p, kind), kind, fid, ref)


PUPIL_GATE = {"sukri"}     # (cards ks1 fix) fighters whose carved eyes carry a painted pupil: the pupil check is a GATE
PUPIL_R = {"sukri": 1.8}   # the face disc's radius x this (Sukri's mask is twice a head's face: the eyes sit near its rim)


def pupils(img: np.ndarray, a: np.ndarray, sid: str, fid: str, kind: str, rp: str) -> dict | None:
    """(cards ks1 fix: verify ks1's blocker, Shadeprint's pupils read as pale lavender holes through the mask) in the face
    disc (render notes + the card's face_off): the eye pixels are the warm, saturated top 20 % at S >= 0.48 (the honey / amber inlay),
    grown 3 px; the pupil is the darkest 2 % of that region. GATE (PUPIL_GATE fighters): the pupil's luma at least 25
    under the iris's median, and not cool (its blue at most its red + 8: a plate seen through a hole is the sky's hue);
    no hole the iris ring closes is cool. (The composite can no longer drop an enclosed dark pixel: plates.split_shadow.)"""
    mp = rp + ".json"
    if not os.path.isfile(mp):
        return None
    sys.path.insert(0, os.path.join(GAME, "art", "blender", "common"))
    import plates  # noqa: E402
    with open(mp, encoding="utf-8") as f:
        meta = json.load(f)
    p = plates.params(fid, None if sid == fid else sid) or {}
    fp = plates.face_point(meta, p, kind)
    if fp is None:
        return None
    H, W = img.shape[:2]
    yy, xx = np.mgrid[0:H, 0:W]
    rr = (0.05 if kind == "splash" else 0.15) * H * PUPIL_R.get(fid, 1.0)
    fm = (((xx - fp[0] * W) ** 2 + (yy - fp[1] * H) ** 2) < rr * rr) & (a > 0.5)
    mx, mn = img.max(-1), img.min(-1)
    S = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-5), 0.0)
    warm = fm & (img[..., 0] > img[..., 2] + 0.08) & (S > 0.35)
    if warm.sum() < 12:
        return None
    eye = warm & (S >= max(0.48, float(np.percentile(S[warm], 80))))    # the inlay (S ~0.6), never the mask (~0.36)
    if eye.sum() < 8:
        return None
    g = eye.astype(np.float32)
    for _ in range(3):
        pp = np.pad(g, 1)
        g = np.max(np.stack([pp[dy:dy + H, dx:dx + W] for dy in range(3) for dx in range(3)]), axis=0)
    reg = (g > 0) & fm
    Y = (img @ Y709) * 255.0
    pup = reg & (Y <= np.percentile(Y[reg], 2))
    iris = float(np.median(Y[eye]))
    pl = float(Y[pup].mean())
    pc = img[pup].mean(0) * 255.0
    ok = (pl <= iris - 25.0) and (pc[2] <= pc[0] + 8.0)
    # the holes the iris ring closes all round (on the face disc's box): a see-through pupil is a COOL hole (the dusk
    # sky's violet / blue through the mask; a warm hole is the mask's own wood between inlay pixels)
    ys_, xs_ = np.nonzero(fm)
    y0, y1, x0, x1 = ys_.min(), ys_.max() + 1, xs_.min(), xs_.max() + 1
    holes = np.zeros_like(eye)
    holes[y0:y1, x0:x1] = plates._enclosed(~eye[y0:y1, x0:x1])
    holes &= fm
    hole = None
    if holes.sum() >= 4:
        hc = img[holes].mean(0) * 255.0
        hl = float(Y[holes].mean())
        hole = {"px": int(holes.sum()), "luma": round(hl, 1), "rgb": [int(round(v)) for v in hc]}
        hole["cool"] = bool(hc[2] > hc[0] + 8.0)
        ok = ok and not hole["cool"]
    py, px_ = np.nonzero(pup)
    return {"iris_luma": round(iris, 1), "pupil_luma": round(pl, 1), "pupil_rgb": [int(round(v)) for v in pc],
            "at": [round(float(px_.mean()) / W, 3), round(float(py.mean()) / H, 3)], "hole": hole, "ok": bool(ok)}


# ── max2: the by-eye blocker detector ─────────────────────────────────────────────────────────────────────────────
# Thresholds fitted on the round-1 cards (_design/reviews/cards/max2_blocker_calib.json, --calibrate): in-sample 18 / 45
# sensitivity fails caught at 4 / 42 false alarms on the verifiers' ok cards; leave-one-fighter-out 14 / 45 at 5 / 42.
# That is BELOW the asked 90 % / 10 %: the verifiers' reads (a hollow almond on a pale mask vs a dark wrap slit with lids
# in it, a mannequin plate vs a glass visor) share their image statistics with ok cards, so this is a high-precision
# tripwire, not a replacement for the adversarial look at full, card and chip size.
BLOCKER = {"hollow": 14.02, "blank": 0.65, "glow": 0.343}
BN = 128


def _face_crop(img: np.ndarray, a: np.ndarray, fp, kind: str, fid: str) -> tuple[np.ndarray, np.ndarray]:
    H, W = img.shape[:2]
    rr = (0.05 if kind == "splash" else 0.15) * H * PUPIL_R.get(fid, 1.0)
    cx, cy = fp[0] * W, fp[1] * H
    box = (cx - rr, cy - rr, cx + rr, cy + rr)
    im = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).transform((BN, BN), Image.EXTENT, box, Image.BICUBIC)
    al = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).transform((BN, BN), Image.EXTENT, box, Image.BILINEAR)
    return np.asarray(im).astype(np.float32) / 255, np.asarray(al).astype(np.float32) / 255


def face_measures(img: np.ndarray, a: np.ndarray, fp, kind: str, fid: str) -> dict | None:
    c, al = _face_crop(img, a, fp, kind, fid)
    Y = (c @ Y709) * 255.0
    mx, mn = c.max(-1), c.min(-1)
    S = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-5), 0.0)
    yy, xx = np.mgrid[0:BN, 0:BN]
    r = np.hypot(xx - BN / 2 + 0.5, yy - BN / 2 + 0.5) / (BN / 2)
    disc = (r < 1.0) & (al > 0.5)
    inner = disc & (r < 0.75)
    if inner.sum() < 200:
        return None
    med = float(np.median(Y[disc]))
    et = ndi.binary_dilation(~disc, iterations=2)
    hol, evid = 0.0, 0
    for thr in (0.45, 0.6):
        lab, n = ndi.label(disc & (Y < thr * med), np.ones((3, 3)))
        for i in range(1, n + 1):
            m = lab == i
            if m.sum() < 6 or (m & et).any():
                continue
            dt = ndi.distance_transform_edt(np.pad(m, 1))[1:-1, 1:-1].max()
            ring = ndi.binary_dilation(m, iterations=3) & ~ndi.binary_dilation(m, iterations=1) & disc
            if not ring.any():
                continue
            rm, cm = float(np.median(Y[ring])), float(Y[m].mean())
            rw = float((Y[ring] > 1.08 * med).mean())
            catch = float((Y[m].max() - cm) / med)
            cy = np.nonzero(m)[0].mean() / BN
            if 0.12 < cy < 0.85:
                sc = (dt / BN * 100) * (rm / max(cm, 4.0)) * (1 - min(1.0, rw / 0.35)) * (1.0 if catch < 0.18 else 0.4)
                hol = max(hol, sc)
                evid += int(dt >= 1.5 and (rw > 0.2 or catch > 0.2))
    m5 = ndi.median_filter(Y, 5)
    L = disc & ((m5 - Y) > 0.09 * med)
    thin = L & (ndi.distance_transform_edt(L) <= 1.5)
    gy, gx = np.gradient(ndi.gaussian_filter(Y, 1.0))
    vert = thin & (np.abs(gx) > 1.7 * np.abs(gy))
    hsv = np.asarray(Image.fromarray((c * 255).astype(np.uint8)).convert("HSV")).astype(np.float32)
    Hh = hsv[..., 0] / 255 * 360
    base = disc & (S < 0.5)
    hmed = float(np.median(Hh[base])) if base.sum() > 20 else 0.0
    dh = np.abs((Hh - hmed + 180) % 360 - 180)
    return {"hollow": round(hol, 3), "blank": round(float(np.percentile(Y[inner], 5) / med), 3),
            "glow": round(float((inner & (S > 0.45) & (dh > 40) & (Y > 0.4 * med)).mean()), 4),
            "streak": round(float(vert[inner & (yy > BN * 0.45)].mean()), 4), "cracked": round(float(thin[inner].mean()), 4),
            "eye_evidence": int(min(evid, 4)), "face_med": round(med, 1)}


def new_dots(img: np.ndarray, ref: np.ndarray, a: np.ndarray) -> int:
    """small bright blobs (2-40 px, a 7 px top-hat over 40 luma) on the figure that the 3D render does not carry"""
    out = []
    for im in (img, ref):
        Y = (im[..., :3] @ Y709) * 255.0
        out.append(((Y - ndi.grey_opening(Y, size=(7, 7))) > 40) & (a > 0.9))
    new = out[0] & ~ndi.binary_dilation(out[1], iterations=2)
    lab, n = ndi.label(new)
    if not n:
        return 0
    sz = ndi.sum(new, lab, range(1, n + 1))
    return int(((sz >= 2) & (sz <= 40)).sum())


def face_blockers(img: np.ndarray, a: np.ndarray, fp, kind: str, fid: str, ref: np.ndarray | None = None) -> dict | None:
    """the by-eye blocker detector: measures plus `hits` (the BLOCKER classes over their threshold)"""
    if fp is None:
        return None
    f = face_measures(img, a, fp, kind, fid)
    if f is None:
        return None
    if ref is not None and ref.shape[:2] == img.shape[:2]:
        f["dots"] = new_dots(img, ref, a)
    f["hits"] = [k for k, t in BLOCKER.items() if f[k] >= t]
    return f


def calibrate(path: str) -> int:
    """re-fit BLOCKER from the stored round-1 measures: greedy OR of thresholds, <= 10 % false alarms on the ok cards"""
    with open(path, encoding="utf-8") as fh:
        cal = json.load(fh)
    rows = cal["cards"]
    lab = np.array([r["label"] for r in rows])
    fid = np.array([r["fid"] for r in rows])
    keys = list(BLOCKER)
    V = {k: np.array([r["measures"][k] for r in rows]) for k in keys}

    def fit(idx):
        sel, th = np.zeros(len(rows), bool), {}
        ok, se = (lab == "ok") & idx, (lab == "sens") & idx
        budget = int(np.floor(0.10 * ok.sum()))
        while True:
            best = None
            for k in keys:
                if k in th:
                    continue
                for t in np.unique(V[k][idx]):
                    s2 = sel | (V[k] >= t)
                    fa = int((s2 & ok).sum())
                    if fa > budget:
                        continue
                    key = (int((s2 & se).sum()), -fa)
                    if best is None or key > best[0]:
                        best = (key, k, float(t))
            if best is None or best[0][0] <= int((sel & se).sum()):
                return th
            th[best[1]] = best[2]
            sel |= V[best[1]] >= best[2]

    def hit(th, idx):
        s = np.zeros(len(rows), bool)
        for k, t in th.items():
            s |= V[k] >= t
        return s & idx

    allx = np.ones(len(rows), bool)
    th = fit(allx)
    s = hit(th, allx)
    lofo = np.zeros(len(rows), bool)
    for f in np.unique(fid):
        te = fid == f
        lofo |= hit(fit(~te), te)
    nS, nO = int((lab == "sens").sum()), int((lab == "ok").sum())
    print(f"[calibrate] thresholds {th}")
    print(f"[calibrate] in-sample: {int((s & (lab == 'sens')).sum())}/{nS} sensitivity fails caught, "
          f"{int((s & (lab == 'ok')).sum())}/{nO} ok cards flagged, {int((s & (lab == 'other')).sum())}/"
          f"{int((lab == 'other').sum())} other fails flagged")
    print(f"[calibrate] leave-one-fighter-out: {int((lofo & (lab == 'sens')).sum())}/{nS} caught, "
          f"{int((lofo & (lab == 'ok')).sum())}/{nO} ok flagged")
    print("[calibrate] missed: " + ", ".join(r["card"] for r, h in zip(rows, s) if r["label"] == "sens" and not h))
    print("[calibrate] false alarms: " + ", ".join(r["card"] for r, h in zip(rows, s) if r["label"] == "ok" and h))
    return 0


def mad(a: dict, b: dict) -> float:
    ya, xa = np.nonzero(a["_a"] > 0.6)
    yb, xb = np.nonzero(b["_a"] > 0.6)
    H, W = a["_img"].shape[:2]
    x0, x1 = max(0, min(xa.min(), xb.min()) - 16), min(W, max(xa.max(), xb.max()) + 17)
    y0, y1 = max(0, min(ya.min(), yb.min()) - 16), min(H, max(ya.max(), yb.max()) + 17)
    d = np.abs(a["_img"][y0:y1, x0:x1] - b["_img"][y0:y1, x0:x1]).mean() * 255.0
    return round(float(d), 1)


def sids_of(fid: str) -> list[str]:
    out = [fid]
    sk = os.path.join(OUT, fid, "skins.json")
    if os.path.isfile(sk):
        with open(sk, encoding="utf-8") as f:
            out += [s["id"] for s in json.load(f)]
    return out


def main(argv: list[str]) -> int:
    def opt(k):
        return argv[argv.index(k) + 1] if k in argv else None
    if "--calibrate" in argv:
        return calibrate(opt("--calibrate"))
    outp, jsonp = opt("--out"), opt("--json")
    fids = [a for i, a in enumerate(argv) if not a.startswith("--") and (i == 0 or argv[i - 1] not in ("--out", "--json"))]
    lines, rows, bad = [], [], 0
    lines.append("card QA (art/tools/card_qa.py): grain = std(grey - blur s2) per 16 px block, fig = blocks inside the "
                 "figure, plate = blocks without it; hi = figure luma; mad = figure-box |diff| vs the base card")
    for fid in fids:
        base = {}
        for sid in sids_of(fid):
            for kind in ("splash", "portrait"):
                r = card(sid, fid, kind)
                if r is None:
                    lines.append(f"  {sid:<22} {kind:<8} (no card or no kept raw pass)")
                    continue
                if sid == fid:
                    base[kind] = r
                g, h = r["grain"], r["hi"]
                sk = r["speckle"]   # ruling 12: the card gate is pixel speckle; the sigma-2 grain is a diagnostic
                ok_g = sk["fig_p50"] <= 2.5   # absolute: the brush-smoothed plate sits near 0.1-0.2, so a ratio to it bans any figure
                ok_h = (h["p99_9"] or 0) >= 230
                r["mad"] = mad(r, base[kind]) if sid != fid and kind in base else None
                ok_m = r["mad"] is None or r["mad"] >= 30.0
                pu = r.get("pupil")
                ok_p = not (fid in PUPIL_GATE and pu is not None and not pu["ok"])
                bl = r.get("blockers")
                ok_b = not (bl and bl["hits"])
                r["gates"] = {"speckle": ok_g, "highlights": ok_h, "mad": ok_m, "pupil": ok_p, "blockers": ok_b}
                bad += (not ok_g) + (not ok_h) + (not ok_m) + (not ok_p) + (not ok_b)
                fr = r.get("frame", {})
                lines.append(
                    f"  {sid:<22} {kind:<8} grain fig p50 {g['fig_p50']:5.2f} p90 {g['fig_p90']:5.2f} | plate p50 "
                    f"{g['plate_p50']:5.2f} p90 {g['plate_p90']:5.2f}{'' if ok_g else ' !'}"
                    + (f" | halves R/L p90 {g['half_right_p90']:.2f}/{g['half_left_p90']:.2f}" if "half_right_p90" in g else "")
                    + f" | speckle fig/plate p50 {r['speckle']['fig_p50']:.2f}/{r['speckle']['plate_p50']:.2f}"
                    + f" || hi p50 {h['p50']} p99 {h['p99']} p99.7 {h['p99_7']} p99.9 {h['p99_9']} max {h['max']}"
                    f"{'' if ok_h else ' !'}"
                    + (f" || mad {r['mad']:.1f}{'' if ok_m else ' !'}" if r["mad"] is not None else "")
                    + (f" || pupil {pu['pupil_luma']:.0f} vs iris {pu['iris_luma']:.0f} rgb {pu['pupil_rgb']}"
                       f"{'' if ok_p else ' !'}" if pu else "")
                    + (f" || blockers hollow {bl['hollow']:.1f} blank {bl['blank']:.2f} glow {bl['glow']:.3f} streak "
                       f"{bl['streak']:.3f} cracked {bl['cracked']:.3f}" + (f" dots {bl['dots']}" if "dots" in bl else "")
                       + (f" ! {'/'.join(bl['hits'])}" if bl["hits"] else "") if bl else "")
                    + (f" || mass x {fr['mass_x']:.3f} ({fr['x0']:.2f}-{fr['x1']:.2f}) top {fr['top']:.3f} feet "
                       f"{fr['feet']:.3f}" if fr and kind == "splash" else ""))
                rows.append({k: v for k, v in r.items() if not k.startswith("_")})
    lines.append(f"[cards] {len(rows)} cards, {bad} gate misses")
    txt = "\n".join(lines)
    print(txt)
    if outp:
        os.makedirs(os.path.dirname(os.path.abspath(outp)), exist_ok=True)
        with open(outp, "w", encoding="utf-8") as f:
            f.write(txt + "\n")
    if jsonp:
        with open(jsonp, "w", encoding="utf-8") as f:
            json.dump(rows, f, indent=1)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
