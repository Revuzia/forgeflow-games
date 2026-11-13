# -*- coding: utf-8 -*-
"""
qa_leashverify_8901.py -- ADVERSARIAL verification of the boss-leash claim.

  V1  mechanism, chase-driven (NO arena mutation): invest stance/chill/brittle,
      kite the PLAYER away so the BOSS walks itself past LEASH_M, then read the
      new slot. Does register() really hand back a virgin combat slot?
  V2  honest rate: park the player outside the leash ring and let the boss
      cycle on its own for 60 s of GAME time. How many leashes, how much HP,
      how many seconds between them?
  V3  artifact check: replicate the lane's stage-E "B.ax += 200" arena yank and
      compare its cadence with V2's. Is `ax` writable in play at all?
  V4  decay control: after a leash, how long do stance/chill/brittle survive on
      their OWN (no leash) with the player disengaged? Is the "wipe" additive
      to a mechanic the game already has?

All waits are GAME time (registry.time via rAF). No wall-clock sleeps.
"""
import json
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8901
URL = "http://localhost:%d/games/driftwake/index.html?autoplay&test" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

SETUP = r"""(() => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry;
    window.__q = { leash: [] };
    const ol = B._leashHome.bind(B);
    B._leashHome = function (hp, hpMax) {
        const sBefore = R.slot(B.bossId);
        const pre = sBefore >= 0 ? window.__slot(sBefore) : null;
        const t = R.time;
        const r = ol(hp, hpMax);
        const sAfter = R.slot(B.bossId);
        window.__q.leash.push({ t: +t.toFixed(2), pre,
            post: sAfter >= 0 ? window.__slot(sAfter) : null,
            oldId: pre ? pre.id : -1, newId: sAfter >= 0 ? R.idOf[sAfter] : -1 });
        return r;
    };
    window.__slot = (s) => {
        const R = SNOWFLOW.combat.registry;
        const dr = [];
        for (let c = 0; c < 4; c++) dr.push(R._drCount[s * 4 + c]);
        return { id: R.idOf[s],
            hp: +R.hp[s].toFixed(1), hpMax: +R.hpMax[s].toFixed(1),
            hpFrac: +(R.hp[s] / R.hpMax[s]).toFixed(4),
            poise: +R.poise[s].toFixed(1), poiseMax: +R.poiseMax[s].toFixed(1),
            chill: R.chill[s],
            brittleLeft: +Math.max(0, R.brittleUntil[s] - R.time).toFixed(2),
            breakLeft: +Math.max(0, R.breakUntil[s] - R.time).toFixed(2),
            dr, tier: R.tier[s], level: R.level[s],
            x: +R.x[s].toFixed(1), z: +R.z[s].toFixed(1) };
    };
    window.__frames = (n) => new Promise((res) => {
        let k = n; const t = () => (--k <= 0) ? res() : requestAnimationFrame(t); t();
    });
    window.__gwait = (sec) => new Promise((res) => {
        const R = SNOWFLOW.combat.registry, t0 = R.time;
        const t = () => (R.time - t0 >= sec) ? res() : requestAnimationFrame(t);
        t();
    });
    window.__place = (x, z) => {
        const c = SNOWFLOW.character;
        c.position.x = x; c.position.z = z;
        c.position.y = SNOWFLOW.terrain.heightAt(x, z);
        c.velocity.set(0, 0, 0);
    };
    // boss runtime row (speed etc.) for the live boss
    window.__erow = () => {
        const E = SNOWFLOW.combat.enemies, id = SNOWFLOW.combat.bosses.bossId;
        for (let i = 0; i < E.alive.length; i++) {
            if (E.alive[i] && E.id[i] === id) {
                return { i, state: E.state[i], speedNow: +E.speedNow[i].toFixed(2),
                    x: +E.x[i].toFixed(1), z: +E.z[i].toFixed(1),
                    homeX: +E.homeX[i].toFixed(1), homeZ: +E.homeZ[i].toFixed(1) };
            }
        }
        return null;
    };
    return { ok: true, playRadius: SNOWFLOW.terrain.playRadius,
             leashM: B.stats.leashM, test: SNOWFLOW.progression.testMode };
})()"""

