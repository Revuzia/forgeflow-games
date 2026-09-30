#!/usr/bin/env python
"""Last Circle phone-input probe that does NOT depend on the render loop producing frames (the shared box starves
rAF: measured 0.006-0.1 fps with 30-127 s long tasks). Real CDP touches drive the page; a 'tick' = one call of every
kernel updater (the exact per-frame input rebuild + sim + view update the rAF loop runs, minus the draw). Setup steps
that bypass the UI are labelled SETUP. Usage: python lc_input.py <device>"""
import json, math, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lc_mobile import DEVICES, FLAGS, IOS_INIT, LOCK_JS, LAYOUT_JS, OVERLAY_JS, OVERLAP_JS, Touch, URL, center, SHOTS

dev = sys.argv[1] if len(sys.argv) > 1 else "pixel7"
spec = DEVICES[dev]
HERE = os.path.dirname(os.path.abspath(__file__))
rep = {"device": dev, "spec": {k: v for k, v in spec.items() if k != "ua"}, "checks": [], "notes": []}
LOG = open(os.path.join(HERE, "input_%s.log" % dev), "w", encoding="utf-8")


def check(name, ok, detail=""):
    rep["checks"].append({"name": name, "ok": ok, "detail": detail})
    line = ("PASS " if ok else ("FAIL " if ok is False else "INFO ")) + name + " :: " + json.dumps(detail, default=str)[:700]
    print(line); LOG.write(line + "\n"); LOG.flush()


