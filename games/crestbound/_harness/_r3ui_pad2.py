"""Menus under a REAL gamepad: stub navigator.getGamepads (the API padNav polls)."""
import json, sys, time
from playwright.sync_api import sync_playwright
for s in (sys.stdout, sys.stderr):
    try: s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass
URL="http://localhost:8788/games/crestbound/index.html"
ARGS=["--use-angle=d3d11","--ignore-gpu-blocklist","--enable-gpu-rasterization","--disable-features=CalculateNativeWinOcclusion"]
STUB = """() => {
  const pad = { id:'Xbox Wireless Controller (STANDARD GAMEPAD)', index:0, connected:true,
    mapping:'standard', timestamp:0, axes:[0,0,0,0],
    buttons: Array.from({length:17}, () => ({pressed:false, touched:false, value:0})) };
  window.__pad = pad;
  navigator.getGamepads = () => [pad, null, null, null];
  window.__padSet = (i, down) => { const b = pad.buttons[i];
    b.pressed = !!down; b.value = down ? 1 : 0; pad.timestamp = performance.now(); };
  window.__padAx = (i, v) => { pad.axes[i] = v; pad.timestamp = performance.now(); };
  window.dispatchEvent(new Event('gamepadconnected'));
  return true;
}"""
with sync_playwright() as pw:
    b=pw.chromium.launch(channel="chrome", headless=True, args=ARGS)
    pg=b.new_page(viewport={"width":1600,"height":900})
    pg.add_init_script("(" + STUB + ")()")
    pg.goto(URL, wait_until="load", timeout=150000)
    pg.wait_for_function("() => window.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.state==='title'", timeout=150000)
    def act(): return pg.evaluate("() => { const a=document.activeElement; return a?(a.textContent||'').trim().slice(0,44):null; }")
    print("pads visible:", pg.evaluate("() => (navigator.getGamepads()||[]).filter(Boolean).map(p=>p.id)"))
    print("title focus:", act())
    seq=[]
    for _ in range(2):
        pg.evaluate("() => window.__padSet(13, true)"); pg.wait_for_timeout(180)
        pg.evaluate("() => window.__padSet(13, false)"); pg.wait_for_timeout(220)
        seq.append(act())
    print("D-pad DOWN x2 ->", seq)
    pg.evaluate("() => window.__padAx(1, 0.9)"); pg.wait_for_timeout(300)
    pg.evaluate("() => window.__padAx(1, 0)"); pg.wait_for_timeout(250)
    print("LS down ->", act())
    pg.evaluate("() => window.__padSet(0, true)"); pg.wait_for_timeout(160)
    pg.evaluate("() => window.__padSet(0, false)"); pg.wait_for_timeout(1400)
    print("A -> state=%s ui=%r" % (pg.evaluate("()=>CRESTBOUND.game.state"),
        pg.evaluate("()=>(document.getElementById('ui').innerText||'').trim().slice(0,110)")))
    leg = pg.evaluate("""() => [...document.querySelectorAll('#ui *')]
        .filter(n=>n.offsetParent!==null && /legend|hint|foot/i.test(String(n.className||'')))
        .map(n=>(n.textContent||'').trim().slice(0,140)).slice(0,4)""")
    print("legend now:", json.dumps(leg))
    pg.evaluate("() => window.__padSet(1, true)"); pg.wait_for_timeout(160)
    pg.evaluate("() => window.__padSet(1, false)"); pg.wait_for_timeout(900)
    print("B (back) -> ui=%r" % pg.evaluate("()=>(document.getElementById('ui').innerText||'').trim().slice(0,70)"))
    b.close()
