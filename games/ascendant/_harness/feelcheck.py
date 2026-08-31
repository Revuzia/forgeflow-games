#!/usr/bin/env python
"""ASCENDANT feel check — measures the movement contract objectively.

Drives the game through REAL keyboard events (see feedback_verify_real_input_paths:
poking internal state proves nothing about the path the player actually uses) on a
flat synthetic test slab, and measures:

  apex_full     full-hold jump height           expect 2.09 m  (+/- 0.18)
  apex_tap      60 ms tap jump height           expect 0.75-1.25 m, and < apex_full
  airtime       ground-to-ground flight time    expect 0.615 s (+/- 0.06)
  run_speed     steady speed holding W          expect 8.6 m/s (+/- 0.4)
  sprint_speed  steady speed holding W+Shift    expect 12.2 m/s (+/- 0.5)
  gap_run       horizontal distance of a run-speed jump   expect 5.29 m (+/- 0.5)
  stop_time     full speed -> rest on release   expect < 0.15 s
  coyote        max post-ledge delay that still jumps     expect 0.11 s (+/- 0.03)
  buffer        max pre-landing press that still jumps    expect 0.13 s (+/- 0.03)
  respawn_ms    death -> control restored       expect <= 620 ms

    python feelcheck.py
    python feelcheck.py --json out.json
"""
import argparse
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_URL = "http://localhost:8788/games/ascendant/index.html?dev=1"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]

