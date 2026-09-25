#!/usr/bin/env python
"""DYEFIELD perf check — the brief's "60 fps on a mid laptop", measured at the player's layer.

    python _harness/perfcheck.py --headless              # headless Chrome (the real Intel GPU on this box)
    python _harness/perfcheck.py                         # headed Chrome (one headed Chrome at a time)
    python _harness/perfcheck.py --headless --label legacy --query quality=high --query merge=0
    python _harness/perfcheck.py --headless --chrome-arg=--force_high_performance_gpu   # experiment

Refuses to run (exit 3, and says why) while another automated Chrome is alive: a chrome.exe browser
process with --remote-debugging-pipe or --enable-automation and no --type= (the orchestrator's
scan). A second automated Chrome shares the GPU (the numbers are contaminated) and a headed one steals
OS focus. --wait-clear N polls for up to N seconds for it to exit first.

Flow: load /?map=pier18&dev=1 at 1600x900, wait for 'ready', __DF__.start() (dev: play without pointer
lock), wait out the match countdown (the 7 bots start painting and fighting), let it settle 8 s, then
three sampling windows (8 runners + all FX live in every one):
    stand  10 s at spawn, no input
    walk   10 s holding a REAL KeyW (page.keyboard.down/up → the game's Input → the sim)
    fire   10 s holding REAL KeyW + LMB (the MIST-RASP: droplets, splats, muzzle mist)
A page-side recorder stores EVERY requestAnimationFrame delta and samples the renderer counters
(__DF__.render(): draw calls, triangles, adaptive render scale, drawing-buffer size) every 250 ms.
Prints per window: frames, avg fps, frame-time p50 / p90 / p99 / max, the share of frames over 20 ms,
draw calls, triangles, the adaptive scale; plus the WebGL renderer string and a powerPreference probe
(UNMASKED_RENDERER_WEBGL of a 'default', a 'low-power' and a 'high-performance' WebGL2 context, and
what WebGPU's high-performance adapter would be).
Exit: 0 measured (and --gate-fps met, when given) · 1 --gate-fps missed · 2 setup failed · 3 refused ·
4 contaminated (another automated Chrome appeared during the windows).
"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (GpuShare, HarnessError, Session, add_common_args, automated_chromes, build_url,  # noqa: E402
                    chrome_gpu_pids, describe_chromes, diag_problems, fmt, match_info, own_browser_pids, print_diagnostics,
                    save_report, wait_match_phase)

RECORDER_JS = r"""() => {
  if (window.__PF__) return true;
  const P = window.__PF__ = { on: false, dts: [], stats: [], last: -1 };
  const f = (ts) => {
    if (P.on) { if (P.last >= 0) P.dts.push(ts - P.last); P.last = ts; } else P.last = -1;
    requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
  setInterval(() => {
    if (!P.on) return;
    try {
      const D = window.__DF__, r = D.render() || {}, R = D.dev && D.dev.renderer, c = document.getElementById('game');
      P.stats.push({ calls: r.calls, tris: r.triangles, fps: r.fps,
        scale: (typeof r.scale === 'number') ? r.scale : (R ? R.getPixelRatio() : null),
        quality: r.quality ?? null, buf: c ? [c.width, c.height] : null });
    } catch (e) { P.stats.push({ error: String(e) }); }
  }, 250);
  return true;
}"""

PROBE_JS = r"""async () => {
  const out = { webgl: {}, webgpu: null };
  for (const pp of ['default', 'low-power', 'high-performance']) {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2', { powerPreference: pp });
      if (!gl) { out.webgl[pp] = 'no context'; continue; }
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      out.webgl[pp] = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
    } catch (e) { out.webgl[pp] = 'error: ' + e; }
  }
  try {
    if (navigator.gpu) {
      const res = {};
      for (const pp of ['low-power', 'high-performance']) {
        const a = await navigator.gpu.requestAdapter({ powerPreference: pp });
        const i = a && (a.info || (a.requestAdapterInfo ? await a.requestAdapterInfo() : null));
        res[pp] = a ? [i && i.vendor, i && i.architecture, i && i.device, i && i.description].filter(Boolean).join(' / ') || '(adapter, no info)' : 'no adapter';
      }
      out.webgpu = res;
    } else out.webgpu = 'navigator.gpu unavailable';
  } catch (e) { out.webgpu = 'error: ' + e; }
  return out;
}"""


def pct(sorted_vals, p):
    """linear-interpolated percentile of an already sorted list"""
    if not sorted_vals:
        return None
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    k = (len(sorted_vals) - 1) * p / 100.0
    lo = int(k)
    hi = min(lo + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (k - lo)


def summarize(win):
    dts = [d for d in (win.get("dts") or []) if isinstance(d, (int, float)) and d > 0]
    st = [s for s in (win.get("stats") or []) if isinstance(s, dict) and "error" not in s]
    s = sorted(dts)
    total = sum(dts)
    out = {
        "frames": len(dts),
        "seconds": total / 1000.0,
        "avgFps": (1000.0 * len(dts) / total) if total > 0 else None,
        "p50": pct(s, 50), "p90": pct(s, 90), "p99": pct(s, 99), "max": s[-1] if s else None,
        "over20": (sum(1 for d in dts if d > 20.0) / len(dts)) if dts else None,
        "over33": (sum(1 for d in dts if d > 33.4) / len(dts)) if dts else None,
        "p5": pct(s, 5),
    }

    def col(k):
        return [x[k] for x in st if isinstance(x.get(k), (int, float))]
    calls, tris, scales = col("calls"), col("tris"), col("scale")
    out["calls"] = {"median": pct(sorted(calls), 50), "max": max(calls) if calls else None}
    out["triangles"] = {"median": pct(sorted(tris), 50), "max": max(tris) if tris else None}
    out["scale"] = {"start": scales[0] if scales else None, "end": scales[-1] if scales else None,
                    "min": min(scales) if scales else None, "max": max(scales) if scales else None}
    bufs = [x.get("buf") for x in st if x.get("buf")]
    out["buffer"] = {"start": bufs[0] if bufs else None, "end": bufs[-1] if bufs else None}
    q = [x.get("quality") for x in st if x.get("quality")]
    out["quality"] = q[-1] if q else None
    out["stateErrors"] = [x["error"] for x in (win.get("stats") or []) if isinstance(x, dict) and "error" in x][:3]
    out["gpuShare"] = win.get("gpuShare")
    return out


GPU_PIDS = set()


def record(sess, seconds):
    """one sampling window; also samples the OS GPU 3D-engine share (ours vs other processes)"""
    share = GpuShare(seconds)
    sess.js("() => { const P = window.__PF__; P.dts = []; P.stats = []; P.last = -1; P.on = true; }")
    time.sleep(seconds)
    w = sess.js("() => { const P = window.__PF__; P.on = false; return { dts: P.dts.slice(), stats: P.stats.slice() }; }")
    w["gpuShare"] = share.result(GPU_PIDS)
    return w


def wait_clear(max_s):
    """Poll the process scan until no other automated Chrome is alive (or max_s passes)."""
    t0 = time.time()
    while True:
        found, err = automated_chromes()
        if err or not found or time.time() - t0 >= max_s:
            return found, err, time.time() - t0
        time.sleep(5.0)


def line(label, w):
    sc = w["scale"]
    scale_txt = ("%s → %s (min %s, max %s)" % (fmt(sc["start"], 3), fmt(sc["end"], 3), fmt(sc["min"], 3), fmt(sc["max"], 3))
                 if sc["start"] is not None else "—")
    buf = w["buffer"]
    g = w.get("gpuShare") or {}
    gl = ("\n       OS GPU 3D engine: Chrome %s%% · other processes %s%% (%s)" % (
        g.get("ours"), g.get("others"), ", ".join("%s %s%%" % t for t in (g.get("top") or []))) if g and "error" not in g else "")
    return ("%-5s: %4d frames / %5.2f s · avg %5.1f fps · frame ms p50 %5.2f  p90 %5.2f  p99 %5.2f  max %6.2f · "
            ">20 ms %4.1f%% · >33 ms %4.1f%%\n       draw calls %s (max %s) · triangles %s (max %s) · scale %s · buffer %s → %s" % (
                label, w["frames"], w["seconds"], w["avgFps"] or 0, w["p50"] or 0, w["p90"] or 0, w["p99"] or 0, w["max"] or 0,
                100 * (w["over20"] or 0), 100 * (w["over33"] or 0),
                fmt(w["calls"]["median"], 0), w["calls"]["max"], fmt(w["triangles"]["median"], 0), w["triangles"]["max"],
                scale_txt, buf["start"], buf["end"])) + gl


def main() -> int:
    ap = argparse.ArgumentParser(description="DYEFIELD perf check (frame times at spawn + walking)")
    add_common_args(ap)
    ap.add_argument("--map", default="pier18")
    ap.add_argument("--settle", type=float, default=8.0, help="seconds in play before sampling")
    ap.add_argument("--stand", type=float, default=10.0, help="sampling window standing at spawn")
    ap.add_argument("--walk", type=float, default=10.0, help="sampling window walking forward (real KeyW)")
    ap.add_argument("--fire", type=float, default=10.0, help="sampling window walking + firing (real KeyW + LMB); 0 = skip")
    ap.add_argument("--gate-p99", type=float, default=None, help="exit 1 when any window's frame-time p99 (ms) is above this")
    ap.add_argument("--query", action="append", default=[], metavar="K=V",
                    help="extra URL query parameter (repeatable), e.g. --query quality=high")
    ap.add_argument("--label", default="", help="report name suffix: _harness/_reports/perfcheck_<label>.json")
    ap.add_argument("--wait-clear", type=float, default=0.0,
                    help="seconds to wait for other automated Chromes to exit before refusing")
    ap.add_argument("--gate-fps", type=float, default=None, help="exit 1 when either window's avg fps is below this")
    ap.add_argument("--force-beside-others", action="store_true",
                    help="measure even while another automated Chrome is alive (after --wait-clear). The result is "
                         "labelled CONTAMINATED and exits 4 — for relative A/B runs on a shared box only")
    ap.add_argument("--wait", type=float, default=90.0, help="seconds to wait for 'ready'")
    ap.add_argument("--uncapped", action="store_true",
                    help="add --disable-gpu-vsync --disable-frame-rate-limit: rAF runs as fast as the GPU allows, so "
                         "the numbers show real headroom above 60 fps (this box's only display runs at 50 Hz)")
    args = ap.parse_args()
    if args.uncapped:
        args.chrome_arg = list(args.chrome_arg) + ["--disable-gpu-vsync", "--disable-frame-rate-limit"]
    if args.width == 1280 and args.height == 720:          # common.py defaults → this check's 1600x900
        args.width, args.height = 1600, 900

    extra = {}
    for kv in args.query:
        k, _, v = kv.partition("=")
        if k:
            extra[k] = v
    url = build_url(args.base, map=args.map, dev=1, **extra)
    mode = ("headless" if args.headless else "headed") + ("-uncapped" if args.uncapped else "")
    name = "perfcheck_%s" % (args.label or mode)

    # ── pre-flight: never measure beside another automated Chrome
    found, err, waited = wait_clear(max(0.0, args.wait_clear))
    print("pre-flight   : other automated Chrome processes: %s%s" % (
        describe_chromes(found, err), (" (after waiting %.0f s)" % waited) if args.wait_clear > 0 else ""))
    if err:
        print("REFUSED: could not scan for other automated Chromes (%s) — not measuring blind" % err)
        print("RESULT: REFUSED")
        return 3
    if found and not args.force_beside_others:
        print("REFUSED: another automated Chrome is alive (%s). Its GPU work and (headed) window focus "
              "would contaminate the frame times. Re-run when it has exited (or pass --wait-clear 600)."
              % describe_chromes(found))
        print("RESULT: REFUSED")
        return 3
    if found:
        print("FORCED       : measuring beside %d other automated Chrome(s) — the numbers are CONTAMINATED" % len(found))

    sess = Session(args, "perfcheck")
    try:
        sess.start()
    except Exception as e:
        sess.close()
        print("SETUP FAILED: %s" % (str(e) if isinstance(e, HarnessError) else repr(e)))
        print("RESULT: FAIL")
        return 2
    rep = {"url": url, "mode": mode, "size": [args.width, args.height], "chromeArgs": args.chrome_arg}
    fatal = None
    # our own browser process = the automated Chrome(s) that appeared with sess.start(); any OTHER one
    # seen during the windows contaminates the numbers (checked between and after the windows)
    already = {c["pid"] for c in (found or [])}
    own = own_browser_pids() or ({c["pid"] for c in (automated_chromes()[0] or [])} - already)
    intruders = {c["pid"]: dict(c, seen="at start (forced)") for c in (found or [])}

    def intruder_scan(when):
        f, e = automated_chromes(exclude=own)
        for c in f:
            intruders.setdefault(c["pid"], dict(c, seen=when))
    try:
        sess.goto(url)
        if not sess.wait_df(args.wait):
            fatal = "window.__DF__ never appeared"
        if not fatal:
            ok, ph = sess.wait_phase("ready", args.wait)
            if not ok:
                fatal = "never reached 'ready' (phase %r): %s" % (ph, str((sess.state() or {}).get("error"))[:800])
        if not fatal:
            okc, v = sess.df("start")
            ok, ph = sess.wait_phase("play", 5.0)
            if not ok:
                fatal = "__DF__.start() did not enter play (%s; phase %r)" % (v, ph)
            else:
                okm, mph = wait_match_phase(sess, ("live", "ended"), 20.0)
                rep["matchPhase"] = mph
                if not okm:
                    fatal = "the match never went live (phase %r)" % mph
        if not fatal:
            GPU_PIDS.update(chrome_gpu_pids())
            sess.js(RECORDER_JS)
            rep["probe"] = sess.safe_js(PROBE_JS, default=None)
            time.sleep(max(0.0, args.settle))
            p0 = (sess.state() or {}).get("player") or {}
            intruder_scan("before the stand window")
            rep["stand"] = summarize(record(sess, args.stand))
            intruder_scan("after the stand window")
            p1 = (sess.state() or {}).get("player") or {}
            sess.page.keyboard.down("KeyW")
            try:
                rep["walk"] = summarize(record(sess, args.walk))
            finally:
                sess.page.keyboard.up("KeyW")
            intruder_scan("after the walk window")
            time.sleep(0.3)
            p2 = (sess.state() or {}).get("player") or {}
            if args.fire > 0:
                sess.page.mouse.move(args.width / 2, args.height / 2)
                sess.page.keyboard.down("KeyW")
                sess.page.mouse.down(button="left")
                try:
                    rep["fire"] = summarize(record(sess, args.fire))
                finally:
                    sess.page.mouse.up(button="left")
                    sess.page.keyboard.up("KeyW")
                intruder_scan("after the fire window")
            m = match_info(sess) or {}
            rep["match"] = {"phase": m.get("phase"), "timeLeft": m.get("timeLeft"), "events": m.get("events"),
                            "alive": sum(1 for r in (m.get("runners") or []) if r.get("alive")), "coverage": m.get("coverage")}
            rep["walkMetres"] = ((p2.get("x", 0) - p1.get("x", 0)) ** 2 + (p2.get("z", 0) - p1.get("z", 0)) ** 2) ** 0.5 if p1 and p2 else None
            rep["positions"] = {"settled": p0, "walkFrom": p1, "walkTo": p2}
            rep["standDrift"] = ((p1.get("x", 0) - p0.get("x", 0)) ** 2 + (p1.get("z", 0) - p0.get("z", 0)) ** 2) ** 0.5 if p0 and p1 else None
            rep["render"] = sess.df("render")[1]
            rep["phaseAfter"] = sess.phase()
            rep["version"] = sess.safe_js("() => window.__DF__.version")
            rep["dpr"] = sess.safe_js("() => window.devicePixelRatio")
    except Exception as e:
        fatal = "harness error: %s" % str(e).splitlines()[0][:400]
    finally:
        diag = sess.diagnostics() if sess.page else {}
        sess.close()

    r = rep.get("render") or {}
    print("=" * 96)
    print("URL          : %s" % url)
    print("mode         : %s Chrome (d3d11) %dx%d · devicePixelRatio %s%s" % (
        mode, args.width, args.height, rep.get("dpr"), (" · extra switches %s" % " ".join(args.chrome_arg)) if args.chrome_arg else ""))
    print("version      : %s" % rep.get("version"))
    print("renderer     : %s" % (r.get("gpu") if isinstance(r, dict) else "—"))
    pr = rep.get("probe") or {}
    if pr:
        wg = pr.get("webgl") or {}
        print("powerPref    : WebGL2 default → %s" % wg.get("default"))
        print("               WebGL2 low-power → %s" % wg.get("low-power"))
        print("               WebGL2 high-performance → %s" % wg.get("high-performance"))
        print("               WebGPU adapters → %s" % json.dumps(pr.get("webgpu")))
    if "stand" in rep:
        p5 = rep["stand"].get("p5")
        if p5:
            print("frame clock  : fastest frames (p5) %.2f ms ≈ %.0f Hz%s" % (
                p5, 1000.0 / p5, " — vsync-capped: fps can never exceed this in this mode" if not args.uncapped else " (uncapped)"))
        print(line("stand", rep["stand"]))
        print(line("walk", rep["walk"]))
        if "fire" in rep:
            print(line("fire", rep["fire"]))
        if rep.get("match"):
            print("match        : %s" % json.dumps(rep["match"], default=str)[:600])
        print("walked       : %s m with a real 10 s KeyW hold (stand drift %s m) · phase after %s" % (
            fmt(rep.get("walkMetres")), fmt(rep.get("standDrift")), rep.get("phaseAfter")))
        if isinstance(r, dict) and "quality" in r:
            print("adaptive     : quality %s · scale %s · floor %s · cap %s · buffer %s" % (
                r.get("quality"), fmt(r.get("scale"), 3), fmt(r.get("scaleMin"), 3), fmt(r.get("scaleMax"), 3), r.get("buffer")))
        else:
            print("adaptive     : (this build reports no adaptive scale; the scale column is renderer.getPixelRatio())")
    print("-" * 96)
    print_diagnostics(diag)
    print("=" * 96)
    rep["diagnostics"] = diag
    rep["fatal"] = fatal
    rep["intruders"] = list(intruders.values())
    if intruders:
        print("CONTAMINATED : another automated Chrome appeared while measuring: %s" % "; ".join(
            "pid %s %s (seen %s)" % (c["pid"], "HEADLESS" if c["headless"] else "HEADED", c["seen"]) for c in intruders.values()))
    print("report       : %s" % save_report(name, rep, args.base))
    if fatal:
        print("RESULT: FAIL — %s" % fatal)
        return 2
    probs = diag_problems(diag)
    for p in probs:
        print("   X %s" % p)
    wins = [k for k in ("stand", "walk", "fire") if k in rep]
    if args.gate_p99 is not None:
        high = [k for k in wins if (rep[k]["p99"] or 1e9) > args.gate_p99]
        if high:
            print("RESULT: FAIL — frame-time p99 above %.1f ms in %s" % (args.gate_p99, ", ".join(
                "%s (%.2f ms)" % (k, rep[k]["p99"] or 0) for k in high)))
            return 1
    if args.gate_fps is not None:
        low = [k for k in wins if (rep[k]["avgFps"] or 0) < args.gate_fps]
        if low:
            print("RESULT: FAIL — avg fps below %.0f in %s" % (args.gate_fps, ", ".join(low)))
            return 1
    if intruders:
        print("RESULT: CONTAMINATED — re-run when no other automated Chrome is alive")
        return 4
    print("RESULT: %s" % ("MEASURED" if not probs else "MEASURED (with page diagnostics above)"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
