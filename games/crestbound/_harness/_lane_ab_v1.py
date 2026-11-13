"""Same-frame A/B in verdant-1: the MERGED skinned body vs the ORIGINAL per-part
meshes, both alive in the same scene, toggled between two renders of the SAME
frame. Nothing else changes, so any difference is the consolidation itself."""
import time
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
  const h=g.hero, cam=A.engine.camera;
  A.engine.stop && A.engine.stop();
  // park the camera 2.2 m in front of Nim, slightly above, looking at his chest
  const p=h.root.position;
  cam.position.set(p.x+1.4, p.y+1.35, p.z+1.7);
  cam.lookAt(p.x, p.y+0.95, p.z);
  cam.updateMatrixWorld(true);
  g.__abFrozen = true;
  return {parts:h._meshes.length, hidden:h._body?1:0}; }"""
DRAW=r"""() => { const A=globalThis.CRESTBOUND, e=A.engine;
  const cam=e.camera; const q=cam.position.clone(); e.render(0); return true; }"""
MODE=r"""(mode) => { const h=globalThis.CRESTBOUND.game.hero;
  const on = (mode==='parts');
  h.root.traverse(o=>{ if(o.isMesh||o.isSkinnedMesh){
     if(o.name==='nim.body') o.visible = !on;
     else if(o.name && o.name.indexOf('nim.')===0 && o.name!=='nim.goggleLens' && o.name!=='nim.wingMeshR' && o.name!=='nim.wingMeshL') o.visible = on;
  }});
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
    pg.wait_for_timeout(1200)
    print(pg.evaluate(SETUP))
    for mode in ("merged","parts"):
        pg.evaluate(MODE, mode)
        for _ in range(3): pg.evaluate(DRAW); pg.wait_for_timeout(50)
        pg.screenshot(path="_shots/_ab_v1_%s.png" % mode)
    br.close()
print("ok")
