#!/usr/bin/env python
"""ASCENDANT frame probe — WHERE the frame time goes, repeatably.

Reports the GPU identity, the composer configuration, a full light census, and
the fps delta from disabling each post pass in turn. This is the instrument for
any perf claim about this game: quote its output, never an estimate.

    python frameprobe.py
    python frameprobe.py --stage foundry-3 --quality high

Absolute fps is machine-specific; the RELATIVE deltas between rows are the
signal (see feedback_forgeflow_games_fps).
"""
import argparse
import sys
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
FLAGS=["--ignore-gpu-blocklist","--use-angle=d3d11","--disable-gpu-sandbox",
       "--enable-gpu-rasterization","--disable-features=CalculateNativeWinOcclusion",
       "--autoplay-policy=no-user-gesture-required"]
_ap = argparse.ArgumentParser()
_ap.add_argument("--stage", default="neon-1")
_ap.add_argument("--quality", default="high")
_ARGS = _ap.parse_args()
URL = ("http://localhost:8788/games/ascendant/index.html"
       f"?dev=1&stage={_ARGS.stage}&quality={_ARGS.quality}")
with sync_playwright() as p:
    br=p.chromium.launch(channel="chrome",headless=False,args=FLAGS)
    pg=br.new_page(viewport={"width":1280,"height":720})
    pg.goto(URL,wait_until="load",timeout=60000)
    for _ in range(150):
        if pg.evaluate("!!(globalThis.ASCENDANT&&ASCENDANT.game&&ASCENDANT.game.stage)"): break
        pg.wait_for_timeout(400)
    for sel in ["#ui button.asc-btn:visible:has-text('NEW RUN')","#ui button.asc-btn:visible:has-text('CONTINUE')"]:
        try: pg.click(sel,timeout=3000); break
        except Exception: pass
    pg.wait_for_timeout(3000)
    print("GPU:", pg.evaluate("""()=>{const c=document.createElement('canvas');const g=c.getContext('webgl2');
      const d=g.getExtension('WEBGL_debug_renderer_info');
      return {vendor:d?g.getParameter(d.UNMASKED_VENDOR_WEBGL):'?',
              renderer:d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):'?'};}"""))
    print("COMPOSER:", pg.evaluate("""()=>{const P=ASCENDANT.engine.post,c=P&&P.composer;if(!c)return 'no composer';
      const rt=c.renderTarget1;
      return {passes:c.passes.map(p=>p.constructor.name+(p.enabled?'':' (off)')),
              rtType:rt.texture.type, samples:rt.samples, w:rt.width, h:rt.height,
              bloom:(()=>{const b=c.passes.find(p=>p.constructor.name==='UnrealBloomPass');
                return b?{res:[b.resolution.x,b.resolution.y],strength:b.strength,radius:b.radius,threshold:b.threshold,
                          mips:b.renderTargetsHorizontal?b.renderTargetsHorizontal.length:null}:null})()};}"""))
    print("LIGHTS:", pg.evaluate("""()=>{const m={};let shadow=0;
      ASCENDANT.engine.scene.traverse(o=>{if(o.isLight){m[o.type]=(m[o.type]||0)+1;if(o.castShadow)shadow++;}});
      let om={};ASCENDANT.engine.overlayScene&&ASCENDANT.engine.overlayScene.traverse(o=>{if(o.isLight)om[o.type]=(om[o.type]||0)+1});
      return {scene:m, shadowCasting:shadow, overlay:om};}"""))
    MEAS="""async(off)=>{const P=ASCENDANT.engine.post,c=P.composer;
      const saved=c.passes.map(p=>p.enabled);
      c.passes.forEach((p,i)=>{if(off.includes(p.constructor.name))p.enabled=false;});
      const f=()=>new Promise(r=>requestAnimationFrame(r));
      for(let i=0;i<15;i++)await f();
      let n=0;const t0=performance.now();while(performance.now()-t0<2000){await f();n++;}
      c.passes.forEach((p,i)=>p.enabled=saved[i]);
      return {off:off.join(',')||'(none)', fps:Math.round(n/2)};}"""
    for off in [[],["UnrealBloomPass"],["SMAAPass"],["ShaderPass"],["ViewmodelPass"],
                ["UnrealBloomPass","SMAAPass"],["UnrealBloomPass","SMAAPass","ShaderPass"]]:
        print("PASS:", pg.evaluate(MEAS, off))
    br.close()
