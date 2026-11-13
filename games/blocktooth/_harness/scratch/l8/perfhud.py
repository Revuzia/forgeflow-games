"""L8 scratch: main-thread cost of the L8 HUD per frame (FEATURES_V2 §4.7 budget: median ≤ 0.2 ms added).

Wraps AbilityBar.update/onEvents, ObjectiveTracker.update/onEvents, ScreenMarkers.update (and, for
comparison, the v1 Hud.update) on their prototypes (same ES module instances the app uses in dev), then
runs a busy scene: Size V, ~250 enemies, 3 objectives, 3 power-ups, 13 cards, one UPROAR fired inside the
window. Reports per-frame sum median / p90 / p99 / max over the window. Not the orchestrator's perfcheck.

    python _harness/scratch/l8/perfhud.py --base http://localhost:5258/ --no-serve [--secs 8]
"""
import argparse, json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
from common import Session, add_common_args, build_url, ensure_play, set_rank  # noqa: E402

ap = argparse.ArgumentParser(); add_common_args(ap); ap.add_argument('--secs', type=float, default=8)
args = ap.parse_args()
s = Session(args, 'l8perf'); s.start()
try:
    s.goto(build_url(args.base, autostart=1, dev=1, titan='hearthback', biome='grideast', seed=1337))
    s.wait_bt(90); s.wait_screen(('slate', 'play'), 90); ensure_play(s, 30)
    s.cheat('god', True)
    print('rank:', set_rank(s, 4))
    ensure_play(s, 20)
    s.page.evaluate("""async () => {
      const E = await import('/src/upgrades/engine.ts'); const U = await import('/src/data/upgrades.ts');
      const w = window.__BT__.world;
      const pool = U.UPGRADES.filter((u) => !u.evo && !u.perk && !u.locked && (!u.titan || u.titan === w.titanId));
      for (let i = 0; i < 13; i++) { const u = pool[(i * 7) % pool.length]; for (let k = 0; k < 1 + (i % 3); k++) E.applyUpgrade(w, u.id); }
    }""")
    for k in ('overloadSite', 'reliefDepot', 'recordsAnnex'): print('objective', k, s.cheat('objective', k))
    for k in ('cleanup', 'redLight', 'rushHour'): s.cheat('powerup', k)
    s.page.evaluate("() => { const w = window.__BT__.world; w.map.redLightT = 30; w.map.rushHourT = 30; }")
    ensure_play(s, 10)
    s.page.evaluate("""async () => {
      const A = await import('/src/ui/abilitybar.ts'), T = await import('/src/ui/tracker.ts'), M = await import('/src/ui/markers.ts'), H = await import('/src/ui/hud.ts');
      const acc = window.__L8PERF = { cur: 0, v1: 0, frames: [], v1frames: [], lastFrame: -1, by: { bar: 0, trk: 0, mk: 0 }, calls: 0 };
      const wrap = (proto, name, v1, tag) => { const f = proto[name]; proto[name] = function (...a) { const t0 = performance.now(); try { return f.apply(this, a); } finally { const d = performance.now() - t0; if (v1) acc.v1 += d; else { acc.cur += d; acc.by[tag] += d; } } }; };
      wrap(A.AbilityBar.prototype, 'update', false, 'bar'); wrap(A.AbilityBar.prototype, 'onEvents', false, 'bar');
      wrap(T.ObjectiveTracker.prototype, 'update', false, 'trk'); wrap(T.ObjectiveTracker.prototype, 'onEvents', false, 'trk');
      wrap(M.ScreenMarkers.prototype, 'update', false, 'mk'); wrap(H.Hud.prototype, 'update', true);
      const tick = () => { acc.frames.push(acc.cur); acc.v1frames.push(acc.v1); acc.cur = 0; acc.v1 = 0; if (acc.frames.length < 100000) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }""")
    time.sleep(1.0)
    s.page.evaluate("() => { const P = window.__L8PERF; P.frames.length = 0; P.v1frames.length = 0; P.by = { bar: 0, trk: 0, mk: 0 }; }")
    s.cheat('ult', 100); time.sleep(0.3); s.press('KeyE', 80); time.sleep(0.2)
    for kind, n in (('android', 90), ('squad', 60), ('drone', 50), ('buggy', 25), ('tank', 15), ('walker', 10)):
        s.cheat('spawn', kind, n)
    t0 = time.time()
    while time.time() - t0 < args.secs:
        s.hold(['KeyW'] if int(time.time() - t0) % 2 == 0 else ['KeyD']); time.sleep(0.25)
    s.release_all()
    r = s.page.evaluate("""() => { const q = (a, p) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(p * b.length))] : 0; };
      const A = window.__L8PERF.frames, V = window.__L8PERF.v1frames; const st = window.__BT__.state();
      const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
      const by = window.__L8PERF.by; const nn = Math.max(1, A.length);
      return { by: { bar: by.bar / nn, trk: by.trk / nn, mk: by.mk / nn }, n: A.length, mean: mean(A), v1mean: mean(V), med: q(A, .5), p90: q(A, .9), p99: q(A, .99), max: Math.max(...A), v1med: q(V, .5), v1p99: q(V, .99), enemies: st.enemies, v2dom: st.v2dom, fired: st.v2.ult.fired, fps: window.__BT__.perf() }; }""")
    print('L8 HUD per frame (AbilityBar + ObjectiveTracker + ScreenMarkers): n=%d mean %.3f ms · median %.3f · p90 %.3f · p99 %.3f · max %.3f (performance.now() is 0.1 ms-coarse here)' % (r['n'], r['mean'], r['med'], r['p90'], r['p99'], r['max']))
    print('  mean by part: ability bar %.3f · tracker %.3f · markers %.3f ms/frame' % (r['by']['bar'], r['by']['trk'], r['by']['mk']))
    print('  (v1 Hud.update for comparison: mean %.3f ms · median %.3f · p99 %.3f)' % (r['v1mean'], r['v1med'], r['v1p99']))
    print('  scene: enemies %s · UPROAR fired %s · v2dom %s · perf %s' % (r['enemies'], r['fired'], json.dumps(r['v2dom']), json.dumps(r['fps'])))
    print('BUDGET (median <= 0.2 ms; mean shown as the finer estimate):', 'PASS' if r['med'] <= 0.2 and r['mean'] <= 0.2 else 'FAIL')
finally:
    s.close()
