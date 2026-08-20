// core/sim/player.js [A1] — movement per combat_spec §1 IN FULL: walk/sprint/
// tac-sprint/crouch/jump/SLIDE/MANTLE (R7 ships both), 0.35 s input buffering
// (§1.8), sprint-out per weapon class, fire-to-sprint lockout, coyote time,
// landing penalties, footstep cadence — plus the shared actor weapon state
// machine (§2.2 reload commit, §2.4 ADS, dry-fire/auto-reload, switch) used
// by the player AND bots (combat_spec §5: brains write the input struct;
// movement/weapons run through the player's code paths).
// THREE-free; internal to sim. Frozen export name stepPlayer kept; params
// extended additively with `sim` (the only caller is this lane's sim.js).
//
// DOCUMENTED DEVIATION (see lane report): ground accel is 18.4 m/s², not the
// §1.2 prose "28" — §8.1's frozen probe asserts time-to-walk 0.25 s ± 0.03,
// and 4.6/28 = 0.164 s contradicts it; the probe (Part 5 acceptance) wins.
// Decel stays 34 (counter-strafe crispness).

import { fireShot, dirFromAngles } from "./ballistics.js";
import { spawnGrenade, detonateAt } from "./grenades.js";

export const MOVE = {
  WALK: 4.6, STRAFE_MULT: 0.9, BACK_MULT: 0.76,
  SPRINT: 6.4, TAC: 7.3, CROUCH: 2.4,
  ACCEL: 18.4, DECEL: 34, AIR_ACCEL: 8, AIR_CONTROL: 0.35,
  GRAV: -20, JUMP_V: 6.6, COYOTE_S: 0.08, BUFFER_S: 0.35,
  TAC_MAX_S: 4.0, TAC_RECHARGE_S: 2.5,
  SLIDE_ENTRY: 7.8, SLIDE_MIN_SPEED: 5.8, SLIDE_TAU: 0.55,
  SLIDE_END_V: 2.6, SLIDE_MIN_S: 0.30, SLIDE_COOLDOWN_S: 0.9,
  SLIDE_STEER_RAD_S: 25 * Math.PI / 180, SLIDE_JUMP_KEEP: 0.9,
  SLIDE_ADS_LOCK_S: 0.15,
  MANTLE_LOW: 0.75, MANTLE_HIGH: 1.35, MANTLE_AHEAD: 0.85,
  MANTLE_CLEAR: 0.6, MANTLE_VAULT_S: 0.38, MANTLE_CLAMBER_S: 0.50,
  MANTLE_RAISE_S: 0.15,
  FIRE_SPRINT_LOCK_S: 0.25,
  CAPSULE_R: 0.35, STAND_H: 1.80, CROUCH_H: 1.35,
  EYE_STAND: 1.62, EYE_CROUCH: 1.10, EYE_SLIDE: 0.90,
  LAND_PENALTY_FALL_M: 4.0, LAND_PENALTY_S: 0.4,
  GRENADE_FUSE_S: 3.8, GRENADE_THROW_V: 22,
};

// §1.8 sprint-out per weapon class [normal, tac-sprint]
export const SPRINT_OUT_S = {
  smg: [0.160, 0.240], pistol: [0.130, 0.195],
  ar: [0.210, 0.315], dmr: [0.290, 0.435],
};

export function eyeHeight(stance, sliding) {
  if (sliding) return MOVE.EYE_SLIDE;
  return stance === "crouch" ? MOVE.EYE_CROUCH : MOVE.EYE_STAND;
}

function initM(time) {
  return {
    prev: { jump: false, crouch: false, sprint: false, fire: false, reload: false, interact: false, grenade: false, ads: false },
    buf: { jump: -9, crouch: -9, fire: -9, reload: -9, switch: -9, grenade: -9 },
    bufSwitchTo: null,
    sprintState: "none", tacLeft: MOVE.TAC_MAX_S, lastFwdTapT: -9, sprintExitT: -9, sprintWasTac: false,
    sliding: false, slideT: 0, slideDir: [0, 0], slideV: 0, slideCooldownUntil: -9,
    adsBlockUntil: -9,
    mantle: null, mantleRaiseUntil: -9,
    lastGroundedT: time, fallPeakY: 0, landPenaltyUntil: -9,
    fireToSprintLockUntil: -9, lastShotT: -9, lastMovedT: -9,
    stepPhase: 0,
    cooking: false, grenFuseLeft: 0,
    dryAt: -9, autoReloadAt: 1e9, // sentinel, JSON-safe (never Infinity in state)
  };
}

