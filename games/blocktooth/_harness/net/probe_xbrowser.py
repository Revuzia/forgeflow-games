"""BLOCKTOOTH -- cross-browser determinism probe (ONLINE_PLAN gate H1, lane B-DET; port of
_spec/online/netcode_lab/xrun_det.py + xnode_det.mjs).

    python _harness/net/probe_xbrowser.py               # 4 configs x 18,000 ticks in Node + Chromium + Firefox + WebKit
    python _harness/net/probe_xbrowser.py --quick       # 2 configs x 3,000 ticks (dev loop)
    python _harness/net/probe_xbrowser.py --ticks 9000 --engines node,chromium
    python _harness/net/probe_xbrowser.py --vsnet-only             # only the 4-seat VS LOCKSTEP matches (full 10:45 each)
    python _harness/net/probe_xbrowser.py --json _harness/_reports/xbrowser.json

1. Bundles _harness/net/xbrowser_entry.ts (the real sim + the GATE 2 bot + the draft path) with the project's
   rolldown into one iife (no npm install: rolldown ships with vite).
2. Runs the SAME bot-driven runs in Node and in every Playwright browser engine installed on this machine, each
   hashing the whole world every 300 ticks (titan, enemies, pickups, projectiles, every prop, every building's floors
   and HP, the boss, upgrades).
3. Gate: every engine's checkpoint hashes, final hash and tick count equal Node's, and every engine's detmath bit
   hashes equal Node's. Native Math hashes are printed for information only (they differ by engine: that is why the
   sim uses detmath).

Exit: 0 = identical everywhere (at least Node + 1 browser ran) | 1 = a divergence (first divergent checkpoint listed)
| 2 = could not bundle / no browser engine could run. An engine that is not installed is reported SKIPPED.
"""
import argparse
import json
import pathlib
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).parent.resolve()
ROOT = HERE.parent.parent
OUT = ROOT / '_harness' / 'scratch' / 'xbrowser'

FULL_CFGS = [
    ('molo', 'grideast', 1337, 'fresh'),
    ('voltkite', 'whitestacks', 1337, 'fresh'),
    ('hearthback', 'lockwater', 99, 'fresh'),
    ('briarwick', 'grideast', 7, 'full'),
    # VS (GATE 2026-10-05): a 4-bot VS match, the whole 4-seat world hashed (src/net/vshash.ts); titan field = the lineup
    ('molo+voltkite+hearthback+briarwick', 'grideast', 1337, 'vs'),
    ('briarwick+hearthback+voltkite+molo', 'lockwater', 7, 'vs'),
    # VS LOCKSTEP (O-PORT, gate H1 / H6 sim part): canonical frames (late repeats, AFK -> bot -> back, a bot-seat takeover, CARD RAIL
    # bytes) through src/net/simport.ts vsWorldPort, the port's all-player hash + standings hash; runs to the match's own end
    ('molo+voltkite+hearthback+briarwick', 'grideast', 1337, 'vsnet'),
    ('hearthback+briarwick+molo+voltkite', 'whitestacks', 7, 'vsnet'),
    ('voltkite+molo+briarwick+hearthback', 'lockwater', 99, 'vsnet'),
]
QUICK_CFGS = [('molo', 'grideast', 1337, 'fresh'), ('briarwick', 'lockwater', 7, 'full'),
              ('molo+voltkite+hearthback+briarwick', 'whitestacks', 99, 'vs'),
              ('molo+voltkite+hearthback+briarwick', 'grideast', 1337, 'vsnet')]

NODE_RUNNER = r"""
import fs from 'node:fs';
globalThis.window = globalThis;
(0, eval)(fs.readFileSync(process.argv[2], 'utf8'));
const cfgs = JSON.parse(process.argv[3]);
const ticks = Number(process.argv[4]);
const vsn = Number(process.argv[5]);
const runs = cfgs.map(([t, b, s, m]) => m === 'vsnet' ? globalThis.btProbe.runProbeVsNet(t, b, s, vsn) : m === 'vs' ? globalThis.btProbe.runProbeVs(t, b, s, ticks) : globalThis.btProbe.runProbe(t, b, s, ticks, m));
process.stdout.write(JSON.stringify({ version: 'node ' + process.version, math: globalThis.btProbe.mathHashes(), runs }));
"""


def log(msg):
    print(msg, flush=True)


