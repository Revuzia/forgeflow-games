# -*- coding: utf-8 -*-
"""
qa_enemyportrait.py -- close-up locomotion portraits. The unit is re-pinned
4.5 m in front of the camera every 60 ms while its AI drives pursuit, so the
screenshot catches a real mid-stride pose dead-centre and unoccluded.
"""
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
SHOTS = Path(__file__).resolve().parent.parent / "_shots"
GAME_URL = "http://localhost:8799/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

PICKS = [("cold", "rimeImp", 1), ("cold", "glacierBrute", 1),
         ("sand", "boneKnight", 8)]


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
            realm_now = None
            for realm, key, lv in PICKS:
                if realm != realm_now:
                    pg.evaluate(f"SNOWFLOW.enterRealm('{realm}')")
                    pg.wait_for_timeout(1500)
                    pg.evaluate("SNOWFLOW.combat.enemies.vis.stream()")
                    pg.wait_for_function(
                        "() => SNOWFLOW.combat.enemies.vis.stats.types >= 8",
                        timeout=120000)
                    pg.evaluate(
                        "SNOWFLOW.combat.encounters._nextSpawnAt = 1e9;"
                        "SNOWFLOW.combat.encounters._clearAll();"
                        "SNOWFLOW.combat.enemies.clear();")
                    realm_now = realm
                st = pg.evaluate(f"""(() => {{
                    const SF = SNOWFLOW, c = SF.character,
                          e = SF.combat.enemies;
                    const a = SF.rig.yaw;
                    const x = c.position.x + Math.sin(a) * 9;
                    const z = c.position.z - Math.cos(a) * 9;
                    const id = e.spawn('{key}', x, z, {lv});
                    let slot = -1;
                    for (let i = 0; i < e.alive.length; i++)
                        if (e.alive[i] && e.id[i] === id) {{ slot = i; break; }}
                    SF.combat.registry.damage(id, 1, {{}});
                    return {{ id, slot }};
                }})()""")
                slot = st["slot"]
                pg.wait_for_function(
                    f"() => SNOWFLOW.combat.enemies.vis.speed01[{slot}] > 0.4",
                    timeout=30000)
                # Treadmill: pin 4.5 m ahead of the camera for ~1.2 s.
                for _ in range(20):
                    pg.evaluate(f"""(() => {{
                        const SF = SNOWFLOW, c = SF.character,
                              e = SF.combat.enemies;
                        const a = SF.rig.yaw;
                        e.x[{slot}] = c.position.x + Math.sin(a) * 4.5;
                        e.z[{slot}] = c.position.z - Math.cos(a) * 4.5;
                        e.y[{slot}] = SF.terrain.heightAt(
                            e.x[{slot}], e.z[{slot}]);
                    }})()""")
                    pg.wait_for_timeout(60)
                pg.screenshot(path=str(SHOTS / f"portrait_{key}.png"))
                print("portrait", key)
                pg.evaluate("SNOWFLOW.combat.enemies.clear()")
            br.close()
    finally:
        srv.terminate()
    print("RESULT: OK")


if __name__ == "__main__":
    main()
