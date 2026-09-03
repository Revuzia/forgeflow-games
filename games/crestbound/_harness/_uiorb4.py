import json, sys
from playwright.sync_api import sync_playwright
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass
URL="http://localhost:8788/games/crestbound/index.html?dev=1"
FLAGS=["--ignore-gpu-blocklist","--use-angle=d3d11","--disable-gpu-sandbox","--enable-gpu-rasterization",
       "--disable-features=CalculateNativeWinOcclusion","--autoplay-policy=no-user-gesture-required",
       "--force-device-scale-factor=1"]
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome",headless=True,args=FLAGS)
    ctx=b.new_context(viewport={"width":1280,"height":720}); pg=ctx.new_page()
    pg.goto(URL); pg.wait_for_function("()=>window.CRESTBOUND&&CRESTBOUND.game&&CRESTBOUND.game.state==='title'",timeout=120000)
    pg.evaluate("()=>{try{CRESTBOUND.game.menu.close()}catch(e){}; CRESTBOUND.game.__dev.goto('verdant-1')}")
    pg.wait_for_function("()=>CRESTBOUND.game.state==='playing'",timeout=180000)
    pg.wait_for_timeout(2500)
    tgt=pg.evaluate("()=>{const d=(CRESTBOUND.game.def.crests||[]).find(c=>c.id==='open');return d.p||d.spawnAt;}")
    pg.evaluate("([x,y,z])=>CRESTBOUND.game.__dev.tp(x,y-0.2,z+2.2)", tgt)
    pg.wait_for_timeout(1200)
    out=pg.evaluate("""([P])=>{
      const g=CRESTBOUND.game, THREE=CRESTBOUND.THREE;
      const look=new THREE.Vector3(P[0], P[1]+0.9, P[2]);
      const list=g._collectOrbitMeshes(look);
      const names=list.map(o=>o.name||o.type);
      // does the copper appear anywhere under course.group at all?
      let anyCopper=0, vis=0, tot=0;
      g.course.group.traverse(o=>{ if(o.isMesh){tot++; if(/copper/i.test(o.name||'')) anyCopper++;} });
      g.course.group.traverseVisible(o=>{ if(o.isMesh) vis++; });
      const t0=performance.now();
      const from=look.clone();
      const dir=new THREE.Vector3(0.4,0.35,0.85).normalize();
      const sc=g._segScore(from, {x:from.x+dir.x*4.6,y:from.y+dir.y*4.6,z:from.z+dir.z*4.6});
      return {n:list.length, sample:names, anyCopper, visMeshes:vis, totMeshes:tot,
              segScore:sc, ms:+(performance.now()-t0).toFixed(1),
              parentOfCopper: (()=>{let r=null; g.course.group.traverse(o=>{ if(!r&&/copper/i.test(o.name||'')) r={n:o.name, vis:o.visible, pv:o.parent?o.parent.visible:null, inst:!!o.isInstancedMesh, transp:!!(o.material&&o.material.transparent)}; }); return r;})()};
    }""",[tgt])
    print(json.dumps(out,indent=1))
    b.close()
