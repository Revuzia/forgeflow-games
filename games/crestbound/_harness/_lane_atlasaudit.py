"""Audit the hero atlas: for every part, compare the ALBEDO the merged material
samples at the tile centre against the albedo the original per-part material
samples at the same UV. Any systematic gap here is a colour error, not lighting."""
import json,time
from playwright.sync_api import sync_playwright
FLAGS=["--ignore-gpu-blocklist","--use-angle=d3d11","--disable-gpu-sandbox","--enable-gpu-rasterization",
       "--disable-features=CalculateNativeWinOcclusion","--autoplay-policy=no-user-gesture-required"]
CLICK=r"""() => {const w=['CONTINUE','KEEP MY PROGRESS','NEW GAME','NEW RUN','PLAY','START','BEGIN','ENTER'];
 for(const q of w) for(const b of Array.from(document.querySelectorAll('button'))){
  if((b.textContent||'').toUpperCase().indexOf(q)<0) continue; const r=b.getBoundingClientRect();
  if(b.disabled||r.width<4) continue; if(b.__activate)b.__activate(); else b.click(); return q;} return null;}"""
JS=r"""() => {
  const h = globalThis.CRESTBOUND.game.hero;
  const A = h._atlas, S = h._atlasSlots, out = [];
  const readMean = (cv, x, y, w, hh) => {
    const c = document.createElement('canvas'); c.width = w; c.height = hh;
    const g = c.getContext('2d', {willReadFrequently:true});
    g.drawImage(cv, x, y, w, hh, 0, 0, w, hh);
    const d = g.getImageData(0,0,w,hh).data; let r=0,gg=0,b=0;
    for (let i=0;i<d.length;i+=4){r+=d[i];gg+=d[i+1];b+=d[i+2];}
    const n = d.length/4; return [r/n, gg/n, b/n];
  };
  const pageMap = A.pages.map ? A.pages.map.cv : null;
  const pageOrm = A.pages.ormMap ? A.pages.ormMap.cv : null;
  for (const e of S) {
    const m = e.mat, sl = e.slot;
    const inner = A.tile - A.pad*2;
    const row = { name: e.name, mat: m.name, rep: e.rep, roughness: m.roughness, metalness: m.metalness };
    if (pageMap) row.tileAlbedo = readMean(pageMap, sl.px+A.pad, sl.py+A.pad, inner, inner).map(x=>+x.toFixed(1));
    if (m.map && m.map.image) row.srcAlbedo = readMean(m.map.image, 0, 0, m.map.image.width, m.map.image.height).map(x=>+x.toFixed(1));
    if (pageOrm) row.tileOrm = readMean(pageOrm, sl.px+A.pad, sl.py+A.pad, inner, inner).map(x=>+x.toFixed(1));
    if (m.roughnessMap && m.roughnessMap.image) row.srcOrm = readMean(m.roughnessMap.image, 0, 0, m.roughnessMap.image.width, m.roughnessMap.image.height).map(x=>+x.toFixed(1));
    out.push(row);
  }
  return out;
}"""
with sync_playwright() as p:
    br=p.chromium.launch(channel="chrome",headless=True,args=FLAGS)
    pg=br.new_page(viewport={"width":1000,"height":700})
    pg.goto("http://localhost:8788/games/crestbound/index.html?dev=1&quality=high",wait_until="load",timeout=60000)
    dl=time.time()+60
    while time.time()<dl:
        if pg.evaluate("!!(globalThis.CRESTBOUND&&CRESTBOUND.game)"):break
        pg.wait_for_timeout(300)
    dl=time.time()+60
    while time.time()<dl:
        if pg.evaluate("CRESTBOUND.game.state") in ("keep","playing"):break
        pg.evaluate(CLICK); pg.wait_for_timeout(400)
    pg.wait_for_timeout(1500)
    rows=pg.evaluate(JS)
    for r in rows:
        print("%-16s %-12s rep=%.3f  tileAlb=%s srcAlb=%s | tileOrm=%s srcOrm=%s r=%s m=%s" % (
          r['name'], r['mat'], r['rep'], r.get('tileAlbedo'), r.get('srcAlbedo'), r.get('tileOrm'), r.get('srcOrm'), r['roughness'], r['metalness']))
    br.close()
