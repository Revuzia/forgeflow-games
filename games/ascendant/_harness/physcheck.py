#!/usr/bin/env python
"""ASCENDANT physcheck — the PLAYER PHYSICS EDGE-CASE gate.

feelcheck.py measures the movement contract on flat ground: apex, airtime,
run speed, coyote, buffer. Everything that makes an obby feel UNFAIR lives
somewhere else — on a moving platform, at a seam, under a ceiling, against a
wall — and none of it was measured by anything.

This harness builds a synthetic sandbox 500 m above the hub (its own colliders,
its own movers driven off the SAME clock the player integrates) and asserts the
edge cases one at a time:

  ride_linear      a full period on a ping-pong mover: no drift-off, no sink
  ride_circle      a full period on a spinning circular mover: ditto
  mover_launch     jumping off a mover inherits the documented 70% / 0.25 s
  conveyor         standing on a belt travels at power ONCE (not twice)
  conveyor_jump    jumping off a belt: no double speed, never stuck in it
  ice              authority preserved on ice; drift on release
  step_up          a 0.50 m step is climbed, a 0.70 m wall is not
  seams            10 abutting platforms: no vertical jitter > 2 cm
  snap_on_jump     ground snap never fires on the jump frame (ledge + slope)
  crouch_ceiling   crouch under a low ceiling: no clip, uncrouch blocked
  wall_jump        one wall jump per wall, resets on ground, no infinite climb
  kill_once        falling past killY dies EXACTLY once
  kill_disposed    kill volumes on a dead/inactive stage never fire
  nan_guard        setVel(NaN) and a NaN collider never poison pos
  bounce_apex      a bounce pad's apex == props.power +/- 5%, walk AND run entry

?dev=1 is deliberate here: this is a PHYSICS gate, not an input-lifecycle gate
(that is lifecheck.py, which must run WITHOUT dev). Dev mode only removes the
pointer-lock suspension, which would otherwise stop the sim between scenarios.

    python physcheck.py
    python physcheck.py --only ride_linear,seams
    python physcheck.py --json physcheck.json

Exit 0 only when every scenario passes.
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

SCENARIOS = [
    "ride_linear", "ride_circle", "ride_real_linear", "ride_real_circle", "mover_launch",
    "conveyor", "conveyor_jump", "ice",
    "step_up", "seams", "snap_on_jump",
    "crouch_ceiling", "wall_jump",
    "kill_once", "kill_disposed", "nan_guard", "bounce_apex",
]

CLICK_JS = r"""() => {
  const g = globalThis.ASCENDANT && ASCENDANT.game;
  if (!g || !g.menu || typeof g.menu._act !== 'function') return null;
  try { g.menu._act('play'); return 'act'; } catch (e) { return 'err:' + e.message; }
}"""

# ===========================================================================
#  The sandbox. Installed once; each scenario then runs in its own evaluate so
#  no single call can trip Playwright's default timeout.
# ===========================================================================
SETUP_JS = r"""async () => {
  const A = globalThis.ASCENDANT;
  const G = A && A.game;
  if (!G || !G.player || !G.stage) return {error:'no ASCENDANT.game.player/stage'};
  const THREE = A.THREE, Collider = A.Collider;
  if (!THREE || !Collider) return {error:'ASCENDANT.THREE / ASCENDANT.Collider missing'};

  // Same module instance the game itself loaded (no ?v= on runtime imports).
  let CM, TM;
  try {
    CM = await import('/games/ascendant/runtime/world/collider.js');
    TM = await import('/games/ascendant/runtime/core/tuning.js');
  } catch (e) { return {error:'import failed: ' + e.message}; }
  const KillVolume = CM.KillVolume, TUNE = TM.TUNE;
  if (!KillVolume || !TUNE) return {error:'KillVolume / TUNE missing from module'};

  const UP = new THREE.Vector3(0, 1, 0);
  const BASE = {x: 0, y: 500, z: 900};          // sandbox origin, far from the level
  const FACE_PLUS_X = -Math.PI / 2;             // forward = (-sin yaw, 0, -cos yaw)

  const PH = {
    t: 0, movers: [], reals: [], cols: [], kills: [], meshes: [],
    BASE, FACE_PLUS_X, TUNE, THREE, Collider, KillVolume, UP,
    lastFrameDt: 0,
  };
  window.__PHYS = PH;

  // --- drive our synthetic movers on the player's OWN clock -----------------
  // game.js: stage.update(sdt) runs immediately BEFORE player.update(sdt), so
  // hooking the stage puts our movers exactly where a real hazard would be when
  // the carry probe reads them. Hooking rAF instead would be one frame stale.
  if (!G.stage.__physWrapped) {
    const orig = G.stage.update.bind(G.stage);
    G.stage.update = function (dt, pp) {
      orig(dt, pp);
      const d = (typeof dt === 'number' && isFinite(dt)) ? dt : 0;
      PH.t += d;
      PH.lastFrameDt = d;
      for (let i = 0; i < PH.movers.length; i++) PH.movers[i].tick(PH.t, d);
    };
    G.stage.__physWrapped = true;
  }

  PH.player = () => G.player;
  PH.frame = () => new Promise(r => requestAnimationFrame(r));
  PH.wait = async (ms) => { const t0 = performance.now();
                            while (performance.now() - t0 < ms) await PH.frame(); };

  /* GAME time, not wall time. PH.t sums the same `sdt` the player integrates,
     so a stalled or throttled browser cannot make a carry rate under-read: a
     positional carry is exact per fixed substep, and only the number of
     substeps that actually ran is meaningful. Measuring 5 m/s of belt against
     performance.now() read 4.10 on a slow frame and 5.00 on a fast one. */
  PH.waitGame = async (secs) => {
    const t0 = PH.t, guard = performance.now();
    while (PH.t - t0 < secs && performance.now() - guard < secs * 8000 + 3000) await PH.frame();
    return PH.t - t0;
  };
  /** Mean rate of change of `get()` per second of GAME time. */
  PH.rate = async (get, secs) => {
    const a = get(), t0 = PH.t;
    const dt = await PH.waitGame(secs);
    return dt > 1e-6 ? (get() - a) / dt : null;
  };

  // --- real keyboard events (never poke input state directly) ---------------
  PH.key = (type, code) => {
    window.dispatchEvent(new KeyboardEvent(type, {
      code, key: code === 'Space' ? ' ' : code.replace('Key', '').toLowerCase(),
      bubbles: true, cancelable: true,
    }));
  };
  PH.down = c => PH.key('keydown', c);
  PH.up = c => PH.key('keyup', c);
  /* A FULL-hold jump. A one-frame Space tap latches inp.jumpReleased on the
     very next frame, and the controller's variable-jump cut then multiplies
     vy by TUNE.jumpCut (0.45) — a 0.66 m hop instead of the 2.09 m arc. Every
     scenario that wants a real jump must hold the key. */
  PH.jump = async (holdMs) => {
    PH.down('Space');
    await PH.wait(holdMs === undefined ? 260 : holdMs);
    PH.up('Space');
  };
  PH.allUp = () => ['KeyW','KeyA','KeyS','KeyD','Space','ShiftLeft','ControlLeft']
                     .forEach(c => PH.up(c));

  // --- world building -------------------------------------------------------
  PH.addBox = (cx, cy, cz, hx, hy, hz, opts) => {
    const o = opts || {};
    const col = new Collider({
      center: new THREE.Vector3(cx, cy, cz),
      half: new THREE.Vector3(hx, hy, hz),
      surface: o.surface || 'normal',
      props: o.props || null,
      quat: o.quat || null,
    });
    col.update();
    G.stage.broadphase.add(col);
    G.stage.broadphase.refresh(col);
    PH.cols.push(col);
    return col;
  };

  /**
   * A synthetic mover. `kind`:
   *   'drift'  constant velocity  {vel:[x,y,z]}
   *   'pingpong' sinusoid          {dir:[x,y,z], amp, period}
   *   'circle' orbit + spin about +Y through the origin {radius, period}
   * Publishes exactly the fields Collider.velocityAt reads off `ref`
   * (linVel / angVel / angAxis / angCenter) — the same contract movers.js uses.
   */
  PH.addMover = (o) => {
    const ref = {
      linVel: new THREE.Vector3(),
      angVel: 0,
      angAxis: new THREE.Vector3(0, 1, 0),
      angCenter: new THREE.Vector3(),
    };
    const origin = new THREE.Vector3(o.center[0], o.center[1], o.center[2]);
    const col = new Collider({
      center: origin.clone(),
      half: new THREE.Vector3(o.half[0], o.half[1], o.half[2]),
      surface: o.surface || 'normal',
      props: o.props || null,
      ref,
    });
    col.update();
    G.stage.broadphase.add(col);
    G.stage.broadphase.refresh(col);

    const m = {col, ref, origin, kind: o.kind, o, t0: null, prev: new THREE.Vector3()};
    const posAt = (u, out) => {
      if (o.kind === 'drift') {
        return out.set(origin.x + o.vel[0] * u, origin.y + o.vel[1] * u, origin.z + o.vel[2] * u);
      }
      const w = 2 * Math.PI / o.period, s = Math.sin(w * u);          // pingpong
      return out.set(origin.x + o.dir[0] * o.amp * s,
                     origin.y + o.dir[1] * o.amp * s,
                     origin.z + o.dir[2] * o.amp * s);
    };
    m.tick = (t, dt) => {
      if (m.t0 === null) m.t0 = t;
      const u = t - m.t0;
      const d = (typeof dt === 'number' && dt > 1e-6) ? dt : 0;
      if (o.kind === 'circle') {
        const w = 2 * Math.PI / o.period;
        const a = w * u;
        // Rotation about +Y by `a` sends (R,0,0) -> (R cos a, 0, -R sin a).
        col.center.set(origin.x + Math.cos(a) * o.radius, origin.y, origin.z - Math.sin(a) * o.radius);
        col.quat.setFromAxisAngle(UP, a);
        ref.linVel.set(0, 0, 0);
        ref.angVel = w;
        ref.angAxis.set(0, 1, 0);
        ref.angCenter.copy(origin);
      } else {
        // The contract movers.js publishes: linVel is the MEAN velocity over
        // the frame that just elapsed, (pos(t) - pos(t - dt)) / dt, so a carry
        // of linVel * (this frame's substeps) reproduces the deck's actual
        // displacement. Publishing the instantaneous velocity at t instead is
        // a first-order mismatch (a * dt^2 / 2 per frame) against a deck that
        // moved EXACTLY, and it accumulates to (dt_frame / 2) * delta-v across
        // every acceleration phase: 0.156 m over one period of this very deck
        // at 29 fps, measured before movers.js switched to the mean.
        posAt(u, col.center);
        if (d > 0) {
          posAt(u - d, m.prev);
          ref.linVel.subVectors(col.center, m.prev).multiplyScalar(1 / d);
        } else if (o.kind === 'drift') {
          ref.linVel.set(o.vel[0], o.vel[1], o.vel[2]);
        } else {
          const w = 2 * Math.PI / o.period, c = Math.cos(w * u);
          ref.linVel.set(o.dir[0] * o.amp * w * c, o.dir[1] * o.amp * w * c, o.dir[2] * o.amp * w * c);
        }
        ref.angVel = 0;
      }
      col.update();
      G.stage.broadphase.refresh(col);
    };
    m.tick(PH.t, 0);
    PH.movers.push(m);
    return m;
  };

  /**
   * A REAL mover: built by the stage's own hazard factory (movers.js, through
   * stage._buildHazard) and ticked by stage._updateHazards on the stage clock,
   * exactly like an authored one. The synthetic movers above bypass movers.js
   * entirely, so only this exercises what the game actually publishes as
   * linVel / angVel — and a movers.js fix can only be proven here.
   */
  PH.addRealMover = (def) => {
    const st = G.stage;
    if (typeof st._buildHazard !== 'function' || !Array.isArray(st.hazards)) return null;
    const n0 = st.hazards.length;
    st._buildHazard(def, 90000 + PH.reals.length);
    if (st.hazards.length !== n0 + 1) return null;
    const rec = st.hazards[st.hazards.length - 1];
    try { rec.h.reset(st.clock); } catch (e) {}
    try { rec.h.update(st.clock, 0); } catch (e) {}
    try { if (typeof st._measureHazard === 'function') st._measureHazard(rec); } catch (e) {}
    for (const c of rec.colliders) { c.update(); st.broadphase.refresh(c); }
    const m = {rec, col: rec.colliders[0], hz: rec.h, real: true,
               origin: new THREE.Vector3(def.p[0], def.p[1], def.p[2])};
    PH.reals.push(m);
    return m;
  };

  const _l = new THREE.Vector3(), _l0 = new THREE.Vector3();
  /**
   * Stand still on mover `m` for `secs` of GAME time and measure how well the
   * carry keeps the player glued to the deck. The offset is read in the deck's
   * LOCAL frame (Collider.toLocal), so a spinning deck is judged exactly like a
   * sliding one. `o.period` records the drift at the end of every period;
   * `o.orbit` = {center, radius} adds the radial-from-orbit read that isolates
   * the OUTWARD creep of a tangent-step rotation carry (|r| grows by
   * (w * dt)^2 / 2 every step it is applied, and never comes back).
   */
  PH.ride = async (m, secs, o) => {
    o = o || {};
    const col = m.col;
    const p0 = PH.player();
    col.toLocal(p0.pos, _l0);
    const orb = o.orbit || null;
    const rad0 = orb ? Math.hypot(p0.pos.x - orb.center.x, p0.pos.z - orb.center.z) : 0;
    const out = {max_drift_m: 0, max_sink_m: 0, lost_ground_frames: 0, samples: 0,
                 frame_dt_mean: 0, frame_dt_max: 0, drift_at_period: [], radial_at_period: [],
                 radial_end_m: 0, max_radial_m: 0};
    let sumDt = 0, maxDt = 0, marks = 0, radial = 0, drift = 0;
    const tStart = PH.t;
    while (PH.t - tStart < secs) {
      await PH.frame();
      const pp = PH.player();
      const d = PH.lastFrameDt; sumDt += d; if (d > maxDt) maxDt = d;
      col.toLocal(pp.pos, _l);
      drift = Math.hypot(_l.x - _l0.x, _l.z - _l0.z);
      const sink = (col.center.y + col.half.y) - pp.pos.y;     // >0: feet below the deck top
      if (drift > out.max_drift_m) out.max_drift_m = drift;
      if (sink > out.max_sink_m) out.max_sink_m = sink;
      if (!pp.grounded) out.lost_ground_frames++;
      if (orb) {
        radial = Math.hypot(pp.pos.x - orb.center.x, pp.pos.z - orb.center.z) - rad0;
        if (Math.abs(radial) > Math.abs(out.max_radial_m)) out.max_radial_m = radial;
      }
      if (o.period && PH.t - tStart >= (marks + 1) * o.period) {
        marks++;
        out.drift_at_period.push(+drift.toFixed(4));
        if (orb) out.radial_at_period.push(+radial.toFixed(4));
      }
      out.samples++;
    }
    out.frame_dt_mean = out.samples ? +(sumDt / out.samples).toFixed(4) : 0;
    out.frame_dt_max = +maxDt.toFixed(4);
    out.max_drift_m = +out.max_drift_m.toFixed(4);
    out.max_sink_m = +out.max_sink_m.toFixed(4);
    out.max_radial_m = +out.max_radial_m.toFixed(4);
    out.radial_end_m = +radial.toFixed(4);
    out.drift_end_m = +drift.toFixed(4);
    return out;
  };

  PH.addKill = (opts) => {
    const kv = new KillVolume(opts);
    const list = G.stage.killVolumes || (G.stage.kills) || null;
    if (Array.isArray(list)) { list.push(kv); PH.kills.push({kv, list}); }
    return kv;
  };

  PH.clear = () => {
    PH.allUp();
    for (const c of PH.cols) { try { G.stage.broadphase.remove(c); } catch (e) {} }
    for (const m of PH.movers) { try { G.stage.broadphase.remove(m.col); } catch (e) {} }
    for (const m of PH.reals) {
      const st = G.stage;
      for (const c of m.rec.colliders) {
        try { st.broadphase.remove(c); } catch (e) {}
        const i = st._allColliders.indexOf(c); if (i >= 0) st._allColliders.splice(i, 1);
      }
      for (const k of (m.hz.kills || [])) {
        k.active = false;
        const i = st.killVolumes.indexOf(k); if (i >= 0) st.killVolumes.splice(i, 1);
      }
      const ri = st.hazards.indexOf(m.rec); if (ri >= 0) st.hazards.splice(ri, 1);
      try { if (m.hz.mesh && m.hz.mesh.parent) m.hz.mesh.parent.remove(m.hz.mesh); } catch (e) {}
      try { if (typeof m.hz.dispose === 'function') m.hz.dispose(); } catch (e) {}
    }
    PH.reals.length = 0;
    for (const k of PH.kills) {
      k.kv.active = false;
      const i = k.list.indexOf(k.kv);
      if (i >= 0) k.list.splice(i, 1);
    }
    PH.cols.length = 0; PH.movers.length = 0; PH.kills.length = 0;
    if (G.player) G.player.killYOverride = null;
  };

  /* A death hands control to game._stepDeath, which FREEZES player.update until
     it has respawned at a checkpoint. Every scenario after a death has to wait
     that out or it measures a frozen player. */
  PH.settleDeath = async (maxMs) => {
    const cap = maxMs === undefined ? 4000 : maxMs;
    const t0 = performance.now();
    while (performance.now() - t0 < cap) {
      if (G._deathT < 0 && !G.player.dead) return true;
      await PH.frame();
    }
    return G._deathT < 0 && !G.player.dead;
  };

  PH.tp = async (x, y, z, settleMs) => {
    const p = G.player;
    PH.allUp();
    p.__test.teleport(new THREE.Vector3(x, y, z));
    p.__test.setVel(new THREE.Vector3(0, 0, 0));
    p.yaw = FACE_PLUS_X;
    p.pitch = 0;
    await PH.wait(settleMs === undefined ? 420 : settleMs);
    return G.player;
  };

  /* Wait until the player has been grounded for `frames` consecutive frames.
     A teleport onto a deck doing 7.5 m/s can read ONE airborne frame at the
     500 ms mark (seen once at 4x CPU throttle: grounded_at_start false, then
     0 lost-ground frames for the whole ride) — the ride reads must not start
     on that frame. */
  PH.settleGround = async (maxMs, frames) => {
    const need = frames === undefined ? 3 : frames;
    const cap = maxMs === undefined ? 2500 : maxMs;
    const t0 = performance.now();
    let run = 0;
    while (performance.now() - t0 < cap) {
      await PH.frame();
      run = PH.player().grounded ? run + 1 : 0;
      if (run >= need) return true;
    }
    return false;
  };

  // Disable the void plane for the sandbox (a scenario that wants a void death
  // sets killYOverride itself). It must stay valid for the HUB too: a death
  // respawns the player down there, and a sandbox-relative killY would then
  // kill them on arrival, once per frame, forever.
  PH.noVoid = () => { G.player.killYOverride = -1e6; };

  PH.snap = () => {
    const p = G.player;
    return {x:+p.pos.x.toFixed(4), y:+p.pos.y.toFixed(4), z:+p.pos.z.toFixed(4),
            vx:+p.vel.x.toFixed(3), vy:+p.vel.y.toFixed(3), vz:+p.vel.z.toFixed(3),
            g:!!p.grounded, dead:!!p.dead, crouch:!!p.crouching, surf:p.surface,
            jumps:p.stats.jumps, wallJumps:p.stats.wallJumps, deaths:p.stats.deaths};
  };

  PH.ready = true;
  return {ok: true, state: G.state, base: BASE,
          tune: {stepUp: TUNE.stepUp, height: TUNE.height, radius: TUNE.radius,
                 speedRun: TUNE.speedRun, gravFall: TUNE.gravFall, jumpV: TUNE.jumpV,
                 crouchHeight: TUNE.crouchHeight}};
}"""

# ===========================================================================
#  Scenarios. Each is an independent async function on __PHYS.
# ===========================================================================
RUN_JS = r"""async (name) => {
  const PH = window.__PHYS;
  if (!PH || !PH.ready) return {error:'sandbox not installed'};
  const A = globalThis.ASCENDANT, G = A.game, THREE = PH.THREE, TUNE = PH.TUNE;
  const B = PH.BASE;
  const P = () => G.player;
  const wait = PH.wait, frame = PH.frame;
  const R = {name};

  PH.clear();
  PH.noVoid();
  R.pre_settled = await PH.settleDeath(2500);   // never measure a frozen player

  try {
  switch (name) {

  // =====================================================================
  case 'ride_linear': {
    // A 6 x 0.5 x 6 synthetic deck ping-ponging 4 m along X, period 6 s (peak
    // 4.19 m/s). Stand still on it for TWO full periods and watch the offset
    // from the deck centre and the height above the deck top. The synthetic
    // mover publishes the movers.js contract (frame-mean linVel), so this
    // isolates collide.js's linear carry.
    const per = 6, amp = 4;
    const m = PH.addMover({center:[B.x, B.y, B.z], half:[3, 0.25, 3],
                           kind:'pingpong', dir:[1,0,0], amp, period:per});
    await PH.tp(B.x, B.y + 0.35, B.z, 500);
    R.settled = await PH.settleGround();
    R.grounded_at_start = !!P().grounded;
    Object.assign(R, await PH.ride(m, 2 * per + 0.2, {period: per}));
    R.periods = 2;
    R.peak_platform_speed = +(amp * 2 * Math.PI / per).toFixed(3);
    // What a velocity-at-end-of-frame carry would drift by at this frame rate.
    R.first_order_predict_m = +(R.frame_dt_mean * R.peak_platform_speed).toFixed(4);
    R.dead = !!P().dead;
    break;
  }

  // =====================================================================
  case 'ride_circle': {
    // Synthetic orbit, radius 5, period 8 s -> 3.93 m/s deck speed. The deck
    // also SPINS, so the carry has to include the rotational term — and it has
    // to apply it as a ROTATION: a tangent step (w x r) * dt lengthens |r| by
    // (w dt)^2 / 2 every substep, an outward creep that never comes back.
    // Two periods so the creep has time to show.
    const per = 8, rad = 5;
    const m = PH.addMover({center:[B.x, B.y, B.z], half:[3, 0.25, 3],
                           kind:'circle', radius:rad, period:per});
    await PH.tp(m.col.center.x, B.y + 0.35, m.col.center.z, 500);
    R.settled = await PH.settleGround();
    R.grounded_at_start = !!P().grounded;
    Object.assign(R, await PH.ride(m, 2 * per + 0.2,
                  {period: per, orbit: {center: m.origin, radius: rad}}));
    R.periods = 2;
    R.deck_speed = +(2 * Math.PI / per * rad).toFixed(3);
    // Outward creep a tangent-step carry accumulates over the ride, per substep
    // (w / 120)^2 / 2 relative, 120 substeps a second.
    const w = 2 * Math.PI / per;
    R.tangent_creep_predict_m = +(rad * (2 * per + 0.2) * 120 * Math.pow(w / 120, 2) / 2).toFixed(4);
    R.dead = !!P().dead;
    break;
  }

  // =====================================================================
  case 'ride_real_linear': {
    // spire-2's authored oscillator (runtime/data/stages/spire-2.js:583):
    // 7.6 m of travel at period 3.4 s, sine ease -> 7.02 m/s peak, built by
    // movers.js through the stage's own factory and ticked on the stage clock.
    const per = 3.4;
    const m = PH.addRealMover({kind:'mover', p:[B.x, B.y, B.z], s:[3.6, 1, 3.6], mat:'metal',
                               motion:{type:'oscillate', to:[B.x + 7.6, B.y, B.z],
                                       period:per, phase:0.75, ease:'sine'}});
    if (!m) { R.error = 'stage._buildHazard produced no mover'; break; }
    R.real = true;
    const top = m.col.center.y + m.col.half.y;
    await PH.tp(m.col.center.x, top + 0.10, m.col.center.z, 500);
    R.settled = await PH.settleGround();
    R.grounded_at_start = !!P().grounded;
    R.surface = P().surface;
    Object.assign(R, await PH.ride(m, 2 * per + 0.2, {period: per}));
    R.periods = 2;
    R.peak_platform_speed = +(3.8 * 2 * Math.PI / per).toFixed(3);
    R.first_order_predict_m = +(R.frame_dt_mean * R.peak_platform_speed).toFixed(4);
    R.dead = !!P().dead;
    break;
  }

  // =====================================================================
  case 'ride_real_circle': {
    // spire-3's authored ice carousel (runtime/data/stages/spire-3.js:662):
    // radius 6 m, period 5 s, dir -1 -> 7.54 m/s, w = 1.257 rad/s, on ICE.
    // Ridden for two revolutions standing still.
    const per = 5.0, rad = 6.0;
    const m = PH.addRealMover({kind:'mover', p:[B.x, B.y, B.z], s:[4.4, 0.6, 2.4], mat:'ice',
                               surface:'ice',
                               motion:{type:'circle', radius:rad, axis:'y', period:per,
                                       phase:0.0, dir:-1}});
    if (!m) { R.error = 'stage._buildHazard produced no mover'; break; }
    R.real = true;
    const top = m.col.center.y + m.col.half.y;
    await PH.tp(m.col.center.x, top + 0.10, m.col.center.z, 500);
    R.settled = await PH.settleGround();
    R.grounded_at_start = !!P().grounded;
    R.surface = P().surface;
    Object.assign(R, await PH.ride(m, 2 * per + 0.2,
                  {period: per, orbit: {center: m.origin, radius: rad}}));
    R.periods = 2;
    R.deck_speed = +(2 * Math.PI / per * rad).toFixed(3);
    const w = 2 * Math.PI / per;
    R.tangent_creep_predict_m = +(rad * (2 * per + 0.2) * 120 * Math.pow(w / 120, 2) / 2).toFixed(4);
    R.dead = !!P().dead;
    break;
  }

  // =====================================================================
  case 'mover_launch': {
    // Constant-velocity deck at 5 m/s along +X, deliberately HUGE (40 x 40) so
    // nothing the player does can reach an edge and confuse the measurement.
    // Ride it, then jump straight up with no movement input and measure the
    // horizontal travel the jump inherits over the documented 0.25 s window
    // (controller.js LAUNCH_KEEP = 0.70, LAUNCH_TIME = 0.25).
    const V = 5;
    const m = PH.addMover({center:[B.x - 40, B.y, B.z], half:[20, 0.25, 20],
                           kind:'drift', vel:[V, 0, 0]});
    await PH.tp(m.col.center.x, B.y + 0.35, m.col.center.z, 350);
    R.grounded_at_start = !!P().grounded;
    R.platform_speed = V;

    // How fast does the player travel while merely STANDING on it? Measure as
    // displacement over a window: the carry is applied to POSITION, and the
    // 1/120 s substep aliases against rAF so single-frame rates are noise.
    {
      R.ride_rate = +(await PH.rate(() => P().pos.x, 0.6)).toFixed(3);
      R.ride_ratio = +(R.ride_rate / V).toFixed(3);
      R.ride_offset_m = +(P().pos.x - m.col.center.x).toFixed(4);
      R.ride_vel_x = +P().vel.x.toFixed(3);
    }

    // --- which layer is applying the carry? -------------------------------
    // collide.js carryAndPush() translates the player by the platform velocity
    // AND controller.js step 13 adds platformVel to pos again. Turning the
    // controller's copy off isolates them: if the rate is still V, collide.js
    // alone is correct and the controller's copy is a duplicate.
    const p0 = P();
    p0.applyPlatformCarry = false;
    await wait(200);
    R.ride_rate_collide_only = +(await PH.rate(() => P().pos.x, 0.6)).toFixed(3);
    p0.applyPlatformCarry = true;
    await wait(200);

    // --- the jump -----------------------------------------------------------
    await PH.tp(m.col.center.x, B.y + 0.35, m.col.center.z, 350);
    let started = false, x0 = 0, travel25 = null, velAtLaunch = null;
    const trace = [];
    PH.down('Space'); await frame(); PH.up('Space');
    for (let i = 0; i < 140; i++) {
      await frame();
      const pp = P();
      // GAME time, not wall time: stats.airTime accumulates the same fixed dt
      // the launch ramp is decremented by, so the two can never desync.
      if (!started && !pp.grounded && pp.vel.y > 1) {
        started = true; x0 = pp.pos.x; velAtLaunch = +pp.vel.x.toFixed(3);
      }
      if (started) {
        trace.push({at: +pp.stats.airTime.toFixed(4), lt: +(pp._launchT || 0).toFixed(4),
                    dx: +(pp.pos.x - x0).toFixed(4)});
        if (pp.stats.airTime >= 0.25 || (pp._launchT || 0) <= 0) {
          travel25 = +(pp.pos.x - x0).toFixed(4);
          R.window_airtime = +pp.stats.airTime.toFixed(4);
          break;
        }
      }
    }
    R.left_ground = started;
    R.launch_vel_x = velAtLaunch;
    R.launch_trace = trace.slice(0, 24);
    R.launch_travel_ramp = travel25;
    // controller.js applies _launchV * (_launchT / LAUNCH_TIME) to POSITION — a
    // linear ramp down over 0.25 s. The first rAF sample already lands a few
    // substeps into the ramp, so the expectation is integrated from the
    // _launchT actually observed, not from a nominal 0.25.
    const lt0 = trace.length ? trace[0].lt : null;
    R.launch_lt_first_sample = lt0;
    R.launch_expected = (lt0 !== null && lt0 > 0)
      ? +(0.70 * V * lt0 * lt0 / (2 * 0.25)).toFixed(4) : null;
    R.launch_expected_full = +(0.70 * V * 0.25 / 2).toFixed(4);
    R.dead = !!P().dead;
    break;
  }

  // =====================================================================
  case 'conveyor': {
    // A static belt, dir +X, power 5 m/s. Standing still, the player should
    // travel at EXACTLY power. Twice that means the carry is applied twice.
    const power = 5;
    PH.addBox(B.x, B.y - 0.25, B.z, 30, 0.25, 4,
              {surface:'conveyor', props:{dir:[1,0,0], power}});
    await PH.tp(B.x - 20, B.y + 0.35, B.z, 600);
    R.grounded_at_start = !!P().grounded;
    R.surface = P().surface;
    R.power = power;
    R.travel_rate = +(await PH.rate(() => P().pos.x, 0.7)).toFixed(3);
    R.vel_x = +P().vel.x.toFixed(3);          // velocity must stay ~0: the belt
                                              // moves POSITION, not velocity
    R.grounded_at_end = !!P().grounded;
    R.y_drop = +(P().pos.y - (B.y)).toFixed(4);   // must not sink into the belt
    R.dead = !!P().dead;
    break;
  }

  // =====================================================================
  case 'conveyor_jump': {
    // Jump off the belt. The airborne travel rate must not exceed the belt
    // speed (no double-speed) and the player must actually leave the surface.
    const power = 6;
    PH.addBox(B.x, B.y - 0.25, B.z, 30, 0.25, 4,
              {surface:'conveyor', props:{dir:[1,0,0], power}});
    await PH.tp(B.x - 20, B.y + 0.35, B.z, 600);
    await wait(300);
    let maxRate = 0, left = false, apex = -1e9, airT = 0;
    let prevX = P().pos.x, prevT = performance.now();
    const y0 = P().pos.y;
    PH.down('Space');
    for (let i = 0; i < 150; i++) {
      await frame();
      if (i === 16) PH.up('Space');          // ~260 ms hold = a FULL jump
      const pp = P();
      const nowT = performance.now();
      const dt = (nowT - prevT) / 1000;
      if (dt > 0.004 && !pp.grounded) {
        const r = (pp.pos.x - prevX) / dt;
        if (r > maxRate) maxRate = r;
      }
      if (!pp.grounded) { left = true; airT = pp.stats.airTime; }
      if (pp.pos.y - y0 > apex) apex = pp.pos.y - y0;
      prevX = pp.pos.x; prevT = nowT;
      if (left && pp.grounded && i > 24) break;
    }
    PH.up('Space');
    R.power = power;
    R.left_ground = left;
    R.max_air_rate = +maxRate.toFixed(3);
    R.apex = +apex.toFixed(3);
    R.air_time = +airT.toFixed(3);
    R.regrounded = !!P().grounded;
    R.surface_after = P().surface;
    R.dead = !!P().dead;
    break;
  }

  // =====================================================================
  case 'ice': {
    // Ice must keep AUTHORITY: holding W still reaches near run speed. And on
    // release you keep sliding (friction 1.4 vs 13).
    PH.addBox(B.x, B.y - 0.5, B.z, 60, 0.5, 8, {surface:'ice'});
    await PH.tp(B.x - 40, B.y + 0.35, B.z, 600);
    R.surface = P().surface;
    PH.down('KeyW');
    await wait(2600);
    R.speed_held = +Math.hypot(P().vel.x, P().vel.z).toFixed(3);
    PH.up('KeyW');
    const s0 = Math.hypot(P().vel.x, P().vel.z);
    await wait(600);
    const s1 = Math.hypot(P().vel.x, P().vel.z);
    R.speed_after_release = +s1.toFixed(3);
    R.kept_fraction = s0 > 0.1 ? +(s1 / s0).toFixed(3) : null;
    R.run_speed = TUNE.speedRun;
    R.dead = !!P().dead;
    break;
  }

  // =====================================================================
  case 'step_up': {
    // stepUp = 0.55. A 0.50 m step is mantled; a 0.70 m wall blocks.
    // The step is a PLATEAU (it runs to +X forever), so walking past it can
    // never drop the player back down and the end-state read is honest.
    const out = {};
    for (const h of [0.50, 0.70]) {
      PH.clear(); PH.noVoid();
      PH.addBox(B.x - 15, B.y - 1, B.z, 15, 1, 6);               // approach, top = B.y
      PH.addBox(B.x + 15, B.y + h - 1, B.z, 15, 1, 6);           // plateau, top = B.y + h
      await PH.tp(B.x - 6, B.y + 0.35, B.z, 700);
      const startY = P().pos.y;
      let maxY = startY, hitX = null;
      PH.down('KeyW');
      const t0 = performance.now();
      while (performance.now() - t0 < 2400) {
        await frame();
        const p = P();
        if (p.pos.y > maxY) maxY = p.pos.y;
        if (hitX === null && p.pos.x > B.x - 0.6) hitX = +p.pos.x.toFixed(3);
      }
      PH.up('KeyW');
      await wait(300);
      const p = P();
      out['h' + h.toFixed(2)] = {
        x: +p.pos.x.toFixed(3), y: +p.pos.y.toFixed(3), maxY: +maxY.toFixed(3),
        start_y: +startY.toFixed(3), plateau_y: +(B.y + h).toFixed(3),
        climbed: p.pos.y > B.y + h - 0.05 && p.pos.x > B.x + 1,
        stopped_at: +(p.pos.x - B.x).toFixed(3),
        airborne_at_end: !p.grounded,
      };
    }
    R.step_050 = out['h0.50'];
    R.step_070 = out['h0.70'];
    R.climbed_050 = out['h0.50'].climbed;
    R.climbed_070 = out['h0.70'].climbed;
    R.dead = !!P().dead;
    break;
  }

  // =====================================================================
  case 'seams': {
    // 10 abutting 4 m platforms, tops exactly coplanar. Run the whole run and
    // record the peak deviation of pos.y from the shared plane.
    const N = 10, L = 4;
    for (let i = 0; i < N; i++) {
      PH.addBox(B.x + i * L, B.y - 0.5, B.z, L / 2, 0.5, 6);
    }
    await PH.tp(B.x - 1.0, B.y + 0.35, B.z, 700);
    R.grounded_at_start = !!P().grounded;
    R.y_rest = +P().pos.y.toFixed(5);
    PH.down('KeyW'); PH.down('ShiftLeft');
    let maxDev = 0, minY = 1e9, maxY = -1e9, airFrames = 0, n = 0;
    const worst = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 5000 && P().pos.x < B.x + (N - 1) * L) {
      await frame();
      const pp = P();
      const dev = Math.abs(pp.pos.y - B.y);
      if (dev > maxDev) { maxDev = dev; }
      if (dev > 0.02) worst.push({x:+pp.pos.x.toFixed(2), dy:+(pp.pos.y - B.y).toFixed(4)});
      if (pp.pos.y < minY) minY = pp.pos.y;
      if (pp.pos.y > maxY) maxY = pp.pos.y;
      if (!pp.grounded) airFrames++;
      n++;
    }
    PH.up('KeyW'); PH.up('ShiftLeft');
    R.travelled = +(P().pos.x - (B.x - 1.0)).toFixed(2);
    R.max_dev_m = +maxDev.toFixed(5);
    R.y_min = +minY.toFixed(5);
    R.y_max = +maxY.toFixed(5);
    R.air_frames = airFrames;
    R.frames = n;
    R.worst = worst.slice(0, 12);
    R.dead = !!P().dead;
    break;
  }

  // =====================================================================
  case 'snap_on_jump': {
    // (a) jump from the very edge of a ledge, (b) jump while running down a
    // 25-degree slope. In both, pos.y must rise monotonically off the jump
    // frame — a ground snap firing on that frame reads as a dropped jump.
    const res = {};
    const JV = TUNE.jumpV;
    // --- a: ledge edge --------------------------------------------------
    PH.addBox(B.x, B.y - 1, B.z, 10, 1, 6);       // top = B.y, +X edge at B.x+10
    await PH.tp(B.x + 9.65, B.y + 0.35, B.z, 700);
    res.ledge_grounded = !!P().grounded;
    const yA0 = P().pos.y;
    const jA0 = P().stats.jumps;
    let vyA = -99, dipA = 0, riseA = 0;
    PH.down('Space');
    for (let i = 0; i < 26; i++) {
      await frame();
      const p = P();
      if (i === 16) PH.up('Space');
      if (p.stats.jumps > jA0 && p.vel.y > vyA) vyA = p.vel.y;
      const d = yA0 - p.pos.y; if (d > dipA) dipA = d;
      const u = p.pos.y - yA0; if (u > riseA) riseA = u;
    }
    PH.up('Space');
    res.ledge_dip = +dipA.toFixed(4);
    res.ledge_vy = +vyA.toFixed(3);       // sampled a frame or two after launch,
                                          // so gravity has already taken a bite
    res.ledge_rise = +riseA.toFixed(3);
    res.ledge_jumped = P().stats.jumps > jA0;

    // --- b: 25-degree ramp ----------------------------------------------
    // pos.y falls just from RUNNING down a ramp, so height is measured as the
    // clearance above the ramp plane. A snap firing on the jump frame shows up
    // as clearance going negative and vy being zeroed.
    PH.clear(); PH.noVoid();
    const ang = 25 * Math.PI / 180;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -ang);
    // Rotating a slab about +Z by -25 deg tilts its top so it DESCENDS toward +X.
    const ramp = PH.addBox(B.x, B.y - 1, B.z, 14, 1, 6, {quat: q});
    const rampY = (x) => {
      // top plane of the tilted slab, in world space
      const dx = x - ramp.center.x;
      return ramp.center.y + ramp.half.y / Math.cos(ang) - dx * Math.tan(ang);
    };
    await PH.tp(B.x - 6, B.y + 3, B.z, 1100);      // fall onto the ramp and settle
    res.slope_grounded = !!P().grounded;
    res.slope_ny = +P().groundNormal.y.toFixed(3);
    res.slope_clear_rest = +(P().pos.y - rampY(P().pos.x)).toFixed(4);
    PH.down('KeyW');
    await wait(450);
    const jB0 = P().stats.jumps;
    const clear0 = P().pos.y - rampY(P().pos.x);
    let minClear = 1e9, maxClear = -1e9, vyB = -99;
    PH.down('Space');
    for (let i = 0; i < 26; i++) {
      await frame();
      const p = P();
      if (i === 16) PH.up('Space');
      const c = p.pos.y - rampY(p.pos.x);
      if (c < minClear) minClear = c;
      if (c > maxClear) maxClear = c;
      if (p.stats.jumps > jB0 && p.vel.y > vyB) vyB = p.vel.y;
    }
    PH.up('Space'); PH.up('KeyW');
    res.slope_clear_at_jump = +clear0.toFixed(4);
    res.slope_min_clear = +minClear.toFixed(4);
    res.slope_max_clear = +maxClear.toFixed(4);
    res.slope_vy = +vyB.toFixed(3);
    res.slope_jumped = P().stats.jumps > jB0;
    R.detail = res;
    R.jumpV = JV;
    // A ground snap on the jump frame has two signatures: it ZEROES vy (so the
    // arc is swallowed) and it pulls the feet back DOWN onto the surface. Both
    // are asserted. vy is sampled a frame or two late, so the floor is 0.70*JV
    // (a snapped jump reads ~0, not ~9 — the two populations are far apart).
    R.ledge_ok = res.ledge_grounded && res.ledge_jumped
                 && res.ledge_vy > JV * 0.70 && res.ledge_dip < 0.02
                 && res.ledge_rise > 1.5;
    R.slope_ok = res.slope_grounded && res.slope_jumped
                 && res.slope_vy > JV * 0.70
                 && res.slope_min_clear > clear0 - 0.02
                 && res.slope_max_clear > clear0 + 1.5;
    R.dead = !!P().dead;
    break;
  }

  // =====================================================================
  case 'crouch_ceiling': {
    // Floor at B.y, ceiling slab whose UNDERSIDE is 1.30 m up (below the 1.80 m
    // standing height, above the 1.05 m crouch height).
    const gap = 1.30;
    PH.addBox(B.x, B.y - 1, B.z, 30, 1, 6);                       // floor top = B.y
    PH.addBox(B.x + 8, B.y + gap + 1, B.z, 4, 1, 6);              // slab under = B.y+1.30
    await PH.tp(B.x, B.y + 0.35, B.z, 600);
    PH.down('ControlLeft');
    await wait(350);
    R.crouched = !!P().crouching;
    R.crouch_height = +P().height.toFixed(3);
    PH.down('KeyW');
    await wait(1600);                                             // slide under
    PH.up('KeyW');
    await wait(200);
    R.under_x = +P().pos.x.toFixed(3);
    R.under_ceiling = P().pos.x > B.x + 5 && P().pos.x < B.x + 11;
    // Release crouch UNDER the ceiling: must stay crouched, must not clip.
    PH.up('ControlLeft');
    await wait(500);
    const p = P();
    R.still_crouched = !!p.crouching;
    R.height_after = +p.height.toFixed(3);
    R.head_y = +(p.pos.y + p.height).toFixed(4);
    R.ceiling_y = +(B.y + gap).toFixed(4);
    R.head_clear = (p.pos.y + p.height) <= B.y + gap + 1e-3;
    R.feet_y = +p.pos.y.toFixed(4);
    R.not_pushed_through_floor = p.pos.y > B.y - 0.02;
    // Walk back out and release: must stand up again.
    PH.down('KeyS');
    await wait(1700);
    PH.up('KeyS');
    await wait(500);
    R.out_x = +P().pos.x.toFixed(3);
    R.stood_after_exit = !P().crouching;
    R.height_final = +P().height.toFixed(3);
    R.dead = !!P().dead;
    break;
  }

  // =====================================================================
  case 'wall_jump': {
    // Floor + a 12 m tall wall at x = B.x+3. Run into it, jump, wall-jump,
    // then keep pressing into the SAME wall: only one wall jump may register
    // before touching the ground (no infinite climb).
    // The floor is deliberately huge: a wall jump throws the player 7.4 m/s
    // AWAY from the wall, and a small floor lets them sail off the back and
    // fall forever, which reads as "the wall never re-armed".
    PH.addBox(B.x - 15, B.y - 1, B.z, 18, 1, 14);                 // floor to x = B.x+3
    PH.addBox(B.x + 4.5, B.y + 6, B.z, 1.5, 6, 14);               // wall face at x = B.x+3
    await PH.tp(B.x - 1, B.y + 0.35, B.z, 700);
    const wj0 = P().stats.wallJumps;
    const y0 = P().pos.y;
    // EVENTS, not frame samples. The assertion is "never two wall jumps off
    // the same wall without touching the ground in between" — exactly what
    // _canWallJump() promises — but a landing and a buffered re-jump can both
    // happen inside ONE frame's 2-3 substeps (bufferT is 0.13 s), so `grounded`
    // sampled at rAF never sees the floor and reads a legitimate
    // land -> ground jump -> wall jump as a repeat. The controller emits 'land'
    // on every landing substep and 'jump' with its kind ('ground' | 'coyote' |
    // 'wall'); those are the ground truth.
    const seq = [];
    const onJump = (kind, pos) => seq.push({e: 'jump', k: kind, y: +(pos.y - y0).toFixed(2)});
    const onLand = () => seq.push({e: 'land'});
    P().events.on('jump', onJump);
    P().events.on('land', onLand);
    PH.down('KeyW');
    await wait(400);
    let maxY = P().pos.y, taps = 0;
    for (let i = 0; i < 220; i++) {
      if (i % 10 === 0) { PH.down('Space'); taps++; }
      if (i % 10 === 4) PH.up('Space');
      await frame();
      const p = P();
      if (p.pos.y > maxY) maxY = p.pos.y;
    }
    PH.up('KeyW'); PH.up('Space');
    await wait(200);
    try { P().events.off('jump', onJump); P().events.off('land', onLand); } catch (e) {}
    // back-to-back = a 'wall' jump with no 'land' since the previous 'wall' jump
    let backToBack = 0, landedSince = true, n = 0;
    const evts = [], b2b = [];
    for (const s of seq) {
      if (s.e === 'land') { landedSince = true; continue; }
      if (s.k !== 'wall') continue;
      n++;
      evts.push({n, landed_since: landedSince, y: s.y});
      if (!landedSince) { backToBack++; b2b.push({n, y: s.y}); }
      landedSince = false;
    }
    R.taps = taps;
    R.wall_jumps_total = P().stats.wallJumps - wj0;
    R.wall_jumps_back_to_back = backToBack;
    R.back_to_back_events = b2b;
    R.wall_jump_events = evts.slice(0, 12);
    R.landings = seq.filter((s) => s.e === 'land').length;
    R.sequence = seq.slice(0, 48);
    R.max_climb_m = +(maxY - y0).toFixed(3);
    R.wall_height = 12;
    R.dead = !!P().dead;
    break;
  }

  // =====================================================================
  case 'kill_once': {
    // Fall past killY. `death` must fire exactly once, deaths must tick by 1.
    let deaths = 0;
    const causes = [];
    const fn = (cause) => { deaths++; causes.push(String(cause)); };
    P().events.on('death', fn);
    const d0 = P().stats.deaths;
    P().killYOverride = B.y - 20;
    await PH.tp(B.x, B.y, B.z, 60);
    P().__test.setVel(new THREE.Vector3(0, -40, 0));
    // Restore the void the INSTANT the death registers: game._stepDeath respawns
    // at a hub checkpoint ~500 m lower, and a sandbox-relative killY would kill
    // them again on arrival — a harness artefact, not a game defect.
    let sawDead = false;
    for (let i = 0; i < 240; i++) {
      await frame();
      if (P().dead || G._deathT >= 0) sawDead = true;
      if (deaths > 0) { P().killYOverride = -1e6; break; }
    }
    R.dead_or_dying = sawDead;
    R.pos_y_at_death = +P().pos.y.toFixed(2);
    // The full death sequence + respawn must produce no SECOND death.
    await wait(1600);
    R.death_events = deaths;
    R.death_causes = causes;
    R.deaths_delta = P().stats.deaths - d0;
    try { P().events.off('death', fn); } catch (e) {}
    P().killYOverride = null;
    await PH.settleDeath();
    PH.noVoid();
    break;
  }

  // =====================================================================
  case 'kill_disposed': {
    // A kill volume that has been deactivated (what Stage teardown does) and a
    // kill volume the player's world no longer lists must both be inert.
    const floor = PH.addBox(B.x, B.y - 1, B.z, 10, 1, 6);
    const kv = PH.addKill({type:'box', center:[B.x, B.y + 1, B.z],
                           half:[6, 2, 4], kind:'lava'});
    R.volume_registered = !!kv;
    R.list_len = (G.stage.killVolumes || []).length;
    const d0 = P().stats.deaths;
    await PH.tp(B.x, B.y + 0.35, B.z, 500);
    R.kills_when_active = (P().stats.deaths - d0) >= 1;
    R.cause_when_active = P().deathCause;
    await PH.settleDeath();

    // deactivate, the way stage teardown does
    kv.active = false;
    const d1 = P().stats.deaths;
    await PH.tp(B.x, B.y + 0.35, B.z, 900);
    R.deaths_when_inactive = P().stats.deaths - d1;
    R.dead_when_inactive = !!P().dead;
    await PH.settleDeath();

    // re-arm it but detach it from the world list (what loading a new stage does)
    kv.active = true;
    const idx = (G.stage.killVolumes || []).indexOf(kv);
    if (idx >= 0) G.stage.killVolumes.splice(idx, 1);
    const d2 = P().stats.deaths;
    await PH.tp(B.x, B.y + 0.35, B.z, 900);
    R.deaths_when_detached = P().stats.deaths - d2;
    R.dead_when_detached = !!P().dead;
    kv.active = false;
    await PH.settleDeath();
    break;
  }

  // =====================================================================
  case 'nan_guard': {
    PH.addBox(B.x, B.y - 1, B.z, 20, 1, 8);
    await PH.tp(B.x, B.y + 0.35, B.z, 500);
    // (a) NaN velocity
    P().__test.setVel({x: NaN, y: NaN, z: NaN});
    for (let i = 0; i < 70; i++) await frame();
    const a = P();
    R.a_pos_finite = isFinite(a.pos.x) && isFinite(a.pos.y) && isFinite(a.pos.z);
    R.a_vel_finite = isFinite(a.vel.x) && isFinite(a.vel.y) && isFinite(a.vel.z);
    R.a_pos = {x:+a.pos.x.toFixed(3), y:+a.pos.y.toFixed(3), z:+a.pos.z.toFixed(3)};
    // ...and the player must still be able to MOVE afterwards (not soft-locked)
    const xr = a.pos.x;
    PH.down('KeyW'); await wait(700); PH.up('KeyW');
    R.a_recovered = Math.abs(P().pos.x - xr) > 1.5;
    R.a_moved = +(P().pos.x - xr).toFixed(3);

    // (b) NaN collider next to the player
    await PH.tp(B.x, B.y + 0.35, B.z, 500);
    const bad = PH.addBox(B.x + 1, B.y + 0.5, B.z, 1, 1, 1);
    bad.center.x = NaN; bad.half.y = NaN; bad.update();
    try { G.stage.broadphase.refresh(bad); } catch (e) {}
    const xb = P().pos.x;
    for (let i = 0; i < 70; i++) await frame();
    const b = P();
    R.b_pos_finite = isFinite(b.pos.x) && isFinite(b.pos.y) && isFinite(b.pos.z);
    R.b_vel_finite = isFinite(b.vel.x) && isFinite(b.vel.y) && isFinite(b.vel.z);
    R.b_pos = {x:+b.pos.x.toFixed(3), y:+b.pos.y.toFixed(3), z:+b.pos.z.toFixed(3)};
    PH.down('KeyD'); await wait(700); PH.up('KeyD');
    R.b_recovered = Math.abs(P().pos.z - B.z) > 1.0 || Math.abs(P().pos.x - xb) > 1.0;
    R.b_travel = +Math.hypot(P().pos.x - xb, P().pos.z - B.z).toFixed(3);
    R.dead = !!P().dead;
    break;
  }

  // =====================================================================
  case 'bounce_apex': {
    // props.power is the TARGET APEX IN METRES. Measure it entering at a walk
    // (drop straight on) and at run speed. Jump must NOT be held (that is a
    // deliberate +25% bonus), so nothing is pressed.
    const power = 3.0;
    const res = {};
    for (const mode of ['walk', 'run']) {
      PH.clear(); PH.noVoid();
      // The runway must NOT overlap the pad. Two coplanar colliders make the
      // ground probe pick the one with the bigger footprint, so an overlapping
      // runway silently masks the pad's surface and it never fires.
      PH.addBox(B.x - 15, B.y - 0.5, B.z, 25, 0.5, 6);                   // runway, ends at B.x+10
      PH.addBox(B.x + 12, B.y - 0.5, B.z, 2, 0.5, 6,
                {surface:'bounce', props:{power, dir:[0,1,0]}});         // pad, B.x+10..B.x+14
      // The measurement loop must be RUNNING before the pad is touched: the pad
      // fires on the landing/contact frame, and a settle-then-measure ordering
      // misses the launch entirely.
      let apex = -1e9, launched = false, entrySpeed = 0;
      const y0 = B.y;                                                   // pad top
      if (mode === 'walk') {
        await PH.tp(B.x + 12, B.y + 2.2, B.z, 0);                       // drop onto the pad
      } else {
        await PH.tp(B.x - 6, B.y + 0.35, B.z, 700);
        PH.down('KeyW');
        await wait(1100);                                               // reach run speed
        entrySpeed = Math.hypot(P().vel.x, P().vel.z);
      }
      const t0 = performance.now();
      while (performance.now() - t0 < 4000) {
        await frame();
        const pp = P();
        if (!launched && pp.vel.y > 5 && pp.pos.y < y0 + 1.0) {
          launched = true;
          if (mode === 'run') entrySpeed = Math.hypot(pp.vel.x, pp.vel.z);
        }
        if (launched && pp.pos.y - y0 > apex) apex = pp.pos.y - y0;
        if (launched && pp.vel.y < 0 && pp.pos.y - y0 < apex - 0.3) break;
      }
      PH.up('KeyW');
      res[mode] = {apex: +apex.toFixed(4), launched,
                   err_pct: +(((apex - power) / power) * 100).toFixed(2),
                   entry_speed: +entrySpeed.toFixed(2)};
      await wait(150);
    }
    R.power = power;
    R.walk = res.walk;
    R.run = res.run;
    R.dead = !!P().dead;
    break;
  }

  default:
    return {name, error:'unknown scenario'};
  }
  } catch (e) {
    R.error = e && e.message ? e.message : String(e);
    R.stack = e && e.stack ? String(e.stack).slice(0, 400) : null;
  }

  PH.clear();
  PH.noVoid();
  return R;
}"""


# ===========================================================================
#  Verdicts — one function per scenario, returns (ok, message)
# ===========================================================================
RIDE_DRIFT_MAX = 0.15      # metres off the spot you stood on, over two periods
RIDE_CREEP_MAX = 0.10      # metres of net radial creep from the orbit, over two periods


def _fps(r):
    d = r.get("frame_dt_mean") or 0
    return (1.0 / d) if d > 1e-6 else 0.0


def v_ride_linear(r):
    if not r.get("grounded_at_start"):
        return False, "never landed on the mover"
    bad = []
    if r.get("max_drift_m", 9) > RIDE_DRIFT_MAX:
        bad.append("drift %.3f m > %.2f on a %.2f m/s deck at %.0f fps (per-period %s; a "
                   "velocity-at-frame-end carry predicts %.3f)"
                   % (r["max_drift_m"], RIDE_DRIFT_MAX, r.get("peak_platform_speed", 0), _fps(r),
                      r.get("drift_at_period"), r.get("first_order_predict_m", 0)))
    if r.get("max_sink_m", 9) > 0.03:
        bad.append("sank %.3f m into the deck" % r["max_sink_m"])
    if r.get("lost_ground_frames", 0) > max(3, 0.02 * r.get("samples", 1)):
        bad.append("lost ground on %d/%d frames" % (r["lost_ground_frames"], r.get("samples", 0)))
    if r.get("dead"):
        bad.append("died")
    return (not bad), "; ".join(bad) or ("drift %.3f m over %d periods (%.2f m/s deck, %.0f fps), sink %.3f m"
                                         % (r["max_drift_m"], r.get("periods", 1),
                                            r.get("peak_platform_speed", 0), _fps(r), r["max_sink_m"]))


def v_ride_circle(r):
    if not r.get("grounded_at_start"):
        return False, "never landed on the mover"
    bad = []
    if r.get("max_drift_m", 9) > RIDE_DRIFT_MAX:
        bad.append("drift %.3f m > %.2f on a %.2f m/s deck at %.0f fps (per-period %s)"
                   % (r["max_drift_m"], RIDE_DRIFT_MAX, r.get("deck_speed", 0), _fps(r),
                      r.get("drift_at_period")))
    if abs(r.get("radial_end_m", 9)) > RIDE_CREEP_MAX:
        bad.append("crept %+.3f m radially off the orbit over %d periods (per-period %s; a "
                   "tangent-step carry predicts +%.3f) - the deck slides you off"
                   % (r["radial_end_m"], r.get("periods", 1), r.get("radial_at_period"),
                      r.get("tangent_creep_predict_m", 0)))
    if r.get("max_sink_m", 9) > 0.03:
        bad.append("sank %.3f m" % r["max_sink_m"])
    if r.get("lost_ground_frames", 0) > max(3, 0.05 * r.get("samples", 1)):
        bad.append("lost ground on %d/%d frames" % (r["lost_ground_frames"], r.get("samples", 0)))
    if r.get("dead"):
        bad.append("died")
    return (not bad), "; ".join(bad) or ("drift %.3f m, radial creep %+.3f m over %d periods (%.2f m/s, %.0f fps), sink %.3f m"
                                         % (r["max_drift_m"], r.get("radial_end_m", 0), r.get("periods", 1),
                                            r.get("deck_speed", 0), _fps(r), r["max_sink_m"]))


def v_ride_real_linear(r):
    if r.get("real") is not True:
        return False, "real mover was not built"
    return v_ride_linear(r)


def v_ride_real_circle(r):
    if r.get("real") is not True:
        return False, "real mover was not built"
    if r.get("surface") != "ice":
        return False, "surface read '%s', expected the authored ice" % r.get("surface")
    return v_ride_circle(r)


def v_mover_launch(r):
    V = r.get("platform_speed", 5)
    bad = []
    rid = r.get("ride_rate")
    if rid is None:
        bad.append("no ride measurement")
    elif abs(rid - V) > 0.10 * V:
        bad.append("standing travel %.2f m/s on a %.1f m/s deck (%.2fx; collide-only reads %s)"
                   % (rid, V, r.get("ride_ratio", 0), r.get("ride_rate_collide_only")))
    if abs(r.get("ride_vel_x", 0)) > 0.6:
        bad.append("riding pumped vel.x to %.2f (carry must move position, not velocity)"
                   % r["ride_vel_x"])
    # The invariant that locks the fix in: collide.js owns the ride outright, so
    # turning the controller's own carry block off must change NOTHING.
    co = r.get("ride_rate_collide_only")
    if rid is not None and co is not None and abs(rid - co) > 0.10 * V:
        bad.append("controller adds %.2f m/s on top of collide.js's own carry "
                   "(%.2f with applyPlatformCarry, %.2f without)" % (rid - co, rid, co))
    if not r.get("left_ground"):
        bad.append("never left the ground")
    tv = r.get("launch_travel_ramp")
    want = r.get("launch_expected")
    if tv is None or want is None:
        bad.append("no launch measurement")
    elif abs(tv - want) > 0.20 * max(want, 1e-6):
        bad.append("launch ramp travelled %.3f m, documented 70%%-of-%.1f ramp = %.3f m"
                   % (tv, V, want))
    return (not bad), "; ".join(bad) or ("ride %.2f m/s (%.2fx), launch %.3f m (want %.3f)"
                                         % (rid, r.get("ride_ratio", 0), tv, want))


def v_conveyor(r):
    p = r.get("power", 5)
    bad = []
    if not r.get("grounded_at_start"):
        bad.append("never landed on the belt")
    if r.get("surface") != "conveyor":
        bad.append("surface read '%s'" % r.get("surface"))
    tr = r.get("travel_rate")
    if tr is None:
        bad.append("no travel measurement")
    elif abs(tr - p) > 0.20 * p:
        bad.append("travels %.2f m/s on a %.1f m/s belt (%.2fx)" % (tr, p, tr / p if p else 0))
    if abs(r.get("vel_x", 0)) > 1.0:
        bad.append("belt pumped velocity to %.2f m/s (must move position, not velocity)" % r["vel_x"])
    if abs(r.get("y_drop", 0)) > 0.03:
        bad.append("sank %.3f m into the belt" % -r.get("y_drop", 0))
    return (not bad), "; ".join(bad) or ("%.2f m/s on a %.1f m/s belt" % (tr, p))


def v_conveyor_jump(r):
    p = r.get("power", 6)
    bad = []
    if not r.get("left_ground"):
        bad.append("jump never left the belt (stuck)")
    if r.get("apex", 0) < 1.4:
        bad.append("apex only %.2f m (jump swallowed)" % r.get("apex", 0))
    mr = r.get("max_air_rate", 0)
    if mr > p * 1.35:
        bad.append("airborne travel %.2f m/s vs belt %.1f (double-speed)" % (mr, p))
    return (not bad), "; ".join(bad) or ("apex %.2f m, air rate %.2f m/s (belt %.1f)"
                                         % (r.get("apex", 0), mr, p))


def v_ice(r):
    bad = []
    if r.get("surface") != "ice":
        bad.append("surface read '%s'" % r.get("surface"))
    sh = r.get("speed_held", 0)
    run = r.get("run_speed", 8.6)
    if sh < run * 0.85:
        bad.append("only %.2f m/s holding W on ice (run is %.2f) - authority lost" % (sh, run))
    kf = r.get("kept_fraction")
    if kf is None or kf < 0.30:
        bad.append("kept %s of speed 0.6 s after release - ice is not slippery" % kf)
    return (not bad), "; ".join(bad) or ("held %.2f m/s, kept %.0f%% after release"
                                         % (sh, 100 * (r.get("kept_fraction") or 0)))


def v_step_up(r):
    bad = []
    if not r.get("climbed_050"):
        bad.append("0.50 m step NOT climbed (%s)" % r.get("step_050"))
    if r.get("climbed_070"):
        bad.append("0.70 m wall WAS climbed (stepUp is 0.55)")
    return (not bad), "; ".join(bad) or "0.50 climbed, 0.70 blocked"


def v_seams(r):
    bad = []
    if r.get("travelled", 0) < 30:
        bad.append("only travelled %.1f m of 36" % r.get("travelled", 0))
    if r.get("max_dev_m", 9) > 0.02:
        bad.append("vertical jitter %.4f m > 0.02 at %s" % (r["max_dev_m"], r.get("worst")))
    if r.get("air_frames", 0) > 0.05 * max(1, r.get("frames", 1)):
        bad.append("left the ground on %d/%d frames" % (r["air_frames"], r.get("frames", 0)))
    return (not bad), "; ".join(bad) or ("%.1f m run, peak jitter %.4f m" % (r["travelled"], r["max_dev_m"]))


def v_snap_on_jump(r):
    bad = []
    d = r.get("detail", {})
    if not r.get("ledge_ok"):
        bad.append("ledge-edge jump: %s" % d)
    if not r.get("slope_ok"):
        bad.append("slope jump: %s" % d)
    return (not bad), "; ".join(bad) or (
        "ledge: dip %.4f m, vy %.2f, rise %.2f m | slope: clearance %.3f->%.3f m, vy %.2f"
        % (d.get("ledge_dip", 0), d.get("ledge_vy", 0), d.get("ledge_rise", 0),
           d.get("slope_min_clear", 0), d.get("slope_max_clear", 0), d.get("slope_vy", 0)))


def v_crouch_ceiling(r):
    bad = []
    if not r.get("crouched"):
        bad.append("crouch never engaged")
    if not r.get("under_ceiling"):
        bad.append("never got under the ceiling (x=%s)" % r.get("under_x"))
    if not r.get("still_crouched"):
        bad.append("uncrouched under a %s m ceiling" % r.get("ceiling_y"))
    if not r.get("head_clear"):
        bad.append("head at %s clipped the ceiling at %s" % (r.get("head_y"), r.get("ceiling_y")))
    if not r.get("not_pushed_through_floor"):
        bad.append("pushed through the floor (feet %s)" % r.get("feet_y"))
    if not r.get("stood_after_exit"):
        bad.append("never stood up again after leaving the ceiling")
    return (not bad), "; ".join(bad) or "blocked under, stood after exit"


def v_wall_jump(r):
    bad = []
    n = r.get("wall_jumps_total", 0)
    if n < 2:
        bad.append("only %d wall jump(s) in %d taps - the wall never re-armed on landing"
                   % (n, r.get("taps", 0)))
    if r.get("wall_jumps_back_to_back", 0) > 0:
        bad.append("%d wall jump(s) off the SAME wall with no grounded frame between: %s"
                   % (r["wall_jumps_back_to_back"], r.get("wall_jump_events")))
    if r.get("max_climb_m", 0) > 6.0:
        bad.append("climbed %.2f m off a single wall (infinite wall-climb)" % r["max_climb_m"])
    return (not bad), "; ".join(bad) or ("%d jumps, 0 back-to-back, climb %.2f m"
                                         % (n, r.get("max_climb_m", 0)))


def v_kill_once(r):
    bad = []
    if not r.get("dead_or_dying"):
        bad.append("falling past killY did not kill")
    if r.get("death_events") != 1:
        bad.append("'death' fired %s times" % r.get("death_events"))
    if r.get("deaths_delta") != 1:
        bad.append("stats.deaths moved by %s" % r.get("deaths_delta"))
    return (not bad), "; ".join(bad) or "exactly 1 death"


def v_kill_disposed(r):
    bad = []
    if not r.get("kills_when_active"):
        bad.append("the control volume never killed, so the test proves nothing")
    if r.get("deaths_when_inactive", 1) != 0 or r.get("dead_when_inactive"):
        bad.append("an INACTIVE kill volume still fired")
    if r.get("deaths_when_detached", 1) != 0 or r.get("dead_when_detached"):
        bad.append("a DETACHED kill volume still fired")
    return (not bad), "; ".join(bad) or "inactive + detached volumes inert"


def v_nan_guard(r):
    bad = []
    if not (r.get("a_pos_finite") and r.get("a_vel_finite")):
        bad.append("setVel(NaN) poisoned pos/vel: %s" % r.get("a_pos"))
    if not r.get("a_recovered"):
        bad.append("soft-locked after NaN velocity (moved %s m)" % r.get("a_moved"))
    if not (r.get("b_pos_finite") and r.get("b_vel_finite")):
        bad.append("NaN collider poisoned pos/vel: %s" % r.get("b_pos"))
    if not r.get("b_recovered"):
        bad.append("soft-locked by a NaN collider (moved %s m)" % r.get("b_travel"))
    return (not bad), "; ".join(bad) or "finite + mobile after both NaN sources"


def v_bounce_apex(r):
    power = r.get("power", 3.0)
    bad = []
    for mode in ("walk", "run"):
        d = r.get(mode) or {}
        if not d.get("launched"):
            bad.append("%s entry never launched" % mode)
            continue
        if abs(d.get("err_pct", 99)) > 5.0:
            bad.append("%s apex %.3f m vs power %.2f (%+.1f%%)"
                       % (mode, d.get("apex", 0), power, d.get("err_pct", 0)))
    return (not bad), "; ".join(bad) or ("walk %+.1f%%, run %+.1f%%"
                                         % ((r.get("walk") or {}).get("err_pct", 0),
                                            (r.get("run") or {}).get("err_pct", 0)))


VERDICT = {
    "ride_linear": v_ride_linear, "ride_circle": v_ride_circle,
    "ride_real_linear": v_ride_real_linear, "ride_real_circle": v_ride_real_circle,
    "mover_launch": v_mover_launch, "conveyor": v_conveyor,
    "conveyor_jump": v_conveyor_jump, "ice": v_ice, "step_up": v_step_up,
    "seams": v_seams, "snap_on_jump": v_snap_on_jump,
    "crouch_ceiling": v_crouch_ceiling, "wall_jump": v_wall_jump,
    "kill_once": v_kill_once, "kill_disposed": v_kill_disposed,
    "nan_guard": v_nan_guard, "bounce_apex": v_bounce_apex,
}


def click_play(pg, timeout=45):
    deadline = time.time() + timeout
    while time.time() < deadline:
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


CLEAR_INTRO_JS = r"""async () => {
  const G = globalThis.ASCENDANT.game;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  let guard = 0;
  while (G._introT >= 0 && guard++ < 60) {
    window.dispatchEvent(new KeyboardEvent('keydown', {code:'Space', key:' ', bubbles:true}));
    await frame();
    window.dispatchEvent(new KeyboardEvent('keyup', {code:'Space', key:' ', bubbles:true}));
    const t0 = performance.now();
    while (performance.now() - t0 < 120) await frame();
  }
  return {intro: G._introT < 0, state: G.state};
}"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--json", default=os.path.join(HERE, "physcheck.json"))
    ap.add_argument("--only", default="", help="comma-separated scenario names")
    ap.add_argument("--wait", type=float, default=60.0)
    ap.add_argument("--throttle", type=float, default=1.0,
                    help="CDP CPU throttling rate (e.g. 4 = quarter speed) - lowers the frame "
                         "rate so frame-time-proportional carry errors show clearly")
    args = ap.parse_args()

    want = [s.strip() for s in args.only.split(",") if s.strip()] or SCENARIOS
    unknown = [s for s in want if s not in SCENARIOS]
    if unknown:
        print("unknown scenario(s): %s" % ", ".join(unknown), file=sys.stderr)
        return 2

    errors = []
    results = {}
    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1100, "height": 700})
        pg.set_default_timeout(120_000)
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto(args.url, wait_until="load", timeout=60_000)

        deadline = time.time() + args.wait
        while time.time() < deadline:
            if pg.evaluate("!!(globalThis.ASCENDANT && ASCENDANT.game)"):
                break
            pg.wait_for_timeout(400)

        if not click_play(pg):
            print("PHYS CHECK: never left the title screen", file=sys.stderr)
            br.close()
            return 2

        deadline = time.time() + 40
        while time.time() < deadline:
            try:
                if pg.evaluate("!!(ASCENDANT.game.player && ASCENDANT.game.stage "
                               "&& ASCENDANT.game.player.__test && ASCENDANT.game.stage.broadphase)"):
                    break
            except Exception:
                pass
            pg.wait_for_timeout(400)

        try:
            print("intro: %s" % pg.evaluate(CLEAR_INTRO_JS))
        except Exception as e:
            print("intro clear failed: %s" % e)
        pg.wait_for_timeout(800)

        setup = pg.evaluate(SETUP_JS)
        if not isinstance(setup, dict) or not setup.get("ok"):
            print("PHYS CHECK: sandbox setup failed: %s" % setup, file=sys.stderr)
            br.close()
            return 2
        print("sandbox: %s" % json.dumps(setup))

        if args.throttle and args.throttle > 1.0:
            try:
                cdp = pg.context.new_cdp_session(pg)
                cdp.send("Emulation.setCPUThrottlingRate", {"rate": float(args.throttle)})
                print("cpu throttle: %gx" % args.throttle)
            except Exception as e:
                print("cpu throttle FAILED: %s" % e)

        for name in want:
            t0 = time.time()
            try:
                r = pg.evaluate(RUN_JS, name)
            except Exception as e:
                r = {"name": name, "error": str(e)[:400]}
            r["_secs"] = round(time.time() - t0, 1)
            results[name] = r
            ok, msg = (False, r.get("error") or "no result")
            if "error" not in r and name in VERDICT:
                try:
                    ok, msg = VERDICT[name](r)
                except Exception as e:
                    ok, msg = False, "verdict raised: %s" % e
            print("  %-16s %-5s %s" % (name, "OK" if ok else "FAIL", msg))

        br.close()

    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump({"results": results, "pageErrors": errors[:20]}, f, indent=2)

    print("-" * 74)
    fails = 0
    for name in want:
        r = results.get(name, {})
        if "error" in r:
            print("  %-16s FAIL  %s" % (name, r["error"]))
            fails += 1
            continue
        ok, msg = VERDICT[name](r)
        print("  %-16s %-5s %s" % (name, "OK" if ok else "FAIL", msg))
        if not ok:
            fails += 1
    print("-" * 74)
    if errors:
        print("page errors during run:")
        for e in errors[:10]:
            print("  !! %s" % e[:300])
    print("VERDICT: %s (%d failing of %d)"
          % ("PHYS OK" if fails == 0 else "PHYS FAILS", fails, len(want)))
    return 0 if fails == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
