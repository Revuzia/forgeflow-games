#!/usr/bin/env python
"""CRESTBOUND perf check — draw calls, triangles and REAL frame cost per course.

Budgets (CONTRACT hard rule 4 / "The gates"):

    draw calls   <= 260          worst frame at any station
    triangles    <= 450 000      worst frame at any station
    fps          >= 55           lowest station average (HEADED runs only)
    p99 frame    <= 28 ms        99th percentile over the whole sample
    course load  <= 1500 ms      __dev.goto round trip, hook call to live state

Per course it samples three STATIONS — the spawn and two checkpoints spread
across the course — for `--seconds` each (default 8 s total, split evenly), so
the numbers describe the level the player moves through, not one lucky corner.

Frame times are measured in the page from `requestAnimationFrame` deltas rather
than trusted from a counter, and draw calls / triangles come straight off
`renderer.info.render` (the engine's own `stats` are printed beside them so a
disagreement between the two is visible rather than silent).

    python perfcheck.py                          # every course on disk
    python perfcheck.py --courses verdant-1,ember-2 --seconds 12
    python perfcheck.py --quality medium
    python perfcheck.py --headless               # reports fps, does NOT gate it

WHY vsync IS DISABLED: rAF cannot exceed the display refresh, so on a 50 Hz panel
every course would report ~50 fps and fail a 55 fps budget no matter what the
renderer was doing (feedback_forgeflow_games_fps).

Exit 0 = every course inside every gating budget.
"""
import argparse
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BASE = "http://localhost:8788/games/crestbound/index.html"

