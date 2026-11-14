#!/usr/bin/env python
"""Measure steady-state FPS at a URL. Same method for any build, so two trees compare.

Frame times come from an in-page rAF chain rather than from Playwright: the harness
adds its own latency to anything it polls, and what we want is what the renderer
delivers. Warmup frames are discarded because the first seconds include shader
specialisation and texture upload, which are real but are not steady state.
"""
import argparse, sys, statistics, json
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
READY = """() => {const SF=globalThis.SNOWFLOW;if(!SF||!SF.terrain)return false;
const b=document.getElementById('boot');return !(b&&!b.classList.contains('gone'));}"""
ap = argparse.ArgumentParser()
ap.add_argument("--url", required=True)
ap.add_argument("--label", default="")
ap.add_argument("--warm", type=int, default=60)
ap.add_argument("--n", type=int, default=120)
a = ap.parse_args()
with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome", headless=False, args=[
        "--ignore-gpu-blocklist","--use-angle=d3d11","--disable-gpu-sandbox",
        "--enable-gpu-rasterization","--disable-features=CalculateNativeWinOcclusion"])
    pg = br.new_page(viewport={"width":1280,"height":720})
    pg.add_init_script("""
      window.__t=[];window.__f=0;let l=0;
      (function tick(ts){ if(l) window.__t.push(ts-l); l=ts; window.__f++;
        requestAnimationFrame(tick); })(performance.now());
    """)
    pg.goto(a.url, wait_until="load", timeout=90_000)
    pg.wait_for_function(READY, timeout=180_000)
    pg.evaluate("() => { window.__t.length = 0; }")
    s = pg.evaluate("()=>window.__f")
    pg.wait_for_function("(s)=>window.__f>s+%d"%(a.warm+a.n), arg=s, timeout=120_000)
    t = pg.evaluate("()=>window.__t")[a.warm:]
    st = pg.evaluate("""()=>({draws:SNOWFLOW.perfStats.drawCalls,
                              tris:SNOWFLOW.perfStats.triangles,
                              w:SNOWFLOW.renderer.domElement.width,
                              h:SNOWFLOW.renderer.domElement.height})""")
    t = [x for x in t if x > 0]
    fps = [1000.0/x for x in t]
    print(f"{a.label or a.url}")
    print(f"  frames {len(t)}  FPS mean {statistics.mean(fps):.1f}  median {statistics.median(fps):.1f}"
          f"  p95ms {sorted(t)[int(len(t)*0.95)-1]:.1f}")
    print(f"  draws {st['draws']}  tris {st['tris']:,}  backbuffer {st['w']}x{st['h']}")
    br.close()
