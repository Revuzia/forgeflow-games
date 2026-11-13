from playwright.sync_api import sync_playwright
import json
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":1280,"height":800})
    errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://localhost:8780/games/void-skirmish/", wait_until="load", timeout=60000)
    pg.wait_for_timeout(2500)
    out = pg.evaluate("""async ()=>{
      const sleep=ms=>new Promise(r=>setTimeout(r,ms));
      const getScene=()=>window.__FFG_GAME__.scene.scenes.find(s=>s.__test);
      let sc=getScene();
      const m0={started:sc._started, shellPhase:sc._shell&&sc._shell.phase, idx:sc._missionIndex};
      sc.__test.start(); await sleep(300);             // begin mission 1
      sc.__test.autoResolve(80); await sleep(300);     // clear it -> intermission overlay
      // replicate the NEXT MISSION button onClick exactly:
      window.__FFG_TACTICS_MISSION__ = sc._missionIndex + 1;
      window.__FFG_TACTICS_AUTOSTART__ = true;
      sc.scene.restart(); await sleep(800);
      sc = getScene();
      const m1={started:sc._started, shellPhase:sc._shell&&sc._shell.phase, idx:sc._missionIndex, autostartFlag:window.__FFG_TACTICS_AUTOSTART__};
      return {mission0:m0, afterAdvance:m1};
    }""")
    print(json.dumps(out, indent=2)); print("ERRORS:", errs[:5])
    b.close()
