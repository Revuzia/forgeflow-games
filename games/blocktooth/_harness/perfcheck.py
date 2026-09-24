#!/usr/bin/env python
"""BLOCKTOOTH perf check — CONTRACT §15 gate 5: Size V + ~250 enemies, p99 frame ≤ 22 ms (headed),
draw calls ≤ 450.

    python _harness/perfcheck.py                         # headed Chrome, molo / grideast
    python _harness/perfcheck.py --titan hearthback --biome lockwater --enemies 300 --seconds 12

Opens /?autostart=1&dev=1&noslate=1, then (dev cheats — allowed here, only DRIVING must be real
input): god on, director spawns off, rank V, and a spawn mix topped up to ~--enemies for the whole
window. Real keys (W, W+D, D, D+S, S, S+A, A, A+W …) drive the titan in circles while the harness
records EVERY requestAnimationFrame delta in the page (its own recorder — independent of the
game's __BT__.perf() ring, which is printed alongside) and samples renderer stats (draws / tris /
programs) every 250 ms.

PASS iff: frame p99 ≤ --p99-ms (22) AND max draws ≤ --draws-max (450) AND the load was real
(titan at Size V and mean live enemies ≥ 80 % of --enemies).
Exit: 0 pass · 1 fail (or the load could not be reached) · 2 setup failed (server/browser/__BT__/cheats).
"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (BIOMES, TITANS, HarnessError, Session, add_common_args, build_url, compact_state,  # noqa: E402
                    dismiss_slate, fmt, percentile, print_diagnostics, save_report, set_rank, ROMAN, SHOTS)

# Spawn mix by share of the target count (the elite is capped at 2: it is one-per-run content).
MIX = [("android", 0.30), ("squad", 0.20), ("drone", 0.18), ("buggy", 0.10), ("apc", 0.06),
       ("tank", 0.08), ("walker", 0.07), ("elite", 0.01)]
CIRCLE = [{"KeyW"}, {"KeyW", "KeyD"}, {"KeyD"}, {"KeyD", "KeyS"}, {"KeyS"}, {"KeyS", "KeyA"}, {"KeyA"}, {"KeyA", "KeyW"}]


def spawn_mix(sess, n, log):
    """Spawn about n enemies following MIX. Returns how many were requested."""
    asked = 0
    for kind, share in MIX:
        k = int(round(n * share))
        if kind == "elite":
            k = min(k, 2)
        if k <= 0:
            continue
        ok, v = sess.cheat("spawn", kind, k)
        if not ok:
            log("cheat.spawn(%s, %d) failed: %s" % (kind, k, v))
            continue
        asked += k
    return asked


def clear_overlay(sess, screen):
    """Real keys: 1 picks the first draft card, Esc resumes an (auto-)pause."""
    sess.release_all()
    if screen == "draft":
        sess.press("Digit1")
    elif screen == "pause":
        sess.press("Escape")
    elif screen == "slate":
        sess.press("Enter")


def main() -> int:
    ap = argparse.ArgumentParser(description="BLOCKTOOTH perf check (gate 5)")
    add_common_args(ap)
    ap.add_argument("--titan", default="molo", choices=TITANS)
    ap.add_argument("--biome", default="grideast", choices=BIOMES)
    ap.add_argument("--seed", type=int, default=5)
    ap.add_argument("--enemies", type=int, default=250)
    ap.add_argument("--seconds", type=float, default=12.0, help="sampling window")
    ap.add_argument("--warm", type=float, default=3.0, help="seconds of driving before sampling")
    ap.add_argument("--p99-ms", type=float, default=22.0)
    ap.add_argument("--draws-max", type=int, default=450)
    ap.add_argument("--shot", default=os.path.join(SHOTS, "perfcheck.png"))
    args = ap.parse_args()

    url = build_url(args.base, autostart=1, dev=1, noslate=1, titan=args.titan, biome=args.biome, seed=args.seed,
                    quality=args.quality)
    logs = []

    def log(msg):
        logs.append(msg)
        print(msg, flush=True)

    sess = Session(args, "perfcheck")
    try:
        sess.start()
    except Exception as e:
        sess.close()
        print("SETUP FAILED: %s" % (str(e) if isinstance(e, HarnessError) else repr(e)))
        print("RESULT: FAIL")
        return 2

    fatal = None
    samples = []
    ft = []
    perf_bt = None
    prog0 = prog1 = None
    top_ups = 0
    st_end = None
    tick0 = tick1 = None
    overlays = {}
    try:
        log("open %s" % url)
        sess.goto(url)
        if not sess.wait_bt(90):
            fatal = "window.__BT__ never appeared"
        sess.events_off()
        if not fatal:
            ok, scr = sess.wait_screen(("play", "slate"), 90)
            if ok and scr == "slate":
                log("noslate not honoured — dismissing the slate with Enter")
                ok, scr = dismiss_slate(sess, 20)
            if not ok:
                fatal = "never reached play (screen=%r)" % (scr,)
        if not fatal:
            for name, a in (("god", (True,)), ("noSpawns", (True,))):
                ok, v = sess.cheat(name, *a)
                if not ok:
                    fatal = "cheat.%s failed: %s" % (name, v)
                    break
        if not fatal:
            ok, r = set_rank(sess, 4, log)
            if ok is False and not isinstance(r, (int, float)):
                fatal = "cheat.rank failed: %s" % (r,)
            elif r != 4:
                log("cheat.rank(4) → state().rank %s (the load check below will flag it)" % (r,))
        if not fatal:
            time.sleep(2.5)                                     # grow tween + camera spring to Size V
            spawn_mix(sess, args.enemies, log)
            time.sleep(0.5)
            s = sess.state() or {}
            log("after spawn: Size %s · enemies %s · draws %s" % (s.get("rank"), s.get("enemies"), s.get("draws")))
            # warm-up drive (compiles, pools, debris)
            t_w = time.time()
            i = 0
            while time.time() - t_w < args.warm:
                sess.hold(CIRCLE[i % len(CIRCLE)])
                i += 1
                time.sleep(0.35)
                s = sess.state() or {}
                if s.get("screen") in ("draft", "pause"):
                    clear_overlay(sess, s.get("screen"))
                    continue
                cur = s.get("enemies") or 0
                if cur < 0.9 * args.enemies:
                    spawn_mix(sess, args.enemies - cur, log)
            s = sess.state() or {}
            prog0 = s.get("programs")
            tick0 = s.get("tick")
            # sampling window
            sess.ft_start()
            t0 = time.time()
            next_dir = t0
            while time.time() - t0 < args.seconds:
                now = time.time()
                if now >= next_dir:
                    sess.hold(CIRCLE[i % len(CIRCLE)])
                    i += 1
                    next_dir = now + 0.35
                s = sess.state() or {}
                samples.append({"t": round(now - t0, 2), "draws": s.get("draws"), "tris": s.get("tris"),
                                "programs": s.get("programs"), "enemies": s.get("enemies"), "fps": s.get("fps"),
                                "rank": s.get("rank"), "screen": s.get("screen"),
                                # the game's own frame-time ring, once a second (printed as a series)
                                "perf": sess.perf() if len(samples) % 4 == 0 else None})
                cur = s.get("enemies") or 0
                if isinstance(cur, (int, float)) and cur < 0.9 * args.enemies:
                    spawn_mix(sess, int(args.enemies - cur), log)
                    top_ups += 1
                if s.get("screen") not in ("play", None):
                    # Size V eats a building a second → level-ups → the draft freezes the sim. Pick
                    # with a real key at once so the measured window is a RUNNING sim, and count it.
                    overlays[s.get("screen")] = overlays.get(s.get("screen"), 0) + 1
                    clear_overlay(sess, s.get("screen"))
                time.sleep(0.25)
            ft = sess.ft_stop()
            perf_bt = sess.perf()
            st_end = sess.state() or {}
            prog1 = st_end.get("programs")
            tick1 = st_end.get("tick")
            sess.release_all()
            sess.screenshot(args.shot)
    except Exception as e:
        fatal = fatal or "harness exception: %s" % str(e).splitlines()[0][:300]
    finally:
        diag = sess.diagnostics() if sess.page else {}
        sess.close()

    if fatal:
        print("=" * 78)
        print_diagnostics(diag, limit=10)
        print("PERF GATE: SETUP FAILED — %s" % fatal)
        save_report("perfcheck", {"url": url, "fatal": fatal, "log": logs, "diagnostics": diag}, args.base, args.report_dir)
        print("RESULT: FAIL")
        return 2

    ft = [x for x in ft if isinstance(x, (int, float)) and x > 0]
    p50, p99, mx = percentile(ft, 50), percentile(ft, 99), (max(ft) if ft else None)
    fps = (1000.0 * len(ft) / sum(ft)) if ft else None
    over = sum(1 for x in ft if x > args.p99_ms)
    draws = [x["draws"] for x in samples if isinstance(x.get("draws"), (int, float))]
    tris = [x["tris"] for x in samples if isinstance(x.get("tris"), (int, float))]
    enemies = [x["enemies"] for x in samples if isinstance(x.get("enemies"), (int, float))]
    ranks = [x["rank"] for x in samples if isinstance(x.get("rank"), (int, float))]
    mean_en = (sum(enemies) / len(enemies)) if enemies else 0
    draws_max = max(draws) if draws else None

    # rAF is vsync-paced: the median frame IS the display interval (measured on this box with an empty
    # mock page: 20 ms = 50 Hz, headed AND headless — a DisplayLink panel runs at 50 Hz). With a 20 ms
    # vsync, "p99 ≤ 22 ms" means fewer than 1 % of frames may miss a vsync; a miss shows up as ~40 ms.
    missed = sum(1 for x in ft if p50 and x > 1.5 * p50)
    print("=" * 78)
    if args.headless:
        print("NOTE: gate 5 is defined HEADED; a headless run is indicative only.")
    print("PERFCHECK  %s/%s  seed %s  (%s)  %s" % (args.titan, args.biome, args.seed,
                                                 "headless" if args.headless else "headed", url))
    print("frames    : %d in %.1f s → %s fps · p50 %s ms · p99 %s ms · max %s ms · frames > %.0f ms: %d" % (
        len(ft), sum(ft) / 1000.0 if ft else 0, fmt(fps), fmt(p50, 2), fmt(p99, 2), fmt(mx, 2), args.p99_ms, over))
    if p50:
        print("vsync     : median frame %.2f ms (≈ %.0f Hz display pacing) · frames > 1.5× median (missed vsyncs): %d = %.2f %%" % (
            p50, 1000.0 / p50, missed, 100.0 * missed / max(1, len(ft))))
    if isinstance(perf_bt, dict):
        print("__BT__.perf: fps %s · p50 %s · p99 %s · max %s · simMs %s" % (
            perf_bt.get("fps"), perf_bt.get("p50"), perf_bt.get("p99"), perf_bt.get("max"), perf_bt.get("simMs")))
    series = [x["perf"] for x in samples if isinstance(x.get("perf"), dict)]
    if series:
        print("perf/1 s   : p99 %s" % " ".join(fmt(p.get("p99"), 1) if isinstance(p.get("p99"), (int, float)) else "—"
                                            for p in series))
        print("simMs/1 s  : %s" % " ".join(fmt(p.get("simMs"), 2) if isinstance(p.get("simMs"), (int, float)) else "—"
                                          for p in series))
    print("renderer  : draws p50 %s / max %s · tris p50 %s / max %s · programs %s → %s%s" % (
        percentile(draws, 50), draws_max, percentile(tris, 50), max(tris) if tris else None, prog0, prog1,
        "  (NEW PROGRAMS DURING GAMEPLAY — shader compile hitches)" if isinstance(prog0, int) and isinstance(prog1, int) and prog1 > prog0 else ""))
    sim_ticks = (tick1 - tick0) if isinstance(tick0, (int, float)) and isinstance(tick1, (int, float)) else None
    want_ticks = 0.5 * args.seconds * 30
    print("load      : Size %s · enemies mean %.0f / min %s / max %s · top-ups %d · sim ticks in window %s (need ≥ %.0f)"
          " · overlays cleared %s" % (
              ROMAN[ranks[-1]] if ranks and 0 <= ranks[-1] <= 4 else "?", mean_en, min(enemies) if enemies else None,
              max(enemies) if enemies else None, top_ups, sim_ticks, want_ticks, json.dumps(overlays)))
    print("end state : %s" % json.dumps(compact_state(st_end))[:600])
    print_diagnostics(diag, limit=10)

    problems = []
    if p99 is None:
        problems.append("no frame times recorded (rAF not running?)")
    elif p99 > args.p99_ms:
        problems.append("frame p99 %.2f ms > %.1f ms" % (p99, args.p99_ms))
    if draws_max is None:
        problems.append("no draw-call samples (state().draws missing)")
    elif draws_max > args.draws_max:
        problems.append("draw calls peaked at %d > %d" % (draws_max, args.draws_max))
    if not ranks or ranks[-1] != 4:
        problems.append("load not reached: titan not at Size V (rank %s)" % (ranks[-1] if ranks else None))
    if mean_en < 0.8 * args.enemies:
        problems.append("load not reached: mean live enemies %.0f < 80%% of %d" % (mean_en, args.enemies))
    if sim_ticks is None or sim_ticks < want_ticks:
        problems.append("the sim was not running for the window (ticks %s < %.0f) — frozen by an overlay?" % (sim_ticks, want_ticks))
    passed = not problems
    rep = {"url": url, "titan": args.titan, "biome": args.biome, "seed": args.seed, "headless": args.headless,
           "frames": len(ft), "fps": fps, "p50": p50, "p99": p99, "max": mx, "over": over, "missedVsyncs": missed, "perfBT": perf_bt,
           "drawsMax": draws_max, "drawsP50": percentile(draws, 50), "trisMax": max(tris) if tris else None,
           "programs": [prog0, prog1], "meanEnemies": mean_en, "samples": samples, "topUps": top_ups,
           "simTicks": sim_ticks, "overlays": overlays,
           "problems": problems, "pass": passed, "log": logs, "diagnostics": diag}
    print("report    : %s" % save_report("perfcheck", rep, args.base, args.report_dir))
    print("PERF GATE: %s" % ("PASS" if passed else "FAIL"))
    for p in problems:
        print("   X %s" % p)
    print("RESULT: %s" % ("OK" if passed else "FAIL"))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
