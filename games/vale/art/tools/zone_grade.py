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
BASELINES = os.path.join(HERE, "reserved_baselines.json")
# ruling 32: a zoned fighter's albedo ends with every reserved band at <= 8 %; the grade aims at 7 % (glb_paint_grade.mjs
# --reserve-cap: the fewest, cheapest texels desaturated or hue-shifted) so the lossy WebP encode keeps a margin
CAP = 8.0
# (aim %, hue margin deg): tried in order until the encoded albedo holds the cap (the WebP encode pulls dark texels'
# hue back toward the band, so a bake far over the cap needs a lower aim and a wider shift)
LADDER = ((7.0, 6), (6.0, 8), (5.0, 10), (4.0, 12), (3.0, 14))
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


def reserved_pct(rgb: np.ndarray, pil_only: bool = False) -> dict:
    """ruling 32 (tokens art.skins.never): % of the albedo's painted texels above 40 % HSV saturation inside each
    reserved hue band (the larger of PIL's 8-bit HSV and float HSV)"""
    hsv = np.asarray(Image.fromarray(rgb.astype("uint8")).convert("HSV")).astype(np.float32)
    h, sat = hsv[..., 0] / 255 * 360, hsv[..., 1] / 255
    used = rgb.max(-1) > 2
    tot = max(int(used.sum()), 1)
    pil = {k: round(100.0 * float(((h >= a) & (h <= b) & (sat > 0.4) & used).sum()) / tot, 2) for k, (a, b) in RESERVED.items()}
    if pil_only:     # the unzoned baselines (reserved_baselines.json) were measured this way
        return pil
    # max2 r4 (verify_r3_1_q): the same share in float HSV (no 8-bit hue quantisation) can read ~0.5 points higher; the
    # binding figure is the larger of the two, so a pass never depends on the quantisation
    f = rgb.astype(np.float32) / 255
    mx, mn = f.max(-1), f.min(-1)
    d = mx - mn
    dd = np.maximum(d, 1e-9)
    r, g, bb = f[..., 0], f[..., 1], f[..., 2]
    hf = np.where(d == 0, 0, np.where(mx == r, ((g - bb) / dd) % 6, np.where(mx == g, (bb - r) / dd + 2, (r - g) / dd + 4))) * 60 % 360
    sf = np.where(mx > 0, d / np.maximum(mx, 1e-9), 0)
    flt = {k: round(100.0 * float(((hf >= a) & (hf <= b) & (sf > 0.4) & used).sum()) / tot, 2) for k, (a, b) in RESERVED.items()}
    return {k: max(pil[k], flt[k]) for k in RESERVED}


def node() -> str:
    for p in ("/opt/homebrew/opt/node@22/bin/node", "/opt/homebrew/bin/node"):
        if os.path.isfile(p):
            return p
    return "node"


