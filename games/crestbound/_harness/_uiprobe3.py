import base64, json, os, sys
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
    ctx=b.new_context(viewport={"width":1600,"height":900}); pg=ctx.new_page()
    cdp=ctx.new_cdp_session(pg)
    def still(n):
        d=cdp.send("Page.captureScreenshot",{"format":"png"})
        open(os.path.join(OUT,n),"wb").write(base64.b64decode(d["data"])); print("  shot",n)
    pg.goto(URL); pg.wait_for_function("()=>window.CRESTBOUND&&CRESTBOUND.game&&CRESTBOUND.game.state==='title'",timeout=120000)
    pg.wait_for_timeout(1200)
    pg.evaluate("()=>CRESTBOUND.game.menu.open('controls')"); pg.wait_for_timeout(1200)
    n=pg.evaluate("""()=>{const p=document.querySelector('.cm-page.is-open')||document;
      const rows=[...p.querySelectorAll('[tabindex],.cm-row,.cb-row,button')].filter(e=>e.offsetParent!==null);
      return {n:rows.length, first:rows.slice(0,3).map(e=>(e.textContent||'').trim().slice(0,30))}}""")
    print("focusables:",json.dumps(n))
    trace=[]
    for i in range(40):
        pg.keyboard.press("ArrowDown"); pg.wait_for_timeout(200)
        if i%5==4:
            s=pg.evaluate("""()=>{const bdy=document.querySelector('.cm-body');const f=document.activeElement;
              return [bdy?bdy.scrollTop:-1,(f&&(f.textContent||'').trim().slice(0,28))||'']}""")
            trace.append([i+1]+s)
    print("trace:",json.dumps(trace))
    still("_j_controls_bottom_real.png")
    b.close()
