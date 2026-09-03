import sys, time, json
from playwright.sync_api import sync_playwright
FLAGS=["--ignore-gpu-blocklist","--use-angle=d3d11","--disable-gpu-sandbox","--enable-gpu-rasterization",
       "--disable-features=CalculateNativeWinOcclusion","--autoplay-policy=no-user-gesture-required","--force-device-scale-factor=1"]
msgs=[]
with sync_playwright() as p:
    br=p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
    ctx=br.new_context(viewport={"width":1600,"height":900}, device_scale_factor=1)
    pg=ctx.new_page()
    pg.on("console", lambda m: msgs.append((m.type, m.text[:200])))
    pg.on("pageerror", lambda e: msgs.append(("pageerror", str(e)[:200])))
    pg.goto("http://localhost:8788/games/crestbound/index.html?dev=1", wait_until="load", timeout=60000)
    dl=time.time()+180
    st=None
    while time.time()<dl:
        try: st=pg.evaluate("()=> (globalThis.CRESTBOUND&&CRESTBOUND.game)?CRESTBOUND.game.state:null")
        except Exception: st=None
        if st=="title": break
        pg.wait_for_timeout(300)
    pg.wait_for_timeout(2000)
    print("state:", st)
    errs=[m for m in msgs if m[0] in ("error","pageerror")]
    print("errors:", len(errs))
    for m in errs: print("  ", m[0], "|", m[1])
    ctx.close(); br.close()
