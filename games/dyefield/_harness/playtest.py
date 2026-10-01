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
AUDIO (CHANGED(INTEGRATE) phase 10): after the countdown (read once the first fire burst is done) __DF__.audio() must
report the context unlocked + running, the music cue 'match' (or 'final'), >= 1 WORLD sfx one-shot started (the
sfx bus, not the UI / flow bus of the beeps and horns) and 0 decode / fetch errors; the victory slate must switch
the cue to the 'victory' or 'defeat' stinger. The output meter is reported (peak / RMS / limiter, dBFS) and a
clipping master (peak > -0.1 dBFS) is a problem.
Frame times are recorded page-side for the whole live match (every rAF delta): avg fps, p50/p90/p99.

    python _harness/playtest.py --kits --headless    # phase 6 kit shots (CONTRACT_P6_11 §18.2)
    python _harness/playtest.py --headless --map lockwell --kit sheet-drum   # G9 on any built map, any human kit

--map / --kit (CHANGED(INTEGRATE)): the G9 match on any built map with any human kit (?kit=). The steps use the
kit the way a player would: MIST-RASP / POP-WELL hold LMB; SHEET-DRUM holds LMB while walking (a roll) and taps
to flick; NEEDLE-GLINT presses, holds ~0.8 s to charge and releases, again and again. The fire check wants the
kit's own evidence (stream ≥ 6 shots · burst ≥ 2 · charge ≥ 1 beam · roll: rolling seen) plus the tank drop and
coverage. Shots other than Pier 18 + MIST-RASP go to _shots/pt_<map>_<kit>_<name>.png.

--kits: one fresh page per kit (?kit=mist-rasp|sheet-drum|needle-glint|pop-well, Pier 18), REAL keys and
mouse for every action: the fire action (MIST-RASP stream; SHEET-DRUM roll + a tap flick; NEEDLE-GLINT
hold → full charge → release; POP-WELL bursts), the JELLY CHARGE (E: throw, puddle, pop) and the special
(Q) once ready. Dev hooks, declared in the output: setTank(0, 100) before the sub, fillSpecial(0) before
the special, and freeze(on) — a page-side waiter freezes the sim + visual clock right after the event of
interest so the capture shows that exact moment. Screenshots: _shots/kit_<id>_<action>.png. Checks: each
action's sim events fired, the HUD special gauge is ready with the ACTUAL special binding as its key badge,
the sub chip greys below the sub cost, the charger ring reads 100 at full charge, the FX read-back shows
the action (glint line, beam flash, puddle, raining cell), and 0 console / page / shader errors.
--mode ffa (CONTRACT_FFA F3/F4, lane UI): the same real-input G9 walk in FREE-FOR-ALL (?mode=ffa; the human on the
default amber crew, seven bots on the other seven): 8 distinct crews and the FFA HUD (8 crests, own share + mark, the
live top 3); fire raises the human's OWN crew share (match().coverageByTeam); slick + refill on own dye (or the own drop
pad); the fight targets any other crew; the kill feed names carry crew ids; the FFA victory slate shows the winner, the
top-3 podium and all 8 standings with the sim's percentages, the tally stamps, and the stinger is 'victory' exactly when
the human won (a draw counts when the human is among the tied crews); PLAY AGAIN clears every crew's paint. Shots go to
_shots/ffa_ui_pt_<map>_<kit>_<name>.png, the report to _harness/_reports/playtest_ffa.json. FFA runs default to a 75 s dev
match (room for the respawn-and-repeat of a step during which a bot washed the human; NOTED), the slick step nudges onto
the fresh splat (only OWN dye counts: no allies) and the bots' "moved" check uses each bot's furthest excursion seen
during the fight (FFA bots respawn on their own pads often). Teams mode (the default) is unchanged.
VERDICT "PLAYTEST PASS" only when every check holds AND 0 console errors, 0 page/window errors,
0 shader/GL errors, 0 failed requests. Pointer-lock losses are classified like bootcheck (focus theft →
NOTE + one real re-click; a loss with focus → FAIL).
Exit: 0 pass · 1 fail · 2 the page never got far enough to judge.
"""
import argparse
import json
import math
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (SHOTS, HarnessError, Session, add_common_args, aim_info,  # noqa: E402
                    angle_delta, build_url, diag_problems, events_tail, fmt, hud_info, match_info, mouse_home,
                    mouse_turn, preflight_chromes, print_diagnostics, save_report, wait_alive, wait_match_phase, wait_warm, yaw_to)
from perfcheck import RECORDER_JS, summarize  # noqa: E402

DEG = math.pi / 180.0
VICTORY = "THE HARBOR CHOSE A COLOR."


SHOT_PREFIX = ["pt"]


def shot(sess, name, shots):
    path = os.path.join(SHOTS, "%s_%s.png" % (SHOT_PREFIX[0], name))
    ok = sess.screenshot(path)
    shots[name] = path if ok else None
    return ok


def dfd(sess, name):
    """__DF__.<name>() as a dict ({} when it failed or returned nothing)"""
    ok, v = sess.df(name)
    return v if ok and isinstance(v, dict) else {}


def audio_check(sess, checks, problems, key):
    """__DF__.audio() after the countdown: unlocked + running, cue 'match' (or 'final' in a short match's last
    minute), >= 1 world-sfx one-shot started, 0 decode / fetch errors, and a master that does not clip."""
    au = None
    for _ in range(12):                    # the match cue decodes asynchronously: allow ~3 s
        au = dfd(sess, "audio")
        if au.get("cue") in ("match", "final"):
            break
        time.sleep(0.25)
    au = au or {}
    bus = au.get("playedBus") or {}
    meter = au.get("meter") or {}
    checks[key] = {"unlocked": au.get("unlocked"), "state": au.get("state"), "cue": au.get("cue"), "played": au.get("played"),
                   "playedBus": bus, "voices": au.get("voices"), "peakVoices": au.get("peakVoices"), "stolen": au.get("stolen"),
                   "loops": au.get("loops"), "decoded": au.get("decoded"), "errors": au.get("errors"), "meter": meter,
                   "volumes": au.get("volumes")}
    if not au.get("unlocked") or au.get("state") != "running":
        problems.append("audio not unlocked / running after the countdown (unlocked %r, state %r)" % (au.get("unlocked"), au.get("state")))
    if au.get("cue") not in ("match", "final"):
        problems.append("the match music cue is not playing after the countdown (cue %r)" % au.get("cue"))
    if not (bus.get("sfx") or 0) >= 1:
        problems.append("no world sfx voice started after the countdown (playedBus %s)" % bus)
    if au.get("errors"):
        problems.append("audio decode / fetch errors: %s" % au.get("errors"))
    if isinstance(meter.get("peakAllDb"), (int, float)) and meter["peakAllDb"] > -0.1:
        problems.append("the audio master clips (peak %.1f dBFS)" % meter["peakAllDb"])
    return au


def me_of(m):
    rs = (m or {}).get("runners") or []
    return rs[0] if rs else {}


def washes_of(sess):
    """the human's washedCount (match().runners[0])"""
    rs = (match_info(sess) or {}).get("runners") or []
    return (rs[0].get("washedCount") or 0) if rs else 0


def ffa_rearm(sess):
    """FFA: wait out a respawn + the tide-spout drop before a timed step"""
    wait_alive(sess, 6.0)
    time.sleep(1.0)
    mouse_home(sess)


def painted_of(sess):
    """the human's credited dye: match().runners[0].painted (weighted m² newly dyed by them; never decreases)"""
    rs = (match_info(sess) or {}).get("runners") or []
    return (rs[0].get("painted") or 0) if rs else 0


def own_share(sess, team, ffa):
    """the human's crew coverage: teams → state().coverage.sun (the G9 human is SUNCREW); FFA → match().coverageByTeam[team]"""
    if not ffa:
        return ((sess.state() or {}).get("coverage") or {}).get("sun", 0)
    cbt = (match_info(sess) or {}).get("coverageByTeam") or []
    return cbt[team] if isinstance(team, int) and 0 <= team < len(cbt) else 0


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


KITS = ("mist-rasp", "sheet-drum", "needle-glint", "pop-well")
CLOUD_KITS = ("mist-rasp", "needle-glint")

# page-side trigger, ARMED before the real input: every frame it scans the drained-event log for the first
# NEW event matching `want` (t, and optionally pid / phase / id), waits `delay` ms, then freezes the sim +
# visuals (dev hook) so the capture shows that exact moment. Several triggers can be armed at once (keyed).
ARM_JS = """
([key, want, delay, timeout]) => {
  const D = window.__DF__;
  const T = (window.__KW__ = window.__KW__ || {});
  const log0 = D.events(512);
  let last = log0.length ? log0[log0.length - 1] : null;
  const st = { fired: false, done: false, ev: null, t0: performance.now(), at: -1 };
  T[key] = st;
  const match = (e) => e.t === want.t && (want.pid === undefined || e.pid === want.pid)
    && (want.phase === undefined || e.phase === want.phase) && (want.id === undefined || e.id === want.id);
  const tick = () => {
    if (st.done) return;
    if (performance.now() - st.t0 > timeout) { st.done = true; return; }
    const ev = D.events(512);
    let i = last ? ev.lastIndexOf(last) + 1 : 0;
    if (ev.length) last = ev[ev.length - 1];
    for (; i < ev.length; i++) {
      if (match(ev[i])) {
        st.ev = ev[i]; st.done = true; st.at = Math.round(performance.now() - st.t0);
        const fire = () => { D.freeze(true); st.fired = true; };
        if (delay > 0) setTimeout(fire, delay); else fire();
        return;
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return true;
}
"""


def arm(sess, key, want, delay_ms=0, timeout_s=4.0):
    try:
        sess.page.evaluate(ARM_JS, [key, want, int(delay_ms), int(timeout_s * 1000)])
        return True
    except Exception:
        return False


def await_armed(sess, key, timeout_s=4.5):
    """wait for an armed trigger → {ok, ev, at}; ok = it fired (the page is FROZEN until kit_capture unfreezes)"""
    deadline = time.time() + timeout_s
    st = None
    while time.time() < deadline:
        st = sess.safe_js("(k) => { const s = (window.__KW__ || {})[k]; return s ? { fired: s.fired, done: s.done, ev: s.ev, at: s.at } : null; }", key)
        if st and st.get("fired"):
            return {"ok": True, "ev": st.get("ev"), "at": st.get("at")}
        if st and st.get("done") and not st.get("ev"):
            break
        time.sleep(0.02)
    return {"ok": False, "ev": (st or {}).get("ev")}


def wait_event(sess, want, delay_ms=0, timeout_s=4.0, key=None):
    """arm + await in one go (for events that follow a real input by more than a frame or two)"""
    k = key or ("w%d" % int(time.time() * 1000))
    arm(sess, k, want, delay_ms, timeout_s)
    return await_armed(sess, k, timeout_s + 0.5)


def kit_capture(sess, kit, tag, shots, frozen):
    """screenshot _shots/kit_<kit>_<tag>.png; unfreeze afterwards when the waiter froze the page"""
    path = os.path.join(SHOTS, "kit_%s_%s.png" % (kit, tag))
    ok = sess.screenshot(path)
    if frozen:
        sess.df("freeze", False)
    shots["%s/%s" % (kit, tag)] = path if ok else None
    return ok


def pitch_to(sess, deg):
    a = aim_info(sess) or {}
    mouse_turn(sess, 0.0, deg * DEG - (a.get("pitch") or 0))


def kit_js(sess):
    return sess.safe_js("() => { try { return __DF__.kit(); } catch (e) { return null; } }") or {}


def fx_js(sess):
    return sess.safe_js("() => { try { return __DF__.fx(); } catch (e) { return null; } }") or {}


