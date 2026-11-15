import json, sys, os
from playwright.sync_api import sync_playwright
for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass
FLAGS = ["--ignore-gpu-blocklist","--use-angle=d3d11","--disable-gpu-sandbox",
         "--enable-gpu-rasterization","--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required","--force-device-scale-factor=1"]
URL = "http://localhost:8788/games/crestbound/index.html?dev=1&course=verdant-1"
JS = r"""
() => {
  const A = globalThis.CRESTBOUND, G = A && A.game, THREE = A && A.THREE;
  const h = G.hero, head = h.bones.head;
  head.updateMatrixWorld(true);
  const meshes = [];
  h.root.traverse(o => { if (o.isMesh) meshes.push(o); });
  const eye = new THREE.Vector3(0.0740, -0.015, -0.1967).applyMatrix4(head.matrixWorld);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(head.getWorldQuaternion(new THREE.Quaternion())).normalize();
  const from = eye.clone().addScaledVector(fwd, 0.8);
  const rc = new THREE.Raycaster(from, fwd.clone().negate(), 0, 2.0);
  const hits = rc.intersectObjects(meshes, false);
  return {
    eye: eye.toArray().map(v=>+v.toFixed(3)),
    hits: hits.slice(0, 8).map(x => ({n: x.object.name, ahead: +(0.8 - x.distance).toFixed(4),
                                      mat: x.object.material.type,
                                      trans: !!x.object.material.transparent,
                                      op: +x.object.material.opacity.toFixed(2),
                                      dw: !!x.object.material.depthWrite,
                                      side: x.object.material.side,
                                      vis: x.object.visible}))
  };
}
"""
CLICK = r"""() => { const bs=[...document.querySelectorAll('button')];
 for (const w of ['NEW GAME','NEW RUN','CONTINUE','PLAY','START','BEGIN','ENTER'])
   for (const b of bs) if ((b.textContent||'').toUpperCase().includes(w)) { if(b.__activate) b.__activate(); else b.click(); return w; }
 return null; }"""
with sync_playwright() as pw:
    br = pw.chromium.launch(channel="chrome", headless=True, args=FLAGS)
    pg = br.new_page(viewport={"width":900,"height":900})
    pg.goto(URL, wait_until="domcontentloaded")
    import time
    dl = time.time()+60
    while time.time() < dl:
        st = pg.evaluate("globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.state")
        if st in ("keep","playing"): break
        try: pg.evaluate(CLICK)
        except Exception: pass
        pg.wait_for_timeout(400)
    pg.wait_for_timeout(1500)
    print(json.dumps(pg.evaluate(JS), indent=1))
    br.close()
