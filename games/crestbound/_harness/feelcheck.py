#!/usr/bin/env python
"""CRESTBOUND feel check — the movement bible (CONTRACT §11), measured.

Every number here is driven through the path the PLAYER uses: REAL KeyboardEvents
via `input.__test.press/release`, and the analog stick through
`input.__test.stick` — the contract's own injection point (poking `player.vel`
would prove nothing about the game anyone plays; see
feedback_verify_real_input_paths).

Expectations are not typed in. The routine dynamically imports
`./runtime/core/tuning.js` INSIDE the page and reports TUNE + EXACT alongside the
measurements, so the gate always compares the game against its own source of
truth. If the tuning changes, the gate moves with it.

  measurement        driven by                             expectation
  ------------------------------------------------------------------------------
  walk_speed         stick magnitude 0.40                  TUNE.speedWalk +/- 0.3
  run_speed          KeyW held                             TUNE.speedRun +/- 0.2
  runup_time         rest -> 95 % of run speed             <= 0.25 s
  stop_time          release at full run -> rest           <= 0.16 s
  apex1/2/3          Space, tap-tap-tap with the chain     EXACT single/double/triple apex +/- 0.08
  chain_break_apex   a 0.45 s pause before the 2nd jump    back to apex1 (tripleWindow enforced)
  jump_cut_ratio     50 ms tap vs full hold                <= 0.60
  longjump_dist      crouch + jump at run                  >= 6.4 m flat
  backflip_apex      crouch + jump from rest               EXACT.backflipApex +/- 0.10
  sideflip_apex      stick reversal + jump at speed        EXACT.sideflipApex +/- 0.10
  wallkick_vy/away   jump into a wall, jump again          TUNE.wallKick.vy / .away
  dive_dist          dive at run, to the end of the slide  >= 6 m, and a slide state
  pound_hang         crouch in the air                     TUNE.pound.hang +/- 0.03
  pound_fall         peak descent during the pound         >= 35 m/s
  poundjump_apex     jump inside pound.jumpWindow          EXACT.poundjumpApex +/- 0.10
  coyote_early/late  jump EVALUATED 0.06 / 0.14 s after    yes / no  (TUNE.coyote 0.09)
                     the ledge (fall clock, not wall clock)
  buffer             jump 0.08 s BEFORE landing            jumps on landing
  land_keep_ratio    speed after landing / before          >= 0.90
  swim_speed         stick forward in water                TUNE.swim.speed +/- 0.3

The test ground is a synthetic 140 x 140 m slab at y = 400, far above the course,
with one wall for the kick and (when the live course has no water) one pool. They
are real Colliders/Volumes added to the live broadphase and removed afterwards —
the same physics the course uses, with nothing else in the way.

    python feelcheck.py
    python feelcheck.py --headless
    python feelcheck.py --course verdant-1     # measure inside a course
    python feelcheck.py --json feelcheck.json

Exit 0 = every measurement inside its band.
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
DEFAULT_URL = "http://localhost:8788/games/crestbound/index.html?dev=1"

FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization", "--disable-features=CalculateNativeWinOcclusion",
         "--autoplay-policy=no-user-gesture-required"]
HEADLESS_FLAGS = [f for f in FLAGS if not f.startswith("--use-angle")] + [
    "--use-gl=angle", "--use-angle=swiftshader"]

STATE_JS = "globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.state"


def launch_headless(p):
    """Headless, but on the REAL GPU (same rule as loopcheck.py).

    Every row in this gate is a REAL-TIME measurement sampled once per
    requestAnimationFrame: a 420 ms settle needs ~25 frames, a run-up needs
    ~60. Under the bundled Chromium + SwiftShader this page presents ~0.4
    frames/second, so `wait(420)` yields ONE frame, the hero has had 1/20 s of
    simulation, and every precondition reports "not grounded" -- the gate would
    be measuring the software rasterizer instead of the controller. Real Chrome
    headless drives ANGLE/D3D11 on this box and measures the game. SwiftShader
    stays as the fallback for a machine with no usable GPU, and says so.
    """
    try:
        return p.chromium.launch(channel="chrome", headless=True, args=FLAGS)
    except Exception as e:
        print("headless: no hardware Chrome (%s) -> SwiftShader; the timing rows "
              "will measure the software rasterizer, not the game" % str(e)[:120],
              file=sys.stderr)
        return p.chromium.launch(headless=True, args=HEADLESS_FLAGS)

CLICK_JS = r"""() => {
  const words = ['NEW GAME', 'NEW RUN', 'CONTINUE', 'PLAY', 'START', 'BEGIN', 'ENTER'];
  const btns = Array.from(document.querySelectorAll('button.cb-btn, button, [role=button], .btn'));
  for (const want of words) {
    for (const b of btns) {
      const r = b.getBoundingClientRect();
      if (b.disabled || r.width < 4 || r.height < 4) continue;
      if ((b.textContent || '').toUpperCase().indexOf(want) < 0) continue;
      if (typeof b.__activate === 'function') b.__activate(); else b.click();
      return want;
    }
  }
  const t = document.querySelector('canvas') || document;
  for (const type of ['keydown', 'keyup'])
    t.dispatchEvent(new KeyboardEvent(type, {code:'Enter', key:'Enter', bubbles:true, cancelable:true}));
  return null;
}"""

MEASURE_JS = r"""
async () => {
  const A = globalThis.CRESTBOUND;
  if (!A || !A.game) return {error: 'no CRESTBOUND.game'};
  const G = A.game, THREE = A.THREE;
  if (!THREE) return {error: 'CRESTBOUND.THREE missing'};
  const out = {m: {}, fail: {}, notes: {}};

  /* ---- tuning: the expectations come from the game's own source of truth -- */
  let TUNE, EXACT, REACH_TABLE;
  try {
    const t = await import(new URL('runtime/core/tuning.js', location.href).href);
    TUNE = t.TUNE; EXACT = t.EXACT; REACH_TABLE = t.REACH_TABLE;
  } catch (e) { return {error: 'could not import tuning.js: ' + e}; }
  if (!TUNE || !EXACT) return {error: 'tuning.js is missing TUNE / EXACT'};
  out.tune = TUNE; out.exact = EXACT;
  out.diveMax = REACH_TABLE && REACH_TABLE.dive ? REACH_TABLE.dive.rows[0].max : null;

  /* ---- preconditions ------------------------------------------------------ */
  let P = G.player;
  if (!P || !P.__test) return {error: 'game.player.__test missing'};
  const IN = G.input;
  if (!IN || !IN.__test) return {error: 'game.input.__test missing'};
  if (G.state !== 'playing' && G.state !== 'keep')
    return {error: 'unexpected game state: ' + G.state};
  if (IN.suspended) return {error: 'input.suspended is true (a menu is open)'};
  if (G.noclip) G.__dev && G.__dev.noclip(false);

  const syncP = () => { if (G.player && G.player !== P) P = G.player; return P; };
  const frame = () => new Promise(r => requestAnimationFrame(r));
  const wait = async (ms) => { const t = performance.now(); while (performance.now() - t < ms) await frame(); };
  const spd = () => Math.hypot(P.vel.x, P.vel.z);
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

  /* ---- real keyboard ------------------------------------------------------ */
  const KEYS = ['KeyW','KeyA','KeyS','KeyD','Space','ControlLeft','ShiftLeft','KeyC','KeyF','KeyX','KeyZ','KeyG'];
  const down = (c) => IN.__test.press(c);
  const up = (c) => IN.__test.release(c);
  const allUp = () => { KEYS.forEach(up); IN.__test.stick(0, 0); };
  const JUMP = 'Space', CROUCH = 'ControlLeft', DIVE = 'KeyF', FWD = 'KeyW';

  /* ---- the analog stick, in WORLD terms ----------------------------------- */
  // input.move is CAMERA-RELATIVE (contract §4): y forward along the camera's
  // flat forward, x to its right. Converting a world direction through the live
  // camera yaw is what lets every directional test name a world axis and still
  // exercise the real, camera-relative path.
  const camYaw = () => {
    const c = G.cam;
    if (c && Number.isFinite(c.yaw)) return c.yaw;
    if (c && Number.isFinite(c.yawForMovement)) return c.yawForMovement;
    return 0;
  };
  const stickWorld = (wx, wz, mag) => {
    const y = camYaw();
    const fx = -Math.sin(y), fz = -Math.cos(y);      // headingFromYaw(camera)
    const rx = -fz, rz = fx;                         // right-hand side of forward
    const L = Math.hypot(wx, wz) || 1;
    const ux = wx / L, uz = wz / L;
    const m = mag === undefined ? 1 : mag;
    IN.__test.stick((ux * rx + uz * rz) * m, (ux * fx + uz * fz) * m);
  };

  /* ---- the test ground ---------------------------------------------------- */
  let Collider, Volume;
  try {
    const m = await import(new URL('runtime/world/collider.js', location.href).href);
    Collider = m.Collider; Volume = m.Volume;
  } catch (e) { return {error: 'could not import collider.js: ' + e}; }
  const C = G.course;
  if (!C || !C.broadphase) return {error: 'no live course/broadphase to host the test slab'};

  const TEST = {x: 0, y: 400, z: 600};
  const HX = 70, HY = 1.5, HZ = 70;           // slab TOP is exactly TEST.y
  const added = [];
  const addCollider = (center, half, surface) => {
    const c = new Collider({center, half, surface: surface || 'stone', solid: true});
    if (typeof c.update === 'function') c.update();
    C.broadphase.add(c);
    if (typeof C.broadphase.refresh === 'function') C.broadphase.refresh(c);
    added.push(c);
    return c;
  };
  const slab = addCollider(V3(TEST.x, TEST.y - HY, TEST.z), V3(HX, HY, HZ), 'stone');
  // A wall for the kick: 16 m wide, 10 m tall, standing on the slab at z-40.
  const WALL_Z = TEST.z - 40;
  addCollider(V3(TEST.x, TEST.y + 5, WALL_Z), V3(8, 5, 0.5), 'stone');
  out.notes.slab = slab.aabb ? [slab.aabb.min.x, slab.aabb.max.x, slab.aabb.min.y,
                                slab.aabb.max.y, slab.aabb.min.z, slab.aabb.max.z] : null;

  // Water: the live course's own if it has one (a pond/fountain is the real
  // article), otherwise a synthetic pool floating over the slab.
  let waterCentre = null, waterHalf = null, waterSurfaceY = 0, waterSource = 'none', tempVolume = null;
  const vols = (C.volumes || []);
  for (const v of vols) {
    if (!v || v.kind !== 'water') continue;
    const c = v.center || (v.aabb && v.aabb.getCenter && v.aabb.getCenter(V3(0,0,0)));
    const h = v.half || null;
    if (!c) continue;
    // big enough to swim 1 s at 4.5 m/s without hitting the far wall
    if (h && Math.min(h.x, h.z) < 3.5) continue;
    waterCentre = {x: c.x, y: c.y, z: c.z};
    waterHalf = {x: h ? h.x : 4, y: h ? h.y : 1, z: h ? h.z : 4};
    waterSurfaceY = c.y + (h ? h.y : 1);
    waterSource = 'live course volume';
    break;
  }
  if (!waterCentre && Volume) {
    try {
      tempVolume = new Volume({center: V3(TEST.x + 40, TEST.y + 20, TEST.z + 40),
                               half: V3(9, 6, 9), kind: 'water', props: {}});
      vols.push(tempVolume);
      if (G.player && G.player.world && G.player.world.volumes && G.player.world.volumes !== vols) {
        G.player.world.volumes.push(tempVolume);
      }
      waterCentre = {x: TEST.x + 40, y: TEST.y + 20, z: TEST.z + 40};
      waterHalf = {x: 9, y: 6, z: 9};
      waterSurfaceY = TEST.y + 26;
      waterSource = 'synthetic pool';
    } catch (e) { waterSource = 'could not build a pool: ' + e; }
  }
  out.notes.water = waterSource;

  /* ---- primitives --------------------------------------------------------- */
  const reset = async (dx, dz) => {
    syncP(); allUp();
    P.__test.teleport(V3(TEST.x + (dx || 0), TEST.y + 0.35, TEST.z + (dz || 0)));
    P.__test.setVel(V3(0, 0, 0));
    await wait(420);
    syncP();
    return !!P.grounded && !P.dead;
  };

  /**
   * Watch the sim for `ms`, recording the flight envelope. `stop` ends it early.
   * Everything the tests need is derived from this one observer so no test has
   * its own (subtly different) idea of "landed".
   */
  const observe = async (ms, stop) => {
    syncP();
    const st = {y0: P.pos.y, x0: P.pos.x, z0: P.pos.z, peakY: P.pos.y, minVy: 0, maxVy: 0,
                maxSpd: spd(), lastAirSpd: 0, leftAt: 0, landAt: 0, takeoff: null,
                landing: null, states: [], preLandSpd: 0, postLandSpd: 0};
    const seen = Object.create(null);
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      await frame(); syncP();
      const s = spd();
      if (!seen[P.state]) { seen[P.state] = 1; st.states.push(P.state); }
      if (s > st.maxSpd) st.maxSpd = s;
      if (P.pos.y > st.peakY) st.peakY = P.pos.y;
      if (P.vel.y < st.minVy) st.minVy = P.vel.y;
      if (P.vel.y > st.maxVy) st.maxVy = P.vel.y;
      if (!P.grounded) {
        if (!st.leftAt) { st.leftAt = performance.now(); st.takeoff = {x: P.pos.x, y: P.pos.y, z: P.pos.z}; }
        st.lastAirSpd = s; st.preLandSpd = s;
      } else if (st.leftAt && !st.landAt && performance.now() - st.leftAt > 50) {
        st.landAt = performance.now();
        st.landing = {x: P.pos.x, y: P.pos.y, z: P.pos.z};
        st.postLandSpd = s;
        if (!stop) break;
      }
      if (stop && stop(st)) break;
    }
    st.apex = st.peakY - st.y0;
    st.airtime = st.leftAt && st.landAt ? (st.landAt - st.leftAt) / 1000 : null;
    st.dist = st.takeoff && st.landing
      ? Math.hypot(st.landing.x - st.takeoff.x, st.landing.z - st.takeoff.z) : null;
    return st;
  };

  const record = (name, value, note) => {
    out.m[name] = value;
    if (note) out.notes[name] = note;
  };
  const failWith = (name, why) => { out.m[name] = null; out.fail[name] = why; };
  const need = async (name, dx, dz) => {
    const okg = await reset(dx, dz);
    if (!okg) failWith(name, 'precondition failed: not grounded on the slab at ('
      + P.pos.x.toFixed(1) + ', ' + P.pos.y.toFixed(1) + ', ' + P.pos.z.toFixed(1) + ')'
      + (P.dead ? ' [dead]' : ''));
    return okg;
  };
  /** Accelerate to full run along a world direction; returns the reached speed. */
  const runUp = async (wx, wz, ms) => {
    stickWorld(wx, wz, 1);
    await wait(ms === undefined ? 900 : ms);
    syncP();
    return spd();
  };

  /* =======================================================================
   * 1. analog ground speeds
   * ==================================================================== */
  if (await need('walk_speed')) {
    stickWorld(1, 0, 0.40);
    await wait(1100);
    let s = 0, n = 0;
    for (let i = 0; i < 20; i++) { await frame(); syncP(); if (P.grounded) { s += spd(); n++; } }
    if (n < 10) failWith('walk_speed', 'left the ground during the sample');
    else record('walk_speed', +(s / n).toFixed(3));
    allUp(); await wait(250);
  }

  if (await need('run_speed', -40, 0)) {
    down(FWD);
    await wait(1200);
    let s = 0, n = 0;
    for (let i = 0; i < 20; i++) { await frame(); syncP(); if (P.grounded) { s += spd(); n++; } }
    if (n < 10) failWith('run_speed', 'left the ground during the sample');
    else record('run_speed', +(s / n).toFixed(3));

    /* ---- stop time: from the frame the release REGISTERS ---------------- */
    if (P.grounded) {
      const before = spd();
      allUp();
      const t0 = performance.now();
      let stopped = false;
      while (performance.now() - t0 < 1200) {
        await frame(); syncP();
        if (spd() < 0.25) { stopped = true; break; }
      }
      const dt = (performance.now() - t0) / 1000;
      if (!stopped) failWith('stop_time', 'still moving at ' + spd().toFixed(2) + ' m/s after ' + dt.toFixed(2) + ' s');
      else record('stop_time', +dt.toFixed(3), 'from ' + before.toFixed(2) + ' m/s');
    } else failWith('stop_time', 'not grounded at release');
    allUp(); await wait(300);
  }

  if (await need('runup_time', -40, 0)) {
    const target = TUNE.speedRun * 0.95;
    const t0 = performance.now();
    down(FWD);
    let hit = null;
    while (performance.now() - t0 < 1500) {
      await frame(); syncP();
      if (spd() >= target) { hit = (performance.now() - t0) / 1000; break; }
    }
    if (hit === null) failWith('runup_time', 'never reached ' + target.toFixed(2) + ' m/s (peaked at ' + spd().toFixed(2) + ')');
    else record('runup_time', +hit.toFixed(3));
    allUp(); await wait(300);
  }

  /* =======================================================================
   * 2. the jump family — single / double / triple, chained
   * ==================================================================== */
  // A chained jump needs speed >= tripleMinSpeed and the next press inside
  // tripleWindow of the landing. The jump is HELD through each flight so the
  // apex is the full jumpV (a release above jumpHoldMin would cut it).
  const chain = async (n, pauseMs) => {
    const apexes = [], states = [];
    if (!(await reset(-45, 0))) return null;
    await runUp(1, 0, 950);
    if (spd() < TUNE.tripleMinSpeed) { allUp(); return {err: 'only reached ' + spd().toFixed(2) + ' m/s'}; }
    for (let k = 0; k < n; k++) {
      if (k > 0 && pauseMs) await wait(pauseMs);
      syncP();
      const y0 = P.pos.y;
      down(JUMP);
      let st = '';
      // hold through the flight, sample the state just after take-off
      const f = await observe(2200, (s) => {
        if (!st && s.leftAt) st = P.state;
        return !!s.landAt;
      });
      up(JUMP);
      apexes.push(+(f.peakY - y0).toFixed(3));
      states.push(st || P.state);
      if (!f.landAt) return {apexes, states, err: 'jump ' + (k + 1) + ' never landed'};
    }
    allUp();
    return {apexes, states};
  };

  const tri = await chain(3, 40);
  if (!tri || tri.err) {
    for (const k of ['apex1', 'apex2', 'apex3']) failWith(k, (tri && tri.err) || 'precondition failed');
  } else {
    record('apex1', tri.apexes[0], tri.states[0]);
    record('apex2', tri.apexes[1], tri.states[1]);
    record('apex3', tri.apexes[2], tri.states[2]);
    out.notes.chainStates = tri.states;
  }
  await wait(300);

  // tripleWindow enforcement: a 0.45 s pause after landing breaks the chain, so
  // the SECOND jump must be a single again.
  const broken = await chain(2, 450);
  if (!broken || broken.err) failWith('chain_break_apex', (broken && broken.err) || 'precondition failed');
  else record('chain_break_apex', broken.apexes[1], 'states ' + broken.states.join(' -> '));
  await wait(300);

  /* ---- jump cut: a short tap must not reach the full apex ---------------- */
  if (await need('jump_cut_ratio')) {
    const y0 = P.pos.y;
    down(JUMP); await wait(50); up(JUMP);
    const f = await observe(2000);
    const tap = f.peakY - y0;
    const full = out.m.apex1;
    if (!full) failWith('jump_cut_ratio', 'no apex1 to compare against');
    else record('jump_cut_ratio', +(tap / full).toFixed(3), 'tap apex ' + tap.toFixed(2) + ' m vs full ' + full.toFixed(2) + ' m');
    allUp(); await wait(250);
  }

  /* ---- landing keeps horizontal speed ------------------------------------ */
  if (await need('land_keep_ratio', -45, 0)) {
    await runUp(1, 0, 950);
    down(JUMP);
    const f = await observe(2500);
    up(JUMP);
    if (!f.landAt) failWith('land_keep_ratio', 'never landed');
    else {
      // sample again a little after the landing lag so the number is the speed
      // the player actually keeps, not the single frame of contact
      await wait(90); syncP();
      const after = spd();
      const pre = f.preLandSpd;
      if (pre < 1) failWith('land_keep_ratio', 'no horizontal speed before landing');
      else record('land_keep_ratio', +(after / pre).toFixed(3),
                  pre.toFixed(2) + ' -> ' + after.toFixed(2) + ' m/s');
    }
    allUp(); await wait(250);
  }

  /* =======================================================================
   * 3. long jump, backflip, sideflip
   * ==================================================================== */
  if (await need('longjump_dist', -50, 0)) {
    const reached = await runUp(1, 0, 1000);
    if (reached < TUNE.longJump.minSpeed) failWith('longjump_dist', 'only reached ' + reached.toFixed(2) + ' m/s (needs ' + TUNE.longJump.minSpeed + ')');
    else {
      down(CROUCH); await wait(30); down(JUMP);
      const f = await observe(3000);
      up(JUMP); up(CROUCH);
      if (!f.landAt) failWith('longjump_dist', 'never landed');
      else record('longjump_dist', +f.dist.toFixed(3),
                  'states ' + f.states.join(',') + ', apex ' + f.apex.toFixed(2) + ' m');
    }
    allUp(); await wait(300);
  }

  if (await need('backflip_apex')) {
    // from (near) rest: crouch, then jump
    down(CROUCH); await wait(120); down(JUMP);
    const f = await observe(2500);
    up(JUMP); up(CROUCH);
    if (!f.leftAt) failWith('backflip_apex', 'never left the ground');
    else record('backflip_apex', +f.apex.toFixed(3), 'states ' + f.states.join(','));
    allUp(); await wait(300);
  }

  if (await need('sideflip_apex', -45, 0)) {
    const reached = await runUp(1, 0, 950);
    if (reached < 4) failWith('sideflip_apex', 'only reached ' + reached.toFixed(2) + ' m/s');
    else {
      stickWorld(-1, 0, 1);          // reverse the stick against the run
      await wait(60);
      down(JUMP);
      const f = await observe(2500);
      up(JUMP);
      if (!f.leftAt) failWith('sideflip_apex', 'never left the ground');
      else record('sideflip_apex', +f.apex.toFixed(3), 'states ' + f.states.join(','));
    }
    allUp(); await wait(300);
  }

  /* =======================================================================
   * 4. wall kick
   * ==================================================================== */
  // Driven the way a player does it: run at the wall, jump, HOLD the stick into
  // the wall (that is what makes a wallslide and what keeps the contact memory
  // alive), and press jump once the hero is actually on the wall AND falling.
  // TUNE.wallKick.minFall is the contract's own gate -- "you bonk a wall on the
  // way up, you kick it on the way down" -- so a press fired the instant the
  // capsule is airborne measures the refusal, not the kick. A wall contact also
  // needs a NON-ZERO normal: wallN is (0,0,0) when there is no wall, and
  // |0| < 0.4 would call empty air a wall.
  {
    const name = 'wallkick_vy';
    const okg = await reset(0, -34);          // 6 m in front of the wall at z-40
    if (!okg) { failWith(name, 'precondition failed: not grounded'); failWith('wallkick_away', 'precondition failed'); }
    else {
      await runUp(0, -1, 500);                // run toward -Z, into the wall
      down(JUMP); await wait(120); up(JUMP);
      const onWall = () => {
        const n = P.wallN;
        if (P.grounded) return false;
        if (P.state === 'wallslide') return true;
        if (!n) return false;
        const flat = Math.hypot(n.x, n.z);
        return flat > 0.5 && Math.abs(n.y) < 0.4;
      };
      let contact = false, ready = false, sawWall = '';
      const t0 = performance.now();
      while (performance.now() - t0 < 1600) {
        stickWorld(0, -1, 1);                 // keep leaning into the wall
        await frame(); syncP();
        if (onWall()) {
          contact = true;
          if (!sawWall) sawWall = 'vy ' + P.vel.y.toFixed(2) + ' at contact';
          if (P.vel.y <= TUNE.wallKick.minFall) { ready = true; break; }
        }
        if (P.grounded && contact) break;     // fell back to the floor: missed it
      }
      if (!ready) {
        const why = contact ? 'wall contact but never fell to minFall ' + TUNE.wallKick.minFall
          + ' (state ' + P.state + ')' : 'never registered a wall contact (state ' + P.state + ')';
        failWith(name, why); failWith('wallkick_away', why);
      } else {
        down(JUMP);
        let vy = -1e9, away = 0, st = '';
        const t1 = performance.now();
        while (performance.now() - t1 < 320) {
          await frame(); syncP();
          if (P.state === 'wallkick') st = 'wallkick';
          if (P.vel.y > vy) { vy = P.vel.y; away = spd(); }
        }
        up(JUMP);
        record('wallkick_vy', +vy.toFixed(3), (st || 'state ' + P.state) + ', ' + sawWall);
        record('wallkick_away', +away.toFixed(3));
      }
    }
    allUp(); await wait(400);
  }

  /* =======================================================================
   * 5. dive + belly slide
   * ==================================================================== */
  if (await need('dive_dist', -50, 0)) {
    const reached = await runUp(1, 0, 950);
    if (reached < TUNE.dive.minSpeed) failWith('dive_dist', 'only reached ' + reached.toFixed(2) + ' m/s');
    else {
      const x0 = P.pos.x, z0 = P.pos.z;
      down(DIVE); await wait(60); up(DIVE);
      // run until the slide has fully stopped (or 3 s)
      const f = await observe(3000, (s) => P.grounded && spd() < 0.4 && (performance.now() - (s.landAt || 0)) > 120);
      IN.__test.stick(0, 0);
      syncP();
      const d = Math.hypot(P.pos.x - x0, P.pos.z - z0);
      const sawDive = f.states.indexOf('dive') >= 0;
      const sawSlide = f.states.indexOf('slide') >= 0 || f.states.indexOf('slideRecover') >= 0;
      record('dive_dist', +d.toFixed(3), 'states ' + f.states.join(','));
      out.m.dive_states_ok = (sawDive && sawSlide) ? 1 : 0;
      if (!sawDive || !sawSlide) out.fail.dive_states_ok = 'saw ' + f.states.join(',') + ' (needs dive AND slide)';
    }
    allUp(); await wait(300);
  }

  /* =======================================================================
   * 6. ground pound + pound jump
   * ==================================================================== */
  if (await need('pound_hang')) {
    down(JUMP); await wait(160); up(JUMP);
    await wait(120);
    syncP();
    down(CROUCH);                                  // pound = crouch while airborne
    // hang: velocity pinned near zero (the contract's 0.2 s spin)
    const t0 = performance.now();
    let hangStart = 0, hangEnd = 0, minVy = 0;
    while (performance.now() - t0 < 2600) {
      await frame(); syncP();
      const hanging = P.state === 'poundHang' || (Math.abs(P.vel.y) < 1.0 && !P.grounded && P.state !== 'jump1');
      if (hanging && !hangStart) hangStart = performance.now();
      if (hangStart && !hangEnd && (P.vel.y < -6 || P.state === 'poundFall')) hangEnd = performance.now();
      if (P.vel.y < minVy) minVy = P.vel.y;
      if (P.grounded && hangEnd) break;
    }
    up(CROUCH);
    if (!hangStart || !hangEnd) failWith('pound_hang', 'no hang phase observed (state ' + P.state + ')');
    else record('pound_hang', +((hangEnd - hangStart) / 1000).toFixed(3));
    record('pound_fall', +(-minVy).toFixed(2));

    /* ---- pound jump: press inside pound.jumpWindow of the landing -------- */
    // the loop above breaks on the landing frame, so press immediately
    syncP();
    const y0 = P.pos.y;
    down(JUMP);
    const f = await observe(2400);
    up(JUMP);
    if (!f.leftAt) failWith('poundjump_apex', 'the pound jump never left the ground (state ' + P.state + ')');
    else record('poundjump_apex', +(f.peakY - y0).toFixed(3), 'states ' + f.states.join(','));
    allUp(); await wait(300);
  }

  /* =======================================================================
   * 7. coyote time and the jump buffer
   * ==================================================================== */
  // Walk off the slab's +X edge (x = TEST.x + HX) and jump after a delay. A
  // jump is proven by vy RISING, not by a state name.
  //
  // TIMING. The delay that matters is the one the CONTROLLER sees, not the one
  // the harness slept: a press is consumed by the next input.update, and the
  // rAF that first OBSERVES the fall is already up to a frame late. Sleeping
  // 60 ms of wall clock therefore has the jump evaluated ~100 ms after the
  // ledge and calls a correct 0.09 s coyote broken. So the clock here is the
  // fall itself — after walking off with vy ~ 0 the hero is in free fall, so
  // t = -vel.y / gravFall is exactly the time since the ledge — and the press
  // is issued one frame EARLY so it lands at the intended `delayMs`. The
  // measured evaluation time is reported with the row.
  // Live rAF interval (engine.stats.frameMs is CPU time inside the frame, not
  // the interval between them — under SwiftShader it reads 9 ms while frames
  // arrive 2.5 s apart).
  const measureFrameDt = async () => {
    const ts = [];
    for (let i = 0; i < 12; i++) { await frame(); ts.push(performance.now()); }
    const d = [];
    for (let i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1]);
    d.sort((a, b) => a - b);
    return Math.min(120, Math.max(6, d[d.length >> 1])) / 1000;
  };
  const FRAME_DT = await measureFrameDt();
  out.notes.frameDt = +(FRAME_DT * 1000).toFixed(1) + ' ms';
  const frameDt = () => FRAME_DT;
  const tryCoyote = async (delayMs) => {
    if (!(await reset(HX - 12, 0))) {
      return {err: 'precondition failed: not grounded on the slab at (' + P.pos.x.toFixed(1)
        + ', ' + P.pos.y.toFixed(1) + ', ' + P.pos.z.toFixed(1) + ') state ' + P.state
        + (P.dead ? ' [dead]' : '')};
    }
    stickWorld(1, 0, 1);
    const t0 = performance.now();
    while (P.grounded && performance.now() - t0 < 3200) { stickWorld(1, 0, 1); await frame(); syncP(); }
    if (P.grounded) {
      const why = 'never walked off the slab edge (x ' + P.pos.x.toFixed(1) + ', speed '
        + spd().toFixed(2) + ', state ' + P.state + ', stick mag ' + IN.move.mag.toFixed(2) + ')';
      allUp(); return {err: why};
    }
    IN.__test.stick(0, 0);
    const tAir = () => Math.max(0, -P.vel.y) / TUNE.gravFall;   // seconds since the ledge
    const want = delayMs / 1000;
    const lead = frameDt();
    const t1 = performance.now();
    while (performance.now() - t1 < 1200) {
      syncP();
      if (tAir() >= want - lead) break;
      await frame();
    }
    syncP();
    const at = tAir();
    const vy0 = P.vel.y;
    down(JUMP);
    await frame(); syncP();
    const evalAt = at + lead;
    await wait(60); up(JUMP);
    syncP();
    const jumped = P.vel.y > vy0 + 3.0;
    allUp(); await wait(200);
    return { jumped: jumped, at: at, evalAt: evalAt };
  };
  const early = await tryCoyote(60);
  if (!early || early.err) failWith('coyote_early', (early && early.err) || 'precondition failed');
  else record('coyote_early', early.jumped ? 1 : 0,
              'pressed ' + (early.at * 1000).toFixed(0) + ' ms after the ledge, evaluated ~'
              + (early.evalAt * 1000).toFixed(0) + ' ms (coyote ' + (TUNE.coyote * 1000).toFixed(0) + ' ms)');
  const late = await tryCoyote(140);
  if (!late || late.err) failWith('coyote_late', (late && late.err) || 'precondition failed');
  else record('coyote_late', late.jumped ? 1 : 0,
              'pressed ' + (late.at * 1000).toFixed(0) + ' ms after the ledge, evaluated ~'
              + (late.evalAt * 1000).toFixed(0) + ' ms');

  // Buffer: press 80 ms BEFORE the landing. The remaining time is exact
  // ballistics against the slab top (a dy/|vy| linearisation presses far too
  // early high on the arc and measures nothing).
  if (await need('buffer')) {
    down(JUMP); await wait(150); up(JUMP);
    let t0 = performance.now();
    while (P.grounded && performance.now() - t0 < 900) { await frame(); syncP(); }
    if (P.grounded) failWith('buffer', 'the first jump never left the ground');
    else {
      let pressed = false;
      t0 = performance.now();
      while (performance.now() - t0 < 2000) {
        await frame(); syncP();
        if (P.grounded) break;
        if (P.vel.y < 0) {
          const dy = Math.max(0, P.pos.y - TEST.y);
          const s = -P.vel.y;
          const tt = (Math.sqrt(s * s + 2 * TUNE.gravFall * dy) - s) / TUNE.gravFall * 1000;
          if (tt <= 80) { down(JUMP); pressed = true; break; }
        }
      }
      if (!pressed) failWith('buffer', 'never got inside the 80 ms window before landing');
      else {
        let jumped = false;
        t0 = performance.now();
        while (performance.now() - t0 < 700) {
          await frame(); syncP();
          if (P.vel.y > 4) { jumped = true; break; }
        }
        up(JUMP);
        record('buffer', jumped ? 1 : 0, '80 ms before landing');
      }
    }
    allUp(); await wait(300);
  }

  /* =======================================================================
   * 8. swimming
   * ==================================================================== */
  // The swim needs ROOM: `swim.speed` is reached in swim.speed/swim.accel ~
  // 0.56 s, so a stroke started in the middle of a 4 m pool is still
  // accelerating when it reaches the far side. Start on the up-stick edge of
  // the pool's LONGER axis, swim across it, and only count frames still inside
  // the water. The stick is re-driven every frame so the world direction stays
  // fixed while the follow camera auto-yaws behind the hero (`stickWorld` is
  // camera-relative, which is the real input path — a stick set once would
  // curve as the camera swung).
  if (!waterCentre) failWith('swim_speed', 'no water anywhere: ' + waterSource);
  else {
    syncP(); allUp();
    const HW = waterHalf || {x: 4, y: 1, z: 4};
    const alongX = HW.x >= HW.z;
    const span = (alongX ? HW.x : HW.z);
    const dirX = alongX ? 1 : 0, dirZ = alongX ? 0 : 1;
    const margin = Math.min(1.0, span * 0.2);
    // Start in the MIDDLE of the pool: the edge is where the basin's stone rim
    // is, and a capsule wedged in the rim measures 0 m/s. From the centre the
    // hero has `span` metres of clear water, which is more than the
    // speed/accel = 0.56 s ramp needs.
    P.__test.teleport(V3(waterCentre.x, waterCentre.y, waterCentre.z));
    P.__test.setVel(V3(0, 0, 0));
    await wait(500);
    syncP();
    const inside = () => {
      const dx = Math.abs(P.pos.x - waterCentre.x), dz = Math.abs(P.pos.z - waterCentre.z);
      return !!P.inWater && dx <= HW.x - margin * 0.5 && dz <= HW.z - margin * 0.5;
    };
    if (!P.inWater) {
      failWith('swim_speed', 'teleport into the ' + waterSource + ' did not put the player in water (state ' + P.state + ')');
    } else {
      // Hold the stick until the stroke PLATEAUS (the analog target is a
      // steady state, not a peak), then average the next frames. The ramp is
      // swim.speed/swim.accel = 0.56 s; the ceiling is generous, the exit is
      // the plateau itself.
      const rampMs = (TUNE.swim.speed / TUNE.swim.accel) * 1000 + 900;
      const t0 = performance.now();
      let last = 0, flat = 0;
      while (performance.now() - t0 < rampMs) {
        stickWorld(dirX, dirZ, 1);
        await frame(); syncP();
        const v = spd();
        if (Math.abs(v - last) < 0.02 && v > 0.5) { if (++flat >= 3) break; } else flat = 0;
        last = v;
      }
      let s = 0, n = 0;
      for (let i = 0; i < 10; i++) {
        stickWorld(dirX, dirZ, 1);
        await frame(); syncP();
        if (inside()) { s += spd(); n++; }
      }
      if (n < 6) failWith('swim_speed', 'left the water during the sample (crossed the '
        + (2 * span).toFixed(1) + ' m pool; ' + n + ' usable frames)');
      else if (s / n < 0.2) failWith('swim_speed', 'never moved: state ' + P.state
        + ', stick mag ' + IN.move.mag.toFixed(2) + ', pos ' + P.pos.x.toFixed(1) + ','
        + P.pos.y.toFixed(1) + ',' + P.pos.z.toFixed(1));
      else record('swim_speed', +(s / n).toFixed(3), waterSource + ' ' + (2 * span).toFixed(1)
        + ' m, state ' + P.state);
    }
    allUp(); await wait(200);
  }

  /* ---- tear the test ground down ------------------------------------------ */
  try {
    for (const c of added) {
      if (typeof C.broadphase.remove === 'function') C.broadphase.remove(c);
    }
  } catch (e) { out.notes.teardown = 'collider removal: ' + e; }
  if (tempVolume) {
    const strip = (arr) => { const i = arr.indexOf(tempVolume); if (i >= 0) arr.splice(i, 1); };
    try { strip(vols); if (G.player && G.player.world && G.player.world.volumes) strip(G.player.world.volumes); }
    catch (e) { out.notes.teardown = 'volume removal: ' + e; }
  }
  allUp();
  // put the hero back where the course expects them
  try {
    const sp = C.spawnFor ? C.spawnFor(G.cpIndex | 0) : null;
    if (sp && sp.pos) { syncP(); P.respawn(sp.pos, sp.yaw || 0); }
  } catch (e) { /* cosmetic */ }
  return out;
}
"""


def band(name, kind, target, tol, unit, note=""):
    return {"name": name, "kind": kind, "target": target, "tol": tol, "unit": unit, "note": note}


def build_expectations(tune, exact, dive_max):
    """The table the measurements are judged against — every target read from
    the page's own TUNE/EXACT so the gate can never drift from the game."""
    t = tune or {}
    e = exact or {}
    sw = t.get("speedWalk", 3.2)
    sr = t.get("speedRun", 9.0)
    pound = t.get("pound", {}) or {}
    swim = t.get("swim", {}) or {}
    wk = t.get("wallKick", {}) or {}
    dive_floor = 6.0 if not dive_max else max(6.0, round(dive_max * 0.55, 2))
    return [
        band("walk_speed",       "about", sw, 0.30, "m/s", "stick 0.40"),
        band("run_speed",        "about", sr, 0.20, "m/s", "KeyW held"),
        band("runup_time",       "max",   0.25, 0, "s",    "rest -> 95 % run"),
        band("stop_time",        "max",   0.16, 0, "s",    "release -> rest"),
        band("apex1",            "about", e.get("singleApex", 1.91), 0.08, "m", "single"),
        band("apex2",            "about", e.get("doubleApex", 2.60), 0.08, "m", "double"),
        band("apex3",            "about", e.get("tripleApex", 3.58), 0.08, "m", "triple"),
        band("chain_break_apex", "about", e.get("singleApex", 1.91), 0.15, "m",
             "a %.2f s pause breaks the chain" % (t.get("tripleWindow", 0.30) + 0.15)),
        band("jump_cut_ratio",   "max",   0.60, 0, "x",    "50 ms tap / full hold"),
        band("longjump_dist",    "min",   6.40, 0, "m",    "crouch+jump at run"),
        band("backflip_apex",    "about", e.get("backflipApex", 3.22), 0.10, "m", ""),
        band("sideflip_apex",    "about", e.get("sideflipApex", 3.00), 0.10, "m", ""),
        band("wallkick_vy",      "about", wk.get("vy", 12.0), 1.00, "m/s", ""),
        band("wallkick_away",    "about", wk.get("away", 7.5), 1.50, "m/s", ""),
        band("dive_dist",        "min",   dive_floor, 0, "m", "dive + belly slide"),
        band("dive_states_ok",   "true",  1, 0, "",       "dive AND slide states"),
        band("pound_hang",       "about", pound.get("hang", 0.20), 0.03, "s", ""),
        band("pound_fall",       "min",   35.0, 0, "m/s", "pound.fall %s" % pound.get("fall", 40)),
        band("poundjump_apex",   "about", e.get("poundjumpApex", 2.88), 0.10, "m", ""),
        band("coyote_early",     "true",  1, 0, "",       "60 ms after the ledge"),
        band("coyote_late",      "false", 0, 0, "",       "140 ms after the ledge"),
        band("buffer",           "true",  1, 0, "",       "80 ms before landing"),
        band("land_keep_ratio",  "min",   0.90, 0, "x",   "speed kept through the landing"),
        band("swim_speed",       "about", swim.get("speed", 4.5), 0.30, "m/s", ""),
    ]


