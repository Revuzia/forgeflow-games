# -*- coding: utf-8 -*-
"""
qa_leashstatus_8902.py -- stage F.

The hunt lane read the re-seat as swallowing an in-flight killing blow (B/C
refuted that).  This measures the consequence the lane did NOT look at: the
re-seat runs through `enemies.spawn` -> `registry.register()`, which
initialises a FRESH slot (damageable.js:145-152: poise=poiseMax,
brittleUntil=0, breakUntil=0, chill=0, stunUntil=0, DR counters zeroed).

So: does a leash re-seat erase Chill/Brittle, the ground-down poise bar, and
the stance-break window the player spent the fight building?
"""
import json
import subprocess
import sys
import time as _t
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8902
URL = "http://localhost:%d/games/driftwake/index.html?autoplay&test" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

SETUP = r"""(() => {
    const SF = SNOWFLOW, R = SF.combat.registry;
    window.__f = (n) => new Promise((res) => {
        let k = Math.max(1, n | 0);
        const t = () => { if (--k <= 0) res(); else requestAnimationFrame(t); };
        requestAnimationFrame(t);
    });
    window.__gwait = (sec) => new Promise((res) => {
        const t0 = R.time;
        const t = () => (R.time - t0 >= sec) ? res() : requestAnimationFrame(t);
        requestAnimationFrame(t);
    });
    window.__place = (x, z) => {
        const c = SF.character;
        c.position.x = x; c.position.z = z;
        c.position.y = SF.terrain.heightAt(x, z);
        if (c.velocity) c.velocity.set(0, 0, 0);
    };
    window.__boss = async (kind) => {
        const B = SF.combat.bosses;
        for (let a = 0; a < 40; a++) {
            B.clearBoss(); SF.combat.enemies.clear();
            if (B.spawnBoss(kind)) break;
            await window.__gwait(0.4);
        }
        await window.__f(4);
        const id = B.bossId;
        if (id <= 0) return { id: -1, refusal: B.lastRefusal };
        const s = R.slot(id);
        window.__place(R.x[s] - 6, R.z[s]);
        await window.__f(2);
        return { id };
    };
    window.__yank = () => { SF.combat.bosses.az += 200; };
    const snap = (id) => {
        const s = R.slot(id);
        if (s < 0) return null;
        return { hp: +R.hp[s].toFixed(1), hpMax: +R.hpMax[s].toFixed(1),
                 poise: +R.poise[s].toFixed(1), poiseMax: +R.poiseMax[s].toFixed(1),
                 chill: R.chill[s],
                 brittleLeft: +Math.max(0, R.brittleUntil[s] - R.time).toFixed(2),
                 breakLeft: +Math.max(0, R.breakUntil[s] - R.time).toFixed(2),
                 slowLeft: +Math.max(0, R.slowUntil[s] - R.time).toFixed(2) };
    };
    window.__snap = snap;
    return { ok: true, realm: SF.combat.bosses.realm };
})()"""

F_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry;
    const b = await window.__boss("mini");
    if (b.id <= 0) return { err: "no boss", refusal: b.refusal };
    const oldId = b.id;

    // Build the state a real cold-realm fight builds:
    //  * five chill stacks -> Brittle (+20% damage taken, damageable.js:228)
    //  * grind the poise bar down toward a stance break
    for (let k = 0; k < 5; k++) {
        R.damage(oldId, 5, { chill: true, poise: 30, tag: "probe-chill" });
        await window.__f(1);
    }
    const built = window.__snap(oldId);

    // Measure the Brittle multiplier is really live: 100 raw should land 120.
    const sX = R.slot(oldId);
    const hpA = R.hp[sX];
    R.damage(oldId, 100, { tag: "probe-meter" });
    const dealtBrittle = +(hpA - R.hp[R.slot(oldId)]).toFixed(2);

    const preLeash = window.__snap(oldId);
    window.__yank();
    await window.__f(4);
    const newId = B.bossId;
    const postLeash = window.__snap(newId);

    // Same 100 raw on the re-seated body.
    const sY = R.slot(newId);
    const hpB = R.hp[sY];
    R.damage(newId, 100, { tag: "probe-meter" });
    const dealtAfter = +(hpB - R.hp[R.slot(newId)]).toFixed(2);

    return { oldId, newId, built, preLeash, postLeash,
             dealtOn100Raw_beforeLeash: dealtBrittle,
             dealtOn100Raw_afterLeash: dealtAfter,
             leashReturns: B.leashReturns, regenFrac: +B.lastRegenFrac.toFixed(3) };
})()"""


def main():
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT)],
                           cwd=str(ROOT),
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    _t.sleep(2.5)
    out = {}
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(URL, wait_until="load", timeout=60000)
            pg.wait_for_function(
                "() => window.SNOWFLOW && !SNOWFLOW.S.freezeTime", timeout=60000)
            pg.wait_for_timeout(2500)
            out["setup"] = pg.evaluate(SETUP)
            try:
                out["F status across re-seat"] = pg.evaluate(F_JS)
            except Exception as ex:
                out["F status across re-seat"] = {"probe_error": str(ex)[:400]}
            out["pageerrors"] = errs[:8]
            br.close()
    finally:
        srv.terminate()
    txt = json.dumps(out, indent=1)
    print(txt)
    Path(__file__).with_suffix(".json").write_text(txt, encoding="utf-8")


main()
