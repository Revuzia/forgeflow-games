#!/usr/bin/env python
"""Last Circle mobile audit probe (READ-ONLY; drives the already-running :8790 server).
Real touches through CDP Input.dispatchTouchEvent. __LC__ is used for SETUP/READ-BACK only (said so in each check).
Usage: python lc_mobile.py <device> [--full]
"""
import json, math, os, sys, time

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except Exception: pass

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, "shots"); os.makedirs(SHOTS, exist_ok=True)
URL = "http://127.0.0.1:8790/games/last-circle/index.html"
ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36"
IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
DEVICES = {
    "pixel7": {"w": 915, "h": 412, "dpr": 2.625, "ua": ANDROID_UA},
    "iphone14": {"w": 852, "h": 393, "dpr": 3, "ua": IOS_UA, "ios": True},
    "se": {"w": 667, "h": 375, "dpr": 2, "ua": IOS_UA, "ios": True},
    "pixel7p": {"w": 412, "h": 915, "dpr": 2.625, "ua": ANDROID_UA},   # portrait
}
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion", "--autoplay-policy=no-user-gesture-required",
         "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
         "--disable-backgrounding-occluded-windows"]
IOS_INIT = "try { Object.defineProperty(Document.prototype, 'fullscreenEnabled', { configurable: true, get() { return false; } }); } catch (e) {}"
LOCK_JS = r"""
(() => { if (window.__H_LOCK_INIT__) return; window.__H_LOCK_INIT__ = true; window.__H_LOCKREQ__ = 0;
  const o = Element.prototype.requestPointerLock;
  Element.prototype.requestPointerLock = function (...a) { window.__H_LOCKREQ__++; try { return o.apply(this, a); } catch (e) { return undefined; } };
})();"""

LAYOUT_JS = r"""
() => {
  const W = innerWidth, H = innerHeight;
  const vis = (e) => { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') return false;
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const ns = getComputedStyle(n); if (ns.display === 'none' || parseFloat(ns.opacity) === 0) return false; } return true; };
  const nm = (e) => { const t = (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30); return e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (t ? ' "' + t + '"' : ''); };
  const out = { W, H, clipped: [], smallTargets: [], smallFonts: [], scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight };
  const all = document.querySelectorAll('body *');
  for (const e of all) {
    if (e.closest('#__ffg_touch__') || e.tagName === 'CANVAS' || e.tagName === 'SCRIPT' || e.tagName === 'STYLE') continue;
    if (!vis(e)) continue;
    const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
    const ownText = Array.from(e.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
    const clickable = e.tagName === 'BUTTON' || e.getAttribute('role') === 'button' || typeof e.onclick === 'function' || e.tagName === 'INPUT';
    if ((ownText || clickable) && (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1))
      out.clipped.push({ el: nm(e), r: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)] });
    if (clickable && (r.width < 44 || r.height < 44)) out.smallTargets.push({ el: nm(e), w: Math.round(r.width), h: Math.round(r.height) });
    if (ownText) { const fs = parseFloat(getComputedStyle(e).fontSize); if (fs < 12) out.smallFonts.push({ el: nm(e), fs }); }
  }
  out.nClipped = out.clipped.length; out.nSmallTargets = out.smallTargets.length; out.nSmallFonts = out.smallFonts.length;
  out.clipped = out.clipped.slice(0, 25); out.smallTargets = out.smallTargets.slice(0, 25); out.smallFonts = out.smallFonts.slice(0, 25);
  return out;
}"""

OVERLAY_JS = r"""
() => {
  const root = document.getElementById('__ffg_touch__');
  const rr = (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; };
  const o = { present: !!root, active: !!(window.FFG_TOUCH && FFG_TOUCH.isActive()), cfg: window.FFG_TOUCH ? FFG_TOUCH.config : null,
    device: window.FFG_DEVICE || null, htmlClass: document.documentElement.className, controls: [] };
  if (root) {
    for (const e of root.querySelectorAll('.ffgt-stick,.ffgt-btn,.ffgt-look')) o.controls.push({ cls: e.className, label: e.textContent, r: rr(e) });
  }
  const bar = document.getElementById('__ff_controls__'); o.bar = bar ? { r: rr(bar), btns: Array.from(bar.querySelectorAll('button')).map((b) => ({ t: b.title || b.getAttribute('aria-label') || b.textContent, r: rr(b) })) } : null;
  return o;
}"""

