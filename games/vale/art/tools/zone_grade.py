#!/usr/bin/env python3
"""VALE art: per-fighter material zoning of a shipped fighter GLB's painted base colour (MAX2 U1(1)).

    python3 art/tools/zone_grade.py <sid> [--glb path] [--dry]
    python3 art/tools/zone_grade.py --all

The bakes paint most of the roster in one cream/clay family, so at the 28.5 m game camera Kemdo, Burdam, Vashil,
Tunlan and Rishal read as beige figures with their signature hue nowhere on the body. art/tools/zone_grades.json names,
per fighter, a few large parts that carry the signature hue (one mid-body zone of >= 6 % of the body) and the lower-body
parts that sit in the bible's dark band; each zone is an absolute CIELAB target (hue = the colour's hue angle, mean
L*, chroma), applied with art/tools/glb_paint_grade.mjs --part-tint. Absolute targets: a second run lands on the same
values, so pipeline.build re-applies the recipe after every rebuild (the grade is part of the build, not a one-off).

A zone's mask is either parts of the bake's part map (art/.cache/fighters/partmap/<sid>.npz) or, for a fighter whose
paint path writes no part map, a rest-position box (Blender axes, metres) intersected with an ORM roughness band (the
bake's material class: cloth 0.82+, leather and lacquer 0.45-0.8, glass < 0.25).
"""
from __future__ import annotations

import io
import json
import os
import struct
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
GAME = os.path.dirname(os.path.dirname(HERE))
PARTMAP = os.path.join(GAME, "art", ".cache", "fighters", "partmap")
RECIPES = os.path.join(HERE, "zone_grades.json")
GRADE = os.path.join(HERE, "glb_paint_grade.mjs")


def glb_image(path: str, suffix: str) -> np.ndarray:
    with open(path, "rb") as f:
        b = f.read()
    off, js, binc = 12, None, None
    while off < len(b):
        ln, ty = struct.unpack_from("<II", b, off)
        chunk = b[off + 8: off + 8 + ln]
        if ty == 0x4E4F534A:
            js = json.loads(chunk)
        else:
            binc = chunk
        off += 8 + ln
    for im in js["images"]:
        if im.get("name", "").endswith(suffix):
            bv = js["bufferViews"][im["bufferView"]]
            data = binc[bv.get("byteOffset", 0): bv.get("byteOffset", 0) + bv["byteLength"]]
            return np.asarray(Image.open(io.BytesIO(data)).convert("RGB"))
    raise SystemExit(f"{path}: no image named *{suffix}")


RESERVED = {"ally": (200, 225), "harm": (28, 50), "tritanAltRose": (340, 350), "heal": (125, 150)}  # tokens vfx.reservedHuesHSV


def reserved_pct(rgb: np.ndarray) -> dict:
    """ruling 32 (tokens art.skins.never): % of the albedo's painted texels above 40 % HSV saturation inside each
    reserved hue band"""
    hsv = np.asarray(Image.fromarray(rgb.astype("uint8")).convert("HSV")).astype(np.float32)
    h, sat = hsv[..., 0] / 255 * 360, hsv[..., 1] / 255
    used = rgb.max(-1) > 2
    tot = max(int(used.sum()), 1)
    return {k: round(100.0 * float(((h >= a) & (h <= b) & (sat > 0.4) & used).sum()) / tot, 2) for k, (a, b) in RESERVED.items()}


def node() -> str:
    for p in ("/opt/homebrew/opt/node@22/bin/node", "/opt/homebrew/bin/node"):
        if os.path.isfile(p):
            return p
    return "node"


def zone_mask(sid: str, glb: str, z: dict, size: tuple, tmp: str, i: int) -> str:
    W, H = size
    out = os.path.join(tmp, f"zone{i}.png")
    if "parts" in z:
        pm = np.load(os.path.join(PARTMAP, f"{sid}.npz"))
        names = [str(n) for n in pm["names"]]
        missing = [p for p in z["parts"] if p not in names]
        if missing:
            raise SystemExit(f"{sid}: parts {missing} are not in the part map")
        m = np.isin(pm["part"], [names.index(p) for p in z["parts"]])
        Image.fromarray((m * 255).astype("uint8")).resize((W, H), Image.NEAREST).save(out)
        return out
    box = os.path.join(tmp, f"box{i}.png")
    cmd = [node(), GRADE, glb]
    for b in z["boxes"]:
        cmd += ["--box", ",".join(str(v) for v in b)]
    subprocess.run(cmd + ["--mask-out", box], check=True, cwd=GAME, capture_output=True)
    m = np.asarray(Image.open(box).convert("L")) >= 128
    lo, hi = z.get("rough", [0.0, 1.0])
    orm = Image.fromarray(glb_image(glb, "_orm")).resize((W, H), Image.NEAREST)
    r = np.asarray(orm)[..., 1] / 255.0
    m &= (r >= lo) & (r <= hi)
    if "maxL" in z or "minL" in z:
        from part_lab import srgb_to_lab
        L = srgb_to_lab(glb_image(glb, "_base") / 255.0)[..., 0]
        m &= (L <= z.get("maxL", 101)) & (L >= z.get("minL", -1))
    Image.fromarray((m * 255).astype("uint8")).save(out)
    return out