def bundle():
    OUT.mkdir(parents=True, exist_ok=True)
    js = OUT / 'xbrowser.js'
    exe = ROOT / 'node_modules' / '.bin' / ('rolldown.cmd' if sys.platform == 'win32' else 'rolldown')
    if not exe.exists():
        log(f'cannot bundle: {exe} not found (rolldown ships with vite; run inside the blocktooth folder)')
        return None
    cmd = [str(exe), str(HERE / 'xbrowser_entry.ts'), '--format', 'iife', '--platform', 'browser', '-o', str(js)]
    p = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace',
                       shell=False)
    if p.returncode != 0 or not js.exists():
        log('bundle FAILED:\n' + (p.stdout + p.stderr)[-3000:])
        return None
    (OUT / 'xbrowser.html').write_text(
        '<!doctype html><meta charset="utf-8"><title>bt xbrowser</title><script src="xbrowser.js"></script>\n',
        encoding='utf-8')
    log(f'bundled {js.relative_to(ROOT)} ({js.stat().st_size // 1024} KB)')
    return js


def run_node(js, cfgs, ticks, vsn):
    runner = OUT / 'xnode_runner.mjs'
    runner.write_text(NODE_RUNNER, encoding='utf-8')
    t0 = time.time()
    p = subprocess.run(['node', str(runner), str(js), json.dumps(cfgs), str(ticks), str(vsn)], cwd=ROOT,
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    if p.returncode != 0:
        return {'error': (p.stderr or p.stdout)[-1500:]}
    res = json.loads(p.stdout)
    res['wall_s'] = round(time.time() - t0, 1)
    return res


def run_browser(name, launcher, cfgs, ticks, vsn):
    url = (OUT / 'xbrowser.html').as_uri()
    t0 = time.time()
    b = launcher.launch()
    try:
        pg = b.new_page()
        pg.set_default_timeout(900000)
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(url)
        pg.wait_for_function('() => !!window.btProbe', timeout=60000)
        runs = []
        for t, bi, s, m in cfgs:
            runs.append(pg.evaluate('([t, b, s, n, m, v]) => m === "vsnet" ? window.btProbe.runProbeVsNet(t, b, s, v) : m === "vs" ? window.btProbe.runProbeVs(t, b, s, n) : window.btProbe.runProbe(t, b, s, n, m)', [t, bi, s, ticks, m, vsn]))
            log(f'  {name}: {t}/{bi}/{s}/{m} done ({runs[-1]["ticks"]} ticks, {runs[-1]["ms"] / 1000:.0f} s)')
        math = pg.evaluate('() => window.btProbe.mathHashes()')
        return {'version': f'{name} {b.version}', 'math': math, 'runs': runs, 'pageerrors': errors,
                'wall_s': round(time.time() - t0, 1)}
    finally:
        b.close()


def compare(ref, other):
    """-> list of problems (empty = identical)"""
    probs = []
    for k, v in ref['math']['det'].items():
        if other['math']['det'].get(k) != v:
            probs.append(f'detmath {k}: {other["math"]["det"].get(k)} vs node {v}')
    for a, b in zip(ref['runs'], other['runs']):
        tag = f'{a["titan"]}/{a["biome"]}/{a["seed"]}/{a["meta"]}'
        first = next((i for i, (x, y) in enumerate(zip(a['checkpoints'], b['checkpoints'])) if x != y), -1)
        if first >= 0:
            probs.append(f'{tag}: first divergent checkpoint at tick {(first + 1) * a["checkpointEvery"]} '
                         f'({b["checkpoints"][first]} vs node {a["checkpoints"][first]})')
        elif a['final'] != b['final'] or a['ticks'] != b['ticks'] or len(a['checkpoints']) != len(b['checkpoints']):
            probs.append(f'{tag}: final {b["final"]} @ {b["ticks"]} ticks vs node {a["final"]} @ {a["ticks"]}')
    if len(ref['runs']) != len(other['runs']):
        probs.append(f'run count {len(other["runs"])} vs node {len(ref["runs"])}')
    return probs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--quick', action='store_true')
    ap.add_argument('--ticks', type=int, default=None)
    ap.add_argument('--engines', default='node,chromium,firefox,webkit')
    ap.add_argument('--json', default=None)
    ap.add_argument('--vsnet-only', action='store_true', help='only the VS lockstep configs (the whole match each)')
    ap.add_argument('--vsnet-ticks', type=int, default=None, help='tick cap for the VS lockstep configs (default: the whole match, 19,500)')
    a = ap.parse_args()
    cfgs = [list(c) for c in (QUICK_CFGS if a.quick else FULL_CFGS)]
    if a.vsnet_only:
        cfgs = [c for c in cfgs if c[3] == 'vsnet']
    ticks = a.ticks or (3000 if a.quick else 18000)
    vsn = a.vsnet_ticks or (3600 if a.quick else 19500)
    engines = [e.strip() for e in a.engines.split(',') if e.strip()]

    js = bundle()
    if not js:
        return 2
    results = {}
    log(f'configs: {", ".join("/".join(map(str, c)) for c in cfgs)} x {ticks} ticks (vsnet: up to {vsn}), checkpoint every 300')
    log('node: running ...')
    results['node'] = run_node(js, cfgs, ticks, vsn)
    if 'error' in results['node']:
        log('node FAILED: ' + results['node']['error'])
        return 2
    log(f'node: {results["node"]["version"]} {results["node"]["wall_s"]} s')

    browsers = [e for e in engines if e != 'node']
    if browsers:
        try:
            from playwright.sync_api import sync_playwright
        except Exception as e:  # noqa: BLE001
            log(f'playwright not importable ({e}); browsers SKIPPED')
            browsers = []
    if browsers:
        with sync_playwright() as p:
            for name in browsers:
                launcher = getattr(p, name, None)
                if launcher is None:
                    results[name] = {'skipped': 'unknown engine'}
                    continue
                log(f'{name}: running ...')
                try:
                    results[name] = run_browser(name, launcher, cfgs, ticks, vsn)
                    log(f'{name}: {results[name]["version"]} {results[name]["wall_s"]} s')
                except Exception as e:  # noqa: BLE001
                    msg = str(e).splitlines()[0][:300]
                    if 'Executable doesn' in str(e) or 'executable' in msg.lower():
                        results[name] = {'skipped': 'not installed: ' + msg}
                    else:
                        results[name] = {'error': msg}
                    log(f'{name}: {"SKIPPED" if "skipped" in results[name] else "ERROR"} {msg}')

    ref = results['node']
    fails, ran = [], 0
    log('')
    log('per-run checkpoints (node): ' + '; '.join(
        f'{r["titan"]}/{r["biome"]}/{r["seed"]}/{r["meta"]}: {len(r["checkpoints"])} cps, {r["ticks"]} ticks, '
        f'{r["result"] or "running"} LV {r["level"]}, final {r["final"]}' for r in ref['runs']))
    for name, res in results.items():
        if name == 'node':
            continue
        if 'skipped' in res:
            log(f'  {name:9s} SKIPPED ({res["skipped"]})')
            continue
        if 'error' in res:
            log(f'  {name:9s} ERROR {res["error"]}')
            fails.append(f'{name}: error {res["error"]}')
            continue
        ran += 1
        probs = compare(ref, res)
        if res.get('pageerrors'):
            probs.append('page errors: ' + '; '.join(res['pageerrors'][:3]))
        ncp = sum(len(r['checkpoints']) for r in res['runs'])
        nat = [k for k, v in res['math']['native'].items() if ref['math']['native'].get(k) != v]
        natline = f'native Math bits differ from node in: {", ".join(nat) or "none"} (information)'
        if probs:
            log(f'  {name:9s} FAIL ({res["version"]}) -- ' + ' | '.join(probs))
            fails.extend(f'{name}: {x}' for x in probs)
        else:
            log(f'  {name:9s} IDENTICAL ({res["version"]}): all {ncp} checkpoints + finals + detmath bits match node; {natline}')

    if a.json:
        jp = pathlib.Path(a.json)
        jp.parent.mkdir(parents=True, exist_ok=True)
        jp.write_text(json.dumps({'ticks': ticks, 'vsnet_ticks': vsn, 'configs': cfgs, 'results': results}, indent=1), encoding='utf-8')
    log('')
    if fails:
        log(f'H1 cross-browser determinism: FAIL ({len(fails)} problem(s))')
        return 1
    if ran == 0:
        log('H1 cross-browser determinism: NOT RUN (no browser engine could run)')
        return 2
    log(f'H1 cross-browser determinism: PASS (node + {ran} browser engine(s) identical)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
