#!/usr/bin/env python
"""Where do new enemies FIRST appear relative to the viewport? (the sim's spawn ring still reads
config.ts cameraDistance, the old tighter framing). For each enemy id first seen in a frame, its
ground position is projected through the live camera; inside = |ndc.x| ≤ 1 and |ndc.y| ≤ 1.

    python _harness/scratch/view/spawnvis.py --base http://localhost:5230 --level 1 --seconds 20
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

JS = r"""() => {
  const cam = __BT__.debugCore.camera, V = cam.position.constructor;
  window.__SV__ = { seen: new Set(), n: 0, inside: 0, ring: [] };
  const S = window.__SV__;
  const step = () => {
    const w = __BT__.world;
    if (w && __BT__.state().screen === 'play') {
      for (const e of w.enemies) {
        if (!e || S.seen.has(e.id)) continue;
        S.seen.add(e.id);
        const p = new V(e.x, 0, e.z).project(cam);
        S.n++;
        if (Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1) S.inside++;
        S.ring.push(+Math.hypot(e.x - w.titan.x, e.z - w.titan.z).toFixed(1));
      }
    }
    if (!S.stop) requestAnimationFrame(step);
  };
  // enemies already alive when we start do not count as spawns
  for (const e of __BT__.world.enemies) if (e) S.seen.add(e.id);
  requestAnimationFrame(step);
  return __BT__.world.enemies.length;
}"""


def main():
    ap = argparse.ArgumentParser()
    add_common_args(ap)
    ap.add_argument('--level', type=int, default=1)
    ap.add_argument('--seconds', type=float, default=20)
    args = ap.parse_args()
    with Session(args, 'spawnvis') as sess:
        sess.goto(build_url(args.base, autostart=1, dev=1, noslate=1, titan='molo', biome='grideast', seed=5))
        sess.wait_bt(60)
        sess.wait_screen(['play', 'slate', 'draft'], 90)
        ensure_play(sess, 20)
        sess.cheat('god', True)
        if args.level > 1:
            level_to(sess, args.level, print)
        t_end = time.time() + 30
        while time.time() < t_end:
            st = sess.state()
            if st['screen'] == 'draft':
                sess.press('Digit1')
            elif st['drafts']['pending'] <= 0 and st['screen'] == 'play':
                break
            time.sleep(0.4)
        time.sleep(3)
        sess.js(JS)
        t_end = time.time() + args.seconds
        while time.time() < t_end:
            ensure_play(sess, 5)
            time.sleep(0.3)
        r = sess.js("() => { const S = __SV__; S.stop = true; const c = __BTCAM__; return {n: S.n, inside: S.inside, ringMin: Math.min(...S.ring), ringMax: Math.max(...S.ring), dist: c.distance, level: __BT__.world.titan.level, rank: __BT__.world.titan.rank}; }")
        print(json.dumps(r))
    return 0


if __name__ == '__main__':
    sys.exit(main())
