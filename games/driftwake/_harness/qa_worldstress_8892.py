# -*- coding: utf-8 -*-
"""
qa_worldstress_8892.py -- the awkward corners of the world layer.

  A) SPAWN SLOPE      terrain profile + the 12-prism base spread of every
                      shrine formation, per realm. The `_layout` flat-spot
                      nudge only runs on shrines 1..6 and only against COLD's
                      heightfield, so this is where that shows up.
  B) LANDMARK GEOMETRY live min distances (landmark<->landmark,
                      landmark<->shrine, landmark<->spawn) and per-instance
                      float/bury, per realm.
  C) RAPID SWITCH     three enterRealm calls with NO await between them --
                      does the shrine/landmark re-ground still land on the
                      realm that won?
  D) SWITCH WHILE DEAD realm swap inside the 1.5 s death fade: where does the
                      respawn land, and is it on the NEW ground?
  E) SWITCH AIRBORNE  realm swap mid-jump.
  F) CHURN + DEATH    12 more switches with a death in each -- prism counts,
                      instance counts, GPU object counts, deaths counter.
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
window.__ws = (function () {
    const SF = SNOWFLOW, T = SF.terrain, reg = SF.combat.registry;
    const rafs = (n) => new Promise((res) => {
        let k = 0;
        const t = () => { if (++k >= n) res(); else requestAnimationFrame(t); };
        requestAnimationFrame(t);
    });
    const gwait = (sec) => new Promise((res) => {
        const t0 = reg.time;
        const t = () => (reg.time - t0 >= sec) ? res()
            : requestAnimationFrame(t);
        t();
    });
    const grade = (x, z) => {
        const e = 2;
        const gx = (T.heightAt(x + e, z) - T.heightAt(x - e, z)) / (2 * e);
        const gz = (T.heightAt(x, z + e) - T.heightAt(x, z - e)) / (2 * e);
        return Math.hypot(gx, gz);
    };
    /** Per-shrine formation report: the 12 prism bases in the data texture. */
    const formations = () => {
        const sh = SF.shrine, d = sh._texData;
        const out = [];
        for (let s = 0; s < sh.positions.length; s++) {
            let lo = 1e9, hi = -1e9, mono = 0;
            for (let q = 0; q < 12; q++) {
                const o = (s * 12 + q) * 4;
                const h = T.heightAt(d[o], d[o + 2]);
                if (q === 0) mono = h;
                if (h < lo) lo = h;
                if (h > hi) hi = h;
            }
            const p = sh.positions[s];
            // 8-point profile at 3 m, the outlier radius
            const prof = [];
            for (let k = 0; k < 8; k++) {
                const a = k * Math.PI / 4;
                prof.push(+(T.heightAt(p.x + Math.cos(a) * 3,
                    p.z + Math.sin(a) * 3) - mono).toFixed(2));
            }
            out.push({
                id: p.id, grade: +grade(p.x, p.z).toFixed(3),
                spread: +(hi - lo).toFixed(2),
                monoRel: { below: +(mono - lo).toFixed(2),
                           above: +(hi - mono).toFixed(2) },
                prof3m: prof,
            });
        }
        return out;
    };
    const geometry = () => {
        const lm = SF.landmarks, sh = SF.shrine;
        const inst = lm.stats.instances;
        let mLL = 1e9, mLS = 1e9, mLSpawn = 1e9;
        for (let i = 0; i < inst.length; i++) {
            for (let j = i + 1; j < inst.length; j++) {
                const d = Math.hypot(inst[i].x - inst[j].x,
                    inst[i].z - inst[j].z);
                if (d < mLL) mLL = d;
            }
            for (const p of sh.positions) {
                const d = Math.hypot(inst[i].x - p.x, inst[i].z - p.z);
                if (d < mLS) mLS = d;
            }
            const ds = Math.hypot(inst[i].x - sh.positions[0].x,
                inst[i].z - sh.positions[0].z);
            if (ds < mLSpawn) mLSpawn = ds;
        }
        // per-instance anchor float/bury
        const bad = inst.filter((s) =>
            Math.abs(s.y - T.heightAt(s.x, s.z)) > 0.05)
            .map((s) => ({ t: s.type, dy: +(s.y - T.heightAt(s.x, s.z))
                .toFixed(2) }));
        return {
            realm: lm.realm, n: inst.length,
            minLmLm: +mLL.toFixed(1), minLmShrine: +mLS.toFixed(1),
            minLmSpawn: +mLSpawn.toFixed(1), ungrounded: bad,
        };
    };
    const world = (tag) => {
        const c = SF.character, lm = SF.landmarks, sh = SF.shrine;
        const info = SF.renderer.info;
        const sd = sh._texData;
        let sMax = 0;
        for (let p = 0; p < 84; p++) {
            const o = p * 4;
            const e = sd[o + 1] - (T.heightAt(sd[o], sd[o + 2]) - 0.02);
            if (Math.abs(e) > Math.abs(sMax)) sMax = e;
        }
        let live = 0;
        for (let p = 0; p < lm.prismCount; p++) if (lm._target[p] === 1) live++;
        return {
            tag, realmS: sh.realm, realmL: lm.realm,
            bakes: T.rebakeCount,
            charD: +(c.position.y
                - T.heightAt(c.position.x, c.position.z)).toFixed(3),
            shrinePrismMaxErr: +sMax.toFixed(3),
            lmLive: live, lmInst: lm.stats.liveInstances,
            deaths: SF.progression.deaths,
            geo: info.memory.geometries, tex: info.memory.textures,
            prog: info.programs ? info.programs.length : -1,
        };
    };
    return { rafs, gwait, grade, formations, geometry, world };
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
            pg.on("console", lambda m: errs.append(m.text)
                  if m.type == "error" else None)
            pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=180000)
            pg.wait_for_timeout(2500)
            pg.evaluate(PRELUDE)

            # ---- A + B per realm
            res["formations"] = {}
            res["geometry"] = {}
            for token in ("cold", "sand", "ash"):
                pg.evaluate("(t) => SNOWFLOW.enterRealm(t)", token)
                pg.wait_for_function(
                    "(t) => SNOWFLOW.shrine.realm === t", arg=token,
                    timeout=60000)
                pg.evaluate("() => window.__ws.rafs(20)")
                pg.wait_for_timeout(700)
                res["formations"][token] = pg.evaluate(
                    "() => window.__ws.formations()")
                res["geometry"][token] = pg.evaluate(
                    "() => window.__ws.geometry()")

            # ---- C rapid switch, no await between calls
            res["rapid"] = pg.evaluate(r"""async () => {
                const SF = SNOWFLOW;
                SF.enterRealm('sand'); SF.enterRealm('ash');
                const last = SF.enterRealm('cold');
                await last;
                await window.__ws.rafs(30);
                const a = window.__ws.world('rapid-t0');
                await window.__ws.rafs(120);
                const b = window.__ws.world('rapid-t2s');
                return [a, b];
            }""")

            # ---- D realm switch DURING the death fade
            res["dieThenSwitch"] = pg.evaluate(r"""async () => {
                const SF = SNOWFLOW, c = SF.character, T = SF.terrain;
                await SF.enterRealm('cold');
                await window.__ws.rafs(20);
                c.position.set(240, T.heightAt(240, 240), 240);
                await window.__ws.rafs(4);
                c.health = 0;                 // death edge
                await window.__ws.rafs(3);
                SF.enterRealm('ash');         // mid-fade swap
                await window.__ws.gwait(3.0);
                await window.__ws.rafs(10);
                const w = window.__ws.world('dead-swap');
                w.pos = { x: +c.position.x.toFixed(2),
                          z: +c.position.z.toFixed(2),
                          y: +c.position.y.toFixed(2) };
                w.groundHere = +T.heightAt(c.position.x, c.position.z)
                    .toFixed(2);
                w.hp = +(c.health / c.healthMax).toFixed(2);
                w.dead = SF.progression.dead;
                return w;
            }""")
            # the SAME frame the respawn lands, before any re-seat
            res["dieThenSwitchTight"] = pg.evaluate(r"""async () => {
                const SF = SNOWFLOW, c = SF.character, T = SF.terrain;
                await SF.enterRealm('cold');
                await window.__ws.rafs(20);
                c.position.set(-300, T.heightAt(-300, 120), 120);
                await window.__ws.rafs(4);
                c.health = 0;
                await window.__ws.rafs(2);
                SF.enterRealm('sand');
                // sample EVERY frame for 4 s and record the worst grounding
                let worst = 0, worstAt = -1, f = 0, respawnF = -1;
                const t0 = SF.combat.registry.time;
                while (SF.combat.registry.time - t0 < 4) {
                    await window.__ws.rafs(1); f++;
                    if (respawnF < 0 && !SF.progression.dead
                        && c.health > 0) respawnF = f;
                    const d = c.position.y
                        - T.heightAt(c.position.x, c.position.z);
                    if (Math.abs(d) > Math.abs(worst)) { worst = d; worstAt = f;}
                }
                return { worstGroundErr: +worst.toFixed(3), worstAtFrame:
                    worstAt, respawnFrame: respawnF, frames: f,
                    realm: SF.shrine.realm,
                    end: window.__ws.world('tight') };
            }""")

            # ---- E realm switch mid-jump
            res["airborneSwitch"] = pg.evaluate(r"""async () => {
                const SF = SNOWFLOW, c = SF.character, T = SF.terrain;
                await SF.enterRealm('cold');
                await window.__ws.rafs(20);
                c.position.set(90, T.heightAt(90, 90) + 18, 90);
                c.airborne = true; c.vertVel = 8;
                await window.__ws.rafs(2);
                const before = { y: +c.position.y.toFixed(2),
                                 air: c.airborne, vv: +c.vertVel.toFixed(2) };
                await SF.enterRealm('ash');
                await window.__ws.rafs(25);
                return { before, after: {
                    y: +c.position.y.toFixed(2), air: c.airborne,
                    vv: +c.vertVel.toFixed(2),
                    ground: +T.heightAt(c.position.x, c.position.z).toFixed(2),
                    d: +(c.position.y
                        - T.heightAt(c.position.x, c.position.z)).toFixed(2) } };
            }""")

            # ---- F churn + death
            rows = []
            seq = ["sand", "cold", "ash", "sand", "cold", "ash",
                   "sand", "cold", "ash", "sand", "cold", "ash"]
            for i, t in enumerate(seq):
                rows.append(pg.evaluate(r"""async (t) => {
                    const SF = SNOWFLOW;
                    await SF.enterRealm(t);
                    await window.__ws.rafs(20);
                    SF.character.health = 0;
                    await window.__ws.gwait(2.2);
                    await window.__ws.rafs(6);
                    return window.__ws.world(t);
                }""", t))
                rows[-1]["tag"] = "%02d:%s" % (i + 1, t)
            res["churnDeath"] = rows

            print("CONSOLE ERRORS:", json.dumps(errs[:12]))
            br.close()
    finally:
        srv.terminate()

    out = Path(__file__).with_name("qa_worldstress_8892.out.json")
    out.write_text(json.dumps(res, indent=1), encoding="utf-8")
    print("wrote", out)

    print("\n== A) SHRINE FORMATIONS  (spread = max-min terrain height under "
          "the 12 prisms; prof3m = ring height relative to the monolith)")
    for token, rows in res["formations"].items():
        print("\n--", token)
        for r in rows:
            flag = " <== GRADE" if r["grade"] >= 0.35 else ""
            print("   %-11s grade=%6.3f spread=%5.2f m  mono[-%.2f,+%.2f]  "
                  "prof3m=%s%s" % (r["id"], r["grade"], r["spread"],
                                   r["monoRel"]["below"], r["monoRel"]["above"],
                                   r["prof3m"], flag))

    print("\n== B) LANDMARK GEOMETRY  (floors: 150 lm-lm, 120 lm-shrine)")
    for token, g in res["geometry"].items():
        print("   %-5s n=%2d  minLmLm=%6.1f  minLmShrine=%6.1f  "
              "minLmSpawn=%6.1f  ungrounded=%s"
              % (token, g["n"], g["minLmLm"], g["minLmShrine"],
                 g["minLmSpawn"], g["ungrounded"]))

    print("\n== C) RAPID SWITCH:", json.dumps(res["rapid"]))
    print("\n== D) SWITCH DURING DEATH FADE:",
          json.dumps(res["dieThenSwitch"]))
    print("\n   TIGHT (per-frame worst):",
          json.dumps(res["dieThenSwitchTight"]))
    print("\n== E) SWITCH MID-JUMP:", json.dumps(res["airborneSwitch"]))
    print("\n== F) CHURN + DEATH")
    print("tag       S/L        bakes charD shPrismErr lmLive lmInst deaths "
          "geo tex prog")
    for r in res["churnDeath"]:
        print("%-9s %-10s %5d %6.2f %10.2f %6d %6d %6d %4d %4d %4d" % (
            r["tag"], r["realmS"][:4] + "/" + r["realmL"][:4], r["bakes"],
            r["charD"], r["shrinePrismMaxErr"], r["lmLive"], r["lmInst"],
            r["deaths"], r["geo"], r["tex"], r["prog"]))


if __name__ == "__main__":
    main()
