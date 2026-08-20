# -*- coding: utf-8 -*-
"""
qa_bossflag_8892.py -- does a boss first-kill flag survive a reload?

The REAL path: `?menu=1` -> click NEW RUN/PLAY (which calls
`progression.newGame()`) -> write the flag exactly the way
`bossEncounters.js:674` does (`p.bossesKilled[key] = true`) -> save -> RELOAD
-> click CONTINUE -> read the flag back.

Deliberately has NO rAF-promise waits: an occluded Chrome window throttles rAF
to zero and a bare `requestAnimationFrame` promise inside `page.evaluate` then
never resolves, which hangs the run with no timeout at all.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8892
BASE = "http://localhost:%d/games/driftwake/index.html?menu=1" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

CLICK = """(want) => {
    const els = Array.from(document.querySelectorAll('button'));
    const hit = els.find((e) => e.offsetParent &&
        (e.textContent || '').toUpperCase().indexOf(want) >= 0);
    if (!hit) return false;
    hit.click();
    return true;
}"""

READ = """() => {
    const P = SNOWFLOW.progression;
    let blob = null;
    try { blob = JSON.parse(localStorage.getItem('driftwake_save')); }
    catch (e) { blob = { err: String(e) }; }
    return {
        isArray: Array.isArray(P.bossesKilled),
        liveKeys: Object.keys(P.bossesKilled),
        liveFlag: !!P.bossesKilled['furnaceGuardian'],
        blobBosses: blob ? blob.bossesKilled : null,
        blobBossesIsArray: blob ? Array.isArray(blob.bossesKilled) : null,
        level: P.level, deaths: P.deaths,
    };
}"""


def main():
    from playwright.sync_api import sync_playwright
    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2.5)
    out = {}
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.set_default_timeout(60000)
            errs = []
            pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
            pg.goto(BASE, wait_until="domcontentloaded")
            pg.wait_for_function("() => globalThis.SNOWFLOW", timeout=180000)
            pg.wait_for_timeout(3000)
            # clear any earlier run's blob so PLAY (not NEW RUN) is the label
            pg.evaluate("() => localStorage.removeItem('driftwake_save')")
            pg.reload(wait_until="domcontentloaded")
            pg.wait_for_function("() => globalThis.SNOWFLOW", timeout=180000)
            pg.wait_for_timeout(3000)
            print("clicked PLAY:", pg.evaluate(CLICK, "PLAY"))
            pg.wait_for_timeout(2500)
            out["afterNewGame"] = pg.evaluate(READ)

            # exactly what bossEncounters.js:674 does on a boss death
            pg.evaluate("""() => {
                const P = SNOWFLOW.progression;
                P.bossesKilled['furnaceGuardian'] = true;
                P.save();
            }""")
            pg.wait_for_timeout(500)
            out["afterFlagSave"] = pg.evaluate(READ)

            pg.goto(BASE, wait_until="domcontentloaded")
            pg.wait_for_function("() => globalThis.SNOWFLOW", timeout=180000)
            pg.wait_for_timeout(3000)
            print("clicked CONTINUE:", pg.evaluate(CLICK, "CONTINUE"))
            pg.wait_for_timeout(2500)
            out["afterReloadContinue"] = pg.evaluate(READ)
            print("PAGEERRORS:", json.dumps(errs[:6]))
            br.close()
    finally:
        srv.terminate()
    print(json.dumps(out, indent=1))
    ok = out.get("afterReloadContinue", {}).get("liveFlag")
    print("\nBOSS FIRST-KILL FLAG SURVIVES RELOAD:", ok)


if __name__ == "__main__":
    main()
