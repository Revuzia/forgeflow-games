#!/usr/bin/env python
"""FPS / draws / triangles for every realm x quality preset, empty and under load.

"High FPS on WEB" was an explicit requirement, and the only honest way to report
it is a full cross of the two things that move it: which realm is resident (the
realm changes the sky bake, the weather population and the ground shader's
branch) and which preset is applied (`SNOWFLOW.applyPreset` / `PRESETS`). Two
load points per cell: an empty field, and 24 spawned units with the weather live.

Frame timing is taken from `requestAnimationFrame` deltas inside the page rather
than from wall clock outside it, so Playwright's own round-trips do not land in
the measurement. The first WARMUP frames of every cell are discarded: a preset
change reallocates render targets and a realm change re-bakes, and both produce a
hitch that has nothing to do with steady-state cost. The MEDIAN is reported next
to the mean because one 400 ms bake spike drags a mean and leaves a median alone;
p95 frame time is what a player actually feels as a stutter.

    python _harness/qa_perf.py
    python _harness/qa_perf.py --sample 150 --presets ultra,high,balanced
"""
import argparse
import statistics
import sys

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

READY = """() => {
  const SF = globalThis.SNOWFLOW;
  if (!SF || !SF.enterRealm || !SF.applyPreset || !SF.PRESETS) return false;
  const b = document.getElementById('boot');
  return !(b && !b.classList.contains('gone'));
}"""

# A rAF-driven ring of frame deltas, installed once. Reading it costs one
# evaluate per cell instead of one per frame.
METER = """() => {
  window.__dt = [];
  let last = performance.now();
  (function tick(){
    const n = performance.now();
    window.__dt.push(n - last);
    if (window.__dt.length > 4000) window.__dt.shift();
    last = n;
    requestAnimationFrame(tick);
  })();
}"""

SPAWN = """(n) => {
  const SF = globalThis.SNOWFLOW, E = SF.combat.enemies, C = SF.character;
  const units = E.units || [];
  let ok = 0;
  for (let i = 0; i < n; i++) {
    const u = units[i % units.length];
    const a = (i / n) * Math.PI * 2;
    const r = 10 + (i % 3) * 4;
    if (E.spawn(u.slug || u.key, C.position.x + Math.sin(a) * r,
                C.position.z - Math.cos(a) * r, 10) >= 0) ok++;
  }
  return { ok, alive: E.aliveCount };
}"""

# NOT `E.clear()`. That entry point CRASHES on this build: enemies.js declares
# BOLT_MAX = 32 (:62) while meshEnemies.js declares BOLT_MAX = 16 (:202), so
# clear()'s bolt loop (enemies.js:859-862) calls vis.driveBolt(16..31) and
# meshEnemies.driveBolt (:1284-1286) dereferences this._boltMeshes[b], which is
# only 16 long ->
#     TypeError: Cannot set properties of undefined (setting 'visible')
# Reproduced this run. This despawns by hand and stays inside the 16 bolt meshes
# that actually exist, so the perf cross can be measured despite the defect.
CLEAR = """() => {
  const E = globalThis.SNOWFLOW.combat.enemies;
  const nBolt = (E.vis && E.vis._boltMeshes) ? E.vis._boltMeshes.length : 0;
  for (let i = 0; i < E.alive.length; i++) {
    if (!E.alive[i]) continue;
    if (E.registry && E.id[i] >= 0) E.registry.remove(E.id[i]);
    if (E.vis) E.vis.free(i);
    E.alive[i] = 0; E.id[i] = -1;
  }
  for (let b = 0; b < E.boltAlive.length; b++) {
    E.boltAlive[b] = 0;
    if (E.vis && b < nBolt) E.vis.driveBolt(b, 0, 0, 0, false);
  }
  return E.aliveCount;
}"""

