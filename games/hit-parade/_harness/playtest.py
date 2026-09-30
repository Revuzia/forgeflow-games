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
  5. the bout, real keys only: walk (D/A), jab (J), special (I), throw (H), parry (hold O into the CPU's attack),
     IMPACT (P), super (I+L = SIMPLE S+H) once SHOWTIME >= 1 bar; then fight to the finish (walk in, ASSIST auto-combo
     U + J taps, throws, block by holding back when the CPU attacks). HUD read-back checked during the bout: HP bars
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
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (SHOTS, HarnessError, Session, add_common_args, build_url, diag_problems, events_tail,  # noqa: E402
                    fighters_info, match_info, preflight_chromes, print_diagnostics, save_report, wait_match_phase, wait_warm)

K = {"up": "KeyW", "down": "KeyS", "left": "KeyA", "right": "KeyD", "l": "KeyJ", "m": "KeyK", "h": "KeyL", "s": "KeyI",
     "assist": "KeyU", "throw": "KeyH", "parry": "KeyO", "impact": "KeyP", "pause": "Escape"}

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
    """(forward key, back key) for P1 from the fighters' x"""
    if (f[1]["x"] - f[0]["x"]) >= 0:
        return K["right"], K["left"]
    return K["left"], K["right"]


def by(evs, names, a=None, b=None, c=None):
    return [e for e in evs if e.get("typeName") in names and (a is None or e.get("a") == a) and (b is None or e.get("b") == b)
            and (c is None or e.get("c") in (c if isinstance(c, (list, tuple, set)) else (c,)))]


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
            else:
                fatal = "the bout never started (phase %r)" % ph
        # ---------------------------------------------------------------- 5. the bout
        if not fatal:
            notes = []
            wait_warm(sess, notes, "bout start")
            report["notes"] = notes
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
                au = P.audio()
                S.check("audio_results_music", au.get("cue") in ("win", "lose"), "cue=%s" % au.get("cue"))
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
            time.sleep(0.8)
            fr2 = P.m().get("simFrame")
            S.check("esc_resume", okb and isinstance(fr2, int) and isinstance(fr1, int) and fr2 > fr1, "phase=%s simFrame %s -> %s" % (ph, fr1, fr2))
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
        print("bout         : %s" % json.dumps({k: bout.get(k) for k in ("rounds", "winner", "wins", "frames", "seconds", "meterHelp", "keyPresses")}, default=str))
    print("-" * 84)
    print_diagnostics(diag)
    print("=" * 84)
    problems = [s for s in S.failed]
    dp = diag_problems(diag)
    report.update({"steps": S.items, "verbs": verbs, "diagnostics": diag, "fatal": fatal, "timeline": tl[-20:],
                   "events": [{k: e.get(k) for k in ("frame", "typeName", "a", "b", "c", "d")} for e in P.log[-400:]]})
    ok = not fatal and not problems and not dp
    report["verdict"] = "PASS" if ok else "FAIL"
    for s in problems:
        print("   X step %s: %s" % (s["step"], s["detail"] if isinstance(s["detail"], str) else json.dumps(s["detail"], default=str)))
    for p in dp:
        print("   X %s" % p)
    if fatal:
        print("FATAL        : %s" % fatal)
    print("report       : %s" % save_report("playtest", report, args.base))
    print("steps        : %d passed, %d failed" % (len(S.items) - len(problems), len(problems)))
    print("RESULT: %s" % ("OK" if ok else "FAIL"))
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

    def fight_now():
        return (P.m().get("phase") == "fight") and s.phase() == "bout"

    def evs_since(n0):
        return P.log[n0:]

    def gap_now():
        f = P.f()
        if not f:
            return None, None
        return abs(f[1]["x"] - f[0]["x"]), f

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
    g0, f0 = gap_now()
    fk, bk = fwd_back(f0)
    x0 = f0[0]["x"]
    s.hold({fk})
    time.sleep(0.6)
    f1 = P.f()
    s.hold(set())
    dxw = (f1[0]["x"] - x0) * (1 if fk == K["right"] else -1)
    mark("walk", dxw > 0.2, "real %s hold 0.6 s: P1 x %.2f -> %.2f (%.2f m forward)" % (fk, x0, f1[0]["x"], dxw))
    P.new_events()

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
    for _ in range(5):
        n0 = len(P.log)
        time.sleep(0.3)
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
    try:
        opp_id = ((P.m().get("p") or [{}, {}])[1] or {}).get("fighter")
        fd = json.load(open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "fighters", "%s.json" % opp_id), encoding="utf-8"))
        grab_moves = {k for k, mv in fd.get("moves", {}).items() if mv.get("grab") or mv.get("kind") in ("throw", "cmdgrab")}
    except Exception:
        pass
    parry_try_until = time.time() + 25.0
    while time.time() < parry_try_until and fight_now():
        g, f = gap_now()
        if g is None:
            break
        if g > 1.6:
            walk_in(1.5, 1.3)
            continue
        opp = f[1]
        attacking = ((opp.get("moveKind") or "") not in ("", "none", "system", "throw", "cmdgrab") and opp.get("moveFrame", 99) < 14
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
    last_hud = time.time()
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
        g = abs(opp["x"] - me["x"])
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
        if oatk and me.get("moveName") in (None, "", "none") and (me.get("stun") or 0) <= 0:
            s.hold({bk})
            time.sleep(0.25)
            s.hold(set())
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
           "frames": mi.get("frame"), "seconds": round(time.time() - t_start, 1), "meterHelp": meter_help, "keyPresses": presses,
           "hud": hud_checks, "audio": audio_checks}
    # ---- verdicts for the bout
    for v in ("walk", "jab", "special", "throw", "parry", "impact", "super"):
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


