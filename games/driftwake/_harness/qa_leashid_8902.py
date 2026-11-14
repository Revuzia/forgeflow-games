# -*- coding: utf-8 -*-
"""
qa_leashid_8902.py -- ADVERSARIAL VERIFY of the claim

    "Leash re-seat retires the boss's registry id: a killing blow already in
     flight is silently swallowed."

The hunt lane's stage M proved only that `registry.damage(retiredId, ...)`
returns 0.  That is the documented contract of `damage()` and it was called
BY THE PROBE ITSELF, not by any gameplay code.  This probe asks the question
that actually decides the severity:

    does any REAL damage source ever call damage() with an id it captured on
    an EARLIER frame, such that a leash re-seat swallows it?

Stages
  A  replicate the lane's synthetic result (mechanism confirm)
  B  DECIDING: a REAL bolt in flight across a leash re-seat, with every
     registry.damage() call recorded (id, was-the-id-live, dealt, tag)
  C  TAB targeting across the re-seat -- does targetId self-clear?
  D  wave/spike one-hit latch across the re-seat -- the OPPOSITE-sign bug
     (does the re-seated boss get hit a SECOND time by the same cast?)
  E  a killing blow delivered the normal way AFTER the re-seat -- is the
     boss still killable, does the portal still open?
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
    window.__gwait = (sec) => new Promise((res) => {
        const t0 = R.time;
        const t = () => (R.time - t0 >= sec) ? res() : requestAnimationFrame(t);
        t();
    });
    window.__frames = (n) => new Promise((res) => {
        let k = n; const t = () => (--k <= 0) ? res() : requestAnimationFrame(t);
        t();
    });
    window.__place = (x, z) => {
        const c = SF.character;
        c.position.x = x; c.position.z = z;
        c.position.y = SF.terrain.heightAt(x, z);
        if (c.velocity) c.velocity.set(0, 0, 0);
    };
    // ---- record EVERY damage() call, with the id's liveness BEFORE the call
    window.__dmg = [];
    window.__rec = false;
    if (!R.__wrapped) {
        R.__wrapped = true;
        const od = R.damage.bind(R);
        R.damage = function (id, amt, o) {
            const pre = R.slot(id);
            const dealt = od(id, amt, o);
            if (window.__rec) {
                window.__dmg.push({
                    id: id, live: pre >= 0, dealt: +(+dealt).toFixed(2),
                    tag: (o && o.tag) || null, t: +R.time.toFixed(3),
                });
            }
            return dealt;
        };
    }
    // ---- record the re-seat edge
    window.__seat = [];
    const en = SF.combat.enemies;
    if (!en.__wrapped) {
        en.__wrapped = true;
        const os = en.spawn.bind(en), odp = en.despawn.bind(en);
        en.spawn = function (k, x, z, l) {
            const id = os(k, x, z, l);
            window.__seat.push({ ev: "spawn", id: id, t: +R.time.toFixed(3) });
            return id;
        };
        en.despawn = function (id) {
            window.__seat.push({ ev: "despawn", id: id, t: +R.time.toFixed(3) });
            return odp(id);
        };
    }
    window.__arm = () => { window.__dmg.length = 0; window.__seat.length = 0;
                           window.__rec = true; };
    window.__disarm = () => { window.__rec = false; };
    return { ok: true, realm: SF.combat.bosses.realm,
             test: SF.progression.testMode === true };
})()"""

