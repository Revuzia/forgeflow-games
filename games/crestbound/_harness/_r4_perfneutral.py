"""R4 feel lane: is the SHAFT TIER active at the perf stations?

The tier only ever changes the view matrix, and only while `_pitchSlide != 0`.
If it is 0 at every station perfcheck measures, the tier cannot have moved a
single draw call there, whatever the draw counts say.
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feelshots import launch, leave_title, DEFAULT_URL, HERE

STATIONS = {
    "keep":      [[0, 0.1, -1], [-14, -8, 4], [0, 0.1, 16.4]],
    "verdant-1": [[0, 2, 40], [0, 9, -14], [10, 14.4, -26]],
}

PROBE_JS = r"""
(p) => {
  const A = CRESTBOUND, G = A.game, T = A.THREE, E = A.engine;
  G.player.__test.teleport(new T.Vector3(p[0], p[1], p[2]));
  if (G.player.__test.setVel) G.player.__test.setVel(new T.Vector3(0,0,0));
  if (G.cam.snapToPlayer) G.cam.snapToPlayer();
  return true;
}
"""
READ_JS = r"""
() => { const s = CRESTBOUND.game.cam.__test.state();
        const r = CRESTBOUND.engine.renderer.info.render;
        return {pitchSlide: +s.pitchSlide.toFixed(4), dist: +s.dist.toFixed(2),
                draws: r.calls, tris: r.triangles}; }
"""

def main():
    out = {}
    with sync_playwright() as p:
        br = launch(p, headless=True)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.goto(DEFAULT_URL, wait_until="load", timeout=90_000)
        t = time.time() + 120
        while time.time() < t:
            if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game)"): break
            pg.wait_for_timeout(400)
        leave_title(pg)
        for course, pts in STATIONS.items():
            if course != "keep":
                pg.evaluate("async (id) => { await CRESTBOUND.game.__dev.goto(id); }", course)
                leave_title(pg, 60)
            pg.wait_for_timeout(1500)
            rows = []
            for pt in pts:
                pg.evaluate(PROBE_JS, pt)
                pg.wait_for_timeout(1200)
                r = pg.evaluate(READ_JS); r["p"] = pt
                rows.append(r)
                print("%-10s %-18s pitchSlide %7.4f  dist %5.2f  draws %4d tris %7d"
                      % (course, pt, r["pitchSlide"], r["dist"], r["draws"], r["tris"]))
            out[course] = rows
        br.close()
    with open(os.path.join(HERE, "_r4_perfneutral.json"), "w") as fh:
        json.dump(out, fh, indent=1)
    worst = max(abs(r["pitchSlide"]) for rows in out.values() for r in rows)
    print("\nMAX |pitchSlide| across every perf station: %.4f rad" % worst)
    print("=> the shaft tier is %s at the perf stations" % ("ACTIVE" if worst > 1e-3 else "INACTIVE"))

main()
