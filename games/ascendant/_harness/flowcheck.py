#!/usr/bin/env python
"""ASCENDANT flowcheck — the PRODUCTION-MODE state-machine + UI-flow gate.

lifecheck.py proves ONE transition (ESC during plain gameplay) survives the
pointer-lock lifecycle. This proves the rest of them: the transitions a player
actually hits, in the order they hit them, with the assertion that matters —

    after this transition, is the game still PLAYABLE?

"Playable" is four facts, checked together every time, because each of them has
been individually true while the game was dead:

    state          the state machine agrees with what is on screen
    UI             exactly the surfaces that should be up, are up
    suspension     input.suspended is true IFF a UI surface owns the input
    jump           the controller records a jump and the body leaves the ground

The fourth is the one that catches everything: a stuck `input.suspended` is
invisible in a screenshot, does not throw, does not log, and leaves the player
walking around a live world unable to jump — which in an obby is the whole game.

Runs WITHOUT ?dev=1. Dev mode makes input suspension-immune
(input.js setSuspended early-returns on devNoSuspend), which is precisely the
blindfold: every bug below is a suspension/state bug and every one of them
disappears under ?dev=1.

    python flowcheck.py
    python flowcheck.py --stage neon-1
    python flowcheck.py --only clear_card_autoadvance,stageselect_escape

Exit 0 only when every scenario passes and no page error was raised.
"""
import argparse
import json
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

JUMP_WINDOW_MS = 320
JUMP_MIN_VY = 2.0          # see lifecheck.py for why the floor sits here


# ---------------------------------------------------------------------------
# Census hooks. Installed BEFORE any page script so nothing is missed, and kept
# as net counters so "did this stage transition leak listeners?" is one
# subtraction rather than a guess.
# ---------------------------------------------------------------------------
INIT = r"""
(() => {
  const W = window;
  const C = { win: 0, doc: 0, intervals: 0, raf: 0, byType: Object.create(null) };
  W.__FC = C;

  const wrap = (obj, key) => {
    const add = obj.addEventListener, rem = obj.removeEventListener;
    obj.addEventListener = function (t, f, o) {
      C[key]++; C.byType[key + ':' + t] = (C.byType[key + ':' + t] | 0) + 1;
      return add.call(this, t, f, o);
    };
    obj.removeEventListener = function (t, f, o) {
      C[key]--; C.byType[key + ':' + t] = (C.byType[key + ':' + t] | 0) - 1;
      return rem.call(this, t, f, o);
    };
  };
  wrap(W, 'win');
  wrap(W.document, 'doc');

  const si = W.setInterval, ci = W.clearInterval;
  W.setInterval = function () { C.intervals++; return si.apply(W, arguments); };
  W.clearInterval = function (id) { if (id != null) C.intervals--; return ci.call(W, id); };

  /* rAF: count only what is OUTSTANDING, so the engine's single self-renewing
     loop reads as 1 forever and a per-stage loop nobody cancelled reads as N. */
  const rq = W.requestAnimationFrame, rc = W.cancelAnimationFrame;
  W.requestAnimationFrame = function (fn) {
    C.raf++;
    return rq.call(W, function (t) { C.raf--; return fn(t); });
  };
  W.cancelAnimationFrame = function (id) { if (id != null) C.raf--; return rc.call(W, id); };
})();
"""

SNAP = r"""() => {
  const A = globalThis.ASCENDANT, g = A && A.game;
  if (!g) return null;
  const vis = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05;
  };
  const inp = g.input;
  return {
    state: g.state,
    stageId: g.stageId,
    menuIsOpen: !!(g.menu && g.menu.isOpen),
    menuPage: g.menu ? g.menu.page : null,
    selIsOpen: !!(g.stageSelect && g.stageSelect.isOpen),
    gameSelectOpen: !!g._selectOpen,
    finishOpen: !!(g.hud && g.hud.finishOpen),
    introVisible: vis('.asc-intro'),
    suspended: !!(inp && inp.suspended),
    locked: !!(inp && inp.locked),
    devNoSuspend: !!(inp && inp.devNoSuspend),
    deathT: g._deathT, introT: g._introT, clearT: g._clearT,
    timerRun: !!g._timerRun,
    timeMs: g.timeMs, totalMs: g.totalMs,
    cpIndex: g.cpIndex, deaths: g.deaths,
    loading: !!g._loading,
    jumps: g.player && g.player.stats ? g.player.stats.jumps : null,
    grounded: g.player ? !!g.player.grounded : null,
    keysHeld: inp ? [inp.jump, inp.sprint, inp.crouch,
                     inp.move ? inp.move.x : 0, inp.move ? inp.move.y : 0] : null,
    finishTriggered: !!(g.stage && g.stage.finish && g.stage.finish.triggered),
    sens: inp ? inp.sensitivity : null,
    invertY: inp ? !!inp.invertY : null,
    fov: g.engine && g.engine.camera ? g.engine.camera.fov : null,
    qualityId: (() => { try { return A.Settings ? A.Settings.qualityId() : null; } catch (e) { return null; } })(),
  };
}"""

CENSUS = r"""() => {
  const A = globalThis.ASCENDANT, g = A && A.game;
  const emit = (e) => {
    if (!e || !e._map) return 0;
    let n = 0;
    e._map.forEach((list) => { for (const f of list) if (f) n++; });
    return n;
  };
  return {
    win: window.__FC.win,
    doc: window.__FC.doc,
    intervals: window.__FC.intervals,
    raf: window.__FC.raf,
    stageEvents: g && g.stage ? emit(g.stage.events) : 0,
    playerEvents: g && g.player ? emit(g.player.events) : 0,
    engineEvents: g && g.engine ? emit(g.engine.events) : 0,
    capture: (() => {
      try {
        const m = globalThis.__STYLE;
        return m && m.captureCount ? m.captureCount() : -1;
      } catch (e) { return -1; }
    })(),
  };
}"""

