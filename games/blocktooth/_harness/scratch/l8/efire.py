"""L8 scratch: does a real E fire UPROAR reliably? (repeat N times, report each)."""
import argparse, json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
from common import Session, add_common_args, build_url, ensure_play  # noqa: E402
ap = argparse.ArgumentParser(); add_common_args(ap); ap.add_argument('--titan', default='voltkite'); ap.add_argument('--biome', default='lockwater'); ap.add_argument('--n', type=int, default=5)
args = ap.parse_args()
s = Session(args, 'l8efire'); s.start()
try:
    s.goto(build_url(args.base, autostart=1, dev=1, titan=args.titan, biome=args.biome, seed=1337)); s.wait_bt(90); s.wait_screen(('slate', 'play'), 90)
    print('play', ensure_play(s, 30)); s.cheat('god', True)
    for i in range(args.n):
        ensure_play(s, 10)
        s.cheat('ult', 100); time.sleep(0.5)
        u0 = s.js("() => window.__BT__.state().v2.ult")
        scr = s.screen()
        s.press('KeyE', 80); time.sleep(0.4)
        u1 = s.js("() => window.__BT__.state().v2.ult")
        print(i, 'screen', scr, 'fired', u0['fired'], '->', u1['fired'], 'phase', u1['phase'], 'ready0', u0['ready'], 'mode', s.js("() => window.__BT__.state().screen"))
        time.sleep(7)
finally:
    s.close()
