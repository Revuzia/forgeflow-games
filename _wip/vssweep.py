import sys
from playwright.sync_api import sync_playwright
URL="http://localhost:8780/games/void-skirmish/"; OUT="_wip/vs"
BEATS={
 "01_menu":"await sleep(800);",
 "02_battlefield":"T.start(); await sleep(900);",
 "03_selected":"T.start(); await sleep(500); const a=S().allies[0]; T.select(a.id); await sleep(600);",
 "04_combat":"""T.start(); await sleep(400);
    // advance a couple turns of auto-play but stop mid-fight
    const sim=ctrl.sim; let n=0; while(!sim.ended && n++<2){ if(sim.currentPhase!=='player'){sim.endTurn();continue;}
      const al=sim.aliveAllies(); for(const ai of al){ const u=sim.getUnit(ai.id); let g=0; while(u.actionPoints>0&&g++<3&&!sim.ended){ const es=sim.aliveEnemies(); if(!es.length)break; es.sort((p,q)=>(Math.abs(p.x-u.x)+Math.abs(p.y-u.y))-(Math.abs(q.x-u.x)+Math.abs(q.y-u.y))); const e=es[0],d=Math.abs(e.x-u.x)+Math.abs(e.y-u.y); if(d<=u.range&&sim.hasLineOfSight(u.x,u.y,e.x,e.y)){sim.attackUnit(u.id,e.id);} else {const p=sim.findPath(u.x,u.y,e.x,e.y); if(!p||!p.length)break; const s=Math.min(p.length,u.movement); let dst=p[s-1]; if(dst.x===e.x&&dst.y===e.y){if(s<2)break; dst=p[s-2];} if(!sim.moveUnit(u.id,dst.x,dst.y))break;} } } sim.endTurn(); }
    if(scene._refreshAfterScripted) scene._refreshAfterScripted(); await sleep(700);""",
 "05_victory":"T.start(); await sleep(300); T.autoResolve(60); await sleep(700);",
}
PRELUDE="""
async (body)=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  let tries=0; while(!(window.__FFG_GAME__&&window.__FFG_GAME__.scene)&&tries++<60) await sleep(200);
  let scene=null; tries=0; while(!scene&&tries++<60){ scene=window.__FFG_GAME__.scene.scenes.find(s=>s.__test); if(!scene) await sleep(200);}
  const T=scene.__test; const ctrl={sim:T.sim}; const S=T.state;
  const fn=new Function('sleep','scene','T','ctrl','S','return (async()=>{'+body+'})();');
  await fn(sleep,scene,T,ctrl,S); return true;
}
"""
def main():
    only=sys.argv[1] if len(sys.argv)>1 else None
    with sync_playwright() as p:
        b=p.chromium.launch(); pg=b.new_page(viewport={"width":1280,"height":800})
        for name,body in BEATS.items():
            if only and only not in name: continue
            pg.goto(URL,wait_until="load",timeout=60000)
            try: pg.evaluate(PRELUDE, body)
            except Exception as e: print(f"  {name}: {e}")
            pg.screenshot(path=f"{OUT}/{name}.png"); print("saved",name)
        b.close()
main()
