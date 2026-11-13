#!/usr/bin/env python
"""Measure what the death-rewind history ring actually holds at a steady full run.

CONTRACT §11 says `history: Ring` is "the last 0.4 s of {x,y,z,facing} at 60 Hz".
At speedRun 9.0 m/s that is ~3.6 m of travel, which is what the 220 ms rewind
ghost replays. This probe runs Nim in a straight line until his speed is steady,
then reads the ring end to end.
"""
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

URL = "http://localhost:8788/games/crestbound/index.html?dev=1"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required", "--force-device-scale-factor=1"]


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


with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
    ctx = br.new_context(viewport={"width": 1280, "height": 720}, device_scale_factor=1)
    pg = ctx.new_page()
    pg.goto(URL, wait_until="load", timeout=60_000)
    wait_state(pg, ("title",))
    pg.evaluate("""() => { for (const b of document.querySelectorAll('.cb-btn')) {
      if (/NEW GAME/i.test(b.textContent || '')) { (b.__activate || b.click).call(b); return; } } }""")
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
    pg.wait_for_timeout(2000)

    pg.keyboard.down("KeyW")
    pg.wait_for_timeout(600)                       # past the 0.25 s accel ramp
    PROBE = """() => {
      const p = CRESTBOUND.game.player, h = p.history, n = h.length | 0;
      const pts = [];
      for (let i = 0; i < n; i++) { const s = h.at(i); if (s) pts.push([+s.x.toFixed(3), +s.y.toFixed(3), +s.z.toFixed(3)]); }
      let span = 0, uniq = 0;
      for (let i = 1; i < pts.length; i++) {
        const d = Math.hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1], pts[i][2]-pts[i-1][2]);
        span += d; if (d > 1e-4) uniq++;
      }
      return { speed: +Math.hypot(p.vel.x, p.vel.z).toFixed(3), state: p.state, n,
               ringSpanM: +span.toFixed(3), movingSteps: uniq,
               endToEnd: pts.length > 1 ? +Math.hypot(pts[pts.length-1][0]-pts[0][0],
                                                      pts[pts.length-1][1]-pts[0][1],
                                                      pts[pts.length-1][2]-pts[0][2]).toFixed(3) : 0,
               fps: CRESTBOUND.engine.stats.fps, first: pts[0], last: pts[pts.length-1] };
    }"""
    samples = []
    for _ in range(14):
        samples.append(pg.evaluate(PROBE))
        pg.wait_for_timeout(150)
    pg.keyboard.up("KeyW")
    for s in samples:
        print("  speed %6.3f  state %-10s ringSpan %6.3f m  endToEnd %6.3f  movingSteps %2d"
              % (s["speed"], s["state"], s["ringSpanM"], s["endToEnd"], s["movingSteps"]))
    out = max(samples, key=lambda s: s["speed"])
    print(json.dumps(out, indent=1))
    expected = out["speed"] * 0.4
    print("expected span for 0.4 s at %.2f m/s = %.2f m ; measured %.2f m (%.0f%%)"
          % (out["speed"], expected, out["ringSpanM"], 100.0 * out["ringSpanM"] / max(expected, 1e-6)))
    ctx.close()
    br.close()
