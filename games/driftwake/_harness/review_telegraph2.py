# -*- coding: utf-8 -*-
"""review_telegraph2.py -- fixed telegraph measurement (port 8854).

Scans the FULL AI slot array (alive[] mask, not the unmaintained .count).
  A. glacier brute at 9 m: flash ramp series, windup duration, screenshot at
     flash > 0.5, player-hp drops to timestamp the strike moments.
  B. rime imp pack (4 @ 8 m): concurrent-windup census at 60 Hz for 12 s.
"""
import json, subprocess, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
SHOTS = Path(__file__).resolve().parents[1] / "_shots"
PORT = 8854
URL = f"http://localhost:{PORT}/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

GAMEWAIT = """
    const reg = SNOWFLOW.combat.registry;
    const gameWait = (sec) => new Promise((res) => {
        const t0 = reg.time;
        const tick = () => (reg.time - t0 >= sec) ? res() : requestAnimationFrame(tick);
        tick();
    });
"""


def main():
    from playwright.sync_api import sync_playwright
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT)],
                           cwd=str(ROOT), stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL)
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.goto(URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime", timeout=120000)
            pg.wait_for_timeout(2500)
            try:
                pg.wait_for_function(
                    "() => SNOWFLOW.combat.enemies.vis.stats.types >= 8",
                    timeout=45000)
            except Exception:
                pass
            pg.evaluate("""(() => {
                const SF = SNOWFLOW;
                SF.S.combatEnemies = false;
                const r = SF.combat.registry;
                for (let i = r.count - 1; i >= 0; i--)
                    if (r.kind[i] !== 'dummy') r.remove(r.idOf[i]);
                SF.character.health = SF.character.healthMax;
            })()""")
            pg.wait_for_timeout(400)

            # ---- A: brute windup instrumentation --------------------------
            pg.evaluate("""(() => {
                const SF = SNOWFLOW, c = SF.character;
                const fx = Math.sin(SF.rig.yaw), fz = -Math.cos(SF.rig.yaw);
                window.__bid = SF.combat.enemies.spawn('glacierBrute',
                    c.position.x + fx * 9, c.position.z + fz * 9, 10);
                SF.combat.registry.damage(window.__bid, 1, {});
                window.__samples = [];
                window.__sampling = true;
                const e = SF.combat.enemies, reg = SF.combat.registry;
                const t0 = reg.time;
                const step = () => {
                    if (!window.__sampling) return;
                    let idx = -1;
                    for (let i = 0; i < e.alive.length; i++)
                        if (e.alive[i] && e.id[i] === window.__bid) { idx = i; break; }
                    window.__samples.push([
                        +(reg.time - t0).toFixed(3),
                        idx >= 0 ? +e.flash[idx].toFixed(2) : -9,
                        +c.health.toFixed(1),
                        idx >= 0 ? e.state[idx] : -9]);
                    requestAnimationFrame(step);
                };
                step();
            })()""")
            # python-side: poll for flash > 0.5 to screenshot mid-windup
            got_shot = False
            for _ in range(240):  # up to 12 s
                pg.wait_for_timeout(50)
                f = pg.evaluate("""(() => {
                    const s = window.__samples;
                    return s && s.length ? s[s.length - 1][1] : -1;
                })()""")
                if not got_shot and f is not None and f > 0.45:
                    pg.screenshot(path=str(SHOTS / "review_telegraph_brute_windup.png"))
                    got_shot = True
                    break
            pg.wait_for_timeout(3000)
            res = pg.evaluate("""(() => {
                window.__sampling = false;
                const s = window.__samples;
                // compress: keep transitions where flash changes by >= 0.05
                const out = [];
                let last = -99;
                for (const r of s) {
                    if (Math.abs(r[1] - last) >= 0.05 || out.length === 0) {
                        out.push(r); last = r[1];
                    }
                }
                return { n: s.length, gotWindup: s.some(r => r[1] > 0.45),
                         transitions: out.slice(0, 80) };
            })()""")
            print("A brute flash transitions [t, flash, playerHp, state]:")
            print(json.dumps(res))
            print("windup screenshot:", got_shot)

            # ---- B: pack concurrent windups at 60 Hz ----------------------
            pg.evaluate("""(() => {
                const SF = SNOWFLOW, r = SF.combat.registry;
                for (let i = r.count - 1; i >= 0; i--)
                    if (r.kind[i] !== 'dummy') r.remove(r.idOf[i]);
                SF.character.health = SF.character.healthMax;
                const c = SF.character;
                for (let k = 0; k < 4; k++) {
                    const a = (k / 4) * Math.PI * 2;
                    const id = SF.combat.enemies.spawn('rimeImp',
                        c.position.x + Math.cos(a) * 8,
                        c.position.z + Math.sin(a) * 8, 10);
                    SF.combat.registry.damage(id, 1, {});
                }
                window.__census = [];
                window.__sampling2 = true;
                const e = SF.combat.enemies, reg = SF.combat.registry;
                const t0 = reg.time;
                const step = () => {
                    if (!window.__sampling2 || reg.time - t0 > 12) return;
                    let w = 0;
                    for (let i = 0; i < e.alive.length; i++)
                        if (e.alive[i] && e.flash[i] > 0.05) w++;
                    window.__census.push(w);
                    requestAnimationFrame(step);
                };
                step();
            })()""")
            pg.wait_for_timeout(12500)
            census = pg.evaluate("""(() => {
                window.__sampling2 = false;
                const c = window.__census;
                const hist = {};
                for (const w of c) hist[w] = (hist[w] || 0) + 1;
                return { frames: c.length, hist,
                         max: Math.max(...c),
                         playerHp: +SNOWFLOW.character.health.toFixed(1) };
            })()""")
            print("B pack windup census:", json.dumps(census))
            pg.screenshot(path=str(SHOTS / "review_pack_census.png"))
            br.close()
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
