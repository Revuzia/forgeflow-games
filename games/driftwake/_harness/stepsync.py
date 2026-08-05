#!/usr/bin/env python
"""Verify footstep events lock to the mesh clips, and idle variations fire.

Drives W (walk), then Shift+W (run), sampling every 250 ms:
  state, speed, meshChar.footfallCount, walk/run act timeScale.
Expected steps over a segment = sum(dt * 2 * timeScale / clipDuration) while
that state is dominant — the same clock the emitter uses, integrated
independently. PASS if actual is within 15% + 2 steps of expected, and the
idle phase produces zero footfalls plus at least one armed variation.

    python _harness/stepsync.py [--url ...]
"""
import argparse, sys, time
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]
WALK_DUR, RUN_DUR = 1.167, 0.767  # hero_v2 Magic Locomotion clips

SAMPLE_JS = """() => {
    const SF = globalThis.SNOWFLOW;
    const mc = SF.meshChar || SF.char;
    const c = SF.character || (mc && mc.controller);
    return {
        state: mc._state,
        speed: c ? +c.speed.toFixed(2) : null,
        falls: mc.footfallCount | 0,
        wTS: +mc._acts[1].getEffectiveTimeScale().toFixed(3),
        rTS: +mc._acts[2].getEffectiveTimeScale().toFixed(3),
        wW: +mc._weights[1].toFixed(2), rW: +mc._weights[2].toFixed(2),
        ivar: mc._idleVar, ivw: +mc._idleVarW.toFixed(2), ivseq: mc._idleVarSeq,
    };
}"""

ap = argparse.ArgumentParser()
ap.add_argument("--url", default="http://localhost:8799/games/driftwake/index.html")
a = ap.parse_args()

with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
    pg = br.new_page(viewport={"width": 1280, "height": 720})
    pg.goto(a.url, wait_until="load", timeout=60_000)
    deadline = time.time() + 120
    while time.time() < deadline:
        try:
            if pg.evaluate("!!(globalThis.SNOWFLOW && SNOWFLOW.terrain && SNOWFLOW.rig && SNOWFLOW.meshChar)"):
                break
        except Exception:
            pass
        pg.wait_for_timeout(500)
    pg.wait_for_timeout(2500)
    pg.mouse.click(640, 360)   # focus the canvas

    def segment(name, seconds, expect_state):
        s0 = pg.evaluate(SAMPLE_JS)
        expected, n = 0.0, int(seconds * 4)
        for _ in range(n):
            pg.wait_for_timeout(250)
            s = pg.evaluate(SAMPLE_JS)
            if s["state"] == 1 and s["wW"] > 0.5:
                expected += 0.25 * 2 * s["wTS"] / WALK_DUR
            elif s["state"] == 2 and s["rW"] > 0.5:
                expected += 0.25 * 2 * s["rTS"] / RUN_DUR
        s1 = pg.evaluate(SAMPLE_JS)
        actual = s1["falls"] - s0["falls"]
        tol = expected * 0.15 + 2
        ok = abs(actual - expected) <= tol
        print(f"{name:14s} state={s1['state']} speed={s1['speed']}"
              f"  steps actual={actual} expected={expected:.1f} (±{tol:.1f})"
              f"  {'OK' if ok else 'MISMATCH'}")
        return ok, actual

    results = []

    # -- idle first: zero steps, variation arms ------------------------------
    s0 = pg.evaluate(SAMPLE_JS)
    var_seen = False
    for _ in range(56):            # 14 s
        pg.wait_for_timeout(250)
        s = pg.evaluate(SAMPLE_JS)
        if s["ivar"] >= 0 and s["ivw"] > 0.3:
            var_seen = True
    s1 = pg.evaluate(SAMPLE_JS)
    idle_steps = s1["falls"] - s0["falls"]
    print(f"{'idle 14s':14s} steps={idle_steps} (want 0)"
          f"  variation_seen={var_seen} seq={s1['ivseq']}"
          f"  {'OK' if idle_steps == 0 and var_seen else 'MISMATCH'}")
    results.append(idle_steps == 0 and var_seen)

    # -- walk ----------------------------------------------------------------
    pg.keyboard.down("w")
    pg.wait_for_timeout(1200)      # accelerate + fade in
    ok, _ = segment("walk 6s", 6, 1)
    results.append(ok)

    # -- run (Shift toggles) -------------------------------------------------
    pg.keyboard.press("Shift")
    pg.wait_for_timeout(1200)
    ok, _ = segment("run 6s", 6, 2)
    results.append(ok)
    pg.keyboard.up("w")

    # -- back to idle: the clock stops with the feet -------------------------
    pg.wait_for_timeout(1500)
    s0 = pg.evaluate(SAMPLE_JS)
    pg.wait_for_timeout(3000)
    s1 = pg.evaluate(SAMPLE_JS)
    stopped = s1["falls"] == s0["falls"]
    print(f"{'stop 3s':14s} steps={s1['falls'] - s0['falls']} (want 0)"
          f"  {'OK' if stopped else 'MISMATCH'}")
    results.append(stopped)

    br.close()

print("\nRESULT:", "OK" if all(results) else "STEP SYNC BROKEN")
sys.exit(0 if all(results) else 1)
