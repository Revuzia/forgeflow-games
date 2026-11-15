# ui lane: run the keyboard interaction flow (?screen=flow) and print window.__RESULTS__
import json, sys, time
from playwright.sync_api import sync_playwright
url = "http://localhost:5187/_harness/scratch/ui/index.html?screen=flow"
with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True)
    pg = b.new_page(viewport={"width": 1280, "height": 720})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" and "404" not in m.text else None)
    pg.goto(url)
    t0 = time.time()
    while time.time() - t0 < 40:
        if pg.evaluate("() => !!window.__SNAP_READY__"): break
        time.sleep(0.25)
    for r in pg.evaluate("() => window.__RESULTS__"): print(json.dumps(r))
    print("ERRORS:", errs)
    b.close()
