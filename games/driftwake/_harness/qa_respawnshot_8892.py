# -*- coding: utf-8 -*-
"""
qa_respawnshot_8892.py -- what the player actually SEES at the respawn.

`_respawn()` writes the shrine's exact (x, z). For `cold_spawn` that is the
MONOLITH's own centre (shrine.js `_buildFormation`, q===0: px = x, pz = z,
rad 0.34, h 3.6), so the character lands inside the prism. Shoots the frame
after a respawn in each realm, plus a pull-back so the slope reads.
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

PRELUDE = r"""
window.__q = (function () {
    const SF = SNOWFLOW, reg = SF.combat.registry;
    const gwait = (s) => new Promise((r) => {
        const t0 = reg.time;
        const t = () => (reg.time - t0 >= s) ? r() : requestAnimationFrame(t);
        t();
    });
    const rafs = (n) => new Promise((r) => {
        let k = 0;
        const t = () => { if (++k >= n) r(); else requestAnimationFrame(t); };
        requestAnimationFrame(t);
    });
    const geom = () => {
        const SFc = SF.character, sh = SF.shrine, d = sh._texData;
        // distance from the landed position to every prism of shrine 0,
        // against that prism's radius (row 1, w channel)
        const w = 84 * 4;
        const hits = [];
        for (let q = 0; q < 12; q++) {
            const o = q * 4;
            const dist = Math.hypot(d[o] - SFc.position.x,
                d[o + 2] - SFc.position.z);
            const rad = d[w + o + 3];
            const h = d[o + 3];
            if (dist < rad + 0.45) {          // ~capsule radius
                hits.push({ q, dist: +dist.toFixed(3), rad: +rad.toFixed(3),
                            prismH: +h.toFixed(2) });
            }
        }
        return {
            pos: { x: +SFc.position.x.toFixed(2),
                   z: +SFc.position.z.toFixed(2),
                   y: +SFc.position.y.toFixed(2) },
            shrine0: { x: sh.positions[0].x, z: sh.positions[0].z },
            distToMonolith: +Math.hypot(sh.positions[0].x - SFc.position.x,
                sh.positions[0].z - SFc.position.z).toFixed(3),
            insidePrisms: hits,
            camDistToMonolith: +Math.hypot(
                SF.rig.camera.position.x - sh.positions[0].x,
                SF.rig.camera.position.z - sh.positions[0].z).toFixed(2),
        };
    };
    return { gwait, rafs, geom };
})();
"""


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
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=180000)
            pg.wait_for_timeout(2500)
            pg.evaluate(PRELUDE)
            for token in ("cold", "sand", "ash"):
                pg.evaluate("(t) => SNOWFLOW.enterRealm(t)", token)
                pg.wait_for_function("(t) => SNOWFLOW.shrine.realm === t",
                                     arg=token, timeout=60000)
                pg.evaluate("() => window.__q.rafs(25)")
                pg.wait_for_timeout(500)
                # walk away, then die -> respawn lands at the monolith
                pg.evaluate(r"""async () => {
                    const c = SNOWFLOW.character, T = SNOWFLOW.terrain;
                    c.position.set(180, T.heightAt(180, 180), 180);
                    await window.__q.rafs(4);
                    c.health = 0;
                    await window.__q.gwait(2.4);
                    await window.__q.rafs(30);
                }""")
                pg.wait_for_timeout(900)
                out[token] = pg.evaluate("() => window.__q.geom()")
                pg.screenshot(path=str(Path(__file__).with_name(
                    "qa_respawnshot_%s.png" % token)))
                # pull the camera back so the slope reads
                pg.evaluate("() => { SNOWFLOW.rig.distance = 26; }")
                pg.evaluate("() => window.__q.rafs(40)")
                pg.wait_for_timeout(700)
                pg.screenshot(path=str(Path(__file__).with_name(
                    "qa_respawnshot_%s_wide.png" % token)))
                pg.evaluate("() => { SNOWFLOW.rig.distance = 8; }")
            br.close()
    finally:
        srv.terminate()
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
