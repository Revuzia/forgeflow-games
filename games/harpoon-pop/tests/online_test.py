"""Online co-op test: two separate browsers (as two devices) on the real Supabase Realtime service.
Usage: python online_test.py <game_dir_or_url> <out_dir>
Covers: create/join by code over the direct WebRTC link, the relay fallback (?p2p=0), quick match,
input sync both ways, shared bubbles/score, and a partner disconnecting mid-game.
"""
import functools, http.server, os, sys, threading, time
from playwright.sync_api import sync_playwright

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
if SRC.startswith('http'):
    BASE = SRC.rsplit('/', 1)[0] + '/index.html'
else:
    class Q(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Q, directory=SRC))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    BASE = f'http://127.0.0.1:{srv.server_address[1]}/index.html'
ARGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required',
        '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows']
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


def open_page(pw, tag, query=''):
    b = pw.chromium.launch(args=ARGS)
    p = b.new_page(viewport={'width': 1312, 'height': 760})
    p.on('pageerror', lambda e: errors.append(f'{tag} pageerror: {e}'))
    p.on('console', lambda m: errors.append(f'{tag} console.{m.type}: {m.text}') if m.type == 'error' else None)
    p.goto(BASE + query)
    p.wait_for_function('window.__hp && __hp.game', timeout=30000)
    p.focus('#hud'); p.keyboard.press('KeyM'); p.keyboard.press('KeyM')  # user gesture: unlock audio
    return b, p


def pair_by_code(A, B, label):
    A.evaluate('__hp.openLobby()'); A.click('#lbCreate')
    ok = wait_until(A, "!document.getElementById('lbRoom').hidden && document.getElementById('lbRoom').textContent.length === 4", 25)
    code = A.evaluate("document.getElementById('lbRoom').textContent")
    check(f'{label}: CREATE ROOM shows a 4-character code', ok, code)
    B.evaluate('__hp.openLobby()'); B.fill('#lbCode', code.lower()); B.click('#lbJoinBtn')
    ok = wait_until(A, '__hp.Net.started', 30) and wait_until(B, '__hp.Net.started', 15)
    roles = [A.evaluate('__hp.Net.role'), B.evaluate('__hp.Net.role')]
    modes = [A.evaluate('__hp.Net.mode'), B.evaluate('__hp.Net.mode')]
    check(f'{label}: friend joins by code, game starts on both devices', ok and roles == ['host', 'guest'], f'roles={roles} modes={modes}')
    return modes[0]


def play_checks(A, B, label):
    wait_until(A, "__hp.game.state === 'play'", 10); wait_until(B, "__hp.game.state === 'play'", 10)
    A.evaluate("__hp.game.players.forEach(p => p.invuln = 999)")
    time.sleep(0.4)
    check(f'{label}: both screens show stage 1 with two divers', A.evaluate('__hp.game.level') == 1 and B.evaluate('__hp.game.level') == 1 and B.evaluate('__hp.game.players.length') == 2)
    # guest moves -> host sees P2 move
    hx0 = A.evaluate('__hp.game.players[1].x'); gx0 = B.evaluate('__hp.game.players[1].x')
    B.keyboard.down('ArrowLeft'); time.sleep(0.7); B.keyboard.up('ArrowLeft'); time.sleep(0.5)
    hx1 = A.evaluate('__hp.game.players[1].x'); gx1 = B.evaluate('__hp.game.players[1].x')
    check(f'{label}: guest moves instantly on their screen and on the host', gx0 - gx1 > 100 and hx0 - hx1 > 100 and abs(hx1 - gx1) < 25, f'guest {gx0:.0f}->{gx1:.0f}, host sees {hx0:.0f}->{hx1:.0f}')
    # host moves -> guest sees P1 move
    p0 = B.evaluate('__hp.game.players[0].x')
    A.keyboard.down('ArrowRight'); time.sleep(0.6); A.keyboard.up('ArrowRight'); time.sleep(0.5)
    p1, a1 = B.evaluate('__hp.game.players[0].x'), A.evaluate('__hp.game.players[0].x')
    check(f'{label}: host moves and the guest sees it', p1 - p0 > 100 and abs(p1 - a1) < 25, f'guest sees {p0:.0f}->{p1:.0f} (host at {a1:.0f})')
    # guest fires -> a P2 wire exists on the host and on the guest
    B.keyboard.press('Space')
    ok = wait_until(A, '__hp.game.harpoons.some(h => h.owner === 1)', 2) or A.evaluate('__hp.game.players[1].shotId') > 0
    ok2 = wait_until(B, '__hp.game.harpoons.some(h => h.owner === 1) || __hp.game.stats.pops > 0', 2)
    check(f'{label}: guest fires a wire (host runs it, guest sees it)', ok and ok2)
    time.sleep(0.25); B.screenshot(path=f'{OUT}/{label}_guest_fire.png')
    # host pops a bubble -> guest sees the split + shared score
    A.evaluate("(() => { const g = __hp.game, b = g.bubbles[0]; g.players[0].x = b.x; })()"); A.keyboard.press('Space')
    ok = wait_until(A, '__hp.game.stats.pops > 0', 3)
    time.sleep(0.6)
    sa, sb = A.evaluate('__hp.game.score'), B.evaluate('__hp.game.score')
    na, nb = A.evaluate('__hp.game.bubbles.length'), B.evaluate('__hp.game.bubbles.length')
    check(f'{label}: pops, splits and the shared score match on both screens', ok and sa > 0 and sa == sb and na == nb, f'score host {sa} guest {sb}, bubbles {na}/{nb}')
    A.screenshot(path=f'{OUT}/{label}_host.png'); B.screenshot(path=f'{OUT}/{label}_guest.png')


