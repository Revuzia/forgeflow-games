#!/usr/bin/env python
"""Level-up grow-pop + ground ring, observed: a per-frame log (rAF) of the titan's `base` bone
vertical scale, the growRing's visibility / radius / opacity and titan.height, across one real
level-up (cheat.xp → draft → real '1'), plus screenshots right after the pick.

    python _harness/scratch/view/popcheck.py --base http://localhost:5230 [--level 3]
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..')))
sys.path.insert(0, HERE)
from common import Session, add_common_args, build_url, ensure_play  # noqa: E402
from viewcheck import level_to  # noqa: E402

OUT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '_shots', 'view', 'pop'))

REC_JS = r"""() => {
  const core = __BT__.debugCore, sc = core.scene;
  let ring = null, base = null;
  sc.traverse((o) => { if (o.name === 'titan:growRing') ring = o; if (!base && o.isBone && o.name === 'base') base = o; });
  window.__POP__ = [];
  const t0 = performance.now();
  const step = () => {
    const T = __BT__.world.titan;
    window.__POP__.push({ t: +(performance.now() - t0).toFixed(0), scr: __BT__.state().screen, H: +T.height.toFixed(3), lv: T.level,
      sy: base ? +base.scale.y.toFixed(3) : null, sz: base ? +base.scale.z.toFixed(3) : null,
      ring: ring ? ring.visible : null, rr: ring ? +ring.scale.x.toFixed(2) : null,
      ro: ring ? +ring.material.opacity.toFixed(2) : null });
    if (performance.now() - t0 < 6000) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return { ring: !!ring, base: !!base };
}"""


def main():
    ap = argparse.ArgumentParser()
    add_common_args(ap)
    ap.add_argument('--level', type=int, default=3)
    ap.add_argument('--titan', default='molo')
    ap.add_argument('--biome', default='grideast')
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    with Session(args, 'popcheck') as sess:
        sess.goto(build_url(args.base, autostart=1, dev=1, noslate=1, titan=args.titan, biome=args.biome, seed=5))
        sess.wait_bt(60)
        sess.wait_screen(['play', 'slate', 'draft'], 90)
        ensure_play(sess, 20)
        sess.cheat('god', True)
        sess.cheat('noSpawns', True)
        sess.cheat('killAll')
        level_to(sess, args.level - 1, print)
        t_end = time.time() + 30
        while time.time() < t_end:            # clear banked drafts
            st = sess.state()
            if st['screen'] == 'draft':
                sess.press('Digit1')
            elif st['drafts']['pending'] <= 0 and st['screen'] == 'play':
                break
            time.sleep(0.4)
        time.sleep(1.0)
        print('hooks', sess.js(REC_JS))
        T = sess.js("() => { const T = __BT__.world.titan; return {xp: T.xp, n: T.xpToNext}; }")
        sess.cheat('xp', T['n'] - T['xp'] + 0.5)
        sess.wait_screen(['draft'], 10)
        time.sleep(0.9)                         # the deal-in
        sess.press('Digit1', hold_ms=30)
        shots = []
        t0 = time.time()
        for i in range(5):
            p = os.path.join(OUT, '%s_lv%d_pop_%d.png' % (args.titan, args.level, i))
            sess.screenshot(p)
            shots.append((round(time.time() - t0, 2), p))
        time.sleep(2.0)
        log = sess.js('() => window.__POP__')
        # print the frames around the pick (screen draft → play)
        k0 = next((i for i, r in enumerate(log) if r['scr'] == 'play' and i > 0 and log[i - 1]['scr'] != 'play'), 0)
        k00 = next((i for i, r in enumerate(log) if r['ring']), None)
        print('first ring frame', k00, log[k00] if k00 is not None else None)
        for r in log[max(0, k0 - 2):k0 + 60:2]:
            print(json.dumps(r))
        print('shots', shots)
        with open(os.path.join(OUT, 'poplog_%s_lv%d.json' % (args.titan, args.level)), 'w') as f:
            json.dump(log, f)
        print(sess.diagnostics())
    return 0


if __name__ == '__main__':
    sys.exit(main())
