# -*- coding: utf-8 -*-
"""
qa_bossttk_8904.py -- the OTHER half of the anchor question: does the PLAYER
scale on the same L10 anchor? If yes, a boss row scaled by 1.10^(L-10) is the
authored TTK, not an inflation.

Sets progression to L10 / L20 / L30 and reads the live spells.damageMult, then
prints the shipped-vs-lane-expected TTK for each realm boss against
COMBAT_DESIGN §8.1's tuning DPS 35 (an L10 figure) at 40% boss uptime.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8904
URL = "http://localhost:%d/games/driftwake/index.html?autoplay&test" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

JS = r"""((L) => {
    const SF = SNOWFLOW, P = SF.progression;
    P.setLevel ? P.setLevel(L) : (P.level = L, P._applyLevelStats(true));
    return { level: P.level, damageMult: +P.damageMult.toFixed(4),
             spellsMult: SF.spells && SF.spells.damageMult != null
                 ? +SF.spells.damageMult.toFixed(4) : null,
             hpMax: SF.character.healthMax };
})"""

# realm boss HP: authored L10 row -> shipped at its fixed level
CASES = [("cold Moraine/Shrinebreaker", 2000, 10),
         ("sand Dune Warden", 2400, 20),
         ("ash Plate Knight (finale)", 3000, 30)]
TUNING_DPS_L10 = 35.0     # COMBAT_DESIGN:114
UPTIME = 0.40             # COMBAT_DESIGN:447 boss damage uptime


def main():
    from playwright.sync_api import sync_playwright
    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2.5)
    mult = {}
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.goto(URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=120000)
            pg.wait_for_timeout(2500)
            for L in (10, 20, 30):
                r = pg.evaluate(JS, L)
                mult[L] = r
                print("PLAYER", json.dumps(r))
            br.close()
    finally:
        srv.terminate()

    print("\n%-28s %8s %8s %10s %10s %10s" % (
        "boss", "rowL10", "level", "shippedHP", "ship_TTK", "lane_TTK"))
    for name, row, L in CASES:
        dm = mult[L]["damageMult"]
        dps = TUNING_DPS_L10 * dm
        ship_hp = row * (1.10 ** (L - 10))
        ship = ship_hp / dps / UPTIME
        lane = row / dps / UPTIME
        print("%-28s %8d %8d %10.0f %8.0fs %9.0fs" % (
            name, row, L, ship_hp, ship, lane))
    print("\nCOMBAT_DESIGN 8.1 authored window for realm bosses: 3-5 min "
          "(180-300 s), 'raw 57-86 s -> at 40%% uptime 143-214 s + beats'.")


if __name__ == "__main__":
    main()
