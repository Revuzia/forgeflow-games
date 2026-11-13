#!/usr/bin/env python
"""Pitch A/B for the new framing: screenshots at Size I / II / III with extra pitch offsets
(__BTCAM__.pitchProbeDeg, dev only).  python _harness/scratch/view/pitchprobe.py --base http://localhost:5230"""
import argparse
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..')))
sys.path.insert(0, HERE)
from common import Session, add_common_args, build_url, ensure_play  # noqa: E402
from viewcheck import level_to  # noqa: E402

OUT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '_shots', 'view', 'pitch'))


def main():
    ap = argparse.ArgumentParser()
    add_common_args(ap)
    ap.add_argument('--titan', default='molo')
    ap.add_argument('--biome', default='grideast')
    ap.add_argument('--seed', type=int, default=5)
    ap.add_argument('--offsets', default='0,8,14,20')
    ap.add_argument('--ranks', default='0,1,2')
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    url = build_url(args.base, autostart=1, dev=1, noslate=1, titan=args.titan, biome=args.biome, seed=args.seed)
    with Session(args, 'pitchprobe') as sess:
        sess.goto(url)
        sess.wait_bt(60)
        sess.wait_screen(['play', 'slate', 'draft'], 90)
        ensure_play(sess, timeout_s=20)
        sess.cheat('god', True)
        sess.cheat('noSpawns', True)
        for r in [int(x) for x in args.ranks.split(',')]:
            if r > 0:
                level_to(sess, sess.page.evaluate("async () => (await import('/src/core/config.ts')).RANK_LEVELS.slice()")[r], print)
                t_end = time.time() + 3.5
                while time.time() < t_end:
                    ensure_play(sess, timeout_s=5)
                    time.sleep(0.2)
            for off in [float(x) for x in args.offsets.split(',')]:
                sess.js('(o) => { window.__BTCAM__.pitchProbeDeg = o; }', off)
                time.sleep(1.6)
                ensure_play(sess, timeout_s=5)
                p = os.path.join(OUT, '%s_%s_r%d_p%+03d.png' % (args.titan, args.biome, r, int(off)))
                sess.screenshot(p)
                print(p)
            sess.js('() => { window.__BTCAM__.pitchProbeDeg = 0; }')
        print(sess.diagnostics())
    return 0


if __name__ == '__main__':
    sys.exit(main())
