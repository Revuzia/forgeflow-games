# -*- coding: utf-8 -*-
"""
qa_freeze_check.py -- does `S.freezeTime = true` actually stop the frame clock
under automation? (qa_feel_clocks.py measured 722 ms of registry time advancing
while the flag was supposedly set, which would invalidate every pause claim
built on that path.)
"""
import json
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8893
GAME_URL = "http://localhost:%d/games/driftwake/index.html?autoplay&test" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--disable-features=CalculateNativeWinOcclusion"]

JS = """(async () => {
    const S = SNOWFLOW.S, reg = SNOWFLOW.combat.registry;
    const waitFrames = (n) => new Promise(res => {
        let k = 0;
        const f = () => (++k >= n) ? res() : requestAnimationFrame(f);
        requestAnimationFrame(f);
    });
    const rows = [];
    let t = reg.time;
    for (let k = 0; k < 4; k++) {
        await waitFrames(1);
        rows.push(["running", S.freezeTime, +((reg.time - t) * 1000).toFixed(2)]);
        t = reg.time;
    }
    S.freezeTime = true;
    for (let k = 0; k < 8; k++) {
        await waitFrames(1);
        rows.push(["frozen", S.freezeTime, +((reg.time - t) * 1000).toFixed(2)]);
        t = reg.time;
    }
    S.freezeTime = false;
    for (let k = 0; k < 3; k++) {
        await waitFrames(1);
        rows.push(["resumed", S.freezeTime, +((reg.time - t) * 1000).toFixed(2)]);
        t = reg.time;
    }
    return { legend: ["phase", "S.freezeTime", "registry.time delta ms"],
             rows,
             SisSame: S === SNOWFLOW.S };
})()"""


def main():
    from playwright.sync_api import sync_playwright
    import time as _t

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        _t.sleep(2.5)
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=120000)
            pg.wait_for_timeout(2500)
            print(json.dumps(pg.evaluate(JS), indent=1))
            br.close()
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
