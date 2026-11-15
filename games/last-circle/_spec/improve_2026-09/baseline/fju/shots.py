"""feel-juice-ui lane: real screenshots of Last Circle via __LC__ on the scoped server.
Read-only against the repo. Output PNGs + a JSON of probes into this scratch dir."""
import json, sys, time, os
from playwright.sync_api import sync_playwright

OUT = os.path.dirname(os.path.abspath(__file__))
URL = "http://127.0.0.1:8790/games/last-circle/index.html"
probes = {}

# counts WebAudio node churn so the voice-cap question is answered with a number
AUDIO_SPY = r"""
(() => {
  const C = window.AudioContext || window.webkitAudioContext;
  if (!C) return;
  window.__AUDSPY__ = { panner: 0, src: 0, osc: 0, gain: 0, biquad: 0, t0: performance.now(), live: 0, peakLive: 0 };
  const S = window.__AUDSPY__;
  const wrap = (name, key) => {
    const f = C.prototype[name];
    C.prototype[name] = function () {
      const n = f.apply(this, arguments);
      S[key]++;
      if (key === 'src' || key === 'osc') {
        S.live++; if (S.live > S.peakLive) S.peakLive = S.live;
        n.addEventListener('ended', () => { S.live--; });
      }
      return n;
    };
  };
  wrap('createPanner', 'panner'); wrap('createBufferSource', 'src'); wrap('createOscillator', 'osc');
  wrap('createGain', 'gain'); wrap('createBiquadFilter', 'biquad');
})();
"""

def shot(page, name):
    p = os.path.join(OUT, name)
    page.screenshot(path=p)
    print("shot", name, flush=True)

