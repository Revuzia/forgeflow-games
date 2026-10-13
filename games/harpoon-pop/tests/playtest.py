"""Headless playtest for Harpoon Pop: real Chromium + WebGL (SwiftShader), real audio graph.
Usage: python playtest.py <game_dir> <out_dir> [--quick]
"""
import functools, http.server, json, os, sys, threading, time
from playwright.sync_api import sync_playwright
import os as _os
# real GPU by default (HP_GL=swiftshader for software GL)
ARGS = (['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] if _os.environ.get('HP_GL') == 'swiftshader' else ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']) + ['--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info']

GAME, OUT = sys.argv[1], sys.argv[2]
QUICK = '--quick' in sys.argv
os.makedirs(OUT, exist_ok=True)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=GAME))
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{srv.server_address[1]}/index.html'

results, errors = {}, []


def check(name, cond, detail=''):
    results[name] = {'ok': bool(cond), 'detail': detail}
    print(('PASS ' if cond else 'FAIL ') + name + (f'  [{detail}]' if detail != '' else ''), flush=True)


with sync_playwright() as pw:
    b = pw.chromium.launch(args=ARGS)
    page = b.new_page(viewport={'width': 1280, 'height': 760})
    page.on('console', lambda m: errors.append(f'console.{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    page.on('crash', lambda: errors.append('PAGE CRASHED'))
    page.on('requestfailed', lambda r: errors.append(f'requestfailed: {r.url} {r.failure}'))
    page.on('response', lambda r: errors.append(f'http {r.status}: {r.url}') if r.status >= 400 else None)
    page.goto(URL)
    page.wait_for_function('window.__hp && window.__hp.game', timeout=30000)
    page.wait_for_function("__hp.assetStatus.hero !== 'loading' && __hp.assetStatus.bee !== 'loading'", timeout=30000)
    page.evaluate('__hp.setManualClock(true)')
    st = page.evaluate('__hp.assetStatus')
    check('hero.glb loads (rigged character)', st['hero'] == 'ok', st['hero'])
    check('bee.glb loads (enemy)', st['bee'] == 'ok', st['bee'])
    shot = lambda n: page.screenshot(path=os.path.join(OUT, n + '.png'), clip=page.evaluate("(() => { const r = document.getElementById('stage').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()"), timeout=60000)
    page.evaluate('__hp.advance(0.5)'); shot('01_title')

    # --- Start via real keyboard input (also unlocks audio)
    page.focus('#hud'); page.keyboard.press('Space'); time.sleep(0.3)
    check('Space starts the game', page.evaluate('__hp.game.state') == 'intro', page.evaluate('__hp.game.state'))
    page.wait_for_function("__hp.Sound.state.samples >= 11", timeout=15000)
    page.wait_for_function("__hp.Sound.state.playing", timeout=20000)
    s = page.evaluate('__hp.Sound.state')
    check('audio context running', s['ctx'] == 'running', s)
    check('all 11 CC0 sample layers decoded', s['samples'] == 11, s['samples'])
    check('stage music track playing', s['playing'] and s['track'] == 'stage1', s)
    lvl = 0
    for _ in range(25): time.sleep(0.1); lvl = max(lvl, page.evaluate('__hp.Sound.level()'))
    check('music audible at output (RMS)', lvl > 0.005, round(lvl, 4))
    page.evaluate("__hp.Sound.toggleMusic()"); time.sleep(0.5)
    quiet = page.evaluate('__hp.Sound.level()')
    page.evaluate("__hp.Sound.sfx.pop(3)"); time.sleep(0.06)
    popl = page.evaluate('__hp.Sound.level()')
    check('pop SFX audible at output (RMS, music off)', popl > 0.01 and popl > quiet * 2, f'silence={quiet:.4f} pop={popl:.4f}')
    page.evaluate("__hp.Sound.toggleMusic()")

    # --- Gameplay: real input for movement/fire
    page.evaluate('__hp.advance(1.8)')
    check('READY→play transition', page.evaluate('__hp.game.state') == 'play')
    x0 = page.evaluate('__hp.game.player.x')
    page.keyboard.down('ArrowRight'); page.evaluate('__hp.advance(0.4)'); page.keyboard.up('ArrowRight')
    x1 = page.evaluate('__hp.game.player.x')
    check('ArrowRight moves player', x1 - x0 > 80, f'{x0:.0f}->{x1:.0f}')
    page.evaluate("(() => { const g=__hp.game; g.invuln = 99; g.player.x = g.bubbles[0].x; })()")
    page.keyboard.press('Space'); page.evaluate('__hp.advance(0.12)')
    check('Space fires a wire', page.evaluate('__hp.game.harpoons.length + __hp.game.stats.pops') >= 1)
    page.evaluate('__hp.advance(0.25)')
    pops = page.evaluate('__hp.game.stats.pops')
    check('wire splits bubble', pops >= 1 and page.evaluate('__hp.game.bubbles.length') >= 2, f'pops={pops}')
    page.evaluate('__hp.advance(0.05)'); shot('02_stage1_pop')

    # --- Full autopilot run through stages (cheat: invulnerable, auto-aim) to catch runtime errors
    bot = """(maxIter) => { const h=__hp, g=h.game; let it=0;
      while (g.state !== 'clear' && it++ < maxIter) {
        g.invuln = 99; if (g.state !== 'play') { h.advance(0.1, false); continue; }
        const bs = g.bubbles; if (bs.length) { const b = bs.reduce((a,c)=>Math.abs(c.x-g.player.x)<Math.abs(a.x-g.player.x)?c:a); g.player.x = Math.min(925, Math.max(35, b.x + b.vx*0.15)); }
        for (const e of g.enemies) if (!e.dying && Math.random()<0.3) g.player.x = e.x;
        h.input.pressed = true; h.advance(0.12, false);
      } return { state: g.state, it, pops: g.stats.pops, score: g.score, left: g.bubbles.length, stingers: g.stats.stingers }; }"""
    stages = range(1, 4) if QUICK else range(1, 16)
    for n in stages:
        page.evaluate(f'__hp.loadLevel({n}); __hp.game.lives = 9;')
        r = page.evaluate(bot, 900)
        r['gpu'] = page.evaluate('__hp.gpu()')
        check(f'stage {n} clears without errors', r['state'] == 'clear', r)

    # --- Enemy that shoots back
    page.evaluate('__hp.loadLevel(5); __hp.advance(2, false); __hp.game.enemyT = 0; __hp.game.invuln = 99;')
    page.evaluate('__hp.advance(1.2, false)')
    n_en = page.evaluate('__hp.game.enemies.length')
    check('stinger enemy spawns on stage 5', n_en >= 1, n_en)
    page.evaluate("(() => { const e = __hp.game.enemies[0]; e.x = 480; e.fireT = 0; })()")
    page.evaluate('__hp.advance(0.3)'); shot('03_enemy_telegraph')
    page.evaluate('__hp.advance(0.4)')
    check('enemy fires a stinger', page.evaluate('__hp.game.shots.length') >= 1, page.evaluate('[__hp.game.state, __hp.game.timeScale, __hp.game.shots.length, JSON.stringify(__hp.game.enemies.map(e=>[e.x|0,e.fireT,e.charge,e.dying]))]'))
    shot('04_enemy_shot')
    page.evaluate("(() => { const g=__hp.game; g.invuln = 0; g.shield = false; g.player.x = g.shots[0] ? g.shots[0].x : 480; })()")
    page.evaluate("(() => { const g=__hp.game, s=g.shots[0]; if (s) { s.x = g.player.x; s.y = 470; s.vx = 0; s.vy = 200; } })()")
    page.evaluate('__hp.advance(0.2)')
    check('stinger kills unshielded player', page.evaluate('__hp.game.state') == 'dying', page.evaluate('__hp.game.state'))
    page.evaluate('__hp.advance(0.25)'); shot('05_death')
    page.evaluate('__hp.advance(2.2, false)')
    page.evaluate('__hp.game.enemyT = 0; __hp.game.invuln = 99; __hp.advance(2.6, false)')
    e = page.evaluate("(() => { const e = __hp.game.enemies.find(e=>!e.dying); if (e) { e.x = 480; e.charge = 0; e.fireT = 9; __hp.game.player.x = 480; __hp.input.pressed = true; } return !!e; })()")
    page.evaluate('__hp.advance(0.5)')
    check('wire kills stinger (+score)', e and page.evaluate('__hp.game.stats.stingers') >= 1, page.evaluate('__hp.game.stats.stingers'))

    # --- Power-ups incl. triple wire
    page.evaluate('__hp.loadLevel(2); __hp.advance(2, false); __hp.game.invuln = 99;')
    for t in ['double', 'double']:
        page.evaluate(f"__hp.applyItem({{type:'{t}', x: __hp.game.player.x, y: 470}})")
    check('double + double = triple wire', page.evaluate('__hp.game.weapon') == 'triple')
    page.evaluate("for (let i=0;i<3;i++){ __hp.input.pressed = true; __hp.advance(0.03, false); }")
    check('triple wire fires 3 at once', page.evaluate('__hp.game.harpoons.length') == 3, page.evaluate('__hp.game.harpoons.length'))
    for t in ['power', 'gun', 'slow', 'shield', 'life', 'dyna']:
        ok = page.evaluate(f"(() => {{ try {{ __hp.applyItem({{type:'{t}', x: __hp.game.player.x, y: 470}}); __hp.advance(0.3, false); return true; }} catch(e) {{ return String(e); }} }})()")
        check(f'power-up {t} applies', ok is True, ok)
    page.evaluate("__hp.game.items.push({type:'shield',x:300,y:478,vy:0,t:0,landed:true},{type:'gun',x:640,y:478,vy:0,t:0,landed:true},{type:'life',x:820,y:478,vy:0,t:0,landed:true})")
    page.evaluate("__hp.keys.Space = true; __hp.advance(0.35); __hp.keys.Space = false;"); shot('06_dynamite_gun_items')

    # --- Near-miss bullet-time
    page.evaluate("__hp.loadLevel(1); __hp.advance(2, false); (() => { const g=__hp.game, b=g.bubbles[0]; g.invuln=0; g.nearCd=0; b.x = g.player.x + 10 + b.r + 8; b.y = 470 - b.r; b.vy = 0; })(); __hp.advance(0.05)")
    check('near-miss triggers bullet-time', page.evaluate('__hp.game.stats.close') >= 1, page.evaluate('__hp.game.stats.close'))
    page.evaluate('__hp.advance(0.12)'); shot('07_near_miss_slowmo')

    # --- Stage clear fireworks, continue screen
    page.evaluate("__hp.loadLevel(1); __hp.advance(2, false); __hp.game.invuln=99;")
    page.evaluate(bot, 900); page.evaluate('__hp.advance(1.4)'); shot('08_stage_clear')
    page.evaluate("__hp.loadLevel(3); __hp.advance(2, false); __hp.game.lives = 1; __hp.game.invuln = 0; __hp.game.shield=false; (() => { const g=__hp.game,b=g.bubbles[0]; b.x=g.player.x; b.y=460; })(); __hp.advance(4)")
    check('last life lost → CONTINUE countdown', page.evaluate('__hp.game.state') == 'gameover' and page.evaluate('__hp.game.contT') > 0)
    shot('09_continue')
    page.keyboard.press('Space'); page.evaluate('__hp.advance(0.1)')
    check('Space on CONTINUE restarts the stage', page.evaluate('__hp.game.state') == 'intro' and page.evaluate('__hp.game.lives') == 3 and page.evaluate('__hp.game.level') == 3)
    page.evaluate("__hp.game.lives = 1; __hp.game.invuln = 0; __hp.advance(2, false); (() => { const g=__hp.game,b=g.bubbles[0]; b.x=g.player.x; b.y=460; })(); __hp.advance(3, false); __hp.advance(10.5, false)")
    check('countdown expires → GAME OVER', page.evaluate('__hp.game.state') == 'gameover' and page.evaluate('__hp.game.contT') == 0)
    shot('10_game_over')
    s = page.evaluate('__hp.Sound.state')
    check('game-over track queued', s['track'] == 'over', s)
    page.evaluate('__hp.advance(1.3, false)'); page.keyboard.press('Space'); page.evaluate('__hp.advance(0.1)')
    check('Space → back to title', page.evaluate('__hp.game.state') == 'title')

    # --- Gameplay hero close-up for the visual review
    page.evaluate("__hp.loadLevel(7); __hp.advance(2.2, false); __hp.game.invuln=0;")
    page.keyboard.down('ArrowLeft'); page.evaluate('__hp.advance(0.35)'); page.keyboard.up('ArrowLeft'); shot('11_hero_run')
    page.keyboard.press('Space'); page.evaluate('__hp.advance(0.08)'); shot('12_hero_shoot')
    # --- Thumbnail (1280x720): stage 6 mid-action, hero firing, a bee incoming
    page.set_viewport_size({'width': 1312, 'height': 760})
    page.evaluate("""(() => { const h=__hp, g=h.game; h.loadLevel(6); h.advance(2.2, false); g.invuln = 99; g.enemyT = 0; h.advance(1.6, false);
      const e = g.enemies[0]; if (e) { e.x = 700; e.baseY = 150; e.fireT = 9; }
      g.player.x = g.bubbles[0].x - 4; h.input.pressed = true; h.advance(0.12, false); h.advance(0.16); g.invuln = 0; })()""")
    time.sleep(0.3); page.evaluate('__hp.advance(0.02)')
    shot('thumbnail')
    page.set_viewport_size({'width': 400, 'height': 800}); time.sleep(0.3); page.evaluate('__hp.advance(0.2)'); page.screenshot(path=os.path.join(OUT, '13_phone.png'))
    b.close()

srv.shutdown()
real_errors = [e for e in errors if 'GPU stall' not in e and 'GL Driver Message' not in e and 'WebGL' not in e]
check('no console errors / page errors / failed requests', not real_errors, real_errors[:12])
json.dump({'results': results, 'errors': errors}, open(os.path.join(OUT, 'report.json'), 'w'), indent=1)
fails = [k for k, v in results.items() if not v['ok']]
print(f'\n{len(results) - len(fails)}/{len(results)} passed' + (f'; FAILED: {fails}' if fails else ''))