# One self-contained in-page routine. Everything is driven by real KeyboardEvents.
MEASURE_JS = r"""
async () => {
  const A = globalThis.ASCENDANT;
  if (!A || !A.game || !A.game.player) return {error:'no ASCENDANT.game.player'};
  const G = A.game;
  // P must be LIVE: loadStage REPLACES game.player, and this routine can start
  // while the click's stage load is still in flight - a captured const P then
  // drives an orphaned player the game no longer updates (the source of the
  // apex=0 / stop_time=0.9 / gap=13.76 ghost measurements).
  let P = G.player;
  const syncP = () => { if (G.player && G.player !== P) P = G.player; return P; };
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const wait = async (ms) => { const t0 = performance.now();
                               while (performance.now() - t0 < ms) await frame(); };
  const key = (type, code) => {
    // ONE dispatch, to window. Re-dispatching the same object at document made
    // the input see a duplicate keydown; with the down-latch that was survivable,
    // but re-dispatch semantics differ per event state and are the last
    // structural difference from the probes where jumping demonstrably works.
    window.dispatchEvent(new KeyboardEvent(type, {code, key: code === 'Space' ? ' ' : code.replace('Key','').toLowerCase(), bubbles:true, cancelable:true}));
  };
  const down = c => key('keydown', c), up = c => key('keyup', c);
  const allUp = () => ['KeyW','KeyA','KeyS','KeyD','Space','ShiftLeft','ControlLeft']
                        .forEach(up);
  const spd = () => Math.hypot(P.vel.x, P.vel.z);
  const out = {};

  // ---- a flat, empty test slab far from the level so nothing interferes ----
  const TEST = {x: 0, y: 400, z: 600};
  // ASCENDANT does not publish THREE; borrow Vector3 off a live vector.
  const THREE = A.THREE || { Vector3: (A.game && A.game.player && A.game.player.pos
                                       ? A.game.player.pos.constructor : null) };
  let slab = null;
  if (A.engine && THREE && A.Collider) {
    const g = new THREE.BoxGeometry(120, 2, 24);
    const m = new THREE.MeshBasicMaterial({color:0x223344});
    slab = new THREE.Mesh(g, m);
    slab.position.set(TEST.x + 40, TEST.y - 1, TEST.z);
    A.engine.scene.add(slab);
    const c = new A.Collider({
      center: new THREE.Vector3(TEST.x + 40, TEST.y - 1, TEST.z),
      half:   new THREE.Vector3(60, 1, 12),
      surface:'normal'});
    if (typeof c.update === 'function') c.update();   // compute the AABB before hashing
    G.stage.broadphase.add(c);
    if (typeof G.stage.broadphase.refresh === 'function') G.stage.broadphase.refresh(c);
    out._slab = true;
    out._slabAabb = c.aabb ? [c.aabb.min.y, c.aabb.max.y] : null;
  } else {
    out._slab = false;   // fall back to wherever the player already stands
  }

  const reset = async (x) => {
    syncP();
    allUp();
    P.__test.teleport(new THREE.Vector3(x === undefined ? TEST.x : x, TEST.y + 0.4, TEST.z));
    P.__test.setVel(new THREE.Vector3(0,0,0));
    P.yaw = 0;                       // face +X (stages run along +X)
    await wait(420);                 // settle onto the slab
    return P.grounded;
  };

  // ---------- 1. full-hold apex + airtime ----------
  out.grounded_after_reset = await reset();
  let y0 = P.pos.y, peak = -1e9, t0 = performance.now(), tLeave = 0, tLand = 0;
  down('Space');
  while (performance.now() - t0 < 1400) {
    await frame();
    peak = Math.max(peak, P.pos.y);
    if (!P.grounded && !tLeave) tLeave = performance.now();
    if (tLeave && P.grounded && performance.now() - tLeave > 60) { tLand = performance.now(); break; }
  }
  up('Space');
  out.apex_full = +(peak - y0).toFixed(3);
  out.airtime   = tLand ? +((tLand - tLeave)/1000).toFixed(3) : null;
  await wait(300);

  // ---------- 2. tap apex (variable jump height) ----------
  await reset();
  y0 = P.pos.y; peak = -1e9; t0 = performance.now(); tLeave = 0;
  down('Space'); await wait(60); up('Space');
  while (performance.now() - t0 < 1200) {
    await frame(); peak = Math.max(peak, P.pos.y);
    if (!P.grounded && !tLeave) tLeave = performance.now();
    if (tLeave && P.grounded && performance.now() - tLeave > 60) break;
  }
  out.apex_tap = +(peak - y0).toFixed(3);
  await wait(250);

  // ---------- 3. run + sprint steady speed ----------
  await reset(-40);
  down('KeyW'); await wait(1100);
  let s = []; for (let i=0;i<20;i++){ await frame(); s.push(spd()); }
  out.run_speed = +(s.reduce((a,b)=>a+b,0)/s.length).toFixed(2);
  down('ShiftLeft'); await wait(1100);
  s = []; for (let i=0;i<20;i++){ await frame(); s.push(spd()); }
  out.sprint_speed = +(s.reduce((a,b)=>a+b,0)/s.length).toFixed(2);
  up('ShiftLeft');

  // ---------- 4. stop time ----------
  await wait(500);            // back down to run speed
  allUp();
  t0 = performance.now();
  while (performance.now() - t0 < 900) { await frame(); if (spd() < 0.2) break; }
  out.stop_time = +((performance.now() - t0)/1000).toFixed(3);

  // ---------- 5. flat gap at run speed ----------
  await reset(-40);
  down('KeyW'); await wait(1200);          // reach steady run speed
  const px = P.pos.x, pz = P.pos.z;
  down('Space');
  tLeave = 0; t0 = performance.now();
  let xAtLeave = px, zAtLeave = pz;
  while (performance.now() - t0 < 1600) {
    await frame();
    if (!P.grounded && !tLeave) { tLeave = performance.now(); xAtLeave = P.pos.x; zAtLeave = P.pos.z; }
    if (tLeave && P.grounded && performance.now() - tLeave > 60) break;
  }
  out.gap_run = tLeave ? +Math.hypot(P.pos.x - xAtLeave, P.pos.z - zAtLeave).toFixed(2) : null;
  allUp(); await wait(400);

  // ---------- 6. coyote time ----------
  // Walk off the slab's +X end and press jump after a delay; binary-search the
  // largest delay that still produces a jump.
  const tryCoyote = async (delayMs) => {
    await reset(52);                       // near the +X edge (slab spans -20..100)
    down('KeyW'); await wait(1000);
    // wait until ungrounded (walked off), then delay, then jump
    let t = performance.now();
    while (P.grounded && performance.now() - t < 2500) await frame();
    const yOff = P.pos.y, vyOff = P.vel.y;
    await wait(delayMs);
    const vyBefore = P.vel.y;
    down('Space'); await wait(50); up('Space');
    const jumped = P.vel.y > vyBefore + 3.0;
    allUp(); await wait(150);
    return jumped;
  };
  let lo = 0, hi = 320, best = 0;
  for (let i = 0; i < 6; i++) {
    const mid = Math.round((lo + hi) / 2);
    if (await tryCoyote(mid)) { best = mid; lo = mid; } else { hi = mid; }
  }
  out.coyote = +(best/1000).toFixed(3);

  // ---------- 7. jump buffer ----------
  // Jump, then press again N ms before landing; a buffered press produces a second
  // jump the instant we touch down.
  const tryBuffer = async (leadMs) => {
    await reset();
    down('Space'); await wait(120); up('Space');
    // wait until close to landing: predict by falling velocity
    let t = performance.now();
    while (performance.now() - t < 1500) {
      await frame();
      if (P.vel.y < 0) {
        // time to ground ~= (pos.y - slabTop) / |vy|
        const dy = P.pos.y - (TEST.y);
        const tt = dy / Math.max(0.001, -P.vel.y) * 1000;
        if (tt <= leadMs) break;
      }
    }
    down('Space');
    let jumped = false;
    t = performance.now();
    while (performance.now() - t < 500) {
      await frame();
      if (P.grounded === false && P.vel.y > 4) { jumped = true; break; }
      if (P.grounded && P.vel.y > 4) { jumped = true; break; }
    }
    up('Space'); allUp(); await wait(200);
    return jumped;
  };
  lo = 0; hi = 340; best = 0;
  for (let i = 0; i < 6; i++) {
    const mid = Math.round((lo + hi) / 2);
    if (await tryBuffer(mid)) { best = mid; lo = mid; } else { hi = mid; }
  }
  out.buffer = +(best/1000).toFixed(3);

  // ---------- 8. death -> respawn ----------
  await reset();
  const tDeath = performance.now();
  P.kill('manual');
  let tBack = null;
  const dl = performance.now() + 4000;
  while (performance.now() < dl) {
    await frame();
    if (!P.dead && (!G.input || !G.input.suspended)) { tBack = performance.now(); break; }
  }
  out.respawn_ms = tBack ? Math.round(tBack - tDeath) : null;

  if (slab) { A.engine.scene.remove(slab); slab.geometry.dispose(); slab.material.dispose(); }
  allUp();
  return out;
}
"""

