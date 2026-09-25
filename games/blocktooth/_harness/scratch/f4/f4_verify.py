#!/usr/bin/env python
"""F4 UI polish — real-Chrome verification of the 8 critic findings (screenshots READ by the agent).

    python _harness/scratch/f4/f4_verify.py --base http://localhost:5294 [--parts hp,hint,tokens,markers,bar,modal,goals]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..')))
from common import Session, add_common_args, build_url  # noqa: E402

OUT = os.path.join(HERE, 'shots')
os.makedirs(OUT, exist_ok=True)

PANELS_JS = """() => {
  const sel = ['.bt-bug', '.bt-counters', '.bt-status', '.bt-abar', '.bt-uproar', '.bt-active', '.bt-zoomhint', '.bt-ticker', '[data-v2="tracker-row"]', '.bt-bossbar', '.bt-boss'];
  const vis = (e) => { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false; let p = e; while (p) { if (p.classList && p.classList.contains('bt-hidden')) return false; p = p.parentElement; } const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
  const panels = [];
  for (const s of sel) for (const e of document.querySelectorAll(s)) if (vis(e)) { const r = e.getBoundingClientRect(); panels.push({ s, x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }); }
  const marks = [];
  for (const e of document.querySelectorAll('[data-v2="marker"]')) {
    const cs0 = getComputedStyle(e); if (cs0.display === 'none' || e.closest('.bt-hidden')) continue;
    // union of the visible children (disc, pointer, chip, distance)
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const c of [e, ...e.querySelectorAll('*')]) { if (!vis(c)) continue; const r = c.getBoundingClientRect(); x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); }
    marks.push({ cls: e.className, txt: e.textContent.trim().slice(0, 30), x0, y0, x1, y1 });
  }
  const hits = [];
  for (const m of marks) for (const p of panels) {
    const ox = Math.min(m.x1, p.x1) - Math.max(m.x0, p.x0), oy = Math.min(m.y1, p.y1) - Math.max(m.y0, p.y0);
    if (ox > 1 && oy > 1) hits.push({ marker: m.txt || m.cls, panel: p.s, ox: Math.round(ox), oy: Math.round(oy) });
  }
  return { panels: panels.length, markers: marks.length, hits, marks: marks.map((m) => [m.txt, Math.round(m.x0), Math.round(m.y0), Math.round(m.x1), Math.round(m.y1)]) };
}"""

TOASTS_JS = """() => [...document.querySelectorAll('.bt-toast')].map((e) => ({ cls: e.className, v2: e.dataset.v2 || '', txt: e.textContent.trim().replace(/\\s+/g, ' ').slice(0, 80), layerHidden: !!e.closest('.bt-hidden'), op: getComputedStyle(e).opacity }))"""


def main():
    ap = add_common_args(argparse.ArgumentParser())
    ap.add_argument('--parts', default='hp,hint,tokens,markers,bar,modal,goals')
    ap.add_argument('--titan', default='molo')
    args = ap.parse_args()
    parts = set(args.parts.split(','))
    res = {}
    s = Session(args, 'f4_verify')
    s.start()
    pg = s.page

    def shot(name, clip=None):
        p = os.path.join(OUT, name + '.png')
        if clip:
            pg.screenshot(path=p, clip=clip)
        else:
            pg.screenshot(path=p)
        print('  shot', p, flush=True)
        return p

    def st():
        return s.state() or {}

    def new_run(titan='molo', biome='grideast', seed=1337):
        pg.evaluate("async ([t, b, sd]) => { await window.__BT__.newRun({ titan: t, biome: b, seed: sd, skipSlate: true }); }", [titan, biome, seed])
        t0 = time.time()
        while time.time() - t0 < 30 and s.screen() != 'play':
            if s.screen() in ('slate', 'cine'):
                s.press('Enter')
            time.sleep(0.5)
        print('  screen', s.screen(), flush=True)

    try:
        url = build_url(args.base, dev=1, seed=1337)
        s.goto(url)
        s.wait_bt(60)
        # fresh profile (first run of a profile → the UPROAR hint is armed)
        pg.evaluate("() => { try { localStorage.clear(); } catch (e) {} }")
        s.goto(url)
        s.wait_bt(60)
        time.sleep(1.0)
        new_run(args.titan)
        time.sleep(1.5)
        s.cheat('god', True)
        s.cheat('noSpawns', True)
        s.cheat('killAll')
        time.sleep(0.5)

        if 'hp' in parts:
            info = pg.evaluate("() => { const w = window.__BT__.world; const v = [...document.querySelectorAll('.bt-bar-val')].map((e) => e.textContent); return { hp: w.titan.hp, maxHp: w.titan.maxHp, vals: v, rank: w.titan.rank }; }")
            print('HP', json.dumps(info), flush=True)
            # force a fractional max with full HP (the old readout's `158 / 157` case)
            info2 = pg.evaluate("async () => { const w = window.__BT__.world; w.titan.maxHp = 157.4; w.titan.hp = 157.4; await new Promise((r) => setTimeout(r, 600)); return { hp: w.titan.hp, maxHp: w.titan.maxHp, vals: [...document.querySelectorAll('.bt-bar-val')].map((e) => e.textContent) }; }")
            print('HP frac', json.dumps(info2), flush=True)
            res['hp'] = [info, info2]
            shot('hp_status', {'x': 0, 'y': 720 - 170, 'width': 360, 'height': 170})
            s.cheat('heal')

        if 'hint' in parts:
            s.cheat('ult', 100)
            seen = None
            t0 = time.time()
            while time.time() - t0 < 2.0:
                ts = pg.evaluate(TOASTS_JS)
                vis = [t for t in ts if t['v2'] == 'toast']
                if vis:
                    seen = (round(time.time() - t0, 2), vis)
                    break
                time.sleep(0.05)
            print('HINT shown after', seen, flush=True)
            time.sleep(0.5)
            u = (st().get('v2') or {}).get('ult')
            print('  ult state', json.dumps(u), flush=True)
            shot('hint_ready')
            s.press('KeyE', 90)
            time.sleep(0.15)
            u1 = (st().get('v2') or {}).get('ult')
            ts1 = pg.evaluate(TOASTS_JS)
            print('  after E: ult', json.dumps(u1), 'toasts', json.dumps(ts1), flush=True)
            time.sleep(0.5)
            ts2 = pg.evaluate(TOASTS_JS)
            print('  +0.65 s: toasts', json.dumps([t for t in ts2 if t['v2']]), flush=True)
            shot('hint_onair')
            res['hint'] = {'seen': seen, 'afterE': ts1, 'later': ts2}
            time.sleep(2.0)

        if 'tokens' in parts:
            # the sim keeps ≤ 3 tokens alive: two sets
            for tag, kinds in (('a', ['cleanup', 'demolition', 'redLight']), ('b', ['rushHour', 'backPay', 'cleanup'])):
                ids = []
                for i, k in enumerate(kinds):
                    pg.evaluate("(a) => { const w = window.__BT__.world; w.titan.heading = a; }", 2.2 + i * 0.9)
                    ids.append(s.cheat('powerup', k))
                time.sleep(0.9)
                print('TOKENS', tag, ids, json.dumps(pg.evaluate("() => { const w = window.__BT__.world; return w.map.powerups.filter((p) => p.alive).map((p) => [p.kind, +p.x.toFixed(1), +p.z.toFixed(1)]); }")), flush=True)
                pg.evaluate("() => window.__BT__.freeze(true)")
                time.sleep(0.4)
                shot('tokens_%s_full' % tag)
                shot('tokens_%s_zoom' % tag, {'x': 440, 'y': 200, 'width': 400, 'height': 280})
                time.sleep(0.6)
                shot('tokens_%s_zoom2' % tag, {'x': 440, 'y': 200, 'width': 400, 'height': 280})
                pg.evaluate("() => window.__BT__.freeze(false)")
                pg.evaluate("() => { const w = window.__BT__.world; for (const p of w.map.powerups) p.alive = false; }")
                time.sleep(0.3)
            res['tokens'] = True

        if 'markers' in parts:
            # objectives far off-screen in many directions → edge arrows all round the frame
            placed = []
            for i in range(12):
                a = i * (6.2832 / 12)
                pg.evaluate("(a) => { const w = window.__BT__.world; w.titan.heading = a; }", a)
                kind = ['reliefDepot', 'overloadSite', 'recordsAnnex'][i % 3]
                placed.append(s.cheat('objective', kind, 24 + (i % 4) * 7))
            print('MARKERS placed', placed, flush=True)
            time.sleep(1.2)
            r1 = pg.evaluate(PANELS_JS)
            print('  v2dom', json.dumps((st().get('v2dom') or {})), flush=True)
            print('MARKERS', json.dumps(r1), flush=True)
            shot('markers_edge')
            res['markers'] = r1

        if 'bar' in parts:
            ids = pg.evaluate("""() => {
              const w = window.__BT__.world;
              const want = ['restraining_order', 'sinkhole_stride', 'pothole_report', 'wide_load', 'eminent_domain', 'hairline_crack',
                'jackhammer_hours', 'molo_heavy_tread_ordinance', 'green_wave', 'long_crosswalk'];
              for (const id of want) { if (!w.upgrades.order.includes(id)) w.upgrades.order.push(id); w.upgrades.owned[id] = (w.upgrades.owned[id] || 0) + 1; }
              return w.upgrades.order.slice();
            }""")
            print('BAR order', ids, flush=True)
            time.sleep(1.0)
            g = pg.evaluate("() => [...document.querySelectorAll('.bt-slot[data-v2=\"bar-slot\"]')].map((e) => ({ t: e.title, fill: (e.querySelector('.bt-slot-g path') || {}).getAttribute ? e.querySelector('.bt-slot-g path').getAttribute('fill') : '', d: (e.querySelector('.bt-slot-g path') || {}).getAttribute ? e.querySelector('.bt-slot-g path').getAttribute('d').slice(0, 24) : '' }))")
            print('BAR slots', json.dumps(g), flush=True)
            ds = [x['d'] for x in g]
            print('  distinct glyph paths %d of %d' % (len(set(ds)), len(ds)), flush=True)
            r = pg.evaluate("() => { const r = document.querySelector('.bt-abar').getBoundingClientRect(); const u = document.querySelector('.bt-uproar').getBoundingClientRect(); return [Math.min(r.left, u.left), Math.min(r.top, u.top), Math.max(r.right, u.right), r.bottom]; }")
            shot('bar_after', {'x': r[0] - 10, 'y': r[1] - 10, 'width': r[2] - r[0] + 20, 'height': r[3] - r[1] + 20})
            shot('bar_full')
            res['bar'] = g

        if 'modal' in parts:
            # a GOAL MET toast arrives, then a modal (pause) opens: the toast layer must hide and resume after
            pg.evaluate("() => { const w = window.__BT__.world; w.tally.kills = 5000; }")
            t0 = time.time()
            seen = None
            while time.time() - t0 < 4:
                vis = [t for t in pg.evaluate(TOASTS_JS) if t['v2'] == 'toast']
                if vis:
                    seen = vis
                    break
                time.sleep(0.1)
            print('MODAL goal toast', json.dumps(seen), flush=True)
            s.press('Escape')
            time.sleep(0.8)
            print('  screen', s.screen(), 'toasts in pause', json.dumps(pg.evaluate(TOASTS_JS)), flush=True)
            shot('modal_pause')
            s.press('Escape')
            time.sleep(1.2)
            print('  screen', s.screen(), 'toasts after resume', json.dumps(pg.evaluate(TOASTS_JS)), flush=True)
            shot('modal_resumed')
            # a draft opens (level-up) right as a goal is met: nothing over the draft
            pg.evaluate("() => { const w = window.__BT__.world; w.tally.ults = 99; w.tally.blocks = 999; }")
            print('  xp cheat', s.cheat('xp', 5000), flush=True)
            t0 = time.time()
            while time.time() - t0 < 6 and s.screen() != 'draft':
                time.sleep(0.2)
            time.sleep(1.5)
            print('  screen', s.screen(), 'toasts during draft', json.dumps(pg.evaluate(TOASTS_JS)), flush=True)
            shot('modal_draft')
            res['modal'] = seen

        if 'goals' in parts:
            # SIZE goal progress on the goals screen: best peakRank 1 (SIZE II) → "II / III" and "II / V"
            pg.evaluate("""() => { const k = 'blocktooth.profile.v1'; let p = {}; try { p = JSON.parse(localStorage.getItem(k) || '{}'); } catch (e) {}
              p.best = p.best || {}; p.best.g_zoning_change = 1; p.best.g_skyline_adjusted = 1; if (p.done) { delete p.done.g_zoning_change; delete p.done.g_skyline_adjusted; }
              localStorage.setItem(k, JSON.stringify(p)); }""")
            s.goto(url)
            s.wait_bt(60)
            ok, scr = s.wait_screen(('title',), 30)
            time.sleep(1.0)
            s.press('KeyG')
            time.sleep(1.5)
            print('GOALS screen', s.screen(), flush=True)
            txt = pg.evaluate("() => [...document.querySelectorAll('*')].filter((e) => e.children.length === 0 && /ZONING|SKYLINE/.test(e.textContent)).map((e) => { let r = e; for (let i = 0; i < 3 && r.parentElement; i++) r = r.parentElement; return r.textContent.replace(/\\s+/g, ' ').trim().slice(0, 140); })")
            print('  rows', json.dumps(txt), flush=True)
            shot('goals_screen')
            res['goals'] = txt
    finally:
        print('page errors', s.page_errors[:5], flush=True)
        with open(os.path.join(OUT, 'f4_verify.json'), 'w', encoding='utf-8') as f:
            json.dump(res, f, indent=1, default=str)
        s.close()


if __name__ == '__main__':
    main()