def run_kit(args, kit, shots, problems, notes, rep):
    """one fresh page: enter play for real, then every kit action with real input"""
    url = build_url(args.base, map=args.map, dev=1, kit=kit, seed=args.seed, matchSeconds=300, bots="breeze")
    info = {"url": url}
    rep[kit] = info
    sess = Session(args, "kits_%s" % kit)
    try:
        sess.start()
    except Exception as e:
        sess.close()
        problems.append("%s: setup failed: %s" % (kit, str(e)[:300]))
        return
    P = lambda msg: problems.append("%s: %s" % (kit, msg))  # noqa: E731
    try:
        sess.goto(url)
        if not sess.wait_df(args.wait) or not sess.wait_phase("ready", args.wait)[0]:
            P("never reached 'ready' (%s)" % str((sess.state() or {}).get("error"))[:600])
            return
        entered = None
        for attempt in range(2):
            sess.page.mouse.move(args.width / 2, args.height / 2)
            sess.page.mouse.click(args.width / 2, args.height / 2)
            if sess.wait_phase("play", 4.0)[0]:
                entered = "real click → pointer lock"
                break
            time.sleep(0.6)
        if not entered:
            notes.append("%s: pointer lock refused → __DF__.start() + a real click on the view" % kit)
            sess.df("start")
            if sess.wait_phase("play", 4.0)[0]:
                sess.page.mouse.click(args.width / 2, args.height / 2)
                entered = "__DF__.start() fallback"
        info["entered"] = entered
        mouse_home(sess)
        if not entered:
            P("could not enter play")
            return
        ok, ph = wait_match_phase(sess, "live", 30.0)
        if not ok:
            P("the match never went live (%r)" % ph)
            return
        time.sleep(0.3)
        kb, ms = sess.page.keyboard, sess.page.mouse
        k0 = kit_js(sess)
        info["kitReadback"] = k0.get("kit")
        if k0.get("kit") != kit:
            P("__DF__.kit().kit = %r (want %r) — ?kit= did not pick the human kit" % (k0.get("kit"), kit))
        lineup = [(r.get("id"), r.get("kit")) for r in ((match_info(sess) or {}).get("runners") or [])]
        info["lineup"] = lineup
        if len({k for (_, k) in lineup}) < 4:
            P("the lineup does not carry all 4 kits: %s" % lineup)
        h0 = hud_info(sess) or {}
        info["hudStart"] = {"special": h0.get("special"), "sub": h0.get("sub"), "charge": h0.get("charge")}
        # walk off the pad onto open floor
        kb.down("KeyW"); time.sleep(1.1); kb.up("KeyW"); time.sleep(0.25)
        g_idle = kit_js(sess).get("gripError")

        # ── the fire action
        act = {}
        if kit == "mist-rasp":
            pitch_to(sess, -18)
            kb.down("KeyW"); ms.down(button="left")
            time.sleep(0.9)
            kit_capture(sess, kit, "fire", shots, bool(sess.df("freeze", True)[0]))
            time.sleep(0.5)
            ms.up(button="left"); kb.up("KeyW")
            act["shots"] = kit_js(sess).get("shots")
            if not (act["shots"] or 0) >= 6:
                P("MIST-RASP: fewer than 6 shots in ~1.4 s of LMB (%s)" % act["shots"])
        elif kit == "sheet-drum":
            pitch_to(sess, -12)
            # move first: a fresh press while standing is a flick (§18.1), a press while moving rolls
            kb.down("KeyW"); time.sleep(0.35); ms.down(button="left")
            rolled = False
            t_r = time.time()
            while time.time() - t_r < 1.5:
                time.sleep(0.04)
                if kit_js(sess).get("rolling"):
                    rolled = True
                    break
            time.sleep(0.8)
            k_roll = kit_js(sess)
            act["rolling"] = k_roll.get("rolling")
            act["rollAnim"] = k_roll.get("anim")
            act["gripRoll"] = k_roll.get("gripError")
            kit_capture(sess, kit, "roll", shots, bool(sess.df("freeze", True)[0]))
            time.sleep(0.3)
            kb.up("KeyW"); ms.up(button="left")
            if not rolled:
                P("SHEET-DRUM: holding LMB + W never rolled (rolling %r)" % k_roll.get("rolling"))
            time.sleep(0.9)
            pitch_to(sess, 2)
            f0 = kit_js(sess).get("flicks") or 0
            arm(sess, "flick", {"t": "shot", "pid": 0}, 25, 2.0)
            ms.down(button="left"); time.sleep(0.08); ms.up(button="left")
            r = await_armed(sess, "flick", 2.5)
            act["flickShot"] = r.get("ok")
            kit_capture(sess, kit, "flick", shots, r.get("ok"))
            act["flicks"] = [f0, kit_js(sess).get("flicks")]
            if not r.get("ok"):
                P("SHEET-DRUM: a tap did not release a flick ('shot' never came)")
        elif kit == "needle-glint":
            pitch_to(sess, 1)
            ms.down(button="left")
            t_c = time.time()
            while time.time() - t_c < 2.5 and (kit_js(sess).get("charge") or 0) < 0.999:
                time.sleep(0.03)
            time.sleep(0.15)
            fr = fx_js(sess)
            h = hud_info(sess) or {}
            k = kit_js(sess)
            act["charge"] = k.get("charge")
            act["ring"] = h.get("charge")
            act["glints"] = fr.get("glints")
            act["chargeAnim"] = k.get("anim")
            act["gripCharge"] = k.get("gripError")
            kit_capture(sess, kit, "charge", shots, bool(sess.df("freeze", True)[0]))
            if not ((k.get("charge") or 0) >= 0.999):
                P("NEEDLE-GLINT: charge after 1.2 s held = %r (want 1)" % k.get("charge"))
            if h.get("charge") != 100:
                P("NEEDLE-GLINT: the HUD charge ring reads %r at full charge (want 100)" % h.get("charge"))
            if not (fr.get("glints") or 0) >= 1:
                P("NEEDLE-GLINT: no glint line drawn while charging (fx %s)" % fr)
            arm(sess, "beam", {"t": "beam", "pid": 0}, 45, 2.0)
            ms.up(button="left")
            r = await_armed(sess, "beam", 2.5)
            act["beam"] = r.get("ev")
            act["flashes"] = fx_js(sess).get("flashes")
            kit_capture(sess, kit, "beam", shots, r.get("ok"))
            if not r.get("ok"):
                P("NEEDLE-GLINT: releasing a full charge fired no 'beam'")
            elif not (act["flashes"] or 0) >= 1:
                P("NEEDLE-GLINT: the release drew no beam flash (fx %s)" % act["flashes"])
        elif kit == "pop-well":
            pitch_to(sess, -4)
            arm(sess, "burst", {"t": "burst", "pid": 0}, 110, 3.0)
            ms.down(button="left")
            r = await_armed(sess, "burst", 3.5)
            act["burst"] = r.get("ev")
            kit_capture(sess, kit, "burst", shots, r.get("ok"))
            time.sleep(0.4)
            ms.up(button="left")
            act["bursts"] = kit_js(sess).get("bursts")
            if not r.get("ok"):
                P("POP-WELL: holding LMB produced no 'burst' in 3 s")
        info["fire"] = act
        time.sleep(0.4)

        # ── JELLY CHARGE (E): throw → puddle → pop
        sub = {}
        sess.df("setTank", 0, 100)
        notes.append("%s: dev setTank(0, 100) before the sub throw (the throw needs tank ≥ its cost)" % kit)
        time.sleep(0.25)
        hs = hud_info(sess) or {}
        sub["hudBefore"] = hs.get("sub")
        pitch_to(sess, -10)
        # CHANGED(INTEGRATE): land + pop are armed with the throw, BEFORE the key press — a jelly that hits
        # a barrier inside the 150 ms throw-capture delay used to land before its trigger existed (a missed land)
        arm(sess, "throw", {"t": "sub", "pid": 0, "phase": "throw"}, 150, 2.0)
        arm(sess, "land", {"t": "sub", "pid": 0, "phase": "land"}, 380, 8.0)
        arm(sess, "pop", {"t": "sub", "pid": 0, "phase": "pop"}, 60, 10.0)
        kb.down("KeyE"); time.sleep(0.05); kb.up("KeyE")
        r = await_armed(sess, "throw", 2.5)
        sub["throw"] = r.get("ok")
        sub["throwAnim"] = kit_js(sess).get("anim")
        sub["fxThrow"] = fx_js(sess)
        kit_capture(sess, kit, "sub_throw", shots, r.get("ok"))
        r = await_armed(sess, "land", 8.5)
        sub["land"] = r.get("ok")
        sub["fxLand"] = fx_js(sess)
        kit_capture(sess, kit, "sub_puddle", shots, r.get("ok"))
        r = await_armed(sess, "pop", 10.5)
        sub["pop"] = r.get("ok")
        ha = hud_info(sess) or {}
        sub["hudAfter"] = ha.get("sub")
        kit_capture(sess, kit, "sub_pop", shots, r.get("ok"))
        info["sub"] = sub
        if not (sub["throw"] and sub["land"] and sub["pop"]):
            P("JELLY CHARGE: throw/land/pop events %s/%s/%s" % (sub["throw"], sub["land"], sub["pop"]))
        if not ((sub["fxLand"] or {}).get("puddles") or 0) >= 1:
            P("JELLY CHARGE: no puddle model drawn after the landing (fx %s)" % sub["fxLand"])
        if not ((sub["hudBefore"] or {}).get("ready") and not (sub["hudBefore"] or {}).get("grey")):
            P("the sub chip was not ready at tank 100 (%s)" % sub["hudBefore"])
        if not (sub["hudAfter"] or {}).get("grey"):
            P("the sub chip did not grey out below the sub cost after the throw (%s)" % sub["hudAfter"])
        time.sleep(0.5)

        # ── special (Q) once ready
        sp = {}
        sess.df("fillSpecial", 0)
        notes.append("%s: dev fillSpecial(0) to make the special ready" % kit)
        time.sleep(0.5)
        hr = hud_info(sess) or {}
        sp["hudReady"] = hr.get("special")
        kit_capture(sess, kit, "special_ready", shots, False)
        spec = (hr.get("special") or {})
        if not spec.get("ready"):
            P("the special gauge is not in its ready state after the meter filled (%s)" % spec)
        if spec.get("key") != "Q":
            P("the special key badge shows %r — the special is bound to KeyQ, want 'Q'" % spec.get("key"))
        cloud = kit in CLOUD_KITS
        pitch_to(sess, -3 if cloud else -14)
        arm(sess, "sp", {"t": "special", "pid": 0, "phase": "start"}, 170 if cloud else 300, 2.0)
        kb.down("KeyQ"); time.sleep(0.05); kb.up("KeyQ")
        if cloud:
            r = await_armed(sess, "sp", 2.5)
            sp["start"] = r.get("ok")
            sp["throwAnim"] = kit_js(sess).get("anim")
            kit_capture(sess, kit, "special_throw", shots, r.get("ok"))
            rain = None
            for _ in range(40):
                time.sleep(0.1)
                f = fx_js(sess)
                if (f.get("raining") or 0) > 0:
                    rain = f
                    break
            sp["rainFx"] = rain
            time.sleep(0.9)
            kit_capture(sess, kit, "special_rain", shots, bool(sess.df("freeze", True)[0]))
            if not r.get("ok"):
                P("CLOUDBURST: Q did not start the special")
            if not rain:
                P("CLOUDBURST: no raining cell drawn within 4 s of the throw")
        else:
            r = await_armed(sess, "sp", 2.5)
            sp["start"] = r.get("ok")
            sp["leapAnim"] = kit_js(sess).get("anim")
            arm(sess, "ring", {"t": "ring", "pid": 0}, 90, 6.0)
            kit_capture(sess, kit, "special_leap", shots, r.get("ok"))
            r2 = await_armed(sess, "ring", 6.5)
            sp["ring"] = r2.get("ev")
            kit_capture(sess, kit, "special_slam", shots, r2.get("ok"))
            if not r.get("ok"):
                P("WELLSPRING: Q did not start the special")
            if not r2.get("ok"):
                P("WELLSPRING: no slam 'ring' after the leap")
        info["special"] = sp
        info["gripIdle"] = g_idle
        time.sleep(0.4)
    except Exception as e:
        P("harness error: %s" % str(e).splitlines()[0][:400])
    finally:
        diag = sess.diagnostics() if sess.page else {}
        info["diagnostics"] = diag
        for d in diag_problems(diag):
            P(d)
        sess.close()


def kits_main(args) -> int:
    kits = [k for k in (args.kit_list.split(",") if args.kit_list else KITS) if k]
    rep, shots, problems, notes = {"kits": kits, "headless": args.headless}, {}, [], []
    for kit in kits:
        run_kit(args, kit, shots, problems, notes, rep)
    print("=" * 96)
    for kit in kits:
        info = rep.get(kit) or {}
        print("%-13s: entered %s · lineup %s" % (kit, info.get("entered"), " ".join("%s:%s" % t for t in info.get("lineup") or [])))
        for k in ("hudStart", "fire", "sub", "special", "gripIdle"):
            if k in info:
                print("   %-9s %s" % (k, json.dumps(info[k], default=str)[:700]))
    for k, v in shots.items():
        print("shot %-26s: %s" % (k, v or "NOT SAVED"))
    for n in notes:
        print("NOTE         : %s" % n)
    rep.update({"shots": shots, "notes": notes, "problems": problems})
    missing = [k for k, v in shots.items() if not v]
    for m in missing:
        problems.append("screenshot %s was not saved" % m)
    print("VERDICT: %s" % ("KITS PASS" if not problems else "KITS FAIL"))
    for p_ in problems:
        print("   X %s" % p_)
    print("report       : %s" % save_report("kitshots", rep, args.base))
    print("RESULT: %s" % ("OK" if not problems else "FAIL"))
    return 0 if not problems else 1


# ───────────────────────── CONTRACT_WASHOUT W8 · CONTRACT_CONTROLS C4 · CONTRACT_FFA_SPAWNS S5 (UI stage) ─────────────────────────
MODE_LINE_WASHOUT = "Harbor Cup • Washout · 4 v 4"
MODE_LINE_FFA_WASHOUT = "Harbor Cup • Washout · Free-for-all"
END_TAGS = {"limit": "LIMIT REACHED", "horn": "TIME"}
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# the nav node nearest (x, z) on the level of y (±1 m): a floor spot that is walkable for sure (dev placement setup)
NAV_NEAR_JS = """
([x, y, z]) => { const d = window.__DF__ && __DF__.dev; const n = d && d.parts && d.parts.nav; if (!n || !n.x) return null;
  let best = -1, bd = 1e9; const N = n.x.length;
  for (let i = 0; i < N; i++) { if (Math.abs(n.y[i] - y) > 1.0) continue; const q = Math.hypot(n.x[i] - x, n.z[i] - z); if (q < bd) { bd = q; best = i; } }
  return best < 0 ? null : { x: n.x[best], y: n.y[best], z: n.z[best], d: bd, i: best }; }
"""
# random nav nodes in a ring round (x, z) on the level of y: the painting walk's waypoints
NAV_RING_JS = """
([x, y, z, r0, r1, k, seed]) => { const d = window.__DF__ && __DF__.dev; const n = d && d.parts && d.parts.nav; if (!n || !n.x) return [];
  let s = seed >>> 0 || 1; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const out = []; const N = n.x.length;
  for (let t = 0; t < 4000 && out.length < k; t++) { const i = Math.floor(rnd() * N); const q = Math.hypot(n.x[i] - x, n.z[i] - z);
    if (q >= r0 && q <= r1 && Math.abs(n.y[i] - y) < 0.8) out.push({ x: n.x[i], y: n.y[i], z: n.z[i], d: q }); }
  return out; }
"""


def norm_ws(s):
    return " ".join(str(s or "").split())


def map_limits(map_id):
    """data/maps.json <map>.washout {teamLimit, ffaLimit} (the per-map WASHOUT limits, CONTRACT_WASHOUT W1)"""
    try:
        with open(os.path.join(ROOT_DIR, "data", "maps.json"), encoding="utf-8") as f:
            maps = json.load(f).get("maps") or []
        for m in maps:
            if m.get("id") == map_id:
                return m.get("washout") or {}
    except Exception:
        pass
    return {}


def enter_live(sess, args, notes, problems, label, countdown_shot=None, shots=None):
    """the deep link's play card → a real click (pointer lock) → play → the countdown → live. → (entered, fatal)"""
    if not sess.wait_df(args.wait):
        return None, "window.__DF__ never appeared"
    ok, ph = sess.wait_phase("ready", args.wait)
    if not ok:
        return None, "never reached 'ready' (phase %r): %s" % (ph, str((sess.state() or {}).get("error"))[:800])
    time.sleep(0.5)
    entered = None
    for attempt in range(2):
        try:
            sess.page.bring_to_front()
        except Exception:
            pass
        sess.page.mouse.move(args.width / 2, args.height / 2)
        sess.page.mouse.click(args.width / 2, args.height / 2)
        if sess.wait_phase("play", 4.0)[0]:
            entered = "real click → pointer lock (click %d)" % (attempt + 1)
            break
        time.sleep(0.8)
    if not entered:
        notes.append("%s: pointer lock refused twice under automation → __DF__.start() + a real click on the view" % label)
        sess.df("start")
        if sess.wait_phase("play", 4.0)[0]:
            sess.page.mouse.click(args.width / 2, args.height / 2)
            entered = "__DF__.start() fallback"
    mouse_home(sess)
    if not entered:
        return None, "could not enter play"
    if countdown_shot and shots is not None:
        time.sleep(0.3)
        shot(sess, countdown_shot, shots)
    # the 3 s countdown is SIM time: on the shared box the first seconds after entering play ran at 2–40 sim ticks/s
    # (integ fps_probe.py, 2026-09-30: rAF 0.5–10 fps), so the wait is long and the slow start is only noted
    t_c = time.time()
    m_c0 = match_info(sess) or {}
    ok, ph = wait_match_phase(sess, "live", 120.0)
    if not ok and sess.phase() == "play":
        # slow, or stalled? a countdown that still ticks gets more time (the tick rate says which)
        m_c1 = match_info(sess) or {}
        rate = 60.0 * ((m_c0.get("countdown") or 0) - (m_c1.get("countdown") or 0)) / max(1e-3, time.time() - t_c)
        notes.append("%s: after 120 s the countdown read %s (from %s), the sim at %.2f ticks/s (60 = real time)" % (
            label, fmt(m_c1.get("countdown"), 2), fmt(m_c0.get("countdown"), 2), rate))
        if rate > 0.2:
            ok, ph = wait_match_phase(sess, "live", 240.0)
    if not ok and sess.phase() == "paused":
        g = sess.lock_guard("during the countdown", notes, problems)
        mouse_home(sess)
        if g in ("relocked", "game"):
            ok, ph = wait_match_phase(sess, "live", 60.0)
    if not ok:
        return entered, "the match never went live (phase %r, app phase %r)" % (ph, sess.phase())
    if time.time() - t_c > 12:
        notes.append("%s: the 3 s countdown took %.0f s of wall time (the box is loaded: the sim runs slower than real time)" % (label, time.time() - t_c))
    return entered, None


def release_inputs(sess, keys=("KeyW", "ShiftLeft")):
    for k in keys:
        try:
            sess.page.keyboard.up(k)
        except Exception:
            pass
    for b in ("left", "right"):
        try:
            sess.page.mouse.up(button=b)
        except Exception:
            pass


def wait_frames(sess, n=2, cap_s=2.0):
    """wait until the page drew n more frames (the harness rAF counter): on the loaded box (0.5–20 fps) a camera read
    right after a mouse move still shows the old yaw, and correcting again from it overshoots"""
    f0 = sess.frames()
    if not isinstance(f0, (int, float)):
        time.sleep(0.1)
        return
    t = time.time()
    while time.time() - t < cap_s:
        f = sess.frames()
        if isinstance(f, (int, float)) and f >= f0 + n:
            return
        time.sleep(0.03)


def aim_at(sess, me, tgt, dist):
    """turn the camera toward a runner with REAL mouse motion (the G9 fight step's rule); small errors are left alone and
    a turn waits for the frames that apply it (no overshoot at a low frame rate)"""
    a = aim_info(sess) or {}
    want_yaw = yaw_to(me["x"], me["z"], tgt["x"], tgt["z"])
    dy = (tgt["y"] + 0.6) - (me["y"] + 1.35)
    want_pitch = max(-0.5, min(0.35, math.atan2(dy, max(1.0, dist)) - 0.06))
    dyaw, dpitch = angle_delta(a.get("yaw") or 0, want_yaw), want_pitch - (a.get("pitch") or 0)
    if abs(dyaw) < 0.04 and abs(dpitch) < 0.04:
        return
    mouse_turn(sess, dyaw, dpitch, step_px=30, step_s=0.004)
    wait_frames(sess, 2)


def new_events(sess, seen, n=300):
    """drained sim events not seen before (keyed by tick + the event's fields)"""
    out = []
    for e in events_tail(sess, n):
        key = json.dumps(e, sort_keys=True, default=str)
        if key in seen:
            continue
        seen.add(key)
        out.append(e)
    return out


