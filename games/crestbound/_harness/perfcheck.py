#!/usr/bin/env python
"""CRESTBOUND perf check — draw calls, triangles and REAL GPU frame cost per course.

Budgets (CONTRACT hard rule 4 / "The gates", as amended 2026-09-02):

    draw calls   <= 260            worst frame at any station (resolution-independent)
    triangles    <= 450 000        worst frame at any station (resolution-independent)
    fps          >= 55             AT THE TIER RENDER SCALE (high = 0.85)
    p99 frame    <= 28 ms          AT THE TIER RENDER SCALE
    warm load    <= 1500 ms        second load of a course; the COLD load is reported, not gated

WHY THE RENDER SCALE IS THE GATE'S FRAME OF REFERENCE.  Measured on this
machine (ANGLE / Intel UHD 0x00009A60 / D3D11, quiet box, GPU timer query):
the frame is GPU FILL-bound, cost fits `T = C + F*pixels` with F between 78 and
91 % of the frame, and overdraw is 2.2-2.8 shaded fragments per screen pixel.
Stacking EVERY non-feature-deleting fill cut still left 40.99 ms (24.4 fps) at
native 1920x1080, while the SAME chain at quarter pixels cost 19.71 ms
(50.7 fps).  Native-1080p 55 fps is therefore not reachable on this GPU for
this scene class and no fill cut reaches it, so the contract moved the fps
budget onto the quality tier's internal render scale — the same lever as the
pre-existing `DPR <= 1.5` cap.  The native-1080p figure is still measured and
printed, as an INFO row.  It is not a pass condition.

WHY THE GPU TIMER QUERY.  `requestAnimationFrame` deltas cannot beat the
display refresh, and the reference panel is 50 Hz, so a rAF-interval gate reads
~50 fps no matter what the renderer is doing.  The run launches with
`--disable-gpu-vsync --disable-frame-rate-limit` AND times the frame with
`EXT_disjoint_timer_query_webgl2`, which reports the GPU's own elapsed
nanoseconds for the draws between beginQuery and endQuery.  rAF intervals are
still collected and printed beside it, so a disagreement is visible.

Per course it samples three STATIONS — the spawn and two checkpoints spread
across the course — twice each: once at the tier render scale (gated) and once
at render scale 1.0 (INFO).

    python perfcheck.py                          # every course on disk
    python perfcheck.py --courses verdant-1 --seconds 12
    python perfcheck.py --quality medium
    python perfcheck.py --headless               # reports fps, does NOT gate it

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
  // CONTINUE first: with a save on disk, NEW GAME opens an ERASE-confirm page
  // and the state never leaves 'title'.
  const words = ['CONTINUE', 'KEEP MY PROGRESS', 'NEW GAME', 'NEW RUN', 'PLAY', 'START', 'BEGIN', 'ENTER'];
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
  const live = () => G.course && G.courseId === id && (G.state === 'playing' || G.state === 'keep');
  try { await G.__dev.goto(id); } catch (e) { return {error: 'goto threw: ' + e}; }
  const deadline = t0 + 40000;
  /* Poll on BOTH rAF and a timer: building a course blocks the main thread for
     one long frame, so an rAF-only loop can wake up past the deadline. */
  const tick = () => new Promise(r => { let done = false;
    const fin = () => { if (!done) { done = true; r(); } };
    requestAnimationFrame(fin); setTimeout(fin, 60); });
  while (performance.now() < deadline && !live()) await tick();
  if (live()) {
    const loadMs = performance.now() - t0;
    await frame();
    return {loadMs: +loadMs.toFixed(1), courseId: G.courseId, state: G.state,
            programs: A.engine.renderer.info.programs ? A.engine.renderer.info.programs.length : null};
  }
  return {error: 'never arrived (state ' + G.state + ', course ' + G.courseId + ')'};
}
"""

