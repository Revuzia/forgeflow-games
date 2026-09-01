#!/usr/bin/env python
"""ASCENDANT lifecheck — the PRODUCTION-MODE pointer-lock lifecycle gate.

Every other harness runs with ?dev=1, where input is suspension-immune
(input.js setSuspended early-returns on devNoSuspend). That immunity was added
to unblock automation and it also blinds automation to this entire class of
bug: the ESC / pointer-lock / suspend lifecycle only misbehaves in PRODUCTION
mode. Three player-reported faults lived here undetected:

  1. the camera snapped 90 deg on every respawn (authored yaw fed to the
     controller without converting conventions),
  2. the pause menu closed itself the instant it opened (one physical ESC
     reached the pause TOGGLE twice - once as the keypress, once as the
     pointer-lock loss it caused),
  3. jump could stop responding after an ESC (input.suspended was owned by two
     independent writers that could desync).

So this harness runs WITHOUT ?dev=1 and drives the real thing: a real click on
the canvas takes genuine pointer lock, and a real Escape keypress drops it
exactly the way a player's does.

    python lifecheck.py
    python lifecheck.py --cycles 12 --stage neon-1 --throttle 20

--throttle applies CDP CPU throttling for the ESC window. The toggle race was
decided by whether a frame landed in the ~30 ms between the keydown and the
browser's pointerlockchange, so it reproduced 5/5 at 20x and 0/5 at 1x. Testing
only at full speed tests only the lucky ordering.

Exit 0 only if every cycle passes and the respawn heading is correct.
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

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_URL = "http://localhost:8788/games/ascendant/index.html"   # NO ?dev=1

FLAGS = [
    "--ignore-gpu-blocklist",
    "--use-angle=d3d11",
    "--disable-gpu-sandbox",
    "--enable-gpu-rasterization",
    "--disable-features=CalculateNativeWinOcclusion",
    "--autoplay-policy=no-user-gesture-required",
]

YAW_TOLERANCE_DEG = 5.0
JUMP_WINDOW_MS = 300
MENU_ASSERT_MS = 600

# A jump is proven by the controller's OWN record that it executed one
# (player.stats.jumps), corroborated by real upward motion. vel.y is only a
# corroborator because it cannot be sampled exactly at launch: the peak is
# ~5.0 m/s and gravity removes ~0.42 m/s per frame, so a few slow frames after
# an ESC cycle legitimately read 3.8 on a jump that plainly happened (counter
# +1, player airborne). The two populations are far apart and unambiguous —
# a live jump reads 3.2 to 5.0 with the counter incrementing; a jump killed by
# a stuck suspension reads -0.23 with the counter flat — so the floor sits
# between them rather than at the launch velocity.
JUMP_MIN_VY = 2.0

# Sampling vel.y from a setInterval is unreliable the moment the page is
# throttled - the sampler starves and misses the launch frame, which reads as a
# dead jump. Sample inside the frame loop instead, where every frame is seen.
INSTRUMENT = r"""() => {
  const A = globalThis.ASCENDANT, g = A && A.game;
  if (!g) return false;
  if (g.__lifecheck) return true;
  g.__lifecheck = true;
  const up = g.update.bind(g);
  globalThis.__VY = -1e9;
  g.update = function (dt) {
    const r = up(dt);
    if (g.player && g.player.vel.y > globalThis.__VY) globalThis.__VY = g.player.vel.y;
    return r;
  };
  globalThis.__VYRESET = () => { globalThis.__VY = -1e9; };
  return true;
}"""

SNAP = r"""() => {
  const A = globalThis.ASCENDANT, g = A && A.game;
  if (!g) return null;
  const el = document.getElementById('asc-menu') ||
             document.querySelector('[class*="asc-menu"]');
  let menuVisible = null;
  if (el) {
    const cs = getComputedStyle(el);
    menuVisible = cs.display !== 'none' && cs.visibility !== 'hidden' &&
                  parseFloat(cs.opacity) > 0.05;
  }
  return {
    state: g.state,
    menuIsOpen: !!(g.menu && g.menu.isOpen),
    menuVisible: menuVisible,
    selectOpen: !!(g.stageSelect && g.stageSelect.isOpen) || !!g._selectOpen,
    finishOpen: !!(g.hud && g.hud.finishOpen),
    suspended: !!(g.input && g.input.suspended),
    locked: !!(g.input && g.input.locked),
    devNoSuspend: !!(g.input && g.input.devNoSuspend),
    deathT: g._deathT, introT: g._introT,
    yaw: g.player ? g.player.yaw : null,
    jumps: g.player && g.player.stats ? g.player.stats.jumps : null,
    grounded: g.player ? !!g.player.grounded : null,
    stageId: g.stageId,
  };
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


def wrap_deg(deg):
    """Signed angle difference folded into (-180, 180]."""
    d = (deg + 180.0) % 360.0 - 180.0
    return d + 360.0 if d <= -180.0 else d


class Life:
    def __init__(self, pg, cdp, args):
        self.pg = pg
        self.cdp = cdp
        self.args = args
        self.fails = []

    def snap(self):
        return self.pg.evaluate(SNAP)

    def fail(self, cycle, msg):
        self.fails.append("cycle %s: %s" % (cycle, msg))
        print("      FAIL  %s" % msg)

    # ---- setup -----------------------------------------------------------
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
        # The #boot splash sits over the title at z-index 60 and eats real
        # clicks, so start the run from the keyboard: Enter activates the
        # focused NEW RUN / CONTINUE. It is a trusted gesture either way.
        pg.wait_for_timeout(4500)
        pg.keyboard.press("Enter")
        deadline = time.time() + 30
        while time.time() < deadline:
            if pg.evaluate("ASCENDANT.game.state") in ("playing", "hub"):
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
            pg.wait_for_timeout(500)
        else:
            return False
        pg.wait_for_timeout(4000)
        return True

    def ensure_locked(self, cycle, why):
        """A real click on the canvas is a trusted gesture and takes real lock."""
        pg = self.pg
        if self.snap()["locked"]:
            return True
        for _ in range(3):
            pg.mouse.click(640, 400)
            pg.wait_for_timeout(900)
            if self.snap()["locked"]:
                return True
            # Chrome enforces a ~1.25 s cooldown after an ESC-driven exit.
            pg.wait_for_timeout(900)
        self.fail(cycle, "could not acquire pointer lock (%s)" % why)
        return False

    ANCHOR_X = 640.0
    MAX_STEP_PX = 500.0

    def _sweep_px(self, delta_px):
        """Turn the view by one clean movementX delta of exactly `delta_px`.

        Under pointer lock, movementX is the difference between consecutive
        DISPATCHED positions (verified directly: a 25 px ramp reports
        movementX 25 on every event, with clientX pinned at 0). So park on an
        anchor, let that repositioning delta be consumed, then make ONE move —
        the delta is then exactly what was asked for, independent of how the
        events happen to batch into frames.

        Returns the yaw change actually produced, in radians.
        """
        pg = self.pg
        delta_px = max(-self.MAX_STEP_PX, min(self.MAX_STEP_PX, delta_px))
        pg.mouse.move(self.ANCHOR_X, 400)
        pg.wait_for_timeout(140)                 # absorb the repositioning delta
        y0 = pg.evaluate("ASCENDANT.game.player.yaw")
        pg.mouse.move(self.ANCHOR_X + delta_px, 400)
        pg.wait_for_timeout(200)
        return pg.evaluate("ASCENDANT.game.player.yaw") - y0

    def look(self, radians):
        """Turn the view by `radians`, closing the loop on what actually happened.

        The yaw produced per pixel of movementX is NOT a constant under
        synthetic events — it varies with the size of the delta (measured:
        ~0.001 rad/px for a small step, ~1 rad/px for a 500+ px one; the same
        on unmodified code, so it is a property of the harness's input path,
        not of this fix). Rather than trust any single calibration, steer:
        take a step, measure it, re-estimate, repeat. Returns radians turned.
        """
        total = 0.0
        gain = self.look_gain               # SIGNED: the controller does yaw -= dx,
        for _ in range(25):                 # so a rightward delta lowers yaw.
            remain = radians - total
            if abs(remain) <= math.radians(4):
                break
            px = remain / gain
            px = max(-self.MAX_STEP_PX, min(self.MAX_STEP_PX, px))
            if abs(px) < 1.0:
                px = 1.0 if px >= 0 else -1.0
            got = self._sweep_px(px)
            total += got
            if abs(got) > 1e-7:
                # learn the response at the magnitude actually in use, sign included
                gain = 0.5 * gain + 0.5 * (got / px)
            if abs(gain) < 1e-9:
                break
        self.look_gain = gain
        return total

    def calibrate(self):
        """Seed the look gain and prove the camera tracks the mouse at all."""
        self.look_gain = -0.0022
        probe = 120.0
        d = self._sweep_px(probe)
        if abs(d) < 1e-6:
            print("  look calibration : NO RESPONSE - camera is not tracking the mouse")
            return False
        self.look_gain = d / probe
        print("  look calibration : seed %+.6f rad/px (%+.2f deg for a %d px delta)"
              % (self.look_gain, math.degrees(d), int(probe)))
        self._sweep_px(-probe)          # undo, so cycle 0 starts from spawn heading
        return True

    def jump(self):
        """Returns (max vel.y within the window, jumps counter delta)."""
        pg = self.pg
        pg.evaluate("globalThis.__VYRESET()")
        j0 = pg.evaluate("ASCENDANT.game.player.stats.jumps")
        pg.keyboard.press("Space")
        pg.wait_for_timeout(JUMP_WINDOW_MS)
        vy = pg.evaluate("globalThis.__VY")
        dj = pg.evaluate("ASCENDANT.game.player.stats.jumps") - j0
        return vy, dj

    # ---- the cycle -------------------------------------------------------
    def recover(self):
        """Put the game back into plain live gameplay before the next cycle.

        Only ever runs BETWEEN cycles, never inside an assertion — a cycle that
        wedges the game must not turn the following eleven into a cascade of
        'could not acquire pointer lock', which buries the one failure that
        actually explains what broke.
        """
        pg = self.pg
        for _ in range(3):
            s = self.snap()
            if s["state"] in ("playing", "hub") and not s["menuIsOpen"]:
                break
            btn = pg.evaluate(RESUME_BTN)
            if btn:
                pg.mouse.click(btn["x"], btn["y"])
            else:
                pg.evaluate("(() => { const g = ASCENDANT.game;"
                            " if (g.state === 'paused') g.resume(); })()")
            pg.wait_for_timeout(900)

    def cycle(self, i):
        pg, cdp = self.pg, self.cdp
        print("  cycle %d" % i)
        self.recover()
        if not self.ensure_locked(i, "cycle start"):
            return

        yaw_start = pg.evaluate("ASCENDANT.game.player.yaw")

        # 1. look 90 degrees
        moved_deg = math.degrees(self.look(math.pi / 2))
        if abs(moved_deg - 90.0) > 30.0:
            self.fail(i, "look asked for 90 deg and got %.1f deg - the camera is "
                         "not tracking the mouse as measured" % moved_deg)
        yaw_after_look = pg.evaluate("ASCENDANT.game.player.yaw")

        # 2. ESC -> the menu must come up AND STAY up
        if self.args.throttle > 1:
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": self.args.throttle})
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(MENU_ASSERT_MS)
        s = self.snap()
        if self.args.throttle > 1:
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})
            pg.wait_for_timeout(250)
            s = self.snap()

        if s["state"] != "paused":
            self.fail(i, "after ESC state=%r, expected 'paused' (menu did not stay up)"
                      % s["state"])
        if not s["menuIsOpen"]:
            self.fail(i, "after ESC the menu is not open")
        if s["menuVisible"] is False:
            self.fail(i, "after ESC the menu is open but not visible")
        if not s["suspended"]:
            self.fail(i, "after ESC input is not suspended while the menu is up")

        # 3. resume through the menu button, like a player
        btn = pg.evaluate(RESUME_BTN)
        if btn is None:
            self.fail(i, "no RESUME button on screen while paused")
            pg.keyboard.press("Escape")
        else:
            pg.mouse.click(btn["x"], btn["y"])
        pg.wait_for_timeout(900)

        s = self.snap()
        if s["state"] not in ("playing", "hub"):
            self.fail(i, "after RESUME state=%r, expected playing/hub" % s["state"])
        if s["menuIsOpen"]:
            self.fail(i, "after RESUME the menu is still open")

        # 4. relock: automatic, or click-to-relock (Chrome's post-ESC cooldown)
        if not s["locked"]:
            self.ensure_locked(i, "after resume")
        s = self.snap()
        no_ui = not (s["menuIsOpen"] or s["selectOpen"] or s["finishOpen"])
        if s["suspended"] and no_ui and s["state"] in ("playing", "hub"):
            self.fail(i, "input is still suspended with NO UI open and state=%s "
                         "- the suspension is stuck" % s["state"])

        # 5. JUMP must actually fire and lift the player
        vy, dj = self.jump()
        if dj <= 0:
            self.fail(i, "JUMP dead after the ESC cycle: the controller recorded no "
                         "jump at all (counter +0, vel.y peaked at %.2f)" % vy)
        elif vy < JUMP_MIN_VY:
            self.fail(i, "JUMP registered but produced no lift: vel.y peaked at "
                         "%.2f (need > %.1f)" % (vy, JUMP_MIN_VY))
        pg.wait_for_timeout(700)

        # 6. the view must not have jumped across the cycle
        yaw_end = pg.evaluate("ASCENDANT.game.player.yaw")
        drift = wrap_deg(math.degrees(yaw_end - yaw_after_look))
        if abs(drift) > YAW_TOLERANCE_DEG:
            self.fail(i, "camera moved %.1f deg across the pause cycle "
                         "(limit %.1f)" % (drift, YAW_TOLERANCE_DEG))
        print("      look %+.1f deg | state=%s | jump vy=%.2f (+%d) | drift %+.2f deg"
              % (moved_deg, s["state"], vy, dj, drift))
        _ = yaw_start

    # ---- respawn heading -------------------------------------------------
    def respawn_check(self):
        """A death must never leave the player aimed sideways.

        The fix defines respawn as "face the stage direction": authored yaw is
        converted to a controller heading once, in Game._spawnFor. So the
        assertion is against the course, not against the pre-death heading.
        """
        pg = self.pg
        print("  respawn heading")
        self.recover()
        if not self.ensure_locked("respawn", "before death"):
            return
        # Aim somewhere clearly wrong, so a preserved-yaw bug cannot pass by luck.
        pg.evaluate("ASCENDANT.game.player.setYaw(2.4); ASCENDANT.game.player.setPitch(0.3)")
        pg.wait_for_timeout(300)
        before = pg.evaluate("ASCENDANT.game.player.yaw")

        pg.evaluate("(() => { const g = ASCENDANT.game;"
                    " g.player.pos.y -= 500; g.player.vel.y = -60; })()")
        pg.wait_for_timeout(3200)

        info = pg.evaluate(r"""() => {
          const g = ASCENDANT.game, pl = g.player, d = g.stage.def;
          const f = pl.forward;
          // Direction of the course from here: the next checkpoint ahead, else finish.
          const pts = [];
          for (const c of (d.checkpoints || [])) pts.push(c.p);
          if (d.finish) pts.push(d.finish.p);
          let best = null, bestD = 1e9;
          for (const p of pts) {
            const dx = p[0] - pl.pos.x, dz = p[2] - pl.pos.z;
            const m = Math.hypot(dx, dz);
            if (m > 3 && m < bestD) { bestD = m; best = [dx / m, dz / m]; }
          }
          return { yaw: pl.yaw, pitch: pl.pitch,
                   forward: [f.x, f.z], course: best,
                   pos: [pl.pos.x, pl.pos.y, pl.pos.z], state: g.state };
        }""")
        after = info["yaw"]
        if info["course"] is None:
            self.fail("respawn", "could not resolve a course direction to test against")
            return
        dot = info["forward"][0] * info["course"][0] + info["forward"][1] * info["course"][1]
        off = math.degrees(math.acos(max(-1.0, min(1.0, dot))))
        print("      yaw %.4f -> %.4f | facing (%.2f,%.2f) course (%.2f,%.2f) | off %.1f deg"
              % (before, after, info["forward"][0], info["forward"][1],
                 info["course"][0], info["course"][1], off))
        # Sideways is the failure: a 90 deg error is exactly the bug this catches.
        if off > 60.0:
            self.fail("respawn", "respawn faces %.1f deg off the course direction "
                                 "- the view was reset sideways" % off)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--cycles", type=int, default=12)
    ap.add_argument("--stage", default="neon-1")
    ap.add_argument("--throttle", type=int, default=20,
                    help="CDP CPU throttling during the ESC window (1 = off)")
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    args = ap.parse_args()

    if "dev=1" in args.url:
        print("REFUSING: lifecheck must run in PRODUCTION mode. "
              "Dev mode makes input suspension-immune, which is exactly what "
              "hid these bugs.", file=sys.stderr)
        return 2

    print("=" * 72)
    print("ASCENDANT lifecheck  (PRODUCTION mode - no ?dev=1)")
    print("URL      : %s" % args.url)
    print("stage    : %s   cycles: %d   throttle: %dx"
          % (args.stage, args.cycles, args.throttle))
    print("=" * 72)

    errors = []
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": args.width, "height": args.height})
        pg.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
        cdp = pg.context.new_cdp_session(pg)
        try:
            pg.goto(args.url, wait_until="load", timeout=60_000)
        except Exception as e:
            print("NAVIGATION FAILED: %s" % e, file=sys.stderr)
            br.close()
            return 2

        life = Life(pg, cdp, args)
        if not life.boot():
            print("FAILED to reach gameplay from the title", file=sys.stderr)
            br.close()
            return 2
        pg.evaluate(INSTRUMENT)

        if not life.load_stage(args.stage):
            print("FAILED to load stage %s" % args.stage, file=sys.stderr)
            br.close()
            return 2

        s = life.snap()
        print("  entered   : stage=%s state=%s devNoSuspend=%s"
              % (s["stageId"], s["state"], s["devNoSuspend"]))
        if s["devNoSuspend"]:
            print("REFUSING: input reports devNoSuspend - this is not production mode.",
                  file=sys.stderr)
            br.close()
            return 2

        if not life.ensure_locked("setup", "initial"):
            print("FAILED: no real pointer lock - the prod path cannot be tested",
                  file=sys.stderr)
            br.close()
            return 2
        if not life.calibrate():
            print("FAILED: mouse look produced no yaw change under pointer lock",
                  file=sys.stderr)
            br.close()
            return 2

        for i in range(args.cycles):
            life.cycle(i)
        life.respawn_check()

        try:
            cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})
        except Exception:
            pass
        br.close()

    print("-" * 72)
    for e in errors:
        print("  !! %s" % e)
    if life.fails:
        print("FAILURES (%d):" % len(life.fails))
        for f in life.fails:
            print("  x %s" % f)
    ok = not life.fails and not errors
    print("=" * 72)
    print("VERDICT: %s" % ("LIFECYCLE OK" if ok else "LIFECYCLE BROKEN"))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
