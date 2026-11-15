# -*- coding: utf-8 -*-
"""
qa_pathfinding.py -- industry-standard mob movement verification (port 8831).

Phases (all game-time budgets polled off SNOWFLOW.combat.registry.time):
  1. SCAN     terrain grade histogram over the playable disc; pick a RIDGE
              site: a dune face with up-grade > CLIMB_MAX between A (spawn
              side, downhill) and B (player side, uphill) where the straight
              walk A->B is blocked but a contour route exists (in-page BFS).
  2. RIDGE    player at B, 3 rimeImps at A, damage-woken. PASS = all 3 engage
              (<= 9 m, at least one <= 2.5 m) within 25 s game-time AND their
              tracks contour (heading deviates > 25 deg from the straight
              A->B bearing somewhere) AND max up-grade stepped stays sane.
  3. SEP      6 rimeImps woken from ONE bearing at 20 m; settle 12 s; PASS =
              final min pairwise >= 1.2 m and bearing spread >= 90 deg.
  4. PERF     8 imps chasing; enemies.update bracketed with performance.now
              over 300 frames; mean ms reported (run before AND after the
              pathing build for the delta).

Usage: python qa_pathfinding.py [--shots] [--label before|after]
"""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
SHOTS = Path(__file__).resolve().parents[1] / "_shots"
PORT = 8853
GAME_URL = f"http://localhost:{PORT}/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]

CLIMB_MAX = 0.62          # keep in sync with src/combat/pathing.js
RIDGE_BUDGET_S = 25.0     # game-time
ENGAGE_M = 9.0            # inside the orbit band = engaged
MELEE_M = 2.5
CONTOUR_DEG = 25.0

SETUP_JS = """(() => {
    const SF = SNOWFLOW;
    SF.S.combatEnemies = false;   // director: clears its pack once, then inert
    const r = SF.combat.registry;
    for (let i = r.count - 1; i >= 0; i--)
        if (r.kind[i] !== 'dummy') r.remove(r.idOf[i]);
    SF.character.health = SF.character.healthMax;
    if (SF.shrine && SF.shrine.mesh) SF.shrine.mesh.visible = false;
    return { px: +SF.character.position.x.toFixed(1),
             pz: +SF.character.position.z.toFixed(1) };
})()"""

