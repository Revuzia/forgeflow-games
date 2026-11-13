# -*- coding: utf-8 -*-
"""
qa_feel_motes_assist.py -- adversarial probe of the mote heal economy,
the hurt vignette, and the bolt aim assist.

  M1  boss payout (8 motes) at FULL health   -> over-heal? wasted?
  M2  boss payout at 1 HP                    -> clamp, picked count
  M3  payout while health == 0 (the guard)   -> resurrection refused?
  M4  drift over a downhill slope            -> does a mote sink into terrain?
  M5  realm switch                           -> pool cleared?
  M6  pool overflow (32 spawned, MOTE_MAX 24)
  H1  vignette peak / stacking, low-hp class across death + mote heal
  A1  aim assist vs a CORPSE (registry alive=1, hp<=0 for DEATH_S=1.2 s)
  A2  aim assist vs the FROST ARC fan (own===1 must never bend)
  E1  boss HP frame while the boss body is in its 1.2 s death fade
"""
import json
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8893
GAME_URL = "http://localhost:%d/games/driftwake/index.html?autoplay&test" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

HELPERS = """
    const S = SNOWFLOW, reg = S.combat.registry, en = S.combat.enemies;
    const c = S.character, motes = S.motes, hurt = S.hurtFx;
    const waitFrames = (n) => new Promise(res => {
        let k = 0;
        const f = () => (++k >= n) ? res() : requestAnimationFrame(f);
        requestAnimationFrame(f);
    });
    const gameWait = (sec) => new Promise((res) => {
        const t0 = reg.time;
        const tick = () => (reg.time - t0 >= sec) ? res()
            : requestAnimationFrame(tick);
        tick();
    });
    const clearField = async () => {
        for (let i = reg.count - 1; i >= 0; i--) en.despawn(reg.idOf[i]);
        motes.clear();
        await waitFrames(2);
    };
"""

