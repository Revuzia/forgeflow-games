#!/usr/bin/env python3
"""Dunsom's carved mask, read from the painting: the outline, the tile cracks and the eye recesses.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/dunsom_relief.py

The concept paints the mask as golden-ochre carved tiles (irregular hexagons) split by dark cracks, two almond eye
recesses and a beak keel. The sculpt (art/blender/fighters/dunsom.py, the `mask` part) carves THE PAINTED cracks
(so the baked normals and the projected paint line up exactly) and takes the painted outline as its face outline.
Writes art/.cache/concept/dunsom_face.npz in world metres (front plate frame, x his left, z up):
  sd      signed distance to the painted mask outline (m, < 0 inside), smoothed
  crack   0..1 crack strength (dark lines inside the ochre), slightly widened
  tile    0..1 distance to the nearest crack, normalised (0 on a crack -> 1 at ~1.2 cm): the tiles' pillowing
  eye     0..1 the almond eye recesses (dark, enclosed by the mask)
  x0 z0 m frame: world x of column 0, world z of row 0 (rows go DOWN), metres per pixel
and a debug image art/renders/fighters/dunsom/_fit/face_relief.png.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as nd

HERE = Path(__file__).resolve().parent
ART = HERE.parent.parent
GAME = ART.parent
X_LO, X_HI, Z_LO, Z_HI = -0.17, 0.15, 1.62, 2.00


def main() -> None:
    meta = json.loads((ART / ".cache" / "concept" / "dunsom_plates.json").read_text())
    info = meta["front"]
    k = (info["ground"] - info["top"]) / meta["height"]
    im = np.asarray(Image.open(GAME / "_design" / "concept" / "dunsom.webp").convert("RGB")).astype(np.float32) / 255
    c0, c1 = int(info["cx"] + X_LO * k), int(info["cx"] + X_HI * k)
    r0, r1 = int(info["ground"] - Z_HI * k), int(info["ground"] - Z_LO * k)
    c = im[r0:r1, c0:c1]
    L = c.mean(2)
    mx, mn = c.max(2), c.min(2)
    sat = (mx - mn) / np.maximum(mx, 1e-3)
    ochre = (sat > 0.45) & (c[..., 0] > c[..., 1]) & (c[..., 1] > c[..., 2]) & (mx > 0.25)
    ochre = nd.binary_closing(nd.binary_fill_holes(nd.binary_closing(ochre, iterations=3)), iterations=2)
    lbl, n = nd.label(ochre)
    sizes = nd.sum(ochre, lbl, range(1, n + 1))
    face = lbl == (int(np.argmax(sizes)) + 1)
    face = nd.binary_fill_holes(nd.binary_opening(face, iterations=2))
    # the scarf covers the chin: the outline below the scarf line is continued straight down (the sculpt hides it)
    sm = nd.gaussian_filter(face.astype(np.float32), 2.0) > 0.5
    sd = (nd.distance_transform_edt(~sm) - nd.distance_transform_edt(sm)) / k
    loc = nd.gaussian_filter(L, 6)
    crack = np.clip((loc - L - 0.02) / 0.10, 0, 1) * nd.binary_erosion(sm, iterations=3)
    # eyes: the dark almonds inside the face (much darker than the tiles round them)
    zz = (info["ground"] - (r0 + np.arange(c.shape[0]))) / k
    band = ((zz > 1.795) & (zz < 1.875))[:, None]
    dark = (L < 0.30) & (sat < 0.55) & nd.binary_erosion(sm, iterations=4) & band
    lbl, n = nd.label(nd.binary_opening(dark, iterations=1))
    eye = np.zeros_like(dark)
    if n:
        sizes = nd.sum(dark, lbl, range(1, n + 1))
        for j in np.argsort(sizes)[::-1][:2]:
            eye |= lbl == j + 1
    eye_s = np.clip(nd.gaussian_filter(nd.binary_dilation(eye, iterations=1).astype(np.float32), 1.2) * 1.4, 0, 1)
    crack = crack * (1 - eye_s)
    crack = np.clip(nd.gaussian_filter(np.maximum(crack, nd.grey_dilation(crack, size=2) * 0.8), 0.7) * 1.25, 0, 1)
    tile = np.clip(nd.distance_transform_edt(crack < 0.35) / (0.012 * k), 0, 1)
    out = ART / ".cache" / "concept" / "dunsom_face.npz"
    x0 = (c0 - info["cx"]) / k
    z0 = (info["ground"] - r0) / k
    np.savez_compressed(out, sd=sd.astype(np.float32), crack=crack.astype(np.float32), tile=tile.astype(np.float32),
                        eye=eye_s.astype(np.float32), x0=np.float32(x0), z0=np.float32(z0), m=np.float32(1.0 / k))
    ys, xs = np.nonzero(sm)
    print(f"mask outline x {x0 + xs.min() / k:+.3f}..{x0 + xs.max() / k:+.3f}  z {z0 - ys.max() / k:.3f}..{z0 - ys.min() / k:.3f}")
    ys, xs = np.nonzero(eye)
    if len(xs):
        for side in (xs < xs.mean(), xs >= xs.mean()):
            print(f"eye x {x0 + xs[side].min() / k:+.3f}..{x0 + xs[side].max() / k:+.3f}  "
                  f"z {z0 - ys[side].max() / k:.3f}..{z0 - ys[side].min() / k:.3f}")
    dbg = np.concatenate([c, np.stack([sm * 0.5 + eye_s * 0.5] * 3, -1), np.stack([crack] * 3, -1), np.stack([tile] * 3, -1)], 1)
    d = ART / "renders" / "fighters" / "dunsom" / "_fit"
    d.mkdir(parents=True, exist_ok=True)
    Image.fromarray((dbg.clip(0, 1) * 255).astype(np.uint8)).resize((dbg.shape[1] * 2, dbg.shape[0] * 2)).save(d / "face_relief.png")
    print("wrote", out)


if __name__ == "__main__":
    main()
