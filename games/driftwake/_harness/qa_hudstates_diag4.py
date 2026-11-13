#!/usr/bin/env python
"""Pinpoint WHICH early-continue drops the enemybars status classes: replicate
enemybars' own projection for each pooled body and report camera-space z and
NDC, next to the pool's cached on/sx/sy. Read-only."""
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
    E.clear(); for (let n = 0; n < 4; n++) await raf();

    // Spawn a ring around the player so at least one body MUST be on screen.
    const px = c.position.x, pz = c.position.z, ids = [];
    for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4;
        ids.push(E.spawn('glacierBrute', px + 9 * Math.cos(a), pz + 9 * Math.sin(a), 10));
    }
    for (let n = 0; n < 4; n++) await raf();
    for (const id of ids) reg.damage(id, 10, { chill: true, cc: 'slow', ccDur: 5, ccMag: 0.4, poise: 9999 });
    for (let n = 0; n < 25; n++) await raf();

    const cam = SF.rig.camera;
    const THREE = SF.THREE || null;
    const out = [];
    for (let i = 0; i < eb._id.length; i++) {
        const id = eb._id[i];
        if (id < 0) continue;
        const s = reg.slot(id);
        if (s < 0) continue;
        // replicate enemybars' projection with plain math (no THREE needed)
        const wx = reg.x[s], wy = reg.y[s] + reg.height[s] + 0.35, wz = reg.z[s];
        const e = cam.matrixWorldInverse.elements;
        const vx = e[0]*wx + e[4]*wy + e[8]*wz + e[12];
        const vy = e[1]*wx + e[5]*wy + e[9]*wz + e[13];
        const vz = e[2]*wx + e[6]*wy + e[10]*wz + e[14];
        const pm = cam.projectionMatrix.elements;
        const cw = pm[3]*vx + pm[7]*vy + pm[11]*vz + pm[15];
        const nx = (pm[0]*vx + pm[4]*vy + pm[8]*vz + pm[12]) / cw;
        const ny = (pm[1]*vx + pm[5]*vy + pm[9]*vz + pm[13]) / cw;
        out.push({id, cls: eb._bar[i].className, on: eb._on[i],
                  camZ: +vz.toFixed(2), ndcX: +nx.toFixed(2), ndcY: +ny.toFixed(2),
                  behindCam: vz > -0.5, offScreen: (nx < -1.05 || nx > 1.05 || ny < -1.05 || ny > 1.05),
                  chill: reg.chill[s], tier: reg.tier[s],
                  breakRem: +(reg.breakUntil[s] - reg.time).toFixed(2),
                  slowFrac: +reg.slowFrac[s].toFixed(2)});
    }
    return {poolEntries: out.length, bodies: out,
            camPos: {x: +cam.position.x.toFixed(1), y: +cam.position.y.toFixed(1), z: +cam.position.z.toFixed(1)},
            player: {x: +px.toFixed(1), z: +pz.toFixed(1)}};
})()"""

with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
    pg = br.new_page(viewport={"width":1280,"height":720})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL, wait_until="load", timeout=60000)
    pg.wait_for_function("() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime", timeout=120000)
    pg.wait_for_timeout(2500)
    print(json.dumps(pg.evaluate(DIAG), indent=1))
    print("pageerrors:", errs)
    br.close()
