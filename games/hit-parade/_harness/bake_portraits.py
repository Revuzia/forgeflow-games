#!/usr/bin/env python
"""HIT PARADE - bake the fighter portraits (CHANGED(wf6 fixer) D8, CONTRACT §35.26).

The menus / HUD show each fighter's portrait (app/portraits.ts). Rendering all 12 at runtime (one GLB load + toon render each)
left character select on initials badges for seconds; the shipped set in runtime/public/portraits/ is handed to the UI at boot
(PortraitQueue.useBaked) and the runtime only re-renders where the screen needs more pixels than BAKE size.

This renders them with the game's OWN Showcase.portrait (window.__HP_PORTRAIT__, a dev-only hook in main.ts) in the real page,
so a baked portrait is pixel-identical to a runtime one, and writes <id>.webp + index.json ({size, ext, ids, built, src: per
fighter GLB bytes / mtime}). Re-bake after any fighter GLB change; `--check` exits 1 when a portrait is missing or older than
its GLB (run it in the gates).

usage: python _harness/bake_portraits.py --base http://localhost:5337/ [--size 1024]     (a dev server must be up)
       python _harness/bake_portraits.py --check
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "runtime", "public", "portraits")
GLB = os.path.join(ROOT, "art", "gltf", "fighters")
DATA = os.path.join(ROOT, "data", "fighters")


def roster() -> list[str]:
    ids = []
    for f in sorted(os.listdir(DATA)):
        if not f.endswith(".json"):
            continue
        try:
            d = json.load(open(os.path.join(DATA, f), encoding="utf-8"))
        except Exception:
            continue
        if isinstance(d, dict) and d.get("moves"):
            ids.append(f[:-5])
    return ids


def glb_facts(fid: str) -> dict:
    p = os.path.join(GLB, fid + ".glb")
    if not os.path.exists(p):
        return {"glb": None}
    st = os.stat(p)
    return {"glb": "art/gltf/fighters/%s.glb" % fid, "bytes": st.st_size, "mtime": round(st.st_mtime, 3)}


def check() -> int:
    ix_p = os.path.join(OUT, "index.json")
    if not os.path.exists(ix_p):
        print("[portraits] FAIL: no runtime/public/portraits/index.json")
        return 1
    ix = json.load(open(ix_p, encoding="utf-8"))
    bad = []
    for fid in roster():
        img = os.path.join(OUT, "%s.%s" % (fid, ix.get("ext", "webp")))
        if fid not in ix.get("ids", []) or not os.path.exists(img):
            bad.append("%s: not baked" % fid)
            continue
        now, then = glb_facts(fid), (ix.get("src") or {}).get(fid) or {}
        if now.get("bytes") != then.get("bytes") or (now.get("mtime") or 0) > (then.get("mtime") or 0) + 1:
            bad.append("%s: GLB changed after the bake (%s -> %s)" % (fid, then, now))
    print("[portraits] %s: %d fighters, size %s%s" % ("PASS" if not bad else "FAIL", len(roster()), ix.get("size"), ("; " + "; ".join(bad)) if bad else ""))
    return 0 if not bad else 1


def bake(base: str, size: int) -> int:
    from playwright.sync_api import sync_playwright
    os.makedirs(OUT, exist_ok=True)
    ids = roster()
    out = {"size": size, "ext": "webp", "ids": [], "built": time.strftime("%Y-%m-%dT%H:%M:%S"), "src": {}, "bytes": {}}
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chrome", headless=True)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.goto(base.rstrip("/") + "/?dev=1", wait_until="load", timeout=180000)
        pg.wait_for_function("() => typeof window.__HP_PORTRAIT__ === 'function'", timeout=180000)
        for fid in ids:
            url = pg.evaluate("async ([id, n]) => await window.__HP_PORTRAIT__(id, n)", [fid, size])
            if not url or not url.startswith("data:image/webp;base64,"):
                print("[portraits] %s: no webp (%s)" % (fid, (url or "null")[:40]))
                continue
            raw = base64.b64decode(url.split(",", 1)[1])
            with open(os.path.join(OUT, fid + ".webp"), "wb") as fh:
                fh.write(raw)
            out["ids"].append(fid)
            out["src"][fid] = glb_facts(fid)
            out["bytes"][fid] = len(raw)
            print("[portraits] %-9s %7d B" % (fid, len(raw)))
        br.close()
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, indent=1)
    total = sum(out["bytes"].values())
    print("[portraits] baked %d / %d at %d px, %d B total -> runtime/public/portraits/" % (len(out["ids"]), len(ids), size, total))
    return 0 if len(out["ids"]) == len(ids) else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5337/")
    ap.add_argument("--size", type=int, default=1024)
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    return check() if a.check else bake(a.base, a.size)


if __name__ == "__main__":
    sys.exit(main())
