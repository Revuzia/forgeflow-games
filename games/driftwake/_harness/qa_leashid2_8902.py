# -*- coding: utf-8 -*-
"""
qa_leashid2_8902.py -- v2 of the adversarial verify.

v1 fixes:
  * retry spawnBoss until the body has streamed ("body not streamed:
    glacierBrute" killed stage A)
  * spawnBoss calls _pickArena() and OVERWRITES ax/az, so the arena must be
    yanked AFTER the spawn, and the player must be teleported to the boss's
    ACTUAL registry position (v1 stages C/D/E never leashed and the wave
    never reached the body)
  * per-frame diagnostics on the leash trigger so a non-firing leash is
    visible rather than silently scoring as "no defect"

Question under test (unchanged): does any REAL damage source call
registry.damage() with an id it captured on an EARLIER frame, so that a
leash re-seat swallows a committed killing blow?
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
    window.__dmg = []; window.__rec = false;
    if (!R.__wrapped) {
        R.__wrapped = true;
        const od = R.damage.bind(R);
        R.damage = function (id, amt, o) {
            const pre = R.slot(id);
            const dealt = od(id, amt, o);
            if (window.__rec) window.__dmg.push({
                id: id, live: pre >= 0, dealt: +(+dealt).toFixed(2),
                tag: (o && o.tag) || null, t: +R.time.toFixed(3) });
            return dealt;
        };
    }
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

    // Spawn the boss, RETRYING until the body streams in, then teleport the
    // player onto it and report the ACTUAL arena + body position.
    window.__boss = async (kind) => {
        const B = SF.combat.bosses;
        for (let a = 0; a < 40; a++) {
            B.clearBoss(); SF.combat.enemies.clear();
            if (B.spawnBoss(kind)) break;
            await window.__gwait(0.4);
        }
        await window.__frames(4);
        const id = B.bossId;
        if (id <= 0) return { id: -1, refusal: B.lastRefusal };
        const s = R.slot(id);
        window.__place(R.x[s] - 6, R.z[s]);       // player 6 m off the body
        await window.__frames(2);
        const s2 = R.slot(id);
        return { id, ax: +B.ax.toFixed(2), az: +B.az.toFixed(2),
                 bx: +R.x[s2].toFixed(2), bz: +R.z[s2].toFixed(2),
                 hpMax: +R.hpMax[s2].toFixed(1), kind: B.kind };
    };
    // Yank the arena 200 m away -> next _updateLive() leashes the body home.
    window.__yank = () => { const B = SF.combat.bosses; B.az += 200; };
    return { ok: true, realm: SF.combat.bosses.realm,
             test: SF.progression.testMode === true, leashM: 30 };
})()"""

