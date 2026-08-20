# -*- coding: utf-8 -*-
"""
qa_bossedge_8891.py -- boss/portal EDGE cases.

  B  realm change (dev portal) while a boss is LIVE -> does it leak?
  C  phase 2 under chip damage: exactly once?
  D  phase 2 + leash regen back above the threshold: does it stick?
  E  leash ratchet: how much HP does repeated leashing hand back?
  F  boss killed at the world rim -> where does the portal land?
  G  double-pay: same boss, two kills in one run
  H  packs during a boss fight
  I  player dies mid-fight
  J  natural (unforced) arming: pending -> emerge without spawnBoss()
  K  progression.newGame() -> bossesKilled shape / save round-trip
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
    window.__bq = { xp: [], p2: 0, leash: 0, death: 0 };
    const PR = SF.progression;
    const oa = PR.addXP.bind(PR);
    PR.addXP = function (n, why) { window.__bq.xp.push([n, why || null]); return oa(n, why); };
    const B = SF.combat.bosses;
    const op2 = B._openPhase2.bind(B);
    B._openPhase2 = function () { window.__bq.p2++; return op2(); };
    const ol = B._leashHome.bind(B);
    B._leashHome = function (a, b) { window.__bq.leash++; return ol(a, b); };
    const od = B._onDeath.bind(B);
    B._onDeath = function () { window.__bq.death++; return od(); };
    window.__gwait = (sec) => new Promise((res) => {
        const R = SF.combat.registry, t0 = R.time;
        const t = () => (R.time - t0 >= sec) ? res() : requestAnimationFrame(t);
        t();
    });
    window.__frames = (n) => new Promise((res) => {
        let k = n; const t = () => (--k <= 0) ? res() : requestAnimationFrame(t); t();
    });
    window.__snap = () => {
        const R = SF.combat.registry;
        let bosses = 0, enemies = 0;
        for (let s = 0; s < R.count; s++) {
            if (R.kind[s] === "boss") bosses++;
            else if (R.kind[s] === "enemy") enemies++;
        }
        const b = SF.combat.bosses.stats;
        return { regCount: R.count, regBoss: bosses, regEnemy: enemies,
            state: b.state, kind: b.kind, key: b.key, id: b.id,
            hp: +b.hp.toFixed(1), hpMax: +b.hpMax.toFixed(1),
            hpFrac: +b.hpFrac.toFixed(4), phase: b.phase, p2pct: b.phase2Pct,
            speedBase: +(b.speedBase || 0).toFixed(3),
            speedNow: +(b.speedNow || 0).toFixed(3),
            patN: b.patternNow, patAll: b.patternAll,
            leashReturns: b.leashReturns, regen: +(b.lastRegenFrac || 0).toFixed(4),
            kills: b.kills, ev: b.eventsFired, killed: Object.assign({}, b.killed),
            refusal: b.refusal, portalOpen: b.portalOpen,
            arena: [+b.arenaX.toFixed(1), +b.arenaZ.toFixed(1)],
            arenaGrade: +b.arenaGrade.toFixed(4), arenaDist: +b.arenaDist.toFixed(1),
            realmDir: SF.combat.bosses.realm, bossLive: SF.combat.encounters.bossLive,
            portal: SF.portal.stats, hooks: Object.assign({}, window.__bq),
            playerHp: +SF.character.health.toFixed(1),
            dead: SF.progression.dead, deaths: SF.progression.deaths };
    };
    window.__place = (x, z) => {
        const c = SF.character;
        c.position.x = x; c.position.z = z;
        c.position.y = SF.terrain.heightAt(x, z);
        c.velocity.set(0, 0, 0);
    };
    return { ok: true, playRadius: SF.terrain.playRadius };
})()"""

