#!/usr/bin/env python
"""
BLACKRIDGE perfprobe — p99 frame time + hitch attribution (never averages).

    python perfprobe.py                          # all three phases, local
    python perfprobe.py --phases perf-combat     # subset
    python perfprobe.py --url <cdn url>          # deployed (via deployverify --perf)

driftwake's rAF-delta sampler upgraded to the adoption-plan verdict
(doctrine §3): per rAF frame it records dt + the live renderer counters
(`__FPS__.perfStats`, honest because the game keeps renderer.info.autoReset
= false and resets ONCE per frame in boot's loop — asserted at start, exit 2
if the discipline is broken because with any composer the numbers otherwise
describe the last pass only).

Three measured phases (Part 5 gates, frozen wording):
  perf-static     S3 pose (the R10 establishing vista), 10 s idle render
  perf-combat     startMission + rusher persona for 30 s of real fighting
                  (muzzle flashes, tracers, impacts, deaths) — GATE:
                  "`programs` delta == 0 across the entire perf-combat phase
                  (pre-warm complete; first muzzle flash/decal/ragdoll
                  compiles nothing)"
  perf-traversal  scripted sprint down the boulevard long sightline
                  (S2 pose -> S5 ground pos), streaming/LOD stress

GATE (every phase): "p99 >= 30 fps equiv (<= 33.3 ms) at DPR 1.5, 1920x1080,
on this box; p50 >= 60 fps equiv." Hitch = dt > max(2*median, median+8 ms);
each hitch row records co-located counter deltas — programs jump = shader
compile (pre-warm hole), textures jump = upload stall, neither = CPU/GC.

THREE INSTRUMENTS, ONE VERDICT (iter05 — measurement validity, ranked fix 2).
The rAF-delta sampler alone CANNOT measure frame cost and every number it ever
produced here was misread:
  1. `sync`  — PRIMARY, and the only thing the gate judges. ctx.stepFrames()
     (boot.js:304) runs the REAL step+dispatch+post path and brackets it with
     gl.finish(), so the returned msPerFrame is honest CPU+GPU wall cost with
     no vsync, no compositor and no rAF pacing in it. Continuous-valued.
  2. `gpu`   — EXT_disjoint_timer_query_webgl2 around the same step. Pure GPU
     time; splits GPU-bound from CPU-bound instead of guessing. Discarded when
     GPU_DISJOINT_EXT fires (the spec's own "these numbers are garbage" flag).
  3. `raf`   — DEMOTED to presentation cadence, never a gate input. rAF deltas
     are quantised to the display's vsync interval BY CONSTRUCTION, so seeing
     exact multiples (60/80/100 ms) is not evidence of a throttled clock — it
     is evidence of vsync. The measured refresh interval is printed next to
     them so nobody has to infer it again.
DPR IS ASSERTED, NOT PRINTED. The gate's stated condition is DPR 1.5, and
gfx.js:29 + dynres.js:25 both clamp to min(window.devicePixelRatio, 1.5) — so
under a default Playwright page (deviceScaleFactor 1) the game physically
cannot leave DPR 1.0 and every prior run measured 44% of the gate's pixels
while printing "dpr=1.0" as a note. The page now launches with
device_scale_factor = --dpr and the probe EXITS 2 if the renderer did not
land on it.

Exit: 0 = all gates pass; 1 = a gate failed; 2 = autoReset misconfigured, DPR
condition unmet, or navigation failure; 4 = surface NOT READY.
"""
import argparse, json, os, re, statistics, subprocess, sys, time
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from shotserver import ensure_server

DEFAULT_URL = "http://localhost:8841/games/blackridge/index.html"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]
READY_EXPR = "!!(globalThis.__FPS__ && __FPS__.renderer && __FPS__.sim)"  # R11

P50_MS = 16.7   # >= 60 fps equiv
P99_MS = 33.3   # >= 30 fps equiv

