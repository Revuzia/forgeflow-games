from playwright.sync_api import sync_playwright
import json
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page()
    errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)))
    bad=[]; pg.on("response", lambda r: bad.append(r.status) if r.status>=400 and 'spacekit' in r.url else None)
    pg.goto("http://localhost:8780/games/void-skirmish-3d/", wait_until="load", timeout=60000); pg.wait_for_timeout(3000)
    out=pg.evaluate("""async ()=>{
      const K=window.__FFG3D__.kernel; const base=new URL('runtime/3d/spacekit/', location.href).href;
      const res={};
      for (const f of ['template-floor','template-wall','template-wall-half']){
        const o=await K.loadGLTF(base+f+'.glb'); o.updateWorldMatrix(true,true);
        let minx=1e9,maxx=-1e9,miny=1e9,maxy=-1e9,minz=1e9,maxz=-1e9,hasMap=false,mc=0;
        o.traverse(m=>{ if(m.isMesh){mc++; if(m.material&&m.material.map)hasMap=true; m.geometry.computeBoundingBox(); const bb=m.geometry.boundingBox; minx=Math.min(minx,bb.min.x);maxx=Math.max(maxx,bb.max.x);miny=Math.min(miny,bb.min.y);maxy=Math.max(maxy,bb.max.y);minz=Math.min(minz,bb.min.z);maxz=Math.max(maxz,bb.max.z);} });
        res[f]={ w:+(maxx-minx).toFixed(2), h:+(maxy-miny).toFixed(2), d:+(maxz-minz).toFixed(2), miny:+miny.toFixed(2), meshes:mc, textured:hasMap };
      }
      return res;
    }""")
    print(json.dumps(out,indent=2)); print("spacekit 4xx:", bad, "errs:", errs[:3])
    b.close()
