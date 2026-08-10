# -*- coding: utf-8 -*-
"""
qa_enemyshots.py -- pixel evidence for enemy animation quality.

Numeric probes said "bones move, weights ramp, tracks bind"; the owner's eyes
said "still looks like T-pose". This captures the pixels: a handful of
representative bodies, each screenshotted mid-RUN (chasing the player) and
mid-ATTACK (adjacent, telegraph up), camera zoomed onto them.
"""
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
SHOTS = HERE.parent / "_shots"
GAME_URL = "http://localhost:8799/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

# (realm, key, band level)
PICKS = [
    ("cold", "rimeImp", 1),
    ("cold", "glacierBrute", 1),
    ("cold", "hailPlateGuard", 1),
    ("sand", "boneKnight", 8),
    ("ash", "furnaceGuardian", 18),
]


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

                # Spawn 8 m ahead of the camera bearing, wake with a tap.
                st = pg.evaluate(f"""(() => {{
                    const SF = SNOWFLOW, c = SF.character,
                          e = SF.combat.enemies;
                    c.hp = undefined;   // no-op guard
                    const a = SF.rig.yaw;
                    const x = c.position.x + Math.sin(a) * 8;
                    const z = c.position.z - Math.cos(a) * 8;
                    const id = e.spawn('{key}', x, z, {lv});
                    let slot = -1;
                    for (let i = 0; i < e.alive.length; i++)
                        if (e.alive[i] && e.id[i] === id) {{ slot = i; break; }}
                    SF.combat.registry.damage(id, 1, {{}});
                    SF.S.camDistance = 3.2;   // zoom close if the key exists
                    return {{ id, slot }};
                }})()""")
                slot = st["slot"]
                # RUN shot: wait until locomotion is actually carrying it.
                pg.wait_for_function(
                    f"""() => {{
                        const v = SNOWFLOW.combat.enemies.vis;
                        const i = v._slotInst[{slot}];
                        return v.speed01[{slot}] > 0.5 && i &&
                               i.weights[1] + i.weights[2] > 0.5;
                    }}""", timeout=30000)
                pg.wait_for_timeout(400)
                aim = (f"(() => {{ const SF = SNOWFLOW, e = SF.combat.enemies;"
                       f" const c = SF.character;"
                       f" const dx = e.x[{slot}] - c.position.x;"
                       f" const dz = e.z[{slot}] - c.position.z;"
                       f" SF.rig.yaw = Math.atan2(dx, -dz); }})()")
                pg.evaluate(aim)
                pg.wait_for_timeout(250)
                pg.screenshot(path=str(SHOTS / f"aaa_run_{key}.png"))
                # ATTACK shot: teleport adjacent, wait for the telegraph.
                pg.evaluate(f"""(() => {{
                    const SF = SNOWFLOW, c = SF.character,
                          e = SF.combat.enemies;
                    const a = SF.rig.yaw;
                    e.x[{slot}] = c.position.x + Math.sin(a) * 2.2;
                    e.z[{slot}] = c.position.z - Math.cos(a) * 2.2;
                }})()""")
                try:
                    pg.wait_for_function(
                        f"() => SNOWFLOW.combat.enemies.vis.flash[{slot}] > 0.5",
                        timeout=30000)
                except Exception:
                    pass
                pg.evaluate(aim)
                pg.wait_for_timeout(250)
                pg.screenshot(path=str(SHOTS / f"aaa_atk_{key}.png"))
                print(f"shot {realm}:{key} run+atk")
                pg.evaluate(
                    "SNOWFLOW.combat.enemies.clear();"
                    "SNOWFLOW.combat.encounters._clearAll();")
            br.close()
    finally:
        srv.terminate()
    print("RESULT: OK  shots in", SHOTS)


if __name__ == "__main__":
    main()
