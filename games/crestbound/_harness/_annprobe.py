#!/usr/bin/env python
"""Scratch probe (UI lane): the centre-screen announcement stage.

Reproduces the reject's collisions and asserts the fix:
  1. crest ribbon + checkpoint fired on the same frame -> ONE layer on screen.
  2. death fired during the ribbon -> the ribbon is gone, the cause word is up.
  3. after returnToKeep the centre layer is blank (no stale "CREST CLAIMED").
  4. course-clear panel is not painted over by a live ribbon.
Screens land in _shots/ui/ as ann_*.png.
"""
import base64
import io
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright
from PIL import Image

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "_shots", "ui"))
URL = "http://localhost:8788/games/crestbound/index.html?dev=1"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required", "--force-device-scale-factor=1"]
VIEW = {"width": 1600, "height": 900}

# Which centre layers are actually on stage, and what they say.
STAGE_JS = """() => {
  const r = document.querySelector('.ch-ribbon'), w = document.querySelector('.ch-word');
  const vis = (n) => !!n && n.offsetParent !== null && getComputedStyle(n).display !== 'none';
  return {
    ribbonOn: vis(r), wordOn: vis(w),
    ribbonText: r ? (r.textContent || '').trim() : '',
    wordText: w ? (w.textContent || '').trim() : '',
    stage: CRESTBOUND.game.hud ? (CRESTBOUND.game.hud._annKind || '') : '?',
    queued: CRESTBOUND.game.hud ? CRESTBOUND.game.hud._annQueue.length : -1,
  };
}"""

fails = []


def ok(name, passed, detail=""):
    print(("  PASS  " if passed else "  FAIL  ") + name + (("   " + str(detail)[:300]) if detail else ""))
    if not passed:
        fails.append(name)


class Cap:
    def __init__(self, pg):
        self.pg, self.frames = pg, []
        self.cdp = pg.context.new_cdp_session(pg)
        self.cdp.send("Page.enable")
        self.cdp.on("Page.screencastFrame", self._on)
        self.cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 92, "everyNthFrame": 1,
                                               "maxWidth": VIEW["width"], "maxHeight": VIEW["height"]})

    def _on(self, pl):
        self.frames.append((time.time(), pl["data"]))
        if len(self.frames) > 400:
            del self.frames[:200]
        try:
            self.cdp.send("Page.screencastFrameAck", {"sessionId": pl["sessionId"]})
        except Exception:
            pass

    def still(self, name):
        t = t0 = time.time()
        while time.time() - t0 < 25:
            fresh = [f for f in self.frames if f[0] > t]
            if len(fresh) >= 2:
                Image.open(io.BytesIO(base64.b64decode(fresh[-1][1]))).convert("RGB").save(os.path.join(OUT, name))
                print("  shot  %-24s %4.1f s" % (name, time.time() - t))
                return
            self.pg.wait_for_timeout(60)


