#!/usr/bin/env python
"""DYEFIELD look evidence — the G5 inputs (CONTRACT §7). Integrator harness.

    python _harness/lookshots.py                 # headed Chrome (d3d11), 1600x900, auto-starts vite
    python _harness/lookshots.py --prefix int    # shot-name prefix (default "int")

Writes into _shots/:
  <p>_spawn.png       third-person at spawn A (after a REAL click → pointer lock)
  <p>_dye_close.png   after a ~6 m trail painted with REAL W + LMB input, camera behind the runner
  <p>_debug.png       the F1 panel (a REAL F1 press) over the painted trail
  <p>_midcourt.png    standing mid-court (buoy block top) looking toward the GULF base   [dev teleport]
  <p>_sidedeck.png    on the west side deck looking across the court                     [dev teleport]
  <p>_golden.png      ?preset=golden, spawn A after a short REAL painted trail
  <p>_lookbench.png   /lookbench.html (the LOOK lane's material bench, default AgX|Neutral split)
and measures fps from the F1 panel at spawn (early + warm), plus __DF__.state().fps.

Only stations are reached by teleport (dev); every paint stroke is real keyboard/mouse input.
Exit 0 when every shot saved and the pages stayed clean (0 console/page/shader errors,
0 failed requests); 1 otherwise.
"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (SHOTS, Session, add_common_args, build_url, diag_problems, ensure_server,  # noqa: E402
                    preflight_chromes, print_diagnostics, save_report, stop_server)

DEG = 3.141592653589793 / 180.0

# page-side timeline: pointer-lock changes and focus/visibility (why did a lock drop?)
TIMELINE_JS = r"""(() => { if (window.__LS_EV__) return; window.__LS_EV__ = []; const t0 = performance.now();
  const log = (m) => window.__LS_EV__.push(((performance.now() - t0) / 1000).toFixed(2) + 's ' + m);
  document.addEventListener('pointerlockchange', () => log('pointerlock ' + (document.pointerLockElement ? 'ON' : 'OFF')));
  document.addEventListener('pointerlockerror', () => log('pointerlockerror'));
  addEventListener('blur', () => log('window blur')); addEventListener('focus', () => log('window focus'));
  document.addEventListener('visibilitychange', () => log('visibility ' + document.visibilityState));
  addEventListener('resize', () => log('resize ' + innerWidth + 'x' + innerHeight + ' dpr ' + devicePixelRatio));
})();"""


def timeline(s):
    return s.safe_js("() => window.__LS_EV__ || []", default=[]) or []


def enter_play(s, notes):
    """Real click on CLICK TO PLAY → pointer lock (click again if Chrome refuses the first);
    __DF__.start() only as a declared fallback."""
    for attempt in range(2):
        try:
            s.page.bring_to_front()
        except Exception:
            pass
        s.page.mouse.move(s.args.width / 2, s.args.height / 2)
        s.page.mouse.click(s.args.width / 2, s.args.height / 2)
        ok, _ = s.wait_phase("play", 4.0)
        if ok:
            return "real click → pointer lock (click %d)" % (attempt + 1)
        time.sleep(0.8)
    notes.append("pointer lock refused twice under automation → __DF__.start() fallback")
    s.df("start")
    ok, _ = s.wait_phase("play", 4.0)
    return "__DF__.start() fallback" if ok else None


def ensure_play(s, notes, where, problems):
    """common.Session.lock_guard: focus theft by another window → ONE real click re-locks (NOTE);
    a lock lost while the page still had focus → a problem (a game bug)."""
    return s.lock_guard(where, notes, problems) != "failed"


def wait_warm(s, notes, where, min_fps=24.0, budget_s=25.0):
    """Timed real input needs a warm page: the sim runs at most 5 ticks per frame, so below ~12 fps
    a held key moves the runner slower than real time. Wait (recorded) for the game's fps."""
    t0 = time.time()
    f = None
    while time.time() - t0 < budget_s:
        f = (s.state() or {}).get("fps")
        if isinstance(f, (int, float)) and f >= min_fps:
            break
        time.sleep(0.5)
    notes.append("%s: waited %.1f s for fps >= %.0f (now %s)" % (where, time.time() - t0, min_fps, f))
    return f


def station(s, x, y, z, yaw_deg, settle=1.2):
    """dev teleport + point the follow camera along the same yaw (rest pitch)."""
    yaw = yaw_deg * DEG
    s.df("teleport", x, y, z, yaw)
    s.js("(y) => { const c = __DF__.dev.parts.cam; c.reset(y); }", yaw)
    time.sleep(settle)


def debug_text(s):
    return s.safe_js("() => { const d = document.querySelector('.df-debug'); return d && !d.hidden ? d.innerText : null; }")


def debug_fps(s):
    t = debug_text(s) or ""
    for line in t.splitlines():
        parts = line.replace("\t", " ").split()
        if parts and parts[0] == "fps" and len(parts) > 1:
            try:
                return float(parts[1])
            except ValueError:
                return None
    return None


