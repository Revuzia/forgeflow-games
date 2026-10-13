"""Quick Match AI partner: search timer counts up, a bot joins at a random 30-60 s mark, plays real co-op.
Usage: python bot_test.py <game_dir_or_url> <out_dir>
"""
import functools, http.server, os, sys, threading, time
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
    results[name] = bool(cond)
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{detail}]' if detail != '' else ''), flush=True)


def wait_until(page, js, timeout=20):
    t = time.time()
    while time.time() - t < timeout:
        try:
            if page.evaluate(js): return True
        except Exception: pass
        time.sleep(0.2)
    return False


with sync_playwright() as pw:
    b = pw.chromium.launch(args=['--use-angle=d3d11', '--enable-gpu', '--autoplay-policy=no-user-gesture-required'])
    page = b.new_page(viewport={'width': 1312, 'height': 760})
    page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    page.goto(URL); page.wait_for_function('window.__hp && __hp.game', timeout=60000)
    page.focus('#hud'); page.keyboard.press('KeyM'); page.keyboard.press('KeyM')
    page.evaluate('__hp.openLobby()'); page.click('#lbQuick')
    time.sleep(2.6)
    st = page.evaluate("document.getElementById('lbStatus').textContent")
    check('quick match: status counts the search time', st.startswith('Looking for a partner') and ('0:02' in st or '0:03' in st), st)
    bot_at = page.evaluate('__hp.qm.botAt')
    check('quick match: bot join time is a random 30-60 s', 30000 <= bot_at <= 60000, round(bot_at))
    page.evaluate('__hp.qm.botAt = 0')  # don't make the test wait 30-60 s
    ok = wait_until(page, "__hp.game.botMatch && __hp.game.coop && __hp.game.players.length === 2 && document.getElementById('lobby').hidden", 6)
    check('quick match: the partner joins and a 2-diver game starts', ok)
    wait_until(page, "__hp.game.state === 'play'", 6)
    page.screenshot(path=f'{OUT}/bot_start.png')
    # P1 keeps A/D in a bot match
    page.evaluate('__hp.game.players.forEach(p => p.invuln = 999)')  # a bubble hit would freeze P1 mid-check
    x0 = page.evaluate('__hp.game.players[0].x'); page.keyboard.down('KeyA'); time.sleep(0.4); page.keyboard.up('KeyA')
    check('bot match: A moves P1 (keys are not split with P2)', x0 - page.evaluate('__hp.game.players[0].x') > 60)
    # the bot plays on its own: give P1 invulnerability and stand still; P2 must pop bubbles
    page.evaluate('__hp.game.players[1].invuln = 0')
    t0 = time.time(); fired = False
    while time.time() - t0 < 25:
        if page.evaluate('__hp.game.players[1].shotId') > 0: fired = True
        if page.evaluate('__hp.game.players[1].points') > 0: break
        page.evaluate('__hp.game.players[0].invuln = 999; if (__hp.game.timeLeft < 20) __hp.game.timeLeft = 60')
        time.sleep(0.5)
    p2 = page.evaluate('__hp.game.players[1].points')
    check('bot: moves, fires and scores points on its own', fired and p2 > 0, f'P2 points {p2}')
    page.screenshot(path=f'{OUT}/bot_play.png')
    # menu behaves like an online game
    page.keyboard.press('Escape'); time.sleep(0.3)
    check('bot match: Esc menu does not pause (looks online)', page.evaluate("__hp.game.state") != 'paused' and page.evaluate("document.getElementById('mnQuit').textContent") == 'LEAVE GAME')
    page.click('#mnQuit'); page.click('#mnYes'); time.sleep(0.3)
    check('bot match: LEAVE GAME returns to the title and clears the bot', page.evaluate("__hp.game.state") == 'title' and not page.evaluate('__hp.game.botMatch'))
    # backing out of the search cancels the bot
    page.evaluate('__hp.openLobby()'); page.click('#lbQuick'); time.sleep(0.5); page.click('#lbBack'); page.evaluate('__hp.qm.botAt = 0'); time.sleep(2.5)
    check('quick match: BACK cancels the search (no bot joins later)', not page.evaluate('__hp.game.botMatch') and page.evaluate("__hp.game.state") == 'title')
    check('no page errors', not errors, errors[:3])
    b.close()
bad = [k for k, v in results.items() if not v]
print(f'{len(results) - len(bad)}/{len(results)} passed' + (f'; FAILED: {bad}' if bad else ''))
sys.exit(1 if bad else 0)
