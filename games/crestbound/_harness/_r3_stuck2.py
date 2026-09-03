"""R3 feel lane: the three states the no-input sweep flagged, re-tested WITH the
exit button. controller.js line 1275 exits `climb` on jump (_doClimbKick) and
line 104 fires `cannon` on jump, so a sweep that only pushes the stick cannot
tell a soft-lock from an unpressed button. This presses jump.
"""
import json, os, sys, time
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from feelshots import DRIVER_JS, launch, leave_title, DEFAULT_URL, HERE, MEADOW

TRY_JS = r"""
(cfg) => {
  const F = window.__FEEL, G = CRESTBOUND.game, p = G.player;
  F.begin({});
  F.place(cfg.p[0], cfg.p[1] + (cfg.air || 0), cfg.p[2], cfg.yaw);
  F.step(20);
  F.begin({});
  p.__test.force(cfg.state);
  const took = p.state;
  F.step(60);
  const before = p.state;
  F.press('Space'); F.step(8); F.release('Space'); F.step(150);
  const after = {st: p.state, g: p.grounded ? 1 : 0, sp: +Math.hypot(p.vel.x, p.vel.z).toFixed(2)};
  F.allUp();
  return {took: took, before_jump: before, after_jump: after,
          seen: F.samples.map(s => s.st).filter((v, i, a) => v !== a[i-1])};
}
"""

def main():
    with sync_playwright() as p:
        br = launch(p, headless=True)
        pg = br.new_page(viewport={"width": 900, "height": 520})
        pg.goto(DEFAULT_URL, wait_until="load", timeout=90_000)
        t = time.time() + 120
        while time.time() < t:
            if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game)"): break
            pg.wait_for_timeout(400)
        leave_title(pg)
        pg.evaluate("async (id) => { await CRESTBOUND.game.__dev.goto(id); }", "verdant-1")
        leave_title(pg, 60); pg.wait_for_timeout(1500)
        assert pg.evaluate(DRIVER_JS) == "ok"
        out = {}
        for st, air in (("climb", 0), ("cannon", 0), ("poundHang", 6.0)):
            r = pg.evaluate(TRY_JS, dict(MEADOW, state=st, air=air))
            out[st] = r
            print("\nforced %-10s (spawned %+.1f m up)" % (st, air))
            print("   1 s later          : %s" % r["before_jump"])
            print("   after a JUMP press : %s" % r["after_jump"])
            print("   states traversed   : %s" % " -> ".join(r["seen"]))
        br.close()
    with open(os.path.join(HERE, "_r3_stuck2.json"), "w") as fh:
        json.dump(out, fh, indent=1)

main()
