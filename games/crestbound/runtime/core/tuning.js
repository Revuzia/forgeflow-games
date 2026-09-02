/**
 * CRESTBOUND — runtime/core/tuning.js
 * ---------------------------------------------------------------------------
 * SOURCE OF TRUTH for every movement number in the game. CONTRACT §0.
 *
 * Nothing in here may be duplicated elsewhere: the controller, the camera, the
 * hazards, the hero animator and the course reach-validator all read this file
 * so "what the designer authored" and "what the player can actually do" never
 * drift apart.
 *
 * Pure data + pure functions. No three.js import (this file runs under Node in
 * the validators). Units: metres, seconds, m/s, m/s². +Y is up.
 */

/* ===========================================================================
 * 0. Global tuning — CONTRACT §0 (verbatim)
 * ======================================================================== */

export const TUNE = {
  // --- body ---
  radius: 0.38, height: 1.5, crouchHeight: 0.95, stepUp: 0.45,
  // --- gravity (asymmetric: rise slow, fall fast — kills float) ---
  gravRise: 34, gravFall: 46, gravPoundFall: 0,
  terminal: 60,
  // --- analog ground movement ---
  speedWalk: 3.2,
  speedRun: 9.0,
  accelGround: 42,
  decelGround: 64,
  turnRateSlow: 14,
  turnRateFast: 4.2,
  reverseSnapDot: -0.55,
  // --- air ---
  accelAir: 22, airTurnRate: 3.0, airDrag: 0.12,
  airSpeedCapBonus: 1.5,
  // --- jump family ---
  jumpV: [11.4, 13.3, 15.6],
  jumpCut: 0.5,
  jumpHoldMin: 0.06,
  tripleWindow: 0.30,
  tripleMinSpeed: 4.0,
  coyote: 0.09, buffer: 0.11,
  landLag: 0.05, hardLandLag: 0.20, hardLandSpeed: 22,
  longJump: { vy: 8.5, fwd: 17.0, minSpeed: 5.5 },
  backflip: { vy: 14.8, back: 4.0 },
  sideflip: { vy: 14.3, lateral: 5.0, reverseDot: -0.6 },
  wallKick: { vy: 12.0, away: 7.5, window: 0.15, lockout: 0.28, minFall: -1.0 },
  dive: { fwd: 13.5, vy: 4.5, minSpeed: 3.0, slideFriction: 6.0, slideMinTime: 0.18, hopV: 8.0 },
  pound: { hang: 0.20, fall: 40, shockRadius: 2.2, bounceV: 14.0, jumpWindow: 0.15 },
  slope: { slideDeg: 38, iceSlideDeg: 20, accel: 22, maxSpeed: 16, recoverJumpV: 10.5 },
  swim: { speed: 4.5, accel: 8, rise: 3.2, sink: 1.2, surfaceJumpV: 9.0, drag: 2.2, diveV: 6.0 },
  climb: { speed: 2.6, kickV: [7.0, 11.0], radius: 0.55 },
  ice: { accel: 9, friction: 1.6 },
  conveyorMax: 8.0,
  bounceDefaultApex: 4.0,
  // --- camera ---
  cam: { dist: 6.8, minDist: 1.6, height: 1.55, shoulder: 0.35, fov: 58, fovRun: 63,
         lagPos: 9, lagYaw: 5, autoYaw: 1.3, pitchMin: -0.55, pitchMax: 0.95,
         defaultPitch: 0.22, orbitSpeedKey: 2.4, orbitSpeedMouse: 0.0024,
         collideRadius: 0.35, recenterTime: 0.35, peekFov: 70 },
};

/** Integration step used by `simulateJump`. Also the controller's substep. */
export const SIM_DT = 1 / 240;

export const LAND_SOFT = 8;
export const LAND_HARD = TUNE.hardLandSpeed;

/* ===========================================================================
 * 1. Heading convention — ONE conversion, ONE place (CONTRACT: yaw 0 = −Z)
 * ======================================================================== */

/**
 * Unit heading for an authored yaw. yaw 0 faces −Z, +yaw turns counter-clockwise
 * seen from above (matches THREE.Object3D.rotation.y).
 * `out` is any object with x/y/z (a THREE.Vector3 or a plain object).
 */
export function headingFromYaw(yaw, out) {
  out = out || { x: 0, y: 0, z: 0 };
  out.x = -Math.sin(yaw); out.y = 0; out.z = -Math.cos(yaw);
  return out;
}

/** Inverse of headingFromYaw for a flat direction. */
export function yawFromHeading(x, z) {
  return Math.atan2(-x, -z);
}

/* ===========================================================================
 * 2. The canonical jump maths
 * ======================================================================== */

/**
 * Advance a vertical velocity by one step of asymmetric gravity. THE gravity
 * function — the controller must call this, never integrate gravity itself.
 */
export function applyGravity(vy, dt, rising) {
  const up = rising === undefined ? vy > 0 : !!rising;
  const g = up ? TUNE.gravRise : TUNE.gravFall;
  let out = vy - g * dt;
  if (out < -TUNE.terminal) out = -TUNE.terminal;
  return out;
}

