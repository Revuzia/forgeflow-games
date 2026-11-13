# -*- coding: utf-8 -*-
"""
qa_fxwave.py -- the FX wave (LinearAbiltyCastingThreeJS adaptations), port 8832.

Drives every piece in COLD and ASH and asserts each system's live counters
(`.stats = { active, draws }`) plus the draw-call budget:

  1. IMPACT BURSTS   bloom.trigger + crystallize.trigger + sweep.trigger ->
                     three shells live (in Ash the sweep shell arrives on the
                     fireball carrier's landing). Shots: fx_burst_cold.png,
                     fx_burst_ash.png.
  2. AOE TELEGRAPHS  three rimeImps spawned at melee range; ring appears while
                     an imp's windup flash ramps. Shot: fx_telegraph.png.
  3. CAST RING       spells.cast(3) then cast(5) (unlock set + mana granted by
                     the probe); ring live while _pending winds. Shot:
                     fx_castring.png.
  4. FROST-ARC DECAL spells.cast(7); decal live on the arcGen edge. Shot:
                     fx_arcdecal.png.
  5. BUDGET          busy frozen frame with all four live: perfStats.drawCalls
                     with the four modules enabled vs disabled; delta <= 4.

GAME-TIME waits poll SNOWFLOW.combat.registry.time via rAF -- no wall sleeps
while unfrozen. Screenshots are taken under S.freezeTime so the frame is
pixel-stable.
"""
import json
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
SHOTS = Path(__file__).resolve().parents[1] / "_shots"
PORT = 8832
GAME_URL = f"http://localhost:{PORT}/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

# Shared page-side helpers: game-time wait + the clean-frame instrument.
PRELUDE = """
window.__fx = window.__fx || (() => {
    const SF = SNOWFLOW;
    const gameWait = (sec) => new Promise((res) => {
        const reg = SF.combat.registry;
        const t0 = reg.time;
        const tick = () => (reg.time - t0 >= sec) ? res()
            : requestAnimationFrame(tick);
        tick();
    });
    const frameWait = (n) => new Promise((res) => {
        let k = n;
        const tick = () => (--k <= 0) ? res() : requestAnimationFrame(tick);
        requestAnimationFrame(tick);
    });
    const until = async (fn, timeoutS, stepS) => {
        const reg = SF.combat.registry;
        const t0 = reg.time;
        while (reg.time - t0 < timeoutS) {
            if (fn()) return true;
            await gameWait(stepS || 0.1);
        }
        return fn();
    };
    const stats = () => ({
        burst: { ...SF.spells.burst.stats },
        castRing: { ...SF.spells.castRing.stats },
        arcDecal: { ...SF.spells.arcDecal.stats },
        telegraph: { ...SF.fxTelegraph.stats },
        drawCalls: SF.perfStats.drawCalls,
    });
    return { SF, gameWait, frameWait, until, stats };
})();
"""

SETUP = PRELUDE + """
(async () => {
    const { SF, gameWait, frameWait } = window.__fx;
    const c = SF.character;
    if (SF.shrine && SF.shrine.mesh) SF.shrine.mesh.visible = false;
    SF.rig.yaw = 0;
    SF.rig.distanceTarget = 2.8;
    c.mana = 100;
    // The imps will be left whaling on the player for tens of seconds of
    // game time; a dead player mid-probe is a broken probe, not a finding.
    c.healthMax = 10000; c.health = 10000;
    // Spells 3 and 5 are level-locked at level 1; the ring under test hangs
    // off the CAST path, so the probe unlocks them the way progression would.
    if (SF.spells.unlocked) { SF.spells.unlocked.add(1); SF.spells.unlocked.add(3); SF.spells.unlocked.add(4); SF.spells.unlocked.add(5); }
    // The clean-frame instrument: the controller drifts on a slope and
    // NOTHING in the rig snaps, so the stand is PINNED every frame and the
    // camera is given real game time to ease onto it before any shot.
    if (!window.__fxPin) {
        window.__fxPin = true;
        const pin = () => {
            c.position.x = 150; c.position.z = 150;
            c.position.y = SF.terrain.heightAt(150, 150);
            if (c.velocity && c.velocity.set) c.velocity.set(0, 0, 0);
            SF.rig.yaw = 0;
            requestAnimationFrame(pin);
        };
        pin();
    }
    await gameWait(2.5);   // the spring arm settles onto the pinned stand
    await frameWait(3);
    return { x: c.position.x, z: c.position.z, mana: c.mana,
             cam: { x: SF.rig.camera.position.x.toFixed(1),
                    y: SF.rig.camera.position.y.toFixed(1),
                    z: SF.rig.camera.position.z.toFixed(1) } };
})()
"""

