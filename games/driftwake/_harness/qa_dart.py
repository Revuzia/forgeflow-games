# -*- coding: utf-8 -*-
"""
qa_dart.py -- primary-filler verification battery, on the live game.

BINDS UNDER TEST (owner 2026-08-12): LMB = BOLT (spells.cast key 6, 0.45 s
fire cycle, no cooldown), Digit1 = FROST ARC (spells.cast key 7, 1.5 s
cooldown through _cdUntil).

  bolt     pinned brute at 6 m. One cast(6) must put a live projectile in
           the Dart pool (bolt.liveCount 0 -> >0) BEFORE it lands; a 5-cast
           volley at exact aim must land damage; two back-to-back casts
           inside the 0.45 s fire cycle must spawn ONE projectile (rate
           limit), and _boltNext must advance past _time.
  arc      three imps at 5/6.5/8 m spread across ~50 deg frontal -- ONE
           cast(7) hits ALL THREE; a fourth imp 15 deg BEHIND is NOT hit.
           arcGen must bump by exactly 1, and _cdUntil[7] must land at
           ~_time + 1.5. An immediate second cast(7) must be swallowed by
           the cooldown (arcGen unchanged).

All waits are GAME-TIME (registry.time polled via rAF). Absolute hp numbers
scale with the level band and progression damageMult; deltas > 0 and the
per-target hit/no-hit pattern are the reading.
"""
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = Path(__file__).resolve()
ROOT = HERE.parents[3]
GAME = HERE.parents[1]
PORT = 8799
GAME_URL = f"http://localhost:{PORT}/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

SETUP_JS = """(async () => {
    const SF = SNOWFLOW, reg = SF.combat.registry, en = SF.combat.enemies;
    const ch = SF.character;
    if (SF.shrine && SF.shrine.mesh) SF.shrine.mesh.visible = false;
    SF.rig.yaw = 0; SF.rig.distanceTarget = 2.8;
    if (SF.combat.encounters) {
        SF.combat.encounters._nextSpawnAt = Infinity;
        if (SF.combat.encounters._clearAll) SF.combat.encounters._clearAll();
    }
    en.clear();
    window.__gameWait = (sec) => new Promise((res) => {
        const t0 = reg.time;
        const tick = () => (reg.time - t0 >= sec) ? res()
            : requestAnimationFrame(tick);
        tick();
    });
    // Player pin: keeps the caster planted and alive; retargetable per phase.
    window.__pp = { x: 150, z: 150 };
    window.__setPin = (x, z) => {
        window.__pp.x = x; window.__pp.z = z;
        ch.position.x = x; ch.position.y = SF.terrain.heightAt(x, z);
        ch.position.z = z;
    };
    window.__setPin(150, 150);
    window.__pinP = setInterval(() => {
        ch.position.x = window.__pp.x; ch.position.z = window.__pp.z;
        ch.health = 100;
    }, 50);
    await window.__gameWait(0.3);
    return { realm: SF.spells.ctx.realm.key,
             boltLive: SF.spells.bolt.liveCount,
             cd7: SF.spells._cdUntil[7] || 0 };
})()"""

BOLT_JS = """(async () => {
    const SF = SNOWFLOW, reg = SF.combat.registry, en = SF.combat.enemies;
    const sp = SF.spells, bolt = sp.bolt;
    const px = 150, pz = 150, bx = px, bz = pz - 6;
    en.clear();
    const id = en.spawn('glacierBrute', bx, bz, 1);
    if (id < 0) return { err: 'spawn failed' };
    let es = -1;
    for (let i = 0; i < en.x.length; i++)
        if (en.alive[i] && en.id[i] === id) { es = i; break; }
    const by = en.y[es];
    const pin = setInterval(() => { en.x[es] = bx; en.z[es] = bz; en.y[es] = by; }, 50);
    await window.__gameWait(0.4);            // registry slot lands next frame

    const aimAt = (errDeg) => {
        const eye = SF.rig.camera.position;
        const cs = reg.slot(id);
        const ty = reg.y[cs] + reg.height[cs] * 0.6;
        let dx = reg.x[cs] - eye.x, dy = ty - eye.y, dz = reg.z[cs] - eye.z;
        const e = errDeg * Math.PI / 180;
        const c = Math.cos(e), si = Math.sin(e);
        const rx = dx * c - dz * si, rz = dx * si + dz * c;
        const l = Math.hypot(rx, dy, rz) || 1;
        sp.aim.set(rx / l, dy / l, rz / l);
    };

    // --- projectile check: ONE cast puts a live dart in the pool ---
    aimAt(0);
    const live0 = bolt.liveCount;
    sp.cast(6);
    // read the pool inside the flight window (6 m at dart speed >> 1 frame)
    await window.__gameWait(0.05);
    const liveAfterCast = bolt.liveCount;
    const nextGap = +(sp._boltNext - sp._time).toFixed(3);

    // --- rate limit: a second cast inside the 0.45 s cycle is swallowed ---
    sp.cast(6);
    const liveAfterSpam = bolt.liveCount;
    await window.__gameWait(0.6);            // let both windows drain

    // --- volley: 5 casts at exact aim must land damage ---
    const hp0 = reg.hp[reg.slot(id)];
    for (let k = 0; k < 5; k++) {
        aimAt(0);
        sp.cast(6);
        await window.__gameWait(0.55);       // > BOLT_CYCLE, all 5 legal
    }
    await window.__gameWait(0.4);
    const hpDelta = +(hp0 - reg.hp[reg.slot(id)]).toFixed(2);

    clearInterval(pin);
    en.clear();
    return { live0, liveAfterCast, liveAfterSpam, nextGap,
             volleyCasts: 5, hpDelta };
})()"""

