"""All-hits raycast: name EVERY mesh along a screen ray (not just the first)."""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_rime3 import P

RAY = r"""
async ([pts]) => {
  const THREE = await import('three');
  const G = CRESTBOUND.game, e = G.engine, cam = e.camera;
  e.scene.updateMatrixWorld(true);
  const rc = new THREE.Raycaster(); rc.far = 500;
  const out = [];
  for (const [px, py, tag] of pts) {
    rc.setFromCamera(new THREE.Vector2(px*2-1, -(py*2-1)), cam);
    let hits = [];
    try { hits = rc.intersectObject(e.scene, true); } catch (err) { out.push({tag, err:String(err).slice(0,90)}); continue; }
    const rows = [];
    for (const h of hits) {
      if (!h.object.visible) continue;
      const n = h.object.name || h.object.type;
      if (/sky|shadowBlob/i.test(n)) continue;
      let par = h.object.parent, chain = [];
      while (par && chain.length < 4) { chain.push(par.name || par.type); par = par.parent; }
      rows.push({ n: n.slice(0,34), d: +h.distance.toFixed(1),
                  p: [+h.point.x.toFixed(1), +h.point.y.toFixed(1), +h.point.z.toFixed(1)],
                  inst: h.instanceId === undefined ? null : h.instanceId,
                  up: chain.join('<').slice(0,60) });
      if (rows.length >= 5) break;
    }
    out.push({ tag, px, py, hits: rows });
  }
  return out;
}
"""

with P("ray2") as g:
    g.start("rime-3")
    g.tp(0, 2.2, 46)
    g.js("() => { const G=CRESTBOUND.game; G.player.__test.setFacing(0); if(G.cam){G.cam.yaw=0;G.cam.pitch=0;} }")
    g.wait(1400)
    g.shot("frame_pitch0")
    pts = [
        [620/1280, 110/720, "pale blob centre"],
        [590/1280,  70/720, "pale blob top"],
        [660/1280, 160/720, "pale blob low"],
        [560/1280, 130/720, "pale blob left"],
        [420/1280,  90/720, "hoop upper-left"],
        [1170/1280,200/720, "hoop right"],
        [1060/1280, 45/720, "shape top-right"],
        [200/1280, 215/720, "red lattice left"],
        [ 40/1280, 225/720, "left-edge structure"],
        [ 604/1280,258/720, "orange orb"],
        [ 245/1280,410/720, "left pedestal"],
        [1120/1280,440/720, "right pedestal"],
        [ 450/1280,250/720, "the dark mound"],
    ]
    for r in g.js(RAY, [pts]):
        g.say("  %-22s" % r.get("tag"), json.dumps(r.get("hits", r)))
    g.dump()