ARC_TEST = PRELUDE + """
(async () => {
    const { SF, gameWait, frameWait, stats } = window.__fx;
    SF.spells.cast(7);
    await frameWait(2);
    const s0 = stats();
    await gameWait(0.30);
    const s1 = stats();
    SF.S.freezeTime = true;
    await frameWait(3);
    return { onCast: s0, midLife: s1 };
})()
"""

CASTRING_TEST = PRELUDE + """
(async () => {
    const { SF, gameWait, frameWait, stats } = window.__fx;
    const c = SF.character;
    c.mana = 100;
    SF.spells.cast(3);                       // bloom: 0.66 s windup
    await gameWait(0.30);
    const mid3 = stats();
    SF.S.freezeTime = true;
    await frameWait(3);
    return { mid3 };
})()
"""

CASTRING_VORTEX = PRELUDE + """
(async () => {
    const { SF, gameWait, until, stats } = window.__fx;
    SF.S.freezeTime = false;
    // Let the bloom cast finish: pending fires at 0.66, release tail 0.42.
    await gameWait(1.6);
    const c = SF.character;
    c.mana = 100;
    SF.spells.cast(5);                       // vortex: 0.98 s windup
    await gameWait(0.40);
    const mid5 = stats();
    // Let it fire and the tail die; the vortex itself spins up (4.65 s).
    await gameWait(1.4);
    const after = stats();
    return { mid5, after };
})()
"""

BURST_TEST = PRELUDE + """
(async () => {
    const { SF, gameWait, until, frameWait, stats } = window.__fx;
    SF.S.freezeTime = false;
    // Stage the detonations DOWNRANGE and pull the camera back, or the
    // crescent and the column swallow the frame and the shells are unreadable.
    SF.rig.distanceTarget = 6.5;
    await gameWait(0.45);
    const t = SF.terrain;
    const c = SF.character;
    const x = c.position.x, z = c.position.z;
    SF.spells.bloom.trigger(x - 4.0, t.heightAt(x - 4.0, z - 9), z - 9);
    SF.spells.crystallize.trigger(x + 4.0, t.heightAt(x + 4.0, z - 9), z - 9);
    SF.spells.sweep.trigger(0, -1);          // cold: ignites at the feet NOW;
                                             // ash: carrier lands ~0.3 s out
    const got = await until(() => SF.spells.burst.stats.active >= 3, 3.0, 0.05);
    await gameWait(0.12);                    // mid-life: shells readable
    const s = stats();
    SF.S.freezeTime = true;
    await frameWait(3);
    return { gotThree: got, midLife: s };
})()
"""

BURST_DRAIN = PRELUDE + """
(async () => {
    const { SF, gameWait } = window.__fx;
    SF.S.freezeTime = false;
    SF.rig.distanceTarget = 2.8;
    await gameWait(3.2);   // shells, crescent and column all die out
    return window.__fx.stats();
})()
"""