def real_wash(sess, my_team, notes, label, budget_s=16.0, max_place=5, dist_place=5.5):
    """CONTRACT_WASHOUT W8: the human's OWN shots wash a foe bot inside the fight window. Setup only (declared): the foe is
    dev-placed on the nav node nearest a spot `dist_place` m in front of the camera (__DF__.dev.world.devTeleport); the
    aim (real pointer-lock mouse motion), the walk (W) and the fire (LMB) are real input. A wash must come within
    `budget_s` of SIM time of a placement (measured in sim ticks: the shared box runs the sim at a fraction of real time
    under load); a foe that runs off (> 18 m), is washed by someone else or outlasts the budget is replaced by a new
    placement (at most `max_place`). → {ok, target, secs (sim), placements, washed, score, reason}"""
    kb, ms = sess.page.keyboard, sess.page.mouse
    seen = set()
    new_events(sess, seen, 512)                  # everything before this call is old
    out = {"ok": False, "target": None, "secs": None, "placements": [], "washed": None, "score": None, "reason": None,
           "humanWashed": 0, "refills": 0}
    firing = walking = False
    tgt_id, t_place, placed = None, 0, 0
    t_end = time.time() + max(240.0, budget_s * max_place * 6)          # a wall cap only; the window is sim time
    try:
        while time.time() < t_end:
            m = match_info(sess) or {}
            rs = {r["id"]: r for r in m.get("runners") or []}
            me = rs.get(0) or {}
            # drain the events BEFORE the phase test: the wash that reaches the limit ends the match on its own tick
            for e in new_events(sess, seen):
                if e.get("t") == "washed" and e.get("by") == 0 and e.get("victim") == tgt_id and out["washed"] is None:
                    out["washed"] = e
                    out["secs"] = round(((e.get("tick") or 0) - t_place) / 60.0, 2)
                elif e.get("t") == "score" and e.get("pid") == 0 and out["score"] is None:
                    out["score"] = e
                elif e.get("t") == "washed" and e.get("victim") == 0:
                    out["humanWashed"] += 1
            if m.get("phase") != "live" and (out["washed"] is None or out["score"] is None):
                out["reason"] = "match phase %r" % m.get("phase")
                break
            if out["washed"] is not None and out["score"] is not None:
                out["ok"] = out["secs"] is not None and out["secs"] <= budget_s
                if not out["ok"]:
                    out["reason"] = "the wash came %.1f s after its placement (window %.0f s)" % (out["secs"], budget_s)
                break
            if out["washed"] is not None:
                time.sleep(0.05)               # the 'score' event is pushed right after its 'washed' (W1); next drain
                continue
            if not me.get("alive"):
                if firing:
                    ms.up(button="left"); firing = False
                if walking:
                    kb.up("KeyW"); walking = False
                if out["placements"] and "end" not in out["placements"][-1]:
                    out["placements"][-1]["end"] = "the human was washed"
                wait_alive(sess, 8.0)
                mouse_home(sess)
                tgt_id = None                  # re-place in front of the respawned human
                continue
            tgt = rs.get(tgt_id) if tgt_id is not None else None
            dist = math.hypot(tgt["x"] - me["x"], tgt["z"] - me["z"]) if tgt else 1e9
            if tgt is not None and out["placements"]:
                pl = out["placements"][-1]
                pl["minHp"] = min(pl.get("minHp", 999), round(tgt.get("hp") or 0, 1))
                pl["minDist"] = min(pl.get("minDist", 999), round(dist, 1))
            if tgt is None or not tgt.get("alive") or dist > 18 or ((m.get("tick") or 0) - t_place) / 60.0 > budget_s:
                if tgt is not None and out["placements"] and "end" not in out["placements"][-1]:
                    # why this placement ended (diagnostics: a miss, a run-off, someone else's wash, the window)
                    out["placements"][-1]["end"] = ("washed (not by the human)" if not tgt.get("alive") else
                                                    "ran off %.1f m" % dist if dist > 18 else
                                                    "window over (%.1f s sim)" % (((m.get("tick") or 0) - t_place) / 60.0))
                if placed >= max_place:
                    out["reason"] = "no wash after %d placements" % placed
                    break
                if firing:
                    ms.up(button="left"); firing = False
                cands = [r for r in rs.values() if r["id"] != 0 and r.get("team") != my_team and r.get("alive") and (r.get("protectedT") or 0) <= 0]
                if not cands:
                    time.sleep(0.2)
                    continue
                cands.sort(key=lambda r: math.hypot(r["x"] - me["x"], r["z"] - me["z"]))
                pick = cands[0]
                a = aim_info(sess) or {}
                yaw = a.get("yaw") or 0.0
                node = None
                for dd in (dist_place, dist_place - 1.5, dist_place + 2.0, 4.0):
                    node = sess.safe_js(NAV_NEAR_JS, [me["x"] + dd * math.sin(yaw), me["y"], me["z"] + dd * math.cos(yaw)])
                    if node and node.get("d", 9) < 2.0 and math.hypot(node["x"] - me["x"], node["z"] - me["z"]) > 3.0:
                        break
                    node = None
                if not node:
                    # nothing walkable ahead: turn half round and try again
                    mouse_turn(sess, math.pi / 2, 0.0)
                    time.sleep(0.2)
                    continue
                sess.js("([p, x, y, z, yaw]) => __DF__.dev.world.devTeleport(p, x, y, z, yaw)",
                        [pick["id"], node["x"], node["y"] + 0.05, node["z"], yaw + math.pi])
                placed += 1
                tgt_id, t_place = pick["id"], (match_info(sess) or {}).get("tick") or 0
                out["target"] = pick["id"]
                out["placements"].append({"bot": pick["id"], "name": pick.get("name"), "at": [round(node["x"], 1), round(node["y"], 2), round(node["z"], 1)],
                                          "human": [round(me["x"], 1), round(me["y"], 2), round(me["z"], 1)]})
                time.sleep(0.12)
                continue
            # tank: a stream needs dye — swim on the own dye just laid ahead (real SHIFT + W) when it runs dry
            if (me.get("tank") or 0) < 10:
                if firing:
                    ms.up(button="left"); firing = False
                kb.down("ShiftLeft"); kb.down("KeyW"); time.sleep(0.9); kb.up("KeyW"); kb.up("ShiftLeft")
                walking = False
                out["refills"] += 1
                continue
            aim_at(sess, me, tgt, dist)
            should_walk = dist > 7.0
            if should_walk != walking:
                (kb.down if should_walk else kb.up)("KeyW"); walking = should_walk
            should_fire = dist < 15.0
            if should_fire != firing:
                (ms.down if should_fire else ms.up)(button="left"); firing = should_fire
            time.sleep(0.08)
    finally:
        if firing:
            ms.up(button="left")
        if walking:
            kb.up("KeyW")
    if not out["ok"] and not out["reason"]:
        out["reason"] = "timed out"
    return out


def hud_scores_match(sess, ffa):
    """the HUD's WASHOUT numbers against the sim's scores(): hud().washout.scores == match().scores, and (TEAMS) each chip
    reads '<score> / <limit>' in its crew; (FFA) the panel's own number is the human's crew score. → (ok, detail)"""
    m = match_info(sess) or {}
    h = hud_info(sess) or {}
    wo = h.get("washout") or {}
    sim = m.get("scores") or []
    lim = m.get("limit")
    det = {"sim": sim, "hud": wo.get("scores"), "chips": wo.get("chips"), "me": wo.get("me"), "limit": [lim, h.get("limit")]}
    ok = list(wo.get("scores") or []) == list(sim) and h.get("limit") == lim
    if not ffa:
        chips = wo.get("chips") or {}
        for crew, key in ((1, "sun"), (2, "gulf")):
            want = [sim[crew] if len(sim) > crew else -1, lim if isinstance(lim, int) else -1]
            got = [int(x) for x in re.findall(r"\d+", str(chips.get(key) or ""))][-2:]
            if got != want:
                ok = False
                det.setdefault("chipMismatch", []).append("%s chip %r reads %s (want score / limit %s)" % (key, chips.get(key), got, want))
    else:
        me = me_of(m)
        mine = sim[me.get("team", 1)] if len(sim) > me.get("team", 1) else None
        if str((h.get("ffa") or {}).get("me")) != str(mine):
            ok = False
            det["ffaMe"] = "panel %r vs score %r" % ((h.get("ffa") or {}).get("me"), mine)
        # the live top 3 by score: the scoring crews' best min(3, n) scores, descending, each row's number = its crew's score
        top = (h.get("ffa") or {}).get("top3") or []
        det["top3"] = [(r.get("name"), r.get("team"), r.get("pct")) for r in top]
        pos = sorted((s for s in sim[1:] if s > 0), reverse=True)[:3]
        got = [int(r.get("pct") or -1) if str(r.get("pct") or "").isdigit() else -1 for r in top]
        rows_ok = got == pos and all(len(sim) > (r.get("team") or 0) and sim[r.get("team")] == g for r, g in zip(top, got))
        if not rows_ok:
            ok = False
            det["top3Mismatch"] = "top 3 %s vs the sim's best scores %s" % (det["top3"], pos)
        # review fix A-A5: rows tied on score rank by FEWER times washed (MatchWorld.computeResult's key), never by turf first
        wd = {}
        for r in (m.get("runners") or []):
            wd[r.get("team")] = wd.get(r.get("team"), 0) + (r.get("washedCount") or 0)
        det["washed"] = {r.get("team"): wd.get(r.get("team")) for r in top}
        for a, b in zip(top, top[1:]):
            ta, tb = a.get("team"), b.get("team")
            if len(sim) > max(ta or 0, tb or 0) and sim[ta] == sim[tb] and wd.get(ta, 0) > wd.get(tb, 0):
                ok = False
                det.setdefault("tieOrder", []).append("%s (score %s, washed %s) above %s (score %s, washed %s)" % (
                    a.get("name"), sim[ta], wd.get(ta), b.get("name"), sim[tb], wd.get(tb)))
    return ok, det


