import os, sys, time, json
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
import heroshots as HS
from playwright.sync_api import sync_playwright
OUT = HS.OUT
with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome", headless=True, args=HS.HEADLESS_FLAGS)
    pg = br.new_page(viewport={"width": 900, "height": 900})
    pg.goto(HS.BASE + "?dev=1&course=verdant-1", wait_until="load", timeout=60000)
    dl = time.time() + 60
    while time.time() < dl:
        try:
            if pg.evaluate("!!(globalThis.CRESTBOUND&&CRESTBOUND.game&&CRESTBOUND.game.hero)"): break
        except Exception: pass
        pg.wait_for_timeout(400)
    HS.leave_title(pg); pg.wait_for_timeout(2500)
    spot = pg.evaluate(HS.FINDSPOT_JS, {"r": 12.0, "clear": 7.0})["spot"]
    pg.evaluate(HS.SEIZE_JS)
    flags = pg.evaluate(r"""()=>{const G=CRESTBOUND.game,E=G.engine;let sun=null,casters=[],hero=0,heroCast=0;
      E.scene.traverse(o=>{if(o.isDirectionalLight&&!sun)sun={castShadow:o.castShadow,mapSize:o.shadow?[o.shadow.mapSize.x,o.shadow.mapSize.y]:null,intensity:o.intensity};
        if(/^nim\./.test(o.name||'')){hero++;if(o.castShadow)heroCast++,casters.push(o.name);}});
      return {shadowMapEnabled:E.renderer.shadowMap.enabled,type:E.renderer.shadowMap.type,sun,heroMeshes:hero,heroCasters:heroCast,casters};}""")
    print(json.dumps(flags, indent=2))
    for nm, el, dist, aimY in (("_j_shadow_hi", 34, 5.2, 0.7), ("_j_shadow_mid", 18, 4.4, 0.6)):
        o = {"anim": "idle", "hold": 1.2, "grounded": 1, "vx": 0, "vy": 0, "vz": 0,
             "from": "land", "fromGrounded": 1, "lift": 0.0, "facing": 0.0,
             "az": 55, "dist": dist, "el": el, "aimY": aimY, "spot": spot}
        pg.evaluate(HS.POSE_JS, o)
        pg.screenshot(path=os.path.join(OUT, nm + ".png"), timeout=120000)
        print("wrote", nm)
    br.close()
