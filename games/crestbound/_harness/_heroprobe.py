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
  const A = globalThis.CRESTBOUND, G = A && A.game;
  const h = G.hero;
  let n = 0, tris = 0, casters = 0, castTris = 0;
  const rows = [];
  h.root.traverse(o => {
    if (!o.isMesh) return;
    const t = (o.geometry.getAttribute('position').count / 3) | 0;
    n++; tris += t;
    if (o.castShadow) { casters++; castTris += t; }
    rows.push([o.name, t, o.castShadow ? 1 : 0]);
  });
  if (h.scarfMesh && !h.root.getObjectById(h.scarfMesh.id)) { /* already counted */ }
  rows.sort((a, b) => b[1] - a[1]);
  return {meshes: n, tris, casters, castTris, top: rows.slice(0, 40)};
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
