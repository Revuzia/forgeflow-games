# -*- coding: utf-8 -*-
"""ash2_enemydiag.py -- where do the probe-spawned ash bodies end up on screen?"""
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8851
GAME_URL = f"http://localhost:{PORT}/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

JS = """(async () => {
    const SF = SNOWFLOW, E = SF.combat.enemies, reg = SF.combat.registry;
    const c = SF.character;
    // teleport to the hollow
    c.position.x = 78; c.position.z = -36;
    c.position.y = SF.terrain.heightAt(78, -36) + 0.5;
    c.velocity.x = 0; c.velocity.y = 0; c.velocity.z = 0;
    const gameWait = (sec) => new Promise((res) => {
        const t0 = reg.time;
        const tick = () => (reg.time - t0 >= sec) ? res()
            : requestAnimationFrame(tick);
        tick();
    });
    await gameWait(1.4);
    const cam = SF.rig && SF.rig.camera ? SF.rig.camera
        : (SF.renderer && SF.renderer.xr ? null : null);
    const keys = ['slagBrute', 'scorchRaider', 'smokeMage'];
    const offs = [[-4, -12], [0, -16], [4, -18]];
    const px = c.position.x, pz = c.position.z;
    const ids = [];
    for (let i = 0; i < 3; i++) {
        ids.push(E.spawn(keys[i], px + offs[i][0], pz + offs[i][1], 20));
    }
    await gameWait(0.25);
    for (const id of ids) { if (id >= 0) reg.damage(id, 1, {}); }
    await gameWait(1.0);
    const out = { rigKeys: SF.rig ? Object.keys(SF.rig).slice(0, 40) : null,
                  camFound: !!cam, player: [px, pz],
                  py: c.position.y, ids, rows: [] };
    let camPos = null, proj = null;
    if (cam) {
        const V = c.position.constructor;
        camPos = new V(); cam.getWorldPosition(camPos);
        for (let i = 0; i < E.alive.length; i++) {
            if (!E.alive[i]) continue;
            const p = new V(E.x[i], E.y[i] + 1, E.z[i]);
            const d = p.distanceTo(c.position);
            const ndc = p.clone().project(cam);
            out.rows.push({ i, unit: E.unitOf[i],
                x: +E.x[i].toFixed(1), z: +E.z[i].toFixed(1),
                y: +E.y[i].toFixed(1), dist: +d.toFixed(1),
                ndc: [+ndc.x.toFixed(2), +ndc.y.toFixed(2), +ndc.z.toFixed(3)],
                sub: E.submerge ? E.submerge[i] : null,
                state: E.state ? E.state[i] : null });
        }
        out.cam = [+camPos.x.toFixed(1), +camPos.y.toFixed(1), +camPos.z.toFixed(1)];
    }
    return out;
})()"""


def main():
    from playwright.sync_api import sync_playwright
    import json
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
            pg.evaluate("() => SNOWFLOW.enterRealm('ash')")
            pg.evaluate("() => SNOWFLOW.combat.enemies.vis.stream()")
            pg.wait_for_function(
                "() => SNOWFLOW.combat.enemies.vis.stats.types >= 8",
                timeout=120000)
            pg.wait_for_timeout(3000)
            pg.evaluate("() => { SNOWFLOW.combat.encounters._nextSpawnAt = 1e18;"
                        " SNOWFLOW.combat.enemies.clear(); }")
            print(json.dumps(pg.evaluate(JS), indent=1))
            br.close()
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
