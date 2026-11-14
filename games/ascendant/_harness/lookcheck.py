#!/usr/bin/env python
"""ASCENDANT lookcheck — the PRODUCTION-MODE look-lifecycle gate.

Owner report: "When looking around after jumping the camera also resets, more
specifically it looks directly up. Jump, or any other action, should not
affect, or be tied to look around with mouse."

yaw/pitch have exactly ONE writer in the whole runtime: Player._applyLook()
(controller.js). It is reached from player.addLook() — which FPCamera calls
with RADIANS — and, in the shipped code, from a standalone fallback inside
Player.update() that fed it `input.look` (sens-scaled PIXELS) whenever the
camera had not called addLook for 0.5 s. That is why "after a jump" mattered:
lining up a jump and landing is half a second without mouse input, and the
next 18 px flick then landed as 18 RADIANS. This harness hooks _applyLook and
records the look channel frame by frame and event by event so the offending
delta names its own call site instead of being guessed at.

What is recorded, per FRAME (wrapped around game.update, so nothing is missed):
    mdx/mdy      input._mouseDX/_mouseDY as they stood BEFORE input.update()
                 consumed them  (pixels accumulated from mousemove/touch)
    lookdx/dy    input.look after input.update()   (sens-scaled pixels)
    radx/rady    input.lookRad after input.update() (radians)
    padx/pady    input._padLookX/_padLookY          (gamepad stick, px)
    locked / suspended / touchActive / gamepad id / pad armed / lock settle
    yaw, pitch and their per-frame deltas
and per EVENT (capture phase, so it lands before input.js's own listener):
    movementX/movementY, isTrusted, whether the pointer was locked.

Sequence (main browser, plain mouse context):
    real pointer lock via a real click
    postlock0   the FIRST mousemove after lock carries a 600 px delta — the
                shape of the repositioning delta Chromium can emit on the
                event right after pointer lock engages
    3 rounds    look / JUMP mid-look / look in the air / land / look
    esc         ESC -> resume -> relock -> postlock1 (600 px first event) -> look
    flick       24 events of 45 px with no pauses: a real 136 deg flick must
                arrive in full — this is the regression guard for the caps
    spike       ONE trusted movementX = -900 event (a driver glitch) must be
                bounded, and ONE untrusted (script-dispatched) movementY = -900
                event must move nothing
    phantom     a device that enumerates as a gamepad with an uncentred axis
                must not drive look
Then two fresh-browser touch probes:
    laptop      touch-CAPABLE but fine-pointer (a touchscreen laptop with a
                mouse): a mouse click must take lock, script-dispatched touches
                must move nothing, and touching the screen must NOT raise the
                phone controls — those are for mobile only
    phone       coarse-pointer context: a REAL (CDP) touch drag must still
                turn the view — the trusted-only guard must not break touch

Assertions
    1. |dpitch|, |dyaw| per frame <= MAX_DELTA_RAD (0.35 rad) outside the
       phases that deliberately exceed it. A real mouse at sens 1 cannot turn
       more than ~0.35 rad in one 16 ms frame (that is 160 px of movement).
    2. pitch never parks at the +/-89 deg clamp.
    3. yaw/pitch move ONLY on frames that carried look input. A jump, a
       landing, a bounce or a pause must produce exactly zero look change.
    4. postlock: the first event after a lock acquisition moves nothing.
    5. flick: the full turn arrives (within 3%).
    6. trusted spike: bounded by MAX_EVENT_RAD, not dropped.
       untrusted spike: exactly zero.
    7. phantom gamepad: zero drift.
    8. touch probes as above.

Exit 0 only if every assertion holds.

    python lookcheck.py
    python lookcheck.py --stage neon-1 --rounds 3 --keep-open
    python lookcheck.py --url http://localhost:8789/games/ascendant/index.html
"""
import argparse
import json
import math
import sys
import time

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

DEFAULT_URL = "http://localhost:8788/games/ascendant/index.html"   # NO ?dev=1

FLAGS = [
    "--ignore-gpu-blocklist",
    "--use-angle=d3d11",
    "--disable-gpu-sandbox",
    "--enable-gpu-rasterization",
    "--disable-features=CalculateNativeWinOcclusion",
    "--autoplay-policy=no-user-gesture-required",
]

RAD_PER_PX = 0.0022                      # core/input.js RAD_PER_PX
PITCH_LIMIT = math.radians(89.0)

# A real mouse at sens 1 moving 160 px in one 16 ms frame is already a violent
# flick; RAD_PER_PX 0.0022 makes that 0.35 rad. Anything past this is not a
# hand — in the phases that do not deliberately exceed it.
MAX_DELTA_RAD = 0.35

# core/input.js MAX_EVENT_RAD: the most ONE mousemove event may turn the view.
MAX_EVENT_RAD = 0.5

# "Parked at the clamp": within a degree of the limit.
CLAMP_EPS_RAD = math.radians(1.0)

# Floating point only; a frame with no look input must not move the view AT ALL.
QUIET_EPS_RAD = 1e-9

POSTLOCK_PX = 600          # the synthetic "first event after lock" delta
FLICK_STEPS = 24
FLICK_PX = 45              # 24 x 45 = 1080 px = 2.376 rad = 136 deg
FLICK_TOL = 0.03

# Marks whose frames are judged by their own rule rather than assertion 1.
SPECIAL_MARKS = ("postlock0", "postlock1", "flick", "spike-trusted")


