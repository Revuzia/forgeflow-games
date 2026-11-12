#!/usr/bin/env python3
"""VALE art: the painted card pass (owner_rulings.md ruling 30): every splash and portrait card is painted over its finished
3D render, gated, and only then shipped. Run with the project venv's python (numpy, Pillow), from games/vale.

    python3 art/tools/paint_card.py paint <fid> [<sid>:<kind> ...] [--variants 3]   # generate + pre-gate (costs ~$0.02 an image)
    python3 art/tools/paint_card.py gate <fid> [<sid>:<kind> ...]                   # re-run the pre-gate on the kept raws
    python3 art/tools/paint_card.py review <fid>                                    # look-check sheets (full, card, chip)
    python3 art/tools/paint_card.py accept <sid>:<kind> <variant|3d> --why "<text>" # ship it (writes the card + paint.json)
    python3 art/tools/paint_card.py apply <fid>                                     # re-ship the accepted variants after a re-render
    python3 art/tools/paint_card.py sheet <fid> --rev <git rev of the old cards>    # A/B: old shipped | 3D v2 | shipped now
    python3 art/tools/paint_card.py hand <sid>:<kind> <bone> --what "<the hand>"    # hand-only repaint (crop, edit, blend, gate)
    python3 art/tools/paint_card.py hand-accept <sid>:<kind> <bone> <variant> --why "<text>"

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
          colour   (third pass) no NEW colour inside the figure: pixels with chroma >= 18 (and >= 1.2 x the render's) in a
                   hue the render's figure does not carry (its 24-bin hue histogram, a bin and both neighbours < 0.5 %)
                   and clustered (>= 30 % of a 5 x 5 window) may be at most 0.03 % of the figure
          eyes     (pass 4 recalibration) the eye pixels: the face box's warm chromatic pixels (hue <= 60 / >= 345 deg,
                   S > 40) at their top 20 % saturation (the third pass's most-saturated 15 % took Shadeprint's violet hood).
                   Painting vs render saturation and brightness p95 (HSV, 0-255): fails when brightness rises > 30 with
                   saturation > 10 (verify 2's ember Shadeprint portrait: +41 / +22), or saturation > 30 with brightness
                   > 25 (the third pass's 10: Long Evening's calm eyes under the lantern grade read +12..+23 / +29..+35)
          streak   (pass 4) tear streaks, Sukri's cards only (STREAK_FACES; Kemdo's lower face is a linen wrap): under the
                   eyes found on the render, new thin dark vertical lines away from render edges, as columns that carry a
                   line over 0.25 rr, per rr: <= 0.10 (rejected Sukri splashes 0.22-0.62, accepted Stillwater <= 0.03)
          mask     (pass 4) Shadeprint: the face's lit median within dE 10 of ruling 2's #B39272 (painted orange read 18-22)
          prop     (pass 4) invented props: local-structure Lab dE (each image minus its 4 %-height blur, so a plate regrade
                   does not count), on a 4x grid: a blob of dE >= 10 outside the render's silhouette (dilated 2 %) or of
                   dE >= 14 inside it (eroded) larger than 0.1 % of the image fails (Sukri portrait v2's crook and cup
                   0.73 %, Highrim portrait v1/v2's lens and sun 0.11 / 0.32 %; accepted cards <= 0.05 %)
          menu     (third pass) the loading-card (splash) / draft-cell (portrait) crop: p50 70-110, <= 5 % over luma 200,
                   when the 3D card holds it
          store    a skin portrait: mean CIE76 dE against the shipped base portrait (256 px, the gen_store.ts measure) at its tier's
                   floor (standard 12, deluxe or legend 18); node tools/gen_store.ts --check is still run after accepting
accept  Copies the variant (resized, then FIG_MEDIAN 3x3 median passes inside the render's figure: ruling 12's speckle bar) or
        the 3D reference to the card's shipped path (plates.image_path, the path the build writes, so
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
FIG_MEDIAN = 1        # 3x3 median passes on the figure of an accepted painting (ruling 12's speckle bar <= 2.5: the raw
                      # painting's pixel-scale grain read 2.6-5.2 on the figure; one pass reads 0.9-1.8, strokes survive)
BLENDER_REF = {"tunlan:splash"}   # cards with fighter-only Blender post: referenced from <sid>_<kind>_blender.png (ref3d)
PROP = {"de_out": 10.0, "de_in": 14.0, "out_max": 0.001, "in_max": 0.001}
MASK_TARGET = {"sukri_shadeprint": "#B39272"}   # ruling 2 / 30: the amber lacquer mask (the 3D card reads dE 4.2)
# (cards ks1 fix) the HOLD: a painting is held to its render where the painter keeps breaking on-model in the same place:
#   * the eyes (every card): each eye pixel's saturation at most the render's + EYE_HOLD_S (0-1) (verify ks1: amber iris
#     rings, eye_ds +26..+48 even on light paints with palette dE ~2)
#   * the carved mask (FACE_HOLD fighters: (disc radius x, mix)): the face disc mixed back toward the render's clean
#     mask (all 6 + 3 pass 4 / ks1 Sukri splash variants painted grain lines down from the eyes)
#   * a ruled mask colour (MASK_TARGET): plates.mask_to's gain on the painting's face disc
# The hold runs before the gate and on the shipped card (shipped_painting), so the gate sees what ships.
EYE_HOLD_S = 0.03
FACE_HOLD = {"sukri": (2.2, 0.7), "tunlan": (1.8, 0.6), "marund": (1.8, 0.6), "burdam": (1.8, 0.6), "dunsom": (2.2, 0.8)}
STREAK_FACES = {"sukri", "tunlan", "marund", "burdam", "dunsom"}      # fighters whose face under the eyes is bare (a carved mask): the tear-streak check runs
GATE = {"new_colour": 0.0003, "eye_ds_cap": 15.0, "eye_ds": 30.0, "eye_dv": 30.0, "eye_dv2": 25.0, "streak_cols": 0.10, "mask_de": 10.0, "aspect": 0.015, "struct": 0.70, "iou": 0.80, "pal_mean": 14.0, "pal_max": 24.0,
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
    # (card engineer 1) a card whose Blender run adds fighter-only post the composer here cannot rebuild (Tunlan's base
    # splash: the hound screen and the lantern key, tunlan.py _plate / _finish over plates.*) is referenced from a copy of
    # its Blender card kept beside the paint cache (BLENDER_REF, saved right after the render): the card itself; the
    # figure-less card is that copy away from the figure (its alpha grown 3 %) and the composed plate behind it
    if f"{sid}:{kind}" in BLENDER_REF:
        bp = os.path.join(CACHE, f"{sid}_{kind}_blender.png")
        if os.path.isfile(bp):
            S = np.asarray(Image.open(bp).convert("RGB").resize(img.shape[1::-1], Image.LANCZOS), np.float32) / 255.0
            if not bg:
                img = S
            else:
                h_ = img.shape[0]
                g = blur((fig[..., 3] > 0.02).astype(np.float32)[..., None], 0.03 * h_)[..., 0] > 0.01
                img = np.where(g[..., None], img, S)
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
    subj = (pr.get("cards_portrait") or {}).get(sid) if kind == "portrait" else None
    eyes = (pr.get("eyes_cards") or {}).get(sid) or (pr.get("eyes_cards") or {}).get(plates.fighter_of(sid)) or pr["eyes"]
    text = " ".join([pr["style"], frame, subj or pr["cards"][sid], light, eyes] + ([pr["hands"]] if "hands" in pr else [])
                    + [pr["rules"], SENSITIVITY])
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
    # (third pass) a new saturated colour inside the figure (verify 2: a blue band painted onto a cream clasp)
    CP, CF = np.hypot(Pl[..., 1], Pl[..., 2]), np.hypot(Fl[..., 1], Fl[..., 2])
    hd = np.abs(np.angle(np.exp(1j * (np.arctan2(Pl[..., 2], Pl[..., 1]) - np.arctan2(Fl[..., 2], Fl[..., 1])))))
    # a hue the render's figure does not carry at all: 24 hue bins of the render's chromatic figure pixels; a painting pixel
    # (chroma >= 18, >= 1.2 x the render's there) whose bin and both neighbours hold < 0.5 % of them is a new colour
    figm = A > 0.9
    hF = np.arctan2(Fl[..., 2], Fl[..., 1])
    hP = np.arctan2(Pl[..., 2], Pl[..., 1])
    nb = 24
    binF = ((hF[figm & (CF >= 10.0)] + np.pi) / (2 * np.pi) * nb).astype(int) % nb
    hist = np.bincount(binF, minlength=nb).astype(float)
    hist = hist / max(1.0, hist.sum())
    near = hist + np.roll(hist, 1) + np.roll(hist, -1)
    binP = ((hP + np.pi) / (2 * np.pi) * nb).astype(int) % nb
    newc = figm & (CP >= 18.0) & (CP >= 1.2 * CF) & (near[binP] < 0.005)
    dens = plates._box_mean(newc.astype(np.float32)[..., None], 2)[..., 0]     # clustered, not scattered noise
    r["new_colour"] = round(float(((dens >= 0.3) & newc).sum() / max(1, figm.sum())), 5)
    if fp is not None:
        yy, xx = np.mgrid[0:h, 0:w]
        rr = (0.05 if kind == "splash" else 0.15) * h
        fm = (((xx - fp[0] * w) ** 2 + (yy - fp[1] * h) ** 2) < rr * rr) & (A > 0.9)
        if fm.sum() > 32:
            def hsv(x):
                mx, mn = x.max(-1), x.min(-1)
                return np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-5), 0) * 255.0, mx * 255.0
            SF, VF = hsv(F)
            SP_, VP = hsv(P)
            # (pass 4) the eye pixels: the face disc's WARM chromatic pixels (hue <= 60 or >= 345 deg, S > 40) at their
            # top 20 % saturation. Every card's eyes are warm (amber, honey, brown) and the ember read is warm; the third
            # pass's "most saturated 15 %" took Shadeprint's violet hood instead of its eyes
            hx = F.max(-1)
            dd = np.maximum(hx - F.min(-1), 1e-6)
            r_, g_, b_ = F[..., 0], F[..., 1], F[..., 2]
            HF = np.where(hx == r_, ((g_ - b_) / dd) % 6, np.where(hx == g_, (b_ - r_) / dd + 2, (r_ - g_) / dd + 4)) * 60
            warm = fm & ((HF <= 60) | (HF >= 345)) & (SF > 40)
            if warm.sum() > 16:
                eye = warm & (SF >= np.percentile(SF[warm], 80))
                r["eye_ds"] = round(float(np.percentile(SP_[eye], 95) - np.percentile(SF[eye], 95)), 1)
                r["eye_dv"] = round(float(np.percentile(VP[eye], 95) - np.percentile(VF[eye], 95)), 1)
    # (pass 4) tear streaks (streak_measure) on the cards whose face under the eyes is bare (a mask or skin); Kemdo's is a
    # linen wrap whose painted folds run down by design (they read 0.6-0.9 here and are not tears)
    if plates.fighter_of(sid) in STREAK_FACES:
        r.update(streak_measure(sid, kind, P, F, A, meta))
    r.update(prop_measure(kind, P, F, A))
    # (pass 4) a mask held to a ruling's colour (MASK_TARGET): the lit half of the face disc's median vs the hex
    if sid in MASK_TARGET and fp is not None:
        yy, xx = np.mgrid[0:h, 0:w]
        rr = (0.05 if kind == "splash" else 0.15) * h
        fm = (((xx - fp[0] * w) ** 2 + (yy - fp[1] * h) ** 2) < rr * rr) & (A > 0.9)
        lit = fm & (Fl[..., 0] > np.percentile(Fl[..., 0][fm], 40))
        tgt = lab(np.array([plates._hex(MASK_TARGET[sid])], np.float64))[0]
        r["mask_de"] = round(float(np.linalg.norm(lab(np.median(P[lit], 0)[None].astype(np.float64))[0] - tgt)), 1)
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
    # (third pass) the menu crops (plates.py measure): the loading card / draft cell p50 70-110 and <= 5 % over luma 200;
    # a variant fails only when it breaks a band the 3D card holds (a 3D card already outside it is a separate miss)
    crop = (lambda x: plates.card_crop(x)) if kind == "splash" else (lambda x: plates.cell_crop(x))
    sp_, sf_ = plates.stats(crop(P)), plates.stats(crop(F))
    r["menu_p50"], r["menu_over200"] = sp_["p50"], sp_["over200"]
    ok3 = lambda st: 70 <= st["p50"] <= 110 and st["over200"] <= 5.0  # noqa: E731
    if ok3(sf_) and not ok3(sp_):
        fails.append("menu_luma")
    if r["new_colour"] > GATE["new_colour"]:
        fails.append("new_colour")
    eds, edv = r.get("eye_ds", 0), r.get("eye_dv", 0)       # glowing = brighter with more colour (both up)
    if (edv > GATE["eye_dv"] and eds > 10.0) or (eds > GATE["eye_ds"] and edv > GATE["eye_dv2"]):
        fails.append("eyes")
    # (cards ks1 fix) an absolute cap on the eyes' saturation: p95 S at most the render's + 15 (verify ks1: Sukri's v2
    # portrait passed at eye_ds 26.8 with eye_dv 10.9 and read as saturated amber ember rings round the irises)
    elif eds > GATE["eye_ds_cap"]:
        fails.append("eyes_sat")
    if r.get("mask_de", 0) > GATE["mask_de"]:
        fails.append("mask_colour")
    if r.get("streak_cols", 0) > GATE["streak_cols"]:
        fails.append("streak")
    if r.get("prop_out", 0) > PROP["out_max"] or r.get("prop_in", 0) > PROP["in_max"]:
        fails.append("prop")
    if tier and r["store_de"] < r["store_floor"]:
        fails.append("store_dE")
    r["fails"] = fails
    r["pass"] = not fails
    return r


def _components(m: np.ndarray) -> list[np.ndarray]:
    """4-connected components of a boolean mask: a list of (N, 2) (y, x) index arrays (small masks only)"""
    lab_ = np.zeros(m.shape, np.int32)
    out = []
    ys, xs = np.nonzero(m)
    for y0, x0 in zip(ys, xs):
        if lab_[y0, x0]:
            continue
        k = len(out) + 1
        st = [(y0, x0)]
        lab_[y0, x0] = k
        pts = []
        while st:
            y, x = st.pop()
            pts.append((y, x))
            for yy, xx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= yy < m.shape[0] and 0 <= xx < m.shape[1] and m[yy, xx] and not lab_[yy, xx]:
                    lab_[yy, xx] = k
                    st.append((yy, xx))
        out.append(np.array(pts))
    return out


def streak_measure(sid: str, kind: str, P: np.ndarray, F: np.ndarray, A: np.ndarray, meta: dict | None,
                   debug: str | None = None) -> dict:
    """(cards pass 4) tear streaks: thin dark lines running DOWN the face under the eyes that the render does not have
    (verify 2: dark grain lines from the inner eye corners beside the nose; the third pass's 9 px nose-bridge band read
    0.0 on all three rejected Sukri splashes).
    The band: under the eyes (found on the render: the row of most dark features (L* 18 under the median) in a 1.8 rr
    face disc, and their x extent + 0.12 rr), from the eye line down 1.1 rr, on the figure.
    A new line pixel: the painting's L* minus its horizontal Gaussian (sigma 2 px at 1600) held over 2.5 px vertically,
    at least 2 L* darker than the render's own (negative) response there, away from render edges (the render's L*
    gradient under 2 L*/px: a painted line that sharpens a fold or rim the render has is not a streak).
    streak_cols: the band columns whose line pixels, smoothed over 0.25 rr vertically, cover >= 35 % (a line running
    down that column), per rr of face. Calibrated on verify 2 and the third pass (art/tools/paint_card.py history):
    the rejected Sukri splashes 0.22-0.62, the accepted Stillwater cards <= 0.03."""
    fp = plates.face_point(meta, params_of(sid), kind)
    if fp is None:
        return {}
    h, w = A.shape
    rr = (0.05 if kind == "splash" else 0.15) * h
    sc = h / 900.0 if kind == "splash" else h / 512.0 * 1.6
    yy, xx = np.mgrid[0:h, 0:w]
    disc = (((xx - fp[0] * w) ** 2 + (yy - fp[1] * h) ** 2) < (1.8 * rr) ** 2) & (A > 0.9)
    LF = lab(F.astype(np.float64))[..., 0]
    dark = disc & (LF < np.median(LF[disc]) - 18.0) & (yy < fp[1] * h - 0.15 * rr)     # above the face point: not the mouth
    rows = np.convolve(dark.sum(1).astype(float), np.ones(max(3, int(0.08 * rr))), "same")
    if rows.max() < 3:
        return {"streak_cols": 0.0}
    ey = int(rows.argmax())
    ex = np.nonzero((dark & (np.abs(yy - ey) < 0.10 * rr)).any(0))[0]
    # both eyes: the dark features' extent, at least +-1 rr round the face point (a pupil alone can be the only dark)
    x0 = int(max(0, min(ex.min() - 0.12 * rr, fp[0] * w - 1.0 * rr)))
    x1 = int(min(w, max(ex.max() + 0.12 * rr, fp[0] * w + 1.0 * rr)))
    y0, y1 = int(max(0, ey + 0.04 * rr)), int(min(h, ey + 1.10 * rr))

    def resp(X, sx, sy):
        Lc = lab(X[y0:y1, x0:x1].astype(np.float64))[..., 0].astype(np.float32)
        hp = Lc - plates._gauss1(Lc[..., None], sx * sc, 1)[..., 0]
        return plates._gauss1(hp[..., None], sy * sc, 0)[..., 0]
    fig = A[y0:y1, x0:x1] > 0.9
    Lr = plates.gaussian(LF[y0:y1, x0:x1, None].astype(np.float32), 1.5 * sc)[..., 0]
    gy, gx = np.gradient(Lr)
    vP, vF = resp(P, 2.0, 2.5), resp(F, 2.0, 2.5)
    new = ((vP - np.minimum(vF, 0.0)) < -2.0) & fig & (np.hypot(gx, gy) < 2.0 / sc)
    col = plates._gauss1(new.astype(np.float32)[..., None], 0.25 * rr, 0)[..., 0]
    hit = col.max(0) > 0.35
    if debug:
        m3 = np.zeros(new.shape + (3,), np.float32)
        m3[..., 1] = new
        m3[:, hit, 0] = 0.6
        dbg = np.concatenate([P[y0:y1, x0:x1], F[y0:y1, x0:x1], m3], 1)
        Image.fromarray((np.clip(dbg, 0, 1) * 255).astype(np.uint8)).resize((dbg.shape[1] * 2, dbg.shape[0] * 2), Image.NEAREST).save(debug)
    out = {"streak_cols": round(float(hit.sum() / rr), 3)}
    return out


def prop_measure(kind: str, P: np.ndarray, F: np.ndarray, A: np.ndarray, debug: str | None = None) -> dict:
    """(cards pass 4) invented props (verify 2 / third pass: a crook and cup painted into Sukri's portrait corner, a lens
    and a sun disc into Highrim's): on a 4x-reduced grid, blurred Lab dE painting vs 3D card. Outside the render's
    silhouette (dilated 2 % of the height) a blob of dE >= PROP["de_out"] is something painted where the render has only
    plate; inside it (eroded) a blob of dE >= PROP["de_in"] is a new shape on the figure. Returns each side's largest
    blob as a share of the image (prop_out, prop_in) and its bounding box fill."""
    h, w = A.shape
    f = 4
    hh, ww = h // f, w // f
    red = lambda x: x[:hh * f, :ww * f].reshape(hh, f, ww, f, -1).mean((1, 3))  # noqa: E731
    Pr, Fr = red(P), red(F)
    Ar = red(A[..., None])[..., 0]
    s_ = max(1.0, hh / 225.0)
    # local structure only: a painter's regrade of the plate (a warmer sky, a lighter cliff) moves large areas in colour
    # and is not a prop; each image minus its own large-scale blur (sigma 4 % of the height) keeps forms and edges
    Lp, Lf = lab(blur(Pr, 1.5 * s_).astype(np.float64)), lab(blur(Fr, 1.5 * s_).astype(np.float64))
    big = 0.04 * hh
    Lp = Lp - blur(Lp.astype(np.float32), big)
    Lf = Lf - blur(Lf.astype(np.float32), big)
    dE = np.sqrt(((Lp - Lf) ** 2).sum(-1))
    sil = blur(Ar.astype(np.float32), 0.02 * hh) > 0.02
    inner = blur(Ar.astype(np.float32), 0.01 * hh) > 0.97
    out = {}
    dbg = np.zeros((hh, ww, 3), np.float32)
    for nm, m, thr, ch in (("prop_out", ~sil & (dE >= PROP["de_out"]), PROP["de_out"], 0),
                           ("prop_in", inner & (dE >= PROP["de_in"]), PROP["de_in"], 1)):
        best, fill = 0.0, 0.0
        for c in _components(m):
            a_ = len(c) / float(hh * ww)
            if a_ > best:
                bh = np.ptp(c[:, 0]) + 1
                bw = np.ptp(c[:, 1]) + 1
                best, fill = a_, len(c) / float(bh * bw)
            dbg[c[:, 0], c[:, 1], ch] = 1.0
        out[nm] = round(best, 4)
        out[nm + "_fill"] = round(fill, 2)
    if debug:
        im = np.concatenate([Pr, Fr, dbg], 1)
        Image.fromarray((np.clip(im, 0, 1) * 255).astype(np.uint8)).save(debug)
    return out


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
        P = hold(sid, kind, P, F, A, meta)
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
        F, A, meta_ = ref3d(sid, kind)
        for g in gates:
            P = hold(sid, kind, load_variant(raw_variant(sid, kind, g["variant"]), kind)[0], F, A, meta_)   # as it ships
            ims.append(Image.fromarray((np.clip(P, 0, 1) * 255).astype(np.uint8)))
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


def hold(sid: str, kind: str, P: np.ndarray, F: np.ndarray, A: np.ndarray, meta: dict | None) -> np.ndarray:
    """(cards ks1 fix) the painting held to the render (see EYE_HOLD_S / FACE_HOLD / MASK_TARGET above)"""
    fid = plates.fighter_of(sid)
    p = params_of(sid) or {}
    grow, mix = FACE_HOLD.get(fid, (1.8, 0.0))
    disc = plates._face_disc(P.shape[:2], A, dict(p, mask_r=1.0), kind, meta, grow)
    if disc is None:
        return P
    out = P.copy()
    if mix > 0:
        out = out * (1.0 - mix * disc[..., None]) + F * (mix * disc[..., None])
    # the eyes: the render's inlay pixels (warm, S >= 0.48) in the disc, grown 2 px
    def sat(x):
        mx, mn = x.max(-1), x.min(-1)
        return np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-5), 0.0)
    SF = sat(F)
    eye = (disc > 0.5) & (F[..., 0] > F[..., 2] + 0.08) & (SF >= 0.48)
    g = eye.astype(np.float32)
    h, w = g.shape
    for _ in range(2):
        pp = np.pad(g, 1)
        g = np.max(np.stack([pp[dy:dy + h, dx:dx + w] for dy in range(3) for dx in range(3)]), axis=0)
    g = blur(g[..., None], 1.0)[..., 0] if g.any() else g
    SP = sat(out)
    cap = np.clip(SF + EYE_HOLD_S, 0.0, 1.0)
    k = np.where(SP > cap, cap / np.maximum(SP, 1e-5), 1.0)
    L = (out @ np.array([0.2126, 0.7152, 0.0722], np.float32))[..., None]
    capped = L + (out - L) * k[..., None]
    out = out * (1.0 - g[..., None]) + capped * g[..., None]
    if sid in MASK_TARGET:
        comp = np.concatenate([out, np.ones_like(out[..., :1])], 2).astype(np.float32)
        out = plates.mask_to(comp, A, dict(p, mask_to=MASK_TARGET[sid]), kind, meta)[..., :3]
    return np.clip(out, 0.0, 1.0).astype(np.float32)


def shipped_painting(sid: str, kind: str, v: int) -> np.ndarray:
    """The accepted painting as shipped: resized to the card, held to the render (hold), then FIG_MEDIAN median passes
    inside the render's figure."""
    P, _asp = load_variant(raw_variant(sid, kind, v), kind)
    F, A, meta = ref3d(sid, kind)
    P = hold(sid, kind, P, F, A, meta)
    if FIG_MEDIAN > 0:
        P = plates.median3(np.concatenate([P, A[..., None]], 2).astype(np.float32), FIG_MEDIAN)[..., :3]
    return P


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
        P = shipped_painting(sid, kind, v)
        plates.save_png(dst, P)
        raw = raw_variant(sid, kind, v)
        rec[f"{sid}:{kind}"] = {"shipped": "painted", "variant": v, "why": why, "model": MODEL, "prompt_version": ver,
                                "prompt": text, "raw": os.path.relpath(raw, GAME),
                                "raw_sha256": hashlib.sha256(open(raw, "rb").read()).hexdigest(),
                                "gate": gates.get(v), "figure_median": FIG_MEDIAN,
 "date": time.strftime("%Y-%m-%d")}
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
            plates.save_png(plates.image_path(sid, kind), shipped_painting(sid, kind, int(r["variant"])))
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


# ── hands: a hand-only repaint through the same edit path (cards third pass, verify 2 item 6) ───────────────────────
def hand_box(sid: str, kind: str, bone: str) -> tuple[int, int, int]:
    meta = plates.load_meta(sid, kind)
    pt = (meta or {}).get("pts", {}).get(bone)
    if pt is None:
        raise SystemExit(f"{sid} {kind}: no render point for {bone}")
    w, h = size_of(kind)
    S = int(round((0.16 if kind == "splash" else 0.32) * h))
    cx = int(round(min(max(pt[0] * w, S / 2), w - S / 2)))
    cy = int(round(min(max(pt[1] * h, S / 2), h - S / 2)))
    return cx - S // 2, cy - S // 2, S


def hand_raw(sid, kind, bone, v):
    return os.path.join(RAW, f"hand_{sid}_{kind}_{bone}__v{v}.png")


def hand_blend(base: np.ndarray, crop: np.ndarray, x0: int, y0: int, S: int, A: np.ndarray) -> np.ndarray:
    """the repainted crop over the card: a soft disc round the hand, limited to the figure (the plate is never touched)"""
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    d = np.hypot(xx - S / 2, yy - S / 2) / (S / 2)
    disc = np.clip((0.95 - d) / 0.3, 0.0, 1.0)
    fig = np.clip(plates.gaussian(A[y0:y0 + S, x0:x0 + S, None].astype(np.float32), 1.5)[..., 0] * 1.2, 0.0, 1.0)
    m = (disc * fig)[..., None]
    out = base.copy()
    out[y0:y0 + S, x0:x0 + S] = base[y0:y0 + S, x0:x0 + S] * (1 - m) + crop * m
    return out


def hand(sid: str, kind: str, bone: str, what: str, n: int) -> float:
    import run_xai
    from pathlib import Path
    base = plates.load_image(plates.image_path(sid, kind))[..., :3]
    x0, y0, S = hand_box(sid, kind, bone)
    crop = base[y0:y0 + S, x0:x0 + S]
    os.makedirs(CACHE, exist_ok=True)
    ref = os.path.join(CACHE, f"hand_{sid}_{kind}_{bone}_ref.png")
    Image.fromarray((np.clip(crop, 0, 1) * 255).astype(np.uint8)).resize((1024, 1024), Image.LANCZOS).save(ref)
    pr = json.load(open(PROMPTS, encoding="utf-8"))
    from build_manifest import SENSITIVITY
    text = pr["hand"].format(what=what) + " " + SENSITIVITY
    key = run_xai.find_key(None)
    imgs = run_xai.call_edit(key, text, [Path(ref)], n, MODEL, "1:1", "2k")
    del key
    for i, b in enumerate(imgs[:n], 1):
        with open(hand_raw(sid, kind, bone, i), "wb") as f:
            f.write(b)
    hand_gate(sid, kind, bone, n, text)
    return 0.02 * len(imgs)


def hand_gate(sid: str, kind: str, bone: str, n: int, text: str = "") -> list[dict]:
    base = plates.load_image(plates.image_path(sid, kind))[..., :3]
    _F, A, _m = ref3d(sid, kind)
    x0, y0, S = hand_box(sid, kind, bone)
    bc = base[y0:y0 + S, x0:x0 + S]
    out = []
    for v in range(1, n + 1):
        fp = hand_raw(sid, kind, bone, v)
        if not os.path.isfile(fp):
            continue
        c = np.asarray(Image.open(fp).convert("RGB").resize((S, S), Image.LANCZOS), np.float32) / 255.0
        blended = hand_blend(base, c, x0, y0, S, A)
        bb = blended[y0:y0 + S, x0:x0 + S]
        g = {"variant": v}
        sm = lambda x: np.asarray(Image.fromarray((np.clip(x, 0, 1) * 255).astype(np.uint8)).resize((48, 48), Image.BILINEAR), np.float32).mean(-1)  # noqa: E731
        g["struct"] = round(float(np.corrcoef(sm(bb).ravel(), sm(bc).ravel())[0, 1]), 3)
        fm = A[y0:y0 + S, x0:x0 + S] > 0.9
        dE = np.sqrt(((lab(bb.astype(np.float64)) - lab(bc.astype(np.float64))) ** 2).sum(-1))
        g["pal_mean"] = round(float(dE[fm].mean()), 1) if fm.any() else None
        fails = []
        if g["struct"] < 0.80:
            fails.append("framing")
        if g["pal_mean"] is not None and g["pal_mean"] > 12.0:
            fails.append("palette")
        g["fails"], g["pass"] = fails, not fails
        out.append(g)
        plates.save_png(os.path.join(CACHE, f"hand_{sid}_{kind}_{bone}_v{v}_card.png"), blended)
        sh = Image.new("RGB", (3 * 300 + 12, 300), (17, 20, 26))
        for i, im in enumerate((bc, c, bb)):
            sh.paste(Image.fromarray((np.clip(im, 0, 1) * 255).astype(np.uint8)).resize((300, 300), Image.LANCZOS), (i * 306, 0))
        sh.save(os.path.join(CACHE, f"hand_{sid}_{kind}_{bone}_v{v}_review.png"))
        print(f"  hand {sid} {kind} {bone} v{v}: {'PASS' if g['pass'] else 'FAIL ' + ','.join(fails)} struct {g['struct']} pal {g['pal_mean']}")
    with open(os.path.join(CACHE, f"hand_{sid}_{kind}_{bone}_gate.json"), "w", encoding="utf-8") as f:
        json.dump({"prompt": text, "gates": out}, f, indent=1)
    return out


def hand_accept(card: str, bone: str, v: int, why: str) -> None:
    sid, kind = card.split(":")
    fid = plates.fighter_of(sid)
    rec = json.load(open(record_path(fid), encoding="utf-8"))
    src = os.path.join(CACHE, f"hand_{sid}_{kind}_{bone}_v{v}_card.png")
    plates.save_png(plates.image_path(sid, kind), plates.load_image(src)[..., :3])
    g = json.load(open(os.path.join(CACHE, f"hand_{sid}_{kind}_{bone}_gate.json")))
    raw = hand_raw(sid, kind, bone, v)
    rec[card]["hand"] = {"bone": bone, "variant": v, "why": why, "prompt": g["prompt"], "raw": os.path.relpath(raw, GAME),
                         "raw_sha256": hashlib.sha256(open(raw, "rb").read()).hexdigest(),
                         "gate": next((x for x in g["gates"] if x["variant"] == v), None)}
    with open(record_path(fid), "w", encoding="utf-8") as f:
        json.dump(dict(sorted(rec.items())), f, indent=1)
    print(f"[paint] {card}: hand {bone} v{v} shipped")


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
    elif cmd == "hand":
        sid, kind = pos[0].split(":")
        print(f"[paint] cost ~${hand(sid, kind, pos[1], opts.get('what', 'a hand'), n):.2f}")
    elif cmd == "hand-accept":
        hand_accept(pos[0], pos[1], int(pos[2]), opts.get("why", ""))
    elif cmd == "sheet":
        sheet(pos[0], opts.get("rev", "HEAD"))
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
