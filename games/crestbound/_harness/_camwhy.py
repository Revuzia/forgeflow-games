#!/usr/bin/env python
"""Why is the camera still tight at a station? Calls the camera's OWN
_castOccluder() per whisker (post-embed-escape) beside the RAW broadphase hit,
so the two can be compared. Deterministic: no rAF, no wall clock."""
import json, sys, time
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
  const w=G.world||G.course; const bp=(w&&(w.broadphase||(w.course&&w.course.broadphase)))||null;
  if(!bp) return {error:'no broadphase'};
  const R=0.35;
  const out=[];
  for (const yaw of o.yaws) {
    P.__test.teleport(v.set(st.p[0],st.p[1]+0.05,st.p[2]));
    if(P.__test.setVel) P.__test.setVel(v.set(0,0,0));
    if(P.__test.setFacing) P.__test.setFacing(yaw);
    if(typeof cam.snapToPlayer==='function') cam.snapToPlayer();
    cam.__test.setYaw(yaw); cam.__test.setPitch(0.22);
    for(let k=0;k<45;k++) cam.update(1/60);
    const cs=cam.__test.state();
    const f=cam._focus;
    const pitch=cam._pitchAim();
    const want=6.8;
    const yy=cam.yaw+cam._yawSlide;
    const cp=Math.cos(pitch),sp=Math.sin(pitch);
    const fwd=new THREE.Vector3(-Math.sin(yy),0,-Math.cos(yy));
    const dir=new THREE.Vector3(-fwd.x*cp,sp,-fwd.z*cp);
    const right=new THREE.Vector3(-fwd.z,0,fwd.x);
    const rows=[];
    const cast=(origin,label)=>{
      const h={t:0,normal:new THREE.Vector3(),collider:null,heightfield:null};
      const got=bp.raycast(origin,dir,want+R,h);
      const esc=cam._castOccluder(bp,origin,dir,want+R);
      const c=got?h.collider:null;
      rows.push({probe:label, raw: got?+h.t.toFixed(3):-1, esc:+esc.toFixed(3),
                 inside: c&&c.containsPoint?c.containsPoint(origin):null,
                 hf: got?!!h.heightfield:false,
                 col: c ? {group:c.group||null,
                           c:[+c.center.x.toFixed(1),+c.center.y.toFixed(1),+c.center.z.toFixed(1)],
                           h:[+c.half.x.toFixed(1),+c.half.y.toFixed(1),+c.half.z.toFixed(1)]} : null});
    };
    for(let j=-2;j<=2;j++){ const o2=f.clone().addScaledVector(right,j*0.25); cast(o2,'fan'+j); }
    cast(f.clone().setY(f.y-0.70),'chest');
    cast(f.clone().setY(f.y+0.35),'ceil');
    const sorted = rows.slice().sort((a,b)=>(a.esc<0?99:a.esc)-(b.esc<0?99:b.esc));
    out.push({yaw:+yaw.toFixed(3),dist:+cs.dist.toFixed(3),yawSlide:+cs.yawSlide.toFixed(3),
              pitchAim:+pitch.toFixed(3),
              focus:[+f.x.toFixed(2),+f.y.toFixed(2),+f.z.toFixed(2)],
              limitCeil:cam._limitCeil, worst:sorted.slice(0,3)});
  }
  return {ok:true,station:st.id,p:st.p,rows:out};
}
"""
def main():
    course=sys.argv[1]; station=sys.argv[2]
    yaws=[float(x) for x in sys.argv[3].split(",")]
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
        res=pg.evaluate(PROBE,{"station":station,"yaws":yaws})
        print(json.dumps(res,indent=1))
        br.close()
    return 0
if __name__=="__main__": sys.exit(main())