INSTRUMENT = r"""() => {
  const A = globalThis.ASCENDANT, g = A && A.game;
  if (!g || !g.input || !g.player) return false;
  if (g.__lookcheck) return true;
  g.__lookcheck = true;

  const inp = g.input, pl = g.player;
  const R = globalThis.__LOOK = {
    on: false, frames: [], events: [], locks: [], marks: [], calls: [],
  };

  /* THE writer. Every change to yaw/pitch goes through Player._applyLook —
     from addLook (the camera) or from Player.update's standalone fallback.
     Log each call with its stack so a wrongly-scaled caller names itself. */
  const apl = pl._applyLook.bind(pl);
  pl._applyLook = function (dx, dy) {
    if (R.on) {
      let st = '';
      try { st = (new Error()).stack || ''; } catch (e) {}
      st = st.split('\n').slice(2, 6)
             .map(s => s.trim().replace(/^at\s+/, '')
                        .replace(/https?:\/\/[^\/]+\//, ''))
             .join(' <- ');
      R.calls.push({ frame: R.frames.length, dx: dx, dy: dy, stack: st });
      if (R.calls.length > 20000) R.calls.shift();
    }
    return apl(dx, dy);
  };

  /* capture phase: fires before input.js's own document-level listener */
  document.addEventListener('mousemove', (e) => {
    if (!R.on) return;
    R.events.push({
      t: performance.now(), frame: R.frames.length, kind: 'mouse',
      mx: e.movementX, my: e.movementY,
      trusted: e.isTrusted,
      locked: !!document.pointerLockElement,
    });
  }, true);
  window.addEventListener('touchmove', (e) => {
    if (!R.on) return;
    const t = e.changedTouches && e.changedTouches[0];
    R.events.push({
      t: performance.now(), frame: R.frames.length, kind: 'touch',
      mx: t ? t.clientX : null, my: t ? t.clientY : null,
      trusted: e.isTrusted, locked: !!document.pointerLockElement,
    });
  }, true);

  document.addEventListener('pointerlockchange', () => {
    R.locks.push({ t: performance.now(), frame: R.frames.length,
                   el: !!document.pointerLockElement });
  }, true);
  document.addEventListener('pointerlockerror', () => {
    R.locks.push({ t: performance.now(), frame: R.frames.length, err: true });
  }, true);

  /* Every pointer-lock REQUEST and how it ended, so "could not acquire
     pointer lock" can say why (no user activation, pending request, focus). */
  R.requests = [];
  const dom = inp.dom;
  if (dom && typeof dom.requestPointerLock === 'function') {
    const orig = dom.requestPointerLock.bind(dom);
    dom.requestPointerLock = function (opts) {
      const rec = { t: performance.now(), frame: R.frames.length,
                    active: !!(navigator.userActivation && navigator.userActivation.isActive),
                    focus: document.hasFocus(), vis: document.visibilityState,
                    opts: opts ? JSON.stringify(opts) : '', result: 'pending' };
      R.requests.push(rec);
      let p;
      try { p = orig(opts); } catch (e) { rec.result = 'throw: ' + e; throw e; }
      if (p && typeof p.then === 'function') {
        p.then(() => { rec.result = 'ok'; }, (e) => { rec.result = 'rejected: ' + (e && e.message || e); });
      } else rec.result = 'sync';
      return p;
    };
  }

  /* pre-consumption accumulators + the post-update look block */
  const rec = { mdx: 0, mdy: 0, ldx: 0, ldy: 0, rdx: 0, rdy: 0, px: 0, py: 0 };
  const iu = inp.update.bind(inp);
  inp.update = function (dt) {
    rec.mdx = inp._mouseDX; rec.mdy = inp._mouseDY;
    const r = iu(dt);
    rec.ldx = inp.look.dx;    rec.ldy = inp.look.dy;
    rec.rdx = inp.lookRad.dx; rec.rdy = inp.lookRad.dy;
    rec.px  = inp._padLookX;  rec.py  = inp._padLookY;
    return r;
  };

  const gu = g.update.bind(g);
  g.update = function (dt) {
    const y0 = pl.yaw, p0 = pl.pitch;
    const d0 = (pl.stats && pl.stats.deaths) || 0;
    const r = gu(dt);
    if (R.on) {
      const dr = inp.lookDrops || null;
      R.frames.push({
        i: R.frames.length, t: performance.now(), dt: dt,
        mdx: rec.mdx, mdy: rec.mdy,
        ldx: rec.ldx, ldy: rec.ldy,
        rdx: rec.rdx, rdy: rec.rdy,
        padx: rec.px, pady: rec.py,
        padOn: !!inp.gamepadConnected, padId: inp.gamepadId || '',
        padArmed: !!inp.padLookArmed,
        touch: !!inp.touchActive, hasTouch: !!inp.hasTouch,
        locked: !!inp.locked, susp: !!inp.suspended,
        settle: inp._lockSettle | 0,
        drops: dr ? { untrusted: dr.untrusted, settle: dr.settle, clamped: dr.clamped, frame: dr.frame } : null,
        yaw: pl.yaw, pitch: pl.pitch,
        dyaw: pl.yaw - y0, dpitch: pl.pitch - p0,
        died: ((pl.stats && pl.stats.deaths) || 0) !== d0,
        grounded: !!pl.grounded, vy: pl.vel.y,
        state: g.state, deathT: g._deathT, introT: g._introT,
        mark: R.marks.length ? R.marks[R.marks.length - 1] : '',
      });
      if (R.frames.length > 60000) R.frames.shift();
    }
    return r;
  };
  return true;
}"""

