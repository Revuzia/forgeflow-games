from playwright.sync_api import sync_playwright
import json
def run(order):
    with sync_playwright() as p:
        b=p.chromium.launch(); pg=b.new_page(viewport={"width":1280,"height":800})
        errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
        pg.goto("http://localhost:8780/games/iron-tide/",wait_until="load",timeout=60000); pg.wait_for_timeout(3000)
        out=pg.evaluate("""async (order)=>{const s=ms=>new Promise(r=>setTimeout(r,ms));
          const t=window.__FFG3D__.controller.__test; t.menuPlay(); await s(400); t.placeAuto(); await s(500);
          for(const id of order){ t.grantTestUpgrade(id); await s(60); }
          const st=t.abilityState();
          // arm scan if present and use at center to reveal
          let revealed=null;
          if(st.ammo.scan>0){ t.armAbility('scan'); await s(50); t.useAbilityAt(5,5); await s(400); }
          return {state:st, after:t.abilityState()};
        }""", order)
        b.close()
        return out, errs
o1,e1=run(["carrier","destroyer"])   # 5 then 2
o2,e2=run(["destroyer","carrier"])   # 2 then 5
print("5->2 comboPower:", o1["state"]["comboPower"], "ammo:", o1["state"]["ammo"])
print("2->5 comboPower:", o2["state"]["comboPower"], "ammo:", o2["state"]["ammo"])
print("scan consumed (5->2): before", o1["state"]["ammo"]["scan"], "after", o1["after"]["ammo"]["scan"])
print("errors:", (e1+e2)[:5])