TELEGRAPH_TEST = PRELUDE + """
(async () => {
    const { SF, gameWait, until, frameWait, stats } = window.__fx;
    SF.S.freezeTime = false;
    // A wide stage, and every body spawned IN FRONT of the camera (-Z): the
    // first framing put an imp on the camera side and it blocked the lens.
    SF.rig.distanceTarget = 6.0;
    await gameWait(0.45);
    const c = SF.character;
    const x = c.position.x, z = c.position.z;
    const e = SF.combat.enemies;
    const ids = [
        // The brute's slam is a stated "4 m ring" — the big readable ring.
        e.spawn('glacierBrute', x, z - 4.5, 10),
        e.spawn('rimeImp', x + 2.2, z - 3.0, 10),
        e.spawn('rimeImp', x - 2.2, z - 3.0, 10),
    ];
    const midFill = () => {
        for (let i = 0; i < 8; i++) {
            const f = SF.fxTelegraph.a[i * 4 + 3];
            if (f >= 0.35 && f <= 0.9) return true;
        }
        return false;
    };
    const got = await until(() =>
        SF.fxTelegraph.stats.active >= 1 && midFill(), 25.0, 0.05);
    const s = stats();
    // Sample one live ring's fill + radius straight from the uniform store.
    let fill = -1, radius = -1;
    for (let i = 0; i < 8; i++) {
        if (SF.fxTelegraph.a[i * 4 + 3] >= 0) {
            fill = SF.fxTelegraph.a[i * 4 + 3];
            radius = SF.fxTelegraph.b[i * 4 + 0];
            break;
        }
    }
    SF.S.freezeTime = true;
    await frameWait(3);
    return { spawned: ids, got, midWind: s, fill, radius };
})()
"""

BUSY_BUDGET = PRELUDE + """
(async () => {
    const { SF, gameWait, until, frameWait, stats } = window.__fx;
    SF.S.freezeTime = false;
    const c = SF.character;
    c.mana = 100;
    c.health = 10000;
    // The vortex was cast in an earlier stage and carries a 14 s cooldown;
    // the arc a 1.5 s one. The budget stage tests draws, not the economy.
    SF.spells._cdUntil[5] = 0;
    SF.spells._cdUntil[7] = 0;
    const t = SF.terrain;
    const x = c.position.x, z = c.position.z;
    // Wait for an enemy windup, then light everything at once.
    const teleUp = await until(() => SF.fxTelegraph.stats.active >= 1, 20.0, 0.1);
    SF.spells.cast(7);                        // arc decal, 1.1 s
    SF.spells.bloom.trigger(x + 3, t.heightAt(x + 3, z - 2), z - 2);
    SF.spells.crystallize.trigger(x - 3, t.heightAt(x - 3, z - 2), z - 2);
    SF.spells.sweep.trigger(0, -1);           // burst shells
    SF.spells.cast(5);                        // cast ring, 0.98 s windup
    await gameWait(0.30);
    const allUp = await until(() =>
        SF.spells.burst.stats.active >= 1 &&
        SF.spells.castRing.stats.active >= 1 &&
        SF.spells.arcDecal.stats.active >= 1 &&
        SF.fxTelegraph.stats.active >= 1, 2.0, 0.05);
    SF.S.freezeTime = true;                   // hold the busy frame
    await frameWait(4);
    const withFx = stats();
    const fxDrawSum = withFx.burst.draws + withFx.castRing.draws
                    + withFx.arcDecal.draws + withFx.telegraph.draws;
    SF.spells.burst.enabled = false;
    SF.spells.castRing.enabled = false;
    SF.spells.arcDecal.enabled = false;
    SF.fxTelegraph.enabled = false;
    await frameWait(4);
    const withoutFx = stats();
    SF.spells.burst.enabled = true;
    SF.spells.castRing.enabled = true;
    SF.spells.arcDecal.enabled = true;
    SF.fxTelegraph.enabled = true;
    await frameWait(2);
    return { teleUp, allUp, withFx, withoutFx, fxDrawSum,
             delta: withFx.drawCalls - withoutFx.drawCalls };
})()
"""

ENTER_ASH = PRELUDE + """
(async () => {
    const { SF, gameWait, frameWait } = window.__fx;
    SF.S.freezeTime = false;
    await SF.enterRealm('ash');
    // The pin loop from SETUP still holds the stand; give the realm swap's
    // hitch a beat and let the camera re-settle before shooting.
    await gameWait(1.0);
    await frameWait(3);
    return { realm: SF.spells.realm };
})()
"""