from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    br = pw.chromium.launch(channel="chrome", headless=True, args=FLAGS)
    ctx = br.new_context(viewport={"width": spec["w"], "height": spec["h"]}, device_scale_factor=spec["dpr"], is_mobile=True, has_touch=True, user_agent=spec["ua"])
    if spec.get("ios"): ctx.add_init_script(IOS_INIT)
    ctx.add_init_script(LOCK_JS)
    pg = ctx.new_page(); pg.set_default_timeout(300000)
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e).splitlines()[0][:200]))
    pg.on("console", lambda m: errs.append("console:" + m.text[:200]) if m.type == "error" else None)
    cdp = ctx.new_cdp_session(pg); T = Touch(cdp)
    ev = lambda js, arg=None: pg.evaluate(js, arg) if arg is not None else pg.evaluate(js)

    def shot(n):
        try:
            if ev("() => !!(window.__LC__ && window.__LC__.W.kernel && !window.__LC__.W.kernel._running)"):
                ev("() => { const k = window.__LC__.W.kernel; if (k.composer) k.composer.render(1/30); else k.renderer.render(k.scene, k.camera); return true; }")
        except Exception:
            pass
        try:
            pg.screenshot(path=os.path.join(SHOTS, "lc_%s_%s.png" % (dev, n)), timeout=45000); return True
        except Exception as e:
            rep["notes"].append("screenshot %s timed out (rAF starved on shared box)" % n); return False

    def tick(n, dt=1/30):
        return ev("""([n, dt]) => { const k = window.__LC__.W.kernel; for (let i = 0; i < n; i++) { for (const u of k._updaters) u(dt, k.clock.elapsedTime); } return true; }""", [n, dt])

    RD = """() => { const W = window.__LC__.W, p = W.player; if (!p) return null; return {x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.input.yaw, pitch: p.input.pitch, mx: p.input.mx, mz: p.input.mz, fire: !!p.input.fire, lmb: !!W._lmbDown,
        mag: p.weapon ? p.weapon.magAmmo : null, wstate: p.weapon ? p.weapon.state : null, wid: p.weapon ? p.weapon.id : null, onGround: p.onGround, gliding: p.gliding, alive: p.alive, hp: p.hp,
        lock: document.pointerLockElement ? document.pointerLockElement.tagName : null, lockReq: window.__H_LOCKREQ__, held: window.FFG_TOUCH ? FFG_TOUCH.heldKeys() : [], heldMouse: window.FFG_TOUCH ? FFG_TOUCH.heldMouse() : [],
        slots: p.inventory.slots.map(s => s ? (s.id + (s.count != null ? 'x' + s.count : '')) : null), active: p.inventory.active, phase: W.phase, paused: !!W.paused, hint: W.interactHint ? W.interactHint.type : null }; }"""
    rd = lambda: ev(RD)

    t0 = time.time()
    pg.goto(URL, wait_until="domcontentloaded")
    for _ in range(1200):
        if ev("() => !!window.__LC__ || Array.from(document.querySelectorAll('button')).some(b => /PLAY ANYWAY/.test(b.textContent))"): break
        time.sleep(0.5)
    check("boot card reached", True, {"s": round(time.time() - t0, 1)})
    check("page meta + media", None, ev("() => ({coarse: matchMedia('(pointer: coarse)').matches, fine: matchMedia('(pointer: fine)').matches, vp: (document.querySelector('meta[name=viewport]')||{}).content, manifest: !!document.querySelector('link[rel=manifest]'), apple: !!document.querySelector('meta[name=apple-mobile-web-app-capable]'), bodyH: getComputedStyle(document.body).height})"))
    r = ev("() => { const b = Array.from(document.querySelectorAll('button')).find(b => /PLAY ANYWAY/.test(b.textContent)); if (!b) return null; const r = b.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }")
    if r:
        T.tap(*center(r))
        time.sleep(4)
        still = ev("() => Array.from(document.querySelectorAll('button')).some(b => /PLAY ANYWAY/.test(b.textContent))")
        check("PLAY ANYWAY: one real tap dismisses the card", not still, {"rect": r})
        if still:
            ev("() => { const b = Array.from(document.querySelectorAll('button')).find(b => /PLAY ANYWAY/.test(b.textContent)); if (b) b.click(); }")
            rep["notes"].append("SETUP: PLAY ANYWAY DOM-clicked after the tap did not take")
    t1 = time.time()
    for _ in range(1200):
        if ev("() => !!window.__LC__"): break
        time.sleep(0.5)
    check("menu reached", ev("() => !!window.__LC__"), {"s_after_play": round(time.time() - t1, 1)})
    time.sleep(1.0)
    shot("A_menu_first_run")
    fr = ev("""() => { const vis = (b) => b.offsetParent; const f = (re) => { const b = Array.from(document.querySelectorAll('button')).find(b => vis(b) && re.test(b.textContent)); if (!b) return null; const r = b.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; }; return { continueAnyway: f(/CONTINUE ANYWAY/), gotIt: f(/GOT IT/), H: innerHeight, W: innerWidth }; }""")
    check("first-run modals: CONTINUE ANYWAY + HOW TO PLAY 'GOT IT' rects", None, fr)
    if fr["gotIt"]:
        check("HOW TO PLAY 'GOT IT' reachable on screen", fr["gotIt"][3] <= fr["H"] and fr["gotIt"][1] >= 0, fr["gotIt"])
    if fr["continueAnyway"]:
        T.tap(*center(fr["continueAnyway"])); time.sleep(2.5)
        gone = not ev("() => Array.from(document.querySelectorAll('button')).some(b => b.offsetParent && /CONTINUE ANYWAY/.test(b.textContent))")
        check("CONTINUE ANYWAY: one real tap dismisses the KBM modal", gone, fr["continueAnyway"])
        if not gone:
            ev("() => { const b = Array.from(document.querySelectorAll('button')).find(b => b.offsetParent && /CONTINUE ANYWAY/.test(b.textContent)); if (b) b.click(); }")
            rep["notes"].append("SETUP: CONTINUE ANYWAY DOM-clicked")
    shot("B_menu_howto")
    # SETUP: close How To Play by DOM click (its button is off-screen on phone landscape — measured above)
    ev("() => { const b = Array.from(document.querySelectorAll('button')).find(b => b.offsetParent && /GOT IT/.test(b.textContent)); if (b) b.click(); }")
    time.sleep(0.5)
    lay = ev(LAYOUT_JS)
    check("menu layout on phone (clipped / small targets / small fonts)", lay["nClipped"] == 0, {k: lay[k] for k in ("nClipped", "nSmallTargets", "nSmallFonts", "clipped", "smallTargets", "smallFonts")})
    shot("C_menu")
    # tap the QUICK card with a real touch
    mc = ev("""() => { const cs = Array.from(document.querySelectorAll('.lc-mode-card')); const c = cs.find(c => /QUICK/i.test(c.textContent)) || cs[0]; if (!c) return null; const r = c.getBoundingClientRect(); return {t: c.textContent.trim().slice(0, 30), r: [r.left, r.top, r.right, r.bottom]}; }""")
    check("QUICK MATCH card rect", mc is not None, mc)
    cx, cy = center(mc["r"])
    T.tap(cx, cy); time.sleep(3)
    ph = ev("() => ({phase: window.__LC__.W.phase, lobby: /FILLING LOBBY|OPERATIVES READY|DROP IN NOW|WAITING/.test(document.body.innerText), loading: /LOADING/i.test(document.body.innerText)})")
    check("real tap on QUICK MATCH card starts the match flow", ph["phase"] != "menu" or ph["lobby"] or ph["loading"], ph)
    if ph["phase"] == "menu" and not ph["lobby"] and not ph["loading"]:
        ev("() => { const cs = Array.from(document.querySelectorAll('.lc-mode-card')); const c = cs.find(c => /QUICK/i.test(c.textContent)) || cs[0]; c.click(); }")
        rep["notes"].append("SETUP: QUICK card DOM-clicked")
    for _ in range(1200):
        s = ev("() => ({phase: window.__LC__.W.phase, lobby: /FILLING LOBBY|OPERATIVES READY|DROP IN NOW/.test(document.body.innerText), player: !!window.__LC__.W.player})")
        if s["lobby"] or s["phase"] in ("drop", "match"): break
        time.sleep(0.5)
    shot("D_lobby")
    lay2 = ev(LAYOUT_JS)
    check("lobby layout on phone", lay2["nClipped"] == 0, {"nClipped": lay2["nClipped"], "clipped": lay2["clipped"][:8], "smallFonts": lay2["nSmallFonts"]})
    for _ in range(1200):
        s = ev("() => ({phase: window.__LC__.W.phase, player: !!window.__LC__.W.player, lobby: /FILLING LOBBY|OPERATIVES READY|DROP IN NOW/.test(document.body.innerText)})")
        if s["phase"] in ("drop", "match") and s["player"] and not s["lobby"]: break
        time.sleep(0.5)
    check("in drop/match", None, rd())
    # SETUP: stop the kernel's rAF draw loop — on this shared box the draw starves the main thread (30-127 s long tasks
    # measured); input + sim are then advanced by tick() (every kernel updater = the per-frame pipeline minus the draw).
    ev("() => { const k = window.__LC__.W.kernel; k._running = false; if (k._raf) cancelAnimationFrame(k._raf); return true; }")
    rep["notes"].append("SETUP: kernel draw loop stopped after entering the match; tick() drives frames; draw() renders one frame before a screenshot")
    ov = ev(OVERLAY_JS)
    ctl = {((c["label"] or "").strip() or ("stick" if "stick" in c["cls"] else "look")): c["r"] for c in ov["controls"]}
    check("touch controls in match", None, {k: v for k, v in ctl.items()})
    # DROP steering with the stick (the parachute glide) — real touches + ticks
    s0 = rd()
    if s0 and (s0["gliding"] or not s0["onGround"]) and "stick" in ctl:
        sx, sy = center(ctl["stick"]); R = (ctl["stick"][2] - ctl["stick"][0]) / 2
        T.down(1, sx, sy); T.move(1, sx, sy - R * 0.85); tick(30); s1 = rd(); T.up(1); tick(2)
        check("drop: stick steers the glide (horizontal m in 1 s)", math.hypot(s1["x"] - s0["x"], s1["z"] - s0["z"]) > 3, {"dh": round(math.hypot(s1["x"] - s0["x"], s1["z"] - s0["z"]), 2), "held": s1["held"], "gliding": s1["gliding"]})
    # SETUP land
    for _ in range(20):
        g = rd()
        if g["onGround"] and not g["gliding"]: break
        ev("() => window.__LC__.fastForward(3, 1/30)")
    tick(5)
    g = rd(); rep["notes"].append("SETUP landed via fastForward: y=%.2f onGround=%s" % (g["y"], g["onGround"]))
    shot("E_hud")
    lay3 = ev(LAYOUT_JS)
    check("in-match HUD layout", lay3["nClipped"] == 0, {k: lay3[k] for k in ("nClipped", "clipped", "nSmallFonts", "smallFonts")})
    olap = ev(OVERLAP_JS)
    check("HUD drawn under the touch controls / control bar", len(olap) == 0, olap)
    hudtxt = ev("() => { const out = []; for (const e of document.querySelectorAll('div')) { if (!e.offsetParent || e.children.length) continue; const t = (e.textContent || '').trim(); if (/CLICK TO LOOK|\\[[A-Z0-9 ]+\\]|HOLD E|PRESS [A-Z]|SHIFT|WASD|ESC/.test(t)) out.push(t.slice(0, 60)); } return out.slice(0, 20); }")
    check("keyboard/mouse prompts visible in the phone HUD", None, hudtxt)

    sx, sy = center(ctl["stick"]); R = (ctl["stick"][2] - ctl["stick"][0]) / 2
    # 1 MOVE
    s0 = rd(); T.down(1, sx, sy)
    for k in range(1, 7): T.move(1, sx, sy - R * 0.85 * k / 6)
    tick(45); s1 = rd(); T.up(1); tick(2)
    d = math.hypot(s1["x"] - s0["x"], s1["z"] - s0["z"])
    check("MOVE: stick forward 1.5 s moves the runner >= 3 m", d >= 3, {"dist_m": round(d, 2), "held": s1["held"], "mz": s1["mz"]})
    # 1b analog: small deflection
    s0 = rd(); T.down(1, sx, sy); T.move(1, sx, sy - R * 0.25); tick(30); s1 = rd(); T.up(1); tick(2)
    check("MOVE analog: 25% deflection (under the 0.30 per-axis deadzone) moves?", None, {"dist_m_1s": round(math.hypot(s1["x"] - s0["x"], s1["z"] - s0["z"]), 2), "held": s1["held"]})
    s0 = rd(); T.down(1, sx, sy); T.move(1, sx, sy - R * 0.45); tick(30); s1 = rd(); T.up(1); tick(2)
    check("MOVE analog: 45% deflection speed vs full", None, {"dist_m_1s": round(math.hypot(s1["x"] - s0["x"], s1["z"] - s0["z"]), 2), "held": s1["held"]})
    # 2 LOOK
    s0 = rd(); lx0, ly0 = spec["w"] * 0.62, spec["h"] * 0.40
    T.down(2, lx0, ly0)
    for k in range(1, 15): T.move(2, lx0 + 160 * k / 14, ly0 + 24 * k / 14)
    T.up(2); tick(3); s1 = rd()
    check("LOOK: 160 px drag in the look zone turns the camera >= 0.3 rad", abs(s1["yaw"] - s0["yaw"]) >= 0.3, {"dyaw": round(s1["yaw"] - s0["yaw"], 4), "dpitch": round(s1["pitch"] - s0["pitch"], 4), "pointerLockElement": s1["lock"], "lockRequests": s1["lockReq"]})
    # 3 FIRE
    fx, fy = center(ctl["FIRE"])
    s0 = rd(); T.down(3, fx, fy); tick(8); m = rd(); T.up(3); tick(3); s1 = rd()
    check("FIRE: press fires the held weapon (magazine drops)", (s0["mag"] is not None and s1["mag"] is not None and s1["mag"] < s0["mag"]), {"wid": s0["wid"], "mag": [s0["mag"], s1["mag"]], "lmbWhileHeld": m["lmb"], "lockRequests": s1["lockReq"]})
    s0 = rd(); T.down(3, fx, fy); tick(60); T.up(3); tick(3); s1 = rd()
    check("FIRE held 2 s (auto-fire?)", None, {"wid": s0["wid"], "mag": [s0["mag"], s1["mag"]], "state": s1["wstate"]})
    # 4 JUMP
    jx, jy = center(ctl["JUMP"]); s0 = rd(); T.down(4, jx, jy); tick(1); T.up(4)
    ys = []
    for _ in range(12): tick(1); ys.append(rd()["y"])
    check("JUMP leaves the ground (> 0.3 m)", max(ys) - s0["y"] > 0.3, {"y0": round(s0["y"], 2), "ymax": round(max(ys), 2)})
    tick(20)
    # 5 RELOAD
    rx, ry = center(ctl["RELOAD"]); s0 = rd(); T.down(5, rx, ry); tick(2); T.up(5); tick(3); s1 = rd()
    check("RELOAD starts a reload", s1["wstate"] == "reloading" or (s1["mag"] or 0) > (s0["mag"] or 0), {"state": [s0["wstate"], s1["wstate"]], "mag": [s0["mag"], s1["mag"]]})
    tick(90)
    # 6 three touches together
    s0 = rd(); T.down(1, sx, sy); T.move(1, sx, sy - R * 0.85); T.down(2, lx0, ly0); T.down(3, fx, fy)
    for k in range(1, 11): T.move(2, lx0 + 120 * k / 10, ly0); tick(2)
    m = rd(); T.up(3); T.up(2); T.up(1); tick(3); s1 = rd()
    check("stick + look + FIRE together", None, {"moved_m": round(math.hypot(s1["x"] - s0["x"], s1["z"] - s0["z"]), 2), "dyaw": round(s1["yaw"] - s0["yaw"], 3), "fireHeld": m["lmb"], "held": m["held"], "heldMouse": m["heldMouse"]})
    # 7 LOOT: SETUP teleport next to the nearest chest, then look for a way to open it by touch
    ch = ev("""() => { const W = window.__LC__.W, p = W.player; const l = W.nearbyLoot(p.pos, 400).filter(n => n.type === 'chest').sort((a, b) => a.d - b.d); if (!l.length) return null; const c = l[0]; p.pos.set(c.pos.x + 1.2, c.pos.y + 0.05, c.pos.z); return {d: c.d, x: c.pos.x, y: c.pos.y, z: c.pos.z}; }""")
    tick(4)
    ih = ev("() => { const W = window.__LC__.W; const els = Array.from(document.querySelectorAll('div')).filter(e => e.offsetParent && e.children.length === 0 && /HOLD E|Open chest/.test(e.textContent)); return {hint: W.interactHint ? W.interactHint.type : null, text: els.map(e => e.textContent)}; }")
    has_e = any(k.upper() in ("E", "LOOT", "USE", "OPEN") for k in ctl)
    check("LOOT: standing at a chest, HUD prompt + a touch control to open it", has_e, {"SETUP_teleport": ch, "hint": ih, "touchButtons": list(ctl.keys())})
    shot("F_chest_prompt")
    # tapping the prompt? (interact hint is pointer-events none) -> try it
    before = rd()
    T.tap(spec["w"] / 2, spec["h"] * 0.62); tick(70)
    after = rd()
    check("LOOT: a tap on the prompt / holding at the chest opens it", after["slots"] != before["slots"], {"slots": [before["slots"], after["slots"]]})
    # 8 weapon slots: tap a HUD slot
    sl = ev("""() => { const out = []; for (const e of document.querySelectorAll('div')) { const s = getComputedStyle(e); if (!e.offsetParent) continue; const r = e.getBoundingClientRect(); if (r.width > 30 && r.width < 90 && r.height > 30 && r.height < 90 && r.right > innerWidth - 400 && r.bottom > innerHeight - 140 && s.pointerEvents !== 'none' && typeof e.onclick === 'function') out.push([r.left, r.top, r.right, r.bottom]); } return out; }""")
    check("weapon slots are tappable (HUD slot with a click handler)", len(sl) > 0, sl[:5])
    # 9 PAUSE via control bar
    bar = ov.get("bar")
    if bar and bar.get("btns"):
        pb = [b for b in bar["btns"] if "Pause" in (b["t"] or "")]
        if pb:
            T.tap(*center(pb[0]["r"])); time.sleep(1.0)
            p1 = ev("() => ({paused: !!window.__LC__.W.paused, card: /PAUSED/.test(document.body.innerText)})")
            check("PAUSE: control-bar pause button (26 px) opens the pause card", p1["card"], {"btn": pb[0], "state": p1})
            shot("G_pause")
            rs = ev("() => { const b = Array.from(document.querySelectorAll('button')).find(b => b.offsetParent && /RESUME/.test(b.textContent)); if (!b) return null; const r = b.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }")
            if rs:
                T.tap(*center(rs)); time.sleep(1.0)
                check("RESUME by tap", not ev("() => !!window.__LC__.W.paused"), rs)
    # 10 lifecycle: hidden tab -> pause?
    ev("() => { Object.defineProperty(document, 'hidden', {configurable: true, get: () => true}); Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'hidden'}); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('pagehide')); }")
    time.sleep(0.8)
    check("app switch (visibilitychange hidden + blur + pagehide) pauses the match", ev("() => !!window.__LC__.W.paused || /PAUSED/.test(document.body.innerText)"), None)
    ev("() => { Object.defineProperty(document, 'hidden', {configurable: true, get: () => false}); Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => 'visible'}); document.dispatchEvent(new Event('visibilitychange')); }")
    # 11 pinch
    T.pinch(spec["w"] * 0.5, spec["h"] * 0.4); time.sleep(0.5)
    check("pinch on the game leaves visualViewport.scale 1", abs(ev("() => visualViewport.scale") - 1) < 1e-3, ev("() => ({scale: visualViewport.scale, scrollY})"))
    # 12 perf info
    check("render info (INFORMATION)", None, ev("() => { const k = window.__LC__.W.kernel, r = k.renderer; return {dpr: r.getPixelRatio(), canvas: [r.domElement.width, r.domElement.height], calls: r.info.render.calls, tris: r.info.render.triangles, geos: r.info.memory.geometries, tex: r.info.memory.textures, graphics: window.__LC__.W.settings.graphics, fov: k.camera.fov, lt: null}; }"))
    # 13 portrait flip mid-match
    pg.set_viewport_size({"width": spec["h"], "height": spec["w"]}); time.sleep(1.5); tick(2)
    pr = ev("() => { const k = window.__LC__.W.kernel; return {W: innerWidth, H: innerHeight, fov: +k.camera.fov.toFixed(2), aspect: +k.camera.aspect.toFixed(3), camFit: k._camFit ? {active: k._camFit.active, authored: k._camFit.authoredFov, applied: +k._camFit.appliedFov.toFixed(2)} : 'absent', paused: !!window.__LC__.W.paused, rotateMsg: /rotate|sideways|landscape/i.test(document.body.innerText), html: document.documentElement.className}; }")
    check("portrait mid-match: rotate prompt / pause / camera fit", None, pr)
    shot("H_portrait")
    lay4 = ev(LAYOUT_JS)
    check("portrait HUD layout", lay4["nClipped"] == 0, {"nClipped": lay4["nClipped"], "clipped": lay4["clipped"][:10]})
    check("portrait: HUD under touch controls", None, ev(OVERLAP_JS)[:12])
    pg.set_viewport_size({"width": spec["w"], "height": spec["h"]}); time.sleep(1.0); tick(2)
    check("errors", len(errs) == 0, errs[:12])
    check("pointer-lock requests during the session (DYEFIELD M4 wants 0 on touch)", None, ev("() => window.__H_LOCKREQ__"))
    br.close()
with open(os.path.join(HERE, "lc_input_%s.json" % dev), "w", encoding="utf-8") as f:
    json.dump(rep, f, indent=1, default=str)
print("DONE")
