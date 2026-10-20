#!/usr/bin/env python3
"""ART 2.0: Ervet's TOP PLATE (the game camera's first read at 52 degrees is the mantle from above).

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/ervet_tops.py     # after ervet_plates.py

A front/back projection streaks on the near-flat pauldron tops (every point along Y takes the same painted
row: the gold trim line). The top plate paints them as the concept's own materials seen from above: the
honed stone of the pauldron plates (the back view's stone, its median and value range) in posterised brush
patches, carved lines echoing the back view's engraved bands, the ochre trim bead on the rim, the key light
from front-left. Output: art/.cache/concept/ervet_top.png covering X, Y in [-0.5, 0.5] m (image up = +Y =
the back). The pauldron outline matches fighters/ervet.py PAULDRON_OUTLINE.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as nd

HERE = Path(__file__).resolve().parent
ART = HERE.parent.parent
CACHE = ART / ".cache" / "concept"
HEIGHT = 2.15
N = 1024
EXT = 0.5
# the pauldron plates from above (her left; mirrored): fighters/ervet.py PAULDRON_OUTLINE
OUTLINE = [(0.10, -0.17), (0.24, -0.205), (0.36, -0.15), (0.425, -0.02), (0.39, 0.12), (0.30, 0.22), (0.15, 0.235),
           (0.08, 0.12)]


def sample(plate, meta, side, x, z):
    i = meta[side]
    k = (i["ground"] - i["top"]) / HEIGHT
    sg = 1.0 if side == "front" else -1.0
    px = i["cx"] + sg * x * k
    py = i["ground"] - z * k
    return np.stack([nd.map_coordinates(plate[..., c], [py, px], order=1, mode="nearest") for c in range(3)], -1)


def main() -> None:
    meta = json.loads((CACHE / "ervet_plates.json").read_text())
    plate = np.asarray(Image.open(CACHE / "ervet_front.png").convert("RGB")).astype(np.float32)
    i, j = np.mgrid[0:N, 0:N]
    X = (j + 0.5) / N * 2 * EXT - EXT
    Y = (1 - (i + 0.5) / N) * 2 * EXT - EXT
    # the stone: the back view's pauldron plates (both sides, z 1.735-1.80, |x| 0.17-0.36)
    xs = np.concatenate([np.linspace(0.17, 0.36, 40), -np.linspace(0.17, 0.36, 40)])
    zs = np.linspace(1.735, 1.80, 12)
    XX, ZZ = np.meshgrid(xs, zs)
    stone = sample(plate, meta, "back", XX.ravel(), ZZ.ravel())
    lum = stone.mean(1)
    keep = (lum > np.percentile(lum, 25)) & (lum < np.percentile(lum, 92))
    base = np.percentile(stone[keep], 85, axis=0) * 1.04
    dark = np.percentile(stone, 12, axis=0)
    # the trim: the front view's ochre rim on the pauldron edge (warm, saturated pixels near z 1.79-1.83)
    xs2 = np.concatenate([np.linspace(0.2, 0.38, 50), -np.linspace(0.2, 0.38, 50)])
    zs2 = np.linspace(1.78, 1.835, 14)
    XX, ZZ = np.meshgrid(xs2, zs2)
    tr = sample(plate, meta, "front", XX.ravel(), ZZ.ravel())
    warm = tr[(tr[:, 0] - tr[:, 2] > 40) & (tr.max(1) > 120)]
    trim = np.median(warm, axis=0) if len(warm) > 20 else np.array([190, 150, 80], np.float32)
    trim = trim * 0.75 + base * 0.25                                  # a matte ochre bead, not gold
    rng = np.random.default_rng(23)
    blot = nd.gaussian_filter(rng.standard_normal((N, N)), 10)
    blot = np.round(blot / (np.abs(blot).max() + 1e-6) * 3) / 3
    fine = nd.gaussian_filter(rng.standard_normal((N, N)), 2.5)
    fine /= np.abs(fine).max() + 1e-6
    out = np.ones((N, N, 3), np.float32) * base
    out *= (1.0 + 0.07 * blot[..., None] + 0.03 * fine[..., None])
    to_px = lambda x, y: ((x + EXT) / (2 * EXT) * N, (1 - (y + EXT) / (2 * EXT)) * N)  # noqa: E731
    m_per_px = 2 * EXT / N
    for sx in (-1, 1):
        poly = [to_px(sx * x, y) for x, y in OUTLINE]
        mk = Image.new("L", (N, N), 0)
        ImageDraw.Draw(mk).polygon(poly, fill=255)
        inside = np.asarray(mk) > 0
        dist = nd.distance_transform_edt(inside) * m_per_px            # metres to the plate's edge
        # carved bands (the back view's engraved lines) at fixed distances from the edge, broken into strokes
        for dd in (0.05, 0.095):
            band = inside & (np.abs(dist - dd) < 0.0045)
            gaps = nd.gaussian_filter(rng.standard_normal((N, N)), 14) > -0.35
            band &= gaps
            hi = np.roll(np.roll(band, 2, 0), 2, 1) & ~band
            out[hi] = out[hi] * 0.6 + np.array([236, 234, 226]) * 0.4
            out[band] = out[band] * 0.35 + dark * 0.65
        # the trim bead on the rim, a soft shadow just inside it
        trim_w = np.clip((0.013 - dist) / 0.004, 0, 1) * inside
        out = out * (1 - trim_w[..., None]) + trim[None, None, :] * (1.0 + 0.06 * fine[..., None]) * trim_w[..., None]
        shade = np.clip(1 - np.abs(dist - 0.02) / 0.01, 0, 1) * inside
        out *= (1.0 - 0.10 * shade)[..., None]
        # outside the outline (the bead's outer half): trim colour too
        ring = (~inside) & (nd.distance_transform_edt(~inside) * m_per_px < 0.012)
        out[ring] = trim
    lit = 1.0 + 0.08 * np.clip((-X * 0.6 - Y * 0.8) / 0.5, -1, 1)
    out *= lit[..., None]
    out = np.stack([nd.gaussian_filter(out[..., c], 0.8) for c in range(3)], -1)
    Image.fromarray(out.clip(0, 255).astype(np.uint8)).save(CACHE / "ervet_top.png")
    print("wrote", CACHE / "ervet_top.png", "stone", base.round(), "trim", trim.round())


if __name__ == "__main__":
    main()
