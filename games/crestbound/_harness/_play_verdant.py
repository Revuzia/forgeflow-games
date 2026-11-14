"""CRESTBOUND playtest driver — VERDANT BAILEY (verdant-1/2/3).

A PLAYER, not a gate. Everything here goes through the same doors a human uses:
the title button is clicked, movement is real KeyboardEvents through the window,
and the only shortcuts are `__dev.unlockAll()` (so I do not have to earn 13 gates
before I can look at verdant-3) and `__dev.goto(course)` / `__dev.tp` to cross a
map I have already walked once. Every teleport is followed by walking.

Usage:  python _harness/_play_verdant.py <scene> [--headed]
Scenes are registered in SCENES at the bottom.

Design notes
------------
* The recorder is installed as an `engine.onFrame` hook, so it samples at the
  render rate rather than at the Playwright round-trip rate: a 0.3 s jump window
  is invisible to a 120 ms poll.
* `press()` uses page.keyboard, which dispatches real KeyboardEvents with the
  right `code` on the focused document — the same path a player's keyboard takes.
* Times are wall-clock on purpose: a human presses on wall time. Where a
  measurement has to be frame-exact it reads the recorder instead.
"""
import sys, os, json, time, math
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]
URL = "http://localhost:8788/games/crestbound/index.html?dev=1&quality=low&autoscale=0"

RECORDER = r"""
(() => {
  const G = CRESTBOUND.game, E = CRESTBOUND.engine;
  if (G.__rec) return 'already';
  const R = { frames: 0, maxY: -1e9, minY: 1e9, maxJump: 0, states: [], jumps: [],
              events: [], y0: null, startT: performance.now(), lastState: null,
              maxSpeed: 0, deaths: 0, crests: [], coins0: null, sig0: null };
  G.__rec = R;
  const p = G.player;
  R.y0 = p ? p.pos.y : 0;
  // hook the player's own event emitter — this is what the HUD listens to
  const ev = p && p.events;
  if (ev && ev.on) {
    for (const name of ['jump','land','death','wallkick','dive','pound','poundLand','splash',
                        'surface','bounce','longjump','backflip','sideflip','bonk','checkpoint',
                        'collect','climbStart','climbEnd','ringPass','cannonEnter']) {
      ev.on(name, (a) => { R.events.push({ t: +((performance.now()-R.startT)/1000).toFixed(3), e: name,
                                           d: (typeof a === 'string' || typeof a === 'number') ? a : undefined }); });
    }
  }
  R.hook = (dt) => {
    const p = G.player; if (!p) return;
    R.frames++;
    if (p.pos.y > R.maxY) R.maxY = p.pos.y;
    if (p.pos.y < R.minY) R.minY = p.pos.y;
    if (p.jumpCount > R.maxJump) R.maxJump = p.jumpCount;
    if (p.speed > R.maxSpeed) R.maxSpeed = p.speed;
    if (p.state !== R.lastState) {
      R.lastState = p.state;
      R.states.push({ t: +((performance.now()-R.startT)/1000).toFixed(3), s: p.state,
                      y: +p.pos.y.toFixed(2), jc: p.jumpCount, sp: +p.speed.toFixed(2) });
      if (R.states.length > 400) R.states.shift();
    }
  };
  E.onFrame(R.hook);
  return 'ok';
})()
"""


