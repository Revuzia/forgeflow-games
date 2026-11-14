# -*- coding: utf-8 -*-
"""
qa_bosshp_anchor_8904.py -- ADVERSARIAL VERIFIER for the claim
"authored arena HP is multiplied a SECOND time by the level anchor".

Measures, per realm and per boss kind, on the live engine:
  * bossLevel, registry hpMax
  * the arena clone's own `hp` field  (the value enemies.spawn is handed)
  * the BASE roster unit's `hp` field (what the clone was copied from)
  * roster arenaHp
  * the ratio hpMax / cloneHp, and whether it equals 1.10^(L-10) EXACTLY
  * a REGULAR enemy of the SAME realm spawned at the SAME level, so the
    boss:regular HP ratio can be read at-level (the §5.4 contract is
    "8-12x a regular enemy OF ITS LEVEL", i.e. a level-invariant ratio)

Criterion that would CONFIRM a double-multiply:
    hpMax / cloneHp  !=  1.10^(L-10)     (i.e. more than one application)
Criterion that would CONFIRM the "authored value ignored":
    cloneHp != arenaHp

GAME-TIME waits only (registry.time polled through rAF). Own port, own server.
"""
import json
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8904
URL = "http://localhost:%d/games/driftwake/index.html?autoplay&test" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

SETUP = r"""(() => {
    const SF = SNOWFLOW;
    window.__frames = (n) => new Promise((res) => {
        let k = n;
        const t = () => (--k <= 0) ? res() : requestAnimationFrame(t);
        t();
    });
    const c = SF.character;
    c.position.x = 0; c.position.z = 0;
    c.position.y = SF.terrain.heightAt(0, 0);
    c.velocity.set(0, 0, 0);
    return { ok: true, lvl: SF.progression.level,
             test: SF.progression.testMode };
})()"""

# realm token, boss kind
MEASURE = r"""(async ([realm, kind]) => {
    const SF = SNOWFLOW, B = SF.combat.bosses, E = SF.combat.enemies,
          R = SF.combat.registry;
    if (B.bossId > 0) { R.damage(B.bossId, 1e9, {}); await window.__frames(6); }
    if (B.realm !== realm && SF.enterRealm) {
        try { SF.enterRealm(realm); } catch (e) { B.setRealm(realm); }
    } else { B.setRealm(realm); }
    await window.__frames(30);
    const ok = B.spawnBoss(kind);
    await window.__frames(4);
    const st = B.stats;
    if (!ok || st.id <= 0) {
        return { realm, kind, err: "no spawn", ok,
                 refusal: B.lastRefusal, bRealm: B.realm };
    }

    const row = B.row;
    const key = row.combatKey;
    const clone = B._clones[key];
    const bi = E.unitIndex(key);
    const base = E.units[bi];
    const L = st.level;
    const pow = Math.pow(1.10, L - 10);

    // a REGULAR (non-boss/elite) unit of the same realm, same level
    const REG = { cold: "frostStalker", sand: "scourScout", ash: "scorchRaider" };
    const rk = REG[realm];
    const rx = SF.character.position.x + 14, rz = SF.character.position.z + 14;
    const rid = E.spawn(rk, rx, rz, L);
    await window.__frames(2);
    const rs = rid > 0 ? R.slot(rid) : -1;
    const regHpMax = rs >= 0 ? R.hpMax[rs] : 0;
    const regRow = E.units[E.unitIndex(rk)].hp;
    if (rid > 0) R.damage(rid, 1e9, {});

    return {
        realm, kind, bossKey: key, bossName: st.name,
        level: L, pow: +pow.toFixed(6),
        arenaHp: row.arenaHp,
        cloneHp: clone ? clone.hp : null,
        baseRowHp: base ? base.hp : null,
        assignmentIsNoop: !!(clone && base && row.arenaHp === base.hp),
        hpMax: st.hpMax,
        appliedRatio: clone && clone.hp ? +(st.hpMax / clone.hp).toFixed(6) : null,
        exactlyOneScale: !!(clone && Math.abs(st.hpMax - clone.hp * pow) < 1e-6),
        regularKey: rk, regularRowHp: regRow, regularHpMaxAtSameLevel: regHpMax,
        bossOverRegularAtLevel: regHpMax ? +(st.hpMax / regHpMax).toFixed(3) : null,
        bossOverRegularRows: +(row.arenaHp / regRow).toFixed(3),
    };
})"""


def main():
    from playwright.sync_api import sync_playwright
    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    import time
    time.sleep(2.5)
    out = []
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=120000)
            pg.wait_for_timeout(2500)
            print("SETUP", json.dumps(pg.evaluate(SETUP)))
            for realm in ("cold", "sand", "ash"):
                for kind in ("mini", "realm"):
                    r = pg.evaluate(MEASURE, [realm, kind])
                    out.append(r)
                    print(json.dumps(r))
            if errs:
                print("PAGE ERRORS:", errs[:5])
            br.close()
    finally:
        srv.terminate()
    Path(__file__).with_suffix(".json").write_text(
        json.dumps(out, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
