import json,os,sys,time
from playwright.sync_api import sync_playwright
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.dirname(HERE)
FLAGS=["--ignore-gpu-blocklist","--use-angle=d3d11","--disable-gpu-sandbox","--enable-gpu-rasterization",
       "--disable-features=CalculateNativeWinOcclusion","--autoplay-policy=no-user-gesture-required","--force-device-scale-factor=1"]
with sync_playwright() as pw:
    b=pw.chromium.launch(channel="chrome",headless=True,args=FLAGS)
    pg=b.new_page(viewport={"width":1600,"height":900})
    pg.goto("http://localhost:8788/games/crestbound/index.html?dev=1",wait_until="domcontentloaded")
    pg.wait_for_function("globalThis.CRESTBOUND && CRESTBOUND.game",timeout=60000)
    CLICK="""() => { const bs=Array.from(document.querySelectorAll('button'));
      for (const w of ['NEW GAME','NEW RUN','CONTINUE','PLAY','START','BEGIN','ENTER'])
        for (const b of bs) if ((b.textContent||'').toUpperCase().includes(w)) { b.click(); return w; } return null; }"""
    dl=time.time()+45
    while time.time()<dl:
        if pg.evaluate("CRESTBOUND.game.state") in ("keep","playing"): break
        pg.evaluate(CLICK); pg.wait_for_timeout(400)
    pg.evaluate("async()=>{await CRESTBOUND.game.__dev.goto('verdant-1')}")
    dl=time.time()+120
    while time.time()<dl:
        if pg.evaluate("!!(CRESTBOUND.game.course && CRESTBOUND.game.courseId==='verdant-1')"): break
        pg.evaluate(CLICK); pg.wait_for_timeout(400)
    pg.wait_for_timeout(2500)
    print(json.dumps(pg.evaluate("""() => {
      const A=globalThis.CRESTBOUND, THREE=A.THREE;
      const target=new THREE.Vector3(-5,2.2,41); const out=[]; const wp=new THREE.Vector3();
      A.engine.scene.traverse(o=>{
        if(!o.isMesh && !o.isInstancedMesh) return;
        o.getWorldPosition(wp);
        const d=wp.distanceTo(target);
        if(d>6) return;
        const m=o.material;
        const mn = Array.isArray(m)? m.map(x=>x&&x.name).join('|') : (m&&m.name);
        out.push({name:o.name, d:+d.toFixed(2), mat:mn, inst:o.isInstancedMesh?o.count:0,
                  parent:o.parent&&o.parent.name});
      });
      out.sort((a,b)=>a.d-b.d); return out.slice(0,24);
    }"""), indent=1))
    b.close()
