import json, sys, time
from playwright.sync_api import sync_playwright
for s in (sys.stdout, sys.stderr):
    try: s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass
URL="http://localhost:8788/games/crestbound/index.html"
ARGS=["--use-angle=d3d11","--ignore-gpu-blocklist","--enable-gpu-rasterization","--disable-features=CalculateNativeWinOcclusion"]
with sync_playwright() as pw:
    b=pw.chromium.launch(channel="chrome", headless=True, args=ARGS)
    pg=b.new_page(viewport={"width":1600,"height":900})
    pg.goto(URL, wait_until="load", timeout=150000)
    pg.wait_for_function("() => window.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.state==='title'", timeout=150000)
    def act(): return pg.evaluate("() => { const a=document.activeElement; return a?(a.textContent||'').trim().slice(0,40):null; }")
    print("title focus", act())
    # virtual standard-mapping pad through the real polling path
    pg.evaluate("() => CRESTBOUND.game.input.__test.padAxes(0,0,0,0)")
    pg.wait_for_timeout(400)
    print("pad connected:", pg.evaluate("() => CRESTBOUND.game.input.gamepad && CRESTBOUND.game.input.gamepad.connected"))
    before = act()
    # D-pad down = standard button 13
    for _ in range(2):
        pg.evaluate("() => CRESTBOUND.game.input.__test.pad(13, true)")
        pg.wait_for_timeout(220)
        pg.evaluate("() => CRESTBOUND.game.input.__test.pad(13, false)")
        pg.wait_for_timeout(260)
    after = act()
    print("pad nav: %r -> %r  MOVED=%s" % (before, after, before != after))
    # left stick down
    pg.evaluate("() => CRESTBOUND.game.input.__test.padAxes(0, 0.9, 0, 0)")
    pg.wait_for_timeout(400)
    pg.evaluate("() => CRESTBOUND.game.input.__test.padAxes(0, 0, 0, 0)")
    pg.wait_for_timeout(300)
    print("stick nav ->", act())
    # A button activates
    pg.evaluate("() => CRESTBOUND.game.input.__test.pad(0, true)")
    pg.wait_for_timeout(200)
    pg.evaluate("() => CRESTBOUND.game.input.__test.pad(0, false)")
    pg.wait_for_timeout(1200)
    print("after A: state=%s  ui=%r" % (pg.evaluate("()=>CRESTBOUND.game.state"),
          pg.evaluate("()=>(document.getElementById('ui').innerText||'').trim().slice(0,90)").replace("\n"," | ")))
    glyphs = pg.evaluate("""() => {
      const g=[...document.querySelectorAll('#ui .cb-glyph,#ui [class*=glyph],#ui [class*=pad]')]
        .filter(n=>n.offsetParent!==null).map(n=>(n.textContent||'').trim()).filter(Boolean);
      const legend=[...document.querySelectorAll('#ui [class*=legend],#ui [class*=hintbar],#ui [class*=foot]')]
        .filter(n=>n.offsetParent!==null).map(n=>(n.textContent||'').trim().slice(0,120));
      return {glyphs:g.slice(0,20), legend:legend.slice(0,4)}; }""")
    print("glyphs on this page:", json.dumps(glyphs)[:500])
    b.close()
