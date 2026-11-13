#!/usr/bin/env python
"""Why does the camera collapse at a station? Cast the camera's OWN whisker fan
by hand at every heading and report the first hit distance + the collider it hit.
Deterministic: no rAF, no wall clock."""
import json, os, sys, time
from playwright.sync_api import sync_playwright
for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass
URL = "http://localhost:8788/games/crestbound/index.html?dev=1"
FLAGS = ["--ignore-gpu-blocklist","--use-angle=d3d11","--disable-gpu-sandbox",
         "--enable-gpu-rasterization","--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]
CLICK_JS = r"""() => {
  const words=['CONTINUE','KEEP MY PROGRESS','NEW GAME','NEW RUN','PLAY','START','BEGIN'];
  const btns=Array.from(document.querySelectorAll('button,[role=button],.btn'));
  for(const w of words) for(const b of btns){const r=b.getBoundingClientRect();
    if(b.disabled||r.width<4||r.height<4) continue;
    if((b.textContent||'').toUpperCase().indexOf(w)<0) continue;
    if(typeof b.__activate==='function') b.__activate(); else b.click(); return w;}
  return null; }"""
STATE = "globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.state"
PROBE = r"""
(o) => {
  const A=globalThis.CRESTBOUND,G=A.game,THREE=A.THREE;
  const cam=G.cam||G.camera,P=G.player,def=G.course&&G.course.def;
  const list=[]; if(def&&def.spawn) list.push({id:'spawn',p:def.spawn.p});
  for(const c of ((def&&def.checkpoints)||[])) list.push({id:c.id,p:c.p});
  const st=list.filter(s=>s.id===o.station)[0];
  if(!st) return {error:'no station '+o.station+' have '+list.map(s=>s.id).join(',')};
  const v=new THREE.Vector3();
  P.__test.teleport(v.set(st.p[0],st.p[1]+0.05,st.p[2]));
  if(P.__test.setVel) P.__test.setVel(v.set(0,0,0));
  const w=G.world||G.course; const bp=(w&&(w.broadphase||(w.course&&w.course.broadphase)))||null;
  if(!bp) return {error:'no broadphase'};
  const R=0.35, want=6.8, pitch=0.22;
  const out=[];
  for(let i=0;i<o.n;i++){
    const yaw=-Math.PI+ (2*Math.PI*i/o.n);
    cam.__test.setYaw(yaw); cam.__test.setPitch(pitch);
    for(let k=0;k<45;k++) cam.update(1/60);
    const cs=cam.__test.state();
    const f=new THREE.Vector3(cs.focus[0],cs.focus[1],cs.focus[2]);
    const yy=cs.yaw; const cp=Math.cos(pitch),sp=Math.sin(pitch);
    const fwd=new THREE.Vector3(-Math.sin(yy),0,-Math.cos(yy));
    const dir=new THREE.Vector3(-fwd.x*cp,sp,-fwd.z*cp);
    const right=new THREE.Vector3(-fwd.z,0,fwd.x);
    const hit={t:0,normal:new THREE.Vector3(),collider:null};
    const rows=[];
    const cast=(origin,label)=>{
      const h={t:0,normal:new THREE.Vector3(),collider:null};
      const got=bp.raycast(origin,dir,want+R,h);
      if(got){ const c=h.collider;
        rows.push({probe:label,t:+h.t.toFixed(3),ny:+h.normal.y.toFixed(2),
                   hf: !!h.heightfield,
                   hfy: h.heightfield && h.heightfield.heightAt ? +h.heightfield.heightAt(origin.x,origin.z).toFixed(2) : null,
                   col: c ? {group:c.group||null, solid:c.solid,
                             c:[+c.center.x.toFixed(1),+c.center.y.toFixed(1),+c.center.z.toFixed(1)],
                             h:[+c.half.x.toFixed(1),+c.half.y.toFixed(1),+c.half.z.toFixed(1)],
                             ref: c.ref ? (c.ref.kind||c.ref.type||'ref') : null} : null});
      }
    };
    for(let j=-2;j<=2;j++){ const o2=f.clone().addScaledVector(right,j*0.25); cast(o2,'fan'+j); }
    cast(f.clone().setY(f.y-0.70),'chest');
    cast(f.clone().setY(f.y+0.35),'ceil');
    rows.sort((a,b)=>a.t-b.t);
    out.push({yaw:+yaw.toFixed(2),dist:+cs.dist.toFixed(2),yawSlide:+cs.yawSlide.toFixed(2),
              focus:[+f.x.toFixed(2),+f.y.toFixed(2),+f.z.toFixed(2)],nearest:rows.slice(0,3)});
  }
  return {ok:true,station:st.id,p:st.p,rows:out};
}
"""
def main():
    course = sys.argv[1]; station = sys.argv[2]; n = int(sys.argv[3]) if len(sys.argv)>3 else 12
    with sync_playwright() as p:
        br=None
        for i in range(6):
            try: br=p.chromium.launch(channel="chrome",headless=True,args=FLAGS); break
            except Exception: time.sleep(10*(i+1))
        pg=br.new_page(viewport={"width":1280,"height":720})
        for i in range(5):
            try: pg.goto(URL,wait_until="load",timeout=180000); break
            except Exception: time.sleep(15)
        t0=time.time()
        while time.time()-t0<180:
            try:
                if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game)"): break
            except Exception: pass
            pg.wait_for_timeout(500)
        t0=time.time()
        while time.time()-t0<180:
            if pg.evaluate(STATE) in ("keep","playing"): break
            pg.evaluate(CLICK_JS); pg.wait_for_timeout(700)
        t0=time.time()
        while time.time()-t0<180:
            try:
                if pg.evaluate("!!(CRESTBOUND.game.player && CRESTBOUND.game.player.__test)"): break
            except Exception: pass
            pg.wait_for_timeout(500)
        pg.wait_for_timeout(1500)
        if course!="keep":
            pg.evaluate("(id)=>CRESTBOUND.game.__dev.goto(id)",course)
            t0=time.time()
            while time.time()-t0<90:
                if pg.evaluate(STATE)=="playing" and pg.evaluate("CRESTBOUND.game.courseId")==course: break
                pg.wait_for_timeout(300)
            pg.wait_for_timeout(1500)
        res=pg.evaluate(PROBE,{"station":station,"n":n})
        print(json.dumps(res,indent=1))
        br.close()
    return 0
if __name__=="__main__": sys.exit(main())
