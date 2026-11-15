#!/usr/bin/env python
"""BLOCKTOOTH VS - the GOALS MET strip probe (lane O-POLISH, finding V1 of the real-key critic).

    python _harness/vs/probe_vsgoals.py --base http://localhost:5601/ --no-serve --headless

Why: the VS goals a finished match earns used to be GOAL MET toasts. The toast layer is hidden behind the end card and its queue is
dropped by teardownRun on every way out of the card (LEAVE / REMATCH), so no toast was ever seen although the portal got every
forgeflow:achievement. The goals now ride the end card itself (GOALS MET strip, [data-v2="vs-goals"]).

Drives the REAL game in Chrome: VS PRACTICE autostart -> the match is decided with the dev cheat (vs.dev.end(0): the human seat wins ->
SYNDICATED + CERTIFIED HEADLINE + ... are earned in a fresh profile) -> the end card opens -> asserts the strip is in the DOM, visible and
non-empty (names + descriptions) -> LEAVE with a real Escape -> asserts the title is reached with 0 page errors and that the strip does not
leak into the next card (it is cleared with the card). Exit 0 PASS, 1 FAIL, 2 could not get far enough to judge.
"""
import argparse
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
from common import SHOTS, HarnessError, Session, add_common_args, build_url, diag_problems  # noqa: E402

STRIP_JS = """() => {
  const el = document.querySelector('[data-v2="vs-goals"]');
  if (!el) return { present: false };
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return { present: true, hidden: el.classList.contains('bt-hidden') || cs.display === 'none', w: Math.round(r.width), h: Math.round(r.height),
           goals: [...el.querySelectorAll('.bt-vsend-goal')].map((g) => ({ id: g.dataset.id, name: g.querySelector('b') && g.querySelector('b').textContent,
             desc: g.querySelector('span') && g.querySelector('span').textContent })),
           kicker: (el.querySelector('.bt-vsend-goalk b') || {}).textContent || '' };
}"""


def main() -> int:
    ap = argparse.ArgumentParser(description="BLOCKTOOTH VS goals-met strip probe")
    add_common_args(ap)
    ap.add_argument("--wait", type=float, default=120.0)
    args = ap.parse_args()
    url = build_url(args.base, autostart=1, dev=1, titan="molo", biome="grideast", seed=1337, quality=args.quality if args.quality is not None else 0, mode="vs", bots="regular")
    sess = Session(args, "probe_vsgoals")
    try:
        sess.start()
    except Exception as e:
        print("SETUP FAILED: %s" % (str(e) if isinstance(e, HarnessError) else repr(e)))
        return 2
    fails = []
    notes = []

    def check(name, ok, detail=""):
        print("  [%s] %s%s" % ("PASS" if ok else "FAIL", name, (" - " + str(detail)) if (detail and not ok) else ""))
        if not ok:
            fails.append(name)

    diag = {}
    try:
        sess.goto(url)
        if not sess.wait_bt(args.wait):
            print("window.__BT__ never appeared")
            return 2
        # the VS world (a slate / cinematic may own the first seconds: Enter closes it)
        t0 = time.time()
        while time.time() - t0 < args.wait:
            scr = sess.screen()
            if scr == "play" and sess.has_world():
                break
            if scr == "slate":
                sess.press("Enter")
            time.sleep(0.4)
        else:
            print("no play screen after %.0f s (screen=%r)" % (args.wait, sess.screen()))
            return 2
        time.sleep(2.0)
        ok_end = sess.safe_js("() => window.__BT__.vs.dev.end(0)")
        check("the dev cheat decided the match", ok_end is True, ok_end)
        reached, scr = sess.wait_screen("end", args.wait)
        if not reached:
            print("the end card never opened (screen=%r)" % scr)
            return 2
        time.sleep(1.2)                                   # the card arms its keys for ~0.9 s
        strip = sess.safe_js(STRIP_JS, default={"present": False})
        notes.append("strip: %s" % strip)
        check("the end card has a GOALS MET strip in the DOM", bool(strip.get("present")), strip)
        check("the strip is visible (not hidden, has a box)", bool(strip.get("present")) and not strip.get("hidden") and strip.get("h", 0) > 8, strip)
        goals = strip.get("goals") or []
        check("the strip lists at least one earned goal", len(goals) >= 1, strip)
        check("every goal line has a name and a description", bool(goals) and all(g.get("name") and g.get("desc") for g in goals), goals)
        check("SYNDICATED (finish a VS match) is among them", any(g.get("name") == "SYNDICATED" for g in goals), goals)
        check("a winning human seat also earned CERTIFIED HEADLINE", any(g.get("name") == "CERTIFIED HEADLINE" for g in goals), goals)
        check("the kicker reads GOALS MET", strip.get("kicker") == "GOALS MET", strip.get("kicker"))
        shot = os.path.join(SHOTS, "probe_vsgoals_endcard.png")
        try:
            sess.screenshot(shot)
            notes.append("shot: %s" % shot)
        except Exception as e:
            notes.append("shot failed: %s" % e)
        # LEAVE with a real key: the old toasts died right here
        sess.press("Escape")
        reached, scr = sess.wait_screen("title", 30)
        check("LEAVE (real Escape) reaches the title", reached, scr)
        time.sleep(0.5)
        after = sess.safe_js(STRIP_JS, default={"present": False})
        check("the strip is cleared with the card (nothing stale for the next match)", (not after.get("present")) or after.get("hidden") or not (after.get("goals") or []), after)
        diag = sess.diagnostics()
    finally:
        sess.close()
    probs = diag_problems(diag) if diag else []
    check("no console / page errors", not probs, probs)
    for n in notes:
        print("   " + str(n)[:600])
    print("RESULT: %s" % ("PASS" if not fails else "FAIL (%d)" % len(fails)))
    return 0 if not fails else 1


if __name__ == "__main__":
    raise SystemExit(main())
