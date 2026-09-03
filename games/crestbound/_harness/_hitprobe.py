import json,os,time
from playwright.sync_api import sync_playwright
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.dirname(HERE)
FLAGS=["--ignore-gpu-blocklist","--use-angle=d3d11","--disable-gpu-sandbox","--enable-gpu-rasterization",
       "--disable-features=CalculateNativeWinOcclusion","--autoplay-policy=no-user-gesture-required","--force-device-scale-factor=1"]
CLICK="""() => { const bs=Array.from(document.querySelectorAll('button'));
  for (const w of ['NEW GAME','NEW RUN','CONTINUE','PLAY','START','BEGIN','ENTER'])
    for (const b of bs) if ((b.textContent||'').toUpperCase().includes(w)) { b.click(); return w; } return null; }"""
with sync_playwright() as pw:
    b=pw.chromium.launch(channel="chrome",headless=True,args=FLAGS)
    pg=b.new_page(viewport={"width":1600,"height":900})
    pg.goto("http://localhost:8788/games/crestbound/index.html?dev=1",wait_until="domcontentloaded")
    pg.wait_for_function("globalThis.CRESTBOUND && CRESTBOUND.game",timeout=60000)
    dl=time.time()+45
    while time.time()<dl:
        if pg.evaluate("CRESTBOUND.game.state") in ("keep","playing"): break
        pg.evaluate(CLICK); pg.wait_for_timeout(400)
    pg.evaluate("async()=>{await CRESTBOUND.game.__dev.goto('verdant-1')}")
    dl=time.time()+120
    while time.time()<dl:
        if pg.evaluate("!!(CRESTBOUND.game.course && CRESTBOUND.game.courseId==='verdant-1')"): break
        pg.evaluate(CLICK); pg.wait_for_timeout(400)
    pg.wait_for_timeout(2000)
    pg.evaluate("""async () => {
      const A=globalThis.CRESTBOUND,G=A.game,THREE=A.THREE;
      G.player.__test.teleport(new THREE.Vector3(-5.00,3.25,41.00));
      G.player.__test.setVel(new THREE.Vector3(0,0,0));
      G.cam.dist=8; G.cam.recenter&&G.cam.recenter();
      for(let i=0;i<60;i++) await new Promise(r=>requestAnimationFrame(r));
    }""")
    print(json.dumps(pg.evaluate("""() => {
      const A=globalThis.CRESTBOUND, THREE=A.THREE, cam=A.engine.camera;
      const rc=new THREE.Raycaster();
      const pick=(px,py)=>{
        rc.setFromCamera(new THREE.Vector2(px/800-1, 1-py/450), cam);
        const hits=rc.intersectObject(A.engine.scene, true).filter(h=>h.object.visible && h.object.type!=='Sprite');
        return hits.slice(0,3).map(h=>({n:h.object.name||h.object.type, m:(Array.isArray(h.object.material)?h.object.material.map(x=>x&&(x.name||x.type)).join('|'):(h.object.material&&(h.object.material.name||h.object.material.type))),
          p:[+h.point.x.toFixed(2),+h.point.y.toFixed(2),+h.point.z.toFixed(2)],
          par:h.object.parent&&h.object.parent.name, d:+h.distance.toFixed(2)}));
      };
      return {black: pick(790,760), white: pick(700,745), grass: pick(1050,760)};
    }"""), indent=1))
    b.close()
