"""Screencast the checkpoint flash: real checkpoint trigger, one JPEG per composited frame."""
import base64, io, json, sys, time
from playwright.sync_api import sync_playwright
from PIL import Image
for s in (sys.stdout, sys.stderr):
    try: s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass
URL="http://localhost:8788/games/crestbound/index.html?dev=1"
ARGS=["--use-angle=d3d11","--ignore-gpu-blocklist","--enable-gpu-rasterization","--disable-features=CalculateNativeWinOcclusion"]
OUT="../_shots/ui/"
frames=[]
with sync_playwright() as pw:
    b=pw.chromium.launch(channel="chrome", headless=True, args=ARGS)
    pg=b.new_page(viewport={"width":1600,"height":900})
    cdp=pg.context.new_cdp_session(pg)
    pg.goto(URL, wait_until="load", timeout=150000)
    pg.wait_for_function("() => window.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.state", timeout=150000)
    pg.evaluate("""async () => { const g=CRESTBOUND.game; if (g.state==='title'){ if(g.menu) g.menu.close(); await g.startNewGame?.(); } }""")
    t0=time.time()
    while time.time()-t0<40 and pg.evaluate("()=>CRESTBOUND.game.state")!="keep":
        pg.keyboard.press("Enter"); pg.wait_for_timeout(400)
    pg.evaluate("() => CRESTBOUND.game.__dev.goto('verdant-1')")
    t0=time.time()
    while time.time()-t0<90 and pg.evaluate("()=>CRESTBOUND.game.state")!="playing":
        pg.keyboard.press("Space"); pg.wait_for_timeout(500)
    pg.wait_for_timeout(1500)
    print("state", pg.evaluate("()=>CRESTBOUND.game.state"), "cp", pg.evaluate("()=>CRESTBOUND.game.cpIndex"))
    cdp.send("Page.enable")
    cdp.on("Page.screencastFrame", lambda p: (frames.append((time.time(), p["data"])),
                                              cdp.send("Page.screencastFrameAck", {"sessionId": p["sessionId"]})))
    cdp.send("Page.startScreencast", {"format":"jpeg","quality":82,"everyNthFrame":1})
    pg.wait_for_timeout(500)
    frames.clear()
    t_hit = time.time()
    pg.evaluate("() => CRESTBOUND.game.onCheckpoint(1)")
    pg.wait_for_timeout(2200)
    cdp.send("Page.stopScreencast")
    print("frames", len(frames))
    for i,(ts,data) in enumerate(frames[:18]):
        ms=round((ts-t_hit)*1000)
        n="cp_%02d_%04dms.png"%(i,max(0,ms))
        Image.open(io.BytesIO(base64.b64decode(data))).save(OUT+n)
        print("  ",n)
    print("hud", pg.evaluate("()=>document.getElementById('hud').innerText.slice(0,300)"))
    b.close()
