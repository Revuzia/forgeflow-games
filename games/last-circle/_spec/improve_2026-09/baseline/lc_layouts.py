"""Menu-only layout sweep across phone sizes + the look-zone tap mechanism check (kernel draw loop stopped => no long
tasks => does the CONTINUE ANYWAY tap now land?). One page, resized; DOM measurements only."""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lc_mobile import DEVICES, FLAGS, LOCK_JS, LAYOUT_JS, OVERLAY_JS, Touch, URL, center, SHOTS
HERE = os.path.dirname(os.path.abspath(__file__))
LOG = open(os.path.join(HERE, "layouts.log"), "w", encoding="utf-8")
def out(*a):
    s = " ".join(json.dumps(x, default=str) if not isinstance(x, str) else x for x in a); print(s); LOG.write(s + "\n"); LOG.flush()
spec = DEVICES["pixel7"]
EVLOG = r"""(() => { window.__EV__ = []; for (const t of ['touchstart','touchend','click']) document.addEventListener(t, (e) => { window.__EV__.push([t, Math.round(performance.now()), (e.target && (e.target.className || e.target.tagName) + '').slice(0, 20), e.isTrusted ? 'T' : 'S']); }, true); })();"""
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    br = pw.chromium.launch(channel="chrome", headless=True, args=FLAGS)
    ctx = br.new_context(viewport={"width": spec["w"], "height": spec["h"]}, device_scale_factor=2, is_mobile=True, has_touch=True, user_agent=spec["ua"])
    ctx.add_init_script(LOCK_JS); ctx.add_init_script(EVLOG)
    pg = ctx.new_page(); pg.set_default_timeout(600000)
    cdp = ctx.new_cdp_session(pg); T = Touch(cdp)
    ev = lambda js, arg=None: pg.evaluate(js, arg) if arg is not None else pg.evaluate(js)
    pg.goto(URL, wait_until="domcontentloaded")
    for _ in range(1200):
        if ev("() => Array.from(document.querySelectorAll('button')).some(b => /PLAY ANYWAY/.test(b.textContent))"): break
        time.sleep(0.5)
    ev("() => Array.from(document.querySelectorAll('button')).find(b => /PLAY ANYWAY/.test(b.textContent)).click()")
    for _ in range(1200):
        if ev("() => !!window.__LC__"): break
        time.sleep(0.5)
    time.sleep(1.5)
    # mechanism check: stop the draw loop (no long tasks) and tap CONTINUE ANYWAY for real
    ev("() => { const k = window.__LC__.W.kernel; k._running = false; if (k._raf) cancelAnimationFrame(k._raf); return true; }")
    time.sleep(1.0)
    r = ev("() => { const b = Array.from(document.querySelectorAll('button')).find(b => b.offsetParent && /CONTINUE ANYWAY/.test(b.textContent)); if (!b) return null; const r = b.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }")
    ev("() => window.__EV__ = []")
    if r:
        T.tap(*center(r)); time.sleep(1.5)
        gone = not ev("() => Array.from(document.querySelectorAll('button')).some(b => b.offsetParent && /CONTINUE ANYWAY/.test(b.textContent))")
        out("MECHANISM: draw loop stopped -> CONTINUE ANYWAY real tap dismisses:", gone, ev("() => window.__EV__"))
    try:
        pg.screenshot(path=os.path.join(SHOTS, "lc_menu_howto_pixel7.png"), timeout=60000); out("shot ok howto")
    except Exception as e:
        out("shot fail", str(e)[:100])
    sizes = [("se_land", 667, 375), ("iphone14_land", 852, 393), ("pixel7_land", 915, 412), ("pixel7_port", 412, 915), ("ipad_land", 1180, 820)]
    for name, w, h in sizes:
        pg.set_viewport_size({"width": w, "height": h}); time.sleep(1.2)
        g = ev("() => { const b = Array.from(document.querySelectorAll('button')).find(b => b.offsetParent && /GOT IT/.test(b.textContent)); if (!b) return null; const r = b.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; }")
        out(name, "HOW TO PLAY GOT IT rect", g, "onscreen", bool(g) and g[3] <= h and g[1] >= 0 and g[0] >= 0 and g[2] <= w)
        try: pg.screenshot(path=os.path.join(SHOTS, "lc_howto_%s.png" % name), timeout=30000)
        except Exception: out("shot fail", name)
    pg.set_viewport_size({"width": 915, "height": 412}); time.sleep(0.8)
    ev("() => { const b = Array.from(document.querySelectorAll('button')).find(b => b.offsetParent && /GOT IT/.test(b.textContent)); if (b) b.click(); }")
    time.sleep(0.8)
    for name, w, h in sizes:
        pg.set_viewport_size({"width": w, "height": h}); time.sleep(1.2)
        lay = ev(LAYOUT_JS)
        cards = ev("() => Array.from(document.querySelectorAll('.lc-mode-card')).map(c => { const r = c.getBoundingClientRect(); return [c.textContent.trim().slice(0, 14), Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; })")
        ov = ev(OVERLAY_JS)
        look = [c["r"] for c in ov["controls"] if "look" in c["cls"]]
        out(name, "MENU", {"nClipped": lay["nClipped"], "nSmallTargets": lay["nSmallTargets"], "nSmallFonts": lay["nSmallFonts"], "firstClipped": lay["clipped"][:3], "modeCards": cards, "lookZone": look, "overlayControls": [(c["label"] or c["cls"]) for c in ov["controls"]]})
        try: pg.screenshot(path=os.path.join(SHOTS, "lc_menu_%s.png" % name), timeout=30000)
        except Exception: out("shot fail", name)
    br.close()
out("DONE")
