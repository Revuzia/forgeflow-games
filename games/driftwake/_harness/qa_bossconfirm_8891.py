# -*- coding: utf-8 -*-
"""
qa_bossconfirm_8891.py -- two confirmations.

  Q  what the leash re-seat throws away: poise/stance, chill, brittle, the
     stance-break window and the CC diminishing-returns counters, because the
     re-seat is a despawn + a FRESH registry.register().
  R  pending emergence with the enemy pool genuinely full and the player
     standing on the arena: is `_emerge()` re-entered every frame despite the
     `_tryAt = time + RETRY_S` it sets on failure?
"""
import json
import subprocess
import sys
import time as _t
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 18891
URL = "http://localhost:%d/games/driftwake/index.html?autoplay&test" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

SETUP = r"""(() => {
    const SF = SNOWFLOW, B = SF.combat.bosses;
    window.__bq = { emerge: 0 };
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
    return { ok: true, realm: B.realm };
})()"""

Q_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry;
    B.clearBoss();
    SF.combat.enemies.clear();
    window.__place(0, 0);
    B.spawnBoss("mini");
    await window.__frames(6);
    const id = B.bossId;
    if (id <= 0) return { err: "no boss", refusal: B.lastRefusal };
    const s = R.slot(id);
    const read = (sl) => ({ hp: +R.hp[sl].toFixed(1), hpMax: +R.hpMax[sl].toFixed(1),
        poise: +R.poise[sl].toFixed(1), poiseMax: +R.poiseMax[sl].toFixed(1),
        chill: R.chill[sl], brittleLeft: +Math.max(0, R.brittleUntil[sl] - R.time).toFixed(2),
        breakLeft: +Math.max(0, R.breakUntil[sl] - R.time).toFixed(2),
        lvl: R.level[sl], name: R.name[sl], kind: R.kind[sl] });
    // chip the stance most of the way down and stack chill
    for (let i = 0; i < 5; i++) {
        R.damage(id, 20, { poise: R.poiseMax[s] * 0.15, chill: true });
        await window.__frames(2);
    }
    const before = read(R.slot(id));
    B.ax += 200;                      // force the re-seat
    await window.__frames(4);
    const nid = B.bossId;
    const after = read(R.slot(nid));
    return { oldId: id, newId: nid, before, after,
             leashReturns: B.leashReturns };
})()"""

R_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, en = SF.combat.enemies,
          R = SF.combat.registry;
    B.clearBoss();
    en.clear();
    const c = SF.character;
    window.__place(0, 0);
    await window.__frames(3);
    // fill every enemy slot
    let filled = 0;
    for (let i = 0; i < 40; i++) {
        const a = i * 0.7;
        if (en.spawn("rimeImp", c.position.x + Math.cos(a) * 18,
                     c.position.z + Math.sin(a) * 18, 5) > 0) filled++;
    }
    // spawnBoss with the pool full: it sets kind/row, picks an arena and
    // fails at enemies.spawn(), leaving the event PENDING (stage O).
    const ok = B.spawnBoss("mini");
    const armed = { ok, state: B.state, kind: B.kind, key: B.stats.key,
                    refusal: B.lastRefusal, id: B.bossId };
    // drag the arena under the player so the pending branch re-enters _emerge
    B.ax = c.position.x; B.az = c.position.z;
    await window.__frames(3);
    window.__bq.emerge = 0;
    const t0 = R.time;
    let frames = 0;
    await new Promise((res) => {
        const t = () => { frames++;
            (R.time - t0 >= 4) ? res() : requestAnimationFrame(t); };
        requestAnimationFrame(t);
    });
    let alive = 0;
    for (let sl = 0; sl < R.count; sl++) if (R.kind[sl] === "enemy") alive++;
    return { poolFilled: filled, armed, aliveEnemies: alive,
             gameSeconds: +(R.time - t0).toFixed(2), rafFrames: frames,
             emergeCalls: window.__bq.emerge, state: B.state, id: B.bossId,
             refusal: B.lastRefusal };
})()"""

STAGES = [("Q leash wipes fight state", Q_JS)]


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
            pg.wait_for_timeout(15000)
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
