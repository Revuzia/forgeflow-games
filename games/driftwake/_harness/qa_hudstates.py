# -*- coding: utf-8 -*-
"""
qa_hudstates.py -- laneC HUD-state verification, port 8863.

Asserts, against the LIVE DOM + registry:
  A. arc-chill on three imps -> chill glyph (.chill) + slow % text over their
     bars within 0.3 s of GAME time, cleared when the 3 s chill window lapses.
  B. poise-break on a brute -> stagger star (.break) within 0.3 s.
  C. hailPlateGuard -> heavy-tier bar treatment (.hv + visible plate icon).
  D. player takes a hit (striker due EAST) -> vignette opacity > 0, decays to
     0, directional tick fired at the bearing of the striker.
  E. health 25% -> #hurtfx.low heartbeat on; restore -> off.
  F. damage/kill floaters render (.flt-kill running span) -- visual check shot.

Chill is applied through the registry seam the Frost Arc itself uses
(damage(id, n, {chill:true, cc:"slow", ccDur:2.5, ccMag:0.4}) -- spellHits.js
arc opts), so the UI reads the exact state the spell produces.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]          # forgeflow-games/ = server root
PORT = 8863
GAME_URL = f"http://localhost:{PORT}/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

SETUP = """() => {
    const SF = SNOWFLOW;
    SF.input.locked = true;              // HUD layers show under the lock
    SF.combat.enemies.clear();
    return { yaw: SF.rig.yaw, hp: SF.character.health };
}"""

# gameWait helper injected into every evaluate that needs game-time waits.
GW = """
    const reg = SNOWFLOW.combat.registry;
    const gameWait = (sec) => new Promise((res) => {
        const t0 = reg.time;
        const tick = () => (reg.time - t0 >= sec) ? res()
            : requestAnimationFrame(tick);
        tick();
    });
    const raf = () => new Promise(r => requestAnimationFrame(r));
    // enemybars applies its status classes only AFTER the on-screen tests
    // (src/ui/enemybars.js: behind-camera and NDC-bounds `continue`), so a
    // subject that is not framed keeps a bare `eb` class no matter what the
    // registry says. Spawn along the camera's own forward axis instead of
    // blindly at pz-N, which put every subject behind the camera.
    const AHEAD = (dist, lateral) => {
        const cam = SNOWFLOW.rig.camera, e = cam.matrixWorld.elements;
        const fx = -e[8], fz = -e[10];
        const L = Math.hypot(fx, fz) || 1;
        const nx = fx / L, nz = fz / L;
        return { x: cam.position.x + nx * dist - nz * (lateral || 0),
                 z: cam.position.z + nz * dist + nx * (lateral || 0) };
    };
