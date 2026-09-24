#!/usr/bin/env python
"""DYEFIELD boot check — CONTRACT §7 gate G4.

    python _harness/bootcheck.py                 # headed Chrome (d3d11), /?map=pier18&dev=1
    python _harness/bootcheck.py --headless      # same flags, no window
    python _harness/bootcheck.py --no-serve      # never auto-start vite

Flow (real input at the player's layer):
  1. load /?map=pier18&dev=1, wait for __DF__.state().phase == 'ready' (the CLICK TO PLAY card);
  2. a REAL mouse click on the page centre (the CLICK TO PLAY button over the canvas) → pointer lock
     → phase 'play'. If Chrome refuses pointer lock under automation, fall back to __DF__.start()
     (dev) and SAY so in the output;
  3. screenshot _shots/boot_spawn.png;
  4. hold a REAL KeyW for 1.5 s (page.keyboard.down/up) → the runner must move > 3 m;
  5. a REAL left-button hold (page.mouse.down/up) for 1.2 s while standing → teamUnderFeet() === 1
     (SUNCREW), coverage.sun > 0, and the DOM minimap canvas pixel under the runner is SUNCREW;
  6. a short brushed strafe (LMB + A) for the picture, then _shots/boot_painted.png;
  7. F1 → _shots/boot_debug.png (debug panel on), F1 again.
Pointer lock (strict about the game, tolerant of the environment): another session's headed Chrome
opening a window takes OS activation and drops the lock (the game then pauses by design). Every lock
loss is recorded in the page with its focus evidence (common.INIT_JS). A loss while the page had LOST
focus (document.hasFocus() false, or a window blur around the loss) is focus theft: the check
re-acquires the lock with ONE real click on RESUME, prints 'NOTE: focus stolen by another window at
t=..s; re-locked with a real click', and repeats the interrupted step once. A loss while the page
still had focus is a FAILURE (a game bug). A pre-flight line lists any other automated Chrome.
VERDICT "BOOTS CLEAN" only when all hold AND 0 console errors, 0 page/window errors, 0 shader/GL
errors, 0 failed requests, frames + sim ticks advancing. Shader compiler WARNINGS (a program info log
holding only "warning X…" lines) are printed for the material's owner but do not gate (G4 says
"0 shader errors").
Exit codes: 0 clean · 1 not clean · 2 the page never got far enough to judge.
"""
import argparse
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (SHOTS, HarnessError, Session, add_common_args, build_url, diag_problems,  # noqa: E402
                    fmt, preflight_chromes, print_diagnostics, save_report)


def dist_xz(a, b):
    return math.hypot(a["x"] - b["x"], a["z"] - b["z"])


def classify_minimap(px):
    """Which colour is the minimap pixel? The raster paints team texels as dye × (0.86..1.0 height
    shade) and neutral as base × (0.72..1.0); returns (label, detail)."""
    if not px or not isinstance(px.get("rgba"), list):
        return "none", "minimapPixel() unavailable"
    r, g, b, a = px["rgba"]
    if a < 200:
        return "empty", "transparent pixel (no floor texel owns it) rgba=%s" % px["rgba"]

    def fit(ref):
        # best height-shade factor f in [0.7, 1.0] and the residual distance
        best = None
        for i in range(31):
            f = 0.7 + 0.01 * i
            d = math.sqrt((r - ref[0] * f) ** 2 + (g - ref[1] * f) ** 2 + (b - ref[2] * f) ** 2)
            if best is None or d < best[0]:
                best = (d, f)
        return best
    ds, _ = fit(px["sun"])
    dg, _ = fit(px["gulf"])
    dn, _ = fit([226, 219, 204])
    label = min((("sun", ds), ("gulf", dg), ("neutral", dn)), key=lambda t: t[1])[0]
    if label == "sun" and ds > 45:
        label = "unclear"
    return label, "rgba=%s at px (%s, %s); dist sun %.0f · gulf %.0f · neutral %.0f" % (
        px["rgba"], px.get("px"), px.get("py"), ds, dg, dn)


