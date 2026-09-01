#!/usr/bin/env python
"""ASCENDANT lookcheck — the PRODUCTION-MODE look-lifecycle gate.

Owner report: "When looking around after jumping the camera also resets, more
specifically it looks directly up. Jump, or any other action, should not
affect, or be tied to look around with mouse."

Pitch has exactly ONE writer in the whole runtime: controller._applyLook(),
reached only from player.addLook(), called only from FPCamera._consumeLook()
(verified: grep for `.pitch =` / addLook across runtime/ hits nothing else but
controller._place(), which zeroes it on spawn). So a camera that ends up
staring at the +89 deg clamp got there through a HUGE negative dy on the look
channel. This harness records that channel frame by frame and event by event
so the offending delta can be named instead of guessed at.

What is recorded, per FRAME (wrapped around game.update, so nothing is missed
between frames):
    mdx/mdy      input._mouseDX/_mouseDY as they stood BEFORE input.update()
                 consumed them  (pixels accumulated from mousemove/touch)
    lookdx/dy    input.look after input.update()   (sens-scaled pixels)
    radx/rady    input.lookRad after input.update() (radians)
    padx/pady    input._padLookX/_padLookY          (gamepad stick, px)
    locked / suspended / touchActive / gamepad id
    yaw, pitch and their per-frame deltas
and per EVENT (capture phase, so it lands before input.js's own listener):
    movementX/movementY, isTrusted, whether the pointer was locked.

Sequence: real pointer lock via a real click, many small look steps, a jump
mid-look, land, more look, an ESC/resume relock cycle, and a synthetic
movementY = -900 spike.

Assertions
    1. |dpitch| per frame <= MAX_DPITCH_RAD. A real mouse at sens 1 cannot
       turn more than ~0.35 rad in one frame (that is 160 px of movement).
    2. pitch never parks at the +/-89 deg clamp during the sequence.
    3. yaw/pitch move ONLY on frames that carried look input. A jump, a
       landing, a bounce or a pause must produce exactly zero look change.

Exit 0 only if every assertion holds.

    python lookcheck.py
    python lookcheck.py --stage neon-1 --rounds 3 --keep-open
"""
import argparse
import json
import math
import os
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

PITCH_LIMIT = math.radians(89.0)

# A real mouse at sens 1 moving 160 px in one 16 ms frame is already a violent
# flick; RAD_PER_PX 0.0022 makes that 0.35 rad. Anything past this is not a
# hand.
MAX_DPITCH_RAD = 0.35
MAX_DYAW_RAD = 0.35

# "Parked at the clamp": within a degree of the limit.
CLAMP_EPS_RAD = math.radians(1.0)

# Floating point only; a frame with no look input must not move the view AT ALL.
QUIET_EPS_RAD = 1e-9


