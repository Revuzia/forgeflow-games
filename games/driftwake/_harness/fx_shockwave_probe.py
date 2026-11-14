# -*- coding: utf-8 -*-
"""
fx_shockwave_probe.py -- verify the impact shockwave rings, live, per realm.

For each realm (cold, sand, ash): teleport to flat ground, aim the camera down,
hold the harness bolt override (spells.debugBolt) so real bolts fire through the
real dispatch, and poll the ring pool every frame until a ring is mid-life.
Freeze time on that frame and screenshot it. Prints the ring's slot, position,
age, radius and realm tint -- the numbers the report quotes.

A ring can only appear here if the whole chain worked: cast -> bolt flight ->
ground termination -> impact flag -> ShockwaveRings.update poll -> spawn ->
visible mesh. There is no direct spawn call anywhere in this probe.
"""
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8824
GAME_URL = f"http://localhost:{PORT}/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]
SHOTS = Path(__file__).resolve().parents[1] / "_shots"

SETUP_JS = """(async () => {
    const SF = SNOWFLOW;
    SF.S.freezeTime = false;
    const h = SF.terrain.heightAt(150, 150);
    SF.character.position.x = 150;
    SF.character.position.y = h + 0.6;
    SF.character.position.z = 150;
    if (SF.shrine && SF.shrine.mesh) SF.shrine.mesh.visible = false;
    if (SF.combat && SF.combat.encounters) {
        SF.combat.encounters._clearAll && SF.combat.encounters._clearAll();
        SF.combat.encounters._nextSpawnAt = 1e9;
    }
    SF.rig.yaw = 0;
    SF.rig.pitch = 0.85;              // look down: bolts must find the ground
    SF.rig.distanceTarget = 2.8;
    return { ok: true, ground: +h.toFixed(2) };
})()"""

FIRE_JS = """(async () => {
    const SF = SNOWFLOW, sp = SF.spells, sw = sp.shockwave;
    const reg = SF.combat.registry;
    sp.debugBolt = true;
    let maxLive = 0, hit = null, frames = 0;
    const t0 = reg.time;
    while (reg.time - t0 < 8 && frames < 1200) {
        await new Promise(r => requestAnimationFrame(r));
        frames++;
        if (sw.liveCount > maxLive) maxLive = sw.liveCount;
        for (let i = 0; i < 8; i++) {
            const age = sw.a[i * 4 + 3];
            // Only accept a ring near the player: a bolt fired while the
            // camera was still swinging onto target lands out of frame.
            const near = Math.abs(sw.a[i * 4] - 150) < 6 &&
                         Math.abs(sw.a[i * 4 + 2] - 150) < 8;
            if (sw.alive[i] && near && age > 0.20 && age < 0.55) {
                hit = {
                    slot: i,
                    x: +sw.a[i * 4].toFixed(1),
                    y: +sw.a[i * 4 + 1].toFixed(2),
                    z: +sw.a[i * 4 + 2].toFixed(1),
                    age01: +age.toFixed(2),
                    R: sw.b[i * 4],
                    tint: [sw.b[i * 4 + 1], sw.b[i * 4 + 2], sw.b[i * 4 + 3]],
                };
                break;
            }
        }
        if (hit) break;
    }
    sp.debugBolt = false;
    SF.S.freezeTime = true;           // hold the frame for the screenshot
    return { realm: sp.realm, maxLive, hit,
             meshVisible: sw.mesh.visible, frames };
})()"""

REALM_JS = """(async (name) => {
    SNOWFLOW.S.freezeTime = false;
    await SNOWFLOW.enterRealm(name);
    return { realm: SNOWFLOW.spells.realm };
})"""

# Ash only: cast spell 1 (the thrown FIREBALL) and wait for its detonation
# ring -- the size-scaled branch (head sizeMul 2.2 -> R = 1.6 * 2.2 = 3.52).
FIREBALL_JS = """(async () => {
    const SF = SNOWFLOW, sp = SF.spells, sw = sp.shockwave;
    const reg = SF.combat.registry;
    SF.S.freezeTime = false;
    SF.character.mana = 100;
    if (sp.unlocked && sp.unlocked.add) sp.unlocked.add(1);
    sp._cdUntil[1] = 0;
    sp.cast(1);
    let maxR = 0, hit = null, frames = 0;
    const t0 = reg.time;
    while (reg.time - t0 < 10 && frames < 1500) {
        await new Promise(r => requestAnimationFrame(r));
        frames++;
        for (let i = 0; i < 8; i++) {
            if (!sw.alive[i]) continue;
            const R = sw.b[i * 4];
            if (R > maxR) maxR = R;
            const age = sw.a[i * 4 + 3];
            if (R > 3.0 && age > 0.32 && age < 0.65) {
                hit = { slot: i, R: +R.toFixed(2), age01: +age.toFixed(2),
                        x: +sw.a[i * 4].toFixed(1),
                        z: +sw.a[i * 4 + 2].toFixed(1) };
                break;
            }
        }
        if (hit) break;
    }
    SF.S.freezeTime = true;
    return { maxR: +maxR.toFixed(2), hit, frames };
})()"""


def main():
    from playwright.sync_api import sync_playwright
    import json

    SHOTS.mkdir(exist_ok=True)
    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.on("pageerror", lambda e: print("PAGEERROR:", e))
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=120000)
            pg.wait_for_timeout(2500)

            shots = {"cold": "fx_proof.png", "sand": "fx_proof_sand.png",
                     "ash": "fx_proof_ash.png"}
            for realm in ("cold", "sand", "ash"):
                if realm != "cold":
                    r = pg.evaluate(REALM_JS, realm)
                    print("\nenterRealm ->", json.dumps(r))
                    pg.wait_for_timeout(1500)
                setup = pg.evaluate(SETUP_JS)
                pg.wait_for_timeout(1600)     # let the camera settle on target
                out = pg.evaluate(FIRE_JS)
                print(f"== {realm}", json.dumps(setup), json.dumps(out))
                pg.wait_for_timeout(150)      # one held frame rendered
                held = pg.evaluate(
                    "() => { const sw = SNOWFLOW.spells.shockwave;"
                    " return { live: sw.liveCount, visible: sw.mesh.visible,"
                    " frozen: SNOWFLOW.S.freezeTime }; }")
                print("   at-screenshot:", json.dumps(held))
                pg.screenshot(path=str(SHOTS / shots[realm]))
                pg.evaluate("() => { SNOWFLOW.S.freezeTime = false; }")
                if realm == "ash":
                    fb = pg.evaluate(FIREBALL_JS)
                    print("== ash fireball", json.dumps(fb))
                    pg.wait_for_timeout(150)
                    pg.screenshot(path=str(SHOTS / "fx_proof_fireball.png"))
                    pg.evaluate("() => { SNOWFLOW.S.freezeTime = false; }")
            br.close()
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