"""

TEST_CHILL = """(async () => {""" + GW + """
    const SF = SNOWFLOW, E = SF.combat.enemies, c = SF.character;
    const px = c.position.x, pz = c.position.z;
    const ids = [];
    for (let k = 0; k < 3; k++) {
        const p = AHEAD(13, (k - 1) * 2.2);
        ids.push(E.spawn('rimeImp', p.x, p.z, 10));
    }
    await raf(); await raf();            // registry slot lands next frame
    // Frost Arc seam: chill stack + 40% x 2.5 s slow (spellHits.js arc opts)
    const t0 = reg.time;
    for (const id of ids) {
        reg.damage(id, 5, { chill: true, cc: 'slow', ccDur: 2.5, ccMag: 0.4 });
    }
    // poll: game time until ALL THREE bars wear .chill with slow text
    const eb = SF.enemyBars;
    let shownAt = -1;
    for (let n = 0; n < 120; n++) {
        await raf();
        let got = 0; const slows = [];
        for (let i = 0; i < eb._id.length; i++) {
            const at = ids.indexOf(eb._id[i]);
            if (at < 0) continue;
            if (eb._bar[i].classList.contains('chill') &&
                eb._slowEl[i].textContent) {
                got++; slows[at] = eb._slowEl[i].textContent;
            }
        }
        if (got === 3) { shownAt = reg.time - t0; window.__slows = slows; break; }
    }
    return { ids, shownAt, slows: window.__slows || null,
             speedMult: reg.speedMult(ids[0]) };
})()"""

TEST_CHILL_CLEAR = """(async () => {""" + GW + """
    const SF = SNOWFLOW, eb = SF.enemyBars;
    const ids = ARG_IDS;
    await gameWait(3.3);                 // chill window is 3 s since chillAt
    await raf();
    const still = [];
    for (let i = 0; i < eb._id.length; i++) {
        if (ids.indexOf(eb._id[i]) >= 0 &&
            eb._bar[i].classList.contains('chill')) still.push(eb._id[i]);
    }
    return { stillChilled: still };
})()"""

TEST_BREAK_HV = """(async () => {""" + GW + """
    const SF = SNOWFLOW, E = SF.combat.enemies, c = SF.character;
    E.clear();
    const px = c.position.x, pz = c.position.z;
    const pb = AHEAD(13, -3), pg2 = AHEAD(13, 3);
    const brute = E.spawn('glacierBrute', pb.x, pb.z, 10);
    const guard = E.spawn('hailPlateGuard', pg2.x, pg2.z, 10);
    await raf(); await raf();
    const t0 = reg.time;
    reg.damage(brute, 10, { poise: 9999 });   // force the stance break
    reg.damage(guard, 10, {});                // just reveal the bar
    const eb = SF.enemyBars;
    let breakAt = -1, hvAt = -1, plateShown = false;
    for (let n = 0; n < 120 && (breakAt < 0 || hvAt < 0); n++) {
        await raf();
        for (let i = 0; i < eb._id.length; i++) {
            if (eb._id[i] === brute && breakAt < 0 &&
                eb._bar[i].classList.contains('break')) breakAt = reg.time - t0;
            if (eb._id[i] === guard && hvAt < 0 &&
                eb._bar[i].classList.contains('hv')) {
                hvAt = reg.time - t0;
                const pl = eb._bar[i].querySelector('.eb-plate');
                plateShown = !!pl && getComputedStyle(pl).display !== 'none';
            }
        }
    }
    const bs = reg.slot(brute);
    return { brute, guard, breakAt, hvAt, plateShown,
             bruteBreakUntil: bs >= 0 ? +(reg.breakUntil[bs] - reg.time).toFixed(2) : null };
})()"""

TEST_HURT = """(async () => {""" + GW + """
    const SF = SNOWFLOW, E = SF.combat.enemies, c = SF.character, hf = SF.hurtFx;
    E.clear();
    await raf();
    const px = c.position.x, pz = c.position.z;
    const striker = E.spawn('rimeImp', px + 6, pz, 10);   // due EAST (+X)
    await raf(); await raf();
    const hpBefore = c.health;
    c.health = hpBefore - 20;            // the poll seam sees the drop
    await raf(); await raf();
    const vigOp = parseFloat(getComputedStyle(hf._vig).opacity);
    // expected bearing from live striker position + rig yaw
    const s = reg.slot(striker);
    const dx = reg.x[s] - c.position.x, dz = reg.z[s] - c.position.z;
    const yaw = SF.rig.yaw;
    const fwd = Math.sin(yaw) * dx - Math.cos(yaw) * dz;
    const right = Math.cos(yaw) * dx + Math.sin(yaw) * dz;
    const expectDeg = Math.atan2(right, fwd) * 180 / Math.PI;
    const tickRunning = hf._tickA.some(a => a.classList.contains('run'));
    return { vigOp, gotDeg: hf._lastAngleDeg, expectDeg: +expectDeg.toFixed(1),
             tickRunning, low: hf.el.classList.contains('low') };
})()"""

TEST_HURT_DECAY = """(async () => {
    const hf = SNOWFLOW.hurtFx;
    return { vigOp: parseFloat(getComputedStyle(hf._vig).opacity) };
})()"""

TEST_LOWHP = """(async () => {""" + GW + """
    const SF = SNOWFLOW, c = SF.character, hf = SF.hurtFx;
    // healthMax is 54, not 100 — the old `c.health = 25` was 46%, not 25%,
    // and live enemies from the earlier phases kept chipping the value
    // between the write and the read. Clear the field, then derive from max.
    SF.combat.enemies.clear();
    await raf(); await raf();
    c.health = c.healthMax * 0.25;
    await raf(); await raf();
    c.health = c.healthMax * 0.25;        // re-pin against any mid-frame heal
    await raf();
    const on = hf.el.classList.contains('low');
    window.__lowShotReady = true;
    return { on, frac: c.health / c.healthMax };
})()"""

TEST_LOWHP_OFF = """(async () => {""" + GW + """
    const SF = SNOWFLOW, c = SF.character, hf = SF.hurtFx;
    c.health = c.healthMax;
    await raf(); await raf();
    return { off: !hf.el.classList.contains('low') };
})()"""

TEST_FLOATER = """(async () => {""" + GW + """
    const SF = SNOWFLOW, E = SF.combat.enemies, c = SF.character;
    E.clear();
    await raf();
    const pf = AHEAD(12, 0);
    const id = E.spawn('rimeImp', pf.x, pf.z, 10);
    await raf(); await raf();
    reg.damage(id, 24, {});
    await raf(); await raf();
    reg.damage(id, 9999, {});             // kill -> big floater
    await raf(); await raf();
    const kills = [...document.querySelectorAll('#floaters .flt-t.run')]
        .map(t => ({ cls: t.className, text: t.textContent }));
    return { kills };
})()"""


def main():
    from playwright.sync_api import sync_playwright

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.0)
    results = {}
    fails = []

    def check(name, ok, detail):
        results[name] = detail
        print(("PASS " if ok else "FAIL ") + name + "  " + json.dumps(detail))
        if not ok:
            fails.append(name)

    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=120000)
            pg.wait_for_timeout(2500)
            setup = pg.evaluate(SETUP)
            print("setup", json.dumps(setup))

            # A. chill glyph + slow %
            r = pg.evaluate(TEST_CHILL)
            pg.screenshot(path=str(HERE / "hudstates_chill.png"))
            ok = (r.get("shownAt") is not None and 0 <= r["shownAt"] <= 0.3
                  and r.get("slows") and all(r["slows"]))
            check("A.chill_glyph_slow_pct", ok, r)
            ids = r["ids"]

            r2 = pg.evaluate(TEST_CHILL_CLEAR.replace("ARG_IDS", json.dumps(ids)))
            check("A2.chill_clears", r2["stillChilled"] == [], r2)

            # B+C. poise-break star + heavy tier
            r = pg.evaluate(TEST_BREAK_HV)
            pg.screenshot(path=str(HERE / "hudstates_break_hv.png"))
            check("B.poisebreak_star", 0 <= r["breakAt"] <= 0.3, r)
            check("C.heavy_tier_plate", 0 <= r["hvAt"] <= 0.3 and r["plateShown"], r)

            # D. player hit: vignette + directional tick (striker due east)
            r = pg.evaluate(TEST_HURT)
            pg.screenshot(path=str(HERE / "hudstates_hurt.png"))
            deg_err = (abs(r["gotDeg"] - r["expectDeg"])
                       if r["gotDeg"] is not None else 999)
            deg_err = min(deg_err, 360 - deg_err)
            check("D.vignette_flash", r["vigOp"] > 0, {"vigOp": r["vigOp"]})
            check("D.tick_bearing", r["tickRunning"] and deg_err <= 8,
                  {"gotDeg": r["gotDeg"], "expectDeg": r["expectDeg"],
                   "err": round(deg_err, 1)})
            pg.wait_for_timeout(500)
            r = pg.evaluate(TEST_HURT_DECAY)
            check("D2.vignette_decays", r["vigOp"] == 0, r)

            # E. low-hp heartbeat
            r = pg.evaluate(TEST_LOWHP)
            pg.screenshot(path=str(HERE / "hudstates_lowhp.png"))
            check("E.lowhp_on", r["on"] and r["frac"] == 0.25, r)
            r = pg.evaluate(TEST_LOWHP_OFF)
            check("E2.lowhp_off", r["off"], r)

            # F. kill floater renders (visual judgment from the shot)
            r = pg.evaluate(TEST_FLOATER)
            pg.screenshot(path=str(HERE / "hudstates_floater.png"))
            has_kill = any("flt-kill" in k["cls"] for k in r["kills"])
            check("F.kill_floater", has_kill, r)

            br.close()
    finally:
        srv.terminate()

    print("\n== RESULT:", "OK" if not fails else ("FAILS: " + ", ".join(fails)))
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
