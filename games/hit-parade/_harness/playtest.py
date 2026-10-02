#!/usr/bin/env python
"""HIT PARADE playtest - CONTRACT §13 gate G6 (lane AI owns the file; written by the P1 INTEGRATOR because it did not
exist yet - CHANGED(integrator)).

    python _harness/playtest.py --headless            # G6: menus -> VERSUS vs CPU L1 -> a full best-of-3 bout by REAL keys
    python _harness/playtest.py --headless --no-serve # against an already running dev server (port 5320)

Everything the player does goes through REAL key events (Playwright keyboard -> trusted KeyboardEvents -> the game's
Input). The harness only READS state (window.__HP__: state / match / fighters / events / menus / hud / audio) to decide
which key to press next, like a player watching the screen. No dev writes are used except one, and it is SAID in the
report: when SHOWTIME never reached 1 bar by round 2 the harness fills it with __HP__.dev.setMeter so the super key
press can be proven (--no-meter-help turns that off).

Flow (every step asserted; a failed step is reported with what was seen):
  1. boot /?dev=1 -> title (phase 'title', menus screen 'title'); shot pt_title.png
  2. Enter -> main menu; ArrowDown to VERSUS; Enter -> versus setup; CPU level 1 (focus + Enter); GO
  3. character select: the slot list must hold johnny and bruno (and every slot is a fighter in data or 'random'; bosses
     are locked); P1 picks johnny (fighter, colour, controls), the CPU cursor moves to bruno (fighter, colour)
  4. stage select: RUST THEATER; VS splash; the bout starts (phase 'bout', match phase 'fight')
  5. the bout, real keys only: walk (D/A), SIDESTEP (tap Q = STEP_IN / E = STEP_OUT) and CIRCLE-WALK (hold E: the 3D ring,
     CONTRACT §35.2, CHANGED(AI3D) - shots pt_circle_a/b/c from three angles of the orbit), jab (J), special (I), throw (H),
     parry (hold O into the CPU's attack), IMPACT (P), super (I+L = SIMPLE S+H) once SHOWTIME >= 1 bar; then fight to the
     finish (walk in, ASSIST auto-combo U + J taps, throws, block by holding back when the CPU attacks, a sidestep tap
     every few seconds). Distances are PLANAR (x, z) and forward = P1's facing sign, as the sim maps LEFT / RIGHT
     (CHANGED(AI3D)). HUD read-back checked during the bout: HP bars
     follow the sim, NERVE / SHOWTIME present, timer counting, round pips, combo counter, captions. Audio: unlocked,
     a music cue, hit sounds played, a crowd loop running.
  6. MATCH_END -> results card; the results numbers (winner, rounds won, damage) must equal the sim's (__HP__.match()).
  7. REMATCH (Enter on the default button) -> a new bout; ESC -> pause card (phase 'paused', the sim holds); ESC ->
     resume (phase 'bout', the sim steps again); ESC -> FORFEIT -> confirm -> results (by forfeit) -> MAIN MENU; a real
     mouse click on VERSUS opens the versus setup (pointer input reaches the menus).
Shots: _shots/pt_*.png. Report: _harness/_reports/playtest.json. Exit 0 = every step PASS, 1 = a step failed, 2 = the page
never got far enough to judge.
"""
import argparse
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (SHOTS, HarnessError, Session, add_common_args, build_url, diag_problems, events_tail,  # noqa: E402
                    fighters_info, match_info, preflight_chromes, print_diagnostics, save_report, wait_match_phase, wait_warm)

K = {"up": "KeyW", "down": "KeyS", "left": "KeyA", "right": "KeyD", "l": "KeyJ", "m": "KeyK", "h": "KeyL", "s": "KeyI",
     "assist": "KeyU", "throw": "KeyH", "parry": "KeyO", "impact": "KeyP", "pause": "Escape",
     # CHANGED(AI3D): the §35.2 default STEP keys (CONTRACT §35.16 item 2: P1 Q = STEP_IN, E = STEP_OUT)
     "stepin": "KeyQ", "stepout": "KeyE"}

READ_MENUS = "() => { try { return window.__HP__ && __HP__.menus ? __HP__.menus() : null; } catch (e) { return null; } }"
READ_HUD = "() => { try { return window.__HP__ && __HP__.hud ? __HP__.hud() : null; } catch (e) { return null; } }"
READ_AUDIO = "() => { try { return window.__HP__ ? __HP__.audio() : null; } catch (e) { return null; } }"


class Steps:
    def __init__(self):
        self.items = []

    def check(self, name, ok, detail=""):
        self.items.append({"step": name, "ok": bool(ok), "detail": detail})
        d = detail if isinstance(detail, str) else json.dumps(detail, default=str)
        print("  [%s] %-26s %s" % ("PASS" if ok else "FAIL", name, d[:400]), flush=True)
        return ok

    @property
    def failed(self):
        return [s for s in self.items if not s["ok"]]


class Player:
    """real keys + read-backs"""

    def __init__(self, sess, out_dir):
        self.s = sess
        self.out = out_dir
        self.seen = set()
        self.log = []          # every new event (deduped by frame/type/a/b)

    # ---- read-backs
    def menus(self):
        return self.s.safe_js(READ_MENUS) or {}

    def hud(self):
        return self.s.safe_js(READ_HUD) or {}

    def audio(self):
        return self.s.safe_js(READ_AUDIO) or {}

    def f(self):
        return fighters_info(self.s) or None

    def m(self):
        return match_info(self.s) or {}

    def new_events(self):
        out = []
        for e in events_tail(self.s, 256):
            k = (e.get("frame"), e.get("type"), e.get("a"), e.get("b"))
            if k in self.seen:
                continue
            self.seen.add(k)
            out.append(e)
            self.log.append(e)
        return out

    # ---- keys
    def key(self, k, times=1, gap=0.1, hold_ms=60):
        for _ in range(times):
            self.s.press(k, hold_ms)
            time.sleep(gap)

    def shot(self, name):
        return self.s.screenshot(os.path.join(self.out, "pt_%s.png" % name))

    def wait_screen(self, want, timeout=8.0):
        t0 = time.time()
        while time.time() - t0 < timeout:
            m = self.menus()
            if m.get("screen") == want and m.get("visible"):
                return True
            time.sleep(0.08)
        return False

    def focus_to(self, target, key="ArrowDown", limit=14):
        for _ in range(limit):
            if self.menus().get("focus") == target:
                return True
            self.key(key, gap=0.08)
        for _ in range(90):
            if self.menus().get("focus") == target:
                return True
            self.key("Tab", gap=0.04)
        return self.menus().get("focus") == target


def fwd_back(f):
    """(forward key, back key) for P1. CHANGED(AI3D): from P1's facing sign (FighterSnap.facing = the screen side its
    forward points to under the camera basis - exactly how the sim maps LEFT / RIGHT); the x order is meaningless once
    the pair has circled (the old rule walked P1 away from the CPU after a circle-walk)"""
    fc = f[0].get("facing")
    if fc is None:
        fc = 1 if (f[1]["x"] - f[0]["x"]) >= 0 else -1
    if fc >= 0:
        return K["right"], K["left"]
    return K["left"], K["right"]


def planar(a, b):
    """CHANGED(AI3D): ground-plane distance (m) between two snapshots with x / z (z defaults 0)"""
    return math.hypot(a["x"] - b["x"], (a.get("z") or 0.0) - (b.get("z") or 0.0))


def bearing(c, p):
    """CHANGED(AI3D): yaw-convention bearing (deg) of p seen from c: 0 = +Z, 90 = +X"""
    return math.degrees(math.atan2(p["x"] - c["x"], (p.get("z") or 0.0) - (c.get("z") or 0.0)))


def ang_diff(a, b):
    return abs((a - b + 180.0) % 360.0 - 180.0)


def step_kind(fs):
    st = (fs or {}).get("step") or {}
    return st.get("kind") or ("sidestep" if fs.get("stateName") == "sidestep" else "sidewalk" if fs.get("stateName") == "sidewalk" else "none")


def by(evs, names, a=None, b=None, c=None):
    return [e for e in evs if e.get("typeName") in names and (a is None or e.get("a") == a) and (b is None or e.get("b") == b)
            and (c is None or e.get("c") in (c if isinstance(c, (list, tuple, set)) else (c,)))]


def sim_speed(sess, secs=3.0):
    """CHANGED(integrator) 3D (G6 stability): the loop's real tick rate as a fraction of 60 Hz over `secs` of wall time
    (__HP__.state().tick); None when unreadable. A starved page (other processes at 100 % CPU) runs the sim far slower
    than real time and every timed real-key verb fails - measured, G6 run 4: 1166 frames in 663 s = 1.8 frames/s."""
    a = (sess.state() or {}).get("tick")
    t0 = time.time()
    time.sleep(secs)
    b = (sess.state() or {}).get("tick")
    if not isinstance(a, (int, float)) or not isinstance(b, (int, float)):
        return None
    return round((b - a) / ((time.time() - t0) * 60.0), 3)


