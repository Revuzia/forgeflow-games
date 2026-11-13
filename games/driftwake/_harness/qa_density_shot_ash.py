# -*- coding: utf-8 -*-
"""
qa_density_shot_ash.py -- retake _shots/density_ash.png with the camera aimed
at the LIVE pack centroid at shot time (the first take aimed at the spawn
anchor; the woken Slope Chase raiders had already sprinted off it).
Port 8852.
"""
import json
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
SHOTS = Path(__file__).resolve().parents[1] / "_shots"
PORT = 8852
GAME_URL = f"http://localhost:{PORT}/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

JS = """async () => {
    const wallWait = (pred, capMs) => new Promise((res) => {
        const w0 = performance.now();
        const iv = setInterval(() => {
            let hit = false;
            try { hit = !!pred(); } catch (e) { hit = true; }
            if (hit || performance.now() - w0 > capMs) {
                clearInterval(iv); res(performance.now() - w0 <= capMs);
            }
        }, 100);
    });
    const SF = SNOWFLOW, reg = SF.combat.registry;
    const enc = SF.combat.encounters, ch = SF.character;
    let entered = false;
    SF.enterRealm("ash").then(() => { entered = true; });
    await wallWait(() => entered, 60000);
    if (!entered) return { err: "enterRealm wall-capped" };
    const vis = SF.combat.enemies.vis;
    vis.stream();
    await wallWait(() => vis.ready("scorchRaider") && vis.ready("smokeMage"),
                   90000);
    if (SF.progression) SF.progression.level = 20;
    enc.playerLevel = 20;
    if (!enc.spawnPack("Slope Chase")) return { err: "spawnPack refused" };
    const sl = enc._slots[0];
    await wallWait(() => sl.live >= 3, 30000);
    if (sl.live < 3) return { err: "pack never reached 3 live", live: sl.live };
    // Centroid of the LIVE members right now (dormant — nobody has moved).
    let cx = 0, cz = 0, n = 0;
    for (let k = 0; k < sl.mIds.length; k++) {
        const id = sl.mIds[k];
        if (id <= 0) continue;
        const s = reg.slot(id);
        if (s < 0) continue;
        cx += reg.x[s]; cz += reg.z[s]; n++;
    }
    if (!n) return { err: "no live members in registry" };
    cx /= n; cz /= n;
    // Stand 16 m from the centroid, camera on the same bearing.
    const f = Math.atan2(cx - ch.position.x, -(cz - ch.position.z));
    const fx = Math.sin(f), fz = -Math.cos(f);
    ch.facing = f;
    SF.rig.yaw = f;
    if (typeof SF.rig.pitch === "number") SF.rig.pitch = 0.08;
    const nx = cx - fx * 14, nz = cz - fz * 14;
    ch.position.x = nx;
    ch.position.z = nz;
    ch.position.y = SF.terrain.heightAt(nx, nz) + 1;
    if (ch.velocity) ch.velocity.set(0, 0, 0);
    // Let the smooth-follow camera ARRIVE before waking anyone (the 400 ms
    // take shot from the stale camera position and framed empty dunes).
    await new Promise(r => setTimeout(r, 1300));
    for (let k = 0; k < sl.mIds.length; k++) {
        const id = sl.mIds[k];
        if (id > 0) reg.damage(id, 1, {});
    }
    await new Promise(r => setTimeout(r, 300));
    return { ok: true, live: sl.live, centroid: [+cx.toFixed(1), +cz.toFixed(1)] };
}"""


def main():
    from playwright.sync_api import sync_playwright

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=120000)
            pg.wait_for_timeout(2500)
            out = pg.evaluate(JS)
            print("shot:", json.dumps(out), flush=True)
            if out.get("ok"):
                pg.screenshot(path=str(SHOTS / "density_ash.png"))
                print("-> _shots/density_ash.png", flush=True)
            br.close()
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
