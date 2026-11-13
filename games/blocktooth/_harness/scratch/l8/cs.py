import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
from common import Session, add_common_args, build_url, ensure_play
import argparse
ap = argparse.ArgumentParser(); add_common_args(ap); ap.add_argument('--expr', default=''); args = ap.parse_args()
s = Session(args, 'l8cs'); s.start()
try:
    s.goto(build_url(args.base, autostart=1, dev=1, titan='molo', biome='grideast', seed=1337)); s.wait_bt(90); s.wait_screen(('slate','play'),90); ensure_play(s, 30)
    print(json.dumps(s.page.evaluate(args.expr), indent=1)[:4000])
finally:
    s.close()
