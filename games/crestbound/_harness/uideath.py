#!/usr/bin/env python
"""CRESTBOUND UI lane — observe the transient surfaces at a rate the renderer can serve.

WHY this exists (measured 2026-09-02, ui lane round 2):
  `uishots.py`'s death strip is a live screencast, so its cadence IS the game's
  frame time. At the current perf deficit (perfcheck FAIL; the screencast measured
  201-303 ms between composited frames here) the whole 620 ms death sequence is
  2-4 frames and the 220 ms rewind is ONE frame. The strip then measures the frame
  rate, not the death sequence.

  Two instruments here, neither of which edits the build:
   * TIME-SCALED REPLAY — `game._stepDeath(ms)` is the death clock's only input.
     Feeding it a fixed 6 ms per frame instead of the wall delta plays the exact
     same sequence, in the same order, ~30x slower, so the compositor can deliver
     60+ frames of it. Every pixel is the real sequence; only the clock is slowed.
     Real-time timing is NOT measured here — uishots.py measures that off the
     untouched build (`lastRespawnMs`).
   * ANIMATION FREEZE — the HUD flashes are Web Animations. Triggering one and then
     pausing document.getAnimations() at a chosen currentTime holds the frame
     indefinitely, so a 0.6 s capture can photograph a 900 ms animation.

    python uideath.py                 # headless on the real GPU (d3d11)

Writes _shots/ui/rw_*.png, _shots/ui/fx_*.png and _harness/uideath.json.
"""
import base64
import io
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
OUT = os.path.normpath(os.path.join(HERE, "..", "_shots", "ui"))
URL = "http://localhost:8788/games/crestbound/index.html?dev=1"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required", "--force-device-scale-factor=1"]
VIEW = {"width": 1600, "height": 900}
R = {"checks": [], "notes": []}


def ok(name, passed, detail=""):
    R["checks"].append({"name": name, "pass": bool(passed), "detail": str(detail)[:400]})
    print(("  PASS  " if passed else "  FAIL  ") + name + (("   " + str(detail)[:240]) if detail else ""))
    return bool(passed)


class Cap:
    def __init__(self, pg, out):
        self.pg, self.out, self.frames = pg, out, []
        self.cdp = pg.context.new_cdp_session(pg)
        self.cdp.send("Page.enable")
        self.cdp.on("Page.screencastFrame", self._on)
        self.cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 92, "everyNthFrame": 1,
                                               "maxWidth": VIEW["width"], "maxHeight": VIEW["height"]})

    def _on(self, pl):
        self.frames.append((time.time(), pl["data"]))
        if len(self.frames) > 900:
            del self.frames[:400]
        try:
            self.cdp.send("Page.screencastFrameAck", {"sessionId": pl["sessionId"]})
        except Exception:
            pass

    def still(self, name, budget=25.0):
        from PIL import Image
        t = time.time()
        while time.time() - t < budget:
            fresh = [f for f in self.frames if f[0] > t]
            if len(fresh) >= 2:
                Image.open(io.BytesIO(base64.b64decode(fresh[-1][1]))).save(os.path.join(self.out, name))
                print("  shot  %-26s %5.1f s" % (name, time.time() - t))
                return True
            self.pg.wait_for_timeout(50)
        print("  shot  %-26s STALE/none" % name)
        return False


def wait_state(pg, states, timeout=180):
    dl = time.time() + timeout
    last = None
    while time.time() < dl:
        try:
            last = pg.evaluate("()=> (globalThis.CRESTBOUND&&CRESTBOUND.game)?CRESTBOUND.game.state:null")
        except Exception:
            last = None
        if last in states:
            return True, last
        pg.wait_for_timeout(250)
    return False, last


FREEZE = """(ms) => { const a = document.getAnimations();
  for (const an of a) { try { an.pause(); an.currentTime = ms; } catch (e) {} }
  return a.length; }"""
RESUME = "() => { for (const an of document.getAnimations()) { try { an.play(); } catch (e) {} } }"