# --------------------------------------------------------------------------
# The sampler. `opts.scale`: null = leave the engine's tier scale alone,
# a number = pin `engine.setRenderScale(n)` for this pass.
# --------------------------------------------------------------------------
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

  /* ---- render scale: pin it, and freeze the dynamic controller ---------
     The gate measures A KNOWN scale. The controller is what ships; letting it
     move during the sample would mean the fps number belongs to no particular
     resolution. */
  const autoWas = E.renderScaleAuto;
  const scaleWas = E.renderScale;
  E.renderScaleAuto = false;
  /* Freezing the controller is not enough once it SHIPS ON (engine.js,
     2026-09-03): it will already have walked the scale down inside its band by
     the time the sampler runs, and a gate that measures wherever the controller
     happened to stop is measuring no particular resolution. `scale: null` now
     means "the TIER scale", which is what every line of this gate's output
     claims it is measuring. */
  E.setRenderScale(typeof opts.scale === 'number' ? opts.scale : E.tierRenderScale);
  for (let k = 0; k < 8; k++) await frame();      // let the resize land

  /* ---- GPU timer query -------------------------------------------------
     EXT_disjoint_timer_query_webgl2 reports the GPU's own elapsed nanoseconds
     for the draws between beginQuery/endQuery. Only ONE TIME_ELAPSED query may
     be active at a time, so the pattern is: end the query opened last frame,
     read whatever has become available, open a new one. engine.onFrame runs
     BEFORE the loop function (which renders), so a query opened in frame N-1's
     callback and closed in frame N's callback encloses exactly frame N-1's
     render. */
  const gl = R.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') ||
              gl.getExtension('EXT_disjoint_timer_query');
  const TIME_ELAPSED = ext ? (ext.TIME_ELAPSED_EXT !== undefined ? ext.TIME_ELAPSED_EXT : 0x88BF) : 0;
  const GPU_DISJOINT = ext ? (ext.GPU_DISJOINT_EXT !== undefined ? ext.GPU_DISJOINT_EXT : 0x8FBB) : 0;
  let open = null;
  const inflight = [];
  const gpuMs = [];
  const freeQ = [];
  let disjoint = 0;
  const drain = () => {
    for (let i = inflight.length - 1; i >= 0; i--) {
      const q = inflight[i];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) continue;
      inflight.splice(i, 1);
      if (gl.getParameter(GPU_DISJOINT)) { disjoint++; freeQ.push(q); continue; }
      gpuMs.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      freeQ.push(q);
    }
  };
  const cycle = () => {
    if (!ext) return;
    if (open) { gl.endQuery(TIME_ELAPSED); inflight.push(open); open = null; }
    drain();
    open = freeQ.pop() || gl.createQuery();
    gl.beginQuery(TIME_ELAPSED, open);
  };
  const stopQ = () => {
    if (!ext) return;
    if (open) { gl.endQuery(TIME_ELAPSED); inflight.push(open); open = null; }
    drain();
  };

  const stations = [];
  const sp = C.spawnFor ? C.spawnFor(0) : null;
  if (sp && sp.pos) stations.push({name: 'spawn', p: posOf(sp.pos)});
  const cps = (C.checkpoints || []).slice(1);
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
  const out = {stations: [], worstDraw: 0, worstTris: 0, minFps: null, minRafFps: null,
               allGpu: [], gpuAvailable: !!ext, disjoint: 0,
               renderScale: +E.renderScale.toFixed(3),
               tierScale: +(E.tierRenderScale !== undefined ? E.tierRenderScale : E.renderScale).toFixed(3),
               drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
               cssSize: [E.size.w, E.size.h],
               quality: (A.Settings && A.Settings.get) ? A.Settings.get().quality : null,
               dpr: +R.getPixelRatio().toFixed(3),
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

    gpuMs.length = 0;
    const dts = [];
    let draw = 0, tris = 0;
    let last = performance.now();
    const t0 = last;
    while (performance.now() - t0 < perStationMs) {
      cycle();
      await frame();
      const now = performance.now();
      dts.push(now - last);
      last = now;
      const rc = R.info.render.calls, rt = R.info.render.triangles;
      if (rc > draw) draw = rc;
      if (rt > tris) tris = rt;
    }
    stopQ();
    for (let k = 0; k < 6; k++) { await frame(); drain(); }   // let the tail land

    const g = gpuMs.slice().sort((a, b) => a - b);
    dts.sort((a, b) => a - b);
    const gmean = g.length ? g.reduce((a, b) => a + b, 0) / g.length : null;
    const rmean = dts.reduce((a, b) => a + b, 0) / Math.max(1, dts.length);
    const rec = {
      name: st.name, p: [+st.p.x.toFixed(1), +st.p.y.toFixed(1), +st.p.z.toFixed(1)],
      frames: dts.length, gpuFrames: g.length,
      fps: gmean ? +(1000 / gmean).toFixed(1) : null,
      gpuMedianMs: g.length ? +g[g.length >> 1].toFixed(2) : null,
      p99Ms: g.length ? +g[Math.min(g.length - 1, Math.floor(g.length * 0.99))].toFixed(2) : null,
      rafFps: rmean > 0 ? +(1000 / rmean).toFixed(1) : null,
      rafP99Ms: dts.length ? +dts[Math.min(dts.length - 1, Math.floor(dts.length * 0.99))].toFixed(2) : null,
      drawCalls: draw, tris: tris,
    };
    out.stations.push(rec);
    for (let i = 0; i < g.length; i++) out.allGpu.push(g[i]);
    if (draw > out.worstDraw) out.worstDraw = draw;
    if (tris > out.worstTris) out.worstTris = tris;
    if (rec.fps !== null && (out.minFps === null || rec.fps < out.minFps)) out.minFps = rec.fps;
    if (rec.rafFps !== null && (out.minRafFps === null || rec.rafFps < out.minRafFps)) out.minRafFps = rec.rafFps;
  }

  const all = out.allGpu.slice().sort((a, b) => a - b);
  out.p99Ms = all.length ? +all[Math.min(all.length - 1, Math.floor(all.length * 0.99))].toFixed(2) : null;
  out.avgFps = out.stations.length
    ? +(out.stations.reduce((a, s) => a + (s.fps || 0), 0) / out.stations.length).toFixed(1) : null;
  out.disjoint = disjoint;
  delete out.allGpu;

  /* restore whatever the page had */
  E.setRenderScale(scaleWas);
  E.renderScaleAuto = autoWas;
  return out;
}
"""


def leave_title(pg, timeout=150):
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
    ap.add_argument("--seconds", type=float, default=8.0, help="sample seconds per course per pass")
    ap.add_argument("--width", type=int, default=1920)
    ap.add_argument("--height", type=int, default=1080)
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--no-native", action="store_true",
                    help="skip the native-1.0 INFO pass (halves the run time)")
    ap.add_argument("--json", default=os.path.join(HERE, "perfcheck.json"))
    args = ap.parse_args()

    results, native, loads, pageerrs = {}, {}, {}, []
    with sync_playwright() as p:
        if args.headless:
            try:
                br = p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
            except Exception as _e:
                print("headless: no hardware Chrome (%s) -> SwiftShader" % str(_e)[:120],
                      file=sys.stderr)
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

        # ---- pass 0: COLD load of every course, in order -------------------
        for cid in courses:
            try:
                ld = pg.evaluate(LOAD_JS, cid)
            except Exception as e:
                ld = {"error": str(e)[:200]}
            loads[cid] = {"cold": (ld or {}).get("loadMs"), "warm": None,
                          "programs": (ld or {}).get("programs"),
                          "error": (ld or {}).get("error")}

        # ---- pass 1..n: warm load + sample --------------------------------
        for cid in courses:
            if loads[cid].get("error"):
                results[cid] = {"error": loads[cid]["error"]}
                continue
            try:
                ld = pg.evaluate(LOAD_JS, cid)      # every course has been built once now
            except Exception as e:
                results[cid] = {"error": "warm load: %s" % str(e)[:200]}
                continue
            if not isinstance(ld, dict) or ld.get("error"):
                results[cid] = {"error": (ld or {}).get("error", "warm load failed")}
                continue
            loads[cid]["warm"] = ld.get("loadMs")
            loads[cid]["programs"] = ld.get("programs")
            pg.wait_for_timeout(700)
            try:
                r = pg.evaluate(SAMPLE_JS, {"seconds": args.seconds, "scale": None})
            except Exception as e:
                results[cid] = {"error": str(e)[:300]}
                continue
            results[cid] = r if isinstance(r, dict) else {"error": "sampler returned nothing"}
            if not args.no_native:
                try:
                    native[cid] = pg.evaluate(SAMPLE_JS, {"seconds": max(3.0, args.seconds * 0.5),
                                                          "scale": 1.0})
                except Exception as e:
                    native[cid] = {"error": str(e)[:200]}
        br.close()

    tier = None
    for r in results.values():
        if isinstance(r, dict) and r.get("tierScale"):
            tier = r["tierScale"]
            break

    print("=" * 108)
    print("CRESTBOUND perf check — %s, %dx%d CSS, quality %s (tier render scale %s), %.0f s per pass"
          % ("HEADLESS (fps NOT gated)" if args.headless else "headed Chrome",
             args.width, args.height, args.quality, tier if tier else "?", args.seconds))
    print("budget: <= %d draws, <= %s tris, >= %d fps, p99 <= %.0f ms AT THE TIER RENDER SCALE,"
          % (BUDGET["drawCalls"], f'{BUDGET["tris"]:,}', BUDGET["minFps"], BUDGET["p99Ms"]))
    print("        warm load <= %d ms. Native-1080p and cold load are INFO rows, not pass conditions."
          % BUDGET["loadMs"])
    print("-" * 108)
    print("%-12s %6s %9s %7s %7s %8s %8s %7s %6s  %s"
          % ("course", "draws", "tris", "fps", "p99ms", "warm ms", "cold ms", "hazard", "coll", "verdict"))
    print("-" * 108)

    fails = 0
    for cid in results:
        r = results[cid]
        L = loads.get(cid, {})
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
        if not args.headless and r.get("p99Ms") is not None and r["p99Ms"] > BUDGET["p99Ms"]:
            over.append("p99")
        if L.get("warm") is not None and L["warm"] > BUDGET["loadMs"]:
            over.append("load")
        if over:
            fails += 1
        print("%-12s %6s %9s %7s %7s %8s %8s %7s %6s  %s"
              % (cid, r.get("worstDraw"), f'{r.get("worstTris", 0):,}',
                 r.get("minFps"), r.get("p99Ms"), L.get("warm"), L.get("cold"),
                 r.get("hazards"), r.get("colliders"),
                 ("OVER: " + ",".join(over)) if over else "ok"))
        print("             render scale %.2f -> drawing buffer %sx%s (CSS %sx%s), dpr %.2f, "
              "programs %s, GPU timer %s%s"
              % (r.get("renderScale", 0), r.get("drawingBuffer", ["?", "?"])[0],
                 r.get("drawingBuffer", ["?", "?"])[1], r.get("cssSize", ["?", "?"])[0],
                 r.get("cssSize", ["?", "?"])[1], r.get("dpr", 0), r.get("programs"),
                 "yes" if r.get("gpuAvailable") else "NO (fps from rAF)",
                 (", %d disjoint frames dropped" % r["disjoint"]) if r.get("disjoint") else ""))
        for s in r.get("stations", []):
            print("             %-8s p %-22s draws %4s tris %9s  gpu fps %5s p99 %6s   (rAF fps %5s)"
                  % (s.get("name"), s.get("p"), s.get("drawCalls"),
                     f'{s.get("tris", 0):,}', s.get("fps"), s.get("p99Ms"), s.get("rafFps")))
        n = native.get(cid)
        if isinstance(n, dict) and not n.get("error"):
            print("             INFO native %.2f (%sx%s): gpu fps %s, p99 %s ms — NOT a pass condition"
                  % (n.get("renderScale", 1.0), n.get("drawingBuffer", ["?", "?"])[0],
                     n.get("drawingBuffer", ["?", "?"])[1], n.get("minFps"), n.get("p99Ms")))
    print("-" * 108)
    if args.headless:
        print("note: --headless is for draws/tris only. fps and p99 are REPORTED but never gated;")
        print("      only a headed run on the reference machine, on a quiet box, gates them.")
    if pageerrs:
        print("page errors (%d):" % len(pageerrs))
        for e in pageerrs[:8]:
            print("  !! %s" % str(e)[:250])
    if args.json:
        try:
            with open(args.json, "w", encoding="utf-8") as f:
                json.dump({"budget": BUDGET, "headless": args.headless, "loads": loads,
                           "results": results, "native": native, "pageErrors": pageerrs}, f, indent=2)
        except Exception:
            pass
    print("VERDICT: %s (%d of %d courses over budget)"
          % ("PERF OK" if fails == 0 else "OVER BUDGET", fails, len(results)))
    print("RESULT: %s" % ("OK" if fails == 0 else "FAIL"))
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
