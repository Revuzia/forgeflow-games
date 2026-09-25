#!/usr/bin/env python
"""DYEFIELD match playtest — CONTRACT §12 gate G9 (FRONT lane).

    python _harness/playtest.py                      # headed Chrome (d3d11), 1600x900, auto-starts vite
    python _harness/playtest.py --headless           # same flags, no window
    python _harness/playtest.py --match-seconds 45 --seed 7

A real match with REAL keys and mouse (page.keyboard / page.mouse → the game's Input; the camera is
turned by real pointer-lock mouse motion, never by writing its yaw):
  1. load /?map=pier18&dev=1&matchSeconds=45&seed=7 → 'ready' → a real click (pointer lock) → play;
     the 3 · 2 · 1 countdown shows (pt_countdown.png) and the match goes live;
  2. walk off the pad, tilt the aim to the floor ahead and hold LMB while walking → coverage.sun rises
     and the tank drops (pt_firing.png);
  3. dye the floor under the feet (aim down, LMB), hold SHIFT → SLICK (slickForm / state 'slick') and
     the tank refills; a short swim for the picture (pt_slick.png);
  4. turn toward the nearest enemy with the mouse and fire, closing in, for up to --fight seconds; a
     wash or being washed is logged; the death slate `WASHED BY {name}` is read back (pt_death.png).
     If the human was never washed, the slate is exercised once with the dev hook damage(0, 100) and
     SAID so (the check is on the slate, not on the fight);
  5. a frame of the bots fighting (pt_bots.png, camera turned toward the closest ally/enemy pair);
  6. wait for the final horn → the victory slate `THE HARBOR CHOSE A COLOR.` with both percentages
     (pt_victory.png); percentages must be sane (0 < share < 1, sum ≤ 1, winner = the larger share,
     the slate's numbers = the sim's result);
  7. a real click on PLAY AGAIN → a second match starts (countdown) with the paint reset.
Frame times are recorded page-side for the whole live match (every rAF delta): avg fps, p50/p90/p99.
VERDICT "PLAYTEST PASS" only when every check holds AND 0 console errors, 0 page/window errors,
0 shader/GL errors, 0 failed requests. Pointer-lock losses are classified like bootcheck (focus theft →
NOTE + one real re-click; a loss with focus → FAIL).
Exit: 0 pass · 1 fail · 2 the page never got far enough to judge.
"""
import argparse
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (SHOTS, HarnessError, Session, add_common_args, aim_info,  # noqa: E402
                    angle_delta, build_url, diag_problems, events_tail, fmt, hud_info, match_info, mouse_home,
                    mouse_turn, preflight_chromes, print_diagnostics, save_report, wait_alive, wait_match_phase, wait_warm, yaw_to)
from perfcheck import RECORDER_JS, summarize  # noqa: E402

DEG = math.pi / 180.0
VICTORY = "THE HARBOR CHOSE A COLOR."


def shot(sess, name, shots):
    path = os.path.join(SHOTS, "pt_%s.png" % name)
    ok = sess.screenshot(path)
    shots[name] = path if ok else None
    return ok


def me_of(m):
    rs = (m or {}).get("runners") or []
    return rs[0] if rs else {}


def nearest(m, pred):
    me = me_of(m)
    best, bd = None, 1e9
    for r in (m or {}).get("runners") or []:
        if r.get("id") == 0 or not pred(r):
            continue
        d = math.hypot(r["x"] - me.get("x", 0), r["z"] - me.get("z", 0))
        if d < bd:
            best, bd = r, d
    return best, bd


