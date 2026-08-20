# -*- coding: utf-8 -*-
"""qa_edgefix.py -- prove the three 2026-08-16 owner fixes:
   1. surfing outward in the storm band is RESISTED, never reversed
   2. a bolt aimed above the horizon flies UP, not into the sand
   3. TEST mode lifts every level gate (spells + realms + bosses)
"""
import json
import subprocess
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = r"C:\Users\TestRun\Claude Claw\forgeflow-games"
PORT = 8882
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

TEST_STATE = """() => ({
    testMode: !!SNOWFLOW.progression.testMode,
    unlocked: Array.from(SNOWFLOW.progression.unlocked).sort(),
    level: SNOWFLOW.progression.level,
    spellsSet: Array.from(SNOWFLOW.spells.unlocked).sort()
})"""

CAST_ALL = """() => new Promise((res) => {
    const SF = SNOWFLOW, c = SF.character;
    SF.combat.encounters._nextSpawnAt = 1e9;
    SF.combat.encounters._clearAll();
    SF.combat.enemies.clear();
    const keys = [1, 3, 4, 5, 7];
    const fired = {};
    let i = 0;
    const step = () => {
        if (i < keys.length) {
            const k = keys[i++];
            c.mana = c.manaMax;
            SF.spells._cdUntil[k] = 0;
            const before = SF.spells._lastCast;
            SF.spells.cast(k);
            fired[k] = SF.spells._lastCast !== before;
            setTimeout(step, 380);
            return;
        }
        res({ fired: fired, level: SF.progression.level });
    };
    step();
})"""

GATE_LEVELS = """() => ({
    enc: SNOWFLOW.combat.encounters._level(),
    boss: SNOWFLOW.combat.bosses ? SNOWFLOW.combat.bosses._level() : -1
})"""

BOLT_UP = """(r) => new Promise((res) => {
    const SF = SNOWFLOW, c = SF.character;
    c.position.set(r, SF.terrain.heightAt(r, 0), 0);
    if (c.velocity) c.velocity.set(0, 0, 0);
    SF.rig.yaw = Math.PI / 2;
    SF.rig.pitch = -0.5;
    let n = 0;
    const settle = () => {
        if (n++ < 60) { requestAnimationFrame(settle); return; }
        SF.spells.aim.copy(SF.rig.forward);
        const slot = SF.spells._fireBolt();
        const d = SF.spells.bolt;
        let dy = null;
        if (slot >= 0) {
            if (d.dirY) dy = d.dirY[slot];
            else if (d.vy) dy = d.vy[slot];
        }
        res({ r: r, aimY: +SF.spells.aim.y.toFixed(3), slot: slot,
              dirY: dy === null ? null : +dy.toFixed(3) });
    };
    settle();
})"""

OUTWARD = """() => new Promise((res) => {
    const SF = SNOWFLOW, reg = SF.combat.registry, c = SF.character;
    const t0 = reg.time;
    const r0 = Math.hypot(c.position.x, c.position.z);
    let rMin = r0;
    const tick = () => {
        const r = Math.hypot(c.position.x, c.position.z);
        if (r < rMin) rMin = r;
        if (reg.time - t0 >= 3.0) {
            return res({ r0: +r0.toFixed(1), rEnd: +r.toFixed(1),
                         gained: +(r - r0).toFixed(2),
                         lostGround: +(r0 - rMin).toFixed(2) });
        }
        requestAnimationFrame(tick);
    };
    tick();
})"""

STAND_STILL = """() => new Promise((res) => {
    const SF = SNOWFLOW, c = SF.character, reg = SF.combat.registry;
    c.position.set(612, SF.terrain.heightAt(612, 0), 0);
    if (c.velocity) c.velocity.set(0, 0, 0);
    const r0 = Math.hypot(c.position.x, c.position.z);
    const t0 = reg.time;
    const tick = () => {
        if (reg.time - t0 >= 3.0) {
            const r = Math.hypot(c.position.x, c.position.z);
            return res({ r0: +r0.toFixed(2), rEnd: +r.toFixed(2),
                         drift: +(r0 - r).toFixed(2) });
        }
        requestAnimationFrame(tick);
    };
    tick();
})"""

