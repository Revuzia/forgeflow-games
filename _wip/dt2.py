from playwright.sync_api import sync_playwright
import json
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":1280,"height":800})
    errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://localhost:8780/games/iron-tide/", wait_until="load", timeout=60000); pg.wait_for_timeout(3000)
    out=pg.evaluate("""async ()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));
      const ctrl=window.__FFG3D__.controller, t=ctrl.__test, sim=ctrl.sim;
      t.menuPlay(); await s(400); t.placeAuto(); await s(500);
      // grant several abilities to simulate sinks
      t.grantTestUpgrade('destroyer'); t.grantTestUpgrade('cruiser'); await s(100);
      const r={};
      // DOUBLE TAP fires
      const b1=JSON.stringify(sim.enemy.shots); t.armAbility('double'); await s(60); t.useAbilityAt(2,2); await s(900);
      r.doubleFired = b1!==JSON.stringify(sim.enemy.shots);
      // SALVO fires
      const b2=JSON.stringify(sim.enemy.shots); t.armAbility('salvo'); await s(60); t.useAbilityAt(7,7); await s(1200);
      r.salvoFired = b2!==JSON.stringify(sim.enemy.shots);
      // Esc disarm should NOT pause
      t.grantTestUpgrade('destroyer'); await s(60); t.armAbility('double'); await s(60);
      window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
      await s(120);
      r.disarmed = t.abilityState().armed===null;
      r.shellPhase = ctrl.shell ? ctrl.shell.phase : null;  // should be 'playing', NOT 'paused'
      return r;
    }""")
    print(json.dumps(out,indent=2)); print("ERRORS:", errs[:6])
    b.close()