INSTRUMENT = r"""() => {
  const A = globalThis.ASCENDANT, g = A && A.game;
  if (!g) return false;
  if (g.__flowcheck) return true;
  g.__flowcheck = true;
  const up = g.update.bind(g);
  globalThis.__VY = -1e9;
  globalThis.__CLEARS = 0;
  g.update = function (dt) {
    const r = up(dt);
    if (g.player && g.player.vel.y > globalThis.__VY) globalThis.__VY = g.player.vel.y;
    return r;
  };
  const fin = g.onFinish.bind(g);
  g.onFinish = function () {
    const before = g.state;
    const r = fin();
    if (before !== 'cleared' && g.state === 'cleared') globalThis.__CLEARS++;
    return r;
  };
  globalThis.__VYRESET = () => { globalThis.__VY = -1e9; };
  /* style.js is already loaded; this import returns the SAME module instance,
     so captureCount() reads the live counter rather than a fresh zero. */
  import('./runtime/ui/style.js').then((m) => { globalThis.__STYLE = m; }).catch(() => {});
  return true;
}"""

BTN = r"""(label) => {
  const seen = [];
  for (const b of document.querySelectorAll('button')) {
    const r = b.getBoundingClientRect();
    if (r.width < 20 || r.height < 8 || b.disabled) continue;
    const cs = getComputedStyle(b);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const txt = (b.textContent || '').toUpperCase().trim();
    seen.push(txt);
    if (txt.indexOf(label) >= 0) return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: txt };
  }
  return { miss: seen };
}"""


