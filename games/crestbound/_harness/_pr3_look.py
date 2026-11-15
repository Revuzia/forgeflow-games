"""Look hard at the west face: the unreadable sign, the dark terrain mass, the
bright hairlines on the snow, and the blue teardrop by the shelves."""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_rime3 import P, run

RAY = r"""
async ([pts]) => {
  const THREE = await import('three');
  const e = CRESTBOUND.game.engine, cam = e.camera;
  e.scene.updateMatrixWorld(true);
  const rc = new THREE.Raycaster(); rc.far = 500;
  return pts.map(([px,py,tag]) => {
    rc.setFromCamera(new THREE.Vector2(px*2-1, -(py*2-1)), cam);
    let hits = []; try { hits = rc.intersectObject(e.scene, true); } catch(err){ return {tag, err:String(err).slice(0,80)}; }
    const rows = [];
    for (const h of hits) { const n = h.object.name || h.object.type;
      if (!h.object.visible || /sky|shadowBlob/i.test(n)) continue;
      let par=h.object.parent, chain=[]; while(par&&chain.length<3){chain.push(par.name||par.type);par=par.parent;}
      rows.push({n:n.slice(0,32), d:+h.distance.toFixed(1),
                 p:[+h.point.x.toFixed(1),+h.point.y.toFixed(1),+h.point.z.toFixed(1)], up:chain.join('<').slice(0,50)});
      if (rows.length>=4) break; }
    return {tag, hits: rows};
  });
}
"""


def body(g):
    g.start("rime-3")
    # stand on cp-westface, same camera as west_04
    g.tp(-25.59, 3.40, 31.85)
    g.look(-25.2, 29.6)
    g.wait(1200)
    g.shot("westface_shadows_on")
    g.say("-- what is at those screen points --")
    pts = [
        [620/1280, 300/720, "the LEAN WEST text plate"],
        [430/1280, 250/720, "blue teardrop"],
        [430/1280, 480/720, "bright hairline on the snow (left)"],
        [1000/1280, 425/720, "bright hairline on the snow (right)"],
        [800/1280, 280/720, "the dark terrain mass"],
        [350/1280, 380/720, "the grey slab (shelf)"],
    ]
    for r in g.js(RAY, [pts]):
        g.say("  %-34s" % r.get("tag"), json.dumps(r.get("hits", r)))

    g.say("-- same frame with the shadow map OFF --")
    g.js("() => { const r = CRESTBOUND.game.engine.renderer; r.shadowMap.enabled = false; r.shadowMap.needsUpdate = true; CRESTBOUND.game.engine.scene.traverse(o=>{ if(o.material){ const m=Array.isArray(o.material)?o.material:[o.material]; m.forEach(x=>x.needsUpdate=true); } }); }")
    g.wait(1500)
    g.shot("westface_shadows_off")
    g.js("() => { const r = CRESTBOUND.game.engine.renderer; r.shadowMap.enabled = true; r.shadowMap.needsUpdate = true; CRESTBOUND.game.engine.scene.traverse(o=>{ if(o.material){ const m=Array.isArray(o.material)?o.material:[o.material]; m.forEach(x=>x.needsUpdate=true); } }); }")
    g.wait(1200)

    g.say("-- read the LEAN WEST sign from 3 m, straight on --")
    g.tp(-25.4, 3.9, 26.4)
    g.look(-25.2, 29.6); g.pitch(0.05)
    g.wait(1000); g.shot("sign_leanwest_close")
    g.tp(-23.0, 4.2, 28.0)
    g.look(-25.2, 29.6)
    g.wait(1000); g.shot("sign_leanwest_angle")

    g.say("-- the shelves from the side --")
    g.tp(-26.0, 4.6, 20.0)
    g.look(-33.0, 20.0); g.pitch(-0.05)
    g.wait(1000); g.shot("shelves_side")

    g.say("-- ground heights along the shelf line --")
    g.say(g.js("""() => { const G=CRESTBOUND.game, w=G.world; const out=[];
      const pts=[[-29,26],[-31,24],[-33,22],[-34.9,22.8],[-32.6,20],[-35.4,13.5],[-36.4,6.5],[-36,-2]];
      for (const [x,z] of pts) { let h=null;
        try { h = w && w.heightAt ? w.heightAt(x,z) : (w&&w.groundAt?w.groundAt(x,z):null); } catch(e){ h='err'; }
        out.push([x,z,h]); }
      return {out, worldKeys: w?Object.keys(w).slice(0,25):null}; }"""))


run("look", body)
