#!/usr/bin/env python
"""SCRATCH PROBE (not a gate). Replays the Keep lobby-aisle route to the frame
where the audit measured the lens jammed at 0.12 m, then sweeps yaw offsets and
pitches through the camera's OWN _clearance() so "no bounded heading clears" can
be checked instead of assumed. Prints one table; writes nothing."""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import camshots as CS
from playwright.sync_api import sync_playwright

ROUTE = [{"name": "lobby-aisle", "at": [0.0, 0.05, -1.0, 1.5707963], "indoor": True,
          "acts": [["hold", "KeyW", 2.4], ["hold", "KeyW+KeyQ", 1.0],
                   ["hold", "KeyS", 1.2], ["hold", "KeyE", 0.4]]}]

SWEEP = r"""() => {
  const G = CRESTBOUND.game, cam = G.cam || G.camera, P = G.player;
  const bp = (cam.world && (cam.world.broadphase || (cam.world.course && cam.world.course.broadphase))) || null;
  const s = cam.__test.state();
  const out = {pose: {dist: s.dist, yaw: s.yaw, pitch: s.pitch, focus: s.focus,
                      focusDrop: s.focusDrop, limitFrame: s.limitFrame, limitCeil: s.limitCeil,
                      heroFade: s.heroFade, state: P.state,
                      hero: [P.pos.x, P.pos.y, P.pos.z]},
              rows: []};
  if (!bp) { out.err = 'no broadphase'; return out; }
  const want = 6.8;
  for (let deg = -180; deg <= 180; deg += 10) {
    const off = deg * Math.PI / 180;
    const row = {deg: deg};
    for (const p of [s.pitch, 0.5, 0.75, 0.95]) {
      row['p' + p.toFixed(2)] = +cam._clearance(bp, off, p, want, false).toFixed(3);
    }
    out.rows.push(row);
  }
  return out;
}"""

def main():
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chrome", headless=True, args=CS.FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.goto(CS.DEFAULT_URL, wait_until="load", timeout=180000)
        for _ in range(40):
            st = pg.evaluate(CS.STATE_JS)
            if st in ("keep", "playing"): break
            pg.evaluate(CS.CLICK_JS); pg.wait_for_timeout(600)
        for _ in range(60):
            if pg.evaluate(CS.READY_JS): break
            pg.wait_for_timeout(400)
        pg.wait_for_timeout(1500)
        st = pg.evaluate(CS.DRIVER_JS, ROUTE)
        print("driver:", st)
        while True:
            r = pg.evaluate("(n) => __CAM.step(n)", 1)
            d = pg.evaluate("(0, CRESTBOUND.game.cam || CRESTBOUND.game.camera).dist")
            if d <= 0.35 or r["done"]:
                print("stopped at frame", r["i"], "dist", round(d, 3), "done", r["done"])
                break
        res = pg.evaluate(SWEEP)
        print(json.dumps(res["pose"], indent=1))
        print("  deg      pitchNow   0.50   0.75   0.95")
        for row in res["rows"]:
            print("  %4d   %8.3f %6.3f %6.3f %6.3f" % (
                row["deg"], row[list(row.keys())[1]], row["p0.50"], row["p0.75"], row["p0.95"]))
        br.close()

main()
