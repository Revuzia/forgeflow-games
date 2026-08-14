# -*- coding: utf-8 -*-
"""
qa_arccompile.py -- does the frost-arc decal PROGRAM compile and rasterize
after the lib/groundfx conversion? Casts on flat ground with the console
tapped: RawShaderMaterial only compiles on first draw, so an arc-only shader
error never shows in bootcheck (which casts nothing).
"""
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8843
GAME_URL = f"http://localhost:{PORT}/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

JS = """async () => {
    const SF = SNOWFLOW, ch = SF.character;
    if (SF.combat.encounters) SF.combat.encounters._nextSpawnAt = Infinity;
    SF.combat.enemies.clear();
    // flat-ish ground near origin spawn area
    ch.position.x = 150; ch.position.z = 150;
    ch.position.y = SF.terrain.heightAt(150, 150) + 0.2;
    if (ch.velocity && ch.velocity.set) ch.velocity.set(0, 0, 0);
    SF.rig.yaw = 0; SF.rig.pitch = 0.5; SF.rig.distanceTarget = 6;
    const reg = SF.combat.registry;
    const gameWait = (sec) => new Promise((res) => {
        const t0 = reg.time;
        const tick = () => (reg.time - t0 >= sec) ? res()
            : requestAnimationFrame(tick);
        tick();
    });
    await gameWait(0.8);
    SF.spells.cast(7);
    await gameWait(0.3);
    SF.S.freezeTime = true;
    await new Promise(r => requestAnimationFrame(r));
    const d = SF.spells.arcDecal;
    return {
        active: d.stats.active, draws: d.stats.draws,
        meshVisible: d.mesh.visible,
        age: d.a[ (d._next+1)%2 * 4 + 3 ],
        a0: Array.from(d.a.slice(0, 8)),
        b0: Array.from(d.b.slice(0, 8)),
        c0: Array.from(d.c.slice(0, 8)),
        geomVerts: d.geometry.getAttribute('position').count,
        geomIndex: d.geometry.index.count,
    };
}"""


def main():
    from playwright.sync_api import sync_playwright
    import json

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2.5)
    msgs = []
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False,
                                    args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.on("console", lambda m: msgs.append((m.type, m.text)))
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=120000)
            pg.wait_for_timeout(2000)
            n_before = len(msgs)
            state = pg.evaluate(JS)
            pg.wait_for_timeout(900)
            shots = Path(__file__).resolve().parents[1] / "_shots"
            on = str(shots / "arccompile_on.png")
            off = str(shots / "arccompile_off.png")
            pg.screenshot(path=on)
            pg.evaluate("SNOWFLOW.spells.arcDecal.enabled = false")
            pg.wait_for_timeout(900)
            pg.screenshot(path=off)
            pg.evaluate("(() => { const d = SNOWFLOW.spells.arcDecal;"
                        " d.enabled = true; SNOWFLOW.S.freezeTime = false;"
                        " return true; })()")
            pg.wait_for_timeout(600)
            print("STATE:", json.dumps(state, indent=1))
            from PIL import Image
            ia = Image.open(on).convert("RGB")
            ib = Image.open(off).convert("RGB")
            pa, pb = ia.load(), ib.load()
            mx = 0
            n20 = 0
            for y in range(0, 720, 2):
                for x in range(0, 1280, 2):
                    r1, g1, b1 = pa[x, y]
                    r2, g2, b2 = pb[x, y]
                    dd = abs(r1-r2)+abs(g1-g2)+abs(b1-b2)
                    if dd > mx: mx = dd
                    if dd > 20: n20 += 1
            print(f"FLAT DIFF: max={mx} px_over_20={n20} (2x2 subsample)")
            fresh = msgs[n_before:]
            errs = [t for (k, t) in fresh if k in ("error", "warning")]
            print(f"CONSOLE after cast: {len(fresh)} msgs, "
                  f"{len(errs)} errors/warnings")
            for e in errs[:3]:
                print("----\n" + e[:4000])
            br.close()
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
