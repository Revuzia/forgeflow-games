"""Repeat the painting walk-in N times and record why it fails when it fails."""
import json, sys, time
from playwright.sync_api import sync_playwright
for s in (sys.stdout, sys.stderr):
    try: s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass
URL = "http://localhost:8788/games/crestbound/index.html?dev=1"
ARGS = ["--use-angle=d3d11","--ignore-gpu-blocklist","--enable-gpu-rasterization",
        "--disable-features=CalculateNativeWinOcclusion"]
N = int(sys.argv[1]) if len(sys.argv) > 1 else 5
res = []
with sync_playwright() as pw:
    b = pw.chromium.launch(channel="chrome", headless=True, args=ARGS)
    pg = b.new_page(viewport={"width":1280,"height":720})
    pg.goto(URL, wait_until="load", timeout=60000)
    pg.wait_for_function("() => window.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.state", timeout=60000)
    pg.evaluate("""async () => { const g=CRESTBOUND.game; if (g.state==='title'){ if(g.menu) g.menu.close(); await g.startNewGame?.(); } }""")
    t0=time.time()
    while time.time()-t0<40:
        if pg.evaluate("() => CRESTBOUND.game.state")=="keep": break
        pg.keyboard.press("Enter"); pg.wait_for_timeout(400)
    gate = pg.evaluate("""() => { const gs=CRESTBOUND.game.__dev.gates(); const g=gs.find(x=>x.course==='verdant-1');
      return {pos:[g.pos.x,g.pos.y,g.pos.z], yaw:g.yaw}; }""")
    print("gate", json.dumps(gate)); sys.stdout.flush()
    for trial in range(N):
        # bail out of any card back to the keep
        pg.evaluate("""() => { const g=CRESTBOUND.game; if (g.state==='card' && g.card) g.card.cancel?.(); }""")
        pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
        pg.evaluate("""() => { const g=CRESTBOUND.game; if (g.menu&&g.menu.isOpen) g.menu.close(); }""")
        t0=time.time()
        while time.time()-t0<20 and pg.evaluate("()=>CRESTBOUND.game.state")!="keep":
            pg.keyboard.press("Escape"); pg.wait_for_timeout(400)
        pg.evaluate("""(g) => { const G=CRESTBOUND.game, yaw=g.yaw||0, side=-1, d=4.2;
          const hx=-Math.sin(yaw)*side, hz=-Math.cos(yaw)*side;
          G.__dev.tp(g.pos[0]+hx*d, g.pos[1]+0.15, g.pos[2]+hz*d);
          const p=G.player; p.__test.setFacing(yaw); if(G.cam){G.cam.yaw=yaw; G.cam.recenter();} }""", gate)
        pg.wait_for_timeout(1500)
        pre = pg.evaluate("""()=>{const c=CRESTBOUND.game.cam,p=CRESTBOUND.game.player;
          return {camYaw:+c.yaw.toFixed(3),slide:+((c._yawSlide||0)).toFixed(3),yfm:+c.yawForMovement.toFixed(3),
                  facing:+p.facing.toFixed(3),pos:[+p.pos.x.toFixed(2),+p.pos.y.toFixed(2),+p.pos.z.toFixed(2)],
                  grounded:!!p.grounded};}""")
        pg.keyboard.down("KeyW")
        trace=[]; t0=time.time(); got=None
        while time.time()-t0<8:
            s = pg.evaluate("""(g)=>{const G=CRESTBOUND.game,p=G.player,c=G.cam,i=G.input;
              const dx=p.pos.x-g.pos[0],dz=p.pos.z-g.pos[2];
              return {st:G.state,d:+Math.hypot(dx,dz).toFixed(2),x:+p.pos.x.toFixed(2),z:+p.pos.z.toFixed(2),
                camYaw:+c.yaw.toFixed(3),slide:+((c._yawSlide||0)).toFixed(3),yfm:+c.yawForMovement.toFixed(3),
                mvx:+i.move.x.toFixed(2),mvy:+i.move.y.toFixed(2),
                vx:+p.vel.x.toFixed(2),vz:+p.vel.z.toFixed(2),pst:p.state,near:G._gateNear};}""", gate)
            trace.append(s)
            if s["st"]!="keep": got=s["st"]; break
            pg.wait_for_timeout(120)
        pg.keyboard.up("KeyW")
        minD = min(t["d"] for t in trace)
        maxSlide = max(abs(t["slide"]) for t in trace)
        yawSpread = max(t["camYaw"] for t in trace)-min(t["camYaw"] for t in trace)
        r = {"trial":trial,"entered":got=="card","end":got,"minD":minD,"maxSlide":round(maxSlide,3),
             "camYawSpread":round(yawSpread,3),"pre":pre,
             "path":[[t["x"],t["z"]] for t in trace][:14]}
        res.append(r)
        print(json.dumps(r)); sys.stdout.flush()
        if not r["entered"]:
            print("  TRACE:"); 
            for t in trace[:16]: print("   ", json.dumps(t))
    b.close()
print("SUMMARY entered %d/%d" % (sum(1 for r in res if r["entered"]), len(res)))
