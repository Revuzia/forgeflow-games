"""Name the blue lens, the red orbs and the black text slab in the west-face frame."""
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
      rows.push({n:n.slice(0,32), d:+h.distance.toFixed(1), mat:(h.object.material&&(h.object.material.name||h.object.material.type)||'').slice(0,24),
                 p:[+h.point.x.toFixed(1),+h.point.y.toFixed(1),+h.point.z.toFixed(1)], up:chain.join('<').slice(0,46)});
      if (rows.length>=4) break; }
    return {tag, hits: rows};
  });
}
"""


def body(g):
    g.start("rime-3")
    g.tp(-25.40, 3.92, 26.40)
    g.look(-25.2, 29.6); g.pitch(0.05)
    g.wait(1400)
    g.shot("frame_for_ray")
    pts = [
        [532/1280, 245/720, "blue lens"],
        [532/1280, 215/720, "blue lens top"],
        [ 50/1280, 215/720, "red orb left"],
        [307/1280, 210/720, "red orb mid"],
        [650/1280, 470/720, "the black text slab"],
        [900/1280, 300/720, "dark mountain flank"],
        [250/1280, 550/720, "shelf top (striped)"],
        [200/1280, 640/720, "shelf side (black)"],
    ]
    for r in g.js(RAY, [pts]):
        g.say("  %-24s" % r.get("tag"), json.dumps(r.get("hits", r)))

    g.say("-- every 'text' object on this course: its material and colour --")
    g.say(g.js("""() => { const e=CRESTBOUND.game.engine, out=[]; e.scene.updateMatrixWorld(true);
      e.scene.traverse(o=>{ const n=(o.name||''); if(!/sign|text|atlas/i.test(n)) return;
        const m=o.material; out.push({n:n.slice(0,34), type:o.type, vis:o.visible,
          mat:m?(m.name||m.type):null, col:m&&m.color?('#'+m.color.getHexString()):null,
          map:!!(m&&m.map), trans:!!(m&&m.transparent), op:m?m.opacity:null,
          emis:m&&m.emissive?('#'+m.emissive.getHexString()):null}); });
      return out.slice(0,30); }"""))

    g.say("-- lights on this course (are the red orbs light glows?) --")
    g.say(g.js("""() => { const e=CRESTBOUND.game.engine, out=[]; e.scene.updateMatrixWorld(true);
      e.scene.traverse(o=>{ if(!o.isLight && !/glow|orb|lamp|flare/i.test(o.name||'')) return;
        const m=o.matrixWorld.elements;
        out.push({n:(o.name||o.type).slice(0,30), t:o.type, vis:o.visible,
          p:[+m[12].toFixed(1),+m[13].toFixed(1),+m[14].toFixed(1)],
          col:o.color?('#'+o.color.getHexString()):null, i:o.intensity===undefined?null:o.intensity}); });
      return out.slice(0,40); }"""))


run("look2", body)
