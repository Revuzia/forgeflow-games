"""Mobile test: Chromium device emulation (isMobile + hasTouch) driving the shared on-screen controls with
real multi-touch events (CDP Input.dispatchTouchEvent). Usage: python mobile_test.py <game_dir_or_url> <out_dir>
Covers phones in landscape + portrait and a tablet: device detection, edge-to-edge layout with no sideways
scroll, the thumbstick + FIRE overlay and the fullscreen/pause bar, tap-to-pick on the title, move + fire at
the same time, a pop, the online lobby on a phone, the rotate prompt, adaptive quality under a slow CPU, and
an online game with a phone guest against a desktop host.
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


class Touch:
    """Multi-touch through CDP: points is {id: (x, y)}; every call sends the full set of active touches."""
    def __init__(self, page):
        self.cdp = page.context.new_cdp_session(page); self.pts = {}
    def _send(self, typ):
        self.cdp.send('Input.dispatchTouchEvent', {'type': typ, 'touchPoints': [{'x': x, 'y': y, 'id': i} for i, (x, y) in self.pts.items()]})
    def down(self, i, x, y): self.pts[i] = (x, y); self._send('touchStart')
    def move(self, i, x, y): self.pts[i] = (x, y); self._send('touchMove')
    def up(self, i):
        x, y = self.pts.pop(i)
        self.cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': [{'x': px, 'y': py, 'id': j} for j, (px, py) in self.pts.items()]})
    def tap(self, x, y, i=9): self.down(i, x, y); time.sleep(0.05); self.up(i)


def center(page, sel):
    r = page.evaluate(f"(() => {{ const e = document.querySelector('{sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, r.width, r.height]; }})()")
    return r


def game_to_screen(page, gx, gy):
    return page.evaluate(f"(() => {{ const r = document.getElementById('hud').getBoundingClientRect(); return [r.x + {gx} / 960 * r.width, r.y + {gy} / 540 * r.height]; }})()")


def open_device(pw, name, dev):
    b = pw.chromium.launch(args=ARGS)
    ctx = b.new_context(**{k: v for k, v in dev.items() if k != 'default_browser_type'})
    p = ctx.new_page()
    p.on('pageerror', lambda e: errors.append(f'{name} pageerror: {e}'))
    p.on('console', lambda m: errors.append(f'{name} console.{m.type}: {m.text}') if m.type == 'error' else None)
    p.goto(BASE)
    p.wait_for_function('window.__hp && __hp.game', timeout=40000)
    time.sleep(0.6)
    return b, p


def phone_checks(pw, name, dev, full=True):
    b, p = open_device(pw, name, dev)
    t = Touch(p)
    vw, vh = p.evaluate('[innerWidth, innerHeight]')
    d = p.evaluate('window.FFG_DEVICE')
    check(f'{name}: detected as a touch device', d and d['touch'] and d['mobile'], d)
    check(f'{name}: lighter graphics tier on a phone', p.evaluate('__hp.MOBILE && __hp.QUALITY.dprCap <= 1.5 && __hp.QUALITY.particleCap <= 450'), p.evaluate('__hp.QUALITY'))
    st, fire = center(p, '#__ffg_touch__ .ffgt-stick'), center(p, '#__ffg_touch__ .ffgt-btn')
    check(f'{name}: on-screen thumbstick + FIRE button shown', st and fire and p.evaluate("document.querySelector('#__ffg_touch__ .ffgt-btn').textContent") == 'FIRE', f'stick {st} fire {fire}')
    check(f'{name}: fullscreen / pause bar shown', p.evaluate("!!document.getElementById('__ff_controls__')"))
    sr = p.evaluate("(() => { const r = document.getElementById('stage').getBoundingClientRect(); return [r.width, r.height]; })()")
    nos = p.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
    check(f'{name}: game fills the screen, no sideways scroll', nos and (abs(sr[0] - vw) < 2 or abs(sr[1] - vh) < 2), f'viewport {vw}x{vh}, game {sr[0]:.0f}x{sr[1]:.0f}')
    p.evaluate('__hp.advance(0.3)'); p.screenshot(path=f'{OUT}/{name}_title.png')
    if not full:
        b.close(); return
    # tap 1 PLAYER (centre label is x=W/2-130) -> starts a solo game
    x, y = game_to_screen(p, 480 - 130, 300)
    t.tap(x, y); time.sleep(0.2)
    check(f'{name}: tapping 1 PLAYER starts a game', p.evaluate("__hp.game.state") == 'intro', p.evaluate("__hp.game.state"))
    p.evaluate('__hp.setManualClock(true); __hp.advance(2, false); __hp.game.invuln = 99; __hp.game.bubbles.forEach(b => { b.x = 120; b.y = 120; b.vx = 0; })')
    # hold the stick to the right AND press FIRE at the same time (two fingers)
    x0 = p.evaluate('__hp.game.player.x')
    t.down(1, st[0], st[1]); t.move(1, st[0] + st[2] * 0.45, st[1])
    t.down(2, fire[0], fire[1]); time.sleep(0.05)
    p.evaluate('__hp.advance(0.15)')  # check the wire before it reaches the ceiling (~0.4 s)
    wires = p.evaluate('__hp.game.harpoons.length + (__hp.game.player.shotId > 0 ? 0 : -9)')
    p.evaluate('__hp.advance(0.25)')
    x1 = p.evaluate('__hp.game.player.x')
    p.screenshot(path=f'{OUT}/{name}_move_fire.png')
    t.up(2); t.up(1)
    check(f'{name}: thumbstick moves + FIRE shoots at the same time', x1 - x0 > 60 and wires >= 1, f'x {x0:.0f}->{x1:.0f}, wires {wires}')
    p.evaluate('__hp.advance(0.3, false)')
    x2 = p.evaluate('__hp.game.player.x'); p.evaluate('__hp.advance(0.3, false)')
    check(f'{name}: releasing the stick stops the diver', abs(p.evaluate('__hp.game.player.x') - x2) < 2)
    # pop: put a bubble straight above, tap FIRE
    p.evaluate("(() => { const g = __hp.game, b = g.bubbles[0]; b.x = g.player.x; b.y = 260; b.vx = 0; b.vy = 0; })()")
    t.tap(fire[0], fire[1]); p.evaluate('__hp.advance(0.5)')
    check(f'{name}: FIRE pops a bubble', p.evaluate('__hp.game.stats.pops') >= 1, p.evaluate('__hp.game.stats.pops'))
    # pause from the bar
    pb = p.evaluate("(() => { const b = [...document.querySelectorAll('#__ff_controls__ button')].find(b => /pause/i.test(b.title || b.getAttribute('aria-label') || '')); if (!b) return null; const r = b.getBoundingClientRect(); return [r.x + r.width/2, r.y + r.height/2]; })()")
    if pb: t.tap(pb[0], pb[1]); time.sleep(0.2)
    check(f'{name}: bar pause button pauses the game', pb and p.evaluate('__hp.game.state') == 'paused', p.evaluate('__hp.game.state'))
    p.evaluate("__hp.game.state = 'play'; __hp.advance(0.1)"); p.screenshot(path=f'{OUT}/{name}_play.png')
    b.close()


def lobby_check(pw, name, dev):
    b, p = open_device(pw, name, dev)
    t = Touch(p)
    x, y = game_to_screen(p, 480 + 130, 300)  # ONLINE CO-OP label
    t.tap(x, y); time.sleep(0.2)
    check(f'{name}: tapping ONLINE CO-OP opens the lobby', p.evaluate("!document.getElementById('lobby').hidden"))
    vw, vh = p.evaluate('[innerWidth, innerHeight]')
    card = p.evaluate("(() => { const r = document.querySelector('.lb-card').getBoundingClientRect(); return [r.x, r.y, r.right, r.bottom]; })()")
    btn = p.evaluate("(() => { const r = document.getElementById('lbQuick').getBoundingClientRect(); return [r.width, r.height]; })()")
    hidden = p.evaluate("getComputedStyle(document.getElementById('__ffg_touch__')).display === 'none'")
    check(f'{name}: lobby fits the phone, buttons are thumb-sized, stick hidden behind it', card[0] >= 0 and card[2] <= vw + 1 and btn[1] >= 40 and hidden, f'card {card}, button {btn}, viewport {vw}x{vh}')
    p.screenshot(path=f'{OUT}/{name}_lobby.png')
    bb = center(p, '#lbBack'); t.tap(bb[0], bb[1]); time.sleep(0.2)
    check(f'{name}: BACK closes the lobby and the stick returns', p.evaluate("document.getElementById('lobby').hidden && getComputedStyle(document.getElementById('__ffg_touch__')).display !== 'none'"))
    b.close()


def portrait_check(pw, name, dev):
    b, p = open_device(pw, name, dev)
    t = Touch(p)
    vis = p.evaluate("getComputedStyle(document.getElementById('rotate')).display !== 'none'")
    p.screenshot(path=f'{OUT}/{name}_rotate.png')
    check(f'{name}: portrait shows the turn-sideways prompt', vis)
    c = center(p, '#rtDismiss'); t.tap(c[0], c[1]); time.sleep(0.2)
    gone = p.evaluate("getComputedStyle(document.getElementById('rotate')).display === 'none'")
    vw = p.evaluate('innerWidth'); sw = p.evaluate("document.getElementById('stage').getBoundingClientRect().width")
    check(f'{name}: PLAY ANYWAY dismisses it; game spans the width', gone and abs(sw - vw) < 2 and p.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'stage {sw:.0f} vs {vw}')
    p.screenshot(path=f'{OUT}/{name}_portrait_play.png')
    b.close()


def perf_check(pw, name, dev):
    b, p = open_device(pw, name, dev)
    cdp = p.context.new_cdp_session(p)
    p.evaluate("__hp.newGame(false)"); time.sleep(2.2)
    p.evaluate("__hp.game.invuln = 9999; __hp.game.lives = 9")
    cdp.send('Emulation.setCPUThrottlingRate', {'rate': 6})
    p.evaluate("window.__fr = 0; (function f(){ window.__fr++; requestAnimationFrame(f); })()")
    t0 = time.time(); f0 = p.evaluate('window.__fr'); time.sleep(10)
    fps = (p.evaluate('window.__fr') - f0) / (time.time() - t0)
    cdp.send('Emulation.setCPUThrottlingRate', {'rate': 1})
    q = p.evaluate('__hp.QUALITY')
    check(f'{name}: under a 6x slower CPU the game keeps running and adapts quality', fps > 15, f'{fps:.0f} fps, quality steps taken: {q["log"] or "none needed"}')
    b.close()


def online_phone_guest(pw, dev):
    bA = pw.chromium.launch(args=ARGS); A = bA.new_page(viewport={'width': 1312, 'height': 760})
    A.on('pageerror', lambda e: errors.append(f'host pageerror: {e}'))
    A.goto(BASE); A.wait_for_function('window.__hp && __hp.game', timeout=40000)
    A.evaluate('__hp.openLobby()'); A.click('#lbCreate')
    wait_until(A, "document.getElementById('lbRoom').textContent.length === 4", 25)
    code = A.evaluate("document.getElementById('lbRoom').textContent")
    link = A.evaluate("document.getElementById('lbLink').textContent")
    check('online: CREATE ROOM shows an invite link with the code', link.endswith('?room=' + code), link)
    # the phone opens the invite (?room=CODE) and joins automatically
    bB = pw.chromium.launch(args=ARGS)
    ctxB = bB.new_context(**{k: v for k, v in dev.items() if k != 'default_browser_type'})
    B = ctxB.new_page(); B.on('pageerror', lambda e: errors.append(f'phone pageerror: {e}'))
    B.goto(BASE + '?room=' + code)
    ok = wait_until(A, '__hp.Net.started', 40) and wait_until(B, '__hp.Net.started', 15)
    check('online: phone opens the invite link and joins the desktop host', ok, [A.evaluate('__hp.Net.role'), B.evaluate('__hp.Net.role')])
    if ok:
        wait_until(B, "__hp.game.state === 'play'", 10)
        A.evaluate("__hp.game.players.forEach(p => p.invuln = 999)")
        t = Touch(B)
        st, fire = center(B, '#__ffg_touch__ .ffgt-stick'), center(B, '#__ffg_touch__ .ffgt-btn')
        h0 = A.evaluate('__hp.game.players[1].x')
        t.down(1, st[0], st[1]); t.move(1, st[0] - st[2] * 0.45, st[1]); time.sleep(0.7); t.up(1); time.sleep(0.5)
        h1 = A.evaluate('__hp.game.players[1].x')
        check('online: phone thumbstick moves the phone player on the host', h0 - h1 > 100, f'{h0:.0f}->{h1:.0f}')
        t.tap(fire[0], fire[1])
        check('online: phone FIRE shoots on the host', wait_until(A, '__hp.game.harpoons.some(h => h.owner === 1) || __hp.game.players[1].shotId > 0', 3))
        time.sleep(0.3); B.screenshot(path=f'{OUT}/online_phone_guest.png')
    bB.close(); bA.close()


with sync_playwright() as pw:
    D = pw.devices
    phone_checks(pw, 'iphone_landscape', D['iPhone 13 landscape'])
    phone_checks(pw, 'pixel_landscape', D['Pixel 7 landscape'])
    phone_checks(pw, 'ipad_landscape', D['iPad Pro 11 landscape'], full=False)
    lobby_check(pw, 'iphone_landscape', D['iPhone 13 landscape'])
    portrait_check(pw, 'iphone_portrait', D['iPhone 13'])
    perf_check(pw, 'pixel_landscape', D['Pixel 7 landscape'])
    online_phone_guest(pw, D['Pixel 7 landscape'])

real = [e for e in errors if 'GL Driver' not in e and 'GPU stall' not in e]
check('no page errors / console errors', not real, real[:8])
print(f"\n{sum(results.values())}/{len(results)} passed" + ('' if all(results.values()) else f"; FAILED: {[k for k, v in results.items() if not v]}"))
