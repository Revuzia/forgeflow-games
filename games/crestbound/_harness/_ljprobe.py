#!/usr/bin/env python
"""Why does camcheck's longjump row never trigger? Replays camcheck's own
crouch+jump sequence with real KeyboardEvents and dumps input/controller state
every frame around the press."""
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
async () => {
  const A=globalThis.CRESTBOUND,G=A.game,THREE=A.THREE;
  const P=G.player, cam=G.cam||G.camera, I=G.input||A.input||(G.engine&&G.engine.input);
  const TUNE=(await import(new URL('games/crestbound/runtime/core/tuning.js', location.origin+'/').href)).TUNE;
  const frame=()=>new Promise(r=>requestAnimationFrame(r));
  const wait=async ms=>{const t=performance.now(); while(performance.now()-t<ms) await frame();};
  const tgt=()=>document.querySelector('canvas')||document;
  const key=(type,code)=>{const k=code==='Space'?' ':(code.startsWith('Key')?code.slice(3).toLowerCase():code);
    tgt().dispatchEvent(new KeyboardEvent(type,{code,key:k,bubbles:true,cancelable:true}));};
  const down=c=>key('keydown',c), up=c=>key('keyup',c);
  const spd=()=>Math.hypot(P.vel.x,P.vel.z);
  const snap=(tag)=>({tag, t:+performance.now().toFixed(0), state:P.state, spd:+spd().toFixed(2),
    grounded:!!P.grounded, crouching:!!P.crouching,
    inCrouch: I? !!I.crouch : null, inCrouchPressed: I? !!I.crouchPressed : null,
    inJump: I? !!I.jump : null, inJumpPressed: I? !!I.jumpPressed : null,
    crouchHeld: P._crouchHeld, jumpLatch: P._jumpPressLatch, bufferT:+(P.bufferT||0).toFixed(3)});
  const log=[];
  // camcheck's own synthetic slab + placement (TEST = {0,400,600})
  const Collider=(await import(new URL('games/crestbound/runtime/world/collider.js', location.origin+'/').href)).Collider;
  const bps=[]; const b1=G.course&&G.course.broadphase;
  const b2=cam.world&&(cam.world.broadphase||(cam.world.course&&cam.world.course.broadphase));
  if(b1) bps.push(b1); if(b2&&bps.indexOf(b2)<0) bps.push(b2);
  const slab=new Collider({center:new THREE.Vector3(0,399,600),half:new THREE.Vector3(60,1,14),surface:'stone'});
  slab.update(); for(const bp of bps){bp.add(slab); if(bp.refresh) bp.refresh(slab);}
  P.__test.teleport(new THREE.Vector3(-30, 400, 600));
  P.__test.setVel(new THREE.Vector3(0,0,0));
  if (P.__test.setFacing) P.__test.setFacing(-Math.PI/2);
  if (cam.snapToPlayer) cam.snapToPlayer();
  cam.__test.setYaw(-Math.PI/2);
  await wait(700);
  down('KeyW');
  let t0=performance.now();
  while (spd() < TUNE.longJump.minSpeed+1.0 && performance.now()-t0 < 1500) await frame();
  log.push(snap('after-runup'));
  down('ControlLeft');
  log.push(snap('ctrl-down-sync'));
  await frame(); log.push(snap('ctrl+1f'));
  down('Space');
  log.push(snap('space-down-sync'));
  for (let i=0;i<6;i++){ await frame(); log.push(snap('after-space+'+(i+1))); }
  up('Space'); up('ControlLeft'); up('KeyW');
  for(const bp of bps){try{bp.remove(slab);}catch(e){}}
  return {minSpeed:TUNE.longJump.minSpeed, hasInput: !!I, log};
}
"""
def main():
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
        res=pg.evaluate(PROBE)
        print(json.dumps(res,indent=1))
        br.close()
    return 0
if __name__=="__main__": sys.exit(main())
