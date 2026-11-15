"""feel-juice-ui lane, pass 4: SMG sustained fire (W._lmbDown), damage-number stacking, music-duck
call rate during own fire, headshot marker, hitstop wall-clock. Read-only against the repo."""
import json, os
from playwright.sync_api import sync_playwright

OUT = os.path.dirname(os.path.abspath(__file__))
URL = "http://127.0.0.1:8790/games/last-circle/index.html"
P = {}
DOM_SPY = r"""
window.__DOMLOG__ = [];
new MutationObserver((muts) => {
  for (const m of muts) {
    if (m.type === 'childList') for (const n of m.addedNodes) {
      if (n.nodeType === 1 && n.style && n.style.willChange === 'transform, opacity' && /^\d/.test(n.textContent)) window.__DOMLOG__.push({ t: performance.now(), k: 'dmgnum', txt: n.textContent, color: n.style.color });
    }
    if (m.type === 'attributes' && m.target.textContent === '✕') window.__DOMLOG__.push({ t: performance.now(), k: 'hitmark', op: m.target.style.opacity, color: m.target.style.color, fs: m.target.style.fontSize });
  }
}).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
// count setTargetAtTime(0.62, ...) = duckMusic() calls
(() => { const f = AudioParam.prototype.setTargetAtTime; window.__DUCK__ = 0;
  AudioParam.prototype.setTargetAtTime = function (v, t, c) { if (v === 0.62) window.__DUCK__++; return f.apply(this, arguments); }; })();
"""
PLACE = r"""(args) => { const W = window.__LC__.W, p = W.player, cam = W.camera;
  const dir = new cam.position.constructor(); cam.getWorldDirection(dir);
  const d = args.d; const x = cam.position.x + dir.x * d, z = cam.position.z + dir.z * d, y = cam.position.y + dir.y * d;
  const bot = W.actors.find(a => a !== p && a.alive && !args.skip.includes(a.id));
  bot.isDummy = true; bot.netRemote = true; bot.gliding = false; bot.vel.set(0,0,0);
  const g = W.map.heightAt(x, z);
  bot.pos.set(x, Math.max(g, y - args.aimY), z); bot.obj.position.copy(bot.pos);
  bot.yaw = p.yaw + Math.PI; bot.obj.rotation.y = bot.yaw;
  bot.hp = args.hp; bot.shield = args.shield;
  return { id: bot.id, name: bot.name, d, groundGap: +(bot.pos.y - g).toFixed(2) };
}"""
def shot(page, name):
    page.screenshot(path=os.path.join(OUT, name)); print("shot", name, flush=True)

with sync_playwright() as pw:
    br = pw.chromium.launch(headless=True, args=["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"])
    page = br.new_context(viewport={"width": 1280, "height": 720}).new_page()
    page.add_init_script(DOM_SPY)
    page.goto(URL)
    page.wait_for_function("() => !!window.__LC__", timeout=90000)
    page.wait_for_timeout(1000)
    page.mouse.click(5, 5)   # gesture: unlock audio so the music graph + duck exist
    try: page.get_by_text("GOT IT").first.click(timeout=3000)
    except Exception: pass
    page.evaluate("() => { window.__LC__.startMatch({mode:'standard', seed: 99, mapId: 'ashgrid'}); }")
    page.wait_for_function("() => { const W = window.__LC__.W; return W.phase === 'drop' || W.phase === 'match'; }", timeout=120000)
    page.wait_for_timeout(500)
    P["landing"] = page.evaluate("""() => { const L = window.__LC__, W = L.W;
        for (let i = 0; i < 200 && (W.player.gliding || !W.player.onGround); i++) L.fastForward(0.25, 1/30);
        W.player.hp = 100; return { phase: W.phase, onGround: W.player.onGround }; }""")
    page.wait_for_timeout(1500)
    P["music_routed"] = page.evaluate("() => (window.__GAME_AUDIO__ || []).map(a => !!a.__routed)")
    page.evaluate("() => { for (const el of document.querySelectorAll('div')) if (el.textContent === 'CLICK TO LOOK AROUND') el.style.visibility = 'hidden'; }")
    tgt = page.evaluate(PLACE, {"skip": [], "hp": 100, "shield": 100, "d": 9, "aimY": 1.15})
    P["target"] = tgt
    page.evaluate("""() => { const W = window.__LC__.W, p = W.player;
        p.inventory.slots[1] = { kind: 'weapon', id: 'smg', rarity: 2, mag: 30 }; p.inventory.ammo.light = 999; W.equipSlot(p, 1); }""")
    page.wait_for_timeout(900)
    page.evaluate("() => { window.__DOMLOG__.length = 0; window.__DUCK__ = 0; window.__t0 = performance.now(); window.__w0 = window.__LC__.W.t; window.__LC__.W._lmbDown = true; }")
    page.wait_for_timeout(1200)
    shot(page, "50_smg_sustained.png")
    page.evaluate("() => { window.__LC__.W._lmbDown = false; }")
    P["smg"] = page.evaluate("""() => { const L = window.__DOMLOG__, W = window.__LC__.W, b = W.actorById.get('%s');
        const live = document.querySelectorAll('div[style*="will-change: transform, opacity"]');
        let liveNums = 0; for (const e of live) if (/^\\d/.test(e.textContent)) liveNums++;
        return { wallMs: Math.round(performance.now() - window.__t0), simS: +(W.t - window.__w0).toFixed(2), dmgnums: L.filter(e => e.k === 'dmgnum').length,
                 markerShows: L.filter(e => e.k === 'hitmark' && e.op === '1').length, duckCalls: window.__DUCK__, liveNumsAtEnd: liveNums,
                 nums: L.filter(e => e.k === 'dmgnum').map(e => e.txt + ':' + e.color).slice(0, 30), mag: W.player.weapon.magAmmo, tgtShield: b.shield, tgtHp: b.hp }; }""" % tgt["id"])
    # headshot: aim the target so the ray crosses the head band
    tgt2 = page.evaluate(PLACE, {"skip": [tgt["id"]], "hp": 100, "shield": 0, "d": 9, "aimY": 1.62})
    P["target_head"] = tgt2
    page.evaluate("""(id) => { const W = window.__LC__.W, p = W.player; window.__h2 = [];
        W.events.on('actorHurt', (v, info) => { if (v.id === id) window.__h2.push({ dmg: info.dmg, head: !!info.isHead }); });
        p.inventory.slots[2] = { kind: 'weapon', id: 'sniper', rarity: 3, mag: 5 }; p.inventory.ammo.heavy = 99; W.equipSlot(p, 2); }""", tgt2["id"])
    page.wait_for_timeout(1500)
    page.evaluate("() => { window.__DOMLOG__.length = 0; window.__t0 = performance.now(); window.__LC__.W._fireEdge = performance.now(); }")
    page.wait_for_timeout(40)
    shot(page, "51_sniper_hit.png")
    P["sniper"] = page.evaluate("() => ({ hurt: window.__h2, log: window.__DOMLOG__.map(e => Object.assign({}, e, { t: Math.round(e.t - window.__t0) })) })")
    json.dump(P, open(os.path.join(OUT, "probes4.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(json.dumps(P, indent=1, ensure_ascii=True)[:5000])
    br.close()
