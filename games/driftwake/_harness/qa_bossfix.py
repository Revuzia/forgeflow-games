# -*- coding: utf-8 -*-
"""
qa_bossfix.py -- the three arena-director defects, measured on the live game.

A. LEASH RE-SEAT. Chip a boss, arm real fight state on it (stance bar chipped,
   chill stacks, Brittle window, stance-break window, a slow CC and its §5.3
   diminishing-returns counter), then force FOUR leash returns and read the
   same columns back. Asserts the state SURVIVES the re-seat, and that the 20%
   regen is rate-limited: at most two heals per emergence, never two inside
   25 s of game time.

B. GATE RECOVERY. Kill a realm boss, take the DEV realm key to another realm
   and come back. Asserts the gate is still there, at the same spot, with the
   same destination -- and that it still works when walked into.

C. THE RING. cold -> sand -> ash -> cold, through gates only. Ash's `next` is
   null in realms.js, so the last hop is the deliberate ring closure.

Nothing here is a wall-clock sleep: every wait is game time off
`SNOWFLOW.combat.registry.time` / the director's own clock, driven by rAF.

    python _harness/qa_bossfix.py            # starts its own server on 8913
"""
import json
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parents[3]
PORT = 8913
GAME_URL = "http://localhost:%d/games/driftwake/index.html?autoplay&test" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

# --------------------------------------------------------------------------
# Shared JS prelude. Every helper below is game-time driven.
# --------------------------------------------------------------------------
PRELUDE = r"""
const SF = globalThis.SNOWFLOW;
const reg = SF.combat.registry;
const B = SF.combat.bosses;
const P = SF.portal;
const C = SF.character;

const frame = () => new Promise(r =>
    requestAnimationFrame(() => requestAnimationFrame(r)));

/** Wait N seconds of REGISTRY game time. */
const gwait = (sec) => new Promise(res => {
    const t0 = reg.time;
    const tick = () => (reg.time - t0 >= sec) ? res() : requestAnimationFrame(tick);
    tick();
});
/** Wait N seconds of DIRECTOR game time -- the clock the regen limit uses. */
const bwait = (sec) => new Promise(res => {
    const t0 = B.time;
    const tick = () => (B.time - t0 >= sec) ? res() : requestAnimationFrame(tick);
    tick();
});

/** Force this realm's boss, retrying while its body streams in. */
async function forceBoss(kind, tries) {
    for (let t = 0; t < (tries || 60); t++) {
        if (B.spawnBoss(kind)) { await frame(); return true; }
        await gwait(0.4);
    }
    return false;
}

/** Every column the re-seat used to wipe, read straight off the boss slot. */
function snap() {
    const id = B.bossId, s = reg.slot(id);
    if (s < 0) return null;
    return {
        id: id, hp: +reg.hp[s].toFixed(3), hpMax: +reg.hpMax[s].toFixed(3),
        poise: +reg.poise[s].toFixed(3), poiseMax: +reg.poiseMax[s].toFixed(3),
        chill: reg.chill[s], chillAt: +reg.chillAt[s].toFixed(3),
        brittleUntil: +reg.brittleUntil[s].toFixed(3),
        breakUntil: +reg.breakUntil[s].toFixed(3),
        lastPoiseHitAt: +reg.lastPoiseHitAt[s].toFixed(3),
        stunUntil: +reg.stunUntil[s].toFixed(3),
        slowUntil: +reg.slowUntil[s].toFixed(3),
        slowFrac: +reg.slowFrac[s].toFixed(3),
        drSlow: reg._drCount[s * 4 + 3],
        drSlowStart: +reg._drStart[s * 4 + 3].toFixed(3),
        regTime: +reg.time.toFixed(2), dirTime: +B.time.toFixed(2),
        leashReturns: B.leashReturns, regenTicks: B.regenTicks,
        regenSpent: B.regenSpent, lastRegenAt: +B.lastRegenAt.toFixed(2),
        lastRegenFrac: +B.lastRegenFrac.toFixed(4),
        reseatFrom: B.reseatFrom, reseatTo: B.reseatTo,
    };
}

/** Put real fight state on the boss, and PIN it at the arena so the only
 *  leash crossings are the ones this probe forces. The pin is written
 *  straight into stunUntil, which is itself one of the carried columns. */
function arm() {
    const id = B.bossId, s = reg.slot(id);
    if (s < 0) return false;
    reg.damage(id, 1, { poise: 1e6 });                 // break stance
    reg.damage(id, 1, { poise: 60 });                  // then chip the bar
    for (let k = 0; k < 7; k++) reg.damage(id, 1, { chill: true });
    reg.damage(id, 1, { cc: "slow", ccDur: 60, ccMag: 0.4 });
    reg.damage(id, 1, { cc: "slow", ccDur: 60, ccMag: 0.4 });
    reg.stunUntil[s] = reg.time + 900;                 // pin the body
    return true;
}

/** Force ONE leash crossing by moving the arena out from under the boss. */
async function leash(dx) {
    B.ax += dx;
    await frame();
    await frame();
}

function tp(x, z) {
    C.position.set(x, SF.terrain.heightAt(x, z), z);
    if (C.velocity) C.velocity.set(0, 0, 0);
}

/** Walk into the standing gate: stand outside it (arming it), then step in.
 *  `P.stats.entered` cannot be sampled from outside -- onEnter runs the realm
 *  change synchronously, and setRealm closes the gate (clearing the latch)
 *  before this function gets another frame. So WRAP onEnter and record the
 *  fire itself, which is the real observable. */
async function enterGate() {
    const st = P.stats;
    tp(st.x + 14, st.z);
    await frame(); await frame();
    const armed = P.stats.armed;
    let fired = null;
    const orig = P.onEnter;
    P.onEnter = (t) => { fired = t; if (orig) orig(t); };
    tp(st.x, st.z);
    await frame(); await frame(); await frame();
    return { armed: armed, fired: fired };
}

async function waitRealm(token, maxS) {
    const t0 = reg.time;
    while (reg.time - t0 < (maxS || 40)) {
        if (B.realm === token) return true;
        await frame();
    }
    return false;
}

/** Kill the live boss outright and let _onDeath land. */
async function killBoss() {
    const id = B.bossId;
    reg.damage(id, 1e9, {});
    for (let i = 0; i < 8; i++) await frame();
    return B.kills;
}
"""

