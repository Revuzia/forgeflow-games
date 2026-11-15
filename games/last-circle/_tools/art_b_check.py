#!/usr/bin/env python3
"""art_b_check.py - offline validator for everything lane ART-B ships (dev-only; _tools/ never ships).

  python games/last-circle/_tools/art_b_check.py [--json OUT.json] [--quiet]

Checks (each is one row; any FAIL -> exit 1; the repo layout missing -> exit 2):
  manifest   assets/props/city/manifest.json parses; every type's GLB exists and is a valid GLB; triangles in the file
             (accessor counts, never decoded) are within +-2 % of the manifest `tris`; world bbox at suggested_scale is
             within max(3 cm, 1 %) of `bbox_m`; `bytes` equals the file size; `compression` matches the file;
             colliders are non-empty, min < max on every axis and inside the bbox (+0.3 m); palettes + variants exist
             and are 512 px PNGs; `totals` agree with the types
  caps       every PNG within its cap: assets/fx <= 64 KB each and power-of-two, assets/hud/wpn_*.png 160x60 RGBA <= 16 KB,
             palettes <= 64 KB, assets/tex/*.jpg 1024 px <= 400 KB; the six wpn_<id>.png + four fx files all present
  vendor     meshopt_decoder.module.js present, 24,850 B, byte-identical to three@0.172.0 in node_modules when reachable
  bytes      total new downloadable bytes by group (information, printed + in the JSON)
"""
from __future__ import annotations

import argparse
import json
import os
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
GAME = HERE.parent
sys.path.insert(0, str(HERE))
from art_b_glb import glb_stats  # noqa: E402

CITY = GAME / "assets" / "props" / "city"
CARS = GAME / "assets" / "props" / "cars"
FX = GAME / "assets" / "fx"
HUD = GAME / "assets" / "hud"
TEX = GAME / "assets" / "tex"
VENDOR = GAME / "assets" / "vendor" / "three" / "examples" / "jsm" / "libs"
NODE_THREE = GAME.parent.parent / "node_modules" / "three" / "examples" / "jsm" / "libs"
MANIFEST = CITY / "manifest.json"
WPN_IDS = ["pistol", "smg", "ar", "shotgun", "sniper", "glauncher"]
FX_NAMES = ["spark", "puff", "glow", "tracer"]