# ---- A: replicate the lane's synthetic stale-id call --------------------
A_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry;
    const b = await window.__boss("mini");
    if (b.id <= 0) return { err: "no boss", refusal: b.refusal };
    const oldId = b.id, s0 = R.slot(oldId), max = R.hpMax[s0];
    R.damage(oldId, max * 0.9, {});
    await window.__frames(2);
    const hpBefore = R.hp[R.slot(oldId)];
    window.__yank();
    const trace = [];
    for (let f = 0; f < 5; f++) {
        await window.__frames(1);
        const s = R.slot(B.bossId);
        trace.push({ f, bossId: B.bossId, leashReturns: B.leashReturns,
                     staleSlot: R.slot(oldId),
                     hp: s >= 0 ? +R.hp[s].toFixed(1) : null });
    }
    const newId = B.bossId;
    const dealtOnStale = R.damage(oldId, 1e9, {});
    await window.__frames(3);
    const sN = R.slot(newId);
    return { spawn: b, oldId, newId, hpMax: +max.toFixed(1),
             hpBeforeLeash: +hpBefore.toFixed(1),
             dealtOnStale: +dealtOnStale.toFixed(2),
             staleSlotAfter: R.slot(oldId),
             newHp: sN >= 0 ? +R.hp[sN].toFixed(1) : null,
             leashReturns: B.leashReturns, state: B.state, kills: B.kills,
             trace };
})()"""

# ---- B: a REAL bolt in flight across the re-seat ------------------------
B_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry,
          SP = SF.spells;
    const b = await window.__boss("mini");
    if (b.id <= 0) return { err: "no boss", refusal: b.refusal };
    const oldId = b.id;
    // stand 25 m back so the bolt has ~1.2 s of flight at 21 m/s
    const s0 = R.slot(oldId);
    window.__place(R.x[s0] - 25, R.z[s0]);
    await window.__frames(2);
    R.damage(oldId, R.hpMax[R.slot(oldId)] * 0.95, {});   // 5% left = lethal
    await window.__frames(2);
    const sA = R.slot(oldId);
    const hpPre = R.hp[sA];
    const bpos = [+R.x[sA].toFixed(2), +R.z[sA].toFixed(2)];

    window.__arm();
    const c = SF.character;
    const hx = c.position.x, hy = c.position.y + 1.2, hz = c.position.z;
    let dx = R.x[sA] - hx, dy = (R.y[sA] + 1.0) - hy, dz = R.z[sA] - hz;
    const l = Math.hypot(dx, dy, dz) || 1;
    const slot = SP.bolt.fire(hx, hy, hz, dx / l, dy / l, dz / l, 21, 40, 0, 1);
    const live = () => { let n = 0;
        for (let i = 0; i < SP.bolt.alive.length; i++) n += SP.bolt.alive[i] ? 1 : 0;
        return n; };
    await window.__frames(4);
    const airborne = live();
    const boltPos = slot >= 0 ? [+SP.bolt.x[slot].toFixed(2), +SP.bolt.z[slot].toFixed(2)] : null;
    window.__yank();                       // leash MID-FLIGHT
    await window.__frames(4);
    const newId = B.bossId;
    const sMid = R.slot(newId);
    const seatPos = sMid >= 0 ? [+R.x[sMid].toFixed(2), +R.z[sMid].toFixed(2)] : null;
    await window.__gwait(2.5);             // let the bolt live out its range
    window.__disarm();
    const calls = window.__dmg.slice();
    const sN = R.slot(newId);
    return { spawn: b, oldId, newId, boltSlot: slot,
             boltAirborneAtYank: airborne, boltPosAtYank: boltPos,
             bossPosAtShot: bpos, bossPosAfterReseat: seatPos,
             hpPreShot: +hpPre.toFixed(1),
             newHp: sN >= 0 ? +R.hp[sN].toFixed(1) : null,
             damageCalls: calls.length,
             staleIdCalls: calls.filter(x => !x.live).length,
             staleIdDetail: calls.filter(x => !x.live).slice(0, 8),
             callTags: calls.reduce((a, x) => (a[x.tag || "?"] = (a[x.tag || "?"] || 0) + 1, a), {}),
             seat: window.__seat.slice(0, 6),
             leashReturns: B.leashReturns, state: B.state, kills: B.kills };
})()"""