function hlen(v) { return Math.hypot(v[0], v[2]); }

// ---------------------------------------------------------------- movement
// Frozen stub signature + sim appended. cmd per architecture §3.4 (+grenade,
// amendment v2.1a).
export function stepPlayer(state, cmd, world, weapons, dt, sim) {
  const p = state.player;
  const t = state.time;
  if (!p._m) p._m = initM(t);
  const m = p._m;
  if (!p.alive) { p.speedNorm = 0; return; }

  // aim is authoritative from cmd (input applies recoil kick view-side)
  p.yaw = cmd.yaw || 0;
  p.pitch = Math.max(-1.45, Math.min(1.45, cmd.pitch || 0));

  // ---- edges + §1.8 buffers (ALL verb inputs, 0.35 s)
  const edge = (k) => cmd[k] && !m.prev[k];
  if (edge("jump")) m.buf.jump = t;
  if (edge("crouch")) m.buf.crouch = t;
  if (edge("fire")) m.buf.fire = t;
  if (edge("reload")) m.buf.reload = t;
  if (edge("grenade")) m.buf.grenade = t;
  if (cmd.switchTo && cmd.switchTo !== p.weapon.id) { m.buf.switch = t; m.bufSwitchTo = cmd.switchTo; }
  const buffered = (k) => t - m.buf[k] <= MOVE.BUFFER_S;
  const consume = (k) => { m.buf[k] = -9; };

  const weapon = weapons[p.weapon.id];

  // ---- mantle in progress (§1.5) — locked movement, no fire, buffered fire
  if (m.mantle) {
    const mt = m.mantle;
    mt.t += dt;
    const k = Math.min(1, mt.t / mt.dur);
    const e = k * k * (3 - 2 * k); // ease-in-out
    p.pos[0] = mt.from[0] + (mt.to[0] - mt.from[0]) * e;
    p.pos[1] = mt.from[1] + (mt.to[1] - mt.from[1]) * e;
    p.pos[2] = mt.from[2] + (mt.to[2] - mt.from[2]) * e;
    p.vel[0] = p.vel[1] = p.vel[2] = 0;
    p.grounded = false;
    if (k >= 1) {
      m.mantle = null;
      m.mantleRaiseUntil = t + MOVE.MANTLE_RAISE_S; // weapon raise 150 ms
      p.grounded = true;
      m.lastGroundedT = t;
    }
    p.speedNorm = 0;
    stepPlayerWeaponVerbs(state, cmd, world, weapons, dt, sim, /*mantling*/ true);
    snapshotPrev(m, cmd);
    return;
  }

  // ---- slide entry (§1.4): buffered crouch while sprinting, fast, grounded
  const hspeed0 = hlen(p.vel);
  if (!m.sliding && buffered("crouch") && m.sprintState !== "none" &&
      hspeed0 >= MOVE.SLIDE_MIN_SPEED && p.grounded && t >= m.slideCooldownUntil) {
    consume("crouch");
    m.sliding = true;
    m.slideT = 0;
    const inv = 1 / (hspeed0 || 1);
    m.slideDir = [p.vel[0] * inv, p.vel[2] * inv];
    m.slideV = MOVE.SLIDE_ENTRY;
    m.sprintState = "none";
    m.sprintExitT = t;
  }

  // ---- sprint state machine (§1.1/§1.8)
  const fwdArc = cmd.moveZ > 0.01 && Math.abs(cmd.moveX) <= cmd.moveZ + 0.001;
  // fire held/buffered blocks sprint (fire press during sprint drops it and
  // must not re-enter until the trigger is released — §1.8)
  const wantSprint = !!cmd.sprint && fwdArc && !m.sliding && !cmd.ads &&
    !cmd.fire && !buffered("fire") &&
    t >= m.fireToSprintLockUntil && p.weapon.state !== "switching";
  if (m.sprintState === "none") {
    if (wantSprint && p.grounded) {
      m.sprintState = "sprint";
      m.sprintEnteredT = t;
      cancelReloadIfPreCommit(state, p, sim, weapons);
    }
  } else if (!wantSprint) {
    m.sprintWasTac = m.sprintState === "tac";
    m.sprintState = "none";
    m.sprintExitT = t;
  }
  // tac-sprint: SECOND Shift press while already sprinting, or W double-tap
  // (§1.1) — the press that entered sprint this tick does not count
  if (m.sprintState === "sprint" && t > (m.sprintEnteredT ?? -9) + 0.001) {
    const sprintRepress = edge("sprint");
    const fwdTap = cmd.moveZ > 0.5 && !(m.prev.moveZ > 0.5);
    if (fwdTap) {
      if (t - m.lastFwdTapT <= 0.3 && m.tacLeft > 0.2) m.sprintState = "tac";
      m.lastFwdTapT = t;
    }
    if (sprintRepress && m.tacLeft > 0.2) m.sprintState = "tac";
  }
  if (m.sprintState === "tac") {
    m.tacLeft -= dt;
    if (m.tacLeft <= 0) { m.tacLeft = 0; m.sprintState = "sprint"; }
  } else {
    m.tacLeft = Math.min(MOVE.TAC_MAX_S, m.tacLeft + (MOVE.TAC_MAX_S / MOVE.TAC_RECHARGE_S) * dt);
  }
  // fire press during sprint drops sprint and starts the sprint-out clock
  if (m.sprintState !== "none" && buffered("fire")) {
    m.sprintWasTac = m.sprintState === "tac";
    m.sprintState = "none";
    m.sprintExitT = t;
  }

  // ---- stance
  const wantCrouch = !!cmd.crouch || m.sliding;
  if (wantCrouch) p.stance = "crouch";
  else if (p.stance === "crouch") {
    // headroom check to stand
    if (!world.capsuleBlocked(p.pos[0], p.pos[1], p.pos[2], MOVE.CAPSULE_R, MOVE.STAND_H)) p.stance = "stand";
  }
  const capsuleH = p.stance === "crouch" ? MOVE.CROUCH_H : MOVE.STAND_H;

  // ---- wish velocity
  const f = [-Math.sin(p.yaw), -Math.cos(p.yaw)];
  const r = [-f[1], f[0]];
  let wish = [0, 0];
  {
    const fwdSpd = cmd.moveZ >= 0 ? MOVE.WALK : MOVE.WALK * MOVE.BACK_MULT;
    const strSpd = MOVE.WALK * MOVE.STRAFE_MULT;
    wish[0] = f[0] * cmd.moveZ * fwdSpd + r[0] * cmd.moveX * strSpd;
    wish[1] = f[1] * cmd.moveZ * fwdSpd + r[1] * cmd.moveX * strSpd;
    const wl = Math.hypot(wish[0], wish[1]);
    const cap = Math.max(Math.abs(cmd.moveZ) * fwdSpd, Math.abs(cmd.moveX) * strSpd);
    if (wl > cap && wl > 0) { wish[0] *= cap / wl; wish[1] *= cap / wl; }
    // state speed overrides
    let target = null;
    if (m.sprintState === "tac") target = MOVE.TAC;
    else if (m.sprintState === "sprint") target = MOVE.SPRINT;
    else if (p.stance === "crouch") target = MOVE.CROUCH;
    else if (p.weapon.ads) target = MOVE.WALK * (weapon && weapon.adsMoveMult != null ? weapon.adsMoveMult : 0.6);
    if (target != null && wl > 0.01) {
      const dirx = m.sprintState !== "none" ? f[0] : wish[0] / wl;
      const dirz = m.sprintState !== "none" ? f[1] : wish[1] / wl;
      wish[0] = dirx * target; wish[1] = dirz * target;
    }
  }

  // ---- slide physics (§1.4) or ground/air accel (§1.2)
  if (m.sliding) {
    m.slideT += dt;
    // steering ≤ 25°/s toward input direction
    const wl = Math.hypot(wish[0], wish[1]);
    if (wl > 0.05) {
      const cur = Math.atan2(m.slideDir[1], m.slideDir[0]);
      const des = Math.atan2(wish[1] / wl, wish[0] / wl);
      let dA = des - cur;
      while (dA > Math.PI) dA -= 2 * Math.PI;
      while (dA < -Math.PI) dA += 2 * Math.PI;
      const step = Math.max(-MOVE.SLIDE_STEER_RAD_S * dt, Math.min(MOVE.SLIDE_STEER_RAD_S * dt, dA));
      const na = cur + step;
      m.slideDir = [Math.cos(na), Math.sin(na)];
    }
    m.slideV *= Math.exp(-dt / MOVE.SLIDE_TAU);
    p.vel[0] = m.slideDir[0] * m.slideV;
    p.vel[2] = m.slideDir[1] * m.slideV;
    // slide-jump keeps 90% of horizontal velocity (§1.4)
    if (buffered("jump") && p.grounded) {
      consume("jump");
      const keep = m.slideV * MOVE.SLIDE_JUMP_KEEP;
      p.vel[0] = m.slideDir[0] * keep;
      p.vel[2] = m.slideDir[1] * keep;
      p.vel[1] = MOVE.JUMP_V;
      endSlide(m, t);
    } else if ((m.slideV <= MOVE.SLIDE_END_V && m.slideT >= MOVE.SLIDE_MIN_S) ||
               (!cmd.crouch && m.slideT >= MOVE.SLIDE_MIN_S)) {
      endSlide(m, t);
    }
  } else if (p.grounded) {
    const cur = [p.vel[0], p.vel[2]];
    const dvx = wish[0] - cur[0], dvz = wish[1] - cur[1];
    const dl = Math.hypot(dvx, dvz);
    if (dl > 1e-6) {
      const speeding = Math.hypot(wish[0], wish[1]) > Math.hypot(cur[0], cur[1]) + 0.01;
      const a = speeding ? MOVE.ACCEL : MOVE.DECEL;
      const step = Math.min(dl, a * dt);
      p.vel[0] += (dvx / dl) * step;
      p.vel[2] += (dvz / dl) * step;
    }
  } else {
    // air: 8 m/s² steering at control 0.35, never exceed entry speed (§1.2)
    const wl = Math.hypot(wish[0], wish[1]);
    if (wl > 0.05) {
      // steering only: 8 m/s² × 0.35 control factor, capped at entry speed
      p.vel[0] += (wish[0] / wl) * MOVE.AIR_ACCEL * MOVE.AIR_CONTROL * dt;
      p.vel[2] += (wish[1] / wl) * MOVE.AIR_ACCEL * MOVE.AIR_CONTROL * dt;
      const hs = hlen(p.vel);
      const cap = Math.max(m.airEntrySpeed || MOVE.WALK, 0.1);
      if (hs > cap) { p.vel[0] *= cap / hs; p.vel[2] *= cap / hs; }
    }
  }

  // ---- jump (buffered, coyote 80 ms)
  if (!m.sliding && buffered("jump") &&
      (p.grounded || t - m.lastGroundedT <= MOVE.COYOTE_S) && p.vel[1] <= 0.01) {
    consume("jump");
    p.vel[1] = MOVE.JUMP_V;
    p.grounded = false;
    m.airEntrySpeed = Math.max(hlen(p.vel), MOVE.WALK);
  }

  // ---- mantle detect (§1.5): buffered/held jump at a wall, or airborne
  // toward the ledge. Same collider set the bullets use (world).
  if (!m.sliding && !m.mantle && (buffered("jump") || (!p.grounded && cmd.moveZ > 0.3))) {
    const probeO = [p.pos[0], p.pos[1] + 0.6, p.pos[2]];
    const fh = [f[0], 0, f[1]];
    const hit = world.raycast(probeO, fh, MOVE.MANTLE_AHEAD + MOVE.CAPSULE_R);
    if (hit && hit.box) {
      const top = hit.box.max[1];
      const rel = top - p.pos[1];
      if (rel >= MOVE.MANTLE_LOW && rel <= MOVE.MANTLE_HIGH) {
        const lx = hit.pos[0] + fh[0] * (MOVE.CAPSULE_R + 0.15);
        const lz = hit.pos[2] + fh[2] * (MOVE.CAPSULE_R + 0.15);
        const clear = !world.capsuleBlocked(lx, top, lz, MOVE.CAPSULE_R, MOVE.MANTLE_CLEAR + 0.5);
        if (clear) {
          consume("jump");
          m.mantle = {
            t: 0,
            dur: rel <= 1.0 ? MOVE.MANTLE_VAULT_S : MOVE.MANTLE_CLAMBER_S,
            from: p.pos.slice(),
            to: [lx, top, lz],
          };
          p.vel[0] = p.vel[1] = p.vel[2] = 0;
          m.sprintState = "none";
          snapshotPrev(m, cmd);
          return;
        }
      }
    }
  }

  // ---- gravity + integrate
  const wasGrounded = p.grounded;
  if (!p.grounded) m.fallPeakY = Math.max(m.fallPeakY, p.pos[1]);
  else { m.fallPeakY = p.pos[1]; m.airEntrySpeed = Math.max(hlen(p.vel), MOVE.WALK); }
  p.vel[1] += MOVE.GRAV * dt;
  const res = world.moveCapsule(p.pos, p.vel, dt, MOVE.CAPSULE_R, capsuleH);
  p.pos = res.pos;
  p.vel = res.vel;
  p.grounded = res.grounded;
  if (p.grounded) m.lastGroundedT = t;

  // landing (§1.7)
  if (!wasGrounded && p.grounded) {
    const fallH = Math.max(0, m.fallPeakY - p.pos[1]);
    if (fallH > 0.4) sim.emit("land", { who: "P", height: fallH });
    if (fallH >= MOVE.LAND_PENALTY_FALL_M) m.landPenaltyUntil = t + MOVE.LAND_PENALTY_S;
    m.fallPeakY = p.pos[1];
  }

  // ---- footsteps (§7.4 cadence; audio keys on surface vocabulary)
  const hspeed = hlen(p.vel);
  if (p.grounded && hspeed > 0.8 && !m.sliding) {
    const hz = m.sprintState !== "none" ? 2.6 : p.stance === "crouch" ? 1.2 : 1.85;
    m.stepPhase += hz * dt;
    if (m.stepPhase >= 1) {
      m.stepPhase -= 1;
      const groundHit = world.raycast([p.pos[0], p.pos[1] + 0.3, p.pos[2]], [0, -1, 0], 1.0);
      sim.emit("step", { who: "P", surface: groundHit ? groundHit.surface : "concrete", sprint: m.sprintState !== "none" });
    }
  } else m.stepPhase = 0.7; // primed so the first step lands quickly

  if (hspeed > 0.5 || !p.grounded) m.lastMovedT = t;
  p.speedNorm = Math.min(1, hspeed / MOVE.SPRINT);

  // ---- weapon verbs + grenade
  stepPlayerWeaponVerbs(state, cmd, world, weapons, dt, sim, false);

  snapshotPrev(m, cmd);
}

