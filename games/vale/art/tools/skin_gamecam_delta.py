#!/usr/bin/env python3
"""How far each skin reads from its base at the GAME camera: row 1 of the three_snapshot sheets
(art/renders/fighters/<id>/three_<sid>.png: 8 facings at the gameplay camera, 1080p pixel scale, idle pose).

    python3 art/tools/skin_gamecam_delta.py burdam [--skins burdam_stillwater,burdam_almanac]

Per skin vs base, over the figure pixels (not the flat backdrop or the cast shadow) of the 8 cells: the mean CIE76 dE of the per-pixel
Lab difference inside the union mask, and the dE of the figure's mean colour. Closing CW5 gate (burdam-M4): the deluxe
skin's dE >= the standard skin's.

SHEET SETUP (closing CW5 minor:stored-sheet-render-setup, traced): a sheet's light depends on how it was made. A build's three
QA passes --sky art/out/maps/<first>/sky.hdr (backdrop 193,191,186); a direct three_snapshot run without --sky uses its
default environment (198,192,181). The gate setup is the direct run without --sky (part_gamecam's pairs and the verifiers' fresh
sheets; every stored roster sheet of the CW5 eight was re-rendered that way on 2026-11-06). Numbers compare only between sheets of
one setup, so each line prints its sheet's backdrop and this tool warns when a skin's differs from its base's: a rebuild's three QA
writes a --sky sheet, so re-render the fighter's sheets with `node art/tools/three_snapshot.mjs <glb> <png>` after a build.
"""
import argparse
import glob
import os

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(os.path.dirname(HERE))


def lab(rgb):
    c = rgb / 255.0
    c = np.where(c > 0.04045, ((c + 0.055) / 1.055) ** 2.4, c / 12.92)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    X = c @ M.T / np.array([0.9505, 1.0, 1.089])
    f = np.where(X > 0.008856, np.cbrt(X), 7.787 * X + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def row1(path):
    im = np.asarray(Image.open(path).convert("RGB")).astype(np.float64)
    h = im.shape[0] // 3
    r = im[:h]
    bg = np.median(r.reshape(-1, 3), axis=0)
    L = lab(r)
    B = lab(bg[None, None])[0, 0]
    mask = np.linalg.norm(L - B, axis=-1) > 6.0
    shadow = (np.hypot(L[..., 1] - B[1], L[..., 2] - B[2]) < 4.0) & (L[..., 0] < B[0])   # the cast shadow: bg hue, darker
    return L, mask & ~shadow


def backdrop(path):
    """the sheet's commonest colour in row 1: tells its render setup apart"""
    im = np.asarray(Image.open(path).convert("RGB"))
    v, c = np.unique(im[:im.shape[0] // 3].reshape(-1, 3), axis=0, return_counts=True)
    return tuple(int(x) for x in v[c.argmax()])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("fid")
    ap.add_argument("--skins", default="")
    ap.add_argument("--dir", default="", help="read three_<id>[_<skin>].png from here instead (e.g. older copies)")
    a = ap.parse_args()
    d = a.dir or os.path.join(GAME, "art", "renders", "fighters", a.fid)
    base = os.path.join(d, f"three_{a.fid}.png")
    skins = a.skins.split(",") if a.skins else sorted(
        os.path.basename(p)[6:-4] for p in glob.glob(os.path.join(d, f"three_{a.fid}_*.png"))
        if "clips" not in p)
    Lb, mb = row1(base)
    bdb = backdrop(base)
    print(f"# skin vs base at the game camera (row 1 of three_*.png, 8 facings): {base}")
    for s in skins:
        Ls, ms = row1(os.path.join(d, f"three_{s}.png"))
        bds = backdrop(os.path.join(d, f"three_{s}.png"))
        both = mb & ms
        px = float(np.linalg.norm(Ls - Lb, axis=-1)[both].mean())
        mean = float(np.linalg.norm(Ls[ms].mean(0) - Lb[mb].mean(0)))
        print(f"  {s:24s} per-pixel dE76 {px:5.1f} | figure-mean dE76 {mean:5.1f} | mean Lab base "
              f"{np.round(Lb[mb].mean(0), 1).tolist()} skin {np.round(Ls[ms].mean(0), 1).tolist()} | px {int(both.sum())} | "
              f"backdrop {bds}")
        if bds != bdb:
            print(f"  WARNING {s}: sheet setup differs from the base's (backdrop {bdb}): this line is not comparable")


if __name__ == "__main__":
    main()