# ---- B2: control -- the SAME bolt, no leash. Does it hit and kill? ------
B2_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry,
          SP = SF.spells;
    const b = await window.__boss("mini");
    if (b.id <= 0) return { err: "no boss", refusal: b.refusal };
    const id = b.id, s0 = R.slot(id);
    window.__place(R.x[s0] - 25, R.z[s0]);
    await window.__frames(2);
    const sA = R.slot(id);
    R.damage(id, R.hpMax[sA] * 0.95, {});
    await window.__frames(2);
    const sB = R.slot(id);
    const hpPre = R.hp[sB];
    window.__arm();
    const c = SF.character;
    const hx = c.position.x, hy = c.position.y + 1.2, hz = c.position.z;
    let dx = R.x[sB] - hx, dy = (R.y[sB] + 1.0) - hy, dz = R.z[sB] - hz;
    const l = Math.hypot(dx, dy, dz) || 1;
    SP.bolt.fire(hx, hy, hz, dx / l, dy / l, dz / l, 21, 40, 0, 1);
    await window.__gwait(2.5);
    window.__disarm();
    const calls = window.__dmg.slice();
    const sN = R.slot(id);
    return { hpPreShot: +hpPre.toFixed(1),
             hpAfter: sN >= 0 ? +R.hp[sN].toFixed(1) : null,
             boltHits: calls.filter(x => x.tag === "bolt").length,
             boltDetail: calls.filter(x => x.tag === "bolt").slice(0, 4),
             staleIdCalls: calls.filter(x => !x.live).length,
             leashReturns: B.leashReturns };
})()"""

# ---- C: TAB targeting across the re-seat -------------------------------
C_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry,
          T = SF.combat.targeting;
    const b = await window.__boss("mini");
    if (b.id <= 0) return { err: "no boss", refusal: b.refusal };
    const oldId = b.id;
    T.targetId = oldId;
    window.__yank();
    const trace = [];
    for (let f = 0; f < 8; f++) {
        await window.__frames(1);
        trace.push({ f, targetId: T.targetId, bossId: B.bossId,
                     changed: T.changed, leash: B.leashReturns });
    }
    return { oldId, newId: B.bossId, trace,
             clearedWithinFrames: trace.findIndex(t => t.targetId === -1),
             everPointedAtRetiredId: trace.some(
                 t => t.targetId === oldId && t.bossId !== oldId) };
})()"""

# ---- D: wave one-hit latch across the re-seat (opposite-sign bug) -------
D_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry,
          SP = SF.spells;
    const out = {};
    for (const mode of ["control", "reseat"]) {
        const b = await window.__boss("mini");
        if (b.id <= 0) { out[mode] = { err: "no boss", refusal: b.refusal }; continue; }
        const oldId = b.id, s0 = R.slot(oldId);
        window.__place(R.x[s0] - 5, R.z[s0]);
        await window.__frames(3);
        window.__arm();
        SP._cdUntil[1] = 0;
        SP.cast(1);                       // internal key 1 = wave
        await window.__frames(3);
        const before = window.__dmg.filter(x => x.tag === "wave").length;
        if (mode === "reseat") window.__yank();
        await window.__gwait(2.0);
        window.__disarm();
        const calls = window.__dmg.slice();
        out[mode] = { oldId, newId: B.bossId,
                      waveHitsBeforeYank: before,
                      waveHitsTotal: calls.filter(x => x.tag === "wave").length,
                      waveDetail: calls.filter(x => x.tag === "wave").slice(0, 6),
                      staleIdCalls: calls.filter(x => !x.live).length,
                      tags: calls.reduce((a, x) => (a[x.tag || "?"] = (a[x.tag || "?"] || 0) + 1, a), {}),
                      leashReturns: B.leashReturns };
    }
    return out;
})()"""

# ---- E: is the boss still killable after a re-seat? --------------------
E_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry;
    const b = await window.__boss("realm");
    if (b.id <= 0) return { err: "no realm boss", refusal: b.refusal };
    const oldId = b.id, s0 = R.slot(oldId), max = R.hpMax[s0];
    R.damage(oldId, max * 0.9, {});
    await window.__frames(2);
    window.__yank();
    await window.__frames(5);
    const newId = B.bossId;
    const sN = R.slot(newId);
    const hpAfterLeash = sN >= 0 ? R.hp[sN] : null;
    const dealt = R.damage(newId, 1e9, {});
    await window.__gwait(1.5);
    return { oldId, newId, kind: b.kind, hpMax: +max.toFixed(1),
             hpAfterLeash: hpAfterLeash === null ? null : +hpAfterLeash.toFixed(1),
             regenFrac: +B.lastRegenFrac.toFixed(3),
             dealtOnNewId: +dealt.toFixed(2), kills: B.kills, state: B.state,
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
                             ("B2 control: same bolt, no leash", B2_JS),
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