function snapshotPrev(m, cmd) {
  m.prev.jump = !!cmd.jump; m.prev.crouch = !!cmd.crouch; m.prev.sprint = !!cmd.sprint;
  m.prev.fire = !!cmd.fire; m.prev.reload = !!cmd.reload; m.prev.interact = !!cmd.interact;
  m.prev.grenade = !!cmd.grenade; m.prev.ads = !!cmd.ads; m.prev.moveZ = cmd.moveZ || 0;
}

function endSlide(m, t) {
  m.sliding = false;
  m.slideCooldownUntil = t + MOVE.SLIDE_COOLDOWN_S;   // on ANY slide end
  m.adsBlockUntil = t + MOVE.SLIDE_ADS_LOCK_S;        // no ADS 0.15 s after
}

function cancelReloadIfPreCommit(state, actor, sim, weapons) {
  const w = actor.weapon;
  if (w.state === "reloading" && !w._reloadCommitted) {
    w.state = "idle";
    w.stateT = 0;
    sim.emit("reload", { who: actor === state.player ? "P" : actor.id, weaponId: w.id, phase: "done", duration: 0, canceled: true });
  }
}

// ---------------------------------------------------------------- weapons
// Player wrapper: buffers + grenade cook, then the shared machine.
function stepPlayerWeaponVerbs(state, cmd, world, weapons, dt, sim, mantling) {
  const p = state.player;
  const m = p._m;
  const t = state.time;

  // grenade (R6/§5.9): press = pin (cook starts), release = throw
  if (m.cooking) {
    m.grenFuseLeft -= dt;
    if (m.grenFuseLeft <= 0) {
      m.cooking = false;
      detonateAt(sim, "P", [p.pos[0], p.pos[1] + 1.0, p.pos[2]]); // cooked too long
    } else if (!cmd.grenade) {
      m.cooking = false;
      const eyeY = p.pos[1] + eyeHeight(p.stance, m.sliding);
      const d = dirFromAngles(p.yaw, Math.min(1.2, p.pitch + 0.12)); // slight loft
      spawnGrenade(sim, "P", [p.pos[0], p.pos[1] + eyeHeight(p.stance, m.sliding) - 0.15, p.pos[2]],
        [d[0] * MOVE.GRENADE_THROW_V, d[1] * MOVE.GRENADE_THROW_V, d[2] * MOVE.GRENADE_THROW_V],
        m.grenFuseLeft);
      void eyeY;
    }
  } else if (t - m.buf.grenade <= MOVE.BUFFER_S && (p.grenades || 0) > 0 && !mantling) {
    m.buf.grenade = -9;
    m.cooking = true;
    m.grenFuseLeft = MOVE.GRENADE_FUSE_S;
    p.grenades--;
  }

  stepActorWeapon(sim, "P", {
    fireHeld: !!cmd.fire,
    fireBufferedT: m.buf.fire,
    reloadBufferedT: m.buf.reload,
    switchBufferedT: m.buf.switch,
    switchTo: m.bufSwitchTo,
    ads: !!cmd.ads,
    consumeFire: () => { m.buf.fire = -9; },
    consumeReload: () => { m.buf.reload = -9; },
    consumeSwitch: () => { m.buf.switch = -9; m.bufSwitchTo = null; },
    mantling,
    sprintState: m.sprintState,
    sprintExitT: m.sprintExitT,
    sprintWasTac: m.sprintWasTac,
    mantleRaiseUntil: m.mantleRaiseUntil,
    adsBlockUntil: m.adsBlockUntil,
    sliding: m.sliding,
  }, dt);
}

