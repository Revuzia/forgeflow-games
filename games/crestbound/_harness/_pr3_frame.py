"""Project the wing rings + checkpoint markers into the SPAWN FRAME and say which
are on screen. Plus side views of the cp-camp beacon."""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _play_rime3 import P, run

PROJ = r"""
async ([pts]) => {
  const THREE = await import('three');
  const e = CRESTBOUND.game.engine, cam = e.camera;
  cam.updateMatrixWorld(true); cam.updateProjectionMatrix();
  const v = new THREE.Vector3();
  return pts.map(([x,y,z,tag]) => {
    v.set(x,y,z).project(cam);
    const px = (v.x*0.5+0.5), py = (-v.y*0.5+0.5);
    const dist = Math.hypot(x-cam.position.x, y-cam.position.y, z-cam.position.z);
    return { tag, px:+px.toFixed(3), py:+py.toFixed(3), z:+v.z.toFixed(3),
             onScreen: v.z>-1 && v.z<1 && px>=-0.02 && px<=1.02 && py>=-0.02 && py<=1.02,
             d:+dist.toFixed(1) };
  });
}
"""

RINGS = [[0,40,6],[-6.01,37.4,7.44],[-13.04,34.8,5],[-18.63,32.2,-1.74],[-20.28,29.6,-11.69],
         [-16.32,27,-22.42],[-6.59,24.4,-30.74],[7.29,21.8,-33.58],[22.14,19.2,-28.99],
         [33.95,16.6,-16.87],[38.94,14,0.73],[34.69,11.4,19.95],[20.95,8.8,35.91],[12,6,52]]

def body(g):
    g.start("rime-3")
    g.tp(0, 2.2, 46)
    g.js("() => { const G=CRESTBOUND.game; G.player.__test.setFacing(0); if(G.cam){G.cam.yaw=0;G.cam.pitch=0;} }")
    g.wait(1400)
    g.shot("spawn_pitch0")
    pts = [[p[0], p[1], p[2], "ring %d" % i] for i, p in enumerate(RINGS)]
    pts += [[0, 2.2, 41, "cp-camp pad"], [0, 6.9, 41, "cp-camp beacon top"],
            [-5, 3.55, 41, "coin pedestal crest"], [6, 3.6, 42, "wing crest"],
            [0, 4.5, 43.4, "camp light"]]
    for r in g.js(PROJ, [pts]):
        g.say("   %-20s px=%6.3f py=%6.3f d=%6.1f %s" % (r["tag"], r["px"], r["py"], r["d"],
              "ON SCREEN" if r["onScreen"] else ""))

    # side view of cp-camp so the pad and the beacon are both in frame
    g.tp(9.0, 2.6, 41.0)
    g.js("() => { const G=CRESTBOUND.game; if(G.cam){G.cam.yaw=Math.PI/2;G.cam.pitch=0.02;G.cam.dist=9;} }")
    g.wait(1200); g.shot("cpcamp_side")
    # and the gorge checkpoint, to see if every checkpoint wears the same marker
    g.tp(-30.0, 7.2, -9.0)
    g.js("() => { const G=CRESTBOUND.game; if(G.cam){G.cam.yaw=Math.PI/2;G.cam.pitch=0.02;} }")
    g.wait(1200); g.shot("cpgorge_side")

run("frame", body)