def zone_mask(sid: str, glb: str, z: dict, size: tuple, tmp: str, i: int) -> str:
    """a zone's texels: part-map parts and/or rest-position boxes and rings (--cyl: cx, cy, r0, r1, z0, z1; MAX2 U7
    crown bands), intersected, minus notBoxes / notCyls, then the optional ORM roughness band and L* range"""
    W, H = size
    out = os.path.join(tmp, f"zone{i}.png")
    m = None
    if "parts" in z:
        pm = np.load(os.path.join(PARTMAP, f"{sid}.npz"))
        names = [str(n) for n in pm["names"]]
        missing = [p for p in z["parts"] if p not in names]
        if missing:
            raise SystemExit(f"{sid}: parts {missing} are not in the part map")
        pmask = np.isin(pm["part"], [names.index(p) for p in z["parts"]])
        m = np.asarray(Image.fromarray((pmask * 255).astype("uint8")).resize((W, H), Image.NEAREST)) >= 128

    def geomask(boxes, cyls, tag):
        box = os.path.join(tmp, f"{tag}{i}.png")
        cmd = [node(), GRADE, glb]
        for b in boxes:
            cmd += ["--box", ",".join(str(v) for v in b)]
        for c in cyls:
            cmd += ["--cyl", ",".join(str(v) for v in c)]
        subprocess.run(cmd + ["--mask-out", box], check=True, cwd=GAME, capture_output=True)
        return np.asarray(Image.open(box).convert("L")) >= 128
    if "boxes" in z or "cyls" in z:
        g = geomask(z.get("boxes", []), z.get("cyls", []), "box")
        m = g if m is None else (m & g)
    if m is None:
        raise SystemExit(f"{sid}: zone {i} names no parts, boxes or cyls")
    if "notBoxes" in z or "notCyls" in z:       # texels to leave alone (another lane's part, e.g. Burdam's hood and cowl)
        m &= ~geomask(z.get("notBoxes", []), z.get("notCyls", []), "not")
    if "rough" in z or "parts" not in z:
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
        return baseline_check(sid, glb)
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
        pre = reserved_pct(base)
        for aim, margin in LADDER:
            for q in range(84, 59, -4):
                shutil.copyfile(glb, trial)
                r = subprocess.run([node(), GRADE, trial, "--q", str(q), "--reserve-cap", str(aim), "--reserve-margin",
                                    str(margin)] + [x for k, v in rec.get("reserveModes", {}).items() for x in ("--reserve-mode", f"{k}={v}")]
                               + (["--reserve-sat", str(rec["reserveSat"])] if "reserveSat" in rec else [])
                               + (["--reserve-knee", str(rec["reserveKnee"])] if "reserveKnee" in rec else [])
                               + (["--reserve-ceil", str(rec["reserveCeil"])] if "reserveCeil" in rec else []) + tint, cwd=GAME, capture_output=True, text=True)
                if r.returncode:
                    raise SystemExit(r.stderr[-1200:])
                if os.path.getsize(trial) <= max(min(before + 24 * 1024, 1160 * 1024), before) or q <= 60:
                    break
            # ruling 32 (max2 round 2, strict reading): a zoned fighter's albedo ends with every reserved band at
            # <= 8 %, whatever its bake held (the grade's --reserve-cap brings a bake over the cap under it); a grade
            # that misses it on every step of the ladder is not applied and the build fails
            post = reserved_pct(glb_image(trial, "_base"))
            bad = {k: (pre[k], post[k]) for k in RESERVED if post[k] > CAP}
            if not bad:
                break
        if bad:
            raise SystemExit(f"{sid}: zone grade breaks the reserved-hue cap (ruling 32, before -> after %): {bad}")
        shutil.copyfile(trial, glb)
        print(r.stdout.strip().replace(trial, glb))
        print(f"{sid}: reserved hues (ruling 32) % before {pre} after {post}")
        print(f"{sid}: reserve aim {aim} % margin {margin} deg, WebP q {q}, GLB {before / 1024:.1f} -> {os.path.getsize(glb) / 1024:.1f} KiB")
    return {"sid": sid, "ok": True}


def fighter_glb(sid: str) -> str | None:
    import glob
    hits = glob.glob(os.path.join(GAME, "art", "out", "fighters", "*", f"{sid}.glb"))
    return hits[0] if hits else None


def baseline_check(sid: str, glb: str | None) -> dict:
    """a fighter or skin with no zone recipe: its bake may not raise a reserved band above max(8 %, the share recorded
    in art/tools/reserved_baselines.json) (ruling 32's scope over whole bakes waits on the lead; until then no bake
    can rise). A sid with no baseline is reported, not gated."""
    glb = glb or fighter_glb(sid)
    if not glb or not os.path.isfile(glb):
        return {"sid": sid, "skipped": "no recipe, no GLB"}
    now = reserved_pct(glb_image(glb, "_base"), pil_only=True)
    base = json.load(open(BASELINES)).get(sid) if os.path.isfile(BASELINES) else None
    if base is None:
        return {"sid": sid, "skipped": "no recipe", "reserved": now, "baseline": None}
    bad = {k: (base.get(k, 0.0), now[k]) for k in RESERVED if now[k] > max(CAP, base.get(k, 0.0)) + 0.5}
    if bad:
        raise SystemExit(f"{sid}: the bake raises a reserved hue band over its ruling-32 baseline (baseline -> now %): {bad}")
    return {"sid": sid, "skipped": "no recipe", "reserved": now, "baseline": base}


def write_baselines() -> None:
    import glob
    out = {"_doc": "ruling 32 baselines: % of each fighter/skin albedo above 40 % HSV saturation in each reserved band, "
                   "measured on the shipped GLBs (zone_grade.py --baselines). A rebuild may not raise a band above "
                   "max(8, baseline) + 0.5; zoned fighters are held to 8 % outright."}
    for p in sorted(glob.glob(os.path.join(GAME, "art", "out", "fighters", "*", "*.glb"))):
        out[os.path.basename(p)[:-4]] = reserved_pct(glb_image(p, "_base"), pil_only=True)
    json.dump(out, open(BASELINES, "w"), indent=1)
    print(f"{BASELINES}: {len(out) - 1} GLBs")


if __name__ == "__main__":
    a = sys.argv[1:]
    if "--baselines" in a:
        write_baselines()
        sys.exit(0)
    glb = a[a.index("--glb") + 1] if "--glb" in a else None
    ids = [k for k in json.load(open(RECIPES)) if not k.startswith("_")] if "--all" in a else [a[0]]
    for s in ids:
        print(json.dumps(grade(s, glb, "--dry" in a, float(a[a.index("--fresh") + 1]) if "--fresh" in a else 0.0)))