def main():
    from PIL import Image
    os.makedirs(OUT, exist_ok=True)
    console = []
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
        ctx = br.new_context(viewport=VIEW, device_scale_factor=1)
        pg = ctx.new_page()
        pg.on("console", lambda m: console.append((m.type, m.text[:200])))
        pg.on("pageerror", lambda e: console.append(("pageerror", str(e)[:200])))
        pg.goto(URL, wait_until="load", timeout=60_000)
        wait_state(pg, ("title",))
        pg.evaluate("""() => { for (const b of document.querySelectorAll('.cb-btn')) {
          const t = (b.textContent || '').trim().toUpperCase();
          if (t.startsWith('NEW GAME')) { (b.__activate || b.click).call(b); return; } } }""")
        pg.wait_for_timeout(900)
        pg.evaluate("""() => { for (const b of document.querySelectorAll('.cb-btn')) {
          if (/ERASE/i.test(b.textContent || '')) { (b.__activate || b.click).call(b); return; } } }""")
        wait_state(pg, ("keep", "playing"))
        pg.evaluate("() => { const d = CRESTBOUND.game.__dev; if (d && d.panel) d.panel(false); }")
        pg.evaluate("async () => { await CRESTBOUND.game.__dev.goto('verdant-1'); }")
        got, st = wait_state(pg, ("playing", "cinematic"))
        if st == "cinematic":
            pg.evaluate("() => CRESTBOUND.game._endCinematic(false)")
            wait_state(pg, ("playing",), 60)
        pg.wait_for_timeout(2500)
        R["fps"] = pg.evaluate("() => CRESTBOUND.engine.stats.fps")
        print("  ..    fps %s" % R["fps"])
        cap = Cap(pg, OUT)

        # ---------- 1. HUD flashes, frozen mid-animation ----------
        pg.evaluate("() => CRESTBOUND.game.hud.checkpointFlash()")
        n = pg.evaluate(FREEZE, 300)
        ok("checkpoint flash raises real animations to photograph", n > 0, "%s animations frozen at 300 ms" % n)
        cap.still("fx_checkpoint_flash.png")
        pg.evaluate(RESUME)
        pg.wait_for_timeout(500)

        pg.evaluate("""() => CRESTBOUND.game.hud.crestGet(
          { id: 'sigils', name: 'EIGHT SIGILS OF THE MEADOW', type: 'sigils' })""")
        n = pg.evaluate(FREEZE, 420)
        ok("crest ribbon raises real animations to photograph", n > 0, "%s animations frozen at 420 ms" % n)
        cap.still("fx_crest_ribbon.png")
        pg.evaluate(RESUME)
        pg.wait_for_timeout(700)

        pg.evaluate("() => CRESTBOUND.game.hud.deathFlash('void')")
        pg.evaluate(FREEZE, 180)
        cap.still("fx_death_word.png")
        pg.evaluate(RESUME)
        pg.wait_for_timeout(700)

        # ---------- 2. time-scaled death replay ----------
        pg.keyboard.down("KeyW")
        t0 = time.time()
        while time.time() - t0 < 5.0:
            sp = pg.evaluate("() => { const p = CRESTBOUND.game.player; return +Math.hypot(p.vel.x, p.vel.z).toFixed(2); }")
            if sp > 4.5:
                break
            pg.wait_for_timeout(120)
        pre = pg.evaluate("""() => { const p = CRESTBOUND.game.player;
          return { speed: +Math.hypot(p.vel.x, p.vel.z).toFixed(2), state: p.state,
                   pos: [+p.pos.x.toFixed(2), +p.pos.y.toFixed(2), +p.pos.z.toFixed(2)] }; }""")
        R["pre"] = pre
        ok("Nim is running when the kill lands", pre["speed"] > 4.0, json.dumps(pre))

        cap.frames.clear()
        pg.evaluate("""(stepMs) => {
          const g = CRESTBOUND.game;
          g.__origStep = g._stepDeath;
          g._stepDeath = function () { return g.__origStep.call(g, stepMs); };
          window.__rw = [];
          window.__rwStop = 0;
          const veil = document.getElementById('cb-veil');
          const tick = () => {
            const h = g.hero && g.hero.root ? g.hero.root.position : null;
            window.__rw.push({ wall: Date.now(), dT: g._deathT, state: g.state,
              rewind: +(g._rewindK || 0).toFixed(3),
              x: h ? +h.x.toFixed(3) : null, y: h ? +h.y.toFixed(3) : null, z: h ? +h.z.toFixed(3) : null,
              veil: veil ? +parseFloat(getComputedStyle(veil).opacity || '0').toFixed(3) : null });
            if (window.__rw.length < 4000 && !window.__rwStop) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          window.__killWall = Date.now();
          g.player.kill('void');
        }""", 6)
        kill_wall = pg.evaluate("() => window.__killWall")
        t_kill = time.time()
        pg.keyboard.up("KeyW")
        dl = time.time() + 120
        while time.time() < dl:
            if pg.evaluate("() => { const g = CRESTBOUND.game; return g._deathT < 0 && g.state === 'playing'; }"):
                break
            pg.wait_for_timeout(200)
        pg.evaluate("""() => { const g = CRESTBOUND.game; window.__rwStop = 1;
          if (g.__origStep) { g._stepDeath = g.__origStep; g.__origStep = null; } }""")
        track = pg.evaluate("() => window.__rw || []")
        R["track_n"] = len(track)
        frames = list(cap.frames)

        def near(wall_ms):
            best, bd = None, 1e9
            for s in track:
                d = abs(s["wall"] - wall_ms)
                if d < bd:
                    bd, best = d, s
            return best

        strip = []
        step = max(1, len(frames) // 28)
        for i, (ts, data) in enumerate(frames[::step][:28]):
            s = near(kill_wall + (ts - t_kill) * 1000.0) or {}
            dc = s.get("dT")
            name = "rw_%02d_dT%s.png" % (i, ("%04d" % dc) if isinstance(dc, (int, float)) and dc >= 0 else "post")
            Image.open(io.BytesIO(base64.b64decode(data))).save(os.path.join(OUT, name))
            strip.append({"shot": name, "deathClock": dc, "state": s.get("state"),
                          "rewind": s.get("rewind"), "veil": s.get("veil"),
                          "heroXZ": [s.get("x"), s.get("z")]})
        R["strip"] = strip
        withclock = [s for s in strip if isinstance(s["deathClock"], (int, float)) and s["deathClock"] >= 0]
        ok("replay strip covers the sequence (>= 10 frames carrying a death clock)",
           len(withclock) >= 10,
           "%d of %d saved frames carry a death clock (%d screencast frames captured)"
           % (len(withclock), len(strip), len(frames)))

        rew = [s for s in track if isinstance(s.get("dT"), (int, float)) and 88 <= s["dT"] < 315 and s.get("x") is not None]
        dist = 0.0
        for a, b in zip(rew, rew[1:]):
            dist += ((b["x"] - a["x"]) ** 2 + (b["y"] - a["y"]) ** 2 + (b["z"] - a["z"]) ** 2) ** 0.5
        away = (((pre["pos"][0] - rew[-1]["x"]) ** 2 + (pre["pos"][2] - rew[-1]["z"]) ** 2) ** 0.5) if rew else 0.0
        mono = 0
        for a, b in zip(rew, rew[1:]):
            da = ((a["x"] - pre["pos"][0]) ** 2 + (a["z"] - pre["pos"][2]) ** 2) ** 0.5
            db = ((b["x"] - pre["pos"][0]) ** 2 + (b["z"] - pre["pos"][2]) ** 2) ** 0.5
            if db >= da - 1e-4:
                mono += 1
        R["rewind"] = {"frames": len(rew), "pathLen": round(dist, 3), "awayFromDeathPos": round(away, 3),
                       "monotonicSteps": mono, "steps": max(0, len(rew) - 1)}
        ok("the rewind ghost walks BACK along the path Nim ran (>=10 frames, monotonic, ends clear of the death spot)",
           len(rew) >= 10 and dist > 0.4 and away > 0.35 and mono >= (len(rew) - 1) * 0.9,
           json.dumps(R["rewind"]))

        veils = [s.get("veil") for s in track
                 if isinstance(s.get("dT"), (int, float)) and s["dT"] >= 0 and s.get("veil") is not None]
        R["veilPeak"] = max(veils or [0])
        swapv = [s["veil"] for s in track
                 if isinstance(s.get("dT"), (int, float)) and 415 <= s["dT"] <= 470 and s.get("veil") is not None]
        R["veilAtSwap"] = min(swapv or [0])
        ok("the iris is FULLY closed across the world swap (nothing pops through)",
           R["veilAtSwap"] > 0.9,
           "min veil opacity in dT 415..470 = %.3f over %d samples (peak %.3f)"
           % (R["veilAtSwap"], len(swapv), R["veilPeak"]))

        R["console"] = console[-40:]
        errs = [c for c in console if c[0] in ("error", "pageerror")]
        ok("no console / page errors in this run", not errs, json.dumps(errs[:3])[:300])
        ctx.close()
        br.close()

    with open(os.path.join(HERE, "uideath.json"), "w", encoding="utf-8") as f:
        json.dump(R, f, indent=1)
    bad = [c for c in R["checks"] if not c["pass"]]
    print("\nUI DEATH: %d/%d checks passed" % (len(R["checks"]) - len(bad), len(R["checks"])))
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
