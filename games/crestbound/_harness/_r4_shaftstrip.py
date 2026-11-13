"""R4: LOOK at the wall-kick ladder with the shaft tier in. One PNG per sampled
frame of the ladder, so the over-the-head framing is judged by eye and not only
by the distance numbers."""
import os, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feelshots import DRIVER_JS, launch, leave_title, DEFAULT_URL, HERE, ROOT, SHAFT

OUT = os.path.join(ROOT, "_shots", "feel_r4")
RUN_JS = r"""(cfg) => { const F = window.__FEEL; F.begin({}); F.place(cfg.p[0],cfg.p[1],cfg.p[2],cfg.yaw);
  F.step(30); F.begin({auto: cfg.auto}); return true; }"""
INFO_JS = r"""() => { const G = CRESTBOUND.game, s = G.cam.__test.state();
  return [G.player.state, +G.player.pos.y.toFixed(2), +s.dist.toFixed(2), +s.pitch.toFixed(2),
          +s.pitchSlide.toFixed(2), +s.heroFade.toFixed(2)]; }"""

def main():
    os.makedirs(OUT, exist_ok=True)
    want = set([0, 12, 24, 30, 34, 38, 42, 46, 50, 56, 64, 72, 90, 110, 130])
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
        for f in range(140):
            pg.evaluate("() => window.__FEEL.step(1)")
            if f in want:
                info = pg.evaluate(INFO_JS)
                pg.screenshot(path=os.path.join(OUT, "kick_%03d.png" % f))
                print("f%03d %-10s y%5.2f dist %5.2f pitch %5.2f pSlide %5.2f fade %4.2f"
                      % (f, info[0], info[1], info[2], info[3], info[4], info[5]))
        br.close()
    print("wrote", OUT)
main()