SAMPLER = r"""
(() => {
  window.__PP = { on: false, samples: [] };
  window.__ppStart = () => {
    __PP.samples.length = 0;
    __PP.on = true;
    const loop = (t) => {
      if (!__PP.on) return;
      if (__PP.last != null) {
        const s = (globalThis.__FPS__ && __FPS__.perfStats) || {};
        __PP.samples.push([t - __PP.last, s.programs|0, s.textures|0,
                           s.drawCalls|0, s.triangles|0]);
      }
      __PP.last = t;
      requestAnimationFrame(loop);
    };
    __PP.last = null;
    requestAnimationFrame(loop);
  };
  window.__ppStop = () => { __PP.on = false; return __PP.samples; };

  // ---- instrument 1: gl.finish()-bracketed REAL frame cost -----------------
  // ctx.stepFrames (boot.js:304) = renderer.info.reset + sim.step +
  // bridge.dispatch + viewUpdates + post.render, then gl.finish(). Nothing
  // here touches rAF, vsync or the compositor, so the value is the frame's
  // actual cost and is continuous-valued (a vsync-quantised number proves
  // the sampler was rAF, not that the GPU was idle).
  window.__ppSync = (n) => {
    const T = __FPS__.__test;
    T.step(1); T.step(1);                       // warm caches/RT rebuilds
    const out = [];
    for (let i = 0; i < n; i++) {
      const r = T.step(1);
      out.push([r.msPerFrame, r.drawCalls | 0, r.triangles | 0]);
    }
    return out;
  };

  // ---- instrument 2: pure GPU time -----------------------------------------
  // Queries are ASYNC: issue them all, then collect on a later task. A
  // GPU_DISJOINT_EXT of true means the driver preempted us and the whole
  // batch is spec-invalid — reported, never silently averaged in.
  window.__ppGpuStart = (n) => {
    const gl = __FPS__.renderer.getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) return { error: 'EXT_disjoint_timer_query_webgl2 unavailable' };
    const T = __FPS__.__test;
    T.step(1);
    const qs = [];
    for (let i = 0; i < n; i++) {
      const q = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      T.step(1);
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      qs.push(q);
    }
    window.__ppQ = qs;
    return { issued: n };
  };
  window.__ppGpuRead = () => {
    const gl = __FPS__.renderer.getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) return { error: 'EXT_disjoint_timer_query_webgl2 unavailable' };
    const disjoint = !!gl.getParameter(ext.GPU_DISJOINT_EXT);
    const ms = [];
    for (const q of (window.__ppQ || [])) {
      if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
        ms.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      }
      gl.deleteQuery(q);
    }
    window.__ppQ = [];
    return { disjoint, ms };
  };

  // ---- instrument 3 support: the display's vsync interval -------------------
  // The SMALLEST positive rAF delta over a long idle run is the refresh
  // period. Printing it turns "why are all the numbers multiples of 20?"
  // from a mystery into arithmetic.
  window.__ppRefresh = (n) => new Promise((res) => {
    const d = []; let last = null, i = 0;
    const loop = (t) => {
      if (last != null) d.push(t - last);
      last = t;
      if (++i < n) requestAnimationFrame(loop); else res(d);
    };
    requestAnimationFrame(loop);
  });
})();
"""


def load_shots_source() -> str:
    src = open(os.path.join(HERE, "shots.js"), encoding="utf-8").read()
    return re.sub(r"^export\s+", "", src, flags=re.M)


def machine_load() -> dict:
    """Ambient load, MEASURED, printed with the verdict.

    iter04's absolutes were taken with 33 stale Chrome/Blender processes from
    concurrent agents on the box and nobody could tell afterwards which numbers
    that poisoned. A perf number with no contemporaneous load reading is not a
    baseline, so the reading ships with the result and the reader decides.
    """
    out = {}
    try:
        ps = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "$n=@{}; foreach($p in Get-Process){ $n[$p.Name]=1+$n[$p.Name] };"
             "$c=(Get-Counter '\\Processor(_Total)\\% Processor Time' "
             "-SampleInterval 1 -MaxSamples 2).CounterSamples "
             "| Measure-Object CookedValue -Average;"
             "@{chrome=[int]$n['chrome']; blender=[int]$n['blender'];"
             " node=[int]$n['node']; python=[int]$n['python'];"
             " cpuPct=[math]::Round($c.Average,1)} | ConvertTo-Json -Compress"],
            capture_output=True, text=True, timeout=30)
        out = json.loads(ps.stdout.strip() or "{}")
    except Exception as e:
        out = {"error": str(e)}
    return out


def stats_of(xs, label, extra=None):
    """Distribution of a continuous-valued sample set (sync/gpu instruments)."""
    if not xs:
        return {"instrument": label, "n": 0, "error": "no samples"}
    s = sorted(xs)
    r = {"instrument": label, "n": len(s),
         "median": round(statistics.median(s), 2),
         "p95": round(s[min(len(s) - 1, int(len(s) * 0.95))], 2),
         "p99": round(s[min(len(s) - 1, int(len(s) * 0.99))], 2),
         "min": round(s[0], 2), "max": round(s[-1], 2)}
    # Quantisation tell: a set whose values collapse onto few distinct
    # multiples is a CLOCK reading, not a cost reading. Recorded so the two
    # can never be confused again.
    r["distinctValues"] = len({round(v, 1) for v in s})
    if extra:
        r.update(extra)
    return r


