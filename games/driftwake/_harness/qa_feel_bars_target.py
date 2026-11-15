# -*- coding: utf-8 -*-
"""
qa_feel_bars_target.py -- round 3.

  B1  enemybars TAB-caret bookkeeping: retarget from a HIGH pool slot to a
      LOW one and count how many bars wear `.tgt`.
  B2  the same stale caret surviving a slot RELEASE and re-claim by an
      unrelated body.
  A4  aim assist priority: a CORPSE more centred on the raw ray than a LIVE
      enemy -- which does the assist choose?
  F1  chip-lock: 20 rapid bolt-sized hits (6 dmg, under FLINCH_MIN_DMG) on
      one melee enemy -- does it keep attacking?
  X2  allocation attribution: heap growth per frame with the feel layer ON
      vs the feel layer suppressed.
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
         "--enable-gpu-rasterization", "--js-flags=--expose-gc",
         "--disable-features=CalculateNativeWinOcclusion"]

HELP = """
    const S = SNOWFLOW, reg = S.combat.registry, en = S.combat.enemies;
    const c = S.character, motes = S.motes, hurt = S.hurtFx, sh = S.combat.spellHits;
    const bars = S.enemyBars;
    const waitFrames = (n) => new Promise(res => {
        let k = 0;
        const f = () => (++k >= n) ? res() : requestAnimationFrame(f);
        requestAnimationFrame(f);
    });
    const clearField = async () => {
        for (let i = reg.count - 1; i >= 0; i--) en.despawn(reg.idOf[i]);
        motes.clear();
        await waitFrames(2);
    };
    const tgtBars = () => {
        const on = [];
        for (let i = 0; i < bars._bar.length; i++)
            if (bars._bar[i].classList.contains('tgt')) on.push(i);
        return on;
    };
    const slotOfId = (id) => {
        for (let i = 0; i < bars._id.length; i++) if (bars._id[i] === id) return i;
        return -1;
    };
    const DEG = 180 / Math.PI;
    const aimPt = (s, ox, oy, oz) => {
        const rx = reg.x[s] - ox;
        const ry = reg.y[s] + reg.height[s] * 0.55 - oy;
        const rz = reg.z[s] - oz;
        const l = Math.hypot(rx, ry, rz);
        return [rx / l, ry / l, rz / l];
    };
    const yawBy = (d, deg) => {
        const a = deg / DEG, ca = Math.cos(a), sa = Math.sin(a);
        return [d[0] * ca + d[2] * sa, d[1], -d[0] * sa + d[2] * ca];
    };
    const angBetween = (a, b) => {
        const cs = a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
        return +(Math.acos(Math.max(-1, Math.min(1, cs))) * DEG).toFixed(3);
    };
