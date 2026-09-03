"""Scarf in REAL play: the anchor actually moves. Sample the chain's shape
every frame through run -> turn -> jump -> longjump -> land."""
import json, os, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import heroshots as H

JS = r"""
() => {
  const A = globalThis.CRESTBOUND, G = A.game, E = A.engine, hero = G.hero, P = G.player;
  E.stop && E.stop();
  const key = (code, down) => {
    for (const t of [document.querySelector('canvas')||window, window])
      t.dispatchEvent(new KeyboardEvent(down?'keydown':'keyup',
        {code, key:code, bubbles:true, cancelable:true}));
  };
  const shape = () => {
    const Pp = hero._scarfP, N = Pp.length/3;
    const a=[Pp[0],Pp[1],Pp[2]], z=[Pp[(N-1)*3],Pp[(N-1)*3+1],Pp[(N-1)*3+2]];
    const d=[z[0]-a[0],z[1]-a[1],z[2]-a[2]], dl=Math.hypot(d[0],d[1],d[2])||1e-6;
    let dev=0, arc=0;
    for(let i=1;i<N;i++){
      const px=Pp[i*3]-a[0],py=Pp[i*3+1]-a[1],pz=Pp[i*3+2]-a[2];
      const t=(px*d[0]+py*d[1]+pz*d[2])/(dl*dl);
      dev=Math.max(dev,Math.hypot(px-d[0]*t,py-d[1]*t,pz-d[2]*t));
      arc+=Math.hypot(Pp[i*3]-Pp[(i-1)*3],Pp[i*3+1]-Pp[(i-1)*3+1],Pp[i*3+2]-Pp[(i-1)*3+2]);
    }
    // tip position in the hero's own frame -> does the tip actually travel?
    const f=hero.root.rotation.y, cf=Math.cos(-f), sf=Math.sin(-f);
    const wx=z[0]-hero.root.position.x, wy=z[1]-hero.root.position.y, wz=z[2]-hero.root.position.z;
    return {sag:+(dev/arc).toFixed(4), arc:+arc.toFixed(4),
            tip:[+(cf*wx+sf*wz).toFixed(3), +wy.toFixed(3), +(-sf*wx+cf*wz).toFixed(3)]};
  };
  const rec=[];
  const run=(n,label)=>{for(let i=0;i<n;i++){G.update(1/120); const s=shape(); s.st=P.state; s.l=label; s.spd=+P.speed.toFixed(2); rec.push(s);}};
  run(120,'settle');
  key('KeyW',true); run(240,'run');
  key('KeyA',true); run(120,'turn');  key('KeyA',false);
  key('Space',true); run(10,'jump'); key('Space',false); run(200,'air');
  key('ControlLeft',true); run(6,'crouch'); key('Space',true); run(8,'lj');
  key('Space',false); key('ControlLeft',false); run(240,'ljair');
  key('KeyW',false); run(180,'stop');
  const by={};
  for(const r of rec){ (by[r.l]=by[r.l]||[]).push(r); }
  const sum={};
  for(const k in by){
    const s=by[k].map(r=>r.sag), tz=by[k].map(r=>r.tip[2]), ty=by[k].map(r=>r.tip[1]);
    sum[k]={n:by[k].length, sagMin:+Math.min(...s).toFixed(4), sagMax:+Math.max(...s).toFixed(4),
            tipZrange:+(Math.max(...tz)-Math.min(...tz)).toFixed(3),
            tipYrange:+(Math.max(...ty)-Math.min(...ty)).toFixed(3),
            arcMin:+Math.min(...by[k].map(r=>r.arc)).toFixed(4),
            arcMax:+Math.max(...by[k].map(r=>r.arc)).toFixed(4),
            states:[...new Set(by[k].map(r=>r.st))]};
  }
  return {sum, series: rec.filter((r,i)=>i%4===0)};
}
"""
with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome", headless=True, args=H.HEADLESS_FLAGS)
    pg = br.new_page(viewport={"width": 700, "height": 700})
    pg.goto("http://localhost:8788/games/crestbound/index.html?dev=1&course=verdant-1",
            wait_until="load", timeout=60000)
    dl=time.time()+60
    while time.time()<dl:
        if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.hero)"): break
        pg.wait_for_timeout(300)
    H.leave_title(pg); pg.wait_for_timeout(2500)
    r = pg.evaluate(JS); br.close()
json.dump(r, open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"_r3scarf.json"),"w"), indent=1)
print("%-8s %5s %8s %8s %9s %9s %8s %8s  %s"%("phase","n","sagMin","sagMax","tipZrange","tipYrange","arcMin","arcMax","states"))
for k,v in r["sum"].items():
    print("%-8s %5d %8.4f %8.4f %9.3f %9.3f %8.4f %8.4f  %s"%(k,v["n"],v["sagMin"],v["sagMax"],
          v["tipZrange"],v["tipYrange"],v["arcMin"],v["arcMax"],",".join(v["states"])))
