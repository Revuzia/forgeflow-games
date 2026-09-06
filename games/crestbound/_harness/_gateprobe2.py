"""Click through the title like a player, then list every gate and walk into verdant-1's."""
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
    if v1 and v1[0]["c"]:
        c=v1[0]["c"]
        print("walking into verdant-1 gate at",c)
        pg.evaluate("""(c)=>{const P=CRESTBOUND.game.player;P.__test.teleport({x:c[0],y:c[1]-0.5,z:c[2]+3.0});}""",c)
        pg.wait_for_timeout(500)
        for _ in range(60):
            pg.keyboard.down("w"); pg.wait_for_timeout(60)
        pg.keyboard.up("w"); pg.wait_for_timeout(3000)
        after=pg.evaluate("""()=>({state:CRESTBOUND.game.state,course:CRESTBOUND.game.course&&CRESTBOUND.game.course.def.id,
            pos:[+CRESTBOUND.game.player.pos.x.toFixed(1),+CRESTBOUND.game.player.pos.y.toFixed(1),+CRESTBOUND.game.player.pos.z.toFixed(1)]})""")
        print("AFTER WALK:",json.dumps(after))
        pg.screenshot(path="_shots/gateprobe2.png")
    br.close()