FLAGS = ["--disable-gpu-vsync", "--disable-frame-rate-limit",
         "--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]
HEADLESS_FLAGS = [f for f in FLAGS if not f.startswith("--use-angle")] + [
    "--use-gl=angle", "--use-angle=swiftshader"]

BUDGET = {"drawCalls": 260, "tris": 450_000, "minFps": 55, "p99Ms": 28.0, "loadMs": 1500}

STATE_JS = "globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.state"

CLICK_JS = r"""() => {
  const words = ['NEW GAME', 'NEW RUN', 'CONTINUE', 'PLAY', 'START', 'BEGIN', 'ENTER'];
  const btns = Array.from(document.querySelectorAll('button.cb-btn, button, [role=button], .btn'));
  for (const want of words) {
    for (const b of btns) {
      const r = b.getBoundingClientRect();
      if (b.disabled || r.width < 4 || r.height < 4) continue;
      if ((b.textContent || '').toUpperCase().indexOf(want) < 0) continue;
      if (typeof b.__activate === 'function') b.__activate(); else b.click();
      return want;
    }
  }
  const t = document.querySelector('canvas') || document;
  for (const type of ['keydown', 'keyup'])
    t.dispatchEvent(new KeyboardEvent(type, {code:'Enter', key:'Enter', bubbles:true, cancelable:true}));
  return null;
}"""

# Load a course and time the round trip: the hook call to a live, populated state.
LOAD_JS = r"""
async (id) => {
  const A = globalThis.CRESTBOUND, G = A && A.game;
  if (!G || !G.__dev) return {error: '__dev missing (?dev=1)'};
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const t0 = performance.now();
  try { await G.__dev.goto(id); } catch (e) { return {error: 'goto threw: ' + e}; }
  const deadline = t0 + 30000;
  while (performance.now() < deadline) {
    if (G.course && G.courseId === id && (G.state === 'playing' || G.state === 'keep')) {
      const loadMs = performance.now() - t0;
      // one more frame so the first render of the new course is included
      await frame();
      return {loadMs: +loadMs.toFixed(1), courseId: G.courseId, state: G.state};
    }
    await frame();
  }
  return {error: 'never arrived (state ' + G.state + ', course ' + G.courseId + ')'};
}
"""

SAMPLE_JS = r"""
async (opts) => {
  const A = globalThis.CRESTBOUND;
  const G = A && A.game, E = A && A.engine;
  if (!G || !G.course || !E) return {error: 'no live course/engine'};
  const C = G.course, R = E.renderer, THREE = A.THREE;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  let P = G.player;
  const syncP = () => { if (G.player && G.player !== P) P = G.player; return P; };
  const posOf = (o) => {
    if (!o) return null;
    if (typeof o.x === 'number') return o;
    if (o.pos) return posOf(o.pos);
    if (o.p) return Array.isArray(o.p) ? {x:o.p[0], y:o.p[1], z:o.p[2]} : posOf(o.p);
    if (o.position) return posOf(o.position);
    return null;
  };

  /* stations: the spawn plus two checkpoints spread across the course */
  const stations = [];
  const sp = C.spawnFor ? C.spawnFor(0) : null;
  if (sp && sp.pos) stations.push({name: 'spawn', p: posOf(sp.pos)});
  const cps = (C.checkpoints || []).slice(1);         // [0] is the spawn
  if (cps.length) {
    const pick = cps.length === 1 ? [0]
      : [Math.floor(cps.length / 3), Math.min(cps.length - 1, Math.floor((2 * cps.length) / 3))];
    const seen = new Set();
    for (const i of pick) {
      if (seen.has(i)) continue;
      seen.add(i);
      const p = posOf(cps[i]);
      if (p) stations.push({name: 'cp' + (i + 1), p});
    }
  }
  if (!stations.length) return {error: 'no stations (no spawn, no checkpoints)'};

  const perStationMs = Math.max(1200, (opts.seconds * 1000) / stations.length);
  const out = {stations: [], worstDraw: 0, worstTris: 0, minFps: null, allFrames: [],
               quality: (A.Settings && A.Settings.get) ? A.Settings.get().quality : null,
               dpr: +R.getPixelRatio().toFixed(2),
               geometries: R.info.memory.geometries, textures: R.info.memory.textures,
               programs: R.info.programs ? R.info.programs.length : null,
               hazards: (C.hazards || []).length, critters: (C.critters || []).length,
               colliders: C.broadphase ? (C.broadphase.count | 0) : null};

  for (const st of stations) {
    syncP();
    if (P && P.__test && THREE) {
      P.__test.teleport(new THREE.Vector3(st.p.x, st.p.y + 0.6, st.p.z));
      P.__test.setVel(new THREE.Vector3(0, 0, 0));
    }
    for (let k = 0; k < 30; k++) await frame();       // culling / LOD / streaming settle

    const dts = [];
    let draw = 0, tris = 0, engFps = 0, engN = 0;
    let last = performance.now();
    const t0 = last;
    while (performance.now() - t0 < perStationMs) {
      await frame();
      const now = performance.now();
      dts.push(now - last);
      last = now;
      const rc = R.info.render.calls, rt = R.info.render.triangles;
      if (rc > draw) draw = rc;
      if (rt > tris) tris = rt;
      if (E.stats && E.stats.fps) { engFps += E.stats.fps; engN++; }
    }
    dts.sort((a, b) => a - b);
    const mean = dts.reduce((a, b) => a + b, 0) / Math.max(1, dts.length);
    const p99 = dts.length ? dts[Math.min(dts.length - 1, Math.floor(dts.length * 0.99))] : null;
    const rec = {
      name: st.name, p: [+st.p.x.toFixed(1), +st.p.y.toFixed(1), +st.p.z.toFixed(1)],
      frames: dts.length,
      fps: mean > 0 ? +(1000 / mean).toFixed(1) : null,
      engineFps: engN ? Math.round(engFps / engN) : null,
      medianMs: dts.length ? +dts[dts.length >> 1].toFixed(2) : null,
      p99Ms: p99 === null ? null : +p99.toFixed(2),
      engineP99Ms: E.stats && Number.isFinite(E.stats.p99Ms) ? +E.stats.p99Ms.toFixed(2) : null,
      drawCalls: draw, tris: tris,
    };
    out.stations.push(rec);
    out.allFrames = out.allFrames.concat(dts);
    if (draw > out.worstDraw) out.worstDraw = draw;
    if (tris > out.worstTris) out.worstTris = tris;
    if (rec.fps !== null && (out.minFps === null || rec.fps < out.minFps)) out.minFps = rec.fps;
  }

  const all = out.allFrames.slice().sort((a, b) => a - b);
  out.p99Ms = all.length ? +all[Math.min(all.length - 1, Math.floor(all.length * 0.99))].toFixed(2) : null;
  out.avgFps = out.stations.length
    ? +(out.stations.reduce((a, s) => a + (s.fps || 0), 0) / out.stations.length).toFixed(1) : null;
  delete out.allFrames;
  return out;
}
"""


def leave_title(pg, timeout=45):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            st = pg.evaluate(STATE_JS)
        except Exception:
            st = None
        if st in ("keep", "playing"):
            return True
        if st == "paused":
            try:
                pg.keyboard.press("Escape")
            except Exception:
                pass
        try:
            pg.evaluate(CLICK_JS)
        except Exception:
            pass
        pg.wait_for_timeout(400)
    return False


def courses_on_disk(pg):
    ids = []
    try:
        ids = pg.evaluate(
            "async () => { const m = await import(new URL('runtime/data/index.js', location.href).href);"
            " return m.ALL_COURSE_IDS || []; }") or []
    except Exception:
        ids = []
    if not ids:
        d = os.path.join(ROOT, "runtime", "data", "courses")
        ids = sorted(f[:-3] for f in os.listdir(d)) if os.path.isdir(d) else []
    out = [c for c in ids
           if os.path.isfile(os.path.join(ROOT, "runtime", "data", "courses", c + ".js"))]
    if os.path.isfile(os.path.join(ROOT, "runtime", "data", "keep.js")):
        out = ["keep"] + out
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="CRESTBOUND perf check")
    ap.add_argument("--url", default=BASE)
    ap.add_argument("--courses", default="", help="comma list; default = every course on disk")
    ap.add_argument("--quality", default="high")
    ap.add_argument("--seconds", type=float, default=8.0, help="sample seconds per course")
    ap.add_argument("--width", type=int, default=1920)
    ap.add_argument("--height", type=int, default=1080)
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--json", default=os.path.join(HERE, "perfcheck.json"))
    args = ap.parse_args()

    results, pageerrs = {}, []
    with sync_playwright() as p:
        if args.headless:
            br = p.chromium.launch(headless=True, args=HEADLESS_FLAGS)
        else:
            br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": args.width, "height": args.height})
        pg.on("pageerror", lambda e: pageerrs.append(str(e)))
        url = "%s?dev=1&quality=%s" % (args.url, args.quality)
        try:
            pg.goto(url, wait_until="load", timeout=60_000)
        except Exception as e:
            print("NAVIGATION FAILED: %s" % e, file=sys.stderr)
            br.close()
            print("RESULT: FAIL")
            return 2

        deadline, ready = time.time() + 70, False
        while time.time() < deadline:
            try:
                if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game)"):
                    ready = True
                    break
            except Exception:
                pass
            pg.wait_for_timeout(400)
        if not ready or not leave_title(pg):
            print("PERF CHECK: the game never reached a live state", file=sys.stderr)
            br.close()
            print("RESULT: FAIL")
            return 2

        courses = ([c.strip() for c in args.courses.split(",") if c.strip()]
                   if args.courses else courses_on_disk(pg))
        if not courses:
            print("PERF CHECK: no course data on disk to measure", file=sys.stderr)
            br.close()
            print("RESULT: FAIL")
            return 2

        for cid in courses:
            try:
                load = pg.evaluate(LOAD_JS, cid)
            except Exception as e:
                results[cid] = {"error": "load: %s" % str(e)[:200]}
                continue
            if not isinstance(load, dict) or load.get("error"):
                results[cid] = {"error": (load or {}).get("error", "load failed")}
                continue
            pg.wait_for_timeout(700)
            try:
                r = pg.evaluate(SAMPLE_JS, {"seconds": args.seconds})
            except Exception as e:
                results[cid] = {"error": str(e)[:300], "loadMs": load.get("loadMs")}
                continue
            if isinstance(r, dict):
                r["loadMs"] = load.get("loadMs")
            results[cid] = r
        br.close()

    print("=" * 100)
    print("CRESTBOUND perf check — %s, %dx%d, quality %s, %.0f s per course"
          % ("HEADLESS swiftshader (fps NOT gated)" if args.headless else "headed Chrome",
             args.width, args.height, args.quality, args.seconds))
    print("budget: <= %d draws, <= %s tris, >= %d fps, p99 <= %.0f ms, load <= %d ms"
          % (BUDGET["drawCalls"], f'{BUDGET["tris"]:,}', BUDGET["minFps"],
             BUDGET["p99Ms"], BUDGET["loadMs"]))
    print("-" * 100)
    print("%-12s %6s %9s %7s %7s %8s %7s %6s  %s"
          % ("course", "draws", "tris", "fps", "p99ms", "load ms", "hazard", "coll", "verdict"))
    print("-" * 100)

    fails = 0
    for cid, r in results.items():
        if not isinstance(r, dict) or r.get("error"):
            print("%-12s ERROR: %s" % (cid, str((r or {}).get("error"))[:70]))
            fails += 1
            continue
        over = []
        if r.get("worstDraw", 0) > BUDGET["drawCalls"]:
            over.append("draws")
        if r.get("worstTris", 0) > BUDGET["tris"]:
            over.append("tris")
        if not args.headless and r.get("minFps") is not None and r["minFps"] < BUDGET["minFps"]:
            over.append("fps")
        if r.get("p99Ms") is not None and r["p99Ms"] > BUDGET["p99Ms"] and not args.headless:
            over.append("p99")
        if r.get("loadMs") is not None and r["loadMs"] > BUDGET["loadMs"]:
            over.append("load")
        if over:
            fails += 1
        print("%-12s %6s %9s %7s %7s %8s %7s %6s  %s"
              % (cid, r.get("worstDraw"), f'{r.get("worstTris", 0):,}',
                 r.get("minFps"), r.get("p99Ms"), r.get("loadMs"),
                 r.get("hazards"), r.get("colliders"),
                 ("OVER: " + ",".join(over)) if over else "ok"))
        for s in r.get("stations", []):
            print("             %-8s p %-22s draws %4s tris %9s fps %5s p99 %5s"
                  % (s.get("name"), s.get("p"), s.get("drawCalls"),
                     f'{s.get("tris", 0):,}', s.get("fps"), s.get("p99Ms")))
    print("-" * 100)
    if args.headless:
        print("note: headless/swiftshader frame times are software-rasterised — fps and p99 are")
        print("      REPORTED but never gated. Only a headed run on the reference machine gates them.")
    if pageerrs:
        print("page errors (%d):" % len(pageerrs))
        for e in pageerrs[:8]:
            print("  !! %s" % str(e)[:250])
    if args.json:
        try:
            with open(args.json, "w", encoding="utf-8") as f:
                json.dump({"budget": BUDGET, "headless": args.headless,
                           "results": results, "pageErrors": pageerrs}, f, indent=2)
        except Exception:
            pass
    print("VERDICT: %s (%d of %d courses over budget)"
          % ("PERF OK" if fails == 0 else "OVER BUDGET", fails, len(results)))
    print("RESULT: %s" % ("OK" if fails == 0 else "FAIL"))
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
