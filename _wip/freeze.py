from playwright.sync_api import sync_playwright
import json
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":1100,"height":750})
    errs=[]; pg.on("console", lambda m: errs.append(m.type[:3]+":"+m.text) if m.type in("error","warning") else None)
    pg.on("pageerror", lambda e: errs.append("PAGEERR:"+str(e)))
    pg.goto("http://localhost:8780/games/iron-tide/", wait_until="load", timeout=60000); pg.wait_for_timeout(3000)
    out=pg.evaluate("""async ()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));
      const ctrl=window.__FFG3D__.controller, t=ctrl.__test, sim=ctrl.sim;
      t.menuPlay(); await s(400); t.placeAuto(); await s(600);
      // fire shot-by-shot, waiting for each player+enemy exchange to finish, until the enemy lands a hit on our fleet
      let log=[]; let enemyHitSeen=false; let guard=0;
      function alive(){ return sim.player.ships.filter(x=>!x.sunk).reduce((a,x)=>a+(x.len-x.hits),0); }
      let lastAlive=alive();
      for(let y=0;y<10 && !enemyHitSeen && guard<30;y++) for(let x=0;x<10 && !enemyHitSeen && guard<30;x++){
        guard++;
        if(sim.enemy.shots[y][x]!==0) continue;
        t.fireAnimated(x,y);
        await s(6500); // full exchange
        const a=alive(); if(a<lastAlive){ enemyHitSeen=true; log.push('enemy hit our fleet at guard '+guard); } lastAlive=a;
      }
      // after an enemy hit, can we still fire? (freeze test)
      const before=JSON.stringify(sim.enemy.shots);
      let fired=false;
      for(let y=0;y<10&&!fired;y++)for(let x=0;x<10&&!fired;x++){ if(sim.enemy.shots[y][x]===0){ fired=t.fireAnimated(x,y); break;} }
      await s(6500);
      const after=JSON.stringify(sim.enemy.shots);
      return { enemyHitSeen, log, canStillFire: before!==after, turn: sim.turn, ended: sim.ended };
    }""")
    print(json.dumps(out,indent=2)); print("ERRORS:", errs[:10])
    b.close()
