from playwright.sync_api import sync_playwright
import json
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":1280,"height":800})
    errs=[]; pg.on("console", lambda m: errs.append(m.text) if m.type=="error" else None)
    pg.on("pageerror", lambda e: errs.append("PAGEERR:"+str(e)))
    # preset mission index BEFORE the game boots
    pg.add_init_script("window.__FFG_TACTICS_MISSION__=5; window.__FFG_TACTICS_AUTOSTART__=true;")
    pg.goto("http://localhost:8780/games/void-skirmish/", wait_until="load", timeout=60000)
    pg.wait_for_timeout(2500)
    out = pg.evaluate("""async ()=>{
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const scene=window.__FFG_GAME__.scene.scenes.find(s=>s.__test);
      const before={idx:scene._missionIndex,count:scene._missionCount,enemies:scene.sim.aliveEnemies().length,allies:scene.sim.aliveAllies().length};
      const r=scene.__test.autoResolve(120); await sleep(300);
      return {before, autoResolve:r, simEnded:scene.sim.ended, enemiesLeft:scene.sim.aliveEnemies().length, alliesLeft:scene.sim.aliveAllies().length, result:window.__FFG_RESULT__, shellPhase:scene._shell?scene._shell.phase:null};
    }""")
    print(json.dumps(out, indent=2)); print("ERRORS:", errs[:6])
    b.close()
