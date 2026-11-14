from playwright.sync_api import sync_playwright
import json
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":1280,"height":800})
    pg.goto("http://localhost:8780/games/iron-tide/", wait_until="load", timeout=60000); pg.wait_for_timeout(3000)
    out=pg.evaluate("""async ()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));
      const ctrl=window.__FFG3D__.controller, t=ctrl.__test;
      t.menuPlay(); await s(400); t.placeAuto(); await s(800);
      // no firing -> not busy; grant + arm immediately
      t.grantTestUpgrade('destroyer'); await s(150);
      t.armAbility('double'); await s(150);
      const armed1=t.abilityState().armed, phase1=ctrl.shell.phase;
      window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));
      await s(200);
      return {armedBefore:armed1, phaseBefore:phase1, armedAfter:t.abilityState().armed, phaseAfter:ctrl.shell.phase};
    }""")
    print(json.dumps(out,indent=2))
    b.close()