def run(args) -> int:
    S = Steps()
    report = {"headless": args.headless}
    fatal = None
    others, _ = preflight_chromes("pre-flight")
    report["otherAutomatedChrome"] = others
    sess = Session(args, "playtest")
    try:
        sess.start()
    except Exception as e:
        sess.close()
        print("SETUP FAILED: %s" % (str(e) if isinstance(e, HarnessError) else repr(e)))
        print("RESULT: FAIL")
        return 2
    P = Player(sess, args.out_dir)
    verbs = {}
    bout = {}
    try:
        url = build_url(args.base, dev=1)
        report["url"] = url
        sess.goto(url)
        if not sess.wait_hp(args.wait):
            fatal = "window.__HP__ never appeared"
        # ---------------------------------------------------------------- 1. title
        if not fatal:
            ok, ph = sess.wait_phase("title", args.wait)
            S.check("boot_title", ok and P.wait_screen("title", 10), "phase=%s screen=%s" % (ph, P.menus().get("screen")))
            hp = sess.safe_js("() => { const h = window.__HP__; return h ? { version: h.version, keys: Object.keys(h), dev: Object.keys(h.dev) } : null; }")
            S.check("hp_surface", bool(hp and hp.get("version") and "menus" in hp.get("keys", []) and "startMatch" in hp.get("dev", [])), hp)
            P.shot("title")
            if not ok:
                fatal = "never reached the title (phase %r)" % ph
        # ---------------------------------------------------------------- 2. main -> versus setup
        if not fatal:
            P.key("Enter")
            S.check("main_menu", P.wait_screen("main"), "focus=%s" % P.menus().get("focus"))
            P.shot("main")
            S.check("focus_versus", P.focus_to("hpm-main-versus"), "focus=%s" % P.menus().get("focus"))
            P.key("Enter")
            S.check("versus_setup", P.wait_screen("versus"))
            fl = P.menus().get("flow", {})
            S.check("versus_opponent_cpu", fl.get("opponent") == "cpu", "opponent=%s" % fl.get("opponent"))
            P.focus_to("hpm-versus-cpuLevel-1")
            P.key("Enter")
            fl = P.menus().get("flow", {})
            S.check("cpu_level_1", fl.get("cpuLevel") == 1, "cpuLevel=%s rounds=%s timer=%s" % (fl.get("cpuLevel"), fl.get("rounds"), fl.get("timer")))
            P.shot("versus_setup")
            S.check("focus_go", P.focus_to("hpm-versus-go"))
            P.key("Enter")
            ok = P.wait_screen("charselect")
            S.check("charselect", ok)
            if not ok:
                fatal = "character select never opened"
        # ---------------------------------------------------------------- 3. character select
        if not fatal:
            time.sleep(0.6)
            cs = P.menus().get("cs", {})
            slots = cs.get("slots") or []
            locked = cs.get("locked") or []
            fighters = sess.safe_js("() => { try { return __HP__.dev ? null : null; } catch (e) { return null; } }")
            S.check("cs_offers_johnny_bruno", "johnny" in slots and "bruno" in slots, "slots=%s locked=%s" % (slots, locked))
            bad = [x for x in slots if x != "random" and not x]
            S.check("cs_no_broken_slots", not bad and len(slots) >= 3, "%d slots" % len(slots))
            P.shot("charselect")
            # P1 -> johnny
            for _ in range(16):
                cur = ((P.menus().get("cs", {}).get("p") or [{}])[0]).get("cursor")
                if cur == "johnny":
                    break
                P.key("ArrowRight", gap=0.08)
            cur0 = ((P.menus().get("cs", {}).get("p") or [{}])[0]).get("cursor")
            P.key("Enter", 3, gap=0.15)             # fighter, colour, controls
            cs = P.menus().get("cs", {})
            S.check("p1_johnny", cur0 == "johnny" and cs.get("active") == 1, "p1 cursor=%s active=%s" % (cur0, cs.get("active")))
            for _ in range(16):
                cur = ((P.menus().get("cs", {}).get("p") or [{}, {}])[1]).get("cursor")
                if cur == "bruno":
                    break
                P.key("ArrowRight", gap=0.08)
            cur1 = ((P.menus().get("cs", {}).get("p") or [{}, {}])[1]).get("cursor")
            P.shot("charselect_cpu")
            P.key("Enter", 2, gap=0.15)             # CPU fighter, colour
            S.check("cpu_bruno", cur1 == "bruno", "cpu cursor=%s" % cur1)
            ok = P.wait_screen("stage", 8)
            S.check("stage_select", ok)
            if not ok:
                fatal = "stage select never opened (screen %r)" % P.menus().get("screen")
        # ---------------------------------------------------------------- 4. stage -> VS -> bout
        if not fatal:
            S.check("focus_rust_theater", P.focus_to("hpm-stage-rust_theater", "ArrowRight"), "focus=%s" % P.menus().get("focus"))
            P.shot("stage")
            P.key("Enter")
            vs = P.wait_screen("vs", 6)
            if vs:
                time.sleep(0.5)
                P.shot("vs")
            S.check("vs_splash", vs)
            ok, ph = sess.wait_phase("bout", 90)
            mi = P.m()
            S.check("bout_started", ok and mi.get("stage") == "rust_theater", "phase=%s stage=%s p=%s" % (ph, mi.get("stage"), json.dumps(mi.get("p"))))
            if ok:
                cfgp = mi.get("p") or [{}, {}]
                S.check("bout_cfg", cfgp[0].get("fighter") == "johnny" and cfgp[1].get("fighter") == "bruno" and cfgp[1].get("cpu") == 1 and cfgp[0].get("cpu") == -1,
                        "p1=%s p2=%s" % (cfgp[0], cfgp[1]))
                okf, mph = wait_match_phase(sess, "fight", 30)
                S.check("round1_fight", okf, "match phase %s" % mph)
                if not okf:
                    fatal = "the round never reached 'fight'"
                    report.setdefault("simSpeed", {})["intro"] = sim_speed(sess)   # CHANGED(integrator) 3D: starved or stuck?
            else:
                fatal = "the bout never started (phase %r)" % ph
        # ---------------------------------------------------------------- 5. the bout
        if not fatal:
            notes = []
            wait_warm(sess, notes, "bout start")
            report["notes"] = notes
            report.setdefault("simSpeed", {})["boutStart"] = sim_speed(sess)
            P.shot("fight")
            P.new_events()
            bout = play_bout(P, S, args, verbs)
            report["bout"] = bout
        # ---------------------------------------------------------------- 6. results
        if not fatal:
            ok, ph = sess.wait_phase("results", 20)
            okr = ok and P.wait_screen("results", 8)
            S.check("results_card", okr, "phase=%s screen=%s" % (ph, P.menus().get("screen")))
            if okr:
                time.sleep(0.6)
                P.shot("results")
                mi = P.m()
                dom = sess.safe_js("""() => {
                    const q = (s) => document.querySelector(s);
                    const txt = (s) => { const e = q(s); return e ? e.textContent.trim() : null; };
                    const pips = (i) => document.querySelectorAll('.hpm-res-row.rounds .v.p' + i + ' i.on').length;
                    return { stamp: q('.hpm-res-stamp') ? q('.hpm-res-stamp').dataset.side : null, name: txt('.hpm-res-name'), how: txt('.hpm-res-how'),
                             wins: [pips(1), pips(2)], damage: [txt('[data-stat=damage] .v.p1'), txt('[data-stat=damage] .v.p2')],
                             hpLeft: [txt('[data-stat=hpLeft] .v.p1'), txt('[data-stat=hpLeft] .v.p2')],
                             throws: [txt('[data-stat=throws] .v.p1'), txt('[data-stat=throws] .v.p2')],
                             supers: [txt('[data-stat=supers] .v.p1'), txt('[data-stat=supers] .v.p2')],
                             buttons: [...document.querySelectorAll('.hpm-res-acts button')].map((b) => b.id) }; }""") or {}
                report["resultsDom"] = dom
                sim_w = mi.get("winner")
                sim_wins = mi.get("wins")
                st = mi.get("stats") or {}
                num = lambda s: int(str(s).replace(",", "")) if s not in (None, "") else None  # noqa: E731
                dmg = [num(x) for x in (dom.get("damage") or [None, None])]
                S.check("results_winner_eq_sim", dom.get("stamp") == (str(sim_w + 1) if sim_w in (0, 1) else "draw"), "dom stamp=%s sim winner=%s (%s)" % (dom.get("stamp"), sim_w, dom.get("name")))
                S.check("results_rounds_eq_sim", dom.get("wins") == sim_wins, "dom rounds=%s sim wins=%s" % (dom.get("wins"), sim_wins))
                S.check("results_damage_eq_sim", dmg == st.get("damage"), "dom damage=%s sim (hp-drop tally)=%s" % (dmg, st.get("damage")))
                S.check("results_buttons", dom.get("buttons") == ["hpm-res-rematch", "hpm-res-charselect", "hpm-res-menu"], dom.get("buttons"))
                report["resultsSim"] = {"winner": sim_w, "wins": sim_wins, "stats": st, "frame": mi.get("frame")}
                # CHANGED(integrator) 3D (G6 stability): the results cue is polled for up to 3 s (one read right after the
                # card failed as cue=None on a 6.5 fps page in the P2 run - the card's music request lands a few frames later)
                # + the engine's lastCue (audio/engine.ts): win / lose are one-shot stingers (8.25 / 10.6 s) and `cue` goes null
                # when they end - G6 run 2 (3D) read cue=None after a lost bout. The cue must be the one for P1's result.
                want_cue = "win" if sim_w == 0 else "lose"
                au = P.audio()
                t_au = time.time()
                while want_cue not in (au.get("cue"), au.get("lastCue")) and time.time() - t_au < 3.0:
                    time.sleep(0.1)
                    au = P.audio()
                S.check("audio_results_music", want_cue in (au.get("cue"), au.get("lastCue")),
                        "want %s: cue=%s lastCue=%s (after %.1f s)" % (want_cue, au.get("cue"), au.get("lastCue"), time.time() - t_au))
            else:
                fatal = "no results card"
        # ---------------------------------------------------------------- 7. rematch -> pause / resume -> forfeit -> menu
        if not fatal:
            P.key("Enter")                                 # REMATCH (default focus)
            ok, ph = sess.wait_phase("bout", 90)
            mi = P.m()
            S.check("rematch_new_bout", ok and (mi.get("frame") or 0) < 400, "phase=%s frame=%s seed=%s" % (ph, mi.get("frame"), mi.get("seed")))
            wait_match_phase(sess, "fight", 30)
            time.sleep(0.8)
            t0 = (sess.state() or {}).get("tick")
            P.key(K["pause"])
            okp, ph = sess.wait_phase("paused", 5)
            okc = P.wait_screen("pause", 5)
            time.sleep(0.4)
            fr0 = P.m().get("simFrame")
            time.sleep(1.0)
            fr1 = P.m().get("simFrame")
            S.check("esc_pause", okp and okc and fr0 == fr1, "phase=%s screen=%s simFrame %s -> %s over 1 s" % (ph, P.menus().get("screen"), fr0, fr1))
            au = P.audio()
            S.check("audio_paused", au.get("paused") is True, "audio paused=%s" % au.get("paused"))
            P.shot("pause")
            P.key(K["pause"])                              # ESC on the card = resume (CONTRACT §18.3)
            okb, ph = sess.wait_phase("bout", 5)
            # CHANGED(integrator) 3D (G6 stability): the sim must advance after the resume - polled for up to 4 s (a fixed
            # 0.8 s read failed as "simFrame 30 -> 30" on a 6.5 fps page in the P2 run)
            t_r = time.time()
            time.sleep(0.3)
            fr2 = P.m().get("simFrame")
            while not (isinstance(fr2, int) and isinstance(fr1, int) and fr2 > fr1) and time.time() - t_r < 4.0:
                time.sleep(0.1)
                fr2 = P.m().get("simFrame")
            S.check("esc_resume", okb and isinstance(fr2, int) and isinstance(fr1, int) and fr2 > fr1, "phase=%s simFrame %s -> %s (%.1f s)" % (ph, fr1, fr2, time.time() - t_r))
            P.key(K["pause"])
            sess.wait_phase("paused", 5)
            P.wait_screen("pause", 5)
            S.check("focus_forfeit", P.focus_to("hpm-p-forfeit"), "focus=%s" % P.menus().get("focus"))
            P.key("Enter")
            time.sleep(0.3)
            conf = bool(P.menus().get("confirm"))
            if conf:
                P.key("ArrowRight")
                P.key("Enter")
            okr, ph = sess.wait_phase("results", 8)
            time.sleep(0.5)
            how = sess.safe_js("() => { const e = document.querySelector('.hpm-res-how'); return e ? e.textContent.trim() : null; }")
            stamp = sess.safe_js("() => { const e = document.querySelector('.hpm-res-stamp'); return e ? e.dataset.side : null; }")
            S.check("forfeit_results", okr and stamp == "2", "confirm=%s phase=%s stamp=%s how=%s" % (conf, ph, stamp, how))
            P.shot("forfeit_results")
            S.check("focus_menu", P.focus_to("hpm-res-menu", "ArrowRight"), "focus=%s" % P.menus().get("focus"))
            P.key("Enter")
            okm = P.wait_screen("main", 8)
            S.check("back_to_main_menu", okm and sess.phase() == "menu", "phase=%s screen=%s" % (sess.phase(), P.menus().get("screen")))
            P.shot("main_after")
            # a REAL mouse click on a menu button (the menus must take pointer input inside the game's #ui host)
            r = sess.safe_js("() => { const b = document.getElementById('hpm-main-versus'); if (!b) return null; const q = b.getBoundingClientRect(); return {x: q.x + q.width / 2, y: q.y + q.height / 2}; }")
            if r:
                sess.page.mouse.click(r["x"], r["y"])
            okc = P.wait_screen("versus", 4)
            S.check("mouse_click_menu", bool(r) and okc, "click at %s -> screen=%s" % (r, P.menus().get("screen")))
            P.key("Escape")
            P.wait_screen("main", 4)
    finally:
        tl = sess.timeline() if sess.page else []
        diag = sess.diagnostics() if sess.page else {}
        try:
            sess.release_all()
        except Exception:
            pass
        sess.close()

    print("=" * 84)
    print("verbs        : %s" % json.dumps({k: (v.get("ok"), v.get("how")) for k, v in verbs.items()}))
    if bout:
        print("bout         : %s" % json.dumps({k: bout.get(k) for k in ("rounds", "winner", "wins", "frames", "seconds", "meterHelp", "hpHelp", "keyPresses")}, default=str))
    print("-" * 84)
    print_diagnostics(diag)
    print("=" * 84)
    problems = [s for s in S.failed]
    dp = diag_problems(diag)
    report.update({"steps": S.items, "verbs": verbs, "diagnostics": diag, "fatal": fatal, "timeline": tl[-20:],
                   "events": [{k: e.get(k) for k in ("frame", "typeName", "a", "b", "c", "d")} for e in P.log[-400:]]})
    ok = not fatal and not problems and not dp
    # CHANGED(integrator) 3D (G6 stability): a STARVED page cannot run a real-time gate - the sim speed at the bout start
    # (3 s of ticks) or over the whole bout (frames / (seconds x 60)) below 0.5 of real time makes a failing run
    # INCONCLUSIVE (exit 3, SAID, never a pass); a run that passed anyway stays a pass
    sp = report.get("simSpeed") or {}
    if bout and bout.get("seconds"):
        sp["bout"] = round((bout.get("frames") or 0) / (bout["seconds"] * 60.0), 3)
    starved = [k for k, v in sp.items() if isinstance(v, (int, float)) and v < 0.5]
    report["simSpeed"] = sp
    report["verdict"] = "PASS" if ok else ("INCONCLUSIVE" if starved else "FAIL")
    print("sim speed    : %s (fraction of 60 Hz real time)%s" % (json.dumps(sp), "  STARVED: %s" % starved if starved else ""))
    for s in problems:
        print("   X step %s: %s" % (s["step"], s["detail"] if isinstance(s["detail"], str) else json.dumps(s["detail"], default=str)))
    for p in dp:
        print("   X %s" % p)
    if fatal:
        print("FATAL        : %s" % fatal)
    print("report       : %s" % save_report("playtest", report, args.base))
    print("steps        : %d passed, %d failed" % (len(S.items) - len(problems), len(problems)))
    print("RESULT: %s" % ("OK" if ok else ("INCONCLUSIVE (the page was starved below half real time - rerun on an idle machine)" if starved else "FAIL")))
    if not ok and starved:
        return 3
    if fatal:
        return 2
    return 0 if ok else 1


