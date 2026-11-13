# -*- coding: utf-8 -*-
"""
qa_density.py -- ambient encounter density, measured per realm on the live
director (port 8852).

For each realm: enterRealm, stream the realm's bodies, set the player level
inside the realm band (cold 3 / sand 10 / ash 20 -- each is floor+2, arming
the second pack slot), restore the director (_nextSpawnAt/_nextSpawnAt2 = 0),
then simulate play for 90 s GAME time (registry.time): teleport the player
40 m along the facing bearing every ~6 s and sample the live enemy count
every 100 ms.

Records per realm: packs spawned (encounters.packsSpawned delta), peak live,
mean live, longest zero-enemy gap.

PASS = sand and ash both spawn >= 2 packs in the window, every realm's
mean live >= 3 and longest zero gap <= 25 s.

Also screenshots a live sand pack and ash pack ->
_shots/density_sand.png / _shots/density_ash.png.

All JS waits are setInterval + wall-clock capped (never bare rAF loops on
reg.time): a dead frame loop returns a diagnostic row instead of hanging
the probe (lesson from the first run, which hung >20 min with zero output).
"""
import json
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
SHOTS = Path(__file__).resolve().parents[1] / "_shots"
PORT = 8852
GAME_URL = f"http://localhost:{PORT}/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

# Every roster key the realm's PACKS table can field (encounters.js).
REALM_KEYS = {
    "cold": ["rimeImp", "hoarfrostSprite", "frostStalker", "rimeboundCultist",
             "hailPlateGuard", "glacierBrute", "glassRevenant",
             "moraineColossus", "blizzardAssassin"],
    "sand": ["duneImp", "scorpionHusk", "dustStalker", "hourglassAutomaton",
             "windscourBandit", "dustMage", "duneSentinel", "scourScout",
             "duneBrute"],
    "ash": ["scorchRaider", "smokeMage", "sootStalker", "cinderImp",
            "cinderSentinel", "scorchWarden", "sootAssassin", "slagBrute"],
}
LEVELS = {"cold": 3, "sand": 10, "ash": 20}
SHOT_PACK = {"sand": "Bandit Doctrine", "ash": "Slope Chase"}

HELPERS = """
    const wallWait = (pred, capMs) => new Promise((res) => {
        const w0 = performance.now();
        const iv = setInterval(() => {
            let hit = false;
            try { hit = !!pred(); } catch (e) { hit = true; }
            if (hit || performance.now() - w0 > capMs) {
                clearInterval(iv);
                res(performance.now() - w0 <= capMs);
            }
        }, 100);
    });
"""

SETUP_JS = """async ([realm, keys, lvl]) => {
""" + HELPERS + """
    const SF = SNOWFLOW, reg = SF.combat.registry;
    window.__lastErr = null;
    window.onerror = (m) => { window.__lastErr = String(m); };
    let entered = false;
    const enter = SF.enterRealm(realm)
        .then(() => { entered = true; })
        .catch((e) => { window.__lastErr = "enterRealm: " + e; });
    const okEnter = await wallWait(() => entered || window.__lastErr, 60000);
    if (!entered) {
        return { realm, err: window.__lastErr || "enterRealm wall-capped",
                 okEnter };
    }
    const vis = SF.combat.enemies.vis;
    vis.stream();
    const pending = () => keys.filter(k => !vis.ready(k));
    await wallWait(() => pending().length === 0, 90000);
    // Is game time even advancing? Sample over 1 s wall.
    const g0 = reg.time;
    await new Promise(r => setTimeout(r, 1000));
    const gameDt = +(reg.time - g0).toFixed(3);
    if (SF.progression) SF.progression.level = lvl;
    const enc = SF.combat.encounters;
    enc.playerLevel = lvl;                    // fallback path too
    enc._clearAll();
    enc._nextSpawnAt = 0;                     // restore the director
    enc._nextSpawnAt2 = 0;
    return { realm, notReady: pending(), level: lvl, gameDt,
             twoAllowed: enc._twoAllowed(), err: window.__lastErr };
}"""

