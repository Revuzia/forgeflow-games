#!/usr/bin/env python3
"""VALE art: the painted card pass (owner_rulings.md ruling 30): every splash and portrait card is painted over its finished
3D render, gated, and only then shipped. Run with the project venv's python (numpy, Pillow), from games/vale.

    python3 art/tools/paint_card.py paint <fid> [<sid>:<kind> ...] [--variants 3]   # generate + pre-gate (costs ~$0.02 an image)
    python3 art/tools/paint_card.py gate <fid> [<sid>:<kind> ...]                   # re-run the pre-gate on the kept raws
    python3 art/tools/paint_card.py review <fid>                                    # look-check sheets (full, card, chip)
    python3 art/tools/paint_card.py accept <sid>:<kind> <variant|3d> --why "<text>" # ship it (writes the card + paint.json)
    python3 art/tools/paint_card.py apply <fid>                                     # re-ship the accepted variants after a re-render
    python3 art/tools/paint_card.py sheet <fid> --rev <git rev of the old cards>    # A/B: old shipped | 3D v2 | shipped now

paint   The 3D reference is composed fresh from the kept subject pass (art/.cache/fighters/plates/, plates.finish) into
        art/.cache/fighters/paint/<sid>_<kind>_3d.png, then sent to xAI's edit endpoint through tools/imagegen/run_xai.py
        (its find_key / call_edit: the key never leaves that module) with the card's fixed prompt (art/tools/paint_prompts.json
        + the plate's light + the imagegen SENSITIVITY line). The variants land in tools/imagegen/raw/card_<sid>_<kind>__vN.png
        (gitignored), resized to the card's size.
gate    Per variant, all automatic (a person still looks: `review`):
          frame    output aspect within 1.5 % of the card; whole-image luma structure (64 x 36) correlation >= 0.70
          iou      silhouette: the render's figure alpha against the painting's figure mask (a painting pixel is figure when it
                   is closer to the 3D card than to the same card without the figure), on the pixels where the two differ;
                   >= 0.80
          palette  the figure's 5 main colour regions (k-means on the render, Lab): mean CIE76 dE painting vs render <= 14,
                   worst region <= 24
          face     the face box (render notes): value range >= 0.70 of the render's, dark features (slit, lids, pupils) at
                   least half the render's share, L* structure correlation >= 0.45
          store    a skin portrait: mean CIE76 dE against the shipped base portrait (256 px, the gen_store.ts measure) at its tier's
                   floor (standard 12, deluxe or legend 18); node tools/gen_store.ts --check is still run after accepting
accept  Copies the variant (or the 3D reference) to the card's shipped path (plates.image_path, the path the build writes, so
        npm run content and the store read it) and records card, variant, prompt version and full text, raw file, model,
        gate numbers and why in art/out/fighters/<fid>/paint.json.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import subprocess
import sys
import time

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(GAME, "art", "blender", "common"))
sys.path.insert(0, os.path.join(GAME, "tools", "imagegen"))
import plates  # noqa: E402

RAW = os.path.join(GAME, "tools", "imagegen", "raw")
CACHE = os.path.join(GAME, "art", ".cache", "fighters", "paint")
PROMPTS = os.path.join(HERE, "paint_prompts.json")
MODEL = "grok-imagine-image"
TIER_FLOOR = {"standard": 12.0, "deluxe": 18.0, "legend": 18.0}
GATE = {"aspect": 0.015, "struct": 0.70, "iou": 0.80, "pal_mean": 14.0, "pal_max": 24.0,
        "face_range": 0.70, "face_dark": 0.5, "face_corr": 0.45}


# ── helpers ──────────────────────────────────────────────────────────────────────────────────────
def lab(rgb: np.ndarray) -> np.ndarray:
    lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = lin @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def card_ids(fid: str) -> list[tuple[str, str]]:
    return [(s, k) for s in plates.sids() if plates.fighter_of(s) == fid for k in ("splash", "portrait")]


def size_of(kind: str) -> tuple[int, int]:
    return (1600, 900) if kind == "splash" else (512, 512)


def params_of(sid: str) -> dict:
    fid = plates.fighter_of(sid)
    return plates.params(fid, None if sid == fid else sid)


def ref3d(sid: str, kind: str, bg: bool = False) -> tuple[np.ndarray, np.ndarray, dict | None]:
    """(the 3D card, the render's figure alpha, render notes) composed fresh from the kept pass; bg=True: the same card
    with the figure removed (for the painting's figure mask)."""
    raw = plates.load_image(plates.raw_path(sid, kind))
    w, h = size_of(kind)
    fg = plates.fg_for(raw, kind, w if kind == "portrait" else None)
    meta = plates.load_meta(sid, kind)
    p = params_of(sid)
    fig = plates.split_shadow(fg)[0] if kind == "splash" else fg
    if bg:
        fg = fg.copy()
        fg[..., 3] = 0.0
    img = plates.finish(fg, p, kind, meta=meta)[..., :3]
    return img, fig[..., 3], meta


def prompt_of(sid: str, kind: str) -> tuple[str, int]:
    pr = json.load(open(PROMPTS, encoding="utf-8"))
    p = params_of(sid)
    side = "left" if plates.plate_sun(p) < 0 else "right"
    g = plates._hex(p["glow_color"])
    glow = "warm golden" if g[0] > g[2] * 1.15 else ("cool silver" if g[2] > g[0] * 1.1 else "pale white")
    light = pr["light" if kind == "splash" else "light_portrait"].format(side=side, glow=glow)
    from build_manifest import SENSITIVITY  # the imagegen pack's sensitivity line
    frame = "A wide 16:9 splash card." if kind == "splash" else "A square head-and-shoulders portrait card."
    text = " ".join([pr["style"], frame, pr["cards"][sid], light, pr["eyes"], pr["rules"], SENSITIVITY])
    return text, int(pr["version"])


def raw_variant(sid: str, kind: str, v: int) -> str:
    return os.path.join(RAW, f"card_{sid}_{kind}__v{v}.png")


def load_variant(path: str, kind: str) -> tuple[np.ndarray, float]:
    im = Image.open(path).convert("RGB")
    w, h = size_of(kind)
    asp = abs((im.width / im.height) / (w / h) - 1.0)
    return np.asarray(im.resize((w, h), Image.LANCZOS)).astype(np.float32) / 255.0, asp


def blur(a: np.ndarray, s: float) -> np.ndarray:
    return plates.gaussian(a if a.ndim == 3 else a[..., None], s) if a.ndim == 3 else plates.gaussian(a[..., None], s)[..., 0]


# ── the pre-gate ───────────────────────────────────────────────────────────────────────────────
def kmeans(x: np.ndarray, k: int = 5, it: int = 12) -> np.ndarray:
    rng = np.random.default_rng(0)
    c = x[rng.choice(len(x), k, replace=False)]
    for _ in range(it):
        lab_ = np.argmin(((x[:, None, :] - c[None]) ** 2).sum(-1), 1)
        c = np.array([x[lab_ == i].mean(0) if (lab_ == i).any() else c[i] for i in range(k)])
    return lab_


def store_de(a: np.ndarray, b: np.ndarray) -> float:
    A = lab(np.asarray(Image.fromarray((a * 255).astype(np.uint8)).resize((256, 256), Image.BILINEAR)) / 255.0)
    B = lab(np.asarray(Image.fromarray((b * 255).astype(np.uint8)).resize((256, 256), Image.BILINEAR)) / 255.0)
    return float(np.sqrt(((A - B) ** 2).sum(-1)).mean())


def skin_tier(sid: str) -> str | None:
    fid = plates.fighter_of(sid)
    if sid == fid:
        return None
    for fp in (os.path.join(GAME, "content", "skins", f"{fid}.json"), os.path.join(GAME, "content", "skins", f"{sid}.json")):
        if os.path.isfile(fp):
            d = json.load(open(fp, encoding="utf-8"))
            for s in (d if isinstance(d, list) else d.get("skins", [d])):
                if isinstance(s, dict) and s.get("id") == sid:
                    return s.get("tier", "standard")
    return "standard"


def gate_variant(sid: str, kind: str, P: np.ndarray, asp: float, F: np.ndarray, B: np.ndarray, A: np.ndarray,
                 meta: dict | None) -> dict:
    h, w = A.shape
    r = {"aspect_err": round(asp, 4)}
    sm = lambda x: np.asarray(Image.fromarray((np.clip(x, 0, 1) * 255).astype(np.uint8)).resize((64, 36 if kind == "splash" else 64), Image.BILINEAR), np.float32).mean(-1)  # noqa: E731
    r["struct"] = round(float(np.corrcoef(sm(P).ravel(), sm(F).ravel())[0, 1]), 3)
    Pl, Fl, Bl = (lab(blur(x, 1.5).astype(np.float64)) for x in (P, F, B))
    dPF = np.sqrt(((Pl - Fl) ** 2).sum(-1))
    dPB = np.sqrt(((Pl - Bl) ** 2).sum(-1))
    D = np.sqrt(((Fl - Bl) ** 2).sum(-1)) > 6.0
    Mp = (dPF < dPB) & D
    Ar = (A > 0.5) & D
    r["iou"] = round(float((Mp & Ar).sum() / max(1, (Mp | Ar).sum())), 3)
    inner = blur(A.astype(np.float32), 2.0) > 0.98
    X = Fl[inner]
    if len(X) > 500:
        sub = np.random.default_rng(1).choice(len(X), min(len(X), 20000), replace=False)
        labs = kmeans(X[sub])
        full = np.zeros(len(X), int)
        cent = np.array([X[sub][labs == i].mean(0) for i in range(5)])
        full = np.argmin(((X[:, None, :] - cent[None]) ** 2).sum(-1), 1)
        de = [float(dPF[inner][full == i].mean()) for i in range(5) if (full == i).sum() > 50]
        wts = [float((full == i).mean()) for i in range(5) if (full == i).sum() > 50]
        r["pal_mean"] = round(float(np.average(de, weights=wts)), 1)
        r["pal_max"] = round(float(max(de)), 1)
    fp = plates.face_point(meta, params_of(sid), kind)
    if fp is not None:
        yy, xx = np.mgrid[0:h, 0:w]
        rr = (0.05 if kind == "splash" else 0.15) * h
        m = (((xx - fp[0] * w) ** 2 + (yy - fp[1] * h) ** 2) < rr * rr) & (A > 0.9)
        if m.sum() > 32:
            LP, LF = Pl[..., 0][m], Fl[..., 0][m]
            rng = lambda v: float(np.percentile(v, 95) - np.percentile(v, 5))  # noqa: E731
            dk = lambda v: float((v < np.median(v) - 18.0).mean())  # noqa: E731
            r["face_range"] = round(rng(LP) / max(1e-3, rng(LF)), 2)
            r["face_dark"] = round(dk(LP) / max(1e-3, dk(LF)), 2) if dk(LF) > 0.03 else None
            r["face_corr"] = round(float(np.corrcoef(LP, LF)[0, 1]), 2)
    tier = skin_tier(sid) if kind == "portrait" else None
    if tier:
        base = plates.load_image(plates.image_path(plates.fighter_of(sid), "portrait"))[..., :3]
        r["store_de"] = round(store_de(P, base), 1)
        r["store_floor"] = TIER_FLOOR.get(tier, 12.0)
    fails = []
    if asp > GATE["aspect"]:
        fails.append("aspect")
    if r["struct"] < GATE["struct"]:
        fails.append("framing")
    if r["iou"] < GATE["iou"]:
        fails.append("silhouette")
    if "pal_mean" in r and (r["pal_mean"] > GATE["pal_mean"] or r["pal_max"] > GATE["pal_max"]):
        fails.append("palette")
    if "face_range" in r:
        if r["face_range"] < GATE["face_range"] or r["face_corr"] < GATE["face_corr"] or \
                (r.get("face_dark") is not None and r["face_dark"] < GATE["face_dark"]):
            fails.append("face")
    if tier and r["store_de"] < r["store_floor"]:
        fails.append("store_dE")
    r["fails"] = fails
    r["pass"] = not fails
    return r


def gate_card(sid: str, kind: str, n: int) -> list[dict]:
    F, A, meta = ref3d(sid, kind)
    B = ref3d(sid, kind, bg=True)[0]
    os.makedirs(CACHE, exist_ok=True)
    plates.save_png(os.path.join(CACHE, f"{sid}_{kind}_3d.png"), F)
    out = []
    for v in range(1, n + 1):
        fp = raw_variant(sid, kind, v)
        if not os.path.isfile(fp):
            continue
        P, asp = load_variant(fp, kind)
        g = gate_variant(sid, kind, P, asp, F, B, A, meta)
        g["variant"] = v
        out.append(g)
    with open(os.path.join(CACHE, f"{sid}_{kind}_gate.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
    return out


# ── paint ──────────────────────────────────────────────────────────────────────────────────────
def paint(sid: str, kind: str, n: int) -> float:
    import run_xai  # the key stays inside run_xai.find_key / call_edit; nothing here prints or stores it
    F, _A, _m = ref3d(sid, kind)
    os.makedirs(CACHE, exist_ok=True)
    ref = os.path.join(CACHE, f"{sid}_{kind}_3d.png")
    plates.save_png(ref, F)
    text, _ver = prompt_of(sid, kind)
    key = run_xai.find_key(None)
    from pathlib import Path
    imgs = run_xai.call_edit(key, text, [Path(ref)], n, MODEL, "16:9" if kind == "splash" else "1:1", "2k")
    del key
    os.makedirs(RAW, exist_ok=True)
    for i, b in enumerate(imgs[:n], 1):
        with open(raw_variant(sid, kind, i), "wb") as f:
            f.write(b)
    print(f"[paint] {sid} {kind}: {len(imgs)} variants")
    return 0.02 * len(imgs)


# ── review / accept / sheets ───────────────────────────────────────────────────────────────────
def review(fid: str, out_dir: str) -> None:
    os.makedirs(out_dir, exist_ok=True)
    for sid, kind in card_ids(fid):
        gp = os.path.join(CACHE, f"{sid}_{kind}_gate.json")
        if not os.path.isfile(gp):
            continue
        gates = json.load(open(gp))
        ims = [Image.open(os.path.join(CACHE, f"{sid}_{kind}_3d.png")).convert("RGB")]
        labels = ["3D v2"]
        for g in gates:
            ims.append(Image.fromarray((load_variant(raw_variant(sid, kind, g["variant"]), kind)[0] * 255).astype(np.uint8)))
            labels.append(f"v{g['variant']} {'PASS' if g['pass'] else 'fail ' + ','.join(g['fails'])}")
        meta = plates.load_meta(sid, kind)
        fp = plates.face_point(meta, params_of(sid), kind) or (0.5, 0.35)
        W = 640
        H = int(W * ims[0].height / ims[0].width)
        sh = Image.new("RGB", (len(ims) * (W + 6), H + 330), (17, 20, 26))
        d = ImageDraw.Draw(sh)
        for i, (im, lab_) in enumerate(zip(ims, labels)):
            x = i * (W + 6)
            sh.paste(im.resize((W, H), Image.LANCZOS), (x, 0))
            r = (0.07 if kind == "splash" else 0.2) * im.height
            c = (fp[0] * im.width, fp[1] * im.height)
            sh.paste(im.crop((int(c[0] - r), int(c[1] - r), int(c[0] + r), int(c[1] + r))).resize((300, 300), Image.LANCZOS), (x, H + 26))
            chip = im.resize((240, 135) if kind == "splash" else (128, 128), Image.LANCZOS)
            sh.paste(chip, (x + 306, H + 26))
            if kind == "portrait":
                sh.paste(im.resize((64, 64), Image.LANCZOS), (x + 306, H + 160))
            d.text((x + 4, H + 6), lab_, fill=(255, 235, 190))
        sh.save(os.path.join(out_dir, f"review_{sid}_{kind}.png"))
        print(f"[paint] review {sid} {kind}: " + "; ".join(labels))


def record_path(fid: str) -> str:
    return os.path.join(plates.OUT_DIR, fid, "paint.json")


def accept(card: str, choice: str, why: str) -> None:
    sid, kind = card.split(":")
    fid = plates.fighter_of(sid)
    rec = json.load(open(record_path(fid), encoding="utf-8")) if os.path.isfile(record_path(fid)) else {}
    dst = plates.image_path(sid, kind)
    gates = {}
    gp = os.path.join(CACHE, f"{sid}_{kind}_gate.json")
    if os.path.isfile(gp):
        gates = {g["variant"]: g for g in json.load(open(gp))}
    text, ver = prompt_of(sid, kind)
    if choice == "3d":
        F, _A, _m = ref3d(sid, kind)
        plates.save_png(dst, F)
        rec[f"{sid}:{kind}"] = {"shipped": "3d", "why": why, "gates": list(gates.values()), "prompt_version": ver,
                                "date": time.strftime("%Y-%m-%d")}
    else:
        v = int(choice)
        P, _asp = load_variant(raw_variant(sid, kind, v), kind)
        plates.save_png(dst, P)
        raw = raw_variant(sid, kind, v)
        rec[f"{sid}:{kind}"] = {"shipped": "painted", "variant": v, "why": why, "model": MODEL, "prompt_version": ver,
                                "prompt": text, "raw": os.path.relpath(raw, GAME),
                                "raw_sha256": hashlib.sha256(open(raw, "rb").read()).hexdigest(),
                                "gate": gates.get(v), "date": time.strftime("%Y-%m-%d")}
    with open(record_path(fid), "w", encoding="utf-8") as f:
        json.dump(dict(sorted(rec.items())), f, indent=1)
    print(f"[paint] {sid} {kind}: shipped {choice} -> {os.path.relpath(dst, GAME)}")


def apply(fid: str) -> None:
    rec = json.load(open(record_path(fid), encoding="utf-8"))
    for card, r in rec.items():
        sid, kind = card.split(":")
        if r.get("shipped") == "painted":
            raw = os.path.join(GAME, r["raw"])
            if not os.path.isfile(raw) or hashlib.sha256(open(raw, "rb").read()).hexdigest() != r["raw_sha256"]:
                print(f"[paint] {card}: the kept raw is missing or changed: the 3D card stays; repaint it")
                continue
            plates.save_png(plates.image_path(sid, kind), load_variant(raw, kind)[0])
            print(f"[paint] {card}: re-shipped variant {r['variant']}")


def sheet(fid: str, rev: str) -> None:
    out = os.path.join(GAME, "_design", "reviews", "cards", f"{fid}_painted_ab.png")
    cards = card_ids(fid)
    W, H, PW = 520, 292, 292
    sh = Image.new("RGB", (3 * (W + 6) + 3 * (PW + 6), len(cards) // 2 * (H + 24) + 30), (17, 20, 26))
    d = ImageDraw.Draw(sh)
    d.text((6, 6), f"{fid}: old shipped ({rev}) | 3D v2 | shipped now (painted or 3D, paint.json), splash then portrait",
           fill=(237, 230, 214))
    top = subprocess.check_output(["git", "-C", GAME, "rev-parse", "--show-prefix"], text=True).strip()
    for row, sid in enumerate(dict.fromkeys(s for s, _ in cards)):
        y = 26 + row * (H + 24)
        x = 0
        for kind, ww in (("splash", W), ("portrait", PW)):
            pth = plates.image_path(sid, kind)
            old = Image.open(io.BytesIO(subprocess.check_output(["git", "-C", GAME, "show", f"{rev}:{top}{os.path.relpath(pth, GAME)}"]))).convert("RGB")
            v2p = os.path.join(CACHE, f"{sid}_{kind}_3d.png")
            v2 = Image.open(v2p).convert("RGB") if os.path.isfile(v2p) else old
            now = Image.open(pth).convert("RGB")
            for im in (old, v2, now):
                sh.paste(im.resize((ww, H), Image.LANCZOS), (x, y))
                x += ww + 6
        d.text((6, y + H + 4), sid, fill=(237, 230, 214))
    sh.save(out, optimize=True)
    print(f"[paint] {os.path.relpath(out, GAME)}")


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    cmd, rest = argv[0], argv[1:]
    opts = {}
    pos = []
    i = 0
    while i < len(rest):
        if rest[i].startswith("--"):
            opts[rest[i][2:]] = rest[i + 1]
            i += 2
        else:
            pos.append(rest[i])
            i += 1
    n = int(opts.get("variants", 3))
    if cmd in ("paint", "gate"):
        fid = pos[0]
        sel = [tuple(c.split(":")) for c in pos[1:]] or card_ids(fid)
        cost = 0.0
        for sid, kind in sel:
            if cmd == "paint":
                for attempt in range(3):
                    try:
                        cost += paint(sid, kind, n)
                        break
                    except Exception as e:  # a network hiccup: the error text only, never the request
                        print(f"[paint] {sid} {kind}: {type(e).__name__}: {str(e)[:160]}")
                        time.sleep(5 * (attempt + 1))
            for g in gate_card(sid, kind, n):
                print(f"  {sid} {kind} v{g['variant']}: {'PASS' if g['pass'] else 'FAIL ' + ','.join(g['fails'])} "
                      f"iou {g['iou']} struct {g['struct']} pal {g.get('pal_mean')}/{g.get('pal_max')} face "
                      f"{g.get('face_range')}/{g.get('face_dark')}/{g.get('face_corr')} store {g.get('store_de')}")
        if cmd == "paint":
            print(f"[paint] cost ~${cost:.2f}")
    elif cmd == "review":
        review(pos[0], opts.get("out", os.path.join(CACHE, "review")))
    elif cmd == "accept":
        accept(pos[0], pos[1], opts.get("why", ""))
    elif cmd == "apply":
        apply(pos[0])
    elif cmd == "sheet":
        sheet(pos[0], opts.get("rev", "HEAD"))
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
