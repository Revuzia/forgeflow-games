import sys, time, json
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
BASE="http://localhost:8788/games/crestbound/index.html"
FLAGS=["--ignore-gpu-blocklist","--use-angle=d3d11","--disable-gpu-sandbox",
 "--enable-gpu-rasterization","--disable-features=CalculateNativeWinOcclusion",
 "--autoplay-policy=no-user-gesture-required","--force-device-scale-factor=1"]
CLICK=r"""() => { const w=['CONTINUE','KEEP MY PROGRESS','NEW GAME','PLAY','START','ENTER'];
 for(const q of w) for(const b of document.querySelectorAll('button,[role=button],.btn')){
  const r=b.getBoundingClientRect(); if(b.disabled||r.width<4)continue;
  if((b.textContent||'').toUpperCase().indexOf(q)<0)continue;
  if(typeof b.__activate==='function')b.__activate();else b.click(); return q;} return null;}"""
LOAD=r"""async (id)=>{const G=globalThis.CRESTBOUND.game;const t0=performance.now();
 const live=()=>G.course&&G.courseId===id&&(G.state==='playing'||G.state==='keep');
 await G.__dev.goto(id);
 const tick=()=>new Promise(r=>{let d=false;const f=()=>{if(!d){d=true;r();}};requestAnimationFrame(f);setTimeout(f,60);});
 const dl=t0+30000; while(performance.now()<dl&&!live())await tick();
 return live()?{ok:1}:{error:'no'};}"""
RAY=r"""(pts)=>{
  const A=globalThis.CRESTBOUND, T=A.THREE, cam=A.engine.camera, sc=A.engine.scene;
  const rc=new T.Raycaster(); const out=[];
  for(const pt of pts){
    const nd=new T.Vector2(pt[0]*2-1, -(pt[1]*2-1));
    rc.setFromCamera(nd, cam);
    const hits=rc.intersectObject(sc,true).filter(h=>h.object.isMesh&&h.object.visible);
    if(!hits.length){out.push({pt,miss:1}); continue;}
    const h=hits[0], o=h.object;
    let ms=Array.isArray(o.material)?o.material:[o.material];
    let m=ms[0];
    if(Array.isArray(o.material)&&o.geometry.groups&&o.geometry.groups.length){
      for(const g of o.geometry.groups){ if(h.faceIndex*3>=g.start&&h.faceIndex*3<g.start+g.count){m=ms[g.materialIndex]||m;break;} }
    }
    let chain=[],n=o; while(n&&chain.length<6){chain.push(n.name||n.type);n=n.parent;}
    out.push({pt, dist:+h.distance.toFixed(2), obj:o.name||o.type, chain:chain.join('<'),
      mat:m&&(m.name||m.type), color:m&&m.color?m.color.getHexString():null,
      rough:m&&m.roughness, metal:m&&m.metalness, env:m&&m.envMapIntensity,
      emis:m&&m.emissive?m.emissive.getHexString():null, emisI:m&&m.emissiveIntensity,
      map:!!(m&&m.map), vcol:!!(m&&m.vertexColors)});
  }
  return out;}"""
with sync_playwright() as p:
    br=p.chromium.launch(channel="chrome",headless=True,args=FLAGS)
    pg=br.new_page(viewport={"width":1600,"height":900})
    pg.goto(BASE+"?dev=1&quality=high",wait_until="load",timeout=60000)
    dl=time.time()+70
    while time.time()<dl:
        if pg.evaluate("!!(globalThis.CRESTBOUND&&CRESTBOUND.game)"):break
        pg.wait_for_timeout(300)
    dl=time.time()+90
    while time.time()<dl:
        if pg.evaluate("CRESTBOUND.game.state") in ("keep","playing"):break
        pg.evaluate(CLICK); pg.wait_for_timeout(400)
    print(pg.evaluate(LOAD,"verdant-1"))
    pg.evaluate("()=>{const G=globalThis.CRESTBOUND.game; G.__dev.tp&&G.__dev.tp(0,2,40);}")
    pg.wait_for_timeout(1200)
    pts=[[0.0375,0.333],[0.075,0.467],[0.9375,0.333],[0.925,0.167],[0.975,0.556],[0.5,0.85],[0.44,0.52],[0.75,0.78]]
    for r in pg.evaluate(RAY, pts): print(json.dumps(r))
    br.close()