# --------------------------------------------------------------------------
# A -- leash re-seat: state carry + regen rate limit
# --------------------------------------------------------------------------
JS_A = PRELUDE + r"""
(async () => {
    // The MINI boss, deliberately: cold's realm boss is the Shrinebreaker,
    // and roster.js:218 gives it `arenaStance: 0` (it is core-gated, not
    // stance-gated), so `damage()` skips its poise branch entirely
    // (damageable.js:246 `poiseMax[i] > 0`) and a stance-carry assertion
    // against it would be vacuous. The Icewall (roster.js:144) has
    // `arenaStance: 160` -- a real bar to chip and carry.
    if (!await forceBoss("mini")) return { err: "boss never emerged: " + B.lastRefusal };
    // A fresh spawn's registry slot lands NEXT frame; wake it before reading.
    await frame();
    reg.damage(B.bossId, 1, {});
    await frame();
    if (reg.slot(B.bossId) < 0) return { err: "no boss slot" };

    // Chip it to ~55% so the heal has room and nothing dies mid-probe.
    const s0 = reg.slot(B.bossId);
    reg.damage(B.bossId, reg.hpMax[s0] * 0.45, {});
    await frame();

    const out = { realm: B.realm, key: B.stats.key, name: B.stats.name,
                  regenCdS: B.stats.regenCdS, regenMax: B.stats.regenMax,
                  leashes: [] };

    // Four crossings. #1 heals; #2 is inside the cooldown; #3 is past it and
    // spends the last of the budget; #4 is past the cooldown but over budget.
    // The arena alternates so it never wanders out of the play area.
    const plan = [{ dx: 80, wait: 0 }, { dx: -80, wait: 0 },
                  { dx: 80, wait: 26 }, { dx: -80, wait: 26 }];
    for (let i = 0; i < plan.length; i++) {
        if (plan[i].wait) await bwait(plan[i].wait);
        // Re-arm immediately before each crossing so the before/after window
        // is two frames -- boss stance regen (3 s idle) can't muddy it.
        arm();
        await frame();
        const before = snap();
        await leash(plan[i].dx);
        const after = snap();
        if (!before || !after) { out.err = "lost the boss at leash " + (i + 1); break; }
        out.leashes.push({
            n: i + 1, waitedS: plan[i].wait, before: before, after: after,
            idRetired: before.id !== after.id,
            swapPublished: after.reseatFrom === before.id && after.reseatTo === after.id,
            carried: {
                poise: after.poise === before.poise,
                chill: after.chill === before.chill,
                chillAt: after.chillAt === before.chillAt,
                brittleUntil: after.brittleUntil === before.brittleUntil,
                breakUntil: after.breakUntil === before.breakUntil,
                lastPoiseHitAt: after.lastPoiseHitAt === before.lastPoiseHitAt,
                stunUntil: after.stunUntil === before.stunUntil,
                slowUntil: after.slowUntil === before.slowUntil,
                slowFrac: after.slowFrac === before.slowFrac,
                drSlow: after.drSlow === before.drSlow,
                drSlowStart: after.drSlowStart === before.drSlowStart,
            },
            hasStanceBar: before.poiseMax > 0,
            nonVacuous: {
                // Gated on the body actually having a stance bar -- see the
                // Shrinebreaker note above.
                poiseChipped: before.poiseMax <= 0 || before.poise < before.poiseMax,
                breakSet: before.poiseMax <= 0 || before.breakUntil > 0,
                chillUp: before.chill > 0,
                brittleLive: before.brittleUntil > before.regTime,
                slowLive: before.slowUntil > before.regTime,
                drCounted: before.drSlow >= 2,
            },
            healed: after.regenTicks > before.regenTicks,
            hpDelta: +(after.hp - before.hp).toFixed(2),
            hpMaxSame: after.hpMax === before.hpMax,
        });
    }
    out.final = { leashReturns: B.leashReturns, regenTicks: B.regenTicks,
                  regenSpent: B.regenSpent };

    // CONTROL -- what a re-seat used to hand back. Spawn the SAME arena clone
    // through the same public call `_leashHome` makes and read the raw slot:
    // this is exactly `registry.register()`'s initialisation
    // (damageable.js:135-160), i.e. the state the old despawn+respawn returned
    // before the carry existed. Measured, not assumed.
    const clone = B._clones[B.row ? B.row.combatKey : out.key];
    if (clone) {
        const cid = SF.combat.enemies.spawn(clone.index, B.ax + 6, B.az + 6,
                                            B.bossLevel);
        await frame();
        const cs = reg.slot(cid);
        if (cs >= 0) {
            out.freshSpawnControl = {
                poise: reg.poise[cs], poiseMax: reg.poiseMax[cs],
                chill: reg.chill[cs], brittleUntil: reg.brittleUntil[cs],
                breakUntil: reg.breakUntil[cs],
                lastPoiseHitAt: reg.lastPoiseHitAt[cs],
                stunUntil: reg.stunUntil[cs], slowUntil: reg.slowUntil[cs],
                drSlow: reg._drCount[cs * 4 + 3],
            };
        }
        SF.combat.enemies.despawn(cid);
    }
    return out;
})()"""