def washout_main(args) -> int:
    """CONTRACT_WASHOUT W8 `playtest.py --rule washout [--mode ffa]`: a WASHOUT match with REAL keys and mouse.
      1. the deep link (?rule=washout) names the rule on the loading card, a real click enters play, the match goes live
         with the map's limit (data/maps.json) and all-zero scores; the HUD is WASHOUT's (TEAMS: two chips '0 / L' round
         the timer + the 'TURF (tie-break)' tug label; FFA: your washes + rank + the live top 3);
      2. the human's own shots wash a bot inside the fight window (real_wash: dev placement of the foe for setup only)
         → the 'score' event, the chip / panel shows it at once, the '+1' pop (hud().pops, match().feedback.scorePops);
      3. a bot's credited wash counts too: the HUD follows world.scores() for every crew;
      4. the ending — TEAMS: the horn (TIME); FFA: the limit (setup, declared: devSetScore(own crew, limit − 1), then a
         second REAL wash reaches the limit → endedBy 'limit' at once);
      5. the victory slate: the rule's scoreboard of all 8 runners with W and D equal to the sim's (runners[].washes /
         washedCount), the final scores equal to result.scores, the ending tag LIMIT REACHED / TIME matching
         result.endedBy, the stamp (TEAMS: THE HARBOR CHOSE A COLOR.), the stinger;
      6. a real click on PLAY AGAIN → match #2, scores back to 0, the HUD chips back to '0 / L', the slate gone.
    Shots _shots/wo_pt_<mode>_<map>_*.png, report playtest_washout[_ffa]. Exit 0 pass · 1 fail · 2 not judged."""
    ffa = args.mode == "ffa"
    mode_s = "ffa" if ffa else "teams"
    if args.match_seconds is None:
        args.match_seconds = 150.0 if ffa else 100.0
    q = {"map": args.map, "dev": 1, "matchSeconds": int(args.match_seconds), "seed": args.seed, "rule": "washout"}
    if args.kit != "mist-rasp":
        q["kit"] = args.kit
    if ffa:
        q["mode"] = "ffa"
    url = build_url(args.base, **q)
    SHOT_PREFIX[0] = "wo_pt_%s_%s" % (mode_s, args.map)
    lim_data = map_limits(args.map).get("ffaLimit" if ffa else "teamLimit")
    rep = {"url": url, "headless": args.headless, "size": [args.width, args.height], "mode": mode_s, "map": args.map, "rule": "washout"}
    problems, notes, shots, checks = [], [], {}, {}
    fatal = None
    sess = Session(args, "playtest_washout")
    try:
        sess.start()
    except Exception as e:
        sess.close()
        print("SETUP FAILED: %s" % (str(e) if isinstance(e, HarnessError) else repr(e)))
        print("RESULT: FAIL")
        return 2
    try:
        sess.goto(url)
        # 1. the loading / play card names the rule (the deep link's mode line, W4: exact text of `.df-mode > span`)
        line = None
        if sess.wait_df(args.wait) and sess.wait_phase("ready", args.wait)[0]:
            line = sess.safe_js("() => { const s = document.querySelector('#df-boot .df-mode > span'); return s ? s.textContent : null; }")
        want_line = MODE_LINE_FFA_WASHOUT if ffa else MODE_LINE_WASHOUT
        checks["modeLine"] = {"want": want_line, "card": line}
        if line != want_line:
            problems.append("the play card's mode line reads %r (want exactly %r)" % (line, want_line))
        entered, fatal = enter_live(sess, args, notes, problems, "washout", "countdown", shots)
        rep["entered"] = entered
        my_team = 1
        if not fatal:
            time.sleep(0.4)
            m = match_info(sess) or {}
            h = hud_info(sess) or {}
            me = me_of(m)
            my_team = me.get("team", 1)
            lim = m.get("limit")
            wo = h.get("washout") or {}
            checks["live"] = {"rule": m.get("rule"), "limit": lim, "limitData": lim_data, "scores": m.get("scores"), "matchMode": m.get("matchMode"),
                              "hudRule": h.get("rule"), "hudLimit": h.get("limit"), "chips": wo.get("chips"), "tugLabel": wo.get("tugLabel"),
                              "ffa": {k: (h.get("ffa") or {}).get(k) for k in ("me", "rank", "top3")} if ffa else None, "myTeam": my_team}
            if m.get("rule") != "washout" or m.get("matchMode") != mode_s:
                problems.append("the deep link did not start a WASHOUT %s match (rule %r, mode %r)" % (mode_s, m.get("rule"), m.get("matchMode")))
            if not isinstance(lim, int) or lim != lim_data:
                problems.append("the match plays to limit %r, data/maps.json %s.washout says %r" % (lim, args.map, lim_data))
            if any(m.get("scores") or [1]):
                problems.append("scores are not all 0 at the start (%s)" % m.get("scores"))
            if h.get("rule") != "washout" or h.get("limit") != lim:
                problems.append("the HUD is not WASHOUT's (rule %r, limit %r)" % (h.get("rule"), h.get("limit")))
            ok_s, det = hud_scores_match(sess, ffa)
            if not ok_s:
                problems.append("the HUD's scores at the start do not match the sim: %s" % det)
            if not ffa and norm_ws(wo.get("tugLabel")) != "TURF (tie-break)":
                problems.append("TEAMS WASHOUT: the tug bar label reads %r (want 'TURF (tie-break)')" % wo.get("tugLabel"))
            # the live top 3 lists crews with a score only (as FFA TURF lists crews with turf): empty on an all-zero board
            if ffa and (h.get("ffa") or {}).get("top3"):
                problems.append("FFA WASHOUT: the top 3 lists crews before anyone scored (%s)" % (h.get("ffa") or {}).get("top3"))
            shot(sess, "hud", shots)

        # 2. the human's own shots wash a bot (fight window) → score, chip, '+1'
        if not fatal:
            wait_warm(sess, notes, "before the fight")
            sess.lock_guard("before the fight", notes, problems)
            h0 = hud_info(sess) or {}
            fb0 = (match_info(sess) or {}).get("feedback") or {}
            s0 = list((match_info(sess) or {}).get("scores") or [])
            rw = real_wash(sess, my_team, notes, "wash 1")
            time.sleep(0.12)
            shot(sess, "score_pop", shots)
            time.sleep(0.3)
            h1 = hud_info(sess) or {}
            m1 = match_info(sess) or {}
            fb1 = m1.get("feedback") or {}
            s1 = list(m1.get("scores") or [])
            ok_s, det = hud_scores_match(sess, ffa)
            checks["humanWash"] = {"wash": rw, "scores": [s0, s1], "pops": [h0.get("pops"), h1.get("pops")],
                                   "scorePops": [fb0.get("scorePops"), fb1.get("scorePops")], "hud": det}
            notes.append("wash 1: the foe was dev-placed in front of the human for setup (%d placement(s)); aim, walk and fire were real input"
                         % len(rw.get("placements") or []))
            if not rw.get("ok"):
                problems.append("the human's own shots did not wash a bot inside the %.0f s fight window: %s (placements %s, human washed %d×)" % (
                    16.0, rw.get("reason"), rw.get("placements"), rw.get("humanWashed")))
            else:
                sc = rw.get("score") or {}
                if sc.get("crew") != my_team:
                    problems.append("the human's wash scored for crew %r (want %r): %s" % (sc.get("crew"), my_team, sc))
                if not (len(s1) > my_team and len(s0) > my_team and s1[my_team] >= s0[my_team] + 1):
                    problems.append("the crew score did not rise by the human's wash (%s → %s)" % (s0, s1))
                if not ((h1.get("pops") or 0) >= (h0.get("pops") or 0) + 1 and (fb1.get("scorePops") or 0) >= (fb0.get("scorePops") or 0) + 1):
                    problems.append("no '+1' pop for the human's credited wash (hud pops %s → %s, feedback.scorePops %s → %s)" % (
                        h0.get("pops"), h1.get("pops"), fb0.get("scorePops"), fb1.get("scorePops")))
            if not ok_s:
                problems.append("after the human's wash the HUD's scores do not match the sim: %s" % det)

        # 3. a bot's credited wash counts on the HUD too
        if not fatal:
            seen = set()
            new_events(sess, seen, 512)
            bot_score = None
            t_b = time.time()
            tick_b = (match_info(sess) or {}).get("tick") or 0
            while time.time() - t_b < 400:
                m = match_info(sess) or {}
                if m.get("phase") != "live" or (not ffa and (m.get("timeLeft") or 0) < 6) or ((m.get("tick") or 0) - tick_b) > 60 * 60:
                    break
                for e in new_events(sess, seen):
                    if e.get("t") == "score" and e.get("pid") != 0:
                        bot_score = e
                        break
                if bot_score:
                    break
                time.sleep(0.25)
            time.sleep(0.15)
            ok_s, det = hud_scores_match(sess, ffa)
            checks["botWash"] = {"event": bot_score, "waitWallS": round(time.time() - t_b, 1),
                                 "waitSimS": round(((match_info(sess) or {}).get("tick", 0) - tick_b) / 60.0, 1), "hud": det}
            if not bot_score:
                problems.append("no bot scored a credited wash within 60 s of sim time after the human's (a bot wash must count)")
            elif not ok_s:
                problems.append("after a bot's credited wash the HUD's scores do not match the sim: %s" % det)
            shot(sess, "hud_scores", shots)

        # 4. the ending
        if not fatal:
            tl_pre_end = None
            if ffa:
                # let the fight's leftovers resolve first (dye still in flight, a sea fall credited to the last hitter within
                # 5 s — CONTRACT_WASHOUT W1): 6 s of sim time with the human idle, so the dev score below is not overtaken
                tick_s = (match_info(sess) or {}).get("tick") or 0
                t_s = time.time()
                while time.time() - t_s < 120 and ((match_info(sess) or {}).get("tick") or 0) - tick_s < 6 * 60:
                    time.sleep(0.2)
                m = match_info(sess) or {}
                lim = m.get("limit") or 0
                tl_pre_end = m.get("timeLeft") if m.get("phase") == "live" else None   # A-A6: the clock before the limit wash
                seen2 = set()
                new_events(sess, seen2, 512)
                sess.js("([c, n]) => __DF__.dev.world.devSetScore(c, n)", [my_team, lim - 1])
                sess.df("setTank", 0, 100)
                notes.append("FFA ending: setup devSetScore(own crew %d, limit %d − 1) + setTank(0, 100); the wash that reaches the limit is a REAL one"
                             % (my_team, lim))
                time.sleep(0.2)
                rw2 = real_wash(sess, my_team, notes, "wash 2 (limit)")
                # which 'score' event reached the limit (the human's credited wash: the placed foe, or — when the match ended
                # before the placement — another foe the human's real shots / a credited sea fall washed)
                lim_ev = [e for e in new_events(sess, seen2, 512) if e.get("t") == "score" and (e.get("score") or 0) >= lim]
                rw2["limitEvent"] = lim_ev[:1]
                checks["limitWash"] = rw2
                if not rw2.get("ok"):
                    if lim_ev and lim_ev[0].get("pid") == 0 and lim_ev[0].get("crew") == my_team:
                        notes.append("FFA ending: the human's own credited wash (%s) reached the limit before the placed foe (%s)" % (lim_ev[0], rw2.get("reason")))
                    else:
                        problems.append("FFA: the limit-reaching real wash failed: %s (placements %s, limit event %s)" % (
                            rw2.get("reason"), rw2.get("placements"), lim_ev[:1]))
            else:
                # the horn (TIME): the loaded box runs the sim several times slower than real time, so the clock is cut to
                # 5 s of sim time (setup, declared) — the horn, the tie-breaks and the result are the sim's own path
                tl0 = (match_info(sess) or {}).get("timeLeft")
                sess.df("setTimeLeft", 5)
                notes.append("TEAMS ending: setup setTimeLeft(5) at timeLeft %s (the match then ends on the horn by itself)" % fmt(tl0, 1))
            ok, ph = False, None
            m = match_info(sess) or {}
            deadline = time.time() + (m.get("timeLeft") or 0) * 25 + 120     # timeLeft is sim time: the loaded box runs it at 2–60 ticks/s
            last_live_tl = m.get("timeLeft") if m.get("phase") == "live" else (tl_pre_end if ffa else None)
            while time.time() < deadline:
                ok, ph = wait_match_phase(sess, "ended", 2.0)
                if ok:
                    break
                m_t = match_info(sess) or {}
                if m_t.get("phase") == "live":
                    last_live_tl = m_t.get("timeLeft")
                if sess.phase() == "paused":
                    sess.lock_guard("waiting for the end", notes, problems)
                    mouse_home(sess)
            if not ok:
                problems.append("the WASHOUT match did not end (phase %r)" % ph)
            else:
                # review fix A-A6: a LIMIT ending freezes the timer at the time that was left (never 0:00, which reads as if
                # time ran out); a horn ending reads 0:00
                wait_frames(sess, 3, 10.0)
                m_e = match_info(sess) or {}
                h_e = hud_info(sess) or {}
                tm = str(h_e.get("timer") or "")
                mm = re.match(r"^(\d+):(\d\d)$", tm)
                secs = int(mm.group(1)) * 60 + int(mm.group(2)) if mm else None
                checks["endTimer"] = {"endedBy": m_e.get("endedBy"), "timer": tm, "lastLiveSampled": last_live_tl, "final10": h_e.get("final10")}
                if m_e.get("endedBy") == "limit":
                    cap = math.ceil(last_live_tl) if isinstance(last_live_tl, (int, float)) else None
                    if secs is None or secs <= 0 or (cap is not None and secs > cap):
                        problems.append("LIMIT ending: the timer reads %r (want the time left frozen, 0 < s ≤ %s; last live sample %s)" % (tm, cap, last_live_tl))
                elif m_e.get("endedBy") == "horn" and tm != "0:00":
                    problems.append("HORN ending: the timer reads %r (want 0:00)" % tm)

        # 5. the victory slate
        if not fatal:
            tally, vic = {}, None
            deadline = time.time() + 60
            while time.time() < deadline:
                h = hud_info(sess) or {}
                tally = h.get("tally") or {}
                vic = h.get("victory")
                if tally.get("stamped"):
                    break
                time.sleep(0.2)
            time.sleep(0.6)
            shot(sess, "victory", shots)
            m = match_info(sess) or {}
            res = m.get("result") or {}
            wv = (tally or {}).get("washout") or {}
            rs = m.get("runners") or []
            sim_rows = {r.get("name"): (r.get("washes"), r.get("washedCount"), r.get("team")) for r in rs}
            rows = wv.get("rows") or []
            au = dfd(sess, "audio")
            checks["victory"] = {"text": (vic or "")[:400], "result": {k: res.get(k) for k in ("rule", "scores", "limit", "endedBy", "winner", "tied", "mode")},
                                 "tally": {k: wv.get(k) for k in ("mode", "limit", "endedBy", "tag", "note", "scores", "winners")},
                                 "rows": rows, "sim": sim_rows, "cue": au.get("cue"), "stamped": tally.get("stamped")}
            want_end = "limit" if ffa else "horn"
            if res.get("rule") != "washout" or res.get("endedBy") != want_end:
                problems.append("result rule %r endedBy %r (want washout / %s)" % (res.get("rule"), res.get("endedBy"), want_end))
            if tally.get("rule") != "washout":
                problems.append("the victory slate is not WASHOUT's (tally rule %r)" % tally.get("rule"))
            if norm_ws(wv.get("tag")) != END_TAGS.get(res.get("endedBy"), "?"):
                problems.append("the slate's ending tag %r does not match endedBy %r (want %r)" % (wv.get("tag"), res.get("endedBy"), END_TAGS.get(res.get("endedBy"))))
            if len(rows) != 8:
                problems.append("the slate's scoreboard shows %d runners (want 8)" % len(rows))
            # W = the runner's credited washes; FFA shows its crew's score, which is the same number in play (W1: one crew per
            # runner, one point per credited wash) — except the human's, raised by the declared devSetScore setup above
            sc_all = res.get("scores") or []

            def want_w(r):
                s = sim_rows.get(r.get("name"))
                if ffa and s and len(sc_all) > (s[2] or 0):
                    return sc_all[s[2]]
                return s[0] if s else None
            bad = [(r.get("name"), r.get("w"), r.get("d"), sim_rows.get(r.get("name"))) for r in rows
                   if sim_rows.get(r.get("name")) is None or (r.get("w"), r.get("d")) != (want_w(r), sim_rows[r.get("name")][1])]
            if bad:
                problems.append("slate W / D differ from the sim (name, W, D, sim (washes, washed, team)): %s" % bad[:4])
            if ffa:
                # every runner the setup did not touch: its score IS its credited washes
                drift = [(n, s[0], sc_all[s[2]]) for n, s in sim_rows.items()
                         if s[2] != my_team and len(sc_all) > (s[2] or 0) and sc_all[s[2]] != s[0]]
                if drift:
                    problems.append("FFA WASHOUT: a crew's score ≠ its runner's credited washes (name, washes, score): %s" % drift[:4])
            you = [r for r in rows if r.get("you")]
            if len(you) != 1 or you[0].get("name") != me_of(m).get("name"):
                problems.append("the human's row is not highlighted exactly once (%s)" % you)
            sc = res.get("scores") or []
            if not ffa:
                if VICTORY not in (vic or ""):
                    problems.append("the TEAMS WASHOUT slate misses the stamp %r (text %r)" % (VICTORY, (vic or "")[:200]))
                got = (wv.get("scores") or {})
                if str(got.get("sun")) != str(sc[1] if len(sc) > 1 else None) or str(got.get("gulf")) != str(sc[2] if len(sc) > 2 else None):
                    problems.append("the slate's final scores %s differ from result.scores %s" % (got, sc))
                # the crews' W sums are the crew scores (every credited wash is one runner's W)
                for crew in (1, 2):
                    wsum = sum((r.get("w") or 0) for r in rows if r.get("team") == crew)
                    if len(sc) > crew and wsum != sc[crew]:
                        problems.append("crew %d: the board's W sum %d ≠ its score %d" % (crew, wsum, sc[crew]))
            else:
                st = res.get("standings") or []
                if any((st[i].get("score") or 0) < (st[i + 1].get("score") or 0) for i in range(len(st) - 1)):
                    problems.append("FFA WASHOUT standings are not score-descending: %s" % [(s.get("name"), s.get("score")) for s in st])
                if res.get("winner") != my_team:
                    problems.append("FFA: the human reached the limit but the winner is %r" % res.get("winner"))
                if st and st[0].get("name") and st[0].get("name") not in (vic or ""):
                    problems.append("the FFA WASHOUT slate does not name the winner %r" % st[0].get("name"))
            if au.get("cue") not in ("victory", "defeat"):
                problems.append("the victory slate did not start the victory / defeat stinger (cue %r)" % au.get("cue"))

        # 6. PLAY AGAIN (a real click)
        if not fatal:
            box = None
            try:
                box = sess.page.locator("#df-again").bounding_box(timeout=2000)
            except Exception:
                box = None
            if not box:
                problems.append("PLAY AGAIN button not found on the WASHOUT slate")
            else:
                sess.page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
                sess.page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
                mouse_home(sess)
                time.sleep(0.9)
                m = match_info(sess) or {}
                h = hud_info(sess) or {}
                ok_s, det = hud_scores_match(sess, ffa)
                checks["playAgain"] = {"matchNo": m.get("matchNo"), "phase": m.get("phase"), "scores": m.get("scores"), "endedBy": m.get("endedBy"),
                                       "victory": bool(h.get("victory")), "hud": det, "markers": len(m.get("markers") or []) if ffa else None}
                if m.get("matchNo") != 2 or m.get("phase") not in ("countdown", "live"):
                    problems.append("PLAY AGAIN did not start match #2 (%s)" % checks["playAgain"])
                if any(m.get("scores") or []):
                    problems.append("PLAY AGAIN kept the scores (%s)" % m.get("scores"))
                if not ok_s:
                    problems.append("after PLAY AGAIN the HUD's scores do not match the sim: %s" % det)
                if h.get("victory"):
                    problems.append("the victory slate stayed up after PLAY AGAIN")
                ok, ph = wait_match_phase(sess, "live", 8.0)
                if not ok:
                    problems.append("match #2 did not go live (phase %r)" % ph)
    except Exception as e:
        fatal = fatal or ("harness error: %s" % str(e).splitlines()[0][:400])
    finally:
        release_inputs(sess)
        tl = sess.timeline() if sess.page else []
        diag = sess.diagnostics() if sess.page else {}
        sess.close()
    return finish_report("playtest_washout_ffa" if ffa else "playtest_washout", url, args, rep, checks, shots, notes, problems, diag, tl, fatal,
                         ("hud", "score_pop", "hud_scores", "victory"))


# the painting walk's waypoints must be reachable on foot in a straight line: every 1.5 m of the segment has a nav node
# within 1.4 m on the human's level (no pier gap / channel / wall in between — a sea wash halves the special meter)
NAV_ROUTE_JS = """
([x, y, z, r0, r1, k, seed]) => { const d = window.__DF__ && __DF__.dev; const n = d && d.parts && d.parts.nav; if (!n || !n.x) return [];
  let s = seed >>> 0 || 1; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const N = n.x.length; const out = [];
  const near = (px, pz) => { for (let i = 0; i < N; i++) { if (Math.abs(n.y[i] - y) < 1.2 && Math.abs(n.x[i] - px) < 1.4 && Math.abs(n.z[i] - pz) < 1.4) return true; } return false; };
  for (let t = 0; t < 600 && out.length < k; t++) { const i = Math.floor(rnd() * N); const q = Math.hypot(n.x[i] - x, n.z[i] - z);
    if (q < r0 || q > r1 || Math.abs(n.y[i] - y) > 0.8) continue;
    let ok = true; const steps = Math.ceil(q / 1.5);
    for (let j = 1; j < steps && ok; j++) { const f = j / steps; ok = near(x + (n.x[i] - x) * f, z + (n.z[i] - z) * f); }
    if (ok) out.push({ x: n.x[i], y: n.y[i], z: n.z[i], d: q }); }
  return out; }
"""


def move_px(sess, dx, dy=0.0, steps=12, dt=0.01):
    """a REAL pointer-lock mouse move of (dx, dy) px from the tracked virtual position (see common.mouse_turn)"""
    x0, y0 = getattr(sess, "_mx", None), getattr(sess, "_my", None)
    if x0 is None or y0 is None:
        x0, y0 = sess.args.width / 2.0, sess.args.height / 2.0
        sess.page.mouse.move(x0, y0)
    for i in range(1, steps + 1):
        sess.page.mouse.move(x0 + dx * i / steps, y0 + dy * i / steps)
        time.sleep(dt)
    sess._mx, sess._my = x0 + dx, y0 + dy


def look_gain(sess, px=240):
    """the camera yaw turned by a real +px then −px mouse sweep → rad per px (the live look sensitivity); each read waits
    for the frames that apply the motion (the loaded box draws few frames)"""
    wait_frames(sess, 2, 5.0)
    y0 = (aim_info(sess) or {}).get("yaw") or 0.0
    move_px(sess, px)
    wait_frames(sess, 3, 8.0)
    y1 = (aim_info(sess) or {}).get("yaw") or 0.0
    move_px(sess, -px)
    wait_frames(sess, 3, 8.0)
    return abs(angle_delta(y0, y1)) / float(px)


def wait_aim(sess, pred, cap_s=20.0):
    """poll __DF__.aim() until pred(aim) holds (the camera eases over 0.15 s of frames) → the last read"""
    t = time.time()
    a = aim_info(sess) or {}
    while time.time() - t < cap_s and not pred(a):
        time.sleep(0.05)
        a = aim_info(sess) or {}
    return a


def refill_on_trail(sess, secs=1.2):
    """swim on the own dye just laid ahead (real SHIFT + W) → the tank refills"""
    kb = sess.page.keyboard
    kb.down("ShiftLeft"); kb.down("KeyW"); time.sleep(secs); kb.up("KeyW"); kb.up("ShiftLeft")
    time.sleep(0.15)


def paint_walk(sess, my_team, until, budget_s, log, on_tick=None, wall_cap_s=900.0):
    """paint new floor with REAL keys and mouse: walk (W) toward random reachable nav waypoints 8–20 m off on the human's
    level, the aim tilted to the floor ahead with LMB held; a low tank refills by swimming on the own trail (SHIFT + W).
    Runs until until(match) is true (→ True) or the budget ends (→ False). on_tick(match) may take over the input for a
    moment (it must release what it holds)."""
    kb, ms = sess.page.keyboard, sess.page.mouse
    t0 = time.time()
    tick0 = (match_info(sess) or {}).get("tick") or 0
    wp, wp_t, seed = None, 0.0, int(t0) % 100000
    firing = walking = False
    visited = []
    last_p, last_pt = None, 0.0
    try:
        while time.time() - t0 < wall_cap_s:
            m = match_info(sess) or {}
            if m.get("phase") != "live":
                log["stopped"] = "match phase %r" % m.get("phase")
                return False
            log["simS"] = round(((m.get("tick") or 0) - tick0) / 60.0, 1)
            if log["simS"] > budget_s:
                break
            me = me_of(m)
            if until(m):
                return True
            if on_tick and me.get("alive"):
                if on_tick(m):
                    firing = walking = False          # the hook released everything
                    mouse_home(sess)
                    continue
            if not me.get("alive"):
                if firing:
                    ms.up(button="left"); firing = False
                if walking:
                    kb.up("KeyW"); walking = False
                log["washed"] = log.get("washed", 0) + 1
                wait_alive(sess, 8.0)
                mouse_home(sess)
                wp = None
                continue
            if (me.get("tank") or 0) < 14:
                if firing:
                    ms.up(button="left"); firing = False
                if walking:
                    kb.up("KeyW"); walking = False
                refill_on_trail(sess)
                log["refills"] = log.get("refills", 0) + 1
                continue
            now = ((m.get("tick") or 0) - tick0) / 60.0          # sim seconds: the loaded box runs the sim slowly
            if last_p is None or math.hypot(me["x"] - last_p[0], me["z"] - last_p[1]) > 0.6:
                last_p, last_pt = (me["x"], me["z"]), now
                visited.append(last_p)
            stuck = now - last_pt > 1.2
            if wp is None or stuck or now - wp_t > 5.0 or math.hypot(wp["x"] - me["x"], wp["z"] - me["z"]) < 2.5:
                if stuck:
                    log["stuck"] = log.get("stuck", 0) + 1
                    kb.press("Space")
                    last_pt = now
                seed += 7
                cands = sess.safe_js(NAV_ROUTE_JS, [me["x"], me["y"], me["z"], 8.0, 20.0, 10, seed]) or []
                if not cands:
                    cands = sess.safe_js(NAV_RING_JS, [me["x"], me["y"], me["z"], 5.0, 16.0, 6, seed]) or []
                if cands:
                    # the waypoint farthest from where the walk has been (new floor to dye)
                    def fresh(c):
                        return min([math.hypot(c["x"] - vx, c["z"] - vz) for (vx, vz) in visited[-120:]] or [99.0])
                    wp = max(cands, key=fresh)
                    wp_t = now
                    log["waypoints"] = log.get("waypoints", 0) + 1
                else:
                    wp = None
                    mouse_turn(sess, 0.9, 0.0)
                    continue
            a = aim_info(sess) or {}
            dyaw = angle_delta(a.get("yaw") or 0, yaw_to(me["x"], me["z"], wp["x"], wp["z"]))
            dpitch = (-26 * DEG) - (a.get("pitch") or 0)
            if abs(dyaw) > 0.05 or abs(dpitch) > 0.05:
                mouse_turn(sess, dyaw, dpitch, step_px=40, step_s=0.002)
                wait_frames(sess, 2)
            if not walking:
                kb.down("KeyW"); walking = True
            if not firing:
                ms.down(button="left"); firing = True
            time.sleep(0.12)
        log["stopped"] = "budget %.0f s of sim time (wall cap %.0f s)" % (budget_s, wall_cap_s)
        return False
    finally:
        if firing:
            ms.up(button="left")
        if walking:
            kb.up("KeyW")


