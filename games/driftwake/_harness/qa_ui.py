# -*- coding: utf-8 -*-
"""
qa_ui.py -- lane U (the player-facing UI) browser proof, port 8925.

Boots the REAL game with the FFG shell (?menu=1), wires lanes Q/W/R/U onto the
live page through _harness/qa_ui_page.js (main.js has no meaning-layer hooks
yet -- see that file's header for exactly what is wired and where), clicks
PLAY for real, then drives every panel through REAL keyboard / mouse events
(Playwright), asserting on the DOM and the systems, with screenshots into
_shots/ui_*.png:

  intro card -> tracker cold.1 -> touch the spawn shrine (teleport onto its
  stand point) -> banner + the Echo -> E opens the shrine menu, Esc leaves ->
  J journal (tabs 1-4) -> Esc closes it BEFORE the pause menu, the next Esc
  pauses -> M map, click a dormant shrine = marked -> compass tick when the
  target is behind -> E at a relic cache = toasts + the HUD Wake Glass pill ->
  layout rects at 1280x720 and 1920x1080 (no overlap with the vitals,
  minimap, spellbar, XP bar, boss frame) -> the ending (Echo, flyover, card,
  credits) and the settings restored.

Orchestrator rules: qa_server.py on the port, ONE browser, boot wait up to
15 min, two attempts then NOT RUN (environment) with the measured frame rate,
game-time waits only (wall clocks are backstops), browser closed after.

    python _harness/qa_ui.py
"""
import json
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
GAME = HERE.parent
PORT = 8925
URL = "http://localhost:%d/games/driftwake/index.html?menu=1" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]
SHOTS = GAME / "_shots"
PAGE_JS = (HERE / "qa_ui_page.js").read_text(encoding="utf-8")

_T0 = time.time()


def stamp(what):
    print("[wall %6.0f s] %s" % (time.time() - _T0, what), flush=True)


def show(title, obj):
    print("\n==== " + title + "   [wall %.0f s]" % (time.time() - _T0))
    print(json.dumps(obj, indent=1, ensure_ascii=False), flush=True)


def wait_booted(pg, budget_s=900):
    t0 = time.time()
    while True:
        try:
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && SNOWFLOW.combat && globalThis.FFG && FFG.shell"
                " && FFG.shell.phase === 'menu' && window.__ui", timeout=30000)
            stamp("[boot] menu up after %.0f s" % (time.time() - t0))
            return
        except Exception:
            pass
        try:
            ph = pg.evaluate("() => [(document.getElementById('boot-phase')||{}).textContent||'',"
                             " !!(document.getElementById('nogpu')||{classList:{contains:()=>0}})"
                             ".classList.contains('show')]")
        except Exception as e:
            ph = ["(unresponsive: %s)" % str(e).splitlines()[0][:80], False]
        stamp("[boot] %.0f s phase=%r nogpu=%s" % (time.time() - t0, ph[0], ph[1]))
        if ph[1]:
            raise RuntimeError("boot failed: #nogpu shown (%s)" % ph[0])
        if time.time() - t0 > budget_s:
            raise RuntimeError("boot did not finish in %d s (last phase %r)" % (budget_s, ph[0]))


J_FPS = r"""(async () => {
    const r = SNOWFLOW.combat.registry, g0 = r.time, w0 = performance.now();
    let n = 0;
    await new Promise((res) => {
        const tick = () => { n++; if (performance.now() - w0 >= 10000) res(); else requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
    });
    const wall = (performance.now() - w0) / 1000;
    return { frames: n, wallS: +wall.toFixed(1), fps: +(n / wall).toFixed(2), gameSPerWallS: +((r.time - g0) / wall).toFixed(3) };
})()"""


