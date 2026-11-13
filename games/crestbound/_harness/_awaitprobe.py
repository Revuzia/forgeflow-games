#!/usr/bin/env python
"""What actually happens during the cold load's single await?

Wraps Course.prototype._buildPropBatch and samples renderer.info.programs +
a frame counter around it, so the 4.3 s attributed to "GLB props" is split into
(fetch) / (frames rendered while awaiting, i.e. shader compiles) / (prop build).
"""
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

INSTALL = r"""
async () => {
  const A = globalThis.CRESTBOUND, E = A.engine;
  const marks = (globalThis.__mk = []);
  const now = () => performance.now();
  const progs = () => E.renderer.info.programs ? E.renderer.info.programs.length : -1;

  /* count engine renders + their duration */
  const st = (globalThis.__rs = {frames: 0, ms: 0});
  const origRender = E.render.bind(E);
  E.render = (dt) => { const t = now(); origRender(dt); st.frames++; st.ms += now() - t; };

  const CourseMod = await import(new URL('runtime/world/course.js', location.href).href);
  const CP = CourseMod.Course.prototype;
  const orig = CP._buildPropBatch;
  CP._buildPropBatch = async function (...a) {
    marks.push(['propbatch ENTER', +now().toFixed(1), progs(), st.frames, +st.ms.toFixed(1)]);
    const r = await orig.apply(this, a);
    marks.push(['propbatch EXIT', +now().toFixed(1), progs(), st.frames, +st.ms.toFixed(1)]);
    return r;
  };
  const origWarm = CP.warmup;
  CP.warmup = function (...a) {
    marks.push(['warmup ENTER', +now().toFixed(1), progs(), st.frames, +st.ms.toFixed(1)]);
    const r = origWarm.apply(this, a);
    marks.push(['warmup EXIT', +now().toFixed(1), progs(), st.frames, +st.ms.toFixed(1)]);
    return r;
  };
  const G = A.game;
  const origLoad = G.loadCourse.bind(G);
  G.loadCourse = async (...a) => {
    marks.length = 0; st.frames = 0; st.ms = 0;
    marks.push(['loadCourse ENTER', +now().toFixed(1), progs(), st.frames, 0]);
    const r = await origLoad(...a);
    marks.push(['loadCourse EXIT', +now().toFixed(1), progs(), st.frames, +st.ms.toFixed(1)]);
    return r;
  };
  const EW = E.warmup.bind(E);
  E.warmup = async (...a) => {
    marks.push(['engine.warmup ENTER', +now().toFixed(1), progs(), st.frames, +st.ms.toFixed(1)]);
    const r = await EW(...a);
    marks.push(['engine.warmup EXIT', +now().toFixed(1), progs(), st.frames, +st.ms.toFixed(1)]);
    return r;
  };
  return true;
}
"""

RUN = r"""
async (id) => {
  const G = globalThis.CRESTBOUND.game;
  const t0 = performance.now();
  await G.__dev.goto(id);
  const live = () => G.course && G.courseId === id && (G.state === 'playing' || G.state === 'keep');
  const tick = () => new Promise(r => requestAnimationFrame(r));
  while (performance.now() < t0 + 60000 && !live()) await tick();
  return {total: +(performance.now()-t0).toFixed(1), marks: globalThis.__mk.slice()};
}
"""


def show(tag, r):
    print("=== %s  total %.1f ms" % (tag, r["total"]))
    print("   %-22s %10s %6s %7s %9s" % ("mark", "t(ms)", "progs", "frames", "renderMs"))
    base = r["marks"][0][1] if r["marks"] else 0
    for m in r["marks"]:
        print("   %-22s %10.1f %6d %7d %9.1f" % (m[0], m[1] - base, m[2], m[3], m[4]))


def main():
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
        pg.evaluate(INSTALL)
        show("COLD verdant-1", pg.evaluate(RUN, "verdant-1"))
        pg.wait_for_timeout(600)
        pg.evaluate(RUN, "keep")
        pg.wait_for_timeout(600)
        show("WARM verdant-1", pg.evaluate(RUN, "verdant-1"))
        br.close()


main()
