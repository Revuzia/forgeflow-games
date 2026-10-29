#!/usr/bin/env python3
"""HUD-1: re-grade the painted item and ability icons into VALE's 'ledger family' code.

    ~/Developer/forgeflow-games/.venv/bin/python3 tools/imagegen/icon_grade.py            # items + abilities
    ... icon_grade.py --only item_chalk_knife,ability_ardit_  --out-dir /tmp/x            # preview elsewhere
    ... icon_grade.py --sheet /tmp/sheet.png                                             # also a contact sheet

The paintings came back on one dark ink-blue vignette with a mid-size, dim subject, so at the 38 px inventory slot
every item read as the same navy family. This pass works from the raw generation (tools/imagegen/raw, the variant
picks.json ships) and, per icon:

1. finds the painted ground (pixels near the border ring's ink-blue in a*b*, darker than the ground's own ceiling;
   soft, so rim light and glows stay subject) and the subject's box (1st-99th percentile of the subject mask, so a
   stray spark does not widen it);
2. crops square round the subject so its long side fills FILL of the frame (never zooming past MAX_ZOOM);
3. repaints the ground in the record's family ramp (src/ui/hud/icon_families.json): items by their ledger family
   (Strike, Craft, Guard, Stride), abilities by the owning fighter's vfx.signature hue; lit behind the subject and
   dark at the corners, keeping the brush texture of the original ground;
4. lifts the subject's values (its 98th-percentile L* to SUBJECT_HI, a gentle gamma) and chroma slightly;
5. writes the 256 px WebP the content refs already point at.

The 1 px chalk keyline and the hour-tick tier marks are drawn by the HUD (hud.css .iglyph::after / .iglyph__ticks),
so they stay crisp at every size. Measure with: node _harness/icon_probe.mjs
Requires Pillow, numpy, scipy (the forgeflow venv has them).
"""
from __future__ import annotations

import argparse
import colorsys
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

HERE = Path(__file__).resolve().parent
VALE = HERE.parent.parent
RAW = HERE / "raw"
FAM = json.loads((VALE / "src/ui/hud/icon_families.json").read_text(encoding="utf-8"))

OUT_PX = 256
WORK_PX = 384          # mask / box analysis size
FILL = 0.92            # subject long side / frame side
MAX_ZOOM = 2.1         # never crop tighter than 1 / MAX_ZOOM of the painting
SUBJECT_GAMMA = 0.80   # < 1 lifts the subject's mid-tones
HI_TARGET = 0.81       # the subject's top highlights (about 6 % of the frame) land at this L* / 100
MAX_GAIN = 2.2         # never scale a subject's values by more than this
GROUND_L = (54.0, 27.0)  # ability ground ramp L* (centre, edge); items use icon_families.json


# ── colour ───────────────────────────────────────────────────────────────────────────────────────
def _lin(c: np.ndarray) -> np.ndarray:
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def _gam(c: np.ndarray) -> np.ndarray:
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


_M = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
_MI = np.linalg.inv(_M)
_WP = np.array([0.95047, 1.0, 1.08883])


def rgb2lab(rgb: np.ndarray) -> np.ndarray:
    xyz = _lin(rgb) @ _M.T / _WP
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def lab2rgb(lab: np.ndarray) -> np.ndarray:
    fy = (lab[..., 0] + 16) / 116
    fx, fz = fy + lab[..., 1] / 500, fy - lab[..., 2] / 200
    f = np.stack([fx, fy, fz], -1)
    xyz = np.where(f ** 3 > 216 / 24389, f ** 3, (116 * f - 16) / (24389 / 27)) * _WP
    return _gam(xyz @ _MI.T)


def hex2lab(h: str) -> np.ndarray:
    return rgb2lab(np.array([int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]))


def hue_ramp(sig: str) -> tuple[np.ndarray, np.ndarray]:
    """[centre, edge] Lab ground for an ability: the fighter's signature hue at the item grounds' value/chroma."""
    lab = hex2lab(sig)
    h = np.arctan2(lab[2], lab[1])
    c0, c1 = 44.0, 28.0
    if np.hypot(lab[1], lab[2]) < 12:       # a near-grey signature: keep it grey-ish
        c0, c1 = 10.0, 6.0
    return (np.array([GROUND_L[0], c0 * np.cos(h), c0 * np.sin(h)]), np.array([GROUND_L[1], c1 * np.cos(h), c1 * np.sin(h)]))


