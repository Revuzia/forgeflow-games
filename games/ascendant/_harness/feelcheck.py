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
  const out = {pre:{}, fail:{}};

  // ---- 0. leave the stage-intro freeze -----------------------------------
  // game.js skips player.update() while G._introT >= 0 (the 1.6 s stage-intro
  // card; the PLAY click that got us here starts one). Measuring during the
  // card measures a FROZEN player - the apex_full = 0.000 defect. A jump press
  // after the card's first 260 ms skips it, so tap Space until it is gone.
  let guard = 0;
  while (G._introT >= 0 && guard++ < 60) {
    down('Space'); await frame(); up('Space');
    await wait(120);
  }
  out.intro_cleared = G._introT < 0;
  out.state = G.state;
  if (!out.intro_cleared) return Object.assign({error:'intro card never ended'}, out);
  if (G.state !== 'hub' && G.state !== 'playing')
    return Object.assign({error:'unexpected game state: ' + G.state}, out);
  await wait(300);                 // let the skip-tap's 0.13 s jump buffer expire
  syncP();

  // ---- a flat, empty test slab far from the level so nothing interferes ----
  // YAW: controller.js:547 - forward = (-sin(yaw), 0, -cos(yaw)), so yaw 0
  // walks toward -Z, NOT +X. yaw = -PI/2 genuinely faces +X, and every ground
  // test travels along +X. The slab spans x in [-70, +70]: the farthest start
  // is reset(-40) (30 m inside the -X edge) and the longest ground track
  // (run 1.1 s + sample + sprint 1.1 s + sample + decay + stop, ~36 m) ends
  // near x = 0, ~70 m short of the +X edge - >= 20 m margin everywhere. Only
  // the coyote test is MEANT to walk off the +X edge.
  const TEST = {x: 0, y: 400, z: 600};
  const FACE_PLUS_X = -Math.PI / 2;
  const GRAV_FALL = 54;            // tuning.js gravFall; terminal (65) is never
                                   // reached in a 2 m hop, so exact ballistics
  const HX = 70, HY = 1, HZ = 12;  // slab top sits at TEST.y exactly
  const THREE = A.THREE, Collider = A.Collider;    // published by boot.js
  if (!THREE || !Collider)
    return Object.assign({error:'ASCENDANT.THREE / ASCENDANT.Collider missing'}, out);

  const col = new Collider({
    center: new THREE.Vector3(TEST.x, TEST.y - HY, TEST.z),
    half:   new THREE.Vector3(HX, HY, HZ),
    surface:'normal'});
  if (typeof col.update === 'function') col.update();   // compute the AABB before hashing
  G.stage.broadphase.add(col);
  if (typeof G.stage.broadphase.refresh === 'function') G.stage.broadphase.refresh(col);
  out._slab = true;
  out._slabAabb = col.aabb ? [col.aabb.min.x, col.aabb.max.x, col.aabb.min.y,
                              col.aabb.max.y, col.aabb.min.z, col.aabb.max.z] : null;
  let slab = null;
  if (A.engine && THREE.BoxGeometry) {
    slab = new THREE.Mesh(new THREE.BoxGeometry(HX * 2, HY * 2, HZ * 2),
                          new THREE.MeshBasicMaterial({color:0x223344}));
    slab.position.set(TEST.x, TEST.y - HY, TEST.z);
    A.engine.scene.add(slab);
  }

  const reset = async (x) => {
    syncP();
    allUp();
    P.__test.teleport(new THREE.Vector3(x === undefined ? TEST.x : x, TEST.y + 0.4, TEST.z));
    P.__test.setVel(new THREE.Vector3(0,0,0));
    P.yaw = FACE_PLUS_X;             // face +X (see the yaw note above)
    P.pitch = 0;
    await wait(420);                 // settle onto the slab
    syncP();
    return P.grounded && !P.dead;
  };

  // Every measurement starts from a PROVEN grounded stand on the slab. A test
  // whose precondition fails reports FAIL with the reason - never a number.
  const ground = async (names, x) => {
    const ok = await reset(x);
    const info = {grounded: !!P.grounded, dead: !!P.dead,
                  x: +P.pos.x.toFixed(2), y: +P.pos.y.toFixed(2), z: +P.pos.z.toFixed(2)};
    for (const n of names) out.pre[n] = info;
    if (!ok) for (const n of names) {
      out[n] = null;
      out.fail[n] = 'precondition failed: not grounded at ('
                    + info.x + ', ' + info.y + ', ' + info.z + ')'
                    + (info.dead ? ' [dead]' : '');
    }
    return ok;
  };

  // ---------- 1. full-hold apex + airtime ----------
  out.grounded_after_reset = await ground(['apex_full', 'airtime']);
  if (out.grounded_after_reset) {
    const y0 = P.pos.y;
    let peak = -1e9, t0 = performance.now(), tLeave = 0, tLand = 0;
    down('Space');
    while (performance.now() - t0 < 1400) {
      await frame();
      peak = Math.max(peak, P.pos.y);
      if (!P.grounded && !tLeave) tLeave = performance.now();
      if (tLeave && P.grounded && performance.now() - tLeave > 60) { tLand = performance.now(); break; }
    }
    up('Space');
    out.apex_full = +(peak - y0).toFixed(3);
    if (tLand) out.airtime = +((tLand - tLeave)/1000).toFixed(3);
    else { out.airtime = null; out.fail.airtime = 'never landed within 1.4 s'; }
    await wait(300);
  }

  // ---------- 2. tap apex (variable jump height) ----------
  if (await ground(['apex_tap'])) {
    const y0 = P.pos.y;
    let peak = -1e9, t0 = performance.now(), tLeave = 0;
    down('Space'); await wait(60); up('Space');
    while (performance.now() - t0 < 1200) {
      await frame(); peak = Math.max(peak, P.pos.y);
      if (!P.grounded && !tLeave) tLeave = performance.now();
      if (tLeave && P.grounded && performance.now() - tLeave > 60) break;
    }
    out.apex_tap = +(peak - y0).toFixed(3);
    await wait(250);
  }

  // ---------- 3. run + sprint steady speed ----------
  if (await ground(['run_speed', 'sprint_speed', 'stop_time'], -40)) {
    down('KeyW'); await wait(1100);
    let s = []; for (let i=0;i<20;i++){ await frame(); s.push(spd()); }
    if (P.grounded) out.run_speed = +(s.reduce((a,b)=>a+b,0)/s.length).toFixed(2);
    else { out.run_speed = null;
           out.fail.run_speed = 'left the ground during the sample (x=' + P.pos.x.toFixed(1) + ')'; }
    down('ShiftLeft'); await wait(1100);
    s = []; for (let i=0;i<20;i++){ await frame(); s.push(spd()); }
    if (P.grounded) out.sprint_speed = +(s.reduce((a,b)=>a+b,0)/s.length).toFixed(2);
    else { out.sprint_speed = null;
           out.fail.sprint_speed = 'left the ground during the sample (x=' + P.pos.x.toFixed(1) + ')'; }
    up('ShiftLeft');

    // ---------- 4. stop time ----------
    await wait(500);            // back down to run speed
    if (!P.grounded) {
      out.stop_time = null;
      out.fail.stop_time = 'not grounded at release (x=' + P.pos.x.toFixed(1) + ')';
    } else {
      allUp();
      // Timed from the frame the release REGISTERS in the sim (P.wishLen
      // drops to 0), not from the dispatch - timing from the dispatch bills
      // the harness's own event latency to the game.
      const t0 = performance.now();
      let tReg = 0, stopped = false;
      while (performance.now() - t0 < 900) {
        await frame();
        if (!tReg && P.wishLen === 0) tReg = performance.now();
        if (tReg && spd() < 0.2) { stopped = true; break; }
      }
      if (!tReg) { out.stop_time = null; out.fail.stop_time = 'key release never registered'; }
      else {
        out.stop_time = +((performance.now() - tReg)/1000).toFixed(3);
        if (!stopped) out.fail.stop_time = 'still moving after ' + out.stop_time + ' s';
      }
    }
  }

  // ---------- 5. flat gap at run speed ----------
  if (await ground(['gap_run'], -40)) {
    down('KeyW'); await wait(1200);          // reach steady run speed
    if (!P.grounded) {
      out.gap_run = null;
      out.fail.gap_run = 'not grounded at takeoff (x=' + P.pos.x.toFixed(1) + ')';
    } else {
      down('Space');
      let tLeave = 0, t0 = performance.now(), xL = 0, zL = 0, landed = false;
      while (performance.now() - t0 < 1600) {
        await frame();
        if (!P.grounded && !tLeave) { tLeave = performance.now(); xL = P.pos.x; zL = P.pos.z; }
        if (tLeave && P.grounded && performance.now() - tLeave > 60) { landed = true; break; }
      }
      if (!tLeave) { out.gap_run = null; out.fail.gap_run = 'jump never left the ground'; }
      else if (!landed) { out.gap_run = null; out.fail.gap_run = 'never landed back on the slab'; }
      else out.gap_run = +Math.hypot(P.pos.x - xL, P.pos.z - zL).toFixed(2);
    }
    allUp(); await wait(400);
  }

  // ---------- 6. coyote time ----------
  // Walk off the slab's +X edge (x = +70; from x = +60 that is ~10 m, ~1.3 s
  // of walking) and press jump after a delay; binary-search the largest delay
  // that still produces a jump. Returns null when a precondition breaks.
  const tryCoyote = async (delayMs) => {
    if (!await reset(60)) return null;
    down('KeyW');
    let t = performance.now();
    while (P.grounded && performance.now() - t < 2600) await frame();
    if (P.grounded) { allUp(); return null; }        // +X edge never reached
    if (!out.pre.coyote_edge)
      out.pre.coyote_edge = {x: +P.pos.x.toFixed(2), y: +P.pos.y.toFixed(2)};
    await wait(delayMs);
    const vyBefore = P.vel.y;
    down('Space'); await wait(50); up('Space');
    const jumped = P.vel.y > vyBefore + 3.0;
    allUp(); await wait(150);
    return jumped;
  };
  let lo = 0, hi = 320, best = 0, searchBroke = null;
  for (let i = 0; i < 6; i++) {
    const mid = Math.round((lo + hi) / 2);
    const r = await tryCoyote(mid);
    if (r === null) {
      searchBroke = 'precondition failed mid-search (not grounded on slab, or +X edge never reached)';
      break;
    }
    if (r) { best = mid; lo = mid; } else { hi = mid; }
  }
  if (searchBroke) { out.coyote = null; out.fail.coyote = searchBroke; }
  else out.coyote = +(best/1000).toFixed(3);

  // ---------- 7. jump buffer ----------
  // Jump (short hold), then press again N ms before landing; a buffered press
  // produces a second jump the instant we touch down. The remaining-time
  // prediction is EXACT ballistics against the slab's real top (TEST.y):
  // t = (sqrt(vy^2 + 2 g dy) - |vy|) / g. The old dy/|vy| linearisation
  // overestimates the remaining time high on the arc, which pressed far too
  // early and corrupted the measured window.
  const tryBuffer = async (leadMs) => {
    if (!await reset()) return null;
    down('Space'); await wait(120); up('Space');
    let t = performance.now();
    while (P.grounded && performance.now() - t < 800) await frame();
    if (P.grounded) return null;               // the first jump never happened
    t = performance.now();
    while (performance.now() - t < 1500) {
      await frame();
      if (P.grounded) break;                   // landed before the press window
      if (P.vel.y < 0) {
        const dy = Math.max(0, P.pos.y - TEST.y);
        const s = -P.vel.y;
        const tt = (Math.sqrt(s*s + 2*GRAV_FALL*dy) - s) / GRAV_FALL * 1000;
        if (tt <= leadMs) break;
      }
    }
    down('Space');
    let jumped = false;
    t = performance.now();
    while (performance.now() - t < 500) {
      await frame();
      if (P.vel.y > 4) { jumped = true; break; }
    }
    up('Space'); allUp(); await wait(200);
    return jumped;
  };
  lo = 0; hi = 340; best = 0; searchBroke = null;
  for (let i = 0; i < 6; i++) {
    const mid = Math.round((lo + hi) / 2);
    const r = await tryBuffer(mid);
    if (r === null) {
      searchBroke = 'precondition failed mid-search (not grounded, or the first jump never left the ground)';
      break;
    }
    if (r) { best = mid; lo = mid; } else { hi = mid; }
  }
  if (searchBroke) { out.buffer = null; out.fail.buffer = searchBroke; }
  else out.buffer = +(best/1000).toFixed(3);

  // ---------- 8. death -> respawn ----------
  if (await ground(['respawn_ms'])) {
    const tDeath = performance.now();
    const trace = [];
    P.kill('manual');
    let tBack = null;
    const dl = performance.now() + 4000;
    let n = 0;
    while (performance.now() < dl) {
      await frame();
      syncP();
      if ((n++ % 6) === 0 && trace.length < 40)
        trace.push({t: Math.round(performance.now() - tDeath), st: G.state,
                    dT: Math.round(G._deathT), dead: P.dead,
                    susp: !!(G.input && G.input.suspended)});
      if (!P.dead && (!G.input || !G.input.suspended)) { tBack = performance.now(); break; }
    }
    if (tBack === null) {
      out.fail.respawn_ms = 'control never restored within 4 s';
      out._respawn_trace = trace;
    }
    out.respawn_ms = tBack ? Math.round(tBack - tDeath) : null;
  }

  if (slab) { A.engine.scene.remove(slab); slab.geometry.dispose(); slab.material.dispose(); }
  if (G.stage && G.stage.broadphase && typeof G.stage.broadphase.remove === 'function') {
    try { G.stage.broadphase.remove(col); } catch (e) { /* best effort */ }
  }
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


