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
    pg.evaluate("([x,y,z])=>CRESTBOUND.game.__dev.tp(x,y-0.2,z+0.65)", tgt)
    pg.wait_for_timeout(1400)
    out=pg.evaluate("""([P])=>{
      const g=CRESTBOUND.game, THREE=CRESTBOUND.THREE;
      const c=new THREE.Vector3(P[0],P[1],P[2]);
      const t0=performance.now();
      g._buildOrbit(c);
      const ms=+(performance.now()-t0).toFixed(1);
      const crest=new THREE.Vector3(P[0],P[1]+0.9,P[2]);
      const hp=g.player.pos; const hero=new THREE.Vector3(hp.x,hp.y+0.9,hp.z);
      const rows=g._orbitPath.cam.map((k,i)=>{
        const p={x:k.p[0],y:k.p[1],z:k.p[2]};
        return {i, p:[+p.x.toFixed(2),+p.y.toFixed(2),+p.z.toFixed(2)],
                hero:+g._segScore(hero,p).toFixed(3), crest:+g._segScore(crest,p).toFixed(3)};
      });
      // independent check with the SAME list the stager used
      const rc=new THREE.Raycaster();
      const k0=g._orbitPath.cam[0];
      const kp=new THREE.Vector3().fromArray(k0.p);
      const dir=kp.clone().sub(hero); const dd=dir.length(); dir.normalize();
      rc.set(hero.clone(), dir); rc.near=0.02; rc.far=dd;
      const h1=rc.intersectObjects(g._orbMeshes,false).slice(0,3).map(x=>({n:x.object.name||x.object.type,t:+x.distance.toFixed(2)}));
      // and with EVERY visible scene mesh
      const all=[]; CRESTBOUND.engine.scene.traverse(o=>{ if(o.isMesh&&o.visible) all.push(o); });
      rc.set(hero.clone(), dir); rc.near=0.02; rc.far=dd;
      const h2=rc.intersectObjects(all,false).slice(0,3).map(x=>({n:x.object.name||x.object.type,t:+x.distance.toFixed(2)}));
      const hasCopper=g._orbMeshes.some(o=>/copper/i.test(o.name||''));
      return {ms, rays:g._orbRays, meshes:g._orbMeshes.length, hasCopper, dd:+dd.toFixed(2), h1, h2,
              hero:[+hero.x.toFixed(2),+hero.y.toFixed(2),+hero.z.toFixed(2)],
              look:g._orbitPath.cam[0].look.map(v=>+v.toFixed(2)), rows};
    }""",[tgt])
    print(json.dumps(out,indent=1))
    b.close()
