# -*- coding: utf-8 -*-
"""
qa_gatelock2_8903.py -- follow-up to qa_gatelock_8903.py.

Run 1 refused the COLD realm-boss spawn ("body not streamed: packIceGolem"),
so two of its questions never actually got asked. This run retries the spawn
on GAME time until the body has streamed, then asks them properly:

  Q3  A STANDING gate vs a page reload (no dev key, no realm change):
        clean save -> kill cold's realm boss -> gate open, token "sand"
        -> progression.save() -> reload -> is the gate back? can it come back?

  Q2b All six dead: is every realm terminal (eligible null, no gate) and is
      the player therefore confined to whichever realm they stand in?
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
            realm: B.realm, state: B.state, kind: B.kind, bossId: B.bossId,
            eligible: B._eligibleKind(),
            killed: Object.assign({}, B._killed),
            saved: Object.assign({}, SF.progression.bossesKilled),
            realmsUnlocked: SF.progression.realmsUnlocked.slice(),
            level: SF.progression.level,
            portal: SF.portal.stats,
            gameTime: SF.combat.registry.time,
        };
    };
    return window.__snap();
})()"""

# Retry spawnBoss on GAME time until the body has streamed in.
KILL_JS = r"""(async (kind) => {
    const SF = SNOWFLOW, B = SF.combat.bosses, R = SF.combat.registry;
    let ok = false, tries = 0, refusal = null;
    while (!ok && tries < 40) {
        ok = B.spawnBoss(kind);
        if (ok) break;
        refusal = B.lastRefusal;
        tries++;
        await window.__gwait(1.0);
    }
    if (!ok) return { err: "spawn refused after " + tries, refusal };
    await window.__frames(3);
    const id = B.bossId;
    if (id <= 0) return { err: "no live boss after spawn" };
    R.damage(id, 1e9, {});
    await window.__gwait(1.5);
    return { ok: true, tries, killedId: id, snap: window.__snap() };
})"""

ENTER_JS = r"""(async (token) => {
    const SF = SNOWFLOW;
    await SF.enterRealm(token);
    await window.__gwait(1.0);
    return window.__snap();
})"""

# Sit on the last arena and let GAME time run; did a gate rise?
WATCH = r"""(async (sec) => {
    const SF = SNOWFLOW, c = SF.character, B = SF.combat.bosses;
    c.position.x = B.ax; c.position.z = B.az;
    c.position.y = SF.terrain.heightAt(B.ax, B.az);
    if (c.velocity) c.velocity.set(0, 0, 0);
    let sawGate = false;
    const R = SF.combat.registry, t0 = R.time;
    await new Promise((res) => {
        const t = () => {
            if (SF.portal.isOpen) sawGate = true;
            (R.time - t0 >= sec) ? res() : requestAnimationFrame(t);
        };
        t();
    });
    const s = window.__snap();
    s.sawGateDuringWatch = sawGate;
    s.watchedGameS = R.time - t0;
    return s;
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
            pg.evaluate("() => localStorage.clear()")
            pg.reload(wait_until="domcontentloaded")
            print("== Q3 clean boot", json.dumps(boot(), default=str))

            # ---- Q3: kill cold's realm boss, get a STANDING gate -----------
            k = pg.evaluate(KILL_JS, "realm")
            print("\n== Q3 cold realm boss killed", json.dumps(k, default=str))
            out["q3_kill"] = k
            gate = k.get("snap", {}).get("portal")
            print("== Q3 STANDING GATE:", json.dumps(gate, default=str))

            pg.evaluate("() => SNOWFLOW.progression.save()")
            pg.reload(wait_until="domcontentloaded")
            after = boot()
            print("\n== Q3 AFTER RELOAD", json.dumps(after, default=str))
            w = pg.evaluate(WATCH, 40.0)
            print("== Q3 AFTER RELOAD + 40 game-s", json.dumps(w, default=str))
            out["q3_after"] = after
            out["q3_watch"] = w

            # ---- Q2b: finish the world off, then look for any exit ---------
            print("\n########## Q2b clear all six, then look for an exit")
            for realm in ("cold", "sand", "ash"):
                if realm != "cold":
                    print("-- enter", realm,
                          json.dumps(pg.evaluate(ENTER_JS, realm), default=str))
                for kind in ("mini", "realm"):
                    r = pg.evaluate(KILL_JS, kind)
                    print("   %s %s -> %s" % (realm, kind,
                          json.dumps(r.get("snap", {}).get("killed", r),
                                     default=str)))
            for realm in ("cold", "sand", "ash"):
                pg.evaluate(ENTER_JS, realm)
                w = pg.evaluate(WATCH, 40.0)
                print("-- %s : eligible=%r sawGate=%r portal.open=%r "
                      "realmsUnlocked=%s killed=%s"
                      % (realm, w["eligible"], w["sawGateDuringWatch"],
                         w["portal"]["open"], json.dumps(w["realmsUnlocked"]),
                         json.dumps(w["killed"])))
                out["q2b_" + realm] = w

            print("\n== PAGE ERRORS", json.dumps(errs[:30]))
            out["errors"] = errs[:30]
            br.close()
    finally:
        srv.terminate()
    Path(__file__).with_suffix(".json").write_text(
        json.dumps(out, indent=1, default=str), encoding="utf-8")


if __name__ == "__main__":
    main()
