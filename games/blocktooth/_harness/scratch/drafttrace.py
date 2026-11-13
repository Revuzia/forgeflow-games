#!/usr/bin/env python
"""Trace the FIRST draft open (Chrome tracing, all processes) and list the long events."""
import argparse, json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.dirname(HERE))
from common import Session, add_common_args, build_url, set_rank, REPORTS  # noqa
ap = argparse.ArgumentParser(); add_common_args(ap)
ap.add_argument("--rank", type=int, default=4); ap.add_argument("--extra", default="")
args = ap.parse_args()
kw = dict(autostart=1, dev=1, noslate=1, titan="molo", biome="grideast", seed=5, prof=1)
for kv in filter(None, args.extra.split("&")):
    k, v = kv.split("="); kw[k] = v
url = build_url(args.base, **kw)
s = Session(args, "drafttrace"); s.start()
try:
    s.goto(url); s.wait_bt(90); s.events_off(); s.wait_screen(("play",), 90)
    s.cheat("god", True); s.cheat("noSpawns", True)
    if args.rank: set_rank(s, args.rank, print)
    time.sleep(3.0)
    st = s.state(); print("screen", st["screen"], "rank", st["rank"], "level", st["level"])
    if st["screen"] == "draft":
        s.press("Digit1"); time.sleep(1.0)
    cats = ["toplevel", "gpu", "viz", "cc", "blink", "benchmark", "disabled-by-default-devtools.timeline",
            "disabled-by-default-gpu.service", "disabled-by-default-skia.gpu", "skia", "disabled-by-default-viz.gpu_composite_time", "v8", "disabled-by-default-v8.gc"]
    s.browser.start_tracing(page=s.page, categories=cats)
    s.safe_js("() => window.__BTPROF__ && window.__BTPROF__.reset()")
    time.sleep(0.5)
    t0 = time.time()
    s.cheat("xp", 100000)
    time.sleep(2.0)
    raw = s.browser.stop_tracing()
    print("screen after", s.state()["screen"])
    prof = s.js("() => JSON.stringify(window.__BTPROF__.dump())")
finally:
    s.close()
tr = json.loads(raw)
ev = tr["traceEvents"] if isinstance(tr, dict) else tr
open(os.path.join(REPORTS, "drafttrace.json"), "wb").write(raw)
pn, tn = {}, {}
for e in ev:
    if e.get("ph") == "M" and e.get("name") == "process_name": pn[e["pid"]] = e["args"]["name"]
    if e.get("ph") == "M" and e.get("name") == "thread_name": tn[(e["pid"], e["tid"])] = e["args"]["name"]
long = [e for e in ev if e.get("ph") == "X" and e.get("dur", 0) > 25000]
long.sort(key=lambda e: e["ts"])
ts0 = min(e["ts"] for e in ev if e.get("ts"))
for e in long:
    print("%8.1f ms  dur %6.1f  %-14s %-26s %s  %s" % ((e["ts"] - ts0) / 1000, e["dur"] / 1000, pn.get(e["pid"], e["pid"])[:14],
          tn.get((e["pid"], e["tid"]), e["tid"])[:26], e["name"], json.dumps(e.get("args", {}))[:160]))
d = json.loads(prof)
print("prof worst:", [(f["raw"], f["screen"], f["note"]) for f in d["worst"][:6]])
for f in d["worst"][:2]:
    print("  W", f["raw"], f["cpu"], f["gpu"], f["note"], f["sec"], "PREV", (f.get("prev") or {}).get("cpu"), (f.get("prev") or {}).get("note"), (f.get("prev") or {}).get("sec"))
