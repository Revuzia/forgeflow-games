"""Shared driver for the PLAYTEST lanes (owner instruction P11 — agents must PLAY).

Not a gate. This drives the shipped page with REAL KeyboardEvents through
window, samples player.__test.state() as it goes, and drops PNGs so a human (or
the agent) can look at what the player would have been looking at.

Rules baked in:
  * ?dev=1&quality=low&autoscale=0 (HARNESS_NOTES: low is the tier this GPU
    actually meets, and autoscale off keeps the frame stable for shots).
  * headless Chrome with the d3d11 flags = the real Intel UHD, not SwiftShader.
  * NEVER teleport without then walking the last stretch on foot.
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]
URL = "http://localhost:8788/games/crestbound/index.html?dev=1&quality=low&autoscale=0"

KEYMAP = {  # what playwright calls the keys we bind
    "W": "w", "A": "a", "S": "s", "D": "d", "SPACE": " ", "C": "c", "F": "f",
    "E": "e", "Q": "q", "Z": "z", "R": "r", "V": "v", "G": "g", "T": "t",
    "SHIFT": "Shift", "CTRL": "Control", "ESC": "Escape",
}


class Play:
    def __init__(self, area, url=URL, viewport=(1280, 720)):
        self.area = area
        self.url = url
        self.viewport = viewport
        self.shotdir = os.path.join(ROOT, "_shots", "play_" + area)
        os.makedirs(self.shotdir, exist_ok=True)
        self.n = 0
        self.log = []
        self.defects = []
        self._held = set()

    # ---------------------------------------------------------------- boot
    def __enter__(self):
        self._pw = sync_playwright().start()
        self.br = self._pw.chromium.launch(channel="chrome", headless=True, args=FLAGS)
        self.pg = self.br.new_page(viewport={"width": self.viewport[0], "height": self.viewport[1]})
        self.console = []
        self.pg.on("console", lambda m: self.console.append(m.type + ": " + m.text[:300])
                   if m.type in ("error", "warning") else None)
        self.pg.on("pageerror", lambda e: self.console.append("pageerror: " + str(e)[:300]))
        self.pg.goto(self.url, wait_until="load", timeout=90000)
        for _ in range(160):
            if self.pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.course)"):
                break
            self.pg.wait_for_timeout(500)
        self.pg.wait_for_timeout(1500)
        return self

    def __exit__(self, *a):
        try:
            self.release_all()
            self.br.close()
        finally:
            self._pw.stop()

    # ---------------------------------------------------------------- utils
    def js(self, expr, arg=None):
        return self.pg.evaluate(expr, arg) if arg is not None else self.pg.evaluate(expr)

    def wait(self, ms):
        self.pg.wait_for_timeout(ms)

    def shot(self, what):
        self.n += 1
        p = os.path.join(self.shotdir, "%02d_%s.png" % (self.n, what))
        self.pg.screenshot(path=p)
        return p

    def say(self, *a):
        line = " ".join(str(x) for x in a)
        print(line, flush=True)
        self.log.append(line)

    # ---------------------------------------------------------------- state
    def state(self):
        return self.js("""() => { const G = CRESTBOUND.game, P = G.player;
          const s = P && P.__test ? P.__test.state() : null;
          return { gstate: G.state, course: G.course && G.course.def && G.course.def.id,
            pos: P ? [+P.pos.x.toFixed(2), +P.pos.y.toFixed(2), +P.pos.z.toFixed(2)] : null,
            vel: P ? [+P.vel.x.toFixed(2), +P.vel.y.toFixed(2), +P.vel.z.toFixed(2)] : null,
            pstate: P ? P.state : null, grounded: P ? !!P.grounded : null,
            facing: P ? +P.facing.toFixed(3) : null,
            surface: P ? P.surface : null, inWater: P ? !!P.inWater : null,
            submerged: P ? !!P.submerged : null, climbing: P ? P.state === 'climb' : null,
            camYaw: G.cam ? +G.cam.yaw.toFixed(3) : null,
            camPitch: G.cam ? +G.cam.pitch.toFixed(3) : null,
            camDist: G.cam ? +G.cam.dist.toFixed(2) : null,
            camPos: G.cam && G.cam.cam ? [+G.cam.cam.position.x.toFixed(2), +G.cam.cam.position.y.toFixed(2), +G.cam.cam.position.z.toFixed(2)] : null,
            crests: G.save ? G.save.crestTotal() : null,
            cardOpen: !!document.querySelector('.cb-card.on'),
            menuOpen: !!(G.menu && G.menu.isOpen) }; }""")

    def pos(self):
        return self.js("() => { const p = CRESTBOUND.game.player.pos; return [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)]; }")

    # ---------------------------------------------------------------- input
    def down(self, *keys):
        for k in keys:
            kk = KEYMAP.get(k.upper(), k)
            if kk not in self._held:
                self.pg.keyboard.down(kk)
                self._held.add(kk)

    def up(self, *keys):
        for k in keys:
            kk = KEYMAP.get(k.upper(), k)
            if kk in self._held:
                self.pg.keyboard.up(kk)
                self._held.discard(kk)

    def tap(self, k, ms=90):
        self.down(k); self.wait(ms); self.up(k)

    def release_all(self):
        for kk in list(self._held):
            try:
                self.pg.keyboard.up(kk)
            except Exception:
                pass
        self._held.clear()

    def hold(self, keys, ms, sample_ms=150, tag=None):
        """Hold keys for ms, sampling state. Returns the samples."""
        self.down(*keys)
        out = []
        t = 0
        while t < ms:
            step = min(sample_ms, ms - t)
            self.wait(step)
            t += step
            out.append(self.state())
        self.up(*keys)
        self.wait(120)
        if tag:
            self.say("  hold %s %dms [%s] -> %s %s" % (
                "+".join(keys), ms, tag, out[-1]["pos"], out[-1]["pstate"]))
        return out

    # --------------------------------------------------- goal-directed walk
    def face(self, x, z):
        """Aim the hero AND the camera at a world XZ point (a player would use the mouse)."""
        return self.js("""([tx,tz]) => { const G = CRESTBOUND.game, P = G.player;
            const yaw = Math.atan2(-(tx - P.pos.x), -(tz - P.pos.z));
            P.__test.setFacing(yaw);
            if (G.cam) { G.cam.yaw = yaw; G.cam._rcHoldT = 0; }
            return +yaw.toFixed(3); }""", [x, z])

    def walk_to(self, x, z, tol=1.2, max_ms=9000, keys=("W",), stop_on_card=True, tag=""):
        """Steer toward an XZ target with W held, re-aiming the CAMERA (which is what
        the movement is relative to) every 250 ms. Returns a dict with the outcome."""
        self.face(x, z)
        self.down(*keys)
        t0 = time.time()
        elapsed = 0
        last = None
        stuck = 0
        prev = self.pos()
        while elapsed < max_ms:
            self.wait(220)
            elapsed = (time.time() - t0) * 1000
            st = self.state()
            last = st
            if stop_on_card and (st["cardOpen"] or st["gstate"] in ("card", "playing", "cinematic")):
                break
            p = st["pos"]
            d = ((p[0] - x) ** 2 + (p[2] - z) ** 2) ** 0.5
            if d <= tol:
                break
            moved = ((p[0] - prev[0]) ** 2 + (p[2] - prev[2]) ** 2) ** 0.5
            stuck = stuck + 1 if moved < 0.06 else 0
            prev = p
            if stuck >= 6:
                break
            # re-aim: keep the camera pointing at the goal so W means "toward it"
            self.face(x, z)
        self.up(*keys)
        self.wait(150)
        st = self.state()
        p = st["pos"]
        d = ((p[0] - x) ** 2 + (p[2] - z) ** 2) ** 0.5
        res = {"target": [x, z], "end": p, "dist": round(d, 2), "ms": int(elapsed),
               "arrived": d <= tol, "stuck": stuck >= 6, "state": st}
        self.say("  walk_to %s%s -> %s d=%.2f %s%s" % (
            [x, z], (" (" + tag + ")") if tag else "", p, d,
            "ARRIVED" if res["arrived"] else "DID NOT ARRIVE",
            " STUCK" if res["stuck"] else ""))
        return res

    def tp(self, x, y, z):
        self.js("([x,y,z]) => CRESTBOUND.game.__dev.tp(x,y,z)", [x, y, z])
        self.wait(400)
        return self.pos()

    # ---------------------------------------------------------------- title
    def click_title(self, want=("NEW", "CONTINUE", "PLAY", "START")):
        return self.js("""(wants) => {
          const btns = [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null);
          for (const w of wants) { const b = btns.find(x => (x.textContent||'').toUpperCase().includes(w));
            if (b) { if (b.__activate) b.__activate(); else b.click(); return (b.textContent||'').trim(); } }
          return null; }""", list(want))

    def unlock_all(self):
        return self.js("() => { CRESTBOUND.game.__dev.unlockAll(); return (CRESTBOUND.game._gates||[]).map(g => ({course:g.course, unlocked:g.unlocked, sealed:g.sealed})); }")

    def gates(self):
        return self.js("""() => (CRESTBOUND.game._gates||[]).map(g => ({
            course: g.course, req: g.requires && g.requires.crests, kind: g.kind,
            unlocked: g.unlocked, sealed: g.sealed,
            pos: g.pos ? [+g.pos.x.toFixed(2), +g.pos.y.toFixed(2), +g.pos.z.toFixed(2)] : null,
            exit: g.exitPos ? [+g.exitPos.x.toFixed(2), +g.exitPos.y.toFixed(2), +g.exitPos.z.toFixed(2)] : null,
            yaw: g.yaw != null ? +g.yaw.toFixed(3) : null }))""")

    def defect(self, where, did, happened, should, png, note=""):
        d = {"where": where, "did": did, "happened": happened, "should": should, "png": png}
        if note:
            d["note"] = note
        self.defects.append(d)
        self.say("  ** DEFECT: %s | %s -> %s" % (where, did, happened))
        return d

    def dump(self, name=None):
        p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_play_%s.json" % (name or self.area))
        with open(p, "w", encoding="utf-8") as f:
            json.dump({"area": self.area, "log": self.log, "defects": self.defects,
                       "console": self.console[:60]}, f, indent=1)
        self.say("wrote", p)
        return p
