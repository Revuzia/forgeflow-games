"""Pure-albedo A/B: force every hero material (merged and per-part) to output
`diffuseColor.rgb` straight to the framebuffer, then render the same frozen
frame both ways. Any difference is the ALBEDO path (vertex colour x atlas tile
vs material colour x detail map) with lighting taken out of the picture."""
import sys, time
from PIL import Image
import numpy as np
from playwright.sync_api import sync_playwright
CH  = sys.argv[1] if len(sys.argv) > 1 else 'diffuseColor.rgb'
TAG = sys.argv[2] if len(sys.argv) > 2 else 'alb'
CHM = sys.argv[3] if len(sys.argv) > 3 else None
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
  // flat-albedo output on every hero material
  const seen=new Set(); let n=0;
  h.root.traverse(o=>{ if(!(o.isMesh||o.isSkinnedMesh)) return;
    const ms = Array.isArray(o.material)?o.material:[o.material];
    for(const m of ms){ if(!m||seen.has(m.uuid)) continue; seen.add(m.uuid); n++;
      const prev = m.onBeforeCompile;
      m.onBeforeCompile = function(sh, r){ if(prev) prev.call(this, sh, r);
        sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>',
          'gl_FragColor = vec4( ' + ((m.name==='nim.body' && globalThis.__CHM) ? globalThis.__CHM : globalThis.__CH) + ', 1.0 );'); };
      m.customProgramCacheKey = function(){ return 'cb-albedo-'+m.uuid; };
      m.needsUpdate = true; } });
  // collapse the merged scarf so both modes match
  if (h._scarfRange && h._body) { const a=h._body.geometry.attributes.position;
    a.array.fill(0, h._scarfRange.pos, h._scarfRange.pos + h._scarfRange.count);
    a.updateRanges.length=0; a.needsUpdate=true; }
  return n; }"""
DRAW=r"""() => { globalThis.CRESTBOUND.engine.render(0); return true; }"""
MODE=r"""(mode) => { const h=globalThis.CRESTBOUND.game.hero;
  const on=(mode==='parts'), none=(mode==='none');
  h.root.traverse(o=>{ if(o.isMesh||o.isSkinnedMesh){
    if(none) o.visible=false;
    else if(o.name==='nim.body') o.visible=!on;
    else if(o.name && o.name.indexOf('nim.')===0 && o.name!=='nim.goggleLens') o.visible=on; }});
  h.shadowBlob && h.shadowBlob.setVisible && h.shadowBlob.setVisible(false);
  return true; }"""
with sync_playwright() as p:
    br=p.chromium.launch(channel="chrome",headless=True,args=FLAGS)
    pg=br.new_page(viewport={"width":900,"height":900})
    pg.add_init_script("globalThis.CB_KEEP_PARTS = true; globalThis.__CH = %s; globalThis.__CHM = %s;" % (repr(CH).replace("'", '"'), repr(CHM).replace("'", '"') if CHM else 'null'))
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
    print('materials patched:', pg.evaluate(SETUP))
    for mode in ('none','parts','merged'):
        pg.evaluate(MODE, mode)
        for _ in range(3): pg.evaluate(DRAW); pg.wait_for_timeout(60)
        pg.screenshot(path="_shots/_%s_%s.png" % (TAG, mode))
    br.close()
def L(f): return np.asarray(Image.open(f).convert('RGB'),dtype=float)
BG=L('_shots/_%s_none.png'%TAG); P=L('_shots/_%s_parts.png'%TAG); M=L('_shots/_%s_merged.png'%TAG)
mp=(np.abs(P-BG).mean(axis=2)>8); mb=(np.abs(M-BG).mean(axis=2)>8); mask=mp&mb
print('mask %d  parts %.2f  merged %.2f  ratio %.4f'%(mask.sum(), P[mask].mean(), M[mask].mean(), M[mask].mean()/P[mask].mean()))
for c,nm in enumerate('RGB'):
    print('  %s parts %.2f merged %.2f ratio %.4f'%(nm, P[:,:,c][mask].mean(), M[:,:,c][mask].mean(), M[:,:,c][mask].mean()/P[:,:,c][mask].mean()))
Image.fromarray(np.clip(128+(M-P).mean(axis=2)*4,0,255).astype('uint8')).save('_shots/_%s_diff.png'%TAG)
