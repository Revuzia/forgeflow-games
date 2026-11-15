# -*- coding: utf-8 -*-
"""
qa_leashcycle_8901.py -- how expensive is a leash cycle WITHOUT touching B.ax?

V5  three honest re-engagement cycles: walk the player back into the arena to
    re-aggro the boss, then kite outward past LEASH_M. Measure the GAME seconds
    per cycle and the HP handed back per cycle. This is the ratchet the lane
    claimed had "no minimum interval" -- measured with the arena left alone.

V6  after a leash, is the director still "live"/bossLive while the re-seated
    boss sits idle? (does the encounter UI stay up on a boss that has quit?)
"""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8901
URL = "http://localhost:%d/games/driftwake/index.html?autoplay&test" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

SETUP = r"""(() => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry;
    window.__q = { leash: [] };
    const ol = B._leashHome.bind(B);
    B._leashHome = function (hp, hpMax) {
        window.__q.leash.push({ t: +R.time.toFixed(2), hpFrac: +(hp / hpMax).toFixed(4) });
        return ol(hp, hpMax);
    };
    window.__frames = (n) => new Promise((res) => {
        let k = n; const t = () => (--k <= 0) ? res() : requestAnimationFrame(t); t();
    });
    window.__place = (x, z) => {
        const c = SNOWFLOW.character;
        c.position.x = x; c.position.z = z;
        c.position.y = SNOWFLOW.terrain.heightAt(x, z);
        c.velocity.set(0, 0, 0);
    };
    window.__erow = () => {
        const E = SNOWFLOW.combat.enemies, id = SNOWFLOW.combat.bosses.bossId;
        for (let i = 0; i < E.alive.length; i++) {
            if (E.alive[i] && E.id[i] === id) {
                return { state: E.state[i], speedNow: +E.speedNow[i].toFixed(2),
                         dHome: +Math.hypot(E.x[i] - E.homeX[i], E.z[i] - E.homeZ[i]).toFixed(1) };
            }
        }
        return null;
    };
    return { ok: true };
})()"""

V5_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry;
    B.clearBoss();
    window.__q.leash.length = 0;
    window.__place(0, 0);
    await window.__frames(3);
    if (!B.spawnBoss("mini")) return { err: "refused: " + B.stats.refusal };
    await window.__frames(4);
    const id0 = B.bossId;
    R.damage(id0, 1, {});
    await window.__frames(3);
    const ax = B.ax, az = B.az;
    let s = R.slot(B.bossId);
    const max = R.hpMax[s];
    R.damage(B.bossId, max * 0.55, {});           // start the loop at 45%
    await window.__frames(3);
    const cycles = [];
    for (let c = 0; c < 3; c++) {
        const n0 = window.__q.leash.length, t0 = R.time;
        s = R.slot(B.bossId);
        const fracIn = +(R.hp[s] / max).toFixed(4);
        // (a) walk IN to the arena centre to re-aggro (~6 m/s)
        let d = Math.hypot(SF.character.position.x - ax,
                           SF.character.position.z - az);
        let guard = 0;
        while (d > 4 && guard++ < 4000) {
            d = Math.max(0, d - 0.1);
            window.__place(ax + d, az);
            await window.__frames(2);
        }
        const tAggro = R.time;
        // (b) hold at the centre until the boss is actually chasing
        guard = 0;
        while (guard++ < 4000) {
            const e = window.__erow();
            if (e && e.speedNow > 0.1) break;
            window.__place(ax + 3, az);
            await window.__frames(2);
        }
        const tMoving = R.time;
        // (c) kite outward, bolting, until the leash fires or 60 s pass
        d = 3; guard = 0;
        while (window.__q.leash.length === n0 && R.time - t0 < 60 && guard++ < 9000) {
            d = Math.min(70, d + 0.1);
            window.__place(ax + d, az);
            s = R.slot(B.bossId);
            if (s >= 0 && (guard % 12) === 0) {
                R.damage(B.bossId, max * 0.004,
                         { poise: R.poiseMax[s] * 0.06, chill: true });
            }
            await window.__frames(2);
        }
        s = R.slot(B.bossId);
        cycles.push({ cycle: c, fracIn,
            fracOut: s >= 0 ? +(R.hp[s] / max).toFixed(4) : null,
            leashed: window.__q.leash.length > n0,
            aggroS: +(tMoving - tAggro).toFixed(2),
            cycleS: +(R.time - t0).toFixed(2),
            erow: window.__erow() });
    }
    return { hpMax: +max.toFixed(1), cycles,
             leashes: window.__q.leash.length, log: window.__q.leash };
})()"""

V6_JS = r"""(() => {
    const SF = SNOWFLOW, B = SF.combat.bosses;
    return { dirState: B.stats.state, kind: B.stats.kind,
             hpFrac: +B.stats.hpFrac.toFixed(4),
             arenaDist: +B.stats.arenaDist.toFixed(1),
             bossLive: SF.combat.encounters.bossLive,
             erow: window.__erow(),
             playerToArena: +Math.hypot(SF.character.position.x - B.ax,
                                        SF.character.position.z - B.az).toFixed(1) };
})()"""


def main():
    from playwright.sync_api import sync_playwright
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT)],
                           cwd=str(ROOT), stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL)
    out = {}
    try:
        time.sleep(2.5)
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.goto(URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime", timeout=120000)
            pg.wait_for_timeout(2500)
            print("SETUP", json.dumps(pg.evaluate(SETUP)))
            for name, js in (("V5 honest cycles", V5_JS), ("V6 post-leash UI", V6_JS)):
                try:
                    r = pg.evaluate(js)
                except Exception as e:                       # noqa: BLE001
                    r = {"exception": str(e)[:400]}
                out[name] = r
                print("\n==", name)
                print(json.dumps(r, indent=1)[:4000])
            br.close()
    finally:
        srv.terminate()
    Path(__file__).with_suffix(".json").write_text(
        json.dumps(out, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
