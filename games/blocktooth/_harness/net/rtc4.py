# BLOCKTOOTH - _harness/net/rtc4.py (lane B-NET). Opens _harness/net/rtc4.html in ONE headless Chromium (Playwright)
# against a Vite dev server the caller started on --port (BT_FROZEN=1 ... --strictPort), waits for window.__RTC4__.done
# and prints the verdict. Background throttling is off (the page is the only tab; the Worker clock is under test).
#   python _harness/net/rtc4.py --port 5291 [--seconds 45] [--kill 25]
import argparse, json, sys, time
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--port', type=int, required=True)
ap.add_argument('--seconds', type=int, default=45)
ap.add_argument('--kill', type=int, default=25)
ap.add_argument('--join', action='store_true')
ap.add_argument('--nolink', action='store_true')
a = ap.parse_args()
url = f'http://localhost:{a.port}/_harness/net/rtc4.html?s={a.seconds}&kill={a.kill}' + ('&join=1' if a.join else '') + ('&nolink=1' if a.nolink else '')
with sync_playwright() as p:
    b = p.chromium.launch(args=['--disable-renderer-backgrounding', '--disable-background-timer-throttling'])
    pg = b.new_page()
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(url)
    t0 = time.time()
    res = None
    while time.time() - t0 < a.seconds + 90:
        res = pg.evaluate('() => window.__RTC4__ && window.__RTC4__.done ? window.__RTC4__ : null')
        if res: break
        time.sleep(1)
    ver = b.version
    b.close()
if not res:
    print('rtc4: FAIL - no result (timeout)', errs[:3]); sys.exit(1)
if res.get('error'):
    print('rtc4: FAIL - page error:', res['error'][:800]); sys.exit(1)
ps = res['pass']
print('chromium', ver)
print('log:', *res['log'], sep='\n  ')
for pr in res['peers']: print('peer', json.dumps(pr))
print('cand stats (s1):', json.dumps(res.get('candStats')))
print(f"hashes: {res['compared']} checkpoints compared, {res['bad']} mismatched; host killed at tick {res['killedAtTick']}")
print('results:', json.dumps(res['results']))
print(f"fake Supabase billed {res['hubBilled']} events, worst 60-s avg {res['hubPeak60']:.1f}/s")
for k, v in res['events'].items(): print(k, '|', ' ; '.join(v)[:900])
checks = {k: v for k, v in ps.items() if k != 'speeds'}
ok = all(checks.values())   # speeds include the deliberate host-kill pause: information here (gated in probe_net4 (b))
print('checks:', json.dumps(ps))
print(f"rtc4: {'PASS' if ok else 'FAIL'}")
sys.exit(0 if ok else 1)
