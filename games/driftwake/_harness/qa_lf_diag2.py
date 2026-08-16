# -*- coding: utf-8 -*-
"""qa_lf_diag2.py -- what does enterRealm() do to the bake inputs?

applyRealm() alone reshapes correctly (qa_lf_diag). Through enterRealm() every
realm lands on the same flattened field, so something on that path is writing
the bake's inputs. This instruments setLandform + bake and replays a swap.
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
    const SF = SNOWFLOW, T = SF.terrain, hf = T.heightfield, S = SF.S;
    const reg = SF.combat.registry;
    const gameWait = (sec) => new Promise((res) => {
        const t0 = reg.time;
        const tick = () => (reg.time - t0 >= sec) ? res()
            : requestAnimationFrame(tick);
        tick();
    });
    const log = [];
    const origBake = hf.bake.bind(hf);
    hf.bake = function () {
        log.push({ ev: 'bake', lfDefault: hf._lfDefault,
                   duneLen: hf.landform.duneLen,
                   heightScale: hf.landform.heightScale,
                   Samp: S.macroHeightScale, Swind: S.windDirection });
        origBake();
        log.push({ ev: 'baked', min: +hf.minHeight.toFixed(3),
                   max: +hf.maxHeight.toFixed(3) });
    };
    const origSet = hf.setLandform.bind(hf);
    hf.setLandform = function (b) {
        const r = origSet(b);
        log.push({ ev: 'setLandform', got: b ? b.duneLen : 'UNDEFINED',
                   changed: r, nowDefault: hf._lfDefault });
        return r;
    };
    // catch anyone writing the two settings the bake reads
    const un = SF.settingsOnChange
        ? SF.settingsOnChange(['windDirection', 'macroHeightScale'],
            (v, k) => log.push({ ev: 'settingWrite', k, v })) : null;

    log.push({ ev: 'start', min: +hf.minHeight.toFixed(3),
               max: +hf.maxHeight.toFixed(3),
               Samp: S.macroHeightScale, Swind: S.windDirection });
    await SF.enterRealm('sand');
    await gameWait(0.6);
    log.push({ ev: 'end', min: +hf.minHeight.toFixed(3),
               max: +hf.maxHeight.toFixed(3),
               Samp: S.macroHeightScale, Swind: S.windDirection,
               lfDefault: hf._lfDefault, duneLen: hf.landform.duneLen,
               h0: +T.heightAt(0, 0).toFixed(4) });
    // Re-bake once the swap has fully settled: if THIS one is right, the
    // in-swap bake was racing something (sky.solve's readbacks are the
    // suspect), not reading the wrong data.
    hf.bake();
    log.push({ ev: 'rebakeAfterSwap', min: +hf.minHeight.toFixed(3),
               max: +hf.maxHeight.toFixed(3),
               h0: +T.heightAt(0, 0).toFixed(4) });
    if (un) un();
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
            errs = []
            pg.on("console", lambda m: errs.append(m.text)
                  if m.type == "error" else None)
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=180000)
            pg.wait_for_timeout(2500)
            for row in pg.evaluate(JS):
                print(json.dumps(row))
            if errs:
                print("\nCONSOLE ERRORS:")
                for e in errs[:12]:
                    print("  ", e)
            br.close()
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
