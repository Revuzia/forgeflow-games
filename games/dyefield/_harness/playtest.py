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


SHOT_PREFIX = ["pt"]


def shot(sess, name, shots):
    path = os.path.join(SHOTS, "%s_%s.png" % (SHOT_PREFIX[0], name))
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


def wait_event(sess, want, delay_ms=0, timeout_s=4.0):
    try:
        r = sess.page.evaluate(WAIT_EVENT_JS, [want, int(delay_ms), int(timeout_s * 1000)])
    except Exception as e:
        return {"ok": False, "error": str(e).splitlines()[0][:200]}
    return r or {"ok": False}


def pitch_to(sess, deg):
    a = aim_info(sess) or {}
    mouse_turn(sess, 0.0, deg * DEG - (a.get("pitch") or 0))


def kit_js(sess):
    return sess.safe_js("() => { try { return __DF__.kit(); } catch (e) { return null; } }") or {}


def fx_js(sess):
    return sess.safe_js("() => { try { return __DF__.fx(); } catch (e) { return null; } }") or {}


def run_kit(args, kit, shots, problems, notes, rep):
    """one fresh page: enter play for real, then every kit action with real input"""
    url = build_url(args.base, map=args.map, dev=1, kit=kit, seed=args.seed, matchSeconds=300, bots="chill")
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


def main() -> int:
    ap = argparse.ArgumentParser(description="DYEFIELD match playtest (gate G9)")
    add_common_args(ap)
    ap.add_argument("--map", default="pier18")
    ap.add_argument("--match-seconds", type=float, default=45.0)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--fight", type=float, default=14.0, help="seconds of real aim + fire toward enemies")
    ap.add_argument("--wait", type=float, default=90.0)
    ap.add_argument("--kits", action="store_true", help="phase 6 kit shots instead of the G9 match playtest")
    ap.add_argument("--kit-list", default="", help="--kits: comma-separated subset (default all four)")
    ap.add_argument("--kit", default="mist-rasp", choices=KITS, help="G9: the human's kit (?kit=)")
    args = ap.parse_args()
    if args.width == 1280 and args.height == 720:
        args.width, args.height = 1600, 900
    if args.kits:
        return kits_main(args)
    kit = args.kit
    q = {"map": args.map, "dev": 1, "matchSeconds": int(args.match_seconds), "seed": args.seed}
    if kit != "mist-rasp":
        q["kit"] = kit
    url = build_url(args.base, **q)
    if args.map != "pier18" or kit != "mist-rasp":
        SHOT_PREFIX[0] = "pt_%s_%s" % (args.map, kit)

    rep = {"url": url, "headless": args.headless, "size": [args.width, args.height], "kit": kit}
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
            need = {"mist-rasp": ("shot", 6), "pop-well": ("shot", 2), "needle-glint": ("beam", 1)}.get(kit)
            if need and not (ev.get(need[0]) or 0) >= need[1]:
                problems.append("fewer than %d '%s' events after ~3 s of %s fire (%s)" % (need[1], need[0], kit, ev.get(need[0])))
            if kit == "sheet-drum":
                checks["fire"]["rolled"] = walked_rolled = (p0.get("tank") or 0) - (p1.get("tank") or 0) >= 8 and cov1 > cov0
                if not walked_rolled:
                    problems.append("holding LMB while walking with SHEET-DRUM did not roll dye down")
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
                if kit == "sheet-drum":
                    # a roll is a moving stroke: roll a metre forward, then back onto it
                    ms.down(button="left"); kb.down("KeyW"); time.sleep(0.5); kb.up("KeyW")
                    kb.down("KeyS"); time.sleep(0.45); kb.up("KeyS"); ms.up(button="left")
                else:
                    ms.down(button="left"); time.sleep(0.9); ms.up(button="left")
                time.sleep(0.25)
                under = sess.df("teamUnderFeet")[1]
                if under == 1:
                    break
                # CHANGED(INTEGRATE): a wash + respawn (early contact on Lockwell) leaves the runner on its own pad,
                # which is own dye to the sim (not an atlas surface, so teamUnderFeet() is None there)
                if under is None and sess.safe_js("() => { const g = __DF__.dev && __DF__.dev.game; return !!g && g.world.onOwnPad(g.human); }"):
                    under = "own pad"
                    notes.append("slick check on the own spawn pad (the human was washed and respawned before it)")
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
            if under not in (1, "own pad"):
                problems.append("could not stand on own dye for the slick check (teamUnderFeet %r)" % under)
            if not slicked:
                problems.append("holding SHIFT on own dye never entered SLICK (samples %s)" % samples[:6])
            # refilled = rose ≥ 10, or filled to the top while slicking (a cheap SHEET-DRUM stroke leaves < 10 to refill)
            if not (refill >= 10 or (tanks and max(tanks) >= 99.5 and refill > 0 and slicked)
                    or (isinstance(tank_before, (int, float)) and tank_before >= 95 and slicked)):
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
            ev_end = m.get("events") or {}
            checks["matchEvents"] = {"hit": ev_end.get("hit"), "washed": ev_end.get("washed"), "shot": ev_end.get("shot"),
                                     "springLaunch": ev_end.get("springLaunch")}
            if not (ev_end.get("hit") or 0) > 0:
                problems.append("no 'hit' events in the whole match — the bots never fought (%s)" % ev_end)
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
    for k in ("countdownSeen", "liveHud", "fire", "slick", "fight", "deathForced", "deathSlate", "bots", "victory", "matchEvents", "playAgain"):
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
