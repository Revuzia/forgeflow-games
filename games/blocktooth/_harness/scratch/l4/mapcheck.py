"""L4 scratch: in-browser check of the map sim through the dev cheats + real WASD walk-ins (not a §15.4 gate for L4)."""
import argparse, json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
from common import Session, add_common_args, build_url, ensure_play, world_to_keys, SHOTS  # noqa: E402

ap = argparse.ArgumentParser(); add_common_args(ap); args = ap.parse_args()
sess = Session(args, 'l4mapcheck'); sess.start()
out = {}
try:
    sess.goto(build_url(args.base, autostart=1, dev=1, titan='molo', biome='grideast', seed=1337))
    assert sess.wait_bt(90)
    sess.wait_screen(('slate', 'play'), 90)
    ok, scr = ensure_play(sess, 30); print('play:', ok, scr)
    sess.cheat('god', True)
    def v2(): return sess.js('() => window.__BT__.state().v2')
    def walk_to(get_xz, done, budget=12.0):
        t0 = time.time()
        while time.time() - t0 < budget:
            ok, scr = ensure_play(sess, 5)
            s = sess.state(); p = get_xz()
            if p is None: break
            sess.hold(world_to_keys(p[0] - s['x'], p[1] - s['z']))
            if done(): sess.release_all(); return True, time.time() - t0
            time.sleep(0.1)
        sess.release_all(); return done(), time.time() - t0
    ok, oid = sess.cheat('objective', 'overloadSite'); o = [q for q in v2()['objectives'] if q['id'] == oid]
    print('cheat objective(overloadSite):', ok, oid, json.dumps(o))
    n0 = v2()['map']['overloadsDone']
    r = walk_to(lambda: next(((q['x'], q['z']) for q in v2()['objectives'] if q['id'] == oid), None), lambda: v2()['map']['overloadsDone'] > n0, 20)
    print('walked into the OVERLOAD SITE (real WASD):', r, 'map', json.dumps(v2()['map']))
    ok, pid = sess.cheat('powerup', 'rushHour'); print('cheat powerup(rushHour):', ok, pid, json.dumps(v2()['powerups']))
    r = walk_to(lambda: next(((q['x'], q['z']) for q in v2()['powerups'] if q['id'] == pid), None), lambda: v2()['power']['rushHourT'] > 0, 10)
    print('walked into RUSH HOUR:', r, 'power', json.dumps(v2()['power']))
    ok, rid = sess.cheat('objective', 'reliefDepot', 4.0); m0 = v2()['map']['reliefsDone']
    r = walk_to(lambda: next(((q['x'], q['z']) for q in v2()['objectives'] if q['id'] == rid), None), lambda: v2()['map']['reliefsDone'] > m0, 10)
    print('walked into the RELIEF DEPOT:', r, 'map', json.dumps(v2()['map']))
    ok, lid = sess.cheat('powerup', 'redLight')
    r = walk_to(lambda: next(((q['x'], q['z']) for q in v2()['powerups'] if q['id'] == lid), None), lambda: v2()['power']['redLightT'] > 0, 10)
    print('walked into RED LIGHT:', r, 'power', json.dumps(v2()['power']))
    sess.screenshot(os.path.join(SHOTS, 'l4_mapcheck.png'))
    d = sess.diagnostics(); print('console errors', len(d.get('console', [])) if isinstance(d, dict) else d)
    print(json.dumps({k: (len(v) if isinstance(v, list) else v) for k, v in d.items()}) if isinstance(d, dict) else '')
finally:
    sess.close()
