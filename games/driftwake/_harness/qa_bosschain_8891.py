# -*- coding: utf-8 -*-
"""
qa_bosschain_8891.py -- the boss + portal chain, end to end, in all three realms.

Drives SNOWFLOW.combat.bosses / SNOWFLOW.portal through:
  cold mini -> kill -> cold realm boss -> kill -> portal -> walk in -> SAND
  sand mini -> kill -> sand realm boss -> kill -> portal -> walk in -> ASH
  ash  mini -> kill -> ash  realm boss -> kill -> portal -> walk in -> COLD

Everything is measured off the live registry / director / portal state.
GAME-TIME waits only (registry.time polled through rAF).
"""
import json
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8891
URL = "http://localhost:%d/games/driftwake/index.html?autoplay&test" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

# ---------------------------------------------------------------- helpers JS
SETUP = r"""(() => {
    const SF = SNOWFLOW;
    if (window.__bq) return { already: true };
    window.__bq = { xp: [], deaths: 0 };
    const PR = SF.progression;
    const orig = PR.addXP.bind(PR);
    PR.addXP = function (n, why) { window.__bq.xp.push([n, why || null]); return orig(n, why); };
    window.__gwait = (sec) => new Promise((res) => {
        const R = SF.combat.registry, t0 = R.time;
        const t = () => (R.time - t0 >= sec) ? res() : requestAnimationFrame(t);
        t();
    });
    window.__frames = (n) => new Promise((res) => {
        let k = n;
        const t = () => (--k <= 0) ? res() : requestAnimationFrame(t);
        t();
    });
    window.__snap = () => {
        const R = SF.combat.registry;
        let bosses = 0, enemies = 0;
        for (let s = 0; s < R.count; s++) {
            if (R.kind[s] === "boss") bosses++;
            else if (R.kind[s] === "enemy") enemies++;
        }
        const bar = document.querySelector("#enemybars .bossbar");
        return {
            regCount: R.count, regBoss: bosses, regEnemy: enemies,
            barOn: bar ? bar.classList.contains("on") : null,
            barName: bar ? (bar.querySelector(".boss-name") || {}).textContent : null,
            boss: SF.combat.bosses.stats,
            portal: SF.portal.stats,
            realmDir: SF.combat.bosses.realm,
            realmPack: SF.combat.encounters.realm,
            bossLive: SF.combat.encounters.bossLive,
            lvl: SF.progression.level, xp: SF.progression.xp,
            need: SF.progression._need(),
            testMode: SF.progression.testMode,
            killedMap: Object.assign({}, SF.progression.bossesKilled),
            killedIsArray: Array.isArray(SF.progression.bossesKilled),
            hint: SF.progression.bossKindHint || null,
        };
    };
    // Put the player somewhere central and standing still so the arena wheel
    // has a clean bearing.
    return { ok: true, snap: window.__snap() };
})()"""

PLACE = r"""(() => {
    const SF = SNOWFLOW, c = SF.character;
    c.position.x = 0; c.position.z = 0;
    c.position.y = SF.terrain.heightAt(0, 0);
    c.velocity.set(0, 0, 0);
    return { x: c.position.x, z: c.position.z, y: c.position.y };
})()"""


def spawn_js(kind):
    return r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses;
    window.__bq.xp.length = 0;
    const ok = B.spawnBoss("%s");
    await window.__frames(4);
    const s = window.__snap();
    // terrain grade right where the boss stands
    const T = SF.terrain, ax = B.ax, az = B.az;
    const h = (x, z) => T.heightAt(x, z);
    const gx = (h(ax + 2, az) - h(ax - 2, az)) / 4;
    const gz = (h(ax, az + 2) - h(ax, az - 2)) / 4;
    return { ok, slope: Math.hypot(gx, gz), arenaY: h(ax, az),
             arenaR: Math.hypot(ax, az), snap: s,
             xp: window.__bq.xp.slice() };
})()""" % kind


KILL = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry;
    window.__bq.xp.length = 0;
    const before = window.__snap();
    const id = B.bossId;
    if (id <= 0) return { err: "no live boss", before };
    R.damage(id, 1e9, {});
    await window.__frames(6);
    const mid = window.__snap();
    await window.__gwait(2.0);      // let the corpse dissolve + bar poll
    const after = window.__snap();
    return { id, before, mid, after, xp: window.__bq.xp.slice() };
})()"""


WALK_PORTAL = r"""(async () => {
    const SF = SNOWFLOW, c = SF.character, P = SF.portal;
    if (!P.isOpen) return { err: "portal not open" };
    const st0 = P.stats;
    c.position.x = st0.x; c.position.z = st0.z;
    c.position.y = SF.terrain.heightAt(st0.x, st0.z);
    c.velocity.set(0, 0, 0);
    await window.__frames(4);
    const entered = P.stats.entered;
    // enterRealm is async (awaits a body fetch); give it real time
    await new Promise(r => setTimeout(r, 6000));
    return { portalBefore: st0, entered, snap: window.__snap() };
})()"""


def main():
    from playwright.sync_api import sync_playwright
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT)],
                           cwd=str(ROOT), stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL)
    import time as _t
    _t.sleep(2.5)
    out = {}
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.on("console", lambda m: errs.append("console." + m.type + ": " + m.text)
                  if m.type == "error" else None)
            pg.goto(URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=180000)
            pg.wait_for_timeout(2500)

            print("== SETUP", json.dumps(pg.evaluate(SETUP), default=str)[:1400])

            for realm in ("cold", "sand", "ash"):
                print("\n############ REALM", realm)
                print("-- place", json.dumps(pg.evaluate(PLACE)))
                for kind in ("mini", "realm"):
                    print("\n---- %s %s : SPAWN" % (realm, kind))
                    r = pg.evaluate(spawn_js(kind))
                    print(json.dumps(r, default=str))
                    print("---- %s %s : KILL" % (realm, kind))
                    k = pg.evaluate(KILL)
                    print(json.dumps(k, default=str))
                    out["%s:%s" % (realm, kind)] = {"spawn": r, "kill": k}
                print("\n---- %s : WALK PORTAL" % realm)
                w = pg.evaluate(WALK_PORTAL)
                print(json.dumps(w, default=str))
                out["%s:portal" % realm] = w
                pg.wait_for_timeout(1500)

            print("\n== PAGE ERRORS", json.dumps(errs[:40]))
            br.close()
    finally:
        srv.terminate()
    (Path(__file__).with_suffix(".json")).write_text(
        json.dumps(out, indent=1, default=str), encoding="utf-8")


if __name__ == "__main__":
    main()
