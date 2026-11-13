# -*- coding: utf-8 -*-
"""
qa_lmslope_8892.py -- shoot the worst-graded landmark anchors.

`_layoutRealm` nudges every realm's anchors to the flattest cell against
whatever heightfield is live at CONSTRUCTION time, which is always COLD
(main.js:531 runs before any `enterRealm`). This puts the camera on the sand
anchors that measured grade 1.037 and 0.649 and on cold's own worst (0.094)
for a like-for-like comparison.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8892
GAME_URL = "http://localhost:%d/games/driftwake/index.html?autoplay&test" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

SHOTS = [
    ("sand", 190.43, -460.36, "sand_colonnade_g1037"),
    ("sand", -315.87, 326.50, "sand_colonnade_g0649"),
    ("cold", -291.07, -342.70, "cold_glaciergate_g0094"),
]

PLACE = """([x, z]) => {
    const SF = SNOWFLOW, T = SF.terrain, c = SF.character;
    // Stand ON the anchor and pull the third-person rig right back: the
    // formation is then centred on the character whatever the yaw convention
    // is, which the 55 m offset shot got wrong.
    c.position.set(x, T.heightAt(x, z), z);
    SF.rig.distance = 80;
    return { ground: +T.heightAt(x, z).toFixed(2) };
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
            pg.set_default_timeout(90000)
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=180000)
            pg.wait_for_timeout(2500)
            cur = None
            for realm, x, z, name in SHOTS:
                if realm != cur:
                    pg.evaluate("(t) => SNOWFLOW.enterRealm(t)", realm)
                    pg.wait_for_function("(t) => SNOWFLOW.shrine.realm === t",
                                         arg=realm, timeout=90000)
                    pg.wait_for_timeout(3500)
                    cur = realm
                out[name] = pg.evaluate(PLACE, [x, z])
                pg.wait_for_timeout(2500)
                pg.screenshot(path=str(Path(__file__).with_name(
                    "qa_lmslope_%s.png" % name)))
            br.close()
    finally:
        srv.terminate()
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
