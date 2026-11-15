#!/usr/bin/env python
"""Feel lane round-2: the ANALOG curve. Speed and turn rate as CONTINUOUS
functions of stick magnitude -- the one claim that separates an analog 3D
platformer from a two-speed one. feelcheck samples only 0.40 and 1.00."""
import json, math, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import feelshots as FS
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
OPEN = dict(p=[-58.0, 2.20, 66.0], yaw=0.0)

SWEEP_JS = r"""
(mags) => {
  const F = window.__FEEL, P = CRESTBOUND.game.player;
  const out = [];
  for (const m of mags) {
    F.begin({});
    F.place(-58.0, 2.20, 66.0, 0);
    P.__test.setVel({x: 0, y: 0, z: 0});
    F.step(20);
    F.begin({});
    F.setStick(0, -1, m);
    F.step(60);                       // long enough to reach terminal ground speed
    const sp = Math.hypot(P.vel.x, P.vel.z);
    const st = P.state, anim = P.anim;
    // now turn hard left and measure the sustained yaw rate at THAT speed
    const f0 = P.facing;
    F.setStick(-1, 0, m);
    F.step(6);
    const fa = P.facing;
    F.step(6);
    const fb = P.facing;
    const wrap = (a) => { while (a > Math.PI) a -= 2*Math.PI; while (a < -Math.PI) a += 2*Math.PI; return a; };
    const w = Math.abs(wrap(fb - fa)) * 10;   // rad/s over 6 frames
    out.push({mag: m, speed: +sp.toFixed(3), state: st, anim: anim,
              yaw_rate: +w.toFixed(3),
              radius: w > 0.05 ? +(sp / w).toFixed(3) : null});
  }
  return out;
}"""

with sync_playwright() as p:
    b = FS.launch(p, True)
    pg = b.new_page(viewport={"width": 900, "height": 520})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(FS.DEFAULT_URL, wait_until="load", timeout=90_000)
    dl = time.time() + 150
    while time.time() < dl:
        try:
            if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game)"):
                break
        except Exception:
            pass
        pg.wait_for_timeout(400)
    FS.leave_title(pg)
    pg.evaluate("async (id) => { await CRESTBOUND.game.__dev.goto(id); }", "verdant-1")
    FS.leave_title(pg, timeout=60)
    pg.wait_for_timeout(1500)
    assert pg.evaluate(FS.DRIVER_JS) == "ok"

    mags = [0.10, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95, 1.00]
    rows = pg.evaluate(SWEEP_JS, mags)
    print("=" * 84)
    print("ANALOG CURVE — sustained ground speed and turn rate vs stick magnitude")
    print("=" * 84)
    print("  stick   speed m/s   state      yaw rad/s   turn radius m")
    for r in rows:
        print("  %4.2f    %8.3f   %-9s  %8.3f   %s"
              % (r["mag"], r["speed"], r["state"], r["yaw_rate"],
                 ("%.2f" % r["radius"]) if r["radius"] else "-"))
    sp = [r["speed"] for r in rows]
    steps = [round(sp[i] - sp[i - 1], 3) for i in range(1, len(sp))]
    print("\n  speed increments between adjacent magnitudes: %s" % steps)
    distinct = len(set(round(v, 2) for v in sp))
    print("  distinct sustained speeds over 11 magnitudes: %d" % distinct)
    json.dump(rows, open(os.path.join(HERE, "_feelarc4.json"), "w"), indent=1)
    try:
        pg.evaluate("() => { const E = CRESTBOUND.engine, G = CRESTBOUND.game;"
                    " if (E && !E.running) E.start((dt) => G.update(dt)); }")
    except Exception:
        pass
    b.close()
if errs:
    print("PAGE ERRORS:", errs[:5])