# HUD text elements that intersect a touch control / bar rect
OVERLAP_JS = r"""
() => {
  const root = document.getElementById('__ffg_touch__');
  const ctl = [];
  if (root) for (const e of root.querySelectorAll('.ffgt-stick,.ffgt-btn')) ctl.push({ n: 'touch:' + (e.textContent || 'stick'), r: e.getBoundingClientRect() });
  const bar = document.getElementById('__ff_controls__'); if (bar) ctl.push({ n: 'controlbar', r: bar.getBoundingClientRect() });
  const vis = (e) => { for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false; } return true; };
  const hits = [];
  const els = document.querySelectorAll('body *');
  for (const e of els) {
    if (e.closest('#__ffg_touch__') || e.closest('#__ff_controls__') || e.id === 'lc-splash') continue;
    if (!(e.tagName === 'CANVAS' || Array.from(e.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim()))) continue;
    if (e.tagName === 'CANVAS' && e.parentElement && e.parentElement.id === 'game-container') continue;
    if (e.tagName === 'CANVAS' && e.width > 1500) continue;
    if (!vis(e)) continue;
    const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    for (const c of ctl) {
      const ix = Math.min(r.right, c.r.right) - Math.max(r.left, c.r.left), iy = Math.min(r.bottom, c.r.bottom) - Math.max(r.top, c.r.top);
      if (ix > 2 && iy > 2) hits.push({ hud: e.tagName.toLowerCase() + ' "' + (e.textContent || '').trim().slice(0, 24) + '"', ctl: c.n, area: Math.round(ix * iy) });
    }
  }
  return hits.slice(0, 40);
}"""


class Touch:
    def __init__(self, cdp):
        self.cdp, self.pts = cdp, {}
    def _send(self, typ):
        self.cdp.send("Input.dispatchTouchEvent", {"type": typ, "touchPoints": [{"x": float(p[0]), "y": float(p[1]), "id": i} for i, p in sorted(self.pts.items())]})
    def down(self, pid, x, y): self.pts[pid] = (x, y); self._send("touchStart")
    def move(self, pid, x, y): self.pts[pid] = (x, y); self._send("touchMove")
    def up(self, pid):
        p = self.pts.pop(pid, None)
        if self.pts and p is not None:
            self.cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": [{"x": float(p[0]), "y": float(p[1]), "id": pid}]})
        elif not self.pts:
            self.cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    def tap(self, x, y, pid=9, hold=0.08): self.down(pid, x, y); time.sleep(hold); self.up(pid)
    def pinch(self, cx, cy, spread=140, steps=10):
        self.pts = {1: (cx - 20, cy), 2: (cx + 20, cy)}; self._send("touchStart")
        for k in range(1, steps + 1):
            self.pts[1] = (cx - 20 - spread / 2 * k / steps, cy); self.pts[2] = (cx + 20 + spread / 2 * k / steps, cy); self._send("touchMove"); time.sleep(0.016)
        self.pts = {}; self.cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def center(r): return ((r[0] + r[2]) / 2, (r[1] + r[3]) / 2)


