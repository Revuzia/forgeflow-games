#!/usr/bin/env python
"""LOAD LANE probe — cold vs warm course load, prop attribution, program count.

Boots the page, walks keep -> verdant-1 (COLD) -> keep -> verdant-1 (WARM),
timing each `goto` off the page clock and reading, at every step:
  * renderer.info.programs.length  (the shader-permutation count)
  * props.js PROP_STATS            (buildMs / entries / placeMs / slowest)
  * a per-phase breakdown from Course.prototype wrappers (real prototypes, not
    the frozen module namespace `_loadprofile.py` tries to patch).

Prints one JSON blob so before/after runs diff cleanly.
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
STATE_JS = "globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.state"
CLICK_JS = r"""() => { for (const w of ['NEW GAME','NEW RUN','CONTINUE','PLAY','START','ENTER'])
  for (const b of document.querySelectorAll('button')) {
    const r=b.getBoundingClientRect(); if(b.disabled||r.width<4) continue;
    if((b.textContent||'').toUpperCase().indexOf(w)<0) continue;
    if(b.__activate) b.__activate(); else b.click(); return w; } return null; }"""

INSTALL_JS = r"""
async () => {
  const A = globalThis.CRESTBOUND, G = A.game, E = A.engine;
  const log = (globalThis.__lp = []);
  const now = () => performance.now();
  const wrap = (obj, name, label) => {
    if (!obj || typeof obj[name] !== 'function' || obj['__lp_' + name]) return;
    const orig = obj[name];
    obj['__lp_' + name] = orig;
    obj[name] = function (...a) {
      const t = now();
      const r = orig.apply(this, a);
      if (r && typeof r.then === 'function')
        return r.then((v) => { log.push([label, +(now() - t).toFixed(1)]); return v; },
                      (e) => { log.push([label + ' THREW', +(now() - t).toFixed(1)]); throw e; });
      log.push([label, +(now() - t).toFixed(1)]);
      return r;
    };
  };
  const CourseMod = await import(new URL('runtime/world/course.js', location.href).href);
  const CP = CourseMod.Course.prototype;
  for (const [m, lbl] of [
    ['_build', 'Course._build'], ['_buildTerrain', '  terrain'],
    ['_buildHazard', '  hazards(sum)'], ['_buildPropBatch', '  GLB props'],
    ['_buildCollectibles', '  collectibles'], ['_buildCritters', '  critters'],
    ['_mergeStatic', '  static merge'], ['warmup', '  course.warmup'],
  ]) wrap(CP, m, lbl);
  wrap(G, 'loadCourse', 'Game.loadCourse');
  wrap(G, '_applyThemeFor', 'applyTheme');
  wrap(G, '_veilOut', 'veil out');
  wrap(E, 'setTheme', 'engine.setTheme');
  wrap(E, 'setEnvironment', 'engine.setEnvironment (PMREM)');
  wrap(E, 'warmup', 'engine.warmup');
  globalThis.__PROPSMOD = await import(new URL('runtime/world/props.js', location.href).href);
  return true;
}
"""

RUN_JS = r"""
async (id) => {
  const A = globalThis.CRESTBOUND, G = A.game;
  const P = globalThis.__PROPSMOD;
  if (P && P.resetPropStats) P.resetPropStats();
  globalThis.__lp.length = 0;
  const t0 = performance.now();
  const live = () => G.course && G.courseId === id && (G.state === 'playing' || G.state === 'keep');
  await G.__dev.goto(id);
  const tick = () => new Promise(r => { let d=false; const f=()=>{if(!d){d=true;r();}};
    requestAnimationFrame(f); setTimeout(f, 40); });
  while (performance.now() < t0 + 60000 && !live()) await tick();
  const total = performance.now() - t0;
  const folded = {}, order = [];
  for (const [k, v] of globalThis.__lp) {
    if (!(k in folded)) { folded[k] = 0; order.push(k); }
    folded[k] += v;
  }
  const rows = order.map(k => [k, +folded[k].toFixed(1)]);
  const info = A.engine.renderer.info;
  return {
    total: +total.toFixed(1), rows,
    programs: info.programs ? info.programs.length : -1,
    geometries: info.memory.geometries, textures: info.memory.textures,
    props: P && P.PROP_STATS ? JSON.parse(JSON.stringify(P.PROP_STATS)) : null,
  };
}
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--course", default="verdant-1")
    ap.add_argument("--quality", default="high")
    ap.add_argument("--width", type=int, default=1920)
    ap.add_argument("--height", type=int, default=1080)
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--json", default=None)
    args = ap.parse_args()
    out = {}
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=args.headless, args=FLAGS)
        pg = br.new_page(viewport={"width": args.width, "height": args.height})
        errs = []
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append("pageerror: %s" % e))
        pg.goto("%s?dev=1&quality=%s" % (BASE, args.quality), wait_until="load", timeout=60_000)
        for _ in range(150):
            if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game)"):
                break
            pg.wait_for_timeout(400)
        for _ in range(60):
            if pg.evaluate(STATE_JS) in ("keep", "playing"):
                break
            pg.evaluate(CLICK_JS)
            pg.wait_for_timeout(400)
        pg.wait_for_timeout(1500)
        pg.evaluate(INSTALL_JS)
        out["keep_programs"] = pg.evaluate(
            "globalThis.CRESTBOUND.engine.renderer.info.programs.length")
        out["cold"] = pg.evaluate(RUN_JS, args.course)
        pg.wait_for_timeout(800)
        pg.evaluate(RUN_JS, "keep")
        pg.wait_for_timeout(800)
        out["warm"] = pg.evaluate(RUN_JS, args.course)
        out["errors"] = errs[:40]
        br.close()

    for phase in ("cold", "warm"):
        r = out[phase]
        print("=" * 74)
        print("%s LOAD — %s @ %s   total %.1f ms   (budget 1500)"
              % (phase.upper(), args.course, args.quality, r["total"]))
        for k, v in r["rows"]:
            print("  %-40s %9.1f ms" % (k, v))
        print("  programs=%s geometries=%s textures=%s"
              % (r["programs"], r["geometries"], r["textures"]))
        print("  props: %s" % json.dumps(r["props"]))
    print("keep programs (before first course): %s" % out["keep_programs"])
    print("console errors: %d %s" % (len(out["errors"]), out["errors"][:5]))
    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(out, fh, indent=1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