def main() -> int:
    ap = argparse.ArgumentParser(description="DYEFIELD match playtest (gate G9)")
    add_common_args(ap)
    ap.add_argument("--map", default="pier18")
    ap.add_argument("--match-seconds", type=float, default=45.0)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--fight", type=float, default=14.0, help="seconds of real aim + fire toward enemies")
    ap.add_argument("--wait", type=float, default=90.0)
    args = ap.parse_args()
    if args.width == 1280 and args.height == 720:
        args.width, args.height = 1600, 900
    url = build_url(args.base, map=args.map, dev=1, matchSeconds=int(args.match_seconds), seed=args.seed)

    rep = {"url": url, "headless": args.headless, "size": [args.width, args.height]}
    problems, notes, shots = [], [], {}
    checks = {}
    fatal = None
    others, _ = preflight_chromes("pre-flight")
    rep["otherAutomatedChrome"] = others
    if others:
        notes.append("another automated Chrome was alive at start (%d): a headed one may steal focus" % len(others))

    sess = Session(args, "playtest")
    try:
        sess.start()
    except Exception as e:
        sess.close()
        print("SETUP FAILED: %s" % (str(e) if isinstance(e, HarnessError) else repr(e)))
        print("RESULT: FAIL")
        return 2

    frames = None
    try:
        t0 = time.time()
        sess.goto(url)
        if not sess.wait_df(args.wait):
            fatal = "window.__DF__ never appeared"
        if not fatal:
            ok, ph = sess.wait_phase("ready", args.wait)
            rep["readyS"] = time.time() - t0
            if not ok:
                fatal = "never reached 'ready' (phase %r): %s" % (ph, str((sess.state() or {}).get("error"))[:1200])

        # ── 1. real click → pointer lock → play → countdown → live
        if not fatal:
            time.sleep(0.5)
            entered = None
            for attempt in range(2):
                try:
                    sess.page.bring_to_front()
                except Exception:
                    pass
                sess.page.mouse.move(args.width / 2, args.height / 2)
                sess.page.mouse.click(args.width / 2, args.height / 2)
                ok, _ = sess.wait_phase("play", 4.0)
                if ok:
                    entered = "real click → pointer lock (click %d)" % (attempt + 1)
                    break
                time.sleep(0.8)
            if not entered:
                notes.append("pointer lock refused twice under automation → __DF__.start() + a real click on the view")
                sess.df("start")
                ok, _ = sess.wait_phase("play", 4.0)
                if ok:
                    sess.page.mouse.click(args.width / 2, args.height / 2)
                    entered = "__DF__.start() fallback"
            rep["entered"] = entered
            mouse_home(sess)
            if not entered:
                fatal = "could not enter play"
        if not fatal:
            time.sleep(0.35)
            m = match_info(sess) or {}
            h = hud_info(sess) or {}
            checks["countdownSeen"] = {"phase": m.get("phase"), "countdown": m.get("countdown"), "hud": h.get("countdown"), "timer": h.get("timer")}
            shot(sess, "countdown", shots)
            if m.get("phase") != "countdown" or not h.get("countdown"):
                problems.append("the 3 · 2 · 1 countdown was not showing right after entering play (phase %r, hud %r)" % (m.get("phase"), h.get("countdown")))
            ok, ph = wait_match_phase(sess, "live", 30.0)
            if not ok and sess.phase() == "paused":
                # a pointer-lock loss paused the countdown: classify it (focus theft → NOTE + one real
                # re-click; a loss while the page had focus → a problem) and wait again
                g = sess.lock_guard("during the countdown", notes, problems)
                mouse_home(sess)
                if g in ("relocked", "game"):
                    ok, ph = wait_match_phase(sess, "live", 8.0)
            if not ok:
                fatal = "the match never went live (phase %r, app phase %r)" % (ph, sess.phase())
            else:
                time.sleep(0.2)
                h2 = hud_info(sess) or {}
                checks["liveHud"] = {"timer": h2.get("timer"), "countdown": h2.get("countdown"), "crests": len(h2.get("crests") or [])}
                if h2.get("countdown"):
                    problems.append("the countdown slate stayed up after the match went live")
                if len(h2.get("crests") or []) != 8:
                    problems.append("HUD shows %d crests (want 4 + 4)" % len(h2.get("crests") or []))
                sess.js(RECORDER_JS)
                sess.js("() => { const P = window.__PF__; P.dts = []; P.stats = []; P.last = -1; P.on = true; }")
                frames = True
                m_live = match_info(sess) or {}
                rep["botsAtLive"] = [(r["id"], round(r["x"], 1), round(r["z"], 1)) for r in m_live.get("runners") or []]

        # ── 2. walk + fire at the floor ahead
        if not fatal:
            wait_warm(sess, notes, "before firing")
            sess.lock_guard("before firing", notes, problems)
            mouse_home(sess)
            s0 = sess.state() or {}
            p0 = s0.get("player") or {}
            cov0 = (s0.get("coverage") or {}).get("sun", 0)
            timer0 = (hud_info(sess) or {}).get("timer")
            kb, ms = sess.page.keyboard, sess.page.mouse
            kb.down("KeyW"); time.sleep(0.8)
            a0 = aim_info(sess) or {}
            mouse_turn(sess, 0.0, (-30 * DEG) - (a0.get("pitch") or -14 * DEG))
            ms.down(button="left")
            time.sleep(1.1)
            shot(sess, "firing", shots)
            time.sleep(1.1)
            kb.up("KeyW")
            time.sleep(0.8)
            ms.up(button="left")
            time.sleep(0.4)
            s1 = sess.state() or {}
            p1 = s1.get("player") or {}
            cov1 = (s1.get("coverage") or {}).get("sun", 0)
            ev = (match_info(sess) or {}).get("events") or {}
            h1 = hud_info(sess) or {}
            checks["fire"] = {"tank": [p0.get("tank"), p1.get("tank")], "coverageSun": [cov0, cov1], "shots": ev.get("shot"),
                              "walked": math.hypot(p1.get("x", 0) - p0.get("x", 0), p1.get("z", 0) - p0.get("z", 0)),
                              "hudTank": h1.get("tank"), "timer": [timer0, h1.get("timer")]}
            if not (isinstance(p0.get("tank"), (int, float)) and isinstance(p1.get("tank"), (int, float)) and p0["tank"] - p1["tank"] >= 8):
                problems.append("firing did not drain the tank (%s → %s)" % (p0.get("tank"), p1.get("tank")))
            if not (cov1 > cov0 + 1e-5):
                problems.append("firing did not raise coverage.sun (%s → %s)" % (cov0, cov1))
            if not (ev.get("shot") or 0) > 5:
                problems.append("fewer than 6 'shot' events after ~3 s of LMB (%s)" % ev.get("shot"))
            if h1.get("tank") is not None and abs((h1.get("tank") or 0) - round(p1.get("tank") or 0)) > 2:
                problems.append("HUD tank pipette %s ≠ runner tank %s" % (h1.get("tank"), p1.get("tank")))
            if timer0 is not None and timer0 == h1.get("timer"):
                problems.append("the HUD timer did not change in ~4 s (%s)" % timer0)

        # ── 3. dye the floor under the feet, then SHIFT → SLICK + refill
        if not fatal:
            wait_warm(sess, notes, "before slick")
            sess.lock_guard("before slick", notes, problems)
            kb, ms = sess.page.keyboard, sess.page.mouse
            a0 = aim_info(sess) or {}
            mouse_turn(sess, 0.0, (-64 * DEG) - (a0.get("pitch") or 0))
            under = None
            for attempt in range(3):
                ms.down(button="left"); time.sleep(0.9); ms.up(button="left")
                time.sleep(0.25)
                under = sess.df("teamUnderFeet")[1]
                if under == 1:
                    break
                kb.down("KeyW"); time.sleep(0.25); kb.up("KeyW")
            tank_before = ((sess.state() or {}).get("player") or {}).get("tank")
            samples = []
            kb.down("ShiftLeft")
            t_s = time.time()
            while time.time() - t_s < 1.6:
                st = (sess.state() or {}).get("player") or {}
                samples.append((round(time.time() - t_s, 2), st.get("state"), st.get("slickForm"), st.get("tank")))
                time.sleep(0.12)
            a1 = aim_info(sess) or {}
            mouse_turn(sess, 0.0, (-14 * DEG) - (a1.get("pitch") or 0))
            # swim BACK over the trail painted while walking forward (own dye), toward the camera
            kb.down("KeyS"); time.sleep(0.45)
            shot(sess, "slick", shots)
            st = (sess.state() or {}).get("player") or {}
            samples.append(("swim", st.get("state"), st.get("slickForm"), st.get("tank")))
            kb.up("KeyS")
            time.sleep(0.3)
            kb.up("ShiftLeft")
            time.sleep(0.4)
            tank_after = ((sess.state() or {}).get("player") or {}).get("tank")
            slicked = any(s[2] is True or s[1] == "slick" for s in samples)
            tanks = [s[3] for s in samples if isinstance(s[3], (int, float))]
            refill = (max(tanks) - min(tanks)) if tanks else 0
            checks["slick"] = {"teamUnderFeet": under, "tankBefore": tank_before, "tankAfter": tank_after, "samples": samples, "refill": refill,
                               "slickBlend": (aim_info(sess) or {}).get("slickBlend")}
            if under != 1:
                problems.append("could not stand on own dye for the slick check (teamUnderFeet %r)" % under)
            if not slicked:
                problems.append("holding SHIFT on own dye never entered SLICK (samples %s)" % samples[:6])
            if not (refill >= 10 or (isinstance(tank_before, (int, float)) and tank_before >= 95 and slicked)):
                problems.append("no tank refill observed while slicking (tank %s → max %s; samples %s)" % (
                    tank_before, max(tanks) if tanks else None, samples[:6]))

        # ── 4. turn toward enemies and fight (real mouse + keys)
        washes_by_me = washed_me = 0
        death_read = None
        fight_shot = False
        if not fatal:
            sess.lock_guard("before the fight", notes, problems)
            kb, ms = sess.page.keyboard, sess.page.mouse
            t_f = time.time()
            firing = walking = False
            seen_ev = set()
            closest = 1e9
            while time.time() - t_f < args.fight:
                m = match_info(sess) or {}
                if m.get("phase") != "live" or (m.get("timeLeft") or 0) < 12:
                    break                           # leave match time for the death-slate + bots checks
                me = me_of(m)
                for e in events_tail(sess, 120):
                    key = (e.get("tick"), e.get("t"), e.get("victim"), e.get("by"))
                    if e.get("t") != "washed" or key in seen_ev:
                        continue
                    seen_ev.add(key)
                    if e.get("by") == 0 and e.get("victim") != 0:
                        washes_by_me += 1
                    if e.get("victim") == 0:
                        washed_me += 1
                if not me.get("alive"):
                    if firing:
                        ms.up(button="left"); firing = False
                    if walking:
                        kb.up("KeyW"); walking = False
                    time.sleep(0.35)
                    h = hud_info(sess) or {}
                    if h.get("death") and not death_read:
                        death_read = h.get("death")
                        shot(sess, "death", shots)
                    wait_alive(sess, 5.0)
                    mouse_home(sess)
                    continue
                tgt, dist = nearest(m, lambda r: r.get("team") != 1 and r.get("alive"))
                if not tgt:
                    time.sleep(0.2)
                    continue
                closest = min(closest, dist)
                a = aim_info(sess) or {}
                want_yaw = yaw_to(me["x"], me["z"], tgt["x"], tgt["z"])
                dy = (tgt["y"] + 0.6) - (me["y"] + 1.35)
                want_pitch = max(-0.5, min(0.35, math.atan2(dy, max(1.0, dist)) - 0.06))
                mouse_turn(sess, angle_delta(a.get("yaw") or 0, want_yaw), want_pitch - (a.get("pitch") or 0), step_px=30, step_s=0.004)
                should_walk = dist > 8.0
                if should_walk != walking:
                    (kb.down if should_walk else kb.up)("KeyW"); walking = should_walk
                should_fire = dist < 15.0
                if should_fire != firing:
                    (ms.down if should_fire else ms.up)(button="left"); firing = should_fire
                if should_fire and not fight_shot and dist < 12:
                    fight_shot = shot(sess, "fight", shots)
                if (me.get("tank") or 0) < 8 and firing:
                    ms.up(button="left"); firing = False
                time.sleep(0.12)
            if firing:
                ms.up(button="left")
            if walking:
                kb.up("KeyW")
            checks["fight"] = {"closestEnemy": closest, "washesByMe": washes_by_me, "washedMe": washed_me, "deathSlate": death_read}
            if closest > 40:
                notes.append("the fight never got within 40 m of an enemy (closest %.1f m)" % closest)

        # death slate: read it from a real wash, or exercise it once with the dev hook (declared)
        if not fatal and not death_read:
            m = match_info(sess) or {}
            if m.get("phase") == "live" and me_of(m).get("alive"):
                sess.df("damage", 0, 100)
                time.sleep(0.45)
                h = hud_info(sess) or {}
                death_read = h.get("death")
                shot(sess, "death", shots)
                checks["deathForced"] = {"hud": death_read}
                notes.append("the human was not washed in the fight → the death slate was exercised with the dev hook "
                             "__DF__.damage(0, 100) (cause: the sea / no attacker)")
                wait_alive(sess, 5.0)
        if not fatal:
            if not death_read or not str(death_read).startswith("WASHED BY"):
                problems.append("the death slate never read 'WASHED BY {name}' (got %r)" % death_read)
            checks["deathSlate"] = death_read

        # ── 5. bots fighting: turn toward the closest ally/enemy pair
        if not fatal:
            m = match_info(sess) or {}
            rs = [r for r in (m.get("runners") or []) if r.get("alive")]
            pair, bd = None, 1e9
            for a_ in rs:
                for b_ in rs:
                    if a_["team"] == 1 and b_["team"] == 2 and a_["id"] != 0:
                        d = math.hypot(a_["x"] - b_["x"], a_["z"] - b_["z"])
                        if d < bd:
                            pair, bd = (a_, b_), d
            me = me_of(m)
            if pair and me:
                cx, cz = (pair[0]["x"] + pair[1]["x"]) / 2, (pair[0]["z"] + pair[1]["z"]) / 2
                a = aim_info(sess) or {}
                mouse_turn(sess, angle_delta(a.get("yaw") or 0, yaw_to(me["x"], me["z"], cx, cz)), (-12 * DEG) - (a.get("pitch") or 0))
                time.sleep(0.35)
            shot(sess, "bots", shots)
            m2 = match_info(sess) or {}
            ev = m2.get("events") or {}
            start = {r[0]: (r[1], r[2]) for r in rep.get("botsAtLive") or []}
            moved = [r["id"] for r in (m2.get("runners") or []) if r["id"] != 0 and r["id"] in start
                     and math.hypot(r["x"] - start[r["id"]][0], r["z"] - start[r["id"]][1]) > 5]
            checks["bots"] = {"pairDist": bd, "moved": moved, "events": ev}
            if len(moved) < 5:
                problems.append("only %d of 7 bots moved > 5 m since the match went live (%s)" % (len(moved), moved))
            if not (ev.get("hit") or 0) > 0:
                problems.append("no 'hit' events at all — the bots never fought (%s)" % ev)

        # ── 6. the final horn → victory slate
        if not fatal:
            sess.page.keyboard.up("KeyW")
            m = match_info(sess) or {}
            left = m.get("timeLeft") or 0
            deadline_end = time.time() + left + 25
            ok, ph = False, m.get("phase")
            while time.time() < deadline_end:
                ok, ph = wait_match_phase(sess, "ended", 2.0)
                if ok:
                    break
                if sess.phase() == "paused":
                    # a pointer-lock loss paused the match: classify it (bootcheck rules) and resume
                    sess.lock_guard("waiting for the final horn", notes, problems)
                    mouse_home(sess)
            if not ok:
                problems.append("the match did not end (phase %r, timeLeft was %.1f s)" % (ph, left))
            vic = None
            deadline = time.time() + 5
            while time.time() < deadline:
                vic = (hud_info(sess) or {}).get("victory")
                if vic:
                    break
                time.sleep(0.2)
            time.sleep(0.6)
            shot(sess, "victory", shots)
            m = match_info(sess) or {}
            res = m.get("result") or {}
            checks["victory"] = {"text": vic, "result": res, "phase": m.get("phase"), "coverage": m.get("coverage")}
            if not vic or VICTORY not in vic:
                problems.append("the victory slate %r does not show %r" % (vic, VICTORY))
            s_, g_, n_ = res.get("sun"), res.get("gulf"), res.get("neutral")
            if not all(isinstance(v, (int, float)) for v in (s_, g_, n_)):
                problems.append("match().result is missing percentages: %s" % res)
            else:
                if not (0 < s_ < 1 and 0 < g_ < 1 and abs(s_ + g_ + n_ - 1) < 1e-3):
                    problems.append("insane result shares sun %.4f gulf %.4f neutral %.4f" % (s_, g_, n_))
                want_w = 1 if s_ > g_ else 2 if g_ > s_ else 0
                if res.get("winner") != want_w:
                    problems.append("winner %r but sun %.4f / gulf %.4f" % (res.get("winner"), s_, g_))
                for v in (s_, g_):
                    if vic and ("%.1f%%" % (v * 100)) not in vic:
                        problems.append("the victory slate does not show %.1f%% (text %r)" % (v * 100, vic))

        # ── 7. PLAY AGAIN (a real click)
        if not fatal:
            box = None
            try:
                box = sess.page.locator("#df-again").bounding_box(timeout=2000)
            except Exception:
                box = None
            if not box:
                problems.append("PLAY AGAIN button not found on the victory slate")
            else:
                sess.page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
                sess.page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
                mouse_home(sess)
                time.sleep(0.8)
                m = match_info(sess) or {}
                h = hud_info(sess) or {}
                checks["playAgain"] = {"matchNo": m.get("matchNo"), "phase": m.get("phase"), "coverage": m.get("coverage"),
                                       "victory": h.get("victory"), "appPhase": sess.phase(), "locked": (sess.state() or {}).get("pointerLocked")}
                if m.get("matchNo") != 2 or m.get("phase") not in ("countdown", "live"):
                    problems.append("PLAY AGAIN did not start match #2 (%s)" % checks["playAgain"])
                cv = m.get("coverage") or {}
                if (cv.get("sun") or 0) > 0.01 or (cv.get("gulf") or 0) > 0.01:
                    problems.append("PLAY AGAIN kept old paint (coverage %s)" % cv)
                if h.get("victory"):
                    problems.append("the victory slate stayed up after PLAY AGAIN")
                time.sleep(3.2)
                ok, ph = wait_match_phase(sess, "live", 3.0)
                if not ok:
                    problems.append("match #2 did not go live (phase %r)" % ph)

        if frames:
            frames = sess.js("() => { const P = window.__PF__; P.on = false; return { dts: P.dts.slice(), stats: P.stats.slice() }; }")
    except Exception as e:
        fatal = fatal or ("harness error: %s" % str(e).splitlines()[0][:400])
    finally:
        tl = sess.timeline() if sess.page else []
        diag = sess.diagnostics() if sess.page else {}
        render = sess.df("render")[1] if sess.page else None
        sess.close()

    perf = summarize(frames) if isinstance(frames, dict) else None
    print("=" * 96)
    print("URL          : %s" % url)
    print("mode         : %s Chrome (d3d11) %dx%d" % ("headless" if args.headless else "headed", args.width, args.height))
    print("entered play : %s · ready after %s s" % (rep.get("entered"), fmt(rep.get("readyS"), 1)))
    for k in ("countdownSeen", "liveHud", "fire", "slick", "fight", "deathForced", "deathSlate", "bots", "victory", "playAgain"):
        if k in checks:
            print("%-13s: %s" % (k, json.dumps(checks[k], default=str)[:900]))
    if perf:
        print("frames (live): %d over %.1f s · avg %.1f fps · frame ms p50 %.2f p90 %.2f p99 %.2f max %.2f · >20 ms %.1f%% · draw calls median %s max %s · scale %s → %s" % (
            perf["frames"], perf["seconds"], perf["avgFps"] or 0, perf["p50"] or 0, perf["p90"] or 0, perf["p99"] or 0, perf["max"] or 0,
            100 * (perf["over20"] or 0), perf["calls"]["median"], perf["calls"]["max"], fmt(perf["scale"]["start"], 3), fmt(perf["scale"]["end"], 3)))
    if isinstance(render, dict):
        print("renderer     : %s · programs %s · runner tris %s" % (render.get("gpu"), render.get("programs"), render.get("runnerTris")))
    for k, v in shots.items():
        print("shot %-8s: %s" % (k, v or "NOT SAVED"))
    for n in notes:
        print("NOTE         : %s" % n)
    print("lock timeline: %s" % (" | ".join(tl) or "—"))
    print("-" * 96)
    print_diagnostics(diag)
    print("=" * 96)
    rep.update({"checks": checks, "perf": perf, "shots": shots, "notes": notes, "diagnostics": diag, "fatal": fatal, "timeline": tl, "render": render})
    if fatal:
        rep["verdict"] = "NOT JUDGED"
        print("VERDICT: NOT JUDGED — %s" % fatal)
        print("report       : %s" % save_report("playtest", rep, args.base))
        print("RESULT: FAIL")
        return 2
    problems += diag_problems(diag)
    for k in ("countdown", "firing", "slick", "bots", "victory", "death"):
        if not shots.get(k):
            problems.append("screenshot pt_%s was not saved" % k)
    rep["problems"] = problems
    rep["verdict"] = "PLAYTEST PASS" if not problems else "PLAYTEST FAIL"
    print("VERDICT: %s" % rep["verdict"])
    for p in problems:
        print("   X %s" % p)
    print("report       : %s" % save_report("playtest", rep, args.base))
    print("RESULT: %s" % ("OK" if not problems else "FAIL"))
    return 0 if not problems else 1


if __name__ == "__main__":
    raise SystemExit(main())
