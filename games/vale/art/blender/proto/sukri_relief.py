#!/usr/bin/env python3
"""Sukri's painted relief: the concept's own brushwork turned into a small displacement, so the sculpted wraps,
folds and grain line up with the projected paint (a procedural wrap ridge would cross the painted band edges).

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/sukri_relief.py

From each plate (front, back): luminance high-passed (the painted light on each band: + bulge) and the painted
dark lines (the band edges, the cracks between folds: - groove), in metres, on a world (x, z) grid at 4 mm.
Writes art/.cache/concept/sukri_relief.npz {front, back, x0, z0, m}: a map row j, column i is world
x = x0 + i * m, z = z0 - j * m (front: as seen from the front; back: world x, not mirrored).
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as nd

HERE = Path(__file__).resolve().parent
ART = HERE.parent.parent
CACHE = ART / ".cache" / "concept"
ID = "sukri"
M = 0.004                       # grid step (m)
X0, X1, Z0, Z1 = -0.90, 0.90, 1.70, 0.00
BULGE = 0.0035                  # m of displacement per unit of the high-passed light
GROOVE = 0.0045                 # m deep at the darkest painted line


def main() -> None:
    meta = json.loads((CACHE / f"{ID}_plates.json").read_text())
    mask = np.asarray(Image.open(CACHE / f"{ID}_mask.png")) > 127
    out = {}
    xs = np.arange(X0, X1 + 1e-9, M)
    zs = np.arange(Z0, Z1 - 1e-9, -M)
    X, Z = np.meshgrid(xs, zs)
    for side in ("front", "back"):
        im = np.asarray(Image.open(CACHE / f"{ID}_{side}.png").convert("RGB")).astype(np.float32) / 255.0
        lum = im @ np.array([0.2126, 0.7152, 0.0722], np.float32)
        info = meta[side]
        k = (info["ground"] - info["top"]) / meta["height"]
        sign = 1.0 if side == "front" else -1.0
        px = info["cx"] + sign * X * k
        py = info["ground"] - Z * k
        L = nd.map_coordinates(lum, [py, px], order=1, mode="nearest")
        inside = nd.map_coordinates(mask.astype(np.float32), [py, px], order=1, mode="constant") > 0.5
        # high-pass of the painted light (bands lit on top, shaded under): a soft bulge
        lo = nd.gaussian_filter(L, 9.0)
        hp = np.clip(L - lo, -0.15, 0.15) / 0.15
        # the painted dark lines (local minima darker than their surroundings by > 0.06): grooves
        ring = nd.gaussian_filter(L, 4.0)
        line = np.clip((ring - L - 0.03) / 0.10, 0.0, 1.0)
        line = nd.gaussian_filter(line, 0.8)
        r = BULGE * nd.gaussian_filter(hp, 1.2) - GROOVE * line
        r[~inside] = 0.0
        r = nd.gaussian_filter(r, 0.6)
        out[side] = r.astype(np.float32)
        print(side, f"relief {r.min() * 1000:.1f}..{r.max() * 1000:.1f} mm, lines {100 * float((line > 0.5).mean()):.1f} %")
    np.savez_compressed(CACHE / f"{ID}_relief.npz", front=out["front"], back=out["back"], x0=X0, z0=Z0, m=M)
    print("wrote", CACHE / f"{ID}_relief.npz")


if __name__ == "__main__":
    main()
