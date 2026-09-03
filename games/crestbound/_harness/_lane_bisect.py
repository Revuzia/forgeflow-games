"""Same-frame bisect of the merged hero material against the original per-part
meshes. One frozen frame in verdant-1; each variant mutates ONE property of the
merged material and re-renders. The variant whose head ratio jumps to ~1.00 is
the property that is wrong."""
import os, time
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
  const p=h.root.position; cam.position.set(p.x+1.4, p.y+1.35, p.z+1.7);
  cam.lookAt(p.x, p.y+0.95, p.z); cam.updateMatrixWorld(true);
  const m=h._body.material; globalThis.__orig={sheen:m.sheen, cc:m.clearcoat, ccMap:m.clearcoatMap,
    nMap:m.normalMap, map:m.map, shrMap:m.sheenRoughnessMap, shcMap:m.sheenColorMap, spec:m.specularIntensity};
  return true; }"""
DRAW=r"""() => { globalThis.CRESTBOUND.engine.render(0); return true; }"""
MODE=r"""(mode) => { const h=globalThis.CRESTBOUND.game.hero;
  const on=(mode==='parts'), none=(mode==='none');
  h.root.traverse(o=>{ if(o.isMesh||o.isSkinnedMesh){
    if(none) o.visible=false;
    else if(o.name==='nim.body') o.visible=!on;
    else if(o.name && o.name.indexOf('nim.')===0 && o.name!=='nim.goggleLens') o.visible=on; }});
  h.shadowBlob && h.shadowBlob.setVisible && h.shadowBlob.setVisible(!none);
  /* the ORIGINAL scarf mesh no longer receives vertices, so 'parts' has no
     scarf; collapse the MERGED scarf too, or its bloom lands on the body and
     the comparison measures the scarf instead of the material. */
  if (h._scarfRange && h._body) { const a=h._body.geometry.attributes.position;
    a.array.fill(0, h._scarfRange.pos, h._scarfRange.pos + h._scarfRange.count);
    a.updateRanges.length = 0; a.needsUpdate = true; }
  return true; }"""
VAR=r"""(v) => { const m=globalThis.CRESTBOUND.game.hero._body.material, O=globalThis.__orig;
  m.sheen=O.sheen; m.clearcoat=O.cc; m.clearcoatMap=O.ccMap; m.normalMap=O.nMap; m.map=O.map;
  m.sheenRoughnessMap=O.shrMap; m.sheenColorMap=O.shcMap; m.specularIntensity=O.spec;
  if(v==='nosheen') m.sheen=0;
  if(v==='nocc'){ m.clearcoat=0; m.clearcoatMap=null; }
  if(v==='nonormal') m.normalMap=null;
  if(v==='nomap') m.map=null;
  if(v==='flatcolor') m.map=null;
  if(v==='noshr') m.sheenRoughnessMap=null;
  for (const t of [m.map, m.normalMap, m.roughnessMap]) { if(!t) continue;
    t.anisotropy = (v==='aniso1') ? 1 : (v==='aniso16' ? 16 : 4);
    t.minFilter = (v==='nomip') ? 1006 /*LinearFilter*/ : 1008 /*LinearMipmapLinearFilter*/;
    t.generateMipmaps = (v!=='nomip'); t.needsUpdate = true; }
  m.needsUpdate=true; return v; }"""
BOX=(390,250,530,400)
def mean(f,bx=BOX):
    a=np.asarray(Image.open(f).convert('RGB'),dtype=float)
    return a[bx[1]:bx[3],bx[0]:bx[2]].reshape(-1,3).mean()
with sync_playwright() as p:
    br=p.chromium.launch(channel="chrome",headless=True,args=FLAGS)
    pg=br.new_page(viewport={"width":900,"height":900})
    pg.add_init_script("globalThis.CB_KEEP_PARTS = true; globalThis.CB_NO_MATX = %s;" % ("true" if os.environ.get("CB_NO_MATX") else "false"))
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
    pg.evaluate(MODE,'none')
    for _ in range(3): pg.evaluate(DRAW); pg.wait_for_timeout(50)
    pg.screenshot(path="_shots/_bis_none.png")
    pg.evaluate(MODE,'parts')
    for _ in range(3): pg.evaluate(DRAW); pg.wait_for_timeout(50)
    pg.screenshot(path="_shots/_bis_parts.png")
    base=mean("_shots/_bis_parts.png")
    pg.evaluate(MODE,'merged')
    for v in ('base','nomap','aniso1','aniso16','nomip','flatcolor'):
        pg.evaluate(VAR,v)
        for _ in range(3): pg.evaluate(DRAW); pg.wait_for_timeout(60)
        f="_shots/_bis_%s.png"%v; pg.screenshot(path=f)
        print("%-9s head %.2f   ratio vs parts %.4f" % (v, mean(f), mean(f)/base))
    print("parts head %.2f"%base)
    br.close()
