# -*- coding: utf-8 -*-
"""
qa_boss.py -- the laneB verification probe (port 8872).

Everything it asserts is an OBSERVED EFFECT in the live game, on GAME time
(SNOWFLOW.combat.registry.time + rAF), never a wall-clock sleep for game state:

  A  MINI BOSS, cold, player level 6
     - teleport-walk the player 40 m every couple of seconds; the event must
       go idle -> pending -> live inside 60 s of simulated travel
     - the bottom-centre boss bar carries the boss's NAME (registry kind
       'boss' + name is what ui/enemybars.js binds to)
     - damage it to 54% HP -> phase 2 flags: speed up, second pattern open
     - drag it out of the arena -> leash return + the 20% regen tick
  C  RHYTHM, six real roam spawns
     - bearing spread across the wheel > 120 deg total
     - at least two distinct compositions
     - cadence (breather) variance > 1.5 s, driven by real clears
  B  REALM BOSS, player level 8
     - force the event, kill it -> the portal rises, tinted for sand
     - walk into it -> realm becomes 'sand', realmsUnlocked has sand,
       bossesKilled carries the flag
  Screenshots: _shots/qa_boss_intro.png / _phase2.png / _portal.png

Run:  python _harness/qa_boss.py
"""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
GAME = HERE.parent
ROOT = HERE.parents[2]                      # repo root == server root
PORT = 8872
URL = f"http://localhost:{PORT}/games/driftwake/index.html?autoplay"
SHOTS = GAME / "_shots"

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

# --------------------------------------------------------------- js helpers
# gameWait is the ONLY wait used for game state: registry.time advances with
# the game's own dt, so a frozen or hitching frame cannot make a wait "pass".
PRELUDE = """
const SF = globalThis.SNOWFLOW;
const R = SF.combat.registry, B = SF.combat.bosses, E = SF.combat.encounters;
const C = SF.character, T = SF.terrain;
const gameWait = (sec) => new Promise((res) => {
    const t0 = R.time;
    const tick = () => (R.time - t0 >= sec) ? res() : requestAnimationFrame(tick);
    tick();
});
const walk = (m) => {
    // A player would not walk into the storm wall: past 380 m out, turn back
    // toward the field before stepping, so the travel stays inside the world.
    const r = Math.hypot(C.position.x, C.position.z);
    if (r > 380) C.facing = Math.atan2(-C.position.x, C.position.z);
    const fx = Math.sin(C.facing), fz = -Math.cos(C.facing);
    C.position.x += fx * m; C.position.z += fz * m;
    T.clampToPlayArea(C.position);
    C.position.y = T.heightAt(C.position.x, C.position.z);
};
const put = (x, z) => {
    C.position.x = x; C.position.z = z;
    T.clampToPlayArea(C.position);
    C.position.y = T.heightAt(C.position.x, C.position.z);
};
"""

fails = []
notes = []


def check(name, ok, detail=""):
    (notes if ok else fails).append(f"{'PASS' if ok else 'FAIL'}  {name}"
                                    + (f"  [{detail}]" if detail else ""))
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))


def ev(pg, body):
    """Evaluate an async JS body with the prelude in scope."""
    return pg.evaluate("(async () => {" + PRELUDE + body + "})()")


def shot(pg, name):
    SHOTS.mkdir(exist_ok=True)
    p = SHOTS / f"qa_boss_{name}.png"
    pg.screenshot(path=str(p))
    print(f"       shot -> {p}")


def frame_shot(pg, name, subject_js, dist=8.0):
    """Clean-frame recipe: stand the player `dist` SOUTH of the subject with
    rig.yaw 0 (the boot camera bearing looks -z, so the subject is dead
    ahead), let the camera spring settle, RE-SEAT once because both the
    surf controller and the boss keep moving while it settles, then freeze
    time for the exposure so the shot is the frame we aimed."""
    ev(pg, f"""
        // The rig follows the player through a SPRING (core/camera.js
        // springDamp). A teleport leaves that spring carrying a huge pivot
        // velocity, and a shot taken while it unwinds frames empty snow with
        // the player somewhere behind the lens. `_first` is the rig's own
        // snap flag — set it and the next update copies the pivot exactly.
        const seat = () => {{
            C.velocity.set(0, 0, 0);
            C.facing = 0;
            SF.rig.yaw = 0;
            SF.rig.distanceTarget = 5.0;
            SF.rig.distance = 5.0;
            SF.rig.pivotVel.set(0, 0, 0);
            SF.rig._first = true;
        }};
        const s1 = ({subject_js});
        put(s1.x, s1.z + {dist});
        seat();
        await gameWait(0.5);
        const s2 = ({subject_js});      // the subject moved while we settled
        put(s2.x, s2.z + {dist});
        seat();
        await gameWait(0.25);
        SF.S.freezeTime = true;     // last: gameWait cannot advance after this
        return true;
    """)
    shot(pg, name)
    pg.evaluate("SNOWFLOW.S.freezeTime = false")


