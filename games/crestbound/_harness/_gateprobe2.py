"""Click through the title like a player, then list every gate and walk into verdant-1's.

CAUTION, and the reason this file was corrected on 2026-09-06. The first version
teleported to `trigger.center + (0, -0.5, +3.0)` and held W. `+Z` is only "out of
the wall" for a gate whose yaw is 0, and the Keep hangs verdant-1 on its WEST wall
(yaw = +PI/2): the teleport landed the hero 3 m SIDEWAYS along the same wall and W
drove him into the masonry, where he moved 0.2 m and stopped. The probe reported
"walking into verdant-1 does nothing", which was true of the probe and not of the
game, and that false alarm is what opened the P0 pass. It now stands on the gate's
own authored `exitPos` and aims the camera at the picture, the way `gatecheck.py`
does. `gatecheck.py` is the GATE; this file stays as the quick eyeball.
"""
import sys, json
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
FLAGS=["--ignore-gpu-blocklist","--use-angle=d3d11","--disable-gpu-sandbox","--enable-gpu-rasterization",
       "--disable-features=CalculateNativeWinOcclusion","--autoplay-policy=no-user-gesture-required"]
with sync_playwright() as p:
    br=p.chromium.launch(channel="chrome",headless=True,args=FLAGS)
    pg=br.new_page(viewport={"width":1280,"height":720})
    pg.goto("http://localhost:8788/games/crestbound/index.html?dev=1&quality=low&autoscale=0",wait_until="load",timeout=60000)
    for _ in range(120):
        if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.course)"): break
        pg.wait_for_timeout(500)
    pg.wait_for_timeout(2000)
    # click the title button the way a player does
    clicked=pg.evaluate("""() => {
      const btns=[...document.querySelectorAll('button')].filter(b=>b.offsetParent!==null);
      for (const want of ['NEW','CONTINUE','PLAY','START']) {
        const b=btns.find(x=>(x.textContent||'').toUpperCase().includes(want));
        if (b) { if (b.__activate) b.__activate(); else b.click(); return (b.textContent||'').trim(); }
      }
      return null; }""")
    pg.wait_for_timeout(2500)
    st=pg.evaluate("() => CRESTBOUND.game.state")
    print("clicked:",clicked," state after click:",st)
    gates=pg.evaluate("""() => (CRESTBOUND.game.course.gates||[]).map(g=>({
        course:(g.def&&g.def.course)||g.course, req:(g.def&&g.def.requires&&g.def.requires.crests),
        unlocked:g.unlocked, sealed:g.sealed, y:(g.volume?+g.volume.center.y.toFixed(2):null),
        c:g.volume?[+g.volume.center.x.toFixed(1),+g.volume.center.y.toFixed(1),+g.volume.center.z.toFixed(1)]:null}))""")
    print("GATES (%d):"%len(gates))
    for g in gates: print("  ",json.dumps(g))
    v1=[g for g in gates if g["course"]=="verdant-1"]
    if v1:
        # Stand where the Keep says a player stands to face this picture, and look
        # at it. `exitPos` is p - heading(yaw)*1.9 on the walking floor (keep.js
        # makeGate), so it is out in the ROOM whatever wall the gate hangs on.
        start=pg.evaluate("""()=>{
          const G=CRESTBOUND.game, g=(G._gates||[]).find(x=>x.course==='verdant-1');
          if(!g) return null;
          G.player.__test.teleport({x:g.exitPos.x,y:g.exitPos.y+0.12,z:g.exitPos.z});
          G.player.__test.setVel({x:0,y:0,z:0});
          const yaw=Math.atan2(-(g.pos.x-g.exitPos.x),-(g.pos.z-g.exitPos.z));
          G.player.__test.setFacing(yaw);
          if(G.cam){G.cam.yaw=yaw;G.cam._rcHoldT=0;}
          return {from:[+g.exitPos.x.toFixed(2),+g.exitPos.y.toFixed(2),+g.exitPos.z.toFixed(2)],
                  gate:[+g.pos.x.toFixed(2),+g.pos.y.toFixed(2),+g.pos.z.toFixed(2)],yaw:+yaw.toFixed(3)};}""")
        print("walking into verdant-1 from",json.dumps(start))
        pg.wait_for_timeout(500)
        pg.keyboard.down("w")
        for _ in range(30):
            pg.wait_for_timeout(120)
            if pg.evaluate("()=>CRESTBOUND.game.state==='card'"): break
        pg.keyboard.up("w"); pg.wait_for_timeout(1200)
        after=pg.evaluate("""()=>({state:CRESTBOUND.game.state,course:CRESTBOUND.game.course&&CRESTBOUND.game.course.def.id,
            cardOpen:!!document.querySelector('.cb-card.on'),
            pos:[+CRESTBOUND.game.player.pos.x.toFixed(1),+CRESTBOUND.game.player.pos.y.toFixed(1),+CRESTBOUND.game.player.pos.z.toFixed(1)]})""")
        print("AFTER WALK:",json.dumps(after))
        pg.screenshot(path="_shots/gateprobe2.png")
    br.close()