# ─────────────────────────────── the bout bot (real keys, reads only) ───────────────────────────────
def play_bout(P, S, args, verbs):
    s = P.s
    t_start = time.time()
    presses = {}
    meter_help = None
    hud_checks = {}
    audio_checks = {}

    def press(name, hold_ms=60, gap=0.0):
        presses[name] = presses.get(name, 0) + 1
        s.press(K[name], hold_ms)
        if gap:
            time.sleep(gap)

    def mark(verb, ok, how):
        v = verbs.get(verb)
        if v and v.get("ok"):
            return
        verbs[verb] = {"ok": bool(ok), "how": how, "t": round(time.time() - t_start, 1)}

    # CHANGED(integrator) 3D (G6 stability): HP HELP during the VERB phase only (SAID in the report, like the meter help):
    # the verbs (walk, sidestep, circle-walk, jab, special, throw, IMPACT, the 25 s parry window) leave P1 passive for long
    # stretches and the bot's verbs hurt the CPU too - G6 run 9: CPU L1 bruno won 2-0 in 52 s before the verbs finished, so
    # the super / HUD / audio checks never ran. While the verb phase runs, a fighter below 40 % hp is refilled to its max
    # (__HP__.dev.setHp); the rest of the bout runs without help and decides the winner.
    hp_help = {"refills": [], "on": True, "t": 0.0}

    def keep_alive():
        if not hp_help["on"] or time.time() - hp_help["t"] < 0.25:
            return
        hp_help["t"] = time.time()
        f = P.f() or []
        for i, fs in enumerate(f[:2]):
            hm, hpv = fs.get("hpMax") or 0, fs.get("hp")
            if hm and isinstance(hpv, (int, float)) and 0 < hpv < 0.4 * hm:
                okh, _ = s.hp("dev.setHp", i, hm)
                hp_help["refills"].append({"p": i, "from": hpv, "ok": okh})

    def fight_now():
        keep_alive()
        return (P.m().get("phase") == "fight") and s.phase() == "bout"

    def evs_since(n0):
        return P.log[n0:]

    def gap_now():
        f = P.f()
        if not f:
            return None, None
        return planar(f[0], f[1]), f  # CHANGED(AI3D): planar

    def walk_in(max_s=2.5, gap_to=0.9):
        t0 = time.time()
        g, f = gap_now()
        if g is None:
            return None
        fk, _ = fwd_back(f)
        s.hold({fk})
        # CHANGED(fixer) D2: the push boxes are measured now (johnny vs bruno touch at 0.875 m, was 0.52), so a
        # fixed target gap can be unreachable: stop when the gap stops closing (bodies touching) as well
        best, best_t = g, time.time()
        while time.time() - t0 < max_s:
            P.new_events()
            g, f = gap_now()
            if g is None or g <= gap_to or not fight_now():
                break
            if g < best - 0.005:
                best, best_t = g, time.time()
            elif time.time() - best_t > 0.25:
                break
            time.sleep(0.03)
        s.hold(set())
        return g

    # ---------- verb: walk
    # CHANGED(AI3D): measured along the line to the CPU (planar) and only over a hold P1 actually walked through - a CPU
    # throw / hit in the 0.6 s (measured: L1 bruno threw P1 on frame 132 of round 1, carrying it 1.04 m back) retries
    for attempt in range(4):
        if (verbs.get("walk") or {}).get("ok") or not fight_now():
            break
        t_free = time.time() + 4.0
        while time.time() < t_free:
            f0 = P.f() or [{}, {}]
            if (f0[0].get("stateName") or "") in ("idle", "walk_f", "walk_b", "crouch"):
                break
            time.sleep(0.03)
        g0, f0 = gap_now()
        if f0 is None:
            break
        fk, bk = fwd_back(f0)
        x0, z0 = f0[0]["x"], (f0[0].get("z") or 0.0)
        ux, uz = f0[1]["x"] - x0, (f0[1].get("z") or 0.0) - z0
        ul = math.hypot(ux, uz) or 1.0
        states = set()
        s.hold({fk})
        t_w = time.time()
        while time.time() - t_w < 0.6:
            ff = P.f()
            if ff:
                states.add(ff[0].get("stateName") or "")
            time.sleep(0.03)
        f1 = P.f() or f0
        s.hold(set())
        dxw = ((f1[0]["x"] - x0) * ux + ((f1[0].get("z") or 0.0) - z0) * uz) / ul
        clean = states <= {"idle", "walk_f"}
        mark("walk", clean and dxw > 0.2, "real %s hold 0.6 s: P1 (%.2f, %.2f) -> (%.2f, %.2f): %.2f m toward the CPU; P1 states %s%s" %
             (fk, x0, z0, f1[0]["x"], f1[0].get("z") or 0.0, dxw, sorted(states), "" if clean else " (interrupted - retry)"))
        P.new_events()

    # ---------- CHANGED(AI3D) verbs: sidestep (tap Q / E) + circle-walk (hold E) - the 3D ring, real keys
    def wait_free(max_s=3.0):
        t0 = time.time()
        while time.time() - t0 < max_s and fight_now():
            ff = P.f() or [{}, {}]
            if (ff[0].get("stateName") or "") in ("idle", "walk_f", "walk_b", "crouch"):
                return ff
            time.sleep(0.03)
        return P.f()

    for attempt in range(4):
        if (verbs.get("sidestep") or {}).get("ok") or not fight_now():
            break
        fa = wait_free()
        if not fa:
            break
        key = "stepin" if attempt % 2 == 0 else "stepout"
        p0, o0 = dict(fa[0]), dict(fa[1])
        d0 = planar(p0, o0)
        kinds = set()
        presses[key] = presses.get(key, 0) + 1
        s.press(K[key], 60)
        t_end = time.time() + 0.45
        while time.time() < t_end:
            ff = P.f()
            if ff:
                kinds.add(step_kind(ff[0]))
            time.sleep(0.02)
        ff = P.f() or [p0, o0]
        moved = planar(ff[0], p0)
        d1 = planar(ff[0], ff[1])
        turn = ang_diff(bearing(o0, p0), bearing(ff[1], ff[0]))
        ok = "sidestep" in kinds and moved >= 0.3 and abs(d1 - d0) <= 0.25
        mark("sidestep", ok, "tap %s: step kinds %s; P1 moved %.2f m, distance to the CPU %.2f -> %.2f m, bearing around it turned %.0f deg" %
             (K[key], sorted(kinds), moved, d0, d1, turn))
        P.new_events()
        time.sleep(0.3)

    for attempt in range(3):
        if (verbs.get("circle") or {}).get("ok") or not fight_now():
            break
        fa = wait_free()
        if not fa:
            break
        m0 = P.m() or {}
        p0, o0 = dict(fa[0]), dict(fa[1])
        d0 = planar(p0, o0)
        b0 = bearing(o0, p0)
        cam0 = m0.get("camN")
        kinds = set()
        dists = []
        shots = []
        key = "stepout" if attempt % 2 == 0 else "stepin"
        presses[key] = presses.get(key, 0) + 1
        s.hold({K[key]})
        t0c = time.time()
        marks = [0.25, 1.0, 1.75]
        while time.time() - t0c < 1.9:
            ff = P.f()
            if ff:
                k = step_kind(ff[0])
                kinds.add(k)
                if k == "sidewalk":
                    dists.append(planar(ff[0], ff[1]))
            if marks and time.time() - t0c >= marks[0]:
                tag = "abc"[3 - len(marks)]
                P.shot("circle_%s" % tag)
                shots.append(tag)
                marks.pop(0)
            time.sleep(0.03)
        while marks:
            tag = "abc"[3 - len(marks)]
            P.shot("circle_%s" % tag)
            shots.append(tag)
            marks.pop(0)
        ff = P.f() or [p0, o0]
        m1 = P.m() or {}
        s.hold(set())
        turn = ang_diff(b0, bearing(ff[1], ff[0]))
        cam1 = m1.get("camN")
        camturn = ang_diff(math.degrees(math.atan2(cam0[0], cam0[1])), math.degrees(math.atan2(cam1[0], cam1[1]))) if cam0 and cam1 else None
        spread = (max(dists) - min(dists)) if dists else None
        ok = "sidewalk" in kinds and turn >= 30.0 and spread is not None and spread <= 0.3
        mark("circle", ok, "hold %s 1.9 s: step kinds %s; P1 circled %.0f deg around the CPU (distance %.2f m at start, %s during the walk), sim camN turned %s deg; shots pt_circle_%s" %
             (K[key], sorted(kinds), turn, d0, ("%.2f-%.2f m" % (min(dists), max(dists))) if dists else "-", ("%.0f" % camturn) if camturn is not None else "?", "/".join(shots)))
        P.new_events()
        time.sleep(0.4)

    # ---------- verb: jab (J) at range
    walk_in(3.0, 0.8)
    # CHANGED(fixer) D13: the jab verb passes only when a jab LANDS (HIT / COUNTER / PUNISH by P1); a blocked jab was
    # counted as a pass, so G6 could go green without a jab ever connecting. Blocks and whiffs retry (up to 10 presses).
    blocked = 0
    for _ in range(10):
        n0 = len(P.log)
        press("l", 50, 0.35)
        P.new_events()
        hits = by(evs_since(n0), ("HIT", "COUNTER", "PUNISH"), a=0)
        blk = by(evs_since(n0), ("BLOCK",), a=0)
        wh = by(evs_since(n0), ("WHIFF",), a=0)
        if hits:
            mark("jab", True, "J -> %s a=0 c=%s (after %d blocked)" % (hits[0]["typeName"], hits[0].get("c"), blocked))
            break
        if blk:
            blocked += 1
            mark("jab", False, "J -> BLOCK only so far (%d)" % blocked)
        elif wh:
            mark("jab", False, "J -> WHIFF only so far")
        walk_in(1.0, 0.7)
    # ---------- verb: special (I = SIMPLE 5S)
    # CHANGED(integrator) 3D (G6 stability): each press waits until P1 is free (G6 run 2: 5 presses all landed while the live
    # CPU had P1 in hitstun / knockdown -> "never attempted"), up to 8 presses
    for _ in range(8):
        if not fight_now():
            break
        wait_free(3.0)
        n0 = len(P.log)
        time.sleep(0.1)
        press("s", 50, 0.7)
        P.new_events()
        sp = by(evs_since(n0), ("PROJ_SPAWN",), a=0) + by(evs_since(n0), ("HIT", "BLOCK", "COUNTER", "PUNISH", "PROJ_HIT"), a=0, c=(3, 6))
        if sp:
            landed = by(evs_since(n0), ("HIT", "BLOCK", "PROJ_HIT", "COUNTER", "PUNISH"), a=0, c=(3, 6))
            mark("special", True, "I -> %s" % ", ".join("%s c=%s" % (e["typeName"], e.get("c")) for e in (landed or sp)[:3]))
            if landed:
                break
    # ---------- verb: throw (H) touching
    for _ in range(6):
        walk_in(2.0, 0.55)
        n0 = len(P.log)
        press("throw", 50, 0.9)
        P.new_events()
        th = by(evs_since(n0), ("THROW", "THROW_TECH"), a=0)
        if th:
            mark("throw", True, "H at close range -> %s a=0" % th[0]["typeName"])
            break
        mark("throw", False, "H x%d: no THROW by P1 yet" % presses.get("throw", 0))
        time.sleep(0.3)
    # ---------- verb: IMPACT (P)
    for _ in range(4):
        walk_in(2.0, 1.2)
        n0 = len(P.log)
        press("impact", 50, 1.0)
        P.new_events()
        im = by(evs_since(n0), ("IMPACT_START",), a=0)
        if im:
            more = by(evs_since(n0), ("HIT", "BLOCK", "IMPACT_ARMOR", "WALL_SPLAT", "IMPACT_CLASH"))
            mark("impact", True, "P -> IMPACT_START a=0%s" % ("; then " + ", ".join("%s a=%s c=%s" % (e["typeName"], e.get("a"), e.get("c")) for e in more[:3]) if more else ""))
            break
        mark("impact", False, "P x%d: no IMPACT_START" % presses.get("impact", 0))
    # ---------- verb: parry (hold O into the CPU's attack)
    # CHANGED(fixer): only a PARRYABLE attack counts - throws, command grabs and grab supers beat a parry (they punish it),
    # so holding O into the CPU's walk_in_h is not a parry test (measured in the fixer G6 run: the only attack L1 Bruno
    # threw in the window was his 360 grab). Grab moves come from the opponent's fighter data.
    grab_moves = set()
    opp_moves = {}
    try:
        opp_id = ((P.m().get("p") or [{}, {}])[1] or {}).get("fighter")
        fd = json.load(open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "fighters", "%s.json" % opp_id), encoding="utf-8"))
        opp_moves = fd.get("moves", {})
        grab_moves = {k for k, mv in opp_moves.items() if mv.get("grab") or mv.get("kind") in ("throw", "cmdgrab")}
    except Exception:
        pass

    def parry_timing(opp):
        """CHANGED(integrator) 3D (G6 stability): press PARRY (12 active frames, system.json parry.active) when the CPU's
        move is 3..12 frames from its first active frame (its startup from data/fighters), so the parry's active frames
        cover the hit despite the bot's 2-6 frame real-time latency; a move without startup data: the old moveFrame < 10"""
        mv = opp_moves.get(opp.get("moveName") or "") or {}
        su = int(mv.get("startup") or 0)
        mf = int(opp.get("moveFrame") or 0)
        return 3 <= su - mf <= 12 if su > 0 else mf < 10
    parry_try_until = time.time() + 25.0
    while time.time() < parry_try_until and fight_now():
        g, f = gap_now()
        if g is None:
            break
        if g > 1.6:
            walk_in(1.5, 1.3)
            continue
        opp = f[1]
        attacking = ((opp.get("moveKind") or "") not in ("", "none", "system", "throw", "cmdgrab") and parry_timing(opp)
                     and opp.get("moveName") not in ("parry",) and opp.get("moveName") not in grab_moves)
        if attacking:
            n0 = len(P.log)
            s.hold({K["parry"]})
            time.sleep(0.45)
            s.hold(set())
            P.new_events()
            pe = by(evs_since(n0), ("PARRY", "PERFECT_PARRY"), b=0)
            if pe:
                mark("parry", True, "hold O into the CPU's %s -> %s (a=%s b=0)" % (opp.get("moveName"), pe[0]["typeName"], pe[0].get("a")))
                break
            mark("parry", False, "held O into the CPU's %s: no PARRY event" % opp.get("moveName"))
        else:
            time.sleep(0.03)
            P.new_events()
    if not (verbs.get("parry") or {}).get("ok"):
        # the CPU at L1 rarely attacks into the parry window; prove the parry VERB by holding it (P1 enters the parry state)
        # CHANGED(fixer): from a free state (a knocked-down / thrown P1 cannot parry)
        t_free = time.time() + 4.0
        while time.time() < t_free:
            f0 = P.f() or [{}, {}]
            if (f0[0].get("stateName") or "") in ("idle", "walk_f", "walk_b", "crouch"):
                break
            time.sleep(0.03)
        n0 = len(P.log)
        s.hold({K["parry"]})
        time.sleep(0.25)
        f = P.f() or [{}, {}]
        s.hold(set())
        mv = f[0].get("moveName")
        v = verbs.get("parry") or {}
        verbs["parry"] = {"ok": False, "how": (v.get("how") or "") + " | fallback: held O -> P1 moveName=%r (parry state %s)" % (mv, "entered" if mv == "parry" else "NOT entered"),
                          "stateEntered": mv == "parry", "t": round(time.time() - t_start, 1)}

    # ---------- the rest of the bout + super when the meter is full
    hp_help["on"] = False
    parry_tries = []
    parry_wait_until = time.time() + 40.0
    last_hud = time.time()
    last_step = time.time()
    super_done = False
    shots_taken = set()
    rounds_seen = 0
    deadline = time.time() + args.bout_budget
    while time.time() < deadline:
        ph = s.phase()
        if ph in ("results",):
            break
        fresh = P.new_events()
        if "ko" not in shots_taken and by(fresh, ("KO",)):
            shots_taken.add("ko")
            P.shot("ko")
        m = P.m()
        if by(P.log, ("MATCH_END",)):
            s.hold(set())
            if ph != "bout" and ph != "paused":
                break
            time.sleep(0.2)
            continue
        if m.get("phase") != "fight" or ph != "bout":
            s.hold(set())
            time.sleep(0.08)
            continue
        f = P.f()
        if not f:
            time.sleep(0.05)
            continue
        me, opp = f[0], f[1]
        g = planar(me, opp)  # CHANGED(AI3D): planar
        fk, bk = fwd_back(f)
        # HUD + audio read-backs, once a second
        if time.time() - last_hud > 1.0:
            last_hud = time.time()
            h = P.hud()
            if h.get("mounted"):
                sd = h.get("sides") or [{}, {}]
                hud_checks.setdefault("hp_follows_sim", []).append([sd[0].get("hp"), me.get("hp"), sd[1].get("hp"), opp.get("hp")])
                hud_checks["timer"] = hud_checks.get("timer", []) + [h.get("timer")]
                hud_checks["pips"] = h.get("pips")
                hud_checks["nerve"] = [sd[0].get("nerve"), sd[1].get("nerve")]
                hud_checks["showtime"] = [sd[0].get("showtime"), sd[1].get("showtime")]
                if (sd[0].get("combo") or 0) >= 2 or (sd[1].get("combo") or 0) >= 2:
                    hud_checks["combo"] = [sd[0].get("combo"), sd[0].get("word"), sd[1].get("combo"), sd[1].get("word")]
                    if "combo" not in shots_taken:
                        shots_taken.add("combo")
                        P.shot("combo")
                bc = h.get("broadcast") or {}
                caps = bc.get("captions") or []
                if caps:
                    hud_checks["captions"] = caps[-3:]
                calls = (sd[0].get("calls") or []) + (sd[1].get("calls") or [])
                if calls:
                    hud_checks["callouts"] = calls
            au = P.audio()
            audio_checks = {"unlocked": au.get("unlocked"), "state": au.get("state"), "cue": au.get("cue"), "loops": au.get("loops"),
                            "played": au.get("played"), "playedBus": au.get("playedBus"), "errors": au.get("errors"), "crowd": au.get("crowd"),
                            "hits": {k: v for k, v in (au.get("counts") or {}).items() if k.startswith(("hit", "punch", "kick", "block", "body"))},
                            "meterPeakDb": (au.get("meter") or {}).get("peakAllDb")}
        # super when the meter is full (1 bar = 10000)
        if not super_done and me.get("showtime", 0) >= 10000 and g < 2.2:
            n0 = len(P.log)
            s.hold({K["s"], K["h"]})
            time.sleep(0.08)
            s.hold(set())
            time.sleep(1.2)
            P.new_events()
            sf = by(evs_since(n0), ("SUPER_FREEZE",), a=0)
            if sf:
                super_done = True
                sh = by(evs_since(n0), ("SUPER_HIT", "HIT", "BLOCK"), a=0)
                mark("super", True, "SHOWTIME %d -> I+L (S+H) -> SUPER_FREEZE a=0 level %s%s%s" % (me.get("showtime"), sf[0].get("b"),
                     "; " + ", ".join("%s c=%s" % (e["typeName"], e.get("c")) for e in sh[:3]) if sh else "; (no hit)", " [meter filled by dev.setMeter]" if meter_help else ""))
                P.shot("super")
            else:
                mark("super", False, "I+L with SHOWTIME %d: no SUPER_FREEZE" % me.get("showtime", 0))
            continue
        # meter help: if SHOWTIME still < 1 bar once round 2 is under way, fill it (SAID in the report)
        if not super_done and not args.no_meter_help and meter_help is None and (m.get("round") or 1) >= 2 and me.get("showtime", 0) < 10000:
            ok, v = s.hp("dev.setMeter", 0, "showtime", 10000)
            meter_help = {"ok": ok, "from": me.get("showtime"), "round": m.get("round"), "result": v}
            continue
        # block when the CPU attacks at range
        oatk = (opp.get("moveKind") or "") not in ("", "none") and opp.get("moveFrame", 99) < 10 and g < 1.8
        # CHANGED(AI3D): the parry verb, if the 25 s window above saw no parryable CPU attack, is tried on the next one here
        # (hold O instead of back; throws / command grabs / grab supers beat a parry, so they are blocked as before)
        parryable = ((opp.get("moveKind") or "") not in ("", "none", "system", "throw", "cmdgrab") and g < 1.8 and parry_timing(opp)
                     and opp.get("moveName") not in grab_moves)
        if parryable and not (verbs.get("parry") or {}).get("ok") and me.get("moveName") in (None, "", "none") and (me.get("stun") or 0) <= 0:
            n0 = len(P.log)
            s.hold({K["parry"]})
            time.sleep(0.45)
            s.hold(set())
            P.new_events()
            pe = by(evs_since(n0), ("PARRY", "PERFECT_PARRY"), b=0)
            parry_tries.append({"move": opp.get("moveName"), "frame": opp.get("moveFrame"), "parried": bool(pe)})
            if pe:
                verbs["parry"] = {"ok": True, "how": "hold O into the CPU's %s -> %s (a=%s b=0), later in the bout (try %d)" % (opp.get("moveName"), pe[0]["typeName"], pe[0].get("a"), len(parry_tries)),
                                  "t": round(time.time() - t_start, 1)}
            else:
                v = verbs.get("parry") or {}
                v["laterTries"] = parry_tries[-6:]
                verbs["parry"] = v
            continue
        # CHANGED(integrator) 3D (G6 stability): while the parry verb is still open (CPU L1 throws only ~10 strikes in a bout),
        # P1 stands its ground at close range for up to 40 s of the rest of the bout instead of pressing - its own offense kept
        # the CPU in hitstun / blockstun, so no parryable attack came (G6 run 7: 0 parries in 87 s)
        if not (verbs.get("parry") or {}).get("ok") and g < 1.6 and time.time() < parry_wait_until:
            s.hold(set())
            time.sleep(0.03)
            continue
        if oatk and me.get("moveName") in (None, "", "none") and (me.get("stun") or 0) <= 0:
            s.hold({bk})
            time.sleep(0.25)
            s.hold(set())
            continue
        # CHANGED(AI3D): a sidestep tap every ~4 s from neutral at mid range (the ring is part of the bout, not a demo)
        if 1.1 < g < 2.6 and (me.get("stateName") or "") in ("idle", "walk_f", "walk_b") and time.time() - last_step > 4.0:
            last_step = time.time()
            key = "stepin" if presses.get("stepin", 0) <= presses.get("stepout", 0) else "stepout"
            s.hold(set())
            press(key, 60, 0.3)
            continue
        if g > 0.95:
            s.hold({fk})
            time.sleep(0.05)
            continue
        s.hold(set())
        roll = int(time.time() * 10) % 7
        if roll == 0 and g < 0.7:
            press("throw", 50, 0.5)
        else:
            # ASSIST auto-combo: hold U, tap J (SIMPLE route per fighter data)
            s.hold({K["assist"]})
            for _ in range(4):
                press("l", 45, 0.13)
            s.hold(set())
            time.sleep(0.15)
    s.hold(set())
    P.new_events()
    mi = P.m()
    kos = by(P.log, ("KO",))
    rends = by(P.log, ("ROUND_END",))
    mend = by(P.log, ("MATCH_END",))
    res = {"rounds": len(rends), "kos": len(kos), "matchEnd": bool(mend), "winner": mi.get("winner"), "wins": mi.get("wins"),
           "frames": mi.get("frame"), "seconds": round(time.time() - t_start, 1), "meterHelp": meter_help, "hpHelp": hp_help["refills"], "keyPresses": presses,
           "hud": hud_checks, "audio": audio_checks}
    # ---- verdicts for the bout
    for v in ("walk", "sidestep", "circle", "jab", "special", "throw", "parry", "impact", "super"):
        e = verbs.get(v) or {"ok": False, "how": "never attempted (bout ended first)"}
        S.check("verb_" + v, e.get("ok"), e.get("how"))
    S.check("bout_best_of_3_to_the_end", bool(mend) and len(rends) >= 2 and max(mi.get("wins") or [0, 0]) == 2,
            "ROUND_END x%d, KO x%d, MATCH_END %s, wins %s, winner %s, %.0f s" % (len(rends), len(kos), bool(mend), mi.get("wins"), mi.get("winner"), time.time() - t_start))
    hf = hud_checks.get("hp_follows_sim") or []
    S.check("hud_hp_follows_sim", bool(hf) and all(r[0] == r[1] and r[2] == r[3] for r in hf[-5:]), "last samples [hudP1, simP1, hudP2, simP2]: %s" % hf[-3:])
    tm = [t for t in (hud_checks.get("timer") or []) if t not in (None, "")]
    S.check("hud_timer_counts", len(set(tm)) >= 3, "timer samples %s" % tm[:8])
    S.check("hud_meters", hud_checks.get("nerve") is not None and hud_checks.get("showtime") is not None, "nerve=%s showtime=%s" % (hud_checks.get("nerve"), hud_checks.get("showtime")))
    S.check("hud_round_pips", isinstance(hud_checks.get("pips"), list) and sum(hud_checks.get("pips") or []) >= 1, "pips=%s" % hud_checks.get("pips"))
    S.check("hud_combo", bool(hud_checks.get("combo")), "combo=%s" % hud_checks.get("combo"))
    S.check("hud_captions", bool(hud_checks.get("captions")), "captions=%s" % hud_checks.get("captions"))
    a = audio_checks
    S.check("audio_unlocked_music", bool(a.get("unlocked")) and a.get("state") == "running" and bool(a.get("cue")), "unlocked=%s state=%s cue=%s" % (a.get("unlocked"), a.get("state"), a.get("cue")))
    S.check("audio_hits_played", (a.get("playedBus") or {}).get("sfx", 0) > 10, "playedBus=%s hits=%s" % (a.get("playedBus"), a.get("hits")))
    S.check("audio_crowd", bool([l for l in (a.get("loops") or []) if "bed" in l or "crowd" in l or "amb" in l]) or (a.get("playedBus") or {}).get("crowd", 0) > 0,
            "loops=%s crowd plays=%s crowd=%s" % (a.get("loops"), (a.get("playedBus") or {}).get("crowd"), a.get("crowd")))
    S.check("audio_no_errors", not a.get("errors"), "errors=%s" % a.get("errors"))
    pk = a.get("meterPeakDb")
    S.check("audio_output_signal", isinstance(pk, (int, float)) and pk > -60, "engine output meter peak (all time) %s dBFS" % pk)
    return res