"""

BARS = """(async () => {
""" + HELP + """
    const out = {};
    await clearField();
    S.input.locked = true;
    c.health = c.healthMax;
    // a fake TAB selection driver -- main.js hands `bars.targeting` the real
    // targeting module; the contract read is `targeting.targetId`.
    const realTargeting = bars.targeting;
    const fake = { targetId: -1 };
    bars.targeting = fake;
    await waitFrames(3);

    // two bodies, claimed in order so A owns a LOWER pool slot than B
    const idA = en.spawn(0, c.position.x + 8, c.position.z + 1, 10);
    await waitFrames(2);
    reg.damage(idA, 1, {});
    await waitFrames(3);
    const idB = en.spawn(0, c.position.x + 8, c.position.z - 1, 10);
    await waitFrames(2);
    reg.damage(idB, 1, {});
    await waitFrames(3);
    out.slots = { A: slotOfId(idA), B: slotOfId(idB) };

    // select B (the HIGHER slot) ...
    fake.targetId = idB;
    await waitFrames(3);
    out.afterSelectB = { tgtBars: tgtBars(), _tgtSlot: bars._tgtSlot };
    // ... then retarget to A (the LOWER slot)
    fake.targetId = idA;
    await waitFrames(3);
    out.afterRetargetToA = { tgtBars: tgtBars(), _tgtSlot: bars._tgtSlot,
                             expected: [out.slots.A] };

    // B2: kill B, let its slot release, then claim it with a new body C
    reg.damage(idB, 999999, {});
    for (let k = 0; k < 300; k++) {
        await waitFrames(1);
        if (reg.slot(idB) < 0) break;
    }
    await waitFrames(4);
    out.afterBDies = { tgtBars: tgtBars(), barIdB: slotOfId(idB) };
    const idC = en.spawn(0, c.position.x + 9, c.position.z + 3, 10);
    await waitFrames(2);
    reg.damage(idC, 1, {});
    await waitFrames(4);
    out.afterCClaims = { tgtBars: tgtBars(), slotC: slotOfId(idC),
                         targetIs: idA === fake.targetId ? "A" : "?",
                         slotA: slotOfId(idA) };
    bars.targeting = realTargeting;
    await clearField();
    return out;
})()"""

ASSIST4 = """(async () => {
""" + HELP + """
    const out = {};
    await clearField();
    c.health = c.healthMax;
    const ox = c.position.x, oy = c.position.y + 1.2, oz = c.position.z;

    // A corpse-to-be at 9 m and a live body at 15 m, both nearly on the ray.
    const idDead = en.spawn(0, ox + 9, oz, 10);
    const idLive = en.spawn(0, ox + 15, oz + 0.6, 10);
    await waitFrames(3);
    reg.damage(idDead, 1, {}); reg.damage(idLive, 1, {});
    await waitFrames(3);
    let sd = reg.slot(idDead), sl = reg.slot(idLive);
    const dDead = aimPt(sd, ox, oy, oz);
    const dLive = aimPt(sl, ox, oy, oz);
    // Raw ray: 1 deg off the corpse-to-be, so the CORPSE is the more centred
    // of the two candidates.
    const raw = yawBy(dDead, 1);
    out.setup = { degRawToDead: angBetween(raw, dDead),
                  degRawToLive: angBetween(raw, dLive) };
    reg.damage(idDead, 999999, {});
    await waitFrames(2);
    sd = reg.slot(idDead); sl = reg.slot(idLive);
    const dDead2 = sd >= 0 ? aimPt(sd, ox, oy, oz) : null;
    const dLive2 = sl >= 0 ? aimPt(sl, ox, oy, oz) : null;
    const st0 = { ...sh.assistStats };
    const r = Array.from(sh.aimAssist(ox, oy, oz, raw[0], raw[1], raw[2], 21));
    const st1 = { ...sh.assistStats };
    out.A4 = { deadHp: sd >= 0 ? +reg.hp[sd].toFixed(1) : null,
               deadAlive: sd >= 0 ? reg.alive[sd] : null,
               liveHp: sl >= 0 ? +reg.hp[sl].toFixed(1) : null,
               snapped: st1.snapped - st0.snapped,
               bendDeg: angBetween(r, raw),
               degToCorpse: dDead2 ? angBetween(r, dDead2) : null,
               degToLive: dLive2 ? angBetween(r, dLive2) : null,
               verdict: null };
    if (dDead2 && dLive2) {
        out.A4.verdict = out.A4.degToCorpse < out.A4.degToLive
            ? "assist chose the CORPSE" : "assist chose the LIVE body";
    }
    await clearField();
    return out;
})()"""

CHIP = """(async () => {
""" + HELP + """
    const out = {};
    await clearField();
    S.input.locked = true;
    c.health = c.healthMax;
    // one melee body right on top of the player so it commits to attacks
    const id = en.spawn(0, c.position.x + 2.2, c.position.z, 10);
    await waitFrames(3);
    reg.damage(id, 1, {});
    await waitFrames(4);
    let idx = -1;
    for (let i = 0; i < en.alive.length; i++) if (en.alive[i] && en.id[i] === id) idx = i;
    if (idx < 0) return { err: "no body" };
    const unit = en.units[en.unitOf[idx]];

    // ---- control: 4 s untouched ------------------------------------
    const hp0 = c.health;
    const t0 = reg.time;
    let states = {}, windups = 0, strikes = 0, lastState = -1;
    while (reg.time - t0 < 4) {
        await waitFrames(1);
        const st = en.state[idx];
        states[st] = (states[st] || 0) + 1;
        if (st === 3 && lastState !== 3) windups++;
        if (st === 4 && lastState !== 4) strikes++;
        lastState = st;
    }
    out.control = { unit: unit.name, windups, strikes,
                    playerHpLost: +(hp0 - c.health).toFixed(2),
                    stateHistogram: states, flinchT: +en.flinchT[idx].toFixed(3) };

    // ---- chip storm: a 6-damage hit EVERY frame for 4 s -------------
    reg.hp[reg.slot(id)] = reg.hpMax[reg.slot(id)] * 50;   // survive the storm
    c.health = c.healthMax;
    const hp1 = c.health;
    const t1 = reg.time;
    states = {}; windups = 0; strikes = 0; lastState = -1;
    let hits = 0;
    while (reg.time - t1 < 4) {
        if (reg.slot(id) >= 0) { reg.damage(id, 6, {}); hits++; }
        await waitFrames(1);
        const st = en.state[idx];
        states[st] = (states[st] || 0) + 1;
        if (st === 3 && lastState !== 3) windups++;
        if (st === 4 && lastState !== 4) strikes++;
        lastState = st;
    }
    out.chipStorm = { hits, windups, strikes,
                      playerHpLost: +(hp1 - c.health).toFixed(2),
                      stateHistogram: states,
                      flinchT: +en.flinchT[idx].toFixed(3),
                      hitT: +en.hitT[idx].toFixed(3) };

    // ---- heavy storm: a 25-damage hit EVERY frame for 4 s ----------
    reg.hp[reg.slot(id)] = reg.hpMax[reg.slot(id)] * 500;
    c.health = c.healthMax;
    const hp2 = c.health;
    const t2 = reg.time;
    states = {}; windups = 0; strikes = 0; lastState = -1;
    hits = 0;
    while (reg.time - t2 < 4) {
        if (reg.slot(id) >= 0) { reg.damage(id, 25, {}); hits++; }
        await waitFrames(1);
        const st = en.state[idx];
        states[st] = (states[st] || 0) + 1;
        if (st === 3 && lastState !== 3) windups++;
        if (st === 4 && lastState !== 4) strikes++;
        lastState = st;
    }
    out.heavyStorm = { hits, windups, strikes,
                       playerHpLost: +(hp2 - c.health).toFixed(2),
                       stateHistogram: states,
                       flinchT: +en.flinchT[idx].toFixed(3) };

    // ---- the flinch overlay ON a scrubbed windup pose --------------
    // Catch the body mid-telegraph and read the mixer's weight row.
    const vis = en.vis;
    let sample = null;
    reg.hp[reg.slot(id)] = reg.hpMax[reg.slot(id)] * 500;
    for (let k = 0; k < 400; k++) {
        await waitFrames(1);
        if (en.state[idx] === 3 && en.flash[idx] > 0.10) {
            const inst = vis && vis._slotInst ? vis._slotInst[idx] : null;
            const pre = inst && inst.weights ? Array.from(inst.weights) : null;
            reg.damage(id, 25, {});          // arms flinchT, no poise break
            await waitFrames(1);
            const inst2 = vis && vis._slotInst ? vis._slotInst[idx] : null;
            sample = {
                flashAtHit: +en.flash[idx].toFixed(3),
                state: en.state[idx],
                flinchT: +en.flinchT[idx].toFixed(3),
                weightsBefore: pre ? pre.map(v => +v.toFixed(3)) : null,
                weightsAfter: inst2 && inst2.weights
                    ? Array.from(inst2.weights).map(v => +v.toFixed(3)) : null,
                atkAction: inst2 ? inst2.atk : null,
                CL_HIT_index: 3,
            };
            break;
        }
    }
    out.flinchOnTelegraph = sample;
    await clearField();
    return out;
})()"""

ALLOC = """(async () => {
""" + HELP + """
    const out = {};
    const run = async (label, frames) => {
        await waitFrames(6);
        if (window.gc) window.gc();
        await waitFrames(2);
        const heaps = [];
        for (let k = 0; k < frames; k++) {
            await waitFrames(1);
            heaps.push(performance.memory.usedJSHeapSize);
        }
        let growth = 0, drops = 0;
        for (let k = 1; k < heaps.length; k++) {
            const d = heaps[k] - heaps[k - 1];
            if (d < -200000) drops++; else growth += d;
        }
        out[label] = { kbPerFrame: +(growth / 1024 / heaps.length).toFixed(1),
                       gcDrops: drops,
                       drawCalls: S.perfStats ? S.perfStats.drawCalls : null,
                       fps: S.perfStats ? +(S.perfStats.fps || 0).toFixed(1) : null };
    };
    await clearField();
    S.input.locked = true;
    c.health = c.healthMax;

    // 8 enemies + motes + a live vignette = the feel layer working hard
    const ids = [];
    for (let k = 0; k < 8; k++) {
        const a = k / 8 * 6.28318;
        const id = en.spawn(0, c.position.x + Math.cos(a) * 6,
                            c.position.z + Math.sin(a) * 6, 10);
        if (id >= 0) ids.push(id);
    }
    await waitFrames(3);
    for (const id of ids) reg.damage(id, 1, {});
    await waitFrames(4);
    motes.spawnAt(c.position.x + 25, c.position.z + 25, 8);
    await run("feelLayerON", 45);

    // now suppress MY layer only: bars + hurtFx skip their world work when
    // `input.locked` is false; motes stop on `enabled`.
    motes.enabled = false; motes.clear();
    S.input.locked = false;
    await run("feelLayerOFF", 45);
    S.input.locked = true; motes.enabled = true;
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
            for label, js in (("BARS", BARS), ("ASSIST4", ASSIST4),
                              ("CHIP", CHIP), ("ALLOC", ALLOC)):
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
