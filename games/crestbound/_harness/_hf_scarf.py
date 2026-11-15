"""HERO lane: where is the scarf, in the hero's own frame?

Dumps every Verlet particle in ROOT-LOCAL metres (x = hero right, y = up,
z = BACKWARD; the face looks toward -z) together with the head bone, for the
prone states where the chain was measured lying across Nim's face.
"""
import json, os, sys
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
    // The SEIZE hook drives writeFields ITSELF, H.sub times per hero.update, and
    // P.update is a no-op. Calling both would advance H.sub * subDt of game time
    // per requested 1/120 s step — which is how an earlier version of this probe
    // integrated longjump's vy to -160 m/s and reported the scarf blown straight
    // up. One substep of exactly the step we ask for.
    HH.sub = 1; HH.subDt = 1 / 120; HH.stopAt = 1e9; HH.pin = true;
    HH.on = true; HH.frozen = false; HH.anim = job.from || 'fall'; HH.grounded = !!job.fromGrounded;
    HH.vx = 0; HH.vy = -1; HH.vz = 0; HH.speed = 0; HH.gravity = 0; HH.t = 0;
    HH.facing = 0; HH.dead = false; HH.pin = true; HH.drift = false;
    HH.wallNx = job.wallNx||0; HH.wallNz = 0; HH.inWater = !!job.inWater; HH.submerged = !!job.submerged;
    for (let i = 0; i < 60; i++) { hero.update(1/120, G.player); }
    HH.anim = job.anim; HH.grounded = !!job.grounded;
    HH.vx = job.vx||0; HH.vy = job.vy||0; HH.vz = job.vz||0;
    HH.speed = Math.hypot(HH.vx, HH.vz); HH.gravity = job.gravity||0; HH.t = 0;
    const steps = Math.max(1, Math.round(job.t / (1/120)));
    for (let i = 0; i < steps; i++) { hero.update(1/120, G.player); }
    hero.root.updateWorldMatrix(true, true);
    const f = hero.root.rotation.y, cf = Math.cos(-f), sf = Math.sin(-f);
    const rp = hero.root.position;
    const loc = (wx, wy, wz) => {
      const dx = wx - rp.x, dy = wy - rp.y, dz = wz - rp.z;
      return [+(cf*dx + sf*dz).toFixed(3), +dy.toFixed(3), +(-sf*dx + cf*dz).toFixed(3)];
    };
    const rec = {anim: job.anim, t: job.t, pts: []};
    const P = hero._scarfP, N = P.length/3;
    for (let i = 0; i < N; i++) rec.pts.push(loc(P[i*3], P[i*3+1], P[i*3+2]));
    for (const b of ['head','neck','chest']) {
      hero.bones[b].matrixWorld.decompose(v,q,s);
      rec[b] = loc(v.x, v.y, v.z);
    }
    // the FACE point: head centre pushed 0.26 m along the head's own -Z
    const hm = hero.bones.head.matrixWorld.elements;
    const l = Math.hypot(hm[8],hm[9],hm[10])||1;
    hero.bones.head.matrixWorld.decompose(v,q,s);
    rec.face = loc(v.x - hm[8]/l*0.26, v.y - hm[9]/l*0.26, v.z - hm[10]/l*0.26);
    // closest approach of any chain SEGMENT to the face point, world metres
    let best = 1e9;
    const fx = v.x - hm[8]/l*0.26, fy = v.y - hm[9]/l*0.26, fz = v.z - hm[10]/l*0.26;
    for (let i = 1; i < N; i++) {
      const ax=P[(i-1)*3], ay=P[(i-1)*3+1], az=P[(i-1)*3+2];
      const bx=P[i*3], by=P[i*3+1], bz=P[i*3+2];
      const dx=bx-ax, dy=by-ay, dz=bz-az;
      const dd = dx*dx+dy*dy+dz*dz || 1e-9;
      let tt = ((fx-ax)*dx + (fy-ay)*dy + (fz-az)*dz)/dd;
      tt = Math.max(0, Math.min(1, tt));
      const ex=ax+dx*tt-fx, ey=ay+dy*tt-fy, ez=az+dz*tt-fz;
      best = Math.min(best, Math.hypot(ex,ey,ez));
    }
    rec.faceClear = +best.toFixed(3);
    out.push(rec);
  }
  HH.on = false;
  return out;
}
"""

JOBS = []
for name, dur, kw in H.STATES:
    if name not in ("longjump","dive","poundFall","fly","land","swim","hardLand","slide"):
        continue
    for lbl, ph in (("p50", 0.50), ("p90", 0.90)):
        j = dict(kw); j["anim"] = name; j["t"] = round(dur*ph, 4)
        j["from_"] = kw.get("from_")
        j["from"] = kw.get("from_") or ("idle" if kw.get("grounded") else "fall")
        j["fromGrounded"] = 1 if j["from"] in H.GROUNDED_FROM else 0
        j.pop("from_", None)
        JOBS.append(j)

with sync_playwright() as p:
    br = p.chromium.launch(channel="chrome", headless=True, args=H.HEADLESS_FLAGS)
    pg = br.new_page(viewport={"width": 700, "height": 700})
    H.boot(pg, "verdant-1") if hasattr(H, "boot") else None
    pg.goto(H.BASE + "?course=verdant-1&dev=1", wait_until="load")
    pg.wait_for_function("globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.hero", timeout=60000)
    pg.evaluate(H.CLICK_JS)
    pg.wait_for_timeout(2500)
    pg.evaluate(H.SEIZE_JS)
    res = pg.evaluate(MEAS, {"jobs": JOBS})
    br.close()

for r in res:
    print("%-12s t=%-5s faceClear=%.3f  head=%s face=%s" % (r["anim"], r["t"], r["faceClear"], r["head"], r["face"]))
    for i, q in enumerate(r["pts"]):
        print("    p%d %7.3f %7.3f %7.3f" % (i, q[0], q[1], q[2]))
json.dump(res, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "_hf_scarf.json"), "w"), indent=1)