def own_dye_underfoot(sess, my_team, kit="mist-rasp"):
    """dye the floor under the feet (aim down, LMB) with short W nudges onto the fresh splat until the own colour is under
    the runner → the colour read (the G9 slick step's method)"""
    kb, ms = sess.page.keyboard, sess.page.mouse
    a0 = aim_info(sess) or {}
    mouse_turn(sess, 0.0, (-64 * DEG) - (a0.get("pitch") or 0))
    under = None
    for attempt in range(4):
        ms.down(button="left"); time.sleep(0.9); ms.up(button="left")
        time.sleep(0.25)
        under = sess.df("teamUnderFeet")[1]
        if under == my_team:
            return under
        for _ in range(6):
            kb.down("KeyW"); time.sleep(0.16); kb.up("KeyW"); time.sleep(0.08)
            under = sess.df("teamUnderFeet")[1]
            if under == my_team:
                return under
    return under


def aim_look_factor(base_fov_deg, zoom):
    """mirror of view/camera.ts aimZoomLookFactor (review fix A-A4): tan(h·zoom) / tan(h·0.72), h = half the base FOV"""
    h = float(base_fov_deg) * DEG / 2.0
    return math.tan(h * zoom) / math.tan(h * 0.72)


AIR_SPECIAL_JS = r"""(ms) => { window.__AIRREC__ = []; const t0 = performance.now();
  const f = () => { const d = window.__DF__ && __DF__.dev; const w = d && d.world; if (w) { const r = w.runners[0];
      const last = window.__AIRREC__[window.__AIRREC__.length - 1];
      if (!last || last[0] !== w.tick) window.__AIRREC__.push([w.tick, r.grounded ? 1 : 0, r.specialActive, +r.special.toFixed(3), r.state]); }
    if (performance.now() - t0 < ms) requestAnimationFrame(f); };
  requestAnimationFrame(f); return true; }"""


def air_special_trial(sess, delay_ticks, shots, tag):
    """review fix A-A1: a REAL Space jump, then a REAL 60 ms SPECIAL (Q) tap `delay_ticks` sim ticks after take-off, with
    a FULL meter (setup: fillSpecial(0), declared by the caller). A per-frame recorder logs the sim's runner 0 (tick,
    grounded, specialActive). → {qBeforeLand, tickLand, start, waitShown, ...}"""
    kb = sess.page.keyboard
    st = lambda: sess.state() or {}  # noqa: E731
    t = time.time()
    while time.time() - t < 120 and (kit_js(sess) or {}).get("specialActive"):
        time.sleep(0.3)
    if not (st().get("player") or {}).get("alive"):
        wait_alive(sess, 30)
    t = time.time()
    while time.time() - t < 20 and not (st().get("player") or {}).get("grounded"):
        time.sleep(0.02)
    sess.df("fillSpecial", 0)
    t = time.time()
    while time.time() - t < 20 and not (((hud_info(sess) or {}).get("special") or {}).get("ready")):
        time.sleep(0.05)
    seen = set()
    new_events(sess, seen, 512)
    fb0 = ((match_info(sess) or {}).get("airSpecial") or {})
    sess.js(AIR_SPECIAL_JS, 240000)
    kb.down("Space"); time.sleep(0.05); kb.up("Space")
    tick_air, t = None, time.time()
    while time.time() - t < 60:
        s = st()
        if not (s.get("player") or {}).get("grounded"):
            tick_air = s.get("tick")
            break
        time.sleep(0.004)
    t = time.time()
    while time.time() - t < 60 and (st().get("tick") or 0) < (tick_air or 0) + delay_ticks:
        time.sleep(0.003)
    tq = st().get("tick")
    kb.down("KeyQ"); time.sleep(0.06); kb.up("KeyQ")
    # mid-air: the ready prompt shows the waiting state ("· on landing")
    wait_seen, t = None, time.time()
    while time.time() - t < 60:
        s = st()
        if (s.get("player") or {}).get("grounded"):
            break
        pr = (((hud_info(sess) or {}).get("special") or {}).get("prompt") or {})
        if pr.get("wait"):
            wait_seen = pr
            break
        time.sleep(0.02)
    if wait_seen:
        shot(sess, "special_air_wait_%s" % tag, shots)
    t = time.time()
    while time.time() - t < 90 and not (st().get("player") or {}).get("grounded"):
        time.sleep(0.01)
    t_land = st().get("tick") or 0
    t = time.time()
    while time.time() - t < 90 and (st().get("tick") or 0) < t_land + 40:
        time.sleep(0.05)
    rec = sess.js("() => window.__AIRREC__ || []") or []
    tick_land = None
    for r in rec:
        if tick_air and r[0] > tick_air and r[1] == 1:
            tick_land = r[0]
            break
    ev = [e for e in new_events(sess, seen, 512) if e.get("t") == "special" and e.get("pid") == 0]
    starts = [e for e in ev if e.get("phase") == "start"]
    fb1 = ((match_info(sess) or {}).get("airSpecial") or {})
    out = {"delay": delay_ticks, "tickAir": tick_air, "tickQ": tq, "tickLand": tick_land,
           "qBeforeLand": (tick_land - tq) if (tick_land and tq) else None, "events": [(e.get("phase"), e.get("tick")) for e in ev],
           "start": starts[0] if starts else None, "waitShown": wait_seen, "airSpecial": [fb0, fb1]}
    # let a started special run out before anything else
    t = time.time()
    while time.time() - t < 120 and (kit_js(sess) or {}).get("specialActive"):
        time.sleep(0.3)
    return out


PAINT_BUDGET_S = 360.0