MOTES = """(async () => {
""" + HELPERS + """
    const out = {};
    await clearField();
    S.input.locked = true;

    // ---- M1: boss payout (8) at FULL health --------------------------
    c.health = c.healthMax;
    const s0 = { ...motes.stats };
    motes.spawnAt(c.position.x, c.position.z, 8);
    await waitFrames(2);
    let peak = c.health;
    for (let k = 0; k < 90; k++) {
        await waitFrames(1);
        if (c.health > peak) peak = c.health;
        if (motes.stats.active === 0) break;
    }
    out.M1 = { hpMax: c.healthMax, hpAfter: +c.health.toFixed(2),
               hpPeak: +peak.toFixed(2),
               picked: motes.stats.picked - s0.picked,
               healed: +(motes.stats.healed - s0.healed).toFixed(2),
               spawned: motes.stats.spawned - s0.spawned,
               activeLeft: motes.stats.active };

    // ---- M2: boss payout at 1 HP -------------------------------------
    motes.clear();
    await waitFrames(2);
    c.health = 1;
    const s1 = { ...motes.stats };
    motes.spawnAt(c.position.x, c.position.z, 8);
    await waitFrames(2);
    for (let k = 0; k < 90; k++) {
        await waitFrames(1);
        if (motes.stats.active === 0) break;
    }
    out.M2 = { hpAfter: +c.health.toFixed(2),
               picked: motes.stats.picked - s1.picked,
               healed: +(motes.stats.healed - s1.healed).toFixed(2),
               activeLeft: motes.stats.active };

    // ---- M3: payout at health 0 (the corpse guard) -------------------
    motes.clear();
    S.progression.dead = false;
    await waitFrames(2);
    c.health = 0;
    const s2 = { ...motes.stats };
    motes.spawnAt(c.position.x, c.position.z, 8);
    await waitFrames(4);
    out.M3 = { hpAfter: +c.health.toFixed(2),
               picked: motes.stats.picked - s2.picked,
               healed: +(motes.stats.healed - s2.healed).toFixed(2),
               active: motes.stats.active,
               progressionDead: S.progression.dead };
    // let the death/respawn cycle run out
    for (let k = 0; k < 200; k++) {
        await waitFrames(1);
        if (!S.progression.dead && c.health > 0) break;
    }
    out.M3.afterRespawnHp = +c.health.toFixed(2);
    out.M3.afterRespawnActive = motes.stats.active;
    out.M3.afterRespawnPicked = motes.stats.picked - s2.picked;

    // ---- M4: downhill drift clearance --------------------------------
    motes.clear();
    c.health = c.healthMax;
    await waitFrames(2);
    // find the steepest downhill bearing within 3.5 m of the player
    const px = c.position.x, pz = c.position.z;
    const h0 = S.terrain.heightAt(px, pz);
    let bestA = 0, bestRise = -1e9;
    for (let a = 0; a < 64; a++) {
        const th = a / 64 * 6.28318;
        const x = px + Math.cos(th) * 3.5, z = pz + Math.sin(th) * 3.5;
        const rise = S.terrain.heightAt(x, z) - h0;
        if (rise > bestRise) { bestRise = rise; bestA = th; }
    }
    const mx = px + Math.cos(bestA) * 3.5, mz = pz + Math.sin(bestA) * 3.5;
    motes.spawnAt(mx, mz, 1);
    await waitFrames(1);
    let idx = -1;
    for (let i = 0; i < motes.alive.length; i++) if (motes.alive[i]) idx = i;
    let minClear = 1e9, samples = [];
    for (let k = 0; k < 120 && idx >= 0 && motes.alive[idx]; k++) {
        await waitFrames(1);
        const cl = motes.y[idx] - S.terrain.heightAt(motes.x[idx], motes.z[idx]);
        if (cl < minClear) minClear = cl;
        if (k % 8 === 0) samples.push(+cl.toFixed(3));
    }
    out.M4 = { riseOverPlayer: +bestRise.toFixed(2),
               minClearance: +minClear.toFixed(3),
               hoverNominal: 0.55, clearanceTrace: samples };

    // ---- M6: pool overflow -------------------------------------------
    motes.clear();
    await waitFrames(2);
    // park the player far from the drops so nothing is picked up
    const fx = px + 40, fz = pz + 40;
    const s6 = { ...motes.stats };
    for (let k = 0; k < 4; k++) motes.spawnAt(fx + k * 2, fz, 8);
    await waitFrames(2);
    out.M6 = { spawned: motes.stats.spawned - s6.spawned,
               active: motes.stats.active, MOTE_MAX: motes.alive.length };

    // ---- M5: realm switch --------------------------------------------
    motes.clear();
    await waitFrames(2);
    motes.spawnAt(fx, fz, 8);
    await waitFrames(2);
    const beforeSwitch = motes.stats.active;
    await S.enterRealm("sand");
    await waitFrames(4);
    out.M5 = { beforeSwitch, afterSwitch: motes.stats.active,
               meshVisible: motes.mesh.visible };
    await S.enterRealm("cold");
    await waitFrames(4);
    return out;
})()"""