SIM_JS = """async ([duration, wallCapMs]) => {
    const SF = SNOWFLOW, reg = SF.combat.registry;
    const enc = SF.combat.encounters, ch = SF.character;
    const alive = () => {
        let n = 0;
        for (let i = 0; i < reg.count; i++) {
            if (reg.hp[i] <= 0) continue;
            const k = reg.kind[i];
            if (k === "enemy" || k === "boss") n++;
        }
        return n;
    };
    const packs0 = enc.packsSpawned;
    const t0 = reg.time;
    const w0 = performance.now();
    let lastHop = t0, samples = 0, sum = 0, peak = 0;
    let lastNonZero = t0, longestGap = 0;
    let wallTimedOut = false;
    await new Promise((res) => {
        const iv = setInterval(() => {
            try {
                const t = reg.time;
                if (t - t0 >= duration) { clearInterval(iv); return res(); }
                if (performance.now() - w0 > wallCapMs) {
                    wallTimedOut = true;
                    clearInterval(iv);
                    return res();
                }
                const n = alive();
                samples++; sum += n; if (n > peak) peak = n;
                if (n > 0) lastNonZero = t;
                else if (t - lastNonZero > longestGap) {
                    longestGap = t - lastNonZero;
                }
                if (t - lastHop >= 6) {           // ~6 s: hop 40 m ahead
                    lastHop = t;
                    const f = ch.facing;
                    const fx = Math.sin(f), fz = -Math.cos(f);
                    const nx = ch.position.x + fx * 40;
                    const nz = ch.position.z + fz * 40;
                    ch.position.x = nx;
                    ch.position.z = nz;
                    ch.position.y = SF.terrain.heightAt(nx, nz) + 1;
                    if (ch.velocity) ch.velocity.set(0, 0, 0);
                }
            } catch (e) {
                window.__lastErr = "sim: " + e;
                wallTimedOut = true;
                clearInterval(iv);
                res();
            }
        }, 100);
    });
    return {
        packs: enc.packsSpawned - packs0,
        peak,
        mean: +(sum / Math.max(1, samples)).toFixed(2),
        longestGap: +longestGap.toFixed(1),
        samples,
        gameSecs: +(reg.time - t0).toFixed(1),
        wallTimedOut,
        aliveEnd: alive(),
        packNames: [enc._slots[0].name, enc._slots[1].name],
        err: window.__lastErr,
    };
}"""

SHOT_JS = """async ([packName]) => {
""" + HELPERS + """
    const SF = SNOWFLOW, reg = SF.combat.registry;
    const enc = SF.combat.encounters, ch = SF.character;
    if (!enc.spawnPack(packName)) return { err: "spawnPack refused " + packName };
    const sl = enc._slots[0];
    const okLive = await wallWait(() => sl.live >= 3, 30000);
    if (sl.live < 3) return { err: "pack never reached 3 live", live: sl.live };
    // Wake the pack so the shot shows animated units, not spawn idle.
    for (let k = 0; k < sl.mIds.length; k++) {
        const id = sl.mIds[k];
        if (id > 0) reg.damage(id, 1, {});
    }
    // Face the anchor and stand 18 m from it so the pack fills the view.
    const px = ch.position.x, pz = ch.position.z;
    const f = Math.atan2(sl.x - px, -(sl.z - pz));
    ch.facing = f;
    SF.rig.yaw = f;            // the camera looks along rig.yaw, not facing
    if (typeof SF.rig.pitch === "number") SF.rig.pitch = 0.12;
    const fx = Math.sin(f), fz = -Math.cos(f);
    const nx = sl.x - fx * 18, nz = sl.z - fz * 18;
    ch.position.x = nx;
    ch.position.z = nz;
    ch.position.y = SF.terrain.heightAt(nx, nz) + 1;
    if (ch.velocity) ch.velocity.set(0, 0, 0);
    await new Promise(r => setTimeout(r, 1500));
    return { ok: true, pack: packName, live: sl.live,
             anchor: [+sl.x.toFixed(1), +sl.z.toFixed(1)] };
}"""


def main():
    from playwright.sync_api import sync_playwright

    SHOTS.mkdir(exist_ok=True)
    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    results = {}
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.on("pageerror",
                  lambda e: print("PAGEERROR:", e, flush=True))
            pg.on("console",
                  lambda m: print("CONSOLE-ERR:", m.text[:300], flush=True)
                  if m.type == "error" else None)
            print("boot: goto", flush=True)
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=120000)
            pg.wait_for_timeout(2500)
            print("boot: SNOWFLOW live", flush=True)

            for realm in ("cold", "sand", "ash"):
                setup = pg.evaluate(
                    SETUP_JS, [realm, REALM_KEYS[realm], LEVELS[realm]])
                print(f"== {realm} setup: {json.dumps(setup)}", flush=True)
                if setup.get("err"):
                    results[realm] = {"packs": 0, "peak": 0, "mean": 0,
                                      "longestGap": 999, "setup": setup}
                    continue
                row = pg.evaluate(SIM_JS, [90, 300000])
                row["setup"] = setup
                results[realm] = row
                print(f"== {realm} sim:   {json.dumps(row)}", flush=True)
                if realm in SHOT_PACK:
                    shot = pg.evaluate(SHOT_JS, [SHOT_PACK[realm]])
                    print(f"== {realm} shot:  {json.dumps(shot)}", flush=True)
                    path = SHOTS / f"density_{realm}.png"
                    pg.screenshot(path=str(path))
                    results[realm]["shot"] = shot
                    print(f"   -> {path}", flush=True)
            br.close()
    finally:
        srv.terminate()

    ok = True
    for realm, row in results.items():
        checks = []
        if realm in ("sand", "ash"):
            checks.append(("packs>=2", row["packs"] >= 2))
        checks.append(("mean>=3", row["mean"] >= 3))
        checks.append(("gap<=25", row["longestGap"] <= 25))
        bad = [c for c, v in checks if not v]
        line = "PASS" if not bad else "FAIL(" + ",".join(bad) + ")"
        if bad:
            ok = False
        print(f"{realm}: {line}  packs={row['packs']} peak={row['peak']} "
              f"mean={row['mean']} gap={row['longestGap']}s", flush=True)
    print("RESULT:", "PASS" if ok else "FAIL", flush=True)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