def paint_trail(s, walk_first_s, paint_s):
    """REAL input: W to leave the pad, then W + LMB held for paint_s (≈ 5.2 m/s)."""
    kb, ms = s.page.keyboard, s.page.mouse
    p0 = (s.state() or {}).get("player") or {}
    if walk_first_s > 0:
        kb.down("KeyW"); time.sleep(walk_first_s); kb.up("KeyW")
        time.sleep(0.35)
    p1 = (s.state() or {}).get("player") or {}
    ms.down(button="left")
    kb.down("KeyW"); time.sleep(paint_s); kb.up("KeyW")
    time.sleep(0.25)
    ms.up(button="left")
    time.sleep(0.9)
    p2 = (s.state() or {}).get("player") or {}
    d = ((p2.get("x", 0) - p1.get("x", 0)) ** 2 + (p2.get("z", 0) - p1.get("z", 0)) ** 2) ** 0.5
    return {"start": p0, "trailFrom": p1, "trailTo": p2, "trailMetres": d}


def main() -> int:
    ap = argparse.ArgumentParser(description="DYEFIELD look evidence shots (G5 inputs)")
    add_common_args(ap)
    ap.add_argument("--prefix", default="int")
    ap.add_argument("--warm", type=float, default=20.0, help="seconds idle at spawn before the warm fps read")
    args = ap.parse_args()
    if args.width == 1280 and args.height == 720:          # common.py defaults → this gate's 1600x900
        args.width, args.height = 1600, 900
    P = args.prefix
    shot = lambda n: os.path.join(SHOTS, "%s_%s.png" % (P, n))
    rep = {"size": [args.width, args.height], "shots": {}, "notes": []}
    problems = []
    rep["otherAutomatedChrome"] = preflight_chromes("pre-flight")[0]
    server = ensure_server(args.base, not args.no_serve)     # one dev server for all three sessions
    try:
        return run(args, P, shot, rep, problems)
    finally:
        stop_server(server)


