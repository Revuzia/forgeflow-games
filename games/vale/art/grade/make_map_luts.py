#!/usr/bin/env python3
"""Per-map grades (max env ENV-8): vale_grade_01 plus one light mood per map, so RIFT, BRIDGE and FRAY each carry their
own hour (tokens.json grade.maps.*.mood) instead of one shared afternoon.

    python3 art/grade/make_map_luts.py            # write art/out/grade/vale_grade_<map>.cube + .json, verify, chart
    python3 art/grade/make_map_luts.py --check    # verify the shipped per-map cubes only

Each map grade = the locked vale_grade_01 ops (tokens.json grade.lut.ops, accent protection included) followed by the
map's own ops below. The map ops are chroma moves only (a luma-preserving split tone, a hue-band saturation): they never
move a pixel's value, so the r12 B5 ground law (value_probe.mjs) holds by construction, and the accent protection keeps
every relationship and seat colour inside the same dE2000 < 3 gate vale_grade_01 passes (make_lut.verify).

    RIFT   Hourfall, the Split Hour (stalled afternoon): cool green-teal under the canopy (shadows), warm lane light
           (highlights); foliage a touch quieter so the lanes lead.
    BRIDGE Needlespan, the Long Light (low warm evening): amber highlights, lifted sky-blue shadow bounce off the gorge.
    FRAY   Noonplate, the Shadowless Noon (festival): warm cream highlights with a violet shadow tint, so the plate reads
           as the bright festival floor of the three.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gradelib as G  # noqa: E402
import make_lut as L  # noqa: E402

MAP_OPS = {
    "rift": [
        {"op": "splitTone", "shadow": [-0.018, 0.016, 0.018], "highlight": [0.026, 0.006, -0.030], "pivot": 0.34, "width": 0.22},
        {"op": "hueSat", "space": "HSV", "featherDeg": 10, "bands": [{"hue": [70, 150], "sat": 0.94, "onlyIfValueBelow": 0.85}]},
    ],
    "bridge": [
        {"op": "splitTone", "shadow": [-0.020, 0.002, 0.032], "highlight": [0.040, 0.010, -0.042], "pivot": 0.36, "width": 0.24},
        {"op": "hueSat", "space": "HSV", "featherDeg": 10, "bands": [{"hue": [20, 45], "sat": 1.05, "onlyIfValueBelow": 0.85}]},
    ],
    "fray": [
        {"op": "splitTone", "shadow": [0.016, -0.016, 0.026], "highlight": [0.030, 0.012, -0.020], "pivot": 0.38, "width": 0.24},
        {"op": "hueSat", "space": "HSV", "featherDeg": 10, "bands": [{"hue": [30, 60], "sat": 1.04, "onlyIfValueBelow": 0.85}]},
    ],
}


def cube_path(m: str) -> str:
    return os.path.join(L.OUT_DIR, f"vale_grade_{m}.cube")


def main(argv) -> int:
    tok = L.load_tokens()
    base = L.spec_from_tokens(tok)
    ok = True
    for m, ops in MAP_OPS.items():
        path = cube_path(m)
        spec = {**base, "id": f"vale_grade_{m}", "ops": list(base["ops"]) + ops}
        if "--check" not in argv:
            lut = G.make_lut(spec, L.SIZE)
            G.write_cube(path, lut, f"vale_grade_{m}", comments=[
                f"VALE per-map grade vale_grade_{m} (art/grade/make_map_luts.py): vale_grade_01 + the map's light mood",
                "input: Khronos PBR Neutral tone-mapped display sRGB (exposure 1.0); output: display sRGB", "33^3, red fastest"])
        lf = G.read_cube(path)
        v = L.verify(lf, tok)
        rng = np.random.default_rng(1)
        pts = rng.random((20000, 3))
        b01 = G.apply_lut(pts, G.read_cube(L.CUBE), "tetrahedral")
        me = G.apply_lut(pts, lf, "tetrahedral")
        dl = np.abs(G.lstar(me) - G.lstar(b01))
        de = G.delta_e2000(G.rgb_to_lab(b01), G.rgb_to_lab(me))
        with open(path, "rb") as f:
            sha = hashlib.sha256(f.read()).hexdigest()
        rep = {"id": f"vale_grade_{m}", "file": os.path.relpath(path, L.GAME), "sha256": sha, "bytes": os.path.getsize(path),
               "base": "vale_grade_01", "mapOps": ops, "verify": v,
               "vs_vale_grade_01": {"dE2000_mean": round(float(de.mean()), 2), "dE2000_p95": round(float(np.percentile(de, 95)), 2),
                                    "dLstar_mean": round(float(dl.mean()), 3), "dLstar_p99": round(float(np.percentile(dl, 99)), 3)}}
        if "--check" not in argv:
            with open(path.replace(".cube", ".json"), "w", encoding="utf-8", newline="\n") as f:
                json.dump(rep, f, indent=2)
                f.write("\n")
            img, lab = L.chart(tok)
            out, lab2 = L.before_after(img, lf, lab, title_b=f"after (vale_grade_{m})")
            os.makedirs(L.PREV_DIR, exist_ok=True)
            cp = os.path.join(L.PREV_DIR, f"vale_grade_{m}_chart.png")
            G.save_png(cp, out)
            L._label(cp, lab2)
        print(f"{m:7s} worst accent dE {v['worst_full_value']:.2f} {'PASS' if v['pass'] else 'FAIL'}  vs 01: {rep['vs_vale_grade_01']}")
        ok = ok and v["pass"]
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
