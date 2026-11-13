# -*- coding: utf-8 -*-
"""
gap_fireball.py -- live proof of the ASH FIREBALL (spell key 1 thrown variant).

Claims under test (commit a34d64e9 + realm-invariance constraint):
  A. cold baseline: crescent ignites at the feet (~1.1 m), hits a heavy at
     6 m for the full-env wave number, with knockback displacement.
  B. ash: cast(1) THROWS a carrier ~5 m (ignite origin >= 3 m from caster),
     the crescent then exists and travels.
  C. the crescent's damage is realm-invariant: an enemy at the same distance
     FROM THE IGNITE ORIGIN takes the same per-hit amount (within 15%) in
     ash as in cold. (Damage is level-independent in registry.damage — HP
     scales with level, incoming spell damage does not.)
  D. knockback displacement present in ash on a HEAVY (scorchWarden;
     the ash bosses are TIER.BOSS = KB_FRAC 0.0 by design).
  E. edge case: point-blank (1.2 m) cast in ash must still hit (birth pass).

Enemies are NOT woken: waking a 3 m/s heavy lets it close ~3 m during the
0.71 s strike delay + flight, destroying the 6 m geometry. KB consumption is
state-independent (enemies.js:1054-1071 runs before the AI state machine),
so a stun-pinned idle body still takes and shows knockback displacement.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[3]
PORT = 8818
GAME_URL = f"http://localhost:{PORT}/games/driftwake/index.html?autoplay"
SHOTS = Path(__file__).resolve().parents[1] / "_shots"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

INSTALL_JS = """() => {
    const SF = globalThis.SNOWFLOW;
    const reg = SF.combat.registry;
    if (!reg.__wrap) {
        reg.__wrap = true;
        const orig = reg.damage.bind(reg);
        window.__dmg = [];
        reg.damage = (id, amt, o) => {
            const dealt = orig(id, amt, o);
            window.__dmg.push({ id, amt, tag: (o && o.tag) || null,
                                dealt, t: reg.time });
            return dealt;
        };
    }
    window.__gameWait = (sec) => new Promise((res) => {
        const t0 = reg.time;
        const tick = () => (reg.time - t0 >= sec) ? res()
            : requestAnimationFrame(tick);
        tick();
    });
    window.__quiet = () => {
        SF.combat.encounters._nextSpawnAt = 1e9;
        SF.combat.encounters._clearAll();
        SF.combat.enemies.clear();
    };
    return true;
}"""

SETUP_JS = """(args) => {
    const SF = globalThis.SNOWFLOW;
    const reg = SF.combat.registry;
    window.__quiet();
    const ch = SF.character;
    const a = SF.spells.aim;
    const fl = Math.hypot(a.x, a.z) || 1;
    const dx = a.x / fl, dz = a.z / fl;
    const ex = ch.position.x + dx * args.dist;
    const ez = ch.position.z + dz * args.dist;
    const id = SF.combat.enemies.spawn(args.key, ex, ez, args.level);
    if (id <= 0) return { err: 'spawn failed ' + args.key + ' -> ' + id };
    const s = reg.slot(id);
    // Pin in place: the geometry must hold through the cast. Direct array
    // write, not damage() — no DR window consumed, no CC event.
    reg.stunUntil[s] = reg.time + 120;
    SF.progression.unlocked.add(1);
    ch.mana = ch.manaMax || 64;
    SF.spells._cdUntil[1] = 0;
    window.__dmg = [];
    return { id, hp0: +reg.hp[s].toFixed(2), tier: reg.tier[s],
             name: reg.name[s], dist: args.dist };
}"""

CAST_JS = """(args) => {
    const SF = globalThis.SNOWFLOW;
    const reg = SF.combat.registry;
    const sw = SF.spells.sweep;
    const ch = SF.character;
    const R = window.__run = {
        castT: reg.time, castX: ch.position.x, castZ: ch.position.z,
        sawPend: false, pendT0: -1, pendT1: -1,
        ignite: null, reachMax: 0, samples: [], done: false,
        flightFrozen: false, boomFrozen: false, shots: !!args.shots,
    };
    SF.spells.cast(1);
    const tick = () => {
        if (R.done) return;
        if (sw._pendSlot >= 0) {
            R.sawPend = true;
            if (R.pendT0 < 0) R.pendT0 = reg.time;
            R.pendT1 = reg.time;
            // Freeze MID-flight (~2 m out), not on the launch frame where
            // the carrier is still inside the character's silhouette.
            if (R.shots && !R.flightFrozen && reg.time - R.pendT0 >= 0.09) {
                R.flightFrozen = true;
                SF.S.freezeTime = true;      // hold the carrier for the shot
            }
        }
        if (sw.active) {
            if (!R.ignite) R.ignite = { ox: sw.ox, oz: sw.oz, t: reg.time };
            if (sw.reach > R.reachMax) R.reachMax = sw.reach;
            if (R.shots && !R.flightFrozen) R.flightFrozen = true; // landed early
            if (R.shots && !R.boomFrozen && sw.t >= 0.5) {
                R.boomFrozen = true;
                SF.S.freezeTime = true;      // hold the detonation for the shot
            }
        }
        const s = reg.slot(args.id);
        if (s >= 0 && R.samples.length < 6000) {
            R.samples.push([reg.time,
                Math.hypot(reg.x[s] - R.castX, reg.z[s] - R.castZ)]);
        }
        requestAnimationFrame(tick);
    };
    tick();
    return true;
}"""

COLLECT_JS = """async (args) => {
    const SF = globalThis.SNOWFLOW;
    const reg = SF.combat.registry;
    const R = window.__run;
    const hit = () => window.__dmg.find(
        e => e.tag === 'wave' && e.id === args.id);
    const t0 = reg.time;
    while (!hit() && reg.time - t0 < args.waitS) {
        await window.__gameWait(0.05);
    }
    const h = hit();
    if (h) await window.__gameWait(1.0);     // let the KB impulse play out
    R.done = true;
    const s = reg.slot(args.id);
    let radialAtHit = null, radialMax = null;
    if (h) {
        for (const [t, r] of R.samples) {
            if (t <= h.t) radialAtHit = r;
            else if (t <= h.t + 1.0) {
                radialMax = Math.max(radialMax === null ? -1 : radialMax, r);
            }
        }
    }
    const allWave = window.__dmg.filter(
        e => e.tag === 'wave' && e.id === args.id);
    const en = SF.combat.enemies;
    let planted = null;
    for (let i = 0; i < en.id.length; i++) {
        if (en.id[i] === args.id && en.alive[i]) { planted = en.planted[i]; break; }
    }
    return {
        sawPend: R.sawPend,
        pendFlightS: R.pendT0 >= 0 ? +(R.pendT1 - R.pendT0).toFixed(3) : null,
        igniteDist: R.ignite ? +Math.hypot(
            R.ignite.ox - R.castX, R.ignite.oz - R.castZ).toFixed(3) : null,
        igniteDelayS: R.ignite ? +(R.ignite.t - R.castT).toFixed(3) : null,
        reachMax: +R.reachMax.toFixed(2),
        hit: h ? { amt: +h.amt.toFixed(3), dealt: +h.dealt.toFixed(3),
                   tAfterCast: +(h.t - R.castT).toFixed(3) } : null,
        nWaveHits: allWave.length,
        hp1: s >= 0 ? +reg.hp[s].toFixed(2) : null,
        radialAtHit: radialAtHit !== null ? +radialAtHit.toFixed(3) : null,
        radialMax1s: radialMax !== null ? +radialMax.toFixed(3) : null,
        kbDisp: (radialAtHit !== null && radialMax !== null)
            ? +(radialMax - radialAtHit).toFixed(3) : null,
        stagger: (h && s >= 0) ? reg.staggerUntil[s] > h.t : null,
        planted,
    };
}"""

ENTER_REALM_JS = """async (name) => {
    await globalThis.SNOWFLOW.enterRealm(name);
    globalThis.SNOWFLOW.combat.enemies.vis.stream();
    return true;
}"""


def run_case(pg, label, key, level, dist, shots=False):
    setup = pg.evaluate(SETUP_JS, {"key": key, "level": level, "dist": dist})
    if "err" in setup:
        print(f"[{label}] SETUP-FAIL {json.dumps(setup)}")
        return None
    pg.evaluate(CAST_JS, {"id": setup["id"], "shots": shots})
    if shots:
        pg.wait_for_function("() => window.__run.flightFrozen === true",
                             timeout=120000)
        pg.screenshot(path=str(SHOTS / "gap_fireball_flight.png"))
        pg.evaluate("() => { SNOWFLOW.S.freezeTime = false; }")
        pg.wait_for_function("() => window.__run.boomFrozen === true",
                             timeout=120000)
        pg.screenshot(path=str(SHOTS / "gap_fireball_boom.png"))
        pg.evaluate("() => { SNOWFLOW.S.freezeTime = false; }")
    res = pg.evaluate(COLLECT_JS, {"id": setup["id"], "waitS": 4.0})
    res["setup"] = setup
    print(f"[{label}] {json.dumps(res)}")
    return res


def within(a, b, frac):
    if a is None or b is None:
        return False
    return abs(a - b) <= frac * max(abs(a), abs(b))


def main():
    from playwright.sync_api import sync_playwright

    SHOTS.mkdir(exist_ok=True)
    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    ok = True
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False,
                                    args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=180000)
            pg.wait_for_timeout(2500)
            pg.evaluate(INSTALL_JS)

            if "--shots-only" in sys.argv:
                # Retake the two screenshots from the ash 6 m case only;
                # the verdict battery is unchanged by this mode.
                pg.evaluate(ENTER_REALM_JS, "ash")
                pg.wait_for_function(
                    "() => SNOWFLOW.combat.enemies.vis.stats.types >= 8",
                    timeout=240000)
                run_case(pg, "ash6-shots", "scorchWarden", 18, 6.0,
                         shots=True)
                print("\nRESULT: SHOTS-ONLY DONE")
                br.close()
                return

            # ---- COLD BASELINE A: heavy at 6 m -------------------------
            cold6 = run_case(pg, "cold6", "hailPlateGuard", 1, 6.0)
            if not cold6 or not cold6["hit"]:
                print("FAIL: cold baseline produced no wave hit")
                ok = False
            d_cold = cold6["igniteDist"] if cold6 else None
            if d_cold is None or d_cold > 2.0:
                print(f"FAIL: cold ignite origin {d_cold} m (expected ~1.1)")
                ok = False

            # ---- ASH: same 6 m (task-literal), with screenshots --------
            pg.evaluate(ENTER_REALM_JS, "ash")
            pg.wait_for_function(
                "() => SNOWFLOW.combat.enemies.vis.stats.types >= 8",
                timeout=240000)
            ash6 = run_case(pg, "ash6", "scorchWarden", 18, 6.0, shots=True)
            if not ash6:
                ok = False
            else:
                if not ash6["sawPend"]:
                    print("FAIL (a): no carrier throw observed in ash")
                    ok = False
                if ash6["igniteDist"] is None or ash6["igniteDist"] < 3.0:
                    print(f"FAIL (a): ash ignite {ash6['igniteDist']} m < 3")
                    ok = False
                if ash6["igniteDist"] is None or ash6["reachMax"] <= 2.0:
                    print("FAIL (b): crescent did not exist/travel")
                    ok = False

            d_ash = ash6["igniteDist"] if ash6 else 5.2
            phaseA = 6.0 - (d_cold if d_cold else 1.1)   # cold6 phase (~4.9)
            phase6 = 6.0 - d_ash                          # ash6 phase (~0.8)

            # ---- ASH phase-matched: same distance FROM IGNITE as cold6 -
            ashF = run_case(pg, "ashFar", "scorchWarden", 18, d_ash + phaseA)

            # ---- ASH boss damage-only (task-named furnaceGuardian) -----
            ashB = run_case(pg, "ashBoss", "furnaceGuardian", 18,
                            d_ash + phaseA)

            # ---- ASH point-blank edge case -----------------------------
            ashPB = run_case(pg, "ashPointBlank", "scorchWarden", 18, 1.2)

            # ---- COLD phase-matched with ash6 (~origin+0.8 m) ----------
            pg.evaluate(ENTER_REALM_JS, "cold")
            pg.wait_for_function(
                "() => SNOWFLOW.combat.enemies.vis.stats.types >= 8",
                timeout=240000)
            coldN = run_case(pg, "coldNear", "hailPlateGuard", 1,
                             (d_cold if d_cold else 1.1) + phase6)

            # ================= verdicts =================================
            print("\n---- VERDICTS ----")
            if cold6 and cold6["hit"]:
                print(f"cold6: dmg={cold6['hit']['amt']} kbDisp={cold6['kbDisp']} "
                      f"igniteDist={cold6['igniteDist']} stagger={cold6['stagger']}")
                if not (cold6["kbDisp"] and cold6["kbDisp"] > 0.3):
                    print("FAIL: cold KB displacement missing")
                    ok = False
            if ashF and ashF["hit"] and cold6 and cold6["hit"]:
                m = within(ashF["hit"]["amt"], cold6["hit"]["amt"], 0.15)
                print(f"(c) phase-matched dmg ash={ashF['hit']['amt']} vs "
                      f"cold={cold6['hit']['amt']} within15%={m}")
                if not m:
                    ok = False
                kb = ashF["kbDisp"] is not None and ashF["kbDisp"] > 0.3
                print(f"(d) ash KB disp={ashF['kbDisp']} (cold {cold6['kbDisp']}) "
                      f"present={kb}")
                if not kb:
                    ok = False
            else:
                print("FAIL: ash phase-matched run produced no hit")
                ok = False
            if ash6 and coldN and ash6["hit"] and coldN["hit"]:
                m = within(ash6["hit"]["amt"], coldN["hit"]["amt"], 0.15)
                print(f"(c2) 6m-literal dmg ash={ash6['hit']['amt']} vs "
                      f"coldNear={coldN['hit']['amt']} within15%={m}")
                if not m:
                    ok = False
            elif ash6 and not ash6["hit"]:
                print("FAIL: ash 6 m cast never hit the enemy")
                ok = False
            if ashB:
                if ashB["hit"] and cold6 and cold6["hit"]:
                    m = within(ashB["hit"]["amt"], cold6["hit"]["amt"], 0.15)
                    print(f"boss dmg={ashB['hit']['amt']} within15%ofCold={m} "
                          f"kbDisp={ashB['kbDisp']} (BOSS KB_FRAC=0.0 by design)")
                    if not m:
                        ok = False
                else:
                    print("FAIL: boss run produced no wave hit")
                    ok = False
            if ashPB:
                pb = ashPB["hit"] is not None and (
                    ashPB["setup"]["hp0"] - (ashPB["hp1"] or 0) > 0)
                print(f"(e) point-blank ash hit={ashPB['hit']} "
                      f"hp {ashPB['setup']['hp0']} -> {ashPB['hp1']} pass={pb}")
                if not pb:
                    print("FAIL (e): ash point-blank cast WHIFFED")
                    ok = False

            print("\nRESULT:", "PASS" if ok else "FAIL")
            br.close()
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
