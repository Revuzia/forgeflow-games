#!/usr/bin/env python
"""Feel lane round-2, probe B done properly: is the wall kick available for as
long as the hero is ON the wall, or only inside wallKick.window after contact?

The first attempt was confounded: the fort shaft is short, so the hero reached
the floor mid-slide and the 'jump' that fired was an ordinary grounded jump1.
This version asserts the state ON THE PRESS FRAME and only counts a press made
while state === 'wallslide'."""
import json, math, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import feelshots as FS
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
SHAFT = FS.SHAFT

PROBE_JS = r"""
(a) => {
  const F = window.__FEEL, G = CRESTBOUND.game, P = G.player;
  F.begin({});
  // start HIGH in the shaft so there is real slide room below the hero
  F.place(-9.2, a.y, -32.8, 0);
  P.__test.setVel({x: 0, y: 0, z: 0});
  F.step(2);
  F.begin({});
  F.setStick(0, -1, 1);          // lean into the north wall
  // fall/drift until the hero is actually wall-sliding
  let contact = -1;
  for (let k = 0; k < 240; k++) {
    F.step(1);
    const s = F.samples[F.samples.length - 1];
    if (s.st === 'wallslide') { contact = F.i; break; }
  }
  if (contact < 0) return {err: 'never reached wallslide', last: F.samples[F.samples.length-1]};
  F.step(a.delay);
  const pre = F.samples[F.samples.length - 1];
  F.press('Space');
  F.step(8);
  F.release('Space');
  F.step(10);
  const post = F.samples.slice(-18);
  return {
    contact_frame: contact,
    delay: a.delay,
    press_state: pre.st, press_y: pre.y, press_vy: pre.vy, press_grounded: pre.g,
    press_wn: pre.wn,
    after_states: Array.from(new Set(post.map((k) => k.st))),
    kicked: post.some((k) => k.st === 'wallkick'),
    peak_vy: Math.max.apply(null, post.map((k) => k.vy)),
    gain: +(Math.max.apply(null, post.map((k) => k.y)) - pre.y).toFixed(3),
  };
}"""

# A LADDER test: from high in the shaft, kick every time the hero is on a wall
# and falling, for as long as it lasts -- how much height does a real ladder gain?
LADDER_JS = r"""
(a) => {
  const F = window.__FEEL, P = CRESTBOUND.game.player;
  F.begin({});
  F.place(a.x, a.y, a.z, 0);
  P.__test.setVel({x: 0, y: 0, z: 0});
  F.step(2);
  F.begin({});
  const T = CRESTBOUND.TUNE || (CRESTBOUND.game.TUNE) || null;
  const minFall = -1.0;
  let side = 1, lastKick = -99, kicks = [];
  F.setStick(0, -1, 1);
  let held = -1;
  for (let i = 0; i < 400; i++) {
    if (held >= 0 && F.i >= held) { F.release('Space'); held = -1; }
    const p = P;
    const onWall = !p.grounded && (p.state === 'wallslide' ||
      (Math.hypot(p.wallN.x, p.wallN.z) > 0.5 && Math.abs(p.wallN.y) < 0.4));
    if (held < 0 && onWall && p.vel.y <= minFall && F.i - lastKick > 8) {
      const y0 = p.pos.y;
      F.press('Space'); held = F.i + 5; lastKick = F.i;
      side = -side;
      F.setStick(0, side < 0 ? 1 : -1, 1);
      kicks.push({frame: F.i, y: +y0.toFixed(2)});
    }
    F.step(1);
    if (P.grounded && i > 20) break;
  }
  const ys = F.samples.map((k) => k.y);
  return {kicks: kicks, n: kicks.length,
          y_start: +ys[0].toFixed(2), y_top: +Math.max.apply(null, ys).toFixed(2),
          climb: +(Math.max.apply(null, ys) - ys[0]).toFixed(2),
          states: Array.from(new Set(F.samples.map((k) => k.st))),
          ceiling_hits: F.samples.filter((k, i, A) =>
            i > 0 && A[i-1].vy > 2 && k.vy < 0.2 && !k.g).length};
}"""

OUT = {}
with sync_playwright() as p:
    b = FS.launch(p, True)
    pg = b.new_page(viewport={"width": 1200, "height": 675})
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

    print("=" * 96)
    print("B2. WALL KICK vs TIME ON THE WALL (press asserted to happen while state == wallslide)")
    print("=" * 96)
    print("  delay  press-state  press-y  press-vy  ->  kicked  after-states                 gain")
    for delay in (0, 2, 5, 8, 12, 20, 30):
        r = pg.evaluate(PROBE_JS, {"y": 12.30, "delay": delay})
        OUT["late_%d" % delay] = r
        if "err" in r:
            print("   %2d     %s" % (delay, r["err"]))
            continue
        print("   %2d f   %-11s %7.2f %9.2f  ->  %-6s  %-28s %+.2f m"
              % (delay, r["press_state"], r["press_y"], r["press_vy"],
                 "KICK" if r["kicked"] else "no", ",".join(r["after_states"]), r["gain"]))

    print()
    print("=" * 96)
    print("B3. WALL-KICK LADDER: kick every time the hero is on a wall and falling")
    print("=" * 96)
    for name, xyz in (("fort west shaft (floor)", (-9.2, 9.40, -32.8)),
                      ("fort west shaft (mid)", (-9.2, 11.50, -32.8))):
        r = pg.evaluate(LADDER_JS, {"x": xyz[0], "y": xyz[1], "z": xyz[2]})
        OUT["ladder_%s" % name] = r
        print("   %-26s kicks %d at y %s -> climbed %.2f m (top %.2f)  states %s"
              % (name, r["n"], [k["y"] for k in r["kicks"]], r["climb"], r["y_top"],
                 ",".join(r["states"])))

    print()
    print("=" * 96)
    print("B4. SHAFT HEADROOM: how tall is the authored wall-kick shaft?")
    print("=" * 96)
    head = pg.evaluate(r"""() => {
      const bp = CRESTBOUND.game.course.broadphase, THREE = CRESTBOUND.THREE;
      const o = new THREE.Vector3(-9.2, 9.6, -32.8), d = new THREE.Vector3(0, 1, 0);
      const hit = {t: 0, normal: new THREE.Vector3(), collider: null};
      const up = bp.raycast(o, d, 60, hit) ? hit.t : null;
      const o2 = new THREE.Vector3(-9.2, 9.6, -32.8), d2 = new THREE.Vector3(0, 0, -1);
      const n = bp.raycast(o2, d2, 30, hit) ? hit.t : null;
      const d3 = new THREE.Vector3(0, 0, 1);
      const s = bp.raycast(o2, d3, 30, hit) ? hit.t : null;
      return {ceiling_above_floor: up, north_wall: n, south_wall: s};
    }""")
    OUT["headroom"] = head
    print("   ceiling is %.2f m above the shaft floor; shaft is %.2f m front-to-back"
          % (head["ceiling_above_floor"], (head["north_wall"] or 0) + (head["south_wall"] or 0)))
    print("   one kick gains ~2.08 m measured -> %.1f kicks fit before the ceiling"
          % (head["ceiling_above_floor"] / 2.08))

    try:
        pg.evaluate("() => { const E = CRESTBOUND.engine, G = CRESTBOUND.game;"
                    " if (E && !E.running) E.start((dt) => G.update(dt)); }")
    except Exception:
        pass
    b.close()

json.dump(OUT, open(os.path.join(HERE, "_feelarc3.json"), "w"), indent=1, default=str)
print("\nwrote _harness/_feelarc3.json")
if errs:
    print("PAGE ERRORS:", errs[:5])
