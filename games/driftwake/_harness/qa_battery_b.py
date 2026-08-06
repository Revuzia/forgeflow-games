# Battery B — progression E2E (fresh state, kill XP, ding, save, death)
# Observed-values probe; prints JSON per phase.
import json, time
from playwright.sync_api import sync_playwright

URL = "http://localhost:8799/games/driftwake/index.html"
ARGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11",
        "--disable-gpu-sandbox", "--enable-gpu-rasterization"]

def wait_ready(page):
    page.wait_for_function(
        "() => globalThis.SNOWFLOW && SNOWFLOW.combat && SNOWFLOW.progression",
        timeout=60000)
    time.sleep(3.0)

def ev(page, expr):
    return page.evaluate(expr)

def main():
    out = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome", headless=False, args=ARGS)
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        page.goto(URL)
        wait_ready(page)

        # ---------------- Phase 1: fresh state
        page.evaluate("() => localStorage.clear()")
        page.reload()
        wait_ready(page)
        out["phase1_fresh"] = ev(page, """() => {
            const P = SNOWFLOW.progression, C = SNOWFLOW.character;
            return {
                level: P.level, xp: P.xp, xpNeed: P.xpNeed,
                healthMax: C.healthMax, health: C.health,
                manaMax: C.manaMax, mana: C.mana,
                unlocked: Array.from(P.unlocked).sort(),
                deaths: P.deaths,
                saveBlob: localStorage.getItem('driftwake_save'),
                meshState: SNOWFLOW.meshChar ? SNOWFLOW.meshChar._state : null
            };
        }""")

        # cast(4) at L1 — sample meshChar._state for ~1.2 s after the call.
        out["phase1_cast4_locked_test"] = ev(page, """() => new Promise(res => {
            const M = SNOWFLOW.meshChar, C = SNOWFLOW.character;
            const manaBefore = C.mana;
            const stBefore = M ? M._state : null;
            SNOWFLOW.spells.cast(4);
            const cdAfterCall = SNOWFLOW.spells.cooldownFrac(4);
            const states = new Set();
            const t0 = performance.now();
            (function samp(){
                if (M) states.add(M._state);
                if (performance.now() - t0 < 1200) requestAnimationFrame(samp);
                else res({
                    stateBefore: stBefore,
                    statesSeen: Array.from(states).sort(),
                    enteredCast: states.has(8),  // ST_CAST = 8
                    manaBefore, manaAfter: C.mana,
                    cooldownFracAfterCall: cdAfterCall,
                    cooldownFracNow: SNOWFLOW.spells.cooldownFrac(4)
                });
            })();
        })""")

        # ---------------- Phase 2: kill XP (rime_imp L1 at 6 m)
        out["phase2_kill"] = ev(page, """() => new Promise(res => {
            const P = SNOWFLOW.progression, C = SNOWFLOW.character;
            const R = SNOWFLOW.combat.registry;
            const xpBefore = P.xp, lvlBefore = P.level;
            const px = C.position.x, pz = C.position.z;
            const id = SNOWFLOW.combat.enemies.spawn('rime_imp', px + 6, pz, 1);
            let slotInfo = null;
            const s = R.slot(id);
            if (s >= 0) slotInfo = { tier: R.tier[s], level: R.level[s],
                                     hp: R.hp[s], name: R.name[s] };
            const dealt = R.damage(id, 999999, {});
            setTimeout(() => res({
                spawnId: id, slotInfo, dealt,
                xpBefore, xpAfter: P.xp,
                xpGained: P.xp - xpBefore,
                lastXP: P.lastXP, lastXPWhy: P.lastXPWhy,
                levelBefore: lvlBefore, levelAfter: P.level
            }), 1000);
        })""")

        # ---------------- Phase 3: ding via addXP, walk levels 2..6
        # Half the health pool first so the full heal is observable.
        out["phase3_ding"] = ev(page, """() => {
            const P = SNOWFLOW.progression, C = SNOWFLOW.character;
            C.health = Math.floor(C.healthMax / 2);
            C.mana = Math.floor(C.manaMax / 2);
            const before = { level: P.level, xp: P.xp, xpNeed: P.xpNeed,
                healthMax: C.healthMax, health: C.health, mana: C.mana,
                unlocked: Array.from(P.unlocked).sort() };
            const steps = [];
            // ding one level at a time up to 6, recording unlock growth
            while (P.level < 6) {
                const need = P.xpNeed - P.xp;
                const pre = Array.from(P.unlocked).sort();
                P.addXP(need, 'qa-ding');
                steps.push({ level: P.level,
                    healthMax: C.healthMax, health: C.health,
                    manaMax: C.manaMax, mana: C.mana,
                    unlockedBefore: pre,
                    unlockedAfter: Array.from(P.unlocked).sort(),
                    dingCount: P.dingCount });
            }
            return { before, steps };
        }""")

        # ---------------- Phase 4: save + restore
        out["phase4_save"] = ev(page, """() => {
            SNOWFLOW.progression.save();
            const raw = localStorage.getItem('driftwake_save');
            let blob = null;
            try { blob = JSON.parse(raw); } catch (e) {}
            return { rawLen: raw ? raw.length : 0, blob,
                     liveLevel: SNOWFLOW.progression.level };
        }""")
        page.reload()
        wait_ready(page)
        out["phase4_restore"] = ev(page, """() => {
            const P = SNOWFLOW.progression, C = SNOWFLOW.character;
            return { level: P.level, xp: P.xp, deaths: P.deaths,
                healthMax: C.healthMax, health: C.health,
                unlocked: Array.from(P.unlocked).sort(),
                driftmarks: P.driftmarks };
        }""")

        # ---------------- Phase 5: death and respawn
        out["phase5_death"] = ev(page, """() => new Promise(res => {
            const P = SNOWFLOW.progression, C = SNOWFLOW.character;
            const before = { level: P.level, deaths: P.deaths,
                pos: { x: C.position.x, z: C.position.z } };
            C.health = 0;
            setTimeout(() => res({
                before,
                deadFlag: P.dead,
                deaths: P.deaths,
                level: P.level,
                health: C.health, healthMax: C.healthMax,
                mana: C.mana, manaMax: C.manaMax,
                pos: { x: C.position.x, z: C.position.z },
                lastShrineId: P.lastShrineId,
                shrine: P.shrines[P.lastShrineId],
                invulnerable: P.isInvulnerable(),
                savedBlobDeaths: (() => { try {
                    return JSON.parse(localStorage.getItem('driftwake_save')).deaths;
                } catch(e){ return null; } })()
            }), 3000);
        })""")

        browser.close()
    print(json.dumps(out, indent=2))

if __name__ == "__main__":
    main()
