#!/usr/bin/env python
"""Drive enterRealm() through cold -> sand -> ash and report what actually changes.

Realm switching is the one feature where "it didn't throw" is nearly meaningless:
a swap that loads the wrong bodies, or writes weather but not the roster, boots
perfectly and looks almost right. So this reports the OBSERVABLE state per realm --
which bodies are resident, what weather is live, what the spell palette says -- and
screenshots each so the look can be judged rather than assumed.
"""
import sys, json
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
READY = """() => {const SF=globalThis.SNOWFLOW;if(!SF||!SF.enterRealm)return false;
const b=document.getElementById('boot');return !(b&&!b.classList.contains('gone'));}"""
STATE = """() => {
  const SF=globalThis.SNOWFLOW, W=SF.weather, V=SF.combat.enemies.vis;
  const types=[]; if(V._types&&V._types.forEach) V._types.forEach((v,k)=>types.push(k));
  return {realmWeather: W?W.realmName:null,
          weatherLive: W&&W.liveCount!==undefined?W.liveCount:(W&&W.count!==undefined?W.count:null),
          encounterRealm: SF.combat.encounters.realm,
          visRealm: V?V.realm:null,
          bodiesResident: types.sort(),
          spellPalette: SF.spells.realmName||SF.spells.realm||null,
          draws: SF.perfStats.drawCalls, tris: SF.perfStats.triangles};
}"""
with sync_playwright() as p:
    br=p.chromium.launch(channel="chrome",headless=False,args=["--ignore-gpu-blocklist","--use-angle=d3d11","--disable-gpu-sandbox","--disable-features=CalculateNativeWinOcclusion"])
    pg=br.new_page(viewport={"width":1280,"height":720})
    errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.on("console",lambda m:errs.append("console.error: "+m.text) if m.type=="error" else None)
    pg.add_init_script("window.__f=0;(function t(){window.__f++;requestAnimationFrame(t);})();")
    pg.goto("http://localhost:8788/games/driftwake/index.html?v=rs",wait_until="load",timeout=90000)
    pg.wait_for_function(READY,timeout=180000)
    def frames(n):
        s=pg.evaluate("()=>window.__f"); pg.wait_for_function("(s)=>window.__f>s+%d"%n,arg=s,timeout=90000)
    frames(40)
    for realm in ["cold","sand","ash"]:
        if realm!="cold":
            pg.evaluate("(r)=>globalThis.SNOWFLOW.enterRealm(r)",realm)
            frames(120)
        else:
            frames(20)
        st=pg.evaluate(STATE)
        pg.screenshot(path=f"_shots/realm_{realm}.png")
        print(f"\n=== {realm.upper()} ===")
        print(json.dumps(st,indent=1))
    print("\nerrors:",len(errs))
    for e in errs[:6]: print("  ",e)
    br.close()
