from playwright.sync_api import sync_playwright
import json
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={"width":1000,"height":700})
    errs=[]; pg.on("console", lambda m: errs.append(m.type+":"+m.text)); pg.on("pageerror", lambda e: errs.append("PE:"+str(e)))
    pg.goto("http://localhost:8780/games/void-skirmish-3d/", wait_until="load", timeout=60000); pg.wait_for_timeout(4000)
    out=pg.evaluate("""async ()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));
      const t=window.__FFG3D__.controller.__test, sim=window.__FFG3D__.controller.sim, K=window.__FFG3D__.kernel;
      t.start(); await s(1500);
      const THREE = K.scene.type ? null : null;
      const u = sim.aliveAllies()[0];
      // find the unit group in scene; report char info
      const ctrl = window.__FFG3D__.controller;
      // reach into closure via a global the renderer could expose? not available; inspect scene instead
      let groups=0, skinned=0, meshes=0, sample=null;
      K.scene.traverse(o=>{ if(o.isSkinnedMesh){skinned++;} if(o.isMesh){meshes++;} });
      // try loadCharacter directly to see if it works
      let direct=null;
      try {
        const url = new URL('runtime/3d/characters/soldier.glb', location.href).href;
        const c = await K.loadCharacter(url);
        const box = new (window.THREE? window.THREE.Box3 : Object)();
        let mc=0; c.scene.traverse(o=>{if(o.isMesh||o.isSkinnedMesh)mc++;});
        direct = { ok:true, meshCount:mc, anims:(c.animations||[]).map(a=>a.name) };
      } catch(e){ direct={ ok:false, err:String(e) }; }
      return { skinnedInScene:skinned, meshesInScene:meshes, direct };
    }""")
    print(json.dumps(out,indent=2)); print("ERRS:", [e for e in errs if 'error' in e.lower() or 'PE:' in e][:8])
    b.close()
