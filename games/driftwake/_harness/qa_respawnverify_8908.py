# -*- coding: utf-8 -*-
"""
qa_respawnverify_8908.py -- ADVERSARIAL verification of the claim
"respawn lands inside the spawn monolith; the spawn shrine sits on a 42 deg
face while the six ring shrines are nudged flat".

Independent checks the hunt lane did NOT run:
  1. Is the "inside the monolith" seam UNIQUE to shrine 0, or does every one
     of the seven do it?  (respawn at shrine_e too)
  2. Is grade 0.913 actually EXCEPTIONAL, or is it an ordinary slope for this
     heightfield?  -> full grade distribution over the 620 m play disc.
  3. Does the player STAY inside the prism, or slide/settle out on his own
     within a few seconds?  (3 game-seconds of no input, tracked)
  4. Is the landed y sane (on the surface, not buried/floating)?
GAME-TIME waits only (registry.time via rAF).  Own port, own server.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8908
GAME_URL = "http://localhost:%d/games/driftwake/index.html?autoplay&test" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

PRELUDE = r"""
window.__v = (function () {
    const SF = SNOWFLOW, reg = SF.combat.registry, T = SF.terrain;
    const rafs = (n) => new Promise((r) => {
        let k = 0;
        const t = () => { if (++k >= n) r(); else requestAnimationFrame(t); };
        requestAnimationFrame(t);
    });
    const gwait = (s) => new Promise((r) => {
        const t0 = reg.time;
        const t = () => (reg.time - t0 >= s) ? r() : requestAnimationFrame(t);
        t();
    });
    const grade = (x, z) => {
        const e = 2;
        const gx = (T.heightAt(x + e, z) - T.heightAt(x - e, z)) / (2 * e);
        const gz = (T.heightAt(x, z + e) - T.heightAt(x, z - e)) / (2 * e);
        return Math.hypot(gx, gz);
    };

    /** Grade over the whole play disc, deterministic lattice. */
    const gradeDist = (step) => {
        const R = T.playRadius, g = [];
        for (let z = -R; z <= R; z += step) {
            for (let x = -R; x <= R; x += step) {
                if (Math.hypot(x, z) > R - 40) continue;
                g.push(grade(x, z));
            }
        }
        g.sort((a, b) => a - b);
        const pc = (p) => +g[Math.min(g.length - 1,
            Math.floor(p * g.length))].toFixed(3);
        return {
            n: g.length,
            p10: pc(0.10), p25: pc(0.25), p50: pc(0.50), p75: pc(0.75),
            p90: pc(0.90), p95: pc(0.95), p99: pc(0.99),
            max: +g[g.length - 1].toFixed(3),
            mean: +(g.reduce((a, b) => a + b, 0) / g.length).toFixed(3),
        };
    };
    /** Where does value v sit in that lattice?  Returns percentile 0..1. */
    const pctOf = (v, step) => {
        const R = T.playRadius; let n = 0, below = 0;
        for (let z = -R; z <= R; z += step) {
            for (let x = -R; x <= R; x += step) {
                if (Math.hypot(x, z) > R - 40) continue;
                n++; if (grade(x, z) < v) below++;
            }
        }
        return +(below / n).toFixed(3);
    };

    /** Per-shrine: grade at the shrine point + at its 12 prism bases. */
    const shrines = () => {
        const sh = SF.shrine, d = sh._texData, w = 84 * 4, out = [];
        for (let s = 0; s < sh.positions.length; s++) {
            const p = sh.positions[s];
            const o0 = (s * 12) * 4;
            out.push({
                id: p.id,
                x: +p.x.toFixed(2), z: +p.z.toFixed(2),
                grade: +grade(p.x, p.z).toFixed(3),
                monoX: +d[o0].toFixed(3), monoZ: +d[o0 + 2].toFixed(3),
                monoRad: +d[w + o0 + 3].toFixed(3),
                monoH: +d[o0 + 3].toFixed(2),
                monoOffFromShrine: +Math.hypot(d[o0] - p.x,
                    d[o0 + 2] - p.z).toFixed(4),
            });
        }
        return out;
    };

    /** Kill the player far away, let the respawn land, then WATCH for 3 s. */
    const dieAndWatch = async (shrineId, awayX, awayZ) => {
        const c = SF.character, prog = SF.progression, sh = SF.shrine;
        if (shrineId) prog.lastShrineId = shrineId;
        const beforeId = prog.lastShrineId;
        c.position.set(awayX, T.heightAt(awayX, awayZ), awayZ);
        await rafs(4);
        c.health = 0;
        await gwait(2.6);
        await rafs(10);
        const idx = sh.positions.findIndex((p) => p.id === prog.lastShrineId);
        const p = sh.positions[Math.max(0, idx)];
        const d = sh._texData, w = 84 * 4, o0 = (Math.max(0, idx) * 12) * 4;
        const snap = (tag) => ({
            tag,
            x: +c.position.x.toFixed(3), z: +c.position.z.toFixed(3),
            y: +c.position.y.toFixed(3),
            aboveGround: +(c.position.y
                - T.heightAt(c.position.x, c.position.z)).toFixed(3),
            distToMonoAxis: +Math.hypot(c.position.x - d[o0],
                c.position.z - d[o0 + 2]).toFixed(3),
            speed: +Math.hypot(c.velocity.x, c.velocity.z).toFixed(3),
        });
        const t0 = snap("t+0.0s");
        await gwait(3.0);
        const t3 = snap("t+3.0s");
        return {
            requested: shrineId || "(default)", resolvedId: prog.lastShrineId,
            sameAsBefore: beforeId === prog.lastShrineId,
            shrine: { id: p.id, x: +p.x.toFixed(2), z: +p.z.toFixed(2) },
            monoRad: +d[w + o0 + 3].toFixed(3), monoH: +d[o0 + 3].toFixed(2),
            // the hex base's smallest possible inradius: rad*0.72*cos(30)
            minInradius: +(d[w + o0 + 3] * 0.72 * 0.8660).toFixed(3),
            samples: [t0, t3],
            deaths: SF.progression.deaths,
        };
    };
    return { rafs, gwait, grade, gradeDist, pctOf, shrines, dieAndWatch };
})();
"""


def main():
    from playwright.sync_api import sync_playwright
    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2.5)
    out = {}
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=180000)
            pg.wait_for_timeout(2500)
            pg.evaluate(PRELUDE)

            out["startOfRun"] = pg.evaluate(r"""() => {
                const T = SNOWFLOW.terrain, sh = SNOWFLOW.shrine;
                return {
                    charAtBoot: null,
                    gradeAtOrigin: +window.__v.grade(0, 0).toFixed(3),
                    gradeAtAuthored: +window.__v.grade(5.0, 5.5).toFixed(3),
                    originToShrine0: +Math.hypot(sh.positions[0].x,
                        sh.positions[0].z).toFixed(2),
                    playRadius: T.playRadius,
                };
            }""")

            for token in ("cold", "sand", "ash"):
                pg.evaluate("(t) => SNOWFLOW.enterRealm(t)", token)
                pg.wait_for_function("(t) => SNOWFLOW.shrine.realm === t",
                                     arg=token, timeout=60000)
                pg.evaluate("() => window.__v.rafs(30)")
                pg.wait_for_timeout(600)
                r = {}
                r["shrines"] = pg.evaluate("() => window.__v.shrines()")
                r["gradeDist"] = pg.evaluate("() => window.__v.gradeDist(20)")
                r["spawnGradePct"] = pg.evaluate(
                    "() => window.__v.pctOf(window.__v.grade("
                    "SNOWFLOW.shrine.positions[0].x,"
                    "SNOWFLOW.shrine.positions[0].z), 20)")
                r["respawn_spawn"] = pg.evaluate(
                    "() => window.__v.dieAndWatch('cold_spawn', 210, 175)")
                pg.screenshot(path=str(Path(__file__).with_name(
                    "qa_respawnverify_%s_spawn.png" % token)))
                r["respawn_ring"] = pg.evaluate(
                    "() => window.__v.dieAndWatch('shrine_e', 210, 175)")
                pg.screenshot(path=str(Path(__file__).with_name(
                    "qa_respawnverify_%s_ring.png" % token)))
                out[token] = r
            out["pageerrors"] = errs
            br.close()
    finally:
        srv.terminate()
    p = Path(__file__).with_suffix(".out.json")
    p.write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
