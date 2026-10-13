#!/usr/bin/env python
"""ART-B town-kit decode gate (lane ART-B, wave 4).

Drives a REAL headless Chrome (three r172 + GLTFLoader + the VENDORED meshopt decoder, all read from
assets/vendor/three/) over every GLB listed in assets/props/city/manifest.json and checks what the next wave's town
code will rely on:

  1 manifest loads, every type's file and every palette file exist
  2 every GLB decodes in the browser (EXT_meshopt_compression through the vendored decoder) and yields > 0 triangles
  3 triangles the browser sees == manifest `tris` (+-2 %)
  4 world size the browser sees at suggested_scale == manifest bbox_m (+-max(3 cm, 1 %))
  5 POSITION arrives as Float32Array (no KHR_mesh_quantization dequantisation transform to trip InstancedMesh)
  6 0 page errors and 0 failed requests while decoding (the route answers 404 for anything not listed)
  7 colliders exist and lie inside the bbox (+0.3 m)
  INFO a contact sheet per group (colliders drawn as red wire boxes) in --shots (default: the lane scratch dir), and a palette
        variants sheet.

Never starts a server (a Playwright route serves only the listed files + the vendored three tree). Exit 0 pass / 1 fail /
2 could-not-judge (Chrome did not start, rAF/GL unavailable ...), like every gate here.

USAGE   python _harness/new/artb_decode.py [--groups suburban,commercial,...] [--tile 300]
"""
from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
H = os.path.dirname(HERE)                       # _harness
GAME = os.path.dirname(H)
sys.path.insert(0, H)
sys.path.insert(0, os.path.join(GAME, "_tools"))

from common import EnvFailure, run_gate  # noqa: E402

DEFAULT_SHOTS = os.environ.get("ARTB_SHOTS") or "C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-Claude-Claw/82f9ca33-342f-4680-86ad-98a5ab9d2079/scratchpad/lc_improve/wave4/ART-B/sheets/gate"

MANIFEST = os.path.join(GAME, "assets", "props", "city", "manifest.json")
CITY = os.path.dirname(MANIFEST)