with sync_playwright() as pw:
    # 1) code join over the direct link
    bA, A = open_page(pw, 'A'); bB, B = open_page(pw, 'B')
    mode = pair_by_code(A, B, 'p2p')
    check('p2p: direct WebRTC link used', mode == 'p2p', mode)
    play_checks(A, B, 'p2p')
    st = A.evaluate('__hp.Net.stats')
    check('p2p: host streamed snapshots + events', st['snaps'] > 20, st)
    bB.close()  # guest's device disappears mid-game
    ok = wait_until(A, "__hp.Net.role === null && __hp.game.players[1].out && __hp.game.state !== 'title'", 25)
    check('p2p: guest drops -> host keeps playing solo', ok, A.evaluate("[__hp.Net.role, __hp.game.state, __hp.game.players.map(p => p.out).join()]"))
    bA.close()

    # 2) relay fallback (direct link disabled on both ends)
    bA, A = open_page(pw, 'A', '?p2p=0'); bB, B = open_page(pw, 'B', '?p2p=0')
    mode = pair_by_code(A, B, 'relay')
    check('relay: falls back to the Realtime relay', mode == 'relay', mode)
    play_checks(A, B, 'relay')
    A.evaluate('__hp.game.state = "gameover"; __hp.game.contT = 0;'); A.keyboard.press('Space')  # host quits to the title
    ok = wait_until(B, "__hp.game.state === 'title' && __hp.Net.role === null", 15)
    check('relay: host leaves -> guest returns to the title', ok, B.evaluate("[__hp.game.state, __hp.Net.role]"))
    bA.close(); bB.close()

    # 3) quick match
    bA, A = open_page(pw, 'A'); bB, B = open_page(pw, 'B')
    A.evaluate('__hp.openLobby()'); A.click('#lbQuick'); time.sleep(0.8)
    B.evaluate('__hp.openLobby()'); B.click('#lbQuick')
    ok = wait_until(A, '__hp.Net.started', 40) and wait_until(B, '__hp.Net.started', 15)
    roles = sorted([A.evaluate('__hp.Net.role'), B.evaluate('__hp.Net.role')])
    check('quick match: two searchers are paired into one game', ok and roles == ['guest', 'host'], roles)
    if ok:
        time.sleep(2.5); (A if A.evaluate('__hp.Net.role') == 'guest' else B).screenshot(path=f'{OUT}/quick_guest.png')
    bA.close(); bB.close()

real = [e for e in errors if 'GL Driver' not in e and 'GPU stall' not in e]
check('no page errors / console errors on either device', not real, real[:8])
print(f"\n{sum(results.values())}/{len(results)} passed" + ('' if all(results.values()) else f"; FAILED: {[k for k, v in results.items() if not v]}"))
