from playwright.sync_api import sync_playwright
import json
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":1280,"height":800})
    errs=[]; logs=[]
    pg.on("console", lambda m: (errs.append(m.text) if m.type=="error" else logs.append(m.text)))
    pg.on("pageerror", lambda e: errs.append("PAGEERR: "+str(e)))
    pg.goto("http://localhost:8780/games/iron-tide/", wait_until="load", timeout=60000)
    pg.wait_for_timeout(4000)
    info = pg.evaluate("""()=>{
      const K=window.__FFG3D__&&window.__FFG3D__.kernel; if(!K) return {boot:false};
      const sc=K.scene; const types={};
      sc.traverse(o=>{const n=o.type||'?'; types[n]=(types[n]||0)+1; if(o.constructor&&o.constructor.name){const cn=o.constructor.name; types['cls:'+cn]=(types['cls:'+cn]||0)+1;}});
      let waterY=null, waterVis=null, skyVis=null;
      sc.traverse(o=>{ if(o.constructor&&o.constructor.name==='Water'){waterY=o.position.y;waterVis=o.visible;} if(o.constructor&&o.constructor.name==='Sky'){skyVis=o.visible;} });
      return {boot:true, bg:(sc.background&&sc.background.getHexString?('#'+sc.background.getHexString()):String(sc.background)), fog:String(sc.fog), waterY, waterVis, skyVis, camY:K.camera.position.y, types};
    }""")
    print(json.dumps({"info":info,"errors":errs[:15],"logs":logs[:8]}, indent=2))
    b.close()
