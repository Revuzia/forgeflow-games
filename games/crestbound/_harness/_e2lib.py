"""ember-2 playtest boot helper: a Play subclass with a robust title exit."""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _playlib import Play

PORT = os.environ.get("E2PORT", "8791")
BASEURL = "http://localhost:%s/games/crestbound/index.html?dev=1&quality=low&autoscale=0" % PORT

CLICK_JS = r"""() => {
  const words = ['NEW GAME','NEW RUN','CONTINUE','PLAY','START','BEGIN','ENTER'];
  const btns = Array.from(document.querySelectorAll('button.cb-btn, button, [role=button], .btn'));
  for (const want of words) for (const b of btns) {
    const r = b.getBoundingClientRect();
    if (b.disabled || r.width < 4 || r.height < 4) continue;
    if ((b.textContent||'').toUpperCase().indexOf(want) < 0) continue;
    if (typeof b.__activate === 'function') b.__activate(); else b.click();
    return want;
  }
  return null; }"""


class E2(Play):
    def __init__(self, area, viewport=(1280, 720), url=None):
        Play.__init__(self, area, url=url or BASEURL, viewport=viewport)

    def __enter__(self):
        from playwright.sync_api import sync_playwright
        from _playlib import FLAGS
        self._pw = sync_playwright().start()
        self.br = self._pw.chromium.launch(channel="chrome", headless=True, args=FLAGS)
        self.pg = self.br.new_page(viewport={"width": self.viewport[0], "height": self.viewport[1]})
        self.console = []
        self.pg.on("console", lambda m: self.console.append(m.type + ": " + m.text[:300])
                   if m.type in ("error", "warning") else None)
        self.pg.on("pageerror", lambda e: self.console.append("pageerror: " + str(e)[:300]))
        self.pg.goto(self.url, wait_until="load", timeout=90000)
        for _ in range(120):
            if self.pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.engine && CRESTBOUND.game)"):
                break
            self.pg.wait_for_timeout(400)
        # leave the title the way a player does
        t0 = time.time()
        last = None
        while time.time() - t0 < 60:
            last = self.pg.evaluate("globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.state")
            if last in ("keep", "playing"):
                break
            if last == "paused":
                self.pg.keyboard.press("Escape")
            try:
                self.pg.evaluate(CLICK_JS)
            except Exception:
                pass
            self.pg.wait_for_timeout(400)
        self.say("boot state:", last)
        self.pg.wait_for_timeout(1200)
        return self

    def goto(self, course, cp=None, settle=2500):
        if cp is None:
            self.js("(c) => CRESTBOUND.game.__dev.goto(c)", course)
        else:
            self.js("([c,i]) => CRESTBOUND.game.__dev.goto(c,i)", [course, cp])
        for _ in range(120):
            self.wait(400)
            s = self.state()
            if s["course"] == course and s["gstate"] == "playing":
                break
        self.wait(settle)
        s = self.state()
        self.say("goto %s cp=%s -> %s %s %s" % (course, cp, s["gstate"], s["course"], s["pos"]))
        return s

    def snap(self):
        return self.js(r"""() => { const G = CRESTBOUND.game, P = G.player, C = G.course;
          const col = G._collectibles;
          const gs = G.__dev ? G.__dev.state() : {};
          return { t: C ? +C.clock.toFixed(2) : null, st: G.state,
            p: P ? [+P.pos.x.toFixed(2), +P.pos.y.toFixed(2), +P.pos.z.toFixed(2)] : null,
            v: P ? [+P.vel.x.toFixed(2), +P.vel.y.toFixed(2), +P.vel.z.toFixed(2)] : null,
            ps: P ? P.state : null, gnd: P ? !!P.grounded : null, jc: P ? P.jumpCount : null,
            sp: P ? +Math.hypot(P.vel.x, P.vel.z).toFixed(2) : null,
            surf: P ? P.surface : null, water: P ? !!P.inWater : null, sub: P ? !!P.submerged : null,
            deaths: G.deaths, cp: gs.cpIndex, crests: gs.crests,
            coins: col && col.counts ? col.counts.coins : null,
            sig: col && col.counts ? col.counts.sigils : null,
            cam: G.cam ? [+G.cam.yaw.toFixed(2), +G.cam.pitch.toFixed(2), +G.cam.dist.toFixed(2)] : null }; }""")

    # ---------------------------------------------------------------- moving
    def run_to(self, x, z, tol=1.5, max_ms=15000, keys=("W",), tag="", reaim_ms=200,
               stop_on_death=True, sample=None):
        """Hold W toward an XZ target INSIDE a course. Unlike playlib.walk_to this does
        not treat gstate 'playing' as an arrival."""
        import time as _t
        self.face(x, z)
        d0 = self.js("() => CRESTBOUND.game.deaths")
        self.down(*keys)
        t0 = _t.time(); stuck = 0; prev = self.pos(); rows = []
        elapsed = 0.0
        while elapsed < max_ms:
            self.wait(reaim_ms)
            elapsed = (_t.time() - t0) * 1000
            s = self.snap()
            rows.append(s)
            if sample:
                sample(s)
            p = s["p"]
            if p is None:
                break
            d = ((p[0] - x) ** 2 + (p[2] - z) ** 2) ** 0.5
            if d <= tol:
                break
            if s["st"] != "playing":
                break
            if stop_on_death and self.js("() => CRESTBOUND.game.deaths") > d0:
                break
            moved = ((p[0] - prev[0]) ** 2 + (p[2] - prev[2]) ** 2) ** 0.5
            stuck = stuck + 1 if moved < 0.05 else 0
            prev = p
            if stuck >= 8:
                break
            self.face(x, z)
        self.up(*keys)
        self.wait(150)
        s = self.snap()
        p = s["p"]
        d = ((p[0] - x) ** 2 + (p[2] - z) ** 2) ** 0.5 if p else 999
        d1 = self.js("() => CRESTBOUND.game.deaths")
        out = {"target": [x, z], "end": p, "dist": round(d, 2), "ms": int(elapsed),
               "arrived": d <= tol, "stuck": stuck >= 8, "deaths": d1 - d0, "snap": s,
               "rows": rows}
        self.say("  run_to %s%s -> %s d=%.2f %s%s deaths+%d" % (
            [x, z], (" " + tag) if tag else "", p, d,
            "ARRIVED" if out["arrived"] else "NOT-ARRIVED", " STUCK" if out["stuck"] else "",
            out["deaths"]))
        return out

    def jump_to(self, x, z, hold=140, run_ms=600, tag=""):
        """Face a target, run at it, and jump."""
        self.face(x, z)
        self.down("W"); self.wait(run_ms)
        self.down("SPACE"); self.wait(hold); self.up("SPACE")
        self.wait(500)
        s = self.snap()
        self.up("W"); self.wait(250)
        s2 = self.snap()
        self.say("  jump_to %s %s -> %s ps=%s" % ([x, z], tag, s2["p"], s2["ps"]))
        return s2

    def watch(self, ms, step=200, tag=""):
        rows = []
        t = 0
        while t < ms:
            self.wait(step); t += step
            rows.append(self.snap())
        if tag:
            self.say("  watch %s -> %s %s" % (tag, rows[-1]["p"], rows[-1]["ps"]))
        return rows
