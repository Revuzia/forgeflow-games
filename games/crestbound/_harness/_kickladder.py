#!/usr/bin/env python
"""ROUTE B proof: can the verdant-1 west-tower shaft actually be climbed by the
wall-kick ladder the course signs in-world ("KICK ONE WALL, THEN THE OTHER")?

Drives the ladder by hand-stepping game.update(1/60) (never off the wall clock),
alternating the stick into each wall and pressing jump only on a frame where the
hero is genuinely on a wall and falling. Reports the climb, the top reached, the
authored exit-ledge height, and every ceiling bonk (vy killed in one frame while
airborne)."""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import feelshots as FS
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
LEDGE_TOP = 16.60          # verdant-1 SHAFT_TOP: the exit ledge over the courtyard
FLOOR = 9.00               # FORT_Y, the shaft floor

LADDER_JS = r"""
(a) => {
  const F = window.__FEEL, P = CRESTBOUND.game.player;
  F.begin({});
  F.place(a.x, a.y, a.z, 0);
  P.__test.setVel({x: 0, y: 0, z: 0});
  F.step(2);
  F.begin({});
  let side = 1, lastKick = -99, held = -1;
  const kicks = [], bonks = [];
  F.setStick(a.ax ? -1 : 0, a.ax ? 0 : -1, 1);
  // the ladder needs the hero AIRBORNE before a wall kick is legal at all, so
  // the run starts with the ordinary jump the course asks for ("one jump plus
  // four wall kicks"). Without it the loop can never fire and reports 0 kicks.
  F.press('Space'); F.step(6); F.release('Space'); F.step(2);
  let prevVy = 0, prevG = true;
  for (let i = 0; i < a.frames; i++) {
    if (held >= 0 && F.i >= held) { F.release('Space'); held = -1; }
    const onWall = !P.grounded && (P.state === 'wallslide' ||
      (Math.hypot(P.wallN.x, P.wallN.z) > 0.5 && Math.abs(P.wallN.y) < 0.4));
    if (held < 0 && onWall && P.vel.y <= -1.0 && F.i - lastKick > 8) {
      kicks.push({frame: F.i, y: +P.pos.y.toFixed(2)});
      F.press('Space'); held = F.i + 5; lastKick = F.i;
      side = -side;
      if (a.ax) F.setStick(side < 0 ? 1 : -1, 0, 1);
      else F.setStick(0, side < 0 ? 1 : -1, 1);
    }
    F.step(1);
    // a ceiling bonk: rising fast, then vy killed in ONE frame, still airborne
    if (prevVy > 2 && P.vel.y < 0.2 && !P.grounded) {
      bonks.push({frame: F.i, head: +(P.pos.y + 1.5).toFixed(2), vy_before: +prevVy.toFixed(2)});
    }
    prevVy = P.vel.y; prevG = P.grounded;
  }
  const ys = F.samples.map((k) => k.y);
  return {kicks, n: kicks.length, bonks,
          y_start: +ys[0].toFixed(2), y_top: +Math.max.apply(null, ys).toFixed(2),
          climb: +(Math.max.apply(null, ys) - ys[0]).toFixed(2),
          end_y: +ys[ys.length - 1].toFixed(2),
          end_grounded: !!P.grounded,
          states: Array.from(new Set(F.samples.map((k) => k.st)))};
}"""

RAY_JS = r"""
(pts) => {
  const bp = CRESTBOUND.game.course.broadphase, THREE = CRESTBOUND.THREE;
  const hit = {t: 0, normal: new THREE.Vector3(), collider: null};
  const cast = (o, d, len) => bp.raycast(o.clone(), d, len, hit) ? +hit.t.toFixed(2) : null;
  const o = new THREE.Vector3(pts.x, pts.y, pts.z);
  return {
    up:    cast(o, new THREE.Vector3(0, 1, 0), 60),
    north: cast(o, new THREE.Vector3(0, 0, -1), 30),
    south: cast(o, new THREE.Vector3(0, 0, 1), 30),
    west:  cast(o, new THREE.Vector3(-1, 0, 0), 30),
    east:  cast(o, new THREE.Vector3(1, 0, 0), 30),
  };
}"""

OUT = {}
with sync_playwright() as p:
    b = FS.launch(p, True)
    pg = b.new_page(viewport={"width": 1000, "height": 600})
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

    print("=" * 92)
    print("SHAFT GEOMETRY (rays from the shaft centre)")
    print("=" * 92)
    for y in (9.60, 12.00, 15.00):
        r = pg.evaluate(RAY_JS, {"x": -9.2, "y": y, "z": -32.8})
        OUT["ray_%.2f" % y] = r
        span_z = None if r["north"] is None or r["south"] is None else r["north"] + r["south"]
        span_x = None if r["west"] is None or r["east"] is None else r["west"] + r["east"]
        print("   y %5.2f  ceiling %-8s  z-span %-6s  x-span %-6s"
              % (y, ("%.2f" % (y + r["up"])) if r["up"] is not None else "OPEN SKY",
                 ("%.2f" % span_z) if span_z is not None else "-",
                 ("%.2f" % span_x) if span_x is not None else "-"))

    print()
    print("=" * 92)
    print("WALL-KICK LADDER from the shaft floor (exit ledge top %.2f)" % LEDGE_TOP)
    print("=" * 92)
    for name, ax in (("kick along Z (north<->south)", 0), ("kick along X (west<->east)", 1)):
        r = pg.evaluate(LADDER_JS, {"x": -9.2, "y": 9.40, "z": -32.8, "ax": ax, "frames": 400})
        OUT["ladder_%s" % ("x" if ax else "z")] = r
        print("   %-30s %d kicks at y %s" % (name, r["n"], [k["y"] for k in r["kicks"]][:9]))
        print("       climbed %.2f m, top %.2f (feet), head %.2f, bonks %d, reached ledge: %s"
              % (r["climb"], r["y_top"], r["y_top"] + 1.5, len(r["bonks"]),
                 "YES" if r["y_top"] + 0.05 >= LEDGE_TOP - 0.20 else "no"))
        if r["bonks"]:
            print("       bonks: %s" % json.dumps(r["bonks"][:4]))
    try:
        pg.evaluate("() => { const E = CRESTBOUND.engine, G = CRESTBOUND.game;"
                    " if (E && !E.running) E.start((dt) => G.update(dt)); }")
    except Exception:
        pass
    b.close()

json.dump(OUT, open(os.path.join(HERE, "_kickladder.json"), "w"), indent=1, default=str)
print("\nwrote _harness/_kickladder.json")
if errs:
    print("PAGE ERRORS:", errs[:5])
