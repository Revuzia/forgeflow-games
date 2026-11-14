#!/usr/bin/env python
"""Time the prop-manifest fetch and a bare rAF frame, inside the live page."""
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
CLICK_JS = r"""() => { for (const w of ['NEW GAME','NEW RUN','CONTINUE','PLAY','START','ENTER'])
  for (const b of document.querySelectorAll('button')) {
    const r=b.getBoundingClientRect(); if(b.disabled||r.width<4) continue;
    if((b.textContent||'').toUpperCase().indexOf(w)<0) continue;
    if(b.__activate) b.__activate(); else b.click(); return w; } return null; }"""

PROBE = r"""
async () => {
  const out = {};
  const base = new URL('assets/props/', location.href).href;
  for (const theme of ['verdant', 'keep']) {
    const t = performance.now();
    try { const r = await fetch(base + theme + '/index.json', {cache:'no-cache'}); await r.text();
          out['fetch_' + theme] = +(performance.now() - t).toFixed(1); }
    catch (e) { out['fetch_' + theme] = 'ERR ' + e; }
  }
  // a bare await of a resolved promise, and one rAF, for scale
  let t = performance.now(); await Promise.resolve(); out.microtask = +(performance.now()-t).toFixed(2);
  t = performance.now();
  await new Promise(r => requestAnimationFrame(r));
  out.oneRaf = +(performance.now()-t).toFixed(1);
  t = performance.now();
  for (let i=0;i<10;i++) await new Promise(r => requestAnimationFrame(r));
  out.tenRaf = +(performance.now()-t).toFixed(1);
  out.running = !!(globalThis.CRESTBOUND.engine && globalThis.CRESTBOUND.engine._raf);
  return out;
}
"""


def main():
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
        pg = br.new_page(viewport={"width": 1920, "height": 1080})
        pg.goto(BASE + "?dev=1&quality=high", wait_until="load", timeout=60_000)
        for _ in range(150):
            if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game)"):
                break
            pg.wait_for_timeout(400)
        for _ in range(60):
            if pg.evaluate("CRESTBOUND.game.state") in ("keep", "playing"):
                break
            pg.evaluate(CLICK_JS)
            pg.wait_for_timeout(400)
        pg.wait_for_timeout(1500)
        print(pg.evaluate(PROBE))
        br.close()


main()
