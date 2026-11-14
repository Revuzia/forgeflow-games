#!/usr/bin/env python
"""Split course.warmup into its phases on a WARM load.

Replaces Course.prototype.warmup with a copy that reports, per phase, wall time
and the live program count: the resetFrom cycle, the visibility forcing, then
each of the three renders. Answers "is the warm-up compiling, uploading, or
filling?" without guessing.
"""
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
  const A = globalThis.CRESTBOUND;
  const THREE = A.THREE;
  const CourseMod = await import(new URL('runtime/world/course.js', location.href).href);
  const CP = CourseMod.Course.prototype;
  const orig = CP.warmup;
  globalThis.__ws = [];
  CP.warmup = function (renderer, camera) {
    const P = () => (renderer.info.programs ? renderer.info.programs.length : -1);
    const NAMES = () => (renderer.info.programs || []).map(x => (x.name||'?') + '#' + x.usedTimes);
    const log = globalThis.__ws;
    const now = () => performance.now();
    let t = now();
    const mark = (n) => { log.push([n, +(now() - t).toFixed(1), P()]); t = now(); };
    log.length = 0;
    log.push(['ENTER', 0, P()]);
    globalThis.__wsNamesIn = NAMES();

    const savedCp = this.cpIndex, savedClock = this.clock;
    try {
      for (let i = 0; i < this.checkpoints.length; i++) this.resetFrom(i);
      this.resetFrom(savedCp);
      this.clock = savedClock;
    } catch (e) { /* ignore */ }
    mark('resetFrom cycle');

    const saved = [];
    for (let i = 0; i < this._detailCells.length; i++) {
      const dc = this._detailCells[i];
      saved.push([dc, dc.visible, true]); dc.visible = true; dc.group.visible = true;
    }
    for (let i = 0; i < this._chunks.length; i++) {
      const ch = this._chunks[i];
      saved.push([ch, ch.visible, ch.detailVisible]);
      ch.visible = true; ch.group.visible = true; ch.detailVisible = true; ch.detail.visible = true;
    }
    const objFlags = [];
    const sceneRoot = this.group.parent || this.group;
    let objCount = 0;
    sceneRoot.traverse((o) => { objFlags.push([o, o.visible, o.frustumCulled]);
      o.visible = true; o.frustumCulled = false; objCount++; });
    const hazVis = [];
    for (let i = 0; i < this.hazards.length; i++) {
      const m = this.hazards[i].h.mesh; if (m) { hazVis.push([m, m.visible]); m.visible = true; }
    }
    mark('force visible (' + objCount + ' objects)');

    let warmRT = null;
    try {
      const scene = this.group.parent || this.group;
      const b = this.bounds;
      const warmCam = new THREE.PerspectiveCamera(110, 1.78, 0.1, 4000);
      warmCam.layers.enableAll();
      if (b && isFinite(b.min.x)) {
        const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
        const spanX = b.max.x - b.min.x, spanZ = b.max.z - b.min.z;
        const hh = Math.max(spanX, spanZ) * 0.42 + (b.max.y - b.min.y) + 20;
        warmCam.position.set(cx, b.max.y + hh, cz);
        warmCam.lookAt(cx, b.min.y, cz);
      } else if (camera) warmCam.copy(camera);
      warmCam.updateMatrixWorld(true);
      warmRT = new THREE.WebGLRenderTarget(64, 64, { type: THREE.HalfFloatType });
      const prevRT = renderer.getRenderTarget();
      renderer.setRenderTarget(warmRT);
      mark('rt setup');
      renderer.render(scene, warmCam); mark('render 1 (wide cam)');
      renderer.render(scene, warmCam); mark('render 2 (wide cam)');
      if (camera) { renderer.render(scene, camera); mark('render 3 (player cam)'); }
      renderer.setRenderTarget(prevRT);
    } catch (e) { log.push(['THREW ' + e, 0, P()]); }
    if (warmRT) { try { warmRT.dispose(); } catch (e) {} }

    for (let i = 0; i < objFlags.length; i++) {
      objFlags[i][0].visible = objFlags[i][1]; objFlags[i][0].frustumCulled = objFlags[i][2];
    }
    for (let i = 0; i < hazVis.length; i++) hazVis[i][0].visible = hazVis[i][1];
    for (let i = 0; i < saved.length; i++) {
      const s = saved[i];
      if (s[0].group !== undefined && s[0].detail !== undefined) {
        s[0].visible = s[1]; s[0].group.visible = s[1];
        s[0].detailVisible = s[2]; s[0].detail.visible = s[2];
      } else { s[0].visible = s[1]; if (s[0].group) s[0].group.visible = s[1]; }
    }
    mark('restore');
    globalThis.__wsNamesOut = NAMES();
    return undefined;
  };
  return true;
}
"""

GOTO = r"""
async (id) => {
  const G = globalThis.CRESTBOUND.game;
  const R = globalThis.CRESTBOUND.engine.renderer;
  globalThis.__wsPrev = (R.info.programs || []).map(x => (x.name||'?') + '#' + x.usedTimes);
  const t0 = performance.now();
  await G.__dev.goto(id);
  const live = () => G.course && G.courseId === id && (G.state === 'playing' || G.state === 'keep');
  const tick = () => new Promise(r => { let d=false; const f=()=>{if(!d){d=true;r();}};
    requestAnimationFrame(f); setTimeout(f, 40); });
  while (performance.now() < t0 + 60000 && !live()) await tick();
  return {total: +(performance.now()-t0).toFixed(1), ws: globalThis.__ws.slice(),
          nin: globalThis.__wsNamesIn || [], nout: globalThis.__wsNamesOut || [],
          nbefore: globalThis.__wsPrev || []};
}
"""


def show(tag, r):
    print("=== %s  load total %.1f ms" % (tag, r["total"]))
    for n, ms, p in r["ws"]:
        print("    %-32s %8.1f ms   programs=%d" % (n, ms, p))
    import collections
    def bag(l):
        c = collections.Counter(x.split('#')[0] for x in l)
        return c
    b0, b1, b2 = bag(r["nbefore"]), bag(r["nin"]), bag(r["nout"])
    lost = {k: b0[k] - b1.get(k, 0) for k in b0 if b0[k] > b1.get(k, 0)}
    made = {k: b2[k] - b1.get(k, 0) for k in b2 if b2[k] > b1.get(k, 0)}
    print("    DIED during load : %s" % sorted(lost.items(), key=lambda kv: -kv[1])[:24])
    print("    BORN in warmup   : %s" % sorted(made.items(), key=lambda kv: -kv[1])[:24])


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
        show("COLD verdant-1", pg.evaluate(GOTO, "verdant-1"))
        pg.evaluate(GOTO, "keep")
        show("WARM verdant-1", pg.evaluate(GOTO, "verdant-1"))
        pg.evaluate(GOTO, "keep")
        show("WARM#2 verdant-1", pg.evaluate(GOTO, "verdant-1"))
        br.close()


main()
