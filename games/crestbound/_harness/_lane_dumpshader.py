import json,time,io,os
from playwright.sync_api import sync_playwright
FLAGS=["--ignore-gpu-blocklist","--use-angle=d3d11","--disable-gpu-sandbox","--enable-gpu-rasterization",
       "--disable-features=CalculateNativeWinOcclusion","--autoplay-policy=no-user-gesture-required"]
JS=r"""() => {
 const r=globalThis.CRESTBOUND.engine.renderer, gl=r.getContext();
 for(const pr of r.info.programs||[]){ if(String(pr.cacheKey||'').indexOf('cb-nim-body-matx')<0) continue;
   return {vs: gl.getShaderSource(pr.vertexShader), fs: gl.getShaderSource(pr.fragmentShader)}; }
 return null; }"""
CLICK=r"""() => {const w=['CONTINUE','KEEP MY PROGRESS','NEW GAME','NEW RUN','PLAY','START','BEGIN','ENTER'];
 for(const q of w) for(const b of Array.from(document.querySelectorAll('button'))){
  if((b.textContent||'').toUpperCase().indexOf(q)<0) continue; const r=b.getBoundingClientRect();
  if(b.disabled||r.width<4) continue; if(b.__activate)b.__activate(); else b.click(); return q;} return null;}"""
with sync_playwright() as p:
    br=p.chromium.launch(channel="chrome",headless=True,args=FLAGS)
    pg=br.new_page(viewport={"width":1280,"height":720})
    pg.goto("http://localhost:8788/games/crestbound/index.html?dev=1&quality=high",wait_until="load",timeout=60000)
    dl=time.time()+60
    while time.time()<dl:
        if pg.evaluate("!!(globalThis.CRESTBOUND&&CRESTBOUND.game)"):break
        pg.wait_for_timeout(300)
    dl=time.time()+60
    while time.time()<dl:
        if pg.evaluate("CRESTBOUND.game.state") in ("keep","playing"):break
        pg.evaluate(CLICK); pg.wait_for_timeout(400)
    pg.wait_for_timeout(1500)
    d=pg.evaluate(JS)
    io.open('_harness/_dump_vs.glsl','w',encoding='utf-8').write(d['vs'])
    io.open('_harness/_dump_fs.glsl','w',encoding='utf-8').write(d['fs'])
    print('dumped', len(d['vs']), len(d['fs']))
    br.close()