with sync_playwright() as pw:
    br = pw.chromium.launch(headless=True, args=["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"])
    ctx = br.new_context(viewport={"width": 1280, "height": 720})
    page = ctx.new_page()
    page.add_init_script(AUDIO_SPY)
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.on("console", lambda m: errs.append("console." + m.type + ": " + m.text) if m.type in ("error", "warning") else None)
    t0 = time.time()
    page.goto(URL)
    page.wait_for_timeout(400)
    shot(page, "01_splash.png")
    page.wait_for_function("() => !!window.__LC__", timeout=90000)
    probes["boot_to_LC_s"] = round(time.time() - t0, 2)
    page.wait_for_timeout(1500)
    shot(page, "02_menu.png")
    # a real gesture so audio unlocks (the spy then counts node churn)
    page.mouse.click(5, 5)
    page.wait_for_timeout(500)
    # settings screen, if reachable by text
    try:
        btn = page.get_by_text("SETTINGS", exact=False).first
        btn.click(timeout=3000)
        page.wait_for_timeout(700)
        shot(page, "03_settings.png")
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)
    except Exception as e:
        probes["settings_err"] = str(e)[:200]
    shot(page, "03b_menu_after_settings.png")
    # start a standard match
    page.evaluate("() => { window.__startP = window.__LC__.startMatch({mode:'standard', seed: 12345, mapId: window.__LC__.W.mapId}); }")
    page.wait_for_timeout(250)
    shot(page, "04_loading.png")
    page.wait_for_function("() => { const W = window.__LC__.W; return W.phase === 'drop' || W.phase === 'match'; }", timeout=120000)
    probes["phase_after_lobby"] = page.evaluate("() => window.__LC__.W.phase")
    page.wait_for_timeout(1200)
    shot(page, "05_drop.png")
    # fast-forward the glide until the player is on the ground
    st = page.evaluate("""() => { const L = window.__LC__, W = L.W;
        for (let i = 0; i < 120 && (W.player.gliding || !W.player.onGround); i++) L.fastForward(0.5, 1/30);
        return { phase: W.phase, gliding: W.player.gliding, onGround: W.player.onGround, alive: W.match.aliveCount(), t: W.t }; }""")
    probes["after_landing"] = st
    page.wait_for_timeout(1500)
    shot(page, "06_match_hud.png")
    # reset the spy so churn is measured over live-frame play only
    page.evaluate("() => { const S = window.__AUDSPY__; if (S) { S.panner=S.src=S.osc=S.gain=S.biquad=0; S.t0=performance.now(); S.peakLive=S.live; } }")
    # place a frozen bot 7 m down the aim line, then fire the pistol for real frames
    setup = page.evaluate("""() => { const W = window.__LC__.W, p = W.player;
        p.input.pitch = 0; p.pitch = 0;
        const yaw = p.yaw;
        const bot = W.actors.find(a => a !== p && a.alive);
        const d = 7, x = p.pos.x - Math.sin(yaw) * d, z = p.pos.z - Math.cos(yaw) * d;
        bot.netRemote = true; bot.gliding = false; bot.vel.set(0,0,0);
        bot.pos.set(x, W.map.heightAt(x, z) + 0.05, z); bot.obj.position.copy(bot.pos);
        bot.hp = 100; bot.shield = 0;
        window.__tgt = bot.id;
        return { yaw, bot: bot.id, weapon: p.weapon.id, px: p.pos.x, pz: p.pos.z }; }""")
    probes["hit_setup"] = setup
    page.wait_for_timeout(300)
    # fire one shot, screenshot mid-hit
    page.evaluate("() => { window.__hits = []; const W = window.__LC__.W; W.events.on('actorHurt', (v, info) => { if (v.id === window.__tgt) window.__hits.push({dmg: info.dmg, head: !!info.isHead, t: performance.now()}); }); W.player.input.fire = true; }")
    page.wait_for_timeout(60)
    page.evaluate("() => { window.__LC__.W.player.input.fire = false; }")
    page.wait_for_timeout(40)
    shot(page, "07_hit.png")
    page.wait_for_timeout(300)
    shot(page, "07b_hit_300ms.png")
    probes["hits_after_one_shot"] = page.evaluate("() => window.__hits")
    # kill: drop the target low and fire again
    page.evaluate("() => { const W = window.__LC__.W, b = W.actorById.get(window.__tgt); b.hp = 4; b.shield = 0; W.player.weapon.cd = 0; W.player.input.fire = true; }")
    page.wait_for_timeout(60)
    page.evaluate("() => { window.__LC__.W.player.input.fire = false; }")
    page.wait_for_timeout(60)
    shot(page, "08_kill.png")
    page.wait_for_timeout(500)
    shot(page, "08b_kill_500ms.png")
    probes["target_alive_after_kill_shot"] = page.evaluate("() => window.__LC__.W.actorById.get(window.__tgt).alive")
    # sustained fire with the SMG/AR to look at damage-number stacking and fx load
    page.evaluate("""() => { const W = window.__LC__.W, p = W.player;
        const b = W.actors.find(a => a !== p && a.alive && a.id !== window.__tgt);
        const d = 8, x = p.pos.x - Math.sin(p.yaw) * d, z = p.pos.z - Math.cos(p.yaw) * d;
        b.netRemote = true; b.gliding = false; b.vel.set(0,0,0); b.pos.set(x, W.map.heightAt(x, z) + 0.05, z); b.obj.position.copy(b.pos);
        b.hp = 100; b.shield = 100; window.__tgt2 = b.id;
        p.inventory.slots[1] = { kind: 'weapon', id: 'smg', rarity: 2, mag: 30 }; p.inventory.ammo.light = 999;
        if (W.equipSlot) W.equipSlot(p, 1);
        return p.weapon.id; }""")
    page.wait_for_timeout(600)
    page.evaluate("() => { window.__LC__.W.player.input.fire = true; }")
    page.wait_for_timeout(700)
    shot(page, "09_sustained_smg.png")
    page.evaluate("() => { window.__LC__.W.player.input.fire = false; }")
    probes["dmg_dom_nodes_after_smg"] = page.evaluate("() => document.querySelectorAll('div').length")
    # let the match run with live frames a bit to measure audio churn in a real 50-player match
    page.wait_for_timeout(4000)
    probes["audio_spy_live_play"] = page.evaluate("() => { const S = window.__AUDSPY__; if (!S) return null; const s = (performance.now()-S.t0)/1000; return Object.assign({}, S, {secs: +s.toFixed(2)}); }")
    probes["audio_ctx_state"] = page.evaluate("() => window.__AUDIO_CTX__ ? window.__AUDIO_CTX__.state : null")
    # death screen: kill the player
    page.evaluate("""() => { const W = window.__LC__.W, p = W.player; p.shield = 0; p.hp = 1;
        const k = W.actors.find(a => a !== p && a.alive);
        if (window.__LC__.W.hurtActor) { window.__LC__.W.hurtActor(p, 50, k.id, 'ar', false); return 'hurtActor'; }
        return 'none'; }""")
    page.wait_for_timeout(800)
    shot(page, "10_after_player_hurt.png")
    probes["phase_after_hurt"] = page.evaluate("() => window.__LC__.W.phase")
    # force match end via fastForward until over (spectate); cap the loop
    res = page.evaluate("""() => { const L = window.__LC__, W = L.W;
        if (W.player.alive) { W.player.hp = 0; }
        for (let i = 0; i < 400 && !(W.match && W.match.over); i++) L.fastForward(2, 1/15);
        return { over: W.match.over, phase: W.phase, alive: W.match.aliveCount(), t: W.t }; }""")
    probes["fast_forward_to_end"] = res
    page.wait_for_timeout(1500)
    shot(page, "11_match_over_beat.png")
    page.wait_for_timeout(3000)
    shot(page, "12_post_match.png")
    probes["errors"] = errs[:30]
    json.dump(probes, open(os.path.join(OUT, "probes.json"), "w"), indent=1)
    print(json.dumps(probes, indent=1))
    br.close()
