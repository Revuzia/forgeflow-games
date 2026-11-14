# -*- coding: utf-8 -*-
"""
qa_meaning.py -- the meaning layer's ACCEPTANCE (_spec/QUEST_DESIGN.md §10),
played end to end on the REAL integrated build (lane INT, port 8930).

main.js constructs and drives every meaning-layer system itself; this probe
adds NO game wiring. It plays from a FRESH save (a brand-new browser context:
empty localStorage) through the real UI:

  title menu -> PLAY (real click) -> intro card -> spawn -> tracker cold.1 ->
  walk to the spawn shrine (the Echo speaks) -> surf 150 m -> the forced imp
  pack (real bolts, then the real damage path for the rest) -> first ding ->
  beacon + compass on the nearest dormant shrine -> the mini boss is NOT armed
  while "Kindle the Ring" is open -> 3 ring shrines -> armed -> kill -> boon
  pick (real mouse click on a card) -> +8% measured on a real Spikes hit ->
  E at a lore cache and a relic cache (real E key) -> E at a shrine, equip the
  relic by clicks -> bolt range measured -> a Wake Trial surfed for a medal ->
  a bounty revealed, killed, paid, stays dead -> the rest of the ring, the
  realm boss, its boon pick, the portal -> Sand's spawn shrine -> fast travel
  back to Cold by the shrine menu (cross realm) and within Cold -> J journal
  (4 tabs) and M map -> draw-call delta in a busy scene -> Esc pause (a save
  point) -> reload -> CONTINUE (real click) -> every quest / relic / glass /
  boon / trial / bounty / cache fact restored.

Every QUEST §10 bullet is a PASS/FAIL line with its measured value; every
scripted shortcut is named in _harness/qa_meaning_page.js's header and in the
step output that used it. Screenshots: _shots/meaning_*.png.

Rules (orchestrator): qa_server.py on the port, ONE browser, boot wait up to
15 min, two attempts then NOT RUN (environment) with the measured frame rate,
game-time waits only (wall clocks are backstops), browser closed after.
TEST mode is NOT on at boot: it is switched on LIVE (SNOWFLOW.test(true)) only
after the first ding, to lift the bosses' LEVEL floor (mini 6) — never the
quest gate, which is what the "not before" check measures.

    python _harness/qa_meaning.py
"""
import json
import socket
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = Path(__file__).resolve().parent
GAME = HERE.parent
ROOT = HERE.parents[2]
PORT = 8930
URL = "http://localhost:%d/games/driftwake/index.html?menu=1" % PORT
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion"]
SHOTS = GAME / "_shots"
PAGE_JS = (HERE / "qa_meaning_page.js").read_text(encoding="utf-8")
OUT_JSON = HERE / "qa_meaning_out.json"

_T0 = time.time()
CHECKS = []
REPORT = {}


def stamp(what):
    print("[wall %6.0f s] %s" % (time.time() - _T0, what), flush=True)


def show(title, obj):
    REPORT[title] = obj
    print("\n==== " + title + "   [wall %.0f s]" % (time.time() - _T0))
    print(json.dumps(obj, indent=1, ensure_ascii=False)[:6000], flush=True)


def check(name, ok, detail=""):
    CHECKS.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + ("  " + json.dumps(detail, ensure_ascii=False)[:2000] if detail != "" else ""),
          flush=True)


def port_open(p):
    s = socket.socket()
    s.settimeout(1.0)
    try:
        s.connect(("127.0.0.1", p))
        return True
    except Exception:
        return False
    finally:
        s.close()


def wait_menu(pg, budget_s=900, want="menu"):
    t0 = time.time()
    while True:
        try:
            pg.wait_for_function(
                "(w) => globalThis.SNOWFLOW && SNOWFLOW.quests && globalThis.FFG && FFG.shell"
                " && FFG.shell.phase === w && window.__M", arg=want, timeout=30000)
            stamp("[boot] shell '%s' after %.0f s" % (want, time.time() - t0))
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


