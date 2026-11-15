# -*- coding: utf-8 -*-
"""
ash2_measure.py -- ash readability round 2: mean/p10 luma at 3 spots vs cold.

Boots cold, enters ash, scans for a dune hollow near spawn, screenshots the
same 3 world spots (spawn, +60 m along -Z, hollow) in ash and then in cold.
Luma is computed on the lower half of the frame minus the HUD strip:
rows 360..640 of 720, cols 100..1180 of 1280 (Rec.709 luma, 0..255).
Targets: ash mean >= 0.55 x cold mean per spot; ash p10 >= 18.

Also spawns 3 non-buried ash bodies (slagBrute/scorchRaider/smokeMage) at
12-18 m in the hollow and screenshots them for the pick-out-the-bodies check.

Usage: python _harness/ash2_measure.py <tag>     (tag names the _shots files)
"""
import json
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
SHOTS = Path(__file__).resolve().parents[1] / "_shots"
PORT = 8851
GAME_URL = f"http://localhost:{PORT}/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

TAG = sys.argv[1] if len(sys.argv) > 1 else "t"

JS_SPOTS = """(() => {
    const SF = SNOWFLOW, c = SF.character, T = SF.terrain;
    const sx = c.position.x, sz = c.position.z;
    let best = null;
    for (let dx = -90; dx <= 90; dx += 6) {
        for (let dz = -90; dz <= 90; dz += 6) {
            const r = Math.hypot(dx, dz);
            if (r < 25) continue;
            const x = sx + dx, z = sz + dz;
            const h = T.heightAt(x, z);
            const hN = (T.heightAt(x + 15, z) + T.heightAt(x - 15, z)
                + T.heightAt(x, z + 15) + T.heightAt(x, z - 15)) / 4;
            const depth = hN - h;
            if (!best || depth > best.depth) best = { x, z, depth };
        }
    }
    return { spawn: [sx, sz], plus60: [sx, sz - 60],
             hollow: [best.x, best.z], hollowDepth: best.depth };
})()"""

# tp + settle happens in game time via registry.time + rAF; the fresh spot's
# terrain response (deform, streaming) needs a beat before the shot.
JS_TP = """(async () => {
    const SF = SNOWFLOW, c = SF.character, reg = SF.combat.registry;
    c.position.x = X; c.position.z = Z;
    c.position.y = SF.terrain.heightAt(X, Z) + 0.5;
    c.velocity.x = 0; c.velocity.y = 0; c.velocity.z = 0;
    const t0 = reg.time;
    await new Promise((res) => {
        const tick = () => (reg.time - t0 >= 1.4) ? res()
            : requestAnimationFrame(tick);
        tick();
    });
    return [c.position.x.toFixed(1), c.position.z.toFixed(1)];
})()"""

JS_QUIET = """(() => {
    const SF = SNOWFLOW;
    SF.combat.encounters._nextSpawnAt = 1e18;
    SF.combat.enemies.clear();
    return SF.combat.encounters._nextSpawnAt;
})()"""

JS_ENEMIES = """(async () => {
    const SF = SNOWFLOW, E = SF.combat.enemies, reg = SF.combat.registry;
    const c = SF.character;
    E.clear();   // strays (proximity packs) must not photobomb the shot
    // The camera does NOT look down -Z: it hangs behind the character on the
    // rig and faces wherever the boot yaw left it (measured 2026-08-13:
    // camera west of the player, forward = +X). Place the bodies along the
    // camera's actual forward axis so all three land in frame.
    const cam = SF.rig.camera;
    const V = c.position.constructor;
    const camPos = new V(); cam.getWorldPosition(camPos);
    let fx = c.position.x - camPos.x, fz = c.position.z - camPos.z;
    const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    const rx = -fz, rz = fx;   // screen-right on the ground plane
    const px = c.position.x, pz = c.position.z;
    const keys = ['slagBrute', 'scorchRaider', 'smokeMage'];
    const offs = [[-4, 12], [0, 16], [4, 18]];   // [right, forward] metres
    const gameWait = (sec) => new Promise((res) => {
        const t0 = reg.time;
        const tick = () => (reg.time - t0 >= sec) ? res()
            : requestAnimationFrame(tick);
        tick();
    });
    const ids = [];
    for (let i = 0; i < 3; i++) {
        const x = px + rx * offs[i][0] + fx * offs[i][1];
        const z = pz + rz * offs[i][0] + fz * offs[i][1];
        ids.push(E.spawn(keys[i], x, z, 20));
    }
    await gameWait(0.25);   // registry slot lands NEXT frame
    for (const id of ids) { if (id >= 0) reg.damage(id, 1, {}); }
    await gameWait(1.0);
    return ids;
})()"""