// The SHARED weapon state machine (player + bots). vc = verb context.
export function stepActorWeapon(sim, who, vc, dt) {
  const state = sim.state;
  const t = state.time;
  const isP = who === "P";
  const actor = isP ? state.player : state.bots.find((b) => b.id === who);
  if (!actor || (isP ? !actor.alive : !actor.alive)) return;
  const w = actor.weapon;
  const weapons = sim.weapons;
  const weapon = weapons[w.id];
  if (!weapon) return;
  const m = isP ? state.player._m : null;

  w.stateT = (w.stateT || 0) + dt;

  // ---- ADS (§2.4): blocked while sprinting / mantling / sliding-lock / reload
  const adsBlocked = (vc.sprintState && vc.sprintState !== "none") || vc.mantling ||
    t < (vc.adsBlockUntil ?? -9) || w.state === "reloading" || w.state === "switching" || vc.sliding;
  const adsDesire = !!vc.ads && !adsBlocked;
  if (adsDesire !== w.ads) {
    w.ads = adsDesire;
    if (isP) sim.emit("ads", { on: adsDesire });
  }
  const adsRate = dt / Math.max(0.01, weapon.adsTime);
  w.adsT = Math.max(0, Math.min(1, (w.adsT || 0) + (w.ads ? adsRate : -adsRate)));

  // ---- switch (§2.1 raise/holster via data switchS)
  if (w.state === "switching") {
    if (w.stateT >= (w._switchDur || 0.5)) {
      const to = w._switchTo;
      commitSlotAmmo(actor, w);
      w.id = to;
      const na = actor._slotAmmo && actor._slotAmmo[to];
      w.mag = na ? na.mag : (weapons[to] ? weapons[to].mag : 0);
      w.reserve = na ? na.reserve : (weapons[to] ? weapons[to].reserve : 0);
      w.state = "idle";
      w.stateT = 0;
      w.recoilIndex = 0;
      w._shotCount = 0;
    }
  } else if (vc.switchBufferedT != null && t - vc.switchBufferedT <= MOVE.BUFFER_S && vc.switchTo &&
             vc.switchTo !== w.id && (isP ? (actor.slots || []).indexOf(vc.switchTo) >= 0 : true) &&
             weapons[vc.switchTo]) {
    vc.consumeSwitch && vc.consumeSwitch();
    cancelReloadForSwitch(sim, who, actor, w);
    const to = vc.switchTo;
    w.state = "switching";
    w.stateT = 0;
    w._switchTo = to;
    w._switchDur = weapons[to].switchS || 0.6;
    if (isP) sim.emit("switch", { who: "P", from: w.id, to });
  }

  // ---- reload (§2.2): tactical vs empty, 65% commit, cancel semantics
  if (w.state === "reloading") {
    const dur = w._reloadDur || weapon.reloadS;
    if (!w._reloadCommitted && w.stateT >= dur * 0.65) {
      const magSize = weapon.mag;
      const take = Math.min(magSize - w.mag, w.reserve);
      w.mag += take;
      w.reserve -= take;
      w._reloadCommitted = true;
      commitSlotAmmo(actor, w);
    }
    if (w.stateT >= dur) {
      w.state = "idle";
      w.stateT = 0;
      sim.emit("reload", { who, weaponId: w.id, phase: "done", duration: w._reloadDur });
    }
  } else if (w.state !== "switching" &&
             ((vc.reloadBufferedT != null && t - vc.reloadBufferedT <= MOVE.BUFFER_S) ||
              (t >= (isP && m ? m.autoReloadAt : (w._autoReloadAt ?? 1e9)) && w.mag === 0))) {
    if (w.mag < weapon.mag && w.reserve > 0) {
      vc.consumeReload && vc.consumeReload();
      if (isP && m) m.autoReloadAt = 1e9; else w._autoReloadAt = 1e9;
      const empty = w.mag === 0;
      w.state = "reloading";
      w.stateT = 0;
      w._reloadDur = empty ? weapon.reloadEmptyS : weapon.reloadS;
      w._reloadCommitted = false;
      w._preReloadMag = w.mag;
      sim.emit("reload", { who, weaponId: w.id, phase: "start", duration: w._reloadDur, empty });
    } else if (vc.reloadBufferedT != null && t - vc.reloadBufferedT <= MOVE.BUFFER_S) {
      vc.consumeReload && vc.consumeReload();
    }
  }
  // sprint/slide cancel pre-commit reload
  if (w.state === "reloading" && !w._reloadCommitted &&
      ((vc.sprintState && vc.sprintState !== "none") || vc.sliding)) {
    w.state = "idle";
    w.stateT = 0;
    sim.emit("reload", { who, weaponId: w.id, phase: "done", duration: 0, canceled: true });
  }

  // ---- fire (§1.8 buffering, §2.1 rpm, sprint-out per class)
  const interval = 60 / weapon.rpm;
  const sinceShot = t - (w.lastShotT ?? -9);
  const sprintOutRow = SPRINT_OUT_S[weapon.class] || SPRINT_OUT_S.ar;
  const sprintOut = sprintOutRow[vc.sprintWasTac ? 1 : 0];
  const sprintReady = (vc.sprintState == null || vc.sprintState === "none") &&
    (vc.sprintExitT == null || t - vc.sprintExitT >= sprintOut);
  const raiseReady = t >= (vc.mantleRaiseUntil ?? -9);
  const canFire = !vc.mantling && sprintReady && raiseReady &&
    w.state !== "reloading" && w.state !== "switching" &&
    sinceShot >= interval - 1e-9;

  let wantsShot = false;
  if (weapon.auto) {
    wantsShot = vc.fireHeld || (vc.fireBufferedT != null && t - vc.fireBufferedT <= MOVE.BUFFER_S);
  } else {
    wantsShot = vc.fireBufferedT != null && t - vc.fireBufferedT <= MOVE.BUFFER_S;
  }

  if (wantsShot && canFire) {
    if (w.mag <= 0) {
      vc.consumeFire && vc.consumeFire();
      sim.emit("empty", { who, weaponId: w.id });
      // §2.2 dry click 0.25 s then auto-reload
      if (w.reserve > 0) {
        if (isP && m) m.autoReloadAt = t + 0.25;
        else w._autoReloadAt = t + 0.25;
      }
      w.lastShotT = t; // dry click paces itself at the trigger rate
    } else {
      // buffer is consumed by the shot it releases; held auto continues via
      // fireHeld (a TAP of an auto weapon fires exactly one round)
      vc.consumeFire && vc.consumeFire();
      if (sinceShot >= 0.5) { w.recoilIndex = 0; } // new burst (§2.8 boundary)
      const sliding = isP && m ? m.sliding : false;
      const stance = actor.stance;
      const origin = [
        actor.pos[0],
        actor.pos[1] + eyeHeight(stance, sliding),
        actor.pos[2],
      ];
      const pitch = isP ? actor.pitch : (actor.cmd ? actor.cmd.pitch || 0 : 0);
      const yaw = isP ? actor.yaw : actor.yaw;
      const dir = dirFromAngles(yaw, pitch);
      w.mag--;
      w.state = "firing";
      w.stateT = 0;
      fireShot(sim, who, weapon, origin, dir, sim.rng.spread);
      w.lastShotT = t;
      w.recoilIndex = (w.recoilIndex || 0) + 1;
      if (isP && m) {
        m.fireToSprintLockUntil = t + MOVE.FIRE_SPRINT_LOCK_S;
        m.lastShotT = t;
      }
      commitSlotAmmo(actor, w);
    }
  }

  if (w.state === "firing" && sinceShot > Math.max(0.1, interval)) {
    w.state = "idle";
    w.stateT = 0;
  }
}

