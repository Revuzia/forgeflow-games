from playwright.sync_api import sync_playwright
import json
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":900,"height":700})
    logs=[]; pg.on("console", lambda m: logs.append(m.type+":"+m.text))
    pg.goto("http://localhost:8780/games/iron-tide/", wait_until="load", timeout=60000)
    pg.wait_for_timeout(3000)
    info = pg.evaluate("""async ()=>{
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const ctrl=window.__FFG3D__.controller; const t=ctrl.__test; const K=window.__FFG3D__.kernel; const c=K.controls;
      c.autoRotate=false; t.menuPlay(); await sleep(400); t.placeAuto(); await sleep(700);
      const occ=new Set(); for(const s of ctrl.sim.enemy.ships) for(const cc of s.cells) occ.add(cc.x+','+cc.y);
      let m=null; outer: for(let y=0;y<10;y++) for(let x=0;x<10;x++){ if(!occ.has(x+','+y)){m={x,y};break outer;} }
      const before = K.scene.children.length;
      const ok = t.fireAnimated(m.x,m.y);
      await sleep(1500);
      const after = K.scene.children.length;
      // count meshes that look like a white dome (SphereGeometry hemisphere)
      let domes=0, rings=0;
      K.scene.traverse(o=>{ if(o.isMesh && o.geometry){ const ty=o.geometry.type; if(ty==='SphereGeometry') domes++; if(ty==='RingGeometry') rings++; } });
      return {missCell:m, fired:ok, before, after, domes, rings, turn:ctrl.sim.turn, ended:ctrl.sim.ended};
    }""")
    print(json.dumps(info,indent=2))
    print("LOGS:", [l for l in logs if 'error' in l.lower()][:5])
    b.close()