# ─────────────────────────────── THE SEASON (G11 browser half, CHANGED(AI) P2) ───────────────────────────────
# python _harness/playtest.py --season --headless --base http://localhost:5326/          # a whole PILOT to the ending
# python _harness/playtest.py --season --max-bouts 1 ...                                  # smoke: menus + the first bout
#
# A scripted persona drives P1 through REAL key events (Playwright keyboard -> trusted KeyboardEvents -> the game's Input)
# across THE SEASON ladder exactly as a player does: main menu -> THE SEASON -> PILOT / difficulty -> character select
# (fighter, colour, SIMPLE controls) -> ladder -> rival / mini boss / boss cards -> VS -> bout -> results (NEXT EPISODE /
# CONTINUE) -> ... -> name entry -> the ending sequence -> title. It only READS state (__HP__ state / match / fighters /
# events / menus) to choose keys. TIME CONTROL (SAID in the report): by default each bout runs with the sim frozen
# (__HP__.dev.freeze) and the harness steps it `--step-frames` at a time (__HP__.dev.step) between its key changes, so a
# Python bot can answer on the frame it sees (a real-time Python loop reacts 30-100 ms late and loses to CPU L1 - the G6
# bout above). The keys are still real key events sampled by the game's own tick. `--realtime` plays without stepping.
# Checks per slot: the slot the game staged (mode, opponent, CPU level) = data/ladder.json + flow.ts; the card for rival
# / mini boss / boss; results winner = the sim; a bonus slot is PLAYED (mode brawl / heckler, score > 0) - FAILS when
# game.ts passes over it (BONUS_ROUNDS_IN_SIM = false, SHELL); the boss bout shows RICKY's phase change (PHASE event);
# the ending sequence (finale ... board) reaches the title. Report: _harness/_reports/playtest_season.json, shots
# _shots/pts_*.png.

