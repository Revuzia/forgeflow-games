#!/usr/bin/env python
"""Enemy spawns seen at the MAX zoom-out (real wheel): how many new enemies first appear inside the
viewport, and confirms they pop in (enemyview POP_S easeOutBack) rather than blink in.
    python _harness/scratch/final/spawnzoom.py --level 7 --seconds 20
"""
import argparse, json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..')))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', 'view')))
from common import Session, add_common_args, build_url, ensure_play  # noqa: E402
from viewcheck import level_to  # noqa: E402
from spawnvis import JS  # noqa: E402


def main():
    ap = argparse.ArgumentParser(); add_common_args(ap)
    ap.add_argument('--level', type=int, default=1); ap.add_argument('--seconds', type=float, default=20)
    ap.add_argument('--notches', type=int, default=12)
    a = ap.parse_args()
    with Session(a, 'spawnzoom') as s:
        s.goto(build_url(a.base, autostart=1, dev=1, noslate=1, titan='molo', biome='grideast', seed=5))
        s.wait_bt(60); s.wait_screen(['play', 'slate', 'draft'], 90); ensure_play(s, 20)
        s.cheat('god', True)
        if a.level > 1:
            level_to(s, a.level, print)
        t_end = time.time() + 30
        while time.time() < t_end:
            st = s.state()
            if st['screen'] == 'draft': s.press('Digit1')
            elif st['drafts']['pending'] <= 0 and st['screen'] == 'play': break
            time.sleep(0.4)
        s.page.mouse.move(640, 360)
        for _ in range(a.notches):
            s.page.mouse.wheel(0, 120); time.sleep(0.05)
        time.sleep(2.5)
        s.js(JS)
        t_end = time.time() + a.seconds
        while time.time() < t_end:
            ensure_play(s, 5); time.sleep(0.3)
        r = s.js("() => { const S = __SV__; S.stop = true; const c = __BTCAM__; return {n: S.n, inside: S.inside, ringMin: Math.min(...S.ring), ringMax: Math.max(...S.ring), dist: c.distance, auto: c.autoDist, zoom: c.zoom, level: __BT__.world.titan.level, rank: __BT__.world.titan.rank}; }")
        print(json.dumps(r))


if __name__ == '__main__':
    main()