def judge(exp, got):
    if got is None:
        return False, "no measurement"
    k = exp["kind"]
    if k == "about":
        ok = abs(got - exp["target"]) <= exp["tol"]
        return ok, "want %.3f +/- %.3f" % (exp["target"], exp["tol"])
    if k == "max":
        return got <= exp["target"], "want <= %.3f" % exp["target"]
    if k == "min":
        return got >= exp["target"], "want >= %.3f" % exp["target"]
    if k == "true":
        return bool(got), "want YES"
    if k == "false":
        return not bool(got), "want NO"
    return False, "unknown comparison"


def leave_title(pg, timeout=45):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            last = pg.evaluate(STATE_JS)
        except Exception:
            last = None
        if last in ("keep", "playing"):
            return True
        if last == "paused":
            try:
                pg.keyboard.press("Escape")
            except Exception:
                pass
        try:
            pg.evaluate(CLICK_JS)
        except Exception:
            pass
        pg.wait_for_timeout(400)
    return False


def main() -> int:
    ap = argparse.ArgumentParser(description="CRESTBOUND feel check")
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--course", default=None, help="__dev.goto(<courseId>) before measuring")
    ap.add_argument("--json", default=os.path.join(HERE, "feelcheck.json"))
    ap.add_argument("--wait", type=float, default=60.0)
    ap.add_argument("--headless", action="store_true")
    args = ap.parse_args()

    errors = []
    res = {}
    with sync_playwright() as p:
        if args.headless:
            br = launch_headless(p)
        else:
            br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1100, "height": 700})
        pg.on("pageerror", lambda e: errors.append(str(e)))
        try:
            pg.goto(args.url, wait_until="load", timeout=60_000)
        except Exception as e:
            print("NAVIGATION FAILED: %s" % e, file=sys.stderr)
            br.close()
            print("RESULT: FAIL")
            return 2

        deadline = time.time() + args.wait
        ready = False
        while time.time() < deadline:
            try:
                if pg.evaluate("!!(globalThis.CRESTBOUND && CRESTBOUND.game)"):
                    ready = True
                    break
            except Exception:
                pass
            pg.wait_for_timeout(400)
        if not ready:
            print("FEEL CHECK: globalThis.CRESTBOUND never appeared", file=sys.stderr)
            br.close()
            print("RESULT: FAIL")
            return 2

        if not leave_title(pg):
            print("FEEL CHECK: never left the title screen (state=%s)"
                  % pg.evaluate(STATE_JS), file=sys.stderr)
            br.close()
            print("RESULT: FAIL")
            return 2

        if args.course:
            try:
                pg.evaluate("async (id) => { const d = CRESTBOUND.game.__dev;"
                            " if (!d) throw new Error('__dev missing (?dev=1)'); await d.goto(id); }",
                            args.course)
            except Exception as e:
                print("FEEL CHECK: __dev.goto(%s) failed: %s" % (args.course, e), file=sys.stderr)
                br.close()
                print("RESULT: FAIL")
                return 2
            leave_title(pg, timeout=25)

        deadline = time.time() + 40
        while time.time() < deadline:
            try:
                if pg.evaluate("!!(CRESTBOUND.game.player && CRESTBOUND.game.player.__test"
                               " && CRESTBOUND.game.input && CRESTBOUND.game.input.__test"
                               " && CRESTBOUND.game.course)"):
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

    if args.json:
        try:
            with open(args.json, "w", encoding="utf-8") as f:
                json.dump(res, f, indent=2)
        except Exception:
            pass

    if not isinstance(res, dict) or res.get("error"):
        print("FEEL CHECK FAILED: %s" % (res.get("error") if isinstance(res, dict) else res))
        print("RESULT: FAIL")
        return 2

    m = res.get("m", {}) or {}
    reasons = res.get("fail", {}) or {}
    notes = res.get("notes", {}) or {}
    exps = build_expectations(res.get("tune"), res.get("exact"), res.get("diveMax"))

    print("=" * 88)
    print("CRESTBOUND feel check — measured vs the game's own tuning")
    print("water: %s   slab: %s" % (notes.get("water"), notes.get("slab")))
    print("-" * 88)
    print("%-18s %10s  %-24s %-6s %s" % ("measurement", "measured", "expected", "verdict", "note"))
    print("-" * 88)
    fails = 0
    for e in exps:
        got = m.get(e["name"])
        ok, want = judge(e, got)
        fails += 0 if ok else 1
        shown = "-" if got is None else ("%.3f" % got if isinstance(got, (int, float)) else str(got))
        note = notes.get(e["name"]) or e["note"]
        if got is None and e["name"] in reasons:
            note = reasons[e["name"]]
        print("%-18s %10s  %-24s %-6s %s"
              % (e["name"], shown + (" " + e["unit"] if e["unit"] else ""), want,
                 "OK" if ok else "FAIL", str(note)[:44]))
    print("-" * 88)
    if notes.get("chainStates"):
        print("jump chain states: %s" % notes["chainStates"])
    if errors:
        print("page errors during the run:")
        for e in errors[:10]:
            print("  !! %s" % str(e)[:300])
    print("VERDICT: %s (%d failing)" % ("FEEL OK" if fails == 0 else "FEEL FAILS", fails))
    print("RESULT: %s" % ("OK" if fails == 0 else "FAIL"))
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
