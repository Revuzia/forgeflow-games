import json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
from common import Session, add_common_args, build_url, ensure_play
import argparse
ap = argparse.ArgumentParser(); add_common_args(ap); a = ap.parse_args(); a.no_serve = True
with Session(a, 'fdbg') as s:
    s.goto(build_url(a.base, dev=1, noslate=1, autostart=1, titan='molo', biome='grideast', seed=46))
    s.wait_bt(90); s.wait_screen(('play',), 90); ensure_play(s)
    s.cheat('god', True)
    s.js("() => { window.__BT__.world.gates.mainEarliestT = 0; }")
    s.cheat('gatesOpen', 3); s.cheat('level', 34); time.sleep(0.6); ensure_play(s)
    s.js("() => { const T = window.__BT__.world.titan; T.xp = T.xpToNext - 1; }")
    s.cheat('xp', 2)
    for _ in range(100):
        b = s.js("() => { const b = window.__BT__.world.boss; return b && b.alive && b.role === 'main' ? b.introT : null; }")
        if b is not None and b <= 0: break
        ensure_play(s, 2); time.sleep(0.2)
    s.cheat('gateKill')
    t0 = time.time()
    while time.time() - t0 < 7:
        r = s.js("""() => { const a = document.querySelector('.bt-alert'); const t = a && a.querySelector('.bt-alert-title');
          const r = a ? a.getBoundingClientRect() : null; const cs = a ? getComputedStyle(a) : null;
          const ev = window.__BT__.events(30).filter(e => e.type === 'alert' || e.type === 'finale').map(e => e.type + ':' + (e.key || e.on));
          return { cls: a && a.className, title: t && t.textContent, rect: r && [r.x|0, r.y|0, r.width|0, r.height|0], disp: cs && cs.display, op: cs && cs.opacity,
            su: document.querySelector('.bt-sizeup').className, fT: +window.__BT__.world.gates.finaleT.toFixed(2), ev, screen: window.__BT__.state().screen }; }""")
        print('%.1f' % (time.time() - t0), json.dumps(r))
        time.sleep(0.25)
