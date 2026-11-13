from playwright.sync_api import sync_playwright
import json
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":1280,"height":800})
    pg.goto("http://localhost:8780/games/iron-tide/", wait_until="load", timeout=60000)
    pg.wait_for_timeout(3000)
    pg.evaluate("()=>{const t=window.__FFG3D__.controller.__test;t.menuPlay();}")
    pg.wait_for_timeout(500)
    pg.evaluate("()=>{const t=window.__FFG3D__.controller.__test;t.placeAuto();}")
    pg.wait_for_timeout(1200)
    out = pg.evaluate("""()=>{
      const THREE = window.__FFG3D__.kernel.constructor; // not reliable
      const sim = window.__FFG3D__.controller.sim;
      const CELL = 2.4;
      const res = [];
      for (const s of sim.player.ships) {
        if (!s._obj) { res.push({id:s.id,len:s.len,placed:false}); continue; }
        // compute world AABB via three from the global THREE on the module
        const o = s._obj;
        // walk meshes to get min/max
        let minx=1e9,maxx=-1e9,minz=1e9,maxz=-1e9,miny=1e9,maxy=-1e9;
        o.updateMatrixWorld(true);
        o.traverse(m=>{ if(m.isMesh && m.geometry){ m.geometry.computeBoundingBox(); const bb=m.geometry.boundingBox; const pts=[[bb.min.x,bb.min.y,bb.min.z],[bb.max.x,bb.max.y,bb.max.z],[bb.min.x,bb.min.y,bb.max.z],[bb.max.x,bb.min.y,bb.min.z],[bb.min.x,bb.max.y,bb.min.z],[bb.max.x,bb.max.y,bb.max.z],[bb.min.x,bb.max.y,bb.max.z],[bb.max.x,bb.max.y,bb.min.z]]; for(const pt of pts){ const v=new m.position.constructor(pt[0],pt[1],pt[2]); v.applyMatrix4(m.matrixWorld); minx=Math.min(minx,v.x);maxx=Math.max(maxx,v.x);minz=Math.min(minz,v.z);maxz=Math.max(maxz,v.z);miny=Math.min(miny,v.y);maxy=Math.max(maxy,v.y);} } });
        const ex=(maxx-minx)/CELL, ez=(maxz-minz)/CELL;
        const longCells = Math.max(ex,ez), shortCells=Math.min(ex,ez);
        res.push({id:s.id,len:s.len,horizontal:s.horizontal,longCells:+longCells.toFixed(2),shortCells:+shortCells.toFixed(2),bottomY:+miny.toFixed(2)});
      }
      return res;
    }""")
    print(json.dumps(out, indent=2))
    b.close()
