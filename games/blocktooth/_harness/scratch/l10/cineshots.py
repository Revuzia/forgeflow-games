#!/usr/bin/env python
"""L10 scratch: capture the WARD-7 STREET CAM opening at chosen shot times.

    python _harness/scratch/l10/cineshots.py --base http://localhost:5260/ --titan molo --biome grideast \
        --at street:1.5 closeup:0.6 closeup:1.4 crane:0.8 --out _harness/scratch/l10/shots

Loads /?autostart=1&dev=1&titan=&biome=&seed=[&cine=], polls __BT__.state().v2.cine every ~15 ms and
screenshots the first frame at/after each requested (shot, t). Prints the shot timeline it observed
(first/last t per shot) and the frame at which play began. Real keys only (no dismiss call): the
cinematic runs to its natural end unless --skip-at is given (then a real Enter at that plan time).
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, "..", "..")))
from common import Session, add_common_args, build_url, diag_problems, print_diagnostics  # noqa: E402

CINE_JS = "() => { try { const s = window.__BT__.state(); return { screen: s.screen, cine: s.v2 ? s.v2.cine : null, tick: s.tick }; } catch (e) { return { err: String(e) }; } }"


def main():
    ap = argparse.ArgumentParser()
    add_common_args(ap)
    ap.add_argument("--titan", default="molo")
    ap.add_argument("--biome", default="grideast")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--cine", default=None)
    ap.add_argument("--extra", default="", help="extra query, e.g. palette=1")
    ap.add_argument("--at", nargs="*", default=["street:1.5", "closeup:0.7", "closeup:1.45", "crane:0.8"])
    ap.add_argument("--skip-at", default=None, help="shot:t at which to press a real Enter")
    ap.add_argument("--out", default=os.path.join(HERE, "shots"))
    ap.add_argument("--settings", default=None, help="JSON merged into localStorage settings before load")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    params = dict(autostart=1, dev=1, titan=args.titan, biome=args.biome, seed=args.seed)
    if args.cine is not None:
        params["cine"] = args.cine
    url = build_url(args.base, **params)
    if args.extra:
        url += ("&" if "?" in url else "?") + args.extra
    want = []
    for a in args.at:
        sh, t = a.split(":")
        want.append((sh, float(t)))
    skip = None
    if args.skip_at:
        sh, t = args.skip_at.split(":")
        skip = (sh, float(t))
    sess = Session(args, "l10cine")
    sess.start()
    timeline = {}
    order = []
    shots = []
    first_play = None
    try:
        if args.settings:
            sess.goto(build_url(args.base))
            sess.safe_js("(s) => { try { const k = Object.keys(localStorage).find(k => /settings/i.test(k)) || 'blocktooth.settings.v1'; const cur = JSON.parse(localStorage.getItem(k) || '{}'); localStorage.setItem(k, JSON.stringify(Object.assign(cur, JSON.parse(s)))); return k; } catch (e) { return String(e); } }", args.settings)
        sess.goto(url)
        sess.wait_bt(90)
        ok, scr = sess.wait_screen(("slate", "play"), 90)
        t0 = time.time()
        done = set()
        pressed = False
        while time.time() - t0 < 20:
            st = sess.safe_js(CINE_JS, default={}) or {}
            c = st.get("cine")
            if st.get("screen") == "play":
                first_play = {"wall": round(time.time() - t0, 3), "tick": st.get("tick")}
                break
            if c:
                sh, t = c["shot"], c["t"]
                if sh not in timeline:
                    timeline[sh] = [t, t]
                    order.append(sh)
                timeline[sh][1] = t
                for i, (wsh, wt) in enumerate(want):
                    if i in done:
                        continue
                    if sh == wsh and t >= wt:
                        done.add(i)
                        p = os.path.join(args.out, "%s_%s_%s_%.2f.png" % (args.titan, args.biome, wsh, wt))
                        sess.screenshot(p)
                        shots.append((p, sh, round(t, 3)))
                if skip and not pressed and sh == skip[0] and t >= skip[1]:
                    sess.press("Enter")
                    pressed = True
            time.sleep(0.015)
        time.sleep(0.4)
        p = os.path.join(args.out, "%s_%s_firstplay.png" % (args.titan, args.biome))
        sess.screenshot(p)
        shots.append((p, "play", None))
    finally:
        diag = sess.diagnostics() if sess.page else {}
        sess.close()
    print("url      :", url)
    print("shots seq:", " -> ".join("%s[%.2f..%.2f]" % (s, timeline[s][0], timeline[s][1]) for s in order))
    print("play at  :", json.dumps(first_play))
    for p, sh, t in shots:
        print("shot     : %s (%s t=%s)" % (p, sh, t))
    probs = diag_problems(diag)
    print("diag     :", "clean" if not probs else probs)


if __name__ == "__main__":
    main()
