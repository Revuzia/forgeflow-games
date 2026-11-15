#!/usr/bin/env python
"""Decisive split: how much of a CRESTBOUND frame is CPU (game loop) and how
much is GPU (render)?

Two instruments disagreed:
  * an offscreen `composer.render()` batch, GPU-synced with readPixels, timed
    ~2-3 ms per render;
  * the live rAF interval measured 45-60 ms.

Both cannot be right about the same frame. This probe wraps the engine's own
loop callbacks with performance.now() brackets and, where the extension is
available, an EXT_disjoint_timer_query_webgl2 around the render, so the frame
is split into named CPU phases plus real GPU nanoseconds.
"""
import argparse
import json
import sys
import time

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

FLAGS = ["--disable-gpu-vsync", "--disable-frame-rate-limit",
         "--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]
BASE = "http://localhost:8788/games/crestbound/index.html"
STATE_JS = "globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.state"

CLICK_JS = r"""() => {
  const words = ['NEW GAME','NEW RUN','CONTINUE','PLAY','START','BEGIN','ENTER'];
  const btns = Array.from(document.querySelectorAll('button.cb-btn, button, [role=button], .btn'));
  for (const w of words) for (const b of btns) {
    const r = b.getBoundingClientRect();
    if (b.disabled || r.width < 4) continue;
    if ((b.textContent||'').toUpperCase().indexOf(w) < 0) continue;
    if (b.__activate) b.__activate(); else b.click(); return w; }
  return null; }"""

LOAD_JS = r"""
async (id) => {
  const G = globalThis.CRESTBOUND && CRESTBOUND.game;
  const t0 = performance.now();
  const live = () => G.course && G.courseId === id && (G.state==='playing'||G.state==='keep');
  await G.__dev.goto(id);
  const tick = () => new Promise(r => { let d=false; const f=()=>{if(!d){d=true;r();}};
    requestAnimationFrame(f); setTimeout(f,60); });
  while (performance.now() < t0+40000 && !live()) await tick();
  return {ok: live(), loadMs: +(performance.now()-t0).toFixed(1)};
}
"""

STATION_JS = r"""
(name) => {
  const A = globalThis.CRESTBOUND, G = A.game, C = G.course, THREE = A.THREE;
  const posOf = o => { if(!o) return null; if(typeof o.x==='number') return o;
    if(o.pos) return posOf(o.pos);
    if(o.p) return Array.isArray(o.p)?{x:o.p[0],y:o.p[1],z:o.p[2]}:posOf(o.p);
    if(o.position) return posOf(o.position); return null; };
  let p = name==='spawn' ? posOf((C.spawnFor?C.spawnFor(0):{}).pos)
        : posOf((C.checkpoints||[])[parseInt(name.replace(/\D/g,''),10)-1]);
  if (!p) return {error:'no station'};
  const P = G.player;
  if (P && P.__test) { P.__test.teleport(new THREE.Vector3(p.x,p.y+0.6,p.z));
                       P.__test.setVel(new THREE.Vector3(0,0,0)); }
  return {p:[+p.x.toFixed(1),+p.y.toFixed(1),+p.z.toFixed(1)]};
}
"""

# Wrap engine.render so the CPU cost of the composer call is separated from the
# rest of the game loop, and put a GPU timer query around it when available.
INSTALL_JS = r"""
() => {
  const A = globalThis.CRESTBOUND, E = A.engine, R = E.renderer;
  const gl = R.getContext();
  const W = (globalThis.__cp = {samples: [], gpu: [], n: 0});
  W.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2')
       || gl.getExtension('EXT_disjoint_timer_query');
  W.origRender = E.render.bind(E);
  W.pending = [];
  E.render = function (dt) {
    let q = null;
    if (W.ext && W.pending.length < 4) {
      try { q = gl.createQuery(); gl.beginQuery(W.ext.TIME_ELAPSED_EXT, q); }
      catch (e) { q = null; }
    }
    const t0 = performance.now();
    const r = W.origRender(dt);
    const t1 = performance.now();
    if (q) { try { gl.endQuery(W.ext.TIME_ELAPSED_EXT); W.pending.push(q); }
             catch (e) { /* nested query */ } }
    W.renderCpu = t1 - t0;
    /* drain finished queries */
    for (let i = W.pending.length - 1; i >= 0; i--) {
      const p = W.pending[i];
      if (gl.getQueryParameter(p, gl.QUERY_RESULT_AVAILABLE)) {
        const disjoint = gl.getParameter(W.ext.GPU_DISJOINT_EXT);
        if (!disjoint) W.gpu.push(gl.getQueryParameter(p, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(p); W.pending.splice(i, 1);
      }
    }
    return r;
  };
  W.cb = (dt) => {
    const now = performance.now();
    if (W.last !== undefined) W.samples.push({
      interval: now - W.last, frameMs: E.stats.frameMs, renderMs: E.stats.renderMs,
      renderCpu: W.renderCpu, draws: E.stats.drawCalls, tris: E.stats.tris});
    W.last = now;
  };
  E.onFrame(W.cb);
  return {timerQuery: !!W.ext};
}
"""

COLLECT_JS = r"""
async (n) => {
  const W = globalThis.__cp;
  W.samples.length = 0; W.gpu.length = 0; W.last = undefined;
  const f = () => new Promise(r => requestAnimationFrame(r));
  for (let i = 0; i < 20; i++) await f();
  W.samples.length = 0; W.gpu.length = 0;
  while (W.samples.length < n) await f();
  const med = (a) => { if (!a.length) return null;
    const b = a.slice().sort((x, y) => x - y); return +b[b.length >> 1].toFixed(2); };
  const s = W.samples;
  return {
    n: s.length,
    interval: med(s.map(x => x.interval)),
    frameMsCpu: med(s.map(x => x.frameMs)),
    renderCpuMs: med(s.map(x => x.renderCpu)),
    gpuMs: med(W.gpu), gpuN: W.gpu.length,
    draws: med(s.map(x => x.draws)), tris: med(s.map(x => x.tris)),
  };
}
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--course", default="keep")
    ap.add_argument("--station", default="cp3")
    ap.add_argument("--quality", default="high")
    ap.add_argument("--width", type=int, default=1920)
    ap.add_argument("--height", type=int, default=1080)
    ap.add_argument("--frames", type=int, default=90)
    args = ap.parse_args()

    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
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
        print("load:", pg.evaluate(LOAD_JS, args.course))
        print("station:", pg.evaluate(STATION_JS, args.station))
        pg.wait_for_timeout(1200)
        print("instrument:", pg.evaluate(INSTALL_JS))
        r = pg.evaluate(COLLECT_JS, args.frames)
        print("-" * 78)
        print("course %s station %s @ %dx%d quality %s"
              % (args.course, args.station, args.width, args.height, args.quality))
        print("  rAF interval (wall)      %8.2f ms  -> %.1f fps" % (r["interval"], 1000 / r["interval"]))
        print("  engine CPU per tick      %8.2f ms  (callbacks + game loop + render call)"
              % r["frameMsCpu"])
        print("  engine.render CPU only   %8.2f ms" % (r["renderCpu" + "Ms"]))
        if r["gpuMs"] is not None:
            print("  GPU time (timer query)   %8.2f ms  (%d samples)" % (r["gpuMs"], r["gpuN"]))
        else:
            print("  GPU time                    n/a  (no timer query extension)")
        print("  draws %s  tris %s" % (r["draws"], r["tris"]))
        gap = r["interval"] - r["frameMsCpu"]
        print("  unaccounted (GPU wait / present / compositor): %.2f ms" % gap)
        print("-" * 78)
        br.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
