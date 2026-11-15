"""Catalog thumbnail from a REAL gameplay frame (no xAI spend, no dev overlay)."""
import sys, time
from playwright.sync_api import sync_playwright
FLAGS=["--ignore-gpu-blocklist","--use-angle=d3d11","--disable-gpu-sandbox",
       "--enable-gpu-rasterization","--disable-features=CalculateNativeWinOcclusion",
       "--autoplay-policy=no-user-gesture-required"]
URL="http://localhost:8788/games/crestbound/index.html?dev=1&course=verdant-1&quality=low&autoscale=0"
with sync_playwright() as p:
    br=p.chromium.launch(channel="chrome",headless=True,args=FLAGS)
    pg=br.new_page(viewport={"width":1280,"height":720})
    pg.goto(URL,wait_until="load",timeout=60000)
    for _ in range(120):
        try:
            if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.course)"): break
        except Exception: pass
        pg.wait_for_timeout(500)
    pg.wait_for_timeout(4000)
    # frame the hero from a cinematic angle and hide every overlay
    pg.evaluate("""() => {
      for (const id of ['hud','ui']) { const e=document.getElementById(id); if(e) e.style.display='none'; }
      // kill every fixed/absolute DOM overlay above the canvas (dev HUD, control bar, toasts)
      document.querySelectorAll('body *').forEach(e => {
        if (e.tagName === 'CANVAS') return;
        const cs = getComputedStyle(e);
        if ((cs.position === 'fixed' || cs.position === 'absolute') && e.getBoundingClientRect().width > 40) e.style.display = 'none';
      });
      const G=globalThis.CRESTBOUND && CRESTBOUND.game;
      if (G && G.cam) { G.cam.yaw = 0.42; G.cam.pitch = 0.13; G.cam.dist = 8.2; }
    }""")
    pg.wait_for_timeout(1500)
    pg.screenshot(path="thumbnail.png")
    print("wrote thumbnail.png")
    br.close()
