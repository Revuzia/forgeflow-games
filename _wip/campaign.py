from playwright.sync_api import sync_playwright
import json
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":1280,"height":800})
    errs=[]; pg.on("console", lambda m: errs.append(m.text) if m.type=="error" else None)
    pg.on("pageerror", lambda e: errs.append("PAGEERR:"+str(e)))
    pg.goto("http://localhost:8780/games/void-skirmish/", wait_until="load", timeout=60000)
    pg.wait_for_timeout(2500)
    out = pg.evaluate("""async ()=>{
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const getScene=()=>window.__FFG_GAME__.scene.scenes.find(s=>s.__test);
      let scene=getScene(); scene.__test.start(); await sleep(300);
      const results=[];
      for(let step=0; step<12; step++){
        scene=getScene();
        const idx=scene._missionIndex, count=scene._missionCount;
        const r=scene.__test.autoResolve(80); await sleep(250);
        results.push({mission:idx+1, victory:r.victory, turns:r.turns, count});
        if(r.victory && idx+1<count){
          window.__FFG_TACTICS_MISSION__=idx+1; window.__FFG_TACTICS_AUTOSTART__=true;
          scene.scene.restart(); await sleep(500);
        } else break;
      }
      return {results, finalResult: window.__FFG_RESULT__};
    }""")
    print(json.dumps(out, indent=2))
    print("ERRORS:", errs[:6])
    b.close()
