# -*- coding: utf-8 -*-
"""
qa_flee_perf.py -- clean enemies.update cost, 8 chasing imps (port 8853).
Two 300-frame windows after a 5 s warm-up; reports both. The single-window
number in qa_pathfinding_8853 (2.61 ms mean, 172.8 ms max) was polluted by a
streaming/GC hitch; the budget check needs a hitch-free window.
"""
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8853
GAME_URL = f"http://localhost:{PORT}/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

SETUP_JS = """(() => {
    const SF = SNOWFLOW;
    SF.S.combatEnemies = false;
    const r = SF.combat.registry;
    for (let i = r.count - 1; i >= 0; i--)
        if (r.kind[i] !== 'dummy') r.remove(r.idOf[i]);
    SF.character.health = SF.character.healthMax;
    return { px: SF.character.position.x, pz: SF.character.position.z };
})()"""

RUN_JS = """(async () => {
    const SF = SNOWFLOW, en = SF.combat.enemies, reg = SF.combat.registry,
          c = SF.character;
    const px = c.position.x, pz = c.position.z;
    const ids = [];
    for (let a = 0; a < 8; a++) {
        ids.push(en.spawn('rimeImp',
            px + 28 * Math.cos(a * Math.PI / 5 - Math.PI / 3),
            pz + 28 * Math.sin(a * Math.PI / 5 - Math.PI / 3), 10));
    }
    const gameWait = (sec) => new Promise((res) => {
        const t0 = reg.time;
        const tick = () => (reg.time - t0 >= sec) ? res()
            : requestAnimationFrame(tick);
        tick();
    });
    await gameWait(0.1);
    for (const id of ids) reg.damage(id, 0.1, {});
    const orig = en.update.bind(en);
    const m = { n: 0, sum: 0, max: 0 };
    en.update = (dt) => {
        const t0 = performance.now();
        orig(dt);
        const ms = performance.now() - t0;
        m.n++; m.sum += ms; if (ms > m.max) m.max = ms;
    };
    const pin = () => {
        c.position.x = px; c.position.z = pz;
        c.velocity.set(0, 0, 0);
        c.health = c.healthMax;
    };
    await gameWait(5.0);        // warm: chase formed, bodies streamed
    const win = [];
    for (let w = 0; w < 2; w++) {
        m.n = 0; m.sum = 0; m.max = 0;
        while (m.n < 300) { pin(); await gameWait(0.25); }
        win.push({ frames: m.n, meanMs: +(m.sum / m.n).toFixed(4),
                   maxMs: +m.max.toFixed(2) });
    }
    en.update = orig;
    return { alive: en.aliveCount, win };
})()"""


def wait_server():
    for _ in range(40):
        try:
            with urllib.request.urlopen(
                    f"http://localhost:{PORT}/games/driftwake/index.html",
                    timeout=2) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(0.5)
    return False


def main():
    from playwright.sync_api import sync_playwright
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT)],
                           cwd=str(ROOT), stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL)
    try:
        if not wait_server():
            print("RESULT: FAIL server")
            return 1
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=120000)
            pg.wait_for_timeout(2500)
            pg.evaluate(SETUP_JS)
            if "--off" in sys.argv:
                print(pg.evaluate("""(() => {
                    const pt = SNOWFLOW.combat.enemies.pathing;
                    pt.steer = function (en, i, mx, mz, dt) {
                        this.outX = mx; this.outZ = mz; };
                    pt.standDrift = function () {
                        this.outX = 0; this.outZ = 0; return 0; };
                    return "pathing OFF (passthrough)";
                })()"""))
            out = pg.evaluate(RUN_JS)
            print("PERF2:", json.dumps(out))
            br.close()
    finally:
        srv.terminate()
    return 0


if __name__ == "__main__":
    sys.exit(main())