def grade(sid: str, glb: str | None = None, dry: bool = False, fresh: float = 0.0) -> dict:
    """`fresh` (epoch s, pipeline.build passes its start): a part-map zone needs a part map written since then, so a
    build whose paint path wrote none (a stale map whose texels no longer line up) is not graded through it"""
    recipes = json.load(open(RECIPES))
    if sid not in recipes:
        return {"sid": sid, "skipped": "no recipe"}
    rec = recipes[sid]
    glb = glb or os.path.join(GAME, "art", "out", "fighters", rec.get("fighter", sid), f"{sid}.glb")
    if any("parts" in z for z in rec["zones"]) and not os.path.isfile(os.path.join(PARTMAP, f"{sid}.npz")):
        return {"sid": sid, "skipped": f"no part map for {sid}: rebuild it"}
    if any("parts" in z for z in rec["zones"]) and os.path.getmtime(os.path.join(PARTMAP, f"{sid}.npz")) < fresh:
        print(f"WARNING {sid}: the part map predates this build (stale texel layout); zone grade skipped, use box zones")
        return {"sid": sid, "skipped": "stale part map"}
    base = glb_image(glb, "_base")
    H, W = base.shape[:2]
    import shutil
    before = os.path.getsize(glb)
    with tempfile.TemporaryDirectory() as tmp:
        tint = []
        for i, z in enumerate(rec["zones"]):
            m = zone_mask(sid, glb, z, (W, H), tmp, i)
            tint += ["--part-tint", f"{m}:{z['hex']}:{z['L']}:{z['C']}" + (f":{z['k']}" if "k" in z else "")]
        if dry:
            return {"sid": sid, "tint": tint}
        # the WebP quality: the highest of 84, 80, ... 60 that keeps the GLB within 24 KiB of its size before the grade
        # and under 1160 KiB (or, for a GLB already past that, no larger than it was) (the fighter budget is 1172, pipeline load_test); GPU memory is unchanged either way (the
        # decoded texture is the same 2048^2)
        trial = os.path.join(tmp, "trial.glb")
        for q in range(84, 59, -4):
            shutil.copyfile(glb, trial)
            r = subprocess.run([node(), GRADE, trial, "--q", str(q)] + tint, cwd=GAME, capture_output=True, text=True)
            if r.returncode:
                raise SystemExit(r.stderr[-1200:])
            if os.path.getsize(trial) <= max(min(before + 24 * 1024, 1160 * 1024), before) or q <= 60:
                break
        # ruling 32: a zone grade keeps every reserved band at <= 8 % of the albedo (or, where the bake already sat
        # above the cap, never raises it); a grade that breaks it is not applied and the build fails
        pre, post = reserved_pct(base), reserved_pct(glb_image(trial, "_base"))
        bad = {k: (pre[k], post[k]) for k in RESERVED if post[k] > max(8.0, pre[k]) + 0.05}
        if bad:
            raise SystemExit(f"{sid}: zone grade breaks the reserved-hue cap (ruling 32, before -> after %): {bad}")
        shutil.copyfile(trial, glb)
        print(r.stdout.strip().replace(trial, glb))
        print(f"{sid}: reserved hues (ruling 32) % before {pre} after {post}")
        print(f"{sid}: WebP q {q}, GLB {before / 1024:.1f} -> {os.path.getsize(glb) / 1024:.1f} KiB")
    return {"sid": sid, "ok": True}


if __name__ == "__main__":
    a = sys.argv[1:]
    glb = a[a.index("--glb") + 1] if "--glb" in a else None
    ids = [k for k in json.load(open(RECIPES)) if not k.startswith("_")] if "--all" in a else [a[0]]
    for s in ids:
        print(json.dumps(grade(s, glb, "--dry" in a, float(a[a.index("--fresh") + 1]) if "--fresh" in a else 0.0)))