# --------------------------------------------------------------------------
# B -- gate recovery across a DEV realm key
# --------------------------------------------------------------------------
JS_B = PRELUDE + r"""
(async () => {
    B.clearBoss();
    await frame();
    const home = B.realm;
    if (!await forceBoss("realm")) return { err: "boss never emerged: " + B.lastRefusal };
    await frame();
    reg.damage(B.bossId, 1, {});
    await frame();
    await killBoss();

    const g1 = Object.assign({}, P.stats);
    const realmsNext = B.stats.realmsNext;      // realms.js, verbatim
    const ringNext = B.stats.nextRealm;         // after the ring closure
    if (!g1.open) return { err: "no gate after the realm-boss kill", realm: home };

    // The DEV key (main.js: Digit6 -> enterRealm) -- the exact path that used
    // to destroy a standing gate forever.
    const other = home === "sand" ? "ash" : "sand";
    await SF.enterRealm(other);
    await frame();
    const away = { realm: B.realm, portalOpen: P.stats.open,
                   gateStillRecorded: !!B.stats.gates[home] };

    // ...and back.
    await SF.enterRealm(home);
    await frame(); await frame();
    const g2 = Object.assign({}, P.stats);

    // Does the recovered gate still WORK?
    const walk = await enterGate();
    const arrived = await waitRealm(g1.token, 45);

    return {
        realm: home, realmsNext: realmsNext, ringNext: ringNext,
        gateAtKill: { open: g1.open, token: g1.token,
                      x: +g1.x.toFixed(2), z: +g1.z.toFixed(2) },
        away: away,
        gateAfterReturn: { open: g2.open, token: g2.token,
                           x: +g2.x.toFixed(2), z: +g2.z.toFixed(2) },
        samePlace: Math.abs(g1.x - g2.x) < 0.01 && Math.abs(g1.z - g2.z) < 0.01,
        sameToken: g1.token === g2.token,
        walk: walk, arrivedIn: B.realm, arrived: arrived,
    };
})()"""