class Play:
    def __init__(self, pg, tag):
        self.pg = pg
        self.tag = tag
        self.n = 0
        self.shotdir = os.path.join(GAME, "_shots", "play_" + tag)
        os.makedirs(self.shotdir, exist_ok=True)
        self.notes = []
        self.held = set()

    # ---------- plumbing ----------
    def ev(self, js, arg=None):
        return self.pg.evaluate(js, arg) if arg is not None else self.pg.evaluate(js)

    def wait(self, ms):
        self.pg.wait_for_timeout(ms)

    def shot(self, what):
        self.n += 1
        path = os.path.join(self.shotdir, "%02d_%s.png" % (self.n, what))
        self.pg.screenshot(path=path)
        rel = path.replace("\\", "/")
        print("   SHOT %s" % rel)
        return rel

    def say(self, msg):
        print("   " + msg)
        self.notes.append(msg)

    # ---------- input ----------
    def down(self, key):
        self.pg.keyboard.down(key); self.held.add(key)

    def up(self, key):
        try: self.pg.keyboard.up(key)
        except Exception: pass
        self.held.discard(key)

    def release_all(self):
        for k in list(self.held): self.up(k)

    def tap(self, key, ms=90):
        self.down(key); self.wait(ms); self.up(key)

    def walk(self, key="w", ms=1000, also=None):
        """Hold a movement key for ms of wall time — a real held key."""
        keys = [key] + list(also or [])
        for k in keys: self.down(k)
        self.wait(ms)
        for k in keys: self.up(k)

    # ---------- state ----------
    def st(self):
        return self.ev("""() => { const G=CRESTBOUND.game, p=G.player;
          return { gs:G.state, course:G.courseId, x:+p.pos.x.toFixed(2), y:+p.pos.y.toFixed(2), z:+p.pos.z.toFixed(2),
                   sp:+p.speed.toFixed(2), st:p.state, anim:p.anim, gr:!!p.grounded, jc:p.jumpCount,
                   vy:+p.vel.y.toFixed(2), water:!!p.inWater, sub:!!p.submerged, surf:p.surface||null,
                   deaths:G.deaths, cp:G.cpIndex,
                   coins:(G._collectibles&&G._collectibles.counts)?G._collectibles.counts.coins:null,
                   sig:(G._collectibles&&G._collectibles.counts)?G._collectibles.counts.sigils:null,
                   crests:(G._collectibles&&G._collectibles.counts)?G._collectibles.counts.crests:null }; }""")

    def rec_reset(self):
        self.ev("""() => { const R=CRESTBOUND.game.__rec; if(!R) return; R.frames=0; R.maxY=-1e9; R.minY=1e9;
            R.maxJump=0; R.states.length=0; R.events.length=0; R.maxSpeed=0; R.startT=performance.now();
            R.lastState=null; }""")

    def rec(self):
        return self.ev("""() => { const R=CRESTBOUND.game.__rec; if(!R) return null;
            return { frames:R.frames, maxY:+R.maxY.toFixed(2), minY:+R.minY.toFixed(2), maxJump:R.maxJump,
                     maxSpeed:+R.maxSpeed.toFixed(2), states:R.states.slice(-60), events:R.events.slice(-60) }; }""")

    def tp(self, x, y, z, yaw=None):
        self.ev("""([x,y,z,yaw]) => { const G=CRESTBOUND.game;
            G.player.__test.teleport({x,y,z}); G.player.__test.setVel({x:0,y:0,z:0});
            if (yaw !== null) { G.player.__test.setFacing(yaw); if(G.cam){G.cam.yaw=yaw; G.cam._rcHoldT=0;} }
            return 1; }""", [x, y, z, yaw])
        self.wait(250)

    def face(self, yaw):
        self.ev("""(yaw) => { const G=CRESTBOUND.game; G.player.__test.setFacing(yaw);
            if(G.cam){G.cam.yaw=yaw; G.cam._rcHoldT=0;} return 1; }""", yaw)
        self.wait(120)

    def face_toward(self, x, z):
        return self.ev("""([tx,tz]) => { const G=CRESTBOUND.game, p=G.player;
            const yaw=Math.atan2(-(tx-p.pos.x), -(tz-p.pos.z));
            p.__test.setFacing(yaw); if(G.cam){G.cam.yaw=yaw; G.cam._rcHoldT=0;} return +yaw.toFixed(3); }""",
            [x, z])

    def goto(self, course):
        self.ev("(c) => CRESTBOUND.game.__dev.goto(c)", course)
        for _ in range(80):
            self.wait(250)
            s = self.ev("() => CRESTBOUND.game.state")
            if s in ("playing", "keep"):
                break
        self.wait(1200)
        self.ev(RECORDER)

    # ---------- higher-level player moves ----------
    def human_jump_chain(self, n=3, run_ms=900, gap_ms=None, run_key="w"):
        """Press jump n times at a natural rhythm while running forward.

        gap_ms: wall time between PRESSES. A single jump is ~0.62 s of air, so a
        human chaining lands and presses again around 0.60-0.75 s. Default 660.
        """
        gap = gap_ms or 660
        self.rec_reset()
        self.down(run_key)
        self.wait(run_ms)              # build a real run-up first, as a player does
        for i in range(n):
            self.tap("Space", 110)
            if i < n - 1:
                self.wait(max(0, gap - 110))
        self.wait(900)
        self.up(run_key)
        self.wait(400)
        return self.rec()


def boot(p, headed=False, tag="v"):
    br = p.chromium.launch(channel="chrome", headless=not headed, args=FLAGS)
    pg = br.new_page(viewport={"width": 1280, "height": 720})
    errs = []
    pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
    pg.on("console", lambda m: errs.append("CONSOLE." + m.type + " " + m.text) if m.type == "error" else None)
    pg.goto(URL, wait_until="load", timeout=60000)
    for _ in range(160):
        if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.course)"): break
        pg.wait_for_timeout(500)
    pg.wait_for_timeout(1500)
    clicked = pg.evaluate("""() => {
      const btns=[...document.querySelectorAll('button')].filter(b=>b.offsetParent!==null);
      for (const want of ['NEW','CONTINUE','PLAY','START']) {
        const b=btns.find(x=>(x.textContent||'').toUpperCase().includes(want));
        if (b) { if (b.__activate) b.__activate(); else b.click(); return (b.textContent||'').trim(); }
      }
      return null; }""")
    pg.wait_for_timeout(2000)
    pg.evaluate("() => CRESTBOUND.game.__dev.unlockAll()")
    pg.wait_for_timeout(400)
    print("booted; clicked '%s'; state=%s" % (clicked, pg.evaluate("()=>CRESTBOUND.game.state")))
    pl = Play(pg, tag)
    pg.evaluate(RECORDER)
    return br, pg, pl, errs
