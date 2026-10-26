"""Solo and co-op keep separate best-run tables (owner 2026-10-26).
Usage: python score_split_test.py <game_dir_or_url> <out_dir>
"""
import functools, http.server, os, sys, threading
from playwright.sync_api import sync_playwright

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
if SRC.startswith('http'):
    URL = SRC
else:
    class Q(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Q, directory=SRC))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    URL = f'http://127.0.0.1:{srv.server_address[1]}/index.html'
results, errors = {}, []
def check(name, cond, detail=''):
    results[name] = bool(cond); print(('PASS ' if cond else 'FAIL ') + name + (f'  [{detail}]' if detail != '' else ''), flush=True)

with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--use-angle=d3d11', '--enable-gpu'])
    p = b.new_page(viewport={'width': 1280, 'height': 720}); p.on('pageerror', lambda e: errors.append(str(e)))
    p.goto(URL); p.wait_for_function('window.__hp && __hp.game', timeout=60000)
    p.evaluate("localStorage.removeItem('harpoonpop.scores'); localStorage.removeItem('harpoonpop.scores.coop'); __hp.game.scoreTables = { solo: [], coop: [] }")
    tbl = lambda: p.evaluate("({ solo: JSON.parse(localStorage.getItem('harpoonpop.scores') || '[]').map(s => s.score), coop: JSON.parse(localStorage.getItem('harpoonpop.scores.coop') || '[]').map(s => s.score) })")
    # a solo run
    p.evaluate("__hp.newGame(false); __hp.game.score = 4200; __hp.gameOver()")
    t = tbl(); check('solo run saves to the solo table only', t == {'solo': [4200], 'coop': []}, t)
    # a co-op run with a bigger score: never in the solo table
    p.evaluate("__hp.newGame(true); __hp.game.score = 9900; __hp.gameOver()")
    t = tbl(); check('co-op run saves to the co-op table only', t == {'solo': [4200], 'coop': [9900]}, t)
    # HI in play shows the run's own table
    p.evaluate("__hp.newGame(false); __hp.game.score = 0")
    check('solo HI reads the solo best', p.evaluate("__hp.game.scores[0].score") == 4200)
    p.evaluate("__hp.newGame(true); __hp.game.score = 0")
    check('co-op HI reads the co-op best', p.evaluate("__hp.game.scores[0].score") == 9900)
    # a partner leaving mid-run keeps the run in the co-op table
    p.evaluate("__hp.newGame(true); __hp.game.coop = false; __hp.game.score = 500; __hp.gameOver()")
    t = tbl(); check('a co-op run whose partner left still counts as co-op', t == {'solo': [4200], 'coop': [9900, 500]}, t)
    # title: the BEST RUNS panel follows the picker
    p.evaluate("(() => { const g = __hp.game; g.state = 'title'; g.modeSel = 1; })()")
    check('title on 1 PLAYER shows the solo table', p.evaluate("__hp.scoreMode()") == 'solo' and p.evaluate("__hp.game.scores.map(s => s.score)") == [4200])
    p.evaluate("__hp.advance ? __hp.advance(0.3) : 0"); p.screenshot(path=os.path.join(OUT, 'title_solo.png'))
    p.evaluate("__hp.game.modeSel = 2")
    check('title on ONLINE CO-OP shows the co-op table', p.evaluate("__hp.scoreMode()") == 'coop' and p.evaluate("__hp.game.scores.map(s => s.score)") == [9900, 500])
    p.evaluate("__hp.advance ? __hp.advance(0.3) : 0"); p.screenshot(path=os.path.join(OUT, 'title_coop.png'))
    # tables survive a reload
    p.reload(); p.wait_for_function('window.__hp && __hp.game', timeout=60000)
    check('both tables survive a reload', p.evaluate("[__hp.game.scoreTables.solo.length, __hp.game.scoreTables.coop.length]") == [1, 2])
    check('no page errors', not errors, errors[:3])
    b.close()
bad = [k for k, v in results.items() if not v]
print(f'{len(results) - len(bad)}/{len(results)} passed' + (f'; FAILED: {bad}' if bad else '')); sys.exit(1 if bad else 0)
