import json,os,sys,time
from playwright.sync_api import sync_playwright
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.dirname(HERE)
FLAGS=["--ignore-gpu-blocklist","--use-angle=d3d11","--disable-gpu-sandbox",
 "--enable-gpu-rasterization","--disable-features=CalculateNativeWinOcclusion",
 "--autoplay-policy=no-user-gesture-required","--force-device-scale-factor=1"]
COURSE=sys.argv[1] if len(sys.argv)>1 else 'verdant-1'
URL=f"http://localhost:8788/games/crestbound/index.html?dev=1&course={COURSE}"
BIG=r"""
()=>{
 const A=globalThis.CRESTBOUND,G=A.game,T=A.THREE;
 const cam=G.engine.camera; cam.updateMatrixWorld(true);
 const vp=new T.Matrix4().multiplyMatrices(cam.projectionMatrix,cam.matrixWorldInverse);
 const out=[];
 const bb=new T.Box3(), v=new T.Vector3();
 G.engine.scene.traverseVisible(o=>{
  if(!o.isMesh&&!o.isPoints) return;
  const g=o.geometry; if(!g) return;
  if(!g.boundingBox) g.computeBoundingBox();
  bb.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
  let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9,any=false;
  for(let i=0;i<8;i++){
   v.set(i&1?bb.max.x:bb.min.x, i&2?bb.max.y:bb.min.y, i&4?bb.max.z:bb.min.z);
   v.applyMatrix4(vp);
   if(v.z<-1) continue; any=true;
   x0=Math.min(x0,v.x);x1=Math.max(x1,v.x);y0=Math.min(y0,v.y);y1=Math.max(y1,v.y);
  }
  if(!any){x0=x1=y0=y1=0;}
  const w=Math.min(1,x1)-Math.max(-1,x0), h=Math.min(1,y1)-Math.max(-1,y0);
  if(w<=0||h<=0) return;
  const area=(w*h)/4;
  const m=o.material; const mm=Array.isArray(m)?m[0]:m;
  const idx=g.getIndex(); const cnt=idx?idx.count:(g.attributes.position?g.attributes.position.count:0);
  const tris=Math.round(cnt/3)*(o.isInstancedMesh?o.count:1);
  out.push({n:o.name||'(anon)',mat:(mm&&(mm.name||mm.type))||'',tris:tris,area:+area.toFixed(3)});
 });
 out.sort((a,b)=>b.area-a.area);
 return out.slice(0,26);
}
"""
with sync_playwright() as p:
    br=p.chromium.launch(channel="chrome",headless=True,args=FLAGS+["--headless=new"])
    pg=br.new_page(viewport={"width":1600,"height":900})
    pg.goto(URL); 
    t=time.time()
    while time.time()-t<70:
        try:
            st=pg.evaluate("globalThis.CRESTBOUND&&CRESTBOUND.game&&CRESTBOUND.game.state")
        except Exception: st=None
        if st in ("keep","playing"): break
        try:
            pg.evaluate("""()=>{const b=[...document.querySelectorAll('button')];for(const x of b){const t=(x.textContent||'').toUpperCase();if(/NEW|CONTINUE|PLAY|START|ENTER/.test(t)){x.__activate?x.__activate():x.click();return}}}""")
        except Exception: pass
        pg.wait_for_timeout(400)
    pg.wait_for_timeout(2500)
    print(json.dumps(pg.evaluate(BIG),indent=1))
    br.close()