SNAP = r"""() => {
  const g = globalThis.ASCENDANT && ASCENDANT.game;
  if (!g) return null;
  const inp = g.input, pl = g.player;
  return {
    state: g.state, stageId: g.stageId,
    locked: !!(inp && inp.locked), susp: !!(inp && inp.suspended),
    devNoSuspend: !!(inp && inp.devNoSuspend),
    menuIsOpen: !!(g.menu && g.menu.isOpen),
    hasTouch: !!(inp && inp.hasTouch), touchSeen: !!(inp && inp.touchSeen),
    touchUI: !!document.getElementById('asc-touch'),
    yaw: pl ? pl.yaw : null, pitch: pl ? pl.pitch : null,
    grounded: pl ? !!pl.grounded : null,
    sens: inp ? inp.sensitivity : null,
  };
}"""

PADS = r"""() => {
  let pads = [];
  try { pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : []; }
  catch (e) { return { err: String(e) }; }
  return pads.filter(Boolean).map(p => ({
    index: p.index, id: p.id, connected: !!p.connected, mapping: p.mapping,
    axes: Array.from(p.axes || []),
  }));
}"""

RESUME_BTN = r"""() => {
  for (const b of document.querySelectorAll('button.asc-btn')) {
    const r = b.getBoundingClientRect();
    if (r.width < 20 || r.height < 8 || b.disabled) continue;
    if ((b.textContent || '').toUpperCase().indexOf('RESUME') >= 0)
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }
  return null;
}"""

# A touchscreen laptop: the PRIMARY pointer is fine (mouse/touchpad) but the
# machine is touch-capable. Playwright's has_touch flips (pointer: coarse) to
# true, which is a phone, so model the laptop's capability sniff directly.
LAPTOP_INIT = r"""() => {
  try { Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5, configurable: true }); } catch (e) {}
  try { if (!('ontouchstart' in window)) window.ontouchstart = null; } catch (e) {}
}"""

SYNTH_TOUCH = r"""(args) => {
  const el = document.elementFromPoint(args.x, args.y) || document.body;
  const mk = (type, x, y) => {
    const t = new Touch({ identifier: 7, target: el, clientX: x, clientY: y,
                          pageX: x, pageY: y, screenX: x, screenY: y });
    return new TouchEvent(type, { bubbles: true, cancelable: true,
      touches: type === 'touchend' ? [] : [t], targetTouches: type === 'touchend' ? [] : [t],
      changedTouches: [t] });
  };
  el.dispatchEvent(mk('touchstart', args.x, args.y));
  for (let i = 1; i <= 6; i++) el.dispatchEvent(mk('touchmove', args.x + args.dx * i / 6, args.y + args.dy * i / 6));
  el.dispatchEvent(mk('touchend', args.x + args.dx, args.y + args.dy));
  return el.id || el.tagName;
}"""


def deg(r):
    return math.degrees(r)


def boot(pg):
    deadline = time.time() + 60
    while time.time() < deadline:
        try:
            if pg.evaluate("!!(globalThis.ASCENDANT && ASCENDANT.game)"):
                break
        except Exception:
            pass
        pg.wait_for_timeout(300)
    else:
        return False
    pg.wait_for_timeout(4500)
    # The #boot splash eats real clicks; drive the title menu directly.
    try:
        pg.evaluate("ASCENDANT.game.menu._act('play')")
    except Exception:
        pg.keyboard.press("Enter")
    deadline = time.time() + 30
    while time.time() < deadline:
        st = pg.evaluate("ASCENDANT.game.state")
        if st not in ("title", "loading"):
            return True
        pg.wait_for_timeout(400)
    return False


def load_stage(pg, stage):
    pg.evaluate("ASCENDANT.game.loadStage(%s)" % json.dumps(stage))
    deadline = time.time() + 60
    while time.time() < deadline:
        if pg.evaluate("ASCENDANT.game.stageId") == stage:
            break
        pg.wait_for_timeout(400)
    else:
        return False
    pg.wait_for_timeout(4000)
    return True


