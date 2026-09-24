#!/usr/bin/env python
"""BLOCKTOOTH view-lane check: the titan GROWS ON SCREEN level by level, a Size breach pulls the
camera back, and the player zoom works with REAL input (wheel + keys) — headed Chrome, real GPU.

    python _harness/scratch/view/viewcheck.py --base http://localhost:5230 [--titan molo --biome grideast]

Levels come from dev cheat.xp (one level per call, the draft each opens is picked with a real '1'
key press). At each checkpoint it records: level, rank, body height H, the ACTUAL camera distance
(__BTCAM__.distance), the auto distance, zoom, the body's screen fraction (foot→head projected
through the live camera) and a screenshot. Then zoom: real mouse wheel (page.mouse.wheel → trusted
WheelEvent) and real held '-' / '=' / 'Z' keys at Size I and at Size V, distance before/after, plus
min/max screenshots; finally a wheel while paused must not move the camera.
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..')))
from common import Session, add_common_args, build_url, ensure_play  # noqa: E402

OUT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '_shots', 'view'))

MEASURE_JS = r"""() => {
  const bt = window.__BT__, rig = window.__BTCAM__, core = bt.debugCore;
  const w = bt.world, T = w.titan, cam = core.camera;
  const V = cam.position.constructor;
  const a = new V(T.x, 0, T.z).project(cam), b = new V(T.x, T.height, T.z).project(cam);
  return {
    screen: bt.state().screen, level: T.level, rank: T.rank, H: +T.height.toFixed(3), xp: T.xp, xpToNext: T.xpToNext,
    dist: +rig.distance.toFixed(2), auto: +rig.autoDist.toFixed(2), zoom: +rig.zoom.toFixed(3), zoomT: +rig.zoomTarget.toFixed(3),
    fracFormula: +(T.height / (rig.distance * 2 * Math.tan(15 * Math.PI / 180))).toFixed(4),
    fracProj: +(Math.abs(b.y - a.y) / 2).toFixed(4),
    fps: bt.state().fps, draws: bt.state().draws,
  };
}"""


def measure(sess):
    return sess.js(MEASURE_JS)


def settle(sess, s):
    t_end = time.time() + s
    while time.time() < t_end:
        ensure_play(sess, timeout_s=5)
        time.sleep(0.2)


def level_to(sess, target, log):
    """cheat.xp exactly one level at a time; each draft is picked with a real '1'."""
    guard = 0
    while guard < 200:
        guard += 1
        st = sess.js("() => { const T = __BT__.world.titan; return {lv: T.level, xp: T.xp, n: T.xpToNext}; }")
        if st['lv'] >= target:
            return True
        need = max(1.0, st['n'] - st['xp'] + 0.5)
        ok, v = sess.cheat('xp', need)
        if not ok:
            log('cheat.xp failed: %s' % v)
            return False
        time.sleep(0.15)
        ensure_play(sess, timeout_s=12)
    return False


def rank_levels(sess):
    """RANK_LEVELS straight from the live config module (Vite serves /src in dev)."""
    return sess.page.evaluate("async () => (await import('/src/core/config.ts')).RANK_LEVELS.slice()")


def shot(sess, name):
    p = os.path.join(OUT, name + '.png')
    sess.screenshot(p)
    return p


def main():
    ap = argparse.ArgumentParser()
    add_common_args(ap)
    ap.add_argument('--titan', default='molo')
    ap.add_argument('--biome', default='grideast')
    ap.add_argument('--seed', type=int, default=5)
    ap.add_argument('--levels', default='auto', help="'auto' = 1, 3, the last level of Size I, every breach, mid-II, the last level of IV")
    ap.add_argument('--prefix', default='')
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    log = print
    rep = {'growth': [], 'zoom': {}}
    url = build_url(args.base, autostart=1, dev=1, noslate=1, titan=args.titan, biome=args.biome, seed=args.seed)
    with Session(args, 'viewcheck') as sess:
        sess.goto(url)
        sess.wait_bt(60)
        sess.wait_screen(['play', 'slate', 'draft'], 90)
        ensure_play(sess, timeout_s=20)
        sess.cheat('god', True)
        time.sleep(1.5)
        pre = args.prefix
        RL = rank_levels(sess)
        rep['rankLevels'] = RL
        log('RANK_LEVELS', RL)
        if args.levels == 'auto':
            levels = sorted(set([1, 3, RL[1] - 1, RL[1], (RL[1] + RL[2]) // 2, RL[2], RL[3], RL[4] - 1, RL[4]]))
        else:
            levels = [int(x) for x in args.levels.split(',')]
        breaches = set(RL[1:])
        for L in levels:
            if not level_to(sess, L, log):
                log('could not reach LV %d' % L)
                break
            breach = L in breaches
            if breach:
                time.sleep(0.35)
                m = measure(sess)
                m['phase'] = 'breach+0.35s'
                m['shot'] = shot(sess, '%sgrow_lv%02d_breach' % (pre, L))
                rep['growth'].append(m)
                log(json.dumps(m))
            settle(sess, 3.2 if breach else 2.0)
            m = measure(sess)
            m['phase'] = 'settled'
            m['shot'] = shot(sess, '%sgrow_lv%02d' % (pre, L))
            rep['growth'].append(m)
            log(json.dumps(m))
            if L == levels[0] or L == RL[4]:
                tag = 'size1' if L == levels[0] else 'size5'
                z = {}
                # REAL wheel: out (deltaY +) 12 notches over the canvas centre
                sess.page.mouse.move(640, 360)
                before = measure(sess)
                for _ in range(12):
                    sess.page.mouse.wheel(0, 100)
                    time.sleep(0.04)
                time.sleep(0.8)
                after = measure(sess)
                z['wheelOut'] = {'before': before['dist'], 'after': after['dist'], 'zoom': after['zoom'], 'auto': after['auto']}
                z['wheelOutShot'] = shot(sess, '%szoom_%s_max' % (pre, tag))
                # real held '=' (zoom in) for 2.5 s → the in-limit
                sess.page.keyboard.down('Equal'); time.sleep(2.5); sess.page.keyboard.up('Equal')
                time.sleep(0.6)
                mn = measure(sess)
                z['keyIn'] = {'after': mn['dist'], 'zoom': mn['zoom'], 'auto': mn['auto']}
                z['keyInShot'] = shot(sess, '%szoom_%s_min' % (pre, tag))
                # real held '-' for 0.6 s
                b2 = measure(sess)
                sess.page.keyboard.down('Minus'); time.sleep(0.6); sess.page.keyboard.up('Minus')
                time.sleep(0.6)
                a2 = measure(sess)
                z['keyOut'] = {'before': b2['dist'], 'after': a2['dist'], 'zoom': a2['zoom']}
                # wheel IN 3 notches
                b3 = measure(sess)
                for _ in range(3):
                    sess.page.mouse.wheel(0, -100); time.sleep(0.04)
                time.sleep(0.8)
                a3 = measure(sess)
                z['wheelIn'] = {'before': b3['dist'], 'after': a3['dist'], 'zoom': a3['zoom']}
                # Z resets
                sess.press('KeyZ')
                time.sleep(1.0)
                a4 = measure(sess)
                z['reset'] = {'after': a4['dist'], 'zoom': a4['zoom'], 'auto': a4['auto']}
                # paused: a wheel must NOT zoom
                sess.press('Escape')
                time.sleep(0.6)
                scr = sess.screen()
                b5 = sess.js("() => __BTCAM__.zoomTarget")
                for _ in range(5):
                    sess.page.mouse.wheel(0, 100); time.sleep(0.04)
                time.sleep(0.4)
                a5 = sess.js("() => __BTCAM__.zoomTarget")
                z['pausedWheel'] = {'screen': scr, 'zoomTargetBefore': b5, 'zoomTargetAfter': a5}
                sess.press('Escape')
                time.sleep(0.6)
                ensure_play(sess, timeout_s=10)
                rep['zoom'][tag] = z
                log(tag, json.dumps(z))
        # persistence: a NEW run resets the zoom; a zoom set at Size I survives the LV 5 breach
        ok, v = sess.bt_call('newRun', {'titan': args.titan, 'biome': args.biome, 'seed': args.seed + 1, 'skipSlate': True})
        sess.wait_screen(['play', 'slate', 'draft'], 90)
        ensure_play(sess, timeout_s=20)
        sess.cheat('god', True)
        time.sleep(1.2)
        p0 = measure(sess)
        sess.page.mouse.move(640, 360)
        for _ in range(4):
            sess.page.mouse.wheel(0, 100); time.sleep(0.04)
        time.sleep(0.8)
        p1 = measure(sess)
        level_to(sess, RL[1], log)
        settle(sess, 3.2)
        p2 = measure(sess)
        rep['zoom']['persist'] = {'newRunZoom': p0['zoom'], 'afterWheelLv1': p1, 'afterBreachLv5': p2}
        log('persist', json.dumps(rep['zoom']['persist']))
        d = sess.diagnostics()
        rep['errors'] = d
        log('diagnostics', json.dumps(d)[:600])
    out = os.path.join(OUT, '%sviewcheck.json' % args.prefix)
    with open(out, 'w') as f:
        json.dump(rep, f, indent=1)
    log('report', out)
    return 0


if __name__ == '__main__':
    sys.exit(main())
