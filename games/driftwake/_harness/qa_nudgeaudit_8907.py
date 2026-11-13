# -*- coding: utf-8 -*-
"""
qa_nudgeaudit_8907.py -- ADVERSARIAL VERIFIER for the claim
"the flat-spot nudge only ever runs against COLD's heightfield".

Does NOT trust the hunt lane's 0.35 grade floor (an externally-chosen
constant). Instead it measures, per realm, on the LIVE heightfield:

  A. shrine ring (ids 1..6)
     - grade at the SHIPPED anchor
     - grade at the UN-NUDGED hexagon vertex (radius 350 off the spawn) --
       what the anchor would be with no nudge at all
     - the BEST grade reachable by re-running shrine.js's own scan
       (+/-40 m, step 8, gradeAt) against the CURRENT heightfield
     - PERCENTILE RANK of the shipped anchor inside its own 11x11 scan
       window: 0.00 = the scan's minimum (nudge working), ~0.5 = no better
       than an arbitrary point in the window (nudge delivering nothing).

  B. landmark instances (live realm only)
     - grade at the shipped anchor
     - best grade within +/-24 m (landmarks.js's own NUDGE_SPAN/STEP)
     - percentile rank of the shipped anchor in that same window.

  C. BASELINE: grade distribution over a deterministic 61x61 grid inside
     the play radius, so "0.42 is steep" can be judged against what the
     realm's ground actually looks like, instead of asserted.

Read-only. Mutates nothing but the realm (through SNOWFLOW.enterRealm,
the same entry point the dev portals use). Game-time waits only.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8907
GAME_URL = "http://localhost:%d/games/driftwake/index.html?autoplay&test" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

PRELUDE = r"""
window.__na = (function () {
    const SF = SNOWFLOW, T = SF.terrain;
    const rafs = (n) => new Promise((res) => {
        let k = 0;
        const t = () => { if (++k >= n) res(); else requestAnimationFrame(t); };
        requestAnimationFrame(t);
    });
    // shrine.js gradeAt(), transliterated -- GRADE_E = 2, central differences.
    const grade = (x, z) => {
        const e = 2;
        const gx = (T.heightAt(x + e, z) - T.heightAt(x - e, z)) / (2 * e);
        const gz = (T.heightAt(x, z + e) - T.heightAt(x, z - e)) / (2 * e);
        return Math.hypot(gx, gz);
    };
    // Re-run a nudge scan around (cx,cz) and report min / rank-of-here.
    const scan = (cx, cz, span, step, hereG) => {
        let best = Infinity, bx = cx, bz = cz, below = 0, n = 0;
        for (let dz = -span; dz <= span; dz += step) {
            for (let dx = -span; dx <= span; dx += step) {
                const g = grade(cx + dx, cz + dz);
                n++;
                if (g < hereG) below++;
                if (g < best) { best = g; bx = cx + dx; bz = cz + dz; }
            }
        }
        return { best: best, bx: bx, bz: bz, rank: below / n, n: n };
    };
    const quant = (arr, q) => {
        const a = arr.slice().sort((p, r) => p - r);
        return a[Math.min(a.length - 1, Math.max(0, Math.round(q * (a.length - 1))))];
    };
    const snap = () => {
        const sh = SF.shrine, lm = SF.landmarks;
        const spawn = sh.positions[0];
        // ---- A. shrine ring
        const shrines = [];
        for (let i = 1; i < sh.positions.length; i++) {
            const p = sh.positions[i];
            const a = (i - 1) * (Math.PI / 3);
            // shrine.js: RING_RADIUS 350 about the AUTHORED spawn (5.0, 5.5)
            const nx = 5.0 + Math.cos(a) * 350;
            const nz = 5.5 + Math.sin(a) * 350;
            const hereG = grade(p.x, p.z);
            const s = scan(nx, nz, 40, 8, hereG);
            shrines.push({
                id: p.id,
                x: +p.x.toFixed(1), z: +p.z.toFixed(1),
                offX: +(p.x - nx).toFixed(1), offZ: +(p.z - nz).toFixed(1),
                here: +hereG.toFixed(3),
                unnudged: +grade(nx, nz).toFixed(3),
                best: +s.best.toFixed(3),
                bestX: +s.bx.toFixed(1), bestZ: +s.bz.toFixed(1),
                rank: +s.rank.toFixed(3),
            });
        }
        // ---- B. landmarks, live realm only
        const inst = lm.stats.instances;
        const lms = [];
        for (const s of inst) {
            const hereG = grade(s.x, s.z);
            const sc = scan(s.x, s.z, 24, 8, hereG);
            lms.push({
                t: s.type, x: +s.x.toFixed(1), z: +s.z.toFixed(1),
                here: +hereG.toFixed(3), best: +sc.best.toFixed(3),
                rank: +sc.rank.toFixed(3),
            });
        }
        // ---- C. baseline grade field, deterministic grid in the play radius
        const R = (T.playRadius ? T.playRadius : 0) || 900;
        const G = 61, all = [];
        for (let i = 0; i < G; i++) {
            for (let j = 0; j < G; j++) {
                const x = (i / (G - 1) * 2 - 1) * R;
                const z = (j / (G - 1) * 2 - 1) * R;
                if (Math.hypot(x, z) > R) continue;
                all.push(grade(x, z));
            }
        }
        return {
            realm: { shrine: sh.realm, landmarks: lm.stats.realm,
                     terrain: T.realmName },
            bakes: T.rebakeCount,
            spawn: { x: +spawn.x.toFixed(2), z: +spawn.z.toFixed(2) },
            playRadius: R,
            shrines: shrines,
            landmarks: lms,
            base: {
                n: all.length,
                p10: +quant(all, 0.10).toFixed(3),
                p25: +quant(all, 0.25).toFixed(3),
                p50: +quant(all, 0.50).toFixed(3),
                p75: +quant(all, 0.75).toFixed(3),
                p90: +quant(all, 0.90).toFixed(3),
                max: +quant(all, 1.0).toFixed(3),
            },
        };
    };
    return { rafs: rafs, snap: snap, grade: grade };
})();
"""

SWITCH = r"""(async (token) => {
    await SNOWFLOW.enterRealm(token);
    await window.__na.rafs(24);   // bake lands next terrain.update; +3 reground
    return window.__na.snap();
})"""


def med(a):
    a = sorted(a)
    return a[len(a) // 2] if a else float("nan")


def main():
    from playwright.sync_api import sync_playwright

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2.5)
    rows = []
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            errs = []
            pg.on("console", lambda m: errs.append(m.text)
                  if m.type == "error" else None)
            pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=180000)
            pg.wait_for_timeout(2500)
            pg.evaluate(PRELUDE)
            r = pg.evaluate("() => window.__na.snap()")
            r["tag"] = "boot"
            rows.append(r)
            # cold -> sand -> ash -> cold: the round trip proves the cold
            # numbers are not an artifact of "never left".
            for t in ("sand", "ash", "cold", "sand"):
                r = pg.evaluate(SWITCH, t)
                r["tag"] = t
                rows.append(r)
            print("CONSOLE ERRORS:", json.dumps(errs[:10]))
            br.close()
    finally:
        srv.terminate()

    out = Path(__file__).with_name("qa_nudgeaudit_8907.out.json")
    out.write_text(json.dumps(rows, indent=1), encoding="utf-8")
    print("wrote", out)

    for r in rows:
        b = r["base"]
        print("\n===== tag=%s  realm(sh/lm/terr)=%s/%s/%s  bakes=%d  R=%.0f"
              % (r["tag"], r["realm"]["shrine"], r["realm"]["landmarks"],
                 r["realm"]["terrain"], r["bakes"], r["playRadius"]))
        print("  BASELINE grade over %d play-area samples: "
              "p10=%.3f p25=%.3f p50=%.3f p75=%.3f p90=%.3f max=%.3f"
              % (b["n"], b["p10"], b["p25"], b["p50"], b["p75"], b["p90"],
                 b["max"]))
        print("  -- SHRINE RING (here=shipped anchor, unnudged=hex vertex, "
              "best=re-scan min THIS realm, rank=fraction of the 121-pt scan "
              "window flatter than the shipped anchor)")
        print("     %-11s %8s %8s %8s %9s %8s %7s" %
              ("id", "here", "unnudged", "best", "here-best", "rank", "off(m)"))
        for s in r["shrines"]:
            off = (s["offX"] ** 2 + s["offZ"] ** 2) ** 0.5
            print("     %-11s %8.3f %8.3f %8.3f %9.3f %8.3f %7.1f" %
                  (s["id"], s["here"], s["unnudged"], s["best"],
                   s["here"] - s["best"], s["rank"], off))
        lm = r["landmarks"]
        if lm:
            here = [x["here"] for x in lm]
            best = [x["best"] for x in lm]
            rank = [x["rank"] for x in lm]
            worst = sorted(lm, key=lambda x: -x["here"])[:3]
            print("  -- LANDMARKS n=%d  median here=%.3f  median best=%.3f  "
                  "median rank=%.3f  max here=%.3f" %
                  (len(lm), med(here), med(best), med(rank), max(here)))
            print("     worst 3:", json.dumps(worst))


if __name__ == "__main__":
    main()