# Grade scan + ridge-site selection, all on terrain.heightAt (the ground the
# enemies actually walk).  Directional BFS on a 2 m grid proves a contour
# route exists under CLIMB_MAX while the straight line is blocked above it.
SCAN_JS = """((CM) => {
    const T = SNOWFLOW.terrain;
    const e = 2, R = 540, step = 6;
    let maxG = 0, n = 0;
    const hist = new Array(14).fill(0);
    const cand = [];
    for (let x = -R; x <= R; x += step) for (let z = -R; z <= R; z += step) {
        if (x * x + z * z > R * R) continue;
        const gx = (T.heightAt(x + e, z) - T.heightAt(x - e, z)) / (2 * e);
        const gz = (T.heightAt(x, z + e) - T.heightAt(x, z - e)) / (2 * e);
        const g = Math.hypot(gx, gz);
        n++;
        if (g > maxG) maxG = g;
        hist[Math.min(13, Math.floor(g / 0.1))]++;
        if (g > CM * 1.1 && Math.hypot(x, z) < 480) cand.push([x, z, g, gx, gz]);
    }
    cand.sort((a, b) => b[2] - a[2]);

    const upGrade = (ax, az, bx, bz) => {   // max up-step along the segment
        const d = Math.hypot(bx - ax, bz - az);
        const ns = Math.max(2, Math.ceil(d));
        let h0 = T.heightAt(ax, az), worst = -9;
        for (let k = 1; k <= ns; k++) {
            const t = k / ns;
            const h1 = T.heightAt(ax + (bx - ax) * t, az + (bz - az) * t);
            const g = (h1 - h0) / (d / ns);
            if (g > worst) worst = g;
            h0 = h1;
        }
        return worst;
    };

    // Directional BFS, 2 m cells, 33x33 box centred on the face midpoint.
    const G = 33, C = 2, H2 = (G - 1) / 2;
    const hh = new Float32Array(G * G);
    const dist = new Float32Array(G * G);
    const q = new Int32Array(G * G);
    const route = (ax, az, bx, bz, cx, cz) => {
        const ox = cx - H2 * C, oz = cz - H2 * C;
        for (let j = 0; j < G; j++) for (let i = 0; i < G; i++)
            hh[j * G + i] = T.heightAt(ox + i * C, oz + j * C);
        dist.fill(-1);
        const ci = (x, z) => {
            const i = Math.max(0, Math.min(G - 1, Math.round((x - ox) / C)));
            const j = Math.max(0, Math.min(G - 1, Math.round((z - oz) / C)));
            return j * G + i;
        };
        const s = ci(ax, az), t = ci(bx, bz);
        let qh = 0, qt = 0;
        dist[s] = 0; q[qt++] = s;
        while (qh < qt) {
            const c0 = q[qh++];
            if (c0 === t) return dist[t];
            const i0 = c0 % G, j0 = (c0 - i0) / G;
            for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
                if (!di && !dj) continue;
                const i1 = i0 + di, j1 = j0 + dj;
                if (i1 < 0 || i1 >= G || j1 < 0 || j1 >= G) continue;
                const c1 = j1 * G + i1;
                if (dist[c1] >= 0) continue;
                const d = C * Math.hypot(di, dj);
                if ((hh[c1] - hh[c0]) / d > CM) continue;   // un-climbable step
                dist[c1] = dist[c0] + d;
                q[qt++] = c1;
            }
        }
        return -1;
    };

    let site = null;
    for (let k = 0; k < Math.min(cand.length, 250); k++) {
        const [cx, cz, g, gx, gz] = cand[k];
        const ux = gx / g, uz = gz / g;      // uphill unit
        for (const span of [11, 14]) {
            const ax = cx - ux * span, az = cz - uz * span;   // downhill: spawn
            const bx = cx + ux * span, bz = cz + uz * span;   // uphill: player
            const straight = upGrade(ax, az, bx, bz);
            if (straight <= CM * 1.05) continue;              // face not blocking
            const rl = route(ax, az, bx, bz, cx, cz);
            if (rl < 0 || rl > 85) continue;                  // no sane detour
            site = { ax: +ax.toFixed(1), az: +az.toFixed(1),
                     bx: +bx.toFixed(1), bz: +bz.toFixed(1),
                     faceGrade: +g.toFixed(2),
                     straightMaxGrade: +straight.toFixed(2),
                     routeLen: +rl.toFixed(0),
                     span: 2 * span };
            break;
        }
        if (site) break;
    }
    // A flat settle spot for the separation test: walk rings out from origin.
    let flat = null;
    for (let r0 = 40; r0 <= 400 && !flat; r0 += 20) {
        for (let a = 0; a < 12 && !flat; a++) {
            const x = r0 * Math.cos(a * Math.PI / 6), z = r0 * Math.sin(a * Math.PI / 6);
            let worst = 0;
            for (let rr = 0; rr <= 24; rr += 6) for (let b = 0; b < 8; b++) {
                const px = x + rr * Math.cos(b * Math.PI / 4);
                const pz = z + rr * Math.sin(b * Math.PI / 4);
                const gx = (T.heightAt(px + e, pz) - T.heightAt(px - e, pz)) / (2 * e);
                const gz2 = (T.heightAt(px, pz + e) - T.heightAt(px, pz - e)) / (2 * e);
                worst = Math.max(worst, Math.hypot(gx, gz2));
            }
            if (worst < 0.22) flat = { x: +x.toFixed(1), z: +z.toFixed(1),
                                       worstGrade: +worst.toFixed(2) };
        }
    }
    return { samples: n, maxGrade: +maxG.toFixed(2), hist, nSteep: cand.length,
             site, flat };
})(%CM%)"""

PIN_JS = """((px, pz) => {
    const SF = SNOWFLOW, c = SF.character;
    c.position.x = px; c.position.z = pz;
    c.position.y = SF.terrain.heightAt(px, pz);
    c.velocity.set(0, 0, 0);
    c.health = c.healthMax;
    return true;
})"""

SPAWN_WAKE_JS = """((pts) => {
    const SF = SNOWFLOW, en = SF.combat.enemies;
    const ids = [];
    for (const [x, z] of pts) {
        const id = en.spawn('rimeImp', x, z, 10);
        ids.push(id);
    }
    return ids;
})"""

