#!/usr/bin/env python3
"""VALE art: before/after measure and A/B sheets for the card finish v2 (art/blender/common/plates.py finish2).

    python3 art/tools/card_ab.py measure <fid> [...] --tag before [--faces faces.json]   # BEFORE re-rendering
    python3 art/tools/card_ab.py measure <fid> [...] --tag after                         # after it
    python3 art/tools/card_ab.py sheet <fid> [...] --rev <git rev of the old cards> [--faces faces.json]

`measure` reads the shipped cards (art/out/fighters/<fid>/) and the kept subject passes (art/.cache/fighters/plates/),
so run the "before" measure while the old passes are still in the cache, and writes
_design/reviews/cards/<fid>_<tag>.json. `sheet` writes _design/reviews/cards/<fid>_ab.png (old cards from git).
Run with the project venv's python (numpy, Pillow).

Measures, per card:
  axis_edge   stair-stepping: the share of the figure's strong interior edges whose gradient lies within 6 deg of a pixel
              axis. A box filter's blocks line up with the grid; a clean render's edges do not (chance level is ~13 %).
  flat        posterization: the share of figure pixels in a 5x5 neighbourhood flatter than 1.5 L*, next to strong edges
  rim_side    which side of the figure's outline is brighter than its inside (L* delta left / right), and rim_match:
              whether that is the plate's sun side (plates.plate_light)
  dab         figure vs plate: the distance of their mean (a*, b*), measured on the figure against a ring of plate round it
  face        in the face ellipse: L* p5 / p50 / p95, value range, dark_share (pixels 18 L* under the face's median: slit,
              brow, eye sockets) and edge (mean L* gradient). A blank face has a small range and almost no dark share.
              The face position comes from the pass's render notes (<pass>.json); a card rendered before them needs
              --faces {"<sid>_<kind>": [x, y]} (fractions of the image), else face is null.
These are proxies for a person looking at the sheet. They never replace looking at it.
"""
from __future__ import annotations

import io
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(GAME, "art", "blender", "common"))
import plates  # noqa: E402

OUT = os.path.join(GAME, "_design", "reviews", "cards")


def lab(rgb: np.ndarray) -> np.ndarray:
    lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = lin @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def box_range(a: np.ndarray, r: int) -> np.ndarray:
    """max - min over a (2r+1)^2 window."""
    H, W = a.shape
    p = np.pad(a, r, mode="edge")
    st = np.stack([p[y:y + H, x:x + W] for y in range(0, 2 * r + 1, r) for x in range(0, 2 * r + 1, r)])
    return st.max(0) - st.min(0)


def card_stats(img: np.ndarray, af: np.ndarray, p: dict, face) -> dict:
    H, W = af.shape
    L3 = lab(img.astype(np.float64))
    L = L3[..., 0]
    solid = af > 0.98
    gy, gx = np.gradient(L)
    mag = np.hypot(gx, gy)
    inner = plates.gaussian(af[..., None].astype(np.float32), 2.0)[..., 0] > 0.98
    edge = inner & (mag > 6.0)
    ang = np.degrees(np.arctan2(np.abs(gy), np.abs(gx)))
    axis = (ang < 6.0) | (ang > 84.0)
    r = {"axis_edge": round(float(axis[edge].mean()), 3) if edge.any() else None}
    near = plates.gaussian(edge[..., None].astype(np.float32), 3.0)[..., 0] > 0.08
    fl = box_range(L, 2) < 1.5
    r["flat"] = round(float(fl[inner & near].mean()), 3) if (inner & near).any() else None
    # the rim: the outline's outward-facing pixels against the figure's inside
    ga = plates.gaussian(af[..., None].astype(np.float32), 3.0)[..., 0]
    agy, agx = np.gradient(ga)
    band = (af > 0.5) & (ga < 0.92)
    mid = float(np.median(L[inner])) if inner.any() else 0.0
    left, right = band & (agx > 0.01), band & (agx < -0.01)
    dl = float(L[left].mean() - mid) if left.any() else 0.0
    dr = float(L[right].mean() - mid) if right.any() else 0.0
    side = plates.plate_light(p)["side"]
    rim = "left" if dl > dr + 1.5 else ("right" if dr > dl + 1.5 else "even")
    r.update({"rim_dL_left": round(dl, 1), "rim_dL_right": round(dr, 1), "rim_side": rim,
              "plate_sun": {-1: "left", 1: "right", 0: "behind"}[side],
              "rim_match": bool((rim == "left" and side < 0) or (rim == "right" and side > 0) or side == 0)})
    # the figure against the plate round it
    wide = plates.gaussian(af[..., None].astype(np.float32), 24.0 * W / 1600.0)[..., 0]
    ring = (wide > 0.05) & (af < 0.02)
    if solid.any() and ring.any():
        fa, pa = L3[solid][:, 1:].mean(0), L3[ring][:, 1:].mean(0)
        r["dab"] = round(float(np.hypot(*(fa - pa))), 1)
    r["face"] = None
    if face is not None:
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        rr = (0.05 if W > H else 0.15) * H
        m = (((xx - face[0] * W) ** 2 + (yy - face[1] * H) ** 2) < rr * rr) & (af > 0.9)
        if int(m.sum()) > 32:
            v = L[m]
            med = float(np.median(v))
            r["face"] = {"p5": round(float(np.percentile(v, 5)), 1), "p50": round(med, 1),
                         "p95": round(float(np.percentile(v, 95)), 1),
                         "range": round(float(np.percentile(v, 95) - np.percentile(v, 5)), 1),
                         "dark_share": round(float((v < med - 18.0).mean()), 3), "edge": round(float(mag[m].mean()), 2)}
    return r