# ---------------------------------------------------------------- stage A
A_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry;
    B.clearBoss(); SF.combat.enemies.clear();
    window.__place(0, 0);
    B.spawnBoss("mini");
    await window.__frames(6);
    const oldId = B.bossId;
    if (oldId <= 0) return { err: "no boss", refusal: B.lastRefusal };
    const s0 = R.slot(oldId), max = R.hpMax[s0];
    R.damage(oldId, max * 0.9, {});
    await window.__frames(3);
    const hpBefore = R.hp[R.slot(oldId)];
    B.ax += 200;                       // yank the arena -> leash fires
    await window.__frames(3);
    const newId = B.bossId;
    const dealtOnStale = R.damage(oldId, 1e9, {});
    await window.__frames(3);
    const sN = R.slot(newId);
    return { oldId, newId, hpMax: +max.toFixed(1),
             hpBeforeLeash: +hpBefore.toFixed(1),
             dealtOnStale: +dealtOnStale.toFixed(2),
             staleSlotAfter: R.slot(oldId),
             newHp: sN >= 0 ? +R.hp[sN].toFixed(1) : null,
             sameSlot: s0 === sN, leashReturns: B.leashReturns,
             state: B.state, kills: B.kills };
})()"""

# ---------------------------------------------------------------- stage B
# A REAL bolt, in flight, across the re-seat.  Two sub-cases:
#   B1  the re-seat MOVES the boss away  -> the bolt should MISS (honest)
#   B2  the re-seat lands the boss back ON the bolt's line -> should still HIT
B_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry,
          SP = SF.spells;
    const out = {};
    const fireAt = (tx, ty, tz) => {
        const c = SF.character;
        const hx = c.position.x, hy = c.position.y + 1.2, hz = c.position.z;
        let dx = tx - hx, dy = (ty + 1.0) - hy, dz = tz - hz;
        const l = Math.hypot(dx, dy, dz) || 1;
        return SP.bolt.fire(hx, hy, hz, dx / l, dy / l, dz / l, 21, 40, 0, 1);
    };
    const liveBolts = () => {
        let n = 0;
        for (let i = 0; i < SP.bolt.alive.length; i++) n += SP.bolt.alive[i] ? 1 : 0;
        return n;
    };

    for (const mode of ["away", "onto"]) {
        B.clearBoss(); SF.combat.enemies.clear();
        // player at origin, boss arena 30 m down +X
        window.__place(0, 0);
        B.ax = 30; B.az = 0;
        B.spawnBoss("mini");
        await window.__frames(6);
        const oldId = B.bossId;
        if (oldId <= 0) { out[mode] = { err: "no boss", refusal: B.lastRefusal }; continue; }
        const s0 = R.slot(oldId);
        const max = R.hpMax[s0];
        R.damage(oldId, max * 0.95, {});          // leave 5% -- lethal window
        await window.__frames(2);
        const hpPre = R.hp[R.slot(oldId)];

        window.__arm();
        // fire a REAL bolt at the boss's current body
        const sA = R.slot(oldId);
        const bx = R.x[sA], by = R.y[sA], bz = R.z[sA];
        const slot = fireAt(bx, by, bz);
        // let it get airborne, then trigger the leash MID-FLIGHT
        await window.__frames(3);
        const boltsUp = liveBolts();
        if (mode === "away") {
            B.ax = 30; B.az = 120;                // re-seat 120 m sideways
        } else {
            B.ax = 30; B.az = 0;                  // re-seat right where it was
        }
        // push the body out of leash range so the director fires _leashHome
        const sB = R.slot(oldId);
        if (sB >= 0) { R.x[sB] += 400; R.z[sB] += 400; }
        await window.__frames(4);
        const newId = B.bossId;
        // let the bolt live out its flight
        await window.__gwait(2.2);
        window.__disarm();

        const sN = R.slot(newId);
        const calls = window.__dmg.slice();
        out[mode] = {
            oldId, newId, boltSlot: slot, boltsAirborneAtLeash: boltsUp,
            hpMax: +max.toFixed(1), hpPreShot: +hpPre.toFixed(1),
            newHp: sN >= 0 ? +R.hp[sN].toFixed(1) : null,
            damageCalls: calls.length,
            staleIdCalls: calls.filter(c => !c.live).length,
            staleIdDetail: calls.filter(c => !c.live).slice(0, 6),
            boltCalls: calls.filter(c => c.tag === "bolt"),
            seat: window.__seat.slice(),
            leashReturns: B.leashReturns, state: B.state, kills: B.kills,
        };
    }
    return out;
})()"""