# --- V1: chase-driven leash, no arena mutation ----------------------------
V1_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry;
    B.clearBoss();
    window.__place(0, 0);
    await window.__frames(3);
    if (!B.spawnBoss("mini")) return { err: "spawnBoss refused: " + B.stats.refusal };
    await window.__frames(4);
    const id0 = B.bossId;
    R.damage(id0, 1, {});                       // wake the fresh slot
    await window.__frames(3);
    const ax = B.ax, az = B.az;
    const s0 = R.slot(id0), max = R.hpMax[s0];
    // Invest: chip to ~90%, drive the stance bar down, stack chill -> Brittle,
    // and burn a stun DR counter. Exactly what a player does mid-fight.
    for (let k = 0; k < 6; k++) {
        R.damage(id0, max * 0.017, { poise: R.poiseMax[s0] * 0.15, chill: true,
                                     cc: "stun", ccDur: 1.2, ccMag: 0 });
        await window.__frames(2);
    }
    const invested = window.__slot(R.slot(id0));
    // KITE: walk the player outward from the arena at ~6 m/s, in-bounds, and
    // keep bolting so the investment is refreshed while the boss follows.
    const t0 = R.time;
    let d = 0, guard = 0;
    const before = window.__q.leash.length;
    while (window.__q.leash.length === before && R.time - t0 < 40 && guard++ < 6000) {
        d = Math.min(70, d + 0.1);
        window.__place(ax + d, az);
        const s = R.slot(B.bossId);
        if (s >= 0 && (guard % 12) === 0) {
            R.damage(B.bossId, max * 0.004,
                     { poise: R.poiseMax[s] * 0.06, chill: true });
        }
        await window.__frames(2);
    }
    const ev = window.__q.leash[before] || null;
    return { arena: [+ax.toFixed(1), +az.toFixed(1)], hpMax: +max.toFixed(1),
             invested, leashEvent: ev, secsToLeash: ev ? +(ev.t - t0).toFixed(2) : null,
             kiteDist: +d.toFixed(1), erow: window.__erow(),
             leashCount: window.__q.leash.length };
})()"""

# --- V2: honest cadence with the player parked outside the ring -----------
V2_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry;
    B.clearBoss();
    window.__q.leash.length = 0;
    window.__place(0, 0);
    await window.__frames(3);
    if (!B.spawnBoss("mini")) return { err: "spawnBoss refused: " + B.stats.refusal };
    await window.__frames(4);
    const id0 = B.bossId, s0 = R.slot(id0), max = R.hpMax[s0];
    R.damage(id0, max * 0.95, {});             // chip to 5%
    await window.__frames(3);
    const ax = B.ax, az = B.az;
    const start = R.time, startFrac = R.hp[R.slot(B.bossId)] / max;
    // Park the player 55 m out along +x -- outside the 30 m ring, inside the
    // boss's perception once it is already aggro'd.
    const t0 = R.time;
    let guard = 0;
    const trace = [];
    while (R.time - t0 < 60 && guard++ < 20000) {
        window.__place(ax + 55, az);
        const s = R.slot(B.bossId);
        if (s >= 0 && (guard % 40) === 0) {
            trace.push([+(R.time - t0).toFixed(1), +(R.hp[s] / max).toFixed(3),
                        +Math.hypot(R.x[s] - ax, R.z[s] - az).toFixed(1)]);
        }
        await window.__frames(2);
    }
    const s = R.slot(B.bossId);
    const gaps = [];
    for (let i = 1; i < window.__q.leash.length; i++) {
        gaps.push(+(window.__q.leash[i].t - window.__q.leash[i - 1].t).toFixed(2));
    }
    return { hpMax: +max.toFixed(1), startFrac: +startFrac.toFixed(4),
             endFrac: s >= 0 ? +(R.hp[s] / max).toFixed(4) : null,
             elapsed: +(R.time - start).toFixed(1),
             leashes: window.__q.leash.length,
             firstAt: window.__q.leash.length ? +(window.__q.leash[0].t - t0).toFixed(2) : null,
             gaps, trace: trace.slice(0, 24), erow: window.__erow(),
             fracPer: window.__q.leash.map(e => [e.pre ? e.pre.hpFrac : null,
                                                 e.post ? e.post.hpFrac : null]) };
})()"""

