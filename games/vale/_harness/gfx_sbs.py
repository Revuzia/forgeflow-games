#!/usr/bin/env python3
"""VALE harness (lane GF): a labelled side-by-side of two variants of one gfx_fighter_ab.mjs run, at most 1600 px wide, plus
the pixel delta of each frame.

    python3 _harness/gfx_sbs.py <out.png|-> <tag> <fighter> <varA> <varB> [--q high] [--rows game0,game2] [--menu 1]
        [--half 100] [--labelA before] [--labelB after] [--more tag:fighter ...]"""
import argparse
import json
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SH = os.path.join(HERE, "_shots")
ap = argparse.ArgumentParser()
ap.add_argument("out")
ap.add_argument("tag")
ap.add_argument("fighter")
ap.add_argument("a")
ap.add_argument("b")
ap.add_argument("--q", default="high")
ap.add_argument("--labelA", default="before")
ap.add_argument("--labelB", default="after")
ap.add_argument("--rows", default="game0,game2")
ap.add_argument("--menu", type=int, default=1)
ap.add_argument("--half", type=int, default=95)
ap.add_argument("--more", default="")
A = ap.parse_args()
try:
    font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 22)
except OSError:
    font = ImageFont.load_default()
H, rows = A.half, []
for spec in [f"{A.tag}:{A.fighter}"] + [x for x in A.more.split(",") if x]:
    tag, fid = spec.split(":")
    rep = json.load(open(os.path.join(HERE, "_reports", f"gfx_{tag}_{fid}_{A.q}.json")))
    P = lambda v, r: os.path.join(SH, f"gfx_{tag}_{fid}_{A.q}_{v}_{r}.png")  # noqa: E731
    for r in A.rows.split(","):
        s = rep["frames"][int(r[-1])]["game"]
        box = (int(s["x"]) - H, int(s["y"]) - H, int(s["x"]) + H, int(s["y"]) + H)
        a, b = (Image.open(P(v, r)).convert("RGB") for v in (A.a, A.b))
        d = np.abs(np.array(a, float) - np.array(b, float)).max(2)
        print(fid, r, "px delta>8:", int((d > 8).sum()), "max", int(d.max()), "whole-frame box only", int((d[box[1]:box[3], box[0]:box[2]] > 8).sum()))
        rows.append((a.crop(box).resize((780, 780), Image.LANCZOS), b.crop(box).resize((780, 780), Image.LANCZOS)))
    if A.menu and os.path.exists(P(A.a, "menu")):
        a, b = (Image.open(P(v, "menu")).convert("RGB") for v in (A.a, A.b))
        d = np.abs(np.array(a, float) - np.array(b, float)).max(2)
        print(fid, "menu px delta>8:", int((d > 8).sum()), "max", int(d.max()))
        box = (1230, 300, 1630, 950)
        rows.append((a.crop(box).resize((600, 975), Image.LANCZOS), b.crop(box).resize((600, 975), Image.LANCZOS)))
if A.out != "-":
    im = Image.new("RGB", (1600, 34 + sum(r[0].height for r in rows)), (20, 20, 22))
    dr = ImageDraw.Draw(im)
    dr.text((12, 5), A.labelA, fill=(235, 235, 235), font=font)
    dr.text((812, 5), A.labelB, fill=(235, 235, 235), font=font)
    y = 34
    for a, b in rows:
        im.paste(a, (400 - a.width // 2, y))
        im.paste(b, (1200 - b.width // 2, y))
        y += a.height
    os.makedirs(os.path.dirname(os.path.abspath(A.out)), exist_ok=True)
    im.save(A.out, optimize=True)
    print(A.out, im.size)
