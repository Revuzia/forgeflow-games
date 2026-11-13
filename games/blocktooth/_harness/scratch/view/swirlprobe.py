#!/usr/bin/env python
"""Which view draws the pink "swirl" on MOLO's chest? MOLO at LV --level with hostile buggies/mortars
around; when a hostile telegraph sits under the titan the sim is frozen and three shots are taken:
all on · telegraph X-RAY meshes hidden · every telegraph mesh hidden (plus the list of scene meshes
that intersect the titan's screen box). Default zoom, god mode.

    python _harness/scratch/view/swirlprobe.py --base http://localhost:5240 --out _shots/swirl [--level 15]
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..')))
from common import Session, add_common_args, build_url, ensure_play  # noqa: E402
from viewcheck import level_to  # noqa: E402

UNDER_JS = r"""() => {
  const W = window.__H_W__(), T = W.titan;
  const out = [];
  for (const tg of W.telegraphs) {
    if (!tg.alive || tg.owner === 'titan') continue;
    const s = tg.shape;
    const x = s.x ?? s.x0, z = s.z ?? s.z0;
    const d = Math.hypot(x - T.x, z - T.z);
    if (d < T.radius) out.push({ owner: tg.owner, style: tg.style, tag: tg.tag, k: s.k, r: s.r ?? s.rx ?? s.w ?? 0, d: +d.toFixed(1), frac: +(tg.t / tg.windup).toFixed(2) });
  }
  return { H: T.height, R: T.radius, lv: T.level, under: out, vac: T.kit.vacuumT || 0 };
}"""

VIS_JS = r"""(mode) => {
  const scene = __BT__.debugCore.scene;
  let n = 0;
  scene.traverse((o) => {
    if (!o.name) return;
    const tg = o.name.startsWith('tg:'), pj = o.name.startsWith('proj');
    if (!tg && !pj) return;
    let v = true;
    if (mode === 'noxray' && tg && o.name.endsWith(':xray')) v = false;
    if (mode === 'notg' && tg) v = false;
    if (mode === 'noproj' && pj) v = false;
    if (v) o.layers.set(0); else o.layers.set(31);   // views rewrite .visible every frame; layers they leave alone
    n++;
  });
  return n;
}"""

NAMES_JS = r"""() => {
  const names = new Set();
  __BT__.debugCore.scene.traverse((o) => { if (o.isMesh && o.name && /tg:|proj|fx:|hazard|titan/.test(o.name)) names.add(o.name + (o.visible ? '' : ' (hidden)')); });
  return [...names].slice(0, 60);
}"""


def main():
    ap = argparse.ArgumentParser()
    add_common_args(ap)
    ap.add_argument('--level', type=int, default=15)
    ap.add_argument('--out', required=True)
    ap.add_argument('--seconds', type=float, default=90)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    with Session(args, 'swirlprobe') as sess:
        sess.goto(build_url(args.base, autostart=1, dev=1, noslate=1, titan='molo', biome='grideast', seed=5))
        sess.wait_bt(60)
        sess.wait_screen(['play', 'slate', 'draft'], 90)
        ensure_play(sess, 20)
        sess.cheat('god', True)
        level_to(sess, args.level, print)
        t_end = time.time() + 30
        while time.time() < t_end:
            st = sess.state()
            if st['screen'] == 'draft':
                sess.press('Digit1')
            elif st['drafts']['pending'] <= 0 and st['screen'] == 'play':
                break
            time.sleep(0.4)
        print('mesh names:', json.dumps(sess.js(NAMES_JS)))
        got = None
        t_end = time.time() + args.seconds
        k = 0
        while time.time() < t_end:
            if k % 25 == 0:
                sess.cheat('spawn', 'buggy', 6)
                sess.cheat('spawn', 'walker', 2)
            k += 1
            ensure_play(sess, 5)
            u = sess.safe_js(UNDER_JS) or {}
            if any(x['frac'] >= 0.4 for x in (u.get('under') or [])):
                sess.bt_call('freeze', True)
                time.sleep(0.5)
                got = u
                for mode in ('all', 'noxray', 'notg', 'noproj'):
                    print(mode, sess.js(VIS_JS, mode))
                    time.sleep(0.25)
                    sess.screenshot(os.path.join(args.out, 'swirl_%s.png' % mode))
                sess.js(VIS_JS, 'all')
                sess.bt_call('freeze', False)
                break
            time.sleep(0.12)
        print(json.dumps(got or {'missed': True}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
