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

Exit: 0 = all gates pass; 1 = a gate failed; 2 = autoReset misconfigured or
navigation failure; 4 = surface NOT READY.
"""
import argparse, json, os, re, statistics, sys, time
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
})();
"""


def load_shots_source() -> str:
    src = open(os.path.join(HERE, "shots.js"), encoding="utf-8").read()
    return re.sub(r"^export\s+", "", src, flags=re.M)


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
        "phase": label, "frames": len(dts), "zeroDtFrames": zero_dt,
        "ms": {"median": round(med, 2), "p95": round(p95, 2),
               "p99": round(p99, 2), "low1pct": round(low1, 2)},
        "programs": {"start": samples[0][1], "end": samples[-1][1],
                     "delta": samples[-1][1] - samples[0][1]},
        "textures": {"start": samples[0][2], "end": samples[-1][2]},
        "hitches": hitches[:40],
        "hitchCount": len(hitches),
    }


def gate(result, is_combat: bool):
    fails = []
    if result.get("error"):
        return [f"{result['phase']}: {result['error']}"]
    ms = result["ms"]
    if ms["p99"] > P99_MS:
        fails.append(f"{result['phase']}: p99 {ms['p99']} ms > {P99_MS} ms (30 fps floor)")
    if ms["median"] > P50_MS:
        fails.append(f"{result['phase']}: p50 {ms['median']} ms > {P50_MS} ms (60 fps floor)")
    if is_combat and result["programs"]["delta"] != 0:
        fails.append(f"{result['phase']}: programs delta {result['programs']['delta']} != 0 "
                     f"(pre-warm hole — first fx compiled a shader mid-combat)")
    return fails


def sample_for(page, seconds: float, done_expr: str = None, cap_s: float = None):
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
    args = ap.parse_args()

    if "localhost:8841" in args.url or "127.0.0.1:8841" in args.url:
        ensure_server()

    phases = [s.strip() for s in args.phases.split(",") if s.strip()]
    shots_src = load_shots_source()
    results, failures = [], []

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        page = browser.new_page(viewport={"width": 1920, "height": 1080})
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

        dpr = page.evaluate("__FPS__.renderer.getPixelRatio()")
        prewarm_programs = page.evaluate("__FPS__.perfStats.programs")
        print(f"dpr={dpr}  programs-at-ready={prewarm_programs} "
              f"(prewarm baseline; budget <= 70)")

        if not assert_autoreset(page):
            print("EXIT 2: renderer.info counters explode monotonically — "
                  "autoReset misconfigured; numbers describe the last pass only",
                  file=sys.stderr)
            browser.close()
            return 2

        if "perf-static" in phases:
            page.evaluate("(n) => __FPS__.__test.setScenario(n, SCENARIOS[n])", "S3")
            page.wait_for_timeout(1000)  # settle the pose
            samples = sample_for(page, 10.0)
            r = analyze(samples, "perf-static")
            results.append(r)
            failures += gate(r, is_combat=False)

        if "perf-combat" in phases:
            page.evaluate("(s) => __FPS__.__test.startMission({seed: s})", args.seed)
            page.wait_for_timeout(500)
            base = page.evaluate("__FPS__.perfStats.programs")
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
    for r in results:
        print(json.dumps(r))
    if failures:
        print(f"\nFAILED gates ({len(failures)}):")
        for f in failures:
            print(f"  !! {f}")
        return 1
    print("\nALL PERF GATES PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