def controls_main(args) -> int:
    """CONTRACT_CONTROLS C4 (`playtest.py --controls`): AIM on RMB, E = JELLY CHARGE only, the old-save migration, and the
    special that always answers — REAL keys and mouse in a live TEAMS match, NO dev charge.
      page 1 (hold aim) — an OLD save (SUB = [E, RMB], no AIM; written to localStorage before the load) loads as SUB [E]
        + AIM [RMB]; RMB held → the FOV narrows to 0.72 × base (0.5 × for NEEDLE-GLINT), lookScale = aimSens (0.65) and a
        real mouse sweep turns the camera by that fraction of the rest turn, the HUD aims; released → FOV / lookScale /
        HUD back; RMB throws no sub; E throws the JELLY CHARGE. Then the special: the human paints new floor (real walk +
        fire, refills by slick-swimming) — at ~50 % a real Q press is DENIED (the 'denied' event, the chip's
        "Charging — n %" line, the deny tick, no start, the meter kept) — until the meter is FULL (the sim's 'ready' event:
        the HUD's ready prompt "Q CLOUDBURST", the ready cue); then SHIFT held on own dye → slick, Q → the special starts
        and pops the runner out of the slick on the same tick.
        Review fixes (2026-09-30): A-A4 the look at full aim = aimSens × the zoom factor (NEEDLE-GLINT's scope 0.6715);
        B-B1 the ready chip pulses (dfGauge) after the earlier deny, B-B2 the spent chip neither pops nor pulses; A-A3 a
        second real Q while the special runs gets no deny feedback (no chip shake, no "Charging" line, no tick); A-A1 a
        real Q tap ≥ 25 ticks before the landing of a real Space jump, meter full (setup fillSpecial(0)), shows
        "· on landing" in the air and starts the special on the landing tick.
      page 2 (toggle aim) — SETTINGS toggle aim on (the saved setting): an RMB click keeps the zoom after the release,
        a second click ends it.
    Dev hooks used: none for the charge; the localStorage writes above are the SETUP of the saves. Shots
    _shots/ctl_pt_<map>_*.png, report playtest_controls. Exit 0 pass · 1 fail · 2 not judged."""
    kit = args.kit
    if args.match_seconds is None:
        args.match_seconds = 600.0          # room for the paint walk (PAINT_BUDGET_S) + the A-A1 jump after it
    q = {"map": args.map, "dev": 1, "matchSeconds": int(args.match_seconds), "seed": args.seed, "bots": "breeze"}
    if kit != "mist-rasp":
        q["kit"] = kit
    url = build_url(args.base, **q)
    SHOT_PREFIX[0] = "ctl_pt_%s" % args.map
    zoom = 0.5 if kit == "needle-glint" else 0.72
    special_name = "WELLSPRING" if kit in ("sheet-drum", "pop-well") else "CLOUDBURST"
    rep = {"url": url, "headless": args.headless, "size": [args.width, args.height], "kit": kit}
    problems, notes, shots, checks = [], [], {}, {}
    fatal = None
    sess = Session(args, "playtest_controls")
    try:
        sess.start()
    except Exception as e:
        sess.close()
        print("SETUP FAILED: %s" % (str(e) if isinstance(e, HarnessError) else repr(e)))
        print("RESULT: FAIL")
        return 2
    SET_JS = ("(patch) => { const raw = JSON.parse(localStorage.getItem('dyefield.settings.v1') || '{}');"
              " if (patch.oldBindings) { const b = raw.bindings || {}; b.sub = ['KeyE', 'Mouse2']; delete b.aim; raw.bindings = b; }"
              " if (patch.clearBindings) delete raw.bindings;"
              " if ('aimToggle' in patch) { if (patch.aimToggle === null) delete raw.aimToggle; else raw.aimToggle = patch.aimToggle; }"
              " delete raw.aimSens; localStorage.setItem('dyefield.settings.v1', JSON.stringify(raw)); return raw; }")
    kb, ms = None, None
    try:
        # ── page 1: an old save (SUB = E + RMB, no AIM) → the migration, then hold-to-aim, E / RMB, the special
        sess.goto(url)
        if not sess.wait_df(args.wait):
            fatal = "window.__DF__ never appeared"
        else:
            saved = sess.js(SET_JS, {"oldBindings": True, "aimToggle": None})
            notes.append("setup: an OLD saved bindings profile written before the reload: sub %s, no aim" % ((saved or {}).get("bindings") or {}).get("sub"))
            sess.goto(url)
            entered, fatal = enter_live(sess, args, notes, problems, "controls")
            rep["entered"] = entered
        kb, ms = sess.page.keyboard, sess.page.mouse
        my_team = 1
        if not fatal:
            st = (sess.df("settings")[1]) or {}
            b = st.get("bindings") or {}
            raw = sess.safe_js("() => JSON.parse(localStorage.getItem('dyefield.settings.v1') || '{}')") or {}
            checks["migration"] = {"sub": b.get("sub"), "aim": b.get("aim"), "aimSens": st.get("aimSens"), "aimToggle": st.get("aimToggle"),
                                   "savedNow": (raw.get("bindings") or {})}
            if b.get("sub") != ["KeyE"] or b.get("aim") != ["Mouse2"]:
                problems.append("the old save did not migrate: SUB %s / AIM %s (want ['KeyE'] / ['Mouse2'])" % (b.get("sub"), b.get("aim")))
            if st.get("aimSens") != 0.65 or st.get("aimToggle") is not False:
                problems.append("aim settings defaults: aimSens %r (want 0.65), aimToggle %r (want False: hold)" % (st.get("aimSens"), st.get("aimToggle")))
            my_team = me_of(match_info(sess) or {}).get("team", 1)
            wait_warm(sess, notes, "before AIM")
            sess.lock_guard("before AIM", notes, problems)
            mouse_home(sess)
            # AIM held on RMB (real button)
            a0 = aim_info(sess) or {}
            g0 = look_gain(sess)
            shot(sess, "aim_rest", shots)
            ms.down(button="right")
            a1 = wait_aim(sess, lambda a: (a.get("blend") or 0) >= 0.999)
            h1 = hud_info(sess) or {}
            g1 = look_gain(sess)
            shot(sess, "aim_held", shots)
            ms.up(button="right")
            a2 = wait_aim(sess, lambda a: (a.get("blend") or 0) <= 0.001 and not a.get("wanted"))
            wait_frames(sess, 2, 5.0)
            h2 = hud_info(sess) or {}
            base = a0.get("baseFov") or a0.get("fov") or 0
            ratio = (g1 / g0) if g0 else None
            checks["aimHold"] = {"rest": {k: a0.get(k) for k in ("fov", "baseFov", "lookScale", "boom", "wanted")},
                                 "held": {k: a1.get(k) for k in ("fov", "lookScale", "aimSens", "boom", "wanted", "blend", "hud")}, "hudAiming": h1.get("aiming"),
                                 "released": {k: a2.get(k) for k in ("fov", "lookScale", "boom", "wanted")}, "hudAfter": h2.get("aiming"),
                                 "lookGainRadPerPx": [round(g0, 6), round(g1, 6)], "measuredRatio": round(ratio, 3) if ratio else None}
            if not (a1.get("wanted") and abs((a1.get("fov") or 0) - base * zoom) < 0.3):
                problems.append("RMB held: FOV %s (want %.2f = %.2f × base %s), wanted %s" % (a1.get("fov"), base * zoom, zoom, base, a1.get("wanted")))
            # review fix A-A4: the look at full aim = aimSens × the zoom factor (1 for the regular aim; NEEDLE-GLINT's 0.5 scope
            # 0.6715, so it turns the picture at the regular aim's screen-relative speed instead of ~1.4× faster)
            k_zoom = aim_look_factor(base or 68.0, zoom)
            want_ls = 0.65 * k_zoom
            checks["aimHold"]["wantLookScale"] = round(want_ls, 4)
            if not (abs((a1.get("lookScale") or 0) - (a1.get("aimSens") or -1) * k_zoom) < 0.01 and abs((a1.get("aimSens") or 0) - 0.65) < 1e-6):
                problems.append("RMB held: the sensitivity read-back lookScale %s ≠ aimSens %s × zoom factor %.4f (default 0.65 → %.3f)" % (
                    a1.get("lookScale"), a1.get("aimSens"), k_zoom, want_ls))
            if ratio is None or abs(ratio - want_ls) > 0.06:
                problems.append("RMB held: a real mouse sweep turned the camera %s × the rest turn (want ≈ %.3f)" % (None if ratio is None else round(ratio, 3), want_ls))
            if not ((a1.get("boom") or 99) < (a0.get("boom") or 0) - 0.3):
                problems.append("RMB held: the camera did not move in (boom %s → %s)" % (a0.get("boom"), a1.get("boom")))
            if h1.get("aiming") is not True:
                problems.append("RMB held: the HUD reticle / vignette did not switch to aiming (hud aiming %r)" % h1.get("aiming"))
            if not (not a2.get("wanted") and abs((a2.get("fov") or 0) - base) < 1e-3 and a2.get("lookScale") == 1 and h2.get("aiming") is False):
                problems.append("RMB released: not restored (fov %s vs base %s, lookScale %s, wanted %s, hud aiming %s)" % (
                    a2.get("fov"), base, a2.get("lookScale"), a2.get("wanted"), h2.get("aiming")))
            # RMB throws no sub; E throws the JELLY CHARGE
            seen = set()
            new_events(sess, seen, 512)
            k0 = kit_js(sess)
            tank0 = ((sess.state() or {}).get("player") or {}).get("tank")
            ms.down(button="right"); time.sleep(0.3); ms.up(button="right")
            time.sleep(0.5)
            ev = new_events(sess, seen)
            k1 = kit_js(sess)
            rmb_subs = [e for e in ev if e.get("t") == "sub" and e.get("pid") == 0]
            arm(sess, "ethrow", {"t": "sub", "pid": 0, "phase": "throw"}, 150, 3.0)
            kb.down("KeyE"); time.sleep(0.06); kb.up("KeyE")
            r = await_armed(sess, "ethrow", 3.5)
            if r.get("ok"):
                shot(sess, "sub_e", shots)
                sess.df("freeze", False)
            k2 = kit_js(sess)
            checks["subKeys"] = {"tank": tank0, "subCost": ((hud_info(sess) or {}).get("sub") or {}).get("cost"), "rmb": {"subs": [k0.get("subs"), k1.get("subs")], "events": rmb_subs},
                                 "e": {"throw": r.get("ev"), "subs": [k1.get("subs"), k2.get("subs")]}}
            if rmb_subs or (k1.get("subs") or 0) != (k0.get("subs") or 0):
                problems.append("RMB threw a sub (events %s, subs %s → %s)" % (rmb_subs, k0.get("subs"), k1.get("subs")))
            if not r.get("ok"):
                problems.append("E did not throw the JELLY CHARGE (no 'sub' throw event; tank %s)" % tank0)

        # the special: paint → a denied press at ~50 % → full → slick → Q
        if not fatal:
            sp = {"deny": None}
            log = {}

            def deny_hook(m):
                me = me_of(m)
                v = me.get("special") or 0
                if sp["deny"] is not None or not (0.4 <= v <= 0.75) or me.get("specialActive"):
                    return False
                release_inputs(sess)
                time.sleep(0.25)
                me = me_of(match_info(sess) or {})
                v = me.get("special") or 0
                h0 = hud_info(sess) or {}
                au0 = dfd(sess, "audio")
                fb0 = (match_info(sess) or {}).get("feedback") or {}
                seen_d = set()
                new_events(sess, seen_d, 512)
                arm(sess, "deny", {"t": "special", "pid": 0, "phase": "denied"}, 90, 2.0)
                kb.down("KeyQ"); time.sleep(0.06); kb.up("KeyQ")
                r = await_armed(sess, "deny", 2.5)
                hd = hud_info(sess) or {}
                shot(sess, "special_denied", shots)
                if r.get("ok"):
                    sess.df("freeze", False)
                # nothing may start for 0.6 s of SIM time after the press (the buffer is 0.35 s; the box runs the sim slowly)
                t_w, tk_d = time.time(), ((r.get("ev") or {}).get("tick") or (match_info(sess) or {}).get("tick") or 0)
                while time.time() - t_w < 90 and ((match_info(sess) or {}).get("tick") or 0) < tk_d + 36:
                    time.sleep(0.1)
                ev = new_events(sess, seen_d)
                me2 = me_of(match_info(sess) or {})
                au1 = dfd(sess, "audio")
                fb1 = (match_info(sess) or {}).get("feedback") or {}
                spd = hd.get("special") or {}
                washed_in = [e for e in ev if e.get("t") == "washed" and e.get("victim") == 0]
                if (washed_in or (me2.get("washedCount") or 0) > (me.get("washedCount") or 0)) and len(sp.setdefault("denyWashed", [])) < 3:
                    # a bot washed the human inside the judged window (fix lane run 3: the meter halved to 0.206 and the HUD
                    # hid the prompt with the dead runner) — that press is not judged; the next pass through 40–75 % retries
                    sp["denyWashed"].append({"meter": round(v, 3), "meterAfter": round(me2.get("special") or 0, 3), "event": bool(r.get("ok"))})
                    return True
                sp["deny"] = {"meter": round(v, 3), "event": r.get("ev"), "prompt": spd.get("prompt"), "denies": [(h0.get("special") or {}).get("denies"), spd.get("denies")],
                              "denyLeft": spd.get("denyLeft"), "chipPct": spd.get("chipPct"),
                              "starts": [e for e in ev if e.get("t") == "special" and e.get("pid") == 0 and e.get("phase") == "start"],
                              "meterAfter": round(me2.get("special") or 0, 3), "tick": [(au0.get("counts") or {}).get("tick"), (au1.get("counts") or {}).get("tick")],
                              "feedbackDenied": [fb0.get("denied"), fb1.get("denied")]}
                return True

            def full(m):
                me = me_of(m)
                return (me.get("special") or 0) >= 1 and me.get("specialReady") is True and me.get("alive") and not me.get("specialActive")

            wait_warm(sess, notes, "before painting")
            seen_r = set()
            new_events(sess, seen_r, 512)
            t_p = time.time()
            # the sim-time budget: a wash keeps half the meter (keepOnWashed 0.5), and breeze bots wash the painting
            # human ~1x / 20 s, so a 200 s budget missed full on unlucky runs (fix lane: 9 washes, meter 0.30 / 0.41)
            got_full = paint_walk(sess, my_team, full, PAINT_BUDGET_S, log, on_tick=deny_hook)
            release_inputs(sess)
            m = match_info(sess) or {}
            me = me_of(m)
            ready_ev = [e for e in new_events(sess, seen_r, 512) if e.get("t") == "special" and e.get("pid") == 0 and e.get("phase") == "ready"]
            sp["paint"] = {"full": got_full, "seconds": round(time.time() - t_p, 1), "meter": me.get("special"), "ready": me.get("specialReady"),
                           "painted": me.get("painted"), "log": log, "readyEvents": len(ready_ev)}
            d = sp["deny"]
            if not d:
                problems.append("SPECIAL deny: the meter never sat between 40 and 75 %% with the human alive to press Q (paint %s)" % sp["paint"])
            else:
                pr = d.get("prompt") or {}
                pct = int(round((d.get("meter") or 0) * 100))
                if not d.get("event"):
                    problems.append("SPECIAL deny: Q at %d %% gave no 'denied' event" % pct)
                if d.get("starts"):
                    problems.append("SPECIAL deny: Q at %d %% STARTED the special (%s)" % (pct, d.get("starts")))
                if pr.get("kind") != "deny" or "Charging" not in (pr.get("text") or "") or not pr.get("shown"):
                    problems.append("SPECIAL deny: the 'Charging — n %%' line did not show (prompt %s)" % pr)
                else:
                    nums = [int(x) for x in "".join(ch if ch.isdigit() else " " for ch in pr.get("text") or "").split()]
                    if not nums or abs(nums[0] - pct) > 2:
                        problems.append("SPECIAL deny: the line %r does not show the meter %d %%" % (pr.get("text"), pct))
                dn = d.get("denies") or [0, 0]
                if not ((dn[1] or 0) >= (dn[0] or 0) + 1):
                    problems.append("SPECIAL deny: the chip did not register the deny (denies %s)" % dn)
                tk = d.get("tick") or [0, 0]
                if not ((tk[1] or 0) >= (tk[0] or 0) + 1):
                    problems.append("SPECIAL deny: no soft deny tick sounded (audio counts.tick %s)" % tk)
                if (d.get("meterAfter") or 0) < (d.get("meter") or 0) - 0.02:
                    problems.append("SPECIAL deny: the meter dropped after the denied press (%s → %s)" % (d.get("meter"), d.get("meterAfter")))
            if not got_full:
                problems.append("SPECIAL: the meter never filled by painting within %.0f s (paint %s)" % (PAINT_BUDGET_S, sp["paint"]))
            else:
                time.sleep(0.4)
                h = hud_info(sess) or {}
                au = dfd(sess, "audio")
                spc = h.get("special") or {}
                pr = spc.get("prompt") or {}
                sp["readyHud"] = {"ready": spc.get("ready"), "key": spc.get("key"), "prompt": pr, "audioReady": (au.get("counts") or {}).get("special_ready"),
                                  "chipClass": spc.get("chipClass"), "chipAnim": spc.get("chipAnim"), "reduceMotion": h.get("reduceMotion")}
                shot(sess, "special_ready", shots)
                # review fix B-B1: the earlier DENIED press must not mask the ready chip — its ring pulse (dfGauge) runs and
                # the spent 'deny' class is gone once the meter is full
                if d:
                    cls = (spc.get("chipClass") or "").split()
                    if "deny" in cls:
                        problems.append("SPECIAL ready after a deny: the chip still carries the spent 'deny' class (%r)" % spc.get("chipClass"))
                    if not h.get("reduceMotion") and "dfGauge" not in (spc.get("chipAnim") or ""):
                        problems.append("SPECIAL ready after a deny: the chip's ready pulse does not run (animation %r, class %r)" % (
                            spc.get("chipAnim"), spc.get("chipClass")))
                if not ready_ev:
                    problems.append("SPECIAL: the meter filled but no 'ready' event was drained")
                if not spc.get("ready") or spc.get("key") != "Q":
                    problems.append("SPECIAL ready: the chip is not ready / the key badge is %r (want 'Q')" % spc.get("key"))
                if pr.get("kind") != "ready" or special_name not in (pr.get("text") or "") or pr.get("key") != "Q" or not pr.get("shown"):
                    problems.append("SPECIAL ready: the prompt under the reticle is not 'Q %s' (prompt %s)" % (special_name, pr))
                if not ((au.get("counts") or {}).get("special_ready") or 0) >= 1:
                    problems.append("SPECIAL ready: the ready cue did not play (audio counts %s)" % au.get("counts"))
                # slick on own dye, then Q. A bot can wash the idle human between the 'ready' readback and here (a wash keeps
                # half the meter: specials keepOnWashed 0.5 — fix lane run 1: meter 0.51 at the Q press): paint to full again
                # (real input, still no dev charge) instead of judging a press the meter could not answer
                washes_seen = []
                for attempt in range(3):
                    me_now = me_of(match_info(sess) or {})
                    if not full(match_info(sess) or {}):
                        notes.append("slick step attempt %d: the meter is not full (meter %s, washed %s× so far) → painted to full again (real input)"
                                     % (attempt + 1, round(me_now.get("special") or 0, 3), me_now.get("washedCount")))
                        if paint_walk(sess, my_team, full, PAINT_BUDGET_S, {}):
                            release_inputs(sess)
                            time.sleep(0.3)
                    me = me_of(match_info(sess) or {})
                    wc0 = me.get("washedCount") or 0
                    if (me.get("tank") or 0) < 25:
                        refill_on_trail(sess)
                    under = own_dye_underfoot(sess, my_team, kit)
                    slicked, samples = False, []
                    kb.down("ShiftLeft")
                    t_s = time.time()
                    while time.time() - t_s < 2.0:
                        p = (sess.state() or {}).get("player") or {}
                        samples.append((p.get("state"), p.get("slickForm")))
                        if p.get("slickForm"):
                            slicked = True
                            break
                        time.sleep(0.08)
                    time.sleep(0.25)
                    seen_q = set()
                    new_events(sess, seen_q, 512)
                    m_b = match_info(sess) or {}
                    pre = me_of(m_b)
                    if full(m_b) or attempt == 2:
                        break
                    # washed between the check above and the slick (a wash keeps half the meter): try again, never judge it
                    washes_seen.append({"attempt": attempt + 1, "washedCount": [wc0, pre.get("washedCount")], "meter": round(pre.get("special") or 0, 3)})
                    kb.up("ShiftLeft")
                    time.sleep(0.2)
                if washes_seen:
                    notes.append("slick step: the meter was lost before the Q press %d× (%s) — retried; the judged press had meter %s"
                                 % (len(washes_seen), washes_seen, round(pre.get("special") or 0, 3)))
                arm(sess, "spstart", {"t": "special", "pid": 0, "phase": "start"}, 170 if special_name == "CLOUDBURST" else 300, 3.0)
                kb.down("KeyQ"); time.sleep(0.06); kb.up("KeyQ")
                r = await_armed(sess, "spstart", 3.5)
                ev = new_events(sess, seen_q, 512)
                p_after = (sess.state() or {}).get("player") or {}
                shot(sess, "special_from_slick", shots)
                if r.get("ok"):
                    sess.df("freeze", False)
                kb.up("ShiftLeft")
                start_ev = r.get("ev") or {}
                slick_off = [e for e in ev if e.get("t") == "slick" and e.get("pid") == 0 and e.get("on") is False]
                sp["fromSlick"] = {"underFeet": under, "slicked": slicked, "samples": samples[-5:], "lostMeter": washes_seen,
                                   "before": {k: pre.get(k) for k in ("slickForm", "state", "special", "specialReady", "washedCount", "alive")},
                                   "start": start_ev, "slickOff": slick_off[:2], "after": {k: p_after.get(k) for k in ("slickForm", "state")}}
                if not slicked:
                    problems.append("SPECIAL: holding SHIFT on own dye never entered slick before the Q press (under %r, samples %s)" % (under, samples[-5:]))
                elif not r.get("ok") and not full(m_b):
                    # qa lane 2026-10-01: the 3rd attempt used to fall through to the verdict below even when the meter was
                    # no longer full (run: meter 0.216 after 19 washes) — a press the core must deny (C2), mislabelled as
                    # "with a FULL meter". Still a gate failure (the step proved nothing), but named for what it is.
                    problems.append("SPECIAL (NOT JUDGED → fail): the meter was not full at the slick step's Q press after %d attempt(s) "
                                    "(before %s; meter lost to washes %s)" % (len(washes_seen) + 1, sp["fromSlick"]["before"], washes_seen))
                elif not r.get("ok"):
                    problems.append("SPECIAL: Q while slicked with a FULL meter did not start the special (before %s)" % sp["fromSlick"]["before"])
                else:
                    if not any(e.get("tick") == start_ev.get("tick") for e in slick_off):
                        problems.append("SPECIAL: starting from the slick did not pop the runner out on the same tick (slick-off events %s, start tick %s)" % (
                            slick_off[:3], start_ev.get("tick")))
                    # review fix B-B2: the meter is spent (0) — the chip is charging, so no ready pop / ring pulse runs
                    wait_frames(sess, 3, 10.0)
                    time.sleep(0.2)
                    spc2 = (hud_info(sess) or {}).get("special") or {}
                    sp["chipAfterStart"] = {"class": spc2.get("chipClass"), "anim": spc2.get("chipAnim"), "pct": spc2.get("pct")}
                    if "pop" in (spc2.get("chipClass") or "").split() or (spc2.get("chipAnim") or "none") != "none":
                        problems.append("SPECIAL started (meter %s %%): the chip still pops / pulses as if ready (class %r, animation %r)" % (
                            spc2.get("pct"), spc2.get("chipClass"), spc2.get("chipAnim")))
                    # review fix A-A3: a second REAL Q while the special runs — the core denies it (C2), but it is no failure:
                    # no chip shake, no "Charging — n %" line, no deny tick
                    me_r = kit_js(sess) or {}
                    if me_r.get("specialActive"):
                        h_a = hud_info(sess) or {}
                        au_a = dfd(sess, "audio")
                        fb_a = (match_info(sess) or {}).get("feedback") or {}
                        seen_a = set()
                        new_events(sess, seen_a, 512)
                        arm(sess, "deny2", {"t": "special", "pid": 0, "phase": "denied"}, 0, 3.0)
                        kb.down("KeyQ"); time.sleep(0.06); kb.up("KeyQ")
                        r2 = await_armed(sess, "deny2", 3.5)
                        if r2.get("ok"):
                            sess.df("freeze", False)
                        wait_frames(sess, 3, 10.0)
                        time.sleep(0.3)
                        h_b = hud_info(sess) or {}
                        au_b = dfd(sess, "audio")
                        fb_b = (match_info(sess) or {}).get("feedback") or {}
                        spa, spb = (h_a.get("special") or {}), (h_b.get("special") or {})
                        sp["pressWhileActive"] = {"active": me_r.get("specialActive"), "denied": r2.get("ev"), "denies": [spa.get("denies"), spb.get("denies")],
                                                  "prompt": spb.get("prompt"), "tick": [(au_a.get("counts") or {}).get("tick"), (au_b.get("counts") or {}).get("tick")],
                                                  "feedbackDenied": [fb_a.get("denied"), fb_b.get("denied")]}
                        pa = sp["pressWhileActive"]
                        if not r2.get("ok"):
                            notes.append("A-A3 step: the core emitted no 'denied' for a Q press while %s ran (C2 says it does): %s" % (me_r.get("specialActive"), pa))
                        else:
                            if (spb.get("denies") or 0) != (spa.get("denies") or 0) or (fb_b.get("denied") or 0) != (fb_a.get("denied") or 0):
                                problems.append("SPECIAL running: a second Q gave the deny feedback (HUD denies %s, feedback.denied %s)" % (pa["denies"], pa["feedbackDenied"]))
                            if ((spb.get("prompt") or {}).get("kind")) == "deny":
                                problems.append("SPECIAL running: a second Q showed the 'Charging — n %%' line (%s)" % spb.get("prompt"))
                            if (pa["tick"][1] or 0) != (pa["tick"][0] or 0):
                                problems.append("SPECIAL running: a second Q sounded the deny tick (audio counts.tick %s)" % pa["tick"])
                    else:
                        notes.append("A-A3 step skipped: the special had already ended before the second Q (%s)" % me_r)
            # review fix A-A1: a REAL Q tap mid-jump with a FULL meter (setup: fillSpecial(0)) is held for the landing and starts
            # the special on the landing tick — even when pressed at the apex, far outside the core's own 0.35 s wait. Its full
            # meter is a declared setup, so it runs even when the painting walk above did not fill the meter
            if (match_info(sess) or {}).get("phase") == "live":
                trials = []
                for dly in (8, 4, 2):
                    tr = air_special_trial(sess, dly, shots, "d%d" % dly)
                    trials.append(tr)
                    if (tr.get("qBeforeLand") or 0) >= 25:
                        break
                sp["airTap"] = trials
                notes.append("A-A1 step: __DF__.fillSpecial(0) is the SETUP of a full meter before the jump (the paint-to-full path is proven above); Space and Q are real keys")
                tr = trials[-1]
                qb, tl, stv = tr.get("qBeforeLand"), tr.get("tickLand"), tr.get("start") or {}
                af = tr.get("airSpecial") or [{}, {}]
                if not qb or qb < 25:
                    problems.append("A-A1 (NOT JUDGED → fail): no Q tap landed ≥ 25 ticks before the landing in 3 jumps (%s)" % [(t.get("delay"), t.get("qBeforeLand")) for t in trials])
                elif not stv:
                    problems.append("A-A1: a Q tap %d ticks before the landing with a FULL meter started nothing (events %s, airSpecial %s)" % (qb, tr.get("events"), af))
                else:
                    if not (tl and tl - 1 <= (stv.get("tick") or -99) <= tl + 3):
                        problems.append("A-A1: the special started at tick %s, not on the landing tick %s (tap %d ticks before landing)" % (stv.get("tick"), tl, qb))
                    if not ((af[1].get("held") or 0) >= (af[0].get("held") or 0) + 1 and (af[1].get("started") or 0) >= (af[0].get("started") or 0) + 1):
                        problems.append("A-A1: the input layer's hold read-back did not count the held + started press (%s)" % af)
                    if not tr.get("waitShown"):
                        problems.append("A-A1: the ready prompt never showed the waiting state ('· on landing') while the tap waited in the air")
            checks["special"] = sp

        # ── page 2: toggle aim (the saved setting), then leave a default save behind
        if not fatal:
            sess.js(SET_JS, {"clearBindings": True, "aimToggle": True})
            notes.append("setup: SETTINGS toggle aim ON written to the save before the reload (menus.py drives the SETTINGS switch itself)")
            sess.goto(url)
            entered2, f2 = enter_live(sess, args, notes, problems, "controls toggle")
            if f2:
                problems.append("toggle-aim page: %s" % f2)
            else:
                kb, ms = sess.page.keyboard, sess.page.mouse
                wait_warm(sess, notes, "before toggle AIM")
                a0 = aim_info(sess) or {}
                base = a0.get("baseFov") or a0.get("fov") or 0
                ms.down(button="right"); time.sleep(0.08); ms.up(button="right")
                a1 = wait_aim(sess, lambda a: (a.get("blend") or 0) >= 0.999)
                time.sleep(0.3)
                a1 = aim_info(sess) or a1
                h1 = hud_info(sess) or {}
                ms.down(button="right"); time.sleep(0.08); ms.up(button="right")
                a2 = wait_aim(sess, lambda a: (a.get("blend") or 0) <= 0.001 and not a.get("wanted"))
                checks["aimToggle"] = {"toggle": a0.get("toggle"), "afterClick1": {k: a1.get(k) for k in ("wanted", "fov", "lookScale")}, "hud": h1.get("aiming"),
                                       "afterClick2": {k: a2.get(k) for k in ("wanted", "fov", "lookScale")}}
                if a0.get("toggle") is not True:
                    problems.append("toggle aim: the saved setting did not reach the input (toggle %r)" % a0.get("toggle"))
                if not (a1.get("wanted") and abs((a1.get("fov") or 0) - base * zoom) < 0.3 and h1.get("aiming") is True):
                    problems.append("toggle aim: an RMB click did not keep the zoom after the release (%s, hud %s)" % (checks["aimToggle"]["afterClick1"], h1.get("aiming")))
                if not (not a2.get("wanted") and abs((a2.get("fov") or 0) - base) < 1e-3):
                    problems.append("toggle aim: a second RMB click did not end the zoom (%s)" % checks["aimToggle"]["afterClick2"])
                # SETTINGS → REDUCE MOTION reaches the live HUD (main.ts: Hud's reduceMotion option + applySettings →
                # hud.setReduceMotion): ESC → the pause card → SETTINGS → the switch, clicked twice (back to the saved value)
                rm = {"hud0": (hud_info(sess) or {}).get("reduceMotion")}
                kb.press("Escape")
                sess.wait_phase("paused", 20.0)
                try:
                    sess.page.locator("#df-p-settings").click(timeout=15000)
                    time.sleep(0.8)
                    for k in ("1", "2"):
                        sess.page.locator("#dfm-motion").click(timeout=15000)
                        time.sleep(0.8)
                        rm["hud" + k] = (hud_info(sess) or {}).get("reduceMotion")
                        rm["saved" + k] = ((sess.df("settings")[1]) or {}).get("reduceMotion")
                except Exception as e:
                    rm["error"] = str(e).splitlines()[0][:200]
                checks["reduceMotionLive"] = rm
                if not (rm.get("hud1") is (not rm.get("hud0")) and rm.get("saved1") is rm.get("hud1") and rm.get("hud2") is rm.get("hud0")
                        and rm.get("saved2") is rm.get("hud2")):
                    problems.append("SETTINGS → REDUCE MOTION did not reach the live HUD (hud / saved: %s)" % rm)
            sess.js(SET_JS, {"clearBindings": True, "aimToggle": None})
    except Exception as e:
        fatal = fatal or ("harness error: %s" % str(e).splitlines()[0][:400])
    finally:
        try:
            release_inputs(sess)
        except Exception:
            pass
        tl = sess.timeline() if sess.page else []
        diag = sess.diagnostics() if sess.page else {}
        sess.close()
    return finish_report("playtest_controls", url, args, rep, checks, shots, notes, problems, diag, tl, fatal,
                         ("aim_rest", "aim_held", "special_denied", "special_ready", "special_from_slick"))


