# -*- coding: utf-8 -*-
"""
qa_bossleash_8891.py -- two hunts the earlier run could not finish.

  M  kill the boss WHILE it is leashing home: the in-flight shot carries the
     registry id the re-seat just retired.
  P  emergence retry: the player STANDS on the arena with the enemy pool full,
     so `_emerge()` is re-entered from the pending branch every frame. Does the
     `_tryAt = time + RETRY_S` throttle inside `_emerge` actually throttle?
"""
import json
import subprocess
import sys
import time as _t
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 18891   # 8891 was taken by another session mid-run
URL = "http://localhost:%d/games/driftwake/index.html?autoplay&test" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

SETUP = r"""(() => {
    const SF = SNOWFLOW, B = SF.combat.bosses;
    window.__bq = { emerge: 0, spawn: 0 };
    const oe = B._emerge.bind(B);
    B._emerge = function () { window.__bq.emerge++; return oe(); };
    const en = SF.combat.enemies;
    const os = en.spawn.bind(en);
    en.spawn = function (k, x, z, l) { window.__bq.spawn++; return os(k, x, z, l); };
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
    return { ok: true, realm: B.realm };
})()"""

M_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry;
    B.clearBoss();
    SF.combat.enemies.clear();
    window.__place(0, 0);
    B.spawnBoss("mini");
    await window.__frames(6);
    const oldId = B.bossId;
    if (oldId <= 0) return { err: "no boss", refusal: B.lastRefusal };
    const s0 = R.slot(oldId);
    const max = R.hpMax[s0];
    R.damage(oldId, max * 0.9, {});
    await window.__frames(3);
    const sA = R.slot(oldId);
    const hpBefore = sA >= 0 ? R.hp[sA] : null;
    // yank the arena so the director leashes it home
    B.ax += 200;
    await window.__frames(3);
    const newId = B.bossId;
    const dealtOnStale = R.damage(oldId, 1e9, {});     // the in-flight shot
    await window.__frames(4);
    const sN = R.slot(newId);
    return { oldId, newId, hpMax: +max.toFixed(1),
             hpBeforeLeash: hpBefore === null ? null : +hpBefore.toFixed(1),
             dealtOnStale, staleSlotAfter: R.slot(oldId),
             newHp: sN >= 0 ? +R.hp[sN].toFixed(1) : null,
             leashReturns: B.leashReturns, state: B.state,
             kills: B.kills, portalOpen: SF.portal.isOpen };
})()"""

P_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, en = SF.combat.enemies,
          R = SF.combat.registry;
    B.clearBoss();
    en.clear();
    window.__place(0, 0);
    // arm the event first so the arena exists, then stand ON it
    B.spawnBoss("mini");
    await window.__frames(4);
    const armedId = B.bossId;
    B.clearBoss();
    // clearBoss drops the arena state; re-arm through the frame path instead:
    B._killed = Object.create(null);
    SF.progression.bossesKilled = {};
    B._tryAt = 0;
    await window.__gwait(6);
    const pending = { state: B.state, arena: [B.ax, B.az] };
    // stand on the arena and jam the pool full
    window.__place(B.ax, B.az);
    let filled = 0;
    for (let i = 0; i < 40; i++) {
        const a = i * 0.7;
        if (en.spawn("rimeImp", B.ax + Math.cos(a) * 20,
                     B.az + Math.sin(a) * 20, 5) > 0) filled++;
    }
    await window.__frames(3);
    window.__bq.emerge = 0; window.__bq.spawn = 0;
    const t0 = R.time;
    let frames = 0;
    await new Promise((res) => {
        const t = () => { frames++;
            (R.time - t0 >= 5) ? res() : requestAnimationFrame(t); };
        requestAnimationFrame(t);
    });
    const t1 = R.time;
    return { armedId, pending, poolFilled: filled,
             gameSeconds: +(t1 - t0).toFixed(2), rafFrames: frames,
             emergeCalls: window.__bq.emerge, enemySpawnCalls: window.__bq.spawn,
             state: B.state, id: B.bossId, refusal: B.lastRefusal };
})()"""

STAGES = [("M kill while leashing", M_JS), ("P emergence retry throttle", P_JS)]


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
