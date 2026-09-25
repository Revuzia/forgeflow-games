import sys, os, time, argparse
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
from common import Session, add_common_args, build_url
ap = add_common_args(argparse.ArgumentParser()); args = ap.parse_args()
with Session(args, 'dbg') as S:
    S.goto(build_url(args.base, dev=1, noslate=1, autostart=1, titan='voltkite', biome='lockwater', meta='full'))
    S.wait_bt(); print(S.wait_screen('play', 90))
    print('xp', S.cheat('xp', 1500))
    for i in range(8):
        time.sleep(0.5); st = S.state() or {}
        print(i, st.get('screen'), str(st.get('titan'))[:120], str(st.get('upgrades'))[:300])
