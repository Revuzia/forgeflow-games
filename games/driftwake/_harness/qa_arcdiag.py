# -*- coding: utf-8 -*-
"""
qa_arcdiag.py -- why did the 8 m / +25 deg imp miss the frost arc?

Prints, for each spec target: its registry y, the terrain height under it,
the player's y, the horizontal distance and bearing -- then runs the cone
membership test by hand with combatData.bolt.arc's numbers. Also probes the
deform ice channel's baseline at a FRESH window (player teleported 100 m
away) before and after one arc, so the readback instrument itself is
validated against a known-zero field.
"""
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8823
GAME_URL = f"http://localhost:{PORT}/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

JS = """(async () => {
    const SF = SNOWFLOW, reg = SF.combat.registry, en = SF.combat.enemies;
    const ch = SF.character;
    const px = 150, pz = 150;
    ch.position.x = px; ch.position.y = SF.terrain.heightAt(px, pz);
    ch.position.z = pz;
    SF.rig.yaw = 0;
    if (SF.combat.encounters) {
        SF.combat.encounters._nextSpawnAt = Infinity;
        if (SF.combat.encounters._clearAll) SF.combat.encounters._clearAll();
    }
    en.clear();
    const reg_ = reg;
    const gameWait = (sec) => new Promise((res) => {
        const t0 = reg_.time;
        const tick = () => (reg_.time - t0 >= sec) ? res()
            : requestAnimationFrame(tick);
        tick();
    });
    await gameWait(0.3);

    // SNOWFLOW.combat.data is the combatData MODULE namespace (main.js:113)
    const D = SF.combat.data.combatData.bolt.arc;
    const place = (aDeg, r) => {
        const a = aDeg * Math.PI / 180;
        return [px + r * Math.sin(a), pz - r * Math.cos(a)];
    };
    const spec = [[-25, 5], [0, 6.5], [25, 8], [165, 5]];
    const rows = [];
    for (const [aDeg, r] of spec) {
        const [x, z] = place(aDeg, r);
        const id = en.spawn('rimeImp', x, z, 1);
        const s = reg.slot(id);
        const dx = reg.x[s] - px, dz = reg.z[s] - pz;
        const d = Math.hypot(dx, dz);
        const ang = Math.acos(Math.max(-1, Math.min(1,
            (dx * 0 + dz * -1) / Math.max(1e-6, d)))) * 180 / Math.PI;
        rows.push({
            aDeg, r,
            regY: +reg.y[s].toFixed(2),
            groundHere: +SF.terrain.heightAt(x, z).toFixed(2),
            playerY: +ch.position.y.toFixed(2),
            yAboveCaster: +(reg.y[s] - ch.position.y).toFixed(2),
            heightGate: D.heightGate,
            dist: +d.toFixed(2), bearingDeg: +ang.toFixed(1),
            radius: +reg.radius[s].toFixed(2),
            inCone: (d - reg.radius[s] <= D.reach) &&
                    (ang <= D.halfAngle * 180 / Math.PI),
            gatePasses: reg.y[s] <= ch.position.y + D.heightGate,
        });
    }
    en.clear();

    // ---- ice readback validation on a fresh window ----------------------
    const fx = 250, fz = 250;
    ch.position.x = fx; ch.position.y = SF.terrain.heightAt(fx, fz);
    ch.position.z = fz;
    await gameWait(1.0);           // window recenters; wrapped texels zeroed
    const d2 = SF.deform, size = d2.size, res = d2.res;
    const prev = SF.renderer.getRenderTarget();
    const gl = SF.renderer.getContext();
    const buf = new Float32Array(4);
    const iceAt = (wx, wz) => {
        SF.renderer.setRenderTarget(d2._pp.read);
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
    const before = { ahead4: iceAt(fx, fz - 4), behind6: iceAt(fx, fz + 6) };
    SF.spells.aim.set(0, -0.1, -1);
    SF.spells.cast(6);
    await gameWait(0.5);
    const after = { ahead4: iceAt(fx, fz - 4), behind6: iceAt(fx, fz + 6) };
    return { rows, ice: { before, after } };
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
            print(json.dumps(pg.evaluate(JS), indent=1))
            br.close()
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
