"""L8 scratch: in-browser check of the v2 HUD (ability bar, UPROAR meter, ACTIVE panel, tracker, toasts).

    python _harness/scratch/l8/hudcheck.py --base http://localhost:5258/ --no-serve [--width 1920 --height 1080]
      [--titan molo] [--cards 13] [--tag abilitybar_1280] [--alert] [--urgent]

Sets up state through dev cheats / module imports (cards owned, UPROAR charge, an OVERLOAD SITE, a RED
LIGHT timer, one v2 goal toast, one broadcast alert), takes a screenshot to _shots/l8_<tag>.png, prints
the v2dom snapshot vs state, and the bounding boxes of every HUD block with an overlap check.
"""
import argparse, json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
from common import Session, add_common_args, build_url, ensure_play, SHOTS  # noqa: E402

ap = argparse.ArgumentParser(); add_common_args(ap)
ap.add_argument('--titan', default='molo'); ap.add_argument('--biome', default='grideast')
ap.add_argument('--cards', type=int, default=13); ap.add_argument('--tag', default=None)
ap.add_argument('--alert', action='store_true', help='raise a broadcast toast alert (OVERLOAD SITE cheat)')
ap.add_argument('--urgent', action='store_true', help='raise an urgent strap (elite spawn)')
ap.add_argument('--ult', type=float, default=74)
ap.add_argument('--evo', default='', help='an evolution id to own (via its recipe + pick)')
ap.add_argument('--hold', type=float, default=1.2)
args = ap.parse_args()
tag = args.tag or ('hud_%dx%d_%s' % (args.width, args.height, args.titan))
sess = Session(args, 'l8hud'); sess.start()
try:
    sess.goto(build_url(args.base, autostart=1, dev=1, titan=args.titan, biome=args.biome, seed=1337))
    assert sess.wait_bt(90)
    sess.wait_screen(('slate', 'play'), 90)
    ok, scr = ensure_play(sess, 30); print('play:', ok, scr)
    sess.cheat('god', True)
    sess.cheat('noSpawns', True)
    # cards: a spread of rarities / triggers / stacks, the requested count, + optional evolution
    res = sess.page.evaluate("""async ([n, evo]) => {
      const E = await import('/src/upgrades/engine.ts');
      const D = await import('/src/upgrades/draft.ts');
      const U = await import('/src/data/upgrades.ts');
      const w = window.__BT__.world;
      const pool = U.UPGRADES.filter((u) => !u.evo && !u.perk && !u.locked && (!u.titan || u.titan === w.titanId));
      // deterministic spread: every 7th card
      const pick = []; for (let i = 0; pick.length < n && i < pool.length * 7; i += 7) { const u = pool[i % pool.length]; if (!pick.includes(u)) pick.push(u); }
      pick.forEach((u, i) => { const st = Math.min(u.maxStacks, 1 + (i % 4)); for (let k = 0; k < st; k++) E.applyUpgrade(w, u.id); });
      if (evo) {
        const d = U.UPGRADE_BY_ID[evo];
        for (let k = 0; k < 8; k++) E.applyUpgrade(w, d.evo.base);
        E.applyUpgrade(w, d.evo.with);
        w.upgrades.offer = [evo]; D.pickUpgrade(w, evo);
      }
      return { order: w.upgrades.order.slice(), owned: { ...w.upgrades.owned } };
    }""", [args.cards, args.evo])
    print('owned:', len([k for k, v in res['owned'].items() if v > 0]), 'cards')
    sess.cheat('ult', args.ult)
    if args.alert:
        ok, oid = sess.cheat('objective', 'overloadSite'); print('objective overloadSite:', ok, oid)
    sess.cheat('objective', 'reliefDepot', 30)
    sess.page.evaluate("() => { const w = window.__BT__.world; w.map.redLightT = 4.2; }")
    if args.urgent:
        print('spawn elite:', sess.cheat('spawn', 'elite', 1))
    sess.page.evaluate("""async () => { const T = await import('/src/ui/toast.ts');
      T.pushHudToast({ kicker: 'GOAL MET', title: 'CROWD CONTROL', sub: 'UNLOCKED: Airtime Ledger — NEXT RUN', glyph: 'ribbon' }); }""")
    time.sleep(args.hold)
    path = os.path.join(SHOTS, 'l8_%s.png' % tag)
    sess.screenshot(path); print('shot:', path)
    st = sess.js("() => { const s = window.__BT__.state(); return { v2dom: s.v2dom, ult: s.v2 && s.v2.ult, cd: window.__BT__.world.titan.abilityCd, map: s.v2 && s.v2.map } }")
    print('v2dom:', json.dumps(st))
    boxes = sess.page.evaluate("""() => {
      const q = (sel) => Array.from(document.querySelectorAll(sel)).filter((n) => n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden')
        .map((n) => { const r = n.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; });
      const u = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--u')) || Math.max(8, Math.min(innerWidth / 100, innerHeight * 1.7778 / 100));
      return { u: Math.max(8, Math.min(innerWidth / 100, innerHeight * 1.7778 / 100)),
        status: q('.bt-status'), bar: q('.bt-abar'), slots: q('.bt-slot'), meter: q('.bt-uproar'), tab: q('.bt-up-tab'), active: q('.bt-active'),
        zoom: q('.bt-zoomhint'), tracker: q('.bt-trow'), counters: q('.bt-counters'), bug: q('.bt-bug'),
        alertToast: q('.bt-alert.toast.on'), alertUrgent: q('.bt-alert.urgent.on'), toasts: q('.bt-toast'), ticker: q('.bt-ticker'), boss: q('.bt-boss') };
    }""")
    u = boxes.pop('u')
    print('u = %.2f px' % u)
    for k, v in boxes.items():
        print('  %-11s %s' % (k, ' '.join('[%d,%d–%d,%d]' % tuple(b) for b in v[:3]) + (' +%d' % (len(v) - 3) if len(v) > 3 else '')))
        if k in ('alertToast', 'alertUrgent', 'toasts', 'meter', 'bar', 'active', 'tracker'):
            for b in v[:3]:
                print('      in u: top %.2f bottom %.2f (from top) · bottom-edge %.2fu from screen bottom' % (b[1] / u, b[3] / u, (args.height - b[3]) / u))
    blocks = ['status', 'bar', 'meter', 'tab', 'active', 'zoom', 'tracker', 'counters', 'bug', 'alertToast', 'alertUrgent', 'toasts', 'ticker']
    def inter(a, b): return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]
    over = []
    for i, a in enumerate(blocks):
        for b in blocks[i + 1:]:
            if {a, b} == {'meter', 'tab'}: continue
            for ra in boxes.get(a, []):
                for rb in boxes.get(b, []):
                    if inter(ra, rb): over.append((a, ra, b, rb))
    print('overlaps:', len(over))
    for o in over: print('  OVERLAP', o)
    d = sess.diagnostics()
    print('diag:', json.dumps({k: (len(v) if isinstance(v, list) else v) for k, v in d.items()}) if isinstance(d, dict) else d)
    if isinstance(d, dict):
        for k, v in d.items():
            if isinstance(v, list) and v and k != 'failed': print('  ', k, v[:5])
finally:
    sess.close()
