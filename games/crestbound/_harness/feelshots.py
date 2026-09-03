#!/usr/bin/env python
"""CRESTBOUND feel SHOTS — the moveset driven on a real course, sampled and pictured.

feelcheck.py proves the NUMBERS against tuning.js. This proves the FEEL: every move
in the bible performed on verdant-1, with the hero's world position + velocity +
state recorded every simulated 1/60 s, and an 8-frame screenshot strip per move so
the arc can be looked at, not just tabulated.

Why it steps the game by hand
-----------------------------
A screenshot costs ~150 ms of wall clock. Under the normal rAF loop that is ~7
frames of game time the shot cannot be taken during, so a real-time strip either
misses the apex or the key timings drift. This harness calls `engine.stop()` and
then drives `game.update(1/60)` itself, one frame at a time. Consequences:

  * every sample is exactly 1/60 s apart in GAME time, regardless of wall clock,
    so apex / airtime / time-to-apex are exact rather than quantised by the
    headless frame rate (feelcheck's rAF sampling quantises to ~22 ms here);
  * a screenshot may be taken between any two frames without disturbing the run;
  * the trajectory and the strip come from the SAME pass — no replay, no
    determinism assumption.

Input still goes through the player's own path: REAL KeyboardEvents via
`input.__test.press/release` and the analog stick via `input.__test.stick`,
consumed by `input.update()` inside `game.update()`. Only the SETUP (placing the
hero at the start of a move, e.g. inside the fort's wall-kick shaft) uses
`player.__test.teleport`.

    python feelshots.py                 # headless real-GPU Chrome (default)
    python feelshots.py --headed
    python feelshots.py --move triple    # one move
    python feelshots.py --no-shots       # trajectories only, much faster

Writes _harness/feelshots.json and _shots/feel/<move>_<n>.png.
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
ROOT = os.path.dirname(HERE)
DEFAULT_URL = "http://localhost:8788/games/crestbound/index.html?dev=1"

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]
HEADLESS_FLAGS = [f for f in FLAGS if not f.startswith("--use-angle")] + [
    "--use-gl=angle", "--use-angle=swiftshader"]

STATE_JS = "globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.state"

# CONTINUE first, deliberately: with a save present NEW GAME opens a YES/NO
# confirm, and a word list that hits NEW GAME first parks the page on that
# confirm forever (measured — the title never leaves). YES is listed so a run
# that lands on the confirm anyway can still get out.
CLICK_JS = r"""() => {
  const words = ['CONTINUE', 'PLAY', 'START', 'BEGIN', 'NEW GAME', 'NEW RUN', 'YES', 'ENTER'];
  const btns = Array.from(document.querySelectorAll('button.cb-btn, button, [role=button], .btn'));
  for (const want of words) {
    for (const b of btns) {
      const r = b.getBoundingClientRect();
      if (b.disabled || r.width < 4 || r.height < 4) continue;
      if ((b.textContent || '').toUpperCase().indexOf(want) < 0) continue;
      if (typeof b.__activate === 'function') b.__activate(); else b.click();
      return want;
    }
  }
  const t = document.querySelector('canvas') || document;
  for (const type of ['keydown', 'keyup'])
    t.dispatchEvent(new KeyboardEvent(type, {code:'Enter', key:'Enter', bubbles:true, cancelable:true}));
  return null;
}"""

# --------------------------------------------------------------------------
# The in-page driver. Installed once; every move runs through it.
# --------------------------------------------------------------------------
DRIVER_JS = r"""
() => {
  const A = globalThis.CRESTBOUND;
  if (!A || !A.game) return 'no CRESTBOUND.game';
  const G = A.game, E = A.engine;
  if (!G.player || !G.input) return 'no player/input';

  const KEYS = ['KeyW','KeyA','KeyS','KeyD','Space','ControlLeft','ShiftLeft','KeyC','KeyF','KeyX','KeyZ','KeyG'];
  const JUMP = 'Space', CROUCH = 'ControlLeft', DIVE = 'KeyF';

  const F = {
    dt: 1 / 60,
    i: 0,                 // frame index inside the current move
    samples: [],
    stick: null,          // {wx, wz, mag} in WORLD terms, re-applied every frame
    auto: null,           // adaptive driver for a move that must react to state
    log: [],              // input events, with the frame they happened on
    err: [],
  };

  const P = () => G.player;
  const IN = () => G.input;
  const spd = () => Math.hypot(P().vel.x, P().vel.z);

  F.press = (c) => { IN().__test.press(c); F.log.push([F.i, '+' + c]); };
  F.release = (c) => { IN().__test.release(c); F.log.push([F.i, '-' + c]); };
  F.allUp = () => { KEYS.forEach((c) => IN().__test.release(c)); IN().__test.stick(0, 0); F.stick = null; };

  /* The stick is CAMERA-RELATIVE (contract §4). Naming a WORLD direction and
     converting through the live camera yaw every frame is what a player does
     when they hold "away from the camera" while the camera swings. */
  F.camYaw = () => {
    const c = G.cam;
    if (c && Number.isFinite(c.yaw)) return c.yaw;
    return 0;
  };
  F.applyStick = () => {
    const s = F.stick;
    if (!s) return;
    const y = F.camYaw();
    const fx = -Math.sin(y), fz = -Math.cos(y);
    const rx = -fz, rz = fx;
    const L = Math.hypot(s.wx, s.wz) || 1;
    const ux = s.wx / L, uz = s.wz / L;
    IN().__test.stick((ux * rx + uz * rz) * s.mag, (ux * fx + uz * fz) * s.mag);
  };
  F.setStick = (wx, wz, mag) => { F.stick = { wx: wx, wz: wz, mag: mag }; F.applyStick(); F.log.push([F.i, 'stick ' + wx + ',' + wz + ' @' + mag]); };
  F.clearStick = () => { F.stick = null; IN().__test.stick(0, 0); F.log.push([F.i, 'stick 0']); };

  F.place = (x, y, z, yaw) => {
    const p = P();
    p.__test.teleport({ x: x, y: y, z: z });
    p.__test.setVel({ x: 0, y: 0, z: 0 });
    if (Number.isFinite(yaw)) p.__test.setFacing(yaw);
    if (G.cam && typeof G.cam.recenter === 'function') G.cam.recenter();
  };

  F.begin = (opts) => {
    F.i = 0; F.samples = []; F.log = []; F.err = [];
    F.auto = (opts && opts.auto) || null;
    F.autoState = { held: -1, kicks: 0, jumps: 0, hopped: false, lastWall: 0, wallSide: 1, pounded: false, poundJumped: false };
    F.allUp();
    if (E && E.running) E.stop();
    return true;
  };

  F.sample = () => {
    const p = P();
    const wn = p.wallN || { x: 0, y: 0, z: 0 };
    return {
      i: F.i,
      t: +(F.i * F.dt).toFixed(4),
      x: +p.pos.x.toFixed(4), y: +p.pos.y.toFixed(4), z: +p.pos.z.toFixed(4),
      vx: +p.vel.x.toFixed(4), vy: +p.vel.y.toFixed(4), vz: +p.vel.z.toFixed(4),
      sp: +spd().toFixed(4),
      st: p.state, an: p.anim || '', g: p.grounded ? 1 : 0,
      f: +(p.facing || 0).toFixed(4), jc: p.jumpCount | 0,
      wn: +Math.hypot(wn.x, wn.z).toFixed(3),
      cy: +F.camYaw().toFixed(4),
      /* why the controller did what it did */
      mv: [+IN().move.x.toFixed(3), +IN().move.y.toFixed(3), +IN().move.mag.toFixed(3)],
      wm: +(p._wmag || 0).toFixed(3),
      stun: +(p.stunT || 0).toFixed(3),
      sur: p.surface || '',
      sus: IN().suspended ? 1 : 0,
      gs: p._lastRes ? [+(p._lastRes.platformVel ? p._lastRes.platformVel.x : 0).toFixed(3),
                        +(p._lastRes.platformVel ? p._lastRes.platformVel.z : 0).toFixed(3),
                        p._lastRes.walls ? p._lastRes.walls.length : 0] : null,
      gsl: +(p.groundSlopeDeg || 0).toFixed(2),
    };
  };

  /* ---- adaptive drivers: what a PLAYER reacts to, expressed as a rule ---- */
  F.runAuto = () => {
    const a = F.auto;
    if (!a) return;
    const p = P(), S = F.autoState, T = A.TUNE || null;

    if (a === 'chain') {
      /* Triple chain: re-press jump the frame the hero touches down, hold 8
         frames (well past jumpHoldMin), release. Three jumps then stop. */
      if (S.held >= 0 && F.i >= S.held) { F.release(JUMP); S.held = -1; }
      else if (S.held < 0 && p.grounded && S.jumps < 3 && F.i > 2) {
        /* Hold past the WHOLE rise (jump3 rises 15.6/34 = 0.46 s = 28 frames)
           so jumpCut never fires and the apexes are the full authored ones. */
        F.press(JUMP); S.held = F.i + 32; S.jumps++;
      }
    } else if (a === 'divehop') {
      /* Hop-cancel: jump once the belly slide has been going ~0.3 s. */
      if (S.held >= 0 && F.i >= S.held) { F.release(JUMP); S.held = -1; }
      else if (!S.hopped && S.held < 0 && p.state === 'slide') {
        S.slideFrames = (S.slideFrames || 0) + 1;
        if (S.slideFrames > 18) { F.press(JUMP); S.held = F.i + 6; S.hopped = true; }
      }
    } else if (a === 'pound') {
      /* Jump, then pound at the top, then a pound-jump inside the window. */
      if (S.held >= 0 && F.i >= S.held) {
        const c = S.heldKey; F.release(c); S.held = -1;
      }
      if (F.i === 2) { F.press(JUMP); S.held = F.i + 10; S.heldKey = JUMP; }
      else if (!S.pounded && S.held < 0 && !p.grounded && p.vel.y < 1.0 && F.i > 14) {
        F.press(CROUCH); S.held = F.i + 4; S.heldKey = CROUCH; S.pounded = true;
      } else if (S.pounded && !S.poundJumped && S.held < 0 && p.grounded && p.state === 'poundLand') {
        F.press(JUMP); S.held = F.i + 8; S.heldKey = JUMP; S.poundJumped = true;
      }
    } else if (a === 'wallkick' || a === 'wallkick_hold') {
      /* Two kicks in a 3.3 m shaft, driven the way a player does it: LEAN into
         the wall the whole time, hop off the floor once, and press jump the
         moment the hero is on the wall AND falling (the contract's minFall:
         "you bonk a wall on the way up, you kick it on the way down"). The hold
         is short (5 frames) so the next press is never swallowed. */
      const minFall = T && T.wallKick ? T.wallKick.minFall : -1.0;
      /* HOLD LENGTH is the whole experiment: 5 frames (83 ms) is a normal tap
         and arms jumpCut; 26 frames outlasts the kick's entire rise so the cut
         can never fire. The pair isolates how much of a kick a tap costs. */
      const HOLD = (a === 'wallkick_hold') ? 26 : 5;
      if (S.held >= 0 && F.i >= S.held) { F.release(JUMP); S.held = -1; }
      if (F.i === 2) F.setStick(0, -1, 1);
      const onWall = !p.grounded && (p.state === 'wallslide' ||
        (Math.hypot(p.wallN.x, p.wallN.z) > 0.5 && Math.abs(p.wallN.y) < 0.4));
      if (S.held < 0 && F.i > 6) {
        if (S.kicks === 0 && p.grounded && F.i - S.lastWall > 6) {
          F.press(JUMP); S.held = F.i + HOLD; S.lastWall = F.i;       // hop at the wall
        } else if (S.kicks < 2 && onWall && p.vel.y <= minFall && F.i - S.lastWall > 8) {
          F.press(JUMP); S.held = F.i + HOLD; S.kicks++; S.lastWall = F.i;
          S.wallSide = -S.wallSide;
          F.setStick(0, S.wallSide < 0 ? 1 : -1, 1);                  // lean at the other wall
        }
      }
    } else if (a === 'aircontrol') {
      /* Run, jump, then FULLY reverse the stick in the air: how much of a bad
         launch can be saved, and does the hero feel weightless doing it. */
      if (S.held >= 0 && F.i >= S.held) { F.release(JUMP); S.held = -1; }
      if (F.i === 30) { F.press(JUMP); S.held = F.i + 32; }   // at FULL run, full height
      if (F.i === 44) F.setStick(0, 1, 1);                    // reverse, mid-rise
    }
  };

  /* Step the game by hand. `n` frames of EXACTLY F.dt each. */
  F.step = (n) => {
    for (let k = 0; k < n; k++) {
      F.runAuto();
      F.applyStick();
      try { G.update(F.dt); } catch (e) { F.err.push(String(e && e.message || e)); }
      F.i++;
      F.samples.push(F.sample());
    }
    return F.i;
  };

  /** Step until the absolute frame index `target`. */
  F.stepTo = (target) => { const n = target - F.i; if (n > 0) F.step(n); return F.i; };

  F.dump = () => ({ samples: F.samples, log: F.log, err: F.err });

  /* EVERY heightfield under (x, z), with its active flag: collide.js grounds on
     the HIGHEST active one, and ignores terrain the feet are more than
     HF_LIFT_MAX (1.2 m) below, so one hidden higher field is enough to make a
     spot look standable and behave like a void. */
  F.ground = (x, z) => {
    const c = G.course;
    if (!c || !c.broadphase || !c.broadphase.heightfields) return null;
    const out = [];
    for (const h of c.broadphase.heightfields) {
      const y = h.heightAt(x, z);
      out.push({ id: h.id || null, active: h.active !== false,
                 y: Number.isFinite(y) ? +y.toFixed(3) : null });
    }
    return out;
  };

  window.__FEEL = F;
  return 'ok';
}
"""


def launch(p, headless):
    if not headless:
        return p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
    try:
        return p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
    except Exception as e:
        print("headless: no hardware Chrome (%s) -> SwiftShader" % str(e)[:110], file=sys.stderr)
        return p.chromium.launch(headless=True, args=HEADLESS_FLAGS)


def leave_title(pg, timeout=120):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            st = pg.evaluate(STATE_JS)
        except Exception:
            st = None
        if st in ("keep", "playing"):
            return True
        try:
            pg.evaluate(CLICK_JS)
        except Exception:
            pass
        pg.wait_for_timeout(400)
    return False


# --------------------------------------------------------------------------
# Move scripts. Each is a list of (frame, js) actions plus a total length.
# Frame 0 is the first stepped frame after the settle.
# --------------------------------------------------------------------------
RUNUP = 40          # frames of full stick before a move that needs run speed
                    # (accelGround 42 reaches 9 m/s in 0.214 s = 13 frames)

# The mown path north of cp-meadow. MEASURED (probe, this session): from
# (0, 46) the meadow is clear of solid geometry for 19.1 m along -Z at hero
# height, and only 2.3 m along +Z -- the spawn meadow is dressed with SOLID
# chest-high bushes/rocks, so a longer lane does not exist here.
MEADOW = dict(p=[0.0, 2.30, 47.0], yaw=0.0)           # spawn meadow, facing -Z
# The dive travels ~17 m; it gets a short run-up so it stays on the meadow.
DIVE_RUNUP = 18
# The kick is driven from the AUTHORED courtyard height. (It used to be driven
# from 13.50 because the shaft interior was not standable at 9.00: buildBuilding
# placed the fort base-relative against a centre-relative def, so the fort sat
# 2.70 m high, its interior-floor slab became a ceiling at 11.48..11.70 over the
# courtyard, and the shaft had no floor at all. Fixed in builders.js.)
SHAFT = dict(p=[-9.2, 9.40, -32.80], yaw=0.0)           # inside the west tower shaft (3.30 m clear)

MOVES = [
    dict(name="walk", place=MEADOW, frames=110, auto=None,
         acts=[(0, "__FEEL.setStick(0,-1,0.40)")],
         note="stick magnitude 0.40 — the analog walk band"),

    dict(name="run_pivot", place=MEADOW, frames=170, auto=None,
         acts=[(0, "__FEEL.setStick(0,-1,1)"), (RUNUP + 25, "__FEEL.setStick(0,1,1)")],
         note="full run, then a hard 180 stick reversal at speed"),

    # The one bible line no gate measures: "turn rate scales with speed (slow =
    # snappy, fast = wide arc)". Phase 1 turns 90 deg at FULL run (expect
    # turnRateFast 4.2 rad/s, radius ~ speedRun/4.2 = 2.14 m); phase 2 repeats it
    # at the WALK magnitude (expect turnRateSlow 14 rad/s, radius ~ 0.23 m).
    dict(name="turnarc", place=MEADOW, frames=200, auto=None,
         acts=[(0, "__FEEL.setStick(0,-1,1)"),
               (30, "__FEEL.setStick(-1,0,1)"),
               (90, "__FEEL.clearStick()"),
               (110, "__FEEL.setStick(0,-1,0.40)"),
               (150, "__FEEL.setStick(1,0,0.40)")],
         note="90 deg turn at full run, then the same turn at walk magnitude"),

    dict(name="run_stop", place=MEADOW, frames=120, auto=None,
         acts=[(0, "__FEEL.setStick(0,-1,1)"), (RUNUP + 25, "__FEEL.clearStick()")],
         note="full run, then the stick released — release-to-rest"),

    # The SAME stop, driven by a real key release instead of stick(0,0).
    # stick(0,0) ends the injection instantly; a key release runs the input
    # ramp-down (KEY_RAMP_DOWN 0.06 s) first. The pair isolates how much of
    # the release-to-rest time belongs to the controller and how much to input.
    dict(name="run_stop_key", place=MEADOW, frames=120, auto=None,
         acts=[(0, "__FEEL.press('KeyW')"), (RUNUP + 25, "__FEEL.release('KeyW')")],
         note="full run on KeyW, then the KEY released — the player's own stop"),

    dict(name="triple", place=MEADOW, frames=190, auto="chain",
         acts=[(0, "__FEEL.setStick(0,-1,1)")],
         note="single -> double -> triple, re-pressed on each touchdown"),

    dict(name="longjump", place=MEADOW, frames=150, auto=None,
         acts=[(0, "__FEEL.setStick(0,-1,1)"),
               (RUNUP, "__FEEL.press('ControlLeft')"),
               (RUNUP + 2, "__FEEL.press('Space')"),
               (RUNUP + 12, "__FEEL.release('Space'); __FEEL.release('ControlLeft')")],
         note="crouch + jump at full run"),

    dict(name="backflip", place=MEADOW, frames=140, auto=None,
         acts=[(4, "__FEEL.press('ControlLeft')"),
               (12, "__FEEL.press('Space')"),
               (24, "__FEEL.release('Space'); __FEEL.release('ControlLeft')")],
         note="crouch + jump from rest"),

    dict(name="sideflip", place=MEADOW, frames=150, auto=None,
         acts=[(0, "__FEEL.setStick(0,-1,1)"),
               (RUNUP + 20, "__FEEL.setStick(0,1,1)"),
               (RUNUP + 24, "__FEEL.press('Space')"),
               (RUNUP + 36, "__FEEL.release('Space')")],
         note="stick reversal then jump inside the 0.12 s window"),

    dict(name="dive", place=MEADOW, frames=230, auto=None,
         acts=[(0, "__FEEL.setStick(0,-1,1)"),
               (DIVE_RUNUP, "__FEEL.press('KeyF')"),
               (DIVE_RUNUP + 6, "__FEEL.release('KeyF')")],
         note="dive from a full run, ridden to the end of the belly slide"),

    dict(name="dive_hop", place=MEADOW, frames=230, auto="divehop",
         acts=[(0, "__FEEL.setStick(0,-1,1)"),
               (DIVE_RUNUP, "__FEEL.press('KeyF')"),
               (DIVE_RUNUP + 6, "__FEEL.release('KeyF')")],
         note="same dive, jump-cancelled out of the slide"),

    dict(name="pound", place=MEADOW, frames=160, auto="pound",
         acts=[],
         note="jump, pound at the top, pound-jump inside pound.jumpWindow"),

    dict(name="wallkick", place=SHAFT, frames=220, auto="wallkick",
         acts=[],
         note="two kicks in the fort's west-tower shaft (3.30 m clear, 9.00 -> 16.60)"),

    # The SAME two kicks with the jump button held right through the rise, so
    # `jumpCut` cannot fire. Against `wallkick` (a 83 ms tap) this says exactly
    # what a tapped kick costs in metres.
    dict(name="wallkick_hold", place=SHAFT, frames=220, auto="wallkick_hold",
         acts=[],
         note="same two kicks, jump HELD past the rise — the uncut kick height"),

    # Diagnostic: where does the west tower actually have a floor? The hero is
    # re-placed every 40 frames and left to settle; the samples say whether each
    # point is standable, ejected, or a void.
    dict(name="shaftprobe", place=dict(p=[-9.2, 9.40, -30.0], yaw=0.0), frames=400, auto=None,
         acts=[(40, "__FEEL.place(-9.2, 9.40, -31.6, 0)"),
               (80, "__FEEL.place(-9.2, 9.40, -32.8, 0)"),
               (120, "__FEEL.place(-9.2, 9.40, -34.0, 0)"),
               (160, "__FEEL.place(-10.4, 9.40, -32.8, 0)"),
               (200, "__FEEL.place(-8.0, 9.40, -32.8, 0)"),
               (240, "__FEEL.place(-9.2, 12.20, -32.8, 0)"),
               (280, "__FEEL.place(-9.2, 17.20, -32.8, 0)"),
               (320, "__FEEL.place(0.0, 12.20, -24.0, 0)"),
               (360, "__FEEL.place(0.0, 9.40, -14.0, 0)")],
         note="floor probe: points in/around the west-tower shaft and the fort courtyard"),

    # Run head-on into a wall and KEEP the stick held. The bible says the hero
    # bonks and presses; it must not play the run cycle on the spot.
    dict(name="wallbonk", place=MEADOW, frames=150, auto=None,
         acts=[(0, "__FEEL.setStick(0,1,1)")],
         note="full run into the solid meadow dressing behind spawn, stick held"),

    dict(name="aircontrol", place=MEADOW, frames=140, auto="aircontrol",
         acts=[(0, "__FEEL.setStick(0,-1,1)")],
         note="jump at full run, then fully reverse the stick in the air"),
]

SHOT_MOVES = {"walk", "run_pivot", "run_stop_key", "triple", "longjump", "backflip", "sideflip",
              "dive", "dive_hop", "pound", "wallkick", "wallbonk", "aircontrol"}


# --------------------------------------------------------------------------
def analyse(name, s):
    """Per-move numbers from the trajectory."""
    if not s:
        return {"error": "no samples"}
    dt = 1.0 / 60.0
    ys = [k["y"] for k in s]
    peak_i = max(range(len(s)), key=lambda i: ys[i])
    # take-off: last grounded frame before the peak
    to_i = 0
    for i in range(peak_i, -1, -1):
        if s[i]["g"]:
            to_i = i
            break
    # landing: first grounded frame after the peak
    land_i = None
    for i in range(peak_i + 1, len(s)):
        if s[i]["g"]:
            land_i = i
            break
    apex = round(ys[peak_i] - s[to_i]["y"], 3)
    airtime = round(((land_i if land_i is not None else len(s) - 1) - to_i) * dt, 3)
    t_apex = round((peak_i - to_i) * dt, 3)
    if land_i is not None:
        dist = round(math.hypot(s[land_i]["x"] - s[to_i]["x"], s[land_i]["z"] - s[to_i]["z"]), 3)
    else:
        dist = round(math.hypot(s[-1]["x"] - s[to_i]["x"], s[-1]["z"] - s[to_i]["z"]), 3)
    total = round(math.hypot(s[-1]["x"] - s[0]["x"], s[-1]["z"] - s[0]["z"]), 3)
    peak_sp = round(max(k["sp"] for k in s), 3)
    peak_vy = round(max(k["vy"] for k in s), 3)
    min_vy = round(min(k["vy"] for k in s), 3)

    states, runs = [], []
    cur, n0 = None, 0
    for i, k in enumerate(s):
        if k["st"] != cur:
            if cur is not None:
                runs.append((cur, round((i - n0) * dt, 3)))
            cur, n0 = k["st"], i
            states.append(k["st"])
    runs.append((cur, round((len(s) - n0) * dt, 3)))

    out = {
        "frames": len(s), "apex_m": apex, "airtime_s": airtime, "t_apex_s": t_apex,
        "jump_dist_m": dist, "total_dist_m": total, "peak_speed": peak_sp,
        "peak_vy": peak_vy, "min_vy": min_vy,
        "takeoff_frame": to_i, "peak_frame": peak_i,
        "land_frame": land_i if land_i is not None else -1,
        "states": states, "state_runs": runs,
        "end_state": s[-1]["st"], "end_grounded": s[-1]["g"],
        "end_speed": s[-1]["sp"],
    }

    if name in ("run_stop", "run_pivot"):
        # release / reversal -> rest
        top_i = max(range(len(s)), key=lambda i: s[i]["sp"])
        stop_i = None
        for i in range(top_i, len(s)):
            if s[i]["sp"] < 0.20:
                stop_i = i
                break
        if stop_i is not None:
            out["stop_time_s"] = round((stop_i - top_i) * dt, 3)
            out["stop_dist_m"] = round(
                math.hypot(s[stop_i]["x"] - s[top_i]["x"], s[stop_i]["z"] - s[top_i]["z"]), 3)
            out["top_speed"] = s[top_i]["sp"]
    if name == "triple":
        peaks = []
        for i in range(1, len(s) - 1):
            if s[i]["y"] > s[i - 1]["y"] and s[i]["y"] >= s[i + 1]["y"] and not s[i]["g"]:
                # a local max in the air; find its take-off
                j = i
                while j > 0 and not s[j]["g"]:
                    j -= 1
                peaks.append(round(s[i]["y"] - s[j]["y"], 3))
        # keep the 3 biggest distinct ones in order
        out["chain_apexes"] = peaks[:6]
    if name in ("wallkick", "wallkick_hold"):
        ks = []
        for i in range(1, len(s)):
            if s[i]["st"] == "wallkick" and s[i - 1]["st"] != "wallkick":
                base = s[i]["y"]
                top = base
                for j in range(i, len(s)):
                    if s[j]["y"] > top:
                        top = s[j]["y"]
                    if s[j]["g"] or s[j]["st"] == "wallslide":
                        break
                ks.append({"frame": i, "y": round(base, 2), "vy": s[i]["vy"],
                           "gain_m": round(top - base, 3),
                           "facing": s[i]["f"]})
        out["kicks"] = ks
    return out



def run_one(pg, mv, args, errors):
    """One move, start to finish, on an already-booted page."""
    name = mv["name"]
    pl = mv["place"]
    gy = pg.evaluate("([x,z]) => window.__FEEL.ground(x,z)", [pl["p"][0], pl["p"][2]])
    pg.evaluate("(a) => { const F = window.__FEEL; F.begin({}); "
                "F.place(a.p[0], a.p[1], a.p[2], a.yaw); F.step(30); F.begin({auto:a.auto}); }",
                {"p": pl["p"], "yaw": pl["yaw"], "auto": mv["auto"]})

    total = mv["frames"]
    acts = sorted(mv["acts"], key=lambda k: k[0])
    shots = []
    if not args.no_shots and name in SHOT_MOVES:
        shots = [int(round(total * k / 8.0)) for k in range(8)]
    bps = sorted(set([k[0] for k in acts] + shots + [total]))

    shot_n = 0
    for bp in bps:
        pg.evaluate("(n) => window.__FEEL.stepTo(n)", bp)
        for f, js in acts:
            if f == bp:
                pg.evaluate("() => { %s }" % js)
        if bp in shots and not args.no_shots:
            shot_n += 1
            path = os.path.join(args.shotdir, "%s_%d.png" % (name, shot_n))
            try:
                pg.screenshot(path=path, timeout=30_000)
            except Exception as e:
                errors.append("screenshot %s: %s" % (path, str(e)[:100]))
    pg.evaluate("(n) => window.__FEEL.stepTo(n)", total)
    dump = pg.evaluate("() => window.__FEEL.dump()")
    pg.evaluate("() => window.__FEEL.allUp()")

    a = analyse(name, dump["samples"])
    a["input_log"] = dump["log"]
    a["samples"] = dump["samples"]
    if dump["err"]:
        a["update_errors"] = dump["err"][:5]
        errors.append("%s: game.update threw %s" % (name, dump["err"][0]))
    return a, gy


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--course", default="verdant-1")
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--move", default=None, help="run one move only")
    ap.add_argument("--no-shots", action="store_true")
    ap.add_argument("--json", default=os.path.join(HERE, "feelshots.json"))
    ap.add_argument("--shotdir", default=os.path.join(ROOT, "_shots", "feel"))
    ap.add_argument("--width", type=int, default=1200)
    ap.add_argument("--height", type=int, default=675)
    args = ap.parse_args()

    os.makedirs(args.shotdir, exist_ok=True)
    moves = [m for m in MOVES if args.move is None or m["name"] == args.move]
    if not moves:
        print("no such move: %s" % args.move, file=sys.stderr)
        return 2

    errors, result = [], {}

    def boot(pw):
        """Fresh browser -> course -> driver installed. Raises on failure."""
        b = launch(pw, not args.headed)
        g = b.new_page(viewport={"width": args.width, "height": args.height})
        g.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
        g.on("console", lambda m: errors.append("console.%s: %s" % (m.type, m.text))
             if m.type == "error" else None)
        g.goto(args.url, wait_until="load", timeout=90_000)
        deadline = time.time() + 150
        while time.time() < deadline:
            try:
                if g.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game)"):
                    break
            except Exception:
                pass
            g.wait_for_timeout(400)
        if not leave_title(g):
            raise RuntimeError("never left the title (state=%s)" % g.evaluate(STATE_JS))
        g.evaluate("async (id) => { const d = CRESTBOUND.game.__dev;"
                   " if (!d) throw new Error('__dev missing (?dev=1)'); await d.goto(id); }",
                   args.course)
        leave_title(g, timeout=60)
        g.wait_for_timeout(1500)
        ok = g.evaluate(DRIVER_JS)
        if ok != "ok":
            raise RuntimeError("driver install failed: %s" % ok)
        return b, g

    with sync_playwright() as p:
        br, pg = boot(p)

        print("=" * 96)
        print("CRESTBOUND feelshots — %s, manual 1/60 s stepping, real KeyboardEvents"
              % args.course)
        print("=" * 96)
        sys.stdout.flush()

        for mv in moves:
            name = mv["name"]
            a, gy = None, None
            for attempt in (1, 2, 3):
                try:
                    a, gy = run_one(pg, mv, args, errors)
                    break
                except Exception as exc:
                    msg = str(exc).split("\n")[0][:140]
                    errors.append("%s attempt %d: %s" % (name, attempt, msg))
                    print("    !! %s attempt %d failed: %s" % (name, attempt, msg))
                    sys.stdout.flush()
                    if attempt == 3:
                        a, gy = {"error": msg}, None
                        break
                    try:
                        br.close()
                    except Exception:
                        pass
                    time.sleep(15)
                    br, pg = boot(p)
            if "error" in a:
                result[name] = a
                continue
            a["note"] = mv["note"]
            a["ground_y_at_start"] = gy
            result[name] = a
            print("\n--- %-11s %s" % (name, mv["note"]))
            print("    apex %6.3f m   t-apex %5.3f s   airtime %5.3f s   jump-dist %6.3f m"
                  % (a["apex_m"], a["t_apex_s"], a["airtime_s"], a["jump_dist_m"]))
            print("    peak-speed %6.3f m/s   peak-vy %6.3f   min-vy %7.3f   total-dist %6.3f m"
                  % (a["peak_speed"], a["peak_vy"], a["min_vy"], a["total_dist_m"]))
            print("    states  %s" % " -> ".join(a["states"]))
            print("    dwell   %s" % ", ".join("%s %.2fs" % (n, t) for n, t in a["state_runs"]))
            for k in ("stop_time_s", "stop_dist_m", "top_speed", "chain_apexes", "kicks"):
                if k in a:
                    print("    %-12s %s" % (k, a[k]))
            print("    end     state=%s grounded=%d speed=%.2f"
                  % (a["end_state"], a["end_grounded"], a["end_speed"]))
            sys.stdout.flush()

        # restart the real loop so the page is left healthy
        try:
            pg.evaluate("() => { const E = CRESTBOUND.engine, G = CRESTBOUND.game;"
                        " if (E && !E.running) E.start((dt) => G.update(dt)); }")
        except Exception:
            pass
        br.close()

    payload = {"course": args.course, "dt": 1 / 60.0, "moves": result, "errors": errors}
    with open(args.json, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1)
    print("\nwrote %s" % args.json)
    if not args.no_shots:
        print("strips in %s" % args.shotdir)
    if errors:
        print("\nPAGE ERRORS (%d):" % len(errors))
        for e in errors[:12]:
            print("  " + e)
    return 0


if __name__ == "__main__":
    sys.exit(main())
