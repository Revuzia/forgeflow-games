"""PLAYTEST DRIVER - RIME SPIRE 3 "BLIZZARD PEAK" (owner instruction P11).

Drives the shipped page with REAL KeyboardEvents through window, samples
player.__test.state() as it goes, and drops PNGs so the agent can LOOK at what
a player would be looking at.

    python _harness/_play_rime3.py <phase>

Phases: camp west gorge floor flank shoulder cave shrine rings
"""
import json, os, sys, time, math
from playwright.sync_api import sync_playwright

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]
URL = "http://localhost:8788/games/crestbound/index.html?dev=1&quality=low&autoscale=0"

KEYMAP = {"W": "w", "A": "a", "S": "s", "D": "d", "SPACE": " ", "C": "c", "F": "f",
          "E": "e", "Q": "q", "Z": "z", "R": "r", "V": "v", "G": "g", "T": "t",
          "SHIFT": "Shift", "CTRL": "Control", "ESC": "Escape"}

SNAP = r"""() => {
  const G = CRESTBOUND.game, P = G.player;
  const s = P && P.__test ? P.__test.state() : null;
  const col = G._collectibles || null;
  return {
    t: +(G.course ? G.course.clock : 0).toFixed(2),
    gs: G.state, course: G.course && G.course.def ? G.course.def.id : null,
    p: s ? [+s.pos.x.toFixed(2), +s.pos.y.toFixed(2), +s.pos.z.toFixed(2)] : null,
    v: s ? [+s.vel.x.toFixed(2), +s.vel.y.toFixed(2), +s.vel.z.toFixed(2)] : null,
    ps: s ? s.state : null, anim: s ? s.anim : null, gnd: s ? s.grounded : null,
    jc: s ? s.jumpCount : null, sp: s ? +s.speed.toFixed(2) : null,
    face: s ? +s.facing.toFixed(2) : null,
    surf: P ? P.surface : null,
    cam: G.cam ? [+G.cam.yaw.toFixed(2), +G.cam.pitch.toFixed(2), +G.cam.dist.toFixed(2), G.cam.mode] : null,
    coins: col && col.counts ? col.counts.coins : null,
    sig: col && col.counts ? col.counts.sigils : null,
    deaths: G.deaths, cp: G.cpIndex,
    hp: G.hp === undefined ? null : G.hp,
  };
}"""


