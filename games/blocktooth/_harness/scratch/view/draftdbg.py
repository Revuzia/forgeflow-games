import os, sys, time, json
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..'))); sys.path.insert(0, HERE)
import argparse
from common import Session, add_common_args, build_url, ensure_play
from viewcheck import level_to
ap = argparse.ArgumentParser(); add_common_args(ap); a = ap.parse_args()
with Session(a, 'dbg') as s:
    s.goto(build_url(a.base, autostart=1, dev=1, noslate=1, titan='molo', biome='grideast', seed=5))
    s.wait_bt(60); s.wait_screen(['play', 'slate', 'draft'], 90); ensure_play(s, 20)
    s.cheat('god', True); s.cheat('noSpawns', True)
    level_to(s, 22, print)
    for i in range(14):
        st = s.state()
        print(i, st['screen'], st['level'], st['rank'], json.dumps(st['drafts'])[:160], 'tick', st['tick'])
        if st['screen'] == 'draft':
            s.press('Digit1')
        time.sleep(0.7)
    print(s.diagnostics())
