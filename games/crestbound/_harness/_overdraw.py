#!/usr/bin/env python
"""How many times does CRESTBOUND shade each pixel?

The frame is fill-bound (measured: cost scales with resolution, ~75-90% of it
per-pixel), and PBR fragment shading is its largest single component. Whether a
DEPTH PREPASS is the right fix depends on one number: how many fragments the
opaque pass shades per covered pixel, given three.js's front-to-back opaque
sort and early-Z.

Method: render the world with an override material that ADDS a constant per
fragment, into an offscreen target, then read it back and count.

  pass A  depthTest off, depthWrite off  -> every rasterised fragment
  pass B  depthTest on,  depthWrite on   -> fragments that survive early-Z in
                                            the order the renderer submits
  coverage                               -> pixels with any fragment at all

overdraw_paid = B / coverage is what a perfect depth prepass would drive to 1.
"""
import argparse
import sys

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

FLAGS = ["--disable-gpu-vsync", "--disable-frame-rate-limit", "--ignore-gpu-blocklist",
         "--use-angle=d3d11", "--disable-gpu-sandbox", "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]
BASE = "http://localhost:8788/games/crestbound/index.html"
STATE_JS = "globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.state"
CLICK_JS = r"""() => { const words=['NEW GAME','NEW RUN','CONTINUE','PLAY','START','BEGIN','ENTER'];
  for (const w of words) for (const b of document.querySelectorAll('button')) {
    const r=b.getBoundingClientRect(); if(b.disabled||r.width<4) continue;
    if((b.textContent||'').toUpperCase().indexOf(w)<0) continue;
    if(b.__activate) b.__activate(); else b.click(); return w; } return null; }"""
LOAD_JS = r"""async (id) => { const G=CRESTBOUND.game; const t0=performance.now();
  const live=()=>G.course&&G.courseId===id&&(G.state==='playing'||G.state==='keep');
  await G.__dev.goto(id);
  const tick=()=>new Promise(r=>{let d=false;const f=()=>{if(!d){d=true;r();}};
    requestAnimationFrame(f);setTimeout(f,60);});
  while(performance.now()<t0+40000&&!live()) await tick(); return live(); }"""
STATION_JS = r"""(name)=>{const A=CRESTBOUND,G=A.game,C=G.course,THREE=A.THREE;
  const posOf=o=>{if(!o)return null;if(typeof o.x==='number')return o;
    if(o.pos)return posOf(o.pos);
    if(o.p)return Array.isArray(o.p)?{x:o.p[0],y:o.p[1],z:o.p[2]}:posOf(o.p);
    if(o.position)return posOf(o.position);return null;};
  const p = name==='spawn'?posOf((C.spawnFor?C.spawnFor(0):{}).pos)
          : posOf((C.checkpoints||[])[parseInt(name.replace(/\D/g,''),10)-1]);
  if(!p) return null;
  const P=G.player; if(P&&P.__test){P.__test.teleport(new THREE.Vector3(p.x,p.y+0.6,p.z));
    P.__test.setVel(new THREE.Vector3(0,0,0));}
  return [p.x,p.y,p.z];}"""

COUNT_JS = r"""
() => {
  const A = globalThis.CRESTBOUND, E = A.engine, R = E.renderer, THREE = A.THREE;
  const W = Math.max(1, Math.round(R.domElement.width / 4));
  const H = Math.max(1, Math.round(R.domElement.height / 4));
  const rt = new THREE.WebGLRenderTarget(W, H, {type: THREE.UnsignedByteType, depthBuffer: true});
  const buf = new Uint8Array(W * H * 4);

  /* R channel += 4 per fragment (so up to 63 layers fit in 8 bits) */
  const mk = (depthTest, depthWrite) => new THREE.MeshBasicMaterial({
    color: new THREE.Color(4 / 255, 0, 0), blending: THREE.AdditiveBlending,
    transparent: true, depthTest: depthTest, depthWrite: depthWrite,
    toneMapped: false, fog: false});

  const savedTone = R.toneMapping; R.toneMapping = THREE.NoToneMapping;
  const savedBg = E.scene.background; E.scene.background = null;
  const savedFog = E.scene.fog; E.scene.fog = null;
  const savedShadow = R.shadowMap.enabled; R.shadowMap.enabled = false;

  const run = (mat) => {
    E.scene.overrideMaterial = mat;
    R.setRenderTarget(rt);
    R.setClearColor(0x000000, 1); R.clear(true, true, true);
    R.render(E.scene, E.camera);
    R.readPixels ? 0 : 0;
    R.readRenderTargetPixels(rt, 0, 0, W, H, buf);
    R.setRenderTarget(null);
    let frags = 0, covered = 0, maxL = 0;
    for (let i = 0; i < buf.length; i += 4) {
      const n = buf[i] / 4;
      if (n > 0) { covered++; frags += n; if (n > maxL) maxL = n; }
    }
    return {frags: frags, covered: covered, maxLayers: maxL};
  };

  const a = run(mk(false, false));      // every rasterised fragment
  const b = run(mk(true, true));        // fragments that survive early-Z

  E.scene.overrideMaterial = null;
  R.toneMapping = savedTone; E.scene.background = savedBg; E.scene.fog = savedFog;
  R.shadowMap.enabled = savedShadow;
  rt.dispose();

  const px = W * H;
  return {
    sampleRes: [W, H], pixels: px,
    coveragePct: +(100 * b.covered / px).toFixed(1),
    rasterisedPerCoveredPx: +(a.frags / Math.max(1, a.covered)).toFixed(2),
    shadedPerCoveredPx: +(b.frags / Math.max(1, b.covered)).toFixed(2),
    maxLayersRasterised: a.maxLayers, maxLayersShaded: b.maxLayers,
  };
}
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--course", default="verdant-1")
    ap.add_argument("--station", default="spawn")
    ap.add_argument("--quality", default="high")
    ap.add_argument("--width", type=int, default=1920)
    ap.add_argument("--height", type=int, default=1080)
    args = ap.parse_args()
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": args.width, "height": args.height})
        pg.goto("%s?dev=1&quality=%s" % (BASE, args.quality), wait_until="load", timeout=60_000)
        for _ in range(150):
            if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game)"):
                break
            pg.wait_for_timeout(400)
        for _ in range(60):
            if pg.evaluate(STATE_JS) in ("keep", "playing"):
                break
            pg.evaluate(CLICK_JS)
            pg.wait_for_timeout(400)
        print("loaded:", pg.evaluate(LOAD_JS, args.course))
        print("station:", pg.evaluate(STATION_JS, args.station))
        pg.wait_for_timeout(1500)
        r = pg.evaluate(COUNT_JS)
        print("-" * 74)
        print("OVERDRAW — %s / %s @ %dx%d (counted at %s)"
              % (args.course, args.station, args.width, args.height, r["sampleRes"]))
        print("  screen coverage                 %5.1f %%" % r["coveragePct"])
        print("  fragments RASTERISED per px     %5.2f   (max %d layers)"
              % (r["rasterisedPerCoveredPx"], r["maxLayersRasterised"]))
        print("  fragments SHADED per px         %5.2f   (max %d layers)  <- what we pay"
              % (r["shadedPerCoveredPx"], r["maxLayersShaded"]))
        print("  a perfect depth prepass would drive 'SHADED per px' to 1.00")
        print("-" * 74)
        br.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