function cancelReloadForSwitch(sim, who, actor, w) {
  if (w.state === "reloading" && !w._reloadCommitted) {
    w.state = "idle";
    w.stateT = 0;
    sim.emit("reload", { who, weaponId: w.id, phase: "done", duration: 0, canceled: true });
  }
}

function commitSlotAmmo(actor, w) {
  if (!actor._slotAmmo) actor._slotAmmo = {};
  actor._slotAmmo[w.id] = { mag: w.mag, reserve: w.reserve };
}

// ---------------------------------------------------------------- bots
// Bot locomotion — same constants/code family as the player (combat_spec §5:
// brains write the input struct only). bot.cmd = {moveX, moveZ, yaw, pitch,
// sprint, crouch, fire, ads, reload, switchTo} — written by A5's aiStep.
export function stepBotLocomotion(sim, bot, dt) {
  const world = sim.world;
  const cmd = bot.cmd || {};
  bot.yaw = cmd.yaw != null ? cmd.yaw : bot.yaw;
  bot.stance = cmd.crouch ? "crouch" : "stand";
  if (!bot.vel) bot.vel = [0, 0, 0];

  const f = [-Math.sin(bot.yaw), -Math.cos(bot.yaw)];
  const r = [-f[1], f[0]];
  const target = cmd.crouch ? MOVE.CROUCH : cmd.sprint ? MOVE.SPRINT : MOVE.WALK;
  let wx = f[0] * (cmd.moveZ || 0) + r[0] * (cmd.moveX || 0);
  let wz = f[1] * (cmd.moveZ || 0) + r[1] * (cmd.moveX || 0);
  const wl = Math.hypot(wx, wz);
  if (wl > 0.01) { wx = (wx / wl) * target; wz = (wz / wl) * target; }
  else { wx = 0; wz = 0; }

  const dvx = wx - bot.vel[0], dvz = wz - bot.vel[2];
  const dl = Math.hypot(dvx, dvz);
  if (dl > 1e-6) {
    const speeding = Math.hypot(wx, wz) > Math.hypot(bot.vel[0], bot.vel[2]) + 0.01;
    const a = speeding ? MOVE.ACCEL : MOVE.DECEL;
    const step = Math.min(dl, a * dt);
    bot.vel[0] += (dvx / dl) * step;
    bot.vel[2] += (dvz / dl) * step;
  }
  bot.vel[1] += MOVE.GRAV * dt;
  const h = bot.stance === "crouch" ? MOVE.CROUCH_H : MOVE.STAND_H;
  const res = world.moveCapsule(bot.pos, bot.vel, dt, MOVE.CAPSULE_R, h);
  bot.pos = res.pos;
  bot.vel = res.vel;
  bot.grounded = res.grounded;

  // footsteps for audible bots (§5.2 hearing uses these too, via A5)
  if (!bot._stepPhase) bot._stepPhase = 0;
  const hspeed = Math.hypot(bot.vel[0], bot.vel[2]);
  if (res.grounded && hspeed > 0.8) {
    const hz = cmd.sprint ? 2.6 : bot.stance === "crouch" ? 1.2 : 1.85;
    bot._stepPhase += hz * dt;
    if (bot._stepPhase >= 1) {
      bot._stepPhase -= 1;
      sim.emit("step", { who: bot.id, surface: "concrete", sprint: !!cmd.sprint });
    }
  }
}