def main_fn(v, args):
    from art_b_render import render_sheet

    if not os.path.exists(MANIFEST):
        v.check("manifest present", False, MANIFEST)
        return
    m = json.load(open(MANIFEST, encoding="utf-8"))
    types = m["types"]
    pals = m["palettes"]
    missing = [k for k, t in types.items() if not os.path.exists(os.path.join(CITY, t["file"]))]
    missing += ["palette:" + k for k, p in pals.items() if not os.path.exists(os.path.normpath(os.path.join(CITY, p["file"])))]
    v.check("manifest: every type file + palette file exists", not missing, "%d types, %d palettes%s" % (
        len(types), len(pals), "; MISSING " + ", ".join(missing[:6]) if missing else ""))
    if missing:
        return
    only = set(args.groups.split(",")) if args.groups else None
    groups = []
    for k, t in types.items():
        if t["group"] not in groups and (not only or t["group"] in only):
            groups.append(t["group"])
    shots = args.shots
    os.makedirs(shots, exist_ok=True)
    bad_decode, bad_tris, bad_bbox, bad_float, bad_err, bad_coll = [], [], [], [], [], []
    n = 0
    for grp in groups:
        items = []
        for k, t in types.items():
            if t["group"] != grp:
                continue
            pal = pals.get(t["palette"]) if t["palette"] else None
            items.append({"id": k, "glb": os.path.join(CITY, t["file"]), "scale": t["suggested_scale"],
                          "palette": os.path.normpath(os.path.join(CITY, pal["file"])) if pal else None,
                          "colliders": [[*c["min"], *c["max"]] for c in t["colliders"]], "label": k.split("/")[1].replace("building-", "")})
        out = os.path.join(shots, "artb_%s.png" % grp)
        res = render_sheet(items, out, cols=5, tile=args.tile)
        for it, r in zip(items, res):
            n += 1
            t = types[it["id"]]
            if not r.get("ok"):
                bad_decode.append("%s: %s" % (it["id"], r.get("error", "no triangles")))
                continue
            if abs(r["tris"] - t["tris"]) > max(2, 0.02 * t["tris"]):
                bad_tris.append("%s browser %d vs manifest %d" % (it["id"], r["tris"], t["tris"]))
            bb = t["bbox_m"]
            for axis, got in zip("xyz", r["size"]):
                tol = max(0.03, 0.01 * bb[axis])
                if abs(got - bb[axis]) > tol:
                    bad_bbox.append("%s %s browser %.3f vs manifest %.3f" % (it["id"], axis, got, bb[axis]))
            if "position:Float32Array" not in (r.get("attrs") or ""):
                bad_float.append("%s attrs=%s" % (it["id"], r.get("attrs")))
            if r.get("page_errors"):
                bad_err.append("%s: %s" % (it["id"], r["page_errors"][0]))
            lo, hi = t["bbox_min_m"], t["bbox_max_m"]
            cs = t["colliders"]
            inside = bool(cs) and all(all(c["min"][i] >= lo[i] - 0.3 and c["max"][i] <= hi[i] + 0.3 and c["max"][i] > c["min"][i] for i in range(3)) for c in cs)
            if not inside:
                bad_coll.append(it["id"])
        v.info("sheet %s" % grp, out)
    v.check("every GLB decodes in Chrome through the vendored meshopt decoder", not bad_decode, "%d decoded of %d%s" % (
        n - len(bad_decode), n, "; FAILED " + "; ".join(bad_decode[:4]) if bad_decode else ""))
    v.check("browser triangle count == manifest tris (+-2 %)", not bad_tris, "; ".join(bad_tris[:4]) or "all %d match" % n)
    v.check("browser bbox at suggested_scale == manifest bbox_m", not bad_bbox, "; ".join(bad_bbox[:4]) or "all %d match" % n)
    v.check("POSITION decodes as Float32Array (no quantisation transform)", not bad_float, "; ".join(bad_float[:3]) or "all float32")
    v.check("0 page errors / failed requests while decoding", not bad_err, "; ".join(bad_err[:3]) or "clean")
    v.check("colliders non-empty and inside the bbox", not bad_coll, ", ".join(bad_coll[:8]) or "all %d" % n)

    # palette variants sheet (information: the recoloured colormaps applied to the same geometry)
    vit = []
    for key in ("suburban/building-type-a", "suburban/building-type-m", "commercial/building-f", "commercial/building-m"):
        t = types.get(key)
        if not t:
            continue
        p = pals[t["palette"]]
        for name, f in [("base", p["file"])] + [(vn, vv["file"]) for vn, vv in p["variants"].items()]:
            vit.append({"id": key + ":" + name, "glb": os.path.join(CITY, t["file"]), "scale": t["suggested_scale"],
                        "palette": os.path.normpath(os.path.join(CITY, f)), "label": key.split("/")[1].replace("building-", "") + " " + name})
    if vit:
        out = os.path.join(shots, "artb_variants.png")
        res = render_sheet(vit, out, cols=4, tile=args.tile)
        v.info("palette variants sheet", "%s (%d/%d decoded)" % (out, sum(1 for r in res if r.get("ok")), len(res)))


def main():
    import argparse as ap_
    from common import add_common_args
    ap = ap_.ArgumentParser(description=__doc__, formatter_class=ap_.RawDescriptionHelpFormatter)
    add_common_args(ap)
    ap.add_argument("--groups", default=None)
    ap.add_argument("--tile", type=int, default=300)
    ap.add_argument("--shots", default=DEFAULT_SHOTS, help="where the contact sheets go (default: the lane scratch dir, never the repo)")
    args = ap.parse_args()
    return run_gate("artb_decode", lambda v: main_fn(v, args), args)


if __name__ == "__main__":
    sys.exit(main())
