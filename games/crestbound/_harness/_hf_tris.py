import os, sys, json
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import heroshots as H
JS = r"""
() => {
  const G = globalThis.CRESTBOUND.game, hero = G.hero;
  const out = []; let tot = 0;
  hero.root.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry, n = g.index ? g.index.count/3 : g.attributes.position.count/3;
    out.push([o.name || '(anon)', n, o.visible]);
    if (o.visible) tot += n;
  });
  out.sort((a,b) => b[1]-a[1]);
  return {tot, parts: out};
}
"""
with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome", headless=True, args=H.HEADLESS_FLAGS)
    pg = br.new_page(viewport={"width": 700, "height": 700})
    pg.goto(H.BASE + "?course=verdant-1", wait_until="load")
    pg.wait_for_function("globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.hero", timeout=60000)
    pg.evaluate(H.CLICK_JS); pg.wait_for_timeout(2500)
    r = pg.evaluate(JS); br.close()
print("hero visible tris:", r["tot"], " meshes:", len(r["parts"]))
for n, t, v in r["parts"]: print("  %-22s %6d %s" % (n, t, "" if v else "(hidden)"))
