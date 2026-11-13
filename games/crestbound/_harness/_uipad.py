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
STUB="""
window.__pad = {axes:[0,0,0,0], buttons:Array.from({length:17},()=>({pressed:false,value:0})),
  connected:true, id:'Virtual Pad (STANDARD GAMEPAD)', index:0, mapping:'standard', timestamp:0};
navigator.getGamepads = () => [window.__pad];
window.__padSet = (i,v)=>{ window.__pad.buttons[i]={pressed:!!v,value:v?1:0}; window.__pad.timestamp=performance.now(); };
window.__padAx = (x,y)=>{ window.__pad.axes[0]=x; window.__pad.axes[1]=y; window.__pad.timestamp=performance.now(); };
"""
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome",headless=True,args=FLAGS)
    ctx=b.new_context(viewport={"width":1600,"height":900}); pg=ctx.new_page()
    pg.add_init_script(STUB)
    cdp=ctx.new_cdp_session(pg)
    def still(n):
        d=cdp.send("Page.captureScreenshot",{"format":"png"})
        open(os.path.join(OUT,n),"wb").write(base64.b64decode(d["data"])); print("  shot",n)
    pg.goto(URL); pg.wait_for_function("()=>window.CRESTBOUND&&CRESTBOUND.game&&CRESTBOUND.game.state==='title'",timeout=120000)
    pg.wait_for_timeout(1500)
    def focus():
        return pg.evaluate("()=>{const f=document.activeElement;return (f&&(f.textContent||'').trim().slice(0,26))||''}")
    print("focus before:",focus())
    seq=[]
    for k in range(3):
        pg.evaluate("()=>window.__padAx(0,1)"); pg.wait_for_timeout(180)
        pg.evaluate("()=>window.__padAx(0,0)"); pg.wait_for_timeout(180)
        seq.append(focus())
    print("after 3 pad-down:",seq)
    # D-pad down (button 13)
    pg.evaluate("()=>window.__padSet(13,1)"); pg.wait_for_timeout(180)
    pg.evaluate("()=>window.__padSet(13,0)"); pg.wait_for_timeout(200)
    print("after dpad down:",focus())
    still("_j_title_pad.png")
    # does the footer / hints swap to pad glyphs?
    txt=pg.evaluate("""()=>{const f=document.querySelector('.cm-foot');return f?f.textContent.trim():'(no .cm-foot on title)'}""")
    print("title foot:",txt)
    pg.evaluate("()=>CRESTBOUND.game.menu.open('settings')"); pg.wait_for_timeout(900)
    print("settings foot with pad connected:",pg.evaluate("""()=>{const f=document.querySelector('.cm-page.is-open .cm-foot')||document.querySelector('.cm-foot');return f?f.textContent.trim():null}"""))
    # confirm with A
    pg.evaluate("()=>window.__padSet(1,1)"); pg.wait_for_timeout(150); pg.evaluate("()=>window.__padSet(1,0)"); pg.wait_for_timeout(700)
    print("after B(back):",pg.evaluate("()=>CRESTBOUND.game.menu.page||CRESTBOUND.game.state"))
    b.close()
