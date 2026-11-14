# -*- coding: utf-8 -*-
"""
qa_bossbar_8891.py -- the remaining boss/portal hunts.

  L  boss bar: does it light and CLEAR on death / despawn / realm change?
     (the whole #enemybars container is gated on input.locked, which
     automation can never produce, so the probe forces the flag)
  M  kill the boss WHILE it is leashing home (stale registry id in flight)
  N  the portal after a realm change: is the gate recoverable?
  O  emergence with the enemy pool FULL -- does the event spin per frame?
"""
import json
import subprocess
import sys
import time as _t
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8891
URL = "http://localhost:%d/games/driftwake/index.html?autoplay&test" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

SETUP = r"""(() => {
    const SF = SNOWFLOW;
    window.__bq = { emerge: 0, spawnCalls: 0 };
    const B = SF.combat.bosses;
    const oe = B._emerge.bind(B);
    B._emerge = function () { window.__bq.emerge++; return oe(); };
    window.__gwait = (sec) => new Promise((res) => {
        const R = SF.combat.registry, t0 = R.time;
        const t = () => (R.time - t0 >= sec) ? res() : requestAnimationFrame(t);
        t();
    });
    window.__frames = (n) => new Promise((res) => {
        let k = n; const t = () => (--k <= 0) ? res() : requestAnimationFrame(t); t();
    });
    window.__place = (x, z) => {
        const c = SF.character;
        c.position.x = x; c.position.z = z;
        c.position.y = SF.terrain.heightAt(x, z);
        c.velocity.set(0, 0, 0);
    };
    window.__bar = () => {
        const el = document.getElementById("enemybars");
        const b = el ? el.querySelector(".bossbar") : null;
        return { container: el ? el.className : null,
                 containerShown: el ? el.classList.contains("show") : null,
                 on: b ? b.classList.contains("on") : null,
                 name: b ? b.querySelector(".boss-name").textContent : null,
                 hpScale: b ? b.querySelector(".boss-hp .eb-fill").style.transform : null };
    };
    return { ok: true, inputLocked: SF.input.locked };
})()"""

L_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry;
    // The bar container only does world work while the pointer is locked.
    const wasLocked = SF.input.locked;
    SF.input.locked = true;
    if (SF.overlay && SF.overlay.visible && SF.overlay.toggle) SF.overlay.toggle();
    window.__place(0, 0);
    await window.__frames(3);
    const idle = window.__bar();
    B.spawnBoss("mini");
    await window.__frames(6);
    const live = window.__bar();
    const nm = B.stats.barName;
    // 1) DEATH
    R.damage(B.bossId, 1e9, {});
    await window.__frames(6);
    const justDead = window.__bar();
    await window.__gwait(2.5);                    // past the 1.2 s dissolve
    const afterDissolve = window.__bar();
    // 2) DESPAWN (clearBoss)
    B.spawnBoss("realm");
    await window.__frames(6);
    const live2 = window.__bar();
    B.clearBoss();
    await window.__frames(4);
    const afterClear = window.__bar();
    // 3) REALM CHANGE with a live boss
    B.spawnBoss("mini");
    await window.__frames(6);
    const live3 = window.__bar();
    await SF.enterRealm("ash");
    await window.__frames(6);
    const afterRealm = window.__bar();
    SF.input.locked = wasLocked;
    return { wasLocked, idle, live, registryName: nm, justDead, afterDissolve,
             live2, afterClear, live3, afterRealm };
})()"""

M_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry;
    B.clearBoss();
    window.__place(0, 0);
    B.spawnBoss("mini");
    await window.__frames(4);
    const oldId = B.bossId;
    const s0 = R.slot(oldId);
    R.damage(oldId, R.hpMax[s0] * 0.9, {});     // 10% left
    await window.__frames(3);
    const hpBefore = R.hp[R.slot(oldId)];
    // yank the arena so the director leashes it home THIS frame
    B.ax += 200;
    await window.__frames(3);
    const newId = B.bossId;
    // the in-flight shot still carries the OLD id
    const dealtOnStale = R.damage(oldId, 1e9, {});
    await window.__frames(4);
    const sN = R.slot(newId);
    return { oldId, newId, hpBefore: +hpBefore.toFixed(1),
             dealtOnStale, staleSlot: R.slot(oldId),
             newHp: sN >= 0 ? +R.hp[sN].toFixed(1) : null,
             newHpMax: sN >= 0 ? +R.hpMax[sN].toFixed(1) : null,
             targetId: SF.combat.targeting ? SF.combat.targeting.targetId : null,
             stats: B.stats };
})()"""

