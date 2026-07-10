from playwright.sync_api import sync_playwright
import json
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":1280,"height":800})
    errs=[]; pg.on("console", lambda m: errs.append(m.type+":"+m.text) if m.type=="error" else None)
    pg.on("pageerror", lambda e: errs.append("PAGEERR:"+str(e)))
    pg.goto("http://localhost:8780/games/iron-tide/", wait_until="load", timeout=60000); pg.wait_for_timeout(3000)
    out=pg.evaluate("""async ()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));
      const t=window.__FFG3D__.controller.__test, sim=window.__FFG3D__.controller.sim;
      t.menuPlay(); await s(400); t.placeAuto(); await s(500);
      const hasMulti = typeof sim.playerMultiFire === 'function';
      t.grantTestUpgrade('destroyer'); await s(100);   // double tap
      const before = JSON.stringify(sim.enemy.shots);
      t.armAbility('double'); await s(80);
      const armedNow = t.abilityState().armed;
      const used = t.useAbilityAt(3,3); await s(900);
      const after = JSON.stringify(sim.enemy.shots);
      return {hasMulti, armedNow, used, changed: before!==after, ammoAfter: t.abilityState().ammo.double};
    }""")
    print(json.dumps(out,indent=2)); print("ERRORS:", errs[:8])
    b.close()
