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
    tgt=pg.evaluate("()=>{const d=(CRESTBOUND.game.def.crests||[]).find(c=>c.id==='open');return d.p||d.spawnAt;}")
    pg.evaluate("([x,y,z])=>CRESTBOUND.game.__dev.tp(x,y-0.2,z+2.2)", tgt)
    pg.wait_for_timeout(1200)
    pg.evaluate("()=>CRESTBOUND.game.input.__test.press('KeyW')")
    pg.wait_for_timeout(800)
    pg.evaluate("()=>CRESTBOUND.game.input.__test.release('KeyW')")
    out=pg.evaluate("""()=>{
      const g=CRESTBOUND.game, THREE=CRESTBOUND.THREE, e=CRESTBOUND.engine;
      const path=g._orbitPath, cam=e.camera;
      const look=new THREE.Vector3().fromArray(path.cam[0].look);
      const list=[]; const stack=[g.course.group];
      while(stack.length){ const o=stack.pop(); if(!o||o.visible===false) continue;
        if(o.name==='collectibles') continue;
        if(o.isMesh&&!o.isInstancedMesh&&o.geometry){ const m=o.material;
          if(!(m&&!Array.isArray(m)&&m.transparent===true)) list.push(o); }
        const ch=o.children; for(let i=0;i<ch.length;i++) stack.push(ch[i]); }
      const rc=new THREE.Raycaster();
      const bp=g.physWorld.broadphase;
      const rows=path.cam.map((k,i)=>{
        const key=new THREE.Vector3().fromArray(k.p);
        const dir=key.clone().sub(look); const dd=dir.length(); dir.normalize();
        rc.set(look.clone(), dir); rc.far=dd; rc.near=0.001;
        const h=rc.intersectObjects(list,false);
        const hit={t:0,normal:new THREE.Vector3(),collider:null};
        const bph = bp.raycast(look, dir, dd, hit) ? +hit.t.toFixed(2) : null;
        return {i, d:+dd.toFixed(2), vis: h.length? {n:h[0].object.name||h[0].object.type,t:+h[0].distance.toFixed(2)}:null, bp:bph};
      });
      const hp=g.hero.root.getWorldPosition(new THREE.Vector3());
      // camera -> hero, the shot that matters
      const hd=hp.clone().setY(hp.y+0.9).sub(cam.position); const hl=hd.length(); hd.normalize();
      rc.set(cam.position.clone(), hd); rc.far=hl; rc.near=0.001;
      const hh=rc.intersectObjects(list,false);
      return {state:g.state, clearT:g._clearT, look:look.toArray().map(v=>+v.toFixed(2)),
              hero:[+hp.x.toFixed(2),+hp.y.toFixed(2),+hp.z.toFixed(2)],
              cam:[+cam.position.x.toFixed(2),+cam.position.y.toFixed(2),+cam.position.z.toFixed(2)],
              camYaw:+g.cam.yaw.toFixed(3), meshes:list.length, rows,
              camToHero:{d:+hl.toFixed(2), hit: hh.length?{n:hh[0].object.name||hh[0].object.type,t:+hh[0].distance.toFixed(2)}:null}};
    }""")
    print(json.dumps(out,indent=1))
    b.close()
