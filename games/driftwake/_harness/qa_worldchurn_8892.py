# -*- coding: utf-8 -*-
"""
qa_worldchurn_8892.py -- LANDFORM CHURN against the world layer.

Switches realm 12 times through the SAME entry point the dev portals use
(`SNOWFLOW.enterRealm`), and after each switch measures, on the LIVE systems:

  * character grounding      |y - terrain.heightAt(x,z)|
  * shrine re-ground         positions[i].y vs heightAt, and every one of the
                             84 network prism BASES out of shrine._texData row0
  * shrine terrain grade     gradeAt() per shrine, per realm (the hunt's item 4)
  * landmark re-ground       every LIVE prism's base vs seatY()+_baseOff, and
                             the raw float vs heightAt (floating / buried)
  * landmark set swap        stats.realm / liveInstances
  * leak watch               renderer.info geometries/textures/programs/calls

Nothing is mutated except the realm. Read-only on every system.
"""
import json
import subprocess
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8892
GAME_URL = "http://localhost:%d/games/driftwake/index.html?autoplay&test" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

PRELUDE = r"""
window.__wc = (function () {
    const SF = SNOWFLOW, T = SF.terrain, reg = SF.combat.registry;
    const rafs = (n) => new Promise((res) => {
        let k = 0;
        const t = () => { if (++k >= n) res(); else requestAnimationFrame(t); };
        requestAnimationFrame(t);
    });
    const grade = (x, z) => {
        const e = 2;
        const gx = (T.heightAt(x + e, z) - T.heightAt(x - e, z)) / (2 * e);
        const gz = (T.heightAt(x, z + e) - T.heightAt(x, z - e)) / (2 * e);
        return Math.hypot(gx, gz);
    };
    const seatY = (x, z, rad) => {
        let lo = T.heightAt(x, z);
        for (let k = 0; k < 12; k++) {
            const a = k * (Math.PI * 2 / 12);
            const g = T.heightAt(x + Math.cos(a) * rad, z + Math.sin(a) * rad);
            if (g < lo) lo = g;
        }
        return lo - 0.02;
    };
    const snap = (tag) => {
        const sh = SF.shrine, lm = SF.landmarks, c = SF.character;
        // ---- character
        const ch = T.heightAt(c.position.x, c.position.z);
        // ---- shrine anchors
        const shr = sh.positions.map((p) => ({
            id: p.id,
            x: +p.x.toFixed(1), z: +p.z.toFixed(1),
            dy: +(p.y - T.heightAt(p.x, p.z)).toFixed(3),
            grade: +grade(p.x, p.z).toFixed(3),
        }));
        // ---- shrine prism bases (row 0 of the data texture)
        const sd = sh._texData;
        const nPr = sd.length / 12;          // 3 rows x 4 floats
        let sMax = 0, sMaxAt = -1;
        for (let p = 0; p < nPr; p++) {
            const o = p * 4;
            const err = sd[o + 1] - (T.heightAt(sd[o], sd[o + 2]) - 0.02);
            if (Math.abs(err) > Math.abs(sMax)) { sMax = err; sMaxAt = p; }
        }
        // ---- landmark prisms, LIVE realm only (_target === 1)
        const ld = lm._texData, n = lm.prismCount, w = n * 4;
        let lMaxErr = 0, lLive = 0, lMinRel = 1e9, lMaxRel = -1e9;
        for (let p = 0; p < n; p++) {
            if (lm._target[p] !== 1) continue;
            lLive++;
            const o = p * 4;
            const want = seatY(ld[o], ld[o + 2], ld[w + o + 3]) + lm._baseOff[p];
            const err = ld[o + 1] - want;
            if (Math.abs(err) > Math.abs(lMaxErr)) lMaxErr = err;
            const rel = ld[o + 1] - T.heightAt(ld[o], ld[o + 2]);
            if (rel < lMinRel) lMinRel = rel;
            if (rel > lMaxRel) lMaxRel = rel;
        }
        const st = lm.stats;
        // ---- instance anchors
        let iMax = 0;
        for (const s of st.instances) {
            const d = s.y - T.heightAt(s.x, s.z);
            if (Math.abs(d) > Math.abs(iMax)) iMax = d;
        }
        const info = SF.renderer.info;
        return {
            tag,
            realm: { shrine: sh.realm, landmarks: st.realm,
                     enc: SF.combat.encounters.realm },
            bakes: T.rebakeCount,
            char: { y: +c.position.y.toFixed(3), h: +ch.toFixed(3),
                    d: +(c.position.y - ch).toFixed(3) },
            shrines: shr,
            shrinePrismMaxErr: +sMax.toFixed(3), shrinePrismWorst: sMaxAt,
            lmLive: lLive, lmInstances: st.liveInstances,
            lmTypes: st.types, lmSettled: st.settled,
            lmPrismMaxErr: +lMaxErr.toFixed(3),
            lmRelMin: +lMinRel.toFixed(2), lmRelMax: +lMaxRel.toFixed(2),
            lmInstMaxErr: +iMax.toFixed(3),
            gpu: { geo: info.memory.geometries, tex: info.memory.textures,
                   prog: SF.renderer.info.programs
                       ? SF.renderer.info.programs.length : -1,
                   calls: info.render.calls },
        };
    };
    return { rafs, snap, grade, seatY };
})();
"""

