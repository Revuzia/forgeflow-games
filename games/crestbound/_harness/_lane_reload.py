"""Does the creature merge SURVIVE repeated course loads?

The critter atlas is module-level and its tile cache is keyed by material
content, so a reload must reuse the tiles it already painted rather than burn
new slots. Loads verdant-1 <-> keep several times and reports, each time, the
atlas fill and the number of draws the creatures cost.
"""
import time, sys
from playwright.sync_api import sync_playwright

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]
CLICK = r"""() => {const w=['CONTINUE','KEEP MY PROGRESS','NEW GAME','NEW RUN','PLAY','START','BEGIN','ENTER'];
 for(const q of w) for(const b of Array.from(document.querySelectorAll('button'))){
  if((b.textContent||'').toUpperCase().indexOf(q)<0) continue; const r=b.getBoundingClientRect();
  if(b.disabled||r.width<4) continue; if(b.__activate)b.__activate(); else b.click(); return q;} return null;}"""
GOTO = r"""async (id) => { const g = globalThis.CRESTBOUND.game;
  await g.__dev.goto(id);
  for (let i = 0; i < 90; i++) await new Promise(r => requestAnimationFrame(r));
  const cs = (g.course && g.course.critters) || [];
  let meshes = 0, merged = 0;
  for (const c of cs) c.mesh.traverse(o => { if (o.isMesh || o.isSkinnedMesh) { meshes++; if (o.isSkinnedMesh) merged++; } });
  return { course: id, critters: cs.length, meshes, mergedMeshes: merged }; }"""

with sync_playwright() as pw:
    br = pw.chromium.launch(channel="chrome", headless=True, args=FLAGS)
    pg = br.new_page(viewport={"width": 900, "height": 600})
    pg.goto("http://localhost:8788/games/crestbound/index.html?dev=1&quality=high",
            wait_until="load", timeout=60000)
    dl = time.time() + 60
    while time.time() < dl:
        if pg.evaluate("!!(globalThis.CRESTBOUND&&CRESTBOUND.game)"): break
        pg.wait_for_timeout(300)
    dl = time.time() + 60
    while time.time() < dl:
        if pg.evaluate("CRESTBOUND.game.state") in ("keep", "playing"): break
        pg.evaluate(CLICK); pg.wait_for_timeout(400)
    pg.wait_for_timeout(1000)
    for i in range(4):
        for cid in ("verdant-1", "keep"):
            r = pg.evaluate(GOTO, cid)
            print("pass %d  %-10s critters=%d  meshes-in-critters=%2d  skinned=%2d"
                  % (i, r["course"], r["critters"], r["meshes"], r["mergedMeshes"]))
    br.close()
