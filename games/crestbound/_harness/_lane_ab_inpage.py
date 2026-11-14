"""Same-frame A/B of the merged hero material: patched (per-part env/spec via
aMatX) vs the plain uniform material. Nothing in the scene moves between the
two shots, so any difference is the material."""
import time, io, sys
from playwright.sync_api import sync_playwright
FLAGS=["--ignore-gpu-blocklist","--use-angle=d3d11","--disable-gpu-sandbox","--enable-gpu-rasterization",
       "--disable-features=CalculateNativeWinOcclusion","--autoplay-policy=no-user-gesture-required"]
CLICK=r"""() => {const w=['CONTINUE','KEEP MY PROGRESS','NEW GAME','NEW RUN','PLAY','START','BEGIN','ENTER'];
 for(const q of w) for(const b of Array.from(document.querySelectorAll('button'))){
  if((b.textContent||'').toUpperCase().indexOf(q)<0) continue; const r=b.getBoundingClientRect();
  if(b.disabled||r.width<4) continue; if(b.__activate)b.__activate(); else b.click(); return q;} return null;}"""
FREEZE=r"""() => { const A=globalThis.CRESTBOUND, g=A.game, h=g.hero;
  g.__abHold = true;
  // park the camera close in front of Nim and stop the sim
  A.engine.stop && A.engine.stop();
  return {merged: !!h._body, env: h._body?h._body.material.envMapIntensity:null}; }"""
STEP=r"""() => { const A=globalThis.CRESTBOUND; A.engine.render(1/60); return true; }"""
PATCHOFF=r"""() => { const m = globalThis.CRESTBOUND.game.hero._body.material;
  m.onBeforeCompile = function(){}; m.customProgramCacheKey = function(){ return 'cb-nim-plain'; };
  m.envMapIntensity = 0.5047996456892189; m.specularIntensity = 0.39033575164501444;
  m.needsUpdate = true; return true; }"""
with sync_playwright() as p:
    br=p.chromium.launch(channel="chrome",headless=True,args=FLAGS)
    pg=br.new_page(viewport={"width":900,"height":900})
    pg.goto("http://localhost:8788/games/crestbound/index.html?dev=1&quality=high",wait_until="load",timeout=60000)
    dl=time.time()+60
    while time.time()<dl:
        if pg.evaluate("!!(globalThis.CRESTBOUND&&CRESTBOUND.game)"):break
        pg.wait_for_timeout(300)
    dl=time.time()+60
    while time.time()<dl:
        if pg.evaluate("CRESTBOUND.game.state") in ("keep","playing"):break
        pg.evaluate(CLICK); pg.wait_for_timeout(400)
    pg.wait_for_timeout(2500)
    print(pg.evaluate(FREEZE))
    for _ in range(4): pg.evaluate(STEP); pg.wait_for_timeout(60)
    pg.screenshot(path="_shots/_ab_inpage_patched.png")
    pg.evaluate(PATCHOFF)
    for _ in range(6): pg.evaluate(STEP); pg.wait_for_timeout(60)
    pg.screenshot(path="_shots/_ab_inpage_plain.png")
    br.close()
print("ok")
