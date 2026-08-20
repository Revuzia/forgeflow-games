# -*- coding: utf-8 -*-
"""
qa_feel_stress2.py -- round 2. Fixes the mis-parameterised probes of
qa_feel_motes_assist.py (aim ray was not pointed at the body's aim POINT,
healthMax is 54 not 100, TIER.BOSS is 5 not 4) and adds:

  A*  aim assist: eligibility on a properly aimed ray; corpse snap; the
      corpse-in-front-of-a-live-body case; terrain occlusion.
  P1  vignette / heartbeat vs PAUSE (S.freezeTime) and vs hit-stop:
      both run on performance.now(), the world runs on game time.
  M4b mote drift clearance over a slope, inside the real 4 m radius.
  E1b boss HP frame with a real TIER.BOSS body, through its death fade.
  X1  per-frame allocation + draw calls, quiet vs full-FX scene.
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
    const DEG = 180 / Math.PI;
    // unit direction from the muzzle to a registry slot's ASSIST aim point
    const aimPt = (s, ox, oy, oz) => {
        const rx = reg.x[s] - ox;
        const ry = reg.y[s] + reg.height[s] * 0.55 - oy;
        const rz = reg.z[s] - oz;
        const l = Math.hypot(rx, ry, rz);
        return [rx / l, ry / l, rz / l];
    };
    // rotate a unit dir by `deg` about world +Y
    const yawBy = (d, deg) => {
        const a = deg / DEG, ca = Math.cos(a), sa = Math.sin(a);
        return [d[0] * ca + d[2] * sa, d[1], -d[0] * sa + d[2] * ca];
    };
    const angBetween = (a, b) => {
        const cs = a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
        return +(Math.acos(Math.max(-1, Math.min(1, cs))) * DEG).toFixed(3);
    };
"""

