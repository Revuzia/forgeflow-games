"""Numeric pose probe: squash/stretch, flip angle, arm swing, scarf curvature.
Reuses heroshots' SEIZE hook so the pose writers run for real."""
import json, os, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import heroshots as H

MEAS = r"""
(args) => {
  const A = globalThis.CRESTBOUND, G = A.game, hero = G.hero, THREE = A.THREE;
  const HH = window.__HH;
  const out = [];
  const v = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  for (const job of args.jobs) {
    HH.on = true; HH.frozen = false; HH.anim = job.anim; HH.grounded = !!job.grounded;
    HH.vx = job.vx||0; HH.vy = job.vy||0; HH.vz = job.vz||0; HH.speed = job.speed||0;
    HH.t = 0; HH.facing = 0; HH.dead = job.anim === 'dead';
    // hand-step the sim to the requested animT
    const steps = Math.max(1, Math.round(job.t / (1/120)));
    for (let i = 0; i < steps; i++) { G.player.update(1/120); hero.update(1/120, G.player); }
    hero.root.updateWorldMatrix(true, true);
    const rec = {anim: job.anim, t: job.t};
    rec.rootScaleY = hero.root.scale.y; rec.rootScaleX = hero.root.scale.x;
    const B = hero.bones;
    for (const b of ['hips','chest','head','handL','handR','footL','footR']) {
      if (!B[b]) continue;
      B[b].matrixWorld.decompose(v,q,s);
      rec[b] = [ +(v.x - hero.root.position.x).toFixed(3),
                 +(v.y - hero.root.position.y).toFixed(3),
                 +(v.z - hero.root.position.z).toFixed(3) ];
    }
    B.hips.matrixWorld.decompose(v,q,s);
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    rec.hipsPitchDeg = +(e.x*180/Math.PI).toFixed(1);
    rec.hipsRollDeg  = +(e.z*180/Math.PI).toFixed(1);
    // scarf: max deviation of the chain from the straight anchor->tip line
    const P = hero._scarfP, N = P.length/3;
    const a = [P[0],P[1],P[2]], z = [P[(N-1)*3],P[(N-1)*3+1],P[(N-1)*3+2]];
    const d = [z[0]-a[0], z[1]-a[1], z[2]-a[2]];
    const dl = Math.hypot(d[0],d[1],d[2]) || 1e-6;
    let maxdev = 0, span = 0;
    for (let i=1;i<N;i++){
      const px=P[i*3]-a[0], py=P[i*3+1]-a[1], pz=P[i*3+2]-a[2];
      const tproj=(px*d[0]+py*d[1]+pz*d[2])/(dl*dl);
      const ex=px-d[0]*tproj, ey=py-d[1]*tproj, ez=pz-d[2]*tproj;
      maxdev=Math.max(maxdev, Math.hypot(ex,ey,ez));
    }
    // arc length
    for (let i=1;i<N;i++) span += Math.hypot(P[i*3]-P[(i-1)*3], P[i*3+1]-P[(i-1)*3+1], P[i*3+2]-P[(i-1)*3+2]);
    rec.scarfArc = +span.toFixed(3);
    rec.scarfChord = +dl.toFixed(3);
    rec.scarfSagRatio = +(maxdev/span).toFixed(4);   // 0 = perfectly straight rod
    rec.eyeLidL = hero._blinkK !== undefined ? +hero._blinkK.toFixed(3) : null;
    out.push(rec);
  }
  HH.on = false;
  return out;
}
"""

JOBS = []
for a, g, sp in [("idle",1,0),("run",1,9),("jump1",0,6),("jump2",0,6),("jump3",0,7),
                 ("longjump",0,17),("dive",0,13.5),("fall",0,4),("land",1,0),
                 ("hardLand",1,0),("poundFall",0,0),("swim",0,4.5),("climb",0,0),
                 ("wallslide",0,0),("backflip",0,0),("dead",1,0)]:
    for t in (0.05, 0.25, 0.5):
        JOBS.append({"anim": a, "grounded": g, "speed": sp,
                     "vx": sp if a in ("run","longjump","dive","swim") else 0,
                     "vy": -20 if a in ("poundFall","hardLand","fall") else (8 if a.startswith("jump") else 0),
                     "t": t})

def main():
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=True, args=H.HEADLESS_FLAGS)
        pg = br.new_page(viewport={"width": 700, "height": 700})
        pg.goto("http://localhost:8788/games/crestbound/index.html?dev=1&course=verdant-1",
                wait_until="load", timeout=60000)
        dl = time.time() + 60
        while time.time() < dl:
            if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.hero)"): break
            pg.wait_for_timeout(300)
        H.leave_title(pg); pg.wait_for_timeout(2500)
        print("seize:", pg.evaluate(H.SEIZE_JS))
        res = pg.evaluate(MEAS, {"jobs": JOBS})
        br.close()
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_r3pose.json")
    json.dump(res, open(out, "w"), indent=1)
    print("%-11s %-5s %7s %7s %7s %7s %8s %8s" % ("anim","t","sclY","hipPit","hipRol","hHandR","scarfSag","scarfArc"))
    for r in res:
        print("%-11s %-5s %7.3f %7.1f %7.1f %7.3f %8.4f %8.3f" % (
            r["anim"], r["t"], r["rootScaleY"], r["hipsPitchDeg"], r["hipsRollDeg"],
            (r.get("handR") or [0,0,0])[2], r["scarfSagRatio"], r["scarfArc"]))
main()