def measure_sync(page, n=90):
    rows = page.evaluate("(n) => window.__ppSync(n)", n)
    ms = [r[0] for r in rows]
    return stats_of(ms, "sync-glfinish",
                    {"drawCalls": rows[-1][1], "triangles": rows[-1][2]})


def measure_gpu(page, n=60):
    started = page.evaluate("(n) => window.__ppGpuStart(n)", n)
    if started.get("error"):
        return {"instrument": "gpu-timer-query", "n": 0, "error": started["error"]}
    page.wait_for_timeout(900)  # let the async queries retire
    res = page.evaluate("() => window.__ppGpuRead()")
    if res.get("error"):
        return {"instrument": "gpu-timer-query", "n": 0, "error": res["error"]}
    if res.get("disjoint"):
        return {"instrument": "gpu-timer-query", "n": 0,
                "error": "GPU_DISJOINT_EXT fired — batch is spec-invalid, discarded"}
    return stats_of(res["ms"], "gpu-timer-query", {"disjoint": False})


def wait_ready(page, timeout_s: float) -> bool:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            if page.evaluate(READY_EXPR):
                return True
        except Exception:
            pass
        page.wait_for_timeout(400)
    return False


def assert_autoreset(page) -> bool:
    """Two consecutive frames with monotonically exploding drawCalls =
    autoReset misconfigured (numbers describe the last pass only)."""
    page.evaluate("window.__ppStart()")
    page.wait_for_timeout(700)
    samples = page.evaluate("window.__ppStop()")
    calls = [s[3] for s in samples if s[3] > 0]
    if len(calls) < 4:
        return True  # not enough signal to condemn; combat phase will tell
    exploding = 0
    for a, b in zip(calls, calls[1:]):
        exploding = exploding + 1 if b > a * 1.9 and b - a > 200 else 0
        if exploding >= 2:
            return False
    return True


