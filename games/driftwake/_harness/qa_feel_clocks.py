# -*- coding: utf-8 -*-
"""
qa_feel_clocks.py -- which CLOCK each feel signal runs on.

  L1  hurtFx vignette: `_flashUntil` is a performance.now() deadline while
      every other combat signal runs on the frame's (hit-stop-dilated,
      pause-zeroed) dt. Freeze the world mid-flash and watch it drain.
  L2  hitstop while S.freezeTime is true: does the envelope/camera punch
      still trigger, and does the punch freeze INTO the paused frame?
  L3  motes.spawnAt vs the play area -- is the drop point clamped?
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
    const SF = SNOWFLOW, S = SNOWFLOW.S;   // S.freezeTime lives on SNOWFLOW.S,
    // NOT on the SNOWFLOW surface -- the first cut of this probe wrote
    // `SNOWFLOW.freezeTime` and measured an unfrozen world.
    const reg = SF.combat.registry, en = SF.combat.enemies;
    const c = SF.character, hurt = SF.hurtFx, motes = SF.motes, rig = SF.rig;
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
    const out = {};
    await clearField();
    SF.input.locked = true;
    c.health = c.healthMax;
    await waitFrames(4);
    const vig = document.querySelector('#hurtfx .hfx-vig');

    // ---------- L1: the vignette's clock ------------------------------
    // Force the visibility gate: the automation page has no FFG shell and no
    // pointer lock, so `_show` is what a locked, playing session would have.
    hurt._show = true; hurt.el.classList.add('show');
    hurt.onPlayerHit(1, 0, 40);
    const gameAtHit = reg.time;
    const wallAtHit = performance.now();
    out.L1_atHit = { flashUntil_minus_now_ms:
                        +(hurt._flashUntil - wallAtHit).toFixed(1),
                     flashPeak: hurt._flashPeak,
                     clockDomain: hurt._flashUntil > 1e5
                        ? "performance.now()" : "game seconds" };
    // FREEZE the world and let 1.2 s of WALL time pass.
    S.freezeTime = true;
    await waitFrames(2);
    const gameFrozen = reg.time;
    await new Promise(r => setTimeout(r, 1200));
    await waitFrames(2);
    out.L1_afterFreeze = {
        wallElapsedMs: Math.round(performance.now() - wallAtHit),
        gameElapsedMs: +((reg.time - gameAtHit) * 1000).toFixed(2),
        gameAdvancedWhileFrozenMs: +((reg.time - gameFrozen) * 1000).toFixed(2),
        vignetteOpacity: vig.style.opacity,
        flashUntil: hurt._flashUntil,
        note: "flash window is 250 ms; a game-time clock would still be live" };
    S.freezeTime = false;
    await waitFrames(3);

    // ---------- L2: hitstop + camera punch under freeze ---------------
    await clearField();
    const ids = [];
    for (let k = 0; k < 4; k++) {
        const id = en.spawn(0, c.position.x + 5 + k, c.position.z + 4, 10);
        if (id >= 0) ids.push(id);
    }
    await waitFrames(3);
    for (const id of ids) reg.damage(id, 1, {});
    await waitFrames(30);        // let any envelope + cooldown expire
    const hs = SF.hitstop;
    const b = { kill: hs.stats.triggers.kill, heavy: hs.stats.triggers.heavy,
                rejected: hs.stats.rejected, trauma: +rig.trauma.toFixed(4),
                punchPitch: +rig.punchPitch.toFixed(5),
                camY: +rig.camera.position.y.toFixed(4),
                quat: rig.camera.quaternion.toArray().map(v => +v.toFixed(5)) };
    S.freezeTime = true;
    await waitFrames(3);
    const frozenQuat0 = rig.camera.quaternion.toArray().map(v => +v.toFixed(5));
    for (const id of ids) reg.damage(id, 999999, {});
    await waitFrames(6);
    const d = { kill: hs.stats.triggers.kill, heavy: hs.stats.triggers.heavy,
                rejected: hs.stats.rejected, trauma: +rig.trauma.toFixed(4),
                punchPitch: +rig.punchPitch.toFixed(5),
                quat: rig.camera.quaternion.toArray().map(v => +v.toFixed(5)) };
    await waitFrames(8);
    const d2 = { punchPitch: +rig.punchPitch.toFixed(5),
                 trauma: +rig.trauma.toFixed(4),
                 quat: rig.camera.quaternion.toArray().map(v => +v.toFixed(5)) };
    S.freezeTime = false;
    await waitFrames(6);
    out.L2_freeze = {
        before: b, duringFreeze: d, laterInFreeze: d2,
        killsAcceptedWhileFrozen: d.kill - b.kill,
        heavyAcceptedWhileFrozen: d.heavy - b.heavy,
        traumaAddedWhileFrozen: +(d.trauma - b.trauma).toFixed(4),
        punchAppliedWhileFrozen: +(d.punchPitch - b.punchPitch).toFixed(5),
        punchDecayedOverNextFrames: +(d2.punchPitch - d.punchPitch).toFixed(5),
        pausedFrameQuatMoved:
            JSON.stringify(frozenQuat0) !== JSON.stringify(d.quat),
    };

    // ---------- L3: mote drop point vs the play area ------------------
    await clearField();
    const R = SF.terrain.playRadius;
    motes.spawnAt(R + 60, 0, 1);
    await waitFrames(2);
    let idx = -1;
    for (let i = 0; i < motes.alive.length; i++) if (motes.alive[i]) idx = i;
    out.L3_outsidePlayArea = {
        playRadius: +R.toFixed(1),
        askedR: +(R + 60).toFixed(1),
        landedR: idx >= 0
            ? +Math.hypot(motes.x[idx], motes.z[idx]).toFixed(1) : null,
        clamped: idx >= 0
            ? Math.hypot(motes.x[idx], motes.z[idx]) <= R + 1e-3 : null,
        edge01AtDrop: idx >= 0
            ? +SF.terrain.edge01(motes.x[idx], motes.z[idx]).toFixed(3) : null,
    };
    motes.clear();
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
            print(json.dumps(pg.evaluate(JS), indent=1))
            if errs:
                print("\n!! page errors:", errs[:6])
            br.close()
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
