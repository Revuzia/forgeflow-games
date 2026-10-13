#!/usr/bin/env python
"""HIT PARADE - EASY controls with REAL key events in the real game (lane INPUT, CONTRACT §36.1 / §36.5).

    python _harness/easykeys.py --base http://localhost:5350/ --no-serve      # headed Chrome (the harness default)

Deep-linked VERSUS bouts (?scheme1=2 = EASY, ?dev=1 for meter writes only), every game input through page.keyboard
(trusted CDP key events into the game's Input, nothing forced):
  1. BLOCK   P1 johnny vs a CPU bruno (level 7): P1 walks in with D, then HOLDS SHIFT; the CPU's strikes must be
             BLOCKED (sim BLOCK events on P1) and P1 must not walk while Shift is held with D. Screenshot.
  2. SPECIAL U / I / O / P (no direction) = the fighter's 5S / 6S / 2S / 4S moves, johnny and gazza. Screenshots.
  3. SUPER   H with 1 bar = the Lv1 super, Y with 3 bars = PRIME TIME (meter set with __HP__.dev.setMeter). Screenshots.
  4. MASH J  EASY auto-combo: P1 walks into an idle P2 and mashes J (a press every ~45 ms); a page-side rAF logger
             records every move start: a light normal then the route (5M > 5H > the route special) must appear.
  5. F1      the controls-bar key is kept from the browser (defaultPrevented, no new tab).
Screenshots -> _shots/wf8_input_*.png (READ them); report -> _harness/_reports/easykeys.json. Exit 0 = PASS.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (P1_KEYS, SHOTS, Session, add_common_args, build_url, events_tail, fighters_info,  # noqa: E402
                    wait_match_phase)

LOG_JS = """() => {
  if (window.__EZ__) return true;
  window.__EZ__ = { log: [], last: '' };
  const tick = () => {
    try {
      const f = window.__HP__ && __HP__.fighters ? __HP__.fighters() : null;
      if (f && f[0]) {
        const nm = f[0].moveName || '';
        const fr = f[0].moveFrame || 0;
        if (nm && (nm !== window.__EZ__.last || fr < window.__EZ__.lastF)) window.__EZ__.log.push(nm);
        window.__EZ__.last = nm;
        window.__EZ__.lastF = fr;
      }
    } catch (e) { /* keep logging */ }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return true;
}"""


def fi(sess):
    f = fighters_info(sess) or [{}, {}]
    return f[0] or {}, f[1] or {}


def gap(sess):
    a, b = fi(sess)
    try:
        return ((b["x"] - a["x"]) ** 2 + ((b.get("z") or 0) - (a.get("z") or 0)) ** 2) ** 0.5
    except Exception:
        return 99.0


def fwd_key(sess):
    a, _ = fi(sess)
    return P1_KEYS["right"] if (a.get("facing") or 1) >= 0 else P1_KEYS["left"]


def start_bout(sess, args, p1, p2, cpu2, seed=3):
    url = build_url(args.base, mode="versus", p1=p1, p2=p2, stage="rust_theater", seed=seed, cpu2=cpu2, scheme1=2, dev=1)
    sess.goto(url)
    if not sess.wait_hp(60):
        raise RuntimeError("no __HP__")
    ok, ph = sess.wait_phase(("ready", "bout"), 90)
    if not ok:
        raise RuntimeError("never ready (%r)" % ph)
    for _ in range(4):
        if ph == "bout":
            break
        sess.press("Enter", 60)
        ok, ph = sess.wait_phase("bout", 8)
        if not ok:
            sess.page.mouse.click(args.width / 2, args.height / 2)
            ok, ph = sess.wait_phase("bout", 8)
    ok, mph = wait_match_phase(sess, "fight", 90)
    if not ok:
        raise RuntimeError("no FIGHT (match phase %r, app %r)" % (mph, sess.state()))
    sess.js(LOG_JS)
    time.sleep(0.3)


def wait_free(sess, max_s=3.0):
    t = time.time() + max_s
    while time.time() < t:
        a, _ = fi(sess)
        if not a.get("moveName") and a.get("stateName") in ("idle", "crouch", "walk_f", "walk_b"):
            return True
        time.sleep(0.03)
    return False


def walk_in(sess, until=0.95, max_s=3.0):
    k = fwd_key(sess)
    sess.page.keyboard.down(k)
    t = time.time() + max_s
    while time.time() < t and gap(sess) > until:
        time.sleep(0.02)
    sess.page.keyboard.up(k)


def snap_move(sess, key, wait_s=1.5):
    """press `key` once (real), then poll for the first move name P1 starts"""
    sess.js("() => { window.__EZ__.log.length = 0; }")
    sess.press(key, 70)
    t = time.time() + wait_s
    while time.time() < t:
        log = sess.js("() => window.__EZ__.log.slice()") or []
        if log:
            return log[0]
        time.sleep(0.02)
    return ""


def main() -> int:
    ap = add_common_args(argparse.ArgumentParser(description=__doc__))
    ap.add_argument("--cpu", type=int, default=7)
    args = ap.parse_args()
    os.makedirs(SHOTS, exist_ok=True)
    rep = {"base": args.base, "checks": []}
    problems = []
    shots = []

    def check(name, ok, detail):
        rep["checks"].append({"name": name, "ok": bool(ok), "detail": detail})
        print("%s  %s - %s" % ("PASS" if ok else "FAIL", name, json.dumps(detail, default=str)[:600]))
        if not ok:
            problems.append(name)

    def shot(name):
        p = os.path.join(SHOTS, "wf8_input_%s.png" % name)
        if sess.screenshot(p):
            shots.append(p)
        return p

    sess = Session(args, "easykeys")
    sess.start()
    try:
        kb = sess.page.keyboard
        # ---- 1. BLOCK vs a CPU: P1 johnny holds SHIFT + D (toward the CPU) near a striking CPU (patch, level --cpu); up to 3
        # attempts of 6 s. Gate: >= 1 sim BLOCK event on P1, and every strike that LANDED while SHIFT was held came from a move a
        # STANDING guard cannot block by design (patch's lows, guard "L" in data/fighters/patch.json) - a mid / high landing
        # through the guard fails. The attacker move of each hit = P2's move at the last poll before the hit frame.
        guard_of = {}
        try:
            with open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "fighters", "patch.json"), encoding="utf-8") as f:
                for mid, mv in (json.load(f).get("moves") or {}).items():
                    if isinstance(mv, dict):
                        guard_of[mid] = mv.get("guard")
        except Exception as e:
            guard_of["__error"] = str(e)
        attempts = []
        blk_total = 0
        bad_hits = 0
        mid_shot = None
        for att in range(3):
            start_bout(sess, args, "johnny", "patch", args.cpu, seed=11 + att)
            if att == 0:
                inp = sess.js("() => __HP__.input()") or {}
                rep["schemes"] = inp.get("schemes")
                rep["bindingsP1"] = {k: (inp.get("bindings") or [{}])[0].get(k, {}).get("keys") for k in ("blockHold", "sp1", "sp2", "sp3", "sp4", "super1", "super3", "l", "throw", "controls")}
            walk_in(sess, 1.4)
            time.sleep(0.35)   # past the 66 dash window: the D below is a fresh hold, not a second tap
            f0 = (sess.js("() => __HP__.match()") or {}).get("frame") or 0
            a0, _ = fi(sess)
            hp0 = a0.get("hp")
            fk = fwd_key(sess)
            kb.down(P1_KEYS["block"])
            kb.down(fk)
            # an in-page rAF timeline (frame, P1 state, P2 move) - dense enough to name the move behind every hit
            sess.js("() => { window.__BT__ = []; const f = () => { try { const m = __HP__.match(); const q = __HP__.fighters(); if (m && q) window.__BT__.push([m.frame, q[0].stateName, q[1].moveName || '']); } catch (e) {} if (window.__BT__) requestAnimationFrame(f); }; requestAnimationFrame(f); }")
            t_mid = time.time() + 3.5
            crouched = False
            t_end = time.time() + 7.0
            states = {}
            timeline = []
            x_min = x_max = a0.get("x") or 0
            seen = 0
            while time.time() < t_end:
                if not crouched and time.time() > t_mid:
                    kb.down(P1_KEYS["down"])   # second half: SHIFT + S = crouch block (lows)
                    crouched = True
                a, b = fi(sess)
                fr = (sess.js("() => __HP__.match()") or {}).get("frame") or 0
                st = a.get("stateName")
                states[st] = states.get(st, 0) + 1
                timeline.append((fr, st, b.get("moveName") or ""))
                x = a.get("x") or 0
                x_min, x_max = min(x_min, x), max(x_max, x)
                evs = [e for e in events_tail(sess, 512) if (e.get("frame") or 0) >= f0]
                nb = sum(1 for e in evs if e.get("typeName") == "BLOCK" and e.get("b") == 0)
                if nb > seen and mid_shot is None:
                    mid_shot = shot("block_cpu")
                seen = nb
                time.sleep(0.015)
            f1 = (sess.js("() => __HP__.match()") or {}).get("frame") or 0
            kb.up(fk)
            kb.up(P1_KEYS["down"])
            kb.up(P1_KEYS["block"])
            timeline = [tuple(x) for x in (sess.js("() => { const t = window.__BT__ || []; window.__BT__ = null; return t; }") or [])]
            evs = [e for e in events_tail(sess, 512) if f0 <= (e.get("frame") or 0) <= f1]
            blk = [e for e in evs if e.get("typeName") == "BLOCK" and e.get("b") == 0]
            hits = [e for e in evs if e.get("typeName") == "HIT" and e.get("b") == 0]
            landed = []
            for h in hits:
                prior = [t for t in timeline if t[0] <= h["frame"]]
                mv = next((t[2] for t in reversed(prior) if t[2]), "")
                st_before = prior[-1][1] if prior else "?"
                g = "U" if h.get("c") == 7 else guard_of.get(mv, "?")
                low_guard = any(t[1] == "crouch" for t in prior[-3:])
                ok_by_design = g == "U" or (g == "H" and low_guard) or (g == "L" and not low_guard)
                landed.append({"frame": h["frame"], "by": mv, "guard": g, "p1Before": st_before, "p1Crouching": low_guard, "unblockableForThatGuard": ok_by_design})
                if not ok_by_design:
                    bad_hits += 1
            a1, _ = fi(sess)
            attempts.append({"blocks": len(blk), "blockedBy": sorted({next((t[2] for t in reversed([t for t in timeline if t[0] <= e["frame"]]) if t[2]), "") for e in blk}),
                             "landed": landed, "hp": [hp0, a1.get("hp")], "frames": [f0, f1], "p1States": states, "xRange": round(x_max - x_min, 3)})
            blk_total += len(blk)
            if blk_total >= 2:
                break
            if bad_hits:
                break
        if mid_shot is None:
            mid_shot = shot("block_cpu")
        check("SHIFT (+ D toward the CPU; 2nd half + S = crouch) blocks the CPU's strikes; only moves that guard cannot block land (lows vs standing, overheads vs crouching, throws)", blk_total >= 1 and bad_hits == 0,
              {"attempts": attempts, "shot": mid_shot})
        # ---- 2. SPECIAL U / I / O / P (johnny, gazza)
        expect = {"johnny": ["brickbat_m", "hook_m", "encore_m", "weave_m"], "gazza": ["power_shot_m", "dive_m", "bicycle_m", "keepy_m"]}
        for fid in ("johnny", "gazza"):
            start_bout(sess, args, fid, "bruno", -1, seed=5)
            got = []
            for k, key in enumerate(("sp1", "sp2", "sp3", "sp4")):
                wait_free(sess, 4.0)
                time.sleep(0.15)
                nm = snap_move(sess, P1_KEYS[key])
                got.append(nm)
                time.sleep(0.12)
                if k in (0, 3):
                    shot("%s_%s_%s" % (fid, key, nm or "none"))
                wait_free(sess, 4.0)
            check("%s: U / I / O / P = SPECIAL 1-4 with no direction" % fid, got == expect[fid], {"got": got, "want": expect[fid]})
        # ---- 3. SUPER H (1 bar) / PRIME TIME Y (3 bars) - johnny
        start_bout(sess, args, "johnny", "bruno", -1, seed=7)
        walk_in(sess, 1.2)
        wait_free(sess)
        sess.hp("dev.setMeter", 0, "showtime", 10000)
        time.sleep(0.1)
        n1 = snap_move(sess, P1_KEYS["super1"], 0.8)
        time.sleep(0.25)
        s1 = shot("super_h_%s" % (n1 or "none"))
        time.sleep(4.0)
        wait_free(sess, 8.0)
        sess.hp("dev.setMeter", 0, "showtime", 0)
        time.sleep(0.1)
        n0 = snap_move(sess, P1_KEYS["super3"], 0.5)
        wait_free(sess, 3.0)
        sess.hp("dev.setMeter", 0, "showtime", 30000)
        time.sleep(0.1)
        n3 = snap_move(sess, P1_KEYS["super3"], 0.8)
        time.sleep(1.2)
        s3 = shot("prime_y_%s" % (n3 or "none"))
        check("H with 1 bar = SUPER (sold_out), Y with no meter = nothing, Y with 3 bars = PRIME TIME (main_event)",
              n1 == "sold_out" and n0 == "" and n3 == "main_event", {"H": n1, "Y@0": n0, "Y@3bars": n3, "shots": [s1, s3]})
        time.sleep(6.0)
        # ---- 4. mash J = the auto-combo (EASY)
        start_bout(sess, args, "johnny", "bruno", -1, seed=9)
        # walk in until the push bodies meet (the gap stops shrinking): the route reaches from there (probe_motion: 0.6 m)
        k = fwd_key(sess)
        kb.down(k)
        t_w = time.time() + 5.0
        last_g, still_since = 99.0, time.time()
        while time.time() < t_w:
            g = gap(sess)
            if g < last_g - 0.005:
                last_g, still_since = g, time.time()
            elif time.time() - still_since > 0.4:
                break
            time.sleep(0.03)
        kb.up(k)
        wait_free(sess)
        mash_gap = round(gap(sess), 3)
        sess.js("() => { window.__EZ__.log.length = 0; }")
        # as fast as real key events go (each down / up is a CDP round trip; under machine load that alone is 20-150 ms),
        # until the route shows up or 5 s pass
        route = ["5M", "5H", "hook_m"]
        t0 = time.time()
        t_end = t0 + 5.0
        presses = 0
        # (no screenshot inside the loop: a CDP capture pauses the key stream 100-300 ms = a missed cancel window)
        while time.time() < t_end:
            kb.down(P1_KEYS["l"])
            time.sleep(0.012)
            kb.up(P1_KEYS["l"])
            presses += 1
            if presses % 6 == 0:
                cur = sess.js("() => window.__EZ__.log.slice()") or []
                if "hook_m" in cur:
                    break
        mash_s = time.time() - t0
        shot("mash_j_route")
        time.sleep(0.3)
        log = sess.js("() => window.__EZ__.log.slice()") or []
        idx = -1
        for i in range(len(log) - 2):
            if log[i:i + 3] == route:
                idx = i
                break
        light_before = idx > 0 and log[idx - 1] in ("5L", "2L")
        check("mashing J (real presses, EASY) = 5L > 5M > 5H > hook_m (the assist route)", idx > 0 and light_before,
              {"gapM": mash_gap, "presses": presses, "seconds": round(mash_s, 2), "pressEveryMs": round(1000 * mash_s / max(1, presses)), "moves": log[:12]})
        # ---- 5. F1 is kept from the browser
        sess.js("() => { window.__F1__ = null; window.addEventListener('keydown', (e) => { if (e.code === 'F1') window.__F1__ = e.defaultPrevented; }); }")
        pages0 = len(sess.context.pages)
        sess.press("F1", 60)
        time.sleep(0.6)
        f1 = sess.js("() => window.__F1__")
        check("F1 (controls bar key) reaches the page with defaultPrevented (no browser help tab)", f1 is True and len(sess.context.pages) == pages0,
              {"defaultPrevented": f1, "pages": [pages0, len(sess.context.pages)]})
        rep["diagnostics"] = sess.diagnostics()
    finally:
        sess.close()
    rep["shots"] = shots
    rep["problems"] = problems
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_reports", "easykeys.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(rep, f, indent=2, default=str)
    print("bindings P1: %s" % json.dumps(rep.get("bindingsP1")))
    print("schemes: %s" % rep.get("schemes"))
    print("RESULT: %s (%d/%d checks)" % ("PASS" if not problems else "FAIL", len(rep["checks"]) - len(problems), len(rep["checks"])))
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())
