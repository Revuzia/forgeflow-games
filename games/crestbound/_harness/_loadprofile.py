#!/usr/bin/env python
"""Where do CRESTBOUND's 6 seconds of course load go?

The perf gate budgets 1500 ms for a course load and both courses measure
around 6000. This wraps the phases a load actually runs through -- the veil
transition, the course-def import, teardown, theme + PMREM bake, Course._build
(and inside it terrain, hazards, static art, GLB props, collectibles, critters,
the static merge), then the shader warm-up -- and prints each one's wall time
for one goto.
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

# Wrap everything the load path calls, then run one goto and read the log back.
INSTALL_JS = r"""
async () => {
  const A = globalThis.CRESTBOUND, G = A.game, E = A.engine;
  const log = (globalThis.__lp = []);
  const now = () => performance.now();

  const wrapSync = (obj, name, label) => {
    if (!obj || typeof obj[name] !== 'function' || obj['__lp_' + name]) return;
    const orig = obj[name];
    obj['__lp_' + name] = orig;
    obj[name] = function (...a) {
      const t = now();
      const r = orig.apply(this, a);
      if (r && typeof r.then === 'function') {
        return r.then((v) => { log.push([label, +(now() - t).toFixed(1)]); return v; },
                      (e) => { log.push([label + ' (threw)', +(now() - t).toFixed(1)]); throw e; });
      }
      log.push([label, +(now() - t).toFixed(1)]);
      return r;
    };
  };

  const CourseMod = await import(new URL('runtime/world/course.js', location.href).href);
  const Course = CourseMod.Course;
  const CP = Course.prototype;
  for (const [m, lbl] of [
    ['_build', 'Course._build TOTAL'],
    ['_buildTerrain', '  terrain'],
    ['_buildWater', '  water'],
    ['_buildHazard', '  hazards'],
    ['_buildStatic', '  static art'],
    ['_buildPropBatch', '  GLB props'],
    ['_buildCheckpoints', '  checkpoints'],
    ['_buildGates', '  gates'],
    ['_buildCollectibles', '  collectibles'],
    ['_buildCritters', '  critters'],
    ['_buildLightPool', '  light pool'],
    ['_buildGlowField', '  glow field'],
    ['_mergeStatic', '  static merge'],
    ['_disposeMergeSources', '  dispose merge sources'],
    ['_pruneShadowCasters', '  prune shadow casters'],
    ['warmup', '  course.warmup (shader compile)'],
  ]) wrapSync(CP, m, lbl);

  wrapSync(G, 'loadCourse', 'Game.loadCourse TOTAL');
  wrapSync(G, '_disposeCourse', 'dispose old course');
  wrapSync(G, '_applyThemeFor', 'applyTheme');
  wrapSync(G, '_veilOut', 'veil out (transition wait)');
  wrapSync(G, '_ensureActors', 'ensure actors');
  wrapSync(E, 'setTheme', 'engine.setTheme');
  wrapSync(E, 'setEnvironment', 'engine.setEnvironment (PMREM bake)');
  wrapSync(E, 'warmup', 'engine.warmup');

  const PropsMod = await import(new URL('runtime/world/props.js', location.href).href);
  wrapSync(PropsMod, 'loadProps', '    props: loadProps (library build)');
  wrapSync(PropsMod, 'placeProps', '    props: placeProps (instancing)');
  wrapSync(PropsMod, 'proceduralLibrary', '    props: proceduralLibrary');

  const MatsMod = await import(new URL('runtime/world/materials.js', location.href).href);
  if (MatsMod.Mats) {
    wrapSync(MatsMod.Mats, 'init', 'Mats.init (texture bakes)');
    wrapSync(MatsMod.Mats, 'setTheme', 'Mats.setTheme');
    wrapSync(MatsMod.Mats, 'get', '  Mats.get');
  }
  return true;
}
"""

RUN_JS = r"""
async (id) => {
  const G = globalThis.CRESTBOUND.game;
  globalThis.__lp.length = 0;
  const t0 = performance.now();
  const live = () => G.course && G.courseId === id && (G.state === 'playing' || G.state === 'keep');
  await G.__dev.goto(id);
  const tick = () => new Promise(r => { let d=false; const f=()=>{if(!d){d=true;r();}};
    requestAnimationFrame(f); setTimeout(f, 40); });
  while (performance.now() < t0 + 40000 && !live()) await tick();
  const total = performance.now() - t0;
  /* Mats.get is called hundreds of times; fold it into one row */
  const rows = [], folded = {};
  for (const [k, v] of globalThis.__lp) {
    if (k === '  Mats.get') { folded[k] = (folded[k] || 0) + v; continue; }
    rows.push([k, v]);
  }
  for (const k in folded) rows.push([k + ' (summed)', +folded[k].toFixed(1)]);
  return {total: +total.toFixed(1), rows: rows};
}
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--course", default="verdant-1")
    ap.add_argument("--quality", default="high")
    ap.add_argument("--width", type=int, default=1920)
    ap.add_argument("--height", type=int, default=1080)
    ap.add_argument("--headless", action="store_true")
    args = ap.parse_args()
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=args.headless, args=FLAGS)
        pg = br.new_page(viewport={"width": args.width, "height": args.height})
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
        pg.wait_for_timeout(1200)
        pg.evaluate(INSTALL_JS)
        r = pg.evaluate(RUN_JS, args.course)
        print("=" * 74)
        print("LOAD PROFILE — %s @ quality %s   (budget 1500 ms)" % (args.course, args.quality))
        print("goto -> live state: %.1f ms" % r["total"])
        print("-" * 74)
        for k, v in r["rows"]:
            print("  %-46s %9.1f ms" % (k, v))
        print("=" * 74)
        br.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
