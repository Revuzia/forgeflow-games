#!/usr/bin/env python
"""simcost - what does the SIM cost per tick, this tree against the live build?  INFORMATION ONLY (Wave-7 completion round, lane D5).

    python _harness/simcost.py --disk                         # ashgrid (Savanna), seed 7: the working copy vs common.LIVE_REV, A B A B
    python _harness/simcost.py --disk --maps ashgrid,isla_viva --reps 3
    python _harness/simcost.py --rev dd414cb2 --baseline 60b854d0         # any two commits

The Wave-7 verify measured the Savanna city at about TWICE the live sim cost on this box (a whole bot match through fastForward: 12-18 s against 5-6 s, ~0.36 ms per tick) and 11-13 frames over
50 ms against 1 on live (stepped and rendered over the plane flight and the first fights, none over 100 ms; the live build's one frame over 100 ms was a 520 ms shader compile mid-drop that the
Wave-7 warm-up fixed). Milliseconds are never a pass/fail here (this box is shared and slow; the sim is tick-scheduled and deterministic whatever it costs),
but the number is what tells a later wave whether the town work (navgrid tiles, kit colliders, queryColliders) is eating the bots' budget on a phone. This prints it, per map, as INFORMATION rows:

  * for each rep, a fresh Chrome loads a standard storm-on match (a REAL Enter, the loop frozen: the sim only advances when this script says so) at --seed on the candidate and then on the baseline
    (A B A B: a slow minute on the box hits both builds), and times `fastForward(10 s, 1/30)` twelve times in a row = 120 s of match time = 3,600 ticks (drop, landing, the first fights)
  * first, in the same page: the HITCH count - `--hitch-s` (default 30) seconds of match time stepped AND rendered frame by frame (60 Hz, the shared pump, gl draws real): the median / p99 / max
    ms per frame and the number of frames over 50 ms and over 100 ms, from the plane flight on (the verify's hitch.py)
  * ms per tick = wall ms / 300 ticks per slice. Printed: every slice, the median of slices 2..12 (slice 1 pays the JIT warm-up), the ratio candidate / baseline of the per-rep medians
  * the rows judge only that the measurement happened (both builds, every rep, 0 page errors); the ratio is the information

Exit 0 when measured, 2 could-not-judge (a match would not load, a rep measured nothing). Never exits 1 for a ratio.
"""
from __future__ import annotations

import argparse
import copy
import os
import statistics
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

GATE = "simcost"
SLICES = 12
SLICE_S = 10
STEP = 1.0 / 30
TICKS_PER_SLICE = int(round(SLICE_S / STEP))

HITCH_JS = r"""async (n) => { const P = window.__H_PUMP__, out = [], W = window.__LC__.W;
  for (let i = 0; i < n; i++) { const t0 = performance.now(); P.step(1, 1 / 60, true); out.push([+(performance.now() - t0).toFixed(2), W.phase]); }
  return out; }"""
TIME_JS = r"""([slices, sliceS, step]) => { const C = window.__LC__, W = C.W; W.paused = true;
  const out = []; const t0 = W.t;
  for (let i = 0; i < slices; i++) { const a = performance.now(); C.fastForward(sliceS, step); out.push(performance.now() - a); }
  return { ms: out, simT0: +t0.toFixed(2), simT1: +W.t.toFixed(2), phase: W.phase, alive: (W.actors || []).filter((a) => a.alive).length }; }"""