class SeasonBot:
    """P1 persona: frame-exact guard vs visible attacks and projectiles, throw techs, punishes whiffs / recoveries with
    the ASSIST auto-combo (hold U + tap J), supers into recoveries, SIMPLE 2S anti-airs, walks in and presses."""

    def __init__(self, me_id, opp_id):
        self.me = _load_json("data", "fighters", "%s.json" % me_id)
        self.opp_id = opp_id
        self.opp = _load_json("data", "fighters", "%s.json" % opp_id) if opp_id else {"moves": {}}
        self.phase = 0          # alternating tap state of the combo / press keys
        self.tech_armed = False

    def omove(self, name):
        return (self.opp.get("moves") or {}).get(name) or {}

    def keys(self, f, m):
        """the set of P1 keys to hold for the next step (K names -> Playwright codes)"""
        me, op = f[0], f[1]
        mode = (m or {}).get("mode")
        if mode in ("brawl", "heckler"):
            return self.bonus_keys(f, m)
        if (m or {}).get("phase") != "fight":
            return set()
        dx = op["x"] - me["x"]
        d = abs(dx)
        fk, bk = (K["right"], K["left"]) if dx >= 0 else (K["left"], K["right"])
        self.phase ^= 1
        st, ost = me.get("stateName"), op.get("stateName")
        # thrown: tech (a throw press while the tech window is open)
        if st == "thrown":
            return {K["throw"]} if self.phase else set()
        if st in ("knockdown", "hitstun", "juggle", "blockstun", "wall_splat", "crumple", "dizzy"):
            return {bk, K["down"]}
        mv = self.omove(op.get("moveName") or "")
        okind = op.get("moveKind") or ""
        of = op.get("moveFrame") or 0
        su = int(mv.get("startup") or 0)
        ac = int(mv.get("active") or 0)
        # an incoming throw / command grab: buffer a throw (techs a throw; a command grab: jump away)
        if ost == "attack" and okind in ("throw", "cmdgrab") and of <= su and d < 1.6:
            if okind == "cmdgrab":
                return {K["up"], bk}
            return {K["throw"]}
        # an incoming strike: guard low unless it is an overhead or airborne
        if ost == "attack" and okind not in ("throw", "cmdgrab", "system", "") and of <= su + ac + 1 and d < 3.2:
            over = (mv.get("guard") == "H") or op.get("airborne")
            return {bk} if over else {bk, K["down"]}
        # projectiles flying at me
        for p in (m or {}).get("proj") or []:
            if p.get("owner") == 1 and p.get("kind") in (0, 1):
                toward = (me["x"] - p["x"]) * (p.get("vx") or 0) > 0
                if toward and abs(me["x"] - p["x"]) < 2.6:
                    return {bk, K["down"]}
        # a jump coming in: SIMPLE 2S (down + S) anti-air
        if op.get("airborne") and ost in ("air", "prejump") and d < 2.0:
            return {K["down"], K["s"]} if self.phase else {K["down"]}
        if not me.get("actionable"):
            return set()
        # the opponent recovering / whiffed / landing within reach: super (1+ bar) or the ASSIST route
        recovering = (ost == "attack" and su and of > su + ac - 1) or ost in ("land", "recover", "parry_rec", "dash_b")
        if recovering and d < 1.6:
            if (me.get("showtime") or 0) >= 30000 and d < 1.5:
                return {K["down"], K["s"], K["h"]}
            if (me.get("showtime") or 0) >= 10000 and d < 1.5:
                return {K["s"], K["h"]}
            return {K["assist"], K["l"]} if self.phase else {K["assist"]}
        if ost == "knockdown":
            return {fk} if d > 1.0 else {bk, K["down"]}
        if d > 1.05:
            return {fk}
        # close and neutral: mostly the ASSIST route, some throws, some guarding
        t = int(me.get("x", 0) * 97 + (m or {}).get("frame", 0)) % 10
        if t < 5:
            return {K["assist"], K["l"]} if self.phase else {K["assist"]}
        if t < 7 and d < 0.95:
            return {K["throw"]} if self.phase else set()
        return {bk, K["down"]}

    def bonus_keys(self, f, m):
        me = f[0]
        br = (m or {}).get("brawl") or {}
        self.phase ^= 1
        if br.get("mode") == "heckler":
            near = [p for p in ((m or {}).get("proj") or []) if p.get("kind") == 2 and abs(p["x"] - me["x"]) < 1.3]
            return {K["parry"]} if near else set()
        goons = [g for g in (br.get("goons") or []) if not g.get("down")]
        if not goons:
            return set()
        g = min(goons, key=lambda q: abs(q["x"] - me["x"]))
        dx = g["x"] - me["x"]
        toward = K["right"] if dx > 0 else K["left"]
        if abs(dx) > 0.9:
            return {toward}
        return {K["l"]} if self.phase else {K["m"]}


