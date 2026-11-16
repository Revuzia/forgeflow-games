import sys, os, json
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.dirname(HERE))
import common as C, argparse
ap = argparse.ArgumentParser(); C.add_common_args(ap); ap.add_argument("--seed", type=int); ap.add_argument("--map"); ap.add_argument("--watch"); ap.add_argument("--t0", type=float, default=0); ap.add_argument("--secs", type=float, default=1000); ap.add_argument("--dbgout")
args = ap.parse_args(); args.disk = True
js = open("F:/lc_p23/w10/t/R1A/fix5/t/pm_dbg.js", encoding="utf-8").read()
with C.Session(args, "probe_match", viewport={"width": 960, "height": 600}) as s:
    s.boot(); s.freeze_loop()
    s.start_match("standard", args.seed, args.map, enter=True); s.freeze_loop()
    s.page.evaluate("(t) => { globalThis.__DBG_T0 = t; }", args.t0)
    res = s.page.evaluate(js, [args.seed, args.map, args.secs, 1 / 30, 0, 1, 1, args.watch.split(",")])
    json.dump({"track": res.get("track"), "stuckEp": res.get("stuckEp")}, open(args.dbgout, "w"))
    print("done", len(res.get("stuckEp") or []))
