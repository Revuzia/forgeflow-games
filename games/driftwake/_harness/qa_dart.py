# -*- coding: utf-8 -*-
"""
qa_dart.py -- LMB verification battery, on the live game.

PART A (ran 2026-08-11 against the OLD dart, verdict: owner report confirmed):
five casts at EXACT chest aim landed 1.84 hp of a possible ~60; 1.5 deg error
16.32; 4 deg error 12.44. The dart whiffed even a perfect aim at 6 m.

PART B (this battery, against the FROST ARC redesign):
  volley   the same pinned-brute volley -- the arc must land its damage at
           exact aim AND at 1.5/4 deg error (forgiveness). NOTE: absolute
           hp numbers scale with the level band and the player's progression
           damageMult; the per-cast ratio is the reading.
  arc      run on a FRESH deform window (player teleported 100 m): three
           imps at 5/6.5/8 m spread across ~50 deg frontal -- ONE cast hits
           ALL THREE; a fourth imp 15 deg BEHIND is NOT hit. Ice channel
           (deform state alpha) read at swept points BEFORE and AFTER the
           cast: after > 0.3, behind stays ~0. Readback instrument validated
           zero-before/0.899-after in _harness/qa_arcdiag.py.
  slow     a woken GLACIER BRUTE's approach speed before vs after one arc:
           must drop 35%+. A brute, not an imp: the arc's 10 poise equals an
           imp's whole poise bar, and the poise-break stagger (speed 0)
           swamps the slow-channel measurement (first run: 91.5% "slow").
  shot     _shots/frostarc.png -- the fan mid-flight over the glazed ground.

All waits are GAME-TIME (registry.time polled via rAF).
"""
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = Path(__file__).resolve()
ROOT = HERE.parents[3]
GAME = HERE.parents[1]
PORT = 8823
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
    // Ice readback: deform state alpha channel, 3x3 max around the texel.
    window.__iceAt = (wx, wz) => {
        const d = SF.deform, size = d.size, res = d.res;
        const prev = SF.renderer.getRenderTarget();
        SF.renderer.setRenderTarget(d._pp.read);
        const gl = SF.renderer.getContext();
        const buf = new Float32Array(4);
        const u = (((wx % size) + size) % size) / size;
        const v = (((wz % size) + size) % size) / size;
        const cx = Math.floor(u * res), cy = Math.floor(v * res);
        let m = 0;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
            const sx = (cx + ox + res) % res, sy = (cy + oy + res) % res;
            gl.readPixels(sx, sy, 1, 1, gl.RGBA, gl.FLOAT, buf);
            if (buf[3] > m) m = buf[3];
        }
        SF.renderer.setRenderTarget(prev);
        return +m.toFixed(3);
    };
    await window.__gameWait(0.3);
    return { realm: SF.spells.ctx.realm.key,
             lmbName: SF.spells.ctx.realm.names.lmb,
             lmbTooltip: SF.spellbar && SF.spellbar._slot
                 ? SF.spellbar._slot[6].title : null };
})()"""

VOLLEY_JS = """(async () => {
    const SF = SNOWFLOW, reg = SF.combat.registry, en = SF.combat.enemies;
    const px = 150, pz = 150, bx = px, bz = pz - 6;
    en.clear();
    const id = en.spawn('glacierBrute', bx, bz, 1);
    if (id < 0) return { err: 'spawn failed' };
    let es = -1;
    for (let i = 0; i < en.x.length; i++)
        if (en.alive[i] && en.id[i] === id) { es = i; break; }
    const by = en.y[es];
    const pin = setInterval(() => { en.x[es] = bx; en.z[es] = bz; en.y[es] = by; }, 50);
    await window.__gameWait(0.4);

    const volley = async (errDeg) => {
        const hp0 = reg.hp[reg.slot(id)];
        for (let k = 0; k < 5; k++) {
            const eye = SF.rig.camera.position;
            const cs = reg.slot(id);
            const ty = reg.y[cs] + reg.height[cs] * 0.6;
            let dx = reg.x[cs] - eye.x, dy = ty - eye.y, dz = reg.z[cs] - eye.z;
            const e = errDeg * Math.PI / 180;
            const c = Math.cos(e), si = Math.sin(e);
            const rx = dx * c - dz * si, rz = dx * si + dz * c;
            const l = Math.hypot(rx, dy, rz) || 1;
            SF.spells.aim.set(rx / l, dy / l, rz / l);
            SF.spells.cast(6);
            await window.__gameWait(0.55);
        }
        await window.__gameWait(0.4);
        return { errDeg, casts: 5,
                 hpDelta: +(hp0 - reg.hp[reg.slot(id)]).toFixed(2) };
    };
    const out = [];
    out.push(await volley(0));
    out.push(await volley(1.5));
    out.push(await volley(4));
    clearInterval(pin);
    en.clear();
    return out;
})()"""

ARC_JS = """(async () => {
    const SF = SNOWFLOW, reg = SF.combat.registry, en = SF.combat.enemies;
    // FRESH deform window, uncontaminated by the volley phase's glaze.
    const px = 250, pz = 250;
    window.__setPin(px, pz);
    en.clear();
    await window.__gameWait(1.0);            // window recenters, edges zeroed

    const iceBefore = {
        swept4mAhead: window.__iceAt(px, pz - 4),
        swept6mAhead: window.__iceAt(px, pz - 6),
        behind6m: window.__iceAt(px, pz + 6),
    };

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
    await window.__gameWait(0.4);

    const hp0 = imps.map((im) => reg.hp[reg.slot(im.id)]);
    SF.spells.aim.set(0, -0.1, -1);
    SF.spells.cast(6);                       // ONE arc cast
    await window.__gameWait(0.4);

    const rows = imps.map((im, i) => ({
        target: im.s.name,
        hpBefore: +hp0[i].toFixed(2),
        hpDelta: +(hp0[i] - reg.hp[reg.slot(im.id)]).toFixed(2),
        speedMult: +reg.speedMult(im.id).toFixed(3),
    }));
    clearInterval(pin);
    await window.__gameWait(0.3);
    const iceAfter = {
        swept4mAhead: window.__iceAt(px, pz - 4),
        swept6mAhead: window.__iceAt(px, pz - 6),
        behind6m: window.__iceAt(px, pz + 6),
    };
    en.clear();
    return { rows, iceBefore, iceAfter };
})()"""

SLOW_JS = """(async () => {
    const SF = SNOWFLOW, reg = SF.combat.registry, en = SF.combat.enemies;
    const px = 250, pz = 250;
    en.clear();
    // A brute: poiseMax far above the arc's 10, so the slow channel is
    // measured clean of poise-break stagger.
    const id = en.spawn('glacierBrute', px, pz - 14, 1);
    if (id < 0) return { err: 'spawn failed' };
    await window.__gameWait(0.3);
    reg.damage(id, 1, {});                    // wake it
    await window.__gameWait(0.6);             // let it commit to the approach

    const pos = () => {
        const s = reg.slot(id);
        return s < 0 ? null : { x: reg.x[s], z: reg.z[s], t: reg.time };
    };
    const speedOver = async (sec) => {
        const a = pos();
        await window.__gameWait(sec);
        const b = pos();
        if (!a || !b || b.t === a.t) return -1;
        return Math.hypot(b.x - a.x, b.z - a.z) / (b.t - a.t);
    };

    const vBefore = await speedOver(1.0);
    let guard = 0;
    while (guard++ < 80) {                    // close inside the 8 m reach
        const p = pos();
        if (!p) return { err: 'brute lost' };
        if (Math.hypot(p.x - px, p.z - pz) < 7) break;
        await window.__gameWait(0.1);
    }
    const p = pos();
    let ax = p.x - px, az = p.z - pz;
    const l = Math.hypot(ax, az) || 1;
    SF.spells.aim.set(ax / l, -0.1, az / l);
    SF.spells.cast(6);
    await window.__gameWait(0.15);
    const sm = +reg.speedMult(id).toFixed(3);
    // Retreat 10 m so the brute stays in pure CHASE for the after-window:
    // its gapCloser range (8 m) equals the arc's reach, so measured at 7 m
    // it stands in its 1200 ms telegraph and reads speed 0 (first run).
    // At ~17 m it is inside perception (18 m) but outside the gap closer.
    window.__setPin(px, pz + 10);
    await window.__gameWait(0.2);
    const vAfter = await speedOver(1.2);      // slow window is 2.5 s
    en.clear();
    window.__setPin(px, pz);
    return {
        vBefore: +vBefore.toFixed(2), vAfter: +vAfter.toFixed(2),
        speedMult: sm,
        dropPct: +((1 - vAfter / vBefore) * 100).toFixed(1),
    };
})()"""

SHOT_JS = """(async () => {
    const SF = SNOWFLOW, en = SF.combat.enemies;
    en.clear();
    const px = 250, pz = 250;
    window.__setPin(px, pz);
    en.spawn('rimeImp', px - 2.2, pz - 5, 1);
    en.spawn('rimeImp', px + 2.4, pz - 6.5, 1);
    SF.rig.yaw = 0; SF.rig.distanceTarget = 5.5;
    await window.__gameWait(0.5);
    SF.spells.aim.set(0, -0.1, -1);
    SF.spells.cast(6);                        // glaze pass 1
    await window.__gameWait(0.6);
    SF.spells.cast(6);                        // the fan caught mid-flight
    // 0.05 game-s, not more: the screenshot's wall latency must land inside
    // the fan's 0.38 s flight (the 0.16 wait shot the frame after it died).
    await window.__gameWait(0.05);
    return true;
})()"""


def main():
    from playwright.sync_api import sync_playwright
    import json

    (GAME / "_shots").mkdir(exist_ok=True)
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
            print("== volley (pinned brute, 5 casts each):")
            print(json.dumps(pg.evaluate(VOLLEY_JS), indent=1))
            print("== arc (3 frontal imps + 1 behind, ONE cast) + ice:")
            print(json.dumps(pg.evaluate(ARC_JS), indent=1))
            print("== slow (brute approach speed before/after one arc):")
            print(json.dumps(pg.evaluate(SLOW_JS), indent=1))
            pg.evaluate(SHOT_JS)
            pg.screenshot(path=str(GAME / "_shots" / "frostarc.png"))
            print("== shot: _shots/frostarc.png written")
            br.close()
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
