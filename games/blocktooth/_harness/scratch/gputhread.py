#!/usr/bin/env python
"""GPU-process main-thread budget at Size V + 250 foes (driving, drafts picked at once): traces
--secs of play with light categories and prints per-frame ms on CrGpuMain for WebGL command
execution, tile raster and the display compositor, plus total busy time. --extra adds URL params."""
import json, os, sys, time, collections
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.dirname(HERE))
import argparse
from common import Session, add_common_args, build_url, set_rank  # noqa
import perfcheck  # noqa
ap = argparse.ArgumentParser(); add_common_args(ap); ap.add_argument("--extra", default=""); ap.add_argument("--secs", type=float, default=5)
args = ap.parse_args()
kw = dict(autostart=1, dev=1, noslate=1, titan="molo", biome="grideast", seed=5)
for kv in filter(None, args.extra.split("&")):
    k, v = kv.split("="); kw[k] = v
url = build_url(args.base, **kw)
path = os.path.join(os.environ.get("TEMP", "."), "gputhread_trace.json")
s = Session(args, "gputhread"); s.start()
try:
    s.goto(url); s.wait_bt(90); s.events_off(); s.wait_screen(("play",), 90)
    s.cheat("god", True); s.cheat("noSpawns", True); set_rank(s, 4, print); time.sleep(2.5)
    perfcheck.spawn_mix(s, 250, lambda m: None)
    i = 0; t0 = time.time()
    while time.time() - t0 < 4:
        s.hold(perfcheck.CIRCLE[i % 8]); i += 1; time.sleep(0.3)
        st = s.state() or {}
        if st.get("screen") != "play": perfcheck.clear_overlay(s, st.get("screen"))
    s.browser.start_tracing(page=s.page, path=path, categories=["gpu", "viz", "toplevel"])
    s.js("() => { window.__GT__ = 0; (function f(){ window.__GT__++; requestAnimationFrame(f); })(); }")
    t0 = time.time()
    while time.time() - t0 < args.secs:
        s.hold(perfcheck.CIRCLE[i % 8]); i += 1; time.sleep(0.3)
        st = s.state() or {}
        if st.get("screen") != "play": perfcheck.clear_overlay(s, st.get("screen"))
    frames = s.js("() => window.__GT__")
    s.browser.stop_tracing()
    st = s.state() or {}
    print("scale", st.get("renderScale"), "enemies", st.get("enemies"), "draws", st.get("draws"))
finally:
    s.close()
d = json.load(open(path, encoding="utf-8")); ev = d["traceEvents"]
names = {}
for e in ev:
    if e.get("ph") == "M" and e.get("name") == "thread_name": names[(e["pid"], e["tid"])] = e["args"]["name"]
G = [e for e in ev if names.get((e.get("pid"), e.get("tid"))) == "CrGpuMain" and e.get("ph") == "X"]
tot = collections.defaultdict(float)
busy = 0.0
for e in G:
    nm = e["name"]
    if nm in ("WebGL", "RendererRasterWorker", "SkiaOutputSurfaceImplOnGpu::FinishPaintRenderPass", "SkiaOutputSurfaceImplOnGpu::SwapBuffers", "SkiaOutputSurfaceImplOnGpu::FinishPaintCurrentFrame"):
        tot[nm] += e["dur"] / 1000
    if nm == "ThreadControllerImpl::RunTask": busy += e["dur"] / 1000
n = max(1, frames)
print("frames %d · CrGpuMain per frame: busy %.2f ms · %s" % (frames, busy / n, " · ".join("%s %.2f" % (k.split("::")[-1], v / n) for k, v in tot.items())))