/** Apex height above take-off for a vertical launch speed. */
export function apexFor(v0) {
  return (v0 * v0) / (2 * TUNE.gravRise);
}

/** Vertical launch speed that reaches `metres` above the take-off surface. */
export function launchVelocityForApex(metres) {
  return Math.sqrt(Math.max(0, 2 * TUNE.gravRise * metres));
}

/**
 * Exact integration of a jump: launch at vertical `v0` with horizontal speed
 * `fwd`, land on a surface `dy` metres above (+) or below (−) take-off.
 * Horizontal air drag is the controller's `airDrag` (per-second fraction).
 * Returns {gap, apex, airtime}; gap is NaN when the apex never reaches dy.
 */
export function simulateJump(opt) {
  const v0 = opt.v0, dy = opt.dy || 0;
  let fwd = opt.fwd || 0;
  const drag = opt.drag === undefined ? TUNE.airDrag : opt.drag;
  const dt = SIM_DT;
  let vy = v0, y = 0, x = 0, t = 0, apex = 0;
  const maxT = 6;
  // rise until apex; then fall until we cross dy going down
  while (t < maxT) {
    vy = applyGravity(vy, dt);
    const ny = y + vy * dt;
    if (vy < 0 && y >= dy && ny <= dy) {
      // interpolate crossing
      const f = (y - dy) / Math.max(1e-9, y - ny);
      x += fwd * dt * f; t += dt * f;
      return { gap: x, apex, airtime: t };
    }
    y = ny;
    if (y > apex) apex = y;
    x += fwd * dt;
    fwd *= Math.max(0, 1 - drag * dt);
    t += dt;
    if (vy < 0 && y < dy - 200) break;
  }
  return { gap: NaN, apex, airtime: NaN };
}

/* ===========================================================================
 * 3. Published reach envelope — authoring limits every course must respect
 * ======================================================================== */

/** Fraction of the theoretical max a REQUIRED path may use before it is unfair. */
export const SAFE_FRACTION = 0.84;

const DYS = [0, 1.0, 1.6, 2.0, 2.6, 3.0, -1.0, -2.0, -4.0];

function rowsFor(v0, fwd, extraGap) {
  const rows = [];
  for (const dy of DYS) {
    const s = simulateJump({ v0, fwd, dy });
    if (!Number.isFinite(s.gap)) { rows.push({ dy, max: 0, safe: 0, airtime: 0 }); continue; }
    const max = s.gap + (extraGap || 0);
    rows.push({ dy, max: +max.toFixed(2), safe: +(max * SAFE_FRACTION).toFixed(2), airtime: +s.airtime.toFixed(3) });
  }
  return rows;
}

/**
 * The reach table. `max` is edge-to-edge horizontal distance the hero's FEET can
 * cross (the capsule radius on each side is NOT counted — that is the margin).
 * `runup` is the straight, unobstructed approach the move needs; `landings` is
 * how many prior landings (the triple chain) it needs on that approach.
 */
export const REACH_TABLE = {
  single:   { v0: TUNE.jumpV[0], fwd: TUNE.speedRun, runup: 0, landings: 0, rows: rowsFor(TUNE.jumpV[0], TUNE.speedRun) },
  double:   { v0: TUNE.jumpV[1], fwd: TUNE.speedRun, runup: 4, landings: 1, rows: rowsFor(TUNE.jumpV[1], TUNE.speedRun) },
  triple:   { v0: TUNE.jumpV[2], fwd: TUNE.speedRun, runup: 6, landings: 2, rows: rowsFor(TUNE.jumpV[2], TUNE.speedRun) },
  longjump: { v0: TUNE.longJump.vy, fwd: TUNE.longJump.fwd, runup: 6, landings: 0, rows: rowsFor(TUNE.longJump.vy, TUNE.longJump.fwd) },
  backflip: { v0: TUNE.backflip.vy, fwd: 0, runup: 0, landings: 0, rows: rowsFor(TUNE.backflip.vy, 0), apex: +apexFor(TUNE.backflip.vy).toFixed(2) },
  sideflip: { v0: TUNE.sideflip.vy, fwd: TUNE.sideflip.lateral, runup: 2, landings: 0, rows: rowsFor(TUNE.sideflip.vy, TUNE.sideflip.lateral), apex: +apexFor(TUNE.sideflip.vy).toFixed(2) },
  wallkick: { v0: TUNE.wallKick.vy, fwd: TUNE.wallKick.away, runup: 0, landings: 0, rows: rowsFor(TUNE.wallKick.vy, TUNE.wallKick.away), apex: +apexFor(TUNE.wallKick.vy).toFixed(2), shaftMax: 3.4 },
  poundjump:{ v0: TUNE.pound.bounceV, fwd: TUNE.speedWalk, runup: 0, landings: 0, rows: rowsFor(TUNE.pound.bounceV, TUNE.speedWalk), apex: +apexFor(TUNE.pound.bounceV).toFixed(2) },
  // a dive from a single jump's apex: +fwd horizontal at ~apex; approximated as
  // a single jump with the dive speed for the falling half.
  dive:     { v0: TUNE.dive.vy, fwd: TUNE.dive.fwd, runup: 3, landings: 0, rows: rowsFor(TUNE.dive.vy, TUNE.dive.fwd) },
};