def one(args, map_id, rev, label):
    a = copy.copy(args)
    a.rev = rev
    a.disk = True
    with C.Session(a, "simcost", viewport={"width": 960, "height": 600}) as s:
        s.boot()
        s.freeze_loop()
        s.install_pump()
        st = s.start_match(mode="standard", seed=args.seed, map_id=map_id)
        s.freeze_loop()
        s.guard_player(True)
        hit = None
        if args.hitch_s > 0:
            fr = s.js(HITCH_JS, int(args.hitch_s * 60))
            ms_ = sorted(x[0] for x in fr)
            n_ = len(ms_)
            hit = {"frames": n_, "median": ms_[n_ // 2], "p99": ms_[int(n_ * 0.99)], "max": ms_[-1], "over50": sum(1 for x in ms_ if x > 50), "over100": sum(1 for x in ms_ if x > 100),
                   "top3": sorted(fr, key=lambda x: -x[0])[:3]}
        r = s.js(TIME_JS, [SLICES, SLICE_S, STEP])
        r["hitch"] = hit
        r["loadS"] = st.get("load_s")
        r["pageErrors"] = [e[1][:160] for e in s.page_errors][:3]
    ms = r["ms"]
    med = statistics.median(ms[1:]) if len(ms) > 1 else ms[0]
    r["medianMsPerTick"] = round(med / TICKS_PER_SLICE, 4)
    r["totalMsPerTick"] = round(sum(ms) / (TICKS_PER_SLICE * len(ms)), 4)
    print("  [%s %s] sim t %.1f -> %.1f (%s, %d alive) | ms per tick: median %.3f, mean %.3f | slices ms %s" % (
        label, map_id, r["simT0"], r["simT1"], r["phase"], r["alive"], r["medianMsPerTick"], r["totalMsPerTick"], [round(x) for x in ms]), flush=True)
    if r.get("hitch"):
        h = r["hitch"]
        print("  [%s %s] hitch: %d stepped+rendered frames: median %.1f p99 %.1f max %.1f ms; > 50 ms: %d, > 100 ms: %d; worst %s" % (
            label, map_id, h["frames"], h["median"], h["p99"], h["max"], h["over50"], h["over100"], h["top3"]), flush=True)
    return r


def main_fn(v, args):
    maps = [m for m in args.maps.split(",") if m]
    base_rev = args.baseline
    if not args.rev and not args.disk:
        raise C.EnvFailure("simcost serves both builds through page routing: it needs --disk or --rev")
    cand_rev = args.rev
    clabel = ("git " + C.git_blobs(cand_rev).sha) if cand_rev else "working copy"
    blabel = "git " + C.git_blobs(base_rev).sha
    v.data.update({"maps": maps, "seed": args.seed, "reps": args.reps, "candidate": clabel, "baseline": blabel})
    print("%s: %s vs %s | maps %s | seed %d | %d reps (A B each) | %d slices of %d s" % (GATE, clabel, blabel, ",".join(maps), args.seed, args.reps, SLICES, SLICE_S), flush=True)
    for m in maps:
        cand, base, ratios = [], [], []
        for k in range(args.reps):
            c = one(args, m, cand_rev, "A candidate rep %d" % (k + 1))
            b = one(args, m, base_rev, "B baseline  rep %d" % (k + 1))
            cand.append(c)
            base.append(b)
            if b["medianMsPerTick"] > 0:
                ratios.append(c["medianMsPerTick"] / b["medianMsPerTick"])
        errs = [e for r in cand + base for e in r["pageErrors"]]
        v.check("measured [%s]" % m, len(ratios) == args.reps and not errs, "%d paired reps; page errors %s" % (len(ratios), errs[:3]))
        if ratios:
            cm = statistics.median(r["medianMsPerTick"] for r in cand)
            bm = statistics.median(r["medianMsPerTick"] for r in base)
            v.info("sim cost per tick [%s] (information)" % m, "candidate %.3f ms (reps %s) | baseline %.3f ms (reps %s) | ratio %.2f (per-rep ratios %s) | match load %s s vs %s s" % (
                cm, [r["medianMsPerTick"] for r in cand], bm, [r["medianMsPerTick"] for r in base], cm / bm if bm else 0, [round(x, 2) for x in ratios],
                [r["loadS"] for r in cand], [r["loadS"] for r in base]))
            if args.hitch_s > 0 and all(r.get("hitch") for r in cand + base):
                ch, bh = [r["hitch"] for r in cand], [r["hitch"] for r in base]
                v.info("frame hitches [%s] (information; %.0f s of stepped + rendered match time per rep)" % (m, args.hitch_s),
                       "candidate: median %s ms, p99 %s, max %s, frames > 50 ms %s, > 100 ms %s | baseline: median %s ms, p99 %s, max %s, frames > 50 ms %s, > 100 ms %s (per rep, in order)" % (
                           [h["median"] for h in ch], [h["p99"] for h in ch], [h["max"] for h in ch], [h["over50"] for h in ch], [h["over100"] for h in ch],
                           [h["median"] for h in bh], [h["p99"] for h in bh], [h["max"] for h in bh], [h["over50"] for h in bh], [h["over100"] for h in bh]))
            v.info("per-tick budget [%s]" % m, "at 30 Hz a tick has 33.3 ms; the candidate sim uses %.1f %% of it on this box (baseline %.1f %%)" % (100 * cm / 33.3, 100 * bm / 33.3))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--maps", default="ashgrid", help="comma list (default ashgrid = Savanna)")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--hitch-s", type=float, default=30.0, help="seconds of stepped + rendered frames per rep for the hitch count (0 = skip)")
    ap.add_argument("--reps", type=int, default=2, help="A B pairs per map (default 2: A B A B)")
    ap.add_argument("--baseline", default=C.LIVE_REV, help="the build the candidate is compared with (default common.LIVE_REV)")
    args = ap.parse_args()
    return C.run_gate(GATE, lambda v: main_fn(v, args), args)


if __name__ == "__main__":
    sys.exit(main())