class Look:
    ANCHOR_X = 640.0
    ANCHOR_Y = 400.0

    def __init__(self, pg, args):
        self.pg = pg
        self.args = args
        self.fails = []
        self.x = self.ANCHOR_X
        self.y = self.ANCHOR_Y

    # ---- plumbing --------------------------------------------------------
    def snap(self):
        return self.pg.evaluate(SNAP)

    def fail(self, msg):
        self.fails.append(msg)
        print("    FAIL  %s" % msg)

    def mark(self, label):
        self.pg.evaluate("globalThis.__LOOK.marks.push(%s)" % json.dumps(label))

    def arm(self, on=True):
        self.pg.evaluate("globalThis.__LOOK.on = %s" % ("true" if on else "false"))

    def ensure_locked(self, why):
        """A real click on the canvas is a trusted gesture: it takes real lock."""
        pg = self.pg
        if self.snap()["locked"]:
            return True
        for _ in range(5):
            # Another window stealing focus pauses the game (on blur, correctly)
            # and a click on the pause menu is not a click on the canvas: get
            # the game live again before asking it for lock.
            settle_live(pg)
            pg.mouse.click(self.ANCHOR_X, self.ANCHOR_Y)
            self.x, self.y = self.ANCHOR_X, self.ANCHOR_Y
            pg.wait_for_timeout(900)
            if self.snap()["locked"]:
                return True
            pg.wait_for_timeout(900)   # Chrome's ~1.25 s post-ESC cooldown
        self.fail("could not acquire pointer lock (%s)" % why)
        try:
            reqs = pg.evaluate("(globalThis.__LOOK && globalThis.__LOOK.requests) || []")
            locks = pg.evaluate("(globalThis.__LOOK && globalThis.__LOOK.locks) || []")
            print("      pointer-lock requests seen (%d):" % len(reqs))
            for r in reqs[-8:]:
                print("        t=%.0f activation=%s focus=%s vis=%s opts=%s -> %s"
                      % (r["t"], r["active"], r["focus"], r["vis"], r["opts"], r["result"]))
            print("      lock events: %s" % json.dumps(locks[-8:]))
        except Exception as e:
            print("      (no request log: %s)" % e)
        return False

    def move_to(self, x, y, settle=45):
        """Under lock, movementX/Y is the difference between consecutive
        DISPATCHED positions, so this delivers exactly (x - self.x, y - self.y)."""
        self.x, self.y = float(x), float(y)
        self.pg.mouse.move(self.x, self.y)
        if settle:
            self.pg.wait_for_timeout(settle)

    def step(self, dx, dy, settle=45):
        nx, ny = self.x + dx, self.y + dy
        # Stay inside the viewport: Chrome stops reporting movement once the
        # dispatched position leaves the page.
        if not (20 < nx < 1240):
            nx = self.ANCHOR_X
        if not (20 < ny < 700):
            ny = self.ANCHOR_Y
        self.move_to(nx, ny, settle)

    def walk_x(self, target, step_px=90):
        """Reach an x position in steps small enough for assertion 1."""
        while abs(target - self.x) > 0.5:
            d = target - self.x
            d = max(-step_px, min(step_px, d))
            self.move_to(self.x + d, self.y, 40)

    def look_around(self, steps=14, amp=18):
        """Small human-scale look steps, both axes, both directions."""
        for k in range(steps):
            dx = amp if (k % 4) < 2 else -amp
            dy = (amp if (k % 8) < 4 else -amp) * 0.6
            self.step(dx, dy)

    # ---- phases ----------------------------------------------------------
    def phase_postlock(self, n):
        """The FIRST mousemove after a lock acquisition carries a big delta."""
        self.mark("postlock%d" % n)
        nx = self.x + POSTLOCK_PX if self.x + POSTLOCK_PX < 1240 else self.x - POSTLOCK_PX
        self.move_to(nx, self.y, 300)

    def phase_jump_round(self, n):
        pg = self.pg
        self.mark("round%d.look" % n)
        self.look_around()
        self.mark("round%d.jump" % n)
        pg.keyboard.press("Space")
        pg.wait_for_timeout(60)
        self.mark("round%d.look-in-air" % n)
        self.look_around(steps=8)
        self.mark("round%d.land" % n)
        pg.wait_for_timeout(700)
        self.mark("round%d.look-after-land" % n)
        self.look_around(steps=10)

    def phase_esc_resume(self):
        pg = self.pg
        self.mark("esc")
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(700)
        s = self.snap()
        self.mark("resume")
        btn = pg.evaluate(RESUME_BTN)
        if btn:
            pg.mouse.click(btn["x"], btn["y"])
            self.x, self.y = btn["x"], btn["y"]
        else:
            pg.evaluate("(() => { const g = ASCENDANT.game;"
                        " if (g.state === 'paused') g.resume(); })()")
        pg.wait_for_timeout(900)
        self.mark("relock")
        ok = self.ensure_locked("after resume")
        if ok:
            pg.wait_for_timeout(300)
            self.phase_postlock(1)
        self.mark("look-after-relock")
        self.look_around(steps=12)
        return s

    def phase_flick(self):
        """A real flick: many mid-size events with no pauses between them."""
        self.mark("flick-prep")
        self.walk_x(100)
        self.pg.wait_for_timeout(200)
        self.mark("flick")
        for _ in range(FLICK_STEPS):
            self.move_to(self.x + FLICK_PX, self.y, 0)
        self.pg.wait_for_timeout(400)

    def phase_spikes(self):
        pg = self.pg
        self.mark("spike-prep")
        self.walk_x(1200)
        pg.wait_for_timeout(200)
        self.mark("spike-trusted")
        self.move_to(300, self.y, 350)          # ONE trusted movementX = -900
        self.mark("spike-untrusted")
        pg.evaluate(r"""() => {
          document.dispatchEvent(new MouseEvent('mousemove', {
            bubbles: true, cancelable: false,
            movementX: 0, movementY: -900,
          }));
        }""")
        pg.wait_for_timeout(350)
        self.mark("after-spike")
        self.look_around(steps=6)

    def phase_phantom_pad(self):
        """A device that enumerates as a gamepad with a resting non-zero axis.

        Real hardware does this: some keyboards, mice, wheels and flight
        sticks expose an uncentred trigger as axes[3], which rests at -1
        rather than 0.
        """
        pg = self.pg
        self.mark("phantom-pad")
        pg.evaluate(r"""() => {
          const btn = () => ({ pressed: false, touched: false, value: 0 });
          const fake = {
            index: 0, id: 'PHANTOM 0000:0000 (uncentred axis)', connected: true,
            mapping: 'standard', timestamp: performance.now(),
            axes: [0, 0, 0, -1],
            buttons: Array.from({ length: 18 }, btn),
          };
          globalThis.__REALPADS = navigator.getGamepads.bind(navigator);
          navigator.getGamepads = () => [fake];
        }""")
        pg.wait_for_timeout(1500)          # no mouse input at all in this window
        self.mark("phantom-pad-end")
        pg.evaluate(r"""() => {
          if (globalThis.__REALPADS) navigator.getGamepads = globalThis.__REALPADS;
        }""")
        pg.wait_for_timeout(300)

    # ---- verdict ---------------------------------------------------------
    def analyse(self):
        pg = self.pg
        data = pg.evaluate("(() => ({ frames: globalThis.__LOOK.frames,"
                           " events: globalThis.__LOOK.events,"
                           " locks: globalThis.__LOOK.locks,"
                           " calls: globalThis.__LOOK.calls }))()")
        frames = data["frames"]
        events = data["events"]
        locks = data["locks"]
        calls = data["calls"]
        print("  recorded  : %d frames, %d move events, %d lock changes, %d _applyLook calls"
              % (len(frames), len(events), len(locks), len(calls)))
        if not frames:
            self.fail("no frames recorded — the instrument never ran")
            return

        by_frame = {}
        for e in events:
            by_frame.setdefault(e["frame"], []).append(e)
        calls_by_frame = {}
        for c in calls:
            calls_by_frame.setdefault(c["frame"], []).append(c)

        def dump(f, why):
            print("    %s" % why)
            print("      frame %d  t=%.1f dt=%.4f  mark=%s  state=%s"
                  % (f["i"], f["t"], f["dt"], f["mark"], f["state"]))
            print("      mouseAccum dx=%.3f dy=%.3f | look dx=%.3f dy=%.3f | "
                  "rad dx=%.5f dy=%.5f" % (f["mdx"], f["mdy"], f["ldx"], f["ldy"],
                                           f["rdx"], f["rdy"]))
            print("      pad x=%.4f y=%.4f connected=%s armed=%s id=%r | touch=%s hasTouch=%s"
                  % (f["padx"], f["pady"], f["padOn"], f["padArmed"], f["padId"],
                     f["touch"], f["hasTouch"]))
            print("      locked=%s suspended=%s settle=%d drops=%s grounded=%s vy=%.2f died=%s"
                  % (f["locked"], f["susp"], f["settle"], f["drops"], f["grounded"],
                     f["vy"], f["died"]))
            print("      yaw=%.4f (%+.3f deg)  pitch=%.4f (%+.3f deg)  [limit %.3f]"
                  % (f["yaw"], deg(f["dyaw"]), f["pitch"], deg(f["dpitch"]),
                     PITCH_LIMIT))
            evs = by_frame.get(f["i"], []) + by_frame.get(f["i"] + 1, [])
            if evs:
                print("      move events at this frame:")
                for e in evs[:12]:
                    print("        %s movementX=%s movementY=%s trusted=%s locked=%s"
                          % (e["kind"], e["mx"], e["my"], e["trusted"], e["locked"]))
            cs = calls_by_frame.get(f["i"], [])
            if cs:
                print("      Player._applyLook() calls on this frame (RADIANS):")
                for c in cs[:8]:
                    print("        dx=%-12.6f dy=%-12.6f  %s"
                          % (c["dx"], c["dy"], c["stack"]))

        def live(f):
            return not f["died"] and f["state"] in ("playing", "hub")

        def in_mark(f, m):
            return f["mark"] == m

        # 1 ── per-frame slam -------------------------------------------------
        slams = 0
        for f in frames:
            if not live(f) or f["mark"] in SPECIAL_MARKS:
                continue
            if abs(f["dpitch"]) > MAX_DELTA_RAD:
                slams += 1
                if slams <= 4:
                    dump(f, "PITCH SLAM: %+.2f deg in one frame (limit %.2f deg)"
                         % (deg(f["dpitch"]), deg(MAX_DELTA_RAD)))
            elif abs(f["dyaw"]) > MAX_DELTA_RAD:
                slams += 1
                if slams <= 4:
                    dump(f, "YAW SLAM: %+.2f deg in one frame (limit %.2f deg)"
                         % (deg(f["dyaw"]), deg(MAX_DELTA_RAD)))
        if slams:
            self.fail("%d frame(s) moved the view further than a hand can in one "
                      "frame" % slams)

        # 2 ── parked at the clamp -------------------------------------------
        pinned = [f for f in frames
                  if f["state"] in ("playing", "hub")
                  and abs(f["pitch"]) > PITCH_LIMIT - CLAMP_EPS_RAD]
        if pinned:
            dump(pinned[0], "PITCH PINNED at the clamp (%d frames): %.2f deg"
                 % (len(pinned), deg(pinned[0]["pitch"])))
            self.fail("pitch reached the +/-89 deg clamp on %d frame(s) — the "
                      "camera was slammed to look straight up/down" % len(pinned))

        # 3 ── the view moved on a frame with no look input -------------------
        quiet_bad = []
        for f in frames:
            if not live(f):
                continue
            has_input = (f["mdx"] or f["mdy"] or f["padx"] or f["pady"])
            if has_input:
                continue
            if abs(f["dpitch"]) > QUIET_EPS_RAD or abs(f["dyaw"]) > QUIET_EPS_RAD:
                quiet_bad.append(f)
        if quiet_bad:
            for f in quiet_bad[:3]:
                dump(f, "VIEW MOVED WITH NO LOOK INPUT")
            self.fail("%d frame(s) changed yaw/pitch with zero look input — some "
                      "non-mouse action is tied to look" % len(quiet_bad))

        # 4 ── first event after a lock acquisition ---------------------------
        for m in ("postlock0", "postlock1"):
            fs = [f for f in frames if in_mark(f, m)]
            if not fs:
                continue
            moved = sum(abs(f["dyaw"]) + abs(f["dpitch"]) for f in fs)
            evs = [e for f in fs for e in by_frame.get(f["i"], []) + by_frame.get(f["i"] + 1, [])]
            big = max((abs(e["mx"] or 0) for e in evs if e["kind"] == "mouse"), default=0)
            print("  %-10s first event after lock carried %d px -> view moved %.2f deg"
                  % (m + ":", big, deg(moved)))
            if moved > QUIET_EPS_RAD:
                worst = max(fs, key=lambda f: abs(f["dyaw"]) + abs(f["dpitch"]))
                dump(worst, "POST-LOCK DELTA REACHED LOOK (%s): %.2f deg" % (m, deg(moved)))
                self.fail("%s: the first movement event after pointer lock moved the "
                          "view %.2f deg (must be dropped)" % (m, deg(moved)))

        # 5 ── a real flick arrives in full -----------------------------------
        fs = [f for f in frames if in_mark(f, "flick")]
        if fs:
            got = sum(f["dyaw"] for f in fs)
            sens = self.snap().get("sens") or 1
            want = -FLICK_STEPS * FLICK_PX * RAD_PER_PX * sens
            print("  flick     : %d events x %d px over %d frames -> yaw %+.2f deg "
                  "(expected %+.2f deg)" % (FLICK_STEPS, FLICK_PX, len(fs), deg(got), deg(want)))
            if abs(got - want) > abs(want) * FLICK_TOL:
                worst = max(fs, key=lambda f: abs(f["mdx"]))
                dump(worst, "FLICK CLIPPED: got %+.2f deg of %+.2f" % (deg(got), deg(want)))
                self.fail("a real %.0f deg flick arrived as %.0f deg — a look cap is "
                          "clipping human input" % (deg(abs(want)), deg(abs(got))))

        # 6 ── spikes ---------------------------------------------------------
        fs = [f for f in frames if in_mark(f, "spike-trusted")]
        if fs:
            got = sum(abs(f["dyaw"]) for f in fs)
            print("  spike     : trusted movementX=-900 -> yaw moved %.2f deg "
                  "(bound %.2f deg, must be > 0)" % (deg(got), deg(MAX_EVENT_RAD)))
            if got > MAX_EVENT_RAD + 1e-6:
                dump(max(fs, key=lambda f: abs(f["dyaw"])),
                     "TRUSTED SPIKE NOT BOUNDED: %.2f deg" % deg(got))
                self.fail("one trusted 900 px event turned the view %.2f deg (bound %.2f)"
                          % (deg(got), deg(MAX_EVENT_RAD)))
            elif got <= QUIET_EPS_RAD:
                self.fail("a trusted 900 px event was dropped outright — a real "
                          "(if extreme) flick must be bounded, not discarded")
        fs = [f for f in frames if in_mark(f, "spike-untrusted")]
        if fs:
            got = sum(abs(f["dpitch"]) + abs(f["dyaw"]) for f in fs)
            print("  spike     : UNTRUSTED movementY=-900 -> view moved %.2f deg (must be 0)"
                  % deg(got))
            if got > QUIET_EPS_RAD:
                dump(max(fs, key=lambda f: abs(f["dpitch"])),
                     "UNTRUSTED EVENT REACHED LOOK: %.2f deg" % deg(got))
                self.fail("a script-dispatched (untrusted) mousemove turned the view "
                          "%.2f deg" % deg(got))

        # 7 ── a phantom gamepad must not move the view ----------------------
        ph = [f for f in frames if f["mark"] == "phantom-pad"]
        if ph:
            drift = ph[-1]["pitch"] - ph[0]["pitch"]
            ydrift = ph[-1]["yaw"] - ph[0]["yaw"]
            print("  phantom   : %d frames, pitch %+.2f deg, yaw %+.2f deg, armed=%s"
                  % (len(ph), deg(drift), deg(ydrift), ph[-1]["padArmed"]))
            if abs(drift) > math.radians(1.0) or abs(ydrift) > math.radians(1.0):
                dump(ph[len(ph) // 2],
                     "PHANTOM GAMEPAD DRIVES LOOK: pitch drifted %+.2f deg, yaw "
                     "%+.2f deg with no player input at all"
                     % (deg(drift), deg(ydrift)))
                self.fail("a gamepad that never moved a stick drove the camera "
                          "%.1f deg of pitch in %d frames" % (deg(drift), len(ph)))

        # ---- always-on forensics -------------------------------------------
        for lk in locks:
            if not lk.get("el"):
                continue
            after = [e for e in events if e["t"] > lk["t"]][:3]
            print("  lock at frame %d: first events after it: %s"
                  % (lk["frame"], ", ".join("(%s,%s trusted=%s)" % (e["mx"], e["my"], e["trusted"])
                                            for e in after) or "none"))
        big = sorted((e for e in events if e["kind"] == "mouse" and e["mx"] is not None),
                     key=lambda e: -max(abs(e["mx"] or 0), abs(e["my"] or 0)))[:5]
        if big:
            print("  largest mousemove events seen:")
            for e in big:
                print("      movementX=%-7s movementY=%-7s trusted=%s locked=%s "
                      "frame=%d" % (e["mx"], e["my"], e["trusted"], e["locked"],
                                    e["frame"]))
        if calls:
            sites = {}
            for c in calls:
                s = sites.setdefault(c["stack"], {"n": 0, "max": 0.0})
                s["n"] += 1
                s["max"] = max(s["max"], abs(c["dx"]), abs(c["dy"]))
            print("  Player._applyLook() call sites (%d calls):" % len(calls))
            for st, s in sorted(sites.items(), key=lambda kv: -kv[1]["max"]):
                print("      n=%-5d largest |delta| = %.5f rad (%.2f deg)  %s"
                      % (s["n"], s["max"], deg(s["max"]), st or "<no stack>"))
        worst = max(frames, key=lambda f: abs(f["dpitch"]))
        print("  worst frame dpitch: %+.3f deg (frame %d, mark=%s)"
              % (deg(worst["dpitch"]), worst["i"], worst["mark"]))
        pr = [f["pitch"] for f in frames]
        print("  pitch range: %.2f .. %.2f deg (clamp at +/-89)"
              % (deg(min(pr)), deg(max(pr))))
        last = frames[-1]
        if last["drops"]:
            print("  input.lookDrops at end: %s" % last["drops"])
        pads_seen = sorted({f["padId"] for f in frames if f["padOn"]})
        print("  gamepads active during the run: %s" % (pads_seen or "none"))


def settle_live(pg):
    """Bring the page forward and get it out of a pause.

    A second browser window opening while the first closes shuffles OS focus,
    and the game pauses on blur (correctly). That is the environment, not the
    game, so a probe puts the game back into live play before it measures.
    """
    try:
        pg.bring_to_front()
    except Exception:
        pass
    pg.wait_for_timeout(300)
    for _ in range(3):
        s = pg.evaluate(SNAP)
        if s["state"] in ("playing", "hub") and not s["menuIsOpen"]:
            return True
        btn = pg.evaluate(RESUME_BTN)
        if btn:
            pg.mouse.click(btn["x"], btn["y"])
        else:
            pg.evaluate("(() => { const g = ASCENDANT.game;"
                        " if (g.state === 'paused') g.resume(); })()")
        pg.wait_for_timeout(700)
    return False


def touch_probe(p, args, fails):
    """Two fresh browsers: a touchscreen LAPTOP and a PHONE."""
    # ---- laptop: fine pointer, touch-capable ----------------------------
    br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
    ctx = br.new_context(viewport={"width": args.width, "height": args.height},
                         has_touch=False, is_mobile=False)
    ctx.add_init_script("(" + LAPTOP_INIT + ")()")
    pg = ctx.new_page()
    try:
        pg.goto(args.url, wait_until="load", timeout=60_000)
        if not boot(pg):
            fails.append("laptop probe: could not reach gameplay")
            return
        pg.evaluate(INSTRUMENT)
        if not load_stage(pg, args.stage):
            fails.append("laptop probe: could not load %s" % args.stage)
            return
        info = pg.evaluate("(() => { const i = ASCENDANT.game.input;"
                           " return { hasTouch: !!i.hasTouch, touchSeen: !!i.touchSeen,"
                           " ui: !!document.getElementById('asc-touch'),"
                           " coarse: matchMedia('(pointer: coarse)').matches,"
                           " maxTouch: navigator.maxTouchPoints,"
                           " onTouchStart: ('ontouchstart' in window) }; })()")
        print("  laptop    : coarse=%s maxTouchPoints=%s ontouchstart=%s -> input.hasTouch=%s "
              "touchUI=%s (before any touch)"
              % (info["coarse"], info["maxTouch"], info["onTouchStart"], info["hasTouch"], info["ui"]))
        if info["hasTouch"] or info["ui"]:
            fails.append("laptop: capability sniffing alone put a mouse user into touch "
                         "mode (hasTouch=%s, touch UI=%s) before any touch was seen"
                         % (info["hasTouch"], info["ui"]))
        lk = Look(pg, args)
        if not settle_live(pg):
            print("  laptop    : game is %s — could not get it live" % pg.evaluate(SNAP)["state"])
        locked = lk.ensure_locked("laptop mouse click")
        print("  laptop    : a real mouse click %s pointer lock" % ("TOOK" if locked else "did NOT take"))
        if not locked:
            fails.append("laptop: a real mouse click did not take pointer lock")
        # a script-dispatched touch must not drive look; it may arm touch mode
        pg.evaluate("globalThis.__LOOK.on = true; globalThis.__LOOK.marks.push('synth-touch')")
        s0 = pg.evaluate(SNAP)
        pg.evaluate(SYNTH_TOUCH, {"x": 900, "y": 360, "dx": 240, "dy": 120})
        pg.wait_for_timeout(300)
        pg.evaluate(SYNTH_TOUCH, {"x": 900, "y": 360, "dx": 240, "dy": 120})
        pg.wait_for_timeout(300)
        s1 = pg.evaluate(SNAP)
        moved = abs(s1["yaw"] - s0["yaw"]) + abs(s1["pitch"] - s0["pitch"])
        print("  laptop    : after script-dispatched touches: hasTouch=%s touchUI=%s, view moved %.3f deg"
              % (s1["hasTouch"], s1["touchUI"], deg(moved)))
        if moved > QUIET_EPS_RAD:
            fails.append("laptop: script-dispatched (untrusted) touch events turned the view %.2f deg"
                         % deg(moved))
        if s1["hasTouch"] or s1["touchUI"]:
            fails.append("laptop: touching a fine-pointer machine raised the phone controls "
                         "(hasTouch=%s touchUI=%s) — the on-screen stick is for mobile only"
                         % (s1["hasTouch"], s1["touchUI"]))
    finally:
        ctx.close()
        br.close()

    # ---- phone: coarse pointer, REAL (CDP) touch drag ---------------------
    br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
    ctx = br.new_context(viewport={"width": args.width, "height": args.height},
                         has_touch=True, is_mobile=False)
    pg = ctx.new_page()
    try:
        pg.goto(args.url, wait_until="load", timeout=60_000)
        if not boot(pg):
            fails.append("phone probe: could not reach gameplay")
            return
        pg.evaluate(INSTRUMENT)
        if not load_stage(pg, args.stage):
            fails.append("phone probe: could not load %s" % args.stage)
            return
        live = settle_live(pg)
        s0 = pg.evaluate(SNAP)
        print("  phone     : hasTouch=%s touchUI=%s state=%s locked=%s"
              % (s0["hasTouch"], s0["touchUI"], s0["state"], s0["locked"]))
        if not s0["hasTouch"] or not s0["touchUI"]:
            fails.append("phone: a coarse-pointer device did not get touch mode")
        if not live:
            fails.append("phone: could not get the game into live play (state=%s)" % s0["state"])
            return
        cdp = ctx.new_cdp_session(pg)
        x, y = 900, 360
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y, "id": 1}]})
        pg.wait_for_timeout(120)
        s1 = pg.evaluate(SNAP)
        for i in range(1, 9):
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove",
                     "touchPoints": [{"x": x + 30 * i, "y": y, "id": 1}]})
            pg.wait_for_timeout(40)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        pg.wait_for_timeout(300)
        s2 = pg.evaluate(SNAP)
        sens = pg.evaluate("ASCENDANT.game.input.touchLookSens * ASCENDANT.game.input.sensitivity")
        want = -240 * sens * RAD_PER_PX
        got = s2["yaw"] - s1["yaw"]
        print("  phone     : real touch drag of 240 px -> yaw %+.2f deg (expected %+.2f deg)"
              % (deg(got), deg(want)))
        if abs(got - want) > abs(want) * 0.1 + 1e-6:
            fails.append("phone: a real touch drag turned the view %.2f deg, expected %.2f — "
                         "touch look is broken" % (deg(got), deg(want)))
    finally:
        ctx.close()
        br.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--stage", default="neon-1")
    ap.add_argument("--rounds", type=int, default=3)
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--keep-open", action="store_true")
    ap.add_argument("--no-touch", action="store_true", help="skip the two touch probes")
    ap.add_argument("--touch-only", action="store_true", help="run only the two touch probes")
    args = ap.parse_args()

    if "dev=1" in args.url:
        print("REFUSING: lookcheck must run in PRODUCTION mode. Dev mode makes "
              "input suspension-immune, which hides the whole input-lifecycle "
              "bug class.", file=sys.stderr)
        return 2

    print("=" * 72)
    print("ASCENDANT lookcheck  (PRODUCTION mode - no ?dev=1)")
    print("URL    : %s" % args.url)
    print("stage  : %s   rounds: %d" % (args.stage, args.rounds))
    print("=" * 72)

    errors = []
    with sync_playwright() as p:
        if args.touch_only:
            fails = []
            touch_probe(p, args, fails)
            print("-" * 72)
            if fails:
                print("LOOKCHECK FAILED  (%d)" % len(fails))
                for f in fails:
                    print("   - %s" % f)
                return 1
            print("LOOKCHECK OK  (touch probes only)")
            return 0

        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": args.width, "height": args.height})
        pg.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
        try:
            pg.goto(args.url, wait_until="load", timeout=60_000)
        except Exception as e:
            print("NAVIGATION FAILED: %s" % e, file=sys.stderr)
            br.close()
            return 2

        lk = Look(pg, args)
        if not boot(pg):
            print("FAILED to reach gameplay from the title", file=sys.stderr)
            br.close()
            return 2
        if not pg.evaluate(INSTRUMENT):
            print("FAILED to install the look instrument", file=sys.stderr)
            br.close()
            return 2
        if not load_stage(pg, args.stage):
            print("FAILED to load stage %s" % args.stage, file=sys.stderr)
            br.close()
            return 2

        settle_live(pg)
        s = lk.snap()
        print("  entered: stage=%s state=%s devNoSuspend=%s sens=%s"
              % (s["stageId"], s["state"], s["devNoSuspend"], s["sens"]))
        if s["devNoSuspend"]:
            print("REFUSING: devNoSuspend is set — this is not production mode.",
                  file=sys.stderr)
            br.close()
            return 2
        print("  gamepads at start: %s" % json.dumps(pg.evaluate(PADS)))

        lk.arm(True)
        lk.mark("prelock")
        if not lk.ensure_locked("initial"):
            print("FAILED: no real pointer lock — the prod path cannot be tested",
                  file=sys.stderr)
            br.close()
            return 2
        pg.wait_for_timeout(400)
        print("  first event after lock: %d px" % POSTLOCK_PX)
        lk.phase_postlock(0)
        lk.mark("armed")
        pg.wait_for_timeout(300)
        for n in range(args.rounds):
            print("  round %d: look / jump / look-in-air / land / look" % n)
            lk.phase_jump_round(n)
        print("  esc -> resume -> relock -> first event %d px -> look" % POSTLOCK_PX)
        lk.phase_esc_resume()
        print("  flick: %d x %d px, no pauses" % (FLICK_STEPS, FLICK_PX))
        lk.phase_flick()
        print("  spikes: trusted movementX=-900, untrusted movementY=-900")
        lk.phase_spikes()
        print("  phantom gamepad with an uncentred resting axis")
        lk.phase_phantom_pad()
        lk.arm(False)

        lk.analyse()
        if lk.args.keep_open:
            pg.wait_for_timeout(20_000)
        br.close()

        if not args.no_touch:
            print("  touch probes (fresh browsers): touchscreen laptop, then phone")
            try:
                touch_probe(p, args, lk.fails)
            except Exception as e:
                lk.fails.append("touch probe crashed: %s" % e)

    print("-" * 72)
    for e in errors:
        print("  page error: %s" % e)
    if lk.fails or errors:
        print("LOOKCHECK FAILED  (%d)" % (len(lk.fails) + len(errors)))
        for f in lk.fails:
            print("   - %s" % f)
        return 1
    print("LOOKCHECK OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
