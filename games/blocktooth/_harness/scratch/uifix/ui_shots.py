#!/usr/bin/env python
"""ui fix group: targeted captures + measurements for the ui findings (observation only).

    python _harness/scratch/uifix/ui_shots.py --base http://localhost:5199/ --only title,select,menus,alerts,tabloids
Output: _shots/uifix/<name>.png
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from common import (ROOT, Session, add_common_args, build_url, ensure_play, set_rank, world_to_keys)  # noqa: E402

OUT = os.path.join(ROOT, "_shots", "uifix")


def log(m):
    print(m, flush=True)


class U:
    def __init__(self, s, a):
        self.s, self.a = s, a
        os.makedirs(OUT, exist_ok=True)

    def shot(self, name):
        ok = self.s.screenshot(os.path.join(OUT, name + ".png"))
        log("  [%s] %s" % ("ok" if ok else "!!", name))

    def js(self, src):
        return self.s.safe_js(src)

    def run(self, titan, biome, seed, noslate=True):
        s = self.s
        s.release_all()
        s.goto(build_url(self.a.base, autostart=1, dev=1, titan=titan, biome=biome, seed=seed, noslate=1 if noslate else None))
        s.wait_bt(90)
        return s.wait_screen(("slate", "play", "draft"), 90)

    # ── title legal line ──
    def title(self):
        s = self.s
        s.goto(build_url(self.a.base))
        s.wait_bt(90)
        s.wait_screen("title", 60)
        time.sleep(1.5)
        log("  legal: " + json.dumps(self.js("""() => { const l = document.querySelector('.bt-title-legal span'); const st = document.querySelector('.bt-title-street');
          const r = l.getBoundingClientRect(), q = st.getBoundingClientRect(); const cs = getComputedStyle(l);
          return { legal: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], bg: cs.backgroundColor, font: cs.fontSize, color: cs.color,
                   streetTop: Math.round(q.top), dashY: Math.round(q.top + q.height * 0.4) }; }""")))
        self.shot("title")

    # ── select: lore column fill + remember-focus round trip ──
    LORE_JS = """() => { const L = document.querySelector('.bt-lore'); const b = L.getBoundingClientRect();
      const kids = [...L.children].map(k => { const r = k.getBoundingClientRect(); return [k.className.split(' ')[0], Math.round(r.top - b.top), Math.round(r.bottom - b.top)]; });
      let gap = 0; for (let i = 1; i < kids.length; i++) gap = Math.max(gap, kids[i][1] - kids[i - 1][2]);
      const last = kids[kids.length - 1];
      return { name: (L.querySelector('.bt-lore-name') || {}).textContent, h: Math.round(b.height), overflow: L.scrollHeight - L.clientHeight,
               maxInnerGap: gap, bottomSpace: Math.round(b.height) - last[2], rec: !!L.querySelector('.bt-lore-rec'), kids }; }"""

    def select(self):
        s = self.s
        s.goto(build_url(self.a.base))
        s.wait_bt(90)
        s.wait_screen("title", 60)
        time.sleep(1.0)
        s.press("Enter")
        s.wait_screen("select", 60)
        time.sleep(1.2)
        for i, t in enumerate(("molo", "voltkite", "hearthback", "briarwick")):
            if i:
                s.press("ArrowRight")
                time.sleep(0.6)
            log("  titan lore: " + json.dumps(self.js(self.LORE_JS)))
            self.shot("select_titan_%s" % t)
        # back to VOLT-KITE, go to step 2 and walk the zones
        s.press("ArrowLeft"); time.sleep(0.3); s.press("ArrowLeft"); time.sleep(0.4)
        s.press("Enter"); time.sleep(0.9)
        for i, b in enumerate(("grideast", "whitestacks", "lockwater")):
            if i:
                s.press("ArrowRight")
                time.sleep(0.6)
            log("  zone lore: " + json.dumps(self.js(self.LORE_JS)))
            self.shot("select_biome_%s" % b)
        # PC-12: ESC (step 1) · ESC (title) · ENTER → select must reopen on VOLT-KITE / LOCKWATER
        s.press("Escape"); time.sleep(0.6)
        before = self.js("() => document.querySelector('.bt-lore .bt-lore-name').textContent")
        s.press("Escape")
        s.wait_screen("title", 20); time.sleep(1.0)
        s.press("Enter")
        s.wait_screen("select", 30); time.sleep(1.0)
        after = self.js("() => document.querySelector('.bt-lore .bt-lore-name').textContent")
        s.press("Enter"); time.sleep(0.8)
        zone = self.js("() => document.querySelector('.bt-lore .bt-lore-name').textContent")
        log("  remember: before=%s after=%s zone=%s" % (before, after, zone))
        self.shot("select_after_roundtrip")

    # ── pause / settings key hints ──
    def menus(self):
        s = self.s
        self.run("briarwick", "whitestacks", 305)
        ensure_play(s, 10)
        s.cheat("god", True)
        time.sleep(1.2)
        s.press("Escape"); time.sleep(1.0)
        log("  pause keys: " + json.dumps(self.js("() => { const k = document.querySelector('.bt-pause-keys'); const cs = getComputedStyle(k); return [cs.fontSize, cs.color, k.textContent]; }")))
        self.shot("pause")
        s.press("ArrowDown"); time.sleep(0.3); s.press("Enter"); time.sleep(1.0)
        log("  settings keys: " + json.dumps(self.js("() => { const k = document.querySelector('.bt-set-keys'); const cs = getComputedStyle(k); return [cs.fontSize, cs.color]; }")))
        self.shot("settings")
        s.press("Escape"); time.sleep(0.6); s.press("Escape"); time.sleep(0.6)

    # ── alerts: the opening toast, then an urgent boss strap ──
    AL_JS = """() => { const a = document.querySelector('.bt-alert'); const r = a.getBoundingClientRect(); const cs = getComputedStyle(a);
      return { on: a.classList.contains('on'), cls: a.className, vis: cs.visibility, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
               clip: cs.clipPath, op: cs.opacity, t: a.querySelector('.bt-alert-title').textContent,
               bossBottom: (() => { const b = document.querySelector('.bt-boss'); if (!b || getComputedStyle(b).display === 'none') return null; return Math.round(b.getBoundingClientRect().bottom); })() }; }"""

    def alerts(self):
        s = self.s
        self.run("molo", "grideast", 301)
        ensure_play(s, 10)
        t0 = time.time()
        i = 0
        while time.time() - t0 < 6.5:
            st = self.js(self.AL_JS)
            if st and st.get("on"):
                log("  %.2fs %s" % (time.time() - t0, json.dumps(st)))
                if i < 8:
                    self.shot("alert_toast_%02d" % i)
                i += 1
            time.sleep(0.3)
        s.cheat("god", True)
        s.cheat("noSpawns", True)
        s.cheat("killAll")
        set_rank(s, 4, log)
        time.sleep(3.0)
        for _ in range(6):
            ensure_play(s, 20)
            time.sleep(1.0)
            if s.screen() == "play":
                break
        s.cheat("boss")
        t0 = time.time()
        i = 0
        while time.time() - t0 < 8:
            if s.screen() == "draft":
                ensure_play(s, 10)
            st = self.js(self.AL_JS)
            if st and st.get("on") and "urgent" in st.get("cls", ""):
                log("  %.2fs %s" % (time.time() - t0, json.dumps(st)))
                if i < 10:
                    self.shot("alert_urgent_%02d" % i)
                i += 1
            time.sleep(0.25)

    # ── tabloids: first broadcast (dead, 0 blocks) → retry with a bigger run (records fall) → clear ──
    def die(self):
        s = self.s
        s.safe_js("() => { const T = window.__H_W__().titan; T.hp = 0; T.alive = false; }")
        ok, _ = s.wait_screen("end", 25)
        time.sleep(3.5)
        return ok

    PAPER_JS = """() => { const P = document.querySelector('.bt-paper'); const N = P.querySelector('.bt-np-numbers'); const nb = N.getBoundingClientRect();
      const kids = [...N.children].map(k => { const r = k.getBoundingClientRect(); return [k.className, Math.round(r.top - nb.top), Math.round(r.bottom - nb.top)]; });
      let gap = 0; for (let i = 1; i < kids.length; i++) gap = Math.max(gap, kids[i][1] - kids[i - 1][2]);
      return { numbersH: Math.round(nb.height), maxGap: gap, kids, news: [...P.querySelectorAll('.bt-np-new')].map(n => n.parentElement.querySelector('.k').textContent),
               note: (P.querySelector('.bt-np-record-note') || {}).textContent, body: [...P.querySelectorAll('.bt-np-story p')].map(p => p.textContent),
               overflowY: P.scrollHeight - P.clientHeight, storyOverflow: (() => { const st = P.querySelector('.bt-np-story'); return st.scrollHeight - st.clientHeight; })(),
               best: JSON.parse(localStorage.getItem('blocktooth.best.v1') || 'null') }; }"""

    def tabloids(self):
        s = self.s
        log("== tabloid 1: first broadcast, dead fast (molo / grideast)")
        self.run("molo", "grideast", 401)
        ensure_play(s, 10)
        time.sleep(1.5)
        log("  " + json.dumps(self.js("() => Object.keys(localStorage)")))
        self.die()
        log("  paper1: " + json.dumps(self.js(self.PAPER_JS)))
        self.shot("tabloid_first")
        log("== tabloid 2: retry (R), bigger run, dies → records fall")
        time.sleep(0.5)
        s.press("KeyR")
        s.wait_screen(("slate", "play"), 60)
        ensure_play(s, 15)
        s.cheat("god", True)
        set_rank(s, 2, log)
        time.sleep(1.0)
        s.hold({"KeyW", "KeyD"})
        time.sleep(4.0)
        s.release_all()
        s.hold({"KeyS"})
        time.sleep(3.0)
        s.release_all()
        s.cheat("god", False)
        self.die()
        log("  paper2: " + json.dumps(self.js(self.PAPER_JS)))
        self.shot("tabloid_records")
        log("== tabloid 3: clear (molo / grideast)")
        self.run("molo", "grideast", 307)
        ensure_play(s, 10)
        s.cheat("god", True)
        s.cheat("noSpawns", True)
        s.cheat("killAll")
        set_rank(s, 4, log)
        time.sleep(2)
        s.cheat("boss")
        time.sleep(6)
        t0 = time.time()
        while time.time() - t0 < 60:
            scr = s.screen()
            if scr == "end":
                break
            if scr != "play":
                s.release_all()
                ensure_play(s, 10)
                continue
            o = s.safe_js("() => { const W = window.__H_W__(); const b = W.boss; return b ? { bx: b.x, bz: b.z, x: W.titan.x, z: W.titan.z } : null; }")
            if o:
                s.safe_js("() => { const b = window.__H_W__().boss; if (b && b.introT <= 0 && b.hp > 50) b.hp = 50; }")
                s.hold(world_to_keys(o["bx"] - o["x"], o["bz"] - o["z"]) or {"KeyW"})
                s.press("Space")
            time.sleep(0.2)
        s.release_all()
        s.wait_screen("end", 20)
        time.sleep(3.5)
        log("  paper3: " + json.dumps(self.js(self.PAPER_JS)))
        self.shot("tabloid_clear")


def main():
    ap = argparse.ArgumentParser()
    add_common_args(ap)
    ap.add_argument("--only", default="title,select,menus,alerts,tabloids")
    a = ap.parse_args()
    a.no_serve = True
    s = Session(a, "uifix_shots")
    s.start()
    try:
        u = U(s, a)
        for part in a.only.split(","):
            log("== " + part)
            try:
                getattr(u, part)()
            except Exception as e:  # keep going: report per part
                log("  !! %s failed: %r" % (part, e))
        d = s.diagnostics()
        log("errors: " + json.dumps({k: (v[:5] if isinstance(v, list) else v) for k, v in d.items() if k in ("pageErrors", "consoleErrors", "windowErrors", "failedRequests")})[:1500])
    finally:
        s.close()


if __name__ == "__main__":
    main()