# --------------------------------------------------------------------------
# C -- the full ring, through gates only
# --------------------------------------------------------------------------
JS_C = PRELUDE + r"""
(async () => {
    const hops = [];
    // Start from cold whatever B just did.
    if (B.realm !== "cold") {
        await SF.enterRealm("cold");
        await frame();
    }
    for (let h = 0; h < 3; h++) {
        const from = B.realm;
        B.clearBoss(true);
        await frame();
        let gate = P.stats.open ? Object.assign({}, P.stats) : null;
        if (!gate) {
            // No standing gate here -- earn one.
            if (!await forceBoss("realm")) {
                hops.push({ from: from, err: "no boss: " + B.lastRefusal });
                break;
            }
            await frame();
            reg.damage(B.bossId, 1, {});
            await frame();
            await killBoss();
            gate = P.stats.open ? Object.assign({}, P.stats) : null;
        }
        if (!gate) { hops.push({ from: from, err: "no gate after kill" }); break; }
        const walk = await enterGate();
        const ok = await waitRealm(gate.token, 45);
        hops.push({ from: from, gateToken: gate.token, armed: walk.armed,
                    fired: walk.fired, arrived: B.realm, ok: ok,
                    realmsNext: from === "ash" ? "(null - ring closure)" : gate.token });
        if (!ok) break;
    }
    return { hops: hops, endedIn: B.realm,
             gates: Object.keys(B.stats.gates) };
})()"""


def show(title, data):
    print("\n" + "=" * 72)
    print(title)
    print("=" * 72)
    print(json.dumps(data, indent=2)[:9000])


def verdict_a(a):
    """Print PASS/FAIL lines for section A."""
    ok = True
    if a.get("err"):
        print("  FAIL  %s" % a["err"])
        return False
    for L in a["leashes"]:
        bad_carry = [k for k, v in L["carried"].items() if not v]
        vac = [k for k, v in L["nonVacuous"].items() if not v]
        tag = "leash #%d (waited %ss)" % (L["n"], L["waitedS"])
        if bad_carry:
            print("  FAIL  %s WIPED: %s" % (tag, ", ".join(bad_carry)))
            ok = False
        else:
            print("  PASS  %s carried all 11 fight-state columns" % tag)
        if vac:
            print("  FAIL  %s vacuous (state was never set): %s" % (tag, ", ".join(vac)))
            ok = False
        if L["idRetired"] and not L["swapPublished"]:
            print("  FAIL  %s retired id %d without publishing the swap"
                  % (tag, L["before"]["id"]))
            ok = False
        elif L["idRetired"]:
            print("  ....  %s id %d -> %d, swap published (reseatFrom/reseatTo)"
                  % (tag, L["before"]["id"], L["after"]["id"]))
        print("  ....  %s healed=%s  hpDelta=%+.2f  regenTicks=%d"
              % (tag, L["healed"], L["hpDelta"], L["after"]["regenTicks"]))
    heals = [L for L in a["leashes"] if L["healed"]]
    if a["final"]["regenTicks"] <= a["regenMax"]:
        print("  PASS  regen fired %d time(s) over %d leash returns (cap %d)"
              % (a["final"]["regenTicks"], a["final"]["leashReturns"], a["regenMax"]))
    else:
        print("  FAIL  regen fired %d times, cap is %d"
              % (a["final"]["regenTicks"], a["regenMax"]))
        ok = False
    ctl = a.get("freshSpawnControl")
    if ctl:
        L1 = a["leashes"][0]["before"]
        print("  ....  CONTROL, a fresh registry slot (what the old re-seat "
              "handed back): poise=%s/%s chill=%s brittleUntil=%s breakUntil=%s "
              "drSlow=%s" % (ctl["poise"], ctl["poiseMax"], ctl["chill"],
                             ctl["brittleUntil"], ctl["breakUntil"], ctl["drSlow"]))
        print("  ....  vs the CARRIED boss at leash #1: poise=%s/%s chill=%s "
              "brittleUntil=%s breakUntil=%s drSlow=%s"
              % (L1["poise"], L1["poiseMax"], L1["chill"], L1["brittleUntil"],
                 L1["breakUntil"], L1["drSlow"]))
        differs = (ctl["poise"] != L1["poise"] or ctl["chill"] != L1["chill"]
                   or ctl["brittleUntil"] != L1["brittleUntil"]
                   or ctl["breakUntil"] != L1["breakUntil"]
                   or ctl["drSlow"] != L1["drSlow"])
        print("  %s  the carry is doing real work (control differs from carried)"
              % ("PASS" if differs else "FAIL"))
        ok = ok and differs
    times = [L["after"]["dirTime"] for L in heals]
    for i in range(1, len(times)):
        gap = times[i] - times[i - 1]
        if gap < a["regenCdS"]:
            print("  FAIL  two heals %.1f s apart (cooldown %s s)" % (gap, a["regenCdS"]))
            ok = False
        else:
            print("  PASS  heals %.1f s apart (cooldown %s s)" % (gap, a["regenCdS"]))
    # the non-healing crossings must still have come home at the same HP
    for L in a["leashes"]:
        if not L["healed"] and abs(L["hpDelta"]) > 0.01:
            print("  FAIL  leash #%d did not heal but HP moved %+.2f"
                  % (L["n"], L["hpDelta"]))
            ok = False
    return ok