N_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry;
    // land in cold with both cold bosses un-killed
    B.clearBoss();
    B._killed = Object.create(null);
    SF.progression.bossesKilled = {};
    await SF.enterRealm("cold");
    await window.__frames(6);
    window.__place(0, 0);
    B.spawnBoss("realm");
    await window.__frames(4);
    R.damage(B.bossId, 1e9, {});
    await window.__frames(6);
    const gateUp = { open: SF.portal.isOpen, token: SF.portal.token,
                     killed: Object.assign({}, B.stats.killed) };
    // player takes the TEMPORARY dev portal (keys 6/7) instead of the gate
    await SF.enterRealm("sand");
    await window.__frames(6);
    const inSand = { open: SF.portal.isOpen, token: SF.portal.token,
                     realm: B.realm };
    await SF.enterRealm("cold");
    await window.__frames(6);
    // now sit in cold for a while and see whether anything re-offers the gate
    await window.__gwait(20);
    const backInCold = { open: SF.portal.isOpen, token: SF.portal.token,
        realm: B.realm, state: B.state, kind: B.kind,
        killed: Object.assign({}, B.stats.killed),
        eligible: B._eligibleKind(), refusal: B.lastRefusal,
        realmsUnlocked: SF.progression.realmsUnlocked.slice() };
    return { gateUp, inSand, backInCold };
})()"""

O_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, E = SF.combat.encounters,
          en = SF.combat.enemies;
    B.clearBoss();
    en.clear();
    window.__place(0, 0);
    // fill the enemy pool (ENEMY_MAX = 24) with fodder
    const c = SF.character;
    let spawned = 0;
    for (let i = 0; i < 40; i++) {
        const a = i * 0.7;
        const id = en.spawn("cinderImp", c.position.x + Math.cos(a) * 30,
                            c.position.z + Math.sin(a) * 30, 10);
        if (id > 0) spawned++;
    }
    window.__bq.emerge = 0;
    const t0 = SF.combat.registry.time;
    const ok = B.spawnBoss("mini");
    const afterForce = { ok, state: B.state, id: B.bossId,
                         refusal: B.lastRefusal, emerge: window.__bq.emerge };
    await window.__gwait(5);
    const t1 = SF.combat.registry.time;
    const spin = { emergeCalls: window.__bq.emerge, gameSeconds: +(t1 - t0).toFixed(2),
                   state: B.state, id: B.bossId, refusal: B.lastRefusal };
    en.clear();
    await window.__gwait(3);
    const recovered = { state: B.state, id: B.bossId, refusal: B.lastRefusal,
                        emerge: window.__bq.emerge };
    return { poolSpawned: spawned, afterForce, spin, recovered };
})()"""

STAGES = [("L boss bar", L_JS), ("M kill while leashing", M_JS),
          ("N portal after realm change", N_JS), ("O pool-full emergence", O_JS)]


def main():
    from playwright.sync_api import sync_playwright
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT)],
                           cwd=str(ROOT), stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL)
    _t.sleep(2.5)
    out = {}
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            errs = []
            pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
            pg.goto(URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime", timeout=180000)
            pg.wait_for_timeout(2500)
            print("== SETUP", json.dumps(pg.evaluate(SETUP)))
            for name, js in STAGES:
                print("\n############", name)
                try:
                    r = pg.evaluate(js)
                except Exception as e:
                    r = {"EVAL_ERROR": str(e)[:800]}
                out[name] = r
                print(json.dumps(r, default=str))
            print("\n== PAGE ERRORS", json.dumps(errs[:30]))
            br.close()
    finally:
        srv.terminate()
    Path(__file__).with_suffix(".json").write_text(
        json.dumps(out, indent=1, default=str), encoding="utf-8")


if __name__ == "__main__":
    main()
