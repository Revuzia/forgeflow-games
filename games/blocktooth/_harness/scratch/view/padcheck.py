#!/usr/bin/env python
"""Gamepad zoom through the game's real Input.pollPads: navigator.getGamepads is replaced BEFORE the
page loads by a standard-mapping pad whose right-stick Y (axes[3]) and R3 (button 11) the harness
drives via window.__PAD__. Measures the camera distance before/after.

    python _harness/scratch/view/padcheck.py --base http://localhost:5230
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..')))
from common import Session, add_common_args, build_url, ensure_play  # noqa: E402

PAD_JS = r"""
window.__PAD__ = { ry: 0, r3: false };
(() => {
  const mk = () => {
    const P = window.__PAD__;
    const buttons = [];
    for (let i = 0; i < 17; i++) { const on = i === 11 && P.r3; buttons.push({ pressed: on, touched: on, value: on ? 1 : 0 }); }
    return { id: 'harness pad (standard)', index: 0, connected: true, mapping: 'standard', timestamp: performance.now(),
             axes: [0, 0, 0, P.ry], buttons };
  };
  Object.defineProperty(navigator, 'getGamepads', { value: () => [mk(), null, null, null], configurable: true });
})();
"""


def main():
    ap = argparse.ArgumentParser()
    add_common_args(ap)
    args = ap.parse_args()
    res = {}
    with Session(args, 'padcheck') as sess:
        sess.page.add_init_script(PAD_JS)
        sess.goto(build_url(args.base, autostart=1, dev=1, noslate=1, titan='molo', biome='grideast', seed=5))
        sess.wait_bt(60)
        sess.wait_screen(['play', 'slate', 'draft'], 90)
        ensure_play(sess, 20)
        sess.cheat('god', True)
        time.sleep(1.0)
        d = lambda: sess.js('() => ({d: +__BTCAM__.distance.toFixed(2), z: +__BTCAM__.zoomTarget.toFixed(3)})')
        res['start'] = d()
        sess.js('() => { __PAD__.ry = 1; }'); time.sleep(0.6); sess.js('() => { __PAD__.ry = 0; }'); time.sleep(0.6)
        res['stickDown0.6s'] = d()
        sess.js('() => { __PAD__.ry = -1; }'); time.sleep(0.3); sess.js('() => { __PAD__.ry = 0; }'); time.sleep(0.6)
        res['stickUp0.3s'] = d()
        sess.js('() => { __PAD__.ry = 0.15; }'); time.sleep(0.6); sess.js('() => { __PAD__.ry = 0; }'); time.sleep(0.4)
        res['deadzone0.15'] = d()
        sess.js('() => { __PAD__.r3 = true; }'); time.sleep(0.15); sess.js('() => { __PAD__.r3 = false; }'); time.sleep(1.0)
        res['R3'] = d()
        # paused (ui mode): the stick must not zoom
        sess.press('Escape'); time.sleep(0.5)
        scr = sess.screen()
        sess.js('() => { __PAD__.ry = 1; }'); time.sleep(0.6); sess.js('() => { __PAD__.ry = 0; }'); time.sleep(0.3)
        res['pausedStick'] = dict(d(), screen=scr)
        sess.press('Escape'); time.sleep(0.4)
        res['diag'] = sess.diagnostics()
    print(json.dumps(res, indent=1))
    return 0


if __name__ == '__main__':
    sys.exit(main())
