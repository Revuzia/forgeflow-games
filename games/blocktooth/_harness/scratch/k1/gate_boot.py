"""Gate K1 browser check (molo / grideast): force the LV 7 lock by cheat XP, STENCIL-1 spawns, a live fight
with real keys (god on), then the kill stepped tick by tick on the frozen sim so the kill tick's own events
can be read: gateDefeated and rankUp 1 must be in the SAME tick, titan.rank 1 after it. Not a lane gate file."""
import argparse, json, math, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..')))
from common import Session, add_common_args, build_url, dismiss_slate, diag_problems  # noqa: E402

ap = argparse.ArgumentParser()
add_common_args(ap)
ap.add_argument('--seed', type=int, default=5)
args = ap.parse_args()
out = os.path.join(HERE, 'gateboot')
os.makedirs(out, exist_ok=True)
problems = []
C = math.sqrt(0.5)


def keys_toward(dx, dz, wmap):
    """Pick the WASD combination whose world direction (measured, wmap) is closest to (dx, dz)."""
    m = math.hypot(dx, dz) or 1.0
    dx, dz = dx / m, dz / m
    best, bs = [], -9
    combos = [['w'], ['s'], ['a'], ['d'], ['w', 'a'], ['w', 'd'], ['s', 'a'], ['s', 'd']]
    for c in combos:
        vx = sum(wmap[k][0] for k in c); vz = sum(wmap[k][1] for k in c)
        vm = math.hypot(vx, vz) or 1.0
        s = (vx * dx + vz * dz) / vm
        if s > bs:
            bs, best = s, c
    return best


def world_js(expr):
    return "() => { const B = window.__BT__; let w = B.world; if (typeof w === 'function') w = w.call(B); " + expr + " }"


def drain_drafts(s, budget=15):
    t0 = time.time()
    while time.time() - t0 < budget:
        scr = s.screen()
        if scr == 'play':
            return True
        s.bt_call('dismiss')
        time.sleep(0.4)
    return s.screen() == 'play'