# --- V3: the lane's arena yank, side by side ------------------------------
V3_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry;
    B.clearBoss();
    window.__q.leash.length = 0;
    window.__place(0, 0);
    await window.__frames(3);
    if (!B.spawnBoss("mini")) return { err: "spawnBoss refused: " + B.stats.refusal };
    await window.__frames(4);
    let s = R.slot(B.bossId);
    const max = R.hpMax[s];
    R.damage(B.bossId, max * 0.95, {});
    await window.__frames(3);
    const ax = B.ax, az = B.az, t0 = R.time;
    const rows = [];
    for (let i = 0; i < 6; i++) {
        s = R.slot(B.bossId);
        rows.push(+(R.hp[s] / max).toFixed(4));
        B.ax = ax + 200 * ((i % 2) ? -1 : 1);          // the lane's yank
        await window.__frames(5);
    }
    s = R.slot(B.bossId);
    rows.push(+(R.hp[s] / max).toFixed(4));
    B.ax = ax; B.az = az;
    const gaps = [];
    for (let i = 1; i < window.__q.leash.length; i++) {
        gaps.push(+(window.__q.leash[i].t - window.__q.leash[i - 1].t).toFixed(3));
    }
    return { hpFracPerLeash: rows, leashes: window.__q.leash.length,
             wallSpanGameS: +(R.time - t0).toFixed(2), gaps };
})()"""

# --- V4: does the state decay on its own without any leash? ---------------
V4_JS = r"""(async () => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry;
    B.clearBoss();
    window.__q.leash.length = 0;
    window.__place(0, 0);
    await window.__frames(3);
    if (!B.spawnBoss("mini")) return { err: "spawnBoss refused: " + B.stats.refusal };
    await window.__frames(4);
    const id = B.bossId;
    R.damage(id, 1, {});
    await window.__frames(3);
    let s = R.slot(id);
    const max = R.hpMax[s];
    for (let k = 0; k < 6; k++) {
        R.damage(id, max * 0.017, { poise: R.poiseMax[s] * 0.15, chill: true,
                                    cc: "stun", ccDur: 1.2, ccMag: 0 });
        await window.__frames(2);
    }
    // freeze the boss in place so no leash can fire; sample the decay
    const ax = B.ax, az = B.az;
    const rows = [];
    const t0 = R.time;
    for (const w of [0, 1, 2, 3, 4, 6, 8, 10, 12, 16]) {
        while (R.time - t0 < w) {
            s = R.slot(B.bossId);
            if (s >= 0) { R.x[s] = ax; R.z[s] = az; }
            window.__place(ax + 55, az);
            await window.__frames(2);
        }
        s = R.slot(B.bossId);
        if (s < 0) break;
        const o = window.__slot(s);
        rows.push([w, o.poise, o.chill, o.brittleLeft, o.dr.join("/")]);
    }
    return { hpMax: +max.toFixed(1), decay: rows,
             leashesDuring: window.__q.leash.length };
})()"""

STAGES = [("V1 chase-driven leash", V1_JS), ("V2 honest cadence", V2_JS),
          ("V3 arena-yank replica", V3_JS), ("V4 natural decay", V4_JS)]


def main():
    from playwright.sync_api import sync_playwright
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT)],
                           cwd=str(ROOT), stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL)
    out = {}
    try:
        import time
        time.sleep(2.5)
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=120000)
            pg.wait_for_timeout(2500)
            print("SETUP", json.dumps(pg.evaluate(SETUP)))
            for name, js in STAGES:
                try:
                    r = pg.evaluate(js)
                except Exception as e:                      # noqa: BLE001
                    r = {"exception": str(e)[:400]}
                out[name] = r
                print("\n==", name)
                print(json.dumps(r, indent=1)[:4000])
            if errs:
                print("\nPAGE ERRORS:", errs[:5])
            br.close()
    finally:
        srv.terminate()
    Path(__file__).with_suffix(".json").write_text(
        json.dumps(out, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
