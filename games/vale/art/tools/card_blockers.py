#!/usr/bin/env python3
"""VALE art: the by-eye BLOCKER detector for splash and portrait cards (max2 card blockers, round 2).

Round 1's adversarial verifiers failed 54 of 96 cards; 45 of them on sensitivity reads that card_qa and the paint_card gate
passed: hollow or solid dark eye slots, under-eye drip / tear-line streaks, cracked or aged face texture, a blank pale face
disc (mannequin), mummy-wrapped heads, glowing off-hue eyes, invented small repeated shapes. This module measures those
reads on the face disc of a card (render notes: plates.face_point, the same disc card_qa's pupil check uses) and on the
whole figure (invented dot rows against the 3D reference), and combines them into one blocker score.

    python3 art/tools/card_blockers.py calibrate [--out _design/reviews/cards/blockers_calib.json]
        re-fits the combiner on the round-1 verdicts (verify_ks2 / roll1 / roll2) from the card snapshot given with
        --cards <dir> (art/out/fighters layout + _plates/ = the kept passes at verdict time) and writes
        art/tools/card_blockers.json (feature list, scaling, weights, threshold) and the calibration report
    python3 art/tools/card_blockers.py check <fid> [...]       score the shipped cards

Features (face disc resampled to 96 x 96 around the face point, luma normalised by the disc's median):
  hol1/hol2/pair  closed dark components (< 0.42 x median, not touching the disc or silhouette edge, not a hood's eye slit
                  wider than 4.5x its height) weighted by area, by having no lit pupil/catch-light inside and by having no
                  pale white round them: an empty socket; pair = two such of similar size side by side
  lines/longline  thin dark lines (7 px median minus luma > 0.12 x median, not part of a dark slot): cracks, seams, stitches
  vlow            the share of those lines that run vertically below eye level: streaks and drips
  edge/blank      mean gradient over the inner disc and the share of it within 8 % of its median: a smooth blank face
  darkfrac        the inner disc's share under 0.6 x median (no dark features at all = mannequin lean)
  glow            saturated pixels in a hue 40+ degrees off the face's own hue: lit or glowing eyes
  yq*, tex*, c0*  value quantiles, texture energy and the largest dark component's shape (see feats())
The combiner is a logistic model on the standardised features (L2 0.01), fitted on the 87 calibration cards (45
sensitivity fails, 42 ok; the 9 fails for other reasons are left out), the threshold set at <= 10 % false alarms on the ok
cards. It is a SCREEN: a card it flags goes to the by-eye check (paint_card gate fails it; card_qa reports it); a card it
passes is still looked at by eye (ruling 30). Held-out numbers are in the calibration report and are much weaker than the
in-sample ones: the detector learned these 16 fighters' reads, not every possible one.
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
sys.path.insert(0, os.path.join(GAME, "art", "blender", "common"))
import plates  # noqa: E402

MODEL = os.path.join(HERE, "card_blockers.json")
Y709 = np.array([0.2126, 0.7152, 0.0722], np.float32)
N = 96
VERDICTS = ["verify_ks2", "verify_roll1", "verify_roll2"]
# round-1 fails that are NOT sensitivity reads (pose, palette, plate artefact, framing): left out of the calibration
NON_SENSITIVITY = {"ervet_lamplit_portrait", "ervet_stillwater_splash", "ardit_first_bell_portrait", "nurrow_splash",
                   "nurrow_noon_fair_splash", "nurrow_shadeprint_splash", "odrum_shadeprint_splash",
                   "rishal_lamplit_splash", "ulkro_splash"}


def face_radius(kind: str, fid: str, H: int) -> float:
    return (0.05 if kind == "splash" else 0.15) * H * (1.8 if fid == "sukri" else 1.0)


def crop(img: np.ndarray, a: np.ndarray, fp, kind: str, fid: str) -> tuple[np.ndarray, np.ndarray]:
    H, W = img.shape[:2]
    rr = face_radius(kind, fid, H)
    cx, cy = fp[0] * W, fp[1] * H
    box = (cx - rr, cy - rr, cx + rr, cy + rr)
    im = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).transform((N, N), Image.EXTENT, box, Image.BILINEAR)
    al = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).transform((N, N), Image.EXTENT, box, Image.BILINEAR)
    return np.asarray(im).astype(np.float32) / 255, np.asarray(al).astype(np.float32) / 255


def feats(img: np.ndarray, a: np.ndarray, fp, kind: str, fid: str) -> dict | None:
    c, al = crop(img, a, fp, kind, fid)
    Y = (c @ Y709) * 255
    mx, mn = c.max(-1), c.min(-1)
    Sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-5), 0)
    yy, xx = np.mgrid[0:N, 0:N]
    r = np.hypot(xx - N / 2 + 0.5, yy - N / 2 + 0.5) / (N / 2)
    disc = (r < 1) & (al > 0.5)
    if disc.sum() < 200:
        return None
    inner = disc & (r < 0.7)
    med = float(np.median(Y[disc]))
    ds = float(disc.sum())
    et = ndi.binary_dilation(~disc)
    f: dict = {}
    # 1. hollow slots
    dark = disc & (Y < 0.42 * med)
    lab, n = ndi.label(dark, np.ones((3, 3)))
    hol, slit = [], 0.0
    for i in range(1, n + 1):
        m = lab == i
        A = int(m.sum())
        if A < 6 or (m & et).any():
            continue
        ys, xs = np.nonzero(m)
        h, w = ys.max() - ys.min() + 1, xs.max() - xs.min() + 1
        fill = ndi.binary_fill_holes(m)
        bright_in = int((Y[fill] > 0.75 * med).sum())
        ring = ndi.binary_dilation(fill, iterations=2) & ~fill & disc
        rw = float((Y[ring] > 1.08 * med).mean()) if ring.any() else 0.0
        dt = ndi.distance_transform_edt(np.pad(m, 1))[1:-1, 1:-1].max()
        if w / h > 4.5:
            slit = max(slit, A / ds)
            continue
        score = (A / ds) * (1.0 if bright_in < 2 else 0.3) * (1 - rw) * (dt >= 2.0)
        hol.append((score, ys.mean() / N, xs.mean() / N, A / ds))
    hol.sort(key=lambda t: -t[0])
    f["hol1"] = hol[0][0] if hol else 0.0
    f["hol2"] = hol[1][0] if len(hol) > 1 else 0.0
    f["slit"] = slit
    pair = 0.0
    for i in range(len(hol)):
        for j in range(i + 1, len(hol)):
            p, q = hol[i], hol[j]
            if abs(p[1] - q[1]) < 0.12 and abs(p[2] - q[2]) > 0.15 and min(p[3], q[3]) / max(p[3], q[3]) > 0.3:
                pair = max(pair, min(p[0], q[0]))
    f["pair"] = pair
    # 2. thin dark lines, long ones, vertical ones under the eyes
    m7 = ndi.median_filter(Y, 7)
    L = disc & ((m7 - Y) > 0.12 * med) & (Y > 0.42 * med)
    f["lines"] = float(L[disc & (r < 0.8)].mean())
    lab2, n2 = ndi.label(L, np.ones((3, 3)))
    sizes = ndi.sum(L, lab2, range(1, n2 + 1)) if n2 else np.array([])
    f["longline"] = float((np.asarray(sizes) >= 12).sum()) / 10
    gy, gx = np.gradient(ndi.gaussian_filter(Y, 0.8))
    vl = L & (np.abs(gx) > 1.3 * np.abs(gy)) & (yy > N * 0.45) & (yy < N * 0.8) & (np.abs(xx - N / 2) < N * 0.4)
    f["vlow"] = float(vl.sum() / ds)
    # 3. blank disc
    g = np.hypot(gx, gy)
    inn = disc & (r < 0.6)
    f["edge"] = float(g[inn].mean() / med)
    f["darkfrac"] = float((inn & (Y < 0.6 * med)).mean())
    f["blank"] = float((np.abs(Y[inn] - np.median(Y[inn])) < 0.08 * med).mean())
    # 4. glowing off-hue eyes
    hsv = np.asarray(Image.fromarray((np.clip(c, 0, 1) * 255).astype(np.uint8)).convert("HSV")).astype(np.float32)
    Hh = hsv[..., 0] / 255 * 360
    base = disc & (Sat < 0.5)
    hmed = float(np.median(Hh[base])) if base.any() else 0.0
    dh = np.abs((Hh - hmed + 180) % 360 - 180)
    f["glow"] = float((inn & (Sat > 0.5) & (dh > 40) & (Y > 0.3 * med)).sum() / ds)
    f["med"] = med / 255
    # 5. value structure and texture
    for qq in (1, 5, 10, 25, 75, 95, 99):
        f[f"yq{qq}"] = float(np.percentile(Y[inner], qq)) / med
    f["uni10"] = float((np.abs(Y[inner] - med) < 0.1 * med).mean())
    f["smed"] = float(np.median(Sat[disc]))
    f["s95"] = float(np.percentile(Sat[inner], 95))
    f["tex"] = float((Y - ndi.gaussian_filter(Y, 1.5))[inner].std() / med)
    f["tex4"] = float((Y - ndi.gaussian_filter(Y, 4.0))[inner].std() / med)
    m5 = ndi.median_filter(Y, 5)
    L5 = disc & ((m5 - Y) > 0.10 * med)
    f["lines5"] = float(L5[inner].mean())
    f["blines"] = float((disc & ((Y - m5) > 0.10 * med))[inner].mean())
    gy1, gx1 = np.gradient(ndi.gaussian_filter(Y, 1.0))
    f["edge1"] = float(np.hypot(gx1, gy1)[inner].mean() / med)
    f["vlines"] = float(((np.abs(gx1) > 1.5 * np.abs(gy1)) & L5)[inner].mean())
    for t in (0.35, 0.5, 0.65):
        dk = inner & (Y < t * med)
        f[f"dk{int(t * 100)}"] = float(dk.sum() / ds)
        f[f"dku{int(t * 100)}"] = float((dk & (yy < N / 2)).sum() / ds)
    dk5 = disc & (Y < 0.5 * med)
    lab3, n3 = ndi.label(dk5, np.ones((3, 3)))
    comps = []
    for i in range(1, n3 + 1):
        m = lab3 == i
        A = int(m.sum())
        if A < 4 or (m & et).any():
            continue
        ys, xs = np.nonzero(m)
        ring = ndi.binary_dilation(m, iterations=2) & ~m & disc
        comps.append((A, (ys.max() - ys.min() + 1) / max(xs.max() - xs.min() + 1, 1), float(Y[m].mean()) / med,
                      float(Y[m].std()) / med, float((Y[ring] > 1.1 * med).mean()) if ring.any() else 0.0,
                      float(Sat[m].mean()), ys.mean() / N))
    comps.sort(key=lambda t: -t[0])
    for k in range(2):
        cc = comps[k] if k < len(comps) else (0, 0, 1, 0, 0, 0, 0.5)
        f[f"c{k}A"], f[f"c{k}asp"], f[f"c{k}y"], f[f"c{k}sd"] = cc[0] / ds, cc[1], cc[2], cc[3]
        f[f"c{k}ring"], f[f"c{k}s"], f[f"c{k}cy"] = cc[4], cc[5], cc[6]
    f["ncomp"] = min(len(comps), 8) / 8
    f["almond"] = sum(1 for cc in comps if cc[0] / ds > 0.006 and 0.25 < cc[1] < 0.9) / 2
    f["satodd"] = float((inner & (Sat > 0.5) & (dh > 35)).mean())
    f["blue"] = float((inner & (c[..., 2] > c[..., 0] + 0.06)).mean())
    th = Y - ndi.grey_opening(Y, size=(5, 5))
    _l, nd = ndi.label(disc & (th > 0.25 * med))
    f["dots"] = min(nd, 30) / 30
    f["portrait"] = 1.0 if kind == "portrait" else 0.0
    return f


def dot_rows(P: np.ndarray, F: np.ndarray, A: np.ndarray) -> dict:
    """invented small repeated shapes: small pale blobs (3-12 px) in the painting's figure that the 3D reference does not
    have there, found as >= 4 of them in a row (each within 3 blob spacings of the next, nearly collinear)"""
    def blobs(x):
        Y = (x @ Y709) * 255
        th = Y - ndi.grey_opening(Y, size=(9, 9))
        m = (th > 28) & (ndi.binary_erosion(A > 0.5, iterations=4))
        lab, n = ndi.label(m)
        out = []
        for i, sl in enumerate(ndi.find_objects(lab), 1):
            sz = int((lab[sl] == i).sum())
            if 3 <= sz <= 60:
                out.append(((sl[0].start + sl[0].stop - 1) / 2, (sl[1].start + sl[1].stop - 1) / 2))
        return np.array(out).reshape(-1, 2), m
    bp, _ = blobs(P)
    bf, mf = blobs(F)
    near = ndi.binary_dilation(mf, iterations=3)
    new = np.array([p for p in bp if not near[int(p[0]), int(p[1])]]).reshape(-1, 2)
    best = 0
    if len(new) >= 4:
        from itertools import combinations
        d = np.hypot(*(new[:, None, :] - new[None, :, :]).transpose(2, 0, 1))
        for i in range(len(new)):
            nb = np.nonzero((d[i] > 2) & (d[i] < 40))[0]
            if len(nb) < 3:
                continue
            for j in nb:
                v = (new[j] - new[i]) / d[i, j]
                proj = (new - new[i]) @ v
                perp = np.abs((new - new[i]) @ np.array([-v[1], v[0]]))
                on = np.sort(proj[(perp < 3.0) & (np.abs(proj) < 200)])
                run, cnt = 1, 1
                for a_, b_ in zip(on[:-1], on[1:]):
                    cnt = cnt + 1 if 2 < b_ - a_ < 40 else 1
                    run = max(run, cnt)
                best = max(best, run)
    return {"new_blobs": int(len(new)), "dot_row": int(best)}


def load_model() -> dict | None:
    if not os.path.isfile(MODEL):
        return None
    with open(MODEL, encoding="utf-8") as f:
        return json.load(f)


def score(f: dict, model: dict | None = None) -> float:
    model = model or load_model()
    if model is None or f is None:
        return float("nan")
    x = np.array([f[k] for k in model["features"]], np.float64)
    z = (x - np.array(model["mu"])) / np.array(model["sd"])
    return float(1 / (1 + np.exp(-(z @ np.array(model["w"]) + model["b"]))))


def classes(f: dict) -> list[str]:
    """the readable reasons behind a flag (diagnostic: the score decides)"""
    out = []
    if f["hol1"] > 0.012 or f["pair"] > 0.004:
        out.append("hollow eye slot")
    if f["vlow"] > 0.012:
        out.append("streaks under the eyes")
    if f["lines"] > 0.07 or f["longline"] >= 1.2:
        out.append("cracked / lined face")
    if f["edge"] < 0.03 and f["darkfrac"] < 0.02:
        out.append("blank face disc")
    if f["glow"] > 0.02:
        out.append("off-hue lit eyes")
    return out


def check_image(img: np.ndarray, a: np.ndarray, meta: dict | None, sid: str, kind: str, ref: np.ndarray | None = None) -> dict:
    """the blocker result for one card image (img RGB 0-1, a = the render's figure alpha at the card's size)"""
    fid = plates.fighter_of(sid)
    p = plates.params(fid, None if sid == fid else sid) or {}
    fp = plates.face_point(meta, p, kind)
    r: dict = {}
    if fp is not None:
        f = feats(img, a, fp, kind, fid)
        if f is not None:
            model = load_model()
            s = score(f, model)
            r["blocker_score"] = round(s, 3)
            r["blocker_threshold"] = model["threshold"] if model else None
            r["blocker_classes"] = classes(f)
            r["blocker"] = bool(model and s >= model["threshold"])
    if ref is not None:
        d = dot_rows(img, ref, a)
        r.update(d)
        if d["dot_row"] >= 4:
            r["blocker"] = True
            r.setdefault("blocker_classes", []).append("invented dot row")
    return r


# ── calibration ──────────────────────────────────────────────────────────────────────────────────
def verdicts() -> list[tuple[str, str]]:
    out = []
    for v in VERDICTS:
        with open(os.path.join(GAME, "_design", "reviews", "cards", v + ".json"), encoding="utf-8") as f:
            out += [(c["card"], c["verdict"]) for c in json.load(f)["perCard"]]
    return out


def _parse(card: str) -> tuple[str, str, str]:
    sid, kind = card.rsplit("_", 1)
    return sid, plates.fighter_of(sid), kind


def _load_snapshot(root: str, card: str):
    sid, fid, kind = _parse(card)
    pre = "" if sid == fid else sid + "_"
    img = np.asarray(Image.open(os.path.join(root, fid, f"{pre}{kind}.png")).convert("RGB")).astype(np.float32) / 255
    raw = np.asarray(Image.open(os.path.join(root, "_plates", f"{sid}_{kind}.png")).convert("RGBA")).astype(np.float32) / 255
    a = raw[..., 3]
    H, W = img.shape[:2]
    if a.shape != (H, W):
        a = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR)).astype(np.float32) / 255
    with open(os.path.join(root, "_plates", f"{sid}_{kind}.png.json"), encoding="utf-8") as f:
        meta = json.load(f)
    return img, a, meta, sid, fid, kind


def _fit(X, y, lam):
    mu, sd = X.mean(0), X.std(0) + 1e-6
    Z = (X - mu) / sd
    w, b = np.zeros(Z.shape[1]), 0.0
    for _ in range(3000):
        p = 1 / (1 + np.exp(-(Z @ w + b)))
        w -= 0.5 * (Z.T @ (p - y) / len(y) + lam * w)
        b -= 0.5 * float((p - y).mean())
    return mu, sd, w, b


def _pred(m, X):
    mu, sd, w, b = m
    return 1 / (1 + np.exp(-(((X - mu) / sd) @ w + b)))


def calibrate(root: str, out: str, features: list[str], lam: float = 0.01, fa: float = 0.10) -> dict:
    rows = []
    for card, v in verdicts():
        img, a, meta, sid, fid, kind = _load_snapshot(root, card)
        p = plates.params(fid, None if sid == fid else sid) or {}
        f = feats(img, a, plates.face_point(meta, p, kind), kind, fid)
        lab = 0 if v == "ok" else (-1 if card in NON_SENSITIVITY else 1)
        rows.append((card, fid, lab, f))
    X = np.array([[r[3][k] for k in features] for r in rows])
    y = np.array([r[2] for r in rows])
    fids = np.array([r[1] for r in rows])
    tr = y >= 0
    m = _fit(X[tr], y[tr].astype(float), lam)
    p = _pred(m, X)
    k = int(np.floor(fa * (y == 0).sum()))
    th = float(np.sort(p[y == 0])[::-1][k]) + 1e-6
    hit = p >= th

    def held(groups):
        pc = np.zeros(len(y))
        for g in np.unique(groups):
            te = groups == g
            pc[te] = _pred(_fit(X[tr & ~te], y[tr & ~te].astype(float), lam), X[te])
        t2 = float(np.sort(pc[y == 0])[::-1][k]) + 1e-6
        return {"catch": round(float((pc[y == 1] >= t2).mean()), 3), "false_alarm": round(float((pc[y == 0] >= t2).mean()), 3),
                "catch_at_fitted_threshold": round(float((pc[y == 1] >= th).mean()), 3),
                "false_alarm_at_fitted_threshold": round(float((pc[y == 0] >= th).mean()), 3)}
    model = {"features": features, "mu": m[0].tolist(), "sd": m[1].tolist(), "w": m[2].tolist(), "b": m[3],
             "threshold": round(th, 6), "lam": lam,
             "fitted_on": "round-1 verdicts " + ", ".join(VERDICTS) + " (45 sensitivity fails, 42 ok)"}
    with open(MODEL, "w", encoding="utf-8") as f:
        json.dump(model, f, indent=1)
    rep = {"what": "card_blockers.py calibration on the round-1 card verdicts",
           "cards": {"sensitivity_fail": int((y == 1).sum()), "ok": int((y == 0).sum()), "other_fail_left_out": int((y == -1).sum())},
           "in_sample": {"catch": round(float(hit[y == 1].mean()), 3), "false_alarm": round(float(hit[y == 0].mean()), 3),
                         "threshold": round(th, 4)},
           "held_out_leave_one_card_out": held(np.arange(len(y))),
           "held_out_leave_one_fighter_out": held(fids),
           "other_fails_flagged": int(hit[y == -1].sum()),
           "missed_sensitivity": [r[0] for r, h in zip(rows, hit) if r[2] == 1 and not h],
           "false_alarms": [r[0] for r, h in zip(rows, hit) if r[2] == 0 and h],
           "per_card": [{"card": r[0], "label": {1: "sensitivity", 0: "ok", -1: "other"}[r[2]], "score": round(float(s), 3),
                         "flag": bool(h), "classes": classes(r[3])} for r, s, h in zip(rows, p, hit)]}
    with open(out, "w", encoding="utf-8") as f:
        json.dump(rep, f, indent=1)
    return rep


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    opt = lambda k, d=None: argv[argv.index(k) + 1] if k in argv else d  # noqa: E731
    if argv[0] == "calibrate":
        feats_ = json.loads(opt("--features", "null")) or (load_model() or {}).get("features")
        rep = calibrate(opt("--cards"), opt("--out", os.path.join(GAME, "_design", "reviews", "cards", "blockers_calib.json")),
                        feats_, float(opt("--lam", "0.01")))
        print(json.dumps({k: rep[k] for k in ("in_sample", "held_out_leave_one_card_out", "held_out_leave_one_fighter_out",
                                              "missed_sensitivity", "false_alarms")}, indent=1))
        return 0
    if argv[0] == "check":
        bad = 0
        for fid in argv[1:]:
            for sid, kind in [(s, k) for s in plates.sids() if plates.fighter_of(s) == fid for k in ("splash", "portrait")]:
                ip = plates.image_path(sid, kind)
                rp = os.path.join(GAME, "art", ".cache", "fighters", "plates", f"{sid}_{kind}.png")
                if not (os.path.isfile(ip) and os.path.isfile(rp)):
                    continue
                img = np.asarray(Image.open(ip).convert("RGB")).astype(np.float32) / 255
                a = np.asarray(Image.open(rp).convert("RGBA")).astype(np.float32)[..., 3] / 255
                if a.shape != img.shape[:2]:
                    a = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).resize(img.shape[1::-1], Image.BILINEAR)).astype(np.float32) / 255
                meta = json.load(open(rp + ".json", encoding="utf-8")) if os.path.isfile(rp + ".json") else None
                r = check_image(img, a, meta, sid, kind)
                bad += bool(r.get("blocker"))
                print(f"  {sid:<24} {kind:<8} score {r.get('blocker_score')} {'BLOCKER' if r.get('blocker') else 'ok'} "
                      f"{', '.join(r.get('blocker_classes', []))}")
        return 1 if bad else 0
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
