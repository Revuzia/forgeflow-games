import base64, json, os, sys
from playwright.sync_api import sync_playwright
try: sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception: pass
HERE=os.path.dirname(os.path.abspath(__file__))
OUT=os.path.normpath(os.path.join(HERE,"..","_shots","ui"))
URL="http://localhost:8788/games/crestbound/index.html?dev=1"
FLAGS=["--ignore-gpu-blocklist","--use-angle=d3d11","--disable-gpu-sandbox","--enable-gpu-rasterization",
       "--disable-features=CalculateNativeWinOcclusion","--autoplay-policy=no-user-gesture-required",
       "--force-device-scale-factor=1"]
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome",headless=True,args=FLAGS)
    ctx=b.new_context(viewport={"width":1600,"height":900}); pg=ctx.new_page()
    cdp=ctx.new_cdp_session(pg)
    def still(n):
        d=cdp.send("Page.captureScreenshot",{"format":"png"})
        open(os.path.join(OUT,n),"wb").write(base64.b64decode(d["data"])); print("  shot",n)
    pg.goto(URL); pg.wait_for_function("()=>window.CRESTBOUND&&CRESTBOUND.game&&CRESTBOUND.game.state==='title'",timeout=120000)
    pg.evaluate("()=>{try{CRESTBOUND.game.menu.close()}catch(e){}; CRESTBOUND.game.__dev.goto('verdant-1')}")
    pg.wait_for_function("()=>CRESTBOUND.game.state==='playing'",timeout=180000)
    pg.wait_for_timeout(2500)
    pg.evaluate("()=>{try{CRESTBOUND.game.menu.close()}catch(e){}}")
    # find the live 'open' crest node and tp just below it, then let contact fire
    tgt=pg.evaluate("""()=>{
      const g=CRESTBOUND.game; const d=(g.def&&g.def.crests||[]).find(c=>c.id==='open');
      return d? (d.p||d.spawnAt) : null; }""")
    print("crest p:",tgt)
    pg.evaluate("([x,y,z])=>CRESTBOUND.game.__dev.tp(x, y-0.2, z+2.2)", tgt)
    pg.wait_for_timeout(1200)
    # face the crest: press W to walk into it
    pg.evaluate("()=>CRESTBOUND.game.input.__test.press('KeyW')")
    pg.wait_for_timeout(900)
    pg.evaluate("()=>CRESTBOUND.game.input.__test.release('KeyW')")
    st=pg.evaluate("()=>CRESTBOUND.game.state"); print("state after walk:",st)
    if st!='clear':
        pg.evaluate("()=>CRESTBOUND.game.__dev.give('open')")
    prev=0
    for ms in [250,500,800,1100,1500,2000]:
        pg.wait_for_timeout(ms-prev); prev=ms
        info=pg.evaluate("""()=>{
          const e=CRESTBOUND.engine, THREE=CRESTBOUND.THREE, cam=e.camera;
          const rc=new THREE.Raycaster(); const d=new THREE.Vector3(); cam.getWorldDirection(d);
          rc.set(cam.position.clone(), d); rc.far=200;
          const list=[]; e.scene.traverse(o=>{ if(o.isMesh&&o.visible) list.push(o); });
          const h=rc.intersectObjects(list,false).slice(0,3).map(x=>({n:x.object.name||x.object.type,d:+x.distance.toFixed(2)}));
          return {state:CRESTBOUND.game.state, hits:h};
        }""")
        print(ms,"ms",json.dumps(info))
        still("_j_celeb2_%d.png"%ms)
    b.close()
