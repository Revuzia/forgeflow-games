"""feel-juice-ui lane, pass 2: settings, a real hit + kill on a bot placed on the camera ray,
SMG sustained fire, gunshot-voice concurrency over a real 50-player match, victory + post-match.
Read-only against the repo."""
import json, os, time
from playwright.sync_api import sync_playwright

OUT = os.path.dirname(os.path.abspath(__file__))
URL = "http://127.0.0.1:8790/games/last-circle/index.html"
P = {}

# records hit-marker / damage-number DOM activity with timestamps so a missed screenshot still yields evidence
DOM_SPY = r"""
window.__DOMLOG__ = [];
new MutationObserver((muts) => {
  for (const m of muts) {
    if (m.type === 'childList') for (const n of m.addedNodes) {
      if (n.nodeType === 1 && n.style && n.style.willChange === 'transform, opacity') window.__DOMLOG__.push({ t: performance.now(), k: 'dmgnum', txt: n.textContent, color: n.style.color, fs: n.style.fontSize });
    }
    if (m.type === 'attributes' && m.target.textContent === '✕') window.__DOMLOG__.push({ t: performance.now(), k: 'hitmark', op: m.target.style.opacity, color: m.target.style.color, fs: m.target.style.fontSize });
  }
}).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
"""

PLACE_ON_RAY = r"""(args) => { const W = window.__LC__.W, p = W.player, cam = W.camera;
  const dir = new cam.position.constructor(); cam.getWorldDirection(dir);
  let best = null;
  for (let d = 5; d < 30; d += 0.25) {
    const x = cam.position.x + dir.x * d, y = cam.position.y + dir.y * d, z = cam.position.z + dir.z * d;
    const g = W.map.heightAt(x, z);
    const chest = y - g;
    if (chest > 0.9 && chest < 1.4 && Math.hypot(x - p.pos.x, z - p.pos.z) > 4) { best = { x, z, g, d, chest }; break; }
  }
  if (!best) { const d = 9; best = { x: cam.position.x + dir.x * d, z: cam.position.z + dir.z * d, d, chest: -1 }; best.g = cam.position.y + dir.y * d - 1.1; }
  const bot = W.actors.find(a => a !== p && a.alive && !args.skip.includes(a.id));
  bot.netRemote = true; bot.gliding = false; bot.vel.set(0,0,0);
  bot.pos.set(best.x, best.g, best.z); bot.obj.position.copy(bot.pos);
  bot.yaw = p.yaw + Math.PI; bot.obj.rotation.y = bot.yaw;
  bot.hp = args.hp; bot.shield = args.shield;
  return { id: bot.id, name: bot.name, d: +best.d.toFixed(2), chest: +best.chest.toFixed(2) };
}"""

def shot(page, name, **kw):
    page.screenshot(path=os.path.join(OUT, name), **kw)
    print("shot", name, flush=True)