STATS = """() => {
  const SF = globalThis.SNOWFLOW, p = SF.perfStats || {};
  return { draws: p.drawCalls, tris: p.triangles,
           alive: SF.combat.enemies.aliveCount,
           weather: SF.weather ? (SF.weather.liveCount != null ? SF.weather.liveCount
                                                               : SF.weather.count) : null,
           scale: SF.S.resolutionScale,
           w: document.getElementById('view').width,
           h: document.getElementById('view').height };
}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8788/games/driftwake/index.html")
    ap.add_argument("--presets", default="ultra,high,balanced,performance")
    ap.add_argument("--realms", default="cold,sand,ash")
    ap.add_argument("--sample", type=int, default=120, help="frames measured per cell")
    ap.add_argument("--warmup", type=int, default=60, help="frames discarded per cell")
    ap.add_argument("--enemies", type=int, default=24)
    args = ap.parse_args()

    presets = [s for s in args.presets.split(",") if s]
    realms = [s for s in args.realms.split(",") if s]
    rows, errors = [], []

    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        pg.on("console", lambda m: errors.append(f"console.error: {m.text}")
              if m.type == "error" else None)
        pg.add_init_script(
            "window.__f=0;(function t(){window.__f++;requestAnimationFrame(t);})();")
        pg.goto(args.url + "?v=qaperf", wait_until="load", timeout=90_000)
        pg.wait_for_function(READY, timeout=200_000)
        # Name the GPU in the report. An FPS table without the renderer string is
        # unattributable -- the same build is a different game on an iGPU.
        gpu = pg.evaluate("""() => {
          const c = document.createElement('canvas');
          const gl = c.getContext('webgl2') || c.getContext('webgl');
          if (!gl) return 'no webgl';
          const d = gl.getExtension('WEBGL_debug_renderer_info');
          return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL)
                   : gl.getParameter(gl.RENDERER);
        }""")
        print(f"GPU  {gpu}")
        have = pg.evaluate("() => Object.keys(globalThis.SNOWFLOW.PRESETS)")
        missing = [x for x in presets if x not in have]
        if missing:
            print(f"NOTE presets not in build, skipped: {missing}  (build has {have})")
            presets = [x for x in presets if x in have]
        pg.evaluate(METER)

        def frames(n):
            s = pg.evaluate("() => window.__f")
            pg.wait_for_function("(s) => window.__f > s + %d" % n, arg=s, timeout=120_000)

        def cell(realm, preset, load):
            pg.evaluate("() => { window.__dt.length = 0; }")
            frames(args.warmup)
            pg.evaluate("() => { window.__dt.length = 0; }")
            frames(args.sample)
            dt = pg.evaluate("() => window.__dt.slice()")
            st = pg.evaluate(STATS)
            dt = [d for d in dt if d > 0.05][:args.sample]
            if not dt:
                return
            dt_sorted = sorted(dt)
            rows.append(dict(
                realm=realm, preset=preset, load=load,
                fps_mean=1000.0 / statistics.fmean(dt),
                fps_med=1000.0 / statistics.median(dt),
                p95_ms=dt_sorted[min(len(dt_sorted) - 1, int(len(dt_sorted) * 0.95))],
                draws=st["draws"], tris=st["tris"], alive=st["alive"],
                weather=st["weather"], res=f"{st['w']}x{st['h']}", n=len(dt)))

        frames(60)
        for realm in realms:
            if realm != realms[0]:
                pg.evaluate("(r) => globalThis.SNOWFLOW.enterRealm(r)", realm)
                frames(150)
            for preset in presets:
                pg.evaluate("(p) => globalThis.SNOWFLOW.applyPreset(p)", preset)
                frames(60)
                pg.evaluate(CLEAR)
                frames(30)
                cell(realm, preset, "empty")
                sp = pg.evaluate(SPAWN, args.enemies)
                frames(60)
                cell(realm, preset, f"{args.enemies}en")
                pg.evaluate(CLEAR)
                frames(20)
        pg.screenshot(path="_shots/qa_perf_last.png")
        br.close()

    print(f"\n{'realm':<6}{'preset':<12}{'load':<8}{'res':<11}"
          f"{'FPS mean':>9}{'FPS med':>9}{'p95 ms':>8}{'draws':>7}{'tris':>10}"
          f"{'alive':>6}{'wx':>6}")
    for r in rows:
        flag = "  <-- BELOW 60" if r["fps_med"] < 60 else ""
        print(f"{r['realm']:<6}{r['preset']:<12}{r['load']:<8}{r['res']:<11}"
              f"{r['fps_mean']:9.1f}{r['fps_med']:9.1f}{r['p95_ms']:8.1f}"
              f"{r['draws']:>7}{r['tris']:>10}{r['alive']:>6}"
              f"{str(r['weather']):>6}{flag}")
    bad = [r for r in rows if r["fps_med"] < 60]
    print(f"\ncells below 60 FPS (median): {len(bad)}/{len(rows)}")
    for r in bad:
        print(f"   {r['realm']}/{r['preset']}/{r['load']}  {r['fps_med']:.1f} FPS")
    print(f"errors {len(errors)}")
    for e in errors[:8]:
        print("  ", e)
    return 0


if __name__ == "__main__":
    sys.exit(main())
