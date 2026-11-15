# -*- coding: utf-8 -*-
"""
qa_bosspersist_8906.py -- INDEPENDENT verifier for the `bossesKilled` claim.

Three phases, all on the REAL page (`?menu=1&test`), all through the REAL
title-screen buttons:

  A  click PLAY (calls progression.newGame()) -> inspect the container shape,
     write the two flags the real writers write (bossEncounters.js:674 keys by
     `realm+":"+kind`; progression._onKill keys by DISPLAY NAME) -> save ->
     read the raw blob -> reload -> read back live + the encounter director's
     own gate (`combat.bosses._isKilled('mini')` / `_eligibleKind()`).

  B  MECHANISM: re-create the pre-fix line by hand -- `P.bossesKilled = []`,
     which is literally what `newGame()` did before commit aed5433a -- then run
     the IDENTICAL write/save/reload/read cycle. If the container type is the
     cause, B loses the flags where A keeps them.

  C  ADJACENCY: after B's array poisoning, click PLAY again and confirm the
     shipped newGame() heals the container back to a map, and that a normal
     CONTINUE round-trip of the other persisted fields (level/xp/deaths/
     realmsUnlocked/lastShrineId) is unchanged.

No rAF promises inside evaluate (an occluded window throttles rAF to 0 and the
promise never resolves). No game-time waits are needed: nothing here advances
the simulation, it is all save/load plumbing.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8906
BASE = "http://localhost:%d/games/driftwake/index.html?menu=1&test" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

MINI_KEY = "cold:mini"          # bossEncounters.js:672-674
NAME_KEY = "Moraine Colossus"   # progression.js:607-610 (display name)

CLICK = """(want) => {
    const els = Array.from(document.querySelectorAll('button'));
    const hit = els.find((e) => e.offsetParent &&
        (e.textContent || '').toUpperCase().indexOf(want) >= 0);
    if (!hit) return null;
    hit.click();
    return (hit.textContent || '').trim().slice(0, 24);
}"""

READ = """() => {
    const P = SNOWFLOW.progression;
    const B = SNOWFLOW.combat && SNOWFLOW.combat.bosses;
    let raw = null, blob = null;
    try {
        raw = localStorage.getItem('driftwake_save');
        blob = raw ? JSON.parse(raw) : null;
    } catch (e) { blob = { err: String(e) }; }
    let gate = null;
    try {
        gate = { isKilledMini: B ? !!B._isKilled('mini') : null,
                 eligible: B ? B._eligibleKind() : null,
                 dirLevel: B ? B._level() : null };
    } catch (e) { gate = { err: String(e) }; }
    return {
        isArray: Array.isArray(P.bossesKilled),
        ctor: Object.prototype.toString.call(P.bossesKilled),
        liveKeys: Object.keys(P.bossesKilled),
        liveMini: !!P.bossesKilled['%s'],
        liveName: !!P.bossesKilled['%s'],
        blobBossesJSON: blob ? JSON.stringify(blob.bossesKilled) : null,
        blobIsArray: blob ? Array.isArray(blob.bossesKilled) : null,
        level: P.level, xp: P.xp, deaths: P.deaths,
        realms: P.realmsUnlocked, shrine: P.lastShrineId,
        testMode: !!P.testMode,
        gate: gate,
    };
}""" % (MINI_KEY, NAME_KEY)

WRITE_FLAGS = """() => {
    const P = SNOWFLOW.progression;
    // exactly bossEncounters.js:674 and progression.js:610
    P.bossesKilled['%s'] = true;
    P.bossesKilled['%s'] = true;
    P.save();
    return { liveJSON: JSON.stringify(P.bossesKilled),
             liveKeys: Object.keys(P.bossesKilled),
             savedRaw: localStorage.getItem('driftwake_save') };
}""" % (MINI_KEY, NAME_KEY)

POISON = """() => {
    // the PRE-FIX line, verbatim: progression.js:448 before commit aed5433a
    SNOWFLOW.progression.bossesKilled = [];
    SNOWFLOW.progression.save();
    return Array.isArray(SNOWFLOW.progression.bossesKilled);
}"""


def boot(pg, tag):
    pg.goto(BASE, wait_until="domcontentloaded")
    pg.wait_for_function("() => globalThis.SNOWFLOW", timeout=180000)
    pg.wait_for_timeout(3000)
    try:
        pg.evaluate("() => { if (SNOWFLOW.test) SNOWFLOW.test(true); }")
    except Exception as e:
        print("  test(true) failed:", e)
    print("[%s] booted" % tag)


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
            pg.set_default_timeout(60000)
            errs = []
            pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))

            # ---------------- A: the shipped path -------------------------
            boot(pg, "A")
            pg.evaluate("() => localStorage.removeItem('driftwake_save')")
            boot(pg, "A2")           # so the button reads PLAY, not NEW RUN
            print("A clicked:", pg.evaluate(CLICK, "PLAY"))
            pg.wait_for_timeout(2500)
            out["A_afterPlay"] = pg.evaluate(READ)
            out["A_write"] = pg.evaluate(WRITE_FLAGS)
            pg.wait_for_timeout(400)
            out["A_afterSave"] = pg.evaluate(READ)
            boot(pg, "A3")           # RELOAD -- construction re-reads the blob
            out["A_afterReload_preClick"] = pg.evaluate(READ)
            print("A clicked:", pg.evaluate(CLICK, "CONTINUE"))
            pg.wait_for_timeout(2500)
            out["A_afterContinue"] = pg.evaluate(READ)

            # ---------------- B: the pre-fix container --------------------
            print("B poisoned to []:", pg.evaluate(POISON))
            out["B_write"] = pg.evaluate(WRITE_FLAGS)
            pg.wait_for_timeout(400)
            out["B_afterSave"] = pg.evaluate(READ)
            boot(pg, "B2")
            out["B_afterReload_preClick"] = pg.evaluate(READ)
            print("B clicked:", pg.evaluate(CLICK, "CONTINUE"))
            pg.wait_for_timeout(2500)
            out["B_afterContinue"] = pg.evaluate(READ)

            # ---------------- C: adjacency --------------------------------
            pg.evaluate("""() => { const P = SNOWFLOW.progression;
                P.level = 7; P.xp = 123; P.deaths = 3;
                P.realmsUnlocked = ['cold', 'sand'];
                P.lastShrineId = 'sand_gate'; P.save(); }""")
            boot(pg, "C")
            out["C_roundTrip"] = pg.evaluate(READ)
            print("C clicked:", pg.evaluate(CLICK, "CONTINUE"))
            pg.wait_for_timeout(2000)
            out["C_afterContinue"] = pg.evaluate(READ)
            # a fresh NEW RUN over the poisoned/legacy state
            print("C clicked:", pg.evaluate(CLICK, "NEW RUN") or
                  pg.evaluate(CLICK, "PLAY"))
            pg.wait_for_timeout(2500)
            out["C_afterNewRun"] = pg.evaluate(READ)

            out["pageerrors"] = errs[:8]
            br.close()
    finally:
        srv.terminate()

    Path(__file__).with_suffix(".out.json").write_text(
        json.dumps(out, indent=1), encoding="utf-8")
    print(json.dumps(out, indent=1))

    a = out.get("A_afterContinue", {})
    b = out.get("B_afterContinue", {})
    c = out.get("C_afterNewRun", {})
    print("\n--- VERDICT INPUTS ---")
    print("A (shipped)  isArray=%s  mini=%s name=%s  blob=%s  gate=%s"
          % (a.get("isArray"), a.get("liveMini"), a.get("liveName"),
             a.get("blobBossesJSON"), json.dumps(a.get("gate"))))
    print("B (pre-fix)  isArray=%s  mini=%s name=%s  blob=%s  gate=%s"
          % (b.get("isArray"), b.get("liveMini"), b.get("liveName"),
             b.get("blobBossesJSON"), json.dumps(b.get("gate"))))
    print("C newRun     isArray=%s level=%s xp=%s deaths=%s realms=%s shrine=%s"
          % (c.get("isArray"), c.get("level"), c.get("xp"), c.get("deaths"),
             c.get("realms"), c.get("shrine")))


if __name__ == "__main__":
    main()
