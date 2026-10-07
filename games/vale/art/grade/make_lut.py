#!/usr/bin/env python3
"""vale_grade_01 — the ONE locked colour grade (STYLE_BIBLE "Grade"; tokens.json grade.lut).

    python3 art/grade/make_lut.py              # write the .cube, verify, write previews + report
    python3 art/grade/make_lut.py --check      # verify the shipped .cube only (exit 1 on failure)
    python3 art/grade/make_lut.py --preview a.png [b.png ...]   # before/after of display images

Input of the LUT = display sRGB AFTER Khronos PBR Neutral (exposure 1.0), exactly the bible's post
order (bloom -> tone map -> LUT -> vignette -> overlay). Output = display sRGB. 33³, .cube, red
fastest. numpy only (art/grade/gradelib.py), so it runs in plain python3 and in Blender's Python.

The grade (bible text -> tokens.json ops, applied in this order on each grid point):
    lift   [-0.004, 0, +0.012]   cool lift (blue raised in the shadows)
    gamma  [1, 1, 0.985]         blue mids a touch lower
    gain   [1.025, 1, 0.975]     warm gain (highlights)
    contrast 1.06 @ 0.42         +6 % S-curve that keeps 0 and 1 fixed (soft toe/shoulder)
    satByLuma                    shadows ×0.85, mids ×1.05, upper mids ×1.0, highlights ×0.92
    hueSat (HSV)                 foliage 75-150° ×0.88; 170-200° ×0.90; world chroma near the team
                                 hues (200-225° azure, 25-50° marigold) ×0.85 ONLY where V < 0.85
    hueShift                     foliage 75-150° −5°
    gamutSoftClip (OKLCH)        chroma knee 0.20 -> max 0.24
  + ACCENT PROTECTION (the bible's "so accents keep their hue", applied to every chroma op, not
    only the two team bands): pixels that are bright AND saturated (V 0.80->0.85, S 0.25->0.40,
    smooth) skip satByLuma / hueSat / hueShift / gamutSoftClip and get only the tone ops. Without
    it, seat Cyan (184°) loses 10 % chroma to the 170-200° band and Violet / Lime are cut by the
    gamut clip (ΔE2000 6-9). tokens.json has no `protect` key yet: LEAD note in the report.

Verification (written to art/out/grade/vale_grade_01.json, hash pinned):
    every relationship hex (Self, Ally, Enemy, Neutral, the CVD variants) and all ten FRAY seat
    colours through the .cube (trilinear AND tetrahedral) at full value (HSV V = 1, how an accent
    reads at its working brightness) must stay within ΔE2000 < 3; the as-is hexes are reported too.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import shutil
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gradelib as G  # noqa: E402

ART = os.path.dirname(HERE)
GAME = os.path.dirname(ART)
TOKENS = os.path.join(GAME, "_design", "tokens.json")
OUT_DIR = os.path.join(ART, "out", "grade")
CUBE = os.path.join(OUT_DIR, "vale_grade_01.cube")
REPORT = os.path.join(OUT_DIR, "vale_grade_01.json")
PREV_DIR = os.path.join(ART, "renders", "grade")
SIZE = 33
DE_MAX = 3.0


def load_tokens() -> dict:
    with open(TOKENS, encoding="utf-8") as f:
        return json.load(f)


def spec_from_tokens(tok: dict) -> dict:
    lut = tok["grade"]["lut"]
    return {"id": lut["id"], "size": lut["size"], "ops": lut["ops"],
            "protect": {"value": [0.80, 0.85], "sat": [0.25, 0.40]}}


def test_colours(tok: dict) -> dict:
    t = tok["team"]
    out = {"self": t["self"], "ally": t["ally"], "enemy": t["enemy"], "neutral": t["neutral"]}
    for cvd, d in t["colorblind"].items():
        for k in ("self", "ally", "enemy"):
            out[f"{k}_{cvd}"] = d[k]
    for s in tok["fray"]:
        out[f"seat_{s['numeral']}_{s['name'].lower()}"] = s["color"]
    return out


def full_value(hexstr: str) -> np.ndarray:
    hsv = G.rgb_to_hsv(G.hex_to_rgb(hexstr))
    hsv[2] = 1.0
    return G.hsv_to_rgb(hsv)


def verify(lut, tok) -> dict:
    res = {}
    worst = 0.0
    for name, hx in test_colours(tok).items():
        row = {"hex": hx}
        for label, rgb in (("full_value", full_value(hx)), ("as_is", G.hex_to_rgb(hx))):
            lab0 = G.rgb_to_lab(rgb)
            for m in ("trilinear", "tetrahedral"):
                o = G.apply_lut(rgb[None, None, :], lut, m)[0, 0]
                de = float(G.delta_e2000(lab0, G.rgb_to_lab(o)))
                row[f"{label}_{m}"] = round(de, 2)
                if label == "full_value":
                    worst = max(worst, de)
            row[f"{label}_out"] = G.rgb_to_hex(G.apply_lut(rgb[None, None, :], lut, "tetrahedral")[0, 0])
        row["pass"] = max(row["full_value_trilinear"], row["full_value_tetrahedral"]) < DE_MAX
        res[name] = row
    return {"colours": res, "worst_full_value": round(worst, 2), "pass": worst < DE_MAX}


# ── previews ─────────────────────────────────────────────────────────────────────────────────────
def _label(path: str, items) -> None:
    ff = shutil.which("ffmpeg")
    if not ff or not items:
        return
    def esc(t):
        return t.replace("\\", "\\\\").replace(":", "\\:").replace("'", "’")
    chain = ",".join(f"drawtext=text='{esc(t)}':x={x}:y={y}:fontsize={fs}:fontcolor={c}"
                     for x, y, t, fs, c in items)
    tmp = path + ".lb.png"
    r = subprocess.run([ff, "-y", "-loglevel", "error", "-i", path, "-vf", chain, tmp], capture_output=True)
    if r.returncode == 0 and os.path.isfile(tmp):
        os.replace(tmp, path)


def chart(tok) -> tuple:
    """Swatch chart: relationship + seat colours, world references, foliage, sky, grey ramp, and
    a Neutral-tonemapped HDR ramp of each world colour (shadow -> sun)."""
    sw = []
    t = tok["team"]
    sw.append(("relationship", [t["self"], t["ally"], t["enemy"], t["neutral"],
                                t["colorblind"]["tritan"]["enemy"], t["colorblind"]["deutan"]["enemy"]]))
    sw.append(("fray seats", [s["color"] for s in tok["fray"]]))
    terr = tok["colors"]["terrain-ref"]
    sw.append(("world refs", list(terr.values()) + ["#B8C6D9", "#D9C2A0", "#BFD3E6", "#C9A46A"]))
    sw.append(("foliage", ["#2F4A2A", "#4E6B3A", "#6E8A45", "#3E5E4E", "#85A35A", "#5A7A3C", "#A3B86C", "#24402F"]))
    sw.append(("sky / water", ["#7FA7D6", "#5B86C2", "#9DBBE0", "#3D6FA8", "#5F6E73", "#6E9FB8", "#8AB4C9", "#2E4F7A"]))
    sw.append(("warm world", ["#8A6248", "#B07A45", "#C9945A", "#6B4A33", "#D9A86A", "#9C5E3A", "#E0B880", "#5A3A28"]))
    sw.append(("grey ramp", [G.rgb_to_hex([v, v, v]) for v in np.linspace(0.04, 0.96, 10)]))
    cell, pad, lab_h = 64, 6, 22
    cols = max(len(c) for _, c in sw)
    W = pad + cols * (cell + pad)
    H = len(sw) * (cell + pad + lab_h) + pad
    img = np.zeros((H, W, 3)) + G.hex_to_rgb("#171B22")
    labels = []
    y = pad
    for name, cs in sw:
        labels.append((pad, y + 2, name, 14, "white"))
        y += lab_h
        for i, hx in enumerate(cs):
            x = pad + i * (cell + pad)
            img[y:y + cell, x:x + cell] = G.hex_to_rgb(hx)
        y += cell + pad
    # HDR ramp strip: each world ref lit from 0.1x to 4x through Neutral (what the LUT really sees)
    refs = list(terr.values()) + ["#4E6B3A", "#7FA7D6", "#C9945A"]
    ramp_h = 26
    strip = np.zeros((len(refs) * ramp_h, W, 3))
    xs = np.linspace(-3.3, 2.0, W)
    for i, hx in enumerate(refs):
        lin = G.srgb_decode(G.hex_to_rgb(hx))[None, :] * (2.0 ** xs)[:, None]
        strip[i * ramp_h:(i + 1) * ramp_h - 2] = G.display(lin)[None, :, :]
    img = np.concatenate([img, strip], 0)
    return img, labels


def before_after(img, lut, labels=(), title_a="before (Neutral)", title_b="after (vale_grade_01)") -> tuple:
    a = img[..., :3]
    b = G.apply_lut(a, lut, "tetrahedral")
    gap = np.zeros((a.shape[0], 8, 3)) + 0.04
    out = np.concatenate([a, gap, b], 1)
    w = a.shape[1] + 8
    lab = list(labels) + [(x + w, y, t, fs, c) for x, y, t, fs, c in labels]
    head = np.zeros((26, out.shape[1], 3)) + 0.06
    out = np.concatenate([head, out], 0)
    lab = [(x, y + 26, t, fs, c) for x, y, t, fs, c in lab]
    lab += [(8, 5, title_a, 15, "white"), (w + 8, 5, title_b, 15, "white")]
    return out, lab


def main(argv) -> int:
    tok = load_tokens()
    if "--check" in argv:
        lut = G.read_cube(CUBE)
        v = verify(lut, tok)
        for k, r in v["colours"].items():
            print(f"{k:24s} {r['hex']}  ΔE full {r['full_value_tetrahedral']:.2f}  as-is {r['as_is_tetrahedral']:.2f}  "
                  f"{'ok' if r['pass'] else 'FAIL'}")
        print("PASS" if v["pass"] else "FAIL", v["worst_full_value"])
        return 0 if v["pass"] else 1
    if "--preview" in argv:
        lut = G.read_cube(CUBE)
        os.makedirs(PREV_DIR, exist_ok=True)
        for p in [a for a in argv if not a.startswith("--")]:
            img = G.load_png(p)
            out, lab = before_after(img, lut)
            dst = os.path.join(PREV_DIR, "ba_" + os.path.basename(p))
            G.save_png(dst, out)
            _label(dst, lab)
            print("wrote", os.path.relpath(dst, GAME))
        return 0
    spec = spec_from_tokens(tok)
    lut = G.make_lut(spec, SIZE)
    os.makedirs(OUT_DIR, exist_ok=True)
    G.write_cube(CUBE, lut, "vale_grade_01", comments=[
        "VALE locked grade vale_grade_01 (art/grade/make_lut.py; STYLE_BIBLE Grade; tokens.json grade.lut)",
        "input: Khronos PBR Neutral tone-mapped display sRGB (exposure 1.0); output: display sRGB",
        "33^3, red fastest; change needs art-director sign-off + readability re-test"])
    with open(CUBE, "rb") as f:
        sha = hashlib.sha256(f.read()).hexdigest()
    lut_file = G.read_cube(CUBE)             # verify what ships (6-decimal text), not the float array
    v = verify(lut_file, tok)
    # analytic vs file (interpolation error of 33³ over the whole cube, random sample)
    rng = np.random.default_rng(1)
    pts = rng.random((20000, 3))
    an = G.grade_fn(pts, spec)
    de_interp = G.delta_e2000(G.rgb_to_lab(an), G.rgb_to_lab(G.apply_lut(pts, lut_file, "tetrahedral")))
    # identity distance (how strong the grade is) on the same sample
    de_grade = G.delta_e2000(G.rgb_to_lab(pts), G.rgb_to_lab(an))
    os.makedirs(PREV_DIR, exist_ok=True)
    img, lab = chart(tok)
    out, lab2 = before_after(img, lut_file, lab)
    chart_path = os.path.join(PREV_DIR, "vale_grade_01_chart.png")
    G.save_png(chart_path, out)
    _label(chart_path, lab2)
    report = {
        "id": "vale_grade_01", "file": os.path.relpath(CUBE, GAME).replace("\\", "/"), "size": SIZE,
        "sha256": sha, "bytes": os.path.getsize(CUBE),
        "input": "Khronos PBR Neutral tone-mapped display sRGB (exposure 1.0)", "spec": spec,
        "verify": v,
        "interp_de2000_tetra_vs_analytic": {"mean": round(float(de_interp.mean()), 3),
                                            "p99": round(float(np.percentile(de_interp, 99)), 3),
                                            "max": round(float(de_interp.max()), 3)},
        "grade_strength_de2000": {"mean": round(float(de_grade.mean()), 2),
                                  "p95": round(float(np.percentile(de_grade, 95)), 2)},
        "previews": [os.path.relpath(chart_path, GAME).replace("\\", "/")],
    }
    with open(REPORT, "w", encoding="utf-8", newline="\n") as f:
        json.dump(report, f, indent=2)
        f.write("\n")
    print(f"vale_grade_01.cube sha256 {sha[:16]}…  {report['bytes']} bytes")
    for k, r in v["colours"].items():
        print(f"  {k:24s} {r['hex']}  ΔE2000 full-value {max(r['full_value_trilinear'], r['full_value_tetrahedral']):.2f}"
              f"  as-is {max(r['as_is_trilinear'], r['as_is_tetrahedral']):.2f}  -> {r['as_is_out']}  {'ok' if r['pass'] else 'FAIL'}")
    print(f"  worst full-value ΔE2000 {v['worst_full_value']}  {'PASS' if v['pass'] else 'FAIL'}")
    print(f"  interpolation ΔE (tetra vs analytic) {report['interp_de2000_tetra_vs_analytic']}")
    print(f"  grade strength ΔE {report['grade_strength_de2000']}")
    return 0 if v["pass"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
