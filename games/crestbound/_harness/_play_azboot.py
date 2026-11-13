import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]
URL = "http://localhost:8788/games/crestbound/index.html?dev=1&quality=low&autoscale=0"

with sync_playwright() as pw:
    br = pw.chromium.launch(channel="chrome", headless=True, args=FLAGS)
    pg = br.new_page(viewport={"width": 1280, "height": 720})
    msgs = []
    pg.on("console", lambda m: msgs.append(m.type + ": " + m.text[:400]))
    pg.on("pageerror", lambda e: msgs.append("PAGEERROR: " + str(e)[:600]))
    pg.goto(URL, wait_until="load", timeout=90000)
    for i in range(40):
        pg.wait_for_timeout(500)
        ok = pg.evaluate("() => typeof globalThis.CRESTBOUND")
        if ok != "undefined":
            print("CRESTBOUND appeared at %.1f s" % (i * 0.5))
            break
    print("typeof CRESTBOUND:", pg.evaluate("() => typeof globalThis.CRESTBOUND"))
    print("keys:", pg.evaluate("() => globalThis.CRESTBOUND ? Object.keys(CRESTBOUND) : null"))
    print("state:", pg.evaluate("() => globalThis.CRESTBOUND && CRESTBOUND.game ? CRESTBOUND.game.state : null"))
    print("--- console ---")
    for m in msgs[:60]:
        print(m)
    pg.screenshot(path=os.path.join(os.path.dirname(os.path.abspath(__file__)), "_shots", "azboot.png"))
    br.close()
