# -*- coding: utf-8 -*-
"""
qa_respawn_8892.py -- the death/respawn matrix.

Kills the player at 8 authored places (each ring shrine, the storm edge, a
deep basin, mid-air, with a boss live, with motes in flight) and, for each,
records where the respawn LANDED versus where the NEAREST shrine was, plus the
pool/grace/counter/save invariants the hunt asks for.

Death is induced the only way the game can produce it (`character.health = 0`);
progression.update() owns the rest. The probe never calls `_respawn` directly.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8892
GAME_URL = "http://localhost:%d/games/driftwake/index.html?autoplay&test" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

PRELUDE = r"""
window.__rs = (function () {
    const SF = SNOWFLOW, T = SF.terrain, reg = SF.combat.registry;
    const P = SF.progression, c = SF.character;
    const gwait = (sec) => new Promise((res) => {
        const t0 = reg.time;
        const t = () => (reg.time - t0 >= sec) ? res()
            : requestAnimationFrame(t);
        t();
    });
    const rafs = (n) => new Promise((res) => {
        let k = 0;
        const t = () => { if (++k >= n) res(); else requestAnimationFrame(t); };
        requestAnimationFrame(t);
    });
    const nearest = (x, z) => {
        let best = null, bd = 1e9;
        for (const p of SF.shrine.positions) {
            const d = Math.hypot(p.x - x, p.z - z);
            if (d < bd) { bd = d; best = p; }
        }
        return { id: best.id, d: bd, x: best.x, z: best.z };
    };
    /** Teleport, settle, kill, wait out the fade, report. */
    const dieAt = async (tag, x, z, opts) => {
        opts = opts || {};
        c.position.x = x; c.position.z = z;
        c.position.y = T.heightAt(x, z) + (opts.air || 0);
        c.velocity.set(0, 0, 0);
        c.vertVel = opts.air ? 6 : 0;
        c.airborne = !!opts.air;
        await rafs(4);
        const from = { x: c.position.x, z: c.position.z, y: c.position.y };
        const near = nearest(from.x, from.z);
        const d0 = P.deaths;
        const hpMax = c.healthMax, mpMax = c.manaMax;
        c.health = 0;
        c.mana = 0;
        // one frame: the death edge
        await rafs(2);
        const deadSeen = P.dead;
        const deathsMid = P.deaths;
        // fade (1.5 s game time) + a margin
        await gwait(2.2);
        await rafs(3);
        const lowClass = SF.hurtFx && SF.hurtFx.el
            ? SF.hurtFx.el.classList.contains("low") : null;
        const vigOpacity = SF.hurtFx && SF.hurtFx.el
            ? (SF.hurtFx.el.style.opacity || "") : null;
        const land = { x: c.position.x, z: c.position.z, y: c.position.y };
        const groundAt = T.heightAt(land.x, land.z);
        let raw = null;
        try { raw = JSON.parse(localStorage.getItem(window.__saveKey)); }
        catch (e) { raw = { parseErr: String(e) }; }
        return {
            tag,
            realm: SF.shrine.realm,
            from: { x: +from.x.toFixed(1), z: +from.z.toFixed(1) },
            nearestShrine: near.id, nearestDist: +near.d.toFixed(1),
            landedOn: { x: +land.x.toFixed(2), z: +land.z.toFixed(2) },
            landedShrine: nearest(land.x, land.z).id,
            landedDist: +nearest(land.x, land.z).d.toFixed(2),
            lastShrineId: P.lastShrineId,
            groundErr: +(land.y - groundAt).toFixed(3),
            deadSeen, deathsDelta: P.deaths - d0, deathsMid: deathsMid - d0,
            hp: +(c.health / hpMax).toFixed(3), mp: +(c.mana / mpMax).toFixed(3),
            dead: P.dead,
            grace: +(P.graceUntil - P.time).toFixed(2),
            invuln: P.isInvulnerable(),
            airborne: c.airborne, vertVel: +c.vertVel.toFixed(2),
            speed: +Math.hypot(c.velocity.x, c.velocity.z).toFixed(3),
            hurtLow: lowClass, vigOpacity,
            saveLastShrine: raw ? raw.lastShrineId : null,
            saveDeaths: raw ? raw.deaths : null,
            savePos: raw && raw.pos
                ? { x: +(+raw.pos.x).toFixed(1), z: +(+raw.pos.z).toFixed(1),
                    realm: raw.pos.realm } : null,
            saveBossType: raw ? (Array.isArray(raw.bossesKilled)
                ? "ARRAY" : typeof raw.bossesKilled) : null,
        };
    };
    return { dieAt, gwait, rafs, nearest };
})();
window.__saveKey = "driftwake_save";   // progression.js:49 SAVE_KEY
"""


def main():
    from playwright.sync_api import sync_playwright

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2.5)
    rows = []
    extra = {}
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            errs = []
            pg.on("console", lambda m: errs.append(m.text)
                  if m.type == "error" else None)
            pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=180000)
            pg.wait_for_timeout(2500)
            pg.evaluate(PRELUDE)
            extra["saveKey"] = pg.evaluate("() => window.__saveKey")
            extra["shrines"] = pg.evaluate(
                "() => SNOWFLOW.shrine.positions.map(p => "
                "({id:p.id, x:+p.x.toFixed(1), z:+p.z.toFixed(1)}))")

            # --- 1..6: die beside each of the SIX ring shrines (cold)
            ring = pg.evaluate(
                "() => SNOWFLOW.shrine.positions.slice(1).map(p => "
                "[p.id, p.x, p.z])")
            for sid, x, z in ring:
                rows.append(pg.evaluate(
                    "([t,x,z]) => window.__rs.dieAt(t, x+6, z+6, {})",
                    ["ring:" + sid, x, z]))

            # --- 7: the storm edge (PLAY_RADIUS 620, storm in the last 55 m)
            rows.append(pg.evaluate(
                "() => window.__rs.dieAt('storm-edge', 0, 600, {})"))
            # --- 8: mid-air after a jump
            rows.append(pg.evaluate(
                "() => window.__rs.dieAt('mid-air', 120, 120, {air: 14})"))

            # --- 9: ASH deep basin
            pg.evaluate("() => SNOWFLOW.enterRealm('ash')")
            pg.wait_for_function(
                "() => SNOWFLOW.shrine.realm === 'ash'", timeout=60000)
            pg.evaluate("() => window.__rs.rafs(20)")
            pg.wait_for_timeout(600)
            basin = pg.evaluate(r"""() => {
                // scan the disc for the LOWEST macro height -- the deep basin
                const T = SNOWFLOW.terrain;
                let bx = 0, bz = 0, bh = 1e9;
                for (let r = 40; r <= 540; r += 20) {
                    for (let a = 0; a < 36; a++) {
                        const t = a * Math.PI / 18;
                        const x = Math.cos(t) * r, z = Math.sin(t) * r;
                        const h = T.heightAt(x, z);
                        if (h < bh) { bh = h; bx = x; bz = z; }
                    }
                }
                return [+bx.toFixed(1), +bz.toFixed(1), +bh.toFixed(2)];
            }""")
            extra["ashBasin"] = basin
            rows.append(pg.evaluate(
                "([x,z]) => window.__rs.dieAt('ash-basin', x, z, {})",
                [basin[0], basin[1]]))

            # --- 10: with a BOSS live (test mode lifted the level gate)
            bossInfo = pg.evaluate(r"""async () => {
                const B = SNOWFLOW.combat.bosses;
                let spawned = null;
                try { spawned = B.spawnBoss ? B.spawnBoss('mini') : 'no-api'; }
                catch (e) { spawned = 'ERR ' + e.message; }
                await window.__rs.rafs(20);
                return { spawned: String(spawned),
                         stats: JSON.parse(JSON.stringify(B.stats || {})) };
            }""")
            extra["boss"] = bossInfo
            rows.append(pg.evaluate(
                "() => window.__rs.dieAt('boss-live', "
                "SNOWFLOW.combat.bosses.ax || 60, "
                "SNOWFLOW.combat.bosses.az || 60, {})"))
            extra["bossAfterDeath"] = pg.evaluate(
                "() => JSON.parse(JSON.stringify("
                "SNOWFLOW.combat.bosses.stats || {}))")

            # --- 11: with motes in flight
            rows.append(pg.evaluate(r"""async () => {
                const c = SNOWFLOW.character;
                SNOWFLOW.motes.spawnAt(c.position.x + 3, c.position.z + 3, 8);
                await window.__rs.rafs(3);
                const before = JSON.parse(JSON.stringify(
                    SNOWFLOW.motes.stats));
                const r = await window.__rs.dieAt('motes-in-flight',
                    c.position.x, c.position.z, {});
                r.motesBefore = before;
                r.motesAfter = JSON.parse(JSON.stringify(SNOWFLOW.motes.stats));
                return r;
            }"""))

            # --- 12: consecutive deaths -- can the respawn kill you again?
            extra["deathLoop"] = pg.evaluate(r"""async () => {
                const P = SNOWFLOW.progression, c = SNOWFLOW.character;
                const d0 = P.deaths;
                const seq = [];
                for (let i = 0; i < 3; i++) {
                    c.health = 0;
                    await window.__rs.gwait(2.2);
                    seq.push({ hp: +(c.health / c.healthMax).toFixed(2),
                               deaths: P.deaths - d0,
                               x: +c.position.x.toFixed(1),
                               z: +c.position.z.toFixed(1),
                               dead: P.dead });
                }
                // then stand for 6 s and see whether anything re-kills us
                await window.__rs.gwait(6);
                seq.push({ afterStand: true,
                           hp: +(c.health / c.healthMax).toFixed(2),
                           deaths: P.deaths - d0, dead: P.dead });
                return seq;
            }""")

            # --- bossesKilled container type, the newGame() path
            extra["bossFlagProbe"] = pg.evaluate(r"""() => {
                const P = SNOWFLOW.progression;
                const before = { isArray: Array.isArray(P.bossesKilled),
                                 keys: Object.keys(P.bossesKilled) };
                P.newGame();
                const after = { isArray: Array.isArray(P.bossesKilled) };
                // emulate bossEncounters.js:674 -- p.bossesKilled[k] = true
                P.bossesKilled["cold_mini"] = true;
                P.save();
                const raw = localStorage.getItem(window.__saveKey);
                const parsed = JSON.parse(raw);
                P.load();
                return { before, after,
                         liveAfterSet: JSON.stringify(P.bossesKilled),
                         serialised: JSON.stringify(parsed.bossesKilled),
                         afterReload: JSON.stringify(P.bossesKilled),
                         flagSurvives: !!(P.bossesKilled
                             && P.bossesKilled["cold_mini"]) };
            }""")

            print("CONSOLE ERRORS:", json.dumps(errs[:12]))
            br.close()
    finally:
        srv.terminate()

    out = Path(__file__).with_name("qa_respawn_8892.out.json")
    out.write_text(json.dumps({"rows": rows, "extra": extra}, indent=1),
                   encoding="utf-8")
    print("wrote", out)

    print("\nsaveKey =", extra.get("saveKey"))
    print("\n== RESPAWN MATRIX")
    print("%-22s %-5s %-24s %-11s %-11s %8s %6s %5s %5s %5s %6s" % (
        "tag", "realm", "died at", "nearest", "landed@", "dist", "grndE",
        "hp", "mp", "dths", "grace"))
    for r in rows:
        print("%-22s %-5s (%7.1f,%7.1f) %-11s %-11s %8.2f %6.2f %5.2f %5.2f "
              "%5d %6.2f" % (
                  r["tag"], r["realm"], r["from"]["x"], r["from"]["z"],
                  r["nearestShrine"], r["landedShrine"], r["landedDist"],
                  r["groundErr"], r["hp"], r["mp"], r["deathsDelta"],
                  r["grace"]))
    print("\n== DETAIL")
    for r in rows:
        print(" ", json.dumps({k: r[k] for k in (
            "tag", "nearestShrine", "nearestDist", "landedOn", "lastShrineId",
            "saveLastShrine", "saveDeaths", "savePos", "saveBossType",
            "airborne", "vertVel", "speed", "hurtLow", "vigOpacity",
            "deadSeen", "deathsMid", "invuln")}))
    print("\n== ASH BASIN:", extra.get("ashBasin"))
    print("== BOSS:", json.dumps(extra.get("boss"))[:600])
    print("== BOSS AFTER DEATH:", json.dumps(extra.get("bossAfterDeath"))[:600])
    print("\n== DEATH LOOP:", json.dumps(extra.get("deathLoop")))
    print("\n== bossesKilled CONTAINER:",
          json.dumps(extra.get("bossFlagProbe"), indent=1))


if __name__ == "__main__":
    main()
