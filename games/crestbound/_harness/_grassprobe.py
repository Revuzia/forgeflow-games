import json, sys, time
from playwright.sync_api import sync_playwright
FLAGS=["--ignore-gpu-blocklist","--use-angle=d3d11","--disable-gpu-sandbox",
 "--enable-gpu-rasterization","--disable-features=CalculateNativeWinOcclusion",
 "--autoplay-policy=no-user-gesture-required","--force-device-scale-factor=1"]
JS=r"""()=>{const A=globalThis.CRESTBOUND,G=A.game,THREE=A.THREE;
let out=[];G.engine.scene.traverse(o=>{if(o.isInstancedMesh&&/grass/i.test(o.name||'')){
 const g=o.geometry;g.computeBoundingBox();const bb=g.boundingBox;
 const m=new THREE.Matrix4(),p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();
 let smin=1e9,smax=-1e9,sy=0,n=Math.min(o.count,400);
 for(let i=0;i<n;i++){o.getMatrixAt(i,m);m.decompose(p,q,s);smin=Math.min(smin,s.y);smax=Math.max(smax,s.y);sy+=s.y;}
 out.push({name:o.name,count:o.count,geoH:+(bb.max.y-bb.min.y).toFixed(4),
  geoW:+(bb.max.x-bb.min.x).toFixed(4),parentScale:+o.scale.y.toFixed(3),
  instScaleY:{min:+smin.toFixed(3),max:+smax.toFixed(3),avg:+(sy/n).toFixed(3)},
  worldBladeH:+((bb.max.y-bb.min.y)*(sy/n)*o.scale.y).toFixed(3)});}});
return {grass:out, heroH:1.5};}"""
with sync_playwright() as p:
    br=p.chromium.launch(channel="chrome",headless=True,args=FLAGS)
    pg=br.new_page(viewport={"width":800,"height":600})
    pg.goto("http://localhost:8788/games/crestbound/index.html?dev=1&course=verdant-1",wait_until="load",timeout=60000)
    dl=time.time()+60
    while time.time()<dl:
        try:
            if pg.evaluate("!!(globalThis.CRESTBOUND&&CRESTBOUND.game&&CRESTBOUND.game.hero)"): break
        except Exception: pass
        pg.wait_for_timeout(400)
    dl=time.time()+60
    while time.time()<dl:
        st=pg.evaluate("CRESTBOUND.game.state")
        if st in ("keep","playing"): break
        pg.evaluate("""()=>{for(const b of document.querySelectorAll('button')){const t=(b.textContent||'').toUpperCase();
          if(/NEW GAME|CONTINUE|PLAY|START|BEGIN|ENTER/.test(t)){if(b.__activate)b.__activate();else b.click();return;}}}""")
        pg.wait_for_timeout(400)
    pg.wait_for_timeout(2500)
    print(json.dumps(pg.evaluate(JS),indent=2))
    br.close()