# ── records ──────────────────────────────────────────────────────────────────────────────────────
def item_family(item: dict) -> str:
    if item.get("tier") in FAM.get("tiers", {}):
        return FAM["tiers"][item["tier"]]
    best, score = None, 0.0
    for fid, f in FAM["families"].items():
        s = sum(f["stats"].get(k, 0) * float(v) for k, v in (item.get("stats") or {}).items())
        if s > score:
            best, score = fid, s
    if best:
        return best
    for t in item.get("tags", []):
        if t in FAM["tags"]:
            return FAM["tags"][t]
    return "craft"


def records() -> dict[str, dict]:
    """manifest icon id -> {out, kind: item|ability, ramp: (centre Lab, edge Lab), family/owner}"""
    man = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    items = {i["id"]: i for i in json.loads((VALE / "content/items.json").read_text())["items"]}
    sig: dict[str, str] = {}
    for f in (VALE / "content/fighters").glob("*.json"):
        d = json.loads(f.read_text())
        for k in (d["kit"].values() if isinstance(d["kit"], dict) else d["kit"]):
            if isinstance(k, dict) and k.get("id"):
                sig[k["id"]] = d["vfx"]["signature"]
            for extra in (k.get("forms") or []) if isinstance(k, dict) else []:
                if isinstance(extra, dict) and extra.get("id"):
                    sig[extra["id"]] = d["vfx"]["signature"]
        fid = d["id"]
        for icon in (VALE / "content/ui/icons/abilities").glob(f"{fid}_*.webp"):
            sig.setdefault(icon.stem, d["vfx"]["signature"])
    out: dict[str, dict] = {}
    for rec in man["items"]:
        if rec["kind"] != "icon":
            continue
        p = rec["out"]
        if "/icons/items/" in p:
            iid = Path(p).stem
            it = items.get(iid)
            if not it:
                continue
            fam = item_family(it)
            g = FAM["families"][fam]["ground"]
            out[rec["id"]] = {"out": p, "kind": "item", "family": fam, "ramp": (hex2lab(g[0]), hex2lab(g[1]))}
        elif "/icons/abilities/" in p:
            aid = Path(p).stem
            if aid in sig:
                out[rec["id"]] = {"out": p, "kind": "ability", "owner": sig[aid], "ramp": hue_ramp(sig[aid])}
            else:
                g = FAM["abilityNeutral"]
                out[rec["id"]] = {"out": p, "kind": "ability", "owner": None, "ramp": (hex2lab(g[0]), hex2lab(g[1]))}
    return out


# ── the grade ────────────────────────────────────────────────────────────────────────────────────
def ground_ref(lab: np.ndarray) -> tuple[np.ndarray, float]:
    """the painted ground's colour (median of the border ring) and its value ceiling, from the WHOLE painting (a
    crop's border may run through the subject)"""
    h = lab.shape[0]
    b = max(2, round(h * 0.06))
    ring = np.concatenate([lab[:b].reshape(-1, 3), lab[-b:].reshape(-1, 3), lab[:, :b].reshape(-1, 3), lab[:, -b:].reshape(-1, 3)])
    return np.median(ring, 0), float(np.percentile(ring[:, 0], 97))


def groundness(lab: np.ndarray, ref_hi: tuple[np.ndarray, float] | None = None) -> np.ndarray:
    """0..1: how much a pixel is the painted ink-blue ground (soft)."""
    ref, l_hi = ref_hi if ref_hi is not None else ground_ref(lab)
    dab = np.hypot(lab[..., 1] - ref[1], lab[..., 2] - ref[2])
    g_col = np.exp(-(dab / 13.0) ** 2)
    if np.hypot(ref[1], ref[2]) < 8:
        # a near-black vignette (little chroma to key on): a tighter tolerance, and the ground is whatever leans blue,
        # so a dark warm subject (a brown shadow hand) is not mistaken for it
        blue = 1 / (1 + np.exp((lab[..., 2] + 3.0) / 2.0)) * np.exp(-(np.maximum(0, lab[..., 1] - ref[1] - 3) / 6.0) ** 2)
        g_col = np.maximum(np.exp(-(dab / 6.0) ** 2), blue)
    # the vignette's own ceiling; capped, so light rays that reach the border (a glow painted behind the subject)
    # stay subject instead of being repainted as ground
    l_thr = min(max(l_hi + 10.0, 30.0), 42.0)
    g_l = 1 / (1 + np.exp((lab[..., 0] - l_thr) / 3.5))
    g = g_col * g_l
    # the vignette's black end: very dark pixels in a dark region that reaches the border (a dark subject inside the
    # frame, a shadow hand or an ink blade, stays subject)
    dark = (lab[..., 0] < 8) & (g_col > 0.3)
    lbl, n = ndi.label(dark)
    if n:
        edge_ids = np.unique(np.concatenate([lbl[0], lbl[-1], lbl[:, 0], lbl[:, -1]]))
        dark = np.isin(lbl, edge_ids[edge_ids > 0])
        g = np.maximum(g, dark.astype(float) * 0.85)
    return g


