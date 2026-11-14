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
    pg.evaluate("()=>CRESTBOUND.game.__dev.goto('verdant-1')")
    pg.wait_for_function("()=>CRESTBOUND.game.state==='playing'",timeout=180000)
    pg.wait_for_timeout(2500)
    pg.evaluate("()=>CRESTBOUND.game.__dev.give('open')")
    for i,ms in enumerate([300,500,700,900,1200,1800]):
        pg.wait_for_timeout(ms if i==0 else ms-[300,500,700,900,1200,1800][i-1])
        info=pg.evaluate("""()=>{
          const g=CRESTBOUND.game, e=CRESTBOUND.engine, THREE=CRESTBOUND.THREE;
          const cam=e.camera;
          const rc=new THREE.Raycaster(); const d=new THREE.Vector3();
          cam.getWorldDirection(d); rc.set(cam.position.clone(), d); rc.far=200;
          const list=[]; e.scene.traverse(o=>{ if(o.isMesh && o.visible) list.push(o); });
          const hits=rc.intersectObjects(list,false).slice(0,4)
            .map(h=>({name:h.object.name||h.object.type, d:+h.distance.toFixed(2),
                      mat:(h.object.material&&h.object.material.name)||'',
                      geo:(h.object.geometry&&h.object.geometry.type)||''}));
          return {t:+g._clearT, camp:cam.position.toArray().map(v=>+v.toFixed(2)), hits};
        }""")
        print(json.dumps(info))
        still("_j_celeb_%d.png"%i)
    b.close()