# ---------------------------------------------------------------- stage C
C_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry,
          T = SF.combat.targeting;
    B.clearBoss(); SF.combat.enemies.clear();
    window.__place(0, 0);
    B.ax = 10; B.az = 0;
    B.spawnBoss("mini");
    await window.__frames(6);
    const oldId = B.bossId;
    if (oldId <= 0) return { err: "no boss" };
    T.targetId = oldId;                      // as a TAB press would leave it
    const before = T.targetId;
    B.ax = 10; B.az = 90;
    const s = R.slot(oldId); if (s >= 0) { R.x[s] += 400; }
    const trace = [];
    for (let f = 0; f < 6; f++) {
        await window.__frames(1);
        trace.push({ f, targetId: T.targetId, bossId: B.bossId,
                     changed: T.changed });
    }
    return { oldId, before, newId: B.bossId, trace,
             selfCleared: trace.some(t => t.targetId === -1) };
})()"""

# ---------------------------------------------------------------- stage D
D_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry,
          SP = SF.spells, SH = SF.combat.hits || SF.combat.spellHits;
    B.clearBoss(); SF.combat.enemies.clear();
    window.__place(0, 0);
    B.ax = 6; B.az = 0;
    B.spawnBoss("mini");
    await window.__frames(6);
    const oldId = B.bossId;
    if (oldId <= 0) return { err: "no boss" };
    window.__arm();
    // wave (internal key 1): a one-hit-per-cast latch keyed on registry id
    SP.cast(1);
    await window.__frames(4);
    const mid = window.__dmg.filter(c => c.tag === "wave").length;
    // re-seat MID-WAVE, keeping the arena under the wave's path
    const s = R.slot(oldId); if (s >= 0) { R.x[s] += 400; }
    await window.__gwait(1.6);
    window.__disarm();
    const calls = window.__dmg.slice();
    return { oldId, newId: B.bossId,
             waveHitsBeforeReseat: mid,
             waveHitsTotal: calls.filter(c => c.tag === "wave").length,
             staleIdCalls: calls.filter(c => !c.live).length,
             tags: calls.reduce((a, c) => (a[c.tag || "?"] = (a[c.tag || "?"] || 0) + 1, a), {}),
             leashReturns: B.leashReturns };
})()"""

# ---------------------------------------------------------------- stage E
E_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry;
    B.clearBoss(); SF.combat.enemies.clear();
    window.__place(0, 0);
    B.ax = 8; B.az = 0;
    B.spawnBoss("realm");
    await window.__frames(6);
    const oldId = B.bossId;
    if (oldId <= 0) return { err: "no realm boss", refusal: B.lastRefusal };
    const kind = B.kind;
    const s0 = R.slot(oldId);
    R.damage(oldId, R.hpMax[s0] * 0.9, {});
    await window.__frames(2);
    const s = R.slot(oldId); if (s >= 0) { R.x[s] += 400; }
    await window.__frames(4);
    const newId = B.bossId;
    const sN = R.slot(newId);
    const hpAfterLeash = sN >= 0 ? R.hp[sN] : null;
    // the player re-acquires and kills the CURRENT body -- the normal path
    const dealt = R.damage(newId, 1e9, {});
    await window.__gwait(1.5);
    return { oldId, newId, kind, hpMax: +R.hpMax[s0 >= 0 ? s0 : 0].toFixed(1),
             hpAfterLeash: hpAfterLeash === null ? null : +hpAfterLeash.toFixed(1),
             dealtOnNewId: +dealt.toFixed(2),
             kills: B.kills, state: B.state,
             portalOpen: !!(SF.portal && SF.portal.isOpen),
             leashReturns: B.leashReturns };
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
            for name, js in (("A synthetic stale-id (lane replicate)", A_JS),
                             ("B real bolt across re-seat", B_JS),
                             ("C TAB target across re-seat", C_JS),
                             ("D wave latch across re-seat", D_JS),
                             ("E kill after re-seat", E_JS)):
                try:
                    out[name] = pg.evaluate(js)
                except Exception as ex:
                    out[name] = {"probe_error": str(ex)[:400]}
            out["pageerrors"] = errs[:8]
            br.close()
    finally:
        srv.terminate()
    txt = json.dumps(out, indent=1)
    print(txt)
    Path(__file__).with_suffix(".json").write_text(txt, encoding="utf-8")


main()