def season_bout(P, S, args, tag, report, slot_kind):
    """one bout (or bonus round) of THE SEASON, played by the SeasonBot through real keys; returns a summary dict"""
    s = P.s
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
            "decisions": n_dec, "score": br.get("score"), "phaseEvent": phase_seen, "matchEnd": snap.get("phase") == "matchEnd"}


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
        return sess.screenshot(os.path.join(args.out_dir, "pts_%s.png" % name))

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
            for _ in range(24):
                cur = ((P.menus().get("cs", {}).get("p") or [{}])[0]).get("cursor")
                if cur == args.fighter:
                    break
                P.key("ArrowRight", gap=0.08)
            cur0 = ((P.menus().get("cs", {}).get("p") or [{}])[0]).get("cursor")
            shot("charselect")
            P.key("Enter", 3, gap=0.25)     # fighter, colour, controls (SIMPLE is the first choice)
            S.check("p1_fighter", cur0 == args.fighter, "cursor=%s" % cur0)
        # ---------------------------------------------------------------- the ladder, slot by slot
        seen_index = -1
        continues = 0
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
            res = season_bout(P, S, args, "slot%d" % idx, report, kind)
            res["slot"] = idx
            report["slots"].append(res)
            bouts_played += 1
            if want_mode != "arcade":
                bonus_played.append({"slot": idx, "kind": kind, "played": True, "score": res.get("score")})
            if kind == "boss":
                boss_phase = res.get("phaseEvent")
            ok, ph = sess.wait_phase("results", 25)
            okr = ok and P.wait_screen("results", 10)
            time.sleep(0.6)
            shot("results_%d" % idx)
            rb = P.menus().get("result") or {}
            S.check("slot_%d_results" % idx, okr and res.get("matchEnd") and rb.get("winner") == res.get("winner"),
                    "results card winner=%s sim winner=%s wins=%s score=%s %.0f s %d decisions" % (rb.get("winner"), res.get("winner"), res.get("wins"), res.get("score"), res.get("seconds") or 0, res.get("decisions") or 0))
            seen_index = idx
            if args.max_bouts and bouts_played >= args.max_bouts:
                break
            if res.get("winner") != 0 and want_mode == "arcade":
                continues += 1
                seen_index = idx - 1         # the same slot comes again
            P.key("Enter")                   # NEXT EPISODE / CONTINUE (the default button)
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
    print("time control : %s" % ("REAL-TIME (no stepping)" if args.realtime else "sim frozen + stepped %d frames per key decision (__HP__.dev.freeze / dev.step); keys = real key events" % args.step_frames))
    print("report       : %s" % save_report("playtest_season", report, args.base))
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
    args = ap.parse_args()
    if args.season:
        return run_season(args)
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
