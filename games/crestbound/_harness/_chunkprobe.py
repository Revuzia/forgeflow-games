import os, sys, time, json
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
BASE = "http://localhost:8788/games/crestbound/index.html"
F = ["--disable-gpu-vsync", "--disable-frame-rate-limit", "--ignore-gpu-blocklist", "--use-angle=d3d11",
     "--disable-gpu-sandbox", "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
     "--autoplay-policy=no-user-gesture-required"]
CLICK = """() => { const w=['CONTINUE','NEW GAME','PLAY','START','ENTER'];
 for(const q of w) for(const b of document.querySelectorAll('button,[role=button],.btn')){
  const r=b.getBoundingClientRect(); if(b.disabled||r.width<4)continue;
  if((b.textContent||'').toUpperCase().indexOf(q)<0)continue;
  if(typeof b.__activate==='function')b.__activate();else b.click(); return q;} return null;}"""
LOAD = """async (id)=>{const G=globalThis.CRESTBOUND.game;const t0=performance.now();
 const live=()=>G.course&&G.courseId===id&&(G.state==='playing'||G.state==='keep');
 await G.__dev.goto(id);
 const tick=()=>new Promise(r=>{let d=false;const f=()=>{if(!d){d=true;r();}};requestAnimationFrame(f);setTimeout(f,60);});
 const dl=t0+30000; while(performance.now()<dl&&!live())await tick();
 return live()?{loadMs:+(performance.now()-t0).toFixed(1)}:{error:'no'};}"""
SCAN = """() => {
  const C = globalThis.CRESTBOUND.game.course;
  const out = {basic: [], byUuid: {}, critters: [], hazards: []};
  C.group.traverse(o => {
    if (!o.isMesh) return;
    let inChunk = false, n = o;
    while (n) { if (/^chunk /.test(n.name || '')) { inChunk = true; break; } n = n.parent; }
    if (!inChunk) return;
    const m = o.material;
    if (!m || Array.isArray(m) || m.name) return;
    out.byUuid[m.uuid] = (out.byUuid[m.uuid] || 0) + 1;
    if (out.basic.length < 14) out.basic.push({
      type: m.type, color: m.color ? m.color.getHexString() : '',
      ud: JSON.stringify(o.userData), tr: !!m.transparent, blend: m.blending,
      geo: Object.keys(o.geometry.attributes).join(','),
      chain: (() => { let a = [], k = o; while (k && a.length < 5) { a.push(k.name || k.type); k = k.parent; } return a.join('<'); })(),
    });
  });
  (C.critters || []).forEach(r => {
    const c = r.c || r.critter || r;
    const root = c && (c.mesh || c.root || c.group);
    if (!root || !root.traverse) return;
    let n = 0; const mats = {};
    root.traverse(o => { if (o.isMesh) { n++; const m = o.material; const k = (m && (m.name || m.type)) || '?'; mats[k] = (mats[k] || 0) + 1; } });
    out.critters.push({kind: r.kind || (c && c.kind), meshes: n, mats});
  });
  (C.hazards || []).forEach(r => {
    const root = r.h && r.h.mesh;
    if (!root || !root.traverse) return;
    let n = 0; const mats = {};
    root.traverse(o => { if (o.isMesh) { n++; const m = o.material; const k = (m && (m.name || m.type)) || '?'; mats[k] = (mats[k] || 0) + 1; } });
    out.hazards.push({kind: r.kind, meshes: n, mats});
  });
  out.distinctBasics = Object.keys(out.byUuid).length;
  out.totalBasicMeshes = Object.values(out.byUuid).reduce((a, b) => a + b, 0);
  delete out.byUuid;
  return out;
}"""
with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome", headless=True, args=F)
    pg = br.new_page(viewport={"width": 1920, "height": 1080})
    pg.goto(BASE + "?dev=1&quality=high", wait_until="load", timeout=60000)
    dl = time.time() + 70
    while time.time() < dl:
        if pg.evaluate("!!(globalThis.CRESTBOUND&&CRESTBOUND.game)"): break
        pg.wait_for_timeout(300)
    dl = time.time() + 90
    while time.time() < dl:
        if pg.evaluate("CRESTBOUND.game.state") in ("keep", "playing"): break
        pg.evaluate(CLICK); pg.wait_for_timeout(400)
    for cid in (sys.argv[1:] or ["verdant-1"]):
        print("###", cid, pg.evaluate(LOAD, cid))
        r = pg.evaluate(SCAN)
        print("  in-chunk unnamed-material meshes:", r["totalBasicMeshes"], "distinct materials:", r["distinctBasics"])
        for b in r["basic"]: print("   ", b)
        print("  --- critters ---")
        for c in r["critters"]: print("   ", c)
        print("  --- hazards ---")
        for h in r["hazards"]: print("   ", h)
    br.close()