ASSIST = """(async () => {
""" + HELP + """
    const out = {};
    await clearField();
    c.health = c.healthMax;

    const ox = c.position.x, oy = c.position.y + 1.2, oz = c.position.z;

    // ---------- A0: eligibility on a correctly aimed ray ---------------
    const id = en.spawn(0, ox + 12, oz, 10);
    await waitFrames(3);
    reg.damage(id, 1, {});
    await waitFrames(4);
    let s = reg.slot(id);
    const straight = aimPt(s, ox, oy, oz);
    const off2 = yawBy(straight, 2);          // 2 deg off, inside the 3.5 cone
    const off6 = yawBy(straight, 6);          // 6 deg off, outside it

    const st0 = { ...sh.assistStats };
    let r = Array.from(sh.aimAssist(ox, oy, oz, off2[0], off2[1], off2[2], 21));
    const st1 = { ...sh.assistStats };
    out.A0_aimed2deg = { bendDeg: angBetween(r, off2),
                         degToBody: angBetween(r, straight),
                         snapped: st1.snapped - st0.snapped,
                         hp: +reg.hp[s].toFixed(1) };
    r = Array.from(sh.aimAssist(ox, oy, oz, off6[0], off6[1], off6[2], 21));
    const st2 = { ...sh.assistStats };
    out.A0_aimed6deg = { bendDeg: angBetween(r, off6),
                         snapped: st2.snapped - st1.snapped };

    // ---------- A1: the same body, now a CORPSE ------------------------
    reg.damage(id, 999999, {});
    await waitFrames(2);
    s = reg.slot(id);
    const st3 = { ...sh.assistStats };
    r = Array.from(sh.aimAssist(ox, oy, oz, off2[0], off2[1], off2[2], 21));
    const st4 = { ...sh.assistStats };
    out.A1_corpse = { inRegistry: s >= 0,
                      hp: s >= 0 ? +reg.hp[s].toFixed(1) : null,
                      aliveFlag: s >= 0 ? reg.alive[s] : null,
                      bendDeg: angBetween(r, off2),
                      degToCorpse: angBetween(r, straight),
                      snapped: st4.snapped - st3.snapped };
    // how long does the corpse remain assist-eligible?
    const tKill = reg.time;
    let heldFor = 0;
    for (let k = 0; k < 300; k++) {
        await waitFrames(1);
        if (reg.slot(id) < 0) break;
        heldFor = +(reg.time - tKill).toFixed(3);
    }
    out.A1_corpseEligibleSeconds = heldFor;

    // ---------- A2: corpse in FRONT of a live enemy --------------------
    await clearField();
    const idDead = en.spawn(0, ox + 9, oz, 10);
    await waitFrames(2);
    const idLive = en.spawn(0, ox + 15, oz, 10);
    await waitFrames(3);
    reg.damage(idDead, 1, {}); reg.damage(idLive, 1, {});
    await waitFrames(3);
    // aim exactly between: nudge the dead one sideways so the LIVE one is
    // the more centred of the two on the raw ray.
    let sd = reg.slot(idDead), sl = reg.slot(idLive);
    const dirDead0 = aimPt(sd, ox, oy, oz);
    const dirLive0 = aimPt(sl, ox, oy, oz);
    // raw ray = 1 deg off the LIVE body, on the far side from the corpse
    const raw = yawBy(dirLive0, 1);
    out.A2_setup = { degRawToDead: angBetween(raw, dirDead0),
                     degRawToLive: angBetween(raw, dirLive0) };
    reg.damage(idDead, 999999, {});
    await waitFrames(2);
    sd = reg.slot(idDead); sl = reg.slot(idLive);
    const dirDead = sd >= 0 ? aimPt(sd, ox, oy, oz) : null;
    const dirLive = sl >= 0 ? aimPt(sl, ox, oy, oz) : null;
    r = Array.from(sh.aimAssist(ox, oy, oz, raw[0], raw[1], raw[2], 21));
    out.A2_corpseSteal = {
        deadHp: sd >= 0 ? +reg.hp[sd].toFixed(1) : null,
        liveHp: sl >= 0 ? +reg.hp[sl].toFixed(1) : null,
        bendDeg: angBetween(r, raw),
        degToDeadBody: dirDead ? angBetween(r, dirDead) : null,
        degToLiveBody: dirLive ? angBetween(r, dirLive) : null,
    };

    // ---------- A3: assist through terrain -----------------------------
    // Find a bearing where the terrain between the muzzle and 14 m rises
    // above the sight line, and stand a live body at the far end.
    await clearField();
    let occA = null, occRise = -1e9;
    for (let a = 0; a < 96; a++) {
        const th = a / 96 * 6.28318;
        const tx = ox + Math.cos(th) * 14, tz = oz + Math.sin(th) * 14;
        const ty = S.terrain.heightAt(tx, tz);
        let worst = -1e9;
        for (let t = 0.2; t < 0.95; t += 0.1) {
            const sx = ox + (tx - ox) * t, sz = oz + (tz - oz) * t;
            const line = oy + (ty + 1.0 - oy) * t;
            const rise = S.terrain.heightAt(sx, sz) - line;
            if (rise > worst) worst = rise;
        }
        if (worst > occRise) { occRise = worst; occA = th; }
    }
    const bx = ox + Math.cos(occA) * 14, bz = oz + Math.sin(occA) * 14;
    const idOcc = en.spawn(0, bx, bz, 10);
    await waitFrames(3);
    reg.damage(idOcc, 1, {});
    await waitFrames(3);
    const so = reg.slot(idOcc);
    const dOcc = aimPt(so, ox, oy, oz);
    const rawOcc = yawBy(dOcc, 2.5);
    r = Array.from(sh.aimAssist(ox, oy, oz, rawOcc[0], rawOcc[1], rawOcc[2], 21));
    out.A3_terrain = { ridgeAboveSightLine_m: +occRise.toFixed(2),
                       bendDeg: angBetween(r, rawOcc) };
    await clearField();
    return out;
})()"""