def luma_stats(png_path):
    from PIL import Image
    import numpy as np
    im = Image.open(png_path).convert("RGB")
    a = np.asarray(im, dtype=np.float64)
    h, w = a.shape[0], a.shape[1]
    y0, y1 = int(h * 0.50), int(h * 640 / 720)
    x0, x1 = int(w * 100 / 1280), int(w * 1180 / 1280)
    crop = a[y0:y1, x0:x1]
    luma = (0.2126 * crop[..., 0] + 0.7152 * crop[..., 1]
            + 0.0722 * crop[..., 2])
    import numpy
    return {"mean": round(float(luma.mean()), 1),
            "p10": round(float(numpy.percentile(luma, 10)), 1)}


def game_wait(pg, sec):
    pg.evaluate("""(sec) => new Promise((res) => {
        const reg = SNOWFLOW.combat.registry, t0 = reg.time;
        const tick = () => (reg.time - t0 >= sec) ? res()
            : requestAnimationFrame(tick);
        tick();
    })""", sec)


def measure_realm(pg, realm, spots, out):
    # 2 samples ~2 s apart, averaged: cloud/gust noise on a single frame is
    # +/-4%, which flickers a verdict that sits near the 0.55 threshold.
    for name in ("spawn", "plus60", "hollow"):
        x, z = spots[name]
        pg.evaluate(JS_TP.replace("X", repr(x)).replace("Z", repr(z)))
        pg.wait_for_timeout(600)
        shot = SHOTS / f"ash2_{TAG}_{realm}_{name}.png"
        pg.screenshot(path=str(shot))
        s1 = luma_stats(shot)
        pg.wait_for_timeout(2000)
        shot2 = SHOTS / f"ash2_{TAG}_{realm}_{name}_b.png"
        pg.screenshot(path=str(shot2))
        s2 = luma_stats(shot2)
        out[f"{realm}_{name}"] = {
            "mean": round((s1["mean"] + s2["mean"]) / 2, 1),
            "p10": round((s1["p10"] + s2["p10"]) / 2, 1)}
        print(f"  {realm:4s} {name:6s} -> {out[f'{realm}_{name}']}"
              f"  (samples {s1} {s2})")


def main():
    from playwright.sync_api import sync_playwright
    SHOTS.mkdir(exist_ok=True)
    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    out = {}
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=120000)
            pg.wait_for_timeout(2500)

            print("== enterRealm('ash')")
            pg.evaluate("() => SNOWFLOW.enterRealm('ash')")
            pg.evaluate("() => SNOWFLOW.combat.enemies.vis.stream()")
            pg.wait_for_function(
                "() => SNOWFLOW.combat.enemies.vis.stats.types >= 8",
                timeout=120000)
            pg.wait_for_timeout(3000)
            print("  quiet:", pg.evaluate(JS_QUIET))
            print("  S grade:", pg.evaluate(
                "() => [SNOWFLOW.S.exposure, SNOWFLOW.S.contrast]"))

            spots = pg.evaluate(JS_SPOTS)
            print("  spots:", json.dumps(spots))
            sp = {k: spots[k] for k in ("spawn", "plus60", "hollow")}
            measure_realm(pg, "ash", sp, out)

            # enemy visibility shot: stand at hollow, bodies 12-18 m out
            x, z = sp["hollow"]
            pg.evaluate(JS_TP.replace("X", repr(x)).replace("Z", repr(z)))
            ids = pg.evaluate(JS_ENEMIES)
            print("  enemy ids:", ids)
            shot = SHOTS / f"ash2_{TAG}_ash_enemies.png"
            pg.screenshot(path=str(shot))
            pg.evaluate("() => SNOWFLOW.combat.enemies.clear()")

            print("== enterRealm('cold')  (reference)")
            pg.evaluate("() => SNOWFLOW.enterRealm('cold')")
            pg.wait_for_timeout(3000)
            print("  quiet:", pg.evaluate(JS_QUIET))
            measure_realm(pg, "cold", sp, out)
            br.close()
    finally:
        srv.terminate()

    print("\n== VERDICT (targets: ash mean >= 0.55 x cold mean; ash p10 >= 18)")
    ok_all = True
    for name in ("spawn", "plus60", "hollow"):
        a, c = out[f"ash_{name}"], out[f"cold_{name}"]
        ratio = a["mean"] / max(c["mean"], 1e-6)
        ok = ratio >= 0.55 and a["p10"] >= 18
        ok_all &= ok
        print(f"  {name:6s} ash {a['mean']:6.1f}/{a['p10']:5.1f}  "
              f"cold {c['mean']:6.1f}  ratio {ratio:.3f}  "
              f"{'OK' if ok else 'MISS'}")
    print("RESULT:", "PASS" if ok_all else "FAIL")
    print(json.dumps(out))


if __name__ == "__main__":
    main()
