#!/usr/bin/env python3
"""VALE art: card QA for the per-skin splash and portrait staging (closing review, CW5 cards pipeline).

    python3 art/tools/card_qa.py vashil [ardit ...] [--out _harness/_reports/fw_CW5_cards.txt] [--json out.json]

Reads the shipped cards (art/out/fighters/<fid>/[<skin>_]splash.png / portrait.png) and the kept subject passes
(art/.cache/fighters/plates/<sid>_<kind>.png: their alpha is the figure mask). Per card:
  grain    the closing reviewers' measure: std of (grey - gaussian blur sigma 2) in 16 x 16 blocks. `fig` = blocks
           wholly inside the figure (mask > 0.98 over the block), `plate` = blocks with no figure in them; reported
           as p50 / p90 over the blocks. GATE: figure p50 <= 2 x the plate's p50 (grain is the speckle the
           reviewers saw on flat cloth; the p90 blocks hold the figure's real edges and are reported only), and the
           reviewers' half-image p90 pair (x >= 800 / x < 800) for comparison with closing_vashil_splash_grain.txt.
  hi       the figure's luma (Rec. 709, 0-255) p99 / p99.7 / p99.9 / max. GATE: p99.9 >= 230 (highlights).
  mad      figure-box mean absolute difference (RGB, /255) against the base card of the fighter (the box: the
           union of both figures' bounds + 16 px). GATE for a skin: >= 30.
  frame    (splash) the figure's mass centre across (fraction of the width), its top and feet rows (fractions of
           the height). GUIDE: mass 0.66-0.76, head ~0.10, feet ~0.95.
Exit 1 when a gate fails.
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
from PIL import Image

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
    r["hi"] = {"p50": round(q(L, 50)), "p99": round(q(L, 99)), "p99_7": round(q(L, 99.7)), "p99_9": round(q(L, 99.9)),
               "max": round(float(L.max())) if len(L) else None}
    ys, xs = np.nonzero(a > 0.6)
    if len(xs):
        w = a[a > 0.6]
        r["frame"] = {"mass_x": round(float((xs * w).sum() / w.sum()) / W, 3), "x0": round(xs.min() / W, 3),
                      "x1": round(xs.max() / W, 3), "top": round(ys.min() / H, 3), "feet": round(ys.max() / H, 3)}
    r["_img"], r["_a"] = img, a
    return r


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
                ok_g = g["fig_p50"] <= 2.0 * max(g["plate_p50"], 0.25)
                ok_h = (h["p99_9"] or 0) >= 230
                r["mad"] = mad(r, base[kind]) if sid != fid and kind in base else None
                ok_m = r["mad"] is None or r["mad"] >= 30.0
                r["gates"] = {"grain": ok_g, "highlights": ok_h, "mad": ok_m}
                bad += (not ok_g) + (not ok_h) + (not ok_m)
                fr = r.get("frame", {})
                lines.append(
                    f"  {sid:<22} {kind:<8} grain fig p50 {g['fig_p50']:5.2f} p90 {g['fig_p90']:5.2f} | plate p50 "
                    f"{g['plate_p50']:5.2f} p90 {g['plate_p90']:5.2f}{'' if ok_g else ' !'}"
                    + (f" | halves R/L p90 {g['half_right_p90']:.2f}/{g['half_left_p90']:.2f}" if "half_right_p90" in g else "")
                    + f" || hi p50 {h['p50']} p99 {h['p99']} p99.7 {h['p99_7']} p99.9 {h['p99_9']} max {h['max']}"
                    f"{'' if ok_h else ' !'}"
                    + (f" || mad {r['mad']:.1f}{'' if ok_m else ' !'}" if r["mad"] is not None else "")
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
