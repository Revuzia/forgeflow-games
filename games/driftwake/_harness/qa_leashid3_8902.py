# -*- coding: utf-8 -*-
"""
qa_leashid3_8902.py -- v3, re-running the stages v2 could not decide.

v2 defect (MINE, and the same off-by-one is in the hunt lane's helper):

    window.__frames = (n) => new Promise((res) => {
        let k = n; const t = () => (--k <= 0) ? res() : requestAnimationFrame(t);
        t();                       // <-- fires SYNCHRONOUSLY
    });

`__frames(1)` decrements to 0 on the synchronous first call and resolves
without ever asking for a frame, so a per-frame trace built on it advances
zero game frames.  v3 uses a helper that always yields at least one rAF.

Stages re-run: A (lane replicate), C (TAB target), D (wave one-hit latch).
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
    // ALWAYS yields at least one real frame.
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
    window.__arm = () => { window.__dmg.length = 0; window.__rec = true; };
    window.__disarm = () => { window.__rec = false; };
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
        const s2 = R.slot(id);
        return { id, ax: +B.ax.toFixed(2), az: +B.az.toFixed(2),
                 bx: +R.x[s2].toFixed(2), bz: +R.z[s2].toFixed(2),
                 hpMax: +R.hpMax[s2].toFixed(1), kind: B.kind };
    };
    window.__yank = () => { SF.combat.bosses.az += 200; };
    return { ok: true, realm: SF.combat.bosses.realm,
             test: SF.progression.testMode === true };
})()"""

A_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry;
    const b = await window.__boss("mini");
    if (b.id <= 0) return { err: "no boss", refusal: b.refusal };
    const oldId = b.id, s0 = R.slot(oldId), max = R.hpMax[s0];
    R.damage(oldId, max * 0.9, {});
    await window.__f(2);
    const hpBefore = R.hp[R.slot(oldId)];
    window.__yank();
    const trace = [];
    for (let f = 0; f < 5; f++) {
        await window.__f(1);
        const s = R.slot(B.bossId);
        trace.push({ f, bossId: B.bossId, leash: B.leashReturns,
                     staleSlot: R.slot(oldId),
                     hp: s >= 0 ? +R.hp[s].toFixed(1) : null });
    }
    const newId = B.bossId;
    const dealtOnStale = R.damage(oldId, 1e9, {});
    await window.__f(3);
    const sN = R.slot(newId);
    return { spawn: b, oldId, newId, hpMax: +max.toFixed(1),
             hpBeforeLeash: +hpBefore.toFixed(1),
             dealtOnStale: +dealtOnStale.toFixed(2),
             staleSlotAfter: R.slot(oldId),
             newHp: sN >= 0 ? +R.hp[sN].toFixed(1) : null,
             regenFrac: +B.lastRegenFrac.toFixed(3),
             leashReturns: B.leashReturns, state: B.state, kills: B.kills,
             trace };
})()"""

C_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry,
          T = SF.combat.targeting, bars = SF.ui && SF.ui.enemybars;
    const b = await window.__boss("mini");
    if (b.id <= 0) return { err: "no boss", refusal: b.refusal };
    const oldId = b.id;
    T.targetId = oldId;
    window.__yank();
    const trace = [];
    for (let f = 0; f < 8; f++) {
        await window.__f(1);
        trace.push({ f, targetId: T.targetId, bossId: B.bossId,
                     changed: T.changed, leash: B.leashReturns,
                     staleSlot: R.slot(oldId) });
    }
    const firstStale = trace.findIndex(t => t.bossId !== oldId);
    const framesPointingAtRetired = trace.filter(
        t => t.bossId !== oldId && t.targetId === oldId).length;
    return { oldId, newId: B.bossId, trace,
             leashFired: B.leashReturns > 0,
             firstFrameAfterReseat: firstStale,
             framesTargetPointedAtRetiredId: framesPointingAtRetired,
             finalTargetId: T.targetId,
             barsPresent: !!bars };
})()"""

D_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry,
          SP = SF.spells;
    const out = { keys: Object.keys(SP._cdUntil || {}) };
    for (const mode of ["control", "reseat"]) {
        const b = await window.__boss("mini");
        if (b.id <= 0) { out[mode] = { err: "no boss", refusal: b.refusal }; continue; }
        const oldId = b.id, s0 = R.slot(oldId);
        // stand ON TOP of the body so a frontal wave cannot miss
        window.__place(R.x[s0] - 3, R.z[s0]);
        await window.__f(3);
        // face the body: the wave uses spells.aim, refreshed from rig.forward
        const s1 = R.slot(oldId);
        const c = SF.character;
        const dx = R.x[s1] - c.position.x, dz = R.z[s1] - c.position.z;
        const l = Math.hypot(dx, dz) || 1;
        if (SF.rig && SF.rig.forward) SF.rig.forward.set(dx / l, 0, dz / l);
        if (c.facing !== undefined) c.facing = Math.atan2(dx / l, -dz / l);
        await window.__f(2);
        window.__arm();
        SP._cdUntil[1] = 0;
        SP.cast(1);
        await window.__f(4);
        const before = window.__dmg.filter(x => x.tag === "wave").length;
        if (mode === "reseat") window.__yank();
        await window.__gwait(2.0);
        window.__disarm();
        const calls = window.__dmg.slice();
        out[mode] = { oldId, newId: B.bossId,
                      waveHitsBeforeYank: before,
                      waveHitsTotal: calls.filter(x => x.tag === "wave").length,
                      allCalls: calls.slice(0, 10),
                      staleIdCalls: calls.filter(x => !x.live).length,
                      tags: calls.reduce((a, x) => (a[x.tag || "?"] = (a[x.tag || "?"] || 0) + 1, a), {}),
                      leashReturns: B.leashReturns };
    }
    return out;
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
                             ("C TAB target across re-seat", C_JS),
                             ("D wave latch across re-seat", D_JS)):
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