PLACE = """(r) => {
    const SF = SNOWFLOW, c = SF.character;
    c.position.set(r, SF.terrain.heightAt(r, 0), 0);
    if (c.velocity) c.velocity.set(0, 0, 0);
    SF.rig.yaw = Math.PI / 2;
    SF.rig.pitch = 0.17;
    c.facing = Math.PI / 2;
}"""

CLAMP = """() => {
    const SF = SNOWFLOW, c = SF.character;
    c.position.set(900, 0, 0);
    SF.terrain.clampToPlayArea(c.position);
    return +Math.hypot(c.position.x, c.position.z).toFixed(1);
}"""


def main():
    from playwright.sync_api import sync_playwright
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT)],
                           cwd=ROOT, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL)
    time.sleep(2.5)
    fails = []
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            url = ("http://localhost:%d/games/driftwake/index.html?autoplay&test"
                   % PORT)
            pg.goto(url, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=180000)
            pg.wait_for_timeout(2500)

            # ---- 3. TEST mode -------------------------------------------
            t = pg.evaluate(TEST_STATE)
            ok = (t["testMode"] and len(t["unlocked"]) >= 5
                  and len(t["spellsSet"]) >= 5)
            print(("PASS " if ok else "FAIL ")
                  + "TEST mode via ?test  " + json.dumps(t))
            if not ok:
                fails.append("test mode url")

            cast = pg.evaluate(CAST_ALL)
            allfired = all(cast["fired"].values())
            print(("PASS " if allfired else "FAIL ")
                  + "every gated spell casts at level %s  %s"
                  % (cast["level"], json.dumps(cast["fired"])))
            if not allfired:
                fails.append("test cast")

            gl = pg.evaluate(GATE_LEVELS)
            ok = gl["enc"] >= 10 and gl["boss"] >= 10
            print(("PASS " if ok else "FAIL ")
                  + "level gates lifted  " + json.dumps(gl))
            if not ok:
                fails.append("gate level")

            # ---- 2. bolt keeps its pitch --------------------------------
            pg.mouse.click(640, 360)
            pg.wait_for_timeout(300)
            for label, r in (("near", 100), ("far", 600)):
                b = pg.evaluate(BOLT_UP, r)
                up = (b["dirY"] is not None and b["dirY"] > 0.2)
                print(("PASS " if up else "FAIL ")
                      + "bolt keeps its pitch (%s)  %s" % (label, json.dumps(b)))
                if not up:
                    fails.append("bolt pitch " + label)

            # ---- 1. resisted, never reversed ----------------------------
            for r in (560, 590, 600, 615):
                pg.evaluate(PLACE, r)
                pg.wait_for_timeout(400)
                pg.keyboard.down("w")
                pg.mouse.down(button="right")
                out = pg.evaluate(OUTWARD)
                pg.mouse.up(button="right")
                pg.keyboard.up("w")
                ok = out["lostGround"] <= 0.75
                print(("PASS " if ok else "FAIL ")
                      + "no pull-back at r=%s  %s" % (r, json.dumps(out)))
                if not ok:
                    fails.append("pullback %s" % r)
                pg.wait_for_timeout(250)

            still = pg.evaluate(STAND_STILL)
            ok = abs(still["drift"]) <= 0.5
            print(("PASS " if ok else "FAIL ")
                  + "standing in the storm does not move you  "
                  + json.dumps(still))
            if not ok:
                fails.append("idle drift")

            clamp = pg.evaluate(CLAMP)
            ok = clamp <= 621
            print(("PASS " if ok else "FAIL ") + "hard clamp holds at %s" % clamp)
            if not ok:
                fails.append("clamp")

            print("page errors:", errs if errs else "none")
            if errs:
                fails.append("page errors")
            br.close()
    finally:
        srv.terminate()
    print("\nRESULT:", "OK" if not fails else "FAIL: " + ", ".join(fails))
    sys.exit(0 if not fails else 1)


if __name__ == "__main__":
    main()
