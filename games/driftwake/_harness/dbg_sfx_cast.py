#!/usr/bin/env python
"""One-off: why does cast(1) not reach sweep.trigger under the sfx probe?"""
import subprocess, sys, time, json
from pathlib import Path
from playwright.sync_api import sync_playwright

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]
PORT = 8842
REPO = Path(__file__).resolve().parents[3]
URL = f"http://localhost:{PORT}/games/driftwake/index.html?menu"

server = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT)],
                          cwd=str(REPO), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(2.5)
try:
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.goto(URL, wait_until="load", timeout=60000)
        end = time.time() + 120
        while time.time() < end:
            try:
                if pg.evaluate("!!(globalThis.FFG && FFG.shell && SNOWFLOW && SNOWFLOW.progression && SNOWFLOW.sfx)"):
                    break
            except Exception: pass
            pg.wait_for_timeout(500)
        pg.wait_for_timeout(2000)
        pg.locator("button", has_text="PLAY").first.click()
        pg.wait_for_timeout(2000)
        out = pg.evaluate("""(() => {
            const sp = SNOWFLOW.spells, pr = SNOWFLOW.progression;
            [1,3,4,5].forEach(k => pr.unlocked.add(k));
            SNOWFLOW.character.mana = 500;
            const before = {
                sameSet: sp.unlocked === pr.unlocked,
                unlocked: Array.from(sp.unlocked || []),
                mana: SNOWFLOW.character.mana,
                time: sp._time, cd1: sp._cdUntil[1],
                freeze: SNOWFLOW.S.freezeTime,
                showSpells: SNOWFLOW.S.showSpells,
            };
            sp.cast(1);
            const after = {
                pending: Object.assign({}, sp._pending),
                mana: SNOWFLOW.character.mana,
                castWave: SNOWFLOW.character.castWave,
                lastCast: sp._lastCast, time: sp._time,
            };
            return {before, after};
        })()""")
        print(json.dumps(out, indent=1))
        pg.wait_for_timeout(1500)
        print("later:", json.dumps(pg.evaluate(
            "({pend: SNOWFLOW.spells._pending.key, sweepActive: SNOWFLOW.spells.sweep.active,"
            " trig: SNOWFLOW.sfx.stats.triggers, t: SNOWFLOW.spells._time})")))
        br.close()
finally:
    server.terminate()