def main() -> int:
    ap = argparse.ArgumentParser(description="DYEFIELD boot check (gate G4)")
    add_common_args(ap)
    ap.add_argument("--map", default="pier18")
    ap.add_argument("--wait", type=float, default=90.0, help="seconds to wait for __DF__ and 'ready'")
    ap.add_argument("--out-dir", default=SHOTS)
    args = ap.parse_args()

    url = build_url(args.base, map=args.map, dev=1)
    shot_spawn = os.path.join(args.out_dir, "boot_spawn.png")
    shot_painted = os.path.join(args.out_dir, "boot_painted.png")
    shot_debug = os.path.join(args.out_dir, "boot_debug.png")
    report = {"url": url, "headless": args.headless}
    problems = []
    notes = []
    fatal = None
    t_ready = None
    entered = None
    walk = {}
    brush = {}
    tick_a = tick_b = None
    adv = (False, None, None)
    render = None
    df_shot = None
    shots = {}
    st_final = None

    others, scan_err = preflight_chromes("pre-flight")
    report["otherAutomatedChrome"] = others
    if others:
        notes.append("another automated Chrome was alive at start (%d): a headed one may steal focus mid-run" % len(others))

    sess = Session(args, "bootcheck")
    try:
        sess.start()
    except Exception as e:
        sess.close()
        print("SETUP FAILED: %s" % (str(e) if isinstance(e, HarnessError) else repr(e)))
        print("RESULT: FAIL")
        return 2
    try:
        t0 = time.time()
        try:
            sess.goto(url)
        except Exception as e:
            fatal = "navigation failed: %s" % str(e).splitlines()[0]
        if not fatal and not sess.wait_df(args.wait):
            fatal = "window.__DF__ never appeared within %.0f s" % args.wait
        if not fatal:
            ok, ph = sess.wait_phase("ready", args.wait)
            t_ready = time.time() - t0
            if not ok:
                st = sess.state() or {}
                fatal = "never reached 'ready' (phase=%r after %.0f s)%s" % (
                    ph, args.wait, (": " + str(st.get("error"))[:1500]) if st.get("error") else "")

        # ── 2. a real click on the CLICK TO PLAY card (over the canvas) → pointer lock → play
        if not fatal:
            time.sleep(0.6)
            vw, vh = args.width, args.height
            clicks = 0
            ok = False
            # a real player's window is in front when they click; Chrome refuses pointer lock for an
            # inactive window ("root document ... not valid for pointer lock"), so raise the tab first
            # and, like a player, click once more if the first capture is refused
            for attempt in range(2):
                try:
                    sess.page.bring_to_front()
                except Exception:
                    pass
                sess.page.mouse.move(vw / 2, vh / 2)
                sess.page.mouse.click(vw / 2, vh / 2)
                clicks += 1
                ok, ph = sess.wait_phase("play", 4.0)
                if ok:
                    break
                time.sleep(0.8)
            lock = sess.lock_info() or {}
            if ok:
                entered = "real click → pointer lock (locked=%s, click %d, pointerlockerror events %s)" % (
                    lock.get("locked"), clicks, lock.get("errors"))
                if clicks > 1:
                    notes.append("the first real click's pointer lock was refused by Chrome; the second click locked")
            else:
                st = sess.state() or {}
                msg = ("pointer lock was not granted to the real click under automation "
                       "(pointerlockchange %s, pointerlockerror %s, phase %r) → FALLING BACK to __DF__.start() (dev)" % (
                           lock.get("changes"), lock.get("errors"), st.get("phase")))
                print("NOTE: " + msg)
                notes.append(msg)
                okc, v = sess.df("start")
                ok, ph = sess.wait_phase("play", 4.0)
                entered = "__DF__.start() fallback (no pointer lock)" if ok else None
                if not ok:
                    fatal = "could not enter play (click and __DF__.start() both failed: %s; phase %r)" % (v, ph)

        if not fatal:
            time.sleep(1.0)
            s0 = sess.state() or {}
            tick_a = s0.get("tick")
            shots["spawn"] = sess.screenshot(shot_spawn)

            # ── 4. real W hold 1.5 s. Each timed step is guarded: a lock loss caused by focus theft is
            #       re-locked with one real click and the step runs once more; a loss with focus fails.
            def do_walk():
                p0 = (sess.state() or {}).get("player") or {}
                sess.page.keyboard.down("KeyW")
                time.sleep(1.5)
                sess.page.keyboard.up("KeyW")
                time.sleep(0.4)
                p1 = (sess.state() or {}).get("player") or {}
                d = dist_xz(p0, p1) if p0 and p1 else 0.0
                return {"from": p0, "to": p1, "metres": d, "phaseAfter": sess.phase()}

            for attempt in range(2):
                sess.lock_guard("before the W hold", notes, problems)
                walk = do_walk()
                g = sess.lock_guard("during the W hold", notes, problems)
                if g == "relocked" and attempt == 0:
                    notes.append("the W hold was interrupted by focus theft → repeated once")
                    continue
                break
            if not (walk["metres"] > 3.0):
                problems.append("a real 1.5 s W hold moved the runner only %.2f m (need > 3 m; phase after: %s)" % (
                    walk["metres"], walk["phaseAfter"]))

            # ── 5. real LMB hold 1.2 s while standing
            def do_brush():
                before_under = sess.df("teamUnderFeet")[1]
                flips0 = sess.df("flips")[1]
                sess.page.mouse.down(button="left")
                time.sleep(1.2)
                sess.page.mouse.up(button="left")
                time.sleep(0.35)
                st = sess.state() or {}
                under = sess.df("teamUnderFeet")[1]
                flips1 = sess.df("flips")[1]
                cov = st.get("coverage") or {}
                ok_px, px = sess.df("minimapPixel")
                label, px_detail = classify_minimap(px if ok_px else None)
                return {"underBefore": before_under, "underAfter": under, "coverage": cov, "flips": [flips0, flips1],
                        "minimap": px, "minimapLabel": label, "minimapDetail": px_detail, "player": st.get("player")}

            for attempt in range(2):
                sess.lock_guard("before the LMB hold", notes, problems)
                brush = do_brush()
                g = sess.lock_guard("during the LMB hold", notes, problems)
                if g == "relocked" and attempt == 0:
                    notes.append("the LMB hold was interrupted by focus theft → repeated once")
                    continue
                break
            under, cov, label = brush["underAfter"], brush["coverage"], brush["minimapLabel"]
            if under != 1:
                problems.append("after a real 1.2 s LMB hold teamUnderFeet() = %r (want 1 = SUNCREW)" % (under,))
            if not (isinstance(cov.get("sun"), (int, float)) and cov["sun"] > 0):
                problems.append("coverage.sun = %r after the brush (want > 0)" % (cov.get("sun"),))
            if label != "sun":
                problems.append("minimap pixel under the runner is %s, not SUNCREW (%s)" % (label, brush["minimapDetail"]))

            # ── 6. a brushed strafe for the picture, then the painted shot
            sess.page.mouse.down(button="left")
            sess.page.keyboard.down("KeyA")
            time.sleep(0.6)
            sess.page.keyboard.up("KeyA")
            sess.page.keyboard.down("KeyD")
            time.sleep(1.2)
            sess.page.keyboard.up("KeyD")
            sess.page.keyboard.down("KeyA")
            time.sleep(0.6)
            sess.page.keyboard.up("KeyA")
            sess.page.mouse.up(button="left")
            time.sleep(0.6)
            sess.lock_guard("during the brushed strafe", notes, problems)
            shots["painted"] = sess.screenshot(shot_painted)
            ok_s, df_shot = sess.df("shot", "boot_canvas")

            # ── 7. F1 debug panel
            sess.press("F1", 80)
            time.sleep(0.6)
            sess.lock_guard("before the F1 shot", notes, problems)
            shots["debug"] = sess.screenshot(shot_debug)
            sess.press("F1", 80)

            adv = sess.frames_advancing(3.0)
            sess.lock_guard("before the final sample", notes, problems)
            st_final = sess.state() or {}
            tick_b = st_final.get("tick")
            ok_r, render = sess.df("render")
            if st_final.get("phase") != "play":
                problems.append("not in play at the final sample (phase=%r)" % (st_final.get("phase"),))
    finally:
        tl = sess.timeline() if sess.page else []
        diag = sess.diagnostics() if sess.page else {}
        sess.close()

    sim_adv = isinstance(tick_a, (int, float)) and isinstance(tick_b, (int, float)) and tick_b > tick_a
    print("=" * 84)
    print("URL          : %s" % url)
    print("mode         : %s" % ("headless Chrome (d3d11)" if args.headless else "headed Chrome (d3d11)"))
    print("boot → ready : %s" % ("%.1f s" % t_ready if t_ready is not None else "—"))
    print("entered play : %s" % (entered or "NO"))
    if walk:
        a, b = walk["from"], walk["to"]
        print("W hold 1.5 s : %.2f m  (%s, %s, %s) → (%s, %s, %s)" % (
            walk["metres"], fmt(a.get("x")), fmt(a.get("y")), fmt(a.get("z")), fmt(b.get("x")), fmt(b.get("y")), fmt(b.get("z"))))
    if brush:
        cov = brush.get("coverage") or {}
        print("LMB hold 1.2s: teamUnderFeet %r → %r · coverage sun %s %% · flips %s → %s" % (
            brush.get("underBefore"), brush.get("underAfter"),
            fmt((cov.get("sun") or 0) * 100, 3), brush["flips"][0], brush["flips"][1]))
        print("minimap      : %s — %s" % (brush.get("minimapLabel"), brush.get("minimapDetail")))
    print("frames       : %s → %s  (%s)" % (adv[1], adv[2], "advancing" if adv[0] else "STALLED"))
    print("sim ticks    : %s → %s  (%s)" % (tick_a, tick_b, "advancing" if sim_adv else "STALLED"))
    if isinstance(render, dict):
        print("renderer     : fps %s · draw calls %s · triangles %s · programs %s · textures %s" % (
            fmt(render.get("fps"), 1), render.get("calls"), render.get("triangles"), render.get("programs"), render.get("textures")))
        print("gpu          : %s" % render.get("gpu"))
    for k, pth in (("spawn", shot_spawn), ("painted", shot_painted), ("debug", shot_debug)):
        print("shot %-7s : %s" % (k, pth if shots.get(k) else "—"))
    print("__DF__.shot  : %s" % (json.dumps(df_shot) if df_shot is not None else "—"))
    for n in notes:
        print("NOTE         : %s" % n)
    print("lock timeline: %s" % (" | ".join(tl) or "—"))
    print("-" * 84)
    print_diagnostics(diag)
    print("=" * 84)

    report.update({"readyS": t_ready, "entered": entered, "walk": walk, "brush": brush, "framesAdvancing": adv[0],
                   "simAdvancing": sim_adv, "render": render, "diagnostics": diag, "fatal": fatal, "notes": notes,
                   "shots": shots, "dfShot": df_shot, "final": st_final, "timeline": tl})
    if fatal:
        report["verdict"] = "NOT CLEAN"
        print("VERDICT: NOT CLEAN — %s" % fatal)
        for p in diag_problems(diag):
            print("   X %s" % p)
        print("report       : %s" % save_report("bootcheck", report, args.base))
        print("RESULT: FAIL")
        return 2

    problems += diag_problems(diag)
    if not adv[0]:
        problems.append("the harness frame counter did not advance (rAF stalled)")
    if not sim_adv:
        problems.append("the sim tick did not advance during play (%s → %s)" % (tick_a, tick_b))
    for k in ("spawn", "painted", "debug"):
        if not shots.get(k):
            problems.append("screenshot %s was not saved" % k)
    clean = not problems
    report["verdict"] = "BOOTS CLEAN" if clean else "NOT CLEAN"
    report["problems"] = problems
    print("VERDICT: %s" % report["verdict"])
    for p in problems:
        print("   X %s" % p)
    print("report       : %s" % save_report("bootcheck", report, args.base))
    print("RESULT: %s" % ("OK" if clean else "FAIL"))
    return 0 if clean else 1


if __name__ == "__main__":
    raise SystemExit(main())
