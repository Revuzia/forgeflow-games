# -*- coding: utf-8 -*-
"""
qa_clipdrive.py -- render-layer isolation: drive ONE clip channel at a time on
a parked vis slot (no AI), flat framing, and screenshot each pose. Separates
"the clip data is wrong" from "the AI drives the wrong clip".
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

# (key, channel overrides) -- speed01, flash, lunge
POSES = [
    ("idle", 0.0, 0.0, 0.0),
    ("walk", 0.30, 0.0, 0.0),
    ("run", 1.0, 0.0, 0.0),
    ("windup", 0.0, 0.85, 0.0),
]
BODIES = [("cold", "rimeImp"), ("cold", "glacierBrute"), ("sand", "boneKnight")]
SLOT = 23   # never reached by the director in an empty field


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
            # Park the player far from the shrine, on whatever ground is there.
            pg.evaluate("""(() => {
                const SF = SNOWFLOW, c = SF.character;
                c.position.set(80, SF.terrain.heightAt(80, 80), 80);
                if (c.velocity) c.velocity.set(0, 0, 0);
                SF.rig.yaw = 0;   // face -Z; the body stands at z-5
                SF.combat.encounters._nextSpawnAt = 1e9;
                SF.combat.encounters._clearAll();
                SF.combat.enemies.clear();
            })()""")
            pg.wait_for_timeout(600)
            realm_now = "cold"
            for realm, key in BODIES:
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
                for pose, spd, flash, lunge in POSES:
                    pg.evaluate(f"""(() => {{
                        const SF = SNOWFLOW, c = SF.character,
                              v = SF.combat.enemies.vis;
                        const x = c.position.x, z = c.position.z - 5.0;
                        const y = SF.terrain.heightAt(x, z);
                        v.spawn({SLOT}, '{key}', x, y, z);
                        if (window.__drvStop) window.__drvStop();
                        let on = true;
                        window.__drvStop = () => {{ on = false; v.free({SLOT}); }};
                        const drv = () => {{
                            if (!on) return;
                            // face the camera (+Z toward the player)
                            v.drive({SLOT}, x, y, z, Math.PI,
                                    {spd}, {flash}, {lunge}, 0, 0);
                            requestAnimationFrame(drv);
                        }};
                        drv();
                    }})()""")
                    pg.wait_for_timeout(1400)
                    pg.screenshot(path=str(SHOTS / f"clip_{key}_{pose}.png"))
                    print("shot", key, pose)
                pg.evaluate("window.__drvStop && window.__drvStop()")
            br.close()
    finally:
        srv.terminate()
    print("RESULT: OK")


if __name__ == "__main__":
    main()