INSTRUMENT = r"""() => {
  const A = globalThis.ASCENDANT, g = A && A.game;
  if (!g || !g.input || !g.player) return false;
  if (g.__lookcheck) return true;
  g.__lookcheck = true;

  const inp = g.input, pl = g.player;
  const R = globalThis.__LOOK = {
    on: false, frames: [], events: [], locks: [], marks: [], calls: [],
  };

  /* Every write to yaw/pitch goes through player.addLook (verified: nothing
     else in runtime/ assigns .pitch except controller._place). Log each call
     with the stack so a second, wrongly-scaled consumer names itself. */
  const al = pl.addLook.bind(pl);
  pl.addLook = function (dx, dy) {
    if (R.on) {
      let st = '';
      try { st = (new Error()).stack || ''; } catch (e) {}
      st = st.split('\n').slice(1, 6)
             .map(s => s.trim().replace(/^at\s+/, '')
                        .replace(/https?:\/\/[^\/]+\//, ''))
             .join(' <- ');
      R.calls.push({ frame: R.frames.length, dx: dx, dy: dy, stack: st });
      if (R.calls.length > 20000) R.calls.shift();
    }
    return al(dx, dy);
  };

  /* capture phase: fires before input.js's own document-level mousemove */
  document.addEventListener('mousemove', (e) => {
    if (!R.on) return;
    R.events.push({
      t: performance.now(), frame: R.frames.length,
      mx: e.movementX, my: e.movementY,
      trusted: e.isTrusted,
      locked: !!document.pointerLockElement,
    });
  }, true);

  document.addEventListener('pointerlockchange', () => {
    R.locks.push({ t: performance.now(), frame: R.frames.length,
                   el: !!document.pointerLockElement });
  }, true);

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
      R.frames.push({
        i: R.frames.length, t: performance.now(), dt: dt,
        mdx: rec.mdx, mdy: rec.mdy,
        ldx: rec.ldx, ldy: rec.ldy,
        rdx: rec.rdx, rdy: rec.rdy,
        padx: rec.px, pady: rec.py,
        padOn: !!inp.gamepadConnected, padId: inp.gamepadId || '',
        touch: !!inp.touchActive, hasTouch: !!inp.hasTouch,
        locked: !!inp.locked, susp: !!inp.suspended,
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
    yaw: pl ? pl.yaw : null, pitch: pl ? pl.pitch : null,
    grounded: pl ? !!pl.grounded : null,
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


def deg(r):
    return math.degrees(r)


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

    def boot(self):
        pg = self.pg
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

    def load_stage(self, stage):
        pg = self.pg
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

    def ensure_locked(self, why):
        """A real click on the canvas is a trusted gesture: it takes real lock."""
        pg = self.pg
        if self.snap()["locked"]:
            return True
        for _ in range(5):
            # Pointer lock needs the tab focused AND the gesture trusted.
            try:
                pg.bring_to_front()
            except Exception:
                pass
            pg.mouse.click(self.ANCHOR_X, self.ANCHOR_Y)
            self.x, self.y = self.ANCHOR_X, self.ANCHOR_Y
            pg.wait_for_timeout(900)
            if self.snap()["locked"]:
                return True
            pg.wait_for_timeout(900)   # Chrome's ~1.25 s post-ESC cooldown
        self.fail("could not acquire pointer lock (%s)" % why)
        return False

    def step(self, dx, dy, settle=45):
        """One mouse step. Under lock, movementX/Y is the difference between
        consecutive DISPATCHED positions, so this delivers exactly (dx, dy)."""
        pg = self.pg
        self.x += dx
        self.y += dy
        # Stay inside the viewport: Chrome stops reporting movement once the
        # dispatched position leaves the page.
        if not (20 < self.x < 1240):
            self.x = self.ANCHOR_X
        if not (20 < self.y < 700):
            self.y = self.ANCHOR_Y
        pg.mouse.move(self.x, self.y)
        if settle:
            pg.wait_for_timeout(settle)

    def look_around(self, steps=14, amp=18):
        """Small human-scale look steps, both axes, both directions."""
        for k in range(steps):
            dx = amp if (k % 4) < 2 else -amp
            dy = (amp if (k % 8) < 4 else -amp) * 0.6
            self.step(dx, dy)

    # ---- phases ----------------------------------------------------------
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
        self.ensure_locked("after resume")
        self.mark("look-after-relock")
        self.look_around(steps=12)
        return s

    def phase_phantom_pad(self):
        """A device that enumerates as a gamepad with a resting non-zero axis.

        Real hardware does this: some keyboards, mice, wheels and flight
        sticks expose an uncentred trigger as axes[3], which rests at -1
        rather than 0. input.js adds axes[2]/[3] into look every frame for ANY
        connected pad, so such a device walks the pitch to the clamp with the
        player's hands nowhere near a controller.
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

    def phase_spike(self):
        """A single synthetic movementY = -900 event, exactly the shape a
        hardware/driver glitch or a post-lock repositioning delta takes."""
        pg = self.pg
        self.mark("spike")
        pg.evaluate(r"""() => {
          document.dispatchEvent(new MouseEvent('mousemove', {
            bubbles: true, cancelable: false,
            movementX: 0, movementY: -900,
          }));
        }""")
        pg.wait_for_timeout(300)
        self.mark("after-spike")
        self.look_around(steps=6)

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
        print("  recorded  : %d frames, %d mousemove events, %d lock changes"
              % (len(frames), len(events), len(locks)))
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
            print("      pad x=%.4f y=%.4f connected=%s id=%r | touch=%s hasTouch=%s"
                  % (f["padx"], f["pady"], f["padOn"], f["padId"],
                     f["touch"], f["hasTouch"]))
            print("      locked=%s suspended=%s grounded=%s vy=%.2f died=%s"
                  % (f["locked"], f["susp"], f["grounded"], f["vy"], f["died"]))
            print("      yaw=%.4f (%+.3f deg)  pitch=%.4f (%+.3f deg)  [limit %.3f]"
                  % (f["yaw"], deg(f["dyaw"]), f["pitch"], deg(f["dpitch"]),
                     PITCH_LIMIT))
            evs = by_frame.get(f["i"], []) + by_frame.get(f["i"] + 1, [])
            if evs:
                print("      mousemove events at this frame:")
                for e in evs[:12]:
                    print("        movementX=%s movementY=%s trusted=%s locked=%s"
                          % (e["mx"], e["my"], e["trusted"], e["locked"]))
            cs = calls_by_frame.get(f["i"], [])
            if cs:
                print("      player.addLook() calls on this frame (RADIANS "
                      "expected):")
                for c in cs[:8]:
                    print("        dx=%-12.6f dy=%-12.6f  %s"
                          % (c["dx"], c["dy"], c["stack"]))

        # 1 ── per-frame slam -------------------------------------------------
        slams = 0
        for f in frames:
            if f["died"] or f["state"] not in ("playing", "hub"):
                continue
            if abs(f["dpitch"]) > MAX_DPITCH_RAD:
                slams += 1
                if slams <= 4:
                    dump(f, "PITCH SLAM: %+.2f deg in one frame (limit %.2f deg)"
                         % (deg(f["dpitch"]), deg(MAX_DPITCH_RAD)))
            elif abs(f["dyaw"]) > MAX_DYAW_RAD:
                slams += 1
                if slams <= 4:
                    dump(f, "YAW SLAM: %+.2f deg in one frame (limit %.2f deg)"
                         % (deg(f["dyaw"]), deg(MAX_DYAW_RAD)))
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
            if f["died"] or f["state"] not in ("playing", "hub"):
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

        # 4 ── a phantom gamepad must not move the view ----------------------
        ph = [f for f in frames if f["mark"] == "phantom-pad"]
        if ph:
            drift = ph[-1]["pitch"] - ph[0]["pitch"]
            ydrift = ph[-1]["yaw"] - ph[0]["yaw"]
            print("  phantom pad window: %d frames, pitch %+.2f deg, yaw %+.2f deg"
                  % (len(ph), deg(drift), deg(ydrift)))
            if abs(drift) > math.radians(1.0) or abs(ydrift) > math.radians(1.0):
                dump(ph[len(ph) // 2],
                     "PHANTOM GAMEPAD DRIVES LOOK: pitch drifted %+.2f deg, yaw "
                     "%+.2f deg with no player input at all"
                     % (deg(drift), deg(ydrift)))
                self.fail("a gamepad that never moved a stick drove the camera "
                          "%.1f deg of pitch in %d frames" % (deg(drift), len(ph)))

        # ---- always-on forensics -------------------------------------------
        big = sorted((e for e in events if e["mx"] is not None),
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
            print("  player.addLook() call sites (%d calls):" % len(calls))
            for st, s in sorted(sites.items(), key=lambda kv: -kv[1]["max"]):
                print("      n=%-5d largest |delta| = %.5f rad (%.2f deg)  %s"
                      % (s["n"], s["max"], deg(s["max"]), st or "<no stack>"))
        worst = max(frames, key=lambda f: abs(f["dpitch"]))
        print("  worst frame dpitch: %+.3f deg (frame %d, mark=%s)"
              % (deg(worst["dpitch"]), worst["i"], worst["mark"]))
        pr = [f["pitch"] for f in frames]
        print("  pitch range: %.2f .. %.2f deg (clamp at +/-89)"
              % (deg(min(pr)), deg(max(pr))))
        pads_seen = sorted({f["padId"] for f in frames if f["padOn"]})
        print("  gamepads active during the run: %s" % (pads_seen or "none"))
        padframes = [f for f in frames if f["padx"] or f["pady"]]
        if padframes:
            print("  WARNING: %d frame(s) carried gamepad look (id=%r, last "
                  "x=%.3f y=%.3f)" % (len(padframes), padframes[-1]["padId"],
                                      padframes[-1]["padx"], padframes[-1]["pady"]))


def touch_probe(br, args, has_touch):
    """A touchscreen laptop whose player uses a MOUSE.

    input.js decides `hasTouch` from capability sniffing alone
    (_detectCoarsePointer: `(pointer: coarse)` OR ontouchstart+maxTouchPoints),
    and hasTouch short-circuits _onMouseDown and _onPointerDownDom. The
    question this answers is whether that leaves a mouse-using player on a
    touchscreen laptop unable to take pointer lock.

    INFORMATIONAL — it does NOT gate. Measured 2026-09-01: with has_touch=True
    the click still takes lock (game.js:1058 _requestLockSoon drives the lock
    on state transitions, so _onPointerDownDom is not the only path), but the
    result is order-sensitive: a touch context created as the fourth context
    of a long-lived browser failed to lock and so did nothing else about it.
    Run the has_touch=False control alongside it and only believe a
    difference that survives a fresh browser.

    Returns (hasTouch, locked_after_a_real_click) or None if the probe could
    not run.
    """
    ctx = br.new_context(viewport={"width": args.width, "height": args.height},
                         has_touch=has_touch, is_mobile=False)
    pg = ctx.new_page()
    try:
        pg.goto(args.url, wait_until="load", timeout=60_000)
    except Exception as e:
        print("  touch probe: navigation failed (%s)" % e)
        ctx.close()
        return None
    lk = Look(pg, args)
    if not lk.boot():
        print("  touch probe: could not reach gameplay")
        ctx.close()
        return None
    info = pg.evaluate("(() => { const i = ASCENDANT.game.input;"
                       " return { hasTouch: !!i.hasTouch,"
                       " coarse: matchMedia('(pointer: coarse)').matches,"
                       " maxTouch: navigator.maxTouchPoints,"
                       " onTouchStart: ('ontouchstart' in window) }; })()")
    try:
        pg.bring_to_front()
    except Exception:
        pass
    pg.mouse.click(640, 400)
    pg.wait_for_timeout(1200)
    locked = pg.evaluate("!!ASCENDANT.game.input.locked")
    print("  probe[has_touch=%-5s]: input.hasTouch=%-5s (coarse=%s "
          "maxTouchPoints=%s ontouchstart=%s) -> a real mouse click %s "
          "pointer lock"
          % (has_touch, info["hasTouch"], info["coarse"], info["maxTouch"],
             info["onTouchStart"], "TOOK" if locked else "did NOT take"))
    ctx.close()
    return (info["hasTouch"], locked)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--stage", default="neon-1")
    ap.add_argument("--rounds", type=int, default=3)
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    ap.add_argument("--keep-open", action="store_true")
    ap.add_argument("--touch-probe", action="store_true",
                    help="also boot a touch-capable context and check whether a "
                         "real mouse click can still take pointer lock")
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
        if not lk.boot():
            print("FAILED to reach gameplay from the title", file=sys.stderr)
            br.close()
            return 2
        if not pg.evaluate(INSTRUMENT):
            print("FAILED to install the look instrument", file=sys.stderr)
            br.close()
            return 2
        if not lk.load_stage(args.stage):
            print("FAILED to load stage %s" % args.stage, file=sys.stderr)
            br.close()
            return 2

        s = lk.snap()
        print("  entered: stage=%s state=%s devNoSuspend=%s"
              % (s["stageId"], s["state"], s["devNoSuspend"]))
        if s["devNoSuspend"]:
            print("REFUSING: devNoSuspend is set — this is not production mode.",
                  file=sys.stderr)
            br.close()
            return 2
        print("  gamepads at start: %s" % json.dumps(pg.evaluate(PADS)))

        if not lk.ensure_locked("initial"):
            print("FAILED: no real pointer lock — the prod path cannot be tested",
                  file=sys.stderr)
            br.close()
            return 2

        lk.arm(True)
        lk.mark("armed")
        pg.wait_for_timeout(400)
        for n in range(args.rounds):
            print("  round %d: look / jump / look-in-air / land / look" % n)
            lk.phase_jump_round(n)
        print("  esc -> resume -> relock -> look")
        lk.phase_esc_resume()
        print("  synthetic movementY=-900 spike")
        lk.phase_spike()
        print("  phantom gamepad with an uncentred resting axis")
        lk.phase_phantom_pad()
        lk.arm(False)

        lk.analyse()
        if args.touch_probe:
            print("  touchscreen-laptop probe — INFORMATIONAL, does not gate. "
                  "The has_touch=False run is the control; a difference is only "
                  "real if it survives a fresh browser (see touch_probe docs).")
            touch_probe(br, args, False)
            touch_probe(br, args, True)
        if lk.args.keep_open:
            pg.wait_for_timeout(20_000)
        br.close()

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
