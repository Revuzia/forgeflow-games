# -*- coding: utf-8 -*-
"""
qa_bodyfix.py -- port 8821. Clean-frame portraits proving the e2 clip rebuild.

Per body (cold: hailPlateGuard, glacierBrute, rimeImp; sand: boneKnight;
ash: furnaceGuardian): the proven CLEAN-FRAME instrument -- teleport the
player to (150, h, 150), hide the shrine, rig.yaw = 0, distanceTarget 2.8,
spawn the body at (150, 145.8), wake it with registry.damage, pin it there
every 50 ms, wait 2.5 s of GAME time mid-locomotion, screenshot to
_shots/bodyfix_<key>.png. Also reports the live skinned bbox (CPU shader
emulation) so "feet on ground" is a NUMBER, not just a picture.
"""
import json
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
SHOTS = Path(__file__).resolve().parents[1] / "_shots"
PORT = 8821
GAME_URL = f"http://localhost:{PORT}/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

BODIES = [("cold", "hailPlateGuard"), ("cold", "glacierBrute"),
          ("cold", "rimeImp"), ("sand", "boneKnight"),
          ("ash", "furnaceGuardian")]

SETUP = """(async () => {
    const SF = SNOWFLOW;
    if ('REALM' !== SF.combat.enemies.vis.realm) {
        await SF.enterRealm('REALM');
    }
    return SF.combat.enemies.vis.realm;
})()"""

SHOOT = """(async () => {
    const SF = SNOWFLOW, en = SF.combat.enemies, reg = SF.combat.registry;
    const enc = SF.combat.encounters, c = SF.character;
    enc._nextSpawnAt = reg.time + 1e9;
    enc._clearAll();
    const px = 150, pz = 150;
    const ph = SF.terrain.heightAt(px, pz);
    c.position.x = px; c.position.y = ph; c.position.z = pz;
    if (c.velocity) { c.velocity.x = 0; c.velocity.y = 0; c.velocity.z = 0; }
    if (SF.shrine && SF.shrine.mesh) SF.shrine.mesh.visible = false;
    SF.rig.yaw = 0;
    SF.rig.distanceTarget = 2.8;

    const bx = 150, bz = 145.8;
    const id = en.spawn('KEY', bx, bz, 10);
    if (id < 0) return { err: 'spawn failed' };
    reg.damage(id, 1, {});
    let slot = -1;
    for (let i = 0; i < en.id.length; i++) {
        if (en.alive[i] && en.id[i] === id) { slot = i; break; }
    }
    if (slot < 0) return { err: 'no slot for id ' + id };
    const by = SF.terrain.heightAt(bx, bz);
    const pin = setInterval(() => {
        en.x[slot] = bx; en.z[slot] = bz; en.y[slot] = by;
        c.position.x = px; c.position.z = pz;
    }, 50);

    const gameWait = (sec) => new Promise((res) => {
        const t0 = reg.time;
        const tick = () => (reg.time - t0 >= sec) ? res()
            : requestAnimationFrame(tick);
        tick();
    });
    await gameWait(2.5);

    // live skinned bbox, CPU-emulating the shader (bindMatrix = identity)
    const v = en.vis;
    let inst = null;
    for (let i = 0; i < v._slotInst.length; i++) {
        if (v._slotInst[i] && v._slotInst[i].slot === i && v.used[i]
            && v._slotKey[i] === 'KEY') inst = v._slotInst[i];
    }
    let bbox = null;
    if (inst) {
        const bm = inst.skeleton.boneMatrices;
        const g = inst.mesh.geometry;
        const pos = g.attributes.position, jix = g.attributes.skinIndex,
              wts = g.attributes.skinWeight;
        let mnY = 1e9, mxY = -1e9, mnX = 1e9, mxX = -1e9, nan = 0;
        for (let vi = 0; vi < pos.count; vi += 5) {
            const px2 = pos.getX(vi), py = pos.getY(vi), pz2 = pos.getZ(vi);
            let oy = 0, ox = 0, ws = 0;
            for (let k = 0; k < 4; k++) {
                const w = k === 0 ? wts.getX(vi) : k === 1 ? wts.getY(vi)
                    : k === 2 ? wts.getZ(vi) : wts.getW(vi);
                if (w === 0) continue;
                const j = k === 0 ? jix.getX(vi) : k === 1 ? jix.getY(vi)
                    : k === 2 ? jix.getZ(vi) : jix.getW(vi);
                const o = j * 16;
                ox += w * (bm[o] * px2 + bm[o + 4] * py + bm[o + 8] * pz2 + bm[o + 12]);
                oy += w * (bm[o + 1] * px2 + bm[o + 5] * py + bm[o + 9] * pz2 + bm[o + 13]);
                ws += w;
            }
            oy /= ws; ox /= ws;
            if (Number.isFinite(oy)) {
                if (oy < mnY) mnY = oy;
                if (oy > mxY) mxY = oy;
                if (ox < mnX) mnX = ox;
                if (ox > mxX) mxX = ox;
            } else nan++;
        }
        bbox = { minY: +mnY.toFixed(3), maxY: +mxY.toFixed(3),
                 heightM: +(mxY - mnY).toFixed(2),
                 widthM: +(mxX - mnX).toFixed(2), nan,
                 groundY: +by.toFixed(3),
                 feetVsGround: +(mnY - by).toFixed(3),
                 footLift: +(inst.footLift || 0).toFixed(3),
                 speed01: +v.speed01[inst.slot].toFixed(2) };
    }
    window.__pin = pin;   // cleared by CLEANUP
    return bbox || { err: 'instance not found' };
})()"""

CLEANUP = """(() => {
    if (window.__pin) { clearInterval(window.__pin); window.__pin = null; }
    const SF = SNOWFLOW;
    SF.combat.encounters._clearAll();
    return true;
})()"""


def main():
    from playwright.sync_api import sync_playwright

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
            pg.wait_for_timeout(3000)
            results = {}
            for realm, key in BODIES:
                r = pg.evaluate(SETUP.replace("REALM", realm))
                print("[%s] realm -> %s" % (key, r))
                pg.wait_for_function(
                    "() => SNOWFLOW.combat.enemies.vis.ready('%s')" % key,
                    timeout=180000)
                out = pg.evaluate(SHOOT.replace("KEY", key))
                pg.wait_for_timeout(150)
                shot = SHOTS / ("bodyfix_%s.png" % key)
                pg.screenshot(path=str(shot))
                pg.evaluate(CLEANUP)
                results[key] = out
                print("  %s" % json.dumps(out))
                print("  shot -> %s" % shot)
            br.close()
            ok = all(isinstance(r, dict) and "feetVsGround" in r
                     for r in results.values())
            print("\nRESULT:", "ALL BODIES MEASURED" if ok else "INCOMPLETE")
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
