# -*- coding: utf-8 -*-
"""
review_world_8855.py -- WORLD / TRAVERSAL / CONTENT-STRUCTURE review probes.

READ-ONLY review lane (port 8855). For each realm (cold -> sand -> ash via
enterRealm, the same path the TEMP 6/7 portals drive):

  1. relief stats  -- terrain.heightAt grid inside the 620 m play radius,
                      plus 4 radial 400 m transects from the player.
  2. surf run      -- pin input.surf (contract-1 pattern), 45 s of game time,
                      1 Hz telemetry: pos, speed, encounter packName, alive
                      count, player hp. Distance + pack-spawn cadence.
  3. walk/run      -- real KeyW (+Shift latch) via Playwright keyboard, 6 s
                      each, mean speed.
  4. sightlines    -- rig.yaw at 4 bearings, screenshot each.

Output: review_world_8855.out.json + rw_<realm>_y<i>.png in _harness/.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
PORT = 8855
GAME_URL = "http://localhost:%d/games/driftwake/index.html?autoplay" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

JS_HELPERS = """
window.__gw = (sec) => new Promise((res) => {
    const reg = SNOWFLOW.combat.registry;
    const t0 = reg.time;
    const tick = () => (reg.time - t0 >= sec) ? res() : requestAnimationFrame(tick);
    tick();
});
"""

JS_REALM = """(async () => {
    const SF = SNOWFLOW;
    const name = 'REALM';
    if (SF.encounters ? SF.encounters.realm !== name
                      : SF.combat.encounters.realm !== name) {
        await SF.enterRealm(name);
    }
    const v = SF.combat.enemies.vis;
    if (v && v.stream) v.stream();
    const reg = SF.combat.registry;
    const t0 = reg.time;
    await new Promise((res) => {
        const tick = () => ((v && v.stats && v.stats.types >= 8) ||
            reg.time - t0 > 90) ? res() : requestAnimationFrame(tick);
        tick();
    });
    return { realm: name, types: v && v.stats ? v.stats.types : -1 };
})()"""

JS_RELIEF = """(() => {
    const SF = SNOWFLOW, T = SF.terrain;
    const R = 600, STEP = 15;
    let n = 0, mn = 1e9, mx = -1e9, sum = 0, sum2 = 0;
    for (let x = -R; x <= R; x += STEP) {
        for (let z = -R; z <= R; z += STEP) {
            if (x * x + z * z > R * R) continue;
            const h = T.heightAt(x, z);
            n++; sum += h; sum2 += h * h;
            if (h < mn) mn = h; if (h > mx) mx = h;
        }
    }
    const mean = sum / n;
    const sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
    const c = SF.character.position;
    const prof = [];
    for (const b of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
        const row = [];
        for (let d = 0; d <= 400; d += 25) {
            row.push(+T.heightAt(c.x + Math.sin(b) * d,
                                 c.z + Math.cos(b) * d).toFixed(1));
        }
        prof.push(row);
    }
    return { n, min: +mn.toFixed(1), max: +mx.toFixed(1),
             mean: +mean.toFixed(1), sd: +sd.toFixed(1),
             px: +c.x.toFixed(1), pz: +c.z.toFixed(1), profiles: prof };
})()"""

JS_SURF = """(async () => {
    const SF = SNOWFLOW, inp = SF.input, c = SF.character;
    const reg = SF.combat.registry;
    const E = SF.combat.encounters;
    const P = SF.progress || null;
    Object.defineProperty(inp, 'surf', { get: () => true, configurable: true });
    const rows = [];
    let dist = 0, lx = c.position.x, lz = c.position.z;
    let spawns = 0, lastPack = E.packName;
    let maxSpd = 0, deaths0 = P ? P.deaths : 0;
    const t0 = reg.time;
    while (reg.time - t0 < DUR) {
        await window.__gw(1.0);
        const dx = c.position.x - lx, dz = c.position.z - lz;
        dist += Math.hypot(dx, dz);
        lx = c.position.x; lz = c.position.z;
        if (E.packName && E.packName !== lastPack) spawns++;
        if (E.packName) lastPack = E.packName;
        let alive = 0;
        for (let i = 0; i < reg.count; i++) {
            if (reg.hp[i] > 0 && (reg.kind[i] === 'enemy' ||
                reg.kind[i] === 'boss')) alive++;
        }
        if (c.speed > maxSpd) maxSpd = c.speed;
        rows.push({ t: +(reg.time - t0).toFixed(1),
                    x: +c.position.x.toFixed(1), z: +c.position.z.toFixed(1),
                    y: +c.position.y.toFixed(1), spd: +c.speed.toFixed(2),
                    pack: E.packName, alive, hp: Math.round(c.health) });
    }
    Object.defineProperty(inp, 'surf',
        { value: false, writable: true, configurable: true });
    const r = Math.hypot(c.position.x, c.position.z);
    return { dist: +dist.toFixed(1), spawns, maxSpd: +maxSpd.toFixed(2),
             endR: +r.toFixed(1), deaths: P ? P.deaths - deaths0 : null,
             level: P ? P.level : null, rows };
})()"""

JS_SPEED = """(async () => {
    const c = SNOWFLOW.character;
    await window.__gw(1.5);   // let it reach steady state
    let s = 0, n = 0;
    const reg = SNOWFLOW.combat.registry, t0 = reg.time;
    while (reg.time - t0 < 4) { await window.__gw(0.5); s += c.speed; n++; }
    return +(s / n).toFixed(2);
})()"""

JS_YAW = """(async () => {
    const SF = SNOWFLOW;
    SF.rig.yaw = YAW; SF.rig.pitch = 0.08;
    await window.__gw(0.6);
    return { yaw: SF.rig.yaw };
})()"""

JS_STATE = """(() => {
    const SF = SNOWFLOW, P = SF.progress || null;
    return {
        level: P ? P.level : null, xp: P ? P.xp : null,
        realmsUnlocked: P ? P.realmsUnlocked : null,
        shrines: P ? Object.keys(P.shrines) : null,
        bossesKilled: P ? P.bossesKilled : null,
        unlocked: P ? Array.from(P.unlocked) : null,
    };
})()"""


def main():
    from playwright.sync_api import sync_playwright

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    out = {"realms": {}}
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=180000)
            pg.wait_for_timeout(2500)
            pg.evaluate(JS_HELPERS)
            out["boot_state"] = pg.evaluate(JS_STATE)

            for realm in ("cold", "sand", "ash"):
                R = {}
                R["entry"] = pg.evaluate(JS_REALM.replace("REALM", realm))
                pg.wait_for_timeout(1500)
                R["relief"] = pg.evaluate(JS_RELIEF)

                # sightline shots BEFORE the surf run (from the arrival stand)
                for i, yaw in enumerate((0.0, 1.5708, 3.1416, 4.7124)):
                    pg.evaluate(JS_YAW.replace("YAW", str(yaw)))
                    pg.screenshot(path=str(HERE / ("rw_%s_y%d.png" % (realm, i))))

                # walk / run speeds via real keyboard input
                pg.keyboard.down("w")
                R["walk_speed"] = pg.evaluate(JS_SPEED)
                pg.keyboard.press("Shift")     # sprint latch ON
                R["run_speed"] = pg.evaluate(JS_SPEED)
                pg.keyboard.press("Shift")     # latch OFF
                pg.keyboard.up("w")

                # surf run, 45 s game time
                R["surf"] = pg.evaluate(
                    JS_SURF.replace("DUR", "45"))
                pg.screenshot(path=str(HERE / ("rw_%s_endsurf.png" % realm)))
                out["realms"][realm] = R
                print("== %s: dist %.0f m, spawns %d, endR %.0f, walk %.2f run %.2f" % (
                    realm, R["surf"]["dist"], R["surf"]["spawns"],
                    R["surf"]["endR"], R["walk_speed"], R["run_speed"]))

            out["end_state"] = pg.evaluate(JS_STATE)
            out["pageerrors"] = errs[:20]
            br.close()
    finally:
        srv.terminate()

    (HERE / "review_world_8855.out.json").write_text(
        json.dumps(out, indent=1), encoding="utf-8")
    # compact print (rows elided)
    for realm, R in out["realms"].items():
        print("\n==== %s" % realm)
        print(" relief:", json.dumps(R["relief"], default=str)[:400])
        s = R["surf"]
        print(" surf: dist=%s spawns=%s maxSpd=%s endR=%s deaths=%s level=%s" %
              (s["dist"], s["spawns"], s["maxSpd"], s["endR"], s["deaths"], s["level"]))
        packs = [r["pack"] for r in s["rows"]]
        alive = [r["alive"] for r in s["rows"]]
        hp = [r["hp"] for r in s["rows"]]
        print(" packs:", packs)
        print(" alive:", alive)
        print(" hp:", hp)
    print("\nboot_state:", json.dumps(out["boot_state"]))
    print("end_state:", json.dumps(out["end_state"]))
    print("pageerrors:", out["pageerrors"])


if __name__ == "__main__":
    main()
