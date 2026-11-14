from playwright.sync_api import sync_playwright
import json
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page()
    pg.goto("http://localhost:8780/games/void-skirmish-3d/", wait_until="load", timeout=60000); pg.wait_for_timeout(3000)
    out=pg.evaluate("""async ()=>{const K=window.__FFG3D__.kernel; const base=new URL('runtime/3d/characters/',location.href).href; const res={};
      for(const name of ['fox','brainstem']){ const c=await K.loadCharacter(base+name+'.glb'); K.scene.add(c.scene); c.scene.updateWorldMatrix(true,true);
        let miny=1e9,maxy=-1e9; c.scene.traverse(o=>{ if((o.isMesh||o.isSkinnedMesh)&&o.geometry&&o.geometry.attributes.position){const pos=o.geometry.attributes.position;o.updateWorldMatrix(true,false);const m=o.matrixWorld.elements;for(let i=0;i<pos.count;i+=Math.max(1,Math.floor(pos.count/300))){const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i);const wy=m[1]*x+m[5]*y+m[9]*z+m[13];if(wy<miny)miny=wy;if(wy>maxy)maxy=wy;}}});
        K.scene.remove(c.scene); res[name]={heightY:+(maxy-miny).toFixed(2), miny:+miny.toFixed(2), anims:c.animations.map(a=>a.name)};
      } return res;
    }""")
    print(json.dumps(out,indent=2)); b.close()