with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
    pg = br.new_context(viewport=VIEW).new_page()
    errs = []
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL, wait_until="load", timeout=60000)
    cap = Cap(pg)
    pg.wait_for_function("() => globalThis.CRESTBOUND && CRESTBOUND.game", timeout=60000)
    pg.wait_for_function("() => CRESTBOUND.game.state === 'title'", timeout=180000)
    pg.evaluate("() => CRESTBOUND.game.newGame()")
    pg.wait_for_function("() => CRESTBOUND.game.state === 'keep'", timeout=60000)
    pg.evaluate("() => CRESTBOUND.game.__dev.goto('verdant-1')")
    pg.wait_for_function("() => ['playing','cinematic'].includes(CRESTBOUND.game.state)", timeout=90000)
    for _ in range(40):
        if pg.evaluate("() => CRESTBOUND.game.state") == "playing":
            break
        pg.evaluate("() => CRESTBOUND.game._endCinematic && CRESTBOUND.game._endCinematic(false)")
        pg.wait_for_timeout(250)
    pg.wait_for_timeout(900)

    # ---- 1. crest ribbon and checkpoint on the SAME frame ------------------
    pg.evaluate("""() => { const h = CRESTBOUND.game.hud;
      h.crestGet({ id: 'sigils', name: 'EIGHT SIGILS OF THE MEADOW', type: 'open' });
      h.checkpointFlash(); }""")
    pg.wait_for_timeout(220)
    s1 = pg.evaluate(STAGE_JS)
    cap.still("ann_crest_plus_checkpoint.png")
    print("  ..    %s" % json.dumps(s1))
    ok("crest + checkpoint on one frame: only ONE centre layer is on screen",
       not (s1["ribbonOn"] and s1["wordOn"]), json.dumps(s1))
    ok("the higher-priority crest holds the stage, the checkpoint queues behind it",
       s1["stage"] == "crest" and s1["queued"] == 1, "stage=%s queued=%s" % (s1["stage"], s1["queued"]))

    # The queued checkpoint must still arrive, and alone. It is deferred by at
    # most ANN_MAX_WAIT (1200 ms) and then runs 900 ms, so poll for it rather
    # than sleeping a fixed amount past its own window.
    s2, t_end = None, time.time() + 4.0
    while time.time() < t_end:
        st = pg.evaluate(STAGE_JS)
        if st["stage"] == "checkpoint":
            s2 = st
            break
        pg.wait_for_timeout(80)
    cap.still("ann_checkpoint_after.png")
    print("  ..    %s" % json.dumps(s2))
    ok("the deferred checkpoint still plays, on its own",
       bool(s2) and s2["wordOn"] and not s2["ribbonOn"] and "CHECKPOINT" in s2["wordText"].upper(),
       json.dumps(s2))

    # ---- 2. death during the ribbon ---------------------------------------
    pg.wait_for_timeout(1200)
    pg.evaluate("""() => { const h = CRESTBOUND.game.hud;
      h.crestGet({ id: 'race', name: 'CREST ON THE RAMPARTS', type: 'open' }); }""")
    pg.wait_for_timeout(200)
    pg.evaluate("() => CRESTBOUND.game.hud.deathFlash('fall')")
    pg.wait_for_timeout(200)
    s3 = pg.evaluate(STAGE_JS)
    cap.still("ann_death_over_ribbon.png")
    print("  ..    %s" % json.dumps(s3))
    ok("death takes the stage from the ribbon immediately",
       s3["wordOn"] and not s3["ribbonOn"] and s3["stage"] == "death", json.dumps(s3))
    ok("death drops the queue rather than replaying a stale reveal", s3["queued"] == 0, s3["queued"])

    # ---- 3. course clear must not be painted over --------------------------
    pg.wait_for_timeout(1200)
    pg.evaluate("() => CRESTBOUND.game.__dev.give('open')")
    pg.wait_for_function("() => CRESTBOUND.game.state === 'clear'", timeout=30000)
    pg.wait_for_timeout(2800)
    s4 = pg.evaluate(STAGE_JS)
    cap.still("ann_course_clear.png")
    print("  ..    %s" % json.dumps(s4))
    ok("the clear panel is not painted over by a live ribbon",
       not s4["ribbonOn"] and not s4["wordOn"], json.dumps(s4))

    # ---- 4. back in the Keep, the centre layer is blank ---------------------
    pg.evaluate("() => CRESTBOUND.game.returnToKeep()")
    pg.wait_for_function("() => CRESTBOUND.game.courseId === 'keep'", timeout=90000)
    pg.wait_for_timeout(3000)
    s5 = pg.evaluate(STAGE_JS)
    hud_text = pg.evaluate("() => (document.getElementById('hud').innerText||'').toUpperCase()")
    cap.still("ann_keep_after_return.png")
    print("  ..    %s" % json.dumps(s5))
    ok("no stale ribbon in the Keep after returning",
       not s5["ribbonOn"] and not s5["wordOn"] and "CREST CLAIMED" not in hud_text,
       json.dumps(s5) + " hudHasCrestClaimed=%s" % ("CREST CLAIMED" in hud_text))
    ok("no console / page errors", not errs, json.dumps(errs[:3]))
    br.close()

print("\nANNOUNCE STAGE: %d failing" % len(fails))
sys.exit(1 if fails else 0)
