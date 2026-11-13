#!/usr/bin/env python
"""K2b GATE UI scratch preview (GATEKEEPERS §6.6, §8.3 "scratch preview + harsh self-critique").

    python _harness/scratch/k2b/gateui.py --base http://localhost:5274/ [--width 1280 --height 720] [--only a,b]

Captures into _harness/scratch/k2b/out/ (cheats only set state; the camera is the real game):
  grow_locked_enroute_<W>   gateLock(1) frozen on the lock tick → `SIZE LOCKED — STENCIL-1 EN ROUTE`
  grow_locked_beat_<W>      +2 s → STENCIL-1 spawned: `SIZE LOCKED — BEAT STENCIL-1` + the GATEKEEPER nameplate
  grow_locked_held_<W>      a held level-up while locked (padlock pulse), plate + lock still up
  grow_countdown_<W>        Size IV, LV 34, gateLock(4) before 440 s → `… EN ROUTE · 0:nn`
  plate_stagger_<W>         the plate while TIPPED OVER (meter label)
  gate_markers_<W>          markerview frame items for the gate (whatever K2a's markerview feeds)
  tabloid_heldby_<W>        a death while CORDON-2 holds Size II → `HELD AT SIZE II BY CORDON-2`
  gate_rematch_v_<W>        KEEP GOING → a STENCIL-1 rematch → kicker `REISSUED · SIZE V`
Prints the DOM text read back from each hook next to each shot. Exit 0 when every shot was captured.
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..')))
from common import Session, add_common_args, build_url, ensure_play  # noqa: E402

OUT = os.path.join(HERE, 'out')

DOM_JS = """() => {
  const q = (s) => document.querySelector(s);
  const vis = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden'; };
  const gl = q('[data-gate="grow-lock"]'); const glt = gl ? gl.querySelector('.bt-gl-t') : null;
  const kick = q('[data-gate="kicker"]'); const plate = q('.bt-boss'); const layer = q('.bt-bossbar');
  const mv = q('.bt-bar-mass .bt-bar-val');
  const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
  const clipped = glt ? glt.scrollWidth > glt.clientWidth + 1 : null;
  return {
    lockVisible: vis(gl), lockText: glt ? glt.textContent : null, lockRect: r(gl), lockTextRect: r(glt), lockTextClipped: clipped,
    growValVisible: vis(mv), growVal: mv ? mv.textContent : null,
    sizeChip: vis(q('.bt-size.locked .bt-size-lock')),
    plateVisible: vis(layer) && !(layer && layer.classList.contains('bt-hidden')), plateGate: plate ? plate.classList.contains('gate') : null,
    kickerVisible: vis(kick), kicker: kick ? kick.textContent : null, plateRect: r(plate),
    plateName: q('.bt-boss-name') ? q('.bt-boss-name').textContent : null,
    meterLbl: q('.bt-boss-meter-lbl') ? q('.bt-boss-meter-lbl').textContent : null,
    sub: q('.bt-boss-sub') ? q('.bt-boss-sub').textContent : null,
    heldBy: q('[data-gate="heldby"]') ? q('[data-gate="heldby"]').textContent : null,
    subheads: Array.from(document.querySelectorAll('.bt-np-subhead')).map((e) => e.textContent),
    markers: Array.from(document.querySelectorAll('[data-v2="marker"]')).map((e) => e.textContent),
    ticker: Array.from(document.querySelectorAll('.bt-tk-item.live')).map((e) => e.textContent).slice(-4),
  };
}"""

MARK_JS = """async () => {
  const M = await import('/src/ui/markers.ts');
  const root = document.createElement('div'); root.id = 'k2b-mk';
  root.style.cssText = 'position:fixed;inset:0;z-index:60;pointer-events:none';
  (document.querySelector('.bt-hud') ? document.querySelector('.bt-hud').parentElement : document.body).appendChild(root);
  const m = new M.ScreenMarkers(root); m.show(true);
  const W = innerWidth, H = innerHeight;
  const items = [
    { kind: 'gate', sub: 'stencil1', x: W + 300, y: H * 0.35, onScreen: false, angle: -0.35, dist: 3.4 },
    { kind: 'gate', sub: 'SWITCHBOARD-5', x: W * 0.62, y: -200, onScreen: false, angle: -1.57, dist: 11.2 },
    { kind: 'gate', sub: 'cordon2', x: W * 0.30, y: H * 0.40, onScreen: true, angle: 0, dist: 1.2 },
    { kind: 'weakPoint', sub: 'stencil1', x: W * 0.55, y: H * 0.46, onScreen: true, angle: 0, dist: 0.6 },
    { kind: 'weakPoint', sub: 'cordon2', x: W * 0.55, y: H * 0.60, onScreen: true, angle: 0, dist: 0.8 },
    { kind: 'weakPoint', sub: 'switchboard5', x: W * 0.78, y: H * 0.52, onScreen: true, angle: 0, dist: 1.4 },
  ];
  for (let i = 0; i < 4; i++) { m.update({ items }); await new Promise((r) => requestAnimationFrame(r)); }
  return Array.from(root.querySelectorAll('[data-v2="marker"]')).map((e) => e.textContent).join(' | ');
}"""

GATES_JS = """() => { const w = window.__BT__ && window.__BT__.world; if (!w) return null; const G = w.gates;
  return { t: +w.t.toFixed(2), level: w.titan.level, rank: w.titan.rank, pending: G.pending, active: G.active, unlocked: G.unlocked,
           dueT: G.dueT, boss: w.boss ? { id: w.boss.id, role: w.boss.role, slot: w.boss.slot, alive: w.boss.alive, introT: +w.boss.introT.toFixed(2), staggerT: +w.boss.staggerT.toFixed(2) } : null,
           endless: !!w.endless, rematchGates: G.rematchGates, result: w.run.result }; }"""


def main():
    ap = argparse.ArgumentParser()
    add_common_args(ap)
    ap.add_argument('--only', default='')
    ap.add_argument('--titan', default='molo')
    ap.add_argument('--biome', default='grideast')
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    only = set(x for x in args.only.split(',') if x)
    W = args.width
    shots, missing, log = [], [], []

    def want(n):
        return not only or n in only

    with Session(args, 'k2b') as sess:
        def dom():
            return sess.safe_js(DOM_JS, default={})

        def gates():
            return sess.safe_js(GATES_JS, default={})

        def snap(name, note=''):
            p = os.path.join(OUT, '%s_%d.png' % (name, W))
            try:
                sess.screenshot(p)
                d, g = dom(), gates()
                shots.append(name)
                print('[ok] %-26s %s' % (name, note))
                print('     gates: %s' % json.dumps(g))
                print('     dom:   %s' % json.dumps(d))
                log.append({'name': name, 'gates': g, 'dom': d})
            except Exception as e:
                missing.append('%s (%s)' % (name, str(e).splitlines()[0][:160]))
                print('[!!] %s: %s' % (name, e))

        def fresh(seed):
            sess.release_all()
            sess.goto(build_url(args.base, dev=1, noslate=1, autostart=1, titan=args.titan, biome=args.biome, seed=seed))
            sess.wait_bt(90)
            ok, scr = sess.wait_screen(('play', 'draft'), 90)
            ensure_play(sess, 10)
            sess.cheat('god', True)
            time.sleep(1.0)
            return ok

        def step(n):
            return sess.js('(n) => window.__BT__.step(n)', n)

        # ── A: lock EN ROUTE → BEAT → held level-up → stagger
        if want('lock'):
            fresh(1337)
            sess.js('() => window.__BT__.freeze(true)')
            sess.cheat('gateLock', 1)
            time.sleep(0.6)
            snap('grow_locked_enroute', 'gateLock(1), frozen on the lock tick')
            step(120)                       # 2 s: summonDelayS 1.5 → spawnGate
            time.sleep(0.8)
            snap('grow_locked_beat', 'STENCIL-1 spawned (+2 s)')
            step(240)                       # past the 3 s intro
            # force a stagger through the world (scratch only) and knock 14 % off so fill ≠ trail is visible
            sess.js("() => { const b = window.__BT__.world.boss; if (b) { b.staggerT = 4; b.meter = 0; b.hp = 0.86 * b.maxHp; } }")
            time.sleep(1.2)
            snap('plate_stagger', 'staggerT forced (plate meter label + stagger fill)')
            sess.js("() => { const b = window.__BT__.world.boss; if (b) { b.staggerT = 0; } }")
            sess.cheat('xp', 60)            # a held level-up (drafts queue)
            time.sleep(0.25)
            snap('grow_locked_held', 'held level-up (padlock pulse)')
            sess.js('() => window.__BT__.freeze(false)')
            time.sleep(2.0)
            snap('gate_markers', 'live play, markers as markerview feeds them')

        # ── A2: the two marker kinds through ui/markers.ts itself (a second ScreenMarkers on a test root, fed a
        #        synthetic frame: render/markerview.ts is K2a's and may not feed gate items yet)
        if want('markers'):
            fresh(1341)
            sess.js('() => window.__BT__.freeze(true)')
            r = sess.js(MARK_JS)
            time.sleep(0.8)
            snap('gate_marker_kinds', 'synthetic frame: gate edge arrow ×2, gate chip, weakPoint chips ×3 (%s)' % r)
            sess.js("() => { const e = document.getElementById('k2b-mk'); if (e) e.remove(); }")

        # ── B: the city boss's EN ROUTE · 0:nn countdown (Size IV, LV 34, before 440 s)
        if want('countdown'):
            fresh(1338)
            sess.cheat('gatesOpen', 3)
            sess.cheat('level', 34)
            time.sleep(2.5)
            ensure_play(sess, 10)
            sess.cheat('gateLock', 4)
            time.sleep(1.6)
            snap('grow_countdown', 'gatesOpen(3) + LV 34 + gateLock(4) at t < 440')
            time.sleep(2.2)
            snap('grow_countdown_b', '+2.2 s: the countdown ticks')

        # ── C: tabloid heldBy (a death while CORDON-2 holds Size II)
        if want('heldby'):
            fresh(1339)
            sess.cheat('gatesOpen', 1)
            sess.cheat('level', 15)
            time.sleep(2.5)
            ensure_play(sess, 10)
            sess.cheat('gateLock', 2)
            t_end = time.time() + 8
            while time.time() < t_end:
                g = gates() or {}
                if g.get('active') == 2:
                    break
                ensure_play(sess, 2)
                time.sleep(0.3)
            time.sleep(1.0)
            snap('grow_locked_cordon', 'CORDON-2 alive (BEAT CORDON-2)')
            sess.cheat('god', False)
            sess.js("() => { const w = window.__BT__.world; w.titan.hp = 0.5; w.ult.invulnT = 0; }")
            sess.cheat('spawn', 'tank', 30)
            t_end = time.time() + 40
            while time.time() < t_end and (gates() or {}).get('result') != 'dead':
                ensure_play(sess, 2)
                sess.js("() => { const w = window.__BT__.world; if (w && w.titan.alive) w.titan.hp = Math.min(w.titan.hp, 0.5); }")
                time.sleep(0.4)
            ok, scr = sess.wait_screen(('end',), 30)
            time.sleep(2.2)                 # the paper's spin-in
            snap('tabloid_heldby', 'screen=%s' % scr)

        # ── D: rematch kicker REISSUED · SIZE V
        if want('rematch'):
            fresh(1340)
            sess.cheat('gatesOpen', 3)
            sess.cheat('level', 35)
            time.sleep(2.5)
            ensure_play(sess, 10)
            sess.cheat('endless', True)     # the city boss dies → finale → clear → KEEP GOING (auto)
            t_end = time.time() + 60
            while time.time() < t_end and not (gates() or {}).get('endless'):
                sess.safe_js('() => window.__BT__.cheat.finaleSkip()')
                time.sleep(0.5)
            ensure_play(sess, 15)
            time.sleep(1.0)
            sess.cheat('bossSpawn', 'stencil1')
            time.sleep(2.0)
            snap('gate_rematch_v', 'KEEP GOING + bossSpawn(stencil1) → slot 0')
            # the rematch dies (rematchGates 1), then the titan dies → the EXTENDED COVERAGE EDITION: REISSUED 1
            time.sleep(3.2)
            # bossSpawn(cheat) bypasses spawnRematch, which is what sets nextBossT = Infinity (the death branch of
            # stepEndless only counts a rematch while it is Infinity): mirror it so the REAL branch counts the kill
            sess.js("() => { const w = window.__BT__.world; if (w && w.endless) w.endless.nextBossT = Infinity; }")
            sess.cheat('gateKill')
            time.sleep(1.0)
            sess.cheat('god', False)
            sess.cheat('spawn', 'tank', 30)
            t_end = time.time() + 40
            while time.time() < t_end and (gates() or {}).get('result') != 'dead':
                ensure_play(sess, 2)
                sess.js("() => { const w = window.__BT__.world; if (w && w.titan.alive) { w.ult.invulnT = 0; w.titan.hp = Math.min(w.titan.hp, 0.5); } }")
                time.sleep(0.4)
            ok, scr = sess.wait_screen(('end',), 30)
            time.sleep(2.2)
            snap('tabloid_endless_reissued', 'screen=%s' % scr)

    with open(os.path.join(OUT, 'log_%d.json' % W), 'w', encoding='utf-8') as f:
        json.dump({'shots': shots, 'missing': missing, 'log': log}, f, indent=1)
    print('captured %d · missing %d %s' % (len(shots), len(missing), missing))
    return 0 if not missing else 1


if __name__ == '__main__':
    sys.exit(main())
