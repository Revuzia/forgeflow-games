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

    # world geometry of every text sign the course built
    info=pg.evaluate("""()=>{
      const g=CRESTBOUND.game, THREE=CRESTBOUND.THREE, c=g.course;
      const out=[];
      (c.texts||[]).forEach((grp,i)=>{
        const bb=new THREE.Box3().setFromObject(grp);
        const s=new THREE.Vector3(); bb.getSize(s);
        const pl=grp.children.find(o=>o.isMesh&&o.geometry&&o.geometry.type==='PlaneGeometry');
        let quad=null;
        if(pl){ pl.geometry.computeBoundingBox(); const q=pl.geometry.boundingBox;
                quad=[+(q.max.x-q.min.x).toFixed(3),+(q.max.y-q.min.y).toFixed(3)]; }
        out.push({i, p:[+grp.position.x.toFixed(2),+grp.position.y.toFixed(2),+grp.position.z.toFixed(2)],
                  yaw:+grp.rotation.y.toFixed(3),
                  plate:[+s.x.toFixed(3),+s.y.toFixed(3),+s.z.toFixed(3)], quad});
      });
      return {n:(c.texts||[]).length, texts:out.slice(0,6),
              defs:(g.def.objects||[]).filter(o=>o.kind==='text').slice(0,4).map(o=>({p:o.p,size:o.size,t:o.text}))};
    }""")
    print(json.dumps(info,indent=1))

    # stand in front of the teaching sign
    pg.evaluate("()=>CRESTBOUND.game.__dev.tp(3.0, 3.4, 45.4)")
    pg.wait_for_timeout(1500)
    still("_z_sign_far.png")
    pg.evaluate("()=>CRESTBOUND.game.__dev.tp(3.0, 3.4, 43.6)")
    pg.wait_for_timeout(1500)
    still("_z_sign_near.png")
    b.close()
