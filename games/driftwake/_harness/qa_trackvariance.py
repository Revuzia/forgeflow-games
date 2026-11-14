# -*- coding: utf-8 -*-
"""
qa_trackvariance.py -- are the locomotion clips' ARM tracks constant?

Pixel evidence (clip_rimeImp_run.png): arms ride in bind pose while legs
stride. Tracks resolve 100% (qa_trackbind), so the values themselves must be
flat. Per body x clip x key bone: max deviation of the quaternion track from
its first key. ~0 on walk/run arms while attacks move = the retarget or the
16-bit quantization (3d2523b3) flattened them.
"""
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
GAME_URL = "http://localhost:8799/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

JS = """(() => {
    const v = SNOWFLOW.combat.enemies.vis;
    const WANT = /(LeftArm|RightArm|LeftForeArm|LeftUpLeg|RightUpLeg|Spine2|Hips)$/;
    const out = [];
    for (const slug of ["01_cold_rime_imp", "75_v3_sand_bleached_bone_knight",
                        "02_cold_glacier_brute"]) {
        const t = v._types.get(slug);
        if (!t || !t.clips) { out.push({slug, err: "not resident"}); continue; }
        const rows = [];
        for (const c of t.clips) {
            const bones = {};
            for (const tr of c.tracks) {
                const m = tr.name.match(/^(.*)\\.quaternion$/);
                if (!m || !WANT.test(m[1])) continue;
                const vals = tr.values;
                const stride = 4;
                let dev = 0;
                for (let k = stride; k < vals.length; k += stride) {
                    for (let j = 0; j < 4; j++) {
                        const d = Math.abs(vals[k + j] - vals[j]);
                        if (d > dev) dev = d;
                    }
                }
                bones[m[1].replace("mixamorig", "")] =
                    +dev.toFixed(4) + 0;
            }
            rows.push({ clip: c.name, keys: c.tracks.length, bones });
        }
        out.push({ slug, rows });
    }
    return out;
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
            pg.wait_for_timeout(1500)
            pg.evaluate("SNOWFLOW.combat.enemies.vis.stream()")
            pg.wait_for_function(
                "() => SNOWFLOW.combat.enemies.vis.stats.types >= 8",
                timeout=120000)
            pg.evaluate("SNOWFLOW.enterRealm('sand')")
            pg.wait_for_timeout(1500)
            pg.evaluate("SNOWFLOW.combat.enemies.vis.stream()")
            pg.wait_for_function(
                "() => SNOWFLOW.combat.enemies.vis._types.has("
                "'75_v3_sand_bleached_bone_knight')", timeout=120000)
            rows = pg.evaluate(JS)
            for r in rows:
                print("\n==", r["slug"], r.get("err", ""))
                for row in r.get("rows", []):
                    print(f"  {row['clip']:<18}", row["bones"])
            br.close()
    finally:
        srv.terminate()


if __name__ == "__main__":
    main()
