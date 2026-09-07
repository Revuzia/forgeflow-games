"""What am I actually looking at? Raycast a screen grid from the live camera and
name the mesh under each pixel. Used to identify floating geometry in a frame."""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_rime3 import P

RAY = r"""
async ([pts]) => {
  const THREE = await import('three');
  const G = CRESTBOUND.game, e = G.engine;
  const cam = e.camera;
  e.scene.updateMatrixWorld(true);
  const rc = new THREE.Raycaster();
  rc.far = 400;
  const out = [];
  for (const [px, py] of pts) {
    const ndc = new THREE.Vector2(px * 2 - 1, -(py * 2 - 1));
    rc.setFromCamera(ndc, cam);
    let hits = [];
    try { hits = rc.intersectObject(e.scene, true); } catch (err) { out.push({px, py, err: String(err).slice(0,80)}); continue; }
    const h = hits.filter(x => x.object && x.object.visible && !/sky|shadowBlob/i.test(x.object.name||''))[0];
    if (!h) { out.push({px, py, hit: null}); continue; }
    let path = [], o = h.object;
    while (o && path.length < 6) { path.push(o.name || o.type); o = o.parent; }
    out.push({px, py, n: (h.object.name||h.object.type).slice(0,34), d: +h.distance.toFixed(1),
              p: [+h.point.x.toFixed(1), +h.point.y.toFixed(1), +h.point.z.toFixed(1)],
              path: path.join('<').slice(0, 90)});
  }
  return out;
}
"""

with P("ray") as g:
    g.start("rime-3")
    g.tp(0, 2.2, 46)
    g.js("() => { const G=CRESTBOUND.game; G.player.__test.setFacing(0); if(G.cam){G.cam.yaw=0;G.cam.pitch=0;} }")
    g.wait(1500)
    g.shot("ray_frame")
    # screen points of interest from spawn_01_authored_spawn.png (1280x720)
    pts = [
        [620/1280, 110/720],   # the floating pale blob, centre-top
        [600/1280,  60/720],
        [660/1280, 150/720],
        [415/1280,  90/720],   # the hoop up-left
        [ 40/1280,  30/720],   # ring arc top-left corner
        [1160/1280,190/720],   # ring right
        [1060/1280, 40/720],   # ring top-right
        [ 450/1280,250/720],   # the dark mound
        [ 300/1280,300/720],
        [ 604/1280,256/720],   # the orange orb
        [ 240/1280,400/720],   # left pedestal
        [1120/1280,395/720],   # right pedestal
        [ 640/1280,600/720],   # ground in front
    ]
    res = g.js(RAY, [pts])
    for r in res:
        g.say("   px=%.3f py=%.3f -> %s" % (r["px"], r["py"], json.dumps({k: v for k, v in r.items() if k not in ("px", "py")})))
    g.dump()
