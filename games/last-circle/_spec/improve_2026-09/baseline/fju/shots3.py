"""feel-juice-ui lane, pass 3: a real hit + kill on a pinned bot (isDummy routes the hit through
hurtActor offline; cleared for the kill), reticle DOM probe, damage-number DOM probe. Read-only."""
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
      if (n.nodeType === 1 && n.style && n.style.willChange === 'transform, opacity' && /^\d/.test(n.textContent)) window.__DOMLOG__.push({ t: performance.now(), k: 'dmgnum', txt: n.textContent, color: n.style.color, fs: n.style.fontSize });
    }
    if (m.type === 'attributes' && m.target.textContent === '✕') window.__DOMLOG__.push({ t: performance.now(), k: 'hitmark', op: m.target.style.opacity, color: m.target.style.color, fs: m.target.style.fontSize });
  }
}).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
"""

PLACE = r"""(args) => { const W = window.__LC__.W, p = W.player, cam = W.camera;
  const dir = new cam.position.constructor(); cam.getWorldDirection(dir);
  const d = args.d; const x = cam.position.x + dir.x * d, z = cam.position.z + dir.z * d, y = cam.position.y + dir.y * d;
  const bot = W.actors.find(a => a !== p && a.alive && !args.skip.includes(a.id));
  bot.isDummy = true; bot.netRemote = true; bot.gliding = false; bot.vel.set(0,0,0);
  const g = W.map.heightAt(x, z);
  bot.pos.set(x, Math.max(g, y - 1.15), z); bot.obj.position.copy(bot.pos);
  bot.yaw = p.yaw + Math.PI; bot.obj.rotation.y = bot.yaw;
  bot.hp = args.hp; bot.shield = args.shield;
  return { id: bot.id, name: bot.name, d, groundGap: +(bot.pos.y - g).toFixed(2) };
}"""

def shot(page, name, **kw):
    page.screenshot(path=os.path.join(OUT, name), **kw)
    print("shot", name, flush=True)

with sync_playwright() as pw:
    br = pw.chromium.launch(headless=True, args=["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"])
    page = br.new_context(viewport={"width": 1280, "height": 720}).new_page()
    page.add_init_script(DOM_SPY)
    page.goto(URL)
    page.wait_for_function("() => !!window.__LC__", timeout=90000)
    page.wait_for_timeout(1000)
    try: page.get_by_text("GOT IT").first.click(timeout=3000)
    except Exception: pass
    page.evaluate("() => { window.__LC__.startMatch({mode:'standard', seed: 4242, mapId: 'ashgrid'}); }")
    page.wait_for_function("() => { const W = window.__LC__.W; return W.phase === 'drop' || W.phase === 'match'; }", timeout=120000)
    page.wait_for_timeout(500)
    P["landing"] = page.evaluate("""() => { const L = window.__LC__, W = L.W;
        for (let i = 0; i < 200 && (W.player.gliding || !W.player.onGround); i++) L.fastForward(0.25, 1/30);
        W.player.hp = 100; return { phase: W.phase, onGround: W.player.onGround, t: +W.t.toFixed(1), map: W.mapId }; }""")
    page.wait_for_timeout(700)
    page.evaluate("() => { for (const el of document.querySelectorAll('div')) if (el.textContent === 'CLICK TO LOOK AROUND') el.style.visibility = 'hidden'; }")
    P["reticle"] = page.evaluate("""() => { const out = []; for (const el of document.querySelectorAll('div')) { const s = el.style;
        if (s.width === '56px' && s.height === '56px' && s.top === '50%') { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
          out.push({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), display: cs.display, vis: cs.visibility, op: cs.opacity, kids: el.children.length, transform: s.transform, kidBg: el.children[0] ? el.children[0].style.background : null, z: cs.zIndex }); } }
        return out; }""")
    tgt = page.evaluate(PLACE, {"skip": [], "hp": 100, "shield": 50, "d": 11})
    P["target"] = tgt
    page.wait_for_timeout(400)
    shot(page, "40_target.png")
    page.evaluate("""(id) => { window.__hurt = []; const W = window.__LC__.W;
        W.events.on('actorHurt', (v, info) => { if (v.id === id) window.__hurt.push({ dmg: info.dmg, toShield: info.toShield, head: !!info.isHead, broke: !!info.broke }); });
        W.events.on('actorDied', (v) => { if (v.id === id) window.__hurt.push({ died: true }); });
        window.__DOMLOG__.length = 0; window.__shotT = performance.now(); W._fireEdge = performance.now(); }""", tgt["id"])
    page.wait_for_timeout(30)
    shot(page, "41_hit_t30.png")
    page.wait_for_timeout(170)
    shot(page, "42_hit_t200.png")
    page.wait_for_timeout(500)
    shot(page, "43_hit_t700.png")
    P["hurt_1"] = page.evaluate("() => window.__hurt")
    for i in range(3):
        page.evaluate("() => { window.__LC__.W._fireEdge = performance.now(); }")
        page.wait_for_timeout(420)
    shot(page, "44_pistol_x4.png")
    P["hurt_4"] = page.evaluate("() => window.__hurt")
    page.evaluate("(id) => { const W = window.__LC__.W, b = W.actorById.get(id); b.isDummy = false; b.netRemote = false; b.hp = 5; b.shield = 0; window.__killT = performance.now(); W._fireEdge = performance.now(); }", tgt["id"])
    page.wait_for_timeout(30)
    shot(page, "45_kill_t30.png")
    page.wait_for_timeout(170)
    shot(page, "46_kill_t200.png")
    page.wait_for_timeout(600)
    shot(page, "47_kill_t800.png")
    page.wait_for_timeout(1200)
    shot(page, "48_kill_t2000.png")
    P["hurt_kill"] = page.evaluate("() => window.__hurt")
    P["domlog"] = page.evaluate("() => window.__DOMLOG__.map(e => Object.assign({}, e, { t: Math.round(e.t - window.__shotT) }))")
    # SMG sustained vs a shielded dummy: number spam + stacking
    tgt2 = page.evaluate(PLACE, {"skip": [tgt["id"]], "hp": 100, "shield": 100, "d": 9})
    P["target2"] = tgt2
    page.evaluate("""() => { const W = window.__LC__.W, p = W.player;
        p.inventory.slots[1] = { kind: 'weapon', id: 'smg', rarity: 2, mag: 30 }; p.inventory.ammo.light = 999; W.equipSlot(p, 1); }""")
    page.wait_for_timeout(700)
    page.evaluate("() => { window.__DOMLOG__.length = 0; window.__shotT = performance.now(); window.__LC__.W.player.input.fire = true; }")
    page.wait_for_timeout(1000)
    shot(page, "49_smg_1s.png")
    page.evaluate("() => { window.__LC__.W.player.input.fire = false; }")
    P["smg_domlog"] = page.evaluate("() => { const L = window.__DOMLOG__; return { dmgnums: L.filter(e => e.k === 'dmgnum').length, marks: L.filter(e => e.k === 'hitmark' && e.op === '1').length, first: L.slice(0, 12).map(e => Object.assign({}, e, { t: Math.round(e.t - window.__shotT) })) }; }")
    json.dump(P, open(os.path.join(OUT, "probes3.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(json.dumps(P, indent=1, ensure_ascii=True)[:5000])
    br.close()