PAUSEFX = """(async () => {
""" + HELP + """
    const out = {};
    await clearField();
    S.input.locked = true;
    c.health = c.healthMax;
    await waitFrames(3);
    const vig = document.querySelector('#hurtfx .hfx-vig');
    const box = document.getElementById('hurtfx');

    // ---------- P1: vignette across a PAUSE ---------------------------
    hurt.onPlayerHit(1, 0, 40);
    await waitFrames(1);
    const opAtHit = vig.style.opacity;
    SNOWFLOW.S.freezeTime = true;
    const tP = performance.now();
    await new Promise(r => setTimeout(r, 1500));
    await waitFrames(2);
    const opAfterPause = vig.style.opacity;
    SNOWFLOW.S.freezeTime = false;
    await waitFrames(2);
    out.P1_vignetteAcrossPause = {
        opAtHit, opAfterPause, pausedMs: Math.round(performance.now() - tP),
        flashWindowMs: 250,
        note: "decay clock is performance.now(); the world clock is dt" };

    // ---------- P2: heartbeat threshold on the REAL healthMax ---------
    const hm = c.healthMax;
    c.health = hm * 0.25;
    await waitFrames(3);
    out.P2_lowAt25pct = { healthMax: hm, hp: +c.health.toFixed(2),
                          low: box.classList.contains('low') };
    // a mote heal (+10% max) should cross back over 30%
    motes.spawnAt(c.position.x, c.position.z, 1);
    for (let k = 0; k < 120; k++) {
        await waitFrames(1);
        if (motes.stats.active === 0) break;
    }
    await waitFrames(2);
    out.P2_afterMoteHeal = { hp: +c.health.toFixed(2),
                             frac: +(c.health / hm).toFixed(3),
                             low: box.classList.contains('low') };

    // ---------- P3: the heartbeat animation while PAUSED --------------
    c.health = hm * 0.2;
    await waitFrames(3);
    SNOWFLOW.S.freezeTime = true;
    await waitFrames(2);
    const heart = document.querySelector('#hurtfx .hfx-heart');
    const anims = heart.getAnimations ? heart.getAnimations() : [];
    const t0 = anims.length ? anims[0].currentTime : null;
    await new Promise(r => setTimeout(r, 900));
    const t1 = anims.length ? anims[0].currentTime : null;
    out.P3_heartbeatWhilePaused = {
        lowClass: box.classList.contains('low'),
        showClass: box.classList.contains('show'),
        animCount: anims.length,
        animAdvancedMs: (t0 !== null && t1 !== null)
            ? Math.round(t1 - t0) : null };
    SNOWFLOW.S.freezeTime = false;
    c.health = hm;
    await waitFrames(3);

    // ---------- M4b: mote drift clearance on a slope ------------------
    motes.clear();
    await waitFrames(2);
    const px = c.position.x, pz = c.position.z;
    const h0 = S.terrain.heightAt(px, pz);
    let bestA = 0, bestRise = -1e9;
    for (let a = 0; a < 96; a++) {
        const th = a / 96 * 6.28318;
        for (const rr of [1.8, 2.2, 2.6]) {
            const x = px + Math.cos(th) * rr, z = pz + Math.sin(th) * rr;
            const rise = S.terrain.heightAt(x, z) - h0;
            if (rise > bestRise) { bestRise = rise; bestA = th; }
        }
    }
    const mx = px + Math.cos(bestA) * 2.2, mz = pz + Math.sin(bestA) * 2.2;
    motes.spawnAt(mx, mz, 1);
    await waitFrames(1);
    let idx = -1;
    for (let i = 0; i < motes.alive.length; i++) if (motes.alive[i]) idx = i;
    let minClear = 1e9;
    const trace = [];
    for (let k = 0; k < 200 && idx >= 0 && motes.alive[idx]; k++) {
        await waitFrames(1);
        const cl = motes.y[idx] -
            S.terrain.heightAt(motes.x[idx], motes.z[idx]);
        if (cl < minClear) minClear = cl;
        trace.push(+cl.toFixed(3));
    }
    out.M4b_slopeDrift = { terrainRiseAtDrop_m: +bestRise.toFixed(2),
                           minClearance_m: +minClear.toFixed(3),
                           hoverNominal_m: 0.55,
                           frames: trace.length,
                           trace: trace.slice(0, 30) };

    // ---------- E1b: boss HP frame through the death fade -------------
    await clearField();
    let bossIdx = -1;
    for (let k = 0; k < en.units.length; k++) {
        if (en.units[k].tier === 5) { bossIdx = k; break; }
    }
    const bars = S.enemyBars;
    out.E1b = { bossUnitIndex: bossIdx,
                bossName: bossIdx >= 0 ? en.units[bossIdx].name : null };
    if (bossIdx >= 0) {
        const bid = en.spawn(bossIdx, c.position.x + 14, c.position.z, 10);
        await waitFrames(4);
        reg.damage(bid, 1, {});
        await waitFrames(4);
        out.E1b.alive = { bossOn: bars._bOn, hpFrac: +bars._bHp.toFixed(3),
                          kind: reg.kind[reg.slot(bid)] };
        reg.damage(bid, 9999999, {});
        await waitFrames(4);
        const sB = reg.slot(bid);
        out.E1b.duringDeathFade = { bossOn: bars._bOn,
                                    hpFrac: +bars._bHp.toFixed(3),
                                    stillInRegistry: sB >= 0,
                                    regHp: sB >= 0 ? +reg.hp[sB].toFixed(1) : null };
        for (let k = 0; k < 300; k++) {
            await waitFrames(1);
            if (reg.slot(bid) < 0) break;
        }
        await waitFrames(4);
        out.E1b.afterRemoval = { bossOn: bars._bOn };
    }
    await clearField();
    return out;
})()"""