def main():
    dev = sys.argv[1]
    full = "--full" in sys.argv
    spec = DEVICES[dev]
    rep = {"device": dev, "spec": {k: v for k, v in spec.items() if k != "ua"}, "checks": [], "notes": []}
    console, pageerr = [], []

    def check(name, ok, detail=""):
        rep["checks"].append({"name": name, "ok": ok, "detail": detail}); print(("PASS " if ok else ("FAIL " if ok is False else "INFO ")) + name + " :: " + str(detail)[:400])

    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        HEADED = "--headed" in sys.argv
        br = pw.chromium.launch(channel="chrome", headless=not HEADED, args=FLAGS + (["--window-position=-3200,0"] if HEADED else []))
        ctx = br.new_context(viewport={"width": spec["w"], "height": spec["h"]}, device_scale_factor=spec["dpr"], is_mobile=True, has_touch=True, user_agent=spec["ua"])
        if spec.get("ios"): ctx.add_init_script(IOS_INIT)
        ctx.add_init_script(LOCK_JS)
        pg = ctx.new_page(); pg.set_default_timeout(120000)
        pg.on("console", lambda m: console.append((m.type, m.text[:300])))
        pg.on("pageerror", lambda e: pageerr.append(str(e).splitlines()[0][:300]))
        cdp = ctx.new_cdp_session(pg); T = Touch(cdp)
        def shot(n):
            try: pg.screenshot(path=os.path.join(SHOTS, "lc_%s_%s.png" % (dev, n)), timeout=25000)
            except Exception as e: rep["notes"].append("screenshot %s failed: %s" % (n, str(e).splitlines()[0][:120])); print("SHOT FAIL", n)
        ev = lambda js, arg=None: pg.evaluate(js, arg) if arg is not None else pg.evaluate(js)

        t0 = time.time()
        pg.goto(URL, wait_until="domcontentloaded")
        mq = ev("() => ({coarse: matchMedia('(pointer: coarse)').matches, fine: matchMedia('(pointer: fine)').matches, anyFine: matchMedia('(any-pointer: fine)').matches, maxTP: navigator.maxTouchPoints, viewportMeta: (document.querySelector('meta[name=viewport]')||{}).content, manifest: !!document.querySelector('link[rel=manifest]'), appleCapable: !!document.querySelector('meta[name=apple-mobile-web-app-capable]')})")
        check("device media queries + page meta", None, mq)
        # wait for the desktop-only card or the menu
        card = None
        for _ in range(240):
            st = ev("() => ({lc: !!window.__LC__, card: Array.from(document.querySelectorAll('button')).some(b => /PLAY ANYWAY/.test(b.textContent))})")
            if st["card"] or st["lc"]: card = st; break
            time.sleep(0.5)
        rep["bootSeconds"] = round(time.time() - t0, 1)
        shot("01_boot")
        check("boot shows DESKTOP-ONLY card on touch", bool(card and card["card"]), card)
        ov = ev(OVERLAY_JS)
        check("touch overlay mounted at boot", ov["present"], {"active": ov["active"], "profile": (ov["cfg"] or {}).get("profile"), "htmlClass": ov["htmlClass"], "controls": ov["controls"], "bar": ov["bar"]})
        if card and card["card"]:
            taps = 0
            for attempt in range(4):
                r = ev("() => { const b = Array.from(document.querySelectorAll('button')).find(b => /PLAY ANYWAY/.test(b.textContent)); if (!b) return null; const r = b.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }")
                if not r: break
                T.tap(*center(r)); taps += 1
                time.sleep(3)
            check("PLAY ANYWAY taps needed (card sits under the LOOK zone; tap replayed only if <400 ms & <8 px)", None, taps)
            t_tap = time.time()
            for _ in range(400):
                if ev("() => !!window.__LC__"): break
                time.sleep(0.5)
            rep["tapToMenuSeconds"] = round(time.time() - t_tap, 1)
        ok_lc = ev("() => !!window.__LC__")
        rep["menuSeconds"] = round(time.time() - t0, 1)
        check("menu reached after PLAY ANYWAY tap", ok_lc, "t=%.1fs" % rep["menuSeconds"])
        time.sleep(1.5)
        shot("02_menu_first_run")
        modals = ev("() => Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent).map(b => b.textContent.trim().slice(0,40))")
        check("buttons visible on first-run menu", None, modals)
        # CONTINUE ANYWAY (kbm modal)
        kb = ev("() => { const b = Array.from(document.querySelectorAll('button')).find(b => /CONTINUE ANYWAY/.test(b.textContent) && b.offsetParent); if (!b) return null; const r = b.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }")
        check("KEYBOARD + MOUSE REQUIRED modal shown", bool(kb), kb)
        if kb:
            inside = kb[0] >= 0 and kb[1] >= 0 and kb[2] <= spec["w"] and kb[3] <= spec["h"]
            check("CONTINUE ANYWAY button inside viewport", inside, kb)
            T.tap(*center(kb)); time.sleep(0.6)
        shot("03_menu_after_kbm")
        # close How To Play if it is up
        for _ in range(3):
            cl = ev("""() => { const cands = Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent && /GOT IT|CLOSE|LET'S GO|DONE|✕|×|BACK/i.test(b.textContent)); if (!cands.length) return null; const b = cands[0]; const r = b.getBoundingClientRect(); return {t: b.textContent.trim().slice(0,30), r: [r.left, r.top, r.right, r.bottom]}; }""")
            if not cl: break
            inside = cl["r"][0] >= 0 and cl["r"][1] >= 0 and cl["r"][2] <= spec["w"] and cl["r"][3] <= spec["h"]
            check("How-To close button '%s' reachable (inside viewport)" % cl["t"], inside, cl["r"])
            if inside: T.tap(*center(cl["r"]))
            else:
                ev("(t) => { const b = Array.from(document.querySelectorAll('button')).find(b => b.offsetParent && b.textContent.trim().slice(0,30) === t); if (b) b.click(); }", cl["t"])
                rep["notes"].append("How-To close button was off-screen; closed via DOM click (setup only)")
            time.sleep(0.6)
        shot("04_menu")
        lay = ev(LAYOUT_JS)
        check("menu layout (clipped / <44px targets / <12px fonts)", (lay["nClipped"] == 0), lay)
        # tap the QUICK mode card (fallback: first card)
        mc = ev("""() => { const cs = Array.from(document.querySelectorAll('.lc-mode-card')); const c = cs.find(c => /QUICK/i.test(c.textContent)) || cs[0]; if (!c) return null; c.scrollIntoView({block:'center'}); const r = c.getBoundingClientRect(); return {t: c.textContent.trim().slice(0,40), r: [r.left, r.top, r.right, r.bottom], n: cs.length}; }""")
        check("mode card found", bool(mc), mc)
        if not mc: raise SystemExit(json.dumps(rep))
        cx, cy = center(mc["r"])
        vis_ok = 0 <= cx <= spec["w"] and 0 <= cy <= spec["h"]
        check("mode card centre inside viewport (tappable)", vis_ok, mc["r"])
        T.tap(cx, cy)
        # lobby
        for _ in range(120):
            ph = ev("() => window.__LC__.W.phase")
            lob = ev("() => /FILLING LOBBY|OPERATIVES READY|DROP IN NOW/.test(document.body.innerText)")
            if lob or ph in ("drop", "match"): break
            time.sleep(0.5)
        time.sleep(0.8)
        shot("05_lobby")
        lay2 = ev(LAYOUT_JS)
        check("lobby layout (clipped)", lay2["nClipped"] == 0, {"nClipped": lay2["nClipped"], "scrollW": lay2["scrollW"], "sample": lay2["clipped"][:6]})
        T.tap(spec["w"] / 2, spec["h"] * 0.25)   # CLICK TO DROP IN NOW
        for _ in range(120):
            ph = ev("() => window.__LC__.W.phase")
            if ph in ("drop", "match") and ev("() => !!(window.__LC__.W.player)"): break
            time.sleep(0.5)
        time.sleep(1.0)
        st = ev("() => window.__LC__.state()")
        check("match started by taps (menu card -> lobby tap)", st["phase"] in ("drop", "match"), st)
        shot("06_drop")
        ov2 = ev(OVERLAY_JS)
        check("touch controls during drop", None, [(c["label"] or c["cls"]) for c in ov2["controls"]])
        # SETUP: land the player (fastForward = sim step, no input) — not an input check
        for _ in range(12):
            g = ev("() => { const p = window.__LC__.W.player; return {onGround: p.onGround, gliding: p.gliding, y: p.pos.y}; }")
            if g["onGround"] and not g["gliding"]: break
            ev("() => window.__LC__.fastForward(5, 1/30)")
        g = ev("() => { const p = window.__LC__.W.player; return {onGround: p.onGround, gliding: p.gliding, y: +p.pos.y.toFixed(2), alive: p.alive}; }")
        rep["notes"].append("landing done with __LC__.fastForward (setup only): %s" % g)
        time.sleep(1.2)
        shot("07_hud_landed")
        ov3 = ev(OVERLAY_JS)
        rep["overlay"] = ov3
        lay3 = ev(LAYOUT_JS)
        check("in-match HUD layout (clipped / small fonts)", lay3["nClipped"] == 0, lay3)
        olap = ev(OVERLAP_JS)
        check("HUD elements under touch controls / control bar", len(olap) == 0, olap)
        hint = ev("() => { const els = Array.from(document.querySelectorAll('div')).filter(d => d.offsetParent && /CLICK TO LOOK AROUND/.test(d.textContent) && d.children.length === 0); return els.map(e => e.textContent); }")
        check("desktop-only prompt 'CLICK TO LOOK AROUND' visible on phone", None, hint)
        kbtext = ev("() => { const t = document.body.innerText; const m = t.match(/\\b(PRESS|HOLD|TAP)\\s+[A-Z0-9]{1,5}\\b[^\\n]{0,40}|\\[[A-Z]\\][^\\n]{0,30}|SHIFT[^\\n]{0,30}|WASD[^\\n]{0,30}/g); return m ? m.slice(0, 15) : []; }")
        check("keyboard-key prompts visible in HUD on a phone", None, kbtext)

        ctl = {((c["label"] or "").strip() or ("stick" if "stick" in c["cls"] else "look")): c["r"] for c in ov3["controls"]}
        rep["controls"] = ctl
        rd = lambda: ev("() => { const p = window.__LC__.W.player; return {x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.input.yaw, pitch: p.input.pitch, fire: !!p.input.fire, mag: p.weapon ? p.weapon.magAmmo : null, wstate: p.weapon ? p.weapon.state : null, wid: p.weapon ? p.weapon.id : null, onGround: p.onGround, vy: p.vel ? p.vel.y : null, lock: document.pointerLockElement ? document.pointerLockElement.tagName : null, lockReq: window.__H_LOCKREQ__, held: window.FFG_TOUCH ? FFG_TOUCH.heldKeys() : [], hp: p.hp, alive: p.alive, slots: p.inventory.slots.map(s => s ? (s.id + (s.count != null ? 'x' + s.count : '')) : null), active: p.inventory.active}; }")
        # MOVE: stick
        if "stick" in ctl:
            s0 = rd(); sx, sy = center(ctl["stick"]); R = (ctl["stick"][2] - ctl["stick"][0]) / 2
            T.down(1, sx, sy)
            for k in range(1, 7): T.move(1, sx, sy - R * 0.85 * k / 6); time.sleep(0.02)
            time.sleep(0.3); mid = rd(); time.sleep(1.3)
            s1 = rd(); T.up(1)
            d = math.hypot(s1["x"] - s0["x"], s1["z"] - s0["z"])
            check("STICK moves the player (>=2 m in ~1.6 s)", d >= 2.0, {"dist_m": round(d, 2), "heldKeysDuring": mid["held"]})
            # diagonal / analog check: push to the right-up at 45 deg, small deflection (40% of radius)
            s0 = rd(); T.down(1, sx, sy)
            for k in range(1, 5): T.move(1, sx + R * 0.25 * k / 4, sy - R * 0.25 * k / 4); time.sleep(0.02)
            time.sleep(0.2); mid = rd(); time.sleep(0.8); s1 = rd(); T.up(1)
            check("STICK small (35%) deflection -> analog walk? (digital keys => full speed or nothing)", None, {"heldKeys": mid["held"], "dist_m_1s": round(math.hypot(s1["x"] - s0["x"], s1["z"] - s0["z"]), 2)})
        else:
            check("STICK present", False, list(ctl.keys()))
        # LOOK: drag in right zone
        s0 = rd()
        lx0, ly0 = spec["w"] * 0.62, spec["h"] * 0.35
        T.down(2, lx0, ly0)
        for k in range(1, 15): T.move(2, lx0 + 160 * k / 14, ly0 + 20 * k / 14); time.sleep(0.016)
        T.up(2); time.sleep(0.3); s1 = rd()
        dyaw = s1["yaw"] - s0["yaw"]
        check("LOOK drag (160 px) turns the camera (>=0.3 rad)", abs(dyaw) >= 0.3, {"dyaw_rad": round(dyaw, 4), "dpitch": round(s1["pitch"] - s0["pitch"], 4), "pointerLockElement": s1["lock"], "lockRequests": s1["lockReq"], "magBefore": s0["mag"], "magAfter": s1["mag"]})
        shot("08_after_look")
        # FIRE
        if "FIRE" in ctl:
            s0 = rd(); fx, fy = center(ctl["FIRE"])
            T.down(3, fx, fy); time.sleep(0.15); mid = rd(); time.sleep(0.7); T.up(3); time.sleep(0.2); s1 = rd()
            check("FIRE button fires (mag drops)", (s0["mag"] is not None and s1["mag"] is not None and s1["mag"] < s0["mag"]), {"wid": s0["wid"], "magBefore": s0["mag"], "magAfter": s1["mag"], "fireFlagWhileHeld": mid["fire"], "lockRequests": s1["lockReq"]})
            shot("09_after_fire")
            # hold FIRE for 2 s: does a semi pistol auto-repeat? (auto-fire behaviour on touch)
            s0 = rd(); T.down(3, fx, fy); time.sleep(2.0); T.up(3); time.sleep(0.2); s1 = rd()
            check("FIRE held 2 s -> shots (semi-auto pistol needs repeated taps?)", None, {"wid": s0["wid"], "magBefore": s0["mag"], "magAfter": s1["mag"], "state": s1["wstate"]})
        # JUMP
        if "JUMP" in ctl:
            s0 = rd(); jx, jy = center(ctl["JUMP"]); T.down(4, jx, jy); time.sleep(0.08); T.up(4)
            ys = []
            for _ in range(10): time.sleep(0.05); ys.append(rd()["y"])
            check("JUMP leaves the ground", max(ys) - s0["y"] > 0.3, {"y0": round(s0["y"], 2), "ymax": round(max(ys), 2)})
        # RELOAD
        if "RELOAD" in ctl:
            rx, ry = center(ctl["RELOAD"]); T.down(5, rx, ry); time.sleep(0.08); T.up(5); time.sleep(0.15)
            s1 = rd(); check("RELOAD button starts a reload", None, {"state": s1["wstate"], "mag": s1["mag"]})
        # MULTI-TOUCH: stick + look + fire together
        if "stick" in ctl and "FIRE" in ctl:
            s0 = rd(); sx, sy = center(ctl["stick"]); R = (ctl["stick"][2] - ctl["stick"][0]) / 2; fx, fy = center(ctl["FIRE"])
            T.down(1, sx, sy); T.move(1, sx, sy - R * 0.85)
            T.down(2, lx0, ly0)
            T.down(3, fx, fy)
            for k in range(1, 11): T.move(2, lx0 + 120 * k / 10, ly0); time.sleep(0.03)
            time.sleep(0.5); mid = rd()
            T.up(3); T.up(2); T.up(1); time.sleep(0.2); s1 = rd()
            check("3 simultaneous touches (stick+look+fire) all register", None, {"moved_m": round(math.hypot(s1["x"] - s0["x"], s1["z"] - s0["z"]), 2), "dyaw": round(s1["yaw"] - s0["yaw"], 3), "fireWhileHeld": mid["fire"], "held": mid["held"]})
        # LOOT: no E button — show the prompt a phone player sees next to a chest (SETUP: teleport next to a chest)
        info = ev("""() => { const W = window.__LC__.W; const p = W.player; const c = { hasE: !!document.querySelector('#__ffg_touch__') && Array.from(document.querySelectorAll('#__ffg_touch__ .ffgt-btn')).some(b => /LOOT|USE|OPEN|E$/.test(b.textContent)) };
            return c; }""")
        check("touch overlay has a LOOT/USE (E) button", info["hasE"], info)
        tele = ev("""() => { const W = window.__LC__.W; const p = W.player; let best = null;
            const scan = (o) => { if (!o) return; o.traverse && o.traverse((n) => { if (n.userData && (n.userData.chest || n.userData.kind === 'chest')) { const d = n.position.distanceTo(p.pos); if (!best || d < best.d) best = { d, x: n.position.x, z: n.position.z }; } }); };
            try { scan(W.scene || W.kernel.scene); } catch (e) {}
            return best; }""")
        rep["notes"].append("chest scan via scene userData: %s" % tele)
        slots = rd()
        check("inventory after landing (walkover auto-pickup only)", None, {"slots": slots["slots"], "active": slots["active"]})
        # PAUSE: control-bar pause button
        bar = ov3.get("bar")
        check("control bar present (fullscreen/mute/pause) on phone", bool(bar), bar)
        # pinch hygiene
        T.pinch(spec["w"] * 0.5, spec["h"] * 0.45)
        time.sleep(0.3)
        vv = ev("() => ({scale: visualViewport.scale, scrollY: scrollY})")
        check("pinch on game leaves visualViewport.scale == 1", abs(vv["scale"] - 1) < 1e-3, vv)
        # perf (informational)
        perf = ev("""async () => { const W = window.__LC__.W; const r = W.kernel.renderer; let n = 0; const t0 = performance.now(); const ts = [];
            await new Promise((res) => { let last = t0; const f = (t) => { ts.push(t - last); last = t; n++; if (t - t0 < 3000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
            ts.sort((a,b)=>a-b); return { fps: +(n / 3).toFixed(1), p99ms: +ts[Math.floor(ts.length * 0.99)].toFixed(1), dpr: r.getPixelRatio(), drawSize: [r.domElement.width, r.domElement.height], calls: r.info.render.calls, tris: r.info.render.triangles, graphics: W.settings.graphics, fov: W.kernel.camera.fov, camFit: W.kernel._camFit || null }; }""")
        check("perf at device size (INFORMATION, iGPU, not a verdict)", None, perf)
        # PORTRAIT flip mid-match
        if dev != "pixel7p":
            pg.set_viewport_size({"width": spec["h"], "height": spec["w"]})
            time.sleep(1.2)
            shot("10_portrait_midmatch")
            pr = ev("() => ({ W: innerWidth, H: innerHeight, fov: window.__LC__.W.kernel.camera.fov, aspect: window.__LC__.W.kernel.camera.aspect, camFit: window.__LC__.W.kernel._camFit || null, paused: !!window.__LC__.W.paused, htmlClass: document.documentElement.className, rotateOverlay: /rotate|sideways|landscape/i.test(document.body.innerText) })")
            check("portrait mid-match: rotate overlay / pause / camera fit", None, pr)
            lay4 = ev(LAYOUT_JS)
            check("portrait HUD layout (clipped)", lay4["nClipped"] == 0, {"nClipped": lay4["nClipped"], "sample": lay4["clipped"][:8]})
            olap4 = ev(OVERLAP_JS)
            check("portrait: HUD under touch controls", len(olap4) == 0, olap4[:12])
            pg.set_viewport_size({"width": spec["w"], "height": spec["h"]}); time.sleep(0.8)
        s_end = rd()
        rep["lockRequests"] = s_end["lockReq"]
        errs = [t for (k, t) in console if k == "error"]
        check("console errors", len(errs) == 0 and len(pageerr) == 0, {"console": errs[:10], "page": pageerr[:10]})
        shot("11_end")
        br.close()
    with open(os.path.join(HERE, "lc_mobile_%s.json" % dev), "w", encoding="utf-8") as f:
        json.dump(rep, f, indent=1, default=str)
    print("WROTE", os.path.join(HERE, "lc_mobile_%s.json" % dev))


if __name__ == "__main__":
    main()