def png_size(p: Path):
    b = p.read_bytes()[:33]
    if b[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    w, h = struct.unpack(">II", b[16:24])
    return w, h, b[25]            # colour type: 6 = RGBA


def jpg_size(p: Path):
    from PIL import Image
    return Image.open(p).size


def pot(n: int) -> bool:
    return n > 0 and (n & (n - 1)) == 0


def dir_bytes(d: Path, pattern="*"):
    return sum(f.stat().st_size for f in d.glob(pattern) if f.is_file()) if d.exists() else 0


def run_checks() -> tuple[list[dict], dict]:
    rows: list[dict] = []

    def row(name, ok, detail):
        rows.append({"name": name, "ok": bool(ok), "detail": detail})

    info: dict = {"bytes_by_group": {}}
    if not MANIFEST.exists():
        row("manifest present", False, str(MANIFEST))
        return rows, info
    m = json.loads(MANIFEST.read_text(encoding="utf-8"))
    types, pals = m["types"], m["palettes"]

    bad_file, bad_tris, bad_bbox, bad_bytes, bad_comp, bad_coll, bad_glb = [], [], [], [], [], [], []
    tot_tris = 0
    for k, t in types.items():
        f = CITY / t["file"]
        if not f.exists():
            bad_file.append(k)
            continue
        head = f.read_bytes()[:12]
        if head[:4] != b"glTF":
            bad_glb.append(k)
            continue
        try:
            st = glb_stats(f)
        except Exception as e:                      # noqa: BLE001
            bad_glb.append("%s (%s)" % (k, e))
            continue
        tot_tris += st["tris"]
        if abs(st["tris"] - t["tris"]) > max(2, 0.02 * t["tris"]):
            bad_tris.append("%s file %d vs manifest %d" % (k, st["tris"], t["tris"]))
        sc = t["suggested_scale"]
        size = [(st["bbox_max"][i] - st["bbox_min"][i]) * sc for i in range(3)]
        for axis, got in zip("xyz", size):
            if abs(got - t["bbox_m"][axis]) > max(0.03, 0.01 * t["bbox_m"][axis]):
                bad_bbox.append("%s %s file %.3f vs manifest %.3f" % (k, axis, got, t["bbox_m"][axis]))
        if f.stat().st_size != t["bytes"]:
            bad_bytes.append("%s file %d vs manifest %d" % (k, f.stat().st_size, t["bytes"]))
        comp = "meshopt" if "EXT_meshopt_compression" in st["ext_used"] else "none"
        if comp != t.get("compression"):
            bad_comp.append("%s file %s vs manifest %s" % (k, comp, t.get("compression")))
        cs = t.get("colliders") or []
        lo, hi = t["bbox_min_m"], t["bbox_max_m"]
        ok = bool(cs) and all(all(c["max"][i] > c["min"][i] and c["min"][i] >= lo[i] - 0.3 and c["max"][i] <= hi[i] + 0.3 for i in range(3)) for c in cs)
        if not ok:
            bad_coll.append(k)
    row("manifest: every type's GLB exists + is a GLB", not (bad_file or bad_glb),
        "%d types%s%s" % (len(types), "; MISSING " + ", ".join(bad_file[:5]) if bad_file else "", "; BAD " + ", ".join(bad_glb[:5]) if bad_glb else ""))
    row("manifest: tris in the file within +-2 % of the manifest", not bad_tris, "; ".join(bad_tris[:4]) or "all %d match (%d tris total)" % (len(types), tot_tris))
    row("manifest: bbox_m matches the file at suggested_scale", not bad_bbox, "; ".join(bad_bbox[:4]) or "all match")
    row("manifest: bytes + compression fields match the files", not (bad_bytes or bad_comp), "; ".join((bad_bytes + bad_comp)[:4]) or "all match")
    row("manifest: colliders non-empty, min<max, inside the bbox", not bad_coll, ", ".join(bad_coll[:8]) or "%d types, %d boxes" % (
        len(types), sum(len(t["colliders"]) for t in types.values())))

    # palettes
    bad_pal = []
    for key, p in pals.items():
        for rel in [p["file"]] + [v["file"] for v in p.get("variants", {}).values()]:
            f = (CITY / rel).resolve()
            if not f.exists():
                bad_pal.append("%s missing" % rel)
                continue
            sz = png_size(f)
            if not sz or sz[0] != sz[1] or not pot(sz[0]) or f.stat().st_size > 64 * 1024:
                bad_pal.append("%s %s %d B" % (rel, sz, f.stat().st_size))
    used = {t["palette"] for t in types.values() if t["palette"]}
    bad_pal += ["palette %s used but not declared" % u for u in used if u not in pals]
    row("palettes: PNG square power-of-two <= 64 KB, variants present, every used palette declared", not bad_pal,
        "; ".join(bad_pal[:4]) or "%d palettes, %d variants" % (len(pals), sum(len(p.get("variants", {})) for p in pals.values())))

    # totals
    tot_bad = []
    for g, t in m.get("totals", {}).items():
        mine = [x for x in types.values() if x["group"] == g]
        if t["files"] != len(mine) or t["tris"] != sum(x["tris"] for x in mine) or t["bytes"] != sum(x["bytes"] for x in mine):
            tot_bad.append(g)
    row("manifest: totals agree with the types", not tot_bad, ", ".join(tot_bad) or "all groups")

    # caps
    bad_cap = []
    for n in FX_NAMES:
        f = FX / f"{n}.png"
        sz = png_size(f) if f.exists() else None
        if not sz or not pot(sz[0]) or not pot(sz[1]) or f.stat().st_size > 64 * 1024:
            bad_cap.append("fx/%s %s" % (n, sz))
    for n in WPN_IDS:
        f = HUD / f"wpn_{n}.png"
        sz = png_size(f) if f.exists() else None
        if not sz or (sz[0], sz[1]) != (160, 60) or sz[2] != 6 or f.stat().st_size > 16 * 1024:
            bad_cap.append("hud/wpn_%s %s" % (n, sz))
    for n in ["road_asphalt", "sidewalk_concrete", "ground_grass_rock", "ground_beach", "ground_sand"]:
        f = TEX / f"{n}.jpg"
        sz = jpg_size(f) if f.exists() else None
        if not sz or sz != (1024, 1024) or f.stat().st_size > 400 * 1024:
            bad_cap.append("tex/%s %s" % (n, sz))
    row("caps: fx <= 64 KB POT, hud wpn 160x60 RGBA <= 16 KB, tex 1024 px <= 400 KB, all present", not bad_cap, "; ".join(bad_cap[:5]) or "4 fx + 6 hud + 5 tex ok")

    # vendor
    vend = VENDOR / "meshopt_decoder.module.js"
    ref = NODE_THREE / "meshopt_decoder.module.js"
    if not vend.exists():
        row("vendor: meshopt_decoder.module.js", False, "missing")
    else:
        same = ref.exists() and vend.read_bytes() == ref.read_bytes()
        row("vendor: meshopt_decoder.module.js 24,850 B and identical to three@0.172.0", vend.stat().st_size == 24850 and (same or not ref.exists()),
            "%d B%s" % (vend.stat().st_size, "" if ref.exists() else " (node_modules copy not reachable, size only)"))

    # bytes by group
    bg = {}
    for g in ["suburban", "commercial", "skyscraper", "lowdetail", "props", "furniture", "walls"]:
        bg["city/" + g] = dir_bytes(CITY / g, "*.glb")
    bg["cars (glb)"] = dir_bytes(CARS, "*.glb")
    bg["palettes (png)"] = dir_bytes(CITY / "palettes", "*.png") + dir_bytes(CARS, "*.png")
    bg["manifest.json"] = MANIFEST.stat().st_size
    bg["tex (jpg)"] = dir_bytes(TEX, "*.jpg")
    bg["fx (png)"] = dir_bytes(FX, "*.png")
    bg["hud (png)"] = dir_bytes(HUD, "*.png")
    bg["vendor meshopt decoder"] = vend.stat().st_size if vend.exists() else 0
    info["bytes_by_group"] = bg
    info["bytes_total"] = sum(bg.values())
    info["bytes_town_kit_glb"] = sum(v for k, v in bg.items() if k.startswith("city/") or k.startswith("cars"))
    return rows, info


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default=None)
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()
    if not (GAME / "assets").exists():
        print("repo layout missing")
        return 2
    rows, info = run_checks()
    bad = [r for r in rows if not r["ok"]]
    if not args.quiet:
        for r in rows:
            print("%-4s %s :: %s" % ("PASS" if r["ok"] else "FAIL", r["name"], r["detail"]))
        print("\nnew downloadable bytes by group:")
        for k, v in info["bytes_by_group"].items():
            print("  %-26s %9d B  %6.2f MB" % (k, v, v / 1048576))
        print("  %-26s %9d B  %6.2f MB  (town-kit GLBs only: %.2f MB)" % ("TOTAL", info["bytes_total"], info["bytes_total"] / 1048576, info["bytes_town_kit_glb"] / 1048576))
    if args.json:
        Path(args.json).write_text(json.dumps({"rows": rows, **info}, indent=1), encoding="utf-8")
    print("VERDICT art_b_check: %s" % ("PASS" if not bad else "FAIL (%d)" % len(bad)))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
