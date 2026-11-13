# -*- coding: utf-8 -*-
"""
qa_feel_stress.py -- adversarial stress of the FEEL layer (hitstop / camera
punch / hurtFx / motes) under a mass-kill storm.

Phases
  A  HIT-STOP STORM  : 10 enemies killed in ONE frame, then a rolling storm
                       of one kill every ~3 frames for 3 s. Per-frame sample
                       of wall dt, GAME dt (registry.time delta), scaleNow,
                       and the hitstop trigger/reject counters.
  B  DT-ZERO SENTINEL: does any frame of the storm see game dt == 0?
  C  BURST CAP       : longest contiguous run of active-envelope WALL ms.
  D  PAUSE           : fire kills with S.freezeTime = true; does hitstop
                       trigger / does the camera punch?
  E  TRAUMA          : camera trauma peak after a mass kill.
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

SETUP = """(() => {
    const S = SNOWFLOW;
    // Sampler rides its own rAF, registered AFTER the game's frame() has
    // already re-queued itself, so it runs at the tail of every frame.
    if (!window.__samp) {
        window.__samp = { on: false, rows: [], lastW: performance.now(),
                          lastG: S.combat.registry.time };
        const tick = () => {
            requestAnimationFrame(tick);
            const s = window.__samp;
            const now = performance.now();
            const g = S.combat.registry.time;
            if (s.on) {
                s.rows.push([
                    +(now - s.lastW).toFixed(3),      // wall ms
                    +((g - s.lastG) * 1000).toFixed(4), // game ms
                    +S.hitstop.stats.scaleNow.toFixed(4),
                    S.hitstop.stats.active ? 1 : 0,
                    +S.rig.trauma.toFixed(4),
                    +S.rig.punchPitch.toFixed(5),
                    +S.rig.punchYaw.toFixed(5),
                ]);
            }
            s.lastW = now; s.lastG = g;
        };
        requestAnimationFrame(tick);
    }
    return true;
})()"""

STORM = """(async () => {
    const S = SNOWFLOW, reg = S.combat.registry, en = S.combat.enemies;
    const c = S.character, hs = S.hitstop;
    const waitFrames = (n) => new Promise(res => {
        let k = 0;
        const f = () => (++k >= n) ? res() : requestAnimationFrame(f);
        requestAnimationFrame(f);
    });

    // ---- clear the field, then plant a tight pack -----------------------
    for (let i = reg.count - 1; i >= 0; i--) en.despawn(reg.idOf[i]);
    await waitFrames(2);

    const ids = [];
    const N = 10;
    for (let k = 0; k < N; k++) {
        const a = k / N * 6.28318;
        const x = c.position.x + Math.cos(a) * 6;
        const z = c.position.z + Math.sin(a) * 6;
        const id = en.spawn(0, x, z, 10);
        if (id >= 0) ids.push(id);
    }
    await waitFrames(2);
    // A fresh spawn's registry slot lands NEXT frame; wake them.
    for (const id of ids) reg.damage(id, 1, {});
    await waitFrames(3);

    const t0 = { ...hs.stats.triggers };
    const rej0 = hs.stats.rejected;
    window.__samp.rows.length = 0;
    window.__samp.on = true;
    await waitFrames(4);

    // ---- ONE FRAME, TEN KILLS ------------------------------------------
    const markA = window.__samp.rows.length;
    for (const id of ids) reg.damage(id, 99999, {});
    await waitFrames(45);

    // ---- rolling storm: one kill every 3 frames for ~3 s ---------------
    const markB = window.__samp.rows.length;
    const ids2 = [];
    for (let wave = 0; wave < 12; wave++) {
        const a = wave * 0.7;
        const x = c.position.x + Math.cos(a) * 7;
        const z = c.position.z + Math.sin(a) * 7;
        const id = en.spawn(0, x, z, 10);
        if (id < 0) continue;
        ids2.push(id);
        await waitFrames(2);
        reg.damage(id, 1, {});
        await waitFrames(1);
        reg.damage(id, 99999, {});
        await waitFrames(3);
    }
    await waitFrames(20);
    const markC = window.__samp.rows.length;
    window.__samp.on = false;

    return {
        rows: window.__samp.rows,
        markA, markB, markC,
        killed: ids.length, rolled: ids2.length,
        trig: { kill: hs.stats.triggers.kill - t0.kill,
                heavy: hs.stats.triggers.heavy - t0.heavy,
                player: hs.stats.triggers.player - t0.player },
        rejected: hs.stats.rejected - rej0,
    };
})()"""

PAUSE = """(async () => {
    const S = SNOWFLOW, reg = S.combat.registry, en = S.combat.enemies;
    const c = S.character, hs = S.hitstop, rig = S.rig;
    const waitFrames = (n) => new Promise(res => {
        let k = 0;
        const f = () => (++k >= n) ? res() : requestAnimationFrame(f);
        requestAnimationFrame(f);
    });
    for (let i = reg.count - 1; i >= 0; i--) en.despawn(reg.idOf[i]);
    await waitFrames(2);
    const ids = [];
    for (let k = 0; k < 4; k++) {
        const id = en.spawn(0, c.position.x + 4 + k, c.position.z + 4, 10);
        if (id >= 0) ids.push(id);
    }
    await waitFrames(2);
    for (const id of ids) reg.damage(id, 1, {});
    await waitFrames(3);

    // settle any live envelope + its cooldown
    await waitFrames(40);
    const before = { ...hs.stats.triggers, rejected: hs.stats.rejected,
                     trauma: rig.trauma, pp: rig.punchPitch, py: rig.punchYaw,
                     scale: hs.stats.scaleNow, active: hs.stats.active };

    SNOWFLOW.S.freezeTime = true;
    await waitFrames(3);
    for (const id of ids) reg.damage(id, 99999, {});
    await waitFrames(10);
    const during = { ...hs.stats.triggers, rejected: hs.stats.rejected,
                     trauma: rig.trauma, pp: rig.punchPitch, py: rig.punchYaw,
                     scale: hs.stats.scaleNow, active: hs.stats.active,
                     regTime: reg.time };
    SNOWFLOW.S.freezeTime = false;
    await waitFrames(20);
    const after = { ...hs.stats.triggers, rejected: hs.stats.rejected,
                    trauma: rig.trauma, scale: hs.stats.scaleNow,
                    active: hs.stats.active, regTime: reg.time };
    return { before, during, after };
})()"""


def main():
    from playwright.sync_api import sync_playwright

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        import time as _t
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
            pg.evaluate(SETUP)

            out = pg.evaluate(STORM)
            rows = out.pop("rows")
            markA, markB, markC = out["markA"], out["markB"], out["markC"]
            print("== PHASE A/B/C  hit-stop storm ==")
            print(json.dumps(out))

            def analyse(lo, hi, label):
                seg = rows[lo:hi]
                if not seg:
                    print("  %s: EMPTY" % label)
                    return
                wall = [r[0] for r in seg]
                game = [r[1] for r in seg]
                scale = [r[2] for r in seg]
                zeros = [i for i, g in enumerate(game) if g == 0]
                # longest contiguous active run, in wall ms
                best = cur = 0
                bestn = curn = 0
                for r in seg:
                    if r[3]:
                        cur += r[0]; curn += 1
                        if cur > best:
                            best = cur; bestn = curn
                    else:
                        cur = 0; curn = 0
                print("  %s: frames=%d  wallSum=%.1fms  gameSum=%.1fms  "
                      "ratio=%.3f" % (label, len(seg), sum(wall), sum(game),
                                      (sum(game) / sum(wall)) if sum(wall) else 0))
                print("     wall mean=%.2f max=%.2f | game min=%.4f max=%.2f "
                      "| scale min=%.4f" % (
                          sum(wall) / len(wall), max(wall), min(game),
                          max(game), min(scale)))
                print("     dt==0 frames: %d %s" % (len(zeros), zeros[:12]))
                print("     longest ACTIVE run: %.2f ms over %d frames "
                      "(cap 90)" % (best, bestn))
                print("     trauma peak=%.4f punchPitch|max|=%.5f "
                      "punchYaw|max|=%.5f" % (
                          max(r[4] for r in seg),
                          max(abs(r[5]) for r in seg),
                          max(abs(r[6]) for r in seg)))

            analyse(0, markA, "pre-storm  ")
            analyse(markA, markB, "10-kill    ")
            analyse(markB, markC, "rolling    ")

            print("\n== PHASE D  pause ==")
            print(json.dumps(pg.evaluate(PAUSE), indent=1))

            # raw dump of the 25 frames after the mass kill
            print("\n== raw frames after the 10-kill (wallMs, gameMs, scale, "
                  "active, trauma) ==")
            for r in rows[markA:markA + 25]:
                print("   ", r[:5])

            if errs:
                print("\n!! page errors:", errs[:5])
            br.close()
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