/** Headline numbers (flat, safe) for UI/docs. */
export const REACH = {
  singleSafe: REACH_TABLE.single.rows[0].safe,
  doubleSafe: REACH_TABLE.double.rows[0].safe,
  tripleSafe: REACH_TABLE.triple.rows[0].safe,
  longSafe: REACH_TABLE.longjump.rows[0].safe,
  singleApex: +apexFor(TUNE.jumpV[0]).toFixed(2),
  doubleApex: +apexFor(TUNE.jumpV[1]).toFixed(2),
  tripleApex: +apexFor(TUNE.jumpV[2]).toFixed(2),
};

/** Interpolate a table's safe/max gap at an arbitrary dy. */
function gapAt(rows, dy, key) {
  const sorted = rows.slice().sort((a, b) => a.dy - b.dy);
  if (dy <= sorted[0].dy) return sorted[0][key];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1], b = sorted[i];
    if (dy <= b.dy) {
      const f = (dy - a.dy) / Math.max(1e-9, b.dy - a.dy);
      return a[key] + (b[key] - a[key]) * f;
    }
  }
  return 0;
}

/**
 * Best LEGAL move for a required gap: the landing is `dy` metres above the
 * take-off and the approach offers `runup` metres of straight run. Returns the
 * move with the largest safe gap among those whose run-up requirement is met.
 * Moves that need chained landings (double/triple) are only offered when
 * `landings` (prior safe landings on the approach) is at least their need.
 */
export function bestGap(dy, runup, landings) {
  runup = runup || 0; landings = landings || 0;
  let best = { move: 'none', safe: 0, max: 0 };
  for (const [move, t] of Object.entries(REACH_TABLE)) {
    if (move === 'dive' || move === 'wallkick' || move === 'poundjump') continue;
    if (runup < t.runup) continue;
    if (landings < t.landings) continue;
    const safe = gapAt(t.rows, dy, 'safe');
    const max = gapAt(t.rows, dy, 'max');
    if (safe > best.safe) best = { move, safe, max };
  }
  return best;
}

/** Vertical reach (metres up) a move can land, with a small margin. */
export function bestRise(runup, landings) {
  const list = [
    ['single', apexFor(TUNE.jumpV[0])],
    ['backflip', apexFor(TUNE.backflip.vy)],
    ['sideflip', apexFor(TUNE.sideflip.vy)],
  ];
  if ((runup || 0) >= 4 && (landings || 0) >= 1) list.push(['double', apexFor(TUNE.jumpV[1])]);
  if ((runup || 0) >= 6 && (landings || 0) >= 2) list.push(['triple', apexFor(TUNE.jumpV[2])]);
  let best = ['none', 0];
  for (const e of list) if (e[1] > best[1]) best = e;
  return { move: best[0], apex: best[1], safe: best[1] - 0.35 };
}

/** Pretty-print the envelope (used by `node -e` and reachcheck's banner). */
export function reachBanner() {
  const lines = ['CRESTBOUND reach envelope (edge-to-edge metres; safe = authoring limit)'];
  for (const [move, t] of Object.entries(REACH_TABLE)) {
    const flat = t.rows.find((r) => r.dy === 0) || t.rows[0];
    const up = t.rows.filter((r) => r.dy > 0 && r.max > 0).map((r) => `+${r.dy}:${r.safe}`).join(' ');
    lines.push(`${move.padEnd(9)} flat max ${String(flat.max).padEnd(5)} safe ${String(flat.safe).padEnd(5)} air ${flat.airtime}s  up[${up}]${t.apex ? '  apex ' + t.apex : ''}  runup ${t.runup} m`);
  }
  return lines.join('\n');
}

/**
 * Exact reference numbers other modules may quote in comments/tests. Anything
 * quoted elsewhere must be one of these, never a hand-typed guess.
 */
export const EXACT = Object.freeze({
  singleApex: apexFor(TUNE.jumpV[0]),
  doubleApex: apexFor(TUNE.jumpV[1]),
  tripleApex: apexFor(TUNE.jumpV[2]),
  longjumpApex: apexFor(TUNE.longJump.vy),
  backflipApex: apexFor(TUNE.backflip.vy),
  sideflipApex: apexFor(TUNE.sideflip.vy),
  wallkickApex: apexFor(TUNE.wallKick.vy),
  poundjumpApex: apexFor(TUNE.pound.bounceV),
  singleRiseTime: TUNE.jumpV[0] / TUNE.gravRise,
  singleAirtime: REACH_TABLE.single.rows[0].airtime,
  tripleAirtime: REACH_TABLE.triple.rows[0].airtime,
  longjumpAirtime: REACH_TABLE.longjump.rows[0].airtime,
  stopTime: TUNE.speedRun / TUNE.decelGround,
  runUpTime: TUNE.speedRun / TUNE.accelGround,
});
