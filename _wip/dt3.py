from playwright.sync_api import sync_playwright
import json
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":1280,"height":800})
    errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://localhost:8780/games/iron-tide/", wait_until="load", timeout=60000); pg.wait_for_timeout(3000)
    out=pg.evaluate("""async ()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));
      const ctrl=window.__FFG3D__.controller, t=ctrl.__test, sim=ctrl.sim;
      t.menuPlay(); await s(400); t.placeAuto(); await s(800);
      const r={};
      // SALVO with a long settle
      t.grantTestUpgrade('cruiser'); await s(200);
      const b2=JSON.stringify(sim.enemy.shots); t.armAbility('salvo'); await s(120);
      r.salvoArmed=t.abilityState().armed; t.useAbilityAt(5,5); await s(2500);
      r.salvoFired = b2!==JSON.stringify(sim.enemy.shots);
      // ESC disarm test (wait until idle)
      await s(500); t.grantTestUpgrade('destroyer'); await s(200);
      t.armAbility('double'); await s(150);
      r.armedBeforeEsc=t.abilityState().armed;
      window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      await s(200);
      r.armedAfterEsc=t.abilityState().armed;
      r.shellPhase=ctrl.shell?ctrl.shell.phase:null;
      return r;
    }""")
    print(json.dumps(out,indent=2)); print("ERRORS:", errs[:6])
    b.close()
