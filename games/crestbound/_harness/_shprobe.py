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
    # pin the hero at the wing-crest plaza and freeze the cam like shots.py
    pg.evaluate("""async () => {
      const A=globalThis.CRESTBOUND,G=A.game,THREE=A.THREE;
      G.player.__test.teleport(new THREE.Vector3(-5.00,3.25,41.00));
      G.player.__test.setVel(new THREE.Vector3(0,0,0));
      G.cam.dist=8; G.cam.recenter&&G.cam.recenter();
      for(let i=0;i<60;i++) await new Promise(r=>requestAnimationFrame(r));
    }""")
    pg.wait_for_timeout(500)
    pg.screenshot(path=os.path.join(ROOT,"_shots","_probe_sh_all.png"))
    print(json.dumps(pg.evaluate("""() => {
      const A=globalThis.CRESTBOUND, C=A.game.course; const out={};
      let g=null, terr=null;
      A.engine.scene.traverse(o=>{ if(o.name==='terrain.grass') g=o; if(o.name&&o.name.indexOf('terrain')===0&&o!==g) terr=o; });
      out.grass=!!g; out.grassCount=g?g.count:0; out.terrainName=terr?terr.name:null;
      let blob=null; A.engine.scene.traverse(o=>{ if(o.name==='nim.shadowBlob') blob=o; });
      out.blob = !!blob; out.blobOp = blob? blob.material.uniforms.uOpacity.value : null;
      out.blobColor = blob? blob.material.uniforms.uColor.value.toArray() : null;
      out.blobVisible = blob? blob.visible : null;
      if(blob) blob.visible=false;
      A.engine.sun.castShadow=false;
      let dec=[]; A.engine.scene.traverse(o=>{ if(o.name&&/decal/i.test(o.name)) {dec.push(o.name); o.visible=false;} });
      out.decals=dec;
      out.heroY=A.game.player.pos.y;
      const hf=C.broadphase&&C.broadphase.heightfields&&C.broadphase.heightfields[0];
      out.hfAt = hf? hf.heightAt(-5,41) : null;
      out.sunShadow = A.engine.sun ? {cast:A.engine.sun.castShadow, int:A.engine.sun.intensity} : null;
      return out; }""")))
    pg.wait_for_timeout(700)
    pg.screenshot(path=os.path.join(ROOT,"_shots","_probe_sh_noshadow.png"))
    b.close()