HURT = """(async () => {
""" + HELPERS + """
    const out = {};
    await clearField();
    S.input.locked = true;
    c.health = c.healthMax;
    await waitFrames(3);
    const vig = document.querySelector('#hurtfx .hfx-vig');
    const box = document.getElementById('hurtfx');

    // ---- H1a: single 40-damage hit -> peak opacity -------------------
    hurt.onPlayerHit(1, 0, 40);
    await waitFrames(1);
    out.singleHit40 = { op: vig.style.opacity, peak: hurt._flashPeak };
    // ---- H1b: ten rapid hits -> does it stack past 1? ----------------
    for (let k = 0; k < 10; k++) hurt.onPlayerHit(1, 0, 25);
    await waitFrames(1);
    out.tenHits25 = { op: vig.style.opacity, peak: hurt._flashPeak };
    // ---- H1c: does it clear? ----------------------------------------
    await new Promise(r => setTimeout(r, 700));
    await waitFrames(2);
    out.after700ms = { op: vig.style.opacity, flashUntil: hurt._flashUntil };

    // ---- H2: low-hp heartbeat edges ---------------------------------
    c.health = 20;
    await waitFrames(2);
    out.lowAt20 = box.classList.contains('low');
    // a mote heal (+10) should clear it at exactly 30/100
    motes.spawnAt(c.position.x, c.position.z, 1);
    for (let k = 0; k < 90; k++) {
        await waitFrames(1);
        if (motes.stats.active === 0) break;
    }
    await waitFrames(2);
    out.afterMoteHeal = { hp: +c.health.toFixed(2),
                          low: box.classList.contains('low') };

    // ---- H3: death / respawn ----------------------------------------
    c.health = 0;
    await waitFrames(3);
    out.atDeath = { low: box.classList.contains('low'),
                    show: box.classList.contains('show'),
                    op: vig.style.opacity,
                    locked: S.input.locked,
                    dead: S.progression.dead };
    for (let k = 0; k < 250; k++) {
        await waitFrames(1);
        if (!S.progression.dead && c.health > 0) break;
    }
    await waitFrames(3);
    out.afterRespawn = { hp: +c.health.toFixed(2),
                         low: box.classList.contains('low'),
                         op: vig.style.opacity };

    // ---- H4: real enemy damage size (is 40 a normal hit?) ------------
    const rows = [];
    for (const k of ["riteImp", "iceRevenant", "frostWraith"]) {
        const u = S.combat.data && S.combat.data[k];
        if (u) rows.push([k, u.damage]);
    }
    out.sampleEnemyDamage = rows;
    return out;
})()"""

