"""R4: at the collapse frames of the kick ladder, sweep the solver's OWN fan
over yaw x pitch and print the clearance it reports, so the shaft tier's failure
is measured rather than guessed."""
import json, os, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feelshots import DRIVER_JS, launch, leave_title, DEFAULT_URL, HERE, SHAFT

SWEEP_JS = r"""
() => {
  const G = CRESTBOUND.game, cam = G.cam, p = G.player;
  const bp = cam._broadphase();
  const want = 6.8;
  const yaws = [0, 0.35, 0.7, 1.05, 1.4, 1.75, 2.1, 2.6, 3.14, -0.35, -0.7, -1.05, -1.4, -1.75, -2.1, -2.6];
  const pitches = [0.0, 0.3, 0.6, 0.9, 1.1, 1.25, 1.4, -0.3, -0.6];
  const out = [];
  for (const y of yaws) {
    const row = [];
    for (const pi of pitches) row.push(+cam._clearance(bp, y, pi, want, false).toFixed(2));
    out.push(row);
  }
  return {yaws, pitches, grid: out, st: p.state,
          hero: [+p.pos.x.toFixed(2), +p.pos.y.toFixed(2), +p.pos.z.toFixed(2)],
          focus: [+cam._focus.x.toFixed(2), +cam._focus.y.toFixed(2), +cam._focus.z.toFixed(2)],
          yaw: +cam.yaw.toFixed(3), dist: +cam.dist.toFixed(3),
          pitchAim: +cam._pitchAim().toFixed(3), pSlide: +cam._pitchSlide.toFixed(3)};
}
"""
RUN_JS = r"""(cfg) => { const F = window.__FEEL; F.begin({}); F.place(cfg.p[0],cfg.p[1],cfg.p[2],cfg.yaw);
  F.step(30); F.begin({auto: cfg.auto}); return true; }"""

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
        dumps = {}
        for f in range(0, 50):
            pg.evaluate("() => window.__FEEL.step(1)")
            if f in (32, 36, 40, 44, 48):
                dumps[f] = pg.evaluate(SWEEP_JS)
        br.close()
    for f, d in dumps.items():
        print("\n=== frame %d  state=%s hero=%s focus=%s yaw=%.3f dist=%.3f pitchAim=%.3f pSlide=%.3f"
              % (f, d["st"], d["hero"], d["focus"], d["yaw"], d["dist"], d["pitchAim"], d["pSlide"]))
        print("   yaw\pitch " + " ".join("%6.2f" % x for x in d["pitches"]))
        for i, y in enumerate(d["yaws"]):
            print("   %8.2f  " % y + " ".join("%6.2f" % v for v in d["grid"][i]))
    with open(os.path.join(HERE, "_r4_shaftsweep.json"), "w") as fh:
        json.dump(dumps, fh, indent=1)
main()