PERF = """(async () => {
""" + HELP + """
    const out = {};
    const info = S.renderer ? S.renderer.info : null;
    const sample = async (label, frames) => {
        // settle
        await waitFrames(6);
        if (window.gc) window.gc();
        await waitFrames(2);
        const heap0 = performance.memory ? performance.memory.usedJSHeapSize : 0;
        const ts = [], calls = [], heaps = [];
        let prev = performance.now();
        for (let k = 0; k < frames; k++) {
            await waitFrames(1);
            const n = performance.now();
            ts.push(n - prev); prev = n;
            if (S.renderer) calls.push(S.renderer.info.render.calls);
            if (performance.memory) heaps.push(performance.memory.usedJSHeapSize);
        }
        const heap1 = performance.memory ? performance.memory.usedJSHeapSize : 0;
        ts.sort((a, b) => a - b);
        // GC saw-tooth: count frames where the heap DROPPED
        let drops = 0, growth = 0;
        for (let k = 1; k < heaps.length; k++) {
            const d = heaps[k] - heaps[k - 1];
            if (d < -200000) drops++; else growth += d;
        }
        out[label] = {
            frames,
            frameMs_mean: +(ts.reduce((a, b) => a + b, 0) / ts.length).toFixed(1),
            frameMs_p50: +ts[Math.floor(ts.length / 2)].toFixed(1),
            frameMs_max: +ts[ts.length - 1].toFixed(1),
            drawCalls: calls.length ? calls[calls.length - 1] : null,
            heapKB_start: Math.round(heap0 / 1024),
            heapKB_end: Math.round(heap1 / 1024),
            heapGrowthKB_perFrame: heaps.length
                ? +(growth / 1024 / heaps.length).toFixed(2) : null,
            gcDrops: drops,
            motesActive: motes.stats.active,
            hitstopActive: S.hitstop.stats.active,
        };
    };

    await clearField();
    c.health = c.healthMax;
    S.input.locked = true;
    await sample("quiet", 40);

    // full scene: 8 enemies + a boss + motes + hurt vignette + hit-stop
    let bossIdx = -1;
    for (let k = 0; k < en.units.length; k++) {
        if (en.units[k].tier === 5) { bossIdx = k; break; }
    }
    const ids = [];
    for (let k = 0; k < 8; k++) {
        const a = k / 8 * 6.28318;
        const id = en.spawn(0, c.position.x + Math.cos(a) * 7,
                            c.position.z + Math.sin(a) * 7, 10);
        if (id >= 0) ids.push(id);
    }
    if (bossIdx >= 0) {
        const b = en.spawn(bossIdx, c.position.x + 10, c.position.z, 10);
        if (b >= 0) ids.push(b);
    }
    await waitFrames(3);
    for (const id of ids) reg.damage(id, 1, {});
    await waitFrames(4);
    motes.spawnAt(c.position.x + 3, c.position.z + 3, 8);
    hurt.onPlayerHit(1, 0, 40);
    await sample("full", 40);
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
            for label, js in (("ASSIST", ASSIST), ("PAUSEFX", PAUSEFX),
                              ("PERF", PERF)):
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
