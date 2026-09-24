"""Does a real OS focus change (another headed Chrome window opening on top) fire window 'blur' in a
harness page? (Playwright focus emulation) — if yes, blur→pause would pause other agents' runs."""
import os, sys, time, json, argparse
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from common import Session, add_common_args, build_url, FLAGS
ap = argparse.ArgumentParser(); add_common_args(ap); args = ap.parse_args(); args.no_serve = True
A = Session(args, "focusA"); A.start()
try:
    A.goto(build_url(args.base, autostart=1, noslate=1, seed=3, titan="molo")); A.wait_bt(60); A.wait_screen("play", 60)
    A.js("() => { window.__BLUR__ = 0; addEventListener('blur', () => window.__BLUR__++); }")
    Bb = A._pw.chromium.launch(channel="chrome", headless=False, args=FLAGS)
    Bp = Bb.new_page(); Bp.goto(build_url(args.base)); time.sleep(3)
    Bp.bring_to_front(); Bp.click("body"); time.sleep(2)
    print(json.dumps({"blur_events_in_A": A.js("() => window.__BLUR__"), "A_screen": A.screen(), "A_hasFocus": A.js("() => document.hasFocus()")}))
    Bb.close()
finally:
    A.close()