UNFREEZE = "SNOWFLOW.S.freezeTime = false; true"


def main():
    from playwright.sync_api import sync_playwright

    SHOTS.mkdir(exist_ok=True)
    results = {}
    failures = []

    def check(name, cond, detail):
        results[name] = {"ok": bool(cond), "detail": detail}
        tag = "OK " if cond else "FAIL"
        print(f"[{tag}] {name}: {json.dumps(detail, default=str)[:900]}")
        if not cond:
            failures.append(name)

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            errors = []
            pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.on("console",
                  lambda m: errors.append(m.text) if m.type == "error" else None)
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=180000)
            pg.wait_for_timeout(2500)

            setup = pg.evaluate(SETUP)
            print("setup:", json.dumps(setup))

            # ---- COLD ------------------------------------------------------
            r = pg.evaluate(ARC_TEST)
            check("cold.arcDecal",
                  r["midLife"]["arcDecal"]["active"] >= 1
                  and r["midLife"]["arcDecal"]["draws"] == 1, r)
            pg.screenshot(path=str(SHOTS / "fx_arcdecal.png"))
            pg.evaluate(UNFREEZE)
            pg.evaluate(PRELUDE + "window.__fx.gameWait(1.2)")

            r = pg.evaluate(CASTRING_TEST)
            check("cold.castRing.bloom",
                  r["mid3"]["castRing"]["active"] >= 1
                  and r["mid3"]["castRing"]["draws"] == 1, r)
            pg.screenshot(path=str(SHOTS / "fx_castring.png"))
            r = pg.evaluate(CASTRING_VORTEX)
            check("cold.castRing.vortex",
                  r["mid5"]["castRing"]["active"] >= 1, r)

            r = pg.evaluate(BURST_TEST)
            check("cold.burst",
                  r["gotThree"] and r["midLife"]["burst"]["active"] >= 3
                  and r["midLife"]["burst"]["draws"] == 1, r)
            pg.screenshot(path=str(SHOTS / "fx_burst_cold.png"))
            r = pg.evaluate(BURST_DRAIN)
            check("cold.burst.drains", r["burst"]["active"] == 0
                  and r["burst"]["draws"] == 0, r)

            r = pg.evaluate(TELEGRAPH_TEST)
            check("cold.telegraph",
                  r["got"] and r["midWind"]["telegraph"]["active"] >= 1
                  and r["midWind"]["telegraph"]["draws"] == 1
                  and r["fill"] > 0.05 and r["radius"] > 0.5, r)
            pg.screenshot(path=str(SHOTS / "fx_telegraph.png"))
            pg.evaluate(UNFREEZE)

            r = pg.evaluate(BUSY_BUDGET)
            check("cold.budget",
                  r["allUp"] and r["delta"] <= 4 and r["fxDrawSum"] <= 4, r)
            pg.screenshot(path=str(SHOTS / "fx_busy_cold.png"))
            pg.evaluate(UNFREEZE)

            # ---- ASH -------------------------------------------------------
            r = pg.evaluate(ENTER_ASH)
            check("ash.enter", r["realm"] == "ash", r)

            r = pg.evaluate(BURST_TEST)
            check("ash.burst",
                  r["gotThree"] and r["midLife"]["burst"]["active"] >= 3
                  and r["midLife"]["burst"]["draws"] == 1, r)
            pg.screenshot(path=str(SHOTS / "fx_burst_ash.png"))
            pg.evaluate(UNFREEZE)

            hard = [e for e in errors if "favicon" not in e]
            check("console.clean", not hard, hard[:6])

            br.close()
    finally:
        srv.terminate()

    print("\n==== SUMMARY ====")
    for k, v in results.items():
        print(f"  {'OK ' if v['ok'] else 'FAIL'}  {k}")
    out = Path(__file__).with_suffix(".out.json")
    out.write_text(json.dumps(results, indent=1, default=str), encoding="utf-8")
    print("written:", out)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
