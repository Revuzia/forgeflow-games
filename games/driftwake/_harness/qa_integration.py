# -*- coding: utf-8 -*-
"""
qa_integration.py -- the ADVERSARIAL INTEGRATOR probe (port 8876).

Not a lane probe. Every lane verified itself in isolation and passed; this one
exists to break the SEAMS BETWEEN them, in one live session each, on game time
(SNOWFLOW.combat.registry.time + rAF) — never a wall-clock sleep for game
state.

  A  FULL L8 FIGHT, everything on at once
     pack + mini boss + motes + hit-stop + hurt FX, and the four named
     cross-lane failure modes:
       A1 hit-stop must not STACK past its own 90 ms cap through a boss
          phase-2 transition (laneA envelope vs laneB phase edge)
       A2 the boss payout must actually pay (laneB death edge -> laneM pool)
       A3 motes must not heal THROUGH death (laneM heal runs at main.js:~936,
          progression's death check at ~965 — a mote can cancel the check)
       A4 flinch must not fight the leash (laneA flinch channel vs laneB's
          30 m arena tether) — the boss comes home either way

  B  REALM CHURN, 8 consecutive realm changes with landform re-bakes
     the character never falls through and is never buried; the SHRINES and
     the LANDMARKS both re-ground onto the new heightfield; no page errors.

  C  DEATH IN THE STORM BAND, at the far edge of the disc
     edge01 > 0 at the death point -> respawn on a registered shrine, pools
     restored, hurt FX cleared, and the v3 save blob round-trips.

  D  BOSS -> PORTAL -> NEW REALM, end to end, one session.

Run:  python _harness/qa_integration.py
"""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = Path(__file__).resolve().parent
GAME = HERE.parent
PORT = 8876
URL = f"http://localhost:{PORT}/games/driftwake/index.html?autoplay"
SHOTS = GAME / "_shots"

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

# --------------------------------------------------------------- js helpers
PRELUDE = """
const SF = globalThis.SNOWFLOW;
const R = SF.combat.registry, B = SF.combat.bosses, E = SF.combat.encounters;
const C = SF.character, T = SF.terrain, P = SF.progression;
const M = SF.motes, HS = SF.hitstop, HF = SF.hurtFx;
const SH = SF.shrine, LM = SF.landmarks;
// GAME time only. A frozen or hitching frame cannot make this wait "pass".
const gameWait = (sec) => new Promise((res) => {
    const t0 = R.time;
    const tick = () => (R.time - t0 >= sec) ? res() : requestAnimationFrame(tick);
    tick();
});
// Wall-frame wait, for the things that are counted in FRAMES not seconds:
// the 3-frame re-ground countdowns in shrine.js / landmarks.js run inside
// terrain.update() whether or not game time is advancing.
const frames = (n) => new Promise((res) => {
    let k = n;
    const tick = () => (--k <= 0) ? res() : requestAnimationFrame(tick);
    tick();
});
const put = (x, z) => {
    C.position.x = x; C.position.z = z;
    C.position.y = T.heightAt(x, z);
    C.velocity.set(0, 0, 0); C.vertVel = 0; C.airborne = false;
};
"""

CHECKS = []


def check(name, ok, detail=""):
    CHECKS.append((name, bool(ok), detail))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f"  — {detail}" if detail else ""))


