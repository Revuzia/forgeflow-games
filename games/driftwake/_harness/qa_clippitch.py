# -*- coding: utf-8 -*-
"""
qa_clippitch.py -- per-clip body uprightness, measured on the live skeleton.

For each clip of a body, force that action to weight 1 (hooked after _clips so
the game's own blender cannot fight back), let the mixer settle, then measure
the Hips bone's world up-axis against world +Y and the head-vs-hips height.
An upright pose reads ~0-30 deg; a frame-contaminated clip reads ~90 (body
flat). Splits the family-A (web pack: idle/walk/run) sources from the FBX
attack sources numerically.
"""
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
GAME_URL = "http://localhost:8799/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

JS = """(async () => {
    const SF = SNOWFLOW, v = SF.combat.enemies.vis, c = SF.character;
    const SLOT = 23;
    const x = c.position.x, z = c.position.z - 6;
    const y = SF.terrain.heightAt(x, z);
    v.spawn(SLOT, 'KEY', x, y, z);
    const inst = v._slotInst[SLOT];
    if (!inst) return { err: 'not bound' };
    if (!v.__hook) {
        v.__hook = true;
        const orig = v._clips.bind(v);
        v._clips = function (ins, i, dt) {
            orig(ins, i, dt);
            const f = window.__force;
            if (!f || ins !== v._slotInst[23]) return;
            for (let k = 0; k < ins.acts.length; k++) {
                const a = ins.acts[k];
                if (!a) continue;
                a.setEffectiveWeight(k === f.c ? 1 : 0);
                if (k === f.c && a.paused) { a.paused = false; }
                if (k === f.c && !a.isRunning()) { a.reset(); }
            }
        };
    }
    const reg = SF.combat.registry;
    const gameWait = (sec) => new Promise((res) => {
        const t0 = reg.time;
        const tick = () => (reg.time - t0 >= sec) ? res()
            : requestAnimationFrame(tick);
        tick();
    });
    const bones = inst.skeleton.bones;
    const hips = bones.find(b => /Hips$/.test(b.name));
    const head = bones.find(b => /Head$/.test(b.name));
    const out = [];
    const THREEv = hips.up.constructor;   // a Vector3 class handle
    for (let cIdx = 0; cIdx < inst.acts.length; cIdx++) {
        if (!inst.acts[cIdx]) continue;
        window.__force = { c: cIdx };
        // keep the slot driven so update() steps its mixer
        const drv = setInterval(() => v.drive(SLOT, x, y, z, Math.PI,
            0, 0, 0, 0, 0), 30);
        await gameWait(1.2);
        // sample twice, 0.3 s apart, take the mean
        const meas = [];
        for (let s = 0; s < 2; s++) {
            await gameWait(0.3);
            const m = hips.matrixWorld;
            // hips local +Y in world
            const ux = m.elements[4], uy = m.elements[5], uz = m.elements[6];
            const l = Math.hypot(ux, uy, uz) || 1;
            const pitch = Math.acos(Math.max(-1, Math.min(1, uy / l)))
                * 180 / Math.PI;
            const hw = new THREEv(), hh = new THREEv();
            hips.getWorldPosition(hw); head.getWorldPosition(hh);
            meas.push({ pitch, rise: hh.y - hw.y });
        }
        clearInterval(drv);
        const pitch = (meas[0].pitch + meas[1].pitch) / 2;
        const rise = (meas[0].rise + meas[1].rise) / 2;
        out.push({ clip: inst.acts[cIdx].getClip().name,
                   pitch: +pitch.toFixed(1), headRise: +rise.toFixed(2) });
    }
    window.__force = null;
    v.free(SLOT);
    return out;
})()"""


def main():
    from playwright.sync_api import sync_playwright
    import json

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", "8799"], cwd=str(ROOT),
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
            for key in ("rimeImp", "glacierBrute"):
                rows = pg.evaluate(JS.replace("KEY", key))
                print("\n==", key)
                for r in rows if isinstance(rows, list) else [rows]:
                    print(" ", json.dumps(r))
            br.close()
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
