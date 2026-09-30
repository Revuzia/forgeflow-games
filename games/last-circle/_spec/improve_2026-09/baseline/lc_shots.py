"""Screenshot pass. The shared box starves compositor frames while the game's rAF loops run, so before each shot every
rAF loop is frozen (SETUP: kernel loop stopped + requestAnimationFrame no-op'd), one frame is drawn by hand, the shot is
taken, then the loops are restored. Menus reached by DOM clicks (SETUP) — the tap path is measured in lc_input.py."""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lc_mobile import DEVICES, FLAGS, LOCK_JS, URL, SHOTS
HERE = os.path.dirname(os.path.abspath(__file__))
LOG = open(os.path.join(HERE, "shots.log"), "w", encoding="utf-8")
def out(*a):
    s = " ".join(str(x) for x in a); print(s); LOG.write(s + "\n"); LOG.flush()
spec = DEVICES["pixel7"]
FREEZE = """() => { const k = window.__LC__ && window.__LC__.W.kernel; if (k) { k._running = false; if (k._raf) cancelAnimationFrame(k._raf); }
  if (!window.__oRAF) { window.__oRAF = window.requestAnimationFrame; window.requestAnimationFrame = () => 0; }
  if (k) { try { if (k.composer) k.composer.render(1/30); else k.renderer.render(k.scene, k.camera); } catch (e) {} } return true; }"""
THAW = """() => { if (window.__oRAF) { window.requestAnimationFrame = window.__oRAF; window.__oRAF = null; } const k = window.__LC__ && window.__LC__.W.kernel; if (k && !k._running) k.start(); return true; }"""
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    br = pw.chromium.launch(channel="chrome", headless=True, args=[a for a in FLAGS if not a.startswith("--use-angle")] + ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    ctx = br.new_context(viewport={"width": spec["w"], "height": spec["h"]}, device_scale_factor=2, is_mobile=True, has_touch=True, user_agent=spec["ua"])
    ctx.add_init_script(LOCK_JS)
    pg = ctx.new_page(); pg.set_default_timeout(600000)
    ev = lambda js, arg=None: pg.evaluate(js, arg) if arg is not None else pg.evaluate(js)
    def shot(name):
        ev(FREEZE); time.sleep(1.0)
        try:
            pg.screenshot(path=os.path.join(SHOTS, name), timeout=90000); out("shot ok", name)
        except Exception as e:
            out("shot fail", name, str(e).splitlines()[0][:100])
        ev(THAW)
    pg.goto(URL, wait_until="domcontentloaded")
    for _ in range(1200):
        if ev("() => Array.from(document.querySelectorAll('button')).some(b => /PLAY ANYWAY/.test(b.textContent))"): break
        time.sleep(0.5)
    ev("() => Array.from(document.querySelectorAll('button')).find(b => /PLAY ANYWAY/.test(b.textContent)).click()")
    for _ in range(1200):
        if ev("() => !!window.__LC__"): break
        time.sleep(0.5)
    time.sleep(2.0)
    shot("S1_pixel7_menu_first_run_modals.png")
    ev("() => { for (const re of [/CONTINUE ANYWAY/]) { const b = Array.from(document.querySelectorAll('button')).find(b => b.offsetParent && re.test(b.textContent)); if (b) b.click(); } }")
    time.sleep(0.5)
    shot("S2_pixel7_howto_gotit_offscreen.png")
    ev("() => { const b = Array.from(document.querySelectorAll('button')).find(b => b.offsetParent && /GOT IT/.test(b.textContent)); if (b) b.click(); }")
    pg.set_viewport_size({"width": 667, "height": 375}); time.sleep(1.5)
    shot("S3_se_menu_cards_clipped.png")
    pg.set_viewport_size({"width": spec["w"], "height": spec["h"]}); time.sleep(1.5)
    shot("S4_pixel7_menu.png")
    ev("() => { const cs = Array.from(document.querySelectorAll('.lc-mode-card')); const c = cs.find(c => /QUICK/i.test(c.textContent)) || cs[0]; c.click(); }")
    for _ in range(2400):
        s = ev("() => ({phase: window.__LC__.W.phase, player: !!window.__LC__.W.player, lobby: /FILLING LOBBY|OPERATIVES READY|DROP IN NOW/.test(document.body.innerText)})")
        if s["phase"] in ("drop", "match") and s["player"] and not s["lobby"]: break
        time.sleep(0.5)
    out("match", ev("() => window.__LC__.state()"))
    time.sleep(2.0)
    shot("S5_pixel7_match_hud_touch.png")
    # stand next to a chest (SETUP teleport) for the HOLD E prompt
    ev("""() => { const W = window.__LC__.W, p = W.player; const l = W.nearbyLoot(p.pos, 400).filter(n => n.type === 'chest').sort((a, b) => a.d - b.d); if (!l.length) return null; const c = l[0]; p.pos.set(c.pos.x + 1.2, c.pos.y + 0.05, c.pos.z); return c.d; }""")
    ev("() => { const k = window.__LC__.W.kernel; for (let i = 0; i < 4; i++) for (const u of k._updaters) u(1/30, k.clock.elapsedTime); return true; }")
    shot("S6_pixel7_chest_hold_e_prompt.png")
    pg.set_viewport_size({"width": spec["h"], "height": spec["w"]}); time.sleep(1.5)
    ev("() => { const k = window.__LC__.W.kernel; for (let i = 0; i < 2; i++) for (const u of k._updaters) u(1/30, k.clock.elapsedTime); return true; }")
    out("portrait fov after 2 live ticks", ev("() => { const k = window.__LC__.W.kernel; return {fov: k.camera.fov, aspect: k.camera.aspect, paused: !!window.__LC__.W.paused, fit: k._camFit ? {active: k._camFit.active, applied: k._camFit.appliedFov} : null}; }"))
    shot("S7_pixel7_portrait_match.png")
    br.close()
out("DONE")