def click_play(pg, timeout=40):
    """Click the title's PLAY/NEW RUN and WAIT until the game is actually in
    'hub'/'playing'. The title lays out asynchronously (webfont + stage
    numbering), so a single click at a fixed delay can fire before the button
    exists and the game silently stays on the title - where input.suspended
    gates jump but not movement, which made feelcheck report a passing game as
    8 failures. NOTE the boot also passes through a transient 'loading' state
    BEFORE the title even exists, so "any state != 'title'" is NOT proof the
    click worked - it raced the boot, never clicked, and measured the title
    screen. Only 'hub'/'playing' counts."""
    import time as _t
    deadline = _t.time() + timeout
    while _t.time() < deadline:
        try:
            st = pg.evaluate("globalThis.ASCENDANT && ASCENDANT.game && ASCENDANT.game.state")
        except Exception:
            st = None
        if st in ("hub", "playing"):
            return True
        if st == "title":
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
    reasons = res.get("fail") if isinstance(res.get("fail"), dict) else {}
    for name, want, tol, unit in EXPECT:
        got = res.get(name)
        if got is None:
            print("  %-13s      FAIL  (%s)" % (name, reasons.get(name, "no measurement")))
            fails += 1
            continue
        ok = abs(got - want) <= tol
        fails += 0 if ok else 1
        print("  %-13s %8.3f %-4s  want %.3f +/- %.3f   %s"
              % (name, got, unit, want, tol, "OK" if ok else "FAIL"))
    st = res.get("stop_time")
    if st is None or st > 0.15:
        why = reasons.get("stop_time")
        print("  %-13s %s  want < 0.150 s   FAIL%s"
              % ("stop_time", "-" if st is None else ("%.3f s" % st),
                 (" (%s)" % why) if why else ""))
        fails += 1
    else:
        print("  %-13s %8.3f s     want < 0.150 s   OK" % ("stop_time", st))
    rs = res.get("respawn_ms")
    if rs is None or rs > 620:
        why = reasons.get("respawn_ms")
        print("  %-13s %s  want <= 620 ms   FAIL%s"
              % ("respawn_ms", "-" if rs is None else ("%d ms" % rs),
                 (" (%s)" % why) if why else ""))
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