with sync_playwright() as pw:
    br = pw.chromium.launch(headless=True, args=["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"])
    ctx = br.new_context(viewport={"width": 1280, "height": 720})
    page = ctx.new_page()
    page.add_init_script(DOM_SPY)
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.goto(URL)
    page.wait_for_function("() => !!window.__LC__", timeout=90000)
    page.wait_for_timeout(1200)
    # first-run HOW TO PLAY modal -> GOT IT
    try:
        page.get_by_text("GOT IT").first.click(timeout=4000)
        page.wait_for_timeout(600)
    except Exception as e:
        P["gotit_err"] = str(e)[:160]
    shot(page, "20_menu_clean.png")
    try:
        page.get_by_text("SETTINGS").first.click(timeout=4000)
        page.wait_for_timeout(700)
        shot(page, "21_settings.png")
        P["settings_text"] = page.evaluate("() => document.body.innerText.slice(0, 3000)")
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)
    except Exception as e:
        P["settings_err"] = str(e)[:160]
    # measure the menu transition: how long between PLAY and the loading card
    page.evaluate("() => { window.__startP = window.__LC__.startMatch({mode:'standard', seed: 777, mapId: window.__LC__.W.mapId}); }")
    page.wait_for_function("() => { const W = window.__LC__.W; return W.phase === 'drop' || W.phase === 'match'; }", timeout=120000)
    page.wait_for_timeout(600)
    # land fast
    P["landing"] = page.evaluate("""() => { const L = window.__LC__, W = L.W;
        for (let i = 0; i < 200 && (W.player.gliding || !W.player.onGround); i++) L.fastForward(0.25, 1/30);
        return { phase: W.phase, onGround: W.player.onGround, t: +W.t.toFixed(1) }; }""")
    page.wait_for_timeout(800)
    # hide the pre-pointer-lock prompt (a real player's first click removes it)
    page.evaluate("() => { for (const el of document.querySelectorAll('div')) if (el.textContent === 'CLICK TO LOOK AROUND') el.style.visibility = 'hidden'; }")
    tgt = page.evaluate(PLACE_ON_RAY, {"skip": [], "hp": 100, "shield": 50})
    P["target1"] = tgt
    page.wait_for_timeout(500)
    shot(page, "22_target_placed.png")
    page.evaluate("""() => { window.__hurt = []; const W = window.__LC__.W;
        W.events.on('actorHurt', (v, info) => { if (v.id === '%s') window.__hurt.push({ dmg: info.dmg, toShield: info.toShield, head: !!info.isHead, broke: !!info.broke, t: performance.now() }); });
        W.events.on('actorDied', (v, k, w) => { if (v.id === '%s') window.__hurt.push({ died: true, t: performance.now() }); });
        window.__shotT = performance.now(); W._fireEdge = performance.now(); }""" % (tgt["id"], tgt["id"]))
    page.wait_for_timeout(35)
    shot(page, "23_hit_t35ms.png")
    page.wait_for_timeout(250)
    shot(page, "24_hit_t300ms.png")
    P["hurt_after_pistol"] = page.evaluate("() => window.__hurt")
    # three more pistol clicks to show number stacking
    for i in range(3):
        page.evaluate("() => { window.__LC__.W._fireEdge = performance.now(); }")
        page.wait_for_timeout(260)
    shot(page, "25_pistol_x4.png")
    # kill: set hp low, fire once
    page.evaluate("() => { const b = window.__LC__.W.actorById.get('%s'); b.hp = 6; b.shield = 0; window.__killT = performance.now(); window.__LC__.W._fireEdge = performance.now(); }" % tgt["id"])
    page.wait_for_timeout(40)
    shot(page, "26_kill_t40ms.png")
    page.wait_for_timeout(260)
    shot(page, "27_kill_t300ms.png")
    page.wait_for_timeout(900)
    shot(page, "28_kill_t1200ms.png")
    P["hurt_after_kill"] = page.evaluate("() => window.__hurt")
    P["dom_log_hit_kill"] = page.evaluate("() => window.__DOMLOG__.map(e => Object.assign({}, e, { t: +(e.t - window.__shotT).toFixed(0) }))")
    # SMG sustained on a shielded target
    tgt2 = page.evaluate(PLACE_ON_RAY, {"skip": [tgt["id"]], "hp": 100, "shield": 100})
    P["target2"] = tgt2
    page.evaluate("""() => { const W = window.__LC__.W, p = W.player;
        p.inventory.slots[1] = { kind: 'weapon', id: 'smg', rarity: 2, mag: 30 }; p.inventory.ammo.light = 999;
        W.equipSlot(p, 1); }""")
    page.wait_for_timeout(700)
    page.evaluate("() => { window.__DOMLOG__.length = 0; window.__smgT = performance.now(); window.__LC__.W.player.input.fire = true; }")
    page.wait_for_timeout(900)
    shot(page, "29_smg_900ms.png")
    page.evaluate("() => { window.__LC__.W.player.input.fire = false; }")
    P["smg_dmg_numbers"] = page.evaluate("() => window.__DOMLOG__.filter(e => e.k === 'dmgnum').length")
    P["smg_live_dmg_nodes_peak"] = page.evaluate("() => document.querySelectorAll('div[style*=\"will-change: transform, opacity\"]').length")
    # ── gunshot voice concurrency over a real match (deterministic fastForward) ──
    P["voice_estimate"] = page.evaluate("""() => { const L = window.__LC__, W = L.W, p = W.player;
        const AUD = { pistol: 220, smg: 200, ar: 320, shotgun: 120, sniper: 520, launcher: 260 };
        p.hp = 1e6; p.shield = 0;           // keep the listener alive for the whole sample
        const ev = [];
        W.events.on('shotFired', (a, wid, eye) => { const def = W.SIM.WEAPONS[wid]; const cls = def ? def.cls : 'ar';
          const d = Math.hypot(eye.x - W.camera.position.x, eye.z - W.camera.position.z);
          if (a !== p && d <= (AUD[cls] || 260)) ev.push({ t: W.t, cls, d }); });
        let foot = 0; W.events.on('footstep', (a) => { if (a !== p && Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) < 34) foot++; });
        const t0 = W.t; L.fastForward(180, 1/30); const span = W.t - t0;
        // each report is a ~0.5 s voice (BufferSource + Gain + HRTF Panner [+ Biquad]); count overlap
        let peak = 0, peakT = 0; const DUR = 0.5;
        for (let i = 0; i < ev.length; i++) { let n = 0; for (let j = i; j >= 0 && ev[i].t - ev[j].t < DUR; j--) n++; if (n > peak) { peak = n; peakT = ev[i].t; } }
        const byCls = {}; for (const e of ev) byCls[e.cls] = (byCls[e.cls] || 0) + 1;
        return { simSeconds: +span.toFixed(1), audibleShots: ev.length, perSec: +(ev.length / span).toFixed(2), peakConcurrentShotVoices: peak, peakAtSimT: +peakT.toFixed(1), byCls, nearbyFootsteps: foot, alive: W.match.aliveCount() }; }""")
    # ── victory: eliminate everyone else, watch the beat + post-match ──
    page.evaluate("""() => { const W = window.__LC__.W, p = W.player; p.hp = 100;
        for (const a of W.actors) if (a !== p && a.alive) { a.hp = 0; a.shield = 0; W.killActor(a, p.id, 'smg'); } }""")
    page.wait_for_timeout(700)
    shot(page, "30_victory_t700ms.png")
    page.wait_for_timeout(1300)
    shot(page, "31_victory_t2000ms.png")
    page.wait_for_timeout(1800)
    shot(page, "32_post_match.png")
    P["post_match_text"] = page.evaluate("() => document.body.innerText.slice(0, 2500)")
    page.mouse.wheel(0, 600)
    page.wait_for_timeout(500)
    shot(page, "33_post_match_scrolled.png", full_page=False)
    P["errors"] = errs[:20]
    json.dump(P, open(os.path.join(OUT, "probes2.json"), "w"), indent=1)
    print(json.dumps(P, indent=1)[:6000])
    br.close()
