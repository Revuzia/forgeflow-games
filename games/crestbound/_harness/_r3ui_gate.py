import json, sys, time
from playwright.sync_api import sync_playwright
for s in (sys.stdout, sys.stderr):
    try: s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass
URL = "http://localhost:8788/games/crestbound/index.html?dev=1"
ARGS = ["--use-angle=d3d11","--ignore-gpu-blocklist","--enable-gpu-rasterization",
        "--disable-features=CalculateNativeWinOcclusion"]
with sync_playwright() as pw:
    b = pw.chromium.launch(channel="chrome", headless=True, args=ARGS)
    pg = b.new_page(viewport={"width":1280,"height":720})
    errs=[]; pg.on("console", lambda m: errs.append(m.text) if m.type=="error" else None)
    pg.goto(URL, wait_until="load", timeout=60000)
    pg.wait_for_function("() => window.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.state", timeout=60000)
    # skip title into keep
    pg.evaluate("""async () => { const g=CRESTBOUND.game;
      if (g.state==='title'){ if(g.menu) g.menu.close(); await g.startNewGame?.(); }
    }""")
    t0=time.time()
    while time.time()-t0<40:
        st = pg.evaluate("() => CRESTBOUND.game.state")
        if st=="keep": break
        pg.keyboard.press("Enter"); pg.wait_for_timeout(400)
    print("state", pg.evaluate("() => CRESTBOUND.game.state"))
    gate = pg.evaluate("""() => { const gs=CRESTBOUND.game.__dev.gates();
      const g=gs.find(x=>x.course==='verdant-1');
      return g?{course:g.course,pos:[g.pos.x,g.pos.y,g.pos.z],yaw:g.yaw,locked:g.locked,hasVolume:!!g.volume,label:g.label}:null; }""")
    print("gate", json.dumps(gate))
    # place 4.2m out on side -1 and walk in, sampling
    pg.evaluate("""(g) => { const G=CRESTBOUND.game, yaw=g.yaw||0, side=-1, d=4.2;
      const hx=-Math.sin(yaw)*side, hz=-Math.cos(yaw)*side;
      G.__dev.tp(g.pos[0]+hx*d, g.pos[1]+0.15, g.pos[2]+hz*d);
      const p=G.player; p.__test.setFacing(yaw); if(G.cam){G.cam.yaw=yaw; G.cam.recenter();}
    }""", gate)
    pg.wait_for_timeout(1500)
    pg.keyboard.down("KeyW")
    samples=[]
    t0=time.time()
    while time.time()-t0<6:
        s = pg.evaluate("""(g) => { const G=CRESTBOUND.game,p=G.player;
          const dx=p.pos.x-g.pos[0], dz=p.pos.z-g.pos[2];
          return {t:+(performance.now()/1000).toFixed(2), state:G.state, pst:p.state,
                  pos:[+p.pos.x.toFixed(2),+p.pos.y.toFixed(2),+p.pos.z.toFixed(2)],
                  d:+Math.hypot(dx,dz).toFixed(2), dy:+(p.pos.y-g.pos[1]).toFixed(2),
                  near:G._gateNear, dwell:+(G._gateDwell||0).toFixed(3), spd:+Math.hypot(p.vel.x,p.vel.z).toFixed(2)}; }""", gate)
        samples.append(s)
        if s["state"]!="keep": break
        pg.wait_for_timeout(200)
    pg.keyboard.up("KeyW")
    for s in samples: print(json.dumps(s))
    print("final state", pg.evaluate("() => CRESTBOUND.game.state"))
    # now try teleporting right up to the gate to see if it fires at all
    pg.evaluate("""(g) => { const G=CRESTBOUND.game, yaw=g.yaw||0, side=-1, d=1.2;
      const hx=-Math.sin(yaw)*side, hz=-Math.cos(yaw)*side;
      G.__dev.tp(g.pos[0]+hx*d, g.pos[1]+0.15, g.pos[2]+hz*d);
      const p=G.player; p.__test.setFacing(yaw); }""", gate)
    pg.wait_for_timeout(1200)
    print("after close tp:", pg.evaluate("""(g)=>{const G=CRESTBOUND.game,p=G.player;
      const dx=p.pos.x-g.pos[0],dz=p.pos.z-g.pos[2];
      return JSON.stringify({state:G.state,d:+Math.hypot(dx,dz).toFixed(2),dy:+(p.pos.y-g.pos[1]).toFixed(2),near:G._gateNear,pos:[+p.pos.x.toFixed(2),+p.pos.y.toFixed(2),+p.pos.z.toFixed(2)]});}""", gate))
    print("errs", errs[:5])
    b.close()