def subject_box(g: np.ndarray) -> tuple[float, float, float, float, float]:
    """(cx, cy, bw, bh, coverage) in 0..1 of the analysis frame"""
    m = g < 0.5
    m = ndi.binary_opening(m, iterations=2)
    lab_, n = ndi.label(m)
    if n:
        sizes = ndi.sum(m, lab_, range(1, n + 1))
        keep = np.isin(lab_, 1 + np.flatnonzero(sizes >= m.size * 0.002))
        m = keep
    ys, xs = np.nonzero(m)
    h, w = g.shape
    if len(xs) < 50:
        return 0.5, 0.5, 1.0, 1.0, 0.0
    x0, x1 = np.percentile(xs, [1, 99]) / w
    y0, y1 = np.percentile(ys, [1, 99]) / h
    return (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0, float(m.mean())


def grade(src: Path, ramp: tuple[np.ndarray, np.ndarray], override: dict | None = None) -> tuple[Image.Image, dict]:
    override = override or {}
    full = Image.open(src).convert("RGB")
    small = np.asarray(full.resize((WORK_PX, WORK_PX), Image.LANCZOS)).astype(np.float64) / 255
    lab0 = rgb2lab(small)
    ref_hi = ground_ref(lab0)

    def key(lab_: np.ndarray) -> np.ndarray:
        g_ = groundness(lab_, ref_hi)
        if override.get("enclosed"):
            # dark paint the subject wholly encloses (a soot-black fuller down a blade, the shade between cord wraps)
            # is the subject's own, not ground showing through: keep the silhouette's interior whole (its soft outer
            # 2 px still blend), so it is never repainted in the family hue
            inner = ndi.binary_erosion(ndi.binary_fill_holes(g_ < 0.5), iterations=2)
            g_ = np.where(inner, 0.0, g_)
        return g_

    g0 = ndi.gaussian_filter(key(lab0), 1.0)
    cx, cy, bw, bh, cov0 = subject_box(g0)
    # a thin subject (a bow, a rod) may run a little past the frame so it still carries some area
    fill = FILL if cov0 >= 0.2 else FILL + (0.2 - max(cov0, 0.05)) * 0.9
    fill = override.get("fill", fill)   # a corner-to-corner diagonal subject: frame it looser, so two corners stay ground
    side = min(1.0, max(max(bw, bh) / fill, 1 / MAX_ZOOM))
    cx = min(max(cx, side / 2), 1 - side / 2)
    cy = min(max(cy, side / 2), 1 - side / 2)
    W = full.width
    box = (round((cx - side / 2) * W), round((cy - side / 2) * W), round((cx + side / 2) * W), round((cy + side / 2) * W))
    crop = full.crop(box).resize((OUT_PX, OUT_PX), Image.LANCZOS)
    rgb = np.asarray(crop).astype(np.float64) / 255
    lab = rgb2lab(rgb)
    g = ndi.gaussian_filter(key(lab), 0.8)
    subj = g < 0.5

    # ground: the family ramp, lit behind the subject, with the original ground's brush texture
    yy, xx = np.mgrid[0:OUT_PX, 0:OUT_PX] / (OUT_PX - 1)
    # the subject's centre in the crop (the light sits behind it)
    if subj.any():
        sy, sx = np.nonzero(subj)
        ccx, ccy = sx.mean() / OUT_PX, sy.mean() / OUT_PX
    else:
        ccx = ccy = 0.5
    r = np.hypot(xx - (0.5 * ccx + 0.25), yy - (0.5 * ccy + 0.25)) / 0.72
    wgt = np.clip(1 - r, 0, 1) ** 1.25
    centre, edge = ramp
    ground = edge[None, None, :] * (1 - wgt[..., None]) + centre[None, None, :] * wgt[..., None]
    tex = lab[..., 0] - ndi.gaussian_filter(lab[..., 0], 5)
    ground[..., 0] += np.clip(tex * 0.9, -7, 7)

    # the subject sits on the lighter ground with a soft ink contact shadow (down-right, the light is top-left)
    a = 1 - g
    shadow = ndi.shift(ndi.gaussian_filter(a, 4.0), (4, 3), order=1, mode="nearest")
    halo = ndi.gaussian_filter(a, 2.0)
    ground[..., 0] *= 1 - np.clip(0.45 * shadow + 0.25 * halo, 0, 0.6)

    # subject: gamma-lift the mid-tones, then scale so its top highlights (the brightest ~6 % of the FRAME, i.e. the
    # top 6 % / coverage of the subject) reach HI_TARGET; a shoulder rolls the rest off instead of clipping
    L = lab[..., 0] / 100
    y = np.power(np.clip(L, 0, 1), SUBJECT_GAMMA)
    cov = max(float(subj.mean()), 0.08)
    q = float(np.clip(1 - 0.06 / cov, 0.5, 0.985))
    yq = np.percentile(y[subj], q * 100) if subj.sum() > 100 else 0.7

    def render(target: float, gain: float, knee: float, gnd: np.ndarray) -> Image.Image:
        s = float(np.clip(target / max(yq, 0.05), 1.0, gain))
        x = y * s
        y2 = np.where(x < knee, x, knee + (1 - knee) * (1 - np.exp(-(x - knee) / (1 - knee))))
        sub = np.stack([np.minimum(y2 * 100, 99.0), lab[..., 1] * 1.12, lab[..., 2] * 1.12], -1)
        out = gnd * g[..., None] + sub * (1 - g[..., None])
        return Image.fromarray((lab2rgb(out) * 255 + 0.5).clip(0, 255).astype(np.uint8))

    # closed loop on what the probe reads: raise the highlight target until p95 >= P95_AIM at 38 and 40 px. A
    # dark-by-design subject (a shadow hand, an ink beast: a dark, grey subject) only gets a modest lift, so
    # it stays a shadow; it reads through the rim below instead
    subj_med = float(np.median(lab[..., 0][subj])) if subj.sum() > 100 else 50.0
    subj_chroma = float(np.median(np.hypot(lab[..., 1], lab[..., 2])[subj])) if subj.sum() > 100 else 20.0
    shade = bool(override.get("shade", subj_med < SHADE_L and subj_chroma < SHADE_C))
    steps = ((HI_TARGET, 1.35, 0.78),) if shade else (
        (HI_TARGET, MAX_GAIN, 0.78), (0.86, 2.5, 0.78), (0.90, 2.8, 0.80), (0.94, 3.2, 0.82),
        (0.98, 3.6, 0.84), (1.04, 4.0, 0.86), (1.10, 4.5, 0.88))
    def finish(target: float, gain: float, knee: float, rim_d: int = 0, lit: bool = False, lift: float = 0.0) -> Image.Image:
        gnd = ground.copy()
        gnd[..., 0] += lift
        if lit:   # a shadow subject's last resort: a lit wall in the same hue behind it (a shadow puppet on a lamp-lit wall)
            gnd[..., 0] = np.minimum(gnd[..., 0] * 0.6 + 50.0 * wgt + 30.0, 94.0)
        img = render(target, gain, knee, gnd)
        if not rim_d:
            return img
        # VALE's Shade look, ink with a light rim: a pale rim on the silhouette's lit (top-left) edges
        a = 1 - g
        rim = ndi.gaussian_filter(np.clip(a - ndi.shift(a, (rim_d, rim_d), order=1, mode="constant", cval=0.0), 0, 1), 0.8)
        blab = rgb2lab(np.asarray(img).astype(np.float64) / 255)
        tint = np.array([97.0, centre[1] * 0.25, centre[2] * 0.25])
        blab = blab * (1 - rim[..., None]) + tint[None, None, :] * rim[..., None]
        return Image.fromarray((lab2rgb(blab) * 255 + 0.5).clip(0, 255).astype(np.uint8))

    ok95 = lambda st: min(v["p95"] for v in st.values()) >= P95_AIM   # noqa: E731
    ok50 = lambda st: min(v["p50"] for v in st.values()) >= P50_AIM   # noqa: E731
    img, st = None, {}
    for target, gain, knee in steps:
        img = finish(target, gain, knee)
        st = slot_stats(img)
        if ok95(st):
            break
    rim_px, lit = 0, False
    if not ok95(st):
        for d, lt in ((4, False), (6, False), (8, False), (10, False), (8, True)):
            rim_px, lit = d, lt
            img = finish(target, gain, knee, d, lt)
            st = slot_stats(img)
            if ok95(st):
                break
    lift = 0.0
    for lf in (5.0, 10.0, 15.0):     # a dim ground under a small subject: lift the ground until p50 >= P50_AIM
        if ok50(st):
            break
        lift = lf
        img = finish(target, gain, knee, rim_px, lit, lf)
        st = slot_stats(img)
    info = {"shade": shade, "lit_wall": lit, "rim_px": rim_px, "ground_lift": lift, "subj_L": round(subj_med, 1),
            "subj_C": round(subj_chroma, 1), "zoom": round(1 / side, 2), "box": [round(bw, 2), round(bh, 2)],
            "subject": round(float((g < 0.5).mean()), 2), "subject_raw": round(cov0, 2), "target": target, "slot": st}
    return img, info


P95_AIM = 196
P50_AIM = 64
# per-icon calls the measures cannot make: the Longshade's sweep is an ink beast (a shadow by design) although its
# smoke lifts the subject's median above SHADE_L. "enclosed": dark paint inside the subject's silhouette is never keyed
# as ground; on a Strike ground a keyed soot fuller or a shade between cord wraps came back dark red, a blood read
# (WORLD.md: never gore)
OVERRIDES: dict[str, dict] = {"ability_longshade_shadow_sweep": {"shade": True},
                              "item_lampblack_edge": {"enclosed": True, "fill": 0.82}, "item_shadowpin": {"enclosed": True}}
SHADE_L = 15.0         # a subject this dark (median L*) and this grey (median chroma) is a shadow by design
SHADE_C = 12.0


def slot_stats(img: Image.Image) -> dict:
    """p50 / p95 luma (BT.709 on the 8-bit values) at the 38 and 40 px slot sizes, as _harness/icon_probe.mjs reads them"""
    out = {}
    for S in (38, 40):
        a = np.asarray(img.resize((S, S), Image.LANCZOS)).astype(np.float64)
        lum = np.sort((a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722).ravel())
        out[S] = {"p50": round(float(lum[len(lum) // 2])), "p95": round(float(lum[int(len(lum) * 0.95)]))}
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma list of id prefixes (item_x, ability_ardit_)")
    ap.add_argument("--out-dir", help="write <dir>/{items,abilities}/<name>.webp instead of the content path")
    ap.add_argument("--sheet", help="also write a contact sheet PNG (96 px cells)")
    ap.add_argument("--report", help="write the per-icon zoom/coverage report (JSON)")
    a = ap.parse_args()
    picks = {k: str(v) for k, v in json.loads((HERE / "picks.json").read_text(encoding="utf-8")).items() if not k.startswith("$")}
    recs = records()
    done, rep, cells = 0, {}, []
    for rid, rec in sorted(recs.items()):
        if a.only and not any(rid.startswith(p) for p in a.only.split(",") if p):
            continue
        v = picks.get(rid)
        src = RAW / (f"{rid}__{v}.png" if v and v != "1" else f"{rid}.png")
        if not src.exists():
            rep[rid] = {"skipped": "no raw"}
            continue
        img, info = grade(src, rec["ramp"], OVERRIDES.get(rid))
        info.update({k: rec[k] for k in ("kind", "family", "owner") if k in rec})
        rep[rid] = info
        dst = Path(a.out_dir) / Path(rec["out"]).parent.name / Path(rec["out"]).name if a.out_dir else VALE / rec["out"]
        dst.parent.mkdir(parents=True, exist_ok=True)
        img.save(dst, "WEBP", quality=90, method=6)
        cells.append(img)
        done += 1
    print(f"graded {done} icons")
    if a.report:
        Path(a.report).write_text(json.dumps(rep, indent=1))
    if a.sheet and cells:
        S, cols = 96, 14
        rows = (len(cells) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * S, rows * S), (30, 30, 30))
        for i, c in enumerate(cells):
            sheet.paste(c.resize((S, S), Image.LANCZOS), ((i % cols) * S, (i // cols) * S))
        sheet.save(a.sheet)


if __name__ == "__main__":
    main()
