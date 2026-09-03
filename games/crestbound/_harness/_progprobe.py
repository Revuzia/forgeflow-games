#!/usr/bin/env python
"""Dump three.js's program cache after a course load: what forks a permutation?

Prints every WebGLProgram's name + usedTimes, then groups programs by shader
name so a generator that forks one program per object is obvious, and diffs the
cache keys inside each group to name the axis that differs.
"""
import argparse
import json
import sys
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

FLAGS = ["--disable-gpu-vsync", "--disable-frame-rate-limit", "--ignore-gpu-blocklist",
         "--use-angle=d3d11", "--disable-gpu-sandbox", "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]
BASE = "http://localhost:8788/games/crestbound/index.html"
CLICK_JS = r"""() => { for (const w of ['NEW GAME','NEW RUN','CONTINUE','PLAY','START','ENTER'])
  for (const b of document.querySelectorAll('button')) {
    const r=b.getBoundingClientRect(); if(b.disabled||r.width<4) continue;
    if((b.textContent||'').toUpperCase().indexOf(w)<0) continue;
    if(b.__activate) b.__activate(); else b.click(); return w; } return null; }"""

DUMP = r"""
() => {
  const E = globalThis.CRESTBOUND.engine;
  const ps = E.renderer.info.programs || [];
  const rows = ps.map(p => ({name: p.name, used: p.usedTimes, key: String(p.cacheKey || '')}));
  /* material census across the live scene */
  const mats = new Map(), byType = {};
  E.scene.traverse(o => {
    const m = o.material; if (!m) return;
    const list = Array.isArray(m) ? m : [m];
    for (const x of list) {
      if (!x) continue;
      mats.set(x.uuid, x);
      const k = (x.type || '?') + '|' + (x.name || '');
      byType[k] = (byType[k] || 0) + 1;
    }
  });
  return {programs: rows, matCount: mats.size, byType};
}
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--course", default="verdant-1")
    ap.add_argument("--json", default=None)
    args = ap.parse_args()
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
        pg = br.new_page(viewport={"width": 1920, "height": 1080})
        pg.goto(BASE + "?dev=1&quality=high", wait_until="load", timeout=60_000)
        for _ in range(150):
            if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game)"):
                break
            pg.wait_for_timeout(400)
        for _ in range(60):
            if pg.evaluate("CRESTBOUND.game.state") in ("keep", "playing"):
                break
            pg.evaluate(CLICK_JS)
            pg.wait_for_timeout(400)
        pg.wait_for_timeout(1500)
        pg.evaluate("(id)=>CRESTBOUND.game.__dev.goto(id)", args.course)
        pg.wait_for_timeout(9000)
        d = pg.evaluate(DUMP)
        br.close()

    rows = d["programs"]
    print("programs: %d   live materials: %d" % (len(rows), d["matCount"]))
    groups = {}
    for r in rows:
        groups.setdefault(r["name"], []).append(r)
    print("\n-- by shader name --")
    for name, g in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        print("  %-34s x%-3d used=%s" % (name, len(g), [x["used"] for x in g][:12]))
    print("\n-- differing key fields inside multi-program groups --")
    for name, g in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        if len(g) < 2:
            continue
        keys = [x["key"].split(",") for x in g]
        n = min(len(k) for k in keys)
        diffs = [i for i in range(n) if len({k[i] for k in keys}) > 1]
        print("  %s  x%d  fields differing at idx %s" % (name, len(g), diffs[:20]))
        for i in diffs[:14]:
            print("      [%d] %s" % (i, sorted({k[i] for k in keys})[:8]))
        if len({len(k) for k in keys}) > 1:
            print("      (key lengths differ: %s)" % sorted({len(k) for k in keys}))
    print("\n-- material census (type|name -> mesh count) --")
    for k, v in sorted(d["byType"].items(), key=lambda kv: -kv[1])[:60]:
        print("  %-52s %d" % (k, v))
    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(d, fh, indent=1)


main()
