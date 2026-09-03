"""Final controlled A/B, front camera, one frozen verdant-1 frame:
   none  | parts (original per-part meshes) | merged with per-part env/spec
   | merged with the vertex-weighted MEAN env/spec."""
import time
from PIL import Image
import numpy as np
from playwright.sync_api import sync_playwright
FLAGS=["--ignore-gpu-blocklist","--use-angle=d3d11","--disable-gpu-sandbox","--enable-gpu-rasterization",
       "--disable-features=CalculateNativeWinOcclusion","--autoplay-policy=no-user-gesture-required"]
CLICK=r"""() => {const w=['CONTINUE','KEEP MY PROGRESS','NEW GAME','NEW RUN','PLAY','START','BEGIN','ENTER'];
 for(const q of w) for(const b of Array.from(document.querySelectorAll('button'))){
  if((b.textContent||'').toUpperCase().indexOf(q)<0) continue; const r=b.getBoundingClientRect();
  if(b.disabled||r.width<4) continue; if(b.__activate)b.__activate(); else b.click(); return q;} return null;}"""
SETUP=r"""async () => { const A=globalThis.CRESTBOUND, g=A.game;
  await g.__dev.goto('verdant-1');
  for(let i=0;i<120;i++) await new Promise(r=>requestAnimationFrame(r));
  const h=g.hero, cam=A.engine.camera; A.engine.stop && A.engine.stop();
  const p=h.root.position;
  cam.position.set(p.x-0.35, p.y+1.20, p.z-2.05);   // in FRONT of Nim (he faces -Z)
  cam.lookAt(p.x, p.y+1.05, p.z); cam.updateMatrixWorld(true);
  if (h._scarfRange && h._body) { const a=h._body.geometry.attributes.position;
    a.array.fill(0, h._scarfRange.pos, h._scarfRange.pos + h._scarfRange.count);
    a.updateRanges.length=0; a.needsUpdate=true; }
  const m=h._body.material;
  globalThis.__mx = { obc: m.onBeforeCompile, key: m.customProgramCacheKey };
  return true; }"""
DRAW=r"""() => { globalThis.CRESTBOUND.engine.render(0); return true; }"""
MODE=r"""(mode) => { const h=globalThis.CRESTBOUND.game.hero;
  const on=(mode==='parts'), none=(mode==='none');
  h.root.traverse(o=>{ if(o.isMesh||o.isSkinnedMesh){
    if(none) o.visible=false;
    else if(o.name==='nim.body') o.visible=!on;
    else if(o.name && o.name.indexOf('nim.')===0 && o.name!=='nim.goggleLens') o.visible=on; }});
  h.shadowBlob && h.shadowBlob.setVisible && h.shadowBlob.setVisible(false);
  const m=h._body.material;
  return true; }"""
with sync_playwright() as p:
    br=p.chromium.launch(channel="chrome",headless=True,args=FLAGS)
    pg=br.new_page(viewport={"width":900,"height":900})
    pg.add_init_script("globalThis.CB_KEEP_PARTS = true;")
    pg.goto("http://localhost:8788/games/crestbound/index.html?dev=1&quality=high",wait_until="load",timeout=60000)
    dl=time.time()+60
    while time.time()<dl:
        if pg.evaluate("!!(globalThis.CRESTBOUND&&CRESTBOUND.game)"):break
        pg.wait_for_timeout(300)
    dl=time.time()+60
    while time.time()<dl:
        if pg.evaluate("CRESTBOUND.game.state") in ("keep","playing"):break
        pg.evaluate(CLICK); pg.wait_for_timeout(400)
    pg.wait_for_timeout(1200); pg.evaluate(SETUP)
    for mode in ('none','parts','mean'):
        pg.evaluate(MODE, mode)
        for _ in range(4): pg.evaluate(DRAW); pg.wait_for_timeout(60)
        pg.screenshot(path="_shots/_fab_%s.png"%mode)
    br.close()
def L(f): return np.asarray(Image.open(f).convert('RGB'),dtype=float)
BG=L('_shots/_fab_none.png'); P=L('_shots/_fab_parts.png')
mp=(np.abs(P-BG).mean(axis=2)>8)
for nm in ('mean',):
    A=L('_shots/_fab_%s.png'%nm); mb=(np.abs(A-BG).mean(axis=2)>8); mask=mp&mb
    r=A[mask].mean()/P[mask].mean()
    per=(A[mask]/np.maximum(P[mask],1))
    print('%-5s whole-body ratio %.4f  (p10 %.3f p50 %.3f p90 %.3f)  n=%d'%(nm,r,np.percentile(per,10),np.percentile(per,50),np.percentile(per,90),mask.sum()))
