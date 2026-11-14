# -*- coding: utf-8 -*-
"""qa_lf_diag3.py -- GL state around the in-swap bake vs the settled bake.

The same bake with the same uniforms gives min -4.867 during enterRealm and
min -18.326 once it has settled (qa_lf_diag2). This captures the renderer state
at both, so the difference is measured rather than guessed.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8874
GAME_URL = f"http://localhost:{PORT}/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

JS = """(async () => {
    const SF = SNOWFLOW, T = SF.terrain, hf = T.heightfield;
    const reg = SF.combat.registry, R = SF.renderer;
    const gl = R.getContext();
    const gameWait = (sec) => new Promise((res) => {
        const t0 = reg.time;
        const tick = () => (reg.time - t0 >= sec) ? res()
            : requestAnimationFrame(tick);
        tick();
    });
    const log = [];
    const state = (tag) => ({
        tag,
        packBuf: !!gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING),
        fb: String(gl.getParameter(gl.FRAMEBUFFER_BINDING)),
        viewport: Array.from(gl.getParameter(gl.VIEWPORT)),
        scissorOn: gl.getParameter(gl.SCISSOR_TEST),
        scissor: Array.from(gl.getParameter(gl.SCISSOR_BOX)),
        err: gl.getError(),
        rt: String(R.getRenderTarget() && R.getRenderTarget().texture
                   && R.getRenderTarget().texture.name),
        readStride: hf._readStride,
        solving: SF.sky._solving,
    });

    const origBake = hf.bake.bind(hf);
    hf.bake = function () {
        log.push(state('before-bake'));
        origBake();
        log.push(Object.assign(state('after-bake'), {
            min: +hf.minHeight.toFixed(3), max: +hf.maxHeight.toFixed(3),
        }));
    };

    await SF.enterRealm('sand');
    await gameWait(0.6);
    log.push({ tag: 'settled-now-rebake' });
    hf.bake();
    return log;
})()"""


def main():
    from playwright.sync_api import sync_playwright
    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.0)
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=180000)
            pg.wait_for_timeout(2500)
            for row in pg.evaluate(JS):
                print(json.dumps(row))
            br.close()
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
