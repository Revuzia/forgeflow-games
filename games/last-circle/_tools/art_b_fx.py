#!/usr/bin/env python3
"""art_b_fx.py - Last Circle particle textures (dev-only; _tools/ never ships).

Source: Kenney "Light Masks" 1.0, CC0 (F:/games/forgeflow-games-assets/_downloaded/light-masks/Default/*.png,
512 px greyscale masks; License.txt "Creative Commons Zero, CC0").

Output (assets/fx/, white RGB + alpha = mask, peak alpha 1.0 (puff 0.75), power-of-two, <= 64 KB each).
RGB is white at every pixel (including alpha 0), so mip-mapping never darkens an edge; use as additive
(SrcAlpha, One) or normal-alpha sprites, tinted through the material/vertex colour.

  spark.png   128x128  shape_e  - soft 4-point star with a bright core (hit sparks, glints, muzzle star)
  puff.png    256x256  shape_c  - mottled soft cloud (dust puffs, smoke). The source has one dominant off-centre
                       blotch, so its large-scale shading is partly divided out and a round soft window is applied;
                       peak alpha 0.75 (a puff stays translucent)
  glow.png    128x128  shape_a  - soft round glow (muzzle halo, loot glow, flashes)
  tracer.png  256x32   streaks_composed_e cross-section x analytic length ramp. ORIENTATION: u runs ALONG the
                       streak (u=0 tail, alpha 0 -> peak at u~0.86 = the bullet head -> soft cut-off to 0 at
                       u=1), v ACROSS (centre bright, soft edges). Stretch the quad's x along the travel
                       direction and billboard it around that axis.

USAGE   python games/last-circle/_tools/art_b_fx.py [--check]
Exit codes: 0 ok, 1 an assertion failed (size cap, not POT, edge alpha), 2 source missing.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
GAME = HERE.parent
SRC = Path("F:/games/forgeflow-games-assets/_downloaded/light-masks/Default")
OUT = GAME / "assets" / "fx"
CAP = 64 * 1024
PEAK = {"spark": 250, "puff": 185, "glow": 250, "tracer": 250}   # minimum acceptable peak alpha (0-255)


def load_mask(name: str) -> np.ndarray:
    a = np.asarray(Image.open(SRC / f"{name}.png").convert("L")).astype(np.float32) / 255.0
    return a


def resize(a: np.ndarray, w: int, h: int) -> np.ndarray:
    im = Image.fromarray(np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8))
    return np.asarray(im.resize((w, h), Image.LANCZOS)).astype(np.float32) / 255.0


def edge_fade(a: np.ndarray, frac: float = 0.06) -> np.ndarray:
    """Force alpha to exactly 0 on the border with a smooth ramp (the sources already reach ~0.004)."""
    h, w = a.shape
    fy = np.clip(np.minimum(np.arange(h), h - 1 - np.arange(h)) / max(frac * h, 1), 0, 1)
    fx = np.clip(np.minimum(np.arange(w), w - 1 - np.arange(w)) / max(frac * w, 1), 0, 1)
    s = lambda t: t * t * (3 - 2 * t)
    return a * s(fy)[:, None] * s(fx)[None, :]


def to_rgba(alpha: np.ndarray, peak: float = 1.0) -> Image.Image:
    alpha = np.clip(alpha / max(alpha.max(), 1e-6), 0, 1) * peak
    h, w = alpha.shape
    rgba = np.empty((h, w, 4), np.uint8)
    rgba[..., :3] = 255
    rgba[..., 3] = np.clip(alpha * 255 + 0.5, 0, 255).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def make_puff() -> np.ndarray:
    from PIL import ImageFilter
    m = resize(load_mask("shape_c"), 256, 256)
    mn = m / m.max()
    blur = np.asarray(Image.fromarray((mn * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(28))).astype(np.float32) / 255
    det = np.clip(mn / np.maximum(blur, 0.08), 0, 1.5) / 1.5          # shading with the big blotch divided out
    y, x = np.mgrid[0:256, 0:256]
    r = np.hypot(x - 127.5, y - 127.5) / 128
    w = np.clip((1 - r) / 0.6, 0, 1)
    w = w * w * (3 - 2 * w)                                          # soft round window
    return edge_fade(w * (0.10 + 0.65 * (0.3 * mn + 0.7 * det)))


def make_tracer() -> np.ndarray:
    W, H = 256, 32
    m = load_mask("streaks_composed_e")
    row = m[64]                                   # the narrow upper part: a clean soft-edged core
    xs = np.where(row > 0.02)[0]
    lo, hi = xs.min(), xs.max()
    pad = int((hi - lo) * 0.25)
    cross = row[max(lo - pad, 0): hi + pad + 1]
    cross = np.interp(np.linspace(0, len(cross) - 1, H), np.arange(len(cross)), cross)
    cross = cross / cross.max()
    cross[0] = cross[-1] = 0.0
    u = np.linspace(0, 1, W)
    tail = np.clip(u / 0.86, 0, 1) ** 1.6        # tail fades in toward the head
    head = np.clip((1 - u) / 0.14, 0, 1)         # soft cut-off over the last 14 %
    head = head * head * (3 - 2 * head)
    return (tail * head)[None, :] * cross[:, None]


def build() -> dict[str, Image.Image]:
    out = {}
    out["spark"] = to_rgba(edge_fade(resize(load_mask("shape_e"), 128, 128)))
    out["puff"] = to_rgba(make_puff(), 0.75)
    out["glow"] = to_rgba(edge_fade(resize(load_mask("shape_a"), 128, 128)))
    out["tracer"] = to_rgba(make_tracer())
    return out


def pot(n: int) -> bool:
    return n > 0 and (n & (n - 1)) == 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="only verify what is on disk")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    if not args.check:
        if not SRC.exists():
            print(f"MISSING source {SRC}")
            return 2
        for name, im in build().items():
            im.save(OUT / f"{name}.png", optimize=True)
    bad, total = 0, 0
    for name in ["spark", "puff", "glow", "tracer"]:
        p = OUT / f"{name}.png"
        if not p.exists():
            print(f"FAIL {name}: not on disk")
            bad += 1
            continue
        im = Image.open(p)
        a = np.asarray(im.convert("RGBA"))
        size = p.stat().st_size
        total += size
        border = max(a[0, :, 3].max(), a[-1, :, 3].max(), a[:, 0, 3].max(), a[:, -1, 3].max())
        ok = pot(im.size[0]) and pot(im.size[1]) and size <= CAP and border <= 2 and a[..., 3].max() >= PEAK[name] and (a[..., :3] == 255).all()
        bad += 0 if ok else 1
        print(f"{'ok  ' if ok else 'FAIL'} {name:7s} {im.size[0]}x{im.size[1]} {size:6d} B (cap {CAP})  alpha max {a[..., 3].max()}  border alpha max {border}  alpha mean {a[..., 3].mean():.1f}")
    print(f"total {total} B")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
