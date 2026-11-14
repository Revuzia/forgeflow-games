"""A2: two deaths in one browser profile — the 2nd tabloid must stamp the records the 1st run set."""
import os, sys, time, json, argparse
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from common import Session, add_common_args, build_url, SHOTS
ap = argparse.ArgumentParser(); add_common_args(ap); args = ap.parse_args(); args.no_serve = True
S = Session(args, "records"); S.start()
def die(hold_s):
    t0 = time.time()
    while time.time() - t0 < 120:
        s = S.state() or {}
        if s.get("screen") == "draft": S.press("Digit1"); time.sleep(0.4); continue
        if s.get("screen") == "end" or (s.get("run") or {}).get("result"): break
        if time.time() - t0 > hold_s:
            S.safe_js("() => { const w = window.__BT__.world; if (w && w.titan.hp > 5) w.titan.hp = 5; }")
            S.cheat("spawn", "tank", 4)
        time.sleep(0.3)
    S.wait_screen("end", 10); time.sleep(2.0)
    return S.safe_js("() => ({ rows: [...document.querySelectorAll('.bt-np-record-row')].map(e => e.innerText.replace(/\s+/g, ' ')),"
                     " note: (document.querySelector('.bt-np-record-note') || {}).innerText, stamps: document.querySelectorAll('.bt-np-new').length })")
try:
    S.goto(build_url(args.base, autostart=1, noslate=1, seed=9, titan="molo", biome="grideast", dev=1)); S.wait_bt(60); S.wait_screen("play", 60)
    S.hold({"KeyW"}); r1 = die(2); S.release_all()
    print(json.dumps({"run1": r1}))
    S.press("KeyR"); S.wait_screen(("play", "slate"), 60); time.sleep(0.5)
    if S.screen() == "slate": S.press("Enter"); S.wait_screen("play", 10)
    S.hold({"KeyD"}); time.sleep(0.2); r2 = die(14); S.release_all()
    S.screenshot(os.path.join(SHOTS, "appfix", "A2_tabloid_run2.png"))
    print(json.dumps({"run2": r2}))
finally:
    S.close()