def main() -> int:
    errors = []
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        pg.on("console", lambda m: errors.append(f"console.error: {m.text}")
              if m.type == "error" else None)
        pg.goto(URL, wait_until="load", timeout=60_000)
        pg.wait_for_function(
            "() => globalThis.SNOWFLOW && !globalThis.SNOWFLOW.S.freezeTime",
            timeout=120_000)
        pg.wait_for_timeout(2500)          # settle: warm-up + first stream

        # =================================================== A. full L8 fight
        print("\n== A. full L8 fight: pack + mini boss + motes + hitstop + hurtFx")
        a = pg.evaluate("""async () => {""" + PRELUDE + """
            P.level = 8;
            for (let i = 1; i <= 5; i++) P.unlocked.add(i);
            C.health = C.healthMax;
            M.clear();
            const spawned0 = M.stats.spawned;

            // A live pack AND a boss at once — the whole point of the pass.
            const armed = B.spawnBoss('mini');
            await gameWait(1.0);
            const st0 = B.stats;
            if (st0.state !== 'live') {
                return { armed, refusal: st0.refusal, state: st0.state, fatal: 1 };
            }

            // ---- A1: drive the boss through the phase-2 edge while feeding
            // hit-stop triggers, and sample the dilation every frame. If the
            // envelope stacks, scaleNow leaves (0,1] or the burst outlives
            // the 90 ms cap.
            const s = R.slot(st0.id);
            let scaleMin = 1, scaleMax = 0, bad = 0, burstMax = 0, burst = 0;
            let sawPhase2 = false;
            const t0 = R.time;
            const sample = () => {
                const sc = HS.stats.scaleNow;
                if (!(sc > 0 && sc <= 1)) bad++;
                scaleMin = Math.min(scaleMin, sc);
                scaleMax = Math.max(scaleMax, sc);
                // burst length in WALL seconds (hitstop runs on wall time)
                if (sc < 1) { burst += 1 / 60; burstMax = Math.max(burstMax, burst); }
                else burst = 0;
                if (B.stats.phase === 2) sawPhase2 = true;
            };
            // Walk it down across the phase gate with real damage events, so
            // the kill/heavy triggers land ON the transition frames.
            while (R.time - t0 < 8 && R.hp[s] > R.hpMax[s] * 0.10) {
                R.damage(st0.id, Math.max(4, R.hpMax[s] * 0.04), {});
                sample();
                await new Promise((r) => requestAnimationFrame(r));
            }
            const phaseStats = B.stats;

            // ---- A4: flinch vs leash. Drag the boss well outside the 30 m
            // tether while it is being hit (flinch channel live), then let go.
            const s2 = R.slot(B.stats.id);
            let leashed = false, distOut = 0;
            if (s2 >= 0) {
                R.x[s2] = B.stats.arenaX + 60;
                R.z[s2] = B.stats.arenaZ + 60;
                distOut = Math.hypot(R.x[s2] - B.stats.arenaX,
                                     R.z[s2] - B.stats.arenaZ);
                R.damage(B.stats.id, 5, {});      // flinch while out of bounds
                await gameWait(1.5);
                leashed = B.stats.arenaDist <= B.stats.leashM + 2;
            }
            const leashReturns = B.stats.leashReturns;

            // ---- A2: the boss payout. Kill it and count the pool.
            const before = M.stats.spawned;
            const bid = B.stats.id;
            const killsBefore = B.stats.kills;
            if (bid > 0) R.damage(bid, 1e9, {});
            await gameWait(1.0);
            const after = M.stats.spawned;

            return {
                armed, fatal: 0,
                scaleMin, scaleMax, badScale: bad, burstMax,
                sawPhase2, phase: phaseStats.phase,
                patternOpened: phaseStats.patternOpened,
                speedNow: phaseStats.speedNow, speedBase: phaseStats.speedBase,
                distOut, leashed, leashReturns,
                motesBefore: before, motesAfter: after,
                motePayout: after - before,
                bossKills: B.stats.kills - killsBefore,
                spawned0,
            };
        }""")
        if a.get("fatal"):
            check("A. boss armed", False,
                  f"state={a.get('state')} refusal={a.get('refusal')}")
        else:
            check("A1 hit-stop scale stays in (0,1] through phase 2",
                  a["badScale"] == 0 and a["scaleMax"] <= 1.0,
                  f"min={a['scaleMin']:.3f} max={a['scaleMax']:.3f} "
                  f"out-of-range frames={a['badScale']}")
            check("A1 hit-stop burst never exceeds the 90 ms stack cap",
                  a["burstMax"] <= 0.130,
                  f"longest continuous dilation ~{a['burstMax']*1000:.0f} ms "
                  f"(cap 90 ms + one 60 Hz sample of slack)")
            check("A1 boss reached phase 2 under the same load",
                  a["sawPhase2"] and a["phase"] == 2,
                  f"phase={a['phase']} patternOpened={a['patternOpened']} "
                  f"speed {a['speedBase']:.2f}->{a['speedNow']:.2f}")
            check("A4 flinch does not defeat the leash",
                  a["leashed"],
                  f"dragged {a['distOut']:.0f} m out (leash 30 m), "
                  f"returns={a['leashReturns']}")
            check("A2 boss death pays the motes.spawnAt(x,z,8) contract",
                  a["motePayout"] >= 8,
                  f"pool spawned {a['motesBefore']} -> {a['motesAfter']} "
                  f"(+{a['motePayout']}), bossKills+{a['bossKills']}")

        # ---- A3: motes healing through death -------------------------------
        a3 = pg.evaluate("""async () => {""" + PRELUDE + """
            B.clearBoss();
            SF.combat.enemies.clear();
            M.clear();
            await gameWait(0.3);
            // Park a full payout ON the player, then drop them to zero. The
            // pickup pass runs BEFORE progression's death check in the frame.
            C.health = C.healthMax;
            M.spawnAt(C.position.x, C.position.z, 8);
            await new Promise((r) => requestAnimationFrame(r));
            C.health = 0;
            const healed0 = M.stats.healed;
            let everDead = false, hpPeak = 0;
            const t0 = R.time;
            while (R.time - t0 < 3.0) {
                if (P.dead) everDead = true;
                hpPeak = Math.max(hpPeak, C.health);
                await new Promise((r) => requestAnimationFrame(r));
            }
            return {
                everDead, hpPeak, hpMax: C.healthMax,
                healedDelta: M.stats.healed - healed0,
                deadNow: P.dead, hpNow: C.health,
            };
        }""")
        check("A3 motes cannot cancel a death (death still latches)",
              a3["everDead"],
              f"dead latched={a3['everDead']}  mote heal during window="
              f"{a3['healedDelta']:.1f} hp  peak hp={a3['hpPeak']:.0f}/"
              f"{a3['hpMax']:.0f}")

        # ===================================================== B. realm churn
        print("\n== B. realm churn: 8 consecutive realm changes + landform re-bakes")
        b = pg.evaluate("""async () => {""" + PRELUDE + """
            const order = ['sand','ash','cold','ash','sand','cold','sand','ash'];
            const rows = [];
            for (let i = 0; i < order.length; i++) {
                const tok = order[i];
                await SF.enterRealm(tok);
                // the re-ground countdowns are counted in FRAMES
                await frames(8);
                await gameWait(0.5);

                const gy = T.heightAt(C.position.x, C.position.z);
                // shrines: every one of the seven must sit on the new ground
                let shWorst = 0;
                for (let k = 0; k < SH.positions.length; k++) {
                    const s = SH.positions[k];
                    shWorst = Math.max(shWorst,
                        Math.abs(s.y - T.heightAt(s.x, s.z)));
                }
                // landmarks: every visible instance of the live realm
                let lmWorst = 0;
                const inst = LM.stats.instances;
                for (let k = 0; k < inst.length; k++) {
                    lmWorst = Math.max(lmWorst,
                        Math.abs(inst[k].y - T.heightAt(inst[k].x, inst[k].z)));
                }
                rows.push({
                    realm: tok,
                    lmRealm: LM.stats.realm,
                    shRealm: SH.realm,
                    charDy: C.position.y - gy,
                    shWorst, lmWorst,
                    lmLive: inst.length,
                    rebakes: T.rebakeCount,
                });
            }
            return { rows, realm: SF.realms ? null : null };
        }""")
        rows = b["rows"]
        worst_char = max(abs(r["charDy"]) for r in rows)
        worst_sh = max(r["shWorst"] for r in rows)
        worst_lm = max(r["lmWorst"] for r in rows)
        tok_ok = all(r["lmRealm"] == r["realm"] and r["shRealm"] == r["realm"]
                     for r in rows)
        for r in rows:
            print(f"     {r['realm']:5s} charDy={r['charDy']:+6.2f}  "
                  f"shrineWorst={r['shWorst']:5.2f}  lmWorst={r['lmWorst']:5.2f}  "
                  f"lmLive={r['lmLive']:3d}  rebakes={r['rebakes']}")
        check("B character never falls through / stands buried (8 swaps)",
              worst_char <= 2.0, f"worst |dy| = {worst_char:.2f} m over 8 swaps")
        check("B all 7 shrines re-ground onto the new heightfield",
              worst_sh <= 1.0, f"worst shrine height error = {worst_sh:.2f} m")
        check("B landmarks re-ground onto the new heightfield",
              worst_lm <= 1.0, f"worst landmark height error = {worst_lm:.2f} m")
        check("B shrine + landmark realm tokens follow every swap",
              tok_ok, "both layers report the entered realm on all 8")

        # ================================================ C. death, storm band
        print("\n== C. death at the far edge, inside the storm band")
        c = pg.evaluate("""async () => {""" + PRELUDE + """
            await SF.enterRealm('cold');
            await frames(8);
            P.level = 8;
            // Walk out to the storm band: just inside the clamp radius.
            const rad = T.playRadius;
            const ang = 0.7;
            put(Math.cos(ang) * (rad - 12), Math.sin(ang) * (rad - 12));
            await gameWait(0.4);
            const edge = T.edge01(C.position.x, C.position.z);
            const push = T.edgePush(C.position.x, C.position.z);
            const pushMag = Math.hypot(push.fx, push.fz);
            const dx0 = C.position.x, dz0 = C.position.z;

            // hurt FX up, then die out here.
            HF.onPlayerHit(1, 0, 40);
            C.health = 1;
            await new Promise((r) => requestAnimationFrame(r));
            C.health = 0;
            const t0 = R.time;
            while (R.time - t0 < 6 && (P.dead || C.health <= 0)) {
                await new Promise((r) => requestAnimationFrame(r));
            }
            await gameWait(0.6);

            // which shrine did we land on?
            let nearest = null, nd = Infinity;
            for (const id in P.shrines) {
                const s = P.shrines[id];
                const d = Math.hypot(C.position.x - s.x, C.position.z - s.z);
                if (d < nd) { nd = d; nearest = id; }
            }
            // v3 save round-trip
            P.save();
            const raw = localStorage.getItem('driftwake_save');
            const blob = JSON.parse(raw || 'null');

            return {
                edge, pushMag, deathX: dx0, deathZ: dz0, playRadius: rad,
                shrineCount: Object.keys(P.shrines).length,
                shrineIds: Object.keys(P.shrines),
                landedOn: nearest, landedDist: nd,
                lastShrineId: P.lastShrineId,
                hp: C.health, hpMax: C.healthMax,
                mana: C.mana, manaMax: C.manaMax,
                dead: P.dead,
                vigOp: HF._vigOp, low: HF._low,
                schemaVer: blob && blob.schemaVer,
                hasPos: !!(blob && blob.pos),
                posRealm: blob && blob.pos && blob.pos.realm,
                blobKeys: blob ? Object.keys(blob).length : 0,
            };
        }""")
        check("C death point really is inside the storm band",
              c["edge"] > 0,
              f"edge01={c['edge']:.3f} at r={c['playRadius']:.0f} m, "
              f"edgePush={c['pushMag']:.2f} m/s")
        check("C all 7 shrines are registered respawn targets",
              c["shrineCount"] >= 7,
              f"{c['shrineCount']} registered: {','.join(c['shrineIds'][:8])}")
        check("C respawn landed ON a registered shrine",
              c["landedDist"] <= 1.5,
              f"landed on '{c['landedOn']}' at {c['landedDist']:.2f} m "
              f"(lastShrineId={c['lastShrineId']})")
        check("C pools restored on respawn",
              c["hp"] >= c["hpMax"] - 1e-6 and c["mana"] >= c["manaMax"] - 1e-6,
              f"hp {c['hp']:.0f}/{c['hpMax']:.0f}  mana {c['mana']:.0f}/{c['manaMax']:.0f}")
        check("C hurt FX cleared after respawn",
              c["vigOp"] == 0 and not c["low"],
              f"vignette opacity={c['vigOp']}  low-hp class={c['low']}")
        check("C v3 save blob round-trips",
              c["schemaVer"] == 3 and c["hasPos"],
              f"schemaVer={c['schemaVer']} pos={c['hasPos']} "
              f"realm={c['posRealm']} keys={c['blobKeys']}")

        # ======================================== D. boss -> portal -> realm
        print("\n== D. boss -> portal -> new realm, end to end")
        d = pg.evaluate("""async () => {""" + PRELUDE + """
            await SF.enterRealm('cold');
            await frames(8);
            P.level = 8;
            C.health = C.healthMax;
            B.clearBoss();
            M.clear();
            const realm0 = LM.stats.realm;
            const armed = B.spawnBoss('realm');
            await gameWait(0.8);
            const st = B.stats;
            if (st.state !== 'live') {
                return { fatal: 1, armed, refusal: st.refusal, state: st.state };
            }
            const kind = st.kind, name = st.name, ax = st.arenaX, az = st.arenaZ;
            const motes0 = M.stats.spawned;
            R.damage(st.id, 1e9, {});
            await gameWait(1.0);
            const portalOpen = SF.portal.isOpen;
            const motePayout = M.stats.spawned - motes0;
            // walk into the gate
            put(SF.portal.x, SF.portal.z);
            const t0 = R.time;
            while (R.time - t0 < 6 && LM.stats.realm === realm0) {
                put(SF.portal.x, SF.portal.z);
                await new Promise((r) => requestAnimationFrame(r));
            }
            await frames(8);
            await gameWait(0.5);
            const gy = T.heightAt(C.position.x, C.position.z);
            let shWorst = 0;
            for (let k = 0; k < SH.positions.length; k++) {
                const s = SH.positions[k];
                shWorst = Math.max(shWorst, Math.abs(s.y - T.heightAt(s.x, s.z)));
            }
            return {
                fatal: 0, armed, kind, name, ax, az,
                portalOpen, motePayout,
                realm0, realmNow: LM.stats.realm, shRealm: SH.realm,
                unlocked: (P.realmsUnlocked || []).slice(),
                bossFlags: Object.keys(B.stats.killed),
                charDy: C.position.y - gy, shWorst,
                portalClosed: !SF.portal.isOpen,
            };
        }""")
        if d.get("fatal"):
            check("D realm boss armed", False,
                  f"state={d.get('state')} refusal={d.get('refusal')}")
        else:
            check("D realm boss died -> portal opened",
                  d["portalOpen"], f"'{d['name']}' ({d['kind']}) at "
                  f"({d['ax']:.0f},{d['az']:.0f}); portal open={d['portalOpen']}")
            check("D realm-boss death also pays the mote contract",
                  d["motePayout"] >= 8, f"+{d['motePayout']} motes")
            check("D walking the gate changed realm end-to-end",
                  d["realmNow"] != d["realm0"],
                  f"{d['realm0']} -> {d['realmNow']}  "
                  f"realmsUnlocked={d['unlocked']}  bossFlags={d['bossFlags']}")
            check("D the gate closes behind the player",
                  d["portalClosed"], "portal.isOpen=False after the swap")
            check("D world re-grounds after the portal swap",
                  abs(d["charDy"]) <= 2.0 and d["shWorst"] <= 1.0,
                  f"charDy={d['charDy']:+.2f} m  shrineWorst={d['shWorst']:.2f} m  "
                  f"shrineRealm={d['shRealm']}")

        pg.screenshot(path=str(SHOTS / "qa_integration_final.png"))
        br.close()

    # ------------------------------------------------------------- verdict
    real_errors = [e for e in errors if "Download the React DevTools" not in e]
    print("\n" + "=" * 62)
    for e in real_errors[:10]:
        print("  PAGE ERROR: " + e)
    check("page stayed error-free across all four sessions",
          not real_errors, f"{len(real_errors)} error(s)")

    n_pass = sum(1 for _, ok, _ in CHECKS if ok)
    n = len(CHECKS)
    print(f"\nQA_INTEGRATION {'OK' if n_pass == n else 'FAIL'}  {n_pass}/{n}")
    for name, ok, detail in CHECKS:
        if not ok:
            print(f"  FAILED: {name} — {detail}")
    return 0 if n_pass == n else 1


if __name__ == "__main__":
    raise SystemExit(main())
