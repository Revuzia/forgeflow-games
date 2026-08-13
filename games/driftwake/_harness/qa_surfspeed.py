# -*- coding: utf-8 -*-
"""
qa_surfspeed.py -- steady-state SURF top speed via REAL input, port 8822.

Real input path: real click on the canvas (pointer lock -- input.js guards the
RMB mousedown on it), then page.keyboard.down("w") + page.mouse.down(right).
Player is teleported to flat (150, h, 150) and PINNED there each 50 ms so the
slope-assist term stays flat-terrain constant; velocity physics run untouched.
Speed sampled from SNOWFLOW.character.speed on GAME time (registry.time via
rAF), 4 s spin-up then 4 s measurement window. Then RMB released, momentum
bleeds, Shift toggles sprint ON, and plain RUN speed is measured the same way.
"""
import json
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
GAME_URL = "http://localhost:8799/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

SETUP_JS = """(() => {
    const SF = SNOWFLOW, c = SF.character;
    const h = SF.terrain.heightAt(150, 150);
    c.position.set(150, h, 150);
    c.velocity.set(0, 0, 0);
    if (window.__pin) clearInterval(window.__pin);
    window.__pin = setInterval(() => {
        const y = SF.terrain.heightAt(150, 150);
        c.position.set(150, y, 150);
    }, 50);
    return { h, locked: !!document.pointerLockElement };
})()"""

MEASURE_JS = """(async () => {
    const SF = SNOWFLOW, c = SF.character, reg = SF.combat.registry;
    const gameWait = (sec) => new Promise((res) => {
        const t0 = reg.time;
        const tick = () => (reg.time - t0 >= sec) ? res()
            : requestAnimationFrame(tick);
        tick();
    });
    await gameWait(SPINUP);
    const t0 = reg.time, samples = [];
    await new Promise((res) => {
        const tick = () => {
            samples.push(c.speed);
            (reg.time - t0 >= WINDOW) ? res() : requestAnimationFrame(tick);
        };
        tick();
    });
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const max = Math.max(...samples);
    const min = Math.min(...samples.slice(Math.floor(samples.length / 2)));
    return { n: samples.length, mean: +mean.toFixed(3), max: +max.toFixed(3),
             tailMin: +min.toFixed(3), surf: SF.character.surf.toFixed(2),
             surfInput: SF.character.surfActive,
             gameT: +(reg.time - t0).toFixed(2) };
})()"""

STATE_JS = """(() => {
    const SF = SNOWFLOW;
    return { locked: !!document.pointerLockElement,
             surfInput: SF.character.surfActive,
             sprint: SF.character.speed };
})()"""


def measure(pg, spinup, window):
    js = MEASURE_JS.replace("SPINUP", str(spinup)).replace("WINDOW", str(window))
    return pg.evaluate(js)


def main():
    from playwright.sync_api import sync_playwright

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", "8799"], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=120000)
            pg.wait_for_timeout(2000)

            # Real pointer-lock click on the canvas.
            pg.mouse.click(640, 360)
            pg.wait_for_timeout(500)
            setup = pg.evaluate(SETUP_JS)
            print("SETUP", json.dumps(setup))
            if not setup["locked"]:
                pg.mouse.click(640, 360)
                pg.wait_for_timeout(500)
                print("RELOCK", json.dumps(pg.evaluate(STATE_JS)))

            # ---- SURF: hold W + RMB (real input), measure steady state.
            pg.keyboard.down("w")
            pg.mouse.down(button="right")
            pg.wait_for_timeout(300)
            print("PRE-SURF", json.dumps(pg.evaluate(STATE_JS)))
            surf = measure(pg, 4.0, 4.0)
            print("SURF", json.dumps(surf))
            pg.mouse.up(button="right")

            # ---- RUN: RMB released; toggle sprint ON with one Shift press,
            # keep holding W; let surf momentum bleed, then measure.
            pg.keyboard.press("Shift")
            run = measure(pg, 5.0, 3.0)
            print("RUN", json.dumps(run))
            pg.keyboard.up("w")
            br.close()
            return {"surf": surf, "run": run}
    finally:
        srv.terminate()


if __name__ == "__main__":
    r = main()
    print("RESULT", json.dumps(r))