SEASON_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load_json(*parts):
    with open(os.path.join(SEASON_ROOT, *parts), encoding="utf-8") as f:
        return json.load(f)


STEP_JS = """async (n) => { const h = window.__HP__; if (n > 0) h.dev.step(n);
  let f = null, m = null; try { f = h.fighters(); } catch (e) {} try { m = h.match(); } catch (e) {}
  return { f, m, st: h.state() }; }"""


_GEOM_CACHE = {}


def bot_geom(me_id, opp_id):
    """CHANGED(wf7 season bot): the SeasonBot's range numbers from the COMPILED data - `node _harness/probe_balance.ts
    --geom <me> <opp>` (botGeom): both push fronts (touch = the closest root distance the push bodies allow), the
    opponent's standing hurt front, my strikes' reach = box front + travel exactly as the sim / CPU kit compute it (the
    boxes are re-derived from the clips at load - the data/fighters JSON boxes are not the ones the sim uses), my throw
    gap and the opponent's command-grab reach. One call per fighter pair (cached); a failure is a harness error."""
    key = (me_id, opp_id)
    if key in _GEOM_CACHE:
        return _GEOM_CACHE[key]
    import shutil
    import subprocess
    node = shutil.which("node")
    if not node:
        raise HarnessError("SeasonBot geometry needs node (node _harness/probe_balance.ts --geom); node not on PATH")
    env = dict(os.environ, NODE_NO_WARNINGS="1", FORCE_COLOR="0")
    r = subprocess.run([node, os.path.join(SEASON_ROOT, "_harness", "probe_balance.ts"), "--geom", me_id, opp_id], cwd=SEASON_ROOT,
                       capture_output=True, text=True, encoding="utf-8", timeout=180, env=env)
    lines = [x for x in (r.stdout or "").splitlines() if x.strip().startswith("{")]
    if r.returncode != 0 or not lines:
        raise HarnessError("SeasonBot geometry: probe_balance.ts --geom %s %s rc=%s: %s" % (me_id, opp_id, r.returncode, ((r.stderr or "") + (r.stdout or ""))[-400:]))
    g = json.loads(lines[-1])
    _GEOM_CACHE[key] = g
    return g


def _dist(a, b):
    """planar root distance; sqrt of products (correctly rounded in Python AND JS - probe_balance.ts mirrors this bot)"""
    dx = a["x"] - b["x"]
    dz = (a.get("z") or 0.0) - (b.get("z") or 0.0)
    return math.sqrt(dx * dx + dz * dz)


HIT_STATES = ("knockdown", "hitstun", "juggle", "blockstun", "wall_splat", "crumple", "dizzy")
FREE_STATES = ("idle", "walk_f", "walk_b")


