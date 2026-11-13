# -*- coding: utf-8 -*-
"""
qa_swapwindow_8892.py -- the frames INSIDE a realm swap.

Both `world/shrine.js` and `world/landmarks.js` re-ground on a fixed
REGROUND_FRAMES = 3 countdown, while the heightfield re-bake lands inside the
FIRST `terrain.update()` after `applyRealm`. This samples every frame across a
swap and reports:

  * how many frames the shrine prisms stand on the OLD heights over the NEW
    ground, and by how much
  * the same for the INCOMING landmark set
  * the vertical JUMP the OUTGOING landmark set takes when `_reground()` fires
    while it is still ~93 % grown (SWAP_S 1.1 s, sink rate x1.6 => ~0.69 s to
    vanish, so frame 3 of ~41)

Read-only; the only mutation is the realm switch itself.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8892
GAME_URL = "http://localhost:%d/games/driftwake/index.html?autoplay&test" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

PRELUDE = r"""
window.__sw = (function () {
    const SF = SNOWFLOW, T = SF.terrain;
    // Raced against a timer ON PURPOSE: an occluded Chrome window throttles
    // rAF to zero and a bare rAF promise inside page.evaluate then never
    // settles, hanging the run with no timeout. A throttled run shows up as
    // `bakes`/`shReg` not advancing, which is visible in the table.
    const raf1 = () => new Promise((r) => {
        let done = false;
        const fin = () => { if (!done) { done = true; r(); } };
        requestAnimationFrame(fin);
        setTimeout(fin, 250);
    });
    const seatY = (x, z, rad) => {
        let lo = T.heightAt(x, z);
        for (let k = 0; k < 12; k++) {
            const a = k * (Math.PI * 2 / 12);
            const g = T.heightAt(x + Math.cos(a) * rad, z + Math.sin(a) * rad);
            if (g < lo) lo = g;
        }
        return lo - 0.02;
    };
    /** One frame's picture of both monument layers. */
    const frameShot = () => {
        const sh = SF.shrine, lm = SF.landmarks;
        const sd = sh._texData;
        let sMax = 0;
        for (let p = 0; p < 84; p++) {
            const o = p * 4;
            const e = sd[o + 1] - (T.heightAt(sd[o], sd[o + 2]) - 0.02);
            if (Math.abs(e) > Math.abs(sMax)) sMax = e;
        }
        const ld = lm._texData, n = lm.prismCount, w = n * 4;
        let inMax = 0, outMax = 0, outGrowMax = 0, inGrowMax = 0;
        // the outgoing set = target 0 but still growing (>0.02)
        for (let p = 0; p < n; p++) {
            const o = p * 4;
            const want = seatY(ld[o], ld[o + 2], ld[w + o + 3])
                + lm._baseOff[p];
            const err = ld[o + 1] - want;
            const g = lm._grow[p];
            if (lm._target[p] === 1) {
                if (Math.abs(err) > Math.abs(inMax)) inMax = err;
                if (g > inGrowMax) inGrowMax = g;
            } else if (g > 0.02) {
                if (Math.abs(err) > Math.abs(outMax)) outMax = err;
                if (g > outGrowMax) outGrowMax = g;
            }
        }
        return {
            bakes: T.rebakeCount,
            shReg: sh._regroundIn, lmReg: lm._regroundIn,
            shErr: +sMax.toFixed(2),
            lmInErr: +inMax.toFixed(2), lmInGrow: +inGrowMax.toFixed(2),
            lmOutErr: +outMax.toFixed(2), lmOutGrow: +outGrowMax.toFixed(2),
            // raw base of a fixed outgoing prism, to see the teleport
            probeBase: null,
        };
    };
    /** Track ONE outgoing prism's base float across the swap. */
    const trackSwap = async (token, frames) => {
        const lm = SF.landmarks;
        // pick the tallest prism of the CURRENT (about to be outgoing) realm
        let pick = -1, best = -1;
        const w = lm.prismCount * 4;
        for (let p = 0; p < lm.prismCount; p++) {
            if (lm._target[p] !== 1) continue;
            const h = lm._texData[p * 4 + 3];
            if (h > best) { best = h; pick = p; }
        }
        const rows = [];
        SF.enterRealm(token);
        for (let f = 0; f < frames; f++) {
            await raf1();
            const s = frameShot();
            s.f = f;
            s.probeBase = +lm._texData[pick * 4 + 1].toFixed(2);
            s.probeGrow = +lm._grow[pick].toFixed(3);
            s.realm = SF.shrine.realm;
            rows.push(s);
        }
        return { pick, prismH: +best.toFixed(1), rows };
    };
    const grade = (x, z) => {
        const e = 2;
        const gx = (T.heightAt(x + e, z) - T.heightAt(x - e, z)) / (2 * e);
        const gz = (T.heightAt(x, z + e) - T.heightAt(x, z - e)) / (2 * e);
        return Math.hypot(gx, gz);
    };
    /** Every LIVE landmark anchor's terrain grade in the CURRENT realm.
     *  `_layoutRealm` nudged all three realms' anchors against COLD's
     *  heightfield at construction (main.js:531 runs before any realm
     *  switch), so this is where a sand/ash anchor on a dune face shows. */
    const lmGrades = () => {
        const st = SF.landmarks.stats;
        const g = st.instances.map((s) => ({
            t: s.type, x: s.x, z: s.z, g: +grade(s.x, s.z).toFixed(3) }));
        g.sort((a, b) => b.g - a.g);
        return { realm: st.realm, worst: g.slice(0, 6),
                 over035: g.filter((r) => r.g >= 0.35).length,
                 median: g[(g.length / 2) | 0].g, n: g.length };
    };
    return { trackSwap, frameShot, lmGrades };
})();
"""


def main():
    from playwright.sync_api import sync_playwright
    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2.5)
    res = {}
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            errs = []
            pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=180000)
            pg.wait_for_timeout(2500)
            pg.evaluate(PRELUDE)
            # warm both target realms so enterRealm's body fetch is cached and
            # the swap tail runs promptly
            res["lmGrades"] = {}
            for t in ("sand", "ash", "cold"):
                pg.evaluate("(t) => SNOWFLOW.enterRealm(t)", t)
                pg.wait_for_function("(t) => SNOWFLOW.shrine.realm === t",
                                     arg=t, timeout=60000)
                pg.wait_for_timeout(1500)
                res["lmGrades"][t] = pg.evaluate("() => window.__sw.lmGrades()")
            for t in ("ash", "cold"):
                res[t] = pg.evaluate(
                    "(t) => window.__sw.trackSwap(t, 26)", t)
                pg.wait_for_timeout(2500)
            print("PAGEERRORS:", json.dumps(errs[:6]))
            br.close()
    finally:
        srv.terminate()

    out = Path(__file__).with_name("qa_swapwindow_8892.out.json")
    out.write_text(json.dumps(res, indent=1), encoding="utf-8")
    print("wrote", out)
    print("\n== LANDMARK ANCHOR GRADE PER REALM "
          "(anchors nudged flat against COLD only)")
    for t, g in res.pop("lmGrades", {}).items():
        print("   %-5s n=%d median=%.3f  over0.35=%d  worst=%s"
              % (t, g["n"], g["median"], g["over035"],
                 json.dumps(g["worst"])))

    for token, r in res.items():
        print("\n== SWAP -> %s   (tracked prism #%d, height %.1f m)"
              % (token, r["pick"], r["prismH"]))
        print("  f realm bakes shReg lmReg  shErr  lmInErr lmInG  lmOutErr "
              "lmOutG  probeBase probeG")
        prev = None
        for s in r["rows"]:
            jump = ""
            if prev is not None and abs(s["probeBase"] - prev) > 0.05:
                jump = "   <== JUMP %+.2f m" % (s["probeBase"] - prev)
            prev = s["probeBase"]
            print("%3d %-5s %5d %5d %5d %6.2f %8.2f %5.2f %9.2f %6.2f %10.2f "
                  "%6.3f%s" % (
                      s["f"], s["realm"][:4], s["bakes"], s["shReg"],
                      s["lmReg"], s["shErr"], s["lmInErr"], s["lmInGrow"],
                      s["lmOutErr"], s["lmOutGrow"], s["probeBase"],
                      s["probeGrow"], jump))


if __name__ == "__main__":
    main()