def verdict_b(b):
    ok = True
    if b.get("err"):
        print("  FAIL  %s" % b["err"])
        return False
    print("  ....  realms.js nextRealm(%s) = %r, ring destination = %r"
          % (b["realm"], b["realmsNext"], b["ringNext"]))
    for label, cond in (
        ("gate opened on the realm-boss kill", b["gateAtKill"]["open"]),
        ("gate stopped drawing in the other realm", not b["away"]["portalOpen"]),
        ("gate record survived the realm change", b["away"]["gateStillRecorded"]),
        ("gate CAME BACK on re-entry", b["gateAfterReturn"]["open"]),
        ("same spot", b["samePlace"]),
        ("same destination", b["sameToken"]),
        ("recovered gate armed", b["walk"]["armed"]),
        ("recovered gate fired onEnter for the right realm",
         b["walk"]["fired"] == b["gateAtKill"]["token"]),
        ("it actually moved the player's realm", b["arrived"]),
    ):
        print("  %s  %s" % ("PASS" if cond else "FAIL", label))
        ok = ok and bool(cond)
    return ok


def verdict_c(c):
    ok = True
    want = ["cold", "sand", "ash"]
    if len(c["hops"]) != 3:
        print("  FAIL  only %d of 3 hops completed" % len(c["hops"]))
        ok = False
    for i, h in enumerate(c["hops"]):
        if h.get("err"):
            print("  FAIL  hop %d from %s: %s" % (i + 1, h["from"], h["err"]))
            ok = False
            continue
        good = h["ok"] and h["from"] == want[i] and h["arrived"] == h["gateToken"]
        print("  %s  hop %d: %s --gate--> %s (arrived %s)"
              % ("PASS" if good else "FAIL", i + 1, h["from"], h["gateToken"],
                 h["arrived"]))
        ok = ok and good
    print("  %s  ring closed back in %s"
          % ("PASS" if c["endedIn"] == "cold" else "FAIL", c["endedIn"]))
    ok = ok and c["endedIn"] == "cold"
    return ok


def main():
    from playwright.sync_api import sync_playwright

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    results = {}
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=180000)
            pg.wait_for_timeout(2500)

            a = pg.evaluate(JS_A)
            show("A -- LEASH RE-SEAT: fight-state carry + regen rate limit", a)
            print("\nVERDICT A")
            results["A"] = verdict_a(a)

            b = pg.evaluate(JS_B)
            show("B -- GATE RECOVERY across a DEV realm key", b)
            print("\nVERDICT B")
            results["B"] = verdict_b(b)

            c = pg.evaluate(JS_C)
            show("C -- THE RING: cold -> sand -> ash -> cold, gates only", c)
            print("\nVERDICT C")
            results["C"] = verdict_c(c)

            if errs:
                print("\nPAGE ERRORS (%d):" % len(errs))
                for e in errs[:10]:
                    print("  " + e)
                results["noPageErrors"] = False
            else:
                print("\n  PASS  zero page errors")
                results["noPageErrors"] = True
            br.close()
    finally:
        srv.terminate()

    print("\n" + "=" * 72)
    for k, v in results.items():
        print("  %-14s %s" % (k, "PASS" if v else "FAIL"))
    print("=" * 72)
    sys.exit(0 if all(results.values()) else 1)


if __name__ == "__main__":
    main()