def main():
    from playwright.sync_api import sync_playwright
    SHOTS.mkdir(exist_ok=True)
    srv = subprocess.Popen([sys.executable, str(HERE / "qa_server.py"), str(PORT)],
                           cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.5)
    errors = []
    checks = []

    def check(name, ok, detail=""):
        checks.append((name, bool(ok)))
        print(("PASS " if ok else "FAIL ") + name + ("  " + json.dumps(detail, ensure_ascii=False)[:1500] if detail != "" else ""),
              flush=True)

    def ev(js, arg=None):
        return pg.evaluate(js, arg) if arg is not None else pg.evaluate(js)

    def shot(name):
        p = SHOTS / ("ui_" + name + ".png")
        try:
            pg.screenshot(path=str(p), timeout=600000)
            stamp("shot " + p.name)
        except Exception as e:
            stamp("shot FAILED %s: %s" % (p.name, str(e).splitlines()[0][:160]))

    def key(k, settle_frames=2):
        pg.keyboard.press(k)
        ev("(n) => __ui.frames(n)", settle_frames)

    br = pg = None
    try:
        with sync_playwright() as pw:
            import tempfile
            prof = str(Path(tempfile.gettempdir()) / "driftwake_qa_8925_profile")
            boot_err = []
            for attempt in (1, 2):
                br = pw.chromium.launch_persistent_context(
                    prof, channel="chrome", headless=False, args=FLAGS,
                    viewport={"width": 1280, "height": 720})
                pg = br.pages[0] if br.pages else br.new_page()
                pg.set_default_timeout(900000)
                pg.on("pageerror", lambda e: (errors.append("pageerror: %s" % e), print("[page] pageerror " + str(e)[:300], flush=True)))
                pg.on("console", lambda m: (errors.append("console.error: %s" % m.text), print("[page] console.error " + m.text[:300], flush=True))
                      if m.type == "error" else None)
                # "PLAY on a FRESH save": the persistent profile keeps the last
                # run's save (run 2 found CONTINUE / NEW RUN instead of PLAY), so
                # it is removed before any page script reads it.
                pg.add_init_script("try { localStorage.removeItem('driftwake_save'); } catch (e) {}")
                pg.add_init_script(PAGE_JS)
                stamp("boot attempt %d" % attempt)
                try:
                    pg.goto(URL, wait_until="commit", timeout=240000)
                    wait_booted(pg)
                    break
                except Exception as e:
                    boot_err.append("attempt %d: %s" % (attempt, str(e).splitlines()[0][:200]))
                    try:
                        fps = pg.evaluate("() => new Promise(res => { let n = 0; const w0 = performance.now();"
                                          " const t = () => { n++; if (performance.now() - w0 > 20000)"
                                          " res(n / ((performance.now() - w0) / 1000)); else requestAnimationFrame(t); };"
                                          " requestAnimationFrame(t); })")
                        boot_err.append("  measured rAF fps at give-up: %.2f" % fps)
                    except Exception as e2:
                        boot_err.append("  fps unmeasurable: %s" % str(e2).splitlines()[0][:120])
                    br.close()
                    br = pg = None
            if pg is None:
                print("\n==== NOT RUN (environment): the page did not boot in two attempts")
                for line in boot_err:
                    print("  " + line)
                return 2
            show("FRAME RATE at the menu", ev(J_FPS))

            r = ev("() => __ui.setup()")
            show("SETUP (lanes Q/W/R/U wired on the live page)", r)

            # ---------------------------------------------------------- PLAY
            btn = pg.get_by_role("button", name="PLAY")
            show("PLAY button found", {"count": btn.count(),
                                       "buttons": ev("() => Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).slice(0, 12)")})
            # The intro runs on the WALL clock (the game clock is frozen under
            # it). At ~0.5 fps the probe's round trips outlast its 9.4 s
            # timeline (run 1 read it after it had closed itself), so the card
            # gets a PROBE-CONTROLLED clock: it advances only when told to.
            if btn.count() == 0:
                check("U0 the title menu offers PLAY on a fresh save", False)
                return 1
            ev("() => { __ui.introClock = 0; __ui.m.intro.now = () => __ui.introClock; return true; }")
            stamp("click PLAY")
            btn.first.click(timeout=600000)
            ok = ev("() => __ui.until(() => __ui.m.intro.isOpen, 900)")
            st0 = ev("() => __ui.state()")
            st1 = ev("() => { __ui.introClock = 700; return __ui.frames(2).then(() => __ui.state()); }")
            st = ev("() => { __ui.introClock = 5300; return __ui.frames(2).then(() => __ui.state()); }")
            show("INTRO", {"opened": st0, "at0.7s": st1, "at5.3s": st})
            shot("01_intro")
            check("U1 PLAY on a fresh save opens the intro card (time frozen, keyboard taken); its 3 lines fade in on its clock",
                  ok and st0["intro"]["cls"] and st0["freeze"] is True and st0["panel"] == "intro"
                  and st0["intro"]["shown"] == 0 and st1["intro"]["shown"] == 1 and st["intro"]["shown"] == 3
                  and st["intro"]["open"], {"opened": st0, "at0.7s": st1["intro"], "at5.3s": st["intro"]})
            key("Space", 3)
            st = ev("() => __ui.state()")
            sk = ev("() => __ui.m.intro.stats")
            check("U2 any key (Space) closes the intro; time runs; the keyboard is free; no jump fired",
                  not st["intro"]["open"] and st["freeze"] is False and st["panel"] is None and sk["skipped"] == 1, [st, sk])

            hud = ev("() => __ui.ensureHud()")
            show("HUD visibility (pointer lock real? pinned?)", hud)
            tr = ev("() => __ui.frames(4).then(() => __ui.tracker())")
            show("TRACKER at cold.1", tr)
            shot("02_tracker")
            check("U3 tracker top-right: 'The Last Wakecaster' / 'Touch the shrine.' / kicker / the spawn shrine with its distance",
                  tr["show"] and tr["title"] == "The Last Wakecaster" and tr["text"] == "Touch the shrine."
                  and (tr["kicker"] or "").startswith("The Rime Shelf") and tr["label"] and (tr["dist"] or "").endswith(" m"), tr)

            r = ev("() => __ui.touchSpawn()")
            show("TOUCH the spawn shrine", r)
            shot("03_banner_dialogue")
            check("U4 touching the shrine: Quest Complete banner with the XP reward, the Echo speaks in the dialogue box, 'Shrine Awakened' toast",
                  r["completed"] and r["banner"]["show"] and r["banner"]["title"] == "The Last Wakecaster"
                  and (r["banner"]["rew"] or "").endswith(" XP") and r["dialogue"]["show"]
                  and r["dialogue"]["who"] == "The Echo" and any("Shrine Awakened" in t for t in r["toasts"]), r)

            # E at the shrine -> lane R's menu; Esc leaves it.
            key("e", 3)
            st = ev("() => __ui.state()")
            shot("04_shrine_menu")
            key("Escape", 3)
            st2 = ev("() => __ui.state()")
            check("U5 E at the awakened shrine opens the shrine menu (modal, frozen); Esc leaves it; the shell stays in play",
                  st["menu"] and st["modal"] and st["freeze"] and not st2["menu"] and st2["shell"] == "playing", [st, st2])

            # ------------------------------------------------------ journal
            ev("() => __ui.ensureHud()")
            key("j", 3)
            j = ev("() => __ui.journal()")
            st = ev("() => __ui.state()")
            show("JOURNAL main", j)
            shot("05_journal_main")
            check("U6 J opens the journal (cursor panel, shell NOT paused): Main lists cold.1 done and cold.2 current",
                  j["open"] and j["cls"] and st["panel"] == "journal" and st["shell"] == "playing"
                  and any(r.startswith("[x] ") and "The Last Wakecaster" in r for r in j["rows"])
                  and any(r.startswith("[>] ") and "Carve Your Wake" in r for r in j["rows"]), {"journal": j, "state": st})
            key("2", 2)
            j2 = ev("() => __ui.journal()")
            shot("06_journal_side")
            key("3", 2)
            j3 = ev("() => __ui.journal()")
            shot("07_journal_lore")
            key("4", 2)
            j4 = ev("() => __ui.journal()")
            shot("08_journal_stats")
            sp = ev("() => SNOWFLOW.input.spellPressed")
            check("U7 journal tabs by real key 2/3/4: Side (caches 0/15, trials, bounties), Lore (???), Stats (level/deaths/time/completion); no spell fired",
                  j2["tab"] == "side" and "Relic caches found" in j2["body"] and "Bounties" in j2["body"]
                  and j3["tab"] == "lore" and "???" in j3["body"] and j4["tab"] == "stats"
                  and "Completion" in j4["body"] and "Deaths" in j4["body"] and sp == 0,
                  {"side": j2["body"][:300], "lore": j3["body"][:200], "stats": j4["body"][:300], "spellPressed": sp})
            key("Escape", 3)
            st = ev("() => __ui.state()")
            key("Escape", 3)
            st2 = ev("() => __ui.state()")
            shot("09_pause_after_second_esc")
            check("U8 Esc closes the journal FIRST (shell still playing); the next Esc opens the pause menu",
                  not st["journal"] and st["panel"] is None and st["shell"] == "playing" and st2["shell"] == "paused",
                  [st, st2])
            ev("() => { FFG.shell.resume(); return __ui.frames(3); }")
            ev("() => __ui.ensureHud()")

            # ---------------------------------------------------------- map
            key("m", 4)
            mp = ev("() => __ui.map()")
            show("MAP", mp)
            shot("10_map")
            pt = ev("() => __ui.mapShrinePoint()")
            pg.mouse.click(pt["x"], pt["y"])
            ev("() => __ui.frames(3)")
            pn = ev("() => __ui.pin()")
            mp2 = ev("() => __ui.map()")
            shot("11_map_marked")
            check("U9 M opens the map (7 shrines, 1 awakened, trials, relief baked); clicking a dormant shrine MARKS it (tracker, beacon, minimap pip)",
                  mp["open"] and mp["counts"]["shrines"] == 7 and mp["counts"]["lit"] == 1 and mp["bakes"] == 1
                  and pn["pin"]["on"] and pn["pin"]["id"] == pt["id"] and pn["beacon"]["x"] == pt["wx"]
                  and (pn["label"] or "").startswith("Marked") and mp2["mark"] and pn["minimapWp"],
                  {"map": mp, "point": pt, "pin": pn})
            key("Escape", 3)
            ev("() => __ui.ensureHud()")

            # ------------------------------------------------------ compass
            cp = ev("() => __ui.faceAwayFromTarget()")
            shot("12_compass")
            check("U10 the compass tick shows on the top edge, pushed to a side with the chevron turned, when the waypoint is behind",
                  cp["compassShow"] and abs(cp["px"]) >= 80 and cp["chevron"] in ("left", "right") and (cp["dist"] or "").endswith(" m"), cp)

            # ------------------------------------------------ cache + toasts
            c = ev("() => __ui.toCache('relic')")
            show("AT A RELIC CACHE", c)
            key("e", 4)
            t = ev("() => __ui.toasts()")
            shot("13_toasts_relic")
            c2 = ev("() => __ui.toCache('lore')")
            key("e", 4)
            t2 = ev("() => __ui.toasts()")
            shot("14_toasts_lore_glass")
            show("TOASTS", {"relic": t, "lore": t2})
            check("U11 E at caches (router): 'Relic Found' card, then 'Lore Shard Found' + '+N Wake Glass'; the HUD pill shows the wallet",
                  t["last"] == "cache" and any("Relic Found" in s for s in t["live"])
                  and any("Lore Shard Found" in s for s in t2["live"]) and any("Wake Glass" in s for s in t2["live"])
                  and t2["hud"] == str(t2["wallet"]) and t2["wallet"] > 0 and t2["hudGlassShown"], {"relic": t, "lore": t2, "at": [c, c2]})

            # ------------------------------------------------------- layout
            lay = ev("() => __ui.layout()")
            show("LAYOUT 1280x720", lay)
            shot("15_layout_1280x720")
            ev("() => __ui.layoutClear()")
            pg.set_viewport_size({"width": 1920, "height": 1080})
            ev("() => __ui.frames(4)")
            lay2 = ev("() => __ui.layout()")
            show("LAYOUT 1920x1080", lay2)
            shot("16_layout_1920x1080")
            ev("() => __ui.layoutClear()")
            check("U12 layout: no lane-U box overlaps the vitals, minimap, spellbar, XP bar, boss frame, trial timer or each other (1280x720 and 1920x1080)",
                  lay["overlaps"] == [] and lay2["overlaps"] == [], {"1280": lay["overlaps"], "1920": lay2["overlaps"]})
            pg.set_viewport_size({"width": 1280, "height": 720})
            ev("() => __ui.frames(3)")

            # ------------------------------------------------------- ending
            # The ending runs on the WALL clock (the world is frozen under it).
            # Run 1 measured 0.16 fps: the whole 70 s sequence elapsed inside
            # the probe's round trips and every read saw it finished. So the
            # sequence gets a PROBE-CONTROLLED clock (beats advance by key or
            # when the probe moves the clock), the camera pose included.
            ev("() => { __ui.endClock = 0; __ui.m.ending.now = () => __ui.endClock; return true; }")
            e0 = ev("() => __ui.endingBegin()")
            shot("17_ending_echo")
            key("Space", 2)
            eL2 = ev("() => __ui.ending()")
            key("Space", 2)
            eL3 = ev("() => __ui.ending()")
            key("Space", 3)
            e1 = ev("() => __ui.frames(2).then(() => __ui.ending())")
            e2 = ev("() => { __ui.endClock += 15000; return __ui.frames(3).then(() => __ui.ending()); }")
            shot("18_ending_flyover")
            e2b = ev("() => { __ui.endClock += 15100; __ui.m.ending.tick(); return __ui.frames(2).then(() => __ui.ending()); }")
            shot("19_ending_card")
            key("Space", 3)
            e4 = ev("() => new Promise(r => setTimeout(r, 4000)).then(() => __ui.frames(2)).then(() => __ui.ending())")
            shot("20_ending_credits")
            key("Space", 4)
            ed = ev("() => __ui.endingDone()")
            show("ENDING", {"begin": e0, "line2": eL2, "line3": eL3, "flyover0": e1, "flyover15s": e2, "card": e2b,
                            "credits": e4, "done": ed})
            import math
            r1 = math.hypot(e1["cam"][0] - e1["anchor"]["x"], e1["cam"][2] - e1["anchor"]["z"])
            r2 = math.hypot(e2["cam"][0] - e2["anchor"]["x"], e2["cam"][2] - e2["anchor"]["z"])
            check("U13 the ending: the Echo's 3 lines letterboxed (time frozen, keys advance them, the whole HUD hidden); the flyover starts at the spawn shrine and RISES and WIDENS; the light warms; card, credits; then control and every setting restored + 'ending:done'",
                  e0["phase"] == "echo" and e0["letter"] and e0["freeze"] and e0["panel"] == "ending"
                  and eL2["line"] != e0["line"] and eL3["line"] != eL2["line"] and e1["phase"] == "flyover"
                  and r1 < 20 and e2["cam"][1] > e1["cam"][1] + 20 and r2 > r1 + 40
                  and e2["light"]["exposure"] > e0["light"]["exposure"] and e2["light"]["el"] < e0["light"]["el"]
                  and e2b["card"] and e4["credits"] and ed["restored"] and len(ed["done"]) == 1
                  and e0["cinematic"] and e2["hudHidden"] and not ed["cinematic"] and not ed["hudHidden"]
                  and ed["panel"] is None and ed["phase"] == "idle",
                  {"lines": [e0["line"], eL2["line"], eL3["line"]], "cam0": e1["cam"], "cam15s": e2["cam"],
                   "radius": [round(r1, 1), round(r2, 1)], "anchor": e2["anchor"], "light15s": e2["light"],
                   "hudHiddenDuring": e2["hudHidden"], "hudHiddenAfter": ed["hudHidden"],
                   "phases": ed.get("phases", e4["phases"]), "done": ed})
            shot("21_post_game")

            st = ev("() => __ui.state()")
            check("U14 zero page errors; no lane-wiring errors inside the frame hook",
                  len(errors) == 0 and len(st["errors"]) == 0, {"pageErrors": errors[:5], "hookErrors": st["errors"]})
            show("FRAME RATE at the end", ev(J_FPS))
    finally:
        try:
            if br:
                br.close()
        except Exception:
            pass
        srv.terminate()

    n_ok = sum(1 for c in checks if c[1])
    print("\n=== %d / %d lane-U browser checks PASS ===   page errors: %d" % (n_ok, len(checks), len(errors)))
    for c in checks:
        if not c[1]:
            print("FAILED: " + c[0])
    return 0 if n_ok == len(checks) and checks else 1


if __name__ == "__main__":
    sys.exit(main())
