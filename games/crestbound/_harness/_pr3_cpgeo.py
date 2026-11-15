"""What is the giant pale mass over base camp? Measure the checkpoints group,
and list the wing rings and whether they are visible without the wing power."""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_rime3 import P

DUMP = r"""
async () => {
  const THREE = await import('three');
  const G = CRESTBOUND.game, e = G.engine;
  e.scene.updateMatrixWorld(true);
  const out = { checkpoints: [], rings: [], ringGroup: null, powers: [] };
  const cps = e.scene.getObjectByName('checkpoints');
  if (cps) {
    cps.traverse(o => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      const bb = new THREE.Box3().setFromObject(o);
      out.checkpoints.push({ n: (o.name||o.type).slice(0,30), vis: o.visible,
        min: [+bb.min.x.toFixed(2), +bb.min.y.toFixed(2), +bb.min.z.toFixed(2)],
        max: [+bb.max.x.toFixed(2), +bb.max.y.toFixed(2), +bb.max.z.toFixed(2)],
        mat: o.material && o.material.name || (o.material && o.material.type),
        cnt: o.count === undefined ? null : o.count });
    });
  } else out.checkpoints = 'no group named checkpoints';
  const rg = e.scene.getObjectByName('hz_rings');
  if (rg) {
    const bb = new THREE.Box3().setFromObject(rg);
    out.ringGroup = { vis: rg.visible, min: [+bb.min.x.toFixed(1),+bb.min.y.toFixed(1),+bb.min.z.toFixed(1)],
                      max: [+bb.max.x.toFixed(1),+bb.max.y.toFixed(1),+bb.max.z.toFixed(1)] };
    rg.traverse(o => { if (!o.isMesh && !o.isInstancedMesh) return;
      out.rings.push({ n:(o.name||o.type), vis:o.visible, cnt:o.count===undefined?null:o.count,
        mat:o.material&&o.material.type, op:o.material&&o.material.opacity }); });
  }
  // the authored ring points, straight off the course def
  const def = G.course && G.course.def;
  if (def) { const r = (def.objects||[]).find(o => o.kind === 'rings');
    if (r) out.ringPts = r.pts; }
  out.power = G.player && G.player.power || (G.__dev && null);
  return out;
}
"""

with P("cpgeo") as g:
    g.start("rime-3")
    g.tp(0, 2.2, 46); g.wait(800)
    d = g.js(DUMP)
    g.say("-- checkpoint meshes (world bounding boxes) --")
    if isinstance(d["checkpoints"], list):
        for r in d["checkpoints"]:
            g.say("   ", json.dumps(r))
    else:
        g.say("   ", d["checkpoints"])
    g.say("-- ring group --", json.dumps(d.get("ringGroup")))
    for r in d.get("rings", []):
        g.say("   ring mesh:", json.dumps(r))
    g.say("-- authored ring points --")
    for i, p in enumerate(d.get("ringPts") or []):
        g.say("   ring %2d %s" % (i, p))
    # zoom the camera up so the whole checkpoint marker is in frame
    g.js("() => { const c=CRESTBOUND.game.cam; c.yaw=0; c.pitch=-0.30; }")
    g.wait(800); g.shot("cp_marker_up")
    g.js("() => { const c=CRESTBOUND.game.cam; c.yaw=0; c.pitch=0.10; }")
    g.wait(800); g.shot("cp_marker_level")
    # stand ON the pad and look at it
    g.tp(0, 2.4, 44); g.js("() => { const c=CRESTBOUND.game.cam; c.yaw=0; c.pitch=-0.15; }")
    g.wait(900); g.shot("cp_marker_close")
    g.dump()
