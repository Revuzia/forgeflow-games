#!/usr/bin/env python
"""Size V + 250 foes, driving: per-frame WebGL call census (wraps the context's methods): calls by
name, bytes uploaded by bufferSubData/bufferData/texSubImage, uniform calls, draw calls."""
import json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.dirname(HERE))
import argparse
from common import Session, add_common_args, build_url, set_rank  # noqa
import perfcheck  # noqa
ap = argparse.ArgumentParser(); add_common_args(ap); ap.add_argument("--extra", default=""); args = ap.parse_args()
kw = dict(autostart=1, dev=1, noslate=1, titan="molo", biome="grideast", seed=5)
for kv in filter(None, args.extra.split("&")):
    k, v = kv.split("="); kw[k] = v
url = build_url(args.base, **kw)
WRAP = """() => {
  const gl = window.__BT__.debugCore.renderer.getContext(); const P = Object.getPrototypeOf(gl);
  const st = window.__GLC__ = { calls: {}, bytes: {}, frames: 0, byLabel: {} };
  for (const k of Object.getOwnPropertyNames(P)) {
    const d = Object.getOwnPropertyDescriptor(P, k); if (!d || typeof d.value !== 'function') continue;
    const f = d.value; if (k === 'getError' ) continue;
    gl[k] = function (...a) {
      st.calls[k] = (st.calls[k] || 0) + 1;
      if (k === 'bufferSubData' || k === 'bufferData') { const v = a[2]; let n = 0; if (v && v.byteLength !== undefined) n = (a.length > 4 && a[4]) ? a[4] * (v.BYTES_PER_ELEMENT||1) : v.byteLength; else if (typeof v === 'number') n = v; if (k === 'bufferSubData' && a.length >= 5) n = a[4] * (a[2].BYTES_PER_ELEMENT || 1); st.bytes[k] = (st.bytes[k] || 0) + n; }
      if (k.startsWith('texSubImage') || k.startsWith('texImage')) st.bytes.tex = (st.bytes.tex || 0) + 1;
      return f.apply(this, a);
    };
  }
  (function fr() { st.frames++; requestAnimationFrame(fr); })();
  return 'ok';
}"""
s = Session(args, "glcalls"); s.start()
try:
    s.goto(url); s.wait_bt(90); s.events_off(); s.wait_screen(("play",), 90)
    s.cheat("god", True); s.cheat("noSpawns", True); set_rank(s, 4, print); time.sleep(2.5)
    perfcheck.spawn_mix(s, 250, lambda m: None)
    for i in range(8):
        s.hold(perfcheck.CIRCLE[i % 8]); time.sleep(0.35)
        st = s.state() or {}
        if st.get("screen") != "play": perfcheck.clear_overlay(s, st.get("screen"))
    print(s.js(WRAP))
    s.js("() => { const st = window.__GLC__; st.calls = {}; st.bytes = {}; st.frames = 0; }")
    t0 = time.time(); i = 0; drafts = 0
    while time.time() - t0 < 4:
        s.hold(perfcheck.CIRCLE[i % 8]); i += 1; time.sleep(0.3)
        st = s.state() or {}
        if st.get("screen") != "play": perfcheck.clear_overlay(s, st.get("screen")); drafts += 1
    r = s.js("() => window.__GLC__")
    n = max(1, r["frames"])
    print("frames", n, "drafts", drafts)
    print("bytes/frame:", {k: round(v / n) for k, v in r["bytes"].items()})
    for k, v in sorted(r["calls"].items(), key=lambda kv: -kv[1])[:30]: print("  %-32s %8.1f /frame" % (k, v / n))
finally:
    s.close()
