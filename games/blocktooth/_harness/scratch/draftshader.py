#!/usr/bin/env python
"""How many NEW Skia GPU programs (GrShaderCache::store in the GPU process) does the first draft of a
session compile? Fresh browser, Size I, trace from just before cheat.xp → draft → pick → 1 s of play.
INJECT_CSS='…' appends a stylesheet (bisect which card style needs them).
   python _harness/scratch/draftshader.py [--extra k=v&…] [--keep trace.json]"""
import json, os, sys, time, collections
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.dirname(HERE))
import argparse
from common import Session, add_common_args, build_url  # noqa
ap = argparse.ArgumentParser(); add_common_args(ap); ap.add_argument("--extra", default=""); ap.add_argument("--keep", default="")
ap.add_argument("--cats", default="")
args = ap.parse_args()
kw = dict(autostart=1, dev=1, noslate=1, titan="molo", biome="grideast", seed=5)
for kv in filter(None, args.extra.split("&")):
    k, v = kv.split("="); kw[k] = v
url = build_url(args.base, **kw)
s = Session(args, "draftshader"); s.start()
css = os.environ.get("INJECT_CSS")
if css:
    s.page.add_init_script("document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = %s; document.head.appendChild(s); });" % json.dumps(css))
path = args.keep or os.path.join(os.environ.get("TEMP", "."), "draftshader_trace.json")
try:
    s.goto(url); s.wait_bt(90); s.events_off(); s.wait_screen(("play",), 90)
    time.sleep(1.0)
    cats = ["gpu", "toplevel", "cc", "viz"] + [c for c in args.cats.split(",") if c]
    s.browser.start_tracing(page=s.page, path=path, categories=cats)
    time.sleep(0.3)
    marks = {}
    marks["xp"] = s.js("() => performance.now()")
    st0 = s.state() or {}; lv = st0.get("level") or 1
    s.cheat("xp", max(1, round(8 + 6 * lv ** 1.35 - (st0.get("xp") or 0) + 0.5)))
    time.sleep(1.2)
    marks["pick"] = s.js("() => performance.now()")
    s.press("Digit1"); time.sleep(1.2)
    st = s.state() or {}
    if st.get("screen") == "draft": s.press("Digit1"); time.sleep(1.0)
    s.browser.stop_tracing()
finally:
    s.close()
d = json.load(open(path, encoding="utf-8")); ev = d["traceEvents"] if isinstance(d, dict) else d
t0 = min(e["ts"] for e in ev if e.get("ts"))
st = [e for e in ev if e.get("name") == "GrShaderCache::store"]
fl = [e for e in ev if e.get("name") == "RasterDecoderImpl::DoEndRasterCHROMIUM::Flush" and e.get("dur", 0) > 8000]
print("SHADER STORES %d at %s ms · slow raster flushes %s" % (len(st), [round((e["ts"] - t0) / 1000) for e in st],
      [(round((e["ts"] - t0) / 1000), round(e["dur"] / 1000, 1)) for e in fl]))
