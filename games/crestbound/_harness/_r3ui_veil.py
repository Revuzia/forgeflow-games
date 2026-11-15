import base64, io, json, sys, time
from playwright.sync_api import sync_playwright
from PIL import Image
import numpy as np
for s in (sys.stdout, sys.stderr):
    try: s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass
URL="http://localhost:8788/games/crestbound/index.html?dev=1"
ARGS=["--use-angle=d3d11","--ignore-gpu-blocklist","--enable-gpu-rasterization","--disable-features=CalculateNativeWinOcclusion"]
OUT="../_shots/ui/"
with sync_playwright() as pw:
    b=pw.chromium.launch(channel="chrome", headless=True, args=ARGS)
    pg=b.new_page(viewport={"width":1600,"height":900})
    cdp=pg.context.new_cdp_session(pg)
    pg.goto(URL, wait_until="load", timeout=60000)
    pg.wait_for_function("() => window.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.state", timeout=60000)
    pg.evaluate("""async () => { const g=CRESTBOUND.game; if (g.state==='title'){ if(g.menu) g.menu.close(); await g.startNewGame?.(); } }""")
    t0=time.time()
    while time.time()-t0<40 and pg.evaluate("()=>CRESTBOUND.game.state")!="keep":
        pg.keyboard.press("Enter"); pg.wait_for_timeout(400)
    pg.evaluate("() => CRESTBOUND.game.__dev.goto('verdant-1')")
    t0=time.time()
    while time.time()-t0<90 and pg.evaluate("()=>CRESTBOUND.game.state")!="playing":
        pg.keyboard.press("Space"); pg.wait_for_timeout(500)
    print("state", pg.evaluate("()=>CRESTBOUND.game.state"))
    def shot(name):
        d=cdp.send("Page.captureScreenshot", {"format":"png"})
        im=Image.open(io.BytesIO(base64.b64decode(d["data"])))
        im.save(OUT+name)
        a=np.asarray(im.convert("L"),dtype=float)
        h,w=a.shape; k=60
        return {"mean":round(a.mean(),1),
                "corners":[round(a[:k,:k].mean(),1),round(a[:k,-k:].mean(),1),round(a[-k:,:k].mean(),1),round(a[-k:,-k:].mean(),1)],
                "centre":round(a[h//2-60:h//2+60, w//2-100:w//2+100].mean(),1)}
    info = pg.evaluate("""() => { const v=document.getElementById('cb-veil');
      const cs=getComputedStyle(v); const r=v.getBoundingClientRect();
      return {parent:v.parentNode.id, z:cs.zIndex, pos:cs.position, disp:cs.display, op:cs.opacity,
              rect:[r.x,r.y,r.width,r.height], bg:cs.backgroundColor, mask:cs.webkitMaskImage||cs.maskImage,
              parentZ:getComputedStyle(v.parentNode).zIndex, parentPE:getComputedStyle(v.parentNode).pointerEvents}; }""")
    print("veil DOM:", json.dumps(info)[:600])
    base = shot("_z_veil_off.png"); print("veil off  ", base)
    for v in (0.25, 0.5, 1.0):
        pg.evaluate("(v) => CRESTBOUND.game._setVeil(v,'iris')", v)
        pg.wait_for_timeout(300)
        st = pg.evaluate("""() => { const v=document.getElementById('cb-veil');
          return {ir:v.style.getPropertyValue('--cb-ir'), op:getComputedStyle(v).opacity, disp:getComputedStyle(v).display}; }""")
        print("v=%.2f style=%s ->"%(v,json.dumps(st)), shot("_z_veil_%03d.png"%int(v*100)))
    pg.evaluate("() => CRESTBOUND.game._setVeil(0,'iris')")
    b.close()
