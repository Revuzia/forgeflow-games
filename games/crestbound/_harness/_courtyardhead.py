#!/usr/bin/env python
"""Secondary consequence of the fort lid: EVERY jump inside the courtyard was
height-capped at 14.40. Up-rays from head height over the courtyard fixtures,
plus a real triple jump off the crate stack (top 12.60) to prove the cap is gone."""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import feelshots as FS
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
PTS = [
    ("crate stack top",      [-5.5, 12.70, -17.2]),
    ("courtyard pedestal",   [0.0, 10.20, -24.0]),
    ("gateway, inside",      [0.0, 9.50, -14.0]),
    ("courtyard, north half", [0.0, 9.50, -30.0]),
    ("shaft floor",          [-9.2, 9.50, -32.8]),
    ("rampart walk, east",   [10.0, 14.60, -26.0]),
    ("rampart walk, north",  [-6.6, 14.60, -34.6]),
]
RAY = r"""
(p) => {
  const bp = CRESTBOUND.game.course.broadphase, THREE = CRESTBOUND.THREE;
  const hit = {t: 0, normal: new THREE.Vector3(), collider: null};
  const ok = bp.raycast(new THREE.Vector3(p[0], p[1], p[2]), new THREE.Vector3(0, 1, 0), 80, hit);
  return ok ? +(p[1] + hit.t).toFixed(2) : null;
}"""
JUMP = r"""
(a) => {
  const F = window.__FEEL, P = CRESTBOUND.game.player;
  F.begin({}); F.place(a.x, a.y, a.z, 0); P.__test.setVel({x:0,y:0,z:0}); F.step(4);
  F.begin({});
  // ONE full-height jump: the press is held past the cut window and the hero is
  // followed all the way back to the ground, so the apex is the real 1.91 m and
  // not a jump cut short by the driver.
  F.press('Space'); F.step(24); F.release('Space'); F.step(60);
  const ys = F.samples.map((k) => k.y);
  return {y0: +ys[0].toFixed(2), y_top: +Math.max.apply(null, ys).toFixed(2),
          apex: +(Math.max.apply(null, ys) - ys[0]).toFixed(2),
          states: Array.from(new Set(F.samples.map((k) => k.st)))};
}"""
with sync_playwright() as p:
    b = FS.launch(p, True)
    pg = b.new_page(viewport={"width": 900, "height": 520})
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
    print("UP-RAYS inside the fort (was: everything capped at 14.40)")
    out = {}
    for name, pt in PTS:
        y = pg.evaluate(RAY, pt)
        out[name] = y
        print("   %-24s from y %5.2f -> %s" % (name, pt[1], ("ceiling %.2f" % y) if y is not None else "OPEN SKY"))
    print()
    r = pg.evaluate(JUMP, {"x": -5.5, "y": 12.75, "z": -17.2})
    out["triple_off_crates"] = r
    print("SINGLE JUMP off the crate stack (top 12.60): %.2f -> %.2f, apex %.2f m, states %s"
          % (r["y0"], r["y_top"], r["apex"], ",".join(r["states"])))
    b.close()
json.dump(out, open(os.path.join(HERE, "_courtyardhead.json"), "w"), indent=1)
