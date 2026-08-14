# -*- coding: utf-8 -*-
"""review_combatfeel.py -- READ-ONLY combat design/feel review probe (port 8854).

Measures, on the live game:
  P1 baseline kit facts (level, pools, damageMult, unlocks)
  P2 bolt-only TTK vs rimeImp at L1 (real spells.cast(6) on the fire cycle)
  P3 pack pressure at L1: 5 rime imps + 1 sprite vs a standing player
     (time-to-death, concurrent-windup count, max camera trauma while HIT)
  P4 glacier brute telegraph ramp at 9 m (flash series + screenshot)
  P5 L8 full-rotation TTK vs hailPlateGuard 300HP heavy (real cds, real mana)
  P6 death dissolve screenshot
Screenshots -> _shots/review_*.png
"""
import json, subprocess, sys, time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
SHOTS = Path(__file__).resolve().parents[1] / "_shots"
PORT = 8854
URL = f"http://localhost:{PORT}/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

GAMEWAIT = """
    const reg = SNOWFLOW.combat.registry;
    const gameWait = (sec) => new Promise((res) => {
        const t0 = reg.time;
        const tick = () => (reg.time - t0 >= sec) ? res() : requestAnimationFrame(tick);
        tick();
    });
"""


def main():
    from playwright.sync_api import sync_playwright
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT)],
                           cwd=str(ROOT), stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL)
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.goto(URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime", timeout=120000)
            pg.wait_for_timeout(2500)
            pg.mouse.click(640, 360)

            # wait for the cold mesh stream
            try:
                pg.wait_for_function(
                    "() => SNOWFLOW.combat.enemies.vis.stats.types >= 8",
                    timeout=45000)
            except Exception:
                print("WARN: vis.stats.types < 8 after 45 s:",
                      pg.evaluate("SNOWFLOW.combat.enemies.vis.stats.types"))

            # isolate: no director spawns, clear field, heal
            pg.evaluate("""(() => {
                const SF = SNOWFLOW;
                SF.S.combatEnemies = false;
                const r = SF.combat.registry;
                for (let i = r.count - 1; i >= 0; i--)
                    if (r.kind[i] !== 'dummy') r.remove(r.idOf[i]);
                SF.character.health = SF.character.healthMax;
                SF.character.mana = SF.character.manaMax;
            })()""")
            pg.wait_for_timeout(500)

            p1 = pg.evaluate("""(() => {
                const SF = SNOWFLOW, p = SF.progression, c = SF.character;
                return { level: p.level, hp: c.health, hpMax: c.healthMax,
                         mana: c.mana, manaMax: c.manaMax,
                         unlocked: [...p.unlocked],
                         damageMult: SF.combat.spellHits.damageMult };
            })()""")
            print("P1 baseline:", json.dumps(p1))

            # ---------------- P2: bolt-only TTK vs rimeImp at current level ---
            p2 = pg.evaluate("(async () => {" + GAMEWAIT + """
                const SF = SNOWFLOW, c = SF.character;
                const lvl = SF.progression.level;
                const eid = SF.combat.enemies.spawn('rimeImp',
                    c.position.x + 14, c.position.z, lvl);
                if (eid < 0) return { err: 'spawn ' + eid };
                await gameWait(0.5);
                let s = reg.slot(eid);
                const hp0 = reg.hp[s], hpMax = reg.hpMax[s];
                SF.combat.registry.damage(eid, 1, {});   // wake
                const t0 = reg.time;
                let casts = 0, maxTrauma = 0;
                while (reg.slot(eid) >= 0 && reg.time - t0 < 30) {
                    s = reg.slot(eid);
                    if (s >= 0) {
                        let dx = reg.x[s] - c.position.x,
                            dz = reg.z[s] - c.position.z;
                        const l = Math.hypot(dx, dz) || 1;
                        SF.spells.aim.set(dx / l, 0, dz / l);
                        SF.rig.yaw = Math.atan2(dx / l, -dz / l);
                        c.facing = SF.rig.yaw;
                    }
                    SF.spells.cast(6); casts++;
                    await gameWait(0.45);
                    maxTrauma = Math.max(maxTrauma, SF.rig.trauma);
                }
                const ttk = reg.time - t0;
                return { enemyLvl: lvl, hp0: +hp0.toFixed(1),
                         hpMax: +hpMax.toFixed(1),
                         dead: reg.slot(eid) < 0, ttk: +ttk.toFixed(2),
                         castAttempts: casts,
                         maxTraumaDuringBoltFight: +maxTrauma.toFixed(3),
                         playerHpAfter: +c.health.toFixed(1) };
            })()""")
            print("P2 bolt TTK vs rimeImp:", json.dumps(p2))

            # ---------------- P3: pack pressure, standing player -------------
            pg.evaluate("""(() => {
                const SF = SNOWFLOW, r = SF.combat.registry;
                for (let i = r.count - 1; i >= 0; i--)
                    if (r.kind[i] !== 'dummy') r.remove(r.idOf[i]);
                SF.character.health = SF.character.healthMax;
            })()""")
            pg.wait_for_timeout(400)
            pg.evaluate("""(() => {
                const SF = SNOWFLOW, c = SF.character;
                const lvl = SF.progression.level;
                const px = c.position.x, pz = c.position.z;
                const ids = [];
                for (let k = 0; k < 5; k++) {
                    const a = (k / 5) * Math.PI * 2;
                    ids.push(SF.combat.enemies.spawn('rimeImp',
                        px + Math.cos(a) * 9, pz + Math.sin(a) * 9, lvl));
                }
                ids.push(SF.combat.enemies.spawn('hoarfrostSprite',
                    px + 12, pz + 3, lvl));
                for (const id of ids) if (id > 0) SF.combat.registry.damage(id, 1, {});
                window.__packIds = ids;
            })()""")
            rows, shot1 = [], False
            t_start = time.time()
            dead_at = None
            while time.time() - t_start < 50:
                pg.wait_for_timeout(500)
                s = pg.evaluate("""(() => {
                    const SF = SNOWFLOW, c = SF.character, v = SF.combat.enemies.vis;
                    c.velocity.set(0, 0, 0);   // stand still: no fleeing
                    let windups = 0;
                    const e = SF.combat.enemies;
                    for (let i = 0; i < e.count; i++)
                        if (e.vis.flash && e.vis.flash[i] > 0.05) windups++;
                    return { t: +SF.combat.registry.time.toFixed(1),
                             hp: +c.health.toFixed(1),
                             windups, trauma: +SF.rig.trauma.toFixed(3),
                             dead: SF.progression.dead };
                })()""")
                rows.append(s)
                if not shot1 and time.time() - t_start > 3:
                    pg.screenshot(path=str(SHOTS / "review_pack_L1.png"))
                    shot1 = True
                if s["hp"] <= 0 or s["dead"]:
                    dead_at = s["t"]
                    break
            hp_series = [(r["t"], r["hp"]) for r in rows[::4]]
            print("P3 pack pressure: hpSeries(2s-steps)=", hp_series,
                  " maxConcurrentWindups=", max(r["windups"] for r in rows),
                  " maxTraumaWhileHit=", max(r["trauma"] for r in rows),
                  " playerDeadAt=", dead_at)
            pg.screenshot(path=str(SHOTS / "review_pack_L1_late.png"))

            # respawn / clear
            pg.evaluate("""(() => {
                const SF = SNOWFLOW, r = SF.combat.registry;
                for (let i = r.count - 1; i >= 0; i--)
                    if (r.kind[i] !== 'dummy') r.remove(r.idOf[i]);
                if (SF.progression.dead && SF.progression.respawn)
                    try { SF.progression.respawn(); } catch (e) {}
                SF.character.health = SF.character.healthMax;
                SF.character.mana = SF.character.manaMax;
            })()""")
            pg.wait_for_timeout(1500)

            # ---------------- P4: brute telegraph ramp at 9 m ----------------
            p4 = pg.evaluate("(async () => {" + GAMEWAIT + """
                const SF = SNOWFLOW, c = SF.character;
                // place the brute 9 m along the camera forward axis so it is
                // framed the way a player would see it
                const fx = Math.sin(SF.rig.yaw), fz = -Math.cos(SF.rig.yaw);
                const bx = c.position.x + fx * 9, bz = c.position.z + fz * 9;
                const eid = SF.combat.enemies.spawn('glacierBrute', bx, bz,
                    SF.progression.level);
                if (eid < 0) return { err: 'spawn ' + eid };
                await gameWait(0.4);
                SF.combat.registry.damage(eid, 1, {});
                const e = SF.combat.enemies;
                const series = [];
                const t0 = reg.time;
                let flagged = false;
                while (reg.time - t0 < 8) {
                    const s = reg.slot(eid);
                    if (s < 0) break;
                    let idx = -1;
                    for (let i = 0; i < e.count; i++)
                        if (e.id[i] === eid) { idx = i; break; }
                    const f = idx >= 0 && e.vis.flash ? e.vis.flash[idx] : -1;
                    series.push([+(reg.time - t0).toFixed(2), +(+f).toFixed(2)]);
                    if (f > 0.35 && !flagged) { flagged = true; window.__shotNow = true; }
                    await gameWait(0.05);
                }
                return { series: series.filter((r, i) => i % 2 === 0),
                         playerHp: +c.health.toFixed(1) };
            })()""")
            # screenshot as soon as the JS flagged a windup (poll from python)
            print("P4 brute flash series (t, flash):",
                  json.dumps(p4)[:1500])

            # take a mid-windup screenshot with a second short pass
            pg.evaluate("(async () => {" + GAMEWAIT + """
                await gameWait(0.1);
            })()""")
            pg.screenshot(path=str(SHOTS / "review_telegraph_brute.png"))

            # ---------------- P5: L8 rotation vs heavy -----------------------
            pg.evaluate("""(() => {
                const SF = SNOWFLOW, r = SF.combat.registry;
                for (let i = r.count - 1; i >= 0; i--)
                    if (r.kind[i] !== 'dummy') r.remove(r.idOf[i]);
                const p = SF.progression;
                p.level = 8; p._unlockCheck(); p._applyLevelStats(true);
            })()""")
            pg.wait_for_timeout(500)
            p5 = pg.evaluate("(async () => {" + GAMEWAIT + """
                const SF = SNOWFLOW, c = SF.character;
                const eid = SF.combat.enemies.spawn('hailPlateGuard',
                    c.position.x + 12, c.position.z, 8);
                if (eid < 0) return { err: 'spawn ' + eid };
                await gameWait(0.5);
                let s = reg.slot(eid);
                const hpMax = reg.hpMax[s];
                SF.combat.registry.damage(eid, 1, {});
                const t0 = reg.time;
                let manaMin = c.mana, hpMin = c.health;
                const cds = [5, 4, 3, 1];       // vortex, spikes, bloom, wave
                while (reg.slot(eid) >= 0 && reg.time - t0 < 90) {
                    s = reg.slot(eid);
                    if (s >= 0) {
                        let dx = reg.x[s] - c.position.x,
                            dz = reg.z[s] - c.position.z;
                        const l = Math.hypot(dx, dz) || 1;
                        SF.spells.aim.set(dx / l, 0, dz / l);
                        SF.rig.yaw = Math.atan2(dx / l, -dz / l);
                        c.facing = SF.rig.yaw;
                    }
                    for (const k of cds) SF.spells.cast(k); // gated by real cd+mana
                    SF.spells.cast(6);
                    manaMin = Math.min(manaMin, c.mana);
                    hpMin = Math.min(hpMin, c.health);
                    await gameWait(0.45);
                }
                return { dmgMult: SF.combat.spellHits.damageMult,
                         enemyHpMax: +hpMax.toFixed(1),
                         dead: reg.slot(eid) < 0,
                         ttk: +(reg.time - t0).toFixed(1),
                         manaMin: +manaMin.toFixed(1),
                         playerHpMin: +hpMin.toFixed(1),
                         playerHpMax: c.healthMax };
            })()""")
            print("P5 L8 rotation vs hailPlateGuard:", json.dumps(p5))
            pg.screenshot(path=str(SHOTS / "review_L8_heavy_fight.png"))

            # ---------------- P6: death dissolve shot ------------------------
            p6 = pg.evaluate("(async () => {" + GAMEWAIT + """
                const SF = SNOWFLOW, c = SF.character;
                const fx = Math.sin(SF.rig.yaw), fz = -Math.cos(SF.rig.yaw);
                const eid = SF.combat.enemies.spawn('rimeImp',
                    c.position.x + fx * 8, c.position.z + fz * 8, 8);
                if (eid < 0) return { err: 'spawn' };
                await gameWait(0.4);
                SF.combat.registry.damage(eid, 500, {});
                await gameWait(0.35);
                return { killed: reg.slot(eid) < 0 };
            })()""")
            pg.screenshot(path=str(SHOTS / "review_death_dissolve.png"))
            print("P6 death:", json.dumps(p6))

            br.close()
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