def run(args, P, shot, rep, problems) -> int:
    # ── session 1: noon, spawn / trail / debug / mid-court / side deck ──
    s = Session(args, "lookshots")
    s.start()
    s.page.add_init_script(TIMELINE_JS)
    try:
        url = build_url(args.base, map="pier18", dev=1)
        s.goto(url)
        s.wait_df(90)
        ok, ph = s.wait_phase("ready", 90)
        if not ok:
            raise RuntimeError("never reached ready (phase %r): %s" % (ph, (s.state() or {}).get("error")))
        time.sleep(0.5)
        rep["entered"] = enter_play(s, rep["notes"])
        if not rep["entered"]:
            raise RuntimeError("could not enter play")
        time.sleep(1.5)
        rep["shots"]["spawn"] = s.screenshot(shot("spawn"))

        # fps at spawn from the F1 panel: early, then warm. Only samples taken IN PLAY count (a
        # paused game freezes the panel and renders the blurred pause card instead).
        s.press("F1", 80)
        time.sleep(1.5)
        f_early = debug_fps(s) if s.phase() == "play" else None
        time.sleep(max(0.0, args.warm))
        samples = []
        for _ in range(40):
            if s.phase() != "play":
                ensure_play(s, rep["notes"], "fps sampling at spawn", problems)
                time.sleep(2.0)
                continue
            samples.append((debug_fps(s), (s.state() or {}).get("fps")))
            if len(samples) >= 10:
                break
            time.sleep(0.5)
        rep["fpsSpawn"] = {"f1Early": f_early, "f1Warm": [a for a, _ in samples], "stateWarm": [b for _, b in samples],
                           "render": s.df("render")[1]}
        rep["shots"]["spawn_f1"] = s.screenshot(shot("spawn_f1"))
        s.press("F1", 80)
        time.sleep(0.4)

        # the trail: real W off the pad (down the base-deck edge onto the court), then W + LMB
        ensure_play(s, rep["notes"], "before the trail", problems)
        wait_warm(s, rep["notes"], "noon trail")
        tr = paint_trail(s, 1.6, 1.2)
        rep["trail"] = tr
        rep["trail"]["teamUnderFeet"] = s.df("teamUnderFeet")[1]
        rep["trail"]["coverage"] = (s.state() or {}).get("coverage")
        if not (tr["trailMetres"] > 4.5):
            problems.append("painted trail only %.2f m (want ~6)" % tr["trailMetres"])
        rep["trail"]["phaseAfter"] = s.phase()
        rep["shots"]["dye_close"] = s.screenshot(shot("dye_close"))
        s.press("F1", 80)
        time.sleep(0.8)
        rep["debugText"] = debug_text(s)
        rep["shots"]["debug"] = s.screenshot(shot("debug"))
        s.press("F1", 80)
        time.sleep(0.3)

        # stations (dev teleport only to reach them)
        ensure_play(s, rep["notes"], "before the stations", problems)
        station(s, 0.0, 1.45, 0.0, 0.0)          # buoy block top = mid-court, facing +Z (GULF base)
        rep["midcourt"] = (s.state() or {}).get("player")
        rep["shots"]["midcourt"] = s.screenshot(shot("midcourt"))
        station(s, -24.0, 2.05, -8.0, 56.0)      # west side deck, looking across the court
        rep["sidedeck"] = (s.state() or {}).get("player")
        rep["shots"]["sidedeck"] = s.screenshot(shot("sidedeck"))
    finally:
        rep["timeline_noon"] = timeline(s) if s.page else []
        d1 = s.diagnostics() if s.page else {}
        s.close()
    rep["diagnostics_noon"] = d1
    problems += ["noon: " + p for p in diag_problems(d1)]

    # ── session 2: golden preset ──
    s = Session(args, "lookshots_golden")
    s.start()
    s.page.add_init_script(TIMELINE_JS)
    try:
        s.goto(build_url(args.base, map="pier18", dev=1, preset="golden"))
        s.wait_df(90)
        ok, ph = s.wait_phase("ready", 90)
        if not ok:
            raise RuntimeError("golden: never reached ready (phase %r)" % ph)
        time.sleep(0.5)
        if not enter_play(s, rep["notes"]):
            raise RuntimeError("golden: could not enter play")
        time.sleep(1.0)
        ensure_play(s, rep["notes"], "golden: before the trail", problems)
        wait_warm(s, rep["notes"], "golden trail")
        rep["goldenTrail"] = paint_trail(s, 1.6, 0.9)
        if not (rep["goldenTrail"]["trailMetres"] > 3.0):
            problems.append("golden trail only %.2f m" % rep["goldenTrail"]["trailMetres"])
        rep["shots"]["golden"] = s.screenshot(shot("golden"))
    finally:
        rep["timeline_golden"] = timeline(s) if s.page else []
        d2 = s.diagnostics() if s.page else {}
        s.close()
    rep["diagnostics_golden"] = d2
    problems += ["golden: " + p for p in diag_problems(d2)]

    # ── session 3: lookbench ──
    s = Session(args, "lookshots_bench")
    s.start()
    try:
        s.goto(args.base.rstrip("/") + "/lookbench.html")
        deadline = time.time() + 90
        while time.time() < deadline:
            if s.safe_js("() => !!(window.__LOOK__ && window.__LOOK__.ready)", default=False):
                break
            time.sleep(0.3)
        time.sleep(2.0)
        rep["lookbench"] = s.safe_js("() => ({ ready: __LOOK__.ready, frames: __LOOK__.frames, errors: __LOOK__.errors })")
        if not (rep["lookbench"] or {}).get("ready"):
            problems.append("lookbench never reported ready")
        if (rep["lookbench"] or {}).get("errors"):
            problems.append("lookbench errors: %s" % rep["lookbench"]["errors"][:3])
        rep["shots"]["lookbench"] = s.screenshot(shot("lookbench"))
    finally:
        d3 = s.diagnostics() if s.page else {}
        s.close()
    rep["diagnostics_bench"] = d3
    problems += ["lookbench: " + p for p in diag_problems(d3)]

    for k, v in rep["shots"].items():
        if not v:
            problems.append("shot %s not saved" % k)
    rep["problems"] = problems

    print("=" * 84)
    print("size          : %dx%d  (%s)" % (args.width, args.height, "headless" if args.headless else "headed Chrome d3d11"))
    print("entered play  : %s" % rep.get("entered"))
    f = rep.get("fpsSpawn") or {}
    print("fps at spawn  : F1 early %s · F1 warm %s · state warm %s" % (f.get("f1Early"), f.get("f1Warm"), f.get("stateWarm")))
    r = f.get("render") or {}
    print("renderer      : draw calls %s · triangles %s · programs %s · gpu %s" % (r.get("calls"), r.get("triangles"), r.get("programs"), r.get("gpu")))
    t = rep.get("trail") or {}
    print("trail         : %.2f m painted with real W+LMB · teamUnderFeet %s · coverage %s" % (
        t.get("trailMetres", 0), t.get("teamUnderFeet"), json.dumps(t.get("coverage"))))
    print("midcourt at   : %s" % json.dumps({k: round(v, 2) for k, v in (rep.get("midcourt") or {}).items() if isinstance(v, float)}))
    print("sidedeck at   : %s" % json.dumps({k: round(v, 2) for k, v in (rep.get("sidedeck") or {}).items() if isinstance(v, float)}))
    print("lookbench     : %s" % json.dumps(rep.get("lookbench")))
    for k, v in rep["shots"].items():
        print("shot %-9s: %s" % (k, shot(k) if v else "NOT SAVED"))
    for n in rep["notes"]:
        print("NOTE          : %s" % n)
    print("lock timeline : noon %s" % " | ".join(rep.get("timeline_noon") or []))
    print("lock timeline : golden %s" % " | ".join(rep.get("timeline_golden") or []))
    for label, d in (("noon", d1), ("golden", d2), ("lookbench", d3)):
        print("-- diagnostics %s --" % label)
        print_diagnostics(d)
    print("=" * 84)
    print("report        : %s" % save_report("lookshots", rep, args.base))
    for p in problems:
        print("   X %s" % p)
    print("RESULT: %s" % ("OK" if not problems else "FAIL"))
    return 0 if not problems else 1


if __name__ == "__main__":
    raise SystemExit(main())