def finish_report(name, url, args, rep, checks, shots, notes, problems, diag, tl, fatal, need_shots, verdict_word="PLAYTEST"):
    print("=" * 96)
    print("URL          : %s" % url)
    print("mode         : %s Chrome (d3d11) %dx%d" % ("headless" if args.headless else "headed", args.width, args.height))
    print("entered play : %s" % rep.get("entered"))
    for k, v in checks.items():
        print("%-13s: %s" % (k, json.dumps(v, default=str)[:1400]))
    for k, v in shots.items():
        print("shot %-12s: %s" % (k, v or "NOT SAVED"))
    for n in notes:
        print("NOTE         : %s" % n)
    print("lock timeline: %s" % (" | ".join(tl) or "—"))
    print("-" * 96)
    print_diagnostics(diag)
    print("=" * 96)
    rep.update({"checks": checks, "shots": shots, "notes": notes, "diagnostics": diag, "fatal": fatal, "timeline": tl})
    if fatal:
        rep["verdict"] = "NOT JUDGED"
        print("VERDICT: NOT JUDGED — %s" % fatal)
        for p in problems:
            print("   X %s" % p)
        print("report       : %s" % save_report(name, rep, args.base))
        print("RESULT: FAIL")
        return 2
    problems += diag_problems(diag)
    for k in need_shots:
        if not shots.get(k):
            problems.append("screenshot %s_%s was not saved" % (SHOT_PREFIX[0], k))
    rep["problems"] = problems
    rep["verdict"] = ("%s PASS" % verdict_word) if not problems else ("%s FAIL" % verdict_word)
    print("VERDICT: %s" % rep["verdict"])
    for p in problems:
        print("   X %s" % p)
    print("report       : %s" % save_report(name, rep, args.base))
    print("RESULT: %s" % ("OK" if not problems else "FAIL"))
    return 0 if not problems else 1


def main() -> int:
    ap = argparse.ArgumentParser(description="DYEFIELD match playtest (gate G9)")
    add_common_args(ap)
    ap.add_argument("--map", default="pier18")
    ap.add_argument("--match-seconds", type=float, default=None, help="dev match length (default 45 s; FFA 75 s: room for respawn-and-repeat)")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--fight", type=float, default=14.0, help="seconds of real aim + fire toward enemies")
    ap.add_argument("--wait", type=float, default=90.0)
    ap.add_argument("--kits", action="store_true", help="phase 6 kit shots instead of the G9 match playtest")
    ap.add_argument("--kit-list", default="", help="--kits: comma-separated subset (default all four)")
    ap.add_argument("--kit", default="mist-rasp", choices=KITS, help="G9: the human's kit (?kit=)")
    ap.add_argument("--mode", default="teams", choices=("teams", "ffa"), help="CONTRACT_FFA: the match mode (?mode=)")
    ap.add_argument("--rule", default="turf", choices=("turf", "washout"),
                    help="CONTRACT_WASHOUT W8: 'washout' runs the WASHOUT playtest (?rule=washout; TEAMS or --mode ffa) instead of G9")
    ap.add_argument("--controls", action="store_true",
                    help="CONTRACT_CONTROLS C4: AIM on RMB (hold + toggle), E / RMB, the old-save migration, the special denied at ~50 %% and "
                         "started from a slick after painting it full (no dev charge)")
    args = ap.parse_args()
    if args.width == 1280 and args.height == 720:
        args.width, args.height = 1600, 900
    if args.controls:
        return controls_main(args)
    if args.rule == "washout":
        return washout_main(args)
    if args.match_seconds is None:
        args.match_seconds = 75.0 if args.mode == "ffa" else 45.0
    if args.kits:
        return kits_main(args)
    kit = args.kit
    ffa = args.mode == "ffa"
    q = {"map": args.map, "dev": 1, "matchSeconds": int(args.match_seconds), "seed": args.seed}
    if kit != "mist-rasp":
        q["kit"] = kit
    if ffa:
        q["mode"] = "ffa"
    url = build_url(args.base, **q)
    if ffa:
        SHOT_PREFIX[0] = "ffa_ui_pt_%s_%s" % (args.map, kit)
    elif args.map != "pier18" or kit != "mist-rasp":
        SHOT_PREFIX[0] = "pt_%s_%s" % (args.map, kit)
    my_team = 1                                     # teams: SUNCREW; FFA: the default amber crew (read back below)

    rep = {"url": url, "headless": args.headless, "size": [args.width, args.height], "kit": kit, "mode": args.mode}
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
                if ffa:
                    # CONTRACT_FFA F3/F4: 8 crews of one, the human on its crew, the FFA HUD
                    mf = match_info(sess) or {}
                    rs_ = mf.get("runners") or []
                    my_team = me_of(mf).get("team", 1)
                    crews = sorted({r.get("team") for r in rs_})
                    hf = h2.get("ffa") or {}
                    checks["ffaLive"] = {"matchMode": mf.get("matchMode"), "crews": mf.get("crews"), "runnerCrews": [r.get("team") for r in rs_],
                                         "myTeam": my_team, "hudMode": h2.get("mode"), "me": hf.get("me"), "rank": hf.get("rank"),
                                         "crestMarks": [c.get("mark") for c in hf.get("crests") or []]}
                    if mf.get("matchMode") != "ffa" or crews != list(range(1, 9)) or len(rs_) != 8:
                        problems.append("FFA: want 8 runners on crews 1..8 (matchMode %r, crews %s)" % (mf.get("matchMode"), crews))
                    if h2.get("mode") != "ffa" or not hf.get("me") or len({c.get("mark") for c in hf.get("crests") or []}) != 8:
                        problems.append("FFA HUD missing (mode %r, own share %r, crest marks %s)" % (h2.get("mode"), hf.get("me"), checks["ffaLive"]["crestMarks"]))
                sess.js(RECORDER_JS)
                sess.js("() => { const P = window.__PF__; P.dts = []; P.stats = []; P.last = -1; P.on = true; }")
                frames = True
                m_live = match_info(sess) or {}
                rep["botsAtLive"] = [(r["id"], round(r["x"], 1), round(r["z"], 1)) for r in m_live.get("runners") or []]

        # ── 2. walk + fire at the floor ahead
        if not fatal:
            for ffa_try in range(3 if ffa else 1):
                # FFA: every bot is a foe from the first second; a step during which the human was washed
                # is void (its verdicts are dropped) and runs again after the respawn (NOTED)
                if ffa:
                    ffa_rearm(sess)
                w0, n0 = washes_of(sess), len(problems)
                wait_warm(sess, notes, "before firing")
                sess.lock_guard("before firing", notes, problems)
                mouse_home(sess)
                s0 = sess.state() or {}
                p0 = s0.get("player") or {}
                cov0 = own_share(sess, my_team, ffa)
                pt0 = painted_of(sess)
                timer0 = (hud_info(sess) or {}).get("timer")
                kb, ms = sess.page.keyboard, sess.page.mouse
                kb.down("KeyW"); time.sleep(0.8)
                a0 = aim_info(sess) or {}
                mouse_turn(sess, 0.0, (-30 * DEG) - (a0.get("pitch") or -14 * DEG))
                if kit == "needle-glint":
                    # charge → release, four times (a player's line-painting rhythm); the capture lands mid-charge
                    for k in range(4):
                        ms.down(button="left"); time.sleep(0.85)
                        if k == 1:
                            shot(sess, "firing", shots)
                        ms.up(button="left"); time.sleep(0.25)
                    kb.up("KeyW")
                    time.sleep(0.4)
                else:
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
                cov1 = own_share(sess, my_team, ffa)
                pt1 = painted_of(sess)
                ev = (match_info(sess) or {}).get("events") or {}
                h1 = hud_info(sess) or {}
                checks["fire"] = {"tank": [p0.get("tank"), p1.get("tank")], "coverageSun": [cov0, cov1], "shots": ev.get("shot"),
                                  "walked": math.hypot(p1.get("x", 0) - p0.get("x", 0), p1.get("z", 0) - p0.get("z", 0)),
                                  "hudTank": h1.get("tank"), "timer": [timer0, h1.get("timer")], "painted": [pt0, pt1]}
                # SHEET-DRUM drains per METRE rolled (0.85 %/m), not per second of fire, so its bar is 4 % (≈ 4.7 m
                # actually rolled). On Cinder the straight walk from the spawn runs down the beach into the deep channel
                # within ~12 m (a sea wash is correct there), so an 8 % bar measured the map's shoreline, not the roller.
                min_drain = 4 if kit == "sheet-drum" else 8
                if not (isinstance(p0.get("tank"), (int, float)) and isinstance(p1.get("tank"), (int, float)) and p0["tank"] - p1["tank"] >= min_drain):
                    problems.append("firing did not drain the tank (%s → %s)" % (p0.get("tank"), p1.get("tank")))
                # FFA: seven foes (incl. a rival CLOUDBURST over the same patch) can lower the human's NET share while
                # the stream lands, so the verdict is the human's own credit (match().runners[0].painted = weighted m²
                # newly dyed by them, monotonic); the net share is recorded, not judged
                if ffa:
                    if not (pt1 > pt0 + 0.05):
                        problems.append("firing did not dye the court: the human's painted m² %s → %s (own share %s → %s)" % (pt0, pt1, cov0, cov1))
                elif not (cov1 > cov0 + 1e-5):
                    problems.append("firing did not raise coverage.sun (%s → %s)" % (cov0, cov1))
                if ffa:
                    hf1 = h1.get("ffa") or {}
                    checks["ffaHud"] = {"me": hf1.get("me"), "rank": hf1.get("rank"), "top3": hf1.get("top3")}
                    if not hf1.get("top3"):
                        problems.append("FFA HUD: the live top-3 leaderboard is empty after ~4 s of play (%s)" % hf1)
                    elif hf1.get("me") in (None, "0.0%"):
                        problems.append("FFA HUD: own share still %r after painting" % hf1.get("me"))
                need = {"mist-rasp": ("shot", 6), "pop-well": ("shot", 2), "needle-glint": ("beam", 1)}.get(kit)
                if need and not (ev.get(need[0]) or 0) >= need[1]:
                    problems.append("fewer than %d '%s' events after ~3 s of %s fire (%s)" % (need[1], need[0], kit, ev.get(need[0])))
                if kit == "sheet-drum":
                    checks["fire"]["rolled"] = walked_rolled = (p0.get("tank") or 0) - (p1.get("tank") or 0) >= min_drain and ((pt1 > pt0 + 0.05) if ffa else (cov1 > cov0))
                    if not walked_rolled:
                        problems.append("holding LMB while walking with SHEET-DRUM did not roll dye down")
                if h1.get("tank") is not None and abs((h1.get("tank") or 0) - round(p1.get("tank") or 0)) > 2:
                    problems.append("HUD tank pipette %s ≠ runner tank %s" % (h1.get("tank"), p1.get("tank")))
                if timer0 is not None and timer0 == h1.get("timer"):
                    problems.append("the HUD timer did not change in ~4 s (%s)" % timer0)
                audio_check(sess, checks, problems, "audioLive")
                if ffa and washes_of(sess) > w0 and ffa_try < 2:
                    del problems[n0:]
                    notes.append("FFA: the human was washed by a bot during the fire step → waited for the respawn and repeated it")
                    continue
                break

        # ── 3. dye the floor under the feet, then SHIFT → SLICK + refill
        if not fatal:
            for ffa_try in range(3 if ffa else 1):
                # FFA: every bot is a foe from the first second; a step during which the human was washed
                # is void (its verdicts are dropped) and runs again after the respawn (NOTED)
                if ffa:
                    ffa_rearm(sess)
                w0, n0 = washes_of(sess), len(problems)
                wait_warm(sess, notes, "before slick")
                sess.lock_guard("before slick", notes, problems)
                kb, ms = sess.page.keyboard, sess.page.mouse
                a0 = aim_info(sess) or {}
                mouse_turn(sess, 0.0, (-64 * DEG) - (a0.get("pitch") or 0))
                under = None
                for attempt in range(3):
                    if kit == "sheet-drum":
                        # a roll is a moving stroke: roll a metre forward, then back onto it
                        ms.down(button="left"); kb.down("KeyW"); time.sleep(0.5); kb.up("KeyW")
                        kb.down("KeyS"); time.sleep(0.45); kb.up("KeyS"); ms.up(button="left")
                    else:
                        ms.down(button="left"); time.sleep(0.9); ms.up(button="left")
                    time.sleep(0.25)
                    under = sess.df("teamUnderFeet")[1]
                    if under == my_team:
                        break
                    # CHANGED(INTEGRATE): a wash + respawn (early contact on Lockwell) leaves the runner on its own pad,
                    # which is own dye to the sim (not an atlas surface, so teamUnderFeet() is None there).
                    # FFA: the drop pad lies on paintable floor, and counts as own dye whatever is under it (F1)
                    if (under is None or ffa) and sess.safe_js("() => { const g = __DF__.dev && __DF__.dev.game; return !!g && g.world.onOwnPad(g.human); }"):
                        under = "own pad"
                        notes.append("slick check on the own spawn pad (the human was washed and respawned before it)")
                        break
                    if ffa:
                        # FFA: only the human's OWN dye counts (no allies' paint around), and a burst / stream lands a few
                        # metres ahead of the feet: step onto the fresh splat in short real W nudges
                        for _ in range(8):
                            kb.down("KeyW"); time.sleep(0.16); kb.up("KeyW"); time.sleep(0.08)
                            under = sess.df("teamUnderFeet")[1]
                            if under == my_team:
                                break
                        if under == my_team:
                            break
                        continue
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
                if under not in (my_team, "own pad"):
                    problems.append("could not stand on own dye for the slick check (teamUnderFeet %r)" % under)
                if not slicked:
                    problems.append("holding SHIFT on own dye never entered SLICK (samples %s)" % samples[:6])
                # refilled = rose ≥ 10, or filled to the top while slicking (a cheap SHEET-DRUM stroke leaves < 10 to refill)
                if not (refill >= 10 or (tanks and max(tanks) >= 99.5 and refill > 0 and slicked)
                        or (isinstance(tank_before, (int, float)) and tank_before >= 95 and slicked)):
                    problems.append("no tank refill observed while slicking (tank %s → max %s; samples %s)" % (
                        tank_before, max(tanks) if tanks else None, samples[:6]))
                if ffa and washes_of(sess) > w0 and ffa_try < 2:
                    del problems[n0:]
                    notes.append("FFA: the human was washed by a bot during the slick step → waited for the respawn and repeated it")
                    continue
                break

        # ── 4. turn toward enemies and fight (real mouse + keys)
        washes_by_me = washed_me = 0
        bot_max = {}                                   # FFA: bot id → the furthest it got from its live position
        death_read = None
        fight_shot = False
        if not fatal:
            sess.lock_guard("before the fight", notes, problems)
            kb, ms = sess.page.keyboard, sess.page.mouse
            t_f = time.time()
            firing = walking = False
            seen_ev = set()
            closest = 1e9
            bot_start = {r[0]: (r[1], r[2]) for r in rep.get("botsAtLive") or []}
            while time.time() - t_f < args.fight:
                m = match_info(sess) or {}
                if m.get("phase") != "live" or (m.get("timeLeft") or 0) < 12:
                    break                           # leave match time for the death-slate + bots checks
                if ffa:
                    # FFA bots are washed (and respawn on their own pads) often: track each one's furthest excursion
                    for r in m.get("runners") or []:
                        if r["id"] in bot_start:
                            d0 = math.hypot(r["x"] - bot_start[r["id"]][0], r["z"] - bot_start[r["id"]][1])
                            bot_max[r["id"]] = max(bot_max.get(r["id"], 0.0), d0)
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
                tgt, dist = nearest(m, lambda r: r.get("team") != my_team and r.get("alive"))
                if not tgt:
                    time.sleep(0.2)
                    continue
                closest = min(closest, dist)
                a = aim_info(sess) or {}
                want_yaw = yaw_to(me["x"], me["z"], tgt["x"], tgt["z"])
                dy = (tgt["y"] + 0.6) - (me["y"] + 1.35)
                want_pitch = max(-0.5, min(0.35, math.atan2(dy, max(1.0, dist)) - 0.06))
                mouse_turn(sess, angle_delta(a.get("yaw") or 0, want_yaw), want_pitch - (a.get("pitch") or 0), step_px=30, step_s=0.004)
                close_in = {"sheet-drum": 2.5, "needle-glint": 14.0, "pop-well": 7.0}.get(kit, 8.0)
                fire_at = {"sheet-drum": 7.0, "needle-glint": 24.0, "pop-well": 11.0}.get(kit, 15.0)
                should_walk = dist > close_in
                if should_walk != walking:
                    (kb.down if should_walk else kb.up)("KeyW"); walking = should_walk
                should_fire = dist < fire_at
                if kit == "needle-glint" and should_fire and firing and (me.get("charge") or 0) >= 0.95:
                    ms.up(button="left"); firing = False; time.sleep(0.05)   # release at full charge; re-press next loop
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
            if ffa:
                # the kill feed names carry their crews ([A, B] crew ids per `{A} washed {B}` line still on screen)
                checks["fight"]["feedCrews"] = ((hud_info(sess) or {}).get("ffa") or {}).get("feedCrews")
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

        # ── 4b. FFA (CONTRACT_FFA_SPAWNS S3 / S5): a respawn drops in at a NEW site with a transient crew marker + a minimap
        # ping; the marker fades within its 2.5 s life; no permanent FFA pad anywhere
        if not fatal and ffa:
            ffa_respawn_check(sess, my_team, checks, problems, notes, shots)

        # ── 5. bots fighting: turn toward the closest ally/enemy pair
        if not fatal:
            m = match_info(sess) or {}
            rs = [r for r in (m.get("runners") or []) if r.get("alive")]
            pair, bd = None, 1e9
            for a_ in rs:
                for b_ in rs:
                    # teams: an ally / enemy pair; FFA: any two bots (every crew is a foe)
                    if (ffa and a_["id"] != 0 and b_["id"] != 0 and a_["id"] < b_["id"]) or (not ffa and a_["team"] == 1 and b_["team"] == 2 and a_["id"] != 0):
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
                     and (math.hypot(r["x"] - start[r["id"]][0], r["z"] - start[r["id"]][1]) > 5 or (ffa and bot_max.get(r["id"], 0) > 5))]
            checks["bots"] = {"pairDist": bd, "moved": moved, "events": ev}
            if ffa:
                checks["bots"]["maxExcursion"] = {k: round(v, 1) for k, v in sorted(bot_max.items())}
            if len(moved) < 5:
                problems.append("only %d of 7 bots moved > 5 m since the match went live (%s)" % (len(moved), moved))
            # CHANGED(INTEGRATE): the "bots fought" check reads the whole match's counts at the final horn
            # (step 6), not the ~33 s seen here: on Cinder first contact measured 27–41 s into a match

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
            au = dfd(sess, "audio")
            jb = dfd(sess, "juice")
            checks["audioVictory"] = {"cue": au.get("cue"), "errors": au.get("errors"), "meter": au.get("meter"),
                                      "confetti": jb.get("confetti"), "confettiClip": jb.get("confettiClip"), "bursts": jb.get("bursts")}
            if au.get("cue") not in ("victory", "defeat"):
                problems.append("the victory slate did not start the victory / defeat stinger (audio cue %r)" % au.get("cue"))
            if not jb.get("bursts"):
                problems.append("the victory slate fired no confetti burst (juice %s)" % jb)
            ev_end = m.get("events") or {}
            checks["matchEvents"] = {"hit": ev_end.get("hit"), "washed": ev_end.get("washed"), "shot": ev_end.get("shot"),
                                     "springLaunch": ev_end.get("springLaunch")}
            if not (ev_end.get("hit") or 0) > 0:
                problems.append("no 'hit' events in the whole match — the bots never fought (%s)" % ev_end)
            if not vic or VICTORY not in vic:
                problems.append("the victory slate %r does not show %r" % (vic, VICTORY))
            s_, g_, n_ = res.get("sun"), res.get("gulf"), res.get("neutral")
            if ffa:
                ffa_victory_checks(sess, res, vic, au, checks, problems, shots)
            elif not all(isinstance(v, (int, float)) for v in (s_, g_, n_)):
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
                if ffa and any((v or 0) > 0.01 for v in (m.get("coverageByTeam") or [])[1:]):
                    problems.append("PLAY AGAIN kept old FFA paint (coverageByTeam %s)" % m.get("coverageByTeam"))
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
    for k in ("countdownSeen", "liveHud", "ffaLive", "fire", "ffaHud", "audioLive", "slick", "fight", "deathForced", "deathSlate", "bots", "victory",
              "ffaVictory", "audioVictory", "matchEvents", "playAgain"):
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
        print("report       : %s" % save_report("playtest_ffa" if ffa else "playtest", rep, args.base))
        print("RESULT: FAIL")
        return 2
    problems += diag_problems(diag)
    for k in ("countdown", "firing", "slick", "bots", "victory", "death"):
        if not shots.get(k):
            problems.append("screenshot %s_%s was not saved" % (SHOT_PREFIX[0], k))
    rep["problems"] = problems
    rep["verdict"] = "PLAYTEST PASS" if not problems else "PLAYTEST FAIL"
    print("VERDICT: %s" % rep["verdict"])
    for p in problems:
        print("   X %s" % p)
    print("report       : %s" % save_report("playtest_ffa" if ffa else "playtest", rep, args.base))
    print("RESULT: %s" % ("OK" if not problems else "FAIL"))
    return 0 if not problems else 1