ARC_JS = """(async () => {
    const SF = SNOWFLOW, reg = SF.combat.registry, en = SF.combat.enemies;
    const sp = SF.spells;
    const px = 250, pz = 250;
    window.__setPin(px, pz);
    en.clear();
    await window.__gameWait(1.0);

    const place = (aDeg, r) => {
        const a = aDeg * Math.PI / 180;
        return [px + r * Math.sin(a), pz - r * Math.cos(a)];
    };
    const spec = [
        { name: 'left25_5m',   a: -25, r: 5   },
        { name: 'center_6.5m', a: 0,   r: 6.5 },
        { name: 'right25_8m',  a: 25,  r: 8   },
        { name: 'behind15deg', a: 165, r: 5   },
    ];
    const imps = [];
    for (const s of spec) {
        const [x, z] = place(s.a, s.r);
        const id = en.spawn('rimeImp', x, z, 1);
        if (id < 0) return { err: 'imp spawn failed: ' + s.name };
        let es = -1;
        for (let i = 0; i < en.x.length; i++)
            if (en.alive[i] && en.id[i] === id) { es = i; break; }
        imps.push({ s, id, es, x, z, y: en.y[es] });
    }
    const pin = setInterval(() => {
        for (const im of imps) {
            en.x[im.es] = im.x; en.z[im.es] = im.z; en.y[im.es] = im.y;
        }
    }, 50);
    await window.__gameWait(0.4);            // registry slots land

    const hp0 = imps.map((im) => reg.hp[reg.slot(im.id)]);
    const gen0 = sp.arcGen;
    sp.aim.set(0, -0.1, -1);
    sp.cast(7);                              // ONE arc cast, on the NEW key
    const cdAfter = +((sp._cdUntil[7] || 0) - sp._time).toFixed(3);
    const gen1 = sp.arcGen;
    sp.cast(7);                              // must be swallowed by cooldown
    const gen2 = sp.arcGen;
    await window.__gameWait(0.4);

    const rows = imps.map((im, i) => ({
        target: im.s.name,
        hpBefore: +hp0[i].toFixed(2),
        hpDelta: +(hp0[i] - reg.hp[reg.slot(im.id)]).toFixed(2),
    }));
    clearInterval(pin);
    en.clear();
    return { rows, cdAfter, arcGenBump: gen1 - gen0,
             spamSwallowed: gen2 === gen1 };
})()"""


def main():
    from playwright.sync_api import sync_playwright
    import json

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=120000)
            pg.wait_for_timeout(2000)
            print("== setup:", json.dumps(pg.evaluate(SETUP_JS)))

            b = pg.evaluate(BOLT_JS)
            print("== bolt (LMB / cast 6):", json.dumps(b))
            fails = []
            if "err" in b:
                fails.append("bolt: " + b["err"])
            else:
                if not (b["liveAfterCast"] > b["live0"]):
                    fails.append(f"bolt: no projectile in pool after cast "
                                 f"(live {b['live0']} -> {b['liveAfterCast']})")
                if b["liveAfterSpam"] > b["liveAfterCast"]:
                    fails.append(f"bolt: fire-cycle rate limit leaked "
                                 f"(live {b['liveAfterCast']} -> {b['liveAfterSpam']})")
                if not (0 < b["nextGap"] <= 0.46):
                    fails.append(f"bolt: _boltNext gap {b['nextGap']} "
                                 f"not in (0, 0.46]")
                if not (b["hpDelta"] > 0):
                    fails.append(f"bolt: 5-cast volley landed {b['hpDelta']} hp")
                print(f"BOLT projectile: live {b['live0']} -> {b['liveAfterCast']}"
                      f" (spam {b['liveAfterSpam']}), cycle gap {b['nextGap']} s,"
                      f" volley hpDelta {b['hpDelta']}"
                      f"  {'PASS' if not fails else 'FAIL'}")

            a = pg.evaluate(ARC_JS)
            print("== arc (Digit1 / cast 7):", json.dumps(a, indent=1))
            if "err" in a:
                fails.append("arc: " + a["err"])
            else:
                for r in a["rows"]:
                    if r["target"] == "behind15deg":
                        if r["hpDelta"] > 0.01:
                            fails.append(f"arc: hit the behind imp "
                                         f"({r['hpDelta']} hp)")
                    elif not (r["hpDelta"] > 0):
                        fails.append(f"arc: missed {r['target']} "
                                     f"(delta {r['hpDelta']})")
                if not (1.3 <= a["cdAfter"] <= 1.55):
                    fails.append(f"arc: cooldown {a['cdAfter']} s "
                                 f"not ~1.5 after cast")
                if a["arcGenBump"] != 1:
                    fails.append(f"arc: arcGen bumped {a['arcGenBump']} "
                                 f"(want 1)")
                if not a["spamSwallowed"]:
                    fails.append("arc: second cast inside cooldown re-fired")
                front = [r["hpDelta"] for r in a["rows"][:3]]
                print(f"ARC spread: frontal deltas {front}, behind "
                      f"{a['rows'][3]['hpDelta']}, cd {a['cdAfter']} s, "
                      f"gen +{a['arcGenBump']}, spam swallowed "
                      f"{a['spamSwallowed']}")

            br.close()
    finally:
        srv.terminate()

    if fails:
        print("RESULT: FAIL")
        for f in fails:
            print("  FAIL", f)
        sys.exit(1)
    print("RESULT: OK")


if __name__ == "__main__":
    main()
