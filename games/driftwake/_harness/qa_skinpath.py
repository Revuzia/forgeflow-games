# -*- coding: utf-8 -*-
"""
qa_skinpath.py -- where does the pose die between the mixer and the pixels?

Chain: mixer -> bone.quaternion (CPU nodes) -> skeleton.update() bakes
matrixWorld x boneInverse into skeleton.boneMatrices -> boneTexture upload ->
program uniform 'boneTexture' -> vertex shader. The realpath repro shows the
first link alive (quats move) and the last dead (T-pose pixels). This reads
every intermediate on a live unit.
"""
import json
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
GAME_URL = "http://localhost:8799/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

JS = """(async () => {
    const SF = SNOWFLOW, e = SF.combat.enemies, v = e.vis, c = SF.character;
    const reg = SF.combat.registry;
    SF.combat.encounters._nextSpawnAt = 1e9;
    SF.combat.encounters._clearAll();
    e.clear();
    const a = SF.rig.yaw;
    const x = c.position.x + Math.sin(a) * 8;
    const z = c.position.z - Math.cos(a) * 8;
    const id = e.spawn('hailPlateGuard', x, z, 1);
    reg.damage(id, 1, {});
    let slot = -1;
    for (let i = 0; i < e.alive.length; i++)
        if (e.alive[i] && e.id[i] === id) { slot = i; break; }
    // let it chase so locomotion is really playing
    const t0 = reg.time;
    await new Promise((res) => {
        const tick = () => (reg.time - t0 >= 2.5) ? res()
            : requestAnimationFrame(tick);
        tick();
    });
    const inst = v._slotInst[slot];
    if (!inst) return { err: 'no inst' };
    const sk = inst.skeleton;
    const bone = sk.bones.find(b => /LeftArm$/.test(b.name));
    const bi = sk.bones.indexOf(bone);

    const snap = () => ({
        quat: bone.quaternion.toArray().map(n => +n.toFixed(3)),
        boneMat: Array.from(sk.boneMatrices.slice(bi * 16, bi * 16 + 8))
            .map(n => +n.toFixed(3)),
        texVersion: sk.boneTexture ? sk.boneTexture.version : -1,
    });
    const s1 = snap();
    const t1 = reg.time;
    await new Promise((res) => {
        const tick = () => (reg.time - t1 >= 0.8) ? res()
            : requestAnimationFrame(tick);
        tick();
    });
    const s2 = snap();

    // compiled program uniform maps
    const progs = SF.renderer.info.programs || [];
    const em = progs.filter(p => /enemySkin/.test(p.name || ''))
        .map(p => {
            let keys = [];
            try { keys = Object.keys(p.getUniforms().map); } catch (err) {}
            return { name: p.name, usedTimes: p.usedTimes,
                     hasBoneTex: keys.includes('boneTexture'),
                     hasBindMat: keys.includes('bindMatrix'),
                     hasBindInv: keys.includes('bindMatrixInverse'),
                     nUniforms: keys.length };
        });

    const boneMatMoved = s1.boneMat.some((n, i) =>
        Math.abs(n - s2.boneMat[i]) > 0.001);
    const quatMoved = s1.quat.some((n, i) => Math.abs(n - s2.quat[i]) > 0.005);
    return {
        skeletonUpdateType: typeof sk.update,
        bindMode: inst.mesh.bindMode,
        s1, s2, quatMoved, boneMatMoved,
        texAdvanced: s2.texVersion > s1.texVersion,
        programs: em,
        visible: inst.mesh.visible,
        spd: +v.speed01[slot].toFixed(2),
    };
})()"""


def main():
    from playwright.sync_api import sync_playwright

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