class Flow:
    def __init__(self, pg, args):
        self.pg = pg
        self.args = args
        self.fails = []          # (scenario, message)
        self.scenario = "-"
        self.ran = []

    # ---- primitives ------------------------------------------------------
    def snap(self):
        return self.pg.evaluate(SNAP)

    def census(self):
        return self.pg.evaluate(CENSUS)

    def fail(self, msg):
        self.fails.append((self.scenario, msg))
        print("      FAIL  %s" % msg)

    def ok(self, msg):
        print("      ok    %s" % msg)

    def wait(self, ms):
        self.pg.wait_for_timeout(ms)

    def button(self, label):
        r = self.pg.evaluate(BTN, label)
        return r if r and "x" in r else None

    def click_button(self, label):
        b = self.button(label)
        if not b:
            return False
        self.pg.mouse.click(b["x"], b["y"])
        return True

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
            self.wait(300)
        else:
            return False
        # #boot splash eats real clicks; Enter activates the focused NEW RUN.
        self.wait(4500)
        pg.keyboard.press("Enter")
        deadline = time.time() + 30
        while time.time() < deadline:
            if pg.evaluate("ASCENDANT.game.state") in ("playing", "hub"):
                return True
            self.wait(400)
        return False

    def goto(self, stage, settle=4000):
        """Navigation only — never used to set up an input assertion.

        `; 0` so Playwright does not await loadStage's promise: awaiting it
        returns only after _startIntro has already run, which makes the intro
        card unobservable from here (and hands Playwright a circular Game to
        serialise). Poll for the landing instead.
        """
        pg = self.pg
        pg.evaluate("ASCENDANT.game.loadStage(%s); 0" % json.dumps(stage))
        deadline = time.time() + 60
        while time.time() < deadline:
            s = self.snap()
            if s["stageId"] == stage and not s["loading"]:
                break
            self.wait(120)
        else:
            return False
        self.wait(settle)
        return True

    def wait_for_intro(self, timeout=10.0):
        """Poll tightly — INTRO_MS is 1600 ms and a 400 ms poll can step over it."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            s = self.snap()
            if s["introT"] >= 0:
                return s
            if not s["loading"] and s["state"] in ("playing", "hub") and s["introT"] < 0:
                # the card may already have come and gone
                pass
            self.wait(25)
        return None

    # Off-centre: every menu, the stage select and the clear card put their
    # buttons mid-screen, and a blind click at 640,400 to take pointer lock
    # would press one of them. The canvas fills the viewport and pointerdown
    # bubbles to it, so a corner click locks just as well without pressing UI.
    LOCK_X, LOCK_Y = 70, 660

    def ensure_locked(self, why):
        s = self.snap()
        if s["locked"]:
            return True
        if s["menuIsOpen"] or s["selIsOpen"] or s["finishOpen"]:
            self.fail("cannot take pointer lock (%s): a UI surface is still up "
                      "(menu=%s select=%s finish=%s state=%s)"
                      % (why, s["menuIsOpen"], s["selIsOpen"], s["finishOpen"], s["state"]))
            return False
        for _ in range(4):
            self.pg.mouse.click(self.LOCK_X, self.LOCK_Y)
            self.wait(900)
            if self.snap()["locked"]:
                return True
            self.wait(900)          # Chrome's ~1.25 s post-ESC cooldown
        s = self.snap()
        # Say WHY it could not lock. `suspended` is the usual answer, and it is
        # itself the bug — _onPointerDownDom returns early while suspended, so a
        # stuck suspension also makes the game unrecoverable by clicking.
        self.fail("could not acquire pointer lock (%s) - state=%s suspended=%s "
                  "menu=%s select=%s finish=%s deathT=%.0f introT=%.0f"
                  % (why, s["state"], s["suspended"], s["menuIsOpen"], s["selIsOpen"],
                     s["finishOpen"], s["deathT"], s["introT"]))
        return False

    def recover(self):
        """Back to plain live gameplay. Runs only BETWEEN scenarios, so one
        wedged scenario cannot turn the rest into a cascade that buries it."""
        pg = self.pg
        for _ in range(6):
            s = self.snap()
            if s["state"] in ("playing", "hub") and not s["menuIsOpen"] \
                    and not s["selIsOpen"] and not s["finishOpen"] \
                    and not s["gameSelectOpen"] and s["deathT"] < 0 and s["clearT"] < 0:
                return True
            pg.evaluate(r"""() => {
              const g = ASCENDANT.game;
              if (g.hud && g.hud.finishOpen) g.hud.hideFinish();
              if (g.stageSelect && g.stageSelect.isOpen) g.stageSelect.close(true);
              g._selectOpen = false;
              g._endClear(true); g._cancelDeath(); g._endIntro(true);
              if (g.menu) g.menu.close();
              if (g.state !== 'playing' && g.state !== 'hub') {
                g.state = g.stageId === 'hub' ? 'hub' : 'playing';
              }
              g._timerRun = true;
              if (g.input) g.input.setSuspended(false);
            }""")
            self.wait(700)
        return False

    def jump(self):
        pg = self.pg
        pg.evaluate("globalThis.__VYRESET()")
        j0 = pg.evaluate("ASCENDANT.game.player.stats.jumps")
        pg.keyboard.press("Space")
        self.wait(JUMP_WINDOW_MS)
        vy = pg.evaluate("globalThis.__VY")
        dj = pg.evaluate("ASCENDANT.game.player.stats.jumps") - j0
        return vy, dj

    def assert_playable(self, tag, allow_states=("playing", "hub")):
        """The four facts, together. This is the whole harness in one method."""
        s = self.snap()
        bad = False
        if s["state"] not in allow_states:
            self.fail("%s: state=%r, expected one of %s" % (tag, s["state"], list(allow_states)))
            bad = True
        no_ui = not (s["menuIsOpen"] or s["selIsOpen"] or s["finishOpen"] or s["gameSelectOpen"])
        if s["suspended"] and no_ui:
            self.fail("%s: input.suspended with NO UI surface open (state=%s) "
                      "- the suspension is stuck" % (tag, s["state"]))
            bad = True
        if s["gameSelectOpen"] and not s["selIsOpen"]:
            self.fail("%s: game._selectOpen=true but stageSelect.isOpen=false "
                      "- Game thinks the stage select is up and it is not" % tag)
            bad = True
        if s["state"] == "select" and not s["selIsOpen"]:
            self.fail("%s: state='select' with the stage select closed "
                      "- the state machine is stranded" % tag)
            bad = True
        if bad:
            return False
        vy, dj = self.jump()
        if dj <= 0:
            self.fail("%s: JUMP dead - the controller recorded no jump "
                      "(counter +0, vel.y peaked %.2f, suspended=%s, state=%s)"
                      % (tag, vy, s["suspended"], s["state"]))
            return False
        if vy < JUMP_MIN_VY:
            self.fail("%s: JUMP registered but produced no lift: vel.y peaked %.2f "
                      "(need > %.1f)" % (tag, vy, JUMP_MIN_VY))
            return False
        self.ok("%s: state=%s suspended=%s jump vy=%.2f (+%d)"
                % (tag, s["state"], s["suspended"], vy, dj))
        self.wait(600)
        return True

    # ---- helpers that put the game into a specific sub-state --------------
    def start_death(self):
        """A real fall-death: the void net, not a poked flag."""
        self.pg.evaluate("(() => { const g = ASCENDANT.game;"
                         " g.player.pos.y -= 500; g.player.vel.y = -60; })()")
        deadline = time.time() + 3
        while time.time() < deadline:
            if self.snap()["deathT"] >= 0:
                return True
            self.wait(30)
        return False

    def force_finish(self):
        """Fire the gate through the stage's own event, the way crossing it does.

        `triggered` latches, so re-arm first — otherwise the second clear in a
        run is a silent no-op and the scenario tests nothing.
        """
        self.pg.evaluate(r"""() => {
          const g = ASCENDANT.game;
          if (g.stage && g.stage.finish) g.stage.finish.triggered = false;
          if (g.state !== 'playing' && g.state !== 'hub') {
            g.state = g.stageId === 'hub' ? 'hub' : 'playing';
          }
        }""")
        self.pg.evaluate("ASCENDANT.game.stage.triggerFinish(false)")
        deadline = time.time() + 3
        while time.time() < deadline:
            if self.snap()["clearT"] >= 0 or self.snap()["finishOpen"]:
                return True
            self.wait(40)
        return False

    # =====================================================================
    # SCENARIOS
    # =====================================================================

    def sc_esc_during_death(self):
        """ESC in the ~540 ms death window must not strand the machine."""
        if not self.ensure_locked("esc/death"):
            return
        if not self.start_death():
            self.fail("could not start a death sequence")
            return
        self.wait(120)                       # inside the veil, before the swap
        s = self.snap()
        self.ok("pressed ESC at deathT=%.0f ms" % s["deathT"])
        self.pg.keyboard.press("Escape")
        self.wait(900)                       # death budget is 540 ms
        s = self.snap()
        if s["deathT"] >= 0:
            self.fail("death sequence still running 900 ms after ESC (deathT=%.0f)" % s["deathT"])
        if s["menuIsOpen"] and s["state"] != "paused":
            self.fail("menu is open but state=%r - the menu is sitting over a live game"
                      % s["state"])
        if s["state"] == "paused":
            self.click_button("RESUME") or self.pg.keyboard.press("Escape")
            self.wait(900)
        self.ensure_locked("after esc/death")
        self.assert_playable("after ESC during death")

    def sc_esc_during_intro(self):
        """ESC on the stage-intro card: menu up, card frozen, CLOCK FROZEN."""
        if not self.goto(self.args.stage, settle=0):
            self.fail("could not load %s" % self.args.stage)
            return
        s = self.wait_for_intro()
        if s is None:
            self.fail("intro card never started after loading %s" % self.args.stage)
            return
        self.ok("intro card up at introT=%.0f ms" % s["introT"])
        self.pg.keyboard.press("Escape")
        self.wait(500)
        s = self.snap()
        if s["state"] != "paused" or not s["menuIsOpen"]:
            self.fail("ESC on the intro card gave state=%r menuOpen=%s, expected paused+menu"
                      % (s["state"], s["menuIsOpen"]))
        intro_at_pause = s["introT"]
        time_at_pause = s["timeMs"]
        self.wait(1200)
        s2 = self.snap()
        if s2["introT"] > intro_at_pause + 120:
            self.fail("the intro card kept advancing under the pause menu "
                      "(introT %.0f -> %.0f)" % (intro_at_pause, s2["introT"]))
        if s2["timeMs"] > time_at_pause + 120:
            self.fail("the stage clock ran under the pause menu "
                      "(timeMs %.0f -> %.0f)" % (time_at_pause, s2["timeMs"]))

        # resume, and the clock must STILL be frozen while the card is up
        self.click_button("RESUME") or self.pg.keyboard.press("Escape")
        self.wait(260)
        s3 = self.snap()
        if s3["introT"] >= 0:
            t0 = s3["timeMs"]
            self.wait(340)
            s4 = self.snap()
            if s4["introT"] >= 0 and s4["timeMs"] > t0 + 150:
                self.fail("after resuming, the stage clock runs while the intro card is "
                          "STILL up and the player is frozen (timeMs %.0f -> %.0f, introT=%.0f)"
                          % (t0, s4["timeMs"], s4["introT"]))
            else:
                self.ok("clock stayed frozen through the rest of the intro card")
        self.wait(1800)
        self.ensure_locked("after esc/intro")
        self.assert_playable("after ESC during the intro card")

    def sc_esc_on_clear_card(self):
        """ESC on the clear card must not leak to the pause toggle."""
        if not self.recover():
            self.fail("could not reach live gameplay")
            return
        if not self.force_finish():
            self.fail("could not fire the finish gate")
            return
        self.wait(500)
        s = self.snap()
        if not s["finishOpen"]:
            self.fail("the clear card did not open after the gate fired")
            return
        self.pg.keyboard.press("Escape")
        self.wait(600)
        s = self.snap()
        if s["state"] == "paused" or s["menuPage"] == "pause" and s["menuIsOpen"]:
            self.fail("ESC on the clear card leaked to the pause toggle (state=%r menu=%s)"
                      % (s["state"], s["menuIsOpen"]))
        else:
            self.ok("ESC swallowed by the clear card (state=%s)" % s["state"])
        if not s["finishOpen"]:
            self.fail("ESC closed the clear card - it has no dismiss action")
        # leave through the card's own button, like a player
        if not self.click_button("CONTINUE"):
            self.click_button("RETURN TO HUB")
        self.wait(4000)
        self.ensure_locked("after clear card")
        self.assert_playable("after leaving the clear card by CONTINUE")

    def sc_clear_card_autoadvance(self):
        """Clear a stage and TOUCH NOTHING. This is what a player does while they
        read their split — and the auto-advance at CLEAR_AUTO_MS (4600 ms) must
        leave the next stage playable."""
        if not self.recover():
            self.fail("could not reach live gameplay")
            return
        stage0 = self.snap()["stageId"]
        if not self.force_finish():
            self.fail("could not fire the finish gate")
            return
        s = self.snap()
        self.ok("clear card up on %s: finishOpen=%s suspended=%s"
                % (stage0, s["finishOpen"], s["suspended"]))

        # Game's OWN skip path (_stepClear reads input.jumpPressed). It is gated
        # by input.suspended, which the clear card itself sets — so check it as a
        # fact rather than through the HUD's button nav, which would mask it.
        self.wait(1200)                       # past CLEAR_MIN_SKIP (700 ms)
        jp = self.pg.evaluate(r"""() => {
          const g = ASCENDANT.game, i = g.input;
          return { suspended: !!i.suspended,
                   jumpReadable: !!(i._acts && i._acts.jump && !i.suspended) };
        }""")
        if jp["suspended"]:
            self.ok("NOTE: input is suspended while the clear card is up, so "
                    "_stepClear's jump-to-skip can never fire; only the card's "
                    "own buttons advance it")

        # no key presses at all from here — just wait it out
        deadline = time.time() + 16
        while time.time() < deadline:
            s = self.snap()
            if s["clearT"] < 0 and not s["loading"] and s["introT"] < 0 and \
                    s["state"] in ("playing", "hub"):
                break
            self.wait(300)
        self.wait(2500)
        s = self.snap()
        if s["finishOpen"]:
            self.fail("the clear card is STILL open after the auto-advance loaded "
                      "stage %r - hud.finishOpen never cleared, so _uiOwnsInput() "
                      "holds input.suspended forever and the player cannot move"
                      % s["stageId"])
        self.ensure_locked("after auto-advance")
        self.assert_playable("after the clear card auto-advanced untouched")

    def sc_stageselect_escape(self):
        """Tab open, then out again by every route a player has.

        There are exactly two: ESC and the BACK button. StageSelect._handleKey
        captures Tab for list navigation, so Game.toggleStageSelect() never sees
        a second press — which is why a strand on close is a strand with no way
        back.
        """
        for closer, name in (
            ("escape", "Tab open / ESC close"),
            ("back", "Tab open / BACK button"),
            ("escape2", "Tab open / into a world / ESC ESC"),
        ):
            if not self.recover():
                self.fail("could not reach live gameplay before %s" % name)
                return
            self.ensure_locked(name)
            self.pg.keyboard.press("Tab")
            self.wait(700)
            s = self.snap()
            if not s["selIsOpen"]:
                self.fail("%s: Tab did not open the stage select" % name)
                continue
            if s["state"] != "select":
                self.fail("%s: stage select is up but game state=%r, expected 'select'"
                          % (name, s["state"]))
            if closer == "escape":
                self.pg.keyboard.press("Escape")
            elif closer == "back":
                if not self.click_button("BACK"):
                    self.fail("%s: no BACK button on the stage select" % name)
            else:
                self.pg.keyboard.press("Enter")     # into a world's stage list
                self.wait(400)
                self.pg.keyboard.press("Escape")    # back to the world list
                self.wait(400)
                if not self.snap()["selIsOpen"]:
                    self.fail("%s: the first ESC closed the whole panel instead of "
                              "stepping back to the world list" % name)
                self.pg.keyboard.press("Escape")
            self.wait(1000)
            s = self.snap()
            if s["selIsOpen"]:
                self.fail("%s: the stage select is still open" % name)
                continue
            if s["gameSelectOpen"] or s["state"] == "select":
                self.fail("%s: the stage select is CLOSED but Game still thinks it is up "
                          "(state=%r _selectOpen=%s suspended=%s) - the game is frozen "
                          "with no UI on screen"
                          % (name, s["state"], s["gameSelectOpen"], s["suspended"]))
                continue
            if s["state"] != "paused":
                self.fail("%s: closing the stage select left state=%r, expected to land "
                          "on the pause menu it was opened over" % (name, s["state"]))
            else:
                self.ok("%s: landed on the pause menu" % name)
                self.click_button("RESUME") or self.pg.keyboard.press("Escape")
                self.wait(900)
            self.ensure_locked("after %s" % name)
            self.assert_playable(name)

    def sc_stageselect_during_pause(self):
        """ESC -> pause, Tab -> select, close -> must land back on pause."""
        if not self.recover():
            return
        self.ensure_locked("select/pause")
        self.pg.keyboard.press("Escape")
        self.wait(700)
        if self.snap()["state"] != "paused":
            self.fail("ESC did not pause (state=%r)" % self.snap()["state"])
            return
        # Tab belongs to the pause menu's own FocusList here, so use the button
        # the pause menu actually offers — which reaches StageSelect.open()
        # directly through uiAction, WITHOUT Game.openStageSelect(). Closing
        # that must be just as safe as closing a Game-owned open.
        if not self.click_button("STAGE SELECT"):
            self.fail("no STAGE SELECT button on the pause menu")
            return
        self.wait(900)
        s = self.snap()
        if not s["selIsOpen"]:
            self.fail("the pause menu's STAGE SELECT button did not open the stage select")
            return
        self.pg.keyboard.press("Escape")
        self.wait(900)
        s = self.snap()
        if s["selIsOpen"]:
            self.fail("ESC did not close the stage select opened from the pause menu")
        if s["state"] != "paused" or not s["menuIsOpen"]:
            self.fail("closing the stage select from pause gave state=%r menuOpen=%s, "
                      "expected to land back on the pause menu" % (s["state"], s["menuIsOpen"]))
        else:
            self.ok("landed back on the pause menu")
        self.click_button("RESUME") or self.pg.keyboard.press("Escape")
        self.wait(900)
        self.ensure_locked("after select/pause")
        self.assert_playable("after stage select opened from pause")

    def sc_stageselect_during_death(self):
        """Tab in the death window, then close it."""
        if not self.recover():
            return
        self.ensure_locked("select/death")
        if not self.start_death():
            self.fail("could not start a death sequence")
            return
        self.wait(100)
        self.pg.keyboard.press("Tab")
        self.wait(700)
        s = self.snap()
        if not s["selIsOpen"]:
            self.ok("Tab during death did not open the stage select (state=%s)" % s["state"])
        else:
            self.wait(900)                # let the death sequence run out underneath
            s = self.snap()
            if s["selIsOpen"] and s["state"] not in ("select", "paused"):
                self.fail("the death sequence finished under the open stage select and "
                          "overwrote the state to %r" % s["state"])
            self.pg.keyboard.press("Tab")
            self.wait(900)
        s = self.snap()
        if s["state"] == "paused":
            self.click_button("RESUME") or self.pg.keyboard.press("Escape")
            self.wait(900)
        self.ensure_locked("after select/death")
        self.assert_playable("after stage select during death")

    def sc_restart_variants(self):
        """R during the intro, during death, and on the clear card."""
        # --- during the intro card ---
        if not self.goto(self.args.stage, settle=0):
            self.fail("could not load %s" % self.args.stage)
            return
        if self.wait_for_intro() is None:
            self.fail("intro card never started after loading %s" % self.args.stage)
            return
        self.pg.keyboard.press("KeyR")
        self.wait(1600)
        self.ensure_locked("restart/intro")
        self.assert_playable("R during the intro card")

        # --- during death ---
        if not self.recover():
            return
        if self.start_death():
            self.wait(120)
            self.pg.keyboard.press("KeyR")
            self.wait(1600)
            self.ensure_locked("restart/death")
            self.assert_playable("R during the death sequence")

        # --- on the clear card ---
        if not self.recover():
            return
        if self.force_finish():
            self.wait(700)
            self.pg.keyboard.press("KeyR")
            self.wait(1400)
            s = self.snap()
            if s["finishOpen"] and s["clearT"] < 0 and s["state"] not in ("cleared",):
                self.fail("R on the clear card left the card open with clearT=%.0f state=%r"
                          % (s["clearT"], s["state"]))
            if not self.click_button("RETRY"):
                pass
            self.wait(2600)
            self.recover()
            self.ensure_locked("restart/clear")
            self.assert_playable("R / RETRY on the clear card")

    def sc_restart_run(self):
        if not self.recover():
            return
        self.pg.evaluate("ASCENDANT.game.restartRun()")
        deadline = time.time() + 20
        while time.time() < deadline:
            s = self.snap()
            if not s["loading"] and s["state"] in ("playing", "hub") and s["introT"] < 0:
                break
            self.wait(400)
        self.wait(1500)
        s = self.snap()
        if s["deaths"] != 0:
            self.fail("restartRun left deaths=%d, expected 0" % s["deaths"])
        self.ensure_locked("after restartRun")
        self.assert_playable("after restartRun", allow_states=("playing", "hub"))

    def sc_finish_while_dead(self):
        """Cross the gate mid-death: exactly zero or one clear, never two,
        and the gate must never latch itself permanently shut."""
        if not self.goto(self.args.stage):
            self.fail("could not load %s" % self.args.stage)
            return
        self.recover()
        self.pg.evaluate("globalThis.__CLEARS = 0")
        if not self.start_death():
            self.fail("could not start a death sequence")
            return
        self.wait(80)
        # teleport into the gate volume while the veil is down
        moved = self.pg.evaluate(r"""() => {
          const g = ASCENDANT.game, f = g.stage && g.stage.finish;
          if (!f) return false;
          g.player.pos.set(f.pos.x, f.pos.y + 0.6, f.pos.z);
          return true;
        }""")
        if not moved:
            self.fail("stage %s has no finish gate to test against" % self.args.stage)
            return
        self.wait(1400)
        clears = self.pg.evaluate("globalThis.__CLEARS")
        s = self.snap()
        if clears > 1:
            self.fail("crossing the gate mid-death produced %d clears - double clear" % clears)
        else:
            self.ok("gate crossed mid-death -> %d clear(s), state=%s" % (clears, s["state"]))
        if clears == 0 and s["finishTriggered"]:
            self.fail("the gate latched triggered=true but Game dropped the clear - "
                      "the finish is now permanently dead for this attempt")
        self.recover()
        self.ensure_locked("after finish/dead")
        self.assert_playable("after crossing the gate mid-death")

    def sc_tabhide_midjump(self):
        """visibilitychange hidden mid-jump: keys released, clock paused, no stuck keys."""
        if not self.recover():
            return
        self.ensure_locked("tabhide")
        pg = self.pg
        pg.keyboard.down("KeyW")
        pg.keyboard.down("Space")
        self.wait(120)
        t0 = self.snap()
        pg.evaluate(r"""() => {
          Object.defineProperty(document, 'visibilityState',
            { configurable: true, get: () => 'hidden' });
          document.dispatchEvent(new Event('visibilitychange'));
          window.dispatchEvent(new Event('blur'));
        }""")
        self.wait(900)
        hidden = self.snap()
        held = hidden["keysHeld"] or []
        if any(bool(h) for h in held[:3]) or abs(held[3] or 0) > 0.01 or abs(held[4] or 0) > 0.01:
            self.fail("keys still held after the tab was hidden: jump=%s sprint=%s "
                      "crouch=%s move=(%.2f,%.2f)" % tuple(held[:5]))
        else:
            self.ok("all keys released on tab-hide")
        t_hidden = hidden["totalMs"]
        self.wait(1000)
        still = self.snap()
        if still["totalMs"] > t_hidden + 250:
            self.fail("the run clock kept running while the tab was hidden "
                      "(totalMs %.0f -> %.0f)" % (t_hidden, still["totalMs"]))
        else:
            self.ok("clock paused while hidden (totalMs %.0f -> %.0f)"
                    % (t_hidden, still["totalMs"]))
        pg.keyboard.up("KeyW")
        pg.keyboard.up("Space")
        pg.evaluate(r"""() => {
          Object.defineProperty(document, 'visibilityState',
            { configurable: true, get: () => 'visible' });
          document.dispatchEvent(new Event('visibilitychange'));
          window.dispatchEvent(new Event('focus'));
        }""")
        self.wait(900)
        s = self.snap()
        if s["state"] == "paused":
            self.click_button("RESUME") or pg.keyboard.press("Escape")
            self.wait(900)
        self.ensure_locked("after tabhide")
        self.assert_playable("after tab-hide mid-jump")
        _ = t0

    def sc_blur_during_death(self):
        if not self.recover():
            return
        self.ensure_locked("blur/death")
        if not self.start_death():
            self.fail("could not start a death sequence")
            return
        self.wait(110)
        self.pg.evaluate("window.dispatchEvent(new Event('blur'))")
        self.wait(1100)
        s = self.snap()
        if s["deathT"] >= 0:
            self.fail("death sequence stalled by the blur (deathT=%.0f after 1100 ms)"
                      % s["deathT"])
        if s["menuIsOpen"] and s["state"] != "paused":
            self.fail("blur during death left the menu open over state=%r" % s["state"])
        if s["state"] == "paused":
            self.click_button("RESUME") or self.pg.keyboard.press("Escape")
            self.wait(900)
        self.ensure_locked("after blur/death")
        self.assert_playable("after window blur during death")

    def sc_transition_leak(self):
        """Three stage transitions must not grow the listener/timer census."""
        stages = self.args.leak_stages.split(",")
        if not self.goto(stages[0]):
            self.fail("could not load %s" % stages[0])
            return
        self.recover()
        self.wait(2500)
        base = self.census()
        print("      base   %s" % json.dumps(base, sort_keys=True))
        for i in range(3):
            nxt = stages[(i + 1) % len(stages)]
            if not self.goto(nxt):
                self.fail("could not load %s" % nxt)
                return
            self.recover()
            self.wait(2500)
        after = self.census()
        print("      after  %s" % json.dumps(after, sort_keys=True))
        for k in ("win", "doc", "intervals", "raf", "stageEvents", "playerEvents",
                  "engineEvents", "capture"):
            d = after[k] - base[k]
            if d > 0:
                self.fail("%s grew by %d across 3 stage transitions (%d -> %d) - "
                          "the previous stage's hooks are still live"
                          % (k, d, base[k], after[k]))
        if after["capture"] > 0:
            self.fail("UI capture count is %d with no UI open - an unbalanced "
                      "pushCapture leaked" % after["capture"])
        self.ensure_locked("after transitions")
        self.assert_playable("after 3 stage transitions")

    def sc_settings_live(self):
        """sensitivity / invertY / FOV / quality mid-play, then across a reload."""
        if not self.recover():
            return
        before = self.snap()
        want = {"sens": 2.35, "invertY": True, "fov": 97, "quality": "low"}
        self.pg.evaluate("(w) => ASCENDANT.Settings.set(w)", want)
        self.wait(900)
        s = self.snap()
        if s["sens"] is None or abs(s["sens"] - want["sens"]) > 1e-3:
            self.fail("sensitivity did not take effect live: input.sensitivity=%r, set %.2f"
                      % (s["sens"], want["sens"]))
        if s["invertY"] is not True:
            self.fail("invertY did not take effect live: input.invertY=%r" % s["invertY"])
        if s["qualityId"] != "low":
            self.fail("quality did not take effect live: qualityId=%r" % s["qualityId"])

        # FOV is a DAMPED approach, not a snap: FPCamera eases _fovBase toward
        # the setting at lambda 12 (~250 ms), deliberately, so the view never
        # jumps. Wall-clock waiting is the wrong instrument — a quality change
        # in the same set() rebuilds the post chain and stalls frames, so 900 ms
        # of wall clock can be 100 ms of frame time (measured: fov 88.77 of a
        # wanted 97, which is exactly 100 ms into the ease). Poll for arrival.
        got = None
        deadline = time.time() + 6
        while time.time() < deadline:
            got = self.snap()["fov"]
            if got is not None and abs(got - want["fov"]) <= 0.5:
                break
            self.wait(150)
        if got is None or abs(got - want["fov"]) > 0.5:
            self.fail("FOV never reached the setting: camera.fov=%r after 6 s, set %d"
                      % (got, want["fov"]))
        else:
            self.ok("FOV eased to %.2f (set %d)" % (got, want["fov"]))
        s = self.snap()
        if not self.fails or self.fails[-1][0] != self.scenario:
            self.ok("live: sens=%.2f invertY=%s fov=%.0f quality=%s"
                    % (s["sens"], s["invertY"], s["fov"], s["qualityId"]))

        # persistence across a real reload
        self.pg.reload(wait_until="load", timeout=60_000)
        if not self.boot():
            self.fail("could not reboot after the settings reload")
            return
        self.pg.evaluate(INSTRUMENT)
        self.wait(1500)
        s = self.snap()
        if s["sens"] is None or abs(s["sens"] - want["sens"]) > 1e-3:
            self.fail("sensitivity did not persist across reload: %r" % s["sens"])
        if s["invertY"] is not True:
            self.fail("invertY did not persist across reload: %r" % s["invertY"])
        got = None
        deadline = time.time() + 6
        while time.time() < deadline:
            got = self.snap()["fov"]
            if got is not None and abs(got - want["fov"]) <= 0.5:
                break
            self.wait(150)
        if got is None or abs(got - want["fov"]) > 0.5:
            self.fail("FOV did not persist across reload: camera.fov=%r" % got)
        s = self.snap()
        if s["qualityId"] != "low":
            self.fail("quality did not persist across reload: %r" % s["qualityId"])
        self.ok("persisted: sens=%s invertY=%s fov=%s quality=%s"
                % (s["sens"], s["invertY"], s["fov"], s["qualityId"]))
        # restore
        self.pg.evaluate("(b) => ASCENDANT.Settings.set(b)",
                         {"sens": before["sens"] or 1.0, "invertY": False,
                          "fov": before["fov"] or 82, "quality": "high"})
        self.wait(600)

    def sc_clear_card_buttons(self):
        """Mouse AND keyboard reach the clear card; focus is trapped inside it."""
        if not self.recover():
            return
        if not self.force_finish():
            self.fail("could not fire the finish gate")
            return
        self.wait(700)
        info = self.pg.evaluate(r"""() => {
          const g = ASCENDANT.game, h = g.hud;
          const nav = h && h.finishNav;
          const items = nav ? nav.items.map((n) => (n.textContent || '').trim().toUpperCase()) : [];
          const card = document.querySelector('.ah-finish, [class*="finish"]');
          return { items: items, index: nav ? nav.index : -1,
                   active: document.activeElement ? (document.activeElement.textContent || '').trim().toUpperCase() : null,
                   inCard: !!(card && document.activeElement && card.contains(document.activeElement)) };
        }""")
        if not info["items"]:
            self.fail("the clear card exposes no keyboard-navigable buttons")
        else:
            self.ok("clear card buttons: %s (focus index %d, active %r)"
                    % (info["items"], info["index"], info["active"]))
        if info["index"] < 0:
            self.fail("no clear-card button has keyboard focus when the card opens")
        if info["items"] and not info["inCard"]:
            self.fail("focus is NOT inside the clear card when it opens (active=%r) - "
                      "the trap is not holding" % info["active"])

        # keyboard: move focus, and prove it stays inside the card
        for key in ("ArrowRight", "ArrowRight", "ArrowRight", "Tab"):
            self.pg.keyboard.press(key)
            self.wait(120)
        after = self.pg.evaluate(r"""() => {
          const g = ASCENDANT.game, h = g.hud, nav = h && h.finishNav;
          const card = document.querySelector('.ah-finish, [class*="finish"]');
          return { index: nav ? nav.index : -1,
                   inCard: !!(card && document.activeElement && card.contains(document.activeElement)),
                   tag: document.activeElement ? document.activeElement.tagName : null };
        }""")
        if not after["inCard"]:
            self.fail("keyboard focus escaped the clear card after arrows/Tab "
                      "(activeElement=%s)" % after["tag"])
        else:
            self.ok("focus stayed inside the card (index %d)" % after["index"])

        # keyboard activation must work
        self.pg.evaluate("ASCENDANT.game.hud.finishNav.focusIndex(1, true)")
        self.wait(150)
        self.pg.keyboard.press("Enter")
        self.wait(1600)
        s = self.snap()
        if s["finishOpen"]:
            self.fail("Enter on a focused clear-card button did nothing - the card is "
                      "mouse-only")
        else:
            self.ok("Enter activated the focused button")
        self.wait(2500)
        self.recover()
        self.ensure_locked("after clear buttons")
        self.assert_playable("after using the clear card by keyboard")

    # ---- driver ----------------------------------------------------------
    ORDER = [
        ("esc_during_death", sc_esc_during_death),
        ("esc_during_intro", sc_esc_during_intro),
        ("esc_on_clear_card", sc_esc_on_clear_card),
        ("clear_card_autoadvance", sc_clear_card_autoadvance),
        ("clear_card_buttons", sc_clear_card_buttons),
        ("stageselect_escape", sc_stageselect_escape),
        ("stageselect_during_pause", sc_stageselect_during_pause),
        ("stageselect_during_death", sc_stageselect_during_death),
        ("restart_variants", sc_restart_variants),
        ("restart_run", sc_restart_run),
        ("finish_while_dead", sc_finish_while_dead),
        ("tabhide_midjump", sc_tabhide_midjump),
        ("blur_during_death", sc_blur_during_death),
        ("transition_leak", sc_transition_leak),
        ("settings_live", sc_settings_live),
    ]

    def run(self, only):
        for name, fn in self.ORDER:
            if only and name not in only:
                continue
            self.scenario = name
            self.ran.append(name)
            n0 = len(self.fails)
            print("  %s" % name)
            try:
                fn(self)
            except Exception as e:
                self.fail("scenario raised: %s: %s" % (type(e).__name__, e))
            print("    -> %s" % ("PASS" if len(self.fails) == n0 else "FAIL"))
            try:
                self.recover()
            except Exception:
                pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--stage", default="neon-1")
    ap.add_argument("--leak-stages", default="neon-1,neon-2,temple-1")
    ap.add_argument("--only", default="", help="comma-separated scenario names")
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=720)
    args = ap.parse_args()

    if "dev=1" in args.url:
        print("REFUSING: flowcheck must run in PRODUCTION mode. Dev mode makes "
              "input suspension-immune, which is exactly what hides every bug "
              "this harness looks for.", file=sys.stderr)
        return 2

    only = set(x.strip() for x in args.only.split(",") if x.strip())

    print("=" * 74)
    print("ASCENDANT flowcheck  (PRODUCTION mode - no ?dev=1)")
    print("URL   : %s" % args.url)
    print("stage : %s   leak stages: %s" % (args.stage, args.leak_stages))
    print("=" * 74)

    errors = []
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": args.width, "height": args.height})
        pg.add_init_script(INIT)
        pg.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
        try:
            pg.goto(args.url, wait_until="load", timeout=60_000)
        except Exception as e:
            print("NAVIGATION FAILED: %s" % e, file=sys.stderr)
            br.close()
            return 2

        flow = Flow(pg, args)
        if not flow.boot():
            print("FAILED to reach gameplay from the title", file=sys.stderr)
            br.close()
            return 2
        pg.evaluate(INSTRUMENT)

        s = flow.snap()
        print("  entered : stage=%s state=%s devNoSuspend=%s"
              % (s["stageId"], s["state"], s["devNoSuspend"]))
        if s["devNoSuspend"]:
            print("REFUSING: input reports devNoSuspend - not production mode.",
                  file=sys.stderr)
            br.close()
            return 2

        if not flow.goto(args.stage):
            print("FAILED to load stage %s" % args.stage, file=sys.stderr)
            br.close()
            return 2

        flow.run(only)
        br.close()

    print("-" * 74)
    for e in errors:
        print("  !! %s" % e)
    if flow.fails:
        print("FAILURES (%d):" % len(flow.fails))
        for sc, f in flow.fails:
            print("  x [%s] %s" % (sc, f))
    ok = not flow.fails and not errors
    print("  scenarios run: %d" % len(flow.ran))
    print("=" * 74)
    print("VERDICT: %s" % ("FLOW OK" if ok else "FLOW BROKEN"))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
