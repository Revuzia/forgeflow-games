import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lc_mobile import DEVICES, FLAGS, LOCK_JS, Touch, URL, center, SHOTS

spec = DEVICES["pixel7"]
LOG_JS = r"""(() => { window.__EV__ = []; for (const t of ['touchstart','touchend','pointerdown','pointerup','mousedown','mouseup','click']) document.addEventListener(t, (e) => { window.__EV__.push(t + ':' + (e.target && (e.target.id || e.target.className || e.target.tagName)) + ':' + (e.isTrusted ? 'T' : 'S') + ':' + (e.defaultPrevented ? 'dp' : '')); }, true); })();"""
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    br = pw.chromium.launch(channel="chrome", headless=True, args=FLAGS)
    ctx = br.new_context(viewport={"width": spec["w"], "height": spec["h"]}, device_scale_factor=spec["dpr"], is_mobile=True, has_touch=True, user_agent=spec["ua"])
    ctx.add_init_script(LOCK_JS); ctx.add_init_script(LOG_JS)
    pg = ctx.new_page()
    cdp = ctx.new_cdp_session(pg); T = Touch(cdp)
    pg.goto(URL, wait_until="domcontentloaded")
    for _ in range(120):
        if pg.evaluate("() => Array.from(document.querySelectorAll('button')).some(b => /PLAY ANYWAY/.test(b.textContent))"): break
        time.sleep(0.5)
    r = pg.evaluate("() => { const b = Array.from(document.querySelectorAll('button')).find(b => /PLAY ANYWAY/.test(b.textContent)); const r = b.getBoundingClientRect(); b.addEventListener('click', () => window.__CLICKED__ = (window.__CLICKED__||0)+1); return [r.left, r.top, r.right, r.bottom]; }")
    print("button rect", r)
    under = pg.evaluate("([x,y]) => { const e = document.elementFromPoint(x,y); return e && (e.id || e.className || e.tagName); }", list(center(r)))
    print("elementFromPoint at centre:", under)
    pg.evaluate("() => window.__EV__ = []")
    T.tap(*center(r), hold=0.08)
    time.sleep(0.5)
    print("events:", pg.evaluate("() => window.__EV__"))
    print("clicked:", pg.evaluate("() => window.__CLICKED__ || 0"))
    print("card still up:", pg.evaluate("() => Array.from(document.querySelectorAll('button')).some(b => /PLAY ANYWAY/.test(b.textContent))"))
    # also: tap in the LEFT 40% (not look zone) on a hypothetical point for comparison
    pg.screenshot(path=os.path.join(SHOTS, "lc_pixel7_debug_tap.png"))
    br.close()
