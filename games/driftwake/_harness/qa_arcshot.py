# -*- coding: utf-8 -*-
"""
qa_arcshot.py -- retake _shots/frostarc.png with the fan mid-flight.

Same scene as qa_dart.py's shot phase; the only change is timing -- the
evaluate returns 0.05 game-seconds after the cast so the screenshot's
wall-clock latency lands inside the fan's 0.38 s flight, not after it.
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

JS = """(async () => {
    const SF = SNOWFLOW, en = SF.combat.enemies, ch = SF.character;
    const reg = SF.combat.registry;
    const px = 250, pz = 250;
    if (SF.shrine && SF.shrine.mesh) SF.shrine.mesh.visible = false;
    if (SF.combat.encounters) {
        SF.combat.encounters._nextSpawnAt = Infinity;
        if (SF.combat.encounters._clearAll) SF.combat.encounters._clearAll();
    }
    en.clear();
    ch.position.x = px; ch.position.y = SF.terrain.heightAt(px, pz);
    ch.position.z = pz;
    SF.rig.yaw = 0; SF.rig.distanceTarget = 4.5;
    const gameWait = (sec) => new Promise((res) => {
        const t0 = reg.time;
        const tick = () => (reg.time - t0 >= sec) ? res()
            : requestAnimationFrame(tick);
        tick();
    });
    await gameWait(1.0);
    en.spawn('rimeImp', px - 2.2, pz - 5, 1);
    en.spawn('rimeImp', px + 2.4, pz - 6.5, 1);
    const pinP = setInterval(() => {
        ch.position.x = px; ch.position.z = pz; ch.health = 100;
    }, 50);
    await gameWait(0.4);
    SF.spells.aim.set(0, -0.1, -1);
    SF.spells.cast(6);                 // glaze pass, fan 1
    await gameWait(0.6);
    SF.spells.aim.set(0, -0.1, -1);
    SF.spells.cast(6);                 // the fan the screenshot catches
    await gameWait(0.05);
    clearInterval(pinP);
    return true;
})()"""


def main():
    from playwright.sync_api import sync_playwright

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
            pg.evaluate(JS)
            pg.screenshot(path=str(GAME / "_shots" / "frostarc.png"))
            print("_shots/frostarc.png written")
            br.close()
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
