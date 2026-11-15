#!/usr/bin/env python
"""Feel lane round-2 probe: TURN RADIUS vs speed (the one bible line no gate
measures) + a wall-kick ladder diagnostic. Reuses feelshots' boot + driver so
the game is hand-stepped at exactly 1/60 s and never times off the wall clock."""
import json, math, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import feelshots as FS
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))

# Find the biggest obstacle-free disc on the terrain: sample the broadphase for
# solid colliders whose AABB overlaps hero height at each candidate centre.
CLEAR_JS = r"""
(args) => {
  const G = CRESTBOUND.game, c = G.course;
  const bp = c.broadphase;
  const out = [];
  const THREE = CRESTBOUND.THREE;
  const box = new THREE.Box3();
  const hits = [];
  for (const cand of args.cands) {
    const [cx, cz] = cand;
    let hy = null;
    for (const h of bp.heightfields) { const y = h.heightAt(cx, cz);
      if (Number.isFinite(y) && (hy === null || y > hy)) hy = y; }
    if (hy === null) { out.push({p: cand, y: null, clear: 0}); continue; }
    // march 16 rays out to 30 m at hero chest height; report the min free dist
    let worst = 30, worstDir = 0;
    const o = new THREE.Vector3(cx, hy + 0.75, cz), dir = new THREE.Vector3();
    const hit = {t: 0, normal: new THREE.Vector3(), collider: null};
    for (let k = 0; k < 16; k++) {
      const a = k * Math.PI / 8;
      dir.set(Math.cos(a), 0, Math.sin(a));
      let d = 30;
      if (bp.raycast(o, dir, 30, hit)) d = hit.t;
      // terrain step-up: a rise the hero can walk is not an obstacle, but the
      // raycast cannot tell; keep it conservative and report the raw distance.
      if (d < worst) { worst = d; worstDir = a; }
    }
    out.push({p: cand, y: +hy.toFixed(2), clear: +worst.toFixed(2), dir: +worstDir.toFixed(2)});
  }
  return out;
}"""

def main():
    cands = []
    for x in range(-60, 61, 10):
        for z in range(-60, 81, 10):
            cands.append([x, z])
    with sync_playwright() as p:
        b = FS.launch(p, True)
        pg = b.new_page(viewport={"width": 1200, "height": 675})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(FS.DEFAULT_URL, wait_until="load", timeout=90_000)
        dl = time.time() + 150
        while time.time() < dl:
            try:
                if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game)"): break
            except Exception: pass
            pg.wait_for_timeout(400)
        FS.leave_title(pg)
        pg.evaluate("async (id) => { await CRESTBOUND.game.__dev.goto(id); }", "verdant-1")
        FS.leave_title(pg, timeout=60)
        pg.wait_for_timeout(1500)
        assert pg.evaluate(FS.DRIVER_JS) == "ok"
        res = pg.evaluate(CLEAR_JS, {"cands": cands})
        res = [r for r in res if r["y"] is not None]
        res.sort(key=lambda r: -r["clear"])
        print("clearest spots (centre, ground y, min free radius over 16 rays):")
        for r in res[:12]:
            print("   %-14s y=%6.2f  clear=%5.2f m" % (r["p"], r["y"], r["clear"]))
        json.dump(res, open(os.path.join(HERE, "_feelarc_clear.json"), "w"), indent=1)
        b.close()

main()
