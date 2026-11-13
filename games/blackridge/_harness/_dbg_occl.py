import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ownerplay import boot, start, FLAGS
from playwright.sync_api import sync_playwright
from shotserver import ensure_server

JS = r"""
async () => {
  const F = window.__FPS__, T = F.__test, r = F.renderer, gl = r.getContext();
  const sc = F.scene;
  let rig = null; sc.traverse(o => { if (o.name === "__vm_rig__") rig = o; });
  const chain = []; let n = rig; while (n) { chain.push(n.name || n.type); n = n.parent; }
  let meshes = 0, mats = new Set();
  rig && rig.traverse(o => { if (o.isMesh) { meshes++; mats.add(o.material && o.material.type); } });
  // plain render of scene through vm camera, no hiding, no override
  T.freeze(true);
  await new Promise(res => requestAnimationFrame(res));
  T.step(1);
  r.setRenderTarget(null);
  r.setClearColor(0x000000, 1);
  r.clear(true, true, true);
  const pa = r.autoClear; r.autoClear = false;
  r.clearDepth();
  r.render(sc, F.vm.camera);
  r.autoClear = pa;
  const dw = gl.drawingBufferWidth, dh = gl.drawingBufferHeight;
  const buf = new Uint8Array(dw*dh*4);
  gl.readPixels(0,0,dw,dh,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  let lit = 0, maxv = 0;
  for (let i=0;i<buf.length;i+=4) { const v=Math.max(buf[i],buf[i+1],buf[i+2]); if (v>24) lit++; if(v>maxv)maxv=v; }
  T.freeze(false);
  return {rigFound: !!rig, rigVisible: rig && rig.visible, chain, meshes,
          mats: [...mats], dw, dh, litPct: 100*lit/(dw*dh), maxv,
          sceneChildren: sc.children.map(c => (c.name||c.type)+":"+c.visible).slice(0,40),
          glErr: gl.getError()};
}
"""

ensure_server()
with sync_playwright() as p:
    br, pg, errs = boot(p)
    start(pg)
    pg.evaluate("() => __FPS__.__test.give('warden')")
    pg.wait_for_timeout(800)
    print(json.dumps(pg.evaluate(JS), indent=1))
    print("errs", errs)
    br.close()
