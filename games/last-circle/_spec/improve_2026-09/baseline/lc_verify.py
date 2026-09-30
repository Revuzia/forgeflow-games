"""Follow-up checks on SwiftShader (the iGPU is saturated by other lanes): (a) look-zone tap replay on CONTINUE ANYWAY and
RESUME when the GPU is not the bottleneck; (b) does the portrait camera fit survive live frames in a match?"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lc_mobile import DEVICES, FLAGS, LOCK_JS, Touch, URL, center, SHOTS
HERE = os.path.dirname(os.path.abspath(__file__))
LOG = open(os.path.join(HERE, "verify.log"), "w", encoding="utf-8")
def out(*a):
    s = " ".join(json.dumps(x, default=str) if not isinstance(x, str) else x for x in a); print(s); LOG.write(s + "\n"); LOG.flush()
spec = DEVICES["pixel7"]
EVLOG = r"""(() => { window.__EV__ = []; for (const t of ['touchstart','touchend','click']) document.addEventListener(t, (e) => { window.__EV__.push([t, Math.round(performance.now()), (e.target && (e.target.className || e.target.tagName) + '').slice(0, 18), e.isTrusted ? 'T' : 'S']); }, true); })();"""
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    br = pw.chromium.launch(channel="chrome", headless=True, args=[a for a in FLAGS if not a.startswith("--use-angle")] + ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    ctx = br.new_context(viewport={"width": spec["w"], "height": spec["h"]}, device_scale_factor=2, is_mobile=True, has_touch=True, user_agent=spec["ua"])
    ctx.add_init_script(LOCK_JS); ctx.add_init_script(EVLOG)
    pg = ctx.new_page(); pg.set_default_timeout(600000)
    cdp = ctx.new_cdp_session(pg); T = Touch(cdp)
    ev = lambda js, arg=None: pg.evaluate(js, arg) if arg is not None else pg.evaluate(js)
    btn = lambda re: ev("(s) => { const re = new RegExp(s); const b = Array.from(document.querySelectorAll('button')).find(b => b.offsetParent && re.test(b.textContent)); if (!b) return null; const r = b.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }", re)
    pg.goto(URL, wait_until="domcontentloaded")
    for _ in range(1200):
        if btn("PLAY ANYWAY"): break
        time.sleep(0.5)
    T.tap(*center(btn("PLAY ANYWAY"))); time.sleep(2)
    if btn("PLAY ANYWAY"):
        out("PLAY ANYWAY tap did not take; DOM click (SETUP)"); ev("() => Array.from(document.querySelectorAll('button')).find(b => /PLAY ANYWAY/.test(b.textContent)).click()")
    for _ in range(1200):
        if ev("() => !!window.__LC__"): break
        time.sleep(0.5)
    time.sleep(3)
    fps = ev("async () => { let n = 0; const t0 = performance.now(); await new Promise((res) => { const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); }); return n / 3; }")
    out("menu fps on SwiftShader (info)", fps)
    for attempt in range(3):
        r = btn("CONTINUE ANYWAY")
        if not r: break
        ev("() => window.__EV__ = []")
        T.tap(*center(r)); time.sleep(2)
        out("CONTINUE ANYWAY tap attempt", attempt + 1, "dismissed:", not btn("CONTINUE ANYWAY"), ev("() => window.__EV__"))
    if btn("CONTINUE ANYWAY"):
        ev("() => Array.from(document.querySelectorAll('button')).find(b => b.offsetParent && /CONTINUE ANYWAY/.test(b.textContent)).click()")
    ev("() => { const b = Array.from(document.querySelectorAll('button')).find(b => b.offsetParent && /GOT IT/.test(b.textContent)); if (b) b.click(); }")
    ev("() => { const cs = Array.from(document.querySelectorAll('.lc-mode-card')); const c = cs.find(c => /QUICK/i.test(c.textContent)) || cs[0]; c.click(); }")
    for _ in range(2400):
        s = ev("() => ({phase: window.__LC__.W.phase, player: !!window.__LC__.W.player, lobby: /FILLING LOBBY|OPERATIVES READY|DROP IN NOW/.test(document.body.innerText)})")
        if s["phase"] in ("drop", "match") and s["player"] and not s["lobby"]: break
        time.sleep(0.5)
    time.sleep(2)
    CAM = "() => { const W = window.__LC__.W, k = W.kernel; return {same: W.camera === k.camera, fov: +k.camera.fov.toFixed(2), fovBase: W._fovBase, aspect: +k.camera.aspect.toFixed(3), phase: W.phase, paused: !!W.paused, fit: k._camFit ? {active: k._camFit.active, authored: k._camFit.authoredFov, applied: +k._camFit.appliedFov.toFixed(2)} : null, t: +W.t.toFixed(2)}; }"
    out("landscape cam", ev(CAM))
    pg.set_viewport_size({"width": spec["h"], "height": spec["w"]}); time.sleep(1.5)
    out("portrait cam after resize + 1.5 s of live frames", ev(CAM))
    out("portrait cam, same evaluate: one full updater pass then read", ev("() => { const W = window.__LC__.W, k = W.kernel; for (const u of k._updaters) u(1/30, k.clock.elapsedTime); return {fov: k.camera.fov, fovBase: W._fovBase, t: W.t}; }"))
    pg.set_viewport_size({"width": spec["w"], "height": spec["h"]}); time.sleep(1.5)
    # RESUME tap via the control-bar pause
    pb = ev("() => { const bar = document.getElementById('__ff_controls__'); if (!bar) return null; const b = Array.from(bar.querySelectorAll('button')).find(b => /Pause/.test(b.title || b.getAttribute('aria-label') || '')); if (!b) return null; const r = b.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }")
    if pb:
        T.tap(*center(pb)); time.sleep(1.5)
        out("paused after bar tap", ev("() => !!window.__LC__.W.paused"))
        r = btn("RESUME")
        if r:
            ev("() => window.__EV__ = []")
            T.tap(*center(r)); time.sleep(2)
            out("RESUME tap (inside look zone) resumed:", not ev("() => !!window.__LC__.W.paused"), r, ev("() => window.__EV__"))
    br.close()
out("DONE")
