"""Point-cloud clip sheet for proto/odrum_clipcheck.py --dump (plain python + PIL, no Blender):

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/odrum_clipsheet.py dump.npz out.png \
        [--clips cast_a1,attack1] [--n 8] [--views front,side,game] [--frames 0,6,12]

One row per clip and view, n frames across; vertices coloured by group (head ochre, staff brown, pots orange,
arms blue/teal, torso grey...), drawn back to front. The ground line is z = 0; 'game' is the gameplay camera
(pitch 52 degrees, from the front)."""
import argparse
import math

import numpy as np
from PIL import Image, ImageDraw

GROUPS = ["head", "torso", "armL", "armR", "handL", "handR", "hips", "shin", "foot", "staff", "potL", "potR", "other"]
COL = {"head": (214, 170, 90), "torso": (130, 120, 112), "armL": (70, 120, 200), "armR": (60, 190, 180),
       "handL": (40, 70, 160), "handR": (30, 140, 130), "hips": (110, 95, 85), "shin": (80, 70, 64),
       "foot": (50, 44, 40), "staff": (120, 70, 30), "potL": (235, 120, 40), "potR": (235, 60, 60),
       "other": (200, 200, 200)}


def view(V, kind):
    """(screen x, screen y up, depth toward the viewer)"""
    X, Y, Z = V[:, 0], V[:, 1], V[:, 2]
    if kind == "front":
        return X, Z, -Y
    if kind == "side":                       # from the character's right (-X): front (-Y) is screen-left
        return Y, Z, -X
    if kind == "back":
        return -X, Z, Y
    if kind == "top":
        return X, -Y, Z
    a = math.radians(52)                     # game camera in front, 52 degrees up
    return X, Y * math.sin(a) + Z * math.cos(a), -Y * math.cos(a) + Z * math.sin(a)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("npz")
    p.add_argument("out")
    p.add_argument("--clips", default="")
    p.add_argument("--n", type=int, default=8)
    p.add_argument("--frames", default="")
    p.add_argument("--views", default="front,side,game")
    p.add_argument("--px", type=float, default=80.0, help="pixels per metre")
    a = p.parse_args()
    D = np.load(a.npz)
    grp = D["_groups"]
    keys = [k for k in D.files if k != "_groups"]
    clips = [c for c in a.clips.split(",") if c] or list(dict.fromkeys(k.split("/")[0] for k in keys))
    views = a.views.split(",")
    W, H = int(2.4 * a.px), int(2.7 * a.px)
    rows = []
    for c in clips:
        fr = sorted(int(k.split("/")[1]) for k in keys if k.split("/")[0] == c)
        if a.frames:
            pick = [f for f in (int(x) for x in a.frames.split(",")) if f in fr]
        else:
            pick = [fr[int(round(i * (len(fr) - 1) / max(1, a.n - 1)))] for i in range(a.n)]
        for v in views:
            rows.append((c, v, pick))
    ncol = max(len(r[2]) for r in rows)
    img = Image.new("RGB", (ncol * W, len(rows) * H), (238, 236, 230))
    dr = ImageDraw.Draw(img)
    for ri, (c, v, pick) in enumerate(rows):
        for ci, f in enumerate(pick):
            V = D[f"{c}/{f}"].astype(np.float64)
            sx, sy, dz = view(V, v)
            ox, oy = ci * W + W / 2, ri * H + H - 0.25 * a.px
            if v == "top":
                oy = ri * H + H / 2
            gy = oy if v in ("front", "side", "back") else oy - 0.0
            if v in ("front", "side", "back"):
                dr.line([(ci * W, gy), (ci * W + W, gy)], fill=(150, 150, 150))
            order = np.argsort(dz)
            for i in order:
                x, y = ox + sx[i] * a.px, oy - sy[i] * a.px
                dr.rectangle([x - 1, y - 1, x + 1, y + 1], fill=COL[GROUPS[grp[i]]])
            dr.text((ci * W + 4, ri * H + 4), f"{c} f{f} {v}", fill=(0, 0, 0))
        dr.line([(0, ri * H), (ncol * W, ri * H)], fill=(180, 180, 180))
    img.save(a.out)
    print(a.out, img.size)


main()