# --- B: realm change while a boss is live ---------------------------------
B_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses;
    window.__place(0, 0);
    B.spawnBoss("mini");
    await window.__frames(4);
    const live = window.__snap();
    const bossId = B.bossId;
    await SF.enterRealm("sand");
    await window.__frames(6);
    const R = SF.combat.registry;
    let leaked = 0, names = [];
    for (let s = 0; s < R.count; s++) {
        if (R.kind[s] === "boss") { leaked++; names.push(R.name[s]); }
    }
    return { live, oldBossId: bossId, oldSlotAfter: R.slot(bossId),
             leakedBossBodies: leaked, leakedNames: names,
             after: window.__snap() };
})()"""

# --- C/D: phase 2 under chip damage, then leash regen above threshold ------
CD_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry;
    B.clearBoss();
    window.__place(0, 0);
    window.__bq.p2 = 0; window.__bq.leash = 0;
    B.spawnBoss("mini");
    await window.__frames(4);
    const id = B.bossId, s0 = R.slot(id);
    const max = R.hpMax[s0];
    const pct = B.phase2Pct;
    const before = window.__snap();
    // chip from 100% down to ~40% in 1% bites, one bite per frame
    const trace = [];
    for (let i = 0; i < 60; i++) {
        R.damage(id, max * 0.01, {});
        await window.__frames(2);
        const s = R.slot(id);
        if (s < 0) break;
        trace.push([+(R.hp[s] / max).toFixed(3), B.phase, window.__bq.p2]);
    }
    const afterChip = window.__snap();
    // now force a leash: move the arena 200 m and let the director re-seat
    const ax0 = B.ax, az0 = B.az;
    B.ax = ax0 + 200; B.az = az0;
    await window.__frames(6);
    const afterLeash = window.__snap();
    // top the boss right back up over the phase threshold and watch the phase
    const s2 = R.slot(B.bossId);
    if (s2 >= 0) R.hp[s2] = R.hpMax[s2];
    await window.__frames(6);
    const afterHeal = window.__snap();
    return { hpMax: max, phase2Pct: pct, before, trace,
             afterChip, afterLeash, afterHeal,
             p2calls: window.__bq.p2, leashCalls: window.__bq.leash };
})()"""

# --- E: leash ratchet ------------------------------------------------------
E_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry;
    B.clearBoss();
    window.__place(0, 0);
    B.spawnBoss("mini");
    await window.__frames(4);
    let id = B.bossId, s = R.slot(id);
    const max = R.hpMax[s];
    R.damage(id, max * 0.95, {});          // down to 5%
    await window.__frames(3);
    const rows = [];
    let ax = B.ax, az = B.az;
    for (let i = 0; i < 6; i++) {
        s = R.slot(B.bossId);
        rows.push(+(R.hp[s] / max).toFixed(4));
        B.ax = ax + 200 * ((i % 2) ? -1 : 1);   // yank the arena either way
        await window.__frames(5);
    }
    s = R.slot(B.bossId);
    rows.push(+(R.hp[s] / max).toFixed(4));
    return { hpMax: max, hpFracPerLeash: rows,
             leashReturns: B.leashReturns, snap: window.__snap() };
})()"""

# --- F: boss killed at the world rim --------------------------------------
F_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, T = SF.terrain;
    B.clearBoss();
    const Rr = T.playRadius;
    window.__place(Rr - 6, 0);              // deep in the storm band
    const edgePlayer = T.edge01(SF.character.position.x, SF.character.position.z);
    B.spawnBoss("realm");
    await window.__frames(4);
    const live = window.__snap();
    const ax = B.ax, az = B.az;
    const arenaR = Math.hypot(ax, az);
    const h = (x, z) => T.heightAt(x, z);
    const slope = Math.hypot((h(ax + 2, az) - h(ax - 2, az)) / 4,
                             (h(ax, az + 2) - h(ax, az - 2)) / 4);
    SF.combat.registry.damage(B.bossId, 1e9, {});
    await window.__frames(6);
    const p = SF.portal.stats;
    return { playRadius: Rr, edgeAtPlayer: +edgePlayer.toFixed(3),
             arenaR: +arenaR.toFixed(1), arenaSlope: +slope.toFixed(4),
             arenaGrade: +B.arenaGrade.toFixed(4),
             portalR: +Math.hypot(p.x, p.z).toFixed(1),
             portalEdge01: +T.edge01(p.x, p.z).toFixed(3),
             portalY: +p.y.toFixed(2), refusal: B.lastRefusal,
             live, after: window.__snap() };
})()"""

