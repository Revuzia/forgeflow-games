#!/usr/bin/env python3
"""Merge the per-phase data/*.json of the UX evidence run into index.json, notes.md and contact sheets.
Facts only: no scoring, no opinions. Shrinks any PNG over 1.5 MB (palette, then downscale) and records it."""
import json, os, subprocess, sys, glob, collections, datetime
from PIL import Image

OUT = os.environ.get('UX_OUT', '/Users/sitskovich/Developer/forgeflow-games/games/vale/_design/reviews/orch1/evidence/ux')
LIMIT = 1_500_000
data = {}
for f in sorted(glob.glob(f'{OUT}/data/*.json')):
    if os.path.basename(f) in ('index_src.json',):
        continue
    d = json.load(open(f)); data[d['phase']] = d

def head():
    try:
        return subprocess.check_output(['git', '-C', OUT, 'rev-parse', '--short', 'HEAD'], text=True).strip()
    except Exception:
        return '?'

# ── shrink oversize PNGs ───────────────────────────────────────────────────────────────────────────
shrunk = {}
for vp in ('1920x1080', '1366x768'):
    for p in glob.glob(f'{OUT}/{vp}/*.png'):
        sz = os.path.getsize(p)
        if sz <= LIMIT:
            continue
        im = Image.open(p).convert('RGB')
        q = im.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG)
        q.save(p, optimize=True)
        how = 'palette-256'
        if os.path.getsize(p) > LIMIT:
            w, h = im.size; s = 0.85
            while True:
                r = im.resize((int(w * s), int(h * s)), Image.LANCZOS).quantize(colors=256, dither=Image.Dither.FLOYDSTEINBERG)
                r.save(p, optimize=True)
                if os.path.getsize(p) <= LIMIT or s < 0.4:
                    break
                s -= 0.1
            how = f'palette-256+downscale-{s:.2f}'
        shrunk[os.path.relpath(p, OUT)] = {'bytes_before': sz, 'bytes_after': os.path.getsize(p), 'method': how}

