# -*- coding: utf-8 -*-
"""
qa_savecycle_8892.py -- the full SAVE / CONTINUE lifecycle, through the REAL
title-screen buttons (no autoplay, no callback reach-in).

  PLAY (newGame) -> level up -> switch realm -> walk out -> die -> respawn
  -> save -> RELOAD the page -> CONTINUE -> assert level / deaths / realm /
  position / unlocks / boss flags.

Also snapshots the raw localStorage blob at each stage so a field that is
written but not read (or read but not written) is visible.
"""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parents[3]
PORT = 8892
# `?menu=1` forces the FFG shell back on under automation: main.js:1461 makes
# AUTOPLAY true whenever `navigator.webdriver` is set, which skips the shell.
BASE = "http://localhost:%d/games/driftwake/index.html?menu=1" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]

HELPERS = r"""
window.__sc = (function () {
    const SF = SNOWFLOW, reg = SF.combat.registry;
    const gwait = (sec) => new Promise((res) => {
        const t0 = reg.time;
        const t = () => (reg.time - t0 >= sec) ? res()
            : requestAnimationFrame(t);
        t();
    });
    const rafs = (n) => new Promise((res) => {
        let k = 0;
        const t = () => { if (++k >= n) res(); else requestAnimationFrame(t); };
        requestAnimationFrame(t);
    });
    const state = (tag) => {
        const P = SF.progression, c = SF.character;
        let raw = null;
        try { raw = JSON.parse(localStorage.getItem("driftwake_save")); }
        catch (e) { raw = { err: String(e) }; }
        return {
            tag,
            live: {
                level: P.level, xp: Math.round(P.xp), deaths: P.deaths,
                driftmarks: P.driftmarks,
                unlocked: Array.from(P.unlocked).sort(),
                realmsUnlocked: P.realmsUnlocked.slice(),
                lastShrineId: P.lastShrineId,
                bossesKilledIsArray: Array.isArray(P.bossesKilled),
                bossesKilledKeys: Object.keys(P.bossesKilled),
                testMode: P.testMode,
                savedPos: P.savedPos,
                realm: SF.shrine.realm,
                pos: { x: +c.position.x.toFixed(1), z: +c.position.z.toFixed(1),
                       y: +c.position.y.toFixed(2) },
                groundErr: +(c.position.y
                    - SF.terrain.heightAt(c.position.x, c.position.z))
                    .toFixed(3),
                facing: +(c.facing || 0).toFixed(3),
                hpFrac: +(c.health / c.healthMax).toFixed(3),
                healthMax: c.healthMax,
            },
            blob: raw,
        };
    };
    return { gwait, rafs, state };
})();
"""


def menu_buttons(pg):
    return pg.evaluate(
        "() => Array.from(document.querySelectorAll('button,a,[role=button]'))"
        ".map(e => ({t:(e.textContent||'').trim().slice(0,40),"
        " c:e.className, vis: !!(e.offsetParent)}))")


def click_label(pg, label):
    ok = pg.evaluate(
        """(want) => {
            const els = Array.from(
                document.querySelectorAll('button,a,[role=button]'));
            // Shell labels carry a glyph prefix ("▶  PLAY"), so match on
            // containment, not prefix.
            const hit = els.find((e) => e.offsetParent &&
                (e.textContent || '').toUpperCase().indexOf(want) >= 0);
            if (!hit) return false;
            hit.click();
            return true;
        }""", label)
    return ok