# --- G: double-pay ---------------------------------------------------------
G_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry;
    B.clearBoss();
    window.__place(0, 0);
    const out = [];
    for (let k = 0; k < 2; k++) {
        window.__bq.xp.length = 0;
        const lvlBefore = SF.progression.level, xpBefore = SF.progression.xp;
        const ok = B.spawnBoss("realm");
        await window.__frames(4);
        const id = B.bossId;
        R.damage(id, 1e9, {});
        await window.__frames(6);
        out.push({ pass: k, ok, id, xp: window.__bq.xp.slice(),
                   lvlBefore, xpBefore,
                   lvlAfter: SF.progression.level, xpAfter: SF.progression.xp,
                   kills: B.kills, portalOpen: SF.portal.isOpen,
                   killed: Object.assign({}, B.stats.killed) });
        await window.__gwait(2);
    }
    return out;
})()"""

# --- H: packs during a boss fight -----------------------------------------
H_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, E = SF.combat.encounters,
          R = SF.combat.registry;
    B.clearBoss();
    SF.combat.enemies.clear();
    window.__place(0, 0);
    B.spawnBoss("mini");
    await window.__frames(4);
    const rows = [];
    for (let i = 0; i < 8; i++) {
        await window.__gwait(8);
        let e = 0, b = 0;
        for (let s = 0; s < R.count; s++) {
            if (R.kind[s] === "boss") b++; else if (R.kind[s] === "enemy") e++;
        }
        rows.push({ t: +R.time.toFixed(1), enemies: e, bosses: b,
            bossLive: E.bossLive,
            slots: E._slots.map(s => ({ a: s.active,
                n: s.name || null, live: s.live, dead: s.dead })) });
    }
    return { rows, snap: window.__snap() };
})()"""

# --- I: player dies mid-fight ---------------------------------------------
I_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry;
    B.clearBoss();
    window.__place(0, 0);
    B.spawnBoss("mini");
    await window.__frames(4);
    const id = B.bossId;
    const before = window.__snap();
    SF.character.health = 0;
    await window.__gwait(0.5);
    const dying = window.__snap();
    // kill the boss WHILE the player is in the death fade
    const dealt = R.damage(id, 1e9, {});
    await window.__frames(6);
    const killedWhileDying = window.__snap();
    await window.__gwait(4);                 // let the respawn land
    const after = window.__snap();
    return { before, dying, dealt, killedWhileDying, after,
             hooks: Object.assign({}, window.__bq) };
})()"""

# --- J: natural arming (no spawnBoss) -------------------------------------
J_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses;
    B.clearBoss();
    B._killed = Object.create(null);
    SF.progression.bossesKilled = {};
    window.__place(0, 0);
    const rows = [];
    for (let i = 0; i < 14; i++) {
        await window.__gwait(2);
        const b = B.stats;
        rows.push({ t: +SF.combat.registry.time.toFixed(1), state: b.state,
            kind: b.kind, key: b.key, id: b.id, refusal: b.refusal,
            arena: [+b.arenaX.toFixed(1), +b.arenaZ.toFixed(1)],
            dPlayer: +Math.hypot(b.arenaX - SF.character.position.x,
                                 b.arenaZ - SF.character.position.z).toFixed(1) });
        // after 3 samples, walk the player onto the arena so it must emerge
        if (i === 3 && B.state === "pending") window.__place(B.ax, B.az);
    }
    return rows;
})()"""

# --- K: progression.newGame() bossesKilled shape --------------------------
K_JS = r"""(() => {
    const PR = SNOWFLOW.progression;
    PR.newGame();
    const isArr = Array.isArray(PR.bossesKilled);
    PR.bossesKilled["cold:mini"] = true;
    PR.bossesKilled["The Icewall"] = true;
    PR.save();
    let raw = null;
    try { raw = localStorage.getItem("driftwake_save"); } catch (e) { raw = "ERR " + e; }
    let round = null;
    try {
        const b = JSON.parse(raw && raw.startsWith("{") ? raw : "{}");
        round = b.bossesKilled;
    } catch (e) { round = "parse " + e; }
    // reload the blob the way CONTINUE does
    let afterLoad = null;
    try { PR.load(); afterLoad = Object.assign({}, PR.bossesKilled); }
    catch (e) { afterLoad = "load " + e; }
    return { isArray: isArr, inMemory: Object.assign({}, PR.bossesKilled),
             savedRaw: (raw || "").slice(0, 400), roundTripped: round,
             afterLoad: afterLoad };
})()"""


STAGES = [("B realm-change mid-fight", B_JS), ("CD phase2 + leash regen", CD_JS),
          ("E leash ratchet", E_JS), ("F rim kill / portal placement", F_JS),
          ("G double-pay", G_JS), ("H packs during boss", H_JS),
          ("I player dies mid-fight", I_JS), ("J natural arming", J_JS),
          ("K newGame bossesKilled", K_JS)]


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
                    r = {"EVAL_ERROR": str(e)[:600]}
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