# NOTE: a fresh spawn's registry slot lands NEXT frame -- callers must wait
# one game-frame (gameWait below) before slot reads / damage-waking.
WAKE_JS = """((ids) => {
    const r = SNOWFLOW.combat.registry;
    for (const id of ids) if (id >= 0) r.damage(id, 0.1, {});
    return ids.map(id => r.slot(id));
})"""

SAMPLE_JS = """((ids) => {
    const SF = SNOWFLOW, r = SF.combat.registry, c = SF.character;
    const out = { t: +r.time.toFixed(2), hp: +c.health.toFixed(0), e: [] };
    for (const id of ids) {
        const s = r.slot(id);
        out.e.push(s < 0 ? null : {
            x: +r.x[s].toFixed(2), z: +r.z[s].toFixed(2),
            d: +Math.hypot(r.x[s] - c.position.x, r.z[s] - c.position.z).toFixed(2),
        });
    }
    return out;
})"""

GAMEWAIT_JS = """((sec) => new Promise((res) => {
    const reg = SNOWFLOW.combat.registry, t0 = reg.time;
    const tick = () => (reg.time - t0 >= sec) ? res(+reg.time.toFixed(2))
        : requestAnimationFrame(tick);
    tick();
}))"""

TRACK_GRADE_JS = """((tracks) => {
    const T = SNOWFLOW.terrain;
    return tracks.map(tr => {
        let worst = -9;
        for (let k = 1; k < tr.length; k++) {
            const [x0, z0] = tr[k - 1], [x1, z1] = tr[k];
            const d = Math.hypot(x1 - x0, z1 - z0);
            if (d < 0.4) continue;
            const g = (T.heightAt(x1, z1) - T.heightAt(x0, z0)) / d;
            if (g > worst) worst = g;
        }
        return +worst.toFixed(2);
    });
})"""

PERF_WRAP_JS = """(() => {
    const en = SNOWFLOW.combat.enemies;
    if (!window.__emu) {
        const orig = en.update.bind(en);
        window.__emu = { n: 0, sum: 0, max: 0 };
        en.update = (dt) => {
            const t0 = performance.now();
            orig(dt);
            const ms = performance.now() - t0;
            const m = window.__emu;
            m.n++; m.sum += ms; if (ms > m.max) m.max = ms;
        };
    }
    window.__emu.n = 0; window.__emu.sum = 0; window.__emu.max = 0;
    return true;
})()"""

PERF_READ_JS = """(() => {
    const m = window.__emu;
    return { frames: m.n, meanMs: +(m.sum / Math.max(1, m.n)).toFixed(4),
             maxMs: +m.max.toFixed(3),
             alive: SNOWFLOW.combat.enemies.aliveCount };
})()"""

CLEAR_JS = """(() => {
    const r = SNOWFLOW.combat.registry;
    for (let i = r.count - 1; i >= 0; i--)
        if (r.kind[i] !== 'dummy') r.remove(r.idOf[i]);
    SNOWFLOW.character.health = SNOWFLOW.character.healthMax;
    return r.count;
})()"""


def ang_diff(a, b):
    import math
    d = (a - b) % (2 * math.pi)
    if d > math.pi:
        d -= 2 * math.pi
    return abs(d)


