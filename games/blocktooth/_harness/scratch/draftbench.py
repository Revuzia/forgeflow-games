#!/usr/bin/env python
"""Draft-open cost bench at Size V + 250 foes (perfcheck setup, headed): K times — drive 1.2 s with
real keys, cheat.xp to owe a level-up, let the draft sit ~0.45 s, pick with Digit1. Records every rAF
gap with the screen it was drawn on (page-side recorder) and prints, per draft, the slow frames
(> 22 ms) from open to 0.5 s after close.  INJECT_CSS='…' appends a stylesheet (A/B the card CSS).
   python _harness/scratch/draftbench.py [--k 12] [--extra 'rscale=0.6']"""
import json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.dirname(HERE))
import argparse
from common import Session, add_common_args, build_url, set_rank  # noqa
import perfcheck  # noqa
ap = argparse.ArgumentParser(); add_common_args(ap)
ap.add_argument("--k", type=int, default=12); ap.add_argument("--extra", default="")
ap.add_argument("--hold", type=float, default=0.45)
ap.add_argument("--trace", default="")
ap.add_argument("--tcats", default="")
ap.add_argument("--pre", type=int, default=0, help="drafts opened+closed BEFORE the recorder starts")
args = ap.parse_args()
kw = dict(autostart=1, dev=1, noslate=1, titan="molo", biome="grideast", seed=5)
for kv in filter(None, args.extra.split("&")):
    k, v = kv.split("="); kw[k] = v
url = build_url(args.base, **kw)
REC = """() => { window.__DB__ = []; let last = 0; const f = (ts) => { if (last) window.__DB__.push([ts - last, document.body.dataset.screen || '']); last = ts; if (window.__DB_ON__ !== false) requestAnimationFrame(f); }; requestAnimationFrame(f); }"""
s = Session(args, "draftbench"); s.start()
css = os.environ.get("INJECT_CSS")
if css:
    s.page.add_init_script("document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = %s; document.head.appendChild(s); });" % json.dumps(css))
try:
    s.goto(url); s.wait_bt(90); s.events_off(); s.wait_screen(("play",), 90)
    s.cheat("god", True); s.cheat("noSpawns", True); set_rank(s, 4, print); time.sleep(2.5)
    perfcheck.spawn_mix(s, 250, lambda m: None)
    i = 0
    t0 = time.time()
    while time.time() - t0 < 3:
        s.hold(perfcheck.CIRCLE[i % 8]); i += 1; time.sleep(0.35)
        st = s.state() or {}
        if st.get("screen") != "play": perfcheck.clear_overlay(s, st.get("screen"))
    def one_draft():
        st0 = s.state() or {}; lv = st0.get("level") or 1
        s.cheat("xp", max(1, round(8 + 6 * lv ** 1.35 - (st0.get("xp") or 0) + 0.5)))
        time.sleep(0.8); perfcheck.clear_overlay(s, "draft"); time.sleep(0.8)
    for _ in range(args.pre): one_draft()
    if args.trace:
        s.browser.start_tracing(page=s.page, path=args.trace, categories=["toplevel", "viz", "cc", "gpu", "blink", "benchmark",
            "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame", "disabled-by-default-gpu.service", "disabled-by-default-viz.gpu_composite_time"] + [c for c in args.tcats.split(",") if c])
    s.js(REC)
    for k in range(args.k):
        t1 = time.time()
        while time.time() - t1 < 1.2:
            s.hold(perfcheck.CIRCLE[i % 8]); i += 1; time.sleep(0.3)
            st = s.state() or {}
            if st.get("screen") == "draft": perfcheck.clear_overlay(s, "draft"); time.sleep(0.4)
        cur = s.state() or {}
        if (cur.get("enemies") or 0) < 225: perfcheck.spawn_mix(s, 250 - (cur.get("enemies") or 0), lambda m: None)
        st0 = s.state() or {}; lv = st0.get("level") or 1; s.cheat("xp", max(1, round(8 + 6 * lv ** 1.35 - (st0.get("xp") or 0) + 0.5)))
        t2 = time.time()
        while time.time() - t2 < 1.5:
            st = s.state() or {}
            if st.get("screen") == "draft": break
            time.sleep(0.05)
        time.sleep(args.hold)
        perfcheck.clear_overlay(s, "draft"); time.sleep(0.5)
        st = s.state() or {}
        while st.get("screen") == "draft":
            perfcheck.clear_overlay(s, "draft"); time.sleep(0.5); st = s.state() or {}
    s.release_all()
    if args.trace: s.browser.stop_tracing()
    rec = s.js("() => { window.__DB_ON__ = false; return window.__DB__; }")
    # episodes
    eps = []; cur = None
    for j, (dt, sc) in enumerate(rec):
        if sc == "draft" and cur is None: cur = j
        if sc != "draft" and cur is not None: eps.append((cur, j)); cur = None
    tot_slow = 0; tot_frames = 0; open_slow = 0; close_slow = 0
    for n, (a, b) in enumerate(eps):
        seg = rec[a:b + 25]
        slow = [(j, round(dt, 1)) for j, (dt, sc) in enumerate(seg) if dt > 22]
        tot_slow += len(slow); tot_frames += len(seg)
        if n > 0: open_slow += sum(1 for j, _ in slow if j < 10); close_slow += sum(1 for j, _ in slow if (b - a) <= j < (b - a) + 12)
        print("draft %2d: frames %3d (+25 after) slow %s" % (n, b - a, slow))
    play = [dt for dt, sc in rec if sc == "play"]
    print("TOTAL draft-window slow frames %d / %d · play frames %d slow %d · OPEN(first 10 fr, drafts 1+) slow %d · CLOSE(12 fr after) slow %d over %d drafts" % (tot_slow, tot_frames, len(play), sum(1 for x in play if x > 22), open_slow, close_slow, max(0, len(eps) - 1)))
finally:
    s.close()