ASSIST = """(async () => {
""" + HELPERS + """
    const sh = S.combat.spellHits;
    const out = {};
    await clearField();
    c.health = c.healthMax;

    // ---- A1: does the assist snap onto a CORPSE? ---------------------
    // Put one body 12 m dead ahead on +X. Aim 2 deg off it. Read the
    // bend BEFORE and AFTER the body is killed (it stays in the registry
    // for DEATH_S = 1.2 s with alive[]=1 and hp<=0).
    const ox = c.position.x, oy = c.position.y + 1.2, oz = c.position.z;
    const tx = ox + 12, tz = oz;
    const id = en.spawn(0, tx, tz, 10);
    await waitFrames(3);
    reg.damage(id, 1, {});
    await waitFrames(4);
    const s = reg.slot(id);
    const aimA = 2 * Math.PI / 180;         // 2 deg off, inside the 3.5 cone
    const dx = Math.cos(aimA), dz = Math.sin(aimA);
    const bend = (r) => {
        const cos = r[0] * dx + r[2] * dz;
        return +(Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI)
            .toFixed(3);
    };
    let r = sh.aimAssist(ox, oy, oz, dx, 0, dz, 21);
    out.aliveBend = { deg: bend(r), hp: +reg.hp[s].toFixed(1),
                      alive: reg.alive[s] };
    // kill it, then re-ask on the very next frames
    reg.damage(id, 99999, {});
    await waitFrames(2);
    const s2 = reg.slot(id);
    r = sh.aimAssist(ox, oy, oz, dx, 0, dz, 21);
    out.corpseBend = { deg: bend(r), slot: s2,
                       hp: s2 >= 0 ? +reg.hp[s2].toFixed(1) : null,
                       alive: s2 >= 0 ? reg.alive[s2] : null,
                       inRegistry: s2 >= 0, regCount: reg.count };
    // how long does the corpse stay bendable?
    let held = 0;
    for (let k = 0; k < 200; k++) {
        await waitFrames(1);
        if (reg.slot(id) < 0) break;
        held = +reg.time.toFixed(3);
    }
    out.corpseHeldUntilRegTime = held;
    r = sh.aimAssist(ox, oy, oz, dx, 0, dz, 21);
    out.afterRemovalBend = bend(r);

    // ---- A1b: a corpse in FRONT of a live enemy steals the bend ------
    await clearField();
    const idDead = en.spawn(0, ox + 10, oz + 0.30, 10);   // ~1.7 deg off
    const idLive = en.spawn(0, ox + 16, oz - 0.30, 10);   // ~1.1 deg off
    await waitFrames(3);
    reg.damage(idDead, 1, {}); reg.damage(idLive, 1, {});
    await waitFrames(3);
    reg.damage(idDead, 99999, {});
    await waitFrames(2);
    r = sh.aimAssist(ox, oy, oz, 1, 0, 0, 21);
    // which body does the bend point at?
    const sd = reg.slot(idDead), sl = reg.slot(idLive);
    const ang = (sx, sz) => {
        const ux = sx - ox, uz = sz - oz;
        const l = Math.hypot(ux, uz);
        const cos = (r[0] * ux + r[2] * uz) / l;
        return +(Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI)
            .toFixed(3);
    };
    out.A1b = {
        deadSlot: sd, liveSlot: sl,
        degToDeadBody: sd >= 0 ? ang(reg.x[sd], reg.z[sd]) : null,
        degToLiveBody: sl >= 0 ? ang(reg.x[sl], reg.z[sl]) : null,
        deadHp: sd >= 0 ? +reg.hp[sd].toFixed(1) : null,
        liveHp: sl >= 0 ? +reg.hp[sl].toFixed(1) : null,
        rawBendDeg: bend(r),
    };

    // ---- A2: the FROST ARC fan must never be bent -------------------
    // dart.fire() consults the assist only for own === 0.
    await clearField();
    const idT = en.spawn(0, ox + 12, oz + 0.5, 10);
    await waitFrames(3);
    reg.damage(idT, 1, {});
    await waitFrames(2);
    const bolt = S.spells.bolt;
    const before = sh.assistStats ? { ...sh.assistStats } : null;
    const slotA = bolt.fire(ox, oy, oz, 1, 0, 0, 21, 40, 1, 1);   // own = 1
    const midA = sh.assistStats ? { ...sh.assistStats } : null;
    const slotB = bolt.fire(ox, oy, oz, 1, 0, 0, 21, 40, 0, 1);   // own = 0
    const afterA = sh.assistStats ? { ...sh.assistStats } : null;
    out.A2 = { own1_shots: midA.shots - before.shots,
               own0_shots: afterA.shots - midA.shots,
               own1_dir: [+bolt.vx[slotA].toFixed(3), +bolt.vy[slotA].toFixed(3),
                          +bolt.vz[slotA].toFixed(3)],
               own0_dir: [+bolt.vx[slotB].toFixed(3), +bolt.vy[slotB].toFixed(3),
                          +bolt.vz[slotB].toFixed(3)] };

    // ---- E1: boss HP frame during the 1.2 s death fade ---------------
    await clearField();
    const bars = S.enemyBars;
    S.input.locked = true;
    let bossId = -1;
    for (let k = 0; k < en.units.length; k++) {
        if (en.units[k].tier === 4 || (en.units[k].tier|0) >= 4) { bossId = k; break; }
    }
    out.E1 = { bossUnitIndex: bossId };
    if (bossId >= 0) {
        const bid = en.spawn(bossId, ox + 14, oz + 2, 10);
        await waitFrames(4);
        reg.damage(bid, 1, {});
        await waitFrames(3);
        out.E1.bossOnAlive = bars._bOn;
        reg.damage(bid, 999999, {});
        await waitFrames(4);
        out.E1.duringDeathFade = { bossOn: bars._bOn, hpFrac: bars._bHp,
                                   regSlot: reg.slot(bid),
                                   regHp: reg.slot(bid) >= 0
                                       ? +reg.hp[reg.slot(bid)].toFixed(1) : null };
        for (let k = 0; k < 200; k++) {
            await waitFrames(1);
            if (reg.slot(bid) < 0) break;
        }
        await waitFrames(3);
        out.E1.afterRemoval = { bossOn: bars._bOn };
    }
    await clearField();
    return out;
})()"""


def main():
    from playwright.sync_api import sync_playwright
    import time as _t

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        _t.sleep(2.5)
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=120000)
            pg.wait_for_timeout(2500)

            for label, js in (("MOTES", MOTES), ("HURT", HURT),
                              ("ASSIST", ASSIST)):
                print("\n=========== %s ===========" % label)
                try:
                    print(json.dumps(pg.evaluate(js), indent=1))
                except Exception as ex:  # noqa: BLE001
                    print("  EVAL FAILED:", ex)
            if errs:
                print("\n!! page errors:", errs[:6])
            br.close()
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
