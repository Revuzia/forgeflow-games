"""End-to-end UV check: for a sample of each part's vertices, compare the texel
the ORIGINAL material sampled (source image at frac(uv*repeat)) with the texel
the MERGED material samples (atlas page at the remapped uv)."""
import time
from playwright.sync_api import sync_playwright
FLAGS=["--ignore-gpu-blocklist","--use-angle=d3d11","--disable-gpu-sandbox","--enable-gpu-rasterization",
       "--disable-features=CalculateNativeWinOcclusion","--autoplay-policy=no-user-gesture-required"]
CLICK=r"""() => {const w=['CONTINUE','KEEP MY PROGRESS','NEW GAME','NEW RUN','PLAY','START','BEGIN','ENTER'];
 for(const q of w) for(const b of Array.from(document.querySelectorAll('button'))){
  if((b.textContent||'').toUpperCase().indexOf(q)<0) continue; const r=b.getBoundingClientRect();
  if(b.disabled||r.width<4) continue; if(b.__activate)b.__activate(); else b.click(); return q;} return null;}"""
JS=r"""() => {
  const h=globalThis.CRESTBOUND.game.hero, A=h._atlas, S=h._atlasSlots;
  const pg=A.pages.map; if(!pg) return 'no map page';
  const ac=document.createElement('canvas'); ac.width=A.size; ac.height=A.size;
  const ag=ac.getContext('2d',{willReadFrequently:true}); ag.drawImage(pg.cv,0,0);
  const AD=ag.getImageData(0,0,A.size,A.size).data;
  const byName={}; h.root.traverse(o=>{ if(o.isMesh) byName[o.name]=o; });
  const out=[];
  for(const e of S){
    const mesh=byName[e.name]; if(!mesh) continue;
    const m=e.mat; const img=m.map&&m.map.image; if(!img) continue;
    const sc=document.createElement('canvas'); sc.width=img.width; sc.height=img.height;
    const sg=sc.getContext('2d',{willReadFrequently:true}); sg.drawImage(img,0,0);
    const SD=sg.getImageData(0,0,img.width,img.height).data;
    const uv=mesh.geometry.attributes.uv; if(!uv) continue;
    let n=0, so=0, ao=0, worst=0;
    const step=Math.max(1, Math.floor(uv.count/300));
    for(let i=0;i<uv.count;i+=step){
      const u=uv.array[i*2], v=uv.array[i*2+1];
      // original: RepeatWrapping on u*rep, v*rep ; canvas row = (1-v)*H
      let su=(u*e.rep)%1; if(su<0) su+=1;
      let sv=(v*e.rep)%1; if(sv<0) sv+=1;
      const sx=Math.min(img.width-1, Math.floor(su*img.width));
      const sy=Math.min(img.height-1, Math.floor((1-sv)*img.height));
      const sVal=SD[(sy*img.width+sx)*4];
      // merged: remapped uv into the atlas
      const nu=e.slot.u0+(u-e.u0)/e.span*e.slot.du;
      const nv=e.slot.v0+(v-e.v0)/e.span*e.slot.dv;
      const ax=Math.min(A.size-1, Math.max(0, Math.floor(nu*A.size)));
      const ay=Math.min(A.size-1, Math.max(0, Math.floor((1-nv)*A.size)));
      const aVal=AD[(ay*A.size+ax)*4];
      so+=sVal; ao+=aVal; n++; worst=Math.max(worst, Math.abs(sVal-aVal));
    }
    out.push({name:e.name, n, src:+(so/n).toFixed(1), atlas:+(ao/n).toFixed(1), worst,
              rep:e.rep, span:+e.span.toFixed(3), u0:+e.u0.toFixed(3), v0:+e.v0.toFixed(3)});
  }
  return out; }"""
with sync_playwright() as p:
    br=p.chromium.launch(channel="chrome",headless=True,args=FLAGS)
    pg=br.new_page(viewport={"width":900,"height":700})
    pg.add_init_script("globalThis.CB_KEEP_PARTS = true;")
    pg.goto("http://localhost:8788/games/crestbound/index.html?dev=1&quality=high",wait_until="load",timeout=60000)
    dl=time.time()+60
    while time.time()<dl:
        if pg.evaluate("!!(globalThis.CRESTBOUND&&CRESTBOUND.game)"):break
        pg.wait_for_timeout(300)
    dl=time.time()+60
    while time.time()<dl:
        if pg.evaluate("CRESTBOUND.game.state") in ("keep","playing"):break
        pg.evaluate(CLICK); pg.wait_for_timeout(400)
    pg.wait_for_timeout(1500)
    r=pg.evaluate(JS)
    if isinstance(r,str): print(r)
    else:
        for x in r: print("%-16s n=%3d src=%6.1f atlas=%6.1f worst=%3d  rep=%.3f span=%.3f u0=%.3f v0=%.3f"%(
            x['name'],x['n'],x['src'],x['atlas'],x['worst'],x['rep'],x['span'],x['u0'],x['v0']))
    br.close()
