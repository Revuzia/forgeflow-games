"""K0 browser smoke: the gate cheats + a gatekeeper in the w.boss slot through the real app (views, HUD,
bossbar, sfx). Not a lane gate — evidence that the pre-wired app paths do not throw with a gate id."""
import argparse, json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..')))
from common import Session, add_common_args, build_url, dismiss_slate, diag_problems  # noqa: E402

ap = argparse.ArgumentParser()
add_common_args(ap)
args = ap.parse_args()
out = os.path.join(HERE, 'cheats')
os.makedirs(out, exist_ok=True)
problems = []
with Session(args, 'k0_gate_cheats') as s:
    s.goto(build_url(args.base, autostart=1, dev=1, titan='molo', biome='grideast', seed=5))
    assert s.wait_bt(90), '__BT__ never appeared'
    ok, scr = s.wait_screen(('slate', 'play'), 90)
    if scr == 'slate':
        dismiss_slate(s, 20, 'Enter')
    s.wait_screen(('play',), 30)
    time.sleep(1.0)
    st = s.state()
    g = st.get('gates')
    print('state().gates keys:', sorted(g.keys()) if g else None)
    print('gates.unlocked', g and g.get('unlocked'), 'pending', g and g.get('pending'), 'live', g and g.get('live'))
    if not g or g.get('unlocked') != 4:
        problems.append('state().gates missing or unlocked != 4 (K0 stub): %r' % (g,))
    print('cheat.god', s.cheat('god', True))
    for gid in ('stencil1', 'cordon2', 'switchboard5'):
        ok, v = s.cheat('bossSpawn', gid)
        print('cheat.bossSpawn(%s) ->' % gid, ok, v)
        if not ok or v != gid:
            problems.append('bossSpawn(%s) failed: %r' % (gid, v))
            continue
        time.sleep(1.5)
        st = s.state()
        b, g = st.get('boss'), st.get('gates')
        print('   boss', json.dumps({k: b.get(k) for k in ('id', 'role', 'slot', 'hp', 'maxHp', 'introT', 'alive')}) if b else None)
        print('   gates.live', g and g.get('live'))
        if not b or b.get('role') != 'gate':
            problems.append('%s: state().boss.role %r' % (gid, b and b.get('role')))
        ev = [e['type'] for e in (s.bt_call('events', 60)[1] or [])]
        if 'gateSpawn' not in ev:
            problems.append('%s: no gateSpawn in the event ring' % gid)
        s.screenshot(os.path.join(out, 'gate_%s_live.png' % gid))
        ok, v = s.cheat('gateHp', 0.5)
        print('   cheat.gateHp(0.5) ->', ok, v)
        ok, v = s.cheat('gateKill')
        print('   cheat.gateKill() ->', ok, v)
        if not ok or v is not True:
            problems.append('%s: gateKill -> %r' % (gid, v))
        time.sleep(2.0)
        ev = [e['type'] for e in (s.bt_call('events', 80)[1] or [])]
        print('   recent events include gateDefeated:', 'gateDefeated' in ev, '· bossDefeated:', 'bossDefeated' in ev)
        if 'gateDefeated' not in ev:
            problems.append('%s: no gateDefeated' % gid)
        st = s.state()
        if st.get('run', {}).get('result'):
            problems.append('%s: a gate kill ended the run (%r)' % (gid, st['run']))
    ok, v = s.cheat('gateLock', 1)
    print('cheat.gateLock(1) ->', ok, v, '(K0 stub lockGate is a no-op: pending stays 0)')
    ok, v = s.cheat('gatesOpen', 4)
    print('cheat.gatesOpen(4) ->', ok, v)
    ok, v = s.cheat('finaleSkip')
    print('cheat.finaleSkip() ->', ok, v, '(K0 stub endFinale is a no-op)')
    s.screenshot(os.path.join(out, 'after_gates.png'))
    d = s.diagnostics()
    dp = diag_problems(d)
    print('diagnostics problems:', dp)
    problems += dp
print('PROBLEMS:', problems)
print('RESULT:', 'OK' if not problems else 'FAIL')
sys.exit(0 if not problems else 1)
