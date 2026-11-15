"""R3 feel lane: is the wall-kick ladder PLAYABLE — i.e. can you see the hero?

The strips (_shots/feel_r3/sheet_wallkick.png) show the camera either inside
Nim's head or behind the shaft wall for the whole two-kick ladder. This measures
it: for every frame of the kick ladder, the camera-to-hero distance, whether the
hero's head is closer than the near plane, and whether a broadphase ray from the
camera to the head is blocked by geometry (= hero occluded).

The shaft is ROUTE B of verdant-1 (course def line 701: "THE SHAFT the west
tower is hollow ... one jump plus four wall kicks"), an authored primary route,
not a harness-only teleport target.
"""
import json, math, os, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feelshots import DRIVER_JS, launch, leave_title, DEFAULT_URL, HERE, SHAFT, MEADOW

CAMPROBE_JS = r"""
() => {
  const A = CRESTBOUND, G = A.game, E = A.engine, T = A.THREE;
  const p = G.player, cam = E.camera, bp = G.course.broadphase;
  const head = new T.Vector3(p.pos.x, p.pos.y + 1.2, p.pos.z);
  const cp = cam.position;
  const d = head.clone().sub(cp);
  const dist = d.length();
  d.normalize();
  const hit = {t: 0, normal: new T.Vector3(), collider: null};
  /* stop the ray a hero-radius short so touching his own capsule is not a hit */
  const blocked = dist > 0.5 ? bp.raycast(cp, d, dist - 0.45, hit) : false;
  return {dist: +dist.toFixed(3),
          camdist: +(G.cam && G.cam.dist != null ? G.cam.dist : -1).toFixed(3),
          near: +cam.near.toFixed(3),
          inside_near: dist < cam.near + 0.35,
          occluded: !!blocked,
          hit_t: blocked ? +hit.t.toFixed(3) : null,
          mode: G.cam ? G.cam.mode : null,
          st: p.state, y: +p.pos.y.toFixed(2)};
}
"""

RUN_JS = r"""
(cfg) => {
  const F = window.__FEEL;
  F.begin({});
  F.place(cfg.p[0], cfg.p[1], cfg.p[2], cfg.yaw);
  F.step(30);
  F.begin({auto: cfg.auto});
  return true;
}
"""

def main():
    out = {}
    with sync_playwright() as p:
        br = launch(p, headless=True)
        pg = br.new_page(viewport={"width": 1200, "height": 675})
        pg.goto(DEFAULT_URL, wait_until="load", timeout=90_000)
        t = time.time() + 120
        while time.time() < t:
            if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game)"): break
            pg.wait_for_timeout(400)
        leave_title(pg)
        pg.evaluate("async (id) => { await CRESTBOUND.game.__dev.goto(id); }", "verdant-1")
        leave_title(pg, 60); pg.wait_for_timeout(1500)
        assert pg.evaluate(DRIVER_JS) == "ok"

        for label, place, auto, n in (("shaft_wallkick", SHAFT, "wallkick", 200),
                                      ("meadow_run", MEADOW, None, 120)):
            pg.evaluate(RUN_JS, {"p": place["p"], "yaw": place["yaw"], "auto": auto})
            if auto is None:
                pg.evaluate("() => window.__FEEL.setStick(0,-1,1)")
            rows = []
            for i in range(n):
                pg.evaluate("() => window.__FEEL.step(1)")
                rows.append(pg.evaluate(CAMPROBE_JS))
            out[label] = rows
            occ = sum(1 for r in rows if r["occluded"])
            near = sum(1 for r in rows if r["inside_near"])
            close = sum(1 for r in rows if r["dist"] < 1.6)
            # longest unbroken occluded-or-too-close run, in seconds
            best = cur = 0
            for r in rows:
                cur = cur + 1 if (r["occluded"] or r["dist"] < 1.6) else 0
                best = max(best, cur)
            dm = min(r["dist"] for r in rows)
            print("\n=== %s  (%d frames = %.2f s) ===" % (label, n, n / 60.0))
            print("  camera-to-head distance:  min %.3f m   mean %.3f m   (TUNE cam.minDist 1.6, dist 6.8)"
                  % (dm, sum(r["dist"] for r in rows) / len(rows)))
            print("  frames occluded by geometry : %d / %d  (%.0f %%)" % (occ, n, 100.0 * occ / n))
            print("  frames closer than minDist  : %d / %d  (%.0f %%)" % (close, n, 100.0 * close / n))
            print("  frames inside the near plane: %d / %d" % (near, n))
            print("  LONGEST unbroken hero-not-usably-visible run: %.3f s  (contract cam gate: 0.3 s)"
                  % (best / 60.0))
            print("  sample rows (every 12th):")
            for r in rows[::12]:
                print("     st=%-10s y%6.2f  dist %6.3f  camdist %6.3f  occl=%-5s near=%s"
                      % (r["st"], r["y"], r["dist"], r["camdist"], r["occluded"], r["inside_near"]))
        br.close()
    with open(os.path.join(HERE, "_r3_shaftcam.json"), "w") as fh:
        json.dump(out, fh, indent=1)
    print("\nwrote _harness/_r3_shaftcam.json")

main()
