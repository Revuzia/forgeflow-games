#!/usr/bin/env python
"""Why did qa_pathfinding's flat-site search return null? Report the terrain
grade at the (150,150) fallback the separation phase actually used, and the
BEST (lowest) worst-grade the probe's ring search could find. Read-only."""
import sys, time, json
from playwright.sync_api import sync_playwright
for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass
FLAGS = ["--ignore-gpu-blocklist","--use-angle=d3d11","--disable-gpu-sandbox",
         "--enable-gpu-rasterization","--disable-features=CalculateNativeWinOcclusion"]
URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8799/games/driftwake/index.html"

JS = """(() => {
    const T = SNOWFLOW.terrain, e = 0.5;
    const gradeAt = (px, pz) => {
        const gx = (T.heightAt(px + e, pz) - T.heightAt(px - e, pz)) / (2 * e);
        const gz = (T.heightAt(px, pz + e) - T.heightAt(px, pz - e)) / (2 * e);
        return Math.hypot(gx, gz);
    };
    // grade over the disc the separation ring actually occupies at (150,150)
    let worstFallback = 0;
    for (let rr = 0; rr <= 24; rr += 6) for (let b = 0; b < 8; b++) {
        worstFallback = Math.max(worstFallback,
            gradeAt(150 + rr * Math.cos(b * Math.PI / 4),
                    150 + rr * Math.sin(b * Math.PI / 4)));
    }
    // replicate the probe's ring search and keep the BEST worst-grade seen
    let best = 1e9, bestAt = null;
    for (let r0 = 40; r0 <= 400; r0 += 20) {
        for (let a = 0; a < 12; a++) {
            const x = r0 * Math.cos(a * Math.PI / 6), z = r0 * Math.sin(a * Math.PI / 6);
            let worst = 0;
            for (let rr = 0; rr <= 24; rr += 6) for (let b = 0; b < 8; b++) {
                worst = Math.max(worst, gradeAt(x + rr * Math.cos(b * Math.PI / 4),
                                                z + rr * Math.sin(b * Math.PI / 4)));
            }
            if (worst < best) { best = worst; bestAt = {x: +x.toFixed(1), z: +z.toFixed(1)}; }
        }
    }
    return {realm: SNOWFLOW.realms && SNOWFLOW.realms.current,
            fallbackSite_150_150_worstGrade: +worstFallback.toFixed(3),
            bestWorstGradeFound: +best.toFixed(3), bestAt,
            probeThreshold: 0.22,
            flatWouldBeFound: best < 0.22};
})()"""

with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
    pg = br.new_page(viewport={"width":1280,"height":720})
    pg.goto(URL, wait_until="load", timeout=60000)
    end = time.time() + 120
    while time.time() < end:
        try:
            if pg.evaluate("!!(globalThis.SNOWFLOW && SNOWFLOW.terrain && SNOWFLOW.terrain.heightAt)"): break
        except Exception: pass
        pg.wait_for_timeout(500)
    pg.wait_for_timeout(2500)
    print(json.dumps(pg.evaluate(JS), indent=1))
    br.close()
