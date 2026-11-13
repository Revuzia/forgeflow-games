# -*- coding: utf-8 -*-
"""
qa_shrineactivate_8905.py -- INDEPENDENT verification of the claim
"the seven-shrine respawn network is unreachable; addShrine() is never called".

This probe deliberately does NOT reuse the hunt lane's method (teleport +
die). It attacks the two ways the lane's conclusion could be a probe artifact:

  A) "the trigger needs a CONTINUOUS APPROACH, and a teleport skipped it" ->
     the probe WALKS the character in from 14 m in 0.35 m steps, one step per
     frame, straight through the shrine centre and out the far side, for every
     one of the six ring shrines, reading `lastShrineId` on every frame.
  B) "the trigger fires but the RESPAWN is what's broken" ->
     control arm: call `progression.addShrine()` by hand at a ring shrine,
     then die, and see where the respawn lands. If that arm lands ON the ring
     shrine, the respawn machinery is fine and the defect is purely the
     missing activation trigger.

Plus the plain death arm (die 8 m from a ring shrine, no hand activation) and
a dwell arm (stand ON a shrine for 6 s of GAME time).

All waits are GAME time (SNOWFLOW.combat.registry.time polled through rAF).
"""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8905
GAME_URL = "http://localhost:%d/games/driftwake/index.html?autoplay&test" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

PRELUDE = r"""
window.__sa = (function () {
    const SF = SNOWFLOW, T = SF.terrain, reg = SF.combat.registry;
    const P = SF.progression, c = SF.character;

    const rafs = (n) => new Promise((res) => {
        let k = 0;
        const t = () => { if (++k >= n) res(); else requestAnimationFrame(t); };
        requestAnimationFrame(t);
    });
    /** GAME-time wait: polls the combat registry clock, never wall-clock. */
    const gwait = (sec) => new Promise((res) => {
        const t0 = reg.time;
        const t = () => (reg.time - t0 >= sec) ? res()
            : requestAnimationFrame(t);
        requestAnimationFrame(t);
    });
    const place = (x, z) => {
        c.position.x = x; c.position.z = z;
        c.position.y = T.heightAt(x, z);
        c.velocity.set(0, 0, 0);
        c.vertVel = 0; c.airborne = false;
    };

    /**
     * Arm A -- WALK through a shrine. Steps the character along the line
     * from 14 m out to 14 m past the centre, 0.35 m per frame, sampling
     * `lastShrineId` and the min distance every frame. Any proximity /
     * touch / trigger-volume detector anywhere in the frame graph sees a
     * continuous approach that crosses every plausible radius.
     */
    const walkThrough = async (sid, sx, sz) => {
        const ang = Math.atan2(sz - c.position.z, sx - c.position.x);
        const ux = Math.cos(ang), uz = Math.sin(ang);
        place(sx - ux * 14, sz - uz * 14);
        await rafs(3);
        const before = P.lastShrineId;
        let minD = 1e9, seenIds = {}, frames = 0;
        seenIds[P.lastShrineId] = 1;
        for (let s = 0; s <= 80; s++) {
            const d = -14 + s * 0.35;
            place(sx + ux * d, sz + uz * d);
            await rafs(1);
            frames++;
            const dd = Math.hypot(c.position.x - sx, c.position.z - sz);
            if (dd < minD) minD = dd;
            seenIds[P.lastShrineId] = (seenIds[P.lastShrineId] || 0) + 1;
        }
        return { arm: "walk", shrine: sid, before, after: P.lastShrineId,
                 minDist: +minD.toFixed(3), frames,
                 idsSeen: Object.keys(seenIds),
                 shrinesKnown: Object.keys(P.shrines).length };
    };

    /** Arm A2 -- stand ON the shrine for `sec` seconds of GAME time. */
    const dwell = async (sid, sx, sz, sec) => {
        place(sx, sz);
        const t0 = reg.time;
        const before = P.lastShrineId;
        await gwait(sec);
        return { arm: "dwell", shrine: sid, before, after: P.lastShrineId,
                 gameSec: +(reg.time - t0).toFixed(2),
                 dist: +Math.hypot(c.position.x - sx,
                                   c.position.z - sz).toFixed(2) };
    };

    /** Die where you stand; wait out the 1.5 s fade in GAME time; report. */
    const dieHere = async (tag) => {
        const from = { x: c.position.x, z: c.position.z };
        const d0 = P.deaths;
        c.health = 0;
        await rafs(2);
        const deadSeen = P.dead;
        await gwait(2.4);
        await rafs(3);
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem("driftwake_save")); }
        catch (e) { saved = { err: String(e) }; }
        return {
            tag,
            from: { x: +from.x.toFixed(1), z: +from.z.toFixed(1) },
            landed: { x: +c.position.x.toFixed(2),
                      z: +c.position.z.toFixed(2) },
            lastShrineId: P.lastShrineId,
            resolved: P.shrines[P.lastShrineId] || null,
            deadSeen, deaths: P.deaths - d0,
            hpFrac: +(c.health / c.healthMax).toFixed(3),
            saveLastShrine: saved ? saved.lastShrineId : null,
        };
    };

    return { walkThrough, dwell, dieHere, place, rafs, gwait };
})();
"""