def main():
    from playwright.sync_api import sync_playwright

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2.5)
    log = []
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
            ctx = br.new_context(viewport={"width": 1280, "height": 720})
            pg = ctx.new_page()
            errs = []
            pg.on("console", lambda m: errs.append(m.text)
                  if m.type == "error" else None)
            pg.on("pageerror", lambda e: errs.append("PAGEERROR " + str(e)))

            # ---------------------------------------------- boot 1: PLAY
            pg.goto(BASE, wait_until="domcontentloaded")
            pg.wait_for_function("() => globalThis.SNOWFLOW", timeout=180000)
            pg.wait_for_timeout(3000)
            pg.evaluate(HELPERS)
            print("MENU BUTTONS:", json.dumps(menu_buttons(pg))[:900])
            print("clicked PLAY:", click_label(pg, "PLAY"))
            pg.wait_for_function(
                "() => !SNOWFLOW.S.freezeTime", timeout=60000)
            pg.wait_for_timeout(1500)
            log.append(pg.evaluate("() => window.__sc.state('after-PLAY')"))

            # ---- earn some progress: XP to L4, a realm swap, a walk, a death
            pg.evaluate("""() => {
                const P = SNOWFLOW.progression;
                for (let i = 0; i < 4; i++) P.addXP(P.xpNeed + 5, 'probe');
            }""")
            pg.wait_for_timeout(400)
            log.append(pg.evaluate("() => window.__sc.state('after-XP')"))

            pg.evaluate("() => SNOWFLOW.enterRealm('sand')")
            pg.wait_for_function("() => SNOWFLOW.shrine.realm === 'sand'",
                                 timeout=60000)
            pg.evaluate("() => window.__sc.rafs(20)")
            pg.wait_for_timeout(800)

            # emulate the boss first-kill flag write (bossEncounters.js:674)
            pg.evaluate("""() => {
                SNOWFLOW.progression.bossesKilled['sandWarden'] = true;
                SNOWFLOW.progression.save();
            }""")

            # walk out to a ring shrine, then die there
            pg.evaluate("""async () => {
                const c = SNOWFLOW.character, T = SNOWFLOW.terrain;
                const p = SNOWFLOW.shrine.positions[1];
                c.position.set(p.x + 4, T.heightAt(p.x + 4, p.z + 4), p.z + 4);
                c.facing = 1.234;
                await window.__sc.rafs(4);
                c.health = 0;
                await window.__sc.gwait(2.4);
            }""")
            pg.wait_for_timeout(600)
            log.append(pg.evaluate("() => window.__sc.state('after-death')"))

            # move somewhere distinctive, then force the save the way the
            # 10 s autosave / pause would
            pg.evaluate("""async () => {
                const c = SNOWFLOW.character, T = SNOWFLOW.terrain;
                c.position.set(-210, T.heightAt(-210, 140), 140);
                c.facing = 2.5;
                await window.__sc.rafs(4);
                SNOWFLOW.progression.save();
            }""")
            pg.wait_for_timeout(400)
            pre = pg.evaluate("() => window.__sc.state('pre-reload')")
            log.append(pre)

            # ---------------------------------------------- boot 2: CONTINUE
            pg.goto(BASE, wait_until="domcontentloaded")
            pg.wait_for_function("() => globalThis.SNOWFLOW", timeout=180000)
            pg.wait_for_timeout(3000)
            pg.evaluate(HELPERS)
            note = pg.evaluate(
                "() => ({can: SNOWFLOW.progression.hasSave(), "
                "note: SNOWFLOW.progression.saveSummary()})")
            print("CONTINUE gate:", json.dumps(note))
            print("MENU BUTTONS 2:", json.dumps(menu_buttons(pg))[:900])
            print("clicked CONTINUE:", click_label(pg, "CONTINUE"))
            pg.wait_for_function("() => !SNOWFLOW.S.freezeTime", timeout=60000)
            pg.wait_for_timeout(4000)          # the realm swap is async
            pg.evaluate("() => window.__sc.rafs(20)")
            pg.wait_for_timeout(800)
            log.append(pg.evaluate("() => window.__sc.state('after-CONTINUE')"))

            print("CONSOLE ERRORS:", json.dumps(errs[:12]))
            br.close()
    finally:
        srv.terminate()

    out = Path(__file__).with_name("qa_savecycle_8892.out.json")
    out.write_text(json.dumps(log, indent=1), encoding="utf-8")
    print("wrote", out)

    print("\n== LIVE STATE BY STAGE")
    for s in log:
        L = s["live"]
        print("\n--", s["tag"])
        print("   level=%d xp=%d deaths=%d dm=%d unlocked=%s realm=%s"
              % (L["level"], L["xp"], L["deaths"], L["driftmarks"],
                 L["unlocked"], L["realm"]))
        print("   pos=(%.1f, %.1f) y=%.2f groundErr=%.3f facing=%.3f hp=%.2f"
              % (L["pos"]["x"], L["pos"]["z"], L["pos"]["y"],
                 L["groundErr"], L["facing"], L["hpFrac"]))
        print("   lastShrineId=%s bossesKilled: isArray=%s keys=%s"
              % (L["lastShrineId"], L["bossesKilledIsArray"],
                 L["bossesKilledKeys"]))
        print("   savedPos=%s" % json.dumps(L["savedPos"]))
        b = s["blob"] or {}
        print("   BLOB: lvl=%s xp=%s deaths=%s spells=%s bossesKilled=%s "
              "realms=%s pos=%s"
              % (b.get("level"), b.get("xp"), b.get("deaths"),
                 json.dumps(b.get("spellsUnlocked")),
                 json.dumps(b.get("bossesKilled")),
                 json.dumps(b.get("realmsUnlocked")),
                 json.dumps(b.get("pos"))))


if __name__ == "__main__":
    main()
