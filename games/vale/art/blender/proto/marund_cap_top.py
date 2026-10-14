#!/usr/bin/env python3
"""ART 2.0 proof: the TOP PLATE for Marund's dome-cap (the game camera's first read at 52 degrees).

    python3 art/blender/proto/marund_cap_top.py        # needs the repo venv (numpy, Pillow, scipy)

A front/back projection streaks on near-flat tops (every point along the view axis takes the same
painted row). The top plate re-samples the same paintings at each point's height ON THE DOME
PROFILE (the flat crown and the rim's top annulus take the rows of the dome and rim bands), so the
painted stone wraps around the crown in rings, then adds painted cracks, value noise and the key
light from front-left. Output: art/.cache/concept/marund_captop.png covering X, Y in [-0.7, 0.7] m
(image up = +Y = the back of the cap). Dome constants match marund_v2.py `cap_prof`.
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
HEIGHT = 2.35
N = 1024
EXT = 0.7
DOME_R, DOME_Z0, DOME_H, CROWN_Z = 0.55, 2.0, 0.345, 2.315
RIM_R = 0.64


def main() -> None:
    meta = json.loads((CACHE / "marund_plates.json").read_text())
    plates = {s: np.asarray(Image.open(CACHE / f"marund_{s}.png").convert("RGB")).astype(np.float32) for s in ("front", "back")}
    H, W = plates["front"].shape[:2]
    i, j = np.mgrid[0:N, 0:N]
    X = (j + 0.5) / N * 2 * EXT - EXT
    Y = (1 - (i + 0.5) / N) * 2 * EXT - EXT
    r = np.hypot(X, Y)
    # the height whose painted row this point takes
    rd = np.minimum(r, DOME_R)
    zd = DOME_Z0 + DOME_H * np.sqrt(np.clip(1 - (rd / DOME_R) ** 2, 0, 1))
    z = np.where(r <= DOME_R, np.minimum(zd, CROWN_Z + 0.012), 2.0 - (r - DOME_R) / (RIM_R - DOME_R) * 0.05)
    out = np.zeros((N, N, 3), np.float32)
    wsum = np.zeros((N, N, 1), np.float32)
    for side, sign, w in (("front", 1.0, np.clip(0.5 - Y / 0.2, 0, 1)), ("back", -1.0, np.clip(0.5 + Y / 0.2, 0, 1))):
        info = meta[side]
        s = HEIGHT / (info["ground"] - info["top"])
        px = info["cx"] + sign * X / s
        py = info["ground"] - z / s
        col = np.stack([nd.map_coordinates(plates[side][..., c], [py, px], order=1, mode="nearest") for c in range(3)], -1)
        out += col * w[..., None]
        wsum += w[..., None]
    out /= np.maximum(wsum, 1e-6)
    # painterly settle: a median then a light blur kills ring aliasing from the narrow crown band
    out = np.stack([nd.gaussian_filter(nd.median_filter(out[..., c], 7), 1.2) for c in range(3)], -1)
    # value noise + the key light from front-left (the concept's light)
    rng = np.random.default_rng(11)
    n = nd.gaussian_filter(rng.standard_normal((N, N)), 18)
    n = n / (np.abs(n).max() + 1e-6)
    lightdir = np.array([-0.6, -0.8]) / 1.0
    lit = 1.0 + 0.07 * np.clip((X * lightdir[0] + Y * lightdir[1]) / 0.6, -1, 1) + 0.05 * n
    # the crown: the dome's own stone (median of the dome band) in painted blotches, blended in from
    # r 0.36 inward (the painting has no crown to sample: only the outline glow is up there)
    band = (r > 0.36) & (r < 0.5)
    stone = np.median(out[band], axis=0)
    blot = nd.gaussian_filter(rng.standard_normal((N, N)), 9)
    blot = np.round(blot / (np.abs(blot).max() + 1e-6) * 3) / 3          # posterised: brush patches
    crown_col = stone[None, None, :] * (1.0 + 0.06 * blot[..., None])
    wc = np.clip((0.40 - r) / 0.10, 0, 1)[..., None]
    out = out * (1 - wc) + crown_col * wc
    crown = r < 0.30
    out *= lit[..., None]
    img = Image.fromarray(out.clip(0, 255).astype(np.uint8))
    # painted cracks on the crown and dome: dark stroke + a pale catch-light offset toward the light
    d = ImageDraw.Draw(img)
    to_px = lambda x, y: ((x + EXT) / (2 * EXT) * N, (1 - (y + EXT) / (2 * EXT)) * N)
    for k in range(6):
        a = rng.uniform(0, 2 * math.pi)
        rr = rng.uniform(0.05, 0.45)
        x, y = rr * math.cos(a), rr * math.sin(a)
        heading = rng.uniform(0, 2 * math.pi)
        pts = [(x, y)]
        for _ in range(rng.integers(4, 8)):
            heading += rng.normal(0, 0.6)
            step = rng.uniform(0.035, 0.07)
            x, y = x + step * math.cos(heading), y + step * math.sin(heading)
            if math.hypot(x, y) > 0.53:
                break
            pts.append((x, y))
        if len(pts) < 2:
            continue
        P = [to_px(*p) for p in pts]
        d.line([(u + 3, v + 3) for u, v in P], fill=(246, 242, 232), width=3, joint="curve")
        d.line(P, fill=(104, 98, 92), width=5, joint="curve")
    img = np.asarray(img).astype(np.float32)
    img = np.stack([nd.gaussian_filter(img[..., c], 0.7) for c in range(3)], -1)
    Image.fromarray(img.clip(0, 255).astype(np.uint8)).save(CACHE / "marund_captop.png")
    print("wrote", CACHE / "marund_captop.png", "crown px", int(crown.sum()))


if __name__ == "__main__":
    main()
