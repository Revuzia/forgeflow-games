# -*- coding: utf-8 -*-
"""
qa_progdepth.py -- SYSTEMS DEPTH review probe (read-only lane, port 8857).

Measures the LIVE progression curve against _spec/PROGRESSION_DESIGN.md:
  * kill XP at L1 vs L8 (fodder + medium tiers, even con)
  * kills-to-first-ding from a fresh L1 run (time-to-L2 estimate)
  * streak multiplier behavior on rapid kills
  * gray-con floor (L8 player vs L1 enemy)
  * driftmarks spend API existence, boons content, unlock ladder
  * bossesKilled container type after newGame (save-shape check)

The player's existing save blob is stashed before newGame() and restored
verbatim afterwards -- the probe leaves localStorage exactly as found.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8857
GAME_URL = f"http://localhost:{PORT}/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

JS = """(async () => {
    const SF = SNOWFLOW, P = SF.progression, reg = SF.combat.registry,
          E = SF.combat.enemies, c = SF.character;
    const out = {};
    const gw = (s) => new Promise(r => {
        const t0 = reg.time;
        const t = () => (reg.time - t0 >= s) ? r() : requestAnimationFrame(t);
        t();
    });

    // ---- state as found (before any probe mutation)
    out.before = { level: P.level, xp: P.xp, need: P.xpNeed,
        driftmarks: P.driftmarks, boons: P.boons.slice(), deaths: P.deaths,
        rested: Math.round(P.restedBank),
        unlocked: Array.from(P.unlocked).sort(),
        bosses: Object.keys(P.bossesKilled || {}) };

    // ---- stash the real save, start a clean L1 run
    const stash = localStorage.getItem('driftwake_save');
    P.newGame();
    out.fresh = { level: P.level, need: P.xpNeed,
        unlocked: Array.from(P.unlocked).sort(),
        bossesKilledIsArray: Array.isArray(P.bossesKilled),
        driftmarkSpendAPI: typeof P.spendDriftmark,
        boonAPI: typeof P.pickBoon };

    let n = 0;
    const killOne = async (key, lvl) => {
        n++;
        const x = c.position.x + 6 + (n % 5), z = c.position.z + 6 + ((n * 3) % 7);
        const id = E.spawn(key, x, z, lvl);
        if (id <= 0) return { err: 'spawn fail ' + id };
        await gw(0.1);                      // slot lands next frame
        const s = reg.slot(id);
        const tier = s >= 0 ? reg.tier[s] : -1;
        const elv = s >= 0 ? reg.level[s] : -1;
        reg.damage(id, 1, {});              // wake
        await gw(0.05);
        const xpB = P.xp, lvB = P.level;
        reg.damage(id, 999999, {});
        await gw(0.15);
        return { xp: P.lastXP, why: P.lastXPWhy, tier, enemyLevel: elv,
                 dinged: P.level > lvB, playerLevel: P.level };
    };

    // ---- L1 single kills, streak-free (>4 s apart)
    out.L1_imp_a = await killOne('rimeImp', 1);
    await gw(4.5);
    out.L1_imp_b = await killOne('rimeImp', 1);
    await gw(4.5);
    out.L1_stalker = await killOne('frostStalker', 1);
    await gw(4.5);

    // ---- kills-to-first-ding: fresh again, rapid imp kills (real streak)
    P.newGame();
    const seq = [];
    let kills = 0;
    const t0 = reg.time;
    while (P.level < 2 && kills < 40) {
        const r = await killOne('rimeImp', 1);
        if (r.err) { seq.push(r); break; }
        seq.push(r.xp);
        kills++;
    }
    out.ding = { kills, gameSeconds: +(reg.time - t0).toFixed(1),
                 dinged: P.level >= 2, seq };

    // ---- L8 measurements
    P.level = 8; P.xp = 0; P._refreshNeed(); P._applyLevelStats(true);
    await gw(4.5);
    out.L8_need = P.xpNeed;
    out.L8_imp = await killOne('rimeImp', 8);
    await gw(4.5);
    out.L8_stalker = await killOne('frostStalker', 8);
    await gw(4.5);
    out.L8_gray_vs_L1imp = await killOne('rimeImp', 1);

    // ---- restore the real save exactly as found
    if (stash === null) localStorage.removeItem('driftwake_save');
    else localStorage.setItem('driftwake_save', stash);
    P.load(); P._applyLevelStats(true);
    out.restored = { level: P.level, xp: P.xp };
    return out;
})()"""


def main():
    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.0)
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=120000)
            pg.wait_for_timeout(2500)
            res = pg.evaluate(JS)
            print(json.dumps(res, indent=1))
            pg.screenshot(path=str(Path(__file__).parent / "qa_progdepth_shot.png"))
            br.close()
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
