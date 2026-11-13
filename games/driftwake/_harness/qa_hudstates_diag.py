#!/usr/bin/env python
"""Why do qa_hudstates A/B/F fail? Replay the same stimuli and dump the raw
registry SoA + enemybars pool state instead of the pass/fail booleans, so the
break is attributable to the registry, the HUD, or the probe. Read-only."""
import sys, time, json
from playwright.sync_api import sync_playwright
for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass
FLAGS = ["--ignore-gpu-blocklist","--use-angle=d3d11","--disable-gpu-sandbox",
         "--enable-gpu-rasterization","--disable-features=CalculateNativeWinOcclusion"]
URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8799/games/driftwake/index.html"

GW = """
    const reg = SNOWFLOW.combat.registry;
    const raf = () => new Promise(r => requestAnimationFrame(r));
"""

DIAG = """(async () => {""" + GW + """
    const SF = SNOWFLOW, E = SF.combat.enemies, c = SF.character;
    SF.input.locked = true;
    E.clear();
    await raf(); await raf();
    const px = c.position.x, pz = c.position.z;
    const ids = [];
    for (let k = 0; k < 3; k++) ids.push(E.spawn('rimeImp', px + 3 + k * 1.5, pz - 5, 10));
    await raf(); await raf();
    const slotsAfterSpawn = ids.map(id => reg.slot(id));
    const hpAtSpawn = ids.map(id => { const s = reg.slot(id); return s < 0 ? null : reg.hp[s]; });

    reg.damage(ids[0], 5, { chill: true, cc: 'slow', ccDur: 2.5, ccMag: 0.4 });
    const s0 = reg.slot(ids[0]);
    const afterDamage = s0 < 0 ? {slot: -1} : {
        slot: s0, hp: reg.hp[s0], chill: reg.chill[s0],
        chillAt: reg.chillAt[s0], time: reg.time,
        slowUntil: reg.slowUntil[s0], slowFrac: reg.slowFrac[s0],
        speedMult: reg.speedMult(ids[0]),
    };

    // give the HUD several frames to paint, then read the pool
    for (let n = 0; n < 10; n++) await raf();
    const eb = SF.enemyBars;
    const pool = [];
    for (let i = 0; i < eb._id.length; i++) {
        if (eb._id[i] < 0) continue;
        pool.push({poolIdx: i, id: eb._id[i], cls: eb._bar[i].className,
                   slowTxt: eb._slowEl[i].textContent});
    }

    // ---- poise break on a brute
    E.clear(); await raf(); await raf();
    const brute = E.spawn('glacierBrute', px + 3, pz - 5, 10);
    await raf(); await raf();
    const bs0 = reg.slot(brute);
    const bruteBefore = bs0 < 0 ? {slot: -1} : {slot: bs0, hp: reg.hp[bs0],
        poise: reg.poise[bs0], poiseMax: reg.poiseMax[bs0], tier: reg.tier[bs0]};
    reg.damage(brute, 10, { poise: 9999 });
    const bs = reg.slot(brute);
    const bruteAfter = bs < 0 ? {slot: -1} : {slot: bs, hp: reg.hp[bs],
        poise: reg.poise[bs], breakUntil: reg.breakUntil[bs], time: reg.time,
        breakRemaining: +(reg.breakUntil[bs] - reg.time).toFixed(2)};
    for (let n = 0; n < 10; n++) await raf();
    const brutePool = [];
    for (let i = 0; i < eb._id.length; i++) {
        if (eb._id[i] === brute) brutePool.push({poolIdx: i, cls: eb._bar[i].className});
    }

    // ---- kill floater
    const fid = E.spawn('rimeImp', px + 3, pz - 5, 10);
    await raf(); await raf();
    reg.damage(fid, 99999, {});
    for (let n = 0; n < 10; n++) await raf();
    const fl = {
        floatersEl: !!document.querySelector('#floaters'),
        allSpans: [...document.querySelectorAll('#floaters span')].map(e => e.className).slice(0, 12),
        runKill: document.querySelectorAll('#floaters .flt-t.run').length,
    };

    return {slotsAfterSpawn, hpAtSpawn, afterDamage, pool,
            bruteBefore, bruteAfter, brutePool, floaters: fl,
            playerHp: c.health, playerHpMax: c.healthMax};
})()"""

with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
    pg = br.new_page(viewport={"width":1280,"height":720})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL, wait_until="load", timeout=60000)
    end = time.time() + 120
    while time.time() < end:
        try:
            if pg.evaluate("() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime"): break
        except Exception: pass
        pg.wait_for_timeout(500)
    pg.wait_for_timeout(2500)
    print(json.dumps(pg.evaluate(DIAG), indent=1))
    print("pageerrors:", errs)
    br.close()