def main():
    from playwright.sync_api import sync_playwright
    SHOTS.mkdir(exist_ok=True)
    srv = None
    if not port_open(PORT):
        srv = subprocess.Popen([sys.executable, str(HERE / "qa_server.py"), str(PORT)],
                               cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(1.5)
    errors = []
    br = pg = None

    def ev(js, arg=None):
        return pg.evaluate(js, arg) if arg is not None else pg.evaluate(js)

    def shot(name):
        p = SHOTS / ("meaning_" + name + ".png")
        try:
            pg.screenshot(path=str(p), timeout=900000)
            stamp("shot " + p.name)
        except Exception as e:
            stamp("shot FAILED %s: %s" % (p.name, str(e).splitlines()[0][:160]))

    def key(k, settle=2):
        pg.keyboard.press(k)
        ev("(n) => __M.frames(n)", settle)

    try:
        with sync_playwright() as pw:
            boot_err = []
            for attempt in (1, 2):
                br = pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
                # A brand-new context = an empty localStorage = a FRESH save.
                bctx = br.new_context(viewport={"width": 1280, "height": 720})
                pg = bctx.new_page()
                pg.set_default_timeout(1800000)
                pg.on("pageerror", lambda e: (errors.append("pageerror: %s" % e),
                                              print("[page] pageerror " + str(e)[:400], flush=True)))
                pg.on("console", lambda m: (errors.append("console.error: %s" % m.text),
                                            print("[page] console.error " + m.text[:400], flush=True))
                      if m.type == "error" else None)
                pg.add_init_script(PAGE_JS)
                stamp("boot attempt %d" % attempt)
                try:
                    pg.goto(URL, wait_until="commit", timeout=300000)
                    wait_menu(pg)
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

            show("FRAME RATE at the menu", ev("() => __M.fps(10000)"))
            setup = ev("() => __M.setup()")
            show("SETUP (main.js-built systems; bus log on)", setup)
            check("W0 main.js built the meaning layer (quests, 4 world, 7 rewards, 9 UI systems; boss quest gate installed)",
                  setup["systems"]["quests"] and len(setup["systems"]["world"]) == 4
                  and len(setup["systems"]["rewards"]) == 7 and len(setup["systems"]["ui"]) == 9
                  and setup["gateInstalled"], setup["systems"])
            shot("00_menu")

            # ------------------------------------------------------- PLAY
            btn = pg.get_by_role("button", name="PLAY")
            buttons = ev("() => Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).slice(0, 12)")
            if btn.count() == 0:
                check("A1a the title menu offers PLAY on a fresh save", False, buttons)
                return 1
            ev("() => __M.introClockOn()")
            stamp("click PLAY")
            btn.first.click(timeout=600000)
            op = ev("() => __M.waitOpen('#dw-intro', true, 900)")
            i0 = ev("() => __M.intro()")
            i1 = ev("() => { __M.introClock = 700; return __M.frames(2).then(() => __M.intro()); }")
            i3 = ev("() => { __M.introClock = 5300; return __M.frames(2).then(() => __M.intro()); }")
            shot("01_intro")
            key("Space", 3)
            ic = ev("() => __M.intro()")
            show("INTRO", {"open": op, "at0": i0, "at0.7s": i1, "at5.3s": i3, "afterKey": ic})
            check("A1a PLAY on a fresh save -> the intro card (time frozen, 3 premise lines fade in), any key -> play",
                  op["ok"] and i0["open"] and i0["freeze"] is True and i1["shown"] == 1 and i3["shown"] == 3
                  and len(i3["lines"]) == 3 and not ic["open"] and ic["freeze"] is False and ic["panel"] is None,
                  {"lines": i3["lines"], "shownAt": [i0["shown"], i1["shown"], i3["shown"]], "after": ic})
            ap = ev("() => __M.afterPlay()")
            show("AFTER PLAY (pinned HUD lock, invulnerable rider — scripted, reported)", ap)
            tr = ev("() => __M.frames(3).then(() => __M.tracker())")
            show("TRACKER at spawn", tr)
            shot("02_spawn_tracker")
            check("A1b spawn: the tracker shows cold.1 'The Last Wakecaster' with the spawn shrine waypoint",
                  tr["tracked"] == "cold.1" and tr["title"] == "The Last Wakecaster" and tr["show"]
                  and tr["wp"] is not None, {k: tr[k] for k in ("title", "text", "label", "dist", "kicker")})

            # ------------------------------------------------------- cold.1
            w = ev("() => __M.walkToSpawn()")
            show("cold.1 — walk to the spawn shrine", w)
            ec = ev("() => __M.echo()")
            show("ECHO", ec)
            shot("03_echo")
            check("A1c touching the spawn shrine completes cold.1 and the Echo speaks (dialogue box, speaker 'The Echo')",
                  w["main"]["cold"] >= 1 and any(c.startswith("cold.1") for c in w["completed"])
                  and "echo.cold.1" in w["dialogues"] and ec["who"] == "The Echo",
                  {"method": w["method"], "completed": w["completed"], "dialogues": w["dialogues"], "who": ec["who"],
                   "text": (ec["text"] or "")[:120]})

            # ------------------------------------------------------- cold.2
            s = ev("() => __M.surf150()")
            show("cold.2 — surf 150 m (pinned RMB + W)", s)
            check("A2a surfing 150 m completes cold.2", s["main"]["cold"] >= 2 and "cold.2" in s["completed"],
                  {"surfedM": s["surfedM"], "gameS": s["until"]["gameS"], "completed": s["completed"]})

            # ------------------------------------------------------- cold.3
            k = ev("() => __M.killPack()")
            show("cold.3 — the forced imp pack", k)
            shot("04_first_kills")
            check("A2b killing 5 completes cold.3 (forced pack spawned ahead)",
                  k["main"]["cold"] >= 3 and "cold.3" in k["completed"] and k["packSpawned"]["ok"],
                  {"boltKills": k["boltKills"], "scriptedKills": k["scriptedKills"], "packAt": k["packAt"]})
            fd = k["firstDingGameS"]
            REPORT["firstDingGameS"] = fd
            check("A2c FIRST DING < 60 s of game time from PLAY", fd is not None and fd < 60,
                  {"firstDingGameS": fd, "levelups": k["levelups"], "level": k["level"]})

            # ------------------------------------------------ waypoint/compass
            wc = ev("() => __M.waypointCheck()")
            show("cold.4 — waypoint, beacon, compass", wc)
            shot("05_compass")
            check("A3 the waypoint beacon and the compass point at the nearest dormant shrine",
                  wc["step"] == "cold.4" and wc["waypointIsNearestDormant"] and wc["beaconOnIt"]
                  and wc["compassAway"]["shown"] and abs(wc["compassAway"]["px"]) > 0
                  and wc["compassRight"]["shown"] and wc["compassRight"]["px"] > 0 and not wc["compassToward"]["shown"],
                  {"nearest": wc["nearestDormant"], "beacon": wc["beacon"], "away": wc["compassAway"],
                   "right": wc["compassRight"], "toward": wc["compassToward"], "label": wc["trackerLabel"]})
            ev("() => __M.faceWaypoint()")
            shot("06_beacon")

            # ------------------------------------------------ gating
            g0 = ev("() => __M.gateSample(6, 0.5)")
            t = ev("() => __M.testOn()")
            g1 = ev("() => __M.gateSample(12, 0.5)")
            show("GATE while cold.4 open (normal, then TEST mode = level floor lifted)", {"normal": g0, "test": t, "testMode": g1})

            # ------------------------------------------------ caches (real E)
            cl = ev("() => __M.toCache('lore', 0)")
            key("KeyE", 3)
            cla = ev("(s) => __M.afterCache(s)", cl["site"])
            show("CACHE lore (E)", {"at": cl, "after": cla})
            shot("07_cache_lore")
            cr = ev("() => __M.toCache('relic', 1)")
            key("KeyE", 3)
            cra = ev("(s) => __M.afterCache(s)", cr["site"])
            show("CACHE relic #2 (E)", {"at": cr, "after": cra})
            shot("08_cache_relic")
            lore_ok = cla["opened"]["ok"] and cla["glass"][1] > cla["glass"][0] and any("lore" in e for e in cla["events"])
            relic_ok = cra["opened"]["ok"] and len(cra["relics"][1]) > len(cra["relics"][0])
            check("A6a opening caches with E: a lore cache adds a shard + Wake Glass; a relic cache adds a relic",
                  lore_ok and relic_ok and cla["interact"] == "cache" and cra["interact"] == "cache",
                  {"lore": {"glass": cla["glass"], "hud": cla["hudGlass"]}, "relic": cra["relics"][1]})

            # ------------------------------------------------ 3 ring shrines
            rs = ev("() => __M.ringShrines(3)")
            show("cold.4 — 3 ring shrines (followed the waypoint; teleports onto the stand points)", rs)
            arm = ev("() => __M.armWait('mini', 15)")
            show("MINI BOSS arming after cold.4", arm)
            check("A4 activating 3 shrines completes cold.4 and ARMS the mini boss — not before",
                  "cold.4" in rs["completed"] and arm["until"]["ok"] and g1["armed"] == 0 and g1["samples"] >= 10
                  and g1["floorMet"] == g1["samples"] and g1["questGateOpen"] == 0,
                  {"beforeTestNormal": {"armed": g0["armed"], "samples": g0["samples"]},
                   "beforeTestMode": {"armed": g1["armed"], "samples": g1["samples"], "floorMet": g1["floorMet"],
                                      "questGateOpen": g1["questGateOpen"]},
                   "armLatencyGameS": arm["latencyGameS"], "arena": arm["arena"], "followedWaypoint":
                       [v["followedWaypoint"] for v in rs["visits"]]})

            # ------------------------------------------------ boss -> boon
            b0 = ev("() => __M.spikeHit()")
            show("SPIKES baseline (before the boon)", b0)
            bf = ev("() => __M.bossFight('mini')")
            show("MINI BOSS fight (approach 30 m; scripted kill via registry.damage)", bf)
            bp = ev("() => __M.waitBoonPick()")
            show("BOON PICK", bp)
            shot("09_boon_pick")
            card0 = (bp["cards"] or [""])[0]
            pg.click('#dw-boonpick .dwr-card[data-pick="0"]', timeout=600000)
            cl2 = ev("() => __M.waitOpen('#dw-boonpick', false, 600)")
            bs = ev("() => __M.boonState()")
            b1 = ev("() => __M.spikeHit()")
            show("BOON chosen by mouse + SPIKES after", {"closed": cl2, "state": bs, "after": b1, "card0": card0})
            ratio = (b1["perMult"] / b0["perMult"]) if b0.get("perMult") and b1.get("perMult") else None
            REPORT["boonRatio"] = ratio
            check("A5 killing the mini boss opens the boon pick (paused); a mouse pick applies a REAL effect: Rime Edge +8% on a measured Spikes hit",
                  bf["killed"]["ok"] and bp["boonOpen"] and bp["freeze"] is True and cl2["ok"]
                  and "boon.rimeEdge" in bs["active"] and ratio is not None and abs(ratio - 1.08) < 0.01,
                  {"boss": bf["name"], "cards": bp["cards"], "dealt": [b0.get("dealt"), b1.get("dealt")],
                   "damageMult": [b0.get("damageMult"), b1.get("damageMult")], "ratioPerMult": ratio,
                   "floaters": b1.get("floatersNow")})

            # ------------------------------------------------ relic at a shrine
            # relics.js puts a FOUND relic straight into an empty slot (run 1
            # measured leash 48 = 40 x 1.2 right after the cache). So the
            # shrine flow is: take it OFF by clicks (measure), then put it
            # back ON by clicks (measure) — the equip's own measured effect.
            la = ev("() => __M.boltLeash()")
            sa = ev("() => __M.boonState()")
            ts = ev("() => __M.toShrine('cold_spawn')")
            key("KeyE", 2)
            so = ev("() => __M.waitOpen('#dw-shrine', true, 600)")
            m0 = ev("() => __M.modal()")
            shot("10_shrine_menu")
            pg.click('#dw-shrine .dwr-navb[data-tab="3"]', timeout=600000)
            ev("() => __M.frames(2)")
            slot = sa["relicsEquipped"].index("relic.frostglassLens") if "relic.frostglassLens" in sa["relicsEquipped"] else -1
            if slot >= 0:
                pg.click('#dw-shrine [data-act="slot:%d"]' % slot, timeout=600000)
                ev("() => __M.frames(2)")
                pg.click('#dw-shrine [data-act="unequip:%d"]' % slot, timeout=600000)
                ev("() => __M.frames(2)")
            key("Escape", 2)
            ev("() => __M.waitOpen('#dw-shrine', false, 600)")
            l0 = ev("() => __M.boltLeash()")
            s0 = ev("() => __M.boonState()")
            ev("() => __M.toShrine('cold_spawn')")
            key("KeyE", 2)
            ev("() => __M.waitOpen('#dw-shrine', true, 600)")
            pg.click('#dw-shrine .dwr-navb[data-tab="3"]', timeout=600000)
            ev("() => __M.frames(2)")
            pg.click('#dw-shrine [data-act="slot:0"]', timeout=600000)
            ev("() => __M.frames(2)")
            pg.click('#dw-shrine [data-act="relic:relic.frostglassLens"]', timeout=600000)
            ev("() => __M.frames(2)")
            m1 = ev("() => __M.modal()")
            shot("11_shrine_relics")
            key("Escape", 2)
            sc = ev("() => __M.waitOpen('#dw-shrine', false, 600)")
            l1 = ev("() => __M.boltLeash()")
            bs2 = ev("() => __M.boonState()")
            show("RELIC at a shrine (found = auto-worn; E, Relics tab: take off, then wear by clicks)",
                 {"afterFind": {"leash": la, "equipped": sa["relicsEquipped"]}, "toShrine": ts, "opened": so,
                  "menu": m0, "afterTakeOff": {"leash": l0, "equipped": s0["relicsEquipped"]},
                  "relicsPane": m1, "closed": sc, "afterWear": {"leash": l1, "equipped": bs2["relicsEquipped"]}})
            lr = (l1["leash"] / l0["leash"]) if l0.get("leash") and l1.get("leash") else None
            check("A6b E at an activated shrine opens the shrine menu (paused); taking Frostglass Lens off and wearing it again by clicks changes the MEASURED bolt range (x1.20)",
                  so["ok"] and m0["freeze"] is True and sc["ok"] and "relic.frostglassLens" not in s0["relicsEquipped"]
                  and "relic.frostglassLens" in bs2["relicsEquipped"] and lr is not None and abs(lr - 1.2) < 0.01,
                  {"leashFound": la.get("leash"), "leashOff": l0.get("leash"), "leashOn": l1.get("leash"), "ratio": lr,
                   "equipped": bs2["relicsEquipped"]})

            # ------------------------------------------------ fast travel (same realm)
            ts2 = ev("() => __M.toShrine('cold_spawn')")
            key("KeyE", 2)
            ev("() => __M.waitOpen('#dw-shrine', true, 600)")
            pg.click('#dw-shrine .dwr-navb[data-tab="1"]', timeout=600000)
            ev("() => __M.frames(2)")
            tgt = ev("() => { const b = document.querySelector('#dw-shrine [data-act^=\"travel:cold:\"]');"
                     " return b ? b.getAttribute('data-act') : null; }")
            shot("12_travel_pane")
            ft = None
            if tgt:
                pg.click('#dw-shrine [data-act="%s"]' % tgt, timeout=600000)
                ev("() => __M.waitOpen('#dw-shrine', false, 900)")
                ft = ev("() => __M.frames(3).then(() => __M.where())")
            show("FAST TRAVEL within Cold", {"from": ts2, "target": tgt, "where": ft})
            same_ok = bool(ft) and ft["nearestStand"] == tgt.split(":")[2] and ft["dStand"] < 1.5 and not ft["menu"]

            # ------------------------------------------------ wake trial
            trl = ev("() => __M.runTrial(0)")
            show("WAKE TRIAL 0 (pinned surf, steered at the next gate)", trl)
            shot("13_trial")
            medal = (trl.get("record") or {}).get("medal", 0)
            check("A7a a Wake Trial is completed with a medal (best time recorded)",
                  trl["done"]["ok"] and medal >= 1 and (trl.get("record") or {}).get("best", 0) > 0,
                  {"id": trl.get("id"), "record": trl.get("record"), "par": trl.get("par"),
                   "gateEvents": trl.get("gateEvents"), "gates": trl.get("gates")})

            # ------------------------------------------------ bounty
            bo = ev("() => __M.bounty(0)")
            show("BOUNTY 0 (reveal at 70 m; scripted kill via registry.damage)", bo)
            sd = ev("() => __M.bountyStaysDead(0)")
            show("BOUNTY revisit", sd)
            check("A8a a bounty spawns within 80 m, is killable, pays (40 Wake Glass + XP) and stays dead on a revisit",
                  bo["revealed"]["ok"] and bo["killed"]["ok"] and bo["isKilled"] is True
                  and bo["glass"][1] - bo["glass"][0] >= 40 and sd["liveId"] < 0,
                  {"info": bo["info"], "glass": bo["glass"], "xp": bo["xp"], "revisitLiveId": sd["liveId"]})

            # ------------------------------------------------ perf (busy scene)
            dd = ev("() => __M.drawDelta(6)")
            show("DRAW CALLS: lane W meshes as-is vs hidden (busy scene)", dd)
            shot("14_busy_scene")
            check("A14 perf: the meaning layer adds <= 6 draw calls in a busy scene",
                  dd["delta"] <= 6, dd)

            # ------------------------------------------------ rest of Cold
            rs2 = ev("() => __M.ringShrines(3)")
            show("cold.6 — the other 3 ring shrines", rs2)
            arm2 = ev("() => __M.armWait('realm', 20)")
            show("REALM BOSS arming", arm2)
            bf2 = ev("() => __M.bossFight('realm')")
            show("REALM BOSS fight (scripted kill)", bf2)
            bp2 = ev("() => __M.waitBoonPick()")
            shot("15_boon_pick_realm")
            pg.click('#dw-boonpick .dwr-card[data-pick="0"]', timeout=600000)
            ev("() => __M.waitOpen('#dw-boonpick', false, 600)")
            pw_ = ev("() => __M.portalWalk()")
            show("PORTAL (cold.8)", {"pick": bp2, "portal": pw_})
            sand = ev("() => __M.touchSpawnHere()")
            show("SAND spawn shrine (sand.1)", sand)
            shot("16_sand")
            check("A4b the whole Cold chain runs: cold.6 (all 6) -> realm boss -> second boon pick -> portal (cold.8) -> Sand unlocked -> sand.1",
                  "cold.6" in rs2["completed"] and arm2["until"]["ok"] and bf2["killed"]["ok"] and bp2["boonOpen"]
                  and pw_["realm"]["ok"] and pw_["main"]["cold"] >= 8 and "sand" in pw_["unlocked"]
                  and sand["main"]["sand"] >= 1,
                  {"realmBoss": bf2["name"], "cards": bp2["cards"], "main": sand["main"], "unlocked": pw_["unlocked"]})

            # ------------------------------------------------ fast travel (cross realm)
            ts3 = ev("() => __M.toShrine('cold_spawn')")
            key("KeyE", 2)
            ev("() => __M.waitOpen('#dw-shrine', true, 600)")
            pg.click('#dw-shrine .dwr-navb[data-tab="1"]', timeout=600000)
            ev("() => __M.frames(2)")
            shot("17_travel_cross")
            pg.click('#dw-shrine [data-act="travel:cold:shrine_e"]', timeout=600000)
            ev("() => __M.waitOpen('#dw-shrine', false, 1800)")
            fx = ev("() => __M.until(() => SNOWFLOW.meaning.getRealm() === 'cold', 30, 1200).then(() => __M.frames(3)).then(() => __M.where())")
            show("FAST TRAVEL Sand -> Cold (shrine menu)", {"from": ts3, "where": fx})
            check("A9 fast travel moves the player to another activated shrine — within Cold and across realms (Sand -> Cold, unlocked by the portal)",
                  same_ok and fx["realm"] == "cold" and fx["nearestStand"] == "shrine_e" and fx["dStand"] < 1.5,
                  {"sameRealm": ft, "crossRealm": fx})

            # ------------------------------------------------ TEMP dev keys 6/7
            ev("() => __M.mark()")
            key("Digit7", 2)
            d7 = ev("() => __M.devRealmWait('ash')")
            shot("17b_devkey_ash")
            ev("() => __M.mark()")
            key("Digit7", 2)
            d0 = ev("() => __M.devRealmWait('cold')")
            show("TEMP dev realm keys (7 -> Ash, 7 again -> Cold)", {"toAsh": d7, "back": d0})
            check("A15 the TEMP dev realm keys still work: 7 -> Ash, 7 again -> Cold; 'realm:entered' once each; quest, tracker and lane W follow",
                  d7["realm"]["ok"] and d7["worldReady"]["ok"] and d7["entered"] == ["ash"] and d7["questRealm"] == "ash"
                  and d0["realm"]["ok"] and d0["worldReady"]["ok"] and d0["entered"] == ["cold"] and d0["questRealm"] == "cold"
                  and d0["trackerRealm"] == "cold",
                  {"ash": {k: d7[k] for k in ("now", "questRealm", "trackerRealm", "kicker", "entered")},
                   "cold": {k: d0[k] for k in ("now", "questRealm", "trackerRealm", "kicker", "entered")}})

            # ------------------------------------------------ journal + map
            mute0 = ev("() => __M.mute()")
            key("KeyJ", 3)
            jr = {}
            for i, tab in enumerate(["main", "side", "lore", "stats"]):
                key("Digit%d" % (i + 1), 3)
                jr[tab] = ev("() => __M.journal()")
                shot("18_journal_" + tab)
            key("Escape", 2)
            jclosed = ev("() => __M.journal()")
            key("KeyM", 4)
            mp = ev("() => __M.map()")
            mute1 = ev("() => __M.mute()")
            shot("19_map")
            key("Escape", 2)
            mclosed = ev("() => __M.map()")
            key("KeyM", 4)
            mp2 = ev("() => __M.map()")
            key("KeyM", 3)
            mclosed2 = ev("() => __M.map()")
            mute2 = ev("() => __M.mute()")
            show("M vs the page bar's M = mute (game_controls.js)", {"ff_muted": [mute0, mute1, mute2],
                 "mapOpenedByM": [mp["open"], mp2["open"]], "closedByEsc": not mclosed["open"], "closedByM": not mclosed2["open"]})
            check("A10b M opens the world map in play WITHOUT flipping the page mute (ff_muted unchanged across M open/close)",
                  mp["open"] and mp2["open"] and not mclosed2["open"] and mute0 == mute1 == mute2,
                  {"ff_muted": [mute0, mute1, mute2]})
            show("JOURNAL (J, tabs 1-4) + MAP (M)", {"journal": jr, "journalAfterEsc": jclosed["open"], "map": mp,
                                                      "mapAfterEsc": mclosed["open"]})
            side = jr["side"]["body"] or ""
            main_rows = " ".join(jr["main"]["rows"]) + " " + (jr["main"]["body"] or "")
            lore_body = jr["lore"]["body"] or ""
            c = mp.get("counts") or {}
            check("A10 journal and map reflect it: Main steps done, caches found, trial medal, bounty, lore shard; map lit shrines + opened caches",
                  jr["main"]["open"] and "The Last Wakecaster" in main_rows and "2" in side and "/15" in side.replace(" ", "")
                  and len(lore_body) > 20 and mp["open"] and c.get("lit", 0) == 7 and c.get("cachesOpened", 0) >= 2
                  and not jclosed["open"] and not mclosed["open"],
                  {"side": side[:400], "loreHead": lore_body[:200], "mapCounts": c})

            # ------------------------------------------------ SAVE -> reload -> CONTINUE
            ev("() => __M.waitWorld()")
            env1 = ev("() => __M.envNow()")
            show("ENVIRONMENT: pointer-lock / focus log and auto-resumes (first page load)", env1)
            REPORT["autoResumes"] = len(env1["autoResumes"])
            snap0 = ev("() => __M.snapshot()")
            ev("() => { __M.allowPause = true; return true; }")
            key("Escape", 2)
            paused = ev("() => ({ phase: FFG.shell.phase, freeze: SNOWFLOW.S.freezeTime })")
            snap1 = ev("() => __M.snapshot()")
            show("SAVE (Esc pause = save point)", {"paused": paused, "snapshot": snap1})
            shot("20_paused")
            stamp("reload")
            pg.reload(wait_until="commit", timeout=300000)
            wait_menu(pg)
            ev("() => __M.setup()")
            shot("21_menu_continue")
            cbtn = pg.get_by_role("button", name="CONTINUE")
            if cbtn.count() == 0:
                check("A11 SAVE -> reload -> CONTINUE", False,
                      ev("() => Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim())"))
            else:
                cbtn.first.click(timeout=600000)
                ev("() => __M.until(() => FFG.shell.phase === 'playing' && !SNOWFLOW.S.freezeTime, 5, 900)")
                ev("() => { SNOWFLOW.progression.graceUntil = 1e12; return __M.gameWait(2, 900); }")
                ww = ev("() => __M.waitWorld()")
                snap2 = ev("() => __M.snapshot()")
                REPORT["worldReadyAfterContinue"] = ww
                intro2 = ev("() => __M.intro()")
                show("AFTER CONTINUE", {"snapshot": snap2, "intro": intro2})
                shot("22_continued")
                keys = ["main", "relicsOwned", "relicsEquipped", "glass", "boons", "picks", "shop", "rerolls",
                        "cachesOpenedCold", "trials", "savedTrials", "bountiesKilled", "lore", "lit", "bossesKilled",
                        "unlocked", "hintsSeen"]
                diff = {kk: [snap1.get(kk), snap2.get(kk)] for kk in keys if snap1.get(kk) != snap2.get(kk)}
                check("A11 SAVE -> reload -> CONTINUE restores every quest / relic / glass / boon / trial / cache / shrine fact (no intro replay)",
                      not diff and not intro2["open"] and snap1["schemaVer"] == 4 and ww["ok"],
                      {"diff": diff, "schemaVer": snap1["schemaVer"], "glass": snap2["glass"], "main": snap2["main"],
                       "relics": snap2["relicsEquipped"], "boons": snap2["boons"], "trials": snap2["trials"]})

            env = ev("() => __M.envNow()")
            show("ENVIRONMENT: pointer-lock / focus log and auto-resumes (second page load)", env)
            REPORT["autoResumesAfterReload"] = len(env["autoResumes"])
            perr = [e for e in errors]
            perr += ["in-page: " + e for e in ev("() => __M.errorsNow()")]
            check("A13 zero page errors / console errors over the whole run", len(perr) == 0, perr[:10])
            br.close()
            br = None
    finally:
        if br is not None:
            try:
                br.close()
            except Exception:
                pass
        if srv is not None:
            srv.terminate()

    fails = [c for c in CHECKS if not c[1]]
    print("\n=== %d / %d meaning-layer acceptance checks PASS ===   page errors: %d   first ding: %s s game time"
          % (len(CHECKS) - len(fails), len(CHECKS), len(errors), REPORT.get("firstDingGameS")))
    if fails:
        print("FAILED: " + ", ".join(f[0].split(" ")[0] for f in fails))
    try:
        OUT_JSON.write_text(json.dumps({"checks": [[c[0], c[1]] for c in CHECKS], "report": REPORT,
                                        "errors": errors}, indent=1, ensure_ascii=False, default=str),
                            encoding="utf-8")
    except Exception as e:
        print("could not write %s: %s" % (OUT_JSON, e))
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
