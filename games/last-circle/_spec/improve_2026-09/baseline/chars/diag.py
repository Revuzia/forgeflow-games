import sys, time
from playwright.sync_api import sync_playwright
t=time.time()
def log(*a): print(f"{time.time()-t:6.1f}s", *a, flush=True)
FLAGS = ["--ignore-gpu-blocklist","--use-angle=d3d11","--enable-gpu","--disable-gpu-sandbox"]
with sync_playwright() as p:
    log("pw up")
    br = p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
    log("launched")
    pg = br.new_page(viewport={"width":1280,"height":720})
    pg.on("console", lambda m: log("console", m.type, m.text[:150]) if m.type in ("error","warning") else None)
    pg.goto("http://127.0.0.1:8790/games/last-circle/index.html", wait_until="domcontentloaded", timeout=60000)
    log("dom")
    for i in range(60):
        ok = pg.evaluate("!!(window.__LC__ && window.__LC__.W)")
        if ok: break
        pg.wait_for_timeout(500)
    log("LC", ok)
    log(pg.evaluate("() => { const gl = window.__LC__.W.kernel.renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a'; }"))
    br.close()