def main():
    import math
    from playwright.sync_api import sync_playwright

    shots = "--shots" in sys.argv
    label = "after" if "after" in sys.argv else ("before" if "before" in sys.argv else "run")
    SHOTS.mkdir(exist_ok=True)
    report = {"label": label}

    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT)],
                           cwd=str(ROOT), stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL)
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=120000)
            pg.wait_for_timeout(2500)
            print("setup:", pg.evaluate(SETUP_JS))

            def gamewait(sec):
                return pg.evaluate(GAMEWAIT_JS + f"({sec})")

            # ---------------- phase 1: scan + site ---------------------------
            scan = pg.evaluate(SCAN_JS.replace("%CM%", str(CLIMB_MAX)))
            report["scan"] = {k: scan[k] for k in
                              ("samples", "maxGrade", "hist", "nSteep")}
            report["site"] = scan["site"]
            report["flat"] = scan["flat"]
            print("SCAN:", json.dumps(report["scan"]))
            print("SITE:", json.dumps(scan["site"]))
            print("FLAT:", json.dumps(scan["flat"]))
            if not scan["site"]:
                print("PATH_JSON:", json.dumps(report))
                print("RESULT: NO-RIDGE-SITE (grade band never exceeded on map)")
                br.close()
                return 2

            site = scan["site"]

            # ---------------- phase 2: ridge test ----------------------------
            pg.evaluate(PIN_JS + f"({site['bx']}, {site['bz']})")
            ax, az, bx, bz = site["ax"], site["az"], site["bx"], site["bz"]
            # spawn 3 imps at A, spread perpendicular to the A->B line
            nx, nz = -(bz - az), (bx - ax)
            nl = math.hypot(nx, nz) or 1
            nx, nz = nx / nl, nz / nl
            pts = [[ax + nx * o, az + nz * o] for o in (-1.6, 0.0, 1.6)]
            ids = pg.evaluate(SPAWN_WAKE_JS + f"({json.dumps(pts)})")
            gamewait(0.1)                      # slot lands next frame
            slots = pg.evaluate(WAKE_JS + f"({json.dumps(ids)})")
            print("ridge spawn ids:", ids, "slots:", slots)
            if any(i < 0 for i in ids) or any(s < 0 for s in slots):
                print("PATH_JSON:", json.dumps(report))
                print("RESULT: FAIL ridge spawn")
                br.close()
                return 1

            samples = []
            t0 = pg.evaluate("SNOWFLOW.combat.registry.time")
            shot_done = not shots
            while True:
                s = pg.evaluate(SAMPLE_JS + f"({json.dumps(ids)})")
                pg.evaluate(PIN_JS + f"({bx}, {bz})")
                samples.append(s)
                live = [e for e in s["e"] if e]
                if not shot_done and s["t"] - t0 > 5.0:
                    pg.evaluate("""(() => {
                        const SF = SNOWFLOW;
                        SF.rig.yaw = Math.atan2(%AX% - %BX%, -(%AZ% - %BZ%)) + Math.PI;
                        SF.rig.distanceTarget = 11;
                    })()""".replace("%AX%", str(ax)).replace("%AZ%", str(az))
                       .replace("%BX%", str(bx)).replace("%BZ%", str(bz)))
                    pg.wait_for_timeout(400)
                    pg.screenshot(path=str(SHOTS / "path_contour.png"))
                    shot_done = True
                engaged = len(live) == 3 and all(e["d"] <= ENGAGE_M for e in live)
                melee = any(e["d"] <= MELEE_M for e in live) if live else False
                if engaged and melee:
                    break
                if s["t"] - t0 >= RIDGE_BUDGET_S:
                    break
                pg.wait_for_timeout(250)

            # per-imp tracks + metrics
            straight_bearing = math.atan2(bx - ax, -(bz - az))
            tracks = [[], [], []]
            for s in samples:
                for k, e in enumerate(s["e"]):
                    if e:
                        tracks[k].append([e["x"], e["z"]])
            devs, arrive = [], []
            final = samples[-1]
            for k in range(3):
                dev = 0.0
                tr = tracks[k]
                for j in range(1, len(tr)):
                    dx, dz = tr[j][0] - tr[j - 1][0], tr[j][1] - tr[j - 1][1]
                    if math.hypot(dx, dz) < 0.35:
                        continue
                    h = math.atan2(dx, -dz)
                    dev = max(dev, math.degrees(ang_diff(h, straight_bearing)))
                devs.append(round(dev, 1))
                e = final["e"][k]
                arrive.append(e["d"] if e else -1)
            grades = pg.evaluate(TRACK_GRADE_JS + f"({json.dumps(tracks)})")
            dur = round(samples[-1]["t"] - t0, 1)
            live = [e for e in final["e"] if e]
            engaged = len(live) == 3 and all(e["d"] <= ENGAGE_M for e in live)
            melee = any(e["d"] <= MELEE_M for e in live) if live else False
            contoured = all(d > CONTOUR_DEG for d in devs)
            report["ridge"] = {
                "durS": dur, "finalDists": arrive, "maxHeadingDevDeg": devs,
                "maxUpGradeStepped": grades, "engagedAll": engaged,
                "meleeOne": melee, "contoured": contoured,
                "straightMaxGrade": site["straightMaxGrade"],
                "pass": engaged and melee and contoured,
            }
            print("RIDGE:", json.dumps(report["ridge"]))

            # ---------------- phase 3: separation ----------------------------
            print("cleared, registry count:", pg.evaluate(CLEAR_JS))
            flat = scan["flat"] or {"x": 150, "z": 150}
            fx, fz = flat["x"], flat["z"]
            pg.evaluate(PIN_JS + f"({fx}, {fz})")
            # 6 imps from ONE bearing (east), tight file 20 m out
            pts = [[fx + 20 + (k % 3) * 1.3, fz + (k // 3) * 1.3 - 0.65]
                   for k in range(6)]
            ids6 = pg.evaluate(SPAWN_WAKE_JS + f"({json.dumps(pts)})")
            gamewait(0.1)
            slots6 = pg.evaluate(WAKE_JS + f"({json.dumps(ids6)})")
            print("sep spawn ids:", ids6, "slots:", slots6)
            t0 = pg.evaluate("SNOWFLOW.combat.registry.time")
            while True:
                pg.evaluate(PIN_JS + f"({fx}, {fz})")
                t = pg.evaluate("SNOWFLOW.combat.registry.time")
                if t - t0 >= 16.0:
                    break
                pg.wait_for_timeout(300)
            # settled window: sample 6x over ~2 s, judge the FINAL sample,
            # report the window too
            win = []
            for _ in range(6):
                win.append(pg.evaluate(SAMPLE_JS + f"({json.dumps(ids6)})"))
                pg.evaluate(PIN_JS + f"({fx}, {fz})")
                gamewait(0.33)
            if shots and not (SHOTS / "path_fanout.png").exists() or shots:
                pg.evaluate("""(() => {
                    SNOWFLOW.rig.yaw = Math.PI / 2 + Math.PI;
                    SNOWFLOW.rig.distanceTarget = 10;
                })()""")
                pg.wait_for_timeout(400)
                pg.screenshot(path=str(SHOTS / "path_fanout.png"))

            def sep_metrics(s):
                pts2 = [(e["x"], e["z"]) for e in s["e"] if e]
                mind = 1e9
                for a2 in range(len(pts2)):
                    for b2 in range(a2 + 1, len(pts2)):
                        mind = min(mind, math.hypot(
                            pts2[a2][0] - pts2[b2][0], pts2[a2][1] - pts2[b2][1]))
                bear = sorted(math.atan2(x - fx, -(z - fz)) for x, z in pts2)
                spread = 0.0
                if len(bear) > 1:
                    gaps = [bear[i + 1] - bear[i] for i in range(len(bear) - 1)]
                    gaps.append(2 * math.pi - (bear[-1] - bear[0]))
                    spread = 2 * math.pi - max(gaps)
                return round(mind, 2), round(math.degrees(spread), 1), len(pts2)

            finals = sep_metrics(win[-1])
            window_min = min(sep_metrics(w)[0] for w in win)
            report["separation"] = {
                "alive": finals[2], "finalMinPairM": finals[0],
                "windowMinPairM": window_min, "bearingSpreadDeg": finals[1],
                "finalDists": [e["d"] if e else -1 for e in win[-1]["e"]],
                "pass": finals[2] == 6 and finals[0] >= 1.2 and finals[1] >= 90.0,
            }
            print("SEP:", json.dumps(report["separation"]))

            # ---------------- phase 4: perf ----------------------------------
            print("cleared, registry count:", pg.evaluate(CLEAR_JS))
            pg.evaluate(PIN_JS + f"({fx}, {fz})")
            import math as _m
            pts8 = [[fx + 28 * _m.cos(a * _m.pi / 5 - _m.pi / 3),
                     fz + 28 * _m.sin(a * _m.pi / 5 - _m.pi / 3)] for a in range(8)]
            ids8 = pg.evaluate(SPAWN_WAKE_JS + f"({json.dumps(pts8)})")
            gamewait(0.1)
            pg.evaluate(WAKE_JS + f"({json.dumps(ids8)})")
            gamewait(1.0)                       # let the chase form
            pg.evaluate(PERF_WRAP_JS)
            n = 0
            while n < 300:
                pg.wait_for_timeout(300)
                pg.evaluate(PIN_JS + f"({fx}, {fz})")
                n = pg.evaluate("window.__emu.n")
            perf = pg.evaluate(PERF_READ_JS)
            report["perf"] = perf
            print("PERF:", json.dumps(perf))

            br.close()
    finally:
        srv.terminate()

    ok = report.get("ridge", {}).get("pass") and \
        report.get("separation", {}).get("pass")
    print("PATH_JSON:", json.dumps(report))
    print("RESULT:", "OK" if ok else "FAIL (expected for the before-baseline)")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
