from playwright.sync_api import sync_playwright
import json
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":1280,"height":800})
    errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
    pg.goto("http://localhost:8780/games/iron-tide/",wait_until="load",timeout=60000); pg.wait_for_timeout(3000)
    out=pg.evaluate("""async ()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));
      const K=window.__FFG3D__.kernel,c=K.controls,t=window.__FFG3D__.controller.__test;
      t.menuPlay(); await s(500); c.autoRotate=false;
      const mb=c.mouseButtons; // THREE.MOUSE: ROTATE=0,DOLLY=1,PAN=2 ; null = disabled
      const before={x:+K.camera.position.x.toFixed(2),z:+K.camera.position.z.toFixed(2)};
      // simulate holding 'd' for ~0.5s
      window.dispatchEvent(new KeyboardEvent('keydown',{key:'d'})); await s(500);
      window.dispatchEvent(new KeyboardEvent('keyup',{key:'d'})); await s(50);
      const after={x:+K.camera.position.x.toFixed(2),z:+K.camera.position.z.toFixed(2)};
      const moved=Math.hypot(after.x-before.x, after.z-before.z);
      return {rotateRight:(mb&&mb.RIGHT===0), leftDisabled:(mb&&mb.LEFT===null), before, after, panMoved:+moved.toFixed(2)};
    }""")
    print(json.dumps(out,indent=2)); print("errors:",errs[:5])
    b.close()
