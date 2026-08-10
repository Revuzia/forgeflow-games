# -*- coding: utf-8 -*-
"""
qa_bonepath.py -- where does the pose die? Drive one body's attack scrub and
read every stage: action state -> bone local quat vs rest -> skeleton
boneTexture freshness. Discriminates "mixer not reaching bones" from "bones
not reaching the skin".
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
    const x = c.position.x, z = c.position.z - 5;
    const y = SF.terrain.heightAt(x, z);
    v.spawn(SLOT, 'rimeImp', x, y, z);
    const inst = v._slotInst[SLOT];
    if (!inst) return { err: "not bound" };

    // Rest-pose reference BEFORE any drive.
    const bones = inst.skeleton.bones;
    const find = (re) => bones.find(b => re.test(b.name));
    const la = find(/LeftArm$/), lu = find(/LeftUpLeg$/);
    const rest = {};
    for (const b of [la, lu]) rest[b.name] = b.quaternion.toArray();

    // Drive windup for ~1.5 s of game time.
    const reg = SF.combat.registry;
    const t0 = reg.time;
    await new Promise((res) => {
        const tick = () => {
            v.drive(SLOT, x, y, z, Math.PI, 0, 0.85, 0, 0, 0);
            if (reg.time - t0 >= 1.5) return res();
            requestAnimationFrame(tick);
        };
        tick();
    });

    const out = { rest, now: {}, actions: [], weights: [] };
    for (const b of [la, lu]) out.now[b.name] = b.quaternion.toArray()
        .map(n => +n.toFixed(3));
    for (let i = 0; i < inst.acts.length; i++) {
        const a = inst.acts[i];
        if (!a) { out.actions.push(null); continue; }
        out.actions.push({
            clip: a.getClip().name,
            t: +a.time.toFixed(2), dur: +a.getClip().duration.toFixed(2),
            w: +a.getEffectiveWeight().toFixed(2),
            enabled: a.enabled, paused: a.paused, running: a.isRunning(),
        });
    }
    out.atk = inst.atk;
    out.mixerTime = +inst.mixer.time.toFixed(2);
    out.boneTexVersion = inst.boneTexture ? inst.boneTexture.version : -1;
    // Difference rest vs now, per bone (max |dq| component).
    out.delta = {};
    for (const b of [la, lu]) {
        let d = 0;
        for (let j = 0; j < 4; j++) d = Math.max(d,
            Math.abs(out.now[b.name][j] - rest[b.name][j]));
        out.delta[b.name] = +d.toFixed(3);
    }
    for (const k of Object.keys(out.rest))
        out.rest[k] = out.rest[k].map(n => +n.toFixed(3));
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
            out = pg.evaluate(JS)
            print(json.dumps(out, indent=1))
            br.close()
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