def main():
    from playwright.sync_api import sync_playwright

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2.5)
    out = {"walk": [], "dwell": [], "deaths": [], "static": {}}
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False,
                                    args=FLAGS)
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

            # ---- static surface: what IS registered, and what is callable
            out["static"] = pg.evaluate(r"""() => {
                const P = SNOWFLOW.progression;
                return {
                    shrinePositions: SNOWFLOW.shrine.positions.map(p => (
                        {id: p.id, x: +p.x.toFixed(1), z: +p.z.toFixed(1)})),
                    progressionShrines: JSON.parse(JSON.stringify(P.shrines)),
                    lastShrineIdAtBoot: P.lastShrineId,
                    hasAddShrine: typeof P.addShrine,
                    hasRegisterShrine: typeof P.registerShrine,
                    testMode: !!P.testMode,
                    level: P.level,
                };
            }""")

            ring = pg.evaluate(
                "() => SNOWFLOW.shrine.positions.slice(1).map("
                "p => [p.id, p.x, p.z])")

            # ---- ARM A: WALK straight through every ring shrine
            for sid, x, z in ring:
                out["walk"].append(pg.evaluate(
                    "([s,x,z]) => window.__sa.walkThrough(s,x,z)",
                    [sid, x, z]))

            # ---- ARM A2: dwell 6 s of GAME time on two of them
            for sid, x, z in ring[:2]:
                out["dwell"].append(pg.evaluate(
                    "([s,x,z]) => window.__sa.dwell(s,x,z,6)", [sid, x, z]))

            # ---- ARM B: die standing 8 m from ring shrine #1, no hand touch
            sid, x, z = ring[0]
            pg.evaluate("([x,z]) => window.__sa.place(x+8, z)", [x, z])
            pg.evaluate("() => window.__sa.rafs(4)")
            out["deaths"].append(pg.evaluate(
                "() => window.__sa.dieHere('no-touch@' + %s)" % json.dumps(sid)))

            # ---- ARM B2: die standing DEAD CENTRE on ring shrine #4
            sid4, x4, z4 = ring[3]
            pg.evaluate("([x,z]) => window.__sa.place(x, z)", [x4, z4])
            pg.evaluate("() => window.__sa.rafs(4)")
            out["deaths"].append(pg.evaluate(
                "() => window.__sa.dieHere('dead-centre@' + %s)"
                % json.dumps(sid4)))

            # ---- CONTROL: hand-activate via addShrine(), then die.
            #      Isolates "trigger missing" from "respawn broken".
            out["control"] = pg.evaluate(r"""async ([sid,x,z]) => {
                const P = SNOWFLOW.progression;
                P.addShrine(sid, x, z);           // the uncalled method
                const activated = P.lastShrineId;
                SNOWFLOW.character.position.x = x + 40;
                SNOWFLOW.character.position.z = z + 40;
                await window.__sa.rafs(4);
                const r = await window.__sa.dieHere('CONTROL-addShrine@' + sid);
                r.activated = activated;
                return r;
            }""", [sid4, x4, z4])

            # ---- how far is the forced respawn from where you died?
            out["distance"] = pg.evaluate(r"""() => {
                const P = SNOWFLOW.progression;
                const sp = SNOWFLOW.shrine.positions;
                const home = P.shrines.cold_spawn;
                return sp.map(p => ({ id: p.id,
                    metresFromColdSpawn: +Math.hypot(
                        p.x - home.x, p.z - home.z).toFixed(1) }));
            }""")

            print("CONSOLE ERRORS:", json.dumps(errs[:12]))
            br.close()
    finally:
        srv.terminate()

    p = Path(__file__).with_name("qa_shrineactivate_8905.out.json")
    p.write_text(json.dumps(out, indent=1), encoding="utf-8")

    s = out["static"]
    print("\n== STATIC")
    print("  lastShrineId at boot :", s["lastShrineIdAtBoot"])
    print("  typeof addShrine     :", s["hasAddShrine"])
    print("  typeof registerShrine:", s["hasRegisterShrine"])
    print("  progression.shrines  :", json.dumps(s["progressionShrines"]))
    print("  shrine.positions     :", json.dumps(s["shrinePositions"]))
    print("  testMode / level     :", s["testMode"], "/", s["level"])

    print("\n== ARM A  WALK THROUGH (0.35 m/frame, 14 m -> centre -> 14 m)")
    print("  %-12s %-12s %-12s %8s %7s  %s" % (
        "shrine", "before", "after", "minDist", "frames", "idsSeen"))
    for r in out["walk"]:
        print("  %-12s %-12s %-12s %8.3f %7d  %s" % (
            r["shrine"], r["before"], r["after"], r["minDist"], r["frames"],
            r["idsSeen"]))

    print("\n== ARM A2 DWELL ON THE SHRINE (game time)")
    for r in out["dwell"]:
        print("  ", json.dumps(r))

    print("\n== ARM B  DEATH")
    for r in out["deaths"]:
        print("  ", json.dumps(r))

    print("\n== CONTROL (hand addShrine, then die 56 m away)")
    print("  ", json.dumps(out["control"]))

    print("\n== BACKTRACK COST (metres from cold_spawn)")
    for r in out["distance"]:
        print("   %-12s %8.1f" % (r["id"], r["metresFromColdSpawn"]))
    print("\nwrote", p)


if __name__ == "__main__":
    main()