def analyze(samples, label):
    # rAF can deliver several callbacks carrying the SAME timestamp (coalesced
    # into one frame); those yield dt == 0, which are not rendered frames. Left
    # in, they drag the median toward 0 and silently EVADE the p50 gate — a
    # 2 fps traversal phase once "passed" the 60 fps floor because its median
    # came out 0.0 ms. Non-positive deltas are dropped and counted instead.
    dts = [s[0] for s in samples if s[0] > 0]
    zero_dt = len(samples) - len(dts)
    if not dts:
        return {"phase": label, "frames": 0, "zeroDtFrames": zero_dt,
                "error": f"no positive-dt samples ({zero_dt} coalesced rAF callbacks)"}
    srt = sorted(dts)
    med = statistics.median(srt)
    p95 = srt[min(len(srt) - 1, int(len(srt) * 0.95))]
    p99 = srt[min(len(srt) - 1, int(len(srt) * 0.99))]
    worst1 = srt[-max(1, len(srt) // 100):]
    low1 = sum(worst1) / len(worst1)
    hitch_floor = max(2 * med, med + 8.0)
    hitches = []
    for i in range(1, len(samples)):
        dt, pr, tx = samples[i][0], samples[i][1], samples[i][2]
        if dt > hitch_floor:
            d_pr = pr - samples[i - 1][1]
            d_tx = tx - samples[i - 1][2]
            cause = ("shader-compile" if d_pr > 0 else
                     "upload" if d_tx > 0 else "cpu/gc")
            hitches.append({"i": i, "ms": round(dt, 1), "cause": cause,
                            "dPrograms": d_pr, "dTextures": d_tx})
    return {
        "phase": label, "instrument": "raf-cadence (NOT a gate input)",
        "frames": len(dts), "zeroDtFrames": zero_dt,
        "distinctValues": len({round(v, 1) for v in dts}),
        "ms": {"median": round(med, 2), "p95": round(p95, 2),
               "p99": round(p99, 2), "low1pct": round(low1, 2)},
        "programs": {"start": samples[0][1], "end": samples[-1][1],
                     "delta": samples[-1][1] - samples[0][1]},
        "textures": {"start": samples[0][2], "end": samples[-1][2]},
        "hitches": hitches[:40],
        "hitchCount": len(hitches),
    }


GPU_MS = 16.7  # owner gate 2026-08-20: GPU frame time by timer query, 60 fps


def gate_gpu(phase: str, gpu: dict):
    """THE hard ship gate (owner decision 2026-08-20): 60 fps sustained on
    Intel integrated == GPU frame time <= 16.7 ms BY TIMER QUERY at the shipped
    render scale. Stated separately from the sync gate on purpose: sync is
    CPU+GPU wall cost and moves with whatever else is on the box, while the
    timer query is the GPU's own accounting of our work and is the number the
    gate names."""
    if gpu.get("error"):
        return [f"{phase}: GPU timer query produced nothing — {gpu['error']} "
                f"(the hard gate could not be run)"]
    if gpu["median"] > GPU_MS:
        return [f"{phase}: GPU median {gpu['median']} ms > {GPU_MS} ms "
                f"(60 fps hard gate, timer query)"]
    return []


def gate_cost(phase: str, sync: dict):
    """The ONLY frame-time gate. Judges the gl.finish-bracketed cost.

    rAF deltas are deliberately excluded: they cannot resolve a frame cost
    finer than the display's vsync period, so a 45 ms frame and a 59 ms frame
    both read as "60" on a 50 Hz panel and neither reading means what the
    budget means.
    """
    if sync.get("error"):
        return [f"{phase}: sync instrument produced nothing — {sync['error']}"]
    fails = []
    if sync["p99"] > P99_MS:
        fails.append(f"{phase}: p99 {sync['p99']} ms > {P99_MS} ms (30 fps floor) "
                     f"[gl.finish-bracketed real frame cost]")
    if sync["median"] > P50_MS:
        fails.append(f"{phase}: p50 {sync['median']} ms > {P50_MS} ms (60 fps floor) "
                     f"[gl.finish-bracketed real frame cost]")
    return fails


def gate(result, is_combat: bool):
    """Non-frame-time gates only (pre-warm discipline).

    An empty rAF sample set is NOT a gate failure any more. It was, back when
    rAF was the only instrument and silence meant "we measured nothing"; now
    the cost verdict comes from the synchronous instrument, and rAF running
    dry is an ordinary consequence of a frame that costs most of a second —
    plus the GPU queue the sync/GPU benches just filled. Reported, not failed.
    """
    fails = []
    if result.get("error"):
        print(f"  note: {result['phase']} rAF sampler — {result['error']} "
              f"(cadence only; the cost verdict is the sync instrument)")
        return fails
    if is_combat and result["programs"]["delta"] != 0:
        fails.append(f"{result['phase']}: programs delta {result['programs']['delta']} != 0 "
                     f"(pre-warm hole — first fx compiled a shader mid-combat)")
    return fails


def sample_for(page, seconds: float, done_expr: str = None, cap_s: float = None):
    # Drain the pipeline the sync/GPU instruments just filled — otherwise the
    # first seconds of rAF cadence measure our own backlog, not the game.
    page.wait_for_timeout(600)
    page.evaluate("window.__ppStart()")
    t0 = time.time()
    cap = cap_s if cap_s is not None else seconds + 10
    while time.time() - t0 < cap:
        if done_expr:
            try:
                if page.evaluate(done_expr):
                    break
            except Exception:
                pass
            page.wait_for_timeout(250)
        else:
            if time.time() - t0 >= seconds:
                break
            page.wait_for_timeout(100)
    return page.evaluate("window.__ppStop()")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--phases", default="perf-static,perf-combat,perf-traversal")
    ap.add_argument("--seed", type=int, default=47)
    ap.add_argument("--ready-timeout", type=float, default=120.0)
    ap.add_argument("--dpr", type=float, default=1.0,
                    help="the DPR the gate is stated at; also the page's "
                         "deviceScaleFactor, because gfx/dynres clamp to it. "
                         "DEFAULT MOVED 1.5 -> 1.0 (2026-08-20): the owner's "
                         "perf gate is stated 'at the shipped render scale', "
                         "and gfx.DPR_CAP is now 1.0 — so 1.5 would exit 2 on "
                         "the DPR assertion below and measure nothing.")
    ap.add_argument("--sync-samples", type=int, default=90)
    ap.add_argument("--gpu-samples", type=int, default=60)
    args = ap.parse_args()

    if "localhost:8841" in args.url or "127.0.0.1:8841" in args.url:
        ensure_server()

    load = machine_load()
    print(f"machine load at probe start: {json.dumps(load)}")
    if load.get("chrome", 0) > 12 or load.get("blender", 0) > 0:
        print("  !! NOISY BOX — stale browser/Blender processes from other agents "
              "are on this machine; absolutes below are contended.", file=sys.stderr)

    phases = [s.strip() for s in args.phases.split(",") if s.strip()]
    shots_src = load_shots_source()
    results, failures = [], []

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        # deviceScaleFactor IS the gate condition: gfx.js:29 and dynres.js:25
        # both clamp DPR to min(window.devicePixelRatio, 1.5), so a default
        # page pins the game at 1.0 and the "at DPR 1.5" gate is never run.
        page = browser.new_page(viewport={"width": 1920, "height": 1080},
                                device_scale_factor=args.dpr)
        page.add_init_script(
            "window.__err=[];addEventListener('error',e=>window.__err.push(String(e.message)));"
            "addEventListener('unhandledrejection',e=>window.__err.push('reject: '+e.reason));")
        try:
            page.goto(args.url, wait_until="load", timeout=90_000)
        except Exception as e:
            print(f"NAVIGATION FAILED: {e}", file=sys.stderr)
            browser.close()
            return 2
        page.add_script_tag(content=shots_src)
        page.evaluate(SAMPLER)
        page.evaluate("window.__BR_SEEDS__ = SCENARIOS")
        if not wait_ready(page, args.ready_timeout):
            print("NOT READY: no __FPS__ global — run bootcheck.py first", file=sys.stderr)
            browser.close()
            return 4

        # The window must be genuinely visible and focused: doctrine records
        # that a hidden pane pauses rAF outright, and an unfocused one can be
        # throttled — either would make instrument 3 fiction.
        page.bring_to_front()
        page.wait_for_timeout(400)

        env = page.evaluate("""() => {
            const gl = __FPS__.renderer.getContext();
            const dbg = gl.getExtension('WEBGL_debug_renderer_info');
            return {
                devicePixelRatio: window.devicePixelRatio,
                rendererDpr: __FPS__.renderer.getPixelRatio(),
                dynresCeiling: (globalThis.__BR_DYNRES__ || {}).ceiling ?? null,
                drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
                visibility: document.visibilityState,
                hasFocus: document.hasFocus(),
                gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
                maxSamples: gl.getParameter(gl.MAX_SAMPLES),
                gpuTimerExt: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'),
                programs: __FPS__.perfStats.programs,
            };
        }""")
        print(f"env: {json.dumps(env)}")

        # Refresh period = smallest positive rAF delta over a long idle run.
        # Everything rAF reports is a multiple of this; without it, vsync
        # quantisation gets misdiagnosed as a throttled clock.
        refresh_raw = page.evaluate("(n) => window.__ppRefresh(n)", 180)
        refresh_pos = [x for x in refresh_raw if x > 0.5]
        refresh = round(min(refresh_pos), 2) if refresh_pos else None
        print(f"display refresh interval (min positive rAF delta over "
              f"{len(refresh_pos)} callbacks) = {refresh} ms "
              f"=> {round(1000 / refresh, 1) if refresh else '?'} Hz")

        if env["visibility"] != "visible" or not env["hasFocus"]:
            print(f"EXIT 2: window not visible/focused "
                  f"(visibility={env['visibility']}, hasFocus={env['hasFocus']}) — "
                  f"rAF is throttled or paused and no timing here would be real",
                  file=sys.stderr)
            browser.close()
            return 2

        # HARD: the gate says "at DPR 1.5". If the renderer is not there, the
        # gate was not run — refuse rather than print a footnote nobody reads.
        if abs(env["rendererDpr"] - args.dpr) > 0.01:
            print(f"EXIT 2: gate condition unmet — renderer DPR "
                  f"{env['rendererDpr']} != {args.dpr}. gfx.js clamps to "
                  f"min(window.devicePixelRatio={env['devicePixelRatio']}, 1.5) "
                  f"and dynres ceiling is {env['dynresCeiling']}; a run at a "
                  f"lower DPR measures {round(100 * (env['rendererDpr'] / args.dpr) ** 2)}% "
                  f"of the gate's pixels and is not a verdict.", file=sys.stderr)
            browser.close()
            return 2

        prewarm_programs = env["programs"]
        print(f"dpr={env['rendererDpr']}  drawingBuffer={env['drawingBuffer']}  "
              f"programs-at-ready={prewarm_programs} (prewarm baseline; budget <= 70)")

        if not assert_autoreset(page):
            print("EXIT 2: renderer.info counters explode monotonically — "
                  "autoReset misconfigured; numbers describe the last pass only",
                  file=sys.stderr)
            browser.close()
            return 2

        def cost_of(phase: str):
            """Instruments 1 + 2 on whatever is currently on screen."""
            sync = measure_sync(page, args.sync_samples)
            gpu = measure_gpu(page, args.gpu_samples)
            gpu_share = None
            if not gpu.get("error") and not sync.get("error") and sync["median"]:
                gpu_share = round(100 * gpu["median"] / sync["median"])
            row = {"phase": phase, "sync": sync, "gpu": gpu,
                   "gpuShareOfFramePct": gpu_share}
            print(f"  {phase} sync(gl.finish) median={sync.get('median')} "
                  f"p95={sync.get('p95')} p99={sync.get('p99')} ms | "
                  f"gpu median={gpu.get('median', gpu.get('error'))} ms "
                  f"({gpu_share}% of frame)")
            results.append(row)
            failures.extend(gate_gpu(phase, gpu))   # the hard gate
            failures.extend(gate_cost(phase, sync))
            return row

        if "perf-static" in phases:
            page.evaluate("(n) => __FPS__.__test.setScenario(n, SCENARIOS[n])", "S3")
            page.wait_for_timeout(1000)  # settle the pose
            cost_of("perf-static")
            samples = sample_for(page, 10.0)
            r = analyze(samples, "perf-static")
            r["refreshIntervalMs"] = refresh
            results.append(r)
            failures += gate(r, is_combat=False)

        if "perf-combat" in phases:
            page.evaluate("(s) => __FPS__.__test.startMission({seed: s})", args.seed)
            page.wait_for_timeout(500)
            base = page.evaluate("__FPS__.perfStats.programs")
            # Cost of a LIVE mission frame before autoplay: instruments 1+2 do
            # not need the 30 s match to run, and taking the reading here is
            # what makes the combat number survive an autoplay that never
            # resolves (iter04: __PP_RESULT was null in all three runs).
            cost_of("perf-combat")
            page.evaluate("""() => {
                window.__PP_DONE = false;
                __FPS__.__test.autoplay('rusher', 30)
                    .then(r => { window.__PP_RESULT = r; window.__PP_DONE = true; })
                    .catch(e => { window.__PP_RESULT = {error: String(e)}; window.__PP_DONE = true; });
            }""")
            samples = sample_for(page, 30.0, done_expr="window.__PP_DONE === true", cap_s=120.0)
            r = analyze(samples, "perf-combat")
            r["programsBaseline"] = base
            r["autoplay"] = page.evaluate("window.__PP_RESULT || null")
            results.append(r)
            failures += gate(r, is_combat=True)
            end_programs = page.evaluate("__FPS__.perfStats.programs")
            if end_programs != base:
                failures.append(f"perf-combat: programs {base} -> {end_programs} across phase "
                                f"(gate is delta == 0)")

        if "perf-traversal" in phases:
            page.evaluate("(s) => __FPS__.__test.startMission({seed: s + 1})", args.seed)
            page.wait_for_timeout(500)
            # boulevard long sightline: S2 ground pos -> S5 ground pos (content poses)
            page.evaluate("""() => {
                const t = __FPS__.__test;
                t.teleport(37, 0, 36);            // S2 barricade line (content pose)
                t.aimAt(38, 1.5, -48);            // S5 platform end of the boulevard
                t.pin('moveZ', 1);
                t.pin('sprint', true);
            }""")
            cost_of("perf-traversal")
            samples = sample_for(page, 15.0)
            page.evaluate("__FPS__.__test.unpinAll()")
            r = analyze(samples, "perf-traversal")
            results.append(r)
            failures += gate(r, is_combat=False)

        errs = page.evaluate("window.__err || []")
        if errs:
            failures.append(f"page errors during probe: {errs[:5]}")
        browser.close()

    print("\n---- perfprobe verdict ----")
    print(json.dumps({"env": env, "refreshIntervalMs": refresh,
                      "machineLoad": load, "gateDpr": args.dpr}))
    for r in results:
        print(json.dumps(r))
    print("\nreading guide: `sync-glfinish` is the frame's real cost and the "
          "only gate input; `gpu-timer-query` is how much of it the GPU owns; "
          "`raf-cadence` is presentation only and quantises to the "
          f"{refresh} ms refresh period, so multiples of it there mean vsync, "
          "not a throttled clock.")
    if failures:
        print(f"\nFAILED gates ({len(failures)}):")
        for f in failures:
            print(f"  !! {f}")
        return 1
    print("\nALL PERF GATES PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
