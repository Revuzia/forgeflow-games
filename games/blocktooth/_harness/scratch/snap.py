#!/usr/bin/env python
"""Lane scratch snapshot tool (orchestrator-owned).

  python _harness/scratch/snap.py URL OUT.png [--wait 4] [--w 1280 --h 720] [--eval "js expr"]

Opens URL in HEADLESS Chrome on the real GPU (ANGLE d3d11), waits until
window.__SNAP_READY__ is truthy (or --wait seconds), optionally evaluates --eval,
prints every console error / page error, saves a PNG, prints GPU renderer string.
Exit 0 = screenshot saved and no page errors; 1 = errors seen; 2 = page failed to load.
"""
import argparse, sys, time
from playwright.sync_api import sync_playwright
for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion", "--enable-unsafe-swiftshader"]

ap = argparse.ArgumentParser()
ap.add_argument("url"); ap.add_argument("out")
ap.add_argument("--wait", type=float, default=6.0)
ap.add_argument("--w", type=int, default=1280); ap.add_argument("--h", type=int, default=720)
ap.add_argument("--eval", default=None)
a = ap.parse_args()
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
    pg = b.new_page(viewport={"width": a.w, "height": a.h})
    pg.on("console", lambda m: (errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None))
    pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    bad = []
    pg.on("response", lambda r: (bad.append(r.url) if r.status >= 400 else None))
    try:
        pg.goto(a.url, wait_until="load", timeout=60000)
    except Exception as e:
        print("LOAD FAILED:", e); sys.exit(2)
    t0 = time.time()
    while time.time() - t0 < a.wait:
        try:
            if pg.evaluate("() => !!window.__SNAP_READY__"): break
        except Exception: pass
        time.sleep(0.25)
    time.sleep(0.5)
    if a.eval:
        try: print("EVAL:", pg.evaluate(a.eval))
        except Exception as e: errors.append(f"eval: {e}")
    try:
        gpu = pg.evaluate("""() => { const c=document.createElement('canvas'); const g=c.getContext('webgl2');
          if(!g) return 'no webgl2'; const d=g.getExtension('WEBGL_debug_renderer_info');
          return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); }""")
        print("GPU:", gpu)
    except Exception: pass
    pg.screenshot(path=a.out)
    b.close()
# a 404 for favicon.ico is not a defect; any other failed resource is reported with its URL
errors = [e for e in errors if not ("404" in e and bad and all("favicon" in u for u in bad))]
for u in bad:
    if "favicon" not in u: errors.append(f"http>=400: {u}")
for e in errors: print(e)
print("SAVED", a.out, "errors:", len(errors))
sys.exit(1 if errors else 0)