with Session(args, 'k1_gate_boot') as s:
    s.goto(build_url(args.base, autostart=1, dev=1, titan='molo', biome='grideast', seed=args.seed))
    assert s.wait_bt(90), '__BT__ never appeared'
    ok, scr = s.wait_screen(('slate', 'play'), 90)
    if scr == 'slate':
        dismiss_slate(s, 20, 'Enter')
    s.wait_screen(('play',), 30)
    time.sleep(1.0)
    st = s.state()
    g0 = st.get('gates') or {}
    print('start: gates.unlocked', g0.get('unlocked'), 'pending', g0.get('pending'), '· LV', st.get('level'), 'rank', st.get('rank'))
    if g0.get('unlocked') != 0:
        problems.append('gates.unlocked at run start %r (K1a: 0)' % g0.get('unlocked'))
    print('cheat.god', s.cheat('god', True))

    # measure WASD → world direction (real keys, 0.6 s each)
    wmap = {}
    for k in ('w', 'a', 's', 'd'):
        a = s.state(); s.hold([k]); time.sleep(0.6); s.hold([]); b = s.state()
        vx, vz = b['x'] - a['x'], b['z'] - a['z']; m = math.hypot(vx, vz) or 1.0
        wmap[k] = (vx / m, vz / m)
    print('key map:', {k: (round(v[0], 2), round(v[1], 2)) for k, v in wmap.items()})

    # LV 7 via cheat XP (real gainXp path) → the lock, not a rank-up
    locked_at = None
    for i in range(80):
        ok, lv = s.cheat('xp', 25)
        drain_drafts(s)
        st = s.state(); g = st.get('gates') or {}
        if g.get('pending') == 1 or g.get('active') == 1:
            locked_at = (st.get('level'), st.get('rank'), st.get('t'))
            break
    print('lock: LV/rank/t', locked_at, '· gates', json.dumps({k: (st.get('gates') or {}).get(k) for k in ('unlocked', 'pending', 'active', 'dueT', 'lockT')}))
    if not locked_at or locked_at[0] != 7 or locked_at[1] != 0:
        problems.append('LV 7 lock not observed as (LV 7, rank 0): %r' % (locked_at,))
    ev = [e.get('type') for e in (s.bt_call('events', 400)[1] or [])]
    if 'gateLocked' not in ev:
        problems.append('no gateLocked in the event ring')

    # STENCIL-1 arrives (summonDelayS 1.5 s + intro)
    boss = None
    for i in range(40):
        time.sleep(0.25)
        drain_drafts(s, 5)
        st = s.state(); boss = st.get('boss')
        if boss and boss.get('id') == 'stencil1':
            break
    print('spawn:', json.dumps({k: boss.get(k) for k in ('id', 'role', 'slot', 'hp', 'maxHp', 'introT', 'alive')}) if boss else None, '· t', st.get('t'))
    if not boss or boss.get('id') != 'stencil1' or boss.get('role') != 'gate' or boss.get('slot') != 1:
        problems.append('STENCIL-1 not fielded in slot 1: %r' % (boss,))
    s.screenshot(os.path.join(out, 'k1_stencil_spawn.png'))

    # live fight with real keys toward the rig for ~20 s (god on); the kit auto-attacks
    hp0 = boss.get('hp') if boss else None
    t_end = time.time() + 20
    shot_mid = False
    while time.time() < t_end:
        drain_drafts(s, 5)
        st = s.state(); b = st.get('boss')
        if not b or not b.get('alive'):
            break
        dx, dz = b['x'] - st['x'], b['z'] - st['z']
        d = math.hypot(dx, dz)
        want = keys_toward(dx, dz, wmap) if d > 8 else keys_toward(-dz, dx, wmap)   # close in, then circle
        s.hold(want)
        if not shot_mid and time.time() > t_end - 10:
            s.screenshot(os.path.join(out, 'k1_stencil_fight.png')); shot_mid = True
        time.sleep(0.15)
    s.hold([])
    st = s.state(); b = st.get('boss') or {}
    print('after the live fight: boss hp %.0f → %.0f of %.0f · titan hp %.0f · t %.1f' % (hp0 or -1, b.get('hp', -1), b.get('maxHp', -1), st.get('hp', -1), st.get('t', -1)))
    if hp0 is not None and b.get('hp', hp0) >= hp0:
        problems.append('the live fight did no damage to STENCIL-1')

    # the kill on the frozen sim, one tick at a time, so the kill tick's own events are read
    ok, v = s.cheat('gateHp', 0.02)
    print('cheat.gateHp(0.02) ->', ok, v)
    s.bt_call('freeze', True)
    kill = None
    for i in range(30 * 40):
        st0 = s.safe_js(world_js("const T = w.titan, b = w.boss; return b ? {tx: T.x, tz: T.z, bx: b.x, bz: b.z, alive: b.alive} : null;"))
        if not st0 or not st0['alive']:
            break
        dx, dz = st0['bx'] - st0['tx'], st0['bz'] - st0['tz']; m = math.hypot(dx, dz) or 1.0
        inp = {'mx': dx / m, 'mz': dz / m, 'ability': (i % 45 == 0), 'abilityHeld': False, 'dash': False}
        if m < 8:
            inp['mx'], inp['mz'] = -dz / m, dx / m
        s.bt_call('step', 1, inp)
        r = s.safe_js(world_js("return {t: w.t, tick: w.tick, rank: w.titan.rank, level: w.titan.level, unlocked: w.gates.unlocked, alive: w.boss ? w.boss.alive : null,"
                               " ev: w.events.map((e) => e.type === 'rankUp' ? 'rankUp:' + e.rank : e.type === 'gateDefeated' ? 'gateDefeated:' + e.slot : e.type)};"))
        if r and 'gateDefeated:1' in r['ev']:
            kill = r
            break
        if r and any(e.startswith('rankUp') for e in r['ev']):
            problems.append('rankUp on tick %s without the kill: %r' % (r['tick'], r['ev']))
    s.bt_call('freeze', False)
    if kill:
        interesting = [e for e in kill['ev'] if e.startswith(('rankUp', 'gateDefeated', 'bossHit', 'ultCharged', 'levelUp', 'alert', 'bossDefeated'))]
        print('KILL TICK %d (t %.2f): rank %d · LV %d · gates.unlocked %d · events: %s' % (kill['tick'], kill['t'], kill['rank'], kill['level'], kill['unlocked'], ' '.join(interesting)))
        if 'rankUp:1' not in kill['ev']:
            problems.append('rankUp 1 NOT on the kill tick')
        if kill['rank'] != 1 or kill['unlocked'] != 1:
            problems.append('after the kill tick rank %d unlocked %d (want 1 / 1)' % (kill['rank'], kill['unlocked']))
    else:
        problems.append('no kill tick observed within the step budget')
    time.sleep(2.5)
    drain_drafts(s, 10)
    time.sleep(1.0)
    s.screenshot(os.path.join(out, 'k1_after_breach.png'))
    st = s.state()
    print('after: screen', s.screen(), '· rank', st.get('rank'), '· height %.2f' % st.get('height', -1), '· gates', json.dumps({k: (st.get('gates') or {}).get(k) for k in ('unlocked', 'pending', 'active')}))
    if not s.frames_advancing(3.0):
        problems.append('frames not advancing after the breach')
    d = s.diagnostics()
    problems += diag_problems(d)

print('PROBLEMS (%d):' % len(problems))
for p in problems:
    print('  - ' + p)
print('RESULT:', 'OK' if not problems else 'FAIL')
sys.exit(0 if not problems else 1)
