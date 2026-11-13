#!/usr/bin/env python
"""Disproof test for the qa_hudstates A/B/C/F failures: run the SAME stimuli
but with the camera actually framing the subjects. If the glyph classes and
the kill floater appear once the bodies are on screen, the HUD is correct and
the failures belong to the probe's framing, not to enemybars.js."""
import sys, time, json
from playwright.sync_api import sync_playwright
for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass
FLAGS = ["--ignore-gpu-blocklist","--use-angle=d3d11","--disable-gpu-sandbox",
         "--enable-gpu-rasterization","--disable-features=CalculateNativeWinOcclusion"]
URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8799/games/driftwake/index.html"

DIAG = """(async () => {
    const reg = SNOWFLOW.combat.registry;
    const raf = () => new Promise(r => requestAnimationFrame(r));
    const SF = SNOWFLOW, E = SF.combat.enemies, c = SF.character, eb = SF.enemyBars;
    SF.input.locked = true;
    E.clear(); await raf(); await raf();

    // Clean-frame recipe: park the player, aim the camera down -Z, subjects ahead.
    c.position.x = 150; c.position.z = 150;
    c.position.y = SF.terrain.heightAt(150, 150);
    SF.rig.yaw = 0; SF.rig.distanceTarget = 7;
    for (let n = 0; n < 8; n++) await raf();
    const px = c.position.x, pz = c.position.z;

    // subjects AHEAD of the camera
    const imp   = E.spawn('rimeImp',      px - 1.5, pz - 8, 10);
    const brute = E.spawn('glacierBrute', px + 1.5, pz - 8, 10);
    await raf(); await raf();
    reg.damage(imp,   5,  { chill: true, cc: 'slow', ccDur: 2.5, ccMag: 0.4 });
    reg.damage(brute, 10, { poise: 9999 });
    for (let n = 0; n < 20; n++) await raf();

    const pool = [];
    for (let i = 0; i < eb._id.length; i++) {
        if (eb._id[i] < 0) continue;
        const id = eb._id[i], s = reg.slot(id);
        pool.push({id, which: id === imp ? 'imp' : (id === brute ? 'brute' : '?'),
                   cls: eb._bar[i].className, slowTxt: eb._slowEl[i].textContent,
                   tier: s < 0 ? null : reg.tier[s],
                   speedMult: +reg.speedMult(id).toFixed(3),
                   breakRemaining: s < 0 ? null : +(reg.breakUntil[s] - reg.time).toFixed(2)});
    }

    // kill floater, on screen this time
    const k = E.spawn('rimeImp', px, pz - 8, 10);
    await raf(); await raf();
    reg.damage(k, 99999, {});
    let runSeen = 0, sawClasses = [];
    for (let n = 0; n < 30; n++) {
        await raf();
        const r = document.querySelectorAll('#floaters .flt-t.run').length;
        if (r > runSeen) runSeen = r;
        for (const e of document.querySelectorAll('#floaters span'))
            if (e.className && !sawClasses.includes(e.className)) sawClasses.push(e.className);
    }
    return {pool, killFloaterRunPeak: runSeen, floaterClassesSeen: sawClasses};
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
    pg.screenshot(path="_harness/hudstates_diag2.png")
    print("pageerrors:", errs)
    br.close()
