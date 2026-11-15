import json, os, sys
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
    out=pg.evaluate("""()=>{
      const g=CRESTBOUND.game, THREE=CRESTBOUND.THREE, e=CRESTBOUND.engine;
      const d=(g.def.crests||[]).find(c=>c.id==='open'); const P=d.p||d.spawnAt;
      const look=new THREE.Vector3(P[0],P[1]+0.9,P[2]);
      const bp=g.physWorld.broadphase;
      // sample 16 directions around the ring at orbit height
      const rows=[];
      const list=[]; e.scene.traverse(o=>{ if(o.isMesh&&o.visible&&!(g.hero&&g.hero.root&&(o===g.hero.root||o.parent===g.hero.root))) list.push(o); });
      const rc=new THREE.Raycaster(); rc.far=8;
      for(let i=0;i<16;i++){
        const a=i/16*Math.PI*2;
        const dir=new THREE.Vector3(-Math.sin(a),0.30,-Math.cos(a)).normalize();
        const hit={t:0,normal:new THREE.Vector3(),collider:null};
        const bpHit = bp.raycast(look, dir, 6.0, hit) ? +hit.t.toFixed(2) : null;
        rc.set(look.clone(), dir);
        const vis=rc.intersectObjects(list,false);
        const v = vis.length? {n:vis[0].object.name||vis[0].object.type,d:+vis[0].distance.toFixed(2)}:null;
        rows.push({i, bp:bpHit, vis:v});
      }
      const names=[]; e.scene.traverse(o=>{ if(o.isMesh&&/copper/i.test(o.name||'')) names.push({n:o.name,userData:Object.keys(o.userData||{})}); });
      return {look:[look.x,look.y,look.z], rows, copper:names.slice(0,4)};
    }""")
    print(json.dumps(out,indent=1))
    b.close()
