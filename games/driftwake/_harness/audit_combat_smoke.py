#!/usr/bin/env python
"""Combat smoke (regression battery item 4):
  A. spawn a rimeImp 4 m from the player -> it must CLOSE (distance shrinks)
     and DAMAGE the player (character.health drops).
  B. kill it with real wave casts -> registry emits kill, progression XP rises.
  C. wave at a training dummy -> bell damage lands (hp drop > 0).
"""
import sys, time
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]
URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8799/games/driftwake/index.html"

fails = []

with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
    pg = br.new_page(viewport={"width": 1280, "height": 720})
    pg.goto(URL, wait_until="load", timeout=60000)
    end = time.time() + 120
    while time.time() < end:
        try:
            if pg.evaluate("!!(globalThis.SNOWFLOW && SNOWFLOW.combat && SNOWFLOW.combat.enemies)"):
                break
        except Exception:
            pass
        pg.wait_for_timeout(500)
    pg.wait_for_timeout(3000)
    pg.mouse.click(640, 360)

    # -- isolate: no director spawns, clear field ---------------------------
    pg.evaluate("""(() => {
        const SF = SNOWFLOW;
        SF.S.combatEnemies = false;
        // NOTE: enemies.clear() throws with the mesh renderer (BOLT_MAX 32 vs
        // _boltMeshes 16) -- see audit findings. Clear via the registry instead.
        const r = SF.combat.registry;
        for (let i = r.count - 1; i >= 0; i--)
            if (r.kind[i] !== 'dummy') r.remove(r.idOf[i]);
        SF.character.health = SF.character.healthMax;
    })()""")
    pg.wait_for_timeout(600)

    base = pg.evaluate("""(() => ({
        hp: SNOWFLOW.character.health,
        xp: SNOWFLOW.progression.xp, lvl: SNOWFLOW.progression.level,
        px: SNOWFLOW.character.position.x, pz: SNOWFLOW.character.position.z,
    }))()""")
    print("baseline:", base)
    # Owner unlock ladder 2026-08-13: wave is L2 now; the smoke casts
    # it at a fresh L1 save, so grant it explicitly.
    pg.evaluate("SNOWFLOW.progression.unlocked.add(1)")

    # -- A: spawn rimeImp at 4 m --------------------------------------------
    eid = pg.evaluate(f"""(() => {{
        const c = SNOWFLOW.character;
        return SNOWFLOW.combat.enemies.spawn('rimeImp',
            c.position.x + 4, c.position.z, {max(1, base['lvl'])});
    }})()""")
    if eid < 0:
        print("FAIL spawn returned", eid); fails.append("spawn"); br.close(); sys.exit(1)

    rows = []
    for _ in range(48):  # 12 s @ 250 ms
        pg.wait_for_timeout(250)
        s = pg.evaluate(f"""(() => {{
            const SF = SNOWFLOW, r = SF.combat.registry, c = SF.character;
            const sl = r.slot({eid});
            const d = sl < 0 ? -1 :
                Math.hypot(r.x[sl] - c.position.x, r.z[sl] - c.position.z);
            return {{ d: +d.toFixed(2), hp: +c.health.toFixed(1),
                      ehp: sl < 0 ? 0 : +r.hp[sl].toFixed(1) }};
        }})()""")
        rows.append(s)
        if s["hp"] < base["hp"] - 0.5:
            break
    d0, dmin = rows[0]["d"], min(r["d"] for r in rows if r["d"] >= 0)
    hp_now = rows[-1]["hp"]
    closed = dmin < d0 - 0.5 or dmin <= 2.5
    hurt = hp_now < base["hp"] - 0.5
    print(f"A close+damage: d0={d0} dmin={dmin} samples={len(rows)}"
          f"  playerHp {base['hp']} -> {hp_now}"
          f"  {'PASS' if closed and hurt else 'FAIL'}")
    if not (closed and hurt): fails.append("A close/damage")

    # -- B: kill with real wave casts, XP must flow -------------------------
    xp0 = pg.evaluate("(() => ({xp: SNOWFLOW.progression.xp, lvl: SNOWFLOW.progression.level}))()")

    def quiet(timeout_s=12):
        t0 = time.time()
        while time.time() - t0 < timeout_s:
            if pg.evaluate("!SNOWFLOW.spells.sweep.active && !SNOWFLOW.spells._pending.key"):
                return True
            pg.wait_for_timeout(250)
        return False

    casts, ehp = 0, None
    for _ in range(15):
        st = pg.evaluate(f"""(() => {{
            const SF = SNOWFLOW, r = SF.combat.registry, c = SF.character;
            const sl = r.slot({eid});
            if (sl < 0) return {{ dead: true }};
            // keep the fight inside the wave's envelope: stand 7 m out
            let dx = r.x[sl] - c.position.x, dz = r.z[sl] - c.position.z;
            let l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
            c.position.x = r.x[sl] - dx * 7; c.position.z = r.z[sl] - dz * 7;
            c.position.y = SF.terrain.heightAt(c.position.x, c.position.z);
            c.velocity.set(0, 0, 0);
            dx = r.x[sl] - c.position.x; dz = r.z[sl] - c.position.z;
            l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
            SF.spells.aim.set(dx, 0, dz);
            SF.rig.yaw = Math.atan2(dx, -dz);
            c.facing = Math.atan2(dx, -dz);
            c.health = c.healthMax;
            c.mana = c.manaMax;
            for (const k of [1,2,3,4,5]) SF.spells._cdUntil[k] = 0;
            SF.spells.cast(1);
            return {{ dead: false, ehp: +r.hp[sl].toFixed(1) }};
        }})()""")
        casts += 1
        if st.get("dead"):
            break
        ehp = st["ehp"]
        pg.wait_for_timeout(400)
        quiet()
    pg.wait_for_timeout(1200)   # let progression poll the kill event
    after = pg.evaluate(f"""(() => ({{
        slot: SNOWFLOW.combat.registry.slot({eid}),
        xp: SNOWFLOW.progression.xp, lvl: SNOWFLOW.progression.level,
    }}))()""")
    dead = after["slot"] < 0
    xp_flow = (after["lvl"] > xp0["lvl"]) or (after["xp"] > xp0["xp"])
    print(f"B kill+xp: casts={casts} lastEnemyHp={ehp} dead={dead}"
          f"  xp {xp0['xp']}(L{xp0['lvl']}) -> {after['xp']}(L{after['lvl']})"
          f"  {'PASS' if dead and xp_flow else 'FAIL'}")
    if not (dead and xp_flow): fails.append("B kill/xp")

    # -- C: wave at a heavy enemy deals bell damage -------------------------
    # The training dummies were removed 2026-08-10 (owner: real enemies
    # only), so the bell target is a spawned Hail Plate Guard: the heavy
    # tier rung, far too much HP for one wave to kill mid-measurement.
    dm = pg.evaluate("""(() => {
        const SF = SNOWFLOW, reg = SF.combat.registry;
        const c = SF.character;
        const tx = c.position.x + 40, tz = c.position.z;
        const id = SF.combat.enemies.spawn('hailPlateGuard', tx, tz, 10);
        if (typeof id !== 'number' || id <= 0) return null;
        const s = reg.slot(id);
        if (s < 0) return null;
        // stand the player 7 m from the target and settle; cast comes next tick
        c.position.x = tx - 7; c.position.z = tz;
        c.position.y = SF.terrain.heightAt(c.position.x, c.position.z);
        c.velocity.set(0, 0, 0);
        return { id, name: reg.name[s], x: tx, z: tz,
                 hp0: reg.hp[s], hpMax: reg.hpMax[s] };
    })()""")
    if dm is None:
        print("FAIL no bell target spawned"); fails.append("C no bell target")
    else:
        pg.wait_for_timeout(1200)   # settle after the teleport
        pg.evaluate(f"""(() => {{
            const SF = SNOWFLOW, c = SF.character;
            let dx = {dm['x']} - c.position.x, dz = {dm['z']} - c.position.z;
            const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
            SF.spells.aim.set(dx, 0, dz);
            SF.rig.yaw = Math.atan2(dx, -dz);
            c.facing = Math.atan2(dx, -dz);
            c.mana = c.manaMax;
            for (const k of [1,2,3,4,5]) SF.spells._cdUntil[k] = 0;
            SF.combat.spellHits.damageMult = 1.0;
            SF.spells.cast(1);
        }})()""")
        pg.wait_for_timeout(3000)
        quiet()
        hp1 = pg.evaluate(f"""(() => {{
            const r = SNOWFLOW.combat.registry, s = r.slot({dm['id']});
            return s < 0 ? -1 : +r.hp[s].toFixed(1);
        }})()""")
        drop = dm["hp0"] - hp1
        ok = drop > 0
        print(f"C bell wave: {dm['name']} hp {dm['hp0']} -> {hp1} (drop {drop:.1f})"
              f"  {'PASS' if ok else 'FAIL'}")
        if not ok: fails.append("C bell damage")

    br.close()

print("\nRESULT:", "OK" if not fails else "COMBAT SMOKE FAIL: " + ", ".join(fails))
sys.exit(0 if not fails else 1)
