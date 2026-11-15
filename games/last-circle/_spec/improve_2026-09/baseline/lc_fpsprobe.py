import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lc_mobile import DEVICES, FLAGS, LOCK_JS, Touch, URL, center, SHOTS
dev = sys.argv[1] if len(sys.argv) > 1 else "pixel7"
low = "--low" in sys.argv
spec = DEVICES[dev]
LT = r"""(() => { window.__LT__ = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__LT__.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch (e) {} })();"""
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    br = pw.chromium.launch(channel="chrome", headless=True, args=FLAGS)
    ctx = br.new_context(viewport={"width": spec["w"], "height": spec["h"]}, device_scale_factor=spec["dpr"], is_mobile=True, has_touch=True, user_agent=spec["ua"])
    ctx.add_init_script(LOCK_JS); ctx.add_init_script(LT)
    if low: ctx.add_init_script("try { localStorage.setItem('lc_settings', JSON.stringify({graphics:'low'})); } catch (e) {}")
    pg = ctx.new_page(); pg.set_default_timeout(120000)
    cdp = ctx.new_cdp_session(pg); T = Touch(cdp)
    t0 = time.time()
    pg.goto(URL, wait_until="domcontentloaded")
    for _ in range(900):
        if pg.evaluate("() => !!window.__LC__ || Array.from(document.querySelectorAll('button')).some(b => /PLAY ANYWAY/.test(b.textContent))"): break
        time.sleep(0.5)
    print("card at", round(time.time() - t0, 1))
    # direct DOM click for setup (the tap path is measured elsewhere)
    pg.evaluate("() => { const b = Array.from(document.querySelectorAll('button')).find(b => /PLAY ANYWAY/.test(b.textContent)); if (b) b.click(); }")
    for _ in range(400):
        if pg.evaluate("() => !!window.__LC__"): break
        time.sleep(0.5)
    print("menu at", round(time.time() - t0, 1))
    for i in range(3):
        t1 = time.time()
        r = pg.evaluate("""async () => { let n = 0; const t0 = performance.now(); await new Promise((res) => { const f = () => { n++; if (performance.now() - t0 < 4000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); }); const k = window.__LC__ && window.__LC__.W.kernel; return { fps: n / ((performance.now() - t0) / 1000), dpr: k ? k.renderer.getPixelRatio() : null, calls: k ? k.renderer.info.render.calls : null, lt: window.__LT__.slice(-8) }; }""")
        print("fps sample", i, round(time.time() - t1, 1), json.dumps(r))
    t1 = time.time()
    try:
        pg.screenshot(path=os.path.join(SHOTS, "lc_%s_fpsprobe%s.png" % (dev, "_low" if low else "")), timeout=60000); print("shot ok", round(time.time() - t1, 1))
    except Exception as e:
        print("shot fail", str(e).splitlines()[0][:200])
    br.close()
