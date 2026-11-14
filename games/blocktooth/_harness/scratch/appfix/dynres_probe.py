"""DynRes policy probe: the perfcheck load (Size V + ~250 foes, molo/grideast seed 5, real keys) with
the render scale + per-second missed-vsync fraction traced. Run ALONE (no other headed Chrome)."""
import os, sys, time, json, argparse
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from common import Session, add_common_args, build_url, set_rank, percentile
from perfcheck import spawn_mix, clear_overlay, CIRCLE
ap = argparse.ArgumentParser(); add_common_args(ap); ap.add_argument("--seconds", type=float, default=24); ap.add_argument("--extra", default="")
ap.add_argument("--enemies", type=int, default=250); ap.add_argument("--tag", default="x")
args = ap.parse_args(); args.no_serve = True
S = Session(args, "dynres"); S.start()
log = lambda m: print(m, flush=True)
try:
    kw = dict(autostart=1, dev=1, noslate=1, titan="molo", biome="grideast", seed=5)
    for kv in filter(None, args.extra.split(",")): k, v = kv.split("="); kw[k] = v
    S.goto(build_url(args.base, **kw)); S.wait_bt(90); S.events_off(); S.wait_screen("play", 90)
    S.cheat("god", True); S.cheat("noSpawns", True); set_rank(S, 4, log); time.sleep(2.5)
    spawn_mix(S, args.enemies, log); time.sleep(0.5)
    S.ft_start(); t0 = time.time(); i = 0; trace = []; nd = t0
    while time.time() - t0 < args.seconds:
        now = time.time()
        if now >= nd: S.hold(CIRCLE[i % 8]); i += 1; nd = now + 0.35
        s = S.state() or {}
        trace.append((round(now - t0, 2), s.get("renderScale"), s.get("screen"), s.get("dynres")))
        if (s.get("enemies") or 0) < 0.9 * args.enemies: spawn_mix(S, int(args.enemies - (s.get("enemies") or 0)), log)
        if s.get("screen") not in ("play", None): clear_overlay(S, s.get("screen"))
        time.sleep(0.25)
    ft = S.ft_stop(); S.release_all()
    # per-second stats over the harness rAF deltas
    secs = []; acc = 0; cur = []
    for d in ft:
        cur.append(d); acc += d
        if acc >= 1000: secs.append(cur); cur = []; acc = 0
    per = [{"p99": round(percentile(c, 99), 1), "miss%": round(100 * sum(1 for x in c if x > 30) / len(c), 1)} for c in secs]
    last = ft[len(ft) // 2:]
    out = {"tag": args.tag, "p99_all": round(percentile(ft, 99), 1), "p99_2nd_half": round(percentile(last, 99), 1),
           "miss%_2nd_half": round(100 * sum(1 for x in last if x > 30) / max(1, len(last)), 1),
           "scale_trace": [(t, sc, scr, dr) for (t, sc, scr, dr) in trace[::4]], "per_second": per}
    print(json.dumps(out))
    json.dump(out, open(os.path.join(HERE, "dynres_%s.json" % args.tag), "w"), indent=1)
finally:
    S.close()
