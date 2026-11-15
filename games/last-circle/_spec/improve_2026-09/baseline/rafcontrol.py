#!/usr/bin/env python
"""Control: does requestAnimationFrame run at all in this headless Chrome config right now?
A trivial page (rAF counter + a 1600x900 WebGL clear per frame) measured for 5 s with the SAME flags as
lc_liveprobe.py. If this page is also starved, the box (GPU/compositor) is the cause, not Last Circle.
    python rafcontrol.py [--angle d3d11|gl|swiftshader] [--headed]
"""
import argparse
import json
import sys
import time
from playwright.sync_api import sync_playwright

HTML = """<!doctype html><html><body style="margin:0"><canvas id=c width=1600 height=900></canvas><script>
const gl = document.getElementById('c').getContext('webgl2');
window.F = { n: 0, dts: [], last: -1 };
function f(ts){ const F = window.F; F.n++; if (F.last >= 0) F.dts.push(ts - F.last); F.last = ts;
  gl.clearColor(Math.random(), 0.2, 0.3, 1); gl.clear(gl.COLOR_BUFFER_BIT); requestAnimationFrame(f); }
requestAnimationFrame(f);
</script></body></html>"""

ap = argparse.ArgumentParser()
ap.add_argument("--angle", default="d3d11")
ap.add_argument("--headed", action="store_true")
ap.add_argument("--seconds", type=float, default=5)
ap.add_argument("--extra", action="append", default=[])
a = ap.parse_args()
flags = ["--ignore-gpu-blocklist", "--use-angle=%s" % a.angle, "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion", "--disable-background-timer-throttling",
         "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"] + a.extra
with sync_playwright() as pw:
    b = pw.chromium.launch(channel="chrome", headless=not a.headed, args=flags)
    p = b.new_page(viewport={"width": 1600, "height": 900})
    p.set_content(HTML)
    time.sleep(1)
    p.evaluate("() => { window.F.dts = []; window.F.n = 0; }")
    time.sleep(a.seconds)
    r = p.evaluate("""() => { const d = window.F.dts.slice().sort((x, y) => x - y);
        const q = (k) => d.length ? d[Math.min(d.length - 1, Math.floor(k * (d.length - 1)))] : null;
        const gl = document.getElementById('c').getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info');
        return { frames: window.F.n, p50: q(0.5), p99: q(0.99), max: d[d.length - 1], gpu: e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : null }; }""")
    r["angle"] = a.angle; r["extra"] = a.extra
    print(json.dumps(r))
    b.close()