EXPECT = [
    ("apex_full",    2.09,  0.18,  "m"),
    ("apex_tap",     1.00,  0.28,  "m"),
    ("airtime",      0.615, 0.070, "s"),
    ("run_speed",    8.60,  0.45,  "m/s"),
    ("sprint_speed", 12.20, 0.55,  "m/s"),
    ("gap_run",      5.29,  0.60,  "m"),
    ("coyote",       0.110, 0.035, "s"),
    ("buffer",       0.130, 0.040, "s"),
]



CLICK_JS = r"""() => {
  const btns = Array.from(document.querySelectorAll('button.asc-btn'));
  for (const want of ['NEW RUN', 'PLAY', 'CONTINUE']) {
    for (const b of btns) {
      const r = b.getBoundingClientRect();
      if (b.disabled || r.width < 4) continue;
      if ((b.textContent || '').toUpperCase().indexOf(want) < 0) continue;
      if (b.__activate) b.__activate(); else b.click();
      return want;
    }
  }
  return null;
}"""


def click_play(pg, timeout=25):
    """Click the title's PLAY/NEW RUN and WAIT until the state actually leaves
    'title'. The title lays out asynchronously (webfont + stage numbering), so a
    single click at a fixed delay can fire before the button exists and the game
    silently stays on the title - where input.suspended gates jump but not
    movement, which made feelcheck report a passing game as 8 failures."""
    import time as _t
    deadline = _t.time() + timeout
    while _t.time() < deadline:
        try:
            st = pg.evaluate("globalThis.ASCENDANT && ASCENDANT.game && ASCENDANT.game.state")
        except Exception:
            st = None
        if st and st != "title":
            return True
        try:
            pg.evaluate(CLICK_JS)
        except Exception:
            pass
        pg.wait_for_timeout(400)
    return False

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--json", default=os.path.join(HERE, "feelcheck.json"))
    ap.add_argument("--wait", type=float, default=60.0)
    args = ap.parse_args()

    errors = []
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1100, "height": 700})
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(args.url, wait_until="load", timeout=60_000)

        deadline = time.time() + args.wait
        while time.time() < deadline:
            if pg.evaluate("!!(globalThis.ASCENDANT && ASCENDANT.game)"):
                break
            pg.wait_for_timeout(400)

        # Retry the click until the state actually leaves the title: on the title
        # the world simulates and W moves, but input.suspended gates jump - the
        # exact fingerprint of the fabricated 8-failure verdicts.
        if not click_play(pg):
            print("FEEL CHECK: never left the title screen", file=sys.stderr)
            br.close()
            return 2
        deadline = time.time() + 40
        while time.time() < deadline:
            try:
                if pg.evaluate("!!(ASCENDANT.game.player && ASCENDANT.game.stage && ASCENDANT.game.player.__test)"):
                    break
            except Exception:
                pass
            pg.wait_for_timeout(400)
        pg.wait_for_timeout(1200)

        try:
            res = pg.evaluate(MEASURE_JS)
        except Exception as e:
            res = {"error": str(e)}
        br.close()

    print(json.dumps(res, indent=2))
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(res, f, indent=2)

    if "error" in res:
        print("FEEL CHECK FAILED: %s" % res["error"])
        return 2

    print("-" * 66)
    fails = 0
    for name, want, tol, unit in EXPECT:
        got = res.get(name)
        if got is None:
            print("  %-13s MISSING" % name)
            fails += 1
            continue
        ok = abs(got - want) <= tol
        fails += 0 if ok else 1
        print("  %-13s %8.3f %-4s  want %.3f +/- %.3f   %s"
              % (name, got, unit, want, tol, "OK" if ok else "FAIL"))
    st = res.get("stop_time")
    if st is None or st > 0.15:
        print("  %-13s %s  want < 0.150 s   FAIL" % ("stop_time", st))
        fails += 1
    else:
        print("  %-13s %8.3f s     want < 0.150 s   OK" % ("stop_time", st))
    rs = res.get("respawn_ms")
    if rs is None or rs > 620:
        print("  %-13s %s  want <= 620 ms   FAIL" % ("respawn_ms", rs))
        fails += 1
    else:
        print("  %-13s %8d ms    want <= 620 ms   OK" % ("respawn_ms", rs))
    if res.get("apex_tap") is not None and res.get("apex_full") is not None:
        vh = res["apex_tap"] < res["apex_full"] - 0.4
        print("  variable jump  %s (tap %.2f < full %.2f - 0.4)"
              % ("OK" if vh else "FAIL", res["apex_tap"], res["apex_full"]))
        fails += 0 if vh else 1
    print("-" * 66)
    if errors:
        print("page errors during run:")
        for e in errors[:10]:
            print("  !! %s" % e[:300])
    print("VERDICT: %s (%d failing)" % ("FEEL OK" if fails == 0 else "FEEL FAILS", fails))
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
