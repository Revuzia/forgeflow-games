"""Nurrow hat paint preview (no build): the lacquered cone's paint_hat / paint_rim / paint_knob sampled on the
upright cone seen from straight above (image down = her front), base + both skins, lit flat (albedo) and with a
simple game-like light, plus a 64 px thumbnail row. Writes .npy arrays; the venv composes the sheet.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/nurrow_hatpaint.py -- OUT_DIR
"""
from __future__ import annotations

import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "fighters"))

import numpy as np  # noqa: E402

import nurrow as NR  # noqa: E402


def surf(x, y):
    r = np.hypot(x, y)
    z = NR.CONE_H * (1 - r / NR.BRIM_R)
    return NR.hat_ws(np.stack([x, y, z], -1))


def main():
    out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "/tmp"
    os.makedirs(out, exist_ok=True)
    N = 520
    E = NR.BRIM_R + 0.03
    j, i = np.meshgrid(np.arange(N), np.arange(N))
    x = (j + 0.5) / N * 2 * E - E
    y = E - (i + 0.5) / N * 2 * E            # row 0 = +Y (her back), the last row her front
    r = np.hypot(x, y)
    cone = r < NR.BRIM_R - 0.008
    rim = (r >= NR.BRIM_R - 0.008) & (r < NR.BRIM_R + 0.012)
    e = 1e-3
    P = surf(x, y)
    dx = surf(x + e, y) - surf(x - e, y)
    dy = surf(x, y + e) - surf(x, y - e)
    n = np.cross(dx, dy)
    n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-12
    n *= np.sign((n @ NR.HAT_UP))[..., None]
    skins = [None] + [s for s in NR.SKINS]
    for sk in skins:
        NR._SKIN.clear()
        if sk:
            NR._SKIN.update(sk)
        img = np.zeros((N, N, 3), np.float32) + 0.5
        m = cone
        img[m] = NR.paint_hat(P[m].astype(np.float64), n[m].astype(np.float64))
        # the rim: its outer ring point, up-facing
        a = np.arctan2(x[rim], -y[rim])
        rp = NR.HAT_C + np.stack([np.sin(a) * NR.BRIM_R, -np.cos(a) * NR.BRIM_R, np.zeros_like(a) + 0.006], -1) @ NR.HAT_R.T
        rn = np.tile(NR.HAT_UP, (len(a), 1)) * 0.8 + np.stack([np.sin(a), -np.cos(a), 0 * a], -1) @ NR.HAT_R.T * 0.6
        rn /= np.linalg.norm(rn, axis=-1, keepdims=True)
        img[rim] = NR.paint_rim(rp, rn)
        # inlays
        for phi in NR.RIM_ANGLES:
            c = NR.rim_angle_dir(phi) * NR.BRIM_R
            d = np.hypot(x - c[0], y - c[1])
            img[d < NR.INLAY_PREVIEW_R if hasattr(NR, "INLAY_PREVIEW_R") else d < 0.02] = (0.25, 0.6, 1.0)
        kn = r < 0.035
        kp = NR.hat_ws(np.stack([x[kn], y[kn], np.zeros(kn.sum()) + NR.CONE_H + 0.006], -1))
        img[kn] = NR.paint_knob(kp, np.tile(NR.HAT_UP, (kn.sum(), 1)))
        name = sk["id"] if sk else "base"
        np.save(os.path.join(out, f"hat_{name}.npy"), img)
        np.save(os.path.join(out, f"hatn_{name}.npy"), n.astype(np.float32))
        np.save(os.path.join(out, f"hatm_{name}.npy"), (cone | rim))
        print("wrote", name)


main()