SWITCH = r"""(async (token) => {
    const w = window.__wc;
    await SNOWFLOW.enterRealm(token);
    // Generous: the bake lands inside the next terrain.update(), the shrine and
    // landmark re-grounds three frames after that.
    await w.rafs(20);
    return w.snap(token);
})"""


def main():
    from playwright.sync_api import sync_playwright

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    import time
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
            rows.append(pg.evaluate("() => window.__wc.snap('boot')"))

            seq = ["sand", "cold", "ash", "cold", "sand", "ash",
                   "cold", "sand", "cold", "ash", "sand", "cold"]
            for i, t in enumerate(seq):
                r = pg.evaluate(SWITCH, t)
                r["tag"] = "%02d:%s" % (i + 1, t)
                rows.append(r)
            print("CONSOLE ERRORS:", json.dumps(errs[:12]))
            br.close()
    finally:
        srv.terminate()

    out = Path(__file__).with_name("qa_worldchurn_8892.out.json")
    out.write_text(json.dumps(rows, indent=1), encoding="utf-8")
    print("wrote", out)

    print("\n== PER-SWITCH SUMMARY "
          "(charD=char y-ground, shPrism=worst shrine prism base err, "
          "lmPrism=worst live landmark base err vs seatY+off)")
    hdr = ("tag       realmS/L/E        bakes charD  shPrism  lmLive lmInst "
           "lmPrismErr lmRel[min,max] geo tex prog calls")
    print(hdr)
    for r in rows:
        print("%-9s %-17s %5d %6.2f %8.2f %6d %6d %10.2f  [%7.1f,%7.1f] "
              "%3d %3d %4d %5d" % (
                  r["tag"],
                  "%s/%s/%s" % (r["realm"]["shrine"][:4],
                                r["realm"]["landmarks"][:4],
                                str(r["realm"]["enc"])[:4]),
                  r["bakes"], r["char"]["d"], r["shrinePrismMaxErr"],
                  r["lmLive"], r["lmInstances"], r["lmPrismMaxErr"],
                  r["lmRelMin"], r["lmRelMax"],
                  r["gpu"]["geo"], r["gpu"]["tex"], r["gpu"]["prog"],
                  r["gpu"]["calls"]))

    print("\n== SHRINE GRADE / GROUNDING PER REALM (grade floor from the hunt: "
          "0.35)")
    seen = {}
    for r in rows:
        seen[r["realm"]["shrine"]] = r          # keep the LAST visit of each
    for realm, r in seen.items():
        print("\n--", realm, " (from", r["tag"], ")")
        for s in r["shrines"]:
            flag = "  <== GRADE" if s["grade"] >= 0.35 else ""
            flag += "  <== UNGROUNDED" if abs(s["dy"]) > 0.05 else ""
            print("   %-11s x=%8.1f z=%8.1f  dy=%7.3f  grade=%6.3f%s"
                  % (s["id"], s["x"], s["z"], s["dy"], s["grade"], flag))


if __name__ == "__main__":
    main()
