# -*- coding: utf-8 -*-
"""
qa_gatelock_8903.py -- INDEPENDENT verification of the "chain terminates in a
locked realm / realm change destroys a standing gate" claim.

Three questions, each measured off live state (never off source text):

  Q1  What token / tint does the ASH realm boss's gate carry?
      (claim: "cold", i.e. the ring wraps and realms.js's `next: null` loses)

  Q2  After all six bosses are dead, can ANY gate ever open again?
      Reads `_eligibleKind()` in each realm + walks the player onto the gate
      site and waits GAME-seconds for one to appear.

  Q3  Does a standing gate survive a page RELOAD?
      This is the player-facing form of "any realm change destroys a standing
      gate" -- no dev key needed. Kill cold's realm boss, gate opens, reload
      (localStorage keeps bossesKilled), then look for the gate.

GAME-TIME waits only for game state (registry.time via rAF). Wall-clock is
used ONLY where the code itself is genuinely async I/O (enterRealm awaits a
body fetch) and for the reload navigation.
"""
import json
import subprocess
import sys
import time as _t
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8903
URL = "http://localhost:%d/games/driftwake/index.html?autoplay&test" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

SETUP = r"""(() => {
    const SF = SNOWFLOW, R = SF.combat.registry;
    window.__gwait = (sec) => new Promise((res) => {
        const t0 = R.time;
        const t = () => (R.time - t0 >= sec) ? res() : requestAnimationFrame(t);
        t();
    });
    window.__frames = (n) => new Promise((res) => {
        let k = n;
        const t = () => (--k <= 0) ? res() : requestAnimationFrame(t);
        t();
    });
    window.__snap = () => {
        const B = SF.combat.bosses;
        return {
            realm: B.realm,
            state: B.state, kind: B.kind, bossId: B.bossId,
            eligible: B._eligibleKind(),
            killed: Object.assign({}, B._killed),
            saved: Object.assign({}, SF.progression.bossesKilled),
            realmsUnlocked: SF.progression.realmsUnlocked.slice(),
            level: SF.progression.level, testMode: !!SF.progression.testMode,
            portal: SF.portal.stats,
            gameTime: SF.combat.registry.time,
        };
    };
    return window.__snap();
})()"""

# Force the realm's boss of `kind`, then kill it, then report.
KILL_JS = r"""(async (kind) => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry;
    const ok = B.spawnBoss(kind);
    if (!ok) return { err: "spawn refused", refusal: B.lastRefusal };
    await window.__frames(3);
    const id = B.bossId;
    if (id <= 0) return { err: "no live boss after spawn" };
    R.damage(id, 1e9, {});
    await window.__gwait(1.5);
    return { ok: true, killedId: id, snap: window.__snap() };
})"""

ENTER_JS = r"""(async (token) => {
    const SF = SNOWFLOW;
    await SF.enterRealm(token);
    await window.__gwait(1.0);
    return window.__snap();
})"""

# Stand on the gate site and let GAME time pass; report whether one appeared.
WAIT_FOR_GATE = r"""(async (sec) => {
    const SF = SNOWFLOW, c = SF.character, B = SF.combat.bosses;
    // sit still at the arena the last boss used, which is where a gate rises
    c.position.x = B.ax; c.position.z = B.az;
    c.position.y = SF.terrain.heightAt(B.ax, B.az);
    if (c.velocity) c.velocity.set(0, 0, 0);
    await window.__gwait(sec);
    return window.__snap();
})"""


def main():
    from playwright.sync_api import sync_playwright
    srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT)],
                           cwd=str(ROOT), stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL)
    _t.sleep(2.5)
    out = {}
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            pg = br.new_page(viewport={"width": 1280, "height": 720})
            errs = []
            pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
            pg.on("console", lambda m: errs.append("console.error: " + m.text)
                  if m.type == "error" else None)

            def boot():
                pg.wait_for_function(
                    "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                    timeout=180000)
                pg.wait_for_timeout(2500)
                return pg.evaluate(SETUP)

            pg.goto(URL, wait_until="domcontentloaded")
            # Start from a clean save so the run is reproducible.
            pg.evaluate("() => localStorage.clear()")
            pg.reload(wait_until="domcontentloaded")
            print("== BOOT", json.dumps(boot(), default=str))

            # ---------------- Q1: what does each realm's gate lead to? ------
            for realm in ("cold", "sand", "ash"):
                if realm != "cold":
                    s = pg.evaluate(ENTER_JS, realm)
                    print("\n-- entered", realm, json.dumps(s, default=str))
                k = pg.evaluate(KILL_JS, "realm")
                print("\n== %s REALM BOSS KILLED" % realm.upper(),
                      json.dumps(k, default=str))
                out["gate_" + realm] = k
                # kill the mini too so Q2 has a fully cleared world
                km = pg.evaluate(KILL_JS, "mini")
                print("== %s MINI KILLED" % realm.upper(),
                      json.dumps(km, default=str))
                out["mini_" + realm] = km

            # ---------------- Q2: can anything ever open again? -------------
            print("\n########## Q2  all six dead -- any gate left?")
            for realm in ("cold", "sand", "ash"):
                s = pg.evaluate(ENTER_JS, realm)
                w = pg.evaluate(WAIT_FOR_GATE, 25.0)
                print("-- %s after 25 game-s: eligible=%r portal=%s killed=%s"
                      % (realm, w["eligible"], json.dumps(w["portal"]),
                         json.dumps(w["killed"])))
                out["q2_" + realm] = w

            # ---------------- Q3: does a standing gate survive reload? ------
            print("\n########## Q3  standing gate vs page reload")
            pg.evaluate("() => localStorage.clear()")
            pg.reload(wait_until="domcontentloaded")
            print("-- fresh boot", json.dumps(boot(), default=str))
            k = pg.evaluate(KILL_JS, "realm")
            print("-- cold realm boss killed, gate:",
                  json.dumps(k.get("snap", {}).get("portal"), default=str))
            out["q3_before"] = k
            pg.evaluate("() => SNOWFLOW.progression.save()")
            pg.reload(wait_until="domcontentloaded")
            after = boot()
            print("-- AFTER RELOAD", json.dumps(after, default=str))
            w = pg.evaluate(WAIT_FOR_GATE, 25.0)
            print("-- AFTER RELOAD +25 game-s", json.dumps(w, default=str))
            out["q3_after"] = after
            out["q3_after_wait"] = w

            print("\n== PAGE ERRORS", json.dumps(errs[:30]))
            out["errors"] = errs[:30]
            br.close()
    finally:
        srv.terminate()
    Path(__file__).with_suffix(".json").write_text(
        json.dumps(out, indent=1, default=str), encoding="utf-8")


if __name__ == "__main__":
    main()
