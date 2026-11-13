#!/usr/bin/env python
"""BLOCKTOOTH VS boot check (lane B-QA) — the VS twin of _harness/bootcheck.py (CONTRACT §15 gate 3).

    python _harness/vs/bootcheck_vs.py --base http://localhost:5197/ --no-serve --headless
    python _harness/vs/bootcheck_vs.py --via-menu            # reach VS through the real menus (VS PRACTICE) instead of ?mode=vs

Loads the game in VS practice (default: /?autostart=1&dev=1&mode=vs&bots=regular&titan=&biome=&seed=; `--via-menu` presses real
keys to 'VS PRACTICE'; `--url-extra k=v,...` overrides the query), then asserts on the LIVE World (read-only `__BT__.world`):

  * a VS world exists: mode 'vs', 4 seats, 3 bot seats + the player's seat (view seat 0), every titan alive
  * all 4 seats stand on a zebra crossing and >= 2 road pitches apart (vs_design §3: one titan per quadrant)
  * the phase machine starts in COUNTDOWN and leaves it for OPEN HOUSE by itself (vs.phase 'countdown' -> 'open')
  * the sim and the frames advance; a real key press is not required (autostart) but is sent when a slate/cinematic owns play
  * 0 console errors, 0 page / window errors, 0 shader/GL diagnostics, 0 failed requests
Exit: 0 BOOTS CLEAN · 1 not clean · 2 never got far enough to judge · 3 NOT RUN (the VS entry does not exist yet).
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
from common import (BIOMES, SHOTS, TITANS, HarnessError, Session, add_common_args, build_url, diag_problems,  # noqa: E402
                    dismiss_slate, print_diagnostics, save_report)
from vsmenu import SEATS_ON_ZEBRA_JS, goto_vs_practice, in_vs_world, vs_obs  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description="BLOCKTOOTH VS boot check")
    add_common_args(ap)
    ap.add_argument("--titan", default="molo", choices=TITANS)
    ap.add_argument("--biome", default="grideast", choices=BIOMES)
    ap.add_argument("--seed", type=int, default=1337)
    ap.add_argument("--seconds", type=float, default=12.0, help="seconds of match to watch after the world exists")
    ap.add_argument("--wait", type=float, default=90.0)
    ap.add_argument("--open-wait", type=float, default=240.0, help="max seconds to wait for the countdown to give way to OPEN HOUSE")
    ap.add_argument("--via-menu", action="store_true", help="enter VS through real keys (VS PRACTICE) instead of the URL")
    ap.add_argument("--url-extra", default="mode=vs,bots=regular", help="comma list of k=v query params for the autostart URL")
    ap.add_argument("--out-dir", default=SHOTS)
    args = ap.parse_args()

    extra = dict(kv.split("=", 1) for kv in args.url_extra.split(",") if "=" in kv)
    if args.via_menu:
        url = build_url(args.base, dev=1, seed=args.seed, quality=args.quality)
    else:
        url = build_url(args.base, autostart=1, dev=1, titan=args.titan, biome=args.biome, seed=args.seed, quality=args.quality, **extra)
    shot_a = os.path.join(args.out_dir, "bootcheck_vs_start.png")
    shot_b = os.path.join(args.out_dir, "bootcheck_vs_play.png")
    report = {"url": url, "viaMenu": args.via_menu, "headless": args.headless}
    problems = []
    fatal = None
    not_run = None
    zebra = None
    obs0 = obs1 = None
    phases = []
    tick_a = tick_b = None
    frames = (False, None, None)
    sess = Session(args, "bootcheck_vs")
    try:
        sess.start()
    except Exception as e:
        sess.close()
        print("SETUP FAILED: %s" % (str(e) if isinstance(e, HarnessError) else repr(e)))
        print("RESULT: FAIL")
        return 2
    try:
        try:
            sess.goto(url)
        except Exception as e:
            fatal = "navigation failed: %s" % str(e).splitlines()[0]
        if not fatal and not sess.wait_bt(args.wait):
            fatal = "window.__BT__ never appeared within %.0f s" % args.wait
        if not fatal and args.via_menu:
            ok, det = goto_vs_practice(sess, args.titan, args.biome, snap=lambda n: sess.screenshot(os.path.join(args.out_dir, "bootcheck_vs_%s.png" % n)))
            report["menu"] = det
            print("menus: %s %s" % ("OK" if ok else "FAIL", json.dumps(det)[:600]))
            if not ok:
                if det.get("notFound"):
                    not_run = det["error"]
                else:
                    fatal = det.get("error", "menu navigation failed")
        if not fatal and not not_run:
            # wait for a VS world (autostart may sit on a slate / cinematic first)
            t0 = time.time()
            while time.time() - t0 < args.wait and not in_vs_world(sess):
                scr = sess.screen()
                if scr in ("slate",):
                    dismiss_slate(sess, 10, "Enter")
                time.sleep(0.4)
            obs0 = vs_obs(sess)
            if not obs0.get("world"):
                fatal = "no World after %.0f s (screen=%r)" % (args.wait, sess.screen())
            elif obs0.get("mode") != "vs":
                if args.via_menu:
                    fatal = "World mode is %r, not 'vs'" % obs0.get("mode")
                else:
                    not_run = ("World mode is %r: the URL params %s did not start a VS world (B-VIEW has not wired the VS autostart yet; "
                               "try --via-menu)" % (obs0.get("mode"), args.url_extra))
        if not fatal and not not_run:
            sess.screenshot(shot_a)
            zebra = sess.safe_js(SEATS_ON_ZEBRA_JS, 0.25, default={"ok": False, "reason": "eval failed"})
            # the first frames of a 4-titan scene are slow (shader warm-up, shared GPU): wait for the loading screen to give way,
            # dismiss a slate / cinematic with a REAL key if one owns the screen, then watch the phase machine
            t_ld = time.time()
            while time.time() - t_ld < args.wait and sess.screen() in ("loading", None, "title", "select"):
                time.sleep(0.5)
            report["loadingS"] = round(time.time() - t_ld, 1)
            print("loading screen lasted %.1f s (screen now %r)" % (report["loadingS"], sess.screen()))
            if sess.screen() == "slate":
                dismiss_slate(sess, 20, "Enter")
            o = vs_obs(sess)
            tick_a = o.get("tick")
            t_run = time.time()
            # watch at least --seconds, and (the shared GPU can run a 4-titan scene at < 1 fps) until OPEN HOUSE or --open-wait
            while not fatal:
                o = vs_obs(sess)
                ph = (o.get("vs") or {}).get("phase")
                if ph and (not phases or phases[-1] != ph):
                    phases.append(ph)
                el = time.time() - t_run
                if el >= max(2.0, args.seconds) and ("open" in phases or el >= args.open_wait):
                    break
                time.sleep(0.25)
            frames = sess.frames_advancing(15.0)
            obs1 = vs_obs(sess)
            tick_b = obs1.get("tick")
            sess.screenshot(shot_b)
    finally:
        diag = sess.diagnostics() if sess.page else {}
        sess.close()

    print("=" * 78)
    print("URL      : %s" % url)
    print("phases   : %s" % " -> ".join(phases) if phases else "phases   : -")
    if obs0 and obs0.get("players"):
        print("seats    : %s" % ", ".join("%d:%s%s L%s" % (p["slot"], p["titan"], "(bot)" if p["bot"] else "", p["level"]) for p in obs0["players"]))
    if zebra:
        print("zebra    : %s min seat separation %s m (pitch %s) rows %s" % (
            "ALL ON ZEBRA" if zebra.get("ok") else "NOT ALL ON ZEBRA", zebra.get("minSep"), zebra.get("pitch"),
            json.dumps([(r["slot"], r["inside"], round(r["dist"] or 0, 1)) for r in zebra.get("rows", [])])))
    print("frames   : %s -> %s (%s)" % (frames[1], frames[2], "advancing" if frames[0] else "STALLED"))
    print("sim ticks: %s -> %s" % (tick_a, tick_b))
    print_diagnostics(diag)
    print("=" * 78)
    report.update({"obsStart": obs0, "obsEnd": obs1, "zebra": zebra, "phases": phases, "diagnostics": diag, "fatal": fatal, "notRun": not_run})
    if not_run and not fatal:
        print("VERDICT: NOT RUN - %s" % not_run)
        print("report   : %s" % save_report("bootcheck_vs", report, args.base, args.report_dir))
        print("RESULT: NOT RUN")
        return 3
    if fatal:
        print("VERDICT: NOT CLEAN - %s" % fatal)
        print("report   : %s" % save_report("bootcheck_vs", report, args.base, args.report_dir))
        print("RESULT: FAIL")
        return 2
    players = (obs0 or {}).get("players") or []
    if len(players) != 4:
        problems.append("expected 4 seats, got %d" % len(players))
    if sum(1 for p in players if p.get("bot")) != 3:
        problems.append("expected 3 bot seats + 1 player seat, got %d bots" % sum(1 for p in players if p.get("bot")))
    if players and not all(p.get("alive") for p in players):
        problems.append("a titan is not alive at the start")
    if zebra is not None:
        if not zebra.get("ok"):
            problems.append("not every seat stands on a zebra crossing: %s" % json.dumps(zebra.get("rows")))
        if zebra.get("minSep") is not None and zebra.get("pitch") and zebra["minSep"] < 2 * zebra["pitch"] - 1e-6:
            problems.append("seats closer than 2 road pitches (%.1f m)" % zebra["minSep"])
    if "countdown" not in phases[:1] and phases:
        problems.append("the first phase observed was %r, not 'countdown'" % phases[0])
    if "open" not in phases:
        problems.append("the phase machine never reached 'open' within %.0f s of watching (phases seen: %s)" % (args.open_wait, phases))
    if not frames[0]:
        problems.append("the harness frame counter did not advance (rAF stalled)")
    if not (isinstance(tick_a, (int, float)) and isinstance(tick_b, (int, float)) and tick_b > tick_a):
        problems.append("the sim tick did not advance (%s -> %s)" % (tick_a, tick_b))
    problems += diag_problems(diag)
    clean = not problems
    report["verdict"] = "BOOTS CLEAN" if clean else "NOT CLEAN"
    report["problems"] = problems
    print("VERDICT: %s" % report["verdict"])
    for p in problems:
        print("   X %s" % p)
    print("report   : %s" % save_report("bootcheck_vs", report, args.base, args.report_dir))
    print("RESULT: %s" % ("OK" if clean else "FAIL"))
    return 0 if clean else 1


if __name__ == "__main__":
    raise SystemExit(main())
