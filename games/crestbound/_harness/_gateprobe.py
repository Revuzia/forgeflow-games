"""Can a PLAYER walk into a painting and enter a course? Real input, no teleports."""
import sys, json
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
FLAGS=["--ignore-gpu-blocklist","--use-angle=d3d11","--disable-gpu-sandbox",
       "--enable-gpu-rasterization","--disable-features=CalculateNativeWinOcclusion",
       "--autoplay-policy=no-user-gesture-required"]
URL="http://localhost:8788/games/crestbound/index.html?dev=1&quality=low&autoscale=0"
with sync_playwright() as p:
    br=p.chromium.launch(channel="chrome",headless=True,args=FLAGS)
    pg=br.new_page(viewport={"width":1280,"height":720})
    msgs=[]; pg.on("console", lambda m: msgs.append((m.type,m.text[:200])))
    pg.on("pageerror", lambda e: msgs.append(("pageerror",str(e)[:300])))
    pg.goto(URL,wait_until="load",timeout=60000)
    for _ in range(120):
        if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.course)"): break
        pg.wait_for_timeout(500)
    pg.wait_for_timeout(2500)
    info=pg.evaluate("""() => {
      const G=CRESTBOUND.game, P=G.player, C=G.course;
      const gates=(C.gates||[]).map(g=>({
        course:(g.def&&g.def.course)||g.course, requires:(g.def&&g.def.requires&&g.def.requires.crests),
        unlocked:g.unlocked, p:(g.def&&g.def.p)||null,
        volume: g.volume? {c:[+g.volume.center.x.toFixed(2),+g.volume.center.y.toFixed(2),+g.volume.center.z.toFixed(2)],
                           h:[+g.volume.half.x.toFixed(2),+g.volume.half.y.toFixed(2),+g.volume.half.z.toFixed(2)]} : null }));
      return {state:G.state, course:C.def.id, gateCount:gates.length, gates:gates.slice(0,4),
              player:[+P.pos.x.toFixed(2),+P.pos.y.toFixed(2),+P.pos.z.toFixed(2)],
              crests: (G.save&&G.save.crestTotal)?G.save.crestTotal():null};
    }""")
    print("KEEP STATE:", json.dumps(info,indent=1)[:1200])
    g=info["gates"][0] if info["gates"] else None
    if not g or not g.get("volume"):
        print("NO GATE VOLUME -> a player has nothing to walk into"); br.close(); raise SystemExit(1)
    # teleport just outside the gate volume, then WALK in with real keys
    c=g["volume"]["c"]
    pg.evaluate("""(c) => { const P=CRESTBOUND.game.player; P.__test.teleport({x:c[0], y:c[1]-0.6, z:c[2]+3.2}); P.__test.setFacing(Math.PI); }""", c)
    pg.wait_for_timeout(600)
    before=pg.evaluate("() => ({state:CRESTBOUND.game.state, course:CRESTBOUND.game.course.def.id})")
    for _ in range(70):
        pg.keyboard.down("w"); pg.wait_for_timeout(60)
    pg.keyboard.up("w")
    pg.wait_for_timeout(2500)
    after=pg.evaluate("""() => ({state:CRESTBOUND.game.state, course:CRESTBOUND.game.course&&CRESTBOUND.game.course.def.id,
        pos:[+CRESTBOUND.game.player.pos.x.toFixed(2),+CRESTBOUND.game.player.pos.y.toFixed(2),+CRESTBOUND.game.player.pos.z.toFixed(2)],
        cardOpen: !!document.querySelector('.cb-card, .cb-coursecard, [class*=card]')})""")
    print("WALK INTO GATE:", json.dumps({"gateTarget":g.get("course"),"before":before,"after":after}))
    pg.screenshot(path="_shots/gateprobe.png")
    errs=[m for m in msgs if m[0] in ("error","pageerror")]
    print("errors:", errs[:5])
    print("VERDICT:", "ENTERED " + str(after["course"]) if after["course"]!=before["course"] or after["state"]=="card" else "DID NOT ENTER")
    br.close()
