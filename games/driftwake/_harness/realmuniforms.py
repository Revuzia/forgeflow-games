#!/usr/bin/env python
"""Dump the realm uniform block per realm, and shoot the ALBEDO debug view.

A realm swap that writes weather but not the ground boots perfectly and looks
almost right, so this reads the uniforms back out of the live material rather
than trusting that applyRealm() was called -- and shoots debugView 'albedo',
which is the one view that separates "lit badly" from "the wrong colour".
"""
import sys, json
from playwright.sync_api import sync_playwright
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

READY = """() => {const SF=globalThis.SNOWFLOW;if(!SF||!SF.enterRealm)return false;
const b=document.getElementById('boot');return !(b&&!b.classList.contains('gone'));}"""

STATE = """() => {
  const SF=globalThis.SNOWFLOW, T=SF.terrain, K=SF.sky;
  const u=T.realmUniforms, out={};
  for (const k in u) {
    const v=u[k].value;
    out[k] = (typeof v==='number') ? +v.toFixed(5)
           : (v.toArray ? v.toArray().map(x=>+x.toFixed(5)) : String(v));
  }
  return {terrainRealm:T.realmName, skyRealm:K.realmName,
          groundAlbedo:K.groundAlbedo.map(x=>+x.toFixed(4)),
          sunRadiance:K.sunRadiance.toArray().map(x=>+x.toFixed(3)),
          sunScale:+K.sunScale.toFixed(3),
          gradeActive:K._gradeActive,
          sastrugiMul:T._sastrugiMul, grainScale:T._grainScale,
          uniforms:out};
}"""

with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome", headless=False,
                           args=["--ignore-gpu-blocklist", "--use-angle=d3d11",
                                 "--disable-gpu-sandbox",
                                 "--disable-features=CalculateNativeWinOcclusion"])
    pg = br.new_page(viewport={"width": 1280, "height": 720})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append("console.error: " + m.text) if m.type == "error" else None)
    pg.add_init_script("window.__f=0;(function t(){window.__f++;requestAnimationFrame(t);})();")
    pg.goto("http://localhost:8788/games/driftwake/index.html?v=ru", wait_until="load", timeout=90000)
    pg.wait_for_function(READY, timeout=180000)

    def frames(n):
        s = pg.evaluate("()=>window.__f")
        pg.wait_for_function("(s)=>window.__f>s+%d" % n, arg=s, timeout=90000)

    frames(40)
    for realm in ["cold", "sand", "ash"]:
        if realm != "cold":
            pg.evaluate("(r)=>globalThis.SNOWFLOW.enterRealm(r)", realm)
            frames(120)
        st = pg.evaluate(STATE)
        print("\n=== %s ===" % realm.upper())
        print(json.dumps(st, indent=1))
        # Albedo-only view: no lighting, no ambient, no fog.
        pg.evaluate("()=>{const SF=globalThis.SNOWFLOW;SF.set('debugView','albedo');}")
        frames(12)
        pg.screenshot(path=f"_shots/albedo_{realm}.png")
        pg.evaluate("()=>{const SF=globalThis.SNOWFLOW;SF.set('debugView','beauty');}")
        frames(12)
    print("\nerrors:", len(errs))
    for e in errs[:6]:
        print("  ", e)
    br.close()