def alpha_of(raw: np.ndarray, kind: str, w: int, h: int) -> np.ndarray:
    fg = plates.fg_for(raw, kind, w if kind == "portrait" else None)
    if fg.shape[:2] != (h, w):
        fg = plates.premul_resize(fg, w, h)
    return plates.split_shadow(fg)[0][..., 3]


def card_ids(fid: str) -> list[str]:
    return [s for s in plates.sids() if plates.fighter_of(s) == fid]


def face_of(sid: str, kind: str, faces: dict):
    meta = plates.load_meta(sid, kind)
    fid = plates.fighter_of(sid)
    fp = plates.face_point(meta, plates.params(fid, None if sid == fid else sid), kind)
    return fp if fp is not None else faces.get(f"{sid}_{kind}")


def measure(fids: list[str], tag: str, faces: dict) -> None:
    os.makedirs(OUT, exist_ok=True)
    for fid in fids:
        rows = {}
        for sid in card_ids(fid):
            p = plates.params(fid, None if sid == fid else sid)
            for kind in ("splash", "portrait"):
                ip, rp = plates.image_path(sid, kind), plates.raw_path(sid, kind)
                if not (os.path.isfile(ip) and os.path.isfile(rp)):
                    continue
                img = plates.load_image(ip)[..., :3]
                h, w = img.shape[:2]
                rows[f"{sid}_{kind}"] = card_stats(img, alpha_of(plates.load_image(rp), kind, w, h), p,
                                                   face_of(sid, kind, faces if tag == "before" else {}))
        with open(os.path.join(OUT, f"{fid}_{tag}.json"), "w", encoding="utf-8") as f:
            json.dump(rows, f, indent=1)
        print(f"[card_ab] {fid} {tag}: {len(rows)} cards")


def old_image(path: str, rev: str) -> Image.Image:
    rel = os.path.relpath(path, GAME)
    top = subprocess.check_output(["git", "-C", GAME, "rev-parse", "--show-prefix"], text=True).strip()
    blob = subprocess.check_output(["git", "-C", GAME, "show", f"{rev}:{top}{rel}"])
    return Image.open(io.BytesIO(blob)).convert("RGB")


def face_crop(im: Image.Image, pt, frac: float, size: int) -> Image.Image:
    W, H = im.size
    r = frac * H
    cx, cy = (pt[0] * W, pt[1] * H) if pt else (W / 2, H / 3)
    return im.crop((int(cx - r), int(cy - r), int(cx + r), int(cy + r))).resize((size, size), Image.LANCZOS)


def sheet(fids: list[str], rev: str, faces: dict) -> None:
    os.makedirs(OUT, exist_ok=True)
    for fid in fids:
        sids = card_ids(fid)
        S_W, S_H, P, C, CHIP, pad = 800, 450, 300, 300, 96, 8
        row_h = S_H + P + 3 * pad + 22
        W = 2 * S_W + 3 * pad
        sh = Image.new("RGB", (W, row_h * len(sids) + pad), (17, 20, 26))
        d = ImageDraw.Draw(sh)
        for i, sid in enumerate(sids):
            y = pad + i * row_h
            d.text((pad, y), f"{sid}   LEFT: before ({rev})   RIGHT: after (finish v2)", fill=(237, 230, 214))
            y += 18
            for side, x in ((0, pad), (1, pad * 2 + S_W)):
                def get(kind):
                    pth = plates.image_path(sid, kind)
                    return old_image(pth, rev) if side == 0 else Image.open(pth).convert("RGB")
                sp, po = get("splash"), get("portrait")
                sh.paste(sp.resize((S_W, S_H), Image.LANCZOS), (x, y))
                yy = y + S_H + pad
                sh.paste(po.resize((P, P), Image.LANCZOS), (x, yy))
                fp = faces.get(f"{sid}_splash") if side == 0 else face_of(sid, "splash", {})
                sh.paste(face_crop(sp, fp, 0.085, C), (x + P + pad, yy))
                sh.paste(po.resize((CHIP, CHIP), Image.LANCZOS), (x + P + C + 2 * pad, yy))
                sh.paste(po.resize((48, 48), Image.LANCZOS), (x + P + C + 2 * pad, yy + CHIP + pad))
        out = os.path.join(OUT, f"{fid}_ab.png")
        sh.save(out, optimize=True)
        print(f"[card_ab] {os.path.relpath(out, GAME)}")


def main(argv: list[str]) -> int:
    if len(argv) < 2 or argv[0] not in ("measure", "sheet"):
        print(__doc__)
        return 2
    opts = {}
    rest = []
    i = 1
    while i < len(argv):
        if argv[i].startswith("--"):
            opts[argv[i][2:]] = argv[i + 1]
            i += 2
        else:
            rest.append(argv[i])
            i += 1
    faces = {}
    if opts.get("faces"):
        with open(opts["faces"], encoding="utf-8") as f:
            faces = json.load(f)
    if argv[0] == "measure":
        measure(rest, opts.get("tag", "after"), faces)
    else:
        sheet(rest, opts.get("rev", "HEAD"), faces)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