BOSS_POS = ("(() => { const s = R.slot(B.bossId);"
            " return s >= 0 ? { x: R.x[s], z: R.z[s] }"
            " : { x: B.ax, z: B.az }; })()")
PORTAL_POS = "({ x: SF.portal.x, z: SF.portal.z })"


def main():
    from playwright.sync_api import sync_playwright

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.0)
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=180000)
            pg.wait_for_timeout(2500)

            # ---------------------------------------------------- A: mini boss
            print("\n== A. mini boss, cold, level 6")
            start = ev(pg, """
                SF.S.combatEnemies = false;         // isolate: no ambient packs
                SF.progression.level = 6;
                B.clearBoss();
                B.realm = 'cold';
                await gameWait(0.5);
                return { t0: R.time, state: B.stats.state, lvl: SF.progression.level,
                         key: B.stats.key, roster: B.stats };
            """)
            t0 = start["t0"]

            live = None
            for _ in range(30):
                st = ev(pg, "walk(40); await gameWait(1.6); return B.stats;")
                if st["state"] == "live":
                    live = st
                    break
            elapsed = ev(pg, f"return R.time - {t0};")
            check("mini boss fired", live is not None,
                  f"game t={elapsed:.1f}s state="
                  f"{(live or ev(pg, 'return B.stats;'))['state']}")
            check("fired inside 60 s of travel", live is not None and elapsed <= 60,
                  f"{elapsed:.1f} s")
            if live:
                print("       " + json.dumps({k: live[k] for k in (
                    "kind", "key", "name", "level", "hpMax", "poiseMax",
                    "arenaGrade", "patternP1", "patternAll", "speedBase")}))
                check("event kind is mini", live["kind"] == "mini")
                check("registry kind is boss", live["registryKind"] == "boss",
                      str(live["registryKind"]))
                check("boss bar carries the name",
                      bool(live["barName"]) and live["barName"] == live["name"],
                      str(live["barName"]))
                check("arena is flat", live["arenaGrade"] < 0.35,
                      f"grade {live['arenaGrade']:.3f}")
                # The DOM the player actually reads. ui/enemybars.js gates its
                # whole update on `input.locked` — pointer lock, which
                # automation can never produce — so the flag is stubbed true
                # for the read and put back after. Everything else on the path
                # (the registry scan, the name write, the `.on` class) is the
                # shipping code.
                bar = pg.evaluate("""(async () => {
                    const was = SNOWFLOW.input.locked;
                    SNOWFLOW.input.locked = true;
                    await new Promise(r => requestAnimationFrame(
                        () => requestAnimationFrame(r)));
                    const el = document.querySelector('#enemybars .bossbar');
                    const nm = document.querySelector('#enemybars .boss-name');
                    const out = { on: !!(el && el.classList.contains('on')),
                                  text: nm ? nm.textContent : null };
                    SNOWFLOW.input.locked = was;
                    return out;
                })()""")
                check("boss bar visible in the DOM", bar["on"] and
                      bar["text"] == live["name"], json.dumps(bar))

                # intro screenshot, camera on the LIVE boss
                frame_shot(pg, "intro", BOSS_POS)

                # ---- phase 2 -------------------------------------------
                ph = ev(pg, """
                    const before = B.stats;
                    for (let n = 0; n < 400; n++) {
                        const s = R.slot(B.bossId);
                        if (s < 0 || R.hp[s] / R.hpMax[s] <= 0.54) break;
                        R.damage(B.bossId, 30, {});
                    }
                    await gameWait(0.4);
                    return { before, after: B.stats };
                """)
                a, b4 = ph["after"], ph["before"]
                check("phase 2 opened at <= 55% HP", a["phase"] == 2,
                      f"hpFrac {a['hpFrac']:.3f} thr {a['phase2Pct']}")
                check("phase 2 speeds the boss up",
                      a["speedNow"] > b4["speedNow"],
                      f"{b4['speedNow']:.2f} -> {a['speedNow']:.2f} m/s")
                check("phase 2 opens the second pattern",
                      a["patternNow"] > b4["patternNow"],
                      f"{b4['patternNow']} -> {a['patternNow']} of "
                      f"{a['patternAll']} usable")
                frame_shot(pg, "phase2", BOSS_POS)

                # ---- leash + regen -------------------------------------
                ax, az = a["arenaX"], a["arenaZ"]
                ev(pg, f"put({ax} + 75, {az}); return true;")
                leash = None
                for _ in range(24):
                    s = ev(pg, "await gameWait(2.0); return B.stats;")
                    if s["leashReturns"] > 0:
                        leash = s
                        break
                check("leash returned the boss to its arena", leash is not None,
                      "" if leash else json.dumps(ev(pg, "return B.stats;")))
                if leash:
                    check("leash regen tick is 20% of max HP",
                          abs(leash["lastRegenFrac"] - 0.20) < 0.02,
                          f"{leash['lastRegenFrac']:.3f}")
                    check("boss is back inside the leash radius",
                          leash["arenaDist"] < 5.0,
                          f"{leash['arenaDist']:.1f} m")
                    check("boss healed by the regen",
                          leash["hpFrac"] > a["hpFrac"],
                          f"{a['hpFrac']:.3f} -> {leash['hpFrac']:.3f}")

            # ------------------------------------------------------- C: rhythm
            print("\n== C. encounter rhythm (6 roam spawns)")
            ev(pg, """
                B.clearBoss();
                SF.S.combatEnemies = true;
                SF.progression.level = 10;
                C.health = C.healthMax;
                await gameWait(0.5);
                return true;
            """)
            for i in range(6):
                ev(pg, f"""
                    E._nextSpawnAt = 1e9; E._nextSpawnAt2 = 1e9;
                    E.spawnRoam(false);
                    // the §6.1 stagger is 0.5-2 s PER MEMBER: wait for the
                    // whole queue to fire, or the pack can never END and no
                    // cadence is ever recorded.
                    for (let n = 0; n < 60; n++) {{
                        const sl = E._slots[0];
                        if (sl.qCount === 0 && sl.live > 0) break;
                        await gameWait(0.5);
                    }}
                    // Odd rounds cost the player heavy damage (>18% of 100),
                    // even rounds are clean — the two cadence reads.
                    if ({i} % 2 === 1) C.health = Math.max(1, C.health - 35);
                    for (let sweep = 0; sweep < 3; sweep++) {{
                        for (let n = R.count - 1; n >= 0; n--) {{
                            if (R.kind[n] === 'enemy' && R.hp[n] > 0)
                                R.damage(R.idOf[n], 9999, {{}});
                        }}
                        await gameWait(0.6);
                    }}
                    await gameWait(1.2);              // pack-end bookkeeping
                    C.health = C.healthMax;
                    await gameWait(0.4);
                    return true;
                """)
            rh = pg.evaluate("""(() => {
                const r = SNOWFLOW.combat.encounters.rhythm;
                return { n: r.n, cadenceN: r.cadenceN,
                         offset: Array.from(r.offset),
                         bearing: Array.from(r.bearing),
                         comp: r.comp.slice(),
                         cadence: Array.from(r.cadence),
                         excitement: r.excitement,
                         fodderUnits: SNOWFLOW.combat.encounters.fodderPressureUnits };
            })()""")
            n = min(rh["n"], len(rh["offset"]))
            offs = [o for o in rh["offset"][:n]]
            spread = (max(offs) - min(offs)) * 180 / 3.14159265 if offs else 0
            comps = [c for c in rh["comp"][:n] if c]
            cads = [c for c in rh["cadence"] if c >= 0]
            var = (max(cads) - min(cads)) if cads else 0
            print("       offsets(deg): " +
                  ", ".join(f"{o * 180 / 3.14159265:.0f}" for o in offs))
            print("       cadences(s):  " + ", ".join(f"{c:.2f}" for c in cads))
            for c in sorted(set(comps)):
                print("       comp: " + c)
            check("spawns recorded", rh["n"] >= 6, f"n={rh['n']}")
            check("bearing spread > 120 deg", spread > 120, f"{spread:.0f} deg")
            check("at least 2 distinct compositions", len(set(comps)) >= 2,
                  f"{len(set(comps))} distinct")
            check("cadence variance > 1.5 s", var > 1.5,
                  f"{var:.2f} s over {len(cads)} clears")
            check("fodder pressure stamped melee fodder records",
                  rh["fodderUnits"] > 0, f"{rh['fodderUnits']} units")

            # -------------------------------------------------- B: realm boss
            print("\n== B. realm boss + portal, level 8")
            rb = ev(pg, """
                SF.S.combatEnemies = false;
                SF.progression.level = 8;
                put(80, 80);                     // back to the field's interior
                C.facing = 0;
                B.clearBoss();
                for (let n = R.count - 1; n >= 0; n--)
                    if (R.kind[n] !== 'dummy') R.remove(R.idOf[n]);
                const ok = B.spawnBoss('realm');
                await gameWait(0.5);
                return { ok, stats: B.stats };
            """)
            st = rb["stats"]
            check("realm boss event fired", rb["ok"] and st["state"] == "live",
                  json.dumps({k: st[k] for k in
                              ("state", "kind", "key", "name", "refusal")}))
            check("realm boss is a boss-tier registry body",
                  st["registryKind"] == "boss" and st["tier"] == 5,
                  f"tier {st['tier']}")
            check("realm boss carries its arena HP", st["hpMax"] > 1000,
                  f"hpMax {st['hpMax']:.0f} at level {st['level']}")

            kill = ev(pg, """
                for (let n = 0; n < 600; n++) {
                    const s = R.slot(B.bossId);
                    if (s < 0 || R.hp[s] <= 0) break;
                    R.damage(B.bossId, 400, {});
                }
                await gameWait(0.6);
                return { boss: B.stats, portal: SF.portal.stats,
                         killedMap: B.stats.killed,
                         prog: { realms: SF.progression.realmsUnlocked.slice(),
                                 bosses: Object.keys(SF.progression.bossesKilled) } };
            """)
            check("realm boss died", kill["boss"]["kills"] >= 1,
                  f"kills {kill['boss']['kills']}")
            check("portal opened at the arena", kill["portal"]["open"],
                  json.dumps({k: kill["portal"][k] for k in ("open", "token", "x", "z")}))
            check("portal is tinted for the NEXT realm",
                  kill["portal"]["token"] == "sand", str(kill["portal"]["token"]))
            check("boss kill recorded in progression",
                  "cold:realm" in kill["prog"]["bosses"],
                  json.dumps(kill["prog"]["bosses"]))

            px, pz = kill["portal"]["x"], kill["portal"]["z"]
            frame_shot(pg, "portal", PORTAL_POS, dist=7.0)

            ev(pg, f"put({px}, {pz} + 1.2); await gameWait(0.8); return true;")
            pg.wait_for_function(
                "() => SNOWFLOW.combat.encounters.realm === 'sand'", timeout=120000)
            after = pg.evaluate("""(() => ({
                realm: SNOWFLOW.combat.encounters.realm,
                shrineRealm: SNOWFLOW.shrine.realm,
                portal: SNOWFLOW.portal.stats,
                realms: SNOWFLOW.progression.realmsUnlocked.slice(),
                bosses: Object.keys(SNOWFLOW.progression.bossesKilled),
                bossRealm: SNOWFLOW.combat.bosses.realm,
            }))()""")
            check("walking in entered the realm", after["realm"] == "sand",
                  after["realm"])
            check("realmsUnlocked carries sand", "sand" in after["realms"],
                  json.dumps(after["realms"]))
            check("the gate closed behind the player", not after["portal"]["open"])
            check("the boss director followed the realm",
                  after["bossRealm"] == "sand", after["bossRealm"])

            check("no page errors", not errs, "; ".join(errs[:3]))
            br.close()
    finally:
        srv.terminate()

    print("\n---- qa_boss summary ----")
    print(f"  passed {len(notes)}   failed {len(fails)}")
    for f in fails:
        print("  " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
