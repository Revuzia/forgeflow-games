"""R4 feel lane: WHY the shaft tier does or does not engage on the kick ladder.

Dumps the camera solver's own state every frame of the 200-frame ladder:
posed pitch, the player's orbit pitch, the adaptive offset, the shaft-tier
offset and its target, the collided distance, and the hero state.
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feelshots import DRIVER_JS, launch, leave_title, DEFAULT_URL, HERE, SHAFT

PROBE_JS = r"""
() => {
  const A = CRESTBOUND, G = A.game, E = A.engine, T = A.THREE;
  const p = G.player, cam = E.camera, bp = G.course.broadphase;
  const s = G.cam.__test.state();
  const head = new T.Vector3(p.pos.x, p.pos.y + 1.2, p.pos.z);
  const d = head.clone().sub(cam.position); const dist = d.length();
  return {st: p.state, y: +p.pos.y.toFixed(2), dist: +dist.toFixed(3),
          camdist: +s.dist.toFixed(3), pitch: +s.pitch.toFixed(3),
          pOrbit: +s.pitchOrbit.toFixed(3), pAdapt: +s.pitchAdapt.toFixed(3),
          pSlide: +s.pitchSlide.toFixed(3), pWant: +s.pitchWant.toFixed(3),
          yawSlide: +s.yawSlide.toFixed(3), frozen: s.autoFrozen,
          limitFrame: s.limitFrame, limitCeil: s.limitCeil};
}
"""

RUN_JS = r"""
(cfg) => { const F = window.__FEEL; F.begin({}); F.place(cfg.p[0], cfg.p[1], cfg.p[2], cfg.yaw);
           F.step(30); F.begin({auto: cfg.auto}); return true; }
"""

def main():
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
        pg.evaluate(RUN_JS, {"p": SHAFT["p"], "yaw": SHAFT["yaw"], "auto": "wallkick"})
        rows = []
        for i in range(200):
            pg.evaluate("() => window.__FEEL.step(1)")
            rows.append(pg.evaluate(PROBE_JS))
        br.close()
    with open(os.path.join(HERE, "_r4_shaftpitch.json"), "w") as fh:
        json.dump(rows, fh, indent=1)
    print("  f  state        y     dist  camd   pitch pOrb  pAdp  pSld  pWnt  yawS  frz")
    for i, r in enumerate(rows):
        if i % 4: continue
        print("%3d %-11s %5.2f %6.3f %5.2f  %5.2f %5.2f %5.2f %5.2f %5.2f %5.2f %s"
              % (i, r["st"], r["y"], r["dist"], r["camdist"], r["pitch"], r["pOrbit"],
                 r["pAdapt"], r["pSlide"], r["pWant"], r["yawSlide"], r["frozen"]))
    print("wrote _harness/_r4_shaftpitch.json")

main()
