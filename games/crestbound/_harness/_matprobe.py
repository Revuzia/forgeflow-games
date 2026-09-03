import os,sys,time,json
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
BASE="http://localhost:8788/games/crestbound/index.html"
FLAGS=["--disable-gpu-vsync","--disable-frame-rate-limit","--ignore-gpu-blocklist","--use-angle=d3d11",
 "--disable-gpu-sandbox","--enable-gpu-rasterization","--disable-features=CalculateNativeWinOcclusion",
 "--autoplay-policy=no-user-gesture-required"]
CLICK=r"""() => { const w=['CONTINUE','KEEP MY PROGRESS','NEW GAME','PLAY','START','ENTER'];
 for(const q of w) for(const b of document.querySelectorAll('button,[role=button],.btn')){
  const r=b.getBoundingClientRect(); if(b.disabled||r.width<4)continue;
  if((b.textContent||'').toUpperCase().indexOf(q)<0)continue;
  if(typeof b.__activate==='function')b.__activate();else b.click(); return q;} return null;}"""
LOAD=r"""async (id)=>{const G=globalThis.CRESTBOUND.game;const t0=performance.now();
 const live=()=>G.course&&G.courseId===id&&(G.state==='playing'||G.state==='keep');
 await G.__dev.goto(id);
 const tick=()=>new Promise(r=>{let d=false;const f=()=>{if(!d){d=true;r();}};requestAnimationFrame(f);setTimeout(f,60);});
 const dl=t0+30000; while(performance.now()<dl&&!live())await tick();
 return live()?{loadMs:+(performance.now()-t0).toFixed(1)}:{error:'no'};}"""
SCAN=r"""() => {
  const A=globalThis.CRESTBOUND, C=A.game.course;
  const out={mats:{}, basics:[], progs:A.engine.renderer.info.programs.length};
  const seen=new Map();
  C.group.traverse(o=>{
    if(!o.isMesh) return;
    const ms=Array.isArray(o.material)?o.material:[o.material];
    for(const m of ms){ if(!m) continue;
      const k=(m.name||m.type);
      const e=out.mats[k]||(out.mats[k]={insts:new Set?0:0, meshes:0, uuids:[]});
      e.meshes++; if(e.uuids.indexOf(m.uuid)<0) e.uuids.push(m.uuid);
      if(m.isMeshBasicMaterial && !m.name){
        out.basics.push({chain:(()=>{let a=[],n=o;while(n&&a.length<6){a.push(n.name||n.type);n=n.parent;}return a.join('<');})(),
          uuid:m.uuid.slice(0,8), color:m.color.getHexString(), tm:m.toneMapped, tr:m.transparent,
          attrs:Object.keys(o.geometry.attributes).join(','), groups:(o.geometry.groups||[]).length,
          ud:JSON.stringify(o.userData).slice(0,80)});
      }
    }
  });
  const t={}; for(const k in out.mats) t[k]={meshes:out.mats[k].meshes, distinct:out.mats[k].uuids.length};
  return {mats:t, basics:out.basics.slice(0,40), nbasic:out.basics.length, progs:out.progs};
}"""
with sync_playwright() as p:
    br=p.chromium.launch(channel="chrome",headless=True,args=FLAGS)
    pg=br.new_page(viewport={"width":1920,"height":1080})
    warns=[]
    pg.on("console", lambda m: warns.append(m.type+": "+m.text[:200]) if m.type in ("warning","error") else None)
    pg.goto(BASE+"?dev=1&quality=high",wait_until="load",timeout=60000)
    dl=time.time()+70
    while time.time()<dl:
        if pg.evaluate("!!(globalThis.CRESTBOUND&&CRESTBOUND.game)"):break
        pg.wait_for_timeout(300)
    dl=time.time()+90
    while time.time()<dl:
        if pg.evaluate("CRESTBOUND.game.state") in ("keep","playing"):break
        pg.evaluate(CLICK); pg.wait_for_timeout(400)
    for cid in sys.argv[1:] or ["keep"]:
        ld=pg.evaluate(LOAD,cid); print("###",cid,ld)
        r=pg.evaluate(SCAN)
        print("programs",r["progs"],"unnamed-basic meshes",r["nbasic"])
        for k,v in sorted(r["mats"].items(),key=lambda kv:-kv[1]["distinct"])[:25]:
            print("  %-40s meshes %4d distinct-mats %4d"%(k[:40],v["meshes"],v["distinct"]))
        for b in r["basics"][:12]: print("   B",b)
    print("--- console warnings ---")
    for w in warns[:25]: print(" ",w)
    br.close()