def ffa_respawn_check(sess, my_team, checks, problems, notes, shots):
    """CONTRACT_FFA_SPAWNS S2 / S3 / S5 in a live FFA match: the human is washed (dev hook, setup) → it respawns at a site
    other than its last one; a drop-in marker in its crew colour shows there (conformed: hover <= 3 cm, sink <= 1 cm), a
    minimap ping plays, and the marker is gone within its life (every shown marker younger than 2.5 s); the world has no
    FFA pad (padOf null, the deprecated crewPads empty)."""
    wait_alive(sess, 8.0)
    t = time.time()
    while time.time() - t < 3.0 and (me_of(match_info(sess) or {}).get("protectedT") or 0) > 0:
        time.sleep(0.1)                    # a protected runner takes no damage (S4): let the protection run out
    m0 = match_info(sess) or {}
    me0 = me_of(m0)
    site0 = me0.get("spawnSite")
    fb0 = m0.get("feedback") or {}
    pads = sess.safe_js("() => { const g = __DF__.dev && __DF__.dev.game; if (!g) return null; const w = g.world;"
                        " return { padOf: w.padOf(g.human), onOwnPad: w.onOwnPad(g.human), crewPads: (w.crewPads || []).length, sites: w.spawnSites.length }; }")
    seen = set()
    new_events(sess, seen, 512)
    sess.df("damage", 0, 200)
    notes.append("FFA respawn check: the wash is the dev hook __DF__.damage(0, 200) (setup); the site choice, marker, ping and fade are the game's")
    spawn_ev = None
    t = time.time()
    while time.time() - t < 12.0 and not spawn_ev:
        for e in new_events(sess, seen):
            if e.get("t") == "spawn" and e.get("pid") == 0:
                spawn_ev = e
        time.sleep(0.05)
    mk = sess.safe_js("() => __DF__.markers(48, 'active')") or {}
    time.sleep(0.2)
    shot(sess, "respawn_marker", shots)
    m1 = match_info(sess) or {}
    me1 = me_of(m1)
    fb1 = m1.get("feedback") or {}
    site = (spawn_ev or {}).get("site")
    mine = [a for a in (mk.get("active") or []) if a.get("site") == site]
    meas = [p for p in (mk.get("pads") or []) if p.get("i") == site]
    ages, gone_at, alpha_max = [], None, 0.0
    t = time.time()
    while time.time() - t < 4.0:
        act = (match_info(sess) or {}).get("markers") or []
        ages += [a.get("age") or 0 for a in act]
        mine_now = [a for a in act if a.get("site") == site and a.get("crew") == my_team]
        alpha_max = max([alpha_max] + [a.get("alpha") or 0 for a in mine_now])
        if gone_at is None and not mine_now:
            gone_at = round(time.time() - t + 0.2, 2)
        time.sleep(0.2)
    checks["ffaRespawn"] = {"siteBefore": site0, "spawn": spawn_ev, "marker": mine, "measured": meas[:1], "visible": mk.get("visible"),
                            "pings": [fb0.get("pings"), fb1.get("pings")], "markersFb": [fb0.get("markers"), fb1.get("markers")],
                            "goneAfterS": gone_at, "alphaMax": alpha_max, "maxAgeSeen": max(ages) if ages else None, "pads": pads,
                            "humanAt": [round(me1.get("x") or 0, 2), round(me1.get("z") or 0, 2)]}
    if not spawn_ev:
        problems.append("FFA: no 'spawn' event for the human within 12 s of its wash")
        return
    if site == site0:
        problems.append("FFA: the human respawned at the same site as its last spawn (%s)" % site)
    if not mine or mine[0].get("crew") != my_team or not mk.get("visible"):
        problems.append("FFA: no drop-in marker in the human's crew colour at its new site %s (active %s, visible %s)" % (site, mk.get("active"), mk.get("visible")))
    if alpha_max <= 0.2:
        problems.append("FFA: the drop-in marker never became visible (alpha max %.2f)" % alpha_max)
    if meas and not ((meas[0].get("maxHoverCm") or 0) <= 3.0 and (meas[0].get("maxSinkCm") or 0) <= 1.0):
        problems.append("FFA: the drop-in marker does not conform (hover %s cm, sink %s cm)" % (meas[0].get("maxHoverCm"), meas[0].get("maxSinkCm")))
    if math.hypot((me1.get("x") or 0) - spawn_ev.get("x", 0), (me1.get("z") or 0) - spawn_ev.get("z", 0)) > 3.0:
        problems.append("FFA: the human is not at its spawn site after the drop (%s vs site %s)" % (checks["ffaRespawn"]["humanAt"], [spawn_ev.get("x"), spawn_ev.get("z")]))
    if not ((fb1.get("pings") or 0) >= (fb0.get("pings") or 0) + 1):
        problems.append("FFA: no minimap ping for the drop-in (pings %s → %s)" % (fb0.get("pings"), fb1.get("pings")))
    if gone_at is None or gone_at > 3.2:
        problems.append("FFA: the drop-in marker did not fade within its 2.5 s life (still shown after %s s)" % gone_at)
    if ages and max(ages) >= 2.5:
        problems.append("FFA: a marker older than its 2.5 s life was shown (max age %.2f s) — a permanent pad?" % max(ages))
    if not isinstance(pads, dict) or pads.get("padOf") is not None or pads.get("crewPads") != 0:
        problems.append("FFA: the world still has an FFA pad (%s)" % pads)


def ffa_victory_checks(sess, res, vic, au, checks, problems, shots):
    """CONTRACT_FFA F3/F4: the FFA result + slate — shares by crew sum to 1, 8 standings share-descending, the winner by
    strict comparison (a tie → 0 + tied), the slate shows every standing's % and the winner's name, the tally stamped with
    the winner rows marked, and the stinger follows whether the human won."""
    shares = res.get("shares") or []
    st = res.get("standings") or []
    # the tally stamps the winner at 1.75 s after the slate shows: read the slate once it has
    h, tally = {}, {}
    deadline = time.time() + 4.0
    while time.time() < deadline:
        h = hud_info(sess) or {}
        tally = h.get("tally") or {}
        if tally.get("stamped"):
            break
        time.sleep(0.15)
    time.sleep(0.5)
    shot(sess, "victory_stamped", shots)
    rows = tally.get("standings") or []
    me = me_of(match_info(sess) or {})
    my_team = me.get("team")
    tied = res.get("tied") or []
    winners = [res.get("winner")] if res.get("winner") else list(tied)
    human_won = my_team in winners
    checks["ffaVictory"] = {"mode": res.get("mode"), "winner": res.get("winner"), "tied": tied, "standings": [(s.get("name"), round(s.get("share") or 0, 4)) for s in st],
                            "slateWinner": tally.get("winner"), "slateRows": [r.get("text") for r in rows], "stamped": tally.get("stamped"),
                            "humanWon": human_won, "cue": (au or {}).get("cue")}
    if res.get("mode") != "ffa":
        problems.append("FFA: match().result.mode is %r" % res.get("mode"))
    if len(shares) != 9 or abs(sum(shares) - 1) > 1e-3:
        problems.append("FFA: result shares %s do not sum to 1 over 9 slots" % shares)
    if len(st) != 8 or any((st[i].get("share") or 0) < (st[i + 1].get("share") or 0) for i in range(len(st) - 1)):
        problems.append("FFA: want 8 standings, share-descending (%s)" % checks["ffaVictory"]["standings"])
    if st:
        top = st[0].get("share")
        want = [s.get("crew") for s in st if s.get("share") == top]
        if (len(want) == 1 and res.get("winner") != want[0]) or (len(want) > 1 and (res.get("winner") != 0 or sorted(tied) != sorted(want))):
            problems.append("FFA: winner %r / tied %s but the top share belongs to %s" % (res.get("winner"), tied, want))
    for s in st:
        p = "%.1f%%" % ((s.get("share") or 0) * 100)
        if not vic or p not in vic or (s.get("name") or "?") not in vic:
            problems.append("FFA victory slate misses %s %s (text %r)" % (s.get("name"), p, (vic or "")[:200]))
            break
    if len(rows) != 8:
        problems.append("FFA victory slate shows %d standings rows (want 8)" % len(rows))
    if not tally.get("stamped") or not any(r.get("win") for r in rows):
        problems.append("FFA victory tally did not stamp the winner (%s)" % tally)
    for w in winners:
        name = next((s.get("name") for s in st if s.get("crew") == w), None)
        if name and name not in (tally.get("winner") or ""):
            problems.append("FFA victory slate winner line %r misses %s" % (tally.get("winner"), name))
    cue = (au or {}).get("cue")
    if cue in ("victory", "defeat") and cue != ("victory" if human_won else "defeat"):
        problems.append("FFA stinger %r but the human %s" % (cue, "won" if human_won else "lost"))


if __name__ == "__main__":
    raise SystemExit(main())
