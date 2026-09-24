#!/usr/bin/env python
"""perfcheck (gate 5) at a given player ZOOM, reaching Size V through real level-ups.

    python _harness/scratch/view/perfzoom.py --base http://localhost:5230 --zoom 1 --report-dir <dir>

Identical to _harness/perfcheck.py (same spawn mix, real-key circles, rAF recorder, pass rule),
except the rank step: cheat.rank currently routes through the retired gainMass (a no-op after the
level-driven growth change), so this levels to LV 32 with cheat.xp (each draft picked with a real
'1'), then sets the camera zoom multiplier (__BTCAM__, dev) before the load is spawned.
"""
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..')))
sys.path.insert(0, HERE)
import perfcheck  # noqa: E402
from viewcheck import level_to  # noqa: E402

ZOOM = 1.0
if '--zoom' in sys.argv:
    i = sys.argv.index('--zoom')
    ZOOM = float(sys.argv[i + 1])
    del sys.argv[i:i + 2]


def set_rank_by_levels(sess, idx, log=print, settle_s=0.0):
    idx = int(os.environ.get('PZ_RANK', idx))
    target = sess.page.evaluate("async () => (await import('/src/core/config.ts')).RANK_LEVELS.slice()")[idx]
    sess.cheat('noSpawns', True)
    ok = level_to(sess, target, log)
    # the drafts those levels banked open one per sim tick: pick them all with real '1' presses
    t_end = time.time() + 90
    while time.time() < t_end:
        st = sess.state() or {}
        if st.get('screen') == 'draft':
            sess.press('Digit1')
        elif (st.get('drafts') or {}).get('pending', 0) <= 0 and st.get('screen') == 'play':
            break
        time.sleep(0.45)
    time.sleep(3.0)
    perfcheck.clear_overlay(sess, sess.screen())
    sess.js('(z) => { const r = window.__BTCAM__; r.resetZoom(); r.zoomBy(Math.log(z)); }', ZOOM)
    time.sleep(1.2)
    z = sess.js('() => ({zoom: __BTCAM__.zoom, dist: __BTCAM__.distance, auto: __BTCAM__.autoDist})')
    log('levels → LV %d · camera %s' % (target, z))
    r = (sess.state() or {}).get('rank')
    return ok and r == idx, r


perfcheck.set_rank = set_rank_by_levels
if __name__ == '__main__':
    sys.exit(perfcheck.main())