# ── contact sheets ─────────────────────────────────────────────────────────────────────────────────
def sheet(files, dest, cols=4, tw=480):
    ims = []
    for f in files:
        try:
            im = Image.open(f'{OUT}/{f}').convert('RGB'); r = tw / im.width
            ims.append(im.resize((tw, max(1, int(im.height * r))), Image.LANCZOS))
        except Exception:
            pass
    if not ims:
        return False
    th = max(i.height for i in ims); rows = (len(ims) + cols - 1) // cols
    S = Image.new('RGB', (cols * tw + (cols + 1) * 6, rows * th + (rows + 1) * 6), (24, 24, 28))
    for i, im in enumerate(ims):
        S.paste(im, (6 + (i % cols) * (tw + 6), 6 + (i // cols) * (th + 6)))
    os.makedirs(os.path.dirname(f'{OUT}/{dest}'), exist_ok=True)
    S.save(f'{OUT}/{dest}', optimize=True)
    if os.path.getsize(f'{OUT}/{dest}') > LIMIT:
        S = S.convert('RGB').quantize(colors=128); S.save(f'{OUT}/{dest}', optimize=True)
    return True

sheets = []
for phase, d in data.items():
    for vp in ('1920x1080', '1366x768'):
        fs = [s['file'] for s in d['steps'] if s['viewport'] == vp and not s.get('crop')]
        for k in range(0, len(fs), 16):
            dest = f'contact_sheets/{phase}_{vp}_{k // 16 + 1}.png'
            if sheet(fs[k:k + 16], dest):
                sheets.append({'file': dest, 'kind': 'contact_sheet', 'phase': phase, 'viewport': vp, 'contains': fs[k:k + 16]})

# ── index.json ─────────────────────────────────────────────────────────────────────────────────────
files = []
for phase, d in data.items():
    for s in d['steps']:
        e = {k: s[k] for k in ('file', 'viewport', 'phase', 'step', 'name', 'desc', 'route', 'hud', 'crop', 'load1', 'tMs') if k in s}
        e['kind'] = 'screenshot'
        e['bytes'] = os.path.getsize(f'{OUT}/{s["file"]}') if os.path.exists(f'{OUT}/{s["file"]}') else None
        e['layout_counts'] = s['layout']['counts']
        e['min_font_px'] = (s['layout'].get('minFont') or {}).get('px')
        e['doc_scroll'] = s['layout'].get('docScroll')
        if s['file'] in shrunk:
            e['shrunk'] = shrunk[s['file']]
        files.append(e)
files += sheets
for f in sorted(glob.glob(f'{OUT}/data/*.json')):
    files.append({'file': os.path.relpath(f, OUT), 'kind': 'raw_data', 'desc': 'per-phase raw record: every step, console/network line, layout finding, observation and timing'})
meta = {
    'lane': 'orch1 EVIDENCE COLLECTOR (ux)', 'collected_at': datetime.datetime.now().astimezone().isoformat(timespec='seconds'),
    'game_head': head(), 'viewports': ['1920x1080', '1366x768'],
    'builds': {'prod': 'vite build of HEAD into _harness/_prod/ux_dist, served by vite preview (cold-load phase; no ?dev handle, real clicks only)',
               'dev': 'vite dev server (VALE_FROZEN=1) on HEAD with ?dev=1 (handle + autopilot) for every other phase'},
    'method': ['Real Chrome (channel chrome, ANGLE Metal), fresh temporary profile, deviceScaleFactor 1, headless, one heavy slot.',
               'Paired shots: the same state is captured at 1920x1080, the browser viewport is then resized live to 1366x768 and captured again. Cold-load phases use a separate fresh load per viewport.',
               'Match phases pause the sim (setTimeScale 0) around some shots to catch a moment; each such step says so in desc.',
               'Layout facts come from a DOM scan per shot (overflow clipping, ellipsis, text outside the viewport, smallest font); raw numbers only.'],
    'shrunk_pngs': len(shrunk), 'screenshots': sum(1 for f in files if f['kind'] == 'screenshot'), 'contact_sheets': len(sheets),
}
json.dump({'meta': meta, 'files': files}, open(f'{OUT}/index.json', 'w'), indent=1)

# ── notes.md ───────────────────────────────────────────────────────────────────────────────────────
L = []
A = L.append
A('# UX evidence notes (raw observations, no opinions)\n')
A(f"Collected {meta['collected_at']} on game HEAD `{meta['game_head']}`. Viewports 1920x1080 and 1366x768. See index.json for every file.\n")
A('## Method and limits\n')
for m in meta['method']:
    A(f'- {m}')
A('- Machine load (1-min load average) is stored on every step (`load1` in index.json). Timings taken under load are labelled with it.')
A('- Dev-server phases load unbundled modules; their load times are not a cold-load measure. Only the `cold*` phases use the production build.\n')

for ph in [p for p in data if p.startswith('cold')]:
    d = data[ph]; T = d['timings']
    A(f'## Timings, cold first run, {ph}\n')
    c = T.get('cold', {}); m = c.get('marks', {}); w = T.get('warm', {})
    A(f'- Machine load average at start {T.get("load1_start")}, at end {T.get("loadAvgEnd")}.')
    A(f'- Navigation commit: {T.get("t_commit_ms")} ms (Node side).')
    A(f'- First contentful paint: {m.get("fcp")} ms. Largest contentful paint: {m.get("lcp")} ms ({m.get("lcp_el")}).')
    A(f'- First canvas in DOM: {m.get("canvas")} ms. Nav bar in DOM: {m.get("nav")} ms. Home screen in DOM: {m.get("home_screen")} ms (page clock; Node-side {c.get("nodeSideToHomeMs")} ms).')
    r = c.get('resourcesAtHome', {})
    A(f'- Resources by Home: {r.get("count")} requests, {r.get("encodedBytes")} encoded bytes, {r.get("decodedBytes")} decoded; by extension {r.get("byExt")}.')
    A(f'- Long tasks (start ms, duration ms) before Home: {[t for t in m.get("longtasks", [])][:12]}.')
    A(f'- Frame pacing from navigation to Home: {c.get("frameStatsToHome")}. Home idle 5 s: {c.get("frameStatsHomeIdle5s")}.')
    A(f'- Warm reload (same context, HTTP cache): Home at {w.get("marks", {}).get("home_screen")} ms (page clock), Node-side {w.get("nodeSideToHomeMs")} ms; resources {w.get("resources", {}).get("count")}.')
    mm = T.get('match', {})
    A(f'- Play click to Play screen shown: {T.get("t_play_click_to_screen_ms")} ms (Node side).')
    A(f'- Find match click to HUD in DOM: {mm.get("hudMinusFindClickMs")} ms (page clock); to first two animation frames after the HUD: {mm.get("hud2rafMinusFindClickMs")} ms; Node-side flow {mm.get("findClickToHudNodeMs")} ms (includes the driver\'s own click waits).')
    A(f'- Stages from the Find match click (page clock ms): {mm.get("stageMsFromFind")}.')
    A(f'- First 32+ s of match frame pacing: {mm.get("frameStatsMatch")}.')
    A(f'- Resources by the first match frame: {mm.get("resources", {}).get("count")} requests, {mm.get("resources", {}).get("encodedBytes")} encoded bytes; largest {mm.get("resources", {}).get("largest")}.\n')

if any(p in data for p in data):
    A('## Console, network and page errors (every warning and error, grouped)\n')
    tot = 0
    for ph, d in data.items():
        g = collections.OrderedDict()
        for c in d['console']:
            k = (c['type'], c['text'][:220])
            e = g.setdefault(k, {'n': 0, 'first': c['step'], 'at': c['at']}); e['n'] += 1
        tot += len(d['console'])
        A(f'### {ph}: {len(d["console"])} lines, {len(g)} distinct; info/log/debug counts {d["consoleCounts"]}')
        for (t, tx), e in g.items():
            A(f'- `{t}` x{e["n"]} first at step `{e["first"]}`{(" (" + e["at"] + ")") if e["at"] else ""}: {tx}')
        if not g:
            A('- none')
        A('')
    A(f'Total lines across phases: {tot}.\n')

A('## Layout facts (DOM scan per shot)\n')
A('Kinds: clipped-x / clipped-y (own text wider/taller than its box with overflow hidden), ellipsis-truncated, line-clamped, outside-viewport (text element whose box leaves the viewport and no scrolling ancestor explains it), outside-scroll-ancestor (box beyond a scrolling ancestor: normally scrolled-away content), scrollable (a scroll area with extra content).\n')
for ph, d in data.items():
    g = collections.OrderedDict()
    for f in d['layout']:
        if f['kind'] in ('scrollable', 'outside-scroll-ancestor'):
            continue
        k = (f['kind'], f['el'], f.get('text', '')[:50])
        e = g.setdefault(k, {'n': 0, 'files': []}); e['n'] += 1
        if len(e['files']) < 3:
            e['files'].append(f['file'])
    A(f'### {ph}: {len(g)} distinct non-scroll findings in {len(d["steps"])} shots')
    for (kind, el, tx), e in list(g.items())[:60]:
        A(f'- {kind} `{el}` "{tx}" x{e["n"]} e.g. {", ".join(e["files"])}')
    if not g:
        A('- none')
    A('')
A('### Smallest text per shot (px), lowest ten across all phases\n')
mf = []
for ph, d in data.items():
    for s in d['steps']:
        m = (s['layout'].get('minFont') or {})
        if m.get('px'):
            mf.append((m['px'], s['file'], m.get('el')))
for px, f, el in sorted(mf)[:10]:
    A(f'- {px} px at {f}: {el}')
A('')
A('### Document scroll (documentElement scroll size larger than the viewport)\n')
n = 0
for ph, d in data.items():
    for s in d['steps']:
        ds = s['layout'].get('docScroll')
        if ds and (ds['w'] > ds['vw'] + 1 or ds['h'] > ds['vh'] + 1):
            A(f'- {s["file"]}: {ds["w"]}x{ds["h"]} in {ds["vw"]}x{ds["vh"]}'); n += 1
if not n:
    A('- none')
A('')

A('## Observations recorded by the driver, in order\n')
for ph, d in data.items():
    A(f'### {ph}')
    for o in d['notes']:
        dt = ''
        if 'data' in o:
            dt = ' ' + json.dumps(o['data'], ensure_ascii=False)[:900]
        A(f'- [{o["tMs"] // 1000}s, load {o["load1"]}, step `{o["step"]}`] {o["text"]}{dt}')
    A('')

A('## Timings of the draft / queue flows (dev server, real time)\n')
if 'draft' in data:
    for k, v in (data['draft']['timings'].get('queues') or {}).items():
        mk = v.get('marks', {})
        A(f'- {k}: flow {v.get("flowMs")} ms, reached HUD: {v.get("reachedHud")}, page-clock marks queue {mk.get("queue")}, draft {mk.get("draft")}, loading {mk.get("loading")}, hud {mk.get("hud")}')
    if data['draft']['timings'].get('custom'):
        A(f'- custom: {data["draft"]["timings"]["custom"]}')
A('')
A('## Files that were shrunk to stay under 1.5 MB\n')
for k, v in shrunk.items():
    A(f'- {k}: {v["bytes_before"]} -> {v["bytes_after"]} bytes ({v["method"]})')
if not shrunk:
    A('- none')
open(f'{OUT}/notes.md', 'w').write('\n'.join(L) + '\n')
print(f'index.json: {meta["screenshots"]} screenshots, {len(sheets)} sheets, {len(shrunk)} shrunk; notes.md {len(L)} lines')