class SeasonBot:
    """P1 persona: frame-exact guard vs visible attacks and projectiles, throw techs, punishes whiffs / recoveries with
    the ASSIST auto-combo (hold U + tap J), supers into recoveries, SIMPLE 2S anti-airs, walks in and presses.

    CHANGED(wf7 season bot): every range is the REAL reach (bot_geom, from the compiled data), never an absolute root
    distance. The old constants (walk in while d > 1.05 m, throw at d < 0.95, punish at d < 1.6) were tuned on regular
    bodies: johnny 0.317 + THE FREAK 0.747 m push fronts = 1.064 m minimum gap, so vs THE FREAK it walked into the body
    forever and never attacked (WF6: 0 / 22 season bouts, every round to the timer; CONTRACT §35.25 item 4). Now: walk in
    until the ASSIST opener reaches with a margin (and the push gap is <= 0.45 m), throw inside its throw gap, punish /
    super inside the move's reach, read the opponent's command-grab reach. Still a decent-but-not-optimal player: one fixed
    ASSIST route, a fixed mix (no adaptation), sidestep reads on only ~55 % of the chances. 3D habits (the verifier's
    Bot3D): a sidestep read of a straight (non-homing) strike seen by its move frame 4 with startup >= 10, a 5H side punish
    of its recovery, circle-walks (STEP held 50-80 f) at mid range now and then and off the ring wall, the back key cancels
    a circle-walk into the guard. probe_balance.ts `seasonbot` is the headless mirror of keys() - change both together."""

    def __init__(self, me_id, opp_id, geom=None):
        self.me = _load_json("data", "fighters", "%s.json" % me_id)
        self.opp_id = opp_id
        self.opp = _load_json("data", "fighters", "%s.json" % opp_id) if opp_id else {"moves": {}}
        self.phase = 0          # alternating tap state of the combo / press keys
        self.n = 0              # fight decisions so far (the 3D habits' clock)
        self.circle = 0         # decisions left in the running circle-walk
        self.circle_key = None
        self.circle_cool = 0
        self.step_cool = 0
        self.punish = 0
        self.stats = {"stepReads": 0, "sidePunish": 0, "circles": 0, "wallCircles": 0}
        self.g = geom if geom is not None else (bot_geom(me_id, opp_id) if opp_id else None)
        if self.g:
            g = self.g
            touch = g["touch"]
            open_r = g["openReach"] + g["opHurt"]
            self.touch = touch
            self.close_d = max(touch + 0.10, min(open_r - 0.12, touch + 0.45))
            self.throw_d = touch + g["throwGap"] - 0.08
            self.punish_d = max(self.close_d, open_r - 0.05)
            self.side_d = (g["sideReach"] + g["opHurt"] - 0.05) if g["sideReach"] > 0 else self.punish_d
            self.sup1_d = (g["sup1Reach"] + g["opHurt"] - 0.05) if g["sup1Reach"] > 0 else self.punish_d
            self.sup3_d = (g["sup3Reach"] + g["opHurt"] - 0.05) if g["sup3Reach"] > 0 else self.punish_d
            self.aa_d = max(2.0, touch + 1.0)
            self.mid_lo = touch + 0.6
            self.mid_hi = touch + 1.8

    def omove(self, name):
        return (self.opp.get("moves") or {}).get(name) or {}

    def ranges(self):
        """the derived ranges (report)"""
        return {k: round(getattr(self, k), 3) for k in ("touch", "close_d", "throw_d", "punish_d", "side_d", "sup1_d", "sup3_d", "aa_d", "mid_lo", "mid_hi")} if self.g else None

    def grab_threat(self, name, okind):
        """centre distance inside which the opponent's starting throw / command grab can still catch me (+ margin)"""
        if okind == "cmdgrab":
            return (self.g.get("opGrab") or {}).get(name, self.touch + 1.0) + 0.25
        return self.touch + 0.9

    def wall_behind(self, me, op, m):
        """my root within 1.1 m of the ring wall with the opponent inward of me (MatchSnap.ring: circle radius / poly apothem)"""
        rg = (m or {}).get("ring") or {}
        c = rg.get("centre")
        if not c or not rg.get("radius"):
            return False
        mx, mz = me["x"] - c[0], (me.get("z") or 0.0) - c[1]
        ox, oz = op["x"] - c[0], (op.get("z") or 0.0) - c[1]
        rme = math.sqrt(mx * mx + mz * mz)
        rop = math.sqrt(ox * ox + oz * oz)
        return rme > rg["radius"] - 1.1 and rop < rme - 0.3

    def keys(self, f, m):
        """the set of P1 keys to hold for the next step (K names -> Playwright codes)"""
        me, op = f[0], f[1]
        mode = (m or {}).get("mode")
        if mode in ("brawl", "heckler"):
            return self.bonus_keys(f, m)
        if (m or {}).get("phase") != "fight":
            self.circle = 0
            return set()
        self.n += 1
        self.phase ^= 1
        # CHANGED(AI3D): planar distance; forward / back from P1's facing sign (the sim's LEFT / RIGHT mapping)
        d = _dist(me, op)
        fk, bk = fwd_back(f)
        st, ost = me.get("stateName"), op.get("stateName")
        if self.step_cool > 0:
            self.step_cool -= 1
        if self.circle_cool > 0:
            self.circle_cool -= 1
        act = bool(me.get("actionable"))
        # thrown: tech (a throw press while the tech window is open)
        if st == "thrown":
            self.circle = 0
            return {K["throw"]} if self.phase else set()
        if st in HIT_STATES:
            self.circle = 0
            return {bk, K["down"]}
        mv = self.omove(op.get("moveName") or "")
        okind = op.get("moveKind") or ""
        of = op.get("moveFrame") or 0
        su = int(mv.get("startup") or 0)
        ac = int(mv.get("active") or 0)
        strike = ost == "attack" and okind not in ("throw", "cmdgrab", "system", "")
        incoming = strike and of <= su + ac + 1 and d < 3.2
        grabbing = ost == "attack" and okind in ("throw", "cmdgrab") and of <= su
        # 3D: a circle-walk in progress keeps the STEP key held; an incoming strike / grab cancels it (back = guard)
        if self.circle > 0:
            self.circle -= 1
            if incoming or grabbing:
                self.circle = 0
            else:
                return {self.circle_key}
        # an incoming throw / command grab within ITS reach: buffer a throw (techs a throw; a command grab: jump away)
        if grabbing and d < self.grab_threat(op.get("moveName") or "", okind):
            if okind == "cmdgrab":
                return {K["up"], bk}
            return {K["throw"]}
        # 3D read: a straight (non-homing) strike seen early -> sidestep tap, about half the time
        if (strike and act and self.step_cool == 0 and of <= 4 and su >= 10 and not mv.get("homing") and d < 3.0
                and (self.n * 37) % 100 < 55):
            self.step_cool = 20
            self.punish = 30
            self.stats["stepReads"] += 1
            return {K["stepin"]} if (self.n // 7) % 2 else {K["stepout"]}
        # after a read step: its recovery within 5H reach -> side punish
        if self.punish > 0:
            self.punish -= 1
            if act and ost == "attack" and su > 0 and of > su + ac and d <= self.side_d:
                self.punish = 0
                self.stats["sidePunish"] += 1
                return {K["h"]}
        # an incoming strike: guard low unless it is an overhead or airborne
        if incoming:
            over = (mv.get("guard") == "H") or op.get("airborne")
            return {bk} if over else {bk, K["down"]}
        # projectiles flying at me
        for p in (m or {}).get("proj") or []:
            if p.get("owner") == 1 and p.get("kind") in (0, 1):
                # CHANGED(AI3D): approaching in the plane (closing velocity) and near
                rx, rz = me["x"] - p["x"], (me.get("z") or 0.0) - (p.get("z") or 0.0)
                toward = rx * (p.get("vx") or 0) + rz * (p.get("vz") or 0) > 0
                if toward and math.sqrt(rx * rx + rz * rz) < 2.6:
                    return {bk, K["down"]}
        # a jump coming in: SIMPLE 2S (down + S) anti-air
        if op.get("airborne") and ost in ("air", "prejump") and d < self.aa_d:
            return {K["down"], K["s"]} if self.phase else {K["down"]}
        if not act:
            return set()
        # the opponent recovering / whiffed / landing within reach: super (1+ bar) or the ASSIST route
        recovering = (ost == "attack" and su > 0 and of > su + ac - 1) or ost in ("land", "recover", "parry_rec", "dash_b")
        if recovering and d <= self.punish_d:
            sh = me.get("showtime") or 0
            if sh >= 30000 and d <= self.sup3_d:
                return {K["down"], K["s"], K["h"]}
            if sh >= 10000 and d <= self.sup1_d:
                return {K["s"], K["h"]}
            return {K["assist"], K["l"]} if self.phase else {K["assist"]}
        if ost == "knockdown":
            return {fk} if d > self.touch + 0.35 else {bk, K["down"]}
        # 3D: from neutral, a circle-walk off the wall behind me, or now and then at mid range
        if st in FREE_STATES and self.circle_cool == 0:
            wall = self.wall_behind(me, op, m)
            if wall or (self.mid_lo < d < self.mid_hi and self.n % 120 == 60):
                self.circle = 25 + self.n % 16
                self.circle_key = K["stepout"] if (self.n // 3) % 2 else K["stepin"]
                self.circle_cool = 90
                self.stats["wallCircles" if wall else "circles"] += 1
                return {self.circle_key}
        if d > self.close_d:
            return {fk}
        # close and neutral: mostly the ASSIST route, some throws, some guarding
        t = int(me.get("x", 0) * 97 + (m or {}).get("frame", 0)) % 10
        # CHANGED(AI3D): now and then a sidestep tap from neutral (STEP_IN / STEP_OUT alternate)
        if t == 9 and st in FREE_STATES and d > self.touch + 0.3:
            return {K["stepin"]} if (self.n // 2) % 2 == 0 else {K["stepout"]}
        if t < 5:
            return {K["assist"], K["l"]} if self.phase else {K["assist"]}
        if t < 7 and d <= self.throw_d:
            return {K["throw"]} if self.phase else set()
        return {bk, K["down"]}

    def bonus_keys(self, f, m):
        me = f[0]
        br = (m or {}).get("brawl") or {}
        self.phase ^= 1
        if br.get("mode") == "heckler":
            near = [p for p in ((m or {}).get("proj") or []) if p.get("kind") == 2 and planar(p, me) < 1.3]
            return {K["parry"]} if near else set()
        goons = [g for g in (br.get("goons") or []) if not g.get("down")]
        if not goons:
            return set()
        # CHANGED(AI3D) (CONTRACT §35.8): goons come from every bearing - the locked goon (BrawlSnap.target, else the
        # nearest by planar distance); the sim walks P1 along the line to it, so "toward it" = forward (P1's facing)
        tgt = br.get("target")
        g = next((q for q in goons if q.get("slot") == tgt), None) or min(goons, key=lambda q: planar(q, me))
        toward = K["right"] if (me.get("facing") or 1) >= 0 else K["left"]
        if planar(g, me) > 0.9:
            return {toward}
        return {K["l"]} if self.phase else {K["m"]}


def season_bout(P, S, args, tag, report, slot_kind, help_pct=0):
    """one bout (or bonus round) of THE SEASON, played by the SeasonBot through real keys; returns a summary dict.
    CHANGED(integrator) 3D: help_pct > 0 = DEV ASSIST (said in every report line): at each round's FIGHT the CPU's hp is set to
    help_pct % of its max through __HP__.dev.setHp (the G6 dev.setMeter precedent) - only for a slot the bot already lost
    `--slot-help` times (THE FREAK wall, CONTRACT §35.19)."""
    s = P.s
    helped_rounds = []
    mi = P.m()
    p = mi.get("p") or [{}, {}]
    me_id, opp_id = p[0].get("fighter"), p[1].get("fighter")
    bot = SeasonBot(me_id, opp_id if mi.get("mode") not in ("brawl", "heckler") else None)
    stepped = not args.realtime
    if stepped:
        ok, v = s.hp("dev.freeze", True)
        report.setdefault("timeControl", []).append({"bout": tag, "freeze": ok, "detail": v})
    t0 = time.time()
    frames = 0
    phase_seen = False
    last_keys = set()
    snap = {}
    n_dec = 0
    budget = args.season_bout_budget
    while time.time() - t0 < budget:
        r = s.safe_js(STEP_JS, args.step_frames if stepped else 0) or {}
        f, m, stt = r.get("f"), r.get("m") or {}, r.get("st") or {}
        if stt.get("phase") in ("results", "menu") and not stt.get("bout"):
            break
        if not f:
            time.sleep(0.05)
            continue
        snap = m
        frames = m.get("frame") or frames
        if m.get("phase") == "matchEnd":
            s.hold(set())
            break
        if help_pct > 0 and m.get("phase") == "fight" and m.get("round") not in helped_rounds and m.get("mode") == "arcade":
            hmax = (f[1] or {}).get("hpMax") or 0
            if hmax:
                s.hp("dev.setHp", 1, int(hmax * help_pct / 100))
                helped_rounds.append(m.get("round"))
        want = bot.keys(f, m)
        if want != last_keys:
            s.hold(want)
            last_keys = want
        n_dec += 1
        if not stepped:
            time.sleep(0.016)
        if n_dec % 60 == 0:
            for e in P.new_events():
                if e.get("typeName") == "PHASE" and e.get("a") == 1:
                    phase_seen = True
    s.hold(set())
    for e in P.new_events():
        if e.get("typeName") == "PHASE" and e.get("a") == 1:
            phase_seen = True
    if any(e.get("typeName") == "PHASE" and e.get("a") == 1 for e in P.log):
        phase_seen = True
    if stepped:
        s.hp("dev.freeze", False)
    br = snap.get("brawl") or {}
    return {"tag": tag, "kind": slot_kind, "mode": snap.get("mode"), "p1": me_id, "p2": opp_id, "cpu": p[1].get("cpu"),
            "winner": snap.get("winner"), "wins": snap.get("wins"), "frames": frames, "seconds": round(time.time() - t0, 1),
            "decisions": n_dec, "score": br.get("score"), "phaseEvent": phase_seen, "matchEnd": snap.get("phase") == "matchEnd",
            "devHelp": {"cpuHpPct": help_pct, "rounds": helped_rounds} if help_pct > 0 else None,
            # CHANGED(wf7 season bot): the bot's 3D counters + the ranges it fought with
            "bot": dict(bot.stats), "botRanges": bot.ranges()}


# ─────────────────────────────── boss re-measure (CHANGED(wf7 season bot)) ───────────────────────────────
# python _harness/playtest.py --bosses --fighter johnny --bouts freak:5:butcher_block,ricky:6:control_room --seeds 1,2,3
#
# The SeasonBot (real key events, P1 SIMPLE) vs a CPU in THE SEASON's staging - mode 'arcade' on the opponent's home stage,
# the slot's CPU level, the game's own CPU seed (game.ts: cfg.seed ^ 0x9e3779b9 x (p + 1)) - set up through __HP__.dev.startMatch
# (a dev hook for the STATION only: the bout itself is real keys sampled by the game's tick). The sim is frozen right after the
# bout loads, stepped to the round's first FIGHT frame, then 2 frames per decision exactly like the season run. Each bout is
# replayed headless by `node _harness/probe_balance.ts --botbouts` (the SeasonBot mirror) and the two results compared:
# IDENTICAL means the headless tables (probe_balance --player seasonbot) ARE real-key numbers. Report playtest_bosses.json.
STEP_TO_FIGHT_JS = """(max) => { const h = window.__HP__; let n = 0; let m = h.match();
  while (n < max && (!m || m.phase !== 'fight')) { h.dev.step(1); n++; m = h.match(); }
  let f = null; try { f = h.fighters(); } catch (e) {} return { n, f, m, st: h.state() }; }"""


def boss_bout(sess, args, me, opp, level, stage, seed):
    cfg = {"mode": "arcade", "stage": stage, "seed": seed,
           "p": [{"fighter": me, "color": 0, "scheme": 0, "cpu": -1}, {"fighter": opp, "color": 1 if opp == me else 0, "scheme": 0, "cpu": level}]}
    t0 = time.time()
    ok, v = sess.hp("dev.startMatch", cfg)
    if not ok:
        return {"error": "dev.startMatch failed: %s" % v}
    m0 = {}
    while time.time() - t0 < 180:
        stt = sess.state() or {}
        m0 = sess.safe_js("() => { try { return __HP__.match(); } catch (e) { return null; } }") or {}
        if stt.get("phase") == "bout" and m0.get("seed") == seed and m0.get("mode") == "arcade" and (m0.get("frame") or 0) < 2000:
            break
        time.sleep(0.05)
    else:
        return {"error": "the bout never loaded (phase %r, match seed %r)" % ((sess.state() or {}).get("phase"), m0.get("seed"))}
    sess.hp("dev.freeze", True)
    m0 = sess.safe_js("() => __HP__.match()") or {}
    aligned = m0.get("phase") != "fight"
    r = sess.safe_js(STEP_TO_FIGHT_JS, 1200) or {}
    f, m = r.get("f"), r.get("m") or {}
    bot = SeasonBot(me, opp)
    held = set()
    n_dec = 0
    ends = []
    last_ph = m.get("phase")
    while f and m.get("phase") != "matchEnd" and time.time() - t0 < args.season_bout_budget:
        want = bot.keys(f, m)
        if want != held:
            sess.hold(want)
            held = want
        n_dec += 1
        r = sess.safe_js(STEP_JS, 2) or {}
        f2, m2 = r.get("f"), r.get("m") or {}
        if not f2:
            time.sleep(0.05)
            continue
        f, m = f2, m2
        if m.get("phase") != last_ph and m.get("phase") in ("ko", "timeover"):
            ends.append(m.get("phase"))
        last_ph = m.get("phase")
    sess.hold(set())
    return {"me": me, "opp": opp, "level": level, "stage": stage, "seed": seed, "winner": m.get("winner"), "wins": m.get("wins"),
            "frames": m.get("frame"), "hp": [max(0, (f or [{}, {}])[k].get("hp") or 0) for k in (0, 1)], "roundEnds": ends,
            "matchEnd": m.get("phase") == "matchEnd", "alignedToFight": aligned, "decisions": n_dec, "seconds": round(time.time() - t0, 1),
            "bot": dict(bot.stats), "botRanges": bot.ranges()}


def headless_botbouts(me, opp, level, stage, seeds):
    """the same bouts through the headless SeasonBot mirror (probe_balance.ts --botbouts); {seed: result}"""
    import shutil
    import subprocess
    node = shutil.which("node")
    if not node:
        return {}
    env = dict(os.environ, NODE_NO_WARNINGS="1", FORCE_COLOR="0")
    r = subprocess.run([node, os.path.join(SEASON_ROOT, "_harness", "probe_balance.ts"), "--botbouts", me, opp, str(level), stage, ",".join(str(x) for x in seeds)],
                       cwd=SEASON_ROOT, capture_output=True, text=True, encoding="utf-8", timeout=900, env=env)
    out = {}
    for ln in (r.stdout or "").splitlines():
        if ln.startswith("{"):
            j = json.loads(ln)
            out[j["seed"]] = j
    return out


def run_bosses(args) -> int:
    report = {"headless": args.headless, "mode": "bosses", "fighter": args.fighter, "bouts": [], "keys": "real key events (P1 SIMPLE), "
              "sim frozen + stepped 2 frames per decision from the first FIGHT frame; station via __HP__.dev.startMatch"}
    others, _ = preflight_chromes("pre-flight")
    report["otherAutomatedChrome"] = others
    seeds = [int(x) for x in args.seeds.split(",") if x.strip()]
    specs = []
    for b in args.bouts.split(","):
        opp, lv, st = b.split(":")
        specs.append((opp, int(lv), st))
    sess = Session(args, "playtest_bosses")
    try:
        sess.start()
    except Exception as e:
        sess.close()
        print("SETUP FAILED: %s" % (str(e) if isinstance(e, HarnessError) else repr(e)))
        return 2
    fatal = None
    try:
        sess.goto(build_url(args.base, dev=1))
        if not sess.wait_hp(args.wait):
            fatal = "window.__HP__ never appeared"
        else:
            sess.wait_phase("title", args.wait)
        for opp, lv, st in ([] if fatal else specs):
            for sd in seeds:
                res = boss_bout(sess, args, args.fighter, opp, lv, st, sd)
                report["bouts"].append(res)
                print("bout         : %s" % json.dumps(res, default=str), flush=True)
                save_report("playtest_bosses" + (("_" + args.tag) if args.tag else ""), report, args.base)
    finally:
        diag = sess.diagnostics() if sess.page else {}
        try:
            sess.release_all()
        except Exception:
            pass
        sess.close()
    # the headless mirror on the same bouts
    same = 0
    cmp_n = 0
    for opp, lv, st in specs:
        hb = headless_botbouts(args.fighter, opp, lv, st, seeds)
        for res in report["bouts"]:
            if res.get("opp") != opp or res.get("stage") != st or res.get("level") != lv:
                continue
            h = hb.get(res.get("seed"))
            if not h:
                continue
            hh = [max(0, x) for x in h.get("hp") or [0, 0]]
            # the real-key loop steps 2 frames per call, so its last read can land 1 frame past MATCH_END (the headless runner
            # stops ON it): frames may differ by <= 1 - winner, rounds and both hp must be exactly equal
            fd = (res.get("frames") or 0) - (h.get("frames") or 0)
            ident = h.get("winner") == res.get("winner") and h.get("wins") == res.get("wins") and 0 <= fd <= 1 and hh == res.get("hp")
            res["headless"] = {"winner": h.get("winner"), "wins": h.get("wins"), "frames": h.get("frames"), "hp": hh, "identical": ident, "frameDiff": fd}
            if res.get("alignedToFight"):
                cmp_n += 1
                same += 1 if ident else 0
    print("=" * 84)
    for opp, lv, st in specs:
        bs = [b for b in report["bouts"] if b.get("opp") == opp and b.get("level") == lv and b.get("stage") == st and "error" not in b]
        w = sum(1 for b in bs if b.get("winner") == 0)
        rw = sum((b.get("wins") or [0, 0])[0] for b in bs)
        rl = sum((b.get("wins") or [0, 0])[1] for b in bs)
        hpl = [b["hp"][0] for b in bs if b.get("winner") == 0]
        print("%-8s vs %-8s L%d %-14s real keys: bouts won %d / %d, rounds %d - %d, P1 hp left when won %s" % (args.fighter, opp, lv, st, w, len(bs), rw, rl, hpl))
        for b in bs:
            h = b.get("headless") or {}
            print("    seed %-5s winner %s wins %s frames %s hp %s | headless winner %s wins %s frames %s hp %s -> %s%s" % (
                b.get("seed"), b.get("winner"), b.get("wins"), b.get("frames"), b.get("hp"), h.get("winner"), h.get("wins"), h.get("frames"), h.get("hp"),
                ("IDENTICAL" + (" (end read +%d f)" % h.get("frameDiff") if h.get("frameDiff") else "")) if h.get("identical") else "DIFFERENT",
                "" if b.get("alignedToFight") else " (not aligned: frozen after FIGHT began)"))
    print("-" * 84)
    print_diagnostics(diag)
    dp = diag_problems(diag)
    report.update({"diagnostics": diag, "fatal": fatal, "headlessIdentical": [same, cmp_n]})
    print("headless mirror: %d / %d aligned bouts IDENTICAL (winner, rounds, both hp exact; end frame within the 2-frame step)" % (same, cmp_n))
    errs = [b for b in report["bouts"] if "error" in b]
    for e in errs:
        print("   X %s" % e["error"])
    for p in dp:
        print("   X %s" % p)
    if fatal:
        print("FATAL        : %s" % fatal)
    print("report       : %s" % save_report("playtest_bosses" + (("_" + args.tag) if args.tag else ""), report, args.base))
    ok = not fatal and not errs and not dp
    print("RESULT: %s" % ("OK" if ok else "FAIL"))
    return 0 if ok else 1


def run_season(args) -> int:
    S = Steps()
    report = {"headless": args.headless, "mode": "season", "length": args.length, "fighter": args.fighter,
              "difficulty": args.difficulty, "timeControl": [], "slots": []}
    fatal = None
    ladder = _load_json("data", "ladder.json")
    specs = ladder.get(args.length) or []
    report["ladderKinds"] = [x.get("kind") for x in specs]
    others, _ = preflight_chromes("pre-flight")
    report["otherAutomatedChrome"] = others
    sess = Session(args, "playtest_season")
    try:
        sess.start()
    except Exception as e:
        sess.close()
        print("SETUP FAILED: %s" % (str(e) if isinstance(e, HarnessError) else repr(e)))
        print("RESULT: FAIL")
        return 2
    P = Player(sess, args.out_dir)

    def shot(name):
        return sess.screenshot(os.path.join(args.out_dir, "pts_%s%s.png" % ((args.tag + "_") if args.tag else "", name)))

    bouts_played = 0
    bonus_played = []
    boss_phase = None
    try:
        url = build_url(args.base, dev=1)
        report["url"] = url
        sess.goto(url)
        if not sess.wait_hp(args.wait):
            fatal = "window.__HP__ never appeared"
        if not fatal:
            ok, ph = sess.wait_phase("title", args.wait)
            S.check("boot_title", ok and P.wait_screen("title", 10), "phase=%s screen=%s" % (ph, P.menus().get("screen")))
            shot("title")
            if not ok:
                fatal = "never reached the title (phase %r)" % ph
        if not fatal:
            P.key("Enter")
            S.check("main_menu", P.wait_screen("main"), "focus=%s" % P.menus().get("focus"))
            S.check("focus_season", P.focus_to("hpm-main-season"), "focus=%s" % P.menus().get("focus"))
            P.key("Enter")
            ok = P.wait_screen("season")
            S.check("season_setup", ok)
            if not ok:
                fatal = "THE SEASON setup never opened"
        if not fatal:
            P.focus_to("hpm-season-length-%s" % args.length)
            P.key("Enter")
            P.focus_to("hpm-season-diff-%d" % args.difficulty)
            P.key("Enter")
            fl = P.menus().get("flow", {})
            S.check("season_length", fl.get("length") == args.length and fl.get("difficulty") == args.difficulty,
                    "flow length=%s difficulty=%s" % (fl.get("length"), fl.get("difficulty")))
            shot("setup")
            S.check("focus_go", P.focus_to("hpm-season-go"))
            P.key("Enter")
            ok = P.wait_screen("charselect")
            S.check("charselect", ok)
            if not ok:
                fatal = "character select never opened"
        if not fatal:
            time.sleep(0.6)
            # CHANGED(wf7 season bot): LEFT / RIGHT wrap inside one ROW of the grid (ui/charselect.ts move()), so a fighter on
            # another row was never reached - "--fighter boneyard" played zambini (wf7sb_season_boneyard.log): walk each row
            # (ArrowRight x 10), then ArrowDown to the next
            cur = None
            for _row in range(6):
                for _ in range(10):
                    cur = ((P.menus().get("cs", {}).get("p") or [{}])[0]).get("cursor")
                    if cur == args.fighter:
                        break
                    P.key("ArrowRight", gap=0.08)
                if cur == args.fighter:
                    break
                P.key("ArrowDown", gap=0.08)
            cur0 = ((P.menus().get("cs", {}).get("p") or [{}])[0]).get("cursor")
            shot("charselect")
            P.key("Enter", 3, gap=0.25)     # fighter, colour, controls (SIMPLE is the first choice)
            S.check("p1_fighter", cur0 == args.fighter, "cursor=%s" % cur0)
        # ---------------------------------------------------------------- the ladder, slot by slot
        seen_index = -1
        continues = 0
        slot_losses = {}
        guard = 0
        while not fatal and guard < args.max_slots:
            guard += 1
            t_wait = time.time()
            screen = None
            while time.time() - t_wait < 60:
                mm = P.menus()
                stt = sess.state() or {}
                screen = mm.get("screen") if mm.get("visible") else None
                if stt.get("phase") == "bout" or screen in ("ladder", "card", "vs", "nameentry", "ending", "title"):
                    break
                time.sleep(0.1)
            stt = sess.state() or {}
            season = stt.get("season") or {}
            if screen in ("nameentry", "ending", "title") and stt.get("phase") != "bout":
                break
            idx = season.get("index", -1)
            # bonus slots the game passed over without a bout
            if isinstance(idx, int) and idx > seen_index + 1:
                for k in range(seen_index + 1, idx):
                    kind = specs[k].get("kind") if k < len(specs) else "?"
                    if kind in ("brawl", "heckler"):
                        bonus_played.append({"slot": k, "kind": kind, "played": False})
                        report["slots"].append({"slot": k, "kind": kind, "skipped": True})
            spec = specs[idx] if isinstance(idx, int) and 0 <= idx < len(specs) else {}
            kind = spec.get("kind", "?")
            if screen == "ladder":
                shot("ladder_%d" % idx)
                S.check("ladder_%d" % idx, season.get("slots") == len(specs), "season index=%s slots=%s (ladder.json %s: %d)" % (idx, season.get("slots"), args.length, len(specs)))
                P.key("Enter")
                time.sleep(0.5)
                if kind in ("rival", "miniboss", "boss", "brawl", "heckler"):
                    okc = P.wait_screen("card", 6)
                    S.check("card_%d_%s" % (idx, kind), okc, "screen=%s" % P.menus().get("screen"))
                    if okc:
                        time.sleep(0.4)
                        shot("card_%d_%s" % (idx, kind))
                        P.key("Enter")
            okb, ph = sess.wait_phase("bout", 90)
            if not okb:
                fatal = "slot %s (%s): the bout never started (phase %r, screen %r)" % (idx, kind, ph, P.menus().get("screen"))
                break
            mi = P.m()
            p = mi.get("p") or [{}, {}]
            want_mode = {"brawl": "brawl", "heckler": "heckler"}.get(kind, "arcade")
            want_lv = (spec.get("level", 0) + (args.difficulty - 1) * 2) if want_mode == "arcade" else 0
            want_lv = max(0, min(8, want_lv))
            want_opp = spec.get("opponent")
            opp_ok = (want_opp is None or p[1].get("fighter") == want_opp) and p[1].get("fighter") != (args.fighter if kind == "bout" else None)
            S.check("slot_%d_%s_staged" % (idx, kind), mi.get("mode") == want_mode and (want_mode != "arcade" or p[1].get("cpu") == want_lv) and opp_ok
                    and p[0].get("cpu") == -1 and p[0].get("fighter") == args.fighter,
                    "mode=%s p1=%s p2=%s cpu=%s (want mode %s level %s opponent %s)" % (mi.get("mode"), p[0].get("fighter"), p[1].get("fighter"), p[1].get("cpu"), want_mode, want_lv, want_opp or "random"))
            okf, _ = wait_match_phase(sess, ("intro", "fight"), 20)
            notes = []
            wait_warm(sess, notes, "slot %s" % idx)
            shot("bout_%d" % idx)
            P.new_events()
            # CHANGED(integrator) 3D: DEV ASSIST only after --slot-help losses on THIS slot (off by default; said in the report)
            hp_help = args.help_hp_pct if args.slot_help and slot_losses.get(idx, 0) >= args.slot_help and want_mode == "arcade" else 0
            res = season_bout(P, S, args, "slot%d" % idx, report, kind, hp_help)
            res["slot"] = idx
            if hp_help:
                report.setdefault("devAssist", []).append({"slot": idx, "kind": kind, "afterLosses": slot_losses.get(idx, 0), "cpuHpPct": hp_help,
                                                           "rounds": (res.get("devHelp") or {}).get("rounds"), "winner": res.get("winner")})
            report["slots"].append(res)
            bouts_played += 1
            if want_mode != "arcade":
                bonus_played.append({"slot": idx, "kind": kind, "played": True, "score": res.get("score")})
            if kind == "boss":
                boss_phase = res.get("phaseEvent")
            ok, ph = sess.wait_phase("results", 25)
            okr = ok and P.wait_screen("results", 10)
            lost = res.get("winner") != 0 and want_mode == "arcade"
            # CHANGED(integrator) 3D: a LOST bout shows the CONTINUE card, whose countdown runs in REAL seconds
            # (ui/results.ts CONTINUE_SECONDS 10; time-out = END THE SEASON -> main menu). The P2 run read the card, slept,
            # took a screenshot under load and pressed CONTINUE > 10 s later: the season had ended and the harness died on
            # the main menu (FATAL "slot -1 ... the bout never started"). Now: on a loss the card is read and CONTINUE is
            # pressed at once (the shot only while >= 5 s remain), then the SAME slot must come back on the ladder.
            time.sleep(0.1 if lost else 0.6)
            rb = P.menus().get("result") or {}
            cd0 = rb.get("countdown")
            # a lost bout: NO screenshot before CONTINUE (one CDP capture under load took ~6 s: run 1 pressed at "4" of 10);
            # the card's read-back (winner, continue, countdown) is the evidence, the ladder it returns to is shot below
            if not lost:
                shot("results_%d" % idx)
            S.check("slot_%d_results" % idx, okr and res.get("matchEnd") and rb.get("winner") == res.get("winner"),
                    "results card winner=%s sim winner=%s wins=%s score=%s %.0f s %d decisions%s%s" % (rb.get("winner"), res.get("winner"), res.get("wins"), res.get("score"),
                    res.get("seconds") or 0, res.get("decisions") or 0, (" continue card %s, countdown %s" % (rb.get("continue"), cd0)) if lost else "",
                    (" DEV-ASSISTED (CPU hp set to %d %% at FIGHT of rounds %s)" % (hp_help, (res.get("devHelp") or {}).get("rounds"))) if hp_help else ""))
            seen_index = idx
            if args.max_bouts and bouts_played >= args.max_bouts:
                break
            if lost:
                continues += 1
                slot_losses[idx] = slot_losses.get(idx, 0) + 1
                seen_index = idx - 1         # the same slot comes again
                cd1 = (P.menus().get("result") or {}).get("countdown")
                P.key("Enter")               # CONTINUE (the default button)
                t_c = time.time()
                back = None
                while time.time() - t_c < 15:
                    mm = P.menus()
                    scr = mm.get("screen") if mm.get("visible") else None
                    if scr in ("ladder", "card", "vs") or (sess.state() or {}).get("phase") == "bout":
                        back = scr or "bout"
                        break
                    if scr in ("main", "title"):
                        back = scr
                        break
                    time.sleep(0.1)
                idx2 = ((sess.state() or {}).get("season") or {}).get("index")
                okc = back in ("ladder", "card", "vs", "bout") and idx2 == idx
                if okc:
                    shot("continue_%d_%d" % (idx, continues))
                S.check("slot_%d_continue_%d" % (idx, continues), okc,
                        "lost the bout -> CONTINUE pressed with the countdown at %s (card showed %s): back on %s, season index %s (want %s)"
                        % (cd1, cd0, back, idx2, idx))
                report.setdefault("continueLog", []).append({"slot": idx, "countdownAtPress": cd1, "back": back, "index": idx2})
                if not okc:
                    fatal = "slot %s: CONTINUE after a lost bout did not bring the slot back (screen %r, season index %r)" % (idx, back, idx2)
                    break
                continue
            P.key("Enter")                   # NEXT EPISODE (the default button)
            time.sleep(0.5)
        report["continues"] = continues
        # ---------------------------------------------------------------- the ending
        if not fatal and not args.max_bouts:
            bon = [b for b in bonus_played if b["kind"] in ("brawl", "heckler")]
            S.check("bonus_round_played", any(b.get("played") and (b.get("score") or 0) > 0 for b in bon),
                    "bonus slots: %s%s" % (bon, "" if any(b.get("played") for b in bon) else " - game.ts passed over it (BONUS_ROUNDS_IN_SIM = false, SHELL)"))
            S.check("boss_phase2", boss_phase is True, "PHASE event from RICKY during the boss bout: %s" % boss_phase)
            okn = P.wait_screen("nameentry", 20)
            S.check("name_entry", okn, "screen=%s" % P.menus().get("screen"))
            if okn:
                shot("nameentry")
                for k in ("KeyA", "KeyI", "KeyP"):
                    P.key(k)
                P.key("Enter")
            oke = P.wait_screen("ending", 12)
            cards = []
            if oke:
                for _ in range(14):
                    time.sleep(0.6)
                    mm = P.menus()
                    if mm.get("screen") != "ending":
                        break
                    cards.append(mm.get("ending"))
                    if len(cards) == 1:
                        shot("ending")
                    P.key("Enter")
            S.check("ending_sequence", oke and len(cards) >= 3 and cards[0] == "finale", "cards=%s" % cards)
            S.check("title_after_ending", P.wait_screen("title", 12), "screen=%s" % P.menus().get("screen"))
    finally:
        tl = sess.timeline() if sess.page else []
        diag = sess.diagnostics() if sess.page else {}
        try:
            sess.release_all()
        except Exception:
            pass
        sess.close()
    print("=" * 84)
    for r in report["slots"]:
        print("slot         : %s" % json.dumps(r, default=str))
    print("-" * 84)
    print_diagnostics(diag)
    print("=" * 84)
    problems = [s for s in S.failed]
    dp = diag_problems(diag)
    report.update({"steps": S.items, "diagnostics": diag, "fatal": fatal, "timeline": tl[-20:], "boutsPlayed": bouts_played,
                   "stepped": not args.realtime, "stepFrames": args.step_frames, "smoke": bool(args.max_bouts),
                   "events": [{k: e.get(k) for k in ("frame", "typeName", "a", "b", "c", "d")} for e in P.log[-300:]]})
    ok = not fatal and not problems and not dp
    report["verdict"] = "PASS" if ok else "FAIL"
    for s in problems:
        print("   X step %s: %s" % (s["step"], s["detail"] if isinstance(s["detail"], str) else json.dumps(s["detail"], default=str)))
    for p in dp:
        print("   X %s" % p)
    if fatal:
        print("FATAL        : %s" % fatal)
    if report.get("devAssist"):
        print("DEV ASSIST   : %s (CPU hp set by __HP__.dev.setHp after %d losses on a slot - NOT an unassisted clear)" % (json.dumps(report["devAssist"]), args.slot_help))
    print("time control : %s" % ("REAL-TIME (no stepping)" if args.realtime else "sim frozen + stepped %d frames per key decision (__HP__.dev.freeze / dev.step); keys = real key events" % args.step_frames))
    print("report       : %s" % save_report("playtest_season" + (("_" + args.tag) if args.tag else ""), report, args.base))
    print("steps        : %d passed, %d failed%s" % (len(S.items) - len(problems), len(problems), " (SMOKE: first %d bout(s) only)" % args.max_bouts if args.max_bouts else ""))
    print("RESULT: %s" % ("OK" if ok else "FAIL"))
    if fatal:
        return 2
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(description="HIT PARADE playtest (gate G6; --season = gate G11 browser half)")
    add_common_args(ap)
    ap.add_argument("--wait", type=float, default=90.0)
    ap.add_argument("--bout-budget", type=float, default=420.0, help="seconds for the whole bout (default 420)")
    ap.add_argument("--no-meter-help", action="store_true", help="never fill SHOWTIME with dev.setMeter for the super check")
    ap.add_argument("--out-dir", default=SHOTS)
    # CHANGED(AI) P2: THE SEASON run (G11)
    ap.add_argument("--season", action="store_true", help="G11: play THE SEASON ladder to the ending card by real keys")
    ap.add_argument("--length", choices=("pilot", "season"), default="pilot")
    ap.add_argument("--fighter", default="johnny")
    ap.add_argument("--difficulty", type=int, choices=(0, 1, 2), default=1, help="menu index: 0 EASY, 1 NORMAL, 2 HARD")
    ap.add_argument("--max-bouts", type=int, default=0, help="stop after this many bouts (smoke); 0 = the whole ladder")
    ap.add_argument("--max-slots", type=int, default=40, help="safety cap on slot attempts incl. continues")
    ap.add_argument("--step-frames", type=int, default=2, help="sim frames per key decision while stepping")
    ap.add_argument("--realtime", action="store_true", help="no sim stepping (real-time bot, weak)")
    ap.add_argument("--season-bout-budget", type=float, default=900.0, help="seconds per season bout (default 900)")
    # CHANGED(integrator) 3D: an explicit, reported DEV ASSIST for a slot the scripted bot cannot clear (THE FREAK wall, §35.19)
    ap.add_argument("--slot-help", type=int, default=0, help="after this many losses on one slot, set the CPU's hp to --help-hp-pct at each round's FIGHT (0 = off)")
    ap.add_argument("--help-hp-pct", type=int, default=35, help="CPU hp %% for --slot-help (default 35)")
    # CHANGED(wf7 season bot): boss re-measure - SeasonBot real-key bouts in SEASON staging + the headless mirror's replay
    ap.add_argument("--bosses", action="store_true", help="SeasonBot vs --bouts in arcade staging (real keys), compared with probe_balance --botbouts")
    ap.add_argument("--bouts", default="freak:5:butcher_block,ricky:6:control_room", help="opp:level:stage,... for --bosses")
    ap.add_argument("--seeds", default="1,2,3", help="match seeds for --bosses")
    ap.add_argument("--tag", default="", help="suffix for the --season / --bosses report name and the season shots (parallel runs)")
    args = ap.parse_args()
    if args.bosses:
        return run_bosses(args)
    if args.season:
        return run_season(args)
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
