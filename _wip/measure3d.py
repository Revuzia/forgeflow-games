from playwright.sync_api import sync_playwright
import json
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":900,"height":600})
    errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://localhost:8780/games/void-skirmish-3d/", wait_until="load", timeout=60000); pg.wait_for_timeout(3500)
    out=pg.evaluate("""async ()=>{
      const K=window.__FFG3D__.kernel;
      // grab THREE from the kernel scene's constructor chain is hard; import via the module graph isn't exposed.
      // Instead measure using the kernel: load chars, add to scene, use bounding box through traversal of geometry.
      const res={};
      for (const name of ['soldier','robot']){
        const url=new URL('runtime/3d/characters/'+name+'.glb', location.href).href;
        const c=await K.loadCharacter(url);
        K.scene.add(c.scene); c.scene.updateWorldMatrix(true,true);
        // compute world-space y extent by sampling skinned mesh geometry positions
        let miny=1e9,maxy=-1e9,minx=1e9,maxx=-1e9, verts=0;
        c.scene.traverse(o=>{
          if((o.isMesh||o.isSkinnedMesh) && o.geometry && o.geometry.attributes.position){
            const pos=o.geometry.attributes.position; o.updateWorldMatrix(true,false);
            const m=o.matrixWorld;
            for(let i=0;i<pos.count;i+=Math.max(1,Math.floor(pos.count/200))){
              const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i);
              // apply world matrix
              const e=m.elements;
              const wy=e[1]*x+e[5]*y+e[9]*z+e[13];
              const wx=e[0]*x+e[4]*y+e[8]*z+e[12];
              if(wy<miny)miny=wy; if(wy>maxy)maxy=wy; if(wx<minx)minx=wx; if(wx>maxx)maxx=wx; verts++;
            }
          }
        });
        K.scene.remove(c.scene);
        res[name]={ heightY:+(maxy-miny).toFixed(3), widthX:+(maxx-minx).toFixed(3), miny:+miny.toFixed(3), verts };
      }
      return res;
    }""")
    print(json.dumps(out,indent=2)); print("ERRS:",errs[:5])
    b.close()
