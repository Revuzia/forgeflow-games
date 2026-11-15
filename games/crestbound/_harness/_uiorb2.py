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
    pg.wait_for_timeout(1500)
    out=pg.evaluate("""()=>{
      const g=CRESTBOUND.game, THREE=CRESTBOUND.THREE;
      const d=(g.def.crests||[]).find(c=>c.id==='open'); const P=d.p||d.spawnAt;
      const look=new THREE.Vector3(P[0],P[1]+0.9,P[2]);
      // candidate list: course.group, visible, non-instanced, opaque, not collectibles
      const list=[]; let tris=0;
      const stack=[g.course.group];
      while(stack.length){ const o=stack.pop(); if(!o||o.visible===false) continue;
        if(o.name==='collectibles') continue;
        if(o.isMesh&&!o.isInstancedMesh&&o.geometry){ const m=o.material;
          const solid = m && !Array.isArray(m) ? (m.transparent!==true) : true;
          if(solid){ list.push(o); const ix=o.geometry.index; const pos=o.geometry.attributes.position;
            tris += ix? ix.count/3 : (pos?pos.count/3:0); } }
        const ch=o.children; for(let i=0;i<ch.length;i++) stack.push(ch[i]); }
      const rc=new THREE.Raycaster(); const rows=[];
      const t0=performance.now();
      for(let i=0;i<9;i++){
        const k=i/8; const ang=Math.PI + k*Math.PI*1.65;
        const r=4.6-k*1.4;
        const key=new THREE.Vector3(P[0]-Math.sin(ang)*r, P[1]+2.3-k*0.7, P[2]-Math.cos(ang)*r);
        const dir=key.clone().sub(look); const dd=dir.length(); dir.normalize();
        rc.set(look.clone(), dir); rc.far=dd; rc.near=0.001;
        const hits=rc.intersectObjects(list,false);
        rows.push({i, d:+dd.toFixed(2), hit: hits.length? {n:hits[0].object.name||hits[0].object.type, t:+hits[0].distance.toFixed(2)}:null});
      }
      const ms=performance.now()-t0;
      return {meshes:list.length, tris:Math.round(tris), ms:+ms.toFixed(1), rows,
              biggest: list.map(o=>({n:o.name||o.type, t: o.geometry.index? o.geometry.index.count/3 : o.geometry.attributes.position.count/3}))
                          .sort((a,b)=>b.t-a.t).slice(0,8)};
    }""")
    print(json.dumps(out,indent=1))
    b.close()
