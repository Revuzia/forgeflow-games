from playwright.sync_api import sync_playwright
import json
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":900,"height":600})
    pg.goto("http://localhost:8780/games/void-skirmish-3d/", wait_until="load", timeout=60000); pg.wait_for_timeout(3500)
    out=pg.evaluate("""async ()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));
      const K=window.__FFG3D__.kernel; const t=window.__FFG3D__.controller.__test;
      t.start(); await s(1200);
      const rep=[];
      K.scene.traverse(o=>{
        if(o.isSkinnedMesh && rep.length<4){
          o.updateWorldMatrix(true,false);
          const e=o.matrixWorld.elements;
          const sx=Math.hypot(e[0],e[1],e[2]); // world scale x
          // ancestor visibility
          let vis=o.visible, p=o.parent; while(p){ if(!p.visible)vis=false; p=p.parent; }
          const mat=Array.isArray(o.material)?o.material[0]:o.material;
          rep.push({ name:o.name, worldScale:+sx.toFixed(3), wy:+e[13].toFixed(2), visible:o.visible, ancestorsVisible:vis, frustum:o.frustumCulled, matType:mat&&mat.type, color:mat&&mat.color&&('#'+mat.color.getHexString()), transparent:mat&&mat.transparent, opacity:mat&&mat.opacity, hasMap:!!(mat&&mat.map) });
        }
      });
      return rep;
    }""")
    print(json.dumps(out,indent=2))
    b.close()
