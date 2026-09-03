import base64, json, os, sys, time
from playwright.sync_api import sync_playwright
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass
HERE=os.path.dirname(os.path.abspath(__file__))
OUT=os.path.normpath(os.path.join(HERE,"..","_shots","ui"))
URL="http://localhost:8788/games/crestbound/index.html"
FLAGS=["--ignore-gpu-blocklist","--use-angle=d3d11","--disable-gpu-sandbox","--enable-gpu-rasterization",
       "--disable-features=CalculateNativeWinOcclusion","--autoplay-policy=no-user-gesture-required",
       "--force-device-scale-factor=1"]
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome",headless=True,args=FLAGS)
    ctx=b.new_context(viewport={"width":1600,"height":900})
    pg=ctx.new_page()
    cdp=ctx.new_cdp_session(pg)
    def still(name):
        d=cdp.send("Page.captureScreenshot",{"format":"png"})
        open(os.path.join(OUT,name),"wb").write(base64.b64decode(d["data"]))
        print("  shot",name)
    pg.goto(URL); pg.wait_for_function("()=>window.CRESTBOUND&&CRESTBOUND.game&&CRESTBOUND.game.state==='title'",timeout=120000)
    pg.wait_for_timeout(1200)
    pg.evaluate("""()=>{const m=CRESTBOUND.game.menu; m.open('controls');}""")
    pg.wait_for_timeout(1200)
    info=pg.evaluate("""()=>{
      const els=[...document.querySelectorAll('*')].filter(n=>n.scrollHeight>n.clientHeight+20&&n.clientHeight>50);
      return els.map(n=>({cls:n.className&&n.className.toString().slice(0,60),sh:n.scrollHeight,ch:n.clientHeight,st:n.scrollTop}));
    }""")
    print("scrollables:",json.dumps(info))
    for i in range(26):
        pg.keyboard.press("ArrowDown"); pg.wait_for_timeout(70)
    pg.wait_for_timeout(600)
    after=pg.evaluate("""()=>{
      const els=[...document.querySelectorAll('*')].filter(n=>n.scrollHeight>n.clientHeight+20&&n.clientHeight>50);
      const f=document.activeElement;
      return {tops:els.map(n=>n.scrollTop), focus:(f&&(f.textContent||'').trim().slice(0,50))};
    }""")
    print("after 26 down:",json.dumps(after))
    still("_j_controls_scrolled.png")
    # footer legend with a gamepad "connected"? check for pad hint swap logic
    ft=pg.evaluate("""()=>{const f=document.querySelector('.cm-foot,.cm-footer,[class*=foot]');return f?f.textContent.trim().slice(0,200):null}""")
    print("footer:",ft)
    b.close()
