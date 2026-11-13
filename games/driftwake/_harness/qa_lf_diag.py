# -*- coding: utf-8 -*-
"""qa_lf_diag.py -- why does a mid-frame re-bake differ from the boot bake?

Three discriminating probes, cheapest first:
  A  bake() again with NOTHING changed, from a page callback (mid-frame).
  B  the same, with the frame loop's own render target state neutralised.
  C  the realm landform actually reaching setLandform.
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
    const reg = SF.combat.registry;
    const gameWait = (sec) => new Promise((res) => {
        const t0 = reg.time;
        const tick = () => (reg.time - t0 >= sec) ? res()
            : requestAnimationFrame(tick);
        tick();
    });
    const P = [[0,0],[40,0],[120,80],[250,250],[-370,-370]];
    const snap = () => ({
        min: +hf.minHeight.toFixed(4), max: +hf.maxHeight.toFixed(4),
        h: P.map(p => +T.heightAt(p[0], p[1]).toFixed(6)),
        lfDefault: hf._lfDefault, duneLen: hf.landform.duneLen,
        amp: SF.S.macroHeightScale, wind: SF.S.windDirection,
    });
    const out = { boot: snap() };

    // A -- identical re-bake, called straight from this evaluate (mid-frame-ish)
    hf.bake();
    out.rebakeSame = snap();

    // B -- identical re-bake with the render target explicitly cleared first
    SF.renderer.setRenderTarget(null);
    SF.renderer.setScissorTest(false);
    SF.renderer.setViewport(0, 0, SF.renderer.domElement.width,
                            SF.renderer.domElement.height);
    hf.bake();
    out.rebakeNeutral = snap();

    // C -- what a realm row actually hands setLandform
    const rows = {};
    for (const t of ['cold', 'sand', 'ash']) {
        const r = SF.realms.realm(t);
        rows[t] = r && r.landform ? {
            duneLen: r.landform.duneLen, duneAmp: r.landform.duneAmp,
            heightScale: r.landform.heightScale,
        } : 'MISSING';
    }
    out.rows = rows;

    // D -- drive applyRealm directly, no enterRealm
    T.applyRealm(SF.realms.realm('sand'));
    out.afterApplySand = { lfDefault: hf._lfDefault,
                           duneLen: hf.landform.duneLen,
                           rebakeDue: T._rebakeDue };
    await gameWait(0.3);
    out.sandBaked = snap();
    return out;
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
            print(json.dumps(pg.evaluate(JS), indent=1))
            if errs:
                print("\nCONSOLE ERRORS:")
                for e in errs[:12]:
                    print("  ", e)
            br.close()
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
