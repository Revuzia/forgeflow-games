# -*- coding: utf-8 -*-
"""
qa_hitstop_clock.py -- src/core/hitstop.js on a SYNTHETIC 60 fps clock.

The live machine renders driftwake at 3-4 fps, where `MAX_FRAME_MS` saturates
dt at 100 ms and a whole 60 ms envelope drains inside a single frame -- so the
90 ms stack cap and the 250 ms anti-strobe cooldown cannot be observed there.
This drives the REAL module (dynamic import of the shipped file) with a fake
registry / enemies / rig at a fixed 16.667 ms step, which is the target the
constants were tuned for.

  C1  ten kills in ONE frame          -> burst length, min scale, dt floor
  C2  a kill every frame for 1 s      -> cap holds? duty cycle? rejections?
  C3  the anti-strobe cooldown        -> one stop per multi-hit spell?
  C4  the dt === 0 combat-freeze sentinel over every case
  C5  player-hit pulse + camera punch accounting
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
         "--disable-features=CalculateNativeWinOcclusion"]

JS = """(async () => {
    const mod = await import('/games/driftwake/src/core/hitstop.js');
    const HitStop = mod.HitStop;

    // ---- fakes -------------------------------------------------------
    const mkReg = () => ({
        eventCount: 0,
        evType: new Uint8Array(128),
        evAmount: new Float32Array(128),
        evKind: new Array(128).fill('enemy'),
        push(type, amount) {
            const e = this.eventCount++;
            this.evType[e] = type; this.evAmount[e] = amount;
            this.evKind[e] = 'enemy';
        },
        clear() { this.eventCount = 0; },
    });
    const mkEn = () => ({ playerHurtPulse: 0, playerHurtDirX: 1,
                          playerHurtDirZ: 0 });
    const mkRig = () => ({ right: { x: 1, y: 0, z: 0 }, punches: 0,
                           trauma: 0, traumaPeak: 0, pitch: 0, yaw: 0,
                           punch(p, y) { this.punches++; this.pitch += p;
                                         this.yaw += y; },
                           addTrauma(a) {
                               this.trauma = Math.min(1, this.trauma + a);
                               if (this.trauma > this.traumaPeak)
                                   this.traumaPeak = this.trauma;
                           } });

    const DT = 1 / 60;
    /**
     * Run `frames` frames. `feed(f, reg, en)` stages this frame's events.
     * Mirrors main.js exactly: scale() at the top of the frame with the
     * PREVIOUS frame's scale, update() after the combat pass, then
     * endFrame() clears the ring.
     */
    const run = (frames, feed) => {
        const reg = mkReg(), en = mkEn(), rig = mkRig();
        const hs = new HitStop(reg, en, rig);
        const rows = [];
        let wall = 0, game = 0;
        for (let f = 0; f < frames; f++) {
            const dtGame = hs.scale(DT);          // main.js:942
            game += dtGame; wall += DT;
            feed(f, reg, en);
            hs.update(DT);                        // main.js:1044
            rows.push([+(wall * 1000).toFixed(3), +(dtGame * 1000).toFixed(4),
                       +hs.stats.scaleNow.toFixed(4), hs.stats.active ? 1 : 0]);
            reg.clear();
        }
        return { rows, wallMs: wall * 1000, gameMs: game * 1000,
                 trig: { ...hs.stats.triggers }, rejected: hs.stats.rejected,
                 punches: rig.punches, trauma: +rig.trauma.toFixed(4),
                 traumaPeak: +rig.traumaPeak.toFixed(4),
                 pitch: +rig.pitch.toFixed(4), yaw: +rig.yaw.toFixed(4) };
    };

    // longest contiguous run of dilated GAME frames, in wall ms.
    // A full-speed frame is 16.6667 ms of game time; anything measurably
    // under that is dilated. (0.5 ms of slack keeps float noise out.)
    const FULL = 16.6667, DILATED = FULL - 0.5;
    const burst = (rows) => {
        let best = 0, cur = 0, n = 0, bn = 0;
        for (const r of rows) {
            if (r[1] < DILATED) { cur += FULL; n++; if (cur > best) { best = cur; bn = n; } }
            else { cur = 0; n = 0; }
        }
        return { ms: +best.toFixed(2), frames: bn };
    };
    const minDt = (rows) => Math.min(...rows.map(r => r[1]));
    const out = {};

    // ---- C1: ten kills in ONE frame ---------------------------------
    let r = run(30, (f, reg) => {
        if (f === 3) for (let k = 0; k < 10; k++) { reg.push(0, 120); reg.push(1, 0); }
    });
    out.C1_tenKillsOneFrame = {
        trig: r.trig, rejected: r.rejected, punches: r.punches,
        traumaPeak: r.traumaPeak, punchPitchSum: r.pitch,
        dilatedBurst: burst(r.rows), minGameDtMs: +minDt(r.rows).toFixed(4),
        dtEverZero: minDt(r.rows) === 0,
        firstSevenFrames: r.rows.slice(3, 10),
    };

    // ---- C2: a kill EVERY frame for 1 s (vortex through a pack) -----
    r = run(90, (f, reg) => { if (f >= 3 && f < 63) { reg.push(0, 120); reg.push(1, 0); } });
    out.C2_killEveryFrame = {
        trig: r.trig, rejected: r.rejected, punches: r.punches,
        longestDilatedRunMs: burst(r.rows).ms,
        longestDilatedRunFrames: burst(r.rows).frames,
        wallMs: +r.wallMs.toFixed(1), gameMs: +r.gameMs.toFixed(1),
        gameOverWall: +(r.gameMs / r.wallMs).toFixed(3),
        minGameDtMs: +minDt(r.rows).toFixed(4),
        dtEverZero: minDt(r.rows) === 0,
    };

    // ---- C3: the anti-strobe cooldown (a multi-hit spell) -----------
    // 5 heavy hits landing 1 frame apart, then a second volley 300 ms later.
    r = run(90, (f, reg) => {
        if (f >= 3 && f < 8) reg.push(0, 40);
        if (f >= 30 && f < 35) reg.push(0, 40);
    });
    out.C3_cooldown = { trig: r.trig, rejected: r.rejected,
                        dilatedRuns: (() => {
                            const runs = []; let cur = 0;
                            for (const row of r.rows) {
                                if (row[1] < DILATED) cur += FULL;
                                else if (cur > 0) { runs.push(+cur.toFixed(2)); cur = 0; }
                            }
                            if (cur > 0) runs.push(+cur.toFixed(2));
                            return runs;
                        })() };

    // ---- C4: the deepest scale ever reached over a long storm -------
    r = run(600, (f, reg) => {
        if (f % 2 === 0) { reg.push(0, 120); reg.push(1, 0); }
    });
    out.C4_longStorm = {
        frames: 600, trig: r.trig, rejected: r.rejected,
        wallMs: +r.wallMs.toFixed(1), gameMs: +r.gameMs.toFixed(1),
        gameOverWall: +(r.gameMs / r.wallMs).toFixed(3),
        minGameDtMs: +minDt(r.rows).toFixed(4),
        dtEverZero: minDt(r.rows) === 0,
        longestDilatedRunMs: burst(r.rows).ms,
        traumaAfter600: r.trauma, punches: r.punches,
    };

    // ---- C4b: the REALISTIC storm -- one vortex kills 8 at once ------
    // and the camera trauma it banks (KILL_TRAUMA 0.08 x 8, decay 1.15/s).
    r = run(120, (f, reg) => {
        if (f === 5) for (let k = 0; k < 8; k++) { reg.push(0, 120); reg.push(1, 0); }
    });
    out.C4b_vortexEightKills = {
        trig: r.trig, rejected: r.rejected, punches: r.punches,
        traumaPeak: r.traumaPeak, shakeAtPeak: +(r.traumaPeak * r.traumaPeak).toFixed(3),
        punchPitchSum: r.pitch,
        dilatedBurst: burst(r.rows), minGameDtMs: +minDt(r.rows).toFixed(4),
    };

    // ---- C5: player-hit pulses only ---------------------------------
    r = run(60, (f, reg, en) => { if (f % 3 === 0) en.playerHurtPulse++; });
    out.C5_playerHits = { trig: r.trig, rejected: r.rejected,
                          punches: r.punches, yawSum: r.yaw,
                          longestDilatedRunMs: burst(r.rows).ms };
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
            pg = br.new_page(viewport={"width": 900, "height": 600})
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function("() => globalThis.SNOWFLOW", timeout=120000)
            pg.wait_for_timeout(1500)
            print(json.dumps(pg.evaluate(JS), indent=1))
            if errs:
                print("\n!! page errors:", errs[:6])
            br.close()
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