class P:
    def __init__(self, phase, viewport=(1280, 720)):
        self.phase = phase
        self.shotdir = os.path.join(ROOT, "_shots", "play_rime3")
        os.makedirs(self.shotdir, exist_ok=True)
        self.n = 0
        self.log = []
        self.viewport = viewport
        self._held = set()

    def __enter__(self):
        self._pw = sync_playwright().start()
        self.br = self._pw.chromium.launch(channel="chrome", headless=True, args=FLAGS)
        self.pg = self.br.new_page(viewport={"width": self.viewport[0], "height": self.viewport[1]})
        self.console = []
        self.pg.on("console", lambda m: self.console.append(m.type + ": " + m.text[:240])
                   if m.type in ("error", "warning") else None)
        self.pg.on("pageerror", lambda e: self.console.append("pageerror: " + str(e)[:240]))
        self.pg.goto(URL, wait_until="load", timeout=90000)
        for _ in range(200):
            st = self.pg.evaluate("(globalThis.CRESTBOUND && CRESTBOUND.game) ? CRESTBOUND.game.state : null")
            if st and st != "loading":
                break
            self.pg.wait_for_timeout(400)
        self.pg.wait_for_timeout(1200)
        return self

    def __exit__(self, *a):
        try:
            self.release_all(); self.br.close()
        finally:
            self._pw.stop()

    # ---------------------------------------------------------------- utils
    def js(self, expr, arg=None):
        return self.pg.evaluate(expr, arg) if arg is not None else self.pg.evaluate(expr)

    def wait(self, ms): self.pg.wait_for_timeout(ms)

    def shot(self, what):
        self.n += 1
        p = os.path.join(self.shotdir, "%s_%02d_%s.png" % (self.phase, self.n, what))
        self.pg.screenshot(path=p)
        self.say("   shot", os.path.basename(p))
        return p

    def say(self, *a):
        line = " ".join(str(x) for x in a)
        print(line, flush=True)
        self.log.append(line)

    def snap(self):
        try:
            return self.js(SNAP)
        except Exception as e:
            return {"err": str(e)[:160]}

    def show(self, tag=""):
        s = self.snap()
        self.say("   %-22s p=%s ps=%s gnd=%s sp=%s surf=%s cp=%s deaths=%s coins=%s sig=%s t=%s"
                 % (tag, s.get("p"), s.get("ps"), s.get("gnd"), s.get("sp"), s.get("surf"),
                    s.get("cp"), s.get("deaths"), s.get("coins"), s.get("sig"), s.get("t")))
        return s

    # ---------------------------------------------------------------- input
    def down(self, *keys):
        for k in keys:
            kk = KEYMAP.get(k.upper(), k)
            if kk not in self._held:
                self.pg.keyboard.down(kk); self._held.add(kk)

    def up(self, *keys):
        for k in keys:
            kk = KEYMAP.get(k.upper(), k)
            if kk in self._held:
                self.pg.keyboard.up(kk); self._held.discard(kk)

    def tap(self, k, ms=90):
        self.down(k); self.wait(ms); self.up(k)

    def release_all(self):
        for kk in list(self._held):
            try: self.pg.keyboard.up(kk)
            except Exception: pass
        self._held.clear()

    # -------------------------------------------------------------- camera
    def face(self, x, z):
        """Aim hero + camera at a world XZ (what a player does with the mouse)."""
        return self.js("""([tx,tz]) => { const G=CRESTBOUND.game,P=G.player;
            const dx=tx-P.pos.x, dz=tz-P.pos.z;
            if (dx*dx+dz*dz < 1e-6) return null;
            const yaw=Math.atan2(-dx,-dz);
            P.__test.setFacing(yaw);
            const sl=(G.cam&&typeof G.cam._yawSlide==='number')?G.cam._yawSlide:0;
            if(G.cam){G.cam.yaw=yaw-sl;G.cam._rcHoldT=0;}
            return +yaw.toFixed(3); }""", [x, z])

    def look(self, x, z):
        """Camera only (no hero snap)."""
        return self.js("""([tx,tz]) => { const G=CRESTBOUND.game,P=G.player;
            const dx=tx-P.pos.x, dz=tz-P.pos.z;
            const yaw=Math.atan2(-dx,-dz);
            const sl=(G.cam&&typeof G.cam._yawSlide==='number')?G.cam._yawSlide:0;
            if(G.cam){G.cam.yaw=yaw-sl;G.cam._rcHoldT=0;}
            return +yaw.toFixed(3); }""", [x, z])

    def pitch(self, v):
        return self.js("(v) => { const c = CRESTBOUND.game.cam; if(!c) return null; c.pitch = v; return c.pitch; }", v)

    # ---------------------------------------------------------------- walk
    def walk(self, x, z, tol=1.3, max_ms=12000, keys=("W",), tag="", reaim=240, jump=None):
        """Hold keys toward an XZ target, re-aiming every `reaim` ms. Player-real."""
        self.face(x, z)
        self.down(*keys)
        t0 = time.time(); elapsed = 0; stuck = 0
        prev = self.snap().get("p") or [0, 0, 0]
        d0 = math.hypot(prev[0] - x, prev[2] - z)
        deaths0 = self.snap().get("deaths")
        trail = []
        while elapsed < max_ms:
            self.wait(reaim)
            elapsed = (time.time() - t0) * 1000
            s = self.snap()
            p = s.get("p")
            if not p:
                break
            trail.append(p)
            if s.get("deaths") is not None and deaths0 is not None and s["deaths"] > deaths0:
                self.up(*keys)
                self.say("   *** DEATH during walk to (%.1f,%.1f) at %s ps=%s" % (x, z, prev, s.get("ps")))
                return {"end": p, "dist": None, "died": True, "state": s, "trail": trail}
            d = math.hypot(p[0] - x, p[2] - z)
            if d <= tol:
                break
            moved = math.hypot(p[0] - prev[0], p[2] - prev[2])
            stuck = stuck + 1 if moved < 0.05 else 0
            prev = p
            if stuck >= 8:
                break
            if jump and (int(elapsed) // jump) != (int(elapsed - reaim) // jump):
                self.tap("SPACE", 90)
            self.face(x, z)
        self.up(*keys)
        self.wait(150)
        s = self.snap(); p = s.get("p") or [0, 0, 0]
        d = math.hypot(p[0] - x, p[2] - z)
        res = {"end": p, "dist": round(d, 2), "ms": int(elapsed), "arrived": d <= tol,
               "stuck": stuck >= 8, "died": False, "state": s, "trail": trail}
        self.say("   walk->(%.1f,%.1f)%s end=%s d=%.2f ps=%s %s%s" % (
            x, z, (" " + tag) if tag else "", p, d, s.get("ps"),
            "ARRIVED" if res["arrived"] else "DID-NOT-ARRIVE", " STUCK" if res["stuck"] else ""))
        return res

    def hold(self, keys, ms, tag="", sample=250):
        self.down(*keys)
        t = 0; rows = []
        while t < ms:
            step = min(sample, ms - t); self.wait(step); t += step
            rows.append(self.snap())
        self.up(*keys); self.wait(120)
        s = self.snap()
        self.say("   hold %s %dms %s -> p=%s ps=%s gnd=%s" % ("+".join(keys), ms, tag, s.get("p"), s.get("ps"), s.get("gnd")))
        return rows

    # ---------------------------------------------------------------- setup
    def start(self, course="rime-3", cp=None):
        st = self.js("() => CRESTBOUND.game.state")
        self.say("boot state:", st)
        if st == "title":
            r = self.js("""() => { const b=[...document.querySelectorAll('button')].filter(x=>x.offsetParent!==null)
                .find(x=>(x.textContent||'').toUpperCase().includes('NEW'));
                if(!b) return null; if(b.__activate) b.__activate(); else b.click();
                return (b.textContent||'').trim(); }""")
            self.say("clicked title button:", r)
            for _ in range(60):
                self.wait(400)
                if self.js("() => CRESTBOUND.game.state") not in ("title", "loading"):
                    break
        self.say("state after title:", self.js("() => CRESTBOUND.game.state"))
        for _ in range(40):
            if self.js("() => !!(CRESTBOUND.game && CRESTBOUND.game.__dev)"):
                break
            self.wait(400)
        self.js("() => CRESTBOUND.game.__dev.unlockAll()")
        if cp is None:
            self.js("(c) => CRESTBOUND.game.__dev.goto(c)", course)
        else:
            self.js("([c,i]) => CRESTBOUND.game.__dev.goto(c,i)", [course, cp])
        for _ in range(120):
            self.wait(400)
            s = self.snap()
            if s.get("course") == course and s.get("gs") in ("playing", "cinematic", "card"):
                break
        self.wait(1500)
        s = self.show("loaded")
        return s

    def tp(self, x, y, z):
        self.js("([x,y,z]) => CRESTBOUND.game.__dev.tp(x,y,z)", [x, y, z])
        self.wait(500)
        return self.snap().get("p")

    def dump(self):
        p = os.path.join(HERE, "_play_rime3_%s.json" % self.phase)
        with open(p, "w", encoding="utf-8") as f:
            json.dump({"phase": self.phase, "log": self.log, "console": self.console[:80]}, f, indent=1)
        self.say("wrote", p)


def run(phase, body, tries=3, viewport=(1280, 720)):
    """Run a playtest body, retrying a fresh browser if the renderer dies.

    93 Chrome processes were live on this box while this lane ran; the renderer
    is killed under that pressure, which is contention, not a game defect.
    """
    for k in range(tries):
        try:
            with P(phase, viewport=viewport) as g:
                body(g)
                g.dump()
            return True
        except Exception as ex:
            print("### attempt %d/%d died: %s" % (k + 1, tries, str(ex).splitlines()[0][:180]), flush=True)
            time.sleep(6)
    print("### %s FAILED after %d tries" % (phase, tries), flush=True)
    return False
