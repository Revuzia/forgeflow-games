"""Crest celebration STAGING gate: is Nim actually on screen for the whole orbit?

Collects the crest by CONTACT (a real KeyW press into it), then every ~110 ms of
the 2.2 s orbit records (a) the nearest mesh straight ahead of the lens and
(b) whether the hero is inside the frustum AND unoccluded on the camera->hero ray.
"""
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
PROBE = """()=>{
  const g=CRESTBOUND.game, e=CRESTBOUND.engine, THREE=CRESTBOUND.THREE, cam=e.camera;
  const list=[]; e.scene.traverse(o=>{ if(o.isMesh&&o.visible) list.push(o); });
  const fwd=new THREE.Vector3(); cam.getWorldDirection(fwd);
  const rc=new THREE.Raycaster(); rc.far=200;
  rc.set(cam.position.clone(), fwd);
  const ahead=rc.intersectObjects(list,false).slice(0,1).map(x=>({n:x.object.name||x.object.type,d:+x.distance.toFixed(2)}));
  const h=g.hero&&g.hero.root?g.hero.root:null;
  let onScreen=null, ndc=null, heroD=null, blocker=null;
  if(h){
    const hp=h.getWorldPosition(new THREE.Vector3()); hp.y+=0.9;
    const v=hp.clone().project(cam);
    ndc=[+v.x.toFixed(3),+v.y.toFixed(3),+v.z.toFixed(3)];
    const inFrust = Math.abs(v.x)<=1 && Math.abs(v.y)<=1 && v.z>-1 && v.z<1;
    const dir=hp.clone().sub(cam.position); heroD=+dir.length().toFixed(2); dir.normalize();
    rc.set(cam.position.clone(), dir);
    const hits=rc.intersectObjects(list,false);
    // ignore hits on the hero's own meshes
    let firstOther=null;
    for(const x of hits){ let o=x.object,mine=false; while(o){ if(o===h){mine=true;break;} o=o.parent; }
      if(!mine){ firstOther=x; break; } }
    const clear = !firstOther || firstOther.distance > heroD-0.35;
    if(firstOther && !clear) blocker={n:firstOther.object.name||firstOther.object.type,d:+firstOther.distance.toFixed(2)};
    onScreen = inFrust && clear;
  }
  const hp=g.player&&g.player.pos?g.player.pos:null;
  let diag=null;
  if(hp){
    const hc=new THREE.Vector3(hp.x,hp.y+0.9,hp.z);
    const k1=new THREE.Vector3().fromArray(g._orbitPath.cam[1].p);
    const dr=k1.clone().sub(hc); const dd2=dr.length(); dr.normalize();
    const rc2=new THREE.Raycaster(); rc2.set(hc.clone(),dr); rc2.near=0.02; rc2.far=dd2;
    const hl=(g._orbMeshes||[]).length? rc2.intersectObjects(g._orbMeshes,false).slice(0,2).map(x=>({n:x.object.name||x.object.type,t:+x.distance.toFixed(2)})):null;
    const keys=g._orbitPath.cam.map((kk,ii)=>({i:ii, p:kk.p.map(v=>+v.toFixed(2)),
       h:+g._segScore(hc,{x:kk.p[0],y:kk.p[1],z:kk.p[2]}).toFixed(2)}));
    diag={orbN:(g._orbMeshes||[]).length, rays:g._orbRays, stageMs:+(g.lastOrbitStageMs||0).toFixed(1), keys};
  }
  return {state:g.state, clearT:+(g._clearT||0).toFixed(0), ahead, onScreen, heroD, blocker,
          hero: hp?[+hp.x.toFixed(2),+hp.y.toFixed(2),+hp.z.toFixed(2)]:null,
          cam:[+cam.position.x.toFixed(2),+cam.position.y.toFixed(2),+cam.position.z.toFixed(2)],
          k0:(g._orbitPath.cam[0].p||[]).map(v=>+v.toFixed(2)),
          look:(g._orbitPath.cam[0].look||[]).map(v=>+v.toFixed(2)), diag};
}"""
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
    tgt=pg.evaluate("""()=>{const g=CRESTBOUND.game; const d=(g.def&&g.def.crests||[]).find(c=>c.id==='open'); return d?(d.p||d.spawnAt):null;}""")
    print("crest p:",tgt)
    pg.evaluate("([x,y,z])=>CRESTBOUND.game.__dev.tp(x, y-0.2, z+2.2)", tgt)
    pg.wait_for_timeout(1200)
    pg.evaluate("()=>CRESTBOUND.game.input.__test.press('KeyW')")
    pg.wait_for_timeout(900)
    pg.evaluate("()=>CRESTBOUND.game.input.__test.release('KeyW')")
    st=pg.evaluate("()=>CRESTBOUND.game.state"); print("state after walk:",st)
    rows=[]
    prev=0
    for ms in [120,250,400,550,700,850,1000,1200,1400,1600,1800,2000,2150]:
        pg.wait_for_timeout(max(10,ms-prev)); prev=ms
        r=pg.evaluate(PROBE); r["t"]=ms; rows.append(r)
        print("%5d %s" % (ms, json.dumps(r)))
        if ms in (250,800,1500,2000): still("_z_celeb_%d.png"%ms)
    bad=[r for r in rows if r["state"]=="clear" and r["onScreen"] is False]
    print("\nORBIT SAMPLES in state=clear:", len([r for r in rows if r["state"]=="clear"]))
    print("HERO OCCLUDED/OFFSCREEN FRAMES:", len(bad), json.dumps(bad)[:900])
    b.close()
