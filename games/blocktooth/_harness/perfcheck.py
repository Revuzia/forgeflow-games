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

FEATURES_V2 §15.4 scenario (a): --v2 adds 3 objectives + 3 power-ups (topped up when taken or expired)
and fires ONE UPROAR with a real E inside the window; the p99 of the UPROAR window alone (E press →
phase back to idle + 0.5 s) must meet the same budget. --prof adds ?prof=1 and prints the per-lane
median main-thread ms of the frameprof marks (§4.7: L6 views ≤ 0.3, L7 BossView ≤ 0.3, HUD DOM ≤ 0.2
over the v1 hud baseline). Run the p99 gate WITHOUT --prof (the marks + GPU timer queries cost time).
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


V2_OBJ = ["overloadSite", "reliefDepot", "recordsAnnex"]
V2_PU = ["demolition", "redLight", "cleanup", "rushHour", "backPay"]
# per-mark MEDIAN (and p90) of the frameprof ring over the play-screen frames (a frame without a mark = 0 ms)
PROF_JS = r"""() => { const p = window.__BTPROF__; if (!p) return null; const ring = p.ring || [];
  const by = {}; let n = 0;
  for (const f of ring) { if (!f || f.screen !== 'play') continue; n++;
    for (const k in f.sec) (by[k] = by[k] || []).push(f.sec[k]); }
  const q = (a, x) => { const s = a.slice().sort((u, v) => u - v); return s[Math.min(s.length - 1, Math.floor(x * s.length))]; };
  const median = {}, p90 = {}, mean = {};
  for (const k in by) { const a = by[k]; while (a.length < n) a.push(0);
    median[k] = Math.round(q(a, 0.5) * 1000) / 1000; p90[k] = Math.round(q(a, 0.9) * 1000) / 1000;
    mean[k] = Math.round(a.reduce((u, v) => u + v, 0) / Math.max(1, a.length) * 1000) / 1000; }
  return { frames: n, median, p90, mean }; }"""


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
    ap.add_argument("--boss", default=None,
                    help="v2 scenario (b): spawn this boss (e.g. parkade6) at Size V before the enemies, so the "
                         "window measures a live boss fight; pair with --enemies 150 (FEATURES_V2 §15.4)")
    ap.add_argument("--v2", action="store_true",
                    help="v2 scenario (a): 3 objectives + 3 power-ups on the map and one UPROAR fired (real E) in "
                         "the window; also reports the UPROAR-window p99 (FEATURES_V2 §15.4)")
    ap.add_argument("--ult-at", type=float, default=4.0, help="--v2: seconds into the window to fire the UPROAR")
    ap.add_argument("--prof", action="store_true",
                    help="add ?prof=1 and print per-lane median ms of the frameprof marks (§4.7); not for the p99 gate")
    ap.add_argument("--shot", default=os.path.join(SHOTS, "perfcheck.png"))
    ap.add_argument("--zoom", choices=("auto", "max"), default="auto",
                    help="player camera zoom during the window: auto framing (1x) or held at the max zoom-OUT "
                         "(real mouse-wheel notches; the rig clamps it to CAMERA_ZOOM.max / dAbsMax)")
    args = ap.parse_args()

    url = build_url(args.base, autostart=1, dev=1, noslate=1, titan=args.titan, biome=args.biome, seed=args.seed,
                    quality=args.quality, prof=(1 if args.prof else None))
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
    zoom_info = {}
    v2 = {"objPlaced": 0, "puPlaced": 0, "objTopUps": 0, "puTopUps": 0, "ult": None, "ultPolls": [], "frames": []}
    pu_cycle = [0]
    last_v2_top = [0.0]

    def v2_counts(st):
        vv = (st or {}).get("v2") or {}
        return len(vv.get("objectives") or []), len(vv.get("powerups") or [])

    def v2_top_up(st, force=False):
        """Keep 3 objectives + 3 power-ups on the map (cheats only SET UP state, §13.3)."""
        now = time.time()
        if not force and now - last_v2_top[0] < 2.0:
            return
        last_v2_top[0] = now
        no, npu = v2_counts(st)
        for k in range(max(0, 3 - no)):
            kind = V2_OBJ[(no + k) % len(V2_OBJ)]
            ok, v = sess.cheat("objective", kind)
            if not ok or v is None:
                ok, v = sess.cheat("objective", kind, 60 + 40 * k)
            if ok and v is not None:
                v2["objPlaced" if force else "objTopUps"] += 1
        for _ in range(max(0, 3 - npu)):
            kind = V2_PU[pu_cycle[0] % len(V2_PU)]
            pu_cycle[0] += 1
            ok, v = sess.cheat("powerup", kind)
            if ok and v is not None:
                v2["puPlaced" if force else "puTopUps"] += 1

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
            if args.boss:
                ok, v = sess.cheat("bossSpawn", args.boss)
                if not ok:
                    fatal = "cheat.bossSpawn(%s) failed: %s" % (args.boss, v)
                    raise HarnessError(fatal)
                time.sleep(1.5)                                 # boss framing widens D; rig warm-up
                s = sess.state() or {}
                log("boss spawned: %s · boss %s" % (args.boss, json.dumps(s.get("boss"))[:200]))
            spawn_mix(sess, args.enemies, log)
            time.sleep(0.5)
            s = sess.state() or {}
            log("after spawn: Size %s · enemies %s · draws %s" % (s.get("rank"), s.get("enemies"), s.get("draws")))
            if args.v2:
                v2_top_up(s, force=True)
                time.sleep(0.3)
                s = sess.state() or {}
                no, npu = v2_counts(s)
                u = ((s.get("v2") or {}).get("ult") or {})
                log("v2 (a): objectives %d %s · power-ups %d %s · ult %s" % (
                    no, [o.get("kind") for o in (s.get("v2") or {}).get("objectives") or []], npu,
                    [o.get("kind") for o in (s.get("v2") or {}).get("powerups") or []], json.dumps(u)))
                if no < 3 or npu < 3:
                    log("WARNING: v2 (a) load short after placement (objectives %d, power-ups %d)" % (no, npu))
            if args.zoom == "max":
                # real wheel events over the canvas (+deltaY = zoom OUT); the rig clamps at its max
                vp = sess.page.viewport_size or {"width": 1280, "height": 720}
                sess.page.mouse.move(vp["width"] / 2, vp["height"] / 2)
                for _ in range(24):
                    sess.page.mouse.wheel(0, 120)
                    time.sleep(0.04)
                time.sleep(1.0)                                     # ln-zoom smoothing (ω 11/s)
                cam = sess.safe_js("() => { const c = window.__BTCAM__; return c ? {zoom: c.zoom, target: c.zoomTarget, "
                                   "d: c.distance, auto: c.autoDist} : null; }")
                log("zoom held at max-out: %s" % json.dumps(cam))
                zoom_info["start"] = cam
                if not cam or not (cam.get("zoom", 1) > 1.2):
                    fatal = "zoom max-out not applied (%s)" % json.dumps(cam)
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
                if args.v2:
                    v2_top_up(s)
            s = sess.state() or {}
            prog0 = s.get("programs")
            tick0 = s.get("tick")
            # sampling window
            if args.v2:
                # timestamped rAF recorder (the UPROAR window is cut from it by page time)
                sess.safe_js("() => { window.__G3_TS__ = []; window.__G3_ON__ = true; if (!window.__G3_LOOP__) {"
                             " window.__G3_LOOP__ = true; const f = (ts) => { if (window.__G3_ON__) window.__G3_TS__.push(ts);"
                             " requestAnimationFrame(f); }; requestAnimationFrame(f); } }")
            if args.prof:
                sess.safe_js("() => { const p = window.__BTPROF__; if (p) p.reset(); }")
            sess.ft_start()
            t0 = time.time()
            ult_state = "pending" if args.v2 else "off"
            ult_press_pt = ult_idle_pt = None
            fired0 = None
            next_dir = t0
            while time.time() - t0 < args.seconds:
                now = time.time()
                if now >= next_dir:
                    sess.hold(CIRCLE[i % len(CIRCLE)])
                    i += 1
                    next_dir = now + 0.35
                if ult_state == "pending" and now - t0 >= args.ult_at:
                    st_u = sess.state() or {}
                    fired0 = (((st_u.get("v2") or {}).get("ult") or {}).get("fired"))
                    sess.cheat("ult", 100)
                    time.sleep(0.15)
                    ult_press_pt = sess.safe_js("() => performance.now()")
                    sess.press("KeyE", 90)                       # real E (§3.2)
                    ult_state = "live"
                    t_live = time.time()
                    while time.time() - t_live < 8.0:            # poll the phase at ~10 Hz until idle
                        r = sess.safe_js("() => { const s = window.__BT__.state(); const u = s.v2 && s.v2.ult;"
                                         " return [performance.now(), u ? u.phase : null, u ? u.fired : null, s.screen]; }")
                        if isinstance(r, list):
                            v2["ultPolls"].append(r)
                            if (r[1] == "idle" and isinstance(r[2], (int, float)) and isinstance(fired0, (int, float))
                                    and r[2] > fired0):
                                ult_idle_pt = r[0]
                                break
                            if r[3] not in ("play", None):
                                clear_overlay(sess, r[3])
                        time.sleep(0.1)
                    ult_state = "done"
                    sess.hold(CIRCLE[i % len(CIRCLE)])
                    continue
                s = sess.state() or {}
                if args.v2:
                    v2_top_up(s)
                bs = s.get("boss") if isinstance(s.get("boss"), dict) else None
                no_, npu_ = v2_counts(s)
                samples.append({"t": round(now - t0, 2), "draws": s.get("draws"), "tris": s.get("tris"),
                                "objs": no_, "pus": npu_,
                                "boss": (bs.get("id") if bs and bs.get("alive") else None),
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
            if args.v2:
                v2["frames"] = sess.safe_js("() => { window.__G3_ON__ = false; return window.__G3_TS__.slice(); }",
                                            default=[]) or []
                v2["ult"] = {"pressPt": ult_press_pt, "idlePt": ult_idle_pt, "fired0": fired0, "state": ult_state}
            if args.prof:
                v2["prof"] = sess.safe_js(PROF_JS)
            zoom_info["end"] = sess.safe_js("() => { const c = window.__BTCAM__; return c ? {zoom: c.zoom, d: c.distance, auto: c.autoDist} : null; }")
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
    print("camera    : zoom %s · start %s · end %s" % (args.zoom, json.dumps(zoom_info.get("start")), json.dumps(zoom_info.get("end"))))
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
    if args.zoom == "max":
        ze = zoom_info.get("end") or {}
        if not (isinstance(ze.get("zoom"), (int, float)) and ze["zoom"] > 1.2):
            problems.append("zoom max-out was not held through the window (%s)" % json.dumps(ze))
    if args.boss:
        live = sum(1 for x in samples if x.get("boss") == args.boss)
        print("boss      : %s alive in %d / %d samples" % (args.boss, live, len(samples)))
        if live < 0.9 * max(1, len(samples)):
            problems.append("scenario (b) not held: %s alive in only %d / %d samples" % (args.boss, live, len(samples)))
    ult_rep = None
    if args.v2:
        objs = [x["objs"] for x in samples if isinstance(x.get("objs"), int)]
        pus = [x["pus"] for x in samples if isinstance(x.get("pus"), int)]
        mo = (sum(objs) / len(objs)) if objs else 0
        mp = (sum(pus) / len(pus)) if pus else 0
        print("v2 (a)    : objectives mean %.2f / min %s · power-ups mean %.2f / min %s · top-ups obj %d pu %d" % (
            mo, min(objs) if objs else None, mp, min(pus) if pus else None, v2["objTopUps"], v2["puTopUps"]))
        if mo < 2.5:
            problems.append("scenario (a) not held: objectives mean %.2f < 2.5" % mo)
        if mp < 2.5:
            problems.append("scenario (a) not held: power-ups mean %.2f < 2.5" % mp)
        u = v2.get("ult") or {}
        ts = [x for x in v2.get("frames") or [] if isinstance(x, (int, float))]
        if u.get("pressPt") is None or u.get("idlePt") is None:
            problems.append("UPROAR not observed through the window (press %s · back to idle %s · polls %d)" % (
                u.get("pressPt"), u.get("idlePt"), len(v2["ultPolls"])))
            print("UPROAR    : NOT OBSERVED %s" % json.dumps(u))
        else:
            a, b = u["pressPt"], u["idlePt"] + 500.0
            win = [ts[k] - ts[k - 1] for k in range(1, len(ts)) if a <= ts[k] <= b]
            phases = [p[1] for p in v2["ultPolls"]]
            up99, up50, umx = percentile(win, 99), percentile(win, 50), (max(win) if win else None)
            ult_rep = {"windowMs": round(b - a), "frames": len(win), "p50": up50, "p99": up99, "max": umx,
                       "phasesSeen": sorted(set(x for x in phases if x)), "fired0": u.get("fired0")}
            print("UPROAR    : window %.0f ms (E press → idle + 0.5 s) · %d frames · p50 %s · p99 %s · max %s · phases seen %s" % (
                b - a, len(win), fmt(up50, 2), fmt(up99, 2), fmt(umx, 2), ult_rep["phasesSeen"]))
            if up99 is None or up99 > args.p99_ms:
                problems.append("UPROAR-window p99 %s ms > %.1f ms" % (fmt(up99, 2), args.p99_ms))
    if args.prof:
        pr = v2.get("prof") or {}
        med = pr.get("median") or {}
        print("frameprof : %s play frames · per-mark median ms: %s" % (pr.get("frames"), json.dumps(med, sort_keys=True)))
        mn = pr.get("mean") or {}
        print("frameprof : per-mark MEAN ms (performance.now is 0.1 ms-coarse, so sub-0.1 medians read 0): %s" % json.dumps(mn, sort_keys=True))
        for tag, src in (("median", med), ("mean", mn)):
            lanes = {"L6 views": sum(src.get(k, 0) for k in ("UltView", "ObjectiveView", "PowerupView", "MarkerView")),
                     "L7 BossView": src.get("BossView", 0), "hud (v1 + v2)": src.get("hud", 0)}
            print("lanes/%-6s: %s" % (tag, " · ".join("%s %.3f ms" % (k, v) for k, v in lanes.items())))
        ult_rep = dict(ult_rep or {}, prof=pr)
    passed = not problems
    rep = {"url": url, "zoom": args.zoom, "zoomInfo": zoom_info, "titan": args.titan, "biome": args.biome, "seed": args.seed, "headless": args.headless,
           "frames": len(ft), "fps": fps, "p50": p50, "p99": p99, "max": mx, "over": over, "missedVsyncs": missed, "perfBT": perf_bt,
           "drawsMax": draws_max, "drawsP50": percentile(draws, 50), "trisMax": max(tris) if tris else None,
           "programs": [prog0, prog1], "meanEnemies": mean_en, "samples": samples, "topUps": top_ups,
           "simTicks": sim_ticks, "overlays": overlays, "v2": args.v2, "uproar": ult_rep,
           "problems": problems, "pass": passed, "log": logs, "diagnostics": diag}
    print("report    : %s" % save_report("perfcheck", rep, args.base, args.report_dir))
    print("PERF GATE: %s" % ("PASS" if passed else "FAIL"))
    for p in problems:
        print("   X %s" % p)
    print("RESULT: %s" % ("OK" if passed else "FAIL"))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
